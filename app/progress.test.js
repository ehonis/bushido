/* The Progress filter and its charts:
 *   node app/progress.test.js
 *
 * The 2026-09-15 rebuild. The old page hardcoded ~20 charts and drew every one
 * every time; this one asks a question first and draws the charts that answer it.
 *
 * Tested as arithmetic rather than through a rendered page, because the claims
 * worth being sure of are claims about SETS — "filtering to the half iron
 * excludes every finger session" is either true of the resolved entries or it is
 * not, and a screenshot on the day you tried it proves nothing about the day a
 * new category arrives.
 */

import { readFileSync } from 'node:fs'
import { achievements, categorySet } from './src/lib/achievements.js'
import {
  EMPTY_SCOPE, resolveScope, scopeOptions, describeScope, weeksIn,
} from './src/lib/scope.js'
import { metricsFor, totalsFor, METRICS, declaredMetrics } from './src/lib/metrics.js'

const plan = JSON.parse(readFileSync(new URL('../test/fixtures/plan.json', import.meta.url), 'utf8'))

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
const ok = (cond, msg) => { if (!cond) throw new Error(msg) }

const TODAY = '2026-09-15'
const ALL = { ...EMPTY_SCOPE, weeks: null }

const did = (date, optId, out = {}, extra = {}) => ({
  id: `daily-${date}-${optId}-${Math.random().toString(36).slice(2, 6)}`,
  kind: 'daily', date, data: { optId, level: 3, done: true, minutes: 60, out, ...extra },
})
const ride = (date, mi) => did(date, 'log-workout', { activity: 'bike', distance: mi, rpe: 6, speed: 15 })
const run = (date, mi) => did(date, 'log-workout', { activity: 'run', distance: mi, rpe: 7 })
const hangs = (date) => did(date, 'max-hangs', { rpe: 8, fingers: 3, hardFingers: true }, { level: 4 })
const lift = (date, exercise, sets) =>
  did(date, 'log-workout', { activity: 'lift', rpe: 6, lifts: [{ exercise, name: exercise, sets }] })

const LOG = [
  ride('2026-09-01', 18), ride('2026-09-08', 24.2), ride('2026-09-12', 31),
  run('2026-09-03', 3.1), run('2026-09-10', 5),
  hangs('2026-09-02'), hangs('2026-09-07'), hangs('2026-09-14'),
  did('2026-09-05', 'board', { rpe: 8, fingers: 3, hardFingers: true }, { level: 4 }),
  did('2026-09-09', 'off', {}, { level: 0 }),
  lift('2026-09-04', 'bench-press', [{ reps: 8, weight: 135 }, { reps: 8, weight: 155 }]),
  lift('2026-09-11', 'bench-press', [{ reps: 8, weight: 145 }, { reps: 6, weight: 165 }]),
  lift('2026-09-11', 'deadlift', [{ reps: 5, weight: 275 }]),
]

const res = (scope) => resolveScope({ plan, entries: LOG, scope: { ...ALL, ...scope }, today: TODAY })

/* ================================================================= scoping === */

check('an empty scope is everything, honestly', () => {
  const r = res({})
  // Eleven workouts; the rest day is set aside rather than counted or dropped.
  eq(r.entries.length, 12)
  eq(r.rests.length, 1)
  ok(!r.isEmpty)
})

check('a rest day is not a workout, and not a gap either', () => {
  // It has no distance, no grade and no exercises, so counting it would drag
  // every average toward zero — but a week of five sessions and two rests is a
  // different week from five sessions and two unexplained gaps.
  const r = res({})
  ok(!r.entries.some(e => e.data.optId === 'off'), 'a rest day is in the workout set')
  eq(r.rests[0].data.optId, 'off')
})

check('THE ASK: filtering to an achievement excludes everything the others own', () => {
  const iron = res({ achievement: 'half-iron' })
  ok(iron.entries.length > 0, 'the half iron should have rides and runs')
  ok(!iron.disciplines.has('climbing'), `climbing leaked in: ${[...iron.disciplines]}`)
  for (const c of iron.categories) {
    ok(['swim', 'bike', 'run'].includes(c), `${c} is not a half-iron category`)
  }

  const climb = res({ achievement: 'climb-12a' })
  ok(!climb.disciplines.has('bike') && !climb.disciplines.has('run'),
    `endurance leaked in: ${[...climb.disciplines]}`)
})

check('an achievement names categories that exist', () => {
  const list = achievements(plan, [])
  eq([...categorySet(list, 'half-iron')].sort(), ['bike', 'run', 'swim'])
  eq(categorySet(list, null), null, 'no achievement means not narrowed, not narrowed to nothing')
  eq([...categorySet(list, 'no-such-achievement')], [],
    'a deleted achievement matches nothing rather than silently matching everything')
})

check('filtering to a category', () => {
  const r = res({ category: 'bike' })
  eq(r.entries.length, 3)
  eq([...r.disciplines], ['bike'])
})

check('"just one thing" matches the ACTIVITY, not the card it was logged on', () => {
  // Nine rides and two runs share one card. Filtering by `log-workout` would be
  // filtering by an implementation detail the user should never have to know about.
  const r = res({ session: 'bike' })
  eq(r.entries.length, 3)
  ok(r.entries.every(e => e.data.out.activity === 'bike'))
})

check('...and still matches a climbing card by its own id', () => {
  eq(res({ session: 'max-hangs' }).entries.length, 3)
})

check('filtering to one lift exercise', () => {
  const r = res({ exercise: 'bench-press' })
  eq(r.entries.length, 2)
  eq(r.exercise, 'bench-press')
  // The deadlift session on the same day is excluded; the bench sessions are not.
  ok(r.entries.every(e => e.data.out.lifts.some(l => l.exercise === 'bench-press')))
})

check('filters compose rather than override', () => {
  eq(res({ achievement: 'half-iron', category: 'run' }).entries.length, 2)
  eq(res({ achievement: 'climb-12a', category: 'bike' }).entries.length, 0,
    'a category outside the achievement yields nothing, rather than ignoring it')
})

check('a window is whole weeks, so the bars line up with the Week tab', () => {
  const r = resolveScope({ plan, entries: LOG, scope: { ...EMPTY_SCOPE, weeks: 2 }, today: TODAY })
  eq(r.from, '2026-09-07', 'two weeks back from the Monday of 2026-09-15')
  ok(r.entries.every(e => e.date >= '2026-09-07'))
})

check('an impossible filter says so rather than rendering an empty page', () => {
  const r = res({ category: 'swim' })
  eq(r.isEmpty, true)
  eq(r.entries.length, 0)
})

/* ================================================================ options === */

check('the filter only offers what he has actually logged', () => {
  // A dropdown offering eleven categories when the user has logged five mostly returns
  // empty charts, and a control that usually shows nothing teaches you not to
  // touch it.
  const o = scopeOptions({ plan, entries: LOG, today: TODAY, weeks: null })
  eq(o.categories.map(c => c.value).sort(), ['bike', 'fingers', 'lift', 'pe', 'run'])
  ok(!o.categories.some(c => c.value === 'swim'), 'he has never swum')
  eq(o.exercises.map(e => e.value).sort(), ['bench-press', 'deadlift'])
})

check('options carry counts, and sort by them', () => {
  const o = scopeOptions({ plan, entries: LOG, today: TODAY, weeks: null })
  eq(o.categories.find(c => c.value === 'bike').n, 3)
  eq(o.categories.find(c => c.value === 'run').n, 2)
  const ns = o.categories.map(c => c.n)
  eq(ns, [...ns].sort((a, b) => b - a), 'not sorted by count')
  // Bike and fingers both have three, so the tie breaks alphabetically by LABEL
  // — stable across renders, which a tie broken by insertion order would not be.
  eq(o.categories.slice(0, 2).map(c => c.value), ['bike', 'fingers'])
})

check('an achievement with nothing logged against it is not offered', () => {
  const onlyClimbing = LOG.filter(e => e.data.optId === 'max-hangs')
  const o = scopeOptions({ plan, entries: onlyClimbing, today: TODAY, weeks: null })
  eq(o.achievements.map(a => a.value), ['climb-12a'])
})

check('the exercise list names the movement, not its key', () => {
  const o = scopeOptions({ plan, entries: LOG, today: TODAY, weeks: null })
  eq(o.exercises.find(e => e.value === 'bench-press').label, 'Bench press')
})

check('the page says what it is showing', () => {
  const o = scopeOptions({ plan, entries: LOG, today: TODAY, weeks: null })
  eq(describeScope({ plan, scope: ALL, options: o }), 'Everything · all time')
  eq(describeScope({ plan, scope: { ...ALL, category: 'bike', weeks: 8 }, options: o }),
    'Bike · last 8 weeks')
  eq(describeScope({ plan, scope: { ...ALL, exercise: 'bench-press' }, options: o }),
    'Bench press · all time')
})

/* ================================================================ metrics === */

const labels = (r) => metricsFor(plan, r).flatMap(g => g.metrics.map(m => m.label))

check('THE POINT: a chart that means nothing here is not drawn', () => {
  const iron = labels(res({ achievement: 'half-iron' }))
  ok(!iron.some(l => /finger/i.test(l)), `a finger chart under the half iron: ${iron}`)
  ok(iron.some(l => /Miles/.test(l)), 'the half iron should chart miles')

  const fingers = labels(res({ category: 'fingers' }))
  ok(!fingers.some(l => /Miles|speed/i.test(l)), `a distance chart under fingers: ${fingers}`)
  ok(fingers.some(l => /Hard finger days/.test(l)))
})

check('the universal charts are universal', () => {
  for (const scope of [{}, { achievement: 'half-iron' }, { category: 'fingers' }, { exercise: 'bench-press' }]) {
    const l = labels(res(scope))
    ok(l.some(x => /Training load/.test(x)), `no load chart for ${JSON.stringify(scope)}`)
    ok(l.some(x => /Workouts per week/.test(x)), `no session count for ${JSON.stringify(scope)}`)
  }
})

check('one lift gets the strength charts, and nothing else does', () => {
  const bench = labels(res({ exercise: 'bench-press' }))
  ok(bench.some(l => /Top set/.test(l)), `no top-set chart: ${bench}`)
  ok(!labels(res({})).some(l => /Top set/.test(l)),
    'a top-set chart with no exercise picked is a top set of what?')
})

check('the top set is the heaviest set, not the last one', () => {
  const r = res({ exercise: 'bench-press' })
  const m = metricsFor(plan, r).flatMap(g => g.metrics).find(x => x.key === 'topLoad')
  eq(m.points.map(p => p.y), [155, 165])
})

check('volume is load times reps, summed over the sets of THAT movement', () => {
  const r = res({ exercise: 'bench-press' })
  const m = metricsFor(plan, r).flatMap(g => g.metrics).find(x => x.key === 'exVolume')
  eq(m.points[0].y, 8 * 135 + 8 * 155)
})

check('a line needs two points before it is a trend', () => {
  // A line through one measurement is a dot with an axis, and the old page drew
  // several of them.
  const one = resolveScope({ plan, entries: [ride('2026-09-08', 20)], scope: ALL, today: TODAY })
  ok(!labels(one).some(l => /Average speed|Longest/.test(l)),
    'a one-point line was drawn')
})

check('a bar series is the same { x, y } shape as a line series', () => {
  // So a metric can change kind without its series changing shape — and so a
  // chart component never silently renders "nothing logged" for data it was given.
  const r = res({ category: 'bike' })
  const bars = metricsFor(plan, r).flatMap(g => g.metrics).find(m => m.key === 'miles').points
  ok(bars.every(b => 'x' in b && 'y' in b), `got ${JSON.stringify(bars[0])}`)
  ok(bars.every(b => Number.isFinite(b.y)), 'a non-finite bar renders as an empty chart')
})

check('a bar chart of one week is still a fact', () => {
  const one = resolveScope({ plan, entries: [ride('2026-09-08', 20)], scope: ALL, today: TODAY })
  ok(labels(one).some(l => /Miles per week/.test(l)))
})

check('the hard-finger chart carries the cap as its reference line', () => {
  const m = metricsFor(plan, res({ category: 'fingers' }))
    .flatMap(g => g.metrics).find(x => x.key === 'hardFingers')
  eq(m.ref, plan.recommender.hardCap)
})

check("the plan's own specific charts survive, but only in their session's scope", () => {
  // Sixteen of these exist — CFmin, straddle reach, 4×4 rest. They are why the
  // old page was unreadable, and each is still a real number tied to a protocol.
  const entries = [
    did('2026-09-02', 'unilateral', { targetKg: 17, rpe: 5 }),
    did('2026-09-09', 'unilateral', { targetKg: 18, rpe: 5 }),
    ride('2026-09-03', 12),
  ]
  const inScope = resolveScope({ plan, entries, scope: { ...ALL, session: 'unilateral' }, today: TODAY })
  ok(labels(inScope).some(l => /Sub-threshold target/.test(l)), 'the declared chart is missing')

  const out = resolveScope({ plan, entries, scope: { ...ALL, category: 'bike' }, today: TODAY })
  ok(!labels(out).some(l => /Sub-threshold target/.test(l)),
    'a finger protocol chart appeared under a bike filter')
})

check('a declared chart with one point is not drawn either', () => {
  const entries = [did('2026-09-02', 'unilateral', { targetKg: 17 })]
  const r = resolveScope({ plan, entries, scope: ALL, today: TODAY })
  eq(declaredMetrics(plan, r), [])
})

check('every metric in the registry is renderable', () => {
  for (const m of METRICS) {
    ok(m.key && m.label && m.group, `${m.key}: missing key, label or group`)
    ok(['line', 'bar'].includes(m.kind), `${m.key}: unknown kind ${m.kind}`)
    ok(typeof m.applies === 'function' && typeof m.series === 'function', `${m.key}: not a metric`)
  }
  const keys = METRICS.map(m => m.key)
  eq(keys.length, new Set(keys).size, 'duplicate metric keys')
})

/* ================================================================= totals === */

check('the totals add up what is in scope, and only that', () => {
  eq(totalsFor(plan, res({ category: 'bike' })).miles, 73.2)
  eq(totalsFor(plan, res({ category: 'run' })).miles, 8.1)
  eq(totalsFor(plan, res({ achievement: 'half-iron' })).miles, 81.3)
  eq(totalsFor(plan, res({ category: 'fingers' })).miles, 0, 'hangboarding has no mileage')
})

check('A RENAMED CARD DOES NOT MAKE A BIKE RIDE A HARD FINGER DAY', () => {
  // `isHardEntry` falls through to "level 4 or more" for sessions whose finger
  // load is genuinely unknown in advance. An entry whose card has been renamed
  // used to resolve to NOTHING and hit that fallback — so the nine pre-pivot bike
  // rides became hard finger days the moment the card was renamed, inverting the
  // one thing this predicate exists to guarantee.
  const oldRide = {
    id: 'old-1', kind: 'daily', date: '2026-09-06',
    data: { optId: 'other-training', level: 4, done: true, minutes: 120,
            out: { activity: 'bike', distance: 40, rpe: 9 } },
  }
  const r = resolveScope({ plan, entries: [oldRide], scope: ALL, today: TODAY })
  eq(totalsFor(plan, r).hardFingerDays, 0, 'a savage ride costs the fingers nothing')
  eq(totalsFor(plan, r).miles, 40, 'and it is still a ride')
})

check('a commute adds miles and adds no load', () => {
  const commute = {
    id: 'c1', kind: 'daily', date: '2026-09-08',
    data: { optId: 'log-workout', level: 1, done: true, minutes: 9, training: false,
            out: { activity: 'bike', distance: 1.75, rpe: 3 } },
  }
  const withIt = totalsFor(plan, resolveScope({ plan, entries: [...LOG, commute], scope: ALL, today: TODAY }))
  const without = totalsFor(plan, res({}))
  // Absolute, not a difference: the totals are rounded to one decimal, and
  // subtracting two rounded numbers is how you get 1.7999999999999972.
  eq(without.miles, 81.3)
  eq(withIt.miles, 83.1, 'the miles count')
  eq(withIt.load, without.load, 'the load does not')
  eq(withIt.sessions, without.sessions + 1, 'and it is still a thing he did')
})

check('hard finger days are counted on what he LOGGED', () => {
  // The same predicate the two unbypassable rules use, so the chart and the
  // blocker can never disagree about what a hard day was.
  eq(totalsFor(plan, res({})).hardFingerDays, 4)
  eq(totalsFor(plan, res({ achievement: 'half-iron' })).hardFingerDays, 0)
})

check('an empty scope totals to zero rather than to NaN', () => {
  const t = totalsFor(plan, res({ category: 'swim' }))
  eq(t, { sessions: 0, days: 0, rests: 1, hours: 0, miles: 0, yards: 0, load: 0, hardFingerDays: 0 })
})

check('the week axis covers the window even where nothing was logged', () => {
  // A gap week has to be a visible zero rather than a missing bar, or a fortnight
  // off reads as a fortnight that never happened.
  const r = resolveScope({ plan, entries: [ride('2026-08-24', 10), ride('2026-09-14', 10)],
    scope: ALL, today: TODAY })
  const weeks = weeksIn(r, TODAY)
  eq(weeks, ['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14'])
  const bars = metricsFor(plan, r).flatMap(g => g.metrics).find(m => m.key === 'miles').points
  eq(bars.map(b => b.y), [10, 0, 0, 10])
})

console.log(failed ? `\n${failed} progress test(s) failed` : '\nall progress tests pass')
process.exit(failed ? 1 : 0)
