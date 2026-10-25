/*
 * The quick-log rows: + → Run. Ported from app/src/quicklog.jsx; same props.
 *
 *   <QuickLog plan entries upsertEntry date onPlaced />
 *
 * Up to three activities (lib/quicklog.js: the newest distinct ones logged, then
 * the catalog's pins), each a row that writes the workout on `date` with the
 * activity answered and hands the new entry's id to `onPlaced`, which opens its
 * sheet. The entry exists from the tap and is done by default (AGENTS.md §4), so
 * there is nothing to save. Renders nothing when there is nothing to offer.
 */
import React, { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors, font, space } from '../theme'
import { Icon } from '../lib/icons'
import { T } from '../ui/Text'
import { Press, s as kit } from '../ui/kit'
import { impact } from '../ui/haptics'
import { activityFieldOf } from './picker'
import { recentActivities, quickEntry, QUICK_CARD } from '../lib/quicklog.js'

export function QuickLog({ plan, entries = [], upsertEntry, date = null, onPlaced = null, style }: {
  plan: any
  entries?: any[]
  upsertEntry: (entry: any) => void
  date?: string | null
  onPlaced?: ((id: string) => void) | null
  style?: any
}) {
  const field = activityFieldOf(plan)
  const menu: any[] = plan?.dailyMenu || []
  const rows: any[] = useMemo(() => (recentActivities as any)(entries, field), [entries, field])
  if (!rows.length || !menu.some((o) => o.id === QUICK_CARD)) return null

  const place = (activity: string) => {
    const entry = (quickEntry as any)({ menu, entries, activity, date })
    if (!entry) return
    impact()
    upsertEntry(entry)
    onPlaced?.(entry.id)
  }

  return (
    <View style={style}>
      {rows.map((a, i) => (
        <Press key={a.key} onPress={() => place(a.key)} accessibilityRole="button" accessibilityLabel={`Log ${a.name}`}
          style={[kit.row, i > 0 && st.rule]}>
          <Icon name={a.icon || 'Activity'} size={20} color={colors.inkDim} />
          <T size={font.body} weight={500} numberOfLines={1} style={{ flex: 1 }}>{a.name}</T>
          <Icon name="ChevronRight" size={16} color={colors.inkFaint} />
        </Press>
      ))}
    </View>
  )
}

const st = StyleSheet.create({
  // Rows are the kit's Row size (the web's .list-row, 52); the + menu passes the
  // indent that lines them up under Log a workout.
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
})
