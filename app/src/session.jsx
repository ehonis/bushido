/*
 * The session view: what you actually follow mid-session.
 *
 * Four things make this different from a description. First, it opens on THE
 * MOVES — a picture and four short steps per exercise — because the prose
 * sections below, however accurate, were not landing: the user read the core and
 * eccentrics protocols repeatedly and still did not know what the movement was.
 * Second, loads are resolved into POUNDS ON THE BAR from your logged max —
 * "80% of MVC-7" is useless when you're standing under the board with a bucket
 * of sand. Third, the interval blocks state their interval in plain text — you
 * run your own timer. Fourth, the protocol is split into named sections and
 * shown ONE AT A TIME: a twelve-step block rendered as one wall of text is the
 * thing people stop reading halfway through, and a session you skim is a
 * session you do wrong.
 */

import { useState } from 'react'
import { Icon } from './lib/icons.jsx'
import { MovesList, hasMoves } from './howto.jsx'
import { resolveCeiling, CF_CORRECTION_KG } from './lib/force.js'
import { blockTimers } from './lib/workout.js'

/** Latest usable max, expressed as TOTAL load on the fingers (bodyweight + added). */
export function resolveMax(entries) {
  const bw = [...entries].filter(e => e.kind === 'bodyweight')
    .sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.data?.lb

  const test = [...entries].filter(e => e.kind === 'test' && e.data?.testId === 'mvc7')
    .sort((a, b) => a.date.localeCompare(b.date)).at(-1)
  if (test && Number.isFinite(test.data.addedLb)) {
    const b = Number(test.data.bodyweightLb) || bw
    if (b) return { total: Number(test.data.addedLb) + b, bodyweight: b, source: `MVC-7 test ${test.date}` }
  }

  const hang = [...entries].filter(e => e.kind === 'maxhang' && e.data?.edgeMm === 20)
    .sort((a, b) => a.date.localeCompare(b.date)).at(-1)
  if (hang && bw) {
    return { total: Number(hang.data.addedLb) + bw, bodyweight: bw, source: `max hang ${hang.date}` }
  }
  return null
}

/** "hold 11.2 kg on the gauge" — the dose, resolved, with its offset applied. */
function CeilingLine({ spec, ceiling }) {
  if (!ceiling) {
    return (
      <div className="load load-unknown">
        <Icon name="Info" size={14} />
        <span>
          <strong>Dosed against your critical force</strong> — run the 4-min all-out test on the
          Testing tab and this turns into an actual number in kilograms.
        </span>
      </div>
    )
  }
  const offset = Number(spec?.offset) || 0
  const target = Math.round((ceiling.ceiling + offset) * 10) / 10
  const pct = ceiling.mvc ? Math.round((target / ceiling.mvc) * 100) : null

  return (
    <div className="load">
      <div className="load-main">
        <span className="load-pct">target</span>
        <span className="load-target">{target} kg on the gauge</span>
        {pct != null && <span className="load-pct">{pct}% of that arm's max</span>}
      </div>
      <div className="load-how">
        <Icon name="Gauge" size={13} />
        Ceiling <strong>{Math.round(ceiling.ceiling * 10) / 10} kg</strong>
        {offset ? <> {offset < 0 ? '−' : '+'} {Math.abs(offset)} kg</> : null}
        <span className="load-src">
          {ceiling.bound === 'cfmin'
            ? `CFmin from ${ceiling.date}`
            : `CF ${ceiling.cf} kg − ${CF_CORRECTION_KG}, tested ${ceiling.date}`}
        </span>
      </div>
    </div>
  )
}

/** "hang 138 lb → take 38 lb off with the pulley" */
function LoadLine({ pct, max }) {
  if (pct == null) return null
  if (!max) {
    return (
      <div className="load load-unknown">
        <Icon name="Info" size={14} />
        <span><strong>{pct}% of max</strong> — log an MVC-7 result and this turns into actual pounds.</span>
      </div>
    )
  }
  const target = Math.round((pct / 100) * max.total)
  const delta = Math.round(target - max.bodyweight)
  return (
    <div className="load">
      <div className="load-main">
        <span className="load-pct">{pct}%</span>
        <span className="load-target">{target} lb total on the fingers</span>
      </div>
      <div className="load-how">
        {delta > 1 && <><Icon name="Dumbbell" size={13} /> Add <strong>{delta} lb</strong> to the harness</>}
        {delta < -1 && <><Icon name="Waves" size={13} /> Counterweight <strong>{Math.abs(delta)} lb</strong> off with the pulley</>}
        {Math.abs(delta) <= 1 && <><Icon name="Check" size={13} /> Bodyweight, no added load</>}
        <span className="load-src">from {max.source}</span>
      </div>
    </div>
  )
}

/**
 * The interval spec as plain text, for reading the session rather than doing it
 * — workout mode is what actually runs the clock.
 *
 * Every part is optional, because the specs are genuinely different shapes: a
 * max hang is one 7-second rep with three minutes between sets and no
 * within-set rest at all, and rendering that as "7s on / 0s off · up to 1 reps"
 * is how you get prose nobody trusts.
 */
function TimingLine({ spec, label }) {
  const cycles = spec.reps > 1 && spec.rest > 0
  const lead = cycles ? `${spec.work}s on / ${spec.rest}s off` : `${spec.work}s`
  const bits = [
    spec.reps > 1 ? `up to ${spec.reps} reps` : null,
    spec.sets > 1 ? `${spec.sets} sets` : null,
    spec.setRest > 0 ? `${Math.round(spec.setRest / 60)} min between sets` : null,
  ].filter(Boolean)

  return (
    <p className="timing">
      <Icon name="Timer" size={13} />
      <span>
        {label ? <>{label} — </> : null}
        <strong>{lead}</strong>{bits.length ? ` · ${bits.join(' · ')}` : ''}
      </span>
    </p>
  )
}

/** The display name behind a timer's `exercise` key. */
function exerciseName(session, key) {
  return (session?.logSpec?.exercises || []).find(e => e.key === key)?.name || null
}

/* ------------------------------------------------------------ step parsing */

/** Steps often already carry their own "3." — use it rather than double-numbering. */
const STEP_NUM = /^\s*(\d{1,2})\s*[.)]\s+/

/**
 * Many steps open with a shouted label — "COMMON ERROR #2:", "WHY THE LONG
 * RESTS:" — which is the most useful part of the step and the easiest to miss
 * inside a paragraph. Pull it out as a heading. Parenthesised asides are
 * ignored when judging whether the label is really a label.
 */
function splitLead(text) {
  const i = text.indexOf(':')
  if (i < 4 || i > 64) return { lead: null, body: text }
  const head = text.slice(0, i)
  const bare = head.replace(/\([^)]*\)/g, '')
  const letters = bare.replace(/[^A-Za-z]/g, '')
  if (letters.length < 4) return { lead: null, body: text }
  if (bare.replace(/[^A-Z]/g, '').length / letters.length < 0.7) return { lead: null, body: text }
  return { lead: head, body: text.slice(i + 1).trim() }
}

function Step({ text, index }) {
  const m = STEP_NUM.exec(text)
  const n = m ? m[1] : String(index + 1)
  const { lead, body } = splitLead(m ? text.slice(m[0].length) : text)
  return (
    <li className="step">
      <span className="step-n">{n}</span>
      <span className="step-body">
        {lead && <strong className="step-lead">{lead}</strong>}
        {body}
      </span>
    </li>
  )
}

function Bullet({ text }) {
  const { lead, body } = splitLead(text)
  return (
    <li>
      {lead && <strong className="step-lead">{lead}</strong>}
      {body}
    </li>
  )
}

/* -------------------------------------------------------------- sections */

/**
 * Split the protocol into named chunks, in the order you'd actually use them.
 *
 * "The moves" goes first and is what the view opens on. That ordering is the
 * point of the whole section: everything after it is context you may want, and
 * this is the part you are standing there trying to execute.
 */
export function buildSections(session) {
  const pr = session?.protocol || {}
  const out = []
  if (hasMoves(session)) out.push({ key: 'moves', title: 'The moves', icon: 'PersonStanding', kind: 'moves', session })
  if (pr.setup?.length) out.push({ key: 'setup', title: 'Before you start', icon: 'ClipboardCheck', kind: 'bullets', items: pr.setup })
  if (pr.warmup?.length) out.push({ key: 'warmup', title: 'Warm-up', icon: 'Sunrise', kind: 'steps', items: pr.warmup })
  for (const [i, b] of (pr.blocks || []).entries()) {
    out.push({ key: `block-${i}`, title: b.name, icon: 'Dumbbell', kind: 'steps', items: b.steps || [],
      loadPct: b.loadPct, loadCeiling: b.loadCeiling, timers: blockTimers(b), session })
  }
  if (pr.cues?.length) out.push({ key: 'cues', title: 'Cues', icon: 'Target', kind: 'bullets', items: pr.cues })
  if (pr.stopIf?.length) out.push({ key: 'stop', title: 'Stop if', icon: 'TriangleAlert', kind: 'bullets', items: pr.stopIf, tone: 'stop' })
  if (pr.log?.length) out.push({ key: 'log', title: 'Log afterwards', icon: 'NotebookPen', kind: 'bullets', items: pr.log })
  return out
}

/** Short chip labels — "A · Board power-endurance" is too long for a chip. */
function chipLabel(section) {
  const t = section.title
  if (!t.includes('·')) return t.length > 22 ? `${t.slice(0, 20)}…` : t
  const [head, tail] = t.split('·').map(s => s.trim())
  return tail.length > 18 ? head : `${head} · ${tail}`
}

export function SectionBody({ section, max, ceiling }) {
  return (
    <div className={`sect ${section.tone || ''}`}>
      <h4 className="sect-title">
        <Icon name={section.icon} size={14} /> {section.title}
      </h4>
      {section.loadPct != null && <LoadLine pct={section.loadPct} max={max} />}
      {section.loadCeiling && <CeilingLine spec={section.loadCeiling} ceiling={ceiling} />}
      {section.kind === 'moves' ? (
        <MovesList session={section.session} />
      ) : section.kind === 'steps' ? (
        <ol className="steps-list">
          {section.items.map((s, i) => <Step key={i} text={s} index={i} />)}
        </ol>
      ) : (
        <ul className="bullets-list">
          {section.items.map((s, i) => <Bullet key={i} text={s} />)}
        </ul>
      )}
      {section.timers?.map((t, i) => (
        // A block driving more than one exercise gets one line each, named, or
        // "10s on / 20s off" three times over reads like a mistake.
        <TimingLine key={i} spec={t}
          label={section.timers.length > 1 ? exerciseName(section.session, t.exercise) : null} />
      ))}
    </div>
  )
}

/** The evidence note, which is background rather than instruction. */
export function EvidenceNote({ evidence, open = false }) {
  if (!evidence) return null
  return (
    <details className="ev-note" open={open}>
      <summary>
        <span className={`grade g-${evidence.grade}`}>{evidence.grade.replace(/-/g, ' ')}</span>
        <span>why this is in the menu</span>
      </summary>
      <p><strong>Transfer to climbing:</strong> {evidence.transfer}</p>
      <p>{evidence.summary}</p>
      {evidence.sources?.length > 0 && <p className="ev-src">{evidence.sources.join(' · ')}</p>}
    </details>
  )
}

/* ---------------------------------------------------------------- session */

/**
 * One section on screen at a time, picked from a chip row. `variant="full"`
 * adds prev/next stepping and roomier type for the fullscreen page.
 */
export function SessionView({ session, entries, variant = 'compact', showEvidence = true }) {
  const sections = buildSections(session)
  const [active, setActive] = useState(sections[0]?.key || null)
  const max = resolveMax(entries)
  const ceiling = resolveCeiling(entries)
  const pr = session?.protocol

  if (!pr) return <p className="sub" style={{ margin: 0 }}>{session?.dose}</p>

  const idx = Math.max(0, sections.findIndex(s => s.key === active))
  const current = sections[idx]

  return (
    <div className={`sess v-${variant}`}>
      {pr.duration && <div className="sess-dur"><Icon name="Timer" size={13} /> {pr.duration}</div>}

      {showEvidence && <EvidenceNote evidence={session.evidence} />}

      {sections.length > 1 && (
        <div className="sect-nav" role="tablist">
          {sections.map(s => (
            <button key={s.key} role="tab" aria-selected={s.key === current?.key}
              className={`sect-chip ${s.key === current?.key ? 'on' : ''} ${s.tone || ''}`}
              onClick={() => setActive(s.key)}>
              <Icon name={s.icon} size={13} />
              <span>{chipLabel(s)}</span>
            </button>
          ))}
        </div>
      )}

      {current && <SectionBody section={current} max={max} ceiling={ceiling} />}

      {variant === 'full' && sections.length > 1 && (
        <div className="sect-step">
          <button className="btn ghost" disabled={idx === 0} onClick={() => setActive(sections[idx - 1].key)}>
            <Icon name="ChevronDown" size={16} style={{ transform: 'rotate(90deg)' }} /> Back
          </button>
          <span className="sect-count">{idx + 1} / {sections.length}</span>
          <button className="btn ghost" disabled={idx === sections.length - 1}
            onClick={() => setActive(sections[idx + 1].key)}>
            Next <Icon name="ChevronDown" size={16} style={{ transform: 'rotate(-90deg)' }} />
          </button>
        </div>
      )}
    </div>
  )
}
