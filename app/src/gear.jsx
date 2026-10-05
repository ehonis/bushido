/*
 * The gear screen — what the user owns and what it has done.
 *
 * The logic is `lib/gear.js`; this is the page. Two things it does that the old
 * Gear tab did not: it shows USE rather than price, and the things in it are
 * things the user owns rather than things somebody thought they should buy.
 *
 * Grouped by kind rather than by origin. Where an item came from — Strava, or the
 * user's own typing — is a small tag, not a heading: "my bikes" is the question, and
 * "which of these does Strava know about" is a footnote on it.
 */

import { useMemo, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import {
  gearUsage, gearKinds, kindOf, headlineFor, buildGearEntry, newGearId,
} from './lib/gear.js'

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

  return (
    <>
      <div className="card">
        <h2>Your gear</h2>
        <p className="sub" style={{ marginBottom: 0 }}>{plan?.gearNote}</p>
      </div>

      {!groups.length && (
        <div className="card">
          <h2>Nothing here yet</h2>
          <p className="sub" style={{ marginBottom: 0 }}>
            Bikes and shoes arrive from Strava on their own. Everything else — ropes,
            harnesses, climbing shoes, plates, the Port-A-Board — you add below, and the
            app counts its use from what you log.
          </p>
        </div>
      )}

      {groups.map(({ kind, items }) => (
        <div className="card" key={kind.key}>
          <h2><Icon name={kind.icon} size={16} /> {kind.name}</h2>
          {kind.blurb && <p className="sub">{kind.blurb}</p>}
          {items.map(row => (
            <GearRow key={row.id} row={row} kind={kind}
              onEdit={() => setEditing(row)}
              onDelete={row.source === 'local' ? () => deleteEntry?.(row.id) : null} />
          ))}
        </div>
      ))}

      {(adding || editing) && (
        <GearForm plan={plan} row={editing} onSave={save}
          onCancel={() => { setAdding(false); setEditing(null) }} />
      )}

      {!adding && !editing && (
        <button className="dl-add" onClick={() => setAdding(true)}>
          <Icon name="Plus" size={16} /> Add a piece of gear
        </button>
      )}
    </>
  )
}

function GearRow({ row, kind, onEdit, onDelete }) {
  const head = headlineFor(row)
  return (
    <div className={`gearrow ${row.retired ? 'retired' : ''}`}>
      <span className="gearrow-name">
        <strong>{row.name}</strong>
        <span className="sub">
          {row.source === 'strava' && <span className="srcpip strava">Strava</span>}
          {row.primary && <span className="gearpip">default</span>}
          {row.retired && <span className="gearpip">retired</span>}
          {row.acquired && <span>since {row.acquired}</span>}
          {row.lastUsed && <span>last used {row.lastUsed}</span>}
          {!row.lastUsed && !row.acquired && row.source === 'local' && <span>not used yet</span>}
        </span>
        {/*
          * The mileage gap, said out loud rather than folded into one number.
          * Strava keeps its own odometer for this bike; anything logged here with
          * no Strava activity attached is a ride it cannot have seen. Adding them
          * together would double-count every ride that WAS on Strava.
          */}
        {row.source === 'strava' && row.unsyncedMiles > 0 && (
          <span className="gearrow-gap">
            + {fmt(row.unsyncedMiles)} mi logged here that Strava has not seen
          </span>
        )}
      </span>

      <span className="gearrow-num">
        <strong>{fmt(head.value)}</strong>
        <em>{head.unit}</em>
        {/* Weights measure reps, but the hours are worth having too. */}
        {kind.metric === 'reps' && row.minutes > 0 && (
          <span className="sub">{Math.round(row.minutes / 60)} hr</span>
        )}
        {row.sessions > 0 && <span className="sub">{row.sessions} session{row.sessions === 1 ? '' : 's'}</span>}
      </span>

      <span className="gearrow-acts">
        <button onClick={onEdit} aria-label={`Edit ${row.name}`}><Icon name="NotebookPen" size={15} /></button>
        {onDelete && (
          <button onClick={onDelete} aria-label={`Delete ${row.name}`}><Icon name="Trash2" size={15} /></button>
        )}
      </span>
    </div>
  )
}

/**
 * Add or edit.
 *
 * Strava-synced gear can be edited here only in the ways the app owns — whether it
 * is the default, and what it had done before. Its NAME and its odometer stay
 * Strava's, because two places to rename one bike is how they stop being the same
 * bike.
 */
function GearForm({ plan, row, onSave, onCancel }) {
  const synced = row?.source === 'strava'
  const [name, setName] = useState(row?.name || '')
  const [kind, setKind] = useState(row?.kind || 'climbing-shoes')
  const [acquired, setAcquired] = useState(row?.acquired || '')
  const [primary, setPrimary] = useState(Boolean(row?.primary))
  const [retired, setRetired] = useState(Boolean(row?.retired))
  const [prior, setPrior] = useState(
    String(row?.priorMiles || row?.priorMinutes || row?.priorReps || ''))
  const [notes, setNotes] = useState(row?.notes || '')

  const metric = kindOf(plan, kind)?.metric || 'time'
  const priorLabel = metric === 'miles' ? 'Miles already on it'
    : metric === 'reps' ? 'Reps already on it' : 'Hours already on it'

  const submit = () => {
    if (!synced && !name.trim()) return
    const n = Number(prior)
    const priorFields = {}
    if (Number.isFinite(n) && n > 0) {
      if (metric === 'miles') priorFields.priorMiles = n
      else if (metric === 'reps') priorFields.priorReps = n
      else priorFields.priorMinutes = n * 60
    }
    onSave(row?.id && row.source === 'local' ? row.id : newGearId(), {
      name: synced ? row.name : name.trim(),
      kind, primary, retired,
      acquired: acquired || undefined,
      notes: notes.trim() || undefined,
      ...priorFields,
    })
  }

  return (
    <div className="card gearform">
      <h2>{row ? `Edit ${row.name}` : 'Add gear'}</h2>
      {synced && (
        <p className="sub">
          This one comes from Strava, which keeps its name and its odometer. What you
          can set here is whether it is your default and what it had done before.
        </p>
      )}

      {!synced && (
        <label className="field">
          Name
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Mammut 9.5 Crag Classic" />
        </label>
      )}

      <label className="field">
        What is it
        <select value={kind} onChange={e => setKind(e.target.value)} disabled={synced}>
          {gearKinds(plan).map(k => <option key={k.key} value={k.key}>{k.name}</option>)}
        </select>
      </label>

      <div className="row">
        <label className="field">
          Since
          <input type="date" value={acquired} onChange={e => setAcquired(e.target.value)} />
        </label>
        <label className="field">
          {priorLabel}
          <input type="number" inputMode="decimal" value={prior}
            onChange={e => setPrior(e.target.value)} placeholder="0" />
        </label>
      </div>
      <p className="sub">
        A rope with two hundred hours on it does not become new because you only
        just told the app about it.
      </p>

      <label className="out-toggle">
        <input type="checkbox" checked={primary} onChange={e => setPrimary(e.target.checked)} />
        <span>Use this by default for {kindOf(plan, kind)?.name?.toLowerCase() || 'this kind'}</span>
      </label>
      <label className="out-toggle">
        <input type="checkbox" checked={retired} onChange={e => setRetired(e.target.checked)} />
        <span>Retired — keep the history, stop offering it</span>
      </label>

      <label className="field">
        Notes
        <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="optional" />
      </label>

      <div className="quotafoot">
        <button className="restbtn" onClick={onCancel} style={{ flex: 1 }}>Cancel</button>
        <button className="primary" onClick={submit}>{row ? 'Save' : 'Add it'}</button>
      </div>
    </div>
  )
}
