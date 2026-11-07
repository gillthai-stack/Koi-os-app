/* global chrome */
// Runs on the KOI//OS site. Passes cart jobs from the order sheet to the extension
// and progress back to the page. Only talks to messages from this same window.
(() => {
  const VERSION = chrome.runtime.getManifest().version;
  const announce = () => window.postMessage({ source: "koi-cart", type: "READY", version: VERSION }, location.origin);

  window.addEventListener("message", (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const m = e.data;
    if (!m || m.source !== "koi-os") return;
    if (m.type === "PING") announce();
    if (m.type === "FILL_CART" && m.job && Array.isArray(m.job.lines)) {
      chrome.runtime.sendMessage({ type: "FILL_CART", job: m.job });
    }
  });

  chrome.runtime.onMessage.addListener((m) => {
    if (m && (m.type === "PROGRESS" || m.type === "DONE")) {
      window.postMessage({ source: "koi-cart", ...m }, location.origin);
    }
  });

  announce();
  document.addEventListener("DOMContentLoaded", announce);
})();
