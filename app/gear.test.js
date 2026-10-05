/* Gear and the profile:
 *   node app/gear.test.js
 *
 * The rebuild in which the Gear tab stopped being a 17-item shopping list and
 * became the things the user owns plus what each has done. Run against the REAL
 * plan.json and a local data/strava.json if one exists, because the two origins
 * are the whole design and a fixture would not exercise real synced gear.
 */

import { existsSync, readFileSync } from 'node:fs'
import {
  gearItems, gearUsage, gearOn, headlineFor, metricOf, kindOf, gearKinds,
  kindsForWorkout, defaultGearFor, gearChoicesFor, buildGearEntry, newGearId,
} from './src/lib/gear.js'
import {
  athleteOf, profileFacts, buildProfileEntry, factValue, PROFILE_GROUPS,
} from './src/lib/profile.js'

const url = (p) => new URL(p, import.meta.url)
const plan = JSON.parse(readFileSync(url('../test/fixtures/plan.json'), 'utf8'))
// data/ is gitignored, so CI has no Strava cache; the checks that need it skip there.
const stravaFile = url('../data/strava.json')
const strava = existsSync(stravaFile) ? JSON.parse(readFileSync(stravaFile, 'utf8')) : null

let failed = 0
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`) }
  catch (err) { failed++; console.error(`  FAIL  ${name}\n        ${err.message}`) }
}
// For checks that only mean something against a local Strava cache in data/.
const real = (name, fn) => strava ? check(name, fn) : console.log(`  SKIP  ${name} (no data/strava.json)`)
const eq = (got, want, what = '') => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error(`${what || 'value'}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
  }
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg) }

const opt = (id) => plan.dailyMenu.find(m => m.id === id)
const logCard = plan.dailyMenu.find(m => m.categoryFrom === 'activity')
const did = (date, optId, out = {}, extra = {}) => ({
  id: `daily-${date}-${optId}`, kind: 'daily', date,
  data: { optId, level: 3, done: true, minutes: 60, out, ...extra },
})
const rope = buildGearEntry('gear-rope', {
  name: 'Mammut 9.5', kind: 'rope', acquired: '2025-03-01', primary: true,
})
const plates = buildGearEntry('gear-plates', { name: 'Cast iron plates', kind: 'weights', primary: true })

/* ================================================================ content === */

check('every gear kind declares how it wears out', () => {
  ok(gearKinds(plan).length >= 6, 'a gear vocabulary of three is a list, not a model')
  for (const k of gearKinds(plan)) {
    ok(k.key && k.name && k.icon, `${k.key}: needs a key, a name and an icon`)
    ok(['miles', 'time', 'reps'].includes(k.metric), `${k.key}: unknown metric ${k.metric}`)
  }
})

check('the metrics are the ones he named', () => {
  // Each gear kind is measured in its own unit: climbing gear in time spent,
  // weights in time or reps, bikes and shoes in miles.
  eq(metricOf(plan, 'bike'), 'miles')
  eq(metricOf(plan, 'shoes'), 'miles')
  eq(metricOf(plan, 'rope'), 'time')
  eq(metricOf(plan, 'climbing-shoes'), 'time')
  eq(metricOf(plan, 'weights'), 'reps')
})

check('the buying list is gone', () => {
  ok(!plan.gear, 'plan.gear was 17 items of prices and purchase advice')
  ok(!plan.gearNotes, 'and its notes with it')
})

/* ================================================================ origins === */

real('his real Strava gear arrives with its odometer', () => {
  const items = gearItems({ entries: [], strava, plan })
  ok(items.length >= 2, `expected his bike and shoes, got ${items.length}`)
  const bike = items.find(i => i.kind === 'bike')
  ok(bike, 'no bike came through')
  eq(bike.source, 'strava')
  ok(bike.stravaMiles > 0, 'the odometer should be a real number')
})

real('local gear and synced gear sit in one list without colliding', () => {
  const items = gearItems({ entries: [rope], strava, plan })
  eq(items.filter(i => i.source === 'local').map(i => i.name), ['Mammut 9.5'])
  ok(items.some(i => i.source === 'strava'), 'and Strava is still there')
})

check('the old buying-list entries are not mistaken for gear', () => {
  // They were `{ item, bought }` with no name and no kind. Rendering them would
  // put four blank rows at the top of the page.
  const legacy = [
    { id: 'gear-old', kind: 'gear', data: { item: 'Tindeq Progressor 200', bought: true } },
    { id: 'gear-empty', kind: 'gear', data: {} },
  ]
  eq(gearItems({ entries: legacy, strava: null, plan }), [])
})

/* ================================================================== usage === */

check('miles accrue to the gear the workout was done on', () => {
  const shoes = buildGearEntry('gear-shoes', { name: 'Peg 41', kind: 'shoes' })
  const entries = [shoes,
    did('2026-09-01', 'log-workout', { activity: 'run', distance: 6.2, gear: ['gear-shoes'] }),
    did('2026-09-03', 'log-workout', { activity: 'run', distance: 4, gear: ['gear-shoes'] })]
  const row = gearUsage({ plan, entries, strava: null }).find(r => r.id === 'gear-shoes')
  eq(row.miles, 10.2)
  eq(row.sessions, 2)
  eq(row.lastUsed, '2026-09-03')
})

check('what it had done BEFORE you added it still counts', () => {
  // A rope with 200 hours on it does not become new because the user only just told the
  // app about it.
  const old = buildGearEntry('g1', { name: 'Old rope', kind: 'rope', priorMinutes: 12000 })
  const row = gearUsage({ plan, entries: [old], strava: null }).find(r => r.id === 'g1')
  eq(headlineFor(row), { value: 200, unit: 'hr' })
})

real('THE DOUBLE-COUNT: a ride already on Strava is not added to its odometer', () => {
  // Strava keeps counting the bike. Adding this app's own tally on top would
  // inflate it by exactly the rides that ARE on Strava, which is most of them.
  const bikeId = Object.values(strava.gear).find(g => g.kind === 'bike').id
  const entries = [
    did('2026-09-01', 'log-workout', { activity: 'bike', distance: 25, gear: [bikeId], strava: { id: 's1' } }),
    did('2026-09-02', 'log-workout', { activity: 'bike', distance: 18, gear: [bikeId] }),
  ]
  const row = gearUsage({ plan, entries, strava }).find(r => r.id === bikeId)
  eq(row.unsyncedMiles, 18, 'only the ride Strava cannot have seen')
  eq(headlineFor(row).value, Math.round(row.stravaMiles * 10) / 10,
    "the headline stays Strava's own odometer")
})

check('weights count reps, from the lift chooser', () => {
  const entries = [plates, did('2026-09-01', 'log-workout', {
    activity: 'lift', gear: ['gear-plates'],
    lifts: [{ sets: [{ reps: 8 }, { reps: 8 }, { reps: 6 }] }, { sets: [{ reps: 12 }] }],
  })]
  const row = gearUsage({ plan, entries, strava: null }).find(r => r.id === 'gear-plates')
  eq(row.reps, 34)
  eq(headlineFor(row), { value: 34, unit: 'reps' })
})

check('climbing gear counts hours', () => {
  const entries = [rope,
    did('2026-09-01', 'board', { gear: ['gear-rope'] }, { minutes: 90 }),
    did('2026-09-03', 'board', { gear: ['gear-rope'] }, { minutes: 150 })]
  const row = gearUsage({ plan, entries, strava: null }).find(r => r.id === 'gear-rope')
  eq(row.minutes, 240)
  eq(headlineFor(row), { value: 4, unit: 'hr' })
})

check('one workout can wear two things at once', () => {
  const entries = [rope, plates,
    did('2026-09-01', 'log-workout', { activity: 'lift', gear: ['gear-rope', 'gear-plates'] })]
  const rows = gearUsage({ plan, entries, strava: null })
  eq(rows.find(r => r.id === 'gear-rope').sessions, 1)
  eq(rows.find(r => r.id === 'gear-plates').sessions, 1)
})

check('deleting gear does not erase the workout it was used on', () => {
  // The entry keeps its `out.gear` id. The usage row is simply gone, which is
  // right — but nothing crashes and no training history is touched.
  const entries = [did('2026-09-01', 'log-workout', { activity: 'run', distance: 5, gear: ['gear-gone'] })]
  eq(gearUsage({ plan, entries, strava: null }).length, 0)
  eq(gearOn(entries[0]), ['gear-gone'], 'the workout still records what it was done on')
})

check('a workout with no gear is not a workout with gear', () => {
  eq(gearOn(did('2026-09-01', 'log-workout', { activity: 'run' })), [])
  eq(gearOn(did('2026-09-01', 'log-workout', { activity: 'run', gear: 'g1' })), ['g1'],
    'a bare string still reads, so an older shape cannot break the page')
})

/* =============================================================== matching === */

check('a workout asks for the gear its discipline actually uses', () => {
  eq(kindsForWorkout(plan, logCard, { activity: 'mtb' }), ['bike'])
  eq(kindsForWorkout(plan, logCard, { activity: 'trail-run' }), ['shoes'])
  eq(kindsForWorkout(plan, logCard, { activity: 'lift' }), ['weights'])
  eq(kindsForWorkout(plan, opt('board'), {}), ['climbing-shoes', 'harness', 'rope'])
  // The pair that makes "how many hours on the Port-A-Board" answerable.
  eq(kindsForWorkout(plan, opt('max-hangs'), {}), ['board', 'gauge'])
})

check('a dance class is not asked which bike it was on', () => {
  eq(kindsForWorkout(plan, logCard, { activity: 'dance' }), [])
  eq(gearChoicesFor({ plan, entries: [rope], strava, opt: logCard, out: { activity: 'dance' } }), [])
})

check('the primary item defaults in, with no taps', () => {
  const picked = defaultGearFor({ plan, entries: [rope], strava: null, opt: opt('board'), out: {} })
  eq(picked, ['gear-rope'])
})

check('...and the only item of its kind counts as primary', () => {
  const only = buildGearEntry('g1', { name: 'My one rope', kind: 'rope' })
  eq(defaultGearFor({ plan, entries: [only], strava: null, opt: opt('board'), out: {} }), ['g1'])
})

check('two of a kind and neither primary defaults to NOTHING', () => {
  // A default nobody chose is how a bike quietly accrues someone else's miles.
  const a = buildGearEntry('g1', { name: 'Rope A', kind: 'rope' })
  const b = buildGearEntry('g2', { name: 'Rope B', kind: 'rope' })
  eq(defaultGearFor({ plan, entries: [a, b], strava: null, opt: opt('board'), out: {} }), [])
})

check('retired gear is never defaulted and never offered', () => {
  const dead = buildGearEntry('g1', { name: 'Worn rope', kind: 'rope', primary: true, retired: true })
  eq(defaultGearFor({ plan, entries: [dead], strava: null, opt: opt('board'), out: {} }), [])
  eq(gearChoicesFor({ plan, entries: [dead], strava: null, opt: opt('board'), out: {} }), [])
  ok(gearItems({ entries: [dead], strava: null, plan }).length === 1,
    'but it stays in the list — the hours on it are why you retired it')
})

check('gear ids do not collide', () => {
  const ids = new Set(Array.from({ length: 200 }, newGearId))
  eq(ids.size, 200)
})

/* ================================================================ profile === */

real('his name and picture come off Strava', () => {
  const a = athleteOf(strava)
  eq(a.name, 'Sam Rivera')
  ok(a.avatar && /^https:/.test(a.avatar), `no avatar: ${a.avatar}`)
  eq(a.connected, true)
})

check('no Strava is a header that still says something', () => {
  const a = athleteOf(null)
  eq(a.name, 'You')
  eq(a.avatar, null)
  eq(a.connected, false)
})

check('initials stand in for a missing picture', () => {
  eq(athleteOf({ athlete: { name: 'Sam Rivera' } }).initials, 'SR')
})

check('a fact he set beats the one Strava offers', () => {
  // Silently preferring Strava's value over a number the user typed this morning is
  // the same mistake as a pre-filled duration confirmed without being read.
  const field = PROFILE_GROUPS[0].fields.find(f => f.key === 'ftp')
  eq(factValue(field, { facts: { ftp: 240 }, strava: { athlete: { ftp: 200 } } }),
    { value: 240, source: 'own' })
  eq(factValue(field, { facts: {}, strava: { athlete: { ftp: 200 } } }),
    { value: 200, source: 'strava' })
  eq(factValue(field, { facts: {}, strava: null }), { value: null, source: 'none' })
})

check('bodyweight reads the live series, not a copy of it', () => {
  const field = PROFILE_GROUPS[0].fields.find(f => f.key === 'weightLb')
  const entries = [
    { id: 'bw-1', kind: 'bodyweight', date: '2026-09-01', data: { lb: 186 } },
    { id: 'bw-2', kind: 'bodyweight', date: '2026-09-10', data: { lb: 183 } },
  ]
  eq(factValue(field, { facts: {}, entries }), { value: 183, source: 'logged', date: '2026-09-10' })
})

check('the profile is one entry, and undated', () => {
  const e = buildProfileEntry({ heightIn: 71 })
  eq(e.id, 'profile')
  eq(e.date, null, 'dating it would file it in the log feed between two workouts')
  eq(profileFacts([e]), { heightIn: 71 })
})

check('every profile field is renderable', () => {
  for (const g of PROFILE_GROUPS) {
    ok(g.key && g.name && g.icon, `group ${g.key} is missing something`)
    for (const f of g.fields) {
      ok(f.key && f.label && f.type, `${g.key}.${f.key} is missing something`)
      ok(['number', 'text'].includes(f.type), `${f.key}: unknown type ${f.type}`)
    }
  }
})

console.log(failed ? `\n${failed} gear/profile test(s) failed` : '\nall gear and profile tests pass')
process.exit(failed ? 1 : 0)
