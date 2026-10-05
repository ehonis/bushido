/*
 * Service worker: makes the app open instantly and survive a dead tailnet link.
 *
 * Deliberately conservative about data. The app shell is cached; /api/state is
 * NEVER served from cache, because a stale training log that looks live is worse
 * than an honest failure — the client already has its own localStorage cache and
 * offline outbox for that case.
 */

const SHELL = 'bushido-shell-v4'
// Bumped with the content strategy change: activate() drops every cache not
// named here, which is what evicts the stale plan.json an old worker had already
// stored. Bump this whenever the way content is cached changes — and note that
// `activate()` dropping unknown caches is exactly what makes the 2026-09-14
// rename safe: an already-installed worker serving the old shell evicts it the
// first time this one activates, rather than serving a deleted Plan tab forever.
const RUNTIME = 'bushido-runtime-v5'

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then(c => c.addAll(['./', './index.html', './manifest.webmanifest', './icon-192.png']))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== RUNTIME).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting()
})

/* ---------------------------------------------------------------- push ----
 *
 * iOS revokes a subscription that receives a push and shows nothing, so every
 * path through this handler ends in showNotification — including a payload that
 * is missing, empty, or not JSON.
 *
 * The server sends the Declarative Web Push envelope (`notification`) and the
 * same fields under `data`, so both display paths work off one payload. See
 * notify/push.mjs in the personal-assistant repo.
 */
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let payload = {}
    try { payload = event.data ? event.data.json() : {} } catch { /* fall through */ }

    const notification = payload.notification || {}
    const data = payload.data || {}
    const title = notification.title || data.title || 'Bushido'
    const body = notification.body || data.body || ''
    const url = notification.navigate || data.url || '/'

    const badge = Number(data.badge ?? notification.app_badge ?? 0)
    if (self.navigator && 'setAppBadge' in self.navigator) {
      try {
        if (badge > 0) await self.navigator.setAppBadge(badge)
        else await self.navigator.clearAppBadge()
      } catch { /* badging is best effort; never let it cost the notification */ }
    }

    await self.registration.showNotification(title, {
      body,
      icon: './icon-192.png',
      badge: './icon-192.png',
      // Replaces an earlier notification about the same thing rather than
      // stacking two; the server sends its dedupe key as the tag.
      tag: data.tag || data.entryId || undefined,
      data: { url, entryId: data.entryId || null, category: data.category || null },
    })
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  // The entry id rides on the URL so the app can report the open back. That one
  // fact is the strongest feedback signal there is and costs nothing to collect.
  const base = data.url || '/'
  const target = data.entryId
    ? `${base}${base.includes('?') ? '&' : '?'}n=${encodeURIComponent(data.entryId)}`
    : base

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clients) {
      if ('focus' in client) {
        await client.focus()
        if ('navigate' in client) { try { await client.navigate(target) } catch { /* closing */ } }
        return
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target)
  })())
})

// iOS rotates subscriptions on its own schedule. Without this Bushido goes quiet
// and nothing says why.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const old = event.oldSubscription || null
      let next = event.newSubscription || null
      if (!next) {
        const key = old?.options?.applicationServerKey
        if (!key) return
        next = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
      }
      await fetch('/api/push/rotate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          oldEndpoint: old ? old.endpoint : null,
          subscription: next.toJSON ? next.toJSON() : next,
        }),
      })
    } catch { /* Settings will show the device as expired on the next failed send */ }
  })())
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Live data: network only. Never fake it from cache.
  if (url.pathname.startsWith('/api/state') || url.pathname.startsWith('/api/entry') ||
      url.pathname.startsWith('/api/health')) {
    return
  }

  // Program content: network first, cache only as a timeout fallback.
  //
  // This used to be stale-while-revalidate — `hit || net` — which meant an edit
  // to plan.json did not appear until the SECOND launch after it landed. The
  // morning coach rewrites this file while the user is asleep, so serving the cached
  // copy first shows them yesterday's session and calls it today's. The cache is
  // still here for a dead tailnet; it is just no longer the default answer.
  if (url.pathname.startsWith('/api/content')) {
    event.respondWith(
      caches.open(RUNTIME).then(async (cache) => {
        const hit = await cache.match(request)
        const net = fetch(request).then((res) => {
          if (res.ok) cache.put(request, res.clone())
          return res
        })
        if (!hit) return net
        // On the tailnet this returns in well under a second. The race only
        // matters when the link is dead or crawling, where opening to a stale
        // plan beats not opening at all.
        return Promise.race([
          net.catch(() => hit),
          new Promise(resolve => setTimeout(() => resolve(hit), 2000)),
        ])
      }),
    )
    return
  }

  // Hashed build assets are immutable — cache first.
  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.open(SHELL).then(async (cache) => {
        const hit = await cache.match(request)
        if (hit) return hit
        const res = await fetch(request)
        if (res.ok) cache.put(request, res.clone())
        return res
      }),
    )
    return
  }

  // The server's own pages (sign-in, setup, Settings) are not the app shell and
  // must never be cached as it, or offline would open on a login form.
  if (/^\/(login|setup|settings|logout)(\/|$)/.test(url.pathname)) return

  // Navigations: network first so a rebuild is picked up, cache as the fallback.
  // Only a real app shell is cached: a navigation that was redirected (to the
  // sign-in page, when the session has expired) is passed through untouched.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok && !res.redirected) {
            const copy = res.clone()
            caches.open(SHELL).then(c => c.put('./index.html', copy))
          }
          return res
        })
        .catch(() => caches.match('./index.html')),
    )
  }
})
