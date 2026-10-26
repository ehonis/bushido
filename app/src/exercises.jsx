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

import { useEffect, useMemo, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import { NumInput } from './numinput.jsx'
import { setFieldsFor, measureOfItem } from './lib/prescription.js'
import {
  searchExercises, implementsFor, lastLift, catalogOf, exerciseOf, muscleName, measureFor,
  weightModesFor, weightPatch, nextWeightMode, rememberedWeightMode, weightModeWords, weightBoxOf,
} from './lib/lifts.js'
import { ExerciseBody, BodyMap, musclesOf, muscleWords } from './lib/bodymap.jsx'
import { HowBody } from './howto.jsx'
import { Popover } from './modal.jsx'

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
 * `swap` (from `weightSwitch`) turns the label under the number into the
 * switch for what it means: the words are the button, so the thing you read is
 * the thing you tap, and one tap moves to the other meaning.
 */
export function Stepper({
  label, value, step = 1, min = null, max = null, suffix = '', quiet = false,
  blank = null, placeholder = '—', onChange, swap = null,
}) {
  const n = Number(value) || 0
  const bump = (d) => {
    let next = n + d * step
    if (min !== null) next = Math.max(min, next)
    if (max !== null) next = Math.min(max, next)
    onChange(Math.round(next * 100) / 100)
  }
  return (
    <span className={`stepper ${quiet ? 'quiet' : ''}`}>
      <button className="stepper-btn" onClick={() => bump(-1)} disabled={min !== null && n <= min}
        aria-label={`less ${label}`}><Icon name="Minus" size={15} /></button>
      <span className="stepper-mid">
        <NumInput value={value} aria-label={label} placeholder={placeholder} blank={blank} onChange={onChange} />
        {swap ? (
          <button type="button" className="stepper-label stepper-swap" onClick={swap.onSwitch}
            aria-label={swap.aria || `Weight in ${label}. Switch to ${swap.next}`}>
            <SwapWords label={swap.box} size={10} />
          </button>
        ) : <span className="stepper-label">{label}{suffix}</span>}
      </span>
      <button className="stepper-btn" onClick={() => bump(1)} disabled={max !== null && n >= max}
        aria-label={`more ${label}`}><Icon name="Plus" size={15} /></button>
    </span>
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
export function ExercisePicker({ field, onPick, onClose }) {
  const [q, setQ] = useState('')
  // A tapped group chip is that group exactly; typing makes it a search again.
  const [chip, setChip] = useState(null)
  const hits = useMemo(() => searchExercises(field, chip ? '' : q, { limit: 24, group: chip }), [field, q, chip])
  const { exercises, groups } = catalogOf(field)
  // "What is this?" before adding it (issue #63): the sheet, with Add in its foot.
  const [about, setAbout] = useState(null)

  return (
    <div className="expick">
      <div className="expick-head">
        <input autoFocus value={q} onChange={e => { setQ(e.target.value); setChip(null) }}
          aria-label="Search for an exercise"
          placeholder={`search ${exercises.length} exercises…`} />
        {onClose && (
          <button className="modal-btn" onClick={onClose} aria-label="Close"><Icon name="X" size={16} /></button>
        )}
      </div>

      {!q.trim() && groups.length > 0 && (
        <div className="expick-groups">
          {groups.map(g => (
            <button key={g} type="button" className="implchip" onClick={() => { setQ(g); setChip(g) }}>{g}</button>
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

/* --------------------------------------------------------------- one card */

/**
 * Every set, editable, with thumbs in mind.
 *
 * Steppers rather than keyboards for reps and weight: the numbers move in
 * predictable increments (a rep at a time, five pounds at a time) and a numeric
 * keyboard on a phone covers half the screen with the thing you are editing
 * underneath it. The value is still an input, so a genuinely odd number is one
 * tap and a type away.
 */
export function ExerciseCard({
  item, liftField, entries = [], entryId = null, defaultOpen = false, blank = null,
  onPatch, onPatchSet, onAddSet, onRemoveSet, onRemove,
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [about, setAbout] = useState(false)
  const offered = liftField && item.exercise ? implementsFor(liftField, item.exercise) : []
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
  const swap = weightSwitch(liftField, item, onPatch)
  const count = countSwitch(liftField, item, onPatch)
  // A mode other than the default, said under the name, so the summary beside it
  // stays short enough not to squeeze the name on a phone.
  const modeWords = item.kind === 'lift' ? weightModeWords(liftField, item) : null

  return (
    <div className={`presc-item k-${item.kind || 'lift'}`}>
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
            {muscles && <span className="presc-muscles">{muscleWords(muscles)}</span>}
            {modeWords && <span className="presc-mode">{modeWords}</span>}
            {/* The summary sits under the name, on one line, so the name has the
                width (#63 follow-up: beside "60 s @ 70 lb, 45 s …" and the ⓘ, a
                long name wrapped four lines). */}
            {item.line && <span className="presc-itemline">{item.line}</span>}
          </span>
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

          {prior && (
            <p className="presc-prior">
              <Icon name="RotateCw" size={12} />
              <span>last time ({prior.date}): <strong>{prior.summary}</strong>
                {prior.implement ? ` · ${prior.implement}` : ''}</span>
            </p>
          )}

          {/*
            * What it is loaded with, on ONE line that scrolls.
            *
            * Nineteen implements wrapped is four rows of chips per exercise, and
            * six exercises of that is a sheet you scroll past rather than read.
            * The chosen one leads, so the answer is always the thing you can see
            * without scrolling and the alternatives are a thumb-flick away.
            *
            * This replaced a native `<select>` on the log side. A select is one
            * tap from a short list, which is what an OS picker is good at — but it
            * is also a different control for the same question on two screens, and
            * it hid the answer behind a tap where the chips state it.
            */}
          {offered.length > 1 && (
            <div className="presc-impl">
              {[...offered].sort((a, b) =>
                (b.value === item.implement) - (a.value === item.implement)).map(i => (
                <button key={i.value} className={`implchip ${item.implement === i.value ? 'on' : ''}`}
                  onClick={() => {
                    const patch = implementPick(liftField, item, i, entries, entryId)
                    if (patch) onPatch(patch)
                  }}>
                  {i.label}
                </button>
              ))}
            </div>
          )}

          <div className="presc-sets">
            {item.sets.map((s, i) => (
              <div key={s.id} className="presc-set">
                <span className="presc-setn">{i + 1}</span>
                {setFieldsFor(item, s).map(f => (
                  <Stepper key={f} {...STEP[f](item, s)} value={s[f]} blank={blank}
                    placeholder={s.hint?.[f] != null && s.hint[f] !== '' ? String(s.hint[f]) : '—'}
                    swap={f === 'weight' ? swap : (f === 'reps' || f === 'seconds') ? count : null}
                    onChange={v => onPatchSet(s.id, { [f]: v })} />
                ))}
                {/* Lifting has no programmed rest — see `normalizeSet`. An
                    interval piece keeps it: the rest at the wall IS the set. */}
                {item.kind === 'interval' && (
                  <Stepper label="rest" value={s.restSec ?? 0} step={15} min={0} suffix=" sec" quiet
                    onChange={v => onPatchSet(s.id, { restSec: v })} />
                )}
                <button className="presc-setx" onClick={() => onRemoveSet(s.id)}
                  aria-label={`remove set ${i + 1}`}><Icon name="X" size={14} /></button>
              </div>
            ))}
          </div>

          {/* Remove sits on the RIGHT, away from the thumb that is adding sets —
              they were side by side and they do opposite things. */}
          <div className="presc-itemfoot">
            <button className="btn quiet" onClick={onAddSet}><Icon name="Plus" size={16} /> Add a set</button>
            <button className="btn quiet presc-itemrm" onClick={onRemove}>
              <Icon name="Trash2" size={16} /> Remove
            </button>
          </div>
        </>
      )}
    </div>
  )
}

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
 * `extra` is whatever belongs between the header and the cards and is NOT shared
 * — on the plan side that is the block's "counts toward" chip, which decides
 * where the session splits and means nothing to a logged workout. `foot` is the
 * same idea under the cards, and today it is the hand-built route's interval
 * adder. Both are hidden while reordering, because that mode exists to show names
 * and arrows and nothing else.
 */
export function ExerciseSection({
  title, count, items, liftField, entries = [], entryId = null,
  firstOpenId = null, blank = null, addLabel = 'Add an exercise here',
  open = true, onToggle = null,
  onPatch, onPatchSet, onAddSet, onRemoveSet, onRemove,
  onMove = null, onAdd = null, extra = null, foot = null, note = null,
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
          {count != null && <span className="presc-blockn">{count}</span>}
          {/*
            * Reorder is per SECTION, because that is the only place an order means
            * anything — on the plan side the warm-up's order and the main block's
            * order are separate questions, and moving a row between them would
            * move it to a different entry. Offered only where there is something
            * to reorder.
            */}
          {onMove && open && items.length > 1 && (
            <button className={`presc-reorder ${ordering ? 'on' : ''}`}
              onClick={() => { setOrdering(v => !v); setMoved(null) }}
              aria-pressed={ordering}>
              <Icon name={ordering ? 'Check' : 'ArrowUpDown'} size={13} />
              <span>{ordering ? 'Done' : 'Reorder'}</span>
            </button>
          )}
        </span>
      </div>

      {open && (
        <>
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
              <ExerciseCard key={it.id} item={it} liftField={liftField}
                entries={entries} entryId={entryId} blank={blank}
                defaultOpen={it.id === firstOpenId || it.id === added}
                onPatch={(patch) => onPatch(it.id, patch)}
                onPatchSet={(setId, patch) => onPatchSet(it.id, setId, patch)}
                onAddSet={() => onAddSet(it.id)}
                onRemoveSet={(setId) => onRemoveSet(it.id, setId)}
                onRemove={() => onRemove(it.id)} />
            ))
          )}

          {onAdd && liftField && !ordering && (
            adding
              ? <ExercisePicker field={liftField}
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
