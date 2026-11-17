/**
 * ScreenSync Standalone MV3 Extension Popup Controller (Part 15 Section P15.2)
 * Renders live Today's Screen Time, Reels Count, Reel Watch Time, Active Focus Session countdown,
 * and opens the full ScreenSync Dashboard (`chrome.tabs.create({ url: chrome.runtime.getURL("index.html") })`).
 */
(function () {
  function formatHoursMinutes(totalSeconds) {
    const secs = Math.max(0, Number(totalSeconds || 0));
    const totalMinutes = Math.floor(secs / 60);
    const hrs = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m`;
  }

  function formatCountdown(remainingSeconds) {
    const secs = Math.max(0, Math.floor(Number(remainingSeconds || 0)));
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${String(mins).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
  }

  function renderPopupSummary(resp) {
    if (!resp || !resp.ok) return;
    const summary = resp.summary || {};
    const screenEl = document.getElementById("popupScreenTimeValue");
    const reelsEl = document.getElementById("popupReelsCountValue");
    const watchEl = document.getElementById("popupReelWatchTimeValue");
    const skipEl = document.getElementById("popupFastSkipSub");
    const focusValEl = document.getElementById("popupFocusCountdownValue");
    const focusPillEl = document.getElementById("popupFocusStatePill");
    const osEl = document.getElementById("popupOsDeviceLabel");
    const instEl = document.getElementById("popupInstallationIdText");

    if (screenEl) screenEl.textContent = formatHoursMinutes(summary.todayScreenSeconds || 0);
    if (reelsEl) reelsEl.textContent = String(summary.todayReelsCount || 0);
    if (watchEl) watchEl.textContent = formatHoursMinutes(summary.todayReelWatchSeconds || 0);
    if (skipEl) skipEl.textContent = `${summary.fastSkipCount || 0} fast skips (<2.5s)`;
    if (osEl && resp.osCategory) osEl.textContent = `${resp.osCategory} • MV3 Companion`;
    if (instEl && resp.installationId) instEl.textContent = resp.installationId;

    const focus = summary.activeFocusSession || {};
    if (focus.active && focus.remainingSeconds > 0) {
      if (focusValEl) focusValEl.textContent = formatCountdown(focus.remainingSeconds);
      if (focusPillEl) focusPillEl.textContent = "ACTIVE";
    } else {
      if (focusValEl) focusValEl.textContent = focus.label || "Ready to Focus";
      if (focusPillEl) focusPillEl.textContent = "IDLE";
    }
  }

  function refreshPopup() {
    if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.sendMessage === "function") {
      chrome.runtime.sendMessage({ type: "GET_POPUP_LIVE_SUMMARY" }, (resp) => {
        renderPopupSummary(resp);
      });
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    refreshPopup();
    setInterval(refreshPopup, 2000);

    const openDashBtn = document.getElementById("btnOpenFullScreenSyncDashboard");
    if (openDashBtn) {
      openDashBtn.addEventListener("click", () => {
        if (typeof chrome !== "undefined" && chrome.tabs && typeof chrome.tabs.create === "function" && chrome.runtime && typeof chrome.runtime.getURL === "function") {
          chrome.tabs.create({ url: chrome.runtime.getURL("index.html") });
        }
      });
    }

    const openOptsBtn = document.getElementById("btnOpenExtensionOptions");
    if (openOptsBtn) {
      openOptsBtn.addEventListener("click", () => {
        if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.openOptionsPage === "function") {
          chrome.runtime.openOptionsPage();
        } else if (typeof chrome !== "undefined" && chrome.tabs && typeof chrome.tabs.create === "function") {
          chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
        }
      });
    }
  });
})();
