/*
 * Web Push, from Bushido's side.
 *
 * Bushido is its own app on the phone with its own permission and its own
 * subscription — health here, personal in Totem — so none of this talks to
 * Totem. The server half is shared (notify/ in the personal-assistant repo);
 * this half is not, because it is three fetches and a permission prompt.
 *
 * Every rule below is an iOS rule, and each one fails silently rather than
 * loudly:
 *   - push works only from a Home Screen web app, never a Safari tab
 *   - permission is asked once, from a user gesture, and a refusal sticks until
 *     the app is removed and re-added
 *   - removing the app destroys the subscription and its storage without a word
 */

export function isStandalone() {
  if (typeof window === 'undefined') return false
  const ios = window.navigator.standalone
  if (typeof ios === 'boolean' && ios) return true
  return window.matchMedia?.('(display-mode: standalone)').matches ?? false
}

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export async function pushState() {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  const standalone = isStandalone()
  const permission = supported ? Notification.permission : 'unsupported'

  let subscribed = false
  if (supported) {
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      subscribed = Boolean(await reg?.pushManager.getSubscription())
    } catch { subscribed = false }
  }

  let blocker = null
  if (!supported) blocker = 'This browser has no Push API.'
  else if (isIos() && !standalone) {
    blocker = 'On iPhone, notifications only work once Bushido is on your Home Screen. '
      + 'Open Bushido in Safari, tap Share, then "Add to Home Screen", and open it from there.'
  } else if (permission === 'denied') {
    blocker = isIos()
      ? 'Notifications were declined. iOS will not ask again — remove Bushido from the Home Screen, add it back, and allow when asked.'
      : 'Notifications are blocked for this site in your browser settings.'
  }

  return { supported, standalone, permission, subscribed, blocker }
}

function decodeKey(base64url) {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4)
  const raw = atob(padded)
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

const label = () => (isIos() ? (/iPad/.test(navigator.userAgent) ? 'iPad' : 'iPhone') : 'This device')

/** Must be called straight out of a click: iOS refuses a prompt that is not. */
export async function subscribe() {
  try {
    const { publicKey, configured, error } = await fetch('/api/push/key').then((r) => r.json())
    if (!configured || !publicKey) return { ok: false, error: error || 'The server has no VAPID identity yet.' }

    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return { ok: false, error: 'Notification permission was not granted.' }

    const reg = await navigator.serviceWorker.register('./sw.js')
    await navigator.serviceWorker.ready
    const existing = await reg.pushManager.getSubscription()
    const sub = existing ?? await reg.pushManager.subscribe({
      // Non-negotiable, and on iOS a push that shows nothing can cost the
      // subscription outright.
      userVisibleOnly: true,
      applicationServerKey: decodeKey(publicKey),
    })

    const r = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON(), label: label(), userAgent: navigator.userAgent }),
    })
    if (!r.ok) return { ok: false, error: `The server refused the subscription (HTTP ${r.status}).` }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message || String(e) }
  }
}

export async function unsubscribe() {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await fetch('/api/push/unsubscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {})
  await sub.unsubscribe()
}

const getJson = (u) => fetch(u).then((r) => r.json())
const postJson = (u, b = {}) => fetch(u, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
}).then((r) => r.json())

export const sendTest = () => postJson('/api/push/test', {
  title: 'Bushido test',
  body: 'If this is on your phone, the whole path works.',
})
export const devices = () => getJson('/api/push/subscriptions')
export const history = () => getJson('/api/push/history')
export const weights = () => getJson('/api/push/weights')
export const rate = (item, vote, reasons = []) => postJson('/api/push/feedback', {
  entryId: item.entryId, category: item.category, factKind: item.factKind, vote, reasons,
})
export const resetWeights = (factKind) => postJson('/api/push/weights/reset', factKind ? { factKind } : {})
export const markRead = () => postJson('/api/push/read', {})

export const DOWNVOTE_REASONS = [
  { id: 'not-useful', label: 'Not useful' },
  { id: 'wrong-time', label: 'Wrong time' },
  { id: 'too-many', label: 'Too many' },
  { id: 'badly-worded', label: 'Badly worded' },
  { id: 'already-done', label: 'Already did it' },
]

/** A notification tap lands on /?n=<entryId>. Report it, then clean the URL. */
export function reportOpen() {
  const params = new URLSearchParams(window.location.search)
  const entryId = params.get('n')
  if (!entryId) return
  postJson('/api/push/opened', { entryId }).catch(() => {})
  params.delete('n')
  const q = params.toString()
  window.history.replaceState({}, '', `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`)
}
