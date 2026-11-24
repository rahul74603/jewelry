package com.aurum.jewellery;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.work.BackoffPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.TimeUnit;

/**
 * Automatic daily backup at 02:00 AM (Asia/Kolkata).
 *
 * Mirrors SmsReminderPlugin (10:00 AM SMS): the JS side hands the
 * connected Drive folder URI to scheduleBackup() — native cannot
 * read WebView localStorage, where the folder URI lives — and the
 * native side stores it in AutoBackupStore, where the 02:00 worker
 * reads it. The snapshot itself is written by the JS side to the
 * app files dir on every app open (see src/lib/autoBackup.ts).
 *
 * No runtime permission is needed for the backup itself (MediaStore
 * for the app's own files, SAF for the Drive folder the shopkeeper
 * already picked). The only permission is the exact-alarm one
 * (Android 12+), granted in system Settings → "Alarms & reminders"
 * — without it the 02:00 trigger falls back to WorkManager periodic
 * work, which is best-effort ("around 2 AM").
 */
@CapacitorPlugin(name = "BackupScheduler")
public class BackupSchedulerPlugin extends Plugin {

    @PluginMethod
    public void scheduleBackup(PluginCall call) {
        String driveUri = call.getString("driveFolderUri", "");
        AutoBackupStore.setEnabled(getContext(), true);
        AutoBackupStore.setDriveFolderUri(
            getContext(), driveUri == null ? "" : driveUri);
        BackupScheduler.reschedule(getContext());
        JSObject out = new JSObject();
        out.put("scheduled", true);
        out.put("mode", AutoBackupStore.mode(getContext()));
        out.put("exactAllowed", BackupScheduler.exactAllowed(getContext()));
        call.resolve(out);
    }

    @PluginMethod
    public void cancelBackup(PluginCall call) {
        AutoBackupStore.setEnabled(getContext(), false);
        BackupScheduler.cancelAll(getContext());
        JSObject out = new JSObject();
        out.put("cancelled", true);
        call.resolve(out);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject out = new JSObject();
        out.put("enabled", AutoBackupStore.isEnabled(getContext()));
        out.put("mode", AutoBackupStore.mode(getContext()));
        out.put("exactAllowed", BackupScheduler.exactAllowed(getContext()));
        out.put("lastRunAt", AutoBackupStore.lastRunAt(getContext()));
        out.put("lastStatus", AutoBackupStore.lastStatus(getContext()));
        out.put("lastFilename", AutoBackupStore.lastFilename(getContext()));
        out.put("lastShopName", AutoBackupStore.lastShopName(getContext()));
        out.put("lastCountsJson", AutoBackupStore.lastCountsJson(getContext()));
        out.put("driveOk", AutoBackupStore.driveOk(getContext()));
        out.put("lastError", AutoBackupStore.lastError(getContext()));
        call.resolve(out);
    }

    /** Immediate worker run (Settings → "Test now"). The toggle must be on. */
    @PluginMethod
    public void runNow(PluginCall call) {
        String driveUri = call.getString("driveFolderUri", "");
        if (driveUri != null && !driveUri.isEmpty()) {
            AutoBackupStore.setDriveFolderUri(getContext(), driveUri);
        }
        OneTimeWorkRequest req = new OneTimeWorkRequest.Builder(BackupWorker.class)
            .setBackoffCriteria(BackoffPolicy.LINEAR, 30, TimeUnit.MINUTES)
            .build();
        WorkManager.getInstance(getContext()).enqueueUniqueWork(
            AutoBackupStore.NOW_WORK, ExistingWorkPolicy.REPLACE, req);
        JSObject out = new JSObject();
        out.put("started", true);
        call.resolve(out);
    }

    /** Open this app's "Alarms & reminders" screen (Android 12+) so exact alarms can be allowed. */
    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                Intent intent = new Intent(
                    Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("settings-unavailable");
        }
    }
}
