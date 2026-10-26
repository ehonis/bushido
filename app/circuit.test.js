/*
 * Circuits (issue #68), as arithmetic: a circuit compiles into the interval
 * timer's own program, survives a pocket like any timer, and ends, finished or
 * stopped, as one logged workout. Every clock is an argument.
 *
 * Run: npm run test:circuit
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  compile, normalizeConfig, circuitConfig, circuitOf, normalizeCircuit, describe, totalSeconds,
  startRun, settle, pause, resume, skip, back, stopRun, circuitDone, view, loadRun, saveRun,
  DEFAULT_CONFIG, BUILT_INS, CIRCUIT_DEFAULT, sameConfig, buildTimerEntry, savedTimers, DONE_AFTER,
} from './src/lib/timer.js'
import {
  normalizePrescription, blockTimer, circuitOnly, circuitTiming, endCircuit, runOutputs, setCircuit,
  setTiming, circuitPlan, loggedCircuit, isLiftOnly, prescriptionLine, emptyRun, finishRun, runProgress,
  prescriptionSteps, remapRun, appendLift, moveItem, removeItem, splitPrescription,
  circuitToOpen, nextCircuit, circuitFiling, dropEmptyBlocks,
} from './src/lib/prescription.js'
import { localIso } from './src/lib/dates.js'
import { liftMeasure, liftSummary } from './src/lib/lifts.js'
import {
  shareCircuit, togetherWrite, togetherSides, togetherWords, togetherSaid, applyRun, notePending, pendingFor, retryPending,
  sideTaken, PENDING_KEY, STALE_CLOCK_MS,
} from './src/lib/trainer.js'
import { fillOut } from './src/lib/prescription.js'
import { isDone } from './src/lib/store.js'

const plan = JSON.parse(readFileSync(new URL('../test/fixtures/plan.json', import.meta.url), 'utf8'))
const liftField = (() => {
  for (const opt of plan.dailyMenu) for (const f of opt.outputs || []) if (f.type === 'lifts') return f
  return null
})()

let pass = 0
const t = (name, fn) => {
  try { fn(); pass++ } catch (e) { console.error(`FAIL ${name}\n  ${e.message}`); process.exitCode = 1 }
}

const T0 = Date.parse('2026-10-26T09:00:00Z')
const SQUAT_KEY = liftField.exercises.find(e => /goblet/i.test(e.key))?.key || liftField.exercises[0].key
const sec = (n) => T0 + n * 1000
const shape = (p) => p.segments.map(s => `${s.kind}:${s.seconds}${s.ex != null ? `#${s.ex}` : ''}`)

/** An ab circuit: crunch on the circuit's time, a longer plank, leg raises to a count. */
const AB = circuitConfig({ work: 40, rest: 20, rounds: 3, roundRest: 60, countIn: 10 }, [
  { key: 'crunch', name: 'Crunch' },
  { key: 'plank', name: 'Plank', seconds: 60 },
  { key: 'hanging-leg-raise', name: 'Hanging leg raise', reps: 12 },
])

/* ------------------------------------------------------------ compiling */

t('a circuit compiles into the timer\'s own segments: overrides, a reps count-up, the round rest, no last rest', () => {
  const p = compile(AB)
  const round = ['work:40#0', 'rest:20', 'work:60#1', 'rest:20', 'work:null#2']
  assert.deepEqual(shape(p), [
    'countin:10',
    ...round, 'rest:60',
    ...round, 'rest:60',
    ...round,
  ])
  assert.equal(p.segments[1].name, 'Crunch')
  assert.equal(p.segments[1].key, 'crunch', 'the exercise key rides on its segment')
  assert.equal(p.segments[5].reps, 12)
  assert.equal(p.segments[5].note, '12 reps')
  assert.equal(p.segments[6].name, 'Rest between rounds')
  assert.deepEqual([p.segments[1].round, p.segments[1].rounds, p.segments[1].exs], [1, 3, 3])
  assert.equal(totalSeconds(p), null, 'a reps exercise has no known length')
})

t('with no rest between rounds, the ordinary rest separates them; a rest of 0 is back to back', () => {
  const p = compile(circuitConfig({ work: 30, rest: 10, rounds: 2, countIn: 0 }, [{ name: 'A' }, { name: 'B' }]))
  assert.deepEqual(shape(p), ['work:30#0', 'rest:10', 'work:30#1', 'rest:10', 'work:30#0', 'rest:10', 'work:30#1'])
  const q = compile(circuitConfig({ work: 30, rest: 0, rounds: 2, countIn: 0 }, [{ name: 'A' }, { name: 'B' }]))
  assert.deepEqual(shape(q), ['work:30#0', 'work:30#1', 'work:30#0', 'work:30#1'])
  assert.equal(totalSeconds(q), 120)
})

t('a plain timer, and every built-in, normalizes exactly as before circuits', () => {
  for (const b of BUILT_INS) {
    const c = normalizeConfig(b.config)
    assert.deepEqual(Object.keys(c), Object.keys(DEFAULT_CONFIG), `${b.name} grew keys`)
    assert.equal(c.exercises, undefined)
    assert.equal(c.roundRest, undefined)
    assert.equal(compile(c).segments.some(s => 'ex' in s), false, `${b.name}'s segments changed shape`)
  }
  // A preset saved before circuits reads back byte for byte through the log.
  const old = { countIn: 5, work: 20, rest: 10, rounds: 8, sets: 1, setRest: 60, coolDown: 0, intervals: [], repeat: false }
  const entry = buildTimerEntry('timer-x', 'Old', old)
  assert.deepEqual(entry.data.config, old)
  assert.deepEqual(savedTimers([entry])[0].config, old)
  assert.ok(sameConfig(old, normalizeConfig(old)))
})

t('stored exercises are clamped, never trusted', () => {
  const c = normalizeConfig({ exercises: [null, { name: '' }, { name: '  Plank ', key: 'bad key!', seconds: 99999, reps: 0 },
    { name: 'Crunch', reps: 5000, seconds: 30 }, 'x'] })
  assert.deepEqual(c.exercises, [{ name: 'Plank', seconds: 3600 }, { name: 'Crunch', reps: 999 }])
  assert.equal(c.roundRest, 0, 'a rest between rounds nobody gave is none')
  assert.equal(normalizeCircuit(null), null)
  assert.deepEqual(normalizeCircuit({ work: 1, rest: -5, rounds: 500 }), { work: 5, rest: 0, rounds: 99, roundRest: 0, countIn: 10 })
  assert.deepEqual(circuitOf(AB), { work: 40, rest: 20, rounds: 3, roundRest: 60, countIn: 10 })
  assert.equal(describe(AB), '3 rounds · 3 exercises · 40s each · 20s rest')
})

/* ----------------------------------------------------------- running it */

t('settle across backgrounding: a pocket lands on the right exercise and second, and books what ran out', () => {
  const p = compile(AB)
  // 10 count-in + 40 crunch + 20 rest + 25 into the plank = 95 s after start.
  const r = settle(p, startRun(p, T0), sec(95))
  const v = view(p, r, sec(95))
  assert.equal(v.segment.name, 'Plank')
  assert.equal(Math.round(v.left), 35)
  assert.deepEqual(r.spent, { '1:1': 40 }, 'only the exercise that ran out is booked')
  // A count-up waits: an hour in a pocket on the leg raises is still the leg raises.
  const atRaise = settle(p, r, sec(10 + 40 + 20 + 60 + 20 + 1))
  assert.equal(view(p, atRaise, sec(5000)).segment.name, 'Hanging leg raise')
  assert.equal(settle(p, atRaise, sec(5000)).index, atRaise.index)
})

t('pausing and skipping book only the time worked; going back redoes an exercise', () => {
  const p = compile(AB)
  let r = settle(p, startRun(p, T0), sec(20)) // 10 s into the crunch
  r = pause(p, r, sec(20))
  r = resume(p, r, sec(320)) // five minutes paused
  r = skip(p, r, sec(325)) // 15 s of crunch in all
  assert.equal(r.spent['1:1'], 15)
  r = back(p, r, sec(326)) // inside the grace: back to the crunch
  assert.equal(p.segments[r.index].name, 'Crunch')
  r = settle(p, r, sec(366))
  assert.equal(r.spent['1:1'], 40, 'the crunch done again is booked again, not twice')
})

t('logging from the finish: every exercise, every round, a reps exercise counted', () => {
  const p = compile(AB)
  let r = startRun(p, T0)
  let now = 0
  // Run it to the end, tapping each leg-raise count-up after 30 s.
  for (let guard = 0; guard < 1000 && r.finishedAt == null; guard++) {
    r = settle(p, r, sec(now))
    if (r.finishedAt != null) break
    const seg = p.segments[r.index]
    if (seg.seconds == null) { now += 30; r = skip(p, r, sec(now)) } else now += 1
  }
  assert.ok(r.finishedAt != null)
  const done = circuitDone(p, r)
  assert.deepEqual(done, [[40, 40, 40], [60, 60, 60], [30, 30, 30]])
})

t('logging from an early stop: what was done of the exercise on screen counts, and nothing past it', () => {
  const p = compile(AB)
  // Round 1 done, then 25 s into round 2's crunch: 10 + 40+20+60+20 + 30 (raise) + 60 (round rest) + 25.
  let r = settle(p, startRun(p, T0), sec(10 + 40 + 20 + 60 + 20))
  r = skip(p, r, sec(10 + 40 + 20 + 60 + 20 + 30)) // the leg raises, tapped after 30 s
  r = stopRun(p, r, sec(10 + 40 + 20 + 60 + 20 + 30 + 60 + 25))
  assert.ok(r.finishedAt != null && r.stopped)
  assert.deepEqual(circuitDone(p, r), [[40, 25], [60], [30]])
  // Stopped in the count-in: nothing to log.
  const early = stopRun(p, startRun(p, T0), sec(4))
  assert.deepEqual(circuitDone(p, early), [[], [], []])
  // A stopped run is finished: elapsed stops there, and it is not resumed from storage.
  assert.equal(view(p, r, sec(99999)).finished, true)
})

t('a running circuit survives a reload, with what it has booked so far', () => {
  const store = new Map()
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) }
  const p = compile(AB)
  const r = settle(p, startRun(p, T0), sec(75))
  saveRun(storage, 'k', { name: 'Abs', config: AB, run: r })
  const got = loadRun(storage, 'k', sec(80))
  assert.deepEqual(got.config, AB)
  assert.deepEqual(got.run.spent, r.spent)
  const p2 = compile(got.config)
  assert.equal(view(p2, settle(p2, got.run, sec(80)), sec(80)).segment.name, 'Plank')
})

/* --------------------------------------------------------- on a plan */

const abPlan = () => normalizePrescription({
  title: 'Abs', blocks: [{
    name: 'Core', category: 'strength', circuit: { work: 40, rest: 20, rounds: 3, roundRest: 60, countIn: 10 },
    items: [
      { kind: 'lift', name: 'Crunch', exercise: 'crunch', sets: [] },
      { kind: 'lift', name: 'Plank', exercise: 'plank', sets: [{ seconds: 60 }, { seconds: 60 }, { seconds: 60 }] },
      { kind: 'lift', name: 'Hanging leg raise', exercise: 'hanging-leg-raise', sets: [{ reps: 12 }] },
    ],
  }],
}, { liftField })

t('a circuit block keeps its timing and ONE set per exercise; a blank is the circuit\'s time', () => {
  const pres = abPlan()
  const b = pres.blocks[0]
  assert.deepEqual(b.circuit, { work: 40, rest: 20, rounds: 3, roundRest: 60, countIn: 10 })
  assert.deepEqual(b.items.map(i => i.sets.length), [1, 1, 1], 'an item with no sets was dropped, or rounds were kept as sets')
  assert.deepEqual(b.items.map(i => circuitTiming(i).by), ['circuit', 'time', 'reps'])
  assert.deepEqual(blockTimer(b), AB, 'a plan\'s circuit and the same preset are not the same program')
  // A block without one is exactly as before: no key.
  const plain = normalizePrescription({ blocks: [{ name: 'Main', items: [{ kind: 'lift', name: 'Crunch', exercise: 'crunch', sets: [{ reps: 10 }] }] }] }, { liftField })
  assert.equal('circuit' in plain.blocks[0], false)
  assert.equal(normalizePrescription({ blocks: [{ name: 'Main', items: [{ kind: 'lift', name: 'Crunch', exercise: 'crunch', sets: [] }] }] }, { liftField }), null,
    'outside a circuit an item with no sets is still nothing')
})

t('a lift-only block switched to Circuit is runnable, and a circuit-only plan goes straight to the timer', () => {
  const lifts = normalizePrescription({ blocks: [{ name: 'Core', items: [
    { kind: 'lift', name: 'Crunch', exercise: 'crunch', sets: [{ reps: 15 }, { reps: 15 }, { reps: 15 }] },
    { kind: 'lift', name: 'Plank', exercise: 'plank', sets: [{ seconds: 45 }] },
  ] }] }, { liftField })
  assert.equal(isLiftOnly(lifts), true)
  const on = setCircuit(lifts, 'b0', true)
  assert.equal(isLiftOnly(on), false)
  assert.equal(circuitOnly(on), true)
  assert.equal(on.blocks[0].circuit.rounds, 3, '3 × 15 crunches is three rounds of fifteen')
  assert.deepEqual(on.blocks[0].items.map(i => circuitTiming(i)), [{ by: 'reps', reps: 15, seconds: null }, { by: 'time', seconds: 45, reps: null }])
  const off = setCircuit(on, 'b0', false)
  assert.equal('circuit' in off.blocks[0], false)
  assert.equal(isLiftOnly(off), true)
  // A blank-set exercise added to a circuit runs on the circuit's time.
  const added = appendLift(on, liftField, 'dead-bug', { blockId: 'b0' })
  assert.equal(circuitTiming(added.blocks[0].items[2]).by, 'circuit')
  const timed = setTiming(added, 'b0i2', { seconds: 50 })
  assert.equal(circuitTiming(timed.blocks[0].items[2]).seconds, 50)
  assert.equal(circuitTiming(setTiming(timed, 'b0i2', {}).blocks[0].items[2]).by, 'circuit')
  assert.equal(moveItem(timed, 'b0i2', 'up').pres.blocks[0].items[1].name, 'Dead bug')
  assert.equal(removeItem(timed, 'b0i0').blocks[0].circuit.rounds, 3, 'an edit dropped the circuit')
  assert.equal(prescriptionLine(abPlan()), '3 exercises · 3 rounds')
})

t('finishing a plan\'s circuit marks each exercise\'s rounds and logs ordinary lift rows', () => {
  const pres = abPlan()
  const p = compile(blockTimer(pres.blocks[0]))
  const done = [[40, 40, 40], [60, 60, 55], [30, 28]]
  const run = finishRun(endCircuit({ ...emptyRun(T0), circuit: { block: 'b0', timer: startRun(p, T0) } }, pres, 'b0', done,
    { at: sec(600), seconds: 590 }), { at: sec(600) })
  assert.equal(run.circuit, null, 'the timer\'s position outlived the circuit')
  assert.equal(runProgress(run, prescriptionSteps(pres)).left, 0)
  const out = runOutputs(pres, run, { rpe: 7 })
  assert.equal(out.rpe, 7, 'the rest of the log was touched')
  assert.deepEqual(out.lifts.map(l => [l.key, l.sets]), [
    ['crunch', [{ seconds: 40, weight: '' }, { seconds: 40, weight: '' }, { seconds: 40, weight: '' }]],
    ['plank', [{ seconds: 60, weight: '' }, { seconds: 60, weight: '' }, { seconds: 55, weight: '' }]],
    ['hanging-leg-raise', [{ reps: '', weight: '' }, { reps: '', weight: '' }]],
  ])
  // The log reads them as the lift log always has: holds in seconds, reps blank to fill in.
  assert.equal(liftMeasure(out.lifts[0]), 'time')
  assert.equal(liftMeasure(out.lifts[2]), 'reps')
  assert.ok(liftSummary(out.lifts[1]).includes('s'), liftSummary(out.lifts[1]))
  assert.equal(out.elapsedMin, 10, 'a circuit-only workout is timed by its circuit')
  assert.deepEqual(run.circuitTimes, { b0: 590 })
  // Its result follows its exercise across an edit, like any logged set.
  const moved = moveItem(pres, 'b0i2', 'up').pres
  const again = remapRun(run, pres, moved)
  assert.deepEqual(again.sets.b0i1s0.rounds, [30, 28])
})

t('an exercise the circuit never reached is skipped; a circuit skipped whole logs nothing', () => {
  const pres = abPlan()
  const run = endCircuit(null, pres, 'b0', [[40], [], []], { at: T0 })
  assert.deepEqual(run.skipped, ['b0i1s0', 'b0i2s0'])
  assert.deepEqual(runOutputs(pres, run, {}).lifts.map(l => l.name), ['Crunch'])
  const none = endCircuit(null, pres, 'b0', [], { at: T0 })
  assert.equal(runOutputs(pres, none, {}).lifts, undefined)
  assert.equal(runProgress(none, prescriptionSteps(pres)).left, 0)
})

/* ------------------------------------------------- from the + timer */

t('a preset with exercises becomes the same planned workout, placed or logged', () => {
  const pres = circuitPlan('Abs', AB, liftField)
  const b = pres.blocks[0]
  assert.deepEqual(b.circuit, circuitOf(AB))
  assert.equal('keep' in b, false)
  assert.deepEqual(b.items.map(i => [i.kind, i.exercise, circuitTiming(i).by]),
    [['lift', 'crunch', 'circuit'], ['lift', 'plank', 'time'], ['lift', 'hanging-leg-raise', 'reps']])
  assert.deepEqual(blockTimer(b), AB, 'placing a preset changes what it runs')
  // One the library does not have is a named piece, timed the same.
  const odd = circuitPlan('Odd', circuitConfig({}, [{ name: 'Burpee shuffle', seconds: 30 }]), liftField)
  assert.deepEqual(odd.blocks[0].items.map(i => [i.kind, i.name, circuitTiming(i).seconds]), [['interval', 'Burpee shuffle', 30]])
  assert.equal(splitPrescription(pres).length, 1)
})

t('a + timer run logs one finished workout from its run; stopped in the count-in, nothing', () => {
  const p = compile(AB)
  let r = settle(p, startRun(p, T0), sec(10 + 40 + 20 + 30))
  r = stopRun(p, r, sec(10 + 40 + 20 + 30))
  const got = loggedCircuit('Abs', AB, r, liftField)
  assert.ok(got.run.endedAt, 'the run was not finished')
  assert.equal(got.run.startedAt, T0)
  assert.deepEqual(got.out.lifts.map(l => [l.name, l.sets.length]), [['Crunch', 1], ['Plank', 1]])
  assert.equal(got.out.lifts[1].sets[0].seconds, 30)
  assert.equal(loggedCircuit('Abs', AB, stopRun(p, startRun(p, T0), sec(3)), liftField), null)
  assert.equal(loggedCircuit('Abs', AB, startRun(p, T0), liftField), null, 'a run still going logs nothing')
})

/* --------------------------------------------- review of #70 */

t('a shared circuit\'s other side waits for its own Start: owner starts, Sam has no timer and nothing booked', () => {
  const pres = abPlan()
  assert.equal(circuitToOpen(pres, null, { shown: true }), 'b0', 'the side on screen runs it straight away')
  assert.equal(circuitToOpen(pres, null, { shown: false }), null, 'a hidden side started its own clock')
  // Sam's side, mounted hidden while the owner runs: no circuit opens, so no timer is ever written to Sam's entry.
  const samRun = null
  assert.equal(circuitToOpen(pres, samRun, { shown: false }), null)
  // Once Sam starts it on Sam's own screen, it is Sam's and comes back running, shown or not.
  const live = { ...emptyRun(T0), circuit: { block: 'b0', timer: startRun(compile(blockTimer(pres.blocks[0])), T0) } }
  assert.equal(circuitToOpen(pres, live, { shown: false }), 'b0')
  assert.equal(circuitToOpen(pres, finishRun(emptyRun(T0)), { shown: true }), null, 'a finished plan reopened its circuit')
})

t('a + timer circuit is logged on the day it was started, across midnight', () => {
  // Started at 21:00, the app killed in the last round, reopened and stopped at nine the next morning.
  const p = compile(AB)
  const start = new Date(2026, 9, 26, 21, 0, 0).getTime()
  const r = stopRun(p, settle(p, startRun(p, start), start + 300 * 1000), start + 12 * 3600 * 1000)
  assert.notEqual(localIso(new Date(r.finishedAt)), localIso(new Date(start)), 'the run did not cross midnight, so this proves nothing')
  const got = loggedCircuit('Abs', AB, r, liftField)
  assert.equal(got.date, '2026-10-26')
})

t('a circuit preset placed as a plan runs exactly what the preset ran: sets, cool-down and repeat are not a circuit\'s', () => {
  const asked = { ...AB, sets: 3, setRest: 90, coolDown: 120, repeat: true }
  const config = normalizeConfig(asked)
  assert.deepEqual([config.sets, config.coolDown, config.repeat], [1, 0, false])
  const placed = compile(blockTimer(circuitPlan('Abs', config, liftField).blocks[0]))
  const ran = compile(config)
  assert.deepEqual(shape(placed), shape(ran))
  const timed = circuitConfig({ work: 40, rest: 20, rounds: 4, roundRest: 45, countIn: 5 }, [{ name: 'A' }, { name: 'B', seconds: 30 }])
  assert.equal(totalSeconds(compile(blockTimer(circuitPlan('T', timed, null).blocks[0]))), totalSeconds(compile(timed)))
  assert.equal(totalSeconds(compile(timed)), 5 + 4 * (40 + 20 + 30) + 3 * 45)
})

t('Back, then Skip, does not unlog an exercise already done', () => {
  const p = compile(circuitConfig({ work: 40, rest: 20, rounds: 1, countIn: 0 }, [{ name: 'A' }, { name: 'B' }]))
  let r = settle(p, startRun(p, T0), sec(41)) // A ran out: 40 s, now in the rest
  assert.equal(r.spent['1:0'], 40)
  r = back(p, r, sec(42)) // into the rest's first seconds: back to A
  assert.equal(p.segments[r.index].name, 'A')
  r = skip(p, r, sec(44)) // two seconds of A, skipped
  assert.equal(r.spent['1:0'], 40, 'the 40 s already done was overwritten')
  assert.deepEqual(circuitDone(p, stopRun(p, r, sec(45)))[0], [40])
})

t(`a skip under ${DONE_AFTER} s is not done, at ${DONE_AFTER} s it is`, () => {
  const p = compile(circuitConfig({ work: 40, rest: 0, rounds: 1, countIn: 0 }, [{ name: 'A' }, { name: 'B' }, { name: 'C' }]))
  let r = skip(p, startRun(p, T0), sec(DONE_AFTER - 1))
  r = skip(p, r, sec(DONE_AFTER - 1 + DONE_AFTER))
  r = stopRun(p, r, sec(DONE_AFTER - 1 + DONE_AFTER + 1))
  assert.deepEqual(circuitDone(p, r), [[], [DONE_AFTER], []])
})

t('seconds with at most one rep is a timed exercise, library key or not', () => {
  const pres = normalizePrescription({ blocks: [{ name: 'C', circuit: { work: 30, rest: 10, rounds: 2 }, items: [
    { kind: 'lift', name: 'Crunch', exercise: 'crunch', sets: [{ reps: 1, seconds: 60 }] },
    { kind: 'interval', name: 'Bear crawl', sets: [{ reps: 1, seconds: 45 }] },
    { kind: 'interval', name: 'Jacks', sets: [{ reps: 20, seconds: 3 }] },
  ] }] }, { liftField })
  assert.deepEqual(pres.blocks[0].items.map(i => circuitTiming(i)), [
    { by: 'time', seconds: 60, reps: null }, { by: 'time', seconds: 45, reps: null }, { by: 'reps', reps: 20, seconds: null }])
  assert.deepEqual(blockTimer(pres.blocks[0]).exercises.map(x => x.seconds ?? `${x.reps} reps`), [60, 45, '20 reps'])
})

t('Circuit off and on again is the circuit it was; keeping the plan drops what waited', () => {
  const pres = abPlan()
  const tuned = { ...pres, blocks: [{ ...pres.blocks[0], circuit: { ...pres.blocks[0].circuit, rounds: 5, work: 50 } }] }
  const off = setCircuit(tuned, 'b0', false)
  assert.equal('circuit' in off.blocks[0], false)
  const on = setCircuit(off, 'b0', true)
  assert.deepEqual([on.blocks[0].circuit.rounds, on.blocks[0].circuit.work], [5, 50], 'switching back on reset the circuit')
  assert.equal('wasCircuit' in on.blocks[0], false)
  assert.equal('wasCircuit' in dropEmptyBlocks(off).blocks[0], false, 'a switched-off circuit leaked into the kept plan')
})

t('a plan of two circuits runs the second straight after the first', () => {
  const two = normalizePrescription({ title: 'Two', blocks: [
    { name: 'Abs', circuit: { work: 30, rest: 10, rounds: 1 }, items: [{ kind: 'interval', name: 'A', sets: [] }] },
    { name: 'Legs', circuit: { work: 30, rest: 10, rounds: 1 }, items: [{ kind: 'interval', name: 'B', sets: [] }] },
  ] })
  assert.equal(circuitToOpen(two, null), 'b0')
  const after = endCircuit(emptyRun(T0), two, 'b0', [[30]], { at: T0 })
  assert.equal(nextCircuit(two, after)?.id, 'b1')
  assert.equal(runProgress(after, prescriptionSteps(two)).left, 1, 'the plan is not finished after the first')
  assert.equal(nextCircuit(two, endCircuit(after, two, 'b1', [[30]], { at: T0 })), null)
})

t('a + timer circuit is filed by its exercises: a category named for their group, else the content\'s lifting workout', () => {
  const activities = plan.dailyMenu.flatMap(o => o.outputs || []).find(f => f.type === 'activity').activities
  assert.deepEqual(circuitFiling(AB, liftField, { categories: plan.quotaCategories, activities }), { category: 'lift', activity: 'lift' })
  const withCore = [...plan.quotaCategories, { key: 'core', name: 'Core' }]
  assert.deepEqual(circuitFiling(AB, liftField, { categories: withCore, activities }), { category: 'core', activity: null })
  const placed = splitPrescription(circuitPlan('Abs', AB, liftField, circuitFiling(AB, liftField, { categories: plan.quotaCategories, activities })))
  assert.deepEqual([placed[0].category, placed[0].activity], ['lift', 'lift'])
  assert.deepEqual(circuitFiling(AB, null, {}), { category: null, activity: null })
})

t('a planned weight in a circuit is the logged rows\' weight; seconds and blank reps as before', () => {
  const pres = normalizePrescription({ blocks: [{ name: 'C', circuit: { work: 30, rest: 10, rounds: 2 }, items: [
    { kind: 'lift', name: 'Goblet squat', exercise: SQUAT_KEY, sets: [{ reps: 15, weight: 10 }] },
    { kind: 'lift', name: 'Plank', exercise: 'plank', sets: [{ seconds: 45, weight: 25 }] },
  ] }] }, { liftField })
  const out = runOutputs(pres, endCircuit(null, pres, 'b0', [[30, 31], [45]], { at: T0 }), {})
  assert.deepEqual(out.lifts.map(l => l.sets), [
    [{ reps: '', weight: 10 }, { reps: '', weight: 10 }],
    [{ seconds: 45, weight: 25 }],
  ])
})

/* --------------------------------------------- done together (the owner's ask) */

const later = []
const ta = (name, fn) => later.push(fn().then(() => { pass++ }, e => { console.error(`FAIL ${name}\n  ${e.message}`); process.exitCode = 1 }))

const PLANNED = plan.dailyMenu.find(m => m.id === 'planned')
/** One shared ab circuit, as each side holds it: the same uids, each person's own weights. */
const sharedAbs = (weight) => normalizePrescription({ title: 'Abs', blocks: [{ uid: 'B1', name: 'Abs', circuit: { work: 40, rest: 20, rounds: 2, countIn: 0 }, items: [
  { uid: 'CR', kind: 'lift', name: 'Crunch', exercise: 'crunch', sets: [{ reps: 15, weight }] },
  { uid: 'PL', kind: 'lift', name: 'Plank', exercise: 'plank', sets: [{ seconds: 30 }] },
] }] }, { liftField })
const TODAY = '2026-10-26'
const ownerOf = () => ({ id: `daily-${TODAY}`, kind: 'daily', date: TODAY,
  data: { optId: 'planned', done: false, plan: sharedAbs(10), out: {}, sharedWith: [{ id: 'sam', entryId: `daily-${TODAY}`, sync: true }] } })
const samOf = () => ({ id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: '2026-10-26T08:00:00.000Z',
  data: { optId: 'planned', done: false, plan: sharedAbs(5), out: {}, sharedFrom: { id: 'owner', name: 'Alex' } } })
const SIDES = [{ id: null, name: 'You', entryId: `daily-${TODAY}` }, { id: 'sam', name: 'Sam', entryId: `daily-${TODAY}` }]
const PROG = compile(blockTimer(ownerOf().data.plan.blocks[0]))

/** The result of the owner's clock, and the owner's own write of it (the runner's). */
function hosted(timer) {
  const done = circuitDone(PROG, timer)
  const at = timer.finishedAt
  const result = { block: { uid: 'B1', id: 'b0', name: 'Abs' }, items: [{ uid: 'CR', name: 'Crunch' }, { uid: 'PL', name: 'Plank' }],
    done, at, seconds: view(PROG, timer, at).elapsed, key: timer.startedAt }
  const owner0 = ownerOf()
  const pres = owner0.data.plan
  const ran = finishRun(endCircuit(owner0.data.run, pres, 'b0', done, { at, seconds: result.seconds, key: result.key }), { at })
  return { result, owner: applyRun(owner0, PLANNED, ran, { out: runOutputs(pres, ran, {}), done: true }) }
}
/** Run the owner's clock to its end, the crunches (done to a count) tapped after 25 s. */
function throughTo(end = Infinity) {
  let r = startRun(PROG, T0)
  let now = 0
  for (let guard = 0; guard < 1000 && r.finishedAt == null && now < end; guard++) {
    r = settle(PROG, r, sec(now))
    if (r.finishedAt != null) break
    if (PROG.segments[r.index].seconds == null) { now += 25; r = skip(PROG, r, sec(now)) } else now += 1
  }
  return r.finishedAt != null ? r : stopRun(PROG, r, sec(now))
}
const finished = () => hosted(throughTo())

/**
 * Sam's copy on a fake server, with the people endpoints' behaviour: a read and
 * a write that can fail (offline), and a write that lands while its reply is lost.
 */
function server(sam = samOf()) {
  const s = { entry: sam, puts: 0, reads: 0, offline: false, loseReply: false }
  s.readPerson = async () => { s.reads++; if (s.offline) throw new Error('offline'); return JSON.parse(JSON.stringify(s.entry)) }
  s.putPerson = async (id, e) => {
    if (s.offline) throw new Error('offline')
    s.puts++
    s.entry = { ...e, updatedAt: new Date(Date.parse(s.entry.updatedAt || 0) + 1000).toISOString() }
    if (s.loseReply) { s.loseReply = false; throw new Error('the reply was lost') }
    return s.entry
  }
  return s
}
const share = (srv, result, owner, { writeOwner = () => {} } = {}) => shareCircuit({
  sides: SIDES, hostId: null, result, ownerEntry: owner, session: PLANNED, writeOwner, readPerson: srv.readPerson, putPerson: srv.putPerson,
})
const rowsOf = (e) => (e.data.out.lifts || []).map(l => [l.key, l.sets.map(x => [x.seconds ?? null, x.reps ?? null, x.weight ?? null])])

ta('together, finished: both done and ended, the same seconds, one write each, each side\'s own weights', async () => {
  const { result, owner } = finished()
  const srv = server()
  assert.deepEqual(await share(srv, result, owner), [{ id: 'sam', name: 'Sam', status: 'logged' }])
  assert.equal(srv.puts, 1)
  const sam = srv.entry
  assert.deepEqual(rowsOf(sam).map(r => [r[0], r[1].map(x => x[0])]), rowsOf(owner).map(r => [r[0], r[1].map(x => x[0])]))
  assert.deepEqual(rowsOf(sam), [['crunch', [[null, '', 5], [null, '', 5]]], ['plank', [[30, null, ''], [30, null, '']]]])
  assert.deepEqual(rowsOf(owner), [['crunch', [[null, '', 10], [null, '', 10]]], ['plank', [[30, null, ''], [30, null, '']]]])
  for (const e of [owner, sam]) assert.ok(e.data.run.endedAt && e.data.done === true && isDone(e, TODAY))
  assert.equal(sam.data.sharedFrom.name, 'Alex')
  assert.deepEqual(togetherSaid('you', [{ id: 'sam', name: 'Sam', status: 'logged' }]).head, 'Logged for you and Sam')
})

ta('together, stopped early: what was done lands on both, the same, one write', async () => {
  // The crunches tapped at 25 s, 20 s rest, then stopped 12 s into the plank.
  const { result, owner } = hosted(throughTo(25 + 20 + 12))
  const srv = server()
  await share(srv, result, owner)
  assert.equal(srv.puts, 1)
  assert.deepEqual(rowsOf(srv.entry), [['crunch', [[null, '', 5]]], ['plank', [[12, null, '']]]])
  assert.ok(srv.entry.data.run.endedAt && srv.entry.data.done === true)
})

ta('offline, then Retry once the network is back: lands exactly once; a retry after that sends nothing', async () => {
  const { result, owner } = finished()
  const srv = server()
  srv.offline = true
  const first = await share(srv, result, owner)
  assert.deepEqual(first, [{ id: 'sam', name: 'Sam', status: 'missed' }])
  assert.equal(srv.entry.data.run, undefined, 'a failed write changed Sam\'s log')
  const words = togetherSaid('you', first)
  assert.equal(words.head, 'Logged for you', 'it says "and Sam" over a miss')
  assert.deepEqual(words.missed, ['Sam'])
  srv.offline = false
  assert.deepEqual(await share(srv, result, owner), [{ id: 'sam', name: 'Sam', status: 'logged' }])
  assert.equal(srv.puts, 1)
  const once = JSON.stringify(srv.entry)
  assert.deepEqual(await share(srv, result, owner), [{ id: 'sam', name: 'Sam', status: 'logged' }])
  assert.equal(srv.puts, 1, 'a retry after it landed sent it again')
  assert.equal(JSON.stringify(srv.entry), once)
})

ta('a reply lost on the way back, then Retry: the re-read finds it there and sends nothing', async () => {
  const { result, owner } = finished()
  const srv = server()
  srv.loseReply = true
  assert.deepEqual(await share(srv, result, owner), [{ id: 'sam', name: 'Sam', status: 'missed' }])
  assert.equal(srv.puts, 1, 'the write did not land, so this proves nothing')
  assert.deepEqual(await share(srv, result, owner), [{ id: 'sam', name: 'Sam', status: 'logged' }])
  assert.equal(srv.puts, 1, 'the retry wrote it twice')
  assert.equal(srv.entry.data.run.circuitTimes.b0, result.seconds)
})

ta('Sam already finished on Sam\'s own phone: untouched, and said as "already logged", not a miss', async () => {
  const mine = hosted(stopRun(PROG, settle(PROG, startRun(PROG, T0 + 5000), T0 + 5000 + 30e3), T0 + 5000 + 30e3))
  const sam0 = samOf()
  const samRan = finishRun(endCircuit(null, sam0.data.plan, 'b0', mine.result.done, { at: T0 + 35000, seconds: 30, key: T0 + 5000 }), { at: T0 + 35000 })
  const sam = applyRun(sam0, PLANNED, samRan, { out: runOutputs(sam0.data.plan, samRan, {}), done: true })
  const { result, owner } = finished()
  const srv = server(sam)
  const before = JSON.stringify(srv.entry)
  const said = await share(srv, result, owner)
  assert.deepEqual(said, [{ id: 'sam', name: 'Sam', status: 'already' }])
  assert.equal(srv.puts, 0)
  assert.equal(JSON.stringify(srv.entry), before)
  const words = togetherSaid('you', said)
  assert.deepEqual([words.head, words.notes, words.missed], ['Logged for you', ['Sam already logged it'], []])
})

ta('Sam\'s own clock is running: untouched, and said as "running"', async () => {
  const sam0 = samOf()
  // Started a minute ago on Sam's phone (a live clock is judged against now).
  const started = Date.now() - 60e3
  const live = { ...emptyRun(started), circuit: { block: 'b0', timer: settle(PROG, startRun(PROG, started), Date.now()) } }
  const srv = server(applyRun(sam0, PLANNED, live, {}))
  const { result, owner } = finished()
  const before = JSON.stringify(srv.entry)
  const said = await share(srv, result, owner)
  assert.deepEqual(said, [{ id: 'sam', name: 'Sam', status: 'running' }])
  assert.equal(srv.puts, 0)
  assert.equal(JSON.stringify(srv.entry), before)
  assert.deepEqual(togetherSaid('you', said).notes, ['Sam is running it'])
})

ta('Sam typed reps into one exercise: those stay, and only the blanks fill', async () => {
  const sam0 = samOf()
  const typed = { ...sam0, data: { ...sam0.data, out: { lifts: [{ uid: 'b0i0', key: 'crunch', name: 'Crunch', implement: '', sets: [{ reps: 12, weight: '' }, { reps: 14, weight: 7 }] }] } } }
  const srv = server(typed)
  const { result, owner } = finished()
  await share(srv, result, owner)
  assert.equal(srv.puts, 1)
  const crunch = srv.entry.data.out.lifts.find(l => l.key === 'crunch')
  assert.deepEqual(crunch.sets, [{ reps: 12, weight: 5 }, { reps: 14, weight: 7 }], 'Sam\'s reps or weight were overwritten, or a blank stayed blank')
  assert.deepEqual(srv.entry.data.out.lifts.find(l => l.key === 'plank').sets.map(x => x.seconds), [30, 30], 'the blank exercise was not filled')
})

ta('a miss kept on the device is tried again when the workout opens, and then forgotten', async () => {
  const store = new Map()
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) }
  const { result, owner } = finished()
  const srv = server()
  srv.offline = true
  const said = await share(srv, result, owner)
  notePending(storage, { ownerEntryId: owner.id, result, said, people: SIDES })
  assert.equal(pendingFor(storage, owner).length, 1, 'the miss was not kept')
  // A reload: nothing but the device's storage is left. The network is back.
  srv.offline = false
  const left = await retryPending({ storage, ownerEntry: owner, readPerson: srv.readPerson, putPerson: srv.putPerson, session: PLANNED })
  assert.deepEqual(left, [])
  assert.equal(srv.puts, 1)
  assert.ok(srv.entry.data.run.endedAt)
  assert.deepEqual(await retryPending({ storage, ownerEntry: owner, readPerson: srv.readPerson, putPerson: srv.putPerson, session: PLANNED }), [])
  assert.equal(srv.puts, 1)
})

ta('two owner devices finishing the same run: one write to Sam', async () => {
  const { result, owner } = finished()
  const srv = server()
  await share(srv, result, owner)
  // The second device holds the same run (it is on the owner's synced entry) and ends it too.
  const again = await share(srv, result, owner)
  assert.deepEqual(again, [{ id: 'sam', name: 'Sam', status: 'logged' }])
  assert.equal(srv.puts, 1, 'the second device wrote Sam again')
  assert.equal(srv.reads, 2, 'the second device decided without reading Sam\'s log')
})

/* ------------------------------------------- review of #70, round 3 */

const memStorage = () => {
  const store = new Map()
  return { store, getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) }
}

ta('a kept miss is never retried onto a workout deleted and planned again under the same id', async () => {
  const storage = memStorage()
  const { result, owner } = finished()
  const srv = server()
  srv.offline = true
  notePending(storage, { ownerEntryId: owner.id, result, said: await share(srv, result, owner), people: SIDES })
  srv.offline = false
  // Deleted, then a new "Abs" circuit planned later the same day with Sam: the same derivable id, no run yet.
  const evening = { ...ownerOf(), data: { ...ownerOf().data, plan: { ...sharedAbs(10), title: 'Evening abs' } } }
  assert.equal(evening.id, owner.id, 'the new workout does not reuse the id, so this proves nothing')
  assert.deepEqual(pendingFor(storage, evening), [], 'the morning\'s miss is offered on the evening\'s workout')
  assert.equal(storage.store.has(PENDING_KEY), false, 'the stale miss was not dropped from the device')
  assert.deepEqual(await retryPending({ storage, ownerEntry: evening, readPerson: srv.readPerson, putPerson: srv.putPerson, session: PLANNED }), [])
  assert.equal(srv.puts, 0, 'the morning\'s numbers were written into Sam\'s evening workout')
  assert.equal(srv.entry.data.done, false)
})

ta('a kept miss for someone taken off the workout is dropped, not retried', async () => {
  const storage = memStorage()
  const { result, owner } = finished()
  const srv = server()
  srv.offline = true
  notePending(storage, { ownerEntryId: owner.id, result, said: await share(srv, result, owner), people: SIDES })
  srv.offline = false
  const unshared = { ...owner, data: { ...owner.data, sharedWith: [] } }
  assert.deepEqual(await retryPending({ storage, ownerEntry: unshared, readPerson: srv.readPerson, putPerson: srv.putPerson, session: PLANNED }), [])
  assert.equal(srv.puts, 0)
  assert.equal(storage.store.has(PENDING_KEY), false)
})

t('a kept miss older than a week is let go on read', () => {
  const storage = memStorage()
  const { result, owner } = finished()
  const now = Date.now()
  notePending(storage, { ownerEntryId: owner.id, result, said: [{ id: 'sam', name: 'Sam', status: 'missed' }], people: SIDES, now: now - 8 * 24 * 3600 * 1000 })
  assert.deepEqual(pendingFor(storage, owner, now), [])
  assert.equal(storage.store.has(PENDING_KEY), false)
  notePending(storage, { ownerEntryId: owner.id, result, said: [{ id: 'sam', name: 'Sam', status: 'missed' }], people: SIDES, now: now - 6 * 24 * 3600 * 1000 })
  assert.equal(pendingFor(storage, owner, now).length, 1, 'a six-day-old miss was dropped')
})

t('a clock that ran out long ago does not block Together; a paused one does', () => {
  const sam0 = samOf()
  const withClock = (timer) => applyRun(sam0, PLANNED, { ...emptyRun(T0), circuit: { block: 'b0', timer } }, {})
  // Started two hours ago and never reopened: all timed out (the crunches count up, so tap them through).
  let left = startRun(PROG, T0)
  left = skip(PROG, settle(PROG, left, sec(25)), sec(25))
  const now = sec(25) + 2 * 3600 * 1000
  assert.equal(sideTaken(withClock(left), now), false, 'a clock that ran out two hours ago still blocks Together')
  assert.equal(togetherWrite(withClock(left), finished().result, now).kind, 'write')
  // Just ran out: still running for a while.
  assert.equal(sideTaken(withClock(left), sec(25 + 40 + 20 + 30) + 60 * 1000), true)
  assert.ok(STALE_CLOCK_MS >= 5 * 60 * 1000)
  // Paused, however long ago: someone is in the middle of it.
  const paused = pause(PROG, settle(PROG, startRun(PROG, T0), sec(10)), sec(10))
  assert.equal(sideTaken(withClock(paused), sec(10) + 5 * 3600 * 1000), true)
})

ta('only the people offered Together when it started are written', async () => {
  const { result, owner } = finished()
  const srv = server()
  const said = await share(srv, { ...result, with: [null] }, owner)
  assert.deepEqual(said, [])
  assert.deepEqual([srv.reads, srv.puts], [0, 0], 'someone not offered Together was read or written')
  assert.deepEqual((await share(srv, { ...result, with: [null, 'sam'] }, owner)).map(x => x.status), ['logged'])
})

t('a skip of 2.5 s is not done; it is judged before rounding', () => {
  const p = compile(circuitConfig({ work: 40, rest: 0, rounds: 1, countIn: 0 }, [{ name: 'A' }, { name: 'B' }]))
  const r = stopRun(p, skip(p, startRun(p, T0), T0 + 2500), T0 + 2500 + 3000)
  assert.deepEqual(circuitDone(p, r), [[], [3]])
})

t('a row added by hand is filled, not doubled: matched by exercise key, then name', () => {
  const out = { lifts: [{ uid: 'mine-1', key: 'plank', name: 'Plank', sets: [{ seconds: '', weight: 5 }] }, { uid: 'mine-2', key: null, name: 'Jacks', sets: [{ reps: 20, weight: '' }] }] }
  const next = { lifts: [{ uid: 'b0i0', key: 'plank', name: 'Plank', sets: [{ seconds: 40, weight: '' }] }, { uid: 'b0i1', key: null, name: 'Jacks', sets: [{ reps: '', weight: '' }] }] }
  const got = fillOut(out, next)
  assert.equal(got.lifts.length, 2, 'a hand-added row was doubled')
  assert.deepEqual(got.lifts.map(l => l.sets[0]), [{ seconds: 40, weight: 5 }, { reps: 20, weight: '' }])
  // uid still wins: a plan row is not taken by a hand-added row of the same exercise.
  const both = fillOut({ lifts: [{ uid: 'mine-1', key: 'plank', name: 'Plank', sets: [{ seconds: 9, weight: '' }] }, { uid: 'b0i0', key: 'plank', name: 'Plank', sets: [{ seconds: '', weight: '' }] }] }, next)
  assert.deepEqual(both.lifts.map(l => l.uid), ['mine-1', 'b0i0', 'b0i1'])
  assert.deepEqual(both.lifts.slice(0, 2).map(l => l.sets[0].seconds), [9, 40], 'the plan row did not get its own seconds')
})

t('together is offered only where it can help: synced, shared, and the other side free', () => {
  assert.equal(togetherSides(ownerOf(), SIDES).length, 2)
  assert.equal(togetherWords(togetherSides(ownerOf(), SIDES), null), 'Together with Sam')
  assert.equal(togetherWords(togetherSides(ownerOf(), SIDES), 'sam'), 'Together with you')
  const unsynced = { ...ownerOf(), data: { ...ownerOf().data, sharedWith: [{ id: 'sam', entryId: 'x', sync: false }] } }
  assert.deepEqual(togetherSides(unsynced, SIDES), [], 'together offered with sync off')
  assert.deepEqual(togetherSides(ownerOf(), [SIDES[0]]), [], 'together offered with nobody else')
  const ended = { ...samOf(), data: { ...samOf().data, run: { ...emptyRun(T0), endedAt: T0 + 1 } } }
  assert.deepEqual(togetherSides(ownerOf(), SIDES, () => ended), [], 'together offered with Sam already done')
  const running = { ...samOf(), data: { ...samOf().data, run: { ...emptyRun(Date.now()), circuit: { block: 'b0', timer: startRun(PROG, Date.now()) } } } }
  assert.deepEqual(togetherSides(ownerOf(), SIDES, () => running), [], 'together offered with Sam running their own')
  assert.equal(togetherSides(ownerOf(), SIDES, () => undefined).length, 2, 'a side not read yet is not ruled out')
  // Off: each side's clock only on its own Start (review fix #1).
  assert.equal(circuitToOpen(samOf().data.plan, null, { shown: false }), null)
})

t('a circuit-only plan stopped inside 30 s is timed by the circuit, not the card\'s estimate', () => {
  const pres = abPlan()
  const run = endCircuit(null, pres, 'b0', [[12]], { at: T0, seconds: 14 })
  assert.equal(runOutputs(pres, run, {}).elapsedMin, 1)
  assert.equal(runOutputs(pres, endCircuit(null, pres, 'b0', [[40]], { at: T0, seconds: 61 }), {}).elapsedMin, 2, 'measured minutes round up')
})

await Promise.all(later)
console.log(`circuit: ${pass} checks passed`)
