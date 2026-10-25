/*
 * Progress: how it is going, for whatever you are asking about.
 *
 * Rebuilt 2026-09-15. The old page had about twenty charts hardcoded in render
 * order and drew every one of them every time — peak force, critical force,
 * impulse above end-test force, board repeated ascents, repeaters-to-failure, ARC
 * lengths, straddle reach, elbow soreness. Each was a real number. Together they
 * were unreadable, and nineteen of the twenty were about climbing on an app that
 * had just taken on three endurance sports.
 *
 * The fix is not fewer charts, it is a QUESTION first. Pick a category, a
 * single sport or one lift, and the page draws the charts that mean something for
 * that — see lib/metrics.js, where each one declares when it applies. The
 * specific climbing charts did not go anywhere; they stopped being unconditional.
 *
 * Everything here is presentation. The filter is `lib/scope.js` and the charts
 * are `lib/metrics.js`, both pure, both tested as arithmetic in
 * `app/progress.test.js` — which is the only way to be sure that "filter to the
 * half iron" really does exclude every finger session rather than merely looking
 * like it does on the day you tried it.
 *
 * Climbing charts come LAST (2026-10-25, issue #31): this is a workout log first.
 *
 * Wave 2 (issue #43) turned the page round: it used to open on a filter card
 * (Category, Just one thing, Since) before a single number, then five tiles in a
 * 2-up grid with one left over. Now it LEADS with the answer, workouts and time
 * for the period, in one card with the period under them; categories are chips
 * only when there is more than one to pick; "Just one thing" is a row that opens
 * a list. The paragraph explaining why these charts and not others went: the
 * charts that apply are simply the ones on the page.
 */

import { useMemo, useState } from 'react'
import { LineChart, BarChart, SERIES } from './lib/viz.jsx'
import { Icon } from './lib/icons.jsx'
import { localIso } from './lib/dates.js'
import { EMPTY_SCOPE, resolveScope, scopeOptions } from './lib/scope.js'
import { metricsFor, totalsFor } from './lib/metrics.js'

export const RANGES = [
  { weeks: 4, label: '4 wk' },
  { weeks: 8, label: '8 wk' },
  { weeks: 26, label: '6 mo' },
  { weeks: null, label: 'All' },
]

/** Minutes as the headline says them: "45 min", "4.5 h", "28 h". */
export function timeLabel(minutes) {
  const m = Math.round(Number(minutes) || 0)
  if (m < 60) return { value: String(m), unit: 'min' }
  const h = m / 60
  return { value: String(h < 10 ? Math.round(h * 10) / 10 : Math.round(h)), unit: 'h' }
}

export function ProgressView({ plan, entries, initialScope = EMPTY_SCOPE }) {
  const today = localIso()
  const [scope, setScope] = useState(initialScope)

  /*
   * The options come from the WHOLE log, not from the current window.
   *
   * Otherwise narrowing the range empties the filter bar of the thing you are
   * currently filtering by, and the control you just used disappears under your
   * finger.
   */
  const options = useMemo(
    () => scopeOptions({ plan, entries, today, weeks: null }),
    [plan, entries, today])

  const resolved = useMemo(
    () => resolveScope({ plan, entries, scope, today }),
    [plan, entries, scope, today])

  const groups = useMemo(() => metricsFor(plan, resolved), [plan, resolved])
  const totals = useMemo(() => totalsFor(plan, resolved), [plan, resolved])

  const set = (patch) => setScope(s => ({ ...s, ...patch }))
  const narrowed = Boolean(scope.category || scope.session || scope.exercise)
  const clear = () => setScope(s => ({ ...EMPTY_SCOPE, weeks: s.weeks }))
  // What the numbers are OF, in words, whenever it is not everything: "Bike ·
  // Mountain bike". Said in the headline, beside the way back, so a page narrowed
  // from a row further down never passes for the whole log.
  const named = (list, v) => (list || []).find(o => o.value === v)?.label || v
  const narrowedTo = [
    scope.category && named(options.categories, scope.category),
    scope.session && named(options.sessions, scope.session),
    scope.exercise && named(options.exercises, scope.exercise),
  ].filter(Boolean).join(' · ')
  const loggedAny = options.sessions.length > 0

  // Bodyweight is not a workout, so it is not in the scope — but it is the one
  // series worth seeing next to the volume, and it belongs to no filter.
  const bw = useMemo(() => entries
    .filter(e => e.kind === 'bodyweight' && !e.deleted && e.date && Number(e.data?.lb) > 0)
    .map(e => ({ x: e.date, y: Number(e.data.lb) }))
    .sort((a, b) => String(a.x).localeCompare(String(b.x))), [entries])

  if (!loggedAny) {
    return (
      <div className="empty">
        <Icon name="Gauge" size={24} />
        <span>Nothing logged yet</span>
        <span className="sub">Log a workout and your weeks show up here.</span>
      </div>
    )
  }

  const time = timeLabel(totals.minutes)
  const extra = [
    `${totals.days} day${totals.days === 1 ? '' : 's'}`,
    totals.miles > 0 ? `${totals.miles} mi` : null,
    totals.yards > 0 ? `${totals.yards.toLocaleString()} yd swum` : null,
  ].filter(Boolean)

  return (
    <>
      <div className="card proghead">
        {narrowed && (
          <div className="proghead-scope">
            <span className="proghead-scope-what">{narrowedTo}</span>
            <button type="button" className="btn quiet proghead-clear" onClick={clear}>
              <Icon name="X" size={16} /> Clear
            </button>
          </div>
        )}
        <div className="proghead-nums">
          <div className="proghead-num">
            <span className="proghead-value">{totals.sessions}</span>
            <span className="proghead-label">{totals.sessions === 1 ? 'Workout' : 'Workouts'}</span>
          </div>
          <div className="proghead-num">
            <span className="proghead-value">{time.value}<span className="proghead-unit">{time.unit}</span></span>
            <span className="proghead-label">Time</span>
          </div>
        </div>
        {totals.sessions > 0 && <div className="sub proghead-sub">{extra.join(' · ')}</div>}
        <div className="seg proghead-seg" role="group" aria-label="Period">
          {RANGES.map(r => (
            <button key={r.label} type="button" className={scope.weeks === r.weeks ? 'on' : ''}
              aria-pressed={scope.weeks === r.weeks} onClick={() => set({ weeks: r.weeks })}>{r.label}</button>
          ))}
        </div>
      </div>

      {options.categories.length > 1 && (
        <div className="filters progcats" role="group" aria-label="Category">
          {/* "All" is lit only when nothing is narrowed: with one workout picked
              below, the page is not showing all of anything. */}
          <button type="button" className={`chip ${!narrowed ? 'on' : ''}`} aria-pressed={!narrowed}
            onClick={clear}>All</button>
          {options.categories.map(o => (
            <button key={o.value} type="button" className={`chip ${scope.category === o.value ? 'on' : ''}`}
              aria-pressed={scope.category === o.value}
              onClick={() => set({ category: scope.category === o.value ? null : o.value, session: null, exercise: null })}>
              {o.label}
            </button>
          ))}
        </div>
      )}

      <div className="card list progpick">
        <ScopePick label="Just one thing" options={options.sessions} value={scope.session}
          onPick={v => set({ session: v, exercise: null })} all="Any workout" />
        {options.exercises.length > 0 && (
          <ScopePick label="One lift" options={options.exercises} value={scope.exercise}
            onPick={v => set({ exercise: v })} all="Any exercise" />
        )}
      </div>

      {resolved.isEmpty ? (
        <div className="empty">
          <span>{narrowed ? 'Nothing logged for that' : 'Nothing logged in these weeks'}</span>
          {narrowed
            ? <button type="button" className="btn secondary" onClick={clear}>Show everything</button>
            : <button type="button" className="btn secondary"
                onClick={() => set({ weeks: null })}>Show all time</button>}
        </div>
      ) : (
        groups.map(g => (
          <div className="card progcard" key={g.name}>
            <h2>{g.name}</h2>
            {g.metrics.map(m => (
              <div className="metric" key={m.key}>
                {/* Every chart is one series, so every chart wears the first
                    series colour: a colour that changed from chart to chart
                    would claim a difference that is not there. */}
                {m.kind === 'bar'
                  ? <BarChart bars={m.points} label={m.label} help={m.help} unit={m.unit || ''}
                      refLine={m.ref} refLabel={m.refLabel} color={SERIES[0]} />
                  : <LineChart points={m.points} label={m.label} help={m.help} unit={m.unit || ''}
                      fmtY={m.fmtY} noisePct={m.noisePct} color={SERIES[0]} />}
              </div>
            ))}
          </div>
        ))
      )}

      {bw.length > 1 && !narrowed && (
        <div className="card progcard">
          <h2>Body</h2>
          <LineChart points={bw} label="Bodyweight" unit=" lb" color={SERIES[0]} />
        </div>
      )}
    </>
  )
}

/**
 * "Just one thing" and "One lift": a row that says what is picked and opens the
 * list. The list is the platform's own (a native select on the web, an action
 * sheet on the phone), because twenty-four logged activities and two hundred
 * exercises are not chips on a phone.
 */
function ScopePick({ label, options, value, onPick, all }) {
  if (!options?.length) return null
  const cur = options.find(o => o.value === value)
  return (
    <label className="list-row progpick-row">
      <span className="list-row-main"><span className="list-row-title">{label}</span></span>
      <span className={`progpick-value ${cur ? 'on' : ''}`}>{cur ? cur.label : all}</span>
      <Icon name="ChevronRight" size={16} className="list-row-chev" />
      <select className="progpick-sel" aria-label={label} value={value || ''}
        onChange={e => onPick(e.target.value || null)}>
        <option value="">{all}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}
