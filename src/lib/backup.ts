/**
 * Offline backup / restore (preview) for Aurum.
 *
 * MediSmart-style daily backup, adapted for Aurum's workspace model:
 * a versioned JSON file with a SHA-256 checksum over canonical JSON,
 * exported by the shopkeeper (Share sheet / download) and picked up
 * again on a new phone. There is NO automatic upload: Gmail cannot
 * take an attachment via `mailto:`, and Google Drive needs a one-time
 * sign-in, so the file is shared/downloaded and the shopkeeper picks
 * Gmail / WhatsApp / Drive from the system share sheet.
 *
 * Backup runs daily-on-open (like MediSmart), NOT at an exact 02:00 —
 * an exact 02:00 backup needs a native Android WorkManager scheduler
 * plus a battery-optimisation exemption, which is not built yet.
 *
 * Restore is PREVIEW-ONLY: validation + counts work, but applying a
 * restore is not wired. Applying needs a new `perform("restore",
 * workspaceData)` hook (an `"restore"` Action in
 * functions/src/core/model.ts, a demoMutation case, and a server
 * handler in functions/src/server/workspace.ts). Never claim a
 * restore applies data until that hook exists.
 *
 * The workspace has exactly 6 real collections (see
 * functions/src/core/model.ts `Workspace`): profile, products,
 * customers, rates, invoices, drafts. Do NOT invent
 * payments / customerLedger / stockMovements / reversals /
 * conversions collections — they do not exist in the model.
 */
import {
  stableJson,
  type Workspace,
} from "../../functions/src/core/model";

export const BACKUP_FORMAT = "aurum-backup" as const;
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_HISTORY = 7;

export type BackupDestination = "share" | "gmail" | "whatsapp" | "drive";

export type BackupPreferences = {
  /** Daily reminder on app start when no backup was made today. */
  autoReminder: boolean;
  /** Where the shopkeeper prefers to send the backup file. */
  destination: BackupDestination;
};

export const DEFAULT_BACKUP_PREFERENCES: BackupPreferences = {
  autoReminder: true,
  destination: "share",
};

export type BackupCounts = {
  products: number;
  customers: number;
  rates: number;
  invoices: number;
  drafts: number;
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

export function backupFilename(
  shopName: string,
  at = new Date(),
): string {
  const slug = shopName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "aurum";
  const day = at.toISOString().slice(0, 10);
  return `aurum-backup-${slug}-${day}.json`;
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
  if (errors.length) return { valid: false, errors };

  const expected = await checksumFor(data);
  if (expected !== file.checksum)
    errors.push(
      "Checksum does not match — the file may be edited or corrupted. Do not restore it.",
    );
  const counts = countsFor(data);
  for (const [k, v] of Object.entries(counts)) {
    if (file.counts?.[k as keyof BackupCounts] !== v)
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

/** Keep only the most recent 7 backup entries, newest first. */
export function recordBackupHistory(
  history: BackupHistoryEntry[],
  entry: BackupHistoryEntry,
): BackupHistoryEntry[] {
  const merged = [entry, ...history.filter((h) => h.createdAt !== entry.createdAt)];
  merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return merged.slice(0, MAX_BACKUP_HISTORY);
}

function readJson<T>(key: string): T | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full / unavailable (private mode): backup still works
    // via download/share; only the reminder history is lost.
  }
}

export function loadLastBackupAt(): string | null {
  return readJson<string>(LAST_BACKUP_KEY);
}

export function loadBackupHistory(): BackupHistoryEntry[] {
  return readJson<BackupHistoryEntry[]>(HISTORY_KEY) ?? [];
}

export function loadBackupPreferences(): BackupPreferences {
  return { ...DEFAULT_BACKUP_PREFERENCES, ...readJson<Partial<BackupPreferences>>(PREFS_KEY) };
}

export function saveBackupPreferences(prefs: BackupPreferences): void {
  writeJson(PREFS_KEY, prefs);
}

/** Record a completed backup (updates last-backup date + last-7 history). */
export function markBackupDone(file: BackupFile): BackupHistoryEntry[] {
  writeJson(LAST_BACKUP_KEY, file.createdAt);
  const history = recordBackupHistory(loadBackupHistory(), {
    createdAt: file.createdAt,
    filename: backupFilename(file.shopName, new Date(file.createdAt)),
    shopName: file.shopName,
    counts: file.counts,
  });
  writeJson(HISTORY_KEY, history);
  return history;
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
 * WhatsApp, Gmail, …). Returns "shared", "downloaded" (share sheet
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
