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
 *   ACTIVITIES the 91-sport catalog, grouped as the catalog groups itself, with
 *              their six pinned sports first. Picking one puts the workout card on
 *              the day with the activity already answered.
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
 * they need somewhere to press.
 *
 * The right-hand column says what each row COSTS or IS: minutes for a card,
 * the category for an activity, the card count for a folder.
 */

import { useMemo, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import { FullScreen } from './modal.jsx'
import {
  catalogOf as activityCatalog, groupedActivities, pinnedActivities, searchActivities,
} from './lib/activities.js'
import { climbingFolders, folderCards, folderOf, FOLDERS } from './lib/folders.js'

export { groupedSessions, climbingFolders } from './lib/folders.js'

/* ------------------------------------------------------------ the screen */

/**
 * A grouped list of things you can pick, full screen.
 *
 * `groups` is `[{ key, name, icon, items: [{ key, name, sub, icon, meta }] }]`.
 * `onSearch` is optional: a catalog with its own ranked search (the activities
 * have one, and it is better than a substring match — see lib/activities.js)
 * passes it in; anything else gets the plain every-word-must-match filter below,
 * which is the right default and not worth a second implementation.
 */
export function PickerScreen({
  title, sub, icon = 'Layers', lead, placeholder,
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
        <Icon name="Target" size={15} />
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder={placeholder} aria-label={`Search ${title}`} />
        {q && (
          <button className="modal-btn" onClick={() => setQ('')} aria-label="Clear">
            <Icon name="X" size={16} />
          </button>
        )}
      </div>

      {lead && !query && <p className="sub spick-lead">{lead}</p>}

      {hits ? (
        <div className="spick-group">
          <div className="spick-grouphead">
            <Icon name="Target" size={14} />
            <span>{hits.length} match{hits.length === 1 ? '' : 'es'}</span>
          </div>
          {hits.map(r => <Row key={r.key} row={r} onPick={onPick} />)}
          {!hits.length && <p className="sub">Nothing matches that.</p>}
        </div>
      ) : (
        groups.map(g => (
          <div key={g.key} className="spick-group">
            <div className="spick-grouphead">
              <Icon name={g.icon} size={14} />
              <span>{g.name}</span>
              <span className="spick-n">{g.items.length}</span>
            </div>
            {g.items.map(r => <Row key={r.key} row={r} onPick={onPick} />)}
          </div>
        ))
      )}

      {footer && !query && footer}
      {!total && <p className="sub">Nothing to pick from.</p>}
    </FullScreen>
  )
}

function Row({ row, onPick }) {
  return (
    <button className="spick-row" onClick={() => onPick(row.key)}>
      <span className="spick-ico"><Icon name={row.icon} size={17} /></span>
      <span className="spick-body">
        <strong>{row.name}</strong>
        {row.sub && <span className="sub">{row.sub}</span>}
      </span>
      {row.meta && <span className="spick-min">{row.meta}</span>}
      <span className="spick-chev">
        <Icon name="ChevronDown" size={15} style={{ transform: 'rotate(-90deg)' }} />
      </span>
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
 * The activity catalog as picker groups, their pinned sports first.
 *
 * The pins are a real group rather than a styling trick, because that is what
 * they are: the six sports that are the overwhelming majority of what the user logs.
 * The catalog declares which (`pinned`), so it stays content — see
 * activitypicker.jsx, which has offered them as one-tap chips inside the form
 * since the day the catalog landed.
 *
 * `meta` is the CATEGORY, not the group. The group is already the heading above
 * the row, so the right-hand column says what it files under instead.
 */
export function activityGroups(field, plan) {
  if (!field) return []
  const catName = (key) =>
    (plan?.quotaCategories || []).find(c => c.key === key)?.name || null

  const row = (a) => ({
    key: a.key, name: a.name, icon: a.icon || 'Activity',
    meta: catName(a.category),
    search: (a.aka || []).join(' '),
  })

  const pins = pinnedActivities(field)
  const groups = pins.length
    ? [{ key: '_pinned', name: 'Your usual', icon: 'Flame', items: pins.map(row) }]
    : []

  for (const g of groupedActivities(field)) {
    groups.push({ key: g.name, name: g.name, icon: g.items[0]?.icon || 'Activity', items: g.items.map(row) })
  }

  // The same orphan rule the sessions follow: an activity whose group the
  // catalog no longer lists must still be reachable, not silently dropped.
  const listed = new Set(groups.flatMap(g => g.items.map(i => i.key)))
  const orphans = activityCatalog(field).activities.filter(a => !listed.has(a.key))
  if (orphans.length) {
    groups.push({ key: '_other', name: 'Everything else', icon: 'Sparkles', items: orphans.map(row) })
  }
  return groups
}

/* ------------------------------------------------------- the plan's cards */

const cardRow = (m, folderName = null) => ({
  key: `card:${m.id}`, name: m.name, sub: folderName || m.tier, icon: m.icon,
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
    key: '_climbing', name: climbing ? 'Climbing' : 'Your plan', icon: climbing ? 'Mountain' : 'Layers',
    items: folders.map(f => ({
      key: `folder:${f.key}`, name: f.name, icon: f.icon,
      sub: 'Sessions from the plan', meta: `${f.count}`,
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
 * `onPick(activityKey)` and `onPickCard(optId)` are the two outcomes. `day` is
 * the date the pick lands on, said in the header when it is not today, because
 * logging Monday's climb from Wednesday must not look like logging it today.
 * `climbingOnly` is the route from a WHOOP climb on the unlogged card: the
 * catalog is the wrong answer there (AGENTS.md §6.1), so only the folders show.
 */
export function ActivityChooser({
  plan, field, onPick, onPickCard = null, onClose,
  dayLabel = null, climbingOnly = false, initialFolder = null,
}) {
  const [folder, setFolder] = useState(initialFolder)
  const climbing = useMemo(() => (onPickCard ? folderGroup(plan) : null), [plan, onPickCard])
  const groups = useMemo(() => [
    ...(climbingOnly ? [] : activityGroups(field, plan)),
    ...(climbing ? [climbing] : []),
  ], [climbing, climbingOnly, field, plan])
  const n = activityCatalog(field).activities.length
  const cards = onPickCard ? folderCards(plan) : []

  const pick = (key) => {
    if (key.startsWith('folder:')) return setFolder(key.slice('folder:'.length))
    if (key.startsWith('card:')) return onPickCard(key.slice('card:'.length))
    return onPick(key)
  }

  if (folder) {
    const f = FOLDERS.find(x => x.key === folder)
    const rows = folderRows(plan, folder)
    return (
      <PickerScreen
        title={f?.name || 'Climbing'}
        sub={[`${rows.reduce((k, g) => k + g.items.length, 0)} in the plan`, dayLabel].filter(Boolean).join(' · ')}
        icon={f?.icon || 'Mountain'}
        placeholder={`Search ${(f?.name || 'the plan').toLowerCase()}…`}
        lead="The plan's own sessions, in the order it declares them. Each one asks the
          hard-finger question, so the finger budget sees what you did."
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
      placeholder={climbingOnly ? 'board, 4×4, ARC, crag day…' : 'run, mountain bike, bench press, erg…'}
      lead={climbingOnly
        ? 'Which session was it? WHOOP recorded the climb; the card asks the hard-finger question.'
        : 'Something you already did. Pick it and the form arrives the right shape: a ride '
          + 'asks for distance, a swim for yards, a lift for the exercises.'}
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
          meta: (plan?.quotaCategories || []).find(c => c.key === a.category)?.name || null,
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
