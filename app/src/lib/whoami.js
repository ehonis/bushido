/*
 * Whose log this device is holding.
 *
 * An install can have more than one person on it (server/users.js), and the
 * owner can act as any of them. Each person's log is cached on the device under
 * its own key, so two logs never share an outbox. That key has to be known
 * BEFORE the store mounts and reads its cache, so main.jsx awaits `loadMe()`
 * first; a switch is a full reload, never a swap under a mounted store.
 *
 * Every API call then says whose log it is for (`X-Bushido-User`). If the server
 * disagrees (the act-as cookie expired, another tab switched person), it answers
 * 409 and nothing is read or written; main.jsx reloads into the right log.
 *
 * Offline, the last answer stands: the person whose log was open is the person
 * whose cached log loads and whose outbox waits.
 */

export const ME_KEY = 'bushido:me'
export const USER_HEADER = 'X-Bushido-User'
const OWNER = 'owner'

/* The owner's cache keeps the key it always had, so an upgrade loads the same log. */
const BASE_CACHE_KEY = 'bushido:cache-v1'
export const cacheKeyFor = (id) => (!id || id === OWNER ? BASE_CACHE_KEY : `${BASE_CACHE_KEY}:${id}`)

const DEFAULT_ME = Object.freeze({
  id: OWNER, name: '', owner: true, acting: false,
  real: { id: OWNER, name: '', admin: true },
  features: { ai: true, whoop: true, strava: true, goals: true, notifications: true },
  people: [],
})

let current = DEFAULT_ME

/** The person whose log is open. Fixed for the life of the page. */
export const currentMe = () => current

/** Reduce /api/auth/me to what the app keeps. */
export function meFrom(doc) {
  if (!doc || !doc.me?.id) return null
  return {
    id: String(doc.me.id),
    name: String(doc.me.name || ''),
    owner: Boolean(doc.me.owner),
    acting: Boolean(doc.acting),
    real: {
      id: String(doc.real?.id || doc.me.id),
      name: String(doc.real?.name || ''),
      admin: Boolean(doc.real?.admin),
    },
    features: { ...DEFAULT_ME.features, ...(doc.features || {}) },
    people: Array.isArray(doc.people) ? doc.people.map(p => ({ id: String(p.id), name: String(p.name || p.id) })) : [],
  }
}

function remembered(storage) {
  try { return meFrom(JSON.parse(storage.getItem(ME_KEY) || 'null')?.doc) } catch { return null }
}

/**
 * Ask the server who this is, falling back to the last answer when offline (and
 * to the owner on a device that has never asked, which is an install with one
 * person, or one that predates this).
 */
export async function loadMe({ fetchFn, storage, timeoutMs = 4000 } = {}) {
  let me = null
  try {
    const res = await fetchFn('/api/auth/me', { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) })
    if (res.ok) {
      const doc = await res.json()
      me = meFrom(doc)
      if (me) { try { storage.setItem(ME_KEY, JSON.stringify({ doc, at: Date.now() })) } catch { /* quota */ } }
    }
  } catch { /* offline or slow: the last answer stands */ }
  current = Object.freeze(me || remembered(storage) || DEFAULT_ME)
  return current
}

/**
 * Add the person header to a same-origin API request. Leaves anything else alone.
 * `input` is whatever fetch was called with: a string, a URL or a Request.
 */
export function withUserHeader(input, init, id, origin) {
  let url
  try { url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, origin) } catch { return [input, init] }
  if (url.origin !== origin || !url.pathname.startsWith('/api/')) return [input, init]
  if (typeof Request !== 'undefined' && input instanceof Request && !init) {
    const headers = new Headers(input.headers)
    headers.set(USER_HEADER, id)
    return [new Request(input, { headers }), undefined]
  }
  const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined))
  headers.set(USER_HEADER, id)
  return [input, { ...(init || {}), headers }]
}

/** Act as someone (or, with null, stop), then reload into their log. */
export async function actAs(id, { fetchFn = fetch, reload = () => window.location.replace('/') } = {}) {
  const res = await fetchFn('/api/act-as', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  reload()
  return body
}

/* For tests. */
export function _setMe(me) { current = Object.freeze({ ...DEFAULT_ME, ...me }) }
