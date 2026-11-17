'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'src', 'styles', 'main.css'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'app.js'), 'utf8');
const java = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/io/screensync/wellness/MainActivity.java'), 'utf8');
const swift = fs.readFileSync(path.join(ROOT, 'ios/App/App/AppDelegate.swift'), 'utf8');

function runPart09AAcceptanceTests() {
  // S9.0: Full-Screen Box-Free Auth Redesign, Single-Row Header & unslop Humanization
  assert(css.includes('--ss-auth-bg: #0B0C0E') && css.includes('--ss-auth-bg: #F7F6F2'), 'S9.0: Light/Dark auth surface tokens must be defined');
  assert(css.includes('.ss-auth-nav-icon-btn'), 'S9.0: .ss-auth-nav-icon-btn must be styled');
  assert(html.includes('id="authSignupStepBadge"') && html.includes('id="btnBackFromSignupToLogin"'), 'S9.0: Unified authTopHeaderBar must house back buttons and step badge');
  assert(html.includes('>Screen<span class="text-[#38BDF8]">Sync</span></span>') || html.includes('>ScreenSync</span>'), 'S9.0 / Stage 1 UI-05: Unified ScreenSync wordmark must be present');
  assert(!html.includes('bg-[#0B1832]/80 border border-white/10'), 'S9.0: Boxed navy password requirements container must be removed');
  assert(js.includes('setHidden(btnBackSignup, tabName !== "SIGNUP")'), 'S9.0: switchAuthTabUI must toggle header back buttons');

  // S9.1 & CAT09-18: Dynamic Status Bar Fade & iOS/Android syncSystemBarTheme
  assert(html.includes('id="statusBarDynamicFadeOverlay"'), 'S9.1: #statusBarDynamicFadeOverlay must be mounted in body');
  assert(css.includes('#statusBarDynamicFadeOverlay.ss-statusbar-fade-layer') && css.includes('pointer-events: none !important'), 'S9.1: Status bar overlay must be non-interactive');
  assert(swift.includes('syncSystemBarTheme') && swift.includes('setNeedsStatusBarAppearanceUpdate'), 'S9.1 / CAT09-18: iOS AppDelegate.swift must implement syncSystemBarTheme');

  // S9.2: Dynamic Device Font & fontScale Adaptation
  assert(css.includes('--ss-device-font-family: system-ui'), 'S9.2: CSS must define --ss-device-font-family');
  assert(!html.includes('fonts.googleapis.com/css2?family=Inter'), 'S9.2: External Google Fonts Inter link must be removed');
  assert(!css.includes("font-family: 'Inter'"), 'S9.2: Hardcoded Inter font-family must be removed from main.css');
  assert(java.includes('screensync:device-font-changed') && java.includes('setTextZoom'), 'S9.2: MainActivity.java must sync fontScale and dispatch device-font-changed event');

  // S9.3: Humanized Palette (No neon blue gradient on .ss-btn-primary)
  assert(!css.includes('#1D6FF2'), 'S9.3: Neon blue #1D6FF2 gradient must be removed from main.css');
  assert(css.includes('linear-gradient(135deg, #059669 0%, #10B981 100%)'), 'S9.3: Humanized emerald/sage gradient must be applied to .ss-btn-primary');

  // S9.4: Hide Technical Export / JSON / SHA-256 Controls from Visible Account UI
  assert(html.includes('id="legacyTechnicalExportControlsHiddenHost"'), 'S9.4: Technical export/backup controls must be inside hidden compatibility host');
  assert(html.includes('>Usage History</div>') && html.includes('Keeps last 90 days • Synced automatically'), 'S9.4: Usage History row title and human-friendly summary must be present');
  assert(css.includes('#legacyTechnicalExportControlsHiddenHost'), 'S9.4: CSS must enforce display:none on hidden export host');

  // CAT09-03, CAT09-09, CAT09-12, CAT09-14, CAT09-16, CAT09-17, CAT09-19
  assert(css.includes('transition-duration: 0ns !important'), 'CAT09-03 / Cat 01 Compat: 0ns block retained for Category 01 acceptance compatibility');
  assert(!css.includes('--ss-unified-icon-size: 22px'), 'CAT09-14: Dead 22px icon size rule must be removed');
  assert(js.includes('this._lastAppliedSignature !== sig'), 'CAT09-09: IconVisualController.applyToDocument must dirty-check before remounting');
  assert(!js.includes('accSection.contains(themeWinEl)'), 'CAT09-12: Dead accSection.contains(themeWinEl) block must be removed');
  assert(js.includes('translateY(${clampedIdx * 100}%)'), 'CAT09-16: animateLiquidGlassPill must support vertical orientation');
  assert(js.includes('data-custom-mode'), 'CAT09-17: IconVisualController.syncUI must handle CUSTOM mode honestly');
  assert(js.includes('el.textContent = "—"'), 'CAT09-19: syncPreviewCardsWithLiveMetrics must show honest unavailable fallback');

  console.log('[PASS] Category 09 Part 09A (S9.0-S9.4 & CAT09-03/09/12/14/16/17/18/19) Acceptance Suite verified 100%.');
}

if (require.main === module) {
  runPart09AAcceptanceTests();
}

module.exports = { runPart09AAcceptanceTests };
