const CACHE_NAME = "shield-painter-v2";
const SCOPE_PATH = new URL(self.registration.scope).pathname;
const BASE_PATH = SCOPE_PATH.endsWith("/") ? SCOPE_PATH : `${SCOPE_PATH}/`;
const APP_SHELL_PATH = `${BASE_PATH}index.html`;
const CORE_ASSETS = [
  BASE_PATH,
  APP_SHELL_PATH,
  `${BASE_PATH}src/main.js`,
  `${BASE_PATH}src/styles.css`,
  `${BASE_PATH}manifest.webmanifest`,
  `${BASE_PATH}icons/icon-any.svg`,
  `${BASE_PATH}icons/icon-maskable.svg`
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseCopy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseCopy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || caches.match(APP_SHELL_PATH);
        })
    );
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(request)
        .then((response) => {
          if (response.status === 200) {
            const responseCopy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseCopy));
          }
          return response;
        })
        .catch(() => caches.match(APP_SHELL_PATH));
    })
  );
});
