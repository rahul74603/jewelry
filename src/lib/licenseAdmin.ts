import {
  formatOfflineDeviceId,
  normalizeOfflineDeviceId,
  type OfflineLicenseDoc,
  type OfflineLicenseStatus,
} from "../../functions/src/core/offlineLicense";
import {
  isLicenseAdminConfigured,
  listLicenses,
  removeLicense,
  setLicenseStatus,
} from "./licenseServer";

/**
 * Master-side admin client for the offline-license kill switch.
 * Talks to the Cloudflare Workers license server (see
 * src/lib/licenseServer.ts) over plain fetch — no Firebase here.
 * The Master build ships with the server URL + admin token as
 * build-time env vars; without them every call throws the
 * not-connected message and the dashboard shows its offline state.
 *
 * Ops: `listLicenses` (all devices), `setLicenseStatus`
 * (block/unblock one) and `removeLicense` (delete one presence
 * row — stale/uninstalled devices only). Presence + block/unlock
 * only — no billing, no data sync.
 */

export type OfflineDeviceRow = OfflineLicenseDoc;

export const NOT_CONFIGURED_MESSAGE =
  "Server not connected — license server is not configured in this build";

function requireAdminConfigured(): void {
  if (!isLicenseAdminConfigured()) throw Error(NOT_CONFIGURED_MESSAGE);
}

function mapRow(d: OfflineLicenseDoc): OfflineDeviceRow {
  return {
    deviceId: normalizeOfflineDeviceId(d.deviceId),
    shopName: d.shopName ?? "",
    model: d.model ?? "",
    appVersion: d.appVersion ?? "",
    status: d.status === "blocked" ? "blocked" : "active",
    firstSeen: Number(d.firstSeen) || 0,
    lastSeen: Number(d.lastSeen) || 0,
    heartbeatCount: Number(d.heartbeatCount) || 0,
  };
}

/** All devices that ever phoned home, newest heartbeat first. */
export async function listOfflineLicenses(): Promise<OfflineDeviceRow[]> {
  requireAdminConfigured();
  const devices = await listLicenses();
  return (devices ?? []).map(mapRow).sort((a, b) => b.lastSeen - a.lastSeen);
}

/** Block or unblock one device by Device ID (dashes optional). */
export async function setOfflineLicenseStatus(
  deviceId: string,
  status: OfflineLicenseStatus,
): Promise<void> {
  const id = normalizeOfflineDeviceId(deviceId);
  requireAdminConfigured();
  await setLicenseStatus(id, status);
}

/**
 * Remove one device's row from the server list by Device ID
 * (dashes optional). Only clears the list entry — a phone that
 * still has the app re-appears on its next heartbeat.
 */
export async function removeOfflineLicense(deviceId: string): Promise<void> {
  const id = normalizeOfflineDeviceId(deviceId);
  requireAdminConfigured();
  await removeLicense(id);
}

export function displayDeviceId(deviceId: string): string {
  try {
    return formatOfflineDeviceId(deviceId);
  } catch {
    return deviceId;
  }
}
