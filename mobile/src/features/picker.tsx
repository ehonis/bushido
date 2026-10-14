/*
 * One door: Log a workout. Ported from app/src/picker.jsx.
 *
 * There used to be two, *Log a workout* over the sports catalog and *Pick a
 * session* over the plan's cards. Two lists for one act meant knowing which list
 * a thing lived in before finding it, so on 2026-10-14 the plan's cards moved
 * INSIDE the workout picker, as folders at the top: Bouldering and Rock climbing
 * (lib/folders.js says what goes where, and why folders are not activities).
 *
 *   FOLDERS    the plan's own cards, grouped inside each folder by the quota
 *              category each declares. Picking one puts it on the day with its
 *              protocol, cues, timer and the hard-finger question.
 *   ACTIVITIES the sports catalog, grouped as the catalog groups itself, pinned
 *              sports first. Picking one puts the workout card on the day with the
 *              activity already answered.
 *
 * NOTHING RANKS: a list of doors, in the order the content file declares them,
 * with a search box that reaches both. The right-hand column says what each row
 * COSTS or FILLS: minutes for a card, the quota category for an activity, the
 * card count for a folder.
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
import { climbingFolders, folderCards, folderOf, FOLDERS } from '../lib/folders.js'

export { groupedSessions, climbingFolders } from '../lib/folders.js'

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

/* ------------------------------------------------------- the plan's cards */

const cardRow = (m: any, folderName: string | null = null) => ({
  key: `card:${m.id}`, name: m.name, sub: folderName || m.tier, icon: m.icon,
  meta: m.minutes ? `${m.minutes} min` : null,
  search: m.dose,
})

/** The folder rows that lead the chooser: one per folder with any cards in it. */
export function folderGroup(plan: any) {
  const folders: any[] = climbingFolders(plan)
  if (!folders.length) return null
  return {
    key: '_climbing', name: 'Climbing', icon: 'Mountain',
    items: folders.map(f => ({
      key: `folder:${f.key}`, name: f.name, icon: f.icon,
      sub: 'Sessions from the plan', meta: `${f.count}`,
    })),
  }
}

/** One folder's cards, grouped by quota category, as picker rows. */
export function folderRows(plan: any, key: string) {
  const f: any = climbingFolders(plan).find((x: any) => x.key === key)
  if (!f) return []
  return f.groups.map((g: any) => ({ ...g, items: g.items.map((m: any) => cardRow(m)) }))
}

/**
 * Log a workout: the one picker, over the plan's cards and the sports catalog.
 *
 * Picking an ACTIVITY answers the form's first question: the entry lands with
 * `out.activity` set, so the card opens as a ride or a swim or a lift. Picking a
 * CARD (out of a folder, or straight off a search) places that card.
 *
 * `dayLabel` is said in the header when the pick does not land on today, because
 * logging Monday's climb from Wednesday must not look like logging it today.
 * `climbingOnly` is the route from a WHOOP climb on the unlogged card: the
 * catalog is the wrong answer there (AGENTS.md §6.1), so only the folders show.
 */
export function ActivityChooser({
  plan, field, onPick, onPickCard = null, onClose,
  dayLabel = null, climbingOnly = false, initialFolder = null,
}: {
  plan: any
  field: any
  onPick: (activity: string) => void
  onPickCard?: ((optId: string) => void) | null
  onClose: () => void
  dayLabel?: string | null
  climbingOnly?: boolean
  initialFolder?: string | null
}) {
  const [folder, setFolder] = useState<string | null>(initialFolder)
  const climbing = useMemo(() => (onPickCard ? folderGroup(plan) : null), [plan, onPickCard])
  const groups = useMemo(() => [
    ...(climbing ? [climbing] : []),
    ...(climbingOnly ? [] : activityGroups(field, plan)),
  ], [climbing, climbingOnly, field, plan])
  const n = (activityCatalog as any)(field).activities.length
  const cards: any[] = onPickCard ? folderCards(plan) : []

  const pick = (key: string) => {
    if (key.startsWith('folder:')) return setFolder(key.slice('folder:'.length))
    if (key.startsWith('card:')) return onPickCard?.(key.slice('card:'.length))
    return onPick(key)
  }

  if (folder) {
    const f = FOLDERS.find(x => x.key === folder)
    const rows = folderRows(plan, folder)
    return (
      <PickerScreen
        title={f?.name || 'Climbing'}
        sub={[`${rows.reduce((k: number, g: any) => k + g.items.length, 0)} in the plan`, dayLabel].filter(Boolean).join(' · ')}
        icon={f?.icon || 'Mountain'}
        placeholder="max hangs, 4×4, ARC, crag day…"
        lead="The plan's own sessions, in the order it declares them. Each one asks the hard-finger question, so the finger budget sees what you did."
        groups={rows} onPick={pick}
        // Back goes up one level, unless the folder was where this screen opened.
        onClose={initialFolder ? onClose : () => setFolder(null)}
      />
    )
  }

  const sub = climbingOnly
    ? [`${cards.length} sessions`, dayLabel]
    : [`${n} activities`, cards.length ? `${cards.length} sessions` : null, dayLabel]

  return (
    <PickerScreen
      title={climbingOnly ? 'Log the climb' : 'Log a workout'}
      sub={sub.filter(Boolean).join(' · ')}
      icon={climbingOnly ? 'Mountain' : 'NotebookPen'}
      placeholder={climbingOnly ? 'board, 4×4, ARC, crag day…' : 'bouldering, mountain bike, max hangs, erg…'}
      lead={climbingOnly
        ? 'Which session was it? WHOOP recorded the climb; the card asks the hard-finger question.'
        : 'Something you already did. Climbing is in the two folders at the top; pick anything '
          + 'else and the form arrives the right shape: a ride asks for distance, a swim for '
          + 'yards, a lift for the exercises.'}
      groups={groups}
      /* The catalog has its own ranked search: "ru" has to return Run before Ruck.
         Cards follow, matched on every word, so "max hangs" finds its card
         without opening a folder. */
      onSearch={(q: string) => {
        const words = q.toLowerCase().split(/\s+/).filter(Boolean)
        const name = (k: string) => FOLDERS.find(f => f.key === k)?.name || null
        const cardHits = cards
          .map(m => cardRow(m, name(folderOf(m))))
          .filter(r => {
            const hay = [r.name, r.sub, r.search].filter(Boolean).join(' ').toLowerCase()
            return words.every(w => hay.includes(w))
          })
        const activityHits = climbingOnly ? [] : (searchActivities as any)(field, q).map((a: any) => ({
          key: a.key, name: a.name, icon: a.icon || 'Activity',
          meta: (plan?.quotaCategories || []).find((c: any) => c.key === a.category)?.name || null,
        }))
        return [...activityHits, ...cardHits]
      }}
      onPick={pick} onClose={onClose}
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
})
