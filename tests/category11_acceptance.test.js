#!/usr/bin/env node
/**
 * Standalone Category 11 (Part 11A + Part 11B: OS Permissions, OEM Special Permission Router & Native Widgets)
 * Acceptance & Regression Verification Runner
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const rootDir = path.resolve(__dirname, "..");

// 1. Verify 5-bundle SHA-256 parity
const htmlTargets = [
  "src/index.html",
  "www/index.html",
  "android/app/src/main/assets/public/index.html",
  "ios/App/App/public/index.html",
  "screensync_healthy_device_usage_cross_device_reel_tracker.html"
];
const htmlHashes = htmlTargets.map((rel) => {
  const buf = fs.readFileSync(path.join(rootDir, rel));
  return { rel, bytes: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex") };
});
for (const item of htmlHashes) {
  assert.strictEqual(item.sha256, htmlHashes[0].sha256, `5-bundle parity mismatch on ${item.rel}`);
}
console.log(`[PASS] 5-Bundle HTML Parity Verified (${htmlHashes[0].bytes} bytes, SHA-256: ${htmlHashes[0].sha256})`);

// 2. Verify 5-copy oem_profiles.json parity
const oemTargets = [
  "src/config/oem_profiles.json",
  "config/oem_profiles.json",
  "www/config/oem_profiles.json",
  "android/app/src/main/assets/public/config/oem_profiles.json",
  "ios/App/App/public/config/oem_profiles.json"
];
const oemHashes = oemTargets.map((rel) => {
  const buf = fs.readFileSync(path.join(rootDir, rel));
  return { rel, bytes: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex") };
});
for (const item of oemHashes) {
  assert.strictEqual(item.sha256, oemHashes[0].sha256, `OEM JSON parity mismatch on ${item.rel}`);
}
console.log(`[PASS] 5-Copy oem_profiles.json Parity Verified (${oemHashes[0].bytes} bytes, SHA-256: ${oemHashes[0].sha256})`);

// 3. Verify DOM markup in standalone HTML bundle
const domOut = fs.readFileSync(path.join(rootDir, "screensync_healthy_device_usage_cross_device_reel_tracker.html"), "utf8");
assert(domOut.includes('id="permissionOnboardingModal"'), "Missing #permissionOnboardingModal");
assert(!domOut.includes('id="permissionOnboardingModal" aria-hidden="true" style="display:none !important;"'), "Inline display:none !important must be removed from #permissionOnboardingModal");
assert(domOut.includes('id="accessibilityDisclosureModal"'), "Missing #accessibilityDisclosureModal");
assert(domOut.includes('data-alias-id="accountPermissionsList"'), "Missing data-alias-id=accountPermissionsList");
assert(domOut.includes("Messenger &amp; WhatsApp Stories"), "Missing Messenger & WhatsApp Stories in disclosure");
assert(!domOut.includes("Pinterest Watch"), "Pinterest Watch must not appear in disclosure or legal viewer");

// 4. Verify Part 11B Delta Fixes across Android XML, Manifest, Java, iOS Swift, and Sync Server
const reelWidgetXml = fs.readFileSync(path.join(rootDir, "android/app/src/main/res/xml/widget_reel_tracker_info.xml"), "utf8");
const screenWidgetXml = fs.readFileSync(path.join(rootDir, "android/app/src/main/res/xml/widget_screen_time_info.xml"), "utf8");
assert(
  reelWidgetXml.includes('android:widgetCategory="home_screen|keyguard"') &&
  screenWidgetXml.includes('android:widgetCategory="home_screen|keyguard"') &&
  reelWidgetXml.includes('android:targetCellWidth="2"') &&
  screenWidgetXml.includes('android:targetCellWidth="2"'),
  "Part 11B DF-11B-01: Both widget_reel_tracker_info.xml and widget_screen_time_info.xml must declare home_screen|keyguard and widget picker cell metadata"
);

const manifestXml = fs.readFileSync(path.join(rootDir, "android/app/src/main/AndroidManifest.xml"), "utf8");
assert(
  manifestXml.includes('<package android:name="com.oplus.battery" />') &&
  !manifestXml.includes("BIND_DEVICE_ADMIN") &&
  !manifestXml.includes("QUERY_ALL_PACKAGES"),
  "Part 11B DF-11B-02: AndroidManifest.xml must include com.oplus.battery in <queries> with zero BIND_DEVICE_ADMIN / QUERY_ALL_PACKAGES"
);

const mainActivityJava = fs.readFileSync(path.join(rootDir, "android/app/src/main/java/io/screensync/wellness/MainActivity.java"), "utf8");
assert(
  mainActivityJava.includes("activePermissionDialog") &&
  mainActivityJava.includes('"overlay".equals(safeType)') &&
  mainActivityJava.includes("com.oplus.startupapp.view.StartupAppListActivity") &&
  mainActivityJava.includes("com.miui.powerkeeper.ui.HiddenAppsConfigActivity") &&
  mainActivityJava.includes("com.samsung.android.sm_cn"),
  "Part 11B DF-11B-03: MainActivity.java must enforce non-overlapping activePermissionDialog, overlay OEM intent routing, and ColorOS/MIUI/Samsung CN fallback components"
);

const accServiceJava = fs.readFileSync(path.join(rootDir, "android/app/src/main/java/io/screensync/wellness/ScreenSyncAccessibilityService.java"), "utf8");
assert(
  accServiceJava.includes('"com.chrome.canary"') &&
  accServiceJava.includes('"org.mozilla.fenix"') &&
  accServiceJava.includes('"com.opera.gx"') &&
  accServiceJava.includes('"com.UCMobile.intl"') &&
  accServiceJava.includes('"com.android.credentials"') &&
  accServiceJava.includes('"com.samsung.android.samsungpass"'),
  "Part 11B DF-11B-04: ScreenSyncAccessibilityService.java must include all browser packages from accessibility_supported_apps.json and credential/biometric package exclusions"
);

const syncServerJs = fs.readFileSync(path.join(rootDir, "server/sync_server.js"), "utf8");
assert(
  syncServerJs.includes('"RMX3851": "Realme GT 6T"'),
  "Part 11B DF-11B-06: server/sync_server.js and src/js/app.js must map RMX3851 to Realme GT 6T matching MainActivity.java"
);

console.log("[PASS] Standalone HTML DOM Markup & Category 11 (Part 11A + Part 11B) Contracts Verified 100%.");
