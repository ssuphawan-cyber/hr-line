// 4Source HR · staff web page service worker: makes the page installable on the home screen.
// Nothing is cached (the page and its data always come fresh from the network), so an update reaches everyone at once.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;   // scripts, styles and Apps Script calls: the browser's own handling
  e.respondWith(fetch(e.request).catch(() => new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;padding:40px 20px;text-align:center;color:#1d2433"><h2>ไม่มีอินเทอร์เน็ต</h2><p>ตรวจสอบการเชื่อมต่อแล้วลองใหม่</p><button onclick="location.reload()" style="font-size:16px;padding:10px 20px">ลองใหม่</button>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
