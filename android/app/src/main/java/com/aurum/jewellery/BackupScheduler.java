package com.aurum.jewellery;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.work.BackoffPolicy;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import java.util.concurrent.TimeUnit;

/**
 * Chooses how the 02:00 AM backup is triggered — the most reliable
 * mechanism the phone allows. Same pattern as SmsReminderScheduler
 * (10:00 AM SMS), with the hour changed.
 *
 * Primary: an exact alarm (AlarmManager setExactAndAllowWhileIdle) at
 * 02:00 AM Asia/Kolkata. It fires at 02:00 even in Doze, which
 * WorkManager cannot promise. It needs the SCHEDULE_EXACT_ALARM
 * permission (Android 12+); the shopkeeper grants it in system
 * Settings → "Alarms & reminders".
 *
 * Fallback: when exact alarms are not allowed, WorkManager periodic
 * work (24h, initial delay to the next 02:00). That is best-effort —
 * Doze and battery saving can shift it by hours, so the Settings
 * screen says "around 2 AM", never "sharp at 2:00".
 *
 * Either way the trigger only starts the worker; the worker itself
 * copies the stored snapshot to the phone. Exact alarms
 * do not survive a reboot, so BackupBootReceiver re-arms them.
 */
public final class BackupScheduler {
    private BackupScheduler() {}

    /** True when this phone lets the app schedule exact alarms (Android 12+ gate). */
    public static boolean exactAllowed(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        return am != null && am.canScheduleExactAlarms();
    }

    /** (Re)arm the 02:00 AM trigger for the enabled state. No-op when auto-backup is off. */
    public static void reschedule(Context context) {
        if (!AutoBackupStore.isEnabled(context)) return;
        if (exactAllowed(context)) {
            WorkManager.getInstance(context)
                .cancelUniqueWork(AutoBackupStore.PERIODIC_WORK);
            if (scheduleExactAlarm(context)) {
                AutoBackupStore.setMode(context, "exact");
            }
            // scheduleExactAlarm falls back to periodic itself (and
            // sets the mode) when the permission was revoked between
            // the check and the call.
        } else {
            cancelExactAlarm(context);
            enqueuePeriodic(context);
            AutoBackupStore.setMode(context, "periodic");
        }
    }

    /** Stop every trigger (toggle off). */
    public static void cancelAll(Context context) {
        cancelExactAlarm(context);
        WorkManager.getInstance(context)
            .cancelUniqueWork(AutoBackupStore.PERIODIC_WORK);
        AutoBackupStore.setMode(context, "");
    }

    /**
     * Schedule the next 02:00 AM exact alarm. Returns true when the
     * alarm was set; false when the permission vanished mid-call, in
     * which case the periodic fallback is armed instead.
     */
    static boolean scheduleExactAlarm(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) {
            enqueuePeriodic(context);
            AutoBackupStore.setMode(context, "periodic");
            return false;
        }
        PendingIntent pi = alarmPendingIntent(context);
        long triggerAt =
            System.currentTimeMillis() + AutoBackupStore.millisUntilNextTwoAm();
        try {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            return true;
        } catch (SecurityException e) {
            enqueuePeriodic(context);
            AutoBackupStore.setMode(context, "periodic");
            return false;
        }
    }

    static void cancelExactAlarm(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(alarmPendingIntent(context));
    }

    private static void enqueuePeriodic(Context context) {
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(
                BackupWorker.class, 24, TimeUnit.HOURS)
            .setInitialDelay(
                AutoBackupStore.millisUntilNextTwoAm(), TimeUnit.MILLISECONDS)
            .setBackoffCriteria(BackoffPolicy.LINEAR, 30, TimeUnit.MINUTES)
            .build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            AutoBackupStore.PERIODIC_WORK, ExistingPeriodicWorkPolicy.KEEP, req);
    }

    private static PendingIntent alarmPendingIntent(Context context) {
        Intent intent = new Intent(context, BackupAlarmReceiver.class);
        intent.setAction(AutoBackupStore.ACTION_BACKUP_ALARM);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getBroadcast(context, 0, intent, flags);
    }
}
