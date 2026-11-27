package com.aurum.jewellery;

import android.content.Context;
import android.content.SharedPreferences;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Shared storage for the automatic nightly backup (02:00 AM).
 *
 * Mirrors SmsReminderStore: the workspace lives in the app's JS
 * store, which a native worker cannot read. So the JS side builds
 * the full checksummed backup file on every app open and saves it
 * as a snapshot the worker can read (app files dir /
 * auto-backup/snapshot.json).
 *
 * The worker records each run's result here (lastRunAt, status,
 * filename, last error); the TS side syncs that into
 * localStorage on the next app open so the Dashboard backup
 * reminder clears.
 *
 * Retry rule: a failed run retries later the same day, at most 3
 * times (transient failures only). A missing snapshot skips
 * quietly: the app simply hasn't been opened since enabling.
 */
public final class AutoBackupStore {
    public static final String PREFS = "aurum_auto_backup";
    /** Broadcast action for the daily 02:00 AM alarm. */
    public static final String ACTION_BACKUP_ALARM =
        "com.aurum.jewellery.AUTO_BACKUP_ALARM";
    public static final String PERIODIC_WORK = "aurum-auto-backup";
    public static final String NOW_WORK = "aurum-auto-backup-now";
    /** Daily target hour (Asia/Kolkata): 02:00 AM. */
    public static final int TARGET_HOUR = 2;
    /** Snapshot path under Context.getFilesDir(). */
    public static final String SNAPSHOT_PATH = "auto-backup/snapshot.json";
    private static final int MAX_RETRIES_PER_DAY = 3;

    private AutoBackupStore() {}

    public static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Today as YYYY-MM-DD in the shop's timezone (matches loans.ts todayDay()). */
    public static String todayKolkatta() {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("Asia/Kolkata"));
        return f.format(new Date());
    }

    /** Milliseconds until the next 02:00 AM (Asia/Kolkata). */
    public static long millisUntilNextTwoAm() {
        TimeZone tz = TimeZone.getTimeZone("Asia/Kolkata");
        Calendar cal = Calendar.getInstance(tz);
        cal.set(Calendar.HOUR_OF_DAY, TARGET_HOUR);
        cal.set(Calendar.MINUTE, 0);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        if (cal.getTimeInMillis() <= System.currentTimeMillis()) {
            cal.add(Calendar.DAY_OF_YEAR, 1);
        }
        return cal.getTimeInMillis() - System.currentTimeMillis();
    }

    public static boolean isEnabled(Context context) {
        return prefs(context).getBoolean("enabled", false);
    }

    public static void setEnabled(Context context, boolean enabled) {
        prefs(context).edit().putBoolean("enabled", enabled).apply();
    }

    /** "exact" (02:00 alarm) or "periodic" (WorkManager fallback), "" when never scheduled. */
    public static String mode(Context context) {
        return prefs(context).getString("mode", "");
    }

    public static void setMode(Context context, String mode) {
        prefs(context).edit().putString("mode", mode).apply();
    }

    public static String lastRunAt(Context context) {
        return prefs(context).getString("last_run_at", "");
    }

    /** "success" | "failed" | "no-snapshot", "" when never run. */
    public static String lastStatus(Context context) {
        return prefs(context).getString("last_status", "");
    }

    public static String lastFilename(Context context) {
        return prefs(context).getString("last_filename", "");
    }

    public static String lastShopName(Context context) {
        return prefs(context).getString("last_shop_name", "");
    }

    /** Counts from the snapshot the worker wrote, as JSON ("" when unknown). */
    public static String lastCountsJson(Context context) {
        return prefs(context).getString("last_counts_json", "");
    }

    /** Reason code of the last failure ("" when the last run succeeded). */
    public static String lastError(Context context) {
        return prefs(context).getString("last_error", "");
    }

    /** Record one run's outcome. A success clears the retry count for the day. */
    public static void setLastRun(
            Context context,
            String status,
            String runAt,
            String filename,
            String shopName,
            String countsJson,
            String error) {
        SharedPreferences.Editor e = prefs(context).edit();
        e.putString("last_status", status);
        e.putString("last_run_at", runAt);
        e.putString("last_filename", filename == null ? "" : filename);
        e.putString("last_shop_name", shopName == null ? "" : shopName);
        e.putString("last_counts_json", countsJson == null ? "" : countsJson);
        e.putString("last_error", error == null ? "" : error);
        if ("success".equals(status)) {
            e.remove("retries_day");
            e.remove("retries_count");
        }
        e.apply();
    }

    /**
     * Count one retry for today. Returns true when another retry is
     * still allowed (max 3 per day) — false means give up until
     * tomorrow's 02:00 run.
     */
    public static boolean noteRetry(Context context) {
        SharedPreferences p = prefs(context);
        String today = todayKolkatta();
        int count = today.equals(p.getString("retries_day", ""))
            ? p.getInt("retries_count", 0)
            : 0;
        if (count >= MAX_RETRIES_PER_DAY) return false;
        p.edit()
            .putString("retries_day", today)
            .putInt("retries_count", count + 1)
            .apply();
        return true;
    }

    /** True for failures worth retrying later the same day. */
    public static boolean isTransientError(String error) {
        return "local-write-failed".equals(error)
            || "write-failed".equals(error);
    }
}
