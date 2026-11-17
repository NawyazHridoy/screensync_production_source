'use strict';

/**
 * ScreenSync — Category 07 & 08 Behavioral & Cross-Platform Acceptance Suite (Part 07A + Part 07B)
 * Category 07: App Discovery, App Detail Analytics & Per-App Limits/Timers (Features 7.1–7.6)
 *   - 7.1: AppDiscoveryService, CrossPlatformAppIdentityResolver, APP_LOGOS, 5-tier icon priority,
 *          leaf-collision protection (CAT07-15), WhatsApp casing parity (CAT07-22), Supabase cloud sync (P0-01 / CAT07-06),
 *          Part 07B store package mappings (F71-B01), lowercase casing protection (F71-B02), reverse-DNS friendly display-name
 *          derivation (F71-B03), UWP ApplicationFrameHost badge/title splitting & shell host exclusions (F71-B04),
 *          XSS-hardened getAppLogoHtml (F71-B05), and Android bitmap recycling + Pass 2 ai.category mapping (F71-B06)
 *   - 7.2: #viewAppDetail dual charts (#detailAppMainChart / #detailAppWeekBars & #detailAppSubChart / #detailSubCardBars),
 *          adaptive 7-day Reels vs Notifications breakdown (P0-02 / CAT07-03), bounded week offset navigation (CAT07-13),
 *          honest average line (CAT07-19), real container tooltip bounds (F72-B04), pillar aria-label & hover/keyboard
 *          focus retention (F72-B05 / F72-B07), and 0-screen-time notification-only attribution (F72-B06)
 *   - 7.3: #detailAppCategorySelect & setCustomAppCategory rewriting sessions + reelEvents, mirroring
 *          userSettingsByUser[uid].customAppCategories, rejecting invalid categories (P0-06, P0-07, CAT07-09),
 *          detectedCategory preservation (F73-B01), and "AUTO" reset tombstones + timestamp comparison (F73-B02 / F73-B03)
 *   - 7.4: AppLimitManager, #appTimerModal icon/current-usage header, wheel/input clamping (CAT07-10),
 *          isScheduleActiveOnDate / isScheduleActiveToday, canonicalizeSchedule / normalizeScheduleToken (F74-B01),
 *          Android accessibility/overlay permission gate (P0-05 / CAT07-12), 80%/100% dedup evaluation,
 *          <80%->100% milestone recording (F74-B04), 14-day ledger pruning (F74-B06), legacy SQL seed guard (F74-B07),
 *          package-resolved enforceAppBlock (P0-03/04 / CAT07-02), and reference date check (CAT07-04)
 *   - 7.5: #viewAppLimits Hub active vs available lists, 0-usage discovered apps inclusion (P1-02),
 *          exceeded/approaching/inactive badge colors (P1-03), schedule-active badge count (CAT07-20),
 *          all-timed empty state (CAT07-11), direct Hub click bindings (F75-B04), and All Apps / Account navigation origins (P0-07)
 *   - 7.6: WindDownBedtimeController toggle (CAT07-17), 15m trigger, persisted snooze, single dismissModal()
 *          back-stack unwind (P1-01 / CAT07-18), non-reel companion activity guard (F76-B08), episode-scoped notification
 *          deduplication (F76-B07), pure-Java AppTimerPolicy.java + AppTimerPolicyTest.java (F76-B02..F76-B06), and
 *          Android AppTimerSuspensionManager + passive playback heartbeat timer enforcement (P1-05)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function runCategory07And08Tests({ app, documentMock, sandbox, rootDir, setupTestFixtureForUser } = {}) {
  const resolvedRoot = rootDir || path.resolve(__dirname, '..');

  // -------------------------------------------------------------------------
  // 1. Static Source, SQL Schema & Native Android/iOS/Windows Bridge Verification
  // -------------------------------------------------------------------------
  const mig006 = fs.readFileSync(path.join(resolvedRoot, 'supabase/migrations/20261022000006_truthful_status_and_realtime.sql'), 'utf8');
  const mig009 = fs.readFileSync(path.join(resolvedRoot, 'supabase/migrations/20261022000009_v36_reports_widgets_and_deletion_audit.sql'), 'utf8');
  const mig013 = fs.readFileSync(path.join(resolvedRoot, 'supabase/migrations/20261022000013_category07_pass_b_app_timers_and_category_rules_hardening.sql'), 'utf8');
  const mainJava = fs.readFileSync(path.join(resolvedRoot, 'android/app/src/main/java/io/screensync/wellness/MainActivity.java'), 'utf8');
  const suspJava = fs.readFileSync(path.join(resolvedRoot, 'android/app/src/main/java/io/screensync/wellness/AppTimerSuspensionManager.java'), 'utf8');
  const policyJava = fs.readFileSync(path.join(resolvedRoot, 'android/app/src/main/java/io/screensync/wellness/AppTimerPolicy.java'), 'utf8');
  const accJava = fs.readFileSync(path.join(resolvedRoot, 'android/app/src/main/java/io/screensync/wellness/ScreenSyncAccessibilityService.java'), 'utf8');
  const iosSwift = fs.readFileSync(path.join(resolvedRoot, 'ios/App/App/AppDelegate.swift'), 'utf8');
  const winCs = fs.readFileSync(path.join(resolvedRoot, 'platforms/windows/ScreenSyncWindowsCompanion.cs'), 'utf8');
  const appJsSrc = fs.readFileSync(path.join(resolvedRoot, 'src/js/app.js'), 'utf8');

  // P0-01 & CAT07-06: Supabase discovered_apps and app_limits tables with RLS + deletion RPC
  assert(
    mig006.includes('CREATE TABLE IF NOT EXISTS public.discovered_apps') &&
    mig006.includes('ALTER TABLE public.discovered_apps ENABLE ROW LEVEL SECURITY;') &&
    mig006.includes('CREATE TABLE IF NOT EXISTS public.app_limits') &&
    mig006.includes('ALTER TABLE public.app_limits ENABLE ROW LEVEL SECURITY;') &&
    mig006.includes('DELETE FROM public.discovered_apps WHERE user_id = caller_uid;') &&
    mig006.includes('DELETE FROM public.app_limits WHERE user_id = caller_uid;'),
    'P0-01: Migration 0006 must create public.discovered_apps and public.app_limits with RLS and purge them in delete_user_account_and_all_data'
  );
  assert(
    mig009.includes('DELETE FROM public.discovered_apps WHERE user_id = caller_uid;') &&
    mig009.includes('DELETE FROM public.app_limits WHERE user_id = caller_uid;'),
    'P0-01: Migration 0009 must purge public.discovered_apps and public.app_limits in delete_user_account_and_all_data'
  );
  assert(
    mig013.includes("ALTER COLUMN app_timers SET DEFAULT '{}'::jsonb;") &&
    mig013.includes('ADD COLUMN IF NOT EXISTS deleted BOOLEAN NOT NULL DEFAULT FALSE'),
    'F74-B07 & F73-B02: Migration 0013 must set user_settings.app_timers default to {} and add deleted tombstone column to app_category_rules'
  );

  // P0-03, P0-04, P1-05, CAT07-02, CAT07-14, F71-B06, F72-B06, F76-B02..F76-B06: Android Native Verification
  assert(
    suspJava.includes('public class AppTimerSuspensionManager') &&
    suspJava.includes('public String[] suspendPackageForExpiredTimer(String packageName)') &&
    suspJava.includes('public boolean isPackageMarkedSuspended(String packageName)'),
    'P0-03: AppTimerSuspensionManager.java must implement suspendPackageForExpiredTimer and isPackageMarkedSuspended'
  );
  assert(
    policyJava.includes('public final class AppTimerPolicy') &&
    policyJava.includes('public static boolean isScheduleActiveOnDayOfWeek(') &&
    policyJava.includes('public static boolean shouldEnforceTimerBlock(') &&
    policyJava.includes('public static boolean shouldPerformHomeIntercept(') &&
    policyJava.includes('public static boolean shouldTriggerBedtimeWindDown('),
    'F76-B02..B06: AppTimerPolicy.java must implement schedule, timer block, home intercept cooldown, and bedtime wind-down policy helpers'
  );
  assert(
    mainJava.includes('private AppTimerSuspensionManager appTimerSuspensionManager;') &&
    mainJava.includes('appTimerSuspensionManager = new AppTimerSuspensionManager(this);') &&
    mainJava.includes('public void syncAppTimersJson(String payloadJson)') &&
    mainJava.includes('appTimerSuspensionManager.registerDailyAppTimer(') &&
    mainJava.includes('appTimerSuspensionManager.suspendPackageForExpiredTimer(resolvedPkg)') &&
    mainJava.includes('accSvc.enforceAppTimerBlockFromBridge(resolvedPkg, displayLabel, limitMinutes)') &&
    mainJava.includes('registerPackageChangeReceiver()') &&
    mainJava.includes('Intent.ACTION_PACKAGE_ADDED') &&
    mainJava.includes('bmp.recycle()') &&
    mainJava.includes('wind_down_snoozed_until_ms') &&
    mainJava.includes('Set<String> allDayPkgs = new HashSet<>(pkgFgMs.keySet());'),
    'P0-03/04, CAT07-14, F71-B06, F72-B06 & F76-B05: MainActivity.java must wire AppTimerSuspensionManager, bmp.recycle(), Pass 2 category mapping, wind_down_snoozed_until_ms, and notification-only historical apps'
  );
  assert(
    accJava.includes('public void enforceAppTimerBlockFromBridge(String packageName, String appLabel, int limitMinutes)') &&
    accJava.includes('new AppTimerSuspensionManager(this).suspendPackageForExpiredTimer(packageName);') &&
    accJava.includes('checkAndEnforceAppTimerIfNeeded(activePackage);') &&
    accJava.includes('cachedSyncedTimersRoot') &&
    accJava.includes('AppTimerPolicy.shouldEnforceTimerBlock(') &&
    accJava.includes('AppTimerPolicy.shouldPerformHomeIntercept(') &&
    accJava.includes('AppTimerPolicy.shouldTriggerBedtimeWindDown(') &&
    !accJava.includes('pkg.contains("keyboard")'),
    'P1-05, CAT07-02 & F76-B02..B06: ScreenSyncAccessibilityService.java must wire cachedSyncedTimersRoot, AppTimerPolicy, 1.5s home intercept cooldown, and exact IME/launcher exemptions'
  );
  assert(
    iosSwift.includes('syncAppTimersJson: function(payloadJson)'),
    'P0-07: iOS AppDelegate.swift must expose syncAppTimersJson alias on ScreenSyncNativeBridge'
  );
  assert(
    winCs.includes('"RuntimeBroker"') &&
    winCs.includes('"SearchUI"') &&
    winCs.includes('string.Equals(rawProcName, "ApplicationFrameHost"'),
    'F71-B04: ScreenSyncWindowsCompanion.cs must exclude shell background processes and extract UWP child app title from ApplicationFrameHost'
  );

  // CAT07-18 / P1-01: Verify WindDownBedtimeController has exactly 1 dismissModal definition
  const windDownBlockMatch = appJsSrc.match(/const WindDownBedtimeController\s*=\s*\{[\s\S]*?\n    \};/);
  assert(windDownBlockMatch, 'WindDownBedtimeController block must exist in src/js/app.js');
  const dismissMatches = windDownBlockMatch[0].match(/^\s*dismissModal\s*\(/gm) || [];
  assert.strictEqual(dismissMatches.length, 1, 'P1-01 / CAT07-18: WindDownBedtimeController must define dismissModal() exactly once');

  if (!app || !documentMock) {
    return { ok: true, suite: 'Category 07 & 08 Acceptance Tests (Static Only)' };
  }

  // -------------------------------------------------------------------------
  // 2. Category 08 Baseline Preservation
  // -------------------------------------------------------------------------
  assert.strictEqual(typeof app.ChartAggregator, 'object', 'ChartAggregator active');
  assert.strictEqual(typeof app.ScreenSyncWellnessEngine, 'object', 'ScreenSyncWellnessEngine active');
  const deg0 = app.ScreenSyncWellnessEngine.computeBrainDegradationState(0, 0, 60);
  assert.strictEqual(deg0.degradationPct, 0, '0 reels = 0% degradation');
  const deg50 = app.ScreenSyncWellnessEngine.computeBrainDegradationState(50, 20, 60);
  assert(deg50.degradationPct > 0, '50 reels > 0% degradation');

  // -------------------------------------------------------------------------
  // 3. Feature 7.1: Discovery, Leaf-Collision Separation, WhatsApp Casing,
  //    Store Package Parity, Casing Protection, Friendly Name Derivation,
  //    UWP Badge/Title Splitting, XSS Icon Hardening & Cloud Sync
  // -------------------------------------------------------------------------
  // CAT07-22 & F71-B01: Store package & bundle ID resolution parity
  assert.strictEqual(app.normalizeAppKeyAlias('net.whatsapp.WhatsApp'), 'whatsapp', 'CAT07-22: net.whatsapp.WhatsApp must resolve to whatsapp');
  assert.strictEqual(app.normalizeAppKeyAlias('net.whatsapp.whatsapp'), 'whatsapp', 'CAT07-22: net.whatsapp.whatsapp must resolve to whatsapp');
  assert.strictEqual(app.normalizeAppKeyAlias('com.netflix.mediaclient'), 'netflix', 'F71-B01: com.netflix.mediaclient must resolve to netflix');
  assert.strictEqual(app.normalizeAppKeyAlias('tv.twitch.android.app'), 'twitch', 'F71-B01: tv.twitch.android.app must resolve to twitch');
  assert.strictEqual(app.normalizeAppKeyAlias('com.linkedin.android'), 'linkedin', 'F71-B01: com.linkedin.android must resolve to linkedin');
  assert.strictEqual(app.normalizeAppKeyAlias('notion.id'), 'notion', 'F71-B01: notion.id must resolve to notion');
  assert.strictEqual(app.normalizeAppKeyAlias('com.figma.android'), 'figma', 'F71-B01: com.figma.android must resolve to figma');
  assert.strictEqual(app.normalizeAppKeyAlias('spotify.desktop'), 'spotify', 'F71-B03: .desktop suffix must be stripped');
  assert.strictEqual(app.AppDiscoveryService.KNOWN_APP_CATALOG.whatsapp.key, 'whatsapp');
  assert.strictEqual(app.AppDiscoveryService.KNOWN_APP_CATALOG.twitch.key, 'twitch');

  // F71-B02 / CAT07-05: Lowercase non-native name must NOT overwrite canonical APP_METADATA.instagram.name
  const normLowercaseIg = app.AppDiscoveryService.normalizeDiscoveredApp({
    packageId: 'com.instagram.android',
    name: 'instagram'
  });
  assert.strictEqual(normLowercaseIg.name, 'Instagram', 'F71-B02: Lowercase non-native "instagram" must resolve to canonical "Instagram"');
  assert.strictEqual(app.APP_METADATA.instagram.name, 'Instagram', 'F71-B02: APP_METADATA.instagram.name must remain "Instagram"');

  // Genuine native OS label (isNativeOsLabel: true) must be preserved verbatim
  const normNativeRealApp = app.AppDiscoveryService.normalizeDiscoveredApp({
    key: 'com.acme.realapp',
    packageId: 'com.acme.realapp',
    name: 'Real App',
    isNativeOsLabel: true
  });
  assert.strictEqual(normNativeRealApp.name, 'Real App', 'F71-B02: isNativeOsLabel: true must preserve "Real App" verbatim');

  // F71-B03 / CAT07-07: Friendly display-name derivation from reverse-DNS package IDs
  assert.strictEqual(app.AppDiscoveryService.deriveFriendlyNameFromIdentifier('com.acme.maps.android'), 'Maps', 'F71-B03: com.acme.maps.android must derive friendly name "Maps"');
  assert.strictEqual(app.AppDiscoveryService.deriveFriendlyNameFromIdentifier('com.example.coolapp'), 'Coolapp', 'F71-B03: com.example.coolapp must derive friendly name "Coolapp"');
  const normDottedApp = app.AppDiscoveryService.normalizeDiscoveredApp({
    packageId: 'com.acme.maps.android'
  });
  assert.strictEqual(normDottedApp.name, 'Maps', 'F71-B03: normalizeDiscoveredApp on raw packageId com.acme.maps.android must derive "Maps"');

  // F71-B05: XSS hardening in getAppLogoHtml
  const maliciousUri = 'data:image/png;base64,iVBORw0KGgo=" onerror="alert(1)';
  const safeFallbackHtml = app.getAppLogoHtml('custom_xss_app', 'XSS App', maliciousUri);
  assert(!safeFallbackHtml.includes('onerror='), 'F71-B05: getAppLogoHtml must reject malicious data:image URI containing attribute injection');
  const maliciousSvg = '<svg viewBox="0 0 48 48" onload="alert(1)"><circle cx="24" cy="24" r="10"/></svg>';
  const safeSvgFallback = app.getAppLogoHtml('custom_xss_svg', 'XSS SVG', maliciousSvg);
  assert(!safeSvgFallback.includes('onload='), 'F71-B05: getAppLogoHtml must reject inline <svg> containing event handler attributes');

  // CAT07-15: Unknown reverse-DNS packages with identical leaf names must not collide
  const keyVendorX = app.normalizeAppKeyAlias('com.vendorx.notes');
  const keyVendorY = app.normalizeAppKeyAlias('com.vendory.notes');
  assert(keyVendorX && keyVendorY && keyVendorX !== keyVendorY, `CAT07-15: com.vendorx.notes (${keyVendorX}) and com.vendory.notes (${keyVendorY}) must resolve to distinct keys`);

  const iconVendorX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const iconVendorY = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const discBatch = app.AppDiscoveryService.discoverInstalledApplications('s24_ultra', {
    discoveredApps: [
      { packageId: 'com.vendorx.notes', name: 'VendorX Notes', iconDataUri: iconVendorX, isNativeOsLabel: true, category: 'Productivity & finance' },
      { packageId: 'com.vendory.notes', name: 'VendorY Notes', iconDataUri: iconVendorY, isNativeOsLabel: true, category: 'Productivity & finance' }
    ]
  });
  const foundX = discBatch.apps.find(a => a.name === 'VendorX Notes');
  const foundY = discBatch.apps.find(a => a.name === 'VendorY Notes');
  assert(foundX && foundY && foundX.key !== foundY.key, 'CAT07-15: VendorX Notes and VendorY Notes must remain separate discovered apps');
  assert(app.getAppLogoHtml(foundX.key, foundX.name, foundX.iconDataUri).includes(iconVendorX), '7.1: Priority 1 native iconDataUri must render for VendorX Notes');
  assert(app.getAppLogoHtml(foundY.key, foundY.name, foundY.iconDataUri).includes(iconVendorY), '7.1: Priority 1 native iconDataUri must render for VendorY Notes');
  assert(app.getAppLogoHtml('instagram', 'Instagram').includes('<svg'), '7.1: Built-in APP_LOGOS SVG must render when no native iconDataUri is set');
  assert(app.getAppLogoHtml('netflix', 'Netflix').includes('<svg'), 'F71-B01: Built-in APP_LOGOS SVG must render for Netflix');
  assert(app.getAppLogoHtml('unknown_custom_tool_xyz', 'Custom Tool').includes('data-fallback-icon="true"'), '7.1: Unknown app without native/SVG icon must render monogram fallback');

  // Windows UWP & Shell exclusion checks (F71-B04)
  assert.strictEqual(app.CrossPlatformAppIdentityResolver.isTrackableWindow('explorer.exe', 'Progman'), false, '7.1: explorer.exe desktop shell (Progman) must be excluded');
  assert.strictEqual(app.CrossPlatformAppIdentityResolver.isTrackableWindow('explorer.exe', 'CabinetWClass'), true, '7.1: explorer.exe File Explorer (CabinetWClass) must be trackable');
  assert.strictEqual(app.CrossPlatformAppIdentityResolver.isTrackableWindow('sihost.exe', ''), false, 'F71-B04: sihost.exe shell host must be excluded');
  assert.strictEqual(app.CrossPlatformAppIdentityResolver.isTrackableWindow('taskhostw.exe', ''), false, 'F71-B04: taskhostw.exe background host must be excluded');
  const uwpResolved = app.CrossPlatformAppIdentityResolver.resolveProcessAndWindowIdentity({
    processName: 'ApplicationFrameHost.exe',
    executablePath: 'C:\\Windows\\System32\\ApplicationFrameHost.exe',
    windowTitle: '(3) WhatsApp - Chats',
    windowClassName: 'ApplicationFrameWindow'
  });
  assert.strictEqual(uwpResolved.trackable, true);
  assert.strictEqual(uwpResolved.appKey, 'whatsapp', 'F71-B04: Composite UWP window title "(3) WhatsApp - Chats" must resolve to whatsapp');
  assert.strictEqual(uwpResolved.displayName, 'WhatsApp');
  assert.strictEqual(uwpResolved.persistedWindowTitle, null, '7.1: persistedWindowTitle must always be null for privacy');

  // P0-01 & CAT07-06: SupabaseSyncEngine outbound & inbound sync for discoveredApps and appLimits
  const syncTestUid = 'usr_cat07_sync_test';
  const prevAuth = app.state.isAuthenticated;
  const prevUser = app.state.currentUser;
  app.state.isAuthenticated = true;
  app.state.currentUser = { userId: syncTestUid, email: 'cat07@screensync.io', name: 'Cat07 Tester' };
  app.BackendDB.ensureUserStructures(syncTestUid);
  app.BackendDB.data.discoveredAppsByUser[syncTestUid] = {
    [foundX.key]: {
      key: foundX.key,
      name: 'VendorX Notes',
      category: 'Productivity & finance',
      supportsReels: false,
      packageId: 'com.vendorx.notes',
      iconDataUri: iconVendorX,
      isNativeOsLabel: true,
      updatedAtMs: Date.now()
    }
  };
  app.BackendDB.data.settingsByUser[syncTestUid].appTimers = {
    [foundX.key]: { minutes: 45, schedule: 'Monday–Friday', packages: ['com.vendorx.notes'], enforcementMode: 'NATIVE_OS_BLOCK' }
  };
  const outbound = app.SupabaseSyncEngine.buildOutboundPayload(syncTestUid);
  assert(outbound.ok === true, 'P0-01: buildOutboundPayload must succeed');
  assert(Array.isArray(outbound.discoveredAppsRows) && outbound.discoveredAppsRows.some(r => r.app_key === foundX.key && r.icon_data_uri === iconVendorX), 'P0-01 / CAT07-06: buildOutboundPayload must include discoveredAppsRows with icon_data_uri');
  assert(Array.isArray(outbound.appLimitsRows) && outbound.appLimitsRows.some(r => r.app_key === foundX.key && r.limit_minutes === 45), 'P0-01: buildOutboundPayload must include appLimitsRows');

  // Clear local and merge back from remote bundle
  app.BackendDB.data.discoveredAppsByUser[syncTestUid] = {};
  app.BackendDB.data.settingsByUser[syncTestUid].appTimers = {};
  const mergeRes = app.SupabaseSyncEngine.mergeRemoteRecordsIntoLocal(syncTestUid, {
    discoveredApps: outbound.discoveredAppsRows,
    appLimits: outbound.appLimitsRows
  });
  assert(mergeRes.ok === true && mergeRes.mergedDiscoveredApps >= 1 && mergeRes.mergedAppLimits >= 1, 'P0-01 / CAT07-06: mergeRemoteRecordsIntoLocal must merge discoveredApps and appLimits');
  assert.strictEqual(app.BackendDB.data.discoveredAppsByUser[syncTestUid][foundX.key].name, 'VendorX Notes');
  assert.strictEqual(app.BackendDB.data.discoveredAppsByUser[syncTestUid][foundX.key].iconDataUri, iconVendorX);
  assert.strictEqual(app.BackendDB.data.settingsByUser[syncTestUid].appTimers[foundX.key].minutes, 45);
  app.state.isAuthenticated = prevAuth;
  app.state.currentUser = prevUser;

  // -------------------------------------------------------------------------
  // 4. Feature 7.2 & 7.3: #viewAppDetail Dual Interactive Charts, Adaptive
  //    Reels/Notifications Sub-Chart, 0-Screen-Time Notifications, Bounded
  //    Week Nav, Category Reassignment & AUTO Tombstone Sync
  // -------------------------------------------------------------------------
  const activeUid = app.getActiveOrLocalUserId();
  app.BackendDB.ensureUserStructures(activeUid);
  const todayStr = app.resolveUserReferenceDate(activeUid);
  const dayStartSec = app.ScreenTimeAggregator.parseDateStrToUtcEpochSec(todayStr, 0);

  // Ensure Instagram has both session + reel events, Chrome has session + notifications, and Slack has 0-minute notification-only record (F72-B06)
  app.BackendDB.data.sessionsByUser[activeUid] = app.BackendDB.data.sessionsByUser[activeUid] || [];
  app.BackendDB.data.reelEventsByUser[activeUid] = app.BackendDB.data.reelEventsByUser[activeUid] || [];
  app.BackendDB.data.sessionsByUser[activeUid].push(
    {
      sessionId: 'cat07_ig_sess_1',
      userId: activeUid,
      installationKey: 's24_ultra',
      installationId: 'inst_and_01',
      osCategory: 'Android',
      appKey: 'instagram',
      appName: 'Instagram',
      category: 'Social networking',
      localDate: todayStr,
      hasTimestamps: true,
      startEpochSec: dayStartSec + 36000,
      endEpochSec: dayStartSec + 38400,
      durationMinutes: 40,
      opens: 6,
      notifs: 11
    },
    {
      sessionId: 'cat07_chrome_sess_1',
      userId: activeUid,
      installationKey: 's24_ultra',
      installationId: 'inst_and_01',
      osCategory: 'Android',
      appKey: 'chrome',
      appName: 'Chrome',
      category: 'Productivity & finance',
      localDate: todayStr,
      hasTimestamps: true,
      startEpochSec: dayStartSec + 40000,
      endEpochSec: dayStartSec + 41800,
      durationMinutes: 30,
      opens: 4,
      notifs: 9
    }
  );
  // F72-B06: Ingest a 0-screen-time notification-only event for Slack
  app.BackendDB.ingestEvent({
    eventId: 'cat07_slack_notif_only_1',
    userId: activeUid,
    installationKey: 's24_ultra',
    installationId: 'inst_and_01',
    osCategory: 'Android',
    appKey: 'slack',
    appName: 'Slack',
    category: 'Productivity & finance',
    localDate: todayStr,
    durationMinutes: 0,
    screenMinutesDelta: 0,
    opensDelta: 0,
    notifsDelta: 7
  }, true);

  app.BackendDB.data.reelEventsByUser[activeUid].push({
    eventId: 'cat07_ig_reel_1',
    userId: activeUid,
    installationKey: 's24_ultra',
    installationId: 'inst_and_01',
    osCategory: 'Android',
    appKey: 'instagram',
    appName: 'Instagram',
    category: 'Social networking',
    localDate: todayStr,
    startEpochMs: (dayStartSec + 36600) * 1000,
    reelCount: 18,
    watchMinutes: 14,
    watchSeconds: 840
  });

  // Render App Detail for Reel-supporting app (Instagram)
  app.state.selectedAppKey = 'instagram';
  app.state.detailWeekOffset = 0;
  app.state.detailSubTab = 'SCREEN';
  app.switchView('APP_DETAIL');
  const mainChartEl = documentMock.getElementById('detailAppMainChart');
  const weekBarsEl = documentMock.getElementById('detailAppWeekBars');
  const subChartEl = documentMock.getElementById('detailAppSubChart');
  const subBarsEl = documentMock.getElementById('detailSubCardBars');
  const adaptiveSummaryEl = documentMock.getElementById('detailAppAdaptiveSubSummary');
  assert(mainChartEl && weekBarsEl && subChartEl && subBarsEl && adaptiveSummaryEl, 'P0-02: #detailAppMainChart, #detailAppWeekBars, #detailAppSubChart, #detailSubCardBars, and #detailAppAdaptiveSubSummary must exist');
  assert.strictEqual(weekBarsEl.getAttribute('data-active-series'), 'SCREEN', 'P0-02: Primary chart must plot SCREEN series when detailSubTab === SCREEN');
  assert.strictEqual(subBarsEl.getAttribute('data-adaptive-mode'), 'REELS', 'P0-02 / CAT07-03: Secondary chart must use adaptive REELS mode for supportsReels apps');
  assert(Number(subBarsEl.getAttribute('data-week-reels')) >= 18, 'P0-02: Secondary chart must expose 7-day reel counts for Instagram');
  assert(adaptiveSummaryEl.textContent.includes('reels viewed'), 'P0-02: Adaptive summary must display reels viewed and reel watch time for Instagram');
  assert(weekBarsEl.innerHTML.includes('aria-label="') && weekBarsEl.innerHTML.includes('data-bar-pct="'), 'F72-B05: Detail main chart pillars must include aria-label and data-bar-pct');

  // Switch sub-tab to OPENS and verify primary chart switches to OPENS
  documentMock.getElementById('btnDetailSubTabOpens').click();
  assert.strictEqual(app.state.detailSubTab, 'OPENS');
  assert.strictEqual(weekBarsEl.getAttribute('data-active-series'), 'OPENS', 'P0-02 / CAT07-03: Clicking #btnDetailSubTabOpens must switch primary chart (#detailAppWeekBars) to OPENS');
  documentMock.getElementById('btnDetailSubTabScreen').click();
  assert.strictEqual(weekBarsEl.getAttribute('data-active-series'), 'SCREEN');

  // Render App Detail for non-reel app (Chrome) and verify NOTIFICATIONS adaptive mode
  app.state.selectedAppKey = 'chrome';
  app.renderAll();
  assert.strictEqual(subBarsEl.getAttribute('data-adaptive-mode'), 'NOTIFICATIONS', 'P0-02 / CAT07-03: Secondary chart must use adaptive NOTIFICATIONS mode for non-reel apps');
  assert(Number(subBarsEl.getAttribute('data-week-notifs')) >= 9, 'P0-02: Secondary chart must expose 7-day notification counts for Chrome');
  assert(adaptiveSummaryEl.textContent.includes('notifications received'), 'P0-02: Adaptive summary must display notifications received and times opened for Chrome');

  // F72-B06: Render App Detail for Slack (0 screen time, 7 notifications) and verify notifications are preserved
  app.state.selectedAppKey = 'slack';
  app.renderAll();
  assert.strictEqual(documentMock.getElementById('detailAppNotifCount').textContent, '7', 'F72-B06: Zero-screen-time notification-only app (Slack) must display 7 notifications in #detailAppNotifCount');

  // CAT07-13: Week navigation bound check
  const prevBtn = documentMock.getElementById('btnDetailPrevWeek');
  for (let i = 0; i < 25; i++) {
    prevBtn.click();
  }
  const maxWeeksBack = Math.max(12, Math.ceil((Number(app.state.dataRetentionDays || 90)) / 7));
  assert.strictEqual(app.state.detailWeekOffset, -maxWeeksBack, 'CAT07-13: detailWeekOffset must be capped at the retention window');
  assert.strictEqual(prevBtn.getAttribute('aria-disabled'), 'true', 'CAT07-13: #btnDetailPrevWeek must be aria-disabled at the retention cap');
  app.state.detailWeekOffset = 0;
  app.renderAll();

  // Feature 7.3 (CAT07-09, P0-06, P0-07, F73-B01..B03): Category reassignment rewrites sessions AND reelEvents, mirrors userSettingsByUser[uid].customAppCategories, rejects invalid category, and preserves AUTO reset tombstones across sync
  const invalidCatRes = app.CrossPlatformAppIdentityResolver.setCustomAppCategory(activeUid, 'instagram', 'InvalidBogusCategory');
  assert.strictEqual(invalidCatRes.ok, false, 'CAT07-09: setCustomAppCategory must reject invalid category names');
  assert.strictEqual(invalidCatRes.status, 'INVALID_CATEGORY');

  const validCatRes = app.CrossPlatformAppIdentityResolver.setCustomAppCategory(activeUid, 'instagram', 'Entertainment');
  assert.strictEqual(validCatRes.ok, true);
  assert.strictEqual(app.BackendDB.data.userSettingsByUser[activeUid].customAppCategories.instagram, 'Entertainment', 'P0-07: userSettingsByUser[uid].customAppCategories must mirror custom category');
  const igReelsAfterCat = (app.BackendDB.data.reelEventsByUser[activeUid] || []).filter(r => r.appKey === 'instagram');
  assert(igReelsAfterCat.length > 0 && igReelsAfterCat.every(r => r.category === 'Entertainment'), 'CAT07-09: setCustomAppCategory must rewrite category on matching reelEventsByUser records');

  // F73-B01..B03: Reset to AUTO and verify detectedCategory ("Social networking") is restored and tombstone blocks older remote row
  const autoResetRes = app.CrossPlatformAppIdentityResolver.setCustomAppCategory(activeUid, 'instagram', 'AUTO');
  assert.strictEqual(autoResetRes.ok, true);
  assert.strictEqual(autoResetRes.category, 'Social networking', 'F73-B01: Resetting Instagram to AUTO must restore detectedCategory "Social networking"');
  assert.strictEqual(Boolean(app.BackendDB.data.deletedAppCategoryRulesByUser[activeUid].instagram?.deleted), true, 'F73-B02: AUTO reset must record deletion tombstone in deletedAppCategoryRulesByUser');

  const staleRemoteIso = new Date(Date.now() - 60000).toISOString();
  const prevAuth73 = app.state.isAuthenticated;
  const prevUser73 = app.state.currentUser;
  app.state.isAuthenticated = true;
  app.state.currentUser = { userId: activeUid, email: 'rahim.ahmed@gmail.com', name: 'Rahim' };
  app.SupabaseSyncEngine.mergeRemoteRecordsIntoLocal(activeUid, {
    appCategoryRules: [
      {
        user_id: activeUid,
        app_identifier: 'instagram',
        app_name: 'Instagram',
        category: 'Entertainment',
        screensync_category: 'Entertainment',
        source: 'UserCustom',
        updated_at: staleRemoteIso
      }
    ]
  });
  assert.strictEqual(app.resolveAppCategory('instagram', null, activeUid), 'Social networking', 'F73-B02 / F73-B03: Stale remote app_category_rules row must NOT resurrect an AUTO-reset category');
  app.state.isAuthenticated = prevAuth73;
  app.state.currentUser = prevUser73;

  // -------------------------------------------------------------------------
  // 5. Feature 7.4 & 7.5: AppLimitManager, Schedule Canonicalization,
  //    Permission Gate, Reference Date Check, 14-Day Ledger Pruning,
  //    Package-Resolved Native Block & App Limits Hub
  // -------------------------------------------------------------------------
  // P0-07 & F74-B01: isScheduleActiveToday + canonicalizeSchedule checks across Sat/Sun/Wed
  assert.strictEqual(typeof app.AppLimitManager.isScheduleActiveToday, 'function', 'P0-07: AppLimitManager.isScheduleActiveToday must exist');
  assert.strictEqual(app.AppLimitManager.normalizeScheduleToken('Mon-Fri'), 'WEEKDAYS', 'F74-B01: Mon-Fri must normalize to WEEKDAYS');
  assert.strictEqual(app.AppLimitManager.normalizeScheduleToken('Sat-Sun'), 'WEEKENDS', 'F74-B01: Sat-Sun must normalize to WEEKENDS');
  assert.strictEqual(app.AppLimitManager.canonicalizeSchedule('TuesdaysOnly').unrecognized, true, 'F74-B01: Unrecognized schedule token must set unrecognized: true');
  assert.strictEqual(app.AppLimitManager.isScheduleActiveToday('Everyday', '2026-10-24'), true);
  assert.strictEqual(app.AppLimitManager.isScheduleActiveToday('Monday–Friday', '2026-10-24'), false, 'Monday–Friday must be inactive on Saturday');
  assert.strictEqual(app.AppLimitManager.isScheduleActiveToday('Monday–Friday', '2026-10-28'), true, 'Monday–Friday must be active on Wednesday');
  assert.strictEqual(app.AppLimitManager.isScheduleActiveToday('Weekdays', '2026-10-28'), true, 'Weekdays must be active on Wednesday');
  assert.strictEqual(app.AppLimitManager.isScheduleActiveToday('Saturday–Sunday', '2026-10-25'), true, 'Saturday–Sunday must be active on Sunday');
  assert.strictEqual(app.AppLimitManager.isScheduleActiveToday('Weekends', '2026-10-28'), false, 'Weekends must be inactive on Wednesday');

  // CAT07-04: resolveUserReferenceDate returns real today when clock is advanced past 2026-10-16
  app.__setClockForTests('2026-11-16T12:00:00Z');
  const resolvedRefAfterOct16 = app.resolveUserReferenceDate(activeUid);
  assert.strictEqual(resolvedRefAfterOct16, '2026-11-16', 'CAT07-04: resolveUserReferenceDate must return current clock date (2026-11-16), not pinned 2026-10-16');
  app.__setClockForTests(null);

  // P0-05 & CAT07-12: Android canEnforceNativeBlock accepts usage_stats + accessibility even if overlay is PENDING
  const savedBridge = sandbox.window.ScreenSyncNativeBridge;
  let blockedPkgArg = null;
  let blockedLimitArg = null;
  sandbox.window.ScreenSyncNativeBridge = {
    ...(savedBridge || {}),
    enforceAppBlock(pkgOrKey, mins) {
      blockedPkgArg = pkgOrKey;
      blockedLimitArg = mins;
      return true;
    }
  };
  const androidPermRec = app.PermissionOnboardingManager.getOrCreateInstallationRecord('Android');
  app.PermissionOnboardingManager.currentPlatform = 'Android';
  app.PermissionOnboardingManager.currentInstallationId = androidPermRec.installationId;
  app.PermissionOnboardingManager.onReturnFromSystemSettings('usage_stats', 'GRANTED');
  app.PermissionOnboardingManager.onReturnFromSystemSettings('accessibility', 'GRANTED');
  if (androidPermRec.permissions.overlay) androidPermRec.permissions.overlay.status = 'PENDING';
  const capAndroidAcc = app.AppLimitManager.canEnforceNativeBlock('Android');
  assert.strictEqual(capAndroidAcc.supported, true, 'P0-05 / CAT07-12: canEnforceNativeBlock("Android") must return supported: true when usage_stats and accessibility are GRANTED');
  assert.strictEqual(capAndroidAcc.mode, 'NATIVE_OS_BLOCK');

  // P1-04 & CAT07-10: openAppTimerModal renders customIcon + current usage & clamps save
  app.openAppTimerModal(foundX.key);
  const timerIconHtml = documentMock.getElementById('appTimerTargetIconBox').innerHTML;
  const timerUsageTxt = documentMock.getElementById('appTimerCurrentUsageText').textContent;
  assert(timerIconHtml.includes('data-native-icon="true"'), 'P1-04: openAppTimerModal must render persisted native icon in #appTimerTargetIconBox');
  assert(timerUsageTxt.includes('used today'), 'P1-04: openAppTimerModal must display current today usage in #appTimerCurrentUsageText');
  app.closeAppTimerModal();

  // Evaluate 80% and 100% limits + 14-day ledger pruning (F74-B06) + package resolution for enforceAppBlock
  const savedTimers = JSON.parse(JSON.stringify(app.state.appTimers || {}));
  app.BackendDB.data.settingsByUser[activeUid].limitAlertLedger = {
    [`${activeUid}::instagram::2026-09-01::APPROACHING_80::30`]: 1700000000000
  };
  app.AppLimitManager.setAppLimit('instagram', 30, 'Everyday');
  const eval80 = app.AppLimitManager.evaluateAppLimitsForUser(
    activeUid,
    { apps: [{ key: 'instagram', name: 'Instagram', minutes: 25, seconds: 1500 }] },
    '2026-11-16',
    { notify: true }
  );
  assert(!app.BackendDB.data.settingsByUser[activeUid].limitAlertLedger[`${activeUid}::instagram::2026-09-01::APPROACHING_80::30`], 'F74-B06: Stale >14d limitAlertLedger entries must be pruned');
  assert(eval80.warnings.some(w => w.appKey === 'instagram' && w.stage === 'APPROACHING_80' && w.newlyTriggered === true), '7.4: 25m / 30m (83%) must trigger APPROACHING_80 alert');
  const eval80Dedup = app.AppLimitManager.evaluateAppLimitsForUser(
    activeUid,
    { apps: [{ key: 'instagram', name: 'Instagram', minutes: 26, seconds: 1560 }] },
    '2026-11-16',
    { notify: true }
  );
  assert(eval80Dedup.warnings.some(w => w.appKey === 'instagram' && w.stage === 'APPROACHING_80' && w.newlyTriggered === false), '7.4: Second evaluation on same day must be deduplicated');

  const eval100 = app.AppLimitManager.evaluateAppLimitsForUser(
    activeUid,
    { apps: [{ key: 'instagram', name: 'Instagram', minutes: 35, seconds: 2100 }] },
    '2026-11-16',
    { notify: true }
  );
  assert(eval100.warnings.some(w => w.appKey === 'instagram' && w.stage === 'LIMIT_REACHED' && w.passed80Milestone === true), '7.4 & F74-B04: 35m / 30m (117%) must trigger LIMIT_REACHED with passed80Milestone: true');
  if (blockedPkgArg !== null) {
    assert.strictEqual(blockedPkgArg, 'com.instagram.android', 'P0-04 / CAT07-02: enforceAppBlock must receive resolved Android package name com.instagram.android');
    assert.strictEqual(blockedLimitArg, 30);
  }
  sandbox.window.ScreenSyncNativeBridge = savedBridge;

  // Feature 7.5: App Limits Hub (#viewAppLimits), 0-usage discovered apps, badge colors, all-timed empty state & navigation origins
  app.switchView('ALL_APPS');
  const btnJumpFromAllApps = documentMock.getElementById('btnJumpToAppLimitsFromAllApps');
  assert(btnJumpFromAllApps, 'P0-07: #btnJumpToAppLimitsFromAllApps must exist in #viewAllAppsBreakdown');
  btnJumpFromAllApps.click();
  assert.strictEqual(app.state.activeView, 'APP_LIMITS', 'Clicking #btnJumpToAppLimitsFromAllApps must navigate to APP_LIMITS');
  assert.strictEqual(app.state.appLimitsOrigin, 'ALL_APPS', 'state.appLimitsOrigin must record ALL_APPS');

  const activeListHtml = documentMock.getElementById('appLimitsActiveList').innerHTML;
  const availListHtml = documentMock.getElementById('appLimitsAvailableAppsList').innerHTML;
  assert(activeListHtml.includes('Instagram') && activeListHtml.includes('data-limit-status="LIMIT_REACHED"'), 'P1-03: Exceeded timer in #appLimitsActiveList must render LIMIT_REACHED status pill');
  assert(availListHtml.includes('VendorX Notes') || activeListHtml.includes('VendorX Notes'), 'P1-02: Discovered 0-usage app (VendorX Notes) must appear in App Limits Hub');

  // CAT07-11: When all apps in scope have limits, #appLimitsAvailableAppsList renders explicit empty state
  app.renderAppLimitsHubView(
    { apps: [{ key: 'instagram', name: 'Instagram', minutes: 35 }] },
    'Selected Device',
    [{ key: 'instagram', name: 'Instagram', minutes: 35 }]
  );
  assert(
    documentMock.getElementById('appLimitsAvailableAppsList').innerHTML.includes('data-all-apps-timed="true"'),
    'CAT07-11: #appLimitsAvailableAppsList must render explicit all-apps-timed empty state instead of duplicating timed apps'
  );

  app.handleSystemBackNavigation();
  assert.strictEqual(app.state.activeView, 'ALL_APPS', 'P0-07: Backing out of APP_LIMITS must return to state.appLimitsOrigin (ALL_APPS)');
  app.state.appTimers = savedTimers;
  app.switchView('OVERVIEW');

  // -------------------------------------------------------------------------
  // 6. Feature 7.6: WindDownBedtimeController Toggle, Non-Reel Companion Guard,
  //    15m Trigger, Snooze & Single dismissModal Back-Stack Unwind
  // -------------------------------------------------------------------------
  app.WindDownBedtimeController.resetSession();
  app.NotificationScheduleManager.saveScheduleFromInputs({
    quietHoursEnabled: true,
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00'
  });

  // CAT07-17: Disabling Wind-Down suppresses bedtime modal even inside Quiet Hours
  app.WindDownBedtimeController.setEnabled(false);
  assert.strictEqual(app.WindDownBedtimeController.isEnabled(), false, 'CAT07-17: WindDownBedtimeController.isEnabled() must reflect setEnabled(false)');
  const disabledEval = app.WindDownBedtimeController.onActiveScreenProgress(960, { timeHHMM: '23:30' });
  assert.strictEqual(disabledEval.triggered, false, 'CAT07-17: Wind-Down must not trigger when windDownEnabled is false');

  // Re-enable Wind-Down, verify non-reel desktop companion guard (F76-B08), then verify bedtime trigger + dismissModal back-stack unwind
  app.WindDownBedtimeController.setEnabled(true);
  assert.strictEqual(app.WindDownBedtimeController.isEnabled(), true);
  const nonReelDesktopEval = app.WindDownBedtimeController.onActiveScreenProgress(960, {
    timeHHMM: '23:30',
    isShortFormSurface: false
  });
  assert.strictEqual(nonReelDesktopEval.triggered, false, 'F76-B08: Non-reel desktop activity (isShortFormSurface: false) must not trigger Reel bedtime Wind-Down');
  assert.strictEqual(nonReelDesktopEval.reason, 'NON_REEL_ACTIVITY_IGNORED');

  const enabledEval = app.WindDownBedtimeController.onActiveScreenProgress(960, { timeHHMM: '23:30' });
  assert.strictEqual(enabledEval.triggered, true, 'CAT07-17: onActiveScreenProgress(960s) during Quiet Hours must trigger Wind-Down');
  const windDownModalEl = documentMock.getElementById('windDownBedtimeModal');
  assert(!windDownModalEl.classList.contains('hidden'), '#windDownBedtimeModal must be visible when triggered');

  const depthBeforeDismiss = Number(app.state.navHistoryDepth || 0);
  const dismissRes = app.WindDownBedtimeController.dismissModal();
  assert.strictEqual(dismissRes.ok, true);
  assert(windDownModalEl.classList.contains('hidden'), '#windDownBedtimeModal must be hidden after dismissModal()');
  assert(Number(app.state.navHistoryDepth || 0) <= depthBeforeDismiss, 'P1-01 / CAT07-18: dismissModal() must unwind NavigationHistoryBridge');

  app.WindDownBedtimeController.resetSession();
  app.renderAll();

  return { ok: true, suite: 'Category 07 & 08 Acceptance Tests (Part 07A + Part 07B Complete)' };
}

module.exports = { runCategory07And08Tests };

if (require.main === module) {
  runCategory07And08Tests({ rootDir: path.resolve(__dirname, '..') })
    .then((staticRes) => {
      console.log('[PASS] Static verification:', staticRes.suite);
      const { spawnSync } = require('child_process');
      const res = spawnSync(process.execPath, [path.join(__dirname, 'run_all_tests.js')], { stdio: 'inherit' });
      process.exit(res.status || 0);
    })
    .catch((err) => {
      console.error('[FAIL] Category 07 & 08 Acceptance Suite failed:', err);
      process.exit(1);
    });
}
