/*
 * Building a circuit (issue #68): exercises one after another on a clock, an
 * ab circuit, say. ONE editor for both doors to it: a plan's block switched to
 * Circuit (planner.jsx) and an interval-timer preset with exercises
 * (timer.jsx). Both run on the interval timer's screen and both log the same
 * way (lib/prescription.js, lib/timer.js).
 *
 * The bar it is built to: pick exercises, one row of steppers (work, rest,
 * rounds), done. How long each exercise lasts is set ONCE for the circuit; an
 * exercise that is different (a longer plank, fifteen leg raises done to a
 * count) says so behind a tap on its row, and nowhere else.
 */

import { useState } from 'react'
import { Icon } from './lib/icons.jsx'
import { ExerciseBody, musclesOf, muscleWords } from './lib/bodymap.jsx'
import { ExercisePicker, ExerciseSheet } from './exercises.jsx'
import { secondsLabel, stepSeconds, LIMITS } from './lib/timer.js'

/** "40s", "60s", "15 reps": what one exercise runs for, the circuit's own time when it says nothing. */
export const timingWords = (t, work) =>
  (t.by === 'reps' ? `${t.reps} reps` : secondsLabel(t.by === 'time' ? t.seconds : work))

/** The three numbers a circuit is, in one row: each its label, its value, and − + under it at full tap size. */
export function CircuitSteppers({ circuit, onChange }) {
  const set = (k, v) => onChange({ ...circuit, [k]: v })
  const cells = [
    { k: 'work', label: 'Work', value: secondsLabel(circuit.work), min: LIMITS.work[0], max: LIMITS.work[1], seconds: true },
    { k: 'rest', label: 'Rest', value: circuit.rest ? secondsLabel(circuit.rest) : 'None', min: 0, max: LIMITS.rest[1], seconds: true },
    { k: 'rounds', label: 'Rounds', value: String(circuit.rounds), min: 1, max: LIMITS.rounds[1] },
  ]
  return (
    <div className="cx-steps" role="group" aria-label="Circuit timing">
      {cells.map(c => {
        const v = circuit[c.k]
        const down = c.seconds ? Math.max(c.min, stepSeconds(v, -1)) : v - 1
        const up = c.seconds ? Math.min(c.max, stepSeconds(v, 1)) : v + 1
        return (
          <div key={c.k} className="cx-cell">
            <span className="cx-label">{c.label}</span>
            <span className="cx-value">{c.value}</span>
            <span className="cx-step">
              <button type="button" className="qbtn" disabled={v <= c.min} onClick={() => set(c.k, down)}
                aria-label={`Less ${c.label.toLowerCase()}`}><Icon name="Minus" size={16} /></button>
              <button type="button" className="qbtn" disabled={v >= c.max} onClick={() => set(c.k, up)}
                aria-label={`More ${c.label.toLowerCase()}`}><Icon name="Plus" size={16} /></button>
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** One labelled seconds stepper on a row: the circuit's less common settings. */
export function SecondsRow({ label, value, max = 3600, onChange }) {
  return (
    <div className="it-row">
      <span className="it-label">{label}</span>
      <span className="it-step">
        <button type="button" className="qbtn" disabled={value <= 0} onClick={() => onChange(stepSeconds(value, -1))}
          aria-label={`Less ${label.toLowerCase()}`}><Icon name="Minus" size={18} /></button>
        <span className="it-value">{value ? secondsLabel(value) : 'None'}</span>
        <button type="button" className="qbtn" disabled={value >= max} onClick={() => onChange(Math.min(max, stepSeconds(value, 1)))}
          aria-label={`More ${label.toLowerCase()}`}><Icon name="Plus" size={18} /></button>
      </span>
    </div>
  )
}

/**
 * The exercises of a circuit, in order. `items` are `{ id, key, name, timing, load? }`
 * (timing is lib/prescription.js `circuitTiming`'s shape); every change is a
 * callback by index, so the plan and the preset each keep their own store.
 */
export function CircuitList({ items, work, liftField, onTiming, onRemove, onMove, onAdd, adding: startAdding = false }) {
  // The row whose timing is showing, by position: ids are positional, so a
  // move takes the open panel with the exercise rather than leaving it behind.
  const [open, setOpen] = useState(null)
  const [adding, setAdding] = useState(startAdding)
  const [about, setAbout] = useState(null)

  return (
    <div className="cx-list">
      {items.map((it, i) => {
        const shown = open === i
        const m = musclesOf(liftField, it.key)
        const own = it.timing.by !== 'circuit'
        return (
          <div key={it.id} className={shown ? 'cx-item open' : 'cx-item'}>
            <div className="cx-row">
              <button type="button" className="cx-head" onClick={() => setOpen(shown ? null : i)}
                aria-expanded={shown} aria-label={`${it.name}, ${timingWords(it.timing, work)}. Change`}>
                <ExerciseBody field={liftField} exercise={it.key} name={it.name} size={28} />
                <span className="cx-name">
                  {it.name}
                  {m && <span className="presc-muscles">{muscleWords(m)}</span>}
                </span>
                <span className={own ? 'cx-time own' : 'cx-time'}>{timingWords(it.timing, work)}{it.load ? ` @ ${it.load}` : ''}</span>
                <span className={`alt-chev ${shown ? 'open' : ''}`}><Icon name="ChevronDown" size={15} /></span>
              </button>
              {it.key && (
                <button type="button" className="iconbtn presc-about" onClick={() => setAbout(it)}
                  aria-label={`What is ${it.name}?`}>
                  <Icon name="Info" size={18} />
                </button>
              )}
            </div>
            {shown && (
              <TimingEdit timing={it.timing} work={work} name={it.name}
                first={i === 0} last={i === items.length - 1}
                onTiming={(t) => onTiming(i, t)}
                onUp={onMove ? () => { onMove(i, 'up'); setOpen(i - 1) } : null}
                onDown={onMove ? () => { onMove(i, 'down'); setOpen(i + 1) } : null}
                onRemove={() => { setOpen(null); onRemove(i) }} />
            )}
          </div>
        )
      })}
      {about && <ExerciseSheet field={liftField} exercise={about.key} name={about.name} onClose={() => setAbout(null)} />}

      {onAdd && liftField && (adding
        ? <ExercisePicker field={liftField} onPick={(key) => { onAdd(key); setAdding(false) }} onClose={() => setAdding(false)} />
        : (
          <button type="button" className="presc-add" onClick={() => setAdding(true)}>
            <Icon name="Plus" size={15} /> <span>{items.length ? 'Add an exercise' : 'Pick the exercises'}</span>
          </button>
        ))}
    </div>
  )
}

/**
 * One exercise's timing: the circuit's, its own seconds, or reps done to a
 * count (a clock that counts up and waits for the tap). Then where it sits.
 */
function TimingEdit({ timing, work, name, first, last, onTiming, onUp, onDown, onRemove }) {
  const by = timing.by
  const choose = (next) => {
    if (next === by) return
    if (next === 'circuit') onTiming({})
    else if (next === 'time') onTiming({ seconds: work })
    else onTiming({ reps: 10 })
  }
  return (
    <div className="cx-edit">
      <div className="seg tap" role="radiogroup" aria-label={`How ${name} is timed`}>
        {[['circuit', `Circuit's ${secondsLabel(work)}`], ['time', 'Own time'], ['reps', 'Reps']].map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={by === k} className={by === k ? 'on' : ''}
            onClick={() => choose(k)}>{label}</button>
        ))}
      </div>
      {by === 'time' && (
        <div className="cx-own">
          <span className="it-step">
            <button type="button" className="qbtn" disabled={timing.seconds <= LIMITS.work[0]}
              onClick={() => onTiming({ seconds: Math.max(LIMITS.work[0], stepSeconds(timing.seconds, -1)) })}
              aria-label={`Less time on ${name}`}><Icon name="Minus" size={16} /></button>
            <span className="it-value">{secondsLabel(timing.seconds)}</span>
            <button type="button" className="qbtn" disabled={timing.seconds >= LIMITS.work[1]}
              onClick={() => onTiming({ seconds: Math.min(LIMITS.work[1], stepSeconds(timing.seconds, 1)) })}
              aria-label={`More time on ${name}`}><Icon name="Plus" size={16} /></button>
          </span>
        </div>
      )}
      {by === 'reps' && (
        <div className="cx-own">
          <span className="it-step">
            <button type="button" className="qbtn" disabled={timing.reps <= 1}
              onClick={() => onTiming({ reps: Math.max(1, timing.reps - 1) })}
              aria-label={`Fewer reps of ${name}`}><Icon name="Minus" size={16} /></button>
            <span className="it-value">{timing.reps} reps</span>
            <button type="button" className="qbtn" disabled={timing.reps >= LIMITS.reps[1]}
              onClick={() => onTiming({ reps: Math.min(LIMITS.reps[1], timing.reps + 1) })}
              aria-label={`More reps of ${name}`}><Icon name="Plus" size={16} /></button>
          </span>
          <span className="sub">Tap when done</span>
        </div>
      )}
      <div className="cx-acts">
        {onUp && <button type="button" className="btn quiet" disabled={first} onClick={onUp}><Icon name="ChevronUp" size={16} /> Earlier</button>}
        {onDown && <button type="button" className="btn quiet" disabled={last} onClick={onDown}><Icon name="ChevronDown" size={16} /> Later</button>}
        <button type="button" className="btn quiet presc-itemrm" onClick={onRemove}><Icon name="Trash2" size={16} /> Remove</button>
      </div>
    </div>
  )
}
