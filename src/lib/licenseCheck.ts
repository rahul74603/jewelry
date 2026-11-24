import {
  normalizeOfflineDeviceId,
  type OfflineLicenseStatus,
} from "../../functions/src/core/offlineLicense";
import { heartbeat, isLicenseServerConfigured } from "./licenseServer";

/**
 * Offline-license heartbeat (kill switch + presence).
 *
 * SCOPE (Ajay, 2026-11-24 19:02 IST): online ONLY for block/unlock
 * + presence. This file sends exactly four fields, on every app
 * open / foreground (throttled to once every 5 minutes so rapid
 * restarts do not spam the server): deviceId, shopName,
 * model, appVersion. Nothing else goes online — no billing, no data
 * sync, no server workspace.
 *
 * The 5-minute check (not once-a-day) is deliberate: a block from
 * the Master app must lock the Customer app on its NEXT open, not
 * up to a day later. The server rate-limits to 10 heartbeats/hour
 * per device, so a 5-minute throttle stays safely under it.
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
// Check on every app open, throttled to once every 5 minutes — a
// block must lock the app on its next open, not a day later.
export const LICENSE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

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

/** True when the check interval has passed since the last heartbeat attempt. */
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
 * Heartbeat with a short throttle: skips the call when a check
 * already ran in the last 5 minutes, so rapid restarts do not spam
 * the server. A block therefore applies on the next app open.
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
