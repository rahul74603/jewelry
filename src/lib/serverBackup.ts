/**
 * Automatic cloud backup on the Cloudflare license server (D1) — no
 * Google Drive, no shopkeeper action.
 *
 * The backup file lives on the phone AND in the server's `backups`
 * table (one backup per shop per year, keyed by device + year,
 * overwritten in place; large backups are split into ~800 KB chunks
 * server-side). The shopkeeper never picks a folder, never signs in
 * anywhere, and never taps anything for the cloud copy: after the
 * 2 AM native backup run is synced on the next app open, the UI
 * marks a server upload pending and uploads it; if that upload
 * fails, it stays pending and `syncServerBackupOnOpen()` retries it
 * once a day on app open until it succeeds.
 *
 * Offline-first: the local backup never waits for the upload. A
 * failed upload only marks the server copy pending (see
 * src/lib/cloudBackup.ts, the Drive sibling of this module — same
 * patterns: injectable store + injectable fetch for tests, never
 * throws on the non-admin paths, Hindi-friendly reason strings).
 * The Worker side is the same Cloudflare Worker that serves the
 * license server (see src/lib/licenseServer.ts) — the base URL is
 * already configured in both builds, no new env vars, no admin
 * token on the shopkeeper paths.
 *
 * (First designed for R2, but Cloudflare requires a payment card on
 * file even for the $0 R2 plan, and the developer has RuPay only —
 * so the storage backend is D1; the endpoints and this module's
 * behaviour are unchanged.)
 *
 * SECURITY v1 (honest): transport is over HTTPS, D1 encrypts data
 * at rest, and the Worker only serves a backup to the licensed,
 * unblocked device that owns it — there are no public URLs, and one
 * shop cannot fetch another shop's backup by guessing a key (the
 * Worker checks the device). Per-shop encryption keys (so even the
 * server operator cannot read a backup) are OUT of scope for v1 —
 * TODO, do not build yet.
 */
import {
  backupToJson,
  createBackup,
  localDay,
  localPrefsStore,
  type BackupFile,
  type PrefsStore,
} from "./backup";
import {
  getLicenseAdminToken,
  getLicenseServerUrl,
} from "./licenseServer";
import type { Workspace } from "../../functions/src/core/model";

/** Backup size limit enforced by the Worker (>5 MB → 413). */
export const SERVER_BACKUP_MAX_BYTES = 5 * 1024 * 1024;

/** Upload timeout (30s) and download timeout (15s). */
export const SERVER_BACKUP_UPLOAD_TIMEOUT_MS = 30_000;
export const SERVER_BACKUP_DOWNLOAD_TIMEOUT_MS = 15_000;
const SERVER_BACKUP_TRANSFER_TIMEOUT_MS = 30_000;

export const SERVER_BACKUP_PENDING_KEY = "aurum:serverbackup:pending";
export const SERVER_BACKUP_LAST_KEY = "aurum:serverbackup:last";
export const SERVER_BACKUP_REASON_KEY = "aurum:serverbackup:reason";
export const SERVER_BACKUP_ATTEMPT_KEY = "aurum:serverbackup:attempt";

/** Device IDs on the wire: 12 lowercase hex, no dashes (same
 * one-liner as licenseServer.ts `wireDeviceId`, which is private). */
function wireDeviceId(deviceId: string): string {
  return deviceId.replace(/[^0-9A-Fa-f]/g, "").toLowerCase();
}

/** True only for a valid wire Device ID (12 lowercase hex). */
export function isValidWireDeviceId(deviceId: string): boolean {
  return /^[0-9a-f]{12}$/.test(wireDeviceId(deviceId));
}

/** One file per year, per device: `backups/<deviceId>/aurum-backup-<year>.json`. */
export function serverBackupKey(deviceId: string, year: number): string {
  return `backups/${wireDeviceId(deviceId)}/aurum-backup-${year}.json`;
}

/** In-memory store for tests (mirrors cloudBackup.ts `memoryCloudStore`). */
export function memoryServerBackupStore(): {
  store: PrefsStore;
  map: Map<string, string>;
} {
  const map = new Map<string, string>();
  return {
    map,
    store: {
      get: (k) => map.get(k) ?? null,
      set: (k, v) => void map.set(k, v),
      remove: (k) => void map.delete(k),
    },
  };
}

/** Forget a key: true removal when the store supports it, otherwise
 * an empty value, which every reader here treats as absent. */
function clearKey(store: PrefsStore, key: string): void {
  if (typeof store.remove === "function") store.remove(key);
  else store.set(key, "");
}

function readValue(store: PrefsStore, key: string): string | null {
  const raw = store.get(key);
  return raw ? raw : null;
}

export function isServerBackupUploadPending(
  store: PrefsStore = localPrefsStore,
): boolean {
  return store.get(SERVER_BACKUP_PENDING_KEY) === "1";
}

export function loadLastServerBackupUploadAt(
  store: PrefsStore = localPrefsStore,
): string | null {
  return readValue(store, SERVER_BACKUP_LAST_KEY);
}

/** The specific reason the last server upload failed, if any. */
export function loadServerBackupReason(
  store: PrefsStore = localPrefsStore,
): string | null {
  return readValue(store, SERVER_BACKUP_REASON_KEY);
}

/** Local day (YYYY-MM-DD) of the last upload attempt, if any. */
export function loadServerBackupAttemptDate(
  store: PrefsStore = localPrefsStore,
): string | null {
  return readValue(store, SERVER_BACKUP_ATTEMPT_KEY);
}

/** Mark that a cloud upload is owed (set by the UI when a native
 * 2 AM run is synced — see autoBackup.ts `syncAutoBackupRun`). */
export function markServerBackupPending(store: PrefsStore = localPrefsStore): void {
  store.set(SERVER_BACKUP_PENDING_KEY, "1");
}

/** Record a successful upload: last-upload date set, pending and
 * failure reason cleared. */
export function markServerBackupUploaded(
  createdAt: string,
  store: PrefsStore = localPrefsStore,
): void {
  store.set(SERVER_BACKUP_LAST_KEY, createdAt);
  clearKey(store, SERVER_BACKUP_PENDING_KEY);
  clearKey(store, SERVER_BACKUP_REASON_KEY);
}

/** Record a failed upload: reason + attempt date saved, pending
 * flag left exactly as it was (a failure never clears it). */
export function markServerBackupFailed(
  reason: string,
  store: PrefsStore = localPrefsStore,
): void {
  store.set(SERVER_BACKUP_REASON_KEY, reason);
  store.set(SERVER_BACKUP_ATTEMPT_KEY, localDay());
}

export type ServerBackupStatus = {
  status: "ok" | "pending" | "never";
  lastUploadAt: string | null;
  pending: boolean;
  reason: string | null;
};

/** Pure status derivation — pending wins over a previous success. */
export function getServerBackupStatus(
  store: PrefsStore = localPrefsStore,
): ServerBackupStatus {
  const pending = isServerBackupUploadPending(store);
  const lastUploadAt = loadLastServerBackupUploadAt(store);
  return {
    status: pending ? "pending" : lastUploadAt ? "ok" : "never",
    lastUploadAt,
    pending,
    reason: loadServerBackupReason(store),
  };
}

/** One-line Hindi explanation of a failed server upload, for Settings/toasts. */
export function serverBackupFailureText(reason: string | null): string {
  switch (reason) {
    case "not-configured":
      return "Cloud backup is baar configure nahi hai";
    case "offline":
      return "Internet nahi hai — agle baar app kholne par dobara try hoga";
    case "blocked":
      return "Is device ka cloud backup block hai — developer se sampark karein";
    case "unknown-device":
      return "Device pehchana nahi gaya — pehle app kholkar activation check karein";
    case "too-large":
      return "Backup bahut bada hai (5 MB se zyada)";
    case "failed":
      return "Cloud backup fail ho gaya — agle baar dobara try hoga";
    default:
      return "Agle backup par dobara try hoga";
  }
}

export type ServerBackupUploadFailureReason =
  | "not-configured"
  | "offline"
  | "blocked"
  | "unknown-device"
  | "too-large"
  | "failed";

export type ServerBackupUploadResult =
  | { uploaded: true; key: string; size: number }
  | { uploaded: false; reason: ServerBackupUploadFailureReason };

function isAbortError(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === "AbortError") ||
    (e instanceof Error && e.name === "AbortError")
  );
}

/**
 * Upload the yearly backup file to the server. Never throws for a missing
 * server URL, a failed upload, or a network failure — those come
 * back as a reason. On success the last-upload date is recorded
 * and the pending flag cleared; on failure the reason + attempt
 * date are recorded and the pending flag is kept, so the next app
 * open retries it. The local backup is never affected by this result.
 */
export async function uploadBackupToServer(
  file: BackupFile,
  deviceId: string,
  store: PrefsStore = localPrefsStore,
  fetchFn: typeof fetch = fetch,
): Promise<ServerBackupUploadResult> {
  const base = getLicenseServerUrl();
  if (!base) return { uploaded: false, reason: "not-configured" };
  const wire = wireDeviceId(deviceId);
  const body = backupToJson(file);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVER_BACKUP_UPLOAD_TIMEOUT_MS);
  try {
    const res = await fetchFn(
      `${base}/backup/upload?deviceId=${encodeURIComponent(wire)}`,
      {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body,
      },
    );
    if (res.ok) {
      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      const row = (data as { key?: unknown; size?: unknown } | null) ?? null;
      const year = new Date(file.createdAt).getFullYear();
      const key =
        typeof row?.key === "string" && row.key
          ? row.key
          : serverBackupKey(wire, year);
      const size =
        typeof row?.size === "number" && Number.isFinite(row.size)
          ? row.size
          : new TextEncoder().encode(body).length;
      markServerBackupUploaded(file.createdAt, store);
      return { uploaded: true, key, size };
    }
    const reason: ServerBackupUploadFailureReason =
      res.status === 403
        ? "blocked"
        : res.status === 404
          ? "unknown-device"
          : res.status === 413
            ? "too-large"
            : "failed";
    markServerBackupFailed(reason, store);
    return { uploaded: false, reason };
  } catch (e) {
    // Network down, or the 30s timeout fired — both retry tomorrow.
    void isAbortError(e);
    markServerBackupFailed("offline", store);
    return { uploaded: false, reason: "offline" };
  } finally {
    clearTimeout(timer);
  }
}

export type ServerBackupSyncResult = {
  attempted: boolean;
  uploaded?: boolean;
  reason?: string;
};

/**
 * Once-per-day retry hook, called on app open. Only runs when an
 * upload is pending, only once per local day (a failed attempt
 * records the date, so the next open the same day does nothing),
 * and never throws. Builds a fresh backup from the current
 * workspace and uploads it.
 */
export async function syncServerBackupOnOpen(
  data: Workspace,
  deviceId: string,
  store: PrefsStore = localPrefsStore,
  fetchFn: typeof fetch = fetch,
): Promise<ServerBackupSyncResult> {
  try {
    if (!isServerBackupUploadPending(store)) return { attempted: false };
    if (loadServerBackupAttemptDate(store) === localDay())
      return { attempted: false, reason: "already-tried-today" };
    const wire = wireDeviceId(deviceId);
    if (!isValidWireDeviceId(wire)) return { attempted: false };
    const file = await createBackup(data);
    const result = await uploadBackupToServer(file, wire, store, fetchFn);
    if (result.uploaded) return { attempted: true, uploaded: true };
    return { attempted: true, uploaded: false, reason: result.reason };
  } catch {
    return { attempted: true, uploaded: false, reason: "failed" };
  }
}

export type ServerBackupLatestResult =
  | {
      found: true;
      text: string;
      key: string | null;
      uploadedAt: string | null;
      size: number | null;
    }
  | {
      found: false;
      reason: "not-configured" | "not-found" | "blocked" | "offline" | "failed";
    };

/**
 * Fetch this device's latest cloud backup (for restore). Never
 * throws — "not-found" covers both "no backup yet" and "unknown
 * device", so the UI shows one Hindi line for both.
 */
export async function fetchLatestServerBackup(
  deviceId: string,
  fetchFn: typeof fetch = fetch,
): Promise<ServerBackupLatestResult> {
  const base = getLicenseServerUrl();
  if (!base) return { found: false, reason: "not-configured" };
  const wire = wireDeviceId(deviceId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVER_BACKUP_DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetchFn(
      `${base}/backup/latest?deviceId=${encodeURIComponent(wire)}`,
      { method: "GET", signal: controller.signal },
    );
    if (res.ok) {
      const text = await res.text();
      const sizeRaw = res.headers.get("X-Aurum-Backup-Size");
      const sizeNum = sizeRaw === null ? NaN : Number(sizeRaw);
      return {
        found: true,
        text,
        key: res.headers.get("X-Aurum-Backup-Key"),
        uploadedAt: res.headers.get("X-Aurum-Backup-Uploaded"),
        size: Number.isFinite(sizeNum) ? sizeNum : null,
      };
    }
    if (res.status === 404) return { found: false, reason: "not-found" };
    if (res.status === 403) return { found: false, reason: "blocked" };
    return { found: false, reason: "failed" };
  } catch {
    return { found: false, reason: "offline" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Copy one device's cloud backups to another device (admin — for a
 * phone change / replacement). THROWS on failure (not configured,
 * unauthorized, invalid ids, no backup, network) — the Master UI
 * shows the error. Both ids are validated before any network call.
 */
export async function transferServerBackup(
  fromDeviceId: string,
  toDeviceId: string,
  fetchFn: typeof fetch = fetch,
): Promise<{
  copied: string[];
  fromDeviceId: string;
  toDeviceId: string;
}> {
  const from = wireDeviceId(fromDeviceId);
  const to = wireDeviceId(toDeviceId);
  if (!isValidWireDeviceId(from) || !isValidWireDeviceId(to))
    throw Error("Device ID galat hai. Sahi 12-character Device ID daalein.");
  if (from === to)
    throw Error("Dono Device ID ek jaise hain — alag device chunein.");
  const base = getLicenseServerUrl();
  if (!base)
    throw Error("License server is not configured in this build.");
  const token = getLicenseAdminToken();
  if (!token)
    throw Error("Admin token configure nahi hai — Master build ka token check karein.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVER_BACKUP_TRANSFER_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchFn(`${base}/admin/backup/transfer`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ fromDeviceId: from, toDeviceId: to }),
    });
  } catch (e) {
    if (isAbortError(e))
      throw Error("Request time out ho gaya — dobara try karein.");
    throw Error("Network error — internet check karke dobara try karein.");
  } finally {
    clearTimeout(timer);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.ok) {
    const row = (data as { copied?: unknown; fromDeviceId?: unknown; toDeviceId?: unknown } | null) ?? null;
    return {
      copied: Array.isArray(row?.copied)
        ? row.copied.filter((k): k is string => typeof k === "string")
        : [],
      fromDeviceId:
        typeof row?.fromDeviceId === "string" ? row.fromDeviceId : from,
      toDeviceId: typeof row?.toDeviceId === "string" ? row.toDeviceId : to,
    };
  }
  if (res.status === 401)
    throw Error("Admin token galat hai — Master app ka token check karein.");
  if (res.status === 404)
    throw Error("Pehle wale device ka koi cloud backup nahi mila.");
  if (res.status === 400)
    throw Error("Device ID galat hai. Sahi 12-character Device ID daalein.");
  throw Error(`Cloud backup transfer fail ho gaya (${res.status}).`);
}
