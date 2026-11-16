// Espace Rabbanim : notifications sur le téléphone du Rav (icône « STAM Rav »).
// Le message reçu ne contient que « Nouvelle question » ou « Nouveau message » et le numéro anonyme de la femme.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* message illisible : texte par défaut */ }
  const number = Number.isInteger(data.number) ? data.number : null;
  event.waitUntil(self.registration.showNotification(typeof data.title === 'string' ? data.title : 'STAM', {
    body: typeof data.body === 'string' ? data.body : 'Nouveau message dans l’espace Rabbanim',
    icon: 'icone-180.png', badge: 'icone-180.png', tag: number ? 'femme-' + number : 'stam-rav', renotify: true, data: { number },
  }));
});

// Toucher la notification ouvre l'espace sur la conversation de cette femme.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const number = event.notification.data && event.notification.data.number;
  const url = self.registration.scope + (number ? '#femme-' + number : '');
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of list) {
      if (client.url.startsWith(self.registration.scope)) { client.postMessage({ open: number }); return client.focus(); }
    }
    return self.clients.openWindow(url);
  })());
});
