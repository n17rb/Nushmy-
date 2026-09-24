/* عامل الخدمة: يخزّن هيكل التطبيق ليفتح بسرعة وحتى مع إنترنت ضعيف.
   لا يخزّن أي استجابة من /api — بيانات الرحلات تأتي من الخادم دائماً. */
const CACHE = 'nashmi-shell-v10';
const SHELL = [
  '/', '/index.html', '/manifest.webmanifest',
  '/css/tokens.css', '/css/app.css',
  '/js/icons.js', '/js/api.js', '/js/ui.js', '/js/map.js', '/js/app.js',
  '/js/car.js', '/js/push.js', '/js/chat.js', '/js/call.js', '/js/screens/inbox.js',
  '/js/screens/auth.js', '/js/screens/home.js', '/js/screens/ride.js', '/js/screens/account.js',
  '/img/logo-mark.png', '/img/wordmark.png', '/img/castle.webp',
];
// مكتبة الخرائط والخط من الخارج — تُحفظ بعد أول تحميل حتى تعمل مع الشبكة الضعيفة
const CDN_HOSTS = ['unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // المكتبات الخارجية: من الذاكرة أولاً
  if (CDN_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      }))
    );
    return;
  }

  if (url.origin !== location.origin) return;           // بلاطات الخرائط لا تُخزَّن
  if (url.pathname.startsWith('/api/')) return;          // لا تخزين لأي بيانات حية
  if (url.pathname.startsWith('/uploads/')) return;

  // ملفات التطبيق: من الذاكرة فوراً، ونحدّثها من الشبكة بالخلفية
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const net = fetch(e.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});

/* ------------------------- الإشعارات الفورية (Push) ------------------------- */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'نشمي', body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'نشمي';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    icon: '/img/logo-mark.png',
    badge: '/img/logo-mark.png',
    dir: 'rtl', lang: 'ar',
    tag: d.tag || undefined,
    renotify: Boolean(d.tag),
    vibrate: d.tag === 'offer' || d.tag === 'call' ? [300, 120, 300, 120, 300] : [120, 60, 120],
    requireInteraction: d.tag === 'offer' || d.tag === 'call',
    data: { url: d.url || (d.app === 'captain' ? '/captain/' : '/'), ...(d.data || {}) },
  }));
});

// الضغط على الإشعار: بيفتح التطبيق (أو بيرجع للنافذة المفتوحة) على الصفحة الصح
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const base = target.split('#')[0];
    for (const w of wins) {
      if (w.url.split('#')[0] === base && 'focus' in w) {
        await w.focus();
        w.postMessage({ type: 'open', url: target });
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
