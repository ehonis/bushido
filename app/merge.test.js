// The client's and the server's last-write-wins merge (#98, H F6), fed the same
// inputs. They share the rule (per entry, on its own updatedAt, a tie to the
// incoming copy, tombstones as entries, settings by settingsUpdatedAt) and the
// comment above lib/store.js `mergeState` used to claim they were identical.
// They are not: the server also stamps an entry that arrives with no updatedAt
// and keeps an old client's bare untick (`keepUntick`). The shared cases are
// held equal here; the two differences are pinned as differences, so neither
// side is "fixed" to match the other by someone trusting a comment.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { mergeState as clientMerge } from './src/lib/store.js'

const require = createRequire(import.meta.url)
const { mergeState: serverMerge } = require('../server/server.js')

const tests = []
const test = (name, fn) => tests.push([name, fn])

const e = (id, updatedAt, data = {}, more = {}) => ({ id, kind: 'daily', date: '2026-11-08', updatedAt, data, ...more })
const base = () => ({
  entries: {
    a: e('a', '2026-11-08T10:00:00.000Z', { name: 'Old' }),
    b: e('b', '2026-11-08T12:00:00.000Z', { name: 'Kept' }),
    c: e('c', '2026-11-08T09:00:00.000Z', { name: 'Going' }),
  },
  settings: { units: 'lb' },
  settingsUpdatedAt: '2026-11-08T08:00:00.000Z',
})

const SHARED = [
  ['a newer entry wins', { entries: { a: e('a', '2026-11-08T11:00:00.000Z', { name: 'New' }) } }],
  ['an older entry loses', { entries: { b: e('b', '2026-11-08T11:00:00.000Z', { name: 'Stale' }) } }],
  ['a tie goes to the incoming copy', { entries: { a: e('a', '2026-11-08T10:00:00.000Z', { name: 'Same time' }) } }],
  ['a newer tombstone deletes', { entries: { c: e('c', '2026-11-08T10:00:00.000Z', {}, { deleted: true }) } }],
  ['an older tombstone does not', { entries: { b: e('b', '2026-11-08T01:00:00.000Z', {}, { deleted: true }) } }],
  ['a new entry is added under its key', { entries: { z: e('elsewhere', '2026-11-08T13:00:00.000Z', { name: 'New one' }) } }],
  ['what is not an entry is skipped', { entries: { x: null, y: 'nope', a: e('a', '2026-11-08T11:00:00.000Z') } }],
  ['newer settings win', { entries: {}, settings: { units: 'kg' }, settingsUpdatedAt: '2026-11-08T09:00:00.000Z' }],
  ['older settings lose', { entries: {}, settings: { units: 'kg' }, settingsUpdatedAt: '2026-11-08T07:00:00.000Z' }],
  ['a done entry ticked done again is just newer', { entries: { a: e('a', '2026-11-08T11:00:00.000Z', { done: true }) } }],
]

for (const [name, incoming] of SHARED) {
  test(`same answer: ${name}`, () => {
    const b1 = base(), b2 = base()
    const c = clientMerge(b1, structuredClone(incoming))
    const s = serverMerge(b2, structuredClone(incoming))
    assert.deepEqual(c, s, 'the client and the server merge disagree')
    assert.deepEqual(b1, base(), 'the merge changed what it was given')
  })
}

test('the cases say what they claim', () => {
  const m = clientMerge(base(), SHARED[0][1])
  assert.equal(m.entries.a.data.name, 'New')
  assert.equal(clientMerge(base(), SHARED[1][1]).entries.b.data.name, 'Kept')
  assert.equal(clientMerge(base(), SHARED[2][1]).entries.a.data.name, 'Same time')
  assert.equal(clientMerge(base(), SHARED[3][1]).entries.c.deleted, true)
  assert.equal(clientMerge(base(), SHARED[5][1]).entries.z.id, 'z', 'the key, not the body, is the id')
  assert.equal(clientMerge(base(), SHARED[7][1]).settings.units, 'kg')
  assert.equal(clientMerge(base(), SHARED[8][1]).settings.units, 'lb')
})

test('a difference, on purpose: only the server stamps an entry that arrives with no updatedAt', () => {
  const incoming = { entries: { n: { id: 'n', kind: 'daily', date: '2026-11-08', data: {} } } }
  assert.equal(clientMerge(base(), incoming).entries.n.updatedAt, undefined)
  assert.ok(serverMerge(base(), incoming).entries.n.updatedAt, 'the server kept an unstamped entry unstamped')
})

test("a difference, on purpose: only the server keeps an old client's bare untick as one (keepUntick)", () => {
  const b = base()
  b.entries.a.data = { done: true }
  const incoming = { entries: { a: e('a', '2026-11-08T11:00:00.000Z', { done: false }) } }
  assert.equal(clientMerge(structuredClone(b), incoming).entries.a.data.undone, undefined)
  assert.equal(serverMerge(structuredClone(b), incoming).entries.a.data.undone, true)
})

test('the comment on the client merge says what it shares and what it does not', () => {
  for (const f of ['./src/lib/store.js', '../mobile/src/lib/store.js']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8')
    if (/Identical to the server's/.test(src)) throw new Error(`${f} claims the merges are identical again`)
    if (!/keepUntick/.test(src) || !/app\/merge\.test\.js/.test(src)) throw new Error(`${f} no longer names the difference and this test`)
  }
})

let failed = 0
for (const [name, fn] of tests) {
  try { await fn(); console.log(`  ok  ${name}`) } catch (err) { failed += 1; console.log(`  FAIL ${name}\n       ${err.message}`) }
}
console.log(failed ? `${failed} of ${tests.length} merge cases failed` : `${tests.length} merge cases`)
process.exit(failed ? 1 : 0)
