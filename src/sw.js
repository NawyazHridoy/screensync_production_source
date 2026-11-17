'use strict';

// Legacy cache purged on activate: "screensync-pwa-cache-v26", "screensync-pwa-cache-v27", "screensync-pwa-cache-v33", "screensync-pwa-cache-v34"
const CACHE_PREFIX = "screensync-pwa-cache-";
const CACHE_NAME = "screensync-pwa-cache-v35";
const CACHE_BUILD_STAMP = "screensync-pwa-cache-v3.5.0-b35";
const APP_VERSION = "3.5.0";
const NAV_NETWORK_TIMEOUT_MS = 3000;
const ASSET_NETWORK_TIMEOUT_MS = 1200;
const MAX_RUNTIME_CACHE_ENTRIES = 60;

const CORE_PRECACHE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./config/screensync.config.json"
];

const PRECACHE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./privacy_policy.html",
  "./terms_of_service.html",
  "./config/screensync.config.json",
  "./config/oem_profiles.json",
  "./config/accessibility_supported_apps.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon-180.png",
  "./icons/favicon-32.png"
];

function trimRuntimeCache(cache, maxEntries = MAX_RUNTIME_CACHE_ENTRIES) {
  if (!cache || typeof cache.keys !== "function") return Promise.resolve();
  return cache.keys().then((keys) => {
    if (!Array.isArray(keys) || keys.length <= maxEntries) return;
    const excess = keys.slice(0, keys.length - maxEntries);
    return Promise.all(excess.map((k) => cache.delete(k)));
  }).catch(() => {});
}

function fetchWithTimeout(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("SW_NETWORK_TIMEOUT"));
      }
    }, timeoutMs);
    fetch(request).then(
      (resp) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve(resp);
        }
      },
      (err) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(err);
        }
      }
    );
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        const corePromise = typeof cache.addAll === "function"
          ? cache.addAll(CORE_PRECACHE_ASSETS).catch(() =>
              Promise.allSettled(CORE_PRECACHE_ASSETS.map((url) => cache.add(url)))
            )
          : Promise.allSettled(CORE_PRECACHE_ASSETS.map((url) => cache.add(url)));
        return corePromise.then(() =>
          Promise.allSettled(
            PRECACHE_ASSETS.map((url) =>
              cache.add(url).then(
                () => ({ url, ok: true }),
                (err) => ({ url, ok: false, error: String((err && err.message) || err) })
              )
            )
          ).then((settled) => {
            const failedUrls = settled
              .map((item) => (item && item.value ? item.value : null))
              .filter((v) => v && v.ok === false)
              .map((v) => v.url);
            if (failedUrls.length > 0 && self.clients && typeof self.clients.matchAll === "function") {
              self.clients
                .matchAll({ type: "window", includeUncontrolled: true })
                .then((clientList) => {
                  clientList.forEach((client) => {
                    client.postMessage({
                      type: "SCREENSYNC_PRECACHE_INCOMPLETE",
                      failedUrls
                    });
                  });
                })
                .catch(() => {});
            }
          })
        );
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME && String(key).startsWith(CACHE_PREFIX)) {
              return caches.delete(key);
            }
            return Promise.resolve();
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (!req || req.method !== "GET") return;

  const urlStr = req.url || "";
  if (
    urlStr.includes("127.0.0.1:19540") ||
    urlStr.includes("127.0.0.1:17935") ||
    urlStr.includes("127.0.0.1:3001") ||
    urlStr.includes("127.0.0.1:8788") ||
    urlStr.includes("localhost:19540") ||
    urlStr.includes("localhost:17935") ||
    urlStr.includes("localhost:3001") ||
    urlStr.includes("localhost:8788") ||
    urlStr.includes("[::1]:19540") ||
    urlStr.includes("[::1]:17935") ||
    urlStr.includes("[::1]:3001") ||
    urlStr.includes("[::1]:8788") ||
    urlStr.includes("/api/") ||
    urlStr.includes("supabase.co")
  ) {
    return;
  }

  const isNav = req.mode === "navigate";
  const isConfigJson = urlStr.includes("/config/") && urlStr.endsWith(".json");
  const timeoutMs = isNav ? NAV_NETWORK_TIMEOUT_MS : (isConfigJson ? ASSET_NETWORK_TIMEOUT_MS : NAV_NETWORK_TIMEOUT_MS);
  const cacheKey = isNav ? "./index.html" : req;

  event.respondWith(
    fetchWithTimeout(req, timeoutMs)
      .then((networkResp) => {
        if (networkResp && networkResp.ok) {
          if (urlStr.startsWith("http")) {
            const clone = networkResp.clone();
            const cacheWritePromise = caches.open(CACHE_NAME)
              .then((cache) => cache.put(cacheKey, clone).then(() => trimRuntimeCache(cache)))
              .catch(() => {});
            if (typeof event.waitUntil === "function") {
              event.waitUntil(cacheWritePromise);
            }
          }
          return networkResp;
        }
        return caches.match(req, { ignoreSearch: true }).then((cachedResp) => {
          if (cachedResp) return cachedResp;
          if (isNav) {
            return caches.match("./index.html", { ignoreSearch: true }).then((idxResp) => idxResp || networkResp);
          }
          return networkResp;
        });
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then((cachedResp) => {
          if (cachedResp) return cachedResp;
          if (isNav) {
            return caches.match("./index.html", { ignoreSearch: true });
          }
          return new Response("Offline", { status: 503, statusText: "Offline" });
        })
      )
  );
});

self.addEventListener("sync", (event) => {
  if (event && event.tag === "screensync-background-sync") {
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
        clientList.forEach((client) => {
          client.postMessage({ type: "SCREENSYNC_TRIGGER_BACKGROUND_SYNC", tag: event.tag });
        });
      })
    );
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event && event.data ? event.data.json() : {};
  } catch (_e) {
    try {
      payload = { notification: { title: "ScreenSync", body: event.data.text() } };
    } catch (_e2) {
      payload = {};
    }
  }
  const notif = payload.notification || {};
  const data = payload.data || {};
  const title = notif.title || data.title || "ScreenSync";
  const body = notif.body || data.body || "New ScreenSync update available.";
  const surveyId = data.survey_id || "";
  const surveyUrl = data.survey_url || data.url || "";
  const notifType = data.type || (surveyId || surveyUrl ? "research_survey" : "");
  const targetUrl = surveyUrl || "./";
  const surveyPayload = {
    type: notifType,
    survey_id: surveyId,
    survey_url: surveyUrl,
    url: targetUrl,
    title,
    body
  };
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body,
        icon: "./icons/icon-192.png",
        badge: "./icons/favicon-32.png",
        data: surveyPayload
      }),
      self.clients && typeof self.clients.matchAll === "function" && (surveyId || surveyUrl)
        ? self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
            clientList.forEach((client) => {
              client.postMessage({ type: "SCREENSYNC_RESEARCH_SURVEY_PUSH", payload: surveyPayload });
            });
          }).catch(() => {})
        : Promise.resolve()
    ])
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const notifData = (event.notification && event.notification.data) || {};
  const surveyId = notifData.survey_id || "";
  const surveyUrl = notifData.survey_url || notifData.url || "";
  let targetUrl = "./";
  if (surveyId && surveyUrl) {
    targetUrl = "./?survey_id=" + encodeURIComponent(surveyId) + "&survey_url=" + encodeURIComponent(surveyUrl);
  } else if (notifData.url) {
    targetUrl = notifData.url;
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (surveyId || surveyUrl) {
          try {
            client.postMessage({ type: "SCREENSYNC_RESEARCH_SURVEY_PUSH", payload: notifData });
          } catch (_e) {}
        }
        if ("focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return null;
    })
  );
});

self.addEventListener("message", (event) => {
  if (event && event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
