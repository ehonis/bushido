/* Sessions that write test results (lib/tests.js):
 *   node app/tests.test.js
 *
 * A half-filled log form decides what reaches the Testing charts. The theme of
 * every case here: when the input is wrong, produce NOTHING rather than
 * something plausible. (These lived in coach.test.js until the coach went.)
 */

import { readFileSync } from 'node:fs'
import { deriveValue, testEntryFor, testEntryId, testFor, measured, testResultFrom } from './src/lib/tests.js'

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

/* ---------------------------------------------- missing is missing (#76) */

check('a blank box is not a measured zero', () => {
  // Number(null) and Number('') are 0: before #76 this wrote left 0, right 0, avg 0.
  eq(testEntryFor({ plan, session: opt('mvc-test'), date: '2026-08-10', out: { leftKg: null, rightKg: '' } }), null,
    'nothing typed writes no result')
  eq(testEntryFor({ plan, session: opt('mvc-test'), date: '2026-08-10', out: { leftKg: '  ', rightKg: false } }), null,
    'a space or a boolean is not a number either')
  const one = testEntryFor({ plan, session: opt('mvc-test'), date: '2026-08-10', out: { leftKg: 50, rightKg: null } })
  eq(one.data.leftKg, 50)
  eq('rightKg' in one.data, false, 'the blank hand stays absent')
  eq('avgKg' in one.data, false, 'and no average of one hand')
  const zero = testEntryFor({ plan, session: opt('mvc-test'), date: '2026-08-10', out: { leftKg: 0, rightKg: 0 } })
  eq(zero.data.leftKg, 0, 'a typed zero is still an answer')
})

check('a ratio of a blank is no ratio', () => {
  const spec = { sum: ['addedLb', 'bodyweightLb'], pctOf: 'bodyweightLb' }
  eq(deriveValue(spec, { addedLb: null, bodyweightLb: 150 }), null, 'a blank added weight is not +0 lb')
  eq(deriveValue(spec, { addedLb: '', bodyweightLb: 150 }), null)
  eq(deriveValue(['leftKg', 'rightKg'], { leftKg: 50, rightKg: '' }), null)
  eq(measured('12.5'), 12.5)
  eq(measured(''), null)
  eq(measured(null), null)
  eq(measured(true), null)
})

check('an empty result from the Testing page cannot be saved', () => {
  const cf = plan.tests.find(t => t.id === 'critical-force')
  eq(testResultFrom(cf, {}, '2026-08-08'), null, 'no boxes')
  eq(testResultFrom(cf, { cfKg: '', cfMinKg: null }, '2026-08-08'), null, 'blank boxes')
  eq(testResultFrom(cf, { cfKg: 18.2 }, ''), null, 'no date')
  const r = testResultFrom(cf, { cfKg: 18.2, cfMinKg: '', bogus: 4 }, '2026-08-08')
  eq(r.kind, 'test')
  eq(r.date, '2026-08-08')
  eq(r.data.testId, 'critical-force')
  eq(r.data.cfKg, 18.2)
  eq('cfMinKg' in r.data, false, 'a blank metric is left out, not zero')
  eq('bogus' in r.data, false, 'only declared metrics')
})

console.log(failed ? `\n${failed} test(s) failed` : '\nall test-result tests pass')
process.exit(failed ? 1 : 0)
