// Service Worker للتطبيق — لا يتدخل في طلبات API
const CACHE_NAME = 'shau-v2';
const urlsToCache = ['/', '/manifest.json', '/wasl.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
      .catch((error) => {
        console.error('خطأ في تثبيت Service Worker:', error);
      })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
          return undefined;
        })
      )
    )
  );
  return self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // لا تعترض طلبات API أو غير GET — دعها تمر للشبكة مباشرة
  if (req.method !== 'GET' || url.pathname.startsWith('/api/')) {
    return;
  }

  event.respondWith(
    fetch(req)
      .then((networkResponse) => {
        // خزّن الصفحات الثابتة فقط عند النجاح
        if (
          networkResponse &&
          networkResponse.ok &&
          (url.pathname === '/' ||
            url.pathname.endsWith('.png') ||
            url.pathname.endsWith('.json'))
        ) {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => undefined);
        }
        return networkResponse;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.destination === 'document') {
          const home = await caches.match('/');
          if (home) return home;
        }
        // يجب دائماً إرجاع Response صالح
        return new Response('', { status: 503, statusText: 'Offline' });
      })
  );
});
