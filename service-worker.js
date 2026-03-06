// ============================================================
// HMFC Bible App — Service Worker
// Harvester Mission Fellowship Inc.
// ============================================================

const CACHE_NAME     = "hmfc-bible-v1";
const DATA_CACHE     = "hmfc-data-v1";
const OFFLINE_PAGE   = "index.html";

// Core app shell — always cached on install
const APP_SHELL = [
  "./index.html",
  "./icon.png",
  "./manifest.json"
];

// Data files — cached separately so they can be refreshed
const DATA_FILES = [
  "./all-bible-versions.json",
  "./churches.json",
  "./schools.json",
  "./galleries.json",
  "./events.json"
];

// ── INSTALL ──────────────────────────────────────────────────
self.addEventListener("install", event => {
  console.log("[SW] Installing HMFC Service Worker…");
  event.waitUntil(
    Promise.all([
      // Cache app shell
      caches.open(CACHE_NAME).then(cache => {
        console.log("[SW] Caching app shell");
        return cache.addAll(APP_SHELL);
      }),
      // Cache data files (best-effort — don't fail install if missing)
      caches.open(DATA_CACHE).then(cache => {
        return Promise.allSettled(
          DATA_FILES.map(url =>
            cache.add(url).catch(err =>
              console.warn("[SW] Could not pre-cache:", url, err)
            )
          )
        );
      })
    ]).then(() => {
      console.log("[SW] Install complete ✓");
      self.skipWaiting(); // Activate immediately
    })
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────
self.addEventListener("activate", event => {
  console.log("[SW] Activating…");
  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME && name !== DATA_CACHE)
          .map(name => {
            console.log("[SW] Deleting old cache:", name);
            return caches.delete(name);
          })
      )
    ).then(() => {
      console.log("[SW] Activation complete ✓");
      return self.clients.claim(); // Take control immediately
    })
  );
});

// ── FETCH ─────────────────────────────────────────────────────
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // Only handle GET requests from our own origin
  if (event.request.method !== "GET") return;

  // ── Data / JSON files: Network-first, fallback to cache ──
  if (
    url.pathname.endsWith(".json") &&
    DATA_FILES.some(f => url.pathname.endsWith(f.replace("./", "")))
  ) {
    event.respondWith(networkFirstData(event.request));
    return;
  }

  // ── External resources (images, fonts, CDN): Cache-first ──
  if (url.origin !== location.origin) {
    event.respondWith(cacheFirstExternal(event.request));
    return;
  }

  // ── App shell: Cache-first, fallback to network ──
  event.respondWith(cacheFirstShell(event.request));
});

// ── STRATEGY: Network-first for JSON data ────────────────────
async function networkFirstData(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(DATA_CACHE);
      cache.put(request, networkResponse.clone());
      console.log("[SW] Updated data cache:", request.url);
    }
    return networkResponse;
  } catch {
    console.log("[SW] Offline — serving data from cache:", request.url);
    const cached = await caches.match(request);
    return cached || new Response(JSON.stringify([]), {
      headers: { "Content-Type": "application/json" }
    });
  }
}

// ── STRATEGY: Cache-first for app shell ──────────────────────
async function cacheFirstShell(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    // Fallback to index.html for navigation requests
    if (request.mode === "navigate") {
      const fallback = await caches.match(OFFLINE_PAGE);
      if (fallback) return fallback;
    }
    return new Response("Offline — content not available", { status: 503 });
  }
}

// ── STRATEGY: Cache-first for external resources ─────────────
async function cacheFirstExternal(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    // Return transparent 1x1 GIF for failed image loads
    if (request.destination === "image") {
      return new Response(
        atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
        { headers: { "Content-Type": "image/gif" } }
      );
    }
    return new Response("", { status: 503 });
  }
}

// ── BACKGROUND SYNC: Notify clients of updates ───────────────
self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data && event.data.type === "GET_VERSION") {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});
