// The runner's writes as data (#98): lib/runflow.js, which the web's and the
// phone's WorkoutRunner both run. Every tap is ONE write `[run, opts]` and maybe
// a cursor; these pin what each tap writes and what it leaves alone. The same
// taps driven through the web's screens are app/runner.dom.test.jsx; the views
// keep no write of their own (the last case reads both files).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import {
  commitOf, writeOf, markTap, unmarkTap, skipTap, unskipTap, addSetTap, patchItemTap, jumpTap, finishTap,
  restBackTap, restBumpTap, restPauseTap, restSkipTap, holdStartTap, holdActTap, holdStopTap, holdEndTap,
  skipCircuitTap, circuitSaved, circuitTick, presOf,
} from './src/lib/runflow.js'
import { normalizePrescription, prescriptionSteps, emptyRun, blockTimer } from './src/lib/prescription.js'
import { compile, startRun, settle, bump, holdOn, holdConfig } from './src/lib/timer.js'
import { liftFieldOf } from './src/lib/lifts.js'
import { togetherItems } from './src/lib/trainer.js'

const require = createRequire(import.meta.url)
const PLAN = require('../test/fixtures/plan.json')
const LIFTS = liftFieldOf(PLAN)
const SQUAT = LIFTS.exercises.find(e => /squat/i.test(e.name))

const tests = []
const test = (name, fn) => tests.push([name, fn])

const LEGS = normalizePrescription({ title: 'Legs', blocks: [{ name: 'Main', items: [
  { kind: 'lift', name: 'Back squat', exercise: SQUAT.key, implement: 'barbell', sets: [{ reps: 5, weight: 100 }, { reps: 5, weight: 100 }] },
] }] }, { liftField: LIFTS })
const ROWS = normalizePrescription({ title: 'Rows', blocks: [{ name: 'Main', items: [
  { kind: 'interval', name: 'Row', sets: [{ distance: 500, unit: 'm', restSec: 60 }, { distance: 500, unit: 'm', restSec: 60 }] },
] }] }, { liftField: LIFTS })
const CORE = normalizePrescription({ title: 'Core', blocks: [{ name: 'Main', items: [
  { kind: 'interval', name: 'Plank', sets: [{ seconds: 30 }] },
] }] }, { liftField: LIFTS })
const CIRCUITS = normalizePrescription({ title: 'Abs', blocks: [
  { name: 'One', circuit: { work: 20, rest: 10, rounds: 1 }, items: [{ kind: 'lift', name: 'Crunch', sets: [{}] }] },
  { name: 'Two', circuit: { work: 20, rest: 10, rounds: 1 }, items: [{ kind: 'lift', name: 'Plank', sets: [{}] }] },
] }, { liftField: LIFTS })
const entryOf = (plan, run = null, out = {}) => ({ id: 'daily-x', kind: 'daily', date: '2026-11-08', data: { optId: 'planned', plan, run, out } })

/* --------------------------------------------------------------- writes */

test('commitOf: the log only when asked, and a finished run reopened by the next write', () => {
  const e = entryOf(LEGS, { ...emptyRun(1), endedAt: 50 })
  const [run, opts] = commitOf(e, { ...e.data.run, cursor: 'x' })
  assert.equal(run.endedAt, null, 'a write into a finished run left it finished')
  assert.equal(opts.out, null)
  assert.equal(opts.done, undefined)
  const [again] = commitOf(e, { ...e.data.run, endedAt: 99 })
  assert.equal(again.endedAt, 99, 'a NEW end was taken off')
  const [, logged] = commitOf(e, e.data.run, { outputs: true, done: true })
  assert.ok(logged.out, 'outputs asked for and not written')
  assert.equal(logged.done, true)
  const [same, carried] = writeOf(e, e.data.run, { plan: LEGS })
  assert.equal(same.endedAt, null)
  assert.deepEqual(carried, { plan: LEGS })
})

test('markTap: the set, the log and the cursor in one write', () => {
  const [s1, s2] = prescriptionSteps(LEGS)
  const t = markTap(entryOf(LEGS), prescriptionSteps(LEGS), s1, { reps: 5, weight: 110 })
  assert.equal(t.write[0].sets[s1.setId].weight, 110)
  assert.equal(t.cursor, s2.setId)
  assert.equal(t.write[1].out.lifts[0].sets[0].weight, 110)
  assert.ok(!t.write[0].restUntil, 'a lift set started a rest')
})

test('unmark, skip, unskip, jump: where the cursor goes, and the log only for unmark', () => {
  const steps = prescriptionSteps(LEGS)
  const [s1, s2] = steps
  const marked = markTap(entryOf(LEGS), steps, s1, { reps: 5, weight: 100 }).write[0]
  const u = unmarkTap(entryOf(LEGS, marked), s1.setId)
  assert.equal(u.write[0].sets[s1.setId], undefined)
  assert.ok(u.write[1].out)
  assert.equal(u.cursor, s1.setId)
  const sk = skipTap(entryOf(LEGS), steps, s1)
  assert.ok(sk.write[0].skipped.includes(s1.setId))
  assert.equal(sk.write[1].out, null)
  assert.equal(sk.cursor, s2.setId)
  const un = unskipTap(entryOf(LEGS, sk.write[0]), s1.setId)
  assert.ok(!un.write[0].skipped.includes(s1.setId))
  assert.equal(un.cursor, s1.setId)
  const j = jumpTap(entryOf(LEGS), s2.setId)
  assert.equal(j.write[0].cursor, s2.setId)
  assert.equal(j.write[1].out, null)
  assert.equal(j.cursor, s2.setId)
})

test('addSetTap and patchItemTap: the plan changes, the run and the cursor do not', () => {
  const [s1] = prescriptionSteps(LEGS)
  const run = { ...emptyRun(1), cursor: s1.setId }
  const a = addSetTap(entryOf(LEGS, run), s1, { weight: 120 })
  assert.deepEqual(a.write[0], run)
  assert.equal(a.write[1].plan.blocks[0].items[0].sets.length, 3)
  assert.equal(a.write[1].plan.blocks[0].items[0].sets[2].weight, 120)
  assert.ok(!('cursor' in a), 'adding a set moved the cursor')
  const p = patchItemTap(entryOf(LEGS, run), s1, { weightMode: 'side' }, LIFTS)
  assert.deepEqual(p.write[0], run)
  assert.ok(p.write[1].plan, 'the meaning is not on the plan')
  assert.ok(!('cursor' in p))
})

test('finishTap: done, the log and an end, one write', () => {
  const t = finishTap(entryOf(LEGS))
  assert.ok(t.write[0].endedAt)
  assert.equal(t.write[1].done, true)
  assert.ok(t.write[1].out)
})

test('the rest: an interval set starts it; bump, pause, skip and Back are instants on the run', () => {
  const steps = prescriptionSteps(ROWS)
  const [s1, s2] = steps
  const run = markTap(entryOf(ROWS), steps, s1, {}).write[0]
  assert.ok(run.restUntil > Date.now())
  const e = entryOf(ROWS, run)
  assert.equal(restBumpTap(e, 10, 1000).write[0].restUntil, run.restUntil + 10_000)
  assert.ok(restPauseTap(e, Date.now()).write[0].restPause)
  assert.equal(restSkipTap(e).write[0].restUntil, 0)
  const b = restBackTap(e)
  assert.equal(b.cursor, s1.setId)
  assert.equal(b.write[0].restUntil, 0)
  for (const t of [restBumpTap(e, 10), restPauseTap(e), restSkipTap(e), b]) assert.equal(t.write[1].out, null, 'a clock nudge rewrote the log')
  void s2
})

test("a timed set: start from the draft's seconds, nudge, stop with nothing logged, end with what was held", () => {
  const steps = prescriptionSteps(CORE)
  const [p] = steps
  const started = holdStartTap(entryOf(CORE), p, { seconds: 40 }, 1000).write[0]
  const hold = holdOn(started, p.setId)
  assert.equal(hold.seconds, 40, 'the draft\'s seconds were not used')
  const fromPlan = holdOn(holdStartTap(entryOf(CORE), p, {}, 1000).write[0], p.setId)
  assert.equal(fromPlan.seconds, 30)
  const e = entryOf(CORE, started)
  const stopped = holdStopTap(e)
  assert.equal(stopped.write[0].hold, null)
  assert.equal(stopped.write[0].sets?.[p.setId], undefined)
  const none = holdEndTap(e, steps, p, {}, null)
  assert.equal(none.write[0].hold, null)
  assert.equal(none.write[0].sets?.[p.setId], undefined, 'a mis-tap logged the set')
  assert.ok(!('cursor' in none))
  assert.equal(none.write[1].out, null)
  const held = holdEndTap(e, steps, p, {}, 28)
  assert.equal(held.write[0].sets[p.setId].seconds, 28)
  assert.ok(held.write[1].out)
})

test('holdActTap: a clock control is applied to the clock as it stands now', () => {
  const steps = prescriptionSteps(CORE)
  const run = holdStartTap(entryOf(CORE), steps[0], {}, 1000).write[0]
  const hold = holdOn(run, steps[0].setId)
  const program = compile(holdConfig(hold.seconds, { name: 'Plank', key: null }))
  const t = holdActTap(entryOf(CORE, run), hold, program, bump, 5000, 10)
  assert.deepEqual(t.write[0].hold.timer, bump(program, settle(program, hold.timer, 5000), 5000, 10))
  assert.equal(t.write[0].hold.setId, hold.setId)
  assert.equal(t.write[1].out, null)
})

test('skipCircuitTap: nothing of it logged, the cursor past it', () => {
  const steps = prescriptionSteps(CIRCUITS)
  const t = skipCircuitTap(entryOf(CIRCUITS, emptyRun(1)), steps[0])
  assert.ok(t.write[0].skipped.includes(steps[0].setId))
  assert.equal(t.cursor, steps[1].setId)
})

/* ------------------------------------------------- someone else's copy (#96) */

// Sam's copy of a workout the owner shared, still carrying the owner's words.
const NOTED = normalizePrescription({ title: 'Legs', why: 'Owner reasons.', notes: ['Owner note.'], blocks: [{ name: 'Main', items: [
  { kind: 'lift', name: 'Back squat', exercise: SQUAT.key, implement: 'barbell', note: 'Owner cue.', sets: [{ reps: 5, weight: 100 }] },
] }] }, { liftField: LIFTS })
const copyOf = (plan) => ({ ...entryOf(plan, emptyRun(1)), data: { ...entryOf(plan, emptyRun(1)).data, sharedFrom: { id: 'owner', name: 'Alex' } } })

test("a copy: the runner reads the plan as shown, without the owner's words (#96 planShown)", () => {
  const shown = presOf(copyOf(NOTED))
  assert.ok(!shown.why, "the owner's why shows on someone's copy")
  assert.ok(!(shown.notes || []).length, "the owner's notes show on someone's copy")
  assert.ok(!shown.blocks[0].items[0].note, "the owner's exercise note shows on someone's copy")
  assert.equal(presOf(entryOf(NOTED)), NOTED, 'the owner\'s own entry is not read as it is stored')
  // The steps the runner walks are the shown plan's: no owner's cue on Sam's set screen.
  assert.ok(!prescriptionSteps(shown)[0].item.note, "the owner's cue is on Sam's set screen")
})

test("a copy: Add a set and the weight's meaning write the owner's words back exactly as stored", () => {
  const e = copyOf(NOTED)
  const [s1] = prescriptionSteps(NOTED)
  for (const [what, t] of [['Add a set', addSetTap(e, s1, {})], ["the weight's meaning", patchItemTap(e, s1, { weightMode: 'side' }, LIFTS)]]) {
    const plan = t.write[1].plan
    assert.equal(plan.why, NOTED.why, `${what} dropped the owner's why from the stored copy`)
    assert.deepEqual(plan.notes, NOTED.notes, `${what} dropped the owner's notes from the stored copy`)
    assert.equal(plan.blocks[0].items[0].note, 'Owner cue.', `${what} dropped the exercise's note`)
  }
  assert.ok(patchItemTap(e, s1, { weightMode: 'side' }, LIFTS).write[1].plan.blocks[0].items[0].weightMode, 'the switch did not land')
})

/* ------------------------------------------------------------ circuits */

const clockOf = (block) => compile(blockTimer(block))

test('circuitTick: running is a save; nothing done is as if it never started', () => {
  const block = CIRCUITS.blocks[0]
  const program = clockOf(block)
  const timer = startRun(program, 1000)
  const saved = circuitTick({ run: null, pres: CIRCUITS, block, program, timer, only: true })
  assert.equal(saved.write[0].circuit.block, block.id)
  assert.equal(saved.write[0].startedAt, 1000)
  assert.deepEqual(saved.write[1], {})
  assert.ok(!saved.back && !saved.ended)
  const together = circuitSaved(null, block.id, timer, { together: true, withIds: ['sam'] })
  assert.deepEqual(together.circuit.with, ['sam'])
  const stopped = { ...timer, finishedAt: 1500 }
  const gone = circuitTick({ run: saved.write[0], pres: CIRCUITS, block, program, timer: stopped, only: true })
  assert.equal(gone.write[0], null, 'an untouched run was left on the entry')
  assert.ok(gone.back)
  const kept = circuitTick({ run: { ...saved.write[0], skipped: ['zz'] }, pres: CIRCUITS, block, program, timer: stopped, only: true })
  assert.equal(kept.write[0].circuit, null)
  assert.deepEqual(kept.write[0].skipped, ['zz'], 'what was already done went with an empty circuit')
})

test('circuitTick: ended with work done, the log; the next circuit straight after, the last one finishes', () => {
  const [one, two] = CIRCUITS.blocks
  const p1 = clockOf(one)
  const t1 = startRun(p1, 1000)
  const end1 = settle(p1, t1, 1000 + 10 * 60_000)
  assert.ok(end1.finishedAt != null, 'the clock did not run out')
  const first = circuitTick({ run: null, pres: CIRCUITS, block: one, program: p1, timer: end1, only: true, together: true, withIds: ['sam'] })
  assert.ok(first.ended)
  assert.equal(first.next, two.id, 'a plan of circuits did not go on to the next')
  assert.equal(first.logged, null)
  assert.equal(first.write[1].done, undefined)
  assert.equal(first.write[1].outputs, true)
  assert.equal(first.share.key, t1.startedAt, 'the shared result is not keyed by its clock')
  assert.deepEqual(first.share.with, ['sam'])
  assert.deepEqual(first.share.items, togetherItems(one), 'a shared result does not carry each side\'s shape (#96)')
  assert.ok(first.share.items.every(it => 'by' in it), 'a shared result\'s items do not say how each was timed (#96 togetherItems)')
  const p2 = clockOf(two)
  const end2 = settle(p2, startRun(p2, 2000), 2000 + 10 * 60_000)
  const last = circuitTick({ run: first.write[0], pres: CIRCUITS, block: two, program: p2, timer: end2, only: true })
  assert.equal(last.write[1].done, true, 'the last circuit did not finish the plan')
  assert.ok(last.write[0].endedAt)
  assert.equal(last.logged, 'Logged')
  assert.equal(last.share, null)
  const mixed = circuitTick({ run: null, pres: CIRCUITS, block: one, program: p1, timer: end1, only: false })
  assert.equal(mixed.logged, 'Logged on this workout')
  assert.equal(mixed.next, null)
})

/* ------------------------------------------------------- one controller */

test('both runners take their writes from lib/runflow.js and keep none of their own', () => {
  for (const f of ['src/runner.jsx', '../mobile/src/features/runner.tsx']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8')
    if (!/useRunner\(\{ entry, onRun, onExit, onFinish, shown, together, liftField, feedback: /.test(src)) throw new Error(`${f} does not run useRunner`)
    if (!/circuitTick\(\{ run: runRef\.current/.test(src)) throw new Error(`${f}'s circuit does not run circuitTick`)
    const own = src.match(/\bconst (commit|mark|unmark|skip|finish|stopHold|beginHold|holdAct|shareResult|save|patchThisItem|addAnother|jump) = /g)
    if (own) throw new Error(`${f} writes for itself again: ${own.join(', ')}`)
    if (/\b(markSet|skipSet|unmarkSet|finishRun|endCircuit|reopened|runOutputs)\(/.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''))) throw new Error(`${f} calls a run write directly`)
  }
})

let failed = 0
for (const [name, fn] of tests) {
  try { await fn(); console.log(`  ok  ${name}`) } catch (e) { failed += 1; console.log(`  FAIL ${name}\n       ${e.stack?.split('\n').slice(0, 3).join('\n       ')}`) }
}
console.log(failed ? `${failed} of ${tests.length} runflow cases failed` : `${tests.length} runflow cases`)
process.exit(failed ? 1 : 0)
