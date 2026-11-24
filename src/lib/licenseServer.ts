import type {
  OfflineLicenseDoc,
  OfflineLicenseStatus,
} from "../../functions/src/core/offlineLicense";

/**
 * Fetch-based transport for the Aurum license server (Cloudflare
 * Workers + D1) — the remote kill switch.
 *
 * Replaces the Firebase Functions transport (the old Firebase
 * client + company() callable): Google gates every Cloud Functions
 * behind a billing account, and billing needs a Visa/Mastercard
 * (RuPay only here). The Worker is free-tier, no card.
 *
 * SCOPE (Ajay, 2026-11-24 19:02 IST): online ONLY for block/unlock
 * + presence. The heartbeat sends exactly four fields
 * (deviceId, shopName, model, appVersion); admin calls list devices,
 * block/unblock one, and remove one presence row (stale/uninstalled
 * devices only — a phone that still has the app re-appears on its
 * next heartbeat). Nothing else goes online.
 *
 * Env (Vite build-time):
 * - VITE_LICENSE_SERVER_URL — Worker base URL, both builds.
 * - VITE_LICENSE_ADMIN_TOKEN — Bearer token, Master build ONLY.
 *   The Customer build must never include it.
 *
 * No Firebase import in this module — the Demo bundle stays free
 * of the Firebase SDK for the license path.
 */

export const LICENSE_REQUEST_TIMEOUT_MS = 10_000;

export function getLicenseServerUrl(): string {
  const url = import.meta.env.VITE_LICENSE_SERVER_URL?.trim() ?? "";
  return url.replace(/\/+$/, "");
}

export function isLicenseServerConfigured(): boolean {
  return getLicenseServerUrl().length > 0;
}

export function getLicenseAdminToken(): string {
  return import.meta.env.VITE_LICENSE_ADMIN_TOKEN?.trim() ?? "";
}

/** Admin calls need the server URL AND the Bearer token. */
export function isLicenseAdminConfigured(): boolean {
  return isLicenseServerConfigured() && getLicenseAdminToken().length > 0;
}

/** Device IDs on the wire: 12 lowercase hex, no dashes. */
function wireDeviceId(deviceId: string): string {
  return deviceId.replace(/[^0-9A-Fa-f]/g, "").toLowerCase();
}

type RequestOptions = {
  method: "GET" | "POST" | "DELETE";
  body?: unknown;
  admin?: boolean;
};

/**
 * One JSON request to the license server. Throws a plain Error on
 * any failure (not configured, timeout, network error, non-2xx,
 * bad JSON) — callers decide fail-open vs surface.
 */
async function requestJson(
  path: string,
  { method, body, admin = false }: RequestOptions,
): Promise<unknown> {
  const base = getLicenseServerUrl();
  if (!base) throw Error("License server is not configured in this build.");
  if (admin && !getLicenseAdminToken())
    throw Error("License server admin token is not configured in this build.");
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    LICENSE_REQUEST_TIMEOUT_MS,
  );
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(admin
          ? { Authorization: `Bearer ${getLicenseAdminToken()}` }
          : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const msg = (data as { error?: unknown } | null)?.error;
      throw Error(
        typeof msg === "string" && msg
          ? msg
          : `License server error (${res.status}).`,
      );
    }
    return data;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError")
      throw Error("License server request timed out.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export type LicenseHeartbeatResult = { status: OfflineLicenseStatus };

/**
 * Device check-in. The Worker validates deviceId as 12 lowercase
 * hex, so normalise to lowercase on the wire. A 429 (too many
 * check-ins) throws here — the caller treats it as active / try
 * later, never as a block.
 */
export async function heartbeat(args: {
  deviceId: string;
  shopName: string;
  model: string;
  appVersion: string;
}): Promise<LicenseHeartbeatResult> {
  const data = await requestJson("/heartbeat", {
    method: "POST",
    body: {
      deviceId: wireDeviceId(args.deviceId),
      shopName: args.shopName,
      model: args.model,
      appVersion: args.appVersion,
    },
  });
  const status = (data as { status?: unknown } | null)?.status;
  if (status !== "active" && status !== "blocked")
    throw Error("License server returned an unexpected response.");
  return { status };
}

/** All devices that ever checked in, newest lastSeen first (admin). */
export async function listLicenses(): Promise<OfflineLicenseDoc[]> {
  const data = await requestJson("/licenses", {
    method: "GET",
    admin: true,
  });
  const rows = (data as { licenses?: unknown } | null)?.licenses;
  if (!Array.isArray(rows))
    throw Error("License server returned an unexpected response.");
  return rows as OfflineLicenseDoc[];
}

/** Block or unblock one device (admin). 404 when the device is unknown. */
export async function setLicenseStatus(
  deviceId: string,
  status: OfflineLicenseStatus,
): Promise<void> {
  const action = status === "blocked" ? "block" : "unblock";
  await requestJson(`/licenses/${wireDeviceId(deviceId)}/${action}`, {
    method: "POST",
    admin: true,
  });
}

/**
 * Remove one device's presence row (admin). 404 when the device is
 * unknown. Only clears the list entry — a phone that still has the
 * app re-appears on its next heartbeat as a fresh active device.
 */
export async function removeLicense(deviceId: string): Promise<void> {
  await requestJson(`/licenses/${wireDeviceId(deviceId)}`, {
    method: "DELETE",
    admin: true,
  });
}
