import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'
import { reportOpen } from './lib/push.js'
import { CHANNEL, clearSignedOut, signOutDevice } from './lib/signout.js'
import { retirePushSubscription } from './lib/handoff.js'

/*
 * Signed out (session expired, password changed on another device): the server
 * answers every API call with 401 and `X-Bushido-Auth: login`. Send the page to
 * the sign-in screen once, rather than letting each card show its own error.
 */
const realFetch = window.fetch.bind(window)
let leaving = false
window.fetch = async (...args) => {
  const res = await realFetch(...args)
  if (res.status === 401 && res.headers.get('X-Bushido-Auth') === 'login' && !leaving) {
    leaving = true
    const here = location.pathname + location.search + location.hash
    location.assign(`/login?next=${encodeURIComponent(here)}`)
  }
  return res
}

/*
 * Sign-out is a page load of /?signout=1 (the Settings page and the profile
 * menu both link there), handled here BEFORE the store mounts, so the cache it
 * reads is everything this device holds. See lib/signout.js. It uses the raw
 * fetch: a 401 mid-flow means "already signed out", not "go to the login page".
 */
async function signOutHere() {
  const out = await signOutDevice({
    fetchFn: realFetch,
    storage: window.localStorage,
    session: window.sessionStorage,
    cachesApi: window.caches,
    idb: window.indexedDB,
    confirmFn: (msg) => window.confirm(msg),
    flagTarget: window,
    channel: window.BroadcastChannel ? new window.BroadcastChannel(CHANNEL) : null,
    retirePush: () => retirePushSubscription({ timeoutMs: 3000 }),
  })
  if (out.signedOut) { location.replace('/login'); return true }
  if (out.error) window.alert(out.error)
  history.replaceState(null, '', location.pathname + location.hash)
  return false
}

/* A signed-in (or proxy-mode) load: this device may keep a log again. */
function liftSignedOutMarker() {
  realFetch('/api/auth/me', { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then(me => { if (me && (me.user || me.mode === 'proxy')) clearSignedOut(window.localStorage, window) })
    .catch(() => { /* offline: the marker stays until the next signed-in load */ })
}

async function start() {
  if (new URLSearchParams(location.search).has('signout') && await signOutHere()) return
  liftSignedOutMarker()
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
start()

// Service workers only register in a secure context. Over plain http on the
// tailnet IP that's false, so this silently no-ops there and the app still works
// — it just doesn't get the offline shell. Use the https:// tailnet name for that.
// A notification tap lands on /?n=<entryId>. Reporting it back is the strongest
// feedback signal there is and costs nothing to collect.
reportOpen()

if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  })
}
