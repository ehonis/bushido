/* Quotas, the activity catalog, and the form shapes:
 *   node app/quota.test.js
 *
 * The three modules the 2026-09-14 pivot turns on. `lib/quota.js` is the week —
 * what it asks for, what filled it, what to offer next. `lib/activities.js` is the
 * ninety-one-sport catalog that replaced a nine-value choice. `lib/outputs.js`
 * gained catalog-derived gates so a field can say "every distance sport" without
 * naming them.
 *
 * Run against the REAL plan.json for the reason lifts.test.js is: the catalog and
 * the gates are content, and a case written against a fixture would pass happily
 * while the shipped card asked a swimmer for their incline.
 */

import { existsSync, readFileSync } from 'node:fs'
import {
  mondayOf, weekDays, shiftWeek, quotaId, quotaCounts, buildQuotaEntry,
  categoryOf, categoriesOf, disciplineOf, categoryOfOption, progress, suggest, weekIsSet,
} from './src/lib/quota.js'
import {
  catalogOf, activityOf, activityLabel, pinnedActivities, groupedActivities,
  searchActivities, gateResolver, loggedActivity, DERIVED_GATES,
} from './src/lib/activities.js'
import { visibleOutputs, pruneHidden, derivedValue } from './src/lib/outputs.js'
import {
  unloggedWorkouts, dismissedWorkouts, mergeScore, mergedOut, mergedId, logCardOf,
  mergeTargets, outWith,
} from './src/lib/unlogged.js'
import { isTraining } from './src/lib/store.js'

const plan = JSON.parse(readFileSync(new URL('../test/fixtures/plan.json', import.meta.url), 'utf8'))
const card = plan.dailyMenu.find(m => m.id === 'log-workout')
const actField = card.outputs.find(f => f.type === 'activity')
const derive = gateResolver(card)

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
const keys = (out) => visibleOutputs(card, out, derive).map(f => f.key)

const daily = (date, optId, out = {}, level = 3) =>
  ({ id: `daily-${date}-${optId}`, kind: 'daily', date, data: { optId, level, done: true, out } })

/* ====================================================== the week boundary === */

check('the week starts Monday, and every day of it agrees which week it is in', () => {
  // Sunday is the trap: it is the END of its week, not the start of the next one.
  eq(mondayOf('2026-09-14'), '2026-09-14', 'a Monday is its own Monday')
  eq(mondayOf('2026-09-20'), '2026-09-14', 'Sunday belongs to the week behind it')
  eq(mondayOf('2026-09-17'), '2026-09-14', 'Thursday')
  for (const d of weekDays('2026-09-14')) eq(mondayOf(d), '2026-09-14', `${d} maps back`)
})

check('a week is seven days, Monday first, and crosses a month without drifting', () => {
  eq(weekDays('2026-09-28'),
    ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'])
})

check('weeks step backward and forward across a DST boundary', () => {
  // US DST ends 2026-11-01. Naive date maths loses or gains an hour here and
  // lands on a Sunday, which would silently file a whole week's quota one day out.
  eq(shiftWeek('2026-11-02', -1), '2026-10-26')
  eq(shiftWeek('2026-10-26', 1), '2026-11-02')
  eq(mondayOf(shiftWeek('2026-03-09', -1)), '2026-03-02', 'spring forward too')
})

/* =========================================================== quota entries === */

check('a quota is an entry, so it syncs and merges like everything else logged', () => {
  const e = buildQuotaEntry('2026-09-14', { pe: 2, bike: 3 })
  eq(e.id, quotaId('2026-09-14'))
  eq(e.kind, 'quota')
  eq(e.date, '2026-09-14', 'dated to the Monday, so it sorts with its week')
})

check('a week planned with the AI keeps its reasoning beside the counts', () => {
  // See weekplanner.jsx: the thread and the reply land on the quota entry the way a
  // prescription keeps its conversation. `counts` is still the only thing read.
  const e = buildQuotaEntry('2026-09-14', { pe: 2 },
    { why: 'because', title: 'Fingers light', thread: [{ role: 'you', text: 'draft it' }], counts: { bike: 9 } })
  eq(e.data.counts, { pe: 2 }, 'the counts argument wins over anything in extra')
  eq(e.data.why, 'because')
  eq(e.data.title, 'Fingers light')
  eq(quotaCounts([e], '2026-09-14'), { pe: 2 })
  // And a week set by hand carries nothing extra at all.
  eq(Object.keys(buildQuotaEntry('2026-09-14', { pe: 2 }).data), ['counts'])
})

check('nonsense counts are dropped rather than stored', () => {
  const entries = [buildQuotaEntry('2026-09-14', { pe: 2, bike: 0, swim: -1, run: 'x', lift: 1.4 })]
  eq(quotaCounts(entries, '2026-09-14'), { pe: 2, lift: 1 })
})

check('a week with no quota set is empty, not broken', () => {
  eq(quotaCounts([], '2026-09-14'), {})
  eq(weekIsSet([], '2026-09-14'), false)
})

check('a week set deliberately to nothing is still SET', () => {
  // The difference matters: an empty week the user chose should not be nagged at as if
  // the user had never opened the tab.
  const entries = [buildQuotaEntry('2026-09-14', {})]
  ok(weekIsSet(entries, '2026-09-16'), 'the entry existing is the answer')
})

/* ================================================= which quota a thing fills === */

check('a climbing card names its own category', () => {
  eq(categoryOf(daily('2026-09-14', 'board'), plan.dailyMenu), 'pe')
  eq(categoryOf(daily('2026-09-14', 'max-hangs'), plan.dailyMenu), 'fingers')
  eq(categoryOf(daily('2026-09-14', 'lead-laps'), plan.dailyMenu), 'endurance')
  eq(categoryOf(daily('2026-09-14', 'limit-boulder'), plan.dailyMenu), 'power')
})

check('the workout card asks the catalog what it was', () => {
  eq(categoryOf(daily('2026-09-14', 'log-workout', { activity: 'mtb' }), plan.dailyMenu), 'bike')
  eq(categoryOf(daily('2026-09-14', 'log-workout', { activity: 'treadmill-run' }), plan.dailyMenu), 'run')
  eq(categoryOf(daily('2026-09-14', 'log-workout', { activity: 'dance' }), plan.dailyMenu), 'misc')
})

check('he can point any activity at any category, and that beats the catalog', () => {
  // Any activity can be pointed at any quota category. A week where dance
  // genuinely IS the cardio can say so without editing the catalog for all time.
  const e = daily('2026-09-14', 'log-workout', { activity: 'dance', category: 'run' })
  eq(categoryOf(e, plan.dailyMenu), 'run')
})

check('a workout with no activity picked yet fills nothing', () => {
  eq(categoryOf(daily('2026-09-14', 'log-workout', {}), plan.dailyMenu), null)
  eq(categoryOfOption(card), null, 'and it cannot be scored toward a quota either')
})

check('disciplines come from the same two places', () => {
  eq(disciplineOf(daily('2026-09-14', 'board'), plan.dailyMenu), 'climbing')
  eq(disciplineOf(daily('2026-09-14', 'log-workout', { activity: 'swim' }), plan.dailyMenu), 'swim')
  eq(disciplineOf(daily('2026-09-14', 'log-workout', { activity: 'yoga' }), plan.dailyMenu), 'support')
})

/* ================================================================ progress === */

const week = [
  buildQuotaEntry('2026-09-14', { pe: 2, bike: 3, swim: 1 }),
  daily('2026-09-14', 'board'),
  daily('2026-09-15', 'log-workout', { activity: 'bike' }),
  daily('2026-09-16', 'log-workout', { activity: 'mtb' }),
  daily('2026-09-17', 'log-workout', { activity: 'dance' }),
]

check('progress counts what actually filled each category', () => {
  const p = progress({ plan, entries: week, iso: '2026-09-18' })
  eq(p.byKey.pe.done, 1); eq(p.byKey.pe.remaining, 1)
  eq(p.byKey.bike.done, 2); eq(p.byKey.bike.remaining, 1)
  eq(p.byKey.swim.done, 0); eq(p.byKey.swim.remaining, 1)
})

/* ------------------------------- one session, more than one quota -------
 *
 * "Counts toward" belongs to each workout inside a session, not to the session
 * as a whole, so a run and a lift each fill their own quota. A planned gym trip
 * is one entry followed start to finish, and it can genuinely be two workouts.
 */

check('a planned session fills one quota per BLOCK that names one', () => {
  const trip = {
    id: 'g', kind: 'daily', date: '2026-09-15', updatedAt: 'z',
    data: { optId: 'planned', level: 3, done: true, out: { activity: 'lift' },
      plan: { blocks: [
        { id: 'b0', name: 'Warm-up', category: null, items: [] },
        { id: 'b1', name: 'Legs', category: 'lift', items: [{}] },
        { id: 'b2', name: 'Run home', category: 'run', items: [{}] },
      ] } },
  }
  eq(categoriesOf(trip, plan.dailyMenu).sort(), ['lift', 'run'])
  // The warm-up names nothing, and nothing is what it fills.
  const week = progress({ plan, iso: '2026-09-15',
    entries: [buildQuotaEntry('2026-09-14', { lift: 2, run: 2, support: 1 }), trip] })
  eq(week.byKey.lift.done, 1)
  eq(week.byKey.run.done, 1)
  eq(week.byKey.support.done, 0, 'a warm-up is not a support workout')
  eq(week.doneTotal, 2, 'one session, two workouts')
})

check('two blocks of the same category are still ONE of it', () => {
  const trip = {
    id: 'g', kind: 'daily', date: '2026-09-15', updatedAt: 'z',
    data: { optId: 'planned', level: 3, done: true, out: {},
      plan: { blocks: [
        { id: 'b0', name: 'Squat', category: 'lift', items: [{}] },
        { id: 'b1', name: 'Accessory', category: 'lift', items: [{}] },
      ] } },
  }
  eq(categoriesOf(trip, plan.dailyMenu), ['lift'])
  const week = progress({ plan, iso: '2026-09-15',
    entries: [buildQuotaEntry('2026-09-14', { lift: 2 }), trip] })
  eq(week.byKey.lift.done, 1, 'a leg day is one lift, not two')
})

check('anything without a plan answers exactly as it always did', () => {
  const ride = {
    id: 'r', kind: 'daily', date: '2026-09-15', updatedAt: 'z',
    data: { optId: 'log-workout', level: 2, done: true, out: { activity: 'bike' } },
  }
  eq(categoriesOf(ride, plan.dailyMenu), ['bike'])
  eq(categoryOf(ride, plan.dailyMenu), 'bike', 'the single-answer reader is untouched')
  // And a planned session whose blocks name nothing falls back to the entry.
  const bare = {
    id: 'p', kind: 'daily', date: '2026-09-15', updatedAt: 'z',
    data: { optId: 'planned', level: 2, done: true, out: { category: 'swim' },
      plan: { blocks: [{ id: 'b0', name: 'Main', items: [{}] }] } },
  }
  eq(categoriesOf(bare, plan.dailyMenu), ['swim'])
})

check('a quota counts WORKOUTS, not days — two in one day fills two', () => {
  // "day = workout too, for some things have more than one thing per day."
  const twoInADay = [
    buildQuotaEntry('2026-09-14', { bike: 2 }),
    daily('2026-09-15', 'log-workout', { activity: 'bike' }),
    { ...daily('2026-09-15', 'log-workout', { activity: 'mtb' }), id: 'daily-2026-09-15-x2' },
  ]
  eq(progress({ plan, entries: twoInADay, iso: '2026-09-15' }).byKey.bike.done, 2)
})

check('something he did that nothing asked for is shown, not hidden or counted', () => {
  const p = progress({ plan, entries: week, iso: '2026-09-18' })
  eq(p.byKey.misc.planned, 0)
  eq(p.byKey.misc.done, 1, 'the dance class happened and the board should say so')
  ok(!p.asked.some(c => c.key === 'misc'), 'but it is not part of what the week asked for')
})

/* --------------------------------------- planned, not done: the dotted part
 *
 * A planned workout fills its share of the progress bar with a dotted segment,
 * showing that it is planned but not yet done.
 */

check('a session on a day and not done counts as planned, never as progress', () => {
  const entries = [
    buildQuotaEntry('2026-09-14', { bike: 3 }),
    { id: 'a', kind: 'daily', date: '2026-09-15', updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, done: true, out: { activity: 'bike' } } },
    { id: 'b', kind: 'daily', date: '2026-09-17', updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, done: false, out: { activity: 'bike' } } },
  ]
  const bike = progress({ plan, entries, iso: '2026-09-15' }).byKey.bike
  eq(bike.done, 1, 'only the finished one is progress')
  eq(bike.pending, 1)
  eq(bike.pendingShown, 1)
  eq(bike.remaining, 2, 'a plan does not pay down what is owed')
})

check('the dotted part never runs past the end of the track', () => {
  // Four planned rides against a quota of three is real, and worth nothing to a
  // bar that only goes to three. `pending` keeps the truth; `pendingShown` is
  // what the bar may draw.
  const entries = [
    buildQuotaEntry('2026-09-14', { bike: 3 }),
    ...[0, 1, 2, 3].map(i => ({
      id: `p${i}`, kind: 'daily', date: '2026-09-16', updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, done: false, out: { activity: 'bike' } },
    })),
  ]
  const bike = progress({ plan, entries, iso: '2026-09-15' }).byKey.bike
  eq(bike.pending, 4)
  eq(bike.pendingShown, 3)
})

check('...and it stops where the solid fill stops, not where the quota does', () => {
  const entries = [
    buildQuotaEntry('2026-09-14', { bike: 3 }),
    { id: 'a', kind: 'daily', date: '2026-09-15', updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, done: true, out: { activity: 'bike' } } },
    { id: 'b', kind: 'daily', date: '2026-09-16', updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, done: false, out: { activity: 'bike' } } },
    { id: 'c', kind: 'daily', date: '2026-09-17', updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, done: false, out: { activity: 'bike' } } },
    { id: 'd', kind: 'daily', date: '2026-09-18', updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, done: false, out: { activity: 'bike' } } },
  ]
  const bike = progress({ plan, entries, iso: '2026-09-15' }).byKey.bike
  // One done leaves two of the track; three are planned, so two may be drawn.
  eq(bike.done, 1)
  eq(bike.pendingShown, 2)
})

check('a planned rest day is not a planned workout', () => {
  const entries = [
    buildQuotaEntry('2026-09-14', { bike: 2 }),
    { id: 'r', kind: 'daily', date: '2026-09-16', updatedAt: 'z',
      data: { optId: 'off', level: 0, done: false, out: {} } },
  ]
  const week = progress({ plan, entries, iso: '2026-09-15' })
  eq(week.pendingTotal, 0)
})

check('a plan in a category nothing asked for shows nothing on the totals', () => {
  const entries = [
    buildQuotaEntry('2026-09-14', { bike: 1 }),
    { id: 'p', kind: 'daily', date: '2026-09-16', updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, done: false, out: { activity: 'swim' } } },
  ]
  const week = progress({ plan, entries, iso: '2026-09-15' })
  eq(week.byKey.swim.pending, 1, 'the category still knows about it')
  // ...but there is no track to draw it on, and it is not owed against anything.
  eq(week.byKey.swim.pendingShown, 0)
  eq(week.pendingTotal, 0)
})

check('a deliberate rest day is not a workout', () => {
  const entries = [buildQuotaEntry('2026-09-14', { misc: 1 }), daily('2026-09-15', 'off', {}, 0)]
  eq(progress({ plan, entries, iso: '2026-09-15' }).byKey.misc.done, 0)
})

check('last week stays last week', () => {
  const p = progress({ plan, entries: week, iso: '2026-09-21' })
  eq(p.monday, '2026-09-21')
  eq(p.doneTotal, 0, 'a new week starts empty however good the old one was')
  eq(p.isSet, false, 'and misses EXPIRE — nothing carries as debt')
})

check('overshooting is recorded but never counted twice', () => {
  const entries = [
    buildQuotaEntry('2026-09-14', { bike: 1 }),
    daily('2026-09-15', 'log-workout', { activity: 'bike' }),
    { ...daily('2026-09-16', 'log-workout', { activity: 'gravel' }), id: 'd2' },
    { ...daily('2026-09-17', 'log-workout', { activity: 'mtb' }), id: 'd3' },
  ]
  const p = progress({ plan, entries, iso: '2026-09-18' })
  eq(p.byKey.bike.done, 3); eq(p.byKey.bike.over, 2); eq(p.byKey.bike.remaining, 0)
  eq(p.doneTotal, 1, 'one quota asked for, one quota filled')
})

/* =============================================================== suggesting === */

check('a new week is pre-filled from the last one he SET', () => {
  const s = suggest({ plan, entries: week, iso: '2026-09-21' })
  eq(s.source, 'last-week')
  eq(s.counts, { pe: 2, bike: 3, swim: 1 })
})

check('with no quotas last week, it offers what he actually DID', () => {
  const noQuota = week.filter(e => e.kind !== 'quota')
  const s = suggest({ plan, entries: noQuota, iso: '2026-09-21' })
  eq(s.source, 'did-last-week')
  eq(s.counts, { pe: 1, bike: 2, misc: 1 }, 'measured, not aspirational')
})

check('with no history at all it invents nothing', () => {
  const s = suggest({ plan, entries: [], iso: '2026-09-21' })
  eq(s.source, 'empty'); eq(s.counts, {})
})

/* ========================================================== the catalog === */

check('every sport in his own WHOOP cache resolves to an activity', () => {
  // The bug that started this: dance, mountain-biking and WHOOP's generic
  // "activity" all mapped to nothing, so attaching one filled in no activity and
  // the card stayed a single blank question.
  const norm = s => String(s || '').trim().toLowerCase().replace(/[\s_]+/g, '-')
  const map = new Map()
  for (const a of catalogOf(actField).activities) for (const w of (a.whoop || [])) map.set(w, a.key)
  for (const sport of ['dance', 'mountain-biking', 'activity', 'cycling', 'running', 'weightlifting']) {
    ok(map.get(norm(sport)), `WHOOP "${sport}" resolves to nothing`)
  }
})

check('climbing is deliberately NOT in the catalog', () => {
  // A second way to log climbing is a way for a hard finger day to land somewhere
  // the injury budget cannot see it. The climbing cards own climbing.
  const climbish = catalogOf(actField).activities.filter(a => a.discipline === 'climbing')
  eq(climbish, [], 'climbing must be logged on the cards that ask the hard-finger question')
})

check('every activity is wired to real content', () => {
  const cats = new Set(plan.quotaCategories.map(c => c.key))
  const shapes = new Set(plan.formShapes.map(s => s.key))
  for (const a of catalogOf(actField).activities) {
    ok(cats.has(a.category), `${a.key}: unknown category ${a.category}`)
    ok(shapes.has(a.shape), `${a.key}: unknown shape ${a.shape}`)
    ok(actField.groups.includes(a.group), `${a.key}: unknown group ${a.group}`)
    ok(a.icon, `${a.key}: no icon`)
  }
})

check('no two activities claim the same WHOOP sport', () => {
  const seen = new Map()
  for (const a of catalogOf(actField).activities) {
    for (const w of (a.whoop || [])) {
      ok(!seen.has(w), `"${w}" claimed by both ${seen.get(w)} and ${a.key}`)
      seen.set(w, a.key)
    }
  }
})

check('search ranks a prefix above a substring', () => {
  // "ru" must not put Race walk above Run.
  eq(searchActivities(actField, 'ru')[0].key, 'run')
  eq(searchActivities(actField, 'swim')[0].key, 'swim')
})

check('search finds the names he would actually type', () => {
  eq(searchActivities(actField, 'mtb')[0].key, 'mtb')
  eq(searchActivities(actField, 'zwift')[0].key, 'indoor-bike')
  eq(searchActivities(actField, 'dreadmill')[0].key, 'treadmill-run')
  ok(searchActivities(actField, 'dance').some(a => a.key === 'dance'))
})

check('search for nothing returns nothing, rather than everything', () => {
  eq(searchActivities(actField, ''), [])
  eq(searchActivities(actField, '   '), [])
})

check('the quick-picks are his sports, and they are all real', () => {
  const pins = pinnedActivities(actField).map(a => a.key)
  eq(pins, ['run', 'treadmill-run', 'bike', 'mtb', 'swim', 'lift'])
})

check('grouping drops nothing and invents nothing', () => {
  const grouped = groupedActivities(actField)
  const n = grouped.reduce((a, g) => a + g.items.length, 0)
  eq(n, catalogOf(actField).activities.length, 'every activity is reachable by browsing')
  ok(grouped.every(g => g.items.length), 'no empty groups on screen')
})

check('an activity the catalog has forgotten reads back as its key, not as blank', () => {
  eq(activityLabel(actField, 'kitesurfing'), 'kitesurfing')
  eq(activityOf(actField, 'kitesurfing'), null)
})

/* ======================================================= the four shapes === */

check('an empty card is ONE question', () => {
  eq(keys({}), ['activity'])
})

check('a ride asks for distance and elevation, and never for incline', () => {
  eq(keys({ activity: 'mtb' }), ['activity', 'duration', 'distance', 'speed', 'elevation', 'rpe'])
})

check('a treadmill run asks for incline and never for elevation', () => {
  // The distinction the old card could not make: it gated incline on
  // `activity: ["run", "walk"]`, so an outdoor run was asked its incline and a
  // treadmill was asked its elevation gain.
  eq(keys({ activity: 'treadmill-run' }), ['activity', 'duration', 'distance', 'speed', 'incline', 'rpe'])
})

check('a swim is counted in yards and laps, not miles', () => {
  eq(keys({ activity: 'swim' }), ['activity', 'duration', 'poolDistance', 'laps', 'pace100', 'rpe'])
})

check('a lift asks for the exercises and no distance at all', () => {
  eq(keys({ activity: 'lift' }), ['activity', 'lifts', 'duration', 'rpe'])
})

check('a dance class asks how long and how hard, and nothing else', () => {
  eq(keys({ activity: 'dance' }), ['activity', 'duration', 'rpe'])
})

check('correcting the activity takes the answers that stopped making sense', () => {
  // Same rule as before the pivot, now across ninety-one activities: a distance
  // left on a lifting day would reach the stats line with nothing on screen to
  // explain it.
  const out = { activity: 'run', distance: 3.1, speed: 6.2, incline: 2, duration: 30, rpe: 6 }
  eq(pruneHidden(card, { ...out, activity: 'lift' }, derive),
    { activity: 'lift', duration: 30, rpe: 6 })
})

check('switching between two distance sports keeps the miles and drops the rest', () => {
  const out = { activity: 'treadmill-run', distance: 3, incline: 4, duration: 30 }
  eq(pruneHidden(card, { ...out, activity: 'trail-run' }, derive),
    { activity: 'trail-run', distance: 3, duration: 30 }, 'a trail has no incline setting')
})

check('a gate on a key the catalog does not know HIDES its field', () => {
  // Unanswered is hidden, everywhere. A resolver that returned "show it" for an
  // unknown key would leak every gated field onto an unrecognised activity.
  eq(derive('nonsense', { activity: 'run' }), undefined)
  eq(keys({ activity: 'kitesurfing' }), ['activity', 'duration', 'rpe'], 'an unknown sport still logs')
})

check('every derived gate the plan uses is one the resolver answers', () => {
  for (const f of card.outputs) {
    for (const k of Object.keys(f.when || {})) {
      const known = k === 'activity' || DERIVED_GATES.includes(k)
      ok(known, `field ${f.key} gates on "${k}", which nothing can answer`)
    }
  }
})

/* ============================================================== derived === */

check('average speed is offered, never stored', () => {
  const f = card.outputs.find(o => o.key === 'speed')
  eq(derivedValue(f, { distance: 10, duration: 40 }), 15)
  eq(derivedValue(f, { distance: 10 }), null, 'half the arithmetic is no arithmetic')
})

check('a swim gets a per-100 pace, because that is how a pool is read', () => {
  const f = card.outputs.find(o => o.key === 'pace100')
  eq(derivedValue(f, { poolDistance: 1500, duration: 30 }), 120)
  eq(derivedValue(f, { poolDistance: 0, duration: 30 }), null)
})

/* ============================================================== the menu === */

check('every session that can load the fingers asks whether it did', () => {
  // The logged answer is what the budget counts — not what the session was
  // planned as, so every climbing session asks.
  for (const m of plan.dailyMenu) {
    const load = m.sched?.fingerLoad
    if (!load || load === 'none') continue
    const q = (m.outputs || []).find(o => o.key === 'hardFingers')
    ok(q, `${m.id} can load the fingers and never asks about it`)
    eq(q.default, load === 'hard', `${m.id}: pre-fill should match the plan's own declaration`)
  }
})

check('a card that cannot touch the fingers never asks', () => {
  ok(!(card.outputs || []).some(o => o.key === 'hardFingers'),
    'a bike ride does not get a finger question however hard it was')
})

check('every quota category can actually be filled by something', () => {
  const fromMenu = new Set(plan.dailyMenu.map(m => m.category).filter(Boolean))
  const fromCatalog = new Set(catalogOf(actField).activities.map(a => a.category))
  for (const c of plan.quotaCategories) {
    ok(fromMenu.has(c.key) || fromCatalog.has(c.key),
      `nothing in the app can fill the "${c.key}" quota`)
  }
})

check('every goal names categories that exist, and every category a goal that does', () => {
  const cats = new Set(plan.quotaCategories.map(c => c.key))
  for (const a of plan.achievements) for (const c of a.categories) ok(cats.has(c), `${a.id} -> ${c}`)
  // The back-reference is gone: `achievement.categories` is the only direction now,
  // so a category can belong to at most one achievement and nothing can disagree.
  for (const c of plan.quotaCategories) {
    const owners = plan.achievements.filter(a => a.categories.includes(c.key))
    ok(owners.length <= 1, `${c.key} claimed by ${owners.length} achievements`)
  }
})

/* ============================ what the watch knows and the log does not === */

const whoopCache = (workouts) => ({ workouts })
const w = (id, sport, date = '2026-09-14', minutes = 45) =>
  ({ id, sport, date, minutes, start: `${date}T10:00:00Z`, end: `${date}T10:45:00Z` })

check('a measured workout with no log entry is offered', () => {
  const got = unloggedWorkouts({ plan, iso: '2026-09-14', entries: [],
    whoop: whoopCache([w('a', 'mountain-biking')]) })
  eq(got.length, 1)
  eq(got[0].activity.key, 'mtb')
  eq(got[0].id, 'whoop:a')
})

check('CLIMBING IS NEVER OFFERED HERE', () => {
  // A one-tap "log it" for a climbing workout would create a climbing entry that
  // never asked the hard-finger question — a hard finger day landing somewhere
  // the injury budget cannot see it. The mechanism is that climbing resolves to
  // no catalog activity at all, so there is nothing to offer.
  const got = unloggedWorkouts({ plan, iso: '2026-09-14', entries: [],
    whoop: whoopCache([w('a', 'rock-climbing'), w('b', 'bouldering'), w('c', 'cycling')]) })
  eq(got.map(g => g.activity.key), ['bike'], 'only the ride')
})

check('a workout already attached to a session is not offered again', () => {
  const entries = [{
    id: 'daily-2026-09-14', kind: 'daily', date: '2026-09-14',
    data: { optId: 'log-workout', done: true, out: { activity: 'mtb', whoop: { id: 'a' } } },
  }]
  eq(unloggedWorkouts({ plan, iso: '2026-09-14', entries,
    whoop: whoopCache([w('a', 'mountain-biking')]) }), [])
})

check('...including when a gym visit was split across two sessions', () => {
  const entries = ['x', 'y'].map((k, i) => ({
    id: `daily-2026-09-14-${k}`, kind: 'daily', date: '2026-09-14',
    data: { optId: 'log-workout', done: true, out: { activity: 'lift', whoop: { id: 'a', part: i } } },
  }))
  eq(unloggedWorkouts({ plan, iso: '2026-09-14', entries,
    whoop: whoopCache([w('a', 'weightlifting')]) }), [])
})

/* ------------------------------------- merging into a session already logged
 *
 * The gap this closes: Strava synced first, the ride was logged off it, and
 * WHOOP's copy of the same hour arrived afterwards with nothing left to
 * pair with. `pairUp` only folds two measurements together while BOTH are
 * unlogged, and sync order is not something this app controls.
 */

check('a late measurement can be merged into the session the early one became', () => {
  const ride = {
    id: 'daily-2026-09-14', kind: 'daily', date: '2026-09-14',
    data: { optId: 'log-workout', name: 'Bike', minutes: 62, done: true,
      out: { activity: 'bike', duration: 62, distance: 12.5, strava: { id: 99 } } },
  }
  const [late] = unloggedWorkouts({ plan, iso: '2026-09-14', entries: [ride],
    whoop: whoopCache([w('a', 'cycling', '2026-09-14', 63)]) })
  eq(Boolean(late), true, 'the WHOOP copy is still offered')

  const targets = mergeTargets({ entries: [ride], iso: '2026-09-14', item: late, menu: plan.dailyMenu })
  eq(targets.map(t => t.id), ['daily-2026-09-14'], 'the logged ride is the target')

  // Attaching lands the snapshot without overwriting what is already there: both
  // modules fill blanks only, so the logged 12.5 miles survive WHOOP having no distance.
  const out = outWith(logCardOf(plan), ride.data.out, late)
  eq(out.whoop.id, 'a', 'the snapshot is on the entry')
  eq(out.strava.id, 99, 'the Strava snapshot is still there')
  eq(out.distance, 12.5, 'the measured distance was not overwritten')

  // And with it attached, the row stops being offered at all.
  eq(unloggedWorkouts({ plan, iso: '2026-09-14',
    entries: [{ ...ride, data: { ...ride.data, out } }],
    whoop: whoopCache([w('a', 'cycling', '2026-09-14', 63)]) }), [])
})

check('a session that already has a snapshot from that source is not a target', () => {
  // Attaching a second WHOOP workout would silently replace the first, and
  // "which of the two is on there now" is not a question the log should raise.
  const taken = {
    id: 'daily-2026-09-14', kind: 'daily', date: '2026-09-14',
    data: { optId: 'log-workout', out: { activity: 'bike', whoop: { id: 'b' } } },
  }
  const [late] = unloggedWorkouts({ plan, iso: '2026-09-14', entries: [taken],
    whoop: whoopCache([w('a', 'cycling')]) })
  eq(mergeTargets({ entries: [taken], iso: '2026-09-14', item: late, menu: plan.dailyMenu }), [])
})

check('a rest day is never a merge target, and neither is another day', () => {
  const rest = {
    id: 'daily-2026-09-14', kind: 'daily', date: '2026-09-14',
    data: { optId: 'off', name: 'Rest day', done: true, out: {} },
  }
  const other = {
    id: 'daily-2026-09-13', kind: 'daily', date: '2026-09-13',
    data: { optId: 'log-workout', name: 'Run', out: { activity: 'run' } },
  }
  const [item] = unloggedWorkouts({ plan, iso: '2026-09-14', entries: [rest, other],
    whoop: whoopCache([w('a', 'cycling')]) })
  eq(mergeTargets({ entries: [rest, other], iso: '2026-09-14', item, menu: plan.dailyMenu }), [])
})

check('a session of a DIFFERENT activity is still offered as a target', () => {
  // The user is the one asserting the two are the same thing. An app that hides the
  // session the user means because the catalog disagrees is arguing with them about their
  // own day — and the commonest real case is a strap that called an hour of
  // something "activity".
  const lift = {
    id: 'daily-2026-09-14', kind: 'daily', date: '2026-09-14',
    data: { optId: 'log-workout', name: 'Lift', out: { activity: 'lift' } },
  }
  const [item] = unloggedWorkouts({ plan, iso: '2026-09-14', entries: [lift],
    whoop: whoopCache([w('a', 'cycling')]) })
  eq(mergeTargets({ entries: [lift], iso: '2026-09-14', item, menu: plan.dailyMenu }).length, 1)
})

check('waving one off is an answer — it does not come back', () => {
  const cache = whoopCache([w('a', 'dance')])
  eq(unloggedWorkouts({ plan, iso: '2026-09-14', entries: [], whoop: cache }).length, 1)
  eq(unloggedWorkouts({ plan, iso: '2026-09-14', entries: [], whoop: cache,
    skipped: ['whoop:a'] }), [])
})

check('a sport nothing in the catalog claims is passed over in silence', () => {
  // Correct silence rather than a guess: there is no honest one-tap entry to
  // offer for a sport the app has never heard of.
  eq(unloggedWorkouts({ plan, iso: '2026-09-14', entries: [],
    whoop: whoopCache([w('a', 'kitesurfing')]) }), [])
})

check('only today is offered', () => {
  eq(unloggedWorkouts({ plan, iso: '2026-09-14', entries: [],
    whoop: whoopCache([w('a', 'cycling', '2026-09-13')]) }), [])
})

// data/ is gitignored, so this only runs where a local cache exists (not CI).
const realWhoopCache = new URL('../data/whoop.json', import.meta.url)
if (existsSync(realWhoopCache)) check('his real WHOOP cache produces real offers', () => {
  // Run against data/whoop.json, because the whole feature exists because three
  // of the sports in it used to resolve to nothing.
  const cache = JSON.parse(readFileSync(realWhoopCache, 'utf8'))
  const dates = [...new Set((cache.workouts || []).map(x => x.date))]
  let offered = 0
  for (const d of dates) {
    for (const item of unloggedWorkouts({ plan, iso: d, entries: [], whoop: cache })) {
      ok(item.activity, `${item.label} resolved to no activity`)
      ok(item.activity.discipline !== 'climbing', 'climbing must never be offered')
      offered++
    }
  }
  ok(offered > 0, 'his cache should produce at least one offer')
})

/* ================================ one activity, two instruments (merging) === */

const at = (h, m, mins) => ({
  start: `2026-09-14T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`,
  end: `2026-09-14T${String(h + Math.floor((m + mins) / 60)).padStart(2, '0')}:${String((m + mins) % 60).padStart(2, '0')}:00Z`,
})
const ww = (id, sport, h, m, mins) =>
  ({ id, sport, date: '2026-09-14', minutes: mins, ...at(h, m, mins) })
const sa = (id, family, h, m, mins, extra = {}) => ({
  id, family, sport: family, name: `a ${family}`, date: '2026-09-14',
  movingMin: mins, elapsedMin: mins, ...at(h, m, mins), ...extra,
})
const merged = (o) => unloggedWorkouts({ plan, iso: '2026-09-14', entries: [], ...o })

check('THE ASK: the same ride on both services is offered once', () => {
  // Strava and WHOOP record the same activity, so the screen merges the two
  // into one offer. Offering it twice offers to log one
  // afternoon twice — two bike quotas filled and double the load.
  const got = merged({
    whoop: { workouts: [ww('w1', 'cycling', 10, 0, 90)] },
    strava: { activities: [sa('s1', 'ride', 10, 2, 86)] },
  })
  eq(got.length, 1)
  eq(got[0].merged, true)
  eq(got[0].activity.key, 'bike')
  eq(got[0].sources, ['whoop', 'strava'])
})

check("WHOOP's unnamed 'activity' takes its name from the Strava ride", () => {
  // The most valuable merge there is, and the one a strict sport match would
  // refuse: the strap noticed effort it could not label, Strava knows what it was.
  const got = merged({
    whoop: { workouts: [ww('w1', 'activity', 7, 0, 45)] },
    strava: { activities: [sa('s1', 'run', 7, 0, 44)] },
  })
  eq(got.length, 1)
  eq(got[0].activity.key, 'run', 'the named source wins over the generic one')
})

check('two activities at different times are two activities', () => {
  const got = merged({
    whoop: { workouts: [ww('w1', 'cycling', 7, 0, 45)] },
    strava: { activities: [sa('s1', 'ride', 17, 0, 45)] },
  })
  eq(got.length, 2)
  ok(got.every(g => !g.merged), 'a morning ride and an evening ride are two rides')
})

check('a brush of overlap is not a merge', () => {
  // 10:00-11:00 against 10:55-11:55 — six minutes of overlap out of sixty.
  const got = merged({
    whoop: { workouts: [ww('w1', 'cycling', 10, 0, 60)] },
    strava: { activities: [sa('s1', 'ride', 10, 55, 60)] },
  })
  eq(got.length, 2)
})

check('sports that genuinely contradict stay apart', () => {
  // A logged swim overlapping a logged ride is data worth showing them, not
  // silently reconciling.
  eq(mergeScore(
    { activity: { key: 'swim' }, raw: ww('w1', 'swimming', 10, 0, 60) },
    { activity: { key: 'bike' }, raw: sa('s1', 'ride', 10, 0, 60) }), 0)
})

check('three overlapping things pair the STRONGEST match, not the first', () => {
  // Greedy in list order would let a weak pair claim a partner the best pair
  // wanted, and leave the good match orphaned.
  const got = merged({
    whoop: { workouts: [ww('w1', 'cycling', 10, 0, 90)] },
    strava: { activities: [sa('s1', 'ride', 10, 50, 60), sa('s2', 'ride', 10, 0, 88)] },
  })
  const pair = got.find(g => g.merged)
  ok(pair, 'something should have paired')
  ok(pair.parts.some(p => p.id === 'strava:s2'), 'the 88-minute overlap should win')
  ok(got.some(g => !g.merged && g.id === 'strava:s1'), 'and the weak one stands alone')
})

check('"not the same" sticks, and splits them back into two', () => {
  const opts = {
    whoop: { workouts: [ww('w1', 'cycling', 10, 0, 90)] },
    strava: { activities: [sa('s1', 'ride', 10, 2, 86)] },
  }
  const one = merged(opts)
  eq(one.length, 1)
  const two = merged({ ...opts, split: [one[0].id] })
  eq(two.length, 2)
  ok(two.every(g => !g.merged))
})

check('the merged id does not depend on which list came first', () => {
  eq(mergedId({ id: 'whoop:a' }, { id: 'strava:b' }),
     mergedId({ id: 'strava:b' }, { id: 'whoop:a' }))
})

check('dismissing a merged pair dismisses the pair', () => {
  const opts = {
    whoop: { workouts: [ww('w1', 'cycling', 10, 0, 90)] },
    strava: { activities: [sa('s1', 'ride', 10, 2, 86)] },
  }
  const id = merged(opts)[0].id
  eq(merged({ ...opts, skipped: [id] }), [])
})

check('merging lands ONE entry carrying BOTH snapshots', () => {
  const item = merged({
    whoop: { workouts: [ww('w1', 'cycling', 10, 0, 90)] },
    strava: { activities: [sa('s1', 'ride', 10, 2, 86, { distanceMi: 24.2, elevationFt: 1180, avgMph: 16.9 })] },
  })[0]
  const out = mergedOut(logCardOf(plan), item)
  ok(out.whoop?.id === 'w1', 'the WHOOP snapshot is on the entry')
  ok(out.strava?.id === 's1', 'and so is the Strava one')
  eq(out.activity, 'bike')
})

check('...and Strava answers the fields it measured better', () => {
  // Strava has GPS, so its distance and elevation are measured rather than
  // inferred, and its headline minutes are MOVING time — which is what the load
  // chart wants, because a coffee stop is not training.
  const item = merged({
    whoop: { workouts: [{ ...ww('w1', 'cycling', 10, 0, 90), distanceMeter: 30000, altitudeGainMeter: 500 }] },
    strava: { activities: [sa('s1', 'ride', 10, 2, 86, { distanceMi: 24.2, elevationFt: 1180 })] },
  })[0]
  const out = mergedOut(logCardOf(plan), item)
  eq(out.distance, 24.2, 'Strava measured it')
  eq(out.elevation, 1180)
  eq(out.duration, 86, 'moving time, not the strap\'s elapsed 90')
})

check('a merge still cannot smuggle climbing onto the workout card', () => {
  // Both services recording the same climbing session must still produce nothing:
  // a merged one-tap climbing entry would never ask the hard-finger question.
  eq(merged({
    whoop: { workouts: [ww('w1', 'rock-climbing', 18, 0, 120)] },
    strava: { activities: [sa('s1', 'climbing', 18, 0, 118)] },
  }), [])
})

/* ================================================ two gyms, not one (venue) === */

check('the climbing gym and the weights gym are different places', () => {
  // A regular gym and a climbing gym are separate venues. Before the split, `gym`
  // meant the climbing gym, because it was the only gym — so saying "I'm at the
  // gym" offered board intervals to someone standing at a squat rack.
  const climbing = plan.dailyMenu.filter(m => m.sched?.venue === 'climbing-gym')
  ok(climbing.length >= 8, 'the wall sessions should live at the climbing gym')
  for (const m of climbing) ok(m.category, `${m.id} should be a climbing category`)
  ok(!plan.dailyMenu.some(m => m.sched?.venue === 'gym'),
    'nothing in the menu needs a weights room specifically — a lift is logged, not prescribed')
})

check('the check-in can say which gym, and each reads in a sentence', () => {
  const where = plan.checkin.fields.find(f => f.informs === 'venue')
  const values = where.options.map(o => o.value)
  ok(values.includes('climbing-gym') && values.includes('gym'), `got ${values}`)
  for (const o of where.options) {
    ok(o.label && o.phrase && o.icon, `${o.value}: needs a label, a phrase and an icon`)
  }
})

/* ============================== dismissed is not deleted, and just-miles === */

check('a dismissed workout can be brought back', () => {
  // Dismissing an offered workout must not hide it forever. Before this the only
  // undo was hand-editing a skip entry, which nobody does.
  const opts = { plan, iso: '2026-09-14', entries: [],
    whoop: { workouts: [ww('w1', 'cycling', 10, 0, 90)] } }
  eq(merged(opts).length, 1)
  eq(merged({ ...opts, skipped: ['whoop:w1'] }).length, 0, 'gone from the live list')
  const back = dismissedWorkouts({ ...opts, skipped: ['whoop:w1'] })
  eq(back.length, 1, 'but recoverable')
  eq(back[0].id, 'whoop:w1')
})

check('everything dismissed leaves a card with no headline to write', () => {
  // The card rendered "0 workouts you have not logged / Recorded by ." here,
  // because the early return only asked whether SOMETHING was on the card and a
  // dismissed-only card is something.
  const opts = { plan, iso: '2026-09-14', entries: [],
    whoop: { workouts: [ww('w1', 'cycling', 10, 0, 90)] }, skipped: ['whoop:w1'] }
  eq(merged(opts).length, 0, 'nothing live')
  eq(dismissedWorkouts(opts).length, 1, 'but something dismissed')
})

check('nothing dismissed means nothing to show', () => {
  eq(dismissedWorkouts({ plan, iso: '2026-09-14', entries: [],
    whoop: { workouts: [ww('w1', 'cycling', 10, 0, 90)] } }), [])
})

check('a dismissed workout that no longer exists stays gone', () => {
  // The user deleted the Strava activity. Offering it back would be offering a ghost.
  eq(dismissedWorkouts({ plan, iso: '2026-09-14', entries: [],
    whoop: { workouts: [] }, skipped: ['whoop:w1'] }), [])
})

check('WHEN, not only how long: a row carries the instants it happened at', () => {
  // A row shows when the workout happened, not only how long it lasted. Two
  // 22-minute rides in a day are the same row twice without a clock, and a
  // commute is the one worth telling apart.
  const [item] = merged({ whoop: { workouts: [ww('w1', 'cycling', 10, 0, 90)] } })
  eq(item.start, '2026-09-14T10:00:00Z')
  eq(item.end, '2026-09-14T11:30:00Z')
})

check('a merged pair spans BOTH measurements', () => {
  // Same rule the minutes follow: the shorter measurement is the one that missed
  // something, so the union is the honest window.
  const [item] = merged({
    whoop: { workouts: [ww('w1', 'cycling', 10, 0, 90)] },
    strava: { activities: [sa('s1', 'ride', 10, 2, 86)] },
  })
  eq(item.merged, true)
  eq(Date.parse(item.start), Date.parse('2026-09-14T10:00:00Z'), 'the earlier start')
  eq(Date.parse(item.end), Date.parse('2026-09-14T11:30:00Z'), 'the later end')
})

check('a measurement with no clock is still offered', () => {
  // A manual Strava entry can arrive with no start. The row loses its time and
  // keeps everything else — an absent instant must never drop the workout.
  const [item] = merged({ strava: { activities: [
    { id: 's9', family: 'ride', sport: 'ride', name: 'manual ride', date: '2026-09-14',
      movingMin: 30, elapsedMin: 30 }] } })
  eq(item.start, null)
  eq(item.end, null)
  eq(item.minutes, 30)
})

check('a dismissal survives the merge grouping', () => {
  // Dismissing a merged PAIR must come back as the pair, not as two loose rows.
  const opts = { plan, iso: '2026-09-14', entries: [],
    whoop: { workouts: [ww('w1', 'cycling', 10, 0, 90)] },
    strava: { activities: [sa('s1', 'ride', 10, 2, 86)] } }
  const id = merged(opts)[0].id
  const back = dismissedWorkouts({ ...opts, skipped: [id] })
  eq(back.length, 1)
  eq(back[0].merged, true)
})

const commuteOn = (date, extra = {}) => ({
  id: `c-${date}`, kind: 'daily', date,
  data: { optId: 'log-workout', level: 1, done: true, minutes: 9, training: false,
          out: { activity: 'bike', distance: 1.75, rpe: 3 }, ...extra },
})

check('JUST MILES: an activity is miles and a streak day, not a session', () => {
  // A short commute is not a training session, but its miles still count.
  const commute = commuteOn('2026-09-14')
  eq(isTraining(commute), false)
  eq(isTraining({ data: { optId: 'board', done: true } }), true,
    'absent means training — every entry before 2026-09-15 was')
})

check("JUST MILES: a commute does NOT fill the quota", () => {
  // A reversal of the earlier rule: an activity marked "just miles" does not
  // fill the quota, because otherwise every commute counts as one of the week's
  // workouts.
  const entries = [buildQuotaEntry('2026-09-14', { bike: 2 }), commuteOn('2026-09-14')]
  const bike = progress({ plan, entries, iso: '2026-09-14' }).byKey.bike
  eq(bike.done, 0, 'a commute is not one of the two rides the week asked for')
  eq(bike.remaining, 2)
  eq(bike.complete, false)

  // And a real ride on the same day still counts — this is about the flag, not
  // about the card or the activity.
  const ride = { id: 'r1', kind: 'daily', date: '2026-09-14',
    data: { optId: 'log-workout', level: 2, done: true, out: { activity: 'bike', distance: 22, rpe: 6 } } }
  eq(progress({ plan, entries: [...entries, ride], iso: '2026-09-14' }).byKey.bike.done, 1)
})

check('JUST MILES: a commute on a day is not a PENDING quota either', () => {
  // The dotted segment means "written down, not done yet". A commute not yet
  // marked done is still not a session the week is waiting on.
  const entries = [buildQuotaEntry('2026-09-14', { bike: 1 }),
    commuteOn('2026-09-14', { done: false })]
  const bike = progress({ plan, entries, iso: '2026-09-14' }).byKey.bike
  eq(bike.pending, 0)
  eq(bike.pendingShown, 0)
})

check('JUST MILES: copy-forward does not bid a week of commutes', () => {
  // `suggest` falls back to what was DONE last week. Five rides to work is not an
  // opening bid of five rides.
  const last = ['2026-09-08', '2026-09-09', '2026-09-10'].map(d => commuteOn(d))
  eq(suggest({ plan, entries: last, iso: '2026-09-15' }).source, 'empty')
})

console.log(failed ? `\n${failed} test(s) failed` : '\nall quota/catalog tests passed')
process.exit(failed ? 1 : 0)
