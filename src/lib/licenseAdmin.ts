import {
  formatOfflineDeviceId,
  normalizeOfflineDeviceId,
  type OfflineLicenseDoc,
  type OfflineLicenseStatus,
} from "../../functions/src/core/offlineLicense";
import { isFirebaseConfigured } from "./firebaseClient";

/**
 * Master-side admin client for the offline-license kill switch.
 * Uses the existing `company()` helper from cloud.ts via dynamic
 * import, so Firebase is only touched when configured — the Master
 * build ships unconfigured too, and must not break.
 *
 * Ops (server: companyConsole, admin-only): `offlineLicenses`
 * (list all devices) and `offlineLicenseStatus` (block/unblock one).
 * Presence + block/unlock only — no billing, no data sync.
 */

export type OfflineDeviceRow = OfflineLicenseDoc;

export const NOT_CONFIGURED_MESSAGE =
  "Server not connected — Firebase is not configured in this build";

async function companyOp<T>(op: string, data: unknown = {}): Promise<T> {
  if (!isFirebaseConfigured()) throw Error(NOT_CONFIGURED_MESSAGE);
  const { company } = await import("./cloud");
  return company<T>(op, data);
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
  const { devices } = await companyOp<{ devices: OfflineLicenseDoc[] }>(
    "offlineLicenses",
  );
  return (devices ?? []).map(mapRow).sort((a, b) => b.lastSeen - a.lastSeen);
}

/** Block or unblock one device by Device ID (dashes optional). */
export async function setOfflineLicenseStatus(
  deviceId: string,
  status: OfflineLicenseStatus,
): Promise<void> {
  const id = normalizeOfflineDeviceId(deviceId);
  await companyOp("offlineLicenseStatus", { deviceId: id, status });
}

export function displayDeviceId(deviceId: string): string {
  try {
    return formatOfflineDeviceId(deviceId);
  } catch {
    return deviceId;
  }
}
