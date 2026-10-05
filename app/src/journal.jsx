/*
 * The journal card — what the coach check-in became.
 *
 * The old card was a climbing block's daily questionnaire (how the fingers read,
 * how the skin read, how long you have at the gym) wrapped around a conversation
 * with a coach. Once the app stopped focusing on fingers that check-in was
 * obsolete, so this card is modelled on the WHOOP journal instead: track
 * behaviours and metrics, and find patterns in them.
 *
 * The coach moved out entirely — it is its own tab and a floating bubble now, and
 * has nothing to do with a daily form.
 *
 * WHAT SURVIVED, AND WHY. Three of the old fields feed the recommender's hard
 * blocks: where you are, how long you have, and how the fingers read. Those are
 * not journal entries, they are today's facts, and deleting them would be
 * deleting the thing that stops the board offering a gym session to a man in their
 * kitchen. They stay as one compact row and still write the same `checkin` entry,
 * so `dayFacts` and the whole engine are untouched by this rewrite.
 *
 * Everything below that row is new: the behaviours the user has chosen to track, their
 * own invented metrics, and — the point of the whole thing — what any of it is
 * doing to the next morning.
 */

import { useMemo, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import { Modal } from './modal.jsx'
import { useWhoop } from './lib/whoop.jsx'
import { checkinFields, checkinFor, fieldsOf } from './lib/checkin.js'
import {
  allFields, trackedFields, visibleFields, pruneJournal, journalValues, buildJournalEntry,
  customMetrics, buildCustomEntry, newMetricKey, correlate, recoveryIndex, journalStreak,
  MIN_DAYS,
} from './lib/journal.js'

/* --------------------------------------------------------------- the card */

export function Journal({ plan, entries, iso, upsertEntry, settings, saveSettings }) {
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const { cache: whoop } = useWhoop()

  const tracked = settings?.journal?.tracked || []
  const values = journalValues(entries, iso)
  const fields = useMemo(() => trackedFields(plan, entries, tracked), [plan, entries, tracked])
  const shown = visibleFields(fields, values)

  const set = (key, value) => {
    const next = { ...values }
    if (value === undefined || value === null || value === '') delete next[key]
    else next[key] = value
    upsertEntry(buildJournalEntry(iso, pruneJournal(fields, next)))
  }

  const answered = Object.keys(values).length
  const streak = journalStreak(entries, iso)

  return (
    <>
      <div className="card journal">
        <h2>
          <Icon name="NotebookPen" size={16} /> Journal
          {answered > 0 && <span className="journal-n">{answered} logged</span>}
        </h2>

        <TodayFacts plan={plan} entries={entries} iso={iso} upsertEntry={upsertEntry} />

        {!fields.length ? (
          <p className="sub journal-empty">
            {plan?.journal?.note}
          </p>
        ) : (
          (plan?.journal?.groups || []).map(g => {
            const mine = shown.filter(f => (f.group || 'state') === g.key)
            if (!mine.length) return null
            return (
              <div className="journal-group" key={g.key}>
                <h3><Icon name={g.icon} size={14} /> {g.name}</h3>
                {mine.map(f => <JournalField key={f.key} field={f} value={values[f.key]} onChange={v => set(f.key, v)} />)}
              </div>
            )
          })
        )}

        <div className="journal-foot">
          <button className="restbtn" onClick={() => setEditing(true)}>
            <Icon name="Grid2x2" size={16} />
            <span>{fields.length ? `Tracking ${fields.length}` : 'Choose what to track'}</span>
          </button>
          <span className="sub">{streak.filled} of the last {streak.of} days</span>
        </div>
      </div>

      <Patterns plan={plan} entries={entries} tracked={tracked} whoop={whoop} />

      {editing && (
        <TrackEditor plan={plan} entries={entries} tracked={tracked}
          onToggle={(key) => {
            const next = tracked.includes(key) ? tracked.filter(k => k !== key) : [...tracked, key]
            saveSettings({ journal: { ...(settings?.journal || {}), tracked: next } })
          }}
          onAdd={() => { setEditing(false); setAdding(true) }}
          onDeleteCustom={(key) => upsertEntry(buildCustomEntry(
            customMetrics(entries).filter(m => m.key !== key)))}
          onClose={() => setEditing(false)} />
      )}

      {adding && (
        <MetricMaker onSave={(m) => {
          upsertEntry(buildCustomEntry([...customMetrics(entries), m]))
          setAdding(false)
        }} onClose={() => setAdding(false)} />
      )}
    </>
  )
}

/* ------------------------------------------------- today's facts, kept */

/**
 * The three fields the recommender actually reads.
 *
 * Deliberately compact and deliberately first: they are not things the user is logging
 * for later, they are what the board needs to know NOW. Everything else on this
 * card is for the version of them reading it in three months.
 */
function TodayFacts({ plan, entries, iso, upsertEntry }) {
  const defs = checkinFields(plan).filter(f => f.informs)
  const entry = checkinFor(entries, iso)
  const fields = fieldsOf(entry)

  const set = (key, value) => {
    const next = { ...fields }
    if (value === undefined || value === null || value === '') delete next[key]
    else next[key] = value
    upsertEntry({
      ...(entry || { id: `checkin-${iso}`, kind: 'checkin', date: iso }),
      data: { ...(entry?.data || {}), fields: next },
    })
  }

  if (!defs.length) return null
  return (
    <div className="jfacts">
      {defs.map(f => (
        <div className="jfact" key={f.key}>
          <span className="jfact-label">{f.label}</span>
          {f.type === 'choice' ? (
            <div className="jfact-opts">
              {(f.options || []).map(o => (
                <button key={o.value}
                  className={`chip ${fields[f.key] === o.value ? 'on' : ''}`}
                  onClick={() => set(f.key, fields[f.key] === o.value ? '' : o.value)}>
                  {o.icon && <Icon name={o.icon} size={13} />} {o.label}
                </button>
              ))}
            </div>
          ) : f.type === 'slider' ? (
            <Slider field={f} value={fields[f.key]} onChange={v => set(f.key, v)} />
          ) : (
            <input type="number" inputMode="decimal" className="jfact-num"
              value={fields[f.key] ?? ''} placeholder={f.hint || ''}
              onChange={e => set(f.key, e.target.value === '' ? '' : Number(e.target.value))} />
          )}
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------ the fields */

function JournalField({ field, value, onChange }) {
  if (field.type === 'toggle') {
    return (
      <button className={`jtoggle ${value ? 'on' : ''}`} onClick={() => onChange(!value)}>
        <span className="jtoggle-box">{value && <Icon name="Check" size={13} />}</span>
        <span>{field.label}</span>
      </button>
    )
  }
  if (field.type === 'slider') {
    return (
      <div className="jslider">
        <span className="jslider-label">{field.label}<em>{value ?? '—'}</em></span>
        <Slider field={field} value={value} onChange={onChange} />
      </div>
    )
  }
  if (field.type === 'text') {
    return (
      <label className="field jnote">
        {field.label}
        <input value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder="optional" />
      </label>
    )
  }
  return (
    <label className="field jnum">
      {field.label}
      <input type="number" inputMode="decimal" value={value ?? ''}
        max={field.max} min={field.min ?? 0}
        onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
    </label>
  )
}

function Slider({ field, value, onChange }) {
  const min = field.min ?? 1
  const max = field.max ?? 10
  return (
    <div className="jslide">
      <input type="range" min={min} max={max} step={field.step ?? 1}
        value={value ?? field.default ?? Math.round((min + max) / 2)}
        onChange={e => onChange(Number(e.target.value))} />
      {field.scale && (
        <div className="jslide-scale">
          {field.scale.map((s, i) => <span key={i}>{s}</span>)}
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------- the patterns */

/**
 * What any of it is doing to the next morning.
 *
 * The reason the journal exists, and the reason it is in Bushido rather than left
 * to WHOOP: this app has the recovery scores AND knows what the user trained.
 *
 * Says "not yet" out loud rather than showing a number that will move twenty
 * points next week — a correlation over three days is a coincidence with a
 * decimal place, and the fastest way to teach someone to distrust a screen is to
 * show them one that keeps changing its mind.
 */
function Patterns({ plan, entries, tracked, whoop }) {
  const recoveryByDate = useMemo(() => recoveryIndex(whoop), [whoop])
  const rows = useMemo(
    () => correlate({ plan, entries, tracked, recoveryByDate }),
    [plan, entries, tracked, recoveryByDate])

  if (!rows.length) return null
  const ready = rows.filter(r => r.enough)
  const waiting = rows.filter(r => !r.enough)

  return (
    <div className="card">
      <h2><Icon name="Waypoints" size={16} /> Patterns</h2>
      <p className="sub">
        Each behaviour against the <strong>next morning&rsquo;s</strong> recovery — what you did
        on Tuesday shows up in Wednesday&rsquo;s score, because the score is computed off the night.
      </p>

      {!Object.keys(recoveryByDate).length && (
        <p className="sub" style={{ marginBottom: 0 }}>
          No WHOOP recovery data cached yet, so there is nothing to compare against.
        </p>
      )}

      {ready.map(r => (
        <div className="pattern" key={r.field.key}>
          <span className="pattern-name">
            {r.field.label}
            {r.split !== null && <em>above {r.split}</em>}
          </span>
          <span className={`pattern-delta ${r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : ''}`}>
            {r.delta > 0 ? '+' : ''}{r.delta}
          </span>
          <span className="pattern-n">{r.on.mean} vs {r.off.mean} · {r.on.n}/{r.off.n} days</span>
        </div>
      ))}

      {waiting.length > 0 && (
        <p className="sub pattern-waiting">
          {waiting.length === rows.length ? 'Nothing has enough days yet. ' : ''}
          Still gathering: {waiting.slice(0, 6).map(r => r.field.label).join(', ')}
          {waiting.length > 6 ? ` and ${waiting.length - 6} more` : ''}.
          Each needs {MIN_DAYS} days either side before it says anything.
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------ the editor */

function TrackEditor({ plan, entries, tracked, onToggle, onAdd, onDeleteCustom, onClose }) {
  const fields = allFields(plan, entries)
  const groups = plan?.journal?.groups || []
  return (
    <Modal title="What to track" icon="Grid2x2" onClose={onClose}
      sub={`${tracked.length} on, out of ${fields.filter(f => !f.custom).length}`}
      footer={<button className="restbtn" onClick={onAdd}>
        <Icon name="Plus" size={16} /><span>Make your own</span>
      </button>}>
      <p className="sub">{plan?.journal?.note}</p>
      {groups.map(g => (
        <div className="journal-group" key={g.key}>
          <h3><Icon name={g.icon} size={14} /> {g.name}</h3>
          {fields.filter(f => (f.group || 'state') === g.key && !f.when).map(f => (
            <div className="trackrow" key={f.key}>
              <button className={`jtoggle ${f.custom || tracked.includes(f.key) ? 'on' : ''}`}
                disabled={f.custom}
                onClick={() => onToggle(f.key)}>
                <span className="jtoggle-box">
                  {(f.custom || tracked.includes(f.key)) && <Icon name="Check" size={13} />}
                </span>
                <span>{f.label}{f.custom && <em className="trackrow-mine">yours</em>}</span>
              </button>
              {f.custom && (
                <button className="trackrow-del" onClick={() => onDeleteCustom(f.key)}
                  aria-label={`Delete ${f.label}`}><Icon name="Trash2" size={14} /></button>
              )}
            </div>
          ))}
        </div>
      ))}
    </Modal>
  )
}

/**
 * Making your own.
 *
 * The user can define new metrics to track in the journal, with a choice of
 * input (a 1–10 slider, say). So the four shapes the catalog itself uses, and a custom metric is not second-class:
 * it renders, charts and correlates exactly as a catalogued one does.
 */
function MetricMaker({ onSave, onClose }) {
  const [label, setLabel] = useState('')
  const [type, setType] = useState('toggle')
  const [group, setGroup] = useState('state')
  const [min, setMin] = useState(1)
  const [max, setMax] = useState(10)

  const save = () => {
    if (!label.trim()) return
    const m = { key: newMetricKey(), label: label.trim(), type, group }
    if (type === 'slider') { m.min = Number(min) || 1; m.max = Number(max) || 10; m.default = Math.round(((Number(min) || 1) + (Number(max) || 10)) / 2) }
    onSave(m)
  }

  return (
    <Modal title="Your own metric" icon="Plus" onClose={onClose}
      footer={<button className="primary" onClick={save} disabled={!label.trim()}>Add it</button>}>
      <label className="field">
        What is it
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Gut feel, back pain, hours outside…" />
      </label>
      <label className="field">
        How do you answer it
        <select value={type} onChange={e => setType(e.target.value)}>
          <option value="toggle">Yes or no</option>
          <option value="slider">A slider</option>
          <option value="number">A number</option>
          <option value="text">A note</option>
        </select>
      </label>
      {type === 'slider' && (
        <div className="row">
          <label className="field">From<input type="number" value={min} onChange={e => setMin(e.target.value)} /></label>
          <label className="field">To<input type="number" value={max} onChange={e => setMax(e.target.value)} /></label>
        </div>
      )}
      <label className="field">
        Where it lives
        <select value={group} onChange={e => setGroup(e.target.value)}>
          <option value="sleep">Sleep &amp; wind-down</option>
          <option value="intake">Intake</option>
          <option value="state">How you are</option>
          <option value="recovery">Recovery work</option>
        </select>
      </label>
      <p className="sub" style={{ marginBottom: 0 }}>
        Anything except a note gets compared against your recovery once there are{' '}
        {MIN_DAYS} days either side of it.
      </p>
    </Modal>
  )
}
