import io.screensync.wellness.AppTimerPolicy;

public class AppTimerPolicyTest {
    private static void assertTrue(boolean cond, String msg) {
        if (!cond) throw new AssertionError("FAIL: " + msg);
    }

    public static void main(String[] args) {
        // 1. Schedule normalization
        assertTrue(AppTimerPolicy.SCHEDULE_EVERYDAY.equals(AppTimerPolicy.normalizeScheduleKey("Everyday")), "Everyday normalization");
        assertTrue(AppTimerPolicy.SCHEDULE_WEEKDAYS.equals(AppTimerPolicy.normalizeScheduleKey("Monday\u2013Friday")), "Monday-Friday en-dash normalization");
        assertTrue(AppTimerPolicy.SCHEDULE_WEEKDAYS.equals(AppTimerPolicy.normalizeScheduleKey("Weekdays (Mon-Fri)")), "Weekdays alias normalization");
        assertTrue(AppTimerPolicy.SCHEDULE_WEEKENDS.equals(AppTimerPolicy.normalizeScheduleKey("Saturday\u2013Sunday")), "Saturday-Sunday en-dash normalization");
        assertTrue(AppTimerPolicy.SCHEDULE_WEEKENDS.equals(AppTimerPolicy.normalizeScheduleKey("Weekends (Sat-Sun)")), "Weekends alias normalization");

        // 2. Day-of-week schedule evaluation (1 = Sun, 4 = Wed, 7 = Sat)
        assertTrue(AppTimerPolicy.isScheduleActiveOnDayOfWeek("Monday\u2013Friday", 4), "Monday-Friday active on Wednesday");
        assertTrue(!AppTimerPolicy.isScheduleActiveOnDayOfWeek("Monday\u2013Friday", 7), "Monday-Friday inactive on Saturday");
        assertTrue(!AppTimerPolicy.isScheduleActiveOnDayOfWeek("Monday\u2013Friday", 1), "Monday-Friday inactive on Sunday");
        assertTrue(AppTimerPolicy.isScheduleActiveOnDayOfWeek("Saturday\u2013Sunday", 7), "Saturday-Sunday active on Saturday");
        assertTrue(AppTimerPolicy.isScheduleActiveOnDayOfWeek("Saturday\u2013Sunday", 1), "Saturday-Sunday active on Sunday");
        assertTrue(!AppTimerPolicy.isScheduleActiveOnDayOfWeek("Saturday\u2013Sunday", 4), "Saturday-Sunday inactive on Wednesday");

        // 3. Timer block evaluation & exempt package check
        assertTrue(AppTimerPolicy.shouldEnforceTimerBlock(30L * 60000L, 30, "Everyday", 4, false), "30m used of 30m limit blocks non-exempt package");
        assertTrue(!AppTimerPolicy.shouldEnforceTimerBlock(29L * 60000L, 30, "Everyday", 4, false), "29m used of 30m limit does not block");
        assertTrue(!AppTimerPolicy.shouldEnforceTimerBlock(45L * 60000L, 30, "Monday\u2013Friday", 7, false), "Weekday timer does not block on Saturday");
        assertTrue(!AppTimerPolicy.shouldEnforceTimerBlock(45L * 60000L, 30, "Everyday", 4, true), "Exempt system/launcher package is never blocked");

        // 4. Home intercept cooldown (1.5s) vs overlay banner cooldown (60s)
        assertTrue(AppTimerPolicy.shouldPerformHomeIntercept(5000L, 2000L), "Re-opening blocked app 3s later triggers HOME intercept");
        assertTrue(!AppTimerPolicy.shouldPerformHomeIntercept(2500L, 2000L), "Sub-1.5s bounce is debounced");
        assertTrue(!AppTimerPolicy.shouldShowTimerOverlayBanner(5000L, 2000L), "Banner is throttled within 60s window");
        assertTrue(AppTimerPolicy.shouldShowTimerOverlayBanner(65000L, 2000L), "Banner is shown again after 60s window");

        // 5. Overnight Quiet Hours & Bedtime Wind-Down evaluation
        int qStart = AppTimerPolicy.parseHHMMToMinutes("22:30", 1350);
        int qEnd = AppTimerPolicy.parseHHMMToMinutes("07:00", 420);
        assertTrue(AppTimerPolicy.isWithinQuietHours(23 * 60 + 15, qStart, qEnd), "23:15 is within 22:30-07:00 Quiet Hours");
        assertTrue(AppTimerPolicy.isWithinQuietHours(1 * 60 + 30, qStart, qEnd), "01:30 is within 22:30-07:00 Quiet Hours");
        assertTrue(!AppTimerPolicy.isWithinQuietHours(14 * 60, qStart, qEnd), "14:00 is outside 22:30-07:00 Quiet Hours");

        long nowMs = 1763335800000L;
        assertTrue(
            AppTimerPolicy.shouldTriggerBedtimeWindDown(15L * 60000L, nowMs, 0L, 0L, true, true, true, 23 * 60 + 15, qStart, qEnd),
            "15m continuous watch during Quiet Hours triggers Wind-Down"
        );
        assertTrue(
            !AppTimerPolicy.shouldTriggerBedtimeWindDown(15L * 60000L, nowMs, 0L, nowMs + 600000L, true, true, true, 23 * 60 + 15, qStart, qEnd),
            "Active snooze suppresses Wind-Down trigger"
        );
        assertTrue(
            !AppTimerPolicy.shouldTriggerBedtimeWindDown(15L * 60000L, nowMs, 0L, 0L, true, true, false, 23 * 60 + 15, qStart, qEnd),
            "Disabled windDownEnabled suppresses Wind-Down trigger"
        );

        System.out.println("[PASS] AppTimerPolicyTest: All 18 pure-Java policy assertions passed.");
    }
}
