/*
 * Chart primitives (app/src/lib/viz.jsx) — hand-rolled SVG, no chart library,
 * drawn with react-native-svg.
 *
 * Colours are the validated dataviz palette stepped for this app's dark surface:
 * categorical slots 1–3 pass all-pairs CVD and contrast; the 4-step load ramp
 * passes the ordinal gates. Don't substitute hexes without re-running
 * app/validate_palette.js — the ordering is the CVD-safety mechanism, not taste.
 *
 * Every chart ships a scrubber and a table view, so identity and value are never
 * carried by colour alone. A chart's head is its title in plain words, at most
 * one line under it, then the latest number; text wears ink, never the series colour. The web's hover layer is a touch scrubber here: tap a
 * point, or press and drag along the chart, and the readout follows the finger.
 */
import React, { useMemo, useState } from 'react'
import {
  ScrollView, StyleSheet, View,
  type GestureResponderEvent, type LayoutChangeEvent,
} from 'react-native'
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg'
import { colors, cssColor, font, radius, space, SERIES as THEME_SERIES } from '../theme'
import { T } from '../ui/Text'
import { Empty, Press } from '../ui/kit'
import { tap } from '../ui/haptics'
import { localIso } from './dates.js'

/** The categorical series, as real colours (the web names them var(--series-n)). */
export const SERIES: string[] = [...THEME_SERIES]

/** ResizeObserver's job, done by onLayout. */
function useWidth(): [(e: LayoutChangeEvent) => void, number] {
  const [w, setW] = useState(0)
  const onLayout = (e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.width)
    setW((cur) => (cur === next ? cur : next))
  }
  return [onLayout, w]
}

/** Axis ticks that land on round numbers rather than raw data extremes. */
function niceScale(min: number, max: number, count = 4, integer = false) {
  if (!isFinite(min) || !isFinite(max)) return { lo: 0, hi: 1, ticks: [0, 1] }
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1
    min -= pad; max += pad
  }
  const raw = (max - min) / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  // A count has no half: a week holds 1 hard day or 2, never 0.5.
  const step = Math.max((norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag, integer ? 1 : 0)
  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(10)))
  return { lo, hi, ticks }
}

/**
 * The left gutter, sized from the widest tick label rather than fixed: a fixed
 * 30px cut the first digit off "3000" once the ticks were on --fs-micro.
 * ~6.6px per character at 11px, plus the 8px gap to the plot.
 */
const padFor = (labels: (string | number)[], min = 30) =>
  Math.max(min, Math.ceil(Math.max(0, ...labels.map(l => String(l).length)) * 6.6) + 12)

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ISO = /^\d{4}-\d{2}-\d{2}$/

/** "Oct 19". By hand, so the phone and the web agree. */
export const fmtDate = (iso: string) => {
  const [, m, d] = String(iso).split('-').map(Number)
  return `${MONTH[m - 1]} ${d}`
}

/** A bar's x: a week's Monday reads as "Oct 19"; anything else as it is. */
const fmtX = (x: any) => (ISO.test(String(x)) ? fmtDate(String(x)) : String(x))

/** Which x labels fit: as many as fit at ~48pt apiece, counted back from the newest. */
const labelEvery = (n: number, innerW: number) => Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 48))))

/*
 * The scrubber. The chart's SVG sits under a View that owns the touch, so
 * locationX is measured against the chart box, then mapped into the viewBox
 * (the web's `(clientX - box.left) / box.width * W`). The readout stays after
 * the finger lifts, the way a tap leaves the web's tooltip up on a phone.
 */
function scrubProps(boxW: number, W: number, pick: (x: number) => number | null, set: (i: number | null) => void) {
  const at = (e: GestureResponderEvent) => {
    if (!boxW) return
    const x = (e.nativeEvent.locationX / boxW) * W
    const i = pick(x)
    set(i)
  }
  return {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderTerminationRequest: () => true,
    onResponderGrant: (e: GestureResponderEvent) => { tap(); at(e) },
    onResponderMove: at,
  }
}

/** .viz-tick, .viz-tip, .viz-tip-sm: axis and tooltip text wear ink tokens, never a series colour. */
const TICK = { fill: colors.vizMuted, fontSize: font.micro } as const
const TIP = { fill: colors.ink, fontSize: font.small, fontWeight: '600' } as const
const TIP_SM = { fill: colors.inkDim, fontSize: font.micro } as const

/** The head every chart shares: its title, one line of help, the latest number, the table switch. */
function VizHead({ label, help, hero, showTable, onTable }: {
  label: string; help?: string | null; hero: React.ReactNode; showTable: boolean; onTable: () => void
}) {
  return (
    <View style={st.head}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T size={font.body} weight={600} lineHeight={19} accessibilityRole="header">{label}</T>
        {help ? <T size={font.small} dim style={{ marginTop: 2 }}>{help}</T> : null}
        <View style={st.hero}>{hero}</View>
      </View>
      <Press haptic onPress={onTable} style={[st.toggle, showTable && st.toggleOn]} accessibilityRole="button"
        accessibilityState={{ selected: showTable }}>
        <T size={font.small} color={showTable ? colors.ink : colors.inkDim}>{showTable ? 'Chart' : 'Table'}</T>
      </Press>
    </View>
  )
}

function Table({ head, rows }: { head: [string, string]; rows: { key: string; a: string; b: string; aNum?: boolean }[] }) {
  return (
    <View style={st.table}>
      <View style={st.tr}>
        <T size={12} weight={500} faint style={st.th}>{head[0]}</T>
        <T size={12} weight={500} faint style={st.th}>{head[1]}</T>
      </View>
      {rows.map((r) => (
        <View key={r.key} style={[st.tr, st.trBody]}>
          <T size={14} tabular={r.aNum} style={st.td}>{r.a}</T>
          <T size={14} tabular style={st.td}>{r.b}</T>
        </View>
      ))}
    </View>
  )
}

/* --------------------------------------------------------------- line chart */

/**
 * points: [{ x: 'YYYY-MM-DD', y: number, note?: string }]
 * One series per chart by design — two measures of different scale get two
 * charts, never a second y-axis.
 *
 * `fmtY` is for ORDINAL series, where the plotted number is a position rather
 * than a quantity: a route grade is a rung on a ladder, and 10.3 − 10.1 is not
 * "0.2 of a grade". Give it a formatter and every value on screen is rendered
 * through it, and the headline reads "5.10 → 5.11" instead of a DIFFERENCE,
 * because subtraction is exactly what an ordinal scale does not support. A
 * formatter may return '' for a value that is not a real step on its scale; that
 * tick keeps its gridline and loses its label.
 */
export function LineChart({ points, label, help, unit = '', height = 190, color = SERIES[0], goal, goalLabel = 'goal', noisePct, fmtY }: {
  points: any[]
  label: string
  help?: string | null
  unit?: string
  height?: number
  color?: string
  goal?: number | null
  goalLabel?: string
  noisePct?: number | null
  fmtY?: ((v: number) => string) | null
}) {
  const [onLayout, w] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const [showTable, setShowTable] = useState(false)
  const stroke = cssColor(color, colors.series1)

  const data = useMemo(
    () => [...(points || [])].filter((p) => Number.isFinite(p.y)).sort((a, b) => a.x.localeCompare(b.x)),
    [points],
  )

  if (!data.length) {
    return <Empty>{`No ${label.toLowerCase()} logged yet.`}</Empty>
  }

  const fmt = fmtY || ((v: number) => `${v}${unit}`)
  const fmtTick = fmtY || ((v: number) => String(v))

  const padR = 16, padT = 14, padB = 26
  const W = Math.max(w, 240)
  const innerH = height - padT - padB

  const ys = data.map((d) => d.y)
  // The noise band: a change that stays inside it is measurement error, not progress.
  // Anchored to the baseline reading, because that is what later tests are compared against.
  const base = data[0].y
  const band = noisePct ? { lo: base * (1 - noisePct / 100), hi: base * (1 + noisePct / 100) } : null
  const domain = [...ys, ...(goal != null ? [goal] : []), ...(band ? [band.lo, band.hi] : [])]
  const { lo, hi, ticks } = niceScale(Math.min(...domain), Math.max(...domain))
  const padL = padFor(ticks.map(fmtTick), 42)
  const innerW = Math.max(W - padL - padR, 10)

  const xAt = (i: number) => padL + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW)
  const yAt = (v: number) => padT + innerH - ((v - lo) / (hi - lo || 1)) * innerH

  const path = data.map((d, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(d.y).toFixed(1)}`).join('')
  const last = data[data.length - 1]
  const first = data[0]
  const delta = data.length > 1 ? last.y - first.y : null

  const nearest = (x: number) => {
    let best = 0, bd = Infinity
    data.forEach((_, i) => { const d = Math.abs(xAt(i) - x); if (d < bd) { bd = d; best = i } })
    return best
  }

  let deltaEl: React.ReactNode = null
  if (delta != null && delta !== 0) {
    const real = !noisePct || Math.abs(delta) > (first.y * noisePct) / 100
    const tone = real ? (delta > 0 ? st.up : st.down) : st.noise
    deltaEl = (
      <T size={font.small} weight={real ? 500 : 400} style={tone}>
        {delta > 0 ? '▲' : '▼'}{' '}
        {fmtY
          ? `${fmt(first.y)} → ${fmt(last.y)} since ${fmtDate(first.x)}`
          : `${Math.abs(Number(delta.toFixed(1)))}${unit} since ${fmtDate(first.x)}`}
        {noisePct && !real ? ' · inside noise' : ''}
      </T>
    )
  }

  const tipX = hover != null ? Math.min(Math.max(xAt(hover), padL + 46), W - padR - 46) : 0

  return (
    <View onLayout={onLayout} style={st.viz}>
      <VizHead label={label} help={help} showTable={showTable} onTable={() => setShowTable((t) => !t)} hero={<>
        <T size={font.heading} weight={600} lineHeight={28} tabular>{fmtY ? fmt(last.y) : String(last.y)}</T>
        {!fmtY && unit ? <T size={font.small} dim>{unit.trim()}</T> : null}
        {deltaEl}
      </>} />

      {showTable ? (
        <Table
          head={['Date', label]}
          rows={[...data].reverse().map((d) => ({ key: d.x, a: fmtDate(d.x), b: fmt(d.y), aNum: true }))}
        />
      ) : (
        <View
          {...scrubProps(w, W, nearest, setHover)}
          accessible
          accessibilityRole="image"
          accessibilityLabel={`${label} over time, latest ${fmt(last.y)}`}
        >
          <View pointerEvents="none">
            <Svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`}>
              {ticks.map((t) => (
                <G key={t}>
                  <Line x1={padL} x2={W - padR} y1={yAt(t)} y2={yAt(t)} stroke={colors.vizGrid} strokeWidth={1} />
                  <SvgText x={padL - 8} y={yAt(t) + 4} textAnchor="end" {...TICK}>{fmtTick(t)}</SvgText>
                </G>
              ))}

              {band && (
                <G>
                  <Rect x={padL} y={yAt(band.hi)} width={W - padL - padR}
                    height={Math.max(yAt(band.lo) - yAt(band.hi), 1)}
                    fill={colors.vizMuted} opacity={0.13} />
                  <Line x1={padL} x2={W - padR} y1={yAt(base)} y2={yAt(base)}
                    stroke={colors.vizMuted} strokeWidth={1} strokeDasharray="2 3" />
                  <SvgText x={padL + 3} y={yAt(band.hi) - 4} {...TICK}>{`±${noisePct}% noise`}</SvgText>
                </G>
              )}

              {goal != null && (
                <G>
                  <Line x1={padL} x2={W - padR} y1={yAt(goal)} y2={yAt(goal)}
                    stroke={colors.vizMuted} strokeWidth={1} strokeDasharray="4 4" />
                  <SvgText x={W - padR} y={yAt(goal) - 5} textAnchor="end" {...TICK}>{`${goalLabel} ${fmt(goal)}`}</SvgText>
                </G>
              )}

              <Path d={path} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

              {data.map((d, i) => (
                <Circle key={d.x + i} cx={xAt(i)} cy={yAt(d.y)} r={hover === i ? 5 : 3}
                  fill={stroke} stroke={colors.panel} strokeWidth={2} />
              ))}

              {hover != null && (
                <Line x1={xAt(hover)} x2={xAt(hover)} y1={padT} y2={padT + innerH}
                  stroke={colors.vizAxis} strokeWidth={1} />
              )}

              <SvgText x={xAt(0)} y={height - 8} textAnchor="start" {...TICK}>{fmtDate(first.x)}</SvgText>
              {data.length > 1 && (
                <SvgText x={xAt(data.length - 1)} y={height - 8} textAnchor="end" {...TICK}>{fmtDate(last.x)}</SvgText>
              )}

              {hover != null && (
                <G transform={`translate(${tipX}, ${padT + 6})`}>
                  <Rect x={-46} y={-4} width={92} height={34} rx={6} fill={colors.panel2} stroke={colors.line} />
                  <SvgText x={0} y={9} textAnchor="middle" {...TIP_SM}>{fmtDate(data[hover].x)}</SvgText>
                  <SvgText x={0} y={24} textAnchor="middle" {...TIP}>{fmt(data[hover].y)}</SvgText>
                </G>
              )}
            </Svg>
          </View>
        </View>
      )}
    </View>
  )
}

/* ----------------------------------------------------------- load calendar */

const LOAD_STEPS = [colors.load1, colors.load2, colors.load3, colors.load4]
const LOAD_NAMES = ['rest', 'light', 'moderate', 'hard', 'max']

/**
 * days: Map of 'YYYY-MM-DD' -> { level: 0..4, label?: string }
 * The daily-habit streak, which is the motivational core of the block — so it
 * gets the most legible form: one cell per day, magnitude by a single-hue ordinal
 * ramp, tap for detail.
 */
export function LoadCalendar({ days, start, end }: { days: Map<string, any>; start: string; end: string }) {
  const [hover, setHover] = useState<{ iso: string; rec: any } | null>(null)

  const weeks = useMemo(() => {
    const out: (string | null)[][] = []
    const cur = new Date(`${start}T12:00:00`)
    cur.setDate(cur.getDate() - ((cur.getDay() + 6) % 7)) // back to Monday: the quota week
    const stop = new Date(`${end}T12:00:00`)
    let week: (string | null)[] = []
    while (cur <= stop) {
      week.push((localIso as any)(cur))
      if (week.length === 7) { out.push(week); week = [] }
      cur.setDate(cur.getDate() + 1)
    }
    if (week.length) { while (week.length < 7) week.push(null); out.push(week) }
    return out
  }, [start, end])

  const cell = 13, gap = 3, padTop = 14
  const W = weeks.length * (cell + gap)
  const H = 7 * (cell + gap) + padTop

  const counted = [...days.values()].filter((d) => d.level > 0).length

  return (
    <View style={st.viz}>
      <View style={st.head}>
        <View>
          <T size={font.body} weight={600} lineHeight={19}>Daily habit</T>
          <View style={st.hero}>
            <T size={font.heading} weight={600} lineHeight={28} tabular>{String(counted)}</T>
            <T size={font.small} dim>days on</T>
          </View>
        </View>
        <View style={st.legend} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <T size={font.micro} color={colors.vizMuted}>less</T>
          {LOAD_STEPS.map((c, i) => <View key={i} style={[st.swatch, { backgroundColor: c }]} />)}
          <T size={font.micro} color={colors.vizMuted}>more</T>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Svg width={W} height={H} accessibilityLabel={`Training calendar, ${counted} days trained`}>
          {weeks.map((week, wi) =>
            week.map((iso, di) => {
              if (!iso) return null
              const rec = days.get(iso)
              const lvl = rec?.level ?? 0
              const inRange = iso >= start && iso <= end
              return (
                <Rect
                  key={iso}
                  x={wi * (cell + gap)} y={padTop + di * (cell + gap)}
                  width={cell} height={cell} rx={3}
                  fill={lvl > 0 ? LOAD_STEPS[lvl - 1] : colors.panel2}
                  stroke={inRange ? colors.vizGrid : 'transparent'}
                  opacity={inRange ? 1 : 0.35}
                  onPress={() => { tap(); setHover((h) => (h?.iso === iso ? null : { iso, rec })) }}
                />
              )
            }),
          )}
        </Svg>
      </ScrollView>

      <T size={font.caption} dim tabular style={st.tipline}>
        {hover
          ? `${hover.iso} — ${hover.rec ? (hover.rec.label || LOAD_NAMES[hover.rec.level]) : 'nothing logged'}`
          : 'Tap a day for detail.'}
      </T>
    </View>
  )
}

/* ------------------------------------------------------------- bar charts */

/**
 * bars: [{ x: label, y: number, tone?: 'ok'|'over'|'under' }]
 * Rounded data-ends anchored to the baseline, 2px surface gap between adjacent
 * bars. `refLine` draws the rule the data is being judged against. An x that is
 * a week's Monday is shown as "Oct 19", and the headline says which week its
 * number is ("week of Oct 19").
 */
export function BarChart({ bars, label, help, unit = '', height = 170, refLine, refLabel, color = SERIES[0] }: {
  bars: any[]
  label: string
  help?: string | null
  unit?: string
  height?: number
  refLine?: number | null
  refLabel?: string | null
  color?: string
}) {
  const [onLayout, w] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const [showTable, setShowTable] = useState(false)
  const fillColor = cssColor(color, colors.series1)

  const data = (bars || []).filter((b) => Number.isFinite(b.y))
  if (!data.length) return <Empty>{`Nothing logged for ${label.toLowerCase()} yet.`}</Empty>

  const padR = 12, padT = 12, padB = 24
  const W = Math.max(w, 240)
  const innerH = height - padT - padB

  const maxY = Math.max(...data.map((d) => d.y), refLine ?? 0)
  const { lo, hi, ticks } = niceScale(0, maxY || 1, 3, data.every((d) => Number.isInteger(d.y)))
  const padL = padFor(ticks)
  const innerW = Math.max(W - padL - padR, 10)

  const slot = innerW / data.length
  const bw = Math.max(Math.min(slot - 2, 34), 4) // 2px surface gap between bars
  const yAt = (v: number) => padT + innerH - ((v - lo) / (hi - lo || 1)) * innerH
  const slotAt = (x: number) => Math.min(Math.max(Math.floor((x - padL) / slot), 0), data.length - 1)
  const every = labelEvery(data.length, innerW)
  const last = data[data.length - 1]
  const weekly = ISO.test(String(last.x))

  return (
    <View onLayout={onLayout} style={st.viz}>
      <VizHead label={label} help={help} showTable={showTable} onTable={() => setShowTable((t) => !t)} hero={<>
        <T size={font.heading} weight={600} lineHeight={28} tabular>{String(last.y)}</T>
        {unit ? <T size={font.small} dim>{unit.trim()}</T> : null}
        {weekly ? <T size={font.small} dim>{`week of ${fmtDate(String(last.x))}`}</T> : null}
      </>} />

      {showTable ? (
        <Table
          head={[weekly ? 'Week of' : '', label]}
          rows={[...data].reverse().map((d, i) => ({ key: `${d.x}${i}`, a: fmtX(d.x), b: `${d.y}${unit}`, aNum: true }))}
        />
      ) : (
        <View {...scrubProps(w, W, slotAt, setHover)} accessible accessibilityRole="image" accessibilityLabel={`${label}, latest ${last.y}${unit}`}>
          <View pointerEvents="none">
            <Svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`}>
              {ticks.map((t) => (
                <G key={t}>
                  <Line x1={padL} x2={W - padR} y1={yAt(t)} y2={yAt(t)} stroke={colors.vizGrid} strokeWidth={1} />
                  <SvgText x={padL - 7} y={yAt(t) + 4} textAnchor="end" {...TICK}>{String(t)}</SvgText>
                </G>
              ))}

              {refLine != null && (
                <G>
                  <Line x1={padL} x2={W - padR} y1={yAt(refLine)} y2={yAt(refLine)}
                    stroke={colors.vizWarn} strokeWidth={1.5} strokeDasharray="5 4" />
                  {refLabel ? <SvgText x={W - padR} y={yAt(refLine) - 5} textAnchor="end" {...TICK}>{refLabel}</SvgText> : null}
                </G>
              )}

              {data.map((d, i) => {
                const x = padL + i * slot + (slot - bw) / 2
                const h = Math.max(padT + innerH - yAt(d.y), 0)
                const fill = d.tone === 'over' ? colors.vizCrit : d.tone === 'under' ? colors.vizMuted : fillColor
                return (
                  <Rect key={d.x + i} x={x} y={yAt(d.y)} width={bw} height={h} rx={Math.min(4, bw / 2)} fill={fill}
                    opacity={hover == null || hover === i ? 1 : 0.55} />
                )
              })}

              {data.map((d, i) => (
                (data.length - 1 - i) % every === 0 ? (
                  <SvgText key={`l${i}`} x={padL + i * slot + slot / 2} y={height - 7}
                    textAnchor="middle" {...TICK}>{fmtX(d.x)}</SvgText>
                ) : null
              ))}
            </Svg>
          </View>
        </View>
      )}
      <T size={font.caption} dim tabular style={st.tipline}>
        {hover != null && data[hover]
          ? `${weekly ? `Week of ${fmtX(data[hover].x)}` : fmtX(data[hover].x)}: ${data[hover].y}${unit}`
          : (refLabel || ' ')}
      </T>
    </View>
  )
}

const st = StyleSheet.create({
  viz: { marginTop: space[1] },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[3], marginBottom: space[2] },
  hero: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: space[2], marginTop: space[1] },
  up: { color: colors.vizGood },
  down: { color: colors.vizWarn },
  noise: { color: colors.inkDim },
  // Chart / Table: a word, bordered like a ghost button at chip height.
  toggle: {
    minHeight: 36, paddingHorizontal: space[3], justifyContent: 'center',
    borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.control,
  },
  toggleOn: { backgroundColor: colors.panel3 },
  table: { marginTop: space[1] },
  tr: { flexDirection: 'row' },
  trBody: { borderTopWidth: 1, borderTopColor: colors.line },
  th: { flex: 1, paddingVertical: 6, paddingHorizontal: space[2] },
  td: { flex: 1, paddingVertical: 9, paddingHorizontal: space[2] },
  legend: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  swatch: { width: 11, height: 11, borderRadius: 3 },
  tipline: { marginTop: space[2], minHeight: 18 },
})
