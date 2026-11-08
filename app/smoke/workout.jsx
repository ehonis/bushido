/* Smoke cases: workout mode: the climbing cards' rep clock.
 * Run by app/smoke/index.jsx (`npm run smoke`); moved out of app/smoke.jsx in #73,
 * unchanged and in their old relative order. A case is [name, element | null, assert?].
 */
import { readFileSync } from 'node:fs'
import { PrefsProvider } from '../src/lib/prefs.jsx'
import { renderToString } from 'react-dom/server'
import { SessionLog } from '../src/sessionlog.jsx'
import { WorkoutMode, Face, Review } from '../src/workout.jsx'
import { hasWorkout, buildSteps } from '../src/lib/workout.js'
import {
  plan, entries, noop, TODAY, text,
} from './fixtures.jsx'

export default [
  // Workout mode, in every state it can be left in. It owns the whole screen
  // and runs with chalky hands mid-set, so a bad property access here is the
  // worst possible time to find one.
  ...plan.dailyMenu
    .filter(m => hasWorkout(m))
    .map(m => [`Workout(${m.id})`,
      <WorkoutMode session={m}
        entry={{ id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
          data: { slot: 'main', optId: m.id, level: m.level, name: m.name, minutes: m.minutes, out: {} } }}
        onSave={noop} onSetDone={noop} onExit={noop} />]),
  // Part-way through: some sets logged, a counterweight sign set, a clock running.
  ['Workout(part done)', <WorkoutMode session={plan.dailyMenu.find(m => m.id === 'hard-home')}
    entry={{ id: 'w1', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'hard-home', level: 4, minutes: 25, out: {
        startedAt: '2026-08-08T18:00:00.000Z',
        sets: { maxhang: [{ reps: 1, seconds: 7, weight: 43 }, { reps: 1, seconds: 7, weight: 43 }] },
        signs: { repeaters: '-' } } } }}
    onSave={noop} onSetDone={noop} onExit={noop} />],
  // Every set already logged — the finish screen has to be reachable.
  ['Workout(all done)', <WorkoutMode session={plan.dailyMenu.find(m => m.id === 'subthreshold')}
    entry={{ id: 'w2', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'subthreshold', level: 1, minutes: 10, out: {
        elapsedMin: 11,
        sets: { hangs: Array.from({ length: 5 }, () => ({ seconds: 25, weight: 30 })) } } } }}
    onSave={noop} onSetDone={noop} onExit={noop} />],
  /* The running clock itself.
   *
   * Every WorkoutMode case above renders the intro, because that is the phase a
   * fresh one opens in — so the screen the user actually spends the session
   * looking at had no render coverage at all, and shipped twice with an
   * instruction to tap something that was not a button. These cases pin the
   * three shapes it takes: a countdown, a set with no target, and a rest with
   * no target. The last two must offer something to press.
   *
   * The count-up cases use the BOARD session on purpose: it is a real one that
   * counts up (its intervals are timed by finishing them, not by a countdown), and
   * it is one the app still offers workout mode for. The bodyweight circuits it
   * used to use no longer get the mode at all — see hasWorkout. */
  ...(() => {
    const face = (phase, id, exIndex, extra = {}) => {
      const step = buildSteps(plan.dailyMenu.find(m => m.id === id), {})[exIndex]
      return <Face phase={phase} counted={42} rep={1} left={null} step={step} timing={step.timing}
        paused={false} onPause={noop} onBump={noop} onSkip={noop} onEndSet={noop} onHow={noop} {...extra} />
    }
    const pressable = (html) => {
      if (!/<button[^>]*class="[^"]*wo-clock[^"]*tappable/.test(html)) {
        throw new Error('the clock says to tap it and is not a button')
      }
    }
    return [
      ['Face(counting down)', face('work', 'repeaters', 0, { left: 7 }),
        html => {
          if (/tap the clock/i.test(text(html))) throw new Error('a countdown must not invite a tap')
          if (/class="[^"]*wo-clock[^"]*tappable/.test(html)) throw new Error('a countdown clock is not a button')
        }],
      ['Face(count-in)', face('countin', 'max-hangs', 0, { left: 3 })],
      ['Face(set with no target)', face('work', 'board', 0), pressable],
      ['Face(rest with no target)', face('setrest', 'board', 1), pressable],
      // The crimp crawls' third set: the one set in a basement session that
      // counts UP, because it ends when their fingers open. Same shape as the
      // board's intervals, and the screen the user taps with the pump peaking.
      ['Face(the all-out crawl)', face('work', 'crawls', 2), pressable],
      ['Face(paused)', face('work', 'board', 0, { paused: true })],
    ]
  })(),
  /* The review screen — the one that writes the set down. Lead laps are the only
   * session whose set carries a LIST (a grade per lap), and a per-rep field that
   * renders nothing here loses the grades on every set the user marks off. */
  ...(() => {
    const step = buildSteps(plan.dailyMenu.find(m => m.id === 'lead-laps'), {})[0]
    return [
      ['Review(a grade per lap)',
        <Review step={step} draft={{ reps: 2, grades: [10.1, 10.2] }}
          onDraft={noop} onCommit={noop} isLastSet={false} />,
        html => {
          const selected = [...html.matchAll(/<option value="([\d.]+)" selected=""/g)].map(m => m[1])
          if (selected.join() !== '10.1,10.2') {
            throw new Error(`the review screen lost the per-lap grades: ${selected.join() || 'none'}`)
          }
          // The list must not also appear as a number field — Number([10.1,10.2]) is NaN.
          if (/aria-label="[^"]*grades"|>grades</.test(html)) throw new Error('the grade list rendered as a number input')
        }],
      /* "Show explanations" governs every explanation (#98, G r1 F8), not only the
         testing page's blurbs; both platforms wrap theirs in Explain. */
      ['Explain(off in Settings: the sentence that explains goes, what happened stays)', null, () => {
        const step = buildSteps(plan.dailyMenu.find(m => m.id === 'repeaters'), {})[0]
        const el = <Review step={step} draft={{ reps: 1, seconds: 7, weight: 43 }} onDraft={noop} onCommit={noop} isLastSet />
        const on = text(renderToString(<PrefsProvider settings={{}} saveSettings={noop}>{el}</PrefsProvider>))
        const off = text(renderToString(<PrefsProvider settings={{ blurbs: { allHidden: true } }} saveSettings={noop}>{el}</PrefsProvider>))
        if (!/Pre-filled from the plan/.test(on)) throw new Error('the explanation is not there with explanations on, so this proves nothing')
        if (/Pre-filled from the plan/.test(off)) throw new Error('an explanation shows with explanations off')
        if (!/What actually happened\?/.test(off)) throw new Error('turning explanations off took the screen with it')
        const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
        for (const [f, n] of [['src/workout.jsx', 2], ['src/setlog.jsx', 1], ['src/timer.jsx', 1], ['src/exercises.jsx', 1], ['src/profile.jsx', 1],
          ['../mobile/src/features/workout.tsx', 2], ['../mobile/src/features/setlog.tsx', 1], ['../mobile/src/features/timer.tsx', 1],
          ['../mobile/src/features/exercises.tsx', 1], ['../mobile/src/features/profile.tsx', 1],
          // #98 review: the gear form, notifications, the planner's working line, the Log's and
          // Progress's empty states, the screen probe.
          ['src/gear.jsx', 2], ['src/notifications.jsx', 1], ['src/planner.jsx', 1], ['src/log.jsx', 1], ['src/progress.jsx', 1],
          ['src/screeninfo.jsx', 1], ['../mobile/src/features/gear.tsx', 1], ['../mobile/src/features/planner.tsx', 1],
          ['../mobile/src/features/log.tsx', 1], ['../mobile/src/features/progress.tsx', 1]]) {
          const got = (read(f).match(/<Explain>/g) || []).length
          if (got < n) throw new Error(`${f}: ${got} of ${n} explanations behind Explain`)
        }
        // The phone's gear confirm takes its line as a prop: no line while explanations are off.
        if (!/deleteBody=\{explain \? 'Workouts logged with it keep their history\.' : false\}/.test(read('../mobile/src/features/gear.tsx'))) throw new Error('the phone\'s gear confirm explains with explanations off')
      }],
      ['Review(an ordinary set)',
        <Review step={buildSteps(plan.dailyMenu.find(m => m.id === 'repeaters'), {})[0]}
          draft={{ reps: 1, seconds: 7, weight: 43 }} onDraft={noop} onCommit={noop} isLastSet />,
        html => {
          if (/gradesel/.test(html)) throw new Error('a session with no grade field grew a grade picker')
          if (/log each/.test(text(html))) throw new Error('a session the plan makes no offer on grew the per-climb toggle')
        }],
    ]
  })(),
  /* The board's optional per-climb detail, ON THE REVIEW SCREEN.
   *
   * The board is the first session with both a clock and this offer, and the
   * reason it is offered mid-session is that the twenty seconds after an
   * interval is the only moment anyone honestly knows which problem the fall
   * was on. Three states, because each one has its own way of being wrong:
   * the offer must be visible when off, the records must render when on, and a
   * set that already carries climbs must not lose them to the review screen —
   * `writeSet` replaces the row with exactly what this screen is handed. */
  ...(() => {
    const boardStep = (out = {}) => buildSteps(plan.dailyMenu.find(m => m.id === 'board'), out)[0]
    const climbed = [
      { grade: 4, fell: false, felt: '', style: 'crimpy' },
      { grade: 5, fell: true, felt: 1, style: 'powerful' },
      { grade: 4, fell: false, felt: '', style: '' },
    ]
    return [
      ['Review(the board, detail off)',
        <Review step={boardStep()} draft={{ reps: 3, seconds: 104 }}
          onDraft={noop} onCommit={noop} isLastSet={false} />,
        html => {
          if (!/log each problem/.test(text(html))) throw new Error('the per-climb offer is missing')
          if (/climblog/.test(html)) throw new Error('the detail rendered without being switched on')
          // Off, reps is an ordinary number field you can type into.
          if (/readonly/i.test(html)) throw new Error('the reps box is read-only with the detail off')
        }],
      ['Review(the board, logging each problem)',
        <Review step={boardStep()} draft={{ reps: 3, seconds: 104, climbs: climbed }}
          onDraft={noop} onCommit={noop} isLastSet={false} />,
        html => {
          const t = text(html)
          if (!/logging each problem/.test(t)) throw new Error('the toggle does not read as on')
          if ((html.match(/class="climb"/g) || []).length !== 3) throw new Error('one line per problem, three problems')
          if (!/>V4</.test(html) || !/>V5</.test(html)) throw new Error('the V ladder is not offered')
          if (!/fell on 1/.test(t)) throw new Error('the falls count is missing')
          if (!/crimpy/.test(html)) throw new Error("the board's own style list is missing")
          // While the detail is on the list is the count: typing was the bug.
          if (!/readonly/i.test(html)) throw new Error('the reps box is typeable while the detail is on')
        }],
      // Entered in the set log after the session, then the set is re-marked in
      // workout mode: the records have to arrive on this screen or committing
      // deletes them.
      // Lead laps already logged a grade per lap before this detail existed, so
      // switching it on there must not put a second ladder next to the first.
      ['SessionLog(one grade per lap, not two)',
        <SessionLog session={plan.dailyMenu.find(m => m.id === 'lead-laps')} bare
          entry={{ id: 'll', kind: 'daily', date: TODAY, updatedAt: 'z', data: { optId: 'lead-laps', out: {
            sets: { doubles: [{ reps: 2, grades: [10.1, 10.2], climbs: [
              { grade: '', fell: true, felt: '', style: 'overhang' },
              { grade: '', fell: false, felt: '', style: '' },
            ] }] } } } }}
          entries={[]} onSave={noop} />,
        html => {
          // Two laps, two grade pickers — the per-lap ladder — and no more.
          const pickers = (html.match(/class="gradesel"/g) || []).length
          if (pickers !== 2) throw new Error(`expected 2 grade pickers, got ${pickers}`)
          if ((html.match(/class="climb"/g) || []).length !== 2) throw new Error('the climb rows are missing')
          if (!/fell on 1/.test(text(html))) throw new Error('the fall was not counted')
        }],
      /* Down-climbing, on a route card. A lap climbed and reversed is two lengths
       * of wall, and the total under the table is where that shows up — the
       * number the user actually reads after a session. */
      ['SessionLog(a down-climbed lap counts twice)',
        <SessionLog session={plan.dailyMenu.find(m => m.id === 'arc')} bare
          entry={{ id: 'arc1', kind: 'daily', date: TODAY, updatedAt: 'z', data: { optId: 'arc', out: {
            sets: { bout: [{ reps: 3, seconds: 1200, climbs: [
              { grade: 8.2, fell: false, felt: '', style: '', down: '' },
              { grade: 8.2, fell: false, felt: '', style: '', down: 'both' },
              { grade: 7.2, fell: false, felt: '', style: '', down: 'only' },
            ] }] } } } }}
          entries={[]} onSave={noop} />,
        html => {
          const t2 = text(html)
          if (!/3 laps/.test(t2)) throw new Error('the lap count must be untouched')
          if (!/4 lengths/.test(t2)) throw new Error('a reversed lap should read as two lengths')
          if (!/2 down-climbed/.test(t2)) throw new Error('the down-climb count is missing')
          // Since #81 a described lap is one readable row; the up/down choice is
          // in the current climb's Details, and a row says what was picked.
          if ((html.match(/class="climb"/g) || []).length !== 3) throw new Error('one row per lap')
          if (!/up \+ down/.test(t2) || !/down only/.test(t2)) throw new Error('both states must read back on their rows')
        }],
      // The same detail on a BOULDER card offers no down-climb picker, and its
      // total stays a plain rep count.
      ['SessionLog(no down-climbing on a boulder card)',
        <SessionLog session={plan.dailyMenu.find(m => m.id === 'four-by-four')} bare
          entry={{ id: 'ff1', kind: 'daily', date: TODAY, updatedAt: 'z', data: { optId: 'four-by-four', out: {
            sets: { circuits: [{ reps: 2, climbs: [
              { grade: 4, fell: false, felt: '', style: '' },
              { grade: 5, fell: true, felt: '', style: '' },
            ] }] } } } }}
          entries={[]} onSave={noop} />,
        html => {
          if (/climb-down/.test(html)) throw new Error('a boulder card grew a down-climb picker')
          if (/lengths/.test(text(html))) throw new Error('and it should not talk about lengths')
        }],
      // #81: past twenty, the review screen showed and wrote back only twenty
      // climbs (repCount's cap), so an evening of 25 problems lost five.
      ['Review(25 problems stay 25)',
        <Review step={boardStep()} draft={{ reps: 25, seconds: 104, climbs: Array.from({ length: 25 }, () => ({ grade: 3 })) }}
          onDraft={noop} onCommit={noop} isLastSet={false} />,
        html => {
          if (!/value="25"/.test(html)) throw new Error('the count shown is not 25')
          if (!/problem 25/.test(text(html))) throw new Error('the 25th problem is not on screen')
        }],
      ['Review(a set that already carried climbs)',
        <Review step={boardStep({ sets: { intervals: [{ reps: 3, seconds: 104, climbs: climbed }] } })}
          draft={boardStep({ sets: { intervals: [{ reps: 3, seconds: 104, climbs: climbed }] } }).values}
          onDraft={noop} onCommit={noop} isLastSet={false} />,
        html => {
          if ((html.match(/class="climb"/g) || []).length !== 3) throw new Error('the logged climbs never reached the review screen')
          if (!/fell on 1/.test(text(html))) throw new Error('the logged fall was dropped')
        }],
    ]
  })(),
  // A session with no per-set prescription must say so rather than crash.
  ['Workout(nothing to step through)', <WorkoutMode session={plan.dailyMenu.find(m => m.role === 'rest')}
    entry={{ id: 'w3', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'off', level: 1, minutes: 0, out: {} } }}
    onSave={noop} onSetDone={noop} onExit={noop} />],
]
