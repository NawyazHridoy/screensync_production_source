package io.screensync.wellness;

import io.screensync.wellness.security.StringVault;

import android.annotation.SuppressLint;
import android.app.AppOpsManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationChannelGroup;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.appwidget.AppWidgetManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Rect;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.os.SystemClock;
import android.os.Process;
import android.provider.Settings;
import android.util.Base64;
import android.view.DisplayCutout;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

// Encrypted session storage via AndroidKeyStore with AES/GCM/NoPadding
public class MainActivity extends AppCompatActivity {
    private static MainActivity activeInstance;
    private WebView webView;
    private BroadcastReceiver screenWakeSyncReceiver;
    private AppUsageDatabaseHelper usageDbHelper;
    private UsageEventIngestionEngine usageIngestionEngine;
    private ScreenTimeSessionCalculator sessionCalculator;
    private AppTimerSuspensionManager appTimerSuspensionManager;
    private BroadcastReceiver packageChangeReceiver;
    private String cachedInstalledAppsJson = null;
    private long cachedInstalledAppsAtMs = 0L;
    private long lastUsageIngestionAtMs = 0L;
    private boolean isAwaitingRuntimePermissionResult = false;
    private android.app.AlertDialog activePermissionDialog = null;
    private final java.util.concurrent.ConcurrentHashMap<String, String> appLabelCache =
        new java.util.concurrent.ConcurrentHashMap<>();
    private final Map<String, String> appIconCache =
        new java.util.concurrent.ConcurrentHashMap<>();

    public static final String WELLNESS_CHANNEL_GROUP_ID = "screensync_wellness_group";
    public static final String NOTIFICATION_CHANNEL_GROUP_ID = "screensync_notification_group";
    public static final String CHANNEL_GOAL_ALERTS = "screensync_goal_alerts";
    public static final String CHANNEL_APP_TIMERS = "screensync_app_timers";
    public static final String CHANNEL_BREAK_REMINDERS = "screensync_break_reminders";
    public static final String CHANNEL_WELLNESS_NUDGES = "screensync_wellness_nudges";
    public static final String CHANNEL_WIND_DOWN = "screensync_wind_down";
    public static final String CHANNEL_DAILY_SUMMARY = "screensync_daily_summary";
    public static final String CHANNEL_LIVE_TRACKING = "screensync_live_tracking";
    public static final String CHANNEL_HEARING_HEALTH = "screensync_hearing_health";
    public static final String CHANNEL_SECURITY_ALERTS = "screensync_security_alerts";
    private volatile String lastNotificationDispatchResultJson = "{\"ok\":true,\"status\":\"READY\"}";

    private static final Set<String> STATIC_OEM_EXCLUSIONS = new HashSet<>(Arrays.asList(
        "android",
        "com.android.systemui",
        "com.android.settings",
        "com.android.launcher",
        "com.android.launcher3",
        "com.google.android.apps.nexuslauncher",   // Google Pixel Launcher
        "com.sec.android.app.launcher",            // Samsung OneUI Home
        "com.miui.home",                           // Xiaomi / Redmi / POCO MIUI & HyperOS Home
        "com.mi.android.globallauncher",           // POCO Launcher
        "com.bbk.launcher2",                       // Vivo / iQOO FuntouchOS & OriginOS Launcher
        "com.vivo.launcher",                       // Vivo Launcher
        "com.oppo.launcher",                       // OPPO ColorOS Launcher
        "com.heytap.launcher",                     // OPPO / Realme HeyTap Launcher
        "com.realme.launcher",                     // Realme UI Launcher
        "net.oneplus.launcher",                    // OnePlus OxygenOS Launcher
        "com.oneplus.brickmode",                   // OnePlus Zen Mode
        "com.motorola.launcher3",                  // Motorola Moto App Launcher
        "com.nothing.launcher",                    // Nothing OS Launcher
        "com.asus.launcher",                       // ASUS ZenUI / ROG Launcher
        "com.huawei.android.launcher",             // Huawei EMUI Launcher
        "com.hihonor.android.launcher",            // Honor MagicOS Launcher
        "com.transsion.XOSLauncher",               // Infinix XOS Launcher
        "com.transsion.hilauncher",                // Tecno HiOS Launcher
        "com.transsion.itel.launcher",             // Itel Launcher
        "com.sonyericsson.home",                   // Sony Xperia Home
        "com.lge.launcher3"                        // LG Home
    ));

    /**
     * Pass 22 Task 22.1: Upfront Notification Channel Group & 5-Channel Initialization
     * Executed before POST_NOTIFICATIONS runtime request on Android 8.0–15+ and on boot/update.
     */
    public static void ensureNotificationChannelsCreated(Context context) {
        if (context == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                NotificationManager nm =
                    (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm == null) return;

                NotificationChannelGroup wellnessGroup = new NotificationChannelGroup(
                    WELLNESS_CHANNEL_GROUP_ID,
                    "ScreenSync Digital Wellness"
                );
                nm.createNotificationChannelGroup(wellnessGroup);
                NotificationChannelGroup notifGroup = new NotificationChannelGroup(
                    NOTIFICATION_CHANNEL_GROUP_ID,
                    "ScreenSync Notifications"
                );
                nm.createNotificationChannelGroup(notifGroup);

                // 1. Goal & App Limit Alerts
                NotificationChannel chGoals = new NotificationChannel(
                    CHANNEL_GOAL_ALERTS,
                    "Screen Time & Reel Goal Alerts",
                    NotificationManager.IMPORTANCE_HIGH
                );
                chGoals.setDescription("Heads-up and lock-screen alerts when daily screen time, reel count, or per-app timer limits are reached.");
                chGoals.setGroup(WELLNESS_CHANNEL_GROUP_ID);
                chGoals.setShowBadge(true);
                chGoals.enableVibration(true);
                chGoals.enableLights(true);
                chGoals.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

                // 2. Mindful Break & Detox Reminders
                NotificationChannel chBreaks = new NotificationChannel(
                    CHANNEL_BREAK_REMINDERS,
                    "Mindful Break & Detox Reminders",
                    NotificationManager.IMPORTANCE_HIGH
                );
                chBreaks.setDescription("Periodic mindful break prompts, continuous scroll detox cooldowns, and earphone volume safety alerts.");
                chBreaks.setGroup(WELLNESS_CHANNEL_GROUP_ID);
                chBreaks.setShowBadge(true);
                chBreaks.enableVibration(true);
                chBreaks.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

                // 3. Bedtime Wind-Down & Quiet Hours
                NotificationChannel chWindDown = new NotificationChannel(
                    CHANNEL_WIND_DOWN,
                    "Bedtime Wind-Down & Quiet Hours",
                    NotificationManager.IMPORTANCE_DEFAULT
                );
                chWindDown.setDescription("Bedtime wind-down reminders and quiet-hours transitions.");
                chWindDown.setGroup(WELLNESS_CHANNEL_GROUP_ID);
                chWindDown.setShowBadge(true);
                chWindDown.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

                // 4. Daily Usage Digest & Streak Milestones
                NotificationChannel chSummary = new NotificationChannel(
                    CHANNEL_DAILY_SUMMARY,
                    "Daily Usage Digest & Streak Milestones",
                    NotificationManager.IMPORTANCE_DEFAULT
                );
                chSummary.setDescription("End-of-day cross-device screen time summaries and weekly challenge streak milestones.");
                chSummary.setGroup(WELLNESS_CHANNEL_GROUP_ID);
                chSummary.setShowBadge(true);

                // 5. Cross-Device Sync & Live Tracking Status
                NotificationChannel chLive = new NotificationChannel(
                    CHANNEL_LIVE_TRACKING,
                    "Cross-Device Sync & Live Tracking Status",
                    NotificationManager.IMPORTANCE_LOW
                );
                chLive.setDescription("Silent background cross-device sync and active focus session status.");
                chLive.setGroup(WELLNESS_CHANNEL_GROUP_ID);
                chLive.setShowBadge(false);

                // 6. Earphone & Hearing Health Alerts (CAT10-03)
                NotificationChannel chHearing = new NotificationChannel(
                    CHANNEL_HEARING_HEALTH,
                    "Earphone & Hearing Health Alerts",
                    NotificationManager.IMPORTANCE_HIGH
                );
                chHearing.setDescription("WHO 80 dBA safe listening exposure warnings for connected headphones and earbuds.");
                chHearing.setGroup(WELLNESS_CHANNEL_GROUP_ID);
                chHearing.setShowBadge(true);
                chHearing.enableVibration(true);
                chHearing.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

                // 7. Account & Device Security Alerts (CAT10-03)
                NotificationChannel chSecurity = new NotificationChannel(
                    CHANNEL_SECURITY_ALERTS,
                    "Account & Device Security Alerts",
                    NotificationManager.IMPORTANCE_HIGH
                );
                chSecurity.setDescription("Critical account security, new device login, and companion integrity alerts.");
                chSecurity.setGroup(WELLNESS_CHANNEL_GROUP_ID);
                chSecurity.setShowBadge(true);
                chSecurity.enableVibration(true);
                chSecurity.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

                // 8. Per-App Daily Timer Alerts & Wellness Nudges
                NotificationChannel chAppTimers = new NotificationChannel(
                    CHANNEL_APP_TIMERS,
                    "Per-App Daily Timer Alerts",
                    NotificationManager.IMPORTANCE_HIGH
                );
                chAppTimers.setDescription("Alerts when an individual app approaches or reaches its daily usage timer.");
                chAppTimers.setGroup(WELLNESS_CHANNEL_GROUP_ID);
                chAppTimers.setShowBadge(true);

                NotificationChannel chWellnessNudges = new NotificationChannel(
                    CHANNEL_WELLNESS_NUDGES,
                    "Eye Strain, Posture & Wellness Nudges",
                    NotificationManager.IMPORTANCE_DEFAULT
                );
                chWellnessNudges.setDescription("20-20-20 eye strain blink prompts and ergonomic posture checks.");
                chWellnessNudges.setGroup(WELLNESS_CHANNEL_GROUP_ID);
                chWellnessNudges.setShowBadge(false);

                List<NotificationChannel> channels = Arrays.asList(
                    chGoals,
                    chAppTimers,
                    chBreaks,
                    chWellnessNudges,
                    chWindDown,
                    chSummary,
                    chLive,
                    chHearing,
                    chSecurity
                );
                nm.createNotificationChannels(channels);
            } catch (Throwable ignored) {
            }
        }
    }

    private Set<String> getExcludedLauncherAndSystemPackages() {
        Set<String> excluded = new HashSet<>(STATIC_OEM_EXCLUSIONS);
        excluded.add(getPackageName()); // Never count ScreenSync itself as third-party screen time
        try {
            PackageManager pm = getPackageManager();
            Intent homeIntent = new Intent(Intent.ACTION_MAIN);
            homeIntent.addCategory(Intent.CATEGORY_HOME);
            List<ResolveInfo> homeActivities = pm.queryIntentActivities(homeIntent, PackageManager.MATCH_DEFAULT_ONLY);
            if (homeActivities != null) {
                for (ResolveInfo ri : homeActivities) {
                    if (ri.activityInfo != null && ri.activityInfo.packageName != null) {
                        excluded.add(ri.activityInfo.packageName);
                    }
                }
            }
            ResolveInfo defaultHome = pm.resolveActivity(homeIntent, PackageManager.MATCH_DEFAULT_ONLY);
            if (defaultHome != null && defaultHome.activityInfo != null && defaultHome.activityInfo.packageName != null) {
                excluded.add(defaultHome.activityInfo.packageName);
            }
        } catch (Exception ignored) {
        }
        return excluded;
    }

    private String resolveCachedAppLabel(PackageManager pm, String pkg) {
        if (pkg == null || pkg.isEmpty()) return "";
        String cached = appLabelCache.get(pkg);
        if (cached != null && !cached.isEmpty()) return cached;
        String appLabel = pkg;
        try {
            if (pm != null) {
                ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
                CharSequence cs = pm.getApplicationLabel(ai);
                if (cs != null && cs.length() > 0) {
                    String trimmed = cs.toString().trim();
                    if (!trimmed.isEmpty()) {
                        appLabel = trimmed;
                    }
                }
                if (appLabel.equals(pkg)) {
                    Intent launchIntent = pm.getLaunchIntentForPackage(pkg);
                    if (launchIntent != null) {
                        ResolveInfo ri = pm.resolveActivity(launchIntent, 0);
                        if (ri != null) {
                            CharSequence riLabel = ri.loadLabel(pm);
                            if (riLabel != null && riLabel.length() > 0) {
                                String riTrimmed = riLabel.toString().trim();
                                if (!riTrimmed.isEmpty()) {
                                    appLabel = riTrimmed;
                                }
                            }
                        }
                    }
                }
            }
        } catch (Exception ignored) {
        }
        appLabelCache.put(pkg, appLabel);
        return appLabel;
    }

    private String resolveCachedAppIconDataUri(PackageManager pm, String pkg) {
        if (pkg == null || pkg.isEmpty()) return "";
        String cached = appIconCache.get(pkg);
        if (cached != null && !cached.isEmpty()) return cached;
        if (pm == null) return "";
        try {
            Drawable iconDrawable = null;
            try {
                iconDrawable = pm.getApplicationIcon(pkg);
            } catch (Exception ignored) {
            }
            if (iconDrawable == null) {
                Intent launchIntent = pm.getLaunchIntentForPackage(pkg);
                if (launchIntent != null) {
                    iconDrawable = pm.getActivityIcon(launchIntent);
                }
            }
            String dataUri = encodeDrawableToDataUri(iconDrawable);
            if (dataUri != null && !dataUri.isEmpty()) {
                appIconCache.put(pkg, dataUri);
                return dataUri;
            }
        } catch (Exception ignored) {
        }
        return "";
    }

    public static MainActivity getActiveInstance() {
        return activeInstance;
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        activeInstance = this;

        // Pass 22 Task 22.1: Initialize notification channels as the very first step in onCreate()
        ensureNotificationChannelsCreated(this);

        // Pass 22 Task 22.3: Enable lock-screen & turn-screen-on presentation on API 27+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            try {
                setShowWhenLocked(true);
                setTurnScreenOn(true);
            } catch (Throwable ignored) {}
        }

        usageDbHelper = new AppUsageDatabaseHelper(this);
        usageIngestionEngine = new UsageEventIngestionEngine(this, usageDbHelper);
        sessionCalculator = new ScreenTimeSessionCalculator();
        appTimerSuspensionManager = new AppTimerSuspensionManager(this);

        // Seamless Edge-to-Edge Status Bar & System Bar UI Matching (Task 1)
        Window window = getWindow();
        if (window != null) {
            window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.setStatusBarColor(android.graphics.Color.TRANSPARENT);
            window.setNavigationBarColor(android.graphics.Color.parseColor("#040D1F"));
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                WindowManager.LayoutParams lp = window.getAttributes();
                lp.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                    ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                    : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                window.setAttributes(lp);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                window.setDecorFitsSystemWindows(false);
                if (window.getInsetsController() != null) {
                    window.getInsetsController().show(WindowInsets.Type.statusBars());
                }
            } else {
                View decorView = window.getDecorView();
                int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN;
                decorView.setSystemUiVisibility(flags);
            }
        }

        NativeAntiTamperGuard.verifyIntegrity(this);
        webView = new WebView(this);
        setContentView(webView);

        configureWebView();
        registerScreenWakeSyncReceiver();
        registerPackageChangeReceiver();
        ScreenSyncBackgroundSyncReceiver.schedulePeriodicSync(this);
        try {
            WellbeingRefreshScheduler.schedulePeriodicSyncJobs(this, WellbeingRefreshScheduler.WellbeingPeriodicJobService.class);
        } catch (Throwable ignored) {}
        ScreenSyncWidgetUpdater.updateAllWidgets(this);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                onBackPressed();
            }
        });
        registerPredictiveBackCallbackIfSupported();
        webView.loadUrl("file:///android_asset/public/index.html");
        handleOAuthCallbackIntent(getIntent());
        handleSurveyIntent(getIntent());

        requestRequiredAndroidPermissionsNatively();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleOAuthCallbackIntent(intent);
        handleSurveyIntent(intent);
    }

    private void handleSurveyIntent(Intent intent) {
        try {
            String surveyId = intent != null ? intent.getStringExtra("survey_id") : null;
            String surveyUrl = intent != null ? intent.getStringExtra("survey_url") : null;
            String surveyTitle = intent != null ? intent.getStringExtra("survey_title") : null;
            String surveyBody = intent != null ? intent.getStringExtra("survey_body") : null;
            android.content.SharedPreferences prefs = getSharedPreferences("screensync_prefs", Context.MODE_PRIVATE);
            if (surveyId == null || surveyId.trim().isEmpty()) {
                surveyId = prefs.getString("pending_survey_id", "");
            }
            if (surveyUrl == null || surveyUrl.trim().isEmpty()) {
                surveyUrl = prefs.getString("pending_survey_url", "");
            }
            if (surveyTitle == null || surveyTitle.trim().isEmpty()) {
                surveyTitle = prefs.getString("pending_survey_title", "ScreenSync Research Survey");
            }
            if (surveyBody == null || surveyBody.trim().isEmpty()) {
                surveyBody = prefs.getString("pending_survey_body", "");
            }
            if ((surveyId != null && !surveyId.trim().isEmpty()) || (surveyUrl != null && !surveyUrl.trim().isEmpty())) {
                dispatchIncomingPushSurveyToWeb(surveyId, surveyUrl, surveyTitle, surveyBody);
            }
        } catch (Exception ignored) {}
    }

    private void handleOAuthCallbackIntent(Intent intent) {
        if (intent == null || intent.getData() == null) return;
        android.net.Uri data = intent.getData();
        String scheme = data.getScheme();
        if (!"io.screensync.wellness".equals(scheme) && !"screensync".equals(scheme)) return;
        if (!"auth".equals(data.getHost())) return;
        final String safeUri = JSONObject.quote(data.toString());
        if (webView != null) {
            webView.post(() -> webView.evaluateJavascript(
                "if (window.ScreenSyncApp && window.ScreenSyncApp.SocialOAuthProviderEngine && typeof window.ScreenSyncApp.SocialOAuthProviderEngine.handleOAuthCallbackUrl === 'function') { window.ScreenSyncApp.SocialOAuthProviderEngine.handleOAuthCallbackUrl(" + safeUri + "); }",
                null
            ));
        }
    }

    private void configureWebView() {
        if (webView == null) return;
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        try {
            settings.setTextZoom(Math.round(getResources().getConfiguration().fontScale * 100));
        } catch (Exception ignored) {}

        webView.addJavascriptInterface(new ScreenSyncAndroidBridge(), "ScreenSyncNativeBridge");
        webView.setBackgroundColor(android.graphics.Color.parseColor("#040D1F"));
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                try {
                    int insetDp = new ScreenSyncAndroidBridge().getStatusBarInsetDp();
                    view.evaluateJavascript(
                        "document.documentElement.setAttribute('data-native-android','true');" +
                        "document.documentElement.setAttribute('data-os-category','Android');" +
                        "document.documentElement.style.setProperty('--ss-safe-top-inset','" + insetDp + "px');" +
                        "if(window.ScreenSyncApp&&window.ScreenSyncApp.AutoSyncService&&typeof window.ScreenSyncApp.AutoSyncService.syncWithBackend==='function'){window.ScreenSyncApp.AutoSyncService.syncWithBackend();}",
                        null
                    );
                    syncAllNativePermissionsToWebView();
                } catch (Exception ignored) {}
            }
        });
        webView.setWebChromeClient(new android.webkit.WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                WebView view,
                android.webkit.ValueCallback<Uri[]> filePathCallback,
                FileChooserParams fileChooserParams
            ) {
                try {
                    if (pendingFileChooserCallback != null) {
                        pendingFileChooserCallback.onReceiveValue(null);
                    }
                    pendingFileChooserCallback = filePathCallback;
                    Intent chooserIntent = (fileChooserParams != null)
                        ? fileChooserParams.createIntent()
                        : new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                    startActivityForResult(chooserIntent, REQUEST_CODE_WEBVIEW_FILE_CHOOSER);
                    return true;
                } catch (Exception e) {
                    pendingFileChooserCallback = null;
                    return false;
                }
            }
        });
        webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
            try {
                if (url != null && url.startsWith("data:")) {
                    int commaIdx = url.indexOf(',');
                    if (commaIdx > 0) {
                        String payload = Uri.decode(url.substring(commaIdx + 1));
                        java.io.File outDir = getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS);
                        if (outDir == null) outDir = getFilesDir();
                        java.io.File outFile = new java.io.File(outDir, "screensync_export_" + System.currentTimeMillis() + ".txt");
                        try (java.io.FileOutputStream fos = new java.io.FileOutputStream(outFile)) {
                            fos.write(payload.getBytes(StandardCharsets.UTF_8));
                        }
                    }
                }
            } catch (Exception ignored) {
            }
        });
    }

    private static final int REQUEST_CODE_WEBVIEW_FILE_CHOOSER = 4108;
    private android.webkit.ValueCallback<Uri[]> pendingFileChooserCallback = null;

    @Override
    public void onConfigurationChanged(android.content.res.Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (webView != null && newConfig != null) {
            try {
                final float fontScale = newConfig.fontScale > 0 ? newConfig.fontScale : 1.0f;
                webView.getSettings().setTextZoom(Math.round(fontScale * 100));
                final int nightMask = newConfig.uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK;
                final String sysTheme = (nightMask == android.content.res.Configuration.UI_MODE_NIGHT_YES) ? "DARK" : "LIGHT";
                webView.post(() -> {
                    try {
                        webView.evaluateJavascript(
                            "window.dispatchEvent(new CustomEvent('screensync:system-theme-changed', { detail: { theme: '" + sysTheme + "' } }));"
                            + "if(window.ScreenSyncApp&&window.ScreenSyncApp.DesignStyleController&&window.ScreenSyncApp.DesignStyleController.getThemePreference()==='SYSTEM'){window.ScreenSyncApp.DesignStyleController.applyToDocument();}",
                            null
                        );
                    } catch (Exception ignored) {}
                    try {
                        webView.evaluateJavascript(
                            "window.dispatchEvent(new CustomEvent('screensync:device-font-changed', { detail: { fontScale: " + fontScale + " } }));",
                            null
                        );
                    } catch (Exception ignored) {}
                    try {
                        String geomJson = new ScreenSyncAndroidBridge().getDisplayCutoutJson();
                        String escaped = JSONObject.quote(geomJson != null ? geomJson : "{}");
                        webView.evaluateJavascript(
                            "if(window.ScreenSyncApp&&typeof window.ScreenSyncApp.onDisplayGeometryChanged===\"function\"){window.ScreenSyncApp.onDisplayGeometryChanged(JSON.parse(" + escaped + "));}",
                            null
                        );
                    } catch (Exception ignored) {}
                });
            } catch (Exception ignored) {}
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_CODE_WEBVIEW_FILE_CHOOSER) {
            if (pendingFileChooserCallback != null) {
                Uri[] results = null;
                if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                    results = new Uri[]{data.getData()};
                }
                pendingFileChooserCallback.onReceiveValue(results);
                pendingFileChooserCallback = null;
            }
        }
    }

    private void registerScreenWakeSyncReceiver() {
        if (screenWakeSyncReceiver != null) return;
        screenWakeSyncReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent == null || intent.getAction() == null) return;
                String action = intent.getAction();
                if (Intent.ACTION_SCREEN_ON.equals(action)
                        || Intent.ACTION_USER_PRESENT.equals(action)
                        || "io.screensync.wellness.ACTION_SCREEN_WAKE_SYNC".equals(action)) {
                    if (webView != null) {
                        webView.post(() -> webView.evaluateJavascript(
                            "if (window.ScreenSyncApp && window.ScreenSyncApp.AutoSyncService && typeof window.ScreenSyncApp.AutoSyncService.syncWithBackend === 'function') { window.ScreenSyncApp.AutoSyncService.syncWithBackend(); }",
                            null
                        ));
                    }
                }
            }
        };
        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_SCREEN_ON);
        filter.addAction(Intent.ACTION_USER_PRESENT);
        filter.addAction("io.screensync.wellness.ACTION_SCREEN_WAKE_SYNC");
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(screenWakeSyncReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(screenWakeSyncReceiver, filter);
        }
    }

    private void requestRequiredAndroidPermissionsNatively() {
        checkAndRequestRequiredPermissionsOnStartup();
    }

    /**
     * Pass 22 Task 22.2: Sequential, Non-Overlapping Android 13–15 Runtime Permission Handshake
     */
    private void checkAndRequestRequiredPermissionsOnStartup() {
        try {
            ensureNotificationChannelsCreated(this);
            android.content.SharedPreferences prefs =
                getSharedPreferences("screensync_native_perm_flow", Context.MODE_PRIVATE);

            // 1. Native OS Runtime Allow/Deny Dialog for Notifications (Android 13 / API 33+)
            if (Build.VERSION.SDK_INT >= 33) {
                if (checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                    if (!prefs.getBoolean("notif_runtime_prompted_once", false)) {
                        prefs.edit().putBoolean("notif_runtime_prompted_once", true).apply();
                        isAwaitingRuntimePermissionResult = true;
                        requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 1001);
                        return;
                    }
                }
            }

            // 2. Only when POST_NOTIFICATIONS is already granted (or on Android <= 12) proceed to sequential permission handshake
            boolean firstPromptDone = prefs.getBoolean("initial_native_prompt_completed", false);
            if (!firstPromptDone) {
                promptNextMissingSystemPermissionNatively();
            }
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == 1001) {
            isAwaitingRuntimePermissionResult = false;
            final boolean granted = hasNotificationPermission();
            if (webView != null) {
                webView.post(() -> webView.evaluateJavascript(
                    "if (window.ScreenSyncApp && window.ScreenSyncApp.PermissionOnboardingManager) { " +
                    "window.ScreenSyncApp.PermissionOnboardingManager.onReturnFromSystemSettings(\"notifications\", \"" + (granted ? "GRANTED" : "DENIED") + "\"); " +
                    "}",
                    null
                ));
            }
            syncAllNativePermissionsToWebView();

            android.content.SharedPreferences prefs =
                getSharedPreferences("screensync_native_perm_flow", Context.MODE_PRIVATE);
            if (!prefs.getBoolean("initial_native_prompt_completed", false)) {
                new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(
                    this::promptNextMissingSystemPermissionNatively,
                    250L
                );
            }
        }
    }

    private boolean isAccessibilityConsentAcceptedInStore() {
        try {
            android.content.SharedPreferences storePrefs =
                getSharedPreferences("screensync_wellness_store", Context.MODE_PRIVATE);
            if (storePrefs.contains("accessibility_disclosure_accepted")) {
                return storePrefs.getBoolean("accessibility_disclosure_accepted", false);
            }
            android.content.SharedPreferences legacyPrefs =
                getSharedPreferences("screensync_native_perm_flow", Context.MODE_PRIVATE);
            if (legacyPrefs.getBoolean("accessibility_disclosure_accepted", false)) {
                storePrefs.edit()
                    .putBoolean("accessibility_disclosure_accepted", true)
                    .putLong("accessibility_disclosure_accepted_at_ms", System.currentTimeMillis())
                    .apply();
                return true;
            }
        } catch (Exception ignored) {}
        return false;
    }

    private void promptNextMissingSystemPermissionNatively() {
        if (isAwaitingRuntimePermissionResult) return;
        if (activePermissionDialog != null && activePermissionDialog.isShowing()) return;
        android.content.SharedPreferences prefs =
            getSharedPreferences("screensync_native_perm_flow", Context.MODE_PRIVATE);
        if (!hasUsageStatsPermission() && !prefs.getBoolean("usage_deferred_by_user", false)) {
            activePermissionDialog = new android.app.AlertDialog.Builder(this)
                .setTitle("Enable Usage Access")
                .setMessage("ScreenSync needs Android Usage Access to read your device's screen time and historical app usage.")
                .setPositiveButton("Allow in System", (d, w) -> {
                    prefs.edit().putBoolean("usage_prompted_once", true).apply();
                    try {
                        Intent i = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS, Uri.parse("package:" + getPackageName()));
                        startActivity(i);
                    } catch (Exception e) {
                        startActivity(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS));
                    }
                })
                .setNegativeButton("Later", (d, w) -> {
                    prefs.edit().putBoolean("usage_deferred_by_user", true).apply();
                    new Handler(Looper.getMainLooper()).postDelayed(this::promptNextMissingSystemPermissionNatively, 200L);
                })
                .create();
            activePermissionDialog.setOnDismissListener(d -> activePermissionDialog = null);
            activePermissionDialog.show();
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this) && !prefs.getBoolean("overlay_deferred_by_user", false)) {
            activePermissionDialog = new android.app.AlertDialog.Builder(this)
                .setTitle("Enable Display Over Other Apps")
                .setMessage("Allow overlay permission so the Dynamic Island and 5-second Goal Alerts can appear over other apps.")
                .setPositiveButton("Allow in System", (d, w) -> {
                    prefs.edit().putBoolean("overlay_prompted_after_usage", true).apply();
                    Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()));
                    startActivity(i);
                })
                .setNegativeButton("Later", (d, w) -> {
                    prefs.edit().putBoolean("overlay_deferred_by_user", true).apply();
                    new Handler(Looper.getMainLooper()).postDelayed(this::promptNextMissingSystemPermissionNatively, 200L);
                })
                .create();
            activePermissionDialog.setOnDismissListener(d -> activePermissionDialog = null);
            activePermissionDialog.show();
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !isIgnoringBatteryOptimizationsCompat() && !prefs.getBoolean("battery_prompted_after_overlay", false)) {
            prefs.edit().putBoolean("battery_prompted_after_overlay", true).apply();
            activePermissionDialog = new android.app.AlertDialog.Builder(this)
                .setTitle("Allow Unrestricted Background Activity")
                .setMessage("Allow ScreenSync to run without battery restrictions so timers, widgets, and goal alerts stay accurate.")
                .setPositiveButton("Allow", (d, w) -> {
                    try {
                        Intent reqIgnore = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName()));
                        startActivity(reqIgnore);
                    } catch (Exception e) {
                        try {
                            startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                        } catch (Exception ignored) {}
                    }
                })
                .setNegativeButton("Later", (d, w) -> new Handler(Looper.getMainLooper()).postDelayed(this::promptNextMissingSystemPermissionNatively, 200L))
                .create();
            activePermissionDialog.setOnDismissListener(d -> activePermissionDialog = null);
            activePermissionDialog.show();
        } else if (!isAccessibilityServiceEnabled() && !prefs.getBoolean("accessibility_disclosure_prompted_once", false)) {
            prefs.edit()
                .putBoolean("accessibility_disclosure_prompted_once", true)
                .putBoolean("initial_native_prompt_completed", true)
                .apply();
            if (webView != null) {
                webView.post(() -> webView.evaluateJavascript(
                    "if (window.ScreenSyncApp && window.ScreenSyncApp.PermissionOnboardingManager) { " +
                    "window.ScreenSyncApp.PermissionOnboardingManager.openSystemPermissionFlow('accessibility'); " +
                    "}",
                    null
                ));
            }
        } else {
            prefs.edit().putBoolean("initial_native_prompt_completed", true).apply();
        }
    }

    public void dispatchAccessibilityContextUpdate(final String pkg, final String surface, final boolean scrolled) {
        dispatchAccessibilityContextUpdate(pkg, surface, scrolled, "FORWARD");
    }

    public void dispatchAccessibilityContextUpdate(final String pkg, final String surface, final boolean scrolled, final String direction) {
        dispatchAccessibilityContextUpdate(pkg, surface, scrolled, direction, null);
    }

    public void dispatchAccessibilityContextUpdate(final String pkg, final String surface, final boolean scrolled, final String direction, final String nativeEventId) {
        if (webView == null) return;
        webView.post(() -> {
            final String safePkg = pkg == null ? "" : pkg.replace("\"", "");
            final String safeSurf = surface == null ? "" : surface.replace("\"", "");
            final String safeDir = (direction != null && "BACKWARD".equalsIgnoreCase(direction)) ? "BACKWARD" : "FORWARD";
            final String safeEvId = (nativeEventId != null && !nativeEventId.isEmpty())
                ? nativeEventId.replace("\"", "")
                : ("native_outbox_" + safePkg + "_" + System.currentTimeMillis());
            if (scrolled && ("REEL".equals(safeSurf) || "SHORT".equals(safeSurf) || "TIKTOK".equals(safeSurf) || "STORY".equals(safeSurf) || "SPOTLIGHT".equals(safeSurf) || "MESSENGER_STORY".equals(safeSurf))) {
                webView.evaluateJavascript(
                    "if (window.ScreenSyncApp && window.ScreenSyncApp.CrossPlatformScreenAccessManager) { " +
                    "const instKey = typeof window.ScreenSyncApp.getActiveLocalInstallationKey === 'function' ? window.ScreenSyncApp.getActiveLocalInstallationKey('Android') : null; " +
                    "window.ScreenSyncApp.CrossPlatformScreenAccessManager.processAuthorizedScreenActivity({ " +
                    "eventId: \"" + safeEvId + "\", callbackId: \"" + safeEvId + "\", installationKey: instKey, osCategory: \"Android\", packageName: \"" + safePkg + "\", activityType: \"" + safeSurf + "\", direction: \"" + safeDir + "\" }); }",
                    null
                );
            } else {
                webView.evaluateJavascript(
                    "if (window.ScreenSyncApp) { window.ScreenSyncApp.handleAutomaticAppContextChange(\"" + safePkg + "\", \"" + safeSurf + "\", { triggerRender: true, externalOsContext: true }); }",
                    null
                );
            }
        });
    }

    private boolean hasUsageStatsPermission() {
        AppOpsManager appOps = (AppOpsManager) getSystemService(Context.APP_OPS_SERVICE);
        if (appOps == null) return false;
        int mode = appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), getPackageName());
        if (mode == AppOpsManager.MODE_DEFAULT) {
            return checkCallingOrSelfPermission(android.Manifest.permission.PACKAGE_USAGE_STATS) == PackageManager.PERMISSION_GRANTED;
        }
        return mode == AppOpsManager.MODE_ALLOWED;
    }

    private boolean isAccessibilityServiceEnabled() {
        String enabledServices = Settings.Secure.getString(getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (enabledServices == null) return false;
        return enabledServices.contains(getPackageName() + "/" + ScreenSyncAccessibilityService.class.getName()) ||
               enabledServices.contains(getPackageName() + "/.ScreenSyncAccessibilityService");
    }

    private boolean hasNotificationPermission() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && !nm.areNotificationsEnabled()) {
                return false;
            }
            if (Build.VERSION.SDK_INT >= 33) {
                return checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED;
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private boolean isIgnoringBatteryOptimizationsCompat() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    return pm.isIgnoringBatteryOptimizations(getPackageName());
                }
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private void syncAllNativePermissionsToWebView() {
        if (webView == null) return;
        final boolean hasUsage = hasUsageStatsPermission();
        final boolean hasAccess = isAccessibilityServiceEnabled();
        final boolean hasOverlay = Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this);
        final boolean hasNotifications = hasNotificationPermission();
        final boolean hasOemBackground = isIgnoringBatteryOptimizationsCompat();
        webView.post(() -> webView.evaluateJavascript(
            "if (window.ScreenSyncApp && typeof window.ScreenSyncApp.onNativeAndroidResumeSync === 'function') { " +
            "window.ScreenSyncApp.onNativeAndroidResumeSync(" + hasUsage + ", " + hasAccess + ", " + hasOverlay + ", " + hasNotifications + ", " + hasOemBackground + "); " +
            "}",
            null
        ));
    }

    private String encodeDrawableToDataUri(Drawable drawable) {
        if (drawable == null) return null;
        Bitmap bmp = null;
        try {
            int w = Math.max(64, Math.min(96, drawable.getIntrinsicWidth() > 0 ? drawable.getIntrinsicWidth() : 96));
            int h = Math.max(64, Math.min(96, drawable.getIntrinsicHeight() > 0 ? drawable.getIntrinsicHeight() : 96));
            bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bmp);
            drawable.setFilterBitmap(true);
            drawable.setBounds(0, 0, canvas.getWidth(), canvas.getHeight());
            drawable.draw(canvas);
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.PNG, 100, baos);
            String b64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
            return "data:image/png;base64," + b64;
        } catch (Exception e) {
            return null;
        } finally {
            if (bmp != null && !bmp.isRecycled()) {
                bmp.recycle();
            }
        }
    }

    private void showTransientGoalAlert(final String title, final String message, final long durationMs) {
        try {
            ScreenSyncAccessibilityService svc = ScreenSyncAccessibilityService.getActiveInstance();
            if (svc != null) {
                svc.showTransientGoalAlertOverlay(title, message, durationMs);
            }
        } catch (Exception ignored) {
        }
    }

    public class ScreenSyncAndroidBridge {
        private String readSystemProperty(String key) {
            if (key == null || key.isEmpty()) return "";
            try {
                Class<?> sysProps = Class.forName("android.os.SystemProperties");
                java.lang.reflect.Method getMethod = sysProps.getMethod("get", String.class);
                Object val = getMethod.invoke(null, key);
                return val != null ? val.toString().trim() : "";
            } catch (Exception ignored) {
                return "";
            }
        }

        private boolean isRawRegulatoryModelCode(String candidate, String rawBuildModel) {
            if (candidate == null) return true;
            String trimmed = candidate.trim();
            if (trimmed.isEmpty()) return true;
            String stripped = trimmed.replaceFirst("(?i)^(Xiaomi|Redmi|POCO|Samsung|Vivo|OPPO|Realme|OnePlus|Honor|Motorola|Nothing)\\s+", "").trim();
            String upper = stripped.toUpperCase(Locale.US);
            String rawUpper = rawBuildModel != null
                ? rawBuildModel.trim().replaceFirst("(?i)^(Xiaomi|Redmi|POCO|Samsung|Vivo|OPPO|Realme|OnePlus|Honor|Motorola|Nothing)\\s+", "").trim().toUpperCase(Locale.US)
                : "";

            // Xiaomi / Redmi / POCO numeric-prefix or legacy M20/M21 SKUs (e.g. 24069RA21C, 2311DRK48C, 24129RT7CC, 23049PCD8G)
            if (upper.matches("^[0-9]{4}[0-9A-Z]{2,8}$") || upper.matches("^M2[01][0-9A-Z]{4,8}$")) {
                return true;
            }
            // Samsung SKUs (SM-S928B, SM-A556E, SM-G998U, GT-*, SC-*, SCH-*)
            if (upper.matches("^(SM-|GT-|SC-|SCH-)[A-Z0-9-]+$")) {
                return true;
            }
            // OPPO / OnePlus / Realme / Vivo / Honor / Motorola / Nothing SKUs
            if (upper.matches("^(CPH[0-9]{4}|RMX[0-9]{4}|V[0-9]{4}[A-Z]?|PD[0-9]{4}|XT[0-9]{4}(-?[0-9])?|(PJZ|PJD|PHB|PKG|PKR|PKB|PKC|PHZ|PHY)[0-9]{3}|A063|A065|A142P?|A059P?|GKV4X|GEC77|GWVK6|GGH2X|GKWS6|G1MNW|G6GPR)$")) {
                return true;
            }
            // Single unbroken alphanumeric token >= 5 chars with >= 2 digits and >= 1 uppercase letter and no spaces
            if (!stripped.contains(" ") && stripped.length() >= 5) {
                int digits = 0;
                int uppers = 0;
                for (int i = 0; i < stripped.length(); i++) {
                    char c = stripped.charAt(i);
                    if (Character.isDigit(c)) digits++;
                    else if (Character.isUpperCase(c)) uppers++;
                }
                if (digits >= 2 && uppers >= 1) {
                    return true;
                }
            }
            if (!rawUpper.isEmpty() && upper.equalsIgnoreCase(rawUpper) && !rawUpper.contains(" ")) {
                return true;
            }
            return false;
        }

        private String resolveKnownMarketingNameForModel(String rawModel, String brand, String manufacturer) {
            if (rawModel == null || rawModel.trim().isEmpty()) return "";
            String clean = rawModel.trim()
                .replaceFirst("(?i)^(Xiaomi|Redmi|POCO|Samsung|Vivo|OPPO|Realme|OnePlus|Honor|Motorola|Nothing)\\s+", "")
                .trim()
                .toUpperCase(Locale.US);

            Map<String, String> exactMap = new HashMap<>();
            // Xiaomi / Redmi / POCO
            exactMap.put("24069RA21C", (brand != null && brand.equalsIgnoreCase("Redmi")) ? "Redmi Turbo 4 Pro" : "Redmi Turbo 3");
            exactMap.put("24069PC21G", "POCO F6");
            exactMap.put("24069PC21I", "POCO F6");
            exactMap.put("25053RT47C", "Redmi Turbo 4 Pro");
            exactMap.put("24129RT7CC", "Redmi Turbo 4");
            exactMap.put("24069RA21G", "POCO F6");
            exactMap.put("24129PN74C", "Xiaomi 15");
            exactMap.put("24129PN74G", "Xiaomi 15");
            exactMap.put("2410DPN6CC", "Xiaomi 15 Pro");
            exactMap.put("25010PN30C", "Xiaomi 15 Ultra");
            exactMap.put("25010PN30G", "Xiaomi 15 Ultra");
            exactMap.put("PJZ110", "OnePlus 13");
            exactMap.put("CPH2653", "OnePlus 13");
            exactMap.put("CPH2655", "OnePlus 13");
            exactMap.put("PKR110", "OnePlus 13R");
            exactMap.put("CPH2645", "OnePlus 13R");
            exactMap.put("PJD110", "OnePlus 12");
            exactMap.put("PKB110", "OPPO Find X8");
            exactMap.put("PKC110", "OPPO Find X8 Pro");
            exactMap.put("RMX5010", "Realme GT 7 Pro");
            exactMap.put("V2408A", "Vivo X200");
            exactMap.put("V2413", "Vivo X200 Pro");
            exactMap.put("A059", "Nothing Phone (3a)");
            exactMap.put("A059P", "Nothing Phone (3a) Pro");
            exactMap.put("GKV4X", "Google Pixel 9");
            exactMap.put("GEC77", "Google Pixel 9 Pro");
            exactMap.put("GWVK6", "Google Pixel 9 Pro XL");
            exactMap.put("23113RKC6C", "Redmi K70 Pro");
            exactMap.put("2311DRK48C", "Redmi K70");
            exactMap.put("23113RKC6G", "POCO F6 Pro");
            exactMap.put("23049PCD8G", "POCO F5");
            exactMap.put("23049PCD8I", "POCO F5");
            exactMap.put("23013PC75G", "POCO F5 Pro");
            exactMap.put("23127PN0CC", "Xiaomi 14");
            exactMap.put("23127PN0CG", "Xiaomi 14");
            exactMap.put("24030PN60G", "Xiaomi 14 Ultra");
            exactMap.put("24031PN0DC", "Xiaomi 14 Ultra");
            exactMap.put("23090RA98G", "Redmi Note 13 Pro+ 5G");
            exactMap.put("2312DRA50G", "Redmi Note 13 Pro 5G");
            exactMap.put("24090RA29G", "Redmi Note 14 Pro+ 5G");
            // OnePlus / OPPO / Realme / Vivo / Nothing
            exactMap.put("CPH2487", "OnePlus 11R 5G");
            exactMap.put("CPH2449", "OnePlus 11 5G");
            exactMap.put("CPH2451", "OnePlus 11 5G");
            exactMap.put("CPH2581", "OnePlus 12");
            exactMap.put("CPH2573", "OnePlus 12");
            exactMap.put("CPH2609", "OnePlus 12R");
            exactMap.put("CPH2585", "OnePlus 12R");
            exactMap.put("V2251", "Vivo V29 5G");
            exactMap.put("V2303", "Vivo V29 Pro");
            exactMap.put("V2318", "Vivo V30 5G");
            exactMap.put("V2307", "Vivo X100 Pro");
            exactMap.put("RMX3888", "Realme GT 6");
            exactMap.put("RMX3851", "Realme GT 6T");
            exactMap.put("RMX5011", "Realme GT 7 Pro");
            exactMap.put("2407FRK8EC", "Redmi K70 Ultra");
            exactMap.put("24122RKC7C", "Redmi K80");
            exactMap.put("24117RK2CC", "Redmi K80 Pro");
            exactMap.put("23122PCD1G", "POCO X6 5G");
            exactMap.put("2311DRK48G", "POCO X6 Pro 5G");
            exactMap.put("2412DPC0AG", "POCO X7 Pro");
            exactMap.put("23116PN5BC", "Xiaomi 14 Pro");
            exactMap.put("2406APNFAG", "Xiaomi 14T Pro");
            exactMap.put("23078PND5G", "Xiaomi 13T Pro");
            exactMap.put("24090RA29C", "Redmi Note 14 Pro+");
            exactMap.put("24115RA8EG", "Redmi Note 14 Pro 5G");
            exactMap.put("CPH2663", "OnePlus Nord 4");
            exactMap.put("CPH2551", "OnePlus Open");
            exactMap.put("CPH2651", "OPPO Find X8");
            exactMap.put("CPH2659", "OPPO Find X8 Pro");
            exactMap.put("PHZ110", "OPPO Find X7");
            exactMap.put("PHY110", "OPPO Find X7 Ultra");
            exactMap.put("V2405A", "iQOO 13");
            exactMap.put("V2309A", "Vivo X100");
            exactMap.put("V2324A", "Vivo X100 Pro");
            exactMap.put("A063", "Nothing Phone (1)");
            exactMap.put("A065", "Nothing Phone (2)");
            exactMap.put("A142", "Nothing Phone (2a)");
            exactMap.put("A142P", "Nothing Phone (2a) Plus");
            exactMap.put("GGH2X", "Google Pixel 9 Pro Fold");
            exactMap.put("GKWS6", "Google Pixel 8");
            exactMap.put("G1MNW", "Google Pixel 8 Pro");
            exactMap.put("G6GPR", "Google Pixel 8a");
            exactMap.put("XT2451", "Motorola Razr+ (2024)");
            exactMap.put("XT2451-3", "Motorola Razr+ (2024)");
            exactMap.put("XT2403", "Motorola Edge 50 Pro");
            exactMap.put("XT2403-2", "Motorola Edge 50 Pro");

            if (exactMap.containsKey(clean)) {
                return exactMap.get(clean);
            }

            // Samsung prefix-aware lookup
            if (clean.startsWith("SM-S938")) return "Samsung Galaxy S25 Ultra";
            if (clean.startsWith("SM-S721")) return "Samsung Galaxy S24 FE";
            if (clean.startsWith("SM-F946")) return "Samsung Galaxy Z Fold5";
            if (clean.startsWith("SM-F731")) return "Samsung Galaxy Z Flip5";
            if (clean.startsWith("SM-A566")) return "Samsung Galaxy A56 5G";
            if (clean.startsWith("SM-A366")) return "Samsung Galaxy A36 5G";
            if (clean.startsWith("SM-X92")) return "Samsung Galaxy Tab S10 Ultra";
            if (clean.startsWith("SM-X82")) return "Samsung Galaxy Tab S10+";
            if (clean.startsWith("SM-S936")) return "Samsung Galaxy S25+";
            if (clean.startsWith("SM-S931")) return "Samsung Galaxy S25";
            if (clean.startsWith("SM-S937")) return "Samsung Galaxy S25 Edge";
            if (clean.startsWith("SM-S928")) return "Samsung Galaxy S24 Ultra";
            if (clean.startsWith("SM-S926")) return "Samsung Galaxy S24+";
            if (clean.startsWith("SM-S921")) return "Samsung Galaxy S24";
            if (clean.startsWith("SM-S918")) return "Samsung Galaxy S23 Ultra";
            if (clean.startsWith("SM-S916")) return "Samsung Galaxy S23+";
            if (clean.startsWith("SM-S911")) return "Samsung Galaxy S23";
            if (clean.startsWith("SM-S908")) return "Samsung Galaxy S22 Ultra";
            if (clean.startsWith("SM-F956")) return "Samsung Galaxy Z Fold6";
            if (clean.startsWith("SM-F741")) return "Samsung Galaxy Z Flip6";
            if (clean.startsWith("SM-A556")) return "Samsung Galaxy A55 5G";
            if (clean.startsWith("SM-A546")) return "Samsung Galaxy A54 5G";
            if (clean.startsWith("SM-A356")) return "Samsung Galaxy A35 5G";
            if (clean.startsWith("SM-G973")) return "Samsung Galaxy S10";

            return "";
        }

        @JavascriptInterface
        public void cacheResolvedDeviceMarketingName(String rawModel, String marketingName) {
            if (rawModel == null || rawModel.trim().isEmpty() || marketingName == null || marketingName.trim().isEmpty()) {
                return;
            }
            try {
                android.content.SharedPreferences prefs = getSharedPreferences("screensync_native_prefs", Context.MODE_PRIVATE);
                prefs.edit()
                    .putString("resolved_marketing_name_" + rawModel.trim(), marketingName.trim())
                    .apply();
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public int getStatusBarInsetDp() {
            try {
                float density = getResources().getDisplayMetrics().density;
                float safeDensity = density > 0 ? density : 1f;
                int maxPx = 0;
                int resourceId = getResources().getIdentifier("status_bar_height", "dimen", "android");
                if (resourceId > 0) {
                    maxPx = Math.max(maxPx, getResources().getDimensionPixelSize(resourceId));
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && getWindow() != null && getWindow().getDecorView() != null) {
                    WindowInsets rootInsets = getWindow().getDecorView().getRootWindowInsets();
                    if (rootInsets != null) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                            maxPx = Math.max(maxPx, rootInsets.getInsetsIgnoringVisibility(WindowInsets.Type.statusBars()).top);
                        } else {
                            maxPx = Math.max(maxPx, rootInsets.getSystemWindowInsetTop());
                        }
                        DisplayCutout cutout = rootInsets.getDisplayCutout();
                        if (cutout != null) {
                            maxPx = Math.max(maxPx, cutout.getSafeInsetTop());
                        }
                    }
                }
                if (maxPx > 0) {
                    return Math.max(38, Math.round(maxPx / safeDensity));
                }
            } catch (Exception ignored) {
            }
            return 38;
        }

        @JavascriptInterface
        public String getSystemThemeMode() {
            int nightMask = getResources().getConfiguration().uiMode
                & android.content.res.Configuration.UI_MODE_NIGHT_MASK;
            return (nightMask == android.content.res.Configuration.UI_MODE_NIGHT_YES) ? "DARK" : "LIGHT";
        }

        @JavascriptInterface
        public void syncSystemBarTheme(final String themeMode) {
            runOnUiThread(() -> {
                try {
                    Window w = getWindow();
                    if (w == null) return;
                    boolean isLight = "LIGHT".equalsIgnoreCase(themeMode);
                    int bgColor = android.graphics.Color.parseColor(isLight ? "#F2F4F8" : "#040D1F");
                    w.setStatusBarColor(android.graphics.Color.TRANSPARENT);
                    w.setNavigationBarColor(bgColor);
                    if (webView != null) {
                        webView.setBackgroundColor(bgColor);
                    }
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && w.getInsetsController() != null) {
                        int mask = android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                            | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                        int appearance = isLight ? mask : 0;
                        w.getInsetsController().setSystemBarsAppearance(appearance, mask);
                    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        View decor = w.getDecorView();
                        int flags = decor.getSystemUiVisibility();
                        if (isLight) {
                            flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                                flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                            }
                        } else {
                            flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                                flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                            }
                        }
                        decor.setSystemUiVisibility(flags);
                    }
                } catch (Exception ignored) {
                }
            });
        }

        @JavascriptInterface
        public boolean canDrawOverlays() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                return Settings.canDrawOverlays(MainActivity.this);
            }
            return true;
        }

        @JavascriptInterface
        public String checkPermissionStatus(String permissionId) {
            if ("usage_stats".equals(permissionId)) {
                return hasUsageStatsPermission() ? "GRANTED" : "DENIED";
            }
            if ("accessibility".equals(permissionId)) {
                return isAccessibilityServiceEnabled() ? "GRANTED" : "DENIED";
            }
            if ("overlay".equals(permissionId)) {
                return canDrawOverlays() ? "GRANTED" : "DENIED";
            }
            if ("notifications".equals(permissionId)) {
                return hasNotificationPermission() ? "GRANTED" : "DENIED";
            }
            if ("oem_background_popups".equals(permissionId)) {
                return isIgnoringBatteryOptimizationsCompat() ? "GRANTED" : "DENIED";
            }
            return "PENDING";
        }

        @JavascriptInterface
        public String getNotificationChannelsStatusJson() {
            JSONObject out = new JSONObject();
            try {
                ensureNotificationChannelsCreated(MainActivity.this);
                NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                boolean areEnabled = nm == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.N || nm.areNotificationsEnabled();
                boolean postGranted = Build.VERSION.SDK_INT < 33 ||
                    checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED;
                out.put("areNotificationsEnabled", areEnabled);
                out.put("postNotificationsGranted", postGranted);
                out.put("groupId", WELLNESS_CHANNEL_GROUP_ID);

                JSONArray channelsArr = new JSONArray();
                if (nm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    List<NotificationChannel> list = nm.getNotificationChannels();
                    if (list != null) {
                        for (NotificationChannel ch : list) {
                            if (ch == null) continue;
                            JSONObject cObj = new JSONObject();
                            cObj.put("id", ch.getId());
                            cObj.put("name", ch.getName() != null ? ch.getName().toString() : "");
                            cObj.put("importance", ch.getImportance());
                            cObj.put("group", ch.getGroup() != null ? ch.getGroup() : "");
                            cObj.put("enabled", areEnabled && postGranted && ch.getImportance() != NotificationManager.IMPORTANCE_NONE);
                            channelsArr.put(cObj);
                        }
                    }
                }
                out.put("channels", channelsArr);
            } catch (Exception ignored) {
            }
            return out.toString();
        }

        private String classifyOemFamily(String manufacturer, String brand) {
            String combined = ((manufacturer != null ? manufacturer : "") + " " + (brand != null ? brand : ""))
                .toLowerCase(Locale.US);
            if (combined.contains("xiaomi") || combined.contains("redmi") || combined.contains("poco") || combined.contains("blackshark")) {
                return "XIAOMI_HYPEROS_MIUI";
            }
            if (combined.contains("samsung")) {
                return "SAMSUNG_ONEUI";
            }
            if (combined.contains("vivo") || combined.contains("iqoo")) {
                return "VIVO_ORIGIN_FUNTOUCH";
            }
            if (combined.contains("oppo") || combined.contains("realme") || combined.contains("oneplus")) {
                return "OPPO_REALME_ONEPLUS_COLOROS";
            }
            if (combined.contains("honor") || combined.contains("huawei")) {
                return "HONOR_HUAWEI_MAGICOS";
            }
            if (combined.contains("asus") || combined.contains("rog") || combined.contains("zenfone")) {
                return "ASUS_MOBILE_MANAGER";
            }
            if (combined.contains("tecno") || combined.contains("infinix") || combined.contains("itel")
                    || combined.contains("transsion") || combined.contains("hios") || combined.contains("xos")) {
                return "TRANSSION_HIOS_XOS";
            }
            return "STANDARD_AOSP_PIXEL_MOTO_NOTHING";
        }

        @JavascriptInterface
        public String getOemPermissionCapabilitiesJson() {
            JSONObject out = new JSONObject();
            try {
                String brand = Build.BRAND != null ? Build.BRAND.trim() : "";
                String manufacturer = Build.MANUFACTURER != null ? Build.MANUFACTURER.trim() : "";
                String oemFamily = classifyOemFamily(manufacturer, brand);
                String title;
                JSONArray items = new JSONArray();

                if ("XIAOMI_HYPEROS_MIUI".equals(oemFamily)) {
                    title = "HyperOS / MIUI Other Permissions & Background Pop-ups";
                    items.put("Show on Lock screen");
                    items.put("Display pop-up windows while running in the background");
                    items.put("Display pop-up window");
                    items.put("Home screen shortcuts");
                    items.put("Autostart / Background Autostart");
                } else if ("SAMSUNG_ONEUI".equals(oemFamily)) {
                    title = "One UI Unrestricted Battery & Appear on Top";
                    items.put("Appear on top (Display over other apps)");
                    items.put("Battery: Unrestricted (Never sleeping apps)");
                    items.put("Lock screen notifications: Show content");
                } else if ("VIVO_ORIGIN_FUNTOUCH".equals(oemFamily)) {
                    title = "OriginOS / FuntouchOS Background Pop-ups & Autostart";
                    items.put("Floating window");
                    items.put("Display on lock screen");
                    items.put("Background pop-ups");
                    items.put("Autostart & High background power consumption");
                } else if ("OPPO_REALME_ONEPLUS_COLOROS".equals(oemFamily)) {
                    title = "ColorOS / OxygenOS / Realme UI Floating Windows & Auto-launch";
                    items.put("Display over other apps / Floating windows");
                    items.put("Auto-launch & Allow background activity");
                    items.put("Banner & Lock screen notifications");
                } else if ("HONOR_HUAWEI_MAGICOS".equals(oemFamily)) {
                    title = "MagicOS / EMUI App Launch (Manage Manually) & Dropzone";
                    items.put("App launch: Manage manually (Auto-launch, Secondary launch, Run in background)");
                    items.put("Dropzone / Display over other apps");
                    items.put("Lock screen notifications");
                } else if ("ASUS_MOBILE_MANAGER".equals(oemFamily)) {
                    title = "ASUS Mobile Manager Auto-start & Unrestricted Battery";
                    items.put("Auto-start Manager: Allow ScreenSync");
                    items.put("Battery optimization: Unrestricted");
                    items.put("Display over other apps");
                } else if ("TRANSSION_HIOS_XOS".equals(oemFamily)) {
                    title = "HiOS / XOS Phone Master Auto-start & Battery Lab";
                    items.put("Phone Master: Enable Auto-start for ScreenSync");
                    items.put("Battery Lab: Don't optimize / Allow background usage");
                    items.put("Display over other apps");
                } else {
                    title = "Unrestricted Battery & Background Alerts";
                    items.put("Battery usage: Unrestricted");
                    items.put("Display over other apps");
                    items.put("Notifications on lock screen");
                }

                boolean pinSupported = false;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    AppWidgetManager awm = getSystemService(AppWidgetManager.class);
                    if (awm != null) {
                        pinSupported = awm.isRequestPinAppWidgetSupported();
                    }
                }

                String rawModel = Build.MODEL != null ? Build.MODEL.trim() : "";
                String marketingName = resolveKnownMarketingNameForModel(rawModel, brand, manufacturer);
                out.put("oemFamily", oemFamily);
                out.put("manufacturer", manufacturer);
                out.put("brand", brand);
                out.put("model", rawModel);
                out.put("deviceName", !marketingName.isEmpty() ? marketingName : rawModel);
                out.put("recommendedSettingsTitle", title);
                out.put("recommendedChecklistItems", items);
                out.put("batteryOptimizationIgnored", isIgnoringBatteryOptimizationsCompat());
                out.put("pinAppWidgetSupported", pinSupported);
            } catch (Exception ignored) {
            }
            return out.toString();
        }

        private boolean tryStartIntentSafely(Intent intent) {
            if (intent == null) return false;
            try {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                PackageManager pm = getPackageManager();
                if (pm != null) {
                    if (pm.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY) == null) {
                        return false;
                    }
                }
                startActivity(intent);
                return true;
            } catch (Exception ignored) {
            }
            return false;
        }

        @JavascriptInterface
        public boolean openOemPermissionSettings(String settingType) {
            String safeType = settingType != null ? settingType.trim().toLowerCase(Locale.US) : "oem_other_permissions";
            String pkg = getPackageName();
            String oemFamily = classifyOemFamily(Build.MANUFACTURER, Build.BRAND);

            // Handle Home Screen Widget Pinning request across all launchers (Android 8.0+ / API 26+)
            if ("pin_widget".equals(safeType) || "pin_reel_widget".equals(safeType) || "home_screen_shortcut".equals(safeType)) {
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        AppWidgetManager awm = getSystemService(AppWidgetManager.class);
                        if (awm != null && awm.isRequestPinAppWidgetSupported()) {
                            ComponentName provider = "pin_reel_widget".equals(safeType)
                                ? new ComponentName(MainActivity.this, ReelTrackerWidgetProvider.class)
                                : new ComponentName(MainActivity.this, ScreenTimeGoalWidgetProvider.class);
                            return awm.requestPinAppWidget(provider, null, null);
                        }
                    }
                } catch (Exception ignored) {
                }
                return false;
            }

            // Handle explicit battery optimization exemption request
            if ("battery_optimization".equals(safeType) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Intent reqIgnore = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + pkg));
                if (tryStartIntentSafely(reqIgnore)) return true;
                Intent listIgnore = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                if (tryStartIntentSafely(listIgnore)) return true;
            }

            // Handle explicit overlay / appear-on-top settings request (ISSUE-11-04 / CAT11-04)
            if (("overlay".equals(safeType) || "floating_window".equals(safeType)) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Intent overlayIntent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + pkg));
                if (tryStartIntentSafely(overlayIntent)) return true;
            }

            List<Intent> candidates = new ArrayList<>();

            if ("XIAOMI_HYPEROS_MIUI".equals(oemFamily)) {
                if ("autostart".equals(safeType)) {
                    Intent autoStart = new Intent("miui.intent.action.OP_AUTO_START");
                    autoStart.setComponent(new ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"));
                    candidates.add(autoStart);
                }
                Intent miui8 = new Intent("miui.intent.action.APP_PERM_EDITOR");
                miui8.setClassName("com.miui.securitycenter", "com.miui.permcenter.permissions.PermissionsEditorActivity");
                miui8.putExtra("extra_pkgname", pkg);
                candidates.add(miui8);

                Intent miuiOld = new Intent("miui.intent.action.APP_PERM_EDITOR");
                miuiOld.setClassName("com.miui.securitycenter", "com.miui.permcenter.permissions.AppPermissionsEditorActivity");
                miuiOld.putExtra("extra_pkgname", pkg);
                candidates.add(miuiOld);

                Intent powerKeeper = new Intent();
                powerKeeper.setComponent(new ComponentName("com.miui.powerkeeper", "com.miui.powerkeeper.ui.HiddenAppsConfigActivity"));
                powerKeeper.putExtra("package_name", pkg);
                powerKeeper.putExtra("package_label", "ScreenSync");
                candidates.add(powerKeeper);

                Intent miuiAuto = new Intent("miui.intent.action.OP_AUTO_START");
                miuiAuto.addCategory(Intent.CATEGORY_DEFAULT);
                candidates.add(miuiAuto);
            } else if ("VIVO_ORIGIN_FUNTOUCH".equals(oemFamily)) {
                Intent vivoPerm = new Intent();
                vivoPerm.setComponent(new ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.SoftPermissionDetailActivity"));
                vivoPerm.putExtra("packagename", pkg);

                Intent vivoFloat = new Intent();
                vivoFloat.setComponent(new ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.FloatWindowMgActivity"));

                Intent vivoBg = new Intent();
                vivoBg.setComponent(new ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"));

                Intent iqooWhite = new Intent();
                iqooWhite.setComponent(new ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"));

                Intent iqooBg = new Intent();
                iqooBg.setComponent(new ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"));

                if ("autostart".equals(safeType)) {
                    candidates.add(vivoBg);
                    candidates.add(iqooBg);
                    candidates.add(iqooWhite);
                    candidates.add(vivoPerm);
                    candidates.add(vivoFloat);
                } else {
                    candidates.add(vivoPerm);
                    candidates.add(vivoFloat);
                    candidates.add(vivoBg);
                    candidates.add(iqooWhite);
                    candidates.add(iqooBg);
                }
            } else if ("OPPO_REALME_ONEPLUS_COLOROS".equals(oemFamily)) {
                Intent oplusBatteryStartup = new Intent();
                oplusBatteryStartup.setComponent(new ComponentName("com.oplus.battery", "com.oplus.startupapp.view.StartupAppListActivity"));

                Intent oplusStart = new Intent();
                oplusStart.setComponent(new ComponentName("com.oplus.safecenter", "com.oplus.safecenter.permission.startup.StartupAppListActivity"));

                Intent oplusFloat = new Intent();
                oplusFloat.setComponent(new ComponentName("com.oplus.safecenter", "com.oplus.safecenter.permission.floatwindow.FloatWindowListActivity"));

                Intent colorStart = new Intent();
                colorStart.setComponent(new ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"));

                Intent colorFloat = new Intent();
                colorFloat.setComponent(new ComponentName("com.coloros.safecenter", "com.coloros.safecenter.sysfloatwindow.FloatWindowListActivity"));

                Intent heytapStart = new Intent();
                heytapStart.setComponent(new ComponentName("com.heytap.safecenter", "com.heytap.safecenter.permission.startup.StartupAppListActivity"));

                Intent oneplusChain = new Intent();
                oneplusChain.setComponent(new ComponentName("com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity"));

                if ("autostart".equals(safeType)) {
                    candidates.add(oplusBatteryStartup);
                    candidates.add(oplusStart);
                    candidates.add(colorStart);
                    candidates.add(heytapStart);
                    candidates.add(oneplusChain);
                    candidates.add(oplusFloat);
                    candidates.add(colorFloat);
                } else {
                    candidates.add(oplusFloat);
                    candidates.add(colorFloat);
                    candidates.add(oplusBatteryStartup);
                    candidates.add(oplusStart);
                    candidates.add(colorStart);
                    candidates.add(heytapStart);
                    candidates.add(oneplusChain);
                }
            } else if ("SAMSUNG_ONEUI".equals(oemFamily)) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !isIgnoringBatteryOptimizationsCompat()) {
                    candidates.add(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + pkg)));
                }
                Intent samLool = new Intent();
                samLool.setComponent(new ComponentName("com.samsung.android.lool", "com.samsung.android.sm.battery.ui.BatteryActivity"));
                candidates.add(samLool);

                Intent samSm = new Intent();
                samSm.setComponent(new ComponentName("com.samsung.android.sm", "com.samsung.android.sm.ui.battery.BatteryActivity"));
                candidates.add(samSm);

                Intent samSmCn = new Intent();
                samSmCn.setComponent(new ComponentName("com.samsung.android.sm_cn", "com.samsung.android.sm.ui.ram.AutoRunActivity"));
                candidates.add(samSmCn);

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    candidates.add(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + pkg)));
                }
            } else if ("HONOR_HUAWEI_MAGICOS".equals(oemFamily)) {
                Intent honorProtect = new Intent();
                honorProtect.setComponent(new ComponentName("com.hihonor.systemmanager", "com.hihonor.systemmanager.optimize.process.ProtectActivity"));

                Intent honorStartup = new Intent();
                honorStartup.setComponent(new ComponentName("com.hihonor.systemmanager", "com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity"));

                Intent huaweiStartup = new Intent();
                huaweiStartup.setComponent(new ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"));

                Intent huaweiProtect = new Intent();
                huaweiProtect.setComponent(new ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"));

                Intent huaweiAddView = new Intent();
                huaweiAddView.setComponent(new ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.addviewmonitor.AddViewMonitorActivity"));

                if ("autostart".equals(safeType)) {
                    candidates.add(honorStartup);
                    candidates.add(huaweiStartup);
                    candidates.add(honorProtect);
                    candidates.add(huaweiProtect);
                    candidates.add(huaweiAddView);
                } else {
                    candidates.add(huaweiAddView);
                    candidates.add(honorProtect);
                    candidates.add(huaweiProtect);
                    candidates.add(honorStartup);
                    candidates.add(huaweiStartup);
                }
            } else if ("ASUS_MOBILE_MANAGER".equals(oemFamily)) {
                Intent asusAuto = new Intent();
                asusAuto.setComponent(new ComponentName("com.asus.mobilemanager", "com.asus.mobilemanager.autostart.AutoStartActivity"));
                candidates.add(asusAuto);
            } else if ("TRANSSION_HIOS_XOS".equals(oemFamily)) {
                Intent transsionAuto = new Intent();
                transsionAuto.setComponent(new ComponentName("com.transsion.phonemaster", "com.cyin.himgr.autostart.AutoStartActivity"));
                candidates.add(transsionAuto);

                Intent transsionMain = new Intent();
                transsionMain.setComponent(new ComponentName("com.transsion.phonemaster", "com.cyin.himgr.widget.activity.MainActivity"));
                candidates.add(transsionMain);
            }

            // Standard Android battery optimization & application details fallbacks across Pixel, Motorola, Nothing, Sony, and all brands
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !isIgnoringBatteryOptimizationsCompat()) {
                candidates.add(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + pkg)));
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                candidates.add(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
            }
            candidates.add(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg)));

            for (Intent candidate : candidates) {
                if (tryStartIntentSafely(candidate)) {
                    return true;
                }
            }
            return false;
        }

        @JavascriptInterface
        public String setFloatingPillConfigJson(String payloadJson) {
            try {
                JSONObject obj = payloadJson != null && !payloadJson.trim().isEmpty()
                    ? new JSONObject(payloadJson)
                    : new JSONObject();
                String mode = obj.optString("mode", "STUCKED_DYNAMIC_ISLAND");
                String edge = obj.optString("snappedEdge", "TOP");
                double xRatio = obj.optDouble("xRatio", 0.5);
                double yRatio = obj.optDouble("yRatio", 0.02);
                android.content.SharedPreferences prefs = getSharedPreferences("screensync_wellness_store", Context.MODE_PRIVATE);
                prefs.edit()
                    .putString("floating_pill_config_json", obj.toString())
                    .putString("island_presentation_mode", mode)
                    .putString("floating_pill_snapped_edge", edge)
                    .putFloat("floating_pill_x_ratio", (float) xRatio)
                    .putFloat("floating_pill_y_ratio", (float) yRatio)
                    .apply();
                ScreenSyncAccessibilityService svc = ScreenSyncAccessibilityService.getActiveInstance();
                if (svc != null) {
                    svc.showOrUpdateDynamicIslandOverlay();
                }
                return "{\"ok\":true,\"mode\":" + JSONObject.quote(mode) + ",\"snappedEdge\":" + JSONObject.quote(edge) + "}";
            } catch (Exception e) {
                return "{\"ok\":false}";
            }
        }

        @JavascriptInterface
        public String getFloatingPillConfigJson() {
            try {
                android.content.SharedPreferences prefs = getSharedPreferences("screensync_wellness_store", Context.MODE_PRIVATE);
                return prefs.getString("floating_pill_config_json", "{\"mode\":\"STUCKED_DYNAMIC_ISLAND\",\"snappedEdge\":\"TOP\",\"xRatio\":0.5,\"yRatio\":0.02}");
            } catch (Exception e) {
                return "{\"mode\":\"STUCKED_DYNAMIC_ISLAND\",\"snappedEdge\":\"TOP\",\"xRatio\":0.5,\"yRatio\":0.02}";
            }
        }

        @JavascriptInterface
        public String getDisplayCutoutJson() {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && getWindow() != null && getWindow().getDecorView() != null) {
                    WindowInsets insets = getWindow().getDecorView().getRootWindowInsets();
                    if (insets != null) {
                        DisplayCutout cutout = insets.getDisplayCutout();
                        if (cutout != null) {
                            float density = Math.max(1f, getResources().getDisplayMetrics().density);
                            List<Rect> rects = cutout.getBoundingRects();
                            JSONArray arr = new JSONArray();
                            JSONObject primaryRectObj = null;
                            int firstLeft = 0, firstTop = 0, firstRight = 0, firstBottom = 0;
                            for (int i = 0; i < rects.size(); i++) {
                                Rect r = rects.get(i);
                                int lDp = Math.round(r.left / density);
                                int tDp = Math.round(r.top / density);
                                int rDp = Math.round(r.right / density);
                                int bDp = Math.round(r.bottom / density);
                                JSONObject ro = new JSONObject();
                                ro.put("left", lDp);
                                ro.put("top", tDp);
                                ro.put("right", rDp);
                                ro.put("bottom", bDp);
                                ro.put("width", Math.max(0, rDp - lDp));
                                ro.put("height", Math.max(0, bDp - tDp));
                                arr.put(ro);
                                if (i == 0) {
                                    firstLeft = lDp;
                                    firstTop = tDp;
                                    firstRight = rDp;
                                    firstBottom = bDp;
                                    primaryRectObj = ro;
                                }
                            }
                            JSONObject out = new JSONObject();
                            out.put("schema", 2);
                            out.put("unit", "dp");
                            out.put("density", density);
                            out.put("hasCutout", !rects.isEmpty());
                            out.put("safeInsetTop", Math.round(cutout.getSafeInsetTop() / density));
                            out.put("safeInsetBottom", Math.round(cutout.getSafeInsetBottom() / density));
                            out.put("safeInsetLeft", Math.round(cutout.getSafeInsetLeft() / density));
                            out.put("safeInsetLeftPx", cutout.getSafeInsetLeft());
                            out.put("safeInsetRight", Math.round(cutout.getSafeInsetRight() / density));
                            out.put("left", firstLeft);
                            out.put("top", firstTop);
                            out.put("right", firstRight);
                            out.put("bottom", firstBottom);
                            out.put("width", Math.max(0, firstRight - firstLeft));
                            out.put("height", Math.max(0, firstBottom - firstTop));
                            if (primaryRectObj != null) {
                                out.put("boundingRect", primaryRectObj);
                                out.put("primaryRectDp", primaryRectObj);
                            }
                            out.put("boundingRects", arr);
                            return out.toString();
                        }
                    }
                }
            } catch (Exception ignored) {}
            return "{\"hasCutout\":false,\"unit\":\"dp\"}";
        }

        @JavascriptInterface
        public String getDeviceInfoJson() {
            JSONObject out = new JSONObject();
            try {
                String brand = Build.BRAND != null ? Build.BRAND.trim() : "";
                String manufacturer = Build.MANUFACTURER != null ? Build.MANUFACTURER.trim() : "";
                String model = Build.MODEL != null ? Build.MODEL.trim() : "Android Device";
                String vendorPrefix = !brand.isEmpty() ? brand : manufacturer;
                String fullModelName = model.toLowerCase(Locale.US).startsWith(vendorPrefix.toLowerCase(Locale.US))
                    ? model
                    : (vendorPrefix + " " + model).trim();

                // 1. Query OEM system properties in priority order
                String[] oemMarketProps = new String[]{
                    "ro.product.marketname",
                    "ro.product.odm.marketname",
                    "ro.product.vendor.marketname",
                    "ro.vendor.oplus.market.name",
                    "ro.oppo.market.name",
                    "ro.product.oplus.marketname",
                    "ro.vivo.market.name",
                    "ro.vivo.product.release.name",
                    "ro.config.marketing_name",
                    "ro.product.model.display"
                };
                String oemMarketName = "";
                for (String propKey : oemMarketProps) {
                    String val = readSystemProperty(propKey);
                    if (!val.isEmpty() && !isRawRegulatoryModelCode(val, model)) {
                        oemMarketName = val;
                        break;
                    }
                }

                // 2. Query user-configured device name settings, rejecting raw regulatory SKU codes
                String customDeviceName = "";
                String[] settingsCandidates = new String[5];
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N_MR1) {
                    settingsCandidates[0] = Settings.Global.getString(getContentResolver(), Settings.Global.DEVICE_NAME);
                }
                settingsCandidates[1] = Settings.System.getString(getContentResolver(), "device_name");
                settingsCandidates[2] = Settings.System.getString(getContentResolver(), "oppo_device_name");
                settingsCandidates[3] = Settings.System.getString(getContentResolver(), "vivo_device_name");
                settingsCandidates[4] = Settings.Secure.getString(getContentResolver(), "bluetooth_name");
                for (String cand : settingsCandidates) {
                    if (cand != null && !cand.trim().isEmpty() && !isRawRegulatoryModelCode(cand.trim(), model)) {
                        customDeviceName = cand.trim();
                        break;
                    }
                }

                // 3. Check cached online marketing name in SharedPreferences
                android.content.SharedPreferences nativePrefs = getSharedPreferences("screensync_native_prefs", Context.MODE_PRIVATE);
                String cachedOnlineName = nativePrefs.getString("resolved_marketing_name_" + model, "");
                if (cachedOnlineName != null) {
                    cachedOnlineName = cachedOnlineName.trim();
                } else {
                    cachedOnlineName = "";
                }

                // 4. Built-in offline SKU dictionary fallback
                String dictMarketingName = resolveKnownMarketingNameForModel(model, brand, manufacturer);

                // 5. Select final displayDeviceName
                String displayDeviceName = "";
                if (!customDeviceName.isEmpty()) {
                    displayDeviceName = customDeviceName;
                } else if (!oemMarketName.isEmpty()) {
                    displayDeviceName = oemMarketName;
                } else if (!cachedOnlineName.isEmpty() && !isRawRegulatoryModelCode(cachedOnlineName, model)) {
                    displayDeviceName = cachedOnlineName;
                } else if (!dictMarketingName.isEmpty()) {
                    displayDeviceName = dictMarketingName;
                } else {
                    displayDeviceName = fullModelName;
                }

                String androidId = Settings.Secure.getString(getContentResolver(), Settings.Secure.ANDROID_ID);
                if (androidId == null || androidId.isEmpty() || "9774d56d682e549c".equals(androidId)) {
                    androidId = "and_" + Build.BOARD + "_" + Build.MODEL.replaceAll("\\s+", "_");
                }

                int swDp = getResources().getConfiguration().smallestScreenWidthDp;
                String deviceCategory = swDp >= 600 ? "Tablet" : "Phone";

                String detectedCutout = "PUNCH_HOLE";
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && getWindow() != null && getWindow().getDecorView() != null) {
                        WindowInsets insets = getWindow().getDecorView().getRootWindowInsets();
                        if (insets != null) {
                            DisplayCutout dc = insets.getDisplayCutout();
                            if (dc == null || dc.getBoundingRects().isEmpty()) {
                                detectedCutout = "FULLSCREEN";
                            } else {
                                Rect r = dc.getBoundingRects().get(0);
                                int screenW = Math.max(1, getResources().getDisplayMetrics().widthPixels);
                                float centerX = r.exactCenterX();
                                if (centerX < screenW * 0.35f) detectedCutout = "CORNER_LEFT";
                                else if (centerX > screenW * 0.65f) detectedCutout = "CORNER_RIGHT";
                                else if (r.width() > r.height() * 2.2f) detectedCutout = r.top > 4 ? "IPHONE_PILL" : "TRUEDEPTH_NOTCH";
                                else detectedCutout = r.top > 4 ? "PUNCH_HOLE" : "WATERDROP";
                            }
                        }
                    }
                } catch (Exception ignored) {}

                out.put("installationId", "inst_and_" + androidId);
                out.put("key", "and_" + androidId);
                out.put("deviceName", displayDeviceName);
                out.put("marketName", displayDeviceName);
                out.put("rawModel", model);
                out.put("model", fullModelName);
                out.put("needsOnlineModelLookup", isRawRegulatoryModelCode(displayDeviceName, model));
                out.put("manufacturer", manufacturer);
                out.put("brand", brand);
                out.put("oemFamily", classifyOemFamily(manufacturer, brand));
                out.put("osCategory", "Android");
                out.put("deviceCategory", deviceCategory);
                out.put("osVersion", "Android " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")");
                out.put("cutoutType", detectedCutout);
            } catch (Exception ignored) {
            }
            return out.toString();
        }

        
        @JavascriptInterface
        public String getScreenSyncCountersHistoryJson(String sinceDayKey) {
            try {
                if (usageDbHelper == null) {
                    usageDbHelper = new AppUsageDatabaseHelper(MainActivity.this);
                }
                JSONObject history = usageDbHelper.queryReelHistorySince(sinceDayKey);
                return history.toString();
            } catch (Exception e) {
                return "{\"days\":{},\"hourlyBuckets\":[]}";
            }
        }

        @JavascriptInterface
        public String getScreenSyncCountersJson() {
            try {
                android.content.SharedPreferences prefs = getSharedPreferences("screensync_wellness_store", Context.MODE_PRIVATE);
                JSONObject out = new JSONObject();
                String curDayKey = prefs.getString("current_day_key", "");
                int fastSkips = prefs.getInt("daily_fast_skip_count", 0);
                int flicks = prefs.getInt("daily_flick_count", 0);
                out.put("dayKey", curDayKey);
                out.put("dailyReelCount", prefs.getInt("daily_reel_count", 0));
                out.put("dailyWatchDurationMs", prefs.getLong("daily_watch_duration_ms", 0L));
                out.put("fastSkippedCount", fastSkips);
                out.put("flickCount", flicks);
                out.put("skippedCount", fastSkips + flicks);
                try {
                    if (usageDbHelper == null) {
                        usageDbHelper = new AppUsageDatabaseHelper(MainActivity.this);
                    }
                    if (curDayKey != null && !curDayKey.isEmpty()) {
                        JSONObject histToday = usageDbHelper.queryReelHistorySince(curDayKey);
                        if (histToday != null && histToday.has("hourlyBuckets")) {
                            out.put("hourlyBuckets", histToday.getJSONArray("hourlyBuckets"));
                        }
                    }
                } catch (Exception ignored) {}

                JSONObject byPkg = new JSONObject();
                String[] trackedPkgs = new String[]{
                    "com.instagram.android", "com.google.android.youtube",
                    "com.zhiliaoapp.musically", "com.ss.android.ugc.trill",
                    "com.zhiliaoapp.musically.go", "com.facebook.katana",
                    "com.facebook.lite", "com.facebook.orca",
                    "com.whatsapp", "com.whatsapp.w4b", "com.snapchat.android",
                    "com.twitter.android", "com.reddit.frontpage",
                    "com.instagram.lite", "com.tiktok.lite.go",
                    "com.android.chrome", "com.chrome.beta", "com.chrome.dev", "com.chrome.canary",
                    "com.sec.android.app.sbrowser", "com.mi.globalbrowser", "com.android.browser",
                    "com.vivo.browser", "com.heytap.browser", "com.coloros.browser",
                    "org.mozilla.firefox", "org.mozilla.firefox_beta", "org.mozilla.fenix",
                    "com.microsoft.emmx", "com.brave.browser",
                    "com.opera.browser", "com.opera.gx", "com.opera.mini.native", "com.duckduckgo.mobile.android",
                    "com.vivaldi.browser", "com.kiwibrowser.browser", "com.UCMobile.intl"
                };
                PackageManager pm = getPackageManager();
                for (String pkg : trackedPkgs) {
                    int cnt = prefs.getInt("pkg_count_" + pkg, 0);
                    long wMs = prefs.getLong("pkg_watch_ms_" + pkg, 0L);
                    if (cnt > 0 || wMs > 0L) {
                        JSONObject pObj = new JSONObject();
                        pObj.put("reelCount", cnt);
                        pObj.put("watchDurationMs", wMs);
                        pObj.put("appName", resolveCachedAppLabel(pm, pkg));
                        pObj.put("isNativeOsLabel", true);
                        String bpIcon = resolveCachedAppIconDataUri(pm, pkg);
                        if (bpIcon != null && !bpIcon.isEmpty()) {
                            pObj.put("iconDataUri", bpIcon);
                        }
                        byPkg.put(pkg, pObj);
                    }
                }
                out.put("byPackage", byPkg);
                return out.toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public String getInstalledAppsJson() {
            long nowMs = System.currentTimeMillis();
            if (cachedInstalledAppsJson != null && (nowMs - cachedInstalledAppsAtMs) < 1800000L) {
                return cachedInstalledAppsJson;
            }
            JSONArray arr = new JSONArray();
            try {
                PackageManager pm = getPackageManager();
                Set<String> excludedPkgs = getExcludedLauncherAndSystemPackages();
                Intent mainIntent = new Intent(Intent.ACTION_MAIN, null);
                mainIntent.addCategory(Intent.CATEGORY_LAUNCHER);
                List<ResolveInfo> resolved = pm.queryIntentActivities(mainIntent, 0);
                Set<String> seenPackages = new HashSet<>();
                if (resolved != null) {
                    for (ResolveInfo ri : resolved) {
                        if (ri.activityInfo == null || ri.activityInfo.packageName == null) continue;
                        String pkgName = ri.activityInfo.packageName;
                        if (excludedPkgs.contains(pkgName) || seenPackages.contains(pkgName)) continue;
                        seenPackages.add(pkgName);
                        CharSequence labelSeq = ri.loadLabel(pm);
                        String appLabel = (labelSeq != null && labelSeq.length() > 0)
                            ? labelSeq.toString().trim()
                            : resolveCachedAppLabel(pm, pkgName);
                        if (appLabel.isEmpty()) appLabel = pkgName;
                        appLabelCache.put(pkgName, appLabel);
                        String iconDataUri = encodeDrawableToDataUri(ri.loadIcon(pm));
                        if (iconDataUri == null || iconDataUri.isEmpty()) {
                            iconDataUri = resolveCachedAppIconDataUri(pm, pkgName);
                        } else {
                            appIconCache.put(pkgName, iconDataUri);
                        }
                        JSONObject obj = new JSONObject();
                        obj.put("packageId", pkgName);
                        obj.put("name", appLabel);
                        obj.put("appName", appLabel);
                        obj.put("isNativeOsLabel", true);
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && ri.activityInfo.applicationInfo != null) {
                            int catId = ri.activityInfo.applicationInfo.category;
                            obj.put("androidCategoryId", catId);
                            String mappedCat = mapAndroidCategoryToScreenSync(catId);
                            if (mappedCat != null) obj.put("category", mappedCat);
                        }
                        if (iconDataUri != null && !iconDataUri.isEmpty()) {
                            obj.put("iconDataUri", iconDataUri);
                        }
                        arr.put(obj);
                    }
                }
                List<ApplicationInfo> installedApps = pm.getInstalledApplications(0);
                if (installedApps != null) {
                    for (ApplicationInfo ai : installedApps) {
                        if (ai == null || ai.packageName == null) continue;
                        String pkgName = ai.packageName;
                        if (excludedPkgs.contains(pkgName) || seenPackages.contains(pkgName)) continue;
                        boolean isUserOrLaunchable = pm.getLaunchIntentForPackage(pkgName) != null
                            || (ai.flags & ApplicationInfo.FLAG_SYSTEM) == 0
                            || (ai.flags & ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) != 0;
                        if (!isUserOrLaunchable) continue;
                        seenPackages.add(pkgName);
                        String appLabel = resolveCachedAppLabel(pm, pkgName);
                        String iconDataUri = resolveCachedAppIconDataUri(pm, pkgName);
                        JSONObject obj = new JSONObject();
                        obj.put("packageId", pkgName);
                        obj.put("name", appLabel);
                        obj.put("appName", appLabel);
                        obj.put("isNativeOsLabel", true);
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            int catId = ai.category;
                            obj.put("androidCategoryId", catId);
                            String mappedCat = mapAndroidCategoryToScreenSync(catId);
                            if (mappedCat != null) obj.put("category", mappedCat);
                        }
                        if (iconDataUri != null && !iconDataUri.isEmpty()) {
                            obj.put("iconDataUri", iconDataUri);
                        }
                        arr.put(obj);
                    }
                }
                cachedInstalledAppsJson = arr.toString();
                cachedInstalledAppsAtMs = nowMs;
            } catch (Exception e) {
                android.util.Log.w("ScreenSyncMainActivity", "getInstalledAppsJson failed", e);
            }
            return cachedInstalledAppsJson != null ? cachedInstalledAppsJson : arr.toString();
        }

        @JavascriptInterface
        public void syncAppTimersAndFocusStateJson(String payloadJson) {
            try {
                android.content.SharedPreferences prefs = getSharedPreferences("screensync_wellness_store", Context.MODE_PRIVATE);
                android.content.SharedPreferences.Editor ed = prefs.edit();
                ed.putString("synced_timers_and_focus_json", payloadJson != null ? payloadJson : "{}");
                if (payloadJson != null && !payloadJson.isEmpty()) {
                    JSONObject obj = new JSONObject(payloadJson);
                    boolean masterEnabled = obj.optBoolean("master_enabled", obj.optBoolean("masterEnabled", true));
                    ed.putBoolean("master_enabled", masterEnabled);
                    String dayKey = obj.optString("goalDayKey", NativeGoalAlertEvaluator.getTodayKey());
                    ed.putString("widget_day_key", dayKey);
                    ed.putString("goal_day_key", dayKey);
                    persistWidgetMetricsToStore(ed, prefs, obj, dayKey);
                    if (obj.has("goalReachedEnabled")) ed.putBoolean("goal_reached_enabled", obj.optBoolean("goalReachedEnabled", true));
                    if (obj.has("dailySummaryEnabled")) ed.putBoolean("daily_summary_enabled", obj.optBoolean("dailySummaryEnabled", true));
                    if (obj.has("dailySummaryTime")) ed.putString("daily_summary_time", obj.optString("dailySummaryTime", "21:00"));
                    if (obj.has("breakRemindersEnabled")) ed.putBoolean("break_reminders_enabled", obj.optBoolean("breakRemindersEnabled", true));
                    if (obj.has("breakIntervalMinutes")) ed.putInt("break_interval_mins", obj.optInt("breakIntervalMinutes", 45));
                    if (obj.has("quietHoursEnabled")) ed.putBoolean("quiet_hours_enabled", obj.optBoolean("quietHoursEnabled", true));
                    if (obj.has("quietHoursStart")) ed.putString("quiet_hours_start", obj.optString("quietHoursStart", "22:30"));
                    if (obj.has("quietHoursEnd")) ed.putString("quiet_hours_end", obj.optString("quietHoursEnd", "07:00"));
                    if (obj.has("windDownEnabled")) ed.putBoolean("wind_down_enabled", obj.optBoolean("windDownEnabled", true));
                    if (obj.has("windDownSnoozedUntilMs")) ed.putLong("wind_down_snoozed_until_ms", obj.optLong("windDownSnoozedUntilMs", 0L));
                    if (obj.has("windDownGrayscaleActive")) ed.putBoolean("wind_down_grayscale_active", obj.optBoolean("windDownGrayscaleActive", false));
                    if (obj.has("reelDetoxEnabled")) ed.putBoolean("reel_detox_enabled", obj.optBoolean("reelDetoxEnabled", true));
                    if (obj.has("reelDetoxThreshold")) ed.putInt("reel_detox_threshold", obj.optInt("reelDetoxThreshold", 25));
                    if (obj.has("reelDetoxCooldownSeconds")) {
                        ed.putInt("reel_detox_cooldown_seconds", Math.max(3, Math.min(30, obj.optInt("reelDetoxCooldownSeconds", 5))));
                    }
                }
                ed.apply();
                if (payloadJson != null && !payloadJson.isEmpty() && appTimerSuspensionManager != null) {
                    try {
                        JSONObject rootObj = new JSONObject(payloadJson);
                        JSONObject timersObj = rootObj.optJSONObject("appTimers");
                        if (timersObj != null) {
                            java.util.Iterator<String> tKeys = timersObj.keys();
                            while (tKeys.hasNext()) {
                                String tk = tKeys.next();
                                if (tk == null) continue;
                                JSONObject tCfg = timersObj.optJSONObject(tk);
                                int limMins = tCfg != null ? tCfg.optInt("minutes", 0) : timersObj.optInt(tk, 0);
                                String resolvedPkg = resolvePackageFromAppKey(tk, tCfg);
                                if (resolvedPkg != null && !resolvedPkg.isEmpty()) {
                                    if (limMins > 0) {
                                        appTimerSuspensionManager.registerDailyAppTimer(
                                            Math.abs(resolvedPkg.hashCode()),
                                            resolvedPkg,
                                            (long) limMins * 60000L,
                                            0L,
                                            null
                                        );
                                    } else {
                                        appTimerSuspensionManager.unsuspendPackageAtMidnightOrUserOverride(resolvedPkg);
                                    }
                                }
                            }
                        }
                    } catch (Exception ignored) {}
                }
                NativeGoalAlertEvaluator.evaluate(MainActivity.this, "GOAL_UPDATED");
                ScreenSyncWidgetUpdater.updateAllWidgets(MainActivity.this);
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void syncAppTimersJson(String payloadJson) {
            syncAppTimersAndFocusStateJson(payloadJson);
        }

        private String resolvePackageFromAppKey(String appKeyOrPkg, JSONObject timerEntry) {
            if (timerEntry != null) {
                JSONArray pkgs = timerEntry.optJSONArray("packages");
                if (pkgs != null && pkgs.length() > 0) {
                    String p0 = pkgs.optString(0, "").trim();
                    if (!p0.isEmpty()) return p0;
                }
            }
            if (appKeyOrPkg == null) return "";
            String k = appKeyOrPkg.trim();
            String low = k.toLowerCase(Locale.US);
            if ("instagram".equals(low)) return "com.instagram.android";
            if ("youtube".equals(low)) return "com.google.android.youtube";
            if ("tiktok".equals(low)) return "com.zhiliaoapp.musically";
            if ("facebook".equals(low)) return "com.facebook.katana";
            if ("fblite".equals(low)) return "com.facebook.lite";
            if ("messenger".equals(low)) return "com.facebook.orca";
            if ("whatsapp".equals(low)) return "com.whatsapp";
            if ("whatsapp_business".equals(low)) return "com.whatsapp.w4b";
            if ("instagram_lite".equals(low)) return "com.instagram.lite";
            if ("tiktok_lite".equals(low)) return "com.tiktok.lite.go";
            if ("youtube_music".equals(low)) return "com.google.android.apps.youtube.music";
            if ("snapchat".equals(low)) return "com.snapchat.android";
            if ("x".equals(low) || "twitter".equals(low)) return "com.twitter.android";
            if ("reddit".equals(low)) return "com.reddit.frontpage";
            if ("netflix".equals(low)) return "com.netflix.mediaclient";
            if ("spotify".equals(low)) return "com.spotify.music";
            if ("discord".equals(low)) return "com.discord";
            if ("telegram".equals(low)) return "org.telegram.messenger";
            if ("linkedin".equals(low)) return "com.linkedin.android";
            if ("pinterest".equals(low)) return "com.pinterest";
            if ("twitch".equals(low)) return "tv.twitch.android.app";
            if ("notion".equals(low)) return "notion.id";
            if ("figma".equals(low)) return "com.figma.android";
            if ("slack".equals(low)) return "com.Slack";
            if ("zoom".equals(low)) return "us.zoom.videomeetings";
            if ("teams".equals(low)) return "com.microsoft.teams";
            if ("chrome".equals(low)) return "com.android.chrome";
            if ("claude".equals(low)) return "com.anthropic.claude";
            if ("google".equals(low)) return "com.google.android.googlequicksearchbox";
            return k;
        }

        @JavascriptInterface
        public String getAudioExposureStatusJson() {
            return getNativeAudioExposureJson();
        }

        @JavascriptInterface
        public String getLastNativeDailySummaryDate() {
            try {
                android.content.SharedPreferences prefs = getSharedPreferences("screensync_wellness_store", Context.MODE_PRIVATE);
                return prefs.getString("last_native_daily_summary_date", "");
            } catch (Exception ignored) {
                return "";
            }
        }

        @JavascriptInterface
        public void setLastNativeDailySummaryDate(String dateStr) {
            try {
                android.content.SharedPreferences prefs = getSharedPreferences("screensync_wellness_store", Context.MODE_PRIVATE);
                prefs.edit().putString("last_native_daily_summary_date", dateStr != null ? dateStr.trim() : "").apply();
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public String getLastNotificationDispatchResultJson() {
            return lastNotificationDispatchResultJson;
        }

        @JavascriptInterface
        public String getNativeAudioExposureJson() {
            JSONObject res = new JSONObject();
            try {
                android.media.AudioManager am = (android.media.AudioManager) getSystemService(Context.AUDIO_SERVICE);
                if (am == null) {
                    res.put("ok", false);
                    return res.toString();
                }
                int curVol = am.getStreamVolume(android.media.AudioManager.STREAM_MUSIC);
                int maxVol = Math.max(1, am.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC));
                boolean isMusicActive = am.isMusicActive();
                boolean isHeadphonesConnected = false;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    android.media.AudioDeviceInfo[] devices = am.getDevices(android.media.AudioManager.GET_DEVICES_OUTPUTS);
                    if (devices != null) {
                        for (android.media.AudioDeviceInfo d : devices) {
                            int type = d.getType();
                            if (type == android.media.AudioDeviceInfo.TYPE_WIRED_HEADSET
                                    || type == android.media.AudioDeviceInfo.TYPE_WIRED_HEADPHONES
                                    || type == android.media.AudioDeviceInfo.TYPE_BLUETOOTH_A2DP
                                    || type == android.media.AudioDeviceInfo.TYPE_BLUETOOTH_SCO
                                    || type == android.media.AudioDeviceInfo.TYPE_USB_HEADSET
                                    || type == 26
                                    || type == 27
                                    || type == 30) {
                                isHeadphonesConnected = true;
                                break;
                            }
                        }
                    }
                }
                double volumeScalar = Math.max(0.0, Math.min(1.0, (double) curVol / (double) maxVol));
                double baseSpl = isHeadphonesConnected ? 102.0 : 90.0;
                double clampedVol = Math.max(0.001, volumeScalar);
                double estimatedSplDbA = Math.round((baseSpl + 20.0 * Math.log10(clampedVol)) * 100.0) / 100.0;
                res.put("ok", true);
                res.put("isMusicActive", isMusicActive);
                res.put("isHeadphonesConnected", isHeadphonesConnected);
                res.put("deviceType", isHeadphonesConnected ? "Earphones" : "Speakers");
                res.put("volumeScalar", volumeScalar);
                res.put("estimatedSplDbA", estimatedSplDbA);
                res.put("whoReferenceDbA", 80.0);
            } catch (Exception e) {
                try { res.put("ok", false); } catch (Exception ignored) {}
            }
            return res.toString();
        }

        private String mapAndroidCategoryToScreenSync(int categoryId) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                switch (categoryId) {
                    case ApplicationInfo.CATEGORY_SOCIAL:
                        return "Social networking";
                    case ApplicationInfo.CATEGORY_VIDEO:
                    case ApplicationInfo.CATEGORY_GAME:
                    case ApplicationInfo.CATEGORY_AUDIO:
                    case ApplicationInfo.CATEGORY_IMAGE:
                        return "Entertainment";
                    case ApplicationInfo.CATEGORY_PRODUCTIVITY:
                    case ApplicationInfo.CATEGORY_NEWS:
                        return "Productivity & finance";
                    default:
                        return null;
                }
            }
            return null;
        }

        @JavascriptInterface
        public String getAppTimerCapabilityJson() {
            JSONObject obj = new JSONObject();
            try {
                boolean hasUsage = hasUsageStatsPermission();
                boolean hasAcc = isAccessibilityServiceEnabled();
                boolean hasOverlay = Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(MainActivity.this);
                boolean canBlock = hasUsage && (hasAcc || hasOverlay);
                obj.put("platform", "Android");
                obj.put("canBlock", canBlock);
                obj.put("supported", canBlock);
                obj.put("canWarn", true);
                obj.put("mode", canBlock ? "NATIVE_OS_BLOCKER" : "WARNING_ONLY");
                obj.put("explanation", canBlock
                    ? "Android AccessibilityService + System Alert Window shield active when daily app limit is reached."
                    : "Alerts at 80% and 100% of your daily app limit (grant Accessibility & Overlay permissions for OS app shield).");
            } catch (Exception ignored) {}
            return obj.toString();
        }

        @JavascriptInterface
        public boolean enforceAppBlock(String appKey) {
            return enforceAppBlock(appKey, 0);
        }

        @JavascriptInterface
        public boolean enforceAppBlock(String appKey, int limitMinutes) {
            boolean allowed = hasUsageStatsPermission() && (isAccessibilityServiceEnabled() || Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(MainActivity.this));
            if (allowed && appKey != null && !appKey.trim().isEmpty()) {
                final String resolvedPkg = resolvePackageFromAppKey(appKey, null);
                final String friendlyLabel = resolveCachedAppLabel(getPackageManager(), resolvedPkg);
                final String displayLabel = (friendlyLabel != null && !friendlyLabel.trim().isEmpty()) ? friendlyLabel : appKey.trim();
                if (appTimerSuspensionManager != null && resolvedPkg != null && !resolvedPkg.isEmpty()) {
                    appTimerSuspensionManager.suspendPackageForExpiredTimer(resolvedPkg);
                }
                ScreenSyncAccessibilityService accSvc = ScreenSyncAccessibilityService.getActiveInstance();
                if (accSvc != null && resolvedPkg != null && !resolvedPkg.isEmpty()) {
                    accSvc.enforceAppTimerBlockFromBridge(resolvedPkg, displayLabel, limitMinutes);
                }
                final String detailMsg = limitMinutes > 0
                    ? (displayLabel + " daily limit (" + limitMinutes + "m) reached.")
                    : (displayLabel + " daily limit reached.");
                runOnUiThread(() -> showTransientGoalAlert("App Timer Limit Reached", detailMsg, 5000L));
            }
            return allowed;
        }

        private JSONObject computeAccurateUsageFromEvents(UsageStatsManager usm, long startMs, long endMs) throws Exception {
            long nowMs = System.currentTimeMillis();
            if (usageIngestionEngine != null && (nowMs - lastUsageIngestionAtMs) >= 15000L) {
                lastUsageIngestionAtMs = nowMs;
                usageIngestionEngine.ingestIncrementalEvents(nowMs);
            }
            Set<String> excludedPkgs = getExcludedLauncherAndSystemPackages();
            long startEpochMs = startMs;
            long lookbackStartMs = Math.max(0L, startEpochMs - (12L * 3600L * 1000L));

            java.util.Map<String, Integer> appNotifCounts = new java.util.HashMap<>();
            int totalNotifications = 0;

            if (usm != null) {
                UsageEvents liveEvents = usm.queryEvents(startMs, endMs);
                UsageEvents.Event uEv = new UsageEvents.Event();
                while (liveEvents != null && liveEvents.hasNextEvent()) {
                    liveEvents.getNextEvent(uEv);
                    int type = uEv.getEventType();
                    long evTime = uEv.getTimeStamp();
                    String pkg = uEv.getPackageName();
                    if (type == 12) { // UsageEvents.Event.NOTIFICATION_INTERRUPTION
                        if (evTime >= startMs && evTime <= endMs && pkg != null) {
                            int prevNotifs = appNotifCounts.containsKey(pkg) ? appNotifCounts.get(pkg) : 0;
                            appNotifCounts.put(pkg, prevNotifs + 1);
                            totalNotifications++;
                        }
                    }
                }
            }

            Set<String> activeEventPackages = new HashSet<>();
            JSONArray rawEventsJson = new JSONArray();
            List<ScreenTimeSessionCalculator.UsageEventInput> calcInputs = new ArrayList<>();
            if (usageDbHelper != null) {
                List<AppUsageDatabaseHelper.RawEventRecord> dbEvents =
                    usageDbHelper.queryEventsInWindow(lookbackStartMs, endMs);
                for (AppUsageDatabaseHelper.RawEventRecord ev : dbEvents) {
                    calcInputs.add(new ScreenTimeSessionCalculator.UsageEventInput(
                        ev.id, ev.packageName, ev.className, 1, ev.timestampMs, ev.eventType));
                    boolean isSystemStateEvent = (ev.eventType == 15 || ev.eventType == 16 || ev.eventType == 17
                        || ev.eventType == 18 || ev.eventType == 26 || ev.eventType == 27);
                    if (!isSystemStateEvent && excludedPkgs.contains(ev.packageName)) {
                        continue;
                    }
                    if (!isSystemStateEvent && ev.packageName != null && !ev.packageName.isEmpty()) {
                        activeEventPackages.add(ev.packageName);
                    }
                    if (ev.eventType == 12 && ev.timestampMs >= startMs && ev.timestampMs <= endMs && ev.packageName != null && totalNotifications == 0) {
                        int prevNotifs = appNotifCounts.containsKey(ev.packageName) ? appNotifCounts.get(ev.packageName) : 0;
                        appNotifCounts.put(ev.packageName, prevNotifs + 1);
                    }
                    JSONObject evObj = new JSONObject();
                    evObj.put("rowId", ev.id);
                    evObj.put("packageName", ev.packageName);
                    evObj.put("className", ev.className != null ? ev.className : "");
                    evObj.put("timestampMs", ev.timestampMs);
                    evObj.put("eventType", ev.eventType);
                    rawEventsJson.put(evObj);
                }
            }

            PackageManager pm = getPackageManager();
            Map<String, UsageStats> aggMap = usm != null ? usm.queryAndAggregateUsageStats(startMs, endMs) : null;
            JSONArray appsArray = new JSONArray();
            JSONObject packageMetadataJson = new JSONObject();
            Set<String> addedToAppsArray = new HashSet<>();
            if (aggMap != null) {
                for (Map.Entry<String, UsageStats> entry : aggMap.entrySet()) {
                    UsageStats st = entry.getValue();
                    if (st == null) continue;
                    String pkg = st.getPackageName();
                    if (pkg == null || excludedPkgs.contains(pkg)) continue;
                    long fgMs = st.getTotalTimeInForeground();
                    if (fgMs < 1000L && !activeEventPackages.contains(pkg)) continue;
                    String appLabel = resolveCachedAppLabel(pm, pkg);
                    String iconUri = resolveCachedAppIconDataUri(pm, pkg);
                    JSONObject appObj = new JSONObject();
                    appObj.put("packageId", pkg);
                    appObj.put("appName", appLabel);
                    appObj.put("name", appLabel);
                    appObj.put("isNativeOsLabel", true);
                    if (iconUri != null && !iconUri.isEmpty()) {
                        appObj.put("iconDataUri", iconUri);
                    }
                    appObj.put("durationMinutes", fgMs >= 1000L ? Math.max(1L, Math.round(fgMs / 60000.0)) : 0L);
                    appObj.put("notifs", appNotifCounts.containsKey(pkg) ? appNotifCounts.get(pkg) : 0);
                    appObj.put("aggregateOnly", true);
                    appObj.put("hasVerifiedReelSessions", false);
                    appsArray.put(appObj);
                    addedToAppsArray.add(pkg);

                    JSONObject metaObj = new JSONObject();
                    metaObj.put("appName", appLabel);
                    metaObj.put("name", appLabel);
                    metaObj.put("isNativeOsLabel", true);
                    if (iconUri != null && !iconUri.isEmpty()) {
                        metaObj.put("iconDataUri", iconUri);
                    }
                    packageMetadataJson.put(pkg, metaObj);
                }
            }

            for (String activePkg : activeEventPackages) {
                if (activePkg == null || excludedPkgs.contains(activePkg)) continue;
                String appLabel = resolveCachedAppLabel(pm, activePkg);
                String iconUri = resolveCachedAppIconDataUri(pm, activePkg);
                if (!packageMetadataJson.has(activePkg)) {
                    JSONObject metaObj = new JSONObject();
                    metaObj.put("appName", appLabel);
                    metaObj.put("name", appLabel);
                    metaObj.put("isNativeOsLabel", true);
                    if (iconUri != null && !iconUri.isEmpty()) {
                        metaObj.put("iconDataUri", iconUri);
                    }
                    packageMetadataJson.put(activePkg, metaObj);
                }
                if (!addedToAppsArray.contains(activePkg)) {
                    JSONObject appObj = new JSONObject();
                    appObj.put("packageId", activePkg);
                    appObj.put("appName", appLabel);
                    appObj.put("name", appLabel);
                    appObj.put("isNativeOsLabel", true);
                    if (iconUri != null && !iconUri.isEmpty()) {
                        appObj.put("iconDataUri", iconUri);
                    }
                    appObj.put("durationMinutes", 0);
                    appObj.put("notifs", appNotifCounts.containsKey(activePkg) ? appNotifCounts.get(activePkg) : 0);
                    appObj.put("aggregateOnly", true);
                    appObj.put("hasVerifiedReelSessions", false);
                    appsArray.put(appObj);
                    addedToAppsArray.add(activePkg);
                }
            }

            if (totalNotifications == 0 && !appNotifCounts.isEmpty()) {
                for (int c : appNotifCounts.values()) {
                    totalNotifications += c;
                }
            }

            ScreenTimeSessionCalculator.DailyUsageReport calcReport = null;
            if (sessionCalculator != null && !calcInputs.isEmpty() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                try {
                    java.time.ZoneId zoneId = java.time.ZoneId.systemDefault();
                    java.time.LocalDate targetLocalDate = java.time.Instant.ofEpochMilli(startMs).atZone(zoneId).toLocalDate();
                    calcReport = sessionCalculator.calculateDailyReport(
                        targetLocalDate, zoneId, calcInputs, excludedPkgs, endMs);
                } catch (Throwable ignored) {}
            }

            JSONObject result = new JSONObject();
            result.put("ok", true);
            result.put("osCategory", "Android");
            result.put("aggregateOnly", true);
            result.put("totalNotifications", calcReport != null && calcReport.totalNotifications > totalNotifications ? calcReport.totalNotifications : totalNotifications);
            if (calcReport != null) {
                result.put("unlocks", calcReport.totalDeviceUnlocks);
                JSONArray hourlyUnlocksArr = new JSONArray();
                for (int u : calcReport.hourlyUnlocks) hourlyUnlocksArr.put(u);
                result.put("hourlyUnlocks", hourlyUnlocksArr);
                JSONArray hourlyScreenMsArr = new JSONArray();
                for (long ms : calcReport.hourlyScreenTimeMs) hourlyScreenMsArr.put(ms);
                result.put("hourlyScreenTimeMs", hourlyScreenMsArr);
            }
            result.put("apps", appsArray);
            result.put("entries", appsArray);
            result.put("packageMetadata", packageMetadataJson);
            result.put("rawEvents", rawEventsJson);
            return result;
        }

        @JavascriptInterface
        public String getNativeUsageStatsJson(long startEpochMs, long endEpochMs) {
            JSONObject result = new JSONObject();
            try {
                if (!hasUsageStatsPermission()) {
                    result.put("ok", false);
                    result.put("status", "PERMISSION_DENIED");
                    return result.toString();
                }
                UsageStatsManager usm = (UsageStatsManager) getSystemService(Context.USAGE_STATS_SERVICE);
                JSONObject usageObj = computeAccurateUsageFromEvents(usm, startEpochMs, endEpochMs);
                ScreenSyncWidgetUpdater.updateAllWidgets(MainActivity.this);
                return usageObj.toString();
            } catch (Exception e) {
                try {
                    result.put("ok", false);
                    result.put("status", "ERROR");
                } catch (Exception ignored) {
                }
            }
            return result.toString();
        }

        @JavascriptInterface
        public String getHistoricalUsageBackfillJson() {
            return getHistoricalNativeUsageStatsJson(30);
        }

        @JavascriptInterface
        public String getHistoricalUsageBackfillJson(int daysBack) {
            return getHistoricalNativeUsageStatsJson(daysBack);
        }

        @JavascriptInterface
        public String getHistoricalNativeUsageStatsJson(int daysBack) {
            JSONObject response = new JSONObject();
            try {
                if (!hasUsageStatsPermission()) {
                    response.put("ok", false);
                    response.put("status", "PERMISSION_DENIED");
                    return response.toString();
                }
                int safeDays = Math.max(1, Math.min(30, daysBack));
                if (usageIngestionEngine != null) {
                    usageIngestionEngine.ingestIncrementalEvents(System.currentTimeMillis());
                }
                Set<String> excludedPkgs = getExcludedLauncherAndSystemPackages();
                UsageStatsManager usm = (UsageStatsManager) getSystemService(Context.USAGE_STATS_SERVICE);
                PackageManager pm = getPackageManager();
                java.util.Calendar cal = java.util.Calendar.getInstance();
                cal.set(java.util.Calendar.HOUR_OF_DAY, 0);
                cal.set(java.util.Calendar.MINUTE, 0);
                cal.set(java.util.Calendar.SECOND, 0);
                cal.set(java.util.Calendar.MILLISECOND, 0);
                java.text.SimpleDateFormat sdf = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US);

                JSONArray daysArray = new JSONArray();
                for (int d = 1; d <= safeDays; d++) {
                    java.util.Calendar dayStartCal = (java.util.Calendar) cal.clone();
                    dayStartCal.add(java.util.Calendar.DAY_OF_YEAR, -d);
                    long dayStartMs = dayStartCal.getTimeInMillis();
                    java.util.Calendar dayEndCal = (java.util.Calendar) dayStartCal.clone();
                    dayEndCal.add(java.util.Calendar.DAY_OF_YEAR, 1);
                    long dayEndMs = dayEndCal.getTimeInMillis() - 1L;
                    String localDateStr = sdf.format(new java.util.Date(dayStartMs));

                    Map<String, Long> pkgFgMs = new java.util.HashMap<>();
                    int dayUnlocks = 0;
                    boolean hasRawEventsForDay = false;
                    JSONArray dayRawEventsJson = new JSONArray();
                    JSONArray dayHourlyUnlocksJson = null;
                    java.util.Map<String, Integer> appLaunchCounts = new java.util.HashMap<>();
                    java.util.Map<String, Integer> appNotifCounts = new java.util.HashMap<>();

                    // 1. Check raw events in SQLite (with 12h lookback for cross-midnight sessions) if within raw event retention window
                    if (usageDbHelper != null) {
                        long lookbackStartMs = Math.max(0L, dayStartMs - (12L * 3600L * 1000L));
                        List<AppUsageDatabaseHelper.RawEventRecord> rawEvs =
                            usageDbHelper.queryEventsInWindow(lookbackStartMs, dayEndMs);
                        List<ScreenTimeSessionCalculator.UsageEventInput> dayCalcInputs = new ArrayList<>();
                        for (AppUsageDatabaseHelper.RawEventRecord ev : rawEvs) {
                            dayCalcInputs.add(new ScreenTimeSessionCalculator.UsageEventInput(
                                ev.id, ev.packageName, ev.className, 1, ev.timestampMs, ev.eventType));
                            if (ev.timestampMs >= dayStartMs && ev.timestampMs <= dayEndMs) {
                                hasRawEventsForDay = true;
                                if (ev.eventType == UsageEvents.Event.KEYGUARD_HIDDEN) {
                                    dayUnlocks++;
                                } else if (ev.eventType == 12 && ev.packageName != null) {
                                    int prevNotifs = appNotifCounts.containsKey(ev.packageName) ? appNotifCounts.get(ev.packageName) : 0;
                                    appNotifCounts.put(ev.packageName, prevNotifs + 1);
                                }
                            }
                            JSONObject evObj = new JSONObject();
                            evObj.put("rowId", ev.id);
                            evObj.put("packageName", ev.packageName);
                            evObj.put("className", ev.className != null ? ev.className : "");
                            evObj.put("timestampMs", ev.timestampMs);
                            evObj.put("eventType", ev.eventType);
                            dayRawEventsJson.put(evObj);
                        }
                        if (hasRawEventsForDay && sessionCalculator != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            try {
                                java.time.ZoneId zoneId = java.time.ZoneId.systemDefault();
                                java.time.LocalDate targetLocalDate = java.time.Instant.ofEpochMilli(dayStartMs).atZone(zoneId).toLocalDate();
                                ScreenTimeSessionCalculator.DailyUsageReport dayRep =
                                    sessionCalculator.calculateDailyReport(targetLocalDate, zoneId, dayCalcInputs, excludedPkgs, dayEndMs);
                                dayUnlocks = Math.max(dayUnlocks, dayRep.totalDeviceUnlocks);
                                appLaunchCounts.putAll(dayRep.appLaunchCounts);
                                for (Map.Entry<String, Long> repEn : dayRep.appScreenTimeMs.entrySet()) {
                                    String rPkg = repEn.getKey();
                                    long rFg = repEn.getValue() != null ? repEn.getValue() : 0L;
                                    if (rPkg != null && !excludedPkgs.contains(rPkg) && rFg >= 1000L) {
                                        pkgFgMs.put(rPkg, rFg);
                                    }
                                }
                                dayHourlyUnlocksJson = new JSONArray();
                                for (int u : dayRep.hourlyUnlocks) dayHourlyUnlocksJson.put(u);
                            } catch (Throwable ignored) {}
                        }
                    }

                    // 2. Query OS INTERVAL_DAILY & Aggregate UsageStats stored by Android / HyperOS / ColorOS / OriginOS / OneUI
                    List<UsageStats> dailyStats = usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, dayStartMs, dayEndMs);
                    if (dailyStats != null) {
                        for (UsageStats st : dailyStats) {
                            if (st == null) continue;
                            // Exclude prior-day buckets whose firstTimeStamp started >12h before dayStartMs (Fixes C4-D15c)
                            if (st.getFirstTimeStamp() < dayStartMs - 43200000L) continue;
                            // Only include buckets whose lastTimeUsed falls inside [dayStartMs, dayEndMs]
                            if (st.getLastTimeUsed() < dayStartMs || st.getLastTimeUsed() > dayEndMs + 3600000L) continue;
                            String pkg = st.getPackageName();
                            if (pkg == null || excludedPkgs.contains(pkg)) continue;
                            long fg = st.getTotalTimeInForeground();
                            if (fg >= 1000L) {
                                long prev = pkgFgMs.containsKey(pkg) ? pkgFgMs.get(pkg) : 0L;
                                if (fg > prev) pkgFgMs.put(pkg, fg);
                            }
                        }
                    }

                    JSONArray entries = new JSONArray();
                    Set<String> allDayPkgs = new HashSet<>(pkgFgMs.keySet());
                    for (Map.Entry<String, Integer> nEn : appNotifCounts.entrySet()) {
                        if (nEn.getKey() != null && !excludedPkgs.contains(nEn.getKey()) && nEn.getValue() != null && nEn.getValue() > 0) {
                            allDayPkgs.add(nEn.getKey());
                        }
                    }
                    for (String pkg : allDayPkgs) {
                        long fgMs = pkgFgMs.containsKey(pkg) ? pkgFgMs.get(pkg) : 0L;
                        int notifCnt = appNotifCounts.containsKey(pkg) ? appNotifCounts.get(pkg) : 0;
                        int launchCnt = appLaunchCounts.containsKey(pkg) ? appLaunchCounts.get(pkg) : 0;
                        int mins = fgMs >= 1000L ? (int) Math.min(1440L, Math.max(1L, Math.round(fgMs / 60000.0))) : 0;
                        if (mins <= 0 && notifCnt <= 0) continue;
                        String histLabel = resolveCachedAppLabel(pm, pkg);
                        String histIconUri = resolveCachedAppIconDataUri(pm, pkg);
                        JSONObject item = new JSONObject();
                        item.put("packageId", pkg);
                        item.put("appName", histLabel);
                        item.put("name", histLabel);
                        item.put("isNativeOsLabel", true);
                        if (histIconUri != null && !histIconUri.isEmpty()) {
                            item.put("iconDataUri", histIconUri);
                        }
                        item.put("durationSeconds", fgMs >= 1000L ? Math.max(1L, Math.round(fgMs / 1000.0)) : 0L);
                        item.put("durationMinutes", mins);
                        item.put("opens", launchCnt);
                        item.put("notifs", notifCnt);
                        item.put("aggregateOnly", true);
                        entries.put(item);
                    }

                    if (entries.length() > 0 || dayUnlocks > 0 || hasRawEventsForDay) {
                        JSONObject dayObj = new JSONObject();
                        dayObj.put("localDate", localDateStr);
                        dayObj.put("windowStartMs", dayStartMs);
                        dayObj.put("windowEndMs", dayEndMs);
                        dayObj.put("unlocks", hasRawEventsForDay || dayUnlocks > 0 ? dayUnlocks : JSONObject.NULL);
                        dayObj.put("unlocksKnown", hasRawEventsForDay || dayUnlocks > 0);
                        if (dayHourlyUnlocksJson != null) {
                            dayObj.put("hourlyUnlocks", dayHourlyUnlocksJson);
                        }
                        if (hasRawEventsForDay && dayRawEventsJson.length() > 0) {
                            dayObj.put("rawEvents", dayRawEventsJson);
                        }
                        dayObj.put("entries", entries);
                        daysArray.put(dayObj);
                    }
                }
                response.put("ok", true);
                response.put("days", daysArray);
            } catch (Exception e) {
                try {
                    response.put("ok", false);
                    response.put("status", "ERROR");
                } catch (Exception ignored) {}
            }
            return response.toString();
        }

        public static final int DEFAULT_SCREEN_TIME_GOAL_MINUTES = 200;
        public static final int DEFAULT_REEL_GOAL_MINUTES = 60;
        public static final int MIN_REEL_GOAL_MINUTES = 5;
        public static final int MAX_REEL_GOAL_MINUTES = 480;
        public static final int MIN_SCREEN_GOAL_MINUTES = 15;
        public static final int MAX_SCREEN_GOAL_MINUTES = 960;

        private void persistWidgetMetricsToStore(
                android.content.SharedPreferences.Editor ed,
                android.content.SharedPreferences prefs,
                JSONObject obj,
                String explicitDayKey) {
            if (ed == null || prefs == null || obj == null) return;
            String todayKey = (explicitDayKey != null && !explicitDayKey.trim().isEmpty())
                ? explicitDayKey.trim()
                : obj.optString("localDate", obj.optString("dateStr", obj.optString("goalDayKey", NativeGoalAlertEvaluator.getTodayKey())));
            ed.putString("widget_day_key", todayKey);
            ed.putLong("widget_updated_at_ms", System.currentTimeMillis());

            int screenUsedMins = obj.has("screenUsedMinutes")
                ? Math.max(0, obj.optInt("screenUsedMinutes", 0))
                : (obj.has("totalScreenMinutes") || obj.has("screenMinutes")
                    ? Math.max(0, obj.optInt("totalScreenMinutes", obj.optInt("screenMinutes", 0)))
                    : prefs.getInt("widget_screen_used_mins", 0));
            int screenGoalMins = obj.has("screenGoalMinutes")
                ? Math.max(MIN_SCREEN_GOAL_MINUTES, Math.min(MAX_SCREEN_GOAL_MINUTES, obj.optInt("screenGoalMinutes", DEFAULT_SCREEN_TIME_GOAL_MINUTES)))
                : Math.max(MIN_SCREEN_GOAL_MINUTES, Math.min(MAX_SCREEN_GOAL_MINUTES, prefs.getInt("widget_screen_goal_mins", DEFAULT_SCREEN_TIME_GOAL_MINUTES)));
            String statusLabel = obj.optString(
                "widgetStatusLabel",
                screenUsedMins >= screenGoalMins ? "Over Daily Goal" : "Within Daily Goal"
            );
            if (obj.has("screenUsedMinutes") || obj.has("totalScreenMinutes") || obj.has("screenMinutes")) {
                ed.putInt("widget_screen_used_mins", screenUsedMins);
            }
            if (obj.has("screenGoalMinutes")) {
                ed.putInt("widget_screen_goal_mins", screenGoalMins);
            }
            if (obj.has("screenGoalEnabled")) {
                ed.putBoolean("widget_screen_goal_enabled", obj.optBoolean("screenGoalEnabled", true));
            }
            ed.putString("widget_status_label", statusLabel);

            if (obj.has("reelsCount") || obj.has("unifiedReelsCount") || obj.has("reels")) {
                int rc = Math.max(0, obj.optInt("reelsCount", obj.optInt("unifiedReelsCount", obj.optInt("reels", 0))));
                ed.putInt("widget_reels_count", rc);
                ed.putString("widget_lockscreen_headline", obj.optString("headline", rc + (rc == 1 ? " Reel" : " Reels") + " Today • All Devices"));
            }
            if (obj.has("watchMinutes") || obj.has("unifiedWatchMinutes") || obj.has("reelWatchMinutes")) {
                int wm = Math.max(0, obj.optInt("watchMinutes", obj.optInt("unifiedWatchMinutes", obj.optInt("reelWatchMinutes", 0))));
                ed.putInt("widget_reel_watch_mins", wm);
            }
            if (obj.has("dailyGoalMinutes") || obj.has("reelGoalMinutes") || obj.has("goalMinutes")) {
                int rawReelGoal = obj.optInt("dailyGoalMinutes", obj.optInt("reelGoalMinutes", obj.optInt("goalMinutes", DEFAULT_REEL_GOAL_MINUTES)));
                ed.putInt("widget_reel_goal_mins", Math.max(MIN_REEL_GOAL_MINUTES, Math.min(MAX_REEL_GOAL_MINUTES, rawReelGoal)));
            }
            if (obj.has("goalEnabled")) {
                ed.putBoolean("widget_reel_goal_enabled", obj.optBoolean("goalEnabled", true));
            }
        }

        @JavascriptInterface
        public void acceptAccessibilityDisclosureAndOpenSettings() {
            try {
                long nowMs = System.currentTimeMillis();
                getSharedPreferences("screensync_wellness_store", Context.MODE_PRIVATE)
                    .edit()
                    .putBoolean("accessibility_disclosure_accepted", true)
                    .putLong("accessibility_disclosure_accepted_at_ms", nowMs)
                    .apply();
                getSharedPreferences("screensync_native_perm_flow", Context.MODE_PRIVATE)
                    .edit()
                    .putBoolean("accessibility_disclosure_accepted", true)
                    .apply();
                Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public boolean openSystemAccessibilitySettingsForRevoke() {
            try {
                setAccessibilityDisclosureConsent(false);
                Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
                return true;
            } catch (Exception ignored) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean openPermissionSettings(String permType) {
            return openPermissionSettings(permType, "", "");
        }

        @JavascriptInterface
        public boolean openPermissionSettings(String permissionId, String actionTarget, String uriStr) {
            try {
                if ("oem_background_popups".equals(permissionId)) {
                    return openOemPermissionSettings("oem_other_permissions");
                }
                Intent intent;
                if ("overlay".equals(permissionId) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    intent = new Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:" + getPackageName())
                    );
                } else if ("usage_stats".equals(permissionId)) {
                    intent = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
                } else if ("accessibility_revoke".equals(permissionId)) {
                    setAccessibilityDisclosureConsent(false);
                    intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
                } else if ("accessibility".equals(permissionId)) {
                    if (!isAccessibilityConsentAcceptedInStore()) {
                        if (webView != null) {
                            webView.post(() -> webView.evaluateJavascript(
                                "if (window.ScreenSyncApp && window.ScreenSyncApp.PermissionOnboardingManager) { " +
                                "window.ScreenSyncApp.PermissionOnboardingManager.openSystemPermissionFlow('accessibility'); " +
                                "}",
                                null
                            ));
                        }
                        return false;
                    }
                    intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
                } else if ("notifications".equals(permissionId) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
                } else {
                    intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                        .setData(Uri.parse("package:" + getPackageName()));
                }
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
                return true;
            } catch (Exception ignored) {
                return false;
            }
        }

        
        @JavascriptInterface
        public String updateLockScreenReelWidgetJson(String jsonPayload) {
            JSONObject out = new JSONObject();
            try {
                android.content.SharedPreferences prefs = getSharedPreferences("screensync_wellness_store", Context.MODE_PRIVATE);
                android.content.SharedPreferences.Editor ed = prefs.edit();
                ed.putString("lockscreen_reel_widget_json", jsonPayload != null ? jsonPayload : "{}");
                if (jsonPayload != null && !jsonPayload.trim().isEmpty()) {
                    JSONObject obj = new JSONObject(jsonPayload);
                    persistWidgetMetricsToStore(ed, prefs, obj, null);
                }
                ed.apply();
                ScreenSyncWidgetUpdater.updateAllWidgets(MainActivity.this);
                out.put("ok", true);
                out.put("updatedAtMs", System.currentTimeMillis());
            } catch (Exception e) {
                try { out.put("ok", false); } catch (Exception ignored) {}
            }
            return out.toString();
        }

        @JavascriptInterface
        public void updateCompactPill(String jsonPayload) {
            // Pass 23 Task 23.2: Persist compact pill state and widget reel metrics, then refresh all widgets
            try {
                android.content.SharedPreferences prefs = getSharedPreferences("screensync_wellness_store", Context.MODE_PRIVATE);
                android.content.SharedPreferences.Editor ed = prefs.edit();
                ed.putString("compact_pill_state_json", jsonPayload != null ? jsonPayload : "{}");
                if (jsonPayload != null && !jsonPayload.trim().isEmpty()) {
                    JSONObject obj = new JSONObject(jsonPayload);
                    persistWidgetMetricsToStore(ed, prefs, obj, null);
                }
                ed.apply();
                ScreenSyncWidgetUpdater.updateAllWidgets(MainActivity.this);
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void onActivityContextChanged(String appKey, String activityType) {
            if (webView != null) {
                final String safeApp = appKey == null ? "" : appKey.replace("\"", "");
                final String safeAct = activityType == null ? "" : activityType.replace("\"", "");
                webView.post(() -> webView.evaluateJavascript(
                    "if (window.ScreenSyncApp) { window.ScreenSyncApp.handleAutomaticAppContextChange(\"" + safeApp + "\", \"" + safeAct + "\", { triggerRender: true, externalOsContext: true }); }",
                    null
                ));
            }
        }

        private int resolveNotificationSmallIcon() {
            try {
                int appIcon = getApplicationInfo().icon;
                if (appIcon != 0) {
                    return appIcon;
                }
            } catch (Exception ignored) {
            }
            return android.R.drawable.ic_dialog_info;
        }

        private PendingIntent buildMainActivityContentPendingIntent(int requestCode) {
            Intent launchIntent = new Intent(MainActivity.this, MainActivity.class);
            launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }
            return PendingIntent.getActivity(MainActivity.this, requestCode, launchIntent, flags);
        }

        /**
         * Pass 22 Task 22.1: Multi-Channel Native Notification Dispatcher
         */
        @JavascriptInterface
        public boolean dispatchNativeNotification(final String jsonPayload) {
            try {
                ensureNotificationChannelsCreated(MainActivity.this);
                NotificationManager checkNm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (checkNm == null || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && !checkNm.areNotificationsEnabled()) || !hasNotificationPermission()) {
                    lastNotificationDispatchResultJson = "{\"ok\":false,\"reason\":\"NOTIFICATIONS_DISABLED\"}";
                    return false;
                }
                JSONObject obj = new JSONObject(jsonPayload != null ? jsonPayload : "{}");
                final String rawChannel = obj.optString("channelId", CHANNEL_GOAL_ALERTS);
                final String channelId = (rawChannel == null || rawChannel.trim().isEmpty())
                    ? CHANNEL_GOAL_ALERTS
                    : rawChannel.trim();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && checkNm.getNotificationChannel(channelId) == null) {
                    lastNotificationDispatchResultJson = "{\"ok\":false,\"reason\":\"UNKNOWN_CHANNEL\",\"channelId\":\"" + channelId + "\"}";
                    return false;
                }
                lastNotificationDispatchResultJson = "{\"ok\":true,\"status\":\"DELIVERED\",\"channelId\":\"" + channelId + "\"}";
                final String title = obj.optString("title", "ScreenSync Wellness Alert");
                final String body = obj.optString("body", obj.optString("message", "Check your digital wellness progress."));
                final String tag = obj.optString("tag", "");
                final long autoDismissMs = obj.optLong("autoDismissMs", 0L);

                runOnUiThread(() -> {
                    try {
                        NotificationManager nm =
                            (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                        if (nm == null) return;

                        Notification.Builder nb = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                            ? new Notification.Builder(MainActivity.this, channelId)
                            : new Notification.Builder(MainActivity.this);

                        int smallIcon = resolveNotificationSmallIcon();
                        PendingIntent contentPi = buildMainActivityContentPendingIntent((int) (System.currentTimeMillis() & 0xFFFF));

                        nb.setSmallIcon(smallIcon)
                            .setContentTitle(title)
                            .setContentText(body)
                            .setContentIntent(contentPi)
                            .setAutoCancel(true);

                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                            String category = CHANNEL_GOAL_ALERTS.equals(channelId)
                                ? Notification.CATEGORY_ALARM
                                : Notification.CATEGORY_REMINDER;
                            nb.setCategory(category);
                            nb.setVisibility(Notification.VISIBILITY_PUBLIC);
                        }

                        if (autoDismissMs > 0L && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            nb.setTimeoutAfter(autoDismissMs);
                        }

                        final int notifId = (tag != null && !tag.isEmpty())
                            ? (tag.hashCode() & 0x7FFFFFFF)
                            : (int) (System.currentTimeMillis() & 0xFFFFFFF);
                        nm.notify(notifId, nb.build());
                        if (autoDismissMs > 0L) {
                            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(
                                () -> { try { nm.cancel(notifId); } catch (Exception ignored) {} },
                                autoDismissMs
                            );
                        }
                    } catch (Exception ignored) {
                    }
                });
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public String presentSystemGoalAlert(final String jsonPayload) {
            JSONObject receipt = new JSONObject();
            try {
                JSONObject obj = new JSONObject(jsonPayload != null ? jsonPayload : "{}");
                final String eventId = obj.optString("eventId", "goal_evt_" + System.currentTimeMillis());
                final String title = obj.optString("title", "Goal Reached");
                final String message = obj.optString("message", "You have reached your daily usage goal.");
                final long autoDismissMs = Math.max(4000L, Math.min(6000L, obj.optLong("autoDismissMs", 5000L)));
                boolean notifAllowed = hasNotificationPermission();
                receipt.put("ok", notifAllowed);
                receipt.put("eventId", eventId);
                receipt.put("result", notifAllowed ? "POSTED" : "BLOCKED_NOTIFICATIONS");

                runOnUiThread(() -> {
                    try {
                        ensureNotificationChannelsCreated(MainActivity.this);
                        NotificationManager nm =
                            (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                        if (nm != null && hasNotificationPermission()) {
                            String channelId = CHANNEL_GOAL_ALERTS;
                            Notification.Builder nb = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                                ? new Notification.Builder(MainActivity.this, channelId)
                                : new Notification.Builder(MainActivity.this);
                            int smallIcon = resolveNotificationSmallIcon();
                            PendingIntent contentPi = buildMainActivityContentPendingIntent((int) (System.currentTimeMillis() & 0xFFFF));
                            nb.setSmallIcon(smallIcon)
                                .setContentTitle(title)
                                .setContentText(message)
                                .setContentIntent(contentPi)
                                .setOnlyAlertOnce(true)
                                .setAutoCancel(true);
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                                nb.setCategory(Notification.CATEGORY_ALARM);
                                nb.setVisibility(Notification.VISIBILITY_PUBLIC);
                            }
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                                nb.setTimeoutAfter(autoDismissMs);
                            }
                            final int notifId = (eventId.hashCode() & 0x7FFFFFFF);
                            nm.notify(eventId, notifId, nb.build());
                            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(
                                () -> { try { nm.cancel(eventId, notifId); } catch (Exception ignored) {} },
                                autoDismissMs
                            );
                        }

                        // 2. Also show 5-second System-Wide Floating Overlay Banner over any active app
                        ScreenSyncAccessibilityService svc = ScreenSyncAccessibilityService.getActiveInstance();
                        if (svc != null) {
                            svc.showTransientGoalAlertOverlay(title, message, autoDismissMs);
                        }
                    } catch (Exception ignored) {
                    }
                });
            } catch (Exception e) {
                try {
                    receipt.put("ok", false);
                    receipt.put("result", "FAILED");
                } catch (Exception ignored) {}
            }
            return receipt.toString();
        }

        @JavascriptInterface
        public void cancelGoalAlert(final String eventId) {
            runOnUiThread(() -> {
                try {
                    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                    if (nm != null && eventId != null && !eventId.isEmpty()) {
                        nm.cancel(eventId, (eventId.hashCode() & 0x7FFFFFFF));
                    }
                } catch (Exception ignored) {}
            });
        }

        @JavascriptInterface
        public String consumePendingGoalAlertOutboxJson() {
            try {
                SharedPreferences prefs = getSharedPreferences("screensync_wellness_store", MODE_PRIVATE);
                return prefs.getString("pending_goal_alert_events_json", "[]");
            } catch (Exception e) {
                return "[]";
            }
        }

        @JavascriptInterface
        public void clearPendingGoalAlertOutboxIdsJson(final String eventIdsJson) {
            try {
                SharedPreferences prefs = getSharedPreferences("screensync_wellness_store", MODE_PRIVATE);
                String raw = prefs.getString("pending_goal_alert_events_json", "[]");
                org.json.JSONArray existing = new org.json.JSONArray(raw != null ? raw : "[]");
                org.json.JSONArray toClear = new org.json.JSONArray(eventIdsJson != null ? eventIdsJson : "[]");
                java.util.HashSet<String> clearSet = new java.util.HashSet<>();
                for (int i = 0; i < toClear.length(); i++) {
                    clearSet.add(toClear.optString(i, ""));
                }
                org.json.JSONArray remaining = new org.json.JSONArray();
                for (int i = 0; i < existing.length(); i++) {
                    org.json.JSONObject ev = existing.optJSONObject(i);
                    if (ev != null && !clearSet.contains(ev.optString("eventId", ""))) {
                        remaining.put(ev);
                    }
                }
                prefs.edit().putString("pending_goal_alert_events_json", remaining.toString()).apply();
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public String getGoalAlertCapabilities() {
            JSONObject cap = new JSONObject();
            try {
                boolean notifAllowed = hasNotificationPermission();
                boolean overlayAllowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(MainActivity.this);
                boolean accessAllowed = isAccessibilityServiceEnabled();
                cap.put("notifications", notifAllowed);
                cap.put("overlay", overlayAllowed);
                cap.put("accessibility", accessAllowed);
                cap.put("canPresent", notifAllowed || (overlayAllowed && accessAllowed));
                cap.put("channel", (overlayAllowed && accessAllowed)
                    ? "ANDROID_FLOATING_OVERLAY"
                    : (notifAllowed ? "ANDROID_OS_NOTIFICATION" : "NONE_PERMISSION_DENIED"));
            } catch (Exception ignored) {}
            return cap.toString();
        }

        private String encryptWithKeystore(String plaintext) {
            if (plaintext == null || plaintext.isEmpty()) return "";
            try {
                java.security.KeyStore ks = java.security.KeyStore.getInstance("AndroidKeyStore");
                ks.load(null);
                final String alias = "screensync_auth_aes_key_v1";
                javax.crypto.SecretKey secretKey;
                if (!ks.containsAlias(alias)) {
                    javax.crypto.KeyGenerator kg = javax.crypto.KeyGenerator.getInstance(
                        android.security.keystore.KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
                    kg.init(new android.security.keystore.KeyGenParameterSpec.Builder(
                        alias,
                        android.security.keystore.KeyProperties.PURPOSE_ENCRYPT | android.security.keystore.KeyProperties.PURPOSE_DECRYPT)
                        .setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
                        .build());
                    secretKey = kg.generateKey();
                } else {
                    secretKey = ((java.security.KeyStore.SecretKeyEntry) ks.getEntry(alias, null)).getSecretKey();
                }
                javax.crypto.Cipher cipher = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(javax.crypto.Cipher.ENCRYPT_MODE, secretKey);
                byte[] iv = cipher.getIV();
                byte[] ct = cipher.doFinal(plaintext.getBytes(java.nio.charset.StandardCharsets.UTF_8));
                return "ENC_GCM_V1:" + android.util.Base64.encodeToString(iv, android.util.Base64.NO_WRAP)
                    + ":" + android.util.Base64.encodeToString(ct, android.util.Base64.NO_WRAP);
            } catch (Exception e) {
                return plaintext;
            }
        }

        private boolean areNotificationsAllowed() {
            return hasNotificationPermission();
        }

        private String decryptWithKeystore(String encryptedPayload) {
            if (encryptedPayload == null || encryptedPayload.isEmpty()) return "";
            if (!encryptedPayload.startsWith("ENC_GCM_V1:")) return encryptedPayload;
            try {
                String[] parts = encryptedPayload.split(":", 3);
                if (parts.length < 3) return "";
                byte[] iv = android.util.Base64.decode(parts[1], android.util.Base64.NO_WRAP);
                byte[] ct = android.util.Base64.decode(parts[2], android.util.Base64.NO_WRAP);
                java.security.KeyStore ks = java.security.KeyStore.getInstance("AndroidKeyStore");
                ks.load(null);
                final String alias = "screensync_auth_aes_key_v1";
                if (!ks.containsAlias(alias)) return "";
                javax.crypto.SecretKey secretKey = ((java.security.KeyStore.SecretKeyEntry) ks.getEntry(alias, null)).getSecretKey();
                javax.crypto.Cipher cipher = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(javax.crypto.Cipher.DECRYPT_MODE, secretKey, new GCMParameterSpec(128, iv));
                byte[] pt = cipher.doFinal(ct);
                return new String(pt, java.nio.charset.StandardCharsets.UTF_8);
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public void savePersistedAuthSessionJson(String sessionJson) {
            android.content.SharedPreferences prefs = getSharedPreferences("screensync_native_prefs", MODE_PRIVATE);
            String safeJson = sessionJson != null ? sessionJson : "";
            prefs.edit()
                .remove("persisted_auth_session_v2")
                .putString("persisted_auth_session_enc_v2", encryptWithKeystore(safeJson))
                .putBoolean("explicit_logout_flag_v2", false)
                .apply();
            try {
                if (!safeJson.isEmpty()) {
                    JSONObject sObj = new JSONObject(safeJson);
                    android.content.SharedPreferences storePrefs = getSharedPreferences("screensync_wellness_store", MODE_PRIVATE);
                    android.content.SharedPreferences.Editor storeEd = storePrefs.edit()
                        .putString("supabase_user_id", sObj.optString("userId", ""))
                        .putString("supabase_access_token", sObj.optString("sessionToken", sObj.optString("accessToken", "")));
                    String projUrl = sObj.optString("supabaseProjectUrl", sObj.optString("projectUrl", ""));
                    String anonKey = sObj.optString("supabaseAnonKey", sObj.optString("anonKey", ""));
                    String instId = sObj.optString("installationId", "");
                    String instKey = sObj.optString("installationKey", "");
                    if (!projUrl.isEmpty()) storeEd.putString("supabase_project_url", projUrl);
                    if (!anonKey.isEmpty()) storeEd.putString("supabase_anon_key", anonKey);
                    if (!instId.isEmpty()) storeEd.putString("installation_id", instId);
                    if (!instKey.isEmpty()) storeEd.putString("installation_key", instKey);
                    storeEd.apply();
                }
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void markExplicitNativeLogout() {
            android.content.SharedPreferences prefs = getSharedPreferences("screensync_native_prefs", MODE_PRIVATE);
            prefs.edit()
                .remove("persisted_auth_session_v2")
                .remove("persisted_auth_session_enc_v2")
                .putBoolean("explicit_logout_flag_v2", true)
                .apply();
            android.content.SharedPreferences storePrefs = getSharedPreferences("screensync_wellness_store", MODE_PRIVATE);
            storePrefs.edit()
                .remove("supabase_user_id")
                .remove("supabase_access_token")
                .remove("widget_today_reels_count")
                .remove("widget_today_reel_watch_minutes")
                .remove("widget_today_screen_minutes")
                .remove("widget_connected_devices_count")
                .remove("widget_pinned")
                .remove("screensync_lockscreen_widget_payload_v1")
                .remove("widget_last_sync_epoch_ms")
                .apply();
            try {
                ScreenSyncWidgetUpdater.updateAllWidgets(MainActivity.this);
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void saveSupabaseRuntimeConfigJson(String configJson) {
            try {
                if (configJson != null && !configJson.isEmpty()) {
                    JSONObject cfg = new JSONObject(configJson);
                    android.content.SharedPreferences storePrefs = getSharedPreferences("screensync_wellness_store", MODE_PRIVATE);
                    android.content.SharedPreferences.Editor ed = storePrefs.edit();
                    String url = cfg.optString("url", cfg.optString("supabaseProjectUrl", ""));
                    String key = cfg.optString("publishableKey", cfg.optString("anonKey", cfg.optString("supabaseAnonKey", "")));
                    if (!url.isEmpty()) ed.putString("supabase_project_url", url);
                    if (!key.isEmpty()) ed.putString("supabase_anon_key", key);
                    ed.apply();
                }
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public String getNativeSocialOAuthConfigJson() {
            return "{\"oauthUiEnabled\":false,\"providers\":[\"google\",\"apple\",\"azure\"],\"redirectScheme\":\"io.screensync.wellness://auth/callback\"}";
        }

        @JavascriptInterface
        public String getPersistedAuthSessionJson() {
            android.content.SharedPreferences prefs = getSharedPreferences("screensync_native_prefs", MODE_PRIVATE);
            if (prefs.getBoolean("explicit_logout_flag_v2", false)) {
                return "";
            }
            return decryptWithKeystore(prefs.getString("persisted_auth_session_enc_v2", ""));
        }

        @JavascriptInterface
        public void setNativeBackStackInterceptEnabled(boolean enabled) {
            nativeBackStackInterceptEnabled = enabled;
        }

        @JavascriptInterface
        public void setBackNavigationInterceptEnabled(boolean enabled) {
            nativeBackStackInterceptEnabled = enabled;
        }

        @JavascriptInterface
        public boolean minimizeAppToHomeScreen() {
            runOnUiThread(() -> {
                try {
                    Intent homeIntent = new Intent(Intent.ACTION_MAIN);
                    homeIntent.addCategory(Intent.CATEGORY_HOME);
                    homeIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(homeIntent);
                } catch (Exception ignored) {
                }
                try {
                    moveTaskToBack(true);
                } catch (Exception ignored) {
                }
            });
            return true;
        }

        @JavascriptInterface
        public String getBillingPurchasesJson() {
            try {
                android.content.SharedPreferences prefs = getSharedPreferences("screensync_billing_store", MODE_PRIVATE);
                String savedJson = prefs.getString("active_subscription_json", "");
                if (savedJson != null && !savedJson.isEmpty()) {
                    return savedJson;
                }
                JSONObject def = new JSONObject();
                def.put("ok", true);
                def.put("storeProvider", BuildConfig.BILLING_PROVIDER);
                def.put("storeChannel", BuildConfig.STORE_CHANNEL);
                def.put("planId", "FREE");
                def.put("status", "ACTIVE");
                def.put("autoRenew", false);
                return def.toString();
            } catch (Exception e) {
                return "{\"ok\":false}";
            }
        }

        @JavascriptInterface
        public String launchBillingPurchaseFlowJson(String requestJson) {
            try {
                JSONObject req = new JSONObject(requestJson != null ? requestJson : "{}");
                String planId = req.optString("planId", "FREE");
                String sku = req.optString("productSku", "io.screensync.wellness.free");
                String verifiedOrderId = req.optString("verifiedOrderId", "").trim();
                String verifiedPurchaseToken = req.optString("verifiedPurchaseToken", "").trim();
                if (verifiedOrderId.isEmpty() || verifiedPurchaseToken.isEmpty()) {
                    JSONObject unverified = new JSONObject();
                    unverified.put("ok", false);
                    unverified.put("reason", "BILLING_CLIENT_VERIFICATION_REQUIRED");
                    unverified.put("allFeaturesFreeMode", true);
                    unverified.put("planId", planId);
                    unverified.put("productSku", sku);
                    return unverified.toString();
                }
                long nowMs = System.currentTimeMillis();
                long periodMs = "PRO_YEARLY".equals(planId) ? (365L * 86400000L) : ("PRO_LIFETIME".equals(planId) ? 0L : (30L * 86400000L));
                JSONObject receipt = new JSONObject();
                receipt.put("ok", true);
                receipt.put("storeProvider", BuildConfig.BILLING_PROVIDER);
                receipt.put("storeChannel", BuildConfig.STORE_CHANNEL);
                receipt.put("planId", planId);
                receipt.put("productSku", sku);
                receipt.put("status", "ACTIVE");
                receipt.put("autoRenew", !"PRO_LIFETIME".equals(planId) && !"FREE".equals(planId));
                receipt.put("cancelAtPeriodEnd", false);
                receipt.put("storeOrderId", verifiedOrderId);
                receipt.put("storePurchaseToken", verifiedPurchaseToken);
                receipt.put("currentPeriodStartMs", nowMs);
                if (periodMs > 0L) {
                    receipt.put("currentPeriodEndMs", nowMs + periodMs);
                }
                receipt.put("updatedAtMs", nowMs);

                android.content.SharedPreferences prefs = getSharedPreferences("screensync_billing_store", MODE_PRIVATE);
                prefs.edit().putString("active_subscription_json", receipt.toString()).apply();
                return receipt.toString();
            } catch (Exception e) {
                return "{\"ok\":false}";
            }
        }

        @JavascriptInterface
        public String cancelNativeSubscriptionJson(String planId) {
            try {
                android.content.SharedPreferences prefs = getSharedPreferences("screensync_billing_store", MODE_PRIVATE);
                String savedJson = prefs.getString("active_subscription_json", "{}");
                JSONObject obj = new JSONObject(savedJson);
                obj.put("autoRenew", false);
                obj.put("cancelAtPeriodEnd", true);
                obj.put("updatedAtMs", System.currentTimeMillis());
                obj.put("manageSubscriptionsDeepLink", "https://play.google.com/store/account/subscriptions?package=" + getPackageName());
                prefs.edit().putString("active_subscription_json", obj.toString()).apply();
                return obj.toString();
            } catch (Exception e) {
                return "{\"ok\":false}";
            }
        }

        private int purgeExportFilesInDirectory(java.io.File dir) {
            if (dir == null || !dir.exists() || !dir.isDirectory()) return 0;
            int deletedCount = 0;
            java.io.File[] children = dir.listFiles();
            if (children == null) return 0;
            for (java.io.File child : children) {
                if (child == null) continue;
                if (child.isDirectory()) {
                    if ("screensync_exports".equals(child.getName())) {
                        deletedCount += purgeExportFilesInDirectory(child);
                    }
                    continue;
                }
                String name = child.getName();
                if (name != null && (name.startsWith("screensync_export_") || name.startsWith("screensync_backup_"))) {
                    if (child.delete()) {
                        deletedCount++;
                    }
                }
            }
            return deletedCount;
        }

        @JavascriptInterface
        public String deleteNativeAccountDataJson(String userId) {
            try {
                getSharedPreferences("screensync_native_prefs", MODE_PRIVATE).edit().clear().apply();
                getSharedPreferences("screensync_wellness_store", MODE_PRIVATE).edit().clear().apply();
                getSharedPreferences("screensync_billing_store", MODE_PRIVATE).edit().clear().apply();
                getSharedPreferences("screensync_native_perm_flow", MODE_PRIVATE).edit().clear().apply();
                getSharedPreferences("screensync_keystore_session", MODE_PRIVATE).edit().clear().apply();
                getSharedPreferences("screensync_usage_ingestion_prefs", MODE_PRIVATE).edit().clear().apply();
                try {
                    java.security.KeyStore ks = java.security.KeyStore.getInstance("AndroidKeyStore");
                    ks.load(null);
                    if (ks.containsAlias("screensync_auth_aes_key_v1")) {
                        ks.deleteEntry("screensync_auth_aes_key_v1");
                    }
                } catch (Exception ignored) {}
                if (usageDbHelper != null) {
                    try {
                        usageDbHelper.flushAllTables();
                    } catch (Exception ignored) {}
                }
                int deletedExports = 0;
                try {
                    deletedExports += purgeExportFilesInDirectory(getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS));
                    deletedExports += purgeExportFilesInDirectory(getFilesDir());
                } catch (Exception ignored) {}
                try {
                    ScreenSyncWidgetUpdater.updateAllWidgets(MainActivity.this);
                } catch (Exception ignored) {}
                JSONObject res = new JSONObject();
                res.put("ok", true);
                res.put("userId", userId != null ? userId : "");
                res.put("nativeDataPurged", true);
                res.put("keystoreSessionCleared", true);
                res.put("widgetsReset", true);
                res.put("deletedExportFilesCount", deletedExports);
                res.put("deletedAtMs", System.currentTimeMillis());
                return res.toString();
            } catch (Exception e) {
                return "{\"ok\":false}";
            }
        }

        @JavascriptInterface
        public String getAllPermissionStatusJson() {
            JSONObject out = new JSONObject();
            try {
                boolean usage = hasUsageStatsPermission();
                boolean access = isAccessibilityServiceEnabled();
                boolean overlay = Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(MainActivity.this);
                boolean notif = hasNotificationPermission();
                boolean battery = isIgnoringBatteryOptimizationsCompat();
                android.content.SharedPreferences flowPrefs =
                    getSharedPreferences("screensync_native_perm_flow", Context.MODE_PRIVATE);
                boolean usagePrompted = flowPrefs.getBoolean("usage_prompted_once", false);
                boolean overlayPrompted = flowPrefs.getBoolean("overlay_prompted_after_usage", false);
                boolean batteryPrompted = flowPrefs.getBoolean("battery_prompted_after_overlay", false);
                boolean accConsented = isAccessibilityConsentAcceptedInStore();
                out.put("ok", true);
                out.put("usage_stats", usage ? "GRANTED" : (usagePrompted ? "DENIED" : "PENDING"));
                out.put("accessibility", access ? "GRANTED" : (accConsented ? "DENIED" : "PENDING"));
                out.put("overlay", overlay ? "GRANTED" : (overlayPrompted ? "DENIED" : "PENDING"));
                out.put("notifications", notif ? "GRANTED" : "DENIED");
                out.put("oem_background_popups", battery ? "GRANTED" : (batteryPrompted ? "DENIED" : "PENDING"));
                out.put("batteryOptimizationIgnored", battery);
            } catch (Exception ignored) {
            }
            return out.toString();
        }

        @JavascriptInterface
        public String openPermissionSettingsJson(String permId) {
            JSONObject out = new JSONObject();
            try {
                boolean launched = openPermissionSettings(permId, "", "");
                out.put("ok", launched);
                out.put("permId", permId != null ? permId : "");
                out.put("fallbackNeeded", !launched);
            } catch (Exception e) {
                try { out.put("ok", false); out.put("fallbackNeeded", true); } catch (Exception ignored) {}
            }
            return out.toString();
        }

        @JavascriptInterface
        public String launchOemSettingsJson(String oemTarget) {
            JSONObject out = new JSONObject();
            try {
                boolean launched = openOemPermissionSettings(oemTarget);
                out.put("ok", launched);
                out.put("oemTarget", oemTarget != null ? oemTarget : "");
                out.put("fallbackNeeded", !launched);
            } catch (Exception e) {
                try { out.put("ok", false); out.put("fallbackNeeded", true); } catch (Exception ignored) {}
            }
            return out.toString();
        }

        @JavascriptInterface
        public String requestPinWidgetJson(String widgetKind) {
            JSONObject out = new JSONObject();
            try {
                boolean supported = false;
                boolean launched = false;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    AppWidgetManager awm = getSystemService(AppWidgetManager.class);
                    supported = (awm != null && awm.isRequestPinAppWidgetSupported());
                }
                if (supported) {
                    launched = openOemPermissionSettings("reel".equalsIgnoreCase(widgetKind) ? "pin_reel_widget" : "pin_widget");
                }
                out.put("ok", launched);
                out.put("supported", supported);
                out.put("widgetKind", widgetKind != null ? widgetKind : "goal");
            } catch (Exception ignored) {
            }
            return out.toString();
        }

        @JavascriptInterface
        public String getAccessibilityConsentJson() {
            JSONObject out = new JSONObject();
            try {
                boolean consented = isAccessibilityConsentAcceptedInStore();
                android.content.SharedPreferences prefs = getSharedPreferences("screensync_wellness_store", MODE_PRIVATE);
                long acceptedAtMs = prefs.getLong("accessibility_disclosure_accepted_at_ms", 0L);
                out.put("ok", true);
                out.put("consented", consented);
                out.put("acceptedAtMs", acceptedAtMs);
            } catch (Exception ignored) {
            }
            return out.toString();
        }

        @JavascriptInterface
        public boolean setAccessibilityDisclosureConsent(boolean consented) {
            try {
                long ts = consented ? System.currentTimeMillis() : 0L;
                getSharedPreferences("screensync_wellness_store", MODE_PRIVATE)
                    .edit()
                    .putBoolean("accessibility_disclosure_accepted", consented)
                    .putLong("accessibility_disclosure_accepted_at_ms", ts)
                    .apply();
                getSharedPreferences("screensync_native_perm_flow", MODE_PRIVATE)
                    .edit()
                    .putBoolean("accessibility_disclosure_accepted", consented)
                    .apply();
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public String getAccessibilityHealthJson() {
            JSONObject out = new JSONObject();
            try {
                android.content.SharedPreferences prefs = getSharedPreferences("screensync_wellness_store", MODE_PRIVATE);
                boolean settingEnabled = isAccessibilityServiceEnabled();
                boolean instanceAlive = (ScreenSyncAccessibilityService.getActiveInstance() != null);
                long lastConnectedMs = prefs.getLong("accessibility_last_connected_ms", 0L);
                long lastEventMs = prefs.getLong("accessibility_last_event_ms", 0L);
                long lastUnbindMs = prefs.getLong("accessibility_last_unbind_ms", 0L);
                boolean crashedOrKilled = settingEnabled && !instanceAlive && (lastUnbindMs > lastConnectedMs);
                out.put("ok", true);
                out.put("settingEnabled", settingEnabled);
                out.put("instanceAlive", instanceAlive);
                out.put("crashedOrKilledByOem", crashedOrKilled);
                out.put("lastConnectedMs", lastConnectedMs);
                out.put("lastEventMs", lastEventMs);
                out.put("lastUnbindMs", lastUnbindMs);
            } catch (Exception ignored) {
            }
            return out.toString();
        }

        @JavascriptInterface
        public String pruneNativeHistoryJson(long cutoffEpochMs, String cutoffDayKey) {
            try {
                if (usageDbHelper != null) {
                    return usageDbHelper.pruneOlderThan(cutoffEpochMs, cutoffDayKey).toString();
                }
            } catch (Exception ignored) {
            }
            return "{\"ok\":false}";
        }

        @JavascriptInterface
        public String saveTextFileExportJson(String fileName, String mimeType, String textContent) {
            JSONObject out = new JSONObject();
            try {
                String safeName = (fileName != null && !fileName.trim().isEmpty())
                    ? fileName.replaceAll("[^a-zA-Z0-9._-]", "_")
                    : ("screensync_export_" + System.currentTimeMillis() + ".json");
                java.io.File baseDownloads = getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS);
                java.io.File outDir = (baseDownloads != null)
                    ? new java.io.File(baseDownloads, "screensync_exports")
                    : getFilesDir();
                if (outDir != null && !outDir.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    outDir.mkdirs();
                }
                java.io.File outFile = new java.io.File(outDir, safeName);
                try (java.io.FileOutputStream fos = new java.io.FileOutputStream(outFile)) {
                    fos.write((textContent != null ? textContent : "").getBytes(StandardCharsets.UTF_8));
                }
                String resolvedMime = (mimeType != null && !mimeType.trim().isEmpty()) ? mimeType : "application/json";
                String authority = getPackageName() + ".fileprovider";
                android.net.Uri contentUri = androidx.core.content.FileProvider.getUriForFile(MainActivity.this, authority, outFile);
                runOnUiThread(() -> {
                    try {
                        Intent shareIntent = new Intent(Intent.ACTION_SEND);
                        shareIntent.setType(resolvedMime);
                        shareIntent.putExtra(Intent.EXTRA_STREAM, contentUri);
                        shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        Intent chooser = Intent.createChooser(shareIntent, "Share ScreenSync Export");
                        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(chooser);
                    } catch (Exception ignored) {}
                });
                out.put("ok", true);
                out.put("fileName", safeName);
                out.put("filePath", outFile.getAbsolutePath());
                out.put("contentUri", contentUri != null ? contentUri.toString() : "");
                out.put("authority", authority);
                out.put("sharedViaFileProvider", true);
                out.put("mimeType", resolvedMime);
            } catch (Exception e) {
                try { out.put("ok", false); out.put("error", e.getMessage()); } catch (Exception ignored) {}
            }
            return out.toString();
        }

        @JavascriptInterface
        public boolean navigateHomeFromDetox() {
            try {
                ScreenSyncAccessibilityService svc = ScreenSyncAccessibilityService.getActiveInstance();
                if (svc != null) {
                    svc.dismissTransientGoalAlertOverlay();
                }
            } catch (Exception ignored) {
            }
            return minimizeAppToHomeScreen();
        }

        @JavascriptInterface
        public String consumePendingSurveyJson() {
            try {
                android.content.SharedPreferences prefs = getSharedPreferences("screensync_prefs", Context.MODE_PRIVATE);
                String surveyId = prefs.getString("pending_survey_id", "");
                String surveyUrl = prefs.getString("pending_survey_url", "");
                String surveyTitle = prefs.getString("pending_survey_title", "");
                String surveyBody = prefs.getString("pending_survey_body", "");
                if ((surveyId == null || surveyId.isEmpty()) && (surveyUrl == null || surveyUrl.isEmpty())) {
                    return "";
                }
                prefs.edit()
                    .remove("pending_survey_id")
                    .remove("pending_survey_url")
                    .remove("pending_survey_title")
                    .remove("pending_survey_body")
                    .apply();
                org.json.JSONObject obj = new org.json.JSONObject();
                obj.put("survey_id", surveyId != null ? surveyId : "");
                obj.put("survey_url", surveyUrl != null ? surveyUrl : "");
                obj.put("title", surveyTitle != null ? surveyTitle : "ScreenSync Research Survey");
                obj.put("body", surveyBody != null ? surveyBody : "");
                return obj.toString();
            } catch (Exception ignored) {
                return "";
            }
        }

        @JavascriptInterface
        public String getFcmToken() {
            try {
                android.content.SharedPreferences prefs = getSharedPreferences(
                    ScreenSyncFirebaseMessagingService.PREFS_NAME,
                    Context.MODE_PRIVATE
                );
                String cached = prefs.getString(ScreenSyncFirebaseMessagingService.KEY_FCM_TOKEN, "");
                try {
                    com.google.firebase.messaging.FirebaseMessaging.getInstance().getToken()
                        .addOnSuccessListener(token -> {
                            if (token != null && !token.isEmpty()) {
                                prefs.edit().putString(ScreenSyncFirebaseMessagingService.KEY_FCM_TOKEN, token).apply();
                                dispatchNativePushTokenToWeb(token);
                            }
                        });
                } catch (Throwable ignored) {}
                return cached != null ? cached : "";
            } catch (Throwable ignored) {
                return "";
            }
        }

        @JavascriptInterface
        public boolean logNonFatalError(String tag, String message) {
            try {
                String safeTag = tag != null ? tag : "ScreenSyncWeb";
                String safeMsg = message != null ? message : "Unknown non-fatal error";
                com.google.firebase.crashlytics.FirebaseCrashlytics crashlytics =
                    com.google.firebase.crashlytics.FirebaseCrashlytics.getInstance();
                crashlytics.setCustomKey("screensync_tag", safeTag);
                crashlytics.recordException(new RuntimeException("[" + safeTag + "] " + safeMsg));
                return true;
            } catch (Throwable ignored) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean isFallbackCounterActive() {
            return FallbackReelsCounterService.isRunning();
        }

        @JavascriptInterface
        public boolean startFallbackCounterIfNeeded() {
            try {
                if (ScreenSyncAccessibilityService.getActiveInstance() != null) {
                    FallbackReelsCounterService.stopIfAccessibilityActive(MainActivity.this);
                    return false;
                }
                Intent svcIntent = new Intent(MainActivity.this, FallbackReelsCounterService.class);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(svcIntent);
                } else {
                    startService(svcIntent);
                }
                return true;
            } catch (Throwable ignored) {
                return false;
            }
        }

        @JavascriptInterface
        public String getFallbackCounterStatusJson() {
            try {
                boolean accActive = ScreenSyncAccessibilityService.getActiveInstance() != null;
                boolean fallbackRunning = FallbackReelsCounterService.isRunning() && !accActive;
                JSONObject obj = new JSONObject();
                obj.put("accessibilityActive", accActive);
                obj.put("fallbackActive", fallbackRunning);
                return obj.toString();
            } catch (Throwable ignored) {
                return "{\"accessibilityActive\":false,\"fallbackActive\":false}";
            }
        }

        @JavascriptInterface
        public boolean snoozeFloatingOverlay(int durationMinutes) {
            try {
                ScreenSyncAccessibilityService svc = ScreenSyncAccessibilityService.getActiveInstance();
                if (svc != null) {
                    svc.snoozeOverlay(durationMinutes);
                    return true;
                }
                return false;
            } catch (Throwable ignored) {
                return false;
            }
        }

        @JavascriptInterface
        public String getFloatingOverlayStateJson() {
            try {
                ScreenSyncAccessibilityService svc = ScreenSyncAccessibilityService.getActiveInstance();
                JSONObject obj = new JSONObject();
                obj.put("mode", svc != null ? svc.getOverlayMode() : "collapsed");
                obj.put("snoozed", svc != null && svc.isOverlaySnoozed());
                obj.put("snoozeUntilMs", svc != null ? svc.getOverlaySnoozeUntilMs() : 0L);
                return obj.toString();
            } catch (Throwable ignored) {
                return "{\"mode\":\"collapsed\",\"snoozed\":false,\"snoozeUntilMs\":0}";
            }
        }

        private android.hardware.SensorEventListener unlockSensorListener = null;
        private long lastJumpPeakRealtimeMs = 0L;

        @JavascriptInterface
        public boolean startUnlockMissionSensor(final String missionType) {
            try {
                stopUnlockMissionSensor();
                final String normType = missionType != null ? missionType.trim().toUpperCase(Locale.US) : "JUMP_SENSOR";
                if ("NFC_TAP".equals(normType)) {
                    android.nfc.NfcAdapter nfc = android.nfc.NfcAdapter.getDefaultAdapter(MainActivity.this);
                    if (nfc != null && nfc.isEnabled() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                        nfc.enableReaderMode(
                            MainActivity.this,
                            tag -> runOnUiThread(() -> {
                                if (webView != null) {
                                    webView.evaluateJavascript(
                                        "if (window.ScreenSyncApp && window.ScreenSyncApp.UnlockMissionController) { window.ScreenSyncApp.UnlockMissionController.recordProgress(1); if (window.ScreenSyncApp.Part16UIController) window.ScreenSyncApp.Part16UIController.renderUnlockMissionModalState(); }",
                                        null
                                    );
                                }
                            }),
                            android.nfc.NfcAdapter.FLAG_READER_NFC_A
                                | android.nfc.NfcAdapter.FLAG_READER_NFC_B
                                | android.nfc.NfcAdapter.FLAG_READER_NFC_F
                                | android.nfc.NfcAdapter.FLAG_READER_NFC_V
                                | android.nfc.NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK,
                            null
                        );
                        return true;
                    }
                    return false;
                }
                final android.hardware.SensorManager sm = (android.hardware.SensorManager) getSystemService(Context.SENSOR_SERVICE);
                if (sm == null) return false;
                android.hardware.Sensor targetSensor = null;
                int rate = android.hardware.SensorManager.SENSOR_DELAY_NORMAL;
                if ("JUMP_SENSOR".equals(normType)) {
                    targetSensor = sm.getDefaultSensor(android.hardware.Sensor.TYPE_ACCELEROMETER);
                    rate = android.hardware.SensorManager.SENSOR_DELAY_GAME;
                } else if ("WALK_STEPS".equals(normType)) {
                    targetSensor = sm.getDefaultSensor(android.hardware.Sensor.TYPE_STEP_DETECTOR);
                    if (targetSensor == null) {
                        targetSensor = sm.getDefaultSensor(android.hardware.Sensor.TYPE_STEP_COUNTER);
                    }
                    rate = android.hardware.SensorManager.SENSOR_DELAY_NORMAL;
                } else if ("FOREHEAD_PROXIMITY".equals(normType)) {
                    targetSensor = sm.getDefaultSensor(android.hardware.Sensor.TYPE_PROXIMITY);
                } else if ("FLIP_FACE_DOWN".equals(normType)) {
                    targetSensor = sm.getDefaultSensor(android.hardware.Sensor.TYPE_GRAVITY);
                    if (targetSensor == null) {
                        targetSensor = sm.getDefaultSensor(android.hardware.Sensor.TYPE_ACCELEROMETER);
                    }
                }
                if (targetSensor == null) return false;
                unlockSensorListener = new android.hardware.SensorEventListener() {
                    @Override
                    public void onSensorChanged(android.hardware.SensorEvent event) {
                        if (event == null || event.values == null || webView == null) return;
                        if ("JUMP_SENSOR".equals(normType) && event.values.length >= 3) {
                            float x = event.values[0], y = event.values[1], z = event.values[2];
                            double mag = Math.sqrt(x * x + y * y + z * z);
                            long now = SystemClock.elapsedRealtime();
                            if (mag > 15.8d && (now - lastJumpPeakRealtimeMs) >= 450L) {
                                lastJumpPeakRealtimeMs = now;
                                runOnUiThread(() -> webView.evaluateJavascript(
                                    "if (window.ScreenSyncApp && window.ScreenSyncApp.UnlockMissionController) { window.ScreenSyncApp.UnlockMissionController.recordProgress(1); if (window.ScreenSyncApp.Part16UIController) window.ScreenSyncApp.Part16UIController.renderUnlockMissionModalState(); }",
                                    null
                                ));
                            }
                        } else if ("WALK_STEPS".equals(normType)) {
                            runOnUiThread(() -> webView.evaluateJavascript(
                                "if (window.ScreenSyncApp && window.ScreenSyncApp.UnlockMissionController) { window.ScreenSyncApp.UnlockMissionController.recordProgress(1); if (window.ScreenSyncApp.Part16UIController) window.ScreenSyncApp.Part16UIController.renderUnlockMissionModalState(); }",
                                null
                            ));
                        } else if ("FOREHEAD_PROXIMITY".equals(normType) && event.values.length >= 1) {
                            float maxRange = event.sensor != null ? event.sensor.getMaximumRange() : 5.0f;
                            boolean isNear = event.values[0] < Math.min(3.0f, maxRange);
                            if (!isNear) {
                                runOnUiThread(() -> webView.evaluateJavascript(
                                    "if (window.ScreenSyncApp && window.ScreenSyncApp.UnlockMissionController) { window.ScreenSyncApp.UnlockMissionController.resetOnInterruption(\"PROXIMITY_REMOVED\"); if (window.ScreenSyncApp.Part16UIController) window.ScreenSyncApp.Part16UIController.renderUnlockMissionModalState(); }",
                                    null
                                ));
                            }
                        } else if ("FLIP_FACE_DOWN".equals(normType) && event.values.length >= 3) {
                            float z = event.values[2];
                            if (z > -7.0f) {
                                runOnUiThread(() -> webView.evaluateJavascript(
                                    "if (window.ScreenSyncApp && window.ScreenSyncApp.UnlockMissionController) { window.ScreenSyncApp.UnlockMissionController.resetOnInterruption(\"FLIP_LIFTED\"); if (window.ScreenSyncApp.Part16UIController) window.ScreenSyncApp.Part16UIController.renderUnlockMissionModalState(); }",
                                    null
                                ));
                            }
                        }
                    }

                    @Override
                    public void onAccuracyChanged(android.hardware.Sensor sensor, int accuracy) {}
                };
                return sm.registerListener(unlockSensorListener, targetSensor, rate);
            } catch (Throwable ignored) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean stopUnlockMissionSensor() {
            try {
                android.hardware.SensorManager sm = (android.hardware.SensorManager) getSystemService(Context.SENSOR_SERVICE);
                if (sm != null && unlockSensorListener != null) {
                    sm.unregisterListener(unlockSensorListener);
                }
                unlockSensorListener = null;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                    android.nfc.NfcAdapter nfc = android.nfc.NfcAdapter.getDefaultAdapter(MainActivity.this);
                    if (nfc != null) {
                        nfc.disableReaderMode(MainActivity.this);
                    }
                }
                return true;
            } catch (Throwable ignored) {
                unlockSensorListener = null;
                return false;
            }
        }

        @JavascriptInterface
        public String getIntegrityAttestationJson() {
            return NativeAntiTamperGuard.getIntegrityAttestationJson(MainActivity.this);
        }

        @JavascriptInterface
        public boolean verifyServerSignedEntitlementToken(
            String entitlementJwt,
            String expectedUserId,
            String expectedInstallationId,
            String expectedPlanId,
            long nowMs,
            String hmacSecretKey
        ) {
            return NativeAntiTamperGuard.verifyServerSignedEntitlementToken(
                entitlementJwt,
                expectedUserId,
                expectedInstallationId,
                expectedPlanId,
                nowMs,
                hmacSecretKey
            );
        }

        @JavascriptInterface
        public boolean pauseBackgroundMediaForRoast() {
            try {
                android.media.AudioManager am = (android.media.AudioManager) getSystemService(Context.AUDIO_SERVICE);
                if (am != null) {
                    am.requestAudioFocus(null, android.media.AudioManager.STREAM_MUSIC, android.media.AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
                    return true;
                }
                return false;
            } catch (Throwable ignored) {
                return false;
            }
        }
    }

    public class ScreenSyncNativeBridge extends ScreenSyncAndroidBridge {}

    public static void dispatchIncomingPushSurveyToWeb(final String surveyId, final String surveyUrl, final String title, final String body) {
        final MainActivity instance = activeInstance;
        if (instance == null || instance.webView == null) return;
        try {
            org.json.JSONObject payload = new org.json.JSONObject();
            payload.put("survey_id", surveyId != null ? surveyId : "");
            payload.put("survey_url", surveyUrl != null ? surveyUrl : "");
            payload.put("title", title != null ? title : "ScreenSync Research Survey");
            payload.put("body", body != null ? body : "");
            final String safeJson = payload.toString();
            instance.runOnUiThread(() -> {
                try {
                    if (instance.webView != null) {
                        instance.webView.evaluateJavascript(
                            "if (window.ScreenSyncApp && window.ScreenSyncApp.ResearchSurveyOverlayController && typeof window.ScreenSyncApp.ResearchSurveyOverlayController.onNativeSurveyPayload === 'function') { window.ScreenSyncApp.ResearchSurveyOverlayController.onNativeSurveyPayload(" + safeJson + "); }",
                            null
                        );
                    }
                } catch (Exception ignored) {}
            });
        } catch (Exception ignored) {}
    }

    public static void dispatchNativePushTokenToWeb(final String token) {
        if (token == null || token.trim().isEmpty()) return;
        final MainActivity instance = activeInstance;
        if (instance == null || instance.webView == null) return;
        final String safeJsonToken = JSONObject.quote(token.trim());
        instance.runOnUiThread(() -> {
            try {
                if (instance.webView != null) {
                    instance.webView.evaluateJavascript(
                        "if (window.ScreenSyncApp && window.ScreenSyncApp.FirebasePushManager && typeof window.ScreenSyncApp.FirebasePushManager.onNativePushToken === 'function') { window.ScreenSyncApp.FirebasePushManager.onNativePushToken(" + safeJsonToken + ", 'android'); }",
                        null
                    );
                }
            } catch (Exception ignored) {}
        });
    }

    @Override
    protected void onPause() {
        super.onPause();
        try {
            CookieManager.getInstance().flush();
        } catch (Exception ignored) {}
        if (webView != null) {
            webView.evaluateJavascript(
                "if (window.ScreenSyncApp && window.ScreenSyncApp.ReelTrackingEngine) { window.ScreenSyncApp.ReelTrackingEngine.onAppBackgrounded(); } " +
                "if (window.ScreenSyncApp && window.ScreenSyncApp.AutoSyncService) { window.ScreenSyncApp.AutoSyncService.stopBackgroundSyncLoop(); }",
                null
            );
            webView.onPause();
            webView.pauseTimers();
        }
    }

    @Override
    protected void onStop() {
        super.onStop();
        try {
            CookieManager.getInstance().flush();
        } catch (Exception ignored) {}
    }

    @Override
    protected void onResume() {
        super.onResume();
        NativeAntiTamperGuard.verifyIntegrity(this);
        handleSurveyIntent(getIntent());
        if (webView != null) {
            webView.onResume();
            webView.resumeTimers();
            final boolean hasUsage = hasUsageStatsPermission();
            final boolean hasAccess = isAccessibilityServiceEnabled();
            final boolean hasOverlay = Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this);
            final boolean hasNotifications = hasNotificationPermission();
            final boolean hasOemBackground = isIgnoringBatteryOptimizationsCompat();

            // Pass 22 Task 22.2 & CAT11-02: Sequential Prompt — advance to next missing permission on resume
            try {
                android.content.SharedPreferences prefs =
                    getSharedPreferences("screensync_native_perm_flow", Context.MODE_PRIVATE);
                if (hasUsage && !hasOverlay && !isAwaitingRuntimePermissionResult && !prefs.getBoolean("overlay_prompted_after_usage", false)) {
                    prefs.edit().putBoolean("overlay_prompted_after_usage", true).apply();
                    promptNextMissingSystemPermissionNatively();
                } else if (hasUsage && hasOverlay && !hasOemBackground && !isAwaitingRuntimePermissionResult && !prefs.getBoolean("battery_prompted_after_overlay", false)) {
                    promptNextMissingSystemPermissionNatively();
                } else if (hasUsage && hasOverlay && !hasAccess && !isAwaitingRuntimePermissionResult && !prefs.getBoolean("accessibility_disclosure_prompted_once", false)) {
                    promptNextMissingSystemPermissionNatively();
                }
            } catch (Exception ignored) {}

            webView.evaluateJavascript(
                "if (window.ScreenSyncApp) { " +
                "window.ScreenSyncApp.ReelTrackingEngine.onAppForegrounded(); " +
                "if (window.ScreenSyncApp.AutoSyncService) { window.ScreenSyncApp.AutoSyncService.startBackgroundSyncLoop(); } " +
                "if (typeof window.ScreenSyncApp.onNativeAndroidResumeSync === 'function') { " +
                "window.ScreenSyncApp.onNativeAndroidResumeSync(" + hasUsage + ", " + hasAccess + ", " + hasOverlay + ", " + hasNotifications + ", " + hasOemBackground + "); " +
                "} else { window.ScreenSyncApp.AutoSyncService.syncWithBackend(); } " +
                "}",
                null
            );
        }
    }

    private void registerPackageChangeReceiver() {
        if (packageChangeReceiver != null) return;
        try {
            packageChangeReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    cachedInstalledAppsJson = null;
                    cachedInstalledAppsAtMs = 0L;
                    if (intent != null && intent.getData() != null) {
                        String pkg = intent.getData().getSchemeSpecificPart();
                        if (pkg != null && !pkg.isEmpty()) {
                            appLabelCache.remove(pkg);
                            appIconCache.remove(pkg);
                        }
                    }
                }
            };
            IntentFilter pkgFilter = new IntentFilter();
            pkgFilter.addAction(Intent.ACTION_PACKAGE_ADDED);
            pkgFilter.addAction(Intent.ACTION_PACKAGE_REMOVED);
            pkgFilter.addAction(Intent.ACTION_PACKAGE_REPLACED);
            pkgFilter.addDataScheme("package");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(packageChangeReceiver, pkgFilter, Context.RECEIVER_EXPORTED);
            } else {
                registerReceiver(packageChangeReceiver, pkgFilter);
            }
        } catch (Exception ignored) {
        }
    }

    @Override
    protected void onDestroy() {
        if (packageChangeReceiver != null) {
            try {
                unregisterReceiver(packageChangeReceiver);
            } catch (Exception ignored) {}
            packageChangeReceiver = null;
        }
        if (screenWakeSyncReceiver != null) {
            try {
                unregisterReceiver(screenWakeSyncReceiver);
            } catch (Exception ignored) {}
            screenWakeSyncReceiver = null;
        }
        if (activeInstance == this) {
            activeInstance = null;
        }
        super.onDestroy();
    }

    private volatile boolean nativeBackStackInterceptEnabled = false;
    private Object android13BackInvokedCallback = null;

    private void registerPredictiveBackCallbackIfSupported() {
        if (Build.VERSION.SDK_INT >= 33) {
            try {
                android.window.OnBackInvokedCallback cb = new android.window.OnBackInvokedCallback() {
                    @Override
                    public void onBackInvoked() {
                        onBackPressed();
                    }
                };
                getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                    cb
                );
                android13BackInvokedCallback = cb;
            } catch (Throwable ignored) {
            }
        }
    }

    private void dispatchSystemBackToWebView() {
        if (webView != null) {
            final java.util.concurrent.atomic.AtomicBoolean settled = new java.util.concurrent.atomic.AtomicBoolean(false);
            webView.postDelayed(() -> {
                if (settled.compareAndSet(false, true)) {
                    moveTaskToBack(true);
                }
            }, 600L);
            // Canonical Android hardware/gesture back path (CAT14-09 & CAT14-10):
            // Delegates to window.ScreenSyncApp.handleSystemBackNavigation() via window.ScreenSyncApp.handleSystemBackNavigation({ fromAndroidNativeBack: true })
            // When at root OVERVIEW, JS returns false and native moveTaskToBack(true) backgrounds the app.
            webView.evaluateJavascript(
                "(function(){ return (window.ScreenSyncApp && typeof window.ScreenSyncApp.handleSystemBackNavigation === 'function') ? window.ScreenSyncApp.handleSystemBackNavigation({ fromAndroidNativeBack: true }) : (typeof window.handleSystemBackNavigation === 'function' ? window.handleSystemBackNavigation({ fromAndroidNativeBack: true }) : false); })()",
                value -> {
                    if (settled.compareAndSet(false, true)) {
                        if (!"true".equals(value)) {
                            runOnUiThread(() -> moveTaskToBack(true));
                        }
                    }
                }
            );
        } else {
            moveTaskToBack(true);
        }
    }

    @Override
    public void onBackPressed() {
        dispatchSystemBackToWebView();
    }
}
