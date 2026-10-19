// Offline support: the app's own files are fetched from the network first (so a deploy shows up on the
// next open) and served from the cache when there is no connection. Book data and covers are not cached here.
const CACHE = "mi-estante-v1";
const SHELL = [
  "./",
  "index.html",
  "css/app.css",
  "js/lib.js",
  "js/store.js",
  "js/lookup.js",
  "js/scanner.js",
  "js/app.js",
  "vendor/zxing-0.21.3.min.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match("index.html")))
  );
});
