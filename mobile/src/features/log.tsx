/*
 * The log: every workout, newest first. (app/src/log.jsx)
 *
 * Rebuilt 2026-09-15. The climbing-only quick-log is gone rather than moved:
 * bodyweight is on the profile and a max hang is logged by the session that IS
 * that test. A second way in was a second thing to keep honest. Charts moved to
 * their own tab — they answer a different question.
 *
 * THE FEED IS WORKOUTS, not entries. Bodyweight, notes, tests and skips are all
 * real entries and none of them belongs in a list of things the user did.
 *
 * Since wave 2 (issue #43) it is one card per DAY with each workout a row: name,
 * one line of time and distance, a chevron. The row opens the sheet; gear, effort
 * and WHOOP/Strava are read there, not repeated on every row.
 *
 * Since #81 the filter asks what Progress asks: the kind of thing first
 * (lib/scope.js), the plan's categories inside it, and under Climbing a whole
 * grade. A climbing row says what was climbed (lib/grades.js `climbLine`).
 *
 * Native: a row swipes left to remove it (through the same confirmation the
 * sheet's bin uses), and tapping opens the session as a page sheet.
 */
import React, { useMemo, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable'
import { colors, font, radius, space } from '../theme'
import { T } from '../ui/Text'
import { Btn, Chip, Divider, Empty, Press, Row, SectionHeader, s as kit } from '../ui/kit'
import { confirm, showMenu } from '../ui/menu'
import { impact, tap } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { restStats } from '../lib/stats.js'
import { optFor } from '../lib/menu.js'
import { SessionSheet } from './sheet'
import { isDone, isTraining } from '../lib/store.js'
import { loggedMinutes } from '../lib/minutes.js'
import { fromIso, localIso, dayWords } from '../lib/dates.js'
import { categoryOf, disciplineOf } from '../lib/category.js'
import { loggedActivity } from '../lib/activities.js'
import { titleFor } from '../lib/naming.js'
import { sessionOps } from '../lib/sessionops.js'
import { pushToast } from '../lib/toast'
import { withLine } from '../lib/shared.js'
import { plannedLine } from '../lib/trainer.js'
import { currentMe } from '../lib/whoami.js'
import { climbLine, bandsOf, bandLabel } from '../lib/grades.js'
import { ACTIVITY_SCOPES, activityScopeOf } from '../lib/scope.js'
import { ChipRow, ScreenTitle, SubFilter, SubChip, subFilterLabel } from './filters'
import { Explain } from './blurb'

const todayIso = () => (localIso as any)()

const fmt1 = (n: number) => Math.round(n * 10) / 10

// The copy of the sheet's delete confirmation, shared with the swipe so both
// ways out say the same thing.
const DELETE_LABEL = 'Delete this workout'
const DELETE_BODY = 'It goes out of the log, out of your training load and off the streak. The measurement it carries goes with it.'

/** A day's header: "Today", "Yesterday", then "Fri, Oct 23": the app's one way to write a day (lib/dates.js). */
const dayLabel = (iso: string, today: string) => dayWords(iso, today)

/**
 * The one line under a workout's name: how long, then how far, as on Today's
 * rows. Effort is in the sheet; on a row it was a bare "RPE 5".
 */
function statsOf(entry: any, opt: any) {
  const out = entry.data?.out || {}
  const st: string[] = []
  // Typed or measured only, as Today's rows (lib/minutes.js); never the card's estimate.
  const mins = (loggedMinutes as any)(entry, opt)

  if (mins !== null) st.push(`${mins} min`)
  // What was climbed, said once: the count and the hardest send (lib/grades.js).
  const climbed = opt ? (climbLine as any)(opt, out) : ''
  if (climbed) st.push(climbed)
  if (Number(out.distance) > 0) st.push(`${fmt1(Number(out.distance))} mi`)
  if (Number(out.poolDistance) > 0) st.push(`${Math.round(Number(out.poolDistance))} yd`)
  const lifts = Array.isArray(out.lifts) ? out.lifts.length : 0
  if (lifts) st.push(`${lifts} exercise${lifts === 1 ? '' : 's'}`)
  return st
}

/**
 * What a workout is called on its row. The card's own name is the button that
 * made it ("Log a workout"), so one with no activity picked yet is a workout.
 */
function rowName(opt: any, entry: any) {
  if (!opt) return entry.data?.name || 'Workout'
  const name = (titleFor as any)(opt, entry.data?.out, entry.data?.plan)
  return opt.categoryFrom === 'activity' && name === opt.name ? 'Workout' : name
}

export function LogTab({ plan, entries, upsertEntry, deleteEntry, onLog }: any) {
  const today = todayIso()
  // What the feed is narrowed to: the activity, a category inside it, a grade.
  const [filter, setFilter] = useState<{ activity: string | null; category: string | null; band: string | null }>(
    { activity: null, category: null, band: null })
  /*
   * WHICH workout is open, never a copy of it. Holding the row object meant the
   * sheet rendered a SNAPSHOT: a rename saved, and the header, the chip's own
   * pressed state and the way back all still described the entry as it had been.
   * A component holding a copy of a synced entry is a component showing the past.
   */
  const [openId, setOpenId] = useState<string | null>(null)

  const menu = plan?.dailyMenu || []
  // Today's operations (lib/sessionops.js). `undoIcon` null: the host draws Retry's arrow only.
  const ops: any = (sessionOps as any)({ plan, entries, upsertEntry, deleteEntry, toast: pushToast, undoIcon: null })

  /*
   * Workouts only, newest first. A logged REST day is kept — "I deliberately did
   * nothing on Tuesday" is a fact about the week, not a gap.
   */
  const workouts = useMemo(() => entries
    .filter((e: any) => e.kind === 'daily' && !e.deleted && e.date && isDone(e))
    .map((e: any) => {
      const opt = (optFor as any)(menu, e.data?.optId) || null
      // The ACTIVITY's icon, not the card's: the workout card is one container
      // for ninety-one sports and its own icon is a generic squiggle.
      const act = opt ? (loggedActivity as any)(opt, e.data?.out) : null
      return {
        entry: e,
        opt,
        name: rowName(opt, e),
        icon: act?.icon || opt?.icon || 'Activity',
        category: (categoryOf as any)(e, menu),
        discipline: (disciplineOf as any)(e, menu),
        rest: Number(e.data?.level) === 0 || opt?.role === 'rest',
        // The first question (lib/scope.js); a rest day is none of them.
        activity: Number(e.data?.level) === 0 || opt?.role === 'rest' ? null : (activityScopeOf as any)(e, plan),
        bands: opt ? ((bandsOf as any)(opt, e.data?.out) as string[]) : [],
        // Logged as activity rather than training — a commute, an errand on the
        // bike. Its miles count; its load does not, so the card says so.
        casual: !isTraining(e),
        // A workout done together: "with Sam" (or, in Sam's log, "with Alex"). lib/shared.js.
        with: (withLine as any)(e, currentMe().people),
        // A session the owner planned for this person: "planned by Alex". lib/trainer.js.
        by: (plannedLine as any)(e, currentMe()),
      }
    })
    .sort((a: any, b: any) => String(b.entry.date).localeCompare(String(a.entry.date)) ||
                              String(b.entry.id).localeCompare(String(a.entry.id))),
    [entries, menu, plan])

  // Only offer filters that would actually match something. A row of chips where
  // half return nothing is a row of chips that teaches you not to use it.
  const allCats = useMemo(() => {
    const live = new Set(workouts.map((w: any) => w.category).filter(Boolean))
    return (plan?.quotaCategories || []).filter((c: any) => live.has(c.key))
  }, [workouts, plan])

  const acts = useMemo(
    () => ACTIVITY_SCOPES.filter((a) => workouts.some((w: any) => w.activity === a.key)),
    [workouts])
  // The second level sits under the activity picked, or under the only one logged.
  const within = filter.activity || (acts.length === 1 ? acts[0].key : null)
  const cats = useMemo(() => {
    if (!within) return []
    const live = new Set(workouts.filter((w: any) => w.activity === within).map((w: any) => w.category).filter(Boolean))
    return allCats.filter((c: any) => live.has(c.key))
  }, [workouts, allCats, within])
  // Grades: boulders, then routes, easiest first, each only once something is graded at it.
  const bands = useMemo(() => {
    if (within !== 'climbing') return []
    const keys = new Set<string>(workouts.flatMap((w: any) => w.bands))
    return [...keys].map((k) => {
      const [scale, b] = k.split(':')
      return { value: k, scale, band: Number(b), label: (bandLabel as any)(scale, Number(b)) as string }
    }).sort((a, b) => a.scale.localeCompare(b.scale) || a.band - b.band)
  }, [workouts, within])

  const narrowed = Boolean(filter.activity || filter.category || filter.band)
  const shown = workouts.filter((w: any) =>
    (!filter.activity || w.activity === filter.activity) &&
    (!filter.category || w.category === filter.category) &&
    (!filter.band || w.bands.includes(filter.band)))
  const everything = () => setFilter({ activity: null, category: null, band: null })
  const pickActivity = (key: string) => setFilter((f) => ({ activity: f.activity === key ? null : key, category: null, band: null }))
  const pickBand = () => showMenu([
    { label: 'Any grade', onPress: () => setFilter((f) => ({ ...f, band: null })) },
    ...bands.map((b) => ({ label: b.label, onPress: () => setFilter((f) => ({ ...f, band: b.value })) })),
  ], { title: 'Grade' })

  // Re-derived on every render, so a save inside the sheet is on screen at once.
  const open = openId ? workouts.find((w: any) => w.entry.id === openId) || null : null

  // Grouped by date, so a day that held three workouts reads as one day.
  const days = useMemo(() => {
    const m = new Map<string, any[]>()
    for (const w of shown) {
      if (!m.has(w.entry.date)) m.set(w.entry.date, [])
      m.get(w.entry.date)!.push(w)
    }
    return [...m.entries()]
  }, [shown])

  const catName = (key: string) => allCats.find((c: any) => c.key === key)?.name || null

  return (
    <>
      <ScreenTitle>Log</ScreenTitle>
      {/* "All" and the kinds of thing actually logged, one row that scrolls
          sideways (#97). No counts: a number in a chip read as part of its name. */}
      {acts.length > 1 && (
        <ChipRow style={st.filters}>
          <Chip small label="All" on={!narrowed} onPress={everything} />
          {acts.map((a) => (
            <Chip key={a.key} small label={a.name} on={filter.activity === a.key} onPress={() => pickActivity(a.key)} />
          ))}
        </ChipRow>
      )}
      {/* Inside it, the plan's categories (Fun, Fingers, Endurance…). */}
      {cats.length > 1 && (
        <SubFilter label={subFilterLabel(acts.find((a: any) => a.key === within)?.name)}>
          {cats.map((c: any) => (
            <SubChip key={c.key} label={c.name} on={filter.category === c.key}
              onPress={() => setFilter((f) => ({ ...f, category: f.category === c.key ? null : c.key }))} />
          ))}
        </SubFilter>
      )}
      {/* Under Climbing, one whole grade: the sessions that touched it, sent or not. */}
      {bands.length > 0 && (
        <View style={st.gradeCard}>
          <Row label="Grade" value={bands.find((b) => b.value === filter.band)?.label || 'Any grade'} onPress={pickBand} />
        </View>
      )}
      {narrowed && !shown.length && workouts.length > 0 ? (
        <Empty>
          <T size={font.body} dim align="center">Nothing logged for that</T>
          <Btn kind="secondary" title="Show everything" onPress={everything} />
        </Empty>
      ) : null}

      {!workouts.length && (
        <Empty icon="NotebookPen">
          <T size={font.body} dim align="center">Nothing logged yet</T>
          <Explain><T size={font.label} dim align="center">Workouts you log show up here, newest first.</T></Explain>
          {onLog ? <Btn title="Log a workout" onPress={() => onLog()} /> : null}
        </Empty>
      )}

      {/* One card per day, its workouts as rows (wave 2): a row opens the sheet. */}
      {days.map(([date, list], di) => (
        <View key={date} style={di > 0 ? st.dayNext : null}>
          <SectionHeader title={dayLabel(date, today)} style={st.dayHead} />
          <View style={st.dayCard}>
            {list.map((w: any, i: number) => (
              <React.Fragment key={w.entry.id}>
                {i > 0 ? <Divider /> : null}
                <LogRow w={w} cat={catName(w.category)}
                  onOpen={() => { if (w.opt) setOpenId(w.entry.id) }}
                  onRemove={deleteEntry ? () => ops.removeSession(w.entry) : null} />
              </React.Fragment>
            ))}
          </View>
        </View>
      ))}

      {open?.opt && (
        <LogSheet opt={open.opt} entry={open.entry} entries={entries} ops={ops} upsertEntry={upsertEntry}
          rest={open.rest} discipline={open.discipline} onClose={() => setOpenId(null)} />
      )}
    </>
  )
}

/**
 * A workout opened from the Log: THE SAME SHEET as Today's (#79, G F1), the
 * web's `LogSheet`. The Log mounted a bare form, so a planned workout opened
 * from here showed "What did you lift?" and none of its exercises, its done chip
 * or its sharing. What differs is a parameter: the day is the entry's own, and
 * nothing is run from history (no Start; the runner is Today's). The writes are
 * Today's (lib/sessionops.js, #76).
 */
export function LogSheet({ opt, entry, entries, ops, upsertEntry, rest = false, discipline = null, onClose }: any) {
  // Only where the question makes sense: a commute is a ride, not a set of max hangs.
  const onTraining = ['bike', 'run', 'swim', 'other'].includes(discipline) ? ops.setTraining(entry, opt) : null
  return (
    <SessionSheet opt={opt} entry={entry} tone={rest ? 'rest' : undefined} entries={entries}
      isFuture={Boolean(entry?.date) && entry.date > localIso()}
      onLog={null}
      onSave={(e: any, out: any) => ops.saveOutputs(e, out)}
      onSavePlan={(e: any, pres: any) => ops.savePlan(e, pres)}
      // Closed on removal, so an Undo puts the workout back in the feed.
      onRemove={(e: any) => { onClose(); ops.removeSession(e) }}
      onSetDone={(e: any, v: any) => ops.setDone(e, v)}
      onSaveEntry={upsertEntry}
      onStartWorkout={null}
      onTraining={onTraining}
      onClose={onClose} />
  )
}

/** One workout row; swipes left to reveal Remove. */
function LogRow({ w, cat, onOpen, onRemove }: {
  w: any; cat: string | null; onOpen: () => void; onRemove: (() => void) | null
}) {
  const ref = useRef<SwipeableMethods>(null)
  const stats: string[] = w.rest ? (restStats as any)(w.entry, w.opt) : statsOf(w.entry, w.opt)
  // The category only where it says something the name does not.
  const meta = [
    !w.rest && cat && cat.toLowerCase() !== String(w.name).toLowerCase() ? cat : null,
    ...stats,
    w.casual ? 'just miles' : null,
  ].filter(Boolean).join(' · ')
  const people = [w.with, w.by].filter(Boolean).join(' · ')

  const remove = async () => {
    const ok = await confirm(`${DELETE_LABEL}?`, { message: DELETE_BODY, confirmLabel: 'Remove' })
    if (ok) { impact(); onRemove?.() } else ref.current?.close()
  }

  const row = (
    <Press onPress={() => { if (w.opt) { tap(); onOpen() } }} disabled={!w.opt} accessibilityRole="button"
      accessibilityLabel={[w.name, meta].filter(Boolean).join(', ')} style={[kit.row, st.row]}>
      {/* The row's own ink, as the kit's Row: the accent is for the + on this screen. */}
      <Icon name={w.icon} size={20} color={colors.inkDim} />
      <View style={st.main}>
        <T size={font.body} weight={500} numberOfLines={1}>{w.name}</T>
        {meta ? <T size={font.label} dim tabular>{meta}</T> : null}
        {/* A workout done together, or one the owner planned for this person. */}
        {people ? <T size={font.caption} dim>{people}</T> : null}
      </View>
      {w.opt ? <Icon name="ChevronRight" size={16} color={colors.inkFaint} /> : null}
    </Press>
  )

  if (!onRemove) return row

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={() => (
        <Press onPress={remove} accessibilityRole="button" accessibilityLabel={DELETE_LABEL} style={st.swipeDel}>
          <Icon name="Trash2" size={18} color={colors.bg} />
          <T size={font.label} weight={600} color={colors.bg}>Remove</T>
        </Press>
      )}
    >
      {row}
    </ReanimatedSwipeable>
  )
}

const st = StyleSheet.create({
  filters: { marginBottom: space[2] },
  gradeCard: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.card,
    paddingHorizontal: space[4], marginBottom: space[3],
  },
  dayNext: { marginTop: space[6] },
  dayHead: { marginTop: 0 },
  // .card .list: one card per day, the rows inside it divided by hairlines.
  dayCard: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.card,
    paddingHorizontal: space[4], paddingVertical: space[1],
  },
  row: { backgroundColor: colors.panel },
  main: { flex: 1, minWidth: 0, gap: 2 },
  swipeDel: {
    width: 88, marginLeft: space[2], marginVertical: space[1], borderRadius: radius.control, backgroundColor: colors.vizCrit,
    alignItems: 'center', justifyContent: 'center', gap: space[1],
  },
})
