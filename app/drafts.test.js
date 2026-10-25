// AI workout drafts on the app's side: a draft is kept ONCE. The keep gate, the
// drafts a log has already kept, and the one a new draft would throw away.
// See src/lib/drafts.js and server/drafts.js.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  keepGate, placedDraftIds, unplacedDrafts, draftToEvict, DRAFT_MAX,
} from './src/lib/drafts.js'
import { splitPrescription } from './src/lib/prescription.js'

const require = createRequire(import.meta.url)
const tests = []
const test = (name, fn) => tests.push([name, fn])

const claims = (answer) => {
  const asked = []
  return { asked, claim: async (id) => { asked.push(id); return answer } }
}

test('a draft already on an entry is not offered', () => {
  const entries = [
    { id: 'daily-2026-10-25', data: { plan: { draftId: 'dkept1' } } },
    { id: 'daily-2026-10-24', data: { plan: { title: 'by hand' } } },
  ]
  const placed = placedDraftIds(entries, [{ data: { plan: { draftId: 'dtheirs' } } }])
  assert.deepEqual([...placed].sort(), ['dkept1', 'dtheirs'])
  const shown = unplacedDrafts([{ id: 'dkept1' }, { id: 'dnew22' }, { id: 'dtheirs' }], placed)
  assert.deepEqual(shown.map(d => d.id), ['dnew22'])
})

test('the draft id survives every part a kept plan splits into', () => {
  const pres = {
    title: 'Legs then a run', draftId: 'dsplit1',
    blocks: [
      { name: 'Legs', category: 'strength', items: [{ id: 'a', kind: 'lift', name: 'Squat', sets: [{ reps: 5 }] }] },
      { name: 'Run', category: 'run', items: [{ id: 'b', kind: 'interval', name: 'Easy', sets: [{ seconds: 600 }] }] },
    ],
  }
  const parts = splitPrescription(pres)
  assert.equal(parts.length, 2)
  for (const p of parts) assert.equal(p.pres.draftId, 'dsplit1')
})

test('keep is a no-op for a draft this log already has, and the server is not asked', async () => {
  const c = claims({ state: 'claimed' })
  const g = await keepGate({ draftId: 'dkept1', placed: new Set(['dkept1']), claim: c.claim })
  assert.equal(g.go, false)
  assert.equal(g.gone, true)
  assert.deepEqual(c.asked, [])
})

test('keep is refused when another device kept it, and goes back to the list', async () => {
  const g = await keepGate({ draftId: 'dother', placed: new Set(), claim: claims({ state: 'refused', code: 'kept', error: 'gone' }).claim })
  assert.deepEqual([g.go, g.gone, g.error], [false, true, 'gone'])
  // Refused for another reason (still being written): stays where it is, says why.
  const busy = await keepGate({ draftId: 'dbusy1', placed: new Set(), claim: claims({ state: 'refused', error: 'it is still being written' }).claim })
  assert.deepEqual([busy.go, busy.gone], [false, false])
})

test('keep claims first; offline it goes ahead, the stamped entry retiring the draft later', async () => {
  const on = claims({ state: 'claimed' })
  assert.deepEqual(await keepGate({ draftId: 'dfresh', placed: new Set(), claim: on.claim }), { go: true, claimed: true })
  assert.deepEqual(on.asked, ['dfresh'])
  assert.deepEqual(await keepGate({ draftId: 'dfresh', placed: new Set(), claim: claims({ state: 'offline' }).claim }), { go: true, claimed: false })
  // The hand-built route has no draft: nothing to claim.
  assert.deepEqual(await keepGate({ draftId: null, placed: new Set(), claim: on.claim }), { go: true, claimed: false })
})

test('at the cap, the oldest draft not being written is the one named before it goes', () => {
  assert.equal(DRAFT_MAX, require('../server/drafts.js').MAX_DRAFTS, 'the app and the server disagree on the cap')
  const list = Array.from({ length: DRAFT_MAX }, (_, i) => ({ id: `d${i}aaaaaa`, createdAt: `2026-10-${String(10 + i)}`, status: i === 0 ? 'working' : 'ready' }))
  assert.equal(draftToEvict(list).id, 'd1aaaaaa')
  assert.equal(draftToEvict(list.slice(1)), null)
  assert.equal(draftToEvict(list.map(d => ({ ...d, status: 'working' }))), null)
})

let failed = 0
for (const [name, fn] of tests) {
  try { await fn(); console.log('  PASS ', name) } catch (e) { failed++; console.log('  FAIL ', name, '\n        ', e.message) }
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
console.log(`drafts: ${tests.length} passed`)
