// The old-hostname handoff: only the retired hostnames move, and they keep their place.
import assert from 'node:assert/strict'
import { handoffTarget, retirePushSubscription, withinMs } from './src/lib/handoff.js'

const hosts = { from: ['pulse.example.com', 'climb.example.com'], to: 'bushido.example.com' }
assert.equal(handoffTarget({ hostname: 'bushido.example.com', pathname: '/' }, hosts), null)
assert.equal(handoffTarget({ hostname: '100.64.0.1', pathname: '/' }, hosts), null)
assert.equal(handoffTarget({ hostname: 'pulse.example.com', pathname: '/', search: '', hash: '' }, hosts), 'https://bushido.example.com/')
assert.equal(handoffTarget({ hostname: 'climb.example.com', pathname: '/log', search: '?w=1', hash: '#s' }, hosts), 'https://bushido.example.com/log?w=1#s')
// With nothing configured (the default build), nothing ever moves.
assert.equal(handoffTarget({ hostname: 'pulse.example.com', pathname: '/' }), null)
assert.equal(handoffTarget({ hostname: 'pulse.example.com', pathname: '/' }, { from: ['pulse.example.com'], to: '' }), null)
assert.equal(handoffTarget(undefined), null)

// withinMs: a prompt answer comes through, a slow one is replaced by the fallback.
assert.equal(await withinMs(Promise.resolve('fast'), 50, 'late'), 'fast')
assert.equal(await withinMs(new Promise(() => {}), 10, 'late'), 'late')
await assert.rejects(withinMs(Promise.reject(new Error('boom')), 50, 'late'), /boom/)

// retirePushSubscription: nothing to do without a service worker (node, old browsers).
const navDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
const setNavigator = (v) => Object.defineProperty(globalThis, 'navigator', { value: v, configurable: true, writable: true })
setNavigator(undefined)
assert.equal(await retirePushSubscription(), false)
setNavigator({})
assert.equal(await retirePushSubscription(), false)

// With a live subscription it tells the server, then drops the browser's copy.
const calls = []
const sub = { endpoint: 'https://push.example/abc', unsubscribe: async () => { calls.push('browser') ; return true } }
const fakeNav = (getSubscription) => ({ serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription } }) } })
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init) => { calls.push([url, JSON.parse(init.body).endpoint]); return { ok: true } }
setNavigator(fakeNav(async () => sub))
assert.equal(await retirePushSubscription(), true)
assert.deepEqual(calls, [['/api/push/unsubscribe', 'https://push.example/abc'], 'browser'])

// No subscription: nothing is sent, and it still counts as done.
calls.length = 0
setNavigator(fakeNav(async () => null))
assert.equal(await retirePushSubscription(), true)
assert.deepEqual(calls, [])

// A registration that never answers must not hold the move up.
setNavigator(fakeNav(() => new Promise(() => {})))
assert.equal(await retirePushSubscription({ timeoutMs: 10 }), false)

// And a throwing one is swallowed, not surfaced.
setNavigator({ serviceWorker: { getRegistration: async () => { throw new Error('no sw') } } })
assert.equal(await retirePushSubscription(), false)

globalThis.fetch = realFetch
if (navDesc) Object.defineProperty(globalThis, 'navigator', navDesc)
console.log('handoff: 15 passed')
