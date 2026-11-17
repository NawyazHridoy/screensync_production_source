(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const endpointInput = document.getElementById("inputSyncEndpoint");
    const tokenInput = document.getElementById("inputBridgeToken");
    const saveBtn = document.getElementById("btnSaveOptions");
    const statusEl = document.getElementById("optionsSaveStatus");

    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(["ss_ext_sync_endpoint", "screensync_ext_bridge_token"], (stored) => {
        if (endpointInput && stored && stored.ss_ext_sync_endpoint) {
          endpointInput.value = stored.ss_ext_sync_endpoint;
        }
        if (tokenInput && stored && stored.screensync_ext_bridge_token) {
          tokenInput.value = stored.screensync_ext_bridge_token;
        }
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        const endpoint = endpointInput ? endpointInput.value.trim() : "http://127.0.0.1:3001/api/v1/extension/events";
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ ss_ext_sync_endpoint: endpoint }, () => {
            if (statusEl) statusEl.textContent = "Settings saved.";
          });
        }
      });
    }
  });
})();
