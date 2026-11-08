/*
 * WHOOP on Today (#98: out of whoop.jsx): readiness against the user's own
 * baseline, and the sleep graph. Loaded on demand (lazy.jsx), and drawn as
 * nothing when it cannot load, exactly as an install without WHOOP. The
 * session sheet's WHOOP workouts stay in whoop.jsx, in the main bundle: no
 * part of a sheet waits on a chunk.
 */

import { Icon } from './lib/icons.jsx'
import { useCallback, useRef, useState } from 'react'
import { useWhoop, readinessFor } from './lib/whoop.jsx'
import { monthDay, dateWords } from './lib/dates.js'

/** Which way is good for this measure, and how far from baseline earns a colour. */
const tone = (delta, good) => {
  if (delta == null) return ''
  if (Math.abs(delta) < 5) return 'flat'
  return (delta > 0) === (good === 'up') ? 'good' : 'warn'
}

function Stat({ label, value, unit, sub, toneName = '' }) {
  if (value == null) return null
  return (
    <div className={`wh-stat ${toneName}`}>
      <span className="wh-stat-label">{label}</span>
      <span className="wh-stat-value">{value}<span className="wh-stat-unit">{unit}</span></span>
      {sub && <span className="wh-stat-sub">{sub}</span>}
    </div>
  )
}

/**
 * How recovered the user is today, read against their own recent median.
 *
 * A raw HRV of 42 ms says nothing without knowing their normal, which is why every
 * number carries its deviation and why the baseline is a median of the last
 * fortnight rather than a population figure. Fewer than four prior days and the
 * deviation is absent rather than shaky — see `baselineFor`. It is a readout:
 * nothing in the app ranks or blocks a session on it any more (the recommender
 * went on 2026-10-25).
 */
export function WhoopReadiness({ date }) {
  const { cache, status, pulling, error, pull } = useWhoop()
  const r = readinessFor(cache, date)

  // No reading is the ordinary case — not connected, band not worn, WHOOP still
  // calibrating — and it has to look like the app did before WHOOP existed. The
  // one exception is a real failure with a fix attached, which is worth saying.
  if (!r) {
    if (status?.ok !== false) return null
    return (
      <div className="card wh-card">
        <h2>WHOOP</h2>
        <p className="wh-err">{error || status.detail}</p>
        <button className="btn secondary" onClick={pull} disabled={pulling}>
          {pulling ? 'Refreshing…' : 'Try again'}
        </button>
      </div>
    )
  }

  const pct = (v) => (v == null ? null : `${v > 0 ? '+' : ''}${v}%`)

  return (
    <div className="card wh-card">
      <div className="section-head wh-head">
        <h3><Icon name="HeartPulse" size={16} /> WHOOP</h3>
        <button type="button" className="btn quiet wh-pull" onClick={pull} disabled={pulling}>
          {pulling ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <div className="wh-stats">
        <Stat label="Recovery" value={r.recovery} unit="%"
          toneName={r.recovery == null ? '' : r.recovery >= 67 ? 'good' : r.recovery >= 34 ? 'flat' : 'warn'} />
        <Stat label="HRV" value={r.hrv} unit=" ms"
          sub={r.hrvDeltaPct != null ? `${pct(r.hrvDeltaPct)} vs your ${r.hrvBaseline} ms` : null}
          toneName={tone(r.hrvDeltaPct, 'up')} />
        <Stat label="Resting HR" value={r.restingHr} unit=" bpm"
          sub={r.restingHrDelta != null
            ? `${r.restingHrDelta > 0 ? '+' : ''}${r.restingHrDelta} vs your ${r.restingHrBaseline}`
            : null}
          toneName={tone(r.restingHrDelta == null ? null : -r.restingHrDelta, 'up')} />
        <Stat label="Day strain" value={r.strain} unit="" />
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------- sleep */

/** 452 minutes as "7h32m": the label above a night's bar. */
const hmTight = (min) => {
  const t = Math.round(min)
  return Math.floor(t / 60) ? `${Math.floor(t / 60)}h${String(t % 60).padStart(2, '0')}m` : `${t}m`
}
/** 452 minutes as "7:32". */
const hm = (min) => (min == null ? null : `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`)

/** "2026-10-06T23:14" as the clock it was: "11:14 PM". Wall-clock, so no timezone maths. */
const wallClock = (stamp) => {
  const m = /T(\d{2}):(\d{2})/.exec(stamp || '')
  if (!m) return null
  const h = Number(m[1])
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`
}

// Stage order and colours, deepest first. The validated series slots plus the
// muted grey, so the palette gate covers them (app/validate_palette.js).
const STAGES = [
  { key: 'deep', label: 'Deep', color: 'var(--series-1)' },
  { key: 'rem', label: 'REM', color: 'var(--series-3)' },
  { key: 'light', label: 'Light', color: 'var(--viz-muted)' },
  { key: 'awake', label: 'Awake', color: 'var(--series-2)' },
]

/* WHOOP's own recovery bands: red to 33, yellow to 66, green above, on the viz tokens. */
const recoveryColor = (v) => (v >= 67 ? 'var(--viz-good)' : v >= 34 ? 'var(--viz-warn)' : 'var(--viz-crit)')

export const SLEEP_RANGES = [
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
  { days: 365, label: '1y' },
]
const SLEEP_GOAL = 85

const isoShift = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/*
 * A night on the clock. Minutes are measured from noon of the night's own
 * evening, so 22:36 and 00:13 bedtimes sit on one continuous scale rather than
 * a day apart. Same anchoring as Totem's chart, for the same reason.
 */
function nightSpan(n) {
  const at = (stamp) => {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(stamp || '')
    return m ? { date: m[1], min: Number(m[2]) * 60 + Number(m[3]) } : null
  }
  const a = at(n?.bedtime)
  const b = at(n?.wake)
  if (!a || !b) return null
  const anchor = a.min < 12 * 60 ? isoShift(a.date, -1) : a.date
  const dayDiff = (iso) => Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${anchor}T12:00:00Z`)) / 86_400_000)
  const from = dayDiff(a.date) * 1440 + a.min - 12 * 60
  const to = dayDiff(b.date) * 1440 + b.min - 12 * 60
  return to > from ? { from, to } : null
}

/** The noon-anchored minute as a clock: 660 -> "11 PM". */
const spanClock = (mins) => {
  const mod = (((Math.round(mins) + 720) % 1440) + 1440) % 1440
  const h = Math.floor(mod / 60)
  const m = mod % 60
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`
}

/**
 * One row per calendar day in the range, oldest first, nights WHOOP has nothing
 * for included as gaps: a missed night has to read as missing, not be closed up.
 */
export function sleepSeries(cache, end, days) {
  const nights = new Map((cache?.sleep || []).filter(n => n?.date).map(n => [n.date, n]))
  const rec = new Map((cache?.recovery || []).filter(r => r?.date).map(r => [r.date, r]))
  const out = []
  for (let i = days - 1; i >= 0; i--) {
    const date = isoShift(end, -i)
    const n = nights.get(date) || null
    const r = rec.get(date)
    const stages = n?.stages || {}
    out.push({
      date,
      night: n,
      score: Number.isFinite(n?.score) ? n.score : null,
      recovery: r && r.calibrating !== true && Number.isFinite(r.recovery) ? r.recovery : null,
      span: n ? nightSpan(n) : null,
      staged: STAGES.reduce((sum, s) => sum + (Number(stages[s.key]) || 0), 0),
    })
  }
  return out
}

/** Latest, the last seven days against the seven before, and the range's mean. */
export function sleepStats(series) {
  const mean = (rows) => {
    const v = rows.map(r => r.score).filter(x => x != null)
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
  }
  const scored = series.filter(r => r.score != null)
  const recent = mean(series.slice(-7))
  const prior = mean(series.slice(-14, -7))
  return {
    latest: scored.length ? scored[scored.length - 1] : null,
    recent, prior,
    delta: recent != null && prior != null ? recent - prior : null,
    avg: mean(series),
  }
}

const pct = (v) => (v == null ? '—' : `${Math.round(v)}%`)

/**
 * Sleep over time: the graph that used to live on Totem's Habits tab.
 *
 * Two panels on one x-axis and one crosshair. On top, sleep performance (0–100,
 * a dashed line at the goal) and recovery coloured by WHOOP's bands. Beneath,
 * each night as a bar on a clock that runs top to bottom, bedtime to wake, split
 * into stages, with its length above it. A score and a clock time are different
 * units, so they get different panels rather than two y-scales in one frame.
 *
 * Nothing here is logged by hand: the WHOOP pull fills sleep in each
 * morning. Renders nothing when there are no nights at all, which keeps the app
 * looking as it did before sleep was here.
 */
export function WhoopSleep({ date }) {
  const { cache } = useWhoop()
  const [days, setDays] = useState(30)
  const [hover, setHover] = useState(null)
  const [showTable, setShowTable] = useState(false)
  const [ref, width] = useBoxWidth()

  const series = date ? sleepSeries(cache, date, days) : []
  if (!series.some(r => r.night)) return null
  const stats = sleepStats(series)
  const firstNight = (cache?.sleep || []).reduce((min, n) => (n?.date && n.date < min ? n.date : min), '9999')
  const shortHistory = firstNight > series[0].date

  const W = Math.max(width, 280)
  const padL = 44, padR = 10
  const innerW = W - padL - padR
  const slot = innerW / series.length
  const xAt = (i) => padL + (i + 0.5) * slot
  const barW = Math.max(1, Math.min(22, slot * 0.72))

  // Panel 1: scores, 0–100.
  const H1 = 150, t1 = 12, b1 = 8
  const y1 = (v) => t1 + (H1 - t1 - b1) * (1 - v / 100)
  const line = (key) => series.reduce((d, r, i) => (r[key] == null ? d : `${d}${d ? 'L' : 'M'}${xAt(i).toFixed(1)},${y1(r[key]).toFixed(1)}`), '')
  const dots = series.filter(r => r.score != null).length <= 60

  // Panel 2: the nights on a clock, snapped out to whole hours.
  const spans = series.map(r => r.span).filter(Boolean)
  const lo = spans.length ? Math.floor(Math.min(...spans.map(s => s.from)) / 60) * 60 : 600
  const hi = spans.length ? Math.ceil(Math.max(...spans.map(s => s.to)) / 60) * 60 : 1260
  const H2 = 190, t2 = 18, b2 = 22
  const y2 = (m) => t2 + ((m - lo) / (hi - lo || 1)) * (H2 - t2 - b2)
  const step = hi - lo > 900 ? 240 : hi - lo > 480 ? 120 : 60
  const clockTicks = []
  for (let m = lo; m <= hi; m += step) clockTicks.push(m)
  // Thin the duration labels to what fits, counting back from the newest night.
  const labelEvery = Math.max(1, Math.ceil(46 / slot))
  const dateTicks = [0, Math.floor((series.length - 1) / 2), series.length - 1]

  const onMove = (e) => {
    const pt = e.touches?.[0] ?? e
    if (pt.clientX == null) return
    const box = e.currentTarget.getBoundingClientRect()
    const x = ((pt.clientX - box.left) / box.width) * W
    setHover(Math.max(0, Math.min(series.length - 1, Math.floor((x - padL) / slot))))
  }
  const hoverProps = { onMouseMove: onMove, onMouseLeave: () => setHover(null), onTouchStart: onMove, onTouchMove: onMove }
  const cross = hover != null && (
    <rect x={xAt(hover) - slot / 2} width={slot} y={0} height="100%" fill="var(--viz-axis)" opacity="0.18" />
  )
  // The range ends on the day being viewed, so its night is always the last
  // column. Tinted under everything, with a cap, so it reads at 1y as well as 30d.
  const today = series.length - 1
  const todayW = Math.max(slot, 4)
  const mark = (
    <g className="sleep-today" aria-hidden="true">
      <rect x={xAt(today) - todayW / 2} width={todayW} y={0} height="100%" fill="var(--sleep-today)" opacity="0.16" />
      <rect x={xAt(today) - todayW / 2} width={todayW} y={0} height={2} fill="var(--sleep-today)" />
    </g>
  )

  const good = stats.delta == null ? null : stats.delta > 0
  const flat = stats.delta != null && Math.abs(stats.delta) < 0.5
  const shown = series[hover ?? today]
  const hasRest = series.some(r => r.span && r.span.to - r.span.from - r.staged > 1)

  return (
    <div className="card wh-card sleep-card" ref={ref}>
      <div className="sleep-head">
        <h2>Sleep</h2>
        <div className="seg tap sleep-range" role="group" aria-label="Range">
          {SLEEP_RANGES.map(r => (
            <button key={r.days} className={days === r.days ? 'on' : ''} aria-pressed={days === r.days}
              onClick={() => { setDays(r.days); setHover(null) }}>{r.label}</button>
          ))}
        </div>
      </div>

      <div className="sleep-stats">
        <span className="lead"><b>{pct(stats.latest?.score)}</b><small>latest</small></span>
        <span><b>{pct(stats.recent)}</b><small>7-day avg</small></span>
        {stats.delta != null && !flat && (
          <span className={good ? 'up' : 'down'}><b>{good ? '▲' : '▼'} {Math.round(Math.abs(stats.delta))}</b><small>vs prior week</small></span>
        )}
        <span className="faint"><b>{pct(stats.avg)}</b><small>average</small></span>
        <button className="viz-toggle" onClick={() => setShowTable(t => !t)} aria-pressed={showTable}>
          {showTable ? 'Chart' : 'Table'}
        </button>
      </div>

      {showTable ? (
        <table className="viz-table">
          <thead><tr><th>Night</th><th>Sleep</th><th>Recovery</th><th>Asleep</th><th>Bed</th></tr></thead>
          <tbody>
            {[...series].reverse().filter(r => r.night).map(r => (
              <tr key={r.date}>
                <td className="num">{monthDay(r.date)}</td>
                <td className="num">{pct(r.score)}</td>
                <td className="num">{pct(r.recovery)}</td>
                <td className="num">{hm(r.night.asleepMin) || '—'}</td>
                <td className="num">{wallClock(r.night.bedtime) || '—'} → {wallClock(r.night.wake) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <>
          <svg width="100%" height={H1} viewBox={`0 0 ${W} ${H1}`} role="img" className="sleep-svg"
            aria-label={`Sleep performance over ${days} days, latest ${pct(stats.latest?.score)}`} {...hoverProps}>
            <defs>
              {/* Recovery's colour is a function of its value, so the gradient runs up the axis. */}
              <linearGradient id="sleep-recovery" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={y1(0)} y2={y1(100)}>
                <stop offset="0.33" stopColor="var(--viz-crit)" /><stop offset="0.34" stopColor="var(--viz-warn)" />
                <stop offset="0.66" stopColor="var(--viz-warn)" /><stop offset="0.67" stopColor="var(--viz-good)" />
              </linearGradient>
            </defs>
            {mark}
            {cross}
            {[0, 25, 50, 75, 100].map(t => (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={y1(t)} y2={y1(t)} stroke="var(--viz-grid)" />
                <text x={padL - 8} y={y1(t) + 4} textAnchor="end" className="viz-tick">{t}</text>
              </g>
            ))}
            <line x1={padL} x2={W - padR} y1={y1(SLEEP_GOAL)} y2={y1(SLEEP_GOAL)} stroke="var(--viz-muted)" strokeDasharray="4 4" />
            <text x={W - padR} y={y1(SLEEP_GOAL) - 4} textAnchor="end" className="viz-tick">goal {SLEEP_GOAL}%</text>
            <path d={line('recovery')} fill="none" stroke="url(#sleep-recovery)" strokeWidth="2" strokeLinejoin="round" />
            <path d={line('score')} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" />
            {series.map((r, i) => (
              <g key={r.date}>
                {r.recovery != null && (dots || hover === i) && (
                  <circle cx={xAt(i)} cy={y1(r.recovery)} r={hover === i ? 4.5 : 3} fill={recoveryColor(r.recovery)} stroke="var(--panel)" strokeWidth="2" />
                )}
                {r.score != null && (dots || hover === i) && (
                  <circle cx={xAt(i)} cy={y1(r.score)} r={hover === i ? 4.5 : 3} fill="var(--ink)" stroke="var(--panel)" strokeWidth="2" />
                )}
              </g>
            ))}
          </svg>

          <svg width="100%" height={H2} viewBox={`0 0 ${W} ${H2}`} role="img" className="sleep-svg"
            aria-label="Each night from bedtime to wake, split into stages" {...hoverProps}>
            {mark}
            {cross}
            {clockTicks.map(m => (
              <g key={m}>
                <line x1={padL} x2={W - padR} y1={y2(m)} y2={y2(m)} stroke="var(--viz-grid)" />
                <text x={padL - 8} y={y2(m) + 4} textAnchor="end" className="viz-tick">{spanClock(m)}</text>
              </g>
            ))}
            {series.map((r, i) => {
              if (!r.span) return null
              let at = r.span.from
              const x = xAt(i) - barW / 2
              const segs = STAGES.map(s => {
                const len = Number(r.night.stages?.[s.key]) || 0
                const seg = len > 0 ? <rect key={s.key} x={x} width={barW} y={y2(at)} height={Math.max(y2(at + len) - y2(at), 0.5)} fill={s.color} /> : null
                at += len
                return seg
              })
              const rest = r.span.to - at
              const showLabel = (series.length - 1 - i) % labelEvery === 0
              return (
                <g key={r.date}>
                  {segs}
                  {rest > 1 && (
                    <rect x={x} width={barW} y={y2(at)} height={y2(r.span.to) - y2(at)} fill="var(--viz-muted)" opacity="0.3" />
                  )}
                  {showLabel && (
                    <text x={Math.min(Math.max(xAt(i), padL + 16), W - padR - 16)} y={Math.max(y2(r.span.from) - 4, 10)} textAnchor="middle" className="viz-tick sleep-len">
                      {hmTight(r.span.to - r.span.from)}
                    </text>
                  )}
                </g>
              )
            })}
            {dateTicks.map((i, k) => (
              <text key={k} x={xAt(i)} y={H2 - 6} textAnchor={k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}
                className={i === today ? 'viz-tick sleep-today-tick' : 'viz-tick'}>
                {monthDay(series[i].date)}
              </text>
            ))}
          </svg>

          <div className="sleep-readout" aria-live="polite">
            {shown && (
              <>
                <strong className={shown === series[today] ? 'sleep-today-tick' : undefined}>
                  {dateWords(shown.date)}
                </strong>
                {shown.night ? (
                  <>
                    <span>sleep {pct(shown.score)}</span>
                    {shown.recovery != null && <span style={{ color: recoveryColor(shown.recovery) }}>recovery {pct(shown.recovery)}</span>}
                    {shown.night.asleepMin != null && <span>{hm(shown.night.asleepMin)} asleep</span>}
                    {shown.night.bedtime && <span>{wallClock(shown.night.bedtime)} → {wallClock(shown.night.wake)}</span>}
                    {STAGES.filter(s => shown.night.stages?.[s.key] > 0).map(s => (
                      <span key={s.key}><i style={{ background: s.color }} />{s.label} {hm(shown.night.stages[s.key])}</span>
                    ))}
                  </>
                ) : <span>no night from WHOOP</span>}
                {hover == null && <span className="faint">· touch a night for its numbers</span>}
              </>
            )}
          </div>

          <div className="sleep-legend">
            <span><i className="line" style={{ background: 'var(--ink)' }} />Sleep performance</span>
            <span><i className="line sleep-rec-key" />Recovery · red 0–33 · yellow 34–66 · green 67–100</span>
            {STAGES.map(s => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}
            {hasRest && <span><i style={{ background: 'var(--viz-muted)', opacity: 0.3 }} />In bed, unscored</span>}
          </div>
        </>
      )}
      {shortHistory && (
        <p className="sub wh-card-note">
          History starts {monthDay(firstNight)} and fills in from WHOOP.
        </p>
      )}
    </div>
  )
}

/**
 * The rendered width of an element, for drawing the SVG at its real size. A
 * callback ref, because the card mounts only once there are nights to show.
 */
function useBoxWidth() {
  const [w, setW] = useState(0)
  const observer = useRef(null)
  const ref = useCallback((el) => {
    observer.current?.disconnect()
    observer.current = null
    if (!el || typeof ResizeObserver === 'undefined') return
    observer.current = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    observer.current.observe(el)
  }, [])
  return [ref, w]
}
