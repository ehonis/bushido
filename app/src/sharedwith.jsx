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
 * and every few seconds while it is (AGENTS.md §6.2: a component holding a copy
 * of a synced entry is showing the past). With sync on, the server keeps the
 * exercises the same on both sides (server/sharedsync.js); this file only shows
 * the switch.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import { SessionLog } from './sessionlog.jsx'
import { withLine, openSide } from './lib/shared.js'
import { getPersonEntry, putPersonEntry } from './lib/peopleapi.js'
import { pendingFor, retryPending, andWords } from './lib/trainer.js'

/** How often an open side re-reads their copy, for changes made on their own phone. */
const REREAD_MS = 10000
/** The side each shared workout was last viewed on, on this device: `{ [entryId]: personId }`. */
const SIDE_KEY = 'bushido:shared-side'
const SIDES_KEPT = 50

/**
 * Who else is on this workout, and the way to add or take off someone: a
 * section head, then one person chip each (their initial and name in their
 * colour, × to take them off) and a dashed chip for everyone who could be added.
 * `on` is `sharedPeopleOn(entry, people)` (with `tone`); `people` is `sharePeople(me)`.
 */
export function WithControl({ on = [], people = [], busy = null, error = null, onAdd, onRemove }) {
  if (!people.length) return null
  const free = people.filter(p => !on.some(o => o.id === p.id))
  return (
    <section className="withrow" role="group" aria-label="Who else did this workout">
      <div className="section-head">
        <h3>With</h3>
        {busy && <span className="sub">{busy}</span>}
      </div>
      <div className="personchips">
        {on.map(p => (
          <span key={p.id} className="chip personchip on" data-tone={p.tone ?? 1}>
            <Avatar name={p.name} tone={p.tone ?? 1} small />
            <span className="personchip-name">{p.name}</span>
            <button type="button" className="personchip-x" disabled={Boolean(busy)}
              onClick={() => onRemove(p)} aria-label={`Take ${p.name} off this workout`}>
              <Icon name="X" size={14} />
            </button>
          </span>
        ))}
        {free.map(p => (
          <button key={p.id} type="button" className="chip ghost personchip" disabled={Boolean(busy)}
            onClick={() => onAdd(p)} aria-label={`Add ${p.name} to this workout`}>
            <Icon name="Plus" size={14} /> {p.name}
          </button>
        ))}
      </div>
      {error && <p className="withrow-err">{error}</p>}
    </section>
  )
}

/** A person's initial in their colour. `small` inside a chip or a line of text. */
export function Avatar({ name, tone = 0, small = false }) {
  return (
    <span className={small ? 'avatar sm' : 'avatar'} data-tone={tone} aria-hidden="true">
      {String(name || '?').trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

/**
 * One person as a choice: their initial and name, in their colour when picked.
 * The same chip in "With …" and "For: …", so a person looks the same wherever
 * the owner meets them.
 */
export function PersonChip({ person, tone = 1, on = false, onClick, label = null }) {
  return (
    <button type="button" className={on ? 'chip personchip on' : 'chip personchip'} data-tone={tone}
      aria-pressed={on} aria-label={label || undefined} onClick={onClick}>
      <Avatar name={person.name} tone={tone} small />
      <span className="personchip-name">{person.name}</span>
    </button>
  )
}

/**
 * You / Sam, pinned to the top of a shared workout's sheet while it scrolls: a
 * segmented control, each person's initial and name, the side being filled in
 * raised in that person's colour, with a rule in it under the bar. Nothing
 * without someone on it. `on` people carry `tone`.
 */
export function PersonSwitch({ on = [], side = null, onSide }) {
  if (!on.length) return null
  const who = [{ id: null, name: 'You', tone: 0 }, ...on]
  const current = who.find(p => (p.id || null) === (side || null)) || who[0]
  return (
    <div className="personbar" data-tone={current.tone ?? 1}>
      <div className="seg whoseg" role="tablist" aria-label="Whose log this is">
        {who.map(p => {
          const sel = (p.id || null) === (side || null)
          return (
            <button key={p.id || 'you'} type="button" role="tab" aria-selected={sel} data-tone={p.tone ?? 1}
              className={sel ? 'personbar-btn on' : 'personbar-btn'} onClick={() => onSide(p.id || null)}>
              <Avatar name={p.name} tone={p.tone ?? 1} />
              <span className="personbar-name">{p.name}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** "Sync exercises with Sam": one switch per person on the workout. */
export function SyncToggle({ person, on, onChange }) {
  return (
    <label className="synctoggle">
      <span className="synctoggle-text">
        <span className="synctoggle-label">Sync exercises with {person.name}</span>
        <span className="synctoggle-sub">
          {on ? 'Exercises and sets stay the same on both sides; your numbers stay yours.' : 'Off: changes stay on the side you make them.'}
        </span>
      </span>
      <input type="checkbox" role="switch" className="switch" checked={on} onChange={e => onChange(e.target.checked)} />
    </label>
  )
}

function readSides() {
  try { return JSON.parse(globalThis.localStorage?.getItem(SIDE_KEY) || '{}') || {} } catch { return {} }
}

/**
 * Which side this sheet is on, starting on the one last viewed on this device
 * and remembering every switch. Device-local: it is where this phone was, not
 * something the other person's log needs to know.
 */
export function useSide(entryId, on = []) {
  const [side, setSide] = useState(() => openSide(entryId ? readSides()[entryId] : null, on))
  const pick = useCallback((id) => { setSide(id); rememberSide(entryId, id) }, [entryId])
  return [openSide(side, on), pick]
}

/** Remember the side a shared workout was last on (null: the owner's), from the sheet or a running workout. */
export function rememberSide(entryId, id) {
  if (!entryId) return
  try {
    const all = readSides()
    delete all[entryId]
    if (id) all[entryId] = id
    const kept = Object.fromEntries(Object.entries(all).slice(-SIDES_KEPT))
    globalThis.localStorage?.setItem(SIDE_KEY, JSON.stringify(kept))
  } catch { /* storage full or off: the sheet just opens on yours */ }
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
  // Loading from the first frame: a sheet that reopens on their side must not flash "not in their log".
  // `server` is what the server last said, apart from `entry`, which may hold a
  // write still on its way (or one that never landed): whatever must not be
  // fooled by that (a side's "done", a circuit done together) reads `server`.
  const [state, setState] = useState(() => ({ entry: null, server: null, loading: Boolean(personId && entryId), error: null }))
  const latest = useRef(null)
  const writing = useRef(0)

  useEffect(() => {
    latest.current = null
    if (!personId || !entryId) { setState({ entry: null, server: null, loading: false, error: null }); return undefined }
    let live = true
    setState({ entry: null, server: null, loading: true, error: null })
    getPersonEntry(personId, entryId)
      .then(e => { if (!live) return; latest.current = e; setState({ entry: e, server: e, loading: false, error: null }) })
      .catch(err => { if (live) setState({ entry: null, server: null, loading: false, error: `Could not open ${name || 'their'} log: ${err.message}` }) })
    /*
     * Re-read while open, so an exercise they add on their own phone (or one
     * synced in from the owner's side) appears without closing the sheet. Never
     * over an edit still on its way: the server's answer to that replaces it.
     */
    const iv = setInterval(() => {
      if (writing.current || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return
      const was = latest.current
      getPersonEntry(personId, entryId).then(e => {
        if (!live || !e) return
        setState(s => (s.server === e ? s : { ...s, server: e }))
        if (writing.current || latest.current !== was) return
        if (was && String(e.updatedAt || '') <= String(was.updatedAt || '')) return
        latest.current = e
        setState(s => ({ ...s, entry: e }))
      }).catch(() => { /* offline: keep what is on screen; the next tick tries again */ })
    }, REREAD_MS)
    return () => { live = false; clearInterval(iv) }
  }, [personId, entryId, name])

  /*
   * Resolves true once the write landed, false if it did not (offline), so a
   * caller that writes for several people can say who it missed (a circuit done
   * together, trainer.jsx). A `fn` that returns nothing has nothing to write;
   * one that returns the entry unchanged re-sends it (the sheet's Retry).
   */
  const update = useCallback(async (fn) => {
    const cur = latest.current
    if (!cur || cur.deleted) return false
    const next = fn(cur)
    if (!next) return true
    latest.current = next
    writing.current += 1
    setState(s => ({ ...s, entry: next, error: null }))
    try {
      const merged = await putPersonEntry(personId, next)
      if (latest.current === next) { latest.current = merged; setState(s => ({ ...s, entry: merged, server: merged })) }
      else setState(s => ({ ...s, server: merged }))
      return true
    } catch (err) {
      setState(s => ({ ...s, error: `Not saved to ${name || 'their'} log yet: ${err.message}` }))
      return false
    } finally {
      writing.current -= 1
    }
  }, [personId, name])

  /** An entry the server just answered with, written elsewhere (a circuit done together). */
  const accept = useCallback((e) => {
    if (!e) return
    if (!latest.current || String(e.updatedAt || '') >= String(latest.current.updatedAt || '')) {
      latest.current = e
      setState(s => ({ ...s, entry: e, server: e }))
    } else setState(s => ({ ...s, server: e }))
  }, [])

  return { ...state, update, accept }
}

/**
 * The other person's side of the sheet: their form, with the owner's numbers as
 * placeholders, and no WHOOP or Strava (the owner's accounts). `entries` is
 * THEIR log, so "last time" is theirs. With sync on there is nothing to copy:
 * the exercises are already the same. Pure render, so the smoke suite can draw
 * it without a server.
 */
export function TheirSide({ session, copy, loading = false, error = null, person, ownerOut, entries = [], onSave, plan = null, onCopyMine = null, ownerHasExercises = false, synced = false }) {
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
        Everything here goes in {person.name}&rsquo;s log. Your numbers show in grey.
      </p>
      {error && <p className="withrow-err">{error}</p>}
      {plan}
      <SessionLog session={session} entry={copy} entries={entries} onSave={onSave}
        hints={ownerOut || null} measured={false} defaultOpen whose={person.name} />
      {/* With sync off: the owner's exercises, copied over when asked, never their numbers (lib/shared.js copyExercises). */}
      {synced ? null : onCopyMine ? (
        <button className="btn ghost theirside-copy" onClick={onCopyMine}>
          <Icon name="Copy" size={16} /> Copy my exercises to {person.name}
        </button>
      ) : ownerHasExercises ? (
        <p className="sub theirside-copied">{person.name} has all your exercises.</p>
      ) : null}
    </div>
  )
}

/**
 * A circuit done together that did not reach someone (lib/trainer.js, rule 4),
 * said on the workout's sheet until it has: tried again as the sheet opens
 * (re-read, then fill, so nothing lands twice), and on Try again. Nothing on a
 * workout with nothing waiting.
 */
export function TogetherPending({ entry, session = null }) {
  const storage = typeof window === 'undefined' ? null : window.localStorage
  // Read against the LIVE entry every render: a miss about a run this entry no
  // longer carries (deleted and planned again, someone taken off) goes.
  const [, setTried] = useState(0)
  const left = pendingFor(storage, entry)
  const [busy, setBusy] = useState(false)
  const retry = async () => {
    setBusy(true)
    try {
      await retryPending({ storage, ownerEntry: entry, readPerson: getPersonEntry, putPerson: putPersonEntry, session })
    } catch { /* still waiting: the note stays */ } finally { setBusy(false); setTried(n => n + 1) }
  }
  useEffect(() => { if (left.length) retry() }, [entry?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!left.length) return null
  return (
    <div className="sharednote together-pending" role="alert">
      <Icon name="TriangleAlert" size={12} />
      <span>The circuit is not on {andWords([...new Set(left.map(p => p.name))])}&rsquo;s log yet</span>
      <button type="button" className="btn quiet" disabled={busy} onClick={retry}>Try again</button>
    </div>
  )
}
