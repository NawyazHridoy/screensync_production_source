package io.screensync.wellness;

import android.app.PendingIntent;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Build;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

public class ScreenTimeGoalWidgetProvider extends AppWidgetProvider {
    private static final String PREFS_NAME = "screensync_wellness_store";

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
            ComponentName cn = new ComponentName(context, ScreenTimeGoalWidgetProvider.class);
            int[] ids = mgr.getAppWidgetIds(cn);
            if (ids != null) {
                for (int id : ids) {
                    updateWidget(context, mgr, id);
                }
            }
        } catch (Throwable ignored) {}
    }

    private static int queryTodayOsScreenUsedMinutes(Context context) {
        if (context == null) return 0;
        try {
            UsageStatsManager usm = (UsageStatsManager) context.getSystemService(Context.USAGE_STATS_SERVICE);
            if (usm == null) return 0;
            Calendar cal = Calendar.getInstance();
            cal.set(Calendar.HOUR_OF_DAY, 0);
            cal.set(Calendar.MINUTE, 0);
            cal.set(Calendar.SECOND, 0);
            cal.set(Calendar.MILLISECOND, 0);
            long startOfDayMs = cal.getTimeInMillis();
            long nowMs = System.currentTimeMillis();

            Set<String> excluded = new HashSet<>();
            excluded.add("android");
            excluded.add("com.android.systemui");
            excluded.add("com.android.settings");
            excluded.add(context.getPackageName());
            try {
                PackageManager pm = context.getPackageManager();
                if (pm != null) {
                    Intent homeIntent = new Intent(Intent.ACTION_MAIN);
                    homeIntent.addCategory(Intent.CATEGORY_HOME);
                    List<ResolveInfo> homeList = pm.queryIntentActivities(homeIntent, PackageManager.MATCH_DEFAULT_ONLY);
                    if (homeList != null) {
                        for (ResolveInfo ri : homeList) {
                            if (ri != null && ri.activityInfo != null && ri.activityInfo.packageName != null) {
                                excluded.add(ri.activityInfo.packageName);
                            }
                        }
                    }
                }
            } catch (Throwable ignored) {}

            Map<String, UsageStats> agg = usm.queryAndAggregateUsageStats(startOfDayMs, nowMs);
            if (agg == null || agg.isEmpty()) return 0;
            long totalFgMs = 0L;
            for (Map.Entry<String, UsageStats> entry : agg.entrySet()) {
                String pkg = entry.getKey();
                UsageStats st = entry.getValue();
                if (pkg == null || st == null || excluded.contains(pkg) || pkg.contains(".launcher")) continue;
                long fg = st.getTotalTimeInForeground();
                if (fg >= 60000L) {
                    totalFgMs += fg;
                }
            }
            return (int) Math.min(1440L, Math.round(totalFgMs / 60000.0));
        } catch (Throwable ignored) {
            return 0;
        }
    }

    public static void updateWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String todayKey = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
            String widgetDayKey = prefs.getString("widget_day_key", "");
            boolean isCurrentDay = todayKey.equals(prefs.getString("current_day_key", ""));
            boolean isWidgetToday = todayKey.equals(widgetDayKey) || (widgetDayKey.isEmpty() && isCurrentDay);
            int usedMins = isWidgetToday ? prefs.getInt("widget_screen_used_mins", 0) : 0;
            int liveOsUsedMins = queryTodayOsScreenUsedMinutes(context);
            usedMins = Math.max(usedMins, liveOsUsedMins);
            boolean hasSyncedGoal = prefs.contains("widget_screen_goal_mins");
            int defaultGoal = 120 + 80;
            int goalMins = Math.max(15, Math.min(960, prefs.getInt("widget_screen_goal_mins", defaultGoal)));
            String statusLabel = usedMins >= goalMins ? "Over Daily Goal" : "Within Daily Goal";

            int pct = Math.min(100, Math.max(0, Math.round((usedMins * 100f) / goalMins)));

            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_screen_time_goal);
            views.setTextViewText(R.id.widgetScreenUsedText, formatHrsMins(usedMins));
            String goalText = hasSyncedGoal
                ? ("Goal: " + formatHrsMins(goalMins) + " • " + statusLabel)
                : context.getString(R.string.widget_set_goal_prompt);
            views.setTextViewText(R.id.widgetScreenGoalText, goalText);
            views.setProgressBar(R.id.widgetScreenProgressBar, 100, pct, false);

            Intent launchIntent = new Intent(context, MainActivity.class);
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent pendingIntent = PendingIntent.getActivity(context, 1001, launchIntent, flags);
            views.setOnClickPendingIntent(R.id.widgetScreenRoot, pendingIntent);

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
