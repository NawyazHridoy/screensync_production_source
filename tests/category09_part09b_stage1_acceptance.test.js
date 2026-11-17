'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');

function runStage1AndPart09BAcceptanceTests({ app, documentMock, windowMock } = {}) {
  const html = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'src', 'styles', 'main.css'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'app.js'), 'utf8');
  const java = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/io/screensync/wellness/MainActivity.java'), 'utf8');
  const swift = fs.readFileSync(path.join(ROOT, 'ios/App/App/AppDelegate.swift'), 'utf8');

  // Stage 1 UI-01 & UI-02: Auth forms vertically centered (not pushed to bottom by space-between)
  assert(
    css.includes('justify-content: flex-start !important;') &&
    css.includes('#authModal .ss-auth-shell > div[id^="authForm"]:not(.hidden)'),
    'Stage 1 UI-01/UI-02: Auth shell must align from top and center active auth form vertically'
  );

  // Stage 1 UI-05: Screen + sky-blue Sync wordmark
  assert(
    html.includes('Screen<span class="text-[#38BDF8]">Sync</span>'),
    'Stage 1 UI-05: ScreenSync login wordmark must render Sync in sky-blue (#38BDF8)'
  );

  // Stage 1 UI-08, UI-09, UI-10: Liquid Glass, Soft Glass & Normal global styles
  assert(
    html.includes('id="btnDesignStyleNormal"') &&
    html.includes('data-design-style-option="NORMAL"') &&
    css.includes('html[data-design-style="NORMAL"]:not([data-app-theme="LIGHT"]) .liquid-glass-card') &&
    css.includes('html[data-design-style="NORMAL"][data-app-theme="LIGHT"] .liquid-glass-card'),
    'Stage 1 UI-08..UI-10: NORMAL non-glass design style must be selectable and styled globally'
  );

  // Stage 1 UI-11: Dynamic Island clearance & Step 1 of 2 / Step 2 of 2 visibility
  assert(
    css.includes('max(var(--ss-safe-top-inset, 28px), 48px) + 12px') &&
    js.includes('stepBadge.textContent = "Step 1 of 2"') &&
    js.includes('stepBadge.textContent = "Step 2 of 2"'),
    'Stage 1 UI-11: Auth top bar must clear Dynamic Island and display Step 1 of 2 / Step 2 of 2'
  );

  // Stage 1 UI-12, UI-13, UI-14: Zero fake desktop status bar + genuine OS status bar on mobile
  assert(
    css.includes('html[data-os-category="Windows"] #statusBarDynamicFadeOverlay') &&
    swift.includes('override var prefersStatusBarHidden: Bool') &&
    java.includes('WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS'),
    'Stage 1 UI-12..UI-14: Desktop must hide status bar overlay while iOS/Android keep OS-managed status bar'
  );

  // Stage 1: Light-mode unboxed password requirements
  assert(
    css.includes('html[data-app-theme="LIGHT"] #signupPasswordRequirementsBox'),
    'Stage 1: Light mode #signupPasswordRequirementsBox must remain unboxed'
  );

  // Stage 2 (Part 09B): CAT09-001..CAT09-011 & C9-01..C9-16
  assert(html.includes('id="accountThemeStyleQuickSummary"'), 'Part 09B CAT09-002: #accountThemeStyleQuickSummary must exist');
  assert(!js.includes('btnCloseThemeStyleWindow'), 'Part 09B CAT09-011: Dead #btnCloseThemeStyleWindow listener must be removed');
  assert(js.includes('function applyAppTheme(') && js.includes('function applyGraphDisplayStyle('), 'Part 09B CAT09-006: applyAppTheme & applyGraphDisplayStyle globals must exist');
  assert(js.includes('data-pill-ty') && js.includes('--pill-ty'), 'Part 09B CAT09-009: animateLiquidGlassPill must set vertical --pill-ty metadata');
  assert(js.includes('delayNs: 0'), 'Part 09B CAT09-010: lastThemeTransition must report delayNs: 0');
  assert(js.includes('BackendDB.saveUserSettings((state.currentUser && state.currentUser.userId) || getActiveOrLocalUserId())'), 'Part 09B CAT09-003: Visual setters must persist for unauthenticated local_device_user');
  assert(java.includes('APPEARANCE_LIGHT_NAVIGATION_BARS') && java.includes('getSystemThemeMode()') && java.includes('screensync:system-theme-changed'), 'Part 09B CAT09-005 / C9-01: MainActivity.java must sync nav bar icons & system theme');

  if (app && app.DesignStyleController && app.GraphDisplayStyleController && app.ScreenSyncAdaptiveLogoRegistry) {
    // Test Liquid / Soft / Normal transitions
    const resNorm = app.applyDesignStyle('NORMAL', { skipRender: true });
    assert(resNorm.ok && resNorm.designStyle === 'NORMAL' && resNorm.label === 'Normal', 'DesignStyleController must accept NORMAL');
    assert(documentMock.documentElement.getAttribute('data-design-style') === 'NORMAL', '<html> data-design-style must be NORMAL');
    app.applyDesignStyle('LIQUID', { skipRender: true });

    // Test applyAppTheme & applyGraphDisplayStyle globals + state.graphStyle alias
    const resTheme = app.applyAppTheme('LIGHT', { skipRender: true, skipTransition: true });
    assert(resTheme.ok && resTheme.resolvedTheme === 'LIGHT', 'applyAppTheme("LIGHT") must resolve LIGHT');
    const resGraph = app.applyGraphDisplayStyle('BAR', { skipRender: true });
    assert(resGraph.ok && app.state.graphStyle === 'SIMPLE' && app.state.graphDisplayStyle === 'SIMPLE', 'applyGraphDisplayStyle("BAR") must update state.graphStyle & state.graphDisplayStyle');

    // Test ScreenSyncAdaptiveLogoRegistry.mountLogo public API
    const mountRes = app.ScreenSyncAdaptiveLogoRegistry.mountLogo('bottomNavOverview', 'HOME', { srLabel: 'Overview' });
    assert(mountRes && mountRes.ok && mountRes.scopeId === 'bottomNavOverview', 'ScreenSyncAdaptiveLogoRegistry.mountLogo must work publicly');

    // Test meta theme-color sync
    assert(js.includes("\"LIQUID-LIGHT\": \"#EAF2FB\"") && js.includes("\"NORMAL-DARK\": \"#0B0C0E\""), "meta theme-color map must cover all 6 combinations");

    // Restore defaults
    app.applyAppTheme('DARK', { skipRender: true, skipTransition: true });
    app.applyGraphDisplayStyle('DETAILED', { skipRender: true });
  }
}

if (require.main === module) {
  runStage1AndPart09BAcceptanceTests({});
  console.log('[PASS] Category 09 Stage 1 + Part 09B static acceptance checks passed.');
}

module.exports = { runStage1AndPart09BAcceptanceTests };
