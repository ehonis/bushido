/*
 * Tab renderers (app/src/tabs.jsx). Everything here is driven by the plan file —
 * no training content is hardcoded, so the program can be revised by editing
 * that file with no rebuild.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { PanResponder, StyleSheet, View } from 'react-native'
import { colors, mix } from '../theme'
import { T } from '../ui/Text'
import { Btn, Card, H2, Press } from '../ui/kit'
import { Modal } from '../ui/Sheet'
import { success, tap } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { LoadCalendar } from '../lib/viz'
import { SessionView } from './session'
import { SessionLog, PriorNote, DetailsSheet } from './sessionlog'
import { sessionStats } from '../lib/stats.js'
import { localIso, fromIso } from '../lib/dates.js'
import { isDone, isRepeatable, repeatLabel, extraEntryId, doneWhenPlaced, markDone } from '../lib/store.js'
import { testEntryFor, testEntryId, testFor } from '../lib/tests.js'
import { WorkoutMode } from './workout'
import { openTimerAfterSheet, timerRequestFor } from './timer'
import { WorkoutRunner } from './runner'
import { PrescriptionEditor, PlanTalk, PlanWhy, liftFieldOf } from './planner'
import { usePlan } from '../lib/planctx.jsx'
import { optFor } from '../lib/menu.js'
import { prescriptionLine, prescriptionSteps, runProgress, isLiftOnly } from '../lib/prescription.js'
import { hasWorkout } from '../lib/workout.js'
import { minutesFor, resolveMinutes } from '../lib/minutes.js'
import { levelFor } from '../lib/level.js'
import { nameFor, titleFor, withCasualName } from '../lib/naming.js'
import { disciplineFor } from '../lib/activities.js'
import { UnloggedWorkouts } from './unlogged'
import { WhoopReadiness, WhoopSleep } from './whoop'
import { currentMe } from '../lib/whoami.js'
import { sharePeople, sharedPeopleOn, withLine, addPerson, removePerson, withSharedPerson, copyExercises, hasExercises, isSynced, withSync } from '../lib/shared.js'
import * as peopleApi from '../lib/peopleapi.js'
import { confirm } from '../ui/menu'
import { WithControl, PersonSwitch, SyncToggle, SharedNote, TheirSide, usePersonCopy, useSide, rememberSide } from './sharedwith'
import { SidesWorkout, PeopleDays, usePersonLog } from './trainer'
import * as trainerLib from '../lib/trainer.js'

// Default parameters in the ported JS narrow TypeScript's inference (mobile/AGENTS.md).
const { applyOut, applyRun, canStart, workoutSides, planPeople, plannedLine } = trainerLib as any

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
   * Taking a session off the day is simply removing it. It used to also record a
   * dismissal for the recommender; with nothing offering anything, that entry
   * kind has no reader and would be litter in a synced log.
   */
  const removeSession = (entry: any) => dropEntry(entry)

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
  const savePlan = (entry: any, pres: any) =>
    upsertEntry({ ...entry, data: { ...entry.data, plan: pres, name: pres.title || entry.data?.name } })

  return (
    <>
      <DayNav viewIso={iso} today={today} onChange={setIso} plan={plan} />

      <DaySessions plan={plan} entries={entries}
        mainEntry={mainEntry} extraEntries={extraEntries}
        onPickMain={pickMain} onAddExtra={addExtra} onRemove={removeSession}
        onSaveOutputs={saveOutputs} onSaveRun={saveRun} onSavePlan={savePlan}
        onSetDone={setDone} onSetTraining={setTraining}
        onSaveEntry={upsertEntry}
        viewIso={iso} isFuture={isFuture}
        openEntryId={openEntryId}
        onOpened={onOpened}
        onPlan={onPlan} onLog={onLog ? () => onLog(iso) : null} onRest={onRest} />

      {/* The owner's window onto someone else's days, to coach without acting as
          them. Nothing for anyone else, while acting, or with one person. */}
      <PeopleDays people={planPeople(currentMe())} date={iso} plan={plan} />

      {/* How the user arrived. Renders nothing when there is no reading. */}
      {!isFuture && <WhoopReadiness date={iso} />}
      {!isFuture && <WhoopSleep date={iso} />}

      {/* What the services recorded and the log has no entry for. Renders
          nothing on a day with nothing outstanding — see unlogged.tsx. */}
      {!isFuture && (
        <UnloggedWorkouts plan={plan} entries={entries} iso={iso}
          onLog={logMeasured} onMerge={saveOutputs}
          onClimb={onLog ? (item: any) => onLog(iso, { climb: item }) : null}
          skipped={skippedWorkouts} onDismiss={dismissWorkout} onRestore={restoreWorkout}
          split={splitWorkouts} onSplit={splitWorkout} />
      )}

      <Card style={{ marginBottom: 0 }}>
        <LoadCalendar days={calendar} start={firstLogged || iso} end={iso} />
      </Card>
    </>
  )
}

/**
 * Move between days. Backwards is for catching up a session you did but never
 * logged; forwards is preview only — you cannot have done tomorrow's work.
 *
 * On the phone the header also swipes: left for the next day, right for the
 * previous, the way a calendar's day view does. The arrows stay.
 */
function DayNav({ viewIso, today, onChange, plan }: { viewIso: string; today: string; onChange: (iso: string) => void; plan: any }) {
  const shift = (n: number) => {
    const d = fromIso(viewIso)
    d.setDate(d.getDate() + n)
    const next = localIso(d)
    const first = plan?.weeks?.[0]?.start
    const maxAhead = fromIso(today); maxAhead.setDate(maxAhead.getDate() + 14)
    if (first && next < first) return
    if (next > localIso(maxAhead)) return
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

  const offset = Math.round((fromIso(viewIso).getTime() - fromIso(today).getTime()) / 86400000)
  const label = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : offset === -1 ? 'Yesterday'
    : offset > 0 ? `In ${offset} days` : `${Math.abs(offset)} days ago`
  const weekday = fromIso(viewIso).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })

  return (
    <View {...swipe.panHandlers} style={[st.daynav, offset > 0 && st.daynavFuture]}>
      <Press onPress={() => shift(-1)} accessibilityRole="button" accessibilityLabel="Previous day" style={st.daynavArrow}>
        <Icon name="ChevronLeft" size={18} color={colors.inkDim} />
      </Press>
      <View style={{ flex: 1, minWidth: 0, alignItems: 'center' }}>
        <T size={14} weight={600} lineHeight={17} color={offset > 0 ? colors.inkDim : colors.ink}>{label}</T>
        <T size={12} faint>{weekday}</T>
      </View>
      <Press onPress={() => shift(1)} accessibilityRole="button" accessibilityLabel="Next day" style={st.daynavArrow}>
        <Icon name="ChevronRight" size={18} color={colors.inkDim} />
      </Press>
      {offset !== 0 && (
        <Press haptic onPress={() => onChange(today)} accessibilityRole="button" style={st.daynavToday}>
          <T size={12} dim>today</T>
        </Press>
      )}
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

/** The tone colours of .t-rec / .t-extra / .t-rest / .t-adj: [edge, icon and tag]. */
const ROW_TONE: Record<string, [string, string]> = {
  rec: [colors.accent, colors.accent],
  extra: [colors.series3, colors.series3],
  rest: [colors.series1, colors.load3],
  adj: [colors.line, colors.ink],
}

/**
 * Everything you are doing today, and nothing you are not.
 *
 * The rows used to mix what was on the day, what the week still owed and what
 * the engine also recommended. Two of those are gone, so every row is something
 * the user put there — which is what lets every row carry a completion circle
 * without reading as a checklist you are behind on.
 */
function DayList({ rows, onOpen, onPlan, onLog, onRest = null, isFuture, repeats = [], onAddAgain = null }: {
  rows: any[]
  onOpen: (key: string) => void
  onPlan?: (() => void) | null
  onLog?: (() => void) | null
  onRest?: (() => void) | null
  isFuture: boolean
  repeats?: any[]
  onAddAgain?: ((optId: string) => void) | null
}) {
  return (
    <Card>
      <H2 style={{ marginBottom: 10 }}>Your day</H2>

      {!rows.length && (
        <View style={{ paddingTop: 6, paddingBottom: 2 }}>
          <T size={14} dim style={{ marginBottom: 6 }}>Nothing on today yet.</T>
          {!isFuture && (onPlan || onLog) && (
            <>
              <T size={13} dim>
                {'Plan one and it arrives with the sets already written; log one you have already done, a climbing session from the plan or anything else; or take the day off on purpose. All of it also lives on the '}
                <T size={13} weight={700} color={colors.ink}>+</T>
                {' button.'}
              </T>
              <View style={st.emptyActs}>
                {onPlan && <Btn icon="Sparkles" title="Plan a workout" onPress={onPlan} />}
                {onLog && <Btn kind="ghost" icon="NotebookPen" title="Log a workout" onPress={onLog} />}
                {onRest && <Btn kind="ghost" icon="Sunset" title="Log a rest day" onPress={onRest} />}
              </View>
            </>
          )}
          {isFuture && <T size={13} dim>Plan something for it, or come back on the day.</T>}
        </View>
      )}

      {rows.length > 0 && (
        <View style={{ gap: 8 }}>
          {rows.map(r => {
            const [edge, ink] = ROW_TONE[r.tone] || [colors.line, colors.ink]
            // "not done yet" on a row that already says "6 of 16 sets" is the same
            // fact twice, and the second one reads as nagging.
            const stats = [...(r.stats?.length ? r.stats : [r.tier]), r.done || r.running ? null : 'not done yet']
              .filter(Boolean).join(' · ')
            return (
              <Press key={r.key} haptic onPress={() => onOpen(r.key)} accessibilityRole="button"
                style={[st.dlRow, { borderLeftColor: edge }, r.tone === 'adj' && { opacity: 0.8 }]}>
                <Icon name={r.icon} size={16} color={ink} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                    <T size={r.tone === 'adj' ? 13 : 14} weight={r.tone === 'adj' ? 500 : 600} lineHeight={18}
                      color={r.done ? colors.ink : colors.inkDim} style={{ flexShrink: 1 }}>{r.name}</T>
                    {/* The tag already says "In progress" on a workout mid-way
                        through, so the chip stays "planned". */}
                    {r.planned && (
                      <View style={[st.planned, r.running && { backgroundColor: colors.accent }]}>
                        <T size={9.5} weight={700} caps lineHeight={12} color={r.running ? colors.bg : colors.accent}>planned</T>
                      </View>
                    )}
                  </View>
                  <T size={12} faint tabular style={{ marginTop: 2 }}>{stats}</T>
                  {r.with ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                      <Icon name="Users" size={11} color={colors.inkFaint} />
                      <T size={11} faint>{r.with}</T>
                    </View>
                  ) : null}
                  {r.by ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                      <Icon name="ClipboardCheck" size={11} color={colors.inkFaint} />
                      <T size={11} faint>{r.by}</T>
                    </View>
                  ) : null}
                </View>
                <View style={st.tag}><T size={10} caps lineHeight={13} color={r.tone === 'adj' ? colors.inkFaint : ink}>{r.tag}</T></View>
                <Icon name={r.done ? 'CircleCheck' : 'Circle'} size={15} color={r.done ? colors.vizGood : colors.inkFaint} />
                <Icon name="ChevronRight" size={15} color={colors.inkFaint} />
              </Press>
            )
          })}
        </View>
      )}

      {/*
        * A SECOND one of a card that can be logged twice, in one tap, from the day
        * itself. Shown only once one is already on the day: before that the +
        * button is the way in.
        */}
      {!isFuture && onAddAgain && repeats.map(r => (
        <Press key={r.optId} haptic onPress={() => onAddAgain(r.optId)} accessibilityRole="button" style={st.again}>
          <Icon name="Plus" size={15} color={colors.accent} />
          <T size={13} color={colors.accent}>{r.label}</T>
          {r.count > 1 && <T size={10} caps faint style={{ marginLeft: 4 }}>{`${r.count} on today`}</T>}
        </Press>
      ))}
    </Card>
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
  const saveTheirs = (out: any) => { setDirty(true); theirs.update((cur: any) => ({ ...cur, data: {
    ...cur.data, out, level: levelFor(opt, out), name: titleFor(opt, out, cur.data?.plan),
    minutes: resolveMinutes(cur.data, opt, out) } })) }
  const setTheirsDone = (v: boolean) => {
    setDirty(true)
    if (v) success(); else tap()
    theirs.update((cur: any) => markDone(cur, v))
  }
  const theirDone = Boolean(theirs.entry && isDone(theirs.entry))
  /* Their plan, edited from their side: the same write `savePlan` makes on the owner's. */
  const saveTheirPlan = (next: any) => { setDirty(true); theirs.update((cur: any) => ({ ...cur, data: {
    ...cur.data, plan: next, name: next.title || cur.data?.name } })) }
  const theirPres = theirs.entry?.data?.plan || null
  /* Your exercises onto their side, when you ask (sync off only): added, never their numbers replaced. */
  const canCopy = Boolean(!synced && theirs.entry && copyExercises(theirs.entry, entry) !== theirs.entry)
  /* Sync lives on the owner's link; the server does the keeping-the-same (server/sharedsync.js). */
  const setSync = (person: any, v: boolean) => onSaveEntry?.(withSync(latestEntry.current, person.id, v))
  const copyMine = () => { setDirty(true); theirs.update((cur: any) => copyExercises(cur, latestEntry.current)) }

  const note = (text: string) => (
    <View style={{ flex: 1, flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
      <Icon name="Info" size={13} color={colors.inkDim} style={{ marginTop: 3 }} />
      <T size={13} dim style={{ flex: 1 }}>{text}</T>
    </View>
  )

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
          <T size={12} faint style={{ marginTop: 2 }}>{pres ? prescriptionLine(pres) : `${opt.minutes} min · ${opt.tier}`}</T>
          <PersonSwitch on={on} side={sidePerson?.id || null} onSide={setSide} />
        </View>
      ) : pres ? prescriptionLine(pres) : `${opt.minutes} min · ${opt.tier}`}
      icon={opt.icon}
      tone={tone}
      dismissable={!dirty}
      onClose={onClose}
      /* The name, one layer up: a rename is a thing you do TO the session you are
         looking at, so it belongs where the session's title is. */
      onRename={planned && !isFuture && !sidePerson ? () => setRenaming(true) : null}
      onDelete={onRemove && entry && !sidePerson ? () => onRemove(entry) : null}
      deleteLabel="Remove from today"
      footer={sidePerson ? (
        isFuture ? note('Preview only — come back on the day to log it.')
          : theirs.entry && !theirs.entry.deleted ? (
            <View style={st.sheetActions}>
              {/* Their side starts the same shared workout, on their side of the switcher. */}
              {onStartWorkout && pres && theirPres && runnable(opt, theirPres) && canStart(theirs.entry) && (
                <Btn icon="Play" title="Start the workout" style={st.action}
                  onPress={() => { setDirty(true); onStartWorkout(opt, sidePerson.id) }} />
              )}
              <Btn kind={theirDone ? 'ghost' : 'primary'} icon={theirDone ? 'CircleCheck' : 'Circle'} style={st.action}
                title={theirDone ? `Done for ${sidePerson.name} · Mark undone` : `Mark done for ${sidePerson.name}`}
                onPress={() => setTheirsDone(!theirDone)} />
            </View>
          ) : null
      ) : !onLog ? (
        note('An add-on rides along with your main session — tick it there.')
      ) : isFuture ? (
        note('Preview only — come back on the day to log it.')
      ) : (
        <View style={st.sheetActions}>
          {/* A planned session always offers the runner, whether or not the CARD
              declares a timer — what it walks is the prescription on the entry.
              Not "while not done": today's session is done before it starts. */}
          {onStartWorkout && runnable(opt, pres) && (!planned || canStart(entry)) && (
            <Btn icon="Play" title={pres ? 'Start the workout' : 'Start workout'} style={st.action}
              onPress={() => { setDirty(true); onStartWorkout(opt) }} />
          )}
          <DoneButton opt={opt} planned={planned} done={done}
            onLog={() => { setDirty(true); onLog(opt) }}
            onSetDone={(v) => { setDirty(true); onSetDone?.(entry, v) }} />
          {/* Any workout can use a clock. A card that declares one offers it as a
              preset. One modal at a time on iOS: the sheet goes, then the timer comes. */}
          {opt.role !== 'rest' && (
            <Btn icon="Timer" kind="secondary" title="Interval timer" style={st.action}
              onPress={() => { const req = timerRequestFor(opt, entry); onClose(); openTimerAfterSheet(req) }} />
          )}
        </View>
      )}
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
      {opt.logFirst && !isFuture && planned && (
        <SessionLog session={opt} entry={entry} entries={entries} onSave={save} defaultOpen />
      )}

      {/*
        * A PLANNED session shows its own prescription instead of the card's
        * protocol. `why` first: it says what the planner was thinking, which is
        * worth knowing before you change a number in it.
        */}
      {pres ? (
        <>
          {/* Still talkable-to after it lands. The thread lives on the entry. */}
          <PlanTalk pres={pres} compact
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
        * "Log another workout today" came off the sheet on 2026-09-21 — the day
        * list's own button and the + are both one tap from here.
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
      </>)}
    </Modal>
  )
}

/**
 * Done, and the way to say it was not. A session on today or an earlier day is
 * done by default (AGENTS.md §4), so the control's job is mostly "Mark undone":
 * a workout the user skipped, which then stays undone however many days pass.
 * "Mark done" puts it back.
 */
function DoneButton({ opt, planned, done, onLog, onSetDone }: {
  opt: any
  planned: boolean
  done: boolean
  onLog: () => void
  onSetDone: (v: boolean) => void
}) {
  if (!planned) {
    return <Btn title={opt.role === 'rest' ? 'Take a rest day' : 'Add to today'} style={st.action} onPress={onLog} />
  }
  const fg = done ? colors.vizGood : colors.onAccent
  return (
    <Press
      onPress={() => { if (done) tap(); else success(); onSetDone(!done) }}
      accessibilityRole="button"
      accessibilityState={{ checked: done }}
      style={[st.doneBtn, st.action, done
        ? { backgroundColor: 'transparent', borderColor: mix(colors.vizGood, 40, colors.line) }
        : { backgroundColor: colors.accent, borderColor: colors.accent }]}>
      <Icon name={done ? 'CircleCheck' : 'Circle'} size={16} color={fg} />
      <T size={15} weight={600} color={fg}>{done ? 'Done · Mark undone' : 'Mark done'}</T>
    </Press>
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
  onPlan = null, onLog = null, onRest = null,
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

  /** Log a SECOND one of a repeatable card, and open it. */
  const addAnother = (opt: any) => {
    if (!opt) return
    const id = onAddExtra(opt, { fresh: true })
    setSheet(id || null)
  }

  // How many of it are on the day, MAIN INCLUDED — a run as the day's main and a
  // lift on top is two of the same card.
  const onDayCount = (id: string) =>
    (mainEntry?.data?.optId === id ? 1 : 0) + extras.filter((x: any) => x.opt.id === id).length

  const repeats = menu
    .filter((m: any) => isRepeatable(m) && !m.retired && onDayCount(m.id) > 0)
    .map((m: any) => ({ optId: m.id, label: repeatLabel(m), count: onDayCount(m.id) }))

  /*
   * "And another one", from the day. For an ordinary session that is a second
   * entry of the same card. For a CONTAINER — the planned card, the workout card
   * — a blank one is a card with its whole question unanswered, so
   * `sched.repeatVia` names the screen that asks the question instead.
   */
  const addAgain = (optId: string) => {
    const opt = menu.find((m: any) => m.id === optId)
    const via = opt?.sched?.repeatVia
    if (via === 'plan' && onPlan) return onPlan()
    if (via === 'log' && onLog) return onLog()
    return addAnother(opt)
  }

  const mainOpt = logged || null

  const rowFor = (entry: any, opt: any, { tag, tone }: { tag: string; tone: string }) => ({
    key: entry.id === mainEntry?.id ? 'main' : entry.id,
    icon: opt.icon,
    name: _titleFor(opt, entry.data?.out, entry.data?.plan),
    tier: opt.tier,
    tag: isRunning(entry) ? 'In progress' : tag,
    tone,
    planned: Boolean(entry.data?.plan),
    running: isRunning(entry),
    done: isDone(entry),
    // Who else was on it, if anyone: "with Sam". See lib/shared.js.
    with: (withLine as any)(entry, currentMe().people),
    // A session the owner planned for this person: "planned by Alex". lib/trainer.js.
    by: plannedLine(entry, currentMe()),
    // A session in progress says where it is rather than what it added up to.
    stats: isRunning(entry) ? [runLine(entry)].filter(Boolean) : (sessionStats as any)(entry, opt),
  })

  const rows = [
    ...(mainEntry && mainOpt
      ? [rowFor(mainEntry, mainOpt, { tag: resting ? 'Rest' : 'Main', tone: resting ? 'rest' : 'rec' })]
      : []),
    ...extras.map(({ entry, opt }: any) => rowFor(entry, opt, { tag: 'Added', tone: 'extra' })),
    ...(mainEntry?.data?.adjuncts || [])
      .map((id: string) => adjuncts.find((a: any) => a.id === id))
      .filter(Boolean)
      .map((a: any) => ({ key: `adj-${a.id}`, icon: a.icon, name: a.name, tier: a.tier,
        tag: 'Add-on', tone: 'adj', planned: false, done: true, stats: [] })),
  ]

  /** Resolve a row key back to the session and entry it stands for. */
  const resolve = (key: string | null): any => {
    if (!key) return null
    if (key === 'main') {
      return mainEntry && mainOpt
        ? { opt: mainOpt, entry: mainEntry, tone: resting ? 'rest' : 'rec', kind: 'main' }
        : null
    }
    if (key.startsWith('adj-')) {
      const opt = adjuncts.find((a: any) => `adj-${a.id}` === key)
      return opt && { opt, entry: null, tone: 'adj', kind: 'adjunct' }
    }
    const hit = extras.find((x: any) => x.entry.id === key)
    return hit && { opt: hit.opt, entry: hit.entry, tone: 'extra', kind: 'extra' }
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
      <DayList rows={rows} onOpen={openRow} isFuture={isFuture}
        onPlan={onPlan} onLog={onLog}
        // The day the user is LOOKING at, so a forgotten rest day can be logged
        // from the day it belongs to. Not a future one — resting is not a plan.
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
  daynav: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 10,
    padding: 6, marginBottom: 14,
  },
  daynavFuture: { borderStyle: 'dashed', borderColor: colors.inkFaint },
  daynavArrow: { width: 44, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  daynavToday: {
    borderWidth: 1, borderColor: colors.line, borderRadius: 999,
    paddingVertical: 5, paddingHorizontal: 10, minHeight: 32, justifyContent: 'center',
  },
  emptyActs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  dlRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderLeftWidth: 3,
    borderRadius: 8, paddingVertical: 11, paddingHorizontal: 12, minHeight: 44,
  },
  planned: {
    marginLeft: 7, paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999,
    backgroundColor: mix(colors.accent, 14, colors.panel2),
  },
  tag: { backgroundColor: colors.panel, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  again: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 10, minHeight: 44, borderWidth: 1, borderColor: colors.line, borderRadius: 8,
  },
  sheetActions: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  action: { flexGrow: 1, flexBasis: 150 },
  doneBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderRadius: 8, paddingVertical: 11, paddingHorizontal: 16, minHeight: 44,
  },
  restbtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    marginBottom: 14, padding: 14, minHeight: 44,
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, borderRadius: 10,
  },
})
