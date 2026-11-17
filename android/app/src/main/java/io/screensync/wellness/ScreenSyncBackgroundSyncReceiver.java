package io.screensync.wellness;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.SystemClock;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

public class ScreenSyncBackgroundSyncReceiver extends BroadcastReceiver {
    public static final String ACTION_PERIODIC_BACKGROUND_SYNC = "io.screensync.wellness.ACTION_PERIODIC_BACKGROUND_SYNC";
    private static final String PREFS_NAME = "screensync_wellness_store";
    private static final int ALARM_REQUEST_CODE = 4401;

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null) return;
        try {
            MainActivity.ensureNotificationChannelsCreated(context);
        } catch (Throwable ignored) {}
        try {
            WellbeingRefreshScheduler.triggerImmediateRefresh(context);
        } catch (Throwable ignored) {}
        try {
            ScreenSyncWidgetUpdater.updateAllWidgets(context);
            final PendingResult pendingResult = goAsync();
            final Context appContext = context.getApplicationContext();
            SYNC_EXECUTOR.execute(() -> {
                try {
                    uploadPendingCountersToSupabaseAsync(appContext);
                } finally {
                    if (pendingResult != null) pendingResult.finish();
                }
            });
        } catch (Throwable ignored) {}
        try {
            evaluateAndDispatchScheduledDailySummaryIfDue(context);
        } catch (Throwable ignored) {}
    }

    private static int parseHHMMToMinutes(String hhmm, int fallback) {
        try {
            if (hhmm == null || !hhmm.contains(":")) return fallback;
            String[] parts = hhmm.split(":");
            int h = Integer.parseInt(parts[0].trim());
            int m = Integer.parseInt(parts[1].trim());
            return h * 60 + m;
        } catch (Exception e) {
            return fallback;
        }
    }

    private static String formatHrsMins(int totalMinutes) {
        int m = Math.max(0, totalMinutes);
        int hrs = m / 60;
        int mins = m % 60;
        if (hrs == 0) return mins + "m";
        if (mins == 0) return hrs + "h";
        return hrs + "h " + mins + "m";
    }

    private static void evaluateAndDispatchScheduledDailySummaryIfDue(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        boolean masterEnabled = prefs.getBoolean("master_enabled", true);
        if (!masterEnabled) return;
        boolean dailySummaryEnabled = prefs.getBoolean("daily_summary_enabled", true);
        if (!dailySummaryEnabled) return;

        String todayStr = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        String lastDispatchedDate = prefs.getString("last_native_daily_summary_date", "");
        if (todayStr.equals(lastDispatchedDate)) return;

        Calendar cal = Calendar.getInstance();
        int curMins = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE);
        String summaryTimeStr = prefs.getString("daily_summary_time", "21:00");
        int targetMins = parseHHMMToMinutes(summaryTimeStr, 21 * 60);
        if (curMins < targetMins) return;

        boolean quietEnabled = prefs.getBoolean("quiet_hours_enabled", true);
        if (quietEnabled) {
            int qStart = parseHHMMToMinutes(prefs.getString("quiet_hours_start", "22:30"), 22 * 60 + 30);
            int qEnd = parseHHMMToMinutes(prefs.getString("quiet_hours_end", "07:00"), 7 * 60);
            boolean inQuietHours = (qStart <= qEnd)
                ? (curMins >= qStart && curMins < qEnd)
                : (curMins >= qStart || curMins < qEnd);
            if (inQuietHours) return;
        }

        int screenUsedMins = prefs.getInt("widget_screen_used_mins", 0);
        int reelsCount = Math.max(prefs.getInt("daily_reel_count", 0), prefs.getInt("widget_reels_count", 0));
        long watchMs = prefs.getLong("daily_watch_duration_ms", 0L);
        int watchMins = Math.max((int) Math.round(watchMs / 60000.0), prefs.getInt("widget_reel_watch_mins", 0));

        String digestBody = "Today: " + formatHrsMins(screenUsedMins) + " screen time • "
            + reelsCount + " Reels (" + formatHrsMins(watchMins) + " watched).";

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            Intent launchIntent = new Intent(context, MainActivity.class);
            launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                piFlags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent contentPi = PendingIntent.getActivity(context, 4402, launchIntent, piFlags);
            int smallIcon = context.getApplicationInfo().icon != 0
                ? context.getApplicationInfo().icon
                : android.R.drawable.ic_dialog_info;

            Notification.Builder nb = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(context, MainActivity.CHANNEL_DAILY_SUMMARY)
                : new Notification.Builder(context);
            nb.setSmallIcon(smallIcon)
                .setContentTitle("Daily Screen Time Digest")
                .setContentText(digestBody)
                .setContentIntent(contentPi)
                .setAutoCancel(true);

            nm.notify(4402, nb.build());
            prefs.edit().putString("last_native_daily_summary_date", todayStr).apply();
        }
    }

    public static void schedulePeriodicSync(Context context) {
        if (context == null) return;
        try {
            AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (alarmManager == null) return;
            Intent intent = new Intent(context, ScreenSyncBackgroundSyncReceiver.class);
            intent.setAction(ACTION_PERIODIC_BACKGROUND_SYNC);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent pendingIntent = PendingIntent.getBroadcast(context, ALARM_REQUEST_CODE, intent, flags);
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String summaryTimeStr = prefs.getString("daily_summary_time", "21:00");
            int targetMins = parseHHMMToMinutes(summaryTimeStr, 21 * 60);
            Calendar nextSummaryCal = Calendar.getInstance();
            nextSummaryCal.set(Calendar.HOUR_OF_DAY, targetMins / 60);
            nextSummaryCal.set(Calendar.MINUTE, targetMins % 60);
            nextSummaryCal.set(Calendar.SECOND, 0);
            nextSummaryCal.set(Calendar.MILLISECOND, 0);
            if (nextSummaryCal.getTimeInMillis() <= System.currentTimeMillis()) {
                nextSummaryCal.add(Calendar.DAY_OF_YEAR, 1);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                boolean canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms();
                if (canExact) {
                    PendingIntent exactPi = PendingIntent.getBroadcast(context, ALARM_REQUEST_CODE + 10, intent, flags);
                    alarmManager.setExactAndAllowWhileIdle(
                        AlarmManager.RTC_WAKEUP,
                        nextSummaryCal.getTimeInMillis(),
                        exactPi
                    );
                }
            }
            // Keep 15-minute fallback sync alarm when exact alarms are unavailable or for periodic background sync
            long intervalMs = AlarmManager.INTERVAL_FIFTEEN_MINUTES;
            long triggerAtMs = SystemClock.elapsedRealtime() + intervalMs;
            alarmManager.setInexactRepeating(
                AlarmManager.ELAPSED_REALTIME_WAKEUP,
                triggerAtMs,
                intervalMs,
                pendingIntent
            );
        } catch (Throwable ignored) {}
    }

    private static final ExecutorService SYNC_EXECUTOR = Executors.newSingleThreadExecutor();

    public static boolean uploadPendingCountersToSupabaseAsync(Context context) {
        if (context == null) return false;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String todayKey = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        String savedDayKey = prefs.getString("current_day_key", "");
        if (!todayKey.equals(savedDayKey)) return false;

        String supabaseUrl = prefs.getString("supabase_project_url", "");
        String supabaseAnonKey = prefs.getString("supabase_anon_key", "");
        String accessToken = prefs.getString("supabase_access_token", "");
        String userId = prefs.getString("supabase_user_id", "");
        if (supabaseUrl == null || supabaseUrl.isEmpty() || accessToken == null || accessToken.isEmpty() || userId == null || userId.isEmpty()) {
            return false;
        }

        int reelsCount = prefs.getInt("daily_reel_count", 0);
        long watchMs = prefs.getLong("daily_watch_duration_ms", 0L);
        long[] backoffDelaysMs = new long[]{0L, 1000L, 2500L};

        SimpleDateFormat isoFmt = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
        isoFmt.setTimeZone(TimeZone.getTimeZone("UTC"));
        String nowIso = isoFmt.format(new Date());

        for (int attempt = 0; attempt < backoffDelaysMs.length; attempt++) {
            if (backoffDelaysMs[attempt] > 0L) {
                try {
                    Thread.sleep(backoffDelaysMs[attempt]);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    return false;
                }
            }
            HttpURLConnection conn = null;
            try {
                String baseUrl = supabaseUrl.replaceAll("/+$", "");
                String endpoint = baseUrl + "/rest/v1/sync_metadata?on_conflict=user_id,installation_id";
                HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
                conn = connection;
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(8000);
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
                conn.setRequestProperty("apikey", supabaseAnonKey);
                conn.setRequestProperty("Authorization", "Bearer " + accessToken);
                conn.setRequestProperty("Prefer", "resolution=merge-duplicates,return=minimal");

                String installationId = prefs.getString("installation_id", userId + "_inst_android");
                String installationKey = prefs.getString("installation_key", "android_device");
                // Schema-aligned sync_metadata payload (replaced non-existent last_sync_day_key / native_daily_reel_count / native_daily_watch_duration_ms columns)
                JSONObject payload = new JSONObject();
                payload.put("user_id", userId);
                payload.put("installation_id", installationId);
                payload.put("installation_key", installationKey);
                payload.put("last_sync_at", nowIso);
                payload.put("sync_version", Math.max(1, reelsCount));
                payload.put("updated_at", nowIso);

                byte[] bodyBytes = payload.toString().getBytes(StandardCharsets.UTF_8);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(bodyBytes);
                    os.flush();
                }
                int status = conn.getResponseCode();
                if (status >= 200 && status < 300) {
                    // Also upsert tracker_heartbeats with native background receiver liveness
                    HttpURLConnection hbConn = null;
                    try {
                        String hbEndpoint = baseUrl + "/rest/v1/tracker_heartbeats?on_conflict=user_id,installation_id,tracker_name";
                        hbConn = (HttpURLConnection) new URL(hbEndpoint).openConnection();
                        hbConn.setRequestMethod("POST");
                        hbConn.setConnectTimeout(6000);
                        hbConn.setReadTimeout(6000);
                        hbConn.setDoOutput(true);
                        hbConn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
                        hbConn.setRequestProperty("apikey", supabaseAnonKey);
                        hbConn.setRequestProperty("Authorization", "Bearer " + accessToken);
                        hbConn.setRequestProperty("Prefer", "resolution=merge-duplicates,return=minimal");

                        JSONObject hbPayload = new JSONObject();
                        hbPayload.put("user_id", userId);
                        hbPayload.put("installation_id", installationId);
                        hbPayload.put("tracker_name", "android_background_receiver");
                        hbPayload.put("last_seen_utc", nowIso);
                        hbPayload.put("tick_count", Math.max(1, reelsCount));
                        hbPayload.put("updated_at", nowIso);
                        byte[] hbBytes = hbPayload.toString().getBytes(StandardCharsets.UTF_8);
                        try (OutputStream hbOs = hbConn.getOutputStream()) {
                            hbOs.write(hbBytes);
                            hbOs.flush();
                        }
                        hbConn.getResponseCode();
                    } catch (Exception ignoredHb) {
                    } finally {
                        if (hbConn != null) hbConn.disconnect();
                    }
                    prefs.edit()
                        .putLong("last_native_cloud_sync_ms", System.currentTimeMillis())
                        .putLong("last_synced_watch_duration_ms", watchMs)
                        .apply();
                    return true;
                }
            } catch (Exception ignored) {
            } finally {
                if (conn != null) conn.disconnect();
            }
        }
        return false;
    }

}
