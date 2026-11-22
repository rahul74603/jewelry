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
 * Fires at 10:00 AM from the exact alarm: re-arm tomorrow's alarm
 * first (so a crash later cannot lose the next day), then start the
 * worker, which sends the stored reminders and retries transient
 * failures later the same day.
 */
public class SmsAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!SmsReminderStore.ACTION_REMINDER_ALARM.equals(intent.getAction())) return;
        SmsReminderScheduler.reschedule(context);
        OneTimeWorkRequest req = new OneTimeWorkRequest.Builder(ReminderWorker.class)
            .setBackoffCriteria(BackoffPolicy.LINEAR, 30, TimeUnit.MINUTES)
            .build();
        WorkManager.getInstance(context).enqueueUniqueWork(
            SmsReminderStore.NOW_WORK, ExistingWorkPolicy.REPLACE, req);
    }
}
