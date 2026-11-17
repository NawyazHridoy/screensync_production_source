'use strict';

/**
 * Test 85 — Part 15 Verification Suite:
 * - Section P15.1: Android R8 Obfuscation (`minifyEnabled true`, `shrinkResources true`),
 *   Google PairIP Anti-Tamper (`ScreenSyncSecureApplication`, `com.pairip.licensecheck.LicenseActivity`,
 *   `CHECK_LICENSE`), `StringVault`, and 7-Layer `NativeAntiTamperGuard`
 * - Section P15.1B: Cross-OS Native & Web-Bundle Protection across iOS (`IosSecurityIntegrityGuard`),
 *   macOS (`ScreenSyncMacCompanion.entitlements` Hardened Runtime + `checkMacRuntimeIntegrity`),
 *   Windows Rust (`Cargo.toml` `strip = "symbols"`, `lto = "fat"`, `IsDebuggerPresent`) & C#
 *   (`ScreenSyncWindowsCompanion.csproj` + `BuildSecurityAttestationReport`), Linux (`TracerPid`,
 *   `LD_PRELOAD`, `0o600` permissions, HMAC state check), `CrossPlatformSecurityGuard` in `src/js/app.js`,
 *   and `scripts/harden-release-bundle.js` (`dist/hardened/`) while keeping `src/` readable
 * - Section P15.2: Production Chrome/Edge/Firefox Manifest V3 Browser Extension (`content_shortform_observer.js`,
 *   `content_bridge.js`, `background_collector.js`, `popup.html`, `popup.js`, `options.html`, `options.js`,
 *   `icons/icon-{16,32,48,128}.png`, and `dist/screensync-chrome-extension-mv3.zip`)
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

function runPart15SecurityAndExtensionTests(app, sandbox, rootDir) {
  // 1. Verify Task 15.1: R8 Obfuscation & ProGuard Hardening
  const buildGradle = fs.readFileSync(path.join(rootDir, 'android/app/build.gradle'), 'utf8');
  assert(
    buildGradle.includes('minifyEnabled true') &&
    buildGradle.includes('shrinkResources true') &&
    buildGradle.includes('crunchPngs true'),
    'P15.1 Task 15.1: android/app/build.gradle must enable minifyEnabled true, shrinkResources true, and crunchPngs true in release'
  );

  const proguardRules = fs.readFileSync(path.join(rootDir, 'android/app/proguard-rules.pro'), 'utf8');
  assert(
    !proguardRules.includes('-keep class io.screensync.wellness.** { *; }') &&
    proguardRules.includes('-keep public class io.screensync.wellness.MainActivity') &&
    proguardRules.includes('-keep public class com.pairip.application.Application { *; }') &&
    proguardRules.includes('@android.webkit.JavascriptInterface <methods>;') &&
    proguardRules.includes("-repackageclasses 'o'"),
    'P15.1 Task 15.1: android/app/proguard-rules.pro must remove blanket keep rule and enforce R8 repackaging + JavascriptInterface keeps'
  );

  // 2. Verify Task 15.2 & 15.3: Google PairIP Manifest, StringVault, ScreenSyncSecureApplication & NativeAntiTamperGuard
  const manifestXml = fs.readFileSync(path.join(rootDir, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  assert(
    manifestXml.includes('android:name="io.screensync.wellness.ScreenSyncSecureApplication"') &&
    manifestXml.includes('com.pairip.licensecheck.LicenseActivity') &&
    manifestXml.includes('com.android.vending.CHECK_LICENSE'),
    'P15.1 Task 15.2: AndroidManifest.xml must configure ScreenSyncSecureApplication, LicenseActivity, and CHECK_LICENSE'
  );

  const stringVaultJava = fs.readFileSync(
    path.join(rootDir, 'android/app/src/main/java/io/screensync/wellness/security/StringVault.java'),
    'utf8'
  );
  assert(
    stringVaultJava.includes('public static String decrypt(byte[] cipher, int seed)') &&
    stringVaultJava.includes('getOfficialReleaseCertSha256Pin'),
    'P15.1 Task 15.2: StringVault.java must implement decrypt(byte[] cipher, int seed)'
  );

  const antiTamperJava = fs.readFileSync(
    path.join(rootDir, 'android/app/src/main/java/io/screensync/wellness/NativeAntiTamperGuard.java'),
    'utf8'
  );
  assert(
    antiTamperJava.includes('GET_SIGNING_CERTIFICATES') &&
    antiTamperJava.includes('bin.mt.plus') &&
    antiTamperJava.includes('bin.mt.signature.KillerApplication') &&
    antiTamperJava.includes('TAMPER_DETECTED_ASSET_OR_DEX_MODIFIED') &&
    antiTamperJava.includes('TracerPid:') &&
    antiTamperJava.includes('frida-agent') &&
    antiTamperJava.includes('getInstallingPackageName') &&
    antiTamperJava.includes('verifyServerSignedEntitlementToken'),
    'P15.1 Task 15.3: NativeAntiTamperGuard.java must implement all 7 anti-reverse-engineering and anti-crack layers'
  );

  const mainActivityJava = fs.readFileSync(
    path.join(rootDir, 'android/app/src/main/java/io/screensync/wellness/MainActivity.java'),
    'utf8'
  );
  assert(
    mainActivityJava.includes('NativeAntiTamperGuard.verifyIntegrity(this)') &&
    mainActivityJava.includes('public String getIntegrityAttestationJson()'),
    'P15.1 Task 15.3: MainActivity.java must invoke NativeAntiTamperGuard and expose getIntegrityAttestationJson()'
  );

  // 3. Verify Task 15.3 Layer 6 & Task 15.4: CrossPlatformSecurityGuard & Server-Signed Entitlement JWT
  assert(
    app.CrossPlatformSecurityGuard &&
    typeof app.CrossPlatformSecurityGuard.computeHmacSha256Hex === 'function' &&
    typeof app.CrossPlatformSecurityGuard.verifyPersistedRecordIntegrity === 'function' &&
    typeof app.CrossPlatformSecurityGuard.verifyControllerPrototypeIntegrity === 'function',
    'P15.1B Task 15.4: CrossPlatformSecurityGuard must be exposed on window.ScreenSyncApp'
  );

  app.CrossPlatformSecurityGuard.captureControllerMethodFingerprints();
  const protoStatus = app.CrossPlatformSecurityGuard.verifyControllerPrototypeIntegrity();
  assert.strictEqual(protoStatus.ok, true, 'P15.1B Task 15.4: Controller prototype integrity check must pass');

  // Simulate runtime method monkey-patching / prototype tampering and verify detection
  const origIsFeatureUnlocked = app.SubscriptionAndBillingEngine.isFeatureUnlocked;
  app.SubscriptionAndBillingEngine.isFeatureUnlocked = function tamperedUnlock() { return true; };
  const tamperedProtoStatus = app.CrossPlatformSecurityGuard.verifyControllerPrototypeIntegrity();
  assert.strictEqual(tamperedProtoStatus.ok, false, 'Runtime method tampering must be detected by CrossPlatformSecurityGuard');
  assert.strictEqual(tamperedProtoStatus.status, 'PROTOTYPE_TAMPER_DETECTED', 'Tampered controller method must return PROTOTYPE_TAMPER_DETECTED');
  app.SubscriptionAndBillingEngine.isFeatureUnlocked = origIsFeatureUnlocked;
  assert.strictEqual(app.CrossPlatformSecurityGuard.verifyControllerPrototypeIntegrity().ok, true, 'Restored controller method must pass integrity check');

  // Verify HMAC-SHA256 tamper detection on persisted session/entitlement state
  app.CrossPlatformSecurityGuard.signPersistedRecord(
    'screensync_entitlement_token_v1',
    JSON.stringify({ userId: 'usr_sec_15', planId: 'FREE' })
  );
  const validRecordCheck = app.CrossPlatformSecurityGuard.verifyPersistedRecordIntegrity('screensync_entitlement_token_v1');
  assert.strictEqual(validRecordCheck.valid, true, 'Signed record must pass integrity verification');

  // Simulate manual tampering in DevTools / localStorage without updating HMAC
  sandbox.localStorage.setItem(
    'screensync_entitlement_token_v1',
    JSON.stringify({ userId: 'usr_sec_15', planId: 'PRO_LIFETIME', isPro: true })
  );
  const tamperedRecordCheck = app.CrossPlatformSecurityGuard.verifyPersistedRecordIntegrity('screensync_entitlement_token_v1');
  assert.strictEqual(tamperedRecordCheck.valid, false, 'Tampered record must be rejected');
  assert.strictEqual(tamperedRecordCheck.status, 'TAMPERED_LOCAL_STATE_REJECTED', 'Tampered record must return TAMPERED_LOCAL_STATE_REJECTED');

  // Verify server-signed entitlementJwt verification in SubscriptionAndBillingEngine
  const signedJwt = app.SubscriptionAndBillingEngine.issueServerSignedEntitlementToken({
    userId: 'usr_sec_15',
    installationId: 'inst_sec_15',
    planId: 'PRO_MONTHLY',
    expiresAtMs: Date.now() + 86400000
  });
  const jwtVerifyOk = app.SubscriptionAndBillingEngine.verifyServerSignedEntitlementToken(signedJwt, {
    userId: 'usr_sec_15',
    installationId: 'inst_sec_15',
    planId: 'PRO_MONTHLY'
  });
  assert.strictEqual(jwtVerifyOk.valid, true, 'Server-signed entitlementJwt must verify cleanly');

  const forgedJwtVerify = app.SubscriptionAndBillingEngine.verifyServerSignedEntitlementToken(
    signedJwt.slice(0, -4) + 'ffff',
    { userId: 'usr_sec_15', planId: 'PRO_MONTHLY' }
  );
  assert.strictEqual(forgedJwtVerify.valid, false, 'Forged entitlementJwt signature must be rejected');

  // Verify dev-safe release hardening script preserves readable src/ while generating dist/hardened/
  const { buildHardenedRelease } = require(path.join(rootDir, 'scripts/harden-release-bundle.js'));
  const hardenedManifest = buildHardenedRelease();
  assert(
    hardenedManifest &&
    hardenedManifest.sourceReadablePreserved === true &&
    fs.existsSync(path.join(rootDir, 'dist/hardened/index.html')) &&
    fs.existsSync(path.join(rootDir, 'dist/hardened/app.hardened.js')),
    'P15.1B Task 15.4: scripts/harden-release-bundle.js must output dist/hardened/ artifacts while keeping src/ readable'
  );

  // 4. Verify Tasks 15.5–15.8: iOS, macOS, Windows (Rust & C#), and Linux Native Hardening
  const iosSwift = fs.readFileSync(path.join(rootDir, 'ios/App/App/AppDelegate.swift'), 'utf8');
  assert(
    iosSwift.includes('IosSecurityIntegrityGuard') &&
    iosSwift.includes('PT_DENY_ATTACH') &&
    iosSwift.includes('P_TRACED') &&
    iosSwift.includes('_dyld_image_count') &&
    iosSwift.includes('DCAppAttestService') &&
    iosSwift.includes('GET_IOS_INTEGRITY_ATTESTATION'),
    'P15.1B Task 15.5: ios/App/App/AppDelegate.swift must implement IosSecurityIntegrityGuard'
  );

  const macEnt = fs.readFileSync(path.join(rootDir, 'platforms/macos/ScreenSyncMacCompanion.entitlements'), 'utf8');
  const macMain = fs.readFileSync(path.join(rootDir, 'platforms/macos/Sources/main.swift'), 'utf8');
  assert(
    macEnt.includes('com.apple.security.cs.allow-jit') &&
    macEnt.includes('com.apple.security.cs.allow-dyld-environment-variables') &&
    macMain.includes('DYLD_INSERT_LIBRARIES') &&
    macMain.includes('checkMacRuntimeIntegrity'),
    'P15.1B Task 15.6: macOS entitlements and main.swift must enforce Hardened Runtime and anti-DYLD checks'
  );

  const rustCargo = fs.readFileSync(path.join(rootDir, 'platforms/windows-companion/Cargo.toml'), 'utf8');
  const rustMain = fs.readFileSync(path.join(rootDir, 'platforms/windows-companion/src/main.rs'), 'utf8');
  const winCsproj = fs.readFileSync(path.join(rootDir, 'platforms/windows/ScreenSyncWindowsCompanion.csproj'), 'utf8');
  const winCs = fs.readFileSync(path.join(rootDir, 'platforms/windows/ScreenSyncWindowsCompanion.cs'), 'utf8');
  assert(
    rustCargo.includes('lto = "fat"') &&
    rustCargo.includes('strip = "symbols"') &&
    rustMain.includes('IsDebuggerPresent') &&
    winCsproj.includes('<DebugType>none</DebugType>') &&
    winCsproj.includes('<PublishSingleFile>true</PublishSingleFile>') &&
    winCs.includes('IsDebuggerPresent') &&
    winCs.includes('ComputeExecutableSelfSha256'),
    'P15.1B Task 15.7: Windows Rust and C# companions must enforce symbol stripping, anti-debug, and SHA-256 self-hash checks'
  );

  const linuxPy = fs.readFileSync(path.join(rootDir, 'platforms/linux/screensync_linux_companion.py'), 'utf8');
  assert(
    linuxPy.includes('TracerPid:') &&
    linuxPy.includes('LD_PRELOAD') &&
    linuxPy.includes('PYTHONINSPECT') &&
    linuxPy.includes('0o600') &&
    linuxPy.includes('verify_state_hmac_sha256'),
    'P15.1B Task 15.8: Linux companion must inspect TracerPid, LD_PRELOAD, PYTHONINSPECT, and 0o600 HMAC state'
  );

  // 5. Verify Section P15.2: Production Chrome/Edge/Firefox Manifest V3 Browser Extension
  const extObs = fs.readFileSync(path.join(rootDir, 'platforms/browser-extension/content_shortform_observer.js'), 'utf8');
  const extBridge = fs.readFileSync(path.join(rootDir, 'platforms/browser-extension/content_bridge.js'), 'utf8');
  const extBg = fs.readFileSync(path.join(rootDir, 'platforms/browser-extension/background_collector.js'), 'utf8');
  const extManifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'platforms/browser-extension/manifest.json'), 'utf8'));

  assert(
    extObs.includes('let lastScrollReportMs = 0;') &&
    extObs.includes('SHORT_FORM_DOM_SIGNAL') &&
    extObs.includes('SCROLL_SETTLE_MS = 300') &&
    extObs.includes('MIN_CONTINUOUS_DWELL_MS = 1200') &&
    extObs.includes('FAST_SKIP_MAX_MS = 2500') &&
    extObs.includes('LRU_MAX_SIGNATURES = 40'),
    'P15.2 EXT-01: content_shortform_observer.js must declare lastScrollReportMs, emit SHORT_FORM_DOM_SIGNAL, and enforce 300ms settle + 1200ms dwell + 2500ms fast-skip + 40-item LRU'
  );

  assert(
    extBridge.includes('screensync_ext_bridge_token') &&
    extBridge.includes('X-ScreenSync-Bridge-Token') &&
    extManifest.action &&
    extManifest.action.default_popup === 'popup.html' &&
    extManifest.options_page === 'options.html' &&
    extBg.includes('GET_POPUP_LIVE_SUMMARY'),
    'P15.2 EXT-02 & EXT-03: content_bridge.js, manifest.json, and background_collector.js must configure bridge token auth and popup dashboard'
  );

  const { packageExtension } = require(path.join(rootDir, 'scripts/package-browser-extension.js'));
  const pkgResult = packageExtension();
  assert(
    pkgResult &&
    pkgResult.ok === true &&
    fs.existsSync(path.join(rootDir, 'dist/screensync-chrome-extension-mv3.zip')) &&
    pkgResult.sizeBytes > 10000,
    'P15.2 EXT-03: scripts/package-browser-extension.js must package dist/screensync-chrome-extension-mv3.zip'
  );

  return { ok: true };
}

module.exports = { runPart15SecurityAndExtensionTests };
