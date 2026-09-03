// 출장촬영 보드 오프라인 캐시 — shoot-board.html·사진·폰트만 다룬다. 대시보드(index.html)와 API 요청은 건드리지 않는다.
const V = 'shoot-v1';
const SHELL = ['./shoot-board.html', './shoot-board.webmanifest', './shoot-icon-192.png', './shoot-icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('shoot-') && k !== V && k !== V + '-photos' && k !== V + '-fonts').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = new URL(req.url);
  // 사진: 한 번 받으면 기기에 보관 (cache-first)
  if (u.pathname.includes('/storage/v1/object/public/shoot-photos/')) {
    e.respondWith(caches.open(V + '-photos').then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r;
    }));
    return;
  }
  // 폰트: 있으면 캐시, 뒤에서 갱신
  if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(V + '-fonts').then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  // 앱 화면: 네트워크 우선, 안 되면 저장본 (오프라인에서 새로고침해도 열리게)
  if (u.origin === location.origin && /shoot-board\.html$|shoot-board\.webmanifest$|shoot-icon-\d+\.png$/.test(u.pathname)) {
    e.respondWith(fetch(req).then(r => { if (r.ok) caches.open(V).then(c => c.put(req, r.clone())); return r; }).catch(() => caches.match(req)));
    return;
  }
});
