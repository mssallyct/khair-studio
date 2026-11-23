const CACHE = "khair-v28";
const ASSETS = ["./", "./index.html", "./styles.css", "./js/app.js", "./js/api.js", "./js/backend-api.js", "./js/demo-store.js", "./js/rules.js", "./js/service-catalog.js", "./js/access-policy.js", "./js/loyalty-v2.js", "./js/reward-views.js", "./js/revenue.js", "./js/member-search.js", "./js/member-detail.js", "./js/excel-export.js", "./assets/logo.png", "./assets/icon-192.png", "./assets/icon-512.png", "./assets/apple-touch-icon.png", "./manifest.webmanifest", "./config.js"];

ASSETS.push("./js/member-remarks.js");
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.headers.has("Authorization") || event.request.cache === "no-store") return;
  if (!ASSETS.some(asset => new URL(asset,self.registration.scope).pathname === url.pathname)) return;
  event.respondWith(fetch(event.request).then(response => { if(response.ok && !/no-store/i.test(response.headers.get("cache-control") || "")){const clone = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, clone));} return response; }).catch(() => caches.match(event.request).then(cached => cached || (event.request.mode === "navigate" ? caches.match("./index.html") : Response.error()))));
});
