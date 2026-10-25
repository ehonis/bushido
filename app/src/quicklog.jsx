/*
 * The quick-log rows: + → Run (docs/DESIGN.md, "Logging in two taps").
 *
 *   <QuickLog plan entries upsertEntry date onPlaced />
 *
 * Up to three activities (lib/quicklog.js: the newest distinct ones logged, then
 * the catalog's pins), each a row that writes the workout on `date` with the
 * activity answered and hands the new entry's id to `onPlaced`, which opens its
 * sheet. The entry exists from the tap and is done by default (AGENTS.md §4), so
 * there is nothing to save: the sheet is for adding numbers, and closing it keeps
 * what is there.
 *
 * The + menu puts it under Log a workout; Today's empty day puts it in its empty
 * state. Renders nothing when there is nothing to offer (no catalog, no card).
 */

import { useMemo } from 'react'
import { Icon } from './lib/icons.jsx'
import { activityFieldOf } from './picker.jsx'
import { recentActivities, quickEntry, QUICK_CARD } from './lib/quicklog.js'

export function QuickLog({ plan, entries = [], upsertEntry, date = null, onPlaced = null }) {
  const field = activityFieldOf(plan)
  const menu = plan?.dailyMenu || []
  const rows = useMemo(() => recentActivities(entries, field), [entries, field])
  if (!rows.length || !menu.some(o => o.id === QUICK_CARD)) return null

  const place = (activity) => {
    const entry = quickEntry({ menu, entries, activity, date })
    if (!entry) return
    upsertEntry(entry)
    onPlaced?.(entry.id)
  }

  return (
    <div className="list quicklog">
      {rows.map(a => (
        <button key={a.key} type="button" className="list-row quicklog-row"
          onClick={() => place(a.key)} aria-label={`Log ${a.name}`}>
          <Icon name={a.icon || 'Activity'} size={20} />
          <span className="list-row-main"><span className="list-row-title">{a.name}</span></span>
          <Icon name="ChevronRight" size={16} className="list-row-chev" />
        </button>
      ))}
    </div>
  )
}
