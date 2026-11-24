package com.aurum.jewellery;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Exact alarms do not survive a reboot — re-arm the 02:00 AM trigger
 * after boot. (WorkManager periodic work survives reboots on its own;
 * this only matters for the exact-alarm mode.)
 */
public class BackupBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            BackupScheduler.reschedule(context);
        }
    }
}
