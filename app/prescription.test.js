/*
 * The prescription model, as arithmetic.
 *
 * Run: npm run test:presc
 *
 * Everything here is pure — the clock is an argument, not a thing that happens —
 * which is the reason `lib/prescription.js` is shaped the way it is. The rest
 * deadline being an absolute instant is what lets the runner survive the app
 * being closed, and it is what lets that behaviour be tested without a browser.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  normalizePrescription, prescriptionSteps, prescriptionLine, itemLine, setLine,
  emptyRun, markSet, unmarkSet, skipSet, unskipSet, nudgeRest, endRest, finishRun,
  restLeft, runElapsed, runProgress, firstOpen, isLogged, isSkipped,
  setDraft, carryForward, runOutputs, remapRun,
  patchSet, addSet, addSetLike, removeSet, removeItem, appendLift, reindex, setFieldsFor,
  splitPrescription, moveItem, isLiftOnly,
  blankPrescription, appendPiece, dropEmptyBlocks, patchItem, reviseWeightModes, followWeightModes, patchRunItem,
} from './src/lib/prescription.js'
import { liftVolume, liftsIn, liftSummary, rememberedWeightMode } from './src/lib/lifts.js'

const plan = JSON.parse(readFileSync(new URL('../test/fixtures/plan.json', import.meta.url), 'utf8'))

/** The real exercise catalog, off the real plan.json. */
const liftField = (() => {
  for (const opt of plan.dailyMenu) for (const f of opt.outputs || []) if (f.type === 'lifts') return f
  return null
})()
assert.ok(liftField, 'plan.json must carry a lifts field')

const KNOWN = liftField.exercises[0].key
const KNOWN_NAME = liftField.exercises[0].name

let pass = 0
const t = (name, fn) => {
  try { fn(); pass += 1 }
  catch (err) { console.error(`\n✗ ${name}\n  ${err.message}\n`); process.exitCode = 1 }
}

/* ------------------------------------------------------------ normalising */

t('a lift item resolves against the catalog and keeps its own labels', () => {
  const p = normalizePrescription({
    title: 'Legs', minutes: 45, why: 'because',
    blocks: [{ name: 'Main', items: [{
      kind: 'lift', name: 'whatever the model called it', exercise: KNOWN, implement: 'barbell',
      sets: [{ reps: 8, weight: 135, restSec: 90 }, { reps: 8, weight: 135, restSec: 90 }],
    }] }],
  }, { liftField })
  const item = p.blocks[0].items[0]
  // The CATALOG names it, not the model — the key is what a chart groups by and
  // the name is what the log reads back as.
  assert.equal(item.name, KNOWN_NAME)
  assert.equal(item.exercise, KNOWN)
  assert.equal(item.implement, 'barbell')
  assert.equal(item.implementLabel, 'Barbell')
  assert.equal(item.weightLabel, 'lb on the bar')
  assert.equal(item.sets.length, 2)
})

t('a revision keeps each block\'s and item\'s uid, so a rename stays a rename for a shared workout', () => {
  const p = normalizePrescription({
    title: 'Legs', minutes: 45, why: 'because',
    blocks: [{ uid: 'blk-1', name: 'Main', items: [
      { uid: 'it-1', kind: 'interval', name: 'Renamed row', sets: [{ seconds: 600 }] },
      { kind: 'interval', name: 'New piece', sets: [{ seconds: 60 }] },
      { uid: { evil: 1 }, kind: 'interval', name: 'Junk uid', sets: [{ seconds: 60 }] },
      { uid: '../../x y', kind: 'interval', name: 'Bad uid', sets: [{ seconds: 60 }] },
    ] }],
  }, { liftField })
  const [renamed, fresh, junk, bad] = p.blocks[0].items
  assert.equal(p.blocks[0].uid, 'blk-1')
  assert.equal(renamed.uid, 'it-1', 'the revision lost the item\'s uid')
  assert.equal(renamed.name, 'Renamed row')
  // A new item has no uid at all (the server mints one), and anything not a plain token is dropped.
  assert.equal('uid' in fresh, false)
  assert.equal('uid' in junk, false)
  assert.equal('uid' in bad, false)
})

t('an invented exercise key keeps the row but loses its catalog identity', () => {
  const p = normalizePrescription({
    title: 'x', minutes: 20, why: '',
    blocks: [{ name: 'Main', items: [{
      kind: 'lift', name: 'Reverse hyper snatch', exercise: 'not-a-real-key',
      sets: [{ reps: 5 }],
    }] }],
  }, { liftField })
  const item = p.blocks[0].items[0]
  assert.equal(item.name, 'Reverse hyper snatch')
  // null rather than the made-up string: `lastLift` keys history off this, and a
  // hallucinated key would quietly start its own series.
  assert.equal(item.exercise, null)
})

t('an implement the movement does not offer is dropped', () => {
  const pullup = liftField.exercises.find(e => Array.isArray(e.implements) && e.implements.length)
  if (!pullup) return
  const p = normalizePrescription({
    title: 'x', minutes: 20, why: '',
    blocks: [{ name: 'Main', items: [{
      kind: 'lift', name: 'x', exercise: pullup.key, implement: 'definitely-not-offered',
      sets: [{ reps: 5 }],
    }] }],
  }, { liftField })
  const chosen = p.blocks[0].items[0].implement
  assert.ok(chosen === '' || pullup.implements.includes(chosen))
})

t('an item with no sets is dropped; a block that is only a note is not', () => {
  const p = normalizePrescription({
    title: 'x', minutes: 20, why: '',
    blocks: [
      // What a real planning run produced: a warm-up written as prose, exactly as
      // the prompt asks for. Dropping it lost the warm-up on the way to the screen.
      { name: 'Warm-up', note: '5 min easy, then two ramp-up sets with the bar.', items: [] },
      { name: 'Prose', items: [{ kind: 'interval', name: 'swim easy until loose', sets: [] }] },
      { name: 'Main', items: [{ kind: 'interval', name: '4 × 100', sets: [{ distance: 100 }] }] },
    ],
  }, { liftField })
  assert.deepEqual(p.blocks.map(b => b.name), ['Warm-up', 'Main'])
  assert.equal(p.blocks[0].items.length, 0)
  // And the steps the runner walks are only the real sets.
  assert.equal(prescriptionSteps(p).length, 1)
})

t('a prescription with no sets anywhere is not a workout', () => {
  assert.equal(normalizePrescription({
    title: 'x', minutes: 20, why: '',
    blocks: [{ name: 'Just talk', note: 'go for a walk', items: [] }],
  }, { liftField }), null)
})

t('a prescription with nothing in it normalises to null', () => {
  assert.equal(normalizePrescription({ title: 'x', blocks: [] }, { liftField }), null)
  assert.equal(normalizePrescription(null), null)
  assert.equal(normalizePrescription('nope'), null)
})

t('numbers are clamped and junk is dropped, not coerced to zero', () => {
  const p = normalizePrescription({
    title: 'x', minutes: 99999, why: '',
    blocks: [{ name: 'M', items: [{
      kind: 'interval', name: 'x', unit: 'yd',
      sets: [{ distance: 100, weight: 'heavy', reps: null, restSec: -30 }],
    }] }],
  }, { liftField })
  const set = p.blocks[0].items[0].sets[0]
  assert.equal(p.minutes, 600)
  assert.equal(set.distance, 100)
  assert.equal(set.unit, 'yd')
  // A weight of "heavy" is not a weight. Absent, never 0 — a zero-weight set
  // charts as a set lifted with no load.
  assert.equal(set.weight, null)
  assert.equal(set.restSec, 0)
})

/* ------------------------------------------------------------ the totals */

const legs = normalizePrescription({
  title: 'Legs', category: 'lift', activity: 'lift', minutes: 45, why: 'w',
  blocks: [
    { name: 'Warm-up', items: [{ kind: 'interval', name: 'Bike easy', sets: [{ seconds: 300, restSec: 0 }] }] },
    { name: 'Main', items: [
      { kind: 'lift', name: 'x', exercise: KNOWN, implement: 'barbell',
        sets: [{ reps: 8, weight: 135, restSec: 90 }, { reps: 8, weight: 135, restSec: 90 }, { reps: 6, weight: 155, restSec: 120 }] },
    ] },
  ],
}, { liftField })

t('steps flatten in the order they are done, with stable positional ids', () => {
  const steps = prescriptionSteps(legs)
  assert.equal(steps.length, 4)
  assert.deepEqual(steps.map(s => s.setId), ['b0i0s0', 'b1i0s0', 'b1i0s1', 'b1i0s2'])
  assert.equal(steps[1].index, 0)
  assert.equal(steps[3].of, 3)
})

t('the one-line summaries read as a human would write them', () => {
  assert.equal(setLine({ reps: 8, weight: 135 }, legs.blocks[1].items[0]), '8 @ 135 lb on the bar')
  assert.equal(setLine({ distance: 100, unit: 'yd' }), '100 yd')
  assert.equal(itemLine({ sets: [{ reps: 8, weight: 135 }, { reps: 8, weight: 135 }] }), '2 × 8 @ 135 lb')
  assert.match(prescriptionLine(legs), /2 exercises · 4 sets · about 45 min/)
})

t('a lift always offers reps and weight, even where the planner left one blank', () => {
  const lift = legs.blocks[1].items[0]
  assert.deepEqual(setFieldsFor(lift, lift.sets[0]), ['reps', 'weight'])
  // The case that matters: the planner is TOLD to leave weight out rather than
  // invent one, so an absent weight has to mean "you tell me" and not "no box".
  assert.deepEqual(setFieldsFor({ kind: 'lift' }, { reps: 5 }), ['reps', 'weight'])
})

t('an interval offers only what it actually carries', () => {
  assert.deepEqual(setFieldsFor({ kind: 'interval' }, { distance: 100 }), ['distance'])
  assert.deepEqual(setFieldsFor({ kind: 'interval' }, { seconds: 40 }), ['seconds'])
  assert.deepEqual(setFieldsFor({ kind: 'interval' }, { distance: 400, seconds: 90 }), ['distance', 'seconds'])
  // Nothing at all still gets a clock — the one field every piece of work has.
  assert.deepEqual(setFieldsFor({ kind: 'interval' }, { restSec: 30 }), ['seconds'])
})

/* -------------------------------------------------------------- the clock */

const T0 = 1_700_000_000_000

t('rest is an absolute deadline, so a closed app cannot drift it', () => {
  const steps = prescriptionSteps(legs)
  const run = markSet(emptyRun(T0), steps[1], { reps: 8, weight: 135, restSec: 90 }, { at: T0, steps })
  assert.equal(run.restUntil, T0 + 90_000)
  assert.equal(restLeft(run, T0), 90)
  assert.equal(restLeft(run, T0 + 30_000), 60)
  // Four minutes with the phone in a pocket: the rest is over, not "60 left".
  assert.equal(restLeft(run, T0 + 240_000), 0)
})

t('elapsed counts from the first set and freezes when the run ends', () => {
  const run = { ...emptyRun(T0) }
  assert.equal(runElapsed(run, T0 + 61_000), 61)
  const over = finishRun(run, { at: T0 + 100_000 })
  assert.equal(runElapsed(over, T0 + 999_000), 100)
})

t('nudging rest moves the deadline and never into the past', () => {
  const steps = prescriptionSteps(legs)
  let run = markSet(emptyRun(T0), steps[1], { restSec: 90 }, { at: T0, steps })
  run = nudgeRest(run, 30, { at: T0 })
  assert.equal(restLeft(run, T0), 120)
  run = nudgeRest(run, -600, { at: T0 })
  assert.equal(restLeft(run, T0), 0)
  assert.equal(restLeft(endRest(run), T0), 0)
})

/* ---------------------------------------------------------- marking sets */

t('marking a set advances to the next unfinished one', () => {
  const steps = prescriptionSteps(legs)
  let run = markSet(emptyRun(T0), steps[0], { seconds: 300 }, { at: T0, steps })
  assert.equal(run.cursor, 'b1i0s0')
  run = markSet(run, steps[1], { reps: 8, weight: 135 }, { at: T0 + 1000, steps })
  assert.equal(run.cursor, 'b1i0s1')
  assert.ok(isLogged(run, 'b1i0s0'))
  assert.equal(runProgress(run, steps).done, 2)
})

t('the last set does not advance past itself', () => {
  const steps = prescriptionSteps(legs)
  let run = emptyRun(T0)
  for (const s of steps) run = markSet(run, s, {}, { at: T0, steps })
  assert.equal(run.cursor, steps.at(-1).setId)
  assert.equal(runProgress(run, steps).left, 0)
})

t('un-marking takes the set back and clears the rest it started', () => {
  const steps = prescriptionSteps(legs)
  let run = markSet(emptyRun(T0), steps[1], { reps: 8, restSec: 90 }, { at: T0, steps })
  run = unmarkSet(run, steps[1].setId)
  assert.equal(isLogged(run, steps[1].setId), false)
  assert.equal(restLeft(run, T0), 0)
  assert.equal(run.cursor, steps[1].setId)
})

t('a skipped set is recorded as skipped, not as zero', () => {
  const steps = prescriptionSteps(legs)
  let run = skipSet(emptyRun(T0), steps[1].setId, { at: T0, steps })
  assert.ok(isSkipped(run, steps[1].setId))
  assert.equal(isLogged(run, steps[1].setId), false)
  const p = runProgress(run, steps)
  assert.equal(p.skipped, 1)
  assert.equal(p.done, 0)
  // And nothing from it reaches the log.
  assert.equal(liftsIn(runOutputs(legs, run)).length, 0)
  run = unskipSet(run, steps[1].setId)
  assert.equal(isSkipped(run, steps[1].setId), false)
})

t('firstOpen drops him on the first set that is neither done nor skipped', () => {
  const steps = prescriptionSteps(legs)
  let run = markSet(emptyRun(T0), steps[0], {}, { at: T0, steps })
  run = skipSet(run, steps[1].setId, { at: T0, steps })
  assert.equal(firstOpen(run, steps), 'b1i0s1')
})

/* ------------------------------------------------------------- the draft */

t('an untouched set opens on the prescription', () => {
  const steps = prescriptionSteps(legs)
  // No rest in it: `legs` is a lift, and a lift carries none — see below.
  assert.deepEqual(setDraft(null, steps[1]), { reps: 8, weight: 135 })
})

t('a lift has no programmed rest, and an interval piece still does', () => {
  // Lift sets carry no programmed rest, since rest between lifting sets is not
  // timed strictly. Dropped on the way IN rather than hidden, so nothing
  // downstream — the runner's countdown, a later render of the editor — can
  // resurrect a number the user was never shown.
  const lift = normalizePrescription({
    title: 'x', blocks: [{ name: 'M', items: [
      { kind: 'lift', exercise: 'back-squat', sets: [{ reps: 5, weight: 185, restSec: 180 }] },
      { kind: 'interval', name: 'Row', unit: 'm', sets: [{ distance: 500, restSec: 60 }] },
    ] }],
  }, { liftField })
  const [squat, row] = lift.blocks[0].items
  assert.equal(squat.sets[0].restSec, null, 'a lift set keeps no rest')
  assert.equal(squat.sets[0].weight, 185, 'and loses nothing else')
  assert.equal(row.sets[0].restSec, 60, 'the rest at the wall IS the interval set')
})

t('a lift-only session is not runnable; a mixed one is', () => {
  // `legs` is a bike warm-up plus squats, and NEITHER block names a category, so
  // there is no warm-up to tell apart from the work and the bike piece counts.
  assert.equal(isLiftOnly(legs), false)

  // The real shape: the work names its quota, the warm-up does not. Five easy
  // minutes on the bike is not what makes a leg day worth a clock.
  const warmed = normalizePrescription({
    title: 'x', blocks: [
      { name: 'Warm-up', items: [{ kind: 'interval', name: 'Bike easy', sets: [{ seconds: 300 }] }] },
      { name: 'Main', category: 'lift', items: [
        { kind: 'lift', exercise: 'back-squat', sets: [{ reps: 5, weight: 185 }] }] },
    ],
  }, { liftField })
  assert.equal(isLiftOnly(warmed), true, 'a warm-up does not make it runnable')

  const mixed = normalizePrescription({
    title: 'x', blocks: [{ name: 'M', category: 'lift', items: [
      { kind: 'lift', exercise: 'back-squat', sets: [{ reps: 5, weight: 185 }] },
      { kind: 'interval', name: 'Row', unit: 'm', sets: [{ distance: 500, restSec: 60 }] },
    ] }],
  }, { liftField })
  assert.equal(isLiftOnly(mixed), false, 'the row is the part worth running')
  assert.equal(isLiftOnly({ blocks: [] }), false, 'nothing at all is not a lift session')
})

t('reordering moves one exercise and says where it landed', () => {
  const two = normalizePrescription({
    title: 'x', blocks: [{ name: 'M', items: [
      { kind: 'lift', exercise: 'back-squat', sets: [{ reps: 5, weight: 185 }] },
      { kind: 'lift', exercise: 'bench-press', sets: [{ reps: 8, weight: 135 }] },
    ] }],
  }, { liftField })
  const names = (p) => p.blocks[0].items.map(i => i.name)
  const first = names(two)[0]

  const down = moveItem(two, 'b0i0', 'down')
  assert.deepEqual(names(down.pres), [names(two)[1], first])
  assert.equal(down.itemId, 'b0i1', 'the glow follows the row, not the slot it left')

  // Off the end is a no-op that still answers, so no row has to special-case it.
  const stuck = moveItem(two, 'b0i0', 'up')
  assert.deepEqual(names(stuck.pres), names(two))
  assert.equal(stuck.itemId, 'b0i0')
})

t('once he has moved off the prescription the last set carries forward', () => {
  const steps = prescriptionSteps(legs)
  const run = markSet(emptyRun(T0), steps[1], { reps: 8, weight: 155 }, { at: T0, steps })
  // Set two is prescribed at 135, but the user actually did 155 on set one — and that
  // is the number the user is trying to repeat, not the stale one.
  assert.equal(carryForward(run, steps, steps[2]).weight, 155)
  // A set with nothing before it has nothing to carry.
  assert.equal(carryForward(run, steps, steps[1]), null)
})

t('a logged set opens on what he logged, not on the target', () => {
  const steps = prescriptionSteps(legs)
  const run = markSet(emptyRun(T0), steps[1], { reps: 6, weight: 145 }, { at: T0, steps })
  const draft = setDraft(run, steps[1])
  assert.equal(draft.reps, 6)
  assert.equal(draft.weight, 145)
})

/* ------------------------------------------------- writing back to the log */

t('lift sets become out.lifts in the shape the lift log already edits', () => {
  const steps = prescriptionSteps(legs)
  let run = emptyRun(T0)
  run = markSet(run, steps[1], { reps: 8, weight: 135 }, { at: T0, steps })
  run = markSet(run, steps[2], { reps: 8, weight: 135 }, { at: T0, steps })
  const out = runOutputs(legs, run, { rpe: 7 })
  const lifts = liftsIn(out)
  assert.equal(lifts.length, 1)
  assert.equal(lifts[0].key, KNOWN)
  assert.equal(lifts[0].name, KNOWN_NAME)
  assert.equal(lifts[0].implementLabel, 'Barbell')
  assert.equal(lifts[0].sets.length, 2)
  // The existing arithmetic reads it without knowing the runner exists.
  assert.equal(liftVolume(out), 2160)
  // And it does not stamp on anything already in `out`.
  assert.equal(out.rpe, 7)
})

t('only sets he actually marked reach the log', () => {
  const out = runOutputs(legs, emptyRun(T0), {})
  assert.equal(liftsIn(out).length, 0)
  assert.equal(out.poolDistance, undefined)
})

t('a pool swim totals into poolDistance, and a mixed unit does not', () => {
  const swim = normalizePrescription({
    title: '2k', minutes: 45, why: '',
    blocks: [{ name: 'Main', items: [
      { kind: 'interval', name: '4 × 100', unit: 'yd', sets: [{ distance: 100 }, { distance: 100 }] },
      { kind: 'interval', name: '1 × 400 metric', unit: 'm', sets: [{ distance: 400 }] },
    ] }],
  }, { liftField })
  const steps = prescriptionSteps(swim)
  let run = emptyRun(T0)
  for (const s of steps) run = markSet(run, s, { distance: s.set.distance, unit: s.set.unit }, { at: T0, steps })
  const out = runOutputs(swim, run, {})
  // 200 yards. The 400 metres is NOT added on top — a swim in metres must not
  // silently become yards, and a total that mixed them would be a lie.
  assert.equal(out.poolDistance, 200)
})

/* ------------------------------------------------------------ the editor */

t('editing a set leaves everything else alone', () => {
  const next = patchSet(legs, 'b1i0', 'b1i0s0', { weight: 145 })
  assert.equal(next.blocks[1].items[0].sets[0].weight, 145)
  assert.equal(next.blocks[1].items[0].sets[1].weight, 135)
  assert.equal(legs.blocks[1].items[0].sets[0].weight, 135, 'the original is untouched')
})

t('another set copies the last one, and removing the last set removes the item', () => {
  const more = addSet(legs, 'b1i0')
  assert.equal(more.blocks[1].items[0].sets.length, 4)
  assert.equal(more.blocks[1].items[0].sets[3].reps, 6)
  let one = removeSet(legs, 'b0i0', 'b0i0s0')
  // The warm-up had one set, so removing it takes the item and its block.
  assert.equal(one.blocks.length, 1)
  assert.equal(one.blocks[0].name, 'Main')
})

t('one more set from the runner copies what he DID, keeps decimals, and renumbers nothing', () => {
  const before = prescriptionSteps(legs).map(s => [s.setId, s.itemId, s.index])
  // What the runner hands over: the planned set under the draft, plus the noise a draft carries.
  const more = addSetLike(legs, 'b1i0', { reps: 5, weight: 137.5, restSec: 120, at: 123456, unit: null })
  const after = new Map(prescriptionSteps(more).map(s => [s.setId, [s.setId, s.itemId, s.index]]))
  for (const [id, itemId, index] of before) {
    assert.deepEqual(after.get(id), [id, itemId, index], `${id} moved — a logged set would be orphaned`)
  }
  const sets = more.blocks[1].items[0].sets
  assert.equal(sets.length, 4)
  assert.equal(sets[3].id, 'b1i0s3')
  assert.equal(sets[3].reps, 5)
  assert.equal(sets[3].weight, 137.5, 'a half-pound is a number, not a rounding error')
  assert.equal(sets[3].restSec, 120)
  assert.equal(sets[3].at, undefined, 'a draft\'s timestamp is not a set field')
  assert.equal(legs.blocks[1].items[0].sets.length, 3, 'the original is untouched')
  // With nothing typed it is the plain "another set", same as the editor's button.
  assert.equal(addSetLike(legs, 'b1i0').blocks[1].items[0].sets[3].weight, 155)
  // A run keyed by the old ids reads the same against the new plan — no remap needed.
  const run = { sets: { b1i0s0: { reps: 8, weight: 135, at: 1 }, b1i0s1: { reps: 8, weight: 137.5, at: 2 } } }
  const outs = runOutputs(more, run, {})
  assert.equal(liftsIn(outs)[0].sets[1].weight, 137.5)
})

t('editing a set does not delete a prose-only block', () => {
  const withWarmup = normalizePrescription({
    title: 'x', minutes: 45, why: '',
    blocks: [
      { name: 'Warm-up', note: '5 min easy.', items: [] },
      { name: 'Main', items: [{ kind: 'lift', name: 'x', exercise: KNOWN, implement: 'barbell',
        sets: [{ reps: 8, weight: 135 }] }] },
    ],
  }, { liftField })
  const edited = patchSet(withWarmup, 'b1i0', 'b1i0s0', { weight: 145 })
  assert.deepEqual(edited.blocks.map(b => b.name), ['Warm-up', 'Main'])
  assert.equal(edited.blocks[1].items[0].sets[0].weight, 145)
})

t('removing an item renumbers what is left', () => {
  const next = removeItem(legs, 'b0i0')
  assert.equal(next.blocks.length, 1)
  assert.equal(next.blocks[0].id, 'b0')
  assert.equal(prescriptionSteps(next)[0].setId, 'b0i0s0')
})

t('an added exercise arrives with one blank set', () => {
  const next = appendLift(legs, liftField, KNOWN)
  const added = next.blocks.at(-1).items.at(-1)
  assert.equal(added.name, KNOWN_NAME)
  assert.equal(added.sets.length, 1)
  assert.equal(added.sets[0].reps, null)
  assert.equal(added.sets[0].weight, null)
})

t('a completed set survives an edit that renumbers the ids', () => {
  const steps = prescriptionSteps(legs)
  let run = markSet(emptyRun(T0), steps[3], { reps: 6, weight: 155 }, { at: T0, steps })
  assert.ok(isLogged(run, 'b1i0s2'))

  // Delete the warm-up, which renumbers every id after it.
  const after = removeItem(legs, 'b0i0')
  const moved = remapRun(run, legs, after)
  // The third set of that movement is still done, under its new id.
  assert.equal(isLogged(moved, 'b1i0s2'), false)
  assert.ok(isLogged(moved, 'b0i0s2'))
  assert.equal(moved.sets['b0i0s2'].weight, 155)
})

t('reindex is idempotent on an already-indexed prescription', () => {
  assert.deepEqual(reindex(legs), legs)
})

/* ------------------------------------------------- one run, several workouts
 *
 * Selecting several kinds of workout produces separate workouts on the plan,
 * not one pooled workout, so attached WHOOP and Strava activities each land on
 * the workout they belong to.
 */

const trip = (blocks) => normalizePrescription(
  { title: 'Gym trip', category: 'lift', activity: 'lift', minutes: 75, why: 'w', blocks },
  { liftField })

const lifting = (name, category, activity) => ({
  name, category, activity,
  items: [{ kind: 'lift', name: 'x', exercise: KNOWN, implement: 'barbell', sets: [{ reps: 5, weight: 100 }] }],
})

t('a block with its own category becomes its own workout', () => {
  const parts = splitPrescription(trip([
    lifting('Legs', 'lift', 'lift'),
    { name: 'Run home', category: 'run', activity: 'run',
      items: [{ kind: 'interval', name: '3 mi', unit: 'mi', sets: [{ distance: 3 }] }] },
  ]))
  assert.equal(parts.length, 2)
  assert.deepEqual(parts.map(p => p.category), ['lift', 'run'])
  assert.deepEqual(parts.map(p => p.activity), ['lift', 'run'])
  assert.deepEqual(parts.map(p => p.title), ['Legs', 'Run home'])
  // Each carries only its own work — that is the whole point, because each one
  // becomes an entry with its own `out.whoop` slot.
  assert.equal(parts[0].pres.blocks.length, 1)
  assert.equal(parts[1].pres.blocks.length, 1)
  // And each is re-indexed from zero, so set ids are unique within their entry.
  assert.equal(prescriptionSteps(parts[1].pres)[0].setId, 'b0i0s0')
})

t('consecutive blocks of the same category are ONE workout', () => {
  const parts = splitPrescription(trip([
    lifting('Squat', 'lift', 'lift'),
    lifting('Accessory', 'lift', 'lift'),
  ]))
  // A leg day with a main and an accessory block is one lift, not two.
  assert.equal(parts.length, 1)
  assert.equal(parts[0].pres.blocks.length, 2)
  assert.equal(parts[0].title, 'Gym trip', 'a single workout keeps the name he was shown')
})

t('a warm-up joins the workout ahead of it; a cool-down the one behind', () => {
  const parts = splitPrescription(trip([
    { name: 'Warm-up', note: 'five easy minutes', items: [] },
    lifting('Legs', 'lift', 'lift'),
    { name: 'Run home', category: 'run', activity: 'run',
      items: [{ kind: 'interval', name: '3 mi', unit: 'mi', sets: [{ distance: 3 }] }] },
    { name: 'Stretch', note: 'hips and calves', items: [] },
  ]))
  assert.equal(parts.length, 2)
  assert.deepEqual(parts[0].pres.blocks.map(b => b.name), ['Warm-up', 'Legs'])
  assert.deepEqual(parts[1].pres.blocks.map(b => b.name), ['Run home', 'Stretch'])
})

t('a plan where no block names a category does not split at all', () => {
  const one = splitPrescription(legs)
  assert.equal(one.length, 1)
  assert.equal(one[0].title, 'Legs')
  assert.equal(one[0].category, 'lift', 'it falls back to what the session itself said')
  // The ordinary single-kind case, which is most of them, is untouched.
  assert.equal(prescriptionSteps(one[0].pres).length, prescriptionSteps(legs).length)
})

t('the reasoning rides along with every part', () => {
  const parts = splitPrescription(trip([
    lifting('Legs', 'lift', 'lift'),
    lifting('Shoulders', 'push', 'lift'),
  ]))
  assert.equal(parts.length, 2)
  // Written about the whole trip, and half a paragraph reads worse than all of it.
  for (const p of parts) assert.equal(p.pres.why, 'w')
})

/* ------------------------------------------------------------ built by hand
 *
 * A workout can be built by hand from picked exercises as an alternative to the
 * AI-written route. The whole argument for the hand-built route being
 * cheap is that it produces the SAME object, so most of what is worth asserting
 * here is that nothing about it is special.
 */

t('a blank workout is one block per kind, each carrying its own quota', () => {
  const p = blankPrescription({
    title: 'Legs + Ride',
    category: 'lift',
    blocks: [
      { name: 'Legs', category: 'lift', activity: 'lift' },
      { name: 'Ride', category: 'bike', activity: 'bike' },
    ],
  })
  assert.equal(p.title, 'Legs + Ride')
  assert.deepEqual(p.blocks.map(b => b.name), ['Legs', 'Ride'])
  assert.deepEqual(p.blocks.map(b => b.category), ['lift', 'bike'])
  assert.equal(prescriptionSteps(p).length, 0)
  // Nobody reasoned about it and nothing wrote it, and no screen may claim either.
  assert.equal(p.why, '')
  assert.equal(p.model, null)
  // And the normaliser would have refused: a plan with no sets is not a workout.
  assert.equal(normalizePrescription({ title: 'Legs', blocks: [{ name: 'Legs', items: [] }] }), null)
})

t('a block he has not filled in yet survives editing the one he has', () => {
  let p = blankPrescription({
    blocks: [{ name: 'Legs', category: 'lift' }, { name: 'Core', category: 'support' }],
  })
  p = appendLift(p, liftField, KNOWN, { blockId: 'b0' })
  // Every edit anywhere runs through `mapItem`, which drops blocks that do not
  // survive. Without `keep`, typing the first weight deleted the core block.
  p = patchSet(p, 'b0i0', 'b0i0s0', { weight: 135 })
  assert.deepEqual(p.blocks.map(b => b.name), ['Legs', 'Core'])
  assert.equal(p.blocks[1].items.length, 0)
})

t('but an empty block is dropped on the way out, not kept on his day', () => {
  let p = blankPrescription({
    blocks: [{ name: 'Legs', category: 'lift' }, { name: 'Core', category: 'support' }],
  })
  p = appendLift(p, liftField, KNOWN, { blockId: 'b0' })
  const out = dropEmptyBlocks(p)
  assert.deepEqual(out.blocks.map(b => b.name), ['Legs'])
  // Otherwise the split would land a whole second entry with nothing in it.
  assert.equal(splitPrescription(out).length, 1)
  assert.equal(splitPrescription(p).length, 2, 'the guard is on the way out, not before')
})

t('a piece is an interval carrying only the number its shape names', () => {
  const base = blankPrescription({ blocks: [{ name: 'Ride', category: 'bike', activity: 'bike' }] })

  const timed = appendPiece(base, 'Easy spin', { blockId: 'b0', by: 'time' })
  const t1 = timed.blocks[0].items[0]
  assert.equal(t1.kind, 'interval')
  assert.equal(t1.name, 'Easy spin')
  assert.deepEqual(setFieldsFor(t1, t1.sets[0]), ['seconds'])

  const far = appendPiece(base, '400s', { blockId: 'b0', by: 'distance', unit: 'yd' })
  const t2 = far.blocks[0].items[0]
  assert.deepEqual(setFieldsFor(t2, t2.sets[0]), ['distance'])
  assert.equal(t2.sets[0].unit, 'yd', 'a distance with no unit is a number nobody can read')
  // It starts somewhere. "1 × 0 mi" reads as broken rather than as blank, and
  // this is the one screen where a number the user is about to change is a target.
  assert.equal(t2.sets[0].distance, 100)
  assert.equal(appendPiece(base, 'Tempo', { blockId: 'b0', by: 'distance' })
    .blocks[0].items[0].sets[0].distance, 1, 'a mile is not a hundred of anything')

  const many = appendPiece(base, 'Hollow hold', { blockId: 'b0', by: 'reps' })
  const t3 = many.blocks[0].items[0]
  assert.deepEqual(setFieldsFor(t3, t3.sets[0]), ['reps'])

  // A piece with no name is not a piece.
  assert.equal(appendPiece(base, '   ', { blockId: 'b0' }), base)
})

t('a hand-built session walks, splits and runs like any other', () => {
  let p = blankPrescription({
    title: 'Gym then home',
    blocks: [
      { name: 'Legs', category: 'lift', activity: 'lift' },
      { name: 'Row', category: 'run', activity: 'row' },
    ],
  })
  p = appendLift(p, liftField, KNOWN, { blockId: 'b0' })
  p = appendPiece(p, '2,000 m', { blockId: 'b1', by: 'time' })

  const steps = prescriptionSteps(p)
  assert.equal(steps.length, 2)
  assert.deepEqual(steps.map(s => s.itemName), [KNOWN_NAME, '2,000 m'])
  // Two categories, two entries — the seam is the block, not the author.
  const parts = splitPrescription(dropEmptyBlocks(p))
  assert.deepEqual(parts.map(x => x.category), ['lift', 'run'])
  // And the runner is offered, because one half of it is a clock.
  assert.equal(isLiftOnly(p), false)
})

/* ------------------------------------------------- what the weight means (#58) */

const BSS = 'bulgarian-split-squat'
const bssPlan = (item = {}) => normalizePrescription({
  title: 'Legs', blocks: [{ name: 'Main', items: [{
    kind: 'lift', exercise: BSS, implement: 'dumbbell', sets: [{ reps: 8, weight: 25 }], ...item,
  }] }],
}, { liftField })

t('weight mode: a plan item keeps a mode its implement has, and drops one it does not', () => {
  const one = bssPlan({ weightMode: 'one' }).blocks[0].items[0]
  assert.equal(one.weightMode, 'one')
  assert.equal(one.weightLabel, 'lb · one dumbbell')
  assert.equal(itemLine(one), '1 × 8 @ 25 lb · one dumbbell')
  const plain = bssPlan().blocks[0].items[0]
  assert.equal('weightMode' in plain, false, 'the default adds no key, so old plans normalise as before')
  assert.equal(plain.weightLabel, 'lb per hand')
  assert.equal('weightMode' in bssPlan({ weightMode: 'side' }).blocks[0].items[0], false)
  assert.equal('weightMode' in bssPlan({ implement: 'bodyweight', weightMode: 'one' }).blocks[0].items[0], false)
})

t('weight mode: an added lift starts in the mode it was last logged in', () => {
  const solo = { ...liftField, exercises: [...liftField.exercises, { key: 'solo', name: 'Solo', implements: ['dumbbell'] }] }
  const entries = [{ id: 'a', kind: 'daily', date: '2026-10-25', data: { out: { lifts: [{ uid: 'solo-1', key: 'solo', implement: 'dumbbell', weightMode: 'one', sets: [{ reps: 8, weight: 25 }] }] } } }]
  const p = appendLift(blankPrescription({ blocks: [{ name: 'Main' }] }), solo, 'solo', { entries })
  const item = p.blocks[0].items[0]
  assert.deepEqual([item.implement, item.weightMode, item.weightLabel], ['dumbbell', 'one', 'lb · one dumbbell'])
  const fresh = appendLift(blankPrescription({ blocks: [{ name: 'Main' }] }), solo, 'solo').blocks[0].items[0]
  assert.equal('weightMode' in fresh, false)
  assert.equal(fresh.weightLabel, 'lb per hand')
})

t('weight mode: a finished run logs the mode with the lift', () => {
  const p = bssPlan({ weightMode: 'one' })
  const step = prescriptionSteps(p)[0]
  const run = markSet(emptyRun(), step, { reps: 8, weight: 25 }, { at: 1000, steps: prescriptionSteps(p) })
  const [lift] = liftsIn(runOutputs(p, run))
  assert.deepEqual([lift.weightMode, lift.weightLabel], ['one', 'lb · one dumbbell'])
  const [plain] = liftsIn(runOutputs(bssPlan(), run))
  assert.equal('weightMode' in plain, false)
  // Switched on the plan mid-run (the runner patches the item).
  const switched = patchItem(bssPlan(), step.itemId, { weightMode: 'one', weightLabel: 'lb · one dumbbell' })
  assert.equal(liftsIn(runOutputs(switched, run))[0].weightMode, 'one')
})

t('weight mode, the rule: a revision keeps exactly what each kept exercise had; only new ones get memory', () => {
  const logged = { id: 'daily-2026-10-20', kind: 'daily', date: '2026-10-20', updatedAt: 'a',
    data: { out: { lifts: [{ uid: 'u1', key: BSS, implement: 'dumbbell', weightMode: 'one', weightLabel: 'lb · one dumbbell', sets: [{ reps: '8', weight: '25' }] }] } } }
  const opts = { today: '2026-10-21' }
  const two = (a = {}, b = {}) => normalizePrescription({ title: 'Legs', blocks: [{ name: 'Main', items: [
    { kind: 'lift', exercise: BSS, implement: 'dumbbell', sets: [{ reps: 8, weight: 25 }], ...a },
    { kind: 'lift', exercise: 'goblet-squat', implement: 'dumbbell', sets: [{ reps: 10, weight: 40 }], ...b },
  ] }] }, { liftField })
  // N2 (review of #60): memory says one dumbbell, the user switched the split
  // squat back to per hand on purpose. The model's revision must not undo that.
  const mine = two()
  const revised = reviseWeightModes(mine, two({ sets: [{ reps: 10, weight: 20 }] }), liftField, [logged], opts)
  assert.equal('weightMode' in revised.blocks[0].items[0], false, 'a deliberate default was overridden by memory')
  assert.equal(revised.blocks[0].items[0].weightLabel, 'lb per hand')
  assert.equal(revised.blocks[0].items[0].sets[0].reps, 10, 'the revision itself was lost')
  // A kept exercise with a mode keeps it, memory or not.
  const kept = reviseWeightModes(two({}, { weightMode: 'one' }), two(), liftField, [], opts)
  assert.equal(kept.blocks[0].items[1].weightMode, 'one')
  // New in the revision: memory. Moved to another implement: memory for that one.
  const grown = normalizePrescription({ title: 'Legs', blocks: [{ name: 'Main', items: [
    { kind: 'lift', exercise: 'goblet-squat', implement: 'dumbbell', sets: [{ reps: 10 }] },
    { kind: 'lift', exercise: BSS, implement: 'dumbbell', sets: [{ reps: 8 }] },
  ] }] }, { liftField })
  const onlyGoblet = normalizePrescription({ title: 'Legs', blocks: [{ name: 'Main', items: [
    { kind: 'lift', exercise: 'goblet-squat', implement: 'dumbbell', sets: [{ reps: 10 }] }] }] }, { liftField })
  const added = reviseWeightModes(onlyGoblet, grown, liftField, [logged], opts)
  assert.deepEqual(added.blocks[0].items.map(i => i.weightMode ?? null), [null, 'one'])
  const moved = reviseWeightModes(two({ implement: 'barbell', weightMode: 'side' }), two(), liftField, [logged], opts)
  assert.equal(moved.blocks[0].items[0].weightMode, 'one', 'off the bar, the dumbbell memory applies')
  // By uid where there are uids: a reordered exercise is still itself.
  const withUids = (items) => ({ ...mine, blocks: [{ ...mine.blocks[0], items }] })
  const [x, y] = mine.blocks[0].items
  const before = withUids([{ ...x, uid: 'A' }, { ...y, uid: 'B', weightMode: 'one' }])
  const after = withUids([{ ...y, uid: 'B' }, { ...x, uid: 'A' }])
  assert.deepEqual(reviseWeightModes(before, after, liftField, [logged], opts).blocks[0].items.map(i => i.weightMode ?? null), ['one', null])
  assert.equal(reviseWeightModes(mine, null, liftField), null)
})

t('weight mode: patchItem stores no mode for the default', () => {
  const p = bssPlan({ weightMode: 'one' })
  const back = patchItem(p, p.blocks[0].items[0].id, { weightMode: null, weightLabel: 'lb per hand' })
  assert.equal('weightMode' in back.blocks[0].items[0], false)
  assert.equal(back.blocks[0].items[0].weightLabel, 'lb per hand')
})

t('weight mode: switched in the runner after sets are logged, the log follows in the same write', () => {
  const p = normalizePrescription({ title: 'Legs', blocks: [{ name: 'Main', items: [
    { kind: 'lift', exercise: BSS, implement: 'dumbbell', sets: [{ reps: 8, weight: 25 }, { reps: 8, weight: 25 }] },
  ] }] }, { liftField })
  const steps = prescriptionSteps(p)
  const it = p.blocks[0].items[0]
  const one = { weightMode: 'one', weightLabel: 'lb · one dumbbell' }
  // Nothing logged yet: the plan only, the log untouched.
  assert.deepEqual(Object.keys(patchRunItem(p, emptyRun(), it.id, one, { rpe: 7 })), ['plan'])
  // Both sets logged in the default, then the label tapped after the last one.
  let run = markSet(emptyRun(), steps[0], { reps: 8, weight: 25 }, { at: 1000, steps })
  run = markSet(run, steps[1], { reps: 8, weight: 25 }, { at: 2000, steps })
  const before = runOutputs(p, run, { rpe: 7 })
  assert.equal(liftSummary(before.lifts[0]), '2 × 8 @ 25 lb')
  const w = patchRunItem(p, run, it.id, one, before, liftField)
  assert.equal(w.plan.blocks[0].items[0].weightMode, 'one')
  assert.deepEqual([w.out.lifts[0].weightMode, w.out.rpe], ['one', 7], 'the log kept the old meaning, or lost its other answers')
  assert.equal(liftSummary(w.out.lifts[0]), '2 × 8 @ 25 lb · one dumbbell')
})

t('weight mode: one value per exercise on a run entry, whichever side is switched (N1)', () => {
  const p = normalizePrescription({ title: 'Legs', blocks: [{ name: 'Main', items: [
    { kind: 'lift', exercise: BSS, implement: 'dumbbell', sets: [{ reps: 8, weight: 25 }] },
    { kind: 'lift', exercise: 'bench-press', implement: 'barbell', sets: [{ reps: 5, weight: 135 }] },
  ] }] }, { liftField })
  const steps = prescriptionSteps(p)
  let run = markSet(emptyRun(), steps[0], { reps: 8, weight: 25 }, { at: 1000, steps })
  run = markSet(run, steps[1], { reps: 5, weight: 135 }, { at: 2000, steps })
  const hand = { uid: 'curl-1', key: 'curl', name: 'Curl', implement: 'dumbbell', sets: [{ reps: 10, weight: 20 }] }
  const out = { ...runOutputs(p, run, { rpe: 7 }), notes: 'n' }
  out.lifts = [...out.lifts, hand]
  // A number corrected on the log after the run, which a rebuild would lose.
  out.lifts[0] = { ...out.lifts[0], sets: [{ reps: 9, weight: 25 }] }
  const data = { plan: p, run, out }
  const id = p.blocks[0].items[0].id
  // The sheet's plan editor switches the split squat: its logged row follows, nothing else moves.
  const sheet = followWeightModes(data, { ...data, plan: patchItem(p, id, { weightMode: 'one', weightLabel: 'lb · one dumbbell' }) }, liftField)
  assert.equal(sheet.out.lifts[0].weightMode, 'one')
  assert.equal(liftSummary(sheet.out.lifts[0], liftField), '1 × 9 @ 25 lb · one dumbbell', 'the corrected number was lost')
  assert.deepEqual([sheet.out.lifts[1], sheet.out.lifts[2], sheet.out.notes, sheet.out.rpe], [out.lifts[1], hand, 'n', 7])
  // The sheet's lift log switches it back: the plan item follows.
  const back = followWeightModes(sheet, { ...sheet, out: { ...sheet.out, lifts: sheet.out.lifts.map((l, i) => {
    if (i) return l
    const { weightMode: _m, ...rest } = l
    return { ...rest, weightLabel: 'lb per hand' }
  }) } }, liftField)
  assert.equal('weightMode' in back.plan.blocks[0].items[0], false)
  assert.equal(back.plan.blocks[0].items[0].weightLabel, 'lb per hand')
  // A write that switched neither leaves an old disagreement alone, and returns what it was given.
  const odd = { ...data, out: { ...out, lifts: [{ ...out.lifts[0], weightMode: 'one', weightLabel: 'lb · one dumbbell' }, ...out.lifts.slice(1)] } }
  const untouched = { ...odd, out: { ...odd.out, rpe: 8 } }
  assert.equal(followWeightModes(odd, untouched, liftField), untouched)
  // Nothing logged on it: nothing to follow.
  assert.equal(followWeightModes({ plan: p }, { plan: patchItem(p, id, { weightMode: 'one' }) }, liftField).out, undefined)
})

t('weight mode: an edit that moves items follows nothing; a row pairs only with the item it came from (#58 follow-up)', () => {
  const rows = (data) => data.out.lifts.map(l => `${l.uid}:${l.weightMode || '-'}`)
  const ran = (names) => {
    const p = normalizePrescription({ title: 'Legs', blocks: [{ name: 'Main', items: [
      { kind: 'lift', exercise: BSS, name: names[0], implement: 'dumbbell', weightMode: 'one', sets: [{ reps: 8, weight: 25 }] },
      { kind: 'lift', exercise: BSS, name: names[1], implement: 'dumbbell', sets: [{ reps: 12, weight: 15 }] },
    ] }] }, { liftField })
    const [a, b] = p.blocks[0].items
    const run = { sets: { [a.sets[0].id]: { reps: 8, weight: 25 }, [b.sets[0].id]: { reps: 12, weight: 15 } } }
    return { plan: p, run, out: runOutputs(p, run, {}) }
  }
  // Review repro: the split squat in one dumbbell, a back-off in the default; the first is deleted on the sheet.
  for (const names of [['Split squat', 'Split squat (back-off)'], ['Split squat', 'Split squat']]) {
    const data = ran(names)
    assert.deepEqual(rows(data), ['b0i0:one', 'b0i1:-'])
    const gone = followWeightModes(data, { ...data, plan: removeItem(data.plan, 'b0i0') }, liftField)
    assert.deepEqual(rows(gone), ['b0i0:one', 'b0i1:-'], `deleting the first of ${names.join(' / ')} rewrote a logged row`)
    // Moved instead of deleted: the same.
    const moved = followWeightModes(data, { ...data, plan: moveItem(data.plan, 'b0i1', 'up').pres }, liftField)
    assert.deepEqual(rows(moved), ['b0i0:one', 'b0i1:-'], 'a reorder rewrote a logged row')
  }
  // After the deletion, switching the back-off (now at b0i0) does not reach the
  // first item's row, which no longer has an item.
  const data = ran(['Split squat', 'Split squat (back-off)'])
  const after = { ...data, plan: removeItem(data.plan, 'b0i0') }
  const switched = followWeightModes(after, { ...after, plan: patchItem(after.plan, 'b0i0', { weightMode: 'one', weightLabel: 'lb · one dumbbell' }) }, liftField)
  assert.deepEqual(rows(switched), ['b0i0:one', 'b0i1:-'])
  const back = followWeightModes(after, { ...after, plan: patchItem(after.plan, 'b0i0', { weightMode: null, weightLabel: 'lb per hand' }) }, liftField)
  assert.deepEqual(rows(back), ['b0i0:one', 'b0i1:-'], "the back-off's switch reached the deleted item's row")
  // And a plain switch on an unmoved plan still follows.
  const plain = followWeightModes(data, { ...data, plan: patchItem(data.plan, 'b0i1', { weightMode: 'one', weightLabel: 'lb · one dumbbell' }) }, liftField)
  assert.deepEqual(rows(plain), ['b0i0:one', 'b0i1:one'])
})

console.log(`prescription: ${pass} checks passed`)
