/**
 * Google Drive cloud backup via the Android Storage Access Framework.
 *
 * The backup file lives on the phone AND in a Google Drive folder the
 * shopkeeper picks once (Settings → "Connect Google Drive folder").
 * After that one-time pick, every backup — manual Backup now and the
 * daily reminder flow — also writes the same yearly file into the
 * Drive folder (overwritten in place, same file every day), and
 * restore can read it back from Drive. The local copy in
 * Documents/AurumBackup/ is ALWAYS kept too: the cloud upload can
 * never fail the local backup, and if the cloud upload fails the app
 * says so and retries with the next backup.
 *
 * Why SAF and not the Google Drive API: an Android OAuth client is
 * tied to the package name + SHA-1 signing fingerprint, and Aurum's
 * CI builds are DEBUG APKs with a disposable debug signing key (a
 * fresh key on every run), so no registered OAuth client can ever
 * match these builds. SAF needs no Google Cloud project, no OAuth
 * client id and no signing fingerprint — it is the system folder
 * picker, and Google Drive appears in it through the Drive app's
 * DocumentsProvider (the Drive app must be installed on the phone).
 * The folder permission is persisted by the native plugin
 * (takePersistableUriPermission) so it survives restarts.
 *
 * The native side is android/app/src/main/java/com/aurum/jewellery/
 * DriveFolderPlugin.java ("DriveFolder"), registered in MainActivity.
 * It uses framework APIs only (DocumentsContract + ContentResolver).
 * On the web build there is no SAF picker, so cloud backup is
 * Android-only and every function degrades gracefully to
 * "not-connected" instead of throwing.
 *
 * No Gmail anywhere.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import {
  backupFilename,
  backupToJson,
  downloadBackupToDevice,
  type BackupFile,
  type BackupSaveResult,
} from "./backup";

/** Native DriveFolder plugin (see DriveFolderPlugin.java). */
export interface DriveFolderNative {
  pickFolder(): Promise<{ picked: boolean; uri?: string; name?: string }>;
  writeFile(options: {
    uri: string;
    filename: string;
    content: string;
  }): Promise<{ written: boolean }>;
  readFile(options: {
    uri: string;
    filename: string;
  }): Promise<{ found: boolean; content?: string }>;
  checkAccess(options: { uri: string }): Promise<{
    ok: boolean;
    reason?: string;
  }>;
  releaseFolder(options: { uri: string }): Promise<void>;
}

const driveFolder = registerPlugin<DriveFolderNative>("DriveFolder");

/** Small storage interface so tests can pass a fake store. */
export interface CloudStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export const localCloudStore: CloudStore = {
  get(key) {
    try {
      return typeof localStorage === "undefined"
        ? null
        : localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      if (typeof localStorage !== "undefined")
        localStorage.setItem(key, value);
    } catch {
      // Storage unavailable: cloud state just won't persist.
    }
  },
  remove(key) {
    try {
      if (typeof localStorage !== "undefined")
        localStorage.removeItem(key);
    } catch {
      // Nothing to clear.
    }
  },
};

/** In-memory store for tests. */
export function memoryCloudStore(): {
  store: CloudStore;
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

export type CloudFolder = {
  /** Persisted SAF tree URI, e.g. content://com.android.externalstorage.documents/tree/... */
  uri: string;
  /** Folder name as shown in the picker. */
  name: string;
  connectedAt: string;
};

export type CloudStatus =
  | "not-connected"
  | "connected"
  | "pending"
  | "permission-lost";

export type CloudUploadResult =
  | { uploaded: true }
  | {
      uploaded: false;
      reason: "not-connected" | "permission-lost" | "folder-missing" | "failed";
    };

export type CloudDownloadResult =
  | { found: true; text: string }
  | {
      found: false;
      reason: "not-connected" | "permission-lost" | "not-found" | "failed";
    };

const FOLDER_KEY = "aurum:cloud:folder";
const LAST_KEY = "aurum:cloud:last";
const PENDING_KEY = "aurum:cloud:pending";
const LOST_KEY = "aurum:cloud:access-lost";

/** True only in the Android app — the SAF picker does not exist on web. */
export function isCloudSupported(): boolean {
  return Capacitor.getPlatform() === "android";
}

/**
 * The real native plugin is only usable on Android; tests inject a
 * fake, which must be allowed through on any platform.
 */
function nativeUsable(native: DriveFolderNative): boolean {
  return native !== driveFolder || Capacitor.getPlatform() === "android";
}

function isValidFolder(value: unknown): value is CloudFolder {
  if (!value || typeof value !== "object") return false;
  const f = value as Partial<CloudFolder>;
  return (
    typeof f.uri === "string" &&
    f.uri.startsWith("content://") &&
    typeof f.name === "string" &&
    f.name.length > 0 &&
    typeof f.connectedAt === "string"
  );
}

export function loadCloudFolder(
  store: CloudStore = localCloudStore,
): CloudFolder | null {
  try {
    const parsed: unknown = JSON.parse(store.get(FOLDER_KEY) ?? "null");
    return isValidFolder(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveCloudFolder(
  folder: CloudFolder,
  store: CloudStore = localCloudStore,
): void {
  store.set(FOLDER_KEY, JSON.stringify(folder));
  store.remove(LOST_KEY);
  store.remove(PENDING_KEY);
}

export function loadLastCloudBackupAt(
  store: CloudStore = localCloudStore,
): string | null {
  return store.get(LAST_KEY);
}

export function isCloudUploadPending(
  store: CloudStore = localCloudStore,
): boolean {
  return store.get(PENDING_KEY) === "1";
}

function setCloudPending(store: CloudStore, pending: boolean): void {
  if (pending) store.set(PENDING_KEY, "1");
  else store.remove(PENDING_KEY);
}

function setAccessLost(store: CloudStore, lost: boolean): void {
  if (lost) store.set(LOST_KEY, "1");
  else store.remove(LOST_KEY);
}

/** Pure status derivation — folder, last upload, pending, access lost. */
export function deriveCloudStatus(
  folder: CloudFolder | null,
  pending: boolean,
  accessLost: boolean,
): CloudStatus {
  if (!folder) return "not-connected";
  if (accessLost) return "permission-lost";
  if (pending) return "pending";
  return "connected";
}

export function getCloudStatus(store: CloudStore = localCloudStore): {
  status: CloudStatus;
  folder: CloudFolder | null;
  lastCloudAt: string | null;
  pending: boolean;
} {
  const folder = loadCloudFolder(store);
  const pending = isCloudUploadPending(store);
  const accessLost = store.get(LOST_KEY) === "1";
  return {
    status: deriveCloudStatus(folder, pending, accessLost),
    folder,
    lastCloudAt: loadLastCloudBackupAt(store),
    pending,
  };
}

function reasonFromError(
  e: unknown,
): "permission-lost" | "folder-missing" | "failed" {
  const message = e instanceof Error ? e.message : String(e);
  if (message.includes("permission-revoked")) return "permission-lost";
  if (message.includes("folder-missing")) return "folder-missing";
  return "failed";
}

/**
 * Open the system folder picker and persist the chosen Drive folder.
 * Returns null when the user cancels (or on the web build, where
 * there is no picker). Throws only when the picker itself fails.
 */
export async function pickCloudFolder(
  native: DriveFolderNative = driveFolder,
  store: CloudStore = localCloudStore,
): Promise<CloudFolder | null> {
  if (!nativeUsable(native)) return null;
  const picked = await native.pickFolder();
  if (!picked.picked || !picked.uri) return null;
  const folder: CloudFolder = {
    uri: picked.uri,
    name: (picked.name ?? "Google Drive folder").slice(0, 80),
    connectedAt: new Date().toISOString(),
  };
  saveCloudFolder(folder, store);
  return folder;
}

/**
 * Write the yearly backup file into the connected Drive folder
 * (same file overwritten in place). Never throws for a missing
 * folder or a failed upload — those come back as a reason, and a
 * failed upload marks the cloud copy pending so the next backup
 * retries it. The local backup is never affected by this result.
 */
export async function uploadBackupToCloud(
  file: BackupFile,
  native: DriveFolderNative = driveFolder,
  store: CloudStore = localCloudStore,
): Promise<CloudUploadResult> {
  const folder = loadCloudFolder(store);
  if (!folder || !nativeUsable(native))
    return { uploaded: false, reason: "not-connected" };
  try {
    await native.writeFile({
      uri: folder.uri,
      filename: backupFilename(file.shopName, new Date(file.createdAt)),
      content: backupToJson(file),
    });
    store.set(LAST_KEY, file.createdAt);
    setCloudPending(store, false);
    setAccessLost(store, false);
    return { uploaded: true };
  } catch (e) {
    const reason = reasonFromError(e);
    if (reason === "permission-lost") setAccessLost(store, true);
    setCloudPending(store, true);
    return { uploaded: false, reason };
  }
}

/**
 * Read the yearly backup file back from the connected Drive folder.
 * "not-found" means the folder is fine but no backup is in it yet.
 */
export async function downloadBackupFromCloud(
  filename: string,
  native: DriveFolderNative = driveFolder,
  store: CloudStore = localCloudStore,
): Promise<CloudDownloadResult> {
  const folder = loadCloudFolder(store);
  if (!folder || !nativeUsable(native))
    return { found: false, reason: "not-connected" };
  try {
    const result = await native.readFile({ uri: folder.uri, filename });
    if (!result.found || typeof result.content !== "string")
      return { found: false, reason: "not-found" };
    return { found: true, text: result.content };
  } catch (e) {
    const reason = reasonFromError(e);
    if (reason === "permission-lost") setAccessLost(store, true);
    return {
      found: false,
      reason: reason === "folder-missing" ? "failed" : reason,
    };
  }
}

/**
 * Check the connected folder is still reachable (permission still
 * held, folder still there). Returns false when there is no folder
 * or access is lost, and records the loss so Settings can say so.
 */
export async function verifyCloudFolder(
  native: DriveFolderNative = driveFolder,
  store: CloudStore = localCloudStore,
): Promise<boolean> {
  const folder = loadCloudFolder(store);
  if (!folder || !nativeUsable(native)) return false;
  try {
    const result = await native.checkAccess({ uri: folder.uri });
    if (result.ok) {
      setAccessLost(store, false);
      return true;
    }
    setAccessLost(store, true);
    setCloudPending(store, true);
    return false;
  } catch {
    setAccessLost(store, true);
    setCloudPending(store, true);
    return false;
  }
}

/** Release the folder permission and forget the Drive folder. */
export async function disconnectCloudFolder(
  native: DriveFolderNative = driveFolder,
  store: CloudStore = localCloudStore,
): Promise<void> {
  const folder = loadCloudFolder(store);
  if (folder && nativeUsable(native)) {
    try {
      await native.releaseFolder({ uri: folder.uri });
    } catch {
      // Release is best-effort; disconnect anyway.
    }
  }
  store.remove(FOLDER_KEY);
  store.remove(LAST_KEY);
  store.remove(PENDING_KEY);
  store.remove(LOST_KEY);
}

/**
 * One backup, both places: the local copy first (Documents/
 * AurumBackup/, always), then the Drive folder when one is
 * connected. The cloud upload can never fail the local backup.
 */
export async function saveBackupEverywhere(
  file: BackupFile,
  native: DriveFolderNative = driveFolder,
  store: CloudStore = localCloudStore,
): Promise<{ local: BackupSaveResult; cloud: CloudUploadResult }> {
  const local = await downloadBackupToDevice(file);
  const cloud = await uploadBackupToCloud(file, native, store);
  return { local, cloud };
}
