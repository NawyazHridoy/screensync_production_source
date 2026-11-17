/*
 * ScreenSync App Timer & Focus Mode Enforcement Manager
 * Package: io.screensync.wellness
 * Enforces per-app daily usage timers via AccessibilityService + SharedPreferences
 * state on standard Play Store builds, with optional PackageManager.setPackagesSuspended()
 * when privileged device/profile owner permissions are available.
 */
package io.screensync.wellness;

import android.app.PendingIntent;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.SuspendDialogInfo;
import android.os.PersistableBundle;
import android.util.Log;

public class AppTimerSuspensionManager {
    private static final String TAG = "AppTimerSuspensionMgr";
    private final Context context;
    private final UsageStatsManager usageStatsManager;
    private final PackageManager packageManager;

    public AppTimerSuspensionManager(Context context) {
        this.context = context.getApplicationContext();
        this.usageStatsManager = (UsageStatsManager) this.context.getSystemService(Context.USAGE_STATS_SERVICE);
        this.packageManager = this.context.getPackageManager();
    }

    public boolean canUsePrivilegedPackageSuspension() {
        return context.checkSelfPermission("android.permission.SUSPEND_APPS") == PackageManager.PERMISSION_GRANTED;
    }

    public boolean isPackageMarkedSuspended(String packageName) {
        if (packageName == null || packageName.isEmpty()) return false;
        try {
            SharedPreferences prefs = context.getSharedPreferences("screensync_wellness_store", Context.MODE_PRIVATE);
            return prefs.getBoolean("suspended_pkg_" + packageName, false);
        } catch (Exception e) {
            return false;
        }
    }

    public void registerDailyAppTimer(
            int observerId,
            String packageName,
            long dailyLimitMs,
            long alreadyUsedTodayMs,
            PendingIntent limitReachedCallback) {

        if (alreadyUsedTodayMs >= dailyLimitMs && dailyLimitMs > 0L) {
            suspendPackageForExpiredTimer(packageName);
            return;
        }
        recordTimerFallbackState(packageName, false, dailyLimitMs, alreadyUsedTodayMs);
    }

    /**
     * Suspends a target package when its daily App Timer expires or Focus Mode starts.
     * Wraps PackageManager.setPackagesSuspended in a SecurityException/IllegalArgumentException guard
     * and falls back to AccessibilityService + SharedPreferences enforcement on non-privileged builds (C8-22).
     */
    public String[] suspendPackageForExpiredTimer(String packageName) {
        if (packageName == null || packageName.isEmpty()) return new String[0];
        recordTimerFallbackState(packageName, true, 0L, 0L);
        if (!canUsePrivilegedPackageSuspension()) {
            Log.i(TAG, "SUSPEND_APPS not granted; using AccessibilityService + SharedPreferences fallback for " + packageName);
            return new String[]{ packageName };
        }
        try {
            SuspendDialogInfo dialogInfo = new SuspendDialogInfo.Builder()
                    .setTitle("App paused")
                    .setMessage("Your daily timer for this app ran out. It will reset at midnight.")
                    .setNeutralButtonAction(SuspendDialogInfo.BUTTON_ACTION_MORE_DETAILS)
                    .build();

            PersistableBundle appExtras = new PersistableBundle();
            appExtras.putString("suspension_reason", "SCREENSYNC_APP_TIMER");

            return packageManager.setPackagesSuspended(
                    new String[]{ packageName },
                    true,
                    appExtras,
                    null,
                    dialogInfo
            );
        } catch (SecurityException | IllegalArgumentException e) {
            Log.w(TAG, "setPackagesSuspended fallback triggered for " + packageName, e);
            return new String[]{ packageName };
        }
    }

    public String[] unsuspendPackageAtMidnightOrUserOverride(String packageName) {
        if (packageName == null || packageName.isEmpty()) return new String[0];
        recordTimerFallbackState(packageName, false, 0L, 0L);
        if (!canUsePrivilegedPackageSuspension()) {
            return new String[0];
        }
        try {
            return packageManager.setPackagesSuspended(
                    new String[]{ packageName },
                    false,
                    null,
                    null,
                    null
            );
        } catch (SecurityException | IllegalArgumentException e) {
            Log.w(TAG, "unsuspendPackage fallback triggered for " + packageName, e);
            return new String[]{ packageName };
        }
    }

    public void recordTimerFallbackState(String packageName, boolean suspended, long limitMs, long usedMs) {
        try {
            SharedPreferences prefs = context.getSharedPreferences("screensync_wellness_store", Context.MODE_PRIVATE);
            SharedPreferences.Editor ed = prefs.edit();
            ed.putBoolean("suspended_pkg_" + packageName, suspended);
            if (limitMs > 0L) ed.putLong("timer_limit_ms_" + packageName, limitMs);
            if (usedMs > 0L) ed.putLong("timer_used_ms_" + packageName, usedMs);
            ed.apply();
        } catch (Exception e) {
            Log.w(TAG, "Failed to persist timer fallback state for " + packageName, e);
        }
    }
}
