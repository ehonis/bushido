/* Smoke cases: the runner: a planned session set by set.
 * Run by app/smoke/index.jsx (`npm run smoke`); moved out of app/smoke.jsx in #73,
 * unchanged and in their old relative order. A case is [name, element | null, assert?].
 */
import { readFileSync } from 'node:fs'
import { renderToString } from 'react-dom/server'
import { WorkoutRunner, SetList } from '../src/runner.jsx'
import { WorkoutMode, Face, Review, Finish as WoFinish } from '../src/workout.jsx'
import { sideStatus } from '../src/trainer.jsx'
import { TimerRun, LeaveDialog, leaveActions } from '../src/timer.jsx'
import { normalizePrescription, prescriptionSteps, emptyRun, markSet } from '../src/lib/prescription.js'
import { buildSteps } from '../src/lib/workout.js'
import { compile, startRun, startHold, pauseRest, BUILT_INS } from '../src/lib/timer.js'
import { PlanProvider } from '../src/lib/planctx.jsx'
import { liftFieldOf } from '../src/lib/lifts.js'
import {
  plan, entries, noop, TODAY, back, rich, text, LIFT_FIELD, PLANNED_CARD, PLANNED_ENTRY,
  HELD_PLAN, HELD_ENTRY, RESTING_RUN, PRESCRIPTION,
} from './fixtures.jsx'

export default [
  /* A piece's time in the runner is the editor's minutes box (#78): "45", never "2700 sec". */
  ['WorkoutRunner(a timed piece is in minutes, as in the editor)', null, () => {
    const pres = normalizePrescription({
      title: 'Zone 2 ride', blocks: [{ name: 'Ride', items: [{ kind: 'interval', name: 'Zone 2 ride', sets: [{ seconds: 2700 }] }] }],
    })
    const entry = { ...PLANNED_ENTRY, data: { ...PLANNED_ENTRY.data, plan: pres, run: { ...emptyRun(1), sets: {} } } }
    const html = renderToString(<WorkoutRunner session={PLANNED_CARD} entry={entry} entries={[]} onRun={noop} onExit={noop} />)
    if (!/class="bigstep-in"/.test(html)) throw new Error('the set screen did not render, so this proves nothing')
    if (/2700|aria-label="more sec"/.test(html)) throw new Error('the runner asks a 45-minute ride in seconds')
    if (!/aria-label="more min"/.test(html) || !/<span class="bigstep-label">min<\/span>/.test(html)) throw new Error('the runner\'s box is not in minutes')
    if (!/Planned.*45 min/.test(text(html))) throw new Error('the target is not "45 min"')
  }],
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
      // The first set is ten minutes on the bike: a timed set, so the primary
      // starts its clock (#75), and it can still be marked without one.
      if (!/Start 10:00/.test(t)) throw new Error('a timed first set does not start its clock')
      if (!/Log this set without the clock/.test(t)) throw new Error('no way to mark the set he is on')
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
  /* The runner has the sheet's switch (#111, B F1): beside the implement under
     the name, worded and with Undo (`modeFlip`); the big weight says only "lb". */
  ['WorkoutRunner(a dumbbell lift: the meaning switch is by the implement, never under the number)', <PlanProvider plan={plan}><WorkoutRunner session={PLANNED_CARD}
    entry={{ ...PLANNED_ENTRY, data: { ...PLANNED_ENTRY.data, plan: normalizePrescription({
      title: 'Legs', blocks: [{ name: 'Main', items: [{ kind: 'lift', exercise: 'bulgarian-split-squat', implement: 'dumbbell',
        weightMode: 'one', sets: [{ reps: 8, weight: 25 }] }] }],
    }, { liftField: liftFieldOf(plan) }) } }}
    entries={rich} onRun={noop} onExit={noop} /></PlanProvider>,
    (html) => {
      const impl = (html.match(/<div class="run-impl">([\s\S]*?)<\/div>/) || [])[1] || ''
      if (!/<button[^>]*class="modeswitch"[^>]*aria-label="Weight is lb · one dumbbell\. Switch to lb per hand"/.test(impl)) throw new Error('the runner has no meaning switch beside the implement')
      if (/stepper-swap/.test(html)) throw new Error('the meaning switch is back under the big weight')
      if ((html.match(/Switch to/g) || []).length !== 1) throw new Error('a second meaning switch is on the set screen')
      if (!/<span class="bigstep-label">lb<\/span>/.test(html)) throw new Error('the big weight does not say its unit')
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
  /* ------------------------------------------------------------------ #75
   * The workout screens are safe and consistent: one exit, one leave dialog
   * whose primary is Keep going, one control row at the bottom of every clock,
   * Finish only where nothing is left, Skip away from Done set, a clock for a
   * timed set. Every move is pinned from both sides.
   */
  ...(() => {
    const buttonsOf = (html) => [...html.matchAll(/<button class="btn([^"]*)"[^>]*>([^<]*)<\/button>/g)].map(m => [m[1].trim(), m[2]])
    const rowOf = (html) => {
      const row = (html.match(/<div class="it-ctl wk-ctl[^"]*">([\s\S]*?)<\/div>/) || [])[1] || ''
      return [...row.matchAll(/aria-label="([^"]*)"/g)].map(m => m[1])
    }
    const actsOf = (html) => (html.match(/<div class="run-acts">([\s\S]*)$/) || [])[1] || ''
    const whereOf = (html) => (html.match(/<div class="run-where">([\s\S]*?)<\/div>/) || [])[1] || ''
    const exitFirst = (html, label) => {
      const head = (html.match(/<header class="wk-head">([\s\S]*?)<\/header>/) || [])[1] || ''
      const first = (head.match(/<button[^>]*>/) || [])[0] || ''
      if (!/class="iconbtn wk-exit"/.test(first) || !first.includes(`aria-label="${label}"`)) throw new Error(`the first thing in the header is not the exit (${label})`)
      if (!/lucide-x\b/.test(head)) throw new Error('the exit is not an X')
      if (/lucide-chevron-(down|left)/.test(head)) throw new Error('a chevron exit is back')
    }
    const steps = prescriptionSteps(PRESCRIPTION)
    const runner = (run, pres = PRESCRIPTION, extra = {}) => renderToString(<PlanProvider plan={plan}><WorkoutRunner session={PLANNED_CARD}
      entry={{ ...PLANNED_ENTRY, data: { ...PLANNED_ENTRY.data, plan: pres, run } }} entries={rich} onRun={noop} onExit={noop} {...extra} /></PlanProvider>)
    const MIXED = normalizePrescription({
      title: 'Lift and abs', blocks: [
        { name: 'Main', items: [{ kind: 'lift', name: 'Row', sets: [{ reps: 10, weight: 90 }] }] },
        { name: 'Abs', circuit: { work: 40, rest: 20, rounds: 2, countIn: 10 }, items: [
          { kind: 'lift', name: 'Crunch', sets: [{}] }, { kind: 'lift', name: 'Dead bug', sets: [{}] }] },
      ],
    })
    const mixedSteps = prescriptionSteps(MIXED)
    return [
      ['LeaveDialog(Keep going is the primary while sets are left; Finish is quiet and asks again)', null, () => {
        const left = buttonsOf(renderToString(<LeaveDialog title="Leave the workout?" onKeep={noop}
          actions={leaveActions({ left: 3, onLeave: noop, onFinish: noop, onAskFinish: noop })} />))
        if (JSON.stringify(left[0]) !== JSON.stringify(['', 'Keep going'])) throw new Error(`the first, primary button is ${JSON.stringify(left[0])}, not Keep going`)
        if (!left.some(([k, t]) => k === 'secondary' && t === 'Leave it open')) throw new Error('no Leave it open')
        if (!left.some(([k, t]) => k === 'quiet' && t === 'Finish with 3 sets left')) throw new Error('finishing early is not a quiet "Finish with 3 sets left"')
        if (left.some(([, t]) => /Finish now|Finish workout|Finish and log it/.test(t))) throw new Error('a full Finish is offered with sets still to do')
        const none = buttonsOf(renderToString(<LeaveDialog title="Leave the workout?" onKeep={noop}
          actions={leaveActions({ left: 0, onLeave: noop, onFinish: noop, onAskFinish: noop })} />))
        if (JSON.stringify(none[0]) !== JSON.stringify(['', 'Finish workout'])) throw new Error('with every set marked, Finish workout is not the primary')
        if (!none.some(([k, t]) => k === 'secondary' && t === 'Keep going')) throw new Error('Keep going is not the quiet second once everything is done')
        if (/1 sets/.test(JSON.stringify(buttonsOf(renderToString(<LeaveDialog title="x" onKeep={noop}
          actions={leaveActions({ left: 1, onLeave: noop, onFinish: noop, onAskFinish: noop })} />))))) throw new Error('"1 sets"')
      }],
      ['WorkoutRunner + WorkoutMode + TimerRun(one exit: an X, first in the header)', null, () => {
        const run = runner(null)
        exitFirst(run, 'Leave the workout')
        if (/class="run-x"|class="run-head"|Finish now/.test(run)) throw new Error('the runner\'s old header or "Finish now" is back')
        const mode = renderToString(<WorkoutMode session={plan.dailyMenu.find(m => m.id === 'repeaters')}
          entry={{ id: 'w', kind: 'daily', date: TODAY, data: { optId: 'repeaters', out: {} } }} onSave={noop} onSetDone={noop} onExit={noop} />)
        exitFirst(mode, 'Leave the workout')
        if (/class="wo-head"/.test(mode)) throw new Error('workout mode\'s own header is back')
        const config = { ...BUILT_INS[0].config }
        const timer = renderToString(<TimerRun name="30 on" config={config} initialRun={startRun(compile(config), 1000)} now={3000} onClose={noop} />)
        exitFirst(timer, 'Stop the timer')
        if (/class="it-head"/.test(timer)) throw new Error('the run screen grew its own header again')
      }],
      ['WorkoutRunner(resting: Back · −10 · Pause · +10 · Skip at the bottom, like every clock; no nudge buttons)', null, () => {
        const html = runner(RESTING_RUN)
        const row = rowOf(html)
        if (JSON.stringify(row) !== JSON.stringify(['Back', '10 seconds less', 'Pause', '10 seconds more', 'Skip the rest'])) throw new Error(`the rest's row is ${row.join(' · ')}`)
        if (!/class="run-acts"><div class="it-ctl wk-ctl/.test(html)) throw new Error('the rest\'s row is not at the bottom')
        if (/rest-nudge|run-skip|>30s<|>15s</.test(html)) throw new Error('the old ±15/30 nudges or the ghost Skip are back')
        const t0 = 1_000_000
        const config = { ...BUILT_INS[0].config }
        const timer = rowOf(renderToString(<TimerRun name="t" config={config} initialRun={startRun(compile(config), t0)} now={t0 + 20_000} onClose={noop} />))
        if (JSON.stringify(timer) !== JSON.stringify(['Back', '10 seconds less', 'Pause', '10 seconds more', 'Skip'])) throw new Error(`the timer's row is ${timer.join(' · ')}`)
        const step = buildSteps(plan.dailyMenu.find(m => m.id === 'repeaters'), {})[0]
        const face = renderToString(<Face phase="work" counted={2} rep={1} left={7} step={step} timing={step.timing}
          paused={false} onPause={noop} onBump={noop} onBack={noop} onSkip={noop} onEndSet={noop} onHow={noop} />)
        if (JSON.stringify(rowOf(face)) !== JSON.stringify(timer)) throw new Error(`workout mode's row is ${rowOf(face).join(' · ')}`)
        if (!/class="wo-foot"/.test(face)) throw new Error('workout mode\'s controls are not at the bottom')
        if (/>15s</.test(face)) throw new Error('workout mode nudges by 15 s again; every clock nudges by 10')
      }],
      ['WorkoutRunner(Skip is up by the set count, not under Done set; All sets and Add a set are)', null, () => {
        const html = runner({ ...emptyRun(1000), cursor: steps[1].setId })
        if (!/Done set/.test(text(html))) throw new Error('not on a set with Done set, so this proves nothing')
        if (!/aria-label="Skip set 1 of [^"]+"/.test(whereOf(html))) throw new Error('Skip is not beside the set count')
        const acts = actsOf(html)
        if (/Skip/.test(text(acts))) throw new Error('Skip is under Done set again')
        if (!/All sets/.test(text(acts)) || !/Add a set/.test(text(acts))) throw new Error('All sets or Add a set left the bottom row')
        const logged = runner(markSet({ ...emptyRun(1000), cursor: steps[1].setId }, steps[1], { reps: 8, weight: 135 }, { at: 2000, steps: [] }))
        if (/aria-label="Skip set/.test(logged)) throw new Error('a set already done offers Skip')
      }],
      ['WorkoutRunner(a timed set: Start counts it down on the timer\'s face; Stop the clock is at the top)', null, () => {
        const now = Date.now()
        const html = runner(startHold(emptyRun(now), steps[0].setId, 600, now))
        if (!/class="run-body run-hold k-countin"/.test(html)) throw new Error('the hold does not run on the timer face')
        if (!/Get ready/.test(text(html))) throw new Error('the count-in is not said')
        if (!/Stop the clock/.test(text(whereOf(html)))) throw new Error('stopping the clock is not at the top')
        if (rowOf(html).length !== 5) throw new Error('the hold has no control row')
        if (/Done set|Start 10:00/.test(text(html))) throw new Error('the set screen is still there under the clock')
      }],
      ['WorkoutRunner(a circuit step: All sets under Start; Skip at the top asks before skipping)', null, () => {
        const html = runner({ ...emptyRun(1000), cursor: mixedSteps[1].setId }, MIXED)
        if (!/Start the circuit/.test(text(html))) throw new Error('not on the circuit step, so this proves nothing')
        const acts = actsOf(html)
        if (!/All sets/.test(text(acts))) throw new Error('the circuit step has no All sets')
        if (/Skip/.test(text(acts))) throw new Error('Skip is next to Start the circuit again')
        if (!/aria-label="Skip Abs"/.test(whereOf(html))) throw new Error('Skip is not at the top')
      }],
      ['WorkoutRunner(a 90-minute set stays a number with Done set: a clock runs an hour at most)', null, () => {
        const LONG = normalizePrescription({ title: 'Ride', blocks: [{ name: 'Ride', category: 'bike', items: [
          { kind: 'interval', name: 'Long ride', sets: [{ seconds: 5400 }] }] }] })
        const t = text(runner(null, LONG))
        if (!/Done set/.test(t) || /Start 90:00|without the clock/.test(t)) throw new Error('a 90-minute set is offered a clock that would log an hour')
      }],
      ['sideStatus(a paused rest stands still on the side switcher)', null, () => {
        const now = Date.now()
        const run = markSet(emptyRun(now - 1000), steps[1], { reps: 8, weight: 135, restSec: 90 }, { at: now - 30_000, steps })
        const entry = { ...PLANNED_ENTRY, data: { ...PLANNED_ENTRY.data, run: pauseRest(run, now - 20_000) } }
        const a = sideStatus('runner', entry, now)
        const b = sideStatus('runner', entry, now + 45_000)
        if (a !== 'rest 1:20 · paused' || b !== a) throw new Error(`a paused rest reads "${a}" then "${b}"`)
        if (sideStatus('runner', { ...entry, data: { ...entry.data, run } }, now) !== 'rest 1:00') throw new Error('a running rest lost its count')
      }],
      ['SetList(Finish only once every set is marked; never "Finish and log it")', null, () => {
        const props = { pres: PRESCRIPTION, steps, run: null, cursor: steps[0].setId, onJump: noop, onUnmark: noop, onUnskip: noop, onClose: noop }
        const open = renderToString(<SetList {...props} onFinish={null} />)
        if (/setlist-foot|Finish/.test(open)) throw new Error('All sets offers Finish with sets still to do')
        const done = renderToString(<SetList {...props} onFinish={noop} />)
        if (!/Finish workout/.test(text(done))) throw new Error('All sets lost Finish once everything is marked')
        if (/Finish and log it/.test(done)) throw new Error('the old wording is back')
      }],
      ['Review(numbers are text boxes; "last set" is a switch above them, not a link under Set done)', null, () => {
        const step = buildSteps(plan.dailyMenu.find(m => m.id === 'repeaters'), {})[0]
        const html = renderToString(<Review step={step} draft={{ reps: 6, weight: 10 }} onDraft={noop} onCommit={noop} isLastSet={false} />)
        if (/type="number"/.test(html)) throw new Error('a number input is back (it eats the dot in "37.")')
        const sw = html.search(/role="switch"/)
        if (sw < 0 || !/Last set of repeaters/.test(text(html))) throw new Error('no "Last set of …" switch')
        if (sw > html.indexOf('class="wo-fields"')) throw new Error('the last-set switch is under the numbers, by Set done')
        if (/That was my last set|wo-link wo-lastset/.test(html)) throw new Error('the last-set link under Set done is back')
        const last = renderToString(<Review step={step} draft={{ reps: 6 }} onDraft={noop} onCommit={noop} isLastSet />)
        if (/role="switch"/.test(last)) throw new Error('the last set of the session offers "last set"')
      }],
      ['Finish(workout mode: Finish workout is the one way out; no mark-undone link)', <WoFinish session={plan.dailyMenu.find(m => m.id === 'repeaters')}
        out={{ sets: {} }} startedAt={null} value="" onValue={noop} onFinish={noop} />,
        (html) => {
          const t = text(html)
          if (!/Finish workout/.test(t)) throw new Error('no Finish workout')
          // One way out (#75): Mark undone lives on the sheet only.
          if (/mark it undone|don't mark it done|Finish &amp; mark done|wo-link/i.test(html)) throw new Error('a second way out of the finish is back')
          if ((html.match(/<button/g) || []).length !== 1) throw new Error('the finish has more than one button')
          if (/type="number"/.test(html)) throw new Error('the minutes box is a number input')
        }],
      ['WorkoutMode(the phase class cannot collide with the review card; the rail is at the top)', null, () => {
        const html = renderToString(<WorkoutMode session={plan.dailyMenu.find(m => m.id === 'repeaters')}
          entry={{ id: 'w', kind: 'daily', date: TODAY, data: { optId: 'repeaters', out: {} } }} onSave={noop} onSetDone={noop} onExit={noop} />)
        if (!/class="wo wo--idle"/.test(html)) throw new Error('the root is not wo--<phase>')
        const rail = html.indexOf('class="wo-rail"')
        if (rail < 0 || rail > html.indexOf('class="wo-intro"')) throw new Error('the rail is not above the screen\'s content')
        const css = readFileSync(new URL('../src/css/workout.css', import.meta.url), 'utf8')
        if (/^\.wo-(countin|work|represt|setrest|finished)\b/m.test(css)) throw new Error('a phase rule is back on a wo-<phase> class')
        const rail44 = (css.match(/\.wo-railset \{([^}]*)\}/) || [])[1] || ''
        if (!/width: var\(--tap\); height: var\(--tap\)/.test(rail44)) throw new Error('the rail\'s set buttons are under 44px')
      }],
      ['runner.css(the runner\'s bottom stops being sticky while a number is typed)', null, () => {
        const css = readFileSync(new URL('../src/css/runner.css', import.meta.url), 'utf8')
        if (!/\.run:has\(\.run-body input:focus\) \.run-acts \{ position: static;/.test(css)) throw new Error('the sticky bottom covers what is being typed again')
        if (!/\.run:has\(\.run-body input:focus\) \.run-acts-row \{ display: none; \}/.test(css)) throw new Error('the second row stays up while typing')
      }],
    ]
  })(),
]
