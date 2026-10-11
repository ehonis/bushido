/*
 * Tab renderers (app/src/tabs.jsx). Everything here is driven by the plan file —
 * no training content is hardcoded, so the program can be revised by editing
 * that file with no rebuild.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { PanResponder, StyleSheet, View } from 'react-native'
import { colors, mix } from '../theme'
import { T } from '../ui/Text'
import { Btn, Card, Chip, Field, H2, Press } from '../ui/kit'
import { Modal } from '../ui/Sheet'
import { Fold } from '../ui/Fold'
import { success, tap } from '../ui/haptics'
import { Icon, VERDICT_ICONS } from '../lib/icons'
import { LineChart, LoadCalendar, SERIES } from '../lib/viz'
import { SessionView } from './session'
import { resolveCeiling, cfPctOfMax, cfBand, CF_CORRECTION_KG, CF_PCT_MVC_MEAN, CF_PCT_MVC_SD, CF_NOISE_PCT } from '../lib/force.js'
import { Blurb } from './blurb'
import { SessionLog, PriorNote, DetailsSheet } from './sessionlog'
import { sessionStats } from '../lib/stats.js'
import { localIso, fromIso } from '../lib/dates.js'
import { progress as quotaProgress, mondayOf, weekDays, shiftWeek, quotaCounts, quotaEntry, suggest, buildQuotaEntry } from '../lib/quota.js'
import { isDone, isRepeatable, repeatLabel, extraEntryId } from '../lib/store.js'
import { testEntryFor, testEntryId, testFor } from '../lib/tests.js'
import { WorkoutMode } from './workout'
import { WorkoutRunner } from './runner'
import { QuotaBars } from './quotabars'
import { PrescriptionEditor, PlanTalk, PlanWhy, liftFieldOf } from './planner'
import { usePlan } from '../lib/planctx.jsx'
import { optFor } from '../lib/menu.js'
import { prescriptionLine, prescriptionSteps, runProgress, isLiftOnly } from '../lib/prescription.js'
import { hasWorkout } from '../lib/workout.js'
import { minutesFor, resolveMinutes } from '../lib/minutes.js'
import { levelFor } from '../lib/level.js'
import { nameFor, titleFor, withCasualName } from '../lib/naming.js'
import { disciplineFor } from '../lib/activities.js'
import { Journal } from './journal'
import { UnloggedWorkouts } from './unlogged'
import { achievements, unclaimed } from '../lib/achievements.js'
import { profileFacts } from '../lib/profile.js'
import { WhoopReadiness, WhoopSleep } from './whoop'
import { DayStepper } from './app'
import { NumInput } from './numinput'

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
 * So Today is two things and nothing else:
 *
 *   1. WHERE THE WEEK STANDS — the quota bars. A reading, not an offer.
 *   2. WHAT IS ACTUALLY ON THE DAY — sessions the user planned or logged, and
 *      nothing the user did not. An empty day renders as an empty day.
 *
 * Adding to the day lives on the + button. `lib/recommend.js` is still on disk
 * and still tested; nothing on this screen reads it.
 */
export function TodayTab({
  plan, entries, upsertEntry, deleteEntry,
  settings = {}, saveSettings = () => {},
  openEntryId = null, onOpened = () => {},
  onPlan = null, onLog = null, onPickSession = null, onRest = null, onSetWeek = null,
}: {
  plan: any
  entries: any[]
  upsertEntry: (e: any) => void
  deleteEntry?: (id: string) => void
  settings?: any
  saveSettings?: (patch: any) => void
  openEntryId?: string | null
  onOpened?: () => void
  onPlan?: (() => void) | null
  onLog?: (() => void) | null
  onPickSession?: (() => void) | null
  onRest?: ((iso?: string) => void) | null
  onSetWeek?: (() => void) | null
}) {
  const today = todayIso()
  const [iso, setIso] = useState(today)
  /*
   * An entry the WEEK asked to open, as opposed to one the + button just created.
   * Kept apart from `openEntryId` because they want different screens: a session
   * just planned opens straight into the runner, one tapped on a quota bar to
   * look at opens its sheet.
   */
  const [openFromWeek, setOpenFromWeek] = useState<string | null>(null)
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

  // Putting a session on the day does NOT complete it — that is a separate tap.
  // A rest day is the exception: choosing it is the whole action.
  const sessionData = (opt: any, prev: any) => {
    const out = prev?.data?.out || {}
    return {
      ...(prev?.data || {}),
      optId: opt.id,
      name: _titleFor(opt, out, prev?.data?.plan),
      minutes: _minutesFor(opt, out),
      level: _levelFor(opt, out),
      done: opt.role === 'rest' ? true : (prev?.data?.done ?? false),
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

  const setDone = (entry: any, done: boolean) =>
    upsertEntry({ ...entry, data: { ...entry.data, done } })

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
    upsertEntry({ ...entry, data: {
      ...entry.data, out,
      level: _levelFor(opt, out),
      // A PLANNED session is named by its plan; "Legs" must not become "Lift" the
      // first time the user touches the effort slider.
      name: _titleFor(opt, out, entry.data?.plan),
      // `resolveMinutes`, not `minutesFor`: a correction made before
      // `out.minutesSpent` existed lives on the entry itself. See lib/minutes.js.
      minutes: _resolveMinutes(entry.data, opt, out),
    } })
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
  const saveRun = (entry: any, run: any, { out = null, done = undefined, plan = null }: { out?: any; done?: boolean; plan?: any } = {}) => {
    const opt = optFor(menu, entry.data?.optId)
    const data = { ...entry.data, run }
    // The runner adding a set to the plan goes through HERE and not `savePlan`:
    // one tap, one writer.
    if (plan) { data.plan = plan; data.name = _titleFor(opt, data.out || {}, plan) }
    if (out) {
      data.out = out
      data.level = _levelFor(opt, out)
      data.minutes = _resolveMinutes(entry.data, opt, out)
    }
    if (done !== undefined) data.done = done
    upsertEntry({ ...entry, data })
  }

  /** Editing the prescription itself — from the sheet, after it has landed. */
  const savePlan = (entry: any, pres: any) =>
    upsertEntry({ ...entry, data: { ...entry.data, plan: pres, name: pres.title || entry.data?.name } })

  return (
    <>
      <DayNav viewIso={iso} today={today} onChange={setIso} plan={plan} />

      {/* Where the week stands. A reading — nothing here is pressable into a
          session. Pressing what filled a bar opens THAT session, on its own day. */}
      <QuotaBars plan={plan} entries={entries} iso={iso} onSetWeek={onSetWeek}
        onOpenEntry={(date: string, id: string) => { setIso(date); setOpenFromWeek(id) }} />

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

      {/* How the user arrived. Renders nothing when there is no reading. */}
      {!isFuture && <WhoopReadiness date={iso} />}
      {!isFuture && <WhoopSleep date={iso} />}

      {/* What the services recorded and the log has no entry for. Renders
          nothing on a day with nothing outstanding — see unlogged.tsx. */}
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
function DayList({ rows, onOpen, onPlan, onLog, onPickSession, onRest = null, isFuture, repeats = [], onAddAgain = null }: {
  rows: any[]
  onOpen: (key: string) => void
  onPlan?: (() => void) | null
  onLog?: (() => void) | null
  onPickSession?: (() => void) | null
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
                {'Plan one and it arrives with the sets already written; log one you have already done; pick one of the plan’s own sessions, protocol and all; or take the day off on purpose. All of it also lives on the '}
                <T size={13} weight={700} color={colors.ink}>+</T>
                {' button.'}
              </T>
              <View style={st.emptyActs}>
                {onPlan && <Btn icon="Sparkles" title="Plan a workout" onPress={onPlan} />}
                {onLog && <Btn kind="ghost" icon="NotebookPen" title="Log a workout" onPress={onLog} />}
                {onPickSession && <Btn kind="ghost" icon="Layers" title="Pick from the plan" onPress={onPickSession} />}
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
  onTraining = null,
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
  onStartWorkout?: ((opt: any) => void) | null
  onTraining?: ((v: boolean) => void) | null
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
      sub={pres ? prescriptionLine(pres) : `${opt.minutes} min · ${opt.tier}`}
      icon={opt.icon}
      tone={tone}
      dismissable={!dirty}
      onClose={onClose}
      /* The name, one layer up: a rename is a thing you do TO the session you are
         looking at, so it belongs where the session's title is. */
      onRename={planned && !isFuture ? () => setRenaming(true) : null}
      onDelete={onRemove && entry ? () => onRemove(entry) : null}
      deleteLabel="Remove from today"
      footer={!onLog ? (
        note('An add-on rides along with your main session — tick it there.')
      ) : isFuture ? (
        note('Preview only — come back on the day to log it.')
      ) : (
        <View style={st.sheetActions}>
          {/* A planned session always offers the runner, whether or not the CARD
              declares a timer — what it walks is the prescription on the entry. */}
          {onStartWorkout && runnable(opt, pres) && !done && (
            <Btn icon="Play" title={pres ? 'Start the workout' : 'Start workout'} style={st.action}
              onPress={() => { setDirty(true); onStartWorkout(opt) }} />
          )}
          <DoneButton opt={opt} planned={planned} done={done}
            onLog={() => { setDirty(true); onLog(opt) }}
            onSetDone={(v) => { setDirty(true); onSetDone?.(entry, v) }} />
        </View>
      )}
    >
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
    </Modal>
  )
}

/**
 * Completion, made explicit. Adding a session to the day and completing it are
 * two different acts — conflating them silently marked the habit done for
 * workouts that were only ever swapped in.
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
      <T size={15} weight={600} color={fg}>{done ? 'Done — tap to undo' : 'Mark as done'}</T>
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
  onSetDone, onSetTraining, viewIso, isFuture,
  openEntryId = null, openAs = 'auto', onOpened = () => {},
  onPlan = null, onLog = null, onPickSession = null, onRest = null,
}: any) {
  const [sheet, setSheet] = useState<string | null>(null)   // row key: 'main' | an extra entry id
  const [workout, setWorkout] = useState<string | null>(null) // same key, training in front of it
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
   * beside the coach bubble rather than on this screen.
   */
  useEffect(() => {
    if (!openEntryId) return
    const hit = [mainEntry, ...extraEntries].find(e => e?.id === openEntryId)
    if (!hit) return
    const key = hit.id === mainEntry?.id ? 'main' : hit.id
    // A planned session opens straight into the runner. The user pressed "plan a
    // workout" and then "put it on today"; a third tap to start it asks them to
    // confirm something they have already said twice.
    const toRunner = openAs !== 'sheet' && hit.data?.plan && runnable(null, hit.data.plan)
    later(() => (toRunner ? setWorkout(key) : setSheet(key)))
    onOpened()
  }, [openEntryId, openAs, mainEntry?.id, extraEntries.length])

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
  const startWorkout = (key: string | null) => (opt: any) => {
    const row = resolve(key)
    if (!row) return
    if (!row.entry) (row.kind === 'extra' ? onAddExtra : onPickMain)(opt)
    setSheet(null)
    later(() => setWorkout(key))
  }

  /*
   * The runner owns the screen completely while the user is training. Checked
   * BEFORE workout mode: a card with both a plan and a declared timer is a
   * planned session that happens to be based on one, and the plan is the thing
   * being followed.
   */
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
        onPlan={onPlan} onLog={onLog} onPickSession={onPickSession}
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

/* ------------------------------------------------------------------- week */

/*
 * The Week tab: where the quotas are written. It replaced the week-by-week plan
 * on 2026-09-14 — eleven dated weeks counting down to a trip that was not
 * happening. The week is something the user writes; the app's only jobs are to
 * copy last week forward and to show what filled it.
 *
 *   - The user writes them. `suggest()` offers; nothing is written without a tap.
 *   - Misses expire on Sunday. No debt, no carry-over, no guilt.
 *   - A quota counts WORKOUTS, not days. A day with a ride and a lift fills two.
 */
export function WeekTab({ plan, entries, upsertEntry }: { plan: any; entries: any[]; upsertEntry: (e: any) => void }) {
  const today = todayIso()
  const [monday, setMonday] = useState(() => mondayOf(today))
  const week: any = useMemo(() => (quotaProgress as any)({ plan, entries, iso: monday }), [plan, entries, monday])
  const stored: any = useMemo(() => (quotaCounts as any)(entries, monday), [entries, monday])
  // The reasoning, if this week was planned with the AI. A week set by hand has
  // none, and shows none.
  const planned: any = useMemo(() => (quotaEntry as any)(entries, monday)?.data || null, [entries, monday])
  const offer: any = useMemo(() => (suggest as any)({ plan, entries, iso: monday }), [plan, entries, monday])

  // What is in the boxes. Seeded from what the user has SET, never from the
  // suggestion — a pre-filled number whose provenance is invisible gets
  // confirmed without being read. Taking the offer is a tap.
  const [draft, setDraft] = useState<Record<string, number> | null>(null)
  const counts: Record<string, number> = draft ?? stored
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(stored)

  const set = (key: string, n: number) => {
    const next = { ...counts }
    if (n > 0) next[key] = n
    else delete next[key]
    setDraft(next)
  }
  // Keep the provenance the week planner wrote — moving one stepper by hand
  // does not un-explain the rest of the week.
  const save = () => {
    const { counts: _c, ...extra } = planned || {}
    upsertEntry((buildQuotaEntry as any)(monday, counts, extra))
    setDraft(null)
    success()
  }
  const shift = (n: number) => { setMonday((m: string) => (shiftWeek as any)(m, n)); setDraft(null) }

  const isThisWeek = monday === mondayOf(today)
  const label = `${fromIso(monday).toLocaleDateString([], { month: 'short', day: 'numeric' })} – ` +
    `${fromIso((weekDays as any)(monday)[6]).toLocaleDateString([], { month: 'short', day: 'numeric' })}`

  const achs: any[] = useMemo(
    () => (achievements as any)(plan, entries, (profileFacts as any)(entries)), [plan, entries])
  const catsOf = (a: any) => (plan?.quotaCategories || []).filter((c: any) => a.categories.includes(c.key))
  const ungrouped: any[] = useMemo(() => (unclaimed as any)(plan, achs), [plan, achs])

  // On a phone the category blurb is hidden: worth the room on a desktop, not
  // the three lines it costs here.
  const Row = (c: any) => {
    const state = week.byKey[c.key] || { done: 0 }
    const n = counts[c.key] || 0
    return (
      <View key={c.key} style={st.quotarow}>
        <View style={{ width: 22 }}><Icon name={c.icon} size={16} color={colors.inkFaint} /></View>
        <T size={14} weight={600} color={state.complete ? colors.good : colors.ink} numberOfLines={2} style={{ flex: 1, minWidth: 0 }}>{c.name}</T>
        <T size={11} dim accessibilityLabel="what you have actually logged this week">
          {state.done > 0 ? `${state.done} done` : ''}
        </T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Press haptic onPress={() => set(c.key, Math.max(0, n - 1))} disabled={!n}
            accessibilityRole="button" accessibilityLabel={`one fewer ${c.name}`} style={st.qbtn}>
            <Icon name="Minus" size={14} />
          </Press>
          <T size={17} tabular align="center" style={{ minWidth: 30 }}>{n ? String(n) : '–'}</T>
          <Press haptic onPress={() => set(c.key, n + 1)}
            accessibilityRole="button" accessibilityLabel={`one more ${c.name}`} style={st.qbtn}>
            <Icon name="Plus" size={14} />
          </Press>
        </View>
      </View>
    )
  }

  const group = (key: string, icon: string, name: string, blurb: string | null, rows: any[], first: boolean) => (
    <View key={key} style={{ marginTop: first ? 8 : 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Icon name={icon} size={15} />
        <T size={14} weight={600} style={{ flex: 1 }}>{name}</T>
      </View>
      {blurb ? <T size={13} dim style={{ marginBottom: 10 }}>{blurb}</T> : null}
      {rows.map(Row)}
    </View>
  )

  return (
    <>
      <View style={st.daynav}>
        <Press haptic onPress={() => shift(-1)} accessibilityRole="button" accessibilityLabel="previous week" style={st.daynavArrow}>
          <T size={20} dim>‹</T>
        </Press>
        <T size={14} weight={600} align="center" style={{ flex: 1 }}>
          {label}
          {isThisWeek && <T size={14} dim style={{ fontStyle: 'italic' }}> · this week</T>}
        </T>
        <Press haptic onPress={() => shift(1)} accessibilityRole="button" accessibilityLabel="next week" style={st.daynavArrow}>
          <T size={20} dim>›</T>
        </Press>
      </View>

      <Card>
        <H2>{planned?.title || 'What this week asks for'}</H2>
        <T size={13} dim style={{ marginBottom: 14 }}>
          {'A quota is a count of '}
          <T size={13} weight={600} color={colors.ink}>workouts</T>
          {', not days — a day you ride and lift fills two. Nothing is assigned to a weekday; you decide that as the week goes. Whatever is left on Sunday expires rather than carrying over.'}
        </T>

        {planned?.why && <PlanWhy text={planned.why} />}

        {!week.isSet && offer.source !== 'empty' && (
          <Press haptic onPress={() => setDraft(offer.counts)} accessibilityRole="button" style={st.restbtn}>
            <Icon name="Repeat" size={17} color={colors.inkFaint} />
            <T size={14} faint>
              {offer.source === 'last-week'
                ? 'Copy last week’s quotas forward'
                : 'Start from what you actually did last week'}
            </T>
          </Press>
        )}

        {achs.map((a, i) => group(a.id, a.icon, a.name, a.blurb || null, catsOf(a), i === 0))}

        {ungrouped.length > 0 && group('__none', 'Sparkles', 'Nothing in particular',
          'Claimed by none of your achievements. It still counts and it still shows up.', ungrouped, !achs.length)}

        <View style={st.quotafoot}>
          <T size={13} dim style={{ flexShrink: 1 }}>
            {`${Object.values(counts).reduce((a, b) => a + b, 0)} workouts asked for`}
            {week.isSet && ` · ${week.doneTotal} of ${week.plannedTotal} filled`}
          </T>
          <Btn title={week.isSet ? 'Update the week' : 'Set the week'} onPress={save} disabled={!dirty} />
        </View>
      </Card>

      {(plan?.rules || []).length > 0 && (
        <Blurb id="rules" title="When life happens" tone="card">
          <T size={13} dim style={{ marginBottom: 14 }}>The plan is supposed to bend. These are the rules for bending it.</T>
          <View>
            {plan.rules.map((r: any, i: number) => (
              <View key={i} style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                <T size={14} faint>•</T>
                <T size={14} dim style={{ flex: 1 }}>
                  <T size={14} weight={600} color={colors.ink}>{r.when}</T>
                  {` — ${r.then}`}
                </T>
              </View>
            ))}
          </View>
        </Blurb>
      )}

      <Blurb id="exposure" title={plan?.exposureBudget?.title || 'The finger budget'} tone="card">
        <T size={13} dim>{plan?.exposureBudget?.body}</T>
      </Blurb>
    </>
  )
}

/* ---------------------------------------------------------------- testing */

export function TestingTab({ plan, entries = [], upsertEntry }: { plan: any; entries?: any[]; upsertEntry: (e: any) => void; deleteEntry?: (id: string) => void }) {
  const [active, setActive] = useState<string | null>(null)
  const tests = plan?.tests || []

  // The starter content has no benchmark tests; a plan that defines some fills this in.
  if (!tests.length && !(plan?.testingNotes || []).length) {
    return (
      <Card>
        <H2>No tests in this plan</H2>
        <T size={13} dim>
          Benchmark tests come from the training plan. The example plan in Settings has six.
        </T>
      </Card>
    )
  }

  return (
    <>
      {(plan?.testingNotes || []).map((n: any, i: number) => (
        <Blurb key={i} id={`testnote-${i}`} title={n.title}>
          <T size={13} dim>{n.body}</T>
        </Blurb>
      ))}

      {tests.map((t: any) => {
        const results = entries
          .filter(e => e.kind === 'test' && e.data?.testId === t.id)
          .sort((a, b) => a.date.localeCompare(b.date))
        return (
          <Card key={t.id}>
            <H2>{t.name}</H2>
            <T size={13} dim style={{ marginBottom: 14 }}>{t.why}</T>

            {t.metrics.map((m: any, mi: number) => {
              const pts = results
                .filter(r => Number.isFinite(Number(r.data?.[m.key])))
                .map(r => ({ x: r.date, y: Number(r.data[m.key]) }))
              return pts.length ? (
                <LineChart key={m.key} points={pts} label={m.label} unit={m.unit || ''}
                  color={SERIES[mi % SERIES.length]} goal={m.goal} />
              ) : null
            })}

            {t.id === 'critical-force' && <CeilingReadout entries={entries} />}

            <Btn kind="ghost" style={{ marginTop: 10 }} title={active === t.id ? 'close' : 'run this test'}
              onPress={() => setActive(active === t.id ? null : t.id)} />

            {active === t.id && <TestRunner test={t} onSave={upsertEntry} onDone={() => setActive(null)} />}
          </Card>
        )
      })}
    </>
  )
}

/** .deflist: a two-column definition list, label left, prose right. */
function Def({ dt, children }: { dt: string; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: 14 }}>
      <T size={12} faint style={{ width: 96, paddingTop: 2 }}>{dt}</T>
      <T size={13} style={{ flex: 1 }}>{children}</T>
    </View>
  )
}

/**
 * What the critical-force test actually buys you: a number in kilograms to set
 * the gauge to. Before it was computed here it had to be re-derived by hand from
 * the last result every time, which is how a session ends up trained at the
 * wrong intensity for weeks.
 */
function CeilingReadout({ entries }: { entries: any[] }) {
  const c: any = (resolveCeiling as any)(entries)
  if (!c) return null

  const round = (n: number) => Math.round(n * 10) / 10
  const pct = (cfPctOfMax as any)(c)
  const band = (cfBand as any)(pct)

  return (
    <View style={st.ceiling}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 12 }}>
        <Icon name="Gauge" size={14} color={colors.inkFaint} />
        <T size={11} caps faint style={{ flex: 1 }}>Your sub-threshold ceiling</T>
        <T size={11} faint>{`tested ${c.date}`}</T>
      </View>

      <View style={{ flexDirection: 'row', gap: 22, flexWrap: 'wrap', marginBottom: 14 }}>
        <View style={{ gap: 2 }}>
          <T size={30} weight={700} lineHeight={32} tabular>{String(round(c.ceiling))}</T>
          <T size={11} faint>kg ceiling</T>
        </View>
        <View style={{ gap: 2 }}>
          <T size={30} weight={700} lineHeight={32} tabular color={colors.accent}>{String(round(c.ceiling - 2))}</T>
          <T size={11} faint>kg — unilateral target</T>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <Def dt="How">
          {c.cfMin != null
            ? `CFmin ${round(c.cfMin)} kg vs CF ${round(c.cf)} − ${CF_CORRECTION_KG} = ${round(c.corrected)} kg. The lower one binds${c.bound === 'cfmin' ? ' — that is CFmin' : ' — that is the corrected CF'}.`
            : `CF ${round(c.cf)} kg − ${CF_CORRECTION_KG} = ${round(c.corrected)} kg. Log CFmin from the same test and this uses whichever is lower.`}
        </Def>
        {pct != null && (
          <Def dt="CF vs your max">
            {`${pct}% of ${round(c.mvc)} kg. Climbers average ${CF_PCT_MVC_MEAN} ± ${CF_PCT_MVC_SD}% (Fryer 2019), so `}
            {band === 'below' ? 'this sits below that band — the endurance-limited pattern this whole block targets.'
              : band === 'above' ? 'this sits above that band, which is not the pattern this block assumes.'
              : 'this sits inside the normal band.'}
          </Def>
        )}
        <Def dt="Trust">
          {`One test. Test-retest CV for this protocol is ${CF_NOISE_PCT}% (McClean 2023), so treat anything inside roughly ±${round(c.cf * (CF_NOISE_PCT / 100))} kg as unchanged until a third test agrees.`}
        </Def>
      </View>
    </View>
  )
}

/** .runner-sec: a small-caps heading and its body. */
function RunnerSec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 18 }}>
      <T size={12} caps faint style={{ marginBottom: 7 }}>{title}</T>
      {children}
    </View>
  )
}

function TestRunner({ test, onSave, onDone }: { test: any; onSave: (e: any) => void; onDone: () => void }) {
  const [vals, setVals] = useState<Record<string, any>>({})
  const [date, setDate] = useState(todayIso)

  const save = () => {
    const data: any = { testId: test.id }
    for (const m of test.metrics) if (vals[m.key] !== '' && vals[m.key] != null) data[m.key] = Number(vals[m.key])
    onSave({ kind: 'test', date, data })
    success()
    onDone()
  }

  return (
    <View style={st.runner}>
      <RunnerSec title="Equipment">
        <T size={14}>{test.equipment}</T>
      </RunnerSec>

      <RunnerSec title="Procedure">
        <View style={{ gap: 7 }}>
          {test.procedure.map((s: string, i: number) => (
            <View key={i} style={{ flexDirection: 'row', gap: 6 }}>
              <T size={14} dim tabular style={{ width: 18 }}>{`${i + 1}.`}</T>
              <T size={14} style={{ flex: 1 }}>{s}</T>
            </View>
          ))}
        </View>
      </RunnerSec>

      {test.cautions?.length > 0 && (
        <RunnerSec title="Don't">
          {test.cautions.map((c: string, i: number) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
              <T size={14} faint>•</T>
              <T size={14} dim style={{ flex: 1 }}>{c}</T>
            </View>
          ))}
        </RunnerSec>
      )}

      <RunnerSec title="Result">
        <Field label="Date" style={{ marginBottom: 10 }}>
          <DayStepper value={date} max={todayIso()} onChange={setDate} />
        </Field>
        {test.metrics.map((m: any) => (
          <Field key={m.key} label={`${m.label} ${m.unit ? `(${m.unit})` : ''}`} style={{ marginBottom: 10 }}>
            <NumInput value={vals[m.key] ?? ''} blank="" placeholder={m.hint || ''}
              onChange={(v: any) => setVals(prev => ({ ...prev, [m.key]: v }))} />
          </Field>
        ))}
        <Btn title="Save result" onPress={save} />
      </RunnerSec>

      {test.interpretation && (
        <RunnerSec title="Reading the number">
          <T size={14}>{test.interpretation}</T>
        </RunnerSec>
      )}
    </View>
  )
}

/* -------------------------------------------------------------------- why */

const VERDICT_COLORS: Record<string, string> = {
  supported: colors.vizGood,
  mixed: colors.vizWarn,
  refuted: colors.vizCrit,
}

export function WhyTab({ plan }: { plan: any }) {
  const [filter, setFilter] = useState('all')
  const items = (plan?.evidence || []).filter((e: any) => filter === 'all' || e.verdict === filter)

  return (
    <>
      {plan?.exposureBudget && (
        <Blurb id="exposure-budget" title={plan.exposureBudget.title}>
          <T size={13} dim style={{ marginBottom: plan.exposureBudget.disagreement ? 12 : 0 }}>
            {plan.exposureBudget.body}
          </T>
          {plan.exposureBudget.disagreement && (
            <Fold summary="Where my sources disagreed" style={{ borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10 }}>
              <T size={13} dim style={{ marginTop: 6 }}>{plan.exposureBudget.disagreement}</T>
            </Fold>
          )}
        </Blurb>
      )}

      {plan?.reframe && (
        <Blurb id="reframe" title={plan.reframe.title}>
          <T size={13} dim>{plan.reframe.body}</T>
        </Blurb>
      )}

      <Card>
        <H2>What the evidence actually says</H2>
        <T size={13} dim style={{ marginBottom: items.length ? 0 : 12 }}>
          Every claim below was checked against primary sources, and the shaky ones were handed to agents whose
          job was to refute them. Where the honest answer is &ldquo;nobody knows,&rdquo; it says so.
        </T>
        {!items.length && (
          <T size={13} dim>
            {'The standalone evidence index was removed on 2026-09-14 with the rest of the dated block. Nothing was lost: every session still carries its own graded '}
            <T size={13} weight={600} color={colors.ink}>transfer</T>
            {' and '}
            <T size={13} weight={600} color={colors.ink}>summary</T>
            {', which is where these claims were actually read. Open any session and expand '}
            <T size={13} dim style={{ fontStyle: 'italic' }}>the evidence</T>
            {'.'}
          </T>
        )}
      </Card>

      {items.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {['all', 'supported', 'mixed', 'refuted'].map(f => (
            <Chip key={f} label={f} on={filter === f} onPress={() => setFilter(f)} />
          ))}
        </View>
      )}

      {items.map((e: any, i: number) => {
        const c = VERDICT_COLORS[e.verdict] || colors.inkDim
        return (
          <Card key={i}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginBottom: 7 }}>
              <View style={[st.badge, { borderColor: c }]}>
                <Icon name={VERDICT_ICONS[e.verdict]} size={12} color={c} />
                <T size={10} caps color={c} lineHeight={13}>{e.verdict}</T>
              </View>
              <T size={14} weight={600} style={{ flex: 1 }}>{e.claim}</T>
            </View>
            <T size={14} dim>{e.reality}</T>
            {e.doThis && (
              <T size={14} style={{ marginTop: 9 }}>
                <T size={14} weight={600}>So:</T>{` ${e.doThis}`}
              </T>
            )}
            {e.sources?.length > 0 && (
              <T size={12} faint style={{ marginTop: 9 }}>{e.sources.join(' · ')}</T>
            )}
          </Card>
        )
      })}
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
  quotarow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: colors.line,
  },
  qbtn: {
    width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.line, borderRadius: 10,
  },
  quotafoot: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
    marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.line,
  },
  restbtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    marginBottom: 14, padding: 14, minHeight: 44,
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, borderRadius: 10,
  },
  ceiling: {
    marginTop: 14, padding: 14, backgroundColor: colors.panel2,
    borderWidth: 1, borderColor: colors.line, borderLeftWidth: 3, borderLeftColor: colors.series3, borderRadius: 9,
  },
  runner: { marginTop: 14, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 14 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: 4, paddingVertical: 3, paddingHorizontal: 7,
  },
})
