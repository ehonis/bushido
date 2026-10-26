/*
 * The runner — the screen the user trains in front of, rebuilt for a phone.
 *
 * This replaces `workout.jsx` for PLANNED sessions. That screen is still right
 * for the climbing cards, which are a fixed protocol with a rep clock; this one
 * is for a prescription that was written an hour ago and will be edited mid-set.
 * It is a real fullscreen workout mode: a timer that survives closing the app,
 * easy marking of sets and weight, and built for a phone first, because that is
 * the only place it is used.
 *
 * FIVE DECISIONS, and every one of them is the phone.
 *
 * **The timer lives on the ENTRY, not in this component.** `data.run.restUntil`
 * is an absolute epoch millisecond. Nothing here counts down; it subtracts. So
 * closing Bushido, answering a text and coming back lands on the right second —
 * and so does opening it on the laptop, because the entry syncs. A `useState`
 * counter would have been four lines shorter and wrong the first time their phone
 * locked. This is also why `lib/prescription.js` takes `now` as an argument: the
 * clock is testable arithmetic rather than a thing that happens.
 *
 * **One set fills the screen.** Not a table of fourteen rows with the current one
 * highlighted — the number under their thumb is the only number that matters, and
 * everything else is one tap away in the set list. Every control is at least 56px
 * and everything the user presses mid-set is in the bottom third, where a thumb
 * actually reaches on a 6" phone held one-handed.
 *
 * **The numbers arrive filled in.** The prescription for an untouched set; what the user
 * actually did on the last set of the same movement once the user has moved off it. A
 * session done as written is one tap per set. This is the one place in the app
 * where pre-filling is right, and the reason is provenance: the target is
 * something the user asked for and is looking at, not something the app guessed. It
 * stays on `data.plan` untouched, so the log can still show where the user went off it.
 *
 * **Marking a set is the only required action.** No start, no count-in, no
 * confirm. Rest starts itself off the set the user just finished, because rest is the
 * tail of a set rather than the head of the next one.
 *
 * **Leaving is not losing.** Every mark writes the entry immediately. There is no
 * "save workout" button and no state that exists only here — closing the tab
 * mid-session costs nothing, which is the entire point of the first decision.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import { NumInput } from './numinput.jsx'
import { useModalLayer } from './modal.jsx'
import { CUES, primeAudio, resumeAudio, acquireWakeLock, releaseWakeLock } from './lib/cues.js'
import { lastLift } from './lib/lifts.js'
import {
  prescriptionSteps, runProgress, firstOpen, restLeft, runElapsed,
  markSet, unmarkSet, skipSet, unskipSet, nudgeRest, endRest, goToSet, finishRun,
  emptyRun, setDraft, carryForward, runOutputs, isLogged, isSkipped, setLine, itemLine,
  setFieldsFor, addSetLike, patchRunItem, measureOfItem,
  blockTimer, circuitOnly, circuitTiming, endCircuit, circuitToOpen, nextCircuit,
} from './lib/prescription.js'
import { compile, startRun, circuitDone, view as timerView, describe, totalSeconds } from './lib/timer.js'
import { clock } from './lib/workout.js'
import { Stepper, STEP, weightSwitch, SwapWords, ExerciseSheet } from './exercises.jsx'
import { ExerciseBody, musclesOf, muscleWords } from './lib/bodymap.jsx'
import { liftFieldOf } from './planner.jsx'
import { usePlan } from './lib/planctx.jsx'
import { TimerRun } from './timer.jsx'
import { timingWords } from './circuit.jsx'
import { andWords, togetherSaid } from './lib/trainer.js'

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.abs(s) % 60).padStart(2, '0')}`

/**
 * The runner.
 *
 * ONE writer. `onRun(run, { out, done })` persists the position, and folds in the
 * outputs and the done flag when they changed. It was two calls for about an
 * hour and that was a bug rather than a style: both spread the same `entry` prop,
 * so the second landed on top of the first and every set the user marked came back as
 * set one with the clock at zero. See `saveRun` in tabs.jsx.
 *
 * `out` is left off a rest-clock nudge, which changes the position and nothing
 * else — recomputing the lifts, the load level and the minutes on every tick
 * would be work for no change to any of them.
 */
/*
 * `who`, `switcher` and `shown`: a workout run from more than one person's side
 * (trainer.jsx `SidesWorkout`). Each side is its own runner over that person's
 * own entry with its own `onRun`, so there is still ONE writer per entry. `who`
 * ({ name, tone }) names whose side this is in the header, in their colour; a
 * side that is not `shown` keeps its clock (it is on the entry anyway) but rings
 * nothing, so the bell is always about the side on screen.
 */
/*
 * `together` (trainer.jsx `SidesWorkout`, #68): on a shared workout with sync on,
 * `{ words, names, host, on, onToggle, write }`. A circuit then waits on its
 * start screen, where "Together with Sam" is chosen, and one run in front of you
 * is written to every side when it ends (`write`, which says who it missed).
 */
export function WorkoutRunner({ session, entry, entries = [], onRun, onExit, onFinish = null, who = null, switcher = null, shown = true, together = null }) {
  const pres = entry?.data?.plan || null
  const steps = useMemo(() => prescriptionSteps(pres), [pres])
  const liftField = liftFieldOf(usePlan())
  const run = entry?.data?.run || null

  const [now, setNow] = useState(() => Date.now())
  const [cursor, setCursor] = useState(() => run?.cursor || firstOpen(run, steps))
  const [draft, setDraft_] = useState(null)
  const [listOpen, setListOpen] = useState(false)
  const [muted, setMuted] = useState(false)
  const [confirmExit, setConfirmExit] = useState(false)
  const lock = useRef(null)
  const rangAt = useRef(0)

  useModalLayer()

  /*
   * A circuit block (issue #68) runs on the interval timer's screen. A plan
   * that is nothing but circuits goes straight to it, so an ab circuit is open,
   * Start, and it runs; in a plan with other work the circuit is a step that
   * says what it is and starts when asked, and so does a shared workout's side
   * that is not on screen: each person's clock starts on their own Start
   * (`circuitToOpen`). One whose timer is on the entry
   * (left open, or the page reloaded) comes back running.
   */
  // A circuit that can be done together waits on its start screen, where that is chosen.
  const [circuitId, setCircuitId] = useState(() => circuitToOpen(pres, run, { shown: shown && !together?.offer }))
  // Each circuit done together on this screen: its result, and what each other
  // side said (null while asking). Try again asks again (lib/trainer.js).
  const [shared, setShared] = useState([])
  const shareResult = async (result) => {
    const same = (x) => x.result.key === result.key && x.result.block.id === result.block.id
    setShared(list => [...list.filter(x => !same(x)), { result, said: null }])
    let said
    try { said = await together.write(result) } catch { said = null }
    setShared(list => list.map(x => (same(x) ? { result, said: said || [] } : x)))
  }
  // Straight on from one circuit to the next in a plan of circuits, said in its count-in.
  const [chained, setChained] = useState(false)
  const circuitBlock = circuitId ? (pres?.blocks || []).find(b => b.id === circuitId && b.circuit) || null : null

  const step = steps.find(s => s.setId === cursor) || steps[0] || null
  const progress = runProgress(run, steps)
  const rest = restLeft(run, now)
  const elapsed = runElapsed(run, now)
  const done = progress.left === 0 && progress.total > 0

  /* ------------------------------------------------------------ the clock */

  // A repaint tick, nothing more. Every value on screen is derived by
  // subtracting from Date.now(), so a throttled background tab cannot drift the
  // session — it just repaints less often while nobody is looking.
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(iv)
  }, [])

  // The screen stays on while the user is in here, and the audio context is retaken
  // after the phone has been in a pocket — backgrounding suspends it and coming
  // back does not always resume, which looks exactly like a broken timer.
  useEffect(() => {
    let live = true
    acquireWakeLock().then(l => { if (live) lock.current = l; else releaseWakeLock(l) })
    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      setNow(Date.now())
      resumeAudio()
      acquireWakeLock().then(l => { lock.current = l })
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      live = false
      document.removeEventListener('visibilitychange', onVis)
      releaseWakeLock(lock.current)
    }
  }, [])

  /*
   * The rest bell.
   *
   * Fires once, on the transition to zero, keyed by the deadline it belongs to —
   * `rangAt` rather than a boolean, because a second rest of the same length must
   * ring again and a re-render must not.
   *
   * It also asks the service worker to post a notification, which is best effort
   * and honestly so: if iOS has frozen the tab there is no timer left to fire,
   * and there is no reliable way to schedule a local notification from a page.
   * The clock is still correct when the user comes back, which is the guarantee that
   * actually matters.
   */
  useEffect(() => {
    if (!run?.restUntil || rest > 0) return
    if (rangAt.current === run.restUntil) return
    rangAt.current = run.restUntil
    if (!shown) return
    if (!muted) CUES.work()
    if (document.visibilityState !== 'visible') notifyRestOver(step)
  }, [rest, run?.restUntil, muted, step, shown])

  /* ------------------------------------------------------------- the draft */

  // What is in the boxes for the set the user is on. Recomputed when the set changes,
  // never while the user is typing in it.
  useEffect(() => {
    if (!step) { setDraft_(null); return }
    const carried = isLogged(run, step.setId) ? null : carryForward(run, steps, step)
    setDraft_(carried ? { ...setDraft(run, step), ...carried } : setDraft(run, step))
  }, [cursor, step?.setId])

  const patch = (p) => setDraft_(d => ({ ...(d || {}), ...p }))

  /* ------------------------------------------------------------- the writes */

  /** Persist run state, and the outputs it implies where they changed. */
  const commit = useCallback((nextRun, { outputs = false, done = undefined } = {}) => {
    onRun(nextRun, {
      out: outputs ? runOutputs(pres, nextRun, entry?.data?.out || {}) : null,
      done,
    })
  }, [onRun, pres, entry])

  const mark = () => {
    if (!step) return
    primeAudio()
    if (!muted && shown) CUES.setDone()
    const next = markSet(run || emptyRun(), step, draft || {}, { steps })
    commit(next, { outputs: true })
    setCursor(next.cursor)
  }

  const unmark = (setId) => {
    const next = unmarkSet(run, setId)
    commit(next, { outputs: true })
    setCursor(setId)
  }

  const skip = () => {
    if (!step) return
    const next = skipSet(run || emptyRun(), step.setId, { steps })
    commit(next)
    setCursor(next.cursor)
  }

  /**
   * One more set of the one the user is on, with the numbers in the boxes right now.
   * The plan grows a set at the end of this item and nothing else moves: the
   * cursor stays where it is (the user has not marked this set yet), the draft is
   * untouched, and `out` is left off because no logged set changed. The clock is
   * not started by it either — adding a set is not doing one.
   */
  const addAnother = () => {
    if (!step) return
    onRun(run, { plan: addSetLike(pres, step.itemId, { ...step.set, ...(draft || {}) }) })
  }

  // What this exercise's weight means (#58), on the plan, and on the log in the
  // same write once a set of it is logged, so every set and the log say the same.
  const patchThisItem = (p) => onRun(run, patchRunItem(pres, run, step.itemId, p, entry?.data?.out || {}, liftField))

  const jump = (setId) => {
    commit(goToSet(run || emptyRun(), setId))
    setCursor(setId)
    setListOpen(false)
  }

  const finish = () => {
    if (!muted && shown) CUES.finished()
    // Done, the outputs and the end time in one write, for the same reason as
    // above — `onSetDone` used to be a second call and would have taken the run
    // with it.
    commit(finishRun(run || emptyRun()), { outputs: true, done: true })
    // With more than one side, finishing one hands over to the next (SidesWorkout).
    ;(onFinish || onExit)()
  }

  if (circuitBlock) {
    const only = circuitOnly(pres)
    return (
      <CircuitRun key={circuitBlock.id} pres={pres} block={circuitBlock} run={run} only={only}
        together={together} onShare={shareResult}
        shared={shared} onRetry={() => shared.filter(x => x.said?.some(y => y.status === 'missed')).forEach(x => shareResult(x.result))}
        intro={chained ? `Next: ${circuitBlock.name}` : null}
        onNext={(id) => { setChained(true); setCircuitId(id) }}
        who={who} switcher={switcher} shown={shown}
        onRun={(next, opts) => (next ? commit(next, opts) : onRun(null, {}))}
        onBack={() => {
          setCircuitId(null)
          setChained(false)
          if (only) (onFinish || onExit)()
          else setCursor(c => firstOpen(entry?.data?.run, steps) || c)
        }}
        onLeave={onExit} />
    )
  }

  if (!pres || !steps.length) {
    return (
      <div className="run" data-tone={who ? who.tone : undefined}>
        {switcher}
        <div className="run-empty">
          <p>This session has no plan on it.</p>
          <button className="btn" onClick={onExit}>Back</button>
        </div>
      </div>
    )
  }

  /* ---------------------------------------------------------------- render */

  return (
    <div className="run" data-tone={who ? who.tone : undefined}>
      <header className="run-head">
        <button className="run-x" onClick={() => setConfirmExit(true)} aria-label="Leave the workout">
          <Icon name="ChevronDown" size={22} />
        </button>
        <div className="run-headmid">
          <div className="run-title">
            {who && <span className="side-who" data-tone={who.tone}>{who.name}</span>}
            {pres.title}
          </div>
          <div className="run-sub">{progress.done} of {progress.total} sets</div>
        </div>
        <button className={`run-mute ${muted ? 'on' : ''}`} onClick={() => setMuted(v => !v)}
          aria-label={muted ? 'Unmute cues' : 'Mute cues'}>
          <Icon name={muted ? 'VolumeX' : 'Volume2'} size={19} />
        </button>
        <span className="run-clock">{mmss(elapsed)}</span>
      </header>

      {switcher}

      <div className="run-bar" role="progressbar" aria-valuenow={progress.done} aria-valuemax={progress.total}>
        <span className="run-bar-fill" style={{ width: `${Math.round(progress.pct * 100)}%` }} />
      </div>

      {rest > 0 ? (
        <RestScreen seconds={rest} of={run.restOf} next={step}
          onAdd={(n) => commit(nudgeRest(run, n))}
          onSkip={() => commit(endRest(run))} />
      ) : done ? (
        <FinishScreen progress={progress} elapsed={elapsed}
          onFinish={finish} onReview={() => setListOpen(true)} />
      ) : step?.block?.circuit ? (
        <CircuitStep block={step.block} together={together}
          onStart={() => setCircuitId(step.blockId)}
          onSkip={() => {
            const next = endCircuit(run, pres, step.blockId, [], {})
            commit(next)
            setCursor(next.cursor)
          }} />
      ) : step ? (
        <SetScreen
          step={step} steps={steps} run={run} draft={draft} entries={entries} entryId={entry?.id}
          briefing={briefingFor(pres, step)}
          onPatch={patch} onMark={mark} onSkip={skip} onUnmark={() => unmark(step.setId)} onAddSet={addAnother}
          onPatchItem={patchThisItem}
          onList={() => setListOpen(true)} />
      ) : null}

      {listOpen && (
        <SetList pres={pres} steps={steps} run={run} cursor={cursor} onJump={jump}
          onUnmark={unmark} onUnskip={(id) => { commit(unskipSet(run, id)); setCursor(id) }}
          onClose={() => setListOpen(false)} onFinish={finish} />
      )}

      {confirmExit && (
        <div className="run-confirm">
          <div className="run-confirm-box" role="dialog" aria-label="Leave the workout?">
            <h3>Leave the workout?</h3>
            <p className="sub">Every set you marked is saved, and the clock keeps running.</p>
            {/* One primary: finishing is the decision this asks for; leaving it open
                is the quieter second, and Keep going backs out. */}
            <div className="run-confirm-acts">
              <button className="btn ghost" onClick={() => setConfirmExit(false)}>Keep going</button>
              <button className="btn secondary" onClick={onExit}>Leave it open</button>
              <button className="btn" onClick={finish}>Finish now</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* --------------------------------------------------------------- circuits */

/**
 * A circuit block, run on the interval timer's screen (timer.jsx `TimerRun`),
 * its program compiled from the block (lib/prescription.js `blockTimer`). The
 * timer's position lives on the entry as `run.circuit`, written through the
 * runner's one writer like everything else here, so a closed app or another
 * device comes back to the same second.
 *
 * When it ends, finished or stopped, what each exercise did each round is
 * marked on the run (`endCircuit`) and the log follows in the same write. A
 * plan that is nothing but circuits is finished and done in that write too, as
 * "Finish and log it" would; in a bigger plan the runner carries on with what
 * is next. Stopped before anything was done, it is as if it never started.
 */
function CircuitRun({
  pres, block, run, only, intro = null, who, switcher, shown, onRun, onNext, onBack, onLeave,
  together = null, onShare = null, shared = [], onRetry = null,
}) {
  const config = useMemo(() => blockTimer(block), [block])
  const program = useMemo(() => compile(config), [config])
  const live = run?.circuit?.block === block.id && run.circuit.timer ? run.circuit.timer : null
  const [initial] = useState(() => live || startRun(program, Date.now()))
  // Together or not is decided at Start, and kept on the entry so a reload remembers it.
  const [withThem] = useState(() => Boolean(together && (live ? run.circuit.together : together.offer && together.on)))
  // Who was offered Together as it started (side ids, null the owner): the only
  // people its result is written for, kept on the run for a reload.
  const [withIds] = useState(() => (live ? run.circuit.with || null : together?.offerTo || null))
  const [logged, setLogged] = useState(null)
  const runRef = useRef(run)
  runRef.current = run

  const save = (timer) => {
    const base = runRef.current || emptyRun(timer.startedAt)
    onRun({ ...base, startedAt: base.startedAt || timer.startedAt,
      circuit: { block: block.id, timer, ...(withThem ? { together: true, with: withIds } : {}) } }, {})
  }
  // Starting is a write: the entry says it is running from the first second.
  useEffect(() => { if (!live) save(initial) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const onTimer = (timer) => {
    if (timer.finishedAt == null) { save(timer); return }
    const done = circuitDone(program, timer)
    const base = runRef.current
    if (!done.some(d => d.length)) {
      const rest = { ...(base || {}), circuit: null }
      const untouched = !Object.keys(rest.sets || {}).length && !(rest.skipped || []).length
      onRun(untouched ? null : rest, {})
      onBack()
      return
    }
    const at = timer.finishedAt
    const seconds = timerView(program, timer, at).elapsed
    // Keyed by the clock's start, so writing this result again changes nothing.
    const key = timer.startedAt
    const next = endCircuit(base, pres, block.id, done, { at, seconds, key })
    const all = runProgress(next, prescriptionSteps(pres)).left === 0
    const then = only && !all ? nextCircuit(pres, next) : null
    if (only && all) onRun(finishRun(next, { at }), { outputs: true, done: true })
    else onRun(next, { outputs: true })
    // Done together: the same result on every other side, each through its own writer.
    if (withThem && onShare) {
      onShare({
        block: { uid: block.uid || null, id: block.id, name: block.name },
        items: block.items.map(it => ({ uid: it.uid || null, name: it.name })),
        done, at, seconds, key, ...(withIds ? { with: withIds } : {}),
      })
    }
    // A plan of circuits runs the next one straight after, not back to the day.
    if (then) { onNext(then.id); return }
    setLogged(only && all ? 'Logged' : 'Logged on this workout')
  }

  /*
   * Done together, the words come from what each side SAID (rule 5): who it is
   * logged for, who already had it or is running their own, and who it is not on
   * yet, with Try again. Never "for you and Sam" over a miss.
   */
  const mine = shared.find(x => x.result.block.id === block.id)
  const told = withThem && mine ? togetherSaid(together.host, mine.said) : null
  const missedAll = [...new Set(shared.flatMap(x => (x.said || []).filter(y => y.status === 'missed').map(y => y.name)))]
  const after = told || missedAll.length ? (
    <div className="it-missed" role="status">
      {told?.notes.map(n => <p key={n}>{n}</p>)}
      {mine && mine.said === null && <p className="sub">Saving to {andWords(together.names)}&rsquo;s log…</p>}
      {missedAll.length > 0 && (<>
        <p role="alert">Not on {andWords(missedAll)}&rsquo;s log yet</p>
        <button className="btn secondary it-wide" onClick={onRetry}>
          <Icon name="RotateCw" size={16} /> Try again
        </button>
      </>)}
    </div>
  ) : null

  return (
    <TimerRun name={block.name} title={pres.title && pres.title !== block.name ? pres.title : null}
      config={config} initialRun={initial} onRun={onTimer} logged={told && logged ? told.head : logged} intro={intro} after={after}
      onClose={onBack} onLeave={onLeave} closeLabel={only ? 'Close' : 'Back to the workout'}
      who={who} switcher={switcher} shown={shown} />
  )
}

/**
 * A circuit's start screen: what it is, and Start. On a shared workout with
 * sync on it also asks whether it is done together (`together`): one clock,
 * logged for everyone in it. Remembered per device; on until turned off.
 */
function CircuitStep({ block, onStart, onSkip, together = null }) {
  const config = blockTimer(block)
  const total = totalSeconds(compile(config))
  return (
    <div className="run-body">
      <div className="run-where"><span>{block.name} · Circuit</span></div>
      <h2 className="run-move">{block.name}</h2>
      <p className="run-target">{describe(config)}{total ? ` · ${clock(total)}` : ''}</p>
      <ol className="run-circuit">
        {block.items.map(it => (
          <li key={it.id}><span>{it.name}</span><span className="sub">{timingWords(circuitTiming(it), block.circuit.work)}</span></li>
        ))}
      </ol>
      {together?.offer && !together.busyOn && (
        <label className="cx-switch run-together">
          <span className="cx-switchwords">
            <span>{together.words}</span>
            <span className="sub">{together.on
              ? `One clock, logged for ${andWords([together.host, ...together.names])}`
              : 'Each of you starts your own'}</span>
          </span>
          <input type="checkbox" role="switch" className="switch" checked={together.on}
            onChange={e => together.onToggle(e.target.checked)} />
        </label>
      )}
      {together?.busyOn ? (
        <p className="run-cue brief"><Icon name="Timer" size={14} />
          <span>Running together on {together.busyOn === 'your' ? 'your' : `${together.busyOn}’s`} side. It logs here when it ends.</span></p>
      ) : (
        <div className="run-acts">
          <button className="btn big run-done" onClick={onStart}>
            <Icon name="Play" size={22} /><span>Start the circuit</span>
          </button>
          <div className="run-acts-row">
            <button className="btn quiet" onClick={onSkip}><Icon name="SkipForward" size={16} /> Skip</button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------- one set */

/**
 * The prose a block carries, shown on the set it belongs to.
 *
 * A block may be nothing BUT prose — "5 min easy bike, then two ramp-up sets
 * with the bar" is a real warm-up with no sets in it, and the planner is told to
 * write those as a block note rather than as an item with no work in it. That
 * block has no step, so without this it would exist in the sheet and be invisible
 * for the whole of the session it is the warm-up for.
 *
 * Shown on the FIRST set of a block and nowhere else, because a cue repeated on
 * every set of five is a cue the user stops reading by set two. The leading note-only
 * blocks ride along with the first real set of the session, which is where the
 * warm-up actually belongs.
 */
function briefingFor(pres, step) {
  const blocks = pres?.blocks || []
  const here = blocks.findIndex(b => b.id === step.blockId)
  if (here < 0) return []
  const block = blocks[here]
  // Not the first set of the block: the user is mid-way through and has read it.
  if (block.items[0]?.id !== step.itemId || step.index !== 0) return []

  const out = []
  // Prose blocks that come before the first block with any work in it.
  const firstReal = blocks.findIndex(b => b.items.length > 0)
  if (here === firstReal) {
    for (let i = 0; i < here; i += 1) {
      if (!blocks[i].items.length && blocks[i].note) out.push({ name: blocks[i].name, note: blocks[i].note })
    }
  }
  if (block.note) out.push({ name: block.name, note: block.note })
  return out
}

function SetScreen({ step, steps, run, draft, entries, entryId, briefing = [], onPatch, onMark, onSkip, onUnmark, onList, onAddSet, onPatchItem }) {
  const { item } = step
  const liftField = liftFieldOf(usePlan())
  const logged = isLogged(run, step.setId)
  const prior = useMemo(
    () => (item.exercise ? lastLift(entries, item.exercise, entryId, liftField, item.kind === 'lift' ? measureOfItem(item) : null) : null),
    [entries, item, entryId, liftField])
  const muscles = musclesOf(liftField, item.exercise)
  const swap = weightSwitch(liftField, item, onPatchItem)
  const [about, setAbout] = useState(false)

  const target = setLine(step.set, item)
  const mine = steps.filter(s => s.itemId === item.id)
  const doneHere = mine.filter(s => isLogged(run, s.setId)).length

  return (
    <div className="run-body">
      <div className="run-where">
        <span>{step.blockName} · Set {step.index + 1} of {step.of}</span>
        {/* One more of these, same numbers. Quiet and beside the count it changes,
            because the big button on this screen is for marking a set and a second
            one would compete with it; the 44px target is padding. */}
        <button className="run-addset" onClick={onAddSet}
          aria-label={`One more set of ${item.name}, same as this one`}>
          <Icon name="Plus" size={14} /> Add a set
        </button>
      </div>

      {/* A catalog movement's name opens what it is (issue #63), for the set
          you are about to do; nothing else on this screen moves. */}
      {item.exercise ? (
        <h2 className="run-move">
          <button type="button" className="run-moveabout" onClick={() => setAbout(true)}
            aria-label={`${item.name}: how to do it`}>
            {item.name} <Icon name="Info" size={18} />
          </button>
        </h2>
      ) : <h2 className="run-move">{item.name}</h2>}
      {about && <ExerciseSheet field={liftField} exercise={item.exercise} name={item.name} onClose={() => setAbout(false)} />}
      {item.implementLabel && <div className="run-impl">{item.implementLabel}</div>}

      {/* What it works. Bigger here than anywhere else, because this is the one
          screen the user is looking at while doing it. */}
      {muscles && (
        <div className="run-body-map">
          <ExerciseBody field={liftField} exercise={item.exercise} name={item.name} size={52} />
          <span className="run-muscles">{muscleWords(muscles, 4)}</span>
        </div>
      )}

      <p className="run-target">Planned <strong>{target}</strong></p>

      {/* The same fields the editor shows, from the same function — a box the user can
          plan in and not record in is worse than no box. See setFieldsFor. */}
      <div className="run-inputs">
        {setFieldsFor(item, step.set).map(f => (
          <BigStepper key={f} {...STEP[f](item, step.set)} value={draft?.[f]}
            swap={f === 'weight' ? swap : null}
            onChange={v => onPatch({ [f]: v })} />
        ))}
      </div>

      {briefing.map((b, i) => (
        <p key={i} className="run-cue brief">
          <Icon name="ClipboardCheck" size={14} />
          <span><strong>{b.name}.</strong> {b.note}</span>
        </p>
      ))}

      {(step.set.note || item.note) && (
        <p className="run-cue"><Icon name="Info" size={14} /> {step.set.note || item.note}</p>
      )}

      {prior && (
        <p className="run-prior">
          <Icon name="RotateCw" size={13} /> last time ({prior.date}): {prior.summary}
          {prior.implement ? ` · ${prior.implement}` : ''}
        </p>
      )}

      {/* Lifting has no programmed rest — rest between sets is not prescribed —
          and `normalizeSet` drops the field for a lift item, so a
          stepper here would be editing a number nothing reads. An interval piece
          keeps it: the rest at the wall IS the set. */}
      {item.kind !== 'lift' && (
        <div className="run-restplan">
          <Stepper label="rest" value={draft?.restSec ?? step.set.restSec ?? 0} step={15} min={0} suffix=" sec" quiet
            onChange={v => onPatch({ restSec: v })} />
          <span className="sub">starts when you mark the set</span>
        </div>
      )}

      {/* ONE primary on this screen (docs/DESIGN.md D7): Done set. A set already
          marked offers its undo as a secondary in the same place instead. */}
      <div className="run-acts">
        {logged ? (
          <button className="btn big secondary run-done" onClick={onUnmark}>
            <Icon name="RotateCw" size={20} />
            <span>Undo this set</span>
          </button>
        ) : (
          <button className="btn big run-done" onClick={onMark}>
            <Icon name="Check" size={24} />
            <span>Done set</span>
          </button>
        )}
        <div className="run-acts-row">
          <button className="btn quiet" onClick={onSkip}>
            <Icon name="SkipForward" size={16} /> Skip
          </button>
          <span className="run-acts-mid">{doneHere} of {step.of} · {itemLine(item)}</span>
          <button className="btn quiet" onClick={onList}>
            <Icon name="Layers" size={16} /> All sets
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * A number, at the size a phone needs.
 *
 * Its own component rather than the editor's `Stepper` because the two are
 * genuinely different controls: that one sits six to a row in a list, this one
 * is two to a screen with 64px targets and a value you can read from arm's
 * length on the floor.
 */
function BigStepper({ label, value, step = 1, min = null, onChange, swap = null }) {
  const n = Number(value)
  const bump = (d) => {
    const next = (Number.isFinite(n) ? n : 0) + d * step
    onChange(min !== null ? Math.max(min, next) : next)
  }
  return (
    <div className="bigstep">
      <button className="bigstep-btn" onClick={() => bump(-1)} aria-label={`less ${label}`}>
        <Icon name="Minus" size={26} />
      </button>
      <div className="bigstep-mid">
        {/* A placeholder, because an empty box with a label under it reads as a
            control that failed to render. Blank is a real and common state here:
            the planner leaves a weight out rather than invent one, and a dash is
            how the app says "you tell me". */}
        <NumInput className="bigstep-in" aria-label={label} placeholder="—"
          value={value} onChange={onChange} />
        {swap ? (
          <button type="button" className="bigstep-label stepper-swap" onClick={swap.onSwitch}
            aria-label={`Weight in ${label}. Switch to ${swap.next}`}>
            <SwapWords label={swap.box} size={13} />
          </button>
        ) : <span className="bigstep-label">{label}</span>}
      </div>
      <button className="bigstep-btn" onClick={() => bump(1)} aria-label={`more ${label}`}>
        <Icon name="Plus" size={26} />
      </button>
    </div>
  )
}

/* ---------------------------------------------------------------- resting */

/**
 * The rest, given the whole screen.
 *
 * Big enough to read from the floor, and the two nudge buttons are the ones the user
 * will actually want: a set that went badly needs another thirty seconds and a
 * set that went well does not need the full ninety. "Skip" is the third, and it
 * is deliberately the smallest of the three — the commonest mistake is not
 * resting long enough.
 */
function RestScreen({ seconds, of, next, onAdd, onSkip }) {
  const pct = of > 0 ? Math.max(0, Math.min(1, seconds / of)) : 0
  return (
    <div className="run-body rest">
      <div className="rest-label">Rest</div>
      <div className="rest-clock" style={{ '--pct': pct }}>
        <span>{mmss(seconds)}</span>
      </div>

      <div className="rest-nudge">
        <button className="btn secondary" onClick={() => onAdd(-15)}><Icon name="Minus" size={18} /> 15s</button>
        <button className="btn secondary" onClick={() => onAdd(30)}><Icon name="Plus" size={18} /> 30s</button>
      </div>

      {next && (
        <p className="rest-next">
          Next: <strong>{next.item.name}</strong> · Set {next.index + 1} of {next.of}
          {' · '}{setLine(next.set, next.item)}
        </p>
      )}

      {/* No primary while resting: the commonest mistake is not resting long enough,
          so ending it early is a quiet button, not the big one. */}
      <div className="run-acts">
        <button className="btn ghost run-skip" onClick={onSkip}>
          <Icon name="SkipForward" size={18} />
          <span>Skip the rest</span>
        </button>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- finished */

function FinishScreen({ progress, elapsed, onFinish, onReview }) {
  return (
    <div className="run-body finish">
      <span className="finish-ico"><Icon name="CircleCheck" size={44} /></span>
      <h2>That is everything</h2>
      <p className="sub">
        {progress.done} of {progress.total} sets in {mmss(elapsed)}
        {progress.skipped ? ` · ${progress.skipped} skipped` : ''}
      </p>
      <div className="run-acts">
        <button className="btn big run-done" onClick={onFinish}>
          <Icon name="Flag" size={22} /><span>Finish and log it</span>
        </button>
        <div className="run-acts-row center">
          <button className="btn quiet" onClick={onReview}><Icon name="Layers" size={16} /> Go back over the sets</button>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- every set */

/**
 * The whole session as a list — where you go to jump, to fix a set you marked
 * wrong, or to see what is left. A sheet rather than a permanent column, because
 * on a phone it would cost the set screen the room that makes it readable.
 */
function SetList({ pres, steps, run, cursor, onJump, onUnmark, onUnskip, onClose, onFinish }) {
  // Blocks that are only prose have no rows, so they get named here rather than
  // being missing from the one screen that claims to show the whole session.
  const proseBlocks = (pres?.blocks || []).filter(b => !b.items.length && b.note)
  // One section per exercise: its name as the head, its sets as rows in one card.
  const groups = []
  for (const s of steps) {
    const g = groups.at(-1)
    if (g && g.itemId === s.itemId) g.sets.push(s)
    else groups.push({ itemId: s.itemId, item: s.item, blockName: s.blockName, sets: [s] })
  }
  return (
    <div className="setlist-scrim" onClick={onClose} role="presentation">
      <div className="setlist" onClick={e => e.stopPropagation()} role="dialog" aria-label="All sets">
        <header className="setlist-head">
          <span>All sets</span>
          <button className="iconbtn" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </header>
        <div className="setlist-body">
          {proseBlocks.map(b => (
            <div key={b.id} className="setlist-prose">
              <strong>{b.name}</strong>
              <span className="sub">{b.note}</span>
            </div>
          ))}
          {groups.map(g => (
            <section key={g.itemId} aria-label={g.item.name}>
              <div className="section-head">
                <h3>{g.item.name}</h3>
                <span className="sub">{g.blockName}</span>
              </div>
              <div className="card list setlist-card">
                {g.sets.map(s => {
                  const logged = isLogged(run, s.setId)
                  const skipped = isSkipped(run, s.setId)
                  const actual = run?.sets?.[s.setId]
                  return (
                    <div key={s.setId} className={`list-row setlist-row ${logged ? 'done' : ''} ${skipped ? 'skipped' : ''} ${s.setId === cursor ? 'here' : ''}`}>
                      <button className="setlist-go" onClick={() => onJump(s.setId)}
                        aria-current={s.setId === cursor ? 'step' : undefined}>
                        <Icon name={logged ? 'CircleCheck' : skipped ? 'SkipForward' : 'Circle'} size={20} />
                        <span className="list-row-main">
                          <span className="list-row-title">
                            {logged && actual ? setLine(actual, s.item) : setLine(s.set, s.item)}
                          </span>
                          <span className="list-row-meta">
                            Set {s.index + 1}{logged ? ' · Done' : skipped ? ' · Skipped' : s.setId === cursor ? ' · Next' : ''}
                          </span>
                        </span>
                      </button>
                      {logged && (
                        <button className="iconbtn setlist-undo" onClick={() => onUnmark(s.setId)} aria-label={`Undo set ${s.index + 1} of ${s.item.name}`}>
                          <Icon name="RotateCw" size={17} />
                        </button>
                      )}
                      {skipped && (
                        <button className="iconbtn setlist-undo" onClick={() => onUnskip(s.setId)} aria-label={`Put set ${s.index + 1} of ${s.item.name} back`}>
                          <Icon name="RotateCw" size={17} />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
        <footer className="setlist-foot">
          <button className="btn" onClick={onFinish}><Icon name="Flag" size={16} /> Finish and log it</button>
        </footer>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ the bell */

/**
 * A notification when the rest ends and the phone is in their pocket.
 *
 * Best effort, and said out loud because the failure mode is silent: a page that
 * iOS has frozen has no timer left to fire this, and there is no way to schedule
 * a local notification from a page in advance. What is guaranteed is that the
 * clock is right when the user looks — that is what `restUntil` being absolute buys,
 * and this is a bonus on top of it.
 */
function notifyRestOver(step) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    navigator.serviceWorker?.ready?.then(reg => {
      reg.showNotification('Rest is up', {
        body: step ? `${step.item.name} · set ${step.index + 1} of ${step.of}` : 'Back to it.',
        tag: 'bushido-rest',
        renotify: true,
        silent: false,
      })
    })
  } catch { /* no notifications here, and nothing depends on them */ }
}
