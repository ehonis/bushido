/*
 * One picker, two catalogs. Ported from app/src/picker.jsx.
 *
 * Pick a session and log a workout are the same action over two different
 * lists, so there is one screen, `PickerScreen`, and the two things that differ
 * are the rows it is handed and what a tap does with them.
 *
 *   SESSIONS   the plan's own cards, grouped by the quota category each declares.
 *              Picking one puts it on the day with its protocol, cues and timer.
 *   ACTIVITIES the sports catalog, grouped as the catalog groups itself, pinned
 *              sports first. Picking one puts the workout card on the day with the
 *              activity already answered.
 *
 * NEITHER RANKS: a list of doors, in the order the content file declares them,
 * with a search box. The user already knows what they did; they need somewhere
 * to press. The right-hand column says what each row COSTS or FILLS — minutes for
 * a session, the quota category for an activity.
 */
import React, { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors } from '../theme'
import { Icon } from '../lib/icons'
import { T } from '../ui/Text'
import { IconBtn, Input, Press } from '../ui/kit'
import { FullScreen } from '../ui/Sheet'
import { impact } from '../ui/haptics'
import {
  catalogOf as activityCatalog, groupedActivities, pinnedActivities, searchActivities,
} from '../lib/activities.js'

/* ------------------------------------------------------------ the screen */

/**
 * A grouped list of things you can pick, full screen.
 *
 * `groups` is `[{ key, name, icon, items: [{ key, name, sub, icon, meta }] }]`.
 * `onSearch` is optional: a catalog with its own ranked search passes it in;
 * anything else gets the plain every-word-must-match filter below.
 */
export function PickerScreen({
  title, sub, icon = 'Layers', lead, placeholder,
  groups, onSearch = null, onPick, onClose, footer = null,
}: any) {
  const [q, setQ] = useState('')
  const query = q.trim()

  // Searching flattens the groups. Keeping them while filtering leaves a column
  // of one-row sections, which is harder to read than the list it came from.
  const hits: any[] | null = query
    ? (onSearch ? onSearch(query) : defaultSearch(groups, query.toLowerCase()))
    : null

  const total = groups.reduce((n: number, g: any) => n + g.items.length, 0)
  const pick = (key: string) => { impact(); onPick(key) }

  return (
    <FullScreen title={title} sub={sub} icon={icon} onBack={onClose}>
      <View style={st.search}>
        <Icon name="Target" size={15} color={colors.inkFaint} />
        <Input value={q} onChangeText={setQ} placeholder={placeholder}
          accessibilityLabel={`Search ${title}`} returnKeyType="search" autoCorrect={false}
          style={st.searchInput} />
        {q ? <IconBtn icon="X" size={16} bordered={false} label="Clear" onPress={() => setQ('')} /> : null}
      </View>

      {lead && !query ? <T size={12.5} dim lineHeight={19} style={{ marginBottom: 18 }}>{lead}</T> : null}

      {hits ? (
        <View style={st.group}>
          <GroupHead icon="Target" name={`${hits.length} match${hits.length === 1 ? '' : 'es'}`} />
          {hits.map(r => <Row key={r.key} row={r} onPick={pick} />)}
          {!hits.length && <T size={12.5} dim>Nothing matches that.</T>}
        </View>
      ) : (
        groups.map((g: any) => (
          <View key={g.key} style={st.group}>
            <GroupHead icon={g.icon} name={g.name} n={g.items.length} />
            {g.items.map((r: any) => <Row key={r.key} row={r} onPick={pick} />)}
          </View>
        ))
      )}

      {footer && !query ? footer : null}
      {!total && <T size={12.5} dim>Nothing to pick from.</T>}
    </FullScreen>
  )
}

function GroupHead({ icon, name, n }: { icon: string; name: string; n?: number }) {
  return (
    <View style={st.grouphead}>
      <Icon name={icon} size={14} color={colors.inkFaint} />
      <T size={10.5} caps faint style={{ flex: 1, letterSpacing: 0.84 }}>{name}</T>
      {n != null ? <T size={10.5} faint tabular>{n}</T> : null}
    </View>
  )
}

function Row({ row, onPick }: { row: any; onPick: (key: string) => void }) {
  return (
    <Press onPress={() => onPick(row.key)} accessibilityRole="button" style={st.row}>
      <Icon name={row.icon} size={17} color={colors.accent} />
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <T size={14} weight={700} numberOfLines={1}>{row.name}</T>
        {row.sub ? <T size={11.5} faint numberOfLines={1}>{row.sub}</T> : null}
      </View>
      {row.meta ? <T size={12} faint tabular>{row.meta}</T> : null}
      <Icon name="ChevronRight" size={15} color={colors.inkFaint} />
    </Press>
  )
}

/** Every word has to land somewhere, so "bent row" does not return every row. */
function defaultSearch(groups: any[], q: string) {
  const words = q.split(/\s+/).filter(Boolean)
  return groups.flatMap(g => g.items).filter((r: any) => {
    const hay = [r.name, r.sub, r.meta, r.search].filter(Boolean).join(' ').toLowerCase()
    return words.every(w => hay.includes(w))
  })
}

/* --------------------------------------------------------- the plan's own */

/** Everything you can put on a day, grouped the way the app talks about them. */
export function groupedSessions(plan: any) {
  const menu = plan?.dailyMenu || []
  const cats = plan?.quotaCategories || []
  const startable = menu.filter((m: any) =>
    m.role !== 'adjunct' && m.role !== 'rest' && !m.retired)

  const groups = cats
    .map((c: any) => ({
      key: c.key,
      name: c.name,
      icon: c.icon,
      // Plan order inside a category. Authored, stable, and not a ranking — a
      // list that reorders itself under their thumb is the thing being removed.
      items: startable.filter((m: any) => (m.category || m.categoryFrom) === c.key),
    }))
    .filter((g: any) => g.items.length > 0)

  // A card that names no category, or names one the plan no longer declares.
  const claimed = new Set(groups.flatMap((g: any) => g.items.map((m: any) => m.id)))
  const rest = startable.filter((m: any) => !claimed.has(m.id))
  if (rest.length) groups.push({ key: '_other', name: 'Everything else', icon: 'Sparkles', items: rest })

  return groups
}

const sessionRows = (groups: any[]) => groups.map(g => ({
  ...g,
  items: g.items.map((m: any) => ({
    key: m.id, name: m.name, sub: m.tier, icon: m.icon,
    meta: m.minutes ? `${m.minutes} min` : null,
    search: m.dose,
  })),
}))

export function SessionPicker({ plan, onPick, onClose }: any) {
  const groups = useMemo(() => sessionRows(groupedSessions(plan)), [plan])
  const total = groups.reduce((n, g) => n + g.items.length, 0)
  const rest = (plan?.dailyMenu || []).find((m: any) => m.role === 'rest')

  return (
    <PickerScreen
      title="Pick a session" sub={`${total} in the plan`} icon="Layers"
      placeholder="max hangs, 4×4, ARC, crag day…"
      lead="Every session the plan declares, in the order it declares them. Nothing here is ranked or recommended — pick the one you came for."
      groups={groups} onPick={onPick} onClose={onClose}
      footer={rest && (
        /* Resting is still something the user does on purpose, and its button went
           with the recommendation it used to sit under. */
        <Press haptic onPress={() => onPick(rest.id)} style={st.rest}>
          <Icon name={rest.icon} size={17} color={colors.inkFaint} />
          <T size={13} faint>Take a rest day</T>
        </Press>
      )}
    />
  )
}

/* ------------------------------------------------------- the 91 activities */

/**
 * The activity catalog as picker groups, their pinned sports first. The pins are
 * a real group because that is what they are: the sports that are most of what
 * the user logs. `meta` is the QUOTA CATEGORY, not the group — "which of these
 * fills my bike quota" is the question the right-hand column can answer.
 */
export function activityGroups(field: any, plan: any) {
  if (!field) return []
  const catName = (key: string) =>
    (plan?.quotaCategories || []).find((c: any) => c.key === key)?.name || null

  const row = (a: any) => ({
    key: a.key, name: a.name, icon: a.icon || 'Activity',
    meta: catName(a.category),
    search: (a.aka || []).join(' '),
  })

  const pins: any[] = (pinnedActivities as any)(field)
  const groups: any[] = pins.length
    ? [{ key: '_pinned', name: 'Your usual', icon: 'Flame', items: pins.map(row) }]
    : []

  for (const g of (groupedActivities as any)(field)) {
    groups.push({ key: g.name, name: g.name, icon: g.items[0]?.icon || 'Activity', items: g.items.map(row) })
  }

  // The same orphan rule the sessions follow: an activity whose group the
  // catalog no longer lists must still be reachable, not silently dropped.
  const listed = new Set(groups.flatMap(g => g.items.map((i: any) => i.key)))
  const orphans = (activityCatalog as any)(field).activities.filter((a: any) => !listed.has(a.key))
  if (orphans.length) {
    groups.push({ key: '_other', name: 'Everything else', icon: 'Sparkles', items: orphans.map(row) })
  }
  return groups
}

/**
 * Log a workout: the same screen, over the sports catalog. Picking one answers
 * the form's first question: the entry lands with `out.activity` already set, so
 * the card opens as a ride or a swim or a lift.
 */
export function ActivityChooser({ plan, field, onPick, onClose }: any) {
  const groups = useMemo(() => activityGroups(field, plan), [field, plan])
  const n = (activityCatalog as any)(field).activities.length

  return (
    <PickerScreen
      title="Log a workout" sub={`${n} activities`} icon="NotebookPen"
      placeholder="mountain bike, dance, pickleball, erg…"
      lead="Something you already did. Pick it and the form arrives the right shape — a ride asks for distance and elevation, a swim for yards, a lift for the exercises."
      groups={groups}
      /* The catalog has its own ranked search: "ru" has to return Run before Ruck. */
      onSearch={(q: string) => (searchActivities as any)(field, q).map((a: any) => ({
        key: a.key, name: a.name, icon: a.icon || 'Activity',
        meta: (plan?.quotaCategories || []).find((c: any) => c.key === a.category)?.name || null,
      }))}
      onPick={onPick} onClose={onClose}
    />
  )
}

/** The `type: "activity"` field spec, which carries the sports catalog. */
export function activityFieldOf(plan: any) {
  for (const opt of plan?.dailyMenu || []) {
    for (const f of opt.outputs || []) if (f.type === 'activity') return f
  }
  return null
}

const st = StyleSheet.create({
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, paddingLeft: 10,
    borderWidth: 1, borderColor: colors.line, borderRadius: 10, backgroundColor: colors.panel2,
  },
  searchInput: { flex: 1, minWidth: 0, borderWidth: 0, backgroundColor: 'transparent', paddingHorizontal: 0 },
  group: { marginBottom: 20 },
  grouphead: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 7 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 6, paddingVertical: 11, paddingHorizontal: 12,
    minHeight: 44, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: 9,
  },
  rest: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 4, minHeight: 44,
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, borderRadius: 9,
  },
})
