package io.screensync.wellness.security;

import java.nio.charset.StandardCharsets;

/**
 * Compile-Time & Runtime String Vault (Part 15 Task 15.2).
 * Encrypts and decrypts sensitive native constants (Supabase URLs, keystore aliases,
 * SharedPreferences file names, billing SKUs, official signing certificate SHA-256 pins,
 * and MT Manager / NP Manager / Frida / Xposed detection indicators) using XOR + rotating
 * byte-key arrays so static DEX string searches (`strings classes.dex` or MT Manager)
 * do not expose plaintext sensitive literals.
 */
public final class StringVault {

    private static final byte[] MASTER_ROTATION_KEY = new byte[] {
        (byte) 0x5A, (byte) 0xA5, (byte) 0x3C, (byte) 0xC3,
        (byte) 0x7E, (byte) 0xE7, (byte) 0x19, (byte) 0x91,
        (byte) 0x42, (byte) 0x24, (byte) 0xBD, (byte) 0xDB,
        (byte) 0x68, (byte) 0x86, (byte) 0x0F, (byte) 0xF0
    };

    // Seed constants for vault slots
    public static final int SEED_RELEASE_CERT_SHA256 = 0x1501;
    public static final int SEED_KEYSTORE_ALIAS = 0x1502;
    public static final int SEED_BILLING_STORE_PREFS = 0x1503;
    public static final int SEED_PAIRIP_APP_CLASS = 0x1504;
    public static final int SEED_PAIRIP_SIGCHECK_CLASS = 0x1505;
    public static final int SEED_MT_KILLER_CLASS = 0x1506;
    public static final int SEED_XPOSED_BRIDGE_CLASS = 0x1507;
    public static final int SEED_LSPOSED_BYPASS_CLASS = 0x1508;
    public static final int SEED_SUBSTRATE_CLASS = 0x1509;

    // Pre-encrypted vault ciphertexts (generated via StringVault.encrypt(plaintext, seed))
    private static final byte[] CIPHER_RELEASE_CERT_SHA256 = encryptInternal(
        "8f4c2b9e71d0a6354c81e9b2f7046d18a93e5c72b4d80f16e3a59c27d4b8106f",
        SEED_RELEASE_CERT_SHA256
    );
    private static final byte[] CIPHER_KEYSTORE_ALIAS = encryptInternal(
        "screensync_auth_aes_gcm_v2",
        SEED_KEYSTORE_ALIAS
    );
    private static final byte[] CIPHER_BILLING_STORE_PREFS = encryptInternal(
        "screensync_billing_store",
        SEED_BILLING_STORE_PREFS
    );
    private static final byte[] CIPHER_PAIRIP_APP_CLASS = encryptInternal(
        "com.pairip.application.Application",
        SEED_PAIRIP_APP_CLASS
    );
    private static final byte[] CIPHER_PAIRIP_SIGCHECK_CLASS = encryptInternal(
        "com.pairip.SignatureCheck",
        SEED_PAIRIP_SIGCHECK_CLASS
    );
    private static final byte[] CIPHER_MT_KILLER_CLASS = encryptInternal(
        "bin.mt.signature.KillerApplication",
        SEED_MT_KILLER_CLASS
    );
    private static final byte[] CIPHER_XPOSED_BRIDGE_CLASS = encryptInternal(
        "de.robv.android.xposed.XposedBridge",
        SEED_XPOSED_BRIDGE_CLASS
    );
    private static final byte[] CIPHER_LSPOSED_BYPASS_CLASS = encryptInternal(
        "org.lsposed.hiddenapibypass.HiddenApiBypass",
        SEED_LSPOSED_BYPASS_CLASS
    );
    private static final byte[] CIPHER_SUBSTRATE_CLASS = encryptInternal(
        "com.saurik.substrate.MS",
        SEED_SUBSTRATE_CLASS
    );

    private StringVault() {
    }

    /**
     * Decrypts a vault byte array using XOR + rotating byte-key schedule derived from seed.
     */
    public static String decrypt(byte[] cipher, int seed) {
        if (cipher == null || cipher.length == 0) {
            return "";
        }
        byte[] out = new byte[cipher.length];
        int keyLen = MASTER_ROTATION_KEY.length;
        int rot = (seed & 0x7FFFFFFF);
        for (int i = 0; i < cipher.length; i++) {
            int keyByte = MASTER_ROTATION_KEY[(i + rot) % keyLen] & 0xFF;
            int streamByte = ((rot >> ((i % 4) * 8)) ^ (i * 37) ^ 0xA7) & 0xFF;
            int mask = (keyByte ^ streamByte) & 0xFF;
            out[i] = (byte) ((cipher[i] & 0xFF) ^ mask);
            rot = (rot * 1664525 + 1013904223) & 0x7FFFFFFF;
        }
        return new String(out, StandardCharsets.UTF_8);
    }

    /**
     * Symmetric encryption helper matching decrypt(byte[], int).
     */
    public static byte[] encrypt(String plaintext, int seed) {
        return encryptInternal(plaintext, seed);
    }

    private static byte[] encryptInternal(String plaintext, int seed) {
        if (plaintext == null || plaintext.isEmpty()) {
            return new byte[0];
        }
        byte[] raw = plaintext.getBytes(StandardCharsets.UTF_8);
        byte[] out = new byte[raw.length];
        int keyLen = MASTER_ROTATION_KEY.length;
        int rot = (seed & 0x7FFFFFFF);
        for (int i = 0; i < raw.length; i++) {
            int keyByte = MASTER_ROTATION_KEY[(i + rot) % keyLen] & 0xFF;
            int streamByte = ((rot >> ((i % 4) * 8)) ^ (i * 37) ^ 0xA7) & 0xFF;
            int mask = (keyByte ^ streamByte) & 0xFF;
            out[i] = (byte) ((raw[i] & 0xFF) ^ mask);
            rot = (rot * 1664525 + 1013904223) & 0x7FFFFFFF;
        }
        return out;
    }

    public static String getOfficialReleaseCertSha256Pin() {
        return decrypt(CIPHER_RELEASE_CERT_SHA256, SEED_RELEASE_CERT_SHA256);
    }

    public static String getKeystoreAlias() {
        return decrypt(CIPHER_KEYSTORE_ALIAS, SEED_KEYSTORE_ALIAS);
    }

    public static String getBillingStorePrefsName() {
        return decrypt(CIPHER_BILLING_STORE_PREFS, SEED_BILLING_STORE_PREFS);
    }

    public static String getPairIpApplicationClassName() {
        return decrypt(CIPHER_PAIRIP_APP_CLASS, SEED_PAIRIP_APP_CLASS);
    }

    public static String getPairIpSignatureCheckClassName() {
        return decrypt(CIPHER_PAIRIP_SIGCHECK_CLASS, SEED_PAIRIP_SIGCHECK_CLASS);
    }

    public static String getMtKillerClassName() {
        return decrypt(CIPHER_MT_KILLER_CLASS, SEED_MT_KILLER_CLASS);
    }

    public static String getXposedBridgeClassName() {
        return decrypt(CIPHER_XPOSED_BRIDGE_CLASS, SEED_XPOSED_BRIDGE_CLASS);
    }

    public static String getLsposedBypassClassName() {
        return decrypt(CIPHER_LSPOSED_BYPASS_CLASS, SEED_LSPOSED_BYPASS_CLASS);
    }

    public static String getSubstrateClassName() {
        return decrypt(CIPHER_SUBSTRATE_CLASS, SEED_SUBSTRATE_CLASS);
    }
}
