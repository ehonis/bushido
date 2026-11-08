/* The day switcher (#98: out of tabs.jsx): Today's title, the rest day's date. */

import { Icon } from './lib/icons.jsx'
import { localIso, isoShift, dayWords, dayLong } from './lib/dates.js'

/**
 * The day switcher (docs/DESIGN.md, "Components"): ‹ day › with the day in
 * words, never a raw browser date input. One component for Today, where the
 * day is the screen's title (`title`), and a date inside a form (the rest day).
 *
 * Backwards is for catching up a session done but never logged; forwards, where
 * `max` allows it, is a preview: tomorrow's work cannot have been done yet.
 */
export function DaySwitcher({ value, today = localIso(), onChange, min = null, max = null, title = false }) {
  const prev = isoShift(value, -1)
  const next = isoShift(value, 1)
  const canPrev = !min || prev >= min
  const canNext = !max || next <= max
  const words = dayWords(value, today)
  // Today, Yesterday and Tomorrow say which date they are underneath.
  const date = /^(Today|Yesterday|Tomorrow)$/.test(words)
    ? dayLong(value, today)
    : null
  const arrows = (
    <>
      <button type="button" className="iconbtn" onClick={() => onChange(prev)} disabled={!canPrev}
        aria-label="Previous day"><Icon name="ChevronLeft" size={20} /></button>
      <button type="button" className="iconbtn" onClick={() => onChange(next)} disabled={!canNext}
        aria-label="Next day"><Icon name="ChevronRight" size={20} /></button>
    </>
  )

  if (title) {
    return (
      <div className={`daytitle ${value > today ? 'future' : ''}`}>
        <div className="daytitle-words">
          <h2>{words}</h2>
          {date && <div className="sub">{date}</div>}
        </div>
        {value !== today && (
          <button type="button" className="btn quiet" onClick={() => onChange(today)}>Today</button>
        )}
        {arrows}
      </div>
    )
  }
  return (
    <div className="dayswitch">
      <button type="button" className="iconbtn" onClick={() => onChange(prev)} disabled={!canPrev}
        aria-label="Previous day"><Icon name="ChevronLeft" size={20} /></button>
      <div className="dayswitch-words" aria-live="polite">
        <span>{words}</span>
        {date && <span className="sub">{date}</span>}
      </div>
      <button type="button" className="iconbtn" onClick={() => onChange(next)} disabled={!canNext}
        aria-label="Next day"><Icon name="ChevronRight" size={20} /></button>
    </div>
  )
}
