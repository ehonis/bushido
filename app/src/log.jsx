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
 * THE FEED IS ONE CARD PER WORKOUT, not one per entry. A day with a ride, a lift
 * and a check-in is three rows of very different importance, and the check-in is
 * not a workout. Bodyweight, notes, tests and skips are all real entries and none
 * of them belongs in a list of things the user did.
 */

import { restStats } from './lib/stats.js'
import { useMemo, useState } from 'react'
import { optFor } from './lib/menu.js'
import { Icon } from './lib/icons.jsx'
import { SessionLog, DetailsSheet } from './sessionlog.jsx'
import { Modal } from './modal.jsx'
import { isDone, isTraining } from './lib/store.js'
import { minutesFor } from './lib/minutes.js'
import { fromIso, localIso } from './lib/dates.js'
import { categoryOf, disciplineOf } from './lib/quota.js'
import { gearOn, gearUsage } from './lib/gear.js'
import { loggedActivity } from './lib/activities.js'
import { useStrava } from './lib/strava.jsx'
import { titleFor, withCasualName } from './lib/naming.js'

const todayIso = () => localIso()

const fmt1 = (n) => Math.round(n * 10) / 10

/** A human date that says "today" and "yesterday", because those are most of them. */
function dayLabel(iso, today) {
  if (iso === today) return 'Today'
  const d = fromIso(iso)
  const y = fromIso(today); y.setDate(y.getDate() - 1)
  if (iso === localIso(y)) return 'Yesterday'
  const within = (Date.parse(today) - Date.parse(iso)) / 86400000
  return d.toLocaleDateString([], within < 300
    ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * The numbers worth putting on a card, in the order they matter for THAT sport.
 *
 * Distance leads for a ride and a run because it is the thing the user'd say out loud;
 * for a lift it is the exercises, and for climbing it is how hard it went. A card
 * that led with duration for everything would be a card that told them nothing.
 */
function statsOf(entry, opt, plan) {
  const out = entry.data?.out || {}
  const s = []
  const mins = minutesFor(opt, out)

  if (Number(out.distance) > 0) s.push(`${fmt1(Number(out.distance))} mi`)
  if (Number(out.poolDistance) > 0) s.push(`${Math.round(Number(out.poolDistance))} yd`)
  if (mins > 0) s.push(`${Math.round(mins)} min`)
  if (Number(out.elevation) > 0) s.push(`${Math.round(Number(out.elevation))} ft`)
  if (Number(out.speed) > 0) s.push(`${fmt1(Number(out.speed))} mph`)
  const lifts = Array.isArray(out.lifts) ? out.lifts.length : 0
  if (lifts) s.push(`${lifts} exercise${lifts === 1 ? '' : 's'}`)
  if (Number(out.rpe) > 0) s.push(`RPE ${out.rpe}`)
  return s
}

export function LogTab({ plan, entries, upsertEntry, deleteEntry }) {
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
  const { cache: strava } = useStrava()

  const menu = plan?.dailyMenu || []
  const gearById = useMemo(() => {
    const rows = plan ? gearUsage({ plan, entries, strava }) : []
    return new Map(rows.map(r => [r.id, r]))
  }, [plan, entries, strava])

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
        name: opt ? titleFor(opt, e.data?.out, e.data?.plan) : (e.data?.name || 'Session'),
        icon: act?.icon || opt?.icon || 'Activity',
        category: categoryOf(e, menu),
        discipline: disciplineOf(e, menu),
        rest: Number(e.data?.level) === 0 || opt?.role === 'rest',
        // Logged as activity rather than training — a commute, an errand on the
        // bike. Its miles count; its load and its quota do not, so the card says so.
        casual: !isTraining(e),
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
      <div className="filters logfilters">
        <button className={`chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>
          All <em>{workouts.length}</em>
        </button>
        {cats.map(c => (
          <button key={c.key} className={`chip ${filter === c.key ? 'on' : ''}`}
            onClick={() => setFilter(c.key)}>
            {c.name} <em>{workouts.filter(w => w.category === c.key).length}</em>
          </button>
        ))}
      </div>

      {!workouts.length && (
        <div className="card">
          <h2>Nothing logged yet</h2>
          <p className="sub" style={{ margin: 0 }}>
            Everything you finish on the <strong>Today</strong> tab shows up here, newest
            first, with what it was done on.
          </p>
        </div>
      )}

      {days.map(([date, list]) => (
        <div className="logday" key={date}>
          <h3 className="logday-head">
            <span>{dayLabel(date, today)}</span>
            <span className="logday-n">{list.length} workout{list.length === 1 ? '' : 's'}</span>
          </h3>
          {list.map(w => (
            <button className={`card logcard ${w.rest ? 'rest' : ''} ${w.casual ? 'casual' : ''}`} key={w.entry.id}
              onClick={() => w.opt && setOpenId(w.entry.id)}>
              <span className="logcard-ico"><Icon name={w.icon} size={18} /></span>
              <span className="logcard-body">
                <span className="logcard-head">
                  <strong>{w.name}</strong>
                  {w.category && (
                    <span className="logcard-cat">
                      {plan.quotaCategories.find(c => c.key === w.category)?.name}
                    </span>
                  )}
                  {w.casual && <span className="logcard-casual">just miles</span>}
                </span>
                <span className="logcard-stats">
                  {(w.rest ? restStats(w.entry, w.opt) : statsOf(w.entry, w.opt, plan))
                    .map((t, i) => <span key={i}>{t}</span>)}
                </span>
                {/* What it was done on — the point of attaching gear at all. */}
                {gearOn(w.entry).length > 0 && (
                  <span className="logcard-gear">
                    <Icon name="ShoppingBag" size={12} />
                    {gearOn(w.entry)
                      .map(id => gearById.get(id)?.name || 'gear you deleted')
                      .join(' · ')}
                  </span>
                )}
                {(w.entry.data?.out?.whoop || w.entry.data?.out?.strava) && (
                  <span className="logcard-srcs">
                    {w.entry.data.out.whoop && <span className="srcpip whoop">WHOOP</span>}
                    {w.entry.data.out.strava && <span className="srcpip strava">Strava</span>}
                  </span>
                )}
              </span>
              <Icon name="ChevronDown" size={16} className="logcard-chev" />
            </button>
          ))}
        </div>
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
            deleteBody="It goes out of the log, out of the week's quotas, out of your training load and off the streak. The measurement it carries goes with it.">
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
