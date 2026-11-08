/*
 * The day's sessions (#98: out of tabs.jsx): the list of rows (`DayList`), the
 * empty day (`EmptyDay`), and `DaySessions`, which opens each row's sheet, its
 * runner or workout mode, and writes through `sessionOps`.
 */

import { useEffect, useRef, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import { totalSets } from './setlog.jsx'
import { liftedLine, liftFieldIn } from './lib/lifts.js'
import { climbLine } from './lib/grades.js'
import { restStats } from './lib/stats.js'
import { localIso, dayWords, dayPhrase } from './lib/dates.js'
import { MetaLine, metaParts } from './metaline.jsx'
import { isDone } from './lib/store.js'
import { WorkoutMode } from './workout.jsx'
import { WorkoutRunner } from './runner.jsx'
import { SessionSheet, runnable } from './sheet.jsx'
import { optFor } from './lib/menu.js'
import { prescriptionLine, prescriptionSteps, runProgress, planProgress } from './lib/prescription.js'
import { hasWorkout } from './lib/workout.js'
import { loggedMinutes } from './lib/minutes.js'
import { titleFor } from './lib/naming.js'
import { disciplineFor } from './lib/activities.js'
import { currentMe } from './lib/whoami.js'
import { workoutSides, plannedLine } from './lib/trainer.js'
import { withLine } from './lib/shared.js'
import { rememberSide } from './sharedwith.jsx'
import { SidesWorkout } from './trainer.jsx'
import { placedUndoText, placedToUndo } from './lib/quicklog.js'
import { UNDO_MS } from './lib/sessionops.js'
import { activityFieldOf } from './picker.jsx'
import { pushToast, dismissToast } from './lib/toast.js'
import { Undo2 } from 'lucide-react'

const todayIso = () => localIso()

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
function DayList({ rows, onOpen, isFuture, viewIso, onLog = null, onRest = null, onPlan = null, quick = null }) {
  if (!rows.length) {
    return <EmptyDay isFuture={isFuture} viewIso={viewIso} onLog={onLog} onRest={onRest} onPlan={onPlan} quick={quick} />
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
export function EmptyDay({ isFuture, viewIso, onLog, onRest, onPlan = null, quick }) {
  /* A day still to come is planned, not logged: its one way in, worded with the
     day the planner will put it on (#78), so the screen says what the + would do
     (#94, A F8: "Nothing planned yet" was a dead end). */
  if (isFuture) {
    return (
      <div className="empty dl-empty">
        <p className="dl-empty-title">Nothing planned yet</p>
        {onPlan && (
          <div className="dl-empty-acts">
            <button type="button" className="btn secondary" onClick={onPlan}>Plan a workout for {dayPhrase(viewIso)}</button>
          </div>
        )}
      </div>
    )
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

export function DaySessions({
  plan, entries, mainEntry, extraEntries,
  onPickMain, onAddExtra, onRemove, onSaveOutputs, onSaveRun, onSavePlan,
  onSetDone, onSetTraining, viewIso, isFuture, onSaveEntry = null,
  openEntryId = null, onOpened = () => {}, openSheetId = null, onSheetOpened = () => {},
  onLog = null, onRest = null, onPlan = null, quick = null, onUnplace = null,
}) {
  const [sheet, setSheet] = useState(null)   // row key: 'main' | an extra entry id
  const [workout, setWorkout] = useState(null) // same key, but training in front of it
  const [workoutSide, setWorkoutSide] = useState(null) // whose side a shared workout opens on
  // The entry the sheet was opened on because a tap just wrote it (+ → Run, a pick
  // in Log a workout), for the way back when it closes with nothing on it.
  const placed = useRef(null)
  /*
   * The Undo a just-placed sheet left on closing, and the entries as they are
   * now (#101 review). Pressed, it removes the workout only if it is STILL just
   * the tap (`placedToUndo`); it goes away once the workout is written on, its
   * sheet is opened again, or this screen goes, so a stale Undo never takes a
   * note typed since with it.
   */
  const undo = useRef(null)
  const latest = useRef(entries)
  latest.current = entries
  const dropUndo = () => {
    if (undo.current?.toast != null) dismissToast(undo.current.toast)
    undo.current = null
  }
  useEffect(() => () => dropUndo(), [])
  useEffect(() => { if (sheet) dropUndo() }, [sheet])

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
    else { placed.current = hit.id; setSheet(key) }
    onOpened()
  }, [openEntryId, mainEntry?.id, extraEntries.length]) // eslint-disable-line react-hooks/exhaustive-deps -- once per id asked for; following every sync of the day (or a new onOpened) would reopen a sheet the user closed

  // The sheet of an entry already on the day (a shared workout opened from
  // someone's week): always the sheet, never the runner, and not a placement.
  useEffect(() => {
    if (!openSheetId) return
    const hit = [mainEntry, ...extraEntries].find(e => e?.id === openSheetId)
    if (!hit) return
    placed.current = null
    setSheet(hit.id === mainEntry?.id ? 'main' : hit.id)
    onSheetOpened()
  }, [openSheetId, mainEntry?.id, extraEntries.length]) // eslint-disable-line react-hooks/exhaustive-deps -- once per id asked for, as the opening above

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
    // A circuit on the clock (issue #68): its sets are marked when it ends.
    if (e.data.run?.circuit) return 'Circuit running'
    const p = runProgress(e.data.run, prescriptionSteps(e.data.plan))
    if (!p.total) return null
    return `${p.done} of ${p.total} sets`
  }

  /** "4 of 18 sets": a plan on its day with some sets ticked and some still to do. */
  const inProgress = (e) => {
    if (!e?.data?.plan || e.date !== todayIso() || e.data?.run?.endedAt || e.data?.undone === true) return null
    const p = planProgress(e.data.plan)
    return p.done > 0 && p.done < p.total ? `${p.done} of ${p.total} sets` : null
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
    // A plan being done on its sheet, on its day: how far it has got ("4 of 18
    // sets", like a run under way), not what has been logged so far (#94, A F7).
    const going = inProgress(entry)
    if (going) return [going, withLine(entry, currentMe().people), plannedLine(entry, currentMe())]
    if (!isDone(entry)) bits.push(entry.data?.undone === true ? 'Not done' : 'Planned')
    if (opt.role === 'rest') bits.push(...restStats(entry, opt))
    else {
      const mins = loggedMinutes(entry, opt)
      const sets = totalSets(out)
      // A climbing night says what was climbed ("5 routes · hardest 5.10"), the
      // same line as the Log and "last time" (lib/grades.js `climbLine`, #97 F2):
      // it read "1 set", the set log's container, not the climbs in it.
      const work = Number(out.distance) > 0 ? `${out.distance} mi`
        : climbLine(opt, out) || liftedLine(entry, liftFieldIn(opt)) || (sets ? `${sets} set${sets === 1 ? '' : 's'}` : null)
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
    placed.current = null
    const row = resolve(key)
    if (row?.entry && isRunning(row.entry)) setWorkout(key)
    else setSheet(key)
  }

  const open = resolve(sheet)
  const training = workout ? resolve(workout) : null

  // Written on since it closed (from here, another tab or another device): no Undo.
  useEffect(() => {
    const u = undo.current
    if (u && !placedToUndo(entries, u.id, null, activityFieldOf(plan))) dropUndo()
  }, [entries]) // eslint-disable-line react-hooks/exhaustive-deps -- the question is a write since close; a plan reload is not one

  /*
   * Closing the sheet. One a tap just wrote (+ → Run, a pick in Log a workout)
   * and that is closed with nothing put on it says what was logged, with Undo
   * (#94, A F3): before, a mis-tap left a done workout in the streak whose only
   * way back was the bin and a confirm. Anything added makes it a log someone
   * meant, and it closes as any sheet does.
   */
  const closeSheet = (row) => {
    const id = placed.current
    placed.current = null
    setSheet(null)
    const entry = row?.entry
    if (!onUnplace || !entry || entry.id !== id) return
    const words = placedUndoText(entry, row.opt, activityFieldOf(plan))
    if (!words) return
    dropUndo()
    const opt = row.opt
    const toast = pushToast(words, 'info', {
      duration: UNDO_MS,
      action: { label: 'Undo', icon: Undo2, onClick: () => {
        undo.current = null
        const now = (placedToUndo)(latest.current, entry.id, opt, activityFieldOf(plan))
        if (now) onUnplace(now)
      } },
    })
    undo.current = { id: entry.id, toast }
  }

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
        onLog={onLog} onPlan={onPlan} quick={quick}
        // The day the user is LOOKING at, so a forgotten rest day can be logged from
        // the day it belongs to. Not a future one — resting is not a plan.
        onRest={onRest && viewIso <= localIso() ? () => onRest(viewIso) : null} />

      {open && (
        <SessionSheet
          opt={open.opt} entry={open.entry} tone={open.tone} entries={entries} isFuture={isFuture} day={viewIso}
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
          onClose={() => closeSheet(open)}
        />
      )}
    </>
  )
}
