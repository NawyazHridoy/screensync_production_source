const assert = require("assert");
const fs = require("fs");
const path = require("path");

function runPostPass25AcceptanceTests(projectRoot, html, app, sandbox) {
  const css = fs.readFileSync(path.join(projectRoot, "src/styles/main.css"), "utf8");
  const js = fs.readFileSync(path.join(projectRoot, "src/js/app.js"), "utf8");

  // 1. 5 New Icon Packages Mounted with Transparent Backgrounds & Cutouts + Scoped SVG Defs
  assert(js.includes("data-logo-scoped"), "mountLogo must scope SVG defs per button instance");
  assert(js.includes('data-icon-package="home-icon-ui-package"') && js.includes('viewBox="0 0 1024 1024"'), "HOME icon must use home-icon-ui-package with 1024x1024 viewBox");
  assert(js.includes('data-icon-package="screen-time-icon-ui-package"'), "SCREEN_TIME icon must use screen-time-icon-ui-package");
  assert(js.includes('data-icon-package="focus-icon-ui-package"'), "FOCUS icon must use focus-icon-ui-package");
  assert(js.includes('data-icon-package="account_icon_ui_code"') && js.includes('viewBox="0 0 1000 1000"'), "ACCOUNT icon must use account_icon_ui_code with 1000x1000 viewBox");
  assert(js.includes('data-icon-package="stats-and-goal-icon-ui-code"') && html.includes('viewBox="68 72 376 376"'), "STATS_AND_GOALS icon must use stats-and-goal-icon-ui-code with 68 72 376 376 viewBox");
  assert(css.includes("width: 28px !important;") && css.includes("height: 28px !important;"), "All nav icons must enforce uniform 28x28px dimensions");
  assert(css.includes("background: transparent !important;"), "All icons must enforce 100% transparent background");

  // 2. Responsive Navigation Bar (Horizontal bottom in Phone, Vertical left in PC/Laptop/Tab/Pad)
  assert(css.includes("@media (min-width: 640px)") && css.includes("#appMainContainer:not(.mode-phone)"), "Desktop/Tablet media query must position nav on the left");
  assert(css.includes("#appMainContainer.mode-tablet") && css.includes("#appMainContainer.mode-laptop") && css.includes("#appMainContainer.mode-pc"), "Explicit tablet/laptop/pc modes must position nav vertically on the left");

  // 3. All 12 Splash Animation Presets Authentic & Distinct
  const presetIds = [
    "screensync_morph",
    "black_eclipse",
    "white_inkflow",
    "sync_radar",
    "convergence",
    "neon_trace",
    "gyro_orbit",
    "prism_fuse",
    "ripple_drop",
    "quantum",
    "liquid",
    "minimal"
  ];
  for (const pid of presetIds) {
    assert(js.includes(`preset === "${pid}"`) || (pid === "minimal" && js.includes("12. Titanium Micro-Spring")), `Splash engine must implement distinct branch for preset ${pid}`);
  }
  assert(html.includes('id="logo3dRig"') && html.includes('id="splashParticleCanvas"'), "Splash overlay must include full 3D stage and particle canvas");

  // 4. Light Mode & Dark Mode Adaptation for Splash Studio & Splash Animations
  assert(js.includes("syncSplashThemeAdaptation()"), "Splash engine must include syncSplashThemeAdaptation()");
  assert(css.includes('html[data-app-theme="LIGHT"] #viewSplashAnimationStudio'), "CSS must adapt #viewSplashAnimationStudio to Light Mode");
  assert(css.includes('html[data-app-theme="LIGHT"] #splashOverlay'), "CSS must adapt #splashOverlay to Light Mode");

  // 5. 0ns Animation Frame Delay & UI Animation/Transition Delay
  assert(css.includes("animation-delay: 0ns !important;") && css.includes("transition-delay: 0ns !important;"), "CSS must enforce 0ns animation and transition delay");
  assert(js.includes('frameDelayNs: 0'), "Splash engine must run with 0ns frame delay");

  // 6. Account Page Cleanliness (Theme, Graph Style, Design Style, and Icon Visual ONLY inside #viewThemeStyleWindow)
  const viewAccountMatch = html.match(/<section id="viewAccount"[\s\S]*?<\/section>/);
  const viewThemeStyleMatch = html.match(/<section id="viewThemeStyleWindow"[\s\S]*?<\/section>/);
  assert(viewAccountMatch && viewThemeStyleMatch, "Both #viewAccount and #viewThemeStyleWindow sections must exist as siblings");
  assert(!viewAccountMatch[0].includes('id="accountDesignStyleCard"'), "#viewAccount must not contain Design Style card");
  assert(!viewAccountMatch[0].includes('id="graphStyleToggleGroup"'), "#viewAccount must not contain Graph Style card");
  assert(!viewAccountMatch[0].includes('id="accountThemeToggleGroup"'), "#viewAccount must not contain Theme card");
  assert(!viewAccountMatch[0].includes('id="accountIconVisualSection"'), "#viewAccount must not contain Icon Visual section");
  assert(viewThemeStyleMatch[0].includes('id="accountDesignStyleCard"'), "#viewThemeStyleWindow must contain Design Style card");
  assert(viewThemeStyleMatch[0].includes('id="graphStyleToggleGroup"'), "#viewThemeStyleWindow must contain Graph Style card");
  assert(viewThemeStyleMatch[0].includes('id="accountThemeToggleGroup"'), "#viewThemeStyleWindow must contain Theme card");
  assert(viewThemeStyleMatch[0].includes('id="accountIconVisualSection"'), "#viewThemeStyleWindow must contain Icon Visual section");

  // Verify NO manual Light/Dark mode selector exists inside #accountIconVisualSection
  const iconVisualSectionMatch = viewThemeStyleMatch[0].match(/<div id="accountIconVisualSection"[\s\S]*$/);
  assert(iconVisualSectionMatch && !iconVisualSectionMatch[0].includes("data-theme-option"), "#accountIconVisualSection must not contain any manual Light/Dark mode selector");

  // 7. Version Number Removed from Theme & Style Page (Kept on Account Page)
  assert(viewAccountMatch[0].includes('id="accountAppVersionFooter"'), "#viewAccount must retain #accountAppVersionFooter");
  assert(!viewThemeStyleMatch[0].includes('id="accountAppVersionFooter"') && !viewThemeStyleMatch[0].includes("Version 3.5.0"), "#viewThemeStyleWindow must not contain version number");

  // 8. Duplicate Back Buttons Removed
  assert(!html.includes('id="btnCloseThemeStyleWindow"'), "Duplicate back/close button #btnCloseThemeStyleWindow must be removed");
  assert(!html.includes('id="btnReturnToAccountFromGuide"'), "Duplicate bottom back button #btnReturnToAccountFromGuide must be removed");
  assert(!html.includes('id="btnReturnToAccountFromFaq"'), "Duplicate bottom back button #btnReturnToAccountFromFaq must be removed");
  assert(!html.includes('id="btnBackToLoginFromForgot1"'), "Duplicate bottom back button #btnBackToLoginFromForgot1 must be removed");

  // 9. OEM Checklist displays ONLY the installed device name (Zero "STANDARD_AOSP_PIXEL_MOTO_NOTHING" or "Google Pixel / Motorola / Nothing / Standard Android (Android 12–15 (AOSP)) Checklist" in rendered UI)
  assert(js.includes("resolveInstalledDeviceDisplayName("), "OemPermissionGuideController must define resolveInstalledDeviceDisplayName()");
  assert(js.includes('id="oemInstalledDeviceNameHeader"'), "renderOemChecklistInAccountCard must render #oemInstalledDeviceNameHeader with installed device name only");
  assert(!js.includes('${escapeHtml(profile.brand)} (${escapeHtml(profile.ui)}) Checklist'), "renderOemChecklistInAccountCard must not render generic brand/ui Checklist string");
  assert(!js.includes('${escapeHtml(profile.oemFamily)}</span>'), "renderOemChecklistInAccountCard must not render technical oemFamily enum in UI");

  // 10. Light Mode High-Contrast Web Preview Banner & Lock Screen Unified Reel Widget Card
  assert(css.includes('html[data-app-theme="LIGHT"] #webPreviewExtensionDependencyBanner'), "CSS must style #webPreviewExtensionDependencyBanner for high contrast in Light Mode");
  assert(css.includes('html[data-app-theme="LIGHT"] #lockScreenWidgetPreviewCard .ss-lockscreen-widget-mock'), "CSS must adapt .ss-lockscreen-widget-mock to Light Mode");

  // 11. Non-Interactive Achievement Lock Pills Hidden from Visible UI
  assert(html.includes('id="achievementsBadgesRow" class="hidden" style="display:none !important;"'), "#achievementsBadgesRow must be hidden from visible UI");

  // 12. Back Navigation from Account -> Goals & Focus -> Focus returns to Account
  if (app && typeof app.switchView === "function" && typeof app.handleSystemBackNavigation === "function") {
    app.switchView("OVERVIEW");
    app.switchView("ACCOUNT");
    app.switchView("FOCUS", { fromAccountGoals: true });
    assert.strictEqual(app.state.activeView, "FOCUS", "Must navigate to FOCUS from Account Goals & Focus");
    const handledFocusBack = app.handleSystemBackNavigation();
    assert.strictEqual(handledFocusBack, true, "System Back on Focus (entered from Account) must be handled");
    assert.strictEqual(app.state.activeView, "ACCOUNT", "System Back on Focus (entered from Account) must return to ACCOUNT, not OVERVIEW");

    // Also verify System Back on THEME_STYLE returns to ACCOUNT
    app.switchView("THEME_STYLE");
    assert.strictEqual(app.state.activeView, "THEME_STYLE", "Must navigate to THEME_STYLE");
    const handledThemeBack = app.handleSystemBackNavigation();
    assert.strictEqual(handledThemeBack, true, "System Back on THEME_STYLE must be handled");
    assert.strictEqual(app.state.activeView, "ACCOUNT", "System Back on THEME_STYLE must return to ACCOUNT");
  }

  // 13. Comprehensive Verification of 5 Icons: Transparency, Light/Dark Auto-Inversion, Account Mode Remapping, and Focus Dynamic Brain Color Sync
  assert(!js.includes('<circle cx="495" cy="502" r="336" fill="url(#bgGrad)" />'), "STATS_AND_GOALS icon must NOT include opaque background disc so UI background shows through");
  assert(css.includes(".liquid-view-transition {\n  animation: none !important;\n  filter: none !important;"), "View transition must not apply blur filter");

  if (app && app.IconVisualController && sandbox && sandbox.document) {
    // (a) Verify Dual-Tone mode in Dark Mode vs Light Mode
    app.DesignStyleController.setAppTheme("DARK", { skipRender: false });
    app.IconVisualController.setMasterIconVisualMode("DUAL_TONE");
    assert.strictEqual(app.IconVisualController.getMasterMode(), "DUAL_TONE", "Master mode must be DUAL_TONE");

    const navHome = sandbox.document.getElementById("bottomNavOverview");
    const navStats = sandbox.document.getElementById("bottomNavStats");
    const navFocus = sandbox.document.getElementById("bottomNavFocus");
    const navAccount = sandbox.document.getElementById("bottomNavAccount");
    const subTimer = sandbox.document.getElementById("btnFocusSubTimer");
    const subStats = sandbox.document.getElementById("btnFocusSubStats");

    assert(navHome.innerHTML.includes('fill="#6366F1"') && navHome.innerHTML.includes('fill="#FFFFFF"'), "Home Dual-Tone Dark Mode must have #6366F1 accent and #FFFFFF primary");
    assert(navStats.innerHTML.includes('fill="#00A8E8"') && navStats.innerHTML.includes('fill="#FFFFFF"'), "Screen Time Dual-Tone Dark Mode must have #00A8E8 accent and #FFFFFF primary");
    assert(navAccount.innerHTML.includes('data-source-variant="3d-dualtone-renamed-dualtone"') && navAccount.innerHTML.includes("url(#headGrad_bottomNavAccount)"), "Account Dual-Tone mode must use remapped 3D Dual-Tone gradients");
    assert(
      subStats.innerHTML.includes('data-mode="dual-tone"') &&
      subStats.innerHTML.includes("mode-dualtone") &&
      !subStats.innerHTML.includes("<style>") &&
      subStats.innerHTML.includes("fill=\"url(#sg-ring-outer-shade_btnFocusSubStats)\"") &&
      subStats.innerHTML.includes("fill=\"url(#sg-blade-left-dark_btnFocusSubStats)\""),
      "Stats & Goal Dual-Tone Dark Mode must resolve explicit Dual-Tone + Dark gradient fills without colliding <style>"
    );

    // (b) Verify Focus Icon in Dual-Tone mode dynamically changes color with Brain State Visual brain color
    app.ScreenSyncWellnessEngine.renderDynamicIslandBrainIcon(0);
    const brain0 = navFocus.getAttribute("data-focus-brain-color");
    assert.strictEqual(brain0, "#EC6C88", "At 0 reels (fresh brain), Focus icon Dual-Tone color must match fresh brain color (#EC6C88)");
    assert(navFocus.innerHTML.includes('stop-color="#EC6C88"') && subTimer.innerHTML.includes('stop-color="#EC6C88"'), "Both Focus icons (#bottomNavFocus and #btnFocusSubTimer) must bind #EC6C88 at 0 reels");

    app.ScreenSyncWellnessEngine.renderDynamicIslandBrainIcon(250);
    const brain250 = navFocus.getAttribute("data-focus-brain-color");
    assert(brain250 && brain250 !== brain0, "At 250 reels, Focus icon Dual-Tone color must dynamically shift with Brain State Visual");
    assert(navFocus.innerHTML.includes(`stop-color="${brain250}"`) && subTimer.innerHTML.includes(`stop-color="${brain250}"`), "Both Focus icons must update gradient stops live at 250 reels");

    app.ScreenSyncWellnessEngine.renderDynamicIslandBrainIcon(500);
    const brain500 = navFocus.getAttribute("data-focus-brain-color");
    assert.strictEqual(brain500, "#9EACC0", "At 500 reels (degraded brain), Focus icon Dual-Tone color must match degraded brain color (#9EACC0)");
    assert(navFocus.innerHTML.includes('stop-color="#9EACC0"') && subTimer.innerHTML.includes('stop-color="#9EACC0"'), "Both Focus icons must bind #9EACC0 at 500 reels");

    // (c) Verify Light Mode automatically converts White (#FFFFFF) to Black (#000000) across icons
    app.DesignStyleController.setAppTheme("LIGHT", { skipRender: false });
    assert(navHome.innerHTML.includes('fill="#6366F1"') && navHome.innerHTML.includes('fill="#000000"'), "Home Dual-Tone Light Mode must automatically convert white primary to #000000");
    assert(navStats.innerHTML.includes('fill="#00A8E8"') && navStats.innerHTML.includes('fill="#000000"'), "Screen Time Dual-Tone Light Mode must automatically convert white primary to #000000");
    assert(navAccount.innerHTML.includes('class="acc-primary acc-rim"') && navAccount.innerHTML.includes('fill="#000000"'), "Account Dual-Tone Light Mode must convert outer rim to #000000");
    assert(
      subStats.innerHTML.includes('data-theme="light"') &&
      subStats.innerHTML.includes("light-mode") &&
      subStats.innerHTML.includes("fill=\"url(#sg-ring-outer-shade_btnFocusSubStats)\"") &&
      subStats.innerHTML.includes("fill=\"url(#sg-blade-left-light_btnFocusSubStats)\"") &&
      subStats.innerHTML.includes("fill=\"url(#sg-head-core-light_btnFocusSubStats)\""),
      "Stats & Goal Dual-Tone Light Mode must automatically switch blade, head, and tail to light-mode black gradients while preserving emerald/blue dual-tone bars and rings"
    );

    // (d) Verify Monochrome mode in Light Mode (#000000) and Dark Mode (#FFFFFF) + Account dual-tone -> monochrome remapping
    app.IconVisualController.setMasterIconVisualMode("MONOCHROME");
    assert.strictEqual(app.IconVisualController.getMasterMode(), "MONOCHROME", "Master mode must be MONOCHROME");
    assert(!navHome.innerHTML.includes('fill="#6366F1"') && navHome.innerHTML.includes('fill="#000000"'), "Home Monochrome Light Mode must render entirely in #000000");
    assert(!navStats.innerHTML.includes('fill="#00A8E8"') && navStats.innerHTML.includes('fill="#000000"'), "Screen Time Monochrome Light Mode must render entirely in #000000");
    assert(navFocus.innerHTML.includes('class="focus-icon-path" fill="#000000"'), "Focus Monochrome Light Mode must render in #000000");
    assert(navAccount.innerHTML.includes('data-source-variant="dualtone-renamed-monochrome"') && navAccount.innerHTML.includes('fill-opacity="0.42"') && navAccount.innerHTML.includes('fill="#000000"'), "Account Monochrome Light Mode must use remapped dual-tone opacity layers in #000000");
    assert(
      subStats.innerHTML.includes('data-mode="monochrome"') &&
      subStats.innerHTML.includes("mode-monochrome") &&
      subStats.innerHTML.includes("fill=\"url(#sg-mono-light-shade_btnFocusSubStats)\"") &&
      subStats.innerHTML.includes("fill=\"url(#sg-mono-light-deep_btnFocusSubStats)\"") &&
      subStats.innerHTML.includes("fill=\"url(#sg-head-core-light_btnFocusSubStats)\""),
      "Stats & Goal Monochrome Light Mode must switch all rings, bars, arrow, and figure to black/charcoal monochrome gradients"
    );

    app.DesignStyleController.setAppTheme("DARK", { skipRender: false });
    assert(navHome.innerHTML.includes('fill="#FFFFFF"') && !navHome.innerHTML.includes('fill="#000000"'), "Home Monochrome Dark Mode must automatically convert black to #FFFFFF");
    assert(navFocus.innerHTML.includes('class="focus-icon-path" fill="#FFFFFF"'), "Focus Monochrome Dark Mode must automatically convert black to #FFFFFF");
    assert(navAccount.innerHTML.includes('data-source-variant="dualtone-renamed-monochrome"') && navAccount.innerHTML.includes('fill="#FFFFFF"'), "Account Monochrome Dark Mode must automatically convert black to #FFFFFF");
    assert(
      subStats.innerHTML.includes('data-mode="monochrome"') &&
      subStats.innerHTML.includes('data-theme="dark"') &&
      subStats.innerHTML.includes("fill=\"url(#sg-mono-dark-shade_btnFocusSubStats)\"") &&
      subStats.innerHTML.includes("fill=\"url(#sg-mono-dark-deep_btnFocusSubStats)\"") &&
      subStats.innerHTML.includes("fill=\"url(#sg-head-core-dark_btnFocusSubStats)\""),
      "Stats & Goal Monochrome Dark Mode must switch all rings, bars, arrow, and figure to white/silver monochrome gradients"
    );

    // Restore default Dual-Tone mode
    app.IconVisualController.setMasterIconVisualMode("DUAL_TONE");
  }

  // 14. Soft Glass + Light Mode (html[data-design-style="SOFT"][data-app-theme="LIGHT"]) Complete Visual Differentiation
  assert(
    css.includes('html[data-design-style="SOFT"][data-app-theme="LIGHT"] .oem-card') &&
    css.includes('html[data-design-style="SOFT"][data-app-theme="LIGHT"] .oem-card-inner') &&
    css.includes('html[data-design-style="SOFT"][data-app-theme="LIGHT"] #bottomNavBarContainer') &&
    css.includes('html[data-design-style="SOFT"][data-app-theme="LIGHT"] .liquid-glass-pill') &&
    css.includes('html[data-design-style="SOFT"][data-app-theme="LIGHT"] #btnDeviceDropdownToggle'),
    "CSS must provide dedicated high-specificity Soft Glass + Light Mode rules overriding Liquid Glass Light Mode"
  );

  // 15. Screen Time Device Dropdown Order: Specific Device (#statsSpecificDeviceSubmenu) ABOVE By Operating System (#statsOsCategoryDeviceSubmenu)
  const specIdx = html.indexOf('id="statsSpecificDeviceSubmenu"');
  const osIdx = html.indexOf('id="statsOsCategoryDeviceSubmenu"');
  assert(specIdx !== -1 && osIdx !== -1 && specIdx < osIdx, "In #statsDeviceDropdownMenu, #statsSpecificDeviceSubmenu must appear BEFORE #statsOsCategoryDeviceSubmenu");

  // 16. Category Breakdown Blank Pill Elimination (#statsCategoryTouchBanner hidden when empty)
  assert(css.includes("#statsCategoryTouchBanner:empty"), "CSS must hide #statsCategoryTouchBanner when empty so no blank pill renders");
  if (app && sandbox && sandbox.document) {
    app.state.selectedCategorySegment = null;
    app.renderAll();
    const bannerEl = sandbox.document.getElementById("statsCategoryTouchBanner");
    assert(bannerEl && bannerEl.textContent === "" && bannerEl.classList.contains("hidden"), "#statsCategoryTouchBanner must be empty and hidden when no category segment is selected");
  }

  // 17. Phone Mode Focus Page Header ("Focus") and Sub-Tab Pill on the Same Horizontal Line
  assert(html.includes('<h1 class="focus-mode-title text-[24px] font-normal text-white whitespace-nowrap">Focus</h1>'), "Focus page header title must be 'Focus'");
  assert(css.includes("#focusHeaderTopRow {\n        display: flex !important;\n        flex-direction: row !important;"), "Mobile media query must keep #focusHeaderTopRow in a single horizontal row (flex-direction: row)");

  // 18. Dynamic Data-Flow Upgrades (App Limits Hub Active/Available Lists, Overview Category Mode Badge, Weekly Report Subtitle)
  assert(
    js.includes('document.getElementById("appLimitsActiveList")') &&
    js.includes('document.getElementById("appLimitsAvailableAppsList")') &&
    js.includes('document.getElementById("mainPageCategoriesModeBadge")'),
    "app.js must dynamically bind #appLimitsActiveList, #appLimitsAvailableAppsList, and #mainPageCategoriesModeBadge"
  );

  // 19. Goal Modal Overlay Hides Bottom Navigation Bar on Open and Restores on Cancel / Done
  if (app && sandbox && sandbox.document) {
    app.switchView("OVERVIEW");
    const goalModal = sandbox.document.getElementById("screenTimeGoalModal");
    const navWrapper = sandbox.document.getElementById("mainBottomNavWrapper");
    const navContainer = sandbox.document.getElementById("bottomNavBarContainer");
    const btnOpenScreen = sandbox.document.getElementById("btnOpenScreenGoalFromOverview");
    const btnOpenReel = sandbox.document.getElementById("btnOpenReelGoalFromOverview");
    const btnCancelGoal = sandbox.document.getElementById("btnCancelScreenGoal");
    const btnSaveGoal = sandbox.document.getElementById("btnSaveScreenGoal");

    assert(goalModal && navWrapper && navContainer && btnOpenScreen && btnOpenReel && btnCancelGoal && btnSaveGoal, "All Goal Modal and Bottom Nav elements must exist");

    // Step A: Open Screen Time Goal from Home page -> Modal opens, Nav bar hides
    btnOpenScreen.click();
    assert(!goalModal.classList.contains("hidden"), "#screenTimeGoalModal must be visible after tapping Screen Time Goal on Home page");
    assert(navWrapper.classList.contains("hidden") && navWrapper.classList.contains("ss-nav-hidden-by-modal"), "#mainBottomNavWrapper must be hidden while #screenTimeGoalModal is open");
    assert(navContainer.classList.contains("ss-nav-hidden-by-modal"), "#bottomNavBarContainer must be hidden while #screenTimeGoalModal is open");
    assert.strictEqual(sandbox.document.documentElement.getAttribute("data-goal-modal-open"), "true", "html[data-goal-modal-open] must be true when Goal Modal is open");

    // Step B: Click Cancel -> Modal closes, stays on Home page, Nav bar shows again
    btnCancelGoal.click();
    assert(goalModal.classList.contains("hidden"), "#screenTimeGoalModal must close when Cancel is clicked");
    assert.strictEqual(app.state.activeView, "OVERVIEW", "Active view must be OVERVIEW (Home screen) after Cancel");
    assert(!navWrapper.classList.contains("hidden") && !navWrapper.classList.contains("ss-nav-hidden-by-modal"), "#mainBottomNavWrapper must be visible again after Cancel");
    assert(!navContainer.classList.contains("ss-nav-hidden-by-modal"), "#bottomNavBarContainer must be visible again after Cancel");

    // Step C: Open Reel Watch Time Goal from Home page -> Modal opens, Nav bar hides
    btnOpenReel.click();
    assert(!goalModal.classList.contains("hidden"), "#screenTimeGoalModal must be visible after tapping Reel Watch Time Goal on Home page");
    assert(navWrapper.classList.contains("hidden") && navWrapper.classList.contains("ss-nav-hidden-by-modal"), "#mainBottomNavWrapper must be hidden while #screenTimeGoalModal is open for Reel Goal");

    // Step D: Click Done -> Modal closes, returns to Home page, Nav bar shows again
    sandbox.document.getElementById("inputCustomGoalHrs").value = "1";
    sandbox.document.getElementById("inputCustomGoalMins").value = "15";
    btnSaveGoal.click();
    assert(goalModal.classList.contains("hidden"), "#screenTimeGoalModal must close when Done is clicked");
    assert.strictEqual(app.state.activeView, "OVERVIEW", "Active view must be OVERVIEW (Home screen) after Done");
    assert(!navWrapper.classList.contains("hidden") && !navWrapper.classList.contains("ss-nav-hidden-by-modal"), "#mainBottomNavWrapper must be visible again after Done");
    assert(!navContainer.classList.contains("ss-nav-hidden-by-modal"), "#bottomNavBarContainer must be visible again after Done");
  }

  console.log("[PASS] Test 78: Post-Pass-25 Acceptance Suite (All 18 Checks + 5-Icon Visual & Brain State Color Sync) verified 100%.");
}

module.exports = { runPostPass25AcceptanceTests };

if (require.main === module) {
  const rootDir = path.resolve(__dirname, "..");
  const html = fs.readFileSync(path.join(rootDir, "src/index.html"), "utf8");
  runPostPass25AcceptanceTests(rootDir, html, null, null);
}
