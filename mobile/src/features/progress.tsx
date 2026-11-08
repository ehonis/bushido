/*
 * Progress: how it is going, for whatever you are asking about.
 * (app/src/progress.jsx)
 *
 * Rebuilt 2026-09-15. The old page drew about twenty charts every time, nineteen
 * of them about climbing. The fix is not fewer charts, it is a QUESTION first:
 * pick a category, a single sport or one lift, and the page draws the charts that
 * mean something for that — see lib/metrics.js, where each one declares when it
 * applies. Climbing charts come LAST (issue #31): a workout log first.
 *
 * Wave 2 (issue #43): the page LEADS with the answer, workouts and time for the
 * period, in one card with the period under them; categories are chips only
 * when there is more than one; "Just one thing" is a row that opens a list. The
 * paragraph explaining why these charts and not others went.
 *
 * Two questions since #81: what kind of thing (lib/scope.js `ACTIVITY_SCOPES`,
 * the Log's row too), then the plan's categories inside it; under Climbing, a
 * whole grade. One row used to mix Bike with Fingers, a sport beside an intent.
 *
 * Everything here is presentation. The filter is `lib/scope.js` and the charts
 * are `lib/metrics.js`, both pure and tested as arithmetic on the web.
 */
import React, { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors, font, space } from '../theme'
import { T } from '../ui/Text'
import { Btn, Card, Chip, Divider, Empty, H2, Row, Segmented } from '../ui/kit'
import { showMenu } from '../ui/menu'
import { LineChart, BarChart, Pyramid, SERIES } from '../lib/viz'
import { localIso } from '../lib/dates.js'
import { EMPTY_SCOPE, resolveScope, scopeOptions } from '../lib/scope.js'
import { metricsFor, totalsFor, bodyweightSeries } from '../lib/metrics.js'
import { ChipRow, ScreenTitle, SubFilter, SubChip, subFilterLabel } from './filters'
import { Explain } from './blurb'

const RANGES = [
  { weeks: 4, label: '4 wk' },
  { weeks: 8, label: '8 wk' },
  { weeks: 26, label: '6 mo' },
  { weeks: null, label: 'All' },
]
const rangeKey = (weeks: number | null) => (weeks == null ? 'all' : String(weeks))

/** Minutes as the headline says them: "45 min", "4.5 h", "28 h". */
function timeLabel(minutes: number) {
  const m = Math.round(Number(minutes) || 0)
  if (m < 60) return { value: String(m), unit: 'min' }
  const h = m / 60
  return { value: String(h < 10 ? Math.round(h * 10) / 10 : Math.round(h)), unit: 'h' }
}

export function ProgressView({ plan, entries, initialScope = EMPTY_SCOPE }: any) {
  const today = (localIso as any)()
  const [scope, setScope] = useState<any>(initialScope)

  /*
   * The options come from the WHOLE log, not from the current window. Otherwise
   * narrowing the range empties the filter bar of the thing you are filtering by,
   * and the control you just used disappears under your finger.
   */
  const options = useMemo(
    () => (scopeOptions as any)({ plan, entries, today, weeks: null, activity: scope.activity }),
    [plan, entries, today, scope.activity])

  const resolved = useMemo(
    () => (resolveScope as any)({ plan, entries, scope, today }),
    [plan, entries, scope, today])

  const groups = useMemo(() => (metricsFor as any)(plan, resolved), [plan, resolved])
  const totals = useMemo(() => (totalsFor as any)(plan, resolved), [plan, resolved])

  const set = (patch: any) => setScope((sc: any) => ({ ...sc, ...patch }))
  const narrowed = Boolean(scope.activity || scope.category || scope.session || scope.exercise || scope.band)
  const clear = () => setScope((sc: any) => ({ ...EMPTY_SCOPE, weeks: sc.weeks }))
  // What the numbers are OF, in words, whenever it is not everything, beside the
  // way back, so a page narrowed from a row further down never passes for the whole log.
  const named = (list: any[], v: any) => (list || []).find((o: any) => o.value === v)?.label || v
  const narrowedTo = [
    scope.activity && named(options.activities, scope.activity),
    scope.category && named(options.categories, scope.category),
    scope.session && named(options.sessions, scope.session),
    scope.exercise && named(options.exercises, scope.exercise),
    scope.band && named(options.bands, scope.band),
  ].filter(Boolean).join(' · ')
  const loggedAny = options.sessions.length > 0

  // The categories are the second question: under the activity picked, or, when
  // only one kind of thing is logged, under that one.
  const oneActivity = options.activities.length === 1 ? options.activities[0].value : null
  const within = scope.activity || oneActivity
  const showCats = Boolean(within) && options.categories.length > 1
  // A whole grade, offered only inside Climbing and only once something was graded.
  const showBands = within === 'climbing' && options.bands.length > 0
  const pickActivity = (v: string) => setScope((sc: any) => ({
    ...EMPTY_SCOPE, weeks: sc.weeks, activity: sc.activity === v ? null : v,
  }))

  // Bodyweight is not a workout, so it is not in the scope — but it is the one
  // series worth seeing next to the volume. It keeps to the page's period (F17).
  const bw = useMemo(() => (bodyweightSeries as any)(entries, resolved.from), [entries, resolved.from])

  if (!loggedAny) {
    return (
      <Empty icon="Gauge">
        <T size={font.body} dim align="center">Nothing logged yet</T>
        <Explain><T size={font.label} dim align="center">Log a workout and your weeks show up here.</T></Explain>
      </Empty>
    )
  }

  const time = timeLabel(totals.minutes)
  const extra = [
    `${totals.days} day${totals.days === 1 ? '' : 's'}`,
    totals.miles > 0 ? `${totals.miles} mi` : null,
    totals.yards > 0 ? `${totals.yards.toLocaleString()} yd swum` : null,
  ].filter(Boolean).join(' · ')

  return (
    <>
      <ScreenTitle>Progress</ScreenTitle>
      <Card>
        {narrowed ? (
          <View style={st.scope}>
            <T size={font.body} weight={600} numberOfLines={1} style={{ flex: 1 }}>{narrowedTo}</T>
            <Btn kind="quiet" small icon="X" title="Clear" onPress={clear} />
          </View>
        ) : null}
        <View style={st.nums}>
          <View style={st.num}>
            <T size={font.stat} weight={600} tabular>{String(totals.sessions)}</T>
            <T size={font.label} dim>{totals.sessions === 1 ? 'Workout' : 'Workouts'}</T>
          </View>
          <View style={st.num}>
            <T size={font.stat} weight={600} tabular>
              {time.value}<T size={font.body} dim>{` ${time.unit}`}</T>
            </T>
            <T size={font.label} dim>Time</T>
          </View>
        </View>
        {totals.sessions > 0 ? <T size={font.label} dim style={{ marginTop: space[2] }}>{extra}</T> : null}
        <Segmented
          style={st.seg}
          value={rangeKey(scope.weeks)}
          onChange={(v) => set({ weeks: RANGES.find(r => rangeKey(r.weeks) === v)!.weeks })}
          options={RANGES.map(r => ({ value: rangeKey(r.weeks), label: r.label }))}
        />
      </Card>

      {options.activities.length > 1 && (
        <ChipRow style={st.cats}>
          {/* "All" is lit only when nothing is narrowed. */}
          <Chip small label="All" on={!narrowed} onPress={clear} />
          {options.activities.map((o: any) => (
            <Chip key={o.value} small label={o.label} on={scope.activity === o.value}
              onPress={() => pickActivity(o.value)} />
          ))}
        </ChipRow>
      )}

      {showCats && (
        <SubFilter label={subFilterLabel(options.activities.find((a: any) => a.value === within)?.label)}>
          {options.categories.map((o: any) => (
            <SubChip key={o.value} label={o.label} on={scope.category === o.value}
              onPress={() => set({ category: scope.category === o.value ? null : o.value, session: null, exercise: null })} />
          ))}
        </SubFilter>
      )}

      <Card style={st.picks}>
        <ScopePick label="Just one thing" options={options.sessions} value={scope.session}
          onPick={(v: any) => set({ session: v, exercise: null })} all="Any workout" />
        {showBands && (
          <>
            <Divider />
            <ScopePick label="Grade" options={options.bands} value={scope.band}
              onPick={(v: any) => set({ band: v })} all="Any grade" />
          </>
        )}
        {options.exercises.length > 0 && (
          <>
            <Divider />
            <ScopePick label="One lift" options={options.exercises} value={scope.exercise}
              onPick={(v: any) => set({ exercise: v })} all="Any exercise" />
          </>
        )}
      </Card>

      {resolved.isEmpty ? (
        <Empty>
          <T size={font.body} dim align="center">{narrowed ? 'Nothing logged for that' : 'Nothing logged in these weeks'}</T>
          {narrowed
            ? <Btn kind="secondary" title="Show everything" onPress={clear} />
            : <Btn kind="secondary" title="Show all time" onPress={() => set({ weeks: null })} />}
        </Empty>
      ) : (
        groups.map((g: any) => (
          <Card key={g.name}>
            <H2 style={{ marginBottom: space[3] }}>{g.name}</H2>
            {g.metrics.map((m: any, i: number) => (
              <View key={m.key} style={i > 0 ? st.metricNext : null}>
                {/* One series per chart, so one colour: a colour that changed from
                    chart to chart would claim a difference that is not there. */}
                {m.kind === 'pyramid'
                  ? <Pyramid rows={m.points} label={m.label} help={m.help} color={SERIES[0]} />
                  : m.kind === 'bar'
                  ? <BarChart bars={m.points} label={m.label} help={m.help} unit={m.unit || ''}
                      refLine={m.ref} refLabel={m.refLabel} color={SERIES[0]} />
                  : <LineChart points={m.points} label={m.label} help={m.help} unit={m.unit || ''}
                      fmtY={m.fmtY} noisePct={m.noisePct} color={SERIES[0]} />}
              </View>
            ))}
          </Card>
        ))
      )}

      {bw.length > 1 && !narrowed && (
        <Card>
          <H2 style={{ marginBottom: space[3] }}>Body</H2>
          <LineChart points={bw} label="Bodyweight" unit=" lb" color={SERIES[0]} />
        </Card>
      )}
    </>
  )
}

/**
 * "Just one thing" and "One lift": a row that says what is picked and opens the
 * list as a system action sheet (the web's native select).
 */
function ScopePick({ label, options, value, onPick, all }: any) {
  if (!options?.length) return null
  const cur = options.find((o: any) => o.value === value)
  const open = () => showMenu([
    { label: all, onPress: () => onPick(null) },
    ...options.map((o: any) => ({ label: o.label, onPress: () => onPick(o.value) })),
  ], { title: label })
  return <Row label={label} value={cur ? cur.label : all} onPress={open} />
}

const st = StyleSheet.create({
  scope: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: -space[2], marginRight: -space[3], marginBottom: space[2] },
  nums: { flexDirection: 'row', gap: space[4] },
  num: { flex: 1, minWidth: 0, gap: 2 },
  seg: { marginTop: space[4], marginBottom: 0 },
  cats: { marginBottom: space[3] },
  picks: { paddingVertical: 0 },
  metricNext: { marginTop: space[6], paddingTop: space[4], borderTopWidth: 1, borderTopColor: colors.line },
})
