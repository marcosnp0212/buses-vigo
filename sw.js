// Service worker of Buses Vigo: shows the alerts that arrive with the web closed (push/README.md).
// The server's pushes carry no text: it is fetched from the server when the push arrives.
const PUSH_URL = new URL(self.location).searchParams.get('push') || '';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => e.waitUntil((async () => {
  let msg = { title: 'Buses Vigo', body: '' };
  try {
    if (e.data) msg = e.data.json();
    else if (PUSH_URL) {
      const sub = await self.registration.pushManager.getSubscription();
      const res = await fetch(PUSH_URL + '/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      msg = await res.json();
    }
  } catch (err) {}
  await self.registration.showNotification(msg.title || 'Buses Vigo', {
    body: msg.body || '', icon: 'icon-192.png', badge: 'icon-192.png', tag: msg.tag || 'bus-alert', renotify: true,
    vibrate: [200, 100, 200], data: { url: msg.url || './' },
  });
})()));

// tapping the alert opens the web on that stop (or brings an open tab to the front)
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data && e.notification.data.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((tabs) => {
    for (const t of tabs) { if (t.url !== url && 'navigate' in t) t.navigate(url); return t.focus(); }
    return self.clients.openWindow(url);
  }));
});
