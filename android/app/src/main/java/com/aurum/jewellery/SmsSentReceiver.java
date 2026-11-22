package com.aurum.jewellery;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.telephony.SmsManager;

/**
 * Receives the per-part sent result of an automatic SMS and turns it
 * into the sent-log entry's final state.
 *
 * One failed part fails the whole send (a half-delivered reminder is
 * worse than a retried one — the worker re-sends the full message).
 * This receiver only updates the log; the worker decides "sent for
 * today" by reading the log, so a result that arrives after the
 * worker finished still lands in the right place.
 */
public class SmsSentReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!SmsReminderStore.ACTION_SMS_SENT.equals(intent.getAction())) return;
        String sendId = intent.getStringExtra("sendId");
        if (sendId == null || sendId.isEmpty()) return;
        int result = getResultCode();
        if (result != Activity.RESULT_OK) {
            String reason;
            switch (result) {
                case SmsManager.RESULT_ERROR_NO_SERVICE:
                    reason = "no-service";
                    break;
                case SmsManager.RESULT_ERROR_NULL_PDU:
                    reason = "null-pdu";
                    break;
                case SmsManager.RESULT_ERROR_RADIO_OFF:
                    reason = "radio-off";
                    break;
                default:
                    reason = "generic-failure";
            }
            SmsReminderStore.updateLogEntry(context, sendId, "failed", reason);
            return;
        }
        if (SmsReminderStore.notePartOk(context, sendId)) {
            SmsReminderStore.updateLogEntry(context, sendId, "sent", null);
        }
    }
}
