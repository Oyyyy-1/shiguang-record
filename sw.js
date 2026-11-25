// 拾光印记 v1.0 Service Worker（网络优先 + 离线缓存兜底）
const CACHE_NAME = "sth-record-v1.0.0";
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./storage.js",
  "./ai_review.js",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // 仅缓存同源静态资源，放行所有外部 API 请求
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((resp) => {
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return resp;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match("./index.html")))
  );
});
