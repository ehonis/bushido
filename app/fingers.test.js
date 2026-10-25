/* Hard finger days, as history reads them (lib/fingers.js):
 *   node app/fingers.test.js
 *
 * What is left of the recommender's tests: the predicate the Progress page's
 * climbing chart still counts with.
 */

import { readFileSync } from 'node:fs'
import { isHardEntry, fingerLoad, hardDates } from './src/lib/fingers.js'

const plan = JSON.parse(readFileSync(new URL('../test/fixtures/plan.json', import.meta.url), 'utf8'))
const menu = plan.dailyMenu
const opt = (id) => menu.find(m => m.id === id)

let failed = 0
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`) } catch (err) { failed++; console.error(`  FAIL  ${name}\n        ${err.message}`) }
}
const eq = (got, want, what = '') => {
  if (got !== want) throw new Error(`${what || 'value'}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg) }

const day = (date, optId, data = {}) => ({
  id: `daily-${date}`, kind: 'daily', date,
  data: { slot: 'main', optId, level: opt(optId)?.level ?? 1, done: true, out: {}, ...data },
})

check('a social day logged at intensity 4 counts as a hard finger day', () => {
  ok(isHardEntry(day('2026-08-12', 'fun-boulder', { level: 4, out: { intensity: 4 } }), menu), 'intensity 4 must count')
})

check('a savage bike ride is a heavy day but not a hard finger day', () => {
  const ride = day('2026-08-12', 'log-workout', { level: 4, out: { activity: 'bike', rpe: 9 } })
  ok(!isHardEntry(ride, menu), 'legs are not fingers')
})

check('the logged answer beats the declaration, both ways', () => {
  const board = menu.find(m => fingerLoad(m) === 'hard' && !m.retired)
  ok(board, 'the fixture has a hard card')
  ok(isHardEntry(day('2026-08-12', board.id), menu), 'declared hard and unanswered')
  ok(!isHardEntry(day('2026-08-12', board.id, { out: { hardFingers: false } }), menu), 'an easy night costs nothing')
})

check('crimp crawls load the fingers without spending a hard exposure', () => {
  eq(fingerLoad(opt('crawls')), 'light')
  ok(!isHardEntry(day('2026-08-12', 'crawls', { level: 3 }), menu), 'it must not spend a hard finger day')
})

check('a retired card still reads: the old home day was a hard day', () => {
  ok(isHardEntry(day('2026-08-10', 'hard-home'), menu), 'history must not be rewritten by a rename')
})

check('hardDates counts days, done ones only (marked undone is not done)', () => {
  const board = menu.find(m => fingerLoad(m) === 'hard' && !m.retired)
  const entries = [
    day('2026-08-10', board.id),
    { ...day('2026-08-10', board.id), id: 'daily-2026-08-10-x', data: { ...day('2026-08-10', board.id).data, slot: 'extra' } },
    day('2026-08-12', board.id, { done: false, undone: true }),
    { id: 'checkin-2026-08-11', kind: 'checkin', date: '2026-08-11', data: { fields: { hardFingers: true } } },
  ]
  eq(JSON.stringify(hardDates(entries, menu)), JSON.stringify(['2026-08-10']))
})

if (failed) { console.error(`\n${failed} failed`); process.exit(1) }
console.log('\nall finger checks passed')
