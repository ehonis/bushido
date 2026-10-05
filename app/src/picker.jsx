/*
 * One picker, two catalogs.
 *
 * Pick a session and log a workout are the same action over two different
 * lists, so log a workout uses the same UI as pick a session, just with every
 * activity category to pick from.
 *
 * The first version had them as two different interactions for no reason:
 * *pick a session* was a grouped full-screen list, and *log a workout* created
 * an entry and dropped the user into a form whose first question was a
 * collapsed search box. Same job — choose one thing out of a long grouped list —
 * done two ways. So there is one screen now, `PickerScreen`, and the two things
 * that differ are the rows it is handed and what a tap does with them.
 *
 * WHAT THE TWO CATALOGS ARE.
 *
 *   SESSIONS   the plan's own cards — max hangs, the board, 4×4s, the load-cell
 *              tests — grouped by the quota category each declares. Picking one
 *              puts it on the day with its protocol, cues and timer.
 *   ACTIVITIES the 91-sport catalog, grouped as the catalog groups itself, with
 *              their six pinned sports first. Picking one puts the workout card on
 *              the day with the activity already answered, so the form is
 *              already the right shape when it opens.
 *
 * NEITHER RANKS. That is the whole difference between this and the swap list it
 * replaced: a list of doors, in the order the content file declares them, with a
 * search box. The user already knows what the user did; the user needs somewhere to press.
 *
 * The right-hand column says what each row COSTS or FILLS — minutes for a
 * session, the quota category for an activity — because "which of these counts
 * as my bike quota" is a real question and the answer is one word.
 */

import { useMemo, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import { FullScreen } from './modal.jsx'
import {
  catalogOf as activityCatalog, groupedActivities, pinnedActivities, searchActivities,
} from './lib/activities.js'

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

/* --------------------------------------------------------- the plan's own */

/** Everything you can put on a day, grouped the way the app talks about them. */
export function groupedSessions(plan) {
  const menu = plan?.dailyMenu || []
  const cats = plan?.quotaCategories || []
  const startable = menu.filter(m =>
    m.role !== 'adjunct' && m.role !== 'rest' && !m.retired)

  const groups = cats
    .map(c => ({
      key: c.key,
      name: c.name,
      icon: c.icon,
      // Plan order inside a category. Authored, stable, and not a ranking — a
      // list that reorders itself under their thumb is the thing being removed.
      items: startable.filter(m => (m.category || m.categoryFrom) === c.key),
    }))
    .filter(g => g.items.length > 0)

  // A card that names no category, or names one the plan no longer declares.
  const claimed = new Set(groups.flatMap(g => g.items.map(m => m.id)))
  const rest = startable.filter(m => !claimed.has(m.id))
  if (rest.length) groups.push({ key: '_other', name: 'Everything else', icon: 'Sparkles', items: rest })

  return groups
}

const sessionRows = (groups) => groups.map(g => ({
  ...g,
  items: g.items.map(m => ({
    key: m.id, name: m.name, sub: m.tier, icon: m.icon,
    meta: m.minutes ? `${m.minutes} min` : null,
    search: m.dose,
  })),
}))

export function SessionPicker({ plan, onPick, onClose }) {
  const groups = useMemo(() => sessionRows(groupedSessions(plan)), [plan])
  const total = groups.reduce((n, g) => n + g.items.length, 0)
  const rest = (plan?.dailyMenu || []).find(m => m.role === 'rest')

  return (
    <PickerScreen
      title="Pick a session" sub={`${total} in the plan`} icon="Layers"
      placeholder="max hangs, 4×4, ARC, crag day…"
      lead="Every session the plan declares, in the order it declares them. Nothing here is
        ranked or recommended — pick the one you came for."
      groups={groups} onPick={onPick} onClose={onClose}
      footer={rest && (
        /* Resting is still something the user does on purpose, and its button went with
           the recommendation it used to sit under. */
        <button className="spick-rest" onClick={() => onPick(rest.id)}>
          <Icon name={rest.icon} size={17} />
          <span>Take a rest day</span>
        </button>
      )}
    />
  )
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
 * `meta` is the QUOTA CATEGORY, not the group. The group is already the heading
 * above the row, and "which of these fills my bike quota" is the question the
 * right-hand column can actually answer.
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

/**
 * Log a workout: the same screen, over the sports catalog.
 *
 * Picking one does NOT just open a form with a question in it — it answers the
 * question. The entry lands with `out.activity` already set, so the card opens as
 * a ride or a swim or a lift rather than as a search box with a form hidden
 * behind it.
 */
export function ActivityChooser({ plan, field, onPick, onClose }) {
  const groups = useMemo(() => activityGroups(field, plan), [field, plan])
  const n = activityCatalog(field).activities.length

  return (
    <PickerScreen
      title="Log a workout" sub={`${n} activities`} icon="NotebookPen"
      placeholder="mountain bike, dance, pickleball, erg…"
      lead="Something you already did. Pick it and the form arrives the right shape —
        a ride asks for distance and elevation, a swim for yards, a lift for the exercises."
      groups={groups}
      /* The catalog has its own ranked search, and it is better than a substring
         match: "ru" has to return Run before Ruck. See lib/activities.js. */
      onSearch={(q) => searchActivities(field, q).map(a => ({
        key: a.key, name: a.name, icon: a.icon || 'Activity',
        meta: (plan?.quotaCategories || []).find(c => c.key === a.category)?.name || null,
      }))}
      onPick={onPick} onClose={onClose}
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
