/* The coach document, and sessions that write test results:
 *   node app/coach.test.js
 *
 * Two small pure modules, both of which decide what reaches the screen from
 * somewhere less trustworthy than the plan — a language model in one case, a
 * half-filled log form in the other. The theme of every case here is the same:
 * when the input is wrong, produce NOTHING rather than something plausible.
 */

import { readFileSync } from 'node:fs'
import {
  coachFor, nudges, changesFor, allChanges, flags, reading, hasAdvice, COACH_VERSION,
} from './src/lib/coach.js'
import { deriveValue, testEntryFor, testEntryId, testFor } from './src/lib/tests.js'

const plan = JSON.parse(readFileSync(new URL('../test/fixtures/plan.json', import.meta.url), 'utf8'))
const opt = (id) => plan.dailyMenu.find(m => m.id === id)

let failed = 0
const check = (name, fn) => {
  try {
    fn()
    console.log(`  PASS  ${name}`)
  } catch (err) {
    failed++
    console.error(`  FAIL  ${name}\n        ${err.message}`)
  }
}
const eq = (got, want, what = '') => {
  if (got !== want) throw new Error(`${what || 'value'}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg) }

const ISO = '2026-08-11'
const note = (over = {}) => ({
  version: COACH_VERSION,
  date: ISO,
  generatedAt: '2026-08-11T07:20:00.000Z',
  model: 'claude-opus-5',
  headline: 'Your fingers have read 3 or better all week.',
  read: ['Two sessions at RPE 8 in three days.'],
  nudges: [],
  flags: [],
  changed: [],
  ...over,
})

/* ------------------------------------------------------------------ dating */

check('a note is advice for exactly one day', () => {
  ok(coachFor(note(), ISO), 'today')
  eq(coachFor(note(), '2026-08-12'), null, 'tomorrow must not read yesterday\'s note')
  eq(coachFor(note({ date: 'soon' }), ISO), null, 'a non-date')
  eq(coachFor(note({ date: undefined }), ISO), null, 'no date at all')
})

check('an unknown version is ignored, not guessed at', () => {
  eq(coachFor(note({ version: 2 }), ISO), null)
  eq(coachFor(note({ version: undefined }), ISO), null)
})

check('nothing at all is a valid state', () => {
  eq(coachFor(null, ISO), null)
  eq(coachFor(undefined, ISO), null)
  eq(coachFor('the coach fell over', ISO), null)
  eq(nudges(null, ISO).size, 0)
  eq(hasAdvice(null, ISO), false)
})

/* ----------------------------------------------------------------- nudges */

check('a nudge needs a session, a number and a reason', () => {
  const n = nudges(note({ nudges: [
    { optId: 'crawls', points: 9, why: 'the pump work is owed' },
    { optId: 'hips', points: 5 },                     // no reason
    { optId: 'core', why: 'no points' },
    { points: 5, why: 'no session' },
    { optId: 'eccentrics', points: 0, why: 'a zero is not a nudge' },
    { optId: 'antagonist', points: 'lots', why: 'not a number' },
  ] }), ISO)
  eq(n.size, 1, 'only the complete one survives')
  eq(n.get('crawls').points, 9)
  eq(n.get('crawls').why, 'the pump work is owed')
})

check('nudges are clamped both ways', () => {
  const cap = 18
  eq(nudges(note({ nudges: [{ optId: 'crawls', points: 9000, why: 'x' }] }), ISO, cap).get('crawls').points, 18)
  eq(nudges(note({ nudges: [{ optId: 'crawls', points: -9000, why: 'x' }] }), ISO, cap).get('crawls').points, -18)
  eq(nudges(note({ nudges: [{ optId: 'crawls', points: 4.7, why: 'x' }] }), ISO, cap).get('crawls').points, 5, 'rounded')
  // A junk cap falls back to the default rather than becoming NaN, which would
  // clamp everything to nothing and silently disable the coach.
  eq(nudges(note({ nudges: [{ optId: 'crawls', points: 9000, why: 'x' }] }), ISO, 'lots').get('crawls').points, 18)
})

check('a session cannot be nudged twice', () => {
  const n = nudges(note({ nudges: [
    { optId: 'crawls', points: 6, why: 'first' },
    { optId: 'crawls', points: 18, why: 'second' },
  ] }), ISO)
  eq(n.size, 1)
  eq(n.get('crawls').points, 6, 'the first one wins; they must not stack to 24')
})

/* ------------------------------------------------------- the audit trail */

check('a plan edit is attributable to the session it changed', () => {
  const coach = note({ changed: [
    { optId: 'crawls', what: 'raised the working stair to 3', why: 'RPE 4 twice' },
    { optId: 'hips', what: 'nothing recorded', why: '' },
  ] })
  const c = changesFor(coach, 'crawls')
  eq(c.length, 1)
  eq(c[0].what, 'raised the working stair to 3')
  eq(c[0].date, ISO, 'the change is dated even when the entry is not')
  eq(changesFor(coach, 'max-hangs').length, 0, 'a session it did not touch')
  eq(changesFor(null, 'crawls').length, 0)
})

check('the change label outlives the day the change was made', () => {
  // Nudges expire at midnight; edits do not. An edit made on Monday is still an
  // edit on Wednesday, and the label has to survive as long as the change does.
  const coach = note({ date: '2026-08-10', changed: [{ optId: 'crawls', what: 'raised the stair', why: 'x' }] })
  eq(nudges(coach, ISO).size, 0, 'yesterday\'s nudges are gone')
  eq(changesFor(coach, 'crawls').length, 1, 'yesterday\'s edit is still labelled')
})

check('an edit with nothing in it is not an edit', () => {
  eq(allChanges(note({ changed: [{ optId: 'crawls' }, { what: '   ' }] })).length, 0)
  eq(allChanges(note({ changed: [{ what: 'reworded a cue', why: 'it was ambiguous' }] })).length, 1,
    'a change need not name a session — some of them are plan-wide')
})

/* --------------------------------------------------- flags and the reading */

check('flags carry one of two tones and never an empty one', () => {
  const f = flags(note({ flags: [
    { tone: 'warn', text: 'Skin has read 4 twice.' },
    { text: 'no tone given' },
    { tone: 'shouting', text: 'unknown tone' },
    { tone: 'warn', text: '' },
  ] }), ISO)
  eq(f.length, 3)
  eq(f[0].tone, 'warn')
  eq(f[1].tone, 'info', 'the default')
  eq(f[2].tone, 'info', 'an unknown tone is not a new tone')
})

check('a coach with nothing to say renders nothing', () => {
  eq(hasAdvice(note({ headline: '', read: [] }), ISO), false)
  ok(hasAdvice(note(), ISO), 'a headline alone is worth showing')
  ok(hasAdvice(note({ headline: '', read: [], nudges: [{ optId: 'crawls', points: 8, why: 'x' }] }), ISO),
    'so is a nudge with no prose')
  ok(hasAdvice(note({ headline: '', read: [], changed: [{ what: 'x', why: 'y' }] }), ISO),
    'and a plan edit always shows, whatever else it said')
})

check('the observations are bounded, because this is read on a phone', () => {
  const r = reading(note({ read: Array.from({ length: 20 }, (_, i) => `observation ${i}`) }), ISO)
  eq(r.read.length, 6, 'six at most')
})

/* ------------------------------------------- sessions that write test results */

check('the peak force session writes onto the peak force chart', () => {
  const session = opt('mvc-test')
  ok(session.writesTest, 'the session should declare writesTest')
  eq(testFor(plan, session).id, 'mvc-block')
  const e = testEntryFor({ plan, session, date: '2026-08-10', out: { leftKg: 55.15, rightKg: 52.41, rpe: 8 } })
  eq(e.kind, 'test')
  eq(e.date, '2026-08-10')
  eq(e.data.testId, 'mvc-block')
  eq(e.data.leftKg, 55.15)
  eq(e.data.rightKg, 52.41)
  eq(e.data.avgKg, 53.78, 'the derived average')
  eq(e.data.rpe, undefined, 'an RPE slider is not a strength metric')
  eq(e.id, testEntryId('2026-08-10', 'mvc-block'), 'stable, so editing corrects rather than duplicates')
})

check('a half-run test derives nothing it cannot derive', () => {
  const session = opt('mvc-test')
  const e = testEntryFor({ plan, session, date: '2026-08-10', out: { leftKg: 55.15 } })
  eq(e.data.leftKg, 55.15)
  eq(e.data.avgKg, undefined, 'an average of one hand is a wrong number, not a partial one')
})

check('the MVC-7 session writes the anchor, and works out the percentage itself', () => {
  const session = opt('mvc7-test')
  ok(session.writesTest, 'the session should declare writesTest')
  eq(testFor(plan, session).id, 'mvc7')
  const e = testEntryFor({ plan, session, date: '2026-08-11', out: { addedLb: 30, bodyweightLb: 160, skin: 2 } })
  eq(e.data.testId, 'mvc7')
  eq(e.data.addedLb, 30)
  eq(e.data.bodyweightLb, 160)
  eq(e.data.pctBw, 118.75, 'total load over bodyweight — the headline number, never typed by hand')
  eq(e.data.skin, undefined, 'a skin slider is not a strength metric')
})

check('a ratio derives nothing without both halves of it', () => {
  const session = opt('mvc7-test')
  const e = testEntryFor({ plan, session, date: '2026-08-11', out: { addedLb: 30 } })
  eq(e.data.addedLb, 30, 'what was logged still counts')
  eq(e.data.pctBw, undefined, 'a percentage of a bodyweight nobody typed is not a measurement')
  // Guarding the denominator matters more here than it looks: a zero would come
  // out as Infinity and land on a chart as a real point.
  eq(deriveValue({ sum: ['addedLb', 'bodyweightLb'], pctOf: 'bodyweightLb' }, { addedLb: 30, bodyweightLb: 0 }), null)
  eq(deriveValue({ sum: [], pctOf: 'bodyweightLb' }, { bodyweightLb: 186 }), null)
  eq(deriveValue([], {}), null, 'and an empty average derives nothing either')
})

check('a session with nothing measured writes no result at all', () => {
  const session = opt('mvc-test')
  eq(testEntryFor({ plan, session, date: '2026-08-10', out: {} }), null, 'planning is not testing')
  eq(testEntryFor({ plan, session, date: '2026-08-10', out: { rpe: 8, fingers: 2 } }), null,
    'an RPE alone is not a test result')
  eq(testEntryFor({ plan, session, date: '2026-08-10', out: { leftKg: 'strong' } }), null)
  eq(testEntryFor({ plan, session, date: null, out: { leftKg: 55 } }), null, 'an undated result is not a point')
})

check('an ordinary session writes no test, and never has', () => {
  eq(testFor(plan, opt('max-hangs')), null)
  eq(testEntryFor({ plan, session: opt('max-hangs'), date: '2026-08-10', out: { maxLoad: 219 } }), null)
  eq(testEntryFor({ plan, session: undefined, date: '2026-08-10', out: {} }), null)
})

check('every writesTest in the plan points at a test that exists', () => {
  for (const m of plan.dailyMenu) {
    if (!m.writesTest) continue
    const test = testFor(plan, m)
    ok(test, `${m.id} writes to a test that is not in plan.tests`)
    const metrics = new Set(test.metrics.map(x => x.key))
    const spec = typeof m.writesTest === 'string' ? {} : m.writesTest
    for (const key of Object.keys(spec.derive || {})) {
      ok(metrics.has(key), `${m.id} derives "${key}", which ${test.id} does not chart`)
    }
    // A session that writes a test but shares no field names with it would
    // silently never write anything.
    const shared = (m.outputs || []).some(o => metrics.has(o.key))
    ok(shared, `${m.id} declares writesTest but logs none of ${test.id}'s metrics`)
  }
})

console.log(failed ? `\n${failed} test(s) failed` : '\nall coach tests pass')
process.exit(failed ? 1 : 0)
