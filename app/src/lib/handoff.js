/*
 * Leaving old hostnames without leaving anything behind.
 *
 * An install that moves to a new hostname keeps serving the old ones. localStorage
 * belongs to an ORIGIN, so a device that logged offline there holds its unsynced
 * outbox where only a page on that hostname can read it; an edge redirect would
 * never run that page again. So the old hostnames still serve the app, and once
 * the store is fully synced (nothing dirty) the page moves to the new hostname.
 * Offline, it stays put and works as normal.
 *
 * Can go, along with the old hostnames, once every device has opened them once.
 */
import { unsubscribe } from './push.js'

/*
 * Build-time, from app/.env: VITE_BUSHIDO_HANDOFF_FROM is a comma-separated list
 * of retired hostnames, and they all move to VITE_BUSHIDO_HOST. Unset, nothing
 * moves. Vite defines import.meta.env; under Node, process.env stands in.
 */
const ENV = import.meta.env ?? globalThis.process?.env ?? {}
const FROM = String(ENV.VITE_BUSHIDO_HANDOFF_FROM || '').split(',').map(s => s.trim()).filter(Boolean)
const TO = ENV.VITE_BUSHIDO_HOST || ''

/** Where this page should move to once synced, or null when it is already home. */
export function handoffTarget(loc, { from = FROM, to = TO } = {}) {
  if (!to || !loc?.hostname || loc.hostname === to || !from.includes(loc.hostname)) return null
  return `https://${to}${loc.pathname || '/'}${loc.search || ''}${loc.hash || ''}`
}

/** `promise`, or `fallback` if it has not settled within `ms`. */
export function withinMs(promise, ms, fallback) {
  let timer
  const late = new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms) })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}

/*
 * A push subscription belongs to an origin too, and this page is about to leave
 * its origin for good. Left alone, the old endpoint stays in the server's
 * data/push-subscriptions.json (one file for every hostname), so once the phone
 * subscribes again on the new hostname each broadcast arrives twice — and the
 * old origin's own notification controls can never be reached, because the page
 * moves before they can be tapped. So unsubscribe here, on the way out.
 *
 * Best effort: offline or slow, the move still happens. A browser subscription
 * that outlives a server that never heard about it gets another try the next
 * time this origin opens, which is only until the page moves again.
 */
export async function retirePushSubscription({ timeoutMs = 2000 } = {}) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false
  try {
    return await withinMs(unsubscribe().then(() => true), timeoutMs, false)
  } catch {
    return false
  }
}
