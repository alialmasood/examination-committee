// Service Worker للتطبيق
const CACHE_NAME = 'shau-v1';
const urlsToCache = [
  '/',
  '/login',
  '/student-affairs',
  '/accounts',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

// تثبيت Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('تم فتح cache');
        return cache.addAll(urlsToCache);
      })
      .catch((error) => {
        console.error('خطأ في تثبيت Service Worker:', error);
      })
  );
  self.skipWaiting();
});

// تفعيل Service Worker
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('حذف cache القديم:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// استرجاع الطلبات
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // إرجاع من cache إذا كان متوفراً، وإلا من الشبكة
        return response || fetch(event.request);
      })
      .catch(() => {
        // في حالة عدم وجود اتصال، يمكن إرجاع صفحة offline
        if (event.request.destination === 'document') {
          return caches.match('/');
        }
      })
  );
});

