/*
 * ONE exercise card, and one list of them, for BOTH screens.
 *
 * Planned workouts and logged workouts should look exactly the same, and where
 * they differed the plan side won, because that is where the recent work had
 * gone.
 *
 * They were two screens for a historical reason rather than a designed one: the
 * lift log was built first (2026-09-10, a table of bare inputs under a native `<select>`), and the
 * prescription editor was built second (2026-09-17) with everything learned
 * since — thumb-sized steppers, the body map, what the user lifted last time, implement
 * chips instead of an OS wheel. Logging a workout and planning one are the same
 * act against different numbers, so this is now literally the same component and
 * cannot drift again.
 *
 * WHAT THE TWO SIDES HAND OVER is a normalised item:
 *
 *   { id, name, group, exercise, note, kind, line,
 *     implement, implementLabel, weightLabel,
 *     sets: [{ id, reps, weight, seconds, distance, unit, restSec }] }
 *
 * A PRESCRIPTION item already is one. A LOGGED lift is adapted in `liftlog.jsx`,
 * where the only interesting difference lives: its sets are POSITIONAL (the shape
 * predates this and is what hundreds of entries are stored as), so their ids are
 * their indices and the adapter reads them back with `Number()`. Nothing about
 * that leaks in here.
 *
 * The other difference is what a blank means. The lift log's rows have always
 * used `''` and the prescription uses `null`; `blank` on the stepper is how that
 * survives sharing a component, rather than by rewriting one of the two stores.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import { NumInput } from './numinput.jsx'
import { setFieldsFor, measureOfItem, timeBox, bumpTime } from './lib/prescription.js'
import { acceptMinutesText, minutesText, numOrNull } from './lib/numtext.js'
import {
  searchExercises, implementsFor, lastLift, catalogOf, exerciseOf, muscleName, measureFor,
  weightModesFor, weightPatch, nextWeightMode, rememberedWeightMode, weightModeWords, weightBoxOf,
  implementChoices, implementLabel, weightModeOf, weightMeaning, weightUnit, lastTimeFill, lastTimeWhen,
  pickerGroupFor, copyDownFills, canCopyDown, unfills, cardIdentity, cardKey,
} from './lib/lifts.js'
import { setTicked, itemTicked, setHasNumber } from './lib/prescription.js'
import { ExerciseBody, BodyMap, musclesOf, muscleWords } from './lib/bodymap.jsx'
import { HowBody } from './howto.jsx'
import { Popover } from './modal.jsx'
import { Undo2 } from 'lucide-react'
import { pushToast, dismissToast } from './lib/toast.js'

/**
 * What each field is called and how far one press moves it.
 *
 * Five pounds at a time and twenty-five yards at a time because that is what a
 * plate and a length are; one rep and five seconds because that is what those
 * are. The weight's label comes off the IMPLEMENT — "30 lb per hand" and
 * "135 lb on the bar" are different numbers and the box has to say which — and
 * the mode the user switched it to (`weightSwitch`).
 */
export const STEP = {
  reps: () => ({ label: 'reps', step: 1, min: 0 }),
  weight: (item) => ({ label: item.weightLabel || 'lb', step: 5, min: 0 }),
  /*
   * A pool length is 25 of something and a mile is not: stepping a 3 mi run by
   * 25 walks it to 78 in three presses. So the step follows the UNIT, which is
   * the only thing that knows which kind of number this is.
   */
  distance: (item, set) => {
    const label = set?.unit || item?.unit || 'yd'
    return { label, step: /^(mi|km)$/i.test(label) ? 0.5 : 25, min: 0 }
  },
  /*
   * And the seconds step follows the SIZE, for the same reason. Five at a time
   * is right for a hang and a rest between sets; it is 540 presses for a
   * forty-five minute ride, which is the number the hand-built route asks them to
   * type. The box is still a box, so an exact 47 is one tap and a type away.
   */
  seconds: (item, set) => ({ label: 'sec', step: Number(set?.seconds) >= 180 ? 30 : 5, min: 0 }),
}

/**
 * The box for one field of a set, in the editor and the runner alike. A piece's
 * time is a minutes box (`timeBox`, #78: `time`), a hold's is seconds; the set
 * keeps seconds either way.
 */
export const boxFor = (f, item, set) => (f === 'seconds' ? { ...timeBox(item, set), min: 0 } : STEP[f](item, set))

/**
 * One press of a stepper's −/+ (`d` is −1 or 1): a minutes box steps to the next
 * mark (`bumpTime`), anything else by its step, held to its bounds. The editor's
 * `Stepper` and the runner's `BigStepper` both press through this.
 */
export function stepBox({ step = 1, min = null, max = null, time = false }, value, d) {
  if (time) return bumpTime(value, d)
  let next = (Number(value) || 0) + d * step
  if (min !== null) next = Math.max(min, next)
  if (max !== null) next = Math.min(max, next)
  return Math.round(next * 100) / 100
}

/**
 * A minutes box over seconds (#78): `NumInput`'s rules for "45", "1.5" and
 * "1:40" (lib/numtext.js `acceptMinutesText`); it shows "1:40", never "1.67".
 */
export function TimeInput({ value, onChange, blank = null, placeholder = '—', ...rest }) {
  const shown = minutesText(value)
  const [text, setText] = useState(shown)
  const last = useRef(numOrNull(value))
  useEffect(() => {
    const v = numOrNull(value)
    if (v !== last.current) { last.current = v; setText(shown) }
  }, [value, shown])
  const change = (e) => {
    const r = acceptMinutesText(e.target.value)
    if (!r) return
    setText(r.text)
    if (!r.emit) return
    last.current = r.value
    onChange(r.value === null ? blank : r.value)
  }
  const ph = numOrNull(placeholder) === null ? placeholder : minutesText(placeholder)
  return (
    <input type="text" inputMode="decimal" value={text} placeholder={ph}
      onChange={change} onBlur={() => setText(shown)} {...rest} />
  )
}

/**
 * The tap that changes what a lift's weight means (issue #58), or null where
 * its implement has one meaning. Hands the stepper the label to show as a
 * button and what one tap does; the same for the editor, the log and the runner.
 */
export function weightSwitch(liftField, item, onPatch) {
  if (item?.kind !== 'lift' || weightModesFor(liftField, item.implement).length < 2) return null
  const next = weightPatch(liftField, item.implement, nextWeightMode(liftField, item))
  return { box: weightBoxOf(liftField, item), next: next.weightLabel, onSwitch: () => onPatch(next) }
}

/**
 * What tapping an implement chip writes: the implement, in the mode this
 * exercise was last logged in with it (lib/lifts.js). Null for the chip already
 * chosen: memory is applied when an implement is picked, and a second tap on
 * the same one must not quietly undo a switch made since.
 */
export function implementPick(liftField, item, impl, entries = [], entryId = null) {
  if (!impl || impl.value === item.implement) return null
  return {
    implement: impl.value, implementLabel: impl.label,
    ...weightPatch(liftField, impl.value, rememberedWeightMode(liftField, entries, item.exercise, impl.value, entryId)),
  }
}

/**
 * The tap that counts a hold in reps instead, or back (issue #63 review), or
 * null. Offered on a movement the catalog calls a hold while nothing is counted
 * on it yet, under the count's own box, like the weight's meaning. The log
 * renames its blank sets (lib/lifts.js `patchLift`); a plan item says it in
 * `measure`.
 */
export function countSwitch(liftField, item, onPatch) {
  if (item?.kind !== 'lift' || !item.exercise || measureFor(liftField, item.exercise) !== 'time') return null
  const counted = (item.sets || []).some(s => (s.reps !== null && s.reps !== undefined && s.reps !== '')
    || (s.seconds !== null && s.seconds !== undefined && s.seconds !== ''))
  if (counted) return null
  const now = measureOfItem(item)
  const next = now === 'time' ? 'reps' : 'time'
  return {
    box: now === 'time' ? 'sec' : 'reps',
    aria: `Counted in ${now === 'time' ? 'seconds' : 'reps'}. Switch to ${next === 'time' ? 'seconds' : 'reps'}`,
    next, onSwitch: () => onPatch({ measure: next }),
  }
}

/** A switch's words, the last one held to the swap mark so a wrap never strands it. */
export function SwapWords({ label, size }) {
  const words = String(label).split(' ')
  const last = words.pop()
  return (
    <>
      {words.length ? `${words.join(' ')} ` : ''}
      <span className="stepper-swap-end">{last}<Icon name="ArrowLeftRight" size={size} /></span>
    </>
  )
}

/**
 * One number, moved with thumbs.
 *
 * 44px targets either side of an input that is still an input. The minus goes
 * inert at the floor rather than disappearing — a control that vanishes under
 * your thumb mid-session moves everything next to it.
 *
 * THE NUMBER IS THE CELL (#93). The box between the ± is the whole middle,
 * 44px tall, with its unit drawn inside it under the number, so a tap anywhere
 * between the ± puts the cursor in the number. It used to be a 54×19 box with
 * the weight's meaning switch ("on the bar ⇆") under it as the biggest thing in
 * the cell: a tap aimed at 90 turned 90 lb on the bar into 90 lb per side. What
 * a number means is the card's to say now, once (`ModeSwitch`); nothing in the
 * cell but the number and its one-word unit (`unit`, else `label`), which never
 * wraps. `label` stays the box's full accessible name ("lb on the bar").
 */
export function Stepper({
  label, unit = null, value, step = 1, min = null, max = null, suffix = '', quiet = false,
  blank = null, placeholder = '—', onChange, time = false,
}) {
  // `time`: a minutes box over seconds (`boxFor`), stepped by `bumpTime`.
  const n = Number(value) || 0
  const bump = (d) => onChange(stepBox({ step, min, max, time }, value, d))
  return (
    <span className={`stepper ${quiet ? 'quiet' : ''}`}>
      <button className="stepper-btn" onClick={() => bump(-1)} disabled={min !== null && n <= min}
        aria-label={`less ${label}`}><Icon name="Minus" size={15} /></button>
      <label className="stepper-mid">
        {time
          ? <TimeInput value={value} aria-label={label} placeholder={placeholder} blank={blank} onChange={onChange} />
          : <NumInput value={value} aria-label={label} placeholder={placeholder} blank={blank} onChange={onChange} />}
        <span className="stepper-label" aria-hidden="true">{unit ?? label}{suffix}</span>
      </label>
      <button className="stepper-btn" onClick={() => bump(1)} disabled={max !== null && n >= max}
        aria-label={`more ${label}`}><Icon name="Plus" size={15} /></button>
    </span>
  )
}

/**
 * What one tap on the card's meaning switch does (#93): write the next meaning
 * and offer Undo, because it changes what every number on the exercise stands
 * for (and what weight memory learns). `write` writes a patch through the
 * card's LATEST closure, so an Undo seconds later lands on today's plan, not
 * the one this was made from. Null where the implement has one meaning.
 */
export function modeFlip(liftField, item, write, toast = { push: pushToast, dismiss: dismissToast }) {
  if (item?.kind !== 'lift' || weightModesFor(liftField, item.implement).length < 2) return null
  const before = weightPatch(liftField, item.implement, weightModeOf(liftField, item))
  const next = weightPatch(liftField, item.implement, nextWeightMode(liftField, item))
  const nextWords = weightMeaning(liftField, { implement: item.implement, weightMode: next.weightMode })?.words
  return {
    words: weightMeaning(liftField, item)?.words,
    next: next.weightLabel,
    onSwitch: () => {
      write(next)
      toast.push(`${item.name}: weight now ${nextWords}`, 'info', {
        duration: UNDO_MS,
        action: { label: 'Undo', icon: Undo2, onClick: () => write(before) },
      })
    },
  }
}

/**
 * The card's one switch for what its weight means (#93; #58's switch, moved
 * out of every set's cell): "on the bar ⇆", once per exercise, beside what it
 * is done with. A hold's "seconds ⇆" is the same kind of switch and sits here
 * too. With one meaning the words are said, not offered.
 */
function ModeSwitch({ words, aria, onSwitch }) {
  if (!onSwitch) return <span className="presc-meaning">{words}</span>
  return (
    <button type="button" className="modeswitch" onClick={onSwitch} aria-label={aria}>
      {words}<Icon name="ArrowLeftRight" size={13} />
    </button>
  )
}

/* ------------------------------------------------------- what the movement is */

/**
 * One exercise, explained (issue #63): what it works, what it needs, how to do
 * it, the one thing to watch, and a video when the library has one.
 *
 * Reference, so a popover and not a full screen (AGENTS.md §6.7): it opens from
 * a lift card's name, the runner's, and the picker's "what is this?" before the
 * exercise is added, and closes back to exactly where you were. Read between
 * sets, so the gist leads and everything is short; the catalog's how-to limits
 * are the feature (#64). No how-to still shows the body and the muscles.
 *
 * `onAdd` (the picker) puts the one primary in the foot: you opened it to decide.
 */
export function ExerciseSheet({ field, exercise, name = null, onClose, onAdd = null }) {
  const ex = exerciseOf(field, exercise)
  const title = ex?.name || name || 'Exercise'
  const m = musclesOf(field, exercise)
  const video = ex?.video?.url && /^https:\/\//.test(ex.video.url) ? ex.video : null
  const context = [ex?.group, ex?.measure === 'time' ? 'Held for time' : null].filter(Boolean).join(' · ')

  return (
    <Popover label={`About ${title}`} onClose={onClose} over>
      <div className="pop-head">
        <div className="pop-who">
          <strong>{title}</strong>
          {context && <span className="sub">{context}</span>}
        </div>
        <button className="pop-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
      </div>
      <div className="pop-body exsheet">
        {m && (
          <div className="exsheet-works">
            <BodyMap primary={m.primary} secondary={m.secondary} size={56} label={`${title} works ${m.primary.join(', ')}`} />
            <dl className="exsheet-facts">
              <dt>Works</dt><dd>{m.primary.map(muscleName).join(', ')}</dd>
              {m.secondary.length > 0 && <><dt>Also</dt><dd>{m.secondary.map(muscleName).join(', ')}</dd></>}
              {ex?.equipment && <><dt>Needs</dt><dd>{ex.equipment}</dd></>}
            </dl>
          </div>
        )}
        {!m && ex?.equipment && (
          <dl className="exsheet-facts"><dt>Needs</dt><dd>{ex.equipment}</dd></dl>
        )}

        {ex?.how ? <HowBody how={ex.how} showFigure={false} />
          : <p className="sub exsheet-none">No step-by-step for this one yet.</p>}

        {video && (
          <div className="exsheet-video">
            <button type="button" className="btn secondary" onClick={() => window.open(video.url, '_blank', 'noopener')}>
              <Icon name="Play" size={16} /> Watch how
            </button>
            {(video.channel || video.title) && (
              <span className="sub">{[video.title, video.channel].filter(Boolean).join(' · ')}</span>
            )}
          </div>
        )}
      </div>
      {onAdd && (
        <div className="exsheet-foot">
          <button type="button" className="btn" onClick={onAdd}>
            <Icon name="Plus" size={16} /> Add {title}
          </button>
        </div>
      )}
    </Popover>
  )
}

/* ------------------------------------------------------------- the picker */

/**
 * Two hundred movements, searched rather than scrolled.
 *
 * The group chips came off the log's own picker when the two merged, and they had
 * to: tapping one SEARCHES for the group, so browsing and searching are the same
 * mechanism rather than two, and a man who does not want to type at all still has
 * a way in. The planner's version had only the box.
 */
/**
 * `group` (#93) is the group it opens on: the block's (`pickerGroupFor`), so a
 * Legs block opens on legs and not on Bench press. The chips stay up with that
 * one on; tapping it again is the whole catalog. The search box takes the
 * keyboard only where there is a real one: on a phone it covered the list.
 */
export function ExercisePicker({ field, onPick, onClose, group = null }) {
  const [q, setQ] = useState('')
  const { exercises, groups } = catalogOf(field)
  // A tapped group chip is that group exactly; typing makes it a search again.
  const [chip, setChip] = useState(group && groups.includes(group) ? group : null)
  const hits = useMemo(() => searchExercises(field, chip ? '' : q, { limit: 24, group: chip }), [field, q, chip])
  // "What is this?" before adding it (issue #63): the sheet, with Add in its foot.
  const [about, setAbout] = useState(null)

  return (
    <div className="expick">
      <div className="expick-head">
        <input autoFocus={finePointer()} value={q} onChange={e => { setQ(e.target.value); setChip(null) }}
          aria-label="Search for an exercise"
          placeholder={`search ${exercises.length} exercises…`} />
        {onClose && (
          <button className="modal-btn" onClick={onClose} aria-label="Close"><Icon name="X" size={16} /></button>
        )}
      </div>

      {!q.trim() && groups.length > 0 && (
        <div className="expick-groups" role="group" aria-label="Browse by group">
          {groups.map(g => (
            <button key={g} type="button" className={`implchip ${chip === g ? 'on' : ''}`} aria-pressed={chip === g}
              onClick={() => setChip(chip === g ? null : g)}>{g}</button>
          ))}
        </div>
      )}

      <div className="expick-list">
        {hits.map(ex => (
          <div key={ex.key} className="expick-line">
            <button className="expick-row" onClick={() => onPick(ex.key)}>
              <ExerciseBody field={field} exercise={ex.key} name={ex.name} size={26} />
              <span>{ex.name}</span>
              {ex.group && <span className="sub">{ex.group}</span>}
            </button>
            <button type="button" className="iconbtn expick-about" onClick={() => setAbout(ex.key)}
              aria-label={`What is ${ex.name}?`}>
              <Icon name="Info" size={18} />
            </button>
          </div>
        ))}
        {!hits.length && q.trim() && (
          <p className="sub">
            Nothing matches that. Try the movement&rsquo;s other name, or what it works
            (&ldquo;lower abs&rdquo;, &ldquo;no equipment&rdquo;).
          </p>
        )}
      </div>
      {about && (
        <ExerciseSheet field={field} exercise={about} onClose={() => setAbout(null)}
          onAdd={() => { const key = about; setAbout(null); onPick(key) }} />
      )}
    </div>
  )
}

/** A mouse or trackpad: the only place a search box should take focus on its own. */
const finePointer = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: fine)')?.matches)

/* ------------------------------------------------------ removing, undoably */

const blankish = (v) => v === '' || v === null || v === undefined

/** How long an Undo stays offered: the session's own Remove toast's six seconds. */
export const UNDO_MS = 6000

/**
 * A REMOVAL YOU CAN TAKE BACK (#77). Removing an exercise or a set threw away
 * what was typed on it with no confirm and no undo. Now every removal goes
 * through `remove`, which writes it and shows a toast with Undo; Undo writes
 * back the value exactly as it was before. Any other edit made through
 * `change` withdraws the offer, because the old value is no longer the one to
 * go back to (an Undo then would also undo that edit); so does leaving.
 * The parent owns the value, so this wraps the parent's own write.
 */
/**
 * The same, without React, so it can be tested: `latest()` reads the value
 * now, `emit` writes one, `toast` is the toast store (the app's own by default).
 */
export function undoControl(latest, emit, toast = { push: pushToast, dismiss: dismissToast }) {
  let pending = null
  const drop = () => {
    if (pending != null) toast.dismiss(pending)
    pending = null
  }
  return {
    drop,
    change: (next) => { drop(); emit(next) },
    remove: (next, words) => {
      drop()
      const before = latest()
      emit(next)
      pending = toast.push(words, 'info', {
        duration: UNDO_MS,
        action: { label: 'Undo', icon: Undo2, onClick: () => { pending = null; emit(before) } },
      })
    },
  }
}

export function useUndoable(value, emit) {
  const latest = useRef(value)
  latest.current = value
  // The parent's write as of the latest render, so an Undo seconds later writes through today's closure.
  const write = useRef(emit)
  write.current = emit
  const ctl = useRef(null)
  if (!ctl.current) ctl.current = undoControl(() => latest.current, (v) => write.current(v))
  useEffect(() => ctl.current.drop, [])
  return ctl.current
}

/**
 * "10 reps · 90 lb on the bar", "20 min": one set, read back, where it is
 * removed rather than typed. Each number in the words its box uses (`boxFor`):
 * a piece's time in minutes ("1:40 min"), a hold's in seconds.
 */
export function setWords(item, s) {
  return setFieldsFor(item, s).map(f => {
    const box = boxFor(f, item, s)
    if (blankish(s[f])) return `— ${box.label}`
    return `${box.time ? minutesText(s[f]) : s[f]} ${box.label}`
  }).join(' · ')
}

/* --------------------------------------------------------------- one card */

/**
 * What it is loaded with (#79): the implements the exercise declares, the one it
 * has now first, then "Other…" for the rest of the catalog. A squat used to show
 * all nineteen (med ball, sled, rings…) as a row of chips under every card.
 * Picking writes the implement in the mode the exercise was last logged in with
 * it (`implementPick`).
 */
function ImplementChips({ liftField, item, entries, entryId, onPatch }) {
  const [everything, setEverything] = useState(false)
  const { shown, more } = implementChoices(liftField, item.exercise, item.implement)
  const list = everything ? catalogOf(liftField).implements : shown
  const sorted = [...list].sort((a, b) => (b.value === item.implement) - (a.value === item.implement))
  return (
    <div className="presc-impl" role="group" aria-label={`What ${item.name} is done with`}>
      {sorted.map(i => (
        <button key={i.value} type="button" className={`implchip ${item.implement === i.value ? 'on' : ''}`}
          aria-pressed={item.implement === i.value}
          onClick={() => {
            const patch = implementPick(liftField, item, i, entries, entryId)
            if (patch) onPatch(patch)
          }}>
          {i.label}
        </button>
      ))}
      {more && !everything && (
        <button type="button" className="implchip ghost" onClick={() => setEverything(true)}>Other…</button>
      )}
    </div>
  )
}

/** Does this card offer a choice of implement at all? One declared is no choice. */
const choosesImplement = (liftField, item) =>
  Boolean(liftField && item.exercise && implementsFor(liftField, item.exercise).length > 1)

/**
 * A set's ✓ in doing mode (#79): "I did this set as it says". Before it is
 * ticked it shows the set's number, so the row needs no number column and the
 * two steppers keep the width; ticked, a check on the accent tint. It writes the
 * same `typed` mark a number typed leaves (prescription.js `tickSet`), which is
 * the log (D11). 44px, at the row's far end: nothing destructive beside it, and
 * a miss is a tick that taps off again.
 */
export function SetTick({ n, on, onToggle, locked = false, empty = false, onPrompt = null }) {
  /* A done plan's earlier day (`asWritten`): its sets ARE the log as written,
     so the mark is read, not toggled; a number changed or a set removed is the
     correction, as anywhere in the log. */
  if (locked) {
    return (
      <span className={`presc-tick locked${on ? ' on' : ''}`} role="img" aria-label={on ? `Set ${n} done` : `Set ${n}, nothing logged`}>
        {on ? <Icon name="Check" size={20} /> : <span className="presc-tickn">{n}</span>}
      </span>
    )
  }
  /* A set with no number has nothing to log, so its ✓ cannot be ticked: the tap
     goes to the set's first box instead, which is what it is missing. */
  if (empty && !on) {
    return (
      <button type="button" className="presc-tick unset" role="checkbox" aria-checked={false} aria-disabled="true"
        aria-label={`Set ${n}: type what you did first`} onClick={onPrompt || undefined}>
        <span className="presc-tickn">{n}</span>
      </button>
    )
  }
  return (
    <button type="button" className={`presc-tick ${on ? 'on' : ''}`} role="checkbox" aria-checked={on}
      aria-label={`Set ${n} done`} onClick={() => onToggle(!on)}>
      {on ? <Icon name="Check" size={20} /> : <span className="presc-tickn">{n}</span>}
    </button>
  )
}

/**
 * Every set, editable, with thumbs in mind.
 *
 * Steppers rather than keyboards for reps and weight: the numbers move in
 * predictable increments (a rep at a time, five pounds at a time) and a numeric
 * keyboard on a phone covers half the screen with the thing you are editing
 * underneath it. The value is still an input, so a genuinely odd number is one
 * tap and a type away.
 *
 * `doing` (#79, D9): the session sheet of a planned workout on its day or after,
 * where the lifting is actually done. The card keeps what a set needs and
 * nothing that is planning: the name, the implement as one small switch, last
 * time, and per set the two numbers and a ✓ (`onTick`). Muscles in words and
 * the implement chips stay the planner's; the body figure stays as the name's
 * picture. `focus` opens the card when it becomes the next one to do.
 */
export function ExerciseCard({
  item, liftField, entries = [], entryId = null, defaultOpen = false, defaultEditing = false, blank = null,
  onPatch, onPatchSet, onAddSet, onRemoveSet, onRemove, doing = false, onTick = null, focus = false,
  asWritten = false, onFill = null,
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [about, setAbout] = useState(false)
  // Removing is its own mode (#77): never a ✕ beside a stepper.
  const [editing, setEditing] = useState(defaultEditing)
  // Doing mode keeps the implement behind its one switch until it is asked for.
  const [choosing, setChoosing] = useState(false)
  // The next exercise to do opens as the last one is ticked off.
  useEffect(() => { if (focus) setOpen(true) }, [focus])
  /*
   * EDIT BELONGS TO THE EXERCISE, NOT THE PLACE (#93, A F1). A plan's item ids
   * are positional, so after Remove the next exercise took this card's place
   * and its state: Preacher curl opened in Edit with its Remove under the thumb
   * that had just removed Bent-over row. The section keys cards by `uid`
   * (`cardKey`); an item that has none yet (a plan the server has not seen) is
   * caught here: another exercise in this place is a new card.
   */
  const ident = cardIdentity(item)
  const seen = useRef(ident)
  useEffect(() => {
    if (seen.current === ident) return
    seen.current = ident
    setEditing(false); setChoosing(false); setOpen(defaultOpen)
  }, [ident])
  // The card's writes as of the latest render, for an Undo that lands seconds later.
  const patchNow = useRef(onPatch)
  patchNow.current = onPatch
  const fillNow = useRef(onFill)
  fillNow.current = onFill
  const itemNow = useRef(item)
  itemNow.current = item
  const chooses = choosesImplement(liftField, item)
  const muscles = musclesOf(liftField, item.exercise)
  /*
   * What the user did last time, while the user is still DECIDING the numbers.
   *
   * Each exercise shows what was done previously, so the weight can be chosen
   * while planning. The runner has
   * had this since it was built — it is the number you are trying to beat — and
   * both the planning screen and the log are where the number is actually chosen.
   * Same `lastLift` everywhere, so no two of them can disagree about last time.
   */
  const measure = item.kind === 'lift' ? measureOfItem(item) : null
  const prior = useMemo(
    () => (item.exercise ? lastLift(entries, item.exercise, entryId, liftField, measure) : null),
    [entries, item.exercise, entryId, liftField, measure])
  const flip = modeFlip(liftField, item, (p) => patchNow.current(p))
  const count = countSwitch(liftField, item, onPatch)
  const meaning = item.kind === 'lift' ? weightMeaning(liftField, item) : null
  // A mode other than the default, said under the name, so the summary beside it
  // stays short enough not to squeeze the name on a phone.
  const modeWords = item.kind === 'lift' ? weightModeWords(liftField, item) : null
  const ticking = doing && onTick
  const ticks = ticking ? item.sets.filter(s => setTicked(s, asWritten)).length : 0
  const finished = ticking && itemTicked(item, asWritten)
  const line = ticking && ticks && !finished
    ? [`${ticks} of ${item.sets.length} done`, item.line].filter(Boolean).join(' · ')
    : item.line
  const fill = onFill && prior && !asWritten ? lastTimeFill(liftField, item, prior) : []
  const copyDown = onFill && !asWritten ? (s) => copyDownWrite(item, s.id, (f) => fillNow.current?.(f), undefined, () => itemNow.current) : null
  const lastTime = prior && <LastTime prior={prior} onUse={fill.length ? () => onFill(fill) : null} />
  /* What the weight means and how a hold is counted: once, on the card, beside
     what it is done with. Never in a set's cell (#93). */
  const switches = (
    <>
      {flip && (
        <ModeSwitch words={flip.words} onSwitch={flip.onSwitch}
          aria={`Weight is ${item.weightLabel || 'lb'}. Switch to ${flip.next}`} />
      )}
      {!flip && meaning && <ModeSwitch words={meaning.words} />}
      {count && <ModeSwitch words={count.box === 'sec' ? 'seconds' : 'reps'} aria={count.aria} onSwitch={count.onSwitch} />}
    </>
  )
  const hasSwitches = Boolean(flip || meaning || count)

  return (
    <div className={`presc-item k-${item.kind || 'lift'}${finished ? ' ticked' : ''}`}>
      {/*
        * The whole head folds the card, as it always has: cards start folded,
        * so this is the tap made most. A movement out of the catalog also has
        * what it is (issue #63), on its own 44px ⓘ beside the head, as in the
        * picker, so neither target is a sliver of the other.
        */}
      <div className="presc-itemrow">
        <button className="presc-itemhead" onClick={() => setOpen(v => !v)} aria-expanded={open}>
          {/* What it works, on the row, wherever the name is. */}
          <ExerciseBody field={liftField} exercise={item.exercise} name={item.name} size={30} />
          <span className="presc-itemname">
            {item.name}
            {muscles && !doing && <span className="presc-muscles">{muscleWords(muscles)}</span>}
            {modeWords && !doing && <span className="presc-mode">{modeWords}</span>}
            {/* The summary sits under the name, on one line, so the name has the
                width (#63 follow-up: beside "60 s @ 70 lb, 45 s …" and the ⓘ, a
                long name wrapped four lines). How far it is leads (#93). */}
            {line && <span className="presc-itemline">{line}</span>}
          </span>
          {finished && <span className="presc-itemdone" aria-label="All sets done"><Icon name="CircleCheck" size={16} /></span>}
          <span className={`alt-chev ${open ? 'open' : ''}`}><Icon name="ChevronDown" size={15} /></span>
        </button>
        {item.exercise && (
          <button type="button" className="iconbtn presc-about" onClick={() => setAbout(true)}
            aria-label={`What is ${item.name}?`}>
            <Icon name="Info" size={18} />
          </button>
        )}
      </div>
      {about && <ExerciseSheet field={liftField} exercise={item.exercise} name={item.name} onClose={() => setAbout(false)} />}

      {open && (
        <>
          {item.note && <p className="sub presc-itemnote">{item.note}</p>}

          {/* Doing: one line under the head, what it is done with (the switch),
              what its weight means, and last time. */}
          {doing && (
            <div className="presc-doingmeta">
              {chooses && (
                <button type="button" className={`implswitch ${choosing ? 'on' : ''}`} aria-expanded={choosing}
                  aria-label={`${implementLabel(liftField, item.implement) || 'No equipment picked'}. Change what ${item.name} is done with`}
                  onClick={() => setChoosing(v => !v)}>
                  <span>{implementLabel(liftField, item.implement) || 'Equipment'}</span>
                  <Icon name="ChevronDown" size={13} />
                </button>
              )}
              {switches}
              {lastTime}
            </div>
          )}

          {/*
            * What it is loaded with, on ONE line that scrolls. The chosen one
            * leads, so the answer is always the thing you can see without
            * scrolling; the rest of the catalog is behind "Other…" (#79).
            */}
          {chooses && (!doing || choosing) && (
            <ImplementChips liftField={liftField} item={item} entries={entries} entryId={entryId} onPatch={onPatch} />
          )}
          {/* Planning: what the weight means and last time, right above the sets they fill. */}
          {!doing && (hasSwitches || lastTime) && (
            <div className="presc-doingmeta">{switches}{lastTime}</div>
          )}

          {/*
            * THE SET ROW HAS NOTHING BUT NUMBERS (#77). Its ✕ (32px, under the
            * 44px rule) wrapped onto a line of its own under the reps stepper at
            * 390px, so stepping reps down deleted the set, and on an empty set it
            * sat at the right instead: the control moved with the content. A set
            * is now its number and its steppers, sharing the row (the number box
            * is the big target) and wrapping as a pair under the first when they
            * cannot fit. Removing a set or the exercise is Edit's, and has Undo.
            * In doing mode the set's number is its ✓, in the same place at the
            * row's START (#93): at the end it sat 9px from the weight's +, the
            * button pressed most, and a miss logged a set.
            */}
          {editing ? (
            <div className="presc-sets presc-edit">
              {item.sets.map((s, i) => (
                <div key={s.id} className="presc-editrow">
                  <span className="presc-setn">{i + 1}</span>
                  <span className="presc-editwhat">{setWords(item, s)}</span>
                  <button type="button" className="btn quiet presc-rm" onClick={() => onRemoveSet(s.id)}
                    aria-label={`Remove set ${i + 1}`}><Icon name="Trash2" size={16} /> Remove</button>
                </div>
              ))}
              {/* The whole exercise is a different size of removal, so it looks
                  like one (#93, A F11): under a rule, named, in the bad colour. */}
              <div className="presc-editrow presc-editall">
                <button type="button" className="btn quiet presc-rmall" onClick={onRemove}
                  aria-label={`Remove ${item.name}`}><Icon name="Trash2" size={16} /> Remove {item.name}</button>
              </div>
            </div>
          ) : (
            <div className={ticking ? 'presc-sets doing' : 'presc-sets'}>
              {item.sets.map((s, i) => (
                <Fragment key={s.id}>
                <div className={ticking && setTicked(s, asWritten) ? 'presc-set ticked' : 'presc-set'}>
                  {ticking
                    ? <SetTick n={i + 1} on={setTicked(s, asWritten)} locked={asWritten} onToggle={(v) => onTick(s.id, v)}
                        empty={!setHasNumber(s)}
                        onPrompt={(e) => e.currentTarget.closest('.presc-set')?.querySelector('input')?.focus()} />
                    : <span className="presc-setn">{i + 1}</span>}
                  <span className="presc-setfields">
                    {setFieldsFor(item, s).map(f => {
                      const box = boxFor(f, item, s)
                      return (
                        <Stepper key={f} {...box} unit={f === 'weight' ? weightUnit(box.label) : null} value={s[f]} blank={blank}
                          placeholder={s.hint?.[f] != null && s.hint[f] !== '' ? String(s.hint[f]) : '—'}
                          onChange={v => onPatchSet(s.id, { [f]: v })} />
                      )
                    })}
                    {/* Lifting has no programmed rest — see `normalizeSet`. An
                        interval piece keeps it: the rest at the wall IS the set. */}
                    {item.kind === 'interval' && (
                      <Stepper label="rest" value={s.restSec ?? 0} step={15} min={0} suffix=" sec" quiet
                        onChange={v => onPatchSet(s.id, { restSec: v })} />
                    )}
                  </span>
                </div>
                {/* Copy down (#93): under the set it copies, lined up with the
                    steppers, never beside the ✓ or a +. Numbers only, with Undo. */}
                {copyDown && canCopyDown(item.sets, i) && (
                  <button type="button" className="btn quiet presc-copydown" onClick={() => copyDown(s)}
                    aria-label={`Copy set ${i + 1} to the empty sets below`}>
                    <Icon name="ArrowDownToLine" size={16} /> Copy down
                  </button>
                )}
                </Fragment>
              ))}
            </div>
          )}

          {/* Add on the left; Edit (where removing lives) on the far right, and in
              Edit nothing destructive takes Add's place: Done editing comes back
              where Edit was. */}
          <div className="presc-itemfoot">
            {editing ? (
              <button type="button" className="btn quiet presc-itemedit" onClick={() => setEditing(false)}>
                <Icon name="Check" size={16} /> Done editing
              </button>
            ) : (
              <>
                <button type="button" className="btn quiet" onClick={onAddSet}><Icon name="Plus" size={16} /> Add a set</button>
                <button type="button" className="btn quiet presc-itemedit" onClick={() => setEditing(true)}>
                  <Icon name="Pencil" size={16} /> Edit
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Copy down, written (#93): set `setId`'s numbers into every empty set below it
 * (`copyDownFills`) as ONE write through `fill`, then "Copied to 2 sets" with
 * Undo, which writes those sets back exactly as they were (`unfills`). `fill` is
 * the card's latest write and `latest()` the card as it is now, so Undo leaves
 * any set typed into or ticked since. Numbers only: nothing added, removed or ticked.
 */
export function copyDownWrite(item, setId, fill, toast = { push: pushToast }, latest = () => null) {
  const fills = copyDownFills(item.sets, setId)
  if (!fills.length) return null
  fill(fills)
  return toast.push(`Copied to ${fills.length} set${fills.length === 1 ? '' : 's'}`, 'info', {
    duration: UNDO_MS,
    action: {
      label: 'Undo', icon: Undo2,
      onClick: () => {
        // Only the sets still as the copy left them (`unfills`, against the card as
        // it is NOW): anything typed into or ticked since stays.
        const back = unfills(item.sets, fills, latest()?.sets || undefined)
        if (back.length) fill(back)
      },
    },
  })
}

/**
 * Last time, in words (#93): "Last time · Fri, Nov 7 · 3 × 10 @ 90 lb · EZ bar".
 * With blanks it can fill (`lastTimeFill`) it is a button that fills them in one
 * tap ("Use"), the numbers only, never ticked: a set is done when it is ticked.
 * With nothing to fill it is a line you read.
 */
function LastTime({ prior, onUse = null }) {
  const words = (
    <span>
      Last time · {lastTimeWhen(prior)}: <strong>{prior.summary}</strong>
      {prior.implement ? ` · ${prior.implement}` : ''}
    </span>
  )
  if (!onUse) return <p className="presc-prior"><Icon name="RotateCw" size={12} />{words}</p>
  return (
    <button type="button" className="presc-prior presc-use" onClick={onUse}
      aria-label={`Use last time: ${prior.summary}`}>
      <Icon name="RotateCw" size={12} />{words}<span className="presc-usego">Use</span>
    </button>
  )
}

/** The card's key, re-exported where the cards are (`cardKey`, lib/lifts.js). */
export { cardKey }

/* ------------------------------------------------------------- reordering */

/**
 * One exercise, stripped to what you need to recognise it while moving it.
 *
 * Reorder mode strips everything except the name and muscle groups, moves rows
 * with arrows, and makes a moved row glow so it is easy to see what changed. The
 * glow is the whole point — an arrow press on a phone
 * moves a row under your own thumb, and without a mark on it you have to re-read
 * the list to find out whether anything happened.
 *
 * The arrows go inert at the ends rather than disappearing, for the same reason
 * the steppers' minus does: a control that vanishes moves everything beside it.
 */
function ReorderRow({ item, liftField, first, last, moved, onSettled, onUp, onDown }) {
  const muscles = musclesOf(liftField, item.exercise)

  // Take the glow off once it has played, so the row does not stay lit and the
  // NEXT move to the same row can light it again.
  useEffect(() => {
    if (!moved) return undefined
    const t = setTimeout(onSettled, 900)
    return () => clearTimeout(t)
  }, [moved])

  return (
    <div className={`reorder-row ${moved ? 'moved' : ''}`}>
      <ExerciseBody field={liftField} exercise={item.exercise} name={item.name} size={28} />
      <span className="reorder-name">
        {item.name}
        {muscles && <span className="presc-muscles">{muscleWords(muscles)}</span>}
      </span>
      <button className="reorder-arrow" onClick={onUp} disabled={first} aria-label={`move ${item.name} up`}>
        <Icon name="ChevronUp" size={18} />
      </button>
      <button className="reorder-arrow" onClick={onDown} disabled={last} aria-label={`move ${item.name} down`}>
        <Icon name="ChevronDown" size={18} />
      </button>
    </div>
  )
}

/* ------------------------------------------------------------- the section */

/**
 * A foldable list of exercises with a way to add one and a way to reorder them.
 *
 * This is the whole screen on the log side and one block on the plan side. The
 * fold and the "only the first one opens" rule: every section is collapsible
 * and every workout starts collapsed except the first. Six cards open at once is four screens of steppers before you reach the
 * one you are about to do.
 *
 * `extra` is whatever belongs between the header and the cards and is NOT shared.
 * `foot` is the same idea under the cards, and today it is the hand-built
 * route's interval adder. Both are hidden while reordering, because that mode
 * exists to show names and arrows and nothing else.
 *
 * On the plan side a block's own settings (#79) are its `menu`, a render
 * function handed `{ reorder }` and drawn as the ⋯ at the end of the head;
 * Reorder then lives in it instead of beside the count. `tag` is the one word
 * the head shows of them ("Circuit", "Separate Run workout"); `lead` (a node,
 * or a function handed the same) is what sits under the head: the open menu
 * and the block's note. `doing` and `onTick` are the card's (doing
 * mode, with `asWritten`); `focusId` is the card to open as it becomes the next one to do.
 * `onFill(itemId, [{ setId, patch }])` writes "use last time" as ONE write (a
 * set at a time would each start from the same stale value); without it, last
 * time is a line to read.
 */
export function ExerciseSection({
  title, count, items, liftField, entries = [], entryId = null,
  firstOpenId = null, blank = null, addLabel = 'Add an exercise here',
  open = true, onToggle = null,
  onPatch, onPatchSet, onAddSet, onRemoveSet, onRemove, onFill = null,
  onMove = null, onAdd = null, extra = null, foot = null, note = null,
  menu = null, tag = null, lead = null, doing = false, onTick = null, focusId = null, asWritten = false,
}) {
  const [adding, setAdding] = useState(false)
  const [ordering, setOrdering] = useState(false)
  // The row that just moved, so it can glow. Cleared by the row itself.
  const [moved, setMoved] = useState(null)
  /*
   * The one the user just added opens, on top of the first one.
   *
   * Only the first card opens by default, which is right for reading a session
   * and wrong for the moment after "Add an exercise": you added it to type its
   * sets in, and landing on a folded card means the next tap is one you should
   * not have had to make. `onAdd` hands back the new id for this.
   */
  const [added, setAdded] = useState(null)

  const move = (itemId, dir) => setMoved(onMove(itemId, dir))
  const canOrder = Boolean(onMove && items.length > 1)
  // What the block's menu and lead are handed: the way into reorder mode.
  const ctl = { reorder: canOrder ? () => { setOrdering(true); setMoved(null) } : null }

  return (
    <div className={`presc-block ${open ? '' : 'shut'}`}>
      <div className="presc-blockhead">
        {onToggle ? (
          <button className="presc-blocktoggle" onClick={onToggle} aria-expanded={open}>
            <span className={`alt-chev ${open ? 'open' : ''}`}><Icon name="ChevronDown" size={14} /></span>
            <h3>{title}</h3>
          </button>
        ) : (
          <div className="presc-blocktoggle"><h3>{title}</h3></div>
        )}
        {/*
          * The count and the reorder button travel TOGETHER, so a long title
          * wraps the pair onto a second line instead of squeezing between them.
          * The plan's titles are one word ("Pull"); the log's is a whole question
          * ("What did you lift?") and it collided with both.
          */}
        <span className="presc-blockmeta">
          {tag && <span className="presc-blocktag">{tag}</span>}
          {count != null && <span className="presc-blockn">{count}</span>}
          {/*
            * Reorder is per SECTION, because that is the only place an order means
            * anything — on the plan side the warm-up's order and the main block's
            * order are separate questions, and moving a row between them would
            * move it to a different entry. Offered only where there is something
            * to reorder; on the plan side from the block's menu, and its Done here.
            */}
          {canOrder && open && (ordering || !menu) && (
            <button className={`presc-reorder ${ordering ? 'on' : ''}`}
              onClick={() => { setOrdering(v => !v); setMoved(null) }}
              aria-pressed={ordering}>
              <Icon name={ordering ? 'Check' : 'ArrowUpDown'} size={13} />
              <span>{ordering ? 'Done' : 'Reorder'}</span>
            </button>
          )}
          {menu && !ordering && menu(ctl)}
        </span>
      </div>

      {open && (
        <>
          {!ordering && (typeof lead === 'function' ? lead(ctl) : lead)}
          {!ordering && extra}

          {ordering ? (
            <div className="reorder">
              {items.map((it, i) => (
                <ReorderRow key={it.id} item={it} liftField={liftField}
                  first={i === 0} last={i === items.length - 1}
                  moved={moved === it.id}
                  onSettled={() => setMoved(null)}
                  onUp={() => move(it.id, 'up')}
                  onDown={() => move(it.id, 'down')} />
              ))}
              <p className="sub reorder-hint">
                Order only — nothing else about these changes. Tap <em>done</em> when it reads right.
              </p>
            </div>
          ) : (
            items.map(it => (
              <ExerciseCard key={cardKey(it)} item={it} liftField={liftField}
                entries={entries} entryId={entryId} blank={blank}
                defaultOpen={it.id === firstOpenId || it.id === added}
                doing={doing} asWritten={asWritten} onTick={onTick ? (setId, v) => onTick(it.id, setId, v) : null}
                focus={Boolean(focusId) && it.id === focusId}
                onPatch={(patch) => onPatch(it.id, patch)}
                onPatchSet={(setId, patch) => onPatchSet(it.id, setId, patch)}
                onAddSet={() => onAddSet(it.id)}
                onRemoveSet={(setId) => onRemoveSet(it.id, setId)}
                onRemove={() => onRemove(it.id)}
                onFill={onFill ? (fills) => onFill(it.id, fills) : null} />
            ))
          )}

          {onAdd && liftField && !ordering && (
            adding
              ? <ExercisePicker field={liftField} group={pickerGroupFor(liftField, items, title)}
                  onPick={(key) => { setAdded(onAdd(key) || null); setAdding(false) }}
                  onClose={() => setAdding(false)} />
              : <button className="presc-add" onClick={() => setAdding(true)}>
                  <Icon name="Plus" size={15} /> <span>{addLabel}</span>
                </button>
          )}

          {/* Below the catalog, because the catalog answers most of this
              question. On the plan side this is the interval adder — a swim, a
              ride or a set of 4x4s is not a movement out of a list of lifts. */}
          {foot && !ordering && !adding && foot}

          {!items.length && note && <p className="sub">{note}</p>}
        </>
      )}
    </div>
  )
}
