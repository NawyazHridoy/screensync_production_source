/*
 * ScreenSync Pure-Java App Timer & Bedtime Wind-Down Policy Evaluator
 * Package: io.screensync.wellness
 * Zero Android SDK dependencies so it can be unit-tested directly on JVM (javac/java)
 * while powering ScreenSyncAccessibilityService and MainActivity at runtime.
 */
package io.screensync.wellness;

import java.util.Locale;

public final class AppTimerPolicy {
    public static final String SCHEDULE_EVERYDAY = "EVERYDAY";
    public static final String SCHEDULE_WEEKDAYS = "WEEKDAYS";
    public static final String SCHEDULE_WEEKENDS = "WEEKENDS";

    public static final long HOME_ENFORCEMENT_COOLDOWN_MS = 1500L;
    public static final long OVERLAY_BANNER_COOLDOWN_MS = 60000L;
    public static final long BEDTIME_REEL_LIMIT_MS = 15L * 60L * 1000L;
    public static final long BEDTIME_ALERT_COOLDOWN_MS = 15L * 60L * 1000L;

    private AppTimerPolicy() {}

    /**
     * Normalizes a schedule string ("Everyday", "Monday–Friday", "Weekdays", "Mon-Fri",
     * "Saturday–Sunday", "Weekends", "Sat-Sun") into a canonical key.
     */
    public static String normalizeScheduleKey(String rawSchedule) {
        if (rawSchedule == null) return SCHEDULE_EVERYDAY;
        String norm = rawSchedule.trim().toLowerCase(Locale.US)
                .replace('\u2013', '-')
                .replace('\u2014', '-');
        if (norm.isEmpty() || norm.equals("everyday") || norm.equals("daily") || norm.equals("all days")) {
            return SCHEDULE_EVERYDAY;
        }
        if (norm.contains("monday-friday") || norm.contains("mon-fri") || norm.contains("weekday")) {
            return SCHEDULE_WEEKDAYS;
        }
        if (norm.contains("saturday-sunday") || norm.contains("sat-sun") || norm.contains("weekend")) {
            return SCHEDULE_WEEKENDS;
        }
        return SCHEDULE_EVERYDAY;
    }

    /**
     * Evaluates whether a schedule is active on the given java.util.Calendar.DAY_OF_WEEK
     * (1 = Sunday, 2 = Monday, ..., 6 = Friday, 7 = Saturday).
     */
    public static boolean isScheduleActiveOnDayOfWeek(String rawSchedule, int calendarDayOfWeek) {
        String key = normalizeScheduleKey(rawSchedule);
        boolean isWeekend = (calendarDayOfWeek == 1 || calendarDayOfWeek == 7);
        if (SCHEDULE_WEEKDAYS.equals(key)) {
            return !isWeekend;
        }
        if (SCHEDULE_WEEKENDS.equals(key)) {
            return isWeekend;
        }
        return true;
    }

    /**
     * Parses an "HH:MM" 24-hour string into minutes since midnight [0..1439].
     */
    public static int parseHHMMToMinutes(String hhmm, int fallbackMinutes) {
        if (hhmm == null || !hhmm.contains(":")) return fallbackMinutes;
        try {
            String[] parts = hhmm.trim().split(":");
            int h = Integer.parseInt(parts[0].trim());
            int m = Integer.parseInt(parts[1].trim());
            if (h < 0 || h > 23 || m < 0 || m > 59) return fallbackMinutes;
            return h * 60 + m;
        } catch (Exception e) {
            return fallbackMinutes;
        }
    }

    /**
     * Evaluates whether currentMinuteOfDay falls inside [startMinuteOfDay, endMinuteOfDay),
     * supporting both same-day windows and overnight wrap-around windows (e.g. 22:30 -> 07:00).
     */
    public static boolean isWithinQuietHours(int currentMinuteOfDay, int startMinuteOfDay, int endMinuteOfDay) {
        if (startMinuteOfDay == endMinuteOfDay) return false;
        if (startMinuteOfDay < endMinuteOfDay) {
            return currentMinuteOfDay >= startMinuteOfDay && currentMinuteOfDay < endMinuteOfDay;
        }
        return currentMinuteOfDay >= startMinuteOfDay || currentMinuteOfDay < endMinuteOfDay;
    }

    /**
     * Pure policy evaluation for per-app daily timer enforcement.
     */
    public static boolean shouldEnforceTimerBlock(
            long usedMs,
            int limitMinutes,
            String schedule,
            int calendarDayOfWeek,
            boolean isExemptPackage) {
        if (isExemptPackage || limitMinutes <= 0) return false;
        if (!isScheduleActiveOnDayOfWeek(schedule, calendarDayOfWeek)) return false;
        long limitMs = (long) limitMinutes * 60000L;
        return usedMs >= limitMs;
    }

    /**
     * Pure policy evaluation for whether a home-navigation action and/or overlay banner
     * should be emitted given elapsedRealtime timestamps.
     */
    public static boolean shouldPerformHomeIntercept(long nowElapsedMs, long lastHomeActionElapsedMs) {
        if (lastHomeActionElapsedMs <= 0L) return true;
        return (nowElapsedMs - lastHomeActionElapsedMs) >= HOME_ENFORCEMENT_COOLDOWN_MS;
    }

    public static boolean shouldShowTimerOverlayBanner(long nowElapsedMs, long lastOverlayBannerElapsedMs) {
        if (lastOverlayBannerElapsedMs <= 0L) return true;
        return (nowElapsedMs - lastOverlayBannerElapsedMs) >= OVERLAY_BANNER_COOLDOWN_MS;
    }

    /**
     * Pure policy evaluation for Bedtime Wind-Down trigger during Quiet Hours.
     */
    public static boolean shouldTriggerBedtimeWindDown(
            long continuousWatchMs,
            long nowEpochMs,
            long lastAlertEpochMs,
            long snoozedUntilEpochMs,
            boolean masterEnabled,
            boolean quietHoursEnabled,
            boolean windDownEnabled,
            int currentMinuteOfDay,
            int startMinuteOfDay,
            int endMinuteOfDay) {
        if (!masterEnabled || !quietHoursEnabled || !windDownEnabled) return false;
        if (!isWithinQuietHours(currentMinuteOfDay, startMinuteOfDay, endMinuteOfDay)) return false;
        if (snoozedUntilEpochMs > 0L && nowEpochMs < snoozedUntilEpochMs) return false;
        if (continuousWatchMs < BEDTIME_REEL_LIMIT_MS) return false;
        if (lastAlertEpochMs > 0L && (nowEpochMs - lastAlertEpochMs) < BEDTIME_ALERT_COOLDOWN_MS) return false;
        return true;
    }
}
