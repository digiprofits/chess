const CACHE = "chess-v6";
const ASSETS = [
  "/",
  "/index.html",
  "/css/styles.css?v=6",
  "/js/chess.js?v=6",
  "/js/ai.js?v=6",
  "/js/app.js?v=6",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
  );
  self.clients.claim();
});

// Network-first: online visitors always get the freshest code (so a deploy lands
// without a hard refresh), while the cache is kept warm as a fallback for offline
// use. Only GET requests are cached.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
