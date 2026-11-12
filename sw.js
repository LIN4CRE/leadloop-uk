const CACHE_PREFIX = "leadloop-uk-";
const CACHE_NAME = `${CACHE_PREFIX}shell-v4`;

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
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => {
        // Activate immediately on initial install so offline shell works right away;
        // on upgrades, UI can also trigger SKIP_WAITING explicitly.
        if (!self.registration.active) {
          return self.skipWaiting();
        }
      }),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      for (const key of keys) {
        // Strictly delete ONLY outdated LeadLoop UK caches — never touch other apps' caches.
        if (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) {
          await caches.delete(key);
        }
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put("./index.html", copy));
          }
          return response;
        })
        .catch(
          async () =>
            (await caches.match("./index.html")) || (await caches.match("./")),
        ),
    );
    return;
  }

  // Network-first with cache fallback for JS/CSS/manifest so updates are never trapped in stale files,
  // and stale-while-revalidate for static icons.
  const isImage = /\.(png|svg|ico|webp)$/i.test(url.pathname);
  if (isImage) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const netFetch = fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE_NAME).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || netFetch;
      }),
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return response;
      })
      .catch(() => caches.match(req)),
  );
});
