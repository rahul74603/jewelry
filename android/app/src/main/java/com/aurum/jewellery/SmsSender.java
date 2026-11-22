package com.aurum.jewellery;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.telephony.SmsManager;
import androidx.core.content.ContextCompat;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;
import org.json.JSONObject;

/**
 * The one place that sends an SMS — used by the daily worker and by
 * the manual test SMS from Settings.
 *
 * A send is a two-step fact: first the message is handed to the
 * radio (SmsManager), then the radio reports back per part through
 * the sent-intent, which SmsSentReceiver turns into a sent/failed
 * log entry. This method only returns the sendId when the message
 * was handed off; a synchronous failure (exception, or no SMS
 * permission) returns "" and the log already holds the failed entry.
 * The caller decides "sent for today" only after the log says
 * "sent" — never on the handoff alone.
 */
public final class SmsSender {
    private SmsSender() {}

    public static boolean hasSmsPermission(Context context) {
        return ContextCompat.checkSelfPermission(
                context, android.Manifest.permission.SEND_SMS)
            == PackageManager.PERMISSION_GRANTED;
    }

    /** Hand one SMS to the radio (multipart when long). Returns the sendId, or "" when not sent. */
    public static String send(Context context, String loanId, String customerName,
                              String phone, String message) {
        if (phone == null || phone.isEmpty() || message == null || message.isEmpty()) return "";
        if (!hasSmsPermission(context)) return "";
        String sendId = UUID.randomUUID().toString();
        JSONObject entry = new JSONObject();
        try {
            entry.put("sendId", sendId);
            entry.put("loanId", loanId);
            entry.put("customerName", customerName);
            entry.put("phone", phone);
            entry.put("message", message);
            entry.put("sentAt", isoNow());
            entry.put("sentDay", SmsReminderStore.todayKolkatta());
            entry.put("status", "sending");
            entry.put("retryPending", false);
        } catch (Exception e) {
            return "";
        }
        SmsReminderStore.addLogEntry(context, entry);
        try {
            SmsManager sms = smsManager(context);
            ArrayList<String> parts = sms.divideMessage(message);
            if (parts == null || parts.isEmpty()) {
                parts = new ArrayList<>();
                parts.add(message);
            }
            SmsReminderStore.initParts(context, sendId, parts.size());
            ArrayList<PendingIntent> sentIntents = new ArrayList<>();
            for (int i = 0; i < parts.size(); i++) {
                Intent intent = new Intent(SmsReminderStore.ACTION_SMS_SENT);
                intent.setPackage(context.getPackageName());
                intent.putExtra("sendId", sendId);
                intent.putExtra("partIndex", i);
                intent.putExtra("totalParts", parts.size());
                int flags = PendingIntent.FLAG_UPDATE_CURRENT;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    flags |= PendingIntent.FLAG_IMMUTABLE;
                }
                sentIntents.add(PendingIntent.getBroadcast(
                    context, (sendId + "#" + i).hashCode(), intent, flags));
            }
            sms.sendMultipartTextMessage(phone, null, parts, sentIntents, null);
            return sendId;
        } catch (Exception e) {
            SmsReminderStore.updateLogEntry(context, sendId, "failed", "send-failed");
            return "";
        }
    }

    private static SmsManager smsManager(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            SmsManager m = context.getSystemService(SmsManager.class);
            if (m != null) return m;
        }
        return SmsManager.getDefault();
    }

    private static String isoNow() {
        SimpleDateFormat f = new SimpleDateFormat(
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date());
    }
}
