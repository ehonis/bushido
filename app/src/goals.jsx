/*
 * Totem's goals, in Bushido.
 *
 * Read-only by design — see lib/goals.js. What it is for is the moment the user
 * writes a mile goal in Totem on a Sunday and sees it on Tuesday in the app
 * they are actually standing in with a bike.
 *
 * TWO MODES, because it got its own tab on 2026-09-15 having previously been a
 * card at the bottom of Today. As a card it stayed SILENT whenever it had nothing
 * to say — no bridge, still loading, nothing linked — because a card explaining an
 * empty list every day is worse than no card. A tab cannot do that: a tab you
 * tapped and that rendered nothing is indistinguishable from a broken one. So
 * `full` says everything out loud, including why it is empty.
 */

import { useEffect, useMemo, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import { bushidoGoalCards, goalNudge, bushidoHost } from './lib/goals.js'

/**
 * One number, with its bar.
 *
 * Shared by the goal and by its steps: a number on a step is the same kind of
 * thing as a number on the goal, and drawing it differently would imply it is a
 * lesser one. It is usually the opposite — it is the one being logged.
 */
function Metric({ m }) {
  return (
    <div className="vmetric">
      <span className="vmetric-label">
        {m.label}
        {/* Whose number it is. A hand-logged metric nobody has touched should not
            look like one a connector is keeping current. */}
        {!m.manual && <em>{m.source}</em>}
      </span>
      <span className="vmetric-bar">
        <span className="vmetric-fill" style={{ width: `${m.available ? m.percent : 0}%` }} />
      </span>
      <span className="vmetric-n">
        {/* A connector that cannot be read is not a zero — Totem is explicit about
            this and so is this line, rather than drawing an empty bar that looks
            exactly like a bad week. */}
        {m.available ? <>{m.value}<em>/{m.target} {m.unit}</em></> : <em>can’t read</em>}
      </span>
    </div>
  )
}

export function TotemGoals({ compact = false, full = false }) {
  const [cache, setCache] = useState(null)
  const [state, setState] = useState('loading')

  useEffect(() => {
    let live = true
    fetch('/api/goals', { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (live) { setCache(d); setState(d ? 'ok' : 'error') } })
      .catch(() => { if (live) setState('error') })
    return () => { live = false }
  }, [])

  const cards = useMemo(() => bushidoGoalCards(cache), [cache])

  // Nothing linked is the normal state until the user links one, and a card explaining
  // an empty list every day is worse than no card. It says how ONCE, when the
  // bridge answered and there is genuinely nothing.
  if (state === 'loading') return full ? <div className="empty">Loading goals…</div> : null

  if (state !== 'ok') {
    if (!full) return null
    return (
      <div className="card">
        <h2><Icon name="Target" size={16} /> Goals from Totem</h2>
        <p className="sub" style={{ marginBottom: 0 }}>
          Could not reach Totem. These are read over the same bridge as WHOOP and
          Strava, so if those are also stale it is the bridge rather than the goals.
        </p>
      </div>
    )
  }

  // No bridge configured: goals are an optional feature this install has not
  // turned on, so the compact card says nothing and the full one says where.
  if (cache?.configured === false) {
    if (!full) return null
    return (
      <div className="card">
        <h2><Icon name="Target" size={16} /> Goals from Totem</h2>
        <p className="sub" style={{ marginBottom: 0 }}>
          Off. Goals are read from a Totem bridge, which this install does not have.
          Set one up in <a href="/settings">Settings → Integrations</a> to show them here.
        </p>
      </div>
    )
  }

  if (!cards.length) {
    if (compact) return null
    return (
      <div className="card">
        <h2><Icon name="Target" size={16} /> Goals from Totem</h2>
        <p className="sub" style={{ marginBottom: 0 }}>
          None linked yet. Goals live in Totem — press the <strong>Bushido</strong> button on
          a goal there and it shows up here with its progress. By hand, that is:
          {' '}{bushidoHost()
            ? <code>goals__link_goal(id, kind: 'url', url: 'https://{bushidoHost()}')</code>
            : <>link it to this app&rsquo;s URL.</>}
        </p>
      </div>
    )
  }

  return (
    <div className="card">
      <h2><Icon name="Target" size={16} /> Goals from Totem</h2>
      {cards.map(card => {
        const nudge = goalNudge(card)
        return (
          <div className={`vgoal ${card.complete ? 'done' : ''}`} key={card.id}>
            <div className="vgoal-head">
              <strong>{card.title}</strong>
              <span className="vgoal-pct">{card.percent}%</span>
            </div>
            <div className="vgoal-when">
              {card.period}
              {/* A window that has closed says so. "0 days left" on last week's goal
                  reads like a countdown still running, and last week is exactly the
                  one worth reading honestly: it is the only place to see what did
                  not happen. Totem keeps every period, so it stays here. */}
              {card.complete ? <> · done</>
                : card.periodState === 'expired' ? <> · ended</>
                : card.daysLeft !== null && <> · {card.daysLeft} day{card.daysLeft === 1 ? '' : 's'} left</>}
            </div>

            {card.metrics.map(m => <Metric key={m.id} m={m} />)}

            {/* The steps, and the numbers on them.
                
                Usually where the countable thing actually is: the goal is "complete
                cardio goals" and the number is "2 bike rides" under it. Shown with
                their own bars rather than as a bare tick list, because a step at
                one ride of two is neither done nor untouched. */}
            {card.steps.length > 0 && (
              <div className="vsteps">
                {card.steps.map(step => (
                  <div
                    className={`vstep ${step.complete ? 'done' : ''} ${step.abandoned ? 'off' : ''}`}
                    key={step.id}
                  >
                    <div className="vstep-head">
                      <span className="vstep-tick">{step.complete ? '✓' : '○'}</span>
                      <span className="vstep-title">{step.title || 'unnamed step'}</span>
                      {/* Only where it says something the tick does not. */}
                      {!step.complete && !step.abandoned && step.metrics.length > 0 && (
                        <span className="vstep-pct">{step.percent}%</span>
                      )}
                      {step.abandoned && <span className="vstep-pct">not doing</span>}
                    </div>
                    {step.metrics.map(m => <Metric key={m.id} m={m} />)}
                  </div>
                ))}
              </div>
            )}

            {nudge && <p className="vgoal-nudge">{nudge}</p>}
          </div>
        )
      })}
      <p className="sub vgoal-foot">
        Written and edited in Totem; shown here. The numbers are Totem's own, including
        anything a connector is feeding.{full && ' Press the Bushido button on a goal in Totem to link or unlink it.'}
      </p>
    </div>
  )
}
