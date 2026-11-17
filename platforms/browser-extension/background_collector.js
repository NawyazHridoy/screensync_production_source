/**
 * ScreenSync Companion Browser Extension Background Collector (Manifest V3 — Part 15 Section P15.2)
 * - Detects real OS category via chrome.runtime.getPlatformInfo (ChromeOS, Windows, macOS, Linux, Android)
 * - Generates and persists a stable hardware/profile installationId, installationKey, and screensync_ext_bridge_token in chrome.storage.local
 * - Tracks active browser tab eTLD+1 hostnames & short-form video sessions (YouTube Shorts, Instagram Reels/Stories,
 *   TikTok, Facebook Reels/Stories, Messenger Stories, Snapchat Spotlight, X/Twitter video feeds, Reddit Watch)
 * - Enforces 40-item LRU fingerprint deduplication, 300ms scroll settle, 1,200ms continuous dwell, and fast-skip (< 2,500ms) tracking
 * - Exposes live popup dashboard state (`GET_POPUP_LIVE_SUMMARY`, `OPEN_FULL_DASHBOARD`)
 */
const POLL_INTERVAL_SECONDS = 7;
const SCROLL_SETTLE_MS = 300;
const MIN_CONTINUOUS_DWELL_MS = 1200;
const FAST_SKIP_MAX_MS = 2500;
const LRU_MAX_SIGNATURES = 40;

const SHORT_FORM_HOST_RULES = [
  { appKey: "youtube", hostPattern: /(^|\.)(youtube\.com|youtu\.be)$/i, pathPattern: /^\/shorts(\/|$)/i },
  { appKey: "instagram", hostPattern: /(^|\.)instagram\.com$/i, pathPattern: /^\/(reels?|stories)(\/|$)/i },
  { appKey: "tiktok", hostPattern: /(^|\.)tiktok\.com$/i, pathPattern: /^\/(@[^/]+\/video\/|foryou|following|$)/i },
  { appKey: "facebook", hostPattern: /(^|\.)(facebook\.com|fb\.com|fb\.watch)$/i, pathPattern: /^\/(reels?|stories)(\/|$)/i },
  { appKey: "messenger", hostPattern: /(^|\.)messenger\.com$/i, pathPattern: /^\/stories(\/|$)/i },
  { appKey: "snapchat", hostPattern: /(^|\.)snapchat\.com$/i, pathPattern: /^\/spotlight(\/|$)/i },
  { appKey: "x", hostPattern: /(^|\.)(x\.com|twitter\.com)$/i, pathPattern: /^\/(i\/immersive_timeline|.*\/status\/\d+\/video|video)/i },
  { appKey: "reddit", hostPattern: /(^|\.)reddit\.com$/i, pathPattern: /^\/(r\/[^/]+\/watch|watch|video)/i }
];

let heartbeatSequence = 0;
const backgroundLruSignatures = [];

let liveDailySummary = {
  dayKey: new Date().toISOString().slice(0, 10),
  todayScreenSeconds: 0,
  todayReelsCount: 0,
  todayReelWatchSeconds: 0,
  fastSkipCount: 0,
  activeFocusSession: {
    active: false,
    remainingSeconds: 0,
    label: "Ready to Focus"
  },
  bridgeToken: ""
};

function recordBackgroundLruSignature(sig) {
  if (!sig) return false;
  const idx = backgroundLruSignatures.indexOf(sig);
  if (idx !== -1) {
    backgroundLruSignatures.splice(idx, 1);
    backgroundLruSignatures.push(sig);
    return true;
  }
  backgroundLruSignatures.push(sig);
  while (backgroundLruSignatures.length > LRU_MAX_SIGNATURES) {
    backgroundLruSignatures.shift();
  }
  return false;
}

function ensureDailyRollover() {
  const today = new Date().toISOString().slice(0, 10);
  if (liveDailySummary.dayKey !== today) {
    liveDailySummary.dayKey = today;
    liveDailySummary.todayScreenSeconds = 0;
    liveDailySummary.todayReelsCount = 0;
    liveDailySummary.todayReelWatchSeconds = 0;
    liveDailySummary.fastSkipCount = 0;
  }
}

function persistLiveSummaryToStorage() {
  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ ss_ext_live_daily_summary: liveDailySummary });
    }
  } catch (e) {}
}

const MULTI_LABEL_PUBLIC_SUFFIXES = new Set([
  "co.uk", "org.uk", "gov.uk", "ac.uk", "me.uk", "net.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au",
  "co.jp", "ne.jp", "or.jp", "ac.jp", "go.jp",
  "co.in", "net.in", "org.in", "ac.in", "gov.in",
  "co.nz", "net.nz", "org.nz", "govt.nz",
  "co.za", "org.za", "gov.za", "net.za",
  "co.kr", "ne.kr", "or.kr", "go.kr",
  "com.br", "net.br", "org.br", "gov.br",
  "com.mx", "org.mx", "gob.mx",
  "com.cn", "net.cn", "org.cn", "gov.cn",
  "com.sg", "edu.sg", "gov.sg", "org.sg",
  "com.hk", "edu.hk", "gov.hk", "org.hk",
  "com.tw", "org.tw", "gov.tw", "edu.tw",
  "com.bd", "edu.bd", "gov.bd", "org.bd", "net.bd"
]);

function extractRegistrableDomain(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  try {
    const u = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
    const cleanHost = String(u.hostname || "").trim().toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    if (!cleanHost) return null;
    if (cleanHost === "localhost" || /^(\d{1,3}\.){3}\d{1,3}$/.test(cleanHost) || cleanHost.startsWith("[")) return cleanHost;
    if (!cleanHost.includes(".")) return null;
    const labels = cleanHost.split(".").filter(Boolean);
    if (labels.length <= 2) return labels.join(".");
    const lastTwo = `${labels[labels.length - 2]}.${labels[labels.length - 1]}`;
    if (MULTI_LABEL_PUBLIC_SUFFIXES.has(lastTwo) && labels.length >= 3) {
      return `${labels[labels.length - 3]}.${lastTwo}`;
    }
    return lastTwo;
  } catch (e) {
    return null;
  }
}
const syncChannel = typeof BroadcastChannel !== "undefined"
  ? new BroadcastChannel("screensync_cross_platform_sync_v2")
  : null;

let detectedPlatformMeta = {
  osCategory: "ChromeOS",
  deviceCategory: "Chromebook",
  installationId: "inst_cros_ext_default",
  installationKey: "cros_ext_default"
};

let activeTrackedTabSession = null;
const pendingCompanionQueue = [];

function sanitizeShortFormContextUrl(rawUrl, fallbackHost) {
  if (!rawUrl || typeof rawUrl !== "string") return fallbackHost || null;
  try {
    const parsed = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
    const pathname = String(parsed.pathname || "/");
    const isShortFormPath = SHORT_FORM_HOST_RULES.some(
      (r) => r.hostPattern.test(parsed.hostname) && (!r.pathPattern || r.pathPattern.test(pathname))
    );
    if (isShortFormPath) {
      return `${fallbackHost || parsed.hostname}${pathname}`;
    }
  } catch (e) {}
  return fallbackHost || null;
}

function startTrackingUrl(rawUrl, tabId = null) {
  ensureDailyRollover();
  const host = extractRegistrableDomain(rawUrl);
  if (!host) return;
  const inMemoryShortFormUrl = sanitizeShortFormContextUrl(rawUrl, host);
  const nowMs = Date.now();
  if (activeTrackedTabSession && (activeTrackedTabSession.host !== host || activeTrackedTabSession.inMemoryShortFormUrl !== inMemoryShortFormUrl)) {
    flushActiveSession("url_changed");
  }
  if (!activeTrackedTabSession) {
    activeTrackedTabSession = { host, inMemoryShortFormUrl, tabId, startedAtMs: nowMs, lastSeenAtMs: nowMs };
  } else {
    activeTrackedTabSession.lastSeenAtMs = nowMs;
  }
}

function flushActiveSession(reason = "periodic") {
  if (!activeTrackedTabSession) return;
  ensureDailyRollover();
  const nowMs = Date.now();
  const elapsedSec = Math.max(0, Math.round((nowMs - activeTrackedTabSession.startedAtMs) / 1000));
  if (elapsedSec > 0) {
    liveDailySummary.todayScreenSeconds += elapsedSec;
    if (activeTrackedTabSession.inMemoryShortFormUrl && activeTrackedTabSession.inMemoryShortFormUrl !== activeTrackedTabSession.host) {
      liveDailySummary.todayReelWatchSeconds += elapsedSec;
    }
    persistLiveSummaryToStorage();
    pendingCompanionQueue.push({
      host: activeTrackedTabSession.host,
      inMemoryShortFormUrl: activeTrackedTabSession.inMemoryShortFormUrl || activeTrackedTabSession.host,
      elapsedSeconds: elapsedSec,
      reason,
      timestampMs: nowMs
    });
  }
  activeTrackedTabSession = null;
}

function flushQueueToCompanion() {
  while (pendingCompanionQueue.length > 0) {
    const item = pendingCompanionQueue.shift();
    emitToScreenSyncApp({
      source: "SCREENSYNC_EXTENSION",
      type: "EXTENSION_TAB_SAMPLE",
      detail: {
        browserProcessName: "chrome",
        rawAddressBarText: item.inMemoryShortFormUrl || item.host,
        windowTitle: item.host,
        isIdle: false,
        timestampMs: item.timestampMs
      }
    });
  }
}

function mapChromePlatformOs(rawOs) {
  const os = String(rawOs || "").toLowerCase();
  if (os === "cros") return { osCategory: "ChromeOS", deviceCategory: "Chromebook", prefix: "cros" };
  if (os === "win") return { osCategory: "Windows", deviceCategory: "Laptop", prefix: "win" };
  if (os === "mac") return { osCategory: "macOS", deviceCategory: "Laptop", prefix: "mac" };
  if (os === "android") return { osCategory: "Android", deviceCategory: "Phone", prefix: "and" };
  if (os === "linux") return { osCategory: "Linux", deviceCategory: "Laptop", prefix: "linux" };
  return { osCategory: "Windows", deviceCategory: "Laptop", prefix: "win" };
}

function initExtensionPlatformIdentity() {
  try {
    if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.getPlatformInfo === "function") {
      chrome.runtime.getPlatformInfo((info) => {
        const mapped = mapChromePlatformOs(info && info.os);
        if (chrome.storage && chrome.storage.local) {
          chrome.storage.local.get([
            "ss_ext_installation_id",
            "ss_ext_installation_key",
            "screensync_ext_bridge_token",
            "ss_ext_live_daily_summary"
          ], (stored) => {
            let instId = stored && stored.ss_ext_installation_id;
            let instKey = stored && stored.ss_ext_installation_key;
            let bridgeTok = stored && stored.screensync_ext_bridge_token;
            if (!instId || !instKey || !bridgeTok) {
              const randHex = Math.random().toString(16).slice(2, 10).padEnd(8, "0");
              const randTok = Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10);
              instId = instId || `inst_${mapped.prefix}_${randHex}`;
              instKey = instKey || `${mapped.prefix}_${randHex}`;
              bridgeTok = bridgeTok || `ss_bridge_tok_${randTok}`;
              chrome.storage.local.set({
                ss_ext_installation_id: instId,
                ss_ext_installation_key: instKey,
                ss_ext_os_category: mapped.osCategory,
                screensync_ext_bridge_token: bridgeTok
              });
            }
            if (stored && stored.ss_ext_live_daily_summary && stored.ss_ext_live_daily_summary.dayKey === liveDailySummary.dayKey) {
              liveDailySummary = { ...liveDailySummary, ...stored.ss_ext_live_daily_summary };
            }
            liveDailySummary.bridgeToken = bridgeTok;
            detectedPlatformMeta = {
              osCategory: mapped.osCategory,
              deviceCategory: mapped.deviceCategory,
              installationId: instId,
              installationKey: instKey
            };
          });
        }
      });
    }
  } catch (e) {}
}

initExtensionPlatformIdentity();

function isScreenSyncWebAppTabUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return false;
  const lower = rawUrl.toLowerCase();
  return (
    lower.includes("screensync") ||
    lower.startsWith("http://localhost:") ||
    lower.startsWith("http://localhost/") ||
    lower.startsWith("http://127.0.0.1:") ||
    lower.startsWith("http://127.0.0.1/")
  );
}

const DEFAULT_EXTENSION_SYNC_ENDPOINT = "http://127.0.0.1:3001/api/v1/extension/events";
const FALLBACK_EXTENSION_SYNC_ENDPOINT = "http://127.0.0.1:8788/api/v1/extension/events";

function postEventsToLocalCompanionOrSyncServer(eventPayload) {
  if (typeof fetch !== "function" || !eventPayload) return;
  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(["ss_ext_sync_bearer_token", "ss_ext_sync_endpoint", "screensync_ext_bridge_token"], (stored) => {
        const token = stored && stored.ss_ext_sync_bearer_token;
        const bridgeToken = (stored && stored.screensync_ext_bridge_token) || liveDailySummary.bridgeToken || "";
        const endpoint = (stored && stored.ss_ext_sync_endpoint) || DEFAULT_EXTENSION_SYNC_ENDPOINT;
        if (!token) return;
        const reqInit = {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
            "X-ScreenSync-Bridge-Token": bridgeToken
          },
          body: JSON.stringify({
            installationId: detectedPlatformMeta.installationId,
            installationKey: detectedPlatformMeta.installationKey,
            osCategory: detectedPlatformMeta.osCategory,
            events: Array.isArray(eventPayload) ? eventPayload : [eventPayload]
          })
        };
        fetch(endpoint, reqInit).catch(() => {
          if (endpoint === DEFAULT_EXTENSION_SYNC_ENDPOINT) {
            fetch(FALLBACK_EXTENSION_SYNC_ENDPOINT, reqInit).catch(() => {});
          }
        });
      });
    }
  } catch (e) {}
}

function emitToScreenSyncApp(messagePayload) {
  const ts = (messagePayload && messagePayload.detail && typeof messagePayload.detail.timestampMs === "number")
    ? messagePayload.detail.timestampMs
    : (typeof messagePayload.timestampMs === "number" ? messagePayload.timestampMs : Date.now());
  heartbeatSequence += 1;
  const hbToken = `ss_hb_${detectedPlatformMeta.installationId}_${heartbeatSequence}_${ts}`;
  const enriched = {
    ...messagePayload,
    heartbeatSeq: heartbeatSequence,
    sequence: heartbeatSequence,
    heartbeatToken: hbToken,
    bridgeToken: liveDailySummary.bridgeToken || "ss_bridge_tok_local",
    timestampMs: ts,
    osCategory: detectedPlatformMeta.osCategory,
    installationId: detectedPlatformMeta.installationId,
    installationKey: detectedPlatformMeta.installationKey,
    detail: messagePayload.detail ? {
      ...messagePayload.detail,
      heartbeatSeq: heartbeatSequence,
      sequence: heartbeatSequence,
      heartbeatToken: hbToken,
      timestampMs: ts,
      osCategory: detectedPlatformMeta.osCategory,
      deviceCategory: detectedPlatformMeta.deviceCategory,
      installationId: detectedPlatformMeta.installationId,
      installationKey: detectedPlatformMeta.installationKey
    } : undefined
  };
  if (syncChannel) {
    syncChannel.postMessage(enriched);
  }
  postEventsToLocalCompanionOrSyncServer(enriched);
  if (typeof chrome !== "undefined" && chrome.tabs && typeof chrome.tabs.query === "function") {
    chrome.tabs.query({}, (tabs) => {
      (tabs || []).forEach((tab) => {
        if (tab.id && isScreenSyncWebAppTabUrl(tab.url)) {
          chrome.tabs.sendMessage(tab.id, enriched).catch(() => {});
        }
      });
    });
  }
}

function pollActiveBrowserTab() {
  if (typeof chrome === "undefined" || !chrome.tabs || !chrome.idle) return;
  chrome.idle.queryState(300, (idleState) => {
    const isIdle = idleState !== "active";
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const activeTab = tabs && tabs[0];
      if (!activeTab || !activeTab.url) return;
      if (!isIdle) {
        ensureDailyRollover();
        liveDailySummary.todayScreenSeconds += POLL_INTERVAL_SECONDS;
        persistLiveSummaryToStorage();
      }
      emitToScreenSyncApp({
        source: "SCREENSYNC_EXTENSION",
        type: "EXTENSION_TAB_SAMPLE",
        detail: {
          browserProcessName: "chrome",
          rawAddressBarText: activeTab.url,
          windowTitle: activeTab.title || "",
          favIconUrl: activeTab.favIconUrl || null,
          isAudioPlaying: Boolean(activeTab.audible),
          isIdle,
          timestampMs: Date.now()
        }
      });
    });
  });
}


// Pre-Part-15 Task C.3: Research Survey Push Notification & One-Time In-App Overlay Relay
function dispatchExtensionResearchSurveyPush(rawSurveyPayload) {
  if (!rawSurveyPayload || typeof rawSurveyPayload !== "object") return { ok: false, reason: "INVALID_PAYLOAD" };
  const surveyId = String(rawSurveyPayload.survey_id || rawSurveyPayload.surveyId || "").trim();
  const surveyUrl = String(rawSurveyPayload.survey_url || rawSurveyPayload.surveyUrl || rawSurveyPayload.url || "").trim();
  if (!surveyId || !surveyUrl.startsWith("https://")) {
    return { ok: false, reason: "MISSING_SURVEY_ID_OR_HTTPS_URL" };
  }
  const normalizedPayload = {
    type: "research_survey",
    survey_id: surveyId,
    survey_url: surveyUrl,
    url: surveyUrl,
    title: String(rawSurveyPayload.title || "ScreenSync Research Survey"),
    body: String(rawSurveyPayload.body || "Help us improve ScreenSync by completing our quick research survey."),
    cta_label: String(rawSurveyPayload.cta_label || rawSurveyPayload.ctaLabel || "Open Google Form"),
    dismiss_label: String(rawSurveyPayload.dismiss_label || rawSurveyPayload.dismissLabel || "Maybe Later"),
    timestampMs: Date.now()
  };
  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ ss_pending_research_survey_v1: normalizedPayload });
    }
  } catch (e) {}
  emitToScreenSyncApp({
    source: "SCREENSYNC_EXTENSION",
    type: "SCREENSYNC_RESEARCH_SURVEY_PUSH",
    payload: normalizedPayload,
    detail: normalizedPayload
  });
  return { ok: true, payload: normalizedPayload };
}

if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") return false;
    if (message.type === "DRAIN_PENDING_EVENTS") {
      const drained = [];
      while (pendingCompanionQueue.length > 0) {
        const item = pendingCompanionQueue.shift();
        drained.push({
          source: "SCREENSYNC_EXTENSION",
          type: "EXTENSION_TAB_SAMPLE",
          osCategory: detectedPlatformMeta.osCategory,
          installationId: detectedPlatformMeta.installationId,
          installationKey: detectedPlatformMeta.installationKey,
          detail: {
            browserProcessName: "chrome",
            rawAddressBarText: item.inMemoryShortFormUrl || item.host,
            windowTitle: item.host,
            isIdle: false,
            timestampMs: item.timestampMs
          }
        });
      }
      if (typeof sendResponse === "function") {
        sendResponse({
          ok: true,
          events: drained,
          heartbeat: {
            installationId: detectedPlatformMeta.installationId,
            osCategory: detectedPlatformMeta.osCategory,
            timestampMs: Date.now()
          }
        });
      }
      return true;
    }
    if (message.type === "GET_POPUP_LIVE_SUMMARY") {
      ensureDailyRollover();
      if (typeof sendResponse === "function") {
        sendResponse({
          ok: true,
          installationId: detectedPlatformMeta.installationId,
          osCategory: detectedPlatformMeta.osCategory,
          summary: liveDailySummary
        });
      }
      return true;
    }
    if (message.type === "OPEN_FULL_DASHBOARD") {
      if (typeof chrome !== "undefined" && chrome.tabs && typeof chrome.tabs.create === "function" && chrome.runtime && typeof chrome.runtime.getURL === "function") {
        chrome.tabs.create({ url: chrome.runtime.getURL("index.html") });
      }
      if (typeof sendResponse === "function") {
        sendResponse({ ok: true, opened: true });
      }
      return true;
    }
    if (message.type === "GET_DISCOVERED_APPS") {
      const discoveredList = [
        { key: "chrome", name: "Google Chrome", category: "Productivity & finance", supportsReels: false, osCategory: detectedPlatformMeta.osCategory },
        ...SHORT_FORM_HOST_RULES.map((r) => ({
          key: r.appKey,
          name: r.appKey === "youtube" ? "YouTube" : (r.appKey === "tiktok" ? "TikTok" : (r.appKey === "x" ? "X" : r.appKey.charAt(0).toUpperCase() + r.appKey.slice(1))),
          category: (r.appKey === "youtube" || r.appKey === "tiktok") ? "Entertainment" : "Social networking",
          supportsReels: true,
          osCategory: detectedPlatformMeta.osCategory
        }))
      ];
      if (typeof sendResponse === "function") {
        sendResponse({
          ok: true,
          apps: discoveredList,
          discoveredApps: discoveredList
        });
      }
      return true;
    }
    if (message.type === "SYNC_MULTIPURPOSE_ISLAND_STATE") {
      const res = syncMultiPurposeIslandToCompanion(message.payload || {});
      if (typeof sendResponse === "function") sendResponse(res);
      return true;
    }
    if (message.type === "SCREENSYNC_RESEARCH_SURVEY_PUSH" || message.type === " DISPATCH_RESEARCH_SURVEY_PUSH".trim()) {
      const res = dispatchExtensionResearchSurveyPush(message.payload || message.detail || message);
      if (typeof sendResponse === "function") sendResponse(res);
      return true;
    }
    if (message.type === "CONSUME_PENDING_RESEARCH_SURVEY") {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(["ss_pending_research_survey_v1"], (stored) => {
          const pending = (stored && stored.ss_pending_research_survey_v1) || null;
          if (pending) {
            chrome.storage.local.remove(["ss_pending_research_survey_v1"]);
          }
          if (typeof sendResponse === "function") sendResponse({ ok: true, pending });
        });
        return true;
      }
      if (typeof sendResponse === "function") sendResponse({ ok: true, pending: null });
      return true;
    }
    if (message.type === "GET_EXTENSION_STATUS") {
      if (typeof sendResponse === "function") {
        sendResponse({
          ok: true,
          status: "ACTIVE",
          installationId: detectedPlatformMeta.installationId,
          installationKey: detectedPlatformMeta.installationKey,
          osCategory: detectedPlatformMeta.osCategory,
          queuedEventsCount: pendingCompanionQueue.length,
          timestampMs: Date.now()
        });
      }
      return true;
    }
    if (
      message.type === "EXTENSION_SHORT_FORM_SIGNAL" ||
      message.type === "SHORT_FORM_DOM_SIGNAL" ||
      message.type === "SCREENSYNC_SHORTFORM_VIEW_SCROLLED" ||
      message.type === "SHORTFORM_REEL_SCROLL_EVENT" ||
      message.type === "SHORTFORM_CONTENT_HEARTBEAT"
    ) {
      ensureDailyRollover();
      const detailObj = message.detail || {
        eventType: "TYPE_VIEW_SCROLLED",
        isShortFormSurface: true,
        explicitSignature: message.reelId || "",
        timestampMs: message.timestampMs || Date.now()
      };
      const sig = detailObj.explicitSignature || "";
      const isDuplicate = sig ? recordBackgroundLruSignature(sig) : false;
      if (detailObj.isFastSkip) {
        liveDailySummary.fastSkipCount += 1;
      }
      if (detailObj.dwellQualified && !isDuplicate && !detailObj.isOverlaySheetOpen) {
        liveDailySummary.todayReelsCount += 1;
        liveDailySummary.todayReelWatchSeconds += Math.round((detailObj.continuousDwellMs || MIN_CONTINUOUS_DWELL_MS) / 1000);
        persistLiveSummaryToStorage();
      }
      emitToScreenSyncApp({
        source: "SCREENSYNC_EXTENSION",
        type: "EXTENSION_SHORT_FORM_SIGNAL",
        detail: {
          ...detailObj,
          isDuplicateInBackgroundLru: isDuplicate,
          timestampMs: detailObj.timestampMs || Date.now()
        }
      });
      if (typeof sendResponse === "function") sendResponse({ ok: true, duplicate: isDuplicate });
    }
    return true;
  });
}

setInterval(pollActiveBrowserTab, POLL_INTERVAL_SECONDS * 1000);


// Pass 4 Task 2: 30-Day Historical Browser & ChromeOS Usage Backfill via chrome.history
async function backfillHistoricalBrowserUsage30Days(daysBack = 30) {
  const safeDays = Math.max(1, Math.min(30, Number(daysBack) || 30));
  if (typeof chrome === "undefined" || !chrome.history || typeof chrome.history.search !== "function") {
    return { ok: false, status: "HISTORY_API_UNAVAILABLE", days: [] };
  }
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
  const startTime = todayMidnight - safeDays * 86400000;
  return new Promise((resolve) => {
    chrome.history.search({ text: "", startTime, endTime: todayMidnight, maxResults: 10000 }, (items) => {
      const byDate = {};
      (items || []).forEach((it) => {
        if (!it || !it.url || !it.lastVisitTime) return;
        const host = extractRegistrableDomain(it.url);
        if (!host) return;
        const d = new Date(it.lastVisitTime);
        const dateStr = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
        if (!byDate[dateStr]) byDate[dateStr] = {};
        const appKey = SHORT_FORM_HOST_RULES.some(r => r.hostPattern.test(host))
          ? SHORT_FORM_HOST_RULES.find(r => r.hostPattern.test(host)).appKey
          : "chrome";
        byDate[dateStr][appKey] = (byDate[dateStr][appKey] || 0) + Math.min(15, Math.max(1, Number(it.visitCount || 1)));
      });
      const days = Object.entries(byDate).map(([localDate, appMap]) => ({
        localDate,
        unlocks: null,
        entries: Object.entries(appMap).map(([appKey, visits]) => ({
          appKey,
          visitCount: visits,
          durationMinutes: 0,
          historyVisitOnly: true,
          aggregateOnly: true
        }))
      }));
      resolve({ ok: true, osCategory: detectedPlatformMeta.osCategory || "ChromeOS", daysBack: safeDays, days });
    });
  });
}

if (typeof chrome !== "undefined" && chrome.alarms) {
  try {
    chrome.alarms.create("screensync_active_tab_poll", { periodInMinutes: 0.5 });
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm && alarm.name === "screensync_active_tab_poll") {
        chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
          if (tabs && tabs[0] && tabs[0].url) {
            startTrackingUrl(tabs[0].url, tabs[0].id);
          } else {
            flushActiveSession("idle_or_minimized");
          }
        });
        flushQueueToCompanion();
      }
    });
  } catch (e) {}
}


// WL-BUG-06 & Section S2.2: Multi-Purpose Dynamic Island Local Companion Sync (http://127.0.0.1:19540)
const MULTIPURPOSE_ISLAND_ALLOWED_OS = new Set(["Windows", "ChromeOS", "Linux"]);
const MULTIPURPOSE_ISLAND_COMPANION_URL = "http://127.0.0.1:19540/api/v1/island/state";

function syncMultiPurposeIslandToCompanion(payload = {}) {
  if (!MULTIPURPOSE_ISLAND_ALLOWED_OS.has(detectedPlatformMeta.osCategory)) {
    return { ok: false, reason: "OS_NOT_SUPPORTED", osCategory: detectedPlatformMeta.osCategory };
  }
  if (typeof fetch === "function") {
    try {
      fetch(MULTIPURPOSE_ISLAND_COMPANION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          osCategory: detectedPlatformMeta.osCategory,
          installationId: detectedPlatformMeta.installationId,
          ...payload,
          timestampMs: Date.now()
        })
      }).catch(() => {});
    } catch (e) {}
  }
  return { ok: true, osCategory: detectedPlatformMeta.osCategory };
}
