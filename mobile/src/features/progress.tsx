/*
 * Progress: how it is going, for whatever you are asking about.
 * (app/src/progress.jsx)
 *
 * Rebuilt 2026-09-15. The old page drew about twenty charts every time, nineteen
 * of them about climbing. The fix is not fewer charts, it is a QUESTION first:
 * pick an achievement, a category, a single sport or one lift, and the page draws
 * the charts that mean something for that — see lib/metrics.js, where each one
 * declares when it applies.
 *
 * Everything here is presentation. The filter is `lib/scope.js` and the charts
 * are `lib/metrics.js`, both pure and tested as arithmetic on the web.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors } from '../theme'
import { T } from '../ui/Text'
import { Card, H2, Press, Sub, s as kit } from '../ui/kit'
import { showMenu } from '../ui/menu'
import { Icon } from '../lib/icons'
import { LineChart, BarChart, StatTile, SERIES } from '../lib/viz'
import { Blurb } from './blurb'
import { localIso } from '../lib/dates.js'
import { EMPTY_SCOPE, resolveScope, scopeOptions, describeScope } from '../lib/scope.js'
import { metricsFor, totalsFor } from '../lib/metrics.js'
import { achievements } from '../lib/achievements.js'
import { profileFacts } from '../lib/profile.js'

const RANGES = [
  { weeks: 4, label: '4 wk' },
  { weeks: 8, label: '8 wk' },
  { weeks: 26, label: '6 mo' },
  { weeks: null, label: 'All' },
]

const GROUP_ICON: Record<string, string> = {
  Volume: 'Layers',
  Distance: 'Route',
  Climbing: 'Mountain',
  Strength: 'Dumbbell',
  Effort: 'HeartPulse',
  'This session': 'FlaskConical',
}

export function ProgressView({ plan, entries }: any) {
  const today = (localIso as any)()
  const [scope, setScope] = useState<any>(EMPTY_SCOPE)
  const [tilesW, setTilesW] = useState(0)

  /*
   * The options come from the WHOLE log, not from the current window. Otherwise
   * narrowing the range empties the filter bar of the thing you are filtering by,
   * and the control you just used disappears under your finger.
   */
  const achs = useMemo(
    () => (achievements as any)(plan, entries, (profileFacts as any)(entries)), [plan, entries])

  const options = useMemo(
    () => (scopeOptions as any)({ plan, entries, today, weeks: null, achievements: achs }),
    [plan, entries, today, achs])

  /*
   * Drop a filter pointing at an achievement that no longer exists, rather than a
   * permanently empty page headed by the name of something that is gone.
   */
  useEffect(() => {
    if (scope.achievement && !achs.some((a: any) => a.id === scope.achievement)) {
      setScope((sc: any) => ({ ...sc, achievement: null }))
    }
  }, [achs, scope.achievement])

  const resolved = useMemo(
    () => (resolveScope as any)({ plan, entries, scope, today, achievements: achs }),
    [plan, entries, scope, today, achs])

  const groups = useMemo(() => (metricsFor as any)(plan, resolved), [plan, resolved])
  const totals = useMemo(() => (totalsFor as any)(plan, resolved), [plan, resolved])

  const set = (patch: any) => setScope((sc: any) => ({ ...sc, ...patch }))
  const narrowed = Boolean(scope.achievement || scope.category || scope.session || scope.exercise)

  // Bodyweight is not a workout, so it is not in the scope — but it is the one
  // series worth seeing next to the volume, and it belongs to no filter.
  const bw = useMemo(() => entries
    .filter((e: any) => e.kind === 'bodyweight' && !e.deleted && e.date && Number(e.data?.lb) > 0)
    .map((e: any) => ({ x: e.date, y: Number(e.data.lb) }))
    .sort((a: any, b: any) => String(a.x).localeCompare(String(b.x))), [entries])

  // .tiles: auto-fit columns of at least 132pt, which is two on a phone.
  const cols = tilesW ? Math.max(1, Math.floor((tilesW + 10) / (132 + 10))) : 2
  const tileW = tilesW ? (tilesW - 10 * (cols - 1)) / cols : undefined
  const tile = (key: string, el: React.ReactNode) => (
    <View key={key} style={{ width: tileW ?? '47%' }}>{el}</View>
  )

  return (
    <>
      <Card style={{ paddingBottom: 6 }}>
        <View style={st.scopeHead}>
          <H2 style={{ marginBottom: 12, flex: 1 }}>{(describeScope as any)({ plan, scope, options })}</H2>
          {narrowed && (
            <Press haptic onPress={() => setScope((sc: any) => ({ ...EMPTY_SCOPE, weeks: sc.weeks }))}
              accessibilityRole="button" style={st.clear} hitSlop={10}>
              <Icon name="X" size={13} color={colors.inkFaint} />
              <T size={12} faint>Clear</T>
            </Press>
          )}
        </View>

        <ScopeRow label="Achievement" options={options.achievements} value={scope.achievement}
          onPick={(v: any) => set({ achievement: v, category: null, session: null, exercise: null })} />

        <ScopeRow label="Category"
          options={scope.achievement
            ? options.categories.filter((c: any) => c.achievement === scope.achievement)
            : options.categories}
          value={scope.category}
          onPick={(v: any) => set({ category: v, session: null, exercise: null })} />

        <ScopePick label="Just one thing" options={options.sessions} value={scope.session}
          onPick={(v: any) => set({ session: v, exercise: null })} all="Any workout" />

        {options.exercises.length > 0 && (
          <ScopePick label="One lift" options={options.exercises} value={scope.exercise}
            onPick={(v: any) => set({ exercise: v })} all="Any exercise" />
        )}

        <View style={st.row}>
          <T size={11} faint caps style={st.rowLabel}>Since</T>
          <View style={st.opts}>
            {RANGES.map(r => (
              <ChipBtn key={r.label} on={scope.weeks === r.weeks} label={r.label}
                onPress={() => set({ weeks: r.weeks })} />
            ))}
          </View>
        </View>
      </Card>

      {resolved.isEmpty ? (
        <Card>
          <H2>Nothing here</H2>
          <Sub style={{ margin: 0 }}>
            {'No workouts match that. '}
            {scope.weeks
              ? <>Try <T size={13} weight={700}>All</T> for the range, or clear a filter.</>
              : 'Clear a filter to widen it.'}
          </Sub>
        </Card>
      ) : (
        <>
          <View style={st.tiles} onLayout={(e) => setTilesW(e.nativeEvent.layout.width)}>
            {tile('w', <StatTile icon="Flame" label="Workouts" value={totals.sessions}
              sub={`${totals.days} day${totals.days === 1 ? '' : 's'}`} />)}
            {tile('h', <StatTile icon="Timer" label="Hours" value={totals.hours} />)}
            {totals.miles > 0 && tile('m', <StatTile icon="Route" label="Miles" value={totals.miles} />)}
            {totals.yards > 0 && tile('y', <StatTile icon="Waves" label="Yards swum" value={totals.yards} />)}
            {totals.hardFingerDays > 0 && tile('f',
              <StatTile icon="Hand" label="Hard finger days" value={totals.hardFingerDays} />)}
            {tile('l', <StatTile icon="Gauge" label="Load" value={totals.load.toLocaleString()}
              sub="RPE × minutes" />)}
          </View>

          {groups.map((g: any) => (
            <Card key={g.name}>
              <View style={st.h2Row}>
                <Icon name={GROUP_ICON[g.name] || 'Gauge'} size={16} />
                <H2 style={{ marginBottom: 0 }}>{g.name}</H2>
              </View>
              {g.metrics.map((m: any, i: number) => (
                <View key={m.key} style={i > 0 ? st.metricNext : null}>
                  {m.help ? <Sub size={12} style={st.help}>{m.help}</Sub> : null}
                  {m.kind === 'bar'
                    ? <BarChart bars={m.points} label={m.label} unit={m.unit || ''}
                        refLine={m.ref} refLabel={m.refLabel}
                        color={SERIES[i % SERIES.length]} />
                    : <LineChart points={m.points} label={m.label} unit={m.unit || ''}
                        fmtY={m.fmtY} noisePct={m.noisePct}
                        color={SERIES[i % SERIES.length]} />}
                </View>
              ))}
            </Card>
          ))}
        </>
      )}

      {bw.length > 1 && !narrowed && (
        <Card>
          <View style={st.h2Row}>
            <Icon name="PersonStanding" size={16} />
            <H2 style={{ marginBottom: 0 }}>Bodyweight</H2>
          </View>
          <Sub size={12} style={st.help}>
            Not a workout, so no filter touches it — but it is what half the other
            numbers get divided by.
          </Sub>
          <LineChart points={bw} label="Bodyweight" unit=" lb" color={SERIES[2]} />
        </Card>
      )}

      <Blurb id="progress-how" title="Why these charts and not others" tone="card">
        <Sub style={{ margin: 0 }}>
          Each chart declares when it means anything, and the page draws the ones that do —
          so filtering to the half iron drops every finger chart, and filtering to one lift
          brings up its top set. A line needs two points before it is a trend rather than a
          dot with an axis. The very specific climbing numbers — critical force, 4×4 rest,
          straddle reach — are declared by the sessions themselves in{' '}
          <T size={13} mono style={st.code}>plan.json</T>,
          and show up under <T size={13} weight={700}>This session</T> when that session is in scope.
        </Sub>
      </Blurb>
    </>
  )
}

/** .chip with a faint count, as the scope rows draw them. */
function ChipBtn({ on, label, icon, n, onPress }: { on: boolean; label: string; icon?: string; n?: any; onPress: () => void }) {
  const fg = on ? colors.ink : colors.inkDim
  return (
    <Press haptic onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
      style={[kit.chip, on && kit.chipOn]}>
      {icon ? <Icon name={icon} size={13} color={fg} /> : null}
      <T size={13} color={fg}>
        {label}
        {n !== undefined && n !== null ? <T size={13} color={fg} style={{ opacity: 0.5 }}>{` ${n}`}</T> : null}
      </T>
    </Press>
  )
}

/** A row of chips where one can be on, or none. */
function ScopeRow({ label, options, value, onPick }: any) {
  if (!options?.length) return null
  return (
    <View style={st.row}>
      <T size={11} faint caps style={st.rowLabel}>{label}</T>
      <View style={st.opts}>
        {options.map((o: any) => (
          <ChipBtn key={o.value} on={value === o.value} icon={o.icon} label={o.label} n={o.n}
            onPress={() => onPick(value === o.value ? null : o.value)} />
        ))}
      </View>
    </View>
  )
}

/**
 * A select, for the lists that are too long to be chips — as a system action
 * sheet. Twenty-four things logged and two hundred exercises do not fit on a
 * phone as buttons.
 */
function ScopePick({ label, options, value, onPick, all }: any) {
  if (!options?.length) return null
  const cur = options.find((o: any) => o.value === value)
  const open = () => showMenu([
    { label: all, onPress: () => onPick(null) },
    ...options.map((o: any) => ({ label: `${o.label} (${o.n})`, onPress: () => onPick(o.value) })),
  ], { title: label })
  return (
    <View style={st.row}>
      <T size={11} faint caps style={st.rowLabel}>{label}</T>
      <Press onPress={open} accessibilityRole="button" accessibilityLabel={label} style={st.select}>
        <T size={15} numberOfLines={1} style={{ flex: 1 }}>{cur ? `${cur.label} (${cur.n})` : all}</T>
        <Icon name="ChevronDown" size={16} color={colors.inkFaint} />
      </Press>
    </View>
  )
}

const st = StyleSheet.create({
  scopeHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  clear: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  // .scoperow under 520px: the label above its options.
  row: { gap: 4, paddingVertical: 7, borderTopWidth: 1, borderTopColor: colors.line },
  rowLabel: { paddingTop: 2 },
  opts: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  select: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 10,
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: 10,
  },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  h2Row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  metricNext: { marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.line },
  help: { marginTop: -2, marginBottom: 8 },
  code: { backgroundColor: colors.panel2 },
})
