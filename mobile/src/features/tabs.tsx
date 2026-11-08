/*
 * Today (the tab): app/src/tabs.jsx, native. The day's rows and their sheets are
 * daylist.tsx, the web's daylist.jsx (#98: this file held both).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { PanResponder, StyleSheet, View } from 'react-native'
import { colors, font, space } from '../theme'
import { T } from '../ui/Text'
import { Btn, Card, IconBtn } from '../ui/kit'
import { tap } from '../ui/haptics'
import { LoadCalendar } from '../lib/viz'
import { pushToast } from '../lib/toast'
import { localIso, fromIso, isoShift, dayWords, dayLong } from '../lib/dates.js'
import { isDone, extraEntryId, doneWhenPlaced } from '../lib/store.js'
import { sessionOps } from '../lib/sessionops.js'
import { minutesFor } from '../lib/minutes.js'
import { levelFor } from '../lib/level.js'
import { titleFor } from '../lib/naming.js'
import { UnloggedWorkouts } from './unlogged'
import { WhoopReadiness, WhoopSleep } from './whoop'
import { currentMe } from '../lib/whoami.js'
import { rememberSide } from './sharedwith'
import { PeopleDays } from './trainer'
import { QuickLog } from './quicklog'
import * as trainerLib from '../lib/trainer.js'
import { DaySessions } from './daylist'


// Default parameters in the ported JS narrow TypeScript's inference (mobile/AGENTS.md).
const { planPeople } = trainerLib as any

// The lib is the web's JS; its default-parameter destructuring makes TypeScript
// infer narrower types than the functions take, so they are called through these.
const _titleFor = titleFor as any
const _extraEntryId = extraEntryId as any
const _levelFor = levelFor as any
const _minutesFor = minutesFor as any

const todayIso = () => localIso()
/* Stable identity, so "nothing dismissed" is not a new array on every render. */
const NO_SKIPS: string[] = []

/*
 * iOS will not present a full-screen modal while a page sheet is still sliding
 * away, so a layer that replaces another (the sheet's "Start workout", or a
 * session the + button just placed while its own sheet closes) opens after it.
 */

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
    ? dayLong(viewIso, today)
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

const st = StyleSheet.create({
  // The web's .daytitle: the day as the screen's title, ‹ › beside it.
  daytitle: { flexDirection: 'row', alignItems: 'center', gap: space[1], marginBottom: space[3] },
})
