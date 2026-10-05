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
 * The fix is not fewer charts, it is a QUESTION first. Pick an achievement, a category, a
 * single sport or one lift, and the page draws the charts that mean something for
 * that — see lib/metrics.js, where each one declares when it applies. The
 * specific climbing charts did not go anywhere; they stopped being unconditional.
 *
 * Everything here is presentation. The filter is `lib/scope.js` and the charts
 * are `lib/metrics.js`, both pure, both tested as arithmetic in
 * `app/progress.test.js` — which is the only way to be sure that "filter to the
 * half iron" really does exclude every finger session rather than merely looking
 * like it does on the day you tried it.
 */

import { useEffect, useMemo, useState } from 'react'
import { LineChart, BarChart, StatTile, SERIES } from './lib/viz.jsx'
import { Icon } from './lib/icons.jsx'
import { Blurb } from './blurb.jsx'
import { localIso } from './lib/dates.js'
import { EMPTY_SCOPE, resolveScope, scopeOptions, describeScope } from './lib/scope.js'
import { metricsFor, totalsFor } from './lib/metrics.js'
import { achievements } from './lib/achievements.js'
import { profileFacts } from './lib/profile.js'

const RANGES = [
  { weeks: 4, label: '4 wk' },
  { weeks: 8, label: '8 wk' },
  { weeks: 26, label: '6 mo' },
  { weeks: null, label: 'All' },
]

const GROUP_ICON = {
  Volume: 'Layers',
  Distance: 'Route',
  Climbing: 'Mountain',
  Strength: 'Dumbbell',
  Effort: 'HeartPulse',
  'This session': 'FlaskConical',
}

export function ProgressView({ plan, entries }) {
  const today = localIso()
  const [scope, setScope] = useState(EMPTY_SCOPE)

  /*
   * The options come from the WHOLE log, not from the current window.
   *
   * Otherwise narrowing the range empties the filter bar of the thing you are
   * currently filtering by, and the control you just used disappears under your
   * finger. The counts shown are all-time for the same reason.
   */
  const achs = useMemo(
    () => achievements(plan, entries, profileFacts(entries)), [plan, entries])

  const options = useMemo(
    () => scopeOptions({ plan, entries, today, weeks: null, achievements: achs }),
    [plan, entries, today, achs])

  /*
   * Drop a filter pointing at an achievement that no longer exists.
   *
   * The user can delete one from their profile while it is the thing this page is
   * filtered by, and the result would otherwise be a permanently empty page
   * headed by the name of something that is gone. Clearing only the achievement
   * keeps the rest of the filter, which is usually still what the user wanted.
   */
  useEffect(() => {
    if (scope.achievement && !achs.some(a => a.id === scope.achievement)) {
      setScope(s => ({ ...s, achievement: null }))
    }
  }, [achs, scope.achievement])

  const resolved = useMemo(
    () => resolveScope({ plan, entries, scope, today, achievements: achs }),
    [plan, entries, scope, today, achs])

  const groups = useMemo(() => metricsFor(plan, resolved), [plan, resolved])
  const totals = useMemo(() => totalsFor(plan, resolved), [plan, resolved])

  const set = (patch) => setScope(s => ({ ...s, ...patch }))
  const narrowed = Boolean(scope.achievement || scope.category || scope.session || scope.exercise)

  // Bodyweight is not a workout, so it is not in the scope — but it is the one
  // series worth seeing next to the volume, and it belongs to no filter.
  const bw = useMemo(() => entries
    .filter(e => e.kind === 'bodyweight' && !e.deleted && e.date && Number(e.data?.lb) > 0)
    .map(e => ({ x: e.date, y: Number(e.data.lb) }))
    .sort((a, b) => String(a.x).localeCompare(String(b.x))), [entries])

  return (
    <>
      <div className="card scopebar">
        <div className="scopebar-head">
          <h2>{describeScope({ plan, scope, options })}</h2>
          {narrowed && (
            <button className="scope-clear" onClick={() => setScope(s => ({ ...EMPTY_SCOPE, weeks: s.weeks }))}>
              <Icon name="X" size={13} /> Clear
            </button>
          )}
        </div>

        <ScopeRow label="Achievement" options={options.achievements} value={scope.achievement}
          onPick={v => set({ achievement: v, category: null, session: null, exercise: null })} />

        <ScopeRow label="Category"
          options={scope.achievement
            ? options.categories.filter(c => c.achievement === scope.achievement)
            : options.categories}
          value={scope.category}
          onPick={v => set({ category: v, session: null, exercise: null })} />

        <ScopePick label="Just one thing" options={options.sessions} value={scope.session}
          onPick={v => set({ session: v, exercise: null })} all="Any workout" />

        {options.exercises.length > 0 && (
          <ScopePick label="One lift" options={options.exercises} value={scope.exercise}
            onPick={v => set({ exercise: v })} all="Any exercise" />
        )}

        <div className="scoperow">
          <span className="scoperow-label">Since</span>
          <div className="scoperow-opts">
            {RANGES.map(r => (
              <button key={r.label} className={`chip ${scope.weeks === r.weeks ? 'on' : ''}`}
                onClick={() => set({ weeks: r.weeks })}>{r.label}</button>
            ))}
          </div>
        </div>
      </div>

      {resolved.isEmpty ? (
        <div className="card">
          <h2>Nothing here</h2>
          <p className="sub" style={{ margin: 0 }}>
            No workouts match that. {scope.weeks
              ? <>Try <strong>All</strong> for the range, or clear a filter.</>
              : <>Clear a filter to widen it.</>}
          </p>
        </div>
      ) : (
        <>
          <div className="tiles">
            <StatTile icon="Flame" label="Workouts" value={totals.sessions}
              sub={`${totals.days} day${totals.days === 1 ? '' : 's'}`} />
            <StatTile icon="Timer" label="Hours" value={totals.hours} />
            {totals.miles > 0 && <StatTile icon="Route" label="Miles" value={totals.miles} />}
            {totals.yards > 0 && <StatTile icon="Waves" label="Yards swum" value={totals.yards} />}
            {totals.hardFingerDays > 0 && (
              <StatTile icon="Hand" label="Hard finger days" value={totals.hardFingerDays} />
            )}
            <StatTile icon="Gauge" label="Load" value={totals.load.toLocaleString()}
              sub="RPE × minutes" />
          </div>

          {groups.map(g => (
            <div className="card" key={g.name}>
              <h2><Icon name={GROUP_ICON[g.name] || 'Gauge'} size={16} /> {g.name}</h2>
              {g.metrics.map((m, i) => (
                <div className="metric" key={m.key}>
                  {m.help && <p className="sub metric-help">{m.help}</p>}
                  {m.kind === 'bar'
                    ? <BarChart bars={m.points} label={m.label} unit={m.unit || ''}
                        refLine={m.ref} refLabel={m.refLabel}
                        color={SERIES[i % SERIES.length]} />
                    : <LineChart points={m.points} label={m.label} unit={m.unit || ''}
                        fmtY={m.fmtY} noisePct={m.noisePct}
                        color={SERIES[i % SERIES.length]} />}
                </div>
              ))}
            </div>
          ))}
        </>
      )}

      {bw.length > 1 && !narrowed && (
        <div className="card">
          <h2><Icon name="PersonStanding" size={16} /> Bodyweight</h2>
          <p className="sub metric-help">
            Not a workout, so no filter touches it — but it is what half the other
            numbers get divided by.
          </p>
          <LineChart points={bw} label="Bodyweight" unit=" lb" color={SERIES[2]} />
        </div>
      )}

      <Blurb id="progress-how" title="Why these charts and not others" tone="card">
        <p className="sub" style={{ margin: 0 }}>
          Each chart declares when it means anything, and the page draws the ones that do —
          so filtering to the half iron drops every finger chart, and filtering to one lift
          brings up its top set. A line needs two points before it is a trend rather than a
          dot with an axis. The very specific climbing numbers — critical force, 4×4 rest,
          straddle reach — are declared by the sessions themselves in <code>plan.json</code>,
          and show up under <strong>This session</strong> when that session is in scope.
        </p>
      </Blurb>
    </>
  )
}

/** A row of chips where one can be on, or none. */
function ScopeRow({ label, options, value, onPick }) {
  if (!options?.length) return null
  return (
    <div className="scoperow">
      <span className="scoperow-label">{label}</span>
      <div className="scoperow-opts">
        {options.map(o => (
          <button key={o.value} className={`chip ${value === o.value ? 'on' : ''}`}
            onClick={() => onPick(value === o.value ? null : o.value)}>
            {o.icon && <Icon name={o.icon} size={13} />}
            {o.label} <em>{o.n}</em>
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * A select, for the lists that are too long to be chips.
 *
 * Twenty-four things the user has logged and two hundred exercises do not fit on a
 * phone as buttons, and a scrolling chip rail hides most of its own options.
 */
function ScopePick({ label, options, value, onPick, all }) {
  if (!options?.length) return null
  return (
    <div className="scoperow">
      <span className="scoperow-label">{label}</span>
      <select className="scopesel" value={value || ''} onChange={e => onPick(e.target.value || null)}>
        <option value="">{all}</option>
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label} ({o.n})</option>
        ))}
      </select>
    </div>
  )
}
