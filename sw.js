/* Offline support: app shell cache-first, data network-first (falls back to last cached copy). */
const VERSION = "ag-dash-v2";
const SHELL = ["./", "index.html", "app.js", "styles.css", "manifest.json", "favicon.png",
  "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  const isData = /\/data(\.enc)?\.json$/.test(url.pathname);
  if (isData) {
    e.respondWith(fetch(req, { cache: "no-cache" }).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(url.pathname, copy)); return r; }
      return caches.match(url.pathname).then((m) => m || r);   // don't cache 404s
    }).catch(() => caches.match(url.pathname).then((m) => m || new Response("", { status: 504 }))));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => {
    const net = fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return r; }).catch(() => hit);
    return hit || net;   // stale-while-revalidate
  }));
});
