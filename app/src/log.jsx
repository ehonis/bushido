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
 *
 * Since #81 the filter asks what Progress asks, in the same words: the kind of
 * thing first (Climbing, Lift, Run, Bike, Swim, Other: lib/scope.js), the plan's
 * categories inside it, and under Climbing a whole grade. A climbing row says
 * what was climbed ("8 routes · hardest 5.10+", lib/grades.js `climbLine`).
 */

import { restStats } from './lib/stats.js'
import { useMemo, useState } from 'react'
import { optFor } from './lib/menu.js'
import { Icon } from './lib/icons.jsx'
import { SessionSheet } from './sheet.jsx'
import { isDone, isTraining } from './lib/store.js'
import { loggedMinutes } from './lib/minutes.js'
import { localIso, dayWords } from './lib/dates.js'
import { categoryOf, disciplineOf } from './lib/category.js'
import { loggedActivity } from './lib/activities.js'
import { titleFor } from './lib/naming.js'
import { sessionOps } from './lib/sessionops.js'
import { pushToast } from './lib/toast.js'
import { ToastHost } from './toast.jsx'
import { Undo2 } from 'lucide-react'
import { withLine } from './lib/shared.js'
import { plannedLine } from './lib/trainer.js'
import { currentMe } from './lib/whoami.js'
import { climbLine, bandsOf, bandLabel } from './lib/grades.js'
import { ACTIVITY_SCOPES, activityScopeOf } from './lib/scope.js'
import { ScreenTitle, SubFilter, subFilterLabel } from './filters.jsx'
import { Explain } from './blurb.jsx'

const todayIso = () => localIso()

const fmt1 = (n) => Math.round(n * 10) / 10

/** A day's header: "Today", "Yesterday", then "Fri, Oct 23": the app's one way to write a day (lib/dates.js). */
export const dayLabel = (iso, today) => dayWords(iso, today)

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
  // What was climbed, said once: the count and the hardest send (lib/grades.js).
  const climbed = opt ? climbLine(opt, out) : ''
  if (climbed) s.push(climbed)
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
  // What the feed is narrowed to: the activity, a category inside it, a grade.
  const [filter, setFilter] = useState({ activity: null, category: null, band: null })
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

  const menu = useMemo(() => plan?.dailyMenu || [], [plan])
  const ops = sessionOps({ plan, entries, upsertEntry, deleteEntry, toast: pushToast, undoIcon: Undo2 })

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
        // The first question (lib/scope.js); a rest day is none of them.
        activity: Number(e.data?.level) === 0 || opt?.role === 'rest' ? null : activityScopeOf(e, plan),
        bands: opt ? bandsOf(opt, e.data?.out) : [],
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
    [entries, menu, plan])

  // Only offer filters that would actually match something. A row of chips where
  // half return nothing is a row of chips that teaches you not to use it.
  const allCats = useMemo(() => {
    const live = new Set(workouts.map(w => w.category).filter(Boolean))
    return (plan?.quotaCategories || []).filter(c => live.has(c.key))
  }, [workouts, plan])
  const catName = (key) => allCats.find(c => c.key === key)?.name || null

  const acts = useMemo(
    () => ACTIVITY_SCOPES.filter(a => workouts.some(w => w.activity === a.key)),
    [workouts])
  // The second level sits under the activity picked, or under the only one logged.
  const within = filter.activity || (acts.length === 1 ? acts[0].key : null)
  const cats = useMemo(() => {
    if (!within) return []
    const live = new Set(workouts.filter(w => w.activity === within).map(w => w.category).filter(Boolean))
    return allCats.filter(c => live.has(c.key))
  }, [workouts, allCats, within])
  // Grades: boulders, then routes, easiest first, each one only once something is graded at it.
  const bands = useMemo(() => {
    if (within !== 'climbing') return []
    const keys = new Set(workouts.flatMap(w => w.bands))
    return [...keys].map(k => {
      const [scale, b] = k.split(':')
      return { value: k, scale, band: Number(b), label: bandLabel(scale, Number(b)) }
    }).sort((a, b) => a.scale.localeCompare(b.scale) || a.band - b.band)
  }, [workouts, within])

  const narrowed = Boolean(filter.activity || filter.category || filter.band)
  const shown = workouts.filter(w =>
    (!filter.activity || w.activity === filter.activity) &&
    (!filter.category || w.category === filter.category) &&
    (!filter.band || w.bands.includes(filter.band)))
  const pickActivity = (key) => setFilter(f => ({ activity: f.activity === key ? null : key, category: null, band: null }))

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
      {/* Where a removal's Undo appears; only the first host mounted draws, so
          this and Today's never show one toast twice (toast.jsx). */}
      <ToastHost />
      <ScreenTitle>Log</ScreenTitle>
      {/* "All" and the kinds of thing actually logged, wrapping rather than
          running off the right edge. No counts: a number inside a chip read as
          part of its name ("Bike 10"). Only shown when there is something to choose. */}
      {acts.length > 1 && (
        <div className="filters logfilters" role="group" aria-label="Show">
          <button className={`chip ${!narrowed ? 'on' : ''}`} aria-pressed={!narrowed}
            onClick={() => setFilter({ activity: null, category: null, band: null })}>All</button>
          {acts.map(a => (
            <button key={a.key} className={`chip ${filter.activity === a.key ? 'on' : ''}`}
              aria-pressed={filter.activity === a.key} onClick={() => pickActivity(a.key)}>{a.name}</button>
          ))}
        </div>
      )}
      {/* Inside it, the plan's categories (Fun, Fingers, Endurance…). */}
      {cats.length > 1 && (
        <SubFilter className="logfilters logcats" label={subFilterLabel(acts.find(a => a.key === within)?.name)}>
          {cats.map(c => (
            <button key={c.key} className={`chip sub ${filter.category === c.key ? 'on' : ''}`}
              aria-pressed={filter.category === c.key}
              onClick={() => setFilter(f => ({ ...f, category: f.category === c.key ? null : c.key }))}>{c.name}</button>
          ))}
        </SubFilter>
      )}
      {/* Under Climbing, one whole grade: the sessions that touched it, sent or not. */}
      {bands.length > 0 && (
        <div className="card list progpick loggrade">
          <label className="list-row progpick-row">
            <span className="list-row-main"><span className="list-row-title">Grade</span></span>
            <span className={`progpick-value ${filter.band ? 'on' : ''}`}>
              {bands.find(b => b.value === filter.band)?.label || 'Any grade'}
            </span>
            <Icon name="ChevronRight" size={16} className="list-row-chev" />
            <select className="progpick-sel" aria-label="Grade" value={filter.band || ''}
              onChange={e => { const v = e.target.value || null; setFilter(f => ({ ...f, band: v })) }}>
              <option value="">Any grade</option>
              {bands.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
          </label>
        </div>
      )}
      {narrowed && !shown.length && workouts.length > 0 && (
        <div className="empty">
          <span>Nothing logged for that</span>
          <button type="button" className="btn secondary"
            onClick={() => setFilter({ activity: null, category: null, band: null })}>Show everything</button>
        </div>
      )}

      {!workouts.length && (
        <div className="empty">
          <Icon name="NotebookPen" size={24} />
          <span>Nothing logged yet</span>
          <Explain><span className="sub">Workouts you log show up here, newest first.</span></Explain>
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

      {open?.opt && (
        <LogSheet opt={open.opt} entry={open.entry} entries={entries} ops={ops} upsertEntry={upsertEntry}
          rest={open.rest} discipline={open.discipline} onClose={() => setOpenId(null)} />
      )}
    </>
  )
}


/**
 * A workout opened from the Log: THE SAME SHEET as Today's (#79, G F1), not a
 * second composition of it. The Log mounted a bare form, so a planned workout
 * opened from here showed "What did you lift?" and none of its exercises, its
 * done chip or its sharing, while the same entry from Today showed all of them.
 * What differs is a parameter: the day is the entry's own, and nothing is run
 * from history (no Start; the runner is Today's). The writes are Today's too
 * (lib/sessionops.js, #76): the name, the load level, the minutes and the test
 * result follow the out, and a removal takes the result with it, with Undo.
 */
export function LogSheet({ opt, entry, entries, ops, upsertEntry, rest = false, discipline = null, onClose }) {
  // Only where the question makes sense: a commute is a ride, not a set of
  // max hangs. Driven by the discipline rather than by a list.
  const onTraining = ['bike', 'run', 'swim', 'other'].includes(discipline) ? ops.setTraining(entry, opt) : null
  return (
    <SessionSheet opt={opt} entry={entry} tone={rest ? 'rest' : null} entries={entries}
      isFuture={Boolean(entry?.date) && entry.date > todayIso()}
      onLog={null}
      onSave={(e, out) => ops.saveOutputs(e, out)}
      onSavePlan={(e, pres) => ops.savePlan(e, pres)}
      // Closed on removal, so an Undo puts the workout back in the feed.
      onRemove={(e) => { onClose(); ops.removeSession(e) }}
      onSetDone={(e, v) => ops.setDone(e, v)}
      onSaveEntry={upsertEntry}
      onStartWorkout={null}
      onTraining={onTraining}
      onClose={onClose} />
  )
}
