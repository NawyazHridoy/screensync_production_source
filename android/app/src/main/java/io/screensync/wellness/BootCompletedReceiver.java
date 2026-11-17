package io.screensync.wellness;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

public class BootCompletedReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null || intent.getAction() == null) return;
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
                || Intent.ACTION_USER_PRESENT.equals(action)
                || "android.intent.action.QUICKBOOT_POWERON".equals(action)
                || "com.htc.intent.action.QUICKBOOT_POWERON".equals(action)
                || "io.screensync.wellness.ACTION_KEEPALIVE_PULSE".equals(action)) {
            try {
                MainActivity.ensureNotificationChannelsCreated(context);
            } catch (Throwable ignored) {}
            try {
                ScreenSyncBackgroundSyncReceiver.schedulePeriodicSync(context);
            } catch (Throwable ignored) {}
            try {
                WellbeingRefreshScheduler.triggerImmediateRefresh(context);
            } catch (Throwable ignored) {}
            try {
                ScreenSyncWidgetUpdater.updateAllWidgets(context);
            } catch (Throwable ignored) {}
            try {
                SharedPreferences prefs = context.getSharedPreferences("screensync_wellness_store", Context.MODE_PRIVATE);
                prefs.edit().putLong("last_boot_or_wakeup_epoch_ms", System.currentTimeMillis()).apply();
                Intent wakeSync = new Intent("io.screensync.wellness.ACTION_SCREEN_WAKE_SYNC");
                wakeSync.setPackage(context.getPackageName());
                context.sendBroadcast(wakeSync);
            } catch (Exception ignored) {
            }
        }
    }
}
