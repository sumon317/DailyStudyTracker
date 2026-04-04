const CACHE_NAME = 'dst-cache-v1';
const ASSET_CACHE = 'dst-assets-v1';

const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/vite.svg',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(ASSET_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {
            // Cache installation is non-critical
        }),
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys.filter((key) => key !== CACHE_NAME && key !== ASSET_CACHE).map((key) => caches.delete(key)),
                ),
            )
            .catch(() => {
                // Cleanup is non-critical
            }),
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);

    if (request.method !== 'GET') return;

    if (url.pathname.startsWith('/api/') || url.pathname.endsWith('.json')) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone)).catch(() => {
                        // Cache write failure is non-critical
                    });
                    return response;
                })
                .catch(() => caches.match(request)),
        );
        return;
    }

    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;

            return fetch(request)
                .then((response) => {
                    if (!response || response.status !== 200 || response.type !== 'basic') return response;

                    const responseClone = response.clone();
                    caches.open(ASSET_CACHE).then((cache) => cache.put(request, responseClone)).catch(() => {
                        // Cache write failure is non-critical
                    });
                    return response;
                })
                .catch(() => caches.match('/index.html'));
        }),
    );
});
