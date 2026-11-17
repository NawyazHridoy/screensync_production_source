package io.screensync.wellness;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.widget.RemoteViews;

public class ReelTrackerWidgetProvider extends AppWidgetProvider {
    private static final String PREFS_NAME = "screensync_wellness_store";
    private static final String[] SHORT_FORM_PACKAGES = new String[] {
        "com.instagram.android",
        "com.instagram.lite",
        "com.google.android.youtube",
        "com.zhiliaoapp.musically",
        "com.zhiliaoapp.musically.go",
        "com.ss.android.ugc.trill",
        "com.tiktok.lite.go",
        "com.facebook.katana",
        "com.facebook.lite",
        "com.facebook.orca",
        "com.whatsapp",
        "com.whatsapp.w4b",
        "com.snapchat.android",
        "com.twitter.android",
        "com.reddit.frontpage"
    };

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        if (context == null || appWidgetManager == null || appWidgetIds == null) return;
        for (int appWidgetId : appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId);
        }
    }

    public static void updateAllInstances(Context context) {
        if (context == null) return;
        try {
            AppWidgetManager mgr = AppWidgetManager.getInstance(context);
            ComponentName cn = new ComponentName(context, ReelTrackerWidgetProvider.class);
            int[] ids = mgr.getAppWidgetIds(cn);
            if (ids != null) {
                for (int id : ids) {
                    updateWidget(context, mgr, id);
                }
            }
        } catch (Throwable ignored) {}
    }

    public static void updateWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        SharedPreferences dayPrefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String todayKey = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(new java.util.Date());
        boolean isCurrentDay = todayKey.equals(dayPrefs.getString("current_day_key", ""));
        try {
            // Validate current_day_key & widget_day_key before displaying daily_reel_count (reset to 0 after midnight, CAT11-16)
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String savedWidgetDayKey = prefs.getString("widget_day_key", "");
            boolean isWidgetToday = todayKey.equals(savedWidgetDayKey) || (savedWidgetDayKey.isEmpty() && isCurrentDay);
            int dailyReelCount = isCurrentDay ? prefs.getInt("daily_reel_count", 0) : 0;
            int widgetReelsCount = isWidgetToday ? prefs.getInt("widget_reels_count", -1) : -1;
            int reelCount = Math.max(dailyReelCount, Math.max(0, widgetReelsCount));

            long dailyWatchMs = isCurrentDay ? prefs.getLong("daily_watch_duration_ms", 0L) : 0L;
            int widgetWatchMins = isWidgetToday ? prefs.getInt("widget_reel_watch_mins", -1) : -1;
            int watchMins = Math.max((int) Math.round(dailyWatchMs / 60000.0), Math.max(0, widgetWatchMins));

            int reelGoalMins = Math.max(5, Math.min(480, prefs.getInt("widget_reel_goal_mins", 60)));

            if (isCurrentDay && reelCount == 0 && watchMins == 0) {
                int totalReels = 0;
                long totalWatchDurationMs = 0L;
                for (String pkg : SHORT_FORM_PACKAGES) {
                    totalReels += Math.max(
                        prefs.getInt("pkg_count_" + pkg, 0),
                        prefs.getInt("reelCount_" + pkg, 0)
                    );
                    totalWatchDurationMs += Math.max(
                        prefs.getLong("pkg_watch_ms_" + pkg, 0L),
                        prefs.getLong("watchDurationMs_" + pkg, 0L)
                    );
                }
                if (totalReels > 0) reelCount = totalReels;
                if (totalWatchDurationMs > 0L) watchMins = (int) Math.round(totalWatchDurationMs / 60000.0);
            }

            int pct = Math.min(100, Math.max(0, Math.round((watchMins * 100f) / reelGoalMins)));

            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_reel_tracker);
            views.setTextViewText(R.id.widgetReelsCountText, reelCount + (reelCount == 1 ? " Reel" : " Reels"));
            views.setTextViewText(R.id.widgetReelWatchTimeText, formatHrsMins(watchMins) + " watched • Goal " + formatHrsMins(reelGoalMins));
            views.setProgressBar(R.id.widgetReelGoalProgressBar, 100, pct, false);

            Intent launchIntent = new Intent(context, MainActivity.class);
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent pendingIntent = PendingIntent.getActivity(context, 1002, launchIntent, flags);
            views.setOnClickPendingIntent(R.id.widgetReelRoot, pendingIntent);

            appWidgetManager.updateAppWidget(appWidgetId, views);
        } catch (Throwable ignored) {}
    }

    private static String formatHrsMins(int totalMinutes) {
        int m = Math.max(0, totalMinutes);
        int hrs = m / 60;
        int mins = m % 60;
        if (hrs == 0) return mins + "m";
        if (mins == 0) return hrs + "h";
        return hrs + "h " + mins + "m";
    }
}
