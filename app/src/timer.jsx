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
 * A plain timer is a clock, not a log. It writes nothing to a workout: the
 * climbing cards' set log is still workout mode's (workout.jsx), and their
 * declared timers are offered here as presets, run through the same sequence
 * (lib/timer.js `sessionTimer`). What it does write is the person's presets and
 * the last one run, as their own entries in their own log, so the one-tap
 * default follows them between devices.
 *
 * A CIRCUIT (issue #68) is the exception, because it is a workout: a preset with
 * exercises from the library. Its run screen says which exercise to do now and
 * what comes next, and finishing it, or stopping it early, logs it as one
 * workout on today (`onLog`). "Put it on today" places it as a planned workout
 * instead (`onPlace`). A plan's circuit block runs on this same screen from the
 * runner (runner.jsx), which logs it onto its own entry.
 *
 * The run itself is absolute instants (lib/timer.js), kept on the device as it
 * goes, so backgrounding, a locked phone and a reload all come back to the
 * second it would have reached. `TimerHost` is mounted once at the top of the
 * app for exactly that: it reopens a run that was going when the page went away.
 */

import { useMemo, useRef, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import { primeAudio } from './lib/cues.js'
import { clock } from './lib/workout.js'
import { compile, normalizeConfig, sameConfig, totalSeconds, describe, secondsLabel, stepSeconds, startRun, isCircuit, presetList, lastTimer, buildTimerEntry, buildLastTimerEntry, newTimerId, LIMITS, MAX_NAMED, KIND_LABEL, MAX_EXERCISES } from './lib/timer.js'
import { exerciseOf, liftFieldOf } from './lib/lifts.js'
import { usePlan } from './lib/planctx.jsx'
import { CircuitList, SecondsRow } from './circuit.jsx'
import { useModalLayer } from './modal.jsx'
export { openTimer, closeTimer, timerRequestFor } from './timerbus.js'
export { WorkHead, LeaveDialog, leaveActions, ControlRow, setsWord } from './workchrome.jsx'
export { TimerHost } from './timerhost.jsx'
export { TimerRun, exerciseAfter } from './timerrun.jsx'
import { TimerRun } from './timerrun.jsx'
import { Explain } from './blurb.jsx'



/**
 * Setup, then run. `resumed` skips straight to the run that was going.
 *
 * `onLog(name, config, run)` is how a circuit's run becomes a workout: called
 * once when it ends, finished or stopped, and true if anything was logged
 * (App.jsx `logCircuit`). `onPlace(name, config)` puts it on today instead.
 */
export function IntervalTimer({ title, sessionPresets = [], resumed = null, entries = [], upsertEntry, deleteEntry, persist = () => {}, onClose, onLog = null, onPlace = null }) {
  // A layer like any sheet: the page under it holds still and the + gives way (#98:
  // framed at desktop, the + showed in the timer's margin).
  useModalLayer()
  const [live, setLive] = useState(resumed) // { name, config, run } while running
  const [logged, setLogged] = useState(null) // what the finish screen says was logged
  const ended = useRef(null) // the run already logged, so a repaint cannot log it twice

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
    setLogged(null)
    setLive(next)
  }

  const onRun = (run) => {
    if (run.finishedAt == null) { persist({ ...live, title, run }); return }
    persist(null)
    if (!isCircuit(live.config) || !onLog || ended.current === run.startedAt) return
    ended.current = run.startedAt
    const ok = onLog(live.name, live.config, run)
    setLogged(ok ? 'Logged on today' : null)
    // Stopped before anything was done: there is nothing to show a finish for.
    if (!ok && run.stopped) onClose()
  }

  if (live) {
    return (
      <TimerRun key={live.run.startedAt} title={title} name={live.name} config={live.config} initialRun={live.run}
        onRun={onRun} logged={logged}
        onAgain={() => start(live.name, live.config)}
        onClose={onClose} />
    )
  }
  return (
    <TimerSetup title={title} presets={presetList(entries, sessionPresets)}
      onStart={start} onClose={onClose} onPlace={onPlace}
      onSave={upsertEntry ? (id, name, config) => upsertEntry(buildTimerEntry(id, name, config)) : null}
      onDelete={deleteEntry || null} />
  )
}

/* ------------------------------------------------------------------ setup */

export function TimerSetup({ title, presets, onStart, onSave = null, onDelete = null, onClose, onPlace = null }) {
  const liftField = liftFieldOf(usePlan())
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
  const name = chosen && !edited ? chosen.name : (chosen?.saved ? chosen.name : isCircuit(config) ? 'Circuit' : 'Custom')
  const circuit = isCircuit(config)
  const named = config.intervals.length > 0 && !circuit
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
      {/* The exit at the top left, as on every workout screen (#75, #94 B F6): it
          was the one X on the right. */}
      <header className="it-head">
        <button className="iconbtn it-exit" onClick={onClose} aria-label="Close the timer">
          <Icon name="X" size={20} />
        </button>
        <div className="it-title">
          <div className="it-name">Interval timer</div>
          {title && <div className="it-sub">{title}</div>}
        </div>
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

        {liftField && (
          <Exercises config={config} liftField={liftField}
            onChange={(exercises) => setConfig(c => normalizeConfig({
              ...c, exercises,
              // The first exercise makes it a circuit: its round is the exercises
              // (lib/timer.js), with a minute between rounds until they say otherwise.
              ...(!isCircuit(c) && exercises.length ? { intervals: [], roundRest: 60 } : {}),
            }))} />
        )}
        {circuit && onPlace && (
          <button className="btn quiet it-link" onClick={() => onPlace(name, config)}>
            <Icon name="CalendarDays" size={15} /> Add to Today
          </button>
        )}

        <button className="btn quiet it-more" aria-expanded={more} onClick={() => setMore(!more)}>
          <Icon name="ChevronDown" size={16} style={{ transform: more ? 'rotate(180deg)' : 'none' }} />
          {more ? 'Fewer options' : 'More options'}
        </button>

        {more && (
          <div className="it-rows">
            {circuit && (
              <SecondsRow label="Rest between rounds" value={config.roundRest || 0} max={LIMITS.roundRest[1]}
                onChange={v => set('roundRest', v)} />
            )}
            <Stepper label="Get ready" value={config.countIn ? secondsLabel(config.countIn) : 'None'}
              onDown={config.countIn > 0 ? () => set('countIn', stepSeconds(config.countIn, -1)) : null}
              onUp={config.countIn < LIMITS.countIn[1] ? () => set('countIn', stepSeconds(config.countIn, 1)) : null} />
            {/* A circuit is rounds of its exercises and nothing else (lib/timer.js
                normalizeConfig), so placing it as a plan cannot drop part of it. */}
            {!circuit && (
              <Stepper label="Sets" value={String(config.sets)}
                onDown={config.sets > 1 ? () => set('sets', config.sets - 1) : null}
                onUp={config.sets < LIMITS.sets[1] ? () => set('sets', config.sets + 1) : null} />
            )}
            {!circuit && config.sets > 1 && (
              <Stepper label="Rest between sets" value={config.setRest ? secondsLabel(config.setRest) : 'None'}
                onDown={config.setRest > 0 ? () => set('setRest', stepSeconds(config.setRest, -1)) : null}
                onUp={config.setRest < LIMITS.setRest[1] ? () => set('setRest', stepSeconds(config.setRest, 1)) : null} />
            )}
            {!circuit && !config.repeat && (
              <Stepper label="Cool-down" value={config.coolDown ? secondsLabel(config.coolDown) : 'None'}
                onDown={config.coolDown > 0 ? () => set('coolDown', stepSeconds(config.coolDown, -1)) : null}
                onUp={config.coolDown < LIMITS.coolDown[1] ? () => set('coolDown', stepSeconds(config.coolDown, 1)) : null} />
            )}
            {!circuit && (
              <label className="it-row it-toggle">
                <span className="it-label">Repeat until I stop</span>
                <input type="checkbox" role="switch" className="switch" checked={config.repeat} onChange={e => set('repeat', e.target.checked)} />
              </label>
            )}

            {!circuit && (
              <Intervals config={config} planSequence={planSequence}
                onChange={(intervals) => set('intervals', intervals)} />
            )}
          </div>
        )}

        {(onSave || onDelete) && (
          <div className="it-save">
            {naming != null ? (
              <div className="it-namebox">
                <input type="text" value={naming} placeholder="Name this preset" maxLength={40} autoFocus
                  onChange={e => setNaming(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveAs() }} />
                <button className="btn secondary" disabled={!naming.trim()} onClick={saveAs}>Save</button>
                <button className="btn secondary" onClick={() => setNaming(null)}>Cancel</button>
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
 * A circuit's exercises (issue #68), picked from the library with the same
 * searchable picker as everywhere else. Each runs for Work unless its row says
 * otherwise; the list is the round.
 */
function Exercises({ config, liftField, onChange }) {
  const list = config.exercises || []
  // A plain timer offers the way in and nothing else, so its screen stays as it was.
  const [asked, setAsked] = useState(false)
  const items = list.map((x, i) => ({
    id: `${i}:${x.key || x.name}`, key: x.key || null, name: x.name,
    timing: x.reps ? { by: 'reps', reps: x.reps } : x.seconds ? { by: 'time', seconds: x.seconds } : { by: 'circuit' },
  }))
  const put = (i, patch) => onChange(list.map((x, n) => {
    if (n !== i) return x
    const { seconds: _s, reps: _r, ...rest } = x
    return { ...rest, ...patch }
  }))
  const move = (i, dir) => {
    const to = dir === 'up' ? i - 1 : i + 1
    if (to < 0 || to >= list.length) return
    const next = [...list]
    ;[next[i], next[to]] = [next[to], next[i]]
    onChange(next)
  }
  if (!list.length && !asked) {
    return (
      <button className="btn quiet it-link" onClick={() => setAsked(true)}>
        <Icon name="Dumbbell" size={15} /> Add exercises
      </button>
    )
  }
  return (
    <div className="it-exercises">
      <div className="section-head">
        <h3>Exercises</h3>
        {list.length > 0 && <span className="sub">{list.length}</span>}
      </div>
      <CircuitList items={items} work={config.work} liftField={liftField} adding={!list.length}
        onTiming={put}
        onRemove={(i) => onChange(list.filter((_, n) => n !== i))}
        onMove={move}
        onAdd={list.length < MAX_EXERCISES ? (key) => {
          const ex = exerciseOf(liftField, key)
          if (ex) onChange([...list, { key, name: ex.name }])
        } : null} />
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
        <p className="it-note">{names.join(', ')}.<Explain> Rests the plan does not state count up until you tap.</Explain></p>
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
