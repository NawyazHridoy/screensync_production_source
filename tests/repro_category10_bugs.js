/*
 * repro_category10_bugs.js  -  companion to gemini_argon_category10_audit_and_fix_prompt.md (PART 3.2)
 *
 * What it is: the first 343 lines of tests/run_all_tests.js (the project's own harness: mocked DOM + the real
 * inline script from www/index.html, exposing window.ScreenSyncApp) followed by 31 reproduction cases and 2 info probes
 * that call the REAL FocusModeController / StreaksAndChallengesEngine / ScreenSyncWellnessEngine / SupabaseSyncEngine /
 * GoalAlertSyncEngine / DataExportBackupManager.
 *
 * How to use: copy this file into the repository's tests/ folder, then run   node tests/repro_category10_bugs.js
 * Untouched snapshot: "31/31 cases reproduced". After the fixes every case must print REPRODUCED=false;
 * turn each case into a permanent assertion in tests/run_all_tests.js.
 *
 * Limits: timers are mocked by the harness (setInterval is a no-op, setTimeout runs immediately), so this proves
 * what the code does, not how a real WebView/Android device behaves. AuthService.login(...) usually returns
 * ACCOUNT_NOT_FOUND outside the full suite, so the script uses the local device user and signs in temporarily
 * (withAuth) only for the history/stat UI cases.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const htmlPath = path.join(__dirname, '..', 'www', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

console.log('=== ScreenSync Automated Verification Suite ===');

// -------------------------------------------------------------------------
// TEST 1: STATIC UI & REMOVED FEATURES VERIFICATION (Requirements 1, 2, 4, 5, 6, 7)
// -------------------------------------------------------------------------
const removedUiStrings = [
  'Register New Device to Account',
  'inputNewDeviceName',
  'selectNewDeviceCutout',
  'btnRegisterNewDevice',
  '+ Register Device',
  'Sync Across Devices Now',
  'btnTriggerCloudSync',
  'Multi-Device Sync Verification',
  'btnCycleActiveReelApp',
  'Switch App',
  'Set Lock',
  'appLockModal',
  'btnLockApp',
  'lockSetupContainer',
  'lockVerifyContainer',
  'statusClock',
  'floatingActiveAppBanner',
  'floatingCutoutShapeBadge',
  'floatingActiveAppText',
  'islandActiveDot'
];

for (const s of removedUiStrings) {
  assert(!html.includes(s), `Removed UI element/string still present in HTML: "${s}"`);
}
console.log('[PASS] Test 1: Manual Device Registration UI, Manual Sync Button, Sync Verification UI, Manual Switch App UI, Set Lock UI/Dialogs, and Simulated Status Bar elements are completely removed.');

// Verify Dynamic Island contains ONLY #hudReelsCount, #islandCutoutDivider, and #hudWatchTime
const islandPillMatch = html.match(/<div id="dynamicIslandPill"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
assert(islandPillMatch, 'Could not locate #dynamicIslandPill markup');
const islandInnerHtml = islandPillMatch[0];
assert(islandInnerHtml.includes('id="hudReelsCount"'), 'Missing #hudReelsCount inside Dynamic Island');
assert(islandInnerHtml.includes('id="islandCutoutDivider"'), 'Missing #islandCutoutDivider inside Dynamic Island');
assert(islandInnerHtml.includes('id="hudWatchTime"'), 'Missing #hudWatchTime inside Dynamic Island');
assert(!islandInnerHtml.includes('<svg'), 'No extra SVG icon allowed inside Dynamic Island');
console.log('[PASS] Test 2: Dynamic Island markup contains ONLY Reels Count and Reels Watch Time separated by the adaptive divider/cutout spacer.');

// -------------------------------------------------------------------------
// BOOT APPLICATION SCRIPT IN LIGHTWEIGHT DOM SANDBOX
// -------------------------------------------------------------------------
class MockClassList {
  constructor(el, initial = '') {
    this.el = el;
    this.set = new Set(String(initial || '').split(/\s+/).filter(Boolean));
  }
  add(...tokens) {
    tokens.forEach((t) => this.set.add(t));
    this.el._className = Array.from(this.set).join(' ');
  }
  remove(...tokens) {
    tokens.forEach((t) => this.set.delete(t));
    this.el._className = Array.from(this.set).join(' ');
  }
  contains(t) {
    return this.set.has(t);
  }
  syncFromClassName(cn) {
    this.set = new Set(String(cn || '').split(/\s+/).filter(Boolean));
  }
}

const elementsById = new Map();
const allElements = [];

class MockElement {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this._className = '';
    this.classList = new MockClassList(this);
    this.textContent = '';
    this._innerHTML = '';
    this.value = '';
    this.checked = false;
    this.dataset = {};
    this.style = { setProperty() {} };
    this.attributes = {};
    this.children = [];
    this.listeners = {};
    this.offsetWidth = 100;
  }
  get className() {
    return this._className;
  }
  set className(val) {
    this._className = String(val || '');
    this.classList.syncFromClassName(this._className);
  }
  get innerHTML() {
    return this._innerHTML;
  }
  set innerHTML(val) {
    this._innerHTML = String(val || '');
    this.children = [];
    if (this.id !== 'unlocksBarChart' && this.id !== 'faqAccordionList' && (!this.id || !this.id.startsWith('wheelNotif'))) return;
    const childRegex = /<([a-zA-Z0-9]+)\s+([^>]*?)>/g;
    let cm;
    while ((cm = childRegex.exec(this._innerHTML)) !== null) {
      const cTag = cm[1];
      const cAttr = cm[2];
      const cIdM = cAttr.match(/\bid="([^"]+)"/);
      const cClsM = cAttr.match(/\bclass="([^"]+)"/);
      const cId = cIdM ? cIdM[1] : '';
      const cCls = cClsM ? cClsM[1] : '';
      const childEl = cId && elementsById.has(cId) ? elementsById.get(cId) : new MockElement(cTag, cId);
      childEl.listeners = {};
      if (cCls) childEl.className = cCls;
      const dMatches = cAttr.matchAll(/\b(data-[a-z0-9-]+|aria-[a-z0-9-]+)="([^"]*)"/g);
      for (const dm of dMatches) {
        childEl.setAttribute(dm[1], dm[2]);
      }
      if (cId) elementsById.set(cId, childEl);
      this.children.push(childEl);
      if ((this.id === 'unlocksBarChart' || this.id === 'faqAccordionList') && !allElements.includes(childEl)) allElements.push(childEl);
    }
  }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k === 'id') {
      this.id = String(v);
      elementsById.set(this.id, this);
    }
    if (k === 'class') {
      this.className = String(v);
    }
  }
  getAttribute(k) {
    return this.attributes[k] !== undefined ? this.attributes[k] : null;
  }
  contains(target) {
    return target === this;
  }
  addEventListener(type, fn) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(fn);
  }
  dispatchEvent(evt) {
    const fns = this.listeners[evt.type] || [];
    fns.forEach((fn) => fn.call(this, Object.assign({ target: this, stopPropagation() {}, preventDefault() {} }, evt)));
  }
  click() {
    this.dispatchEvent({ type: 'click' });
  }
  focus() {
    documentMock.activeElement = this;
    this.dispatchEvent({ type: 'focus' });
  }
  select() {}
  querySelectorAll(sel) {
    if (!sel) return this.children;
    const clsAttrMatch = sel.match(/^\.([a-zA-Z0-9_-]+)\[([a-zA-Z0-9_-]+)="([^"]*)"\]$/);
    if (clsAttrMatch) {
      const [, cls, attr, val] = clsAttrMatch;
      return this.children.filter((e) => e.classList.contains(cls) && e.getAttribute(attr) === val);
    }
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      return this.children.filter((e) => e.classList.contains(cls));
    }
    if (sel.startsWith('[') && sel.endsWith(']')) {
      const attr = sel.slice(1, -1);
      return this.children.filter((e) => e.getAttribute(attr) !== null);
    }
    return [];
  }
}

const tagRegex = /<([a-zA-Z0-9]+)\s+([^>]*?)>/g;
let m;
while ((m = tagRegex.exec(html)) !== null) {
  const tag = m[1];
  const attrStr = m[2];
  const idMatch = attrStr.match(/\bid="([^"]+)"/);
  const classMatch = attrStr.match(/\bclass="([^"]+)"/);
  const valMatch = attrStr.match(/\bvalue="([^"]*)"/);
  const id = idMatch ? idMatch[1] : '';
  const cls = classMatch ? classMatch[1] : '';
  if (id || cls) {
    const el = new MockElement(tag, id);
    el.className = cls;
    if (valMatch) el.value = valMatch[1];
    const dataMatches = attrStr.matchAll(/\b(data-[a-z0-9-]+|aria-[a-z0-9-]+|autocomplete|inputmode|pattern|maxlength|type|name)="([^"]*)"/g);
    if (/\bchecked\b/.test(attrStr)) el.checked = true;
    for (const dm of dataMatches) {
      el.setAttribute(dm[1], dm[2]);
    }
    if (id) elementsById.set(id, el);
    allElements.push(el);
  }
}

class StorageMock {
  constructor() {
    this.map = new Map();
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

const localStorageMock = new StorageMock();
const rootHtmlMock = new MockElement('html', 'htmlRoot');
const bodyMock = new MockElement('body', 'bodyRoot');
const documentMock = {
  documentElement: rootHtmlMock,
  body: bodyMock,
  readyState: 'complete',
  visibilityState: 'visible',
  fullscreenElement: null,
  webkitFullscreenElement: null,
  listeners: {},
  getElementById(id) {
    if (!elementsById.has(id)) {
      const fallback = new MockElement('div', id);
      elementsById.set(id, fallback);
    }
    return elementsById.get(id);
  },
  querySelector(sel) {
    if (sel === '#deviceDropdownMenu [data-device="ALL"]') {
      return allElements.find((e) => e.getAttribute('data-device') === 'ALL') || new MockElement('button');
    }
    if (sel === '#statsDeviceDropdownMenu [data-stats-device="ALL"]') {
      return allElements.find((e) => e.getAttribute('data-stats-device') === 'ALL') || new MockElement('button');
    }
    const checkedRadioMatch = sel.match(/^input\[name="([^"]+)"\]:checked$/);
    if (checkedRadioMatch) {
      return allElements.find((e) => e.tagName === 'INPUT' && e.getAttribute('name') === checkedRadioMatch[1] && e.checked) || null;
    }
    return new MockElement('div');
  },
  querySelectorAll(sel) {
    const inputNameMatch = sel.match(/^input\[name="([^"]+)"\]$/);
    if (inputNameMatch) {
      return allElements.filter((e) => e.tagName === 'INPUT' && e.getAttribute('name') === inputNameMatch[1]);
    }
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      return allElements.filter((e) => e.classList.contains(cls));
    }
    if (sel.startsWith('[') && sel.endsWith(']')) {
      const attr = sel.slice(1, -1);
      if (attr === 'data-unlocks-pillar' && elementsById.has('unlocksBarChart')) {
        return elementsById.get('unlocksBarChart').children.filter((e) => e.getAttribute(attr) !== null);
      }
      return allElements.filter((e) => e.getAttribute(attr) !== null);
    }
    return [];
  },
  addEventListener(type, fn) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(fn);
  },
  dispatchEvent(evt) {
    const fns = this.listeners[evt.type] || [];
    fns.forEach((fn) => fn(evt));
  }
};

const windowMock = {
  document: documentMock,
  localStorage: localStorageMock,
  navigator: {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15',
    platform: 'iPhone',
    maxTouchPoints: 5,
    onLine: true
  },
  screen: { width: 393, height: 852 },
  innerWidth: 393,
  innerHeight: 852,
  listeners: {},
  addEventListener(type, fn) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(fn);
  },
  dispatchEvent(evt) {
    const fns = this.listeners[evt.type] || [];
    fns.forEach((fn) => fn(evt));
  },
  setInterval: () => 1,
  clearInterval: () => {},
  setTimeout: (fn) => { fn(); return 1; }
};

const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
assert(scriptMatch, 'Could not locate <script> block in www/index.html');

const sandbox = {
  window: windowMock,
  document: documentMock,
  localStorage: localStorageMock,
  navigator: windowMock.navigator,
  setInterval: windowMock.setInterval,
  clearInterval: windowMock.clearInterval,
  setTimeout: windowMock.setTimeout,
  clearTimeout: () => {},
  Date,
  Math,
  JSON,
  Object,
  Array,
  String,
  Number,
  Boolean,
  Set,
  Map,
  RegExp,
  parseInt,
  parseFloat,
  isNaN,
  console
};

vm.createContext(sandbox);
vm.runInContext(scriptMatch[1], sandbox);
windowMock.dispatchEvent({ type: 'DOMContentLoaded' });

const app = windowMock.ScreenSyncApp;
assert(app, 'window.ScreenSyncApp must be exposed');

// =============================================================================================
// CATEGORY 10 BUG REPRODUCTION — executes the REAL src app code through the project's own harness
// (everything above this line is copied verbatim from tests/run_all_tests.js up to the point where
//  window.ScreenSyncApp becomes available). Place this file in tests/ and run: node tests/repro_category10_bugs.js
// Each case prints REPRODUCED=true when the defect described in the audit is observed at runtime.
// =============================================================================================
const REPRO = [];
function repro(id, title, fn) {
  try { const r = fn(); REPRO.push({ id, title, reproduced: !!r.reproduced, observed: r.observed }); }
  catch (e) { REPRO.push({ id, title, reproduced: null, observed: 'SCRIPT ERROR: ' + String((e && e.message) || e).slice(0, 220) }); }
}
const FM = app.FocusModeController, SA = app.StreaksAndChallengesEngine, WE = app.ScreenSyncWellnessEngine, DB = app.BackendDB, SYNC = app.SupabaseSyncEngine, st = app.state;
app.AuthService.login('rahim.ahmed@gmail.com', 'password123'); // may return ACCOUNT_NOT_FOUND outside the full suite; then the app uses the local device user
const UID = app.getActiveOrLocalUserId();
DB.ensureUserStructures(UID);
const TODAY = app.getTodayLocalDateStr();
const shiftDays = (ds, n) => { const [y, m, d] = ds.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const focusList = () => DB.data.focusSessionsByUser[UID] || (DB.data.focusSessionsByUser[UID] = []);
const resetFocus = () => { try { FM.cancelCountdown(); } catch (_) {} focusList().length = 0; st.focusTotalMinutes = 0; st.focusTotalSessions = 0; };
const mkFocus = (d, mins = 30) => ({ sessionId: 'rp_' + d, userId: UID, localDate: d, dateDisplay: d, startTimeIso: d + 'T09:00:00.000Z', endTimeIso: d + 'T09:30:00.000Z', plannedMinutes: mins, completedMinutes: mins, status: 'COMPLETED' });
const clearEvents = () => { DB.data.sessionsByUser[UID] = []; DB.data.reelEventsByUser[UID] = []; };
// renderFocusHistoryUI() only renders for an authenticated user (see F41-B06), so history/stat probes sign in temporarily:
const withAuth = (fn) => { const b = { a: st.isAuthenticated, u: st.currentUser }; st.isAuthenticated = true; st.currentUser = { userId: UID, name: 'Repro', email: 'repro@example.com' }; try { return fn(); } finally { st.isAuthenticated = b.a; st.currentUser = b.u; } };

repro('F40-B01', 'Complete Early credits the FULL planned duration', () => {
  resetFocus(); FM.setDuration(180); FM.startCountdown(180); FM.tick(1);
  const done = FM.completeSession(); const rec = focusList()[0] || {};
  return { reproduced: done.completedMinutes === 180, observed: `plan=180 min, elapsed=1 s -> completedMinutes=${done.completedMinutes}, status=${rec.status}, state.focusTotalMinutes=${st.focusTotalMinutes}` };
});

repro('F40-B02', 'Countdown never reads the wall clock (tick-counted)', () => {
  resetFocus(); FM.setDuration(30); FM.startCountdown(30);
  const realNow = Date.now; const t0 = realNow.call(Date); Date.now = () => t0 + 10 * 60 * 1000;
  if (typeof FM.reconcile === 'function') FM.reconcile(); else FM.tick(0); // ask the controller to look at the clock (reconcile() in a fixed build)
  const remaining = st.focusCountdownRemainingSeconds; Date.now = realNow; FM.cancelCountdown();
  return { reproduced: remaining > 1500, observed: `wall clock +10 min, controller asked to refresh -> remaining=${remaining}s (a timestamp-based timer reports about 1200s)` };
});

repro('F40-B03', 'Duration can be changed in the middle of a session and changes the credit', () => {
  resetFocus(); FM.setDuration(20); FM.startCountdown(20);
  const edit = FM.setDuration(180); FM.tick(20 * 60 - 1); const done = FM.completeSession();
  return { reproduced: edit.ok === true && done.completedMinutes === 180, observed: `setDuration(180) while active -> ok=${edit.ok}; after 19m59s of a 20-min session completeSession credited ${done.completedMinutes} min` };
});

repro('F40-B04', 'Starting twice silently overwrites the running session', () => {
  resetFocus(); FM.setDuration(30); const a = FM.startCountdown(30); const id1 = FM.activeSessionId; FM.tick(300);
  const n0 = focusList().length; const b = FM.startCountdown(25); const id2 = FM.activeSessionId; const n1 = focusList().length; FM.cancelCountdown();
  return { reproduced: b.ok === true && id1 !== id2 && n1 === n0, observed: `2nd start ok=${b.ok}; sessionId ${id1} -> ${id2}; history rows written for the abandoned session: ${n1 - n0}` };
});

repro('F40-B08', 'Session localDate = latest DATA day, not today', () => {
  const cutoff = shiftDays(TODAY, -3);
  ['sessionsByUser', 'reelEventsByUser'].forEach((k) => { DB.data[k][UID] = (DB.data[k][UID] || []).filter((r) => !r.localDate || r.localDate <= cutoff); });
  DB.data.sessionsByUser[UID].push({ sessionId: 'old1', userId: UID, localDate: cutoff, durationMinutes: 10, screenMinutesDelta: 10 });
  resetFocus(); const ref = app.resolveUserReferenceDate(UID);
  FM.setDuration(20); FM.startCountdown(20); FM.tick(20 * 60); const rec = focusList()[0] || {};
  return { reproduced: ref !== TODAY && rec.localDate === ref, observed: `today=${TODAY}; resolveUserReferenceDate=${ref}; saved localDate=${rec.localDate}; saved dateDisplay="${rec.dateDisplay}"` };
});

repro('F40-B09', 'Focus totals are counters: deleting history does not change them', () => {
  resetFocus(); FM.setDuration(30); FM.startCountdown(30); FM.tick(30 * 60);
  const counterBefore = st.focusTotalMinutes; focusList().length = 0; withAuth(() => FM.renderFocusHistoryUI());
  const ui = documentMock.getElementById('focusTotalMinsText').textContent;
  return { reproduced: counterBefore === 30 && st.focusTotalMinutes === 30 && focusList().length === 0, observed: `after deleting all sessions: list=${focusList().length}, state.focusTotalMinutes=${st.focusTotalMinutes}, UI text="${ui}"` };
});

repro('F40-B10', 'Cloud merge: 0 -> 30 min, missing status -> COMPLETED, counters via Math.max (100+100 -> 100)', () => {
  resetFocus();
  focusList().push(Object.assign(mkFocus(TODAY, 100), { sessionId: 'L1' }));
  DB.data.settingsByUser[UID] = Object.assign({}, DB.data.settingsByUser[UID] || {}, { focusTotalMinutes: 100, focusTotalSessions: 1, updatedAt: '2026-01-01T00:00:00.000Z' });
  const remote = {
    settings: { user_id: UID, focus_total_minutes: 100, focus_total_sessions: 1, client_updated_at: '2026-10-30T00:00:00.000Z' },
    focusSessions: [
      { user_id: UID, session_id: 'R1', local_date: TODAY, start_time_iso: TODAY + 'T10:00:00.000Z', end_time_iso: TODAY + 'T11:40:00.000Z', planned_minutes: 100, completed_minutes: 100, status: 'COMPLETED' },
      { user_id: UID, session_id: 'R2', local_date: TODAY, planned_minutes: 30, completed_minutes: 0, status: 'INTERRUPTED' },
      { user_id: UID, session_id: 'R3', local_date: null, planned_minutes: 30, completed_minutes: null, status: null }
    ]
  };
  SYNC.mergeRemoteRecordsIntoLocal(UID, remote);
  const by = Object.fromEntries(focusList().map((s) => [s.sessionId, s]));
  const sumCompleted = focusList().filter((s) => s.status === 'COMPLETED').reduce((a, s) => a + s.completedMinutes, 0);
  const counter = (DB.data.settingsByUser[UID] || {}).focusTotalMinutes;
  const ok = by.R2 && by.R2.completedMinutes === 30 && by.R3 && by.R3.status === 'COMPLETED' && by.R3.completedMinutes === 30 && counter === 100 && sumCompleted > counter;
  return { reproduced: !!ok, observed: `R2(source completed=0) -> ${by.R2 && by.R2.completedMinutes} min; R3(source status=null, minutes=null, date=null) -> status=${by.R3 && by.R3.status}, ${by.R3 && by.R3.completedMinutes} min, localDate=${by.R3 && by.R3.localDate}; merged counter=${counter} vs sum of COMPLETED in list=${sumCompleted}` };
});

repro('F41-B02', 'Growth XP: 15 XP baseline with zero activity; stage reachable by streak alone', () => {
  const zero = WE.computeFocusTreeStage(0, 0, 0), streakOnly = WE.computeFocusTreeStage(0, 0, 14);
  return { reproduced: zero.xp === 15 && streakOnly.level >= 3, observed: `(0 min, 0 sessions, 0-day streak) -> ${zero.label}; (0 min, 0 sessions, 14-day streak) -> ${streakOnly.label}` };
});

repro('F44-B01a', 'Streak ignores gap days (focus on today-40, today-30, today-1)', () => {
  clearEvents(); DB.data.focusSessionsByUser[UID] = [mkFocus(shiftDays(TODAY, -40)), mkFocus(shiftDays(TODAY, -30)), mkFocus(shiftDays(TODAY, -1))];
  const s = SA.computeStreakSummary(UID);
  return { reproduced: s.currentStreakDays >= 3, observed: `gaps of 9 and 28 days -> currentStreakDays=${s.currentStreakDays}, longestStreakDays=${s.longestStreakDays}` };
});

repro('F44-B01b', 'An old streak survives weeks of inactivity', () => {
  clearEvents(); DB.data.focusSessionsByUser[UID] = [mkFocus(shiftDays(TODAY, -60)), mkFocus(shiftDays(TODAY, -59)), mkFocus(shiftDays(TODAY, -58))];
  const s = SA.computeStreakSummary(UID);
  return { reproduced: s.currentStreakDays === 3, observed: `3 consecutive days that ended 58 days ago, nothing since -> currentStreakDays=${s.currentStreakDays}` };
});

repro('F44-B03', 'Zero data still reports a 1-day streak; flag unrecordedDaysHandledHonestly is a literal true', () => {
  clearEvents(); DB.data.focusSessionsByUser[UID] = []; DB.data.achievementsByUser[UID] = {};
  const s = SA.computeStreakSummary(UID);
  return { reproduced: s.currentStreakDays === 1 && s.unrecordedDaysHandledHonestly === true, observed: `no data at all -> currentStreakDays=${s.currentStreakDays}, longestStreakDays=${s.longestStreakDays}, recordedDaysCount=${s.recordedDaysCount}, unrecordedDaysHandledHonestly=${s.unrecordedDaysHandledHonestly}` };
});

repro('F44-B02', 'OR rule: one focus session rescues a day with 15 h of screen time', () => {
  const d = shiftDays(TODAY, -1);
  DB.data.sessionsByUser[UID] = [{ sessionId: 'big1', userId: UID, localDate: d, durationMinutes: 900, screenMinutesDelta: 900, startTimeIso: d + 'T01:00:00.000Z', endTimeIso: d + 'T16:00:00.000Z' }];
  DB.data.reelEventsByUser[UID] = []; DB.data.focusSessionsByUser[UID] = [mkFocus(d)];
  const s = SA.computeStreakSummary(UID); const ev = (s.perDateEvaluation || {})[d];
  return { reproduced: s.currentStreakDays >= 1, observed: `screen goal=${st.screenGoalMinutes} min, day has 900 min + 1 focus session -> currentStreakDays=${s.currentStreakDays}; perDateEvaluation=${JSON.stringify(ev)}` };
});

repro('F44-B05', 'Achievements are mutated as a side effect of a compute call', () => {
  clearEvents(); DB.data.focusSessionsByUser[UID] = [mkFocus(shiftDays(TODAY, -1), 60)]; DB.data.achievementsByUser[UID] = {};
  const before = Object.keys(DB.data.achievementsByUser[UID]).length; SA.computeStreakSummary(UID);
  const keys = Object.keys(DB.data.achievementsByUser[UID]);
  const shown = ['streak_starter', 'first_focus', 'deep_focus_60'];
  return { reproduced: before === 0 && keys.length > 0, observed: `unlocked keys before=${before}, after one compute=${JSON.stringify(keys)}; badges the UI can render=${JSON.stringify(shown)}; unlocked-but-hidden=${JSON.stringify(keys.filter((k) => !shown.includes(k)))}` };
});

repro('F43-B03', 'Same day, different tier depending on which caller computes it', () => {
  const a = WE.computeBrainDegradationState(30), b = WE.computeBrainDegradationState(30, 200, 60);
  return { reproduced: a.tierKey !== b.tierKey, observed: `30 reels: reels-only call -> ${a.tierKey}; same reels with 200 watch-min and a 60-min goal -> ${b.tierKey}` };
});

repro('F43-B01', 'Banner says Overloaded at 300 reels but the trajectory graph is identical to the 200-reel graph', () => {
  const tier = WE.evaluateDailyReelTier(300, 0, 60); const g200 = String(WE.buildTrajectoryCurveSvg(200)), g300 = String(WE.buildTrajectoryCurveSvg(300));
  return { reproduced: tier.tierKey === 'OVERLOADED_500' && g200 === g300, observed: `evaluateDailyReelTier(300) -> ${tier.tierKey} "${tier.tierBadge}"; graph(200)==graph(300): ${g200 === g300}` };
});

repro('F43-B05', 'Trajectory curve is a fixed path (identical for 0 and 450 reels) and every call builds a huge SVG', () => {
  const p = (s) => (String(s).match(/\sd="([^"]+)"/g) || []).join('|'); const s0 = String(WE.buildTrajectoryCurveSvg(0)), s450 = String(WE.buildTrajectoryCurveSvg(450));
  return { reproduced: p(s0) === p(s450) && s0.length > 100000, observed: `path data identical: ${p(s0) === p(s450)}; SVG string length per call: ${s0.length} chars (inline base64 images)` };
});

repro('F43-B04', 'Milestone popup state is memory-only: a "restart" fires the same milestone again', () => {
  WE.shownMilestonesByDate = {}; WE.lastEvaluatedReelsCount = 0;
  const first = WE.checkAndTriggerMilestoneOverlay(137);
  const persisted = [...localStorageMock.map.values()].some((v) => /milestone/i.test(v));
  WE.shownMilestonesByDate = {}; WE.lastEvaluatedReelsCount = 0; // exactly what a cold start looks like
  const second = WE.checkAndTriggerMilestoneOverlay(137);
  return { reproduced: !!(first.triggered && second.triggered && !persisted), observed: `cold start @137 reels -> milestone ${first.milestoneReached}; after restart -> triggered again: ${second.triggered}; any milestone key persisted in storage: ${persisted}` };
});


// ---------------------------------------------------------------------------------------------
// ROUND 2 CASES (additional runtime evidence)
// ---------------------------------------------------------------------------------------------
const PROBES = [];
function probe(id, title, fn) { try { PROBES.push({ id, title, observed: fn() }); } catch (e) { PROBES.push({ id, title, observed: 'SCRIPT ERROR: ' + String((e && e.message) || e).slice(0, 200) }); } }
const GAE = app.GoalAlertSyncEngine;

repro('F40-B03b', 'UI badge shows the edited duration instead of the running session plan', () => {
  resetFocus(); FM.setDuration(20); FM.startCountdown(20); FM.setDuration(180); FM.syncCountdownUI();
  const badge = documentMock.getElementById('focusCountdownStateBadge').textContent; FM.cancelCountdown();
  return { reproduced: /180m/.test(badge), observed: `session started as 20 min; after touching the slider the badge reads "${badge}"` };
});

repro('F40-B13', 'Celestial position does not follow the countdown tick', () => {
  const el = documentMock.getElementById('focusHeroCelestial');
  resetFocus(); FM.setDuration(30); FM.startCountdown(30); WE.renderScreenSyncAndFocusTreeUI();
  const cy0 = el.getAttribute('cy'); FM.tick(900); const cyTick = el.getAttribute('cy');
  SA.renderStreaksAndChallengesUI(); const cyRender = el.getAttribute('cy'); FM.cancelCountdown();
  return { reproduced: cy0 === cyTick && cyRender !== cyTick, observed: `cy at start=${cy0}; after 15 of 30 minutes of ticks=${cyTick}; after renderStreaksAndChallengesUI()=${cyRender}` };
});

repro('F40-B13b', 'data-focus-stage receives the long label because stageKey is never returned', () => {
  WE.renderScreenSyncAndFocusTreeUI(); const attr = documentMock.getElementById('focusHeroSceneCard').getAttribute('data-focus-stage');
  return { reproduced: /Lv\./.test(String(attr)), observed: `data-focus-stage="${attr}"` };
});

repro('F40-B14', 'The in-progress session is written to storage on every tick', () => {
  resetFocus(); FM.setDuration(30); FM.startCountdown(30);
  let writes = 0; const orig = localStorageMock.setItem.bind(localStorageMock);
  localStorageMock.setItem = (k, v) => { if (k === FM.ACTIVE_FOCUS_STORAGE_KEY) writes += 1; return orig(k, v); };
  for (let i = 0; i < 10; i++) FM.tick(1);
  localStorageMock.setItem = orig; FM.cancelCountdown();
  return { reproduced: writes >= 10, observed: `10 ticks (10 s) -> ${writes} writes; HEARTBEAT_INTERVAL_MS=${FM.HEARTBEAT_INTERVAL_MS} is never consulted` };
});

repro('F40-B15', 'History renders only 8 rows and injects dateDisplay as raw HTML', () => {
  resetFocus(); const payload = '<img src=x onerror=alert(1)>';
  for (let i = 0; i < 12; i++) focusList().push(Object.assign(mkFocus(shiftDays(TODAY, -i), 25), { sessionId: 'h' + i, dateDisplay: i === 0 ? payload : 'Day ' + i }));
  withAuth(() => FM.renderFocusHistoryUI()); const html = String(documentMock.getElementById('focusHistoryList').innerHTML || '');
  const rows = (html.match(/Day \d+|<img src=x/g) || []).length;
  return { reproduced: rows === 8 && html.includes(payload), observed: `12 sessions stored -> ${rows} rendered; raw <img onerror> present in innerHTML: ${html.includes(payload)}` };
});

repro('F41-B01', 'Total Days shows 1 when there are zero sessions', () => {
  resetFocus(); withAuth(() => FM.renderFocusHistoryUI()); const days = documentMock.getElementById('focusTotalDaysText').textContent;
  return { reproduced: /^\s*1\b/.test(String(days)), observed: `no sessions -> focusTotalDaysText="${days}"` };
});

repro('F41-B06', 'History and stats are hidden for the local (unauthenticated) user although sessions are recorded for it', () => {
  resetFocus(); FM.setDuration(20); FM.startCountdown(20); FM.tick(20 * 60);
  const b = { a: st.isAuthenticated, u: st.currentUser }; st.isAuthenticated = false; st.currentUser = null;
  FM.renderFocusHistoryUI(); const html = String(documentMock.getElementById('focusHistoryList').innerHTML || ''); st.isAuthenticated = b.a; st.currentUser = b.u;
  return { reproduced: /Sign in to view/.test(html) && focusList().length === 1, observed: `1 completed session stored for the local user; the history area shows: "${html.replace(/<[^>]+>/g, '').trim()}"` };
});

repro('F40-B09b', 'Backup restore brings sessions back but not the totals', () => {
  resetFocus(); focusList().push(Object.assign(mkFocus(TODAY, 60), { sessionId: 'b1' }));
  const snap = app.DataExportBackupManager.createBackupSnapshot(UID);
  focusList().length = 0; st.focusTotalMinutes = 0; st.focusTotalSessions = 0;
  const res = app.DataExportBackupManager.restoreBackupSnapshot(UID, snap.json);
  const sum = focusList().filter((s) => s.status === 'COMPLETED').reduce((a, s) => a + s.completedMinutes, 0);
  return { reproduced: sum === 60 && st.focusTotalMinutes === 0, observed: `restore ok=${res.ok}; sessions in list=${focusList().length} (${sum} min) but state.focusTotalMinutes=${st.focusTotalMinutes}` };
});

repro('F42-B01', 'Goal alerts never mark anything as ignored', () => {
  st.screenGoalIgnoredToday = false; st.goalIgnoredToday = false;
  GAE.renderSystemLevelAlertHost({ eventId: 'e_ign_1', goalType: 'SCREEN_TIME_GOAL', usedMinutes: 300, goalMinutes: 200 }, []);
  const store = JSON.stringify(DB.data.goalReachedEventsByUser[UID] || {});
  return { reproduced: st.screenGoalIgnoredToday === false && st.goalIgnoredToday === false && !/ignor/i.test(store), observed: `alert shown and auto-hidden by its 5 s timer -> screenGoalIgnoredToday=${st.screenGoalIgnoredToday}, goalIgnoredToday=${st.goalIgnoredToday}, "ignored" field in stored alert events: ${/ignor/i.test(store)}` };
});

repro('F43-B02', 'Brain score ignores watch minutes and completed focus sessions (and has no fast-skip / late-night input)', () => {
  const base = WE.computeBrainDegradationState(100, 0, 60), heavy = WE.computeBrainDegradationState(100, 900, 60);
  resetFocus(); for (let i = 0; i < 5; i++) focusList().push(mkFocus(TODAY, 30));
  const afterFocus = WE.computeBrainDegradationState(100, 0, 60);
  return { reproduced: base.vitalityPct === heavy.vitalityPct && base.vitalityPct === afterFocus.vitalityPct, observed: `100 reels: vitality=${base.vitalityPct}% | with 900 watch-min: ${heavy.vitalityPct}% | after 5 completed focus sessions: ${afterFocus.vitalityPct}%` };
});

repro('F44-B04', '"Weekly" challenge is completed by sessions from 80-90 days ago', () => {
  clearEvents(); DB.data.achievementsByUser[UID] = {};
  DB.data.focusSessionsByUser[UID] = [mkFocus(shiftDays(TODAY, -90), 30), mkFocus(shiftDays(TODAY, -80), 30)];
  const s = SA.computeStreakSummary(UID); const ch = s.challenges || [];
  const c = ch.find((x) => /focus_sessions/.test(String(x.id)));
  const done = c && (c.completed === true || c.isCompleted === true || Number(c.progress) >= Number(c.target || 2));
  return { reproduced: !!done, observed: `no activity this week -> ${JSON.stringify(ch.map((x) => ({ id: x.id, progress: x.progress, target: x.target, completed: x.completed })))}` };
});

repro('F44-B06', 'computeStreakSummary runs more than once per render and its cost grows faster than linearly with history', () => {
  const build = (N) => { clearEvents(); const evs = [], fs = []; for (let i = 0; i < N; i++) { const d = shiftDays(TODAY, -i); for (let k = 0; k < 4; k++) evs.push({ sessionId: 's' + i + '_' + k, userId: UID, localDate: d, durationMinutes: 30, screenMinutesDelta: 30 }); fs.push(mkFocus(d, 30)); } DB.data.sessionsByUser[UID] = evs; DB.data.focusSessionsByUser[UID] = fs; };
  const time = (N) => { build(N); const t0 = process.hrtime.bigint(); SA.computeStreakSummary(UID); return Number(process.hrtime.bigint() - t0) / 1e6; };
  time(60); const a = time(365), b = time(1095);
  build(30); let calls = 0; const orig = SA.computeStreakSummary; SA.computeStreakSummary = function (...x) { calls += 1; return orig.apply(this, x); }; SA.renderStreaksAndChallengesUI(); SA.computeStreakSummary = orig;
  return { reproduced: calls >= 2, observed: `computeStreakSummary calls during ONE renderStreaksAndChallengesUI(): ${calls}; timing (informational, machine-dependent): 365 days ${a.toFixed(1)} ms, 1095 days ${b.toFixed(1)} ms (x${(b / a).toFixed(1)} for 3x data)` };
});

repro('F40-B18', 'Distraction Guard flags only the few known social/entertainment apps; browsers and unknown apps are exempt', () => {
  resetFocus(); FM.setDuration(30); FM.startCountdown(30);
  const keys = ['instagram', 'tiktok', 'youtube', 'whatsapp', 'chrome', 'safari', 'reddit', 'netflix', 'telegram'];
  const res = Object.fromEntries(keys.map((k) => [k, FM.isDistractingAppDuringFocus(k)])); FM.cancelCountdown();
  return { reproduced: res.instagram === true && res.chrome === false && res.safari === false && res.reddit === false && res.netflix === false, observed: JSON.stringify(res) };
});

repro('X-05', 'The magic test-user id short-circuits the authentication and ownership checks of the production ingestion path', () => {
  const b = { a: st.isAuthenticated, u: st.currentUser };
  const mk = (uid, id) => ({ eventId: id, userId: uid, installationKey: 'inst_x5', appKey: 'instagram', reelCountDelta: 1 });
  st.isAuthenticated = true; st.currentUser = { userId: 'usr_real_user', name: 'Real User' };
  const other = DB.ingestEvent(mk('usr_someone_else', 'x5_a')), magic = DB.ingestEvent(mk('usr_automated_test_sandbox', 'x5_b'));
  st.isAuthenticated = false; st.currentUser = null;
  const unauthOther = DB.ingestEvent(mk('usr_someone_else', 'x5_c')), unauthMagic = DB.ingestEvent(mk('usr_automated_test_sandbox', 'x5_d'));
  st.isAuthenticated = b.a; st.currentUser = b.u;
  return { reproduced: other.status === 'OWNERSHIP_VIOLATION' && magic.status !== 'OWNERSHIP_VIOLATION' && unauthOther.status === 'UNAUTHENTICATED' && unauthMagic.status !== 'UNAUTHENTICATED', observed: `signed in as another user: ${other.status} vs magic id: ${magic.status}; signed out: ${unauthOther.status} vs magic id: ${unauthMagic.status}` };
});

probe('INFO-1', 'computeSnapshot(ALL, DAY, 0): per-hour arrays available for a real trajectory', () => {
  const snap = app.computeSnapshot('ALL', 'DAY', 0); const a = (v) => Array.isArray(v) ? `array(${v.length})` : typeof v;
  return `reelCountBars=${a(snap.reelCountBars)} reelWatchBars=${a(snap.reelWatchBars)} bars=${a(snap.bars)} bucketMeta=${a(snap.bucketMeta)} (each bucketMeta has startSec/endSec/dateStr/shortLabel/timeSpanLabel) xAxis=${a(snap.xAxis)}`;
});

probe('INFO-2', 'Native bridge payload sent while a focus session is running (focus-related keys only)', () => {
  const payloads = [];
  windowMock.ScreenSyncNativeBridge = { syncAppTimersAndFocusStateJson: (j) => { payloads.push(j); return true; } };
  resetFocus(); FM.setDuration(30); FM.startCountdown(30);
  try { app.syncNativeTimersAndFocusState(); } catch (_) {}
  const running = payloads.map((j) => { try { return JSON.parse(j); } catch (_) { return null; } }).find((o) => o && o.focusActive === true);
  FM.cancelCountdown(); delete windowMock.ScreenSyncNativeBridge;
  if (!running) return `payload not capturable in this harness (${payloads.length} payload(s) seen) — see static evidence at app.js 2477-2517`;
  const fk = Object.keys(running).filter((k) => /focus|distraction/i.test(k));
  return `focus-related keys sent to native: ${JSON.stringify(fk)} -> no session id, no end time, no allow-list (all keys: ${Object.keys(running).length})`;
});

console.log('\n================ CATEGORY 10 — RUNTIME REPRODUCTION RESULTS ================');
REPRO.forEach((r) => console.log(`${r.reproduced === true ? 'REPRODUCED=true ' : r.reproduced === false ? 'REPRODUCED=false' : 'ERROR           '} | ${r.id.padEnd(9)} | ${r.title}\n                   -> ${r.observed}`));
const nTrue = REPRO.filter((r) => r.reproduced === true).length;
PROBES.forEach((p) => console.log(`INFO               | ${p.id.padEnd(9)} | ${p.title}\n                   -> ${p.observed}`));
console.log(`\nSummary: ${nTrue}/${REPRO.length} cases reproduced at runtime, ${REPRO.filter((r) => r.reproduced === false).length} not reproduced, ${REPRO.filter((r) => r.reproduced === null).length} script errors.`);


if (nTrue > 0 || REPRO.some((x) => x.reproduced === null)) { process.exit(1); }
