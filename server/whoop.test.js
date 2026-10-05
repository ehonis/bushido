/* The WHOOP matching logic, tested as arithmetic:
 *   node server/whoop.test.js
 *
 * The whole risk in this feature is a WRONG match. Attaching a belay partner's
 * climb, or the lift that came before the session rather than the session, writes
 * false heart rate into the training log and there is nothing on screen afterwards
 * that would look wrong. So what is pinned here is mostly restraint: when the app
 * is allowed to say "this one", and — more importantly — when it is not.
 */

import { readFileSync } from 'node:fs'
import {
  overlapMinutes, sessionWindow, workoutWindow, snapshotOf, hardMinutes, recordedPct,
  attachedIds, rankForSession, recoveryFor, workoutsOn, baselineFor, readinessFor,
  normalizeSport, sportFamily, sportMatches, partOf, attachedMinutes, isSplit,
  choiceForSport, attachTo, detachFrom,
} from './whoop.js'

let failed = 0
const check = (name, fn) => {
  try { fn(); console.log(`  ok    ${name}`) }
  catch (err) { failed++; console.error(`  FAIL  ${name}\n        ${err.message}`) }
}
const eq = (got, want, what = '') => {
  const a = JSON.stringify(got); const b = JSON.stringify(want)
  if (a !== b) throw new Error(`${what || 'value'}: got ${a}, wanted ${b}`)
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg) }

/* Thursday night: workout mode started the gym session at 18:00 and measured 96
 * minutes. WHOOP recorded the climbing across most of it, plus a short lift
 * beforehand that is NOT the session. */
const at = (hhmm, mins) => {
  const start = Date.parse(`2026-08-20T${hhmm}:00.000Z`)
  return { start: new Date(start).toISOString(), end: new Date(start + mins * 60000).toISOString(), minutes: mins }
}
const climb = { id: 'w-climb', sport: 'rock-climbing', date: '2026-08-20', ...at('18:05', 88),
  strain: 11.4, avgHr: 132, maxHr: 168, calories: 640, percentRecorded: 98,
  zones: { zero: 6, one: 22, two: 34, three: 18, four: 7, five: 1 } }
const lift = { id: 'w-lift', sport: 'Weightlifting', date: '2026-08-20', ...at('17:10', 35),
  strain: 4.1, avgHr: 118, maxHr: 141, calories: 210, percentRecorded: 100,
  zones: { zero: 9, one: 15, two: 8, three: 3, four: 0, five: 0 } }

const timedEntry = {
  id: 'daily-2026-08-20', date: '2026-08-20',
  data: { optId: 'four-by-four', name: 'Bouldering 4×4s', minutes: 96,
    out: { startedAt: '2026-08-20T18:00:00.000Z', elapsedMin: 96 } },
}
const untimedEntry = {
  id: 'daily-2026-08-20', date: '2026-08-20',
  data: { optId: 'four-by-four', name: 'Bouldering 4×4s', minutes: 80, out: {} },
}

/* ------------------------------------------------------------------ windows */

check('overlap is measured in minutes, and an unknown window overlaps nothing', () => {
  const a = [0, 60 * 60000]
  eq(overlapMinutes(a, [30 * 60000, 90 * 60000]), 30)
  eq(overlapMinutes(a, [60 * 60000, 90 * 60000]), 0, 'touching is not overlapping')
  eq(overlapMinutes(a, [90 * 60000, 120 * 60000]), 0)
  eq(overlapMinutes(null, a), 0)
  eq(overlapMinutes(a, null), 0)
})

check('only workout mode knows what time a session happened', () => {
  ok(sessionWindow(timedEntry), 'a timed session has a window')
  eq(sessionWindow(untimedEntry), null, 'a hand-logged session has no time of day, and must not be given one')
  eq(sessionWindow({}), null)
  eq(sessionWindow({ data: { out: { startedAt: 'nonsense' } } }), null)
  // Length comes from what was measured, then from the entry, then an hour.
  const w = sessionWindow({ data: { minutes: 30, out: { startedAt: '2026-08-20T18:00:00.000Z' } } })
  eq(Math.round((w[1] - w[0]) / 60000), 30)
})

check('a workout with no end still has a window, from its own duration', () => {
  const w = workoutWindow({ start: '2026-08-20T18:00:00.000Z', minutes: 40 })
  eq(Math.round((w[1] - w[0]) / 60000), 40)
  eq(workoutWindow({ start: 'nope' }), null)
  eq(workoutWindow(null), null)
})

/* ------------------------------------------------------------------- sports */

// The session says WHAT IT IS in plan.json; this file knows WHOOP's words for it.
const climbingSession = { id: 'four-by-four', minutes: 96, sched: { whoopSport: 'climbing' } }
const hangboard = { id: 'max-hangs', minutes: 25, sched: { venue: 'home' } }

check('the sport is matched loosely, because the casing is not worth betting on', () => {
  // WHOOP's own docs show "running"; the v1 tables read "Rock Climbing"; real data
  // arrives as "rock-climbing". A comparison that picks one stops working on the day
  // the API tidies itself up.
  for (const name of ['rock-climbing', 'Rock Climbing', 'ROCK_CLIMBING', ' rock climbing ']) {
    eq(sportMatches(climbingSession, { sport: name }), true, `did not match ${JSON.stringify(name)}`)
  }
  eq(sportMatches(climbingSession, { sport: 'bouldering' }), true)
  eq(sportMatches(climbingSession, { sport: 'Bouldering' }), true)
  eq(normalizeSport('Rock  Climbing'), 'rock-climbing', 'runs of whitespace collapse to one dash')
  eq(normalizeSport(null), '')
})

check('a declared session says no as clearly as it says yes', () => {
  eq(sportMatches(climbingSession, { sport: 'weightlifting' }), false)
  eq(sportMatches(climbingSession, { sport: 'running' }), false)
  eq(sportMatches(climbingSession, { sport: '' }), false)
  // An UNDECLARED session has no opinion, which must leave everything as it was.
  eq(sportMatches(hangboard, { sport: 'weightlifting' }), null)
  eq(sportMatches(hangboard, { sport: 'rock-climbing' }), null)
  eq(sportFamily(climbingSession), 'climbing')
  eq(sportFamily(hangboard), null)
  eq(sportFamily(undefined), null)
})

/* ------------------------------------------------------------------ ranking */

check('a real time overlap picks the session out from the lift before it', () => {
  const ranked = rankForSession({ workouts: [lift, climb], entry: timedEntry, date: '2026-08-20' })
  eq(ranked[0].workout.id, 'w-climb', 'the overlapping workout ranks first')
  eq(ranked[0].likely, true)
  eq(ranked[1].workout.id, 'w-lift')
  eq(ranked[1].likely, false, 'only ever one likely candidate')
  ok(ranked[0].overlapMin >= 80, `expected a big overlap, got ${ranked[0].overlapMin}`)
  eq(ranked[1].overlapMin, 0, 'the lift finished before the session started')
})

check('a short workout wholly inside a long session reads as fully overlapping', () => {
  // Otherwise a 20-minute block inside a two-hour gym night scores 17% and never
  // clears the bar to be suggested at all.
  const block = { id: 'w-block', sport: 'rock-climbing', date: '2026-08-20', ...at('18:30', 20) }
  const ranked = rankForSession({ workouts: [block], entry: timedEntry, date: '2026-08-20' })
  eq(ranked[0].overlapPct, 100)
  eq(ranked[0].likely, true)
})

check('with no clock on the session, one workout on the day is offered and two are not', () => {
  const one = rankForSession({ workouts: [climb], entry: untimedEntry, date: '2026-08-20' })
  eq(one[0].likely, true, 'one answer to the question is offered as one')

  const two = rankForSession({ workouts: [lift, climb], entry: untimedEntry, date: '2026-08-20' })
  eq(two.filter(c => c.likely).length, 0,
    'nothing but length separates these, and length is not evidence — he picks')
  // Still ORDERED by the weak signal, so the plausible one is at the top.
  eq(two[0].workout.id, 'w-climb', 'the closer duration still sorts first')
})

check('the climb is picked out of a gym night with no clock at all', () => {
  // The case this exists for: the user logged the session by hand, so there is no
  // startedAt and no overlap to measure — but one of the two workouts is titled
  // rock-climbing and the session says it is a climbing session. That is two
  // sources agreeing about what happened, not a coincidence of length.
  const ranked = rankForSession({
    workouts: [lift, climb], entry: untimedEntry, session: climbingSession, date: '2026-08-20',
  })
  eq(ranked[0].workout.id, 'w-climb')
  eq(ranked[0].sportFit, true)
  eq(ranked[0].likely, true, 'the only climb on a climbing night should be offered')
  eq(ranked[1].sportFit, false)
  eq(ranked[1].likely, false)
})

check('two climbs on one day is ambiguous again, and nothing is claimed', () => {
  const boulder = { id: 'w-boulder', sport: 'bouldering', date: '2026-08-20', ...at('19:40', 50) }
  const ranked = rankForSession({
    workouts: [climb, boulder], entry: untimedEntry, session: climbingSession, date: '2026-08-20',
  })
  eq(ranked.filter(c => c.likely).length, 0, '"the only climb tonight" stopped being true')
  eq(ranked.every(c => c.sportFit === true), true)
})

check('a mismatched sport is never suggested, however well everything else fits', () => {
  // Only one workout on the day, exactly the right length, overlapping a timed
  // session — and titled Weightlifting on a climbing night. The app stays quiet.
  const wrong = { id: 'w-wrong', sport: 'weightlifting', date: '2026-08-20', ...at('18:00', 96) }
  const ranked = rankForSession({
    workouts: [wrong], entry: timedEntry, session: climbingSession, date: '2026-08-20',
  })
  eq(ranked[0].sportFit, false)
  eq(ranked[0].overlapPct, 100, 'it really does overlap')
  eq(ranked[0].likely, false, 'a contradiction outranks a coincidence')
  // It is still attachable — the user may have mis-titled it on the strap.
  eq(ranked.length, 1)
})

check('an undeclared session ranks exactly as it did before sports existed', () => {
  // A hangboard session at home declares no sport, so nothing above applies and
  // the old rules decide: one workout on the day is offered, two are not.
  const one = rankForSession({ workouts: [lift], entry: untimedEntry, session: hangboard, date: '2026-08-20' })
  eq(one[0].sportFit, null)
  eq(one[0].likely, true)
  const two = rankForSession({ workouts: [lift, climb], entry: untimedEntry, session: hangboard, date: '2026-08-20' })
  eq(two.filter(c => c.likely).length, 0)
})

check('the sport orders the list even where nothing is claimed', () => {
  const boulder = { id: 'w-boulder', sport: 'bouldering', date: '2026-08-20', ...at('19:40', 50) }
  const ranked = rankForSession({
    workouts: [lift, boulder, climb], entry: untimedEntry, session: climbingSession, date: '2026-08-20',
  })
  eq(ranked.at(-1).workout.id, 'w-lift', 'the mismatch sinks to the bottom')
  eq(ranked.filter(c => c.likely).length, 0, 'and two climbs are still ambiguous')
})

check('a workout already attached elsewhere is shown, not hidden, and never suggested', () => {
  const entries = [
    { id: 'other', date: '2026-08-20', data: { name: 'Bouldering with friends', out: { whoop: { id: 'w-climb' } } } },
  ]
  const ranked = rankForSession({ workouts: [lift, climb], entry: untimedEntry, date: '2026-08-20', entries })
  const taken = ranked.find(c => c.workout.id === 'w-climb')
  eq(taken.attachedTo.name, 'Bouldering with friends', 'it says where it went')
  eq(taken.likely, false)
  // Hiding it would make a mis-attachment invisible; moving one is a normal fix.
  eq(ranked.length, 2, 'it stays in the list')
  // And with the only other candidate being a poor one, nothing is claimed.
  eq(ranked.filter(c => c.likely).length, 0)
})

check('the workout on THIS session is marked as attached rather than offered again', () => {
  const mine = { ...untimedEntry, data: { ...untimedEntry.data, out: { whoop: { id: 'w-climb' } } } }
  const ranked = rankForSession({ workouts: [climb], entry: mine, date: '2026-08-20', entries: [mine] })
  eq(ranked[0].attached, true)
  eq(ranked[0].attachedTo, null, 'attached to this session is not "attached elsewhere"')
  eq(ranked[0].likely, false, 'already attached is not a suggestion')
})

check('another day\'s workouts are not candidates for this day', () => {
  const yesterday = { ...climb, id: 'w-old', date: '2026-08-19' }
  const ranked = rankForSession({ workouts: [yesterday, climb], entry: timedEntry, date: '2026-08-20' })
  eq(ranked.length, 1)
  eq(ranked[0].workout.id, 'w-climb')
})

check('nothing to rank is an empty list, not a crash', () => {
  eq(rankForSession({}), [])
  eq(rankForSession({ workouts: [], entry: timedEntry, date: '2026-08-20' }), [])
  eq(rankForSession({ workouts: [null, {}], entry: timedEntry, date: '2026-08-20' }), [])
})

/* ------------------------------------------ one workout across two sessions */

/*
 * The case: one gym visit, two logged sessions, ONE workout.
 *
 * WHOOP records the visit as a single climb. The board and then the laps are
 * trained inside it, so that workout goes on both sessions, each saying which part
 * of it was its own. The danger is not the attaching — it is that
 * a 88-minute workout sitting whole on two sessions makes the day read as 176
 * minutes, and the weekly load chart is RPE x minutes. Everything below is that
 * arithmetic.
 */
check('a split takes the overlap with the workout, not the window he typed', () => {
  const snap = snapshotOf(climb)   // 18:05 → 19:33
  const part = partOf(snap, { start: at('18:05', 0).start, end: at('19:00', 0).start })
  eq(part.minutes, 55, 'the first 55 minutes of it')
  // Typing past the end of the workout does not buy minutes WHOOP never recorded.
  const over = partOf(snap, { start: at('19:00', 0).start, end: at('21:00', 0).start })
  eq(over.minutes, 33, 'only as far as the workout actually ran')
  // Two sessions splitting one workout can never add up to more than the workout.
  ok(part.minutes + over.minutes <= snap.minutes, 'a split cannot invent minutes')
})

check('a window that misses the workout is zero minutes, not a guess', () => {
  const snap = snapshotOf(climb)
  const miss = partOf(snap, { start: at('06:00', 0).start, end: at('07:00', 0).start })
  eq(miss.minutes, 0, 'none of that workout happened then')
  // Nonsense in, nothing out — rather than a negative or reversed window.
  eq(partOf(snap, { start: at('19:00', 0).start, end: at('18:00', 0).start }), null, 'end before start')
  eq(partOf(snap, {}), null)
  eq(partOf(null, { start: at('18:00', 0).start, end: at('19:00', 0).start }), null)
})

check('the minutes a session claims are its share, or the whole workout', () => {
  const whole = snapshotOf(climb)
  eq(attachedMinutes(whole), 88, 'unsplit, the session gets the workout')
  eq(isSplit(whole), false)
  const half = { ...whole, part: partOf(whole, { start: at('18:05', 0).start, end: at('18:49', 0).start }) }
  eq(attachedMinutes(half), 44, 'split, it gets its slice')
  eq(isSplit(half), true)
  eq(half.minutes, 88, 'and the workout keeps its own length, for the card to show')
  eq(attachedMinutes(null), null)
})

check('one workout can be held by two sessions, and says which', () => {
  const board = { id: 'e-board', date: '2026-08-20',
    data: { name: 'Gym: board', out: { whoop: { id: 'w-climb', part: { minutes: 55 } } } } }
  const laps = { id: 'e-laps', date: '2026-08-20',
    data: { name: 'ARC laps', out: { whoop: { id: 'w-climb', part: { minutes: 33 } } } } }
  const map = attachedIds([board, laps])
  eq(map.get('w-climb').length, 2, 'both hold it')
  eq(map.get('w-climb').map(h => h.name), ['Gym: board', 'ARC laps'])
  ok(map.get('w-climb').every(h => h.part), 'and the list carries whether each split it')

  // From the board's own screen, the other holder is the one it names — never
  // itself, which used to be the only case this had to get right.
  const ranked = rankForSession({ workouts: [climb], entry: board, date: '2026-08-20', entries: [board, laps] })
  eq(ranked[0].attachedTo.name, 'ARC laps', 'the OTHER session, not this one')
  eq(ranked[0].attached, true, 'and it is still marked as mine')
})

check('attachedIds ignores tombstoned entries', () => {
  const live = { id: 'a', date: '2026-08-20', data: { out: { whoop: { id: 'w1' } } } }
  const dead = { id: 'b', date: '2026-08-20', deleted: true, data: { out: { whoop: { id: 'w2' } } } }
  const map = attachedIds([live, dead])
  eq(map.has('w1'), true)
  eq(map.has('w2'), false, 'a deleted entry does not hold a workout hostage')
})

/* ----------------------------------------------------------------- snapshot */

check('the snapshot is self-contained, so it survives WHOOP going away', () => {
  const snap = snapshotOf(climb, { maxHeartRate: 195 })
  eq(snap.id, 'w-climb')
  eq(snap.sport, 'rock-climbing')
  eq(snap.minutes, 88)
  eq(snap.avgHr, 132)
  eq(snap.maxHr, 168)
  eq(snap.strain, 11.4)
  // Heart rate against their own ceiling — 132/195 and 168/195.
  eq(snap.maxHeartRate, 195)
  eq(snap.pctAvgHr, 68)
  eq(snap.pctMaxHr, 86)
  eq(snap.percentRecorded, 98, 'how much of it the strap saw travels with the average')

/* How much of the session the strap saw. WHOOP sends a FRACTION — a complete
   session is `1` — which read literally captioned every workout on the card
   "only 1% recorded" and would have handed the coach a caveat about all of them. */
check('a complete session is not a 1% one', () => {
  eq(recordedPct(1), 100, 'a fraction of 1 is the whole session')
  eq(recordedPct(0.43), 43, 'a fraction is scaled')
  eq(recordedPct(98), 98, 'a value already a percentage is left alone')
  eq(recordedPct(100), 100)
  eq(recordedPct(null), null, 'no reading is no reading')
  eq(recordedPct(undefined), null)
  eq(recordedPct('x'), null)
  eq(recordedPct(-2), null, 'a negative percentage is not one')
  eq(snapshotOf({ id: 'w', percentRecorded: 1 }).percentRecorded, 100,
    'a snapshot is stored as a percentage, whatever WHOOP sent')
})
  eq(snap.zones.four, 7)
  eq(snapshotOf(null), null)
  eq(snapshotOf({}), null, 'no id, no snapshot')
})

check('with no max heart rate the percentages are absent, never estimated', () => {
  // 220-minus-age is a population regression with a ±10 bpm standard deviation.
  // A percentage off it looks exactly as authoritative as a real one.
  const snap = snapshotOf(climb)
  eq(snap.maxHeartRate, null)
  eq(snap.pctAvgHr, null)
  eq(snap.pctMaxHr, null)
  eq(snap.avgHr, 132, 'the raw number is still there')
})

check('hard minutes are zone three and up, and unknown zones are not zero', () => {
  eq(hardMinutes(snapshotOf(climb)), 26)
  eq(hardMinutes(snapshotOf(lift)), 3)
  eq(hardMinutes({ zones: {} }), null, 'no zones recorded is not "no hard minutes"')
  eq(hardMinutes(null), null)
})

/* ----------------------------------------------------------------- recovery */

const cache = {
  workouts: [climb, lift, { ...climb, id: 'w-old', date: '2026-08-19' }],
  recovery: [
    { date: '2026-08-20', recovery: 31, hrv: 42, restingHr: 58, strain: 8.2 },
    { date: '2026-08-19', recovery: 62, hrv: 55, restingHr: 52, strain: 11.0 },
    { date: '2026-08-18', recovery: 58, hrv: 51, restingHr: 53, strain: 9.4 },
    { date: '2026-08-17', recovery: 70, hrv: 58, restingHr: 51, strain: 6.1 },
    { date: '2026-08-16', recovery: 49, hrv: 47, restingHr: 54, strain: 14.2 },
  ],
}

check('a day\'s row and a day\'s workouts are found by local date', () => {
  eq(recoveryFor(cache, '2026-08-20').recovery, 31)
  eq(recoveryFor(cache, '2026-08-01'), null)
  eq(recoveryFor(cache, null), null)
  eq(workoutsOn(cache, '2026-08-20').length, 2)
  eq(workoutsOn(cache, '2026-08-19').length, 1)
  eq(workoutsOn(cache, null), [])
  eq(workoutsOn(null, '2026-08-20'), [])
})

check('the baseline is a median of prior days, so one bad night cannot move it', () => {
  // Prior HRVs: 55, 51, 58, 47 -> sorted 47, 51, 55, 58 -> median 53.
  eq(baselineFor(cache, '2026-08-20', 'hrv'), 53)
  // A mean would have been dragged by an outlier; the median is not.
  const withOutlier = { recovery: [...cache.recovery, { date: '2026-08-15', hrv: 5 }] }
  eq(baselineFor(withOutlier, '2026-08-20', 'hrv'), 51)
})

check('too little history is no baseline rather than a shaky one', () => {
  eq(baselineFor({ recovery: cache.recovery.slice(0, 3) }, '2026-08-20', 'hrv'), null)
  eq(baselineFor({ recovery: [] }, '2026-08-20', 'hrv'), null)
  eq(baselineFor(null, '2026-08-20'), null)
})

check('readiness reads today against his own normal', () => {
  const r = readinessFor(cache, '2026-08-20')
  eq(r.recovery, 31)
  eq(r.hrv, 42)
  eq(r.hrvBaseline, 53)
  eq(r.hrvDeltaPct, -21, 'HRV is 21% under his median')
  eq(r.restingHrBaseline, 52.5)
  eq(r.restingHrDelta, 5.5, 'resting heart rate is up five and a half')
  eq(r.strain, 8.2)
})

check('no reading at all, rather than a made-up one', () => {
  // Every consumer treats null as "behave exactly as you did before WHOOP existed",
  // which is the whole safety argument for letting this near the recommendation.
  eq(readinessFor(cache, '2026-08-01'), null, 'a day with no row')
  eq(readinessFor({ recovery: [{ date: '2026-08-20' }] }, '2026-08-20'), null, 'a row with no numbers')
  eq(readinessFor(null, '2026-08-20'), null)
  // WHOOP saying it does not trust its own number yet is taken at its word.
  const calibrating = { recovery: [{ date: '2026-08-20', recovery: 44, hrv: 40, calibrating: true }] }
  eq(readinessFor(calibrating, '2026-08-20'), null)
})

/* ------------------------------------------------- filling the card in --- */

/*
 * The *Log a workout* card, taken from the REAL plan.json rather than faked.
 *
 * It used to be a hand-written nine-option fixture, which was fine while the
 * sport mapping was a hardcoded map in this directory. It is now read off the
 * catalog the card carries, so a fixture would test a vocabulary the app does
 * not have — and the specific bug this rewrite fixed (three real WHOOP sports
 * resolving to nothing) is invisible to any fixture.
 */
const plan = JSON.parse(
  readFileSync(new URL('../test/fixtures/plan.json', import.meta.url), 'utf8'))
const otherCard = plan.dailyMenu.find(m => m.id === 'log-workout')
const activityField = otherCard.outputs.find(f => f.type === 'activity')
const snapOf = (w) => ({ ...snapshotOf(w), attachedAt: '2026-08-20T20:00:00.000Z' })

const forSport = (s) => choiceForSport(activityField, s)

check('a WHOOP sport answers the card, and climbing deliberately does not', () => {
  eq(forSport('running'), 'run')
  eq(forSport('Weightlifting'), 'lift')
  eq(forSport('hiking_rucking'), 'hike')
  eq(forSport('Yoga'), 'yoga')
  eq(forSport('Basketball'), 'basketball')
  eq(forSport('Rowing'), 'rowing')
  // The climbing cards are for climbing: they ask the hard-finger question and
  // this one does not, so labelling a bouldering workout as a generic logged
  // activity would hide a hard finger day from the rule that prevents injury.
  eq(forSport('rock-climbing'), null)
  eq(forSport('Bouldering'), null)
  eq(forSport('something new whoop added'), null, 'no opinion, rather than a guess')
})

check('the three sports in his own cache that used to resolve to nothing', () => {
  // The bug that produced the catalog. Before 2026-09-14 these mapped to no
  // activity at all, so attaching one filled nothing in — and on a card whose
  // every other field is gated behind the activity, that meant attaching it did
  // nothing visible whatsoever.
  eq(forSport('dance'), 'dance')
  eq(forSport('mountain-biking'), 'mtb')
  eq(forSport('activity'), 'other', "WHOOP's own generic label still lands somewhere")
})

check('every sport the catalog claims is claimed exactly once', () => {
  const seen = new Map()
  for (const a of activityField.activities) {
    for (const w of (a.whoop || [])) {
      ok(!seen.has(w), `"${w}" is claimed by both ${seen.get(w)} and ${a.key}`)
      seen.set(w, a.key)
    }
  }
})

check('attaching fills the blanks the workout can answer', () => {
  // Nobody should have to calculate or enter a time WHOOP already measured.
  const run = { id: 'w-run', sport: 'running', date: '2026-08-20', ...at('07:00', 38),
    strain: 9.1, avgHr: 148, distanceMeter: 8046.7, altitudeGainMeter: 64 }
  const out = attachTo(otherCard, {}, snapOf(run))
  eq(out.activity, 'run')
  eq(out.duration, 38, 'the minutes WHOOP measured')
  eq(out.distance, 5, 'metres converted into the miles the card asks for')
  eq(out.elevation, 210, 'metres of climb converted into feet')
  eq(out.whoop.filled, { activity: 'run', duration: 38, distance: 5, elevation: 210 },
    'what it filled has to be remembered, or detaching cannot undo it')
})

check('nothing he typed is ever overwritten', () => {
  const run = { id: 'w-run', sport: 'running', date: '2026-08-20', ...at('07:00', 38), distanceMeter: 8046.7 }
  const out = attachTo(otherCard, { activity: 'bike', duration: 44 }, snapOf(run))
  eq(out.activity, 'bike', 'it argued with him about what he did')
  eq(out.duration, 44, 'it overwrote a time he gave')
  eq(out.distance, 5, 'and it should still fill the blank one')
  eq(out.whoop.filled, { distance: 5 })
})

check('a session with a split gets ITS share, not the whole workout', () => {
  // One gym visit, two logged sessions. The whole workout on both is a day the
  // load chart reads as twice the training.
  const snap = { ...snapOf(climb), part: { start: climb.start, end: climb.end, minutes: 40 } }
  eq(attachTo(otherCard, {}, snap).duration, 40)
})

check('a card that asks for none of it is left alone', () => {
  const bare = { outputs: [{ key: 'angle', type: 'number' }] }
  const out = attachTo(bare, {}, snapOf(climb))
  eq(Object.keys(out).sort(), ['whoop'], 'it invented fields the session never declared')
  eq(out.whoop.filled, undefined, 'an empty fill should leave no bookkeeping behind')
})

check('detaching gives back the blanks it took, and only those', () => {
  const run = { id: 'w-run', sport: 'running', date: '2026-08-20', ...at('07:00', 38), distanceMeter: 8046.7 }
  const attached = attachTo(otherCard, { rpe: 7 }, snapOf(run))
  // The user corrects the distance afterwards: that number is now their.
  const edited = { ...attached, distance: 5.2 }
  const out = detachFrom(edited)
  eq(out.whoop, undefined)
  eq(out.activity, undefined, 'a field it filled and he left alone should go')
  eq(out.duration, undefined)
  eq(out.distance, 5.2, 'it deleted a correction he made')
  eq(out.rpe, 7, 'it deleted something it never touched')
})

check('attaching nothing changes nothing', () => {
  eq(attachTo(otherCard, { rpe: 7 }, null), { rpe: 7 })
  eq(detachFrom({ rpe: 7 }), { rpe: 7 }, 'detaching with nothing attached')
})

console.log(failed ? `\n${failed} whoop test(s) failed` : '\nall whoop tests pass')
process.exit(failed ? 1 : 0)
