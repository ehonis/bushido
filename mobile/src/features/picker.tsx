/*
 * One door: Log a workout. Ported from app/src/picker.jsx.
 *
 * There used to be two, *Log a workout* over the sports catalog and *Pick a
 * session* over the plan's cards. Two lists for one act meant knowing which list
 * a thing lived in before finding it, so on 2026-10-14 the plan's cards moved
 * INSIDE the workout picker, as folders: Bouldering and Rock climbing
 * (lib/folders.js says what goes where, and why folders are not activities).
 *
 *   ACTIVITIES the sports catalog, grouped as the catalog groups itself, after
 *              Recent. Picking one puts the workout card on the day with the
 *              activity already answered.
 *   FOLDERS    the plan's own cards, grouped inside each folder by the category
 *              each declares. Picking one puts it on the day with its protocol,
 *              cues, timer and the hard-finger question.
 *
 * The activities come FIRST and the Climbing group after them (2026-10-25, issue
 * #31): a workout log, so the general ways to log lead. Ordered in code, not
 * content, because the owner's plan file is not in the repository.
 *
 * NOTHING RANKS: a list of doors, in the order the content file declares them,
 * with a search box that reaches both. The one exception is Recent, at the top:
 * the quick-log list (lib/quicklog.js), because "the thing I did yesterday" is
 * the likeliest answer. Each group is a section head over ONE card of rows, and a
 * row says its name once (docs/DESIGN.md): the category echo and the paragraph
 * under the search went. The right-hand column is only what a row COSTS or HOLDS:
 * minutes for a card, the session count for a folder.
 */
import React, { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors, font, radius, space } from '../theme'
import { Icon } from '../lib/icons'
import { T } from '../ui/Text'
import { Card, IconBtn, Input, Press, SectionHeader } from '../ui/kit'
import { FullScreen } from '../ui/Sheet'
import { impact } from '../ui/haptics'
import {
  catalogOf as activityCatalog, groupedActivities, searchActivities,
} from '../lib/activities.js'
import { climbingFolders, folderCards, folderOf, FOLDERS } from '../lib/folders.js'
import { recentActivities } from '../lib/quicklog.js'

export { groupedSessions, climbingFolders } from '../lib/folders.js'

/* ------------------------------------------------------------ the screen */

/**
 * A grouped list of things you can pick, full screen.
 *
 * `groups` is `[{ key, name, items: [{ key, name, sub, icon, meta }] }]`.
 * `onSearch` is optional: a catalog with its own ranked search passes it in;
 * anything else gets the plain every-word-must-match filter below.
 */
export function PickerScreen({
  title, sub, icon = 'Layers', placeholder = 'Search',
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
        <Icon name="Target" size={16} color={colors.inkFaint} />
        <Input value={q} onChangeText={setQ} placeholder={placeholder}
          accessibilityLabel={`Search ${title}`} returnKeyType="search" autoCorrect={false}
          style={st.searchInput} />
        {q ? <IconBtn icon="X" size={16} label="Clear" onPress={() => setQ('')} /> : null}
      </View>

      {hits ? (
        hits.length
          ? <RowCard rows={hits} onPick={pick} />
          : <T size={font.small} dim style={{ marginVertical: space[2] }}>Nothing matches “{query}”.</T>
      ) : (
        groups.map((g: any, i: number) => (
          <View key={g.key}>
            <SectionHeader title={g.name} style={i === 0 ? { marginTop: 0 } : null} />
            <RowCard rows={g.items} onPick={pick} />
          </View>
        ))
      )}

      {footer && !query ? footer : null}
      {!total && <T size={font.small} dim>Nothing to pick from.</T>}
    </FullScreen>
  )
}

/** One card of .list-rows with hairlines between them. */
function RowCard({ rows, onPick }: { rows: any[]; onPick: (key: string) => void }) {
  return (
    <Card style={st.list}>
      {rows.map((r, i) => <Row key={r.key} row={r} first={i === 0} onPick={onPick} />)}
    </Card>
  )
}

function Row({ row, first, onPick }: { row: any; first: boolean; onPick: (key: string) => void }) {
  return (
    <Press onPress={() => onPick(row.key)} accessibilityRole="button" accessibilityLabel={row.name}
      style={[st.row, !first && st.rowRule]}>
      <Icon name={row.icon || 'Activity'} size={20} color={colors.inkDim} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <T size={font.body} weight={500} numberOfLines={1}>{row.name}</T>
        {row.sub ? <T size={font.small} dim numberOfLines={1}>{row.sub}</T> : null}
      </View>
      {row.meta ? <T size={font.small} dim tabular>{row.meta}</T> : null}
      <Icon name="ChevronRight" size={16} color={colors.inkFaint} />
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
 * The activity catalog as picker groups, Recent first: the quick-log list
 * (lib/quicklog.js), the newest distinct activities in `entries` and then the
 * catalog's pins, so a fresh install leads with its pins. Then the catalog's own
 * groups, in its order, and anything whose group it no longer lists.
 */
export function activityGroups(field: any, plan: any, entries: any[] = []) {
  if (!field) return []
  const row = (a: any) => ({
    key: a.key, name: a.name, icon: a.icon || 'Activity',
    search: (a.aka || []).join(' '),
  })

  const recent: any[] = (recentActivities as any)(entries, field)
  const groups: any[] = recent.length
    ? [{ key: '_recent', name: 'Recent', items: recent.map(row) }]
    : []

  for (const g of (groupedActivities as any)(field)) {
    groups.push({ key: g.name, name: g.name, items: g.items.map(row) })
  }

  // The same orphan rule the sessions follow: an activity whose group the
  // catalog no longer lists must still be reachable, not silently dropped.
  const listed = new Set(groups.filter(g => g.key !== '_recent').flatMap(g => g.items.map((i: any) => i.key)))
  const orphans = (activityCatalog as any)(field).activities.filter((a: any) => !listed.has(a.key))
  if (orphans.length) {
    groups.push({ key: '_other', name: 'Everything else', items: orphans.map(row) })
  }
  return groups
}

/* ------------------------------------------------------- the plan's cards */

// `folderName` only in search results, where the folder is not the heading above.
const cardRow = (m: any, folderName: string | null = null) => ({
  key: `card:${m.id}`, name: m.name, sub: folderName, icon: m.icon,
  meta: m.minutes ? `${m.minutes} min` : null,
  search: m.dose,
})

/** The folder rows, after the activities: one per folder with any cards in it. */
export function folderGroup(plan: any) {
  const folders: any[] = climbingFolders(plan)
  if (!folders.length) return null
  // "Climbing" only when that is what is in it; a plan with no climbing tags
  // (the example's runs) gets its cards under a heading that does not lie.
  const climbing = folders.every(f => f.key !== 'plan')
  return {
    key: '_climbing', name: climbing ? 'Climbing' : 'Your plan',
    items: folders.map(f => ({
      key: `folder:${f.key}`, name: f.name, icon: f.icon,
      meta: `${f.count} session${f.count === 1 ? '' : 's'}`,
    })),
  }
}

/** One folder's cards, grouped by category, as picker rows. */
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
 * `entries` is the log, for Recent; without it Recent is the catalog's pins.
 * `climbingOnly` is the route from a WHOOP climb on the unlogged card: the
 * catalog is the wrong answer there (AGENTS.md §6.1), so only the folders show.
 */
export function ActivityChooser({
  plan, field, onPick, onPickCard = null, onClose, entries = [],
  dayLabel = null, climbingOnly = false, initialFolder = null,
}: {
  plan: any
  field: any
  onPick: (activity: string) => void
  onPickCard?: ((optId: string) => void) | null
  onClose: () => void
  entries?: any[]
  dayLabel?: string | null
  climbingOnly?: boolean
  initialFolder?: string | null
}) {
  const [folder, setFolder] = useState<string | null>(initialFolder)
  const climbing = useMemo(() => (onPickCard ? folderGroup(plan) : null), [plan, onPickCard])
  const groups = useMemo(() => [
    ...(climbingOnly ? [] : activityGroups(field, plan, entries)),
    ...(climbing ? [climbing] : []),
  ], [climbing, climbingOnly, field, plan, entries])
  const cards: any[] = onPickCard ? folderCards(plan) : []

  const pick = (key: string) => {
    if (key.startsWith('folder:')) return setFolder(key.slice('folder:'.length))
    if (key.startsWith('card:')) return onPickCard?.(key.slice('card:'.length))
    return onPick(key)
  }

  if (folder) {
    const f = FOLDERS.find(x => x.key === folder)
    return (
      <PickerScreen
        title={f?.name || 'Climbing'}
        sub={dayLabel}
        icon={f?.icon || 'Mountain'}
        placeholder={`Search ${(f?.name || 'the plan').toLowerCase()}`}
        groups={folderRows(plan, folder)} onPick={pick}
        // Back goes up one level, unless the folder was where this screen opened.
        onClose={initialFolder ? onClose : () => setFolder(null)}
      />
    )
  }

  return (
    <PickerScreen
      title={climbingOnly ? 'Log the climb' : 'Log a workout'}
      sub={dayLabel}
      icon={climbingOnly ? 'Mountain' : 'NotebookPen'}
      placeholder={climbingOnly ? 'Search sessions' : 'Search'}
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
  // styles.css .spick-search and the base .list-row (docs/DESIGN.md).
  search: {
    flexDirection: 'row', alignItems: 'center', gap: space[2], marginBottom: space[6], paddingLeft: space[3],
    minHeight: 44, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.control, backgroundColor: colors.panel2,
  },
  searchInput: { flex: 1, minWidth: 0, borderWidth: 0, backgroundColor: 'transparent', paddingHorizontal: 0 },
  list: { paddingVertical: 0, marginBottom: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 52, paddingVertical: space[2] },
  rowRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
})
