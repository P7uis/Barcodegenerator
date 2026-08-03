const CACHE_NAME = "barcode-creator-tool-v1.3.0";

const APP_ASSETS = [
  "./",
  "./index.html",
  "./app-single.html",
  "./manifest.webmanifest",
  "./css/app.css",
  "./js/app-browser.js",
  "./js/app.js",
  "./js/qr-render.js",
  "./js/shorten.js",
  "./js/png-dpi.js",
  "./js/qr-load.js",
  "./js/pdf-load.js",
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
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("./index.html")));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
