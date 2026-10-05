#!/usr/bin/env node
/*
 * What the coach is told about Strava.
 *
 * Run: node server/chat-strava.test.js
 *
 * The rule under test is the WHOOP one: absent reads as absent, a ride is only a
 * session where the user attached it, and the digest is built from the cache on disk
 * rather than from anything a phone could post.
 */

const { logDigest, stravaDigest, stravaOnSession, buildPrompt } = require('./chat.js')

let failed = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(ok ? `  ok    ${label}` : `  FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`)
}
const ok = (label, cond) => {
  if (!cond) failed++
  console.log(cond ? `  ok    ${label}` : `  FAIL  ${label}`)
}

const TODAY = '2026-09-07'
const ride = (id, date, extra = {}) => ({
  id, name: `ride ${id}`, sport: 'GravelRide', family: 'ride', date, start: `${date}T14:00:00.000Z`,
  movingMin: 82, elapsedMin: 95, distanceMi: 18.3, elevationFt: 512, avgMph: 13.9, avgHr: 142, avgWatts: 156, sufferScore: 61, gearId: 'b1', ...extra,
})
const CACHE = {
  fetchedAt: '2026-09-07T12:00:00.000Z',
  gear: { b1: { id: 'b1', name: 'Test Gravel Bike', distanceMi: 1234.5, primary: true, kind: 'bike' }, g1: { id: 'g1', name: 'Pegasus', kind: 'shoes', distanceMi: 200 } },
  activities: [
    ride(1, '2026-09-06'),
    ride(2, '2026-09-02', { distanceMi: 10, movingMin: 60 }),
    { id: 3, name: 'Evening walk', sport: 'Walk', family: 'walk', date: '2026-09-05', start: '2026-09-05T21:00:00.000Z', movingMin: 38, distanceMi: 3, paceLabel: '12:40 /mi' },
    ride(4, '2026-07-01'), // outside the window
  ],
}
const ENTRIES = [
  { id: 'e1', kind: 'daily', date: '2026-09-06', data: { optId: 'other-training', name: 'Bike', minutes: 82, out: {
    activity: 'bike', strava: { id: 1, name: 'ride 1', sport: 'GravelRide', family: 'ride', minutes: 82, elapsedMinutes: 95, distanceMi: 18.3, elevationFt: 512, avgMph: 13.9, avgHr: 142, avgWatts: 156, sufferScore: 61, calories: 812, gear: { id: 'b1', name: 'Test Gravel Bike' }, attachedAt: 'z' } } } },
]

console.log('\nwhat it tells the coach about strava')

eq('no cache is no section at all', stravaDigest(null, TODAY), null)
eq('an empty cache is not a quiet month', stravaDigest({ activities: [] }, TODAY), null)

{
  const d = stravaDigest(CACHE, TODAY, { entries: ENTRIES, now: '2026-09-07T15:00:00.000Z' })
  eq('the cache age is stated', d.staleHours, 3)
  eq('only the last four weeks of activities', d.activities.map(a => a.date), ['2026-09-06', '2026-09-05', '2026-09-02'])
  eq('the attached ride names its session', d.activities[0].attached, 'Bike')
  eq('an unattached ride says so', d.activities[2].attached, false)
  eq('gear is named on the row', d.activities[0].gear, 'Test Gravel Bike')
  eq('a walk carries its pace, not a speed', d.activities[1].paceLabel, '12:40 /mi')
  // MONDAY-start since 2026-09-20, so the coach's "last four weeks" is the same
  // week the quota board is — see `weekKey` in server/strava.js. This expectation
  // said Sunday and had been failing ever since.
  eq('weeks are Monday-start and newest first', d.weeks.map(w => w.weekOf), ['2026-08-31', '2026-06-29'])
  // Both fixture rides land in the same Monday week now, which is the point of
  // the change: they are four days apart.
  eq('a week totals per family', d.weeks[0].families.ride, { count: 2, distanceMi: 28.3, movingMin: 142, elevationFt: 1024, avgMph: 12 })
  eq('bikes are listed with their odometer, shoes are not', d.gear, [{ name: 'Test Gravel Bike', distanceMi: 1234.5, primary: true, retired: false }])
  eq('nulls are dropped from rows', Object.keys(d.activities[1]).includes('avgWatts'), false)
}

{
  const sessions = logDigest({ entries: Object.fromEntries(ENTRIES.map(e => [e.id, e])) }, TODAY).sessions
  eq('a session carries the snapshot he attached', sessions[0].strava.distanceMi, 18.3)
  eq('...with its moving minutes', sessions[0].strava.minutes, 82)
  eq('...and the calories only the detail had', sessions[0].strava.calories, 812)
  eq('...and the bike by name', sessions[0].strava.gear, 'Test Gravel Bike')
  eq('no snapshot, no field', stravaOnSession(null), null)
  eq('a bare snapshot drops what it does not have', stravaOnSession({ id: 9, distanceMi: 5 }), { distanceMi: 5 })
}

{
  const base = { instructions: 'I', brain: null, plan: { dailyMenu: [] }, state: { entries: {} }, note: null,
    request: { date: TODAY, messages: [{ role: 'you', text: 'hi' }], fields: {}, today: null } }
  const without = buildPrompt(base)
  const with_ = buildPrompt({ ...base, strava: stravaDigest(CACHE, TODAY, { entries: ENTRIES, now: '2026-09-07T15:00:00.000Z' }) })
  ok('no strava, no section', !/What Strava has on them/.test(without))
  ok('with strava, the section and how to read it', /What Strava has on them/.test(with_) && /distance-weighted/.test(with_))
  ok('the rule about finger days travels with it', /never a reason to put two hard finger/.test(with_))
}

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1) }
console.log('\nall chat-strava checks pass')
