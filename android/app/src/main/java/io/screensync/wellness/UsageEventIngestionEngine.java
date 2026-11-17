package io.screensync.wellness;

import android.app.AppOpsManager;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Process;
import android.os.UserManager;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Subsystem A: UsageEventIngestionEngine
 * Pulls raw events from Android's UsageStatsManager.queryEvents(beginTime, endTime),
 * filters relevant lifecycle and device-state event types, and persists them into SQLite
 * so data survives Android's ~7-10 day raw event rolling purge window.
 */
public class UsageEventIngestionEngine {
    private static final String PREFS_NAME = "screensync_usage_ingestion_prefs";
    private static final String KEY_LAST_SYNC_MS = "last_sync_timestamp_ms";
    private static final long INITIAL_BACKFILL_WINDOW_MS = 30L * 24L * 60L * 60L * 1000L; // 30 days backfill when enabled
    private static final int SQLITE_BATCH_SIZE = 500;

    // Event types tracked by ScreenSync Wellness
    public static final int EVENT_ACTIVITY_RESUMED = 1;           // MOVE_TO_FOREGROUND
    public static final int EVENT_ACTIVITY_PAUSED = 2;            // MOVE_TO_BACKGROUND
    public static final int EVENT_END_OF_DAY = 3;
    public static final int EVENT_CONTINUE_PREVIOUS_DAY = 4;
    public static final int EVENT_CONFIGURATION_CHANGE = 5;
    public static final int EVENT_USER_INTERACTION = 7;
    public static final int EVENT_NOTIFICATION_INTERRUPTION = 12;
    public static final int EVENT_SCREEN_INTERACTIVE = 15;
    public static final int EVENT_SCREEN_NON_INTERACTIVE = 16;
    public static final int EVENT_KEYGUARD_SHOWN = 17;
    public static final int EVENT_KEYGUARD_HIDDEN = 18;           // Device Unlock
    public static final int EVENT_FOREGROUND_SERVICE_START = 19;
    public static final int EVENT_FOREGROUND_SERVICE_STOP = 20;
    public static final int EVENT_ACTIVITY_STOPPED = 23;
    public static final int EVENT_DEVICE_SHUTDOWN = 26;
    public static final int EVENT_DEVICE_STARTUP = 27;

    private static final Set<Integer> TRACKED_EVENT_TYPES = new HashSet<>(Arrays.asList(
        EVENT_ACTIVITY_RESUMED,
        EVENT_ACTIVITY_PAUSED,
        EVENT_END_OF_DAY,
        EVENT_CONTINUE_PREVIOUS_DAY,
        EVENT_NOTIFICATION_INTERRUPTION,
        EVENT_SCREEN_INTERACTIVE,
        EVENT_SCREEN_NON_INTERACTIVE,
        EVENT_KEYGUARD_SHOWN,
        EVENT_KEYGUARD_HIDDEN,
        EVENT_FOREGROUND_SERVICE_START,
        EVENT_FOREGROUND_SERVICE_STOP,
        EVENT_ACTIVITY_STOPPED,
        EVENT_DEVICE_SHUTDOWN,
        EVENT_DEVICE_STARTUP
    ));

    private final Context context;
    private final AppUsageDatabaseHelper dbHelper;

    public UsageEventIngestionEngine(Context context, AppUsageDatabaseHelper dbHelper) {
        this.context = context.getApplicationContext();
        this.dbHelper = dbHelper;
    }

    /**
     * Subsystem A Direct Boot Guard: UsageStatsManager returns null before Credential Encrypted
     * storage is unlocked on Android 11+ (API 30+).
     */
    public boolean isUserUnlocked() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            UserManager um = (UserManager) context.getSystemService(Context.USER_SERVICE);
            return um == null || um.isUserUnlocked();
        }
        return true;
    }

    public boolean hasUsageStatsPermission() {
        AppOpsManager appOps = (AppOpsManager) context.getSystemService(Context.APP_OPS_SERVICE);
        if (appOps == null) return false;
        int mode = appOps.checkOpNoThrow(
            AppOpsManager.OPSTR_GET_USAGE_STATS,
            Process.myUid(),
            context.getPackageName()
        );
        if (mode == AppOpsManager.MODE_DEFAULT) {
            return context.checkCallingOrSelfPermission(android.Manifest.permission.PACKAGE_USAGE_STATS)
                == PackageManager.PERMISSION_GRANTED;
        }
        return mode == AppOpsManager.MODE_ALLOWED;
    }

    public synchronized int ingestIncrementalEvents(long nowMs) {
        if (!isUserUnlocked()) {
            return 0;
        }
        if (!hasUsageStatsPermission()) {
            // Permission missing/revoked: preserve persisted SQLite history without flushing tables (D-3)
            return -1;
        }

        UsageStatsManager usm = (UsageStatsManager) context.getSystemService(Context.USAGE_STATS_SERVICE);
        if (usm == null) return 0;

        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        long lastSyncMs = prefs.getLong(KEY_LAST_SYNC_MS, 0L);

        // Incremental Query Window Calculation (handles first run and backward wall-clock adjustments)
        long beginTimeMs;
        if (lastSyncMs <= 0L || lastSyncMs > nowMs) {
            beginTimeMs = nowMs - INITIAL_BACKFILL_WINDOW_MS;
        } else {
            beginTimeMs = lastSyncMs + 1L;
        }

        UsageEvents usageEvents = usm.queryEvents(beginTimeMs, nowMs);
        if (usageEvents == null) return 0;

        List<AppUsageDatabaseHelper.RawEventRecord> batch = new ArrayList<>(SQLITE_BATCH_SIZE);
        UsageEvents.Event event = new UsageEvents.Event();
        long maxObservedTimestamp = lastSyncMs;
        int totalProcessed = 0;

        while (usageEvents.hasNextEvent()) {
            usageEvents.getNextEvent(event);
            int type = event.getEventType();
            if (!TRACKED_EVENT_TYPES.contains(type)) {
                continue;
            }
            long ts = event.getTimeStamp();
            String pkg = event.getPackageName() != null ? event.getPackageName() : "android";
            String cls = event.getClassName();

            batch.add(new AppUsageDatabaseHelper.RawEventRecord(0L, pkg, cls, ts, type));
            if (ts > maxObservedTimestamp) {
                maxObservedTimestamp = ts;
            }
            totalProcessed++;

            if (batch.size() >= SQLITE_BATCH_SIZE) {
                dbHelper.insertEventBatch(batch);
                batch.clear();
            }
        }

        if (!batch.isEmpty()) {
            dbHelper.insertEventBatch(batch);
            batch.clear();
        }

        if (maxObservedTimestamp > lastSyncMs) {
            prefs.edit().putLong(KEY_LAST_SYNC_MS, maxObservedTimestamp).apply();
        }
        return totalProcessed;
    }
}
