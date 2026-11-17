'use strict';

/**
 * ScreenSync — Category 04 Behavioral & Cross-Platform Acceptance Suite (Part 04A)
 * Screen Time Aggregation, Interval Union & Historical Backfill (Features 4.1–4.6)
 * Covers:
 *   - C04-ISS-01..C04-ISS-06
 *   - CAT04-01..CAT04-19
 *   - C4-D01..C4-D16
 *   - Starter Fix S04 (Fix 5 & Fix 6: D-1, D-2, D-3)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createStandaloneAppContext(rootDir) {
  const htmlPath = path.join(rootDir, 'www', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const elementsById = new Map();
  class MiniElement {
    constructor(id = '') {
      this.id = id;
      this.textContent = '';
      this.innerHTML = '';
      this.value = '';
      this.checked = false;
      this.dataset = {};
      this.attributes = {};
      this.style = { setProperty() {} };
      this.children = [];
      this._classes = new Set();
      const self = this;
      this.classList = {
        add(...t) { t.forEach(x => self._classes.add(x)); },
        remove(...t) { t.forEach(x => self._classes.delete(x)); },
        contains(t) { return self._classes.has(t); },
        toggle(t, force) {
          if (force === true) self._classes.add(t);
          else if (force === false) self._classes.delete(t);
          else if (self._classes.has(t)) self._classes.delete(t);
          else self._classes.add(t);
        }
      };
    }
    get className() { return Array.from(this._classes).join(' '); }
    set className(v) { this._classes = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    getAttribute(k) { return this.attributes[k] !== undefined ? this.attributes[k] : null; }
    addEventListener() {}
    removeEventListener() {}
    querySelectorAll() { return []; }
    querySelector() { return null; }
    contains() { return false; }
  }
  const storageMap = new Map();
  const localStorageMock = {
    getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: (k) => storageMap.delete(k),
    clear: () => storageMap.clear()
  };
  const documentMock = {
    documentElement: new MiniElement('htmlRoot'),
    body: new MiniElement('bodyRoot'),
    readyState: 'complete',
    visibilityState: 'visible',
    getElementById(id) {
      if (!elementsById.has(id)) elementsById.set(id, new MiniElement(id));
      return elementsById.get(id);
    },
    querySelector() { return new MiniElement('div'); },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {},
    createElement(tag) { return new MiniElement(tag); }
  };
  const windowMock = {
    document: documentMock,
    localStorage: localStorageMock,
    sessionStorage: localStorageMock,
    navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', onLine: true, language: 'en-US' },
    location: { href: 'http://127.0.0.1:3001/', origin: 'http://127.0.0.1:3001', protocol: 'http:', hostname: '127.0.0.1' },
    history: { state: null, length: 1, pushState() {}, replaceState() {}, back() {} },
    innerWidth: 412,
    innerHeight: 915,
    screen: { width: 412, height: 915 },
    devicePixelRatio: 2,
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    requestAnimationFrame: (cb) => cb(),
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval: () => {},
    CustomEvent: function(type, opts) { this.type = type; this.detail = opts ? opts.detail : null; },
    BroadcastChannel: function() { this.postMessage = () => {}; this.close = () => {}; }
  };
  const sandbox = {
    window: windowMock,
    document: documentMock,
    localStorage: localStorageMock,
    sessionStorage: localStorageMock,
    navigator: windowMock.navigator,
    location: windowMock.location,
    history: windowMock.history,
    CustomEvent: windowMock.CustomEvent,
    BroadcastChannel: windowMock.BroadcastChannel,
    console,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    Symbol,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    URIError,
    Intl,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval: () => {},
    requestAnimationFrame: (cb) => cb(),
    crypto: require('crypto').webcrypto,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer
  };
  windowMock.window = windowMock;
  sandbox.globalThis = windowMock;
  const appJsSrc = fs.readFileSync(path.join(rootDir, 'src/js/app.js'), 'utf8');
  vm.createContext(sandbox);
  vm.runInContext(appJsSrc, sandbox);
  return {
    app: windowMock.ScreenSyncApp,
    documentMock,
    windowMock,
    sandbox,
    rootDir
  };
}

async function runCategory04Tests(context = {}) {
  const rootDir = context.rootDir || path.resolve(__dirname, '..');
  const ueJava = fs.readFileSync(path.join(rootDir, 'android/app/src/main/java/io/screensync/wellness/UsageEventIngestionEngine.java'), 'utf8');
  const calcJava = fs.readFileSync(path.join(rootDir, 'android/app/src/main/java/io/screensync/wellness/ScreenTimeSessionCalculator.java'), 'utf8');
  const dbJava = fs.readFileSync(path.join(rootDir, 'android/app/src/main/java/io/screensync/wellness/AppUsageDatabaseHelper.java'), 'utf8');
  const schedJava = fs.readFileSync(path.join(rootDir, 'android/app/src/main/java/io/screensync/wellness/WellbeingRefreshScheduler.java'), 'utf8');
  const mainJava = fs.readFileSync(path.join(rootDir, 'android/app/src/main/java/io/screensync/wellness/MainActivity.java'), 'utf8');
  const iosSwift = fs.readFileSync(path.join(rootDir, 'ios/App/App/AppDelegate.swift'), 'utf8');
  const macSwift = fs.readFileSync(path.join(rootDir, 'platforms/macos/Sources/main.swift'), 'utf8');
  const winCs = fs.readFileSync(path.join(rootDir, 'platforms/windows/ScreenSyncWindowsCompanion.cs'), 'utf8');
  const mig001 = fs.readFileSync(path.join(rootDir, 'supabase/migrations/20261022000001_create_screensync_schema.sql'), 'utf8');
  const mig008 = fs.readFileSync(path.join(rootDir, 'supabase/migrations/20261022000008_category13_14_security_and_retention.sql'), 'utf8');
  const mig009 = fs.readFileSync(path.join(rootDir, 'supabase/migrations/20261022000009_v36_reports_widgets_and_deletion_audit.sql'), 'utf8');
  const appJs = fs.readFileSync(path.join(rootDir, 'src/js/app.js'), 'utf8');

  // -------------------------------------------------------------------------
  // 1. Static Native Java, iOS Swift, macOS CoreAudio, Windows & SQL Checks
  // -------------------------------------------------------------------------
  // D-3 / S04 Fix 6: UsageEventIngestionEngine never calls flushAllUsageTables() on permission failure
  assert(!ueJava.includes('dbHelper.flushAllUsageTables()'), 'Cat 04 Fix 6 (D-3): UsageEventIngestionEngine.java must never call flushAllUsageTables() when permission check returns false');
  assert(ueJava.includes('EVENT_END_OF_DAY') && ueJava.includes('EVENT_CONTINUE_PREVIOUS_DAY'), 'C4-D05: UsageEventIngestionEngine.java TRACKED_EVENT_TYPES must include EVENT_END_OF_DAY and EVENT_CONTINUE_PREVIOUS_DAY');

  // C4-D05 & CAT04-15: AppUsageDatabaseHelper.java pruneOlderThan column fix & unique tuple index
  assert(!dbJava.includes('start_time < ?') && dbJava.includes('"timestamp < ?"'), 'C4-D05: AppUsageDatabaseHelper.pruneOlderThan must use "timestamp < ?" (never nonexistent start_time)');
  assert(dbJava.includes('idx_events_unique_tuple') && dbJava.includes('SQLiteDatabase.CONFLICT_IGNORE'), 'CAT04-15 / C4-D05: AppUsageDatabaseHelper.java must enforce idx_events_unique_tuple with CONFLICT_IGNORE');

  // C4-D04 & CAT04-06: ScreenTimeSessionCalculator.java interval union & MainActivity.java wiring
  assert(calcJava.includes('mergeIntervalsMs') && calcJava.includes('deviceClippedIntervalsMs'), 'C4-D04 / CAT04-06: ScreenTimeSessionCalculator.java must merge overlapping intervals via mergeIntervalsMs so split-screen/PiP never exceeds 60m/hr');
  assert(mainJava.includes('sessionCalculator.calculateDailyReport('), 'C4-D04: MainActivity.java must wire sessionCalculator.calculateDailyReport');
  assert(mainJava.includes('getHistoricalUsageBackfillJson(int daysBack)'), 'C4-D14: MainActivity.java must expose getHistoricalUsageBackfillJson alias');
  assert(mainJava.includes('st.getFirstTimeStamp() < dayStartMs - 43200000L'), 'C4-D15c: MainActivity.java must guard against prior-day INTERVAL_DAILY buckets bleeding into dayStartMs');

  // CAT04-18: WellbeingRefreshScheduler periodic job scheduled
  assert(schedJava.includes('class WellbeingPeriodicJobService extends JobService') && mainJava.includes('WellbeingRefreshScheduler.schedulePeriodicSyncJobs'), 'CAT04-18: WellbeingRefreshScheduler periodic job must be implemented and scheduled in MainActivity.onCreate');

  // CAT04-04 & C4-D14: iOS AppDelegate.swift honest UNSUPPORTED_ON_IOS response & alias
  assert(iosSwift.includes('UNSUPPORTED_ON_IOS') && iosSwift.includes('getHistoricalUsageBackfillJson'), 'CAT04-04 / C4-D14: AppDelegate.swift must return honest UNSUPPORTED_ON_IOS status and expose getHistoricalUsageBackfillJson');

  // C4-D07 & CAT04-17: macOS CoreAudio output detection & Windows 300s idle threshold alignment
  assert(macSwift.includes('import CoreAudio') && macSwift.includes('kAudioDevicePropertyDeviceIsRunningSomewhere') && macSwift.includes('isMacAudioOutputRunning'), 'C4-D07: platforms/macos/Sources/main.swift must query CoreAudio output device state');
  assert(winCs.includes('idleSecs <= 300.0'), 'CAT04-17: ScreenSyncWindowsCompanion.cs must align _dailyAppUsageSeconds idle gate with 300s IDLE_THRESHOLD_SECONDS');

  // C04-ISS-03 & C4-D03: Supabase SQL RPC sub_intervals expansion & Migrations 008/009 table names
  assert(mig001.includes('jsonb_array_elements(s.sub_intervals)') && mig001.includes('dev_raw_intervals'), 'C04-ISS-03 / C4-D03: get_account_daily_aggregates in Migration 001 must expand sub_intervals and compute per-device interval union');
  assert(!mig008.includes('public.screen_sessions') && !mig008.includes('public.reel_events') && mig008.includes('public.screen_usage_sessions') && mig008.includes('public.website_usage_sessions'), 'C04-ISS-03: Migration 008 must use canonical table names');
  assert(!mig009.includes('public.screen_sessions') && !mig009.includes('public.reel_events') && mig009.includes('public.screen_usage_sessions') && mig009.includes('public.website_usage_sessions'), 'C04-ISS-03: Migration 009 must use canonical table names');

  // -------------------------------------------------------------------------
  // 2. Behavioral JS Runtime Tests (Features 4.1–4.6)
  // -------------------------------------------------------------------------
  const runtimeCtx = (context && context.app) ? context : createStandaloneAppContext(rootDir);
  const { app } = runtimeCtx;
  assert(app && app.ScreenTimeAggregator && app.ChartAggregator && app.CrossPlatformIdleAndSessionTracker, 'Category 04 runtime engines must be initialized');

  const sta = app.ScreenTimeAggregator;
  const idleTracker = app.CrossPlatformIdleAndSessionTracker;
  const nativeSvc = app.NativeUsageIntegrationService;

  // Save current state to restore cleanly after tests
  const savedUser = app.state.currentUser ? { ...app.state.currentUser } : null;
  const savedIsAuth = app.state.isAuthenticated;
  const savedDeviceScope = app.state.selectedDevice;
  const savedPeriodMode = app.state.periodMode;
  const savedOffsets = { ...app.state.offsets };

  try {
    // -----------------------------------------------------------------------
    // 2.1 Feature 4.1: computeUnionMinutes, paused/background/isBackgroundAudio exclusions & reconcileLegacyMinutes (C4-D01, C4-D02, C4-D06, S04 Fix 5)
    // -----------------------------------------------------------------------
    assert.strictEqual(typeof sta.computeUnionMinutes, 'function', 'C4-D01: ScreenTimeAggregator.computeUnionMinutes must be a function');
    assert.strictEqual(typeof app.ChartAggregator.computeUnionMinutes, 'function', 'C4-D01: ChartAggregator.computeUnionMinutes must be exposed');
    assert.strictEqual(typeof sta.reconcileLegacyMinutes, 'function', 'S04 Fix 5: ScreenTimeAggregator.reconcileLegacyMinutes must be a function');
    assert.strictEqual(typeof sta.reconcileUntimestampedExcessPerDevice, 'function', 'C4-D02: ScreenTimeAggregator.reconcileUntimestampedExcessPerDevice must be a function');

    // Overlapping + adjacent intervals across 2 devices: [1000, 2800] (30m) and [1900, 3700] (30m) -> union [1000, 3700] = 45m
    const unionRes1 = sta.computeUnionMinutes([
      { installationKey: 'iphone_16', appKey: 'instagram', startEpochSec: 1000, endEpochSec: 2800 },
      { installationKey: 's24_ultra', appKey: 'youtube', startEpochSec: 1900, endEpochSec: 3700 },
      { installationKey: 'windows_pc', appKey: 'spotify', startEpochSec: 1000, endEpochSec: 5000, isBackgroundAudio: true },
      { installationKey: 'macbook_pro', appKey: 'music', startEpochSec: 1000, endEpochSec: 5000, state: 'BACKGROUND_AUDIO' }
    ]);
    assert.strictEqual(unionRes1.totalMinutes, 45, '4.1 / C4-D06: computeUnionMinutes must union overlapping intervals (45m) and exclude isBackgroundAudio / BACKGROUND_AUDIO records');
    assert.strictEqual(+unionRes1, 45, '4.1: computeUnionMinutes return value must coerce to numeric totalMinutes (45)');
    assert.strictEqual(sta.computeUnionMinutes([[0, 1800], [1800, 3600]], { returnNumber: true }), 60, '4.1: Adjacent intervals [0,1800] and [1800,3600] must merge into 60m');

    // Paused sub-interval subtraction inside computeUnionMinutes
    const unionPaused = sta.computeUnionMinutes([
      {
        installationKey: 's24_ultra',
        appKey: 'instagram',
        localDate: '2026-10-14',
        startEpochSec: 10000,
        endEpochSec: 13600, // 60m outer
        pausedIntervals: [[10600, 11800]] // 20m paused
      }
    ]);
    assert.strictEqual(unionPaused.totalMinutes, 40, '4.1: computeUnionMinutes must subtract pausedIntervals (60m - 20m = 40m)');

    // S04 Fix 5 / Acceptance 6(a): One installation with 60m timestamped + 60m aggregate record for same app/day -> per-app total = 60 (not 120), account total = 60
    const testUid = 'usr_cat04_test_01';
    app.state.isAuthenticated = true;
    app.state.currentUser = { userId: testUid, email: 'cat04@screensync.io', name: 'Cat04 Tester', verified: true };
    app.BackendDB.ensureUserStructures(testUid);
    app.BackendDB.data.installationsByUser[testUid] = [
      { installationId: 'inst_c4_and', key: 's24_ultra', userId: testUid, name: 'Galaxy S24 Ultra', osCategory: 'Android', deviceCategory: 'Phone', trackingPermitted: true },
      { installationId: 'inst_c4_ios', key: 'iphone_16', userId: testUid, name: 'iPhone 16 Pro', osCategory: 'iOS', deviceCategory: 'Phone', trackingPermitted: true },
      { installationId: 'inst_c4_win', key: 'windows_pc', userId: testUid, name: 'Windows PC', osCategory: 'Windows', deviceCategory: 'Laptop', trackingPermitted: true }
    ];

    const oct14Str = '2026-10-14';
    const oct14StartSec = app.LocalTime.utcWallDayStartSec(oct14Str, 0);
    app.BackendDB.data.sessionsByUser[testUid] = [
      {
        sessionId: 'c4_ts_ig_60',
        userId: testUid,
        installationKey: 's24_ultra',
        installationId: 'inst_c4_and',
        osCategory: 'Android',
        appKey: 'instagram',
        appName: 'Instagram',
        localDate: oct14Str,
        hasTimestamps: true,
        startEpochSec: oct14StartSec + 36000,
        endEpochSec: oct14StartSec + 39600,
        durationMinutes: 60,
        unlocks: 5,
        metricProvenance: 'measured'
      },
      {
        sessionId: 'c4_agg_ig_60',
        userId: testUid,
        installationKey: 's24_ultra',
        installationId: 'inst_c4_and',
        osCategory: 'Android',
        appKey: 'instagram',
        appName: 'Instagram',
        localDate: oct14Str,
        hasTimestamps: false,
        durationMinutes: 60,
        aggregateOnly: true
      }
    ];
    const snapSameDevMix = app.computeSnapshot('ALL', 'DAY', 0, { referenceDate: oct14Str, userId: testUid });
    const igAppMix = snapSameDevMix.apps.find(a => a.key === 'instagram');
    assert.strictEqual(snapSameDevMix.totalScreenMinutes, 60, `S04 Fix 5 / C04-ISS-02: Account total for 60m timestamped + 60m aggregate on same installation must be 60m (got ${snapSameDevMix.totalScreenMinutes})`);
    assert(igAppMix && igAppMix.minutes === 60, `S04 Fix 5 / C04-ISS-02: Per-app total for 60m timestamped + 60m aggregate on same installation must be 60m, not 120m (got ${igAppMix && igAppMix.minutes})`);

    // S04 Fix 5 / Acceptance 6(b): Two aggregate-only devices with disjoint 45m each via reconcileLegacyMinutes & calculateAccountScreenTime
    const reconciledDisjoint = sta.reconcileLegacyMinutes({
      timestampedByInstallation: {},
      legacyByInstallation: { s24_ultra: 45, iphone_16: 45 }
    });
    assert.strictEqual(reconciledDisjoint, 90, 'S04 Fix 5: reconcileLegacyMinutes must return 90m for two aggregate-only installations with 45m each');
    const calcDisjoint = sta.calculateAccountScreenTime([
      { installationKey: 's24_ultra', appKey: 'instagram', localDate: oct14Str, hasTimestamps: false, durationMinutes: 45 },
      { installationKey: 'iphone_16', appKey: 'youtube', localDate: oct14Str, hasTimestamps: false, durationMinutes: 45 }
    ], { sumDisjointLegacyDevices: true });
    assert.strictEqual(calcDisjoint.totalMinutes, 90, 'S04 Fix 5: calculateAccountScreenTime with sumDisjointLegacyDevices must return 90m');

    // CAT04-08: Aggregate DAY hourly bars (two apps x 30m in hour 10 -> 60m bar; 90m record with clipAggregateDayBuckets -> 60m bar + 30m unattributed)
    app.BackendDB.data.sessionsByUser[testUid] = [
      {
        sessionId: 'c4_agg_h10_ig',
        userId: testUid,
        installationKey: 's24_ultra',
        osCategory: 'Android',
        appKey: 'instagram',
        localDate: oct14Str,
        hasTimestamps: false,
        hour: 10,
        durationMinutes: 30
      },
      {
        sessionId: 'c4_agg_h10_yt',
        userId: testUid,
        installationKey: 's24_ultra',
        osCategory: 'Android',
        appKey: 'youtube',
        localDate: oct14Str,
        hasTimestamps: false,
        hour: 10,
        durationMinutes: 30
      },
      {
        sessionId: 'c4_agg_h14_90m',
        userId: testUid,
        installationKey: 's24_ultra',
        osCategory: 'Android',
        appKey: 'tiktok',
        localDate: oct14Str,
        hasTimestamps: false,
        hour: 14,
        durationMinutes: 90
      },
      {
        sessionId: 'c4_agg_no_hour_15m',
        userId: testUid,
        installationKey: 's24_ultra',
        osCategory: 'Android',
        appKey: 'whatsapp',
        localDate: oct14Str,
        hasTimestamps: false,
        durationMinutes: 15
      }
    ];
    const snapClippedAgg = app.computeSnapshot('ALL', 'DAY', 0, {
      referenceDate: oct14Str,
      userId: testUid,
      clipAggregateDayBuckets: true
    });
    assert.strictEqual(snapClippedAgg.bars[10], 60, 'CAT04-08: Two apps with 30m aggregate records in hour 10 must sum to 60m (never collapse to 30m)');
    assert.strictEqual(snapClippedAgg.bars[14], 60, 'CAT04-08: 90m aggregate record with clipAggregateDayBuckets must cap hour-14 bar at 60m');
    assert.strictEqual(snapClippedAgg.bars[12], 0, 'CAT04-08: Hour-less aggregate record must never fabricate hour 12');
    assert.strictEqual(snapClippedAgg.unattributedAggregateMinutes, 45, 'CAT04-08: 30m overflow from hour 14 + 15m hour-less record must equal 45m unattributedAggregateMinutes');

    // -----------------------------------------------------------------------
    // 2.2 Feature 4.4: Calendar Week (Mon..Sun), Calendar Month (28/29/30/31), DST 23h/25h Days & Reference Date (CAT04-05, CAT04-13, CAT04-14, S04 Fix 6)
    // -----------------------------------------------------------------------
    // S04 Fix 6 / Acceptance 8: With referenceDate Wednesday 2026-10-14 and calendarWeek: true, WEEK yields Mon 2026-10-12 .. Sun 2026-10-18 with Oct 14 at index 2
    const wkCalSnap = app.computeSnapshot('ALL', 'WEEK', 0, {
      referenceDate: '2026-10-14',
      userId: testUid,
      calendarWeek: true
    });
    assert.strictEqual(wkCalSnap.bucketMeta.length, 7, 'S04 Fix 6: WEEK must have 7 buckets');
    assert.strictEqual(wkCalSnap.bucketMeta[0].dateStr, '2026-10-12', 'S04 Fix 6: Calendar WEEK starting Monday must begin on 2026-10-12');
    assert.strictEqual(wkCalSnap.bucketMeta[2].dateStr, '2026-10-14', 'S04 Fix 6: Wednesday 2026-10-14 must be at index 2 in Mon..Sun calendar week');
    assert.strictEqual(wkCalSnap.bucketMeta[6].dateStr, '2026-10-18', 'S04 Fix 6: Calendar WEEK must end on Sunday 2026-10-18');
    assert.strictEqual(wkCalSnap.bars[2], 165, 'S04 Fix 6: Oct 14 total (165m) must appear at bucket index 2');

    // Calendar MONTH bucket counts: Oct 2026 (31), Feb 2026 (28), Feb 2028 leap year (29), and offset -1 from Jan 2027 -> Dec 2026 (31)
    const moOct26 = app.computeSnapshot('ALL', 'MONTH', 0, { referenceDate: '2026-10-14', userId: testUid, calendarMonth: true });
    const moFeb26 = app.computeSnapshot('ALL', 'MONTH', 0, { referenceDate: '2026-02-15', userId: testUid, calendarMonth: true });
    const moFeb28 = app.computeSnapshot('ALL', 'MONTH', 0, { referenceDate: '2028-02-15', userId: testUid, calendarMonth: true });
    const moDec26FromJan27 = app.computeSnapshot('ALL', 'MONTH', -1, { referenceDate: '2027-01-10', userId: testUid, calendarMonth: true });
    assert.strictEqual(moOct26.bars.length, 31, 'S04 Fix 6: October 2026 calendar month must have 31 buckets');
    assert.strictEqual(moFeb26.bars.length, 28, 'S04 Fix 6: February 2026 calendar month must have 28 buckets');
    assert.strictEqual(moFeb28.bars.length, 29, 'S04 Fix 6: February 2028 leap-year calendar month must have 29 buckets');
    assert.strictEqual(moDec26FromJan27.bars.length, 31, 'S04 Fix 6: Offset -1 from Jan 2027 must yield 31 buckets for Dec 2026');
    assert.strictEqual(moDec26FromJan27.bucketMeta[0].dateStr, '2026-12-01', 'S04 Fix 6: Dec 2026 first bucket must be 2026-12-01');

    // DST 23-hour spring-forward day (2026-03-08 in America/New_York) & 25-hour fall-back day (2026-11-01 in America/New_York) (CAT04-05)
    const dstSpringBounds = sta.getLocalDayWindowBoundsMs('2026-03-08', 'America/New_York');
    const dstFallBounds = sta.getLocalDayWindowBoundsMs('2026-11-01', 'America/New_York');
    assert.strictEqual(dstSpringBounds.dayDurationHours, 23, 'CAT04-05: 2026-03-08 in America/New_York must be a 23-hour DST spring-forward day');
    assert.strictEqual(dstFallBounds.dayDurationHours, 25, 'CAT04-05: 2026-11-01 in America/New_York must be a 25-hour DST fall-back day');

    // Session 01:30 EST to 03:30 EDT on 2026-03-08 (spanning the 02:00 -> 03:00 spring-forward jump: only 60 real minutes elapsed!)
    const springStartMs = dstSpringBounds.windowStartMs + 1.5 * 3600000; // 01:30 EST
    const springEndMs = springStartMs + 3600000; // +1 real hour = 03:30 EDT
    const springRep = sta.reconstructSessionsFromRawEvents([
      { eventType: 15, timestampMs: springStartMs - 1000 },
      { packageName: 'com.instagram.android', className: 'MainActivity', eventType: 1, timestampMs: springStartMs },
      { packageName: 'com.instagram.android', className: 'MainActivity', eventType: 2, timestampMs: springEndMs }
    ], {
      targetDate: '2026-03-08',
      timeZone: 'America/New_York',
      evaluationTimeMs: springEndMs + 10000
    });
    assert.strictEqual(springRep.totalDeviceScreenMinutes, 60, 'CAT04-05: 01:30 EST to 03:30 EDT across spring-forward jump must equal 60 real minutes (not 120m)');
    assert.strictEqual(springRep.hourlyScreenTimeMs[1], 1800000, 'CAT04-05: Hour 1 (01:00-02:00 EST) must receive 30m (1,800,000 ms)');
    assert.strictEqual(springRep.hourlyScreenTimeMs[2], 0, 'CAT04-05: Nonexistent skipped hour 2 (02:00-03:00) on spring-forward day must receive 0 ms');
    assert.strictEqual(springRep.hourlyScreenTimeMs[3], 1800000, 'CAT04-05: Hour 3 (03:00-04:00 EDT) must receive 30m (1,800,000 ms)');

    // CAT04-14: resolveUserReferenceDate for real user with data on 2026-10-16 returns real today, not 2026-10-16
    app.BackendDB.data.sessionsByUser[testUid] = [
      {
        sessionId: 'real_user_oct16_sess',
        userId: testUid,
        installationKey: 's24_ultra',
        osCategory: 'Android',
        appKey: 'instagram',
        localDate: '2026-10-16',
        hasTimestamps: false,
        durationMinutes: 25,
        isRealUserSession: true
      }
    ];
    const resolvedRefForRealUser = app.resolveUserReferenceDate(testUid);
    assert.strictEqual(resolvedRefForRealUser, app.getTodayLocalDateStr(), 'CAT04-14: Real user with latest session on 2026-10-16 must resolve reference date to real today');

    // -----------------------------------------------------------------------
    // 2.3 Feature 4.5: 30-Day Backfill Unlocks, Re-Ingestion Idempotency, Unknown Unlocks & iOS Honesty (CAT04-03, CAT04-04, CAT04-11, S04 Fix 5)
    // -----------------------------------------------------------------------
    app.BackendDB.data.sessionsByUser[testUid] = [];
    if (app.BackendDB.data.unlockBucketsByUser) delete app.BackendDB.data.unlockBucketsByUser[testUid];

    // S04 Fix 5 / Acceptance 7: Ingest a native day report (50 unlocks) three times with growing screen time (20m -> 40m -> 60m)
    const hourly50 = new Array(24).fill(0);
    hourly50[9] = 20;
    hourly50[14] = 30;
    for (const minsStep of [20, 40, 60]) {
      nativeSvc.ingestNativeUsageReport({
        ok: true,
        userId: testUid,
        installationKey: 's24_ultra',
        installationId: 'inst_c4_and',
        osCategory: 'Android',
        localDate: oct14Str,
        aggregateOnly: true,
        unlocks: 50,
        hourlyUnlocks: hourly50,
        entries: [
          { packageId: 'com.instagram.android', appName: 'Instagram', durationMinutes: minsStep, opens: 3, notifs: 2 }
        ]
      });
    }
    const snapAfter3Polls = app.computeSnapshot('s24_ultra', 'DAY', 0, { referenceDate: oct14Str, userId: testUid });
    assert.strictEqual(snapAfter3Polls.totalScreenMinutes, 60, 'S04 Fix 5: Growing native report (20->40->60m) must reconcile to 60m');
    assert.strictEqual(snapAfter3Polls.unlocks, 50, `S04 Fix 5: Ingesting 50 unlocks 3 times with growing screen time must show 50 unlocks (not 100/150), got ${snapAfter3Polls.unlocks}`);
    assert.strictEqual(snapAfter3Polls.unlockBars.reduce((a, b) => a + b, 0), 50, 'S04 Fix 5: DAY hourly unlockBars must sum to 50 without multiplying across re-ingestions');

    // Companion RESUME_UNLOCK appends 1 unlock for its installation
    idleTracker.pauseOnLockOrSuspend(testUid, 'windows_pc', oct14StartSec * 1000 + 3600000);
    idleTracker.resumeOnUnlockOrWake('windows_pc', oct14StartSec * 1000 + 3660000, testUid);
    const snapWinUnlock = app.computeSnapshot('windows_pc', 'DAY', 0, { referenceDate: oct14Str, userId: testUid });
    assert.strictEqual(snapWinUnlock.unlocks, 1, 'S04 Fix 5: Companion resumeOnUnlockOrWake must record 1 unlock in unlockBucketsByUser');

    // Backfill day with unknown unlocks (unlocks: null / unlocksKnown: false, e.g., days 8–30 beyond raw-event retention) -> renders "Not reported by this device"
    const oldDayStr = '2026-09-25';
    nativeSvc.ingestNativeUsageReport({
      ok: true,
      userId: testUid,
      installationKey: 's24_ultra',
      installationId: 'inst_c4_and',
      osCategory: 'Android',
      localDate: oldDayStr,
      aggregateOnly: true,
      unlocks: null,
      unlocksKnown: false,
      entries: [
        { packageId: 'com.instagram.android', appName: 'Instagram', durationMinutes: 35 }
      ]
    });
    const snapOldDay = app.computeSnapshot('s24_ultra', 'DAY', 0, { referenceDate: oldDayStr, userId: testUid });
    assert.strictEqual(snapOldDay.unlocks, null, 'CAT04-03 / CAT04-10: Backfilled day with unknown unlocks must have unlocks === null (not 0)');
    assert(String(snapOldDay.unlocksSub).startsWith('Not reported by this device'), `CAT04-03: Unknown unlocks must show 'Not reported by this device', got '${snapOldDay.unlocksSub}'`);

    // CAT04-04 & CAT04-11: iOS backfill UNSUPPORTED_ON_IOS state & non-retry persistence
    const prevBridge = runtimeCtx.windowMock ? runtimeCtx.windowMock.ScreenSyncNativeBridge : null;
    if (runtimeCtx.windowMock) {
      let iosCalls = 0;
      runtimeCtx.windowMock.ScreenSyncNativeBridge = {
        getHistoricalUsageBackfillJson: () => {
          iosCalls += 1;
          return JSON.stringify({ ok: false, status: 'UNSUPPORTED_ON_IOS', osCategory: 'iOS', days: [] });
        }
      };
      const iosRes1 = nativeSvc.runHistoricalUsageBackfill(30, {
        userId: testUid,
        installationKey: 'iphone_16',
        installationId: 'inst_c4_ios',
        osCategory: 'iOS',
        force: true
      });
      const iosRes2 = nativeSvc.runHistoricalUsageBackfill(30, {
        userId: testUid,
        installationKey: 'iphone_16',
        installationId: 'inst_c4_ios',
        osCategory: 'iOS'
      });
      assert.strictEqual(iosRes1.status, 'UNSUPPORTED_ON_IOS', 'CAT04-04: iOS backfill must return UNSUPPORTED_ON_IOS');
      assert.strictEqual(iosRes2.skipped, true, 'CAT04-04 / CAT04-11: Subsequent iOS backfill call must be skipped without retrying bridge');
      assert.strictEqual(iosCalls, 1, 'CAT04-11: iOS bridge must be called only once');
      if (prevBridge) runtimeCtx.windowMock.ScreenSyncNativeBridge = prevBridge;
      else delete runtimeCtx.windowMock.ScreenSyncNativeBridge;
    }

    // -----------------------------------------------------------------------
    // 2.4 Feature 4.2, 4.3 & 4.6: Live Session Memo Cache Invalidation, Cross-Midnight Guard & Idle/Focus Fixes (CAT04-01, CAT04-12, C4-D08..C4-D11, C4-D16)
    // -----------------------------------------------------------------------
    app.BackendDB.data.sessionsByUser[testUid] = [];
    const todayLocalStr = app.getTodayLocalDateStr();
    const nowDt = new Date();
    const todayMidnightMs = new Date(nowDt.getFullYear(), nowDt.getMonth(), nowDt.getDate(), 0, 0, 0, 0).getTime();
    const liveBaseMs = todayMidnightMs + 10 * 3600000; // 10:00 AM local today

    app.TimeContext.setClockForTests(liveBaseMs + 60000); // +1m
    idleTracker.trackersByInstallation['windows_pc'] = {
      installationKey: 'windows_pc',
      state: 'ACTIVE',
      activeTimeSeconds: 60,
      sessionDateKey: todayLocalStr,
      segmentStartMs: liveBaseMs,
      segmentAccumulatedSeconds: 60,
      continuousSessionStartMs: liveBaseMs,
      continuousSessionSeconds: 60,
      sessionCount: 1,
      lastTickMs: liveBaseMs + 60000,
      lastSavedMs: liveBaseMs,
      currentAppSession: {
        appKey: 'code',
        appName: 'Visual Studio Code',
        osCategory: 'Windows',
        startMs: liveBaseMs,
        endMs: liveBaseMs + 60000
      },
      isAppAway: false
    };
    const liveSnap1 = app.computeSnapshot('windows_pc', 'DAY', 0, { referenceDate: todayLocalStr, userId: testUid });
    assert.strictEqual(liveSnap1.totalScreenMinutes, 1, 'CAT04-01 / C4-D16: Live session at +1m must report 1m in DAY snapshot');

    // Advance test clock to +4m without persisting anything to BackendDB -> memo cache must invalidate and report 4m!
    app.TimeContext.setClockForTests(liveBaseMs + 240000); // +4m
    idleTracker.trackersByInstallation['windows_pc'].currentAppSession.endMs = liveBaseMs + 240000;
    const liveSnap2 = app.computeSnapshot('windows_pc', 'DAY', 0, { referenceDate: todayLocalStr, userId: testUid });
    const liveWeekSnap = app.computeSnapshot('windows_pc', 'WEEK', 0, { referenceDate: todayLocalStr, userId: testUid });
    assert.strictEqual(liveSnap2.totalScreenMinutes, 4, 'CAT04-01 / C4-D16: Advancing live session to +4m must invalidate _snapshotMemoCache and report 4m');
    assert.strictEqual(liveWeekSnap.totalScreenMinutes, 4, 'C4-D16: Current WEEK (offset === 0) snapshot must also fold live session (+4m)');

    // Cross-midnight live session: started 23:00 yesterday, still running at 01:00 today -> contributes 60m to today (CAT04-12)
    const yest23Ms = todayMidnightMs - 3600000; // 23:00 local yesterday
    const today01Ms = todayMidnightMs + 3600000; // 01:00 local today
    app.TimeContext.setClockForTests(today01Ms);
    idleTracker.trackersByInstallation['windows_pc'].currentAppSession = {
      appKey: 'code',
      appName: 'Visual Studio Code',
      osCategory: 'Windows',
      startMs: yest23Ms,
      endMs: today01Ms
    };
    const crossMidLiveSnap = app.computeSnapshot('windows_pc', 'DAY', 0, { referenceDate: todayLocalStr, userId: testUid });
    assert.strictEqual(crossMidLiveSnap.totalScreenMinutes, 60, 'CAT04-12: Live session started 23:00 yesterday and running at 01:00 today must contribute 60m post-midnight to today');
    idleTracker.trackersByInstallation['windows_pc'].currentAppSession = null;
    app.TimeContext.setClockForTests(null);

    // C4-D11: Same-app pause > 2s in calculateAppFocusMetrics must NOT increment contextSwitchCount
    const sameAppMetrics = idleTracker.calculateAppFocusMetrics([
      { installationKey: 'windows_pc', appKey: 'code', startEpochSec: 1000, endEpochSec: 1600 },
      { installationKey: 'windows_pc', appKey: 'code', startEpochSec: 1700, endEpochSec: 2300 } // 100s pause in same app
    ]);
    assert.strictEqual(sameAppMetrics.stretchesCount, 2, 'C4-D11: 100s pause in same app must produce 2 stretches');
    assert.strictEqual(sameAppMetrics.contextSwitchCount, 0, 'C4-D11: Same-app pause > 2s must result in contextSwitchCount === 0 (never count as an app switch)');

    // CAT04-19: Cross-device session download with colliding raw session_id on different installations keeps both
    app.BackendDB.data.sessionsByUser[testUid] = [];
    app.SupabaseSyncEngine.mergeRemoteRecordsIntoLocal(testUid, {
      sessions: [
        {
          user_id: testUid,
          installation_id: 'inst_c4_and',
          installation_key: 's24_ultra',
          session_id: 'shared_raw_sid_01',
          os_category: 'Android',
          app_key: 'instagram',
          app_name: 'Instagram',
          local_date: oct14Str,
          has_timestamps: true,
          start_epoch_sec: oct14StartSec + 3600,
          end_epoch_sec: oct14StartSec + 5400,
          duration_minutes: 30
        },
        {
          user_id: testUid,
          installation_id: 'inst_c4_ios',
          installation_key: 'iphone_16',
          session_id: 'shared_raw_sid_01',
          os_category: 'iOS',
          app_key: 'youtube',
          app_name: 'YouTube',
          local_date: oct14Str,
          has_timestamps: true,
          start_epoch_sec: oct14StartSec + 7200,
          end_epoch_sec: oct14StartSec + 9000,
          duration_minutes: 30
        }
      ]
    });
    assert.strictEqual(app.BackendDB.data.sessionsByUser[testUid].length, 2, 'CAT04-19: Colliding raw session_id across different installations must preserve both sessions');

    // =========================================================================
    // PART 04B DELTA FINDINGS VERIFICATION (DF-04B-01 .. DF-04B-10)
    // =========================================================================
    // DF-04B-01: Per-app byOs, osMap.apps, and weekBars interval union across same-OS devices + ScreenTimeAggregator aliases
    assert.strictEqual(typeof sta.computeUnionReport, 'function', 'DF-04B-01: ScreenTimeAggregator.computeUnionReport must be exposed');
    assert.strictEqual(typeof sta.combineTodayWithLiveSession, 'function', 'DF-04B-01: ScreenTimeAggregator.combineTodayWithLiveSession must be exposed');
    assert.strictEqual(typeof app.ChartAggregator.mergeIntervals, 'function', 'DF-04B-01: ChartAggregator.mergeIntervals must be exposed');
    assert.strictEqual(typeof app.ChartAggregator.calculateAccountScreenTime, 'function', 'DF-04B-01: ChartAggregator.calculateAccountScreenTime must be exposed');
    app.BackendDB.data.installationsByUser[testUid].push({
      userId: testUid,
      installationId: 'inst_c4_and2',
      key: 'vivo_v29',
      deviceName: 'Vivo V29',
      osCategory: 'Android',
      deviceCategory: 'Phone',
      trackingPermitted: true
    });
    app.BackendDB.data.sessionsByUser[testUid] = [
      {
        sessionId: 'same_os_overlap_and1',
        userId: testUid,
        installationId: 'inst_c4_and',
        installationKey: 's24_ultra',
        osCategory: 'Android',
        appKey: 'instagram',
        appName: 'Instagram',
        localDate: oct14Str,
        hasTimestamps: true,
        startEpochSec: oct14StartSec + 36000, // 10:00
        endEpochSec: oct14StartSec + 37800,   // 10:30 (30m)
        durationMinutes: 30
      },
      {
        sessionId: 'same_os_overlap_and2',
        userId: testUid,
        installationId: 'inst_c4_and2',
        installationKey: 'vivo_v29',
        osCategory: 'Android',
        appKey: 'instagram',
        appName: 'Instagram',
        localDate: oct14Str,
        hasTimestamps: true,
        startEpochSec: oct14StartSec + 36000, // 10:00
        endEpochSec: oct14StartSec + 37800,   // 10:30 (30m simultaneous overlap on 2nd Android phone)
        durationMinutes: 30
      }
    ];
    const snapSameOsOverlap = app.computeSnapshot('ALL', 'WEEK', 0, { referenceDate: oct14Str, userId: testUid });
    const igOverlapObj = snapSameOsOverlap.apps.find(a => a.key === 'instagram');
    assert(igOverlapObj, 'DF-04B-01: Instagram app entry must exist in WEEK snapshot');
    assert.strictEqual(igOverlapObj.minutes, 30, 'DF-04B-01: Instagram union minutes across two overlapping Android devices must be 30m');
    assert.strictEqual(igOverlapObj.byOs.Android, 30, 'DF-04B-01 / C4-D03: appObj.byOs.Android must union overlapping same-OS intervals (30m, never 60m)');
    assert.strictEqual(snapSameOsOverlap.osBreakdown.Android.apps.instagram, 30, 'DF-04B-01 / C4-D03: osBreakdown.Android.apps.instagram must union overlapping same-OS intervals (30m)');
    assert.strictEqual(igOverlapObj.weekBars[6], 30, 'DF-04B-01 / C4-D03: appObj.weekBars[6] must union overlapping intervals on that day (30m, never 60m)');

    // DF-04B-02: Checkpoint stretch coalescing in _commitAppSessionSegment within JOIN_TOLERANCE_SECONDS (2s)
    app.BackendDB.data.sessionsByUser[testUid] = [];
    const coalStartMs = (oct14StartSec + 50000) * 1000;
    const coalRes1 = idleTracker._commitAppSessionSegment(testUid, 'windows_pc', {
      appKey: 'code',
      appName: 'Visual Studio Code',
      startMs: coalStartMs
    }, coalStartMs + 300000); // 5m checkpoint 1
    const coalRes2 = idleTracker._commitAppSessionSegment(testUid, 'windows_pc', {
      appKey: 'code',
      appName: 'Visual Studio Code',
      startMs: coalStartMs + 300000
    }, coalStartMs + 600000); // 5m checkpoint 2 (contiguous within 0s <= 2s)
    assert.strictEqual(coalRes2.coalesced, true, 'DF-04B-02 / CAT04-03: Contiguous 5-minute checkpoint must coalesce into existing dwpc_seg_ record');
    assert.strictEqual(app.BackendDB.data.sessionsByUser[testUid].length, 1, 'DF-04B-02: Coalesced checkpoints must remain a single row in BackendDB.data.sessionsByUser');
    assert.strictEqual(app.BackendDB.data.sessionsByUser[testUid][0].durationMinutes, 10, 'DF-04B-02: Coalesced 2x5m checkpoints must report 10m total duration');

    // DF-04B-03: Stale live session MAX_TICK_GAP_SECONDS clamp & duplicate activeSession/currentAppSession dedup
    app.BackendDB.data.sessionsByUser[testUid] = [];
    const staleBaseMs = todayMidnightMs + 10 * 3600000; // 10:00 local today
    const staleQueryNowMs = staleBaseMs + 3 * 3600000;  // 13:00 local today (3 hours after last verified tick)
    app.TimeContext.setClockForTests(staleQueryNowMs);
    idleTracker.trackersByInstallation['windows_pc'] = {
      installationKey: 'windows_pc',
      state: 'ACTIVE',
      isAppAway: false,
      currentAppSession: {
        appKey: 'code',
        appName: 'Visual Studio Code',
        osCategory: 'Windows',
        startMs: staleBaseMs,
        endMs: staleBaseMs + 60000 // verified for only 1m before companion disconnected 3h ago
      }
    };
    idleTracker.activeSession = {
      installationKey: 'windows_pc',
      osCategory: 'Windows',
      appKey: 'code',
      appName: 'Visual Studio Code',
      startMs: staleBaseMs,
      endMs: staleBaseMs + 60000
    };
    const staleClampedSnap = app.computeSnapshot('windows_pc', 'DAY', 0, { referenceDate: todayLocalStr, userId: testUid });
    assert.strictEqual(staleClampedSnap.totalScreenMinutes, 1, 'DF-04B-03 / CAT04-BUG-08: Stale live session with endMs 3h behind nowMs (>60s MAX_TICK_GAP_SECONDS) must clamp to 1m (never stretch to 180m)');
    assert.strictEqual(staleClampedSnap.cumulativeScreenMinutes, 1, 'DF-04B-03 / C04-10: Duplicate activeSession and currentAppSession for same installation+app must not double-count cumulativeScreenMinutes');
    idleTracker.activeSession = null;
    idleTracker.trackersByInstallation['windows_pc'].currentAppSession = null;

    // DF-04B-04: TimeContext & LocalTime period label helpers, startOfIsoWeek, getDstSafeDayBounds, and 30D backfill constants
    app.TimeContext.setClockForTests(new Date(2024, 1, 15, 14, 0, 0, 0).getTime()); // Feb 15, 2024 (leap year)
    assert.strictEqual(app.LocalTime.startOfIsoWeek('2024-02-15'), '2024-02-12', 'DF-04B-04: startOfIsoWeek(2024-02-15 Thu) must return Monday 2024-02-12');
    const dstBounds = app.LocalTime.getDstSafeDayBounds('2026-03-08', 'America/New_York');
    assert.strictEqual(dstBounds.dayDurationHours, 23, 'DF-04B-04: LocalTime.getDstSafeDayBounds must return 23h on America/New_York spring-forward day');
    const feb2024Snap = app.computeSnapshot('ALL', 'MONTH', 0, { calendarMonth: true, userId: testUid });
    assert.strictEqual(feb2024Snap.bars.length, 29, 'DF-04B-04: Leap year February 2024 calendarMonth snapshot must have 29 buckets');
    assert(feb2024Snap.periodTitle.includes('February 2024'), 'DF-04B-04: getMonthLabel must honor TimeContext clock override (February 2024)');
    assert.strictEqual(sta.HISTORICAL_BACKFILL_DAYS, 30, 'DF-04B-05: HISTORICAL_BACKFILL_DAYS must be 30');
    assert.strictEqual(sta.HISTORICAL_BACKFILL_30D_WINDOW_MS, 30 * 24 * 60 * 60 * 1000, 'DF-04B-05: HISTORICAL_BACKFILL_30D_WINDOW_MS must be 30 days in ms');
    const customBounds30d = sta.computeIncrementalQueryBounds(0, 3000000000, { backfillDays: 30 });
    assert.strictEqual(customBounds30d.beginTimeMs, 3000000000 - 2592000000, 'DF-04B-05: computeIncrementalQueryBounds with { backfillDays: 30 } must use 30-day window');

    // DF-04B-05 & DF-04B-06: NativeUsageIntegrationService backfill aliases & SupabaseSyncEngine TABLE_ALIASES
    assert.strictEqual(typeof app.NativeUsageIntegrationService.syncHistoricalUsageBackfill, 'function', 'DF-04B-05: syncHistoricalUsageBackfill alias must exist');
    assert.strictEqual(typeof app.NativeUsageIntegrationService.pullHistoricalUsageBackfill, 'function', 'DF-04B-05: pullHistoricalUsageBackfill alias must exist');
    assert.strictEqual(typeof app.NativeUsageIntegrationService.pull30DayHistoricalBackfill, 'function', 'DF-04B-05: pull30DayHistoricalBackfill alias must exist');
    assert.strictEqual(app.SupabaseSyncEngine.resolveTableName('usage_sessions'), 'screen_usage_sessions', 'DF-04B-06: SupabaseSyncEngine.resolveTableName("usage_sessions") must resolve to "screen_usage_sessions"');

    // DF-04B-07 .. DF-04B-09: Static verification of Android, Windows, and Linux Part 04B fixes
    assert(mainJava.includes('public String getHistoricalUsageBackfillJson()') && mainJava.includes('dayStartCal.add(java.util.Calendar.DAY_OF_YEAR, -d)'), 'DF-04B-07: MainActivity.java must expose zero-arg getHistoricalUsageBackfillJson() and use DST-safe Calendar.add(DAY_OF_YEAR, -d)');
    assert(calcJava.includes('lastForegroundPackageForLaunch = null;') && calcJava.includes('int targetHourIdx = Math.min(23, hour);'), 'DF-04B-07: ScreenTimeSessionCalculator.java must reset lastForegroundPackageForLaunch on pause expiry and clamp 25th DST hour into bucket 23');
    const winCsLatest = fs.readFileSync(path.join(rootDir, 'platforms/windows/ScreenSyncWindowsCompanion.cs'), 'utf8');
    const linuxPyLatest = fs.readFileSync(path.join(rootDir, 'platforms/linux/screensync_linux_companion.py'), 'utf8');
    assert(winCsLatest.includes('Environment.TickCount64') && winCsLatest.includes('_historyByDayKey'), 'DF-04B-08: ScreenSyncWindowsCompanion.cs must use TickCount64 wraparound protection and persist 30-day _historyByDayKey');
    assert(linuxPyLatest.includes('"/api/companion/history"') && linuxPyLatest.includes('IdleHint=yes') && linuxPyLatest.includes('fullscreen_mode'), 'DF-04B-09: screensync_linux_companion.py must route /api/companion/history, check loginctl IdleHint, and detect Wayland fullscreen');
  } finally {
    app.TimeContext.setClockForTests(null);
    delete app.BackendDB.data.sessionsByUser['usr_cat04_test_01'];
    delete app.BackendDB.data.installationsByUser['usr_cat04_test_01'];
    if (app.BackendDB.data.unlockBucketsByUser) delete app.BackendDB.data.unlockBucketsByUser['usr_cat04_test_01'];
    if (app.BackendDB.data.syncMetadataByUser) delete app.BackendDB.data.syncMetadataByUser['usr_cat04_test_01'];
    if (idleTracker.trackersByInstallation['windows_pc']) {
      idleTracker.trackersByInstallation['windows_pc'].currentAppSession = null;
    }
    app.state.isAuthenticated = savedIsAuth;
    app.state.currentUser = savedUser;
    app.state.selectedDevice = savedDeviceScope;
    app.state.periodMode = savedPeriodMode;
    app.state.offsets = savedOffsets;
    if (typeof context.setupTestFixtureForUser === 'function' && savedUser && savedUser.userId === 'usr_rahim_01') {
      context.setupTestFixtureForUser('usr_rahim_01', '2026-10-16');
    }
    app.renderAll();
  }

  return { ok: true, suite: 'Category 04 Acceptance Tests (Part 04A + Part 04B Complete)' };
}

if (require.main === module) {
  runCategory04Tests()
    .then((res) => {
      console.log(`[PASS] ${res.suite}`);
    })
    .catch((err) => {
      console.error('[FAIL] Category 04 Acceptance Tests:', err);
      process.exitCode = 1;
      process.exit(1);
    });
}

module.exports = { runCategory04Tests };
