/**
 * ScreenSync Short-Form Web Observer Content Script (Part 15 Section P15.2)
 * Runs on YouTube Shorts (youtube.com/shorts/*), Instagram Reels (instagram.com/reels/*),
 * TikTok (tiktok.com/*), Facebook Reels (facebook.com/reel/*), Messenger Stories,
 * Snapchat Spotlight, X/Twitter video feeds, and Reddit video feeds.
 *
 * Implements:
 * - Explicit `let lastScrollReportMs = 0;` declaration (fixes EXT-01 ReferenceError)
 * - Unified `SHORT_FORM_DOM_SIGNAL` message emission
 * - 300ms scroll-settle debounce (`SCROLL_SETTLE_MS = 300`)
 * - 1,200ms continuous-dwell qualification (`MIN_CONTINUOUS_DWELL_MS = 1200`)
 * - Fast-skip detection (`< 2,500ms`, `FAST_SKIP_MAX_MS = 2500`)
 * - 40-item LRU fingerprint deduplication (`LRU_MAX_SIGNATURES = 40`)
 * - IntersectionObserver + MutationObserver + comment/share overlay drawer suppression
 */
(function () {
  const SCROLL_SETTLE_MS = 300;
  const MIN_CONTINUOUS_DWELL_MS = 1200;
  const FAST_SKIP_MAX_MS = 2500;
  const LRU_MAX_SIGNATURES = 40;

  let lastReportedPath = "";
  let lastActiveVideoSig = "";
  let scrollSeq = 0;
  let lastScrollReportMs = 0;
  let wheelSettleTimer = null;
  let dwellQualificationTimer = null;
  let currentItemEnteredAtMs = Date.now();
  let currentCandidateSignature = "";
  let fastSkipCount = 0;
  let qualifiedReelCount = 0;
  let activeIntersectedVideo = null;
  let activeIntersectRatio = 0;
  const observedVideos = typeof WeakSet !== "undefined" ? new WeakSet() : null;
  const lruSignatureList = [];

  function checkAndRecordLruSignature(signature) {
    if (!signature) return false;
    const existingIdx = lruSignatureList.indexOf(signature);
    if (existingIdx !== -1) {
      lruSignatureList.splice(existingIdx, 1);
      lruSignatureList.push(signature);
      return true; // Duplicate within 40-item LRU window
    }
    lruSignatureList.push(signature);
    while (lruSignatureList.length > LRU_MAX_SIGNATURES) {
      lruSignatureList.shift();
    }
    return false;
  }

  const VOLATILE_METRIC_COUNTER_REGEX = /\b\d+(?:[.,]\d+)*(?:\s*[KMBkmb]\b|\s*(?:likes?|comments?|views?|shares?|reposts?|saves?|plays?|watch(?:es|ing)?|followers?|reactions?)\b)|\b\d+\s*(?:s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|month|months|y|yr|yrs|year|years)\s+ago\b|\b\d+\s*(?:s|sec|secs|m|min|mins|h|hr|hrs|d|w|mo|yr|yrs)\b(?=\s*•|\s*$|\s+ago)|\b(?:just\s+now|yesterday)\b|\b\d{1,3}(?:,\d{3})+\b/gi;

  function normalizeCaptionSnippet(rawText) {
    if (!rawText || typeof rawText !== "string") return "";
    const trimmed = rawText.trim();
    if (/^\d+(?:[.,]\d+)*[KMBkmb]?$/.test(trimmed)) return "#";
    return trimmed
      .replace(VOLATILE_METRIC_COUNTER_REGEX, "#")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 64);
  }

  function detectPlatformFromHost(host) {
    const h = String(host || "").toLowerCase();
    if (h.includes("youtube.com") || h.includes("youtu.be")) return "youtube";
    if (h.includes("instagram.com")) return "instagram";
    if (h.includes("tiktok.com")) return "tiktok";
    if (h.includes("facebook.com") || h.includes("fb.com") || h.includes("fb.watch")) return "facebook";
    if (h.includes("messenger.com")) return "messenger";
    if (h.includes("snapchat.com")) return "snapchat";
    if (h === "x.com" || h.endsWith(".x.com") || h.includes("twitter.com")) return "x";
    if (h.includes("reddit.com")) return "reddit";
    return null;
  }

  const videoIntersectionObserver = typeof IntersectionObserver !== "undefined"
    ? new IntersectionObserver((entries) => {
        let bestVideo = null;
        let bestRatio = 0;
        for (const entry of entries) {
          if (entry && entry.isIntersecting && entry.intersectionRatio >= 0.55) {
            if (entry.intersectionRatio >= bestRatio) {
              bestRatio = entry.intersectionRatio;
              bestVideo = entry.target;
            }
          } else if (entry && entry.target === activeIntersectedVideo && !entry.isIntersecting) {
            activeIntersectedVideo = null;
            activeIntersectRatio = 0;
          }
        }
        if (bestVideo) {
          activeIntersectedVideo = bestVideo;
          activeIntersectRatio = bestRatio;
        }
      }, { threshold: [0.55, 0.75] })
    : null;

  function observeVideoElements() {
    if (!videoIntersectionObserver || typeof document === "undefined" || typeof document.querySelectorAll !== "function") {
      return;
    }
    const videos = document.querySelectorAll("video");
    videos.forEach((v) => {
      if (v && (!observedVideos || !observedVideos.has(v))) {
        if (observedVideos) observedVideos.add(v);
        try {
          videoIntersectionObserver.observe(v);
        } catch (e) {}
      }
    });
  }

  function findActiveViewportVideoInfo() {
    if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") {
      return { sig: "", isPlaying: false, isFullScreenVertical: false };
    }
    observeVideoElements();
    const vh = Math.max(1, Number((typeof window !== "undefined" && window.innerHeight) || 800));
    if (activeIntersectedVideo && typeof activeIntersectedVideo.getBoundingClientRect === "function") {
      const r = activeIntersectedVideo.getBoundingClientRect();
      if (r.height > 180 && r.bottom > 80 && r.top < vh * 0.85) {
        const src = activeIntersectedVideo.currentSrc || activeIntersectedVideo.src || activeIntersectedVideo.getAttribute("data-video-id") || activeIntersectedVideo.getAttribute("poster") || `vid_${Math.round(activeIntersectedVideo.duration || 0)}`;
        const isPlaying = !activeIntersectedVideo.paused && !activeIntersectedVideo.ended;
        const isFullScreenVertical = (r.height / vh) >= 0.55 || activeIntersectRatio >= 0.55;
        return { sig: String(src || ""), isPlaying, isFullScreenVertical };
      }
    }
    const videos = Array.from(document.querySelectorAll("video"));
    for (const v of videos) {
      if (!v || typeof v.getBoundingClientRect !== "function") continue;
      const r = v.getBoundingClientRect();
      if (r.height > 180 && r.bottom > 80 && r.top < vh * 0.85) {
        const src = v.currentSrc || v.src || v.getAttribute("data-video-id") || v.getAttribute("poster") || `vid_${Math.round(v.duration || 0)}`;
        const isPlaying = !v.paused && !v.ended;
        const isFullScreenVertical = (r.height / vh) >= 0.55;
        return { sig: String(src || ""), isPlaying, isFullScreenVertical };
      }
    }
    return { sig: "", isPlaying: false, isFullScreenVertical: false };
  }

  function detectWebCommentOrShareOverlay() {
    if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return false;
    const vh = Math.max(1, Number((typeof window !== "undefined" && window.innerHeight) || 800));
    const vw = Math.max(1, Number((typeof window !== "undefined" && window.innerWidth) || 1280));
    const selectors = [
      "[role=\"dialog\"]",
      "ytd-engagement-panel-section-list-renderer[target-id=\"engagement-panel-comments-section\"]",
      "[data-e2e=\"browse-comment-list\"]",
      "[data-testid=\"sheetDialog\"]"
    ];
    for (const sel of selectors) {
      const nodes = document.querySelectorAll(sel);
      for (const node of nodes) {
        if (!node || typeof node.getBoundingClientRect !== "function") continue;
        const r = node.getBoundingClientRect();
        if (r.height >= vh * 0.35 && r.width >= vw * 0.35 && r.bottom > 0 && r.top < vh) {
          return true;
        }
      }
    }
    return false;
  }

  const detectOverlaySheetOpen = detectWebCommentOrShareOverlay;

  function isShortFormSurfaceActive(appKey, path, videoInfo) {
    const p = String(path || "").toLowerCase();
    // youtube.com/shorts/*, instagram.com/reels/*, facebook.com/reel/*, snapchat.com/spotlight*
    if (
      p === "/shorts" ||
      p.startsWith("/shorts/") ||
      p === "/reels" ||
      p.startsWith("/reels/") ||
      p === "/reel" ||
      p.startsWith("/reel/") ||
      p.startsWith("/stories/") ||
      p.startsWith("/spotlight") ||
      (appKey === "instagram" && /^\/@?[^/]+\/video\//.test(p))
    ) {
      return true;
    }
    // tiktok.com/*
    if (appKey === "tiktok") {
      if (p.includes("/video/") || p.startsWith("/foryou") || p.startsWith("/following")) return true;
      if ((p === "/" || p.startsWith("/@")) && videoInfo && (videoInfo.isFullScreenVertical || videoInfo.isPlaying || Boolean(videoInfo.sig))) {
        return true;
      }
      return false;
    }
    // x.com / twitter.com video feeds
    if (appKey === "x") {
      if (p.startsWith("/i/immersive_timeline") || /\/status\/\d+\/video/.test(p) || p.startsWith("/video")) {
        return true;
      }
      if (videoInfo && videoInfo.isFullScreenVertical && videoInfo.isPlaying) {
        return true;
      }
      return false;
    }
    // reddit.com video feeds
    if (appKey === "reddit") {
      if (p.startsWith("/watch") || p.includes("/watch/") || /^\/r\/[^/]+\/watch/.test(p) || p.startsWith("/video/")) {
        return true;
      }
      if (videoInfo && videoInfo.isFullScreenVertical && videoInfo.isPlaying) {
        return true;
      }
      return false;
    }
    return false;
  }

  function dispatchShortFormSignalToBackground(detailPayload) {
    if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.sendMessage === "function") {
      try {
        chrome.runtime.sendMessage({
          type: "SHORT_FORM_DOM_SIGNAL",
          detail: detailPayload
        });
      } catch (e) {}
    }
  }

  function emitShortFormSignal(eventType, explicitNavToken = "") {
    const appKey = detectPlatformFromHost(location.hostname);
    if (!appKey) return;
    const path = String(location.pathname || "").toLowerCase();
    const videoInfo = findActiveViewportVideoInfo();
    const isShortFormPath = isShortFormSurfaceActive(appKey, path, videoInfo);
    const isOverlaySheetOpen = detectOverlaySheetOpen();

    if (!isShortFormPath && eventType === "TYPE_VIEW_SCROLLED") return;

    const nowMs = Date.now();
    const videoSig = normalizeCaptionSnippet(videoInfo.sig);
    const isNewItemTransition = Boolean(
      path !== lastReportedPath ||
      (videoSig && videoSig !== lastActiveVideoSig) ||
      explicitNavToken
    );

    let previousItemDwellMs = 0;
    let isFastSkip = false;
    if (isNewItemTransition) {
      previousItemDwellMs = Math.max(0, nowMs - currentItemEnteredAtMs);
      if (scrollSeq > 0 && previousItemDwellMs > 0 && previousItemDwellMs < FAST_SKIP_MAX_MS) {
        isFastSkip = true;
        fastSkipCount += 1;
      }
      scrollSeq += 1;
      lastReportedPath = path;
      if (videoSig) lastActiveVideoSig = videoSig;
      currentItemEnteredAtMs = nowMs;
    }

    const contentType = path.startsWith("/stories/") ? "STORY"
      : appKey === "youtube" ? "SHORT"
      : appKey === "tiktok" ? "TIKTOK"
      : appKey === "snapchat" ? "SPOTLIGHT"
      : "REEL";

    const itemToken = videoSig || explicitNavToken || `seq_${scrollSeq}`;
    const explicitSignature = `${appKey}|${contentType}|${path}|${itemToken}`;
    const isDuplicateInLru = isNewItemTransition ? checkAndRecordLruSignature(explicitSignature) : false;

    const baseDetail = {
      appKey,
      eventType,
      isShortFormSurface: isShortFormPath,
      isOverlaySheetOpen,
      isPlaying: videoInfo.isPlaying,
      contentType,
      rowIndex: scrollSeq,
      explicitSignature,
      isDuplicateInLru,
      isFastSkip,
      fastSkipCount,
      previousItemDwellMs,
      settleWindowMs: SCROLL_SETTLE_MS,
      requiredDwellMs: MIN_CONTINUOUS_DWELL_MS,
      timestampMs: nowMs
    };

    dispatchShortFormSignalToBackground(baseDetail);

    if (isNewItemTransition && isShortFormPath && !isOverlaySheetOpen && !isDuplicateInLru) {
      currentCandidateSignature = explicitSignature;
      if (dwellQualificationTimer) clearTimeout(dwellQualificationTimer);
      dwellQualificationTimer = setTimeout(() => {
        dwellQualificationTimer = null;
        if (currentCandidateSignature === explicitSignature) {
          qualifiedReelCount += 1;
          dispatchShortFormSignalToBackground({
            ...baseDetail,
            eventType: "TYPE_VIEW_SCROLLED",
            dwellQualified: true,
            continuousDwellMs: MIN_CONTINUOUS_DWELL_MS,
            qualifiedReelCount,
            timestampMs: Date.now()
          });
        }
      }, MIN_CONTINUOUS_DWELL_MS);
    }
  }

  window.addEventListener("wheel", (e) => {
    const dy = e && typeof e.deltaY === "number" ? Math.abs(e.deltaY) : 30;
    if (dy < 24) return;
    if (wheelSettleTimer) clearTimeout(wheelSettleTimer);
    wheelSettleTimer = setTimeout(() => {
      wheelSettleTimer = null;
      const now = Date.now();
      if (now - lastScrollReportMs > 600) {
        lastScrollReportMs = now;
        emitShortFormSignal("TYPE_VIEW_SCROLLED", `wheel_${now}`);
      }
    }, SCROLL_SETTLE_MS);
  }, { passive: true });
  window.addEventListener("popstate", () => emitShortFormSignal("TYPE_WINDOW_CONTENT_CHANGED"));
  setInterval(() => emitShortFormSignal("TYPE_WINDOW_CONTENT_CHANGED"), 1500);

  if (typeof MutationObserver !== "undefined" && typeof document !== "undefined" && document.body) {
    let mutDebounceTimer = null;
    const domObserver = new MutationObserver(() => {
      observeVideoElements();
      if (mutDebounceTimer) return;
      mutDebounceTimer = setTimeout(() => {
        mutDebounceTimer = null;
        emitShortFormSignal("TYPE_WINDOW_CONTENT_CHANGED");
      }, SCROLL_SETTLE_MS);
    });
    try {
      observeVideoElements();
      domObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "poster", "data-video-id"] });
    } catch (e) {}
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "PageDown" || e.key === "PageUp") {
      const now = Date.now();
      const appKey = detectPlatformFromHost(location.hostname);
      const lowerPath = String(location.pathname || "").toLowerCase();
      const videoInfo = findActiveViewportVideoInfo();
      const isShortForm = appKey ? isShortFormSurfaceActive(appKey, lowerPath, videoInfo) : false;
      if (isShortForm && now - lastScrollReportMs > 600) {
        lastScrollReportMs = now;
        emitShortFormSignal("TYPE_VIEW_SCROLLED", `key_${e.key}_${now}`);
      }
    }
  }, { passive: true });

  let touchStartY = null;
  window.addEventListener("touchstart", (e) => {
    if (e.touches && e.touches.length > 0) touchStartY = e.touches[0].clientY;
  }, { passive: true });

  window.addEventListener("touchend", (e) => {
    if (touchStartY !== null && e.changedTouches && e.changedTouches.length > 0) {
      const dy = touchStartY - e.changedTouches[0].clientY;
      touchStartY = null;
      const now = Date.now();
      const appKey = detectPlatformFromHost(location.hostname);
      const lowerPath = String(location.pathname || "").toLowerCase();
      const videoInfo = findActiveViewportVideoInfo();
      const isShortForm = appKey ? isShortFormSurfaceActive(appKey, lowerPath, videoInfo) : false;
      if (isShortForm && Math.abs(dy) > 70 && now - lastScrollReportMs > 600) {
        lastScrollReportMs = now;
        emitShortFormSignal("TYPE_VIEW_SCROLLED", `touch_${now}`);
      }
    }
  }, { passive: true });

})();
