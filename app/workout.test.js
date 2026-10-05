/* Workout mode's model, tested against the real plan.json:
 *   node app/workout.test.js
 *
 * The interesting cases are all shape disagreements. The protocol and the
 * logSpec describe the same work in different units — sub-threshold hangs are
 * "one set of five reps" in the protocol and "five loggable sets" in the log —
 * and workout mode has to pick one and be consistent about it. It picks the log.
 *
 * The other thing pinned here: rest periods are never invented. The plan's rests
 * are deliberately programmed, often longer than textbook, so a
 * rest with no source in the plan must come back null and count up on screen
 * rather than counting down to a number nobody wrote.
 */

import { readFileSync } from 'node:fs'
import {
  buildSteps, timingFor, exerciseTimer, hasWorkout, writeSet, truncateSets, clock, interval,
  elapsedMinutes, startOf, advancePhase, afterSet, COUNT_IN, LEAD_IN, blockTimers, loggedSeconds,
} from './src/lib/workout.js'
import { resolveCeiling, cfPctOfMax, cfBand } from './src/lib/force.js'
import {
  GRADES, GRADE_FIELD, gradeIndex, gradeLabel, rungLabel, isGrade, hardestGrade,
  hasGrades, repCount, fitGrades, gradesIn,
  VGRADES, vLabel, vRungLabel, CLIMB_FIELD, offersClimbs, climbsOn, blankClimb,
  DOWN_OPTIONS, downLabel, downsIn, lengthsIn,
  fitClimbs, climbsIn, hardestClimbed, fallsIn, feltLabel, FELT_MIN, FELT_MAX,
  stepClimbs,
} from './src/lib/grades.js'
import {
  minutesFor, minutesOf, dayMinutes, resolveMinutes, asksItsOwnDuration, minutesSourceOf,
} from './src/lib/minutes.js'
import { levelFor } from './src/lib/level.js'

const plan = JSON.parse(readFileSync(new URL('../test/fixtures/plan.json', import.meta.url), 'utf8'))
const menu = plan.dailyMenu
const opt = (id) => menu.find(m => m.id === id)

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

const stepsOf = (id, out = {}) => buildSteps(opt(id), out)

/* Max hangs and repeaters were one session until 2026-08-10 and are now two
 * cards that share a Monday. Several cases below care about the pair — the
 * hand-off between them, and stopping the first one early — so this walks them
 * the way the day does: one after the other. */
const mondaySteps = (out = {}) => [...stepsOf('max-hangs', out), ...stepsOf('repeaters', out)]

/* --------------------------------------------------------- shape from the log */

check('the log decides the shape, not the protocol', () => {
  // The protocol calls this one set of five reps; the logSpec calls it five
  // sets. Five sets is what you can record a short hang against, so five wins.
  const steps = stepsOf('subthreshold')
  eq(steps.length, 5, 'sub-threshold sets')
  eq(steps[0].timing.reps, 1, 'reps per set')
  eq(steps[0].timing.work, 25, 'hang length')
})

check('a rep-counting exercise keeps its reps inside one set', () => {
  const steps = stepsOf('repeaters')
  eq(steps.length, 2, 'repeater sets')
  eq(steps[0].timing.reps, 12, 'reps per set')
  eq(steps[0].timing.work, 10, 'work')
  eq(steps[0].timing.repRest, 6, 'rest between reps')
})

check('every exercise of a session appears, in order', () => {
  const steps = mondaySteps()
  eq(steps.length, 5, '3 max hangs + 2 repeater sets')
  eq(steps[0].exKey, 'maxhang')
  eq(steps.at(-1).exKey, 'repeaters')
  eq(steps[0].setCount, 3, 'max hang set count')
})

check('the split kept both halves whole', () => {
  // Monday used to be one card. Splitting it must not have quietly dropped a
  // set, a rest, or the counterweight default.
  eq(stepsOf('max-hangs').length, 3, 'max hang sets')
  eq(stepsOf('max-hangs')[0].timing.work, 7, 'hang length')
  eq(stepsOf('max-hangs')[0].timing.setRest, 180, 'three minutes, sitting down')
  eq(stepsOf('repeaters')[0].timing.work, 10)
  eq(stepsOf('repeaters')[0].timing.repRest, 6)
  eq(stepsOf('repeaters')[0].sign, '-', 'still expects counterweight')
})

check('the MVC-7 ladder is five attempts, each carrying its own load', () => {
  // The whole point of this card is the LADDER: five attempts that are not the
  // same weight as each other, logged one by one. The fields are what make it a
  // ladder rather than three hangs at a number, so they are pinned here.
  const steps = stepsOf('mvc7-test')
  eq(steps.length, 5, 'five attempts, maximum')
  eq(steps[0].timing.work, 7, 'seven seconds, which is the name of the test')
  eq(steps[0].timing.reps, 1, 'an attempt is one rep, not a rep count')
  eq(steps[0].timing.setRest, 300, 'five full minutes — under-resting measures him weak')
  eq(steps[0].sign, '+', 'this one adds weight; the plates are the point')
  ok(steps[0].fields.includes('weight') && steps[0].fields.includes('seconds'),
    'a failed attempt is data — the seconds he actually held are logged too')
})

check('an MVC-7 attempt does not inherit the last one as if he had done it', () => {
  // The load carries forward so the user is editing a number rather than typing one,
  // but only the sets the user confirmed are marked logged. On a ladder that matters
  // more than elsewhere: an unconfirmed attempt at the top weight would read as
  // a max the user never held.
  const out = { sets: { mvc7Attempt: [{ seconds: 7, weight: 50 }] } }
  const steps = stepsOf('mvc7-test', out)
  eq(steps[0].values.weight, 50, 'the attempt he logged')
  eq(steps[0].logged, true)
  eq(steps[1].values.weight, 50, 'carried forward as a starting point')
  eq(steps[1].logged, false, 'but not claimed as done')
})

/* -------------------------------------------------------------------- rest */

check('a declared rest between sets is used', () => {
  const rep = stepsOf('repeaters')[0]
  eq(rep.timing.setRest, 480, 'the source protocol\'s 8 minutes')
})

check('a setRest of zero falls back to the interval that IS declared', () => {
  // Sub-threshold puts its 60 seconds on `rest` and leaves setRest at 0. With
  // one rep per set, that 60 is the between-set rest.
  eq(stepsOf('subthreshold')[0].timing.setRest, 60)
})

check('an undeclared rest is null, never guessed', () => {
  // The 4x4s log their own rest and the plan states none, so before you have
  // logged one there is no target and the screen counts up.
  const circuits = stepsOf('four-by-four')
  eq(circuits[0].timing.setRest, null, 'no invented rest')
  // ...and once logged, the measurement becomes the target.
  eq(stepsOf('four-by-four', { setRest: 300 })[0].timing.setRest, 300)
})

check('an exercise with no timer still steps through its sets', () => {
  const steps = stepsOf('core')
  ok(steps.length >= 3, 'core has sets')
  eq(steps[0].timing.work, null, 'untimed work')
  eq(steps[0].timing.setRest, null, 'untimed rest')
})

/* ---------------------------------------------------------- reps and clocks */

/**
 * A rep is only a rep if something can end it.
 *
 * Eight foot-lifts are eight reps in the log and one continuous set on the
 * screen. Counting them as timer reps drew eight pips against a clock with
 * nothing to advance it, so the phase sat on "rep 1 of 8" for as long as you
 * left it and the only control that did anything was Skip. That is the bug
 * that showed up on Abrahangs, and it was one line of `timingFor`.
 */
check('reps are only counted where there is a clock to count them', () => {
  eq(stepsOf('core')[0].timing.reps, 1, 'eight foot-lifts are one untimed set')
  eq(stepsOf('antagonist')[0].timing.reps, 1, 'twelve press-ups likewise')
  eq(stepsOf('fun-boulder')[0].timing.reps, 1, 'an evening of problems is not a rep count')
  eq(stepsOf('repeaters')[0].timing.reps, 12, 'a timed rep still counts')
})

check('no session leaves the timer with nothing to do', () => {
  // The whole failure mode in one assertion: a set that shows rep pips must
  // have an interval that can advance them.
  for (const m of menu) {
    for (const s of buildSteps(m, {})) {
      ok(s.timing.reps === 1 || s.timing.work > 0,
        `${m.id}/${s.exKey} shows ${s.timing.reps} reps with no work interval`)
      ok(s.timing.reps === 1 || s.timing.repRest > 0,
        `${m.id}/${s.exKey} has ${s.timing.reps} timed reps with no gap between them`)
    }
  }
})

check('Abrahangs runs its own metronome', () => {
  // The reported session: three grip families, twenty pulls, one
  // uninterrupted 10-on/20-off cycle straight through. Before it had a timer
  // this was a count-up clock that never switched anything.
  const steps = stepsOf('abrahangs')
  eq(steps.length, 3, 'one loggable set per grip family')
  eq(steps.map(s => s.timing.reps).join('+'), '6+6+8', 'twenty pulls')
  for (const s of steps) {
    eq(s.timing.work, 10, `${s.exKey} work`)
    eq(s.timing.repRest, 20, `${s.exKey} rest`)
  }
  // ...and the gap between families is the same 20 seconds, so it never stops.
  eq(afterSet({ index: 0 }, steps).seconds, 20, 'four-finger into front-three')
  eq(afterSet({ index: 1 }, steps).seconds, 20, 'front-three into two-finger')
})

check('the unilateral block runs its 7 on / 3 off', () => {
  const steps = stepsOf('unilateral')
  eq(steps.length, 4, 'two sets per arm')
  eq(steps[0].timing.work, 7)
  eq(steps[0].timing.repRest, 3)
  eq(steps[0].timing.reps, 12)
  eq(steps[0].timing.setRest, 120, 'two full minutes seated')
  eq(afterSet({ index: 1 }, steps).seconds, 120, 'and the same swapping arms')
})

/* ---------------------------------------------------------------- prefill */

check('sets arrive pre-filled from the prescription', () => {
  const s = stepsOf('max-hangs')[0]
  eq(s.values.reps, 1)
  eq(s.values.seconds, 7)
  eq(s.values.weight, '', 'an unknown load stays empty rather than becoming 0')
})

check('what you logged wins, and later sets carry it forward', () => {
  const out = { sets: { maxhang: [{ reps: 1, seconds: 7, weight: 43 }] } }
  const steps = stepsOf('max-hangs', out)
  eq(steps[0].values.weight, 43, 'the set you logged')
  eq(steps[0].logged, true)
  eq(steps[1].values.weight, 43, 'carried into the next set')
  eq(steps[1].logged, false)
})

check('doing more sets than prescribed grows the list', () => {
  const out = { sets: { maxhang: [{ reps: 1 }, { reps: 1 }, { reps: 1 }, { reps: 1 }, { reps: 1 }] } }
  eq(stepsOf('max-hangs', out).filter(s => s.exKey === 'maxhang').length, 5)
})

check('the counterweight sign comes from the plan, then from what you set', () => {
  eq(stepsOf('repeaters')[0].sign, '-')
  const out = { sets: {}, signs: { repeaters: '+' } }
  eq(stepsOf('repeaters', out)[0].sign, '+')
})

/* ------------------------------------------------------------------ writes */

check('a set writes into the same structure the set log uses', () => {
  const next = writeSet({}, 'maxhang', 1, { reps: 1, seconds: 7, weight: 43 })
  eq(next.sets.maxhang.length, 2, 'set 0 is created as a placeholder')
  eq(next.sets.maxhang[1].weight, 43)
  eq(next.sets.maxhang[1].reps, 1)
})

check('writing a set leaves everything else in the log alone', () => {
  const out = { rpe: 8, fingers: 3, sets: { repeaters: [{ reps: 12 }] } }
  const next = writeSet(out, 'maxhang', 0, { reps: 1 })
  eq(next.rpe, 8)
  eq(next.sets.repeaters[0].reps, 12)
  eq(next.sets.maxhang[0].reps, 1)
})

check('an empty field stays empty rather than becoming zero', () => {
  const next = writeSet({}, 'maxhang', 0, { reps: 1, weight: '' })
  eq(next.sets.maxhang[0].weight, '', 'no load recorded is not a load of nothing')
})

check('stopping early drops the sets you did not do', () => {
  const out = { sets: { maxhang: [{ reps: 1 }, { reps: 1 }, { reps: 1 }] } }
  eq(truncateSets(out, 'maxhang', 2).sets.maxhang.length, 2)
  eq(truncateSets(out, 'maxhang', 9).sets.maxhang.length, 3, 'nothing to drop')
})

/* ------------------------------------------------------------------ clocks */

check('the clock reads the way a stopwatch does', () => {
  eq(clock(0), '0:00')
  eq(clock(7), '0:07')
  eq(clock(90), '1:30')
  eq(clock(600), '10:00')
  eq(clock(3725), '1:02:05', 'a long gym session')
  eq(clock(-4), '0:00', 'never negative')
})

check('elapsed minutes are measured, rounded and never negative', () => {
  const t0 = Date.parse('2026-10-15T18:00:00Z')
  eq(elapsedMinutes(t0, t0 + 31 * 60000), 31)
  eq(elapsedMinutes('2026-10-15T18:00:00Z', t0 + 90 * 1000), 2, 'rounded')
  eq(elapsedMinutes(t0, t0 - 5000), 0, 'a clock that went backwards')
  eq(elapsedMinutes(undefined), null, 'never started')
})

/* ------------------------------------------------------- minutes, and trust */

const dayEntry = (optId, data = {}) => ({ kind: 'daily', date: '2026-08-13', data: { optId, ...data } })

check('a hand-entered duration outranks the estimate and the measurement', () => {
  const est = opt('board').minutes
  eq(minutesOf(dayEntry('board'), menu).minutes, est, 'nothing logged falls back to the card')
  eq(minutesOf(dayEntry('board'), menu).source.startsWith("the card's estimate"), true,
    'and says so, rather than passing a plan off as an observation')

  const measured = dayEntry('board', { out: { elapsedMin: 96 } })
  eq(minutesOf(measured, menu).minutes, 96, 'workout mode beats the card')
  eq(minutesOf(measured, menu).source, 'measured by workout mode')

  // The case this whole feature exists for: trained outside workout mode, so the
  // measurement is absent or wrong, and the user fixes it afterwards in history.
  const fixed = dayEntry('board', { minutes: 75, minutesSource: 'typed', out: { elapsedMin: 96 } })
  eq(minutesOf(fixed, menu).minutes, 75, 'his correction outranks the clock')
  eq(minutesOf(fixed, menu).source, 'you entered this')
})

check('a correction that equals the estimate is still reported as his', () => {
  // The reason provenance is stored rather than inferred: these two are the same
  // number, and only one of them is an observation.
  const est = opt('board').minutes
  const typed = dayEntry('board', { minutes: est, minutesSource: 'typed' })
  eq(minutesOf(typed, menu).source, 'you entered this')
  eq(minutesOf(dayEntry('board'), menu).source.startsWith("the card's"), true)
})

check('a day is worth the sum of the sessions on it, and nothing else', () => {
  const list = [
    dayEntry('board', { minutes: 105, minutesSource: 'typed' }),
    dayEntry('lead-laps', { minutes: 25, minutesSource: 'typed' }),
    { kind: 'bodyweight', date: '2026-08-13', data: { lb: 185 } },
    { kind: 'note', date: '2026-08-13', data: { text: 'felt good' } },
  ]
  eq(dayMinutes(list, menu), 130, 'the split gym night adds back up')
  eq(dayMinutes([], menu), 0, 'an empty day costs nothing')
  eq(dayMinutes([list[2]], menu), 0, 'a bodyweight entry is not training time')
})

check('minutes never come back negative or fractional', () => {
  eq(minutesFor({ minutes: 30, minutesFrom: 'duration' }, { duration: 38.4 }), 38, 'rounded')
  eq(minutesFor({ minutes: 30 }, { elapsedMin: 0 }), 30, 'a zero measurement is not a measurement')
  eq(minutesOf(dayEntry('board', { minutes: 0 }), menu).minutes, opt('board').minutes,
    'a stored zero falls back rather than reporting a free session')
})

/* ------------------------------------------------ what a session cost you */

/**
 * The level a social session gets from what the user logged.
 *
 * This decides whether a fun night SPENDS A HARD FINGER EXPOSURE, which is the
 * rule that exists to stop them hurting themselves — so it is pinned here rather
 * than trusted to a component. The cards used to carry a 1–4 intensity slider
 * beside the 1–10 RPE slider; the pair was redundant, so they are one slider
 * now, which is why a mapping exists at all.
 */
check('a fun day takes its load level from the one slider it now has', () => {
  const fun = opt('fun-boulder')
  eq(fun.levelFrom, 'rpe', 'the merged slider is the one that feeds the level')
  eq(levelFor(fun, { rpe: 10 }), 4)
  eq(levelFor(fun, { rpe: 8 }), 4, 'projecting is a hard finger day')
  eq(levelFor(fun, { rpe: 7 }), 3, '...and 7 is deliberately not')
  eq(levelFor(fun, { rpe: 6 }), 3)
  eq(levelFor(fun, { rpe: 5 }), 2)
  eq(levelFor(fun, { rpe: 4 }), 2)
  eq(levelFor(fun, { rpe: 3 }), 1)
  eq(levelFor(fun, { rpe: 1 }), 1)
  // Every card that maps must cover its whole scale, or an RPE falls through the
  // map and reads as the card's nominal level instead of what the user logged.
  for (const m of menu) {
    if (!Array.isArray(m.levelMap)) continue
    for (let r = 1; r <= 10; r++) {
      const lvl = levelFor(m, { [m.levelFrom]: r })
      ok(lvl >= 1 && lvl <= 4, `${m.id} maps RPE ${r} to ${lvl}`)
    }
    eq(levelFor(m, { [m.levelFrom]: 10 }), 4, `${m.id} must have a top of the scale`)
  }
})

check('an entry logged before the sliders merged keeps the level it had', () => {
  // The danger is silent and one-directional: re-saving a projecting day to fix
  // its skin score must not downgrade it to the card's nominal easy level, which
  // is exactly what reading only the new field would do.
  const fun = opt('fun-boulder')
  eq(fun.levelFromWas, 'intensity')
  eq(levelFor(fun, { intensity: 4 }), 4, 'an old hard day stays hard')
  eq(levelFor(fun, { intensity: 2 }), 2)
  // The new field still wins where both exist.
  eq(levelFor(fun, { intensity: 1, rpe: 9 }), 4)
  // And with neither, the card speaks for itself.
  eq(levelFor(fun, {}), fun.level)
  eq(levelFor(opt('board'), { rpe: 2 }), opt('board').level, 'a fixed-level card ignores all of this')
})

/* ------------------------------------- one WHOOP workout, two Bushido sessions */

/**
 * The arithmetic that keeps a shared workout honest.
 *
 * WHOOP records a gym visit as ONE workout; two sessions trained inside it can
 * both have that workout attached. The failure mode is
 * silent: unsplit, the day reads as twice the training it was, and the weekly
 * load chart is RPE x minutes. So what is pinned is that a session's minutes are
 * its SHARE — and that two shares can never exceed the workout.
 */
check('a split workout gives each session only its share of the minutes', () => {
  const whole = { id: 'w1', minutes: 88, start: '2026-08-20T18:05:00.000Z', end: '2026-08-20T19:33:00.000Z' }
  const board = { minutes: 96, out: { whoop: { ...whole, part: { minutes: 55 } } } }
  const laps = { minutes: 55, out: { whoop: { ...whole, part: { minutes: 33 } } } }

  eq(minutesSourceOf({ minutes: 75 }, board.out), 'whoop')
  eq(minutesFor({ minutes: 75 }, board.out), 55, "the board's share")
  eq(minutesFor({ minutes: 60 }, laps.out), 33, "the laps' share")

  /*
   * The day, which is the number that was actually wrong.
   *
   * Built the way the app builds it — `resolveMinutes` is what stamps
   * `data.minutes` when outputs are saved — so this is the pipeline rather than a
   * hand-written total that could agree with a broken one.
   */
  const logged = (id, out) => ({
    kind: 'daily', date: '2026-08-20',
    data: { optId: id, minutes: resolveMinutes(null, opt(id), out), out },
  })
  const day = [logged('board', board.out), logged('arc', laps.out)]
  eq(dayMinutes(day, menu), 88, 'the evening happened once')

  // Unsplit on both — which the card warns about — is the 176 this exists to stop.
  const naive = [logged('board', { whoop: whole }), logged('arc', { whoop: whole })]
  eq(dayMinutes(naive, menu), 176, 'and this is what it looks like when he has not split it')
})

check('an unsplit workout behaves exactly as it did before splitting existed', () => {
  const out = { whoop: { id: 'w1', minutes: 88 } }
  eq(minutesSourceOf({ minutes: 75 }, out), 'whoop')
  eq(minutesFor({ minutes: 75 }, out), 88)
  // A typed number still outranks it, and so does a zero-minute share.
  eq(minutesFor({ minutes: 75 }, { ...out, minutesSpent: 40 }), 40)
  eq(minutesSourceOf({ minutes: 75 }, { whoop: { id: 'w1', minutes: 88, part: { minutes: 0 } } }), 'estimate',
    'a share of nothing is not a measurement of this session')
})

check('the provenance line says when the number is a share of a shared workout', () => {
  const entry = (whoop) => ({
    kind: 'daily', date: '2026-08-20',
    data: { optId: 'board', minutes: 55, out: { whoop } },
  })
  const whole = { id: 'w1', minutes: 88 }
  eq(minutesOf(entry(whole), menu).source, 'measured by WHOOP')
  const split = minutesOf(entry({ ...whole, part: { minutes: 55 } }), menu)
  eq(split.minutes, 55)
  ok(/split/.test(split.source), `the source should say so: ${split.source}`)
})

/* --------------------------------------------------- the whole menu, safely */

check('every menu session builds a workout without throwing', () => {
  for (const m of menu) {
    const steps = buildSteps(m, {})
    // Steps exist for anything with a logSpec; being OFFERED the mode is a
    // narrower question — see the checks below.
    ok(!hasWorkout(m) || steps.length > 0, `${m.id} offers a workout with no steps`)
    for (const s of steps) {
      ok(s.timing.reps >= 1, `${m.id}/${s.exKey} has ${s.timing.reps} reps per set`)
      ok(s.timing.work === null || s.timing.work > 0, `${m.id}/${s.exKey} work`)
      ok(s.timing.setRest === null || s.timing.setRest > 0, `${m.id}/${s.exKey} setRest`)
      ok(Array.isArray(s.fields) && s.fields.length > 0, `${m.id}/${s.exKey} has no fields`)
    }
  }
})

check('every declared timer names an exercise that exists', () => {
  for (const m of menu) {
    const keys = new Set((m.logSpec?.exercises || []).map(e => e.key))
    for (const b of m.protocol?.blocks || []) {
      for (const t of blockTimers(b)) {
        ok(t.exercise, `${m.id} block "${b.name}" has a timer with no exercise`)
        ok(keys.has(t.exercise),
          `${m.id} block "${b.name}" points at "${t.exercise}", which is not a logged exercise`)
        eq(exerciseTimer(m, t.exercise), t, `${m.id} timer lookup`)
      }
    }
  }
})

check('a block may carry one timer or several', () => {
  // Splitting a paragraph of protocol into three blocks so it can hold three
  // timers would be letting the clock decide how the session reads.
  eq(blockTimers({ timer: { exercise: 'a' } }).length, 1)
  eq(blockTimers({ timers: [{ exercise: 'a' }, { exercise: 'b' }] }).length, 2)
  eq(blockTimers({}).length, 0)
  eq(blockTimers(undefined).length, 0)
  eq(exerciseTimer(opt('abrahangs'), 'twoFinger').reps, 8, 'the third of one block\'s three')
})

/* ---------------------------------------------------------------- how-to */

/**
 * Every exercise has to say how to do it, and say it SHORT.
 *
 * The length limits are the actual point rather than tidiness. This content
 * exists because the protocol prose — correct, sourced, three paragraphs — got
 * read several times without landing, and the failure mode it replaces is
 * "accurate but too long to follow mid-set". A step that grows past a phone
 * line has quietly turned back into the thing it was meant to fix.
 */
check('every exercise says how to do it, in few enough words to follow', () => {
  for (const m of menu) {
    for (const ex of m.logSpec?.exercises || []) {
      const where = `${m.id}/${ex.key}`
      const how = ex.how
      ok(how, `${where} has no how-to`)
      ok(typeof how.figure === 'string' && how.figure, `${where} names no figure`)
      ok(how.gist && how.gist.length <= 90, `${where} gist is missing or too long`)
      ok(how.steps?.length >= 3 && how.steps.length <= 5,
        `${where} has ${how.steps?.length} steps; 3 to 5 is what fits on a phone`)
      for (const s of how.steps) {
        ok(typeof s === 'string' && s.length >= 8, `${where} has an empty step`)
        ok(s.length <= 130, `${where} step is ${s.length} chars — too long to read mid-set: "${s}"`)
      }
      for (const k of ['watch', 'easier']) {
        if (how[k] === undefined) continue
        ok(typeof how[k] === 'string' && how[k].length <= 160, `${where} ${k} is too long`)
      }
      // The steps are how-to, not a second copy of the prescription. If they
      // ever start carrying the numbers, the log and the timer stop being the
      // single source for them — the same split the file header describes.
      ok(!/^\s*(STEP|BLOCK)\b/i.test(how.steps[0]), `${where} step 1 reads like protocol prose`)
    }
  }
})

check('a session with no per-set prescription has no workout', () => {
  eq(hasWorkout(opt('off')), false, 'a rest day')
  eq(buildSteps(opt('off'), {}).length, 0)
  eq(hasWorkout(undefined), false, 'no session at all')
  eq(buildSteps(undefined, undefined).length, 0)
})

/* ------------------------------------------- who gets offered workout mode */

/* The mode exists to run a clock. A session that declares no interval has no clock
 * to run, so the mode is a full-screen wrapper around a set log — every phase
 * counts up, nothing advances itself, and the only thing it adds is a screen to
 * get out of. Doubled lead laps are the case that made that plain. */

check('a session that declares no interval is not offered a timer', () => {
  // Five minutes between doubles is real programming, but nobody stands at a
  // wall driving a countdown through it.
  eq(hasWorkout(opt('lead-laps')), false, 'doubled lead laps')
  // Retroactive by nature — these get logged afterwards, from memory.
  for (const id of ['fun-boulder', 'fun-sport', 'crag-day']) {
    eq(hasWorkout(opt(id)), false, id)
  }
  // Bodyweight circuits: reps you do at your own pace and mark off. Abrahangs
  // shipped exactly this way before it had a timer and was unusable.
  for (const id of ['core', 'hips', 'eccentrics', 'antagonist']) {
    eq(hasWorkout(opt(id)), false, id)
  }
  // ...and all of them still log set by set, which is the point: the log is not
  // what was removed.
  for (const id of ['lead-laps', 'core', 'crag-day']) {
    ok(buildSteps(opt(id), {}).length > 0, `${id} lost its set log`)
  }
})

check('a session that declares an interval keeps it', () => {
  // A countdown a clock can end.
  for (const id of ['subthreshold', 'max-hangs', 'repeaters', 'abrahangs', 'crawls', 'unilateral']) {
    eq(hasWorkout(id === 'x' ? null : opt(id)), true, id)
  }
  // Board intervals count UP rather than down, and that is still a clock worth
  // running: the session's own dose check is "interval 4 within 10-15% of
  // interval 1", which is worth nothing unless the intervals get logged.
  eq(hasWorkout(opt('board')), true, 'board')
  eq(hasWorkout(opt('traverse')), true, 'traverse')
  // And the 4x4s have no timer at all — their countdown comes from the rest the
  // session logs for itself.
  eq(hasWorkout(opt('four-by-four')), true, 'four-by-four')
  ok((opt('four-by-four').outputs || []).some(o => o.key === 'setRest'),
    'the 4x4 rest output is what hands it a clock — removing it removes the mode')
})

check('the plan can override the guess in either direction', () => {
  // "Would this help" is a judgement about how the user trains; the declared interval is
  // only a proxy for it, so plan.json gets the last word.
  const laps = opt('lead-laps')
  eq(hasWorkout({ ...laps, logSpec: { ...laps.logSpec, workout: true } }), true, 'forced on')
  const hangs = opt('max-hangs')
  eq(hasWorkout({ ...hangs, logSpec: { ...hangs.logSpec, workout: false } }), false, 'forced off')
  // A forced-on session with no logSpec is still nothing to step through.
  eq(hasWorkout({ id: 'x', logSpec: { workout: true, exercises: [] } }), false)
})

check('timingFor survives a half-written exercise', () => {
  eq(timingFor({}, null, {}).reps, 1)
  eq(timingFor({ fields: ['reps'], defaults: {} }, null, {}).reps, 1, 'reps with no default')
  eq(timingFor({ fields: ['seconds'], defaults: { seconds: null } }, null, {}).work, null)
})

check('a set the plan does not time is timed by the wall clock', () => {
  // Stated wins: a 7-second hang is seven seconds whatever the clock read.
  eq(loggedSeconds({ work: 7 }, { phase: 'work', measured: 9.4 }), 7)
  // Not stated: the count-up phase already knows, so the user never types it.
  eq(loggedSeconds({ work: null }, { phase: 'work', measured: 104.4 }), 104, 'rounded')
  // Only the work phase is the set. Resting and reviewing are not.
  eq(loggedSeconds({ work: null }, { phase: 'setrest', measured: 240 }), null)
  eq(loggedSeconds({ work: null }, { phase: 'work', measured: 0 }), null, 'blank, not zero')
  eq(loggedSeconds({}, {}), null, 'nothing to go on')

  // The session this exists for: every board interval must be loggable, or its
  // own "interval 4 within 10-15% of interval 1" check has nothing to read.
  const iv = stepsOf('board')[3]
  ok(iv.fields.includes('seconds'), 'an interval logs how long it took')
  eq(iv.timing.work, null, 'and it is not a fixed length — you climb until done')
  eq(loggedSeconds(iv.timing, { phase: 'work', measured: 97 }), 97)
})

/* -------------------------------------------------------------- sequencing */

/**
 * Walk the whole session the way the screen does: run each phase to its end,
 * mark every set when it comes up, and record the trace. `stop` guards against
 * a cycle that never terminates, which is the failure this exists to catch.
 */
function walk(steps, { endEarlyAt = null } = {}) {
  const trace = []
  let at = startOf(0, steps)
  for (let guard = 0; guard < 500; guard++) {
    trace.push(`${at.phase}${at.phase === 'work' ? `:${at.index}.${at.rep}` : at.phase === 'setrest' ? `→${at.index}` : ''}`)
    if (at.phase === 'finished') return trace
    at = at.phase === 'review'
      ? afterSet(at, steps, { last: endEarlyAt != null && at.index === endEarlyAt })
      : advancePhase(at, steps)
  }
  throw new Error(`never finished: ${trace.slice(-8).join(' ')}`)
}

check('a set is entered, worked and reviewed once each', () => {
  const steps = stepsOf('max-hangs')
  const trace = walk(steps)
  eq(trace.filter(p => p === 'review').length, 3, 'one review per set')
  eq(trace.filter(p => p.startsWith('work')).length, 3, 'one work phase per single-rep set')
  eq(trace.at(-1), 'finished')
})

check('the rest between sets does not eat the set after it', () => {
  // The bug this pins: the set index moves forward when the rest starts, so
  // advancing again at the end of the rest must START that set, not skip past
  // it. Getting this wrong silently logs fewer sets than you did.
  const steps = stepsOf('repeaters')
  const trace = walk(steps)
  eq(trace.filter(p => p === 'review').length, 2, 'both repeater sets reviewed')
  ok(trace.includes('work:1.1'), 'set 2 actually starts')
  ok(trace.includes('work:1.12'), 'and runs all twelve reps')
})

check('every rep of every set is counted, in order', () => {
  const steps = stepsOf('repeaters')
  const reps = walk(steps).filter(p => p.startsWith('work:')).map(p => p.slice(5))
  eq(reps.length, 24, '12 reps x 2 sets')
  eq(reps[0], '0.1')
  eq(reps[11], '0.12')
  eq(reps[12], '1.1', 'the second set restarts the rep count')
  eq(reps[23], '1.12')
})

check('reps are separated by rests, and sets are not', () => {
  const steps = stepsOf('repeaters')
  const trace = walk(steps)
  eq(trace.filter(p => p === 'represt').length, 22, '11 gaps per set, twice')
  eq(trace.filter(p => p.startsWith('setrest')).length, 1, 'one rest between the two sets')
})

check('a whole Monday runs through both its sessions', () => {
  const trace = walk(mondaySteps())
  eq(trace.filter(p => p === 'review').length, 5, '3 max hangs + 2 repeater sets')
  eq(trace.at(-1), 'finished')
})

check('stopping an exercise early jumps to the next one', () => {
  // The peak force test is the two-exercise session now: three pulls per hand.
  const steps = stepsOf('mvc-test')
  eq(steps.length, 6, '3 attempts per hand')
  // Call it after left pull 2 of 3 — attempt 3 was going nowhere.
  const trace = walk(steps, { endEarlyAt: 1 })
  eq(trace.filter(p => p === 'review').length, 5, '2 left, then all 3 right')
  ok(trace.includes('setrest\u21923'), 'skips straight to the right hand')
})

check('stopping early on the last exercise finishes the workout', () => {
  const steps = stepsOf('mvc-test')
  eq(afterSet({ index: 5 }, steps, { last: true }).phase, 'finished')
})

check('an untimed session still steps through every set', () => {
  const steps = stepsOf('core')
  const trace = walk(steps)
  eq(trace.filter(p => p === 'review').length, steps.length)
  ok(!trace.includes('countin'), 'nothing to count into when there is no clock')
  eq(trace.at(-1), 'finished')
})

check('a timed set counts you in; an untimed one starts immediately', () => {
  eq(startOf(0, stepsOf('max-hangs')).phase, 'countin')
  eq(startOf(0, stepsOf('max-hangs')).seconds, COUNT_IN)
  eq(startOf(0, stepsOf('core')).phase, 'work')
  eq(startOf(0, stepsOf('core')).seconds, 0, 'counts up')
})

check('pressing start buys longer than arriving from a rest', () => {
  // Between sets you have been sitting down for minutes. Pressing start you are
  // still holding the phone, and three seconds meant rep 1 began while you were
  // putting it down.
  ok(LEAD_IN > COUNT_IN, 'the two moments are not the same')
  eq(startOf(0, stepsOf('max-hangs'), { lead: LEAD_IN }).seconds, LEAD_IN)
  // ...but the end of a rest goes back to the short one, so the plan's own
  // interval is what stands between two sets.
  eq(advancePhase({ phase: 'setrest', rep: 1, index: 1 }, stepsOf('max-hangs')).seconds, COUNT_IN)
  // An untimed set has nothing to count into either way.
  eq(startOf(0, stepsOf('core'), { lead: LEAD_IN }).phase, 'work')
})

check('the rest between two exercises has no invented target', () => {
  const steps = stepsOf('mvc-test')
  // Left attempt 3 of 3 → first right-hand pull. Different exercises, and the
  // plan states no interval for swapping hands.
  const across = afterSet({ index: 2 }, steps)
  eq(across.phase, 'setrest')
  eq(across.index, 3)
  eq(across.seconds, 0, 'counts up rather than guessing')
  eq(steps[0].timing.nextRest, null, 'and nothing declared one')
  // Within one hand, the plan's own 3 minutes is used.
  eq(afterSet({ index: 0 }, steps).seconds, 180)
  // ...and the 8 minutes between repeater sets survived the split intact.
  eq(afterSet({ index: 0 }, stepsOf('repeaters')).seconds, 480)
})

/**
 * The actual defect, stated as an invariant.
 *
 * Workout mode arms a timeout from `seconds` and does nothing at all when it is
 * zero — that is what a count-up clock IS. So a session that means to run itself
 * must never hand back a zero anywhere except the review, or it stops dead and
 * waits for a tap that the screen gives you no obvious way to make. Abrahangs
 * returned zero for every phase it had.
 */
const runsItself = (id) => {
  const steps = stepsOf(id)
  let at = startOf(0, steps, { lead: LEAD_IN })
  for (let guard = 0; guard < 500; guard++) {
    if (at.phase === 'finished') return
    if (at.phase !== 'review') {
      ok(at.seconds > 0, `${id} stalls: ${at.phase} at set ${at.index} has no duration`)
    }
    at = at.phase === 'review' ? afterSet(at, steps, {}) : advancePhase(at, steps)
  }
  throw new Error(`${id} never finished`)
}

check('an interval session runs itself from end to end', () => {
  // Everything here declares a full set of intervals, so the only thing it ever
  // waits for is you confirming a set. Crimp crawls used to belong on this list
  // and deliberately does not any more — see the check below.
  for (const id of ['abrahangs', 'unilateral', 'repeaters', 'subthreshold', 'max-hangs', 'arc']) {
    runsItself(id)
  }
})

/**
 * ARC laps: the longest interval in the app, and the dose is the session.
 *
 * Everything else here is seconds long. A 20-minute bout is the one place a
 * fat-fingered zero in plan.json would be invisible on screen and wrong by a
 * factor of ten in the gym, so the numbers are pinned rather than trusted.
 */
check('the ARC bout is 20 minutes, twice, ten minutes apart', () => {
  const steps = stepsOf('arc')
  eq(steps.length, 2, 'two bouts')
  eq(steps[0].timing.work, 1200, '20 minutes of climbing')
  eq(steps[0].timing.reps, 1, 'a lap is not something the clock can count')
  eq(afterSet({ index: 0 }, steps).seconds, 600, '10 minutes sitting between bouts')

  /*
   * Laps are logged PER BOUT, and the session total is derived from them.
   *
   * It shipped for one day as a session-level "laps, total" box beside the
   * per-bout log, which is two answers to one question — the first thing to
   * disagree with itself the day the user corrects one and not the other. The total
   * the progress chart plots is now `totalReps`, so there is nothing to correct
   * twice. If a `laps` output ever comes back, this is the check that says why
   * it should not.
   */
  eq(steps[0].fields.join(','), 'reps,seconds')
  ok(!(opt('arc').outputs || []).some(o => o.key === 'laps'),
    'the lap total is derived from the bouts, not typed a second time')
  // And the clock must not answer the lap question for them: a 20-minute bout is
  // ONE interval as far as the timer is concerned, whatever the user climbed in it.
  eq(steps[0].timing.reps, 1, 'the clock cannot count laps')
})

check('a long interval reads in minutes, a short one in seconds', () => {
  // "2 × 1200s" is arithmetic you should not be doing in a gym.
  eq(interval(1200), '20 min')
  eq(interval(1500), '25 min')
  eq(interval(120), '2 min')
  eq(interval(119), '119s')
  eq(interval(7), '7s')
  eq(interval(180), '3 min', 'a crawl set')
})

/**
 * Crimp crawls: two sets the clock ends, and one it cannot.
 *
 * The last set is all-out — it ends when their fingers open, so its LENGTH is the
 * result and a countdown to any number at all would be the app inventing the
 * answer. Everything up to it still runs itself, including the five minutes into
 * the all-out set, because that rest is programmed and stopping dead there would
 * mean picking the phone up while sitting down waiting to go again.
 */
check('crimp crawls run themselves up to the all-out set, which waits for him', () => {
  const steps = stepsOf('crawls')
  eq(steps.length, 3, 'two three-minute crawls and one all-out set')
  eq(steps[0].timing.work, 180)
  eq(steps[1].timing.work, 180)
  eq(steps[2].exKey, 'allout')
  eq(steps[2].timing.work, null, 'the all-out set counts UP — its length is the whole point')

  // Both programmed rests are declared, so neither of them stalls.
  eq(afterSet({ index: 0 }, steps).seconds, 300, 'between the two crawls')
  eq(afterSet({ index: 1 }, steps).seconds, 300, 'and into the all-out set, across exercises')

  // The open-ended work phase is the ONLY thing on the way through that waits.
  const stalls = []
  let at = startOf(0, steps, { lead: LEAD_IN })
  for (let guard = 0; guard < 200 && at.phase !== 'finished'; guard++) {
    if (at.phase !== 'review' && !(at.seconds > 0)) stalls.push(`${at.phase}@${at.index}`)
    at = at.phase === 'review' ? afterSet(at, steps, {}) : advancePhase(at, steps)
  }
  eq(stalls.join(','), 'work@2', 'exactly one open-ended phase, and it is the all-out set')

  // Which means the seconds the user lasted get logged off the clock rather than typed.
  eq(loggedSeconds(steps[2].timing, { phase: 'work', measured: 164.6 }), 165)
  eq(loggedSeconds(steps[0].timing, { phase: 'work', measured: 164.6 }), 180, 'a stated set is its stated length')
})

check('sequencing never walks off the end of the session', () => {
  for (const m of menu) {
    const steps = buildSteps(m, {})
    if (!steps.length) continue
    const trace = walk(steps)
    eq(trace.at(-1), 'finished', `${m.id} did not finish`)
    eq(trace.filter(p => p === 'review').length, steps.length, `${m.id} reviewed the wrong number of sets`)
  }
})

check('sequencing survives a position that no longer exists', () => {
  const steps = stepsOf('core')
  eq(startOf(99, steps).phase, 'finished')
  eq(startOf(-1, steps).phase, 'finished')
  eq(afterSet({ index: 99 }, steps).phase, 'finished')
  eq(advancePhase({ phase: 'work', rep: 1, index: 99 }, steps).phase, 'review')
})

/* ------------------------------------------------------- critical force */

/**
 * These decide the kilograms the user sets the gauge to. A wrong answer here does
 * not look wrong on screen — it trains the wrong intensity for a month — so the
 * conservative rule and the refusal to guess are both pinned.
 */
const cfTest = (data, date = '2026-08-08') =>
  ({ id: `t-${date}`, kind: 'test', date, updatedAt: `${date}T23:50:00Z`, data: { testId: 'critical-force', ...data } })

check('the ceiling applies the correction the validation study supports', () => {
  const c = resolveCeiling([cfTest({ cfKg: 18.2 })])
  eq(c.cf, 18.2)
  eq(c.corrected, 12.2, 'CF minus 6')
  eq(c.ceiling, 12.2)
  eq(c.bound, 'corrected')
})

check('CFmin binds when it is the lower of the two', () => {
  const c = resolveCeiling([cfTest({ cfKg: 18.2, cfMinKg: 12 })])
  eq(c.ceiling, 12, 'CFmin is lower than CF-6')
  eq(c.bound, 'cfmin')
})

check('...and does not when it is not', () => {
  // The normal case: CFmin is the lowest of the last three contractions, so it
  // sits just under CF and well above CF-6.
  const c = resolveCeiling([cfTest({ cfKg: 18.2, cfMinKg: 18.4 })])
  eq(c.ceiling, 12.2, 'the correction still binds')
  eq(c.bound, 'corrected')
})

check('the newest test wins', () => {
  const c = resolveCeiling([
    cfTest({ cfKg: 18.2 }, '2026-08-08'),
    cfTest({ cfKg: 23.0 }, '2026-09-19'),
    cfTest({ cfKg: 21.0 }, '2026-09-05'),
  ])
  eq(c.cf, 23.0)
  eq(c.date, '2026-09-19')
})

check('a deleted test is not a test', () => {
  const tomb = { ...cfTest({ cfKg: 30 }, '2026-09-19'), deleted: true }
  eq(resolveCeiling([cfTest({ cfKg: 18.2 }), tomb]).cf, 18.2)
})

check('no test means no ceiling, never a guessed one', () => {
  eq(resolveCeiling([]), null)
  eq(resolveCeiling(), null)
  eq(resolveCeiling([{ kind: 'test', date: '2026-08-08', data: { testId: 'mvc-block', rightKg: 52 } }]), null)
  eq(resolveCeiling([cfTest({ cfMinKg: 18 })]), null, 'CFmin alone cannot produce a ceiling')
  eq(resolveCeiling([cfTest({ cfKg: 0 })]), null)
  eq(resolveCeiling([cfTest({ cfKg: 'nonsense' })]), null)
})

check('a nonsense CFmin is ignored rather than trusted', () => {
  eq(resolveCeiling([cfTest({ cfKg: 18.2, cfMinKg: 0 })]).ceiling, 12.2)
  eq(resolveCeiling([cfTest({ cfKg: 18.2, cfMinKg: null })]).ceiling, 12.2)
})

check("CF reads as a fraction of the max it was measured against", () => {
  const c = resolveCeiling([cfTest({ cfKg: 18.2, mvcKg: 48.6 })])
  eq(cfPctOfMax(c), 37.4)
  // Fryer's band is 41.0 +/- 6.2, so 34.8 to 47.2.
  eq(cfBand(30), 'below')
  eq(cfBand(34.7), 'below')
  eq(cfBand(34.9), 'within', 'just inside the lower edge')
  eq(cfBand(41), 'within')
  eq(cfBand(47.3), 'above')
  eq(cfPctOfMax(resolveCeiling([cfTest({ cfKg: 18.2 })])), null, 'no max, no ratio')
  eq(cfBand(null), null)
})

check("a mid-range ratio sits inside the reference band, not below it", () => {
  // Worth pinning explicitly because it is tempting to read 37.4% as evidence
  // of the endurance deficit the block assumes. It is in the lower half of the
  // normal range and no further than that — one test, 21% CV.
  const c = resolveCeiling([cfTest({ cfKg: 18.2, mvcKg: 48.6 })])
  eq(cfBand(cfPctOfMax(c)), 'within')
})

check("a first result resolves to the dose to hold", () => {
  const c = resolveCeiling([cfTest({ cfKg: 18.2, mvcKg: 48.6 })])
  eq(c.ceiling, 12.2, 'ceiling')
  eq(Math.round((c.ceiling - 2) * 10) / 10, 10.2, 'unilateral target is ceiling - 2')
})

check('the critical-force test is wired into the plan', () => {
  const test = plan.tests.find(t => t.id === 'critical-force')
  ok(test, 'no critical-force test in plan.json')
  const keys = test.metrics.map(m => m.key)
  for (const k of ['cfKg', 'cfMinKg', 'mvcKg']) ok(keys.includes(k), `metric ${k} missing`)
  ok(test.procedure?.length && test.cautions?.length && test.interpretation, 'test is incomplete')
  // The session it doses has to declare that it is dosed against the ceiling,
  // or the resolved number never reaches the screen.
  const uni = opt('unilateral')
  const block = uni.protocol.blocks.find(b => b.loadCeiling)
  ok(block, 'the unilateral block no longer declares loadCeiling')
  eq(block.loadCeiling.offset, -2)
})

/* ------------------------------------------------ time spent, on every session */

check('what he typed for time spent outranks everything measured', () => {
  const opt = { minutes: 150, id: 'x' }
  eq(minutesFor(opt, {}), 150, 'nothing said falls back to the estimate')
  eq(minutesFor(opt, { minutesSpent: 95 }), 95)
  eq(minutesFor(opt, { minutesSpent: 95, elapsedMin: 160, whoop: { minutes: 140 } }), 95,
    'a number he typed beats two instruments')
  eq(minutesFor(opt, { minutesSpent: 95.6 }), 96, 'rounded')
})

check('a blank time-spent box is not a zero-minute session', () => {
  const opt = { minutes: 150 }
  eq(minutesFor(opt, { minutesSpent: '' }), 150)
  eq(minutesFor(opt, { minutesSpent: null }), 150)
  eq(minutesFor(opt, { minutesSpent: undefined }), 150)
  eq(minutesFor(opt, { minutesSpent: 'nonsense' }), 150)
  eq(minutesFor(opt, { minutesSpent: -20 }), 150, 'a negative session did not happen')
  // But a zero the user TYPED is an answer, unlike a zero off a clock.
  eq(minutesFor(opt, { minutesSpent: 0 }), 0)
  eq(minutesFor(opt, { elapsedMin: 0 }), 150, 'a clock that read zero measured nothing')
})

check('attaching a WHOOP workout sets the session length with no second tap', () => {
  const opt = { minutes: 150 }
  // The point of the ordering: the user presses attach, and the session is 96 minutes
  // long. Having to then press "use 96 from WHOOP" was one tap to confirm a number
  // the app already had.
  eq(minutesFor(opt, { whoop: { minutes: 96 } }), 96)
  eq(minutesSourceOf(opt, { whoop: { minutes: 96 } }), 'whoop')
  // An attach is a deliberate act; workout mode's clock runs whether or not the user
  // thought about it. So the explicit one wins — and typing still beats both.
  eq(minutesFor(opt, { elapsedMin: 88, whoop: { minutes: 96 } }), 96)
  eq(minutesFor(opt, { minutesSpent: 70, elapsedMin: 88, whoop: { minutes: 96 } }), 70)
  eq(minutesFor(opt, { whoop: { minutes: 0 } }), 150, 'a workout of no length is not one')
  eq(minutesFor(opt, { whoop: {} }), 150)
  eq(minutesSourceOf(opt, { whoop: {} }), 'estimate')
  // Detaching gives the clock back rather than leaving WHOOP's number stranded.
  eq(minutesFor(opt, { elapsedMin: 88 }), 88)
})

check('the number and the sentence under it cannot disagree', () => {
  // They did, when the order was written down twice. One function decides now, and
  // both the value and the provenance line read it.
  const expect = {
    typed: 'you entered this',
    whoop: 'measured by WHOOP',
    timer: 'measured by workout mode',
    estimate: "the card's estimate",
  }
  const outs = {
    typed: { minutesSpent: 65 },
    whoop: { whoop: { minutes: 96 } },
    timer: { elapsedMin: 88 },
    estimate: {},
  }
  const board = opt('board')
  for (const [key, out] of Object.entries(outs)) {
    eq(minutesSourceOf(board, out), key, `${key}: wrong source`)
    const entry = { kind: 'daily', date: '2026-08-20', data: { optId: 'board', out } }
    const read = minutesOf(entry, menu)
    ok(read.source.startsWith(expect[key]), `${key}: provenance read "${read.source}"`)
    eq(read.minutes, minutesFor(board, out), `${key}: the number disagrees with minutesFor`)
  }
  // And Log a workout, whose duration is its own field, reads as their either way.
  eq(minutesSourceOf(opt('log-workout'), { duration: 38 }), 'declared')
})

check('a session that asks for its own duration does not get a second box', () => {
  eq(asksItsOwnDuration(opt('log-workout')), true, 'Log a workout asks for its own')
  eq(asksItsOwnDuration(opt('four-by-four')), false)
  eq(asksItsOwnDuration(undefined), false)
  // And that declared field still wins over the estimate.
  eq(minutesFor(opt('log-workout'), { duration: 38 }), 38)
})

check('the provenance names the field that won, never the value', () => {
  const dayOf = (optId, out, extra = {}) => ({
    kind: 'daily', date: '2026-08-20', data: { optId, out, ...extra },
  })
  eq(minutesOf(dayOf('board', { minutesSpent: 95 }), menu).source, 'you entered this')
  // A typed number that happens to equal the card's estimate still says so —
  // this is exactly the case an inference from the value gets wrong.
  const est = opt('board').minutes
  eq(minutesOf(dayOf('board', { minutesSpent: est }), menu).source, 'you entered this')
  eq(minutesOf(dayOf('board', { elapsedMin: 96 }), menu).source, 'measured by workout mode')
  eq(minutesOf(dayOf('board', { whoop: { minutes: 96 } }), menu).source, 'measured by WHOOP')
  eq(minutesOf(dayOf('board', {}), menu).source.startsWith("the card's estimate"), true)
  eq(minutesOf(dayOf('log-workout', { duration: 38 }), menu).source, 'you entered this')
})

check('editing an output cannot rewrite a correction made before the field existed', () => {
  /* A legacy entry shape: 40 minutes typed in the history tab against a
   * 3-minute workout-mode clock. Saving any output recomputes `data.minutes`, so
   * without this the day would have silently become three minutes long — and
   * kept the "you entered this" label while it did. */
  const legacy = { optId: 'mvc7-test', minutes: 40, minutesSource: 'typed', out: { elapsedMin: 3 } }
  eq(resolveMinutes(legacy, opt('mvc7-test'), legacy.out), 40)
  eq(minutesOf({ kind: 'daily', date: '2026-08-11', data: legacy }, menu).minutes, 40)
  // A new correction through the current field replaces it outright.
  eq(resolveMinutes(legacy, opt('mvc7-test'), { ...legacy.out, minutesSpent: 55 }), 55)
  // With no legacy stamp it is an ordinary resolution.
  eq(resolveMinutes({ optId: 'board' }, opt('board'), { elapsedMin: 96 }), 96)
  eq(resolveMinutes(undefined, opt('board'), {}), opt('board').minutes)
})

check('the day total adds up what each session actually cost', () => {
  const day = [
    { kind: 'daily', date: '2026-08-20', data: { optId: 'four-by-four', out: { minutesSpent: 65 } } },
    { kind: 'daily', date: '2026-08-20', data: { optId: 'lead-laps', out: { minutesSpent: 26 } } },
  ]
  eq(dayMinutes(day, menu), 91)
  // A stated zero contributes zero rather than falling back to the estimate.
  eq(dayMinutes([{ kind: 'daily', date: '2026-08-20', data: { optId: 'board', out: { minutesSpent: 0 } } }], menu), 0)
})

/* ----------------------------------------------------- the route-grade ladder */

check('the ladder is 5.7 to 5.12 with modifiers, and nothing outside it', () => {
  eq(GRADES[0].label, '5.7', 'easiest rung')
  eq(GRADES.at(-1).label, '5.12', 'hardest rung')
  eq(GRADES.length, 16, 'rungs')
  // The endpoints carry no modifier that would leave the stated range.
  ok(!GRADES.some(g => g.label === '5.7−' || g.label === '5.12+'), 'ladder ran past its ends')
  // Ordered, easiest first — the charts and hardestGrade both rely on it.
  const vals = GRADES.map(g => g.value)
  eq(vals.join(), [...vals].sort((a, b) => a - b).join(), 'rungs out of order')
  // The mapping: 5.10− is 10.1, 5.10 is 10.2.
  eq(gradeLabel(10.1), '5.10−')
  eq(gradeLabel(10.2), '5.10')
  eq(gradeLabel(10.3), '5.10+')
})

check('a rung is bit-identical to what a select hands back', () => {
  // The picker round-trips through a string, so `10 + 0.1 === Number('10.1')`
  // has to hold or the selected option renders blank and clears itself.
  for (const g of GRADES) {
    ok(g.value === Number(String(g.value)), `${g.label} does not round-trip`)
    ok(isGrade(Number(String(g.value))), `${g.label} is not on its own ladder`)
  }
})

check('an off-ladder grade keeps its own number rather than being rounded onto a rung', () => {
  // The old label said "enter 10.4 for 5.10d", so a hand-written 10.4 exists in
  // principle. Relabelling it 5.10+ would be inventing a claim about what the user
  // climbed; showing 10.4 is at least true.
  eq(gradeLabel(10.4), '10.4')
  eq(isGrade(10.4), false)
  eq(gradeIndex(10.4), -1)
  eq(gradeLabel(''), '')
  eq(gradeLabel(null), '')
  eq(gradeIndex(null), -1, 'absent is not a rung')
})

check('the chart axis is the rung, not the decimal', () => {
  // Ordinal on purpose: 10.3 - 10.1 is not "0.2 of a grade".
  eq(rungLabel(gradeIndex(10.2)), '5.10')
  eq(rungLabel(gradeIndex(9.2)), '5.9')
  // A tick between two rungs loses its label rather than inventing a grade.
  eq(rungLabel(8.5), '')
  eq(rungLabel(-1), '')
  eq(rungLabel(99), '')
})

check('the hardest grade of a set is the hardest, and blanks are not zero', () => {
  eq(hardestGrade([10.1, 10.2]), 10.2)
  eq(hardestGrade(['', 10.1]), 10.1, 'a lap with no grade must not read as 0')
  eq(hardestGrade(['', '']), null)
  eq(hardestGrade([]), null)
  eq(hardestGrade(), null)
})

/* --------------------------------------------------- a grade per rep, not per set */

check('the doubled lead laps record a grade per rep', () => {
  const ex = opt('lead-laps').logSpec.exercises.find(e => e.key === 'doubles')
  ok(hasGrades(ex.fields), 'the doubles no longer log a grade per rep')
  eq(ex.defaults.reps, 2, 'a double is two laps')
  // And the session-level number it replaced is gone, so there is exactly one
  // place a lead-lap grade is entered.
  ok(!(opt('lead-laps').outputs || []).some(o => o.key === 'grade'),
    'two grade fields on one session is two answers to one question')
})

check('the grade list is exactly as long as the rep count', () => {
  eq(fitGrades([], 2).length, 2)
  eq(fitGrades([10.2], 2).join(), '10.2,', 'grew with a blank')
  // A typical night: one double at 5.10 twice, one at 5.10- then 5.10.
  eq(fitGrades([10.2, 10.2], 2).join(), '10.2,10.2')
  eq(fitGrades([10.1, 10.2], 2).join(), '10.1,10.2')
  // Dropping a lap drops its grade — a hidden third grade would chart a lap the user
  // says the user did not climb.
  eq(fitGrades([10.1, 10.2, 10.3], 2).join(), '10.1,10.2')
  eq(fitGrades(undefined, 3).join(), ',,')
  eq(fitGrades('nonsense', 1).join(), '')
})

check('a blank rep count still offers one picker, and a silly one is capped', () => {
  eq(repCount(''), 1, 'no reps typed must not hide the grade input')
  eq(repCount(0), 1)
  eq(repCount(-4), 1)
  eq(repCount('nonsense'), 1)
  eq(repCount(2), 2)
  eq(repCount(2.7), 2, 'a fractional lap is not a lap')
  eq(repCount(500), 20, 'capped')
})

check('the grades of a whole session read out in the order they were climbed', () => {
  const rows = [{ reps: 2, grades: [10.2, 10.2] }, { reps: 2, grades: [10.1, 10.2] }]
  eq(gradesIn(rows).join(), '10.2,10.2,10.1,10.2')
  eq(hardestGrade(gradesIn(rows)), 10.2)
  // Rows from before the field existed contribute nothing rather than crashing.
  eq(gradesIn([{ reps: 2 }, { reps: 2, grades: [10.1] }]).join(), '10.1')
  eq(gradesIn([]).join(), '')
  eq(gradesIn().join(), '')
})

check('a per-rep list survives being written back as a set', () => {
  // writeSet coerces every value with Number(), and Number([10.1, 10.2]) is NaN.
  const out = writeSet({}, 'doubles', 0, { reps: 2, [GRADE_FIELD]: [10.1, 10.2] })
  const row = out.sets.doubles[0]
  eq(row.reps, 2)
  ok(Array.isArray(row.grades), 'the grade list was coerced to a number')
  eq(row.grades.join(), '10.1,10.2')
  // A lap with no grade stays blank rather than becoming 0.
  const blank = writeSet({}, 'doubles', 0, { reps: 2, [GRADE_FIELD]: ['', 10.2] })
  eq(blank.sets.doubles[0].grades.join(), ',10.2')
})

/* ------------------------------------------- the fun days' per-climb detail */

check('the V ladder is V0 to V10, ordered, and its value is its position', () => {
  eq(VGRADES[0].label, 'V0')
  eq(VGRADES.at(-1).label, 'V10')
  eq(VGRADES.length, 11)
  // V is ordinal-by-integer: the stored value IS the chart position, so the
  // ladder must be the plain integers in order.
  VGRADES.forEach((g, i) => eq(g.value, i, `${g.label} is not its own position`))
  eq(vLabel(4), 'V4')
  // Off-ladder stays raw, never rounded onto a rung — same rule as the routes.
  eq(vLabel(4.5), '4.5')
  eq(vLabel(''), '')
  // The axis formatter loses the label between rungs rather than inventing one.
  eq(vRungLabel(4), 'V4')
  eq(vRungLabel(4.5), '')
})

check('both fun days offer per-climb detail, on a scale the app knows', () => {
  const boulder = opt('fun-boulder').logSpec.exercises.find(e => e.key === 'problems')
  const sport = opt('fun-sport').logSpec.exercises.find(e => e.key === 'routes')
  ok(offersClimbs(boulder), 'the fun boulder day lost its per-problem option')
  ok(offersClimbs(sport), 'the fun sport day lost its per-route option')
  eq(boulder.climbLog.scale, 'v', 'a boulder problem is graded in V')
  eq(sport.climbLog.scale, 'yds', 'a route is graded off the route ladder')
  ok(boulder.climbLog.styles.length > 0 && sport.climbLog.styles.length > 0,
    'the style vocabulary is content and must come from the plan')
  ok(boulder.repName && sport.repName, 'a rep of these is a problem/route, not a "rep"')
  // And it is an OPTION: the default log is still one row of reps, so a night
  // the user does not want the detail is still zero typing.
  ok(!boulder.fields.includes(CLIMB_FIELD) && !sport.fields.includes(CLIMB_FIELD),
    'per-climb detail must be opt-in, not seeded into every entry')
})

/**
 * The board offers the same detail, and it is the first session to offer it with
 * a CLOCK — which is what makes the two rules below load-bearing rather than
 * tidy: what was climbed and what was fallen off, during the session and after.
 */
/**
 * Every card the user climbs a route or a boulder on offers the same per-climb line.
 *
 * Any route or boulder, on any workout, can be marked with its grade and whether
 * it was a fall. Listed by id rather than derived, because the interesting half is which cards
 * are DELIBERATELY absent: a hangboard set has no route to grade, and the wall
 * traverse is not a route or a boulder either.
 */
check('every card with a route or a boulder on it offers per-climb detail', () => {
  const CLIMBS_ON = {
    board: 'intervals', 'four-by-four': 'circuits', 'lead-laps': 'doubles',
    arc: 'bout', economy: 'laps', 'crag-day': 'burns',
    'fun-boulder': 'problems', 'fun-sport': 'routes',
  }
  for (const [id, key] of Object.entries(CLIMBS_ON)) {
    const ex = opt(id).logSpec.exercises.find(e => e.key === key)
    ok(ex, `${id}/${key} is gone`)
    ok(offersClimbs(ex), `${id} lost its per-climb option`)
    ok(['v', 'yds'].includes(ex.climbLog.scale), `${id} grades on ${ex.climbLog.scale}`)
    ok(ex.repName, `${id} must say what one of them is called`)
    ok(ex.fields.includes('reps'), `${id} needs a rep count for the list to follow`)
    ok(!ex.fields.includes(CLIMB_FIELD), `${id} must keep it opt-in`)
  }
  // The hangboard has no route to grade, and nor does traversing sideways on
  // jugs. Offering it there is noise on a form the user fills in mid-session.
  for (const id of ['max-hangs', 'repeaters', 'subthreshold', 'crawls', 'traverse', 'core']) {
    for (const ex of opt(id).logSpec?.exercises || []) {
      ok(!offersClimbs(ex), `${id}/${ex.key} offers a grade for something that has none`)
    }
  }
})

/**
 * One grade per rep, wherever it is asked.
 *
 * The doubled lead laps logged a grade per lap long before the per-climb detail
 * existed, so switching the detail on there must not put a second ladder beside
 * the first — see ClimbLog's `omitGrade`. This is the plan-side half of that:
 * lead-laps is the only card where both fields meet.
 */
/* ---------------------------------------------------------- down-climbing */

/**
 * A lap climbed and reversed is TWO lengths of wall, and the app has to know it.
 *
 * For the route sessions: a lap climbed up and then down-climbed counts as
 * effectively double — plus the other case, a lap that was ONLY a down-climb (led
 * the 5.10, down-climbed the 5.8 next to it). Both optional, because most laps are
 * neither.
 */
check('a down-climbed lap counts as two lengths, a pure down-climb as one', () => {
  const rows = [{ reps: 3, climbs: [
    { ...blankClimb(), grade: 10.2 },                    // up
    { ...blankClimb(), grade: 10.2, down: 'both' },      // up and back down
    { ...blankClimb(), grade: 8.2, down: 'only' },       // only down
  ] }]
  eq(lengthsIn(rows), 4, '3 laps, one of them reversed')
  eq(downsIn(rows), 2, 'two of them involved down-climbing')

  // The rep count is untouched: it is how many climbs the user did, and the climb list
  // follows it. Merging the two would put the list out of step with the count.
  eq(rows[0].reps, 3)
})

check('lengths equal reps until something is actually down-climbed', () => {
  // The property that makes it safe to plot: switching the ARC chart to lengths
  // cannot step the series on the day the user starts recording them.
  eq(lengthsIn([{ reps: 4 }]), 4, 'no detail at all')
  eq(lengthsIn([{ reps: 2, climbs: [blankClimb(), blankClimb()] }]), 2, 'detail, nothing marked')
  eq(lengthsIn([{ reps: 2, climbs: [{ ...blankClimb(), down: 'only' }, blankClimb()] }]), 2,
    'a pure down-climb is one length, not two')
  eq(lengthsIn([]), 0)
  eq(lengthsIn(undefined), 0)
  eq(downsIn([{ reps: 2 }]), 0, 'nothing said is not a down-climb')
  // A row whose list is shorter than its reps still counts every rep — the user can
  // switch the detail on halfway through a session.
  eq(lengthsIn([{ reps: 5, climbs: [{ ...blankClimb(), down: 'both' }] }]), 6)
})

check('a climb record logged before down-climbing existed reads as an ordinary lap', () => {
  const old = { grade: 10.2, fell: true, felt: 1, style: 'vert' }
  eq(lengthsIn([{ reps: 1, climbs: [old] }]), 1)
  eq(downsIn([{ reps: 1, climbs: [old] }]), 0)
  eq(blankClimb().down, '', 'and blank is the ordinary case')
  eq(DOWN_OPTIONS[0].value, '', 'which is also the first option offered')
  eq(downLabel(''), '', 'the ordinary case has no label to show')
  eq(downLabel('both'), 'up + down')
})

check('down-climbing is offered on the route cards and nowhere else', () => {
  // You down-climb a route. Offering it on a twelve-move boulder problem is a
  // picker for something nobody does, on a form filled in mid-session.
  const spec = (id, key) => opt(id).logSpec.exercises.find(e => e.key === key).climbLog
  for (const [id, key] of [['lead-laps', 'doubles'], ['arc', 'bout'], ['economy', 'laps'],
    ['fun-sport', 'routes'], ['crag-day', 'burns']]) {
    eq(spec(id, key).downClimb, true, `${id} should offer it`)
    eq(spec(id, key).scale, 'yds', `${id} is a route card`)
  }
  for (const [id, key] of [['board', 'intervals'], ['four-by-four', 'circuits'], ['fun-boulder', 'problems']]) {
    ok(!spec(id, key).downClimb, `${id} should not offer it`)
  }
  // Stated as an invariant rather than a list: every card that offers it grades
  // on the route ladder, and no boulder card does.
  for (const m of menu) {
    for (const ex of m.logSpec?.exercises || []) {
      if (ex.climbLog?.downClimb) eq(ex.climbLog.scale, 'yds', `${m.id} offers down-climbing on ${ex.climbLog.scale}`)
    }
  }
})

check('the one card that logs grades per rep still only asks once', () => {
  const doubles = opt('lead-laps').logSpec.exercises.find(e => e.key === 'doubles')
  ok(hasGrades(doubles.fields), 'the per-lap grade ladder is still the default')
  ok(offersClimbs(doubles), '...and the detail is offered on top of it')
  // Everything else that offers the detail carries no grade field, so its climb
  // rows are the only place a grade is asked.
  for (const m of menu) {
    for (const ex of m.logSpec?.exercises || []) {
      if (!offersClimbs(ex) || m.id === 'lead-laps') continue
      ok(!hasGrades(ex.fields), `${m.id}/${ex.key} would ask for a grade twice`)
    }
  }
})

check('the board offers per-problem detail, and workout mode carries it', () => {
  const ex = opt('board').logSpec.exercises.find(e => e.key === 'intervals')
  ok(offersClimbs(ex), 'the board lost its per-problem option')
  eq(ex.climbLog.scale, 'v', 'a board problem is graded in V')
  eq(ex.repName, 'problem', 'a rep of an interval is a problem')
  ok(ex.climbLog.styles.length > 0, 'the style vocabulary is content')
  ok(!ex.fields.includes(CLIMB_FIELD), 'still an option — the default log is reps and seconds')
  // The review screen can only offer what the step carries.
  eq(buildSteps(opt('board'), {})[0].climbLog, ex.climbLog, 'the step must carry the offer')
  eq(buildSteps(opt('repeaters'), {})[0].climbLog, null, 'and null where the plan makes no offer')
})

/**
 * The two ways per-climb detail could be silently corrupted by workout mode.
 *
 * `writeSet` REPLACES the row with what the review screen hands it, so a field
 * the step does not carry is deleted on commit — that is the first case. And
 * `rowValues` falls back to the set before this one, which is right for a load
 * and wrong for a climb: the board's three problems repeat every interval, so
 * inheriting would copy a fall the user did not take into an interval the user did not
 * fall on. A re-picked grade is friction; an invented fall is a false log.
 */
check('a set keeps its own climbs, and never inherits the set before it', () => {
  const logged = [{ grade: 4, fell: true, felt: -1, style: 'crimpy' }]
  const out = { sets: { intervals: [{ reps: 1, seconds: 100, climbs: logged }] } }
  const steps = buildSteps(opt('board'), out)
  eq(steps[0].values.climbs, logged, 'the logged climbs must reach the review screen')
  eq(steps[1].values.climbs, undefined, 'interval 2 must not inherit interval 1\'s falls')
  // ...while everything that IS a field still carries forward, unchanged.
  eq(steps[1].values.reps, 1, 'the rep count still follows the set before it')
  // And a commit round-trips the records rather than coercing them to NaN.
  const written = writeSet(out, 'intervals', 0, steps[0].values)
  eq(written.sets.intervals[0].climbs[0].fell, true)
  eq(written.sets.intervals[0].climbs[0].grade, 4)
})

check('the climb list follows the rep count, and presence is the toggle state', () => {
  eq(fitClimbs([], 3).length, 3)
  // Growing pads with blanks; a blank climb answers nothing — felt blank is
  // "did not say", never "spot on".
  const b = blankClimb()
  eq(b.grade, ''); eq(b.fell, false); eq(b.felt, ''); eq(b.style, '')
  // Shrinking drops the extras, same reason dropping a lap drops its grade.
  eq(fitClimbs([{ grade: 4 }, { grade: 5 }, { grade: 3 }], 2).length, 2)
  // What was said is kept, and missing keys are filled in.
  const kept = fitClimbs([{ grade: 4, fell: true }], 2)
  eq(kept[0].grade, 4); eq(kept[0].fell, true); eq(kept[0].felt, '')
  eq(kept[1].grade, '')
  eq(fitClimbs('nonsense', 1).length, 1)
  // Presence of the list is the state, so the toggle reads the rows.
  ok(climbsOn([{ reps: 3, climbs: fitClimbs([], 3) }]))
  ok(!climbsOn([{ reps: 3 }]))
  ok(!climbsOn([]))
  ok(!climbsOn())
})

check('the climbs of a session read out in order, and the summaries are honest', () => {
  const rows = [
    { reps: 2, climbs: [{ grade: 4, fell: true, felt: 1, style: 'roof' }, { grade: 5, fell: false, felt: '', style: '' }] },
    { reps: 1, climbs: [{ grade: '', fell: true, felt: '', style: 'slab' }] },
  ]
  eq(climbsIn(rows).length, 3)
  eq(hardestClimbed(rows), 5)
  eq(fallsIn(rows), 2)
  // A gradeless climb is not a V0, and rows from before the option contribute nothing.
  eq(hardestClimbed([{ reps: 3 }]), null)
  eq(hardestClimbed([]), null)
  eq(fallsIn([{ reps: 3 }]), 0)
})

check('stepping the count never deletes a climb already logged', () => {
  // The first release kept the typed reps in charge, and typing "12" over a 10
  // passes through "1" — each keystroke refit the list, so correcting the count
  // mid-session deleted the climbs already filled in. It surfaced the same
  // day. While the detail is on the count is stepped, never typed.
  const row = { reps: 2, climbs: [
    { grade: 4, fell: true, felt: 1, style: 'roof' },
    { grade: 5, fell: false, felt: 0, style: 'slab' },
  ] }
  const grown = stepClimbs(row, 1)
  eq(grown.reps, 3)
  eq(grown.climbs.length, 3)
  eq(grown.climbs[0].grade, 4, 'growing must keep what was said')
  eq(grown.climbs[0].style, 'roof')
  eq(grown.climbs[1].grade, 5)
  eq(grown.climbs[2].grade, '', 'the new climb starts blank')
  // One step back drops exactly the last row — one at a time, visibly.
  const back = stepClimbs(grown, -1)
  eq(back.reps, 2)
  eq(back.climbs[0].grade, 4)
  eq(back.climbs[1].grade, 5)
  // The floor is one row and the cap matches the picker cap.
  eq(stepClimbs({ reps: 1, climbs: [{ grade: 4 }] }, -1).reps, 1)
  eq(stepClimbs({ reps: 20 }, 1).reps, 20)
  // A blank count reads as the one row already on screen, so + makes two.
  eq(stepClimbs({ reps: '' }, 1).reps, 2)
})

check('felt speaks in words, and an unanswered felt is not "spot on"', () => {
  eq(feltLabel(FELT_MIN), 'soft for the grade')
  eq(feltLabel(0), 'spot on')
  eq(feltLabel(FELT_MAX), 'sandbagged')
  eq(feltLabel(''), '', 'blank must never read as an answer')
  eq(feltLabel(null), '')
  eq(feltLabel(99), '99', 'an out-of-scale value shows itself rather than lying')
})

check('a climb record survives being written back as a set', () => {
  // writeSet coerces list entries with Number(), and Number({grade: 4}) is NaN —
  // a record passes through whole.
  const out = writeSet({}, 'problems', 0, { reps: 2, [CLIMB_FIELD]: [{ grade: 4, fell: true, felt: -1, style: 'slab' }, blankClimb()] })
  const row = out.sets.problems[0]
  eq(row.reps, 2)
  eq(row.climbs[0].grade, 4)
  eq(row.climbs[0].fell, true)
  eq(row.climbs[0].felt, -1)
  eq(row.climbs[0].style, 'slab')
  eq(row.climbs[1].grade, '')
})

check('workout mode steps through the doubles carrying the grade field', () => {
  const steps = stepsOf('lead-laps')
  eq(steps.length, 3, 'three doubles')
  ok(steps[0].fields.includes(GRADE_FIELD), 'the review screen has no grade to edit')
  // No timer on this session: the laps are climbed on a wall, so every phase
  // counts up and nothing counts down to an invented number.
  eq(steps[0].timing.work, null)
  eq(steps[0].timing.reps, 1, 'a lap is not something a clock can end')
})

console.log(failed ? `\n${failed} test(s) failed` : '\nall workout tests pass')
process.exit(failed ? 1 : 0)
