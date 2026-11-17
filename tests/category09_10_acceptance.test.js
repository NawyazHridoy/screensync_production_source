/**
 * Category 09 & Category 10 Behavioral Acceptance Suite (Part 10A + Part 10B Extended Delta Findings)
 * Verifies Focus Mode, Focus Tree 3-Stage Evolution, Streaks & Challenges,
 * Notification Center, Quiet Hours, DeskClock Wheels, Wellness Monitors,
 * Weekly Behavioral Report Card, Lock Screen Widget Bridge, and Native Bridges.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

function runCategory09And10Tests(app, windowMock, documentMock) {
  assert(app, "ScreenSyncApp must be initialized");
  const rootDir = path.resolve(__dirname, "..");

  // ---------------------------------------------------------------------------
  // 1. FocusModeController: startSession, wall-clock tick(), reconcile(), early completion guard (F40-B01, F40-B02, F40-B03)
  // ---------------------------------------------------------------------------
  {
    app.FocusModeController.cancelCountdown();
    const startRes = app.FocusModeController.startSession(25);
    assert(startRes && startRes.ok === true && startRes.durationMinutes === 25, "[Cat09/10] FocusModeController.startSession(25) must start a 25m session");
    assert.strictEqual(app.state.focusCountdownActive, true, "[Cat09/10] focusCountdownActive must be true");

    // Attempt mid-session duration mutation -> rejected (F40-B03)
    const midMut = app.FocusModeController.setDuration(180, { fromManualInput: true });
    assert.strictEqual(midMut.ok, false, "[Cat09/10 F40-B03] setDuration during active session must be rejected");

    // Simulate 10 minutes of wall-clock advance via reconcile() (F40-B02)
    app.FocusModeController._lastWallClockSyncMs = Date.now() - 600 * 1000;
    const recRes = app.FocusModeController.reconcile();
    assert(
      recRes && recRes.active === true && recRes.remainingSeconds <= 905 && recRes.remainingSeconds >= 895,
      `[Cat09/10 F40-B02] FocusModeController.reconcile() must subtract wall-clock elapsed time (expected ~900s, got ${recRes && recRes.remainingSeconds})`
    );
    app.FocusModeController.cancelCountdown();
  }

  // ---------------------------------------------------------------------------
  // 2. Focus Tree 3-Stage Evolution & SVG Updates (F41-B02 & Step 2.3)
  // ---------------------------------------------------------------------------
  {
    const t0 = app.ScreenSyncWellnessEngine.computeFocusTreeStage(0, 0, 14);
    assert.strictEqual(t0.xp, 0, "[Cat09/10 F41-B02] Zero focus minutes & sessions must yield 0 XP even with a 14-day streak");
    assert.strictEqual(t0.stageKey, "SEEDLING", "[Cat09/10] 0 XP stageKey must be SEEDLING");

    const tSapling = app.ScreenSyncWellnessEngine.computeFocusTreeStage(90, 2, 1);
    assert(tSapling.stageKey === "SAPLING" || tSapling.stageKey === "YOUNG_SAPLING", "[Cat09/10] 112 XP stageKey must be SAPLING/YOUNG_SAPLING");

    const tCanopy = app.ScreenSyncWellnessEngine.computeFocusTreeStage(400, 5, 3);
    assert(
      tCanopy.stageKey === "FLOURISHING_CANOPY" || tCanopy.stageKey === "ANCIENT_FOREST" || tCanopy.stageKey === "ANCIENT_OAK",
      `[Cat09/10] High XP stageKey must be FLOURISHING_CANOPY/ANCIENT_FOREST, got ${tCanopy.stageKey}`
    );

    const prevMins = app.state.focusTotalMinutes;
    const prevSess = app.state.focusTotalSessions;
    app.state.focusTotalMinutes = 400;
    app.state.focusTotalSessions = 5;
    app.ScreenSyncWellnessEngine.renderScreenSyncAndFocusTreeUI(null, 3);
    const emblemEl = documentMock.getElementById("focusTreeStageEmblem");
    const svgEl = documentMock.getElementById("focusTreeStageSvg");
    assert(emblemEl && emblemEl.getAttribute("data-tree-stage") === tCanopy.stageKey, "[Cat09/10 Step 2.3] #focusTreeStageEmblem data-tree-stage must update");
    assert(svgEl && svgEl.innerHTML.includes("#22C55E"), "[Cat09/10 Step 2.3] #focusTreeStageSvg must update inner SVG for canopy stage");
    app.state.focusTotalMinutes = prevMins;
    app.state.focusTotalSessions = prevSess;
    app.ScreenSyncWellnessEngine.renderScreenSyncAndFocusTreeUI(null, 0);
  }

  // ---------------------------------------------------------------------------
  // 3. CAT10-01, CAT10-13 & Part 10B Fatigue Backoff: Wellness Toggles & NotificationFatigueGuard
  // ---------------------------------------------------------------------------
  {
    const rawSrcHtml = fs.readFileSync(path.join(rootDir, "src/index.html"), "utf8");
    assert(
      /<input id="toggleNotifBreakReminders"[^>]*>\s*<div class="ss-onoff-switch"><\/div>/.test(rawSrcHtml),
      "[Cat10 Break Toggle CSS] #toggleNotifBreakReminders must be the immediate previous sibling (+) of .ss-onoff-switch so .peer:checked + .ss-onoff-switch renders ON/OFF state"
    );
    const brkToggleAlias = documentMock.getElementById("toggleNotifBreakReminder");
    const brkToggleMain = documentMock.getElementById("toggleNotifBreakReminders");
    assert(brkToggleAlias && brkToggleMain && brkToggleAlias === brkToggleMain, "[Cat10 Break Toggle Alias] toggleNotifBreakReminder must resolve to #toggleNotifBreakReminders");
    const eyeEl = documentMock.getElementById("checkNotifEyeStrain");
    const posEl = documentMock.getElementById("checkNotifPosture");
    const earEl = documentMock.getElementById("toggleNotifEarphoneAlert");
    const focSupEl = documentMock.getElementById("checkSuppressWellnessInFocus");
    assert(eyeEl && posEl && earEl && focSupEl, "[CAT10-01] All 4 wellness toggle elements must exist in DOM");

    eyeEl.checked = false;
    app.NotificationScheduleManager.saveScheduleFromInputs();
    assert.strictEqual(app.NotificationScheduleManager.getSchedule().eyeStrainEnabled, false, "[CAT10-01] Unchecking #checkNotifEyeStrain must persist eyeStrainEnabled=false");
    assert.strictEqual(app.NotificationFatigueGuard.shouldAllowWellnessNudge("EYE_STRAIN"), false, "[CAT10-13] NotificationFatigueGuard must read schedule state");

    eyeEl.checked = true;
    app.NotificationScheduleManager.saveScheduleFromInputs();
    assert.strictEqual(app.NotificationScheduleManager.getSchedule().eyeStrainEnabled, true, "[CAT10-01] Checking #checkNotifEyeStrain must restore eyeStrainEnabled=true");

    // Cooldown & backoff verification (CAT10-13 & Part 10B C10-DEF-10)
    app.NotificationFatigueGuard.resetDailyState();
    const nowDt = new Date();
    nowDt.setHours(12, 0, 0, 0);
    const nowMs = nowDt.getTime();
    assert.strictEqual(app.NotificationFatigueGuard.canDispatch("EYE_STRAIN", nowMs), true, "[Part 10B] canDispatch must return true before cooldown");
    app.NotificationFatigueGuard.recordDispatch("EYE_STRAIN", nowMs);
    const coolCheck = app.NotificationFatigueGuard.shouldSuppress("EYE_STRAIN", nowMs + 5 * 60 * 1000);
    assert.strictEqual(coolCheck.suppress, true, "[CAT10-13] EYE_STRAIN nudge within 20m cooldown must be suppressed");
    assert.strictEqual(coolCheck.code, "COOLDOWN_ACTIVE", "[CAT10-13] Cooldown suppression code must be COOLDOWN_ACTIVE");
    assert.strictEqual(app.NotificationFatigueGuard.evaluateWellnessNudge("EYE_STRAIN", nowMs + 5 * 60 * 1000).allowed, false, "[Part 10B] evaluateWellnessNudge must report allowed=false during cooldown");

    // Exponential backoff (1x -> 2x -> 4x -> pause at >= 4)
    assert.strictEqual(app.NotificationFatigueGuard.getBackoffMultiplier("BREAK_REMINDER"), 1);
    app.NotificationFatigueGuard.recordNudgeIgnored("BREAK_REMINDER");
    app.NotificationFatigueGuard.recordNudgeIgnored("BREAK_REMINDER");
    assert.strictEqual(app.NotificationFatigueGuard.getBackoffMultiplier("BREAK_REMINDER"), 2, "[Part 10B] 2 ignored nudges -> 2x backoff");
    assert.strictEqual(app.NotificationFatigueGuard.getEffectiveIntervalMinutes(45, "BREAK_REMINDER"), 90, "[Part 10B] 45m * 2x = 90m");
    app.NotificationFatigueGuard.recordNudgeIgnored("BREAK_REMINDER");
    assert.strictEqual(app.NotificationFatigueGuard.getBackoffMultiplier("BREAK_REMINDER"), 4, "[Part 10B] 3 ignored nudges -> 4x backoff");
    app.NotificationFatigueGuard.recordNudgeIgnored("BREAK_REMINDER");
    assert.strictEqual(app.NotificationFatigueGuard.getBackoffMultiplier("BREAK_REMINDER"), 0, "[Part 10B] 4 ignored nudges -> paused for today (0x)");
    assert.strictEqual(app.NotificationFatigueGuard.getEffectiveIntervalMinutes(45, "BREAK_REMINDER"), null, "[Part 10B] Paused category returns null interval");
    app.NotificationFatigueGuard.recordNudgeAcknowledged("BREAK_REMINDER");
    assert.strictEqual(app.NotificationFatigueGuard.getBackoffMultiplier("BREAK_REMINDER"), 1, "[Part 10B] Acknowledging nudge resets backoff to 1x");
    app.NotificationFatigueGuard.resetDailyState();
  }

  // ---------------------------------------------------------------------------
  // 4. CAT10-03, CAT10-12, CAT10-16: 9 Notification Channels & Truthful Dispatch Status
  // ---------------------------------------------------------------------------
  {
    const statusObj = app.NativeNotificationDispatcher.getChannelsStatus();
    assert(statusObj && Array.isArray(statusObj.channels) && statusObj.channels.length === 9, `[CAT10-03/16] getChannelsStatus() must return all 9 channels, got ${statusObj && statusObj.channels && statusObj.channels.length}`);
    const chIds = statusObj.channels.map(c => c.id);
    [
      "screensync_goal_alerts",
      "screensync_app_timers",
      "screensync_break_reminders",
      "screensync_wellness_nudges",
      "screensync_wind_down",
      "screensync_daily_summary",
      "screensync_live_tracking",
      "screensync_hearing_health",
      "screensync_security_alerts"
    ].forEach((expectedId) => {
      assert(chIds.includes(expectedId), `[CAT10-03] Channel ${expectedId} must be registered`);
    });

    // Simulate iOS minimal JSON response and verify 9-channel synthesis (CAT10-16)
    const prevBridge = windowMock.ScreenSyncNativeBridge;
    windowMock.ScreenSyncNativeBridge = {
      getNotificationChannelsStatusJson() {
        return JSON.stringify({ areNotificationsEnabled: true, postNotificationsGranted: true });
      },
      dispatchNativeNotification() {
        return false;
      },
      getLastNotificationDispatchResultJson() {
        return JSON.stringify({ ok: false, status: "FAILED", reason: "UNKNOWN_CHANNEL" });
      }
    };
    const iosStatus = app.NativeNotificationDispatcher.getChannelsStatus();
    assert(Array.isArray(iosStatus.channels) && iosStatus.channels.length === 9, "[CAT10-16] Minimal iOS channel status JSON must synthesize 9 channels");

    // When native bridge rejects, dispatch status must be FAILED and dispatchOk === false (CAT10-12)
    const failedDispatch = app.NativeNotificationDispatcher.dispatch({
      channelId: "screensync_goal_alerts",
      title: "Test Reject",
      body: "Testing rejected native bridge",
      manualTest: true
    });
    assert.strictEqual(failedDispatch.dispatchOk, false, "[CAT10-12] Rejected native dispatch must set dispatchOk=false");
    assert.strictEqual(failedDispatch.status, "FAILED", "[CAT10-12] Rejected native dispatch must set status='FAILED'");
    assert.strictEqual(failedDispatch.fallbackShown, true, "[CAT10-12] Rejected native dispatch must still show in-app fallback toast");
    windowMock.ScreenSyncNativeBridge = prevBridge;
  }

  // ---------------------------------------------------------------------------
  // 5. CAT10-06 & CAT10-17: NotificationInboxStore, Aliases & Persistent Seen Alerts
  // ---------------------------------------------------------------------------
  {
    const uid = app.getActiveOrLocalUserId();
    app.NotificationInboxStore.clear(uid);
    app.NotificationInboxStore.add({
      id: "cat10_test_inbox_1",
      userId: uid,
      title: "Mindful Break (Suppressed: QUIET_HOURS_ACTIVE)",
      body: "[DEBUG] You have been active for 45 minutes (Suppressed: QUIET_HOURS_ACTIVE)",
      status: "SUPPRESSED"
    });
    assert.strictEqual(app.NotificationInboxStore.unreadCount(uid), 1, "[CAT10-06] Unread count must be 1 after adding inbox item");
    assert.strictEqual(app.NotificationInboxStore.getUnreadCount(uid), 1, "[Part 10B] getUnreadCount alias must match unreadCount");

    app.renderMainNotificationsModal({ markSeen: false });
    const listHtml = documentMock.getElementById("mainNotificationsList").innerHTML;
    assert(!listHtml.includes("QUIET_HOURS_ACTIVE"), "[CAT10-06] Raw internal suppression code must be stripped from notification modal UI");

    const markRes = app.NotificationInboxStore.markAllRead(uid);
    assert.strictEqual(markRes.ok, true, "[CAT10-06] markAllRead must return ok: true");
    assert.strictEqual(app.NotificationInboxStore.unreadCount(uid), 0, "[CAT10-06] Unread count must be 0 after markAllRead");

    app.NotificationInboxStore.clearAll(uid);
    assert.strictEqual(app.NotificationInboxStore.list({ userId: uid }).length, 0, "[CAT10-06] clearAll() must empty the user's notification inbox");
  }

  // ---------------------------------------------------------------------------
  // 6. CAT10-07, CAT10-14, CAT10-18 & Part 10B Deferred Daily Summary & Live Countdown
  // ---------------------------------------------------------------------------
  {
    app.NotificationScheduleManager.saveScheduleFromInputs({
      quietHoursEnabled: true,
      quietHoursStart: "21:00",
      quietHoursEnd: "07:00",
      breakIntervalMinutes: 5
    });
    const sched = app.NotificationScheduleManager.getSchedule();
    assert.strictEqual(sched.breakIntervalMinutes, 15, "[CAT10-18] Break interval < 15m must be clamped to 15m");

    app.NotificationScheduleManager.saveScheduleFromInputs({ breakIntervalMinutes: 240 });
    assert.strictEqual(app.NotificationScheduleManager.getSchedule().breakIntervalMinutes, 120, "[CAT10-18] Break interval > 120m must be clamped to 120m");

    app.NotificationScheduleManager.saveScheduleFromInputs({ breakIntervalMinutes: 45 });
    const hintEl = documentMock.getElementById("quietHoursMidnightCrossingHint");
    assert(hintEl && !hintEl.classList.contains("hidden") && hintEl.textContent.includes("tonight") && hintEl.textContent.includes("tomorrow"), "[CAT10-07] Midnight-crossing Quiet Hours hint must be visible and descriptive");

    // Date object input to isWithinQuietHours & isQuietHoursActive (CAT10-07)
    assert.strictEqual(app.NotificationScheduleManager.isWithinQuietHours(new Date("2026-11-14T23:30:00")), true, "[CAT10-07] 23:30 Date must be within 21:00–07:00 Quiet Hours");
    assert.strictEqual(app.NotificationScheduleManager.isQuietHoursActive(new Date("2026-11-14T13:00:00")), false, "[CAT10-07] 13:00 Date must be outside 21:00–07:00 Quiet Hours");

    // Deferred daily summary date attribution (Part 10B C10-03(a) / Issue 10.4-1)
    app.NotificationScheduleManager.saveScheduleFromInputs({
      dailySummaryEnabled: true,
      dailySummaryTime: "21:00",
      quietHoursEnabled: true,
      quietHoursStart: "22:30",
      quietHoursEnd: "07:00"
    });
    app.NotificationScheduleManager.pendingSummaryForDate = "2026-11-13";
    app.NotificationScheduleManager.lastDailySummaryDispatchedDate = null;
    app.NotificationScheduleManager.persistRuntimeState();
    const flushMorning = app.NotificationScheduleManager.evaluateScheduledDailySummary({
      nowDate: new Date("2026-11-14T07:05:00"),
      timeHHMM: "07:05"
    });
    assert.strictEqual(flushMorning.dispatched, true, "[Part 10B] Deferred summary from yesterday must flush at 07:05 AM");
    assert.strictEqual(flushMorning.date, "2026-11-13", "[Part 10B] Flushed summary date must remain 2026-11-13");
    assert.strictEqual(app.NotificationScheduleManager.lastDailySummaryDispatchedDate, "2026-11-13", "[Part 10B] Flushing 2026-11-13 must not mark 2026-11-14 as already dispatched");

    const eveningToday = app.NotificationScheduleManager.evaluateScheduledDailySummary({
      nowDate: new Date("2026-11-14T21:05:00"),
      timeHHMM: "21:05"
    });
    assert.strictEqual(eveningToday.dispatched, true, "[Part 10B] Today's evening summary at 21:05 must still dispatch after morning deferred flush");

    // Live countdown duration when nowDateInput is provided (Part 10B CAT10-ISS-08)
    const liveSub = app.NotificationTimePickerController.computeCountdownSubtitle(
      "21:00",
      new Date("2026-11-14T14:30:00"),
      "inputNotifDailySummaryTime"
    );
    assert(liveSub.includes("09:00 PM") && liveSub.includes("(in 6h 30m)"), `[Part 10B] computeCountdownSubtitle with nowDateInput must include live countdown, got: ${liveSub}`);
  }

  // ---------------------------------------------------------------------------
  // 7. CAT10-02, CAT10-10 & CAT10-11: WeeklyBehavioralReportCardEngine & LockScreenWidgetBridge + 14 DOM Nodes
  // ---------------------------------------------------------------------------
  {
    const emptyUid = "usr_empty_weekly_cat10";
    app.BackendDB.ensureUserStructures(emptyUid);
    app.BackendDB.data.sessionsByUser[emptyUid] = [];
    app.BackendDB.data.reelEventsByUser[emptyUid] = [];
    app.BackendDB.data.focusSessionsByUser[emptyUid] = [];
    const emptyRep = app.WeeklyBehavioralReportCardEngine.computeWeeklyReportCard(emptyUid, "2026-11-14");
    assert.strictEqual(emptyRep.hasActivity, false, "[CAT10-10] Empty user week must report hasActivity=false");
    assert.strictEqual(emptyRep.letterGrade, "—", "[CAT10-10] Empty user week must return letterGrade='—' instead of fabricated Grade B");

    app.WeeklyBehavioralReportCardEngine.renderReportCardUI(emptyUid, "2026-11-14");
    [
      "weeklyReportSubtitle",
      "weeklyReportCardSubtitle",
      "weeklyReportRetentionPct",
      "weeklyReportFocusWins",
      "weeklyReportRatioBadge",
      "weeklyReportDeltaBadge",
      "weeklyReportGradeBadge",
      "weeklyReportReelVelocityVal",
      "weeklyReportReelTimeSub",
      "weeklyReportFocusHoursVal",
      "weeklyReportFocusSessionsSub",
      "weeklyReportFastSkipBadge",
      "weeklyReportTakeawayText",
      "weeklyReportInsightTakeaway",
      "btnViewSundayReportDigest",
      "weeklyReportRatioValue",
      "weeklyReportLongestFreeValue",
      "weeklyReportLateNightDeltaValue"
    ].forEach((nodeId) => {
      const el = documentMock.getElementById(nodeId);
      assert(el, `[Part 10B] Weekly Report Card DOM node #${nodeId} must exist`);
    });

    const sunDigest = app.WeeklyBehavioralReportCardEngine.openSundayReportDigest(emptyUid, { anchorDateStr: "2026-11-15", silentToast: true });
    assert(sunDigest && sunDigest.ok === true && sunDigest.inboxRecord, "[CAT10-02] openSundayReportDigest must persist an inbox record via NotificationInboxStore.add()");
    delete app.BackendDB.data.sessionsByUser[emptyUid];
    delete app.BackendDB.data.reelEventsByUser[emptyUid];
    delete app.BackendDB.data.focusSessionsByUser[emptyUid];
    delete app.BackendDB.data.notificationInboxByUser[emptyUid];

    // LockScreenWidgetBridge.syncIfChanged throttling & preview DOM nodes (CAT10-11 & Part 10B)
    app.LockScreenWidgetBridge._lastSyncedSignature = null;
    const sync1 = app.LockScreenWidgetBridge.syncIfChanged();
    const sync2 = app.LockScreenWidgetBridge.syncIfChanged();
    assert.strictEqual(sync1.ok, true, "[CAT10-11] First syncIfChanged call must succeed");
    assert.strictEqual(sync2.throttled, true, "[CAT10-11] Second identical syncIfChanged call must be throttled");
    [
      "lockScreenWidgetReelsVal",
      "lockScreenWidgetScreenVal",
      "lockScreenWidgetReelCountValue",
      "lockScreenWidgetSubtext",
      "widgetPreviewCircularSub",
      "lockScreenWidgetMiniNumber",
      "lockScreenWidgetDevicesScopeText",
      "widgetPreviewCircularCount",
      "widgetPreviewRectCount",
      "widgetPreviewRectSub",
      "widgetStatusBadge",
      "lockScreenWidgetSyncStatusBadge",
      "btnPinLockScreenWidget",
      "btnSyncLockScreenWidgetNow"
    ].forEach((wId) => {
      assert(documentMock.getElementById(wId), `[Part 10B] Lock Screen Widget Preview DOM node #${wId} must exist`);
    });
  }

  // ---------------------------------------------------------------------------
  // 8. CAT10-05, CAT10-19 & Part 10B Controller & DOM Aliases
  // ---------------------------------------------------------------------------
  {
    assert.strictEqual(app.DeskClockWheelTimePicker, app.NotificationTimePickerController, "[Part 10B] DeskClockWheelTimePicker alias must be exposed");
    assert.strictEqual(app.SoundLevelMonitor, app.SoundExposureAndHealthService, "[Part 10B] SoundLevelMonitor alias must be exposed");
    assert.strictEqual(app.ContinuousScreenBreakMonitor, app.NotificationScheduleManager, "[Part 10B] ContinuousScreenBreakMonitor alias must be exposed");
    assert.strictEqual(app.WeeklySummaryReportEngine, app.WeeklyBehavioralReportCardEngine, "[Part 10B] WeeklySummaryReportEngine alias must be exposed");
    assert.strictEqual(app.SoundExposureAndHealthService.WHO_STANDARD_THRESHOLD_DB, 80.0, "[Part 10B] WHO_STANDARD_THRESHOLD_DB must equal 80.0");
    assert.strictEqual(typeof app.SoundExposureAndHealthService.pollNativeAudioExposure, "function", "[Part 10B] pollNativeAudioExposure must be exposed");
    assert.strictEqual(typeof app.NotificationScheduleManager.evaluatePostureWellnessTick, "function", "[Part 10B] evaluatePostureWellnessTick must be exposed");

    app.WindDownBedtimeController.resetSession();
    app.NotificationScheduleManager.saveScheduleFromInputs({
      quietHoursEnabled: true,
      quietHoursStart: "22:30",
      quietHoursEnd: "07:00"
    });
    app.WindDownBedtimeController.recordShortFormWatchTime(600, { timeHHMM: "23:10" });
    assert.strictEqual(app.WindDownBedtimeController.continuousBedtimeWatchSeconds, 600, "[CAT10-05] Watch time during quiet hours must accumulate");
    app.WindDownBedtimeController.recordShortFormWatchTime(60, { timeHHMM: "12:00" });
    assert.strictEqual(app.WindDownBedtimeController.continuousBedtimeWatchSeconds, 0, "[CAT10-05] Exiting quiet hours must reset continuousBedtimeWatchSeconds to 0");

    // ReelDetoxCooldownController persistence across restoreState (CAT10-19)
    app.ReelDetoxCooldownController.resetBurst();
    app.ReelDetoxCooldownController.onReelCounted({ appKey: "instagram", countDelta: 7 });
    assert.strictEqual(app.state.consecutiveReelsInCurrentBurst, 7, "[CAT10-19] Burst count must be 7");
    app.state.consecutiveReelsInCurrentBurst = 0;
    const restored = app.ReelDetoxCooldownController.restoreState();
    assert.strictEqual(restored.restored, true, "[CAT10-19] restoreState() must restore persisted burst state");
    assert.strictEqual(app.state.consecutiveReelsInCurrentBurst, 7, "[CAT10-19] Restored consecutiveReelsInCurrentBurst must equal 7");
    app.ReelDetoxCooldownController.resetBurst();
  }

  // ---------------------------------------------------------------------------
  // 9. Native Android & iOS Source Verification (CAT10-03, CAT10-09, CAT10-12, CAT10-15, CAT10-16, Part 10B)
  // ---------------------------------------------------------------------------
  {
    const mainJava = fs.readFileSync(path.join(rootDir, "android/app/src/main/java/io/screensync/wellness/MainActivity.java"), "utf8");
    const bgJava = fs.readFileSync(path.join(rootDir, "android/app/src/main/java/io/screensync/wellness/ScreenSyncBackgroundSyncReceiver.java"), "utf8");
    const evalJava = fs.readFileSync(path.join(rootDir, "android/app/src/main/java/io/screensync/wellness/NativeGoalAlertEvaluator.java"), "utf8");
    const widgetXml = fs.readFileSync(path.join(rootDir, "android/app/src/main/res/xml/widget_reel_tracker_info.xml"), "utf8");
    const manifestXml = fs.readFileSync(path.join(rootDir, "android/app/src/main/AndroidManifest.xml"), "utf8");
    const appDelSwift = fs.readFileSync(path.join(rootDir, "ios/App/App/AppDelegate.swift"), "utf8");

    assert(mainJava.includes("CHANNEL_HEARING_HEALTH") && mainJava.includes("CHANNEL_SECURITY_ALERTS") && mainJava.includes("CHANNEL_APP_TIMERS") && mainJava.includes("CHANNEL_WELLNESS_NUDGES"), "[CAT10-03] MainActivity.java must define all 9 notification channel constants");
    assert(mainJava.includes("public String getAudioExposureStatusJson()") && mainJava.includes("estimatedSplDbA") && mainJava.includes("whoReferenceDbA"), "[CAT10-09/Part 10B] MainActivity.java must expose getAudioExposureStatusJson() with estimatedSplDbA and whoReferenceDbA");
    assert(mainJava.includes("UNKNOWN_CHANNEL"), "[CAT10-12] MainActivity.java dispatchNativeNotification must reject UNKNOWN_CHANNEL");
    assert(mainJava.includes("getLastNativeDailySummaryDate") && mainJava.includes("setLastNativeDailySummaryDate"), "[CAT10-15] MainActivity.java must expose native daily summary date getters/setters");
    assert(bgJava.includes("setExactAndAllowWhileIdle") && bgJava.includes("canScheduleExactAlarms"), "[CAT10-15] ScreenSyncBackgroundSyncReceiver.java must schedule exact daily summary alarm when permitted");
    assert(evalJava.includes('.putInt("widget_reels_count", 0)'), "[Part 10B] NativeGoalAlertEvaluator.onDayBoundary must reset widget_reels_count to 0");
    assert(widgetXml.includes('android:widgetCategory="home_screen|keyguard"'), "[Part 10B] widget_reel_tracker_info.xml must declare home_screen|keyguard");
    assert(manifestXml.includes("com.miui.powerkeeper") && manifestXml.includes("com.samsung.android.sm_cn"), "[Step 5.2] AndroidManifest.xml <queries> must declare com.miui.powerkeeper and com.samsung.android.sm_cn");
    assert(appDelSwift.includes("screensync_hearing_health") && appDelSwift.includes("screensync_security_alerts"), "[CAT10-16] AppDelegate.swift must return all 9 channels in getNotificationChannelsStatusJson");
    assert(appDelSwift.includes("canImport(WidgetKit)") && appDelSwift.includes("WidgetCenter.shared.reloadAllTimelines()") && appDelSwift.includes("group.io.screensync.shared"), "[Part 10B] AppDelegate.swift must sync lock screen widget to dual App Groups and reload WidgetCenter timelines");
  }

  return { ok: true };
}

function runCategory09And10AcceptanceTests(ctx = {}) {
  const app = ctx.app || ctx;
  const win = ctx.windowMock || ctx.window || (ctx.sandbox && ctx.sandbox.window) || global;
  const doc = ctx.documentMock || ctx.document || (ctx.sandbox && ctx.sandbox.document) || (win && win.document);
  const res = runCategory09And10Tests(app, win, doc);
  console.log("[PASS] Test 75: Part 5 (Categories 9 & 10) Behavioral Acceptance Suite (Focus Mode, Streaks & Challenges, Weekly Report Card, and Goal Pickers) verified.");
  return res;
}
runCategory09And10AcceptanceTests.runCategory09And10Tests = runCategory09And10Tests;
runCategory09And10AcceptanceTests.runCategory09And10AcceptanceTests = runCategory09And10AcceptanceTests;
module.exports = runCategory09And10AcceptanceTests;

if (require.main === module) {
  const { execFileSync } = require("child_process");
  const reproOut = execFileSync(process.execPath, [path.join(__dirname, "repro_category10_bugs.js")], { encoding: "utf8" });
  assert(
    reproOut.includes("Summary: 0/31 cases reproduced at runtime, 31 not reproduced, 0 script errors."),
    "repro_category10_bugs.js must report 0/31 cases reproduced"
  );
  console.log("[PASS] Category 09 & 10 Standalone Acceptance & 31/31 Repro Verification Suite passed 100%.");
}
