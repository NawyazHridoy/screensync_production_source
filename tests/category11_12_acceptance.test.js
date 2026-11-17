'use strict';

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');

function httpRequestJson(port, method, reqPath, bodyObj = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = bodyObj ? JSON.stringify(bodyObj) : "";
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: reqPath,
      method,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        ...headers
      }
    }, (res) => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => {
        let parsed = null;
        try { parsed = JSON.parse(data || "{}"); } catch (_e) {}
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runCategory11And12Tests({ app, documentMock, windowMock, sandbox, html, rootDir, setupTestFixtureForUser }) {
  assert.strictEqual(typeof app.AuthService, "object", "AuthService active");
  assert.strictEqual(typeof app.SupabaseSyncEngine, "object", "SupabaseSyncEngine active");
  assert.strictEqual(typeof app.SocialOAuthProviderEngine, "object", "SocialOAuthProviderEngine active");
  assert.strictEqual(typeof app.syncBottomNavVisibilityForAuthState, "function", "syncBottomNavVisibilityForAuthState active");
  assert.strictEqual(typeof app.openNotificationSettingsWindow, "function", "openNotificationSettingsWindow active");
  assert.strictEqual(typeof app.setupAccountScrollAutoCollapse, "function", "setupAccountScrollAutoCollapse active");

  // ---------------------------------------------------------------------------
  // 1. S12.1 & S12.2: Full-Screen Auth UI, Hidden Bottom Nav Bar, Removed Badge & Duplicate Sign-Up Footer
  // ---------------------------------------------------------------------------
  {
    const mainCss = fs.readFileSync(path.join(rootDir, "src/styles/main.css"), "utf8");
    assert(mainCss.includes('html[data-auth-screen-active="true"] #bottomNavBarContainer'), "S12.1: CSS must hide #bottomNavBarContainer when data-auth-screen-active=true");
    assert(!html.includes(">SCREENSYNC AUTH<"), "S12.2: Visible 'SCREENSYNC AUTH' badge text must be removed");
    assert(!html.includes('id="btnGoSignupFooterLink"'), "S12.2: Duplicate #btnGoSignupFooterLink footer must be removed");

    app.openAuthModal("LOGIN");
    assert.strictEqual(sandbox.document.documentElement.getAttribute("data-auth-screen-active"), "true", "S12.1: Opening #authModal on LOGIN must set data-auth-screen-active=true");
    assert(documentMock.getElementById("bottomNavBarContainer").classList.contains("hidden"), "S12.1: #bottomNavBarContainer must be hidden on LOGIN screen");

    for (const tab of ["SIGNUP", "VERIFY", "FORGOT", "LOGIN"]) {
      app.openAuthModal(tab);
      assert.strictEqual(sandbox.document.documentElement.getAttribute("data-auth-screen-active"), "true", `S12.1: Tab ${tab} must keep data-auth-screen-active=true`);
    }
    app.closeAuthModal();
    assert.strictEqual(sandbox.document.documentElement.getAttribute("data-auth-screen-active"), "false", "S12.1: Closing #authModal must restore data-auth-screen-active=false");
    assert(!documentMock.getElementById("bottomNavBarContainer").classList.contains("hidden"), "S12.1: Closing #authModal must restore #bottomNavBarContainer visibility");
  }

  // ---------------------------------------------------------------------------
  // 2. S12.3 & C12-01: SocialOAuthProviderEngine (Google/Apple/Microsoft PKCE + Nonce) & Zero Demo Google User
  // ---------------------------------------------------------------------------
  {
    const appJsSrc = fs.readFileSync(path.join(rootDir, "src/js/app.js"), "utf8");
    assert(!appJsSrc.includes("user.google@screensync.app"), "C12-01: Fake hardcoded user.google@screensync.app must be completely removed");
    assert.strictEqual(app.SocialOAuthProviderEngine.isUiEnabled(), false, "S12.3: SOCIAL_OAUTH_UI_ENABLED must default to false before store publication");
    const pkce = app.SocialOAuthProviderEngine.generatePkceVerifierAndChallenge();
    const nonce = app.SocialOAuthProviderEngine.generateOidcNonce();
    assert(pkce.codeVerifier && pkce.codeChallenge && pkce.codeChallengeMethod === "S256", "S12.3: PKCE S256 verifier and challenge must be generated");
    assert(nonce.rawNonce && nonce.nonceHash, "S12.3: OIDC SHA-256 nonce must be generated");
  }

  // ---------------------------------------------------------------------------
  // 3. S12.4: 20-Table RLS Force Migration, firestore.rules & Client Secret Key Ban
  // ---------------------------------------------------------------------------
  {
    const rlsPath = path.join(rootDir, "supabase/migrations/20261022000017_complete_rls_and_rpc_hardening.sql");
    const fsRulesPath = path.join(rootDir, "firestore.rules");
    assert(fs.existsSync(rlsPath), "S12.4: 20261022000017_complete_rls_and_rpc_hardening.sql must exist");
    assert(fs.existsSync(fsRulesPath), "S12.4: firestore.rules must exist");
    const rlsSql = fs.readFileSync(rlsPath, "utf8");
    const fsRules = fs.readFileSync(fsRulesPath, "utf8");
    assert(rlsSql.includes("ENABLE ROW LEVEL SECURITY") && rlsSql.includes("FORCE ROW LEVEL SECURITY") && rlsSql.includes("REVOKE ALL ON public.%I FROM anon"), "S12.4: RLS migration must enable, force, and revoke anon across all 20 tables");
    assert(fsRules.includes("request.auth != null && request.auth.uid == userId") && fsRules.includes("allow read, write: if false;"), "S12.4: firestore.rules must enforce owner-only access and default deny");

    assert.throws(
      () => app.SupabaseClientManager.assertSafeClientKey("sb_secret_live_12345"),
      /SECURITY_VIOLATION_SECRET_KEY_IN_CLIENT/,
      "S12.4: assertSafeClientKey must throw SECURITY_VIOLATION_SECRET_KEY_IN_CLIENT on sb_secret_ keys"
    );
    assert.throws(
      () => app.SupabaseClientManager.assertSafeClientKey("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service_role.sig"),
      /SECURITY_VIOLATION_SECRET_KEY_IN_CLIENT/,
      "S12.4: assertSafeClientKey must throw SECURITY_VIOLATION_SECRET_KEY_IN_CLIENT on service_role keys"
    );
  }

  // ---------------------------------------------------------------------------
  // 4. S12.5, C12-27, C12-28, C12-30, C12-33: RedisStateEngine & HTTP Server Hardening
  // ---------------------------------------------------------------------------
  const syncSrv = require(path.join(rootDir, "server/sync_server.js"));
  assert.strictEqual(syncSrv.REDIS_ENABLED, true, "S12.5: REDIS_ENABLED must be true");
  assert(syncSrv.RedisStateEngine && syncSrv.RedisStateEngine.isRedisEnabled() === true, "S12.5: RedisStateEngine must be active");
  assert.strictEqual(syncSrv.resolveDeviceMarketingName("24069RA21C"), "Redmi Turbo 4 Pro", "C12-33: 24069RA21C must resolve to Redmi Turbo 4 Pro in both lookup table and function");

  // Verify RedisStateEngine operations & AOF persistence
  syncSrv.RedisStateEngine.setex("test_redis_key_c12", 120, "redis_val_123");
  assert.strictEqual(syncSrv.RedisStateEngine.get("test_redis_key_c12"), "redis_val_123", "S12.5: RedisStateEngine.get/setex must round-trip");
  assert.strictEqual(syncSrv.RedisStateEngine.setNxEx("test_redis_nx_c12", 60, "v1"), true, "S12.5: First setNxEx must return true");
  assert.strictEqual(syncSrv.RedisStateEngine.setNxEx("test_redis_nx_c12", 60, "v2"), false, "S12.5: Duplicate setNxEx must return false");
  syncSrv.RedisStateEngine.del("test_redis_key_c12");
  syncSrv.RedisStateEngine.del("test_redis_nx_c12");
  assert(fs.existsSync(path.join(rootDir, "server/data/redis_aof_store.json")), "S12.5: server/data/redis_aof_store.json must be persisted");

  // C12-27: Random 6+ char bearer token must be rejected (401)
  assert.strictEqual(syncSrv.verifyBearerAuth({ headers: { authorization: "Bearer abcdef" } }, "usr_test_sync_01").status, 401, "C12-27: Random 6-char string 'abcdef' must be rejected with 401");

  await new Promise((resolve, reject) => {
    const srv = syncSrv.server.listen(0, "127.0.0.1", async () => {
      try {
        const port = srv.address().port;
        // (a) verify-password with no stored hash returns 401 and verified: false (C12-28)
        const vpNoHash = await httpRequestJson(port, "POST", "/api/account/verify-password", {
          userId: "usr_no_hash_test_99",
          password: "AnyPassword123!"
        });
        assert.strictEqual(vpNoHash.status, 401, "C12-28: verify-password with no stored hash must return 401");
        assert.strictEqual(vpNoHash.body.verified, false, "C12-28: verify-password with no stored hash must return verified: false");

        // (b) /api/account/delete without Authorization / password verification is refused (401)
        const delUnauth = await httpRequestJson(port, "POST", "/api/account/delete", {
          userId: "usr_no_hash_test_99"
        });
        assert.strictEqual(delUnauth.status, 401, "C12-27: /api/account/delete without Bearer auth & password verification must return 401");
        assert.strictEqual(delUnauth.body.ok, false, "/api/account/delete without auth must return ok: false");

        // (c) GET /api/sync and POST /api/sync without valid Bearer token are refused (401/403) (C12-27)
        const syncGetUnauth = await httpRequestJson(port, "GET", "/api/sync?userId=usr_test_sync_01");
        assert.strictEqual(syncGetUnauth.status, 401, "C12-27: GET /api/sync without Bearer token must return 401");

        const syncPostUnauth = await httpRequestJson(port, "POST", "/api/sync", {
          userId: "usr_test_sync_01",
          sessions: []
        });
        assert.strictEqual(syncPostUnauth.status, 401, "C12-27: POST /api/sync without Bearer token must return 401");

        const syncPostRandomTok = await httpRequestJson(port, "POST", "/api/sync", {
          userId: "usr_test_sync_01",
          sessions: []
        }, { Authorization: "Bearer random_unverified_token" });
        assert.strictEqual(syncPostRandomTok.status, 401, "C12-27: POST /api/sync with random unverified token must return 401");

        const syncPostWrongUser = await httpRequestJson(port, "POST", "/api/sync", {
          userId: "usr_test_sync_01",
          sessions: []
        }, { Authorization: "Bearer tok_usr_other_99_abcdef12" });
        assert.strictEqual(syncPostWrongUser.status, 403, "C12-27: POST /api/sync with another user's token must return 403");

        // (d) C12-30: Future-dated or negative-duration session on POST /api/sync returns 400
        const badFuturePost = await httpRequestJson(port, "POST", "/api/sync", {
          userId: "usr_test_sync_01",
          sessions: [{
            sessionId: "sess_fut_1",
            installationId: "inst_1",
            durationMinutes: 10,
            startEpochMs: Date.now() + 3600 * 1000
          }]
        }, { Authorization: "Bearer tok_usr_test_sync_01_abcdef12" });
        assert.strictEqual(badFuturePost.status, 400, "C12-30: Future-dated session on POST /api/sync must return 400");

        const badNegPost = await httpRequestJson(port, "POST", "/api/sync", {
          userId: "usr_test_sync_01",
          sessions: [{
            sessionId: "sess_neg_1",
            installationId: "inst_1",
            durationMinutes: -15
          }]
        }, { Authorization: "Bearer tok_usr_test_sync_01_abcdef12" });
        assert.strictEqual(badNegPost.status, 400, "C12-30: Negative-duration session on POST /api/sync must return 400");

        // (e) C12-30: Rate limiting returns 429 when x-rate-limit-max is exceeded
        await httpRequestJson(port, "POST", "/api/sync", { userId: "usr_rl_test_01", sessions: [] }, {
          Authorization: "Bearer tok_usr_rl_test_01_abcdef12",
          "x-rate-limit-max": "1"
        });
        const rlExceeded = await httpRequestJson(port, "POST", "/api/sync", { userId: "usr_rl_test_01", sessions: [] }, {
          Authorization: "Bearer tok_usr_rl_test_01_abcdef12",
          "x-rate-limit-max": "1"
        });
        assert.strictEqual(rlExceeded.status, 429, "C12-30: Exceeding rate limit on /api/sync must return 429");

        srv.close(() => resolve());
      } catch (err) {
        srv.close(() => reject(err));
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 5. C12-02, C12-03, C12-06, C12-09, C12-10, C12-15, C12-19, C12-20, C12-22, C12-25: Session & Sync Security
  // ---------------------------------------------------------------------------
  {
    // C12-02: Forged localStorage session for an unknown user must be rejected
    const forgedCheck = app.BackendDB.validateAuthSession({
      userId: "usr_forged_attacker_999",
      email: "attacker@forged.local",
      name: "Forged User",
      verified: true,
      sessionToken: "tok_usr_forged_attacker_999_deadbeef"
    });
    assert.strictEqual(forgedCheck.valid, false, "C12-02: Hand-crafted session payload for unknown user must be rejected");
    assert.strictEqual(forgedCheck.reason, "UNKNOWN_OR_UNVERIFIED_USER", "C12-02: Rejection reason must be UNKNOWN_OR_UNVERIFIED_USER");

    // C12-03: Expired session with refreshToken string must NOT self-refresh in validateAuthSession
    setupTestFixtureForUser("usr_rahim_01");
    const issued = app.BackendDB.issueAuthSession({ userId: "usr_rahim_01", email: "rahim.ahmed@gmail.com", name: "Rahim Ahmed" }, 60000);
    const expiredCandidate = {
      userId: "usr_rahim_01",
      email: "rahim.ahmed@gmail.com",
      sessionToken: issued.sessionToken,
      refreshToken: "ref_stale_string_12345",
      expiresAt: Date.now() - 10000
    };
    const expCheck = app.BackendDB.validateAuthSession(expiredCandidate);
    assert.strictEqual(expCheck.valid, false, "C12-03: Expired session must not self-extend locally in validateAuthSession");
    assert.strictEqual(expCheck.reason, "SESSION_EXPIRED", "C12-03: Expired session must return SESSION_EXPIRED");

    // C12-06: Salted 256-bit KDF password hash verification
    const kdfHash = app.AuthService.hashPassword("MyStrongPass#2026");
    assert(kdfHash.startsWith("pbkdf2_sha256$") && kdfHash.length > 80, "C12-06: AuthService.hashPassword must produce a salted 256-bit KDF output");
    assert.strictEqual(app.AuthService.verifyPasswordHash("MyStrongPass#2026", kdfHash), true, "C12-06: Correct password must verify against KDF hash");
    assert.strictEqual(app.AuthService.verifyPasswordHash("WrongPass#2026", kdfHash), false, "C12-06: Wrong password must fail verification");

    // C12-10: verifyEmailOtp with no pending email must return MISSING_EMAIL even when signed in
    app.state.isAuthenticated = true;
    app.state.pendingVerificationEmail = "";
    app.state.pendingSignupUser = null;
    const noEmailOtpRes = await app.AuthService.verifyEmailOtp("", "123456", "SIGNUP");
    assert.strictEqual(noEmailOtpRes.ok, false, "C12-10: verifyEmailOtp with no pending email must return ok: false");
    assert.strictEqual(noEmailOtpRes.status, "MISSING_EMAIL", "C12-10: verifyEmailOtp with no pending email must return status MISSING_EMAIL");

    // C12-19: Local-to-account migration consumes source bucket so User B never receives User A's logged-out data
    app.BackendDB.data.sessionsByUser["local_unauthenticated"] = [{
      sessionId: "sess_unauth_leak_test_01",
      appKey: "youtube",
      appName: "YouTube",
      durationMinutes: 25,
      localDate: "2026-10-16"
    }];
    app.state.isAuthenticated = true;
    app.state.currentUser = { userId: "usr_rahim_01", email: "rahim.ahmed@gmail.com", name: "Rahim Ahmed" };
    app.state.sessionToken = issued.sessionToken;
    const migA = app.SupabaseSyncEngine.migrateLocalDataToAuthenticatedAccount("usr_rahim_01");
    assert.strictEqual(migA.ok, true, "C12-19: Migration into User A must succeed");
    assert.strictEqual((app.BackendDB.data.sessionsByUser["local_unauthenticated"] || []).length, 0, "C12-19: Source bucket must be consumed/emptied after migration into User A");


    // S12.4 Item 3: Scan src/, www/, platforms/browser-extension/, android/, and ios/ for leaked service_role JWTs or sb_secret_ keys
    const scanDirs = ["src", "www", "platforms/browser-extension", "android", "ios"];
    const secretKeyRegex = /sb_secret_[a-zA-Z0-9_-]{8,}/;
    function walkDirForSecrets(dirPath) {
      if (!fs.existsSync(dirPath)) return;
      for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const full = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "build") continue;
          walkDirForSecrets(full);
        } else if (/\.(js|ts|json|html|java|swift|xml|plist)$/i.test(entry.name)) {
          const content = fs.readFileSync(full, "utf8");
          assert(!secretKeyRegex.test(content), `S12.4: Leaked sb_secret_ key found in ${full}`);
        }
      }
    }
    scanDirs.forEach(d => walkDirForSecrets(path.join(rootDir, d)));

    // C12-15: Logout -> Relogin on same device creates NO duplicate "New login registered" security alert
    const alertsBeforeRelogin = (app.BackendDB.data.securityAlertsByUser["usr_rahim_01"] || []).length;
    app.AuthService.logout({ silent: true });
    app.AuthService.login("rahim.ahmed@gmail.com", "password123");
    const alertsAfterRelogin = (app.BackendDB.data.securityAlertsByUser["usr_rahim_01"] || []).length;
    assert.strictEqual(alertsAfterRelogin, alertsBeforeRelogin, "C12-15: Logout and relogin on the same device must not create a duplicate new-device security alert");

    // C12-22: Same raw session_id on two different installations survives mergeRemoteRecordsIntoLocal
    app.SupabaseSyncEngine.mergeRemoteRecordsIntoLocal("usr_rahim_01", {
      sessions: [
        { user_id: "usr_rahim_01", session_id: "shared_raw_sess_99", installation_id: "inst_dev_A", installation_key: "dev_A", app_key: "youtube", app_name: "YouTube", duration_minutes: 12, local_date: "2026-10-16" },
        { user_id: "usr_rahim_01", session_id: "shared_raw_sess_99", installation_id: "inst_dev_B", installation_key: "dev_B", app_key: "youtube", app_name: "YouTube", duration_minutes: 18, local_date: "2026-10-16" }
      ]
    });
    const sharedMatches = (app.BackendDB.data.sessionsByUser["usr_rahim_01"] || []).filter(s => s.sessionId === "shared_raw_sess_99");
    assert.strictEqual(sharedMatches.length, 2, "C12-22: Same raw session_id across two different installations must both survive merge");

    // C12-25: Events failing ownership check in flushOfflineQueue land in deadLetterQueue
    app.BackendDB.data.deadLetterQueue = [];
    app.BackendDB.data.offlineQueue.push({
      eventId: "ev_bad_ownership_c12",
      userId: "usr_rahim_01",
      ownerUserId: "usr_other_attacker_99",
      installationKey: "s24_ultra",
      appKey: "instagram"
    });
    app.BackendDB.flushOfflineQueue();
    assert((app.BackendDB.data.deadLetterQueue || []).length >= 1, "C12-25: Rejected offline queue events must be persisted in deadLetterQueue with reason");

    // C12-20: Exponential backoff calculation in AutoSyncService
    const delay0 = app.AutoSyncService.computeBackoffDelayMs(0);
    const delay2 = app.AutoSyncService.computeBackoffDelayMs(2);
    assert(delay2 > delay0 && delay0 >= 30000, "C12-20: Exponential backoff delay must grow with retry attempt count");
    app.AutoSyncService.recordSyncSuccess();
  }

  // ---------------------------------------------------------------------------
  // 6. C12-31, C12-35, C12-36: Companion Tick & Extension Heartbeat Validation
  // ---------------------------------------------------------------------------
  const beforeRej = Number(app.ExtensionHeartbeatTamperGuard.rejectedIngestCount || 0);
  const foreignTick = app.ingestCompanionTick({
    userId: "usr_foreign_attacker_999",
    installationKey: "windows_pc",
    checkTimeMs: Date.now(),
    foregroundProcessName: "chrome"
  });
  assert.strictEqual(foreignTick.ok, false, "Tick with foreign userId must be rejected");
  assert.strictEqual(foreignTick.reason, "FOREIGN_USER_ID_REJECTED", "Foreign userId rejection reason must be FOREIGN_USER_ID_REJECTED");
  assert(app.ExtensionHeartbeatTamperGuard.rejectedIngestCount > beforeRej, "Foreign userId rejection must increment rejectedIngestCount");

  const futureTick = app.ingestCompanionTick({
    installationKey: "windows_pc",
    checkTimeMs: Date.now() + 3600 * 1000,
    foregroundProcessName: "chrome"
  });
  assert.strictEqual(futureTick.ok, false, "Tick dated +1h in the future must be rejected");
  assert.strictEqual(futureTick.reason, "FUTURE_TIMESTAMP_SKEW_REJECTED", "Future tick rejection reason must be FUTURE_TIMESTAMP_SKEW_REJECTED");

  const negDurationTick = app.ingestCompanionTick({
    installationKey: "windows_pc",
    checkTimeMs: Date.now(),
    elapsedSeconds: -20,
    foregroundProcessName: "chrome"
  });
  assert.strictEqual(negDurationTick.ok, false, "C12-31: Negative duration tick must be rejected");
  assert.strictEqual(negDurationTick.reason, "NEGATIVE_DURATION_REJECTED", "C12-31: Negative duration rejection reason must be NEGATIVE_DURATION_REJECTED");

  app.ingestCompanionTick({
    installationKey: "seq_test_inst",
    checkTimeMs: Date.now(),
    sequence: 10,
    foregroundProcessName: "chrome"
  });
  const replaySeqTick = app.ingestCompanionTick({
    installationKey: "seq_test_inst",
    checkTimeMs: Date.now() + 1000,
    sequence: 10,
    foregroundProcessName: "chrome"
  });
  assert.strictEqual(replaySeqTick.ok, false, "C12-31: Replayed sequence number tick must be rejected");
  assert.strictEqual(replaySeqTick.reason, "REPLAYED_SEQUENCE_REJECTED", "C12-31: Replayed sequence reason must be REPLAYED_SEQUENCE_REJECTED");

  const futureHb = app.ExtensionHeartbeatTamperGuard.recordExtensionHeartbeat(Date.now() + 3600 * 1000);
  assert.strictEqual(futureHb.ok, false, "recordExtensionHeartbeat(futureTs) must reject future timestamp skew");

  // ---------------------------------------------------------------------------
  // 7. Starter Fix C Acceptance: Revisit-aware LRU in ReelTrackingEngine
  // ---------------------------------------------------------------------------
  const uid = app.getActiveOrLocalUserId();
  const savedReels = [...(app.BackendDB.data.reelEventsByUser[uid] || [])];
  app.ReelTrackingEngine.clearViewedReelsLruCache("s24_ultra");
  const fsm = app.ReelTrackingEngine.getOrCreateFsmState("s24_ultra");
  fsm.state = "IDLE";
  const t0 = Date.now() - 20000;

  app.ReelTrackingEngine.processRawStreamSignal({
    installationKey: "s24_ultra", osCategory: "Android", appKey: "instagram",
    eventType: "TYPE_VIEW_SCROLLED", isShortFormSurface: true, hasVerticalPager: true, isFullScreenViewport: true,
    videoSignature: "reel_revisit_A", nowMs: t0
  });
  const countA1 = app.ReelTrackingEngine.processRawStreamSignal({
    installationKey: "s24_ultra", osCategory: "Android", appKey: "instagram",
    eventType: "HEARTBEAT", isShortFormSurface: true, hasVerticalPager: true, isFullScreenViewport: true,
    videoSignature: "reel_revisit_A", nowMs: t0 + 1600
  });
  assert.strictEqual(countA1.reelCountDelta, 1, "First view of Reel A must count +1");

  app.ReelTrackingEngine.processRawStreamSignal({
    installationKey: "s24_ultra", osCategory: "Android", appKey: "instagram",
    eventType: "TYPE_VIEW_SCROLLED", isShortFormSurface: true, hasVerticalPager: true, isFullScreenViewport: true,
    videoSignature: "reel_revisit_B", nowMs: t0 + 3000
  });
  const countB1 = app.ReelTrackingEngine.processRawStreamSignal({
    installationKey: "s24_ultra", osCategory: "Android", appKey: "instagram",
    eventType: "HEARTBEAT", isShortFormSurface: true, hasVerticalPager: true, isFullScreenViewport: true,
    videoSignature: "reel_revisit_B", nowMs: t0 + 4600
  });
  assert.strictEqual(countB1.reelCountDelta, 1, "First view of Reel B must count +1");

  app.ReelTrackingEngine.processRawStreamSignal({
    installationKey: "s24_ultra", osCategory: "Android", appKey: "instagram",
    eventType: "TYPE_VIEW_SCROLLED", isShortFormSurface: true, hasVerticalPager: true, isFullScreenViewport: true,
    videoSignature: "reel_revisit_A", nowMs: t0 + 6000
  });
  const countA2 = app.ReelTrackingEngine.processRawStreamSignal({
    installationKey: "s24_ultra", osCategory: "Android", appKey: "instagram",
    eventType: "HEARTBEAT", isShortFormSurface: true, hasVerticalPager: true, isFullScreenViewport: true,
    videoSignature: "reel_revisit_A", nowMs: t0 + 7600
  });
  assert.strictEqual(countA2.reelCountDelta, 1, "Genuine revisit to Reel A after viewing Reel B must count +1");

  app.ReelTrackingEngine.processRawStreamSignal({
    installationKey: "s24_ultra", osCategory: "Android", appKey: "instagram",
    eventType: "TYPE_VIEW_SCROLLED", isShortFormSurface: true, hasVerticalPager: true, isFullScreenViewport: true,
    videoSignature: "reel_paused_C", isPlaying: false, nowMs: t0 + 9000
  });
  const pausedRes = app.ReelTrackingEngine.processRawStreamSignal({
    installationKey: "s24_ultra", osCategory: "Android", appKey: "instagram",
    eventType: "HEARTBEAT", isShortFormSurface: true, hasVerticalPager: true, isFullScreenViewport: true,
    videoSignature: "reel_paused_C", isPlaying: false, nowMs: t0 + 14000
  });
  assert.strictEqual(pausedRes.reelCountDelta, 0, "Paused candidate (isPlaying: false) must count 0");

  app.BackendDB.data.reelEventsByUser[uid] = savedReels;

  
  // 7. Part 12B Extended Code Patches & Delta Findings Verification
  assert(typeof app.sha256HexSync === "function", "Part 12B: sha256HexSync must be exported");
  const abcHash = app.sha256HexSync("abc");
  assert(
    abcHash === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    "Part 12B: sha256HexSync('abc') must equal NIST FIPS 180-4 64-char SHA-256 vector, got: " + abcHash
  );
  assert(
    app.simpleSha256Hex("abc") === abcHash,
    "Part 12B: simpleSha256Hex('abc') must return full 64-char SHA-256 digest"
  );

  // DOM Alias map verification
  assert(
    sandbox.document.getElementById("inputSignupPassword") === sandbox.document.getElementById("signupPasswordInput"),
    "Part 12B: documentMock.getElementById('inputSignupPassword') must alias #signupPasswordInput"
  );
  assert(
    sandbox.document.getElementById("authForgotPanel") === sandbox.document.getElementById("authFormForgot"),
    "Part 12B: documentMock.getElementById('authForgotPanel') must alias #authFormForgot"
  );
  assert(
    sandbox.document.getElementById("inputResetNewPassword") === sandbox.document.getElementById("forgotNewPasswordInput"),
    "Part 12B: documentMock.getElementById('inputResetNewPassword') must alias #forgotNewPasswordInput"
  );
  assert(
    sandbox.document.getElementById("viewConnectedDevices") !== null,
    "Part 12B: #viewConnectedDevices must resolve in DOM"
  );

  // Unified AuthService.verifyOtp & PasswordRequirementsValidator alias properties
  assert(typeof app.AuthService.verifyOtp === "function", "Part 12B: AuthService.verifyOtp must be a function");
  const pwEval = app.PasswordRequirementsValidator.evaluate("StrongPass!2026");
  assert(
    pwEval.allValid === true && pwEval.lenOk === true && pwEval.caseOk === true && pwEval.numSymOk === true,
    "Part 12B: PasswordRequirementsValidator.evaluate must expose allValid, lenOk, caseOk, numSymOk"
  );

  // DeviceEnvironmentDetector.classifyPlatform & DeviceSecurityManager.getOsCategoryIconSvg
  assert(
    typeof app.DeviceEnvironmentDetector.classifyPlatform === "function",
    "Part 12B: DeviceEnvironmentDetector.classifyPlatform must exist"
  );
  const macSpec = app.DeviceEnvironmentDetector.classifyPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4)", "MacIntel", 0);
  assert(macSpec.osCategory === "macOS" && macSpec.osFamily === "MACOS" && macSpec.deviceType === "desktop", "Part 12B: macOS UA must classify as macOS/MACOS/desktop");
  assert(
    typeof app.DeviceSecurityManager.getOsCategoryIconSvg === "function" &&
    app.DeviceSecurityManager.getOsCategoryIconSvg("android", "mobile").includes("<svg"),
    "Part 12B: DeviceSecurityManager.getOsCategoryIconSvg must return inline SVG"
  );

  // ExtensionHeartbeatTamperGuard.validateTelemetryPayload & AccountSecurityManager & CompanionPairingCodeManager
  assert(
    typeof app.ExtensionHeartbeatTamperGuard.validateTelemetryPayload === "function",
    "Part 12B: ExtensionHeartbeatTamperGuard.validateTelemetryPayload must exist"
  );
  const validTickCheck = app.ExtensionHeartbeatTamperGuard.validateTelemetryPayload({
    installationId: "inst_test_12b",
    durationMs: 15000,
    reelCount: 2
  });
  assert(validTickCheck && validTickCheck.valid === true, "Part 12B: validateTelemetryPayload must accept valid bounded payload");
  const invalidTickCheck = app.ExtensionHeartbeatTamperGuard.validateTelemetryPayload({
    installationId: "inst_test_12b",
    durationMs: -500
  });
  assert(invalidTickCheck && invalidTickCheck.valid === false, "Part 12B: validateTelemetryPayload must reject negative durationMs");

  assert(
    app.AccountSecurityManager && typeof app.AccountSecurityManager.generateTotpSecret === "function",
    "Part 12B: AccountSecurityManager must be exported with TOTP 2FA support"
  );
  assert(
    app.CompanionPairingCodeManager && typeof app.CompanionPairingCodeManager.generatePairingCode === "function",
    "Part 12B: CompanionPairingCodeManager must be exported"
  );
  const pairingObj = app.CompanionPairingCodeManager.generatePairingCode();
  assert(
    pairingObj && typeof pairingObj.code === "string" && pairingObj.code.length === 6,
    "Part 12B: CompanionPairingCodeManager.generatePairingCode() must produce a 6-char code"
  );

  // Canonical 15 tables & sync_server.js v1 endpoints check
  assert(
    Array.isArray(app.SupabaseSyncEngine.CANONICAL_15_TABLES) &&
    app.SupabaseSyncEngine.CANONICAL_15_TABLES.length === 15,
    "Part 12B: SupabaseSyncEngine.CANONICAL_15_TABLES must list all 15 canonical tables"
  );
  const syncServerSrc = fs.readFileSync(path.join(path.resolve(__dirname, ".."), "server", "sync_server.js"), "utf8");
  assert(
    syncServerSrc.includes("/api/v1/health") &&
    syncServerSrc.includes("/api/v1/companion/tick") &&
    syncServerSrc.includes("/api/v1/extension/events") &&
    syncServerSrc.includes("/api/sync/stream") &&
    syncServerSrc.includes("/ws/companion"),
    "Part 12B: server/sync_server.js must implement /api/v1/health, /api/v1/companion/tick, /api/v1/extension/events, /api/sync/stream, and /ws/companion"
  );

  // =========================================================================
  // PART 11A: CATEGORY 11 (OS PERMISSIONS, OEM ROUTER & NATIVE WIDGETS) REGRESSION SUITE
  // =========================================================================
  {
    const rootDir = path.resolve(__dirname, "..");
    const indexHtmlSrc = fs.readFileSync(path.join(rootDir, "src", "index.html"), "utf8");
    const oemJsonObj = JSON.parse(fs.readFileSync(path.join(rootDir, "config", "oem_profiles.json"), "utf8"));
    const mainActivitySrc = fs.readFileSync(
      path.join(rootDir, "android", "app", "src", "main", "java", "io", "screensync", "wellness", "MainActivity.java"),
      "utf8"
    );
    const accServiceSrc = fs.readFileSync(
      path.join(rootDir, "android", "app", "src", "main", "java", "io", "screensync", "wellness", "ScreenSyncAccessibilityService.java"),
      "utf8"
    );
    const reelWidgetSrc = fs.readFileSync(
      path.join(rootDir, "android", "app", "src", "main", "java", "io", "screensync", "wellness", "ReelTrackerWidgetProvider.java"),
      "utf8"
    );
    const screenWidgetSrc = fs.readFileSync(
      path.join(rootDir, "android", "app", "src", "main", "java", "io", "screensync", "wellness", "ScreenTimeGoalWidgetProvider.java"),
      "utf8"
    );
    const widgetUpdaterSrc = fs.readFileSync(
      path.join(rootDir, "android", "app", "src", "main", "java", "io", "screensync", "wellness", "ScreenSyncWidgetUpdater.java"),
      "utf8"
    );
    const manifestSrc = fs.readFileSync(
      path.join(rootDir, "android", "app", "src", "main", "AndroidManifest.xml"),
      "utf8"
    );
    const accConfigXml = fs.readFileSync(
      path.join(rootDir, "android", "app", "src", "main", "res", "xml", "accessibility_service_config.xml"),
      "utf8"
    );
    const iosAppDelegateSrc = fs.readFileSync(
      path.join(rootDir, "ios", "App", "App", "AppDelegate.swift"),
      "utf8"
    );
    const iosWidgetSwiftSrc = fs.readFileSync(
      path.join(rootDir, "ios", "App", "ScreenSyncIslandWidgetExtension", "ScreenSyncLiveActivityWidget.swift"),
      "utf8"
    );
    const iosWidgetPlistSrc = fs.readFileSync(
      path.join(rootDir, "ios", "App", "ScreenSyncIslandWidgetExtension", "Info.plist"),
      "utf8"
    );

    // CAT11-01: #permissionOnboardingModal must not have inline display:none !important and must open via openInteractiveWizardModal() & close cleanly
    assert(
      !indexHtmlSrc.includes('id="permissionOnboardingModal" aria-hidden="true" style="display:none !important;"'),
      "CAT11-01: #permissionOnboardingModal must not have inline display:none !important blocking interactive wizard open"
    );
    const interactiveOpenRes = app.PermissionOnboardingManager.openInteractiveWizardModal("Android");
    const permModalEl = documentMock.getElementById("permissionOnboardingModal");
    assert(
      interactiveOpenRes && interactiveOpenRes.opened === true && !permModalEl.classList.contains("hidden") && permModalEl.getAttribute("aria-hidden") === "false",
      "CAT11-01: openInteractiveWizardModal must make #permissionOnboardingModal visible"
    );
    const closeWizRes = app.PermissionOnboardingManager.closeModal();
    assert(
      closeWizRes && closeWizRes.closed === true && permModalEl.classList.contains("hidden") && permModalEl.getAttribute("aria-hidden") === "true",
      "CAT11-01: closeModal must hide #permissionOnboardingModal and restore aria-hidden=true"
    );

    // CAT11-02 & CAT11-03: Sequential native permission prompt & unified accessibility disclosure consent
    assert(
      mainActivitySrc.includes("isAccessibilityConsentAcceptedInStore()") &&
      mainActivitySrc.includes("battery_prompted_after_overlay") &&
      mainActivitySrc.includes("openSystemAccessibilitySettingsForRevoke"),
      "CAT11-02 & CAT11-03: MainActivity.java must implement unified consent store helper, battery sequential step, and revoke settings intent"
    );
    assert(
      accServiceSrc.includes("CAT11-03: Default deny until explicit user acceptance") &&
      accServiceSrc.includes("isSensitiveVaultOrBankingPackage(pkg)") &&
      accServiceSrc.includes("hashSignatureToken(norm)"),
      "CAT11-03, CAT11-10 & CAT11-22: ScreenSyncAccessibilityService must default-deny unconsented access, block sensitive vault/banking apps, and hash signature tokens"
    );

    // CAT11-04: LockScreenWidgetBridge hydration, reelsText/watchTimeText, and native pin gate
    const widgetPayload = app.LockScreenWidgetBridge.buildWidgetPayload();
    assert(
      typeof widgetPayload.reelsText === "string" &&
      typeof widgetPayload.watchTimeText === "string" &&
      widgetPayload.dailyGoalMinutes >= 5 &&
      widgetPayload.dailyGoalMinutes <= 480,
      "CAT11-04: LockScreenWidgetBridge.buildWidgetPayload must include reelsText, watchTimeText, and clamped dailyGoalMinutes"
    );

    // CAT11-05, CAT11-16, CAT11-17: Android widget providers & updater
    assert(
      mainActivitySrc.includes("persistWidgetMetricsToStore") &&
      reelWidgetSrc.includes("Math.max(5, Math.min(480") &&
      screenWidgetSrc.includes("Math.max(15, Math.min(960") &&
      !widgetUpdaterSrc.includes("context.sendBroadcast("),
      "CAT11-05, CAT11-16, CAT11-17: Widget goal bounds, midnight day-key validation, and single direct update pass must be enforced"
    );

    // CAT11-06, CAT11-07, CAT11-12, CAT11-14, CAT11-15: Spec aliases, 5-state support, DOM alias, and truthful feature readiness
    assert(
      app.PermissionFlowController === app.PermissionOnboardingManager &&
      app.OemPermissionAdvisor === app.OemPermissionGuideController,
      "CAT11-07: PermissionFlowController and OemPermissionAdvisor aliases must be exported on window.ScreenSyncApp"
    );
    assert(
      documentMock.getElementById("accountPermissionsList") === documentMock.getElementById("accountPermissionsStatusList"),
      "CAT11-07: document.getElementById('accountPermissionsList') must resolve to #accountPermissionsStatusList"
    );
    assert(
      app.PermissionOnboardingManager.resolvePermissionIdAlias("SCREEN_TIME_USAGE") === "usage_stats" &&
      app.PermissionOnboardingManager.resolvePermissionIdAlias("SHORT_FORM_ACCESSIBILITY") === "accessibility" &&
      app.PermissionOnboardingManager.resolvePermissionIdAlias("OVERLAY_HUD") === "overlay" &&
      app.PermissionOnboardingManager.normalizePermissionState("RESTRICTED") === "RESTRICTED" &&
      app.PermissionOnboardingManager.normalizePermissionState("LIMITED") === "LIMITED" &&
      app.PermissionOnboardingManager.normalizePermissionState("NOT_DETERMINED") === "NOT_DETERMINED",
      "CAT11-06 & CAT11-07: Spec permission ID aliases and 5-state permission values must be supported"
    );

    // CAT11-08: 100% parity between config/oem_profiles.json and OemPermissionGuideController.OEM_PROFILES_CATALOG + Transsion support
    const parityCheck = app.OemPermissionGuideController.verifyCatalogParityWithJson(oemJsonObj);
    assert(
      parityCheck.ok === true && parityCheck.profileCount === 8,
      "CAT11-08: config/oem_profiles.json and OemPermissionGuideController.OEM_PROFILES_CATALOG must have 100% parity across all 8 OEM profiles: " + JSON.stringify(parityCheck.mismatches)
    );
    const transsionCaps = app.OemPermissionGuideController.detectOemCapabilities({ manufacturer: "TECNO", brand: "TECNO", model: "TECNO CK9n" });
    assert(
      transsionCaps.oemFamily === "TRANSSION_HIOS_XOS" &&
      transsionCaps.recommendedSettingsTitle.includes("HiOS / XOS") &&
      mainActivitySrc.includes("TRANSSION_HIOS_XOS") &&
      manifestSrc.includes("com.transsion.phonemaster"),
      "CAT11-08: Transsion (Tecno/Infinix/itel) must be supported across JS, MainActivity.java, and AndroidManifest.xml"
    );

    // CAT11-09 & Step 5.3/5.4: Per-step OEM checklist completion & non-generic device marketing name resolution
    const stepSetRes = app.OemPermissionGuideController.setChecklistStepCompleted("autostart", true, "inst_oem_test_11a");
    assert(
      stepSetRes.ok === true && app.OemPermissionGuideController.getChecklistStepCompletionMap("inst_oem_test_11a").autostart === true,
      "CAT11-09: OemPermissionGuideController must persist per-step completion state"
    );
    const resolvedName = app.OemPermissionGuideController.resolveInstalledDeviceDisplayName({
      brand: "Redmi",
      model: "25053RT47C",
      osCategory: "Android"
    });
    assert(
      resolvedName === "Redmi Turbo 4 Pro" && !resolvedName.includes("Android Device") && !resolvedName.includes("Linux Workstation"),
      "CAT11-09: resolveInstalledDeviceDisplayName must resolve SKU 25053RT47C to 'Redmi Turbo 4 Pro' and never fall back to 'Android Device' or 'Linux Workstation'"
    );

    // CAT11-10, CAT11-11, CAT11-22: Accessibility disclosure copy, turn-off flow, and XML rationale
    assert(
      !indexHtmlSrc.includes("Pinterest Watch") &&
      indexHtmlSrc.includes("Messenger &amp; WhatsApp Stories") &&
      accConfigXml.includes("CAT11-22 Google Play Accessibility Policy"),
      "CAT11-10 & CAT11-22: Disclosure copy must match SUPPORTED_PACKAGES without Pinterest Watch and XML must document policy rationale"
    );
    assert(
      typeof app.AccessibilityDisclosureManager.turnOffAccessibilityServiceInOsSettings === "function",
      "CAT11-11: AccessibilityDisclosureManager.turnOffAccessibilityServiceInOsSettings must exist"
    );

    // CAT11-18: iOS WidgetKit StaticConfiguration, WidgetBundle, Info.plist, and live permission map
    assert(
      iosWidgetSwiftSrc.includes("struct ScreenSyncHomeAndLockWidget: Widget") &&
      iosWidgetSwiftSrc.includes("StaticConfiguration") &&
      iosWidgetSwiftSrc.includes("@main") &&
      iosWidgetSwiftSrc.includes("struct ScreenSyncWidgetBundle: WidgetBundle") &&
      iosWidgetPlistSrc.includes("com.apple.widgetkit-extension") &&
      iosAppDelegateSrc.includes("getAllPermissionStatusJson"),
      "CAT11-18 & CAT11-12: iOS WidgetExtension must define StaticConfiguration + WidgetBundle + Info.plist and AppDelegate must expose getAllPermissionStatusJson"
    );

    // CAT11-20: CrossPlatformScreenAccessManager desktop capability metadata & unknownNotProbedPermissions
    const macCapReport = app.CrossPlatformScreenAccessManager.getPermissionAndCapabilityReport("macOS", "inst_mac_11a");
    assert(
      macCapReport.desktopReelDetectionMode === "COMPANION_AND_EXTENSION_DEPENDENT" &&
      macCapReport.profile.reelMeasurementStatus === "COMPANION_AND_EXTENSION_DEPENDENT" &&
      Array.isArray(macCapReport.unknownNotProbedPermissions),
      "CAT11-20: CrossPlatformScreenAccessManager must report COMPANION_AND_EXTENSION_DEPENDENT for desktop reel detection and expose unknownNotProbedPermissions"
    );
    // Part 11B Delta Verifications (DF-11B-01 through DF-11B-06)
    const screenWidgetXml11b = fs.readFileSync(path.join(rootDir, "android", "app", "src", "main", "res", "xml", "widget_screen_time_info.xml"), "utf8");
    assert(
      screenWidgetXml11b.includes("home_screen|keyguard") &&
      screenWidgetXml11b.includes("targetCellWidth") &&
      manifestSrc.includes("com.oplus.battery") &&
      mainActivitySrc.includes("com.oplus.startupapp.view.StartupAppListActivity") &&
      mainActivitySrc.includes("activePermissionDialog"),
      "Part 11B DF-11B-01..03: widget_screen_time_info.xml keyguard, com.oplus.battery query, and MainActivity activePermissionDialog + ColorOS 14/15 StartupAppListActivity must be present"
    );
    assert(
      app.DeviceMarketingNameResolver.isRawModelIdentifier("GKV4X") === true &&
      app.DeviceMarketingNameResolver.isRawModelIdentifier("PKR110") === true &&
      app.DeviceMarketingNameResolver.resolveMarketingNameSync("RMX3851", "Realme", "Android") === "Realme GT 6T" &&
      app.OemPermissionGuideController.classifyOemFamilyFromStrings("Samsung", "Samsung", "SM-S241B") === "SAMSUNG_ONEUI" &&
      typeof app.OemPermissionGuideController.loadExternalOemProfilesJson === "function" &&
      typeof app.CrossPlatformScreenAccessManager.evaluateCapability === "function" &&
      typeof app.CrossPlatformScreenAccessManager.getCapabilityMatrix === "function" &&
      app.CrossPlatformScreenAccessManager.isSensitivePackage("com.x8bit.bitwarden") === true &&
      app.CrossPlatformScreenAccessManager.sanitizeScreenActivitySample({ packageName: "com.x8bit.bitwarden", appKey: "bitwarden" }).status === "SENSITIVE_PACKAGE_BLOCKED" &&
      Boolean(app.NativeUsageIntegrationService.PLATFORM_NATIVE_SOURCES.Linux) &&
      typeof app.LockScreenWidgetBridge.syncNativeWidgetMetrics === "function",
      "Part 11B DF-11B-04..06: SKU regex, RMX3851 parity, anchored OEM classification, capability matrix, sensitive package block, Linux source, and widget sync bridge must pass"
    );
  }

  // =========================================================================
  // ENVIRONMENT CONFIGURATION AUDIT & SECURITY HARDENING VERIFICATION SUITE (ENV-TEST-06)
  // =========================================================================
  {
    const rootDir = path.resolve(__dirname, "..");

    // 1. Root .gitignore verification (ENV-SEC-01)
    const gitignorePath = path.join(rootDir, ".gitignore");
    assert(fs.existsSync(gitignorePath), "ENV-SEC-01: Root .gitignore must exist at repository root");
    const gitignoreSrc = fs.readFileSync(gitignorePath, "utf8");
    const requiredIgnoreEntries = [
      ".env",
      ".env.local",
      ".env.production",
      ".env.*",
      "supabase/functions/.env",
      "server/.env",
      "!.env.example"
    ];
    for (const entry of requiredIgnoreEntries) {
      assert(
        gitignoreSrc.split(/\r?\n/).map(l => l.trim()).includes(entry),
        `ENV-SEC-01: Root .gitignore must contain exact line '${entry}'`
      );
    }

    // 2. .env.example duplicate-free & canonical port verification (ENV-PORT-02)
    const envExamplePath = path.join(rootDir, ".env.example");
    assert(fs.existsSync(envExamplePath), "ENV-PORT-02: .env.example must exist");
    const envExampleSrc = fs.readFileSync(envExamplePath, "utf8");
    assert(!envExampleSrc.includes("39847"), "ENV-PORT-02: .env.example must not contain stale port 39847");
    const definedEnvKeys = [];
    const envKeyValues = Object.create(null);
    envExampleSrc.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const k = trimmed.slice(0, eqIdx).trim();
        const v = trimmed.slice(eqIdx + 1).trim();
        definedEnvKeys.push(k);
        envKeyValues[k] = v;
      }
    });
    const uniqueEnvKeys = new Set(definedEnvKeys);
    assert(
      definedEnvKeys.length === uniqueEnvKeys.size,
      "ENV-PORT-02: .env.example must contain zero duplicate active variable declarations"
    );
    assert(
      envKeyValues.SCREENSYNC_SYNC_PORT === "3001" &&
      envKeyValues.SCREENSYNC_SYNC_FALLBACK_PORT === "8788" &&
      envKeyValues.SCREENSYNC_COMPANION_PORT === "19540" &&
      envKeyValues.SCREENSYNC_COMPANION_FALLBACK_PORT === "17935" &&
      envKeyValues.SCREENSYNC_PORT === "3000",
      "ENV-PORT-02: .env.example must define canonical ports 3000, 3001, 8788, 19540, and 17935"
    );

    // 3. RuntimeConfigLoader VITE_* / SCREENSYNC_* resolution & secret stripping (ENV-CFG-04)
    const testTargetCfg = { ...app.RuntimeConfigLoader.DEFAULT_CONFIG };
    app.RuntimeConfigLoader.forbiddenKeysStripped = false;
    app.RuntimeConfigLoader._sanitizeAndApplyLayer(testTargetCfg, {
      VITE_SUPABASE_URL: "https://ldephpgydnsovhlkuzbe.supabase.co/",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_8mgpzcakPnNv8Z3g5lB_fg_86vpH-_q",
      VITE_SUPABASE_PROJECT_REF: "ldephpgydnsovhlkuzbe",
      SCREENSYNC_SYNC_PORT: "3001",
      SCREENSYNC_COMPANION_PORT: "19540",
      SCREENSYNC_REEL_MIN_DWELL_MS: "1500",
      SCREENSYNC_REEL_SETTLE_DEBOUNCE_MS: "350",
      SCREENSYNC_IDLE_THRESHOLD_SECONDS: "240",
      SCREENSYNC_SOUND_HARMFUL_DB_THRESHOLD: "78",
      VITE_SUPABASE_SECRET_KEY: "should_be_stripped",
      SUPABASE_SERVICE_ROLE_KEY: "should_be_stripped",
      BREVO_SMTP_PASSWORD: "should_be_stripped",
      BREVO_API_KEY: "should_be_stripped"
    }, "ENV_HARDENING_TEST");
    assert(
      app.RuntimeConfigLoader.forbiddenKeysStripped === true &&
      testTargetCfg.supabaseUrl === "https://ldephpgydnsovhlkuzbe.supabase.co" &&
      testTargetCfg.supabasePublishableKey === "sb_publishable_8mgpzcakPnNv8Z3g5lB_fg_86vpH-_q" &&
      testTargetCfg.syncServerBaseUrl === "http://127.0.0.1:3001" &&
      testTargetCfg.desktopCompanionBaseUrl === "http://127.0.0.1:19540" &&
      testTargetCfg.reelMinDwellMs === 1500 &&
      testTargetCfg.scrollSettleDebounceMs === 350 &&
      testTargetCfg.idleThresholdSeconds === 240 &&
      testTargetCfg.soundHarmfulDbThreshold === 78 &&
      !("VITE_SUPABASE_SECRET_KEY" in testTargetCfg) &&
      !("SUPABASE_SERVICE_ROLE_KEY" in testTargetCfg) &&
      !("BREVO_SMTP_PASSWORD" in testTargetCfg) &&
      !("BREVO_API_KEY" in testTargetCfg),
      "ENV-CFG-04: RuntimeConfigLoader must resolve VITE_* and SCREENSYNC_* keys while stripping all secret keys"
    );

    // 4. Browser extension background_collector.js port 3001 & 8788 fallback verification (ENV-PORT-03)
    const extBgSrc = fs.readFileSync(path.join(rootDir, "platforms", "browser-extension", "background_collector.js"), "utf8");
    assert(
      extBgSrc.includes('DEFAULT_EXTENSION_SYNC_ENDPOINT = "http://127.0.0.1:3001/api/v1/extension/events"') &&
      extBgSrc.includes('FALLBACK_EXTENSION_SYNC_ENDPOINT = "http://127.0.0.1:8788/api/v1/extension/events"') &&
      !extBgSrc.includes("4173"),
      "ENV-PORT-03: background_collector.js must target port 3001 with 8788 fallback and contain zero references to port 4173"
    );

    // 5. server/sync_server.js exports & cross-platform env consumers verification (ENV-CFG-05)
    const syncSrvMod = require(path.join(rootDir, "server", "sync_server.js"));
    assert(
      syncSrvMod.PORT === 3001 &&
      syncSrvMod.FALLBACK_PORT === 8788 &&
      typeof syncSrvMod.loadLocalEnvFileIfPresent === "function",
      "ENV-CFG-05: server/sync_server.js must export PORT === 3001, FALLBACK_PORT === 8788, and loadLocalEnvFileIfPresent"
    );
    const winProgSrc = fs.readFileSync(path.join(rootDir, "platforms", "windows", "Program.cs"), "utf8");
    const macMainSrc = fs.readFileSync(path.join(rootDir, "platforms", "macos", "Sources", "main.swift"), "utf8");
    const edgeDelSrc = fs.readFileSync(path.join(rootDir, "supabase", "functions", "delete-account", "index.ts"), "utf8");
    const readmeMdSrc = fs.readFileSync(path.join(rootDir, "README.md"), "utf8");
    assert(
      winProgSrc.includes("SCREENSYNC_COMPANION_PORT") &&
      macMainSrc.includes("SCREENSYNC_COMPANION_PORT") &&
      edgeDelSrc.includes('getEnv("SUPABASE_ANON_KEY") || getEnv("SUPABASE_PUBLISHABLE_KEY")') &&
      !readmeMdSrc.includes("43110"),
      "ENV-CFG-05: Windows Program.cs, macOS main.swift, delete-account Edge Function, and README.md must align on env vars and port 3001"
    );
  }

  // 6. Modular Firebase (FCM + Crashlytics via BoM 35.2.0) & Supabase Push Edge Function verification
  {
    const googleServicesPath = path.join(rootDir, "android", "app", "google-services.json");
    const googlePlistPath = path.join(rootDir, "ios", "App", "App", "GoogleService-Info.plist");
    assert(fs.existsSync(googleServicesPath), "FCM-01: android/app/google-services.json must exist");
    assert(fs.existsSync(googlePlistPath), "FCM-01: ios/App/App/GoogleService-Info.plist must exist");
    const gsJson = JSON.parse(fs.readFileSync(googleServicesPath, "utf8"));
    assert(
      gsJson.project_info?.project_id === "screensync-9fc1f" &&
      gsJson.client?.[0]?.client_info?.android_client_info?.package_name === "io.screensync.wellness",
      "FCM-01: google-services.json must match screensync-9fc1f and io.screensync.wellness"
    );
    const plistStr = fs.readFileSync(googlePlistPath, "utf8");
    assert(
      plistStr.includes("screensync-9fc1f") && plistStr.includes("io.screensync.wellness"),
      "FCM-01: GoogleService-Info.plist must match screensync-9fc1f and io.screensync.wellness"
    );

    const appGradleStr = fs.readFileSync(path.join(rootDir, "android", "app", "build.gradle"), "utf8");
    assert(
      appGradleStr.includes("com.google.firebase:firebase-bom:35.2.0") &&
      appGradleStr.includes("com.google.firebase:firebase-messaging") &&
      appGradleStr.includes("com.google.firebase:firebase-crashlytics") &&
      !appGradleStr.includes("firebase-auth") &&
      !appGradleStr.includes("firebase-firestore"),
      "FCM-02: android/app/build.gradle must use modular BoM 35.2.0 (messaging + crashlytics) without firebase-auth/firestore"
    );

    const cfgStr = fs.readFileSync(path.join(rootDir, "config", "screensync.config.json"), "utf8");
    const cfgObj = JSON.parse(cfgStr);
    assert(
      cfgObj.firebase?.projectId === "screensync-9fc1f" &&
      cfgObj.firebase?.vapidKey?.startsWith("BM2TrsTd") &&
      !cfgStr.includes("private_key") &&
      !cfgStr.includes("firebase-adminsdk"),
      "FCM-03: config/screensync.config.json must include public firebase + vapidKey and zero private secrets"
    );

    const pushMigPath = path.join(rootDir, "supabase", "migrations", "20261022000016_device_push_tokens_and_notifications.sql");
    assert(fs.existsSync(pushMigPath), "FCM-04: device_push_tokens migration 000016 must exist");
    const pushMigSql = fs.readFileSync(pushMigPath, "utf8");
    assert(
      pushMigSql.includes("ENABLE ROW LEVEL SECURITY") &&
      pushMigSql.includes("FORCE ROW LEVEL SECURITY") &&
      pushMigSql.includes("REVOKE ALL ON public.device_push_tokens FROM anon"),
      "FCM-04: device_push_tokens migration must enforce ENABLE + FORCE RLS and revoke anon"
    );

    const pushFnPath = path.join(rootDir, "supabase", "functions", "send-push-notification", "index.ts");
    assert(fs.existsSync(pushFnPath), "FCM-05: send-push-notification Edge Function must exist");
    const pushFnSrc = fs.readFileSync(pushFnPath, "utf8");
    assert(
      pushFnSrc.includes("FIREBASE_SERVICE_ACCOUNT_MISSING") &&
      pushFnSrc.includes("https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send") &&
      pushFnSrc.includes("screensync-9fc1f"),
      "FCM-05: send-push-notification must fail closed on missing service account and target FCM HTTP v1"
    );

    const fbCfg = app.FirebasePushManager.getConfig();
    assert(fbCfg && fbCfg.projectId === "screensync-9fc1f" && fbCfg.vapidKey.startsWith("BM2TrsTd"), "FCM-06: FirebasePushManager.getConfig must return public Firebase config");
    assert(
      app.FirebasePushManager &&
      typeof app.FirebasePushManager.onNativePushToken === "function" &&
      typeof app.FirebasePushManager.registerPushToken === "function",
      "FCM-06: ScreenSyncApp.FirebasePushManager must be exposed"
    );
    app.RuntimeConfigLoader._sanitizeAndApplyLayer({}, { FIREBASE_SERVICE_ACCOUNT_JSON: "-----BEGIN PRIVATE KEY-----" }, "FCM_SECRET_TEST");
    assert(app.RuntimeConfigLoader.forbiddenKeysStripped === true, "FCM-06: RuntimeConfigLoader must strip FIREBASE_SERVICE_ACCOUNT_JSON");
  }

  // 7. Dormant Google & Apple OAuth (SOCIAL_OAUTH_UI_ENABLED: false) & Deep-Link Callbacks
  {
    const cfgObj = JSON.parse(fs.readFileSync(path.join(rootDir, "config", "screensync.config.json"), "utf8"));
    assert(cfgObj.SOCIAL_OAUTH_UI_ENABLED === false, "OAUTH-01: config/screensync.config.json must keep SOCIAL_OAUTH_UI_ENABLED === false");
    assert(app.RuntimeConfigLoader.getConfig().SOCIAL_OAUTH_UI_ENABLED === false, "OAUTH-01: RuntimeConfigLoader.getConfig().SOCIAL_OAUTH_UI_ENABLED must default to false");

    const srcHtml = fs.readFileSync(path.join(rootDir, "src", "index.html"), "utf8");
    assert(
      srcHtml.includes('id="socialOAuthContainer"') &&
      srcHtml.includes('id="btnOAuthGoogle"') &&
      srcHtml.includes('id="btnOAuthApple"'),
      "OAUTH-02: src/index.html must include #socialOAuthContainer, #btnOAuthGoogle, and #btnOAuthApple"
    );

    const containerEl = documentMock.getElementById("socialOAuthContainer");
    assert(containerEl, "OAUTH-02: #socialOAuthContainer must be queryable in DOM");
    app.state.authTab = "LOGIN";
    app.SocialOAuthProviderEngine.syncUiVisibility();
    assert(containerEl.classList.contains("hidden"), "OAUTH-02: #socialOAuthContainer must remain hidden when SOCIAL_OAUTH_UI_ENABLED === false");

    const origFlag = app.RuntimeConfigLoader.currentConfig.SOCIAL_OAUTH_UI_ENABLED;
    app.RuntimeConfigLoader.currentConfig.SOCIAL_OAUTH_UI_ENABLED = true;
    app.SocialOAuthProviderEngine.syncUiVisibility();
    assert(!containerEl.classList.contains("hidden"), "OAUTH-02: #socialOAuthContainer must become visible when SOCIAL_OAUTH_UI_ENABLED === true");
    app.RuntimeConfigLoader.currentConfig.SOCIAL_OAUTH_UI_ENABLED = origFlag;
    app.SocialOAuthProviderEngine.syncUiVisibility();

    assert(typeof app.SocialOAuthProviderEngine.handleOAuthCallbackUrl === "function", "OAUTH-03: handleOAuthCallbackUrl must be defined");
    const errRes = await app.SocialOAuthProviderEngine.handleOAuthCallbackUrl("io.screensync.wellness://auth/callback?error=access_denied&error_description=User+cancelled");
    assert(errRes && errRes.ok === false && errRes.status === "OAUTH_CALLBACK_ERROR", "OAUTH-03: handleOAuthCallbackUrl must surface error on ?error=access_denied");

    const manifestXml = fs.readFileSync(path.join(rootDir, "android", "app", "src", "main", "AndroidManifest.xml"), "utf8");
    const infoPlist = fs.readFileSync(path.join(rootDir, "ios", "App", "App", "Info.plist"), "utf8");
    assert(manifestXml.includes('android:scheme="io.screensync.wellness"') && manifestXml.includes('android:pathPrefix="/callback"'), "OAUTH-04: AndroidManifest.xml must declare io.screensync.wellness://auth/callback");
    assert(infoPlist.includes("<string>io.screensync.wellness</string>"), "OAUTH-04: Info.plist must declare io.screensync.wellness URL scheme");
  }

  return { ok: true, suite: "Category 11 & 12 Acceptance Tests (Part 11A + Part 11B + Part 12A + Part 12B + ENV-TEST-06 + Modular Firebase + Dormant OAuth Complete)" };
}

module.exports = { runCategory11And12Tests };
