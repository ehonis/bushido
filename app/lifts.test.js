/* Lift logging, and the fields a card asks for:
 *   node app/lifts.test.js
 *
 * Two pure modules that landed together on 2026-09-10 and are two halves of one
 * complaint — *Log a workout* was one fixed form for everything, so a lifting
 * day was logged against boxes asking for its distance and incline, and there
 * was nowhere at all to put six exercises with their own sets and load.
 *
 * `lib/outputs.js` decides which fields are questions, and — the part worth
 * testing hardest — what happens to an answer when it stops being one.
 * `lib/lifts.js` is the shape of a logged lift and the arithmetic over it.
 *
 * Run against the REAL plan.json, because the catalog and the gates are content
 * and a case written against a fixture would pass while the shipped card asked
 * a runner for its sets.
 */

import { readFileSync } from 'node:fs'
import {
  fieldVisible, visibleOutputs, pruneHidden, pruneAttached, derivedValue, filledBy,
} from './src/lib/outputs.js'
import {
  catalogOf, exerciseOf, implementsFor, implementLabel, weightLabelFor, searchExercises,
  addLift, removeLift, patchLift, addLiftSet, removeLiftSet, setLiftSet, moveLift,
  liftsIn, liftSets, liftReps, liftVolume, liftSummary, liftsLine, lastLift, LIFT_FIELD,
} from './src/lib/lifts.js'
import { isRepeatable, extraEntryId } from './src/lib/store.js'
import { gateResolver, catalogOf as activityCatalog } from './src/lib/activities.js'
import { levelFor } from './src/lib/level.js'
import { minutesFor } from './src/lib/minutes.js'
import { acceptNumberText, numOrNull } from './src/lib/numtext.js'

const plan = JSON.parse(readFileSync(new URL('../test/fixtures/plan.json', import.meta.url), 'utf8'))
const other = plan.dailyMenu.find(m => m.id === 'log-workout')
const liftField = other.outputs.find(f => f.key === 'lifts')

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
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error(`${what || 'value'}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
  }
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg) }
// Since 2026-09-14 a field may gate on what the CATALOG says about the activity
// (`shape`, `elevation`, `incline`) rather than on a list of activity keys, so
// the card needs its resolver to be asked what is on screen. See outputs.js.
const derive = gateResolver(other)
const keys = (out) => visibleOutputs(other, out, derive).map(f => f.key)

/* ============================================================ the gates === */

check('an empty card is ONE question', () => {
  // Not seven. The activity is what makes the rest of them mean anything, and a
  // form that shows everything until told otherwise is the thing being fixed.
  eq(keys({}), ['activity'])
})

check('a run asks about distance, and a lift does not', () => {
  // The full shape matrix across all four form shapes lives in quota.test.js.
  // What this file is about is the distinction it was written for: a lift form
  // and a cardio form are not the same form.
  const run = keys({ activity: 'run' })
  ok(run.includes('distance'), 'a run has no distance field')
  ok(run.includes('speed') && run.includes('elevation'),
    'an outdoor run should record its pace and its elevation')
  ok(!run.includes('incline'), 'incline is a treadmill setting, not a road')
  ok(!run.includes('lifts'), 'a run is being asked for its exercises')

  const lift = keys({ activity: 'lift' })
  eq(lift, ['activity', 'lifts', 'duration', 'rpe'], 'the lift form')
  for (const k of ['distance', 'speed', 'elevation', 'incline']) {
    ok(!lift.includes(k), `a lift is still being asked for its ${k}`)
  }
})

check('every activity keeps the two fields that count', () => {
  // Duration and effort are declared `{ activity: "*" }` rather than as a list
  // of every option, so adding an activity to the card cannot silently drop
  // them. Effort in particular sets the day's load level.
  for (const a of activityCatalog(other.outputs.find(f => f.key === 'activity')).activities) {
    const shown = keys({ activity: a.key })
    ok(shown.includes('duration'), `${a.key} does not ask how long it took`)
    ok(shown.includes('rpe'), `${a.key} does not ask how hard it was`)
  }
})

check('a swim is counted the way a pool is counted', () => {
  // Changed on 2026-09-14: a swim used to share the running form and be measured
  // in miles. It now has its own shape — yards and laps — because that is how a
  // pool session is actually read back, and half-iron training turns on it.
  const swim = keys({ activity: 'swim' })
  ok(swim.includes('poolDistance') && swim.includes('laps'), 'a swim is counted in yards and laps')
  ok(!swim.includes('distance'), 'and not in miles')
  ok(!swim.includes('incline') && !swim.includes('elevation'), 'a swim is climbing hills')
})

check('an unanswered gate hides, and "*" needs an answer too', () => {
  eq(fieldVisible({ when: { activity: ['run'] } }, {}), false, 'unanswered list gate')
  eq(fieldVisible({ when: { activity: '*' } }, {}), false, 'unanswered wildcard')
  eq(fieldVisible({ when: { activity: '*' } }, { activity: 'lift' }), true, 'answered wildcard')
  eq(fieldVisible({ when: { activity: '*' } }, { activity: '' }), false, 'blank string is not an answer')
  eq(fieldVisible({}, {}), true, 'an ungated field')
})

check('every gate a gate can be satisfied', () => {
  // All of a `when` block has to pass, not any of it.
  const f = { when: { activity: ['lift'], mood: ['good'] } }
  eq(fieldVisible(f, { activity: 'lift' }), false, 'one of two')
  eq(fieldVisible(f, { activity: 'lift', mood: 'good' }), true, 'both')
})

/* ====================================================== dropping answers === */

check('correcting a run to a lift takes the miles with it', () => {
  // Hidden data that still charts is a log that disagrees with itself: a
  // distance on a bench-press day reaches the day's stats line and the coach's
  // digest with nothing on screen to explain it. Same rule as the per-climb
  // detail in lib/grades.js.
  const run = { activity: 'run', duration: 38, distance: 3.1, speed: 4.9, elevation: 210, rpe: 6 }
  const fixed = pruneHidden(other, { ...run, activity: 'lift' }, derive)
  eq(fixed, { activity: 'lift', duration: 38, rpe: 6 })
})

check('clearing the activity clears everything that hung off it', () => {
  const out = { activity: 'run', duration: 38, distance: 3.1, rpe: 6 }
  const { activity, ...rest } = out
  eq(pruneHidden(other, rest, derive), {})
})

check('the app-level fields are not the plan\'s to prune', () => {
  // Time spent, the note, an attached workout and the sets belong to the app and
  // declare no gate. Pruning one because the plan does not mention it would
  // delete a correction the user typed.
  const out = {
    activity: 'lift', minutesSpent: 52, improve: 'start with the row',
    elapsedMin: 50, startedAt: '2026-09-09T18:00:00.000Z', sets: { x: [{ reps: 3 }] },
  }
  eq(pruneHidden(other, out, derive), out)
})

check('a session with no gates is returned untouched', () => {
  const board = plan.dailyMenu.find(m => m.id === 'board')
  const out = { angle: 25, problems: 9, rpe: 8 }
  ok(pruneHidden(board, out) === out, 'an ungated session was rebuilt for nothing')
})

/* ================================================= what a service filled === */

check('a pruned fill stops claiming credit for itself', () => {
  // The fill works off the fields the card DECLARES, because picking the
  // activity is what turns the rest into questions. So a workout labelled as a
  // lift can still fill a distance — and pruning has to take the `filled` note
  // with the value, or detaching would try to give back a blank it never took.
  const out = {
    activity: 'lift', duration: 45, distance: 3.1,
    whoop: { id: 'w1', sport: 'weightlifting', minutes: 45, filled: { activity: 'lift', duration: 45, distance: 3.1 } },
  }
  const next = pruneAttached(other, out, derive)
  eq(next.distance, undefined, 'the distance survived a lift day')
  eq(next.whoop.filled, { activity: 'lift', duration: 45 }, 'the filled note')
})

check('a fill that survives whole keeps its snapshot as it was', () => {
  const out = {
    activity: 'run', duration: 38, distance: 3.1,
    strava: { id: 1, filled: { activity: 'run', duration: 38, distance: 3.1 } },
  }
  eq(pruneAttached(other, out, derive).strava.filled, { activity: 'run', duration: 38, distance: 3.1 })
})

check('the tag names the service, and only while the value is still its own', () => {
  const out = { duration: 38, whoop: { filled: { duration: 38 } } }
  eq(filledBy(out, 'duration'), 'WHOOP')
  eq(filledBy({ ...out, duration: 40 }, 'duration'), null, 'a number he typed over')
  eq(filledBy({ duration: 38 }, 'duration'), null, 'a number he typed himself')
  eq(filledBy({ distance: 3, strava: { filled: { distance: 3 } } }, 'distance'), 'Strava')
})

check('average speed is worked out, not asked for', () => {
  const f = { derive: 'speed' }
  eq(derivedValue(f, { distance: 3.1, duration: 38 }), 4.9)
  eq(derivedValue(f, { distance: 3.1 }), null, 'half the inputs is no answer')
  eq(derivedValue(f, { distance: 0, duration: 38 }), null, 'nothing out of a zero distance')
  eq(derivedValue({}, { distance: 3.1, duration: 38 }), null, 'an undeclared field')
  // The card's speed field declares it, or nothing above is reachable.
  eq(other.outputs.find(f2 => f2.key === 'speed').derive, 'speed')
})

/* ================================================== more than one a day === */

check('the two container cards are the repeatable ones, and the only ones', () => {
  ok(isRepeatable(other), 'log-workout cannot be logged twice')
  // `planned` joined it on 2026-09-17. Both are CONTAINERS — a card whose
  // identity comes from what the user put in it rather than from a protocol — and a
  // day with a planned swim and a planned lift on it is two of them. Every other
  // card in the menu is one specific session, and tapping "add" twice on the hip
  // block is a double tap rather than a second session.
  const repeatable = plan.dailyMenu.filter(m => isRepeatable(m)).map(m => m.id).sort()
  eq(repeatable, ['log-workout', 'planned'], 'something else claims to be repeatable')
})

check('a second one of it is a second entry; a double tap is not', () => {
  const iso = '2026-09-09'
  const day = []
  const first = extraEntryId(iso, 'log-workout', day, { fresh: true })
  eq(first, `daily-${iso}-log-workout`, 'the first one keeps the id it always had')
  day.push({ id: first })

  // The ordinary path is idempotent on purpose: tapping "add" twice on the hip
  // block writes one entry, and every device computes the same id for it.
  eq(extraEntryId(iso, 'hips', [{ id: `daily-${iso}-hips` }]), `daily-${iso}-hips`)

  const second = extraEntryId(iso, 'log-workout', day, { fresh: true })
  eq(second, `daily-${iso}-log-workout-2`)
  day.push({ id: second })
  eq(extraEntryId(iso, 'log-workout', day, { fresh: true }), `daily-${iso}-log-workout-3`)
})

check('the run and the lift are two different days-worth of numbers', () => {
  // Which is the point of them being two entries: one card, two workouts, and
  // the level and the length come off each one separately.
  const run = { activity: 'run', duration: 38, rpe: 8 }
  const lift = { activity: 'lift', duration: 52, rpe: 5 }
  eq(minutesFor(other, run), 38)
  eq(minutesFor(other, lift), 52)
  eq(levelFor(other, run), 4, 'a hard run')
  eq(levelFor(other, lift), 2, 'a steady lift')
})

/* ========================================================== the catalog === */

check('the catalog is content, and it is not small', () => {
  const cat = catalogOf(liftField)
  ok(cat.exercises.length >= 150, `only ${cat.exercises.length} exercises in the catalog`)
  ok(cat.implements.length >= 10, 'too few implements to describe a gym')
  ok(cat.groups.length >= 8, 'too few muscle groups to browse by')
  // Every exercise resolves, is in a declared group, and names only implements
  // that exist — a typo here is a movement the user cannot log or a blank dropdown.
  const impl = new Set(cat.implements.map(i => i.value))
  const seen = new Set()
  for (const ex of cat.exercises) {
    ok(ex.key && ex.name, `an exercise with no key or name: ${JSON.stringify(ex)}`)
    ok(!seen.has(ex.key), `duplicate exercise key ${ex.key}`)
    seen.add(ex.key)
    ok(cat.groups.includes(ex.group), `${ex.key} is in undeclared group ${ex.group}`)
    for (const i of ex.implements || []) ok(impl.has(i), `${ex.key} names unknown implement ${i}`)
    ok(implementsFor(liftField, ex.key).length > 0, `${ex.key} can be loaded with nothing`)
  }
})

check('every implement says what its weight column MEANS', () => {
  // "Row 30 lb" is a dumbbell in one hand or a bar on the floor, and a log that
  // calls both of them "lb" is one you cannot read back in six weeks.
  for (const i of catalogOf(liftField).implements) {
    ok(i.value && i.label && i.weightLabel, `implement missing a field: ${JSON.stringify(i)}`)
  }
  eq(weightLabelFor(liftField, 'dumbbell'), 'lb per hand')
  eq(weightLabelFor(liftField, 'barbell'), 'lb on the bar')
  eq(weightLabelFor(liftField, 'bodyweight'), 'added lb')
  eq(weightLabelFor(liftField, undefined), 'lb', 'an unanswered implement still labels the column')
})

check('the six exercises he described are all in there', () => {
  // Six common accessory lifts, each findable by the phrasing a user would type:
  // dumbbell bent-over row, seated dumbbell shoulder press, cable triceps
  // extension, bench press, straight-legged deadlift, seated external rotation.
  const wanted = [
    ['bent over row', 'bent-over-row'],
    ['seated shoulder press', 'seated-shoulder-press'],
    ['tricep extension', 'triceps-extension'],
    ['bench press', 'bench-press'],
    ['straight legged deadlift', 'stiff-leg-deadlift'],
    ['seated external rotation', 'external-rotation'],
  ]
  for (const [typed, key] of wanted) {
    const hits = searchExercises(liftField, typed).map(e => e.key)
    ok(hits.includes(key), `searching "${typed}" does not find ${key} (got ${hits.slice(0, 4)})`)
  }
  // And each of them can be loaded with the implement named above.
  const can = (key, value) => implementsFor(liftField, key).some(i => i.value === value)
  ok(can('bent-over-row', 'dumbbell'), 'no dumbbell bent-over row')
  ok(can('seated-shoulder-press', 'dumbbell'), 'no dumbbell seated press')
  ok(can('triceps-extension', 'cable'), 'no cable triceps extension')
  ok(can('bench-press', 'barbell'), 'no barbell bench press')
  ok(can('external-rotation', 'cable'), 'no cable external rotation')
})

check('the search ranks the exact thing first', () => {
  eq(searchExercises(liftField, 'bench')[0].key, 'bench-press')
  eq(searchExercises(liftField, 'deadlift')[0].key, 'deadlift')
  eq(searchExercises(liftField, 'rdl')[0].key, 'romanian-deadlift', 'an alias')
  eq(searchExercises(liftField, 'ohp')[0].key, 'overhead-press', 'an alias')
})

check('a multi-word search has to match every word', () => {
  const hits = searchExercises(liftField, 'bent row').map(e => e.key)
  ok(hits.includes('bent-over-row'), 'the obvious answer is missing')
  ok(!hits.includes('seated-cable-row'), '"bent row" matched a row that is not bent')
})

check('a muscle group is a way in, and no query browses', () => {
  const back = searchExercises(liftField, 'Back')
  ok(back.length > 10, 'searching a group finds almost nothing')
  ok(back.every(e => e.group === 'Back' || e.name.toLowerCase().includes('back')),
    'a group search returned something from elsewhere')
  eq(searchExercises(liftField, '').length, 60, 'an empty query returns the catalog, capped')
  eq(searchExercises(liftField, 'zzzz'), [], 'a miss is a miss, not everything')
})

/* ================================================ typing a weight, key by key === */

check('a half-typed decimal stays in the box and the number keeps up with it', () => {
  eq(acceptNumberText('37'), { text: '37', emit: true, value: 37 })
  eq(acceptNumberText('37.'), { text: '37.', emit: true, value: 37 }, 'the dot survives; the number is still 37')
  eq(acceptNumberText('37.5'), { text: '37.5', emit: true, value: 37.5 })
  eq(acceptNumberText('.'), { text: '.', emit: false, value: null }, 'not a number yet — wait, do not clear')
  eq(acceptNumberText('.5'), { text: '.5', emit: true, value: 0.5 })
  eq(acceptNumberText(''), { text: '', emit: true, value: null }, 'an emptied box is an answer')
  eq(acceptNumberText('37,5'), { text: '37.5', emit: true, value: 37.5 }, 'a comma keyboard is a dot keyboard')
})

check('what is not a weight is refused rather than mangled', () => {
  eq(acceptNumberText('37a'), null)
  eq(acceptNumberText('37.5.'), null, 'one dot')
  eq(acceptNumberText('-5'), null, 'nothing weighs less than nothing')
  eq(acceptNumberText('1e3'), null)
  eq(acceptNumberText('12.', { decimal: false }), null, 'reps have no halves')
  eq(acceptNumberText('12', { decimal: false }), { text: '12', emit: true, value: 12 })
  eq(numOrNull(''), null); eq(numOrNull(null), null); eq(numOrNull('37.5'), 37.5); eq(numOrNull('x'), null)
})

/* ======================================================== the logged set === */

const session = () => {
  let list = []
  list = addLift(liftField, list, 'bent-over-row')
  list = patchLift(liftField, list, 'bent-over-row-1', { implement: 'dumbbell' })
  list = setLiftSet(list, 'bent-over-row-1', 0, { reps: 10, weight: 30 })
  list = addLiftSet(list, 'bent-over-row-1')
  list = addLiftSet(list, 'bent-over-row-1')
  return list
}

check('an exercise arrives with one blank set and nothing invented', () => {
  const list = addLift(liftField, [], 'bench-press')
  eq(list.length, 1)
  eq(list[0].key, 'bench-press')
  eq(list[0].name, 'Bench press', 'the name is stored, so the log survives the catalog')
  eq(list[0].sets, [{ reps: '', weight: '' }])
  // There is no prescription here to confirm, so a number in the box would be
  // the app's invention. Same rule as the card's own duration estimate.
  eq(list[0].implement, '', 'an implement it guessed at')
  eq(addLift(liftField, [], 'no-such-lift'), [], 'an unknown key adds nothing')
})

check('reordering moves one exercise and leaves every uid alone', () => {
  /*
   * The log's counterpart to `moveItem` on a prescription, added 2026-09-21 when
   * the two screens became one component. Simpler in one way that matters: a uid
   * is minted rather than positional, so a move renumbers NOTHING — which is why
   * this needs no equivalent of the prescription's landing id.
   */
  let list = addLift(liftField, [], 'bench-press')
  list = addLift(liftField, list, 'pec-deck')
  list = addLift(liftField, list, 'bent-over-row')
  const names = (l) => l.map(x => x.key)

  const down = moveLift(list, 'bench-press-1', 'down')
  eq(names(down), ['pec-deck', 'bench-press', 'bent-over-row'])
  eq(down.map(x => x.uid).sort(), list.map(x => x.uid).sort(), 'a move must not re-mint an id')

  const up = moveLift(down, 'bench-press-1', 'up')
  eq(names(up), names(list), 'and back again')

  // Off either end is a no-op that still answers, so no row special-cases itself.
  eq(names(moveLift(list, 'bench-press-1', 'up')), names(list))
  eq(names(moveLift(list, 'bent-over-row-1', 'down')), names(list))
  eq(names(moveLift(list, 'no-such-uid', 'down')), names(list))
})

check('a movement with one honest implement does not ask', () => {
  eq(addLift(liftField, [], 'pec-deck')[0].implement, 'machine')
})

check('the implement label travels with the value', () => {
  const list = patchLift(liftField, addLift(liftField, [], 'bench-press'), 'bench-press-1', { implement: 'cable' })
  eq(list[0].implement, 'cable')
  eq(list[0].implementLabel, 'Cable', 'the label has to survive a catalog edit too')
  eq(implementLabel(liftField, 'nonsense'), 'nonsense', 'an unknown value reads as itself')
})

check('a new set carries the last one forward, not the plan\'s guess', () => {
  // Copying what the user TYPED is a different thing from pre-filling what the plan
  // guessed: three sets of ten at thirty is one set entered and two confirmed.
  const list = session()
  eq(list[0].sets, [{ reps: 10, weight: 30 }, { reps: 10, weight: 30 }, { reps: 10, weight: 30 }])
  eq(setLiftSet(list, 'bent-over-row-1', 2, { reps: 7 })[0].sets[2], { reps: 7, weight: 30 },
    'the third set could not drop off')
})

check('the same movement twice in a day is two rows', () => {
  // Supersets and second blocks are real; identity is per row, not per exercise.
  let list = addLift(liftField, session(), 'bent-over-row')
  eq(list.map(l => l.uid), ['bent-over-row-1', 'bent-over-row-2'])
  // And removing the first must not mint an id that collides with the survivor.
  list = removeLift(list, 'bent-over-row-1')
  list = addLift(liftField, list, 'bent-over-row')
  eq(list.map(l => l.uid), ['bent-over-row-2', 'bent-over-row-3'])
})

check('an exercise never drops to zero sets', () => {
  // An exercise with no sets is one the user did not do, and the way to say that is to
  // remove the exercise.
  let list = addLift(liftField, [], 'bench-press')
  list = removeLiftSet(list, 'bench-press-1', 0)
  eq(list[0].sets, [{ reps: '', weight: '' }])
  eq(removeLift(list, 'bench-press-1'), [])
})

check('the totals add up, and a half-logged set does not fake a zero', () => {
  const out = { [LIFT_FIELD]: session() }
  eq(liftsIn(out).length, 1)
  eq(liftSets(out), 3)
  eq(liftReps(out), 30)
  eq(liftVolume(out), 900)
  // Reps with no load contribute nothing rather than zero-weight noise.
  const pressups = setLiftSet(addLift(liftField, [], 'push-up'), 'push-up-1', 0, { reps: 20 })
  eq(liftReps({ [LIFT_FIELD]: pressups }), 20, 'the reps still count')
  eq(liftVolume({ [LIFT_FIELD]: pressups }), 0, 'and they are not tonnage')
  eq(liftsIn({}), [], 'nothing logged is an empty list, not a crash')
  eq(liftSets({}), 0)
})

check('a set list reads back as a sentence', () => {
  eq(liftSummary(session()[0]), '3 × 10 @ 30 lb')
  const dropped = setLiftSet(session(), 'bent-over-row-1', 2, { reps: 7, weight: 25 })
  eq(liftSummary(dropped[0]), '10 @ 30 lb, 10 @ 30 lb, 7 @ 25 lb', 'a drop-off has to show')
  eq(liftSummary({ sets: [{ reps: 12, weight: '' }] }), '1 × 12', 'no load, no "@"')
  eq(liftSummary({ sets: [{ reps: '', weight: '' }] }), '', 'an untouched exercise says nothing')
  eq(liftSummary(null), '')
})

check('the session line is what the day list shows', () => {
  const out = { [LIFT_FIELD]: addLift(liftField, session(), 'bench-press') }
  eq(liftsLine(out), '2 exercises · 4 sets · 900 lb')
  eq(liftsLine({}), '', 'a card with no lifts on it says nothing at all')
})

check('what he lifted last time is findable, newest first', () => {
  const entries = [
    { id: 'a', kind: 'daily', date: '2026-09-01',
      data: { out: { [LIFT_FIELD]: [{ uid: 'bench-press-1', key: 'bench-press', implementLabel: 'Barbell', sets: [{ reps: 5, weight: 165 }] }] } } },
    { id: 'b', kind: 'daily', date: '2026-09-08',
      data: { out: { [LIFT_FIELD]: [{ uid: 'bench-press-1', key: 'bench-press', implementLabel: 'Barbell', sets: [{ reps: 5, weight: 175 }] }] } } },
    { id: 'c', kind: 'daily', date: '2026-09-09', deleted: true,
      data: { out: { [LIFT_FIELD]: [{ uid: 'bench-press-1', key: 'bench-press', sets: [{ reps: 5, weight: 999 }] }] } } },
  ]
  eq(lastLift(entries, 'bench-press'), { date: '2026-09-08', implement: 'Barbell', summary: '1 × 5 @ 175 lb' })
  eq(lastLift(entries, 'bench-press', 'b').date, '2026-09-01', 'the entry being edited is not its own history')
  eq(lastLift(entries, 'deadlift'), null, 'a movement he has never done')
  eq(lastLift([], 'bench-press'), null)
})

check('the catalog resolves by key', () => {
  eq(exerciseOf(liftField, 'bench-press').name, 'Bench press')
  eq(exerciseOf(liftField, 'nope'), null)
})

console.log(failed ? `\n${failed} lift/output test(s) failed` : '\nall lift and output tests pass')
process.exit(failed ? 1 : 0)
