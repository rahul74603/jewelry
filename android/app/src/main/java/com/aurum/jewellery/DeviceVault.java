package com.aurum.jewellery;

import android.app.Activity;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.annotation.ActivityCallback;
import java.io.OutputStream;
import android.content.Context;
import android.content.Intent;
import android.print.PrintManager;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "DeviceVault")
public class DeviceVault extends Plugin {
    @PluginMethod public void publicKey(PluginCall call) {
        try {
            byte[] key = DeviceKeys.publicKey(call.getString("slot", ""));
            JSObject out = new JSObject();
            out.put("publicKey", Base64.encodeToString(key, Base64.NO_WRAP));
            call.resolve(out);
        } catch (Exception e) { call.reject("Android Keystore unavailable"); }
    }
    @PluginMethod public void model(PluginCall call) {
        JSObject out = new JSObject();
        // Per-model name only (e.g. "Infinix ZERO 5G 2023") — NOT
        // per-phone. It is a signal for the issued-keys register, never
        // part of the unlock-key math, which stays bound to code +
        // Device ID.
        out.put("model", Build.MODEL == null ? "" : Build.MODEL);
        call.resolve(out);
    }
    @PluginMethod public void sign(PluginCall call) {
        try {
            byte[] signature = DeviceKeys.sign(call.getString("slot", ""), call.getString("message", ""));
            JSObject out = new JSObject();
            out.put("signature", Base64.encodeToString(signature, Base64.NO_WRAP));
            call.resolve(out);
        } catch (Exception e) { call.reject("Could not sign device challenge"); }
    }
    @PluginMethod public void shareText(PluginCall call) {
        String text = call.getString("text", "");
        if (text.isEmpty() || text.length() > 4000) { call.reject("Invalid share summary"); return; }
        getActivity().runOnUiThread(() -> { try {
            Intent intent = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text);
            getActivity().startActivity(Intent.createChooser(intent, "Share invoice summary"));
            call.resolve();
        } catch (Exception e) { call.reject("No sharing application available"); } });
    }
    private static String documentName(PluginCall call) {
        String n=call.getString("documentNumber", "Receipt").replaceAll("[^A-Za-z0-9._-]", "-");
        return n.isEmpty() || n.length()>80 ? "Receipt" : n;
    }
    @PluginMethod public void saveRollPdf(PluginCall call) {
        String f=call.getString("format", "");
        if (!(f.equals("80mm")||f.equals("58mm"))) {call.reject("Select a roll format");return;}
        Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/pdf")
            .putExtra(Intent.EXTRA_TITLE,documentName(call)+"-"+f+".pdf");
        if(Build.VERSION.SDK_INT>=26)intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, Uri.parse("content://com.android.externalstorage.documents/document/primary%3ADownload"));
        try {startActivityForResult(call,intent,"writeRoll");} catch (Exception e) {call.reject("No document picker available");}
    }
    @ActivityCallback private void writeRoll(PluginCall call,ActivityResult result) {
        if(call==null)return;
        if(result.getResultCode()!=Activity.RESULT_OK){JSObject r=new JSObject();r.put("saved",false);call.resolve(r);return;}
        Uri uri=result.getData()==null?null:result.getData().getData();
        if(uri==null||!"content".equals(uri.getScheme())){call.reject("No output document selected");return;}
        bridge.execute(()->{
            try(OutputStream out=getContext().getContentResolver().openOutputStream(uri,"wt")) {
                if(out==null)throw new IllegalStateException();
                RollPdf.write(out,call.getString("format", ""),call.getArray("blocks"),call.getString("logo", ""),call.getString("mark", ""));
            }catch(Exception e){call.reject("Could not write the roll PDF");return;}
            JSObject r=new JSObject();r.put("saved",true);call.resolve(r);
        });
    }
    @PluginMethod public void printInvoice(PluginCall call) {
        getActivity().runOnUiThread(() -> { try {
            PrintManager manager = (PrintManager)getActivity().getSystemService(Context.PRINT_SERVICE);
            String job = documentName(call);
            manager.print(job, getBridge().getWebView().createPrintDocumentAdapter(job), InvoicePaper.forFormat(call.getString("format", "")));
            call.resolve();
        } catch (Exception e) { call.reject("Android print service unavailable"); } });
    }
}
