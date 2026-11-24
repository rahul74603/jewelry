package com.aurum.jewellery;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.MediaStore;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONObject;

/**
 * Copies the stored backup snapshot to the phone and Google Drive
 * at 02:00 AM.
 *
 * The snapshot is the full checksummed backup file the TS side
 * wrote on the last app open (app files dir /
 * auto-backup/snapshot.json) — the worker copies it verbatim, so
 * the file it writes is byte-identical to a manual "Backup now".
 * The yearly filename comes from the snapshot itself (shop name +
 * creation year), with the same slug rules as backupFilename() in
 * src/lib/backup.ts.
 *
 * Outcome rules (the local copy is the safety net):
 *
 * - No snapshot yet → skip quietly (success, no retry, no spam).
 *   The app simply hasn't been opened since auto-backup was
 *   enabled; the next app open writes the snapshot.
 * - No Drive folder → phone-only is fine, not an error ("partial"
 *   only when a Drive folder exists and its write failed).
 * - Local write failed → the run failed; a transient failure
 *   retries later the same day (max 3 attempts).
 * - Drive write failed → the local copy is still safe; a transient
 *   failure retries later the same day (max 3), a permanent one
 *   (permission revoked, folder gone) does not — Settings shows the
 *   reason in the morning.
 * - The worker never crashes the schedule: any unexpected exception
 *   records a failure and returns success, so tomorrow's 02:00 run
 *   still happens.
 */
public class BackupWorker extends Worker {

    public BackupWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        try {
            if (!AutoBackupStore.isEnabled(context)) return Result.success();
            File snapshot = new File(context.getFilesDir(), AutoBackupStore.SNAPSHOT_PATH);
            if (!snapshot.exists()) {
                AutoBackupStore.setLastRun(context, "no-snapshot", nowIso(),
                    "", "", "", false, "no-snapshot");
                return Result.success();
            }
            byte[] bytes = readBytes(snapshot);
            JSONObject root = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
            String shopName = root.optString("shopName", "Aurum");
            String createdAt = root.optString("createdAt", nowIso());
            String countsJson = root.optJSONObject("counts") == null
                ? ""
                : root.optJSONObject("counts").toString();
            String filename = yearlyFilename(shopName, createdAt);

            String localError = "";
            boolean localOk = true;
            try {
                writeLocalCopy(context, filename, bytes);
            } catch (Exception e) {
                localOk = false;
                localError = "local-write-failed";
            }

            String driveUri = AutoBackupStore.driveFolderUri(context);
            boolean driveOk = false;
            String driveError = "";
            if (driveUri == null || driveUri.isEmpty()) {
                driveError = "not-connected";
            } else {
                String result = DriveBackup.writeToDriveFolder(
                    context, driveUri, filename, bytes);
                if ("ok".equals(result)) {
                    driveOk = true;
                } else {
                    driveError = result;
                }
            }

            String status;
            String error;
            if (!localOk) {
                status = "failed";
                error = localError;
            } else if (!driveUri.isEmpty() && !driveOk) {
                status = "partial";
                error = driveError;
            } else {
                status = "success";
                error = "";
            }
            AutoBackupStore.setLastRun(context, status, nowIso(), filename,
                shopName, countsJson, driveOk, error);

            // Transient failure → retry later the same day (max 3).
            // A missing Drive folder or a revoked permission never
            // retries: retrying cannot fix those.
            String retryError = !localOk ? localError : driveError;
            if (!"success".equals(status)
                    && AutoBackupStore.isTransientError(retryError)
                    && AutoBackupStore.noteRetry(context)) {
                return Result.retry();
            }
            return Result.success();
        } catch (Exception e) {
            try {
                AutoBackupStore.setLastRun(getApplicationContext(), "failed",
                    nowIso(), "", "", "", false, "write-failed");
            } catch (Exception ignored) {
            }
            return Result.success();
        }
    }

    private static String nowIso() {
        SimpleDateFormat f = new SimpleDateFormat(
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date());
    }

    private static byte[] readBytes(File file) throws IOException {
        try (FileInputStream in = new FileInputStream(file);
             ByteArrayOutputStream buf = new ByteArrayOutputStream()) {
            byte[] chunk = new byte[8192];
            int n;
            while ((n = in.read(chunk)) != -1) buf.write(chunk, 0, n);
            return buf.toByteArray();
        }
    }

    /**
     * Same yearly filename as backupFilename() in src/lib/backup.ts:
     * `aurum-backup-<shop>-<YYYY>.json`, slug lowercased, runs of
     * non-alphanumerics collapsed to one dash, edge dashes trimmed,
     * capped at 40 chars, year from the snapshot's creation date.
     */
    static String yearlyFilename(String shopName, String createdAt) {
        String slug = shopName == null ? "" : shopName.toLowerCase(Locale.US);
        slug = slug.replaceAll("[^a-z0-9]+", "-").replaceAll("^-+|-+$", "");
        if (slug.length() > 40) slug = slug.substring(0, 40);
        if (slug.isEmpty()) slug = "aurum";
        int year = yearOf(createdAt);
        return "aurum-backup-" + slug + "-" + year + ".json";
    }

    /** Year (Asia/Kolkata) of an ISO date, or the current year. */
    static int yearOf(String iso) {
        try {
            if (iso != null && iso.length() >= 4) {
                return Integer.parseInt(iso.substring(0, 4));
            }
        } catch (NumberFormatException ignored) {
        }
        java.util.Calendar cal = java.util.Calendar.getInstance(
            TimeZone.getTimeZone("Asia/Kolkata"));
        return cal.get(java.util.Calendar.YEAR);
    }

    /**
     * Write the yearly file to Documents/AurumBackup via MediaStore
     * (same folder the manual backup writes to). An existing file
     * with the same name is overwritten in place — never duplicated.
     */
    private static void writeLocalCopy(
            Context context, String filename, byte[] bytes) throws IOException {
        ContentResolver resolver = context.getContentResolver();
        Uri collection =
            MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        Uri target = findLocalCopy(resolver, collection, filename);
        if (target == null) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, filename);
            values.put(MediaStore.MediaColumns.MIME_TYPE, "application/json");
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, "Documents/AurumBackup");
            target = resolver.insert(collection, values);
            if (target == null) throw new IOException("MediaStore insert failed");
        }
        try (OutputStream out = resolver.openOutputStream(target, "wt")) {
            if (out == null) throw new IOException("Cannot open local backup file");
            out.write(bytes);
        }
    }

    /** The app's own file with this name in Documents/AurumBackup, or null. */
    private static Uri findLocalCopy(
            ContentResolver resolver, Uri collection, String filename) {
        String[] projection = {
            MediaStore.MediaColumns._ID,
            MediaStore.MediaColumns.RELATIVE_PATH
        };
        try (Cursor c = resolver.query(collection, projection,
                MediaStore.MediaColumns.DISPLAY_NAME + " = ?",
                new String[]{filename}, null)) {
            if (c == null) return null;
            while (c.moveToNext()) {
                String rel = c.getString(1);
                if ("Documents/AurumBackup/".equals(rel)
                        || "Documents/AurumBackup".equals(rel)) {
                    return ContentUris.withAppendedId(collection, c.getLong(0));
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }
}
