/*
 * The interval timer — a timer app inside the workout app.
 *
 * Two screens, the way the good ones (Seconds, Intervals Pro, any Tabata timer)
 * are built: SETUP, where the answer to "what am I running" is already filled
 * in and Start is the biggest thing on it, and RUN, which is one number you can
 * read from across a room. Customising is inline steppers on the setup screen,
 * never typing a number, and the common settings are all there is until you
 * open "More".
 *
 * It is a clock, not a log. It writes nothing to a workout: the climbing cards'
 * set log is still workout mode's (workout.jsx), and their declared timers are
 * offered here as presets, run through the same sequence (lib/timer.js
 * `sessionTimer`). What it does write is the person's presets and the last one
 * run, as their own entries in their own log, so the one-tap default follows
 * them between devices.
 *
 * The run itself is absolute instants (lib/timer.js), kept on the device as it
 * goes, so backgrounding, a locked phone and a reload all come back to the
 * second it would have reached. `TimerHost` is mounted once at the top of the
 * app for exactly that: it reopens a run that was going when the page went away.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Icon } from './lib/icons.jsx'
import { CUES, primeAudio, resumeAudio, acquireWakeLock, releaseWakeLock } from './lib/cues.js'
import { clock } from './lib/workout.js'
import { currentMe } from './lib/whoami.js'
import {
  compile, normalizeConfig, sameConfig, totalSeconds, describe, secondsLabel, stepSeconds,
  startRun, settle, togglePause, skip, back, bump, view, cueFor, moved,
  presetList, lastTimer, buildTimerEntry, buildLastTimerEntry, newTimerId, sessionTimer,
  runKeyFor, saveRun, loadRun, LIMITS, MAX_NAMED, KIND_LABEL,
} from './lib/timer.js'

/* ----------------------------------------------------------- who opens it */

/*
 * Any screen can ask for the timer (the session sheet, the + menu) without
 * threading the store through to it: `openTimer` posts the request and the one
 * `TimerHost` answers it.
 */
let request = null
let seq = 0
const listeners = new Set()
const notify = () => { for (const fn of listeners) fn() }
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
const getRequest = () => request

/** Open the timer. `title` is the workout it was opened from; `presets` that workout's own timers. */
export function openTimer({ title = null, presets = [] } = {}) {
  request = { title, presets: presets.filter(Boolean), seq: ++seq }
  notify()
}
export function closeTimer() { request = null; notify() }

/** What the session sheet asks for: the workout's name, and its plan's timer if it declares one. */
export function timerRequestFor(opt, entry = null) {
  return {
    title: entry?.data?.name || opt?.name || null,
    presets: [sessionTimer(opt, entry?.data?.out || {})],
  }
}

const storage = () => (typeof window === 'undefined' ? null : window.localStorage)

/**
 * Mounted once, at the top of the app. Shows nothing until the timer is asked
 * for, or until a run that was going when the page went away is found.
 */
export function TimerHost({ entries, upsertEntry, deleteEntry }) {
  const req = useSyncExternalStore(subscribe, getRequest, getRequest)
  const key = runKeyFor(currentMe().id)
  const [resumed, setResumed] = useState(() => loadRun(storage(), key, Date.now()))
  if (!req && !resumed) return null
  const close = () => {
    saveRun(storage(), key, null)
    setResumed(null)
    closeTimer()
  }
  return (
    <IntervalTimer key={resumed ? 'resumed' : req.seq}
      title={resumed ? resumed.title : req.title}
      sessionPresets={resumed ? [] : req.presets}
      resumed={resumed} entries={entries} upsertEntry={upsertEntry} deleteEntry={deleteEntry}
      persist={(doc) => saveRun(storage(), key, doc)} onClose={close} />
  )
}

/** Setup, then run. `resumed` skips straight to the run that was going. */
export function IntervalTimer({ title, sessionPresets = [], resumed = null, entries = [], upsertEntry, deleteEntry, persist = () => {}, onClose }) {
  const [live, setLive] = useState(resumed) // { name, config, run } while running

  const start = (name, config) => {
    primeAudio()
    const clean = normalizeConfig(config)
    // The one-tap default for next time, rewritten only when it changes.
    const last = lastTimer(entries)
    if (upsertEntry && (!last || !sameConfig(last.config, clean) || last.name !== name)) {
      upsertEntry(buildLastTimerEntry(name, clean))
    }
    const run = startRun(compile(clean), Date.now())
    const next = { name, title, config: clean, run }
    persist(next)
    setLive(next)
  }

  if (live) {
    return (
      <TimerRun title={title} name={live.name} config={live.config} initialRun={live.run}
        onRun={(run) => persist(run.finishedAt != null ? null : { ...live, title, run })}
        onAgain={() => start(live.name, live.config)}
        onClose={onClose} />
    )
  }
  return (
    <TimerSetup title={title} presets={presetList(entries, sessionPresets)}
      onStart={start} onClose={onClose}
      onSave={upsertEntry ? (id, name, config) => upsertEntry(buildTimerEntry(id, name, config)) : null}
      onDelete={deleteEntry || null} />
  )
}

/* ------------------------------------------------------------------ setup */

export function TimerSetup({ title, presets, onStart, onSave = null, onDelete = null, onClose }) {
  const [pick, setPick] = useState(presets[0]?.id || null)
  const chosen = presets.find(p => p.id === pick) || null
  const [config, setConfig] = useState(() => normalizeConfig(presets[0]?.config))
  const [more, setMore] = useState(false)
  const [naming, setNaming] = useState(null) // the name box's text while it is open

  const edited = Boolean(chosen && !sameConfig(chosen.config, config))
  const program = useMemo(() => compile(config), [config])
  const total = totalSeconds(program)
  const set = (k, v) => setConfig(c => normalizeConfig({ ...c, [k]: v }))
  const choose = (p) => { setPick(p.id); setConfig(normalizeConfig(p.config)); setNaming(null) }
  const name = chosen && !edited ? chosen.name : (chosen?.saved ? chosen.name : 'Custom')
  const named = config.intervals.length > 0
  const planSequence = config.intervals.length > MAX_NAMED

  const saveAs = () => {
    const label = (naming || '').trim()
    if (!label || !onSave) return
    const id = newTimerId()
    onSave(id, label, config)
    setNaming(null)
    setPick(id)
  }

  return (
    <div className="it it-setup" role="dialog" aria-modal="true" aria-label="Interval timer">
      <header className="it-head">
        <div className="it-title">
          <div className="it-name">Interval timer</div>
          {title && <div className="it-sub">{title}</div>}
        </div>
        <button className="iconbtn" onClick={onClose} aria-label="Close the timer">
          <Icon name="X" size={20} />
        </button>
      </header>

      <div className="it-body">
        <div className="it-presets" role="listbox" aria-label="Presets">
          {presets.map(p => (
            <button key={p.id} role="option" aria-selected={p.id === pick}
              className={`chip ${p.id === pick ? 'on' : ''}`} onClick={() => choose(p)}>
              {p.fromPlan && <Icon name="ClipboardCheck" size={14} />}
              {p.id === 'timer-last' ? `Last used · ${p.name}` : p.name}
            </button>
          ))}
        </div>

        <div className="it-summary">
          <div className="it-total">{total != null ? clock(total) : config.repeat ? 'Until you stop' : 'Open-ended'}</div>
          <div className="it-desc">{name}{edited && chosen?.saved ? ' (changed)' : ''} · {describe(config)}</div>
        </div>

        <button className="btn it-start" onClick={() => onStart(name, config)}>
          <Icon name="Play" size={20} /> Start
        </button>

        <div className="it-rows">
          {!named && (<>
            <Stepper label="Work" value={secondsLabel(config.work)}
              onDown={config.work > LIMITS.work[0] ? () => set('work', stepSeconds(config.work, -1)) : null}
              onUp={config.work < LIMITS.work[1] ? () => set('work', stepSeconds(config.work, 1)) : null} />
            <Stepper label="Rest" value={config.rest ? secondsLabel(config.rest) : 'None'}
              onDown={config.rest > 0 ? () => set('rest', stepSeconds(config.rest, -1)) : null}
              onUp={config.rest < LIMITS.rest[1] ? () => set('rest', stepSeconds(config.rest, 1)) : null} />
          </>)}
          <Stepper label="Rounds" value={String(config.rounds)}
            onDown={config.rounds > 1 ? () => set('rounds', config.rounds - 1) : null}
            onUp={config.rounds < LIMITS.rounds[1] ? () => set('rounds', config.rounds + 1) : null} />
        </div>

        <button className="btn quiet it-more" aria-expanded={more} onClick={() => setMore(!more)}>
          <Icon name="ChevronDown" size={16} style={{ transform: more ? 'rotate(180deg)' : 'none' }} />
          {more ? 'Fewer options' : 'More options'}
        </button>

        {more && (
          <div className="it-rows">
            <Stepper label="Get ready" value={config.countIn ? secondsLabel(config.countIn) : 'None'}
              onDown={config.countIn > 0 ? () => set('countIn', stepSeconds(config.countIn, -1)) : null}
              onUp={config.countIn < LIMITS.countIn[1] ? () => set('countIn', stepSeconds(config.countIn, 1)) : null} />
            <Stepper label="Sets" value={String(config.sets)}
              onDown={config.sets > 1 ? () => set('sets', config.sets - 1) : null}
              onUp={config.sets < LIMITS.sets[1] ? () => set('sets', config.sets + 1) : null} />
            {config.sets > 1 && (
              <Stepper label="Rest between sets" value={config.setRest ? secondsLabel(config.setRest) : 'None'}
                onDown={config.setRest > 0 ? () => set('setRest', stepSeconds(config.setRest, -1)) : null}
                onUp={config.setRest < LIMITS.setRest[1] ? () => set('setRest', stepSeconds(config.setRest, 1)) : null} />
            )}
            {!config.repeat && (
              <Stepper label="Cool-down" value={config.coolDown ? secondsLabel(config.coolDown) : 'None'}
                onDown={config.coolDown > 0 ? () => set('coolDown', stepSeconds(config.coolDown, -1)) : null}
                onUp={config.coolDown < LIMITS.coolDown[1] ? () => set('coolDown', stepSeconds(config.coolDown, 1)) : null} />
            )}
            <label className="it-row it-toggle">
              <span className="it-label">Repeat until I stop</span>
              <input type="checkbox" checked={config.repeat} onChange={e => set('repeat', e.target.checked)} />
            </label>

            <Intervals config={config} planSequence={planSequence}
              onChange={(intervals) => set('intervals', intervals)} />
          </div>
        )}

        {(onSave || onDelete) && (
          <div className="it-save">
            {naming != null ? (
              <div className="it-namebox">
                <input type="text" value={naming} placeholder="Name this preset" maxLength={40} autoFocus
                  onChange={e => setNaming(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveAs() }} />
                <button className="btn secondary" disabled={!naming.trim()} onClick={saveAs}>Save</button>
                <button className="btn ghost" onClick={() => setNaming(null)}>Cancel</button>
              </div>
            ) : (<>
              {chosen?.saved && edited && onSave && (
                <button className="btn quiet it-link" onClick={() => onSave(chosen.id, chosen.name, config)}>
                  <Icon name="Check" size={15} /> Save changes to {chosen.name}
                </button>
              )}
              {onSave && (!chosen?.saved || edited) && (
                <button className="btn quiet it-link" onClick={() => setNaming('')}>
                  <Icon name="Plus" size={15} /> Save as a preset
                </button>
              )}
              {chosen?.saved && onDelete && (
                <button className="btn quiet it-link" onClick={() => { onDelete(chosen.id); setPick(presets.find(p => p.id !== chosen.id)?.id || null) }}>
                  <Icon name="Trash2" size={15} /> Delete {chosen.name}
                </button>
              )}
            </>)}
          </div>
        )}
      </div>
    </div>
  )
}

/** One setting: label, − value +. A null handler is a disabled end of the range. */
function Stepper({ label, value, onDown, onUp }) {
  return (
    <div className="it-row">
      <span className="it-label">{label}</span>
      <span className="it-step">
        <button className="qbtn" onClick={onDown || undefined} disabled={!onDown} aria-label={`Less ${label.toLowerCase()}`}>
          <Icon name="Minus" size={18} />
        </button>
        <span className="it-value">{value}</span>
        <button className="qbtn" onClick={onUp || undefined} disabled={!onUp} aria-label={`More ${label.toLowerCase()}`}>
          <Icon name="Plus" size={18} />
        </button>
      </span>
    </div>
  )
}

/**
 * Named intervals: a round that is more than work-then-rest. The name is the
 * one thing typed; how long each lasts is a stepper like everything else. A
 * plan's own sequence is far longer than anyone builds by hand, so it is shown
 * as what it is rather than as forty rows to scroll.
 */
function Intervals({ config, planSequence, onChange }) {
  const list = config.intervals
  if (planSequence) {
    const works = list.filter(i => i.kind === 'work')
    const names = [...new Set(works.map(i => i.name).filter(Boolean))]
    return (
      <div className="it-intervals">
        <div className="it-label">From the plan: {list.length} intervals</div>
        <p className="it-note">{names.join(', ')}. Rests the plan does not state count up until you tap.</p>
        <button className="btn quiet it-link" onClick={() => onChange([])}>
          <Icon name="X" size={15} /> Use plain work and rest instead
        </button>
      </div>
    )
  }
  if (!list.length) {
    return (
      <button className="btn quiet it-link" onClick={() => onChange([
        { kind: 'work', seconds: config.work, name: 'Work' },
        ...(config.rest ? [{ kind: 'rest', seconds: config.rest }] : []),
      ])}>
        <Icon name="ListPlus" size={15} /> Name the intervals in a round
      </button>
    )
  }
  const put = (n, patch) => onChange(list.map((x, i) => (i === n ? { ...x, ...patch } : x)))
  return (
    <div className="it-intervals">
      <div className="section-head"><h3>Each round</h3></div>
      {list.map((iv, n) => (
        <div key={n} className={`it-iv k-${iv.kind}`}>
          <input type="text" className="it-ivname" value={iv.name || ''} maxLength={40}
            placeholder={KIND_LABEL[iv.kind]} aria-label={`Interval ${n + 1} name`}
            onChange={e => put(n, { name: e.target.value })} />
          <button className={`chip it-ivkind ${iv.kind === 'work' ? 'on' : ''}`} onClick={() => put(n, { kind: iv.kind === 'work' ? 'rest' : 'work' })}
            aria-label={`Interval ${n + 1} is ${iv.kind}; switch`}>
            {iv.kind === 'work' ? 'Work' : 'Rest'}
          </button>
          <span className="it-step">
            <button className="qbtn" aria-label="Shorter" disabled={iv.seconds != null && iv.seconds <= 5}
              onClick={() => put(n, { seconds: iv.seconds == null ? 30 : Math.max(5, stepSeconds(iv.seconds, -1)) })}>
              <Icon name="Minus" size={16} />
            </button>
            <span className="it-value">{secondsLabel(iv.seconds)}</span>
            <button className="qbtn" aria-label="Longer"
              onClick={() => put(n, { seconds: iv.seconds == null ? 30 : Math.min(LIMITS.interval[1], stepSeconds(iv.seconds, 1)) })}>
              <Icon name="Plus" size={16} />
            </button>
          </span>
          <button className="qbtn" aria-label={`Remove interval ${n + 1}`}
            onClick={() => onChange(list.filter((_, i) => i !== n))}>
            <Icon name="Trash2" size={15} />
          </button>
        </div>
      ))}
      {list.length < MAX_NAMED && (
        <button className="btn quiet it-link" onClick={() => onChange([...list, { kind: 'work', seconds: 30, name: '' }])}>
          <Icon name="Plus" size={15} /> Add an interval
        </button>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------- run */

const counters = (seg, lap, repeat) => [
  seg.rounds > 1 ? `Round ${seg.round} of ${seg.rounds}` : null,
  seg.sets > 1 ? `Set ${seg.set} of ${seg.sets}` : null,
  repeat ? `Lap ${lap}` : null,
].filter(Boolean).join(' · ')

/**
 * The run screen. Exported for the smoke suite, with `now` overridable for the
 * same reason: a server render has to be able to show a given second.
 */
export function TimerRun({ title, name, config, initialRun, onRun = () => {}, onAgain, onClose, now: fixedNow = null }) {
  const program = useMemo(() => compile(config), [config])
  const [run, setRun] = useState(() => settle(program, initialRun, fixedNow ?? Date.now()))
  const runRef = useRef(run)
  const [now, setNow] = useState(() => fixedNow ?? Date.now())
  const [muted, setMuted] = useState(false)
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  const [confirmStop, setConfirmStop] = useState(false)
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
  }, [ticking, run, tick]) // eslint-disable-line react-hooks/exhaustive-deps

  // Three pips into every change, the same as workout mode's.
  const ticked = useRef('')
  const whole = v.left == null ? null : Math.ceil(v.left)
  useEffect(() => {
    if (!ticking || whole == null || whole <= 0 || whole > 3) return
    const key = `${run.index}:${run.lap}:${run.at}:${whole}`
    if (ticked.current === key) return
    ticked.current = key
    cue('tick')
  }, [whole, ticking, run]) // eslint-disable-line react-hooks/exhaustive-deps

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

  return (
    <div className={`it it-run k-${kind}`} role="dialog" aria-modal="true" aria-label={`${name} timer`}>
      <header className="it-head">
        <div className="it-title">
          <div className="it-name">{name}{title ? ` · ${title}` : ''}</div>
          <div className="it-sub it-tabular"><Icon name="Timer" size={12} /> {clock(v.elapsed)}</div>
        </div>
        <button className="iconbtn" onClick={() => setMuted(!muted)} aria-pressed={muted}
          aria-label={muted ? 'Turn sound on' : 'Turn sound off'}>
          <Icon name={muted ? 'VolumeX' : 'Volume2'} size={20} />
        </button>
        <button className="iconbtn" onClick={() => (active ? setConfirmStop(true) : onClose())} aria-label="Stop the timer">
          <Icon name="X" size={20} />
        </button>
      </header>

      {confirmStop ? (
        <div className="it-body">
          <div className="confirm">
            <span className="confirm-ico"><Icon name="TriangleAlert" size={28} /></span>
            <h3>Stop the timer?</h3>
            <p className="sub">This run ends here. Your presets are kept.</p>
            <div className="confirm-acts">
              <button className="btn ghost" onClick={() => setConfirmStop(false)}>Keep it</button>
              <button className="btn bad" onClick={onClose}>Stop</button>
            </div>
          </div>
        </div>
      ) : v.finished ? (
        <div className="it-body it-finish">
          <Icon name="CircleCheck" size={56} />
          <div className="it-phase">Done</div>
          <div className="it-count">{clock(v.elapsed)}</div>
          <button className="btn it-start" onClick={onAgain}><Icon name="RotateCw" size={18} /> Again</button>
          <button className="btn ghost it-wide" onClick={onClose}>Close</button>
        </div>
      ) : (
        <div className="it-body it-live">
          <button className={`it-face ${v.paused ? 'paused' : ''}`} onClick={onFace}
            aria-label={open ? 'Done, next' : v.paused ? 'Resume' : 'Pause'}>
            <span className="it-phase">{seg.name}</span>
            <span className="it-count">{clock(open ? v.counted : Math.ceil(v.left))}</span>
            {counters(seg, v.lap, config.repeat) && <span className="it-where">{counters(seg, v.lap, config.repeat)}</span>}
            {seg.note && <span className="it-note">{seg.note}</span>}
            {v.progress != null && <span className="it-bar"><span style={{ width: `${v.progress * 100}%` }} /></span>}
            <span className="it-hint">
              {v.paused ? 'Paused · tap to carry on' : open ? 'No set time · tap when done' : 'Tap to pause'}
            </span>
          </button>

          <div className="it-next">
            {v.next ? <>Next: <strong>{v.next.name}</strong> {v.next.seconds != null ? secondsLabel(v.next.seconds) : ''}</> : 'Last one'}
          </div>

          <div className="it-ctl">
            <button className="it-btn" onClick={() => act(back)} aria-label="Back">
              <Icon name="SkipBack" size={18} /><span>Back</span>
            </button>
            <button className="it-btn" onClick={() => act(bump, -10)} disabled={open} aria-label="10 seconds less">
              <Icon name="Minus" size={16} /><span>10s</span>
            </button>
            <button className="it-btn on" onClick={() => act(togglePause)} aria-label={v.paused ? 'Resume' : 'Pause'}>
              <Icon name={v.paused ? 'Play' : 'Pause'} size={20} /><span>{v.paused ? 'Resume' : 'Pause'}</span>
            </button>
            <button className="it-btn" onClick={() => act(bump, 10)} disabled={open} aria-label="10 seconds more">
              <Icon name="Plus" size={16} /><span>10s</span>
            </button>
            <button className="it-btn" onClick={() => act(skip)} aria-label="Skip">
              <Icon name="SkipForward" size={18} /><span>Skip</span>
            </button>
          </div>
        </div>
      )}

    </div>
  )
}
