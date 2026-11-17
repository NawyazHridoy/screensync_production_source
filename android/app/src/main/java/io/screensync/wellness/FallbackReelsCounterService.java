package io.screensync.wellness;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.AudioPlaybackConfiguration;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Date;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * FallbackReelsCounterService (Part 16 Feature 2.2)
 * Clean-room backup estimation service that runs ONLY when ScreenSyncAccessibilityService
 * is disabled. Combines UsageStatsManager foreground sessions in target short-video apps
 * with AudioManager.AudioPlaybackCallback (USAGE_MEDIA unmuted sessions inspected via
 * piid and mutedState tokens) to estimate reel counts without ever running simultaneously
 * with Accessibility.
 */
public class FallbackReelsCounterService extends Service {

    private static final String CHANNEL_ID = "screensync_fallback_counter_channel";
    private static final int NOTIFICATION_ID = 41022;
    private static final String PREF_FALLBACK = "screensync_fallback_counter_store";
    private static final long POLL_INTERVAL_MS = 15000L;
    private static final long AVG_REEL_DURATION_MS = 18000L;

    public static final Pattern PIID_PATTERN = Pattern.compile("piid:(\\d+)");
    public static final Pattern MUTED_STATE_PATTERN = Pattern.compile("mutedState:([^\\s,)]+)");

    private static final Set<String> TARGET_SOCIAL_PACKAGES = new HashSet<>(Arrays.asList(
        "com.instagram.android",
        "com.instagram.lite",
        "com.google.android.youtube",
        "com.zhiliaoapp.musically",
        "com.ss.android.ugc.trill",
        "com.facebook.katana",
        "com.facebook.lite",
        "com.snapchat.android"
    ));

    private static volatile boolean running = false;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Set<String> activeAudioSessionKeys = new LinkedHashSet<>();
    private AudioManager audioManager;
    private AudioManager.AudioPlaybackCallback audioCallback;
    private volatile boolean mediaAudioPlayingUnmuted = false;
    private volatile String currentForegroundTargetPkg = null;
    private long lastPollMs = 0L;

    public static boolean isRunning() {
        return running;
    }

    public static void stopIfAccessibilityActive(Context context) {
        if (context == null) return;
        if (ScreenSyncAccessibilityService.getActiveInstance() != null || running) {
            try {
                context.stopService(new Intent(context, FallbackReelsCounterService.class));
            } catch (Exception ignored) {
            }
            running = false;
        }
    }

    private final Runnable pollRunnable = new Runnable() {
        @Override
        public void run() {
            if (ScreenSyncAccessibilityService.getActiveInstance() != null) {
                stopSelf();
                return;
            }
            evaluateFallbackEstimation();
            handler.postDelayed(this, POLL_INTERVAL_MS);
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        if (ScreenSyncAccessibilityService.getActiveInstance() != null) {
            stopSelf();
            return;
        }
        running = true;
        lastPollMs = System.currentTimeMillis();
        ensureChannel();
        startForeground(NOTIFICATION_ID, buildNotification());
        registerAudioCallback();
        handler.postDelayed(pollRunnable, POLL_INTERVAL_MS);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (ScreenSyncAccessibilityService.getActiveInstance() != null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        handler.removeCallbacks(pollRunnable);
        unregisterAudioCallback();
        synchronized (activeAudioSessionKeys) {
            activeAudioSessionKeys.clear();
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    public static boolean isConfigUnmutedMediaSession(String configDesc) {
        if (configDesc == null || configDesc.isEmpty()) return true;
        Matcher mutedMatcher = MUTED_STATE_PATTERN.matcher(configDesc);
        if (mutedMatcher.find()) {
            String mutedVal = mutedMatcher.group(1);
            if (mutedVal != null) {
                String norm = mutedVal.trim().toLowerCase(Locale.US);
                if ("muted".equals(norm) || "true".equals(norm) || "1".equals(norm)) {
                    return false;
                }
            }
        }
        return true;
    }

    public static String extractPiidToken(String configDesc) {
        if (configDesc == null || configDesc.isEmpty()) return "default";
        Matcher m = PIID_PATTERN.matcher(configDesc);
        return m.find() ? m.group(1) : "default";
    }

    private void registerAudioCallback() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try {
            audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (audioManager == null) return;
            audioCallback = new AudioManager.AudioPlaybackCallback() {
                @Override
                public void onPlaybackConfigChanged(List<AudioPlaybackConfiguration> configs) {
                    boolean activeUnmutedMedia = false;
                    if (configs != null) {
                        int vol = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
                        if (vol > 0) {
                            for (AudioPlaybackConfiguration cfg : configs) {
                                if (cfg == null) continue;
                                AudioAttributes attrs = cfg.getAudioAttributes();
                                if (attrs != null && attrs.getUsage() == AudioAttributes.USAGE_MEDIA) {
                                    String rawDesc = cfg.toString();
                                    if (isConfigUnmutedMediaSession(rawDesc)) {
                                        activeUnmutedMedia = true;
                                        String piid = extractPiidToken(rawDesc);
                                        String pkg = currentForegroundTargetPkg != null ? currentForegroundTargetPkg : "media";
                                        synchronized (activeAudioSessionKeys) {
                                            if (activeAudioSessionKeys.size() > 64) {
                                                activeAudioSessionKeys.clear();
                                            }
                                            activeAudioSessionKeys.add("audio_" + pkg + "_" + piid);
                                        }
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    mediaAudioPlayingUnmuted = activeUnmutedMedia;
                }
            };
            audioManager.registerAudioPlaybackCallback(audioCallback, handler);
        } catch (Exception ignored) {
        }
    }

    private void unregisterAudioCallback() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioManager != null && audioCallback != null) {
            try {
                audioManager.unregisterAudioPlaybackCallback(audioCallback);
            } catch (Exception ignored) {
            }
        }
    }

    private void evaluateFallbackEstimation() {
        long nowMs = System.currentTimeMillis();
        long beginMs = Math.max(nowMs - POLL_INTERVAL_MS * 2, lastPollMs);
        lastPollMs = nowMs;
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null && !pm.isInteractive()) {
                currentForegroundTargetPkg = null;
                synchronized (activeAudioSessionKeys) {
                    activeAudioSessionKeys.clear();
                }
                return;
            }
            UsageStatsManager usm = (UsageStatsManager) getSystemService(Context.USAGE_STATS_SERVICE);
            if (usm == null) return;
            UsageEvents events = usm.queryEvents(beginMs, nowMs);
            if (events != null) {
                UsageEvents.Event ev = new UsageEvents.Event();
                while (events.hasNextEvent()) {
                    events.getNextEvent(ev);
                    int type = ev.getEventType();
                    String pkg = ev.getPackageName();
                    if (type == UsageEvents.Event.ACTIVITY_RESUMED && pkg != null) {
                        if (TARGET_SOCIAL_PACKAGES.contains(pkg)) {
                            currentForegroundTargetPkg = pkg;
                        } else if (!pkg.equals(getPackageName()) && !"com.android.systemui".equals(pkg)) {
                            currentForegroundTargetPkg = null;
                        }
                    } else if (type == 16 /* SCREEN_NON_INTERACTIVE */) {
                        currentForegroundTargetPkg = null;
                    }
                }
            }
            String activeTargetPkg = currentForegroundTargetPkg;
            if (activeTargetPkg != null && mediaAudioPlayingUnmuted) {
                SharedPreferences prefs = getSharedPreferences(PREF_FALLBACK, Context.MODE_PRIVATE);
                String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date(nowMs));
                String keyCount = "fallback_count_" + today;
                String keyMs = "fallback_ms_" + today;
                long prevMs = prefs.getLong(keyMs, 0L) + POLL_INTERVAL_MS;
                int prevCount = prefs.getInt(keyCount, 0);
                int estimatedByDuration = (int) (prevMs / AVG_REEL_DURATION_MS);
                int distinctPiidCount;
                synchronized (activeAudioSessionKeys) {
                    distinctPiidCount = activeAudioSessionKeys.size();
                }
                int estimatedTotal = Math.max(estimatedByDuration, distinctPiidCount);
                SharedPreferences.Editor ed = prefs.edit().putLong(keyMs, prevMs);
                if (estimatedTotal > prevCount) {
                    ed.putInt(keyCount, estimatedTotal);
                }
                ed.putString("last_estimated_pkg", activeTargetPkg);
                ed.apply();
            }
        } catch (Exception ignored) {
        }
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID,
                    "Backup Reel Estimation",
                    NotificationManager.IMPORTANCE_LOW
                );
                ch.setDescription("Estimates reels when Accessibility is off");
                nm.createNotificationChannel(ch);
            }
        }
    }

    private Notification buildNotification() {
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        return builder
            .setContentTitle("Backup counting is on")
            .setContentText("Estimating your reels while Accessibility is off")
            .setSmallIcon(android.R.drawable.ic_menu_recent_history)
            .setOngoing(true)
            .build();
    }
}
