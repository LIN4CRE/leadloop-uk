const CACHE_PREFIX = "leadloop-uk-";
const CACHE_NAME = `${CACHE_PREFIX}shell-v5`;
const SCOPE_URL = new URL(self.registration.scope);
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./core.js",
  "./src/constants.js",
  "./src/utils.js",
  "./src/quotes.js",
  "./src/repeat.js",
  "./src/analytics.js",
  "./src/templates.js",
  "./src/csv.js",
  "./src/migration.js",
  "./src/db.js",
  "./src/print.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
].map((path) => new URL(path, SCOPE_URL).href);

function isInAppScope(url) {
  return (
    url.origin === SCOPE_URL.origin &&
    url.pathname.startsWith(SCOPE_URL.pathname)
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(SHELL_ASSETS);
      // First install needs to control the app for offline use. Updates wait for
      // the user's explicit Apply update action in the application UI.
      if (!self.registration.active) await self.skipWaiting();
    }),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // A shared host may run other apps and service workers: only handle this
  // registration's own origin + path scope and never perform global cache matches.
  if (!isInAppScope(url)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      if (request.mode === "navigate") {
        try {
          const response = await fetch(request);
          if (response.ok) await cache.put(request, response.clone());
          return response;
        } catch {
          return (
            (await cache.match(request)) ||
            (await cache.match(new URL("index.html", SCOPE_URL).href))
          );
        }
      }

      const cached = await cache.match(request);
      const image = /\.(?:png|svg|ico|webp)$/i.test(url.pathname);
      if (image && cached) {
        event.waitUntil(
          fetch(request)
            .then(
              (response) => response.ok && cache.put(request, response.clone()),
            )
            .catch(() => undefined),
        );
        return cached;
      }
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      } catch {
        return cached || Response.error();
      }
    })(),
  );
});
