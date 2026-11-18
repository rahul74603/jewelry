package com.aurum.jewellery;
import static org.junit.Assert.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.X509EncodedKeySpec;
import java.util.UUID;

@RunWith(AndroidJUnit4.class)
public class DeviceKeysTest {
    @Test public void signingKeyPersistsWithoutPrivateExport() throws Exception {
        String seed = UUID.randomUUID().toString().replace("-", "");
        String slot = seed + seed;
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        try {
            byte[] spki = DeviceKeys.publicKey(slot);
            assertArrayEquals(spki, DeviceKeys.publicKey(slot));
            assertNull(store.getKey(DeviceKeys.alias(slot), null).getEncoded());
            Signature verifier = Signature.getInstance("SHA256withECDSA");
            verifier.initVerify(KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(spki)));
            String challenge = "aurum-v1:" + UUID.randomUUID();
            verifier.update(challenge.getBytes(StandardCharsets.UTF_8));
            assertTrue(verifier.verify(DeviceKeys.sign(slot, challenge)));
        } finally { store.deleteEntry(DeviceKeys.alias(slot)); }
    }
}
