/*
 * How to actually do the exercise.
 *
 * The rest of the app was good at telling you WHAT to do and useless at telling
 * you HOW. A session's protocol is a wall of accurate paragraphs — "STEP 1 —
 * Hanging foot-lift, 3 sets of 8 total reps (4 per side), 60–75 seconds rest
 * between sets. Hang from the jug rail with a shoulder-width overhand grip..."
 * — and the user read the core and eccentrics ones several times without coming
 * away knowing what the movement was, and did a different movement instead.
 * That is a UI failure, not a reading failure: the instruction was there and it
 * did not land.
 *
 * So each exercise now carries its own `how` in plan.json — a picture, one line
 * that says what the movement IS, three to five short steps, and the single
 * error most likely to ruin it. The prose is still there, unchanged, one tap
 * away; it is just no longer the first thing you have to get through.
 *
 * Three shapes, all built on the same body:
 *
 *   HowRow    a tappable row — figure, name, gist. Lists of exercises.
 *   HowBody   the card itself. Shown inline once a row is open.
 *   HowSheet  the same card as a full screen, for mid-set, where a phone
 *             held at arm's length has room for exactly one thing.
 */

import { useEffect, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import { Figure } from './lib/figures.jsx'

/** "3 × 8" — the prescription, short enough to sit in a row. */
export function doseLabel(ex) {
  if (!ex) return null
  const sets = Number(ex.defaultSets) || 1
  const d = ex.defaults || {}
  const each = d.reps ? `${d.reps}` : d.seconds ? `${d.seconds}s` : null
  if (!each) return sets > 1 ? `${sets} sets` : null
  return `${sets} × ${each}`
}

/**
 * The instructions themselves. Steps are numbered because they are ordered —
 * the free hand turns the weight BEFORE you lower it, and doing those two in
 * the other order is the whole mistake the eccentrics card exists to prevent.
 */
export function HowBody({ how, showFigure = true }) {
  if (!how) return null
  return (
    <div className="how-body">
      {showFigure && how.figure && (
        <div className="how-fig"><Figure name={how.figure} /></div>
      )}
      {how.gist && <p className="how-gist">{how.gist}</p>}

      {how.steps?.length > 0 && (
        <ol className="how-steps">
          {how.steps.map((s, i) => (
            <li key={i}><span className="how-n">{i + 1}</span><span>{s}</span></li>
          ))}
        </ol>
      )}

      {how.watch && (
        <p className="how-note warn">
          <Icon name="TriangleAlert" size={15} />
          <span><strong>Most common mistake</strong> {how.watch}</span>
        </p>
      )}
      {how.easier && (
        <p className="how-note">
          <Icon name="Feather" size={15} />
          <span><strong>Make it easier</strong> {how.easier}</span>
        </p>
      )}
    </div>
  )
}

/**
 * One exercise in a list: picture, name, prescription, and the one-line gist.
 * Tapping it opens the steps underneath rather than navigating anywhere — the
 * list is the map of the session and losing it costs you your place.
 */
export function HowRow({ exercise, open, onToggle, meta }) {
  const how = exercise?.how
  const dose = meta ?? doseLabel(exercise)
  return (
    <div className={`how-row ${open ? 'on' : ''}`}>
      <button className="how-head" onClick={onToggle} aria-expanded={open}>
        <span className="how-thumb"><Figure name={how?.figure} /></span>
        <span className="how-heads">
          <span className="how-name">{exercise.name}</span>
          {how?.gist && <span className="how-sub">{how.gist}</span>}
        </span>
        {dose && <span className="how-dose">{dose}</span>}
        <span className="how-chev"><Icon name="ChevronDown" size={17} /></span>
      </button>
      {open && how && <HowBody how={how} showFigure={false} />}
      {open && !how && (
        <p className="how-none">
          No step-by-step for this one yet — the full protocol is in the sections above.
        </p>
      )}
    </div>
  )
}

/**
 * The full-screen version, for workout mode. Sits above everything, closes on
 * Escape or the scrim, and the close button is a full-width bar at the bottom
 * because this gets dismissed one-handed with chalk on.
 */
export function HowSheet({ exercise, how, title, onClose }) {
  const card = how || exercise?.how
  const name = title || exercise?.name

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!card) return null

  return (
    <div className="how-scrim" onClick={onClose} role="presentation">
      <div className="how-sheet" role="dialog" aria-modal="true" aria-label={`How to do ${name}`}
        onClick={(e) => e.stopPropagation()}>
        <header className="how-sheethead">
          <div className="how-sheetname">{name}</div>
          <button className="modal-btn close" onClick={onClose} aria-label="Close">
            <Icon name="X" size={18} />
          </button>
        </header>
        <div className="how-sheetbody"><HowBody how={card} /></div>
        <button className="btn how-got" onClick={onClose}>Got it</button>
      </div>
    </div>
  )
}

/**
 * "The moves" — the whole session as a list of exercises, which is the section
 * the session view now opens on. Everything else in a protocol is context; this
 * is the part you are standing there trying to execute.
 */
export function MovesList({ session }) {
  const exercises = session?.logSpec?.exercises || []
  // Open the first one by default: a list of collapsed rows with a picture in
  // each reads as decoration until you see that one of them opens.
  const [open, setOpen] = useState(exercises[0]?.key || null)
  if (!exercises.length) return null

  return (
    <div className="how-list">
      {exercises.map(ex => (
        <HowRow key={ex.key} exercise={ex} open={open === ex.key}
          onToggle={() => setOpen(open === ex.key ? null : ex.key)} />
      ))}
    </div>
  )
}

/** Does the plan give this session anything to show in "The moves"? */
export const hasMoves = (session) =>
  (session?.logSpec?.exercises || []).some(ex => ex.how)
