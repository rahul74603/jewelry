package com.aurum.jewellery;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.work.BackoffPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import java.util.concurrent.TimeUnit;

/**
 * Fires at 02:00 AM from the exact alarm: re-arm tomorrow's alarm
 * first (so a crash later cannot lose the next day), then start the
 * worker, which copies the stored snapshot to the phone.
 */
public class BackupAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!AutoBackupStore.ACTION_BACKUP_ALARM.equals(intent.getAction())) return;
        BackupScheduler.reschedule(context);
        OneTimeWorkRequest req = new OneTimeWorkRequest.Builder(BackupWorker.class)
            .setBackoffCriteria(BackoffPolicy.LINEAR, 30, TimeUnit.MINUTES)
            .build();
        WorkManager.getInstance(context).enqueueUniqueWork(
            AutoBackupStore.NOW_WORK, ExistingWorkPolicy.REPLACE, req);
    }
}
