/*
 * Tab renderers. Everything here is driven by content/plan.json — no training
 * content is hardcoded, so the program can be revised by editing that file with
 * no rebuild.
 */

import { useEffect, useMemo, useState } from 'react'
import { LineChart, LoadCalendar, SERIES } from './lib/viz.jsx'
import { Icon, VERDICT_ICONS } from './lib/icons.jsx'
import { SessionView, EvidenceNote } from './session.jsx'
import { resolveCeiling, cfPctOfMax, cfBand, CF_CORRECTION_KG, CF_PCT_MVC_MEAN, CF_PCT_MVC_SD, CF_NOISE_PCT } from './lib/force.js'
import { Modal, FullScreen } from './modal.jsx'
import { Blurb } from './blurb.jsx'
import { SessionLog, PriorNote, DetailsSheet } from './sessionlog.jsx'
import { totalSets, totalReps } from './setlog.jsx'
import { sessionStats } from './lib/stats.js'
import { liftsLine } from './lib/lifts.js'
import { localIso, fromIso } from './lib/dates.js'
import { progress as quotaProgress, mondayOf, weekDays, shiftWeek, quotaCounts, quotaEntry, suggest, buildQuotaEntry } from './lib/quota.js'
import { isDone, isRepeatable, repeatLabel, extraEntryId } from './lib/store.js'
import { testEntryFor, testEntryId, testFor } from './lib/tests.js'
import { WorkoutMode } from './workout.jsx'
import { WorkoutRunner } from './runner.jsx'
import { QuotaBars } from './quotabars.jsx'
import { PrescriptionEditor, PlanTalk, PlanWhy } from './planner.jsx'
import { Markdown } from './lib/markdown.jsx'
import { usePlan } from './lib/planctx.jsx'
import { liftFieldOf } from './planner.jsx'
import { optFor } from './lib/menu.js'
import { prescriptionLine, prescriptionSteps, runProgress, isLiftOnly } from './lib/prescription.js'
import { hasWorkout } from './lib/workout.js'
import { minutesFor, resolveMinutes } from './lib/minutes.js'
import { levelFor } from './lib/level.js'
import { nameFor, titleFor, withCasualName } from './lib/naming.js'
import { disciplineFor } from './lib/activities.js'
import { Journal } from './journal.jsx'
import { UnloggedWorkouts } from './unlogged.jsx'
import { achievements, unclaimed } from './lib/achievements.js'
import { profileFacts } from './lib/profile.js'

import { WhoopReadiness, WhoopSleep } from './whoop.jsx'

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
 * So Today is now two things and nothing else:
 *
 *   1. WHERE THE WEEK STANDS — the quota bars. A reading, not an offer. See
 *      quotabars.jsx.
 *   2. WHAT IS ACTUALLY ON THE DAY — sessions the user planned or logged, and nothing
 *      the user did not. An empty day renders as an empty day rather than as five
 *      suggestions.
 *
 * Adding to the day moved OUT of this screen entirely and onto the + button
 * beside the coach bubble, which offers the two things the user actually does: plan one
 * (the planner writes the sets) or log one (something already done). See
 * planner.jsx and App.jsx.
 *
 * `lib/recommend.js` is still on disk and still tested. The coach can reason with
 * it, and the finger-spacing rules it enforces are the app's only unbypassable
 * ones. Nothing on this screen reads it.
 */

export function TodayTab({
  plan, entries, upsertEntry, deleteEntry,
  settings = {}, saveSettings = () => {},
  openEntryId = null, onOpened = () => {},
  onPlan = null, onLog = null, onPickSession = null, onRest = null, onSetWeek = null,
}) {
  const today = todayIso()
  const [iso, setIso] = useState(today)
  /*
   * An entry the WEEK asked to open, as opposed to one the + button just created.
   *
   * Kept apart from `openEntryId` because they want different screens: a session
   * the user has this second planned opens straight into the runner, and one the user tapped
   * on a quota bar to look at opens its sheet. Same plumbing, one extra word.
   */
  const [openFromWeek, setOpenFromWeek] = useState(null)
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
   * `fresh` because two rides in a day are two workouts — and under quotas that
   * is the difference between filling one and filling two.
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

  // Putting a session on the day does NOT complete it — that is a separate tap.
  // A rest day is the exception: choosing it is the whole action.
  const sessionData = (opt, prev) => {
    const out = prev?.data?.out || {}
    return {
      ...(prev?.data || {}),
      optId: opt.id,
      name: titleFor(opt, out, prev?.data?.plan),
      minutes: minutesFor(opt, out),
      level: levelFor(opt, out),
      done: opt.role === 'rest' ? true : (prev?.data?.done ?? false),
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
   * Taking a session off the day is now simply removing it.
   *
   * It used to also record a dismissal, so the recommender would stop offering
   * back what the user had just taken off. With nothing offering anything, that entry
   * kind has no reader and writing one would be leaving litter in a synced log.
   */
  const removeSession = (entry) => dropEntry(entry)

  const setDone = (entry, done) =>
    upsertEntry({ ...entry, data: { ...entry.data, done } })

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
    upsertEntry({ ...entry, data: {
      ...entry.data, out,
      level: levelFor(opt, out),
      // A PLANNED session is named by its plan. Everything else names itself off
      // the card or off what the user picked, exactly as before — but "Legs" must not
      // become "Lift" the first time the user touches the effort slider.
      name: titleFor(opt, out, entry.data?.plan),
      // `resolveMinutes` rather than `minutesFor`: saving any output recomputes
      // this, and a correction made before `out.minutesSpent` existed lives on
      // the entry itself. See lib/minutes.js.
      minutes: resolveMinutes(entry.data, opt, out),
    } })
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
  const saveRun = (entry, run, { out = null, done = undefined, plan = null } = {}) => {
    const opt = optFor(menu, entry.data?.optId)
    const data = { ...entry.data, run }
    // The runner adding a set to the plan goes through HERE and not `savePlan`,
    // for the reason in the paragraph above: one tap, one writer.
    if (plan) { data.plan = plan; data.name = titleFor(opt, data.out || {}, plan) }
    if (out) {
      data.out = out
      data.level = levelFor(opt, out)
      data.minutes = resolveMinutes(entry.data, opt, out)
    }
    if (done !== undefined) data.done = done
    upsertEntry({ ...entry, data })
  }

  /** Editing the prescription itself — from the sheet, after it has landed. */
  const savePlan = (entry, pres) =>
    upsertEntry({ ...entry, data: { ...entry.data, plan: pres, name: pres.title || entry.data?.name } })

  return (
    <>
      <DayNav viewIso={iso} today={today} onChange={setIso} plan={plan} />

      <div className="pagegrid">
        <div className="col-main">
          {/* Where the week stands. A reading — nothing here is pressable into a
              session, which is the whole difference from the board it replaced. */}
          {/* Pressing a bar opens what filled it; pressing one of those jumps the
              day nav to the day it happened on. See quotabars.jsx. */}
          {/* Pressing what filled a bar opens THAT session, on its own day. See
              the header of quotabars.jsx for what it used to do instead. */}
          <QuotaBars plan={plan} entries={entries} iso={iso} onSetWeek={onSetWeek}
            onOpenEntry={(date, id) => { setIso(date); setOpenFromWeek(id) }} />

          <DaySessions plan={plan} entries={entries}
            mainEntry={mainEntry} extraEntries={extraEntries}
            onPickMain={pickMain} onAddExtra={addExtra} onRemove={removeSession}
            onSaveOutputs={saveOutputs} onSaveRun={saveRun} onSavePlan={savePlan}
            onSetDone={setDone} onSetTraining={setTraining}
            viewIso={iso} isFuture={isFuture}
            openEntryId={openEntryId || openFromWeek}
            openAs={openFromWeek ? 'sheet' : 'auto'}
            onOpened={() => { onOpened(); setOpenFromWeek(null) }}
            onPlan={onPlan} onLog={onLog} onPickSession={onPickSession} onRest={onRest} />
        </div>

        <aside className="col-side">
          {/* How the user arrived. Renders nothing when there is no reading, which is
              most days at first. */}
          {!isFuture && <WhoopReadiness date={iso} />}
          {!isFuture && <WhoopSleep date={iso} />}

          {/* What the services recorded and the log has no entry for. Renders
              nothing at all on a day with nothing outstanding — see unlogged.jsx. */}
          {!isFuture && (
            <UnloggedWorkouts plan={plan} entries={entries} iso={iso}
              onLog={logMeasured} onMerge={saveOutputs}
              skipped={skippedWorkouts} onDismiss={dismissWorkout} onRestore={restoreWorkout}
              split={splitWorkouts} onSplit={splitWorkout} />
          )}

          {!isFuture && (
            <Journal plan={plan} entries={entries} iso={iso} upsertEntry={upsertEntry}
              settings={settings} saveSettings={saveSettings} />
          )}

          <div className="card">
            <LoadCalendar days={calendar} start={firstLogged || iso} end={iso} />
          </div>
        </aside>
      </div>
    </>
  )
}

/**
 * Move between days. Backwards is for catching up a session you did but never
 * logged; forwards is preview only — you cannot have done tomorrow's work, and
 * Totem rejects future-dated habit logs anyway.
 */
function DayNav({ viewIso, today, onChange, plan }) {
  const shift = (n) => {
    const d = fromIso(viewIso)
    d.setDate(d.getDate() + n)
    const next = localIso(d)
    const first = plan?.weeks?.[0]?.start
    const maxAhead = fromIso(today); maxAhead.setDate(maxAhead.getDate() + 14)
    if (first && next < first) return
    if (next > localIso(maxAhead)) return
    onChange(next)
  }

  const offset = Math.round((fromIso(viewIso) - fromIso(today)) / 86400000)
  const label = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : offset === -1 ? 'Yesterday'
    : offset > 0 ? `In ${offset} days` : `${Math.abs(offset)} days ago`
  const weekday = fromIso(viewIso).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })

  return (
    <div className={`daynav ${offset > 0 ? 'future' : ''}`}>
      <button className="daynav-arrow" onClick={() => shift(-1)} aria-label="Previous day">
        <Icon name="ChevronDown" size={18} style={{ transform: 'rotate(90deg)' }} />
      </button>
      <div className="daynav-mid">
        <div className="daynav-label">{label}</div>
        <div className="daynav-date">{weekday}</div>
      </div>
      <button className="daynav-arrow" onClick={() => shift(1)} aria-label="Next day">
        <Icon name="ChevronDown" size={18} style={{ transform: 'rotate(-90deg)' }} />
      </button>
      {offset !== 0 && (
        <button className="daynav-today" onClick={() => onChange(today)}>today</button>
      )}
    </div>
  )
}

/*
 * The quick log used to sit here — a bodyweight box and a one-line note. It was
 * replaced by the check-in (see checkin.jsx) on 2026-08-13: the same numbers,
 * plus somewhere to say the thing neither field could hold ("can't get to the
 * gym tonight, going Sunday instead"), and a coach that answers and can lean on
 * today's recommendation. Bodyweight still writes an ordinary `bodyweight`
 * entry, so the series it has kept since the first week of the block is
 * unbroken; the Log tab's own quick log is still there for back-filling any date.
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

/**
 * Everything you are doing today, and nothing you are not.
 *
 * The rows used to be a mix of three things — what is on the day, what the week
 * still owed, and what the engine also recommended — with a tone ladder to tell
 * them apart and an × on the ones you could wave off. Two of those three are
 * gone, so the list is now exactly the entries on the day, and every row is
 * something the user put there.
 *
 * What that buys: the completion circle means something again. It used to have to
 * be suppressed on the offer rows, because a tick-box on something you have not
 * chosen reads as a checklist you are behind on. Now there is nothing on the list
 * that is not a commitment, so every row gets one.
 */
function DayList({ rows, onOpen, onPlan, onLog, onPickSession, onRest = null, isFuture, repeats = [], onAddAgain = null }) {
  return (
    <div className="card daylist">
      <h2>Your day</h2>

      {!rows.length && (
        <div className="dl-empty">
          <p className="dl-empty-lead">Nothing on today yet.</p>
          {!isFuture && (onPlan || onLog) && (
            <>
              <p className="sub">
                Plan one and it arrives with the sets already written; log one you have
                already done; pick one of the plan&rsquo;s own sessions, protocol and all; or
                take the day off on purpose. All of it also lives on the <strong>+</strong> button.
              </p>
              <div className="dl-empty-acts">
                {onPlan && (
                  <button className="btn" onClick={onPlan}>
                    <Icon name="Sparkles" size={16} /> Plan a workout
                  </button>
                )}
                {onLog && (
                  <button className="btn ghost" onClick={onLog}>
                    <Icon name="NotebookPen" size={16} /> Log a workout
                  </button>
                )}
                {onPickSession && (
                  <button className="btn ghost" onClick={onPickSession}>
                    <Icon name="Layers" size={16} /> Pick from the plan
                  </button>
                )}
                {onRest && (
                  <button className="btn ghost" onClick={onRest}>
                    <Icon name="Sunset" size={16} /> Log a rest day
                  </button>
                )}
              </div>
            </>
          )}
          {isFuture && <p className="sub">Plan something for it, or come back on the day.</p>}
        </div>
      )}

      {rows.length > 0 && (
        <div className="dl-rows">
          {rows.map(r => (
            <div key={r.key} className="dl-rowwrap">
              <button className={`dl-row t-${r.tone} ${r.done ? 'done' : ''}`} onClick={() => onOpen(r.key)}>
                <span className="dl-ico"><Icon name={r.icon} size={16} /></span>
                <span className="dl-main">
                  <span className="dl-name">
                    {r.name}
                    {/* The tag column already says "In progress" on a workout the user
                        is mid-way through, so the chip stays "planned" — the same
                        words twice on one row is noise, not emphasis. */}
                    {r.planned && <span className={`plannedchip ${r.running ? 'live' : ''}`}>planned</span>}
                  </span>
                  <span className="dl-stats">
                    {/* "not done yet" on a row that already says "6 of 16 sets" is
                        the same fact twice, and the second one reads as nagging. */}
                    {[...(r.stats?.length ? r.stats : [r.tier]),
                      r.done || r.running ? null : 'not done yet']
                      .filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="dl-tag">{r.tag}</span>
                <span className={`dl-check ${r.done ? 'on' : ''}`}>
                  <Icon name={r.done ? 'CircleCheck' : 'Circle'} size={15} />
                </span>
                <span className="dl-chev">
                  <Icon name="ChevronDown" size={15} style={{ transform: 'rotate(-90deg)' }} />
                </span>
              </button>
            </div>
          ))}
        </div>
      )}

      {/*
        * A SECOND one of a card that can be logged twice, in one tap, from the day
        * itself. Shown only once one is already on the day: before that the +
        * button is the way in, and two controls a line apart offering the same
        * thing in different words is its own kind of dead end.
        */}
      {!isFuture && onAddAgain && repeats.map(r => (
        <button key={r.optId} className="dl-add dl-again" onClick={() => onAddAgain(r.optId)}>
          <Icon name="Plus" size={15} />
          <span>{r.label}</span>
          {r.count > 1 && <span className="dl-again-n">{r.count} on today</span>}
        </button>
      ))}
    </div>
  )
}

/* --------------------------------------------------------- session sheets */

/*
 * "ADD-ONS FOR THIS SESSION" IS GONE, 2026-09-21. It was a pill row at the foot
 * of every main session offering the four support blocks to ride along with it.
 * It was never used and was just bloat. Adjuncts that are already ON an entry
 * still render as rows in the day list, because they are history; nothing offers
 * a new one. Same disposition as `lib/recommend.js` — the machinery stays, the
 * screen stops asking.
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
  onTraining = null,
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

  return (
    <Modal
      /*
       * What this session IS, not what the card is called. A planned session is
       * titled by its plan; a card that names itself from what you picked
       * (`nameFrom`) is titled "Mountain bike" rather than "Log a workout", which
       * is what the day list behind it already says. Opening a sheet headed with
       * a question you have already answered is how this read before the activity
       * moved in front of the form.
       */
      title={titleFor(opt, entry?.data?.out, pres)}
      sub={pres ? prescriptionLine(pres) : `${opt.minutes} min · ${opt.tier}`}
      icon={opt.icon}
      tone={tone}
      dismissable={!dirty}
      onClose={onClose}
      /* The name, one layer up. It used to be a box two thirds of the way down
         the log form; a rename is a thing you do TO the session you are looking
         at, so it belongs where the session's title is. */
      onRename={planned && !isFuture ? () => setRenaming(true) : null}
      onDelete={onRemove && entry ? () => onRemove(entry) : null}
      deleteLabel="Remove from today"
      footer={!onLog ? (
        <p className="sub" style={{ margin: 0 }}>
          <Icon name="Info" size={13} /> An add-on rides along with your main session — tick it there.
        </p>
      ) : isFuture ? (
        <p className="sub" style={{ margin: 0 }}>
          <Icon name="Info" size={13} /> Preview only — come back on the day to log it.
        </p>
      ) : (
        <div className="sheet-actions">
          {/* A planned session always offers the runner, whether or not the CARD
              declares a timer — what it walks is the prescription on the entry. */}
          {onStartWorkout && runnable(opt, pres) && !done && (
            <button className="btn wo-cta" onClick={() => { setDirty(true); onStartWorkout(opt) }}>
              <Icon name="Play" size={17} /> {pres ? 'Start the workout' : 'Start workout'}
            </button>
          )}
          <DoneButton opt={opt} entry={entry} planned={planned} done={done}
            onLog={() => { setDirty(true); onLog(opt) }}
            onSetDone={(v) => { setDirty(true); onSetDone(entry, v) }} />
        </div>
      )}
    >
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
        <SessionLog session={opt} entry={entry} entries={entries} onSave={save} defaultOpen />
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
          <PlanTalk pres={pres} compact
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
        * "Log another workout today" came off the sheet on 2026-09-21 — the day
        * list's own button and the + beside the coach bubble are both one tap
        * from here, and a third way in at the bottom of a form is the kind of
        * thing that made this screen read as a maze.
        */}

      {renaming && (
        <DetailsSheet session={opt} entry={entry} entries={entries}
          onSave={save}
          training={entry?.data?.training}
          /* Only where the question makes sense — a commute is a ride, not a set
             of max hangs. Driven by the discipline rather than by a list. */
          onTraining={onTraining}
          onClose={() => setRenaming(false)} />
      )}
    </Modal>
  )
}

/**
 * Completion, made explicit. Adding a session to the day and completing it are
 * two different acts — conflating them is what silently marked the habit done
 * for workouts that were only ever swapped in.
 */
function DoneButton({ opt, planned, done, onLog, onSetDone }) {
  if (!planned) {
    return (
      <button className="btn" onClick={onLog}>
        {opt.role === 'rest' ? 'Take a rest day' : 'Add to today'}
      </button>
    )
  }
  return (
    <button className={`btn done-btn ${done ? 'ghost on' : ''}`} onClick={() => onSetDone(!done)}>
      <Icon name={done ? 'CircleCheck' : 'Circle'} size={16} />
      {done ? 'Done — tap to undo' : 'Mark as done'}
    </button>
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
  onSetDone, onSetTraining, viewIso, isFuture,
  openEntryId = null, openAs = 'auto', onOpened = () => {},
  onPlan = null, onLog = null, onPickSession = null, onRest = null,
}) {
  const [sheet, setSheet] = useState(null)   // row key: 'main' | an extra entry id
  const [workout, setWorkout] = useState(null) // same key, but training in front of it

  const menu = plan?.dailyMenu || []
  const adjuncts = menu.filter(m => m.role === 'adjunct')

  /*
   * Something just landed from the + button, so open it.
   *
   * Creating an entry and leaving them to find it is the same dead end the "add
   * another" button had before it opened what it created: a blank row on the day
   * that the user then has to spot and press. The id round-trips through App because
   * the button lives beside the coach bubble rather than on this screen.
   */
  useEffect(() => {
    if (!openEntryId) return
    const hit = [mainEntry, ...extraEntries].find(e => e?.id === openEntryId)
    if (!hit) return
    const key = hit.id === mainEntry?.id ? 'main' : hit.id
    // A planned session opens straight into the runner. The user pressed "plan a
    // workout" and then "put it on today"; a third tap to start it is a tap that
    // asks them to confirm something the user has already said twice.
    if (openAs !== 'sheet' && hit.data?.plan && runnable(null, hit.data.plan)) setWorkout(key)
    else setSheet(key)
    onOpened()
  }, [openEntryId, openAs, mainEntry?.id, extraEntries.length])

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

  /** Log a SECOND one of a repeatable card, and open it. */
  const addAnother = (opt) => {
    if (!opt) return
    const id = onAddExtra(opt, { fresh: true })
    setSheet(id || null)
  }

  // How many of it are on the day, MAIN INCLUDED — a run logged as the day's main
  // and a lift added on top is two of the same card, and a count that only saw
  // the extras would call that one.
  const onDayCount = (id) =>
    (mainEntry?.data?.optId === id ? 1 : 0) + extras.filter(x => x.opt.id === id).length

  const repeats = menu
    .filter(m => isRepeatable(m) && !m.retired && onDayCount(m.id) > 0)
    .map(m => ({ optId: m.id, label: repeatLabel(m), count: onDayCount(m.id) }))

  /*
   * "And another one", from the day.
   *
   * For an ordinary session that is a second entry of the same card. For a
   * CONTAINER — the planned card, the workout card — it is not: those two carry
   * no content of their own, so a blank one is a card with its whole question
   * unanswered. "Plan another workout" minted an empty planned session with no
   * prescription in it and opened the sheet on it, which is not what the button
   * says and not what the + button beside it does. `sched.repeatVia` names the
   * screen that asks the question instead. The planned one was hit first.
   */
  const addAgain = (optId) => {
    const opt = menu.find(m => m.id === optId)
    const via = opt?.sched?.repeatVia
    if (via === 'plan' && onPlan) return onPlan()
    if (via === 'log' && onLog) return onLog()
    return addAnother(opt)
  }

  const mainOpt = logged || null

  const rowFor = (entry, opt, { tag, tone }) => ({
    key: entry.id === mainEntry?.id ? 'main' : entry.id,
    icon: opt.icon,
    name: titleFor(opt, entry.data?.out, entry.data?.plan),
    tier: opt.tier,
    tag: isRunning(entry) ? 'In progress' : tag,
    tone,
    planned: Boolean(entry.data?.plan),
    running: isRunning(entry),
    done: isDone(entry),
    // A session in progress says where it is rather than what it added up to —
    // "6 of 16 sets" is the only fact the user wants off that row.
    stats: isRunning(entry) ? [runLine(entry)].filter(Boolean) : sessionStats(entry, opt),
  })

  const rows = [
    ...(mainEntry && mainOpt
      ? [rowFor(mainEntry, mainOpt, { tag: resting ? 'Rest' : 'Main', tone: resting ? 'rest' : 'rec' })]
      : []),
    ...extras.map(({ entry, opt }) => rowFor(entry, opt, { tag: 'Added', tone: 'extra' })),
    ...(mainEntry?.data?.adjuncts || [])
      .map(id => adjuncts.find(a => a.id === id))
      .filter(Boolean)
      .map(a => ({ key: `adj-${a.id}`, icon: a.icon, name: a.name, tier: a.tier,
        tag: 'Add-on', tone: 'adj', planned: false, done: true, stats: [] })),
  ]

  /** Resolve a row key back to the session and entry it stands for. */
  const resolve = (key) => {
    if (!key) return null
    if (key === 'main') {
      return mainEntry && mainOpt
        ? { opt: mainOpt, entry: mainEntry, tone: resting ? 'rest' : 'rec', kind: 'main' }
        : null
    }
    if (key.startsWith('adj-')) {
      const opt = adjuncts.find(a => `adj-${a.id}` === key)
      return opt && { opt, entry: null, tone: 'adj', kind: 'adjunct' }
    }
    const hit = extras.find(x => x.entry.id === key)
    return hit && { opt: hit.opt, entry: hit.entry, tone: 'extra', kind: 'extra' }
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
  const startWorkout = (key) => (opt) => {
    const row = resolve(key)
    if (!row) return
    if (!row.entry) (row.kind === 'extra' ? onAddExtra : onPickMain)(opt)
    setSheet(null)
    setWorkout(key)
  }

  /*
   * The runner owns the screen completely while the user is training. Checked BEFORE
   * workout mode: a card with both a plan and a declared timer is a planned
   * session that happens to be based on one, and the plan is the thing the user is
   * following.
   */
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
      <DayList rows={rows} onOpen={openRow} isFuture={isFuture}
        onPlan={onPlan} onLog={onLog} onPickSession={onPickSession}
        // The day the user is LOOKING at, so a forgotten rest day can be logged from
        // the day it belongs to. Not a future one — resting is not a plan.
        onRest={onRest && viewIso <= localIso() ? () => onRest(viewIso) : null}
        repeats={repeats}
        onAddAgain={addAgain} />

      {open && (
        <SessionSheet
          opt={open.opt} entry={open.entry} tone={open.tone} entries={entries} isFuture={isFuture}
          onLog={open.kind === 'adjunct' ? null : open.kind === 'extra' ? onAddExtra : onPickMain}
          onSave={onSaveOutputs}
          onSavePlan={onSavePlan}
          onRemove={open.entry ? onRemove : null}
          onSetDone={onSetDone}
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

/* ------------------------------------------------------------------- week */

/*
 * The Week tab: where the quotas are written.
 *
 * This replaced the week-by-week plan on 2026-09-14. That tab rendered eleven
 * dated weeks and four phases out of plan.json — a block that had already gone
 * stale, counting down to a trip that was not happening. Nothing here is content
 * any more: the week is something the user writes, and the app's only jobs are
 * to copy last week forward and to show what filled it.
 *
 * Three rules, from the conversation that produced it:
 *
 *   - The user writes them. `suggest()` offers; nothing is ever written without a tap.
 *   - Misses expire on Sunday. No debt, no carry-over, no guilt.
 *   - A quota counts WORKOUTS, not days. A day with a ride and a lift fills two.
 */

export function WeekTab({ plan, entries, upsertEntry }) {
  const today = todayIso()
  const [monday, setMonday] = useState(() => mondayOf(today))
  const week = useMemo(() => quotaProgress({ plan, entries, iso: monday }), [plan, entries, monday])
  const stored = useMemo(() => quotaCounts(entries, monday), [entries, monday])
  // The reasoning, if this week was planned with the AI (see weekplanner.jsx). A
  // week set by hand has none, and shows none.
  const planned = useMemo(() => quotaEntry(entries, monday)?.data || null, [entries, monday])
  const offer = useMemo(() => suggest({ plan, entries, iso: monday }), [plan, entries, monday])

  // What is in the boxes. Seeded from what the user has SET, never from the
  // suggestion — a pre-filled number whose provenance is invisible is a number
  // that gets confirmed without being read. Taking the offer is a tap.
  const [draft, setDraft] = useState(null)
  const counts = draft ?? stored
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(stored)

  const set = (key, n) => {
    const next = { ...counts }
    if (n > 0) next[key] = n
    else delete next[key]
    setDraft(next)
  }
  // Keep the provenance the week planner wrote, if any — moving one stepper by
  // hand does not un-explain the rest of the week.
  const save = () => {
    const { counts: _c, ...extra } = planned || {}
    upsertEntry(buildQuotaEntry(monday, counts, extra))
    setDraft(null)
  }
  const shift = (n) => { setMonday(m => shiftWeek(m, n)); setDraft(null) }

  const isThisWeek = monday === mondayOf(today)
  const label = `${fromIso(monday).toLocaleDateString([], { month: 'short', day: 'numeric' })} – ` +
    `${fromIso(weekDays(monday)[6]).toLocaleDateString([], { month: 'short', day: 'numeric' })}`

  const achs = useMemo(
    () => achievements(plan, entries, profileFacts(entries)), [plan, entries])
  const catsOf = (a) => (plan?.quotaCategories || []).filter(c => a.categories.includes(c.key))
  const ungrouped = useMemo(() => unclaimed(plan, achs), [plan, achs])

  const Row = (c) => {
    const state = week.byKey[c.key] || { done: 0 }
    const n = counts[c.key] || 0
    return (
      <div key={c.key} className={`quotarow ${state.complete ? 'done' : ''}`}>
        <span className="quotarow-ico"><Icon name={c.icon} size={16} /></span>
        <span className="quotarow-name">
          <strong>{c.name}</strong>
          <span className="sub">{c.blurb}</span>
        </span>
        <span className="quotarow-did" title="what you have actually logged this week">
          {state.done > 0 ? `${state.done} done` : ''}
        </span>
        <span className="quotarow-set">
          <button className="qbtn" onClick={() => set(c.key, Math.max(0, n - 1))}
            aria-label={`one fewer ${c.name}`} disabled={!n}><Icon name="Minus" size={14} /></button>
          <span className="qbtn-n">{n || '–'}</span>
          <button className="qbtn" onClick={() => set(c.key, n + 1)}
            aria-label={`one more ${c.name}`}><Icon name="Plus" size={14} /></button>
        </span>
      </div>
    )
  }

  return (
    <>
      <div className="daynav">
        <button onClick={() => shift(-1)} aria-label="previous week">‹</button>
        <span className="daynav-label">
          {label}{isThisWeek && <em> · this week</em>}
        </span>
        <button onClick={() => shift(1)} aria-label="next week">›</button>
      </div>

      <div className="card">
        <h2>{planned?.title || 'What this week asks for'}</h2>
        <p className="sub">
          A quota is a count of <strong>workouts</strong>, not days — a day you ride and lift
          fills two. Nothing is assigned to a weekday; you decide that as the week goes.
          Whatever is left on Sunday expires rather than carrying over.
        </p>

        {planned?.why && <PlanWhy text={planned.why} />}

        {!week.isSet && offer.source !== 'empty' && (
          <button className="restbtn" onClick={() => setDraft(offer.counts)}>
            <Icon name="Repeat" size={17} />
            <span>
              {offer.source === 'last-week'
                ? 'Copy last week\'s quotas forward'
                : 'Start from what you actually did last week'}
            </span>
          </button>
        )}

        {achs.map(a => (
          <div key={a.id} className="quotagroup">
            <h3><Icon name={a.icon} size={15} /> {a.name}</h3>
            {a.blurb && <p className="sub">{a.blurb}</p>}
            {catsOf(a).map(Row)}
          </div>
        ))}

        {ungrouped.length > 0 && (
          <div className="quotagroup">
            <h3><Icon name="Sparkles" size={15} /> Nothing in particular</h3>
            <p className="sub">
              Claimed by none of your achievements. It still counts and it still shows up.
            </p>
            {ungrouped.map(Row)}
          </div>
        )}

        <div className="quotafoot">
          <span className="sub">
            {Object.values(counts).reduce((a, b) => a + b, 0)} workouts asked for
            {week.isSet && ` · ${week.doneTotal} of ${week.plannedTotal} filled`}
          </span>
          <button className="primary" onClick={save} disabled={!dirty}>
            {week.isSet ? 'Update the week' : 'Set the week'}
          </button>
        </div>
      </div>

      {(plan?.rules || []).length > 0 && (
        <Blurb id="rules" title="When life happens" tone="card">
          <p className="sub">The plan is supposed to bend. These are the rules for bending it.</p>
          <ul className="rules">
            {plan.rules.map((r, i) => (
              <li key={i}><strong>{r.when}</strong> — {r.then}</li>
            ))}
          </ul>
        </Blurb>
      )}

      <Blurb id="exposure" title={plan?.exposureBudget?.title || 'The finger budget'} tone="card">
        <p className="sub">{plan?.exposureBudget?.body}</p>
      </Blurb>
    </>
  )
}

/* ---------------------------------------------------------------- testing */

export function TestingTab({ plan, entries, upsertEntry }) {
  const [active, setActive] = useState(null)
  const tests = plan?.tests || []

  // The starter content has no benchmark tests; a plan that defines some fills this in.
  if (!tests.length && !(plan?.testingNotes || []).length) {
    return (
      <div className="card">
        <h2>No tests in this plan</h2>
        <p className="sub" style={{ margin: 0 }}>
          Benchmark tests come from the training plan. The example plan in Settings has six.
        </p>
      </div>
    )
  }

  return (
    <>
      {(plan?.testingNotes || []).map((n, i) => (
        <Blurb key={i} id={`testnote-${i}`} title={n.title}>
          <p className="sub" style={{ margin: 0 }}>{n.body}</p>
        </Blurb>
      ))}

      {tests.map(t => {
        const results = entries
          .filter(e => e.kind === 'test' && e.data?.testId === t.id)
          .sort((a, b) => a.date.localeCompare(b.date))
        return (
          <div key={t.id} className="card">
            <h2>{t.name}</h2>
            <p className="sub">{t.why}</p>

            {t.metrics.map((m, mi) => {
              const pts = results
                .filter(r => Number.isFinite(Number(r.data?.[m.key])))
                .map(r => ({ x: r.date, y: Number(r.data[m.key]) }))
              return pts.length ? (
                <LineChart key={m.key} points={pts} label={m.label} unit={m.unit || ''}
                  color={SERIES[mi % SERIES.length]} goal={m.goal} />
              ) : null
            })}

            {t.id === 'critical-force' && <CeilingReadout entries={entries} />}

            <button className="btn ghost" style={{ marginTop: 10 }}
              onClick={() => setActive(active === t.id ? null : t.id)}>
              {active === t.id ? 'close' : 'run this test'}
            </button>

            {active === t.id && <TestRunner test={t} onSave={upsertEntry} onDone={() => setActive(null)} />}
          </div>
        )
      })}
    </>
  )
}

/**
 * What the critical-force test actually buys you: a number in kilograms to set
 * the gauge to. This is the whole reason the test is worth running — before it
 * was computed here, it had to be re-derived by hand from the last result every
 * time, which is how a session ends up trained at the wrong intensity for weeks.
 */
function CeilingReadout({ entries }) {
  const c = resolveCeiling(entries)
  if (!c) return null

  const round = (n) => Math.round(n * 10) / 10
  const pct = cfPctOfMax(c)
  const band = cfBand(pct)

  return (
    <div className="ceiling">
      <div className="ceiling-head">
        <Icon name="Gauge" size={14} />
        <span>Your sub-threshold ceiling</span>
        <span className="ceiling-date">tested {c.date}</span>
      </div>

      <div className="ceiling-nums">
        <div className="ceiling-big">
          <strong>{round(c.ceiling)}</strong><span>kg ceiling</span>
        </div>
        <div className="ceiling-big accent">
          <strong>{round(c.ceiling - 2)}</strong><span>kg — unilateral target</span>
        </div>
      </div>

      <dl className="deflist">
        <dt>How</dt>
        <dd>
          {c.cfMin != null
            ? <>CFmin {round(c.cfMin)} kg vs CF {round(c.cf)} − {CF_CORRECTION_KG} = {round(c.corrected)} kg.
                The lower one binds{c.bound === 'cfmin' ? ' — that is CFmin' : ' — that is the corrected CF'}.</>
            : <>CF {round(c.cf)} kg − {CF_CORRECTION_KG} = {round(c.corrected)} kg. Log CFmin from the
                same test and this uses whichever is lower.</>}
        </dd>
        {pct != null && (
          <>
            <dt>CF vs your max</dt>
            <dd>
              {pct}% of {round(c.mvc)} kg. Climbers average {CF_PCT_MVC_MEAN} ± {CF_PCT_MVC_SD}%
              (Fryer 2019), so{' '}
              {band === 'below' ? 'this sits below that band — the endurance-limited pattern this whole block targets.'
                : band === 'above' ? 'this sits above that band, which is not the pattern this block assumes.'
                : 'this sits inside the normal band.'}
            </dd>
          </>
        )}
        <dt>Trust</dt>
        <dd>
          One test. Test-retest CV for this protocol is {CF_NOISE_PCT}% (McClean 2023), so treat
          anything inside roughly ±{round(c.cf * (CF_NOISE_PCT / 100))} kg as unchanged until a
          third test agrees.
        </dd>
      </dl>
    </div>
  )
}

function TestRunner({ test, onSave, onDone }) {
  const [vals, setVals] = useState({})
  const [date, setDate] = useState(todayIso)

  const save = () => {
    const data = { testId: test.id }
    for (const m of test.metrics) if (vals[m.key] !== '' && vals[m.key] != null) data[m.key] = Number(vals[m.key])
    onSave({ kind: 'test', date, data })
    onDone()
  }

  return (
    <div className="runner">
      <div className="runner-sec">
        <h3>Equipment</h3>
        <p>{test.equipment}</p>
      </div>

      <div className="runner-sec">
        <h3>Procedure</h3>
        <ol className="steps">
          {test.procedure.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      </div>

      {test.cautions?.length > 0 && (
        <div className="runner-sec caution">
          <h3>Don't</h3>
          <ul>{test.cautions.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </div>
      )}

      <div className="runner-sec">
        <h3>Result</h3>
        <label className="field" style={{ marginBottom: 10 }}>
          Date
          <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        </label>
        {test.metrics.map(m => (
          <label className="field" key={m.key} style={{ marginBottom: 10 }}>
            {m.label} {m.unit ? `(${m.unit})` : ''}
            <input type="number" inputMode="decimal" value={vals[m.key] ?? ''}
              onChange={e => setVals(v => ({ ...v, [m.key]: e.target.value }))} placeholder={m.hint || ''} />
          </label>
        ))}
        <button className="btn" onClick={save}>Save result</button>
      </div>

      {test.interpretation && (
        <div className="runner-sec">
          <h3>Reading the number</h3>
          <p>{test.interpretation}</p>
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------- why */

export function WhyTab({ plan }) {
  const [filter, setFilter] = useState('all')
  const items = (plan?.evidence || []).filter(e => filter === 'all' || e.verdict === filter)

  return (
    <>
      {plan?.exposureBudget && (
        <Blurb id="exposure-budget" title={plan.exposureBudget.title}>
          <p className="sub" style={{ marginBottom: plan.exposureBudget.disagreement ? 12 : 0 }}>
            {plan.exposureBudget.body}
          </p>
          {plan.exposureBudget.disagreement && (
            <details className="disagree">
              <summary>Where my sources disagreed</summary>
              <p>{plan.exposureBudget.disagreement}</p>
            </details>
          )}
        </Blurb>
      )}

      {plan?.reframe && (
        <Blurb id="reframe" title={plan.reframe.title}>
          <p className="sub" style={{ margin: 0 }}>{plan.reframe.body}</p>
        </Blurb>
      )}

      <div className="card">
        <h2>What the evidence actually says</h2>
        <p className="sub" style={{ margin: items.length ? 0 : 12 }}>
          Every claim below was checked against primary sources, and the shaky ones were handed to agents whose
          job was to refute them. Where the honest answer is "nobody knows," it says so.
        </p>
        {!items.length && (
          <p className="sub" style={{ margin: 0 }}>
            The standalone evidence index was removed on 2026-09-14 with the rest of the
            dated block. Nothing was lost: every session still carries its own graded
            <strong> transfer</strong> and <strong>summary</strong>, which is where these
            claims were actually read. Open any session and expand <em>the evidence</em>.
          </p>
        )}
      </div>

      {items.length > 0 && (
        <div className="filters">
          {['all', 'supported', 'mixed', 'refuted'].map(f => (
            <button key={f} className={`chip ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
      )}

      {items.map((e, i) => (
        <div key={i} className={`card ev ${e.verdict}`}>
          <div className="ev-head">
            <span className={`ev-badge ${e.verdict}`}><Icon name={VERDICT_ICONS[e.verdict]} size={12} /> {e.verdict}</span>
            <span className="ev-claim">{e.claim}</span>
          </div>
          <p className="ev-body">{e.reality}</p>
          {e.doThis && <p className="ev-do"><strong>So:</strong> {e.doThis}</p>}
          {e.sources?.length > 0 && (
            <p className="ev-src">{e.sources.join(' · ')}</p>
          )}
        </div>
      ))}
    </>
  )
}
