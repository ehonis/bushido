/*
 * What every sheet of ONE workout shares, whoever's log it is in (#80): the
 * done chip under the title, the flip it makes (with Undo), and the footer's one
 * action. The owner's sheet (sheet.jsx) and someone's session opened from their
 * week (trainer.jsx `PersonEntrySheet`) both draw these. There were three
 * footers for "someone's session" (Mark undone + Close; Mark undone for Sam +
 * Close; Start for Sam + Mark undone, with the opposite aria-pressed), and the
 * third was the one nobody had fixed. Twin: mobile/src/features/sheetparts.tsx.
 */
import { useEffect, useRef } from 'react'
import { Undo2 } from 'lucide-react'
import { Icon } from './lib/icons.jsx'
import { isDone, doneState } from './lib/store.js'
import { pushToast, dismissToast } from './lib/toast.js'
import { UNDO_MS } from './exercises.jsx'

/**
 * DONE IS A STATE BY THE TITLE (#77), not a footer button. "Mark undone" sat
 * beside Close at the foot, directly under the set steppers, so a near miss took
 * a workout out of the streak with nothing on screen to say so (on someone
 * else's copy too). Now the chip says what is true ("Done" / "Not done") at the
 * top of the sheet, a flip says what it did in a toast with Undo, and a flip of
 * someone else's copy says whose.
 */
export function DoneChip({ done, whose = null, onToggle }) {
  const said = done ? 'Done' : 'Not done'
  return (
    <button type="button" className={`done-chip ${done ? 'on' : ''}`} role="switch" aria-checked={done}
      aria-label={whose ? `${whose}: ${said}` : said} title={done ? 'Mark undone' : 'Mark done'} onClick={onToggle}>
      <Icon name={done ? 'CircleCheck' : 'Circle'} size={16} />
      <span>{said}</span>
    </button>
  )
}

/**
 * The done chip's tap: flip, then say so in a toast whose Undo puts back exactly
 * the done fields the tap replaced (`doneState`, lib/store.js `markDone`).
 * `read()` is the entry as it stands now; `write(v)` writes `v` (true, false or a
 * `doneState`) through the sheet's one writer for that entry. `whose` names
 * someone else's copy ("Marked undone for Sam"). Someone else's copy is written
 * through the sheet's own queue, so its toast goes with the sheet (`outlives`
 * false); the owner's own goes through the store and may outlive it.
 */
export function useDoneFlip({ read, write, whose = null, outlives = false }) {
  const toast = useRef(null)
  useEffect(() => () => { if (!outlives && toast.current != null) dismissToast(toast.current) }, [outlives])
  return () => {
    const before = read()
    if (!before || before.deleted) return
    const v = !isDone(before)
    write(v)
    toast.current = pushToast(`${v ? 'Marked done' : 'Marked undone'}${whose ? ` for ${whose}` : ''}`, 'info', {
      duration: UNDO_MS,
      action: { label: 'Undo', icon: Undo2, onClick: () => { toast.current = null; write(doneState(before)) } },
    })
  }
}

/**
 * THE FOOTER HOLDS A REAL ACTION OR NOTHING (#77): Start, full width, the one
 * primary. Never Close (the header X), never done (the chip). Modal hides it
 * while a box has focus.
 */
export function SheetStart({ label, onStart }) {
  return (
    <div className="sheet-foot">
      <button type="button" className="btn" onClick={onStart}>
        <Icon name="Play" size={17} /> {label}
      </button>
    </div>
  )
}
