/*
 * Today (the tab). Everything here is driven by the plan file: no training
 * content is hardcoded, so the program can be revised by editing that file with
 * no rebuild. The day's rows and their sheets are daylist.jsx; the ‹ day ›
 * switcher is dayswitcher.jsx (#98: this file held all three).
 */

import { useEffect, useMemo, useState } from 'react'
import { LoadCalendar } from './lib/viz.jsx'
import { localIso, isoShift } from './lib/dates.js'
import { isDone, extraEntryId, doneWhenPlaced } from './lib/store.js'
import { sessionOps } from './lib/sessionops.js'
import { minutesFor } from './lib/minutes.js'
import { levelFor } from './lib/level.js'
import { titleFor } from './lib/naming.js'
import { UnloggedWorkouts } from './unlogged.jsx'
import { currentMe } from './lib/whoami.js'
import { planPeople } from './lib/trainer.js'
import { rememberSide } from './sharedwith.jsx'
import { PeopleDays } from './trainer.jsx'
import { lazyPart } from './lazy.jsx'
import { ToastHost } from './toast.jsx'
import { QuickLog } from './quicklog.jsx'
import { pushToast } from './lib/toast.js'
import { Undo2 } from 'lucide-react'
import { DaySwitcher } from './dayswitcher.jsx'
import { DaySessions } from './daylist.jsx'

// WHOOP on Today, loaded on demand; one that cannot load draws nothing, as an
// install without WHOOP (lazy.jsx: never a card over the day or the +).
const WhoopReadiness = lazyPart(() => import('./whoopday.jsx'), 'WhoopReadiness')
const WhoopSleep = lazyPart(() => import('./whoopday.jsx'), 'WhoopSleep')

const todayIso = () => localIso()
/* Stable identity, so "nothing dismissed" is not a new array on every render. */
const NO_SKIPS = []

// The week is a calendar week now, Monday to Sunday. `plan.weeks` — eleven dated
// weeks counting down to a trip — went on 2026-09-14 along with the trip.

/* ------------------------------------------------------------------ today */
/**
 * Today.
 *
 * Rebuilt on 2026-09-17, and what came out of it is shorter than what went in.
 * It used to lead with the recommender: a quota board of eleven lanes, each an
 * offer; a list of companion sessions that ride along; a card explaining why
 * today was what it was; a swap list ranked by the same engine; and a rest day
 * button under all of it. Every one of those was the app having an opinion about
 * what the user should do.
 *
 * None of it is here because a set schedule or recommended workouts do not get
 * followed. A recommender the user ignores is not a recommender that needs
 * tuning — it is a screen that opens with an argument nobody wanted to have,
 * every day, in the two minutes before training.
 *
 * So Today is now one thing: WHAT IS ACTUALLY ON THE DAY — sessions the user planned or logged, and nothing
 *      the user did not. An empty day renders as an empty day rather than as five
 *      suggestions.
 *
 * Adding to the day moved OUT of this screen entirely and onto the + button,
 * which offers the things the user actually does: plan one (the planner writes
 * the sets), log one (something already done) or take a rest day. See
 * planner.jsx and App.jsx.
 *
 * The quota bars that used to lead this screen, the journal beside it and the
 * recommender behind both were removed on 2026-10-25 (issue #31). Old quota and
 * journal entries stay in the log and nothing here reads them.
 */

export function TodayTab({
  plan, entries, upsertEntry, deleteEntry,
  openEntryId = null, onOpened = () => {},
  onPlan = null, onLog = null, onRest = null, onViewDay = null, showDay = null, onDayShown = null,
}) {
  const today = todayIso()
  const [iso, setIso] = useState(today)
  /*
   * Two ways another screen sends Today to a day, and only one drives it at a
   * time; each is applied once and never again on a remount.
   * - A workout OPENED from elsewhere (the planner's Start workout) is shown on
   *   ITS day: Today may be showing another one, and the day's sessions only look
   *   for it among what is on screen, so Start did nothing (#95, C N5). Followed
   *   once per opening (`followed`); the opening clears itself once it opens.
   * - A day ASKED for (the planner's "See it on Mon", #94), applied once and
   *   handed back (`onDayShown`), so Today does not jump to it again on its next
   *   mount. While a workout is being opened, the opening owns the day: the
   *   asked-for day is only handed back.
   */
  const [followed, setFollowed] = useState(null)
  const opening = openEntryId ? entries.find(e => e.id === openEntryId && e.kind === 'daily') : null
  if (opening && followed !== opening.id) {
    setFollowed(opening.id)
    if (opening.date && opening.date !== iso) setIso(opening.date)
  } else if (!openEntryId && followed) setFollowed(null)
  useEffect(() => {
    if (showDay?.date && opening) { onDayShown?.(); return }
    if (showDay?.date) { setIso(showDay.date); onDayShown?.() }
  }, [showDay]) // eslint-disable-line react-hooks/exhaustive-deps -- applied once per request (each carries its own seq), never again as the day's rows change
  // The + button logs onto the day being looked at, so it has to know which.
  useEffect(() => { onViewDay?.(iso) }, [iso]) // eslint-disable-line react-hooks/exhaustive-deps -- said when the day changes; App's setter is stable, and a new callback is no new day
  const isFuture = iso > today

  // A day is a list of sessions: one main, plus any number of extras. Entries
  // logged before extras existed carry no slot and are main by definition.
  const dayEntries = entries.filter(e => e.kind === 'daily' && e.date === iso)
  const mainEntry = dayEntries.find(e => e.data?.slot !== 'extra') || null
  const extraEntries = dayEntries
    .filter(e => e.data?.slot === 'extra')
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))

  /*
   * Waving off a MEASURED workout the services recorded.
   *
   * This survived the cull and the session-dismissal machinery did not, and the
   * difference is what is being declined. "That ride was not a workout" is a fact
   * about a measurement; "stop suggesting me rides" was an answer to a question
   * the app has stopped asking.
   */
  const workoutPrefs = entries.find(e => e.kind === 'skip-workout' && e.date === iso)?.data || null
  const skippedWorkouts = workoutPrefs?.ids || NO_SKIPS
  // Pairs the user has said are NOT the same activity. Recorded for the same reason: the
  // app asserted two measurements were one ride, the user said no, and it must not
  // assert it again tomorrow.
  const splitWorkouts = workoutPrefs?.split || NO_SKIPS
  const saveWorkoutPrefs = (next) =>
    upsertEntry({ id: `skip-workout-${iso}`, kind: 'skip-workout', date: iso,
      data: { ids: skippedWorkouts, split: splitWorkouts, ...next } })
  const dismissWorkout = (id) => {
    if (skippedWorkouts.includes(id)) return
    saveWorkoutPrefs({ ids: [...skippedWorkouts, id] })
  }
  const splitWorkout = (id) => {
    if (splitWorkouts.includes(id)) return
    saveWorkoutPrefs({ split: [...splitWorkouts, id] })
  }
  const restoreWorkout = (id) => saveWorkoutPrefs({ ids: skippedWorkouts.filter(x => x !== id) })

  /*
   * Logging a measured workout the services already knew about.
   *
   * Lands as an ordinary EXTRA rather than as the day's main session. A ride is
   * something the user also did; it should not displace whatever the day already is.
   * `fresh` because two rides in a day are two workouts.
   */
  const logMeasured = (opt, out, extra = {}) => {
    const id = extraEntryId(iso, opt.id, dayEntries, { fresh: true })
    upsertEntry({ id, kind: 'daily', date: iso, data: {
      ...sessionData(opt, null), out,
      name: titleFor(opt, out),
      minutes: minutesFor(opt, out),
      level: levelFor(opt, out),
      slot: 'extra',
      // Measured, not planned: it happened, so it is done.
      done: true,
      // `{ training: false }` from the "just miles" button — see lib/store.js.
      ...extra,
    } })
  }

  const calendar = useMemo(() => {
    const m = new Map()
    for (const e of entries) {
      if (e.kind !== 'daily' || !isDone(e)) continue
      const level = e.data?.level ?? 1
      const prev = m.get(e.date)
      // The heaviest thing you did is what the day actually cost you.
      if (!prev || level > prev.level) m.set(e.date, { level, label: e.data?.name })
    }
    return m
  }, [entries])

  // The calendar runs from the first thing the user ever logged, which needs no content.
  const firstLogged = useMemo(() => {
    const dates = entries.filter(e => e.kind === 'daily' && e.date).map(e => e.date).sort()
    return dates[0] || null
  }, [entries])

  // A session put on today or an earlier day is done; on a later day it is
  // planned, and done from its day on (`isDone`). What an existing entry says is
  // kept, a "Mark undone" included. A rest day is done whenever it is chosen.
  const sessionData = (opt, prev) => {
    const out = prev?.data?.out || {}
    return {
      ...(prev?.data || {}),
      optId: opt.id,
      name: titleFor(opt, out, prev?.data?.plan),
      minutes: minutesFor(opt, out),
      level: levelFor(opt, out),
      done: opt.role === 'rest' ? true : (prev ? prev.data?.done ?? true : doneWhenPlaced(iso)),
      out,
    }
  }

  const pickMain = (opt) =>
    upsertEntry({ id: `daily-${iso}`, kind: 'daily', date: iso,
      data: { ...sessionData(opt, mainEntry), slot: 'main' } })

  /*
   * Extras get their own entry, so they chart, log and edit like any session.
   *
   * `fresh` is "log ANOTHER one of these" — a day the user ran and lifted is two *Log a
   * workout* entries and not one, each with its own effort, length and detail. It
   * is only ever offered for a session the plan marks `repeatable`, because
   * tapping "add" twice on the hip block is a double tap and not a second
   * session, and that idempotence is what `extraEntryId` protects. Returns the id
   * it wrote, which is what the caller needs to open it.
   */
  const addExtra = (opt, { fresh = false, data = null } = {}) => {
    const id = extraEntryId(iso, opt.id, dayEntries, { fresh })
    const prev = fresh ? null : dayEntries.find(e => e.id === id)
    upsertEntry({ id, kind: 'daily', date: iso,
      data: { ...sessionData(opt, prev), ...(data || {}), slot: 'extra' } })
    return id
  }

  /*
   * Saving, removing, "just miles", done, the runner's write and the plan's:
   * the same operations the Log's sheet uses (lib/sessionops.js, #76), so a
   * workout is written one way whichever screen it was opened from.
   */
  const ops = sessionOps({ plan, entries, upsertEntry, deleteEntry, toast: pushToast, undoIcon: Undo2 })
  const { removeSession, setDone, setTraining, saveOutputs, saveRun, savePlan } = ops

  // The entry a quick-log row on the empty day just placed, opened like the +'s.
  const [placed, setPlaced] = useState(null)
  /* A shared workout opened from someone's week (#94, D N4): the owner's own
     sheet, on its day and on their side, the same sheet as a tap on its row. */
  const [sheetFor, setSheetFor] = useState(null)
  const openShared = (own, personId) => {
    rememberSide(own.id, personId)
    if (own.date) setIso(own.date)
    setSheetFor(own.id)
  }

  return (
    <>
      {/* Until the shell mounts one for every tab (see toast.jsx). */}
      <ToastHost />
      <DaySwitcher value={iso} today={today} onChange={setIso} title max={isoShift(today, 14)} />

      <div className="pagegrid">
        <div className="col-main">
          <DaySessions plan={plan} entries={entries}
            mainEntry={mainEntry} extraEntries={extraEntries}
            onPickMain={pickMain} onAddExtra={addExtra} onRemove={removeSession}
            onSaveOutputs={saveOutputs} onSaveRun={saveRun} onSavePlan={savePlan}
            onSetDone={setDone} onSetTraining={setTraining}
            onSaveEntry={upsertEntry}
            viewIso={iso} isFuture={isFuture}
            openEntryId={openEntryId || placed}
            onOpened={() => { setPlaced(null); onOpened() }}
            openSheetId={sheetFor} onSheetOpened={() => setSheetFor(null)}
            // The same rows as the + menu (quicklog.jsx), placing on the day
            // being looked at and opening what they placed.
            quick={<QuickLog plan={plan} entries={entries} upsertEntry={upsertEntry} date={iso} onPlaced={setPlaced} />}
            onLog={onLog ? () => onLog(iso) : null} onRest={onRest}
            onPlan={onPlan} onUnplace={deleteEntry ? (e) => deleteEntry(e.id) : null} />
        </div>

        {/* Below the day, and compact: how the user arrived, what the services
            recorded that the log lacks, and someone else's day. Each renders
            nothing when it has nothing. */}
        <aside className="col-side">
          {!isFuture && <WhoopReadiness date={iso} />}
          {!isFuture && <WhoopSleep date={iso} />}

          {!isFuture && (
            <UnloggedWorkouts plan={plan} entries={entries} iso={iso}
              onLog={logMeasured} onMerge={saveOutputs}
              onClimb={onLog ? (item) => onLog(iso, { climb: item }) : null}
              skipped={skippedWorkouts} onDismiss={dismissWorkout} onRestore={restoreWorkout}
              split={splitWorkouts} onSplit={splitWorkout} />
          )}

          {/* The owner's window onto someone else's days, to coach without acting
              as them. Nothing for anyone else, while acting, or with one person. */}
          <PeopleDays people={planPeople(currentMe())} date={iso} plan={plan}
            entries={entries} onOpenShared={openShared} />

          {/* Nothing logged yet, nothing to chart: a fresh install's calendar
              was one empty square under "0 days on" (#55). */}
          {firstLogged && (
            <div className="card">
              <LoadCalendar days={calendar} start={firstLogged} end={iso} />
            </div>
          )}
        </aside>
      </div>
    </>
  )
}
