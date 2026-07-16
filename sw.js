/* ============================================================
   SERVICE WORKER - PT. Juara PWA
   ============================================================
   PENTING (biar tidak ada lagi kasus "browser beda, tampilan beda"):
   Setiap kali index.html, style.css, script.js, custom-select.js,
   manifest.json, ATAU file icon (favicon/icon-*.png) diubah dan
   di-deploy ulang, WAJIB:
   1. Naikkan angka versi query (?v=...) pada file yang berubah, di
      SEMUA tempat file itu direferensikan — yaitu di index.html
      (tag <link>/<script>) DAN di daftar URLS_TO_CACHE di bawah ini
      (keduanya harus sama persis).
   2. Naikkan juga CACHE_NAME (mis. v6 -> v7).
   Kalau CACHE_NAME tidak berubah, browser akan menganggap sw.js ini
   tidak berubah sama sekali dan TIDAK akan menjalankan ulang proses
   install/activate — akibatnya file lama yang sudah di-cache browser
   akan terus dipakai selamanya, walau file di server sudah baru.
   Ini termasuk manifest.json & icon: kalau CACHE_NAME tidak dinaikkan,
   nama app/icon lama yang sudah ke-cache akan tetap muncul di HP user
   yang sudah install, walau isi manifest.json di server sudah benar.
   ============================================================ */
const CACHE_NAME = 'ptjuara-v13';
const URLS_TO_CACHE = [
  './',
  './index.html',
  './style.css?v=11',
  './script.js?v=18',
  './custom-select.js?v=3',
  './manifest.json?v=2',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './favicon-32.png',
  './favicon-16.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(URLS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Jangan cache request ke Supabase / API eksternal, biarkan selalu network
  if (
    req.url.includes('supabase') ||
    req.url.includes('googleapis') ||
    req.url.includes('gstatic') ||
    req.url.includes('cdn.jsdelivr.net') ||
    req.url.includes('cdnjs.cloudflare.com') ||
    req.url.includes('cdn.sheetjs.com') ||
    req.method !== 'GET'
  ) {
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return res;
        })
        .catch(() => cached || caches.match('./index.html'));

      // Stale-while-revalidate: pakai cache dulu kalau ada, update di background
      return cached || networkFetch;
    })
  );
});

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};

  const notifyPromise = self.registration.showNotification(data.title || 'PT. Juara', {
    body: data.body || 'Notifikasi baru',
    icon: './icon-192.png',
    badge: './favicon-32.png'
  });

  // Badge angka merah di icon aplikasi (Android/Chrome) juga harus ke-update
  // walau app-nya lagi TERTUTUP TOTAL (bukan sekadar di-background), karena
  // event 'push' ini tetap jalan meski tidak ada tab/window app yang terbuka.
  // Kalau payload push mengirim `badgeCount` (mis. jumlah chat belum dibaca),
  // pakai itu; kalau tidak ada, tetap panggil setAppBadge() tanpa angka
  // supaya minimal muncul tanda ada notifikasi baru di icon.
  let badgePromise = Promise.resolve();
  if ('setAppBadge' in self.navigator) {
    badgePromise = typeof data.badgeCount === 'number'
      ? self.navigator.setAppBadge(data.badgeCount).catch(() => {})
      : self.navigator.setAppBadge().catch(() => {});
  }

  event.waitUntil(Promise.all([notifyPromise, badgePromise]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientsArr) => {
      const existing = clientsArr.find((c) => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow('./index.html');
    })
  );
});
