package com.aurum.jewellery;

import android.content.Context;
import android.content.SharedPreferences;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Shared storage for the automatic SMS reminders (10:00 AM daily).
 *
 * The loans live in the app's JS store, which a native worker cannot
 * read. So the JS side computes the due reminders on every app open
 * and hands the payload — record id, customer phone, message text —
 * to the native plugin, which stores it here in SharedPreferences.
 * The native trigger (exact alarm at 10:00, or WorkManager periodic
 * work as a fallback) reads the payload and sends each SMS.
 *
 * Retry / catch-up rules (confirmed with the shopkeeper, Nov 2026):
 * a failed send never marks the record sent for the day — the
 * per-day mark (`sent_day_<loanId>`) is set only after the radio
 * confirms the SMS went out. Failed attempts stay in the log as
 * failed with retry pending, the worker returns Result.retry() on a
 * transient failure (no signal, radio off) so it tries again later
 * the same day, and anything still unsent is picked up by the next
 * day's 10:00 run — the record stays due until it is paid, so
 * reminders repeat daily, never monthly.
 */
public final class SmsReminderStore {
    public static final String PREFS = "aurum_sms_reminders";
    /** Broadcast action for the per-part SMS sent result. */
    public static final String ACTION_SMS_SENT = "com.aurum.jewellery.SMS_SENT";
    /** Broadcast action for the daily 10:00 AM alarm. */
    public static final String ACTION_REMINDER_ALARM =
        "com.aurum.jewellery.SMS_REMINDER_ALARM";
    public static final String PERIODIC_WORK = "aurum-sms-reminders";
    public static final String NOW_WORK = "aurum-sms-reminder-now";
    /** Daily target hour (Asia/Kolkata): 10:00 AM. */
    public static final int TARGET_HOUR = 10;
    public static final int MAX_LOG = 50;

    private SmsReminderStore() {}

    public static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Today as YYYY-MM-DD in the shop's timezone (matches loans.ts todayDay()). */
    public static String todayKolkatta() {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("Asia/Kolkata"));
        return f.format(new Date());
    }

    /** Milliseconds until the next 10:00 AM (Asia/Kolkata). */
    public static long millisUntilNextTenAm() {
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

    /** "exact" (10:00 alarm) or "periodic" (WorkManager fallback), "" when never scheduled. */
    public static String mode(Context context) {
        return prefs(context).getString("mode", "");
    }

    public static void setMode(Context context, String mode) {
        prefs(context).edit().putString("mode", mode).apply();
    }

    public static String preparedDay(Context context) {
        return prefs(context).getString("prepared_day", "");
    }

    /** Stored reminder payload: JSON array of {loanId, customerName, phone, message, dueDay}. */
    public static JSONArray items(Context context) {
        try {
            String raw = prefs(context).getString("items_json", "[]");
            return new JSONArray(raw == null || raw.isEmpty() ? "[]" : raw);
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    public static void saveItems(Context context, String itemsJson, String preparedDay) {
        prefs(context).edit()
            .putString("items_json", itemsJson)
            .putString("prepared_day", preparedDay)
            .apply();
    }

    public static void clearItems(Context context) {
        prefs(context).edit().remove("items_json").remove("prepared_day").apply();
    }

    /** True when this record already got a confirmed SMS today. */
    public static boolean sentToday(Context context, String loanId) {
        return todayKolkatta().equals(prefs(context).getString("sent_day_" + loanId, ""));
    }

    /**
     * Mark a record sent for today. Call ONLY after the radio confirmed
     * the SMS went out — never on a failure (see the class comment).
     * Also clears "retry pending" on today's failed attempts for the
     * same record, since the retry has now succeeded.
     */
    public static void markSentToday(Context context, String loanId) {
        String today = todayKolkatta();
        prefs(context).edit().putString("sent_day_" + loanId, today).apply();
        JSONArray log = log(context);
        boolean changed = false;
        for (int i = 0; i < log.length(); i++) {
            JSONObject e = log.optJSONObject(i);
            if (e == null) continue;
            if (!loanId.equals(e.optString("loanId", ""))) continue;
            if (!today.equals(e.optString("sentDay", ""))) continue;
            if (!"failed".equals(e.optString("status", ""))) continue;
            try {
                e.put("retryPending", false);
                changed = true;
            } catch (Exception ignored) {
            }
        }
        if (changed) saveLog(context, log);
    }

    /** Sent log: JSON array, newest first, capped at MAX_LOG. */
    public static JSONArray log(Context context) {
        try {
            String raw = prefs(context).getString("log_json", "[]");
            return new JSONArray(raw == null || raw.isEmpty() ? "[]" : raw);
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    public static void saveLog(Context context, JSONArray log) {
        JSONArray capped = new JSONArray();
        for (int i = 0; i < Math.min(log.length(), MAX_LOG); i++) {
            capped.put(log.opt(i));
        }
        prefs(context).edit().putString("log_json", capped.toString()).apply();
    }

    /** Add a log entry (newest first). */
    public static void addLogEntry(Context context, JSONObject entry) {
        JSONArray log = log(context);
        JSONArray next = new JSONArray();
        next.put(entry);
        for (int i = 0; i < log.length(); i++) next.put(log.opt(i));
        saveLog(context, next);
    }

    /**
     * Update one log entry's status by sendId (no-op when not found).
     * A failed entry with a transient reason is marked retry-pending;
     * a sent entry never is.
     */
    public static void updateLogEntry(
            Context context, String sendId, String status, String reason) {
        if (sendId == null || sendId.isEmpty()) return;
        JSONArray log = log(context);
        boolean changed = false;
        for (int i = 0; i < log.length(); i++) {
            JSONObject e = log.optJSONObject(i);
            if (e != null && sendId.equals(e.optString("sendId", ""))) {
                try {
                    e.put("status", status);
                    if (reason != null) {
                        e.put("reason", reason);
                        e.put("retryPending",
                            "failed".equals(status) && isTransientReason(reason));
                    } else {
                        e.remove("reason");
                        e.put("retryPending", false);
                    }
                    changed = true;
                } catch (Exception ignored) {
                }
                break;
            }
        }
        if (changed) saveLog(context, log);
    }

    /** Current status of one send ("sending" / "sent" / "failed"), or "" when unknown. */
    public static String logStatus(Context context, String sendId) {
        JSONArray log = log(context);
        for (int i = 0; i < log.length(); i++) {
            JSONObject e = log.optJSONObject(i);
            if (e != null && sendId.equals(e.optString("sendId", ""))) {
                return e.optString("status", "");
            }
        }
        return "";
    }

    /** Reason recorded for one send, or "" when none. */
    public static String logReason(Context context, String sendId) {
        JSONArray log = log(context);
        for (int i = 0; i < log.length(); i++) {
            JSONObject e = log.optJSONObject(i);
            if (e != null && sendId.equals(e.optString("sendId", ""))) {
                return e.optString("reason", "");
            }
        }
        return "";
    }

    /** True when this loan already has a permanently-failed send today — retrying is pointless. */
    public static boolean hasPermanentFailureToday(Context context, String loanId) {
        String today = todayKolkatta();
        JSONArray log = log(context);
        for (int i = 0; i < log.length(); i++) {
            JSONObject e = log.optJSONObject(i);
            if (e == null) continue;
            if (!loanId.equals(e.optString("loanId", ""))) continue;
            if (!today.equals(e.optString("sentDay", ""))) continue;
            if (!"failed".equals(e.optString("status", ""))) continue;
            if (!isTransientReason(e.optString("reason", ""))) return true;
        }
        return false;
    }

    /**
     * A failure worth retrying later the same day: no signal, radio
     * off, a generic radio failure, a send that threw, or a send whose
     * result never came back. A bad number (null-pdu) and a missing
     * SMS permission are permanent — retrying them helps nobody.
     */
    public static boolean isTransientReason(String reason) {
        return "no-service".equals(reason)
            || "radio-off".equals(reason)
            || "generic-failure".equals(reason)
            || "send-failed".equals(reason)
            || "unknown".equals(reason);
    }

    /** Entries still "sending" from a previous day never got a result — mark them failed. */
    public static void failStaleSending(Context context) {
        String today = todayKolkatta();
        JSONArray log = log(context);
        boolean changed = false;
        for (int i = 0; i < log.length(); i++) {
            JSONObject e = log.optJSONObject(i);
            if (e == null) continue;
            if (!"sending".equals(e.optString("status", ""))) continue;
            if (!today.equals(e.optString("sentDay", ""))) {
                try {
                    e.put("status", "failed");
                    e.put("reason", "unknown");
                    e.put("retryPending", true);
                    changed = true;
                } catch (Exception ignored) {
                }
            }
        }
        if (changed) saveLog(context, log);
    }

    // Multipart delivery tracking: one counter per sendId.
    public static void initParts(Context context, String sendId, int total) {
        prefs(context).edit()
            .putInt("parts_total_" + sendId, total)
            .putInt("parts_ok_" + sendId, 0)
            .apply();
    }

    /** Returns true when all parts of this send reported OK. */
    public static boolean notePartOk(Context context, String sendId) {
        SharedPreferences p = prefs(context);
        int total = p.getInt("parts_total_" + sendId, 1);
        int ok = p.getInt("parts_ok_" + sendId, 0) + 1;
        p.edit().putInt("parts_ok_" + sendId, ok).apply();
        return ok >= total;
    }
}
