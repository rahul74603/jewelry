package com.aurum.jewellery;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONArray;

/**
 * Automatic daily SMS reminders for due girvi / EMI records, sent at
 * 10:00 AM from the shopkeeper's own SIM.
 *
 * The JS side hands the due payload (record id, customer phone,
 * message text) to scheduleReminders() on every app open; the native
 * side stores it in SharedPreferences, and the native trigger — an
 * exact 10:00 alarm when the phone allows it, WorkManager periodic
 * work otherwise — sends it. The SMS permission is only ever asked
 * for from the settings toggle (requestPermission), never on app
 * launch, so the CI emulator test (which waits for Dashboard to
 * mount) never sees a dialog.
 *
 * SMS needs a mobile signal, not the internet. WhatsApp cannot be
 * the automatic channel: its Business API charges per message, and
 * unofficial automation gets the number banned.
 */
@CapacitorPlugin(
    name = "SmsReminder",
    permissions = @Permission(strings = { Manifest.permission.SEND_SMS }, alias = "sms")
)
public class SmsReminderPlugin extends Plugin {

    @PluginMethod
    public void checkPermission(PluginCall call) {
        JSObject out = new JSObject();
        out.put("granted", getPermissionState("sms") == PermissionState.GRANTED);
        call.resolve(out);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        requestPermissionForAlias("sms", call, "smsPermissionCallback");
    }

    @PermissionCallback
    private void smsPermissionCallback(PluginCall call) {
        JSObject out = new JSObject();
        out.put("granted", getPermissionState("sms") == PermissionState.GRANTED);
        call.resolve(out);
    }

    @PluginMethod
    public void scheduleReminders(PluginCall call) {
        try {
            if (getPermissionState("sms") != PermissionState.GRANTED) {
                call.reject("sms-permission-missing");
                return;
            }
            JSArray items = call.getArray("items", new JSArray());
            String preparedDay = call.getString("preparedDay", "");
            SmsReminderStore.saveItems(getContext(), items.toString(), preparedDay);
            SmsReminderStore.setEnabled(getContext(), true);
            SmsReminderScheduler.reschedule(getContext());
            JSObject out = new JSObject();
            out.put("scheduled", true);
            out.put("count", items.length());
            out.put("mode", SmsReminderStore.mode(getContext()));
            out.put("exactAllowed", SmsReminderScheduler.exactAllowed(getContext()));
            call.resolve(out);
        } catch (Exception e) {
            call.reject("schedule-failed");
        }
    }

    @PluginMethod
    public void cancelReminders(PluginCall call) {
        SmsReminderStore.setEnabled(getContext(), false);
        SmsReminderStore.clearItems(getContext());
        SmsReminderScheduler.cancelAll(getContext());
        JSObject out = new JSObject();
        out.put("cancelled", true);
        call.resolve(out);
    }

    /** One immediate SMS — the test SMS from Settings, to the shop's own number. */
    @PluginMethod
    public void sendNow(PluginCall call) {
        String phone = call.getString("phone", "");
        String message = call.getString("message", "");
        String customerName = call.getString("customerName", "Test SMS");
        if (phone.isEmpty() || message.isEmpty()) {
            call.reject("Missing phone or message");
            return;
        }
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            call.reject("sms-permission-missing");
            return;
        }
        String sendId = SmsSender.send(getContext(), "test", customerName, phone, message);
        JSObject out = new JSObject();
        out.put("sent", !sendId.isEmpty());
        call.resolve(out);
    }

    @PluginMethod
    public void getSentLog(PluginCall call) {
        try {
            JSONArray log = SmsReminderStore.log(getContext());
            JSObject out = new JSObject();
            out.put("entries", new JSArray(log.toString()));
            call.resolve(out);
        } catch (Exception e) {
            call.reject("log-unavailable");
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject out = new JSObject();
        out.put("enabled", SmsReminderStore.isEnabled(getContext()));
        out.put("mode", SmsReminderStore.mode(getContext()));
        out.put("exactAllowed", SmsReminderScheduler.exactAllowed(getContext()));
        out.put("smsGranted", getPermissionState("sms") == PermissionState.GRANTED);
        call.resolve(out);
    }

    /** Open the battery-optimization settings list so the shopkeeper can exempt the app. */
    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        try {
            Intent intent = new Intent(
                Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("settings-unavailable");
        }
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
