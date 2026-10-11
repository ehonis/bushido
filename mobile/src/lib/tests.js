/*
 * Sessions that ARE tests.
 *
 * Some sessions produce a number the Testing tab already charts. Before this
 * existed you had to log them twice — once as the session you did, once again in
 * the test runner — and on 2026-08-08 that is exactly what happened: a
 * calibration day in the log, and the peak-force numbers typed in again by hand
 * afterwards. Two records of one afternoon is how a series ends up with a gap in
 * it, because the second entry is the one you forget when you are tired.
 *
 * A session declares `writesTest` in plan.json and logging it writes the test
 * result too:
 *
 *   "writesTest": { "testId": "mvc-block", "derive": { "avgKg": ["leftKg", "rightKg"] } }
 *
 * A derive is either an ARRAY, meaning "the mean of these", or a RATIO:
 *
 *   "derive": { "pctBw": { "sum": ["addedLb", "bodyweightLb"], "pctOf": "bodyweightLb" } }
 *
 * The ratio form exists for the MVC-7, whose headline number is total load as a
 * percentage of bodyweight — a pure function of two numbers already recorded, so
 * asking the user to type it a third time mid-session is how it ends up wrong or
 * blank. There are deliberately only two forms: a derive is arithmetic over
 * fields the session already logged, never a new measurement.
 *
 * Rules, all of them about not inventing data:
 *
 *   - only keys the target test actually declares as METRICS are copied, so an
 *     RPE slider never lands in a strength series;
 *   - a derived metric is written only when every input it averages is present;
 *   - a session with nothing numeric filled in writes NO test entry, rather than
 *     an empty point that would show on the chart as a real measurement;
 *   - the entry id is derived from the date and the test, so editing the session
 *     later corrects that day's result instead of adding a second one.
 */

const round2 = (n) => Math.round(n * 100) / 100

/** The id a session-written test result lives under. Stable, so edits overwrite. */
export const testEntryId = (date, testId) => `test-${date}-${testId}`

/**
 * One derived metric, or null when the session did not log everything it needs.
 *
 * Null rather than a partial answer, everywhere: a mean of one of two hands is a
 * wrong number that looks like a right one, and a percentage of a bodyweight
 * nobody typed is worse — it would land on a strength chart as a measurement.
 */
export function deriveValue(spec, out) {
  const num = (k) => {
    const v = Number(out?.[k])
    return Number.isFinite(v) ? v : null
  }

  if (Array.isArray(spec)) {
    if (!spec.length) return null
    const vals = spec.map(num)
    if (vals.some(v => v == null)) return null
    return round2(vals.reduce((a, b) => a + b, 0) / vals.length)
  }

  if (spec && Array.isArray(spec.sum) && spec.pctOf) {
    if (!spec.sum.length) return null
    const vals = spec.sum.map(num)
    if (vals.some(v => v == null)) return null
    const over = num(spec.pctOf)
    if (over == null || over <= 0) return null // a percentage of zero is not a number
    return round2((vals.reduce((a, b) => a + b, 0) / over) * 100)
  }

  return null
}

/** The test definition a session writes into, or null if it writes none. */
export function testFor(plan, session) {
  const spec = session?.writesTest
  const testId = typeof spec === 'string' ? spec : spec?.testId
  if (!testId) return null
  return (plan?.tests || []).find(t => t.id === testId) || null
}

/**
 * The test entry a logged session implies, or null if there is nothing to write.
 *
 * Returns a whole entry rather than a patch, so the caller can hand it straight
 * to `upsertEntry` and the store's normal last-write-wins merge does the rest.
 */
export function testEntryFor({ plan, session, date, out }) {
  const test = testFor(plan, session)
  if (!test || !date) return null

  const spec = typeof session.writesTest === 'string' ? { testId: session.writesTest } : session.writesTest
  const metrics = new Set((test.metrics || []).map(m => m.key))
  const data = { testId: test.id, fromSession: session.id }

  let got = 0
  for (const key of metrics) {
    const v = Number(out?.[key])
    if (!Number.isFinite(v)) continue
    data[key] = v
    got++
  }

  for (const [key, from] of Object.entries(spec.derive || {})) {
    if (!metrics.has(key)) continue
    const v = deriveValue(from, out)
    if (v != null) data[key] = v
  }

  // Nothing measured means nothing to chart. Adding the session to the day is
  // not the same as having run the test.
  if (!got) return null

  return { id: testEntryId(date, test.id), kind: 'test', date, data }
}
