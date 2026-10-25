/*
 * One door: Log a workout.
 *
 * There used to be two, *Log a workout* over the sports catalog and *Pick a
 * session* over the plan's cards, sharing one screen. Two lists for one act meant
 * knowing which list a thing lived in before finding it, so on 2026-10-14 the
 * plan's cards moved INSIDE the workout picker, as folders: Bouldering and Rock
 * climbing (see lib/folders.js for what goes where and why the folders are not
 * catalog activities).
 *
 *   ACTIVITIES the 91-sport catalog, grouped as the catalog groups itself, after
 *              Recent. Picking one puts the workout card on the day with the
 *              activity already answered.
 *   FOLDERS    the plan's own cards — the board, 4×4s, max hangs, ARC, the
 *              load-cell tests — grouped inside each folder by the category each
 *              declares. Picking one puts it on the day with its protocol, cues,
 *              timer and the hard-finger question.
 *
 * The activities come FIRST and the Climbing group after them (2026-10-25, issue
 * #31): this is a workout log, and the general ways to log lead. Ordered here in
 * code, not in content, because the owner's plan file is not in the repository.
 *
 * NOTHING RANKS. A list of doors, in the order the content file declares them,
 * with a search box that reaches both. The user already knows what they did;
 * they need somewhere to press. The one exception is Recent, at the top: the
 * activities of the last few workouts logged (lib/quicklog.js), the same rows
 * the + menu offers, because "the thing I did yesterday" is the likeliest answer.
 *
 * Laid out on the visual system (docs/DESIGN.md, 2026-10-25): each group is a
 * section head over ONE card of rows, not a card per row, and a row says its name
 * once. The category used to sit on the right of every activity ("Run …… Run"),
 * which the group heading above it already said; it went, and so did the
 * paragraph under the search box. The right-hand column is only what a row COSTS
 * or HOLDS: minutes for a card, the session count for a folder.
 */

import { useMemo, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import { FullScreen } from './modal.jsx'
import {
  catalogOf as activityCatalog, groupedActivities, searchActivities,
} from './lib/activities.js'
import { climbingFolders, folderCards, folderOf, FOLDERS } from './lib/folders.js'
import { recentActivities } from './lib/quicklog.js'

export { groupedSessions, climbingFolders } from './lib/folders.js'

/* ------------------------------------------------------------ the screen */

/**
 * A grouped list of things you can pick, full screen.
 *
 * `groups` is `[{ key, name, items: [{ key, name, sub, icon, meta }] }]`.
 * `onSearch` is optional: a catalog with its own ranked search (the activities
 * have one, and it is better than a substring match — see lib/activities.js)
 * passes it in; anything else gets the plain every-word-must-match filter below,
 * which is the right default and not worth a second implementation.
 */
export function PickerScreen({
  title, sub, icon = 'Layers', placeholder = 'Search',
  groups, onSearch = null, onPick, onClose, footer = null,
}) {
  const [q, setQ] = useState('')
  const query = q.trim()

  // Searching flattens the groups. Keeping them while filtering leaves a column
  // of one-row sections, which is harder to read than the list it came from.
  const hits = query
    ? (onSearch ? onSearch(query) : defaultSearch(groups, query.toLowerCase()))
    : null

  const total = groups.reduce((n, g) => n + g.items.length, 0)

  return (
    <FullScreen title={title} sub={sub} icon={icon} onBack={onClose}>
      <div className="spick-search">
        <Icon name="Target" size={16} />
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder={placeholder} aria-label={`Search ${title}`} />
        {q && (
          <button className="iconbtn" onClick={() => setQ('')} aria-label="Clear">
            <Icon name="X" size={16} />
          </button>
        )}
      </div>

      {hits ? (
        hits.length
          ? <div className="card spick-list list">{hits.map(r => <Row key={r.key} row={r} onPick={onPick} />)}</div>
          : <p className="sub spick-none">Nothing matches “{query}”.</p>
      ) : (
        groups.map(g => (
          <section key={g.key} className="spick-group" aria-label={g.name}>
            <div className="section-head"><h3>{g.name}</h3></div>
            <div className="card spick-list list">
              {g.items.map(r => <Row key={r.key} row={r} onPick={onPick} />)}
            </div>
          </section>
        ))
      )}

      {footer && !query && footer}
      {!total && <p className="sub">Nothing to pick from.</p>}
    </FullScreen>
  )
}

function Row({ row, onPick }) {
  return (
    <button className="list-row spick-row" onClick={() => onPick(row.key)}>
      <Icon name={row.icon || 'Activity'} size={20} />
      <span className="list-row-main">
        <span className="list-row-title">{row.name}</span>
        {row.sub && <span className="list-row-meta">{row.sub}</span>}
      </span>
      {row.meta && <span className="list-row-meta">{row.meta}</span>}
      <Icon name="ChevronRight" size={16} className="list-row-chev" />
    </button>
  )
}

/** Every word has to land somewhere, so "bent row" does not return every row. */
function defaultSearch(groups, q) {
  const words = q.split(/\s+/).filter(Boolean)
  return groups.flatMap(g => g.items).filter(r => {
    const hay = [r.name, r.sub, r.meta, r.search].filter(Boolean).join(' ').toLowerCase()
    return words.every(w => hay.includes(w))
  })
}

/* ------------------------------------------------------- the 91 activities */

/**
 * The activity catalog as picker groups, Recent first.
 *
 * Recent is the quick-log list (lib/quicklog.js): the activities of the newest
 * distinct workouts in `entries`, then the catalog's pinned sports to fill it,
 * so a fresh install leads with its pins as "Your usual" used to (the catalog
 * declares them, `pinned`, so it stays content). Then the catalog's own groups,
 * in its order, and anything whose group it no longer lists.
 */
export function activityGroups(field, plan, entries = []) {
  if (!field) return []
  const row = (a) => ({
    key: a.key, name: a.name, icon: a.icon || 'Activity',
    search: (a.aka || []).join(' '),
  })

  const recent = recentActivities(entries, field)
  const groups = recent.length
    ? [{ key: '_recent', name: 'Recent', items: recent.map(row) }]
    : []

  for (const g of groupedActivities(field)) {
    groups.push({ key: g.name, name: g.name, items: g.items.map(row) })
  }

  // The same orphan rule the sessions follow: an activity whose group the
  // catalog no longer lists must still be reachable, not silently dropped.
  const listed = new Set(groups.filter(g => g.key !== '_recent').flatMap(g => g.items.map(i => i.key)))
  const orphans = activityCatalog(field).activities.filter(a => !listed.has(a.key))
  if (orphans.length) {
    groups.push({ key: '_other', name: 'Everything else', items: orphans.map(row) })
  }
  return groups
}

/* ------------------------------------------------------- the plan's cards */

// `folderName` only in search results, where the folder is not the heading above.
const cardRow = (m, folderName = null) => ({
  key: `card:${m.id}`, name: m.name, sub: folderName, icon: m.icon,
  meta: m.minutes ? `${m.minutes} min` : null,
  search: m.dose,
})

/** The folder rows, after the activities: one per folder with any cards in it. */
export function folderGroup(plan) {
  const folders = climbingFolders(plan)
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
export function folderRows(plan, key) {
  const f = climbingFolders(plan).find(x => x.key === key)
  if (!f) return []
  return f.groups.map(g => ({ ...g, items: g.items.map(m => cardRow(m)) }))
}

/**
 * Log a workout: the one picker, over the plan's cards and the sports catalog.
 *
 * Picking an ACTIVITY does not just open a form with a question in it — it answers
 * the question. The entry lands with `out.activity` already set, so the card opens
 * as a ride or a swim or a lift. Picking a CARD (out of a folder, or straight off
 * a search) places that card, exactly as the old session picker did.
 *
 * `onPick(activityKey)` and `onPickCard(optId)` are the two outcomes. `dayLabel`
 * is the date the pick lands on, said in the header when it is not today, because
 * logging Monday's climb from Wednesday must not look like logging it today.
 * `entries` is the log, for Recent; without it Recent is the catalog's pins.
 * `climbingOnly` is the route from a WHOOP climb on the unlogged card: the
 * catalog is the wrong answer there (AGENTS.md §6.1), so only the folders show.
 */
export function ActivityChooser({
  plan, field, onPick, onPickCard = null, onClose, entries = [],
  dayLabel = null, climbingOnly = false, initialFolder = null,
}) {
  const [folder, setFolder] = useState(initialFolder)
  const climbing = useMemo(() => (onPickCard ? folderGroup(plan) : null), [plan, onPickCard])
  const groups = useMemo(() => [
    ...(climbingOnly ? [] : activityGroups(field, plan, entries)),
    ...(climbing ? [climbing] : []),
  ], [climbing, climbingOnly, field, plan, entries])
  const cards = onPickCard ? folderCards(plan) : []

  const pick = (key) => {
    if (key.startsWith('folder:')) return setFolder(key.slice('folder:'.length))
    if (key.startsWith('card:')) return onPickCard(key.slice('card:'.length))
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
      /* The catalog has its own ranked search, and it is better than a substring
         match: "ru" has to return Run before Ruck. Cards follow, matched on every
         word, so "max hangs" still finds its card without opening a folder. */
      onSearch={(q) => {
        const words = q.toLowerCase().split(/\s+/).filter(Boolean)
        const name = (k) => FOLDERS.find(f => f.key === k)?.name
        const cardHits = cards
          .map(m => cardRow(m, name(folderOf(m))))
          .filter(r => {
            const hay = [r.name, r.sub, r.search].filter(Boolean).join(' ').toLowerCase()
            return words.every(w => hay.includes(w))
          })
        const activityHits = climbingOnly ? [] : searchActivities(field, q).map(a => ({
          key: a.key, name: a.name, icon: a.icon || 'Activity',
        }))
        return [...activityHits, ...cardHits]
      }}
      onPick={pick} onClose={onClose}
    />
  )
}

/** The `type: "activity"` field spec, which carries the sports catalog. */
export function activityFieldOf(plan) {
  for (const opt of plan?.dailyMenu || []) {
    for (const f of opt.outputs || []) if (f.type === 'activity') return f
  }
  return null
}
