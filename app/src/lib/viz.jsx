/*
 * Chart primitives — hand-rolled SVG, no chart library.
 *
 * Colours are the validated dataviz palette stepped for this app's dark surface
 * (#1c1a16): categorical slots 1–3 pass all-pairs CVD and contrast; the 4-step
 * load ramp passes the ordinal gates. Don't substitute hexes without re-running
 * scripts/validate_palette.js — the ordering is the CVD-safety mechanism, not taste.
 *
 * Every chart ships a hover layer and a table view, so identity and value are
 * never carried by colour alone.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './icons.jsx'
import { localIso } from './dates.js'

export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)']

function useWidth() {
  const ref = useRef(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

/** Axis ticks that land on round numbers rather than raw data extremes. */
function niceScale(min, max, count = 4) {
  if (!isFinite(min) || !isFinite(max)) return { lo: 0, hi: 1, ticks: [0, 1] }
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1
    min -= pad; max += pad
  }
  const raw = (max - min) / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag
  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step
  const ticks = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(10)))
  return { lo, hi, ticks }
}

const fmtDate = iso =>
  new Date(`${iso}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })

/* --------------------------------------------------------------- line chart */

/**
 * points: [{ x: 'YYYY-MM-DD', y: number, note?: string }]
 * One series per chart by design — two measures of different scale get two
 * charts, never a second y-axis.
 *
 * `fmtY` is for ORDINAL series, where the plotted number is a position rather
 * than a quantity: a route grade is a rung on a ladder, and 10.3 − 10.1 is not
 * "0.2 of a grade". Give it a formatter and two things change — every value on
 * screen is rendered through it, and the headline stops reporting a DIFFERENCE
 * and reads "5.10 → 5.11" instead, because subtraction is exactly the operation
 * an ordinal scale does not support. A formatter may return '' for a value that
 * is not a real step on its scale; that tick keeps its gridline and loses its
 * label, rather than inventing a rung between two rungs.
 */
export function LineChart({ points, label, unit = '', height = 190, color = SERIES[0], goal, goalLabel = 'goal', noisePct, fmtY }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState(null)
  const [showTable, setShowTable] = useState(false)

  const data = useMemo(
    () => [...(points || [])].filter(p => Number.isFinite(p.y)).sort((a, b) => a.x.localeCompare(b.x)),
    [points],
  )

  if (!data.length) {
    return <div className="empty">No {label.toLowerCase()} logged yet.</div>
  }

  const fmt = fmtY || (v => `${v}${unit}`)
  const fmtTick = fmtY || (v => String(v))

  const padL = 42, padR = 16, padT = 14, padB = 26
  const W = Math.max(w, 240)
  const innerW = Math.max(W - padL - padR, 10)
  const innerH = height - padT - padB

  const ys = data.map(d => d.y)
  // The noise band: a change that stays inside it is measurement error, not progress.
  // Anchored to the baseline reading, because that is what later tests are compared against.
  const base = data[0].y
  const band = noisePct ? { lo: base * (1 - noisePct / 100), hi: base * (1 + noisePct / 100) } : null
  const domain = [...ys, ...(goal != null ? [goal] : []), ...(band ? [band.lo, band.hi] : [])]
  const { lo, hi, ticks } = niceScale(Math.min(...domain), Math.max(...domain))

  const xAt = i => padL + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW)
  const yAt = v => padT + innerH - ((v - lo) / (hi - lo || 1)) * innerH

  const path = data.map((d, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(d.y).toFixed(1)}`).join('')
  const last = data[data.length - 1]
  const first = data[0]
  const delta = data.length > 1 ? last.y - first.y : null

  const onMove = e => {
    // Touch events carry no clientX of their own — read the first touch point.
    const pt = e.touches?.[0] ?? e
    if (pt.clientX == null) return
    const box = e.currentTarget.getBoundingClientRect()
    const x = ((pt.clientX - box.left) / box.width) * W
    let best = 0, bd = Infinity
    data.forEach((_, i) => { const d = Math.abs(xAt(i) - x); if (d < bd) { bd = d; best = i } })
    setHover(best)
  }

  return (
    <div ref={ref} className="viz">
      <div className="viz-head">
        <div>
          <div className="viz-title">{label}</div>
          <div className="viz-hero">
            {fmtY ? fmt(last.y) : last.y}
            {!fmtY && <span className="viz-unit">{unit}</span>}
            {delta != null && delta !== 0 && (() => {
              const real = !noisePct || Math.abs(delta) > (first.y * noisePct) / 100
              return (
                <span className={`viz-delta ${real ? (delta > 0 ? 'up' : 'down') : 'noise'}`}>
                  {delta > 0 ? '▲' : '▼'}{' '}
                  {fmtY
                    ? `${fmt(first.y)} → ${fmt(last.y)} since ${fmtDate(first.x)}`
                    : `${Math.abs(Number(delta.toFixed(1)))}${unit} since ${fmtDate(first.x)}`}
                  {noisePct && !real && ' · inside noise'}
                </span>
              )
            })()}
          </div>
        </div>
        <button className="viz-toggle" onClick={() => setShowTable(t => !t)} aria-pressed={showTable}>
          {showTable ? 'chart' : 'table'}
        </button>
      </div>

      {showTable ? (
        <table className="viz-table">
          <thead><tr><th>Date</th><th>{label}</th></tr></thead>
          <tbody>
            {[...data].reverse().map(d => (
              <tr key={d.x}><td className="num">{d.x}</td><td className="num">{fmt(d.y)}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <svg
          width="100%" height={height} viewBox={`0 0 ${W} ${height}`} role="img"
          aria-label={`${label} over time, latest ${fmt(last.y)}`}
          onMouseMove={onMove} onMouseLeave={() => setHover(null)}
          onTouchStart={onMove} onTouchMove={onMove}
        >
          {ticks.map(t => (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={yAt(t)} y2={yAt(t)} stroke="var(--viz-grid)" strokeWidth="1" />
              <text x={padL - 8} y={yAt(t) + 4} textAnchor="end" className="viz-tick">{fmtTick(t)}</text>
            </g>
          ))}

          {band && (
            <g>
              <rect x={padL} y={yAt(band.hi)} width={W - padL - padR}
                height={Math.max(yAt(band.lo) - yAt(band.hi), 1)}
                fill="var(--viz-muted)" opacity="0.13" />
              <line x1={padL} x2={W - padR} y1={yAt(base)} y2={yAt(base)}
                stroke="var(--viz-muted)" strokeWidth="1" strokeDasharray="2 3" />
              <text x={padL + 3} y={yAt(band.hi) - 4} className="viz-tick">±{noisePct}% noise</text>
            </g>
          )}

          {goal != null && (
            <g>
              <line x1={padL} x2={W - padR} y1={yAt(goal)} y2={yAt(goal)}
                stroke="var(--viz-muted)" strokeWidth="1" strokeDasharray="4 4" />
              <text x={W - padR} y={yAt(goal) - 5} textAnchor="end" className="viz-tick">{goalLabel} {fmt(goal)}</text>
            </g>
          )}

          <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

          {data.map((d, i) => (
            <circle key={d.x + i} cx={xAt(i)} cy={yAt(d.y)} r={hover === i ? 5 : 3}
              fill={color} stroke="var(--panel)" strokeWidth="2" />
          ))}

          {hover != null && (
            <line x1={xAt(hover)} x2={xAt(hover)} y1={padT} y2={padT + innerH}
              stroke="var(--viz-axis)" strokeWidth="1" />
          )}

          <text x={xAt(0)} y={height - 8} textAnchor="start" className="viz-tick">{fmtDate(first.x)}</text>
          {data.length > 1 && (
            <text x={xAt(data.length - 1)} y={height - 8} textAnchor="end" className="viz-tick">{fmtDate(last.x)}</text>
          )}

          {hover != null && (
            <g transform={`translate(${Math.min(Math.max(xAt(hover), padL + 46), W - padR - 46)}, ${padT + 6})`}>
              <rect x={-46} y={-4} width={92} height={34} rx={6}
                fill="var(--panel-2)" stroke="var(--line)" />
              <text x={0} y={9} textAnchor="middle" className="viz-tip-sm">{fmtDate(data[hover].x)}</text>
              <text x={0} y={24} textAnchor="middle" className="viz-tip">{fmt(data[hover].y)}</text>
            </g>
          )}
        </svg>
      )}
    </div>
  )
}

/* ----------------------------------------------------------- load calendar */

const LOAD_STEPS = ['var(--load-1)', 'var(--load-2)', 'var(--load-3)', 'var(--load-4)']
const LOAD_NAMES = ['rest', 'light', 'moderate', 'hard', 'max']

/**
 * days: Map of 'YYYY-MM-DD' -> { level: 0..4, label?: string }
 * The daily-habit streak, which is the motivational core of the block — so it
 * gets the most legible form: one cell per day, magnitude by a single-hue ordinal
 * ramp, hover for detail.
 */
export function LoadCalendar({ days, start, end }) {
  const [hover, setHover] = useState(null)

  const weeks = useMemo(() => {
    const out = []
    const cur = new Date(`${start}T12:00:00`)
    cur.setDate(cur.getDate() - ((cur.getDay() + 6) % 7)) // back to Monday: the quota week
    const stop = new Date(`${end}T12:00:00`)
    let week = []
    while (cur <= stop) {
      week.push(localIso(cur))
      if (week.length === 7) { out.push(week); week = [] }
      cur.setDate(cur.getDate() + 1)
    }
    if (week.length) { while (week.length < 7) week.push(null); out.push(week) }
    return out
  }, [start, end])

  const cell = 13, gap = 3, padTop = 14
  const W = weeks.length * (cell + gap)
  const H = 7 * (cell + gap) + padTop

  const counted = [...days.values()].filter(d => d.level > 0).length

  return (
    <div className="viz">
      <div className="viz-head">
        <div>
          <div className="viz-title">Daily habit</div>
          <div className="viz-hero">{counted}<span className="viz-unit">days on</span></div>
        </div>
        <div className="viz-legend" aria-hidden="true">
          <span className="viz-tick">less</span>
          {LOAD_STEPS.map((c, i) => <span key={i} className="viz-swatch" style={{ background: c }} />)}
          <span className="viz-tick">more</span>
        </div>
      </div>

      <div className="viz-scroll">
        <svg width={W} height={H} role="img" aria-label={`Training calendar, ${counted} days trained`}>
          {weeks.map((week, wi) =>
            week.map((iso, di) => {
              if (!iso) return null
              const rec = days.get(iso)
              const lvl = rec?.level ?? 0
              const inRange = iso >= start && iso <= end
              return (
                <rect
                  key={iso}
                  x={wi * (cell + gap)} y={padTop + di * (cell + gap)}
                  width={cell} height={cell} rx={3}
                  fill={lvl > 0 ? LOAD_STEPS[lvl - 1] : 'var(--panel-2)'}
                  stroke={inRange ? 'var(--viz-grid)' : 'transparent'}
                  opacity={inRange ? 1 : 0.35}
                  onMouseEnter={() => setHover({ iso, rec })}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => setHover(h => (h?.iso === iso ? null : { iso, rec }))}
                  style={{ cursor: 'pointer' }}
                />
              )
            }),
          )}
        </svg>
      </div>

      <div className="viz-tipline">
        {hover
          ? `${hover.iso} — ${hover.rec ? (hover.rec.label || LOAD_NAMES[hover.rec.level]) : 'nothing logged'}`
          : 'Tap a day for detail.'}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ tiles */

export function StatTile({ label, value, unit, sub, tone, icon }) {
  return (
    <div className={`tile ${tone || ''}`}>
      <div className="tile-label">
        {icon && <Icon name={icon} size={12} className="tile-icon" />} {label}
      </div>
      <div className="tile-value">{value}<span className="viz-unit">{unit}</span></div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  )
}

/** Countdown to the trip — the number that makes the block feel real. */
export function useDaysUntil(dateIso) {
  const [n, setN] = useState(() => diffDays(dateIso))
  useEffect(() => {
    const iv = setInterval(() => setN(diffDays(dateIso)), 60000)
    return () => clearInterval(iv)
  }, [dateIso])
  return n
}

function diffDays(dateIso) {
  if (!dateIso) return null
  const target = new Date(`${dateIso}T12:00:00`)
  const now = new Date()
  return Math.ceil((target - now) / 86400000)
}

/* ------------------------------------------------------------- bar charts */

/**
 * bars: [{ x: label, y: number, tone?: 'ok'|'over'|'under' }]
 * Rounded data-ends anchored to the baseline, 2px surface gap between adjacent
 * bars. `refLine` draws the rule the data is being judged against — e.g. the
 * hard-finger-days-per-week cap.
 */
export function BarChart({ bars, label, unit = '', height = 170, refLine, refLabel, color = SERIES[0] }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState(null)
  const [showTable, setShowTable] = useState(false)

  const data = (bars || []).filter(b => Number.isFinite(b.y))
  if (!data.length) return <div className="empty">Nothing logged for {label.toLowerCase()} yet.</div>

  const padL = 30, padR = 12, padT = 12, padB = 24
  const W = Math.max(w, 240)
  const innerW = Math.max(W - padL - padR, 10)
  const innerH = height - padT - padB

  const maxY = Math.max(...data.map(d => d.y), refLine ?? 0)
  const { lo, hi, ticks } = niceScale(0, maxY || 1, 3)

  const slot = innerW / data.length
  const bw = Math.max(Math.min(slot - 2, 34), 4) // 2px surface gap between bars
  const yAt = v => padT + innerH - ((v - lo) / (hi - lo || 1)) * innerH

  return (
    <div ref={ref} className="viz">
      <div className="viz-head">
        <div>
          <div className="viz-title">{label}</div>
          <div className="viz-hero">
            {data.at(-1).y}<span className="viz-unit">{unit}</span>
          </div>
        </div>
        <button className="viz-toggle" onClick={() => setShowTable(t => !t)} aria-pressed={showTable}>
          {showTable ? 'chart' : 'table'}
        </button>
      </div>

      {showTable ? (
        <table className="viz-table">
          <thead><tr><th>Week</th><th>{label}</th></tr></thead>
          <tbody>{[...data].reverse().map(d => (
            <tr key={d.x}><td>{d.x}</td><td className="num">{d.y}{unit}</td></tr>))}</tbody>
        </table>
      ) : (
        <svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`} role="img"
          aria-label={`${label} by week`} onMouseLeave={() => setHover(null)}>
          {ticks.map(t => (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={yAt(t)} y2={yAt(t)} stroke="var(--viz-grid)" strokeWidth="1" />
              <text x={padL - 7} y={yAt(t) + 4} textAnchor="end" className="viz-tick">{t}</text>
            </g>
          ))}

          {refLine != null && (
            <g>
              <line x1={padL} x2={W - padR} y1={yAt(refLine)} y2={yAt(refLine)}
                stroke="var(--viz-warn)" strokeWidth="1.5" strokeDasharray="5 4" />
              {refLabel && <text x={W - padR} y={yAt(refLine) - 5} textAnchor="end" className="viz-tick">{refLabel}</text>}
            </g>
          )}

          {data.map((d, i) => {
            const x = padL + i * slot + (slot - bw) / 2
            const h = Math.max(padT + innerH - yAt(d.y), 0)
            const fill = d.tone === 'over' ? 'var(--viz-crit)' : d.tone === 'under' ? 'var(--viz-muted)' : color
            return (
              <g key={d.x + i} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
                <rect x={x} y={yAt(d.y)} width={bw} height={h} rx={Math.min(4, bw / 2)} fill={fill}
                  opacity={hover == null || hover === i ? 1 : 0.55} />
                <rect x={x} y={padT} width={bw} height={innerH} fill="transparent" />
              </g>
            )
          })}

          {data.map((d, i) => (
            (data.length <= 12 || i % 2 === 0) && (
              <text key={`l${i}`} x={padL + i * slot + slot / 2} y={height - 7}
                textAnchor="middle" className="viz-tick">{d.x}</text>
            )
          ))}
        </svg>
      )}
      <div className="viz-tipline">
        {hover != null ? `${data[hover].x} — ${data[hover].y}${unit}` : (refLabel || ' ')}
      </div>
    </div>
  )
}

/**
 * Session mix per week. Stacked, with a 2px surface gap between segments so the
 * boundaries read without relying on colour contrast alone.
 */
export function StackedBar({ weeks, keys, colors, labels, height = 170 }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState(null)

  const data = weeks || []
  if (!data.length) return <div className="empty">No sessions logged yet.</div>

  const padL = 26, padR = 12, padT = 12, padB = 24
  const W = Math.max(w, 240)
  const innerW = Math.max(W - padL - padR, 10)
  const innerH = height - padT - padB
  const maxY = Math.max(...data.map(d => keys.reduce((s, k) => s + (d[k] || 0), 0)), 1)
  const { lo, hi, ticks } = niceScale(0, maxY, 3)
  const slot = innerW / data.length
  const bw = Math.max(Math.min(slot - 2, 34), 4)
  const yAt = v => padT + innerH - ((v - lo) / (hi - lo || 1)) * innerH

  return (
    <div ref={ref} className="viz">
      <div className="viz-head">
        <div className="viz-title">Session mix by week</div>
        <div className="viz-legend">
          {keys.map((k, i) => (
            <span key={k} className="lg">
              <span className="viz-swatch" style={{ background: colors[i] }} />
              <span className="viz-tick">{labels[i]}</span>
            </span>
          ))}
        </div>
      </div>

      <svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`} role="img"
        aria-label="Session mix by week" onMouseLeave={() => setHover(null)}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={yAt(t)} y2={yAt(t)} stroke="var(--viz-grid)" strokeWidth="1" />
            <text x={padL - 7} y={yAt(t) + 4} textAnchor="end" className="viz-tick">{t}</text>
          </g>
        ))}

        {data.map((d, i) => {
          const x = padL + i * slot + (slot - bw) / 2
          let acc = 0
          return (
            <g key={d.label + i} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}
              opacity={hover == null || hover === i ? 1 : 0.55}>
              {keys.map((k, ki) => {
                const v = d[k] || 0
                if (!v) return null
                const y0 = yAt(acc), y1 = yAt(acc + v)
                acc += v
                const h = Math.max(y0 - y1 - 2, 1) // 2px surface gap between segments
                return <rect key={k} x={x} y={y1} width={bw} height={h} rx={Math.min(3, bw / 2)} fill={colors[ki]} />
              })}
              <rect x={x} y={padT} width={bw} height={innerH} fill="transparent" />
            </g>
          )
        })}

        {data.map((d, i) => (
          (data.length <= 12 || i % 2 === 0) && (
            <text key={`l${i}`} x={padL + i * slot + slot / 2} y={height - 7}
              textAnchor="middle" className="viz-tick">{d.label}</text>
          )
        ))}
      </svg>

      <div className="viz-tipline">
        {hover != null
          ? `${data[hover].label} — ` + keys.map((k, i) => `${labels[i]} ${data[hover][k] || 0}`).join(' · ')
          : 'Hard days are capped at 2 per week.'}
      </div>
    </div>
  )
}
