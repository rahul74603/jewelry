package com.aurum.jewellery;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Sends the stored due reminders by SMS at 10:00 AM.
 *
 * Retry / catch-up rules (confirmed with the shopkeeper, Nov 2026):
 *
 * - A record is marked sent for today ONLY after the radio confirms
 *   the SMS went out (the sent-log entry flips to "sent"). A failed
 *   send never marks it — the record stays unsent and is tried again.
 * - A transient failure (no signal, radio off, a send that threw, or
 *   a send whose result never came back) makes the worker return
 *   Result.retry(), so WorkManager tries again later the same day
 *   (linear backoff, 30 minutes). A permanent failure (bad number)
 *   does not retry — retrying it helps nobody.
 * - Anything still unsent is picked up by the next day's 10:00 run:
 *   the record stays due/overdue until it is paid, and the stored
 *   payload is sent whenever the worker runs — it is refreshed on
 *   every app open, so in normal use it is never more than a day old.
 *   The amounts in a days-old payload can lag a little behind (a
 *   month boundary may have passed), but the reminder is never lost
 *   — and a payment can only be recorded by opening the app, which
 *   refreshes the payload, so a paid record is never messaged twice.
 * - The worker never crashes the schedule: any unexpected exception
 *   returns success, so tomorrow's 10:00 run still happens.
 */
public class ReminderWorker extends Worker {
    /** How long to wait for the radio's sent-result per SMS. */
    private static final long RESULT_WAIT_MS = 60_000;
    private static final long RESULT_POLL_MS = 500;

    public ReminderWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        try {
            if (!SmsReminderStore.isEnabled(context)) return Result.success();
            SmsReminderStore.failStaleSending(context);
            if (!SmsSender.hasSmsPermission(context)) {
                // Permission revoked after enabling — no attempt is
                // made, and no retry loop either: retrying cannot fix
                // a missing permission. Settings shows the state.
                return Result.success();
            }
            boolean transientFailure = false;
            JSONArray items = SmsReminderStore.items(context);
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.optJSONObject(i);
                if (item == null) continue;
                String loanId = item.optString("loanId", "");
                String phone = item.optString("phone", "");
                String message = item.optString("message", "");
                if (loanId.isEmpty() || phone.isEmpty() || message.isEmpty()) continue;
                if (SmsReminderStore.sentToday(context, loanId)) continue;
                if (SmsReminderStore.hasPermanentFailureToday(context, loanId)) continue;
                String sendId = SmsSender.send(
                    context, loanId, item.optString("customerName", ""), phone, message);
                if (sendId.isEmpty()) {
                    // Could not hand off to the radio at all — the log
                    // already holds the failed entry. Retry later;
                    // do NOT mark sent.
                    transientFailure = true;
                    continue;
                }
                String outcome = waitForResult(context, sendId);
                if ("sent".equals(outcome)) {
                    SmsReminderStore.markSentToday(context, loanId);
                } else if ("failed".equals(outcome)) {
                    String reason = SmsReminderStore.logReason(context, sendId);
                    if (SmsReminderStore.isTransientReason(reason)) {
                        transientFailure = true;
                    }
                    // Do NOT mark sent — the retry below (and
                    // tomorrow's 10:00 run) picks this record up.
                } else {
                    // No result in 60s — treat as failed, not sent.
                    // The SMS may still go out late; the small
                    // duplicate risk beats losing the reminder.
                    SmsReminderStore.updateLogEntry(
                        context, sendId, "failed", "unknown");
                    transientFailure = true;
                }
            }
            return transientFailure ? Result.retry() : Result.success();
        } catch (Exception e) {
            return Result.success();
        }
    }

    /**
     * Wait until the sent-log entry for this send leaves "sending".
     * Returns "sent", "failed", or "unknown" (timed out).
     */
    private String waitForResult(Context context, String sendId) {
        long deadline = System.currentTimeMillis() + RESULT_WAIT_MS;
        while (System.currentTimeMillis() < deadline) {
            String status = SmsReminderStore.logStatus(context, sendId);
            if ("sent".equals(status) || "failed".equals(status)) return status;
            try {
                Thread.sleep(RESULT_POLL_MS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return "unknown";
            }
        }
        return "unknown";
    }
}
