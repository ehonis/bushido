/* Smoke cases: the interval timer and circuits on it.
 * Run by app/smoke/index.jsx (`npm run smoke`); moved out of app/smoke.jsx in #73,
 * unchanged and in their old relative order. A case is [name, element | null, assert?].
 */
import { renderToString } from 'react-dom/server'
import { PlanProvider } from '../src/lib/planctx.jsx'
import { TimerSetup, TimerRun, timerRequestFor } from '../src/timer.jsx'
import {
  compile, startRun, presetList, sessionTimer, buildTimerEntry, buildLastTimerEntry,
  BUILT_INS, circuitConfig,
} from '../src/lib/timer.js'
import {
  plan, entries, noop, text, HELD_PLAN,
} from './fixtures.jsx'

export default [
  ['TimerSetup(the default first, saved presets after, a climbing card\'s timer offered as one)', null, () => {
    const card = plan.dailyMenu.find(m => m.id === 'max-hangs')
    const entries = [
      { ...buildLastTimerEntry('Tabata', BUILT_INS[1].config), updatedAt: 'z' },
      { ...buildTimerEntry('timer-a', 'Hill reps', { work: 45, rest: 15, rounds: 6 }), updatedAt: 'z' },
    ]
    const plain = text(renderToString(<TimerSetup presets={presetList(entries)} onStart={noop} onClose={noop} onSave={noop} onDelete={noop} />))
    if (plain.indexOf('Last used') < 0 || plain.indexOf('Last used') > plain.indexOf('Hill reps')) {
      throw new Error('the last timer run is not the one-tap default')
    }
    if (!plain.includes('Hill reps')) throw new Error('a saved preset is missing')
    const climbing = text(renderToString(<TimerSetup title={card.name}
      presets={presetList(entries, timerRequestFor(card).presets)} onStart={noop} onClose={noop} />))
    if (!climbing.includes(card.name) || climbing.indexOf(card.name) > climbing.indexOf('Last used')) {
      throw new Error('the card\'s own timer is not offered first')
    }
    if (!sessionTimer(card)) throw new Error('the climbing card has no timer preset')
  }],
  ['TimerRun(huge time, phase, round, next up)', null, () => {
    const config = { countIn: 0, work: 30, rest: 15, rounds: 8, sets: 2, setRest: 60 }
    const t0 = Date.parse('2026-10-25T09:00:00Z')
    const run = startRun(compile(config), t0)
    const html = renderToString(<TimerRun name="30 on, 15 off" config={config} initialRun={run}
      now={t0 + 37_000} onAgain={noop} onClose={noop} />)
    const t = text(html)
    for (const w of ['Rest', '0:08', 'Round 1 of 8', 'Set 1 of 2', 'Next:', 'Work', 'Pause', 'Skip', 'Back']) {
      if (!t.includes(w)) throw new Error(`no "${w}" on the run screen`)
    }
    if (!/class="it it-run k-rest"/.test(html)) throw new Error('the screen is not coloured for rest')
  }],
  /*
   * The + timer with exercises: a preset that holds them lists them with their
   * timing, and offers "Add to Today". A PLAIN preset is unchanged: no list,
   * no Add to Today, only the quiet way in; and its run screen has no
   * exercise on it.
   */
  ['TimerSetup(a preset with exercises: the list, and Add to Today; a plain one unchanged)', null, () => {
    const abs = circuitConfig({ work: 40, rest: 20, rounds: 3, roundRest: 60 }, [
      { key: 'crunch', name: 'Crunch' }, { key: 'plank', name: 'Plank', seconds: 60 }])
    const entries = [{ ...buildTimerEntry('timer-abs', 'Abs', abs), updatedAt: 'z' }]
    const presets = presetList(entries).filter(p => p.id === 'timer-abs')
    const t = text(renderToString(<PlanProvider plan={HELD_PLAN}>
      <TimerSetup presets={presets} onStart={noop} onClose={noop} onSave={noop} onPlace={noop} />
    </PlanProvider>))
    for (const w of ['Exercises', 'Crunch', 'Plank', '1:00', 'Add to Today', '3 rounds · 2 exercises · 40s each · 20s rest']) {
      if (!t.includes(w)) throw new Error(`no "${w}" on a circuit preset`)
    }
    const plain = text(renderToString(<PlanProvider plan={HELD_PLAN}>
      <TimerSetup presets={BUILT_INS} onStart={noop} onClose={noop} onSave={noop} onPlace={noop} />
    </PlanProvider>))
    if (/Add to Today|Exercises|Rest between rounds/.test(plain)) throw new Error('a plain timer grew the circuit\'s controls')
    if (!/Add exercises/.test(plain)) throw new Error('no way to make a circuit from the timer')
    const config = BUILT_INS[0].config
    const t0 = Date.parse('2026-10-25T09:00:00Z')
    const run = text(renderToString(<TimerRun name="30 on, 15 off" config={config} initialRun={startRun(compile(config), t0)}
      now={t0 + 12_000} onAgain={noop} onClose={noop} />))
    if (/Up next|Exercise \d of|it-circuit/.test(run)) throw new Error('a plain timer\'s run screen changed')
    if (!/Again|Pause/.test(run)) throw new Error('the plain run screen did not render, so this proves nothing')
  }],
  ['TimerRun(a circuit\'s rest says what is coming; its finish says it was logged)', null, () => {
    const abs = circuitConfig({ work: 40, rest: 20, rounds: 2, countIn: 0 }, [{ key: 'crunch', name: 'Crunch' }, { key: 'plank', name: 'Plank' }])
    const t0 = Date.parse('2026-10-25T09:00:00Z')
    const r0 = startRun(compile(abs), t0)
    const rest = renderToString(<PlanProvider plan={HELD_PLAN}><TimerRun name="Abs" config={abs} initialRun={r0}
      now={t0 + 45_000} onClose={noop} /></PlanProvider>)
    if (!/k-rest it-circuit/.test(rest)) throw new Error('not resting at 45 s')
    if (!/Up next/.test(text(rest)) || !/<strong class="it-exnext">Plank/.test(rest)) throw new Error('the rest does not say the plank is next')
    if (!/aria-label="How to do Plank"/.test(rest)) throw new Error('no way to read how to do what is coming')
    const done = text(renderToString(<PlanProvider plan={HELD_PLAN}><TimerRun name="Abs" config={abs} initialRun={r0}
      now={t0 + 999_000} logged="Logged on today" onClose={noop} /></PlanProvider>))
    if (!/Done/.test(done) || !/Logged on today/.test(done)) throw new Error('the finish does not say it was logged')
    if (/Again/.test(done)) throw new Error('Again offered with nothing to run it again from')
  }],
]
