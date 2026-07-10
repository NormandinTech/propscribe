const CACHE_NAME = 'propscribe-v1.0.0';
const OFFLINE_URL = '/app/offline.html';

const STATIC_ASSETS = [
  '/app/',
  '/app/index.html',
  '/app/offline.html',
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Outfit:wght@300;400;500&display=swap'
];

const API_CACHE = 'propscribe-api-v1';
const DRAFT_STORE = 'propscribe-drafts';

// ── INSTALL ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME && key !== API_CACHE)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH ──
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // API calls — network only, no caching
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: 'offline', queued: true }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Static assets — cache first
  if (request.method === 'GET') {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request)
          .then(response => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => {
            // Navigation fallback
            if (request.mode === 'navigate') {
              return caches.match(OFFLINE_URL);
            }
          });
      })
    );
  }
});

// ── BACKGROUND SYNC — queued generations ──
self.addEventListener('sync', event => {
  if (event.tag === 'propscribe-generate') {
    event.waitUntil(flushDraftQueue());
  }
});

async function flushDraftQueue() {
  const db = await openDB();
  const drafts = await getAllDrafts(db);
  for (const draft of drafts) {
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft.payload)
      });
      if (res.ok) {
        await deleteDraft(db, draft.id);
        await notifyClients({ type: 'DRAFT_SYNCED', id: draft.id });
      }
    } catch {}
  }
}

// ── PUSH NOTIFICATIONS ──
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'PropScribe', {
      body: data.body || 'Your listing is ready.',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/badge-72x72.png',
      tag: data.tag || 'propscribe-notification',
      data: { url: data.url || '/app/' },
      actions: [
        { action: 'open', title: 'View listing' },
        { action: 'dismiss', title: 'Dismiss' }
      ]
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const url = event.notification.data?.url || '/app/';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ── SIMPLE INDEXEDDB HELPERS ──
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DRAFT_STORE, 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('drafts')) {
        db.createObjectStore('drafts', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

function getAllDrafts(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', 'readonly');
    const req = tx.objectStore('drafts').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function deleteDraft(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite');
    const req = tx.objectStore('drafts').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function notifyClients(message) {
  const all = await clients.matchAll({ type: 'window' });
  all.forEach(c => c.postMessage(message));
}
