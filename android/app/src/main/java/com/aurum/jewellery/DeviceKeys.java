package com.aurum.jewellery;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.ECGenParameterSpec;

/** Private signing material never leaves the OS keystore. */
final class DeviceKeys {
    private DeviceKeys() {}
    static String alias(String slot) {
        if (slot == null || !slot.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("Invalid account slot");
        return "aurum.device." + slot;
    }
    static void checkMessage(String message) {
        if (message == null || !message.startsWith("aurum-v1:") || message.length() > 1024) throw new IllegalArgumentException("Invalid challenge");
    }
    private static KeyStore open() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        return store;
    }
    static synchronized byte[] publicKey(String slot) throws Exception {
        String name = alias(slot);
        KeyStore store = open();
        if (!store.containsAlias(name)) {
            KeyPairGenerator gen = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
            gen.initialize(new KeyGenParameterSpec.Builder(name, KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
                .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1")).setDigests(KeyProperties.DIGEST_SHA256).build());
            gen.generateKeyPair();
        }
        return store.getCertificate(name).getPublicKey().getEncoded();
    }
    static byte[] sign(String slot, String message) throws Exception {
        checkMessage(message);
        Signature signer = Signature.getInstance("SHA256withECDSA");
        signer.initSign((PrivateKey)open().getKey(alias(slot), null));
        signer.update(message.getBytes(StandardCharsets.UTF_8));
        return signer.sign();
    }
}
