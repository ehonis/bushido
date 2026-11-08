/*
 * The runner, as state (#98): the writes every tap makes, and one hook that the
 * web's `WorkoutRunner` (app/src/runner.jsx) and the phone's
 * (mobile/src/features/runner.tsx) both run, so each platform keeps only its
 * screens. What the planner got from lib/planflow.js, for the screen the owner
 * edits weights on mid-workout.
 *
 * Invariants kept here, so neither view can lose them:
 * - ONE writer. Every tap is one `onRun(run, opts)`: the position, and in the
 *   same call the log (`out`) and the done flag when they changed. Two calls once
 *   spread the same entry, so the second landed on the first and every marked set
 *   came back as set one with the clock at zero.
 * - `out` is left off (null) a write that changes no logged set (a skip, a jump,
 *   a clock nudge): recomputing the log on every tick is work for no change.
 * - Every write goes through `reopened` (lib/timer.js): a finished workout opened
 *   again is running again from the first thing done in it.
 * - The clocks are instants on the run (`restUntil`, `run.hold`, `run.circuit`):
 *   nothing here counts down, it subtracts, so a closed app comes back right.
 *
 * Sounds and haptics differ by platform, so they are not here: the hook calls
 * `feedback(event, { muted, shown, … })` and each view decides. The events are
 * named after the taps: mark, unmark, skip, unskip, addSet, jump, holdStart,
 * holdAct, holdStop, holdEnd, finish, cue (a hold's segment changed: `cue`),
 * restOver (the rest ran out: `step`, `restUntil`; once per deadline).
 * The rest's own controls (Back, ±10, Pause, Skip) and the weight's meaning
 * send none, on purpose: neither runner sounded or buzzed on them before the
 * move (ControlRow's buttons answer the press themselves), so adding events
 * here would have changed what a tap feels like.
 *
 * On someone else's copy (`sharedFrom`, #96) the plan is read as SHOWN
 * (`presOf` = lib/shared.js `planShown`: no owner's words), and every write
 * of the plan puts the hidden words back as stored (`withStoredWords`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  prescriptionSteps, runProgress, firstOpen, runElapsed,
  markSet, unmarkSet, skipSet, unskipSet, endRest, goToSet, finishRun,
  emptyRun, setDraft, carryForward, runOutputs, isLogged, addSetLike, patchRunItem,
  endCircuit, circuitToOpen, nextCircuit,
} from './prescription.js'
import {
  compile, circuitDone, view as timerView, settle, moved, cueFor, holdConfig, holdOn, startHold, heldSeconds,
  restClock, restPausedAt, toggleRest, bumpRest, restBack, reopened,
} from './timer.js'
import { planShown, withStoredWords } from './shared.js'
import { togetherItems } from './trainer.js'

/**
 * @typedef {[any, { out?: any, done?: boolean, plan?: any }]} RunWrite
 *   What one tap writes: the next run and the options `onRun` takes.
 * @typedef {{ write: RunWrite, cursor?: string | null }} RunTap
 *   A write, and where the runner's cursor goes after it (absent: it stays).
 */

/* --------------------------------------------------------------- writes */

const runOf = (entry) => entry?.data?.run || null
// The plan as this log's person sees it: never the owner's notes on a copy
// (lib/shared.js `planShown`, #96). A write of the plan puts them back (`withStoredWords`).
export const presOf = (entry) => planShown(entry)

/**
 * A write of the run, and the log it implies when `outputs` (a logged set changed).
 * @param {any} entry @param {any} nextRun @param {{ outputs?: boolean, done?: boolean }} [opts]
 * @returns {RunWrite}
 */
export function commitOf(entry, nextRun, { outputs = false, done = undefined } = {}) {
  const r = reopened(nextRun, runOf(entry))
  return [r, { out: outputs ? runOutputs(presOf(entry), r, entry?.data?.out || {}) : null, done }]
}

/**
 * A write that carries its own options (a plan grown by a set, a weight's meaning).
 * @param {any} entry @param {any} nextRun @param {any} opts @returns {RunWrite}
 */
export const writeOf = (entry, nextRun, opts) => [reopened(nextRun, runOf(entry)), opts]

/** Done set: the numbers in the boxes, the log with it, on to the next. @returns {RunTap} */
export function markTap(entry, steps, step, draft) {
  const next = markSet(runOf(entry) || emptyRun(), step, draft || {}, { steps })
  return { write: commitOf(entry, next, { outputs: true }), cursor: next.cursor }
}

/** Undo a set: off the run and the log, and the cursor on it. @returns {RunTap} */
export const unmarkTap = (entry, setId) => ({ write: commitOf(entry, unmarkSet(runOf(entry), setId), { outputs: true }), cursor: setId })

/** Skip the set the runner is on. The log is untouched. @returns {RunTap} */
export function skipTap(entry, steps, step) {
  const next = skipSet(runOf(entry) || emptyRun(), step.setId, { steps })
  return { write: commitOf(entry, next), cursor: next.cursor }
}

/** Put a skipped set back, and go to it. @returns {RunTap} */
export const unskipTap = (entry, setId) => ({ write: commitOf(entry, unskipSet(runOf(entry), setId)), cursor: setId })

/**
 * One more set of the one the runner is on, with the numbers in the boxes now.
 * The plan grows a set at the end of the item and nothing else moves: not the
 * cursor, not the draft, not the log, not the clock. @returns {RunTap}
 */
export const addSetTap = (entry, step, draft) =>
  ({ write: writeOf(entry, runOf(entry), { plan: withStoredWords(entry, addSetLike(presOf(entry), step.itemId, { ...step.set, ...(draft || {}) })) }) })

/**
 * What this exercise's weight means (#58): the plan, and the log once a set of
 * it is logged. The plan it changes is the one SHOWN, so the words hidden from
 * a copy go back as stored (`withStoredWords`), as Add a set's do: written from
 * the shown plan, the switch dropped the owner's notes from Sam's stored copy.
 * @returns {RunTap}
 */
export function patchItemTap(entry, step, patch, liftField) {
  const next = patchRunItem(presOf(entry), runOf(entry), step.itemId, patch, entry?.data?.out || {}, liftField)
  return { write: writeOf(entry, runOf(entry), { ...next, plan: withStoredWords(entry, next.plan) }) }
}

/** A set chosen from All sets. @returns {RunTap} */
export const jumpTap = (entry, setId) => ({ write: commitOf(entry, goToSet(runOf(entry) || emptyRun(), setId)), cursor: setId })

/** Finish: the log, done and the end in ONE write. @returns {RunTap} */
export const finishTap = (entry) => ({ write: commitOf(entry, finishRun(runOf(entry) || emptyRun()), { outputs: true, done: true }) })

/* The rest: an instant on the run, moved, paused, ended or taken back to the set. */
/** @returns {RunTap} */
export function restBackTap(entry) {
  const next = restBack(runOf(entry))
  return { write: commitOf(entry, next), cursor: next.cursor }
}
/** @returns {RunTap} */
export const restBumpTap = (entry, delta, at = Date.now()) => ({ write: commitOf(entry, bumpRest(runOf(entry), at, delta)) })
/** @returns {RunTap} */
export const restPauseTap = (entry, at = Date.now()) => ({ write: commitOf(entry, toggleRest(runOf(entry), at)) })
/** @returns {RunTap} */
export const restSkipTap = (entry) => ({ write: commitOf(entry, endRest(runOf(entry))) })

/* A timed set's clock (#75): `run.hold`, started, nudged, stopped, ended. */

/** Start: the draft's seconds, else the plan's. @returns {RunTap} */
export function holdStartTap(entry, step, draft, at = Date.now()) {
  const seconds = Number(draft?.seconds) > 0 ? draft.seconds : step.set.seconds
  return { write: commitOf(entry, startHold(runOf(entry) || emptyRun(at), step.setId, seconds, at, { name: step.item.name, key: step.item.exercise || null })) }
}

/** One of the clock's controls (`fn` from lib/timer.js: back, bump, skip, togglePause). @returns {RunTap} */
export function holdActTap(entry, hold, program, fn, at = Date.now(), ...args) {
  const run = runOf(entry)
  return { write: commitOf(entry, { ...run, hold: { ...hold, timer: fn(program, settle(program, hold.timer, at), at, ...args) } }) }
}

/** Stop the clock: nothing is logged. @returns {RunTap} */
export const holdStopTap = (entry) => ({ write: commitOf(entry, { ...runOf(entry), hold: null }) })

/**
 * The clock ran out: the set is marked with the seconds held. Under DONE_AFTER
 * (`secs` null: a mis-tap, a look) it marks nothing and the set is as it was.
 * @returns {RunTap}
 */
export function holdEndTap(entry, steps, step, draft, secs) {
  const base = { ...runOf(entry), hold: null }
  if (secs == null) return { write: commitOf(entry, base) }
  const next = markSet(base, step, { ...(draft || {}), seconds: secs }, { steps })
  return { write: commitOf(entry, next, { outputs: true }), cursor: next.cursor }
}

/** Skip a whole circuit (asked first): none of it is logged. @returns {RunTap} */
export function skipCircuitTap(entry, step) {
  const next = endCircuit(runOf(entry), presOf(entry), step.blockId, [], {})
  return { write: commitOf(entry, next), cursor: next.cursor }
}

/* ------------------------------------------------------------ circuits */

/**
 * A circuit's clock as it stands, on the run (`run.circuit`), so a closed app or
 * another device comes back to the same second. Together or not, and with whom,
 * is decided at Start and kept with it.
 */
export function circuitSaved(run, blockId, timer, { together = false, withIds = null } = {}) {
  const base = run || emptyRun(timer.startedAt)
  return { ...base, startedAt: base.startedAt || timer.startedAt,
    circuit: { block: blockId, timer, ...(together ? { together: true, with: withIds } : {}) } }
}

/**
 * Every change of a circuit's clock, and what follows it. Still running: the
 * clock is saved. Ended with nothing done: as if it never started (`back`).
 * Ended with work done: each exercise's rounds marked (`endCircuit`, keyed by
 * the clock's start so writing it twice changes nothing) and the log in the same
 * write; a plan of nothing but circuits is finished and done with its last, and
 * runs the next straight after (`next`). Done together, `share` is the result
 * for every other side (the Together rule, lib/trainer.js).
 *
 * `write` is `[run | null, opts]`: a null run takes the run off the entry.
 */
export function circuitTick({ run, pres, block, program, timer, only, together = false, withIds = null }) {
  if (timer.finishedAt == null) return { write: [circuitSaved(run, block.id, timer, { together, withIds }), {}] }
  const done = circuitDone(program, timer)
  if (!done.some(d => d.length)) {
    const rest = { ...(run || {}), circuit: null }
    const untouched = !Object.keys(rest.sets || {}).length && !(rest.skipped || []).length
    return { write: [untouched ? null : rest, {}], back: true }
  }
  const at = timer.finishedAt
  const seconds = timerView(program, timer, at).elapsed
  const key = timer.startedAt
  const next = endCircuit(run, pres, block.id, done, { at, seconds, key })
  const all = runProgress(next, prescriptionSteps(pres)).left === 0
  const then = only && !all ? nextCircuit(pres, next) : null
  const write = only && all ? [finishRun(next, { at }), { outputs: true, done: true }] : [next, { outputs: true }]
  const share = together ? {
    block: { uid: block.uid || null, id: block.id, name: block.name },
    items: togetherItems(block),
    done, at, seconds, key, ...(withIds ? { with: withIds } : {}),
  } : null
  return { write, ended: true, share, next: then ? then.id : null, logged: then ? null : (only && all ? 'Logged' : 'Logged on this workout') }
}

/* ------------------------------------------------------------- the hook */

/**
 * The runner's state and taps. `onRun(run, opts)` is the one writer; `onExit`
 * leaves; `onFinish` (else `onExit`) follows a finish, so a workout with sides
 * hands over to the next (`SidesWorkout`). `shown` false: a side not on screen,
 * whose clock runs but which never sounds. `together`: a shared workout's
 * circuit done on one clock (#68). `feedback(event, info)`: the platform's
 * sounds and haptics (see the top of this file).
 *
 * @param {{
 *   entry: any, onRun: (run: any, opts: any) => void, onExit: () => void, onFinish?: (() => void) | null,
 *   shown?: boolean, together?: any, liftField?: any, feedback?: (event: string, info: any) => void,
 * }} args
 */
export function useRunner({ entry, onRun, onExit, onFinish = null, shown = true, together = null, liftField = null, feedback = () => {} }) {
  const pres = presOf(entry)
  const steps = useMemo(() => prescriptionSteps(pres), [pres])
  const run = runOf(entry)

  const [now, setNow] = useState(() => Date.now())
  const [cursor, setCursor] = useState(() => run?.cursor || firstOpen(run, steps))
  const [draft, setDraft_] = useState(/** @type {any} */ (null))
  const [listOpen, setListOpen] = useState(false)
  const [muted, setMuted] = useState(false)
  // The leave dialog: null, 'ask' (Keep going / Leave it open / Finish…), or
  // 'finish' (finishing with sets still to do asks again).
  const [leaving, setLeaving] = useState(/** @type {null | 'ask' | 'finish'} */ (null))
  const [skipping, setSkipping] = useState(false) // a whole circuit's Skip asks first
  const rangAt = useRef(0)

  /*
   * A circuit block (#68) runs on the interval timer's screen. A plan of nothing
   * but circuits goes straight to it; in a plan with other work it is a step that
   * starts when asked, and so is a shared workout's side not on screen: each
   * person's clock starts on their own Start (`circuitToOpen`). A circuit that
   * can be done together waits on its start screen, where that is chosen.
   */
  const [circuitId, setCircuitId] = useState(() => circuitToOpen(pres, run, { shown: shown && !together?.offer }))
  // Each circuit done together on this screen: its result, and what each other
  // side said (null while asking). Try again asks again (lib/trainer.js).
  const [shared, setShared] = useState(/** @type {{ result: any, said: any[] | null }[]} */ ([]))
  // Straight on from one circuit to the next in a plan of circuits, said in its count-in.
  const [chained, setChained] = useState(false)
  const circuitBlock = circuitId ? (pres?.blocks || []).find(b => b.id === circuitId && b.circuit) || null : null

  const step = steps.find(s => s.setId === cursor) || steps[0] || null
  const progress = runProgress(run, steps)
  // The rest stands still while paused (lib/timer.js `restClock`).
  const rest = restClock(run, now)
  const restPaused = restPausedAt(run) != null
  const elapsed = runElapsed(run, now)
  const done = progress.left === 0 && progress.total > 0

  // A timed set's clock (#75), on the run (`run.hold`), so it survives the app closing.
  const hold = step ? holdOn(run, step.setId) : null
  const holdProgram = useMemo(
    () => (hold ? compile(holdConfig(hold.seconds, { name: step.item.name, key: step.item.exercise || null })) : null),
    [hold?.seconds, step?.item?.name, step?.item?.exercise]) // eslint-disable-line react-hooks/exhaustive-deps -- the program is the hold's seconds and the exercise, not the objects holding them
  const holdNow = hold ? settle(holdProgram, hold.timer, now) : null

  const info = (more = {}) => ({ muted, shown, ...more })
  const send = (/** @type {RunTap} */ tap) => {
    onRun(...tap.write)
    if (tap.cursor !== undefined) setCursor(tap.cursor)
  }

  // A repaint tick, nothing more: every value on screen is subtracted from Date.now().
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(iv)
  }, [])

  /*
   * The rest bell: once, on the transition to zero, keyed by the deadline it
   * belongs to (`rangAt`, not a boolean: a second rest of the same length must
   * ring again and a re-render must not). A side not on screen rings nothing.
   */
  useEffect(() => {
    if (!run?.restUntil || rest > 0) return
    if (rangAt.current === run.restUntil) return
    rangAt.current = run.restUntil
    if (!shown) return
    feedback('restOver', info({ step, restUntil: run.restUntil }))
  }, [rest, run?.restUntil, muted, step, shown]) // eslint-disable-line react-hooks/exhaustive-deps -- `feedback` is the platform's and may be a new function each render; the bell is keyed by the deadline

  // What is in the boxes for the set the runner is on. Recomputed when the set
  // changes, never while the user is typing in it.
  useEffect(() => {
    if (!step) { setDraft_(null); return }
    const carried = isLogged(run, step.setId) ? null : carryForward(run, steps, step)
    setDraft_(carried ? { ...setDraft(run, step), ...carried } : setDraft(run, step))
  }, [cursor, step?.setId]) // eslint-disable-line react-hooks/exhaustive-deps -- the boxes follow the set, never a sync of the run while typing

  const patch = (p) => setDraft_(d => ({ ...(d || {}), ...p }))

  /** Persist run state, and the outputs it implies where they changed. */
  const commit = useCallback((nextRun, opts = {}) => onRun(...commitOf(entry, nextRun, opts)), [onRun, entry])

  const mark = () => {
    if (!step) return
    feedback('mark', info())
    send(markTap(entry, steps, step, draft))
  }
  const unmark = (setId) => { feedback('unmark', info()); send(unmarkTap(entry, setId)) }
  const skip = () => {
    if (!step) return
    feedback('skip', info())
    send(skipTap(entry, steps, step))
  }
  const unskip = (setId) => { feedback('unskip', info()); send(unskipTap(entry, setId)) }
  const addSet = () => {
    if (!step) return
    feedback('addSet', info())
    send(addSetTap(entry, step, draft))
  }
  const patchItem = (p) => { if (step) send(patchItemTap(entry, step, p, liftField)) }
  const jump = (setId) => {
    feedback('jump', info())
    send(jumpTap(entry, setId))
    setListOpen(false)
  }

  const restGoBack = () => send(restBackTap(entry))
  const restBump = (n) => send(restBumpTap(entry, n, Date.now()))
  const restPause = () => send(restPauseTap(entry, Date.now()))
  const restSkip = () => send(restSkipTap(entry))

  const beginHold = () => {
    if (!step) return
    feedback('holdStart', info())
    const at = Date.now()
    send(holdStartTap(entry, step, draft, at))
    setNow(at)
  }
  const holdAct = (fn, ...args) => {
    if (!hold) return
    feedback('holdAct', info())
    const at = Date.now()
    send(holdActTap(entry, hold, holdProgram, fn, at, ...args))
    setNow(at)
  }
  const stopHold = () => { feedback('holdStop', info()); send(holdStopTap(entry)) }

  // A hold's cues, on each change of segment (the count-in ending, the hold ending).
  const heard = useRef(/** @type {any} */ (null))
  useEffect(() => {
    if (!holdNow) { heard.current = null; return }
    const was = heard.current
    heard.current = holdNow
    if (was && was.startedAt === holdNow.startedAt && moved(was, holdNow) && shown && !muted) {
      const c = cueFor(holdProgram, holdNow)
      if (c && c !== 'finished') feedback('cue', info({ cue: c }))
    }
  })

  // The end of a hold marks the set with what was held, once per clock.
  const ended = useRef(/** @type {number | null} */ (null))
  useEffect(() => {
    if (!hold || holdNow?.finishedAt == null || ended.current === hold.timer.startedAt) return
    ended.current = hold.timer.startedAt
    const secs = heldSeconds(holdProgram, holdNow)
    if (secs != null) feedback('holdEnd', info())
    send(holdEndTap(entry, steps, step, draft, secs))
  }, [holdNow?.finishedAt]) // eslint-disable-line react-hooks/exhaustive-deps -- once per clock's end, read with what is on screen then

  const finish = () => {
    setLeaving(null)
    feedback('finish', info())
    send(finishTap(entry))
    // With more than one side, finishing one hands over to the next (SidesWorkout).
    ;(onFinish || onExit)()
  }

  const skipCircuit = () => {
    setSkipping(false)
    send(skipCircuitTap(entry, step))
  }

  /* Circuits: the one write path for the circuit screen, and its comings and goings. */
  const circuitWrite = (next, opts) => (next ? commit(next, opts) : onRun(null, {}))
  const startCircuit = (blockId) => setCircuitId(blockId)
  const circuitNext = (id) => { setChained(true); setCircuitId(id) }
  const circuitBack = (only) => {
    setCircuitId(null)
    setChained(false)
    if (only) (onFinish || onExit)()
    else setCursor(c => firstOpen(runOf(entry), steps) || c)
  }
  const shareResult = async (result) => {
    const same = (x) => x.result.key === result.key && x.result.block.id === result.block.id
    setShared(list => [...list.filter(x => !same(x)), { result, said: null }])
    let said
    try { said = await together.write(result) } catch { said = null }
    setShared(list => list.map(x => (same(x) ? { result, said: said || [] } : x)))
  }
  const retryShared = () => shared.filter(x => x.said?.some(y => y.status === 'missed')).forEach(x => shareResult(x.result))

  return {
    pres, steps, run, step, cursor, draft, progress, rest, restPaused, elapsed, done, now,
    hold, holdProgram, holdNow, muted, setMuted,
    listOpen, openList: () => setListOpen(true), closeList: () => setListOpen(false),
    leaving, askLeave: () => setLeaving('ask'), askFinish: () => setLeaving('finish'), keepGoing: () => setLeaving(null),
    skipping, askSkipCircuit: () => setSkipping(true), keepCircuit: () => setSkipping(false), skipCircuit,
    circuitBlock, chained, shared, circuitWrite, startCircuit, circuitNext, circuitBack, shareResult, retryShared,
    tick: () => setNow(Date.now()),
    patch, mark, unmark, skip, unskip, addSet, patchItem, jump,
    restGoBack, restBump, restPause, restSkip, beginHold, holdAct, stopHold, finish,
  }
}
