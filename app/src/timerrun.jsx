/*
 * The interval timer running (#98: out of timer.jsx): the face, the exercise on
 * now, the control row. A plan's circuit runs on it in the runner, so it is in
 * the main bundle with everything else a workout in progress needs; the setup,
 * presets and host (timer.jsx) are loaded when the timer is first opened.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import { CUES, primeAudio, resumeAudio, acquireWakeLock, releaseWakeLock } from './lib/cues.js'
import { clock } from './lib/workout.js'
import { compile, secondsLabel, settle, togglePause, skip, back, bump, view, cueFor, moved, stopRun, isCircuit } from './lib/timer.js'
import { exerciseOf, liftFieldOf } from './lib/lifts.js'
import { usePlan } from './lib/planctx.jsx'
import { ExerciseBody, musclesOf, muscleWords } from './lib/bodymap.jsx'
import { ExerciseSheet } from './exercises.jsx'
import { WorkHead, LeaveDialog, ControlRow } from './workchrome.jsx'

const counters = (seg, lap, repeat) => [
  seg.rounds > 1 ? `Round ${seg.round} of ${seg.rounds}` : null,
  seg.sets > 1 ? `Set ${seg.set} of ${seg.sets}` : null,
  // A circuit's exercise says where it is in the round.
  seg.ex != null && seg.exs > 1 ? `Exercise ${seg.ex + 1} of ${seg.exs}` : null,
  repeat ? `Lap ${lap}` : null,
].filter(Boolean).join(' · ')

/** The next exercise after segment `from` in a circuit, wrapping on repeat, or null. */
export function exerciseAfter(program, from) {
  const segs = program.segments
  for (let i = from + 1; i < segs.length; i++) if (segs[i].ex != null) return segs[i]
  if (program.loopFrom != null) {
    for (let i = program.loopFrom; i <= from && i < segs.length; i++) if (segs[i].ex != null) return segs[i]
  }
  return null
}

/* ------------------------------------------------- one workout chrome (#75) */


/**
 * The run screen. Exported for the smoke suite, with `now` overridable for the
 * same reason: a server render has to be able to show a given second.
 *
 * A CIRCUIT (issue #68) puts the exercise to do NOW on the face, its name as
 * big as the screen allows over the clock, with what it works and its one-line
 * gist under it and ⓘ for the whole how-to (the exercise sheet, over the run:
 * the clock does not stop for it). A rest shows what is coming instead. Its
 * stop asks whether to log what was done; `logged` is what the finish screen
 * says landed, `onLeave` (from a plan's entry) leaves it running, and with no
 * `onAgain` there is no Again.
 *
 * `after` goes under it on the finish screen (who a circuit done together did
 * not reach, with Retry). `intro` replaces "Get ready" in the count-in: the next circuit of a plan of
 * circuits says which one it is.
 *
 * `who`, `switcher`, `shown`: one side of a shared workout (trainer.jsx), as in
 * the runner. A side not on screen keeps its clock and makes no sound.
 */
export function TimerRun({
  title, name, config, initialRun, onRun = () => {}, onAgain = null, onClose, now: fixedNow = null,
  logged = null, onLeave = null, closeLabel = 'Close', who = null, switcher = null, shown = true, intro = null, after = null,
}) {
  const program = useMemo(() => compile(config), [config])
  const circuit = isCircuit(config)
  const liftField = liftFieldOf(usePlan())
  const [run, setRun] = useState(() => settle(program, initialRun, fixedNow ?? Date.now()))
  const runRef = useRef(run)
  const [now, setNow] = useState(() => fixedNow ?? Date.now())
  const [muted, setMuted] = useState(false)
  const mutedRef = useRef(muted)
  mutedRef.current = muted || !shown
  const [confirmStop, setConfirmStop] = useState(false)
  const [about, setAbout] = useState(null) // the exercise whose sheet is open, over the run
  const lock = useRef(null)
  const onRunRef = useRef(onRun)
  onRunRef.current = onRun

  const cue = (cueName) => { if (cueName && !mutedRef.current) CUES[cueName]?.() }

  /** Every change of run goes through here: kept, stored, and announced if it moved. */
  const commit = useCallback((next, t) => {
    const was = runRef.current
    if (next !== was) {
      runRef.current = next
      setRun(next)
      onRunRef.current(next)
      if (moved(was, next)) cue(cueFor(program, next))
    }
    setNow(t)
  }, [program])

  // A run that moved on while nobody was looking (a reload, a run left open)
  // is stored where it got to, and a circuit that ran out meanwhile is logged.
  useEffect(() => {
    if (fixedNow == null && run !== initialRun) onRunRef.current(run)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- once, as the screen opens: the run it came back to

  const tick = useCallback(() => {
    const t = Date.now()
    commit(settle(program, runRef.current, t), t)
  }, [program, commit])

  const act = (fn, ...args) => {
    primeAudio()
    const t = Date.now()
    commit(fn(program, runRef.current, t, ...args), t)
  }

  const v = view(program, run, now)
  const active = !v.finished
  const ticking = active && !v.paused

  // Repaint. Transitions are arithmetic in settle(), so a slow or throttled
  // interval can only make the screen late, never the timer wrong.
  useEffect(() => {
    if (!ticking) return
    const iv = setInterval(tick, 200)
    return () => clearInterval(iv)
  }, [ticking, tick])

  // And an exact wake-up at the end of the segment, so the cue lands on the second.
  useEffect(() => {
    if (!ticking || v.left == null) return
    const t = setTimeout(tick, Math.max(0, v.left * 1000) + 5)
    return () => clearTimeout(t)
  }, [ticking, run, tick]) // eslint-disable-line react-hooks/exhaustive-deps -- re-armed for each segment (`run`); `v.left` is read as of then, not followed every tick

  // Three pips into every change, the same as workout mode's.
  const ticked = useRef('')
  const whole = v.left == null ? null : Math.ceil(v.left)
  useEffect(() => {
    if (!ticking || whole == null || whole <= 0 || whole > 3) return
    const key = `${run.index}:${run.lap}:${run.at}:${whole}`
    if (ticked.current === key) return
    ticked.current = key
    cue('tick')
  }, [whole, ticking, run])

  useEffect(() => {
    if (!active) return
    let dead = false
    acquireWakeLock().then(l => { if (dead) releaseWakeLock(l); else lock.current = l })
    const retake = () => {
      if (document.visibilityState !== 'visible') return
      if (!lock.current) acquireWakeLock().then(l => { lock.current = l })
      resumeAudio()
      tick()
    }
    document.addEventListener('visibilitychange', retake)
    return () => {
      dead = true
      document.removeEventListener('visibilitychange', retake)
      releaseWakeLock(lock.current)
      lock.current = null
    }
  }, [active, tick])

  const seg = v.segment
  const kind = v.finished ? 'finished' : seg.kind
  const open = !v.finished && v.left == null
  // Tap anywhere on the clock: pause or resume. A count-up has no end of its own,
  // so there the tap IS the end, and pausing is the button below.
  const onFace = () => act(open ? skip : togglePause)
  const exNow = circuit && seg?.ex != null
  const coming = circuit && seg ? exerciseAfter(program, run.index) : null
  const where = seg ? counters(seg, v.lap, config.repeat) : ''
  const stop = () => {
    setConfirmStop(false)
    // A circuit stops where it is and logs what was done; a plain timer just closes.
    if (circuit) act(stopRun)
    else onClose()
  }

  return (
    <div className={`it it-run k-${kind}${circuit ? ' it-circuit' : ''}`} role="dialog" aria-modal="true" aria-label={`${name} timer`}
      data-tone={who ? who.tone : undefined}>
      <WorkHead title={<>{name}{title ? ` · ${title}` : ''}</>} who={who}
        sub={<span className="it-tabular"><Icon name="Timer" size={12} /> {clock(v.elapsed)}</span>}
        muted={muted} onMute={setMuted}
        onExit={() => (active ? setConfirmStop(true) : onClose())}
        exitLabel={circuit ? 'Stop the circuit' : 'Stop the timer'} />

      {switcher}

      {v.finished ? (
        <div className="it-body it-finish">
          <Icon name="CircleCheck" size={56} />
          <div className="it-phase">Done</div>
          <div className="it-count">{clock(v.elapsed)}</div>
          {logged && <p className="it-logged">{logged}</p>}
          {after}
          {onAgain && <button className="btn it-start" onClick={onAgain}><Icon name="RotateCw" size={18} /> Again</button>}
          <button className={`btn ${onAgain ? 'secondary' : ''} it-wide`} onClick={onClose}>{closeLabel}</button>
        </div>
      ) : (
        <div className="it-body it-live">
          <button className={`it-face ${v.paused ? 'paused' : ''}`} onClick={onFace}
            aria-label={open ? 'Done, next' : v.paused ? 'Resume' : 'Pause'}>
            {exNow && where && <span className="it-where">{where}</span>}
            <span className={exNow ? 'it-exname' : 'it-phase'}>{intro && seg.kind === 'countin' ? intro : seg.name}</span>
            <span className="it-count">{clock(open ? v.counted : Math.ceil(v.left))}</span>
            {!exNow && where && <span className="it-where">{where}</span>}
            {seg.note && <span className="it-note">{seg.note}</span>}
            {v.progress != null && <span className="it-bar"><span style={{ width: `${v.progress * 100}%` }} /></span>}
            <span className="it-hint">
              {v.paused ? 'Paused · tap to carry on' : open ? (exNow ? 'Tap when done' : 'No set time · tap when done') : 'Tap to pause'}
            </span>
          </button>

          {circuit && (exNow ? seg : coming) && (
            <ExerciseNow field={liftField} seg={exNow ? seg : coming} upNext={!exNow}
              onAbout={(x) => setAbout(x)} />
          )}

          {(!circuit || exNow) && (
            <div className="it-next">
              {circuit
                ? (coming ? <>Next: <strong>{coming.name}</strong> {coming.reps ? `${coming.reps} reps` : secondsLabel(coming.seconds)}</> : 'Last one')
                : (v.next ? <>Next: <strong>{v.next.name}</strong> {v.next.seconds != null ? secondsLabel(v.next.seconds) : ''}</> : 'Last one')}
            </div>
          )}

          <ControlRow paused={v.paused}
            onBack={() => act(back)}
            onLess={open ? null : () => act(bump, -10)}
            onPause={() => act(togglePause)}
            onMore={open ? null : () => act(bump, 10)}
            onSkip={() => act(skip)} />
        </div>
      )}

      {confirmStop && active && (
        <LeaveDialog title={circuit ? 'Stop the circuit?' : 'Stop the timer?'}
          body={circuit ? 'What you have done so far is logged.' : 'This run ends here. Your presets are kept.'}
          onKeep={() => setConfirmStop(false)}
          actions={[
            ...(onLeave ? [{ label: 'Leave it open', kind: 'secondary', onClick: onLeave }] : []),
            { label: 'Stop', kind: 'destructive', onClick: stop },
          ]} />
      )}

      {about && <ExerciseSheet field={liftField} exercise={about.key} name={about.name} onClose={() => setAbout(null)} />}
    </div>
  )
}

/**
 * What the exercise is, on the run screen: what it works and its one-line gist
 * from the library (#63), and ⓘ for the rest. During a rest or the count-in it
 * is the exercise coming up, named, so the next forty seconds start ready.
 */
function ExerciseNow({ field, seg, upNext, onAbout }) {
  const ex = seg.key ? exerciseOf(field, seg.key) : null
  const m = musclesOf(field, seg.key)
  const gist = ex?.how?.gist || (m ? `Works ${muscleWords(m, 4)}` : null)
  if (!upNext && !gist && !m && !ex) return null
  return (
    <div className={`it-ex ${upNext ? 'up' : ''}`}>
      {m && <ExerciseBody field={field} exercise={seg.key} name={seg.name} size={upNext ? 48 : 40} />}
      <div className="it-exwords">
        {upNext && <span className="it-exlabel">Up next</span>}
        {upNext && <strong className="it-exnext">{seg.name}{seg.reps ? ` · ${seg.reps} reps` : seg.seconds != null ? ` · ${secondsLabel(seg.seconds)}` : ''}</strong>}
        {gist && <span className="it-exgist">{gist}</span>}
      </div>
      {ex && (
        <button type="button" className="iconbtn it-exabout" onClick={() => onAbout({ key: seg.key, name: seg.name })}
          aria-label={`How to do ${seg.name}`}>
          <Icon name="Info" size={20} />
        </button>
      )}
    </div>
  )
}
