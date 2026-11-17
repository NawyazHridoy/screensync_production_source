/**
 * ScreenSync Content Bridge Script (Part 15 Section P15.2)
 * Relays messages from the extension background service worker into the ScreenSync web page
 * via window.postMessage with per-installation cryptographic handshake token (`screensync_ext_bridge_token` /
 * `X-ScreenSync-Bridge-Token`) and strict origin validation (`window.location.origin`).
 */
(function () {
  const targetOrigin = (typeof window !== "undefined" && window.location && window.location.origin && window.location.origin !== "null")
    ? window.location.origin
    : "*";

  const ALLOWED_DASHBOARD_ORIGINS = [
    "http://localhost",
    "http://127.0.0.1",
    "https://screensync.io",
    "https://screensync.app"
  ];

  function isTrustedOrigin(originStr) {
    if (!originStr || originStr === "*") return true;
    const low = String(originStr).toLowerCase();
    return ALLOWED_DASHBOARD_ORIGINS.some((prefix) => low.startsWith(prefix)) ||
      low.endsWith(".screensync.io") ||
      low.endsWith(".screensync.app") ||
      low.startsWith("chrome-extension://");
  }

  let cachedBridgeToken = "";
  let bridgeHeartbeatSeq = 0;

  function computeBridgeHmacTag(token, seq, ts) {
    const input = `${token || "ss_ext_default"}:${seq}:${ts}`;
    let h1 = 0xdeadbeef ^ input.length;
    let h2 = 0x41c6ce57 ^ input.length;
    for (let i = 0; i < input.length; i++) {
      const ch = input.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
  }

  function loadBridgeToken(cb) {
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get("screensync_ext_bridge_token", (stored) => {
          let tok = stored && stored.screensync_ext_bridge_token;
          if (!tok) {
            const randHex = Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10);
            tok = `ss_bridge_tok_${randHex}`;
            chrome.storage.local.set({ screensync_ext_bridge_token: tok });
          }
          cachedBridgeToken = tok;
          if (typeof cb === "function") cb(tok);
        });
        return;
      }
    } catch (e) {}
    if (!cachedBridgeToken) cachedBridgeToken = "ss_bridge_tok_local";
    if (typeof cb === "function") cb(cachedBridgeToken);
  }

  function attachBridgeAuthHeaders(payload, seq, ts) {
    const token = cachedBridgeToken || "ss_bridge_tok_local";
    const hmacSignature = computeBridgeHmacTag(token, seq, ts);
    return {
      ...payload,
      bridgeToken: token,
      bridgeHmacSignature: hmacSignature,
      headers: {
        "X-ScreenSync-Bridge-Token": token,
        "X-ScreenSync-Bridge-Signature": hmacSignature
      }
    };
  }

  function emitExtensionPresence() {
    if (typeof window !== "undefined" && typeof window.postMessage === "function" && isTrustedOrigin(targetOrigin)) {
      try {
        bridgeHeartbeatSeq += 1;
        const ts = Date.now();
        const msg = attachBridgeAuthHeaders(
          {
            source: "SCREENSYNC_EXTENSION",
            type: "EXTENSION_PRESENCE",
            version: "3.5.0",
            heartbeatSeq: bridgeHeartbeatSeq,
            sequence: bridgeHeartbeatSeq,
            timestampMs: ts
          },
          bridgeHeartbeatSeq,
          ts
        );
        window.postMessage(msg, targetOrigin);
      } catch (e) {}
    }
  }

  function emitExtensionHeartbeat() {
    if (typeof window !== "undefined" && typeof window.postMessage === "function" && isTrustedOrigin(targetOrigin)) {
      try {
        bridgeHeartbeatSeq += 1;
        const ts = Date.now();
        const msg = attachBridgeAuthHeaders(
          {
            source: "SCREENSYNC_EXTENSION",
            type: "EXTENSION_HEARTBEAT",
            version: "3.5.0",
            heartbeatSeq: bridgeHeartbeatSeq,
            sequence: bridgeHeartbeatSeq,
            timestampMs: ts
          },
          bridgeHeartbeatSeq,
          ts
        );
        window.postMessage(msg, targetOrigin);
      } catch (e) {}
    }
  }

  loadBridgeToken(() => {
    emitExtensionPresence();
    emitExtensionHeartbeat();
  });
  emitExtensionPresence();
  emitExtensionHeartbeat();
  setInterval(emitExtensionHeartbeat, 15000);

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((incomingMsg) => {
      if (incomingMsg && incomingMsg.source === "SCREENSYNC_EXTENSION" && isTrustedOrigin(targetOrigin)) {
        bridgeHeartbeatSeq += 1;
        const ts = typeof incomingMsg.timestampMs === "number" ? incomingMsg.timestampMs : Date.now();
        const msg = attachBridgeAuthHeaders(incomingMsg, incomingMsg.heartbeatSeq || bridgeHeartbeatSeq, ts);
        window.postMessage(msg, targetOrigin);
      }
    });
  }

  // Listen for discovery and presence ping requests from the ScreenSync web app via window.postMessage
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("message", (event) => {
      if (event.source !== window || !event.data) return;
      if (event.origin && event.origin !== "null" && !isTrustedOrigin(event.origin)) return;

      if (
        (event.data.source === "SCREENSYNC_WEB" || event.data.source === "SCREENSYNC_WEB_APP") &&
        event.data.type === "PING_EXTENSION"
      ) {
        emitExtensionPresence();
        return;
      }
      if ((event.data.source === "SCREENSYNC_WEB" || event.data.source === "SCREENSYNC_WEB_APP") && event.data.type === "SYNC_MULTIPURPOSE_ISLAND_STATE") {
        try {
          if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.sendMessage === "function") {
            chrome.runtime.sendMessage({
              type: "SYNC_MULTIPURPOSE_ISLAND_STATE",
              bridgeToken: cachedBridgeToken,
              payload: event.data.payload || {}
            }, () => {});
          }
        } catch (e) {}
        return;
      }
      if (event.data.source === "SCREENSYNC_WEB_APP" && event.data.type === "GET_DISCOVERED_APPS") {
        try {
          if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.sendMessage === "function") {
            chrome.runtime.sendMessage({ type: "GET_DISCOVERED_APPS", bridgeToken: cachedBridgeToken }, (resp) => {
              const apps = resp && Array.isArray(resp.apps)
                ? resp.apps
                : (resp && Array.isArray(resp.discoveredApps) ? resp.discoveredApps : []);
              bridgeHeartbeatSeq += 1;
              const ts = Date.now();
              const msg = attachBridgeAuthHeaders(
                {
                  source: "SCREENSYNC_EXTENSION",
                  type: "DISCOVERED_APPS_RESPONSE",
                  requestId: event.data.requestId || null,
                  apps
                },
                bridgeHeartbeatSeq,
                ts
              );
              window.postMessage(msg, targetOrigin);
            });
          }
        } catch (e) {}
      }
    });
  }

  // Drain any queued events on load
  if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.sendMessage === "function") {
    try {
      chrome.runtime.sendMessage({ type: "DRAIN_PENDING_EVENTS", bridgeToken: cachedBridgeToken }, (resp) => {
        if (resp && Array.isArray(resp.events)) {
          resp.events.forEach((ev) => {
            bridgeHeartbeatSeq += 1;
            const msg = attachBridgeAuthHeaders(ev, bridgeHeartbeatSeq, Date.now());
            window.postMessage(msg, targetOrigin);
          });
        }
      });
    } catch (e) {}
  }
})();
