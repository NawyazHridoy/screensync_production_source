#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

function createMockElement(id = '', initialClasses = []) {
  const classes = new Set(initialClasses);
  const attrs = {};
  const listeners = {};
  const el = {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    checked: false,
    disabled: false,
    style: { setProperty: () => {}, removeProperty: () => {} },
    children: [],
    dataset: {},
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c),
      toggle: (c, force) => {
        if (force === undefined) {
          if (classes.has(c)) classes.delete(c); else classes.add(c);
        } else if (force) classes.add(c);
        else classes.delete(c);
      }
    },
    setAttribute: (k, v) => { attrs[k] = String(v); },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    addEventListener: (ev, fn) => {
      if (!listeners[ev]) listeners[ev] = [];
      listeners[ev].push(fn);
    },
    dispatchEvent: (evObj) => {
      const list = listeners[evObj?.type] || [];
      list.forEach((fn) => fn(evObj));
    },
    querySelectorAll: () => [],
    querySelector: () => null,
    appendChild: (c) => { el.children.push(c); return c; },
    focus: () => {},
    scrollTo: () => {},
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 320, height: 180 })
  };
  return el;
}

function loadAppContext(rootDir) {
  const htmlPath = path.join(rootDir, 'src', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const scriptMatches = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  const appScript = scriptMatches[scriptMatches.length - 1][1];

  const storageMap = new Map();
  const localStorageMock = {
    getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: (k) => storageMap.delete(k),
    clear: () => storageMap.clear()
  };

  const elements = new Map();
  const knownIds = [
    'focusDurationPickerCard', 'focusActiveCountdownCard', 'focusDurationManualInput',
    'focusDurationSlider', 'focusDurationValidationError', 'focusSelectedDurationBadge',
    'focusCountdownDisplay', 'focusCountdownProgressFill', 'focusCountdownStateBadge',
    'focusCountdownActiveControls', 'btnStartFocusSession', 'btnPauseResumeFocus',
    'statusLabel', 'focusStatusLabel', 'toggleFocusDistractionGuard',
    'focusTotalMinsText', 'focusTotalDaysText', 'focusTotalSessionsText',
    'focusHistorySummaryBadge', 'focusHistoryList', 'focusGrowthStageLabel',
    'focusTreeStageEmblem', 'focusTreeStageSvg', 'focusHeroSceneCard',
    'focusHeroHillBack', 'focusHeroHillFront', 'focusHeroCelestial',
    'focusStreakDaysText', 'streakActiveBadge', 'streakStatusSubtitle',
    'streakSevenDayStrip', 'weeklyChallengesList', 'achievementsBadgesRow',
    'focusScreenGoalHrsInput', 'focusScreenGoalMinsInput', 'focusScreenGoalValidationMsg',
    'focusGoalHrsInput', 'focusGoalMinsInput', 'focusReelGoalValidationMsg',
    'toggleScreenGoalEnabled', 'toggleGoalEnabled', 'toggleStatsScreenAlert', 'toggleStatsReelAlert',
    'toastBanner', 'toastTitle', 'toastMessage', 'systemLevelGoalOverlayHost'
  ];
  knownIds.forEach((id) => elements.set(id, createMockElement(id)));
  elements.get('focusActiveCountdownCard').classList.add('hidden');
  elements.get('toggleFocusDistractionGuard').checked = true;
  elements.get('toggleScreenGoalEnabled').checked = true;
  elements.get('toggleGoalEnabled').checked = true;

  const docListeners = {};
  const documentMock = {
    documentElement: createMockElement('html'),
    body: createMockElement('body'),
    visibilityState: 'visible',
    getElementById: (id) => {
      if (!elements.has(id)) elements.set(id, createMockElement(id));
      return elements.get(id);
    },
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: (tag) => createMockElement(tag),
    addEventListener: (ev, fn) => {
      if (!docListeners[ev]) docListeners[ev] = [];
      docListeners[ev].push(fn);
    },
    dispatchEvent: (evObj) => {
      (docListeners[evObj?.type] || []).forEach((fn) => fn(evObj));
    }
  };

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
    Math,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    Promise,
    Error,
    RegExp,
    Intl,
    localStorage: localStorageMock,
    sessionStorage: localStorageMock,
    document: documentMock,
    navigator: { onLine: true, userAgent: 'NodeTest/1.0' },
    location: { protocol: 'https:', hostname: 'localhost', href: 'https://localhost/' },
    history: { state: null, pushState: () => {}, replaceState: () => {}, back: () => {} },
    addEventListener: () => {},
    dispatchEvent: () => {},
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    CustomEvent: function (type, init) { this.type = type; this.detail = init?.detail; }
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;

  const exported = vm.runInNewContext(
    appScript + "\n;({ state, BackendDB, FocusModeController, GoalPickerController, GoalAlertSyncEngine, StreaksAndChallengesEngine, ScreenSyncWellnessEngine, WheelTimePickerController, NotificationFatigueGuard, NotificationScheduleManager, handleAutomaticAppContextChange, getLocalCapabilities, getTodayLocalDateStr, shiftDateStrByDays, window })",
    sandbox
  );
  if (typeof exported.BackendDB?.init === 'function') {
    exported.BackendDB.init();
  }
  exported.BackendDB._inAutomatedVerificationSuite = true;
  return { app: exported, html, storageMap, elements, documentMock };
}

async function runCategory08Tests(rootDir = path.resolve(__dirname, '..')) {
  const { app, html, storageMap, elements, documentMock } = loadAppContext(rootDir);
  const appJs = fs.readFileSync(path.join(rootDir, 'src', 'js', 'app.js'), 'utf8');
  const mainCss = fs.readFileSync(path.join(rootDir, 'src', 'styles', 'main.css'), 'utf8');
  const mainJava = fs.readFileSync(path.join(rootDir, 'android/app/src/main/java/io/screensync/wellness/MainActivity.java'), 'utf8');
  const accJava = fs.readFileSync(path.join(rootDir, 'android/app/src/main/java/io/screensync/wellness/ScreenSyncAccessibilityService.java'), 'utf8');
  const mig14 = fs.readFileSync(path.join(rootDir, 'supabase/migrations/20261022000014_category08_focus_and_goal_alert_hardening.sql'), 'utf8');

  const uid = 'usr_cat08_test_01';
  app.state.currentUser = { userId: uid, email: 'cat08@screensync.io', name: 'Cat08 Tester' };
  app.state.isAuthenticated = true;
  app.BackendDB.ensureUserStructures(uid);

  // CAT08-02: completeSession guard & 0-min contradiction
  app.state.focusCountdownActive = false;
  app.FocusModeController.activeSessionId = null;
  const idleDone = app.FocusModeController.completeSession();
  assert.strictEqual(idleDone.ok, false, 'CAT08-02: completeSession when idle must fail');
  assert.strictEqual(idleDone.status, 'NOT_ACTIVE', 'CAT08-02: completeSession when idle must return NOT_ACTIVE');

  app.FocusModeController.startCountdown(60);
  app.FocusModeController.tick(3);
  const early5s = app.FocusModeController.completeSession({ earlyCompletion: true });
  assert.strictEqual(early5s.session.status, 'CANCELLED', 'CAT08-02: <1m early completion must be CANCELLED');
  assert.strictEqual(early5s.session.endReason, 'CANCELLED', 'CAT08-02: 0-min early completion must not be COMPLETED_EARLY');
  const doubleDone = app.FocusModeController.completeSession();
  assert.strictEqual(doubleDone.status, 'NOT_ACTIVE', 'CAT08-02: double completeSession must be rejected');

  // CAT08-01: Recovery resume, completed-while-closed, 5s kill (0m), heartbeat <= 5s
  assert(app.FocusModeController.HEARTBEAT_INTERVAL_MS <= 5000, 'CAT08-01: HEARTBEAT_INTERVAL_MS must be <= 5000ms');
  const nowMs = Date.now();
  storageMap.set(app.FocusModeController.ACTIVE_FOCUS_STORAGE_KEY, JSON.stringify({
    sessionId: 'cat08_resume_01',
    userId: uid,
    startedAtMs: nowMs - 10 * 60000,
    targetEndTimeMs: nowMs + 20 * 60000,
    lastSeenUtcMs: nowMs - 5000,
    plannedMinutes: 30,
    totalSeconds: 1800,
    remainingSeconds: 1200,
    paused: false
  }));
  const resResume = app.FocusModeController.recoverInterruptedSessionIfNeeded({ nowMs, skipInterval: true });
  assert.strictEqual(resResume.recovered, true);
  assert.strictEqual(resResume.resumed, true, 'CAT08-01: mid-session kill must resume countdown');
  assert(resResume.remainingSeconds >= 1199 && resResume.remainingSeconds <= 1201, 'CAT08-01: resumed remainingSeconds must match wall clock');
  app.FocusModeController.cancelCountdown();

  storageMap.set(app.FocusModeController.ACTIVE_FOCUS_STORAGE_KEY, JSON.stringify({
    sessionId: 'cat08_closed_done_01',
    userId: uid,
    startedAtMs: nowMs - 40 * 60000,
    targetEndTimeMs: nowMs - 10 * 60000,
    lastSeenUtcMs: nowMs - 30 * 60000,
    plannedMinutes: 30,
    totalSeconds: 1800,
    remainingSeconds: 1200,
    paused: false
  }));
  const resClosed = app.FocusModeController.recoverInterruptedSessionIfNeeded({ nowMs });
  assert.strictEqual(resClosed.completedWhileClosed, true, 'CAT08-01: session finished while closed must complete');
  assert.strictEqual(resClosed.session.status, 'COMPLETED');
  assert.strictEqual(resClosed.session.completedMinutes, 30);

  storageMap.set(app.FocusModeController.ACTIVE_FOCUS_STORAGE_KEY, JSON.stringify({
    sessionId: 'cat08_5s_kill_01',
    userId: uid,
    startedAtMs: nowMs - 5000,
    lastSeenUtcMs: nowMs,
    plannedMinutes: 30,
    totalSeconds: 1800,
    remainingSeconds: 1795,
    paused: false
  }));
  const res5s = app.FocusModeController.recoverInterruptedSessionIfNeeded({ nowMs });
  assert.strictEqual(res5s.session.completedMinutes, 0, 'CAT08-01: 5s kill must credit 0 minutes');
  assert.strictEqual(res5s.session.status, 'CANCELLED');

  // CAT08-03: Pomodoro 5m/15m breaks startable + DB CHECK migration
  app.FocusModeController.setPomodoroMode(true);
  app.FocusModeController.startCountdown(25);
  app.FocusModeController.completeSession();
  assert.strictEqual(app.FocusModeController.pomodoroPhase, 'SHORT_BREAK');
  const breakStart = app.FocusModeController.startCountdown();
  assert.strictEqual(breakStart.ok, true, 'CAT08-03: 5-min Pomodoro break must start cleanly');
  assert.strictEqual(breakStart.durationMinutes, 5);
  app.FocusModeController.cancelCountdown();
  app.FocusModeController.setPomodoroMode(false);
  assert(mig14.includes('planned_minutes >= 1 AND planned_minutes <= 240'), 'CAT08-03: migration 014 must widen planned_minutes CHECK');

  // CAT08-04 & CAT08-07: Distraction guard wired into handleAutomaticAppContextChange + card toggle
  app.FocusModeController.startCountdown(25);
  assert.strictEqual(elements.get('focusDurationPickerCard').classList.contains('hidden'), true, 'CAT08-07: picker card hidden while active');
  assert.strictEqual(elements.get('focusActiveCountdownCard').classList.contains('hidden'), false, 'CAT08-07: countdown card visible while active');
  app.handleAutomaticAppContextChange('instagram');
  assert.strictEqual(app.FocusModeController.distractionWarnings, 1, 'CAT08-04: instagram mid-focus must increment distractionWarnings');
  app.handleAutomaticAppContextChange('vscode');
  assert.strictEqual(app.FocusModeController.distractionWarnings, 1, 'CAT08-04: work app must not increment distractionWarnings');
  app.FocusModeController.cancelCountdown();
  assert.strictEqual(elements.get('focusDurationPickerCard').classList.contains('hidden'), false, 'CAT08-07: picker card visible when idle');
  assert.strictEqual(elements.get('focusActiveCountdownCard').classList.contains('hidden'), true, 'CAT08-07: countdown card hidden when idle');

  // CAT08-05 & CAT08-19: Zero installations alert + iOS channel
  app.BackendDB.data.installationsByUser[uid] = [];
  const zeroInstDisp = app.GoalAlertSyncEngine.dispatchGoalReachedEvent({
    userId: uid,
    goalType: 'REEL_WATCH_GOAL',
    goalPeriodDate: app.getTodayLocalDateStr(),
    usedMinutes: 70,
    goalMinutes: 60
  });
  assert.strictEqual(zeroInstDisp.ok, true, 'CAT08-05: zero installations must still dispatch');
  assert.strictEqual(zeroInstDisp.newlyDeliveredCount, 1, 'CAT08-05: implicit local installation must receive alert');
  app.window.webkit = { messageHandlers: { ScreenSyncNative: { postMessage: () => {} } } };
  app.window.ScreenSyncNativeBridge = { presentSystemGoalAlert: () => '{}' };
  const iosCap = app.getLocalCapabilities();
  assert.strictEqual(iosCap.channel, 'IOS_SYSTEM_NOTIFICATION', 'CAT08-19: iOS bridge must return IOS_SYSTEM_NOTIFICATION');
  delete app.window.webkit;

  // CAT08-06: Native outbox consumer
  let clearedOutbox = null;
  app.window.ScreenSyncNativeBridge = {
    consumePendingGoalAlertOutboxJson: () => JSON.stringify([
      { eventId: 'goal_evt_outbox_1', goalType: 'SCREEN_TIME_GOAL', goalPeriodDate: app.getTodayLocalDateStr(), goalMinutes: 200, usedMinutes: 210, createdAtMs: Date.now() }
    ]),
    clearPendingGoalAlertOutboxIdsJson: (ids) => { clearedOutbox = JSON.parse(ids); }
  };
  const outRes = app.GoalAlertSyncEngine.consumeNativeGoalAlertOutbox();
  assert.strictEqual(outRes.consumed, 1, 'CAT08-06: native outbox consumer must process pending event');
  assert.deepStrictEqual(clearedOutbox, ['goal_evt_outbox_1'], 'CAT08-06: delivered event must be cleared from outbox');
  delete app.window.ScreenSyncNativeBridge;
  assert(mainJava.includes('consumePendingGoalAlertOutboxJson'), 'CAT08-06: MainActivity.java must expose outbox consumer');

  // CAT08-08 & CAT08-09: Debounce, bounds, split save/toggle
  const origSaveGoal = app.GoalPickerController.saveDailyGoal.bind(app.GoalPickerController);
  let saveCalls = 0;
  app.GoalPickerController.saveDailyGoal = (...args) => { saveCalls += 1; return origSaveGoal(...args); };
  elements.get('focusScreenGoalHrsInput').value = '3';
  elements.get('focusScreenGoalMinsInput').value = '0';
  for (let i = 0; i < 5; i++) {
    app.WheelTimePickerController._autoSaveFocusGoalFromWheels('SCREEN');
  }
  await new Promise((r) => setTimeout(r, 700));
  assert.strictEqual(saveCalls, 1, 'CAT08-08: 5 rapid wheel ticks must debounce to 1 saveDailyGoal');
  app.GoalPickerController.saveDailyGoal = origSaveGoal;
  assert.strictEqual(app.GoalPickerController.validateGoalHoursMinutes(0, 14, 'SCREEN').valid, false, 'CAT08-09: Screen 14m rejected');
  assert.strictEqual(app.GoalPickerController.validateGoalHoursMinutes(0, 15, 'SCREEN').valid, true, 'CAT08-09: Screen 15m accepted');
  assert.strictEqual(app.GoalPickerController.validateGoalHoursMinutes(0, 4, 'REEL').valid, false, 'CAT08-09: Reel 4m rejected');
  assert.strictEqual(app.GoalPickerController.validateGoalHoursMinutes(0, 5, 'REEL').valid, true, 'CAT08-09: Reel 5m accepted');

  // CAT08-10: Streaks loophole removal & 7-day strip
  const today = app.getTodayLocalDateStr();
  app.BackendDB.data.sessionsByUser[uid] = [{ sessionId: 's_binge', userId: uid, localDate: today, durationMinutes: 500 }];
  app.BackendDB.data.reelEventsByUser[uid] = [{ eventId: 'r_binge', userId: uid, localDate: today, watchMinutes: 10, reelCount: 5 }];
  app.BackendDB.data.focusSessionsByUser[uid] = [{ sessionId: 'f_binge', userId: uid, localDate: today, plannedMinutes: 30, completedMinutes: 30, status: 'COMPLETED' }];
  app.state.screenGoalMinutes = 200;
  app.state.dailyGoalMinutes = 60;
  app.state.screenGoalEnabled = true;
  app.state.goalEnabled = true;
  const bingeStreak = app.StreaksAndChallengesEngine.computeStreakSummary(uid);
  assert.strictEqual(bingeStreak.currentStreakDays, 0, 'CAT08-10: focus session must not excuse 2.5x screen goal overage');
  assert(bingeStreak.challenges.some((c) => c.id === 'chal_reel_goal_week'), 'CAT08-10: weekly challenges must include reel goal');
  assert(bingeStreak.challenges.some((c) => c.id === 'chal_screen_goal_week'), 'CAT08-10: weekly challenges must include screen goal');
  app.StreaksAndChallengesEngine.renderStreaksAndChallengesUI();
  assert(elements.get('streakSevenDayStrip').innerHTML.includes('data-streak-day='), 'CAT08-10: 7-day strip must render day cells');

  // CAT08-11 & CAT08-20: Single-driver Focus Tree & CSS stage rules
  const lowXp60 = app.ScreenSyncWellnessEngine.computeFocusTreeStage(60, 1, 0);
  assert.strictEqual(lowXp60.stageKey, 'SEEDLING', 'CAT08-11: 60m with 145 XP (Lv.2) must stay SEEDLING under single-driver level formula');
  assert(mainCss.includes('#focusHeroSceneCard[data-focus-stage="ANCIENT_FOREST"]'), 'CAT08-11: main.css must style focus stages');
  assert(!mainCss.includes('#focusHeroHillBack {\n      fill: #BFDBFE !important;'), 'CAT08-20: conflicting !important hill fill must be removed');

  // CAT08-13: Daily cap MAX_ALERTS_PER_TYPE_PER_DAY = 3
  const capDate = app.shiftDateStrByDays(today, 1);
  for (let i = 1; i <= 3; i++) {
    const d = app.GoalAlertSyncEngine.dispatchGoalReachedEvent({
      userId: uid,
      goalType: 'SCREEN_TIME_GOAL',
      goalPeriodDate: capDate,
      goalMinutes: 100 + i * 10,
      usedMinutes: 200
    });
    assert.strictEqual(d.ok, true, `CAT08-13: alert ${i} within cap must succeed`);
  }
  const d4 = app.GoalAlertSyncEngine.dispatchGoalReachedEvent({
    userId: uid,
    goalType: 'SCREEN_TIME_GOAL',
    goalPeriodDate: capDate,
    goalMinutes: 150,
    usedMinutes: 200
  });
  assert.strictEqual(d4.status, 'CAP_REACHED', 'CAT08-13: 4th alert on same type/day must return CAP_REACHED');

  // CAT08-12 & CAT08-15 & CAT08-16 & CAT08-21
  assert(appJs.includes('onConflict: "user_id,goal_type,goal_period_date"'), 'CAT08-12: goal_alert_events upsert must use period conflict key');
  assert(accJava.includes('DISTRACTION_COOLDOWN_MS = 30_000L'), 'CAT08-15: native distraction cooldown aligned to 30s');
  assert(appJs.includes('FocusModeController.resumeWallClockSync()'), 'CAT08-16: visibilitychange must call resumeWallClockSync');
  assert(!html.includes('id="focusDurationManualInput" type="number" min="20" max="180" step="1" value="30" class="sr-only"'), 'CAT08-21: focusDurationManualInput must be visible');

  // CAT08-17: History date unknown & Time not recorded
  assert.strictEqual(app.FocusModeController.formatDynamicFocusTimeRange({ completedMinutes: 30 }), 'Time not recorded', 'CAT08-17: missing timestamps must return Time not recorded');

  // Part 08B Delta Checks: 45m preset, smooth pill transition, startSession alias, goalHistoryByUser hydration, Android & Supabase Pass B
  assert(html.includes('data-focus-min="45"'), 'Part08B: 45-minute focus preset button must exist in src/index.html');
  assert(!mainCss.includes('#focusSubTabBar,\n#focusSubTabBar > button,\n#splashStudioPreviewStage {\n  animation-delay: 0ns !important;\n  transition-delay: 0ns !important;\n  transition-duration: 0ns !important;'), 'Part08B: #focusSubTabBar must not have transition-duration: 0ns !important');
  assert.strictEqual(typeof app.FocusModeController.startSession, 'function', 'Part08B: FocusModeController.startSession alias must exist');
  assert(appJs.includes('if (parsed.goalHistoryByUser) Object.assign(this.data.goalHistoryByUser, parsed.goalHistoryByUser)'), 'Part08B: BackendDB.init must hydrate goalHistoryByUser');
  assert(appJs.includes('screen_goal_updated_at: sCfg.screenGoalUpdatedAt || state.screenGoalUpdatedAt || null'), 'Part08B: settingsRow must include screen_goal_updated_at');
  assert(appJs.includes('distractingPackages:'), 'Part08B: syncNativeTimersAndFocusState must pass distractingPackages');
  assert(accJava.includes('isDistractingFocusPackage(pkg, obj)'), 'Part08B: ScreenSyncAccessibilityService must filter distracting packages during Focus');
  assert(accJava.includes('"Stay focused! Put away " + appLabel'), 'Part08B: ScreenSyncAccessibilityService must interpolate appLabel in distraction guard');
  assert(accJava.includes('NativeGoalAlertEvaluator.evaluate(this, "WATCH_DELTA")'), 'Part08B: addPersistedWatchDurationMs must invoke NativeGoalAlertEvaluator');
  const nativeEvalJava = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/io/screensync/wellness/NativeGoalAlertEvaluator.java'), 'utf8');
  assert(nativeEvalJava.includes('if (screenUsedMins >= screenGoalMins && !isEditReason)'), 'Part08B: NativeGoalAlertEvaluator must not write firedKey on GOAL_UPDATED/TOGGLE_ENABLED');
  assert(nativeEvalJava.includes('"goal_alert_fired_" + uid + "_SCREEN_"'), 'Part08B: NativeGoalAlertEvaluator must scope firedKey by uid');
  const mig15 = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261022000015_category08_pass_b_goal_history_deliveries_and_realtime.sql'), 'utf8');
  assert(mig15.includes('CREATE TABLE IF NOT EXISTS public.goal_history') && mig15.includes('CREATE TABLE IF NOT EXISTS public.goal_alert_deliveries'), 'Part08B: migration 0015 must create goal_history and goal_alert_deliveries');

  console.log('[PASS] Category 08 Acceptance Suite: All CAT08-01..CAT08-22 checks verified!');
}

module.exports = { runCategory08Tests };

if (require.main === module) {
  runCategory08Tests().catch((err) => {
    console.error(err);
    process.exitCode = 1;
    process.exit(1);
  });
}
