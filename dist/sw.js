// Uli: Cache only this installation's static shell, never user data or MQTT traffic.
const PREFIX = `mqtt-pwa-${encodeURIComponent(self.registration.scope)}-`;
const CACHE = `${PREFIX}v2`;
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./core.js",
  "./vault.js",
  "./pwa.js",
  "./vendor/mqtt.min.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
  "./favicon-32.png",
];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(PREFIX) && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const base = new URL("./", self.location);
  if (
    event.request.method !== "GET" ||
    url.origin !== base.origin ||
    !url.pathname.startsWith(base.pathname)
  )
    return;
  const relative = url.pathname.slice(base.pathname.length);
  if (!ASSETS.some((asset) => asset.slice(2) === relative)) return;
  // Query parameters must not prevent offline startup; never match another app's cache.
  event.respondWith(
    caches
      .open(CACHE)
      .then((cache) =>
        cache
          .match(event.request, { ignoreSearch: true })
          .then((cached) => cached || fetch(event.request)),
      ),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      const client = clients.find((item) =>
        item.url.startsWith(self.registration.scope),
      );
      return client
        ? client.focus()
        : self.clients.openWindow(self.registration.scope);
    }),
  );
});
