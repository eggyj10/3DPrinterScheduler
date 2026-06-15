const CACHE = 'printer-scheduler-v6';
const STATIC_ASSETS = [
    '/',
    '/css/scheduler.css',
    '/js/scheduler.js',
    '/lib/icon.ico',
];

// Handlers that must never be served from cache (auth-sensitive or write ops)
const NO_CACHE_HANDLERS = new Set(['CurrentUser', 'VerifyPin', 'ExitPinAdmin']);

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE).then(cache => cache.addAll(STATIC_ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);

    // Never intercept SignalR or non-GET requests
    if (url.pathname.startsWith('/schedulerHub') || e.request.method !== 'GET') {
        e.respondWith(
            fetch(e.request).catch(() =>
                new Response(JSON.stringify({ error: 'offline' }), {
                    status: 503,
                    headers: { 'Content-Type': 'application/json' }
                })
            )
        );
        return;
    }

    const handler = url.searchParams.get('handler');

    // Auth-sensitive handlers: network only, return offline marker if unreachable
    if (handler && NO_CACHE_HANDLERS.has(handler)) {
        e.respondWith(
            fetch(e.request).catch(() =>
                new Response(JSON.stringify({ offline: true }), {
                    headers: { 'Content-Type': 'application/json' }
                })
            )
        );
        return;
    }

    // Other API GET handlers: network-first, fall back to cache
    if (handler) {
        e.respondWith(
            fetch(e.request)
                .then(resp => {
                    if (resp.ok) {
                        caches.open(CACHE).then(cache => cache.put(e.request, resp.clone()));
                    }
                    return resp;
                })
                .catch(() =>
                    caches.match(e.request).then(cached =>
                        cached || new Response('[]', { headers: { 'Content-Type': 'application/json' } })
                    )
                )
        );
        return;
    }

    // Static assets: cache-first, update in background
    if (/\.(css|js|ico|png|svg|woff2?)$/.test(url.pathname)) {
        e.respondWith(
            caches.match(e.request).then(cached => {
                const network = fetch(e.request).then(resp => {
                    caches.open(CACHE).then(cache => cache.put(e.request, resp.clone()));
                    return resp;
                });
                return cached || network;
            })
        );
        return;
    }

    // HTML: network-first, cache fallback
    e.respondWith(
        fetch(e.request)
            .then(resp => {
                caches.open(CACHE).then(cache => cache.put(e.request, resp.clone()));
                return resp;
            })
            .catch(() => caches.match(e.request))
    );
});
