package com.aurum.jewellery;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/**
 * One-tap in-app update ("Ek click update", v1.0.45).
 *
 * The TS side (src/lib/appUpdate.ts) downloads the new APK into
 * the app cache dir, then this plugin opens the system installer
 * for it. The update is IN PLACE — same package name, same
 * signing key — so shop data, settings and the device activation
 * all survive it. No uninstall, no re-activation, no new key.
 *
 * The APK is served through the FileProvider already declared in
 * AndroidManifest.xml (authorities ${applicationId}.fileprovider,
 * cache-path in res/xml/file_paths.xml). Installing needs
 * REQUEST_INSTALL_PACKAGES (declared in the manifest) and, on
 * first use, the shopkeeper allowing "Install unknown apps" for
 * Aurum once in Settings — canInstallPackages() reports that,
 * openInstallSettings() takes them there.
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {
    @PluginMethod public void getPrimaryAbi(PluginCall call) {
        JSObject out = new JSObject();
        String abi = "";
        try {
            String[] abis = Build.SUPPORTED_ABIS;
            if (abis != null && abis.length > 0 && abis[0] != null) abi = abis[0];
        } catch (Exception ignored) {}
        out.put("abi", abi);
        call.resolve(out);
    }

    @PluginMethod public void canInstallPackages(PluginCall call) {
        JSObject out = new JSObject();
        boolean can = false;
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                can = getContext().getPackageManager().canRequestPackageInstalls();
            }
        } catch (Exception ignored) {}
        out.put("canInstall", can);
        call.resolve(out);
    }

    @PluginMethod public void openInstallSettings(PluginCall call) {
        try {
            Intent intent = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open install settings");
        }
    }

    @PluginMethod public void installApk(PluginCall call) {
        try {
            String fileName = call.getString("fileName", "aurum-update.apk");
            File apk = new File(getContext().getCacheDir(), fileName);
            if (!apk.exists()) {
                call.reject("Update file not found");
                return;
            }
            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                apk);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject out = new JSObject();
            out.put("started", true);
            call.resolve(out);
        } catch (Exception e) {
            call.reject("Could not open the installer");
        }
    }
}
