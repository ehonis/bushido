// Whose log this device holds: one cache per person, and every API call says
// whose it is for, so two people's logs can never meet in one outbox.
import assert from 'node:assert/strict'
import { cacheKeyFor, meFrom, loadMe, withUserHeader, actAs, currentMe, ME_KEY, USER_HEADER } from './src/lib/whoami.js'

const tests = []
const test = (name, fn) => tests.push([name, fn])

function storage(init = {}) {
  const m = new Map(Object.entries(init))
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m }
}
const ME_DOC = {
  mode: 'proxy', via: 'proxy', user: null,
  me: { id: 'sam', name: 'Sam', owner: false },
  real: { id: 'owner', name: 'Alex', admin: true },
  acting: true,
  features: { ai: false, whoop: false, strava: false, goals: false, notifications: false },
  people: [{ id: 'owner', name: 'Alex' }, { id: 'sam', name: 'Sam' }],
}
const answering = (doc, status = 200) => async () => ({ ok: status < 400, status, json: async () => doc })
const ORIGIN = 'https://bushido.example'

test('the owner keeps the cache key they always had; anyone else gets their own', () => {
  assert.equal(cacheKeyFor('owner'), 'bushido:cache-v1')
  assert.equal(cacheKeyFor(undefined), 'bushido:cache-v1')
  assert.equal(cacheKeyFor('sam'), 'bushido:cache-v1:sam')
  assert.notEqual(cacheKeyFor('sam'), cacheKeyFor('robin'))
})

test('the server\'s answer is what the page runs as, and is remembered', async () => {
  const s = storage()
  const me = await loadMe({ fetchFn: answering(ME_DOC), storage: s })
  assert.equal(me.id, 'sam')
  assert.equal(me.acting, true)
  assert.equal(me.real.admin, true)
  assert.equal(me.features.ai, false)
  assert.equal(currentMe().id, 'sam')
  assert.ok(s.getItem(ME_KEY), 'not remembered for offline')
})

test('offline, the last answer stands; never asked, it is the owner', async () => {
  const s = storage()
  await loadMe({ fetchFn: answering(ME_DOC), storage: s })
  const offline = async () => { throw new TypeError('network down') }
  assert.equal((await loadMe({ fetchFn: offline, storage: s })).id, 'sam', 'an offline boot forgot whose log was open')
  const fresh = await loadMe({ fetchFn: offline, storage: storage() })
  assert.equal(fresh.id, 'owner')
  assert.equal(fresh.features.ai, true, 'a one-person install lost its features offline')
})

test('a server from before people existed reads as the owner', async () => {
  const me = await loadMe({ fetchFn: answering({ mode: 'proxy', via: 'proxy', user: null }), storage: storage() })
  assert.equal(me.id, 'owner')
  assert.equal(meFrom({ mode: 'proxy' }), null)
})

test('API calls on this origin carry the person; nothing else does', () => {
  const [, init] = withUserHeader('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' } }, 'sam', ORIGIN)
  assert.equal(new Headers(init.headers).get(USER_HEADER), 'sam')
  assert.equal(new Headers(init.headers).get('Content-Type'), 'application/json', 'the existing headers were lost')
  assert.equal(init.method, 'PUT')
  const [, other] = withUserHeader('https://elsewhere.example/api/state', undefined, 'sam', ORIGIN)
  assert.equal(other, undefined, 'the person was sent to another origin')
  const [, page] = withUserHeader('/settings', undefined, 'sam', ORIGIN)
  assert.equal(page, undefined)
  const [req] = withUserHeader(new Request(`${ORIGIN}/api/entry`, { method: 'POST' }), undefined, 'sam', ORIGIN)
  assert.equal(req.headers.get(USER_HEADER), 'sam')
  assert.equal(req.method, 'POST')
})

test('acting as someone asks the server, then reloads; a refusal says why', async () => {
  const calls = []
  let reloaded = false
  await actAs('sam', { fetchFn: async (url, init) => { calls.push([url, JSON.parse(init.body)]); return { ok: true, json: async () => ({ ok: true }) } }, reload: () => { reloaded = true } })
  assert.deepEqual(calls, [['/api/act-as', { id: 'sam' }]])
  assert.ok(reloaded, 'switched without reloading the store')
  reloaded = false
  await assert.rejects(actAs('sam', { fetchFn: async () => ({ ok: false, status: 403, json: async () => ({ error: 'only the owner can do that' }) }), reload: () => { reloaded = true } }), /only the owner/)
  assert.ok(!reloaded, 'reloaded after a refusal')
})

let failed = 0
for (const [name, fn] of tests) {
  try { await fn(); console.log(`  PASS  ${name}`) } catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`) }
}
console.log(failed ? `\n${failed} whoami test(s) failed` : '\nall whoami tests pass')
process.exit(failed ? 1 : 0)
