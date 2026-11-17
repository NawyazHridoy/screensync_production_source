'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function runCategory13And14Tests({ app, documentMock, windowMock, sandbox, html, rootDir }) {
  // 1. Verify 6-Document Context Architecture (/docs) & Root GEMINI.md
  const requiredDocs = [
    'docs/01_PRD.md',
    'docs/02_AppFlow.md',
    'docs/03_UI_Spec.md',
    'docs/04_TRD.md',
    'docs/05_Schema.md',
    'docs/06_Plan.md',
    'GEMINI.md'
  ];
  for (const relDoc of requiredDocs) {
    const fullDoc = path.join(rootDir, relDoc);
    assert(fs.existsSync(fullDoc) && fs.statSync(fullDoc).size > 200, `Missing or empty Context Architecture file: ${relDoc}`);
  }

  // 2. Verify Bug 1: #viewPrivacyComplianceWindow is a standalone top-level <section> (NOT nested inside #viewAccount)
  assert(
    /<section[^>]+id="viewPrivacyComplianceWindow"/i.test(html),
    'Bug 1: #viewPrivacyComplianceWindow must be a top-level <section> element'
  );
  const viewAccountMatch = html.match(/<section[^>]+id="viewAccount"[\s\S]*?<\/section>/i);
  assert(
    viewAccountMatch && !viewAccountMatch[0].includes('id="viewPrivacyComplianceWindow"'),
    'Bug 1: #viewPrivacyComplianceWindow must NOT be nested inside #viewAccount'
  );
  app.switchView('ACCOUNT');
  sandbox.document.getElementById('btnAccountPrivacyComplianceRow').click();
  assert.strictEqual(app.state.activeView, 'PRIVACY_COMPLIANCE', 'Bug 1: Tapping #btnAccountPrivacyComplianceRow must navigate to PRIVACY_COMPLIANCE standalone window');
  assert(sandbox.document.getElementById('viewAccount').classList.contains('hidden'), 'Bug 1: #viewAccount must be hidden when PRIVACY_COMPLIANCE window is open');
  assert(!sandbox.document.getElementById('viewPrivacyComplianceWindow').classList.contains('hidden'), 'Bug 1: #viewPrivacyComplianceWindow must be visible');
  sandbox.document.getElementById('btnClosePrivacyComplianceWindow').click();
  assert.strictEqual(app.state.activeView, 'ACCOUNT', 'Bug 1: Closing PRIVACY_COMPLIANCE window must return to ACCOUNT');

  // 3. Verify Bug 2: Mandatory Password Verification for Account Deletion
  const unverifiedAttempt = app.StoreComplianceAndPrivacyManager.deleteAccountAndAllData('usr_test_guard', { reason: 'DIRECT_UNVERIFIED_CALL' });
  assert.strictEqual(unverifiedAttempt.ok, false, 'Bug 2: deleteAccountAndAllData without passwordVerified: true must fail');
  assert.strictEqual(unverifiedAttempt.status, 'PASSWORD_VERIFICATION_REQUIRED', 'Bug 2: Must return PASSWORD_VERIFICATION_REQUIRED');

  // Verify permissive 6-char fallback is removed when userRecord has a real passwordHash
  const testUid = 'usr_bug2_sec_01';
  const testEmail = 'sec_bug2@example.com';
  const testPass = 'ValidPass#2026!';
  const testHash = app.AuthService.hashPassword(testPass);
  app.BackendDB.data.users.push({
    userId: testUid,
    name: 'Sec User',
    email: testEmail,
    passwordHash: testHash,
    verified: true
  });
  app.BackendDB.ensureUserStructures(testUid);
  app.state.isAuthenticated = true;
  app.state.currentUser = { userId: testUid, name: 'Sec User', email: testEmail, passwordHash: testHash };

  app.StoreComplianceAndPrivacyManager.openPrivacyComplianceWindow();
  sandbox.document.getElementById('btnDeleteAccountAndAllData').click();
  const pwdModal = sandbox.document.getElementById('deleteAccountPasswordConfirmModal');
  assert(!pwdModal.classList.contains('hidden'), 'Bug 2: Clicking #btnDeleteAccountAndAllData must ONLY open #deleteAccountPasswordConfirmModal');
  assert(Boolean(app.BackendDB.data.sessionsByUser[testUid]), 'Bug 2: Clicking #btnDeleteAccountAndAllData must NOT immediately delete account data');

  // Wrong password rejected
  const wrongRes = app.StoreComplianceAndPrivacyManager.executeVerifiedAccountDeletion('WrongPass123!');
  assert.strictEqual(wrongRes.ok, false, 'Bug 2: Wrong password must be rejected');
  assert.strictEqual(wrongRes.status, 'INVALID_PASSWORD', 'Bug 2: Wrong password must return INVALID_PASSWORD');

  // Correct password verified & deletes account
  const rightRes = app.StoreComplianceAndPrivacyManager.executeVerifiedAccountDeletion(testPass);
  assert.strictEqual(rightRes.ok, true, 'Bug 2: Matching account email + password must execute deletion');
  assert(!app.BackendDB.data.sessionsByUser[testUid], 'Bug 2: User sessions purged after verified password deletion');

  // 4. Verify Bug 3: Goals & Focus (#btnAccountGoalsFocusRow) jumps directly to Focus page (#viewFocus)
  app.switchView('ACCOUNT');
  sandbox.document.getElementById('btnAccountGoalsFocusRow').click();
  assert.strictEqual(app.state.activeView, 'FOCUS', 'Bug 3: Tapping #btnAccountGoalsFocusRow must navigate directly to FOCUS');
  assert(sandbox.document.getElementById('accountGoalsQuickDrawer').classList.contains('hidden'), 'Bug 3: #accountGoalsQuickDrawer must remain hidden');

  // 5. Verify Bug 4: Notification Settings (#viewNotificationSettingsWindow) is a standalone top-level <section>
  assert(
    /<section[^>]+id="viewNotificationSettingsWindow"/i.test(html) &&
    !viewAccountMatch[0].includes('id="viewNotificationSettingsWindow"'),
    'Bug 4: #viewNotificationSettingsWindow must be a top-level <section> outside #viewAccount'
  );
  app.switchView('ACCOUNT');
  sandbox.document.getElementById('btnAccountNotificationsRow').click();
  assert.strictEqual(app.state.activeView, 'NOTIFICATION_SETTINGS', 'Bug 4: Tapping #btnAccountNotificationsRow must switch view to NOTIFICATION_SETTINGS');
  assert(sandbox.document.getElementById('viewAccount').classList.contains('hidden'), 'Bug 4: #viewAccount must be hidden when NOTIFICATION_SETTINGS is open');
  assert(!sandbox.document.getElementById('viewNotificationSettingsWindow').classList.contains('hidden'), 'Bug 4: #viewNotificationSettingsWindow must be visible');
  sandbox.document.getElementById('btnCloseNotificationSettingsWindow').click();
  assert.strictEqual(app.state.activeView, 'ACCOUNT', 'Bug 4: Clicking #btnCloseNotificationSettingsWindow must return to ACCOUNT');

  // 6. Verify Bug 5: Phone-Mode Cross-Device Guide "Help & Support" Pill Alignment
  const guideBadge = sandbox.document.getElementById('crossDeviceGuideHelpBadge');
  assert(
    guideBadge &&
    guideBadge.className.includes('whitespace-nowrap') &&
    guideBadge.className.includes('shrink-0') &&
    guideBadge.className.includes('inline-flex'),
    'Bug 5: #crossDeviceGuideHelpBadge must have inline-flex, whitespace-nowrap, and shrink-0'
  );

  // 7. Verify Bug 6: Account Sub-Section Auto-Collapse on Scroll
  app.switchView('ACCOUNT');
  const exportDrw = sandbox.document.getElementById('accountDataExportDrawer');
  const exportChv = sandbox.document.getElementById('accountExportChevron');
  sandbox.document.getElementById('btnAccountDataExportRow').click();
  assert(!exportDrw.classList.contains('hidden') && exportChv.classList.contains('rotate-90'), 'Bug 6: #accountDataExportDrawer opens with rotated chevron');
  if (typeof sandbox.window.__ssAccountScrollCheck === 'function') {
    sandbox.window.__ssAccountScrollCheck({ target: { scrollTop: 420 } });
  }
  assert(exportDrw.classList.contains('hidden') && !exportChv.classList.contains('rotate-90'), 'Bug 6: Scrolling past threshold auto-collapses open Account sub-section and resets chevron');

  // 8. Verify Bug 7: 5 Equal-Sized Adaptive Reference Logos + Preserved Account Brain Icon
  assert(app.ScreenSyncAdaptiveLogoRegistry, 'Bug 7: ScreenSyncAdaptiveLogoRegistry must exist');
  const logoChecks = [
    ['bottomNavOverview', '1793448648259.jpg'],
    ['bottomNavStats', '1793448759761.jpg'],
    ['bottomNavFocus', '1793448924228.jpg'],
    ['bottomNavAccount', '1793448352426.jpg'],
    ['btnFocusSubTimer', '1793448924228.jpg'],
    ['btnFocusSubStats', '1793447318715.jpg']
  ];
  for (const [btnId, expectedRef] of logoChecks) {
    const btnEl = sandbox.document.getElementById(btnId);
    assert(
      btnEl &&
      btnEl.innerHTML.includes('ss-adaptive-ui-icon') &&
      btnEl.innerHTML.includes(expectedRef) &&
      btnEl.innerHTML.includes('sr-only'),
      `Bug 7: #${btnId} must render adaptive equal-sized logo ${expectedRef} with .sr-only label`
    );
  }
  const accBrainIcon = sandbox.document.getElementById('accountBrainRowLiveMiniIcon');
  assert(
    accBrainIcon && !accBrainIcon.innerHTML.includes('ss-adaptive-ui-icon'),
    'Bug 7 Constraint: #accountBrainRowLiveMiniIcon must NOT be replaced by ScreenSyncAdaptiveLogoRegistry'
  );

  // 9. Verify Pass 3 Wishlist & Real UX Feedback Suite (Items 1-7)
  const sunRes = app.WeeklyBehavioralReportCardEngine.openSundayReportDigest();
  assert(sunRes && sunRes.ok && sunRes.report && typeof sunRes.report.focusToReelRatio === 'number', 'Wishlist #1: openSundayReportDigest must compute report card');

  const widRes = app.LockScreenWidgetBridge.pinToLockScreen();
  assert(
    widRes && widRes.ok && widRes.pinned &&
    widRes.payload && widRes.payload.headline.includes('Today • All Devices') &&
    sandbox.document.getElementById('lockScreenWidgetPreviewCard'),
    'Wishlist #2: LockScreenWidgetBridge and #lockScreenWidgetPreviewCard must sync unified daily Reel Count'
  );

  const formulaHint = sandbox.document.getElementById('brainScoreAuthoritativeFormulaHint');
  const formulaPop = sandbox.document.getElementById('brainFormulaBreakdownPopover');
  assert(
    formulaHint && formulaPop && formulaHint.textContent.includes('⚡ 3h velocity · session depth · context switches'),
    'UX Feedback #3: #brainScoreAuthoritativeFormulaHint must render 1-line authoritative formula pill with popover'
  );

  const pulseRes = app.GoalPickerController.triggerCelebratoryGoalPulse('SCREEN');
  assert(
    pulseRes && pulseRes.ok &&
    sandbox.document.getElementById('goalProgressBarFill').classList.contains('ss-goal-bar-shimmer') &&
    sandbox.document.getElementById('goalLockedInCelebrationBadge').textContent.includes('Goal Locked In ✨'),
    'UX Feedback #2: Goal save must trigger .ss-goal-locked-pulse, .ss-goal-bar-shimmer, and Goal Locked In ✨ badge'
  );

  app.state.focusCountdownActive = true;
  const tampRes = app.ExtensionHeartbeatTamperGuard.simulateHeartbeatDrop('EXTENSION_HEARTBEAT_DROPPED');
  assert(
    tampRes.tamperDetected === true &&
    !sandbox.document.getElementById('extensionTamperGuardBanner').classList.contains('hidden'),
    'UX Feedback #4: ExtensionHeartbeatTamperGuard must surface #extensionTamperGuardBanner when heartbeat drops during active limit/focus'
  );
  app.ExtensionHeartbeatTamperGuard.restoreHook();
  app.state.focusCountdownActive = false;


  // 10. Verify Pass 3 Part A: 12-Preset Splash Motion Studio, Pure Launch Splash, Compact 76x86 Logo & Nanosecond-Smooth Quantum Vortex (Items 1-10)
  assert(app.ScreenSyncSplashMotionEngine, 'Pass 3 Part A: ScreenSyncSplashMotionEngine must exist');
  assert.strictEqual(app.ScreenSyncSplashMotionEngine.PRESETS.length, 12, 'Pass 3 Part A: Must integrate all 12 splash animations');
  assert.strictEqual(app.ScreenSyncSplashMotionEngine.DEFAULT_PRESET, 'screensync_morph', 'Pass 3 Part A: Default splash preset must be screensync_morph (ScreenSync Display Bridge)');
  assert.strictEqual(app.ScreenSyncSplashMotionEngine.DEFAULT_HALO_PCT, 0, 'Pass 3 Part A: Default FX & Halo Intensity must be 0 (0%)');
  assert.strictEqual(app.ScreenSyncSplashMotionEngine.COMPACT_LOGO_WIDTH, 76, 'Pass 3 Part A: Compact splash logo width must be 76px');

  const splashSummaryEl = sandbox.document.getElementById('accountSplashCurrentSummary');
  assert(splashSummaryEl && splashSummaryEl.textContent.includes('ScreenSync Display Bridge') && splashSummaryEl.textContent.includes('0%'), 'Pass 3 Part A: Account splash summary must show Default: ScreenSync Display Bridge • FX & Halo: 0%');

  // Verify opening and closing #viewSplashAnimationStudio from Account
  app.switchView('ACCOUNT');
  const btnSplashRow = sandbox.document.getElementById('btnAccountSplashStudioRow');
  assert(btnSplashRow, 'Pass 3 Part A: #btnAccountSplashStudioRow must exist in #viewAccount');
  btnSplashRow.click();
  assert.strictEqual(app.state.activeView, 'SPLASH_STUDIO', 'Pass 3 Part A: Clicking #btnAccountSplashStudioRow must switch view to SPLASH_STUDIO');
  assert(sandbox.document.getElementById('viewAccount').classList.contains('hidden'), 'Pass 3 Part A: #viewAccount must be hidden when SPLASH_STUDIO is open');
  const studioWin = sandbox.document.getElementById('viewSplashAnimationStudio');
  assert(studioWin && !studioWin.classList.contains('hidden'), 'Pass 3 Part A: #viewSplashAnimationStudio must be visible');
  assert(!studioWin.innerHTML.includes('3. App Icon Scale & ScreenSync Branding'), 'Pass 3 Part A: Section 3. App Icon Scale & ScreenSync Branding must be completely removed');
  assert(sandbox.document.getElementById('sliderSplashHaloIntensity'), 'Pass 3 Part A: FX & Halo Intensity slider (#sliderSplashHaloIntensity) must be preserved');

  // Verify Quantum Vortex continuous cross-dissolve interpolation (zero abrupt state jump)
  app.ScreenSyncSplashMotionEngine.savePreferences('quantum', 20);
  const f1 = app.ScreenSyncSplashMotionEngine.renderPresetFrame(
    0.50,
    sandbox.document.getElementById('splashStudioPreviewCanvas'),
    sandbox.document.getElementById('splashStudioPreviewRig'),
    sandbox.document.getElementById('splashPreviewFullLogo'),
    sandbox.document.getElementById('splashStudioAmbientGlow')
  );
  const f2 = app.ScreenSyncSplashMotionEngine.renderPresetFrame(
    0.55,
    sandbox.document.getElementById('splashStudioPreviewCanvas'),
    sandbox.document.getElementById('splashStudioPreviewRig'),
    sandbox.document.getElementById('splashPreviewFullLogo'),
    sandbox.document.getElementById('splashStudioAmbientGlow')
  );
  assert(f1.logoOpacity > 0.1 && f1.logoOpacity < 0.9 && f2.logoOpacity > f1.logoOpacity, 'Pass 3 Part A: Quantum Vortex must smoothly cross-dissolve logoOpacity across frames');
  app.ScreenSyncSplashMotionEngine.savePreferences('screensync_morph', 0);

  sandbox.document.getElementById('btnBackFromSplashStudio').click();
  assert.strictEqual(app.state.activeView, 'ACCOUNT', 'Pass 3 Part A: Clicking #btnBackFromSplashStudio must return to ACCOUNT');

  // Verify Pure Launch Splash CSS rules (76px x 86px, hidden loaders/text, zero box artifact) & Responsive Focus Hero SVG & Toast contrast
  assert(
    html.includes('#splashOverlay .splash-loader-wrap') &&
    html.includes('width: 76px !important;') &&
    html.includes('height: 86px !important;') &&
    html.includes('preserveAspectRatio="xMidYMid slice"') &&
    html.includes('rgba(7, 19, 43, 0.97)'),
    'Pass 2 & 3 CSS: Pure compact 76x86 launch splash, responsive Focus Hero SVG, and high-contrast #toastBanner CSS must be present'
  );

  // Verify NotificationFatigueGuard auto-mutes wellness nudges during active Focus session
  assert(app.NotificationFatigueGuard, 'Pass 3 Part B: NotificationFatigueGuard must exist');
  app.state.notifMasterEnabled = true;
  app.state.focusRunning = true;
  assert.strictEqual(app.NotificationFatigueGuard.shouldAllowWellnessNudge('POSTURE'), false, 'Pass 3 Part B: NotificationFatigueGuard must suppress wellness nudges during active Focus Mode');
  app.state.focusRunning = false;
  assert.strictEqual(app.NotificationFatigueGuard.shouldAllowWellnessNudge('POSTURE'), true, 'Pass 3 Part B: NotificationFatigueGuard must allow wellness nudges when Focus Mode is inactive');


  // 11. Starter Fix B Acceptance: Migration 010 static SQL table census & Retention Purge Tombstones + Edge Function handler checks
  const mig10Path = path.join(rootDir, "supabase/migrations/20261022000010_reconcile_deletion_and_retention_rpcs.sql");
  assert(fs.existsSync(mig10Path), "Starter Fix B: Migration 010 (20261022000010_reconcile_deletion_and_retention_rpcs.sql) must exist");
  const mig10Sql = fs.readFileSync(mig10Path, "utf8");
  const migDir = path.join(rootDir, "supabase/migrations");
  const allMigFiles = fs.readdirSync(migDir).filter(f => f.endsWith(".sql")).sort();
  const createdTables = new Set();
  allMigFiles.forEach((f) => {
    const sqlTxt = fs.readFileSync(path.join(migDir, f), "utf8");
    const matches = sqlTxt.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.([a-zA-Z0-9_]+)/gi);
    for (const m of matches) {
      createdTables.add(m[1].toLowerCase());
    }
  });
  const mig10Deletes = Array.from(mig10Sql.matchAll(/DELETE\s+FROM\s+public\.([a-zA-Z0-9_]+)/gi)).map(m => m[1].toLowerCase());
  assert(mig10Deletes.length >= 20, "Starter Fix B: Migration 010 must delete from all 20 user tables + prune_user_history_older_than tables");
  mig10Deletes.forEach((tbl) => {
    assert(createdTables.has(tbl), `Starter Fix B: Every DELETE FROM public.${tbl} in Migration 010 must target a table created in supabase/migrations/`);
  });

  // Verify Edge Function (supabase/functions/delete-account/index.ts) checks serviceRoleKey and deleteUser error
  const edgeFnSrc = fs.readFileSync(path.join(rootDir, "supabase/functions/delete-account/index.ts"), "utf8");
  assert(
    edgeFnSrc.includes("SERVICE_ROLE_KEY_MISSING") &&
    edgeFnSrc.includes("AUTH_USER_DELETE_FAILED") &&
    edgeFnSrc.includes("p_reason: reason"),
    "Starter Fix B: Edge Function must fail closed (500) when serviceRoleKey is missing or admin.deleteUser returns an error, and pass p_reason to RPC"
  );

  // Verify Retention Purge Tombstones prevent re-downloading purged history on subsequent mergeRemoteRecordsIntoLocal
  const retUid = "usr_retention_tombstone_test";
  app.BackendDB.ensureUserStructures(retUid);
  app.BackendDB.data.sessionsByUser[retUid] = [
    { sessionId: "sess_old_purge_1", userId: retUid, installationKey: "s24_ultra", appKey: "instagram", localDate: "2026-01-10", durationMinutes: 30 }
  ];
  app.BackendDB.data.reelEventsByUser[retUid] = [
    { eventId: "reel_old_purge_1", userId: retUid, installationKey: "s24_ultra", appKey: "instagram", localDate: "2026-01-10", reelCount: 5, watchMinutes: 3 }
  ];
  const purgeRes = app.BackendDB.purgeDataOlderThan(retUid, 30);
  assert(purgeRes.ok === true && purgeRes.purgedSessions === 1 && purgeRes.purgedReels === 1, "Starter Fix B: purgeDataOlderThan must purge old session and reel records");
  assert(
    app.BackendDB.data.purgedRecordIdsByUser?.[retUid]?.["sess_old_purge_1"] &&
    app.BackendDB.data.purgedRecordIdsByUser?.[retUid]?.["reel_old_purge_1"],
    "Starter Fix B: purgeDataOlderThan must record tombstones in purgedRecordIdsByUser"
  );

  const prevAuth = app.state.isAuthenticated;
  const prevUser = app.state.currentUser;
  app.state.isAuthenticated = true;
  app.state.currentUser = { userId: retUid, email: "ret@screensync.io", name: "Ret User" };
  app.SupabaseSyncEngine.mergeRemoteRecordsIntoLocal(retUid, {
    sessions: [
      { user_id: retUid, session_id: "sess_old_purge_1", installation_key: "s24_ultra", app_key: "instagram", local_date: "2026-01-10", duration_minutes: 30 }
    ],
    reelEvents: [
      { user_id: retUid, event_id: "reel_old_purge_1", installation_key: "s24_ultra", app_key: "instagram", local_date: "2026-01-10", reel_count: 5, watch_minutes: 3 }
    ]
  });
  app.state.isAuthenticated = prevAuth;
  app.state.currentUser = prevUser;
  assert.strictEqual((app.BackendDB.data.sessionsByUser[retUid] || []).length, 0, "Starter Fix B: mergeRemoteRecordsIntoLocal must skip tombstoned session_id");
  assert.strictEqual((app.BackendDB.data.reelEventsByUser[retUid] || []).length, 0, "Starter Fix B: mergeRemoteRecordsIntoLocal must skip tombstoned event_id");


  // =========================================================================
  // PART 13A: CATEGORY 13 (DATA RETENTION, EXPORT/BACKUP, PRIVACY COMPLIANCE
  // & ACCOUNT DELETION — PASS A: S13 FIXES 1-4 & C13-01..C13-35)
  // =========================================================================

  {
  // 1. S13 #5 / C13-01 / C13-35: Static & schema reconciliation across all SQL migrations (0001..0011)
  const migrationsDir = path.join(rootDir, "supabase/migrations");
  const migrationFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();
  const createdTables = new Set();
  const deletedTables = new Set();
  for (const mf of migrationFiles) {
    const sqlText = fs.readFileSync(path.join(migrationsDir, mf), "utf8");
    const createRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.([a-zA-Z0-9_]+)/gi;
    let m;
    while ((m = createRegex.exec(sqlText)) !== null) {
      createdTables.add(m[1].toLowerCase());
    }
    const deleteRegex = /DELETE\s+FROM\s+public\.([a-zA-Z0-9_]+)/gi;
    while ((m = deleteRegex.exec(sqlText)) !== null) {
      deletedTables.add({ file: mf, table: m[1].toLowerCase() });
    }
  }
  const mig011Path = path.join(migrationsDir, "20261022000011_category13_complete_retention_deletion_and_compliance.sql");
  assert(fs.existsSync(mig011Path), "C13-01/C13-21: Migration 011 must exist");
  const mig011Sql = fs.readFileSync(mig011Path, "utf8");
  // Every DELETE FROM public.<t> in migration 011 (and 008/010) must reference a real created table
  for (const entry of deletedTables) {
    if (entry.file.includes("0008") || entry.file.includes("0010") || entry.file.includes("0011")) {
      assert(createdTables.has(entry.table), `S13 #5 / C13-01: DELETE FROM public.${entry.table} in ${entry.file} must reference an existing created table`);
    }
  }
  assert(
    !mig011Sql.includes("DELETE FROM public.usage_sessions") &&
    !mig011Sql.includes("DELETE FROM public.daily_aggregates") &&
    !mig011Sql.includes("DELETE FROM public.reel_events") &&
    mig011Sql.includes("prune_user_history_older_than(p_cutoff_date DATE)") &&
    mig011Sql.includes("prune_user_history_older_than(p_user_id UUID, p_cutoff_date DATE)") &&
    mig011Sql.includes("delete_user_account_and_all_data(") &&
    mig011Sql.includes("p_password_verified BOOLEAN DEFAULT TRUE"),
    "C13-01/C13-21/C13-25: Migration 011 must define 1-arg and 2-arg prune_user_history_older_than and 3-arg delete_user_account_and_all_data with p_password_verified"
  );

  // 2. S13 #2 / C13-25 / C13-35: Edge Function handler & config.toml verification
  const configToml = fs.readFileSync(path.join(rootDir, "supabase/config.toml"), "utf8");
  assert(
    configToml.includes("[functions.delete-account]") &&
    configToml.includes("verify_jwt = true"),
    "C13-35: supabase/config.toml must declare [functions.delete-account] with verify_jwt = true"
  );
  assert(
    edgeFnSrc.includes("handleDeleteAccountRequest") &&
    edgeFnSrc.includes("INVALID_PASSWORD") &&
    edgeFnSrc.includes("CONFIRMATION_PHRASE_REQUIRED") &&
    edgeFnSrc.includes("DATABASE_PURGE_FAILED") &&
    edgeFnSrc.includes("p_password_verified: passwordVerified"),
    "S13 #2 / C13-25: Edge Function must export handleDeleteAccountRequest, verify password/phrase server-side, pass p_password_verified, and fail closed before deleteUser on RPC error"
  );

  // 3. C13-03 & C13-04: Retention options (30, 60, 90, 180, 365, 0), aliases & DataRetentionManager.purgeExpiredHistoryForUser
  const retOptVals = app.WheelTimePickerController.RETENTION_OPTIONS.map(o => o.value);
  for (const expectedDays of [30, 60, 90, 180, 365, 0]) {
    assert(retOptVals.includes(expectedDays), `C13-03: WheelTimePickerController.RETENTION_OPTIONS must include ${expectedDays}`);
    assert(
      app.NotificationTimePickerController.RETENTION_MAP.some(o => o.value === expectedDays),
      `C13-03: NotificationTimePickerController.RETENTION_MAP must include ${expectedDays}`
    );
  }
  assert.strictEqual(app.BackendDB.data.userSettingsByUser, app.BackendDB.data.settingsByUser, "C13-04: BackendDB.data.userSettingsByUser must alias settingsByUser");
  assert(app.WheelTimePickerController.wheels["wheelInlineDataRetention"], "C13-04: wheelInlineDataRetention alias must resolve");
  assert(sandbox.document.getElementById("btnRetention180") && sandbox.document.getElementById("btnRetention60"), "C13-03: #btnRetention60 and #btnRetention180 buttons must exist in DOM");

  const uidRet180 = "usr_c13_ret180";
  app.BackendDB.ensureUserStructures(uidRet180);
  app.BackendDB.data.sessionsByUser[uidRet180] = [
    { sessionId: "s_old_200d", userId: uidRet180, installationKey: "s24_ultra", appKey: "youtube", localDate: "2025-01-01", durationMinutes: 25 },
    { sessionId: "s_recent_5d", userId: uidRet180, installationKey: "s24_ultra", appKey: "youtube", localDate: app.getTodayLocalDateStr(), durationMinutes: 15 }
  ];
  const purge180Res = app.DataRetentionManager.purgeExpiredHistoryForUser(uidRet180, 180);
  assert(
    purge180Res.ok === true &&
    app.BackendDB.getUserSettings(uidRet180).dataRetentionDays === 180 &&
    app.BackendDB.data.sessionsByUser[uidRet180].length === 1 &&
    app.BackendDB.data.sessionsByUser[uidRet180][0].sessionId === "s_recent_5d",
    "C13-03/C13-04: purgeExpiredHistoryForUser(uid, 180) must store 180 days and purge records older than 180 days"
  );

  // 4. C13-05 & C13-06: Real clock cutoff (not frozen at 2026-10-16) & dateless record fallback timestamp derivation
  const uidClockAndDateless = "usr_c13_clock_dateless";
  app.BackendDB.ensureUserStructures(uidClockAndDateless);
  app.BackendDB.data.sessionsByUser[uidClockAndDateless] = [
    { sessionId: "s_no_localdate_old_epoch", userId: uidClockAndDateless, installationKey: "s24_ultra", appKey: "instagram", startEpochSec: Math.floor(Date.parse("2025-02-01T10:00:00Z") / 1000), durationMinutes: 10 },
    { sessionId: "s_truly_dateless", userId: uidClockAndDateless, installationKey: "s24_ultra", appKey: "instagram", durationMinutes: 5 }
  ];
  app.BackendDB.data.securityAlertsByUser[uidClockAndDateless] = [
    { alertId: "sec_old_1", createdAt: "2025-01-15T00:00:00Z", type: "TEST" }
  ];
  const pClockRes = app.BackendDB.purgeDataOlderThan(uidClockAndDateless, 90);
  const expectedCutoff90 = (() => {
    const d = new Date(app.getTodayLocalDateStr() + "T00:00:00");
    d.setDate(d.getDate() - 90);
    return app.getTodayLocalDateStr(d);
  })();
  assert.strictEqual(pClockRes.cutoffDateStr, expectedCutoff90, "C13-05: purgeDataOlderThan must compute cutoff relative to real today");
  assert.strictEqual(pClockRes.purgedSessions, 1, "C13-06: Session without localDate but with old startEpochSec must be purged");
  assert.strictEqual(pClockRes.unpurgeableDatelessRecords.length, 1, "C13-06: Truly dateless session must be counted in unpurgeableDatelessRecords");
  assert.strictEqual(pClockRes.purgedSecurityAlerts, 1, "C13-06: Old securityAlertsByUser entries must be purged");

  // 5. C13-02 & C13-07: Cross-device data_retention_days sync, PURGED tombstones in dedupRows, and cloudPruneStatus
  const uidSyncRet = "usr_c13_sync_retention";
  app.BackendDB.ensureUserStructures(uidSyncRet);
  app.BackendDB.getUserSettings(uidSyncRet).dataRetentionDays = 60;
  app.BackendDB.getUserSettings(uidSyncRet).updatedAt = "2026-11-13T08:00:00.000Z";
  app.BackendDB.data.sessionsByUser[uidSyncRet] = [
    { sessionId: "sess_to_tombstone", userId: uidSyncRet, installationKey: "s24_ultra", appKey: "tiktok", localDate: "2025-03-01", durationMinutes: 12 }
  ];
  app.BackendDB.purgeDataOlderThan(uidSyncRet, 60);
  const prevAuthB = app.state.isAuthenticated;
  const prevUserB = app.state.currentUser;
  app.state.isAuthenticated = true;
  app.state.currentUser = { userId: uidSyncRet, email: "ret@screensync.io", name: "Sync Ret" };
  const uploadPayload = app.SupabaseSyncEngine.buildUploadPayloadForUser(uidSyncRet);
  assert.strictEqual(uploadPayload.settingsRow.data_retention_days, 60, "C13-02: buildUploadPayloadForUser settingsRow must include data_retention_days");
  assert(
    uploadPayload.dedupRows.some(r => r.event_id === "sess_to_tombstone" && r.status === "PURGED"),
    "C13-02: buildUploadPayloadForUser dedupRows must include PURGED tombstones"
  );

  // Simulate Device B receiving remote settingsRow (data_retention_days: 60) and PURGED tombstone
  const uidDeviceB = "usr_c13_device_b";
  app.BackendDB.ensureUserStructures(uidDeviceB);
  app.BackendDB.getUserSettings(uidDeviceB).dataRetentionDays = 90;
  app.BackendDB.getUserSettings(uidDeviceB).updatedAt = "2026-10-01T00:00:00.000Z";
  app.BackendDB.data.sessionsByUser[uidDeviceB] = [
    { sessionId: "sess_to_tombstone", userId: uidDeviceB, installationKey: "s24_ultra", appKey: "tiktok", localDate: app.getTodayLocalDateStr(), durationMinutes: 12 }
  ];
  app.state.isAuthenticated = true;
  app.state.currentUser = { userId: uidDeviceB, email: "devb@screensync.io", name: "Device B" };
  app.SupabaseSyncEngine.mergeRemoteRecordsIntoLocal(uidDeviceB, {
    settings: [{ user_id: uidDeviceB, data_retention_days: 60, updated_at: "2026-11-13T08:00:00.000Z" }],
    dedupLedger: [{ user_id: uidDeviceB, event_id: "sess_to_tombstone", status: "PURGED" }]
  });
  app.state.isAuthenticated = prevAuthB;
  app.state.currentUser = prevUserB;
  assert.strictEqual(app.BackendDB.getUserSettings(uidDeviceB).dataRetentionDays, 60, "C13-02: mergeRemoteRecordsIntoLocal must sync data_retention_days via LWW");
  assert.strictEqual(app.BackendDB.data.sessionsByUser[uidDeviceB].length, 0, "C13-02: Remote PURGED tombstone must remove matching local session on Device B");

  // C13-07: Cloud RPC failure reports LOCAL_ONLY_CLOUD_FAILED and queues pendingCloudRetentionPrunes
  const origSbClient = app.SupabaseAuthClient.client;
  const origSbReady = app.SupabaseAuthClient.isReady;
  app.SupabaseAuthClient.isReady = true;
  app.SupabaseAuthClient.client = {
    rpc: async () => ({ data: null, error: { message: "simulated_rpc_failure" } })
  };
  app.state.isAuthenticated = true;
  app.state.currentUser = { userId: uidSyncRet, email: "ret@screensync.io" };
  const cloudFailPrune = app.BackendDB.purgeDataOlderThan(uidSyncRet, 30);
  await cloudFailPrune.awaitCloud();
  assert(String(cloudFailPrune.cloudPruneStatus).startsWith("LOCAL_ONLY_CLOUD_FAILED"), "C13-07: RPC failure must set cloudPruneStatus to LOCAL_ONLY_CLOUD_FAILED");
  assert(
    Array.isArray(app.BackendDB.data.pendingCloudRetentionPrunes) &&
    app.BackendDB.data.pendingCloudRetentionPrunes.some(item => item.userId === uidSyncRet),
    "C13-07: Failed cloud prune must be queued in pendingCloudRetentionPrunes"
  );
  app.SupabaseAuthClient.client = origSbClient;
  app.SupabaseAuthClient.isReady = origSbReady;
  app.state.isAuthenticated = prevAuthB;
  app.state.currentUser = prevUserB;

  // 6. C13-08..C13-16: Export All History by default, CSV APP_LIMIT/SETTING rows, SHA-256 v2 checksum across all 15 sections, Encrypted Backups, Ownership Session Token check, and Restore validation
  const uidExp = "usr_c13_export_backup";
  app.BackendDB.ensureUserStructures(uidExp);
  app.state.isAuthenticated = true;
  app.state.currentUser = { userId: uidExp, email: "exp@screensync.io", name: "Export Tester" };
  app.BackendDB.data.sessionsByUser[uidExp] = [
    { sessionId: "s_prior_month", userId: uidExp, installationKey: "s24_ultra", appKey: "instagram", localDate: "2026-01-15", durationMinutes: 42 }
  ];
  app.BackendDB.data.appLimitsByUser[uidExp] = { instagram: { dailyLimitMinutes: 30, enabled: true } };
  const startInp = sandbox.document.getElementById("exportStartDateInput");
  const endInp = sandbox.document.getElementById("exportEndDateInput");
  if (startInp) startInp.value = "";
  if (endInp) endInp.value = "";
  const csvRes = app.DataExportAndBackupManager.exportUserCsv(uidExp, { skipDownload: true });
  assert(
    csvRes.ok === true &&
    csvRes.rangeLabel === "All history" &&
    csvRes.payload.includes("s_prior_month") &&
    csvRes.payload.includes("APP_LIMIT,") &&
    csvRes.payload.includes("SETTING,"),
    "C13-08/C13-09/C13-12: Default exportUserCsv must export All history (including prior months) and include APP_LIMIT and SETTING rows"
  );

  // C13-10: Checksum v2 covers all 15 sections (tampering with settings fails with BACKUP_CHECKSUM_MISMATCH)
  const snapRes = app.DataExportAndBackupManager.createFullBackup(uidExp, { skipDownload: true });
  assert(
    snapRes.ok === true &&
    snapRes.snapshot.checksumVersion === 2 &&
    typeof snapRes.snapshot.checksum === "string" &&
    snapRes.snapshot.checksum.length === 64,
    "C13-10: createBackupSnapshot must produce a 64-char SHA-256 checksumVersion 2 digest"
  );
  const tamperedSnap = JSON.parse(snapRes.rawJson);
  tamperedSnap.settings.dailyScreenGoalMinutes = (tamperedSnap.settings.dailyScreenGoalMinutes || 180) + 1;
  const tamperedRestore = app.DataExportAndBackupManager.restoreFromBackupJson(uidExp, JSON.stringify(tamperedSnap));
  assert(
    tamperedRestore.ok === false && tamperedRestore.reason === "BACKUP_CHECKSUM_MISMATCH",
    "C13-10: Modifying 1 field in backup settings must fail restoreBackupSnapshot with BACKUP_CHECKSUM_MISMATCH"
  );

  // C13-11: Encrypted backup round-trip & wrong-passphrase rejection
  const encSnapRes = app.DataExportAndBackupManager.createBackupSnapshot(uidExp, { skipDownload: true, passphrase: "CorrectHorseBatteryStaple!" });
  assert(
    encSnapRes.ok === true &&
    encSnapRes.encrypted === true &&
    encSnapRes.snapshot.encrypted === true &&
    encSnapRes.snapshot.kdf === "PBKDF2-HMAC-SHA256",
    "C13-11: Passphrase backup must produce encrypted PBKDF2-HMAC-SHA256 envelope"
  );
  const wrongPassRestore = app.DataExportAndBackupManager.restoreBackupSnapshot(uidExp, encSnapRes.rawJson, { passphrase: "WrongPassword" });
  assert(
    wrongPassRestore.ok === false && wrongPassRestore.reason === "INVALID_BACKUP_PASSPHRASE",
    "C13-11: Restoring encrypted backup with wrong passphrase must fail with INVALID_BACKUP_PASSPHRASE"
  );
  app.BackendDB.data.sessionsByUser[uidExp] = [];
  const rightPassRestore = app.DataExportAndBackupManager.restoreBackupSnapshot(uidExp, encSnapRes.rawJson, { passphrase: "CorrectHorseBatteryStaple!", skipRetentionPurge: true });
  assert(rightPassRestore.ok === true && rightPassRestore.restoredSessions >= 1, "C13-11: Restoring encrypted backup with correct passphrase must succeed");

  // C13-16: Invalid website/sound records counted in invalidRecordsSkipped & retention applied on restore
  const snapWithInvalid = JSON.parse(snapRes.rawJson);
  snapWithInvalid.sessions.push({ sessionId: "s_old_for_restore_purge", userId: uidExp, installationKey: "s24_ultra", appKey: "instagram", localDate: "2025-05-01", durationMinutes: 20 });
  snapWithInvalid.websiteSessions = [{ domain: "", durationMinutes: -10 }];
  snapWithInvalid.soundSessions = [{ appKey: "", durationMinutes: -5 }];
  snapWithInvalid.settings.dataRetentionDays = 30;
  delete snapWithInvalid.checksum;
  const invRes = app.DataExportAndBackupManager.restoreBackupSnapshot(uidExp, JSON.stringify(snapWithInvalid));
  assert(
    invRes.ok === true && invRes.invalidRecordsSkipped === 2 && invRes.purgedExpiredOnRestore >= 1,
    "C13-16: restoreBackupSnapshot must increment invalidRecordsSkipped for invalid website/sound records and purge expired records when dataRetentionDays > 0"
  );

  // C13-13: _triggerDownload uses EITHER native bridge OR web Blob, never both, and surfaces NATIVE_EXPORT_FAILED
  const origBridge = sandbox.window.ScreenSyncNativeBridge;
  let nativeSaveCalls = 0;
  sandbox.window.ScreenSyncNativeBridge = {
    saveTextFileExportJson: () => {
      nativeSaveCalls++;
      return JSON.stringify({ ok: false, error: "DISK_FULL" });
    }
  };
  const dlFail = app.DataExportAndBackupManager._triggerDownload("test.json", "{}", "application/json");
  assert(
    nativeSaveCalls === 1 && dlFail.ok === false && dlFail.reason === "NATIVE_EXPORT_FAILED",
    "C13-13: _triggerDownload must return ok:false with NATIVE_EXPORT_FAILED when native bridge fails and not fall through to web Blob"
  );
  sandbox.window.ScreenSyncNativeBridge = origBridge;

  // C13-14: BackendDB.verifyAccountOwnership enforces valid session token when user has issued sessions
  const uidTok = "usr_c13_session_tok";
  app.BackendDB.ensureUserStructures(uidTok);
  app.BackendDB.data.authSessions["tok_valid_123"] = { userId: uidTok, revoked: false, expiresAtMs: Date.now() + 3600000 };
  app.state.isAuthenticated = true;
  app.state.currentUser = { userId: uidTok, email: "tok@screensync.io", sessionToken: "" };
  const ownNoTok = app.BackendDB.verifyAccountOwnership(uidTok, "EXPORT_TEST");
  assert(
    ownNoTok.ok === false && ownNoTok.reason === "INVALID_SESSION_TOKEN",
    "C13-14: verifyAccountOwnership must reject missing session token when user has active issued sessions"
  );
  app.state.currentUser.sessionToken = "tok_valid_123";
  const ownWithTok = app.BackendDB.verifyAccountOwnership(uidTok, "EXPORT_TEST");
  assert(ownWithTok.ok === true, "C13-14: verifyAccountOwnership must accept valid session token");
  app.state.isAuthenticated = prevAuthB;
  app.state.currentUser = prevUserB;

  // 7. C13-17..C13-20 & C13-30..C13-34: Legal Modal 7/4 Sections, Privacy Policy §4/§5, SDK 36, and Fail-Closed Store Billing
  app.StoreComplianceAndPrivacyManager.openLegalDocumentModal("PRIVACY");
  const legalBodyHtmlPriv = sandbox.document.getElementById("legalDocumentModalBody").innerHTML;
  for (let sec = 1; sec <= 7; sec++) {
    assert(legalBodyHtmlPriv.includes(`${sec}.`), `C13-17: In-app Privacy Policy modal must include section ${sec}`);
  }
  app.StoreComplianceAndPrivacyManager.openLegalDocumentModal("TERMS");
  const legalBodyHtmlTerms = sandbox.document.getElementById("legalDocumentModalBody").innerHTML;
  for (let sec = 1; sec <= 4; sec++) {
    assert(legalBodyHtmlTerms.includes(`${sec}.`), `C13-17: In-app Terms of Service modal must include section ${sec}`);
  }
  app.StoreComplianceAndPrivacyManager.closeLegalDocumentModal();

  const privHtmlOnDisk = fs.readFileSync(path.join(rootDir, "src/privacy_policy.html"), "utf8");
  assert(
    privHtmlOnDisk.includes("Account &rarr; Data Export &amp; Backup &rarr; Keep History For") &&
    privHtmlOnDisk.includes("delete_user_account_and_all_data"),
    "C13-18/C13-19: src/privacy_policy.html must document exact Keep History For UI path and delete_user_account_and_all_data RPC"
  );
  const readiness = app.StoreComplianceAndPrivacyManager.getStoreReadinessReport();
  assert.strictEqual(readiness.platformReadiness.GOOGLE_PLAY_STORE.targetSdk, 36, "C13-20: GOOGLE_PLAY_STORE targetSdk must be 36");
  assert.strictEqual(readiness.platformReadiness.GOOGLE_PLAY_STORE.compileSdk, 36, "C13-20: GOOGLE_PLAY_STORE compileSdk must be 36");

  // C13-30..C13-34: Fail-closed store billing & unverified receipt downgrade
  assert.strictEqual(app.SubscriptionAndBillingEngine.ALL_FEATURES_FREE_MODE, true, "C13-31: ALL_FEATURES_FREE_MODE alias must equal true");
  assert.strictEqual(app.SubscriptionAndBillingEngine.PLAN_CATALOG.PRO_ANNUAL.planId, "PRO_YEARLY", "C13-32: PLAN_CATALOG.PRO_ANNUAL must alias PRO_YEARLY");
  const noBridgeSub = app.SubscriptionAndBillingEngine.subscribeToPlan("PRO_LIFETIME", { userId: "usr_no_bridge_c13" });
  assert(
    noBridgeSub.ok === false && noBridgeSub.status === "STORE_UNAVAILABLE",
    "C13-30: subscribeToPlan without native bridge or verified store credentials must fail closed with STORE_UNAVAILABLE"
  );
  app.BackendDB.data.subscriptionsByUser["usr_unverified_expiry_c13"] = {
    userId: "usr_unverified_expiry_c13",
    planId: "PRO_MONTHLY",
    billingInterval: "MONTH",
    status: "ACTIVE",
    autoRenew: true,
    cancelAtPeriodEnd: false,
    storeOrderId: "ORD-UNVERIFIED-1",
    storePurchaseToken: "TOK-UNVERIFIED-1",
    serverVerifiedReceipt: false,
    currentPeriodStartMs: 1000,
    currentPeriodEndMs: 2000
  };
  const evalUnverified = app.SubscriptionAndBillingEngine.evaluateSubscriptionState("usr_unverified_expiry_c13", 5000);
  assert(
    evalUnverified.planId === "FREE" && evalUnverified.status === "EXPIRED" && evalUnverified.isProActive === false,
    "C13-33: Expired subscription without serverVerifiedReceipt must downgrade to FREE instead of rolling forward"
  );

  // 8. S13 #1, #3, #4 / C13-21..C13-29: Post-reload password verification, Cloud failure abort vs Cloud success full wipe, Offline queue retry, and Account-Gone
  const uidDelCloud = "usr_c13_cloud_del";
  app.BackendDB.ensureUserStructures(uidDelCloud);
  app.BackendDB.data.users.push({
    userId: uidDelCloud,
    email: "clouddel@screensync.io",
    passwordSalt: "salt_c13",
    passwordHash: app.AuthService.hashPassword("ValidPass#2026", "salt_c13")
  });
  app.BackendDB.save();
  const persistedDbJson = JSON.parse(sandbox.localStorage.getItem("screensync_cross_device_db_v5") || "{}");
  assert.strictEqual((persistedDbJson.users || []).length, 0, "S13 #1: BackendDB.save() must keep persisted users array empty while saving passwordHashesByUser");
  assert(app.BackendDB.data.passwordHashesByUser[uidDelCloud], "S13 #1 / C13-23: passwordHashesByUser must retain salted hash across reloads");

  // Seed data across all user-keyed maps for uidDelCloud
  app.BackendDB.data.sessionsByUser[uidDelCloud] = [{ sessionId: "s_del_1", userId: uidDelCloud, localDate: "2026-10-10", durationMinutes: 10 }];
  app.BackendDB.data.reelEventsByUser[uidDelCloud] = [{ eventId: "r_del_1", userId: uidDelCloud, localDate: "2026-10-10", reelCount: 3, watchMinutes: 2 }];
  app.BackendDB.data.appLimitsByUser[uidDelCloud] = { instagram: { dailyLimitMinutes: 15 } };
  app.BackendDB.data.discoveredAppsByUser[uidDelCloud] = { instagram: { displayName: "Instagram" } };
  app.BackendDB.data.trialUsedByUser[uidDelCloud] = { PRO_MONTHLY: true };
  app.BackendDB.data.installationsByUser[uidDelCloud] = [{ installationKey: "inst_del_c13", userId: uidDelCloud }];
  app.BackendDB.data.trackerHeartbeats["inst_del_c13"] = { lastSeenMs: Date.now() };
  app.BackendDB.data.authSessions["tok_del_c13"] = { userId: uidDelCloud };
  app.BackendDB.data.offlineQueue.push({ userId: uidDelCloud, type: "SYNC" });
  app.BackendDB.data.dedupLog[`${uidDelCloud}::ev_1`] = true;

  app.state.isAuthenticated = true;
  app.state.currentUser = { userId: uidDelCloud, email: "clouddel@screensync.io", name: "Cloud Del User", authProvider: "supabase" };

  // Mock SupabaseAuthClient: first test wrong password -> INVALID_PASSWORD
  app.SupabaseAuthClient.isReady = true;
  app.SupabaseAuthClient.client = {
    auth: {
      signInWithPassword: async ({ password }) => {
        if (password !== "ValidPass#2026") return { data: null, error: { message: "Invalid login credentials" } };
        return { data: { user: { id: uidDelCloud } }, error: null };
      },
      getSession: async () => ({ data: { session: { access_token: "jwt_del_c13" } }, error: null })
    },
    functions: {
      invoke: async () => ({ data: null, error: { message: "Edge 500 Internal Error" } })
    },
    rpc: async () => ({ data: null, error: { message: "RPC 500 Internal Error" } })
  };

  const wrongPwDel = await app.StoreComplianceAndPrivacyManager.verifyServerAndExecuteAccountDeletion("WrongPass#0000");
  assert(
    wrongPwDel.ok === false && wrongPwDel.reason === "INVALID_PASSWORD" &&
    app.BackendDB.data.sessionsByUser[uidDelCloud].length === 1 &&
    app.state.isAuthenticated === true,
    "S13 #1 / C13-23: Wrong password must return INVALID_PASSWORD and leave user data and session intact"
  );

  // Next test cloud failure -> CLOUD_FAILED, local data intact, still authenticated
  const cloudFailDel = await app.StoreComplianceAndPrivacyManager.verifyServerAndExecuteAccountDeletion("ValidPass#2026");
  assert(
    cloudFailDel.ok === false &&
    String(cloudFailDel.cloudDeletionStatus || "").startsWith("CLOUD_FAILED:") &&
    app.BackendDB.data.sessionsByUser[uidDelCloud].length === 1 &&
    app.state.isAuthenticated === true,
    "S13 #3 / C13-22: When cloud deletion fails, client must abort local wipe, remain signed in, and report CLOUD_FAILED"
  );

  // Next test cloud success -> complete mechanical wipe of all *ByUser maps + sign-out + post-deletion status banner
  app.SupabaseAuthClient.client.functions.invoke = async () => ({
    data: { ok: true, status: "ACCOUNT_AND_ALL_DATA_PERMANENTLY_DELETED", purgedTablesCount: 20 },
    error: null
  });
  const cloudOkDel = await app.StoreComplianceAndPrivacyManager.verifyServerAndExecuteAccountDeletion("ValidPass#2026");
  assert(
    cloudOkDel.ok === true &&
    (cloudOkDel.cloudDeletionStatus === "CLOUD_DELETED" || cloudOkDel.cloudDeletionStatus === "DELETED_VIA_EDGE_FUNCTION") &&
    app.state.isAuthenticated === false,
    "S13 #3 / C13-22: Confirmed cloud deletion must return ok:true, DELETED_VIA_EDGE_FUNCTION, and sign out"
  );
  for (const [k, v] of Object.entries(app.BackendDB.data)) {
    if (k.endsWith("ByUser") && v && typeof v === "object") {
      assert.strictEqual(v[uidDelCloud], undefined, `S13 #3 / C13-26: BackendDB.data.${k}[${uidDelCloud}] must be undefined after deletion`);
    }
  }
  assert.strictEqual(app.BackendDB.data.trackerHeartbeats["inst_del_c13"], undefined, "C13-26: Deleted user installation heartbeat must be removed");
  assert.strictEqual(app.BackendDB.data.authSessions["tok_del_c13"], undefined, "C13-26: Deleted user authSessions token must be removed");
  assert(!app.BackendDB.data.offlineQueue.some(q => q.userId === uidDelCloud), "C13-26: Deleted user offlineQueue entries must be removed");

  // S13 #4 / C13-24: Offline queue retry only shifts on success, increments attempts on failure
  app.BackendDB.data.pendingCloudAccountDeletions = [
    { userId: "usr_offline_q_c13", reason: "USER_INITIATED_OFFLINE", passwordVerified: true, requestedAtIso: new Date().toISOString(), attempts: 0 }
  ];
  app.SupabaseAuthClient.client.functions.invoke = async () => ({ data: null, error: { message: "Transient 503" } });
  app.SupabaseAuthClient.client.rpc = async () => ({ data: null, error: { message: "Transient 503" } });
  const qFailRes = await app.StoreComplianceAndPrivacyManager.processPendingCloudAccountDeletions();
  assert(
    qFailRes.failed === 1 &&
    app.BackendDB.data.pendingCloudAccountDeletions.length === 1 &&
    app.BackendDB.data.pendingCloudAccountDeletions[0].attempts === 1,
    "S13 #4 / C13-24: Transient failure in processPendingCloudAccountDeletions must keep item queued with attempts: 1"
  );
  app.SupabaseAuthClient.client.functions.invoke = async () => ({ data: { ok: true }, error: null });
  const qOkRes = await app.StoreComplianceAndPrivacyManager.processPendingCloudAccountDeletions();
  assert(
    qOkRes.processed === 1 &&
    app.BackendDB.data.pendingCloudAccountDeletions.length === 0,
    "S13 #4 / C13-24: Confirmed cloud deletion in processPendingCloudAccountDeletions must shift item from queue"
  );

  // S13 #4 / C13-27: AuthService.handleRemoteAccountGone on Device B when account is deleted on Device A
  const uidGoneB = "usr_gone_device_b";
  app.BackendDB.ensureUserStructures(uidGoneB);
  app.BackendDB.data.sessionsByUser[uidGoneB] = [{ sessionId: "s_gone_1", userId: uidGoneB, localDate: "2026-10-10", durationMinutes: 20 }];
  app.state.isAuthenticated = true;
  app.state.currentUser = { userId: uidGoneB, email: "goneb@screensync.io" };
  const goneRes = app.AuthService.handleRemoteAccountGone(uidGoneB, "user_not_found");
  assert(
    goneRes.ok === true &&
    app.state.isAuthenticated === false &&
    app.BackendDB.data.sessionsByUser[uidGoneB] === undefined &&
    sandbox.document.getElementById("postDeletionStatusBanner").textContent.includes("This account was deleted."),
    "S13 #4 / C13-27: handleRemoteAccountGone must wipe deleted user bucket, sign out to LOCAL, and show 'This account was deleted.'"
  );

  app.SupabaseAuthClient.client = origSbClient;
  app.SupabaseAuthClient.isReady = origSbReady;
  app.state.isAuthenticated = prevAuth;
  app.state.currentUser = prevUser;

  // 9. Part 13B Delta Findings (DF-13B-01 through DF-13B-08) Verification
  const javaHelperSrc = fs.readFileSync(path.join(rootDir, "android/app/src/main/java/io/screensync/wellness/AppUsageDatabaseHelper.java"), "utf8");
  assert(
    javaHelperSrc.includes(`db.delete("component_events", "timestamp < ?", tsArgs)`) &&
    !javaHelperSrc.includes(`db.delete("component_events", "start_time < ?", tsArgs)`) &&
    javaHelperSrc.includes(`summary.put("ok", txSucceeded);`),
    "DF-13B-01: AppUsageDatabaseHelper.pruneOlderThan must query component_events.timestamp < ? and report txSucceeded"
  );

  // DF-13B-02: Forever (0) retention quick summary & previewPurge / getRetentionCutoffDateStr
  const prevRetDays13B = app.state.dataRetentionDays;
  app.DataRetentionManager.setRetentionDays(0);
  const quickSumForever = sandbox.document.getElementById("accountExportQuickSummary")?.textContent || "";
  assert(
    (quickSumForever.includes("Keeps history forever") || quickSumForever.includes("Forever retention")) && !quickSumForever.includes("90 days") && !quickSumForever.includes("90-Day retention"),
    "DF-13B-02: Setting retention to 0 (Forever) must display Forever retention in #accountExportQuickSummary"
  );
  assert.strictEqual(app.BackendDB.getRetentionCutoffDateStr(app.getActiveOrLocalUserId()), null, "DF-13B-02: getRetentionCutoffDateStr must return null when retention is Forever (0)");
  app.DataRetentionManager.setRetentionDays(prevRetDays13B || 90);
  const previewOut13B = app.DataRetentionManager.previewPurge(app.getActiveOrLocalUserId(), 30);
  assert(previewOut13B && previewOut13B.ok === true && previewOut13B.retentionDays === 30, "DF-13B-02: DataRetentionManager.previewPurge must return preview counts");

  // DF-13B-04: OWASP whitespace-prefixed CSV formula escaping & local-to-authenticated backup migration
  assert.strictEqual(app.DataExportBackupManager.sanitizeCsvCell("  =cmd|'/C calc'!A0"), "'  =cmd|'/C calc'!A0", "DF-13B-04: Leading whitespace before = must be escaped with apostrophe");
  assert.strictEqual(app.DataExportBackupManager.sanitizeCsvCell("-42.5"), "-42.5", "DF-13B-04: Negative numeric values must not be escaped");
  assert(typeof app.StoreComplianceAndPrivacyManager.confirmAndExecuteAccountDeletion === "function", "DF-13B-06: confirmAndExecuteAccountDeletion helper must be exposed");
  assert.strictEqual(app.SubscriptionBillingManager, app.SubscriptionAndBillingEngine, "DF-13B-07: SubscriptionBillingManager alias must point to SubscriptionAndBillingEngine");

  const iosPrivacyXml = fs.readFileSync(path.join(rootDir, "ios/App/App/PrivacyInfo.xcprivacy"), "utf8");
  assert(
    iosPrivacyXml.includes("NSPrivacyCollectedDataTypeEmailAddress") &&
    iosPrivacyXml.includes("NSPrivacyCollectedDataTypeUserID") &&
    iosPrivacyXml.includes("NSPrivacyCollectedDataTypeDeviceID") &&
    iosPrivacyXml.includes("NSPrivacyCollectedDataTypeProductInteraction"),
    "DF-13B-05: ios/App/App/PrivacyInfo.xcprivacy must declare collected data types"
  );
  const storeMetaJson = JSON.parse(fs.readFileSync(path.join(rootDir, "store_assets/store_listing_metadata.json"), "utf8"));
  assert(
    String(storeMetaJson.accountDeletionUrl || storeMetaJson.policyCompliance?.accountDeletionUrl || "").includes("#account-deletion"),
    "DF-13B-05: store_listing_metadata.json must include accountDeletionUrl with #account-deletion anchor"
  );
  assert(
    privHtmlOnDisk.includes(`id="account-deletion"`),
    "DF-13B-05: src/privacy_policy.html must include id=\"account-deletion\" anchor on Section 5"
  );

  }

  // =========================================================================
  // PART 14A: CATEGORY 14 (NAVIGATION BACK-STACK, HELP & SUPPORT, AND LIVE
  // VERIFICATION SUITE — PASS A: CAT14-01..CAT14-24, STEP 8 & TESTS T01..T18)
  // =========================================================================
  {
    const crypto = require("crypto");

    // T01 — History sync (CAT14-01): in-app Back syncs browser history stack so subsequent popstate does not double-unwind
    app.switchView("OVERVIEW");
    assert.strictEqual(app.state.navHistoryDepth, 0, "T01: Root OVERVIEW must start with navHistoryDepth === 0");
    assert.strictEqual(sandbox.window.history.length, 1, "T01: Browser history stack length must be 1 at root OVERVIEW");

    // Open #screenTimeGoalModal via real opener
    sandbox.document.getElementById("btnEditScreenGoalCard").click();
    assert.strictEqual(app.state.navHistoryDepth, 1, "T01: Opening #screenTimeGoalModal must increment navHistoryDepth to 1");
    assert.strictEqual(sandbox.window.history.length, 2, "T01: Opening #screenTimeGoalModal must push browser history entry (length 2)");

    // Close modal with in-app Back -> must also pop browser history entry
    const t01InAppClose = app.handleSystemBackNavigation();
    assert.strictEqual(t01InAppClose, true, "T01: In-app Back must close #screenTimeGoalModal");
    assert(sandbox.document.getElementById("screenTimeGoalModal").classList.contains("hidden"), "T01: #screenTimeGoalModal must be hidden");
    assert.strictEqual(app.state.navHistoryDepth, 0, "T01: navHistoryDepth must be 0 after in-app close");
    assert.strictEqual(sandbox.window.history.length, 1, "T01: Browser history stack length must agree with navHistoryDepth + 1 (1) after in-app close");

    // Now simulate browser Back (popstate) on STATS after in-app modal close:
    app.switchView("STATS");
    assert.strictEqual(app.state.navHistoryDepth, 1, "T01: STATS view is at depth 1");
    sandbox.document.getElementById("btnEditScreenGoalCard").click();
    assert.strictEqual(app.state.navHistoryDepth, 2, "T01: Modal over STATS is at depth 2");
    assert.strictEqual(sandbox.window.history.length, 3, "T01: Browser stack length is 3 with modal open over STATS");
    // Close modal in-app:
    app.handleSystemBackNavigation();
    assert.strictEqual(app.state.activeView, "STATS", "T01: In-app Back closes modal and stays on STATS");
    assert.strictEqual(app.state.navHistoryDepth, 1, "T01: Depth is 1 after in-app modal close");
    assert.strictEqual(sandbox.window.history.length, 2, "T01: Browser history length is 2 (no stale modal entry left on browser stack)");

    // Repeat for Account drawer (#accountDataExportDrawer) and inline picker (#inlinePickerPanelQuietHours)
    app.switchView("ACCOUNT");
    sandbox.document.getElementById("btnAccountDataExportRow").click();
    assert.strictEqual(app.state.navHistoryDepth, 2, "T01: Opening drawer increments depth to 2");
    assert.strictEqual(sandbox.window.history.length, 3, "T01: Browser stack length is 3 when drawer opens");
    app.handleSystemBackNavigation();
    assert(sandbox.document.getElementById("accountDataExportDrawer").classList.contains("hidden"), "T01: In-app Back closes drawer");
    assert.strictEqual(app.state.navHistoryDepth, 1, "T01: Depth returns to 1");
    assert.strictEqual(sandbox.window.history.length, 2, "T01: Browser stack length returns to 2");

    app.WheelTimePickerController.toggleInlinePickerPanel("inlinePickerPanelQuietHours", sandbox.document.getElementById("btnQuietHoursStartPicker"), "START");
    assert.strictEqual(app.state.navHistoryDepth, 2, "T01: Opening inline picker increments depth to 2");
    assert.strictEqual(sandbox.window.history.length, 3, "T01: Browser stack length is 3 when inline picker opens");
    app.handleSystemBackNavigation();
    assert(sandbox.document.getElementById("inlinePickerPanelQuietHours").classList.contains("hidden"), "T01: In-app Back closes inline picker");
    assert.strictEqual(app.state.navHistoryDepth, 1, "T01: Depth returns to 1");
    assert.strictEqual(sandbox.window.history.length, 2, "T01: Browser stack length returns to 2");

    // T02 — Popstate single unwind (CAT14-01): modal open over a sub-view
    app.switchView("OVERVIEW");
    app.switchView("ALL_APPS");
    assert.strictEqual(app.state.activeView, "ALL_APPS", "T02: Entered ALL_APPS sub-view");
    sandbox.document.getElementById("btnEditScreenGoalCard").click();
    assert(!sandbox.document.getElementById("screenTimeGoalModal").classList.contains("hidden"), "T02: Modal open over ALL_APPS");
    sandbox.window.history.back();
    assert(sandbox.document.getElementById("screenTimeGoalModal").classList.contains("hidden"), "T02: 1st browser Back closes modal only");
    assert.strictEqual(app.state.activeView, "ALL_APPS", "T02: 1st browser Back leaves sub-view ALL_APPS active");
    sandbox.window.history.back();
    assert.strictEqual(app.state.activeView, "OVERVIEW", "T02: 2nd browser Back unwinds ALL_APPS back to OVERVIEW");

    // T03 — Tab-tap dedup (CAT14-08) + history-mock gating (CAT14-23)
    app.switchView("OVERVIEW");
    app.switchView("STATS");
    app.switchView("FOCUS");
    app.switchView("ACCOUNT");
    app.switchView("STATS");
    assert.strictEqual(app.state.navHistoryDepth, 1, "T03/CAT14-08: Rapid top-level tab switching must keep navHistoryDepth at 1 via replaceState");
    assert.strictEqual(sandbox.window.history.length, 2, "T03/CAT14-08: Rapid top-level tab switching must not accumulate duplicate browser stack entries");
    const sameTabPush = app.NavigationHistoryBridge.pushNavigationState("VIEW_STATS", { type: "VIEW", view: "STATS" });
    assert.strictEqual(sameTabPush.pushed, false, "T03/CAT14-08: Pushing duplicate top entry must be skipped");
    assert.strictEqual(sameTabPush.deduplicated, true, "T03/CAT14-08: Duplicate push must return deduplicated: true");

    // Verify history-mock gating when History API is absent and __ssTestMode === false (CAT14-23)
    const savedWindowHistory = sandbox.window.history;
    sandbox.window.__ssTestMode = false;
    delete sandbox.window.history;
    const noHistoryRes = app.NavigationHistoryBridge.pushNavigationState("TEST_NO_HISTORY", { type: "VIEW", view: "FOCUS" });
    assert.strictEqual(noHistoryRes.pushed, false, "T03/CAT14-23: Without History API and outside test mode, pushNavigationState must no-op");
    assert.strictEqual(noHistoryRes.reason, "HISTORY_API_UNAVAILABLE", "T03/CAT14-23: Must return HISTORY_API_UNAVAILABLE");
    assert.strictEqual(sandbox.window.history, undefined, "T03/CAT14-23: Must leave window.history untouched when not in test mode");
    delete sandbox.window.__ssTestMode;
    sandbox.window.history = savedWindowHistory;

    // T04 — Forward after Back (CAT14-01)
    app.switchView("OVERVIEW");
    app.switchView("STATS");
    sandbox.window.history.back();
    assert.strictEqual(app.state.activeView, "OVERVIEW", "T04: Browser Back from STATS returns to OVERVIEW");
    app.switchView("STATS");
    assert.strictEqual(app.state.activeView, "STATS", "T04: Forward tap to STATS succeeds");
    assert.strictEqual(app.state.navHistoryDepth, 1, "T04: Forward tap after browser Back keeps depth at 1 without duplicate entries");
    assert(sandbox.document.getElementById("screenTimeGoalModal").classList.contains("hidden"), "T04: No closed overlay is resurrected");

    // T05 — Sub-page origins (CAT14-06, CAT14-18) & Multi-hop viewHistoryStack (Step 8.1)
    for (const originCandidate of ["OVERVIEW", "ALL_APPS", "STATS", "APP_LIMITS"]) {
      app.switchView("OVERVIEW");
      if (originCandidate !== "OVERVIEW") app.switchView(originCandidate);
      app.switchView("APP_DETAIL");
      assert.strictEqual(app.state.appDetailOrigin, originCandidate, `T05/CAT14-18: appDetailOrigin must record ${originCandidate}`);
      assert.strictEqual(app.state.appDetailReturnView, originCandidate, `T05/CAT14-18: appDetailReturnView alias must match appDetailOrigin (${originCandidate})`);
      app.handleSystemBackNavigation();
      assert.strictEqual(app.state.activeView, originCandidate, `T05: Back from APP_DETAIL must return to ${originCandidate}`);
    }

    // Enter ALL_APPS from STATS and APP_LIMITS from ALL_APPS -> Back returns to ALL_APPS then STATS (CAT14-06)
    app.switchView("OVERVIEW");
    app.switchView("STATS");
    app.switchView("ALL_APPS");
    assert.strictEqual(app.state.allAppsOrigin, "STATS", "T05/CAT14-06: allAppsOrigin must record STATS");
    app.switchView("APP_LIMITS");
    assert.strictEqual(app.state.appLimitsOrigin, "ALL_APPS", "T05/CAT14-06: appLimitsOrigin must record ALL_APPS");
    app.handleSystemBackNavigation();
    assert.strictEqual(app.state.activeView, "ALL_APPS", "T05/CAT14-06: Back from APP_LIMITS must return to ALL_APPS (not OVERVIEW)");
    app.handleSystemBackNavigation();
    assert.strictEqual(app.state.activeView, "STATS", "T05/CAT14-06: Back from ALL_APPS must return to STATS (not OVERVIEW)");
    app.handleSystemBackNavigation();
    assert.strictEqual(app.state.activeView, "OVERVIEW", "T05/CAT14-06: Next Back from STATS returns to OVERVIEW");

    // Multi-hop navigation OVERVIEW -> FOCUS -> ACCOUNT -> THEME_STYLE (Step 8.1)
    app.switchView("OVERVIEW");
    app.switchView("FOCUS", { preserveHistory: true });
    app.switchView("ACCOUNT", { preserveHistory: true });
    app.switchView("THEME_STYLE");
    assert.strictEqual(app.state.activeView, "THEME_STYLE", "T05/Step 8.1: At THEME_STYLE");
    app.handleSystemBackNavigation();
    assert.strictEqual(app.state.activeView, "ACCOUNT", "T05/Step 8.1: Back 1 unwinds THEME_STYLE -> ACCOUNT");
    app.handleSystemBackNavigation();
    assert.strictEqual(app.state.activeView, "FOCUS", "T05/Step 8.1: Back 2 unwinds ACCOUNT -> FOCUS");
    app.handleSystemBackNavigation();
    assert.strictEqual(app.state.activeView, "OVERVIEW", "T05/Step 8.1: Back 3 unwinds FOCUS -> OVERVIEW");

    // T06 — Help landings (CAT14-21): identical state from hardware/popstate Back and in-app Back
    for (const helpView of ["CROSS_DEVICE_GUIDE", "FAQ_VERIFICATION"]) {
      app.switchView("ACCOUNT");
      if (helpView === "CROSS_DEVICE_GUIDE") app.HelpCenterController.openCrossDeviceGuide("ACCOUNT");
      else app.HelpCenterController.openFaqVerificationSuite("ACCOUNT");
      assert.strictEqual(app.state.activeView, helpView, `T06: Opened ${helpView}`);
      // Hardware/popstate back
      app.handleSystemBackNavigation({ fromPopState: true });
      const hwState = {
        activeView: app.state.activeView,
        drawerHidden: sandbox.document.getElementById("accountHelpSupportDrawer").classList.contains("hidden"),
        chevronRotated: sandbox.document.getElementById("accountHelpSupportChevron").classList.contains("rotate-90"),
        ariaExpanded: sandbox.document.getElementById("btnAccountHelpSupportRow").getAttribute("aria-expanded")
      };
      // Re-open and use in-app back button
      if (helpView === "CROSS_DEVICE_GUIDE") {
        app.HelpCenterController.openCrossDeviceGuide("ACCOUNT");
        sandbox.document.getElementById("btnBackFromCrossDeviceGuide").click();
      } else {
        app.HelpCenterController.openFaqVerificationSuite("ACCOUNT");
        sandbox.document.getElementById("btnBackFromFaqVerification").click();
      }
      const inAppState = {
        activeView: app.state.activeView,
        drawerHidden: sandbox.document.getElementById("accountHelpSupportDrawer").classList.contains("hidden"),
        chevronRotated: sandbox.document.getElementById("accountHelpSupportChevron").classList.contains("rotate-90"),
        ariaExpanded: sandbox.document.getElementById("btnAccountHelpSupportRow").getAttribute("aria-expanded")
      };
      assert.deepStrictEqual(hwState, inAppState, `T06/CAT14-21: Hardware Back and in-app Back from ${helpView} must produce identical Account landing state`);
      assert.strictEqual(hwState.drawerHidden, false, `T06/CAT14-21: Returning to ACCOUNT from ${helpView} must keep #accountHelpSupportDrawer open`);
    }

    // Origin-aware Help return to OVERVIEW when opened from OVERVIEW (CAT14-21)
    app.switchView("OVERVIEW");
    app.HelpCenterController.openFaqVerificationSuite("OVERVIEW");
    app.handleSystemBackNavigation();
    assert.strictEqual(app.state.activeView, "OVERVIEW", "T06/CAT14-21: FAQ_VERIFICATION opened from OVERVIEW must return to OVERVIEW on Back");

    // T07 — Swipe controller thresholds, horizontal scroll exclusion & native lockout (CAT14-19)
    app.switchView("OVERVIEW");
    app.switchView("STATS");
    const shortSwipe = app.TouchBackGestureController.simulateEdgeSwipeBack({ startX: 10, endX: 40 });
    assert.strictEqual(shortSwipe, false, "T07: Swipe shorter than 64px must not trigger Back");
    assert.strictEqual(app.state.activeView, "STATS", "T07: View remains STATS after short swipe");

    const horizTarget = {
      tagName: "DIV",
      className: "flex overflow-x-auto gap-2",
      clientWidth: 200,
      scrollWidth: 480,
      getAttribute: () => null,
      parentElement: null
    };
    assert.strictEqual(app.TouchBackGestureController.isExcludedTouchTarget(horizTarget), true, "T07/CAT14-19: Horizontally scrollable element must be excluded from edge-swipe Back");
    const excludedSwipe = app.TouchBackGestureController.simulateEdgeSwipeBack({ target: horizTarget });
    assert.strictEqual(excludedSwipe, false, "T07/CAT14-19: Edge swipe starting on horizontal scroller must not trigger Back");

    // Native back lockout prevents double-fire within 320ms (CAT14-19)
    app.TouchBackGestureController._lastNativeBackAtMs = Date.now();
    const lockedOutSwipe = app.TouchBackGestureController.simulateEdgeSwipeBack({ enforceLockout: true });
    assert.strictEqual(lockedOutSwipe, false, "T07/CAT14-19: Edge swipe within 320ms of native Android back must be suppressed");
    app.TouchBackGestureController._lastNativeBackAtMs = 0;

    // T08 — Root back canonical behaviour per platform (CAT14-09, CAT14-10)
    app.switchView("OVERVIEW");
    let rootMinimizeCalls = 0;
    const origNativeBridgeT08 = sandbox.window.ScreenSyncNativeBridge;
    sandbox.window.ScreenSyncNativeBridge = Object.assign({}, origNativeBridgeT08 || {}, {
      minimizeAppToHomeScreen() {
        rootMinimizeCalls += 1;
        return true;
      }
    });
    const androidRootRes = app.handleSystemBackNavigation({ fromAndroidNativeBack: true });
    assert.strictEqual(androidRootRes, false, "T08/CAT14-09: Root back with fromAndroidNativeBack: true must return false");
    assert.strictEqual(rootMinimizeCalls, 0, "T08/CAT14-10: Hardware native back at root must NOT call JS minimizeAppToHomeScreen (native moveTaskToBack handles it)");
    assert.strictEqual(app.state.lastBackNavigationSource, "ANDROID_NATIVE_BACK", "T08/CAT14-09: lastBackNavigationSource must record ANDROID_NATIVE_BACK");

    const swipeRootRes = app.handleSystemBackNavigation({ fromTouchEdgeSwipe: true, triggerNativeMinimize: true });
    assert.strictEqual(swipeRootRes, false, "T08/CAT14-10: Swipe root back must return false");
    assert.strictEqual(rootMinimizeCalls, 1, "T08/CAT14-10: Swipe root back must invoke minimizeAppToHomeScreen exactly once");
    sandbox.window.ScreenSyncNativeBridge = origNativeBridgeT08;
    app.TouchBackGestureController._lastNativeBackAtMs = 0;

    // T09 — Guide per-platform setup steps, FAQ content & dead wiring removal (CAT14-13, CAT14-14, CAT14-17, CAT14-22)
    for (const plat of ["Android", "iOS", "Windows", "macOS", "Linux", "BrowserExtension"]) {
      assert(
        html.includes(`data-platform-guide="${plat}"`),
        `T09/CAT14-14: #viewCrossDeviceGuide must include per-platform step-by-step section for ${plat}`
      );
    }
    assert(html.includes("screensync_linux_companion.py"), "T09/CAT14-14: Cross-Device Guide must reference screensync_linux_companion.py");
    assert(!html.includes('id="btnReturnToAccountFromGuide"') && !html.includes('id="btnReturnToAccountFromFaq"'), "T09/CAT14-22: Duplicate bottom Help back buttons must not exist in HTML");

    app.HelpCenterController.initFaqAccordion();
    assert.strictEqual(app.HelpCenterController.FAQ_ITEMS.length, 14, "T09: FAQ must contain 14 items");
    const faq10 = app.HelpCenterController.FAQ_ITEMS.find(i => i.id === "supported_os_limits");
    assert(faq10 && faq10.answer.includes("Linux") && faq10.answer.includes("screensync_linux_companion.py"), "T09/Step 8.2: FAQ #10 must include Linux setup details");
    const faqBtn1 = sandbox.document.getElementById("faqBtn_account_login");
    const faqAns1 = sandbox.document.getElementById("faqAnswer_account_login");
    assert(faqBtn1.className.includes("faq-question-btn") && faqBtn1.className.includes("faq-item-toggle"), "T09/CAT14-13: FAQ buttons must have both .faq-question-btn and .faq-item-toggle");
    assert.strictEqual(faqAns1.getAttribute("data-faq-animated"), "true", "T09/CAT14-17: FAQ answer panels must include smooth transition animation support");

    // Verify aliases in AUTH_DOM_ID_ALIASES (CAT14-13)
    assert.strictEqual(sandbox.document.getElementById("verificationSuiteChecksList"), sandbox.document.getElementById("verificationSuiteItemsList"), "T09/CAT14-13: #verificationSuiteChecksList must alias #verificationSuiteItemsList");
    assert.strictEqual(sandbox.document.getElementById("btnBackFromFaq"), sandbox.document.getElementById("btnBackFromFaqVerification"), "T09/CAT14-13: #btnBackFromFaq must alias #btnBackFromFaqVerification");
    assert.strictEqual(sandbox.document.getElementById("viewAppLimitsHub"), sandbox.document.getElementById("viewAppLimits"), "T09/CAT14-13: #viewAppLimitsHub must alias #viewAppLimits");

    // T10 — Scroll auto-collapse coverage, grace period / anchor & aria-expanded reset (CAT14-15, CAT14-16)
    app.switchView("ACCOUNT");
    const helpDrwT10 = sandbox.document.getElementById("accountHelpSupportDrawer");
    const helpBtnT10 = sandbox.document.getElementById("btnAccountHelpSupportRow");
    if (!helpDrwT10.classList.contains("hidden")) {
      helpBtnT10.click();
    }
    const mainScroller = sandbox.document.getElementById("appMainContainer");
    if (mainScroller) mainScroller.scrollTop = 300;
    helpBtnT10.click();
    assert(!helpDrwT10.classList.contains("hidden"), "T10: #accountHelpSupportDrawer opened while container is at scrollTop 300");
    assert.strictEqual(helpBtnT10.getAttribute("aria-expanded"), "true", "T10/CAT14-16: Opening drawer must set aria-expanded='true' on toggle button");

    // Small scroll (scrollTop 330 -> delta 30px <= 140px) must NOT collapse drawer (CAT14-15c)
    if (mainScroller) mainScroller.scrollTop = 330;
    sandbox.window.__ssAccountScrollCheck({ target: { scrollTop: 330 } });
    assert(!helpDrwT10.classList.contains("hidden"), "T10/CAT14-15c: Small 30px scroll after opening drawer at scrollTop 300 must NOT collapse it");

    // Scroll > 140px from open anchor (scrollTop 460 -> delta 160px > 140px) MUST collapse drawer and reset aria-expanded="false"
    if (mainScroller) mainScroller.scrollTop = 460;
    sandbox.window.__ssAccountScrollCheck({ target: { scrollTop: 460 } });
    assert(helpDrwT10.classList.contains("hidden"), "T10/CAT14-15: Scrolling >140px from open anchor must collapse drawer");
    assert.strictEqual(helpBtnT10.getAttribute("aria-expanded"), "false", "T10/CAT14-16: Scroll collapse must reset aria-expanded='false' on toggle button");
    if (mainScroller) mainScroller.scrollTop = 0;

    // Also verify back-navigation collapse resets aria-expanded="false" (CAT14-16)
    sandbox.document.getElementById("btnAccountDataExportRow").click();
    assert.strictEqual(sandbox.document.getElementById("btnAccountDataExportRow").getAttribute("aria-expanded"), "true", "T10/CAT14-16: aria-expanded='true' on #btnAccountDataExportRow when opened");
    app.handleSystemBackNavigation();
    assert.strictEqual(sandbox.document.getElementById("btnAccountDataExportRow").getAttribute("aria-expanded"), "false", "T10/CAT14-16: Back collapse must reset aria-expanded='false' on #btnAccountDataExportRow");

    // T11 — Verification rows: Heartbeats, Interval Union, Reel FSM, honest Data Backup & Activity Tracking, Checked at (CAT14-11, CAT14-12)
    const uidT11 = app.getActiveOrLocalUserId();
    if (!app.BackendDB.data.trackerHeartbeatsByUser) app.BackendDB.data.trackerHeartbeatsByUser = {};
    app.BackendDB.data.trackerHeartbeatsByUser[uidT11] = {
      inst_stale_linux: {
        userId: uidT11,
        installationId: "inst_stale_linux",
        trackerName: "LinuxCompanion",
        lastSeenUtcMs: Date.now() - (25 * 60 * 1000) // 25 minutes ago -> Stale
      }
    };
    const repStale = app.HelpCenterController.renderVerificationSuite();
    assert(repStale.trackerHeartbeatsStatus.staleCount >= 1 && repStale.trackerHeartbeatsStatus.badge.startsWith("Stale"), "T11/CAT14-11: Stale companion (>10m) must report Stale badge");
    const verifHtmlStale = sandbox.document.getElementById("verificationSuiteItemsList").innerHTML;
    assert(
      verifHtmlStale.includes("verifyRowHeartbeats") &&
      verifHtmlStale.includes("verifyRowIntervalUnion") &&
      verifHtmlStale.includes("verifyRowReelFsm") &&
      verifHtmlStale.includes("verifyRowCheckedAt") &&
      verifHtmlStale.includes("Checked at "),
      "T11/CAT14-11/CAT14-12: Verification Suite must render Heartbeats, Interval Union, Reel FSM, and Checked at rows"
    );
    delete app.BackendDB.data.trackerHeartbeatsByUser[uidT11];
    app.HelpCenterController.renderVerificationSuite();

    // T12, T13 & T14 — Refresh button visibility/toast honesty, Automated suite real assertions & try/finally isolation (CAT14-02, CAT14-03, CAT14-04)
    const dbBeforeT14 = JSON.stringify(app.BackendDB.data);
    const userBeforeT14 = app.state.currentUser ? Object.assign({}, app.state.currentUser) : null;
    const themeBeforeT14 = app.state.appTheme;

    const cleanSuiteRes = app.runAutomatedVerificationSuite({ silentToast: true });
    assert.strictEqual(cleanSuiteRes.passed, 21, "T13/CAT14-03: All 21 real assertions must pass on healthy runtime");
    assert.strictEqual(cleanSuiteRes.failed, 0, "T13/CAT14-03: failed count must be 0 on healthy runtime");
    assert.strictEqual(cleanSuiteRes.fixtureDate, app.getTodayLocalDateStr(), "T13/CAT14-03: Session reconstruction fixture date must be today, not hardcoded 2026-10-16");
    assert.strictEqual(JSON.stringify(app.BackendDB.data), dbBeforeT14, "T14/CAT14-04: Live BackendDB.data must be 100% unchanged after runAutomatedVerificationSuite");
    assert.deepStrictEqual(app.state.currentUser ? Object.assign({}, app.state.currentUser) : null, userBeforeT14, "T14/CAT14-04: state.currentUser must be unchanged");
    assert.strictEqual(app.state.appTheme, themeBeforeT14, "T14/CAT14-04: state.appTheme must be unchanged");
    assert(!Object.keys(app.BackendDB.data.dedupLog).some(k => k.startsWith("test_")), "T14/CAT14-04: No test_* keys may remain in dedupLog");

    // Force a mid-suite throw and verify try/finally still restores state (T14 / CAT14-04)
    let threwAsExpected = false;
    try {
      app.runAutomatedVerificationSuite({ simulateThrow: true, silentToast: true });
    } catch (err) {
      threwAsExpected = true;
    }
    assert.strictEqual(threwAsExpected, true, "T14/CAT14-04: simulateThrow must throw");
    assert.deepStrictEqual(app.state.currentUser ? Object.assign({}, app.state.currentUser) : null, userBeforeT14, "T14/CAT14-04: state.currentUser must be restored in finally after a throw");
    assert.strictEqual(app.state.appTheme, themeBeforeT14, "T14/CAT14-04: state.appTheme must be restored in finally after a throw");
    assert.strictEqual(JSON.stringify(app.BackendDB.data), dbBeforeT14, "T14/CAT14-04: BackendDB.data must be restored in finally after a throw");

    // Deliberately break a check and verify Refresh button shows failure toast and reveals output (T12 & T13)
    const brokenSuiteRes = app.runAutomatedVerificationSuite({ silentToast: true, faultInjection: { reelCountDeltaOverride: 9 } });
    assert(brokenSuiteRes.failed >= 1 && brokenSuiteRes.failures.some(f => f.includes("1. Unified Reel Tracking")), "T13/CAT14-03: Broken reel count fixture must fail Check 1");

    sandbox.window.__ssVerificationFaultInjection = { failCheck1: true };
    sandbox.document.getElementById("btnRefreshVerificationSuite").click();
    const outElT12 = sandbox.document.getElementById("verificationSuiteSelfCheckOutput");
    assert(!outElT12.classList.contains("hidden") && outElT12.getAttribute("aria-hidden") === "false", "T12/CAT14-02: Failing check must unhide #verificationSuiteSelfCheckOutput");
    assert.strictEqual(sandbox.document.getElementById("toastTitle").textContent, "Verification Issue Detected", "T12/CAT14-02: Failing check must show failure toast");
    assert(sandbox.document.getElementById("toastMessage").textContent.includes("1. Unified Reel Tracking"), "T12/CAT14-02: Failure toast must name failing check");
    delete sandbox.window.__ssVerificationFaultInjection;
    sandbox.document.getElementById("btnRefreshVerificationSuite").click();
    assert.strictEqual(sandbox.document.getElementById("toastTitle").textContent, "Status Verified", "T12/CAT14-02: Healthy re-run restores Status Verified toast");

    // T15 — Complete 7-Layer Back-Navigation Coverage (CAT14-20)
    app.switchView("OVERVIEW");
    // Layer 3: Header device dropdown
    const ovDrop = sandbox.document.getElementById("deviceDropdownMenu");
    ovDrop.classList.remove("hidden");
    assert.strictEqual(app.handleSystemBackNavigation(), true, "T15 Layer 3: Back closes #deviceDropdownMenu");
    assert(ovDrop.classList.contains("hidden"), "T15 Layer 3: #deviceDropdownMenu is hidden");

    // Layer 2: Auth modal step unwind (Forgot step 2 -> Forgot step 1 -> Login -> close)
    const authMod = sandbox.document.getElementById("authModal");
    const forgotForm = sandbox.document.getElementById("authFormForgot");
    const forgotStep1 = sandbox.document.getElementById("forgotStep1Email");
    const forgotStep2 = sandbox.document.getElementById("forgotStep2Reset");
    authMod.classList.remove("hidden");
    app.state.authTab = "FORGOT";
    forgotForm.classList.remove("hidden");
    forgotStep1.className = "hidden";
    forgotStep2.className = "flex flex-col gap-3.5";
    assert.strictEqual(app.handleSystemBackNavigation(), true, "T15 Layer 2a: Back unwinds Forgot step 2 to step 1");
    assert(forgotStep2.classList.contains("hidden") && !forgotStep1.classList.contains("hidden"), "T15 Layer 2a: Forgot step 1 visible");
    assert.strictEqual(app.handleSystemBackNavigation(), true, "T15 Layer 2b: Back unwinds Forgot tab to LOGIN tab");
    assert.strictEqual(app.state.authTab, "LOGIN", "T15 Layer 2b: authTab is LOGIN");
    assert.strictEqual(app.handleSystemBackNavigation(), true, "T15 Layer 2c: Back closes #authModal from LOGIN tab");
    assert(authMod.classList.contains("hidden"), "T15 Layer 2c: #authModal is hidden");

    // Layer 5: Focus stats sub-tab -> Focus timer sub-tab
    app.switchView("FOCUS");
    sandbox.document.getElementById("btnFocusSubStats").click();
    assert(!sandbox.document.getElementById("focusStatsSubView").classList.contains("hidden"), "T15 Layer 5: Focus stats sub-view visible");
    assert.strictEqual(app.handleSystemBackNavigation(), true, "T15 Layer 5: Back switches Focus stats sub-view back to timer sub-view");
    assert(sandbox.document.getElementById("focusStatsSubView").classList.contains("hidden"), "T15 Layer 5: Focus stats sub-view hidden");
    assert.strictEqual(app.handleSystemBackNavigation(), true, "T15 Layer 6: Back from FOCUS returns to OVERVIEW");
    assert.strictEqual(app.state.activeView, "OVERVIEW", "T15 Layer 6: Back on OVERVIEW");

    // =========================================================================
    // PART 14B EXTENDED DELTA ACCEPTANCE TESTS (T19–T32: T-NAV-01..10, T-GES-01..03,
    // T-DRW-01..03, T-HLP-01..08, T-VER-01..05, ISSUE-C14-01..07, CAT14-001..013)
    // =========================================================================

    // T19 — Part 14B (ISSUE-C14-01 / C14-1-03 / CAT14-004): Single-push sub-window lifecycle for NOTIFICATION_SETTINGS & PRIVACY_COMPLIANCE
    app.switchView("OVERVIEW");
    app.switchView("ACCOUNT");
    assert.strictEqual(app.state.navHistoryDepth, 1, "T19: ACCOUNT must have navHistoryDepth === 1");
    app.openNotificationSettingsWindow();
    assert.strictEqual(app.state.activeView, "NOTIFICATION_SETTINGS", "T19: activeView must be NOTIFICATION_SETTINGS");
    assert.strictEqual(app.state.navHistoryDepth, 2, "T19/ISSUE-C14-01: openNotificationSettingsWindow must push exactly 1 entry above ACCOUNT (depth 2, not 3)");
    assert.strictEqual(app.handleSystemBackNavigation(), true, "T19: 1st Back from NOTIFICATION_SETTINGS must return true");
    assert.strictEqual(app.state.activeView, "ACCOUNT", "T19: 1st Back must return to ACCOUNT");
    assert.strictEqual(app.state.navHistoryDepth, 1, "T19: navHistoryDepth on ACCOUNT after closing NOTIFICATION_SETTINGS must be 1");

    app.StoreComplianceAndPrivacyManager.openPrivacyComplianceWindow();
    assert.strictEqual(app.state.activeView, "PRIVACY_COMPLIANCE", "T19: activeView must be PRIVACY_COMPLIANCE");
    assert.strictEqual(app.state.navHistoryDepth, 2, "T19/ISSUE-C14-01: openPrivacyComplianceWindow must push exactly 1 entry above ACCOUNT (depth 2, not 3)");
    assert.strictEqual(app.handleSystemBackNavigation(), true, "T19: 1st Back from PRIVACY_COMPLIANCE must return true");
    assert.strictEqual(app.state.activeView, "ACCOUNT", "T19: 1st Back must return to ACCOUNT");
    assert.strictEqual(app.state.navHistoryDepth, 1, "T19: navHistoryDepth on ACCOUNT after closing PRIVACY_COMPLIANCE must be 1");

    // T20 — Part 14B (ISSUE-C14-01 / C14-1-06 / T-NAV-06): Header back buttons on CROSS_DEVICE_GUIDE, FAQ_VERIFICATION, and BRAIN_STATE decrement navHistoryDepth cleanly
    app.HelpCenterController.openCrossDeviceGuide("ACCOUNT");
    assert.strictEqual(app.state.activeView, "CROSS_DEVICE_GUIDE", "T20: activeView must be CROSS_DEVICE_GUIDE");
    assert.strictEqual(app.state.navHistoryDepth, 2, "T20: CROSS_DEVICE_GUIDE depth must be 2");
    sandbox.document.getElementById("btnBackFromCrossDeviceGuide").click();
    assert.strictEqual(app.state.activeView, "ACCOUNT", "T20: #btnBackFromCrossDeviceGuide must return to ACCOUNT");
    assert.strictEqual(app.state.navHistoryDepth, 1, "T20/T-NAV-06: #btnBackFromCrossDeviceGuide must decrement navHistoryDepth to 1");
    // Close #accountHelpSupportDrawer re-opened by returnToHelpSupportLanding
    if (!sandbox.document.getElementById("accountHelpSupportDrawer").classList.contains("hidden")) {
      sandbox.document.getElementById("btnAccountHelpSupportRow").click();
    }

    app.HelpCenterController.openFaqVerificationSuite("ACCOUNT");
    assert.strictEqual(app.state.activeView, "FAQ_VERIFICATION", "T20: activeView must be FAQ_VERIFICATION");
    assert.strictEqual(app.state.navHistoryDepth, 2, "T20: FAQ_VERIFICATION depth must be 2");
    sandbox.document.getElementById("btnBackFromFaqVerification").click();
    assert.strictEqual(app.state.activeView, "ACCOUNT", "T20: #btnBackFromFaqVerification must return to ACCOUNT");
    assert.strictEqual(app.state.navHistoryDepth, 1, "T20/T-NAV-06: #btnBackFromFaqVerification must decrement navHistoryDepth to 1");
    if (!sandbox.document.getElementById("accountHelpSupportDrawer").classList.contains("hidden")) {
      sandbox.document.getElementById("btnAccountHelpSupportRow").click();
    }

    // T21 — Part 14B (CAT14-005): BRAIN_STATE #brainFormulaBreakdownPopover unwinds before leaving BRAIN_STATE, then #btnBackFromBrainStateVisual returns to ACCOUNT
    app.ScreenSyncWellnessEngine.openBrainStatePage();
    assert.strictEqual(app.state.activeView, "BRAIN_STATE", "T21: activeView must be BRAIN_STATE");
    const formulaPop = sandbox.document.getElementById("brainFormulaBreakdownPopover");
    const formulaHint = sandbox.document.getElementById("brainScoreAuthoritativeFormulaHint");
    formulaHint.click();
    assert(!formulaPop.classList.contains("hidden") && formulaHint.getAttribute("aria-expanded") === "true", "T21: #brainFormulaBreakdownPopover must open on click");
    assert.strictEqual(app.handleSystemBackNavigation(), true, "T21: 1st Back on BRAIN_STATE with open formula popover must return true");
    assert(formulaPop.classList.contains("hidden") && formulaHint.getAttribute("aria-expanded") === "false", "T21: 1st Back must close #brainFormulaBreakdownPopover and reset aria-expanded");
    assert.strictEqual(app.state.activeView, "BRAIN_STATE", "T21: Must remain on BRAIN_STATE after closing formula popover");
    sandbox.document.getElementById("btnBackFromBrainStateVisual").click();
    assert.strictEqual(app.state.activeView, "ACCOUNT", "T21: #btnBackFromBrainStateVisual must return to ACCOUNT");
    assert.strictEqual(app.state.navHistoryDepth, 1, "T21: navHistoryDepth must be 1 on ACCOUNT");

    // T22 — Part 14B (T-NAV-02 / T-NAV-05 / C14-1-04 / C14-1-05): Symmetric modal push/pop & unmatched close protection
    app.openAuthModal("LOGIN");
    assert.strictEqual(app.state.navHistoryDepth, 2, "T22: openAuthModal must push MODAL_authModal (depth 2)");
    app.closeAuthModal();
    assert.strictEqual(app.state.navHistoryDepth, 1, "T22: closeAuthModal must pop MODAL_authModal (depth 1)");
    // Calling closeAuthModal again when already closed must NOT pop VIEW_ACCOUNT
    app.closeAuthModal();
    assert.strictEqual(app.state.navHistoryDepth, 1, "T22/T-NAV-02: Calling closeAuthModal when already closed must not pop VIEW_ACCOUNT");
    // Calling onOverlayClosed for an overlay that was never pushed must NOT pop VIEW_ACCOUNT
    const unpushedRes = app.NavigationHistoryBridge.onOverlayClosed("accessibilityDisclosureModal");
    assert.strictEqual(unpushedRes.ignoredUnmatched, true, "T22/C14-1-04: Unmatched overlay close must be ignored without popping VIEW_ACCOUNT");
    assert.strictEqual(app.state.navHistoryDepth, 1, "T22/C14-1-04: navHistoryDepth must still be 1");

    // Brain milestone overlay symmetric push/pop
    app.ScreenSyncWellnessEngine.checkAndTriggerMilestoneOverlay(50, { force: true });
    assert.strictEqual(app.state.navHistoryDepth, 2, "T22/T-NAV-05: checkAndTriggerMilestoneOverlay must push MODAL_brainStateMilestoneOverlay");
    app.ScreenSyncWellnessEngine.dismissMilestoneOverlay();
    assert.strictEqual(app.state.navHistoryDepth, 1, "T22/T-NAV-05: dismissMilestoneOverlay must pop MODAL_brainStateMilestoneOverlay");

    // T23 — Part 14B (T-NAV-07 / T-NAV-08 / T-NAV-10): NavigationHistoryBridge currentIdx, ssIdx, pushState error safety, forward popstate no-op, and global handleNativeBack
    assert.strictEqual(app.NavigationHistoryBridge.currentIdx, 1, "T23: NavigationHistoryBridge.currentIdx must equal navHistoryDepth (1)");
    assert.strictEqual(typeof sandbox.window.handleSystemBackNavigation, "function", "T23/T-NAV-10: window.handleSystemBackNavigation must be exposed globally");
    assert.strictEqual(typeof app.handleNativeBack, "function", "T23/T-NAV-10: ScreenSyncApp.handleNativeBack must be exposed");
    const origPushState = sandbox.window.history.pushState;
    sandbox.window.history.pushState = function () {
      throw new Error("Simulated DOMException pushState quota exceeded");
    };
    const failedPushRes = app.NavigationHistoryBridge.pushNavigationState("MODAL_testFail", { modal: "testFail" });
    sandbox.window.history.pushState = origPushState;
    assert.strictEqual(failedPushRes.pushed, false, "T23/T-NAV-08: pushNavigationState must return pushed: false when history.pushState throws");
    assert.strictEqual(app.state.navHistoryDepth, 1, "T23/T-NAV-08: navHistoryDepth must not increment when history.pushState throws");

    // Simulate Forward popstate (ssIdx > currentIdx) -> must be ignored as no-op without unwinding ACCOUNT
    sandbox.window.dispatchEvent({ type: "popstate", state: { ssManaged: true, ssIdx: 3, depth: 3 } });
    assert.strictEqual(app.state.activeView, "ACCOUNT", "T23/T-NAV-07: Forward popstate (ssIdx > currentIdx) must be treated as no-op and keep activeView on ACCOUNT");

    // T24 — Part 14B (ISSUE-C14-02): #accountDevicesPanelBody Layer 4 Back unwind & chevron/aria-expanded sync
    const devPanelBody = sandbox.document.getElementById("accountDevicesPanelBody");
    const devPanelBtn = sandbox.document.getElementById("btnToggleAccountDevicesPanel");
    const devPanelChv = sandbox.document.getElementById("accountDevicesChevron");
    if (!devPanelBody.classList.contains("hidden")) {
      devPanelBtn.click(); // collapse initial default open state
    }
    assert(devPanelBody.classList.contains("hidden"), "T24: #accountDevicesPanelBody collapsed");
    devPanelBtn.click(); // explicitly expand via user click
    assert(!devPanelBody.classList.contains("hidden") && devPanelChv.classList.contains("rotate-90"), "T24: #accountDevicesPanelBody expanded with rotate-90 chevron");
    assert.strictEqual(devPanelBtn.getAttribute("aria-expanded"), "true", "T24: #btnToggleAccountDevicesPanel aria-expanded must be 'true'");
    assert.strictEqual(app.handleSystemBackNavigation(), true, "T24/ISSUE-C14-02: Back on ACCOUNT with user-expanded #accountDevicesPanelBody must collapse it in Layer 4");
    assert(devPanelBody.classList.contains("hidden") && !devPanelChv.classList.contains("rotate-90"), "T24/ISSUE-C14-02: #accountDevicesPanelBody must be hidden and chevron reset");
    assert.strictEqual(devPanelBtn.getAttribute("aria-expanded"), "false", "T24/ISSUE-C14-02: #btnToggleAccountDevicesPanel aria-expanded must reset to 'false'");
    assert.strictEqual(app.state.activeView, "ACCOUNT", "T24: Must remain on ACCOUNT after collapsing #accountDevicesPanelBody");

    // T25 — Part 14B (ISSUE-C14-04 / T-DRW-01 / T-DRW-01b): Scroll auto-collapse pops drawer history entry & out-of-order close safety
    const exportBtn = sandbox.document.getElementById("btnAccountDataExportRow");
    const exportDrw = sandbox.document.getElementById("accountDataExportDrawer");
    const scroller25 = sandbox.document.getElementById("appMainContainer");
    if (scroller25) scroller25.scrollTop = 100;
    exportBtn.click();
    assert(!exportDrw.classList.contains("hidden"), "T25: #accountDataExportDrawer opened");
    assert.strictEqual(app.state.navHistoryDepth, 2, "T25: Opening #accountDataExportDrawer increments navHistoryDepth to 2");
    if (scroller25) scroller25.scrollTop = 300;
    sandbox.window.__ssAccountScrollCheck({ target: { scrollTop: 300 } });
    assert(exportDrw.classList.contains("hidden"), "T25: Scroll > 140px auto-collapsed #accountDataExportDrawer");
    assert.strictEqual(app.state.navHistoryDepth, 1, "T25/ISSUE-C14-04/T-DRW-01: Scroll auto-collapse must pop DRAWER_accountDataExportDrawer so navHistoryDepth returns to 1");
    if (scroller25) scroller25.scrollTop = 0;

    // Out-of-order close (T-DRW-01b): open drawer (depth 2), open modal on top (depth 3), scroll-collapse drawer while modal is open
    exportBtn.click();
    assert.strictEqual(app.state.navHistoryDepth, 2, "T25b: Drawer opened at depth 2");
    app.openAuthModal("LOGIN");
    assert.strictEqual(app.state.navHistoryDepth, 3, "T25b: Auth modal opened on top at depth 3");
    if (scroller25) scroller25.scrollTop = 300;
    sandbox.window.__ssAccountScrollCheck({ target: { scrollTop: 300 } });
    if (scroller25) scroller25.scrollTop = 0;
    assert(exportDrw.classList.contains("hidden"), "T25b: Drawer auto-collapsed underneath open modal");
    assert(!sandbox.document.getElementById("authModal").classList.contains("hidden"), "T25b/T-DRW-01b: Top modal must remain open when underlying drawer closes out-of-order");
    assert.strictEqual(app.state.navHistoryDepth, 2, "T25b/T-DRW-01b: Out-of-order drawer close must reduce depth from 3 to 2");
    app.closeAuthModal();
    assert.strictEqual(app.state.navHistoryDepth, 1, "T25b: Closing modal brings depth back to 1 on ACCOUNT");

    // T26 — Part 14B (T-GES-01 / ISSUE-C14-03): TouchBackGestureController touchcancel, multi-touch abort, and 220ms cross-source debounce
    app.TouchBackGestureController.handleTouchStart({
      target: sandbox.document.body,
      touches: [{ clientX: 10, clientY: 300 }],
      timeStamp: 1000
    });
    assert(app.TouchBackGestureController._activeGesture !== null, "T26: Single-finger edge touchstart starts active gesture");
    app.TouchBackGestureController.handleTouchCancel({});
    assert.strictEqual(app.TouchBackGestureController._activeGesture, null, "T26/T-GES-01: handleTouchCancel must clear _activeGesture");
    assert.strictEqual(app.TouchBackGestureController.handleTouchEnd({ changedTouches: [{ clientX: 120, clientY: 300 }], timeStamp: 1120 }), null, "T26/T-GES-01: touchend after touchcancel must not trigger back navigation");

    // Multi-touch start abort
    app.TouchBackGestureController.handleTouchStart({
      target: sandbox.document.body,
      touches: [{ clientX: 10, clientY: 300 }, { clientX: 50, clientY: 320 }],
      timeStamp: 1200
    });
    assert.strictEqual(app.TouchBackGestureController._activeGesture, null, "T26: Multi-touch touchstart must abort gesture");

    // 220ms cross-source debounce (ISSUE-C14-03): edge swipe unwinds ACCOUNT -> OVERVIEW, then immediate Android native back within 220ms is absorbed
    const swipeBackToOverview = app.TouchBackGestureController.simulateEdgeSwipeBack();
    assert.strictEqual(swipeBackToOverview, true, "T26: Edge swipe on ACCOUNT unwinds to OVERVIEW");
    assert.strictEqual(app.state.activeView, "OVERVIEW", "T26: Now on OVERVIEW");
    const immediateNativeBack = app.handleSystemBackNavigation({ fromAndroidNativeBack: true });
    assert.strictEqual(immediateNativeBack, true, "T26/ISSUE-C14-03: Android native back within 220ms of handled touch edge swipe must return true (debounced) so app does not double-pop or minimize");
    app.state.lastTouchSwipeHandledAtMs = 0;
    assert.strictEqual(app.handleSystemBackNavigation({ fromAndroidNativeBack: true }), false, "T26: After 220ms window, Android native back at root OVERVIEW returns false for moveTaskToBack(true)");

    // T27 — Part 14B (CAT14-005): #btnBackFromFocus unwinds #focusStatsSubView to #focusTimerSubView before leaving FOCUS
    app.switchView("ACCOUNT");
    app.switchView("FOCUS", { fromAccountGoals: true });
    assert.strictEqual(app.state.activeView, "FOCUS", "T27: Opened FOCUS from ACCOUNT");
    sandbox.document.getElementById("btnFocusSubStats").click();
    assert(!sandbox.document.getElementById("focusStatsSubView").classList.contains("hidden"), "T27: #focusStatsSubView is visible");
    sandbox.document.getElementById("btnBackFromFocus").click();
    assert.strictEqual(app.state.activeView, "FOCUS", "T27/CAT14-005: Clicking #btnBackFromFocus while on Focus Stats must stay on FOCUS and switch to Timer sub-view first");
    assert(sandbox.document.getElementById("focusStatsSubView").classList.contains("hidden"), "T27/CAT14-005: #focusStatsSubView must be hidden");
    sandbox.document.getElementById("btnBackFromFocus").click();
    assert.strictEqual(app.state.activeView, "ACCOUNT", "T27: Clicking #btnBackFromFocus from Timer sub-view returns to ACCOUNT");
    app.switchView("OVERVIEW");

    // T28 — Part 14B (T-DRW-02 / T-DRW-03): Offline CSS rotation utilities & startup aria-controls/aria-expanded
    const mainCssDisk = fs.readFileSync(path.join(rootDir, "src/styles/main.css"), "utf8");
    assert(
      mainCssDisk.includes(".rotate-90 {") &&
      mainCssDisk.includes(".rotate-180 {") &&
      mainCssDisk.includes(".-rotate-90 {") &&
      mainCssDisk.includes(".transition-transform {"),
      "T28/T-DRW-03: src/styles/main.css must define .rotate-90, .rotate-180, .-rotate-90, and .transition-transform"
    );
    assert.strictEqual(sandbox.document.getElementById("btnAccountHelpSupportRow").getAttribute("aria-controls"), "accountHelpSupportDrawer", "T28/T-DRW-02: #btnAccountHelpSupportRow must have aria-controls='accountHelpSupportDrawer'");
    assert.strictEqual(typeof app.setDrawerExpanded, "function", "T28/T-DRW-02: setDrawerExpanded must be exposed on ScreenSyncApp");

    // T29 — Part 14B (T-HLP-01..08): HelpCenterController tokens, goal range ("15 minutes up to 16 hours" / "5 minutes up to 8 hours"), #faqTopicCountBadge, OEM battery checklist, escaping, and PLATFORM_SETUP_GUIDE
    assert.strictEqual(app.PASSWORD_MIN_LENGTH, 8, "T29/T-HLP-02: PASSWORD_MIN_LENGTH must be 8");
    assert.strictEqual(app.PASSWORD_MAX_LENGTH, 32, "T29/T-HLP-02: PASSWORD_MAX_LENGTH must be 32");
    const tokens29 = app.HelpCenterController.getHelpTokens();
    assert.strictEqual(tokens29.screenGoalRange, "15 minutes up to 16 hours", "T29/T-HLP-01: screenGoalRange token must be '15 minutes up to 16 hours'");
    assert.strictEqual(tokens29.reelGoalRange, "5 minutes up to 8 hours", "T29/T-HLP-01: reelGoalRange token must be '5 minutes up to 8 hours'");
    assert.strictEqual(tokens29.passwordLength, "8–32", "T29/T-HLP-02: passwordLength token must be '8–32'");
    app.HelpCenterController.initFaqAccordion();
    const badge29 = sandbox.document.getElementById("faqTopicCountBadge");
    assert(badge29 && badge29.textContent === "14 Topics", "T29/T-HLP-03: #faqTopicCountBadge must dynamically render '14 Topics'");
    const dualGoalsAns = sandbox.document.getElementById("faqAnswer_dual_goals");
    assert(
      dualGoalsAns &&
      dualGoalsAns.innerHTML.includes("15 minutes up to 16 hours") &&
      dualGoalsAns.innerHTML.includes("5 minutes up to 8 hours") &&
      !dualGoalsAns.innerHTML.includes("23 hours 59 minutes"),
      "T29/T-HLP-01: FAQ dual_goals must render liveGOAL_CONFIG bounds ('15 minutes up to 16 hours' and '5 minutes up to 8 hours')"
    );
    const reqPermAns = sandbox.document.getElementById("faqAnswer_required_permissions");
    assert(
      reqPermAns &&
      reqPermAns.innerHTML.includes("Android OEM Battery &amp; Auto-Start Checklist:") &&
      reqPermAns.innerHTML.includes("Xiaomi / Redmi / POCO") &&
      reqPermAns.innerHTML.includes("Samsung Galaxy"),
      "T29/T-HLP-05: FAQ required_permissions must include dynamic OEM battery/autostart checklist"
    );
    const renderGuideRes = app.HelpCenterController.renderPlatformSetupGuide();
    assert(renderGuideRes && renderGuideRes.rendered === true && renderGuideRes.count === 6, "T29/T-HLP-06: renderPlatformSetupGuide must render all 6 platform cards into #guidePlatformSetupList");

    // Verify no dead listener references in app.js (T-HLP-08 / CAT14-012)
    const appJsDisk29 = fs.readFileSync(path.join(rootDir, "src/js/app.js"), "utf8");
    assert(
      !appJsDisk29.includes('"btnCloseThemeStyleWindow"') &&
      !appJsDisk29.includes('"btnReturnToAccountFromBrainState"'),
      "T29/T-HLP-08/CAT14-012: Dead DOM ID lookups for btnCloseThemeStyleWindow and btnReturnToAccountFromBrainState must be removed"
    );

    // T30 — Part 14B (ISSUE-C14-06 / CAT14-002 / T-VER-01): storageHydrationStatus, algorithmReadiness, summarizeLiveStatus, and XSS HTML escaping in renderVerificationSuite
    const savedHb30 = JSON.parse(JSON.stringify(app.BackendDB.data.trackerHeartbeats || {}));
    const savedHbInst30 = JSON.parse(JSON.stringify(app.BackendDB.data.trackerHeartbeatsByInstallation || {}));
    const savedHbUser30 = JSON.parse(JSON.stringify(app.BackendDB.data.trackerHeartbeatsByUser || {}));
    app.BackendDB.data.trackerHeartbeats = {};
    app.BackendDB.data.trackerHeartbeatsByInstallation = {};
    app.BackendDB.data.trackerHeartbeatsByUser = {};
    const liveRep30 = app.HelpCenterController.collectGenuineVerificationReport();
    assert(
      liveRep30.storageHydrationStatus &&
      liveRep30.storageHydrationStatus.intactMapsCount === 8 &&
      liveRep30.storageHydrationStatus.allHydrated === true &&
      liveRep30.algorithmReadiness &&
      liveRep30.algorithmReadiness.intervalUnionReady === true &&
      liveRep30.algorithmReadiness.reelFsmReady === true,
      "T30/ISSUE-C14-06: collectGenuineVerificationReport must include storageHydrationStatus (8/8) and algorithmReadiness"
    );
    const sumStatus30 = app.HelpCenterController.summarizeLiveStatus(liveRep30);
    assert(sumStatus30 && sumStatus30.ok === true && sumStatus30.issueCount === 0, "T30: summarizeLiveStatus must report ok: true on healthy report");
    app.BackendDB.data.trackerHeartbeats = savedHb30;
    app.BackendDB.data.trackerHeartbeatsByInstallation = savedHbInst30;
    app.BackendDB.data.trackerHeartbeatsByUser = savedHbUser30;

    // XSS escaping test in renderVerificationSuite (T-VER-01)
    const savedUser30 = app.state.currentUser;
    const savedAuth30 = app.state.isAuthenticated;
    app.state.isAuthenticated = true;
    app.state.currentUser = { userId: "usr_xss_30", email: "xss@test.io", name: '<img src=x onerror="alert(1)">' };
    app.HelpCenterController.renderVerificationSuite();
    const verifHtml30 = sandbox.document.getElementById("verificationSuiteItemsList").innerHTML;
    assert(
      verifHtml30.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;") &&
      !verifHtml30.includes('<img src=x'),
      "T30/T-VER-01: renderVerificationSuite must escape HTML entities in user-controlled displayName and device names"
    );
    app.state.currentUser = savedUser30;
    app.state.isAuthenticated = savedAuth30;
    app.HelpCenterController.renderVerificationSuite();

    // T31 — Part 14B (T-VER-04): Zero side-effects during runAutomatedVerificationSuite (DOM data-app-theme, SoundExposureAndHealthService transient state, BroadcastChannel, fetch)
    let themeAttrMutatedCount = 0;
    const docEl31 = sandbox.document.documentElement;
    const origSetAttr31 = docEl31.setAttribute.bind(docEl31);
    docEl31.setAttribute = function (k, v) {
      if (k === "data-app-theme") themeAttrMutatedCount += 1;
      return origSetAttr31(k, v);
    };
    app.SoundExposureAndHealthService.continuousHarmfulSeconds = 42;
    const isoRes31 = app.runAutomatedVerificationSuite({ silentToast: true });
    docEl31.setAttribute = origSetAttr31;
    assert.strictEqual(isoRes31.passed, 21, "T31: All 21 checks must pass in side-effect-free mode");
    assert.strictEqual(themeAttrMutatedCount, 0, "T31/T-VER-04: runAutomatedVerificationSuite (default) must not mutate documentElement[data-app-theme]");
    assert.strictEqual(app.SoundExposureAndHealthService.continuousHarmfulSeconds, 42, "T31/T-VER-04: SoundExposureAndHealthService transient state must be restored in finally");
    app.SoundExposureAndHealthService.continuousHarmfulSeconds = 0;

    // T32 — Part 14B (ISS-14-01 / C14-2-03): MainActivity.java dispatchSystemBackToWebView 600ms watchdog, setBackNavigationInterceptEnabled & no super.onBackPressed recursion
    const mainActJava32 = fs.readFileSync(path.join(rootDir, "android/app/src/main/java/io/screensync/wellness/MainActivity.java"), "utf8");
    assert(
      mainActJava32.includes("dispatchSystemBackToWebView()") &&
      mainActJava32.includes("setBackNavigationInterceptEnabled") &&
      mainActJava32.includes("600L") &&
      !mainActJava32.includes("super.onBackPressed()"),
      "T32/ISS-14-01: MainActivity.java must use dispatchSystemBackToWebView() with 600ms watchdog, setBackNavigationInterceptEnabled, and moveTaskToBack(true) without super.onBackPressed() recursion"
    );

    // T18 — Parity between src/js/app.js and inlined script in all 5 HTML bundles (CAT14-07, CAT14-13)
    const appJsDisk = fs.readFileSync(path.join(rootDir, "src/js/app.js"), "utf8");
    const indexHtmlDisk = fs.readFileSync(path.join(rootDir, "src/index.html"), "utf8");
    assert(indexHtmlDisk.includes(appJsDisk), "T18: src/index.html must contain the exact byte-for-byte inlined copy of src/js/app.js");
    const bundlePaths = [
      "src/index.html",
      "www/index.html",
      "android/app/src/main/assets/public/index.html",
      "ios/App/App/public/index.html",
      "screensync_healthy_device_usage_cross_device_reel_tracker.html"
    ];
    const baseSha256 = crypto.createHash("sha256").update(indexHtmlDisk).digest("hex");
    for (const relBundle of bundlePaths) {
      const bHash = crypto.createHash("sha256").update(fs.readFileSync(path.join(rootDir, relBundle))).digest("hex");
      assert.strictEqual(bHash, baseSha256, `T18: Bundle ${relBundle} must match SHA-256 ${baseSha256}`);
    }
  }
  return { ok: true, suite: 'Category 13 & 14 + Passes 1-3 + Part 13B + Part 14A + Part 14B (T01-T32) Acceptance Tests' };
}

module.exports = { runCategory13And14Tests };

if (require.main === module) {
  const { spawnSync } = require("child_process");
  const res = spawnSync(process.execPath, [path.join(__dirname, "run_all_tests.js")], { stdio: "inherit" });
  process.exit(res.status || 0);
}
