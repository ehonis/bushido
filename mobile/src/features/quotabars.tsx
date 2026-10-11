/*
 * The week, as bars (app/src/quotabars.jsx).
 *
 * What leads Today since 2026-09-17, replacing the quota BOARD — eleven lanes,
 * each an offer, ranked by what the week still owed. The board answered "what
 * should I do", and the answer turned out to be that the app should not have one.
 *
 * So this says where the week stands and stops. Nothing here is pressable into a
 * session, nothing is dismissible, and there is no ranking — a bar is a reading.
 *
 * Three rules it keeps from the board that were right:
 *
 *   - Categories the user ASKED for lead, in the order plan.json declares them.
 *     Sorting by what is outstanding reorders the list under their thumb.
 *   - What the user did that nothing asked for still shows, quietly. A screen
 *     that hides it disagrees with the log.
 *   - Over-quota is shown as over, not clipped at full.
 */
import React, { useMemo, useState } from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { colors, alpha, mix } from '../theme'
import { T } from '../ui/Text'
import { Card, H2, Press } from '../ui/kit'
import { Icon } from '../lib/icons'
import { progress as quotaProgress, mondayOf, weekDays } from '../lib/quota.js'
import { fromIso } from '../lib/dates.js'
import { optFor } from '../lib/menu.js'
import { sessionStats } from '../lib/stats.js'

/*
 * `onOpenEntry(date, entryId)` replaced `onOpenDay(date)` on 2026-09-21. The row
 * used to set the day and nothing else — pressing a workout from TODAY moved
 * nowhere at all. What the row is FOR is the session it names, so it opens it.
 */
export function QuotaBars({ plan, entries, iso, onSetWeek = null, onOpenEntry = null }: {
  plan: any
  entries: any[]
  iso: string
  onSetWeek?: (() => void) | null
  onOpenEntry?: ((date: string, id: string) => void) | null
}) {
  const week: any = useMemo(() => (quotaProgress as any)({ plan, entries, iso }), [plan, entries, iso])
  /*
   * Which bar is open, if any. Tapping a quota opens the workouts already done
   * that filled it. That does NOT undo the rule above: a bar that opens onto what
   * the user already did is still a reading. One at a time: two open panels on a
   * card with eleven rows is a card you scroll rather than read.
   */
  const [open, setOpen] = useState<string | null>(null)

  const asked = week.categories.filter((c: any) => c.planned > 0)
  // Logged into a category the week never asked for. Kept, quiet, at the bottom.
  const extra = week.categories.filter((c: any) => c.planned === 0 && c.done > 0)

  const left = (weekDays as any)(week.monday).filter((d: string) => d >= iso).length
  const owed = week.plannedTotal - week.doneTotal

  const bar = (c: any) => (
    <Bar key={c.key} cat={c} open={open === c.key} plan={plan}
      onToggle={() => setOpen(open === c.key ? null : c.key)}
      onOpenEntry={onOpenEntry} />
  )

  if (!week.isSet) {
    return (
      <Card>
        <View style={st.head}>
          <H2 style={{ marginBottom: 0, flex: 1 }}>This week</H2>
          <T size={13} faint tabular>nothing set</T>
        </View>
        <T size={13} dim style={{ marginTop: 4, marginBottom: 14 }}>
          {`No quotas for the week of ${fromIso(week.monday).toLocaleDateString([], { month: 'long', day: 'numeric' })} yet. `}
          {'A quota is a count of workouts, not days, and nothing is assigned to a weekday — '}
          {'set them on the Week tab and they fill in here as you log.'}
        </T>
        {extra.length > 0 && <View style={st.rows}>{extra.map(bar)}</View>}
        {onSetWeek && <SetWeek label={'Set this week’s quotas'} onPress={onSetWeek} />}
      </Card>
    )
  }

  return (
    <Card>
      <View style={st.head}>
        <H2 style={{ marginBottom: 0, flex: 1 }}>This week</H2>
        <T size={13} faint tabular>
          <T size={15} weight={600} tabular>{String(week.doneTotal)}</T>
          {` of ${week.plannedTotal}`}
        </T>
      </View>

      <T size={12.5} faint lineHeight={19} style={{ marginTop: 6, marginBottom: 14 }}>
        {owed > 0
          ? <>
              {`${owed} workout${owed === 1 ? '' : 's'} still asked for, with ${left} day${left === 1 ? '' : 's'} left in the week.`}
              {/* What the dotted part of the bars is, said once here rather than
                  legended on every row. Agreement is on the PLANNED count. */}
              {week.pendingTotal > 0 && (owed === 1
                ? ' It is already on a day — the dotted part of the bar.'
                : ` ${week.pendingTotal} of them ${week.pendingTotal === 1 ? 'is' : 'are'} already on a day — the dotted part of the bars.`)}
            </>
          : 'Everything this week asked for is done. Anything else is extra, and extra is allowed.'}
      </T>

      <View style={st.rows}>{asked.map(bar)}</View>

      {extra.length > 0 && (
        <>
          <T size={10} caps faint style={{ marginTop: 16, marginBottom: 8, letterSpacing: 0.8 }}>Not asked for this week</T>
          <View style={st.rows}>{extra.map(bar)}</View>
        </>
      )}

      {onSetWeek && <SetWeek label="Change what this week asks for" onPress={onSetWeek} />}
    </Card>
  )
}

/** .qb-set: the dashed door to the Week tab. */
function SetWeek({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Press haptic onPress={onPress} accessibilityRole="button" style={st.set}>
      <Icon name="CalendarDays" size={15} color={colors.inkFaint} />
      <T size={13} faint>{label}</T>
    </Press>
  )
}

/** The dotted continuation: the CSS's repeating gradient, as stripes. */
function Dots() {
  return (
    <View style={{ flexDirection: 'row', height: '100%', overflow: 'hidden' }}>
      {Array.from({ length: 80 }, (_, i) => (
        <View key={i} style={{ width: 5, marginRight: 5, height: '100%', borderRadius: 999, backgroundColor: alpha(colors.accent, 0.4) }} />
      ))}
    </View>
  )
}

/**
 * One category: the bar, and what filled it.
 *
 * `done / planned` clamped at full, with anything past it a separate `+n` — a
 * 150% bar reads as a rendering bug, "3/2 +1" reads as a good week. A planned
 * session not yet done carries on from the solid fill as a dotted segment.
 *
 * A category with no quota gets no track at all: there is nothing to be a
 * fraction OF. A row with nothing on it either side is not pressable — an empty
 * panel is a worse answer than no panel.
 */
function Bar({ cat, open = false, plan = null, onToggle = null, onOpenEntry = null }: {
  cat: any
  open?: boolean
  plan?: any
  onToggle?: (() => void) | null
  onOpenEntry?: ((date: string, id: string) => void) | null
}) {
  const { width } = useWindowDimensions()
  const { planned, done, over, complete, pendingShown } = cat
  const pct = planned > 0 ? Math.min(1, done / planned) : 0
  const soon = planned > 0 ? Math.min(1 - pct, pendingShown / planned) : 0

  const filled = [
    ...(cat.entries || []).map((e: any) => ({ e, done: true })),
    ...(cat.pendingEntries || []).map((e: any) => ({ e, done: false })),
  ].sort((a, b) => String(a.e.date).localeCompare(String(b.e.date)))

  const label = [
    `${done} of ${planned} done`,
    pendingShown > 0 ? `${pendingShown} planned` : null,
  ].filter(Boolean).join(', ')

  const unasked = planned === 0
  const nameColor = complete ? colors.ink : unasked ? colors.inkFaint : colors.inkDim
  // Fixed width, not auto: the tracks share a left edge so the eye compares fills.
  // Wide enough for "Power endurance".
  const narrow = width <= 380

  const body = (
    <>
      <Icon name={cat.icon} size={16} color={complete ? colors.ink : colors.inkFaint} />
      <T size={narrow ? 12 : 12.5} color={nameColor} numberOfLines={1} style={{ width: narrow ? 104 : 124 }}>{cat.name}</T>
      {planned > 0 ? (
        <View style={st.track}
          accessibilityRole="progressbar"
          accessibilityLabel={`${cat.name}: ${label}`}
          accessibilityValue={{ min: 0, max: planned, now: done }}>
          <View style={[st.fill, { width: `${Math.round(pct * 100)}%`, backgroundColor: complete ? colors.vizGood : colors.accent }]} />
          {soon > 0 && <View style={{ width: `${Math.round(soon * 100)}%`, height: '100%' }}><Dots /></View>}
        </View>
      ) : (
        <View style={[st.track, st.ghost]} accessibilityElementsHidden importantForAccessibility="no" />
      )}
      <View style={st.n}>
        <T size={12.5} tabular color={unasked ? colors.inkFaint : colors.inkDim}>
          {planned > 0 ? `${done}/${planned}` : `${done}`}
        </T>
        {over > 0 && <T size={11} weight={600} color={colors.accent}>{`+${over}`}</T>}
        {complete && !over && <Icon name="Check" size={14} color={colors.vizGood} />}
      </View>
    </>
  )

  if (!filled.length || !onToggle) {
    return <View style={st.row}>{body}</View>
  }

  return (
    <>
      <Press haptic onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }}
        accessibilityHint={label} style={[st.row, { minHeight: 32 }]}>
        {body}
        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={14} color={open ? colors.accent : colors.inkFaint} />
      </Press>

      {open && (
        <View style={st.what}>
          {filled.map(({ e, done }) => {
            const opt = optFor(plan?.dailyMenu || [], e.data?.optId)
            // Everything the day list would say about it, minus the minutes, which
            // have their own column on this row.
            const stats = (sessionStats as any)(e, opt).filter((b: string) => !/^\d+ min$/.test(b))
            return (
              <Press key={e.id} haptic onPress={() => onOpenEntry?.(e.date, e.id)}
                disabled={!onOpenEntry} accessibilityRole="button"
                style={[st.did, !done && st.didPlanned]}>
                <T size={11} faint tabular style={{ width: 52 }}>{dayLabel(e.date)}</T>
                <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <T size={13} color={done ? colors.ink : colors.inkDim} numberOfLines={1} style={{ flexShrink: 1 }}>
                      {e.data?.name || 'Session'}
                    </T>
                    {opt?.icon && <Icon name={opt.icon} size={12} color={colors.inkFaint} />}
                  </View>
                  {stats.length > 0 && <T size={11} faint numberOfLines={1}>{stats.join(' · ')}</T>}
                </View>
                <T size={11.5} faint tabular>
                  {e.data?.minutes ? `${e.data.minutes} min` : ''}
                  {!done && <T size={11.5} color={colors.accent}> · planned</T>}
                </T>
                {onOpenEntry && <Icon name="ChevronRight" size={13} color={colors.inkFaint} />}
              </Press>
            )
          })}
        </View>
      )}
    </>
  )
}

/** "Mon 15" — enough to find the day, short enough for a narrow column. */
const dayLabel = (iso: string) => {
  try {
    return fromIso(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric' })
  } catch { return iso }
}

export { mondayOf }

const st = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  rows: { gap: 9 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  track: {
    flex: 1, minWidth: 40, height: 8, borderRadius: 999, flexDirection: 'row',
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, overflow: 'hidden',
  },
  ghost: { backgroundColor: 'transparent', borderStyle: 'dashed' },
  fill: { height: '100%', borderRadius: 999 },
  n: { minWidth: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  set: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 14, minHeight: 44, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, borderRadius: 8,
  },
  what: {
    gap: 4, marginTop: 2, marginBottom: 8, marginLeft: 26, padding: 8,
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: 9,
  },
  did: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 44, paddingVertical: 5, paddingHorizontal: 8, borderRadius: 7 },
  // A planned one is dotted, matching the dotted part of the bar above it.
  didPlanned: { borderLeftWidth: 2, borderStyle: 'dashed', borderColor: mix(colors.accent, 50, colors.panel2) },
})
