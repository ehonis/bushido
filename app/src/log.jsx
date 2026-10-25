/*
 * The log: every workout, newest first.
 *
 * Rebuilt 2026-09-15. What it replaced was two things wearing one tab: a charts
 * view, and an "Add & history" half made of a climbing-only quick-log (edge mm,
 * added lb, hang seconds) and a list rendering every entry as one terse line —
 * `3.1 mi`, `Run`, `20mm · +45 lb · 7s`. That was a reasonable log for an app
 * that only did hangboarding, and it stopped being one somewhere around the
 * ninety-first activity.
 *
 * The quick-log is gone rather than moved. Every field it offered now has a
 * better home: bodyweight is on the profile and writes the same series, and a max
 * hang is logged by the session that IS that test, which writes the test result
 * itself (see lib/tests.js). A second way in was a second thing to keep honest.
 *
 * Charts moved to their own tab. They were never history — they are the answer to
 * a different question, and sharing a tab with the feed meant one of them was
 * always the wrong thing to be looking at.
 *
 * THE FEED IS WORKOUTS, not entries. Bodyweight, notes, tests and skips are all
 * real entries and none of them belongs in a list of things the user did.
 *
 * Since wave 2 (issue #43) it is one card per DAY with each workout a row: name,
 * one line of time and distance, a chevron. The row opens the sheet; gear, effort
 * and WHOOP/Strava are read there, not repeated on every row.
 */

import { restStats } from './lib/stats.js'
import { useMemo, useState } from 'react'
import { optFor } from './lib/menu.js'
import { Icon } from './lib/icons.jsx'
import { SessionLog, DetailsSheet } from './sessionlog.jsx'
import { Modal } from './modal.jsx'
import { isDone, isTraining } from './lib/store.js'
import { loggedMinutes } from './lib/minutes.js'
import { fromIso, localIso } from './lib/dates.js'
import { categoryOf, disciplineOf } from './lib/category.js'
import { loggedActivity } from './lib/activities.js'
import { titleFor, withCasualName } from './lib/naming.js'
import { withLine } from './lib/shared.js'
import { plannedLine } from './lib/trainer.js'
import { currentMe } from './lib/whoami.js'

const todayIso = () => localIso()

const fmt1 = (n) => Math.round(n * 10) / 10

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * A day's header: "Today", "Yesterday", then "Fri 23 Oct" (with the year once it
 * is not this one). Spelled out by hand rather than through toLocaleDateString so
 * the server render, the phone and every browser write the same words.
 */
export function dayLabel(iso, today) {
  if (iso === today) return 'Today'
  const y = fromIso(today); y.setDate(y.getDate() - 1)
  if (iso === localIso(y)) return 'Yesterday'
  const d = fromIso(iso)
  const label = `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}`
  return d.getFullYear() === fromIso(today).getFullYear() ? label : `${label} ${d.getFullYear()}`
}

/**
 * The one line under a workout's name: how long, then how far. The same order
 * as Today's rows, so a workout reads the same wherever it is listed. Effort is
 * in the sheet; on a row it was a bare "RPE 5" nobody outside the app can read.
 */
export function statsOf(entry, opt) {
  const out = entry.data?.out || {}
  const s = []
  // Typed or measured only, as Today's rows (lib/minutes.js); never the card's estimate.
  const mins = loggedMinutes(entry, opt)

  if (mins !== null) s.push(`${mins} min`)
  if (Number(out.distance) > 0) s.push(`${fmt1(Number(out.distance))} mi`)
  if (Number(out.poolDistance) > 0) s.push(`${Math.round(Number(out.poolDistance))} yd`)
  const lifts = Array.isArray(out.lifts) ? out.lifts.length : 0
  if (lifts) s.push(`${lifts} exercise${lifts === 1 ? '' : 's'}`)
  return s
}

/**
 * What a workout is called on its row. The card's own name is the name of the
 * button that made it ("Log a workout"), so a free-form workout with no activity
 * picked yet is just a workout rather than an instruction.
 */
export function rowName(opt, entry) {
  if (!opt) return entry.data?.name || 'Workout'
  const name = titleFor(opt, entry.data?.out, entry.data?.plan)
  return opt.categoryFrom === 'activity' && name === opt.name ? 'Workout' : name
}

export function LogTab({ plan, entries, upsertEntry, deleteEntry, onLog }) {
  const today = todayIso()
  const [filter, setFilter] = useState('all')
  /*
   * WHICH workout is open, never a copy of it.
   *
   * This held the row object itself until 2026-09-21, which meant the sheet
   * rendered a SNAPSHOT: editing from inside it wrote to the store and the store
   * was no longer what was on screen. The rename made that visible — tapping the
   * "Commute" chip saved "Commute", and the header above it, the chip's own
   * pressed state and the way back to "Bike" all still described the entry as it
   * had been when the user opened it. The same shape as the runner's double write and
   * the planner's two-place batch: a component holding a copy of a synced entry
   * is a component showing the past.
   */
  const [openId, setOpenId] = useState(null)
  // The details layer, behind the pencil. See DetailsSheet in sessionlog.jsx.
  const [editing, setEditing] = useState(false)

  const menu = plan?.dailyMenu || []

  /*
   * Workouts only, newest first. A logged REST day is kept — "I deliberately did
   * nothing on Tuesday" is a fact about the week that a feed which silently
   * dropped it would misrepresent as a gap.
   */
  const workouts = useMemo(() => entries
    .filter(e => e.kind === 'daily' && !e.deleted && e.date && isDone(e))
    .map(e => {
      const opt = optFor(menu, e.data?.optId) || null
      // The ACTIVITY's icon, not the card's. The workout card is one container
      // for ninety-one sports and its own icon is a generic squiggle, so a feed
      // reading off `opt.icon` gave a ride, a lift and a swim the same glyph —
      // which is most of the feed wearing one face.
      const act = opt ? loggedActivity(opt, e.data?.out) : null
      return {
        entry: e,
        opt,
        name: rowName(opt, e),
        icon: act?.icon || opt?.icon || 'Activity',
        category: categoryOf(e, menu),
        discipline: disciplineOf(e, menu),
        rest: Number(e.data?.level) === 0 || opt?.role === 'rest',
        // Logged as activity rather than training — a commute, an errand on the
        // bike. Its miles count; its load and its quota do not, so the card says so.
        casual: !isTraining(e),
        // A workout done together: "with Sam" (or, in Sam's log, "with Alex"). lib/shared.js.
        with: withLine(e, currentMe().people),
        // A session the owner planned for this person: "planned by Alex". lib/trainer.js.
        by: plannedLine(e, currentMe()),
      }
    })
    .sort((a, b) => String(b.entry.date).localeCompare(String(a.entry.date)) ||
                    String(b.entry.id).localeCompare(String(a.entry.id))),
    [entries, menu])

  // Only offer filters that would actually match something. A row of chips where
  // half return nothing is a row of chips that teaches you not to use it.
  const cats = useMemo(() => {
    const live = new Set(workouts.map(w => w.category).filter(Boolean))
    return (plan?.quotaCategories || []).filter(c => live.has(c.key))
  }, [workouts, plan])
  const catName = (key) => cats.find(c => c.key === key)?.name || null

  const shown = filter === 'all' ? workouts : workouts.filter(w => w.category === filter)

  // Re-derived on every render, so a save inside the sheet is on screen at once.
  const open = openId ? workouts.find(w => w.entry.id === openId) || null : null

  // Grouped by date, so a day that held three workouts reads as one day.
  const days = useMemo(() => {
    const m = new Map()
    for (const w of shown) {
      if (!m.has(w.entry.date)) m.set(w.entry.date, [])
      m.get(w.entry.date).push(w)
    }
    return [...m.entries()]
  }, [shown])

  return (
    <>
      {/* "All" and the categories actually logged, wrapping rather than running
          off the right edge. No counts: a number inside a chip read as part of
          its name ("Bike 10"). Only shown when there is something to choose. */}
      {cats.length > 1 && (
        <div className="filters logfilters" role="group" aria-label="Show">
          <button className={`chip ${filter === 'all' ? 'on' : ''}`} aria-pressed={filter === 'all'}
            onClick={() => setFilter('all')}>All</button>
          {cats.map(c => (
            <button key={c.key} className={`chip ${filter === c.key ? 'on' : ''}`} aria-pressed={filter === c.key}
              onClick={() => setFilter(c.key)}>{c.name}</button>
          ))}
        </div>
      )}

      {!workouts.length && (
        <div className="empty">
          <Icon name="NotebookPen" size={24} />
          <span>Nothing logged yet</span>
          <span className="sub">Workouts you log show up here, newest first.</span>
          {/* The one way to fill it, when the shell hands it over (App.jsx's openLog). */}
          {onLog && <button type="button" className="btn" onClick={() => onLog()}>Log a workout</button>}
        </div>
      )}

      {/*
        * One card per day, its workouts as rows (2026-10-25, wave 2). It was a
        * card per workout under a capitalised date with a count, so a list of
        * eight things was eight boxes, and each wore a down chevron as if it
        * opened in place. A row opens the sheet, and the sheet is the one place
        * a workout is read in full.
        */}
      {days.map(([date, list]) => (
        <section className="logday" key={date} aria-label={dayLabel(date, today)}>
          <div className="section-head"><h3>{dayLabel(date, today)}</h3></div>
          <div className="card list logday-list">
            {list.map(w => {
              const stats = w.rest ? restStats(w.entry, w.opt) : statsOf(w.entry, w.opt)
              // The category only where it says something the name does not:
              // "Commute" is a ride, "Run" is already a run.
              const cat = !w.rest && catName(w.category)
              const meta = [
                cat && cat.toLowerCase() !== w.name.toLowerCase() ? cat : null,
                ...stats,
                w.casual ? 'just miles' : null,
              ].filter(Boolean)
              const people = [w.with, w.by].filter(Boolean)
              return (
                <button key={w.entry.id} type="button"
                  className={`list-row logrow ${w.rest ? 'rest' : ''} ${w.casual ? 'casual' : ''}`}
                  disabled={!w.opt} onClick={() => setOpenId(w.entry.id)}>
                  <Icon name={w.icon} size={20} />
                  <span className="list-row-main">
                    <span className="list-row-title">{w.name}</span>
                    {meta.length > 0 && <span className="list-row-meta">{meta.join(' · ')}</span>}
                    {/* A workout done together, or one the owner planned for this
                        person: lib/shared.js, lib/trainer.js. */}
                    {people.length > 0 && <span className="list-row-meta logrow-who">{people.join(' · ')}</span>}
                  </span>
                  <Icon name="ChevronRight" size={16} className="list-row-chev" />
                </button>
              )
            })}
          </div>
        </section>
      ))}

      {open?.opt && (() => {
        /* `name` travels with the out, because `out.title` is where a rename lives
           and `data.name` is the denormalised copy the habit note and the server
           read. Recomputing it here is what makes a rename show up on the row
           behind this modal. See lib/naming.js. */
        const save = (out) => upsertEntry({ ...open.entry, data: {
          ...open.entry.data, out, name: titleFor(open.opt, out, open.entry.data?.plan) } })
        /* Only where the question makes sense: a commute is a ride, not a set of
           max hangs. Driven by the discipline rather than by a list. */
        const onTraining = ['bike', 'run', 'swim', 'other'].includes(open.discipline)
          ? (v) => {
              const casual = v === false
              // A ride marked as just miles is named as a commute.
              // Fills a blank name and takes back only its own.
              const out = withCasualName(open.entry.data?.out || {},
                { plan, opt: open.opt, on: casual })
              upsertEntry({ ...open.entry, data: {
                ...open.entry.data, out,
                name: titleFor(open.opt, out, open.entry.data?.plan),
                training: casual ? false : undefined } })
            }
          : null
        return (
          <Modal title={open.name} sub={dayLabel(open.entry.date, today)} icon={open.icon}
            onClose={() => { setOpenId(null); setEditing(false) }}
            /*
              * The SAME pencil and the same bin as the day's session sheet,
              * because this is the same session seen from the feed. The name, the
              * gear, "just miles" and time spent live behind the pencil since
              * 2026-09-21 and this sheet would otherwise have lost them outright.
              *
              * Delete moved off a footer link at the same time. It used to fire
              * immediately; through the header it goes through the confirmation
              * screen every other delete in the app uses.
              */
            onRename={() => setEditing(true)}
            onDelete={() => { deleteEntry?.(open.entry.id); setOpenId(null) }}
            deleteLabel="Delete this workout"
            deleteBody="It goes out of the log, out of your training load and off the streak. The measurement it carries goes with it.">
            <SessionLog session={open.opt} entry={open.entry} entries={entries} bare
              onSave={save} />

            {editing && (
              <DetailsSheet session={open.opt} entry={open.entry} entries={entries}
                onSave={save} training={open.entry.data?.training} onTraining={onTraining}
                onClose={() => setEditing(false)} />
            )}
          </Modal>
        )
      })()}
    </>
  )
}
