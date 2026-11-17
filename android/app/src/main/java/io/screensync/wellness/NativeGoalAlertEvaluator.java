package io.screensync.wellness;

import android.content.Context;
import android.content.SharedPreferences;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * NativeGoalAlertEvaluator — Evaluates daily Screen Time and Reel Watch goals
 * natively in the background when the WebView is suspended or closed.
 */
public final class NativeGoalAlertEvaluator {
    private static final String PREFS_NAME = "screensync_wellness_store";

    private NativeGoalAlertEvaluator() {}

    public static String getTodayKey() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    public static void onDayBoundary(Context context) {
        if (context == null) return;
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String day = getTodayKey();
            prefs.edit()
                .putString("goal_day_key", day)
                .putString("widget_day_key", day)
                .putInt("widget_screen_used_mins", 0)
                .putInt("widget_reel_watch_mins", 0)
                .putInt("widget_reels_count", 0)
                .putString("widget_status_label", "Within Daily Goal")
                .apply();
        } catch (Throwable ignored) {}
    }

    public static void evaluate(Context context, String reason) {
        if (context == null) return;
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String day = getTodayKey();
            String storedDay = prefs.getString("goal_day_key", "");
            if (!day.equals(storedDay)) {
                onDayBoundary(context);
            }

            boolean masterEnabled = prefs.getBoolean("master_enabled", true);
            boolean goalReachedEnabled = prefs.getBoolean("goal_reached_enabled", true);
            if (!masterEnabled || !goalReachedEnabled) return;

            boolean isEditReason = "GOAL_UPDATED".equals(reason) || "TOGGLE_ENABLED".equals(reason);
            String uid = prefs.getString("supabase_user_id", "local_device_user");
            if (uid == null || uid.trim().isEmpty()) uid = "local_device_user";

            boolean screenEnabled = prefs.getBoolean("widget_screen_goal_enabled", true);
            if (screenEnabled && prefs.contains("widget_screen_goal_mins")) {
                int screenGoalMins = Math.max(15, Math.min(960, prefs.getInt("widget_screen_goal_mins", 200)));
                int screenUsedMins = prefs.getInt("widget_screen_used_mins", 0);
                prefs.edit().putString("widget_status_label", screenUsedMins >= screenGoalMins ? "Over Daily Goal" : "Within Daily Goal").apply();
                if (screenUsedMins >= screenGoalMins && !isEditReason) {
                    String firedKey = "goal_alert_fired_" + uid + "_SCREEN_" + day + "_" + screenGoalMins;
                    if (!prefs.contains(firedKey)) {
                        prefs.edit().putLong(firedKey, System.currentTimeMillis()).apply();
                        appendOutboxEvent(prefs, uid, "SCREEN_TIME_GOAL", day, screenGoalMins, screenUsedMins);
                        ScreenSyncAccessibilityService svc = ScreenSyncAccessibilityService.getActiveInstance();
                        if (svc != null) {
                            svc.showTransientGoalAlertOverlay(
                                "Screen Time Goal Reached",
                                "You have reached your " + screenGoalMins + "m daily screen time limit.",
                                5000L
                            );
                        }
                    }
                }
            }

            boolean reelEnabled = prefs.getBoolean("widget_reel_goal_enabled", true);
            if (reelEnabled && prefs.contains("widget_reel_goal_mins")) {
                int reelGoalMins = Math.max(5, Math.min(480, prefs.getInt("widget_reel_goal_mins", 60)));
                int floorWatchMins = (int) (Math.max(0L, prefs.getLong("daily_watch_duration_ms", 0L)) / 60000L);
                int reelUsedMins = Math.max(prefs.getInt("widget_reel_watch_mins", 0), floorWatchMins);
                if (reelUsedMins >= reelGoalMins && !isEditReason) {
                    String firedKey = "goal_alert_fired_" + uid + "_REEL_" + day + "_" + reelGoalMins;
                    if (!prefs.contains(firedKey)) {
                        prefs.edit().putLong(firedKey, System.currentTimeMillis()).apply();
                        appendOutboxEvent(prefs, uid, "REEL_WATCH_GOAL", day, reelGoalMins, reelUsedMins);
                        ScreenSyncAccessibilityService svc = ScreenSyncAccessibilityService.getActiveInstance();
                        if (svc != null) {
                            svc.showTransientGoalAlertOverlay(
                                "Reel Watch Goal Reached",
                                "You have reached your " + reelGoalMins + "m daily reel watch limit.",
                                5000L
                            );
                        }
                    }
                }
            }
        } catch (Throwable ignored) {}
    }

    private static void appendOutboxEvent(
        SharedPreferences prefs,
        String uid,
        String goalType,
        String day,
        int goalMinutes,
        int usedMinutes
    ) {
        try {
            String raw = prefs.getString("pending_goal_alert_events_json", "[]");
            JSONArray arr = new JSONArray(raw != null ? raw : "[]");
            String eventId = "goal_evt_" + uid + "_" + goalType + "_" + day + "_g" + goalMinutes;
            JSONObject ev = new JSONObject();
            ev.put("eventId", eventId);
            ev.put("goalType", goalType);
            ev.put("goalPeriodDate", day);
            ev.put("goalMinutes", goalMinutes);
            ev.put("usedMinutes", usedMinutes);
            ev.put("createdAtMs", System.currentTimeMillis());
            arr.put(ev);
            prefs.edit().putString("pending_goal_alert_events_json", arr.toString()).apply();
        } catch (Throwable ignored) {}
    }
}
