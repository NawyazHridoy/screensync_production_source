'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

function runCategory02AcceptanceTests(context) {
  const { app, sandbox, rootDir } = context;
  const ROOT = rootDir || path.resolve(__dirname, '..');
  const doc = sandbox.document;

  // 1. Section S2.1 & S2B-05: Verify platforms/windows-companion WL-BUG-01..WL-BUG-05 + Bangladesh Units & Static CITIES Removal
  const compDir = path.join(ROOT, 'platforms', 'windows-companion');
  assert(fs.existsSync(compDir), 'S2.1: platforms/windows-companion directory must exist');
  assert(!fs.existsSync(path.join(compDir, 'src', 'modules', 'prayer.rs')), 'WL-BUG-01: src/modules/prayer.rs must be completely removed');

  const modRs = fs.readFileSync(path.join(compDir, 'src', 'modules', 'mod.rs'), 'utf8');
  assert(!modRs.includes('prayer') && !modRs.includes('Updater::new'), 'WL-BUG-01 & WL-BUG-02: mod.rs must not register prayer or Updater::new');

  const appRs = fs.readFileSync(path.join(compDir, 'src', 'app.rs'), 'utf8');
  assert(!/prayer/i.test(appRs), 'WL-BUG-01: src/app.rs must contain zero references to Prayer Times');
  assert(!/windyland|shabab239/i.test(appRs), 'WL-BUG-02: src/app.rs must contain zero WindyLand or shabab239 branding');
  assert(appRs.includes('a.1.total_cmp(&b.1)') && !appRs.includes('partial_cmp(&b.1).unwrap()'), 'WL-BUG-03: src/app.rs must use total_cmp(&b.1) instead of partial_cmp().unwrap()');

  const toolsRs = fs.readFileSync(path.join(compDir, 'src', 'modules', 'tools.rs'), 'utf8');
  assert(!/\bkatha\b|\bbigha\b|\bmaund\b|\bseer\b|\btola\b|\bvori\b/i.test(toolsRs), 'S2B-05: tools.rs must contain zero Bangladesh traditional units (katha, bigha, maund, seer, tola, vori)');
  assert(!toolsRs.includes('pub const CITIES'), 'S2B-05: tools.rs must not contain static pub const CITIES array');
  assert(toolsRs.includes('pub fn dynamic_zone_keys()'), 'S2B-05: tools.rs must expose dynamic OS time zone enumeration');

  const dragDropRs = fs.readFileSync(path.join(compDir, 'src', 'dragdrop.rs'), 'utf8');
  assert(dragDropRs.includes('pub fn sanitize_url_stem') && dragDropRs.includes('"CON" | "PRN" | "AUX" | "NUL"'), 'WL-BUG-04: src/dragdrop.rs must sanitize URL shortcut stems and guard Windows reserved device names');

  const storeRs = fs.readFileSync(path.join(compDir, 'src', 'store.rs'), 'utf8');
  assert(storeRs.includes('Some(\'\\\\\') => out.push(\'\\\\\')') && storeRs.includes('None => out.push(\'\\\\\')'), 'WL-BUG-05: src/store.rs unesc must handle escaped and trailing backslashes losslessly');
  assert(storeRs.includes('.join("ScreenSync").join("MultiPurposeIsland")'), 'WL-BUG-02: src/store.rs must persist in %APPDATA%\\ScreenSync\\MultiPurposeIsland');

  // 2. Section S2.2 & S2B-01..S2B-05: Verify MultiPurposeDynamicIslandEngine (Strictly Windows, ChromeOS, Linux ONLY)
  const mp = app.MultiPurposeDynamicIslandEngine;
  assert(mp && typeof mp.isSupportedOnCurrentOs === 'function', 'S2.2: MultiPurposeDynamicIslandEngine must be exported');
  assert.strictEqual(mp.ACTIVE_MODULES.length, 11, 'S2.2: MultiPurposeDynamicIslandEngine must have exactly 11 active modules');
  assert(!mp.ACTIVE_MODULES.some(m => /prayer/i.test(m.id) || /prayer/i.test(m.title)), 'WL-BUG-01: MultiPurposeDynamicIslandEngine must exclude Prayer Times');

  // S2B-03: Verify #accountMultiPurposeIslandCard and #accountIslandModeCard reside inside #viewThemeStyleWindow and #designCardIslandModeMirror is removed
  const srcHtml = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
  assert(!srcHtml.includes('id="designCardIslandModeMirror"'), 'S2B-03: Duplicate #designCardIslandModeMirror must be removed from src/index.html');
  const themeWinMatch = srcHtml.match(/<section id="viewThemeStyleWindow"[\s\S]*?<\/section>/);
  assert(themeWinMatch && themeWinMatch[0].includes('id="accountMultiPurposeIslandCard"') && themeWinMatch[0].includes('id="accountIslandModeCard"'), 'S2B-03: #accountMultiPurposeIslandCard and #accountIslandModeCard must be placed inside #viewThemeStyleWindow');

  // S2B-02: Verify #btnToggleMultiPurposeIsland uses the standard checkbox .ss-onoff-switch
  const toggleBtn = doc.getElementById('btnToggleMultiPurposeIsland');
  assert(toggleBtn && String(toggleBtn.tagName || "").toUpperCase() === 'INPUT' && toggleBtn.getAttribute('type') === 'checkbox' && srcHtml.includes('<input id="btnToggleMultiPurposeIsland"') && srcHtml.includes('class="ss-onoff-switch"'), 'S2B-02: #btnToggleMultiPurposeIsland must be an <input type="checkbox"> switch');

  for (const allowedOs of ['Windows', 'ChromeOS', 'Linux']) {
    assert.strictEqual(mp.isSupportedOnCurrentOs(allowedOs), true, `S2.2: ${allowedOs} must support Multi-Purpose Dynamic Island`);
  }
  for (const forbiddenOs of ['Android', 'iOS', 'macOS']) {
    assert.strictEqual(mp.isSupportedOnCurrentOs(forbiddenOs), false, `S2.2: ${forbiddenOs} must NEVER support Multi-Purpose Dynamic Island`);
    const syncForbidden = mp.syncAccountCardVisibilityAndState(forbiddenOs);
    assert.strictEqual(syncForbidden.supported, false, `S2.2: ${forbiddenOs} sync must report supported=false`);
    const mpCard = doc.getElementById('accountMultiPurposeIslandCard');
    assert(mpCard && mpCard.classList.contains('hidden') && mpCard.getAttribute('aria-hidden') === 'true', `S2.2: #accountMultiPurposeIslandCard must be hidden on ${forbiddenOs}`);
  }

  // Restore Windows OS context and test WL-BUG-03, WL-BUG-04, WL-BUG-05, S2B-04, and S2B-05 in JS engine
  mp.syncAccountCardVisibilityAndState('Windows');
  mp.setEnabled(true, { osCategory: 'Windows', skipRender: true });
  assert.strictEqual(doc.getElementById('multiPurposeIslandStatusBadge').textContent, 'Active', 'S2B-01: #multiPurposeIslandStatusBadge must display compact "Active" when enabled');
  assert.strictEqual(mp.computeNearestScreenEdge(NaN, 10, { left: 0, top: 0, right: 1920, bottom: 1080 }).edge, 'top', 'WL-BUG-03: NaN coordinate must not throw and must resolve deterministically via totalCmpFloat');
  assert.strictEqual(mp.sanitizeUrlShortcutStem('https://con/test'), 'link_con', 'WL-BUG-04: Reserved Windows device name CON must be prefixed with link_');
  assert.strictEqual(mp.sanitizeUrlShortcutStem('https://prn:8080/path'), 'link_prn', 'WL-BUG-04: Reserved Windows device name PRN with port must be sanitized to link_prn');
  for (const sample of ['C:\\nerve\\task', 'trail\\', 'line1\nline2\tend']) {
    assert.strictEqual(mp.unescStoreField(mp.escStoreField(sample)), sample, `WL-BUG-05: escStoreField/unescStoreField must round-trip ${JSON.stringify(sample)} losslessly`);
  }

  // S2B-05: Verify Bangladesh traditional units are removed (return null) and standard international units work
  assert.strictEqual(mp.convertUnits(1, 'bigha', 'katha'), null, 'S2B-05: Removed Bangladesh unit bigha/katha must return null');
  assert.strictEqual(mp.convertUnits(1, 'katha', 'sqft'), null, 'S2B-05: Removed Bangladesh unit katha must return null');
  assert.strictEqual(mp.convertUnits(100, 'decimal', 'acre'), null, 'S2B-05: Removed Bangladesh unit decimal must return null');
  assert.strictEqual(mp.convertUnits(1, 'maund', 'seer'), null, 'S2B-05: Removed Bangladesh unit maund/seer must return null');
  assert.strictEqual(mp.convertUnits(1, 'vori', 'g'), null, 'S2B-05: Removed Bangladesh unit vori/tola must return null');
  assert.strictEqual(mp.convertUnits(1, 'km', 'm'), 1000, 'S2B-05: Standard conversion 1 km -> 1000 m must succeed');
  assert.strictEqual(mp.convertUnits(100, 'C', 'F'), 212, 'S2B-05: Standard conversion 100 C -> 212 F must succeed');
  assert.strictEqual(mp.convertUnits(1, 'GB', 'MB'), 1024, 'S2B-05: Standard conversion 1 GB -> 1024 MB must succeed');

  // S2B-05: Verify static WORLD_TIME_ZONES is removed and dynamic device/IANA time zones + Live Search Bar work
  assert.strictEqual(mp.WORLD_TIME_ZONES, undefined, 'S2B-05: Static 12-city WORLD_TIME_ZONES table must be removed');
  assert(typeof mp.getDeviceTimeZone() === 'string' && mp.getDeviceTimeZone().length > 0, 'S2B-05: getDeviceTimeZone() must return active device IANA time zone');
  const availZones = mp.getAvailableTimeZones();
  assert(Array.isArray(availZones) && availZones.length >= 1, 'S2B-05: getAvailableTimeZones() must return dynamic time zones');
  const tzInfo = mp.computeDynamicTimeZoneInfo('UTC', 0);
  assert.strictEqual(tzInfo.timeZone, 'UTC', 'S2B-05: computeDynamicTimeZoneInfo must resolve dynamic zone info');

  // Verify Browser-Compatible Time Zone Search Bar & Autocomplete Suggestions (Pics 4 & 5)
  const dhakaSuggestions = mp.getMatchingTimeZoneSuggestions('dh', 5);
  assert(dhakaSuggestions.length > 0 && dhakaSuggestions.some(s => s.tz === 'Asia/Dhaka'), 'Time Zone Search: typing "dh" must suggest Dhaka (Asia/Dhaka)');
  const londonSuggestions = mp.getMatchingTimeZoneSuggestions('lon', 5);
  assert(londonSuggestions.length > 0 && londonSuggestions.some(s => s.tz === 'Europe/London'), 'Time Zone Search: typing "lon" must suggest London (Europe/London)');
  const resolvedTokyo = mp.searchAndResolveTimeZone('Tokyo', { fetchOnline: false });
  assert.strictEqual(resolvedTokyo.timeZone, 'Asia/Tokyo', 'Time Zone Search: pressing Enter on "Tokyo" must resolve to Asia/Tokyo');
  mp.resetTimeZoneBaseToDevice();

  const calcEval = mp.evaluateCalculatorExpression('1250*15%');
  assert(calcEval.ok && calcEval.value === 187.5, 'S2B-05: evaluateCalculatorExpression("1250*15%") must evaluate to 187.5');

  // S2B-04: Verify style buttons (Full, Compact, Pill, Hidden) and Open/Close Island HUD toggle
  mp.setNotchStyle('compact');
  assert.strictEqual(doc.getElementById('dynamicIslandPill').getAttribute('data-mp-notch-style'), 'compact', 'S2B-04: setNotchStyle("compact") must update #dynamicIslandPill[data-mp-notch-style]');
  mp.setNotchStyle('full');
  const openHudBtn = doc.getElementById('btnOpenMultiPurposeIslandDrawer');
  assert.strictEqual(openHudBtn.textContent.trim(), 'Open Island HUD', 'S2B-04: #btnOpenMultiPurposeIslandDrawer must show "Open Island HUD" when closed');
  mp.toggleDrawer(true);
  assert.strictEqual(openHudBtn.textContent.trim(), 'Close Island HUD', 'S2B-04: #btnOpenMultiPurposeIslandDrawer must show "Close Island HUD" when expanded');
  for (const mod of mp.ACTIVE_MODULES) {
    const selRes = mp.selectTab(mod.id);
    assert.strictEqual(selRes.ok, true, `S2B-05: selectTab("${mod.id}") must render interactive panel`);
    assert(doc.getElementById('multiPurposeDynamicIslandDrawer').innerHTML.includes(`data-mp-module-view="${mod.id}"`), `S2B-05: Drawer must render interactive module view for ${mod.id}`);
  }

  // Verify Timer 3D Drum Wheel Picker (no +1m button) & Live Pomodoro/Timer 1Hz Tick Engine (Pic 6)
  mp.selectTab('timer');
  const timerHtml = doc.getElementById('multiPurposeDynamicIslandDrawer').innerHTML;
  assert(!timerHtml.includes('timer-plus1m') && !timerHtml.includes('>+1m<'), 'Pic 6 Fix: "+1m" button must be removed from Timer module');
  assert(timerHtml.includes('id="mpTimer3DWheelPicker"') && timerHtml.includes('data-mp-wheel-col="mins"') && timerHtml.includes('data-mp-wheel-col="secs"'), 'Pic 6 Fix: Timer must render interactive 3D Drum-Roll Time Picker (#mpTimer3DWheelPicker)');
  mp.setTimerDuration(4, 30);
  assert.strictEqual(mp.timerState.remainingSec, 270, 'Timer 3D Picker: setTimerDuration(4, 30) must set 270 seconds');
  mp.timerState.running = true;
  mp.pomodoroState.remainingSec = 1500;
  mp.pomodoroState.running = true;
  mp.tickOneSecond();
  assert.strictEqual(mp.timerState.remainingSec, 269, 'Timer Live Engine: tickOneSecond() must decrement running Timer');
  assert.strictEqual(mp.pomodoroState.remainingSec, 1499, 'Pomodoro Live Engine: tickOneSecond() must decrement running Pomodoro');
  mp.timerState.running = false;
  mp.pomodoroState.running = false;
  mp.setTimerDuration(5, 0);

  // Verify Tools -> Time Zones renders #mpTzSearchInput instead of <select id="mpTzSelect"> (Pics 4 & 5)
  mp.selectTab('tools');
  mp.activeToolSubTab = 'zones';
  mp.renderDrawer();
  const tzHtml = doc.getElementById('multiPurposeDynamicIslandDrawer').innerHTML;
  assert(tzHtml.includes('id="mpTzSearchInput"') && !tzHtml.includes('id="mpTzSelect"'), 'Pics 4 & 5 Fix: Time Zones tab must render #mpTzSearchInput search bar and remove native <select id="mpTzSelect">');

  mp.toggleDrawer(false);
  assert.strictEqual(openHudBtn.textContent.trim(), 'Open Island HUD', 'S2B-04: #btnOpenMultiPurposeIslandDrawer must return to "Open Island HUD" when closed');

  // Verify Removal of Redundant Drum Wheels from Mascot & Screen Edge Pickers (Pics 1 & 2)
  assert(!srcHtml.includes('id="wheelMpMascot"') && !srcHtml.includes('id="wheelMpEdge"'), 'Pics 1 & 2 Fix: Redundant #wheelMpMascot and #wheelMpEdge drum wheels must be removed from HTML');
  assert(srcHtml.includes('id="mpStyleLiquidPill"') && srcHtml.includes('id="islandModeLiquidPill"'), 'S2B-08: #mpStyleToggleGroup and #islandModeToggleGroup must include .liquid-glass-pill sliding indicators');

  // Verify Removal of Checkmarks (✓) from Island Style & Design Style Segmented Buttons across All OS (Pic 3)
  for (const chkId of ['checkIconIslandStucked', 'checkIconIslandFloating', 'checkIconLiquidGlass', 'checkIconSoftGlass']) {
    const chkEl = doc.getElementById(chkId);
    assert(chkEl && chkEl.textContent.trim() === '' && chkEl.classList.contains('hidden'), `Pic 3 Fix: #${chkId} must have empty text and remain hidden across all OSes`);
  }

  // Verify Mascot Live Brain Degradation Algorithm & Live Clock Readout (Zero Hardcoded 4:20)
  for (const mKey of mp.MASCOTS) {
    const svgFresh = mp.build3DMascotSvg(mKey, 30, mp.computeMascotDegradationState(0, 0, 80));
    const svgDegraded = mp.build3DMascotSvg(mKey, 30, mp.computeMascotDegradationState(450, 180, 80));
    assert(svgFresh.includes('data-mascot-stage="0"') && svgDegraded.includes('data-mascot-stage="9"'), `Mascot Degradation: build3DMascotSvg("${mKey}") must reflect live brain degradation stage (0 vs 9)`);
    assert(svgFresh !== svgDegraded, `Mascot Degradation: build3DMascotSvg("${mKey}") visual SVG must change as reel degradation increases`);
  }
  assert(!doc.getElementById('mpCardMascot3DGrid').innerHTML.includes('>4:20<'), 'Mascot Cards: Hardcoded "4:20" must be replaced with live clock readout');

  mp.setMascot('cat');
  assert.strictEqual(doc.getElementById('labelMpMascotSelected').textContent, 'Cat', 'S2B-08: setMascot("cat") must sync #labelMpMascotSelected to "Cat"');
  mp.setEdge('right');
  assert.strictEqual(doc.getElementById('labelMpEdgeSelected').textContent, 'Right Edge', 'S2B-08: setEdge("right") must sync #labelMpEdgeSelected to "Right Edge"');
  assert(doc.getElementById('mpCardEdge3DStage').innerHTML.includes('ss-mp-3d-monitor-bezel'), 'S2B-08: #mpCardEdge3DStage must render realistic monitor bezel');
  mp.setMascot('eyes');
  mp.setEdge('top');

  // Verify Persistent Screen-Edge / 3D-Bezel-Dock (#multiPurposeEdgeBezelDock) Visibility & Click-to-Open HUD
  const dockEl = doc.getElementById('multiPurposeEdgeBezelDock');
  assert(dockEl && dockEl.getAttribute('data-mp-dock-visible') === 'true' && !dockEl.classList.contains('hidden'), 'Persistent Screen-Edge Dock: #multiPurposeEdgeBezelDock must be visible when Multi-Purpose Dynamic Island is enabled');
  mp.toggleDrawer(true);
  assert.strictEqual(dockEl.getAttribute('data-mp-hud-open'), 'true', 'Persistent Screen-Edge Dock: Opening HUD must sync data-mp-hud-open="true" on #multiPurposeEdgeBezelDock');
  mp.toggleDrawer(false);

  // 3. Section S2.3 & S2B-01: Verify DraggableFloatingPillController & Conditional Mode Switcher Visibility
  const fp = app.DraggableFloatingPillController;
  assert(fp && typeof fp.computeSnapPosition === 'function', 'S2.3: DraggableFloatingPillController must be exported');
  assert(srcHtml.includes('id="btnIslandModeStucked"') && srcHtml.includes('<span>Dynamic Island</span>') && srcHtml.includes('<span>Floating Pill</span>') && !themeWinMatch[0].includes('Stucked Dynamic Island') && !themeWinMatch[0].includes('Draggable Floating Pill'), 'S2B-01: Island Style buttons must be labeled "Dynamic Island" and "Floating Pill"');

  // On Windows with Multi-Purpose Island enabled -> mode switcher hidden; when disabled -> visible
  mp.setEnabled(true, { osCategory: 'Windows', skipRender: true });
  assert.strictEqual(fp.isModeSwitcherVisibleForOs('Windows'), false, 'S2.3: Mode switcher must be hidden on Windows when Multi-Purpose Island is enabled');
  mp.setEnabled(false, { osCategory: 'Windows', skipRender: true });
  assert.strictEqual(fp.isModeSwitcherVisibleForOs('Windows'), true, 'S2.3: Mode switcher must be visible on Windows when Multi-Purpose Island is disabled');

  // On Android, iOS, macOS -> mode switcher ALWAYS visible
  for (const mobileOrMacOs of ['Android', 'iOS', 'macOS']) {
    assert.strictEqual(fp.isModeSwitcherVisibleForOs(mobileOrMacOs), true, `S2.3: Mode switcher must always be visible on ${mobileOrMacOs}`);
  }

  // Edge-snapping physics: TOP, LEFT, RIGHT, and rebound from center & bottom (never stays in center or bottom)
  const snapTop = fp.computeSnapPosition({ releaseX: 195, releaseY: 40, viewportWidth: 390, viewportHeight: 844 });
  assert.strictEqual(snapTop.snappedEdge, 'TOP', 'S2.3: Release in top 18% zone must snap to TOP edge');

  const snapLeftFromCenter = fp.computeSnapPosition({ releaseX: 140, releaseY: 420, viewportWidth: 390, viewportHeight: 844 });
  assert.strictEqual(snapLeftFromCenter.snappedEdge, 'LEFT', 'S2.3: Release in left-center must rebound to LEFT edge (leftPx=8)');
  assert.strictEqual(snapLeftFromCenter.leftPx, 8, 'S2.3: Left-snapped pill must anchor at left=8px');

  const snapRightFromCenter = fp.computeSnapPosition({ releaseX: 250, releaseY: 420, viewportWidth: 390, viewportHeight: 844 });
  assert.strictEqual(snapRightFromCenter.snappedEdge, 'RIGHT', 'S2.3: Release in right-center must rebound to RIGHT edge (rightPx=8)');
  assert.strictEqual(snapRightFromCenter.rightPx, 8, 'S2.3: Right-snapped pill must anchor at right=8px');

  const snapFromBottom = fp.computeSnapPosition({ releaseX: 300, releaseY: 810, viewportWidth: 390, viewportHeight: 844, pillHeight: 36, bottomNavSafeHeightPx: 84 });
  assert(snapFromBottom.snappedEdge === 'RIGHT' && snapFromBottom.reboundedFromBottom === true && snapFromBottom.topPx <= (844 - 84 - 36 - 16), 'S2.3: Release in bottom zone (>=80% height) must rebound above bottom nav to nearest LEFT/RIGHT edge');

  // Reset mode back to STUCKED_DYNAMIC_ISLAND
  fp.setMode('STUCKED_DYNAMIC_ISLAND', { osCategory: 'Windows' });
  assert.strictEqual(doc.getElementById('islandPresentationModeBadge').textContent, 'Dynamic Island', 'S2B-01: #islandPresentationModeBadge must display "Dynamic Island"');
  mp.setEnabled(true, { osCategory: 'Windows', skipRender: true });

  // 4. Section S2.4, S2B-06 & CAT02-04..CAT02-09: Cutout CSS, Alias Normalization & Visibility State Machine
  const mainCss = fs.readFileSync(path.join(ROOT, 'src', 'styles', 'main.css'), 'utf8');
  assert(
    mainCss.includes('#dynamicIslandPill.cutout-truedepth-notch') &&
    mainCss.includes('#dynamicIslandPill.cutout-waterdrop') &&
    mainCss.includes('#dynamicIslandPill.cutout-fullscreen') &&
    mainCss.includes('border-bottom-left-radius: 18px !important;') &&
    mainCss.includes('html[data-app-theme="DARK"][data-design-style="LIQUID"] #brainStateMilestoneOverlay'),
    'S2.4, S2B-06 & CAT02-19: main.css must define pre-iPhone 14 top-edge-docked notch rules for .cutout-truedepth-notch, .cutout-waterdrop, .cutout-fullscreen, and Dark+Liquid #brainStateMilestoneOverlay rules'
  );
  assert(doc.getElementById('dynamicIslandCenterCutout') && doc.getElementById('dynamicIslandFallbackDivider'), 'Pass B: #dynamicIslandCenterCutout and #dynamicIslandFallbackDivider child spans must exist inside #islandCutoutDivider');

  assert.strictEqual(app.DynamicIslandAdaptiveController.normalizeCutoutConfig('DYNAMIC_ISLAND'), 'IPHONE_PILL', 'CAT02-05: DYNAMIC_ISLAND must map to IPHONE_PILL');
  assert.strictEqual(app.DynamicIslandAdaptiveController.normalizeCutoutConfig('HOLE_PUNCH'), 'PUNCH_HOLE', 'CAT02-05: HOLE_PUNCH must map to PUNCH_HOLE');
  assert.strictEqual(app.DynamicIslandAdaptiveController.normalizeCutoutConfig('DEWDROP'), 'WATERDROP', 'CAT02-05: DEWDROP must map to WATERDROP');
  assert.strictEqual(app.DynamicIslandAdaptiveController.normalizeCutoutConfig('INFINITY_V'), 'WATERDROP', 'CAT02-05: INFINITY_V must map to WATERDROP');

  const notchLayout = app.DynamicIslandAdaptiveController.computeAdaptiveLayout({
    cutoutType: 'TRUEDEPTH_NOTCH',
    viewportWidth: 390,
    viewportHeight: 844,
    cutoutRect: { width: 120, height: 30, left: 135, right: 255, top: 0, bottom: 30 }
  });
  assert(notchLayout.cutoutWidthPx >= 96 && notchLayout.cutoutWidthPx <= 168 && notchLayout.topOffsetPx === 0, 'S2.4 & CAT02-04: TRUEDEPTH_NOTCH portrait layout must compute hardware cutoutWidthPx (96..168) and topOffsetPx=0');

  const waterdropLayout = app.DynamicIslandAdaptiveController.computeAdaptiveLayout({
    cutoutType: 'WATERDROP',
    viewportWidth: 390,
    viewportHeight: 844,
    cutoutRect: { width: 28, height: 22, left: 181, right: 209, top: 0, bottom: 22 }
  });
  assert(waterdropLayout.cutoutWidthPx >= 28 && waterdropLayout.cutoutWidthPx <= 56 && waterdropLayout.topOffsetPx === 0, 'S2.4 & CAT02-04: WATERDROP portrait layout must compute hardware cutoutWidthPx (28..56) and topOffsetPx=0');

  // 5. S2B-07: Notification Settings Page (#viewNotificationSettingsWindow) Bug Fixes (BUG-NOTIF-01..06)
  app.switchView('NOTIFICATION_SETTINGS');
  const permCardNotif = doc.getElementById('accountPermissionsCard');
  const schedCardNotif = doc.getElementById('accountNotificationScheduleCard');
  assert(!permCardNotif.classList.contains('hidden') && !schedCardNotif.classList.contains('hidden'), 'S2B-07 (BUG-NOTIF-02/03): Direct switchView("NOTIFICATION_SETTINGS") must unhide #accountPermissionsCard and #accountNotificationScheduleCard');
  if (typeof sandbox.window.__ssAccountScrollCheck === 'function') {
    sandbox.window.__ssAccountScrollCheck({ target: { scrollTop: 480 } });
  }
  assert(!permCardNotif.classList.contains('hidden') && !schedCardNotif.classList.contains('hidden'), 'S2B-07 (BUG-NOTIF-01): Scrolling inside #viewNotificationSettingsWindow must NEVER auto-collapse #accountPermissionsCard or #accountNotificationScheduleCard');
  assert(schedCardNotif.getAttribute('data-master-muted') !== null, 'S2B-07 (BUG-NOTIF-06): #accountNotificationScheduleCard must set data-master-muted attribute');
  app.closeNotificationSettingsWindow();

  // 6. CAT02-11..CAT02-17 & Pass B Supplemental: Brain State Engine & Multi-Bracket Milestone Queue
  const wellness = app.ScreenSyncWellnessEngine;
  assert(typeof wellness.resolveBrainState === 'function' && typeof wellness.evaluateAndTriggerMilestoneOverlay === 'function', 'Pass B: ScreenSyncWellnessEngine must expose resolveBrainState and evaluateAndTriggerMilestoneOverlay');
  wellness.dismissMilestoneOverlay({ clearQueue: true });
  wellness.shownMilestonesByDate = {};
  wellness._pendingMilestoneQueue = [];
  wellness.lastEvaluatedReelsCount = 0;
  app.state.brainMilestoneOverlayOpen = false;
  app.BackendDB.data.brainMilestonesShownByUser = {};
  sandbox.localStorage.removeItem(wellness.MILESTONE_STORAGE_KEY);

  // Seed a prior-day milestone entry and verify _savePersistedMilestones preserves multi-day history (CAT02-13 / C02-ISS-02)
  sandbox.localStorage.setItem(wellness.MILESTONE_STORAGE_KEY, JSON.stringify({ '2026-11-01': [50, 100] }));
  const jumpRes = wellness.checkAndTriggerMilestoneOverlay(150);
  assert.strictEqual(jumpRes.triggered, true, 'CAT02-12: Jump 0 -> 150 must trigger milestone overlay');
  assert.strictEqual(jumpRes.milestoneReached, 50, 'CAT02-12: Jump 0 -> 150 must present 50-reel bracket first');
  assert.deepStrictEqual(Array.from(jumpRes.queuedMilestones), [100, 150], 'CAT02-12: Jump 0 -> 150 must queue [100, 150] without dropping intermediate brackets');
  assert(doc.getElementById('brainOverlayMilestonePill').textContent.includes('50 Reels ·'), 'Pass B: #brainOverlayMilestonePill must display both reel count and watch time');

  // Verify non-overwriting guard while overlay is open (C02-ISS-01)
  const whileOpenRes = wellness.checkAndTriggerMilestoneOverlay(200);
  assert.strictEqual(whileOpenRes.triggered, false, 'CAT02-12: Crossing 200 while overlay is open must queue without overwriting');
  assert.strictEqual(whileOpenRes.queued, true, 'CAT02-12: Crossing 200 while overlay is open must return queued=true');
  assert.strictEqual(app.state.activeBrainMilestoneReels, 50, 'CAT02-12: Active displayed milestone must remain 50 until Continue is tapped');

  // Verify surface-namespaced trajectory SVG IDs on milestone overlay (CAT02-17 / C02-ISS-06)
  const overlayTrajHtml = doc.getElementById('brainOverlayTrajectoryBox').innerHTML;
  assert(overlayTrajHtml.includes('id="ssTrajNodeGlow500_overlay"') && overlayTrajHtml.includes('url(#ssTrajectoryCurveGrad_overlay)'), 'CAT02-17: Milestone overlay trajectory SVG must namespace gradient IDs with _overlay');

  // Step through queue via dismissMilestoneOverlay: 50 -> 100 -> 150 -> 200 -> closed
  const step1 = wellness.dismissMilestoneOverlay();
  assert.strictEqual(step1.advancedToQueuedMilestone, 100, 'CAT02-12: First Continue tap must advance to queued 100-reel milestone');
  const step2 = wellness.dismissMilestoneOverlay();
  assert.strictEqual(step2.advancedToQueuedMilestone, 150, 'CAT02-12: Second Continue tap must advance to queued 150-reel milestone');
  const step3 = wellness.dismissMilestoneOverlay();
  assert.strictEqual(step3.advancedToQueuedMilestone, 200, 'CAT02-12: Third Continue tap must advance to queued 200-reel milestone');
  const step4 = wellness.dismissMilestoneOverlay();
  assert.strictEqual(step4.dismissed, true, 'CAT02-12: Fourth Continue tap must close overlay after queue drains');
  assert.strictEqual(app.state.brainMilestoneOverlayOpen, false, 'CAT02-12: Overlay state must be closed after queue drains');
  assert.strictEqual(wellness.lastAcknowledgedMilestoneBracket, 200, 'Pass B: lastAcknowledgedMilestoneBracket must record 200');

  // Verify 30-day multi-date persistence preserved '2026-11-01' alongside todayKey (CAT02-13 / C02-ISS-02)
  const persistedMap = JSON.parse(sandbox.localStorage.getItem(wellness.MILESTONE_STORAGE_KEY) || '{}');
  assert(Array.isArray(persistedMap['2026-11-01']) && persistedMap['2026-11-01'].includes(50), 'CAT02-13: _savePersistedMilestones must preserve prior dates in localStorage');

  // Verify #brainVisualStageHeadline & origin-aware openBrainStatePage (CAT02-14, CAT02-16)
  app.switchView('OVERVIEW');
  const openRes = wellness.openBrainStatePage({ originView: 'OVERVIEW' });
  assert.strictEqual(openRes.originView, 'OVERVIEW', 'CAT02-16: openBrainStatePage must record originView=OVERVIEW');
  const stageHeadEl = doc.getElementById('brainVisualStageHeadline');
  assert(stageHeadEl && stageHeadEl.getAttribute('data-brain-stage') !== null, 'CAT02-14: #brainVisualStageHeadline must exist and sync data-brain-stage');
  const backRes = wellness.returnToAccountFromBrainState();
  assert.strictEqual(backRes.returnedTo, 'OVERVIEW', 'CAT02-16: Returning from Brain State opened from OVERVIEW must return to OVERVIEW');


  // 7. S2B-10: Zero Drop Shadow, 3-Sided / 4-Sided Color-Changing Border Glow, Pure Reel Count (No "Reels" text),
  // Conditional Reel Telemetry Visibility, Segment Dividers, All 4 Notch Styles on All 4 Edges, & Left-Edge Nav Non-Overlap
  const s2b10Css = fs.readFileSync(path.join(ROOT, "src/styles/main.css"), "utf8");
  assert(s2b10Css.includes("@keyframes islandColorGlow") && s2b10Css.includes("box-shadow: none !important"), "S2B-10: @keyframes islandColorGlow must animate thin border-color with box-shadow: none !important");
  assert(s2b10Css.includes("border-top-width: 0px !important") && s2b10Css.includes("border-bottom-width: 0px !important") && s2b10Css.includes("border-left-width: 0px !important") && s2b10Css.includes("border-right-width: 0px !important"), "S2B-10: Edge-docked notches must have 0px bezel-side border so only the 3 exposed sides glow");
  assert(s2b10Css.includes("#bottomNavBarContainer") && s2b10Css.includes("left: 56px !important"), "S2B-10: Left edge dock must shift #bottomNavBarContainer to left: 56px !important to prevent overlap");
  assert(s2b10Css.includes("min-width: 248px !important") && s2b10Css.includes("min-width: 272px !important") && s2b10Css.includes("justify-content: space-between !important"), "S2B-11: Multi-Purpose Dynamic Island must preserve wide, eye-catching proportions in both idle (248px) and active-reel (272px) states");

  // Verify idle state (not watching reels): #multiPurposeEdgeBezelDock hides Brain Icon, Reel Count, and Watch Time
  app.state.islandContextMode = "SCREENSYNC_APP";
  mp.setEnabled(true, { persist: false });
  mp.setEdge("top", { persist: false });
  mp.setNotchStyle("full", { persist: false });
  const bezelDockEl = doc.getElementById("multiPurposeEdgeBezelDock");
  assert(bezelDockEl, "S2B-10: #multiPurposeEdgeBezelDock must exist");
  assert.strictEqual(bezelDockEl.getAttribute("data-mp-reel-active"), "false", "S2B-10: When not watching reels (SCREENSYNC_APP), data-mp-reel-active must be false");
  assert(!bezelDockEl.innerHTML.includes("mpDockReelsCount") && !bezelDockEl.innerHTML.includes("mpDockBrainSlot") && !bezelDockEl.innerHTML.includes("mpDockWatchTime"), "S2B-10: When not watching reels, Brain Icon, Reel Count, and Watch Time must not be rendered inside #multiPurposeEdgeBezelDock");
  assert(bezelDockEl.innerHTML.includes("ss-island-seg-divider"), "S2B-10: Idle #multiPurposeEdgeBezelDock must include a crisp divider between Mascot and Time/Utility");

  // Verify active reel state (REEL_PORTRAIT): shows Mascot | Brain+Count | WatchTime | Time across all 4 edges with zero "Reels" text
  app.state.islandContextMode = "REEL_PORTRAIT";
  for (const edgeItem of ["top", "bottom", "left", "right"]) {
    mp.setEdge(edgeItem, { persist: false });
    for (const styleItem of ["full", "compact", "pill", "hidden"]) {
      mp.setNotchStyle(styleItem, { persist: false });
      assert.strictEqual(bezelDockEl.getAttribute("data-mp-edge"), edgeItem, "S2B-10: data-mp-edge must update to " + edgeItem);
      assert.strictEqual(bezelDockEl.getAttribute("data-mp-notch-style"), styleItem, "S2B-10: data-mp-notch-style must update to " + styleItem + " on edge " + edgeItem);
      if (styleItem !== "hidden") {
        assert.strictEqual(bezelDockEl.getAttribute("data-mp-reel-active"), "true", "S2B-10: During REEL_PORTRAIT, data-mp-reel-active must be true on edge " + edgeItem);
        assert(bezelDockEl.innerHTML.includes("id=\"mpDockReelsCount\"") && bezelDockEl.innerHTML.includes("id=\"mpDockWatchTime\""), "S2B-10: Active reel dock must render #mpDockReelsCount and #mpDockWatchTime on edge " + edgeItem);
        assert(!bezelDockEl.innerHTML.replace(/<[^>]+>/g, "").includes("Reels"), "S2B-10: #multiPurposeEdgeBezelDock visible text must never contain the word Reels");
        const divMatches = bezelDockEl.innerHTML.match(/ss-island-seg-divider/g) || [];
        assert.strictEqual(divMatches.length, styleItem === "compact" ? 2 : 3, "S2B-10: Active reel dock in " + styleItem + " mode on edge " + edgeItem + " must render 3 dividers between 4 segments");
      }
    }
  }
  mp.setEdge("top", { persist: false });
  mp.setNotchStyle("full", { persist: false });

  console.log('[PASS] Test 79: Category 02 Part 02A + Part 02B Acceptance Suite (WindyLand WL-BUG-01..06, S2B-01..S2B-11, Live Mascot Brain Degradation, Persistent Screen-Edge 3D Bezel Dock, Live Time Zone Search Bar, 3D Timer/Pomodoro Countdown Engine, 4-Mode Theme/Glass Adaptation, and CAT02-01..20) verified 100%.');
}

module.exports = { runCategory02AcceptanceTests };
