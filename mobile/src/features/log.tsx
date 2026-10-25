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
 * Native: a row swipes left to remove it (through the same confirmation the
 * sheet's bin uses), and tapping opens the session as a page sheet.
 */
import React, { useMemo, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable'
import { colors, font, radius, space } from '../theme'
import { T } from '../ui/Text'
import { Btn, Chip, Divider, Empty, Press, SectionHeader, s as kit } from '../ui/kit'
import { Modal } from '../ui/Sheet'
import { confirm } from '../ui/menu'
import { impact, tap } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { restStats } from '../lib/stats.js'
import { optFor } from '../lib/menu.js'
import { SessionLog, DetailsSheet } from './sessionlog'
import { isDone, isTraining } from '../lib/store.js'
import { minutesFor } from '../lib/minutes.js'
import { fromIso, localIso } from '../lib/dates.js'
import { categoryOf, disciplineOf } from '../lib/category.js'
import { loggedActivity } from '../lib/activities.js'
import { titleFor, withCasualName } from '../lib/naming.js'
import { withLine } from '../lib/shared.js'
import { plannedLine } from '../lib/trainer.js'
import { currentMe } from '../lib/whoami.js'

const todayIso = () => (localIso as any)()

const fmt1 = (n: number) => Math.round(n * 10) / 10

// The copy of the sheet's delete confirmation, shared with the swipe so both
// ways out say the same thing.
const DELETE_LABEL = 'Delete this workout'
const DELETE_BODY = 'It goes out of the log, out of your training load and off the streak. The measurement it carries goes with it.'

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * A day's header: "Today", "Yesterday", then "Fri 23 Oct" (with the year once it
 * is not this one). Spelled out by hand so the phone and the web say the same.
 */
function dayLabel(iso: string, today: string) {
  if (iso === today) return 'Today'
  const y = fromIso(today); y.setDate(y.getDate() - 1)
  if (iso === (localIso as any)(y)) return 'Yesterday'
  const d = fromIso(iso)
  const label = `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}`
  return d.getFullYear() === fromIso(today).getFullYear() ? label : `${label} ${d.getFullYear()}`
}

/**
 * The one line under a workout's name: how long, then how far, as on Today's
 * rows. Effort is in the sheet; on a row it was a bare "RPE 5".
 */
function statsOf(entry: any, opt: any) {
  const out = entry.data?.out || {}
  const st: string[] = []
  const mins = (minutesFor as any)(opt, out)

  if (mins > 0) st.push(`${Math.round(mins)} min`)
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
  const [filter, setFilter] = useState('all')
  /*
   * WHICH workout is open, never a copy of it. Holding the row object meant the
   * sheet rendered a SNAPSHOT: a rename saved, and the header, the chip's own
   * pressed state and the way back all still described the entry as it had been.
   * A component holding a copy of a synced entry is a component showing the past.
   */
  const [openId, setOpenId] = useState<string | null>(null)
  // The details layer, behind the pencil. See DetailsSheet in sessionlog.
  const [editing, setEditing] = useState(false)

  const menu = plan?.dailyMenu || []

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
    [entries, menu])

  // Only offer filters that would actually match something. A row of chips where
  // half return nothing is a row of chips that teaches you not to use it.
  const cats = useMemo(() => {
    const live = new Set(workouts.map((w: any) => w.category).filter(Boolean))
    return (plan?.quotaCategories || []).filter((c: any) => live.has(c.key))
  }, [workouts, plan])

  const shown = filter === 'all' ? workouts : workouts.filter((w: any) => w.category === filter)

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

  const catName = (key: string) => cats.find((c: any) => c.key === key)?.name || null

  return (
    <>
      {/* "All" and the categories actually logged, wrapping rather than running
          off the edge. No counts: a number in a chip read as part of its name. */}
      {cats.length > 1 && (
        <View style={st.filters}>
          <Chip small label="All" on={filter === 'all'} onPress={() => setFilter('all')} />
          {cats.map((c: any) => (
            <Chip key={c.key} small label={c.name} on={filter === c.key} onPress={() => setFilter(c.key)} />
          ))}
        </View>
      )}

      {!workouts.length && (
        <Empty icon="NotebookPen">
          <T size={font.body} dim align="center">Nothing logged yet</T>
          <T size={font.small} dim align="center">Workouts you log show up here, newest first.</T>
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
                  onRemove={deleteEntry ? () => deleteEntry(w.entry.id) : null} />
              </React.Fragment>
            ))}
          </View>
        </View>
      ))}

      {open?.opt && (() => {
        /* `name` travels with the out, because `out.title` is where a rename lives
           and `data.name` is the denormalised copy the habit note and the server
           read. Recomputing it here makes a rename show up on the row behind. */
        const save = (out: any) => upsertEntry({ ...open.entry, data: {
          ...open.entry.data, out, name: (titleFor as any)(open.opt, out, open.entry.data?.plan) } })
        /* Only where the question makes sense: a commute is a ride, not a set of
           max hangs. Driven by the discipline rather than by a list. */
        const onTraining = ['bike', 'run', 'swim', 'other'].includes(open.discipline)
          ? (v: any) => {
              const casual = v === false
              // A ride marked as just miles is named as a commute.
              // Fills a blank name and takes back only its own.
              const out = (withCasualName as any)(open.entry.data?.out || {},
                { plan, opt: open.opt, on: casual })
              upsertEntry({ ...open.entry, data: {
                ...open.entry.data, out,
                name: (titleFor as any)(open.opt, out, open.entry.data?.plan),
                training: casual ? false : undefined } })
            }
          : null
        return (
          <Modal title={open.name} sub={dayLabel(open.entry.date, today)} icon={open.icon}
            onClose={() => { setOpenId(null); setEditing(false) }}
            /*
             * The SAME pencil and bin as the day's session sheet, because this is
             * the same session seen from the feed. Delete goes through the
             * confirmation screen every other delete in the app uses.
             */
            onRename={() => setEditing(true)}
            onDelete={() => { deleteEntry?.(open.entry.id); setOpenId(null) }}
            deleteLabel={DELETE_LABEL}
            deleteBody={DELETE_BODY}>
            <SessionLog session={open.opt} entry={open.entry} entries={entries} bare
              onSave={save} />

            {editing && (
              <DetailsSheet session={open.opt} entry={open.entry} entries={entries}
                onSave={save} training={open.entry.data?.training} onTraining={onTraining}
                onClose={() => setEditing(false)} />
            )}
          </Modal>
        )
      })()}
    </>
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
        {meta ? <T size={font.small} dim tabular>{meta}</T> : null}
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
          <T size={font.caption} weight={600} color={colors.bg}>Remove</T>
        </Press>
      )}
    >
      {row}
    </ReanimatedSwipeable>
  )
}

const st = StyleSheet.create({
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginBottom: space[2] },
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
