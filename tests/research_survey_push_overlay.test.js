const fs = require("fs");
const path = require("path");
const assert = require("assert");

function runResearchSurveyPushOverlayTests({ app, documentMock, rootDir }) {
  // 1. Verify Supabase migration 018 exists with RLS + FORCE ROW LEVEL SECURITY
  const migPath = path.join(rootDir, "supabase/migrations/20261022000018_research_surveys_and_dismissals.sql");
  assert(fs.existsSync(migPath), "Migration 20261022000018_research_surveys_and_dismissals.sql must exist");
  const migSql = fs.readFileSync(migPath, "utf8");
  assert(migSql.includes("CREATE TABLE IF NOT EXISTS public.research_surveys"), "research_surveys table missing");
  assert(migSql.includes("CREATE TABLE IF NOT EXISTS public.research_survey_dismissals"), "research_survey_dismissals table missing");
  assert(migSql.includes("ENABLE ROW LEVEL SECURITY"), "RLS must be enabled");
  assert(migSql.includes("FORCE ROW LEVEL SECURITY"), "FORCE ROW LEVEL SECURITY must be enabled");
  assert(migSql.includes("get_pending_research_survey"), "get_pending_research_survey RPC missing");

  // 2. Verify all 5 HTML bundles contain the Research Survey overlay elements
  const bundlePaths = [
    "src/index.html",
    "www/index.html",
    "android/app/src/main/assets/public/index.html",
    "ios/App/App/public/index.html",
    "screensync_healthy_device_usage_cross_device_reel_tracker.html"
  ];
  const requiredIds = [
    "researchSurveyOverlayModal",
    "researchSurveyTitle",
    "researchSurveyBody",
    "btnResearchSurveyOpen",
    "btnResearchSurveyDismiss"
  ];
  for (const rel of bundlePaths) {
    const full = path.join(rootDir, rel);
    assert(fs.existsSync(full), `Bundle missing: ${rel}`);
    const html = fs.readFileSync(full, "utf8");
    for (const id of requiredIds) {
      assert(html.includes(id), `Element #${id} missing in ${rel}`);
    }
  }

  // 3. Verify ResearchSurveyOverlayController one-time display, bottomNav hiding, and URL validation
  const ctrl = app.ResearchSurveyOverlayController;
  assert(ctrl && typeof ctrl.showOverlay === "function", "ResearchSurveyOverlayController must be exported on ScreenSyncApp");
  assert.strictEqual(ctrl.validateSurveyUrl("javascript:alert(1)"), "", "Must block javascript: URIs");
  assert.strictEqual(ctrl.validateSurveyUrl("http://forms.gle/abc"), "", "Must require https://");
  assert.strictEqual(ctrl.validateSurveyUrl("https://forms.gle/test123"), "https://forms.gle/test123", "Must allow https:// Google Forms");

  const surveyPayload = {
    survey_id: "test_survey_2026_11",
    survey_url: "https://forms.gle/test123",
    title: "Test Research Survey",
    body: "Please share your feedback."
  };

  const modalEl = documentMock.getElementById("researchSurveyOverlayModal");
  const navEl = documentMock.getElementById("bottomNavBarContainer");
  if (navEl && navEl.classList) {
    navEl.classList.remove("hidden");
  }

  const shownFirst = ctrl.showOverlay(surveyPayload);
  assert.strictEqual(shownFirst, true, "First showOverlay call for unseen survey must return true");
  if (modalEl && modalEl.classList) {
    assert.strictEqual(modalEl.classList.contains("hidden"), false, "Modal must be visible when shown");
  }
  if (navEl && navEl.classList) {
    assert.strictEqual(navEl.classList.contains("hidden"), true, "#bottomNavBarContainer must be hidden while survey modal is open");
  }

  ctrl.closeOverlay("dismissed");
  if (modalEl && modalEl.classList) {
    assert.strictEqual(modalEl.classList.contains("hidden"), true, "Modal must be hidden after closeOverlay");
  }
  assert.strictEqual(ctrl.hasSeenSurvey("test_survey_2026_11"), true, "Survey must be marked seen after dismissal");

  const shownSecond = ctrl.showOverlay(surveyPayload);
  assert.strictEqual(shownSecond, false, "Same survey_id must never show a second time");

  // 4. Verify PushNotificationManager.urlBase64ToUint8Array converts VAPID key to 65-byte Uint8Array
  const pushMgr = app.PushNotificationManager;
  assert(pushMgr && typeof pushMgr.urlBase64ToUint8Array === "function", "PushNotificationManager.urlBase64ToUint8Array must exist");
  const vapidBytes = pushMgr.urlBase64ToUint8Array("BM2TrsTdKznjz-aRf-Pm54OeZ1NI00ZwquhrLSRQpq3AdsUJ3YU2Pw3y62JBw0EJGD5wKy5zHx-JikPHUaOCvks");
  assert(ArrayBuffer.isView(vapidBytes) && vapidBytes.constructor && vapidBytes.constructor.name === "Uint8Array", "Must return a Uint8Array");
  assert.strictEqual(vapidBytes.length, 65, "P-256 uncompressed VAPID key must decode to 65 bytes");
}

module.exports = { runResearchSurveyPushOverlayTests };
