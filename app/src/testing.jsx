/*
 * The plan's tests and the evidence behind it: the profile's Testing and Why
 * sections. Moved out of tabs.jsx unchanged (2026-10-25, docs/DESIGN.md "Wave 2:
 * who owns which file") so the climbing pages and Today have one owner each.
 */

import { useState } from 'react'
import { LineChart, SERIES } from './lib/viz.jsx'
import { Icon, VERDICT_ICONS } from './lib/icons.jsx'
import { resolveCeiling, cfPctOfMax, cfBand, CF_CORRECTION_KG, CF_PCT_MVC_MEAN, CF_PCT_MVC_SD, CF_NOISE_PCT } from './lib/force.js'
import { Blurb } from './blurb.jsx'
import { localIso } from './lib/dates.js'

// The same one-liner as tabs.jsx's: the local day, not UTC's.
const todayIso = () => localIso()

/* ---------------------------------------------------------------- testing */

export function TestingTab({ plan, entries, upsertEntry }) {
  const [active, setActive] = useState(null)
  const tests = plan?.tests || []

  // The starter content has no benchmark tests; a plan that defines some fills this in.
  if (!tests.length && !(plan?.testingNotes || []).length) {
    return (
      <div className="card">
        <h2>No tests in this plan</h2>
        <p className="sub" style={{ margin: 0 }}>
          Benchmark tests come from the training plan. The example plan in Settings has six.
        </p>
      </div>
    )
  }

  return (
    <>
      {(plan?.testingNotes || []).map((n, i) => (
        <Blurb key={i} id={`testnote-${i}`} title={n.title}>
          <p className="sub" style={{ margin: 0 }}>{n.body}</p>
        </Blurb>
      ))}

      {tests.map(t => {
        const results = entries
          .filter(e => e.kind === 'test' && e.data?.testId === t.id)
          .sort((a, b) => a.date.localeCompare(b.date))
        return (
          <div key={t.id} className="card">
            <h2>{t.name}</h2>
            <p className="sub">{t.why}</p>

            {t.metrics.map((m, mi) => {
              const pts = results
                .filter(r => Number.isFinite(Number(r.data?.[m.key])))
                .map(r => ({ x: r.date, y: Number(r.data[m.key]) }))
              return pts.length ? (
                <LineChart key={m.key} points={pts} label={m.label} unit={m.unit || ''}
                  color={SERIES[mi % SERIES.length]} goal={m.goal} />
              ) : null
            })}

            {t.id === 'critical-force' && <CeilingReadout entries={entries} />}

            <button className="btn ghost" style={{ marginTop: 10 }}
              onClick={() => setActive(active === t.id ? null : t.id)}>
              {active === t.id ? 'close' : 'run this test'}
            </button>

            {active === t.id && <TestRunner test={t} onSave={upsertEntry} onDone={() => setActive(null)} />}
          </div>
        )
      })}
    </>
  )
}

/**
 * What the critical-force test actually buys you: a number in kilograms to set
 * the gauge to. This is the whole reason the test is worth running — before it
 * was computed here, it had to be re-derived by hand from the last result every
 * time, which is how a session ends up trained at the wrong intensity for weeks.
 */
function CeilingReadout({ entries }) {
  const c = resolveCeiling(entries)
  if (!c) return null

  const round = (n) => Math.round(n * 10) / 10
  const pct = cfPctOfMax(c)
  const band = cfBand(pct)

  return (
    <div className="ceiling">
      <div className="ceiling-head">
        <Icon name="Gauge" size={14} />
        <span>Your sub-threshold ceiling</span>
        <span className="ceiling-date">tested {c.date}</span>
      </div>

      <div className="ceiling-nums">
        <div className="ceiling-big">
          <strong>{round(c.ceiling)}</strong><span>kg ceiling</span>
        </div>
        <div className="ceiling-big accent">
          <strong>{round(c.ceiling - 2)}</strong><span>kg — unilateral target</span>
        </div>
      </div>

      <dl className="deflist">
        <dt>How</dt>
        <dd>
          {c.cfMin != null
            ? <>CFmin {round(c.cfMin)} kg vs CF {round(c.cf)} − {CF_CORRECTION_KG} = {round(c.corrected)} kg.
                The lower one binds{c.bound === 'cfmin' ? ' — that is CFmin' : ' — that is the corrected CF'}.</>
            : <>CF {round(c.cf)} kg − {CF_CORRECTION_KG} = {round(c.corrected)} kg. Log CFmin from the
                same test and this uses whichever is lower.</>}
        </dd>
        {pct != null && (
          <>
            <dt>CF vs your max</dt>
            <dd>
              {pct}% of {round(c.mvc)} kg. Climbers average {CF_PCT_MVC_MEAN} ± {CF_PCT_MVC_SD}%
              (Fryer 2019), so{' '}
              {band === 'below' ? 'this sits below that band — the endurance-limited pattern this whole block targets.'
                : band === 'above' ? 'this sits above that band, which is not the pattern this block assumes.'
                : 'this sits inside the normal band.'}
            </dd>
          </>
        )}
        <dt>Trust</dt>
        <dd>
          One test. Test-retest CV for this protocol is {CF_NOISE_PCT}% (McClean 2023), so treat
          anything inside roughly ±{round(c.cf * (CF_NOISE_PCT / 100))} kg as unchanged until a
          third test agrees.
        </dd>
      </dl>
    </div>
  )
}

function TestRunner({ test, onSave, onDone }) {
  const [vals, setVals] = useState({})
  const [date, setDate] = useState(todayIso)

  const save = () => {
    const data = { testId: test.id }
    for (const m of test.metrics) if (vals[m.key] !== '' && vals[m.key] != null) data[m.key] = Number(vals[m.key])
    onSave({ kind: 'test', date, data })
    onDone()
  }

  return (
    <div className="runner">
      <div className="runner-sec">
        <h3>Equipment</h3>
        <p>{test.equipment}</p>
      </div>

      <div className="runner-sec">
        <h3>Procedure</h3>
        <ol className="steps">
          {test.procedure.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      </div>

      {test.cautions?.length > 0 && (
        <div className="runner-sec caution">
          <h3>Don't</h3>
          <ul>{test.cautions.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </div>
      )}

      <div className="runner-sec">
        <h3>Result</h3>
        <label className="field" style={{ marginBottom: 10 }}>
          Date
          <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        </label>
        {test.metrics.map(m => (
          <label className="field" key={m.key} style={{ marginBottom: 10 }}>
            {m.label} {m.unit ? `(${m.unit})` : ''}
            <input type="number" inputMode="decimal" value={vals[m.key] ?? ''}
              onChange={e => setVals(v => ({ ...v, [m.key]: e.target.value }))} placeholder={m.hint || ''} />
          </label>
        ))}
        <button className="btn" onClick={save}>Save result</button>
      </div>

      {test.interpretation && (
        <div className="runner-sec">
          <h3>Reading the number</h3>
          <p>{test.interpretation}</p>
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------- why */

export function WhyTab({ plan }) {
  const [filter, setFilter] = useState('all')
  const items = (plan?.evidence || []).filter(e => filter === 'all' || e.verdict === filter)

  return (
    <>
      {plan?.exposureBudget && (
        <Blurb id="exposure-budget" title={plan.exposureBudget.title}>
          <p className="sub" style={{ marginBottom: plan.exposureBudget.disagreement ? 12 : 0 }}>
            {plan.exposureBudget.body}
          </p>
          {plan.exposureBudget.disagreement && (
            <details className="disagree">
              <summary>Where my sources disagreed</summary>
              <p>{plan.exposureBudget.disagreement}</p>
            </details>
          )}
        </Blurb>
      )}

      {plan?.reframe && (
        <Blurb id="reframe" title={plan.reframe.title}>
          <p className="sub" style={{ margin: 0 }}>{plan.reframe.body}</p>
        </Blurb>
      )}

      <div className="card">
        <h2>What the evidence actually says</h2>
        <p className="sub" style={{ margin: items.length ? 0 : 12 }}>
          Every claim below was checked against primary sources, and the shaky ones were handed to agents whose
          job was to refute them. Where the honest answer is "nobody knows," it says so.
        </p>
        {!items.length && (
          <p className="sub" style={{ margin: 0 }}>
            The standalone evidence index was removed on 2026-09-14 with the rest of the
            dated block. Nothing was lost: every session still carries its own graded
            <strong> transfer</strong> and <strong>summary</strong>, which is where these
            claims were actually read. Open any session and expand <em>the evidence</em>.
          </p>
        )}
      </div>

      {items.length > 0 && (
        <div className="filters">
          {['all', 'supported', 'mixed', 'refuted'].map(f => (
            <button key={f} className={`chip ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
      )}

      {items.map((e, i) => (
        <div key={i} className={`card ev ${e.verdict}`}>
          <div className="ev-head">
            <span className={`ev-badge ${e.verdict}`}><Icon name={VERDICT_ICONS[e.verdict]} size={12} /> {e.verdict}</span>
            <span className="ev-claim">{e.claim}</span>
          </div>
          <p className="ev-body">{e.reality}</p>
          {e.doThis && <p className="ev-do"><strong>So:</strong> {e.doThis}</p>}
          {e.sources?.length > 0 && (
            <p className="ev-src">{e.sources.join(' · ')}</p>
          )}
        </div>
      ))}
    </>
  )
}
