/* The header streak:
 *   node app/streak.test.js
 *
 * It moved out of the Today tile row into the header on 2026-09-15, which made it
 * the one number on screen that is not attached to the day being viewed. The rule
 * worth pinning is the GRACE DAY: an unlogged today does not break the streak,
 * because at 9am nobody has trained yet.
 */

import { streakDays, trainedDates } from './src/lib/streak.js'

let failed = 0
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`) }
  catch (err) { failed++; console.error(`  FAIL  ${name}\n        ${err.message}`) }
}
const eq = (got, want, what = '') => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error(`${what || 'value'}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
  }
}

const day = (date, extra = {}) => ({
  id: `daily-${date}`, kind: 'daily', date,
  data: { optId: 'lead-laps', level: 3, done: true, ...extra },
})

check('consecutive days count', () => {
  eq(streakDays([day('2026-09-13'), day('2026-09-14'), day('2026-09-15')], '2026-09-15'), 3)
})

check('THE GRACE DAY: nothing logged today does not break it', () => {
  eq(streakDays([day('2026-09-13'), day('2026-09-14')], '2026-09-15'), 2,
    'a counter that reads zero every morning is wrong most of the time you look')
})

check('a gap before today does break it', () => {
  eq(streakDays([day('2026-09-11'), day('2026-09-12'), day('2026-09-14')], '2026-09-15'), 1)
})

check('nothing logged at all is zero, and the header renders nothing', () => {
  eq(streakDays([], '2026-09-15'), 0)
})

check('a session put on the day but not finished does not count', () => {
  // Putting a session on the day is planning; completing it is a separate act.
  // Today's counts as the grace day, so the chain behind it still stands.
  eq(streakDays([day('2026-09-15', { done: false }), day('2026-09-14'), day('2026-09-13')],
    '2026-09-15'), 2)
})

check('an unfinished day in the middle breaks the chain outright', () => {
  // Not "skipped" — it is a gap, and everything before it is behind a gap.
  eq(streakDays([day('2026-09-14', { done: false }), day('2026-09-13')], '2026-09-15'), 0)
})

check('a deleted entry is a gap like any other', () => {
  const gone = { ...day('2026-09-14'), deleted: true }
  eq(streakDays([gone, day('2026-09-13')], '2026-09-15'), 0)
})

check('a commute counts — it is miles and a streak day, just not load', () => {
  eq(streakDays([day('2026-09-14', { training: false }), day('2026-09-15')], '2026-09-15'), 2)
})

check('two entries on one day are still one day', () => {
  const both = [day('2026-09-15'), { ...day('2026-09-15'), id: 'daily-2026-09-15-extra' }]
  eq(streakDays([...both, day('2026-09-14')], '2026-09-15'), 2)
})

check('only daily entries count', () => {
  const weight = { id: 'bodyweight-2026-09-14', kind: 'bodyweight', date: '2026-09-14', data: { lb: 150 } }
  eq(streakDays([weight, day('2026-09-15')], '2026-09-15'), 1)
})

check('trainedDates is the set behind it', () => {
  eq([...trainedDates([day('2026-09-14'), day('2026-09-15')])].sort(), ['2026-09-14', '2026-09-15'])
})

console.log(failed ? `\n${failed} streak test(s) failed` : '\nall streak tests pass')
process.exit(failed ? 1 : 0)
