import {
  formatOfflineDeviceId,
  normalizeOfflineDeviceId,
  type OfflineLicenseDoc,
  type OfflineLicenseStatus,
} from "../../functions/src/core/offlineLicense";
import {
  isLicenseAdminConfigured,
  listLicenses,
  listUpdates,
  pushRelease as pushReleaseTransport,
  removeLicense,
  setLicenseStatus,
  type UpdateRecord,
} from "./licenseServer";
import { compareVersions } from "./appUpdate";

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

// ---------------------------------------------------------------------------
// Staged rollout (Ajay, 2026-11-26): a new version goes to EVERYONE
// eventually — but first ONLY to his own test phone, so he can check
// it is normal. When satisfied he taps ONE button in the Master app
// ("Sabko update bhejo") and it goes to all shops. Until then no shop
// sees or gets the update. No per-device toggles, no mandatory
// updates — every pushed update is a normal optional update.
// ---------------------------------------------------------------------------

export type UpdateRow = UpdateRecord;

function mapUpdateRow(r: UpdateRecord): UpdateRow {
  const asString = (v: unknown): string =>
    typeof v === "string" ? v : v == null ? "" : String(v);
  return {
    deviceId: normalizeOfflineDeviceId(r.deviceId),
    version: asString(r.version),
    customerArm64Url: asString(r.customerArm64Url),
    customerArmeabiUrl: asString(r.customerArmeabiUrl),
    masterArm64Url: asString(r.masterArm64Url),
    allowed: r.allowed === true,
    mandatory: r.mandatory === true,
    updatedAt: Number(r.updatedAt) || 0,
  };
}

/** All per-device update records, newest update first. */
export async function listUpdateRecords(): Promise<UpdateRow[]> {
  requireAdminConfigured();
  const rows = await listUpdates();
  return (rows ?? []).map(mapUpdateRow).sort((a, b) => b.updatedAt - a.updatedAt);
}

export type ReleaseStatus =
  | {
      version: string;
      status: "testing";
      pushedAt: 0;
    }
  | {
      version: string;
      status: "pushed";
      pushedAt: number;
    };

/**
 * The staged release, derived from GET /admin/updates: the
 * staged version is the NEWEST version across the records; it is
 * "pushed" when every record for that version has allowed=1,
 * otherwise "testing" (only Ajay's test phone sees it). pushedAt
 * is the newest updated_at of the pushed rows. Null when no
 * update record exists yet.
 */
export function deriveReleaseStatus(rows: UpdateRow[]): ReleaseStatus | null {
  if (rows.length === 0) return null;
  let version = "";
  for (const row of rows) {
    if (row.version && compareVersions(row.version, version) > 0)
      version = row.version;
  }
  if (!version) return null;
  const staged = rows.filter((r) => r.version === version);
  if (staged.length === 0) return null;
  if (staged.every((r) => r.allowed)) {
    return {
      version,
      status: "pushed",
      pushedAt: Math.max(0, ...staged.map((r) => r.updatedAt)),
    };
  }
  return { version, status: "testing", pushedAt: 0 };
}

/**
 * Push the staged version to ALL shops (admin): POST
 * /admin/releases/:version/push. Returns {version, pushedTo}.
 */
export async function pushRelease(
  version: string,
): Promise<{ version: string; pushedTo: number }> {
  requireAdminConfigured();
  const v = version.trim();
  if (!v) throw Error("Version khaali hai.");
  return pushReleaseTransport(v);
}
