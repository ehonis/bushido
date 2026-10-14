/*
 * SHARED WORKOUTS, on the sheet: "With …", the person switcher, and the other
 * person's side of the form. The rules are in lib/shared.js; the server's half is
 * `peopleRoute` in server.js.
 *
 * Owner-only, and only on the owner's own log: `sharePeople(me)` is empty for
 * anyone else, while acting as someone, and on an install with one person, and
 * then none of this renders. Act-as stays the way to open someone's whole log;
 * this is for the one workout the two of them did together.
 *
 * The other person's copy is never held in the owner's store or cache. The sheet
 * keeps WHICH person and WHICH entry id are open, and the copy is whatever the
 * server last answered for that id, re-read every time their side is opened
 * (AGENTS.md §6.2: a component holding a copy of a synced entry is showing the
 * past).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import { SessionLog } from './sessionlog.jsx'
import { withLine } from './lib/shared.js'
import { getPersonEntry, putPersonEntry } from './lib/peopleapi.js'

/**
 * Who else is on this workout, and the way to add or take off someone.
 * `on` is `sharedPeopleOn(entry, people)`; `people` is `sharePeople(me)`.
 */
export function WithControl({ on = [], people = [], busy = null, error = null, onAdd, onRemove }) {
  if (!people.length) return null
  const free = people.filter(p => !on.some(o => o.id === p.id))
  return (
    <div className="withrow" role="group" aria-label="Who else did this workout">
      <span className="withrow-lead"><Icon name="Users" size={14} /> With</span>
      {on.map(p => (
        <span key={p.id} className="chip on withchip">
          {p.name}
          <button type="button" className="withchip-x" disabled={Boolean(busy)}
            onClick={() => onRemove(p)} aria-label={`Take ${p.name} off this workout`}>
            <Icon name="X" size={12} />
          </button>
        </span>
      ))}
      {free.map(p => (
        <button key={p.id} type="button" className="chip withadd" disabled={Boolean(busy)}
          onClick={() => onAdd(p)} aria-label={`Add ${p.name} to this workout`}>
          <Icon name="Plus" size={12} /> {p.name}
        </button>
      ))}
      {busy && <span className="withrow-busy">{busy}</span>}
      {error && <span className="withrow-err">{error}</span>}
    </div>
  )
}

/** You / Sam, at the top of a shared workout's sheet. Nothing without someone on it. */
export function PersonSwitch({ on = [], side = null, onSide }) {
  if (!on.length) return null
  return (
    <div className="seg personswitch" role="tablist" aria-label="Whose log this sheet is filling in">
      <button type="button" role="tab" aria-selected={!side} className={!side ? 'on' : ''}
        onClick={() => onSide(null)}>You</button>
      {on.map(p => (
        <button key={p.id} type="button" role="tab" aria-selected={side === p.id}
          className={side === p.id ? 'on' : ''} onClick={() => onSide(p.id)}>{p.name}</button>
      ))}
    </div>
  )
}

/** "with Alex": who a shared workout was done with, where nothing can be changed about it. */
export function SharedNote({ entry, people = [] }) {
  const line = withLine(entry, people)
  if (!line) return null
  return <p className="sharednote"><Icon name="Users" size={12} /> {line}</p>
}

/**
 * Someone's copy of a shared workout, read and written through
 * `/api/people/:id/entry`. `update(fn)` applies `fn` to the latest copy (never a
 * closure's), shows it at once and sends it; the server's merged answer
 * replaces it unless a newer edit has gone out since.
 */
export function usePersonCopy(personId, entryId, name = '') {
  const [state, setState] = useState({ entry: null, loading: false, error: null })
  const latest = useRef(null)

  useEffect(() => {
    latest.current = null
    if (!personId || !entryId) { setState({ entry: null, loading: false, error: null }); return undefined }
    let live = true
    setState({ entry: null, loading: true, error: null })
    getPersonEntry(personId, entryId)
      .then(e => { if (!live) return; latest.current = e; setState({ entry: e, loading: false, error: null }) })
      .catch(err => { if (live) setState({ entry: null, loading: false, error: `Could not open ${name || 'their'} log: ${err.message}` }) })
    return () => { live = false }
  }, [personId, entryId, name])

  const update = useCallback(async (fn) => {
    const cur = latest.current
    if (!cur || cur.deleted) return
    const next = fn(cur)
    latest.current = next
    setState(s => ({ ...s, entry: next, error: null }))
    try {
      const merged = await putPersonEntry(personId, next)
      if (latest.current === next) { latest.current = merged; setState(s => ({ ...s, entry: merged })) }
    } catch (err) {
      setState(s => ({ ...s, error: `Not saved to ${name || 'their'} log yet: ${err.message}` }))
    }
  }, [personId, name])

  return { ...state, update }
}

/**
 * The other person's side of the sheet: their form, with the owner's numbers as
 * placeholders, and no WHOOP or Strava (the owner's accounts). Pure render, so
 * the smoke suite can draw it without a server.
 */
export function TheirSide({ session, copy, loading = false, error = null, person, ownerOut, entries = [], onSave, plan = null, onCopyMine = null, ownerHasExercises = false }) {
  if (loading) return <p className="sub theirside-wait">Opening {person.name}&rsquo;s log…</p>
  if (!copy || copy.deleted) {
    return (
      <p className="sub theirside-gone">
        {error || `This workout is not in ${person.name}'s log any more.`}
      </p>
    )
  }
  return (
    <div className="theirside">
      <p className="sub theirside-lead">
        Filling in <strong>{person.name}</strong>&rsquo;s log. Your numbers show greyed out as a guide; the
        weights here are {person.name}&rsquo;s.
      </p>
      {error && <p className="withrow-err">{error}</p>}
      {plan}
      <SessionLog session={session} entry={copy} entries={entries} onSave={onSave}
        hints={ownerOut || null} measured={false} defaultOpen />
      {/* The owner's exercises, copied over when asked: never their numbers (lib/shared.js copyExercises). */}
      {onCopyMine ? (
        <button className="btn ghost theirside-copy" onClick={onCopyMine}>
          <Icon name="Copy" size={16} /> Copy my exercises to {person.name}
        </button>
      ) : ownerHasExercises ? (
        <p className="sub theirside-copied">{person.name} has all your exercises.</p>
      ) : null}
    </div>
  )
}
