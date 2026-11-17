/*
 * PROVENANCE LABEL: [RECONSTRUCTED SOURCE CODE BASED ON VERIFIED app_usage SQLITE SCHEMA]
 * Package: com.google.android.apps.wellbeing.data
 * Represents the SQLiteOpenHelper & DAO layer managing /data/data/com.google.android.apps.wellbeing/databases/app_usage.
 */
package io.screensync.wellness;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.util.Log;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

public class AppUsageDatabaseHelper extends SQLiteOpenHelper {
    private static final String TAG = "AppUsageDB";
    public static final String DATABASE_NAME = "app_usage";
    public static final int DATABASE_VERSION = 5;
    public static final int SCHEMA_REVISION = 6;

    public static final class RawEventRecord {
        public final long id;
        public final long packageId;
        public final String packageName;
        public final String className;
        public final long timestampMs;
        public final int eventType;

        public RawEventRecord(long id, long packageId, String packageName, long timestampMs, int eventType) {
            this(id, packageId, packageName, null, timestampMs, eventType);
        }

        public RawEventRecord(long id, String packageName, String className, long timestampMs, int eventType) {
            this(id, 0L, packageName, className, timestampMs, eventType);
        }

        public RawEventRecord(long id, long packageId, String packageName, String className, long timestampMs, int eventType) {
            this.id = id;
            this.packageId = packageId;
            this.packageName = packageName != null ? packageName : "android";
            this.className = className != null ? className : "";
            this.timestampMs = timestampMs;
            this.eventType = eventType;
        }
    }

    private final Map<String, Long> packageIdCache = new HashMap<>();
    private int dbErrorsCount = 0;

    public AppUsageDatabaseHelper(Context context) {
        super(context, DATABASE_NAME, null, DATABASE_VERSION);
    }

    public synchronized int getDbErrorsCount() {
        return dbErrorsCount;
    }

    @Override
    public void onConfigure(SQLiteDatabase db) {
        super.onConfigure(db);
        db.setForeignKeyConstraintsEnabled(true);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS packages (" +
                "_id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                "package_name TEXT NOT NULL UNIQUE)");
        db.execSQL("CREATE TABLE IF NOT EXISTS events (" +
                "_id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                "package_id INTEGER NOT NULL, " +
                "class_name TEXT DEFAULT '', " +
                "timestamp INTEGER NOT NULL, " +
                "type INTEGER NOT NULL, " +
                "FOREIGN KEY(package_id) REFERENCES packages(_id) ON DELETE CASCADE)");
        db.execSQL("CREATE TABLE IF NOT EXISTS components (" +
                "_id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                "package_id INTEGER NOT NULL, " +
                "component_name TEXT NOT NULL, " +
                "FOREIGN KEY(package_id) REFERENCES packages(_id) ON DELETE CASCADE, " +
                "UNIQUE(package_id, component_name))");
        db.execSQL("CREATE TABLE IF NOT EXISTS component_events (" +
                "_id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                "component_id INTEGER NOT NULL, " +
                "timestamp INTEGER NOT NULL, " +
                "type INTEGER NOT NULL, " +
                "FOREIGN KEY(component_id) REFERENCES components(_id) ON DELETE CASCADE)");
        db.execSQL("CREATE TABLE IF NOT EXISTS reel_daily_archive (" +
                "day_key TEXT NOT NULL, " +
                "package_name TEXT NOT NULL, " +
                "reel_count INTEGER NOT NULL DEFAULT 0, " +
                "watch_duration_ms INTEGER NOT NULL DEFAULT 0, " +
                "skipped_count INTEGER NOT NULL DEFAULT 0, " +
                "updated_at_ms INTEGER NOT NULL DEFAULT 0, " +
                "PRIMARY KEY(day_key, package_name))");
        db.execSQL("CREATE TABLE IF NOT EXISTS reel_hourly_buckets (" +
                "day_key TEXT NOT NULL, " +
                "hour_of_day INTEGER NOT NULL, " +
                "package_name TEXT NOT NULL, " +
                "reel_count INTEGER NOT NULL DEFAULT 0, " +
                "watch_duration_ms INTEGER NOT NULL DEFAULT 0, " +
                "skipped_count INTEGER NOT NULL DEFAULT 0, " +
                "updated_at_ms INTEGER NOT NULL DEFAULT 0, " +
                "PRIMARY KEY(day_key, hour_of_day, package_name))");
        db.execSQL("CREATE TABLE IF NOT EXISTS unlock_hourly_buckets (" +
                "day_key TEXT NOT NULL, " +
                "hour_of_day INTEGER NOT NULL, " +
                "unlock_count INTEGER NOT NULL DEFAULT 0, " +
                "updated_at_ms INTEGER NOT NULL DEFAULT 0, " +
                "PRIMARY KEY(day_key, hour_of_day))");
        db.execSQL("CREATE TABLE IF NOT EXISTS reel_outbox_events (" +
                "event_id TEXT PRIMARY KEY, " +
                "package_name TEXT NOT NULL, " +
                "fingerprint TEXT NOT NULL, " +
                "counted_at_ms INTEGER NOT NULL, " +
                "watch_seconds INTEGER NOT NULL DEFAULT 0, " +
                "direction TEXT NOT NULL DEFAULT 'FORWARD', " +
                "event_type TEXT NOT NULL DEFAULT 'REEL_COUNTED', " +
                "source TEXT NOT NULL DEFAULT 'ACCESSIBILITY', " +
                "delivered_web INTEGER NOT NULL DEFAULT 0, " +
                "delivered_cloud INTEGER NOT NULL DEFAULT 0)");
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp)");
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_events_pkg_time ON events(package_id, timestamp)");
        db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS idx_events_unique_tuple ON events(package_id, class_name, timestamp, type)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        onCreate(db);
        try {
            db.execSQL("ALTER TABLE events ADD COLUMN class_name TEXT DEFAULT ''");
        } catch (Exception e) {
            Log.w(TAG, "events.class_name column already exists or upgrade note", e);
            dbErrorsCount++;
        }
        try {
            db.execSQL("ALTER TABLE reel_daily_archive ADD COLUMN skipped_count INTEGER NOT NULL DEFAULT 0");
        } catch (Exception e) {
            Log.w(TAG, "reel_daily_archive.skipped_count column already exists", e);
            dbErrorsCount++;
        }
        try {
            db.execSQL("ALTER TABLE reel_hourly_buckets ADD COLUMN skipped_count INTEGER NOT NULL DEFAULT 0");
        } catch (Exception e) {
            Log.w(TAG, "reel_hourly_buckets.skipped_count column already exists", e);
            dbErrorsCount++;
        }
        try {
            db.execSQL("DELETE FROM events WHERE _id NOT IN (SELECT MIN(_id) FROM events GROUP BY package_id, class_name, timestamp, type)");
            db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS idx_events_unique_tuple ON events(package_id, class_name, timestamp, type)");
        } catch (Exception e) {
            Log.w(TAG, "idx_events_unique_tuple upgrade note", e);
            dbErrorsCount++;
        }
    }

    public synchronized long getOrCreatePackageId(SQLiteDatabase db, String packageName) {
        Long cached = packageIdCache.get(packageName);
        if (cached != null) {
            return cached;
        }
        try (Cursor c = db.query("packages", new String[]{"_id"}, "package_name = ?",
                new String[]{packageName}, null, null, null)) {
            if (c.moveToFirst()) {
                long id = c.getLong(0);
                packageIdCache.put(packageName, id);
                return id;
            }
        }
        ContentValues cv = new ContentValues();
        cv.put("package_name", packageName);
        long id = db.insertWithOnConflict("packages", null, cv, SQLiteDatabase.CONFLICT_IGNORE);
        if (id != -1) {
            packageIdCache.put(packageName, id);
        }
        return id;
    }

    public synchronized void insertEventBatch(List<RawEventRecord> batch) {
        if (batch == null || batch.isEmpty()) return;
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            for (RawEventRecord rec : batch) {
                if (rec == null || rec.packageName == null || rec.packageName.isEmpty()) continue;
                long pkgId = rec.packageId > 0L ? rec.packageId : getOrCreatePackageId(db, rec.packageName);
                if (pkgId <= 0L) continue;
                ContentValues cv = new ContentValues();
                cv.put("package_id", pkgId);
                cv.put("class_name", rec.className != null ? rec.className : "");
                cv.put("timestamp", rec.timestampMs);
                cv.put("type", rec.eventType);
                db.insertWithOnConflict("events", null, cv, SQLiteDatabase.CONFLICT_IGNORE);
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    public synchronized void deletePackageData(String packageName) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.delete("packages", "package_name = ?", new String[]{packageName});
            packageIdCache.remove(packageName);
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    public synchronized void flushAllTables() {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.delete("component_events", null, null);
            db.delete("components", null, null);
            db.delete("events", null, null);
            db.delete("packages", null, null);
            db.delete("reel_daily_archive", null, null);
            db.delete("reel_hourly_buckets", null, null);
            db.delete("unlock_hourly_buckets", null, null);
            db.delete("reel_outbox_events", null, null);
            packageIdCache.clear();
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    public synchronized JSONObject pruneOlderThan(long cutoffEpochMs, String cutoffDayKey) {
        JSONObject summary = new JSONObject();
        int deletedEvents = 0;
        int deletedComponentEvents = 0;
        int deletedReelOutbox = 0;
        int deletedReelDaily = 0;
        int deletedReelHourly = 0;
        int deletedUnlockHourly = 0;
        boolean txSucceeded = false;
        String txError = null;
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            if (cutoffEpochMs > 0L) {
                String[] tsArgs = new String[]{String.valueOf(cutoffEpochMs)};
                deletedEvents = db.delete("events", "timestamp < ?", tsArgs);
                deletedComponentEvents = db.delete("component_events", "timestamp < ?", tsArgs);
                deletedReelOutbox = db.delete("reel_outbox_events", "counted_at_ms < ? AND delivered_web = 1", tsArgs);
            }
            if (cutoffDayKey != null && !cutoffDayKey.trim().isEmpty()) {
                String[] dayArgs = new String[]{cutoffDayKey.trim()};
                deletedReelDaily = db.delete("reel_daily_archive", "day_key < ?", dayArgs);
                deletedReelHourly = db.delete("reel_hourly_buckets", "day_key < ?", dayArgs);
                deletedUnlockHourly = db.delete("unlock_hourly_buckets", "day_key < ?", dayArgs);
            }
            db.setTransactionSuccessful();
            txSucceeded = true;
        } catch (Exception e) {
            Log.w(TAG, "Failed to prune older history", e);
            dbErrorsCount++;
            txError = e.getMessage();
        } finally {
            db.endTransaction();
        }
        try {
            summary.put("ok", txSucceeded);
            if (txError != null) {
                summary.put("error", txError);
            }
            summary.put("cutoffEpochMs", cutoffEpochMs);
            summary.put("cutoffDayKey", cutoffDayKey != null ? cutoffDayKey : "");
            summary.put("deletedEvents", deletedEvents);
            summary.put("deletedComponentEvents", deletedComponentEvents);
            summary.put("deletedReelOutbox", deletedReelOutbox);
            summary.put("deletedReelDaily", deletedReelDaily);
            summary.put("deletedReelHourly", deletedReelHourly);
            summary.put("deletedUnlockHourly", deletedUnlockHourly);
        } catch (Exception ignored) {
        }
        return summary;
    }

    public synchronized void flushAllUsageTables() {
        flushAllTables();
    }

    public List<RawEventRecord> queryEventsInWindow(long startTimeMs, long endTimeMs) {
        List<RawEventRecord> result = new ArrayList<>();
        SQLiteDatabase db = getReadableDatabase();
        String sql = "SELECT events._id, events.package_id, packages.package_name, " +
                     "events.class_name, events.timestamp, events.type " +
                     "FROM events INNER JOIN packages ON events.package_id = packages._id " +
                     "WHERE events.timestamp >= ? AND events.timestamp <= ? " +
                     "ORDER BY events.timestamp ASC, events._id ASC";
        try (Cursor c = db.rawQuery(sql, new String[]{String.valueOf(startTimeMs), String.valueOf(endTimeMs)})) {
            while (c.moveToNext()) {
                result.add(new RawEventRecord(
                        c.getLong(0),
                        c.getLong(1),
                        c.getString(2),
                        c.getString(3),
                        c.getLong(4),
                        c.getInt(5)
                ));
            }
        }
        return result;
    }

    public synchronized void archiveDailyReelCounters(String dayKey, String packageName, int reelCount, long watchDurationMs) {
        archiveDailyReelCounters(dayKey, packageName, reelCount, watchDurationMs, 0);
    }

    public synchronized void archiveDailyReelCounters(String dayKey, String packageName, int reelCount, long watchDurationMs, int skippedCount) {
        if (dayKey == null || dayKey.isEmpty() || packageName == null || packageName.isEmpty()) return;
        if (reelCount <= 0 && watchDurationMs <= 0L && skippedCount <= 0) return;
        try {
            SQLiteDatabase db = getWritableDatabase();
            ContentValues cv = new ContentValues();
            cv.put("day_key", dayKey);
            cv.put("package_name", packageName);
            cv.put("reel_count", Math.max(0, reelCount));
            cv.put("watch_duration_ms", Math.max(0L, watchDurationMs));
            cv.put("skipped_count", Math.max(0, skippedCount));
            cv.put("updated_at_ms", System.currentTimeMillis());
            db.insertWithOnConflict("reel_daily_archive", null, cv, SQLiteDatabase.CONFLICT_REPLACE);
        } catch (Exception e) {
            Log.w(TAG, "Failed to archive daily reel counters", e);
            dbErrorsCount++;
        }
    }

    public synchronized void incrementHourlyReelBucket(String dayKey, int hourOfDay, String packageName, int deltaReels, long deltaWatchMs) {
        incrementHourlyReelBucket(dayKey, hourOfDay, packageName, deltaReels, deltaWatchMs, 0);
    }

    public synchronized void incrementHourlyReelBucket(String dayKey, int hourOfDay, String packageName, int deltaReels, long deltaWatchMs, int deltaSkips) {
        if (dayKey == null || dayKey.isEmpty() || packageName == null || packageName.isEmpty()) return;
        int clampedHour = Math.max(0, Math.min(23, hourOfDay));
        try {
            SQLiteDatabase db = getWritableDatabase();
            int existingReels = 0;
            long existingWatchMs = 0L;
            int existingSkips = 0;
            Cursor c = db.rawQuery(
                "SELECT reel_count, watch_duration_ms, skipped_count FROM reel_hourly_buckets WHERE day_key = ? AND hour_of_day = ? AND package_name = ?",
                new String[]{dayKey, String.valueOf(clampedHour), packageName}
            );
            try {
                if (c.moveToFirst()) {
                    existingReels = c.getInt(0);
                    existingWatchMs = c.getLong(1);
                    existingSkips = c.getInt(2);
                }
            } finally {
                c.close();
            }
            ContentValues cv = new ContentValues();
            cv.put("day_key", dayKey);
            cv.put("hour_of_day", clampedHour);
            cv.put("package_name", packageName);
            cv.put("reel_count", Math.max(0, existingReels + deltaReels));
            cv.put("watch_duration_ms", Math.max(0L, existingWatchMs + deltaWatchMs));
            cv.put("skipped_count", Math.max(0, existingSkips + deltaSkips));
            cv.put("updated_at_ms", System.currentTimeMillis());
            db.insertWithOnConflict("reel_hourly_buckets", null, cv, SQLiteDatabase.CONFLICT_REPLACE);
        } catch (Exception e) {
            Log.w(TAG, "Failed to increment hourly reel bucket", e);
            dbErrorsCount++;
        }
    }

    public synchronized void incrementHourlyUnlockBucket(String dayKey, int hourOfDay, int deltaUnlocks) {
        if (dayKey == null || dayKey.isEmpty() || deltaUnlocks <= 0) return;
        int clampedHour = Math.max(0, Math.min(23, hourOfDay));
        try {
            SQLiteDatabase db = getWritableDatabase();
            int existingUnlocks = 0;
            Cursor c = db.rawQuery(
                "SELECT unlock_count FROM unlock_hourly_buckets WHERE day_key = ? AND hour_of_day = ?",
                new String[]{dayKey, String.valueOf(clampedHour)}
            );
            try {
                if (c.moveToFirst()) {
                    existingUnlocks = c.getInt(0);
                }
            } finally {
                c.close();
            }
            ContentValues cv = new ContentValues();
            cv.put("day_key", dayKey);
            cv.put("hour_of_day", clampedHour);
            cv.put("unlock_count", Math.max(0, existingUnlocks + deltaUnlocks));
            cv.put("updated_at_ms", System.currentTimeMillis());
            db.insertWithOnConflict("unlock_hourly_buckets", null, cv, SQLiteDatabase.CONFLICT_REPLACE);
        } catch (Exception e) {
            Log.w(TAG, "Failed to increment hourly unlock bucket", e);
            dbErrorsCount++;
        }
    }

    public synchronized JSONObject queryReelHistorySince(String sinceDayKey) {
        JSONObject result = new JSONObject();
        JSONObject daysObj = new JSONObject();
        JSONArray hourlyArr = new JSONArray();
        JSONArray unlockHourlyArr = new JSONArray();
        String minDay = (sinceDayKey == null || sinceDayKey.isEmpty()) ? "1970-01-01" : sinceDayKey;
        try {
            SQLiteDatabase db = getReadableDatabase();
            Cursor cDaily = db.rawQuery(
                "SELECT day_key, package_name, reel_count, watch_duration_ms, skipped_count FROM reel_daily_archive WHERE day_key >= ? ORDER BY day_key ASC",
                new String[]{minDay}
            );
            try {
                while (cDaily.moveToNext()) {
                    String dKey = cDaily.getString(0);
                    String pkg = cDaily.getString(1);
                    int rCount = cDaily.getInt(2);
                    long wMs = cDaily.getLong(3);
                    int sCount = cDaily.getInt(4);
                    JSONObject dayEntry = daysObj.optJSONObject(dKey);
                    if (dayEntry == null) {
                        dayEntry = new JSONObject();
                        dayEntry.put("dayKey", dKey);
                        dayEntry.put("dailyReelCount", 0);
                        dayEntry.put("dailyWatchDurationMs", 0L);
                        dayEntry.put("dailySkippedCount", 0);
                        dayEntry.put("byPackage", new JSONObject());
                        dayEntry.put("watchDurationMsByPackage", new JSONObject());
                        dayEntry.put("skippedByPackage", new JSONObject());
                        daysObj.put(dKey, dayEntry);
                    }
                    dayEntry.put("dailyReelCount", dayEntry.optInt("dailyReelCount", 0) + rCount);
                    dayEntry.put("dailyWatchDurationMs", dayEntry.optLong("dailyWatchDurationMs", 0L) + wMs);
                    dayEntry.put("dailySkippedCount", dayEntry.optInt("dailySkippedCount", 0) + sCount);
                    dayEntry.optJSONObject("byPackage").put(pkg, rCount);
                    dayEntry.optJSONObject("watchDurationMsByPackage").put(pkg, wMs);
                    dayEntry.optJSONObject("skippedByPackage").put(pkg, sCount);
                }
            } finally {
                cDaily.close();
            }

            Cursor cHourly = db.rawQuery(
                "SELECT day_key, hour_of_day, package_name, reel_count, watch_duration_ms, skipped_count FROM reel_hourly_buckets WHERE day_key >= ? ORDER BY day_key ASC, hour_of_day ASC",
                new String[]{minDay}
            );
            try {
                while (cHourly.moveToNext()) {
                    JSONObject b = new JSONObject();
                    b.put("dayKey", cHourly.getString(0));
                    b.put("hour", cHourly.getInt(1));
                    b.put("packageName", cHourly.getString(2));
                    b.put("reelCount", cHourly.getInt(3));
                    b.put("watchDurationMs", cHourly.getLong(4));
                    b.put("skippedCount", cHourly.getInt(5));
                    hourlyArr.put(b);
                }
            } finally {
                cHourly.close();
            }

            Cursor cUnlocks = db.rawQuery(
                "SELECT day_key, hour_of_day, unlock_count FROM unlock_hourly_buckets WHERE day_key >= ? ORDER BY day_key ASC, hour_of_day ASC",
                new String[]{minDay}
            );
            try {
                while (cUnlocks.moveToNext()) {
                    JSONObject u = new JSONObject();
                    u.put("dayKey", cUnlocks.getString(0));
                    u.put("hour", cUnlocks.getInt(1));
                    u.put("unlockCount", cUnlocks.getInt(2));
                    unlockHourlyArr.put(u);
                }
            } finally {
                cUnlocks.close();
            }

            result.put("sinceDayKey", minDay);
            result.put("days", daysObj);
            result.put("hourlyBuckets", hourlyArr);
            result.put("unlockHourlyBuckets", unlockHourlyArr);
            result.put("dbErrorsCount", dbErrorsCount);
        } catch (Exception e) {
            Log.w(TAG, "Failed to query reel history since " + minDay, e);
            dbErrorsCount++;
        }
        return result;
    }

    public synchronized void appendReelOutboxEvent(
            String eventId,
            String packageName,
            String fingerprint,
            long countedAtMs,
            int watchSeconds,
            String direction,
            String eventType) {
        if (eventId == null || eventId.isEmpty() || packageName == null || packageName.isEmpty()) return;
        try {
            SQLiteDatabase db = getWritableDatabase();
            ContentValues cv = new ContentValues();
            cv.put("event_id", eventId);
            cv.put("package_name", packageName);
            cv.put("fingerprint", fingerprint != null ? fingerprint : "");
            cv.put("counted_at_ms", countedAtMs > 0L ? countedAtMs : System.currentTimeMillis());
            cv.put("watch_seconds", Math.max(0, watchSeconds));
            cv.put("direction", direction != null && !direction.isEmpty() ? direction : "FORWARD");
            cv.put("event_type", eventType != null && !eventType.isEmpty() ? eventType : "REEL_COUNTED");
            cv.put("source", "ACCESSIBILITY");
            cv.put("delivered_web", 0);
            cv.put("delivered_cloud", 0);
            db.insertWithOnConflict("reel_outbox_events", null, cv, SQLiteDatabase.CONFLICT_IGNORE);
        } catch (Exception e) {
            Log.w(TAG, "Failed to append reel outbox event", e);
            dbErrorsCount++;
        }
    }

    public synchronized JSONArray queryPendingReelOutboxEvents(int limit) {
        JSONArray arr = new JSONArray();
        try {
            SQLiteDatabase db = getReadableDatabase();
            Cursor c = db.rawQuery(
                "SELECT event_id, package_name, fingerprint, counted_at_ms, watch_seconds, direction, event_type, source " +
                "FROM reel_outbox_events WHERE delivered_web = 0 OR delivered_cloud = 0 ORDER BY counted_at_ms ASC LIMIT ?",
                new String[]{String.valueOf(Math.max(1, limit))}
            );
            try {
                while (c.moveToNext()) {
                    JSONObject obj = new JSONObject();
                    obj.put("eventId", c.getString(0));
                    obj.put("packageName", c.getString(1));
                    obj.put("fingerprint", c.getString(2));
                    obj.put("countedAtMs", c.getLong(3));
                    obj.put("watchSeconds", c.getInt(4));
                    obj.put("direction", c.getString(5));
                    obj.put("eventType", c.getString(6));
                    obj.put("source", c.getString(7));
                    arr.put(obj);
                }
            } finally {
                c.close();
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to query pending reel outbox events", e);
            dbErrorsCount++;
        }
        return arr;
    }

    public synchronized void acknowledgeReelOutboxEvent(String eventId) {
        if (eventId == null || eventId.isEmpty()) return;
        try {
            SQLiteDatabase db = getWritableDatabase();
            db.delete("reel_outbox_events", "event_id = ?", new String[]{eventId});
        } catch (Exception e) {
            Log.w(TAG, "Failed to acknowledge reel outbox event", e);
            dbErrorsCount++;
        }
    }
}
