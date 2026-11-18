package com.aurum.jewellery;

import android.content.Context;
import android.print.PrintManager;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.ECGenParameterSpec;

@CapacitorPlugin(name = "DeviceVault")
public class DeviceVault extends Plugin {
    private String alias(PluginCall call) {
        String slot = call.getString("slot", "");
        if (!slot.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("Invalid account slot");
        return "aurum.device." + slot;
    }
    @PluginMethod public synchronized void publicKey(PluginCall call) {
        try {
            String name = alias(call);
            KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
            if (!store.containsAlias(name)) {
                KeyPairGenerator gen = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
                gen.initialize(new KeyGenParameterSpec.Builder(name, KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
                    .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1")).setDigests(KeyProperties.DIGEST_SHA256).build());
                gen.generateKeyPair();
            }
            JSObject out = new JSObject(); out.put("publicKey", Base64.encodeToString(store.getCertificate(name).getPublicKey().getEncoded(), Base64.NO_WRAP)); call.resolve(out);
        } catch (Exception e) { call.reject("Android Keystore unavailable"); }
    }
    @PluginMethod public void sign(PluginCall call) {
        try {
            String message = call.getString("message", "");
            if (!message.startsWith("aurum-v1:") || message.length() > 1024) throw new IllegalArgumentException();
            KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
            Signature signer = Signature.getInstance("SHA256withECDSA");
            signer.initSign((PrivateKey)store.getKey(alias(call), null)); signer.update(message.getBytes(StandardCharsets.UTF_8));
            JSObject out = new JSObject(); out.put("signature", Base64.encodeToString(signer.sign(), Base64.NO_WRAP)); call.resolve(out);
        } catch (Exception e) { call.reject("Could not sign device challenge"); }
    }
    @PluginMethod public void printInvoice(PluginCall call) {
        getActivity().runOnUiThread(() -> {try {
            PrintManager manager = (PrintManager)getActivity().getSystemService(Context.PRINT_SERVICE);
            String job = "Aurum invoice";
            manager.print(job, getBridge().getWebView().createPrintDocumentAdapter(job), null); call.resolve();
        } catch (Exception e) {call.reject("Android print service unavailable");}});
    }
}
