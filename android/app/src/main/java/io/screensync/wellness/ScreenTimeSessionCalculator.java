/*
 * PROVENANCE LABEL: [RECONSTRUCTED SCREEN-TIME & USAGE METRICS ALGORITHM]
 * Package: com.google.android.apps.wellbeing.calculator
 * Implements session reconstruction, screen-interactive & keyguard gating, midnight boundary splitting,
 * ongoing session clamping, launch counting, unlock counting, and notification counting.
 */
package io.screensync.wellness;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class ScreenTimeSessionCalculator {

    public static final int TYPE_ACTIVITY_RESUMED = 1;
    public static final int TYPE_ACTIVITY_PAUSED = 2;
    public static final int TYPE_NOTIFICATION_INTERRUPTION = 12;
    public static final int TYPE_SCREEN_INTERACTIVE = 15;
    public static final int TYPE_SCREEN_NON_INTERACTIVE = 16;
    public static final int TYPE_KEYGUARD_SHOWN = 17;
    public static final int TYPE_KEYGUARD_HIDDEN = 18;
    public static final int TYPE_ACTIVITY_STOPPED = 23;
    public static final int TYPE_DEVICE_SHUTDOWN = 26;
    public static final int TYPE_DEVICE_STARTUP = 27;

    public static final long INTRA_APP_TRANSITION_GAP_MS = 2000L;

    public static final class UsageEventInput implements Comparable<UsageEventInput> {
        public final long rowId;
        public final String packageName;
        public final String className;
        public final int instanceId;
        public final long timestampMs;
        public final int eventType;

        public UsageEventInput(long rowId, String packageName, String className,
                               int instanceId, long timestampMs, int eventType) {
            this.rowId = rowId;
            this.packageName = packageName != null ? packageName : "";
            this.className = className != null ? className : "";
            this.instanceId = instanceId;
            this.timestampMs = timestampMs;
            this.eventType = eventType;
        }

        @Override
        public int compareTo(UsageEventInput other) {
            int cmp = Long.compare(this.timestampMs, other.timestampMs);
            return (cmp != 0) ? cmp : Long.compare(this.rowId, other.rowId);
        }
    }

    public static final class UsageSession {
        public final String packageName;
        public final long startTimeMs;
        public final long endTimeMs;
        public final boolean ongoing;

        public UsageSession(String packageName, long startTimeMs, long endTimeMs, boolean ongoing) {
            this.packageName = packageName;
            this.startTimeMs = startTimeMs;
            this.endTimeMs = endTimeMs;
            this.ongoing = ongoing;
        }

        public long getDurationMs() {
            return Math.max(0L, endTimeMs - startTimeMs);
        }
    }

    public static final class DailyUsageReport {
        public final LocalDate date;
        public final long windowStartMs;
        public final long windowEndMs;
        public final Map<String, Long> appScreenTimeMs = new HashMap<>();
        public final Map<String, Integer> appLaunchCounts = new HashMap<>();
        public final Map<String, Integer> appNotificationCounts = new HashMap<>();
        public final long[] hourlyScreenTimeMs = new long[24];
        public final int[] hourlyUnlocks = new int[24];
        public final List<Long> unlockEvents = new ArrayList<>();
        public long totalDeviceScreenTimeMs = 0L;
        public int totalDeviceUnlocks = 0;
        public int totalNotifications = 0;
        public final List<UsageSession> sessions = new ArrayList<>();

        public DailyUsageReport(LocalDate date, long windowStartMs, long windowEndMs) {
            this.date = date;
            this.windowStartMs = windowStartMs;
            this.windowEndMs = windowEndMs;
        }
    }

    public DailyUsageReport calculateDailyReport(
            LocalDate targetDate,
            ZoneId zoneId,
            List<UsageEventInput> rawEvents,
            Set<String> excludedHomeAndSystemPackages,
            long queryEvaluationTimeMs) {

        ZonedDateTime startOfDay = targetDate.atStartOfDay(zoneId);
        ZonedDateTime startOfNextDay = targetDate.plusDays(1).atStartOfDay(zoneId);
        long windowStartMs = startOfDay.toInstant().toEpochMilli();
        long windowEndMs = Math.min(startOfNextDay.toInstant().toEpochMilli(), queryEvaluationTimeMs);

        DailyUsageReport report = new DailyUsageReport(targetDate, windowStartMs, windowEndMs);
        if (windowEndMs <= windowStartMs) {
            return report;
        }

        List<UsageEventInput> sorted = new ArrayList<>(rawEvents);
        Collections.sort(sorted);

        String activePackage = null;
        long activeSessionStartMs = -1L;
        final Set<String> activeActivities = new HashSet<>();
        String pendingPausePackage = null;
        long pendingPauseStartMs = -1L;
        long pendingPauseAtMs = -1L;

        boolean screenInteractive = true;
        boolean keyguardLocked = false;
        String lastForegroundPackageForLaunch = null;

        // Batch-wide deduplication tracking across non-adjacent duplicate dumps
        Set<String> seenFingerprints = new HashSet<>();
        Map<String, List<long[]>> perAppClippedIntervalsMs = new HashMap<>();
        List<long[]> deviceClippedIntervalsMs = new ArrayList<>();

        for (UsageEventInput ev : sorted) {
            if (ev.timestampMs > queryEvaluationTimeMs) {
                break;
            }
            String fp = ev.eventType + "|" + ev.timestampMs + "|" + ev.packageName + "|" + ev.className + "|" + ev.instanceId;
            if (!seenFingerprints.add(fp)) {
                continue;
            }

            if (pendingPausePackage != null && ev.timestampMs - pendingPauseAtMs > INTRA_APP_TRANSITION_GAP_MS) {
                commitSessionClippedToWindow(
                        report, pendingPausePackage, pendingPauseStartMs, pendingPauseAtMs,
                        false, excludedHomeAndSystemPackages, startOfDay, zoneId, perAppClippedIntervalsMs, deviceClippedIntervalsMs);
                pendingPausePackage = null;
                pendingPauseStartMs = -1L;
                pendingPauseAtMs = -1L;
                lastForegroundPackageForLaunch = null;
            }

            switch (ev.eventType) {
                case TYPE_SCREEN_INTERACTIVE:
                    screenInteractive = true;
                    break;

                case TYPE_SCREEN_NON_INTERACTIVE:
                case TYPE_KEYGUARD_SHOWN:
                case TYPE_DEVICE_SHUTDOWN:
                    if (pendingPausePackage != null && pendingPauseStartMs >= 0L) {
                        commitSessionClippedToWindow(
                                report, pendingPausePackage, pendingPauseStartMs, pendingPauseAtMs,
                                false, excludedHomeAndSystemPackages, startOfDay, zoneId, perAppClippedIntervalsMs, deviceClippedIntervalsMs);
                        pendingPausePackage = null;
                        pendingPauseStartMs = -1L;
                        pendingPauseAtMs = -1L;
                    }
                    if (activePackage != null && activeSessionStartMs >= 0L) {
                        commitSessionClippedToWindow(
                                report, activePackage, activeSessionStartMs, ev.timestampMs,
                                false, excludedHomeAndSystemPackages, startOfDay, zoneId, perAppClippedIntervalsMs, deviceClippedIntervalsMs);
                        activePackage = null;
                        activeSessionStartMs = -1L;
                        activeActivities.clear();
                    }
                    if (ev.eventType == TYPE_KEYGUARD_SHOWN) {
                        keyguardLocked = true;
                        lastForegroundPackageForLaunch = null;
                    }
                    if (ev.eventType == TYPE_SCREEN_NON_INTERACTIVE || ev.eventType == TYPE_DEVICE_SHUTDOWN) {
                        screenInteractive = false;
                        keyguardLocked = true;
                        lastForegroundPackageForLaunch = null;
                    }
                    break;

                case TYPE_DEVICE_STARTUP:
                    pendingPausePackage = null;
                    pendingPauseStartMs = -1L;
                    pendingPauseAtMs = -1L;
                    activePackage = null;
                    activeSessionStartMs = -1L;
                    activeActivities.clear();
                    lastForegroundPackageForLaunch = null;
                    break;

                case TYPE_KEYGUARD_HIDDEN:
                    screenInteractive = true;
                    keyguardLocked = false;
                    if (ev.timestampMs >= windowStartMs && ev.timestampMs < windowEndMs) {
                        report.totalDeviceUnlocks++;
                        report.unlockEvents.add(ev.timestampMs);
                        int unlockHour = Instant.ofEpochMilli(ev.timestampMs).atZone(zoneId).getHour();
                        if (unlockHour >= 0 && unlockHour < 24) {
                            report.hourlyUnlocks[unlockHour]++;
                        }
                    }
                    break;

                case TYPE_NOTIFICATION_INTERRUPTION:
                    if (ev.timestampMs >= windowStartMs && ev.timestampMs < windowEndMs) {
                        report.appNotificationCounts.merge(ev.packageName, 1, Integer::sum);
                        report.totalNotifications++;
                    }
                    break;

                case TYPE_ACTIVITY_RESUMED:
                    if (!screenInteractive || keyguardLocked) {
                        break;
                    }
                    String actKey = ev.className.isEmpty() ? "__default__" : ev.className;
                    if (pendingPausePackage != null) {
                        if (pendingPausePackage.equals(ev.packageName)
                                && (ev.timestampMs - pendingPauseAtMs) <= INTRA_APP_TRANSITION_GAP_MS) {
                            activePackage = pendingPausePackage;
                            activeSessionStartMs = pendingPauseStartMs;
                            activeActivities.add(actKey);
                            pendingPausePackage = null;
                            pendingPauseStartMs = -1L;
                            pendingPauseAtMs = -1L;
                        } else {
                            commitSessionClippedToWindow(
                                    report, pendingPausePackage, pendingPauseStartMs, pendingPauseAtMs,
                                    false, excludedHomeAndSystemPackages, startOfDay, zoneId, perAppClippedIntervalsMs, deviceClippedIntervalsMs);
                            pendingPausePackage = null;
                            pendingPauseStartMs = -1L;
                            pendingPauseAtMs = -1L;
                        }
                    }

                    if (activePackage != null && activeSessionStartMs >= 0L) {
                        if (!activePackage.equals(ev.packageName)) {
                            commitSessionClippedToWindow(
                                    report, activePackage, activeSessionStartMs, ev.timestampMs,
                                    false, excludedHomeAndSystemPackages, startOfDay, zoneId, perAppClippedIntervalsMs, deviceClippedIntervalsMs);
                            activePackage = ev.packageName;
                            activeSessionStartMs = ev.timestampMs;
                            activeActivities.clear();
                            activeActivities.add(actKey);
                        } else {
                            activeActivities.add(actKey);
                        }
                    } else {
                        activePackage = ev.packageName;
                        activeSessionStartMs = ev.timestampMs;
                        activeActivities.clear();
                        activeActivities.add(actKey);
                    }

                    if (ev.timestampMs >= windowStartMs && ev.timestampMs < windowEndMs) {
                        if (!excludedHomeAndSystemPackages.contains(ev.packageName)
                                && !ev.packageName.equals(lastForegroundPackageForLaunch)) {
                            report.appLaunchCounts.merge(ev.packageName, 1, Integer::sum);
                        }
                    }
                    lastForegroundPackageForLaunch = ev.packageName;
                    break;

                case TYPE_ACTIVITY_PAUSED:
                case TYPE_ACTIVITY_STOPPED:
                    if (activePackage != null && activePackage.equals(ev.packageName) && activeSessionStartMs >= 0L) {
                        String pauseActKey = ev.className.isEmpty() ? "__default__" : ev.className;
                        if (ev.className.isEmpty()) {
                            activeActivities.clear();
                        } else {
                            activeActivities.remove(pauseActKey);
                            if (activeActivities.contains("__default__") && activeActivities.size() == 1) {
                                activeActivities.clear();
                            }
                        }
                        if (activeActivities.isEmpty()) {
                            pendingPausePackage = activePackage;
                            pendingPauseStartMs = activeSessionStartMs;
                            pendingPauseAtMs = ev.timestampMs;
                            activePackage = null;
                            activeSessionStartMs = -1L;
                        }
                    }
                    break;

                default:
                    break;
            }
        }

        if (pendingPausePackage != null && pendingPauseStartMs >= 0L) {
            commitSessionClippedToWindow(
                    report, pendingPausePackage, pendingPauseStartMs, pendingPauseAtMs,
                    false, excludedHomeAndSystemPackages, startOfDay, zoneId, perAppClippedIntervalsMs, deviceClippedIntervalsMs);
        }

        // Ongoing session still active at queryEvaluationTimeMs / windowEndMs
        if (activePackage != null && activeSessionStartMs >= 0L && screenInteractive && !keyguardLocked) {
            if (activeSessionStartMs < windowEndMs) {
                commitSessionClippedToWindow(
                        report, activePackage, activeSessionStartMs, windowEndMs,
                        true, excludedHomeAndSystemPackages, startOfDay, zoneId, perAppClippedIntervalsMs, deviceClippedIntervalsMs);
            }
        }

        // Merge per-package intervals so overlapping activities within an app never double-count
        for (Map.Entry<String, List<long[]>> entry : perAppClippedIntervalsMs.entrySet()) {
            List<long[]> mergedApp = mergeIntervalsMs(entry.getValue());
            long pkgTotalMs = 0L;
            for (long[] iv : mergedApp) {
                pkgTotalMs += Math.max(0L, iv[1] - iv[0]);
            }
            report.appScreenTimeMs.put(entry.getKey(), pkgTotalMs);
        }

        // Merge device-wide non-excluded intervals so split-screen / PiP never exceeds 60m per hour
        List<long[]> mergedDevice = mergeIntervalsMs(deviceClippedIntervalsMs);
        for (long[] iv : mergedDevice) {
            long clippedStart = iv[0];
            long clippedEnd = iv[1];
            report.totalDeviceScreenTimeMs += Math.max(0L, clippedEnd - clippedStart);
            int totalWindowHours = Math.max(24, (int) Math.ceil((report.windowEndMs - report.windowStartMs) / 3600000.0));
            for (int hour = 0; hour < totalWindowHours; hour++) {
                long hStart = startOfDay.plusHours(hour).toInstant().toEpochMilli();
                long hEnd = startOfDay.plusHours(hour + 1).toInstant().toEpochMilli();
                long overlapStart = Math.max(clippedStart, hStart);
                long overlapEnd = Math.min(clippedEnd, hEnd);
                if (overlapEnd > overlapStart) {
                    int targetHourIdx = Math.min(23, hour);
                    report.hourlyScreenTimeMs[targetHourIdx] += (overlapEnd - overlapStart);
                }
            }
        }

        return report;
    }

    public static List<long[]> mergeIntervalsMs(List<long[]> intervals) {
        List<long[]> valid = new ArrayList<>();
        if (intervals != null) {
            for (long[] iv : intervals) {
                if (iv != null && iv.length >= 2 && iv[1] > iv[0]) {
                    valid.add(new long[]{iv[0], iv[1]});
                }
            }
        }
        if (valid.isEmpty()) {
            return valid;
        }
        Collections.sort(valid, (a, b) -> {
            int c = Long.compare(a[0], b[0]);
            return c != 0 ? c : Long.compare(a[1], b[1]);
        });
        List<long[]> merged = new ArrayList<>();
        merged.add(new long[]{valid.get(0)[0], valid.get(0)[1]});
        for (int i = 1; i < valid.size(); i++) {
            long[] cur = valid.get(i);
            long[] last = merged.get(merged.size() - 1);
            if (cur[0] <= last[1]) {
                last[1] = Math.max(last[1], cur[1]);
            } else {
                merged.add(new long[]{cur[0], cur[1]});
            }
        }
        return merged;
    }

    private void commitSessionClippedToWindow(
            DailyUsageReport report,
            String packageName,
            long rawStartMs,
            long rawEndMs,
            boolean ongoing,
            Set<String> excludedPackages,
            ZonedDateTime startOfDay,
            ZoneId zoneId,
            Map<String, List<long[]>> perAppClippedIntervalsMs,
            List<long[]> deviceClippedIntervalsMs) {

        if (rawEndMs <= rawStartMs) {
            return;
        }
        long clippedStart = Math.max(rawStartMs, report.windowStartMs);
        long clippedEnd = Math.min(rawEndMs, report.windowEndMs);
        if (clippedEnd <= clippedStart) {
            return;
        }

        UsageSession session = new UsageSession(packageName, clippedStart, clippedEnd, ongoing);
        report.sessions.add(session);

        if (excludedPackages != null && excludedPackages.contains(packageName)) {
            return;
        }

        perAppClippedIntervalsMs.computeIfAbsent(packageName, k -> new ArrayList<>())
                .add(new long[]{clippedStart, clippedEnd});
        deviceClippedIntervalsMs.add(new long[]{clippedStart, clippedEnd});
    }
}
