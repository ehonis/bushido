/*
 * Tab renderers (app/src/tabs.jsx). Everything here is driven by the plan file —
 * no training content is hardcoded, so the program can be revised by editing
 * that file with no rebuild.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { PanResponder, StyleSheet, View } from 'react-native'
import { colors, font, space } from '../theme'
import { T } from '../ui/Text'
import { Btn, Card, Empty, IconBtn, Press, Row } from '../ui/kit'
import { Modal } from '../ui/Sheet'
import { success, tap } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { LoadCalendar } from '../lib/viz'
import { SessionView } from './session'
import { SessionLog, PriorNote, DetailsSheet } from './sessionlog'
import { restStats } from '../lib/stats.js'
import { totalSets } from './setlog'
import { liftsLine, liftFieldIn } from '../lib/lifts.js'
import { pushToast, dismissToast } from '../lib/toast'
import { localIso, fromIso } from '../lib/dates.js'
import { isDone, extraEntryId, doneWhenPlaced, markDone } from '../lib/store.js'
import { testEntryFor, testEntryId, testFor } from '../lib/tests.js'
import { WorkoutMode } from './workout'
import { openTimerAfterSheet, timerRequestFor } from './timer'
import { WorkoutRunner } from './runner'
import { PrescriptionEditor, PlanTalk, PlanWhy, liftFieldOf } from './planner'
import { usePlan } from '../lib/planctx.jsx'
import { optFor } from '../lib/menu.js'
import { prescriptionLine, prescriptionSteps, runProgress, isLiftOnly } from '../lib/prescription.js'
import { hasWorkout } from '../lib/workout.js'
import { minutesFor, loggedMinutes, resolveMinutes } from '../lib/minutes.js'
import { levelFor } from '../lib/level.js'
import { nameFor, titleFor, withCasualName } from '../lib/naming.js'
import { disciplineFor, loggedActivity } from '../lib/activities.js'
import { UnloggedWorkouts } from './unlogged'
import { WhoopReadiness, WhoopSleep } from './whoop'
import { currentMe } from '../lib/whoami.js'
import { sharePeople, sharedPeopleOn, withLine, addPerson, removePerson, withSharedPerson, copyExercises, hasExercises, isSynced, withSync } from '../lib/shared.js'
import * as peopleApi from '../lib/peopleapi.js'
import { confirm } from '../ui/menu'
import { WithControl, PersonSwitch, SyncToggle, SharedNote, TheirSide, usePersonCopy, useSide, rememberSide } from './sharedwith'
import { SidesWorkout, PeopleDays, usePersonLog } from './trainer'
import { QuickLog } from './quicklog'
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
  onPlan = null, onLog = null, onRest = null, onViewDay = null,
}: {
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

  // The entry and everything it wrote — including the test result, or the chart
  // would keep a point for a session that is no longer in the log.
  const dropEntry = (entry: any) => {
    deleteEntry?.(entry.id)
    const opt = optFor(menu, entry.data?.optId)
    const test = (testFor as any)(plan, opt)
    if (test && entry.date) deleteEntry?.(testEntryId(entry.date, test.id))
  }

  /*
   * Taking a session off the day is simply removing it, with an Undo. The
   * confirm asks first; the toast is the way back from a wrong answer: Undo
   * writes the entry (and its test result) back as they were.
   */
  const removeSession = (entry: any) => {
    const opt = optFor(menu, entry.data?.optId)
    const test = (testFor as any)(plan, opt)
    const result = test && entry.date
      ? entries.find(e => e.id === testEntryId(entry.date, test.id) && !e.deleted) : null
    dropEntry(entry)
    const live = ({ deleted, ...rest }: any) => rest
    const name = opt ? _titleFor(opt, entry.data?.out, entry.data?.plan) : entry.data?.name
    pushToast(name ? `Removed ${name}` : 'Removed', 'info', {
      duration: 6000,
      // `icon: null`: ToastHost's only glyph is Retry's arrow forward, wrong for a
      // step back, so Undo is the word alone until the host draws `action.icon`.
      action: { label: 'Undo', icon: null, onClick: () => {
        upsertEntry(live(entry))
        if (result) upsertEntry(live(result))
      } },
    })
  }

  // The entry a quick-log row on the empty day just placed, opened like the +'s.
  const [placed, setPlaced] = useState<string | null>(null)

  const setDone = (entry: any, done: boolean) => upsertEntry(markDone(entry, done))

  /*
   * "Just miles", from the day's own sheet. Same write as the Log feed's:
   * `training: false` plus the name it gives itself, which is only ever a BLANK
   * name filled and only ever its own taken back. See lib/naming.js.
   */
  const setTraining = (entry: any, opt: any) => (v: boolean) => {
    const casual = v === false
    const out = (withCasualName as any)(entry.data?.out || {}, { plan, opt, on: casual })
    upsertEntry({ ...entry, data: {
      ...entry.data, out,
      name: _titleFor(opt, out, entry.data?.plan),
      training: casual ? false : undefined,
    } })
  }

  // Outputs attach to their own entry. Sessions that declare `levelFrom` rewrite
  // the day's load level from what you logged.
  const saveOutputs = (entry: any, out: any) => {
    const opt = optFor(menu, entry.data?.optId)
    // `applyOut` (lib/trainer.js), shared with someone else's side of a workout:
    // the level, the name (a PLANNED session is named by its plan, so "Legs" does
    // not become "Lift" on the first slider touch) and `resolveMinutes`.
    upsertEntry(applyOut(entry, opt, out))
    // A session that IS a test writes its result too, so the Testing tab's series
    // comes from the session you actually did. See lib/tests.js.
    const result = (testEntryFor as any)({ plan, session: opt, date: entry.date, out })
    if (result) upsertEntry(result)
  }

  /*
   * Where the user is in a running workout — and, in the SAME write, what that
   * changed about the log.
   *
   * One writer, and it has to be one. The first version had two, each spreading
   * the same stale `entry`, so the second write landed on top of the first and
   * every marked set re-rendered as set one of sixteen with the clock at zero.
   *
   * `out` is null on a rest-clock nudge, which changes the run and nothing else.
   */
  const saveRun = (entry: any, run: any, opts: { out?: any; done?: boolean; plan?: any } = {}) => {
    // The runner adding a set to the plan goes through HERE and not `savePlan`:
    // one tap, one writer. `applyRun` (lib/trainer.js) is the same write someone
    // else's side of the runner makes.
    upsertEntry(applyRun(entry, optFor(menu, entry.data?.optId), run, opts))
  }

  /** Editing the prescription itself — from the sheet, after it has landed. */
  // `applyPlan` (lib/trainer.js): a weight mode switched on the plan reaches its logged row (#58).
  const savePlan = (entry: any, pres: any) => upsertEntry(applyPlan(entry, optFor(menu, entry.data?.optId), pres))

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
        // The same rows as the + menu (quicklog.tsx), placing on the day being
        // looked at and opening what they placed.
        quick={<QuickLog plan={plan} entries={entries} upsertEntry={upsertEntry} date={iso} onPlaced={setPlaced}
          style={{ alignSelf: 'stretch' }} />}
        onLog={onLog ? () => onLog(iso) : null} onRest={onRest} />

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
      <PeopleDays people={planPeople(currentMe())} date={iso} plan={plan} />

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

/** `iso` moved by `n` days, in local days. */
const isoShift = (iso: string, n: number) => {
  const d = fromIso(iso)
  d.setDate(d.getDate() + n)
  return localIso(d)
}

/** A day in words: "Today", "Yesterday", "Tomorrow", else "Sat, Oct 24". */
export function dayWords(iso: string, today: string = localIso()) {
  const offset = Math.round((fromIso(iso).getTime() - fromIso(today).getTime()) / 86400000)
  if (offset === 0) return 'Today'
  if (offset === -1) return 'Yesterday'
  if (offset === 1) return 'Tomorrow'
  return fromIso(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
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
        <T size={font.heading} weight={600} lineHeight={28} color={viewIso > today ? colors.inkDim : colors.ink}
          accessibilityRole="header">{words}</T>
        {date ? <T size={font.small} dim style={{ marginTop: 2 }}>{date}</T> : null}
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

/**
 * "1 exercise · 3 sets · about 45 min · with Sam" that wraps only BETWEEN its
 * pieces: the spaces inside a piece, and before each dot, are non-breaking (the
 * web's `.meta-bit`), so a long line reads as two tidy lines, never "45 / min".
 */
const metaText = (bits: (string | null | undefined)[]) => {
  const parts = bits.filter(Boolean).flatMap((b) => String(b).split(' · '))
  return parts.map((p, i) => p.replace(/ /g, '\u00a0') + (i < parts.length - 1 ? '\u00a0·' : '')).join(' ')
}

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
function DayList({ rows, onOpen, isFuture, viewIso, onLog = null, onRest = null, quick = null }: {
  rows: any[]
  onOpen: (key: string) => void
  isFuture: boolean
  viewIso: string
  onLog?: (() => void) | null
  onRest?: (() => void) | null
  quick?: React.ReactNode
}) {
  if (!rows.length) {
    return <EmptyDay isFuture={isFuture} viewIso={viewIso} onLog={onLog} onRest={onRest} quick={quick} />
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
              {r.meta ? <T size={font.small} dim tabular numberOfLines={2}>{r.meta}</T> : null}
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
function EmptyDay({ isFuture, viewIso, onLog, onRest, quick }: {
  isFuture: boolean
  viewIso: string
  onLog: (() => void) | null
  onRest: (() => void) | null
  quick: React.ReactNode
}) {
  if (isFuture) {
    return <Empty style={{ marginBottom: space[3] }}><T size={font.title} weight={600}>Nothing planned yet</T></Empty>
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

/* --------------------------------------------------------- session sheets */

/*
 * "ADD-ONS FOR THIS SESSION" IS GONE, 2026-09-21. It was never used. Adjuncts
 * already ON an entry still render as rows in the day list, because they are
 * history; nothing offers a new one.
 */

/**
 * Does this session have anything worth running a screen for?
 *
 * A card that declares a timer does (`hasWorkout`). A PRESCRIPTION does, unless
 * it is nothing but lifting: there are no times and lift rest is not prescribed,
 * so the runner would count nothing down. MIXED sessions keep it — the row after
 * the squats is the part worth running.
 */
export function runnable(opt: any, pres: any) {
  if (pres) return !isLiftOnly(pres)
  return hasWorkout(opt)
}

/**
 * One session, opened from the day list. This is the ONLY place the full
 * protocol appears — the dashboard stays a list of names.
 */
export function SessionSheet({
  opt, entry, tone, entries, isFuture,
  onLog, onSave, onSavePlan = null, onRemove, onSetDone, onClose, onStartWorkout,
  onTraining = null, onSaveEntry = null, me = currentMe(),
}: {
  opt: any
  entry?: any
  tone?: string
  entries: any[]
  isFuture?: boolean
  onLog?: ((opt: any) => any) | null
  onSave: (entry: any, out: any) => void
  onSavePlan?: ((entry: any, pres: any) => void) | null
  onRemove?: ((entry: any) => void) | null
  onSetDone?: (entry: any, done: boolean) => void
  onClose: () => void
  onStartWorkout?: ((opt: any, side?: string | null) => void) | null
  onTraining?: ((v: boolean) => void) | null
  onSaveEntry?: ((entry: any) => void) | null
  me?: any
}) {
  // Locks the sheet to the X button once you've touched the form.
  const [dirty, setDirty] = useState(false)
  // The name is its own layer now — a pencil beside the X. See DetailsSheet.
  const [renaming, setRenaming] = useState(false)
  const planned = Boolean(entry)
  const done = planned && isDone(entry)
  // The prescription, if this session has one. Its presence turns the sheet from
  // a protocol you read into a workout you edit.
  const pres = entry?.data?.plan || null
  const thePlan: any = usePlan()
  const liftField = (liftFieldOf as any)(thePlan)

  const save = (out: any) => { setDirty(true); onSave(entry, out) }

  /*
   * SHARED WORKOUTS (sharedwith.tsx, lib/shared.js). `people` is who the owner
   * could add, empty for anyone else, while acting as someone and on a
   * one-person install. `on` is re-derived every render; `side` is the person
   * whose copy the sheet is filling in, by id, or null for the owner's own,
   * remembered per entry on this device. On their side the history is THEIR log.
   */
  const people: any[] = planned && onSaveEntry ? (sharePeople as any)(me) : []
  const on: any[] = people.length
    ? (sharedPeopleOn as any)(entry, me.people).map((p: any) => ({ ...p, tone: (trainerLib.toneFor as any)(people, p.id) }))
    : []
  const [side, setSide] = useSide(entry?.id, on)
  const sidePerson = (side && on.find((p) => p.id === side)) || null
  const theirs = usePersonCopy(sidePerson?.id, sidePerson?.entryId, sidePerson?.name)
  const theirLog = usePersonLog(sidePerson?.id || null)
  const synced = Boolean(sidePerson && isSynced(entry, sidePerson.id))
  const [sharing, setSharing] = useState<{ busy: string | null; error: string | null }>({ busy: null, error: null })
  // The entry as of the latest render: an add or a removal awaits the server.
  const latestEntry = useRef(entry)
  latestEntry.current = entry
  const share = async (verb: string, person: any, run: () => Promise<boolean | void>) => {
    setSharing({ busy: `${verb} ${person.name}…`, error: null })
    try {
      if (await run()) success()
      setSharing({ busy: null, error: null })
    } catch (err: any) {
      setSharing({ busy: null, error: `${person.name}: ${err.message}` })
    }
  }
  const addSomeone = (person: any) => share('Adding', person, async () => {
    const { copy } = await (addPerson as any)({ ownerEntry: latestEntry.current, person, session: opt,
      owner: { id: me.real.id, name: me.real.name }, api: peopleApi })
    onSaveEntry?.(withSharedPerson(latestEntry.current, person.id, copy.id))
    return true
  })
  const removeSomeone = (person: any) => share('Taking off', person, async () => {
    const next = await (removePerson as any)({ ownerEntry: latestEntry.current, person, session: opt, api: peopleApi,
      confirmFn: (q: string) => confirm(q, { confirmLabel: 'Take it out' }) })
    if (!next) return false
    if (side === person.id) setSide(null)
    onSaveEntry?.((withSharedPerson as any)(latestEntry.current, person.id, null, { remove: true }))
    return true
  })
  // Their copy, written like `saveOutputs` writes the owner's. Never a test result.
  const saveTheirs = (out: any) => { setDirty(true); theirs.update((cur: any) => applyOut(cur, opt, out)) }
  const setTheirsDone = (v: boolean) => {
    setDirty(true)
    if (v) success(); else tap()
    theirs.update((cur: any) => markDone(cur, v))
  }
  const theirDone = Boolean(theirs.entry && isDone(theirs.entry))
  /* Their plan, edited from their side: the same write `savePlan` makes on the owner's. */
  const saveTheirPlan = (next: any) => { setDirty(true); theirs.update((cur: any) => applyPlan(cur, opt, next)) }
  const theirPres = theirs.entry?.data?.plan || null
  /* Your exercises onto their side, when you ask (sync off only): added, never their numbers replaced. */
  const canCopy = Boolean(!synced && theirs.entry && copyExercises(theirs.entry, entry) !== theirs.entry)
  /* Sync lives on the owner's link; the server does the keeping-the-same (server/sharedsync.js). */
  const setSync = (person: any, v: boolean) => onSaveEntry?.(withSync(latestEntry.current, person.id, v))
  const copyMine = () => { setDirty(true); theirs.update((cur: any) => copyExercises(cur, latestEntry.current)) }

  /* A write to their log that did not land says so, with the way to send it again.
     It stays only while it is true: the cleanup takes it down when the error
     clears (a later write landed) and when the sheet closes. */
  useEffect(() => {
    if (!theirs.error || !/^Not saved/.test(theirs.error)) return undefined
    const id = pushToast(theirs.error, 'error', { duration: 0,
      action: { label: 'Retry', onClick: () => theirs.update((cur: any) => cur) } })
    return () => { if (id != null) dismissToast(id) }
  }, [theirs.error])

  /*
   * The line under the name: the day, then the time as typed or measured, so the
   * header can never say "45 min" over a typed 29. Never the card's estimate or
   * tier ("any sport · counts anyway"). A planned session not yet timed says what
   * it holds.
   */
  const mins = planned ? (loggedMinutes as any)(entry, opt) : null
  const timed = mins !== null ? `${mins} min` : null
  const subLine = metaText([
    entry?.date ? dayWords(entry.date) : null,
    timed || (pres ? prescriptionLine(pres) : null),
  ])

  /*
   * The footer (docs/DESIGN.md "Session sheet"). Every field saves as typed, so
   * the one thing left to do is close it: that is the primary, unless the session
   * can be started, which is. Beside it, quiet, the rare undo: "Mark undone" on a
   * session done by default (AGENTS.md §4), "Mark done" on one marked undone. A
   * day still to come shows neither.
   */
  const close = <Btn title="Close" flex onPress={onClose} />
  const start = (side: string | null = null) => (
    <Btn icon="Play" title={pres ? 'Start the workout' : 'Start workout'} flex
      onPress={() => { setDirty(true); onStartWorkout?.(opt, side) }} />
  )
  const doneToggle = (isNowDone: boolean, onToggle: () => void, whose = '') => (
    <Btn kind="quiet" title={isNowDone ? `Mark undone${whose}` : `Mark done${whose}`}
      onPress={() => { if (isNowDone) tap(); else success(); onToggle() }} />
  )
  let footer: React.ReactNode
  if (sidePerson) {
    const theirsLive = theirs.entry && !theirs.entry.deleted
    footer = (
      <View style={st.sheetFoot}>
        {!isFuture && theirsLive ? doneToggle(theirDone, () => setTheirsDone(!theirDone), ` for ${sidePerson.name}`) : null}
        {/* Their side starts the same shared workout, on their side of the switcher. */}
        {!isFuture && theirsLive && onStartWorkout && pres && theirPres && runnable(opt, theirPres) && canStart(theirs.entry)
          ? start(sidePerson.id) : close}
      </View>
    )
  } else if (!planned && onLog && !isFuture) {
    // A card opened with nothing on the day yet: putting it there IS the action.
    footer = (
      <View style={st.sheetFoot}>
        <Btn flex title={opt.role === 'rest' ? 'Take a rest day' : 'Add to today'}
          onPress={() => { setDirty(true); onLog(opt) }} />
      </View>
    )
  } else {
    /* A planned session always offers the runner, whatever the CARD declares.
       Not "while not done": today's session is done before it starts. */
    const startable = !isFuture && onLog && onStartWorkout && runnable(opt, pres) && canStart(entry)
    footer = (
      <View style={st.sheetFoot}>
        {planned && !isFuture && onLog ? doneToggle(done, () => { setDirty(true); onSetDone?.(entry, !done) }) : null}
        {startable ? start() : close}
      </View>
    )
  }

  return (
    <Modal
      /*
       * What this session IS, not what the card is called. A planned session is
       * titled by its plan; a card that names itself from what you picked is
       * titled "Mountain bike", not "Log a workout".
       */
      title={String(_titleFor(opt, entry?.data?.out, pres) || opt.name)}
      /* Whose copy this sheet is filling in, in the header so it stays put while the body
         scrolls (the web pins it with position: sticky). Only on a shared workout. */
      sub={on.length ? (
        <View>
          {subLine ? <T size={12} faint style={{ marginTop: 2 }}>{subLine}</T> : null}
          <PersonSwitch on={on} side={sidePerson?.id || null} onSide={setSide} />
        </View>
      ) : subLine || undefined}
      // The activity's own icon, as its row in the Log feed shows it (#55).
      icon={(loggedActivity as any)(opt, entry?.data?.out)?.icon || opt.icon}
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
      {on.map((p) => <SyncToggle key={p.id} person={p} on={isSynced(entry, p.id)} onChange={(v) => setSync(p, v)} />)}

      {/* Who else is on it, and the way to add someone. Owner-only. */}
      {!sidePerson && (
        <WithControl on={on} people={people} busy={sharing.busy} error={sharing.error}
          onAdd={addSomeone} onRemove={removeSomeone} />
      )}
      {/* Everyone else sees, quietly, who it was done with. */}
      {!people.length && planned && <SharedNote entry={entry} people={me.people} />}
      {/* "planned by Alex": quiet, like who it was done with. The entry is theirs now. */}
      {planned && !sidePerson && plannedLine(entry, me) ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 10 }}>
          <Icon name="ClipboardCheck" size={12} color={colors.inkFaint} />
          <T size={12} faint>{plannedLine(entry, me)}</T>
        </View>
      ) : null}

      {sidePerson ? (
        <TheirSide session={opt} copy={theirs.entry} loading={theirs.loading} error={theirs.error}
          person={sidePerson} ownerOut={entry?.data?.out} onSave={saveTheirs} entries={theirLog.entries}
          onCopyMine={canCopy ? copyMine : null} ownerHasExercises={hasExercises(entry)} synced={synced}
          /* A planned session is its plan, on their side as on the owner's: the same
             exercises, with their own numbers, and "last time" from THEIR log. */
          plan={theirPres ? (
            <PrescriptionEditor pres={theirPres} liftField={liftField} entries={theirLog.entries} entryId={theirs.entry?.id}
              categories={thePlan?.quotaCategories || []} onChange={saveTheirPlan} compact />
          ) : null} />
      ) : (<>
      {/* The "MAIN SESSION" / "ADDED SESSION" strap is gone (2026-09-21): it
          restated the tag the row already showed, in the scarcest space here. */}

      {/*
        * A card whose form IS the card puts it first and open: the workout card's
        * "protocol" is boilerplate, and the activity row is the one control that
        * changes what the rest of the form asks.
        */}
      {/* First in the sheet, so `bare`: no divider above it. */}
      {opt.logFirst && !isFuture && planned && (
        <SessionLog session={opt} entry={entry} entries={entries} onSave={save} bare />
      )}

      {/*
        * A PLANNED session shows its own prescription instead of the card's
        * protocol. `why` first: it says what the planner was thinking, which is
        * worth knowing before you change a number in it.
        */}
      {pres ? (
        <>
          {/* Still talkable-to after it lands. The thread lives on the entry. */}
          <PlanTalk pres={pres} compact entries={entries} entryId={entry?.id}
            onChange={(next: any) => { setDirty(true); onSavePlan?.(entry, next) }} />
          <PrescriptionEditor pres={pres} liftField={liftField}
            entries={entries} entryId={entry?.id} categories={thePlan?.quotaCategories || []}
            onChange={(next: any) => { setDirty(true); onSavePlan?.(entry, next) }} compact />
          {pres.notes?.length > 0 && (
            <View style={{ marginTop: 16, gap: 7 }}>
              {pres.notes.map((n: string, i: number) => (
                <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                  <Icon name="Info" size={13} color={colors.inkFaint} style={{ marginTop: 3 }} />
                  <T size={12.5} faint style={{ flex: 1 }}>{n}</T>
                </View>
              ))}
            </View>
          )}
        </>
      ) : (
        <>
          <T size={14} dim>{opt.dose}</T>
          <PriorNote entries={entries} session={opt} excludeId={entry?.id} />
          <SessionView key={opt.id} session={opt} entries={entries} />
        </>
      )}

      {/* Declared by the card. See `logFirst` in plan.json and SessionLog. */}
      {!isFuture && planned && !opt.logFirst && (
        <SessionLog session={opt} entry={entry} entries={entries} onSave={save} />
      )}

      {/*
        * "Log another workout today" came off the sheet on 2026-09-21: the + is
        * one tap from here.
        */}

      {/* Any workout can use a clock; a card that declares one offers it as a
          preset. A tool, so a row at the foot of the sheet. One modal at a time
          on iOS: the sheet goes, then the timer comes. */}
      {!isFuture && onLog && opt.role !== 'rest' ? (
        <View style={st.tools}>
          <Row icon="Timer" label="Interval timer"
            onPress={() => { const req = timerRequestFor(opt, entry); onClose(); openTimerAfterSheet(req) }} />
        </View>
      ) : null}

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
 * FULLSCREEN SESSION MODE IS GONE, 2026-09-21. It was the third way to look at
 * the same session and the one nothing pointed at, so every fix had to be made
 * twice. `FullScreen` itself stays for the planner, the pickers, workout mode
 * and the runner.
 */

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
  openEntryId = null, onOpened = () => {},
  onLog = null, onRest = null, quick = null,
}: any) {
  const [sheet, setSheet] = useState<string | null>(null)   // row key: 'main' | an extra entry id
  const [workout, setWorkout] = useState<string | null>(null) // same key, training in front of it
  const [workoutSide, setWorkoutSide] = useState<string | null>(null) // whose side a shared workout opens on
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
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
    later(() => (toRunner ? setWorkout(key) : setSheet(key)))
    onOpened()
  }, [openEntryId, mainEntry?.id, extraEntries.length])

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
    const p: any = (runProgress as any)(e.data.run, prescriptionSteps(e.data.plan))
    if (!p.total) return null
    return `${p.done} of ${p.total} sets`
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
    const bits: (string | null)[] = []
    if (!isDone(entry)) bits.push(viewIso > localIso() ? 'Planned' : 'Not done')
    if (opt.role === 'rest') bits.push(...(restStats as any)(entry, opt))
    else {
      const mins = (loggedMinutes as any)(entry, opt)
      const sets = totalSets(out)
      const work = Number(out.distance) > 0 ? `${out.distance} mi`
        : (liftsLine as any)(out, liftFieldIn(opt)) || (sets ? `${sets} set${sets === 1 ? '' : 's'}` : null)
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
    const row = resolve(key)
    if (row?.entry && isRunning(row.entry)) setWorkout(key)
    else setSheet(key)
  }

  const open = resolve(sheet)
  const training = workout ? resolve(workout) : null

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
        onLog={onLog} quick={quick}
        // The day the user is LOOKING at, so a forgotten rest day can be logged
        // from the day it belongs to. Not a future one — resting is not a plan.
        onRest={onRest && viewIso <= localIso() ? () => onRest(viewIso) : null} />

      {open && (
        <SessionSheet
          opt={open.opt} entry={open.entry} tone={open.tone} entries={entries} isFuture={isFuture}
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
          onClose={() => setSheet(null)}
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
  // The sheet's foot: the one primary, the quiet undo beside it.
  sheetFoot: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[2] },
  tools: { marginTop: space[4], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
})
