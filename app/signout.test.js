// Signing out takes the log off the device: freeze every tab, flush, ask before
// losing anything, and clear only once the server has confirmed.
import assert from 'node:assert/strict'
import {
  signOutDevice, unsyncedCount, lossMessage, clearDeviceData, makeLocalPersist, clearSignedOut,
  onSignedOutElsewhere, isSignedOut, SIGNED_OUT_KEY, SIGNING_OUT_KEY, SIGNED_OUT_FLAG,
} from './src/lib/signout.js'
import { retirePushSubscription } from './src/lib/handoff.js'

const tests = []
const test = (name, fn) => tests.push([name, fn])

function storage(init = {}) {
  const m = new Map(Object.entries(init))
  return {
    get length() { return m.size },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    keys: () => [...m.keys()],
  }
}
const e = (id, at) => ({ id, kind: 'daily', date: '2026-10-01', updatedAt: at, data: { name: id } })
const LOG = { a: e('a', '2026-10-01T08:00:00Z'), b: e('b', '2026-10-01T09:00:00Z'), c: e('c', '2026-10-01T10:00:00Z') }
const cache = (entries, dirty = false) => JSON.stringify({ state: { entries, settings: {} }, version: 7, dirty })

function fakeCaches(names) {
  const set = new Set(names)
  return { keys: async () => [...set], delete: async (n) => set.delete(n), names: () => [...set] }
}
function fakeIdb(names) {
  const set = new Set(names)
  return { databases: async () => [...set].map(name => ({ name })), deleteDatabase: (n) => set.delete(n), names: () => [...set] }
}
const json = (status, body) => ({ ok: status < 400, status, json: async () => body })

/** A server that accepts the push and the logout; `has` is what it already holds. */
function server(calls, { has = null, logout = 200 } = {}) {
  return async (url, init = {}) => {
    calls.push(`${init.method || 'GET'} ${url}`)
    if (url === '/api/state' && init.method === 'PUT') {
      const sent = JSON.parse(init.body).state.entries
      return json(200, { state: { entries: has ?? sent } })
    }
    if (url === '/api/auth/logout') return json(logout, {})
    return json(404, {})
  }
}
const offline = (calls) => async (url, init = {}) => { calls.push(`${init.method || 'GET'} ${url}`); throw new Error('offline') }

test('online: flushes, does not ask, signs out, and clears everything but the shell', async () => {
  const calls = []
  const ls = storage({ 'bushido:cache-v1': cache(LOG), 'rung:cache-v1': '{}', 'other.app': 'keep' })
  const ss = storage({ 'bushido:draft': 'x' })
  const cachesApi = fakeCaches(['bushido-shell-v4', 'bushido-runtime-v5'])
  const idb = fakeIdb(['bushido'])
  let asked = 0
  const flag = {}
  const out = await signOutDevice({ fetchFn: server(calls), storage: ls, session: ss, cachesApi, idb, confirmFn: () => { asked++; return true }, flagTarget: flag })
  assert.deepEqual(out, { signedOut: true, unsynced: 0 })
  assert.equal(asked, 0, 'nothing to lose, so no question')
  assert.deepEqual(calls, ['PUT /api/state', 'POST /api/auth/logout'], 'flush first, then sign out')
  assert.deepEqual(ls.keys().sort(), ['bushido:signedOut', 'other.app'], 'only this app\'s keys go; the marker stays')
  assert.deepEqual(ss.keys(), [])
  assert.deepEqual(cachesApi.names(), ['bushido-shell-v4'], 'the plan cache goes, the shell stays')
  assert.deepEqual(idb.names(), [])
  assert.equal(flag[SIGNED_OUT_FLAG], true)
})

test('entries the server does not have: asks with the count, and "no" keeps everything', async () => {
  const calls = []
  const ls = storage({ 'bushido:cache-v1': cache(LOG, true) })
  const cachesApi = fakeCaches(['bushido-shell-v4', 'bushido-runtime-v5'])
  let question = null
  const out = await signOutDevice({
    fetchFn: server(calls, { has: { a: LOG.a } }), storage: ls, cachesApi,
    confirmFn: (q) => { question = q; return false },
  })
  assert.deepEqual(out, { signedOut: false, unsynced: 2 })
  assert.match(question, /^2 entries have not reached the server/)
  assert.deepEqual(calls, ['PUT /api/state'], 'no logout after "no"')
  assert.ok(ls.getItem('bushido:cache-v1'), 'the log is still on the device')
  assert.equal(ls.getItem(SIGNING_OUT_KEY), null, 'the freeze is lifted')
  assert.deepEqual(cachesApi.names().sort(), ['bushido-runtime-v5', 'bushido-shell-v4'])
})

test('offline: says the server cannot be reached; a failed logout clears nothing and offers a retry', async () => {
  const calls = []
  const ls = storage({ 'bushido:cache-v1': cache(LOG, true) })
  let question = null
  const out = await signOutDevice({ fetchFn: offline(calls), storage: ls, confirmFn: (q) => { question = q; return true } })
  assert.equal(question, lossMessage(null))
  assert.equal(out.signedOut, false)
  assert.match(out.error, /still signed in and nothing was removed/)
  assert.ok(ls.getItem('bushido:cache-v1'), 'the log is still on the device')
  assert.equal(ls.getItem(SIGNED_OUT_KEY), null)
  assert.equal(ls.getItem(SIGNING_OUT_KEY), null, 'the freeze is lifted')
})

test('a server error on logout is not a sign-out', async () => {
  const ls = storage({ 'bushido:cache-v1': cache(LOG) })
  const out = await signOutDevice({ fetchFn: server([], { logout: 500 }), storage: ls, confirmFn: () => true })
  assert.equal(out.signedOut, false)
  assert.match(out.error, /answered 500/)
  assert.ok(ls.getItem('bushido:cache-v1'))
})

test('a 401 on logout means already signed out, and the device is cleared', async () => {
  const ls = storage({ 'bushido:cache-v1': cache(LOG) })
  const out = await signOutDevice({ fetchFn: server([], { logout: 401 }), storage: ls, confirmFn: () => true })
  assert.equal(out.signedOut, true)
  assert.equal(ls.getItem('bushido:cache-v1'), null)
})

test('an empty device signs out without a flush', async () => {
  const calls = []
  const out = await signOutDevice({ fetchFn: server(calls), storage: storage(), confirmFn: () => true })
  assert.equal(out.signedOut, true)
  assert.deepEqual(calls, ['POST /api/auth/logout'])
})

test('every tab freezes: the store\'s write refuses during and after a sign-out, and resumes after sign-in', async () => {
  const shared = storage()
  const tabA = {}
  const tabB = {}
  const writeB = makeLocalPersist({ storage: shared, flagTarget: tabB, key: 'bushido:cache-v1' })
  assert.equal(writeB({ x: 1 }), true)
  shared.setItem(SIGNING_OUT_KEY, new Date().toISOString())
  assert.equal(writeB({ x: 2 }), false, 'another tab wrote while a sign-out was reading')
  assert.equal(isSignedOut(shared, tabB), true)
  shared.setItem(SIGNING_OUT_KEY, new Date(Date.now() - 3 * 60 * 1000).toISOString())
  assert.equal(writeB({ x: 3 }), true, 'a stale freeze (a tab that died mid-sign-out) blocks forever')
  shared.setItem(SIGNED_OUT_KEY, new Date().toISOString())
  assert.equal(writeB({ x: 4 }), false, 'a late sync wrote the log back after sign-out')
  clearSignedOut(shared, tabA)
  assert.equal(writeB({ x: 5 }), true, 'signing in again does not re-enable the cache')
})

test('other tabs hear about it by channel or by the storage event', async () => {
  let heard = 0
  const listeners = {}
  class Channel { constructor() { Channel.last = this } close() {} }
  const win = { BroadcastChannel: Channel, addEventListener: (t, f) => { listeners[t] = f }, removeEventListener: () => {} }
  const off = onSignedOutElsewhere({ win, fn: () => { heard++ } })
  Channel.last.onmessage({ data: 'signing-out' })
  assert.equal(heard, 0, 'a freeze is not a sign-out')
  Channel.last.onmessage({ data: 'signed-out' })
  listeners.storage({ key: SIGNED_OUT_KEY, newValue: 'x' })
  listeners.storage({ key: 'other', newValue: 'x' })
  assert.equal(heard, 2)
  off()
})

test('unsyncedCount counts missing and newer entries only', async () => {
  assert.equal(unsyncedCount(LOG, LOG), 0)
  assert.equal(unsyncedCount(LOG, { a: LOG.a }), 2)
  assert.equal(unsyncedCount({ a: { ...LOG.a, updatedAt: '2026-10-02T00:00:00Z' } }, LOG), 1)
  assert.equal(lossMessage(1), '1 entry has not reached the server yet and will be deleted from this device. Sign out anyway?')
})

test('clearDeviceData keeps other apps\' keys and the shell cache', async () => {
  const ls = storage({ 'bushido:cache-v1': 'x', 'rung:cache-v1': 'y', [SIGNED_OUT_KEY]: 'z', 'krakatoa.state.v1': 'keep' })
  const cachesApi = fakeCaches(['bushido-shell-v4', 'bushido-runtime-v5', 'bushido-runtime-v4'])
  await clearDeviceData({ storage: ls, cachesApi })
  assert.deepEqual(ls.keys().sort(), [SIGNED_OUT_KEY, 'krakatoa.state.v1'].sort())
  assert.deepEqual(cachesApi.names(), ['bushido-shell-v4'])
})

test('the push subscription is retired after the flush and before the logout', async () => {
  const calls = []
  const ls = storage({ 'bushido:cache-v1': cache(LOG) })
  const out = await signOutDevice({
    fetchFn: server(calls), storage: ls, confirmFn: () => true,
    retirePush: async () => { calls.push('retire push') },
  })
  assert.equal(out.signedOut, true)
  assert.deepEqual(calls, ['PUT /api/state', 'retire push', 'POST /api/auth/logout'])
})

test('a push retirement that fails never blocks sign-out', async () => {
  const ls = storage({ 'bushido:cache-v1': cache(LOG) })
  const out = await signOutDevice({
    fetchFn: server([]), storage: ls, confirmFn: () => true,
    retirePush: async () => { throw new Error('no service worker') },
  })
  assert.equal(out.signedOut, true)
  assert.equal(ls.getItem('bushido:cache-v1'), null)
})

test('declining keeps the push subscription too', async () => {
  let retired = 0
  await signOutDevice({
    fetchFn: server([], { has: {} }), storage: storage({ 'bushido:cache-v1': cache(LOG, true) }),
    confirmFn: () => false, retirePush: async () => { retired++ },
  })
  assert.equal(retired, 0)
})

test('end to end: the server forgets the endpoint and the browser unsubscribes, even when the browser hangs', async () => {
  const navDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const realFetch = globalThis.fetch
  const calls = []
  const setNav = (sub) => Object.defineProperty(globalThis, 'navigator', {
    value: { serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => sub } }) } },
    configurable: true, writable: true,
  })
  globalThis.fetch = async (url, init = {}) => { calls.push(`${init.method || 'GET'} ${url} ${JSON.parse(init.body || '{}').endpoint || ''}`.trim()); return { ok: true } }
  try {
    const sub = { endpoint: 'https://push.example/device-1', unsubscribe: async () => { calls.push('browser unsubscribe'); return true } }
    setNav(sub)
    const out = await signOutDevice({
      fetchFn: server(calls), storage: storage({ 'bushido:cache-v1': cache(LOG) }), confirmFn: () => true,
      retirePush: () => retirePushSubscription({ timeoutMs: 200 }),
    })
    assert.equal(out.signedOut, true)
    assert.deepEqual(calls, ['PUT /api/state', 'POST /api/push/unsubscribe https://push.example/device-1', 'browser unsubscribe', 'POST /api/auth/logout'])

    // A browser that never answers costs at most the timeout.
    calls.length = 0
    setNav({ endpoint: 'https://push.example/device-2', unsubscribe: () => new Promise(() => {}) })
    const started = Date.now()
    const slow = await signOutDevice({
      fetchFn: server(calls), storage: storage(), confirmFn: () => true,
      retirePush: () => retirePushSubscription({ timeoutMs: 100 }),
    })
    assert.equal(slow.signedOut, true)
    assert.ok(Date.now() - started < 2000, 'a hung unsubscribe blocked sign-out')
    assert.ok(calls.includes('POST /api/auth/logout'))
  } finally {
    globalThis.fetch = realFetch
    if (navDesc) Object.defineProperty(globalThis, 'navigator', navDesc)
    else delete globalThis.navigator
  }
})

let failed = 0
for (const [name, fn] of tests) {
  try { await fn(); console.log(`  PASS  ${name}`) } catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`) }
}
console.log(failed ? `\n${failed} sign-out test(s) failed` : '\nall sign-out tests pass')
process.exit(failed ? 1 : 0)
