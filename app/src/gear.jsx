/*
 * The gear page: what the user owns and what it has done.
 *
 * The logic is `lib/gear.js`; this is the page. It shows USE rather than price,
 * and the things in it are things the user owns rather than things somebody
 * thought they should buy.
 *
 * Grouped by kind rather than by origin. Where an item came from — Strava, or the
 * user's own typing — is a word on the row, not a heading: "my bikes" is the
 * question, and "which of these does Strava know about" is a footnote on it.
 *
 * Since wave 2 (#44) each kind is one card of rows (name, one line of facts, the
 * headline number), and a row opens its edit form. Removing a piece of gear lives
 * in that form behind a confirm, rather than as a bin on every row.
 */

import { useMemo, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import {
  gearUsage, gearKinds, kindOf, metricOf, headlineFor, buildGearEntry, newGearId,
  priorValueFor, priorFieldsFor,
} from './lib/gear.js'
import { NumInput } from './numinput.jsx'

const fmt = (n) => (n >= 100 ? Math.round(n).toLocaleString() : Math.round(n * 10) / 10)

export function GearSection({ plan, entries, strava, upsertEntry, deleteEntry }) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)

  const rows = useMemo(
    () => gearUsage({ plan, entries, strava }),
    [plan, entries, strava])

  const kinds = gearKinds(plan)
  const groups = kinds
    .map(k => ({ kind: k, items: rows.filter(r => r.kind === k.key) }))
    .filter(g => g.items.length)

  const save = (id, data) => { upsertEntry(buildGearEntry(id, data)); setAdding(false); setEditing(null) }
  const close = () => { setAdding(false); setEditing(null) }

  // The form replaces the list while it is open: one thing on screen to answer.
  if (adding || editing) {
    return (
      <GearForm plan={plan} row={editing} onSave={save} onCancel={close}
        onDelete={editing?.source === 'local' ? () => { deleteEntry?.(editing.id); close() } : null} />
    )
  }

  if (!groups.length) {
    return (
      <div className="empty">
        <Icon name="ShoppingBag" size={24} />
        <span>No gear yet. Bikes and shoes arrive from Strava; add anything else.</span>
        <button className="btn" onClick={() => setAdding(true)}>Add gear</button>
      </div>
    )
  }

  return (
    <>
      {groups.map(({ kind, items }) => (
        <section className="prof-sec" key={kind.key}>
          <div className="section-head"><h3>{kind.name}</h3></div>
          <div className="list">
            {items.map(row => (
              <GearRow key={row.id} row={row} kind={kind} onOpen={() => setEditing(row)} />
            ))}
          </div>
        </section>
      ))}
      <button className="btn secondary prof-wide" onClick={() => setAdding(true)}>
        <Icon name="Plus" size={16} /> Add gear
      </button>
    </>
  )
}

function GearRow({ row, kind, onOpen }) {
  const head = headlineFor(row)
  const facts = [
    row.source === 'strava' && 'Strava',
    row.primary && 'Default',
    row.retired && 'Retired',
    row.lastUsed ? `Last used ${row.lastUsed}` : row.acquired ? `Since ${row.acquired}` : row.source === 'local' && 'Not used yet',
    row.sessions > 0 && `${row.sessions} workout${row.sessions === 1 ? '' : 's'}`,
  ].filter(Boolean)
  return (
    <button type="button" className={`list-row gear-row ${row.retired ? 'retired' : ''}`} onClick={onOpen}
      aria-label={`Edit ${row.name}`}>
      <Icon name={kind.icon || 'ShoppingBag'} size={20} />
      <span className="list-row-main">
        <span className="list-row-title">{row.name}</span>
        <span className="list-row-meta">{facts.join(' · ')}</span>
        {/*
          * The mileage gap, said out loud rather than folded into one number.
          * Strava keeps its own odometer for this bike; anything logged here with
          * no Strava activity attached is a ride it cannot have seen. Adding them
          * together would double-count every ride that WAS on Strava.
          */}
        {row.source === 'strava' && row.unsyncedMiles > 0 && (
          <span className="list-row-meta gear-gap">
            + {fmt(row.unsyncedMiles)} mi logged here that Strava has not seen
          </span>
        )}
      </span>
      <span className="gear-num">
        <strong>{fmt(head.value)}</strong> {head.unit}
        {/* Weights measure reps, but the hours are worth having too. */}
        {kind.metric === 'reps' && row.minutes > 0 && <span className="sub">{Math.round(row.minutes / 60)} hr</span>}
      </span>
    </button>
  )
}

/**
 * Add or edit.
 *
 * Strava-synced gear is read here, not edited. Its name, odometer, default and
 * retirement are Strava's, because two places to rename one bike is how they
 * stop being the same bike, and nothing in the log holds an edit to it: Save on
 * a synced bike used to write a NEW local item under the bike's name, a second
 * row for the same bike (#76). So its form has one button, Done.
 */
export function GearForm({ plan, row, onSave, onCancel, onDelete }) {
  const synced = row?.source === 'strava'
  const [name, setName] = useState(row?.name || '')
  const [kind, setKind] = useState(row?.kind || 'climbing-shoes')
  const [acquired, setAcquired] = useState(row?.acquired || '')
  const [primary, setPrimary] = useState(Boolean(row?.primary))
  const [retired, setRetired] = useState(Boolean(row?.retired))
  // In the unit the box is labelled in: hours for time, never the stored minutes
  // (lib/gear.js `priorValueFor`, #76).
  const [prior, setPrior] = useState(() => priorValueFor(row, metricOf(plan, row?.kind || 'climbing-shoes')))
  const [notes, setNotes] = useState(row?.notes || '')
  const [confirming, setConfirming] = useState(false)

  const metric = metricOf(plan, kind)
  const priorLabel = metric === 'miles' ? 'Miles already on it'
    : metric === 'reps' ? 'Reps already on it' : 'Hours already on it'

  const submit = () => {
    if (synced) return onCancel()
    if (!name.trim()) return
    const priorFields = priorFieldsFor(metric, prior, row)
    onSave(row?.id && row.source === 'local' ? row.id : newGearId(), {
      name: synced ? row.name : name.trim(),
      kind, primary, retired,
      acquired: acquired || undefined,
      notes: notes.trim() || undefined,
      ...priorFields,
    })
  }

  // The confirm screen, in place of the form: one question, the consequence, two answers.
  if (confirming) {
    return (
      <div className="confirm">
        <span className="confirm-ico"><Icon name="TriangleAlert" size={34} /></span>
        <h3>Remove {row.name}?</h3>
        <p className="sub">Workouts logged with it keep their history.</p>
        <div className="confirm-acts">
          <button className="btn ghost" onClick={() => setConfirming(false)}>Keep it</button>
          <button className="btn bad" onClick={onDelete}>Remove</button>
        </div>
      </div>
    )
  }

  return (
    <div className="prof-sec gear-form">
      <h2>{row ? row.name : 'Add gear'}</h2>
      {synced && <p className="sub">From Strava, which keeps its name, odometer and default.</p>}

      {!synced && (
        <label className="field">
          Name
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Mammut 9.5 Crag Classic" />
        </label>
      )}

      <label className="field">
        Kind
        <select value={kind} onChange={e => setKind(e.target.value)} disabled={synced}>
          {gearKinds(plan).map(k => <option key={k.key} value={k.key}>{k.name}</option>)}
        </select>
      </label>

      <div className="row">
        <label className="field">
          Since
          <input type="date" value={acquired} onChange={e => setAcquired(e.target.value)} disabled={synced} />
        </label>
        <label className="field">
          {priorLabel}
          <NumInput value={prior ?? ''} onChange={setPrior} placeholder="0" disabled={synced} />
        </label>
      </div>

      <div className="list">
        <label className="list-row prof-check">
          <span className="list-row-main">
            <span className="list-row-title">Default for {kindOf(plan, kind)?.name?.toLowerCase() || 'this kind'}</span>
          </span>
          <input type="checkbox" role="switch" className="switch" checked={primary} onChange={e => setPrimary(e.target.checked)} disabled={synced} />
        </label>
        <label className="list-row prof-check">
          <span className="list-row-main">
            <span className="list-row-title">Retired</span>
            <span className="list-row-meta">Keeps its history, stops being offered</span>
          </span>
          <input type="checkbox" role="switch" className="switch" checked={retired} onChange={e => setRetired(e.target.checked)} disabled={synced} />
        </label>
      </div>

      <label className="field">
        Notes
        <input value={notes} onChange={e => setNotes(e.target.value)} disabled={synced} />
      </label>

      <div className="prof-actions">
        {onDelete && <button className="btn quiet prof-remove" onClick={() => setConfirming(true)}>Remove</button>}
        {!synced && <button className="btn ghost" onClick={onCancel}>Cancel</button>}
        <button className="btn" onClick={submit}>{synced ? 'Done' : row ? 'Save' : 'Add it'}</button>
      </div>
    </div>
  )
}
