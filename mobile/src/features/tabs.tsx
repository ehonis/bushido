/*
 * Tab renderers (app/src/tabs.jsx). Everything here is driven by the plan file —
 * no training content is hardcoded, so the program can be revised by editing
 * that file with no rebuild.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { PanResponder, StyleSheet, View } from 'react-native'
import { colors, font, space } from '../theme'
import { T } from '../ui/Text'
import { Btn, Card, Empty, IconBtn, Press } from '../ui/kit'
import { tap } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { LoadCalendar } from '../lib/viz'
import { restStats } from '../lib/stats.js'
import { totalSets } from './setlog'
import { liftedLine, liftFieldIn } from '../lib/lifts.js'
import { climbLine } from '../lib/grades.js'
import { pushToast, dismissToast } from '../lib/toast'
import { localIso, fromIso, isoShift, dayWords, dayPhrase } from '../lib/dates.js'
import { metaText } from './metaline'
import { isDone, extraEntryId, doneWhenPlaced, markDone } from '../lib/store.js'
import { sessionOps } from '../lib/sessionops.js'
import { WorkoutMode } from './workout'
import { WorkoutRunner } from './runner'
import { PlanWhy } from './planner'
import { SessionSheet, runnable } from './sheet'
import { optFor } from '../lib/menu.js'
import { prescriptionLine, prescriptionSteps, runProgress, planProgress } from '../lib/prescription.js'
import { hasWorkout } from '../lib/workout.js'
import { minutesFor, loggedMinutes, resolveMinutes } from '../lib/minutes.js'
import { levelFor } from '../lib/level.js'
import { nameFor, titleFor } from '../lib/naming.js'
import { disciplineFor } from '../lib/activities.js'
import { UnloggedWorkouts } from './unlogged'
import { WhoopReadiness, WhoopSleep } from './whoop'
import { currentMe } from '../lib/whoami.js'
import { withLine } from '../lib/shared.js'
import { rememberSide } from './sharedwith'
import { SidesWorkout, PeopleDays } from './trainer'
import { QuickLog } from './quicklog'
import { placedUndoText, placedToUndo } from '../lib/quicklog.js'
import { UNDO_MS } from '../lib/sessionops.js'
import { activityFieldOf } from './picker'
import * as trainerLib from '../lib/trainer.js'

// Default parameters in the ported JS narrow TypeScript's inference (mobile/AGENTS.md).
const { applyOut, applyRun, applyPlan, canStart, workoutSides, planPeople, plannedLine } = trainerLib as any

// The lib is the web's JS; its default-parameter destructuring makes TypeScript
// infer narrower types than the functions take, so they are called through these.
const _titleFor = titleFor as any
const _extraEntryId = extraEntryId as any
const _levelFor = levelFor as any
const _minutesFor = minutesFor as any
const _resolveMinutes = resolveMinutes as any

const todayIso = () => localIso()
/* Stable identity, so "nothing dismissed" is not a new array on every render. */
const NO_SKIPS: string[] = []

/*
 * iOS will not present a full-screen modal while a page sheet is still sliding
 * away, so a layer that replaces another (the sheet's "Start workout", or a
 * session the + button just placed while its own sheet closes) opens after it.
 */
const AFTER_SHEET = 450

// The week is a calendar week, Monday to Sunday. `plan.weeks` — eleven dated
// weeks counting down to a trip — went on 2026-09-14 along with the trip.

/* ------------------------------------------------------------------ today */

/**
 * Today.
 *
 * Rebuilt on 2026-09-17, shorter than what went in. It used to lead with the
 * recommender: a quota board of offers, companion sessions, a card explaining why
 * today was what it was, a ranked swap list and a rest-day button. Every one of
 * those was the app having an opinion about what the user should do, and none of
 * it is here, because a set schedule or recommended workouts do not get followed.
 *
 * So Today is one thing: WHAT IS ACTUALLY ON THE DAY — sessions the user planned
 * or logged, and nothing the user did not. An empty day renders as an empty day.
 *
 * Adding to the day lives on the + button. The quota bars that used to lead this
 * screen, the journal beside it and the recommender behind both were removed on
 * 2026-10-25 (issue #31); old quota and journal entries stay in the log, unread.
 */
export function TodayTab({
  plan, entries, upsertEntry, deleteEntry,
  openEntryId = null, onOpened = () => {},
  onPlan = null, onLog = null, onRest = null, onViewDay = null, showDay = null, onDayShown = null,
}: {
  showDay?: { date: string; seq: number } | null
  onDayShown?: (() => void) | null
  plan: any
  entries: any[]
  upsertEntry: (e: any) => void
  deleteEntry?: (id: string) => void
  openEntryId?: string | null
  onOpened?: () => void
  onPlan?: (() => void) | null
  onLog?: ((iso: string, opts?: { climb?: any }) => void) | null
  onRest?: ((iso?: string) => void) | null
  onViewDay?: ((iso: string) => void) | null
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
  const [followed, setFollowed] = useState<string | null>(null)
  const opening = openEntryId ? entries.find(e => e.id === openEntryId && e.kind === 'daily') : null
  if (opening && followed !== opening.id) {
    setFollowed(opening.id)
    if (opening.date && opening.date !== iso) setIso(opening.date)
  } else if (!openEntryId && followed) setFollowed(null)
  useEffect(() => {
    if (showDay?.date && opening) { onDayShown?.(); return }
    if (showDay?.date) { setIso(showDay.date); onDayShown?.() }
  }, [showDay])
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
   * Waving off a MEASURED workout the services recorded. This survived the cull
   * and session dismissal did not: "that ride was not a workout" is a fact about
   * a measurement; "stop suggesting me rides" answered a question the app has
   * stopped asking.
   */
  const workoutPrefs = entries.find(e => e.kind === 'skip-workout' && e.date === iso)?.data || null
  const skippedWorkouts = workoutPrefs?.ids || NO_SKIPS
  // Pairs the user has said are NOT the same activity, so the app does not
  // assert it again tomorrow.
  const splitWorkouts = workoutPrefs?.split || NO_SKIPS
  const saveWorkoutPrefs = (next: any) =>
    upsertEntry({ id: `skip-workout-${iso}`, kind: 'skip-workout', date: iso,
      data: { ids: skippedWorkouts, split: splitWorkouts, ...next } })
  const dismissWorkout = (id: string) => {
    if (skippedWorkouts.includes(id)) return
    saveWorkoutPrefs({ ids: [...skippedWorkouts, id] })
  }
  const splitWorkout = (id: string) => {
    if (splitWorkouts.includes(id)) return
    saveWorkoutPrefs({ split: [...splitWorkouts, id] })
  }
  const restoreWorkout = (id: string) => saveWorkoutPrefs({ ids: skippedWorkouts.filter((x: string) => x !== id) })

  /*
   * Logging a measured workout the services already knew about. Lands as an
   * ordinary EXTRA: a ride is something the user also did and should not displace
   * the day's main. `fresh` because two rides in a day are two workouts.
   */
  const logMeasured = (opt: any, out: any, extra: any = {}) => {
    const id = _extraEntryId(iso, opt.id, dayEntries, { fresh: true })
    upsertEntry({ id, kind: 'daily', date: iso, data: {
      ...sessionData(opt, null), out,
      name: _titleFor(opt, out),
      minutes: _minutesFor(opt, out),
      level: _levelFor(opt, out),
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

  // The calendar runs from the first thing the user ever logged.
  const firstLogged = useMemo(() => {
    const dates = entries.filter(e => e.kind === 'daily' && e.date).map(e => e.date).sort()
    return dates[0] || null
  }, [entries])

  // A session put on today or an earlier day is done; on a later day it is
  // planned, and done from its day on (`isDone`). What an existing entry says is
  // kept, a "Mark undone" included. A rest day is done whenever it is chosen.
  const sessionData = (opt: any, prev: any) => {
    const out = prev?.data?.out || {}
    return {
      ...(prev?.data || {}),
      optId: opt.id,
      name: _titleFor(opt, out, prev?.data?.plan),
      minutes: _minutesFor(opt, out),
      level: _levelFor(opt, out),
      done: opt.role === 'rest' ? true : (prev ? prev.data?.done ?? true : (doneWhenPlaced as any)(iso)),
      out,
    }
  }

  const pickMain = (opt: any) =>
    upsertEntry({ id: `daily-${iso}`, kind: 'daily', date: iso,
      data: { ...sessionData(opt, mainEntry), slot: 'main' } })

  /*
   * Extras get their own entry, so they chart, log and edit like any session.
   * `fresh` is "log ANOTHER one of these", only ever offered for a card the plan
   * marks `repeatable` — tapping "add" twice on the hip block is a double tap, not
   * a second session, and `extraEntryId` protects that idempotence. Returns the
   * id it wrote, which is what the caller needs to open it.
   */
  const addExtra = (opt: any, { fresh = false, data = null }: { fresh?: boolean; data?: any } = {}) => {
    const id = _extraEntryId(iso, opt.id, dayEntries, { fresh })
    const prev = fresh ? null : dayEntries.find(e => e.id === id)
    upsertEntry({ id, kind: 'daily', date: iso,
      data: { ...sessionData(opt, prev), ...(data || {}), slot: 'extra' } })
    return id
  }

  /*
   * Saving, removing, "just miles", done, the runner's write and the plan's:
   * the same operations the Log's sheet uses (lib/sessionops.js, #76), so a
   * workout is written one way whichever screen it was opened from. `undoIcon`
   * null: ToastHost's only glyph is Retry's arrow forward, wrong for a step back.
   */
  const ops: any = (sessionOps as any)({ plan, entries, upsertEntry, deleteEntry, toast: pushToast, undoIcon: null })
  const { removeSession, setDone, setTraining, saveOutputs, saveRun, savePlan } = ops

  // The entry a quick-log row on the empty day just placed, opened like the +'s.
  const [placed, setPlaced] = useState<string | null>(null)
  /* A shared workout opened from someone's week (#94, D N4): the owner's own
     sheet, on its day and on their side, the same sheet as a tap on its row. */
  const [sheetFor, setSheetFor] = useState<string | null>(null)
  const openShared = (own: any, personId: string) => {
    rememberSide(own.id, personId)
    if (own.date) setIso(own.date)
    setSheetFor(own.id)
  }


  return (
    <>
      <DayTitle viewIso={iso} today={today} onChange={setIso} />

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
        // The same rows as the + menu (quicklog.tsx), placing on the day being
        // looked at and opening what they placed.
        quick={<QuickLog plan={plan} entries={entries} upsertEntry={upsertEntry} date={iso} onPlaced={setPlaced}
          style={{ alignSelf: 'stretch' }} />}
        onLog={onLog ? () => onLog(iso) : null} onRest={onRest}
        onPlan={onPlan} onUnplace={deleteEntry ? (e: any) => deleteEntry(e.id) : null} />

      {/* Below the day, and compact: how the user arrived, what the services
          recorded that the log lacks, and someone else's day. Each renders
          nothing when it has nothing. */}
      {!isFuture && <WhoopReadiness date={iso} />}
      {!isFuture && <WhoopSleep date={iso} />}

      {!isFuture && (
        <UnloggedWorkouts plan={plan} entries={entries} iso={iso}
          onLog={logMeasured} onMerge={saveOutputs}
          onClimb={onLog ? (item: any) => onLog(iso, { climb: item }) : null}
          skipped={skippedWorkouts} onDismiss={dismissWorkout} onRestore={restoreWorkout}
          split={splitWorkouts} onSplit={splitWorkout} />
      )}

      {/* The owner's window onto someone else's days, to coach without acting as
          them. Nothing for anyone else, while acting, or with one person. */}
      <PeopleDays people={planPeople(currentMe())} date={iso} plan={plan}
        entries={entries} onOpenShared={openShared} />

      {/* Nothing logged yet, nothing to chart: a fresh install's calendar was
          one empty square under "0 days on" (#55). */}
      {firstLogged ? (
        <Card style={{ marginBottom: 0 }}>
          <LoadCalendar days={calendar} start={firstLogged} end={iso} />
        </Card>
      ) : null}
    </>
  )
}

/**
 * The day as the screen's title, with ‹ › beside it (docs/DESIGN.md "Today",
 * #41): the day switcher, no longer a card for two arrows. Backwards is for
 * catching up a session done but never logged; forwards, two weeks at most, is a
 * preview. On the phone the title also swipes, the way a calendar's day view does.
 */
function DayTitle({ viewIso, today, onChange }: { viewIso: string; today: string; onChange: (iso: string) => void }) {
  const max = isoShift(today, 14)
  const shift = (n: number) => {
    const next = isoShift(viewIso, n)
    if (next > max) return
    tap()
    onChange(next)
  }
  // The responder is made once; the latest `shift` is read through a ref.
  const shiftRef = useRef(shift)
  shiftRef.current = shift
  const swipe = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderTerminationRequest: () => false,
    onPanResponderRelease: (_e, g) => {
      if (g.dx <= -48) shiftRef.current(1)
      else if (g.dx >= 48) shiftRef.current(-1)
    },
  })).current

  const words = dayWords(viewIso, today)
  const date = /^(Today|Yesterday|Tomorrow)$/.test(words)
    ? fromIso(viewIso).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
    : null
  return (
    <View {...swipe.panHandlers} style={st.daytitle}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T size={font.screen} weight={600} color={viewIso > today ? colors.inkDim : colors.ink}
          accessibilityRole="header">{words}</T>
        {date ? <T size={font.label} dim style={{ marginTop: 2 }}>{date}</T> : null}
      </View>
      {viewIso !== today && <Btn kind="quiet" title="Today" onPress={() => { tap(); onChange(today) }} />}
      <IconBtn icon="ChevronLeft" size={20} label="Previous day" onPress={() => shift(-1)} />
      <IconBtn icon="ChevronRight" size={20} label="Next day" onPress={() => shift(1)} disabled={isoShift(viewIso, 1) > max} />
    </View>
  )
}

/* Lives in lib/level.js now — it decides whether a day spent a hard finger
   exposure, so it is tested as arithmetic rather than through a tab. */
export { levelFor }

/* Lives in lib/naming.js now — the single reader of their rename (`out.title`).
   `titleFor` is the same question with a prescription in play. */
export { nameFor }

/* Lives in lib/minutes.js now — the input to the training-load chart. */
export { minutesFor }

/** What a row's leading icon says: done, in progress, or not (yet). */
const ROW_STATE: Record<string, { icon: string; label: string; color: string }> = {
  done: { icon: 'CircleCheck', label: 'Done', color: colors.good },
  running: { icon: 'Play', label: 'In progress', color: colors.ink },
  open: { icon: 'Circle', label: 'Not done', color: colors.inkFaint },
}

/**
 * Everything on the day, and nothing that is not: one card of rows (the web's
 * `.list-row`s). The name, one line of what it was (time · distance), and done
 * said once, by the leading icon. Gone in #41: the MAIN/ADDED pill, the tick
 * beside the chevron, the "planned" chip and the dashed "Log another workout",
 * which said what the + beside the dock already does.
 */
function DayList({ rows, onOpen, isFuture, viewIso, onLog = null, onRest = null, onPlan = null, quick = null }: {
  rows: any[]
  onPlan?: (() => void) | null
  onOpen: (key: string) => void
  isFuture: boolean
  viewIso: string
  onLog?: (() => void) | null
  onRest?: (() => void) | null
  quick?: React.ReactNode
}) {
  if (!rows.length) {
    return <EmptyDay isFuture={isFuture} viewIso={viewIso} onLog={onLog} onRest={onRest} onPlan={onPlan} quick={quick} />
  }
  return (
    <Card style={{ paddingVertical: space[1] }}>
      {rows.map((r, i) => {
        const state = ROW_STATE[r.state] || ROW_STATE.open
        return (
          <Press key={r.key} haptic onPress={() => onOpen(r.key)} accessibilityRole="button"
            accessibilityLabel={`${r.name}, ${state.label}${r.meta ? `, ${r.meta}` : ''}`}
            style={[st.row, i > 0 && st.rowDivided]}>
            <Icon name={state.icon} size={20} color={state.color} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <T size={font.body} weight={500} numberOfLines={1}
                color={r.state === 'open' ? colors.inkDim : colors.ink}>{r.name}</T>
              {r.meta ? <T size={font.label} dim tabular numberOfLines={2}>{r.meta}</T> : null}
            </View>
            <Icon name="ChevronRight" size={16} color={colors.inkFaint} />
          </Press>
        )
      })}
    </Card>
  )
}

/**
 * An empty day: what goes here, and the ways to put it there. The quick-log rows
 * first, Log a workout as the one primary for anything else, a rest day as a
 * quiet button. No paragraph: the + is on screen, and planning lives behind it.
 */
function EmptyDay({ isFuture, viewIso, onLog, onRest, onPlan = null, quick }: {
  onPlan?: (() => void) | null
  isFuture: boolean
  viewIso: string
  onLog: (() => void) | null
  onRest: (() => void) | null
  quick: React.ReactNode
}) {
  /* A day still to come is planned, not logged: its one way in, worded with the
     day the planner puts it on (#78, #94 A F8: "Nothing planned yet" was a dead end). */
  if (isFuture) {
    return (
      <Empty style={{ marginBottom: space[3] }}>
        <T size={font.title} weight={600} align="center">Nothing planned yet</T>
        {onPlan ? (
          <View style={{ alignSelf: 'stretch' }}>
            <Btn kind="secondary" title={`Plan a workout for ${dayPhrase(viewIso)}`} onPress={onPlan} />
          </View>
        ) : null}
      </Empty>
    )
  }
  const words = dayWords(viewIso)
  const when = words === 'Today' || words === 'Yesterday' ? words.toLowerCase() : `on ${words}`
  return (
    <Empty style={{ marginBottom: space[3] }}>
      <T size={font.title} weight={600} align="center">{`Nothing logged ${when}`}</T>
      {quick}
      {onLog || onRest ? (
        <View style={{ alignSelf: 'stretch', gap: space[2] }}>
          {onLog ? <Btn title="Log a workout" onPress={onLog} /> : null}
          {onRest ? <Btn kind="quiet" title="Rest day" onPress={onRest} /> : null}
        </View>
      ) : null}
    </Empty>
  )
}


/** The disciplines where "was that actually a workout?" is a real question. */
const CASUAL_DISCIPLINES = ['bike', 'run', 'swim', 'other']

/**
 * The day's sessions, and the layers that open on top of them.
 *
 * What is left of `DailyPicker` after the recommender came off this screen. It
 * no longer ranks, offers, dismisses or explains — it renders the entries on the
 * day and routes taps to the SHEET (reading and logging), WORKOUT MODE (the rep
 * clock, for climbing cards that declare a timer) or the RUNNER (set by set, for
 * anything with a plan). The split is by the ENTRY: a session carrying
 * `data.plan` is a prescription somebody wrote, so it gets the runner.
 */
function DaySessions({
  plan, entries, mainEntry, extraEntries,
  onPickMain, onAddExtra, onRemove, onSaveOutputs, onSaveRun, onSavePlan,
  onSetDone, onSetTraining, viewIso, isFuture, onSaveEntry = null,
  openEntryId = null, onOpened = () => {}, openSheetId = null, onSheetOpened = () => {},
  onLog = null, onRest = null, onPlan = null, quick = null, onUnplace = null,
}: any) {
  const [sheet, setSheet] = useState<string | null>(null)   // row key: 'main' | an extra entry id
  const [workout, setWorkout] = useState<string | null>(null) // same key, training in front of it
  const [workoutSide, setWorkoutSide] = useState<string | null>(null) // whose side a shared workout opens on
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The entry the sheet was opened on because a tap just wrote it (+ → Run, a pick
  // in Log a workout), for the way back when it closes with nothing on it.
  const placed = useRef<string | null>(null)
  /*
   * The Undo a just-placed sheet left on closing, and the entries as they are
   * now (#101 review). Pressed, it removes the workout only if it is STILL just
   * the tap (`placedToUndo`); it goes away once the workout is written on, its
   * sheet is opened again, or this screen goes, so a stale Undo never takes a
   * note typed since with it.
   */
  const undo = useRef<{ id: string; toast: number | null } | null>(null)
  const latest = useRef(entries)
  latest.current = entries
  const dropUndo = () => {
    if (undo.current?.toast != null) dismissToast(undo.current.toast)
    undo.current = null
  }
  useEffect(() => () => dropUndo(), [])
  useEffect(() => { if (sheet) dropUndo() }, [sheet])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const later = (fn: () => void) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(fn, AFTER_SHEET)
  }

  const menu = plan?.dailyMenu || []
  const adjuncts = menu.filter((m: any) => m.role === 'adjunct')

  /*
   * Something just landed from the + button, so open it. Creating an entry and
   * leaving them to find it is a dead end: a blank row the user then has to spot
   * and press. The id round-trips through the app because the button lives
   * floats over every tab rather than living on this screen.
   */
  useEffect(() => {
    if (!openEntryId) return
    const hit = [mainEntry, ...extraEntries].find(e => e?.id === openEntryId)
    if (!hit) return
    const key = hit.id === mainEntry?.id ? 'main' : hit.id
    // A planned session opens straight into the runner. The user pressed "plan a
    // workout" and then "put it on today"; a third tap to start it asks them to
    // confirm something they have already said twice.
    const toRunner = hit.data?.plan && runnable(null, hit.data.plan)
    if (!toRunner) placed.current = hit.id
    later(() => (toRunner ? setWorkout(key) : setSheet(key)))
    onOpened()
  }, [openEntryId, mainEntry?.id, extraEntries.length])

  // The sheet of an entry already on the day (a shared workout opened from
  // someone's week): always the sheet, never the runner, and not a placement.
  // After the week's full screen has gone (one modal at a time).
  useEffect(() => {
    if (!openSheetId) return
    const hit = [mainEntry, ...extraEntries].find(e => e?.id === openSheetId)
    if (!hit) return
    placed.current = null
    const key = hit.id === mainEntry?.id ? 'main' : hit.id
    later(() => setSheet(key))
    onSheetOpened()
  }, [openSheetId, mainEntry?.id, extraEntries.length])

  const logged = optFor(menu, mainEntry?.data?.optId)
  const resting = logged?.role === 'rest'

  /*
   * A workout the user is in the middle of. The run state lives on the entry so
   * closing Bushido mid-session loses nothing — but that is only worth anything
   * if coming back puts them back IN it. Started and not finished.
   */
  const isRunning = (e: any) =>
    Boolean(e?.data?.plan && runnable(null, e.data.plan)
      && e?.data?.run?.startedAt && !e.data.run.endedAt)

  /** "6 of 16 sets" — what a row in progress says instead of its stats. */
  const runLine = (e: any) => {
    if (!e?.data?.plan) return null
    // A circuit on the clock (issue #68): its sets are marked when it ends.
    if (e.data.run?.circuit) return 'Circuit running'
    const p: any = (runProgress as any)(e.data.run, prescriptionSteps(e.data.plan))
    if (!p.total) return null
    return `${p.done} of ${p.total} sets`
  }

  /** "4 of 18 sets": a plan on its day with some sets ticked and some still to do. */
  const inProgress = (e: any) => {
    if (!e?.data?.plan || e.date !== todayIso() || e.data?.run?.endedAt || e.data?.undone === true) return null
    const p: any = (planProgress as any)(e.data.plan)
    return p.done > 0 && p.done < p.total ? `${p.done} of ${p.total} sets` : null
  }

  const extras = extraEntries
    /*
     * `optFor`, NEVER a raw `menu.find` (AGENTS.md §6.2). Sessions logged before
     * the 2026-09-14 rename carry `optId: 'other-training'`, and a row with no
     * card is FILTERED OUT below: fourteen logged workouts once silently vanished
     * from their own day this way.
     */
    .map((e: any) => ({ entry: e, opt: optFor(menu, e.data?.optId) }))
    .filter((x: any) => x.opt)

  const mainOpt = logged || null

  /*
   * A row's one line: what it WAS (time · distance, or what was lifted), never
   * the card's estimate dressed as a fact. A session in progress says where it is,
   * a rest day says why, and one that is not done says so first: "Planned" on a
   * day still to come, "Not done" once marked undone.
   */
  const metaFor = (entry: any, opt: any) => {
    const out = entry.data?.out || {}
    const me = currentMe()
    if (isRunning(entry)) return metaText([runLine(entry), (withLine as any)(entry, me.people)])
    // A plan being done on its sheet, on its day: how far it has got ("4 of 18
    // sets", like a run under way), not what has been logged so far (#94, A F7).
    const going = inProgress(entry)
    if (going) return metaText([going, (withLine as any)(entry, me.people), plannedLine(entry, me)])
    const bits: (string | null)[] = []
    if (!isDone(entry)) bits.push(entry.data?.undone === true ? 'Not done' : 'Planned')
    if (opt.role === 'rest') bits.push(...(restStats as any)(entry, opt))
    else {
      const mins = (loggedMinutes as any)(entry, opt)
      const sets = totalSets(out)
      // A climbing night says what was climbed ("5 routes · hardest 5.10"), the
      // same line as the Log and "last time" (lib/grades.js `climbLine`, #97 F2).
      const work = Number(out.distance) > 0 ? `${out.distance} mi`
        : (climbLine as any)(opt, out) || (liftedLine as any)(entry, liftFieldIn(opt)) || (sets ? `${sets} set${sets === 1 ? '' : 's'}` : null)
      // A planned session nothing has been logged on yet says what it holds.
      if (mins === null && !work && entry.data?.plan) bits.push(prescriptionLine(entry.data.plan))
      else bits.push(mins !== null ? `${mins} min` : null, work)
    }
    // "with Sam" (lib/shared.js), or "planned by Alex" (lib/trainer.js).
    bits.push((withLine as any)(entry, me.people), plannedLine(entry, me))
    return metaText(bits)
  }

  const rowFor = (entry: any, opt: any) => ({
    key: entry.id === mainEntry?.id ? 'main' : entry.id,
    name: _titleFor(opt, entry.data?.out, entry.data?.plan),
    state: isRunning(entry) ? 'running' : isDone(entry) ? 'done' : 'open',
    meta: metaFor(entry, opt),
  })

  const rows = [
    ...(mainEntry && mainOpt ? [rowFor(mainEntry, mainOpt)] : []),
    ...extras.map(({ entry, opt }: any) => rowFor(entry, opt)),
    // Add-ons ticked on an old main session: history, so still listed.
    ...(mainEntry?.data?.adjuncts || [])
      .map((id: string) => adjuncts.find((a: any) => a.id === id))
      .filter(Boolean)
      .map((a: any) => ({ key: `adj-${a.id}`, name: a.name, state: 'done', meta: 'Add-on' })),
  ]

  /** Resolve a row key back to the session and entry it stands for. */
  const resolve = (key: string | null): any => {
    if (!key) return null
    if (key === 'main') {
      return mainEntry && mainOpt
        ? { opt: mainOpt, entry: mainEntry, tone: resting ? 'rest' : null, kind: 'main' }
        : null
    }
    if (key.startsWith('adj-')) {
      const opt = adjuncts.find((a: any) => `adj-${a.id}` === key)
      return opt && { opt, entry: null, tone: null, kind: 'adjunct' }
    }
    const hit = extras.find((x: any) => x.entry.id === key)
    return hit && { opt: hit.opt, entry: hit.entry, tone: hit.opt.role === 'rest' ? 'rest' : null, kind: 'extra' }
  }

  /**
   * Tapping a row. A workout in progress goes back to the runner; a session goes
   * to its sheet. Deciding here keeps `DayList` a list.
   */
  const openRow = (key: string) => {
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
  }, [entries])

  /*
   * Closing the sheet. One a tap just wrote (+ → Run, a pick in Log a workout)
   * and that is closed with nothing put on it says what was logged, with Undo
   * (#94, A F3): before, a mis-tap left a done workout in the streak whose only
   * way back was the bin and a confirm. Anything added makes it a log someone
   * meant, and it closes as any sheet does.
   */
  const closeSheet = (row: any) => {
    const id = placed.current
    placed.current = null
    setSheet(null)
    const entry = row?.entry
    if (!onUnplace || !entry || entry.id !== id) return
    const words = (placedUndoText as any)(entry, row.opt, activityFieldOf(plan))
    if (!words) return
    dropUndo()
    const opt = row.opt
    const toast = pushToast(words, 'info', {
      duration: UNDO_MS,
      action: { label: 'Undo', icon: null, onClick: () => {
        undo.current = null
        const now = (placedToUndo as any)(latest.current, entry.id, opt, activityFieldOf(plan))
        if (now) onUnplace(now)
      } },
    })
    undo.current = { id: entry.id, toast }
  }

  /**
   * Starting a workout is doing the session, so put it on the day if it isn't
   * already. The sheet slides away first; the workout opens behind it.
   */
  const startWorkout = (key: string | null) => (opt: any, side: string | null = null) => {
    const row = resolve(key)
    if (!row) return
    if (!row.entry) (row.kind === 'extra' ? onAddExtra : onPickMain)(opt)
    setSheet(null)
    setWorkoutSide(side)
    later(() => setWorkout(key))
  }

  /*
   * The runner owns the screen completely while the user is training. Checked
   * BEFORE workout mode: a card with both a plan and a declared timer is a
   * planned session that happens to be based on one, and the plan is the thing
   * being followed.
   */
  /*
   * A SHARED workout runs from every side it has (trainer.tsx): the owner flips
   * between the owner's own entry and each other person's copy, each with its own sets,
   * weights, rest clock, done state and writer. Anyone else, and any workout
   * nobody shares, gets exactly the screen it always did.
   */
  const sides = training?.entry ? workoutSides(training.entry, currentMe()) : []
  if (sides.length > 1 && training.entry.data?.plan && runnable(null, training.entry.data.plan)) {
    return (
      <SidesWorkout kind="runner" session={training.opt} sides={sides} ownerEntry={training.entry} onSwitch={(id: string | null) => rememberSide(training.entry.id, id)} entries={entries} initialSide={workoutSide}
        onOwnerRun={(run: any, opts: any) => onSaveRun(training.entry, run, opts)}
        onExit={() => setWorkout(null)} />
    )
  }
  if (sides.length > 1 && !training.entry.data?.plan && hasWorkout(training.opt)) {
    return (
      <SidesWorkout kind="mode" session={training.opt} sides={sides} ownerEntry={training.entry} onSwitch={(id: string | null) => rememberSide(training.entry.id, id)} initialSide={workoutSide}
        onOwnerSave={(out: any) => onSaveOutputs(training.entry, out)}
        onOwnerDone={(v: boolean) => onSetDone(training.entry, v)}
        onExit={() => setWorkout(null)} />
    )
  }

  if (training?.entry?.data?.plan && runnable(null, training.entry.data.plan)) {
    return (
      <WorkoutRunner
        session={training.opt}
        entry={training.entry}
        entries={entries}
        onRun={(run: any, opts: any) => onSaveRun(training.entry, run, opts)}
        onExit={() => setWorkout(null)}
      />
    )
  }

  /*
   * The climbing rep clock. Never for a prescription — that is the runner's job,
   * and a lift-only plan gets neither: `runnable` is the whole of that decision.
   */
  if (training?.entry && !training.entry.data?.plan && hasWorkout(training.opt)) {
    return (
      <WorkoutMode
        session={training.opt}
        entry={training.entry}
        onSave={(out: any) => onSaveOutputs(training.entry, out)}
        onSetDone={(v: boolean) => onSetDone(training.entry, v)}
        onExit={() => setWorkout(null)}
      />
    )
  }

  return (
    <>
      <DayList rows={rows} onOpen={openRow} isFuture={isFuture} viewIso={viewIso}
        onLog={onLog} onPlan={onPlan} quick={quick}
        // The day the user is LOOKING at, so a forgotten rest day can be logged
        // from the day it belongs to. Not a future one — resting is not a plan.
        onRest={onRest && viewIso <= localIso() ? () => onRest(viewIso) : null} />

      {open && (
        <SessionSheet
          opt={open.opt} entry={open.entry} tone={open.tone} entries={entries} isFuture={isFuture} day={viewIso}
          onLog={open.kind === 'adjunct' ? null : open.kind === 'extra' ? onAddExtra : onPickMain}
          onSave={onSaveOutputs}
          onSavePlan={onSavePlan}
          // Closed on removal, so an Undo puts the workout back without reopening it.
          onRemove={open.entry ? (e: any) => { setSheet(null); onRemove(e) } : null}
          onSetDone={onSetDone}
          onSaveEntry={onSaveEntry}
          onStartWorkout={isFuture ? null : startWorkout(sheet)}
          onTraining={open.entry && CASUAL_DISCIPLINES.includes(
            (disciplineFor as any)(open.opt, open.entry.data?.out))
            ? onSetTraining(open.entry, open.opt) : null}
          onClose={() => closeSheet(open)}
        />
      )}
    </>
  )
}

const st = StyleSheet.create({
  // The web's .daytitle: the day as the screen's title, ‹ › beside it.
  daytitle: { flexDirection: 'row', alignItems: 'center', gap: space[1], marginBottom: space[3] },
  // The web's .list-row inside one .card: 52pt, hairlines between.
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 52, paddingVertical: space[2] },
  rowDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
})
