/*
 * The app's frame (#98: out of App.jsx): which tabs there are, the acting
 * banner, the + menu, the rest-day prompt and the streak in the header. The
 * phone's are features/app.tsx.
 */

import { useEffect, useState } from 'react'
import { DaySwitcher } from './dayswitcher.jsx'
import { Icon } from './lib/icons.jsx'
import { localIso } from './lib/dates.js'
import { streakDays } from './lib/streak.js'
import { aiOffered } from './lib/plannerapi.js'
import { Modal } from './modal.jsx'
import { currentMe, actAs } from './lib/whoami.js'

/*
 * Three tabs, since 2026-10-25 (issue #31): Today, Log, Progress. Bushido is a
 * workout log, and those are the three things a log is for: what is on the day,
 * what was done, and how it is going. Week went with the quotas, and
 * Achievements, Goals and Coach went because they were not used. Gear, Testing
 * and Why live under the profile: reference, not doing.
 */
const TABS = [
  { id: 'today', label: 'Today' },
  { id: 'log', label: 'Log' },
  { id: 'progress', label: 'Progress' },
]

/*
 * What this person's app offers. Every tab is everyone's now; the signature
 * stays because callers (and the iPhone app) still pass features and ownership.
 */
export const tabsFor = () => TABS

/**
 * Says whose log is open when the owner is acting as someone else, on every
 * screen, with the way back. Logging into the wrong log is the failure this
 * whole feature has to make hard, and the avatar alone is too quiet for it.
 */
export function ActingBanner({ me }) {
  const [busy, setBusy] = useState(false)
  if (!me?.acting) return null
  return (
    <div className="acting" role="status">
      <Icon name="Users" size={15} />
      <span>Logging for <strong>{me.name}</strong></span>
      <button className="acting-back" disabled={busy}
        onClick={() => { setBusy(true); actAs(null).catch(() => setBusy(false)) }}>
        {busy ? 'Switching…' : `Back to ${me.real.name || 'me'}`}
      </button>
    </div>
  )
}

/**
 * What the + offers.
 *
 * It began as two things, deliberately. The swap list it replaced showed thirty
 * cards in three ranked groups, which is a menu you read rather than a button you
 * press — and the ranking was the recommender, which is the thing that came off
 * this app. What is left is the actual choice: is this a workout you are about to
 * write down, or one you have already done? "Pick a session" came back the same
 * day because twenty-one climbing cards had no other door, and went again on
 * 2026-10-14 when those cards moved into Log a workout as the Bouldering and Rock
 * climbing folders (see lib/folders.js). "Plan the week" went with the quotas
 * on 2026-10-25.
 *
 * A sheet from the bottom on a phone, because the button is at the bottom and a
 * menu that opens away from your thumb is a menu you reach across the screen for.
 *
 * Log a workout leads (2026-10-25, docs/DESIGN.md D7 and "The + menu, final
 * shape"): writing down what you did is what the + is pressed for most, so it is
 * the first row and the only one in the accent. Logging doors, then planning,
 * then tools. Each door says what it is in one line; the paragraphs that used to
 * sit under each one made the menu something to read rather than to press.
 *
 * `quick` is the quick-log rows (quicklog.jsx), right under Log a workout: the
 * last few activities, one tap each, so "I did a run" is + → Run (docs/DESIGN.md,
 * "Logging in two taps").
 */
/*
 * `ai`: whether "Write it for me" is on offer (lib/plannerapi.js). Without it the
 * Plan door says only what is there, the same rule as Plan a workout itself (#55).
 */
export function FabMenu({ onClose, onPlan, onLog, onRest, onTimer = null, quick = null, ai = aiOffered(currentMe().features) }) {
  return (
    <div className="fabmenu-scrim" onClick={onClose} role="presentation">
      <div className="fabmenu" onClick={e => e.stopPropagation()} role="dialog" aria-label="Add a workout">
        <button className="fabmenu-row" onClick={onLog}>
          <span className="fabmenu-ico log"><Icon name="NotebookPen" size={22} /></span>
          <span className="fabmenu-body">
            <strong>Log a workout</strong>
            <span className="sub">Something you already did</span>
          </span>
        </button>
        {quick}
        {/* A rest day the user chose is part of the week, and it used to be a link at the
            foot of the old session picker, under thirty cards — which is to say nowhere.
            One tap: choosing it is the whole action, so nothing opens. */}
        {onRest && (
          <button className="fabmenu-row" onClick={onRest}>
            <span className="fabmenu-ico rest"><Icon name="Sunset" size={22} /></span>
            <span className="fabmenu-body">
              <strong>Log a rest day</strong>
              <span className="sub">A day off on purpose</span>
            </span>
          </button>
        )}
        <button className="fabmenu-row" onClick={onPlan}>
          <span className="fabmenu-ico plan"><Icon name="ClipboardCheck" size={22} /></span>
          <span className="fabmenu-body">
            <strong>Plan a workout</strong>
            <span className="sub">{ai ? 'Build it yourself, or have it written for you' : 'Build it yourself'}</span>
          </span>
        </button>
        {/* A timer on its own, for a workout nobody is logging yet. See timer.jsx. */}
        {onTimer && (
          <button className="fabmenu-row" onClick={onTimer}>
            <span className="fabmenu-ico"><Icon name="Timer" size={22} /></span>
            <span className="fabmenu-body">
              <strong>Interval timer</strong>
              <span className="sub">Work, rest and rounds</span>
            </span>
          </button>
        )}
        <button className="fabmenu-cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}

/**
 * Why rest today — asked before it is logged, not after.
 *
 * A rest day with no reason reads the same in a month whether the user was sick, beat
 * up or just busy, and those are three different things to look back on. The chips are the rest card's own `why` output (plan.json), so the same
 * answer shows up and stays editable in the session sheet afterwards; the box is
 * the ordinary `out.notes`. Both optional — a prompt, not a gate.
 */
export function RestPrompt({ opt, date: initialDate, entryFor, onSave, onClose }) {
  const field = (opt?.outputs || []).find(f => f.key === 'why')
  const today = localIso()
  const [date, setDate] = useState(initialDate || today)
  const existing = entryFor ? entryFor(date) : null
  const [why, setWhy] = useState(existing?.data?.out?.why)
  const [notes, setNotes] = useState(existing?.data?.out?.notes || '')
  // Moving the date onto a day that already rests shows THAT day's answer, so
  // saving edits it rather than overwriting it with what was typed for another.
  useEffect(() => {
    setWhy(existing?.data?.out?.why)
    setNotes(existing?.data?.out?.notes || '')
  }, [existing?.id]) // eslint-disable-line react-hooks/exhaustive-deps -- reloaded only when the date lands on another entry; following its fields would overwrite what is being typed
  const save = () => onSave({ date, why: why || undefined, notes: notes.trim() || undefined })

  return (
    <Modal title="Rest day" sub={existing ? 'Already a rest day' : null}
      icon={opt?.icon || 'Sunset'} tone="rest" onClose={onClose}
      footer={
        <button className="btn" onClick={save}>
          <Icon name="Check" size={16} /> {existing ? 'Save' : 'Log the rest day'}
        </button>
      }>
      {/* Any day up to today — a rest day the user forgot to log is still one the
          user took. The day switcher, as on Today, not a browser date box. */}
      <div className="field rest-day">
        <span>Day</span>
        <DaySwitcher value={date} today={today} max={today} onChange={setDate} />
      </div>
      {field && (
        <div className="out-field rest-why">
          <div className="out-label"><span>{field.label}</span></div>
          <div className="out-choices">
            {field.options.map(o => {
              const on = why === o.value
              return (
                <button key={o.value} type="button" className={`out-chip ${on ? 'on' : ''}`}
                  aria-pressed={on} onClick={() => setWhy(on ? undefined : o.value)}>
                  {o.icon && <Icon name={o.icon} size={14} />}
                  <span>{o.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
      <label className="notefield">
        <span className="notefield-label">Notes</span>
        <textarea rows={3} value={notes} placeholder="Optional"
          onChange={e => setNotes(e.target.value)} />
      </label>
    </Modal>
  )
}

/**
 * Days in a row, in the header.
 *
 * NO BACKGROUND and no border — it is a reading, not a control, and the only two
 * things in that corner you can press are the profile button and the tabs. Giving
 * it a pill would make it look like a third.
 *
 * Renders NOTHING at zero. "0 days" is not a streak, it is the absence of one,
 * and a counter that sits at zero for a week is a counter the user stops seeing.
 */
export function HeaderStreak({ entries }) {
  const n = streakDays(entries)
  if (!n) return null
  return (
    <span className="hdr-streak" title={`${n} day${n === 1 ? '' : 's'} trained in a row`}>
      <Icon name="Flame" size={15} className="hdr-streak-ico" />
      <span className="hdr-streak-n">{n}</span>
    </span>
  )
}
