"use strict";

const CACHE_NAME = "fire-device-tracker-v9";

const APP_SHELL_FILES = [
  "./",
  "./index.html",
  "./styles.css?v=9",
  "./app.js?v=9",
  "./manifest.webmanifest",
  "./html5-qrcode.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(APP_SHELL_FILES);
      })
      .then(() => {
        return self.skipWaiting();
      }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }

            return Promise.resolve(false);
          }),
        );
      })
      .then(() => {
        return self.clients.claim();
      }),
  );
});

self.addEventListener("fetch", (event) => {self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(request.url);

  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, {
        cache: "no-store"
      })
        .then((networkResponse) => {
          const responseCopy =
            networkResponse.clone();

          caches.open(CACHE_NAME).then((cache) => {
            cache.put(
              "./index.html",
              responseCopy
            );
          });

          return networkResponse;
        })
        .catch(async () => {
          return (
            (await caches.match("./index.html")) ||
            (await caches.match("./"))
          );
        })
    );

    return;
  }

  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (
          !networkResponse ||
          networkResponse.status !== 200
        ) {
          return networkResponse;
        }

        const responseCopy =
          networkResponse.clone();

        caches.open(CACHE_NAME).then((cache) => {
          cache.put(
            request,
            responseCopy
          );
        });

        return networkResponse;
      })
      .catch(() => {
        return caches.match(request);
      })
  );
});
