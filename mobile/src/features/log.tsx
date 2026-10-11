/*
 * The log: every workout, newest first. (app/src/log.jsx)
 *
 * Rebuilt 2026-09-15. The climbing-only quick-log is gone rather than moved:
 * bodyweight is on the profile and a max hang is logged by the session that IS
 * that test. A second way in was a second thing to keep honest. Charts moved to
 * their own tab — they answer a different question.
 *
 * THE FEED IS ONE CARD PER WORKOUT, not one per entry. Bodyweight, notes, tests
 * and skips are all real entries and none of them belongs in a list of things
 * the user did.
 *
 * Native: a row swipes left to remove it (through the same confirmation the
 * sheet's bin uses), and tapping opens the session as a page sheet.
 */
import React, { useMemo, useRef, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable'
import { colors, mix, radius } from '../theme'
import { T } from '../ui/Text'
import { Card, H2, Press, Sub, s as kit } from '../ui/kit'
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
import { categoryOf, disciplineOf } from '../lib/quota.js'
import { gearOn, gearUsage } from '../lib/gear.js'
import { loggedActivity } from '../lib/activities.js'
import { useStrava } from '../lib/strava.jsx'
import { titleFor, withCasualName } from '../lib/naming.js'

const todayIso = () => (localIso as any)()

const fmt1 = (n: number) => Math.round(n * 10) / 10

// The copy of the sheet's delete confirmation, shared with the swipe so both
// ways out say the same thing.
const DELETE_LABEL = 'Delete this workout'
const DELETE_BODY = 'It goes out of the log, out of the week’s quotas, out of your training load and off the streak. The measurement it carries goes with it.'

/** A human date that says "today" and "yesterday", because those are most of them. */
function dayLabel(iso: string, today: string) {
  if (iso === today) return 'Today'
  const d = fromIso(iso)
  const y = fromIso(today); y.setDate(y.getDate() - 1)
  if (iso === (localIso as any)(y)) return 'Yesterday'
  const within = (Date.parse(today) - Date.parse(iso)) / 86400000
  return d.toLocaleDateString([], within < 300
    ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * The numbers worth putting on a card, in the order they matter for THAT sport.
 * Distance leads for a ride and a run because it is the thing the user'd say
 * out loud; for a lift it is the exercises.
 */
function statsOf(entry: any, opt: any, _plan: any) {
  const out = entry.data?.out || {}
  const st: string[] = []
  const mins = (minutesFor as any)(opt, out)

  if (Number(out.distance) > 0) st.push(`${fmt1(Number(out.distance))} mi`)
  if (Number(out.poolDistance) > 0) st.push(`${Math.round(Number(out.poolDistance))} yd`)
  if (mins > 0) st.push(`${Math.round(mins)} min`)
  if (Number(out.elevation) > 0) st.push(`${Math.round(Number(out.elevation))} ft`)
  if (Number(out.speed) > 0) st.push(`${fmt1(Number(out.speed))} mph`)
  const lifts = Array.isArray(out.lifts) ? out.lifts.length : 0
  if (lifts) st.push(`${lifts} exercise${lifts === 1 ? '' : 's'}`)
  if (Number(out.rpe) > 0) st.push(`RPE ${out.rpe}`)
  return st
}

export function LogTab({ plan, entries, upsertEntry, deleteEntry }: any) {
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
  const { cache: strava } = (useStrava as any)()

  const menu = plan?.dailyMenu || []
  const gearById = useMemo(() => {
    const rows = plan ? (gearUsage as any)({ plan, entries, strava }) : []
    return new Map<string, any>(rows.map((r: any) => [r.id, r]))
  }, [plan, entries, strava])

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
        name: opt ? (titleFor as any)(opt, e.data?.out, e.data?.plan) : (e.data?.name || 'Session'),
        icon: act?.icon || opt?.icon || 'Activity',
        category: (categoryOf as any)(e, menu),
        discipline: (disciplineOf as any)(e, menu),
        rest: Number(e.data?.level) === 0 || opt?.role === 'rest',
        // Logged as activity rather than training — a commute, an errand on the
        // bike. Its miles count; its load and its quota do not, so the card says so.
        casual: !isTraining(e),
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

  const filterChip = (key: string, label: string, n: number) => {
    const on = filter === key
    return (
      <Press key={key} haptic onPress={() => setFilter(key)} accessibilityRole="button"
        accessibilityState={{ selected: on }} style={[kit.chip, on && kit.chipOn]}>
        <T size={13} color={on ? colors.ink : colors.inkDim}>
          {label} <T size={13} color={on ? colors.ink : colors.inkDim} style={{ opacity: 0.55 }}>{String(n)}</T>
        </T>
      </Press>
    )
  }

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.filters}
        contentContainerStyle={{ gap: 6 }}>
        {filterChip('all', 'All', workouts.length)}
        {cats.map((c: any) => filterChip(c.key, c.name, workouts.filter((w: any) => w.category === c.key).length))}
      </ScrollView>

      {!workouts.length && (
        <Card>
          <H2>Nothing logged yet</H2>
          <Sub style={{ margin: 0 }}>
            Everything you finish on the <T size={13} weight={700}>Today</T> tab shows up here, newest
            first, with what it was done on.
          </Sub>
        </Card>
      )}

      {days.map(([date, list]) => (
        <View style={st.logday} key={date}>
          <View style={st.dayHead}>
            <T size={12} weight={600} faint caps>{dayLabel(date, today)}</T>
            <T size={12} faint>{`${list.length} workout${list.length === 1 ? '' : 's'}`}</T>
          </View>
          {list.map((w: any) => (
            <LogRow key={w.entry.id} w={w} plan={plan} gearById={gearById}
              onOpen={() => { if (w.opt) setOpenId(w.entry.id) }}
              onRemove={deleteEntry ? () => deleteEntry(w.entry.id) : null} />
          ))}
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

/** One workout card; swipes left to reveal Remove. */
function LogRow({ w, plan, gearById, onOpen, onRemove }: {
  w: any; plan: any; gearById: Map<string, any>; onOpen: () => void; onRemove: (() => void) | null
}) {
  const ref = useRef<SwipeableMethods>(null)
  const gear = (gearOn as any)(w.entry) as string[]
  const out = w.entry.data?.out || {}
  const muted = w.rest || w.casual
  const stats: string[] = w.rest ? (restStats as any)(w.entry, w.opt) : statsOf(w.entry, w.opt, plan)

  const remove = async () => {
    const ok = await confirm(`${DELETE_LABEL}?`, { message: DELETE_BODY, confirmLabel: 'Remove' })
    if (ok) { impact(); onRemove?.() } else ref.current?.close()
  }

  const card = (
    <Press onPress={() => { if (w.opt) { tap(); onOpen() } }} accessibilityRole="button"
      style={[st.card, w.rest && { opacity: 0.7 }]}>
      <View style={st.ico}>
        <Icon name={w.icon} size={18} color={muted ? colors.inkFaint : colors.accent} />
      </View>
      <View style={st.body}>
        <View style={st.head}>
          <T size={15} weight={700}>{w.name}</T>
          {w.category ? (
            <T size={10} faint caps>
              {plan?.quotaCategories?.find((c: any) => c.key === w.category)?.name}
            </T>
          ) : null}
          {w.casual ? <View style={st.casual}><T size={10} faint caps lineHeight={14}>just miles</T></View> : null}
        </View>
        {stats.length > 0 && (
          <View style={st.stats}>
            {stats.map((t, i) => <T key={i} size={13} dim tabular>{t}</T>)}
          </View>
        )}
        {/* What it was done on — the point of attaching gear at all. */}
        {gear.length > 0 && (
          <View style={st.gear}>
            <Icon name="ShoppingBag" size={12} color={colors.inkFaint} />
            <T size={11} faint style={{ flexShrink: 1 }}>
              {gear.map((id) => gearById.get(id)?.name || 'gear you deleted').join(' · ')}
            </T>
          </View>
        )}
        {(out.whoop || out.strava) ? (
          <View style={st.srcs}>
            {out.whoop ? <View style={[st.pip, { borderColor: mix(colors.series1, 45, colors.line) }]}><T size={10} dim lineHeight={13}>WHOOP</T></View> : null}
            {out.strava ? <View style={[st.pip, { borderColor: mix(colors.series2, 45, colors.line) }]}><T size={10} dim lineHeight={13}>Strava</T></View> : null}
          </View>
        ) : null}
      </View>
      <Icon name="ChevronDown" size={16} color={colors.inkFaint} style={{ marginTop: 3 }} />
    </Press>
  )

  if (!onRemove) return <View style={{ marginBottom: 8 }}>{card}</View>

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      containerStyle={{ marginBottom: 8 }}
      renderRightActions={() => (
        <Press onPress={remove} accessibilityRole="button" accessibilityLabel={DELETE_LABEL} style={st.swipeDel}>
          <Icon name="Trash2" size={18} color={colors.bg} />
          <T size={12} weight={600} color={colors.bg}>Remove</T>
        </Press>
      )}
    >
      {card}
    </ReanimatedSwipeable>
  )
}

const st = StyleSheet.create({
  filters: { flexGrow: 0, marginBottom: 12 },
  logday: { marginTop: 18 },
  dayHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginHorizontal: 2, marginBottom: 8 },
  card: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 16,
  },
  ico: { width: 28, marginTop: 1 },
  body: { flex: 1, minWidth: 0, gap: 5 },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  casual: { borderWidth: 1, borderColor: colors.line, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 10 },
  gear: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  srcs: { flexDirection: 'row', gap: 4 },
  pip: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, borderWidth: 1 },
  swipeDel: {
    width: 88, marginLeft: 8, borderRadius: radius.md, backgroundColor: colors.vizCrit,
    alignItems: 'center', justifyContent: 'center', gap: 4,
  },
})
