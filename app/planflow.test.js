// Plan a workout as state (#78): the reducer and rules in src/lib/planflow.js that
// the web's and the phone's PlanFlow both run, and the names, days and durations
// a plan lands with. Bundled by esbuild (the lib imports a .jsx hook) and run in node.
import assert from 'node:assert/strict'
import {
  initialFlow, flowReducer, backOf, flowTitle, planDay, dayPhrase, dayBounds, hasWork, blankFor, workTitle, shortLine, firstStep, filedFor,
  needsFiling, fileChoices, unkeptWork, keptStart, leaver,
} from './src/lib/planflow.js'
import { BigStepper } from './src/runner.jsx'
import { Stepper, boxFor, stepBox } from './src/exercises.jsx'
import { createRequire } from 'node:module'
import { liftFieldOf } from './src/lib/lifts.js'

const PLAN = createRequire(import.meta.url)('../test/fixtures/plan.json')
import {
  splitPrescription, blankPrescription, appendPiece, durationWords, timeBox, bumpTime, itemLine, genericBlockName,
} from './src/lib/prescription.js'
import { minutesText, acceptMinutesText } from './src/lib/numtext.js'
import { forWords } from './src/lib/trainer.js'
import { plannerContext, groupContext } from './src/lib/plannerapi.js'

const tests = []
const test = (name, fn) => tests.push([name, fn])
const run = (state, ...actions) => actions.reduce(flowReducer, state)

const LEGS = { key: 'legs', label: 'Legs', category: 'lift', activity: 'lift', group: 'lift', hint: 'squat, hinge' }
const RIDE = { key: 'bike', label: 'Ride', category: 'bike', activity: 'bike', group: 'bike' }
const squat = { id: 'x', kind: 'lift', name: 'Back squat', exercise: 'back-squat', group: 'Quads', sets: [{ id: 's', reps: 5 }] }
const withItem = (pres, item = squat, at = 0) => ({
  ...pres, blocks: pres.blocks.map((b, i) => (i === at ? { ...b, items: [...b.items, item] } : b)),
})

/* ------------------------------------------------------------ the routes */

test('with the model the flow opens on the ask; without it, on the builder, empty and ready', () => {
  const on = initialFlow({ ai: true, date: '2026-11-08' })
  assert.equal(on.step, 'start')
  assert.equal(on.pres, null)
  const off = initialFlow({ ai: false, date: '2026-11-08' })
  assert.equal(off.step, 'build')
  assert.equal(off.pres.blocks.length, 1, 'no kind is needed to start building')
  assert.equal(off.pres.blocks[0].items.length, 0)
  assert.equal(firstStep(off), 'build')
})

test('Build it myself from the ask needs no kind, and takes the kinds picked as blocks, in order', () => {
  const empty = run(initialFlow({ ai: true }), { type: 'build' })
  assert.equal(empty.step, 'build')
  assert.equal(empty.pres.blocks.length, 1)
  const two = run(initialFlow({ ai: true }), { type: 'picked', picked: [RIDE, LEGS] }, { type: 'build' })
  assert.deepEqual(two.pres.blocks.map(b => b.name), ['Ride', 'Legs'])
  assert.deepEqual(two.pres.blocks.map(b => b.category), ['bike', 'lift'])
  assert.equal(two.pres.title, 'Ride + Legs')
})

test('in the builder, kinds shape it only while it is empty', () => {
  const s = run(initialFlow({ ai: false }), { type: 'picked', picked: [LEGS, RIDE] })
  assert.deepEqual(s.pres.blocks.map(b => b.name), ['Legs', 'Ride'], 'Start from did not make the blocks')
  const worked = run(s, { type: 'pres', pres: withItem(s.pres) }, { type: 'picked', picked: [RIDE] })
  assert.deepEqual(worked.pres.blocks.map(b => b.name), ['Legs', 'Ride'], 'a pick replaced blocks with work in them')
  assert.equal(worked.pres.blocks[0].items.length, 1)
})

test('the model refused: the builder, from the same picks, and the model is no longer offered', () => {
  const s = run(initialFlow({ ai: true }), { type: 'picked', picked: [LEGS] }, { type: 'run' }, { type: 'refused' })
  assert.equal(s.step, 'build')
  assert.equal(s.ai, false)
  assert.deepEqual(s.pres.blocks.map(b => b.name), ['Legs'])
  assert.equal(firstStep(s), 'build')
})

/* ------------------------------------------------------------------ back */

test('Back from the builder keeps the work: set aside, and Build it myself reopens it as it was (G F6)', () => {
  const built = run(initialFlow({ ai: true }), { type: 'build' })
  const worked = run(built, { type: 'pres', pres: withItem(built.pres) })
  assert.deepEqual(backOf(worked), { to: 'start', scratch: worked.pres })
  const back = run(worked, { type: 'back' })
  assert.equal(back.step, 'start')
  assert.equal(back.scratch, worked.pres)
  const again = run(back, { type: 'build' })
  assert.equal(again.step, 'build')
  assert.equal(again.pres, worked.pres, 'the workout set aside was not the one reopened')
  assert.equal(again.scratch, null)
  // Nothing in it: nothing is set aside.
  assert.equal(run(built, { type: 'back' }).scratch, null)
})

test('Back from the builder as the first screen closes, and asks only when there is work to lose', () => {
  const empty = initialFlow({ ai: false })
  assert.deepEqual(backOf(empty), { close: true, confirm: false })
  const worked = run(empty, { type: 'pres', pres: withItem(empty.pres) })
  assert.deepEqual(backOf(worked), { close: true, confirm: true })
  assert.equal(run(worked, { type: 'back' }), worked, 'Back changed the state when it should only close')
})

test('Back, Back never loses a workout set aside: every close with unkept work asks (review fix 1)', () => {
  const built = run(initialFlow({ ai: true }), { type: 'build' })
  const set = run(built, { type: 'pres', pres: withItem(built.pres) }, { type: 'back' })
  assert.equal(set.step, 'start')
  assert.deepEqual(backOf(set), { close: true, confirm: true }, 'Back on the ask closed over a workout set aside')
  assert.equal(unkeptWork(set), true)
  // Written for me and reviewed with one set aside: closing the review asks too.
  const review = { ...set, step: 'review', pres: blankPrescription({ title: 'Legs' }) }
  assert.deepEqual(backOf(review), { close: true, confirm: true })
  // Kept another one: the set-aside workout is still there, and Plan another keeps it.
  const kept = run(set, { type: 'kept', pres: { title: 'x', blocks: [] }, kept: { first: 'e' }, who: { me: true, others: [] } })
  assert.equal(unkeptWork(kept), true, 'closing the last screen would drop the workout set aside')
  const again = run(kept, { type: 'another' })
  assert.equal(again.scratch, set.scratch, 'Plan another dropped the workout set aside')
  // Nothing set aside, nothing to ask.
  assert.deepEqual(backOf(run(initialFlow({ ai: true }), { type: 'build' }, { type: 'back' })), { close: true, confirm: false })
})

test('the kept screen\'s Start leaves through the same confirm: a workout set aside is never lost (round 2, fix 1)', async () => {
  const built = run(initialFlow({ ai: true, date: '2026-11-08' }), { type: 'build' })
  const aside = run(built, { type: 'pres', pres: withItem(built.pres) }, { type: 'back' })
  const keptFor = (who) => run(aside, { type: 'kept', pres: { title: 'Legs', blocks: [] }, kept: { first: 'daily-2026-11-08' }, who })
  const me = keptFor({ me: true, others: [] })
  const sam = keptFor({ me: false, others: [{ id: 'sam', name: 'Sam' }] })
  for (const [state, key] of [[me, 'onStart'], [sam, 'onStartFor']]) {
    const opened = []
    const go = { onStart: (id) => opened.push(id), onStartFor: (p, id) => opened.push(`${p.id}:${id}`) }
    const asked = []
    const refuse = keptStart(state.kept, '2026-11-08', { ...go, leave: leaver(state, (m) => { asked.push(m); return false }) })
    await refuse.run()
    assert.equal(asked.length, 1, `${key} did not ask before dropping the workout set aside`)
    assert.deepEqual(opened, [], `${key} left although the user said no`)
    await keptStart(state.kept, '2026-11-08', { ...go, leave: leaver(state, async () => true) }).run()
    assert.equal(opened.length, 1, `${key} did not open after the user said yes`)
  }
  assert.equal(keptStart(sam.kept, '2026-11-08', { onStartFor: () => {} }).label, 'Open it on Sam’s side')
  // Nothing set aside: Start goes straight there, no question.
  const plain = run(initialFlow({ ai: true, date: '2026-11-08' }), { type: 'kept', pres: { blocks: [] }, kept: { first: 'e' }, who: { me: true, others: [] } })
  let asked = 0
  const opened = []
  await keptStart(plain.kept, '2026-11-08', { onStart: (id) => opened.push(id), leave: leaver(plain, () => { asked++; return false }) }).run()
  assert.deepEqual([asked, opened], [0, ['e']])
  // A later day has nothing to start.
  assert.equal(keptStart({ ...plain.kept, date: '2026-11-09' }, '2026-11-08', { onStart: () => {} }), null)
})

test('Back from the wait or a failure goes to the first screen and lets go of the draft', () => {
  const draft = { id: 'd1aaaaaa', status: 'working', updatedAt: '2026-11-08T10:00:00Z', run: { kind: 'plan' } }
  const working = run(initialFlow({ ai: true }), { type: 'run' }, { type: 'drafted', draft })
  assert.equal(working.draftId, 'd1aaaaaa')
  const back = run(working, { type: 'back' })
  assert.equal(back.step, 'start')
  assert.equal(back.draftId, null)
  const failed = run(working, { type: 'failed', error: 'box busy' }, { type: 'back' })
  assert.equal(failed.step, 'start')
  // Change the ask keeps the draft open, so the next run replaces it.
  assert.equal(run(working, { type: 'failed', error: 'x' }, { type: 'toFirst' }).draftId, 'd1aaaaaa')
})

test('a reopened draft lands on the day it was asked for, never one that has passed (review fix 2)', () => {
  const draft = (day) => ({ id: 'd3aaaaaa', status: 'working', ask: { minutes: 30, goal: 'easy', ...(day ? { day } : {}) }, run: { kind: 'plan' } })
  const at = initialFlow({ ai: true, date: '2026-11-08' })
  assert.equal(run(at, { type: 'resume', draft: draft('2026-11-10'), today: '2026-11-08' }).date, '2026-11-10')
  assert.equal(run(at, { type: 'resume', draft: draft('2026-11-05'), today: '2026-11-08' }).date, '2026-11-08', 'a past day came back')
  assert.equal(run({ ...at, date: '2026-11-09' }, { type: 'resume', draft: draft(null), today: '2026-11-08' }).date, '2026-11-09',
    'a draft from before #78 moved the day chosen')
})

test('a draft with nothing in it reads as failed, with a reason', () => {
  const s = run(initialFlow({ ai: true }), { type: 'enter', draft: { id: 'd2aaaaaa', status: 'ready', pres: { blocks: [] } }, liftField: null })
  assert.equal(s.step, 'failed')
  assert.match(s.error, /nothing in it/)
})

/* ------------------------------------------------------------------- day */

test('the day: the one Today shows if it is today or later, else today; never before today', () => {
  assert.equal(planDay('2026-11-09', '2026-11-08'), '2026-11-09')
  assert.equal(planDay('2026-11-06', '2026-11-08'), '2026-11-08', 'a past day was planned for')
  assert.equal(planDay(null, '2026-11-08'), '2026-11-08')
  assert.equal(dayBounds('2026-11-08').min, '2026-11-08')
  assert.equal(dayPhrase('2026-11-08', '2026-11-08'), 'today')
  assert.equal(dayPhrase('2026-11-09', '2026-11-08'), 'tomorrow')
  assert.doesNotMatch(dayPhrase('2026-11-12', '2026-11-08'), /^(today|tomorrow)$/)
})

test('the keep button and the last screen say the day', () => {
  assert.equal(forWords({ me: true, others: [] }).keep, 'Put it on today', 'the default changed')
  assert.equal(forWords({ me: true, others: [] }, 'tomorrow').keep, 'Put it on tomorrow')
  assert.equal(forWords({ me: true, others: [] }, 'tomorrow').where, 'on tomorrow')
  assert.equal(forWords({ me: true, others: [{ id: 'sam', name: 'Sam' }] }, 'tomorrow').keep, 'Put it on tomorrow with Sam')
  assert.equal(forWords({ me: false, others: [{ id: 'sam', name: 'Sam' }] }, 'tomorrow').keep, 'Put it on Sam’s day, tomorrow')
  assert.equal(forWords({ me: false, others: [{ id: 'sam', name: 'Sam' }] }).keep, 'Put it on Sam’s day')
  const kept = run(initialFlow({ ai: false, date: '2026-11-09' }), { type: 'kept', kept: { first: 'daily-2026-11-09', count: 1 }, who: { me: true, others: [] } })
  assert.equal(kept.kept.date, '2026-11-09', 'the last screen does not know which day it landed on')
  const named = run(initialFlow({ ai: false }), { type: 'kept', pres: { title: 'Zone 2 ride', blocks: [] }, kept: { first: 'x' }, who: { me: true, others: [] } })
  assert.equal(named.pres.title, 'Zone 2 ride', 'the last screen names the workout differently from the day')
  assert.equal(flowTitle(kept, null, '2026-11-08'), 'On tomorrow', 'the last screen does not name the day (review fix 6)')
  assert.equal(forWords({ me: true, others: [] }).title, 'On today')
  assert.equal(forWords({ me: false, others: [{ id: 'sam', name: 'Sam' }] }, 'Tue, Nov 10').title, 'On Sam’s day, Tue, Nov 10')
})

test('a plan for a later day tells the model which day it is for', () => {
  assert.match(plannerContext({ iso: '2026-11-08', day: '2026-11-09' }), /This workout is for 2026-11-09\./)
  assert.doesNotMatch(plannerContext({ iso: '2026-11-08', day: '2026-11-08' }), /This workout is for/)
  assert.doesNotMatch(plannerContext({ iso: '2026-11-08' }), /This workout is for/)
  assert.match(groupContext({ iso: '2026-11-08', day: '2026-11-10', people: [] }), /This workout is for 2026-11-10\./)
})

test('Plan another keeps who and when, and clears the ask', () => {
  const s = run(initialFlow({ ai: true, date: '2026-11-09' }),
    { type: 'who', who: { me: true, others: [{ id: 'sam', name: 'Sam' }] } },
    { type: 'goal', goal: 'legs' }, { type: 'picked', picked: [LEGS] }, { type: 'another' })
  assert.equal(s.date, '2026-11-09')
  assert.equal(s.who.others[0].id, 'sam')
  assert.equal(s.goal, '')
  assert.deepEqual(s.picked, [])
  assert.equal(s.step, 'start')
})

/* ----------------------------------------------------------------- names */

test('a workout built with no kind is named from what is in it', () => {
  const blank = blankFor([])
  assert.equal(workTitle(blank), 'Workout')
  assert.equal(workTitle(withItem(blank)), 'Quads')
  const two = withItem(withItem(blank), { ...squat, id: 'y', group: 'Chest' })
  assert.equal(workTitle(two), 'Quads and chest')
  const three = withItem(two, { ...squat, id: 'z', group: 'Core' })
  assert.equal(workTitle(three), 'Quads, chest and more')
  assert.equal(workTitle(appendPiece(blank, 'Easy spin', { by: 'time' })), 'Easy spin')
  assert.equal(workTitle({ ...two, title: 'Legs' }), 'Legs', 'a title someone gave was replaced')
  assert.equal(flowTitle({ ...initialFlow({ ai: false }), pres: two }), 'Quads and chest')
})

test('the header line is short: exercises and minutes, no sets or rounds', () => {
  const pres = { minutes: 50, blocks: [{ items: [squat, squat, squat] }, { circuit: { rounds: 3 }, items: [squat, squat] }] }
  assert.equal(shortLine(pres), '5 exercises · about 50 min')
  assert.equal(shortLine(null), '')
  assert.equal(hasWork(blankFor([])), false)
  assert.equal(hasWork(withItem(blankFor([]))), true)
})

test('split parts are named from the workout, not "Main" (C F6)', () => {
  const pres = {
    title: 'Legs and a short run',
    blocks: [
      { id: 'b0', name: 'Warm-up', category: null, items: [] , note: 'easy' },
      { id: 'b1', name: 'Main', category: 'lift', items: [squat] },
      { id: 'b2', name: 'Easy run', category: 'run', items: [{ ...squat, kind: 'interval', name: 'Run' }] },
    ],
  }
  assert.deepEqual(splitPrescription(pres).map(p => p.title), ['Legs and a short run', 'Easy run'])
  assert.equal(splitPrescription(pres)[0].pres.title, 'Legs and a short run')
  // Two generic parts never share a name on the day.
  const twice = { ...pres, blocks: [pres.blocks[1], { ...pres.blocks[2], name: 'Block 2' }] }
  assert.deepEqual(splitPrescription(twice).map(p => p.title), ['Legs and a short run', 'Legs and a short run · 2'])
  // A descriptive block name stands: the hand-built route's kinds name their parts.
  const byHand = blankPrescription({ title: 'Legs + Ride', blocks: [{ name: 'Legs', category: 'lift' }, { name: 'Ride', category: 'bike' }] })
  const filled = withItem(withItem(byHand), { ...squat, id: 'r', kind: 'interval', name: 'Spin' }, 1)
  assert.deepEqual(splitPrescription(filled).map(p => p.title), ['Legs', 'Ride'])
  // One part is the whole workout, title and all, as before.
  assert.equal(splitPrescription({ ...pres, blocks: [pres.blocks[1]] })[0].title, 'Legs and a short run')
  for (const n of ['Main', 'main lifts', 'Block 3', 'Accessory', '', 'lift']) assert.ok(genericBlockName(n, 'lift'), n)
  for (const n of ['Easy run', 'Squat and hinge', 'Pull']) assert.ok(!genericBlockName(n, 'lift'), n)
})

test('a workout built with no kind is still filed: lifts go under the lifting activity', () => {
  const liftField = liftFieldOf(PLAN)
  const filed = filedFor(withItem(blankFor([])), PLAN, liftField)
  assert.equal(filed.activity, 'lift', 'a hand-built lift workout landed filed under nothing')
  assert.equal(filed.category, 'lift')
  // A category anywhere is the user's (or the kind's), and a workout of pieces is left alone.
  const legs = blankFor([LEGS])
  assert.equal(filedFor(withItem(legs), PLAN, liftField).category, 'lift')
  const pieces = appendPiece(blankFor([]), 'Easy spin', { by: 'time' })
  assert.equal(filedFor(pieces, PLAN, liftField), pieces)
})

test('a hand-built workout of pieces is filed from a block\'s sport, else from "What is it?" (review fix 3)', () => {
  const liftField = liftFieldOf(PLAN)
  const spin = appendPiece(blankFor([]), 'Easy spin', { by: 'time' })
  assert.equal(needsFiling(spin, PLAN, liftField), true, 'a ride by hand is not asked what it is')
  assert.equal(needsFiling(blankFor([]), PLAN, liftField), false, 'an empty builder asks')
  assert.equal(needsFiling(withItem(blankFor([])), PLAN, liftField), false, 'a lift workout is asked though its lifts file it')
  // Picked on the keep step: filed as picked.
  const picked = filedFor(spin, PLAN, liftField, 'bike')
  assert.equal(picked.activity, 'bike')
  assert.equal(picked.category, 'bike')
  // A block that already names its sport files it, no question.
  const onBlock = { ...spin, blocks: [{ ...spin.blocks[0], activity: 'run' }] }
  assert.equal(needsFiling(onBlock, PLAN, liftField), false)
  assert.equal(filedFor(onBlock, PLAN, liftField).category, 'run')
  // Nothing said and nothing picked: as it was.
  assert.equal(filedFor(spin, PLAN, liftField), spin)
  // The row: the catalog's pinned sports first, the rest grouped behind Other….
  const c = fileChoices(PLAN)
  assert.deepEqual(c.pinned.map(a => a.key), ['run', 'treadmill-run', 'bike', 'mtb', 'swim', 'lift'])
  assert.ok(c.groups.every(g => g.items.every(a => !a.pinned)), 'a pinned sport is offered twice')
  assert.equal(c.nameOf('rowing'), 'Rowing')
})

/* ------------------------------------------------------------- durations */

test('a timed piece reads in minutes and starts at ten (C F10)', () => {
  assert.equal(durationWords(45), '45 s')
  assert.equal(durationWords(900), '15 min')
  assert.equal(durationWords(90), '1:30')
  assert.equal(durationWords(2700), '45 min')
  const piece = appendPiece(blankFor([]), 'Easy run', { by: 'time' }).blocks[0].items[0]
  assert.equal(piece.sets[0].seconds, 600)
  assert.equal(itemLine({ ...piece, sets: [{ ...piece.sets[0], seconds: 900 }] }), '1 × 15 min')
  assert.doesNotMatch(itemLine({ ...piece, sets: [{ ...piece.sets[0], seconds: 900 }] }), /900/)
})

test('a piece\'s box is always minutes, whatever its value; a hold stays in seconds (review fix 5)', () => {
  const piece = { kind: 'interval' }
  for (const secs of [null, 30, 100, 600, 2700]) {
    assert.deepEqual(timeBox(piece, { seconds: secs }), { label: 'min', step: 1, time: true }, `${secs} s flipped units`)
  }
  assert.equal(timeBox({ kind: 'lift' }, { seconds: 600 }).label, 'sec', 'a plank became minutes')
  assert.equal(timeBox({ kind: 'lift' }, { seconds: 600 }).time, false)
  // Steps land on the next mark (round 2, fix 2): 5 s under a minute, a minute under ten, five from there.
  const marks = [
    [7, 1, 10], [7, -1, 5], [0, -1, 0], [null, 1, 5], [55, 1, 60], [60, -1, 55],
    [100, 1, 120], [100, -1, 60], [540, 1, 600], [600, 1, 900], [600, -1, 540],
    [630, 1, 900], [630, -1, 600], [2700, -1, 2400],
  ]
  for (const [from, d, to] of marks) assert.equal(bumpTime(from, d), to, `${from} s ${d > 0 ? 'up' : 'down'}`)
  // A 45-minute ride from the default ten: seven presses.
  let secs = 600
  let taps = 0
  while (secs < 2700) { secs = bumpTime(secs, 1); taps++ }
  assert.equal(secs, 2700)
  assert.ok(taps <= 7, `${taps} taps to 45 minutes`)
})

/* Find the button whose aria-label is `label` in a component's element tree, without a DOM. */
const pressOf = (el, label) => {
  if (!el || typeof el !== 'object') return null
  if (Array.isArray(el)) { for (const c of el) { const f = pressOf(c, label); if (f) return f } return null }
  if (el.props?.['aria-label'] === label && el.props.onClick) return el.props.onClick
  return pressOf(el.props?.children, label)
}

test('the runner\'s and the editor\'s ± on a timed piece step minutes to the marks (round 2, fix 3)', () => {
  const piece = { kind: 'interval', name: 'Zone 2 ride' }
  for (const [name, C] of [['runner BigStepper', BigStepper], ['editor Stepper', Stepper]]) {
    const press = (secs, label) => {
      const got = []
      const el = C({ ...boxFor('seconds', piece, { seconds: secs }), value: secs, onChange: (v) => got.push(v) })
      pressOf(el, label)()
      return got[0]
    }
    assert.equal(press(2700, 'more min'), 3000, `${name}: 45 min + is not 50 min`)
    assert.equal(press(2700, 'less min'), 2400, `${name}: 45 min − is not 40 min`)
    assert.equal(press(100, 'more min'), 120, `${name}: 1:40 + is not 2:00`)
    assert.equal(press(7, 'less min'), 5, `${name}: 0:07 − is not 0:05`)
  }
  // A plank stays seconds, by fives.
  const hold = boxFor('seconds', { kind: 'lift' }, { seconds: 45 })
  assert.equal(stepBox(hold, 45, 1), 50)
  assert.equal(hold.label, 'sec')
})

test('the minutes box reads m:ss and takes "45", "1.5" and "1:40"', () => {
  assert.equal(minutesText(2700), '45')
  assert.equal(minutesText(100), '1:40')
  assert.equal(minutesText(30), '0:30')
  assert.equal(minutesText(null), '')
  assert.deepEqual(acceptMinutesText('45'), { text: '45', emit: true, value: 2700 })
  assert.deepEqual(acceptMinutesText('1.5'), { text: '1.5', emit: true, value: 90 })
  assert.deepEqual(acceptMinutesText('1:40'), { text: '1:40', emit: true, value: 100 })
  assert.equal(acceptMinutesText('1:4').emit, false, 'a half-typed time moved the value')
  assert.equal(acceptMinutesText('1:75'), null)
  assert.equal(acceptMinutesText('abc'), null)
  assert.deepEqual(acceptMinutesText(''), { text: '', emit: true, value: null })
})

let failed = 0
for (const [name, fn] of tests) {
  try { await fn(); console.log('  PASS ', name) } catch (e) { failed++; console.log('  FAIL ', name, '\n        ', e.message) }
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
console.log(`planflow: ${tests.length} passed`)
