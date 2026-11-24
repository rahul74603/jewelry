/**
 * Automatic daily backup at 02:00 AM — the same pattern as the
 * 10:00 AM SMS reminders (src/lib/autoSms.ts), reused, not reinvented.
 *
 * How it works: the workspace lives in the app's JS store, which a
 * native background worker cannot read. So on every app open (and
 * after data changes — Dashboard calls prepareAutoBackup on the
 * same effect as prepareAutoSms) the JS side builds the full
 * checksummed backup file (createBackup — the exact yearly file
 * the manual "Backup now" writes) and saves it as a snapshot the
 * native worker can read: Capacitor Filesystem Directory.Data, which
 * on Android is the app's files dir (getFilesDir()). The native
 * trigger fires at 02:00 (Asia/Kolkata) and the worker copies that
 * snapshot verbatim to Documents/AurumBackup/<yearly file> and, when
 * a Drive folder is connected, into that folder too (persisted SAF
 * URI, handed to native on every app open — native cannot read
 * WebView localStorage, where the folder URI lives).
 *
 * The 02:00 trigger is an exact alarm (AlarmManager
 * setExactAndAllowWhileIdle) when the phone allows exact alarms, and
 * WorkManager periodic work (24h, initial delay to 02:00) when it
 * does not. Even the exact alarm is best-effort on some phones
 * (Infinix/Xiaomi battery saving and autostart) — the Settings
 * screen says "around 2 AM", never "sharp at 2:00".
 *
 * After a run, the worker records its result in its own
 * SharedPreferences; the TS side syncs that into localStorage on
 * the next app open (recordBackupRun) so the Dashboard backup
 * reminder clears — native cannot write WebView localStorage.
 *
 * Failure rules: a missing snapshot skips quietly (no crash, no
 * spam — the app simply hasn't been opened since enabling). No
 * Drive folder means phone-only, not an error. A failed local write
 * or Drive write retries later the same day (max 3 attempts, native
 * side); the local copy is the safety net, and Settings shows the
 * last run's status so a Drive failure is visible in the morning.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import {
  backupFilename,
  backupToJson,
  createBackup,
  loadBackupPreferences,
  loadLastBackupAt,
  recordBackupRun,
  type AutoBackupRun,
  type BackupCounts,
  type PrefsStore,
} from "./backup";
import {
  loadCloudFolder,
  localCloudStore,
  type CloudStore,
} from "./cloudBackup";
import {
  stableJson,
  type Workspace,
} from "../../functions/src/core/model";

export type AutoBackupMode = "exact" | "periodic";

/** Last-run status, as the native worker recorded it. */
export type AutoBackupRunStatus =
  | "success"
  | "partial"
  | "failed"
  | "no-snapshot";

export type AutoBackupStatus = {
  enabled: boolean;
  mode: AutoBackupMode | null;
  exactAllowed: boolean;
  lastRunAt: string | null;
  lastStatus: AutoBackupRunStatus | null;
  lastFilename: string | null;
  lastShopName: string | null;
  /** Counts from the snapshot the worker wrote, as JSON (or ""). */
  lastCountsJson: string;
  /** True when the Drive copy of the last run succeeded. */
  driveOk: boolean;
  lastError: string | null;
};

export interface BackupSchedulerNative {
  scheduleBackup(options: {
    driveFolderUri: string;
  }): Promise<{ scheduled: boolean; mode: string; exactAllowed: boolean }>;
  cancelBackup(): Promise<{ cancelled: boolean }>;
  getStatus(): Promise<{
    enabled: boolean;
    mode: string;
    exactAllowed: boolean;
    lastRunAt: string;
    lastStatus: string;
    lastFilename: string;
    lastShopName: string;
    lastCountsJson: string;
    driveOk: boolean;
    lastError: string;
  }>;
  runNow(options: {
    driveFolderUri: string;
  }): Promise<{ started: boolean }>;
  openExactAlarmSettings(): Promise<void>;
}

const backupScheduler =
  registerPlugin<BackupSchedulerNative>("BackupScheduler");

/** Snapshot the native 02:00 worker reads: <files dir>/auto-backup/snapshot.json. */
export const AUTO_BACKUP_SNAPSHOT_PATH = "auto-backup/snapshot.json";

/** True only in the Android app — the scheduler needs the native plugin. */
export function isAutoBackupSupported(): boolean {
  return Capacitor.getPlatform() === "android";
}

/**
 * The real native plugin is only usable on Android; tests inject a
 * fake, which must be allowed through on any platform.
 */
function nativeUsable(native: BackupSchedulerNative): boolean {
  return native !== backupScheduler || Capacitor.getPlatform() === "android";
}

/** Friendly text for a failed automatic backup (native reason codes). */
export function autoBackupFailureText(
  reason: string | null | undefined,
): string {
  switch (reason) {
    case "no-snapshot":
      return "No backup snapshot yet — open the app once";
    case "local-write-failed":
      return "Could not write to the AurumBackup folder — storage check karen";
    case "permission-revoked":
      return "Drive permission lost — pick the folder again";
    case "folder-missing":
      return "Drive folder is gone — pick a folder again";
    case "could-not-create":
      return "Drive could not create the backup file";
    case "could-not-replace":
      return "Drive could not replace the old backup file";
    case "write-failed":
      return "Drive write failed";
    case "not-connected":
      return "Drive folder not connected — phone-only backup";
    default:
      return reason ? reason : "Automatic backup failed";
  }
}

export type SnapshotWriter = (path: string, json: string) => Promise<void>;

async function defaultSnapshotWriter(
  path: string,
  json: string,
): Promise<void> {
  const { Filesystem, Directory, Encoding } = await import(
    "@capacitor/filesystem"
  );
  await Filesystem.writeFile({
    path,
    data: json,
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    recursive: true,
  });
}

/** Last workspace snapshot written this session — unchanged data is
 * not re-written. (Compared on the workspace data, not the file:
 * the file embeds createdAt, which changes on every build.) */
let lastSnapshotDataJson = "";

/** Test hook: forget the cached snapshot so the next prepare rewrites it. */
export function __resetSnapshotCacheForTests(): void {
  lastSnapshotDataJson = "";
}

function parseCounts(json: string): BackupCounts {
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object") {
      const c = parsed as Partial<BackupCounts>;
      return {
        products: c.products ?? 0,
        customers: c.customers ?? 0,
        rates: c.rates ?? 0,
        invoices: c.invoices ?? 0,
        drafts: c.drafts ?? 0,
        loans: c.loans ?? 0,
      };
    }
  } catch {
    // Corrupt counts — the run still counts as a backup, with zeros.
  }
  return {
    products: 0,
    customers: 0,
    rates: 0,
    invoices: 0,
    drafts: 0,
    loans: 0,
  };
}

/** The native status, normalised. Null on web or when unavailable. */
export async function loadAutoBackupStatus(
  native: BackupSchedulerNative = backupScheduler,
): Promise<AutoBackupStatus | null> {
  if (!nativeUsable(native)) return null;
  try {
    const s = await native.getStatus();
    const lastStatus: AutoBackupStatus["lastStatus"] =
      s.lastStatus === "success" ||
      s.lastStatus === "partial" ||
      s.lastStatus === "failed" ||
      s.lastStatus === "no-snapshot"
        ? s.lastStatus
        : null;
    return {
      enabled: s.enabled === true,
      mode:
        s.mode === "exact"
          ? "exact"
          : s.mode === "periodic"
            ? "periodic"
            : null,
      exactAllowed: s.exactAllowed === true,
      lastRunAt: s.lastRunAt || null,
      lastStatus,
      lastFilename: s.lastFilename || null,
      lastShopName: s.lastShopName || null,
      lastCountsJson: s.lastCountsJson || "",
      driveOk: s.driveOk === true,
      lastError: s.lastError || null,
    };
  } catch {
    return null;
  }
}

/**
 * Sync a native 02:00 run into localStorage (last-backup date +
 * history), so the Dashboard reminder clears. Only runs that
 * actually wrote the local file count ("success" / "partial"); a
 * failed run or a skipped run changes nothing. Returns true when a
 * run was recorded.
 */
export function syncAutoBackupRun(
  status: AutoBackupStatus,
  store?: PrefsStore,
): boolean {
  if (
    status.lastStatus !== "success" &&
    status.lastStatus !== "partial"
  )
    return false;
  if (!status.lastRunAt) return false;
  const last = loadLastBackupAt(store);
  if (last && last >= status.lastRunAt) return false;
  const run: AutoBackupRun = {
    createdAt: status.lastRunAt,
    filename:
      status.lastFilename ??
      backupFilename(
        status.lastShopName ?? "Aurum",
        new Date(status.lastRunAt),
      ),
    shopName: status.lastShopName ?? "Aurum",
    counts: parseCounts(status.lastCountsJson),
  };
  recordBackupRun(run, store);
  return true;
}

export type PrepareAutoBackupResult =
  | {
      prepared: false;
      reason: "disabled" | "unsupported" | "failed";
    }
  | {
      prepared: true;
      snapshotWritten: boolean;
      mode: AutoBackupMode;
      exactAllowed: boolean;
      /** True when a native run was synced into localStorage. */
      synced: boolean;
    };

/**
 * Hand a fresh snapshot to the native 02:00 scheduler. Best-effort —
 * never throws, never breaks the app open flow. Call on every app
 * open (and after data changes) so the 02:00 worker always has
 * yesterday's data at worst, and so a lost native schedule is
 * re-armed without the shopkeeper doing anything.
 */
export async function prepareAutoBackup(
  data: Workspace,
  native: BackupSchedulerNative = backupScheduler,
  prefsStore?: PrefsStore,
  cloudStore: CloudStore = localCloudStore,
  writeSnapshot: SnapshotWriter = defaultSnapshotWriter,
): Promise<PrepareAutoBackupResult> {
  if (!loadBackupPreferences(prefsStore).autoBackup)
    return { prepared: false, reason: "disabled" };
  if (!nativeUsable(native)) return { prepared: false, reason: "unsupported" };
  try {
    // 1. Fresh snapshot for the 02:00 worker (skip when the data is
    // unchanged — the file embeds createdAt, so the comparison is on
    // the workspace data, not the file text).
    const dataJson = stableJson(data);
    let snapshotWritten = false;
    if (dataJson !== lastSnapshotDataJson) {
      const file = await createBackup(data);
      await writeSnapshot(
        AUTO_BACKUP_SNAPSHOT_PATH,
        backupToJson(file),
      );
      lastSnapshotDataJson = dataJson;
      snapshotWritten = true;
    }
    // 2. Sync the native last-run into localStorage (native cannot
    // write WebView localStorage itself).
    const status = await loadAutoBackupStatus(native);
    let synced = false;
    if (status) synced = syncAutoBackupRun(status, prefsStore);
    // 3. Self-heal: if native lost the schedule, re-arm it (and hand
    // it the current Drive folder, which native cannot read itself).
    let mode: AutoBackupMode = status?.mode ?? "periodic";
    let exactAllowed = status?.exactAllowed ?? false;
    if (status && !status.enabled) {
      const folder = loadCloudFolder(cloudStore);
      const res = await native.scheduleBackup({
        driveFolderUri: folder?.uri ?? "",
      });
      mode = res.mode === "exact" ? "exact" : "periodic";
      exactAllowed = res.exactAllowed;
    }
    return {
      prepared: true,
      snapshotWritten,
      mode,
      exactAllowed,
      synced,
    };
  } catch {
    return { prepared: false, reason: "failed" };
  }
}

/** Schedule the 02:00 trigger (Settings toggle ON). Returns null when unavailable. */
export async function scheduleAutoBackup(
  native: BackupSchedulerNative = backupScheduler,
  cloudStore: CloudStore = localCloudStore,
): Promise<{
  scheduled: boolean;
  mode: AutoBackupMode;
  exactAllowed: boolean;
} | null> {
  if (!nativeUsable(native)) return null;
  try {
    const folder = loadCloudFolder(cloudStore);
    const res = await native.scheduleBackup({
      driveFolderUri: folder?.uri ?? "",
    });
    return {
      scheduled: res.scheduled,
      mode: res.mode === "exact" ? "exact" : "periodic",
      exactAllowed: res.exactAllowed,
    };
  } catch {
    return null;
  }
}

/** Stop the 02:00 trigger (Settings toggle OFF). */
export async function cancelAutoBackup(
  native: BackupSchedulerNative = backupScheduler,
): Promise<void> {
  if (!nativeUsable(native)) return;
  try {
    await native.cancelBackup();
  } catch {
    // Already stopped — the toggle is off either way.
  }
}

/** Run the backup worker right now (Settings → "Test now"). */
export async function runAutoBackupNow(
  native: BackupSchedulerNative = backupScheduler,
  cloudStore: CloudStore = localCloudStore,
): Promise<boolean> {
  if (!nativeUsable(native)) return false;
  try {
    const folder = loadCloudFolder(cloudStore);
    const res = await native.runNow({ driveFolderUri: folder?.uri ?? "" });
    return res.started === true;
  } catch {
    return false;
  }
}

/** Open this app's "Alarms & reminders" screen (Android 12+) so exact alarms can be allowed. */
export async function openAutoBackupAlarmSettings(
  native: BackupSchedulerNative = backupScheduler,
): Promise<void> {
  if (!nativeUsable(native)) return;
  try {
    await native.openExactAlarmSettings();
  } catch {
    // Settings screen unavailable — the hint stays on screen.
  }
}
