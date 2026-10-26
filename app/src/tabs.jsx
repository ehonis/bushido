/*
 * Tab renderers. Everything here is driven by content/plan.json — no training
 * content is hardcoded, so the program can be revised by editing that file with
 * no rebuild.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { LoadCalendar } from './lib/viz.jsx'
import { Icon } from './lib/icons.jsx'
import { SessionView, EvidenceNote } from './session.jsx'
import { Modal, FullScreen } from './modal.jsx'
import { SessionLog, PriorNote, DetailsSheet } from './sessionlog.jsx'
import { totalSets, totalReps } from './setlog.jsx'
import { restStats } from './lib/stats.js'
import { liftsLine, liftFieldIn } from './lib/lifts.js'
import { localIso, fromIso } from './lib/dates.js'
import { isDone, extraEntryId, doneWhenPlaced, markDone } from './lib/store.js'
import { testEntryFor, testEntryId, testFor } from './lib/tests.js'
import { WorkoutMode } from './workout.jsx'
import { openTimer, timerRequestFor } from './timer.jsx'
import { WorkoutRunner } from './runner.jsx'
import { PrescriptionEditor, PlanTalk, PlanWhy } from './planner.jsx'
import { usePlan } from './lib/planctx.jsx'
import { liftFieldOf } from './planner.jsx'
import { optFor } from './lib/menu.js'
import { prescriptionLine, prescriptionSteps, runProgress, isLiftOnly } from './lib/prescription.js'
import { hasWorkout } from './lib/workout.js'
import { minutesFor, loggedMinutes, resolveMinutes } from './lib/minutes.js'
import { levelFor } from './lib/level.js'
import { nameFor, titleFor, withCasualName } from './lib/naming.js'
import { disciplineFor, loggedActivity } from './lib/activities.js'
import { UnloggedWorkouts } from './unlogged.jsx'
import { currentMe } from './lib/whoami.js'
import { applyOut, applyRun, applyPlan, canStart, workoutSides, planPeople, plannedLine, toneFor } from './lib/trainer.js'
import { sharePeople, sharedPeopleOn, withLine, addPerson, removePerson, withSharedPerson, copyExercises, hasExercises, isSynced, withSync } from './lib/shared.js'
import * as peopleApi from './lib/peopleapi.js'
import { WithControl, PersonSwitch, SyncToggle, SharedNote, TheirSide, usePersonCopy, useSide, rememberSide } from './sharedwith.jsx'
import { SidesWorkout, PeopleDays, usePersonLog } from './trainer.jsx'

import { WhoopReadiness, WhoopSleep } from './whoop.jsx'
import { ToastHost } from './toast.jsx'
import { QuickLog } from './quicklog.jsx'
import { pushToast, dismissToast } from './lib/toast.js'
import { Undo2 } from 'lucide-react'

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
  onPlan = null, onLog = null, onRest = null, onViewDay = null,
}) {
  const today = todayIso()
  const [iso, setIso] = useState(today)
  // The + button logs onto the day being looked at, so it has to know which.
  useEffect(() => { onViewDay?.(iso) }, [iso])
  const isFuture = iso > today
  const menu = plan?.dailyMenu || []

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

  // The entry and everything it wrote — including the test result, or the chart
  // would keep a point for a session that is no longer in the log.
  const dropEntry = (entry) => {
    deleteEntry?.(entry.id)
    const opt = optFor(menu, entry.data?.optId)
    const test = testFor(plan, opt)
    if (test && entry.date) deleteEntry?.(testEntryId(entry.date, test.id))
  }

  /*
   * Taking a session off the day is simply removing it, with an Undo.
   *
   * The confirm screen asks first, and the toast is the way back from a wrong
   * answer: Undo writes the entry (and its test result) back as they were. A
   * tombstone is just a later write, so a later write of the live entry wins.
   */
  const removeSession = (entry) => {
    const opt = optFor(menu, entry.data?.optId)
    const test = testFor(plan, opt)
    const result = test && entry.date
      ? entries.find(e => e.id === testEntryId(entry.date, test.id) && !e.deleted) : null
    dropEntry(entry)
    const live = ({ deleted, ...rest }) => rest
    const name = opt ? titleFor(opt, entry.data?.out, entry.data?.plan) : entry.data?.name
    pushToast(name ? `Removed ${name}` : 'Removed', 'info', {
      duration: 6000,
      action: { label: 'Undo', icon: Undo2, onClick: () => {
        upsertEntry(live(entry))
        if (result) upsertEntry(live(result))
      } },
    })
  }

  // The entry a quick-log row on the empty day just placed, opened like the +'s.
  const [placed, setPlaced] = useState(null)

  const setDone = (entry, done) => upsertEntry(markDone(entry, done))

  /*
   * "Just miles", from the day's own sheet.
   *
   * It existed only in the Log feed until 2026-09-21, which meant the same
   * session offered different things depending on which screen you opened it
   * from — and once the details panel became one component shared by both, that
   * gap was a prop passed by one caller and not the other. Same write as the
   * feed's: `training: false` plus the name it gives itself, which is only ever
   * a BLANK name filled and only ever its own taken back. See lib/naming.js.
   */
  const setTraining = (entry, opt) => (v) => {
    const casual = v === false
    const out = withCasualName(entry.data?.out || {}, { plan, opt, on: casual })
    upsertEntry({ ...entry, data: {
      ...entry.data, out,
      name: titleFor(opt, out, entry.data?.plan),
      training: casual ? false : undefined,
    } })
  }

  // Outputs attach to their own entry. Sessions that declare `levelFrom` rewrite
  // the day's load level from what you logged — a social evening and an
  // accidental limit session are the same card and very different days.
  const saveOutputs = (entry, out) => {
    const opt = optFor(menu, entry.data?.optId)
    // `applyOut` (lib/trainer.js), shared with someone else's side of a workout:
    // the level the out implies, the name (a PLANNED session is named by its plan,
    // so "Legs" does not become "Lift" the first time the effort slider moves),
    // and `resolveMinutes`, which keeps a correction made before
    // `out.minutesSpent` existed. See lib/minutes.js.
    upsertEntry(applyOut(entry, opt, out))
    // A session that IS a test writes its result too, so the Testing tab's
    // series comes from the session you actually did rather than from typing
    // the same numbers in twice. See lib/tests.js.
    const result = testEntryFor({ plan, session: opt, date: entry.date, out })
    if (result) upsertEntry(result)
  }

  /*
   * Where the user is in a workout the user is running — and, in the SAME write, what that
   * changed about the log.
   *
   * One writer, and it has to be one. The first version had two — `saveRun` for
   * the position and `saveOutputs` for the sets — and marking a set called both.
   * They each spread the same `entry` prop, which is the entry as it was BEFORE
   * either of them ran, so the second write landed on top of the first and the
   * run vanished: every set the user marked re-rendered as set one of sixteen with the
   * clock at zero. Two writers over one object, from one stale closure, is the
   * bug; a single call that folds everything in is the fix.
   *
   * `out` is null on a rest-clock nudge, which changes the run and nothing else —
   * recomputing `out.lifts`, the load level and the minutes sixty times a session
   * would be work for no change to any of them.
   */
  const saveRun = (entry, run, opts = {}) => {
    // The runner adding a set to the plan goes through HERE and not `savePlan`,
    // for the reason in the paragraph above: one tap, one writer. `applyRun`
    // (lib/trainer.js) is the same write someone else's side of the runner makes.
    upsertEntry(applyRun(entry, optFor(menu, entry.data?.optId), run, opts))
  }

  /** Editing the prescription itself — from the sheet, after it has landed (`applyPlan`, lib/trainer.js). */
  const savePlan = (entry, pres) => upsertEntry(applyPlan(entry, optFor(menu, entry.data?.optId), pres))

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
            // The same rows as the + menu (quicklog.jsx), placing on the day
            // being looked at and opening what they placed.
            quick={<QuickLog plan={plan} entries={entries} upsertEntry={upsertEntry} date={iso} onPlaced={setPlaced} />}
            onLog={onLog ? () => onLog(iso) : null} onRest={onRest} />
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
          <PeopleDays people={planPeople(currentMe())} date={iso} plan={plan} />

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

/** `iso` moved by `n` days, in local days. */
export const isoShift = (iso, n) => {
  const d = fromIso(iso)
  d.setDate(d.getDate() + n)
  return localIso(d)
}

/** A day in words: "Today", "Yesterday", "Tomorrow", else "Sat, Oct 24". */
export function dayWords(iso, today = localIso()) {
  const offset = Math.round((fromIso(iso) - fromIso(today)) / 86400000)
  if (offset === 0) return 'Today'
  if (offset === -1) return 'Yesterday'
  if (offset === 1) return 'Tomorrow'
  return fromIso(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}


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
    ? fromIso(value).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
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

/*
 * Bodyweight is logged from the Log tab's quick log, for any date, as an
 * ordinary `bodyweight` entry. (The daily check-in that also wrote one was
 * removed on 2026-10-25; its old entries stay in the log, unread.)
 */

/* Lives in lib/level.js now — it is what decides whether a day spent a hard
   finger exposure, so it is tested as arithmetic rather than through a tab. */
export { levelFor }

/* Lives in lib/naming.js now — it is the single reader of their rename (`out.title`)
   and it names the entry, the headers and the Totem habit note, so it is tested
   as arithmetic rather than through a tab. `titleFor` is the same question with a
   prescription in play. */
export { nameFor }

/* Lives in lib/minutes.js now — it is the input to the training-load chart, so
   it is tested as arithmetic rather than as part of a component. */
export { minutesFor }

/** A meta line's pieces: "1 exercise · 3 sets" counts as two, blanks as none. */
const metaParts = (bits) => (bits || []).filter(Boolean).flatMap(b => String(b).split(' · '))

/**
 * "1 exercise · 3 sets · about 45 min · with Sam", which wraps only BETWEEN its
 * pieces (each is `white-space: nowrap`, the dot ending the line it is on), so a
 * long one reads as two tidy lines on a phone instead of breaking "45 / min".
 */
export function MetaLine({ bits }) {
  const parts = metaParts(bits)
  return parts.map((p, i) => (
    <span key={i}>
      <span className="meta-bit">{p}{i < parts.length - 1 ? ' ·' : ''}</span>
      {i < parts.length - 1 ? ' ' : ''}
    </span>
  ))
}

/** What a row's leading icon says: done, in progress, or not (yet). */
const ROW_STATE = {
  done: { icon: 'CircleCheck', label: 'Done' },
  running: { icon: 'Play', label: 'In progress' },
  open: { icon: 'Circle', label: 'Not done' },
}

/**
 * Everything on the day, and nothing that is not.
 *
 * One card of rows (docs/DESIGN.md, "List row"): the name, one line of what it
 * was (time · distance), and whether it is done, said once, by the leading
 * icon. Gone on 2026-10-25 (#41): the MAIN/ADDED pill (the day's slot is not a
 * thing anyone needs to read), the separate tick beside the chevron (three marks
 * for one fact), and the dashed "Log another workout" under the list, which
 * looked like an empty slot and said what the + beside the dock already does.
 */
function DayList({ rows, onOpen, isFuture, viewIso, onLog = null, onRest = null, quick = null }) {
  if (!rows.length) {
    return <EmptyDay isFuture={isFuture} viewIso={viewIso} onLog={onLog} onRest={onRest} quick={quick} />
  }
  return (
    <div className="card daylist">
      <div className="list">
        {rows.map(r => {
          const state = ROW_STATE[r.state] || ROW_STATE.open
          return (
            <button key={r.key} type="button" className={`list-row dl-row s-${r.state}`} onClick={() => onOpen(r.key)}>
              <span className="dl-state" role="img" aria-label={state.label}>
                <Icon name={state.icon} size={20} />
              </span>
              <span className="list-row-main">
                <span className="list-row-title">{r.name}</span>
                {metaParts(r.meta).length > 0 && <span className="list-row-meta"><MetaLine bits={r.meta} /></span>}
              </span>
              <span className="list-row-chev"><Icon name="ChevronRight" size={16} /></span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * An empty day: what goes here, and the ways to put it there (docs/DESIGN.md,
 * "Today, first run"). The quick-log rows first, Log a workout as the one
 * primary for anything else, and a rest day as a quiet button. No paragraph:
 * the + is on screen, and planning lives behind it.
 */
function EmptyDay({ isFuture, viewIso, onLog, onRest, quick }) {
  if (isFuture) {
    return <div className="empty dl-empty"><p className="dl-empty-title">Nothing planned yet</p></div>
  }
  const words = dayWords(viewIso)
  const when = words === 'Today' || words === 'Yesterday' ? words.toLowerCase() : `on ${words}`
  return (
    <div className="empty dl-empty">
      <p className="dl-empty-title">Nothing logged {when}</p>
      {quick}
      {(onLog || onRest) && (
        <div className="dl-empty-acts">
          {onLog && <button type="button" className="btn" onClick={onLog}>Log a workout</button>}
          {onRest && <button type="button" className="btn quiet" onClick={onRest}>Rest day</button>}
        </div>
      )}
    </div>
  )
}

/* --------------------------------------------------------- session sheets */

/*
 * "ADD-ONS FOR THIS SESSION" IS GONE, 2026-09-21. It was a pill row at the foot
 * of every main session offering the four support blocks to ride along with it.
 * It was never used and was just bloat. Adjuncts that are already ON an entry
 * still render as rows in the day list, because they are history; nothing offers
 * a new one.
 */

/**
 * Does this session have anything worth running a screen for?
 *
 * A card that declares a timer does (`hasWorkout` — the hangboard and board
 * work, the 4×4s). A PRESCRIPTION does, unless it is nothing but lifting.
 *
 * Workout mode makes no sense for a lifting workout: there are no times, and
 * rest between lifting sets is not prescribed. Once the rest came off a lift set there was nothing left for the runner to run: it counted
 * nothing down, advanced nothing on its own, and was a full-screen wrapper around
 * a set list — the same judgement that took workout mode off the lead laps and
 * the bodyweight circuits in the first place. A lift session is edited and ticked
 * off in the sheet.
 *
 * MIXED sessions keep it. A gym trip that is squats and then a twenty-minute row
 * has an interval in it, and the row is the part worth running.
 */
export function runnable(opt, pres) {
  if (pres) return !isLiftOnly(pres)
  return hasWorkout(opt)
}

/**
 * One session, opened from the day list. This is the ONLY place the full
 * protocol appears — the dashboard stays a list of names, because a dashboard
 * that shows you three complete protocols at once is a dashboard you scroll
 * past instead of reading.
 */
export function SessionSheet({
  opt, entry, tone, entries, isFuture,
  onLog, onSave, onSavePlan = null, onRemove, onSetDone, onClose, onStartWorkout,
  onTraining = null, onSaveEntry = null, me = currentMe(),
}) {
  // Locks the sheet to the X button once you've touched the form. See modal.jsx.
  const [dirty, setDirty] = useState(false)
  // The name is its own layer now — a pencil beside the X. See RenameSheet.
  const [renaming, setRenaming] = useState(false)
  const planned = Boolean(entry)
  const done = planned && isDone(entry)
  // The prescription, if this session has one. Its presence is what turns the
  // sheet from a protocol you read into a workout you edit — see runner.jsx.
  const pres = entry?.data?.plan || null
  const thePlan = usePlan()
  const liftField = liftFieldOf(thePlan)

  const save = (out) => { setDirty(true); onSave(entry, out) }

  /*
   * SHARED WORKOUTS (sharedwith.jsx, lib/shared.js). `people` is who the owner
   * could add, empty for anyone else, while acting as someone and on a
   * one-person install. `on` is who is on this entry, re-derived every render;
   * `side` is the person whose copy the sheet is filling in, by id, or null for
   * the owner's own, remembered per entry on this device. On their side the
   * history is THEIR log (`theirLog`), never the owner's.
   */
  const people = planned && onSaveEntry ? sharePeople(me) : []
  const on = people.length ? sharedPeopleOn(entry, me.people).map(p => ({ ...p, tone: toneFor(people, p.id) })) : []
  const [side, setSide] = useSide(entry?.id, on)
  const sidePerson = (side && on.find(p => p.id === side)) || null
  const theirs = usePersonCopy(sidePerson?.id, sidePerson?.entryId, sidePerson?.name)
  const theirLog = usePersonLog(sidePerson?.id || null)
  const synced = Boolean(sidePerson && isSynced(entry, sidePerson.id))
  const [sharing, setSharing] = useState({ busy: null, error: null })
  // The entry as of the latest render: an add or a removal awaits the server, and
  // must name the person on what the entry is THEN, not on what it was when tapped.
  const latestEntry = useRef(entry)
  latestEntry.current = entry
  const share = async (verb, person, run) => {
    setSharing({ busy: `${verb} ${person.name}…`, error: null })
    try {
      await run()
      setSharing({ busy: null, error: null })
    } catch (err) {
      setSharing({ busy: null, error: `${person.name}: ${err.message}` })
    }
  }
  const addSomeone = (person) => share('Adding', person, async () => {
    const { copy } = await addPerson({ ownerEntry: latestEntry.current, person, session: opt,
      owner: { id: me.real.id, name: me.real.name }, api: peopleApi })
    onSaveEntry(withSharedPerson(latestEntry.current, person.id, copy.id))
  })
  const removeSomeone = (person) => share('Taking off', person, async () => {
    const next = await removePerson({ ownerEntry: latestEntry.current, person, session: opt, api: peopleApi,
      confirmFn: async (q) => typeof window !== 'undefined' && window.confirm(q) })
    if (!next) return
    if (side === person.id) setSide(null)
    onSaveEntry(withSharedPerson(latestEntry.current, person.id, null, { remove: true }))
  })
  /* Their copy, written like `saveOutputs` writes the owner's: the out, and the
     name, level and minutes it implies. Never a test result: that is a separate
     entry, and their log is theirs to keep. */
  const saveTheirs = (out) => { setDirty(true); theirs.update(cur => applyOut(cur, opt, out)) }
  const setTheirsDone = (v) => { setDirty(true); theirs.update(cur => markDone(cur, v)) }
  /* Their plan, edited from their side: the same write `savePlan` makes on the owner's. */
  const saveTheirPlan = (next) => { setDirty(true); theirs.update(cur => applyPlan(cur, opt, next)) }
  const theirPres = theirs.entry?.data?.plan || null
  /* Your exercises onto their side, when you ask (sync off only): added, never their numbers replaced. */
  const canCopy = Boolean(!synced && theirs.entry && copyExercises(theirs.entry, entry) !== theirs.entry)
  /* Sync lives on the owner's link; the server does the keeping-the-same (server/sharedsync.js). */
  const setSync = (person, v) => onSaveEntry(withSync(latestEntry.current, person.id, v))
  const copyMine = () => { setDirty(true); theirs.update(cur => copyExercises(cur, latestEntry.current)) }
  const theirDone = Boolean(theirs.entry && isDone(theirs.entry))

  /* A write to their log that did not land says so, with the way to send it again
     (the latest copy, as it stands: `update` re-sends it unchanged). It stays
     until dismissed, but only while it is true: the cleanup takes it down when the
     error clears (a later write landed, or another side opened) and when the
     sheet closes, so a stale Retry never outlives the failure it was about. */
  useEffect(() => {
    if (!theirs.error || !/^Not saved/.test(theirs.error)) return undefined
    const id = pushToast(theirs.error, 'error', { duration: 0,
      action: { label: 'Retry', onClick: () => theirs.update(cur => cur) } })
    return () => dismissToast(id)
  }, [theirs.error])

  /*
   * The line under the name: the day, then the time as it was typed or
   * measured, so the header can never say "45 min" over a typed 29. Never the
   * card's own estimate or its tier ("any sport · counts anyway"): neither is
   * something the user said. A planned session not yet timed says what it holds.
   */
  const mins = planned ? loggedMinutes(entry, opt) : null
  const timed = mins !== null ? `${mins} min` : null
  const subBits = [
    entry?.date ? dayWords(entry.date) : null,
    timed || (pres ? prescriptionLine(pres) : null),
  ]
  const sub = metaParts(subBits).length ? <MetaLine bits={subBits} /> : null

  /*
   * The footer (docs/DESIGN.md, "Session sheet"). Every field saves as it is
   * typed, so the one thing left to do is close it; that is the primary, unless
   * the session can be started, which is. Beside it, quiet, the rare undo: "Mark
   * undone" on a session done by default (today or earlier, AGENTS.md §4), "Mark
   * done" on one marked undone. A day still to come shows neither.
   */
  const close = <button type="button" className="btn" onClick={onClose}>Close</button>
  const start = (side = null) => (
    <button type="button" className="btn" onClick={() => { setDirty(true); onStartWorkout(opt, side) }}>
      <Icon name="Play" size={17} /> {pres ? 'Start the workout' : 'Start workout'}
    </button>
  )
  const doneToggle = (isNowDone, onToggle, whose = '') => (
    <button type="button" className="btn quiet" onClick={onToggle} aria-pressed={!isNowDone}>
      {isNowDone ? `Mark undone${whose}` : `Mark done${whose}`}
    </button>
  )
  let footer
  if (sidePerson) {
    const theirsLive = theirs.entry && !theirs.entry.deleted
    footer = (
      <div className="sheet-foot">
        {!isFuture && theirsLive && doneToggle(theirDone, () => setTheirsDone(!theirDone), ` for ${sidePerson.name}`)}
        {/* Their side starts the same shared workout, on their side of the switcher. */}
        {!isFuture && theirsLive && onStartWorkout && pres && theirPres && runnable(opt, theirPres) && canStart(theirs.entry)
          ? start(sidePerson.id) : close}
      </div>
    )
  } else if (!planned && onLog && !isFuture) {
    // A card opened with nothing on the day yet: putting it there IS the action.
    footer = (
      <div className="sheet-foot">
        <button type="button" className="btn" onClick={() => { setDirty(true); onLog(opt) }}>
          {opt.role === 'rest' ? 'Take a rest day' : 'Add to today'}
        </button>
      </div>
    )
  } else {
    /* A planned session always offers the runner, whether or not the CARD
       declares a timer — what it walks is the prescription on the entry.
       Not "while not done": today's session is done before it starts. */
    const startable = !isFuture && onLog && onStartWorkout && runnable(opt, pres) && canStart(entry)
    footer = (
      <div className="sheet-foot">
        {planned && !isFuture && onLog && doneToggle(done, () => { setDirty(true); onSetDone(entry, !done) })}
        {startable ? start() : close}
      </div>
    )
  }

  return (
    <Modal
      /*
       * What this session IS, not what the card is called. A planned session is
       * titled by its plan; a card that names itself from what you picked
       * (`nameFrom`) is titled "Mountain bike" rather than "Log a workout".
       */
      title={titleFor(opt, entry?.data?.out, pres)}
      sub={sub}
      // The activity's own icon (a run's footprints), as its row in the Log feed
      // shows it; the workout card's generic one only until an activity is picked.
      icon={loggedActivity(opt, entry?.data?.out)?.icon || opt.icon}
      tone={tone}
      dismissable={!dirty}
      onClose={onClose}
      /* The name, one layer up: a rename is a thing you do TO the session you are
         looking at, so it belongs where the session's title is. */
      onRename={planned && !isFuture && !sidePerson ? () => setRenaming(true) : null}
      onDelete={onRemove && entry && !sidePerson ? () => onRemove(entry) : null}
      deleteLabel="Remove from today"
      footer={footer}
    >
      {/* Whose copy this sheet is filling in, pinned while the sheet scrolls. Only on a shared workout. */}
      <PersonSwitch on={on} side={sidePerson?.id || null} onSide={setSide} />
      {on.map(p => <SyncToggle key={p.id} person={p} on={isSynced(entry, p.id)} onChange={(v) => setSync(p, v)} />)}

      {/* Who else is on it, and the way to add someone. Owner-only; see sharedwith.jsx. */}
      {!sidePerson && (
        <WithControl on={on} people={people} busy={sharing.busy} error={sharing.error}
          onAdd={addSomeone} onRemove={removeSomeone} />
      )}
      {/* Everyone else sees, quietly, who it was done with (their own copy names the
          owner; an owner acting as someone sees what that person would). */}
      {!people.length && planned && <SharedNote entry={entry} people={me.people} />}
      {/* "planned by Alex": quiet, like who it was done with. The entry is theirs now. */}
      {planned && !sidePerson && plannedLine(entry, me) && (
        <p className="sharednote"><Icon name="ClipboardCheck" size={12} /> {plannedLine(entry, me)}</p>
      )}

      {sidePerson ? (
        <TheirSide session={opt} copy={theirs.entry} loading={theirs.loading} error={theirs.error}
          person={sidePerson} ownerOut={entry?.data?.out} onSave={saveTheirs} entries={theirLog.entries}
          onCopyMine={canCopy ? copyMine : null} ownerHasExercises={hasExercises(entry)} synced={synced}
          /* A planned session is its plan, on their side as on the owner's: the same
             exercises, with their own numbers, and "last time" from THEIR log. */
          plan={theirPres && (
            <PrescriptionEditor pres={theirPres} liftField={liftField} entries={theirLog.entries} entryId={theirs.entry?.id}
              categories={thePlan?.quotaCategories || []} onChange={saveTheirPlan} compact />
          )} />
      ) : (<>
      {/*
        * The "MAIN SESSION" / "ADDED SESSION" strap above the content is gone
        * (2026-09-21) as bloat. It restated the tag the day list already showed on the row the user
        * tapped, in the scarcest space on the sheet.
        */}

      {/*
        * A card whose form IS the card puts it first and open.
        *
        * The workout card's "protocol" is five steps of boilerplate about how to
        * use the app; the ride the user is logging is the point. Leading with it also
        * puts the activity row — the one control that changes what the rest of
        * the form asks — at the top where the user expects it, since the user just picked it
        * on the way in.
        */}
      {opt.logFirst && !isFuture && planned && (
        <SessionLog session={opt} entry={entry} entries={entries} onSave={save} />
      )}

      {/*
        * A PLANNED session shows its own prescription instead of the card's
        * protocol, because the card has none worth reading — see the `planned`
        * entry in plan.json. `why` first: it is one paragraph and it is the part
        * that says what the planner was thinking, which is the thing worth
        * knowing before you change a number in it.
        */}
      {pres ? (
        <>
          {/* Still talkable-to after it lands. The thread lives on the entry, so a
              session written at eight can be argued with at six. */}
          <PlanTalk pres={pres} compact entries={entries} entryId={entry?.id}
            onChange={(next) => { setDirty(true); onSavePlan?.(entry, next) }} />
          <PrescriptionEditor pres={pres} liftField={liftField}
            entries={entries} entryId={entry?.id} categories={thePlan?.quotaCategories || []}
            onChange={(next) => { setDirty(true); onSavePlan?.(entry, next) }} compact />
          {pres.notes?.length > 0 && (
            <ul className="plan-notes">
              {pres.notes.map((n, i) => <li key={i}><Icon name="Info" size={13} /> {n}</li>)}
            </ul>
          )}
        </>
      ) : (
        <>
          <p className="rec-dose">{opt.dose}</p>
          <PriorNote entries={entries} session={opt} excludeId={entry?.id} />
          <SessionView key={opt.id} session={opt} entries={entries} />
        </>
      )}

      {/* Declared by the card. See `logFirst` in plan.json and SessionLog. */}
      {!isFuture && planned && !opt.logFirst && (
        <SessionLog session={opt} entry={entry} entries={entries} onSave={save} />
      )}

      {/*
        * "Log another workout today" came off the sheet on 2026-09-21: the +
        * button is one tap from here, and a third way in at the bottom of a form
        * is the kind of thing that made this screen read as a maze.
        */}

      {/* Any workout can use a clock; a card that declares one offers it as a
          preset. A tool, so a row at the foot of the sheet rather than a second
          big button beside the one that matters. */}
      {!isFuture && onLog && opt.role !== 'rest' && (
        <div className="list sheet-tools">
          <button type="button" className="list-row" onClick={() => openTimer(timerRequestFor(opt, entry))}>
            <Icon name="Timer" size={20} />
            <span className="list-row-main"><span className="list-row-title">Interval timer</span></span>
            <span className="list-row-chev"><Icon name="ChevronRight" size={16} /></span>
          </button>
        </div>
      )}

      {renaming && (
        <DetailsSheet session={opt} entry={entry} entries={entries}
          onSave={save}
          training={entry?.data?.training}
          /* Only where the question makes sense — a commute is a ride, not a set
             of max hangs. Driven by the discipline rather than by a list. */
          onTraining={onTraining}
          onClose={() => setRenaming(false)} />
      )}
      </>)}
    </Modal>
  )
}

/*
 * FULLSCREEN SESSION MODE IS GONE, 2026-09-21.
 *
 * It was a whole page for one session — the same entry as the sheet, with tabs
 * for Plan / Log / Why — reached by an expand button in the sheet's header.
 * It was not worth keeping: it was the third way to look at the same session and
 * the one nothing pointed at, so every fix to the sheet had to be made twice and
 * the second copy is the one that drifted.
 *
 * `FullScreen` itself stays — the planner, the week planner, the pickers, workout
 * mode and the runner are all built on it. What went is the session page.
 */

/**
 * The day's sessions, and the layers that open on top of them.
 *
 * What is left of `DailyPicker` after the recommender came off this screen. It no
 * longer ranks, offers, dismisses or explains — it renders the entries on the day
 * and routes taps to one of four things:
 *
 *   the SHEET          reading a session and logging it, as before
 *   the FULLSCREEN     the same session with a whole page
 *   WORKOUT MODE       the rep clock, for the climbing cards that declare a timer
 *   the RUNNER         the mobile set-by-set screen, for anything with a plan
 *
 * The last is the new one and the split is by the ENTRY, not the card: a session
 * carrying `data.plan` is a prescription somebody wrote, so it gets the runner;
 * everything else falls back to what it has always used. See runner.jsx.
 */
/** The disciplines where "was that actually a workout?" is a real question. */
const CASUAL_DISCIPLINES = ['bike', 'run', 'swim', 'other']

function DaySessions({
  plan, entries, mainEntry, extraEntries,
  onPickMain, onAddExtra, onRemove, onSaveOutputs, onSaveRun, onSavePlan,
  onSetDone, onSetTraining, viewIso, isFuture, onSaveEntry = null,
  openEntryId = null, onOpened = () => {},
  onLog = null, onRest = null, quick = null,
}) {
  const [sheet, setSheet] = useState(null)   // row key: 'main' | an extra entry id
  const [workout, setWorkout] = useState(null) // same key, but training in front of it
  const [workoutSide, setWorkoutSide] = useState(null) // whose side a shared workout opens on

  const menu = plan?.dailyMenu || []
  const adjuncts = menu.filter(m => m.role === 'adjunct')

  /*
   * Something just landed from the + button, so open it.
   *
   * Creating an entry and leaving them to find it is the same dead end the "add
   * another" button had before it opened what it created: a blank row on the day
   * that the user then has to spot and press. The id round-trips through App because
   * the button floats over every tab rather than living on this screen.
   */
  useEffect(() => {
    if (!openEntryId) return
    const hit = [mainEntry, ...extraEntries].find(e => e?.id === openEntryId)
    if (!hit) return
    const key = hit.id === mainEntry?.id ? 'main' : hit.id
    // A planned session opens straight into the runner. The user pressed "plan a
    // workout" and then "put it on today"; a third tap to start it is a tap that
    // asks them to confirm something the user has already said twice.
    if (hit.data?.plan && runnable(null, hit.data.plan)) setWorkout(key)
    else setSheet(key)
    onOpened()
  }, [openEntryId, mainEntry?.id, extraEntries.length])

  const logged = optFor(menu, mainEntry?.data?.optId)
  const resting = logged?.role === 'rest'

  /*
   * A workout the user is in the middle of.
   *
   * The run state lives on the entry precisely so that closing Bushido mid-session
   * loses nothing — but that guarantee is only worth anything if coming back
   * puts them back IN it. Without this, reopening the app landed on Today and
   * tapping the card opened the reading sheet, with the rest clock still
   * correctly counting down on a screen the user could not see.
   *
   * Started and not finished. A session the user finished opens its sheet like any
   * other, because at that point it is a log entry rather than a workout.
   */
  const isRunning = (e) =>
    Boolean(e?.data?.plan && runnable(null, e.data.plan)
      && e?.data?.run?.startedAt && !e.data.run.endedAt)

  /** "6 of 16 sets" — what a row in progress says instead of its stats. */
  const runLine = (e) => {
    if (!e?.data?.plan) return null
    const p = runProgress(e.data.run, prescriptionSteps(e.data.plan))
    if (!p.total) return null
    return `${p.done} of ${p.total} sets`
  }

  const extras = extraEntries
    /*
     * `optFor`, NEVER a raw `menu.find` — this is the rule in AGENTS.md §5 and
     * this screen was breaking it. Every session logged before the 2026-09-14
     * rename carries `optId: 'other-training'`, which resolves to nothing, and a
     * row with no card is FILTERED OUT below rather than rendered badly: fourteen
     * logged workouts were simply missing from their own day, silently, and the
     * day looked empty. Found on 2026-09-21 trying to screenshot one of them.
     */
    .map(e => ({ entry: e, opt: optFor(menu, e.data?.optId) }))
    .filter(x => x.opt)

  const mainOpt = logged || null

  /*
   * A row's one line: what it WAS (time · distance, or what was lifted), never
   * the card's estimate dressed as a fact. A session in progress says where it
   * is ("6 of 16 sets"), a rest day says why, and one that is not done says so
   * first: "Planned" on a day still to come, "Not done" once marked undone.
   */
  const metaFor = (entry, opt) => {
    const out = entry.data?.out || {}
    if (isRunning(entry)) return [runLine(entry), withLine(entry, currentMe().people)]
    const bits = []
    if (!isDone(entry)) bits.push(viewIso > localIso() ? 'Planned' : 'Not done')
    if (opt.role === 'rest') bits.push(...restStats(entry, opt))
    else {
      const mins = loggedMinutes(entry, opt)
      const sets = totalSets(out)
      const work = Number(out.distance) > 0 ? `${out.distance} mi`
        : liftsLine(out, liftFieldIn(opt)) || (sets ? `${sets} set${sets === 1 ? '' : 's'}` : null)
      // A planned session nothing has been logged on yet says what it holds
      // ("3 exercises · 9 sets · about 45 min"), which is also what says it has sets to run.
      if (mins === null && !work && entry.data?.plan) bits.push(prescriptionLine(entry.data.plan))
      else bits.push(mins !== null ? `${mins} min` : null, work)
    }
    // Who else was on it ("with Sam", lib/shared.js), or who planned it for this
    // person ("planned by Alex", lib/trainer.js).
    bits.push(withLine(entry, currentMe().people), plannedLine(entry, currentMe()))
    return bits
  }

  const rowFor = (entry, opt) => ({
    key: entry.id === mainEntry?.id ? 'main' : entry.id,
    name: titleFor(opt, entry.data?.out, entry.data?.plan),
    state: isRunning(entry) ? 'running' : isDone(entry) ? 'done' : 'open',
    meta: metaFor(entry, opt),
  })

  const rows = [
    ...(mainEntry && mainOpt ? [rowFor(mainEntry, mainOpt)] : []),
    ...extras.map(({ entry, opt }) => rowFor(entry, opt)),
    // Add-ons ticked on an old main session: history, so still listed.
    ...(mainEntry?.data?.adjuncts || [])
      .map(id => adjuncts.find(a => a.id === id))
      .filter(Boolean)
      .map(a => ({ key: `adj-${a.id}`, name: a.name, state: 'done', meta: ['Add-on'] })),
  ]

  /** Resolve a row key back to the session and entry it stands for. */
  const resolve = (key) => {
    if (!key) return null
    if (key === 'main') {
      return mainEntry && mainOpt
        ? { opt: mainOpt, entry: mainEntry, tone: resting ? 'rest' : null, kind: 'main' }
        : null
    }
    if (key.startsWith('adj-')) {
      const opt = adjuncts.find(a => `adj-${a.id}` === key)
      return opt && { opt, entry: null, tone: null, kind: 'adjunct' }
    }
    const hit = extras.find(x => x.entry.id === key)
    return hit && { opt: hit.opt, entry: hit.entry, tone: hit.opt.role === 'rest' ? 'rest' : null, kind: 'extra' }
  }

  /**
   * Tapping a row. A workout the user is in the middle of goes back to the runner; a
   * session goes to its sheet. Deciding here rather than in `DayList` keeps the
   * list a list — it renders rows and reports taps, and has no opinion about
   * what a row is.
   */
  const openRow = (key) => {
    const row = resolve(key)
    if (row?.entry && isRunning(row.entry)) setWorkout(key)
    else setSheet(key)
  }

  const open = resolve(sheet)
  const training = workout ? resolve(workout) : null

  /**
   * Starting a workout is doing the session, so put it on the day if it isn't
   * already — you don't run a timer through three sets of max hangs for nothing.
   */
  const startWorkout = (key) => (opt, side = null) => {
    const row = resolve(key)
    if (!row) return
    if (!row.entry) (row.kind === 'extra' ? onAddExtra : onPickMain)(opt)
    setSheet(null)
    setWorkoutSide(side)
    setWorkout(key)
  }

  /*
   * The runner owns the screen completely while the user is training. Checked BEFORE
   * workout mode: a card with both a plan and a declared timer is a planned
   * session that happens to be based on one, and the plan is the thing the user is
   * following.
   */
  /*
   * A SHARED workout runs from every side it has (trainer.jsx): the owner flips
   * between the owner's own entry and each other person's copy, each with its own sets,
   * weights, rest clock, done state and writer. Anyone else, and any workout
   * nobody shares, gets exactly the screen it always did.
   */
  const sides = training?.entry ? workoutSides(training.entry, currentMe()) : []
  if (sides.length > 1 && training.entry.data?.plan && runnable(null, training.entry.data.plan)) {
    return (
      <SidesWorkout kind="runner" session={training.opt} sides={sides} ownerEntry={training.entry} onSwitch={(id) => rememberSide(training.entry.id, id)} entries={entries} initialSide={workoutSide}
        onOwnerRun={(run, opts) => onSaveRun(training.entry, run, opts)}
        onExit={() => setWorkout(null)} />
    )
  }
  if (sides.length > 1 && !training.entry.data?.plan && hasWorkout(training.opt)) {
    return (
      <SidesWorkout kind="mode" session={training.opt} sides={sides} ownerEntry={training.entry} onSwitch={(id) => rememberSide(training.entry.id, id)} initialSide={workoutSide}
        onOwnerSave={(out) => onSaveOutputs(training.entry, out)}
        onOwnerDone={(v) => onSetDone(training.entry, v)}
        onExit={() => setWorkout(null)} />
    )
  }

  if (training?.entry?.data?.plan && runnable(null, training.entry.data.plan)) {
    return (
      <WorkoutRunner
        session={training.opt}
        entry={training.entry}
        entries={entries}
        onRun={(run, opts) => onSaveRun(training.entry, run, opts)}
        onExit={() => setWorkout(null)}
      />
    )
  }

  /*
   * The climbing rep clock. Never for a prescription — that is the runner's job,
   * and a plan with no clock in it (a lift session, since 2026-09-21) gets
   * neither: `runnable` above is the whole of that decision, and the sheet does
   * not offer a start button when it says no, so this can only be reached by a
   * card that genuinely declares a timer.
   */
  if (training?.entry && !training.entry.data?.plan && hasWorkout(training.opt)) {
    return (
      <WorkoutMode
        session={training.opt}
        entry={training.entry}
        onSave={(out) => onSaveOutputs(training.entry, out)}
        onSetDone={(v) => onSetDone(training.entry, v)}
        onExit={() => setWorkout(null)}
      />
    )
  }

  return (
    <>
      <DayList rows={rows} onOpen={openRow} isFuture={isFuture} viewIso={viewIso}
        onLog={onLog} quick={quick}
        // The day the user is LOOKING at, so a forgotten rest day can be logged from
        // the day it belongs to. Not a future one — resting is not a plan.
        onRest={onRest && viewIso <= localIso() ? () => onRest(viewIso) : null} />

      {open && (
        <SessionSheet
          opt={open.opt} entry={open.entry} tone={open.tone} entries={entries} isFuture={isFuture}
          onLog={open.kind === 'adjunct' ? null : open.kind === 'extra' ? onAddExtra : onPickMain}
          onSave={onSaveOutputs}
          onSavePlan={onSavePlan}
          // Closed on removal, so an Undo puts the workout back on the day without
          // reopening the sheet it was removed from.
          onRemove={open.entry ? (e) => { setSheet(null); onRemove(e) } : null}
          onSetDone={onSetDone}
          onSaveEntry={onSaveEntry}
          onStartWorkout={isFuture ? null : startWorkout(sheet)}
          onTraining={open.entry && CASUAL_DISCIPLINES.includes(
            disciplineFor(open.opt, open.entry.data?.out))
            ? onSetTraining(open.entry, open.opt) : null}
          onClose={() => setSheet(null)}
        />
      )}
    </>
  )
}
