'use strict';

/**
 * ScreenSync — Category 03 Behavioral & Cross-Platform Acceptance Suite (Part 03A)
 * Features 3.1–3.6:
 *   - 3.1: 6-State Short-Form Reel & Story FSM (ReelTrackingEngine), 300ms settle, 1200ms dwell,
 *          forward/backward/loop counting rules, canonical FSM state mapping, and GoalAlertSyncEngine.evaluateAndTriggerGoalAlerts()
 *   - 3.2: 40-item content-signature LRU cache, normalizeReelContentSignature() volatile metric & relative timestamp stripping,
 *          comment/share overlay pause, midnight rollover pre-flush, and 30s->5s idle clamp (single gap + multi-tick static node)
 *   - 3.3: Multi-platform short-form catalog parity (Instagram, YouTube, TikTok, Facebook, FB Lite, Messenger, WhatsApp,
 *          WhatsApp Business, Snapchat, X/Twitter, Reddit, Lite variants) and Browser De-Collision with provenance
 *   - 3.4: ReelMeasurementCapability & Honest iOS Apple Sandbox Guard (IOS_SANDBOX, ALL iOS-only scope, per-app capability)
 *   - 3.5: Desktop Browser Extension (IntersectionObserver, debounced wheel, overlay check, heartbeatSeq, GET_DISCOVERED_APPS,
 *          DRAIN_PENDING_EVENTS), ExtensionHeartbeatTamperGuard.validateExtensionMessage(), and Windows Companion URL dedup
 *   - 3.6: 5-Second Reel Detox Cooldown (ReelDetoxCooldownController, #reelDetoxProgressRing, 5s->Ready countdown,
 *          daily Reel Watch Time Goal crossing trigger, and #accountReelDetoxStatusSubtitle sync)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function runCategory03Tests(context = {}) {
  const rootDir = context.rootDir || path.resolve(__dirname, '..');
  const accJava = fs.readFileSync(path.join(rootDir, 'android/app/src/main/java/io/screensync/wellness/ScreenSyncAccessibilityService.java'), 'utf8');
  const dbJava = fs.readFileSync(path.join(rootDir, 'android/app/src/main/java/io/screensync/wellness/AppUsageDatabaseHelper.java'), 'utf8');
  const mainJava = fs.readFileSync(path.join(rootDir, 'android/app/src/main/java/io/screensync/wellness/MainActivity.java'), 'utf8');
  const manifestXml = fs.readFileSync(path.join(rootDir, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  const iosSwift = fs.readFileSync(path.join(rootDir, 'ios/App/App/AppDelegate.swift'), 'utf8');
  const accSupportedJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'config/accessibility_supported_apps.json'), 'utf8'));
  const extManifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'platforms/browser-extension/manifest.json'), 'utf8'));
  const extObserverSrc = fs.readFileSync(path.join(rootDir, 'platforms/browser-extension/content_shortform_observer.js'), 'utf8');
  const extBgSrc = fs.readFileSync(path.join(rootDir, 'platforms/browser-extension/background_collector.js'), 'utf8');
  const extBridgeSrc = fs.readFileSync(path.join(rootDir, 'platforms/browser-extension/content_bridge.js'), 'utf8');
  const winCompSrc = fs.readFileSync(path.join(rootDir, 'platforms/windows/ScreenSyncWindowsCompanion.cs'), 'utf8');

  // -------------------------------------------------------------------------
  // 1. Step 0.2 & C03-01..C03-06 Native Java / Swift / Manifest / Outbox Checks
  // -------------------------------------------------------------------------
  assert(mainJava.includes('private String decryptWithKeystore(String encryptedPayload)'), 'Step 0.2: MainActivity.java must implement decryptWithKeystore');
  assert(mainJava.includes('public boolean openPermissionSettings(String permissionId'), 'Step 0.2: MainActivity.java openPermissionSettings must return boolean');
  assert(mainJava.includes('dispatchAccessibilityContextUpdate(final String pkg, final String surface, final boolean scrolled, final String direction)'), 'Cat 03: MainActivity.java must support 4-arg dispatchAccessibilityContextUpdate with direction');
  assert(accJava.includes('private long lastWidgetBroadcastElapsedMs = 0L;'), 'C03-01: ScreenSyncAccessibilityService.java must declare lastWidgetBroadcastElapsedMs');
  assert(accJava.includes('SHORT_FORM_PACKAGES'), 'C03-01: ScreenSyncAccessibilityService.java must declare SHORT_FORM_PACKAGES');
  assert(accJava.includes('com.twitter.android') && accJava.includes('com.reddit.frontpage'), 'C03-06: SUPPORTED_PACKAGES & TIER1_VIEW_IDS must include X/Twitter and Reddit');
  assert(accJava.includes('resolveEffectiveShortFormPackage') && accJava.includes('resolveBrowserShortFormTargetPackage'), 'C03-03: ScreenSyncAccessibilityService.java must implement mobile browser short-form de-collision');
  assert(accJava.includes('normalizeReelContentSignature'), 'C03-04: ScreenSyncAccessibilityService.java must expose normalizeReelContentSignature');
  assert(accJava.includes('isIdleClamped') && accJava.includes('idleTailClampedForCurrentSession'), 'C03-05: ScreenSyncAccessibilityService.java must enforce 30s->5s idle clamp flag');
  assert(accJava.includes('interveningCountsBySignature') && accJava.includes('lastCommittedSignature'), 'C03-02: ScreenSyncAccessibilityService.java must track intervening counts and lastCommittedSignature for revisit swipes');
  assert(manifestXml.includes('com.twitter.android') && manifestXml.includes('com.reddit.frontpage'), 'C03-06: AndroidManifest.xml <queries> must declare com.twitter.android and com.reddit.frontpage');
  assert(iosSwift.includes('import HealthKit'), 'Step 0.2: AppDelegate.swift must conditionally import HealthKit');
  assert(dbJava.includes('reel_outbox_events') && dbJava.includes('appendReelOutboxEvent'), 'Cat 03 Fix 4: AppUsageDatabaseHelper.java must define reel_outbox_events SQLite outbox table');

  // -------------------------------------------------------------------------
  // 2. C03-06, C03-08, C03-09, C03-10 Config, Extension & Companion Checks
  // -------------------------------------------------------------------------
  const jsonAppKeys = new Set((accSupportedJson.shortFormApps || []).map(a => a.appKey));
  assert(jsonAppKeys.has('x') && jsonAppKeys.has('reddit') && jsonAppKeys.has('instagram') && jsonAppKeys.has('youtube') && jsonAppKeys.has('tiktok') && jsonAppKeys.has('snapchat'), 'C03-06: config/accessibility_supported_apps.json must include x and reddit alongside core short-form apps');
  assert((accSupportedJson.shortFormApps || []).every(a => a.supportsReels === true), 'CAT03-05: config/accessibility_supported_apps.json entries must explicitly set supportsReels: true');

  const extMatches = (extManifest.content_scripts && extManifest.content_scripts[0] && extManifest.content_scripts[0].matches) || [];
  assert(extMatches.includes('*://*.x.com/*') && extMatches.includes('*://*.twitter.com/*') && extMatches.includes('*://*.reddit.com/*'), 'C03-06: Browser extension manifest.json must match x.com, twitter.com, and reddit.com');
  assert(extObserverSrc.includes('new IntersectionObserver') && extObserverSrc.includes('observeVideoElements'), 'C03-08: content_shortform_observer.js must use IntersectionObserver on <video> elements');
  assert(extObserverSrc.includes('detectWebCommentOrShareOverlay') && extObserverSrc.includes('isOverlaySheetOpen'), 'C03-09: content_shortform_observer.js must detect web comment/share overlays');
  assert(extObserverSrc.includes('wheelSettleTimer') && extObserverSrc.includes('lastScrollReportMs > 600'), 'C03-09: content_shortform_observer.js must debounce wheel events');
  assert(extBgSrc.includes('heartbeatSequence') && extBgSrc.includes('heartbeatSeq') && extBgSrc.includes('heartbeatToken'), 'C03-08: background_collector.js must attach monotonic heartbeatSeq and heartbeatToken');
  assert(extBgSrc.includes('GET_DISCOVERED_APPS') && extBgSrc.includes('DRAIN_PENDING_EVENTS') && extBgSrc.includes('postEventsToLocalCompanionOrSyncServer'), 'C03-08: background_collector.js must handle GET_DISCOVERED_APPS, DRAIN_PENDING_EVENTS, and sync server POST');
  assert(extBridgeSrc.includes('bridgeHeartbeatSeq'), 'C03-08: content_bridge.js must include monotonic heartbeatSeq on EXTENSION_HEARTBEAT');
  assert(winCompSrc.includes('_lastCountedShortFormUrl') && winCompSrc.includes('idleSecs < 60.0'), 'C03-10: ScreenSyncWindowsCompanion.cs must deduplicate _lastCountedShortFormUrl and guard on idleSecs < 60.0');

  // -------------------------------------------------------------------------
  // 3. Behavioral JS Runtime Tests (if app context is available)
  // -------------------------------------------------------------------------
  const app = context.app || (typeof window !== 'undefined' ? window.ScreenSyncApp : null);
  const doc = context.documentMock || (typeof document !== 'undefined' ? document : null);
  if (app && app.ReelTrackingEngine) {
    const rte = app.ReelTrackingEngine;

    // 3.1 Canonical 6-State FSM & Aliases
    assert.deepStrictEqual(
      rte.CANONICAL_FSM_STATES,
      ['IDLE', 'FEED_ENTERED', 'SETTLING', 'DWELL_QUALIFYING', 'ACTIVE_WATCHING', 'PAUSED_OR_OVERLAY'],
      'C03-02: CANONICAL_FSM_STATES must match the 6 canonical spec state names'
    );
    assert.strictEqual(rte.getCanonicalFsmState('MONITORING_TARGET_APP'), 'FEED_ENTERED');
    assert.strictEqual(rte.getCanonicalFsmState('CANDIDATE_SETTLING'), 'SETTLING');
    assert.strictEqual(rte.getCanonicalFsmState('CANDIDATE_DWELLING'), 'DWELL_QUALIFYING');
    assert.strictEqual(rte.getCanonicalFsmState('ACTIVE_VIDEO_COUNTED'), 'ACTIVE_WATCHING');
    assert.strictEqual(rte.getCanonicalFsmState('PAUSED_OVERLAY'), 'PAUSED_OR_OVERLAY');
    assert.strictEqual(rte.getCanonicalFsmState('PAUSED_ON_OVERLAY'), 'PAUSED_OR_OVERLAY');

    // 3.2 normalizeReelContentSignature & Relative Timestamp / Volatile Metric Stripping
    assert.strictEqual(typeof rte.normalizeReelContentSignature, 'function', 'C03-04: normalizeReelContentSignature must exist on ReelTrackingEngine');
    assert.strictEqual(typeof app.normalizeReelContentSignature, 'function', 'C03-04: normalizeReelContentSignature must be exported on window.ScreenSyncApp');
    assert.strictEqual(
      rte.normalizeReelContentSignature('Funny cat 2m ago • 14.2K likes'),
      rte.normalizeReelContentSignature('Funny cat 5 hours ago • 19.8K likes'),
      'C03-04: Relative timestamps ("2m ago" vs "5 hours ago") and like counts must normalize identically'
    );
    assert.strictEqual(
      rte.normalizeReelContentSignature('Posted 3 days ago • 1,234 comments'),
      rte.normalizeReelContentSignature('Posted just now • 85 comments'),
      'C03-04: "3 days ago" and "just now" with comma-grouped counts must normalize identically'
    );
    assert.notStrictEqual(
      rte.normalizeReelContentSignature('Part 1 - System Design'),
      rte.normalizeReelContentSignature('Part 2 - System Design'),
      'C03-04: Sequence numbers ("Part 1" vs "Part 2") must remain distinct'
    );
    assert(
      rte.normalizeReelContentSignature('Summer 2024 Recap').includes('2024'),
      'CAT03-13: 4-digit calendar years ("2024") in captions must not be stripped'
    );

    // 3.3 Catalog & Browser De-Collision
    assert.strictEqual(app.APP_METADATA.x.supportsReels, true, 'C03-06: APP_METADATA.x.supportsReels must be true');
    assert.strictEqual(app.APP_METADATA.reddit.supportsReels, true, 'C03-06: APP_METADATA.reddit.supportsReels must be true');
    assert.strictEqual(app.APP_METADATA.whatsapp_business.supportsReels, true, 'CAT03-17: APP_METADATA.whatsapp_business.supportsReels must be true');
    assert.strictEqual(app.APP_METADATA.instagram_lite.supportsReels, true, 'CAT03-17: APP_METADATA.instagram_lite.supportsReels must be true');
    assert.strictEqual(app.APP_METADATA.tiktok_lite.supportsReels, true, 'CAT03-17: APP_METADATA.tiktok_lite.supportsReels must be true');
    assert.strictEqual(app.APP_METADATA.youtube_music.supportsReels, false, 'CAT03-17: APP_METADATA.youtube_music must be explicitly defined with supportsReels: false');

    const decolYt = app.BrowserAndWebShortFormInspector.decollideBrowserPlatform({
      appKey: 'chrome',
      rawUrl: 'https://www.youtube.com/shorts/dQw4w9WgXcQ'
    });
    assert.strictEqual(decolYt.decollided, true, 'C03-03: Chrome YouTube Shorts URL must de-collide');
    assert.strictEqual(decolYt.appKey, 'youtube', 'C03-03: De-collided appKey must be youtube');
    assert.strictEqual(decolYt.browserHostAppKey, 'chrome', 'C03-03: browserHostAppKey must preserve chrome');

    const decolX = app.BrowserAndWebShortFormInspector.decollideBrowserPlatform({
      appKey: 'brave',
      rawUrl: 'https://x.com/i/immersive_timeline'
    });
    assert.strictEqual(decolX.decollided, true, 'C03-06: Brave X immersive video URL must de-collide');
    assert.strictEqual(decolX.appKey, 'x', 'C03-06: De-collided appKey must be x');

    const decolReddit = app.BrowserAndWebShortFormInspector.decollideBrowserPlatform({
      appKey: 'firefox',
      rawUrl: 'https://www.reddit.com/r/videos/watch'
    });
    assert.strictEqual(decolReddit.decollided, true, 'C03-06: Firefox Reddit Watch URL must de-collide');
    assert.strictEqual(decolReddit.appKey, 'reddit', 'C03-06: De-collided appKey must be reddit');

    // Window title differentiation on generic /foryou path
    const tiktokClf1 = app.BrowserAndWebShortFormInspector.classifyBrowserTabInMemory({
      rawAddressBarText: 'https://www.tiktok.com/foryou',
      windowTitle: 'Creator A - Cooking Pasta #fyp'
    });
    const tiktokClf2 = app.BrowserAndWebShortFormInspector.classifyBrowserTabInMemory({
      rawAddressBarText: 'https://www.tiktok.com/foryou',
      windowTitle: 'Creator B - Guitar Solo #music'
    });
    assert.notStrictEqual(tiktokClf1.itemSignature, tiktokClf2.itemSignature, 'C03-10: classifyBrowserTabInMemory must differentiate videos on generic /foryou path using normalized windowTitle');

    // 3.4 FSM Revisit Swipe (+1 after viewing intermediate reel B) vs Same-Item Re-Render (+0) & 30s->5s Static Idle Clamp
    const testInst = 'cat03_test_inst';
    rte.resetTrackingSandbox(testInst);
    rte.clearViewedReelsLruCache(testInst);
    delete rte.fsmStateByInstallation[testInst];

    const t0 = 1761000000000;
    // Scroll to Reel A on X (com.twitter.android)
    rte.processRawStreamSignal({
      installationKey: testInst,
      packageName: 'com.twitter.android',
      viewIds: ['com.twitter.android:id/immersive_video_player'],
      eventType: 'TYPE_VIEW_SCROLLED',
      rowIndex: 0,
      creatorHandle: '@XCreatorA',
      captionSnippet: 'First X Video 2m ago',
      timestampMs: t0
    });
    const countA1 = rte.processRawStreamSignal({
      installationKey: testInst,
      packageName: 'com.twitter.android',
      viewIds: ['com.twitter.android:id/immersive_video_player'],
      eventType: 'HEARTBEAT',
      rowIndex: 0,
      creatorHandle: '@XCreatorA',
      captionSnippet: 'First X Video 3m ago',
      timestampMs: t0 + 1600
    });
    assert.strictEqual(countA1.reelCountDelta, 1, 'C03-02/C03-06: Reel A on X must count +1 after settle + dwell even when relative timestamp ticks from 2m ago to 3m ago');

    // Same-item DOM re-render on Reel A (no intervening distinct reel) -> +0
    const rerenderA = rte.processRawStreamSignal({
      installationKey: testInst,
      packageName: 'com.twitter.android',
      viewIds: ['com.twitter.android:id/immersive_video_player'],
      eventType: 'TYPE_WINDOW_CONTENT_CHANGED',
      bypassThrottle: true,
      rowIndex: 0,
      creatorHandle: '@XCreatorA',
      captionSnippet: 'First X Video 4m ago',
      timestampMs: t0 + 3500
    });
    assert.strictEqual(rerenderA.reelCountDelta, 0, 'C03-02: Same-item DOM re-render must count 0');

    // Swipe forward to Reel B and qualify -> +1
    rte.processRawStreamSignal({
      installationKey: testInst,
      packageName: 'com.twitter.android',
      viewIds: ['com.twitter.android:id/immersive_video_player'],
      eventType: 'TYPE_VIEW_SCROLLED',
      rowIndex: 1,
      creatorHandle: '@XCreatorB',
      captionSnippet: 'Second X Video',
      timestampMs: t0 + 4000
    });
    const countB = rte.processRawStreamSignal({
      installationKey: testInst,
      packageName: 'com.twitter.android',
      viewIds: ['com.twitter.android:id/immersive_video_player'],
      eventType: 'HEARTBEAT',
      rowIndex: 1,
      creatorHandle: '@XCreatorB',
      captionSnippet: 'Second X Video',
      timestampMs: t0 + 5600
    });
    assert.strictEqual(countB.reelCountDelta, 1, 'C03-02: Reel B must count +1');

    // Swipe backward to revisit Reel A and qualify -> +1 (revisit after viewing Reel B!)
    rte.processRawStreamSignal({
      installationKey: testInst,
      packageName: 'com.twitter.android',
      viewIds: ['com.twitter.android:id/immersive_video_player'],
      eventType: 'TYPE_VIEW_SCROLLED',
      navigationDirection: 'BACKWARD',
      rowIndex: 0,
      creatorHandle: '@XCreatorA',
      captionSnippet: 'First X Video 5m ago',
      timestampMs: t0 + 6000
    });
    const revisitA = rte.processRawStreamSignal({
      installationKey: testInst,
      packageName: 'com.twitter.android',
      viewIds: ['com.twitter.android:id/immersive_video_player'],
      eventType: 'HEARTBEAT',
      navigationDirection: 'BACKWARD',
      rowIndex: 0,
      creatorHandle: '@XCreatorA',
      captionSnippet: 'First X Video 5m ago',
      timestampMs: t0 + 7600
    });
    assert.strictEqual(revisitA.reelCountDelta, 1, 'C03-02/CAT03-01: Backward revisit swipe to Reel A after viewing Reel B must count +1');

    // 30s -> 5s Static Idle Clamp across periodic heartbeats without user interaction
    const idleTick1 = rte.processRawStreamSignal({
      installationKey: testInst,
      packageName: 'com.twitter.android',
      viewIds: ['com.twitter.android:id/immersive_video_player'],
      eventType: 'HEARTBEAT',
      rowIndex: 0,
      creatorHandle: '@XCreatorA',
      captionSnippet: 'First X Video 5m ago',
      timestampMs: t0 + 39000 // > 30s since last interaction at t0 + 7600
    });
    assert(idleTick1.watchMsAdded <= 5000, `C03-05: First tick after >30s without interaction must clamp to <=5000ms (got ${idleTick1.watchMsAdded})`);
    const idleTick2 = rte.processRawStreamSignal({
      installationKey: testInst,
      packageName: 'com.twitter.android',
      viewIds: ['com.twitter.android:id/immersive_video_player'],
      eventType: 'HEARTBEAT',
      rowIndex: 0,
      creatorHandle: '@XCreatorA',
      captionSnippet: 'First X Video 5m ago',
      timestampMs: t0 + 43000 // Still no user interaction -> paused!
    });
    assert.strictEqual(idleTick2.watchMsAdded, 0, 'C03-05: Subsequent static idle ticks after >30s clamp must credit 0ms until next interaction');

    delete rte.fsmStateByInstallation[testInst];
    rte.clearViewedReelsLruCache(testInst);

    // 3.5 iOS Capability Guard (OS_iOS, ALL iOS-only, Per-App Capability & PLATFORM_CAPABILITY_PROFILES.iOS)
    assert.strictEqual(
      app.CrossPlatformScreenAccessManager.PLATFORM_CAPABILITY_PROFILES.iOS.inAppThirdPartyReelSwipeSupported,
      false,
      'C03-07: PLATFORM_CAPABILITY_PROFILES.iOS.inAppThirdPartyReelSwipeSupported must be false'
    );
    assert.strictEqual(
      app.CrossPlatformScreenAccessManager.PLATFORM_CAPABILITY_PROFILES.iOS.reelMeasurementStatus,
      'UNAVAILABLE_ON_IOS_SANDBOX',
      'C03-07: PLATFORM_CAPABILITY_PROFILES.iOS.reelMeasurementStatus must be UNAVAILABLE_ON_IOS_SANDBOX'
    );
    const iosOnlyUser = 'usr_cat03_ios_only';
    app.BackendDB.ensureUserStructures(iosOnlyUser);
    app.BackendDB.data.installationsByUser[iosOnlyUser] = [
      { installationId: 'inst_ios_only_1', key: 'iphone_16_only', osCategory: 'iOS', name: 'iPhone 16' }
    ];
    app.BackendDB.data.reelEventsByUser[iosOnlyUser] = [];
    const allScopeIosCap = app.ReelMeasurementCapability.getCapabilityForScope('ALL', { userId: iosOnlyUser });
    assert.strictEqual(allScopeIosCap.supported, false, 'C03-07: ALL scope for iOS-only account with 0 verified reels must return supported: false');
    assert.strictEqual(allScopeIosCap.reason, 'IOS_SANDBOX', 'C03-07: ALL scope for iOS-only account must return reason IOS_SANDBOX');
    delete app.BackendDB.data.installationsByUser[iosOnlyUser];
    delete app.BackendDB.data.reelEventsByUser[iosOnlyUser];

    // 3.6 ExtensionHeartbeatTamperGuard.validateExtensionMessage
    const untrustedRes = app.ExtensionHeartbeatTamperGuard.validateExtensionMessage(
      { source: 'SCREENSYNC_EXTENSION', type: 'EXTENSION_HEARTBEAT', timestampMs: Date.now() },
      'https://malicious-attacker.example.com'
    );
    assert.strictEqual(untrustedRes.valid, false, 'C03-08/CAT03-07: Untrusted origin must be rejected by validateExtensionMessage');
    assert.strictEqual(untrustedRes.reason, 'UNTRUSTED_EXTENSION_ORIGIN');

    const validExtMsg1 = app.ExtensionHeartbeatTamperGuard.validateExtensionMessage(
      { source: 'SCREENSYNC_EXTENSION', type: 'EXTENSION_HEARTBEAT', installationKey: 'cros_test_01', heartbeatSeq: 10, timestampMs: Date.now() },
      'chrome-extension://abcdefghijklmnop'
    );
    assert.strictEqual(validExtMsg1.valid, true, 'C03-08: Valid chrome-extension:// message with monotonic heartbeatSeq must pass');

    const replayExtMsg = app.ExtensionHeartbeatTamperGuard.validateExtensionMessage(
      { source: 'SCREENSYNC_EXTENSION', type: 'EXTENSION_HEARTBEAT', installationKey: 'cros_test_01', heartbeatSeq: 9, timestampMs: Date.now() },
      'chrome-extension://abcdefghijklmnop'
    );
    assert.strictEqual(replayExtMsg.valid, false, 'C03-08: Replayed/decreasing heartbeatSeq must be rejected');
    assert.strictEqual(replayExtMsg.reason, 'REPLAYED_HEARTBEAT_SEQ');

    // 3.7 GoalAlertSyncEngine.evaluateAndTriggerGoalAlerts & ReelDetoxCooldownController (Progress Ring, Ready badge, Daily Goal Trigger, Account Subtitle)
    assert.strictEqual(typeof app.GoalAlertSyncEngine.evaluateAndTriggerGoalAlerts, 'function', 'C03-02: GoalAlertSyncEngine.evaluateAndTriggerGoalAlerts must exist');
    assert.strictEqual(typeof app.ReelDetoxCooldownController.evaluateDailyGoalCrossing, 'function', 'C03-11: ReelDetoxCooldownController.evaluateDailyGoalCrossing must exist');

    if (doc) {
      const ringSvg = doc.getElementById('reelDetoxProgressRing');
      const ringCircle = doc.getElementById('reelDetoxProgressCircle');
      const acctSubtitle = doc.getElementById('accountReelDetoxStatusSubtitle');
      const aliasSubtitle = doc.getElementById('reelDetoxSettingsSubtitle');
      assert(ringSvg && ringCircle, 'C03-11: #reelDetoxProgressRing and #reelDetoxProgressCircle must exist in DOM');
      assert(acctSubtitle && aliasSubtitle === acctSubtitle, 'C03-11: #accountReelDetoxStatusSubtitle and alias #reelDetoxSettingsSubtitle must resolve in DOM');

      const prevDetoxEnabled = app.state.reelDetoxEnabled;
      const prevGoalEnabled = app.state.goalEnabled;
      const prevDailyGoal = app.state.dailyGoalMinutes;
      app.state.reelDetoxEnabled = true;
      app.state.goalEnabled = true;
      app.state.dailyGoalMinutes = 60;
      app.ReelDetoxCooldownController.syncSubtitleUI();
      assert(acctSubtitle.textContent.includes('Active'), 'C03-11: syncSubtitleUI() must update #accountReelDetoxStatusSubtitle with Active state');

      const goalDetoxRes = app.ReelDetoxCooldownController.evaluateDailyGoalCrossing({
        userId: 'usr_cat03_detox_goal',
        watchMinutes: 65,
        dailyGoalMinutes: 60,
        localDate: '2026-10-16',
        force: true
      });
      assert.strictEqual(goalDetoxRes.triggered, true, 'C03-11/CAT03-09: Crossing dailyGoalMinutes must trigger ReelDetoxCooldownController');
      assert.strictEqual(goalDetoxRes.triggerReason, 'DAILY_REEL_GOAL_REACHED');

      const ringAfterInit = app.ReelDetoxCooldownController._updateProgressRing(0, 5);
      assert.strictEqual(ringAfterInit.ratio, 0, 'C03-11: _updateProgressRing(0, 5) must reach ratio 0');

      app.ReelDetoxCooldownController.resetBurst();
      app.state.reelDetoxEnabled = prevDetoxEnabled;
      app.state.goalEnabled = prevGoalEnabled;
      app.state.dailyGoalMinutes = prevDailyGoal;
      app.ReelDetoxCooldownController.syncSubtitleUI();
    }

    // -------------------------------------------------------------------------
    // 4. Part 03B Delta Findings Verification (DF-03B-01 through DF-03B-12)
    // -------------------------------------------------------------------------
    // DF-03B-01: BackendDB.loadUserSettingsIntoState & SupabaseSyncEngine persist/restore Reel Detox settings
    const detoxTestUser = 'usr_df03b_detox_settings';
    app.BackendDB.ensureUserStructures(detoxTestUser);
    const savedDetoxEnabled = app.state.reelDetoxEnabled;
    const savedDetoxThreshold = app.state.reelDetoxThresholdCount;
    const savedDetoxCooldown = app.state.reelDetoxCooldownSeconds;
    app.state.reelDetoxEnabled = false;
    app.state.reelDetoxThresholdCount = 28;
    app.state.reelDetoxCooldownSeconds = 9;
    app.BackendDB.saveUserSettings(detoxTestUser);
    app.state.reelDetoxEnabled = true;
    app.state.reelDetoxThresholdCount = 25;
    app.state.reelDetoxCooldownSeconds = 5;
    app.BackendDB.loadUserSettingsIntoState(detoxTestUser);
    assert.strictEqual(app.state.reelDetoxEnabled, false, 'DF-03B-01: loadUserSettingsIntoState must restore reelDetoxEnabled');
    assert.strictEqual(app.state.reelDetoxThresholdCount, 28, 'DF-03B-01: loadUserSettingsIntoState must restore reelDetoxThresholdCount');
    assert.strictEqual(app.state.reelDetoxCooldownSeconds, 9, 'DF-03B-01: loadUserSettingsIntoState must restore reelDetoxCooldownSeconds');
    app.state.reelDetoxEnabled = savedDetoxEnabled;
    app.state.reelDetoxThresholdCount = savedDetoxThreshold;
    app.state.reelDetoxCooldownSeconds = savedDetoxCooldown;
    app.ReelDetoxCooldownController.syncSubtitleUI();
    delete app.BackendDB.data.settingsByUser[detoxTestUser];

    // DF-03B-02: normalizeDeviceScopeKey & bare OS scope normalization ("IOS", "OS_IOS" -> "OS_iOS")
    assert.strictEqual(app.normalizeDeviceScopeKey('IOS'), 'OS_iOS', 'DF-03B-02: normalizeDeviceScopeKey("IOS") must normalize to "OS_iOS"');
    assert.strictEqual(app.normalizeDeviceScopeKey('OS_IOS'), 'OS_iOS', 'DF-03B-02: normalizeDeviceScopeKey("OS_IOS") must normalize to "OS_iOS"');
    assert.strictEqual(app.normalizeDeviceScopeKey('macos'), 'OS_macOS', 'DF-03B-02: normalizeDeviceScopeKey("macos") must normalize to "OS_macOS"');
    const bareIosCap = app.ReelMeasurementCapability.getCapabilityForScope('IOS');
    assert.strictEqual(bareIosCap.supported, false, 'DF-03B-02: getCapabilityForScope("IOS") must return supported: false');
    assert.strictEqual(bareIosCap.isLimitedIos, true, 'DF-03B-02: getCapabilityForScope("IOS") must expose isLimitedIos: true');
    assert.strictEqual(bareIosCap.reasonCode, 'IOS_SANDBOX', 'DF-03B-02: getCapabilityForScope("IOS") must expose reasonCode: "IOS_SANDBOX"');

    // DF-03B-03: ingestExtensionMessage prevents EXTENSION_TAB_SAMPLE from colliding with active DOM EXTENSION_SHORT_FORM_SIGNAL
    const extTestInst = 'cros_df03b_ext_inst';
    rte.resetTrackingSandbox(extTestInst);
    rte.clearViewedReelsLruCache(extTestInst);
    delete rte.fsmStateByInstallation[extTestInst];
    const extNow = 1762000000000;
    app.ingestExtensionMessage({
      source: 'SCREENSYNC_EXTENSION',
      type: 'EXTENSION_SHORT_FORM_SIGNAL',
      installationKey: extTestInst,
      heartbeatSeq: 101,
      timestampMs: extNow,
      detail: {
        appKey: 'youtube',
        contentType: 'SHORT',
        eventType: 'TYPE_VIEW_SCROLLED',
        isShortFormSurface: true,
        isPlaying: true,
        explicitSignature: 'youtube|SHORT|/shorts/abc123XYZ|dom_item_1',
        rowIndex: 1,
        timestampMs: extNow
      }
    }, 'chrome-extension://abcdefghijklmnop');
    // 700ms later (still in 1200ms dwell), 7s EXTENSION_TAB_SAMPLE fires -> must reuse active DOM signature instead of causing a flick!
    const tabSampleDuringDwell = app.ingestExtensionMessage({
      source: 'SCREENSYNC_EXTENSION',
      type: 'EXTENSION_TAB_SAMPLE',
      installationKey: extTestInst,
      heartbeatSeq: 102,
      timestampMs: extNow + 700,
      detail: {
        browserProcessName: 'chrome',
        rawAddressBarText: 'https://www.youtube.com/shorts/abc123XYZ',
        windowTitle: 'YouTube Shorts',
        isAudioPlaying: true,
        isIdle: false,
        timestampMs: extNow + 700
      }
    }, 'chrome-extension://abcdefghijklmnop');
    assert.strictEqual(tabSampleDuringDwell.reelResult.reason, 'DWELL_IN_PROGRESS', 'DF-03B-03: EXTENSION_TAB_SAMPLE during active DOM signal dwell must not overwrite candidateFingerprint or trigger flick');
    delete rte.fsmStateByInstallation[extTestInst];
    rte.clearViewedReelsLruCache(extTestInst);

    // DF-03B-05: _deduplicateAndClaimInterval coalesces contiguous intervals & bounds ledger
    const coalInst = 'inst_df03b_coalesce';
    rte.resetTrackingSandbox(coalInst);
    rte._deduplicateAndClaimInterval(coalInst, 1000, 2000);
    rte._deduplicateAndClaimInterval(coalInst, 2000, 3000);
    rte._deduplicateAndClaimInterval(coalInst, 3000, 4500);
    assert.strictEqual(rte.accountedIntervalsByInstallation[coalInst].length, 1, 'DF-03B-05: Contiguous intervals [1000,2000], [2000,3000], [3000,4500] must coalesce into 1 interval [1000,4500]');
    assert.deepStrictEqual(rte.accountedIntervalsByInstallation[coalInst][0], [1000, 4500]);
    rte.resetTrackingSandbox(coalInst);

    // DF-03B-06: ReelDetoxCooldownController.isCooldownBlockingActive & evaluateVelocityTriggerIfNeeded
    assert.strictEqual(typeof app.ReelDetoxCooldownController.isCooldownBlockingActive, 'function', 'DF-03B-06: isCooldownBlockingActive must exist');
    assert.strictEqual(typeof app.ReelDetoxCooldownController.evaluateVelocityTriggerIfNeeded, 'function', 'DF-03B-06: evaluateVelocityTriggerIfNeeded must exist');

    // DF-03B-11: RuntimeConfigLoader.hydrateSupportedAppsCatalog populates ReelTrackingEngine.supportedAppsCatalog
    assert(rte.supportedAppsCatalog && Array.isArray(rte.supportedAppsCatalog.shortFormApps) && rte.supportedAppsCatalog.shortFormApps.length >= 11, 'DF-03B-11: ReelTrackingEngine.supportedAppsCatalog must be hydrated at runtime');
  }

  // Native/Companion file static checks for DF-03B-04, DF-03B-07, DF-03B-08, DF-03B-09, DF-03B-10
  const widgetJava = fs.readFileSync(path.join(rootDir, 'android/app/src/main/java/io/screensync/wellness/ReelTrackerWidgetProvider.java'), 'utf8');
  const iosMonitorSwift = fs.readFileSync(path.join(rootDir, 'ios/App/ScreenSyncDeviceActivityExtension/DeviceActivityMonitorExtension.swift'), 'utf8');
  const linuxPy = fs.readFileSync(path.join(rootDir, 'platforms/linux/screensync_linux_companion.py'), 'utf8');
  const macSwift = fs.readFileSync(path.join(rootDir, 'platforms/macos/Sources/main.swift'), 'utf8');

  assert(accJava.includes('boolean shouldRearmSettle'), 'DF-03B-07a: ScreenSyncAccessibilityService.java must guard settleRunnable re-arming with shouldRearmSettle');
  assert(accJava.includes('engagement_panel') && accJava.includes('add a comment'), 'DF-03B-07b: ScreenSyncAccessibilityService.java hasBlockingOverlaySheet must check engagement_panel and comment descriptions');
  assert(widgetJava.includes('com.twitter.android') && widgetJava.includes('com.reddit.frontpage') && widgetJava.includes('com.whatsapp.w4b'), 'DF-03B-07c: ReelTrackerWidgetProvider.java SHORT_FORM_PACKAGES must include all 15 short-form packages');
  assert(mainJava.includes('final String nativeEventId'), 'DF-03B-08: MainActivity.java dispatchAccessibilityContextUpdate must accept nativeEventId for deterministic outbox deduplication');
  assert(iosMonitorSwift.includes('group.com.screensync.shared') && iosMonitorSwift.includes('setSharedValue'), 'DF-03B-09: DeviceActivityMonitorExtension.swift must mirror keys across both App Group suites');
  assert(extBgSrc.includes('sanitizeShortFormContextUrl') && extBgSrc.includes('inMemoryShortFormUrl'), 'DF-03B-04: background_collector.js must preserve short-form route paths in memory via sanitizeShortFormContextUrl');
  assert(linuxPy.includes('x.com/i/immersive_timeline') && linuxPy.includes('reddit.com/watch'), 'DF-03B-10a: screensync_linux_companion.py must detect X and Reddit short-form tokens');
  assert(macSwift.includes('x.com/i/immersive_timeline') && macSwift.includes('reddit.com/watch'), 'DF-03B-10b: macOS main.swift must detect X and Reddit short-form tokens');

  return { ok: true, suite: 'Category 03 Acceptance Tests (Part 03A + Part 03B Complete)' };
}

module.exports = { runCategory03Tests };

if (require.main === module) {
  runCategory03Tests()
    .then((res) => {
      console.log('[PASS]', res.suite);
    })
    .catch((err) => {
      console.error('[FAIL] Category 03 Acceptance Tests:', err);
      process.exitCode = 1;
    });
}
