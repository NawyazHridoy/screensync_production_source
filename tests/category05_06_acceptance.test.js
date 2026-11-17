/**
 * ScreenSync — Part 3 (Categories 5 & 6) Behavioral Acceptance Suite
 * Features 16–28: Short-Form Reel/Shorts FSM, Detox Cooldown Engine & Overview Dashboard (#viewOverview)
 * Verifies R1–R15, O1–O14, and Behavioral Probes A–U.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

async function runCategory05And06Tests({ app, documentMock, sandbox, rootDir, setupTestFixtureForUser }) {
  // =========================================================================
  // PART I: CATEGORY 5 (FEATURES 16–21) — SHORT-FORM REEL/SHORTS FSM & DETOX
  // =========================================================================

  // 1. R1 — Continuous FSM Watch Time Accumulation & Tail Flushing (No 5-Second Loss)
  {
    setupTestFixtureForUser("usr_rahim_01", "2026-10-16");
    const uid = app.getActiveOrLocalUserId();
    app.BackendDB.data.reelEventsByUser[uid] = [];
    app.ReelTrackingEngine.clearViewedReelsLruCache("s24_ultra");
    const fsm = app.ReelTrackingEngine.getOrCreateFsmState("s24_ultra");
    fsm.state = "IDLE_OR_NON_SHORTFORM";
    fsm.currentSessionEventId = null;

    const t0 = new Date(2026, 9, 16, 14, 0, 0).getTime();
    // Enter short-form surface & scroll to video A
    app.ReelTrackingEngine.processRawStreamSignal({
      installationKey: "s24_ultra",
      osCategory: "Android",
      appKey: "instagram",
      eventType: "TYPE_VIEW_SCROLLED",
      isShortFormSurface: true,
      hasVerticalPager: true,
      isFullScreenViewport: true,
      videoSignature: "ig_reel_alpha_01",
      nowMs: t0
    });
    // Settle (>=300ms) + Dwell (>=1200ms) -> counts +1 at t0 + 1600ms
    const resCount = app.ReelTrackingEngine.processRawStreamSignal({
      installationKey: "s24_ultra",
      osCategory: "Android",
      appKey: "instagram",
      eventType: "HEARTBEAT",
      isShortFormSurface: true,
      hasVerticalPager: true,
      isFullScreenViewport: true,
      videoSignature: "ig_reel_alpha_01",
      nowMs: t0 + 1600
    });
    assert.strictEqual(resCount.counted, true, "[R1] Video must count +1 after 300ms settle + 1200ms dwell");
    assert.ok(fsm.currentSessionEventId, "[R1] Active reel event ID must be tracked on FSM state");

    // Watch for 12 more seconds across 3 heartbeats (4s each < 5s) then swipe to next video
    app.ReelTrackingEngine.processRawStreamSignal({
      installationKey: "s24_ultra",
      osCategory: "Android",
      appKey: "instagram",
      eventType: "HEARTBEAT",
      isShortFormSurface: true,
      hasVerticalPager: true,
      isFullScreenViewport: true,
      videoSignature: "ig_reel_alpha_01",
      nowMs: t0 + 5600
    });
    app.ReelTrackingEngine.processRawStreamSignal({
      installationKey: "s24_ultra",
      osCategory: "Android",
      appKey: "instagram",
      eventType: "HEARTBEAT",
      isShortFormSurface: true,
      hasVerticalPager: true,
      isFullScreenViewport: true,
      videoSignature: "ig_reel_alpha_01",
      nowMs: t0 + 9600
    });
    // Swipe to video B at t0 + 13600 (total 13.6s watch time on video A)
    app.ReelTrackingEngine.processRawStreamSignal({
      installationKey: "s24_ultra",
      osCategory: "Android",
      appKey: "instagram",
      eventType: "TYPE_VIEW_SCROLLED",
      isShortFormSurface: true,
      hasVerticalPager: true,
      isFullScreenViewport: true,
      videoSignature: "ig_reel_beta_02",
      nowMs: t0 + 13600
    });

    const snapAfterR1 = app.computeSnapshot("s24_ultra", "DAY", 0);
    assert(
      snapAfterR1.watchSeconds >= 13 && snapAfterR1.reelsCount === 1,
      `[R1] Tail watch time must be flushed without 5s truncation (expected >=13s and 1 reel, got ${snapAfterR1.watchSeconds}s, ${snapAfterR1.reelsCount} reels)`
    );
  }

  // 2. R2 & R3 & R4 — Unified 2500ms Fast-Skip Threshold, Flick vs Fast-Skip Distinction, and Period-Scoped Skips
  {
    setupTestFixtureForUser("usr_rahim_01", "2026-10-16");
    const uid = app.getActiveOrLocalUserId();
    app.BackendDB.data.reelEventsByUser[uid] = [];
    const fsm = app.ReelTrackingEngine.getOrCreateFsmState("s24_ultra");
    fsm.flickCount = 0;
    fsm.fastSkippedCount = 0;
    fsm.skippedCount = 0;
    assert.strictEqual(app.ReelTrackingEngine.FAST_SKIP_MAX_MS, 2500, "[R2] FAST_SKIP_MAX_MS must be unified to 2500ms");
    assert.strictEqual(app.ReelTrackingEngine.TIMING_CONFIG.fastSkipThresholdMs, 2500, "[R2] TIMING_CONFIG.fastSkipThresholdMs must be 2500ms");

    const tBase = new Date(2026, 9, 16, 15, 0, 0).getTime();
    // (a) Flick (<300ms): swipe at tBase, swipe again at tBase + 180ms
    app.ReelTrackingEngine.processRawStreamSignal({
      installationKey: "s24_ultra",
      osCategory: "Android",
      appKey: "tiktok",
      eventType: "TYPE_VIEW_SCROLLED",
      isShortFormSurface: true,
      hasVerticalPager: true,
      isFullScreenViewport: true,
      videoSignature: "tt_flick_01",
      nowMs: tBase
    });
    app.ReelTrackingEngine.processRawStreamSignal({
      installationKey: "s24_ultra",
      osCategory: "Android",
      appKey: "tiktok",
      eventType: "TYPE_VIEW_SCROLLED",
      isShortFormSurface: true,
      hasVerticalPager: true,
      isFullScreenViewport: true,
      videoSignature: "tt_fastskip_02",
      nowMs: tBase + 180
    });
    assert.strictEqual(fsm.flickCount, 1, "[R3] Sub-300ms swipe must increment flickCount");

    // (b) Fast-Skip (300ms <= dwell < 1200ms): settle at +500ms, swipe away at +1000ms (820ms total < 1200ms)
    app.ReelTrackingEngine.processRawStreamSignal({
      installationKey: "s24_ultra",
      osCategory: "Android",
      appKey: "tiktok",
      eventType: "HEARTBEAT",
      isShortFormSurface: true,
      hasVerticalPager: true,
      isFullScreenViewport: true,
      videoSignature: "tt_fastskip_02",
      nowMs: tBase + 550
    });
    app.ReelTrackingEngine.processRawStreamSignal({
      installationKey: "s24_ultra",
      osCategory: "Android",
      appKey: "tiktok",
      eventType: "TYPE_VIEW_SCROLLED",
      isShortFormSurface: true,
      hasVerticalPager: true,
      isFullScreenViewport: true,
      videoSignature: "tt_valid_03",
      nowMs: tBase + 1050
    });
    assert(fsm.fastSkippedCount >= 1 && fsm.skippedCount >= 1, "[R2/R3] 300ms..1200ms swipe must increment fastSkippedCount and skippedCount");

    // (c) R4: Verify live today fsm.skippedCount does NOT leak into yesterday (offset = -1)
    const todayInsights = app.SmartInsightsEngine.computeInsights("s24_ultra", "DAY", 0);
    const yesterdayInsights = app.SmartInsightsEngine.computeInsights("s24_ultra", "DAY", -1);
    assert(todayInsights.fastSkippedCount >= 1, "[R4] Current day insights must reflect today's fast skips");
    assert.strictEqual(yesterdayInsights.fastSkippedCount, 0, "[R4] Yesterday's insights must not leak today's live in-memory FSM skip counter");
  }

  // 3. R5 — Volatile Number Regex Preserves Sequence Numbers ("Part 2") While Stripping Engagement Counters
  {
    const normFn = app.ReelTrackingEngine.normalizeVolatileMetadataText.bind(app.ReelTrackingEngine);
    assert.strictEqual(normFn("Part 1 - Rust Ownership"), "part 1 - rust ownership", "[R5] 'Part 1' must be preserved");
    assert.strictEqual(normFn("Part 2 - Rust Ownership"), "part 2 - rust ownership", "[R5] 'Part 2' must be preserved and distinct from Part 1");
    assert.notStrictEqual(normFn("Part 1 - Rust Ownership"), normFn("Part 2 - Rust Ownership"), "[R5] Part 1 and Part 2 must not collide");
    assert.strictEqual(normFn("14.2K likes"), "# likes", "[R5] Engagement counter '14.2K likes' must normalize to '# likes'");
    assert.strictEqual(normFn("1,245 comments"), "# comments", "[R5] Comma-formatted counter '1,245 comments' must normalize to '# comments'");
  }

  // 4. R6 & R7 — Per-Installation LRU Clearing & Midnight Rollover Date Resolution
  {
    const lruPhone = app.ReelTrackingEngine.getOrCreateLruCache("s24_ultra");
    const lruTab = app.ReelTrackingEngine.getOrCreateLruCache("ipad_pro");
    lruPhone.set("sig_phone", { timestamp: Date.now() });
    lruTab.set("sig_tab", { timestamp: Date.now() });
    app.ReelTrackingEngine.clearViewedReelsLruCache("s24_ultra");
    assert.strictEqual(app.ReelTrackingEngine.getOrCreateLruCache("s24_ultra").size, 0, "[R6] Scoped clearViewedReelsLruCache('s24_ultra') must clear s24_ultra");
    assert.strictEqual(app.ReelTrackingEngine.getOrCreateLruCache("ipad_pro").size, 1, "[R6] Scoped clearViewedReelsLruCache('s24_ultra') must NOT clear ipad_pro");

    // R7: Event timestamp on 2026-10-17 UTC midnight must resolve eventLocalDate to 2026-10-17
    const nextDayStartMs = new Date(2026, 9, 17, 0, 1, 0).getTime();
    app.ReelTrackingEngine.processRawStreamSignal({
      installationKey: "s24_ultra",
      osCategory: "Android",
      appKey: "youtube",
      eventType: "TYPE_VIEW_SCROLLED",
      isShortFormSurface: true,
      hasVerticalPager: true,
      isFullScreenViewport: true,
      videoSignature: "yt_midnight_01",
      nowMs: nextDayStartMs
    });
    const fsmAfterMidnight = app.ReelTrackingEngine.getOrCreateFsmState("s24_ultra");
    assert.strictEqual(fsmAfterMidnight.activeDateStr, "2026-10-17", "[R7] Midnight rollover must update fsm.activeDateStr from event timestamp");
  }

  // 5. R8 & R14 — Fail-Closed Activity Classification & Pause on Context Exit
  {
    const emptyActRes = app.ReelTrackingEngine.classifyAppActivity("instagram", "");
    assert.strictEqual(emptyActRes.isShortForm, false, "[R8] Empty activity string must fail closed (isShortForm: false)");
    assert.strictEqual(emptyActRes.islandContextMode, "NON_REEL_ACTIVITY", "[R8] Empty activity string must set NON_REEL_ACTIVITY");

    const dmActRes = app.ReelTrackingEngine.classifyAppActivity("instagram", "DIRECT_MESSAGE");
    assert.strictEqual(dmActRes.isShortForm, false, "[R8] DIRECT_MESSAGE activity must be classified as non-reel");
    assert.strictEqual(dmActRes.subActivity, "DIRECT_MESSAGE", "[R8] DIRECT_MESSAGE subActivity must be preserved");

    const fbliteRule = app.ReelTrackingEngine.SUPPORTED_SHORTFORM_APPS.fblite;
    assert(fbliteRule && fbliteRule.packageIds.includes("com.facebook.lite"), "[R8] SUPPORTED_SHORTFORM_APPS must include fblite rule");

    // R14: Leaving short-form app pauses active FSM session
    const fsm = app.ReelTrackingEngine.getOrCreateFsmState("s24_ultra");
    fsm.state = "DWELL_COUNTED";
    fsm.lastWatchFlushEpochMs = Date.now() - 2000;
    const pauseRes = app.ReelTrackingEngine.pauseActiveReelSessionForContextExit("s24_ultra", Date.now());
    assert.strictEqual(pauseRes.paused, true, "[R14] pauseActiveReelSessionForContextExit must transition active session to PAUSED_ON_OVERLAY");
    assert.strictEqual(fsm.state, "PAUSED_ON_OVERLAY", "[R14] FSM state must be PAUSED_ON_OVERLAY after context exit");
  }

  // 6. R9, R10, R11 — Detox Cooldown Gap Reset (120s), Enforced Countdown Gate, Dynamic Title/Badge & Persistence
  {
    app.state.reelDetoxEnabled = true;
    app.state.reelDetoxThresholdCount = 5;
    app.state.reelDetoxCooldownSeconds = 8;
    app.ReelDetoxCooldownController.resetBurst();

    const tDetox0 = new Date(2026, 9, 16, 18, 0, 0).getTime();
    app.ReelDetoxCooldownController.onReelCounted({ appKey: "instagram", countDelta: 3, nowMs: tDetox0 });
    assert.strictEqual(app.state.consecutiveReelsInCurrentBurst, 3, "[R9] Burst count must reach 3");

    // Gap > 120s (150s later) must reset prior burst before adding new count
    app.ReelDetoxCooldownController.onReelCounted({ appKey: "instagram", countDelta: 1, nowMs: tDetox0 + 150000 });
    assert.strictEqual(app.state.consecutiveReelsInCurrentBurst, 1, "[R9] Gap > 120s must reset consecutiveReelsInCurrentBurst to 1");

    // Reach threshold (5) within 120s
    const trigRes = app.ReelDetoxCooldownController.onReelCounted({ appKey: "instagram", countDelta: 4, nowMs: tDetox0 + 160000 });
    assert.strictEqual(trigRes.triggered, true, "[R10] Reaching threshold within 120s window must trigger Detox Cooldown modal");

    const titleEl = documentMock.getElementById("reelDetoxModalTitle");
    const badgeEl = documentMock.getElementById("reelDetoxCountdownBadge");
    const contBtn = documentMock.getElementById("btnReelDetoxContinue");
    assert(titleEl.textContent.includes("8-Second"), `[R10] Modal title must reflect configured 8-Second cooldown, got '${titleEl.textContent}'`);
    assert.strictEqual(badgeEl.textContent, "8s", "[R10] Countdown badge must start at '8s'");
    assert.strictEqual(contBtn.disabled, true, "[R10] Continue button must be disabled while countdown > 0");

    const blockedCont = app.ReelDetoxCooldownController.continueWatching();
    assert.strictEqual(blockedCont.ok, false, "[R10] continueWatching() must be rejected while remainingCooldownSeconds > 0");
    assert.strictEqual(blockedCont.reason, "COOLDOWN_ACTIVE", "[R10] Rejected continueWatching() must return reason COOLDOWN_ACTIVE");

    app.ReelDetoxCooldownController.remainingCooldownSeconds = 0;
    const allowedCont = app.ReelDetoxCooldownController.continueWatching();
    assert.strictEqual(allowedCont.ok, true, "[R10] continueWatching() must succeed once countdown reaches 0");
    assert.strictEqual(allowedCont.burstReset, true, "[R10] continueWatching() must reset burst counter");
    assert(Array.isArray(app.state.reelDetoxInterventionLog) && app.state.reelDetoxInterventionLog.length >= 1, "[R10] Detox intervention log must record trigger and resolution");

    // Reset back to default 25 / 5s
    app.state.reelDetoxThresholdCount = 25;
    app.state.reelDetoxCooldownSeconds = 5;
  }

  // 7. R12, R13, R15 — Browser Extension Manifest & Scripts + Android Native Parity Checks
  {
    const extManifest = JSON.parse(fs.readFileSync(path.join(rootDir, "platforms/browser-extension/manifest.json"), "utf8"));
    assert(extManifest.permissions.includes("alarms") && extManifest.permissions.includes("history"), "[R12] Browser extension manifest.json must declare 'alarms' and 'history' permissions");

    const contentObsJs = fs.readFileSync(path.join(rootDir, "platforms/browser-extension/content_shortform_observer.js"), "utf8");
    assert(
      contentObsJs.includes("findActiveViewportVideoInfo") &&
      contentObsJs.includes("MutationObserver") &&
      contentObsJs.includes("isShortFormSurfaceActive"),
      "[R13] content_shortform_observer.js must include viewport video detection, MutationObserver, and strict short-form surface check"
    );

    const bgCollectorJs = fs.readFileSync(path.join(rootDir, "platforms/browser-extension/background_collector.js"), "utf8");
    assert(
      bgCollectorJs.includes("function startTrackingUrl") &&
      bgCollectorJs.includes("function flushActiveSession") &&
      bgCollectorJs.includes("function flushQueueToCompanion") &&
      bgCollectorJs.includes("SCREENSYNC_SHORTFORM_VIEW_SCROLLED"),
      "[R12] background_collector.js must implement startTrackingUrl, flushActiveSession, flushQueueToCompanion, and handle SCREENSYNC_SHORTFORM_VIEW_SCROLLED"
    );

    const accessSvcJava = fs.readFileSync(path.join(rootDir, "android/app/src/main/java/io/screensync/wellness/ScreenSyncAccessibilityService.java"), "utf8");
    assert(
      accessSvcJava.includes("FAST_SKIP_MAX_MS = 2500L") &&
      accessSvcJava.includes("DETOX_MAX_GAP_MS = 120_000L") &&
      accessSvcJava.includes("daily_fast_skip_count") &&
      accessSvcJava.includes("daily_flick_count") &&
      accessSvcJava.includes("GLOBAL_ACTION_HOME"),
      "[R15] ScreenSyncAccessibilityService.java must unify FAST_SKIP_MAX_MS=2500L, DETOX_MAX_GAP_MS=120_000L, persist skip/flick counters, and provide interactive Detox overlay with GLOBAL_ACTION_HOME"
    );
  }

  // =========================================================================
  // PART II: CATEGORY 6 (FEATURES 22–28) — OVERVIEW DASHBOARD (#viewOverview)
  // =========================================================================
  setupTestFixtureForUser("usr_rahim_01", "2026-10-16");
  app.state.selectedDevice = "ALL";
  app.state.statsMetricMode = "SCREEN";
  app.state.overviewMetricMode = "SCREEN";
  app.state.graphDisplayStyle = "SIMPLE";
  app.renderAll();

  // Probe A: Timezone-Aware Bucket Assignment (UTC+6 / UTC-5)
  {
    const uid = app.getActiveOrLocalUserId();
    const savedSessions = [...(app.BackendDB.data.sessionsByUser[uid] || [])];
    const savedReels = [...(app.BackendDB.data.reelEventsByUser[uid] || [])];

    const oct16MidnightUtcPlus6 = app.ScreenTimeAggregator.parseDateStrToUtcEpochSec("2026-10-16", 360);
    app.BackendDB.data.sessionsByUser[uid] = [{
      eventId: "tz_probe_utc6_01",
      userId: uid,
      installationKey: "s24_ultra",
      osCategory: "Android",
      appKey: "instagram",
      appName: "Instagram",
      category: "Social networking",
      localDate: "2026-10-16",
      tzOffsetMinutes: 360,
      startEpochSec: oct16MidnightUtcPlus6 + 1800,
      endEpochSec: oct16MidnightUtcPlus6 + 3600,
      durationMinutes: 30,
      unlocks: 2,
      opens: 1
    }];
    const snapTz = app.computeSnapshot("s24_ultra", "DAY", 0);
    assert.strictEqual(snapTz.totalScreenMinutes, 30, `[C-01 / Probe A] Session at 00:30 local time on 2026-10-16 (UTC+6) must be included in 2026-10-16 DAY snapshot (got ${snapTz.totalScreenMinutes}m)`);
    assert.strictEqual(snapTz.bars[0], 30, `[C-01 / Probe A] Session at 00:30–01:00 local time (UTC+6) must land in hour bucket 0 (got ${snapTz.bars[0]}m)`);

    app.BackendDB.data.sessionsByUser[uid] = savedSessions;
    app.BackendDB.data.reelEventsByUser[uid] = savedReels;
  }

  // Probe B04: YEAR Mode Elapsed-Day Daily Average
  {
    const uid = app.getActiveOrLocalUserId();
    const savedSessions = [...(app.BackendDB.data.sessionsByUser[uid] || [])];
    const yrSessions = [];
    const jan1Sec = Math.floor(Date.UTC(2026, 0, 1, 0, 0, 0) / 1000);
    for (let d = 0; d < 289; d++) {
      const dStr = app.ScreenTimeAggregator.epochSecToDateStr(jan1Sec + d * 86400, 0);
      yrSessions.push({
        eventId: `yr_avg_probe_${d}`,
        userId: uid,
        installationKey: "s24_ultra",
        osCategory: "Android",
        appKey: "instagram",
        localDate: dStr,
        durationMinutes: 100
      });
    }
    app.BackendDB.data.sessionsByUser[uid] = yrSessions;
    const yearSnap = app.computeSnapshot("s24_ultra", "YEAR", 0);
    assert(
      /1\s*h\s*40\s*m/.test(yearSnap.subText),
      `[B-04 / Probe B04] YEAR daily average on Oct 16 (day 289) for 28,900 mins must be 1h 40m (100m/day), got "${yearSnap.subText}"`
    );
    app.BackendDB.data.sessionsByUser[uid] = savedSessions;
  }

  // Probe C & Probe N: 4-Category Bar + Donut Consistency on Overview ("Other" Category Inclusion)
  {
    const uid = app.getActiveOrLocalUserId();
    const savedSessions = [...(app.BackendDB.data.sessionsByUser[uid] || [])];
    const baseSec = app.ScreenTimeAggregator.parseDateStrToUtcEpochSec("2026-10-16", 0) + 36000;
    app.BackendDB.data.sessionsByUser[uid] = [
      {
        eventId: "cat_soc_1",
        userId: uid,
        installationKey: "s24_ultra",
        osCategory: "Android",
        appKey: "instagram",
        appName: "Instagram",
        category: "Social networking",
        localDate: "2026-10-16",
        startEpochSec: baseSec,
        endEpochSec: baseSec + 1800,
        durationMinutes: 30
      },
      {
        eventId: "cat_oth_1",
        userId: uid,
        installationKey: "s24_ultra",
        osCategory: "Android",
        appKey: "maps_nav",
        appName: "Maps",
        category: "Other",
        localDate: "2026-10-16",
        startEpochSec: baseSec + 1800,
        endEpochSec: baseSec + 3600,
        durationMinutes: 30
      }
    ];
    app.state.selectedDevice = "s24_ultra";
    app.state.graphDisplayStyle = "DETAILED";
    app.renderAll();

    const wSoc = parseFloat(documentMock.getElementById("mainCatBarSocial").style.width);
    const wEnt = parseFloat(documentMock.getElementById("mainCatBarEnt").style.width);
    const wProd = parseFloat(documentMock.getElementById("mainCatBarProd").style.width);
    const mainBarOtherEl = documentMock.getElementById("mainCatBarOther");
    const wOth = mainBarOtherEl ? parseFloat(mainBarOtherEl.style.width) : 0;
    assert.strictEqual(wSoc, 50, `[C-04 / O1 / Probe C] Social bar width must be 50% when Social=30m and Other=30m (got ${wSoc}%)`);
    assert.strictEqual(Math.round(wSoc + wEnt + wProd + wOth), 100, `[C-04 / O1 / Probe C] Total category bar width must equal 100% (got ${wSoc + wEnt + wProd + wOth}%)`);

    const ovDonutHtml = documentMock.getElementById("overviewCategoryDonutBox").innerHTML;
    const circleMatches = ovDonutHtml.match(/<circle\b/g) || [];
    assert(circleMatches.length >= 5, `[B-12 / Probe N] buildCategoryDonutSvg must render track + 4 category slices including Other (got ${circleMatches.length} circles)`);

    app.state.graphDisplayStyle = "SIMPLE";
    app.BackendDB.data.sessionsByUser[uid] = savedSessions;
    app.state.selectedDevice = "ALL";
    app.renderAll();
  }

  // Probe D: Period-Aware Reel Goal Line & Over-Goal Bar Coloring + Unclamped Goal Line
  {
    app.state.dailyGoalMinutes = 60;
    app.state.reelGraphPeriod = "DAY";
    app.state.reelGraphOffsets.DAY = 0;
    const uid = app.getActiveOrLocalUserId();
    const savedReels = [...(app.BackendDB.data.reelEventsByUser[uid] || [])];
    const baseMs = app.ScreenTimeAggregator.parseDateStrToUtcEpochSec("2026-10-16", 0) * 1000;
    app.BackendDB.data.reelEventsByUser[uid] = [{
      eventId: "rl_probe_d_25m",
      userId: uid,
      installationKey: "s24_ultra",
      osCategory: "Android",
      appKey: "instagram",
      appName: "Instagram",
      localDate: "2026-10-16",
      startEpochMs: baseMs + 14 * 3600 * 1000,
      reelCount: 30,
      watchSeconds: 25 * 60,
      watchMinutes: 25
    }];
    app.state.selectedDevice = "s24_ultra";
    app.renderAll();
    const reelChartHtml = documentMock.getElementById("reelViewingBarChart").innerHTML;
    assert(
      !reelChartHtml.includes("bg-[#EA5B25]"),
      `[C-03 / O4 / Probe D] A 25m hourly reel bar must NOT be colored over-goal orange when daily reel goal is 60m`
    );
    const goalLineBottom = documentMock.getElementById("reelGoalLine").style.bottom;
    assert.strictEqual(
      goalLineBottom,
      "100%",
      `[B-03 / Probe D] When dailyGoalMinutes (60m) == maxReelBar (60m), #reelGoalLine bottom must be "100%" (got "${goalLineBottom}")`
    );
    app.BackendDB.data.reelEventsByUser[uid] = savedReels;
    app.state.selectedDevice = "ALL";
    app.renderAll();
  }

  // Probe E: Schedule-Aware App Limit Evaluation on #mainHeaderNotifDot
  {
    const uid = app.getActiveOrLocalUserId();
    const savedTimers = Object.assign({}, app.state.appTimers || {});
    const savedScGoal = app.state.screenGoalEnabled;
    const savedRlGoal = app.state.goalEnabled;
    const savedUnlGoal = app.state.unlocksLimitEnabled;

    app.state.screenGoalEnabled = false;
    app.state.goalEnabled = false;
    app.state.unlocksLimitEnabled = false;
    app.state.appTimers = {
      instagram: { minutes: 10, schedule: "Saturday–Sunday" }
    };
    app.renderAll();
    const notifDot = documentMock.getElementById("mainHeaderNotifDot");
    assert(
      notifDot.classList.contains("hidden"),
      `[B-07 / O6 / Probe E] #mainHeaderNotifDot must NOT activate on Friday for a Saturday–Sunday app limit`
    );

    app.state.appTimers = savedTimers;
    app.state.screenGoalEnabled = savedScGoal;
    app.state.goalEnabled = savedRlGoal;
    app.state.unlocksLimitEnabled = savedUnlGoal;
    app.renderAll();
  }

  // Probe F: Non-Fabrication of Hourly Reel Spikes for Legacy Date-Only Reel Records
  {
    const uid = app.getActiveOrLocalUserId();
    const savedReels = [...(app.BackendDB.data.reelEventsByUser[uid] || [])];
    app.BackendDB.data.reelEventsByUser[uid] = [{
      eventId: "legacy_date_only_reel",
      userId: uid,
      installationKey: "s24_ultra",
      osCategory: "Android",
      appKey: "instagram",
      localDate: "2026-10-16",
      reelCount: 15,
      watchSeconds: 600,
      watchMinutes: 10
    }];
    const snap = app.computeSnapshot("s24_ultra", "DAY", 0);
    assert.strictEqual(snap.reelsCount, 15, "[B-06 / Probe F] Daily reel total must include date-only reel record");
    assert.strictEqual(
      snap.reelWatchBars[12],
      0,
      `[B-06 / Probe F] Date-only reel record without timestamp must NOT fabricate a spike at hour 12 (got ${snap.reelWatchBars[12]}m)`
    );
    app.BackendDB.data.reelEventsByUser[uid] = savedReels;
  }

  // Probe G: Navigation Integrity (#btnViewAllAppsFromOverview, #btnJumpToAppLimits, #btnBackFromAppDetail)
  {
    app.switchView("OVERVIEW");
    documentMock.getElementById("btnViewAllAppsFromOverview").click();
    assert.strictEqual(
      app.state.activeView,
      "ALL_APPS",
      `[C-06 / O3 / Probe G] Clicking #btnViewAllAppsFromOverview must navigate to ALL_APPS (got ${app.state.activeView})`
    );

    app.switchView("OVERVIEW");
    documentMock.getElementById("btnJumpToAppLimits").click();
    assert.strictEqual(
      app.state.activeView,
      "APP_LIMITS",
      `[C-07 / Probe G] Clicking #btnJumpToAppLimits must navigate to APP_LIMITS (#viewAppLimits)`
    );

    app.switchView("OVERVIEW");
    const firstTopAppBtn = documentMock.querySelector("#overviewTopAppsGrid .open-app-detail-btn");
    assert(firstTopAppBtn, "[Probe G] #overviewTopAppsGrid must contain at least one .open-app-detail-btn");
    firstTopAppBtn.click();
    assert.strictEqual(app.state.activeView, "APP_DETAIL", "[Probe G] Clicking top app card must open APP_DETAIL");
    documentMock.getElementById("btnBackFromAppDetail").click();
    assert.strictEqual(
      app.state.activeView,
      "OVERVIEW",
      `[B-16 / Probe G] Clicking #btnBackFromAppDetail after opening from OVERVIEW must return to OVERVIEW (got ${app.state.activeView})`
    );
  }

  // Probe H, H2, H3: Short-Form Reel Breakdown Filtering, Sorting, Avg Duration, iOS Sandbox Badge & Dynamic Button Visibility
  {
    const uid = app.getActiveOrLocalUserId();
    const savedSessions = [...(app.BackendDB.data.sessionsByUser[uid] || [])];
    const savedReels = [...(app.BackendDB.data.reelEventsByUser[uid] || [])];
    const baseSec = app.ScreenTimeAggregator.parseDateStrToUtcEpochSec("2026-10-16", 0) + 36000;

    app.BackendDB.data.sessionsByUser[uid] = [
      {
        eventId: "s_chrome_60",
        userId: uid,
        installationKey: "s24_ultra",
        osCategory: "Android",
        appKey: "chrome",
        appName: "Chrome",
        category: "Productivity & finance",
        localDate: "2026-10-16",
        startEpochSec: baseSec,
        endEpochSec: baseSec + 3600,
        durationMinutes: 60
      },
      {
        eventId: "s_tt_20",
        userId: uid,
        installationKey: "s24_ultra",
        osCategory: "Android",
        appKey: "tiktok",
        appName: "TikTok",
        category: "Entertainment",
        localDate: "2026-10-16",
        startEpochSec: baseSec + 3600,
        endEpochSec: baseSec + 4800,
        durationMinutes: 20
      }
    ];
    app.BackendDB.data.reelEventsByUser[uid] = [
      {
        eventId: "r_tt_15",
        userId: uid,
        installationKey: "s24_ultra",
        osCategory: "Android",
        appKey: "tiktok",
        appName: "TikTok",
        localDate: "2026-10-16",
        startEpochMs: (baseSec + 3600) * 1000,
        reelCount: 30,
        watchSeconds: 900,
        watchMinutes: 15
      }
    ];

    app.state.selectedDevice = "s24_ultra";
    app.renderAll();

    const topGridHtml = documentMock.getElementById("overviewTopAppsGrid").innerHTML;
    const breakdownHtml = documentMock.getElementById("overviewPerAppReelBreakdownList").innerHTML;

    assert(
      !/Chrome[\s\S]{0,160}0 reels/i.test(topGridHtml),
      `[B-09 / Probe H] #overviewTopAppsGrid must NOT display a "0 reels" badge on non-reel apps like Chrome`
    );
    assert(
      !breakdownHtml.includes("Chrome"),
      `[C-05 / O3 / Probe H] #overviewPerAppReelBreakdownList must NOT include non-reel apps with 0 reels like Chrome`
    );
    assert(
      /\d+\s*s\s*\/\s*reel|avg/i.test(breakdownHtml),
      `[O3 / Probe H] #overviewPerAppReelBreakdownList must display average reel duration (e.g. "30s/reel")`
    );

    const showMoreBtn = documentMock.getElementById("btnShowMoreBreakdownApps");
    assert(
      showMoreBtn.classList.contains("hidden") || (showMoreBtn.style && showMoreBtn.style.display === "none"),
      `[B-14 / Probe H3] #btnShowMoreBreakdownApps must be hidden when <= 4 apps exist in breakdown`
    );

    // Probe H2: iOS Sandbox Truthfulness Badge
    app.BackendDB.data.sessionsByUser[uid].push({
      eventId: "s_ios_ig_25",
      userId: uid,
      installationKey: "iphone_16",
      osCategory: "iOS",
      appKey: "instagram",
      appName: "Instagram",
      category: "Social networking",
      localDate: "2026-10-16",
      startEpochSec: baseSec,
      endEpochSec: baseSec + 1500,
      durationMinutes: 25
    });
    app.BackendDB.data.reelEventsByUser[uid] = app.BackendDB.data.reelEventsByUser[uid].filter(r => r.installationKey !== "iphone_16");
    app.state.selectedDevice = "iphone_16";
    app.renderAll();
    const iosBreakdownHtml = documentMock.getElementById("overviewPerAppReelBreakdownList").innerHTML;
    assert(
      /Limited on iOS/i.test(iosBreakdownHtml),
      `[B-08 / O2 / Probe H2] When scoped to iOS device without verified reel sessions, breakdown must show "Limited on iOS"`
    );

    app.BackendDB.data.sessionsByUser[uid] = savedSessions;
    app.BackendDB.data.reelEventsByUser[uid] = savedReels;
    app.state.selectedDevice = "ALL";
    app.renderAll();
  }

  // Probe I & I-labels: GoalPickerController.openModal & Overview Goal Progress Labels
  {
    assert.strictEqual(
      typeof app.GoalPickerController.openModal,
      "function",
      `[O7 / Probe I] GoalPickerController.openModal must be exposed as a function`
    );
    app.state.dailyGoalMinutes = 75;
    app.GoalPickerController.openModal("REEL");
    const modalEl = documentMock.getElementById("screenTimeGoalModal");
    assert(!modalEl.classList.contains("hidden"), `[O7 / Probe I] GoalPickerController.openModal("REEL") must open #screenTimeGoalModal`);
    const hVal = Number(documentMock.getElementById("inputCustomGoalHrs").value);
    const mVal = Number(documentMock.getElementById("inputCustomGoalMins").value);
    assert.strictEqual(hVal * 60 + mVal, 75, `[O7 / Probe I] Opening REEL goal modal for 75m must populate 1h 15m (got ${hVal}h ${mVal}m)`);
    modalEl.classList.add("hidden");
    app.state.dailyGoalMinutes = 60;
    app.renderAll();

    const scGoalSummary = documentMock.getElementById("overviewGoalSummaryLabel").textContent;
    const rlGoalSummary = documentMock.getElementById("overviewReelGoalSummaryLabel").textContent;
    assert(
      /(used|watched|\/|of)/i.test(scGoalSummary) && /(used|watched|\/|of)/i.test(rlGoalSummary),
      `[B-10 / O7 / Probe I-labels] Overview goal summary labels must include current used/watched progress alongside target limit (got "${scGoalSummary}" and "${rlGoalSummary}")`
    );
  }

  // Probe J: Proportional Bar Heights & Curved SVG Accuracy
  {
    app.state.graphDisplayStyle = "DETAILED";
    const svg = app.buildCurvedChartOverlaySvg([0, 30, 60], 60, "#38BDF8", "testGrad", 1);
    assert(
      svg.includes("M 16.67 98") && svg.includes("50 51.5") && svg.includes("83.33 5"),
      `[B-02 / Probe J] buildCurvedChartOverlaySvg must place 0 at y=98, half-max at y=51.5, and max at y=5 without artificial 4-unit lift (got ${svg})`
    );
    app.state.graphDisplayStyle = "SIMPLE";
    app.renderAll();
  }

  // Probe K: Midnight / Late-Night Greeting Boundaries
  {
    const g2am = app.getTimeBasedGreeting(new Date(2026, 9, 16, 2, 0, 0));
    const g8am = app.getTimeBasedGreeting(new Date(2026, 9, 16, 8, 0, 0));
    const g2pm = app.getTimeBasedGreeting(new Date(2026, 9, 16, 14, 0, 0));
    const g8pm = app.getTimeBasedGreeting(new Date(2026, 9, 16, 20, 0, 0));
    assert(
      !/morning/i.test(g2am) && /morning/i.test(g8am) && /afternoon/i.test(g2pm) && /evening/i.test(g8pm),
      `[B-11 / O11 / Probe K] Greeting at 02:00 AM must not be "Good morning," (got 2am="${g2am}", 8am="${g8am}", 2pm="${g2pm}", 8pm="${g8pm}")`
    );
  }

  // Probe L: Keyboard Accessibility on Chart Pillars
  {
    const ovPillar2 = documentMock.querySelector('[data-ov-pillar="2"]');
    assert(ovPillar2, "[Probe L] [data-ov-pillar='2'] must exist");
    assert(ovPillar2.getAttribute("aria-label"), "[B-15 / O12 / Probe L] Chart pillar must have an aria-label");
    ovPillar2.dispatchEvent({ type: "keydown", key: "Enter", preventDefault() {} });
    assert.strictEqual(
      app.state.selectedPillarIdx.OVERVIEW,
      2,
      `[B-15 / O12 / Probe L] Pressing Enter on [data-ov-pillar="2"] must select pillar 2 (got ${app.state.selectedPillarIdx.OVERVIEW})`
    );
    app.state.selectedPillarIdx.OVERVIEW = 6;
    app.renderAll();
  }

  // Probe M: Overview Day Selection Reactivity
  {
    app.state.selectedPillarIdx.OVERVIEW = 6;
    app.renderAll();
    const friHeadline = documentMock.getElementById("overviewTotalScreenTime").textContent;
    const thuPillar = documentMock.querySelector('[data-ov-pillar="5"]');
    thuPillar.click();
    const thuHeadline = documentMock.getElementById("overviewTotalScreenTime").textContent;
    assert.notStrictEqual(
      thuHeadline,
      friHeadline,
      `[B-17 / Probe M] Selecting Thursday pillar on #overviewWeekChart must update #overviewTotalScreenTime to Thursday's usage (both were "${friHeadline}")`
    );
    app.state.selectedPillarIdx.OVERVIEW = 6;
    app.renderAll();
  }

  // Probe O: Today's Reel Viewing Card Period Reactivity
  {
    const uid = app.getActiveOrLocalUserId();
    app.BackendDB.data.reelEventsByUser[uid].push({
      eventId: "probe_o_thu_reels",
      userId: uid,
      installationKey: "s24_ultra",
      osCategory: "Android",
      appKey: "instagram",
      appName: "Instagram",
      localDate: "2026-10-15",
      startEpochMs: (app.ScreenTimeAggregator.parseDateStrToUtcEpochSec("2026-10-15", 0) + 14 * 3600) * 1000,
      reelCount: 15,
      watchSeconds: 450,
      watchMinutes: 7.5
    });
    app.state.reelGraphPeriod = "DAY";
    app.state.reelGraphOffsets.DAY = 0;
    app.renderAll();
    const dayCountText = documentMock.getElementById("todayReelViewingTotalCount").textContent;

    const weekTabBtn = documentMock.querySelector('.reel-period-tab[data-reel-period="WEEK"]');
    weekTabBtn.click();
    const weekCountText = documentMock.getElementById("todayReelViewingTotalCount").textContent;
    assert.notStrictEqual(
      weekCountText,
      dayCountText,
      `[B-01 / O4 / Probe O] Switching Reel Viewing card to WEEK must update #todayReelViewingTotalCount to the week's total reels (both were "${dayCountText}")`
    );
    const compareTxt = documentMock.getElementById("todayReelViewingCompareText").textContent;
    assert(
      compareTxt.startsWith("Watch time:"),
      `[O4 / Probe O] #todayReelViewingCompareText must disambiguate that the comparison is for watch time (got "${compareTxt}")`
    );
    app.state.reelGraphPeriod = "DAY";
    app.renderAll();
  }

  // Probe P: #allAppsFullBreakdownList Progress Bars
  {
    app.renderAll();
    const allAppsHtml = documentMock.getElementById("allAppsFullBreakdownList").innerHTML;
    assert(
      /style="width:\s*\d+(\.\d+)?%;?"/.test(allAppsHtml),
      `[B-18 / O3 / Probe P] #allAppsFullBreakdownList must render proportional usage progress bars`
    );
  }

  // Probe Q: Canonical App Key Normalization in computeSnapshot
  {
    const uid = app.getActiveOrLocalUserId();
    const savedSessions = [...(app.BackendDB.data.sessionsByUser[uid] || [])];
    const baseSec = app.ScreenTimeAggregator.parseDateStrToUtcEpochSec("2026-10-16", 0) + 36000;
    app.BackendDB.data.sessionsByUser[uid] = [
      {
        eventId: "alias_ig_1",
        userId: uid,
        installationKey: "s24_ultra",
        osCategory: "Android",
        appKey: "com.instagram.android",
        appName: "Instagram",
        localDate: "2026-10-16",
        startEpochSec: baseSec,
        endEpochSec: baseSec + 1200,
        durationMinutes: 20
      },
      {
        eventId: "alias_ig_2",
        userId: uid,
        installationKey: "iphone_16",
        osCategory: "iOS",
        appKey: "instagram",
        appName: "Instagram",
        localDate: "2026-10-16",
        startEpochSec: baseSec + 1200,
        endEpochSec: baseSec + 2100,
        durationMinutes: 15
      }
    ];
    const snap = app.computeSnapshot("ALL", "DAY", 0);
    const igEntries = snap.apps.filter(a => a.name === "Instagram" || a.key.includes("instagram"));
    assert.strictEqual(
      igEntries.length,
      1,
      `[B-20 / Probe Q] "com.instagram.android" and "instagram" must merge into a single app entry in computeSnapshot().apps (got ${igEntries.length} entries)`
    );
    assert.strictEqual(igEntries[0].minutes, 35, `[B-20 / Probe Q] Merged Instagram minutes must equal 35 (got ${igEntries[0].minutes})`);
    app.BackendDB.data.sessionsByUser[uid] = savedSessions;
  }

  // Probe S: XSS HTML Escaping on App Names & Keys
  {
    const uid = app.getActiveOrLocalUserId();
    const savedSessions = [...(app.BackendDB.data.sessionsByUser[uid] || [])];
    const baseSec = app.ScreenTimeAggregator.parseDateStrToUtcEpochSec("2026-10-16", 0) + 36000;
    app.BackendDB.data.sessionsByUser[uid] = [{
      eventId: "xss_probe_1",
      userId: uid,
      installationKey: "s24_ultra",
      osCategory: "Android",
      appKey: 'custom"><img src=x onerror=alert(1)>',
      appName: '<img src=x onerror=alert(1)>App',
      category: "Other",
      localDate: "2026-10-16",
      startEpochSec: baseSec,
      endEpochSec: baseSec + 1800,
      durationMinutes: 30
    }];
    app.renderAll();
    const topGridHtml = documentMock.getElementById("overviewTopAppsGrid").innerHTML;
    const allAppsHtml = documentMock.getElementById("allAppsFullBreakdownList").innerHTML;
    assert(
      !topGridHtml.includes("<img src=x") && !allAppsHtml.includes("<img src=x"),
      `[C-08 / O5 / Probe S] Unescaped HTML in appName/appKey must never be injected into innerHTML`
    );
    app.BackendDB.data.sessionsByUser[uid] = savedSessions;
  }

  // Probe T: Metric Mode Switching Updates #overviewCardTitle
  {
    app.setDashboardMetricMode("REELS_COUNT");
    const titleReels = documentMock.getElementById("overviewCardTitle").textContent;
    app.setDashboardMetricMode("REEL_TIME");
    const titleReelTime = documentMock.getElementById("overviewCardTitle").textContent;
    app.setDashboardMetricMode("SCREEN");
    const titleScreen = documentMock.getElementById("overviewCardTitle").textContent;
    assert(
      titleReels !== titleScreen && titleReelTime !== titleScreen,
      `[B-19 / Probe T] #overviewCardTitle must update dynamically when switching metric modes (got SCREEN="${titleScreen}", REELS_COUNT="${titleReels}", REEL_TIME="${titleReelTime}")`
    );
  }

  // =========================================================================
  // PART III: PART 06A — CATEGORY 06 CORE AUDIT & FIXES (PROBES V1–V12)
  // =========================================================================

  // Probe V1 (C06-01 / CAT06-01 / CAT06-18): Reference-Date-Anchored Period Labels, #btnNextPeriod disabled & aria-disabled, state.periodOffset & #statsPeriodDateLabel
  {
    setupTestFixtureForUser("usr_rahim_01", "2026-10-16");
    app.state.periodMode = "DAY";
    app.state.offsets.DAY = 0;
    app.renderAll();
    const lblEl = documentMock.getElementById("statsPeriodLabel");
    const aliasLblEl = documentMock.getElementById("statsPeriodDateLabel");
    const nextBtn = documentMock.getElementById("btnNextPeriod");
    assert.strictEqual(lblEl.textContent, "Today, Oct 16", "[C06-01] #statsPeriodLabel must anchor to resolveUserReferenceDate ('Today, Oct 16')");
    assert.strictEqual(aliasLblEl.textContent, "Today, Oct 16", "[C06-01] #statsPeriodDateLabel must mirror #statsPeriodLabel");
    assert.strictEqual(nextBtn.disabled, true, "[C06-01 / CAT06-18] #btnNextPeriod.disabled must be true when offset === 0");
    assert.strictEqual(nextBtn.getAttribute("aria-disabled"), "true", "[C06-01 / CAT06-18] #btnNextPeriod aria-disabled must be 'true' when offset === 0");

    documentMock.getElementById("btnPrevPeriod").click();
    assert.strictEqual(app.state.periodOffset, -1, "[C06-01] state.periodOffset getter must reflect -1 after #btnPrevPeriod click");
    assert.strictEqual(lblEl.textContent, "Yesterday, Oct 15", "[C06-01] #statsPeriodLabel must read 'Yesterday, Oct 15' at offset -1");
    assert.strictEqual(nextBtn.disabled, false, "[C06-01] #btnNextPeriod.disabled must be false at offset -1");
    assert.strictEqual(nextBtn.getAttribute("aria-disabled"), "false", "[C06-01] #btnNextPeriod aria-disabled must be 'false' at offset -1");

    app.state.periodOffset = 0;
    app.renderAll();
    assert.strictEqual(app.state.offsets.DAY, 0, "[C06-01] state.periodOffset setter must update state.offsets[periodMode]");

    // Verify clock override (2026-11-09) overrides 2026-10-16 fixture pin (CAT06-01)
    const nov9Ms = new Date(2026, 10, 9, 12, 0, 0).getTime();
    app.TimeContext.__clockOverrideMs = nov9Ms;
    const nov9Snap = app.computeSnapshot("ALL", "DAY", 0);
    assert.strictEqual(nov9Snap.periodTitle, "Today, Nov 9", "[CAT06-01] Clock override at 2026-11-09 must yield 'Today, Nov 9' instead of freezing at Oct 16");
    app.TimeContext.__clockOverrideMs = null;
    app.renderAll();
  }

  // Probe V2 (C06-02 / CAT06-14): Period-Aware #statsDeviceDropdownMenu Totals & selectDeviceScope() Pillar Sync
  {
    setupTestFixtureForUser("usr_rahim_01", "2026-10-16");
    const uid = app.getActiveOrLocalUserId();
    const oct14Epoch = app.ScreenTimeAggregator.parseDateStrToUtcEpochSec("2026-10-14", 0) + 36000;
    app.BackendDB.data.sessionsByUser[uid].push({
      sessionId: "wk_extra_s24_oct14",
      userId: uid,
      installationKey: "s24_ultra",
      installationId: "inst_and_01",
      osCategory: "Android",
      appKey: "instagram",
      appName: "Instagram",
      category: "Social networking",
      localDate: "2026-10-14",
      hasTimestamps: true,
      hour: 14,
      startEpochSec: oct14Epoch,
      endEpochSec: oct14Epoch + 3600,
      durationMinutes: 60
    });
    app.state.periodMode = "DAY";
    app.state.offsets.DAY = 0;
    app.renderAll();
    const dayS24Mins = app.computeSnapshot("s24_ultra", "DAY", 0).totalScreenMinutes;
    const wkS24Mins = app.computeSnapshot("s24_ultra", "WEEK", 0).totalScreenMinutes;
    assert(wkS24Mins > dayS24Mins, "[C06-02] Week s24_ultra total must exceed Day total when Oct 14 session is present");

    app.state.periodMode = "WEEK";
    app.state.offsets.WEEK = 0;
    app.renderAll();
    const statsDevListHtml = documentMock.getElementById("statsSpecificDeviceOptionsList").innerHTML;
    const expectedWkLabel = app.formatCompactHrsMins(wkS24Mins);
    assert(
      statsDevListHtml.includes(expectedWkLabel),
      `[C06-02 / CAT06-14] #statsSpecificDeviceOptionsList in WEEK mode must display 7-day device total (${expectedWkLabel})`
    );
    app.selectDeviceScope("iphone_16");
    assert.strictEqual(app.state.selectedDevice, "iphone_16", "[C06-02] selectDeviceScope must update state.selectedDevice");
    app.selectDeviceScope("ALL");
    app.state.periodMode = "DAY";
    setupTestFixtureForUser("usr_rahim_01", "2026-10-16");
    app.renderAll();
  }

  // Probe V3 (C06-03 / CAT06-03): 24-Hour Distribution Profile Mode (state.lookHourly / #btnToggleHourlyChart) in WEEK/MONTH/YEAR Without Hiding Chart
  {
    setupTestFixtureForUser("usr_rahim_01", "2026-10-16");
    app.GraphDisplayStyleController.setGraphStyle("SIMPLE");
    app.state.periodMode = "WEEK";
    app.state.offsets.WEEK = 0;
    app.state.lookHourly = false;
    app.renderAll();
    const defaultWeekChartHtml = documentMock.getElementById("statsBarChartContainer").innerHTML;
    const pillarsDefaultWeekCount = (defaultWeekChartHtml.match(/data-stats-pillar="/g) || []).length;
    assert.strictEqual(pillarsDefaultWeekCount, 7, "[C06-03] WEEK mode with lookHourly=false must render 7 daily pillars");

    // Click #btnToggleHourlyChart (or set state.lookHourly = true) in WEEK mode
    documentMock.getElementById("btnToggleHourlyChart").click();
    assert.strictEqual(app.state.lookHourly, true, "[C06-03] Clicking #btnToggleHourlyChart in WEEK mode must set state.lookHourly === true");
    const wrapperEl = documentMock.getElementById("hourlyChartWrapper");
    assert(!wrapperEl.classList.contains("hidden"), "[C06-03 / CAT06-03] #hourlyChartWrapper must remain visible when lookHourly is toggled in WEEK mode");
    const hourlyWeekChartHtml = documentMock.getElementById("statsBarChartContainer").innerHTML;
    const pillarsHourlyWeekCount = (hourlyWeekChartHtml.match(/data-stats-pillar="/g) || []).length;
    assert.strictEqual(pillarsHourlyWeekCount, 24, "[C06-03 / CAT06-03] WEEK mode with lookHourly=true must render 24 hourly distribution pillars");
    const xAxisHtml = documentMock.getElementById("statsXAxisLabels").innerHTML;
    assert(xAxisHtml.includes("12:00 AM") && xAxisHtml.includes("11:59 PM"), "[C06-03] WEEK hourly profile X-axis must show 12:00 AM .. 11:59 PM");

    // Reset back to default
    app.state.lookHourly = false;
    app.state.periodMode = "DAY";
    app.state.showHourlyChart = true;
    app.renderAll();
  }

  // Probe V4 (C06-04 / CAT06-02 / CAT06-07 / CAT06-13): #statsGoalLine Positioning, YEAR February 28-Day Goal Threshold, and DAY Over-Goal Guard
  {
    setupTestFixtureForUser("usr_rahim_01", "2026-10-16");
    app.GraphDisplayStyleController.setGraphStyle("SIMPLE");
    app.state.periodMode = "WEEK";
    app.state.statsMetricMode = "SCREEN";
    app.state.screenGoalMinutes = 180;
    app.state.screenGoalEnabled = true;
    app.renderAll();
    const goalLineEl = documentMock.getElementById("statsGoalLine");
    assert(goalLineEl && !goalLineEl.classList.contains("hidden"), "[C06-04 / CAT06-02] #statsGoalLine must exist and be visible in WEEK SCREEN mode when screenGoalEnabled=true");
    assert(/^\d+%$/.test(goalLineEl.style.bottom), `[C06-04 / CAT06-02] #statsGoalLine style.bottom must be a valid percentage (got "${goalLineEl.style.bottom}")`);

    // Hide #statsGoalLine in REELS_COUNT mode or when goal disabled
    app.state.statsMetricMode = "REELS_COUNT";
    app.renderAll();
    assert(goalLineEl.classList.contains("hidden"), "[CAT06-02] #statsGoalLine must be hidden in REELS_COUNT mode");
    app.state.statsMetricMode = "SCREEN";
    app.state.screenGoalEnabled = false;
    app.renderAll();
    assert(goalLineEl.classList.contains("hidden"), "[CAT06-02] #statsGoalLine must be hidden when screenGoalEnabled=false");
    app.state.screenGoalEnabled = true;

    // DAY mode 1-hour bar must NOT be colored over-goal orange when val (25m) > dailyGoalMinutes (20m)
    app.state.periodMode = "DAY";
    app.state.statsMetricMode = "REEL_TIME";
    app.state.dailyGoalMinutes = 20;
    app.renderAll();
    const dayBarsHtml = documentMock.getElementById("statsBarChartContainer").innerHTML;
    assert(!dayBarsHtml.includes("bg-[#EA5B25]"), "[C06-04] DAY mode 1-hour bars must not be colored over-goal orange against full-day goal");

    // YEAR mode February pillar threshold uses 28 days (not 30)
    const uid = app.getActiveOrLocalUserId();
    const febEpoch = app.ScreenTimeAggregator.parseDateStrToUtcEpochSec("2026-02-10", 0) + 36000;
    app.BackendDB.data.sessionsByUser[uid].push({
      sessionId: "yr_feb_over_28d",
      userId: uid,
      installationKey: "s24_ultra",
      osCategory: "Android",
      appKey: "instagram",
      appName: "Instagram",
      category: "Social networking",
      localDate: "2026-02-10",
      hasTimestamps: true,
      startEpochSec: febEpoch,
      endEpochSec: febEpoch + (290 * 60),
      durationMinutes: 290
    });
    app.state.periodMode = "YEAR";
    app.state.statsMetricMode = "SCREEN";
    app.state.screenGoalMinutes = 10; // Feb 2026 (28 days) threshold = 280m (< 290m), whereas 30-day threshold = 300m (> 290m)
    app.state.selectedPillarIdx.STATS = 1; // February (index 1)
    app.GraphDisplayStyleController.setGraphStyle("SIMPLE");
    app.renderAll();
    const yrSnap = app.computeSnapshot("ALL", "YEAR", 0);
    const yrMaxBar = Math.max(...yrSnap.bars, Number(yrSnap.axisMax || 15), 280);
    assert.strictEqual(
      goalLineEl.getAttribute("data-goal-pct"),
      String(Math.round((280 / yrMaxBar) * 100)),
      "[CAT06-07] YEAR mode February goal threshold must use 28 days (10m * 28 = 280m)"
    );
    const yrChartHtml = documentMock.getElementById("statsBarChartContainer").innerHTML;
    assert(
      yrChartHtml.includes('data-stats-pillar="1"') && yrChartHtml.includes("bg-[#EA5B25]"),
      "[CAT06-07] February 290m bar must exceed 28-day goal threshold (280m) and render over-goal orange"
    );

    // Restore defaults
    app.state.screenGoalMinutes = 200;
    app.state.dailyGoalMinutes = 60;
    app.state.periodMode = "DAY";
    app.state.statsMetricMode = "SCREEN";
    setupTestFixtureForUser("usr_rahim_01", "2026-10-16");
    app.renderAll();
  }

  // Probe V5 (C06-05 / CAT06-12 / CAT06-19): Live Category Reassignment Cache Invalidation, Keyboard Enter/Space on [data-cat-segment], and Non-Reel 0-Reels Badge Suppression
  {
    setupTestFixtureForUser("usr_rahim_01", "2026-10-16");
    const uid = app.getActiveOrLocalUserId();
    app.state.periodMode = "DAY";
    app.state.selectedCategorySegment = null;
    app.renderAll();

    // Keyboard Enter on #catBarSocial toggles state.selectedCategorySegment
    const catBarSoc = documentMock.getElementById("catBarSocial");
    catBarSoc.dispatchEvent({ type: "keydown", key: "Enter", preventDefault() {} });
    assert.strictEqual(app.state.selectedCategorySegment, "SOCIAL", "[C06-05] Pressing Enter on #catBarSocial must select SOCIAL segment");
    catBarSoc.dispatchEvent({ type: "keydown", key: " ", preventDefault() {} });
    assert.strictEqual(app.state.selectedCategorySegment, null, "[C06-05] Pressing Space on #catBarSocial must deselect SOCIAL segment");

    // Live category reassignment invalidates _snapshotMemoCache and updates bar/donut/list immediately
    const beforeSocWidth = documentMock.getElementById("catBarSocial").style.width;
    app.CrossPlatformAppIdentityResolver.setCustomAppCategory(uid, "instagram", "Entertainment");
    app.renderAll();
    const afterSocWidth = documentMock.getElementById("catBarSocial").style.width;
    assert.notStrictEqual(afterSocWidth, beforeSocWidth, "[C06-05 / CAT06-12] Reassigning Instagram to Entertainment must immediately update #catBarSocial width");
    delete app.BackendDB.data.appCategoryRulesByUser[uid].instagram;
    app.renderAll();

    // Non-reel utility apps (e.g. Chrome, Claude) must NOT show '0 reels' badge in #statsAppUsageList
    app.state.showAllApps = true;
    app.renderAll();
    const appListHtml = documentMock.getElementById("statsAppUsageList").innerHTML;
    assert(!appListHtml.includes(">0 reels<"), "[C06-05 / CAT06-19] Non-reel utility apps with 0 reels must not render '0 reels' badge in #statsAppUsageList");
    app.state.showAllApps = false;
    app.renderAll();
  }

  // Probe V6 (C06-06 / CAT06-04 / CAT06-05): Unlock-Only RawEvents Batch, Duplicate Unlock Timestamp Collapse, Desktop RESUME_UNLOCK, Cloud Sync hourly_unlocks, and pruneOlderThan Key Parsing
  {
    const uid = app.getActiveOrLocalUserId();
    const savedSessions = [...(app.BackendDB.data.sessionsByUser[uid] || [])];
    const savedBuckets = JSON.parse(JSON.stringify(app.BackendDB.data.unlockBucketsByUser[uid] || {}));

    app.BackendDB.data.sessionsByUser[uid] = [];
    app.BackendDB.data.unlockBucketsByUser[uid] = {};
    const dayStartMs = app.ScreenTimeAggregator.parseDateStrToUtcEpochSec("2026-10-16", 0) * 1000;
    const unlockTs1 = dayStartMs + 6 * 3600 * 1000 + 30 * 60 * 1000; // 06:30 AM

    // Ingest unlock-only rawEvents with duplicate timestamps
    app.NativeUsageIntegrationService.ingestNativeUsageReport({
      userId: uid,
      installationKey: "s24_ultra",
      installationId: "inst_and_01",
      osCategory: "Android",
      localDate: "2026-10-16",
      windowStartMs: dayStartMs,
      windowEndMs: dayStartMs + 86400000,
      rawEvents: [
        { eventType: 18, timestampMs: unlockTs1, packageName: "android", instanceId: 1 },
        { eventType: 18, timestampMs: unlockTs1, packageName: "com.android.systemui", instanceId: 2 }
      ]
    });
    const unlockOnlySnap = app.computeSnapshot("ALL", "DAY", 0);
    assert.strictEqual(unlockOnlySnap.unlocks, 1, "[C06-06 / CAT06-04 / CAT06-05] Unlock-only rawEvents batch with duplicate timestamp must record exactly 1 unlock");
    assert.strictEqual(unlockOnlySnap.unlockBars[6], 1, "[C06-06] Unlock at 06:30 must populate hour 6 in unlockBars");

    // Verify First Pickup reflects unlock-only timestamp (06:30 AM) even with 0 screen minutes (CAT06-10 / C06-07)
    const unlockOnlyIns = app.SmartInsightsEngine.computeInsights("ALL", "DAY", 0);
    assert.strictEqual(unlockOnlyIns.firstPickupLabel, "6:30 AM", `[CAT06-10 / C06-07] First Pickup must reflect 6:30 AM unlock timestamp on unlock-only day (got "${unlockOnlyIns.firstPickupLabel}")`);

    // Verify pruneOlderThan purges instKey::YYYY-MM-DD keys older than cutoff
    app.BackendDB.data.unlockBucketsByUser[uid]["s24_ultra::2020-01-01"] = {
      installationKey: "s24_ultra",
      localDate: "2020-01-01",
      totalUnlocks: 5,
      hourlyUnlocks: new Array(24).fill(0),
      unlockEvents: []
    };
    const pruneRes = app.BackendDB.pruneOlderThan(uid, 30);
    assert(pruneRes.purgedUnlockBuckets >= 1 && !app.BackendDB.data.unlockBucketsByUser[uid]["s24_ultra::2020-01-01"], "[C06-06] pruneOlderThan must delete expired instKey::YYYY-MM-DD keys from unlockBucketsByUser");

    app.BackendDB.data.sessionsByUser[uid] = savedSessions;
    app.BackendDB.data.unlockBucketsByUser[uid] = savedBuckets;
    app.renderAll();
  }

  // Probe V7 (C06-07 / CAT06-09): SmartInsightsEngine.computeInsights(statsSnap, scopeTitle) Overload & Spec Insight DOM Elements
  {
    setupTestFixtureForUser("usr_rahim_01", "2026-10-16");
    app.state.periodMode = "DAY";
    app.state.offsets.DAY = 0;
    const snap = app.computeSnapshot("ALL", "DAY", 0);
    const insOverload = app.SmartInsightsEngine.computeInsights(snap, "All Devices");
    assert(insOverload && typeof insOverload.topCategoryLabel === "string" && insOverload.topCategoryLabel.includes("%"), "[C06-07] computeInsights(statsSnap, scopeTitle) must not throw and must return topCategoryLabel");
    assert(typeof insOverload.reelRatioLabel === "string" && insOverload.reelRatioLabel.includes("%"), "[C06-07] computeInsights(statsSnap, scopeTitle) must return reelRatioLabel");
    assert(typeof insOverload.reelsPerHourLabel === "string" && insOverload.reelsPerHourLabel.includes("reels/hr"), "[C06-07] computeInsights(statsSnap, scopeTitle) must return reelsPerHourLabel");

    app.renderAll();
    for (const specId of ["insightPeakWindowVal", "insightTopCategoryVal", "insightReelRatioVal", "insightAvgPaceVal", "insightReelsPerHourVal", "statsPeriodDateLabel", "statsGoalLine", "statsMainChart", "btnToggleLookHourly", "btnOpenScreenGoalFromStats", "btnOpenWatchGoalFromStats", "btnSortApps"]) {
      const el = documentMock.getElementById(specId);
      assert(el, `[C06-06 / C06-07] Spec DOM element/alias #${specId} must resolve via document.getElementById`);
    }

    // CAT06-17: Performance benchmark on 2 installations x 90 days fixture
    const { performance } = require("perf_hooks");
    const uidBench = app.getActiveOrLocalUserId();
    const savedSessBench = [...(app.BackendDB.data.sessionsByUser[uidBench] || [])];
    const baseBenchEpoch = app.ScreenTimeAggregator.parseDateStrToUtcEpochSec("2026-10-16", 0);
    const benchSessions = [];
    for (let d = 0; d < 90; d++) {
      const daySec = baseBenchEpoch - d * 86400;
      const dStr = app.LocalTime.utcWallEpochToDateStr(daySec, 0);
      for (const instKey of ["s24_ultra", "iphone_16"]) {
        benchSessions.push({
          sessionId: `bench_${instKey}_${d}_ig`,
          userId: uidBench,
          installationKey: instKey,
          osCategory: instKey === "s24_ultra" ? "Android" : "iOS",
          appKey: "instagram",
          appName: "Instagram",
          category: "Social networking",
          localDate: dStr,
          hasTimestamps: true,
          startEpochSec: daySec + 36000,
          endEpochSec: daySec + 39600,
          durationMinutes: 60,
          unlocks: 12
        });
      }
    }
    app.BackendDB.data.sessionsByUser[uidBench] = benchSessions;
    app.state.selectedDevice = "ALL";
    app.state.periodMode = "MONTH";
    app.state.offsets.MONTH = 0;
    const tCold0 = performance.now();
    app.renderAll();
    const tCold1 = performance.now();
    const tWarm0 = performance.now();
    for (let i = 0; i < 10; i++) app.renderAll();
    const tWarm1 = performance.now();
    const coldMs = Number((tCold1 - tCold0).toFixed(2));
    const warmAvgMs = Number(((tWarm1 - tWarm0) / 10).toFixed(2));
    console.log(`[CAT06-17 Benchmark] 2x90d fixture: cold=${coldMs}ms, warmAvg=${warmAvgMs}ms`);
    assert(warmAvgMs < 50, `[CAT06-17] Warm renderAll() on 2x90d fixture must complete in <50ms (got ${warmAvgMs}ms, cold=${coldMs}ms)`);
    app.BackendDB.data.sessionsByUser[uidBench] = savedSessBench;
  }

  // =========================================================================
  // PART IV: PART 06B — EXTENDED CODE PATCHES & DELTA FINDINGS (PROBES V8–V14)
  // =========================================================================

  // Probe V8 (CAT06-BUG-01 / ISSUE-C06-09): Multi-Sync rawEvents Unlock & Opens/Notifs Delta Deduplication + recordDeduplicatedUnlockEvents
  {
    const uid = app.getActiveOrLocalUserId();
    const savedSessions = [...(app.BackendDB.data.sessionsByUser[uid] || [])];
    const savedBuckets = JSON.parse(JSON.stringify(app.BackendDB.data.unlockBucketsByUser[uid] || {}));

    app.BackendDB.data.sessionsByUser[uid] = [];
    app.BackendDB.data.unlockBucketsByUser[uid] = {};
    const dayStartMs = app.ScreenTimeAggregator.parseDateStrToUtcEpochSec("2026-10-16", 0) * 1000;
    const t0900 = dayStartMs + 9 * 3600 * 1000;
    const t1000 = dayStartMs + 10 * 3600 * 1000;

    // Sync 1: 09:00 unlock + 20m Instagram session
    app.NativeUsageIntegrationService.ingestNativeUsageReport({
      userId: uid,
      installationKey: "s24_ultra",
      installationId: "inst_and_01",
      osCategory: "Android",
      localDate: "2026-10-16",
      windowStartMs: dayStartMs,
      windowEndMs: dayStartMs + 86400000,
      rawEvents: [
        { eventType: 18, timestampMs: t0900, packageName: "android", instanceId: 10 },
        { eventType: 1, timestampMs: t0900 + 1000, packageName: "com.instagram.android", className: "MainActivity", instanceId: 11 },
        { eventType: 2, timestampMs: t0900 + 1201000, packageName: "com.instagram.android", className: "MainActivity", instanceId: 11 }
      ]
    });
    const snapAfterSync1 = app.computeSnapshot("ALL", "DAY", 0);
    assert.strictEqual(snapAfterSync1.unlocks, 1, "[CAT06-BUG-01] Sync 1 must record 1 unlock");
    assert.strictEqual(snapAfterSync1.unlockBars[9], 1, "[CAT06-BUG-01] Sync 1 must record 1 unlock at hour 9");

    // Sync 2 (cumulative full-day rawEvents: original 09:00 Instagram session has 0 net new minutes, plus new 10:00 unlock + 15m YouTube session)
    app.NativeUsageIntegrationService.ingestNativeUsageReport({
      userId: uid,
      installationKey: "s24_ultra",
      installationId: "inst_and_01",
      osCategory: "Android",
      localDate: "2026-10-16",
      windowStartMs: dayStartMs,
      windowEndMs: dayStartMs + 86400000,
      rawEvents: [
        { eventType: 18, timestampMs: t0900, packageName: "android", instanceId: 10 },
        { eventType: 1, timestampMs: t0900 + 1000, packageName: "com.instagram.android", className: "MainActivity", instanceId: 11 },
        { eventType: 2, timestampMs: t0900 + 1201000, packageName: "com.instagram.android", className: "MainActivity", instanceId: 11 },
        { eventType: 18, timestampMs: t1000, packageName: "android", instanceId: 20 },
        { eventType: 1, timestampMs: t1000 + 1000, packageName: "com.google.android.youtube", className: "WatchActivity", instanceId: 21 },
        { eventType: 2, timestampMs: t1000 + 901000, packageName: "com.google.android.youtube", className: "WatchActivity", instanceId: 21 }
      ]
    });
    const snapAfterSync2 = app.computeSnapshot("ALL", "DAY", 0);
    assert.strictEqual(snapAfterSync2.unlocks, 2, `[CAT06-BUG-01] Sync 2 must record 2 cumulative unlocks even when records[0] had 0 net new minutes (got ${snapAfterSync2.unlocks})`);
    assert.strictEqual(snapAfterSync2.unlockBars[9], 1, "[CAT06-BUG-01] Hour 9 unlock bar must remain 1 after Sync 2");
    assert.strictEqual(snapAfterSync2.unlockBars[10], 1, `[CAT06-BUG-01] Hour 10 unlock bar must update to 1 after Sync 2 (got ${snapAfterSync2.unlockBars[10]})`);
    const igAppAfterSync2 = snapAfterSync2.apps.find(a => a.key === "instagram");
    assert.strictEqual(igAppAfterSync2.opens, 1, `[CAT06-BUG-01] Instagram opens must remain 1 across cumulative multi-sync (got ${igAppAfterSync2.opens})`);

    app.BackendDB.data.sessionsByUser[uid] = savedSessions;
    app.BackendDB.data.unlockBucketsByUser[uid] = savedBuckets;
    app.renderAll();
  }

  // Probe V9 (CAT06-BUG-02 & CAT06-BUG-03 / ISSUE-C06-05): #statsQuickGoalPillsRow, #statsAllDevicesMenuTotal, and #insightReelVelocityVal Alias
  {
    setupTestFixtureForUser("usr_rahim_01", "2026-10-16");
    app.state.screenGoalMinutes = 200;
    app.state.dailyGoalMinutes = 60;
    app.state.screenGoalEnabled = true;
    app.state.goalEnabled = true;
    app.renderAll();

    const pillsRow = documentMock.getElementById("statsQuickGoalPillsRow");
    const btnQuickScreen = documentMock.getElementById("btnOpenScreenGoalFromStats");
    const btnQuickWatch = documentMock.getElementById("btnOpenWatchGoalFromStats");
    const allDevMenuTot = documentMock.getElementById("statsAllDevicesMenuTotal");
    const velAlias1 = documentMock.getElementById("insightReelsVelocityVal");
    const velAlias2 = documentMock.getElementById("insightReelVelocityVal");

    assert(pillsRow, "[CAT06-BUG-02] #statsQuickGoalPillsRow must exist in #statsMainGreyCard");
    assert(btnQuickScreen && btnQuickScreen.id === "btnOpenScreenGoalFromStats", "[CAT06-BUG-02] Dedicated #btnOpenScreenGoalFromStats button must exist");
    assert(btnQuickWatch && btnQuickWatch.id === "btnOpenWatchGoalFromStats", "[CAT06-BUG-02] Dedicated #btnOpenWatchGoalFromStats button must exist");
    assert(allDevMenuTot && allDevMenuTot.textContent.includes("All Authorized •"), `[CAT06-BUG-03] #statsAllDevicesMenuTotal must display period total (got "${allDevMenuTot && allDevMenuTot.textContent}")`);
    assert(velAlias1 && velAlias2 && velAlias1 === velAlias2, "[CAT06-BUG-03] Both #insightReelsVelocityVal and #insightReelVelocityVal must resolve to #insightReelsPerHourVal");

    const ins = app.SmartInsightsEngine.computeInsights("ALL", "DAY", 0);
    assert.strictEqual(ins.reelsPerHourVelocityLabel, ins.reelsPerHourLabel, "[CAT06-BUG-03] computeInsights() must expose reelsPerHourVelocityLabel matching reelsPerHourLabel");
  }

  // Probe V10 (CAT06-BUG-04): Overview-to-Stats Category Drill-Down Does Not Self-Cancel & Donut Renders in Standard Mode
  {
    setupTestFixtureForUser("usr_rahim_01", "2026-10-16");
    app.GraphDisplayStyleController.setGraphStyle("STANDARD");
    app.switchView("OVERVIEW");
    app.state.selectedCategorySegment = null;
    app.renderAll();

    const mainCatBarSoc = documentMock.getElementById("mainCatBarSocial");
    mainCatBarSoc.click();
    assert.strictEqual(app.state.activeView, "STATS", "[CAT06-BUG-04] Clicking #mainCatBarSocial on Overview must switch to STATS view");
    assert.strictEqual(app.state.selectedCategorySegment, "SOCIAL", `[CAT06-BUG-04] Clicking #mainCatBarSocial must preserve selectedCategorySegment="SOCIAL" without self-canceling to null (got ${app.state.selectedCategorySegment})`);

    const catBarSoc = documentMock.getElementById("catBarSocial");
    assert.strictEqual(catBarSoc.getAttribute("aria-pressed"), "true", "[CAT06-BUG-04] #catBarSocial aria-pressed must be 'true' when SOCIAL is selected");
    assert.strictEqual(catBarSoc.getAttribute("data-selected"), "true", "[CAT06-BUG-04] #catBarSocial data-selected must be 'true' when SOCIAL is selected");

    const donutBox = documentMock.getElementById("statsCategoryDonutBox");
    assert(donutBox && donutBox.innerHTML.includes("<svg"), "[CAT06-BUG-04] #statsCategoryDonutBox must render SVG donut in STANDARD graph mode");

    app.state.selectedCategorySegment = null;
    app.renderAll();
  }

  // Probe V11 (CAT06-BUG-06): SmartInsightsEngine First Pickup & Last Activity Fold scopedPeriodReels Timestamps
  {
    const uid = app.getActiveOrLocalUserId();
    const savedSessions = [...(app.BackendDB.data.sessionsByUser[uid] || [])];
    const savedReels = [...(app.BackendDB.data.reelEventsByUser[uid] || [])];
    const savedBuckets = JSON.parse(JSON.stringify(app.BackendDB.data.unlockBucketsByUser[uid] || {}));

    const dayStartSec = app.ScreenTimeAggregator.parseDateStrToUtcEpochSec("2026-10-16", 0);
    app.BackendDB.data.sessionsByUser[uid] = [];
    app.BackendDB.data.unlockBucketsByUser[uid] = {};
    app.BackendDB.data.reelEventsByUser[uid] = [
      {
        eventId: "reel_early_0515",
        userId: uid,
        installationKey: "s24_ultra",
        osCategory: "Android",
        appKey: "instagram",
        localDate: "2026-10-16",
        startEpochSec: dayStartSec + (5 * 3600) + (15 * 60),
        endEpochSec: dayStartSec + (5 * 3600) + (16 * 60),
        watchSeconds: 60
      },
      {
        eventId: "reel_late_2340",
        userId: uid,
        installationKey: "s24_ultra",
        osCategory: "Android",
        appKey: "tiktok",
        localDate: "2026-10-16",
        startEpochSec: dayStartSec + (23 * 3600) + (39 * 60),
        endEpochSec: dayStartSec + (23 * 3600) + (40 * 60),
        watchSeconds: 60
      }
    ];
    const reelIns = app.SmartInsightsEngine.computeInsights("ALL", "DAY", 0);
    assert.strictEqual(reelIns.firstPickupLabel, "5:15 AM", `[CAT06-BUG-06] First Pickup must fold earliest reel timestamp 5:15 AM (got "${reelIns.firstPickupLabel}")`);
    assert.strictEqual(reelIns.lastActivityLabel, "11:40 PM", `[CAT06-BUG-06] Last Activity must fold latest reel timestamp 11:40 PM (got "${reelIns.lastActivityLabel}")`);

    app.BackendDB.data.sessionsByUser[uid] = savedSessions;
    app.BackendDB.data.reelEventsByUser[uid] = savedReels;
    app.BackendDB.data.unlockBucketsByUser[uid] = savedBuckets;
    app.renderAll();
  }

  // Probe V12 (CAT06-BUG-07): closeAllDeviceDropdownMenus Cleans Up NavigationHistoryBridge Overlay Stack & Resets aria-expanded
  {
    app.switchView("STATS");
    const statsToggleBtn = documentMock.getElementById("btnStatsDeviceDropdownToggle");
    const statsMenu = documentMock.getElementById("statsDeviceDropdownMenu");
    statsToggleBtn.click();
    assert(!statsMenu.classList.contains("hidden"), "[CAT06-BUG-07] Clicking #btnStatsDeviceDropdownToggle must open #statsDeviceDropdownMenu");
    assert(app.NavigationHistoryBridge.historyEntries.some(e => e && (e.overlay === "statsDeviceDropdownMenu" || e.id === "statsDeviceDropdownMenu")), "[CAT06-BUG-07] Opening #statsDeviceDropdownMenu must push onto NavigationHistoryBridge.overlayStack");

    app.closeAllDeviceDropdownMenus("outside");
    assert(statsMenu.classList.contains("hidden"), "[CAT06-BUG-07] closeAllDeviceDropdownMenus must hide #statsDeviceDropdownMenu");
    assert.strictEqual(statsToggleBtn.getAttribute("aria-expanded"), "false", "[CAT06-BUG-07] closeAllDeviceDropdownMenus must reset aria-expanded='false'");
    assert(!app.NavigationHistoryBridge.historyEntries.some(e => e && (e.overlay === "statsDeviceDropdownMenu" || e.id === "statsDeviceDropdownMenu")), "[CAT06-BUG-07] closeAllDeviceDropdownMenus must remove statsDeviceDropdownMenu from NavigationHistoryBridge.overlayStack");
  }

  // Probe V13 (CAT06-BUG-09, CAT06-BUG-12 & CAT06-BUG-14): Pillar aria-label, #unlocksPlotArea, and #btnDrillToDay State Sync
  {
    setupTestFixtureForUser("usr_rahim_01", "2026-10-16");
    app.state.periodMode = "WEEK";
    app.state.offsets.WEEK = 0;
    app.state.selectedPillarIdx.STATS = 4;
    app.renderAll();

    const statsChartHtml = documentMock.getElementById("statsBarChartContainer").innerHTML;
    const unlocksChartHtml = documentMock.getElementById("unlocksBarChart").innerHTML;
    const unlocksPlotArea = documentMock.getElementById("unlocksPlotArea");
    assert(unlocksPlotArea, "[CAT06-BUG-09] #unlocksPlotArea must exist inside #unlocksChartWrapper");
    assert(statsChartHtml.includes('data-stats-pillar="4"') && statsChartHtml.includes('aria-label="'), "[CAT06-BUG-12] [data-stats-pillar] must have descriptive aria-label");
    assert(unlocksChartHtml.includes('data-unlocks-pillar="4"') && unlocksChartHtml.includes('aria-label="'), "[CAT06-BUG-12] [data-unlocks-pillar] must have descriptive aria-label");

    const btnDrill = documentMock.getElementById("btnDrillToDay");
    btnDrill.click();
    assert.strictEqual(app.state.periodMode, "DAY", "[CAT06-BUG-14] #btnDrillToDay must switch periodMode to DAY");
    assert.strictEqual(app.state.periodOffset, -2, `[CAT06-BUG-14] #btnDrillToDay from index 4 of current week must set periodOffset to -2 (got ${app.state.periodOffset})`);
    assert.strictEqual(app.state.lookHourly, true, "[CAT06-BUG-14] #btnDrillToDay must set state.lookHourly = true");

    app.state.periodOffset = 0;
    app.renderAll();
  }

  // Probe V14 (CAT06-BUG-10, CAT06-BUG-11 & CAT06-BUG-13): #statsAppUsageList Launcher Exclusion, iOS Limited Badge, Sort Attribute & Historical DAY Goal Card Sync
  {
    setupTestFixtureForUser("usr_rahim_01", "2026-10-16");
    const uid = app.getActiveOrLocalUserId();
    const dayStartSec = app.ScreenTimeAggregator.parseDateStrToUtcEpochSec("2026-10-16", 0);
    app.BackendDB.data.sessionsByUser[uid].push({
      sessionId: "launcher_test_sess",
      userId: uid,
      installationKey: "s24_ultra",
      osCategory: "Android",
      appKey: "launcher",
      appName: "One UI Home",
      category: "Other",
      localDate: "2026-10-16",
      hasTimestamps: true,
      startEpochSec: dayStartSec + 28800,
      endEpochSec: dayStartSec + 30000,
      durationMinutes: 20
    });
    app.state.showAllApps = true;
    app.renderAll();
    const listHtml = documentMock.getElementById("statsAppUsageList").innerHTML;
    assert(!listHtml.includes('data-open-app="launcher"'), "[CAT06-BUG-10] System launcher must be excluded from #statsAppUsageList");
    assert.strictEqual(documentMock.getElementById("btnToggleMoreApps").getAttribute("aria-expanded"), "true", "[CAT06-BUG-11] #btnToggleMoreApps aria-expanded must reflect state.showAllApps");
    assert.strictEqual(documentMock.getElementById("btnSortAppUsage").getAttribute("data-sort-mode"), "time", "[CAT06-BUG-11] #btnSortAppUsage data-sort-mode must reflect current sort mode");

    // iOS scope shows "Limited on iOS" for reel-capable app with 0 reels
    app.selectDeviceScope("iphone_16");
    const savedReels = [...(app.BackendDB.data.reelEventsByUser[uid] || [])];
    app.BackendDB.data.reelEventsByUser[uid] = [];
    app.renderAll();
    const iosListHtml = documentMock.getElementById("statsAppUsageList").innerHTML;
    assert(iosListHtml.includes("Limited on iOS"), "[CAT06-BUG-10] iOS scope must display 'Limited on iOS' badge for reel-capable apps with aggregate-only 0-reel records");
    app.BackendDB.data.reelEventsByUser[uid] = savedReels;
    app.selectDeviceScope("ALL");

    // Historical DAY offset (-1) updates #goalCurrentUsedText to that day's usage
    app.state.periodMode = "DAY";
    app.state.offsets.DAY = -1;
    app.renderAll();
    const yestSnap = app.computeSnapshot("ALL", "DAY", -1);
    assert.strictEqual(
      documentMock.getElementById("goalCurrentUsedText").textContent,
      app.formatHrsMins(yestSnap.totalScreenMinutes),
      "[CAT06-BUG-13] Inspecting Yesterday in DAY mode must update #goalCurrentUsedText to Yesterday's usage"
    );
    app.state.offsets.DAY = 0;
    app.state.showAllApps = false;
  }

  // =========================================================================
  // PART IV: PART 05A — CATEGORY 05 CORE AUDIT REGRESSION PROBES (CAT05-01..24)
  // =========================================================================
  {
    setupTestFixtureForUser("usr_rahim_01", "2026-10-16");
    app.switchView("OVERVIEW");
    app.state.selectedCategorySegment = null;
    app.renderAll();

    // CAT05-01: Overview donut renders [data-cat-segment="SOCIAL"] and #mainCatBarSocial supports toggle-off
    const ovDonutBox = documentMock.getElementById("overviewCategoryDonutBox");
    assert(ovDonutBox && ovDonutBox.innerHTML.includes('data-cat-segment="SOCIAL"'), "[CAT05-01] Overview donut must render [data-cat-segment='SOCIAL']");
    const mainCatBarSocBtn = documentMock.getElementById("mainCatBarSocial");
    mainCatBarSocBtn.click({ stopPropagation: () => {} });
    assert.strictEqual(app.state.activeView, "STATS", "[CAT05-01] Clicking #mainCatBarSocial must switch to STATS");
    assert.strictEqual(app.state.selectedCategorySegment, "SOCIAL", "[CAT05-01] First click must select SOCIAL");
    app.switchView("OVERVIEW");
    mainCatBarSocBtn.click({ stopPropagation: () => {} });
    assert.strictEqual(app.state.selectedCategorySegment, null, "[CAT05-01] Clicking selected SOCIAL bar again must toggle off to null");
    app.switchView("OVERVIEW");

    // CAT05-05: REELS_COUNT & REEL_TIME modes show yesterday comparison delta in #overviewComparisonText
    app.setDashboardMetricMode("REELS_COUNT");
    const cmpReels = documentMock.getElementById("overviewComparisonText").textContent;
    assert(
      /vs yesterday|Same as yesterday|No yesterday data/i.test(cmpReels),
      `[CAT05-05] REELS_COUNT #overviewComparisonText must include yesterday comparison (got "${cmpReels}")`
    );
    app.setDashboardMetricMode("REEL_TIME");
    const cmpReelTime = documentMock.getElementById("overviewComparisonText").textContent;
    assert(
      /vs yesterday|Same as yesterday|No yesterday data/i.test(cmpReelTime),
      `[CAT05-05] REEL_TIME #overviewComparisonText must include yesterday comparison (got "${cmpReelTime}")`
    );

    // CAT05-18: setDashboardMetricMode accepts SCREEN_TIME alias & rejects invalid mode
    const aliasRes = app.setDashboardMetricMode("SCREEN_TIME", { skipRender: true });
    assert.strictEqual(aliasRes.ok, true, "[CAT05-18] SCREEN_TIME alias must succeed");
    assert.strictEqual(aliasRes.metricMode, "SCREEN", "[CAT05-18] SCREEN_TIME alias must map to SCREEN");
    const invalidRes = app.setDashboardMetricMode("BOGUS_MODE", { skipRender: true });
    assert.strictEqual(invalidRes.ok, false, "[CAT05-18] Invalid metric mode must return ok: false");
    assert.strictEqual(app.state.overviewMetricMode, "SCREEN", "[CAT05-18] Invalid metric mode must not mutate state");

    // CAT05-06: Selecting past pillar updates #perAppBreakdownScopeLabel away from "Today"
    app.state.selectedPillarIdx.OVERVIEW = 5;
    app.renderAll();
    const pastScopeLbl = documentMock.getElementById("perAppBreakdownScopeLabel").textContent;
    assert(!pastScopeLbl.startsWith("Today"), `[CAT05-06] Selecting pillar 5 must not label #perAppBreakdownScopeLabel as Today (got "${pastScopeLbl}")`);
    app.state.selectedPillarIdx.OVERVIEW = 6;
    app.renderAll();

    // CAT05-16: Greeting at 02:00 AM returns "Good night,"
    const g2am = app.getTimeBasedGreeting(new Date(2026, 9, 16, 2, 0, 0));
    assert.strictEqual(g2am, "Good night,", `[CAT05-16] 02:00 AM greeting must be "Good night," (got "${g2am}")`);

    // CAT05-15: Within/Over split bar has no 15% floor (5m within / 95m over -> 5% / 95%)
    const uid = app.getActiveOrLocalUserId();
    const savedGoals = { dGoal: app.state.dailyGoalMinutes };
    const savedReels = [...(app.BackendDB.data.reelEventsByUser[uid] || [])];
    app.state.dailyGoalMinutes = 5;
    const baseSec = app.ScreenTimeAggregator.parseDateStrToUtcEpochSec("2026-10-16", 0) + 43200;
    app.BackendDB.data.reelEventsByUser[uid] = [{
      eventId: "cat05_15_split_test",
      userId: uid,
      installationKey: "s24_ultra",
      installationId: "inst_and_01",
      osCategory: "Android",
      appKey: "instagram",
      appName: "Instagram",
      localDate: "2026-10-16",
      epochSec: baseSec,
      reelCount: 20,
      watchMinutes: 100,
      watchSeconds: 6000
    }];
    app.renderAll();
    assert.strictEqual(documentMock.getElementById("healthyBarFill").style.width, "5%", "[CAT05-15] 5/100 within-goal must render 5% width without 15% floor");
    assert.strictEqual(documentMock.getElementById("unhealthyBarFill").style.width, "95%", "[CAT05-15] 95/100 over-goal must render 95% width");
    app.state.dailyGoalMinutes = savedGoals.dGoal;
    app.BackendDB.data.reelEventsByUser[uid] = savedReels;
    app.renderAll();

    // CAT05-03: Static DOM ID existence check for Overview elements
    const requiredOvIds = [
      "mainHeaderAccountName", "selectedDeviceDropdownLabel", "overviewTotalScreenTime",
      "overviewHeroReelsCount", "overviewHeroReelWatchTime", "overviewComparisonText",
      "overviewWeekChart", "btnViewAllAppsFromOverview", "todayReelViewingTotalCount",
      "todayReelViewingCompareText", "todayReelViewingPeakTime", "reelViewingYMax",
      "btnOpenReelGoalFromOverview", "perAppBreakdownScopeLabel"
    ];
    requiredOvIds.forEach((id) => {
      assert(documentMock.getElementById(id), `[CAT05-03] Required Overview DOM ID #${id} must exist`);
    });
  }

  // =========================================================================
  // PART V: PART 05B — CATEGORY 05 EXTENDED DELTA REGRESSION PROBES (CAT05B-01..08)
  // =========================================================================
  {
    setupTestFixtureForUser("usr_rahim_01", "2026-10-16");
    app.switchView("OVERVIEW");
    app.renderAll();

    // CAT05B-01: Spec DOM ID aliases & state.overviewSelectedMetric sync
    const specAliasIds = [
      "mainHeaderUserName", "deviceSelectedLabel", "overviewScreenTimeVal",
      "overviewReelsCountVal", "overviewReelTimeVal", "overviewCompareText",
      "overviewScreenChartArea", "btnOpenAllAppsBreakdown", "btnOpenAppLimitsFromAllApps",
      "reelCardTotalCount", "reelCardComparison", "reelCardPeakTime",
      "reelYMax", "reelYMid", "reelGoalStatusBadge", "reelGoalProgressBar",
      "btnEditWatchGoal", "todayReelViewingCompareHeader"
    ];
    specAliasIds.forEach((id) => {
      assert(documentMock.getElementById(id), `[CAT05B-01] Spec DOM ID #${id} must exist`);
    });
    app.setDashboardMetricMode("REELS_COUNT");
    assert.strictEqual(app.state.overviewSelectedMetric, "REELS_COUNT", "[CAT05B-01] state.overviewSelectedMetric must sync with setDashboardMetricMode");
    assert.strictEqual(documentMock.getElementById("overviewMetricBtnReelsCount").getAttribute("data-selected"), "true", "[CAT05B-01] Active metric card must have data-selected='true'");
    assert.strictEqual(documentMock.getElementById("overviewMetricBtnScreen").getAttribute("data-selected"), "false", "[CAT05B-01] Inactive metric card must have data-selected='false'");
    app.setDashboardMetricMode("SCREEN");

    // CAT05B-02: AlertCenter.computeActiveAlerts includes NotificationInboxStore unread items
    const uid = app.getActiveOrLocalUserId();
    if (typeof app.NotificationInboxStore !== "undefined" && typeof app.NotificationInboxStore.add === "function") {
      const savedInbox = [...((app.BackendDB.data.notificationInboxByUser && app.BackendDB.data.notificationInboxByUser[uid]) || [])];
      app.NotificationInboxStore.add({ userId: uid, category: "GENERAL", title: "Test Inbox Alert", body: "Check unread dot" });
      const alertsWithInbox = app.AlertCenter.computeActiveAlerts();
      assert(alertsWithInbox.hasUnseenAlert, "[CAT05B-02] Unread NotificationInboxStore item must trigger hasUnseenAlert");
      if (app.BackendDB.data.notificationInboxByUser) app.BackendDB.data.notificationInboxByUser[uid] = savedInbox;
    }

    // CAT05B-03: positionChartTooltipWithinBounds clamps clear of right Y-axis
    const tipMock = documentMock.getElementById("overviewChartTooltip");
    const posRes = app.positionChartTooltipWithinBounds(tipMock, { clientWidth: 320 }, { clientWidth: 240 }, 6, 7, "9h 15m", "Friday");
    assert(posRes.leftPct > 0 && posRes.leftPct < 80, `[CAT05B-03] Tooltip leftPct must clamp inside plotArea without overlapping Y-axis (got ${posRes.leftPct}%)`);

    // CAT05B-04: GraphDisplayStyleController.getGraphStyle() normalizes BAR -> SIMPLE
    const savedGraphStyle = app.state.graphDisplayStyle;
    app.state.graphDisplayStyle = "BAR";
    assert.strictEqual(app.GraphDisplayStyleController.getGraphStyle(), "SIMPLE", "[CAT05B-04] BAR must normalize to SIMPLE in getGraphStyle()");
    app.state.graphDisplayStyle = savedGraphStyle;

    // CAT05B-05: [data-overview-pillar] & [data-ov-day-label] keyboard accessibility
    const ovChartHtml05b = documentMock.getElementById("overviewWeekChart").innerHTML;
    const ovXAxisHtml05b = documentMock.getElementById("overviewWeekXAxis").innerHTML;
    assert(ovChartHtml05b.includes('data-overview-pillar="0"') && ovChartHtml05b.includes('data-overview-pillar="6"'), "[CAT05B-05] [data-overview-pillar] attributes must render on all 7 pillars");
    assert(ovXAxisHtml05b.includes('data-ov-day-label="0"') && ovXAxisHtml05b.includes('tabindex="0"'), "[CAT05B-05] [data-ov-day-label] must be keyboard focusable");

    // CAT05B-06: #btnOpenAppLimitsFromAllApps navigates to APP_LIMITS with appLimitsOrigin = ALL_APPS
    app.switchView("ALL_APPS");
    documentMock.getElementById("btnOpenAppLimitsFromAllApps").click();
    assert.strictEqual(app.state.activeView, "APP_LIMITS", "[CAT05B-06] #btnOpenAppLimitsFromAllApps must navigate to APP_LIMITS");
    assert.strictEqual(app.state.appLimitsOrigin, "ALL_APPS", "[CAT05B-06] appLimitsOrigin must be ALL_APPS");
    app.switchView("OVERVIEW");

    // CAT05B-07: Period-aware #todayReelViewingCompareHeader
    app.state.reelGraphPeriod = "WEEK";
    app.renderAll();
    assert.strictEqual(documentMock.getElementById("todayReelViewingCompareHeader").textContent, "Compared To Previous Week", "[CAT05B-07] WEEK period must update #todayReelViewingCompareHeader");
    app.state.reelGraphPeriod = "DAY";
    app.renderAll();

    // CAT05B-08: Sub-30s reel activity (0m rounded watch, >0 reelCount) still reports peak window via reelCountBars
    const savedReels08 = [...(app.BackendDB.data.reelEventsByUser[uid] || [])];
    const sub30Epoch = app.ScreenTimeAggregator.parseDateStrToUtcEpochSec("2026-10-16", 0) + 14 * 3600 + 300;
    app.BackendDB.data.reelEventsByUser[uid] = [{
      eventId: "cat05b_08_sub30",
      startEpochMs: sub30Epoch * 1000,
      hour: 14,
      userId: uid,
      installationKey: "s24_ultra",
      installationId: "inst_and_01",
      osCategory: "Android",
      appKey: "instagram",
      appName: "Instagram",
      localDate: "2026-10-16",
      epochSec: sub30Epoch,
      startEpochSec: sub30Epoch,
      endEpochSec: sub30Epoch + 18,
      timestampSec: sub30Epoch,
      hasTimestamps: true,
      reelCount: 2,
      watchMinutes: 0,
      watchSeconds: 18
    }];
    app.renderAll();
    const peakSub30 = documentMock.getElementById("todayReelViewingPeakTime").textContent;
    assert(peakSub30 !== "No reel activity recorded", `[CAT05B-08] Sub-30s reel activity must still compute peak time via reelCountBars (got "${peakSub30}")`);
    app.BackendDB.data.reelEventsByUser[uid] = savedReels08;
    app.renderAll();
  }

  // Restore clean baseline fixture
  setupTestFixtureForUser("usr_rahim_01", "2026-10-16");
  app.state.selectedDevice = "ALL";
  app.state.statsMetricMode = "SCREEN";
  app.state.overviewMetricMode = "SCREEN";
  app.state.graphDisplayStyle = "SIMPLE";
  app.switchView("OVERVIEW");
  app.renderAll();
}

module.exports = { runCategory05And06Tests };

if (require.main === module) {
  const { spawnSync } = require("child_process");
  const res = spawnSync(process.execPath, [path.join(__dirname, "run_all_tests.js")], { stdio: "inherit" });
  process.exit(res.status || 0);
}
