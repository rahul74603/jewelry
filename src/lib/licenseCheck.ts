import {
  normalizeOfflineDeviceId,
  type OfflineLicenseStatus,
} from "../../functions/src/core/offlineLicense";
import { heartbeat, isLicenseServerConfigured } from "./licenseServer";

/**
 * Offline-license heartbeat (kill switch + presence).
 *
 * SCOPE (Ajay, 2026-11-24 19:02 IST): online ONLY for block/unlock
 * + presence. This file sends exactly four fields, at most once a
 * day (plus on startup/foreground when online): deviceId, shopName,
 * model, appVersion. Nothing else goes online — no billing, no data
 * sync, no server workspace.
 *
 * The server is the Cloudflare Workers license server (see
 * src/lib/licenseServer.ts). When it is not configured (no
 * VITE_LICENSE_SERVER_URL in the build), every call is a NO-OP
 * that never throws and never touches the network: the app keeps
 * working FULLY OFFLINE. A failed check (network error, server
 * down) NEVER blocks the app — it reports active and leaves the
 * local flag alone.
 */

export const LICENSE_BLOCKED_KEY = "aurum:license-blocked";
export const LICENSE_CHECK_AT_KEY = "aurum:license-check-at";
export const LICENSE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type HeartbeatResult = {
  status: OfflineLicenseStatus;
  skipped?: boolean;
  error?: boolean;
};

function storage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** True when the server has blocked this device (persists across launches). */
export function isLicenseBlocked(): boolean {
  return storage()?.getItem(LICENSE_BLOCKED_KEY) === "1";
}

export function setLicenseBlocked(blocked: boolean): void {
  const s = storage();
  if (!s) return;
  if (blocked) s.setItem(LICENSE_BLOCKED_KEY, "1");
  else s.removeItem(LICENSE_BLOCKED_KEY);
}

/** True when a day has passed since the last heartbeat attempt. */
export function shouldCheckLicense(now = Date.now()): boolean {
  const at = Number(storage()?.getItem(LICENSE_CHECK_AT_KEY) ?? 0);
  return !Number.isFinite(at) || at <= 0 || now - at >= LICENSE_CHECK_INTERVAL_MS;
}

export function markLicenseChecked(now = Date.now()): void {
  storage()?.setItem(LICENSE_CHECK_AT_KEY, String(now));
}

/**
 * This device's model name, for the presence list only — the shared
 * helper from src/lib/device.ts (Part 1). Blank is fine — the server
 * accepts an empty model, and checkLicenseHeartbeat caps it at 100
 * chars before sending.
 */
export { getDeviceModel } from "./device";

export type HeartbeatArgs = {
  deviceId: string;
  shopName: string;
  model: string;
  appVersion: string;
};

/**
 * One heartbeat call. Returns the server status and updates the
 * local blocked flag + check timestamp on success. On any error
 * returns {status: "active", error: true} and changes nothing, so
 * a failed check never blocks the app.
 */
export async function checkLicenseHeartbeat(
  args: HeartbeatArgs,
): Promise<HeartbeatResult> {
  if (!isLicenseServerConfigured())
    return { skipped: true, status: "active" };
  let deviceId: string;
  try {
    deviceId = normalizeOfflineDeviceId(args.deviceId);
  } catch {
    return { skipped: true, status: "active" };
  }
  try {
    const { status } = await heartbeat({
      deviceId,
      shopName: args.shopName.trim().slice(0, 100),
      model: args.model.trim().slice(0, 100),
      appVersion: args.appVersion.trim().slice(0, 20),
    });
    setLicenseBlocked(status === "blocked");
    markLicenseChecked();
    return { status };
  } catch {
    // Offline, server down, rate-limited — never block the app.
    return { status: "active", error: true };
  }
}

/**
 * Heartbeat with the once-a-day throttle: skips the call when a
 * check already ran in the last 24 hours.
 */
export async function maybeCheckLicenseHeartbeat(
  args: HeartbeatArgs,
): Promise<HeartbeatResult> {
  if (!shouldCheckLicense())
    return {
      skipped: true,
      status: isLicenseBlocked() ? "blocked" : "active",
    };
  return checkLicenseHeartbeat(args);
}
