const assert = require("assert");
const fs = require("fs");
const path = require("path");

function runPart16AcceptanceTests({ app, rootDir }) {
  assert(app, "ScreenSyncApp must be loaded");

  // 1. Feature 2.1: Engagement metric stripper, hourlyCounted idempotency, and rotScore
  const stripped = app.ReelTrackingEngine.stripEngagementMetrics("1.2K likes Travel Vlog 3.4M");
  assert.strictEqual(stripped, "likes Travel Vlog", "Engagement numbers should be stripped cleanly");
  const ev = { id: "ev1" };
  assert.strictEqual(app.ReelTrackingEngine.markEventHourlyCounted(ev), true);
  assert.strictEqual(app.ReelTrackingEngine.markEventHourlyCounted(ev), false, "hourlyCounted must prevent double rollup");

  const rot = app.ScreenSyncWellnessEngine.computeDailyRotScore({
    totalReels: 120,
    reelWatchMinutes: 60,
    lateNightReels: 30,
    fastSkipCount: 40
  });
  assert(rot.rotScore >= 0 && rot.rotScore <= 100, "rotScore must be bounded 0..100");
  assert(rot.rotScore > 30, "120 reels should yield non-trivial rotScore");

  // 2. Feature 2.2: FallbackReelsCounterService mutual exclusion, piid/mutedState parsing & manifest registration
  const fallbackJava = fs.readFileSync(path.join(rootDir, "android/app/src/main/java/io/screensync/wellness/FallbackReelsCounterService.java"), "utf8");
  assert(fallbackJava.includes("stopIfAccessibilityActive"), "FallbackReelsCounterService must support mutual exclusion");
  assert(fallbackJava.includes("piid:(\\\\d+)"), "FallbackReelsCounterService must parse piid tokens from AudioPlaybackConfiguration");
  assert(fallbackJava.includes("mutedState:"), "FallbackReelsCounterService must parse mutedState tokens from AudioPlaybackConfiguration");
  assert(fallbackJava.includes("pm.isInteractive()"), "FallbackReelsCounterService must suspend estimation when screen is off");

  const accJava = fs.readFileSync(path.join(rootDir, "android/app/src/main/java/io/screensync/wellness/ScreenSyncAccessibilityService.java"), "utf8");
  assert(accJava.includes("FallbackReelsCounterService.stopIfAccessibilityActive(this)"), "Accessibility onServiceConnected must stop FallbackReelsCounterService");
  assert(accJava.includes("isOverlaySnoozed()"), "Accessibility overlay renderer must honor isOverlaySnoozed()");
  assert(accJava.includes("triggerRoastNudgeOverlayWithTimeout"), "Accessibility service must provide 400ms settle + 3000ms timeout roast nudge handler");

  const mainJava = fs.readFileSync(path.join(rootDir, "android/app/src/main/java/io/screensync/wellness/MainActivity.java"), "utf8");
  const dupBackMatches = mainJava.match(/boolean\s+nativeBackStackInterceptEnabled\s*=/g) || [];
  assert.strictEqual(dupBackMatches.length, 1, "MainActivity.java must declare nativeBackStackInterceptEnabled strictly once");
  assert(mainJava.includes("enableReaderMode"), "MainActivity.java must wire NfcAdapter.enableReaderMode for NFC_TAP mission");
  assert(mainJava.includes("TYPE_STEP_DETECTOR"), "MainActivity.java must wire TYPE_STEP_DETECTOR for WALK_STEPS mission");

  const manifestXml = fs.readFileSync(path.join(rootDir, "android/app/src/main/AndroidManifest.xml"), "utf8");
  assert(manifestXml.includes("FallbackReelsCounterService"), "AndroidManifest must register FallbackReelsCounterService");

  // 3. Feature 2.3: Floating overlay modes, snooze & unsnooze synchronization
  assert.strictEqual(app.CrossPlatformPillPresenter.setOverlayMode("expanded"), "expanded");
  assert.strictEqual(app.CrossPlatformPillPresenter.setOverlayMode("roast_nudge"), "roast_nudge");
  assert.strictEqual(app.CrossPlatformPillPresenter.setOverlayMode("collapsed"), "collapsed");
  const snoozeRes = app.CrossPlatformPillPresenter.snoozeOverlay(60, 1000000);
  assert.strictEqual(snoozeRes.snoozed, true);
  assert.strictEqual(app.CrossPlatformPillPresenter.overlaySnoozeUntilMs, app.CrossPlatformPillPresenter.snoozedUntilMs);
  assert.strictEqual(app.CrossPlatformPillPresenter.isOverlaySnoozed(1000000 + 30 * 60000), true);
  assert.strictEqual(app.CrossPlatformPillPresenter.isOverlaySnoozed(1000000 + 61 * 60000), false);
  app.CrossPlatformPillPresenter.snoozeOverlay(60, 2000000);
  assert.strictEqual(app.CrossPlatformPillPresenter.unsnoozeOverlay().snoozed, false);
  assert.strictEqual(app.CrossPlatformPillPresenter.isOverlaySnoozed(2000000 + 1000), false);
  assert.strictEqual(app.CrossPlatformPillPresenter.shouldShowFloatingBubble({ screenInteractive: true, inTargetShortFormApp: true, isDmOrInboxContext: true }, 99999999), false);

  // 4. Feature 2.4: Smart Reel Limits & Hard Cooldown Blocking
  assert.strictEqual(app.ReelDetoxCooldownController.getAppSpecificLockTitle("com.google.android.youtube"), "Shorts are Locked");
  assert.strictEqual(app.ReelDetoxCooldownController.getAppSpecificLockTitle("com.snapchat.android"), "Spotlight is Locked");
  assert.strictEqual(app.ReelDetoxCooldownController.getAppSpecificLockTitle("com.instagram.android"), "Reels are Locked");

  const uid = "usr_part16_test";
  app.ReelDetoxCooldownController.updateUserBlockingConfig({ isBlockEnabled: true, reelsAllowedCount: 25, blockStartReelCount: 0, dmSingleReelException: false }, uid, 1700000000000);
  const cfgSync = app.ReelDetoxCooldownController.getUserBlockingConfig(uid);
  assert.strictEqual(cfgSync.dmSingleReelException, false);
  assert.strictEqual(cfgSync.directMessageSingleReelException, false, "dmSingleReelException and directMessageSingleReelException must stay synchronized");
  assert.strictEqual(cfgSync.lastSyncedUpdatedAt, 1700000000000);
  const warnState = app.ReelDetoxCooldownController.evaluateQuotaState(20, uid);
  assert.strictEqual(warnState.fiveReelsWarning, true, "5 reels left warning must trigger at 20/25");
  assert.strictEqual(warnState.remaining, 5);
  assert.strictEqual(warnState.remainingReels, 5);
  const exhaustedState = app.ReelDetoxCooldownController.evaluateQuotaState(25, uid);
  assert.strictEqual(exhaustedState.state, "EXHAUSTED_COOLDOWN");
  assert.strictEqual(exhaustedState.antiWeakeningLocked, true);
  const weakenAttempt = app.ReelDetoxCooldownController.updateUserBlockingConfig({ isBlockEnabled: false, currentTotalReels: 25 }, uid);
  assert.strictEqual(weakenAttempt.ok, false, "Weakening block during cooldown must be rejected");

  // 5. Feature 2.5: 7 Physical & Sensor Friction Unlock Missions
  const missionKeys = Object.keys(app.UnlockMissionController.MISSIONS);
  assert.strictEqual(missionKeys.length, 7, "All 7 unlock missions must be defined");
  app.UnlockMissionController.startMission("THUMB_DETOX_IDLE", { target: 5, bonusReels: 15 });
  app.UnlockMissionController.recordProgress(3);
  app.UnlockMissionController.resetOnInterruption("TOUCH");
  assert.strictEqual(app.UnlockMissionController.activeMission.progress, 0, "Thumb detox must reset on touch");
  app.UnlockMissionController.recordProgress(5);
  assert.strictEqual(app.UnlockMissionController.activeMission.completed, true);

  // 6. Feature 2.6: Pace Nudges & Milestone Roasts (every 50 reels)
  const paceRes = app.PaceNudgeAndRoastEngine.evaluatePaceNudge({ currentHourCount: 18, hourOfDay: 23 });
  assert.strictEqual(paceRes.shouldNudge, true);
  const roastRes = app.PaceNudgeAndRoastEngine.evaluateMilestoneRoast(50, { localDate: "2026-11-16", force: true });
  assert.strictEqual(roastRes.triggered, true);

  // 7. Feature 2.7: Scroll Battles / Friends Duels (fewest reels wins + relationship tags + pinning)
  assert(app.ScrollBattleDuelEngine.RELATIONSHIP_TAGS.includes("Doomscroller"));
  const inv = app.ScrollBattleDuelEngine.createInviteLink("Study Partner", uid);
  assert(inv.inviteCode.startsWith("SB-"));
  app.ScrollBattleDuelEngine.acceptInvite(inv.inviteCode, { friendUserId: "fr_1", displayName: "Ayan", dailyReels: 40 }, uid);
  const pinRes = app.ScrollBattleDuelEngine.pinFriend("fr_1", uid);
  assert.strictEqual(pinRes.ok, true);
  assert.strictEqual(app.ReelDetoxCooldownController.getUserBlockingConfig(uid).pinnedFriendUserId, "fr_1");
  const standings = app.ScrollBattleDuelEngine.computeStandings(12, uid);
  assert.strictEqual(standings.leader.isSelf, true, "Fewest reels must win");

  // 8. Feature 2.8: All 7 Brain Mascot Moods & 3rd Home-Screen Widget
  const moodOverload = app.ScreenSyncWellnessEngine.getBuddyMoodPrompt({ dailyReelCount: 105, permissionsHealthy: true, hourOfDay: 14 });
  assert.strictEqual(moodOverload.crackStage, 1);
  assert.strictEqual(moodOverload.prompt, "Take a break?");
  const moodMissYou = app.ScreenSyncWellnessEngine.getBuddyMoodPrompt({ dailyReelCount: 10, permissionsHealthy: true, hourOfDay: 14, hoursSinceLastOpen: 30 });
  assert.strictEqual(moodMissYou.prompt, "Miss you!");
  assert.strictEqual(moodMissYou.moodKey, "INACTIVE_STREAK");
  assert(fs.existsSync(path.join(rootDir, "android/app/src/main/java/io/screensync/wellness/ScrollBattleWidgetProvider.java")));

  // 9. Feature 2.9: 8 Scrolling Personalities & Weekly Story Card
  assert.strictEqual(app.SmartInsightsEngine.SCROLLING_PERSONALITIES.length, 8);
  assert.strictEqual(app.SmartInsightsEngine.classifyScrollingPersonality({ dailyReels: 10, watchMinutes: 5 }).key, "LIGHT_TOUCH");
  assert.strictEqual(app.SmartInsightsEngine.classifyScrollingPersonality({ dailyReels: 60, watchMinutes: 30, lateNightShare: 0.45 }).key, "NIGHT_OWL");
  const card = app.WeeklyStoryCardGenerator.exportCanvasPng({ totalReels: 120, totalMinutes: 45, personalityLabel: "Night Owl" });
  assert.strictEqual(card.ok, true);

  // 10. Feature 2.10: Brain Reset Questionnaire & OEM Visual Coaching Guides
  const plan = app.PermissionOnboardingManager.BrainResetQuestionnaire.calculatePlan({ dailyHours: 4, feeling: "cant_focus", reclaimGoal: "Study" });
  assert(plan.recommendedDailyTarget > 0);
  assert(Array.isArray(app.OemPermissionGuideController.OEM_VISUAL_COACHING_GUIDES.XIAOMI_HYPEROS));

  // 11. Feature 2.11: 100% Free Launch Mode + Future-Ready Pro Entitlement Registry
  assert.strictEqual(app.SubscriptionAndBillingEngine.FREE_TIER_UNLOCK_ALL_PRO_FEATURES, true);
  assert.strictEqual(app.SubscriptionAndBillingEngine.ENFORCE_PRO_SUBSCRIPTION_GATING, false);
  assert.strictEqual(app.SubscriptionAndBillingEngine.FEATURE_ENTITLEMENT_REGISTRY.UNLOCK_MISSIONS.proGateReady, true);

  // 12. Feature 2.12: Multi-Device Split Delta Sum & Distracted Walking
  const splitTotals = app.ScreenTimeAggregator.computeMultiDeviceSplitTotals([
    { installationId: "dev_a", reelCount: 30, watchDurationMs: 60000 },
    { installationId: "dev_b", reelCount: 20, watchDurationMs: 40000 }
  ]);
  assert.strictEqual(splitTotals.totalReels, 50, "Multi-device splits must sum across devices, not take naive MAX");
  assert.strictEqual(app.DistractedWalkingDetector.evaluate({ isWalking: true, isScreenInteractive: true, continuousWalkSec: 12 }).alert, true);

  // 13. Clean-Room Brand Scrub & Supabase RLS Migration
  const srcJs = fs.readFileSync(path.join(rootDir, "src/js/app.js"), "utf8");
  const srcHtml = fs.readFileSync(path.join(rootDir, "src/index.html"), "utf8");
  for (const forbidden of ["BrainPal", "BrainRot", "com.brainrot.android", "ai.regainapp", "HealthyUse"]) {
    assert(!srcJs.includes(forbidden), `Forbidden brand string found in app.js: ${forbidden}`);
    assert(!srcHtml.includes(forbidden), `Forbidden brand string found in index.html: ${forbidden}`);
  }
  const rlsSql = fs.readFileSync(path.join(rootDir, "supabase/migrations/20261116000018_part16_scroll_battles_and_device_splits.sql"), "utf8");
  assert(rlsSql.includes("ENABLE ROW LEVEL SECURITY"), "Part 16 SQL migration must enable RLS");
  assert(rlsSql.includes("auth.uid() = user_id"), "Part 16 SQL migration must enforce auth.uid() = user_id");

  // 14. Regression checks: single-page placement inside #focusStatsSubView, 3D Brain Reset wheels, and live Part16UIController
  const idxHtml = fs.readFileSync(path.join(rootDir, "src/index.html"), "utf8");
  const statsSubStart = idxHtml.indexOf("id=\"focusStatsSubView\"");
  const focusEnd = idxHtml.indexOf("id=\"viewAllAppsBreakdown\"");
  assert(statsSubStart !== -1 && focusEnd !== -1 && statsSubStart < focusEnd);
  const statsSubSlice = idxHtml.slice(statsSubStart, focusEnd);
  assert(statsSubSlice.includes("id=\"smartReelQuotaCard\""), "smartReelQuotaCard must be inside #focusStatsSubView");
  assert(statsSubSlice.includes("id=\"scrollBattleDuelCard\""), "scrollBattleDuelCard must be inside #focusStatsSubView");
  assert(statsSubSlice.includes("id=\"weeklyStoryCardSection\""), "weeklyStoryCardSection must be inside #focusStatsSubView");
  assert(statsSubSlice.includes("id=\"brainResetPlanCard\""), "brainResetPlanCard must be inside #focusStatsSubView");
  assert(statsSubSlice.includes("id=\"wheelBrainResetHours\""), "Brain Reset Hours must use 3D wheel");
  assert(statsSubSlice.includes("id=\"wheelBrainResetFeeling\""), "Brain Reset Feeling must use 3D wheel");
  assert(statsSubSlice.includes("id=\"wheelBrainResetGoal\""), "Brain Reset Goal must use 3D wheel");
  assert(!statsSubSlice.includes("<select id=\"brainResetHoursSelect\""), "2D <select> must be replaced by 3D drum wheel");
  assert(app.Part16UIController && typeof app.Part16UIController.renderAll === "function", "Part16UIController must be exported");
}

module.exports = { runPart16AcceptanceTests };
