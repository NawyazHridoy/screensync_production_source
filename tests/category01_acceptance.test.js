#!/usr/bin/env node
/**
 * ScreenSync — Category 01 Acceptance & Behavioral Verification Suite (Part 01A + Part 01B + User Toast Sanitization Fix)
 * Covers ISS-C01-01..ISS-C01-16, C1-01..C1-17, DF-01B-01..DF-01B-08 across:
 *   1. Zero-FOUC Theme Bootstrap (#ssEarlyThemeInit, data-theme-mode, data-pill-visual-mode, v1+v2 storage keys, meta theme-color)
 *   2. Splash Motion Studio Engine & Interactive Controller (smooth fade-out, circular loader hidden, 0.00 initial progress, halo intensity 0..100, Light/Dark stage gradient & particle palette, DOM layer parity)
 *   3. Splash Studio Persistence & Lifecycle (dual-key localStorage, BackendDB per-user settingsByUser[uid], direct switchView("SPLASH_STUDIO") hydration, _previewRafId cleanup, history unwind)
 *   4. RuntimeConfigLoader & SupabaseClientManager (all config keys preserved, frozen window.__SCREENSYNC_RUNTIME_CONFIG__, capacitor:/ionic: protocols, config parity verification, SupabaseClientManager.init() & resetClient())
 *   5. PWA Manifest, Binary PNG Icons, Service Worker & Shortcut Routing (separate any/maskable icons, PNG magic bytes, SW timeout/fallback/eviction/loopback exclusions, ?view= + #hash shortcuts, PwaInstallController)
 *   6. Copy-Protection Hardening, AppStoreUpdateManager Gate, WebPreviewBanner Handshake & Boot Error Isolation
 *   7. Part 01B Extended Code Patches (_renderFrame, studio secondary/eclipse glow, sampleParticlesFromLogo onload retry, milestones history, standalone PWA banner guard, #appUpdateNoticeOverlay DOM placement)
 *   8. User-Facing Toast & Notification Technical Error Sanitization (DF-01B-01 / image_1ef87f.png Local-Only Purge & schema cache suppression)
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const assert = require("assert");

const ROOT_DIR = path.resolve(__dirname, "..");

function sha256Buffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function runCategory01AcceptanceSuite(options) {
  const opts = options || {};
  const results = [];
  function check(id, description, fn) {
    try {
      fn();
      results.push({ id, description, passed: true });
    } catch (err) {
      results.push({
        id,
        description,
        passed: false,
        error: err && err.message ? err.message : String(err)
      });
      if (!opts.collectOnly) {
        throw new Error(`[Category01 Acceptance FAIL] ${id} (${description}): ${err && err.message ? err.message : String(err)}`);
      }
    }
  }

  const indexHtmlPath = path.join(ROOT_DIR, "src", "index.html");
  const mainCssPath = path.join(ROOT_DIR, "src", "styles", "main.css");
  const appJsPath = path.join(ROOT_DIR, "src", "js", "app.js");
  const swPath = path.join(ROOT_DIR, "src", "sw.js");
  const manifestPath = path.join(ROOT_DIR, "src", "manifest.webmanifest");
  const rootConfigPath = path.join(ROOT_DIR, "config", "screensync.config.json");
  const srcConfigPath = path.join(ROOT_DIR, "src", "config", "screensync.config.json");
  const syncScriptPath = path.join(ROOT_DIR, "scripts", "sync-web-assets.js");
  const bridgePath = path.join(ROOT_DIR, "platforms", "browser-extension", "content_bridge.js");

  const indexHtml = fs.readFileSync(indexHtmlPath, "utf8");
  const mainCss = fs.readFileSync(mainCssPath, "utf8");
  const appJs = fs.readFileSync(appJsPath, "utf8");
  const swSrc = fs.readFileSync(swPath, "utf8");
  const manifestRaw = fs.readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw);
  const rootConfigRaw = fs.readFileSync(rootConfigPath, "utf8");
  const srcConfigRaw = fs.readFileSync(srcConfigPath, "utf8");
  const rootConfig = JSON.parse(rootConfigRaw);
  const srcConfig = JSON.parse(srcConfigRaw);
  const syncScript = fs.readFileSync(syncScriptPath, "utf8");
  const bridgeSrc = fs.readFileSync(bridgePath, "utf8");

  // 1. ISS-C01-01 / C1-10: Zero-FOUC Theme Bootstrap & Media Query Parity
  check("ISS-C01-01", "Early theme bootstrap sets data-theme-mode, data-pill-visual-mode, v1+v2 storage keys, CSS vars, and meta theme-color", () => {
    assert(indexHtml.includes('data-theme-mode="DARK"'), "<html> must default to data-theme-mode=\"DARK\"");
    assert(indexHtml.includes('data-pill-visual-mode="LIQUID-DARK"'), "<html> must default to data-pill-visual-mode=\"LIQUID-DARK\"");
    assert(indexHtml.includes('id="ssEarlyThemeInit"'), "#ssEarlyThemeInit inline script must exist in <head>");
    assert(indexHtml.includes("screensync_app_theme_pref_v2") && indexHtml.includes("screensync_theme_preference_v1"), "#ssEarlyThemeInit must check both v2 and v1 theme keys");
    assert(indexHtml.includes("screensync_design_style_pref_v2") && indexHtml.includes("screensync_design_style_v1"), "#ssEarlyThemeInit must check both v2 and v1 design style keys");
    assert(indexHtml.includes('root.setAttribute("data-theme-mode"') && indexHtml.includes('root.setAttribute("data-pill-visual-mode"'), "#ssEarlyThemeInit must set data-theme-mode and data-pill-visual-mode attributes");
    assert(indexHtml.includes('root.style.setProperty("--ss-bg-base"') && indexHtml.includes('root.style.setProperty("--ss-card-bg"'), "#ssEarlyThemeInit must prime --ss-bg-base and --ss-card-bg on root.style");
    assert(indexHtml.includes('#F8FAFC') && indexHtml.includes('#030816'), "#ssEarlyThemeInit must sync <meta name=\"theme-color\"> for Light (#F8FAFC) and Dark (#030816)");
    assert(appJs.includes('matchMedia("(prefers-color-scheme: light)")'), "getPersistedAppThemeFallback must honor OS light mode media query when no theme key is saved");
  });

  // 2. ISS-C01-02 / C1-05 / C1-13 / C1-16: Splash Overlay Transition, Circular Loader, Progress 0.00, Duration & Resize
  check("ISS-C01-02", "#splashOverlay preserves smooth 0.42s transition while keeping circular loader hidden and rAF initial progress at 0", () => {
    const zeroDurIdx = mainCss.indexOf("transition-duration: 0ns !important;");
    assert(zeroDurIdx !== -1, "main.css must retain transition-duration: 0ns !important block for acceptance compatibility");
    const blockStart = mainCss.lastIndexOf("#splashOverlay", zeroDurIdx);
    const sepIdx = mainCss.indexOf(".liquid-view-transition", blockStart);
    assert(sepIdx !== -1 && sepIdx < zeroDurIdx, "#splashOverlay must be in its own rule block without transition-duration: 0ns !important");
    assert(appJs.includes('loaderSvg.classList.add("hidden")') && !appJs.includes('loaderSvg.classList.remove("hidden")'), "SplashInteractiveController.startParticleCanvas must keep #splashCircularLoader hidden");
    assert(appJs.includes('const initP = typeof requestAnimationFrame === "function" ? 0 : 0.35;'), "ScreenSyncSplashMotionEngine must start at p=0 when requestAnimationFrame is available");
    assert(appJs.includes("const SPLASH_LAUNCH_DURATION_MS = 1850;"), "SPLASH_LAUNCH_DURATION_MS must be wired to 1850ms");
    assert(appJs.includes("splashMinVisibleMs") && appJs.includes("splashMaxVisibleMs"), "Splash lifecycle must honor splashMinVisibleMs and splashMaxVisibleMs");
    assert(appJs.includes("orientationchange") && appJs.includes("_resizeHandler"), "SplashInteractiveController must dynamically resize #splashParticleCanvas on resize/orientationchange");
  });

  // 3. ISS-C01-03 / C1-14: Dual-Key LocalStorage & Per-User BackendDB Splash Persistence
  check("ISS-C01-03", "Splash preset & halo intensity persist across v1+v2 localStorage keys and BackendDB.data.settingsByUser[uid]", () => {
    assert(appJs.includes('PRESET_STORAGE_KEY_V2: "screensync_splash_preset_v2"'), "PRESET_STORAGE_KEY_V2 must be defined");
    assert(appJs.includes('HALO_STORAGE_KEY_V2: "screensync_splash_halo_v2"'), "HALO_STORAGE_KEY_V2 must be defined");
    assert(appJs.includes("BackendDB.data.settingsByUser[uid].splashPreset = this.activePreset;") && appJs.includes("BackendDB.data.settingsByUser[uid].splashPresetId = this.activePreset;"), "savePreferences must persist splashPreset & splashPresetId to BackendDB.data.settingsByUser[uid]");
    assert(appJs.includes("BackendDB.data.settingsByUser[uid].splashHaloIntensityPct = this.haloIntensityPct;") && appJs.includes("BackendDB.data.settingsByUser[uid].splashHaloPct = this.haloIntensityPct;"), "savePreferences must persist splashHaloIntensityPct and splashHaloPct to BackendDB.data.settingsByUser[uid]");
  });

  // 4. ISS-C01-05 / C1-08 / C1-09: RuntimeConfigLoader & SupabaseClientManager
  check("ISS-C01-05", "RuntimeConfigLoader preserves all canonical keys, freezes __SCREENSYNC_RUNTIME_CONFIG__, supports capacitor:/ionic:, and initializes SupabaseClientManager", () => {
    assert.strictEqual(
      JSON.stringify(rootConfig),
      JSON.stringify(srcConfig),
      "config/screensync.config.json and src/config/screensync.config.json must be identical"
    );
    const requiredKeys = [
      "companionPollIntervalMs",
      "reelMinDwellMs",
      "scrollSettleDebounceMs",
      "idleThresholdSeconds",
      "soundHarmfulDbThreshold",
      "toastDefaultDurationMs",
      "splashMinVisibleMs",
      "splashMaxVisibleMs",
      "localSyncServerFallbackUrl",
      "desktopCompanionFallbackUrl",
      "supportedShortFormPackages",
      "featureFlags"
    ];
    for (const k of requiredKeys) {
      const inConfig = (k in rootConfig) || Boolean(rootConfig.sync && (k in rootConfig.sync));
      assert(inConfig, `config/screensync.config.json missing required key: ${k}`);
      assert(appJs.includes(k), `app.js RuntimeConfigLoader missing key: ${k}`);
    }
    assert.strictEqual(rootConfig.featureFlags.storeReleaseGateEnabled, false, "storeReleaseGateEnabled must default to false");
    assert.strictEqual(rootConfig.featureFlags.webPreviewBannerEnabled, true, "webPreviewBannerEnabled must default to true");
    assert(appJs.includes("window.__SCREENSYNC_RUNTIME_CONFIG__ = snapshot;"), "RuntimeConfigLoader must freeze and assign window.__SCREENSYNC_RUNTIME_CONFIG__");
    assert(appJs.includes('"capacitor:"') && appJs.includes('"ionic:"'), "loadExternalConfigJsonAsync must permit capacitor: and ionic: protocols");
    assert(appJs.includes("const SupabaseClientManager =") && appJs.includes("SupabaseClientManager.init(") && appJs.includes("resetClient()"), "SupabaseClientManager.init() and resetClient() must be defined and wired");
    assert(syncScript.includes("verifyCanonicalConfigParity"), "scripts/sync-web-assets.js must verify canonical config parity");
  });

  // 5. ISS-C01-06 / ISS-C01-07 / ISS-C01-08 / ISS-C01-09: Splash Studio DOM Layer Parity, Lifecycle & Theme Adaptation
  check("ISS-C01-06_09", "Splash Studio DOM layers, Account summary badge, direct switchView hydration, 0..100 halo clamping, and Light/Dark stage adaptation", () => {
    for (const id of [
      "accountSplashCurrentSummary",
      "eclipseGlowRing",
      "plateBack2",
      "plateBack1",
      "sheenLayer",
      "splashProgressTrack",
      "splashBar",
      "studioPreviewGlowSecondary",
      "studioPreviewEclipseGlowRing",
      "labelSplashHaloIntensityVal"
    ]) {
      assert(indexHtml.includes(`id="${id}"`), `index.html missing required Splash DOM node #${id}`);
    }
    assert(indexHtml.includes('id="sliderSplashHaloIntensity"') && indexHtml.includes('max="100"'), "#sliderSplashHaloIntensity max attribute must be 100");
    assert(appJs.includes("this.clamp(Math.round(haloPct), 0, 100)"), "savePreferences must clamp haloPct to 0..100");
    assert(appJs.includes("get haloIntensity()") && appJs.includes("set haloIntensity(v)") && appJs.includes("_renderFrame("), "ScreenSyncSplashMotionEngine.state.haloIntensity and _renderFrame() must be defined");
    assert(appJs.includes('viewName === "SPLASH_STUDIO"') && appJs.includes("ScreenSyncSplashMotionEngine.renderPresetGridUI()"), "switchView('SPLASH_STUDIO') must hydrate Splash Studio directly");
    assert(appJs.includes('NavigationHistoryBridge.onOverlayClosed("SPLASH_STUDIO", options)'), "Closing SPLASH_STUDIO must notify NavigationHistoryBridge");
    assert(
      mainCss.includes('html[data-app-theme="LIGHT"] #splashOverlay') &&
      mainCss.includes('html[data-app-theme="LIGHT"] #viewSplashAnimationStudio #splashStudioPreviewStage'),
      "main.css must provide Light Mode radial stage backgrounds for #splashOverlay and #splashStudioPreviewStage"
    );
  });

  // 6. ISS-C01-10 / ISS-C01-11 / C1-03 / C1-11 / C1-15: Manifest, Real PNG Icons, Service Worker & Shortcut Routing
  check("ISS-C01-10_11", "Manifest separates any/maskable PNG icons, all 5 PNG icons have valid PNG magic bytes across 5 directories, SW enforces timeouts/caps/exclusions, and shortcuts support ?view= + #hash", () => {
    const iconFiles = ["icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon-180.png", "favicon-32.png"];
    const targetDirs = [
      path.join(ROOT_DIR, "src", "icons"),
      path.join(ROOT_DIR, "icons"),
      path.join(ROOT_DIR, "www", "icons"),
      path.join(ROOT_DIR, "android", "app", "src", "main", "assets", "public", "icons"),
      path.join(ROOT_DIR, "ios", "App", "App", "public", "icons")
    ];
    for (const iconName of iconFiles) {
      const srcBuf = fs.readFileSync(path.join(ROOT_DIR, "src", "icons", iconName));
      assert(srcBuf.length > 100, `src/icons/${iconName} must be non-empty`);
      assert.strictEqual(srcBuf.slice(0, 8).toString("hex"), "89504e470d0a1a0a", `src/icons/${iconName} must have valid PNG magic header`);
      const srcHash = sha256Buffer(srcBuf);
      for (const dir of targetDirs) {
        const targetBuf = fs.readFileSync(path.join(dir, iconName));
        assert.strictEqual(sha256Buffer(targetBuf), srcHash, `PNG parity mismatch for ${iconName} in ${dir}`);
      }
    }
    const anyIcons = (manifest.icons || []).filter((i) => i.purpose === "any");
    const maskableIcons = (manifest.icons || []).filter((i) => i.purpose === "maskable");
    assert(anyIcons.length >= 2 && maskableIcons.length >= 1, "manifest.webmanifest must declare separate purpose='any' and purpose='maskable' icons");
    assert(!(manifest.icons || []).some((i) => String(i.purpose || "").includes("any maskable")), "manifest.webmanifest must not combine 'any maskable' on a single entry");

    for (const sc of manifest.shortcuts || []) {
      assert(sc.url.includes("?view=") && sc.url.includes("#"), `Shortcut ${sc.name} must include both ?view= and #hash`);
    }
    assert(appJs.includes("rawSearch.match(/[?&]view=([^&#]+)/i)") && appJs.includes("applyManifestShortcutHash") && appJs.includes("applyManifestShortcutRoute"), "applyManifestShortcutHash and applyManifestShortcutRoute must support both ?view= query parameter and #hash routing");

    assert(swSrc.includes("NAV_NETWORK_TIMEOUT_MS = 3000") && swSrc.includes("ASSET_NETWORK_TIMEOUT_MS = 1200"), "sw.js must enforce 3000ms navigation and 1200ms asset timeouts");
    assert(swSrc.includes("MAX_RUNTIME_CACHE_ENTRIES = 60") && swSrc.includes("trimRuntimeCache"), "sw.js must bound runtime cache to 60 entries via trimRuntimeCache");
    assert(swSrc.includes("if (networkResp && networkResp.ok)") && swSrc.includes("idxResp || networkResp"), "sw.js must fall back to cached shell on HTTP 5xx/404 responses");
    assert(swSrc.includes("oem_profiles.json") && swSrc.includes("accessibility_supported_apps.json") && swSrc.includes("SCREENSYNC_PRECACHE_INCOMPLETE"), "sw.js must pre-cache all 3 config JSON files and report SCREENSYNC_PRECACHE_INCOMPLETE");
    assert(swSrc.includes("17935") && swSrc.includes("8788") && swSrc.includes("[::1]"), "sw.js must exclude companion loopback ports 17935, 8788, and IPv6 [::1]");
  });

  // 7. ISS-C01-12 / ISS-C01-13 / ISS-C01-14 / ISS-C01-15: Copy Protection, Store Update Gate, WebPreviewBanner & Boot Isolation
  check("ISS-C01-12_15", "Copy protection handles Text nodes & [data-selectable], AppStoreUpdateManager gates on storeReleaseGateEnabled, WebPreviewBanner handshakes with extension, and boot isolates stage errors", () => {
    assert(mainCss.includes('#appMainContainer input') && mainCss.includes('[data-selectable="true"]'), "main.css must allow selection inside #appMainContainer inputs and [data-selectable=\"true\"]");
    assert(appJs.includes("targetNode.nodeType === 3 ? targetNode.parentElement : targetNode") && appJs.includes("window.getSelection") && appJs.includes("sel.anchorNode"), "enforceGlobalUiCopyProtection must resolve Text nodes and fall back to window.getSelection().anchorNode");
    assert(appJs.includes("this.storeReleaseGateEnabled === true") && appJs.includes("io.screensync.wellness") && appJs.includes("_compareSemver("), "AppStoreUpdateManager must check storeReleaseGateEnabled, use io.screensync.wellness package ID, and compare semver");
    assert(appJs.includes("isTrustedExtensionMessage") && appJs.includes("PING_EXTENSION") && appJs.includes("EXTENSION_PRESENCE") && appJs.includes("_isStandalonePwaContext"), "WebPreviewBannerController must validate extension message origin, perform PING_EXTENSION / EXTENSION_PRESENCE handshake, and suppress in standalone PWA mode");
    assert(bridgeSrc.includes("PING_EXTENSION") && bridgeSrc.includes("EXTENSION_PRESENCE"), "platforms/browser-extension/content_bridge.js must respond to PING_EXTENSION with EXTENSION_PRESENCE");
    assert(appJs.includes("const runBootStep = (stepName, fn) =>") && appJs.includes("window.__ssBootErrors"), "DOMContentLoaded boot pipeline must isolate steps via runBootStep and record __ssBootErrors");
    assert(appJs.includes("screensync_corrupt_db_backup_latest"), "BackendDB.load must preserve corrupt payload in screensync_corrupt_db_backup_latest before recovery");
    assert(indexHtml.indexOf('id="appUpdateNoticeOverlay"') < indexHtml.indexOf("const APP_VERSION"), "#appUpdateNoticeOverlay must be placed in <body> before <script>");
  });

  // 8. DF-01B-01 (User Screenshot Fix — image_1ef87f.png): User-Facing Toast & Notification Technical Error Sanitization
  check("DF-01B-01_TOAST_SANITIZATION", "ToastManager.sanitizeUserFacingMessage and BackendDB.purgeDataOlderThan never expose raw technical RPC/schema-cache error strings to users", () => {
    assert(appJs.includes("sanitizeUserFacingMessage(rawMessage, rawTitle"), "ToastManager.sanitizeUserFacingMessage must exist");
    assert(!appJs.includes('showToast("Local-Only Purge", `Local history pruned, but cloud purge failed: ${errMsg}`)'), "BackendDB.purgeDataOlderThan must never pass raw ${errMsg} to showToast");
    assert(appJs.includes("tryDirectTableCloudPruneFallback"), "BackendDB.purgeDataOlderThan must include direct-table delete fallback when RPC function is missing from schema cache");
    assert(appJs.includes("const PwaInstallController ="), "PwaInstallController must be implemented for PWA install lifecycle");
  });

  return results;
}

if (require.main === module) {
  const results = runCategory01AcceptanceSuite({ collectOnly: false });
  console.log(`[PASS] Category 01 Acceptance Suite (Part 01A + Part 01B + Toast Fix): ${results.length}/${results.length} checks passed.`);
}

module.exports = { runCategory01AcceptanceSuite };
