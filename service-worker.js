const CACHE_NAME = "barcode-creator-tool-v2.7.1";

const APP_ASSETS = [
  "./",
  "./index.html",
  "./app-single.html",
  "./manifest.webmanifest",
  "./css/app.css?v=2.7.1",
  "./js/app-browser.js?v=2.7.1",
  "./js/translations.js?v=2.7.1",
  "./vendor/qrcode.global.js",
  "./vendor/qrcode.mjs",
  "./vendor/jsbarcode.umd.min.js",
  "./vendor/jspdf.umd.min.js",
  "./vendor/jspdf.mjs",
  "./vendor/jsqr.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_ASSETS.map((asset) => new Request(asset, { cache: "reload" })))).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("barcode-creator-tool-v") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Revalidate online to avoid pairing fresh HTML with stale application code.
  // The versioned URLs also protect clients still controlled by an older worker.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request, { cache: "no-cache" });
        if (!response.ok) throw new Error("Resource unavailable");
        await cache.put(request, response.clone());
        return response;
      } catch {
        const cached = await cache.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          const page = await cache.match("./index.html");
          if (page) return page;
        }
        return Response.error();
      }
    })()
  );
});
