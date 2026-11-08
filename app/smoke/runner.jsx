/* Smoke cases: the runner: a planned session set by set.
 * Run by app/smoke/index.jsx (`npm run smoke`); moved out of app/smoke.jsx in #73,
 * unchanged and in their old relative order. A case is [name, element | null, assert?].
 */
import { renderToString } from 'react-dom/server'
import { WorkoutRunner } from '../src/runner.jsx'
import { normalizePrescription } from '../src/lib/prescription.js'
import { PlanProvider } from '../src/lib/planctx.jsx'
import { liftFieldOf } from '../src/lib/lifts.js'
import {
  plan, entries, noop, TODAY, back, rich, text, LIFT_FIELD, PLANNED_CARD, PLANNED_ENTRY,
  HELD_PLAN, HELD_ENTRY, RESTING_RUN,
} from './fixtures.jsx'

export default [
  /* A hold in the runner: the set is seconds, the target says so, the name explains it. */
  ['WorkoutRunner(a hold: the set is seconds, and the name opens what it is)', <PlanProvider plan={HELD_PLAN}><WorkoutRunner session={PLANNED_CARD}
    entry={HELD_ENTRY} entries={[]} onRun={noop} onExit={noop} /></PlanProvider>,
    html => {
      const t = text(html)
      if (!/class="bigstep-in"/.test(html)) throw new Error('the set screen did not render, so this proves nothing')
      if (!/aria-label="less sec"/.test(html) || /aria-label="less reps"/.test(html)) throw new Error('the hold is not asked in seconds')
      if (!/Planned.*45 s/.test(t)) throw new Error('the target is not in seconds')
      if (!/3 × 45 s/.test(t)) throw new Error('the set line is not "3 × 45 s"')
      if (!/<button[^>]*class="run-moveabout"[^>]*aria-label="Plank: how to do it"/.test(html)) throw new Error('the runner\'s name does not open the sheet')
    }],
  ['WorkoutRunner(first set)', <WorkoutRunner session={PLANNED_CARD} entry={PLANNED_ENTRY}
    entries={rich} onRun={noop} onExit={noop} />,
    (html) => {
      const t = text(html)
      if (!/Done set/.test(t)) throw new Error('no way to mark the set he is on')
      // One primary on the screen (docs/DESIGN.md D7), and the old label is gone.
      if (/Mark set \d/.test(t)) throw new Error('"Mark set N" is back; the primary is "Done set"')
      if ((html.match(/class="btn big run-done"/g) || []).length !== 1) throw new Error('not exactly one primary')
      if (!/Planned/.test(t)) throw new Error('the target is not on screen')
      if (/run-target-label|text-transform/.test(html)) throw new Error('the target is a small-caps label again')
      // The two things that make it usable one-handed.
      if (!/class="bigstep-in"/.test(html)) throw new Error('the numbers are not thumb-sized')
      if (!/run-done/.test(html)) throw new Error('the mark button is not the big one')
      // "If you add another set, you have to type in the weight every single time."
      // The runner has to offer one more set of this, and the box has to take a
      // decimal — a number input would eat the dot in "37.5".
      if (!/One more set of/.test(html)) throw new Error('no way to add a set from the runner')
      if (!/class="bigstep-in"[^>]*type="text"|type="text"[^>]*class="bigstep-in"/.test(html)) {
        throw new Error('the weight box is not a text box, so a decimal point will not survive typing')
      }
    }],
  /* The runner has the same switch, a full 44px, on the plan item (#58). */
  ['WorkoutRunner(a dumbbell lift: the weight label is the switch)', <PlanProvider plan={plan}><WorkoutRunner session={PLANNED_CARD}
    entry={{ ...PLANNED_ENTRY, data: { ...PLANNED_ENTRY.data, plan: normalizePrescription({
      title: 'Legs', blocks: [{ name: 'Main', items: [{ kind: 'lift', exercise: 'bulgarian-split-squat', implement: 'dumbbell',
        weightMode: 'one', sets: [{ reps: 8, weight: 25 }] }] }],
    }, { liftField: liftFieldOf(plan) }) } }}
    entries={rich} onRun={noop} onExit={noop} /></PlanProvider>,
    (html) => {
      if (!/<button[^>]*class="bigstep-label stepper-swap"/.test(html)) throw new Error('the runner has no weight switch')
      if (!/Switch to lb per hand/.test(html)) throw new Error('the runner switch does not say what a tap does')
      const box = (html.match(/class="bigstep-label stepper-swap"[^>]*>(.*?)<\/button>/) || [])[1] || ''
      if (box.replace(/<[^>]+>/g, '').replace(/<!--.*?-->/g, '').trim() !== '1 DB') throw new Error(`the runner's box says "${box.replace(/<[^>]+>/g, '').replace(/<!--.*?-->/g, '').trim()}"`)
      if (!/25 lb · one dumbbell/.test(text(html))) throw new Error('the target does not say one dumbbell')
    }],
  ['WorkoutRunner(a machine lift: no switch)', <PlanProvider plan={plan}><WorkoutRunner session={PLANNED_CARD}
    entry={{ ...PLANNED_ENTRY, data: { ...PLANNED_ENTRY.data, plan: normalizePrescription({
      title: 'Legs', blocks: [{ name: 'Main', items: [{ kind: 'lift', exercise: 'leg-extension', implement: 'machine',
        sets: [{ reps: 12, weight: 90 }] }] }],
    }, { liftField: liftFieldOf(plan) }) } }}
    entries={rich} onRun={noop} onExit={noop} /></PlanProvider>,
    (html) => {
      if (!/class="bigstep-in"/.test(html)) throw new Error('the set screen did not render, so this proves nothing')
      if (/stepper-swap|Switch to/.test(html)) throw new Error('a machine lift grew a weight switch in the runner')
    }],
  ['WorkoutRunner(resting)', <WorkoutRunner session={PLANNED_CARD}
    entry={{ ...PLANNED_ENTRY, data: { ...PLANNED_ENTRY.data, run: RESTING_RUN } }}
    entries={rich} onRun={noop} onExit={noop} />,
    (html) => {
      const t = text(html)
      if (!/rest/i.test(t)) throw new Error('a rest does not say it is one')
      if (!/Next:/.test(t)) throw new Error('the rest screen does not say what is coming')
      if (/class="btn big run-done"/.test(html)) throw new Error('a primary on the rest screen; skipping the rest is the quiet one')
    }],
  ['WorkoutRunner(no plan on the entry)', <WorkoutRunner session={PLANNED_CARD}
    entry={{ id: 'x', kind: 'daily', date: TODAY, data: { optId: 'planned', out: {} } }}
    entries={[]} onRun={noop} onExit={noop} />,
    (html) => {
      if (!/no plan on it/.test(text(html))) throw new Error('an empty runner should say so, not crash')
    }],
  /*
   * A shared circuit (review of #70): the owner's Start runs the owner's side.
   * Sam's side is mounted hidden behind it and must NOT start Sam's clock, which
   * would book seconds Sam never did and log them in Sam's log. It waits on the
   * circuit step, with Sam's own Start. Pinned from both sides: hidden waits,
   * shown runs.
   */
  ['WorkoutRunner(a shared circuit\'s hidden side waits on its own Start; the side on screen runs)', null, () => {
    const pres = normalizePrescription({ title: 'Abs', blocks: [{ name: 'Core', circuit: { work: 40, rest: 20, rounds: 3 }, items: [
      { kind: 'lift', name: 'Crunch', exercise: 'crunch', sets: [] },
      { kind: 'lift', name: 'Plank', exercise: 'plank', sets: [] },
    ] }] }, { liftField: LIFT_FIELD })
    const theirs = { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'planned', name: 'Abs', done: false, plan: pres, out: {}, sharedFrom: { id: 'owner', name: 'Alex' } } }
    const side = (shown) => renderToString(<PlanProvider plan={HELD_PLAN}><WorkoutRunner session={PLANNED_CARD} entry={theirs}
      entries={[]} onRun={noop} onExit={noop} who={{ name: 'Sam', tone: 1 }} shown={shown} /></PlanProvider>)
    const hidden = side(false)
    if (/it-run/.test(hidden)) throw new Error('the hidden side started its own timer')
    if (!/Start the circuit/.test(text(hidden))) throw new Error('the hidden side has no Start of its own')
    if (!/it it-run k-countin it-circuit/.test(side(true))) throw new Error('the side on screen did not run the circuit')
  }],
]
