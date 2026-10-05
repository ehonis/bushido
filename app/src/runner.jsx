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
  setFieldsFor, addSetLike,
} from './lib/prescription.js'
import { Stepper, STEP } from './exercises.jsx'
import { ExerciseBody, musclesOf, muscleWords } from './lib/bodymap.jsx'
import { liftFieldOf } from './planner.jsx'
import { usePlan } from './lib/planctx.jsx'

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
export function WorkoutRunner({ session, entry, entries = [], onRun, onExit }) {
  const pres = entry?.data?.plan || null
  const steps = useMemo(() => prescriptionSteps(pres), [pres])
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
    if (!muted) CUES.work()
    if (document.visibilityState !== 'visible') notifyRestOver(step)
  }, [rest, run?.restUntil, muted, step])

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
    if (!muted) CUES.setDone()
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

  const jump = (setId) => {
    commit(goToSet(run || emptyRun(), setId))
    setCursor(setId)
    setListOpen(false)
  }

  const finish = () => {
    if (!muted) CUES.finished()
    // Done, the outputs and the end time in one write, for the same reason as
    // above — `onSetDone` used to be a second call and would have taken the run
    // with it.
    commit(finishRun(run || emptyRun()), { outputs: true, done: true })
    onExit()
  }

  if (!pres || !steps.length) {
    return (
      <div className="run">
        <div className="run-empty">
          <p>This session has no plan on it.</p>
          <button className="btn" onClick={onExit}>Back</button>
        </div>
      </div>
    )
  }

  /* ---------------------------------------------------------------- render */

  return (
    <div className="run">
      <header className="run-head">
        <button className="run-x" onClick={() => setConfirmExit(true)} aria-label="Leave the workout">
          <Icon name="ChevronDown" size={22} />
        </button>
        <div className="run-headmid">
          <div className="run-title">{pres.title}</div>
          <div className="run-sub">{progress.done} of {progress.total} sets</div>
        </div>
        <button className={`run-mute ${muted ? 'on' : ''}`} onClick={() => setMuted(v => !v)}
          aria-label={muted ? 'Unmute cues' : 'Mute cues'}>
          <Icon name={muted ? 'VolumeX' : 'Volume2'} size={19} />
        </button>
        <span className="run-clock">{mmss(elapsed)}</span>
      </header>

      <div className="run-bar" role="progressbar" aria-valuenow={progress.done} aria-valuemax={progress.total}>
        <span className="run-bar-fill" style={{ width: `${Math.round(progress.pct * 100)}%` }} />
      </div>

      {rest > 0 ? (
        <RestScreen seconds={rest} of={run.restOf} next={step}
          onAdd={(n) => commit(nudgeRest(run, n))}
          onSkip={() => commit(endRest(run))} />
      ) : done ? (
        <FinishScreen pres={pres} progress={progress} elapsed={elapsed}
          onFinish={finish} onReview={() => setListOpen(true)} />
      ) : step ? (
        <SetScreen
          step={step} steps={steps} run={run} draft={draft} entries={entries} entryId={entry?.id}
          briefing={briefingFor(pres, step)}
          onPatch={patch} onMark={mark} onSkip={skip} onUnmark={() => unmark(step.setId)} onAddSet={addAnother}
          onList={() => setListOpen(true)} />
      ) : null}

      {listOpen && (
        <SetList pres={pres} steps={steps} run={run} cursor={cursor} onJump={jump}
          onUnmark={unmark} onUnskip={(id) => { commit(unskipSet(run, id)); setCursor(id) }}
          onClose={() => setListOpen(false)} onFinish={finish} />
      )}

      {confirmExit && (
        <div className="run-confirm">
          <div className="run-confirm-box">
            <h3>Leave the workout?</h3>
            <p className="sub">
              Everything you have marked is already saved, and the rest clock keeps running.
              Open it again from today and you will be on the same set.
            </p>
            <div className="run-confirm-acts">
              <button className="btn ghost" onClick={() => setConfirmExit(false)}>Keep going</button>
              <button className="btn" onClick={onExit}>Leave it open</button>
              <button className="btn" onClick={finish}>Finish now</button>
            </div>
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

function SetScreen({ step, steps, run, draft, entries, entryId, briefing = [], onPatch, onMark, onSkip, onUnmark, onList, onAddSet }) {
  const { item } = step
  const logged = isLogged(run, step.setId)
  const prior = useMemo(
    () => (item.exercise ? lastLift(entries, item.exercise, entryId) : null),
    [entries, item.exercise, entryId])
  const liftField = liftFieldOf(usePlan())
  const muscles = musclesOf(liftField, item.exercise)

  const target = setLine(step.set, item)
  const mine = steps.filter(s => s.itemId === item.id)
  const doneHere = mine.filter(s => isLogged(run, s.setId)).length

  return (
    <div className="run-body">
      <div className="run-where">
        <span className="run-block">{step.blockName}</span>
        <span className="run-setof">set {step.index + 1} of {step.of}</span>
        {/* One more of these, same numbers. Small and beside the count it changes,
            because the enormous button on this screen is for marking a set and a
            second one would compete with it; the 44px target is padding. */}
        <button className="run-addset" onClick={onAddSet}
          aria-label={`One more set of ${item.name}, same as this one`}>
          <Icon name="Plus" size={12} /> set
        </button>
      </div>

      <h2 className="run-move">{item.name}</h2>
      {item.implementLabel && <div className="run-impl">{item.implementLabel}</div>}

      {/* What it works. Bigger here than anywhere else, because this is the one
          screen the user is looking at while doing it. */}
      {muscles && (
        <div className="run-body-map">
          <ExerciseBody field={liftField} exercise={item.exercise} name={item.name} size={52} />
          <span className="run-muscles">{muscleWords(muscles, 4)}</span>
        </div>
      )}

      <div className="run-target">
        <span className="run-target-label">planned</span>
        <span className="run-target-value">{target}</span>
      </div>

      {/* The same fields the editor shows, from the same function — a box the user can
          plan in and not record in is worse than no box. See setFieldsFor. */}
      <div className="run-inputs">
        {setFieldsFor(item, step.set).map(f => (
          <BigStepper key={f} {...STEP[f](item, step.set)} value={draft?.[f]}
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

      <div className="run-acts">
        {logged ? (
          <button className="run-done on" onClick={onUnmark}>
            <Icon name="CircleCheck" size={26} />
            <span>Done — tap to take it back</span>
          </button>
        ) : (
          <button className="run-done" onClick={onMark}>
            <Icon name="Check" size={28} />
            <span>Mark set {step.index + 1}</span>
          </button>
        )}
        <div className="run-acts-row">
          <button className="run-minor" onClick={onSkip}>
            <Icon name="SkipForward" size={16} /> skip
          </button>
          <span className="run-acts-mid">{doneHere}/{step.of} of this one · {itemLine(item)}</span>
          <button className="run-minor" onClick={onList}>
            <Icon name="Layers" size={16} /> all sets
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
function BigStepper({ label, value, step = 1, min = null, onChange }) {
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
        <span className="bigstep-label">{label}</span>
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
      <div className="rest-label">rest</div>
      <div className="rest-clock" style={{ '--pct': pct }}>
        <span>{mmss(seconds)}</span>
      </div>

      <div className="rest-nudge">
        <button onClick={() => onAdd(-15)}><Icon name="Minus" size={20} /> 15s</button>
        <button onClick={() => onAdd(30)}><Icon name="Plus" size={20} /> 30s</button>
      </div>

      {next && (
        <p className="rest-next">
          next: <strong>{next.item.name}</strong> · set {next.index + 1} of {next.of}
          {' · '}{setLine(next.set, next.item)}
        </p>
      )}

      <div className="run-acts">
        <button className="run-done ghost" onClick={onSkip}>
          <Icon name="SkipForward" size={24} />
          <span>Skip the rest</span>
        </button>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- finished */

function FinishScreen({ pres, progress, elapsed, onFinish, onReview }) {
  return (
    <div className="run-body finish">
      <span className="finish-ico"><Icon name="CircleCheck" size={44} /></span>
      <h2>That is everything</h2>
      <p className="sub">
        {progress.done} of {progress.total} sets in {mmss(elapsed)}
        {progress.skipped ? ` · ${progress.skipped} skipped` : ''}.
      </p>
      <p className="sub">
        Finishing marks the session done and writes what you did into the log, where you can
        edit any of it. {pres.title} stays on the entry as what was asked for.
      </p>
      <div className="run-acts">
        <button className="run-done" onClick={onFinish}>
          <Icon name="Flag" size={26} /><span>Finish and log it</span>
        </button>
        <div className="run-acts-row">
          <button className="run-minor" onClick={onReview}><Icon name="Layers" size={16} /> go back over the sets</button>
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
  let lastItem = null
  // Blocks that are only prose have no rows, so they get named here rather than
  // being missing from the one screen that claims to show the whole session.
  const proseBlocks = (pres?.blocks || []).filter(b => !b.items.length && b.note)
  return (
    <div className="setlist-scrim" onClick={onClose} role="presentation">
      <div className="setlist" onClick={e => e.stopPropagation()} role="dialog" aria-label="Every set">
        <header className="setlist-head">
          <span>Every set</span>
          <button className="modal-btn" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </header>
        <div className="setlist-body">
          {proseBlocks.map(b => (
            <div key={b.id} className="setlist-prose">
              <strong>{b.name}</strong>
              <span className="sub">{b.note}</span>
            </div>
          ))}
          {steps.map(s => {
            const head = s.itemId !== lastItem ? s : null
            lastItem = s.itemId
            const logged = isLogged(run, s.setId)
            const skipped = isSkipped(run, s.setId)
            const actual = run?.sets?.[s.setId]
            return (
              <div key={s.setId}>
                {head && (
                  <div className="setlist-item">
                    <strong>{s.item.name}</strong>
                    <span className="sub">{s.blockName}</span>
                  </div>
                )}
                <div className={`setlist-row ${logged ? 'done' : ''} ${skipped ? 'skipped' : ''} ${s.setId === cursor ? 'here' : ''}`}>
                  <button className="setlist-go" onClick={() => onJump(s.setId)}>
                    <span className="setlist-n">{s.index + 1}</span>
                    <span className="setlist-target">
                      {logged && actual ? setLine(actual, s.item) : setLine(s.set, s.item)}
                    </span>
                    {logged && <span className="setlist-tag">done</span>}
                    {skipped && <span className="setlist-tag">skipped</span>}
                  </button>
                  {logged && (
                    <button className="setlist-undo" onClick={() => onUnmark(s.setId)} aria-label="Un-mark this set">
                      <Icon name="RotateCw" size={15} />
                    </button>
                  )}
                  {skipped && (
                    <button className="setlist-undo" onClick={() => onUnskip(s.setId)} aria-label="Put this set back">
                      <Icon name="RotateCw" size={15} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
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
