package io.screensync.wellness;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/**
 * Modular Firebase Cloud Messaging (FCM) Service for ScreenSync (io.screensync.wellness).
 * Captures registration tokens, forwards them to the active WebView bridge, and renders
 * incoming push notifications using ScreenSync's notification channels.
 */
public class ScreenSyncFirebaseMessagingService extends FirebaseMessagingService {
    public static final String PREFS_NAME = "screensync_fcm_prefs";
    public static final String KEY_FCM_TOKEN = "fcm_token";
    public static final String DEFAULT_CHANNEL_ID = "screensync_daily_summary";
    public static final String GOAL_CHANNEL_ID = "screensync_goal_alerts";

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        try {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().putString(KEY_FCM_TOKEN, token).apply();
        } catch (Exception ignored) {}

        try {
            MainActivity.dispatchNativePushTokenToWeb(token);
        } catch (Exception ignored) {}
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);

        String title = "ScreenSync";
        String body = "";
        String channelId = DEFAULT_CHANNEL_ID;

        if (remoteMessage.getNotification() != null) {
            if (remoteMessage.getNotification().getTitle() != null) {
                title = remoteMessage.getNotification().getTitle();
            }
            if (remoteMessage.getNotification().getBody() != null) {
                body = remoteMessage.getNotification().getBody();
            }
            if (remoteMessage.getNotification().getChannelId() != null) {
                channelId = remoteMessage.getNotification().getChannelId();
            }
        }

        Map<String, String> data = remoteMessage.getData();
        String surveyId = "";
        String surveyUrl = "";
        String notifType = "";
        if (data != null && !data.isEmpty()) {
            if (data.containsKey("title") && data.get("title") != null && !data.get("title").isEmpty()) {
                title = data.get("title");
            }
            if (data.containsKey("body") && data.get("body") != null && !data.get("body").isEmpty()) {
                body = data.get("body");
            }
            if (data.containsKey("channelId") && data.get("channelId") != null && !data.get("channelId").isEmpty()) {
                channelId = data.get("channelId");
            } else if ("goal_alert".equals(data.get("type"))) {
                channelId = GOAL_CHANNEL_ID;
            }
            if (data.get("survey_id") != null) surveyId = data.get("survey_id").trim();
            if (data.get("survey_url") != null && !data.get("survey_url").trim().isEmpty()) {
                surveyUrl = data.get("survey_url").trim();
            } else if (data.get("url") != null) {
                surveyUrl = data.get("url").trim();
            }
            if (data.get("type") != null) notifType = data.get("type").trim();
        }

        if (!surveyId.isEmpty() || !surveyUrl.isEmpty() || "research_survey".equals(notifType)) {
            try {
                SharedPreferences surveyPrefs = getSharedPreferences("screensync_prefs", Context.MODE_PRIVATE);
                surveyPrefs.edit()
                    .putString("pending_survey_id", surveyId)
                    .putString("pending_survey_url", surveyUrl)
                    .putString("pending_survey_title", title)
                    .putString("pending_survey_body", body)
                    .apply();
            } catch (Exception ignored) {}
            try {
                MainActivity.dispatchIncomingPushSurveyToWeb(surveyId, surveyUrl, title, body);
            } catch (Exception ignored) {}
        }

        showPushNotification(title, body, channelId, surveyId, surveyUrl, notifType);
    }

    private void showPushNotification(String title, String body, String channelId, String surveyId, String surveyUrl, String notifType) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                return;
            }
        }

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (nm.getNotificationChannel(channelId) == null) {
                NotificationChannel ch = new NotificationChannel(
                    channelId,
                    "ScreenSync Push Notifications",
                    NotificationManager.IMPORTANCE_HIGH
                );
                nm.createNotificationChannel(ch);
            }
        }

        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (surveyId != null && !surveyId.isEmpty()) launchIntent.putExtra("survey_id", surveyId);
        if (surveyUrl != null && !surveyUrl.isEmpty()) launchIntent.putExtra("survey_url", surveyUrl);
        if (notifType != null && !notifType.isEmpty()) launchIntent.putExtra("notif_type", notifType);
        if (title != null && !title.isEmpty()) launchIntent.putExtra("survey_title", title);
        if (body != null && !body.isEmpty()) launchIntent.putExtra("survey_body", body);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, launchIntent, flags);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, channelId)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pendingIntent);

        try {
            int notifId = (int) (System.currentTimeMillis() & 0x7FFFFFFF);
            NotificationManagerCompat.from(this).notify(notifId, builder.build());
        } catch (SecurityException ignored) {}
    }
}
