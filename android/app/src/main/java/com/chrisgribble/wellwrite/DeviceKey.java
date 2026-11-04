package com.chrisgribble.wellwrite;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.Log;

import java.security.KeyStore;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * This phone's key for things WellWrite saves for you (a remembered password, your API.Bible key, your WordPress
 * application password). The key itself is random and stored encrypted by Android's keystore, which never lets
 * the keystore's own key leave the phone's secure hardware. Your journal is encrypted with your password, not this.
 */
final class DeviceKey {
    private static final String ALIAS = "wellwrite-device";

    static String secretHex(Context c) {
        SharedPreferences prefs = c.getSharedPreferences("device", Context.MODE_PRIVATE);
        try {
            SecretKey wrap = keystoreKey();
            String stored = prefs.getString("secret", null);
            if (stored != null) {
                try {
                    byte[] b = Base64.decode(stored, Base64.NO_WRAP);
                    Cipher d = Cipher.getInstance("AES/GCM/NoPadding");
                    d.init(Cipher.DECRYPT_MODE, wrap, new GCMParameterSpec(128, b, 0, 12));
                    return hex(d.doFinal(b, 12, b.length - 12));
                } catch (Exception e) {
                    Log.w("WellWrite", "Saved device key unreadable; making a new one (saved passwords need entering again)");
                }
            }
            byte[] secret = new byte[32];
            new SecureRandom().nextBytes(secret);
            Cipher e = Cipher.getInstance("AES/GCM/NoPadding");
            e.init(Cipher.ENCRYPT_MODE, wrap);
            byte[] iv = e.getIV(), body = e.doFinal(secret);
            byte[] all = new byte[iv.length + body.length];
            System.arraycopy(iv, 0, all, 0, iv.length);
            System.arraycopy(body, 0, all, iv.length, body.length);
            prefs.edit().putString("secret", Base64.encodeToString(all, Base64.NO_WRAP)).commit();
            return hex(secret);
        } catch (Exception e) {
            // No keystore: nothing can be saved on this phone (you type your password each time).
            Log.e("WellWrite", "Keystore unavailable", e);
            return "";
        }
    }

    private static SecretKey keystoreKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (!ks.containsAlias(ALIAS)) {
            KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            kg.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build());
            return kg.generateKey();
        }
        return (SecretKey) ks.getKey(ALIAS, null);
    }

    private static String hex(byte[] b) {
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format("%02x", x));
        return s.toString();
    }

    private DeviceKey() {}
}
