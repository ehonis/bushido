/*
 * Workout mode — the screen you actually train in front of.
 *
 * Everything else in this app is for deciding what to do and recording what you
 * did. This is the bit in between: a whole screen, one set at a time, that
 * counts the reps so you don't have to and takes one tap per SET rather than
 * per rep — the user marks sets, not reps — and it is also the only shape that survives being
 * used with chalk on your hands halfway through a hang.
 *
 * Design rules, all of them learned from the rest of this app:
 *
 *   - The numbers are pre-filled from the prescription. A session you did as
 *     written is zero typing; you confirm and move on.
 *   - The exercise's how-to is on the screen, not in a document you were
 *     supposed to have read. It opens itself during the count-in and between
 *     sets — the moments you have hands free — and shrinks to a picture and one
 *     line while you're working, because during a hang the clock is the only
 *     thing that matters.
 *   - Sets write straight into `out.sets`, the same structure the per-set log
 *     uses, so the charts, the history editor and the totals never learn that
 *     workout mode exists.
 *   - A rest with no number behind it counts UP instead of down. See
 *     lib/workout.js — inventing a rest period is worse than not having one.
 *   - Nothing here is required. You can walk in halfway, jump to any set, edit
 *     anything, and leave without finishing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import { Figure } from './lib/figures.jsx'
import { HowRow, HowSheet, HowBody } from './howto.jsx'
import { CUES, primeAudio, resumeAudio, acquireWakeLock, releaseWakeLock } from './lib/cues.js'
import {
  buildSteps, writeSet, truncateSets, clock, interval, elapsedMinutes, loggedSeconds,
  startOf, advancePhase, afterSet, LEAD_IN,
} from './lib/workout.js'
import { totalSets, totalReps, GradeLaps, ClimbLog } from './setlog.jsx'
import {
  GRADE_FIELD, hasGrades, fitGrades, repCount,
  CLIMB_FIELD, fitClimbs, stepClimbs, fallsIn,
} from './lib/grades.js'

const FIELD_LABEL = { reps: 'reps', seconds: 'secs', weight: 'lb' }

/** Which sound marks entering each phase. Distinct enough to train by ear. */
const CUE_FOR = {
  countin: 'countIn', work: 'work', represt: 'rest', setrest: 'rest', finished: 'finished',
}

/** Where to drop you in: the first set you haven't logged yet. */
function firstUnlogged(steps) {
  const i = steps.findIndex(s => !s.logged)
  return i === -1 ? Math.max(0, steps.length - 1) : i
}

export function WorkoutMode({ session, entry, onSave, onSetDone, onExit }) {
  const out = entry?.data?.out || {}
  const steps = useMemo(() => buildSteps(session, out), [session, out])

  const [i, setI] = useState(() => firstUnlogged(steps))
  const [phase, setPhase] = useState('idle') // idle|countin|work|represt|review|setrest|finished
  const [rep, setRep] = useState(1)
  const [phaseAt, setPhaseAt] = useState(() => Date.now())
  const [deadline, setDeadline] = useState(0) // 0 = counts up, no target
  const [paused, setPaused] = useState(false)
  const [heldMs, setHeldMs] = useState(0) // remaining when paused
  const [draft, setDraft] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  const [muted, setMuted] = useState(false)
  const [confirmExit, setConfirmExit] = useState(false)
  const [startedAt, setStartedAt] = useState(() => out.startedAt || null)
  const [finalMin, setFinalMin] = useState('')
  const [howOpen, setHowOpen] = useState(false)

  const step = steps[i] || null
  const timing = step?.timing || { work: null, reps: 1, repRest: null, setRest: null }
  const lock = useRef(null)

  const cue = useCallback((name) => { if (!muted) CUES[name]?.() }, [muted])

  /* ------------------------------------------------------------ the clock */

  // Repaint only. Every actual transition is driven by an exact timeout below,
  // so a throttled background tab can't drift the workout.
  useEffect(() => {
    if (paused || phase === 'idle' || phase === 'review' || phase === 'finished') return
    const iv = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(iv)
  }, [paused, phase])

  const left = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null
  const counted = Math.max(0, Math.floor((now - phaseAt) / 1000))
  const elapsed = startedAt ? Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000)) : 0

  /* ------------------------------------------------------- phase changes */

  /** Move to a computed position and start its clock. */
  const enter = useCallback((next) => {
    const at = Date.now()
    setPhase(next.phase)
    setRep(next.rep)
    setI(next.index)
    setPhaseAt(at)
    setDeadline(next.seconds ? at + next.seconds * 1000 : 0)
    setPaused(false)
    setHeldMs(0)
    if (next.phase !== 'review') setDraft(null)
    if (CUE_FOR[next.phase]) cue(CUE_FOR[next.phase])
  }, [cue])

  /** Stop the set here and confirm what actually happened. */
  const goReview = useCallback((repsDone) => {
    const s = steps[i]
    if (!s) return
    const values = { ...s.values }
    /*
     * What the timer counted is the honest default — but only where it counted
     * something. On a set with no clock the timer never left rep 1, and the
     * prescription is a far better guess at how many press-ups you just did.
     *
     * `timing.reps > 1` is the same guard from the other side: an ARC bout is one
     * 20-minute interval whose REPS are laps, which the clock has no way of
     * counting. Writing the clock's 1 into that field would be the app claiming
     * the user climbed a single lap in twenty minutes.
     */
    if (timing.work && timing.reps > 1 && s.fields.includes('reps') && repsDone != null) {
      values.reps = repsDone
    }
    if (s.fields.includes('seconds')) {
      const secs = loggedSeconds(timing, { phase, measured: (Date.now() - phaseAt) / 1000 })
      if (secs != null) values.seconds = secs
    }
    setDraft(values)
    setPhase('review')
    setDeadline(0)
    setPaused(false)
    cue('setDone')
  }, [steps, i, timing.work, phase, phaseAt, cue])

  const beginSet = useCallback((index, opts) => enter(startOf(index, steps, opts)), [enter, steps])

  const advance = useCallback(() => {
    const next = advancePhase({ phase, rep, index: i }, steps)
    if (next.phase === 'review') { goReview(timing.reps); return }
    enter(next)
  }, [phase, rep, i, steps, timing.reps, enter, goReview])

  // The exact transition. Re-armed whenever the deadline or pause state moves.
  useEffect(() => {
    if (paused || !deadline) return
    const ms = deadline - Date.now()
    if (ms <= 0) { advance(); return }
    const t = setTimeout(advance, ms)
    return () => clearTimeout(t)
  }, [deadline, paused, advance])

  /*
   * Three pips into every change of phase.
   *
   * Keyed on the phase's start instant as well as the second, so two phases
   * that happen to end the same way each get their own count rather than the
   * second one being swallowed as a repeat. This is also the thing that tells
   * you the sound is working at all: a cue that only fires on the switch is
   * indistinguishable from a broken speaker until the switch arrives.
   */
  const ticked = useRef('')
  useEffect(() => {
    if (paused || left == null || left <= 0 || left > 3) return
    const key = `${phaseAt}:${left}`
    if (ticked.current === key) return
    ticked.current = key
    cue('tick')
  }, [left, paused, phaseAt, cue])

  /* --------------------------------------------------------- screen + audio */

  const active = phase !== 'idle' && phase !== 'finished'

  useEffect(() => {
    if (!active) return
    let dead = false
    acquireWakeLock().then(l => { if (dead) releaseWakeLock(l); else lock.current = l })
    // Locks are dropped whenever the tab is hidden; take it back on return.
    const retake = () => {
      if (document.visibilityState !== 'visible') return
      if (!lock.current) acquireWakeLock().then(l => { lock.current = l })
      resumeAudio()
      setNow(Date.now())
    }
    document.addEventListener('visibilitychange', retake)
    return () => {
      dead = true
      document.removeEventListener('visibilitychange', retake)
      releaseWakeLock(lock.current)
      lock.current = null
    }
  }, [active])

  /* ---------------------------------------------------------- the actions */

  const start = () => {
    primeAudio()
    const at = startedAt || new Date().toISOString()
    if (!startedAt) { setStartedAt(at); onSave({ ...out, startedAt: at }) }
    // The long count-in, not the between-sets one: you are still holding the
    // phone. Skipping it is one tap for the days you are already chalked and set.
    beginSet(i, { lead: LEAD_IN })
  }

  /**
   * `heldMs` means two different things depending on which way the clock runs:
   * what's LEFT on a countdown, and how far a count-up had got. Resuming has to
   * restore the right one, or pausing mid-rest on an untimed set silently
   * restarts the rest at zero.
   */
  const pause = () => {
    const at = Date.now()
    if (paused) {
      if (deadline) setDeadline(at + heldMs)
      else setPhaseAt(at - heldMs)
      setPaused(false)
    } else {
      setHeldMs(deadline ? Math.max(0, deadline - at) : at - phaseAt)
      setPaused(true)
    }
  }

  const bump = (seconds) => {
    if (!deadline) return
    setDeadline(d => Math.max(Date.now() + 1000, d + seconds * 1000))
  }

  /** Save the reviewed set and move on. */
  const commitSet = (last = false) => {
    const s = steps[i]
    if (!s) return
    let next = writeSet(out, s.exKey, s.setIndex, draft || s.values)
    if (last) next = truncateSets(next, s.exKey, s.setIndex + 1)
    onSave(next)
    enter(afterSet({ index: i }, steps, { last }))
  }

  const finish = (markDone) => {
    const mins = Number(finalMin) || elapsedMinutes(startedAt) || null
    const next = { ...out }
    if (mins) next.elapsedMin = mins
    delete next.startedAt
    onSave(next)
    if (markDone) onSetDone?.(true)
    onExit()
  }

  /* ------------------------------------------------------------- rendering */

  if (!steps.length) {
    return (
      <div className="wo">
        <WoHead session={session} elapsed={0} onExit={onExit} muted={muted} onMute={setMuted} />
        <div className="wo-body">
          <p className="empty">
            This session has no per-set prescription, so there is nothing to step through.
            Log it from the session sheet instead.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={`wo wo-${phase}`} role="dialog" aria-modal="true" aria-label={`${session.name} workout`}>
      <WoHead session={session} elapsed={elapsed} onExit={() => (active ? setConfirmExit(true) : onExit())}
        muted={muted} onMute={setMuted} />

      <div className="wo-body">
        {phase === 'idle' && <Intro session={session} steps={steps} onStart={start} resumed={Boolean(startedAt)} />}

        {phase === 'finished' && (
          <Finish session={session} out={out} startedAt={startedAt}
            value={finalMin} onValue={setFinalMin} onFinish={finish} />
        )}

        {active && phase !== 'review' && step && (
          <Face phase={phase} left={left} counted={counted} rep={rep} timing={timing} step={step}
            paused={paused} onPause={pause} onBump={bump}
            onSkip={advance} onHow={() => setHowOpen(true)}
            onEndSet={() => goReview(phase === 'work' ? rep : timing.reps)} />
        )}

        {phase === 'review' && step && (
          <Review step={step} draft={draft || step.values} onDraft={setDraft}
            onCommit={commitSet} isLastSet={i === steps.length - 1} />
        )}

        {phase !== 'finished' && (
          <Rail steps={steps} current={i}
            onJump={(n) => { setDraft(null); setI(n); setPhase('idle'); setDeadline(0) }} />
        )}
      </div>

      {howOpen && step?.how && (
        <HowSheet how={step.how} title={step.exName} onClose={() => setHowOpen(false)} />
      )}

      {confirmExit && (
        <div className="wo-confirm">
          <p>Leave the workout? Every set you've marked is already saved.</p>
          <div className="wo-confirm-btns">
            <button className="btn ghost" onClick={() => setConfirmExit(false)}>Keep going</button>
            <button className="btn" onClick={onExit}>Leave</button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ pieces */

function WoHead({ session, elapsed, onExit, muted, onMute }) {
  return (
    <header className="wo-head">
      <button className="modal-btn" onClick={onExit} aria-label="Leave workout">
        <Icon name="ChevronDown" size={19} style={{ transform: 'rotate(90deg)' }} />
      </button>
      <div className="wo-title">
        <div className="wo-name">{session.name}</div>
        <div className="wo-elapsed"><Icon name="Timer" size={12} /> {clock(elapsed)}</div>
      </div>
      <button className="modal-btn" onClick={() => onMute(!muted)} aria-pressed={muted}
        aria-label={muted ? 'Unmute cues' : 'Mute cues'} title={muted ? 'Cues off' : 'Cues on'}>
        <Icon name={muted ? 'VolumeX' : 'Volume2'} size={18} />
      </button>
    </header>
  )
}

/**
 * What you're about to do. The exercise list doubles as the how-to: every row
 * opens into its own steps, so the answer to "wait, which one is this?" is on
 * the screen you already start from rather than in the session sheet you left.
 */
function Intro({ session, steps, onStart, resumed }) {
  const byEx = []
  for (const s of steps) {
    const last = byEx.at(-1)
    if (last && last.key === s.exKey) last.n++
    else byEx.push({ key: s.exKey, name: s.exName, n: 1, timing: s.timing, how: s.how })
  }
  const done = steps.filter(s => s.logged).length
  const [open, setOpen] = useState(byEx[0]?.key || null)

  return (
    <div className="wo-intro">
      <p className="wo-lead">
        {resumed || done
          ? `Picking up where you left off — ${done} of ${steps.length} sets already marked.`
          : 'One set at a time. The timer counts the reps; you mark the set.'}
      </p>

      <div className="how-list">
        {byEx.map(e => (
          <HowRow key={e.key} exercise={{ name: e.name, how: e.how }}
            open={open === e.key} onToggle={() => setOpen(open === e.key ? null : e.key)}
            meta={`${e.n} × ${e.timing.work ? interval(e.timing.work) : 'set'}`} />
        ))}
      </div>

      <button className="btn wo-start" onClick={onStart}>
        <Icon name="Play" size={18} /> {done ? 'Continue workout' : 'Start workout'}
      </button>

      {/* Worth one tap before a session rather than finding out three sets in.
          The commonest cause of a silent timer is the iPhone ring switch, which
          this either fixes on the spot or proves is the problem. */}
      <button className="wo-link" onClick={() => { primeAudio(); CUES.work() }}>
        <Icon name="Volume2" size={15} /> Test the sound
      </button>

      <p className="wo-note">
        Timed sets run themselves — {LEAD_IN}s to get set after you tap start, then it counts
        you in and switches on its own. Screen stays awake while it runs, and each change of
        phase beeps. Both need the HTTPS address to work reliably — see the README.
      </p>
    </div>
  )
}

const PHASE_LABEL = { countin: 'Get ready', work: 'Work', represt: 'Rest', setrest: 'Rest between sets' }

export function Face({ phase, left, counted, rep, timing, step, paused, onPause, onBump, onSkip, onEndSet, onHow }) {
  const showing = left != null ? left : counted
  const pips = timing.reps > 1 && timing.reps <= 24
  // A set with no clock ends when you say it does, so ending it is the main
  // action on the screen and gets a button rather than a link under the fold.
  // Buried as a link, it read as "there is nowhere to tap but Skip".
  const openEnded = left == null && phase === 'work'
  /*
   * A clock with no target ends when you say so, and the screen said "tap done"
   * over a line of plain text — so the obvious thing to tap was the number, and
   * the number did nothing. Now it is the button. Both open-ended phases get
   * one: counting up through a set ends it, and an untargeted rest starts the
   * next one. A countdown stays inert, because there the clock is information
   * and a stray tap mid-hang should cost nothing.
   */
  const tap = openEnded ? onEndSet : (left == null && phase === 'setrest') ? onSkip : null
  const Clock = tap ? 'button' : 'div'
  // The rest between sets is the one stretch with both hands free and minutes
  // to spare, so that is where the how-to opens itself instead of waiting to be
  // asked. Everywhere else it collapses to a picture and one line: mid-hang the
  // clock is the only thing worth the screen.
  const reading = phase === 'setrest' && step.how

  return (
    <div className={`wo-face p-${phase} ${paused ? 'paused' : ''}`}>
      <div className="wo-where">
        {step.exName} · set {step.setIndex + 1} of {step.setCount}
      </div>

      {step.how && !reading && (
        <button className="wo-how" onClick={onHow}>
          <span className="wo-howfig"><Figure name={step.how.figure} /></span>
          <span className="wo-howgist">{step.how.gist}</span>
          <span className="wo-howmore">How</span>
        </button>
      )}

      <Clock className={`wo-clock ${tap ? 'tappable' : ''}`} onClick={tap || undefined}>
        <div className="wo-phase">{PHASE_LABEL[phase]}{paused ? ' · paused' : ''}</div>
        <div className="wo-count">{left != null ? clock(showing) : clock(counted)}</div>
        {left == null && (
          <div className="wo-untimed">
            {openEnded
              ? 'No target on this one — tap the clock when the set is done.'
              : 'Rest as long as you need. Tap the clock to start the next set.'}
          </div>
        )}
      </Clock>

      {phase !== 'setrest' && timing.reps > 1 && (
        pips ? (
          <div className="wo-pips" aria-label={`rep ${rep} of ${timing.reps}`}>
            {Array.from({ length: timing.reps }, (_, n) => (
              <span key={n} className={`wo-pip ${n + 1 < rep ? 'done' : n + 1 === rep ? 'on' : ''}`} />
            ))}
          </div>
        ) : (
          <div className="wo-repcount">rep {rep} of {timing.reps}</div>
        )
      )}

      {openEnded && (
        <button className="btn wo-setdone" onClick={onEndSet}>
          <Icon name="Check" size={18} /> Done — log this set
        </button>
      )}

      <div className="wo-ctl">
        {left != null && (
          <button className="wo-btn" onClick={() => onBump(-15)} aria-label="15 seconds less">
            <Icon name="Minus" size={16} /> 15s
          </button>
        )}
        <button className="wo-btn primary" onClick={onPause}>
          <Icon name={paused ? 'Play' : 'Pause'} size={18} />
          {paused ? 'Resume' : 'Pause'}
        </button>
        {left != null && (
          <button className="wo-btn" onClick={() => onBump(15)} aria-label="15 seconds more">
            <Icon name="Plus" size={16} /> 15s
          </button>
        )}
      </div>

      <div className="wo-ctl2">
        <button className="wo-link" onClick={onSkip}>
          <Icon name="SkipForward" size={15} /> {phase === 'setrest' ? 'Start next set' : 'Skip ahead'}
        </button>
        {phase !== 'setrest' && !openEnded && (
          <button className="wo-link" onClick={onEndSet}>
            <Icon name="Flag" size={15} /> End set here
          </button>
        )}
      </div>

      {reading && (
        <div className="wo-hownext">
          <div className="wo-hownexth">
            <Icon name="PersonStanding" size={14} /> Next up — {step.exName}
          </div>
          <HowBody how={step.how} />
        </div>
      )}
    </div>
  )
}

/**
 * Exported for the smoke suite, the same reason `Face` is: the review screen is
 * where every set is actually written down, and a per-rep field that quietly
 * renders nothing loses the grades rather than the whole session.
 */
export function Review({ step, draft, onDraft, onCommit, isLastSet }) {
  const set = (field, value) => {
    const next = { ...draft, [field]: value === '' ? '' : Number(value) }
    // The grade pickers follow the rep count here too, so correcting "that was
    // three laps not two" on this screen grows the list rather than losing a lap.
    if (field === 'reps' && hasGrades(step.fields)) {
      next[GRADE_FIELD] = fitGrades(next[GRADE_FIELD], next.reps)
    }
    onDraft(next)
  }
  const perRep = hasGrades(step.fields)
  const what = step.repName || 'rep'

  /*
   * The optional per-climb detail, offered HERE as well as in the set log.
   *
   * The board is the first session to have both a clock and this offer, and it
   * is the one where the detail is worth most: its own target is "one fall or
   * fewer across all four intervals", and the only moment anybody honestly
   * knows which problem that fall was on is the twenty seconds after the
   * interval. So the same toggle the set log has appears on the screen the user is
   * already holding, and writes into the same `climbs` list.
   *
   * The plan offers it (`step.climbLog`); the draft says whether this set IS
   * logging it. Presence of the list is the state, exactly as in the set log.
   */
  const detailed = Array.isArray(draft[CLIMB_FIELD])
  const setDetail = (on) => {
    if (!on) {
      const { [CLIMB_FIELD]: dropped, ...rest } = draft
      onDraft(rest)
      return
    }
    // Reps is normalised on the way in, because from here the list is the source
    // of truth and the box only displays it.
    onDraft({ ...draft, reps: repCount(draft.reps), [CLIMB_FIELD]: fitClimbs(draft[CLIMB_FIELD], draft.reps) })
  }
  // While the detail is on, the count moves one at a time and only from here —
  // typing "12" over a 10 passes through "1", and that refit used to delete the
  // climbs already entered. Same rule, same reason, as the set log's steppers.
  const bump = (delta) => onDraft(stepClimbs(draft, delta))
  const falls = detailed ? fallsIn([draft]) : 0

  return (
    <div className="wo-review">
      <div className="wo-where">{step.exName} · set {step.setIndex + 1} of {step.setCount}</div>
      <h3 className="wo-reviewh">What actually happened?</h3>
      <p className="wo-reviewsub">Pre-filled from the plan. Change anything that didn't match.</p>

      {step.climbLog && (
        <button type="button" className={`signtog ${detailed ? 'on' : ''}`} aria-pressed={detailed}
          onClick={() => setDetail(!detailed)}>
          {detailed ? `logging each ${what}` : `log each ${what}`}
        </button>
      )}

      <div className="wo-fields">
        {step.fields.filter(f => f !== GRADE_FIELD).map(f => (
          <label key={f} className="wo-field">
            <span>{FIELD_LABEL[f] || f}{f === 'weight' && step.sign === '-' ? ' (off)' : ''}</span>
            {f === 'reps' && detailed ? (
              <span className="repstep wo-repstep">
                <button type="button" className="repstep-b" onClick={() => bump(-1)}
                  aria-label={`one fewer ${what}`}>−</button>
                <input type="number" inputMode="decimal" readOnly value={repCount(draft.reps)} />
                <button type="button" className="repstep-b" onClick={() => bump(1)}
                  aria-label={`one more ${what}`}>+</button>
              </span>
            ) : (
              <input type="number" inputMode="decimal" step={f === 'weight' ? 0.5 : 1}
                value={draft[f] ?? ''} onChange={e => set(f, e.target.value)} />
            )}
          </label>
        ))}
      </div>

      {detailed && (
        <div className="wo-climbs">
          <span className="wo-gradesh">
            each {what}{falls > 0 ? ` · fell on ${falls}` : ''}
          </span>
          <ClimbLog count={repCount(draft.reps)} values={draft[CLIMB_FIELD]}
            spec={step.climbLog} what={what} omitGrade={perRep}
            where={`set ${step.setIndex + 1} `}
            onChange={list => onDraft({ ...draft, [CLIMB_FIELD]: list })}
            onMore={repCount(draft.reps) < 20 ? () => bump(1) : undefined} />
        </div>
      )}

      {/* A grade per rep, because the two laps of a double are not always the
          same route — the same control as the per-set log. */}
      {perRep && (
        <div className="wo-grades">
          <span className="wo-gradesh">grade per {step.repName || 'rep'}</span>
          <GradeLaps count={repCount(draft.reps)} values={draft[GRADE_FIELD]}
            what={step.repName || 'rep'} where={`set ${step.setIndex + 1} `}
            onChange={list => onDraft({ ...draft, [GRADE_FIELD]: list })} />
        </div>
      )}

      <button className="btn wo-setdone" onClick={() => onCommit(false)}>
        <Icon name="Check" size={18} /> Set done
      </button>

      {!isLastSet && (
        <button className="wo-link wo-lastset" onClick={() => onCommit(true)}>
          <Icon name="Flag" size={15} /> That was my last set of {step.exName.toLowerCase()}
        </button>
      )}
    </div>
  )
}

function Rail({ steps, current, onJump }) {
  const groups = []
  for (const [n, s] of steps.entries()) {
    const last = groups.at(-1)
    if (last && last.key === s.exKey) last.items.push({ n, s })
    else groups.push({ key: s.exKey, name: s.exName, items: [{ n, s }] })
  }

  return (
    <div className="wo-rail">
      {groups.map(g => (
        <div key={g.key} className="wo-railrow">
          <span className="wo-railname">{g.name}</span>
          <span className="wo-railsets">
            {g.items.map(({ n, s }) => (
              <button key={n} onClick={() => onJump(n)}
                className={`wo-railset ${s.logged ? 'done' : ''} ${n === current ? 'on' : ''}`}
                aria-label={`${g.name} set ${s.setIndex + 1}`}>
                {s.logged ? <Icon name="Check" size={13} /> : s.setIndex + 1}
              </button>
            ))}
          </span>
        </div>
      ))}
    </div>
  )
}

function Finish({ session, out, startedAt, value, onValue, onFinish }) {
  const measured = elapsedMinutes(startedAt)
  const sets = totalSets(out)
  const reps = totalReps(out)

  return (
    <div className="wo-finish">
      <div className="wo-finishico"><Icon name="CircleCheck" size={44} /></div>
      <h3>{session.name} — done</h3>

      <div className="wo-finishstats">
        <div><strong>{sets}</strong><span>sets</span></div>
        {reps > 0 && <div><strong>{reps}</strong><span>reps</span></div>}
        {measured != null && <div><strong>{measured}</strong><span>minutes</span></div>}
      </div>

      <label className="wo-field wo-minutes">
        <span>Minutes to record</span>
        <input type="number" inputMode="numeric" value={value}
          placeholder={measured != null ? String(measured) : String(session.minutes ?? '')}
          onChange={e => onValue(e.target.value)} />
      </label>
      <p className="wo-note">
        Measured from when you hit start. This is what the weekly training-load chart multiplies
        by your RPE, so a real number beats the card's nominal one.
      </p>

      <button className="btn wo-start" onClick={() => onFinish(true)}>
        <Icon name="CircleCheck" size={18} /> Finish &amp; mark done
      </button>
      <button className="wo-link" onClick={() => onFinish(false)}>
        Save the sets, but don't mark it done
      </button>
    </div>
  )
}
