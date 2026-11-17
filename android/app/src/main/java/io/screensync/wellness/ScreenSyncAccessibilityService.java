package io.screensync.wellness;

import android.accessibilityservice.AccessibilityService;
import android.app.AlarmManager;
import android.app.KeyguardManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.util.TypedValue;
import android.view.DisplayCutout;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.text.SimpleDateFormat;
import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * ScreenSyncAccessibilityService (Pass 23 Universal App-Timer & Focus Distraction Guard Upgrade)
 * Implements the ScreenSync & Reel-Counting 6-State FSM, Three-Gate / Three-Tier
 * Short-Form Surface Classifier (across native apps + all mobile web browsers),
 * Inline Volatile Number Sanitizer, TIER_C_CANVAS Signature Fallback, Per-Package 40-Item LRU
 * Deduplication Cache, Monotonic Watch-Time Accumulator, 2-Second Live Surface Heartbeat Verification,
 * 450ms TYPE_WINDOW_CONTENT_CHANGED Throttling, 120-Node BFS Cap, Universal Third-Party App Timer &
 * Focus Distraction Guard, 5-Second Transient Goal Alert Overlay, and Strictly Non-Draggable Top-Center
 * Cutout-Adaptive Dynamic Island Overlay (never shown inside ScreenSync).
 */
public class ScreenSyncAccessibilityService extends AccessibilityService {

    public enum State {
        INACTIVE,
        SURFACE_ACTIVE,
        REEL_CANDIDATE,
        REEL_COUNTED,
        PAUSED_OVERLAY,
        PAUSED_SYSTEM
    }

    private static ScreenSyncAccessibilityService activeInstance;

    public static ScreenSyncAccessibilityService getActiveInstance() {
        return activeInstance;
    }

    private static final String PREF_SCREENSYNC = "screensync_wellness_store";
    private static final long MIN_REEL_DWELL_MS = 1200L;
    private static final long SCROLL_SETTLE_DEBOUNCE_MS = 300L;
    private static final long HEARTBEAT_TICK_MS = 2000L;
    private static final long MAX_IDLE_GAP_MS = 30000L;
    private static final long IDLE_CLAMP_CREDIT_MS = 5000L;
    private static final int RECENT_SIGNATURE_LRU_SIZE = 40;
    private static final long MIN_CONTENT_SCAN_INTERVAL_MS = 450L;

    private static final Set<String> BROWSER_PACKAGES = new HashSet<>(Arrays.asList(
        "com.android.chrome", "com.chrome.beta", "com.chrome.dev", "com.chrome.canary",
        "com.sec.android.app.sbrowser", "com.mi.globalbrowser", "com.android.browser",
        "com.vivo.browser", "com.heytap.browser", "com.coloros.browser",
        "org.mozilla.firefox", "org.mozilla.firefox_beta", "org.mozilla.fenix",
        "com.microsoft.emmx", "com.brave.browser",
        "com.opera.browser", "com.opera.gx", "com.opera.mini.native", "com.duckduckgo.mobile.android",
        "com.vivaldi.browser", "com.kiwibrowser.browser", "com.UCMobile.intl"
    ));

    private static final Pattern BROWSER_SHORT_FORM_URL_REGEX = Pattern.compile(
        "(?:youtube\\.com/shorts|youtu\\.be/shorts/|instagram\\.com/(?:reel|reels|stories|@[^/]+/video)|" +
        "tiktok\\.com/(?:@[^/]+/video/|foryou|t/|@[^/]+)|vm\\.tiktok\\.com/|" +
        "facebook\\.com/(?:reel|reels|stories)/|fb\\.com/(?:reel|reels|stories)/|fb\\.watch/|" +
        "messenger\\.com/stories/|snapchat\\.com/(?:spotlight|stories|s/)|" +
        "(?:x|twitter)\\.com/(?:i/immersive_timeline|[^/]+/status/\\d+/video|video)|" +
        "reddit\\.com/(?:r/[^/]+/watch|watch|video/))",
        Pattern.CASE_INSENSITIVE
    );

    private long lastWidgetBroadcastElapsedMs = 0L;

    private static final Set<String> SUPPORTED_PACKAGES = new HashSet<>(Arrays.asList(
        "com.instagram.android",
        "com.google.android.youtube",
        "com.zhiliaoapp.musically",
        "com.ss.android.ugc.trill",
        "com.zhiliaoapp.musically.go",
        "com.facebook.katana",
        "com.facebook.lite",
        "com.facebook.orca",
        "com.whatsapp",
        "com.snapchat.android",
        "com.twitter.android",
        "com.reddit.frontpage",
        "com.whatsapp.w4b",
        "com.instagram.lite",
        "com.tiktok.lite.go"
    ));

    private static final Set<String> SHORT_FORM_PACKAGES = SUPPORTED_PACKAGES;

    private static final Map<String, Set<String>> TIER1_VIEW_IDS = new HashMap<>();
    static {
        SUPPORTED_PACKAGES.addAll(BROWSER_PACKAGES);

        TIER1_VIEW_IDS.put("com.instagram.android", new HashSet<>(Arrays.asList(
            "com.instagram.android:id/clips_viewer_view_pager",
            "com.instagram.android:id/clips_video_container",
            "com.instagram.android:id/reel_viewer_root",
            "com.instagram.android:id/story_viewer_container"
        )));
        TIER1_VIEW_IDS.put("com.google.android.youtube", new HashSet<>(Arrays.asList(
            "com.google.android.youtube:id/reel_recycler",
            "com.google.android.youtube:id/reel_player_page_container",
            "com.google.android.youtube:id/shorts_player_view"
        )));
        Set<String> tiktokIds = new HashSet<>(Arrays.asList(
            "com.zhiliaoapp.musically:id/viewpager",
            "com.ss.android.ugc.trill:id/viewpager"
        ));
        TIER1_VIEW_IDS.put("com.zhiliaoapp.musically", tiktokIds);
        TIER1_VIEW_IDS.put("com.ss.android.ugc.trill", tiktokIds);
        TIER1_VIEW_IDS.put("com.zhiliaoapp.musically.go", tiktokIds);
        TIER1_VIEW_IDS.put("com.facebook.katana", new HashSet<>(Arrays.asList(
            "com.facebook.katana:id/fb_shorts_viewer_pager",
            "com.facebook.katana:id/reels_viewer_container",
            "com.facebook.katana:id/story_viewer_container"
        )));
        TIER1_VIEW_IDS.put("com.facebook.orca", new HashSet<>(Arrays.asList(
            "com.facebook.orca:id/story_viewer_container",
            "com.facebook.orca:id/montage_viewer_container"
        )));
        TIER1_VIEW_IDS.put("com.whatsapp", new HashSet<>(Arrays.asList(
            "com.whatsapp:id/status_playback_pager",
            "com.whatsapp:id/status_playback_fragment"
        )));
        TIER1_VIEW_IDS.put("com.snapchat.android", new HashSet<>(Arrays.asList(
            "com.snapchat.android:id/spotlight_view_pager",
            "com.snapchat.android:id/story_view_pager",
            "com.snapchat.android:id/opera_layer_container"
        )));
        TIER1_VIEW_IDS.put("com.twitter.android", new HashSet<>(Arrays.asList(
            "com.twitter.android:id/immersive_video_player",
            "com.twitter.android:id/video_player_view",
            "com.twitter.android:id/av_player_container"
        )));
        TIER1_VIEW_IDS.put("com.reddit.frontpage", new HashSet<>(Arrays.asList(
            "com.reddit.frontpage:id/video_player_pager",
            "com.reddit.frontpage:id/watch_feed_pager",
            "com.reddit.frontpage:id/media_view_pager"
        )));
        TIER1_VIEW_IDS.put("com.whatsapp.w4b", new HashSet<>(Arrays.asList(
            "com.whatsapp.w4b:id/status_playback_pager",
            "com.whatsapp.w4b:id/status_playback_fragment"
        )));
    }

    private static final Pattern VOLATILE_METRIC_REGEX = Pattern.compile(
        "^\\d+(\\.\\d+)?[KMBkmb]?(\\s+(likes?|comments?|views?|shares?|reposts?))?$",
        Pattern.CASE_INSENSITIVE
    );

    private static final long FAST_SKIP_MAX_MS = 2500L; // Mirrors JS ReelTrackingEngine.FAST_SKIP_MAX_MS
    private static final long DETOX_MAX_GAP_MS = 120_000L; // Mirrors JS ReelDetoxCooldownController.DETOX_MAX_GAP_MS
    private static final long LRU_TTL_MS = 600_000L; // Mirrors JS ReelTrackingEngine.TIMING_CONFIG.lruTtlMs

    private static final Pattern INLINE_NUMBERS_REGEX = Pattern.compile(
        "\\b\\d+(?:[.,]\\d+)*(?:\\s*[KMBkmb]\\b|\\s*(?:likes?|comments?|views?|shares?|reposts?|saves?|plays?|watch(?:es|ing)?|followers?|reactions?)\\b)|" +
        "\\b\\d+\\s*(?:s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|month|months|y|yr|yrs|year|years)(?:\\s+ago)?\\b|" +
        "\\b(?:just\\s+now|yesterday)\\b|\\b\\d{1,3}(?:,\\d{3})+\\b",
        Pattern.CASE_INSENSITIVE
    );

    public static String normalizeReelContentSignature(String rawText) {
        if (rawText == null || rawText.trim().isEmpty()) return "";
        String trimmed = rawText.trim();
        if (VOLATILE_METRIC_REGEX.matcher(trimmed).matches()) return "#";
        String stripped = INLINE_NUMBERS_REGEX.matcher(trimmed.toLowerCase(Locale.US)).replaceAll("#");
        return stripped.replaceAll("\\s+", " ").trim();
    }

    private State state = State.INACTIVE;
    private State currentState = State.INACTIVE;
    private String activePackage = null;
    private String activeBrowserHostPackage = null;
    private boolean isIdleClamped = false;
    private String lastCommittedSignature = null;
    private String candidateSignature = null;
    private int candidateScrollIdx = -1;
    private int lastCountedScrollIdx = -1;
    private long candidateEnteredElapsedMs = 0L;
    private long accumulatedCandidateDwellMs = 0L;
    private long lastTickElapsedMs = 0L;
    private long lastUserInteractionElapsedMs = 0L;
    private long lastContentScanElapsedMs = 0L;

    private final Map<String, Long> watchDurationByPackageMs = new ConcurrentHashMap<>();
    private int consecutiveReelsInSession = 0;
    private long lastReelCountedElapsedMs = 0L;
    private long continuousShortFormWatchMs = 0L;
    private View detoxCooldownOverlayView = null;
    private int detoxRemainingSeconds = 0;
    private long lastBedtimeWindDownAlertMs = 0L;

    private WindowManager windowManager;
    private WindowManager.LayoutParams overlayParams;
    private LinearLayout overlayIslandView;
    private View overlayDividerView;
    private TextView overlayReelsText;
    private TextView overlayBrainIconView;
    private TextView overlayWatchTimeText;
    private boolean isOverlayAttached = false;
    private boolean isScreenReceiverRegistered = false;
    private View transientGoalAlertView = null;

    private final Map<String, LinkedHashMap<String, Long>> lruByPackage = new HashMap<>();
    private static final long DISTRACTION_COOLDOWN_MS = 30_000L;
    private final Map<String, Long> lastDistractionAlertByPkg = new HashMap<>();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Handler mainHandler = handler;
    private volatile boolean isScreenInteractive = true;

    private final Runnable dismissGoalAlertRunnable = new Runnable() {
        @Override
        public void run() {
            removeTransientGoalAlertOverlay();
        }
    };

    private final BroadcastReceiver screenStateReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent == null || intent.getAction() == null) return;
            String action = intent.getAction();
            if (Intent.ACTION_SCREEN_OFF.equals(action)) {
                isScreenInteractive = false;
                long now = SystemClock.elapsedRealtime();
                flushWatchDelta(now);
                transitionTo(State.PAUSED_SYSTEM, now);
                hideDynamicIslandOverlay();
                mainHandler.removeCallbacksAndMessages(null);
            } else if (Intent.ACTION_SCREEN_ON.equals(action) || Intent.ACTION_USER_PRESENT.equals(action)) {
                isScreenInteractive = true;
                long now = SystemClock.elapsedRealtime();
                lastTickElapsedMs = now;
                if (state == State.PAUSED_SYSTEM) {
                    transitionTo(State.SURFACE_ACTIVE, now);
                }
                mainHandler.removeCallbacks(heartbeatRunnable);
                mainHandler.postDelayed(heartbeatRunnable, HEARTBEAT_TICK_MS);
                try {
                    Intent wakeSync = new Intent("io.screensync.wellness.ACTION_SCREEN_WAKE_SYNC");
                    wakeSync.setPackage(getPackageName());
                    sendBroadcast(wakeSync);
                } catch (Exception ignored) {
                }
            }
        }
    };

    private final Runnable settleRunnable = new Runnable() {
        @Override
        public void run() {
            evaluateSettledCandidate();
        }
    };

    private final Runnable dwellRunnable = new Runnable() {
        @Override
        public void run() {
            commitCandidateIfEligible();
        }
    };

    private final Runnable heartbeatRunnable = new Runnable() {
        @Override
        public void run() {
            if (!isScreenInteractive) {
                return;
            }
            onHeartbeatTick();
            if (isWatchingState(state)) {
                handler.postDelayed(this, HEARTBEAT_TICK_MS);
            }
        }
    };

    private static final Set<String> SENSITIVE_VAULT_AND_BANKING_PACKAGES = new HashSet<>(Arrays.asList(
        "com.agilebits.onepassword",
        "com.x8bit.bitwarden",
        "com.lastpass.lpandroid",
        "com.dashlane",
        "proton.android.pass",
        "keepass2android.keepass2android",
        "com.google.android.apps.authenticator2",
        "com.azure.authenticator",
        "com.duosecurity.duomobile",
        "com.android.credentials",
        "com.android.keychain",
        "com.samsung.android.biometrics.app.setting",
        "com.samsung.android.samsungpass",
        "com.miui.securityadd",
        "com.coloros.oshare",
        "com.paypal.android.p2pmobile",
        "com.venmo",
        "com.squareup.cash",
        "com.google.android.apps.nbu.paisa.user",
        "com.phonepe.app",
        "net.one97.paytm",
        "com.bKash.customerapp",
        "com.konasl.nagad"
    ));

    public static boolean isSensitiveVaultOrBankingPackage(String pkg) {
        if (pkg == null || pkg.isEmpty()) return false;
        if (SENSITIVE_VAULT_AND_BANKING_PACKAGES.contains(pkg)) return true;
        String lower = pkg.toLowerCase(Locale.US);
        return lower.contains("password") || lower.contains("bitwarden") || lower.contains("onepassword")
            || lower.contains("lastpass") || lower.contains("keepass") || lower.contains("authenticator")
            || lower.contains(".bank") || lower.contains("banking") || lower.contains("bkash")
            || lower.contains("nagad") || lower.contains("paytm") || lower.contains("phonepe");
    }

    public static String hashSignatureToken(String normalizedToken) {
        if (normalizedToken == null || normalizedToken.isEmpty()) return "";
        int h1 = 0x811c9dc5;
        for (int i = 0; i < normalizedToken.length(); i++) {
            h1 ^= normalizedToken.charAt(i);
            h1 *= 0x01000193;
        }
        return "h_" + Integer.toHexString(h1);
    }

    public boolean isAccessibilityDisclosureConsented() {
        try {
            SharedPreferences prefs = getSharedPreferences(PREF_SCREENSYNC, Context.MODE_PRIVATE);
            if (prefs.contains("accessibility_disclosure_accepted")) {
                return prefs.getBoolean("accessibility_disclosure_accepted", false);
            }
            SharedPreferences legacyPrefs = getSharedPreferences("screensync_native_perm_flow", Context.MODE_PRIVATE);
            if (legacyPrefs.getBoolean("accessibility_disclosure_accepted", false)) {
                prefs.edit()
                    .putBoolean("accessibility_disclosure_accepted", true)
                    .putLong("accessibility_disclosure_accepted_at_ms", System.currentTimeMillis())
                    .apply();
                return true;
            }
            // CAT11-03: Default deny until explicit user acceptance of prominent in-app disclosure
            return false;
        } catch (Exception ignored) {
            return false;
        }
    }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        activeInstance = this;
        FallbackReelsCounterService.stopIfAccessibilityActive(this);
        try {
            getSharedPreferences(PREF_SCREENSYNC, Context.MODE_PRIVATE)
                .edit()
                .putLong("accessibility_last_connected_ms", System.currentTimeMillis())
                .putBoolean("accessibility_service_bound", true)
                .apply();
        } catch (Exception ignored) {
        }
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        isScreenInteractive = (pm == null) || pm.isInteractive();
        if (!isScreenReceiverRegistered) {
            try {
                IntentFilter filter = new IntentFilter();
                filter.addAction(Intent.ACTION_SCREEN_OFF);
                filter.addAction(Intent.ACTION_SCREEN_ON);
                filter.addAction(Intent.ACTION_USER_PRESENT);
                if (Build.VERSION.SDK_INT >= 33) {
                    registerReceiver(screenStateReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
                } else {
                    registerReceiver(screenStateReceiver, filter);
                }
                isScreenReceiverRegistered = true;
            } catch (Exception ignored) {
            }
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        activeInstance = this;
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        isScreenInteractive = (pm == null) || pm.isInteractive();
        if (!isScreenInteractive) {
            mainHandler.removeCallbacksAndMessages(null);
        }
        return Service.START_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        flushWatchDelta(SystemClock.elapsedRealtime());
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        isScreenInteractive = (pm == null) || pm.isInteractive();
        if (isScreenInteractive) {
            mainHandler.removeCallbacks(heartbeatRunnable);
            mainHandler.postDelayed(heartbeatRunnable, HEARTBEAT_TICK_MS);
            try {
                AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
                if (am != null) {
                    Intent keepAliveIntent = new Intent(getApplicationContext(), BootCompletedReceiver.class);
                    keepAliveIntent.setAction("io.screensync.wellness.ACTION_KEEPALIVE_PULSE");
                    int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        piFlags |= PendingIntent.FLAG_IMMUTABLE;
                    }
                    PendingIntent pi = PendingIntent.getBroadcast(getApplicationContext(), 1001, keepAliveIntent, piFlags);
                    long triggerAt = SystemClock.elapsedRealtime() + 3000L;
                    if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) {
                        am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi);
                    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi);
                    } else {
                        am.setExact(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi);
                    }
                }
            } catch (Exception ignored) {
            }
        } else {
            mainHandler.removeCallbacksAndMessages(null);
        }
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (!isScreenInteractive || event == null || event.getPackageName() == null) return;
        if (event.isPassword()) return;
        AccessibilityNodeInfo srcNode = event.getSource();
        if (srcNode != null) {
            boolean isPwdNode = (srcNode.isPassword() == true);
            srcNode.recycle();
            if (isPwdNode) return;
        }
        String pkg = event.getPackageName().toString();
        long now = SystemClock.elapsedRealtime();

        if (pkg.equals(getPackageName())) {
            if (state != State.INACTIVE || isOverlayAttached) {
                flushWatchDelta(now);
                transitionTo(State.INACTIVE, now);
                hideDynamicIslandOverlay();
            }
            return;
        }
        if ("com.android.systemui".equals(pkg)) return;
        if (isSensitiveVaultOrBankingPackage(pkg)) {
            if (state != State.INACTIVE || isOverlayAttached) {
                flushWatchDelta(now);
                transitionTo(State.INACTIVE, now);
                hideDynamicIslandOverlay();
            }
            return;
        }

        if (!isAccessibilityDisclosureConsented()) {
            if (state != State.INACTIVE || isOverlayAttached) {
                flushWatchDelta(now);
                transitionTo(State.INACTIVE, now);
                hideDynamicIslandOverlay();
            }
            return;
        }
        try {
            getSharedPreferences(PREF_SCREENSYNC, Context.MODE_PRIVATE)
                .edit()
                .putLong("accessibility_last_event_ms", System.currentTimeMillis())
                .apply();
        } catch (Exception ignored) {
        }

        // Pass 23 Task 23.2: Enforce universal App Timers & Focus Distraction Guard across all user apps
        enforceFocusDistractionGuardAndAppTimers(pkg, now);

        // Enforce strict allowlist check for short-form video DOM scanning: only scan allowlisted short-form packages
        if (!SUPPORTED_PACKAGES.contains(pkg)) {
            if (state != State.INACTIVE) {
                flushWatchDelta(now);
                transitionTo(State.INACTIVE, now);
            }
            return;
        }

        int eventType = event.getEventType();
        if (eventType == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
            if ((now - lastContentScanElapsedMs) < MIN_CONTENT_SCAN_INTERVAL_MS) {
                return; // Throttle high-frequency progress-bar content ticks to save battery
            }
            lastContentScanElapsedMs = now;
        }

        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;

        try {
            DisplayMetrics dm = getResources().getDisplayMetrics();
            boolean isShortForm = isShortFormSurfaceActive(root, pkg, dm.widthPixels, dm.heightPixels);
            if (!isShortForm) {
                if (state != State.INACTIVE) {
                    flushWatchDelta(now);
                    transitionTo(State.INACTIVE, now);
                }
                return;
            }

            if (hasBlockingOverlaySheet(root, dm.heightPixels)) {
                if (isWatchingState(state)) {
                    accumulatedCandidateDwellMs += Math.max(0L, now - candidateEnteredElapsedMs);
                    flushWatchDelta(now);
                    transitionTo(State.PAUSED_OVERLAY, now);
                }
                return;
            } else if (state == State.PAUSED_OVERLAY) {
                candidateEnteredElapsedMs = now;
                lastTickElapsedMs = now;
                long remaining = Math.max(0L, MIN_REEL_DWELL_MS - accumulatedCandidateDwellMs);
                transitionTo(State.REEL_CANDIDATE, now);
                handler.postDelayed(dwellRunnable, remaining);
            }

            String effectivePkg = BROWSER_PACKAGES.contains(pkg)
                ? resolveEffectiveShortFormPackage(root, pkg)
                : pkg;
            activeBrowserHostPackage = BROWSER_PACKAGES.contains(pkg) ? pkg : null;
            if (!effectivePkg.equals(activePackage)) {
                lastCountedScrollIdx = -1;
                candidateScrollIdx = -1;
            }
            activePackage = effectivePkg;
            if (eventType == AccessibilityEvent.TYPE_VIEW_SCROLLED ||
                eventType == AccessibilityEvent.TYPE_VIEW_SELECTED ||
                eventType == AccessibilityEvent.TYPE_VIEW_CLICKED ||
                eventType == AccessibilityEvent.TYPE_TOUCH_INTERACTION_START ||
                eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
                lastUserInteractionElapsedMs = now;
                idleTailClampedForCurrentSession = false;
                isIdleClamped = false;
            }

            if (state == State.INACTIVE) {
                transitionTo(State.SURFACE_ACTIVE, now);
            }

            if (eventType == AccessibilityEvent.TYPE_VIEW_SCROLLED ||
                eventType == AccessibilityEvent.TYPE_VIEW_SELECTED ||
                eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
                eventType == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
                if (event.getToIndex() >= 0) {
                    candidateScrollIdx = event.getToIndex();
                } else if (event.getCurrentItemIndex() >= 0) {
                    candidateScrollIdx = event.getCurrentItemIndex();
                }
                boolean shouldRearmSettle = (eventType == AccessibilityEvent.TYPE_VIEW_SCROLLED)
                    || (eventType == AccessibilityEvent.TYPE_VIEW_SELECTED)
                    || (eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED)
                    || (candidateSignature == null)
                    || (state == State.SURFACE_ACTIVE);
                if (shouldRearmSettle) {
                    handler.removeCallbacks(settleRunnable);
                    handler.postDelayed(settleRunnable, SCROLL_SETTLE_DEBOUNCE_MS);
                }
            }
        } finally {
            root.recycle();
        }
    }

    private final Map<String, Long> lastTimerAlertTimeByPkg = new ConcurrentHashMap<>();
    private final Map<String, Long> lastHomeActionTimeByPkg = new ConcurrentHashMap<>();
    private volatile String cachedSyncedTimersJson = "";
    private volatile org.json.JSONObject cachedSyncedTimersRoot = null;

    private static final Set<String> STATIC_SYSTEM_EXEMPT_PACKAGES = new HashSet<>(Arrays.asList(
        "android",
        "com.android.systemui",
        "com.android.settings",
        "com.google.android.packageinstaller",
        "com.android.packageinstaller",
        "com.android.permissioncontroller",
        "com.google.android.permissioncontroller",
        "com.google.android.inputmethod.latin",
        "com.samsung.android.honeyboard",
        "com.android.inputmethod.latin"
    ));

    private boolean isExemptSystemOrLauncherPackage(String pkg) {
        if (pkg == null || pkg.isEmpty() || pkg.equals(getPackageName())) return true;
        if (isSensitiveVaultOrBankingPackage(pkg)) return true;
        if (STATIC_SYSTEM_EXEMPT_PACKAGES.contains(pkg)) {
            return true;
        }
        try {
            String defaultIme = Settings.Secure.getString(getContentResolver(), Settings.Secure.DEFAULT_INPUT_METHOD);
            if (defaultIme != null && defaultIme.startsWith(pkg + "/")) {
                return true;
            }
        } catch (Exception ignored) {
        }
        try {
            PackageManager pm = getPackageManager();
            if (pm != null) {
                Intent homeIntent = new Intent(Intent.ACTION_MAIN);
                homeIntent.addCategory(Intent.CATEGORY_HOME);
                ResolveInfo defaultHome = pm.resolveActivity(homeIntent, PackageManager.MATCH_DEFAULT_ONLY);
                if (defaultHome != null && defaultHome.activityInfo != null
                        && pkg.equals(defaultHome.activityInfo.packageName)) {
                    return true;
                }
                List<ResolveInfo> homeList = pm.queryIntentActivities(homeIntent, PackageManager.MATCH_DEFAULT_ONLY);
                if (homeList != null) {
                    for (ResolveInfo ri : homeList) {
                        if (ri != null && ri.activityInfo != null && pkg.equals(ri.activityInfo.packageName)) {
                            return true;
                        }
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return false;
    }

    private String resolveFriendlyAppLabel(String pkg) {
        if ("com.instagram.android".equals(pkg)) return "Instagram";
        if ("com.google.android.youtube".equals(pkg)) return "YouTube";
        if ("com.zhiliaoapp.musically".equals(pkg) || "com.ss.android.ugc.trill".equals(pkg)) return "TikTok";
        if ("com.facebook.katana".equals(pkg)) return "Facebook";
        if ("com.facebook.lite".equals(pkg)) return "FB Lite";
        if ("com.facebook.orca".equals(pkg)) return "Messenger";
        if ("com.whatsapp".equals(pkg)) return "WhatsApp";
        if ("com.whatsapp.w4b".equals(pkg)) return "WhatsApp Business";
        if ("com.snapchat.android".equals(pkg)) return "Snapchat";
        if ("com.twitter.android".equals(pkg)) return "X";
        if ("com.reddit.frontpage".equals(pkg)) return "Reddit";
        if (pkg != null && !pkg.isEmpty()) {
            try {
                PackageManager pm = getPackageManager();
                if (pm != null) {
                    ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
                    CharSequence label = pm.getApplicationLabel(ai);
                    if (label != null && label.length() > 0) {
                        return label.toString();
                    }
                }
            } catch (Exception ignored) {
            }
        }
        return pkg != null ? pkg : "App";
    }

    private void checkAndEnforceAppTimerIfNeeded(String packageName) {
        if (packageName == null || packageName.isEmpty() || isExemptSystemOrLauncherPackage(packageName)) {
            return;
        }
        try {
            SharedPreferences prefs = getSharedPreferences("screensync_wellness_store", MODE_PRIVATE);
            String syncedJson = prefs.getString("synced_timers_and_focus_json", "{}");
            if (syncedJson == null || syncedJson.isEmpty()) return;
            org.json.JSONObject root = cachedSyncedTimersRoot;
            if (root == null || !syncedJson.equals(cachedSyncedTimersJson)) {
                root = new org.json.JSONObject(syncedJson);
                cachedSyncedTimersJson = syncedJson;
                cachedSyncedTimersRoot = root;
            }
            org.json.JSONObject appTimers = root.optJSONObject("appTimers");
            if (appTimers == null) return;

            String normKey = packageName;
            if ("com.instagram.android".equals(packageName)) normKey = "instagram";
            else if ("com.google.android.youtube".equals(packageName)) normKey = "youtube";
            else if ("com.zhiliaoapp.musically".equals(packageName) || "com.ss.android.ugc.trill".equals(packageName)) normKey = "tiktok";
            else if ("com.facebook.katana".equals(packageName)) normKey = "facebook";
            else if ("com.facebook.lite".equals(packageName)) normKey = "fblite";
            else if ("com.facebook.orca".equals(packageName)) normKey = "messenger";
            else if ("com.whatsapp".equals(packageName)) normKey = "whatsapp";
            else if ("com.whatsapp.w4b".equals(packageName)) normKey = "whatsapp_business";
            else if ("com.snapchat.android".equals(packageName)) normKey = "snapchat";
            else if ("com.twitter.android".equals(packageName)) normKey = "x";
            else if ("com.reddit.frontpage".equals(packageName)) normKey = "reddit";
            else if ("com.android.chrome".equals(packageName)) normKey = "chrome";
            else if ("com.anthropic.claude".equals(packageName)) normKey = "claude";
            else if ("com.google.android.googlequicksearchbox".equals(packageName)) normKey = "google";

            org.json.JSONObject timerEntry = appTimers.optJSONObject(normKey);
            if (timerEntry == null) {
                timerEntry = appTimers.optJSONObject(packageName);
            }
            if (timerEntry == null) {
                Iterator<String> keys = appTimers.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    if (k == null) continue;
                    org.json.JSONObject candidate = appTimers.optJSONObject(k);
                    if (candidate == null) continue;
                    org.json.JSONArray pkgsArr = candidate.optJSONArray("packages");
                    if (pkgsArr != null) {
                        for (int pi = 0; pi < pkgsArr.length(); pi++) {
                            String exactPkg = pkgsArr.optString(pi, "");
                            if (packageName.equalsIgnoreCase(exactPkg)) {
                                timerEntry = candidate;
                                break;
                            }
                        }
                    }
                    if (timerEntry != null) break;
                }
            }
            if (timerEntry == null) return;

            int limitMinutes = timerEntry.optInt("minutes", 0);
            if (limitMinutes <= 0) return;

            String scheduleStr = timerEntry.optString("schedule", "Everyday");
            java.util.Calendar schedCal = java.util.Calendar.getInstance();
            int dow = schedCal.get(java.util.Calendar.DAY_OF_WEEK);
            if (scheduleStr != null && !scheduleStr.isEmpty() && !"Everyday".equalsIgnoreCase(scheduleStr)) {
                boolean isWeekend = (dow == java.util.Calendar.SATURDAY || dow == java.util.Calendar.SUNDAY);
                String normSched = scheduleStr.toLowerCase(java.util.Locale.US).replace('–', '-').replace('—', '-');
                if ((normSched.contains("monday-friday") || normSched.contains("weekdays")) && isWeekend) return;
                if ((normSched.contains("saturday-sunday") || normSched.contains("weekends")) && !isWeekend) return;
            }
            if (!AppTimerPolicy.isScheduleActiveOnDayOfWeek(scheduleStr, dow)) {
                return;
            }

            long usedMs = 0L;
            try {
                android.app.usage.UsageStatsManager usm = (android.app.usage.UsageStatsManager) getSystemService(Context.USAGE_STATS_SERVICE);
                if (usm != null) {
                    java.util.Calendar cal = java.util.Calendar.getInstance();
                    cal.set(java.util.Calendar.HOUR_OF_DAY, 0);
                    cal.set(java.util.Calendar.MINUTE, 0);
                    cal.set(java.util.Calendar.SECOND, 0);
                    cal.set(java.util.Calendar.MILLISECOND, 0);
                    long startDayMs = cal.getTimeInMillis();
                    long wallNowMs = System.currentTimeMillis();
                    Map<String, android.app.usage.UsageStats> agg = usm.queryAndAggregateUsageStats(startDayMs, wallNowMs);
                    if (agg != null && agg.containsKey(packageName)) {
                        android.app.usage.UsageStats st = agg.get(packageName);
                        if (st != null) {
                            usedMs = Math.max(usedMs, st.getTotalTimeInForeground());
                        }
                    }
                }
            } catch (Exception ignored) {
            }

            Long trackedWatchMs = watchDurationByPackageMs.get(packageName);
            if (trackedWatchMs != null && trackedWatchMs > usedMs) {
                usedMs = trackedWatchMs;
            }

            if (AppTimerPolicy.shouldEnforceTimerBlock(usedMs, limitMinutes, scheduleStr, dow, false)) {
                new AppTimerSuspensionManager(this).suspendPackageForExpiredTimer(packageName);
                long nowElapsed = SystemClock.elapsedRealtime();
                Long lastHome = lastHomeActionTimeByPkg.get(packageName);
                if (AppTimerPolicy.shouldPerformHomeIntercept(nowElapsed, lastHome != null ? lastHome : 0L)) {
                    lastHomeActionTimeByPkg.put(packageName, nowElapsed);
                    performGlobalAction(GLOBAL_ACTION_HOME);
                }
                Long lastAlert = lastTimerAlertTimeByPkg.get(packageName);
                if (AppTimerPolicy.shouldShowTimerOverlayBanner(nowElapsed, lastAlert != null ? lastAlert : 0L)) {
                    lastTimerAlertTimeByPkg.put(packageName, nowElapsed);
                    String appLabel = resolveFriendlyAppLabel(packageName);
                    showTransientGoalAlertOverlay("App Timer Limit Reached", appLabel + " daily timer reached.", 5000);
                }
            }
        } catch (Exception ignored) {
        }
    }

    public void enforceAppTimerBlockFromBridge(String packageName, String appLabel, int limitMinutes) {
        if (packageName == null || packageName.isEmpty() || isExemptSystemOrLauncherPackage(packageName)) {
            return;
        }
        try {
            new AppTimerSuspensionManager(this).suspendPackageForExpiredTimer(packageName);
            if (packageName.equals(activePackage)) {
                performGlobalAction(GLOBAL_ACTION_HOME);
            }
            String resolvedLabel = (appLabel != null && !appLabel.trim().isEmpty())
                ? appLabel.trim()
                : resolveFriendlyAppLabel(packageName);
            String msg = limitMinutes > 0
                ? (resolvedLabel + " daily timer (" + limitMinutes + "m) reached.")
                : (resolvedLabel + " daily timer reached.");
            showTransientGoalAlertOverlay("App Timer Limit Reached", msg, 5000);
        } catch (Exception ignored) {
        }
    }

    private boolean isDistractingFocusPackage(String pkg, org.json.JSONObject obj) {
        if (pkg == null || pkg.isEmpty()) return false;
        if (obj != null) {
            org.json.JSONArray allowedArr = obj.optJSONArray("allowedPackages");
            if (allowedArr != null) {
                for (int i = 0; i < allowedArr.length(); i++) {
                    if (pkg.equalsIgnoreCase(allowedArr.optString(i, ""))) return false;
                }
            }
            org.json.JSONArray distArr = obj.optJSONArray("distractingPackages");
            if (distArr != null && distArr.length() > 0) {
                for (int i = 0; i < distArr.length(); i++) {
                    if (pkg.equalsIgnoreCase(distArr.optString(i, ""))) return true;
                }
                return false;
            }
        }
        return SUPPORTED_PACKAGES.contains(pkg) && (!BROWSER_PACKAGES.contains(pkg) || isBrowserShortFormActive);
    }

    private void enforceFocusDistractionGuardAndAppTimers(String pkg, long nowMs) {
        if (pkg == null || isExemptSystemOrLauncherPackage(pkg)) return;
        checkAndEnforceAppTimerIfNeeded(pkg);
        try {
            SharedPreferences prefs = getSharedPreferences("screensync_wellness_store", MODE_PRIVATE);
            String syncedJson = prefs.getString("synced_timers_and_focus_json", "{}");
            if (syncedJson == null || syncedJson.isEmpty()) return;
            org.json.JSONObject obj = new org.json.JSONObject(syncedJson);
            boolean focusActive = obj.optBoolean("focusActive", false);
            boolean distractionGuard = obj.optBoolean("distractionGuard", false);
            long focusEndAtMs = obj.optLong("focusEndAtMs", 0L);
            boolean isPaused = obj.has("focusPausedAtMs") && !obj.isNull("focusPausedAtMs") && obj.optLong("focusPausedAtMs", 0L) > 0L;
            if (focusActive && focusEndAtMs > 0L && System.currentTimeMillis() >= focusEndAtMs) {
                focusActive = false;
                obj.put("focusActive", false);
                prefs.edit().putString("synced_timers_and_focus_json", obj.toString()).apply();
            }
            if (focusActive && !isPaused && distractionGuard) {
                if (!isDistractingFocusPackage(pkg, obj)) return;
                org.json.JSONArray overrideArr = obj.optJSONArray("sessionOverridePackages");
                if (overrideArr != null) {
                    String friendlyLower = resolveFriendlyAppLabel(pkg).toLowerCase(Locale.US);
                    String pkgLower = pkg.toLowerCase(Locale.US);
                    for (int i = 0; i < overrideArr.length(); i++) {
                        String ov = overrideArr.optString(i, "").trim().toLowerCase(Locale.US);
                        if (!ov.isEmpty() && (pkgLower.equals(ov) || friendlyLower.equals(ov) || pkgLower.contains(ov))) return;
                    }
                }
                String enforcementLevel = obj.optString("enforcementLevel", "WARN");
                if ("BLOCK".equalsIgnoreCase(enforcementLevel)) {
                    performGlobalAction(GLOBAL_ACTION_HOME);
                }
                Long lastAlert = lastDistractionAlertByPkg.get(pkg);
                if (lastAlert == null || (nowMs - lastAlert) >= DISTRACTION_COOLDOWN_MS) {
                    lastDistractionAlertByPkg.put(pkg, nowMs);
                    String appLabel = resolveFriendlyAppLabel(pkg);
                    if (appLabel == null || appLabel.trim().isEmpty()) {
                        showTransientGoalAlertOverlay("Focus Mode Active", "Stay focused! Put away this app to complete your session.", 5000L);
                    } else {
                        showTransientGoalAlertOverlay("Focus Mode Active", "Stay focused! Put away " + appLabel + " to complete your session.", 5000L);
                    }
                }
            }
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onInterrupt() {
        flushWatchDelta(SystemClock.elapsedRealtime());
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (newConfig != null && newConfig.orientation == Configuration.ORIENTATION_LANDSCAPE) {
            hideDynamicIslandOverlay();
        } else if (isWatchingState(state)) {
            showOrUpdateDynamicIslandOverlay();
        }
    }

    private void cleanupOverlayAndReceiver() {
        if (isScreenReceiverRegistered) {
            try {
                unregisterReceiver(screenStateReceiver);
            } catch (Exception ignored) {
            }
            isScreenReceiverRegistered = false;
        }
        handler.post(() -> {
            try {
                if (isOverlayAttached && windowManager != null && overlayIslandView != null) {
                    windowManager.removeView(overlayIslandView);
                    isOverlayAttached = false;
                }
                removeTransientGoalAlertOverlay();
            } catch (Exception ignored) {
            }
        });
    }

    @Override
    public boolean onUnbind(Intent intent) {
        if (activeInstance == this) {
            activeInstance = null;
        }
        try {
            getSharedPreferences(PREF_SCREENSYNC, Context.MODE_PRIVATE)
                .edit()
                .putLong("accessibility_last_unbind_ms", System.currentTimeMillis())
                .putBoolean("accessibility_service_bound", false)
                .apply();
        } catch (Exception ignored) {
        }
        hideDynamicIslandOverlay();
        cleanupOverlayAndReceiver();
        return super.onUnbind(intent);
    }

    @Override
    public void onDestroy() {
        if (activeInstance == this) {
            activeInstance = null;
        }
        hideDynamicIslandOverlay();
        cleanupOverlayAndReceiver();
        super.onDestroy();
    }

    private void evaluateSettledCandidate() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null || activePackage == null) return;
        try {
            DisplayMetrics dm = getResources().getDisplayMetrics();
            String sig = extractReelSignature(root, activePackage, candidateScrollIdx, dm.widthPixels, dm.heightPixels);
            if (sig == null || sig.equals(candidateSignature)) {
                return;
            }
            long now = SystemClock.elapsedRealtime();
            if (candidateSignature != null && candidateEnteredElapsedMs > 0L) {
                long prevDwell = accumulatedCandidateDwellMs + Math.max(0L, now - candidateEnteredElapsedMs);
                if (state == State.REEL_CANDIDATE && prevDwell < MIN_REEL_DWELL_MS) {
                    incrementPersistedFlickCount(activePackage);
                } else if (state == State.REEL_COUNTED && prevDwell >= MIN_REEL_DWELL_MS && prevDwell < FAST_SKIP_MAX_MS) {
                    incrementPersistedFastSkipCount(activePackage);
                }
            }
            flushWatchDelta(now);
            candidateSignature = sig;
            candidateEnteredElapsedMs = now;
            accumulatedCandidateDwellMs = 0L;
            lastTickElapsedMs = now;
            transitionTo(State.REEL_CANDIDATE, now);
            handler.removeCallbacks(dwellRunnable);
            handler.postDelayed(dwellRunnable, MIN_REEL_DWELL_MS);
        } finally {
            root.recycle();
        }
    }

    private boolean idleTailClampedForCurrentSession = false;
    private String lastActiveCountedSignature = "";
    private final Map<String, Integer> interveningCountsBySignature = new ConcurrentHashMap<>();

    private void commitCandidateIfEligible() {
        if (state != State.REEL_CANDIDATE || candidateSignature == null || activePackage == null) return;
        long now = SystemClock.elapsedRealtime();
        long totalDwell = accumulatedCandidateDwellMs + Math.max(0L, now - candidateEnteredElapsedMs);
        if (totalDwell < MIN_REEL_DWELL_MS) return;

        LinkedHashMap<String, Long> pkgCache = getPackageLru(activePackage);
        Long seenAt = pkgCache.get(candidateSignature);
        boolean inTtlLru = (seenAt != null && (now - seenAt) <= LRU_TTL_MS);
        int interveningDistinct = interveningCountsBySignature.getOrDefault(candidateSignature, 0);
        boolean isSameItemReplay = candidateSignature.equals(lastActiveCountedSignature) && interveningDistinct == 0;
        boolean hasDistinctScrollIndexRevisit = (candidateScrollIdx >= 0 && candidateScrollIdx != lastCountedScrollIdx && lastCommittedSignature != null && !candidateSignature.equals(lastCommittedSignature));
        boolean shouldCount = !isSameItemReplay && (!inTtlLru || interveningDistinct >= 1 || hasDistinctScrollIndexRevisit);

        String direction = (candidateScrollIdx >= 0 && lastCountedScrollIdx >= 0 && candidateScrollIdx < lastCountedScrollIdx)
            ? "BACKWARD"
            : "FORWARD";

        if (shouldCount) {
            pkgCache.put(candidateSignature, now);
            for (String k : new HashSet<>(interveningCountsBySignature.keySet())) {
                if (!k.equals(candidateSignature)) {
                    interveningCountsBySignature.put(k, interveningCountsBySignature.getOrDefault(k, 0) + 1);
                }
            }
            interveningCountsBySignature.put(candidateSignature, 0);
            lastActiveCountedSignature = candidateSignature;
            lastCommittedSignature = candidateSignature;
            if (candidateScrollIdx >= 0) {
                lastCountedScrollIdx = candidateScrollIdx;
            }
            incrementPersistedReelCount(activePackage, candidateSignature, direction, (int) Math.round(totalDwell / 1000.0));
        } else if (inTtlLru) {
            pkgCache.put(candidateSignature, now);
        }
        transitionTo(State.REEL_COUNTED, now);
    }

    private void onHeartbeatTick() {
        long now = SystemClock.elapsedRealtime();
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            boolean interactive = pm == null || pm.isInteractive();
            boolean locked = km != null && km.isKeyguardLocked();
            if (!interactive || locked) {
                flushWatchDelta(now);
                transitionTo(State.PAUSED_SYSTEM, now);
                hideDynamicIslandOverlay();
                return;
            }
            AccessibilityNodeInfo root = getRootInActiveWindow();
            if (root != null) {
                try {
                    String rootPkg = root.getPackageName() != null ? root.getPackageName().toString() : "";
                    if (rootPkg.equals(getPackageName())) {
                        flushWatchDelta(now);
                        transitionTo(State.INACTIVE, now);
                        hideDynamicIslandOverlay();
                        return;
                    }
                    if (!"com.android.systemui".equals(rootPkg)) {
                        DisplayMetrics dm = getResources().getDisplayMetrics();
                        if (!SUPPORTED_PACKAGES.contains(rootPkg) || !isShortFormSurfaceActive(root, rootPkg, dm.widthPixels, dm.heightPixels)) {
                            flushWatchDelta(now);
                            transitionTo(State.INACTIVE, now);
                            hideDynamicIslandOverlay();
                            return;
                        }
                    }
                } finally {
                    root.recycle();
                }
            }
        } catch (Exception ignored) {
        }
        flushWatchDelta(now);
        if (activePackage != null && !activePackage.isEmpty()) {
            checkAndEnforceAppTimerIfNeeded(activePackage);
        }
    }

    private void flushWatchDelta(long nowElapsedMs) {
        if (state != State.REEL_COUNTED || lastTickElapsedMs <= 0L) {
            lastTickElapsedMs = nowElapsedMs;
            return;
        }
        long deltaMs = nowElapsedMs - lastTickElapsedMs;
        lastTickElapsedMs = nowElapsedMs;
        if (deltaMs <= 0L) return;

        long timeSinceInteraction = nowElapsedMs - lastUserInteractionElapsedMs;
        if (timeSinceInteraction > MAX_IDLE_GAP_MS) {
            if (isIdleClamped || idleTailClampedForCurrentSession) {
                return; // Pause watch-time accumulation after 30s idle tail has been clamped to 5s
            }
            isIdleClamped = true;
            idleTailClampedForCurrentSession = true;
            deltaMs = Math.min(deltaMs, IDLE_CLAMP_CREDIT_MS);
        } else if (deltaMs > MAX_IDLE_GAP_MS) {
            deltaMs = IDLE_CLAMP_CREDIT_MS;
        }
        addPersistedWatchDurationMs(deltaMs);
    }

    private void transitionTo(State next, long nowElapsedMs) {
        boolean wasWatching = isWatchingState(state);
        state = next;
        currentState = next;
        if (isWatchingState(next)) {
            lastTickElapsedMs = nowElapsedMs;
            handler.removeCallbacks(heartbeatRunnable);
            handler.postDelayed(heartbeatRunnable, HEARTBEAT_TICK_MS);
            showOrUpdateDynamicIslandOverlay();
        } else {
            handler.removeCallbacks(heartbeatRunnable);
            handler.removeCallbacks(dwellRunnable);
            handler.removeCallbacks(settleRunnable);
            if (wasWatching && next != State.PAUSED_OVERLAY) {
                consecutiveReelsInSession = 0;
                MainActivity active = MainActivity.getActiveInstance();
                if (active != null && activePackage != null) {
                    active.dispatchAccessibilityContextUpdate(activePackage, "FEED_BROWSE", false);
                }
            }
            // CRITICAL RULE: Immediately hide Dynamic Island whenever NOT actively watching a Reel/Short/Story!
            hideDynamicIslandOverlay();
        }
    }

    private boolean isWatchingState(State s) {
        return s == State.SURFACE_ACTIVE || s == State.REEL_CANDIDATE || s == State.REEL_COUNTED;
    }

    private LinkedHashMap<String, Long> getPackageLru(String pkg) {
        LinkedHashMap<String, Long> cache = lruByPackage.get(pkg);
        if (cache == null) {
            cache = new LinkedHashMap<String, Long>(RECENT_SIGNATURE_LRU_SIZE + 4, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, Long> eldest) {
                    return size() > RECENT_SIGNATURE_LRU_SIZE;
                }
            };
            lruByPackage.put(pkg, cache);
        }
        return cache;
    }

    private boolean isBrowserShortFormActive(AccessibilityNodeInfo root, int screenW, int screenH) {
        ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        boolean hasUrlMatch = false;
        boolean hasWebShortFormMarker = false;
        boolean hasFullScreenWebPlayer = false;
        Rect bounds = new Rect();

        int visitedNodes = 0;
        while (!queue.isEmpty() && visitedNodes++ < 120) {
            AccessibilityNodeInfo node = queue.poll();
            if (node == null) continue;
            if (node.isPassword() == true) {
                return false;
            }
            if (!node.isVisibleToUser()) continue;
            String viewId = node.getViewIdResourceName() != null ? node.getViewIdResourceName().toLowerCase(Locale.US) : "";
            String txt = ((node.getText() != null ? node.getText().toString() : "") + " " +
                          (node.getContentDescription() != null ? node.getContentDescription().toString() : "")).trim();
            if (!txt.isEmpty()) {
                if (BROWSER_SHORT_FORM_URL_REGEX.matcher(txt).find()) {
                    hasUrlMatch = true;
                }
                String lower = txt.toLowerCase(Locale.US);
                if ((viewId.contains("url") || viewId.contains("location_bar") || viewId.contains("omnibox") || viewId.contains("address"))
                        && !BROWSER_SHORT_FORM_URL_REGEX.matcher(lower).find()
                        && (lower.contains(".com") || lower.contains("http") || lower.contains("www."))) {
                    // Browser URL bar is visible and points to a non-reel webpage -> NOT watching a reel/short/story!
                    return false;
                }
                if (lower.contains("#shorts") || lower.contains("reels") || lower.contains("original audio") || lower.contains("for you")) {
                    hasWebShortFormMarker = true;
                }
            }
            node.getBoundsInScreen(bounds);
            if (bounds.width() >= screenW * 0.85f && bounds.height() >= screenH * 0.70f) {
                hasFullScreenWebPlayer = true;
            }
            int count = node.getChildCount();
            for (int i = 0; i < count; i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) queue.add(child);
            }
        }
        return hasUrlMatch || (hasFullScreenWebPlayer && hasWebShortFormMarker);
    }

    public String resolveEffectiveShortFormPackage(AccessibilityNodeInfo root, String rawPkg) {
        if (rawPkg == null || !BROWSER_PACKAGES.contains(rawPkg) || root == null) {
            return rawPkg;
        }
        ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        int visitedNodes = 0;
        String fallbackMarkerPkg = null;
        while (!queue.isEmpty() && visitedNodes++ < 120) {
            AccessibilityNodeInfo node = queue.poll();
            if (node == null) continue;
            if (node.isPassword() == true) {
                return rawPkg;
            }
            if (!node.isVisibleToUser()) continue;
            String txt = ((node.getText() != null ? node.getText().toString() : "") + " " +
                          (node.getContentDescription() != null ? node.getContentDescription().toString() : "")).toLowerCase(Locale.US);
            if (!txt.isEmpty()) {
                if (txt.contains("youtube.com/shorts") || txt.contains("youtu.be/shorts")) return "com.google.android.youtube";
                if (txt.contains("instagram.com/reel") || txt.contains("instagram.com/stories") || txt.contains("instagram.com/@")) return "com.instagram.android";
                if (txt.contains("tiktok.com/") || txt.contains("vm.tiktok.com/")) return "com.zhiliaoapp.musically";
                if (txt.contains("facebook.com/reel") || txt.contains("facebook.com/stories") || txt.contains("fb.com/reel") || txt.contains("fb.watch/")) return "com.facebook.katana";
                if (txt.contains("messenger.com/stories")) return "com.facebook.orca";
                if (txt.contains("snapchat.com/spotlight") || txt.contains("snapchat.com/stories") || txt.contains("snapchat.com/s/")) return "com.snapchat.android";
                if (txt.contains("x.com/") || txt.contains("twitter.com/")) return "com.twitter.android";
                if (txt.contains("reddit.com/")) return "com.reddit.frontpage";
                if (fallbackMarkerPkg == null) {
                    if (txt.contains("#shorts") || txt.contains("youtube shorts")) fallbackMarkerPkg = "com.google.android.youtube";
                    else if (txt.contains("reels") || txt.contains("original audio")) fallbackMarkerPkg = "com.instagram.android";
                    else if (txt.contains("for you") || txt.contains("tiktok")) fallbackMarkerPkg = "com.zhiliaoapp.musically";
                    else if (txt.contains("spotlight")) fallbackMarkerPkg = "com.snapchat.android";
                }
            }
            int count = node.getChildCount();
            for (int i = 0; i < count; i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) queue.add(child);
            }
        }
        return fallbackMarkerPkg != null ? fallbackMarkerPkg : rawPkg;
    }

    public String resolveBrowserShortFormTargetPackage(AccessibilityNodeInfo root, String browserPkg) {
        return resolveEffectiveShortFormPackage(root, browserPkg);
    }

    private boolean isShortFormSurfaceActive(AccessibilityNodeInfo root, String pkg, int screenW, int screenH) {
        if (BROWSER_PACKAGES.contains(pkg)) {
            return isBrowserShortFormActive(root, screenW, screenH);
        }
        Set<String> tier1 = TIER1_VIEW_IDS.get(pkg);
        ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        boolean hasFullViewportVerticalPager = false;
        boolean hasPositiveMarker = false;
        boolean hasNegativeMarker = false;
        Rect bounds = new Rect();

        int visitedNodes = 0;
        while (!queue.isEmpty() && visitedNodes++ < 120) {
            AccessibilityNodeInfo node = queue.poll();
            if (node == null) continue;
            if (node.isPassword() == true) {
                return false;
            }
            if (!node.isVisibleToUser()) continue;

            String viewId = node.getViewIdResourceName();
            if (viewId != null && tier1 != null && tier1.contains(viewId)) {
                return true;
            }

            CharSequence cls = node.getClassName();
            String clsName = cls != null ? cls.toString() : "";
            node.getBoundsInScreen(bounds);

            if ((clsName.contains("ViewPager") || clsName.contains("RecyclerView")) && node.isScrollable()) {
                if (bounds.width() >= screenW * 0.85f && bounds.height() >= screenH * 0.75f) {
                    hasFullViewportVerticalPager = true;
                }
            }

            String text = ((node.getText() != null ? node.getText().toString() : "") + " " +
                           (node.getContentDescription() != null ? node.getContentDescription().toString() : "")).toLowerCase(Locale.US);
            if (text.contains("reels") || text.contains("shorts") || text.contains("for you") || text.contains("original audio")
                    || text.contains("story") || text.contains("stories") || text.contains("status") || text.contains("spotlight")) {
                hasPositiveMarker = true;
            }
            if ((text.contains("direct") || text.contains("messages") || text.contains("settings")
                    || text.contains("search") || text.contains("explore") || text.contains("notifications") || text.contains("chats"))
                    && bounds.top < screenH * 0.2f) {
                hasNegativeMarker = true;
            }

            int count = node.getChildCount();
            for (int i = 0; i < count; i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) queue.add(child);
            }
        }
        return hasFullViewportVerticalPager && hasPositiveMarker && !hasNegativeMarker;
    }

    private boolean hasBlockingOverlaySheet(AccessibilityNodeInfo root, int screenH) {
        ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        Rect bounds = new Rect();
        int visitedNodes = 0;
        while (!queue.isEmpty() && visitedNodes++ < 120) {
            AccessibilityNodeInfo node = queue.poll();
            if (node == null) continue;
            if (node.isPassword() == true) {
                return false;
            }
            if (!node.isVisibleToUser()) continue;
            String viewId = node.getViewIdResourceName();
            if (viewId != null) {
                String lowerId = viewId.toLowerCase(Locale.US);
                if (lowerId.contains("comment") || lowerId.contains("bottom_sheet") || lowerId.contains("share_sheet")
                        || lowerId.contains("reply_sheet") || lowerId.contains("engagement_panel")) {
                    node.getBoundsInScreen(bounds);
                    if (bounds.height() >= screenH * 0.35f) {
                        return true;
                    }
                }
            }
            CharSequence desc = node.getContentDescription();
            if (desc != null) {
                String lowerDesc = desc.toString().toLowerCase(Locale.US);
                if (lowerDesc.contains("comments") || lowerDesc.contains("add a comment") || lowerDesc.contains("share to")) {
                    node.getBoundsInScreen(bounds);
                    if (bounds.height() >= screenH * 0.35f && bounds.top >= screenH * 0.15f) {
                        return true;
                    }
                }
            }
            int count = node.getChildCount();
            for (int i = 0; i < count; i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) queue.add(child);
            }
        }
        return false;
    }

    private String extractReelSignature(AccessibilityNodeInfo root, String pkg, int scrollIdx, int screenW, int screenH) {
        ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        Rect bounds = new Rect();
        String authorOrDesc = "";
        String audioOrCaption = "";

        int visitedNodes = 0;
        while (!queue.isEmpty() && visitedNodes++ < 120) {
            AccessibilityNodeInfo node = queue.poll();
            if (node == null || !node.isVisibleToUser()) continue;
            if (node.isPassword() == true) {
                // CAT11-22: Immediately abort entire tree scan if any visible password field is present in window
                return null;
            }
            node.getBoundsInScreen(bounds);
            int cy = bounds.centerY();
            if (cy >= screenH * 0.15f && cy <= screenH * 0.90f) {
                String raw = node.getText() != null ? node.getText().toString().trim()
                    : (node.getContentDescription() != null ? node.getContentDescription().toString().trim() : "");
                if (!raw.isEmpty() && !VOLATILE_METRIC_REGEX.matcher(raw).matches()) {
                    String stripped = INLINE_NUMBERS_REGEX.matcher(raw.toLowerCase(Locale.US)).replaceAll("#");
                    String norm = stripped.replaceAll("\\s+", " ").trim();
                    if (norm.length() > 64) norm = norm.substring(0, 64);
                    if (!norm.isEmpty() && !norm.equals("#")) {
                        String hashedToken = hashSignatureToken(norm);
                        if (authorOrDesc.isEmpty()) authorOrDesc = hashedToken;
                        else if (audioOrCaption.isEmpty() && !hashedToken.equals(authorOrDesc)) audioOrCaption = hashedToken;
                    }
                }
            }
            int count = node.getChildCount();
            for (int i = 0; i < count; i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) queue.add(child);
            }
        }
        if (authorOrDesc.isEmpty() && audioOrCaption.isEmpty()) {
            int stableRowIndex = scrollIdx >= 0 ? scrollIdx : -1;
            return pkg + "|TIER_C_CANVAS|INDEX_FALLBACK|" + stableRowIndex;
        }
        return pkg + "|REEL|" + authorOrDesc + "|" + audioOrCaption;
    }

    private void incrementPersistedFlickCount(String pkg) {
        SharedPreferences prefs = getSharedPreferences(PREF_SCREENSYNC, MODE_PRIVATE);
        ensureTodayKey(prefs);
        prefs.edit()
            .putInt("daily_flick_count", prefs.getInt("daily_flick_count", 0) + 1)
            .putInt("pkg_flick_" + pkg, prefs.getInt("pkg_flick_" + pkg, 0) + 1)
            .apply();
    }

    private void incrementPersistedFastSkipCount(String pkg) {
        SharedPreferences prefs = getSharedPreferences(PREF_SCREENSYNC, MODE_PRIVATE);
        ensureTodayKey(prefs);
        prefs.edit()
            .putInt("daily_fast_skip_count", prefs.getInt("daily_fast_skip_count", 0) + 1)
            .putInt("pkg_fast_skip_" + pkg, prefs.getInt("pkg_fast_skip_" + pkg, 0) + 1)
            .apply();
    }

    private void incrementPersistedReelCount(String pkg) {
        incrementPersistedReelCount(pkg, candidateSignature != null ? candidateSignature : "", "FORWARD", 2);
    }

    private void incrementPersistedReelCount(String pkg, String fingerprint, String direction, int watchSeconds) {
        SharedPreferences prefs = getSharedPreferences(PREF_SCREENSYNC, MODE_PRIVATE);
        ensureTodayKey(prefs);
        int nextTotal = prefs.getInt("daily_reel_count", 0) + 1;
        int nextPkg = prefs.getInt("pkg_count_" + pkg, 0) + 1;
        prefs.edit()
            .putInt("daily_reel_count", nextTotal)
            .putInt("pkg_count_" + pkg, nextPkg)
            .apply();
        long nowWallMs = System.currentTimeMillis();
        String outboxEvId = "native_outbox_" + pkg + "_" + nowWallMs + "_" + nextTotal;
        try {
            String today = prefs.getString("current_day_key", new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date()));
            int hourOfDay = Integer.parseInt(new SimpleDateFormat("HH", Locale.US).format(new Date()));
            AppUsageDatabaseHelper dbHelper = new AppUsageDatabaseHelper(this);
            dbHelper.incrementHourlyReelBucket(today, hourOfDay, pkg, 1, 0L);
            dbHelper.appendReelOutboxEvent(outboxEvId, pkg, fingerprint, nowWallMs, Math.max(1, watchSeconds), direction != null ? direction : "FORWARD", "REEL_COUNTED");
        } catch (Exception ignored) {}
        MainActivity active = MainActivity.getActiveInstance();
        if (active != null) {
            String surface = "com.google.android.youtube".equals(pkg) ? "SHORT"
                : ("com.facebook.orca".equals(pkg) || "com.whatsapp".equals(pkg) || "com.whatsapp.w4b".equals(pkg)) ? "STORY"
                : ("com.zhiliaoapp.musically".equals(pkg) || "com.ss.android.ugc.trill".equals(pkg) || "com.tiktok.lite.go".equals(pkg)) ? "TIKTOK"
                : ("com.snapchat.android".equals(pkg)) ? "SPOTLIGHT"
                : "REEL";
            active.dispatchAccessibilityContextUpdate(pkg, surface, true, direction != null ? direction : "FORWARD", outboxEvId);
        }
        long nowElapsed = SystemClock.elapsedRealtime();
        if (lastReelCountedElapsedMs > 0L && (nowElapsed - lastReelCountedElapsedMs) > DETOX_MAX_GAP_MS) {
            consecutiveReelsInSession = 0;
        }
        lastReelCountedElapsedMs = nowElapsed;
        consecutiveReelsInSession += 1;
        boolean detoxEnabled = prefs.getBoolean("reel_detox_enabled", true);
        int threshold = Math.max(20, Math.min(30, prefs.getInt("reel_detox_threshold", 25)));
        if (consecutiveReelsInSession >= threshold) {
            consecutiveReelsInSession = 0;
            if (detoxEnabled) {
                showReelDetoxCooldownOverlay(pkg, threshold);
            }
        }
        if (nowElapsed - lastWidgetBroadcastElapsedMs >= 30_000L) {
            lastWidgetBroadcastElapsedMs = nowElapsed;
            ScreenSyncWidgetUpdater.updateAllWidgets(this);
        }
        showOrUpdateDynamicIslandOverlay();
        triggerOverlayPulseAnimation();
    }

    private void addPersistedWatchDurationMs(long deltaMs) {
        SharedPreferences prefs = getSharedPreferences(PREF_SCREENSYNC, MODE_PRIVATE);
        ensureTodayKey(prefs);
        long nextMs = prefs.getLong("daily_watch_duration_ms", 0L) + deltaMs;
        SharedPreferences.Editor editor = prefs.edit().putLong("daily_watch_duration_ms", nextMs);
        if (activePackage != null && !activePackage.isEmpty()) {
            long nextPkgMs = prefs.getLong("pkg_watch_ms_" + activePackage, 0L) + deltaMs;
            editor.putLong("pkg_watch_ms_" + activePackage, nextPkgMs);
            watchDurationByPackageMs.put(activePackage, nextPkgMs);
            try {
                String today = prefs.getString("current_day_key", new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date()));
                int hourOfDay = Integer.parseInt(new SimpleDateFormat("HH", Locale.US).format(new Date()));
                AppUsageDatabaseHelper dbHelper = new AppUsageDatabaseHelper(this);
                dbHelper.incrementHourlyReelBucket(today, hourOfDay, activePackage, 0, deltaMs);
            } catch (Exception ignored) {}
        }
        editor.apply();
        NativeGoalAlertEvaluator.evaluate(this, "WATCH_DELTA");
        java.util.Calendar qCal = java.util.Calendar.getInstance();
        int curMinsOfDay = qCal.get(java.util.Calendar.HOUR_OF_DAY) * 60 + qCal.get(java.util.Calendar.MINUTE);
        int qStartMins = AppTimerPolicy.parseHHMMToMinutes(prefs.getString("quiet_hours_start", "22:30"), 22 * 60 + 30);
        int qEndMins = AppTimerPolicy.parseHHMMToMinutes(prefs.getString("quiet_hours_end", "07:00"), 7 * 60);
        if (prefs.getBoolean("quiet_hours_enabled", true) && AppTimerPolicy.isWithinQuietHours(curMinsOfDay, qStartMins, qEndMins)) {
            continuousShortFormWatchMs += deltaMs;
        } else {
            continuousShortFormWatchMs = 0L;
        }
        if (activePackage != null && !activePackage.isEmpty()) {
            checkAndEnforceAppTimerIfNeeded(activePackage);
        }
        checkAndEnforceBedtimeWindDownIfNeeded(continuousShortFormWatchMs);
        ScreenSyncWidgetUpdater.updateAllWidgets(this);
        showOrUpdateDynamicIslandOverlay();
    }

    private void ensureTodayKey(SharedPreferences prefs) {
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        String saved = prefs.getString("current_day_key", "");
        if (!today.equals(saved)) {
            if (saved != null && !saved.isEmpty()) {
                try {
                    AppUsageDatabaseHelper dbHelper = new AppUsageDatabaseHelper(this);
                    for (String pkg : SUPPORTED_PACKAGES) {
                        int prevCount = prefs.getInt("pkg_count_" + pkg, 0);
                        long prevWatchMs = prefs.getLong("pkg_watch_ms_" + pkg, 0L);
                        if (prevCount > 0 || prevWatchMs > 0L) {
                            dbHelper.archiveDailyReelCounters(saved, pkg, prevCount, prevWatchMs);
                        }
                    }
                } catch (Exception ignored) {}
            }
            SharedPreferences.Editor ed = prefs.edit()
                .putString("current_day_key", today)
                .putInt("daily_reel_count", 0)
                .putInt("daily_flick_count", 0)
                .putInt("daily_fast_skip_count", 0)
                .putLong("daily_watch_duration_ms", 0L);
            for (String pkg : SUPPORTED_PACKAGES) {
                ed.remove("pkg_count_" + pkg);
                ed.remove("pkg_watch_ms_" + pkg);
                ed.remove("pkg_flick_" + pkg);
                ed.remove("pkg_fast_skip_" + pkg);
            }
            ed.apply();
            lruByPackage.clear();
            watchDurationByPackageMs.clear();
            consecutiveReelsInSession = 0;
            lastReelCountedElapsedMs = 0L;
            continuousShortFormWatchMs = 0L;
        }
    }

    private int dpToPx(int dp) {
        return Math.round(dp * getResources().getDisplayMetrics().density);
    }

    private void triggerOverlayPulseAnimation() {
        if (overlayIslandView == null) return;
        handler.post(() -> {
            try {
                overlayIslandView.animate()
                    .scaleX(1.07f).scaleY(1.07f).setDuration(90L)
                    .withEndAction(() -> {
                        if (overlayIslandView != null) {
                            overlayIslandView.animate().scaleX(1.0f).scaleY(1.0f).setDuration(90L).start();
                        }
                    }).start();
            } catch (Exception ignored) {
            }
        });
    }

    private int applyTopCenterCutoutAlignment() {
        int targetY = dpToPx(6); // Default top-center offset for Full-Screen (no cutout) & corner-cutout displays
        int dividerWidthPx = dpToPx(2);
        int dividerHeightPx = dpToPx(14);
        int dividerColor = Color.parseColor("#6638BDF8");
        int minPillHeightPx = dpToPx(30);

        try {
            if (windowManager != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                DisplayCutout dc = null;
                int screenW = getResources().getDisplayMetrics().widthPixels;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    WindowInsets insets = windowManager.getCurrentWindowMetrics().getWindowInsets();
                    dc = insets != null ? insets.getDisplayCutout() : null;
                    screenW = windowManager.getCurrentWindowMetrics().getBounds().width();
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    dc = windowManager.getDefaultDisplay().getCutout();
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && overlayIslandView != null) {
                    WindowInsets rootInsets = overlayIslandView.getRootWindowInsets();
                    if (rootInsets != null) {
                        dc = rootInsets.getDisplayCutout();
                    }
                }
                if (dc != null && !dc.getBoundingRects().isEmpty()) {
                    for (Rect r : dc.getBoundingRects()) {
                        boolean isTopEdge = r.top <= dpToPx(48);
                        boolean isCenteredHorizontally = Math.abs(r.centerX() - (screenW / 2)) <= (screenW * 0.18f);
                        if (isTopEdge && isCenteredHorizontally) {
                            if (r.top > 0 && r.height() <= dpToPx(40)) {
                                // Centered Punch-Hole or Pill Cutout: wrap pill symmetrically around the top-center cutout
                                targetY = Math.max(dpToPx(2), r.top - dpToPx(2));
                                minPillHeightPx = Math.max(dpToPx(30), r.height() + dpToPx(4));
                                dividerWidthPx = Math.max(dpToPx(22), r.width() + dpToPx(12));
                                dividerHeightPx = Math.max(dpToPx(14), r.height());
                                dividerColor = Color.TRANSPARENT;
                            } else {
                                // Centered Waterdrop / Notch Cutout: dock at top-center flush below/around cutout
                                targetY = Math.max(dpToPx(4), r.bottom + dpToPx(2));
                            }
                            break;
                        }
                    }
                }
            }
        } catch (Exception ignored) {
        }

        if (overlayIslandView != null) {
            overlayIslandView.setMinimumHeight(minPillHeightPx);
        }
        if (overlayDividerView != null) {
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dividerWidthPx, dividerHeightPx);
            lp.setMargins(dpToPx(10), 0, dpToPx(10), 0);
            overlayDividerView.setLayoutParams(lp);
            overlayDividerView.setBackgroundColor(dividerColor);
        }
        return targetY;
    }

    private void ensureOverlayViewCreated() {
        if (overlayIslandView != null) return;
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);

        overlayIslandView = new LinearLayout(this);
        overlayIslandView.setOrientation(LinearLayout.HORIZONTAL);
        overlayIslandView.setGravity(Gravity.CENTER_VERTICAL);
        int padH = dpToPx(16);
        int padV = dpToPx(6);
        overlayIslandView.setPadding(padH, padV, padH, padV);

        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor("#F0060F22"));
        bg.setCornerRadius(dpToPx(999));
        bg.setStroke(dpToPx(2), Color.parseColor("#38BDF8"));
        overlayIslandView.setBackground(bg);

        overlayReelsText = new TextView(this);
        overlayReelsText.setTextColor(Color.WHITE);
        overlayReelsText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        overlayReelsText.setTypeface(Typeface.DEFAULT_BOLD);
        overlayReelsText.setText("0 Reels");

        overlayBrainIconView = new TextView(this);
        overlayBrainIconView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        overlayBrainIconView.setPadding(dpToPx(5), 0, 0, 0);
        overlayBrainIconView.setText("🧠");
        overlayBrainIconView.setTextColor(Color.parseColor("#34F5A6"));

        View divider = new View(this);
        LinearLayout.LayoutParams divParams = new LinearLayout.LayoutParams(dpToPx(2), dpToPx(14));
        divParams.setMargins(dpToPx(10), 0, dpToPx(10), 0);
        divider.setLayoutParams(divParams);
        divider.setBackgroundColor(Color.parseColor("#6638BDF8"));
        overlayDividerView = divider;

        overlayWatchTimeText = new TextView(this);
        overlayWatchTimeText.setTextColor(Color.parseColor("#34F5A6"));
        overlayWatchTimeText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        overlayWatchTimeText.setTypeface(Typeface.DEFAULT_BOLD);
        overlayWatchTimeText.setText("0m");

        overlayIslandView.addView(overlayReelsText);
        overlayIslandView.addView(overlayBrainIconView);
        overlayIslandView.addView(divider);
        overlayIslandView.addView(overlayWatchTimeText);
    }

    public void showOrUpdateDynamicIslandOverlay() {
        if (getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE || isOverlaySnoozed()) {
            hideDynamicIslandOverlay();
            return;
        }
        handler.post(() -> {
            try {
                if (!isWatchingState(currentState) || isOverlaySnoozed()) {
                    hideDynamicIslandOverlay();
                    return;
                }
                ensureOverlayViewCreated();
                int targetY = applyTopCenterCutoutAlignment();
                SharedPreferences prefs = getSharedPreferences("screensync_wellness_store", MODE_PRIVATE);
                ensureTodayKey(prefs);
                int dailyReels = prefs.getInt("daily_reel_count", 0);
                int syncedWidgetReels = prefs.getInt("widget_reels_count", 0);
                int reels = Math.max(dailyReels, syncedWidgetReels);
                long watchMs = prefs.getLong("daily_watch_duration_ms", 0L);
                int syncedWidgetWatchMins = prefs.getInt("widget_reel_watch_mins", 0);
                long totalMins = Math.max((long) syncedWidgetWatchMins, Math.max(0L, Math.round(watchMs / 60000.0)));
                long hrs = totalMins / 60;
                long mins = totalMins % 60;
                String timeStr = hrs > 0 ? (hrs + "h " + mins + "m") : (mins + "m");

                overlayReelsText.setText(reels + (reels == 1 ? " Reel" : " Reels"));
                if (overlayBrainIconView != null) {
                    int stage = Math.min(10, Math.max(0, reels / 50));
                    String stageColor = stage >= 8 ? "#EF4444" : (stage >= 4 ? "#F59E0B" : "#34F5A6");
                    overlayBrainIconView.setTextColor(Color.parseColor(stageColor));
                    overlayBrainIconView.setText("🧠");
                }
                overlayWatchTimeText.setText(timeStr);

                int lockedFlags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                    | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                    | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                    | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS;

                if (!isOverlayAttached && windowManager != null) {
                    overlayParams = new WindowManager.LayoutParams(
                        WindowManager.LayoutParams.WRAP_CONTENT,
                        WindowManager.LayoutParams.WRAP_CONTENT,
                        WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                        lockedFlags,
                        PixelFormat.TRANSLUCENT
                    );
                    overlayParams.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
                    overlayParams.x = 0; // Strictly locked at horizontal center (never draggable)
                    overlayParams.y = targetY;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        overlayParams.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
                    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                        overlayParams.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                    }
                    try {
                        windowManager.addView(overlayIslandView, overlayParams);
                        isOverlayAttached = true;
                    } catch (Exception e1) {
                        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)) {
                            overlayParams.type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                                : WindowManager.LayoutParams.TYPE_PHONE;
                            windowManager.addView(overlayIslandView, overlayParams);
                            isOverlayAttached = true;
                        }
                    }
                } else if (isOverlayAttached && windowManager != null && overlayParams != null) {
                    overlayParams.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
                    overlayParams.x = 0;
                    overlayParams.y = targetY;
                    windowManager.updateViewLayout(overlayIslandView, overlayParams);
                }
                if (isOverlayAttached && overlayIslandView != null) {
                    overlayIslandView.setVisibility(View.VISIBLE);
                }
            } catch (Exception ignored) {
            }
        });
    }

    public void hideDynamicIslandOverlay() {
        handler.post(() -> {
            try {
                if (isOverlayAttached && overlayIslandView != null) {
                    overlayIslandView.setVisibility(View.GONE);
                }
            } catch (Exception ignored) {
            }
        });
    }

    public void dismissTransientGoalAlertOverlay() {
        handler.post(() -> {
            handler.removeCallbacks(dismissGoalAlertRunnable);
            removeTransientGoalAlertOverlay();
        });
    }

    private void removeTransientGoalAlertOverlay() {
        try {
            if (transientGoalAlertView != null && windowManager != null) {
                windowManager.removeView(transientGoalAlertView);
            }
        } catch (Exception ignored) {
        } finally {
            transientGoalAlertView = null;
        }
    }

    private void checkAndEnforceBedtimeWindDownIfNeeded(long continuousWatchMs) {
        try {
            long now = System.currentTimeMillis();
            SharedPreferences prefs = getSharedPreferences(PREF_SCREENSYNC, Context.MODE_PRIVATE);
            boolean masterEnabled = prefs.getBoolean("master_enabled", true);
            boolean quietEnabled = prefs.getBoolean("quiet_hours_enabled", true);
            boolean windDownEnabled = prefs.getBoolean("wind_down_enabled", true);
            long snoozedUntilMs = prefs.getLong("wind_down_snoozed_until_ms", 0L);

            java.util.Calendar cal = java.util.Calendar.getInstance();
            int curMins = cal.get(java.util.Calendar.HOUR_OF_DAY) * 60 + cal.get(java.util.Calendar.MINUTE);
            String qStartStr = prefs.getString("quiet_hours_start", "22:30");
            String qEndStr = prefs.getString("quiet_hours_end", "07:00");
            int startMins = AppTimerPolicy.parseHHMMToMinutes(qStartStr, 22 * 60 + 30);
            int endMins = AppTimerPolicy.parseHHMMToMinutes(qEndStr, 7 * 60);

            if (AppTimerPolicy.shouldTriggerBedtimeWindDown(
                    continuousWatchMs,
                    now,
                    lastBedtimeWindDownAlertMs,
                    snoozedUntilMs,
                    masterEnabled,
                    quietEnabled,
                    windDownEnabled,
                    curMins,
                    startMins,
                    endMins)) {
                lastBedtimeWindDownAlertMs = now;
                continuousShortFormWatchMs = 0L;
                showTransientGoalAlertOverlay("Wind-Down Bedtime", "15m of Reels during Quiet Hours — Time to rest your eyes");
            }
        } catch (Exception ignored) {
        }
    }

    private int parseHHMMToMinutes(String hhmm, int fallback) {
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

    private void removeDetoxCooldownOverlay() {
        if (detoxCooldownOverlayView != null && windowManager != null) {
            try {
                windowManager.removeView(detoxCooldownOverlayView);
            } catch (Exception ignored) {}
        }
        detoxCooldownOverlayView = null;
        detoxRemainingSeconds = 0;
    }

    public void showReelDetoxCooldownOverlay(final String packageName, final int countWatched) {
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                try {
                    SharedPreferences prefs = getSharedPreferences(PREF_SCREENSYNC, MODE_PRIVATE);
                    final int cooldownSec = Math.max(3, Math.min(30, prefs.getInt("reel_detox_cooldown_seconds", 5)));
                    if (detoxCooldownOverlayView != null && detoxRemainingSeconds > 0) {
                        return;
                    }
                    removeDetoxCooldownOverlay();
                    if (windowManager == null) {
                        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
                    }
                    if (windowManager == null) return;

                    detoxRemainingSeconds = cooldownSec;
                    LinearLayout card = new LinearLayout(ScreenSyncAccessibilityService.this);
                    card.setOrientation(LinearLayout.VERTICAL);
                    int padH = dpToPx(20);
                    int padV = dpToPx(16);
                    card.setPadding(padH, padV, padH, padV);

                    GradientDrawable bg = new GradientDrawable();
                    bg.setColor(Color.parseColor("#F50A1428"));
                    bg.setCornerRadius(dpToPx(24));
                    bg.setStroke(dpToPx(2), Color.parseColor("#34F5A6"));
                    card.setBackground(bg);

                    final TextView titleTv = new TextView(ScreenSyncAccessibilityService.this);
                    titleTv.setTextColor(Color.WHITE);
                    titleTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
                    titleTv.setTypeface(Typeface.DEFAULT_BOLD);
                    titleTv.setText("Take a " + cooldownSec + "-second breath");

                    final TextView msgTv = new TextView(ScreenSyncAccessibilityService.this);
                    msgTv.setTextColor(Color.parseColor("#CBD5E1"));
                    msgTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
                    msgTv.setPadding(0, dpToPx(4), 0, dpToPx(12));
                    msgTv.setText("You've watched " + countWatched + " consecutive Reels. Pause for " + cooldownSec + " seconds — Continue or Close App?");

                    LinearLayout btnRow = new LinearLayout(ScreenSyncAccessibilityService.this);
                    btnRow.setOrientation(LinearLayout.HORIZONTAL);
                    btnRow.setGravity(Gravity.CENTER);

                    final TextView continueBtn = new TextView(ScreenSyncAccessibilityService.this);
                    continueBtn.setText("Wait " + detoxRemainingSeconds + "s...");
                    continueBtn.setTextColor(Color.parseColor("#94A3B8"));
                    continueBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
                    continueBtn.setTypeface(Typeface.DEFAULT_BOLD);
                    continueBtn.setPadding(dpToPx(14), dpToPx(10), dpToPx(14), dpToPx(10));
                    continueBtn.setEnabled(false);
                    continueBtn.setOnClickListener(new View.OnClickListener() {
                        @Override
                        public void onClick(View v) {
                            if (detoxRemainingSeconds <= 0) {
                                consecutiveReelsInSession = 0;
                                removeDetoxCooldownOverlay();
                            }
                        }
                    });

                    final TextView closeBtn = new TextView(ScreenSyncAccessibilityService.this);
                    closeBtn.setText("Close App & Rest");
                    closeBtn.setTextColor(Color.WHITE);
                    closeBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
                    closeBtn.setTypeface(Typeface.DEFAULT_BOLD);
                    closeBtn.setPadding(dpToPx(14), dpToPx(10), dpToPx(14), dpToPx(10));
                    closeBtn.setOnClickListener(new View.OnClickListener() {
                        @Override
                        public void onClick(View v) {
                            consecutiveReelsInSession = 0;
                            removeDetoxCooldownOverlay();
                            try {
                                performGlobalAction(GLOBAL_ACTION_HOME);
                            } catch (Exception ignored) {}
                        }
                    });

                    btnRow.addView(continueBtn);
                    btnRow.addView(closeBtn);
                    card.addView(titleTv);
                    card.addView(msgTv);
                    card.addView(btnRow);

                    int interactiveFlags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN;
                    WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                        WindowManager.LayoutParams.WRAP_CONTENT,
                        WindowManager.LayoutParams.WRAP_CONTENT,
                        WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                        interactiveFlags,
                        PixelFormat.TRANSLUCENT
                    );
                    lp.gravity = Gravity.CENTER;
                    windowManager.addView(card, lp);
                    detoxCooldownOverlayView = card;

                    final Runnable countdownTick = new Runnable() {
                        @Override
                        public void run() {
                            if (detoxCooldownOverlayView == null) return;
                            detoxRemainingSeconds = Math.max(0, detoxRemainingSeconds - 1);
                            if (detoxRemainingSeconds > 0) {
                                continueBtn.setText("Wait " + detoxRemainingSeconds + "s...");
                                continueBtn.setEnabled(false);
                                handler.postDelayed(this, 1000L);
                            } else {
                                continueBtn.setText("Continue Watching");
                                continueBtn.setTextColor(Color.parseColor("#34F5A6"));
                                continueBtn.setEnabled(true);
                            }
                        }
                    };
                    handler.postDelayed(countdownTick, 1000L);
                } catch (Exception ignored) {
                }
            }
        });
    }

    public void showTransientGoalAlertOverlay(final String title, final String message) {
        showTransientGoalAlertOverlay(title, message, 5000L);
    }

    public void showTransientGoalAlertOverlay(final String title, final String message, final long durationMs) {
        final long safeDurationMs = Math.max(4000L, Math.min(6000L, durationMs > 0L ? durationMs : 5000L));
        handler.post(() -> {
            try {
                if (windowManager == null) {
                    windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
                }
                if (windowManager == null) return;

                handler.removeCallbacks(dismissGoalAlertRunnable);
                removeTransientGoalAlertOverlay();

                LinearLayout card = new LinearLayout(this);
                card.setOrientation(LinearLayout.VERTICAL);
                int padH = dpToPx(18);
                int padV = dpToPx(12);
                card.setPadding(padH, padV, padH, padV);

                GradientDrawable bg = new GradientDrawable();
                bg.setColor(Color.parseColor("#F50A1428"));
                bg.setCornerRadius(dpToPx(20));
                bg.setStroke(dpToPx(2), Color.parseColor("#38BDF8"));
                card.setBackground(bg);

                TextView titleTv = new TextView(this);
                titleTv.setTextColor(Color.WHITE);
                titleTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
                titleTv.setTypeface(Typeface.DEFAULT_BOLD);
                titleTv.setText(title != null ? title : "Screen Time Goal Reached");

                TextView msgTv = new TextView(this);
                msgTv.setTextColor(Color.parseColor("#94A3B8"));
                msgTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
                msgTv.setPadding(0, dpToPx(3), 0, 0);
                msgTv.setText(message != null ? message : "You have reached your daily usage goal.");

                card.addView(titleTv);
                card.addView(msgTv);

                int flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                    | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                    | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN;

                WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.WRAP_CONTENT,
                    WindowManager.LayoutParams.WRAP_CONTENT,
                    WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                    flags,
                    PixelFormat.TRANSLUCENT
                );
                lp.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
                lp.x = 0;
                lp.y = dpToPx(44);

                try {
                    windowManager.addView(card, lp);
                    transientGoalAlertView = card;
                } catch (Exception e1) {
                    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)) {
                        lp.type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                            : WindowManager.LayoutParams.TYPE_PHONE;
                        windowManager.addView(card, lp);
                        transientGoalAlertView = card;
                    }
                }

                handler.postDelayed(dismissGoalAlertRunnable, safeDurationMs);
            } catch (Exception ignored) {
            }
        });
    }

    private volatile String overlayMode = "collapsed";
    private volatile long overlaySnoozeUntilMs = 0L;

    public void snoozeOverlay(int durationMinutes) {
        int safeMins = Math.max(1, durationMinutes);
        this.overlaySnoozeUntilMs = System.currentTimeMillis() + (safeMins * 60L * 1000L);
        try {
            getSharedPreferences(PREF_SCREENSYNC, Context.MODE_PRIVATE)
                .edit()
                .putLong("overlay_snooze_until_ms", this.overlaySnoozeUntilMs)
                .apply();
        } catch (Exception ignored) {}
    }

    public boolean isOverlaySnoozed() {
        long now = System.currentTimeMillis();
        if (this.overlaySnoozeUntilMs <= 0L) {
            try {
                this.overlaySnoozeUntilMs = getSharedPreferences(PREF_SCREENSYNC, Context.MODE_PRIVATE)
                    .getLong("overlay_snooze_until_ms", 0L);
            } catch (Exception ignored) {}
        }
        return this.overlaySnoozeUntilMs > now;
    }

    public long getOverlaySnoozeUntilMs() {
        return this.overlaySnoozeUntilMs;
    }

    public void setOverlayMode(String mode) {
        if ("expanded".equals(mode) || "roast_nudge".equals(mode) || "collapsed".equals(mode)) {
            this.overlayMode = mode;
        }
    }

    public String getOverlayMode() {
        return this.overlayMode;
    }

    private static final long ROAST_SETTLE_DELAY_MS = 400L;
    private static final long ROAST_RENDER_TIMEOUT_MS = 3000L;

    public void triggerRoastNudgeOverlayWithTimeout(final String roastMessage) {
        if (isOverlaySnoozed()) return;
        setOverlayMode("roast_nudge");
        handler.postDelayed(() -> {
            try {
                showTransientGoalAlertOverlay("Mindful Milestone Check", roastMessage != null ? roastMessage : "Take a quick breather from scrolling.", ROAST_RENDER_TIMEOUT_MS);
            } catch (Exception ignored) {
            } finally {
                handler.postDelayed(() -> setOverlayMode("collapsed"), ROAST_RENDER_TIMEOUT_MS);
            }
        }, ROAST_SETTLE_DELAY_MS);
    }

}
