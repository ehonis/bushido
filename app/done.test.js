/* Done once a workout's day arrives (AGENTS.md §4, docs/DESIGN.md D2):
 *   node app/done.test.js
 *
 * `isDone` is the one statement of the rule and it has three copies: the app's,
 * the server's (server/notify-facts.js, read by the habit and the push) and the
 * iPhone app's. They are held to the same TEXT here, because a copy that drifts
 * is a streak on the phone that disagrees with the habit on the server.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isDone, doneWhenPlaced, markDone } from './src/lib/store.js'
import { localIso } from './src/lib/dates.js'
import * as server from '../server/notify-facts.js'

let failed = 0
let passed = 0
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  PASS  ${name}`) } catch (err) { failed++; console.error(`  FAIL  ${name}\n        ${err.message}`) }
}

const TODAY = '2026-10-25'
const on = (date, data = {}, extra = {}) => ({ id: `daily-${date}`, kind: 'daily', date, data: { optId: 'planned', ...data }, ...extra })

for (const [who, done] of [['app', isDone], ['server', server.isDone]]) {
  test(`${who}: today, an earlier day and a later day, written as the app writes them now`, () => {
    assert.equal(done(on(TODAY, { done: doneWhenPlaced(TODAY, TODAY) }), TODAY), true, 'today')
    assert.equal(done(on('2026-10-20', { done: doneWhenPlaced('2026-10-20', TODAY) }), TODAY), true, 'an earlier day')
    assert.equal(done(on('2026-10-26', { done: doneWhenPlaced('2026-10-26', TODAY) }), TODAY), false, 'a later day')
  })

  test(`${who}: a planned session is done from its day on, with nothing written`, () => {
    const planned = on('2026-10-26', { done: false })
    const before = JSON.stringify(planned)
    assert.equal(done(planned, '2026-10-25'), false, 'the day before')
    assert.equal(done(planned, '2026-10-26'), true, 'on the day')
    assert.equal(done(planned, '2026-11-30'), true, 'and after')
    assert.equal(JSON.stringify(planned), before, 'reading it wrote something')
  })

  test(`${who}: "Mark undone" always wins and is never flipped back by the date`, () => {
    const undone = markDone(on('2026-10-20', { done: true }), false)
    assert.equal(done(undone, '2026-10-20'), false)
    assert.equal(done(undone, '2027-01-01'), false, 'a month on, still undone')
    assert.equal(done(markDone(on('2026-10-26', { done: false }), false), '2026-10-27'), false, 'undone in advance')
  })

  test(`${who}: "Mark done" after "Mark undone", and done: true over a stale marker`, () => {
    assert.equal(done(markDone(markDone(on('2026-10-20'), false), true), TODAY), true)
    // An older client ticking it keeps the marker it never knew about; true wins.
    assert.equal(done(on('2026-10-20', { done: true, undone: true }), TODAY), true)
  })

  test(`${who}: legacy entries read as they were written, unrewritten`, () => {
    // No flag: only ever created by "log this", always done.
    assert.equal(done(on('2026-06-01', {}), TODAY), true)
    // `done: false` from before the rule, on a past day, never unticked or never
    // ticked: done now (the owner's call; the PR for #27 has the trade-off).
    assert.equal(done(on('2026-09-01', { done: false }), TODAY), true)
    // ...and one with no date stays what it was.
    assert.equal(done({ id: 'x', kind: 'daily', data: { done: false } }, TODAY), false)
  })

  test(`${who}: deleted and missing are never done`, () => {
    assert.equal(done(on('2026-10-20', { done: true }, { deleted: true }), TODAY), false)
    assert.equal(done(null, TODAY), false)
    assert.equal(done(undefined, TODAY), false)
  })

  test(`${who}: a non-date second argument (an index from .filter) means the local today`, () => {
    const local = localIso()
    const tomorrow = localIso(new Date(Date.now() + 36 * 3600 * 1000))
    assert.equal(done(on(local, { done: false }), 0), true, 'today, with an index for today')
    assert.equal(done(on(tomorrow, { done: false }), 1), false, 'tomorrow, with an index for today')
    assert.deepEqual([on(local, { done: false }), on(tomorrow, { done: false })].filter(done).length, 1)
  })
}

test('doneWhenPlaced: true up to today, false after; markDone writes only the pair, and stamps a done tap', () => {
  assert.deepEqual(['2026-10-24', TODAY, '2026-10-26'].map(d => doneWhenPlaced(d, TODAY)), [true, true, false])
  const undone = markDone(on(TODAY, { done: true, out: { rpe: 7 } }), false)
  assert.deepEqual(undone.data, { optId: 'planned', out: { rpe: 7 }, done: false, undone: true })
  const redone = markDone(undone, true, '2026-10-25T18:00:00.000Z')
  assert.deepEqual(redone.data, { optId: 'planned', out: { rpe: 7 }, done: true, doneAt: '2026-10-25T18:00:00.000Z' })
  assert.equal('doneAt' in markDone(redone, false).data, false, 'an undo kept the done stamp')
  assert.equal(undone.id, `daily-${TODAY}`)
})

test('the three copies of isDone are the same text', () => {
  const grab = (path) => {
    const src = readFileSync(new URL(path, import.meta.url), 'utf8')
    const m = src.match(/export const isDone = \(entry, today\) => \{[\s\S]*?\n\}\n/)
    assert.ok(m, `no isDone in ${path}`)
    return m[0]
  }
  const app = grab('./src/lib/store.js')
  assert.equal(grab('../server/notify-facts.js'), app, 'server/notify-facts.js drifted from the app')
  assert.equal(grab('../mobile/src/lib/store.js'), app, 'mobile/src/lib/store.js drifted from the app')
  const helpers = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
    .match(/export const doneWhenPlaced[\s\S]*?\n\}\n/)[0]
  assert.equal(helpers('../mobile/src/lib/store.js'), helpers('./src/lib/store.js'), 'doneWhenPlaced/markDone drifted on mobile')
})

console.log(`done: ${passed} passed${failed ? `, ${failed} failed` : ''}`)
process.exit(failed ? 1 : 0)
