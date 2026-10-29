const CACHE = "khair-v10";
const ASSETS = ["./", "./index.html", "./styles.css", "./js/app.js", "./js/api.js", "./js/demo-store.js", "./js/rules.js", "./js/member-search.js", "./js/excel-export.js", "./assets/icon.svg", "./manifest.webmanifest", "./config.js"];

self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.hostname.includes("supabase.co")) return;
  event.respondWith(fetch(event.request).then(response => { const clone = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, clone)); return response; }).catch(() => caches.match(event.request).then(cached => cached || caches.match("./index.html"))));
});
