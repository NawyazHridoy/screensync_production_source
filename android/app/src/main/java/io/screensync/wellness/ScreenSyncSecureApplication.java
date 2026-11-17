package io.screensync.wellness;

import android.app.Application;
import android.content.Context;
import io.screensync.wellness.security.StringVault;
import java.lang.reflect.Method;

/**
 * ScreenSyncSecureApplication (Part 15 Task 15.2 & Task 15.3).
 *
 * Configured as android:name="io.screensync.wellness.ScreenSyncSecureApplication" in AndroidManifest.xml.
 * - Delegates to / initializes Google PairIP (com.pairip.application.Application and com.pairip.SignatureCheck)
 *   when PairIP AAB protection is injected by Google Play Integrity / Play App Signing.
 * - Executes NativeAntiTamperGuard at attachBaseContext() and onCreate() to detect APK re-signing,
 *   MT Manager / NP Manager / Lucky Patcher hooks, classes.dex / index.html modifications, and Frida/Xposed.
 */
public class ScreenSyncSecureApplication extends Application {

    private static volatile boolean pairIpVerified = false;

    @Override
    protected void attachBaseContext(Context base) {
        super.attachBaseContext(base);
        invokePairIpProtectionIfPresent(base);
        try {
            NativeAntiTamperGuard.verifyIntegrity(base);
        } catch (Throwable ignored) {
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        invokePairIpProtectionIfPresent(this);
        try {
            NativeAntiTamperGuard.verifyIntegrity(this);
        } catch (Throwable ignored) {
        }
    }

    private void invokePairIpProtectionIfPresent(Context context) {
        try {
            String sigCheckClassName = StringVault.getPairIpSignatureCheckClassName();
            Class<?> sigCheckCls = Class.forName(sigCheckClassName);
            Method verifyMethod = sigCheckCls.getDeclaredMethod("verifyIntegrity", Context.class);
            verifyMethod.setAccessible(true);
            verifyMethod.invoke(null, context);
            pairIpVerified = true;
        } catch (Throwable ignored) {
            // PairIP runtime classes are injected by Google Play App Signing during AAB distribution
        }
    }

    public static boolean isPairIpRuntimePresent() {
        return pairIpVerified;
    }
}
