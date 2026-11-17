package io.screensync.wellness;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;

public final class ScreenSyncWidgetUpdater {
    private ScreenSyncWidgetUpdater() {}

    public static void updateAllWidgets(Context context) {
        if (context == null) return;
        try {
            // CAT11-17: Single direct RemoteViews update pass via AppWidgetManager (eliminates double-update broadcast IPC)
            ScreenTimeGoalWidgetProvider.updateAllInstances(context);
            ReelTrackerWidgetProvider.updateAllInstances(context);
        } catch (Throwable ignored) {}
    }
}
