/**
 * Offline backup / restore for Aurum.
 *
 * MediSmart-style daily backup, adapted for Aurum's workspace model:
 * a versioned JSON file with a SHA-256 checksum over canonical JSON.
 *
 * One file per year, overwritten daily: `aurum-backup-<shop>-<YYYY>.json`
 * lives in the phone's Documents/AurumBackup folder and is overwritten
 * in place every day, so there is always exactly one current file and
 * old years stay listed separately. No Gmail backup — the shopkeeper
 * downloads the file in one tap (Backup now) or shares it manually
 * (WhatsApp) from the Share sheet. The same file is ALSO uploaded to
 * our own automatic cloud backup (see src/lib/serverBackup.ts) — no
 * Google Drive, no folder pick (Drive backup was removed in v1.0.52).
 *
 * Backup runs daily when you open the app (like MediSmart) — and,
 * optionally, automatically every night at 02:00 via the native
 * scheduler (see src/lib/autoBackup.ts): the TS side hands a fresh
 * snapshot to the native worker, which writes the same yearly file
 * to Documents/AurumBackup. 02:00 sharp is not guaranteed (Doze /
 * battery saving can shift it, like the 10:00 AM SMS) — the Settings
 * screen says "around 2 AM".
 *
 * Restore is real: pick a file → validateBackup() (format, version,
 * SHA-256 checksum, counts) → confirm → perform("restore", data)
 * replaces the whole workspace. The hook refuses to apply anything
 * that fails validation.
 *
 * The workspace has exactly 7 real collections (see
 * functions/src/core/model.ts `Workspace`): profile, products,
 * customers, rates, invoices, drafts, loans. Do NOT invent
 * payments / customerLedger / stockMovements / reversals /
 * conversions collections — they do not exist in the model.
 */
import { Capacitor } from "@capacitor/core";
import {
  stableJson,
  type Workspace,
} from "../../functions/src/core/model";

export const BACKUP_FORMAT = "aurum-backup" as const;
export const BACKUP_VERSION = 1;
/** One history entry per yearly file — old years stay listed. */
export const MAX_BACKUP_HISTORY = 10;
/** Folder inside the phone's Documents where the yearly file lives. */
export const BACKUP_FOLDER = "AurumBackup";

export type BackupDestination = "download" | "share";

export type BackupPreferences = {
  /** Daily reminder on app start when no backup was made today. */
  autoReminder: boolean;
  /** Automatic backup every night at 02:00 (native scheduler). */
  autoBackup: boolean;
  /** Where the shopkeeper prefers to send the backup file. */
  destination: BackupDestination;
};

export const DEFAULT_BACKUP_PREFERENCES: BackupPreferences = {
  autoReminder: true,
  autoBackup: false,
  destination: "download",
};

export type BackupCounts = {
  products: number;
  customers: number;
  rates: number;
  invoices: number;
  drafts: number;
  loans: number;
};

export type BackupFile = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  shopName: string;
  /** SHA-256 hex of stableJson(data) — see checksumFor(). */
  checksum: string;
  counts: BackupCounts;
  data: Workspace;
};

export type BackupHistoryEntry = {
  createdAt: string;
  filename: string;
  shopName: string;
  counts: BackupCounts;
};

const LAST_BACKUP_KEY = "aurum:backup:last";
const HISTORY_KEY = "aurum:backup:history";
const PREFS_KEY = "aurum:backup:prefs";

/** SHA-256 hex digest. Works in the browser and in Node 22 / vitest. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function countsFor(data: Workspace): BackupCounts {
  return {
    products: data.products.length,
    customers: data.customers.length,
    rates: data.rates.length,
    invoices: data.invoices.length,
    drafts: data.drafts.length,
    // Loans are optional in older backups — count them as 0 there.
    loans: (data.loans ?? []).length,
  };
}

export async function checksumFor(data: Workspace): Promise<string> {
  return sha256Hex(stableJson(data));
}

/** Build a versioned, checksummed backup from the current workspace. */
export async function createBackup(
  data: Workspace,
  createdAt = new Date().toISOString(),
): Promise<BackupFile> {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt,
    shopName: data.profile.shopName,
    checksum: await checksumFor(data),
    counts: countsFor(data),
    data: structuredClone(data),
  };
}

export function backupToJson(file: BackupFile): string {
  return JSON.stringify(file, null, 2);
}

/** One rolling file per year: `aurum-backup-<shop>-<YYYY>.json`. The
 * same file is overwritten every day within the year; a new file
 * starts each January. Old data stays inside the file — it is a full
 * snapshot of the shop, not a daily delta. */
export function backupFilename(
  shopName: string,
  at = new Date(),
): string {
  const slug = shopName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "aurum";
  return `aurum-backup-${slug}-${at.getFullYear()}.json`;
}

export type BackupValidation =
  | { valid: true; file: BackupFile }
  | { valid: false; errors: string[] };

/** Validate a parsed backup object: format, version, checksum, counts. */
export async function validateBackup(value: unknown): Promise<BackupValidation> {
  const errors: string[] = [];
  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["Backup file is empty or unreadable."] };
  }
  const file = value as Partial<BackupFile>;
  if (file.format !== BACKUP_FORMAT)
    errors.push(`Not an Aurum backup (format is ${String(file.format)}).`);
  if (file.version !== BACKUP_VERSION)
    errors.push(`Unsupported backup version ${String(file.version)}.`);
  if (typeof file.createdAt !== "string" || !file.createdAt)
    errors.push("Backup is missing its creation date.");
  if (!file.data || typeof file.data !== "object")
    errors.push("Backup contains no workspace data.");
  if (typeof file.checksum !== "string" || !/^[0-9a-f]{64}$/.test(file.checksum))
    errors.push("Backup checksum is missing or malformed.");
  if (errors.length) return { valid: false, errors };

  const data = file.data as Workspace;
  for (const key of ["profile", "products", "customers", "rates", "invoices", "drafts"] as const) {
    if (!(key in data)) errors.push(`Backup data is missing "${key}".`);
  }
  // "loans" is optional here: backups made before the Girvi & EMI
  // module have no loans collection, and they must still restore —
  // the restore path fills loans: [] for them.
  if (errors.length) return { valid: false, errors };

  const expected = await checksumFor(data);
  if (expected !== file.checksum)
    errors.push(
      "Checksum does not match — the file may be edited or corrupted. Do not restore it.",
    );
  const counts = countsFor(data);
  for (const [k, v] of Object.entries(counts)) {
    // Older backups have no loans count — treat a missing count as 0.
    if ((file.counts?.[k as keyof BackupCounts] ?? 0) !== v)
      errors.push(`Record count mismatch for ${k}.`);
  }
  if (errors.length) return { valid: false, errors };
  return { valid: true, file: file as BackupFile };
}

/** Parse backup JSON text and validate it. */
export async function parseBackup(text: string): Promise<BackupValidation> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { valid: false, errors: ["File is not valid JSON."] };
  }
  return validateBackup(parsed);
}

/** Local calendar day (YYYY-MM-DD) for daily-on-open checks. */
export function localDay(at = new Date()): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** True when no backup has been made today yet. */
export function shouldAutoBackup(
  lastBackupAt: string | null,
  now = new Date(),
): boolean {
  if (!lastBackupAt) return true;
  return localDay(new Date(lastBackupAt)) !== localDay(now);
}

/** Daily-on-open check (MediSmart behaviour): due today, or not? */
export function runDailyCheck(
  lastBackupAt: string | null,
  now = new Date(),
): boolean {
  return shouldAutoBackup(lastBackupAt, now);
}

/** Keep one entry per yearly file (same file overwritten daily just
 * updates its entry), newest first. Old years stay listed. */
export function recordBackupHistory(
  history: BackupHistoryEntry[],
  entry: BackupHistoryEntry,
): BackupHistoryEntry[] {
  const merged = [entry, ...history.filter((h) => h.filename !== entry.filename)];
  merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return merged.slice(0, MAX_BACKUP_HISTORY);
}

/** Minimal key/value store for backup state (localStorage by
 * default; tests pass a memory store). Structural — the KvStore
 * in kvStore.ts satisfies it. */
export type PrefsStore = {
  get(key: string): string | null;
  set(key: string, value: string): void;
  /** Optional: truly forget a key. Stores without it fall back to
   * writing an empty value, which readers treat as absent. */
  remove?(key: string): void;
};

export const localPrefsStore: PrefsStore = {
  get: (key) => {
    try {
      return typeof localStorage === "undefined"
        ? null
        : localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key, value) => {
    try {
      if (typeof localStorage !== "undefined")
        localStorage.setItem(key, value);
    } catch {
      // Storage full / unavailable: backup still works via
      // download/share; only the reminder history is lost.
    }
  },
  remove: (key) => {
    try {
      if (typeof localStorage !== "undefined")
        localStorage.removeItem(key);
    } catch {
      // Nothing to clear.
    }
  },
};

function readJson<T>(key: string, store: PrefsStore = localPrefsStore): T | null {
  try {
    const raw = store.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(
  key: string,
  value: unknown,
  store: PrefsStore = localPrefsStore,
): void {
  try {
    store.set(key, JSON.stringify(value));
  } catch {
    // Storage full / unavailable (private mode): backup still works
    // via download/share; only the reminder history is lost.
  }
}

export function loadLastBackupAt(
  store: PrefsStore = localPrefsStore,
): string | null {
  return readJson<string>(LAST_BACKUP_KEY, store);
}

export function loadBackupHistory(
  store: PrefsStore = localPrefsStore,
): BackupHistoryEntry[] {
  return readJson<BackupHistoryEntry[]>(HISTORY_KEY, store) ?? [];
}

export function loadBackupPreferences(
  store: PrefsStore = localPrefsStore,
): BackupPreferences {
  const prefs = {
    ...DEFAULT_BACKUP_PREFERENCES,
    ...readJson<Partial<BackupPreferences>>(PREFS_KEY, store),
  };
  // Migrate old destination values (gmail / whatsapp / drive) — Gmail
  // backup was removed; WhatsApp/Drive are manual picks on the Share
  // sheet, not a saved destination.
  if (prefs.destination !== "download" && prefs.destination !== "share")
    prefs.destination = "download";
  return prefs;
}

export function saveBackupPreferences(
  prefs: BackupPreferences,
  store: PrefsStore = localPrefsStore,
): void {
  store.set(PREFS_KEY, JSON.stringify(prefs));
}

/** A backup run the native 02:00 worker made (plain data — the
 * worker cannot write WebView localStorage itself, so the TS side
 * records it on the next app open). */
export type AutoBackupRun = {
  createdAt: string;
  filename: string;
  shopName: string;
  counts: BackupCounts;
};

/** Record a backup run (manual or automatic): same last-backup
 * timestamp + history entry, so the Dashboard reminder clears.
 * Only moves forward — an older run never overwrites a newer
 * manual backup. */
export function recordBackupRun(
  run: AutoBackupRun,
  store: PrefsStore = localPrefsStore,
): BackupHistoryEntry[] {
  const last = loadLastBackupAt(store);
  if (last && last >= run.createdAt) return loadBackupHistory(store);
  writeJson(LAST_BACKUP_KEY, run.createdAt, store);
  const history = recordBackupHistory(loadBackupHistory(store), {
    createdAt: run.createdAt,
    filename: run.filename,
    shopName: run.shopName,
    counts: run.counts,
  });
  writeJson(HISTORY_KEY, history, store);
  return history;
}

/** Record a completed backup (updates last-backup date + per-year history). */
export function markBackupDone(
  file: BackupFile,
  store: PrefsStore = localPrefsStore,
): BackupHistoryEntry[] {
  return recordBackupRun(
    {
      createdAt: file.createdAt,
      filename: backupFilename(file.shopName, new Date(file.createdAt)),
      shopName: file.shopName,
      counts: file.counts,
    },
    store,
  );
}

export type BackupSaveResult = {
  /** How the file was saved: straight into the phone folder, via the
   * share sheet, or as a browser download. */
  method: "device-folder" | "shared" | "downloaded";
  filename: string;
  /** Exact place the shopkeeper can find the file. */
  location: string;
};

/**
 * One-tap backup download. On the phone the yearly file is written
 * straight to Documents/AurumBackup/ — the same file overwritten in
 * place every day, no share sheet, no picking a folder. If the direct
 * write fails (storage unavailable / permission denied) it falls back
 * to the share sheet, and if that is unavailable, to a browser
 * download — and says so, so the shopkeeper is never left guessing
 * where the file went. On the web build it is a plain download.
 */
export async function downloadBackupToDevice(
  file: BackupFile,
): Promise<BackupSaveResult> {
  const filename = backupFilename(file.shopName, new Date(file.createdAt));
  if (Capacitor.getPlatform() === "android") {
    try {
      const { Filesystem, Directory, Encoding } = await import(
        "@capacitor/filesystem"
      );
      await Filesystem.writeFile({
        path: `${BACKUP_FOLDER}/${filename}`,
        data: backupToJson(file),
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
        recursive: true,
      });
      return {
        method: "device-folder",
        filename,
        location: `Documents/${BACKUP_FOLDER}/${filename}`,
      };
    } catch {
      // Direct write failed — fall through to the share sheet below.
    }
  }
  const how = await shareBackupFile(file);
  return {
    method: how === "shared" ? "shared" : "downloaded",
    filename,
    location:
      how === "shared"
        ? "shared from this phone — pick WhatsApp or Drive in the share sheet"
        : "Downloads folder (browser download)",
  };
}

/** Download the backup file (browser). Falls back to a shareable blob. */
export function downloadBackupFile(file: BackupFile): string {
  const filename = backupFilename(file.shopName, new Date(file.createdAt));
  const blob = new Blob([backupToJson(file)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return filename;
}

/**
 * Share the backup file via the system share sheet (Android: Drive,
 * WhatsApp, …). Returns "shared", "downloaded" (share sheet
 * unavailable — file was downloaded instead) or "copied".
 */
export async function shareBackupFile(file: BackupFile): Promise<string> {
  const filename = backupFilename(file.shopName, new Date(file.createdAt));
  const blob = new Blob([backupToJson(file)], { type: "application/json" });
  const shareFile = new File([blob], filename, { type: "application/json" });
  if (
    typeof navigator !== "undefined" &&
    "share" in navigator &&
    (!("canShare" in navigator) ||
      (navigator as Navigator & { canShare: (d: { files: File[] }) => boolean }).canShare({ files: [shareFile] }))
  ) {
    await navigator.share({
      title: `Aurum backup — ${file.shopName}`,
      text: `Aurum backup of ${file.shopName} (${file.createdAt.slice(0, 10)}). Keep this file safe; it restores your shop data.`,
      files: [shareFile],
    });
    return "shared";
  }
  downloadBackupFile(file);
  return "downloaded";
}
