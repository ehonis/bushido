/*
 * SHARED WORKOUTS, on the sheet: the sharing chip and its panel, the person
 * switcher, and the other person's side of the form. The rules are in
 * lib/shared.js; the server's half is `peopleRoute` in server.js.
 *
 * ONE ROW, NOT A SETUP SECTION (#80). Who is on a workout used to be a "With"
 * section of person chips plus one "Sync exercises with Sam" card per person,
 * all of it above the first exercise (the first set started about 1,150px down
 * on the owner's side). Now it is one chip under the title, beside the done
 * chip: "with Sam · in sync ›", or "Add someone" on a workout nobody shares.
 * It opens `SharePanel`, which holds everything that changes who is on it and
 * how: the sync switch, Copy my exercises (sync off), Take Sam off, Add Jo. Those
 * are decisions made once, not things done mid-set, so they live one tap away
 * and never between the title and the workout.
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
import { Undo2 } from 'lucide-react'
import { Icon } from './lib/icons.jsx'
import { UNDO_MS } from './exercises.jsx'
import { Popover } from './modal.jsx'
import { SessionLog } from './sessionlog.jsx'
import {
  withLine, inStepLine, openSide, shareSummary, isSynced, addPerson, removePerson, withSharedPerson,
  withSync, copyExercises, hasExercises, takeOffWords, undoTakeOff,
} from './lib/shared.js'
import * as peopleApi from './lib/peopleapi.js'
import { createCopyQueue, openedCopy } from './lib/copyqueue.js'
import { withAck, isDone } from './lib/store.js'
import { pushToast } from './lib/toast.js'
import { pendingFor, retryPending, andWords } from './lib/trainer.js'

const { getPersonEntry, putPersonEntry, sendPersonEntry } = peopleApi

/** How often an open side re-reads their copy, for changes made on their own phone. */
const REREAD_MS = 10000
/** The side each shared workout was last viewed on, on this device: `{ [entryId]: personId }`. */
const SIDE_KEY = 'bushido:shared-side'
const SIDES_KEPT = 50

/**
 * The owner's one row about who is on this workout, under the title beside the
 * done chip: "with Sam · in sync ›", or "Add someone" when nobody is. A chip,
 * 32px to look at and 44px to hit, like the done chip; it opens `SharePanel`.
 * `on` is `sharedPeopleOn(entry, people)`; `people` is `sharePeople(me)`, empty
 * for anyone but the owner, and then nothing renders.
 */
export function ShareChip({ entry, on = [], people = [], onOpen }) {
  if (!people.length) return null
  const { title, sync } = shareSummary(entry, on)
  return (
    <button type="button" className={on.length ? 'share-chip on' : 'share-chip'} onClick={onOpen} aria-haspopup="dialog"
      aria-label={on.length ? `Who is on this workout: ${title}${sync ? `, ${sync}` : ''}` : 'Add someone to this workout'}>
      <Icon name={on.length ? 'Users' : 'UserPlus'} size={16} />
      <span className="share-chip-text">{title}{sync && <span className="share-chip-sync">{` · ${sync}`}</span>}</span>
      <Icon name="ChevronRight" size={14} />
    </button>
  )
}

/**
 * Everything that changes who is on a workout, and how, behind the sharing chip:
 * per person their sync switch, "Copy my exercises to Sam" while sync is off,
 * and "Take Sam off this workout"; then a row for everyone who could be added.
 * Taking someone off never deletes what they logged: their copy stays in
 * their log, unlinked, and the toast has Undo (lib/shared.js `removePerson`).
 */
export function SharePanel({ entry, on = [], people = [], busy = null, error = null, onAdd, onRemove, onSync, onCopy = null, onClose }) {
  const free = people.filter(p => !on.some(o => o.id === p.id))
  return (
    <Popover label="Who is on this workout" onClose={onClose} over>
      <div className="pop-head">
        <div className="pop-who"><strong>{on.length ? 'Who is on this workout' : 'Add someone'}</strong></div>
        <button type="button" className="pop-x" onClick={onClose} aria-label="Close"><Icon name="X" size={20} /></button>
      </div>
      <div className="sharepanel">
        {on.map(p => {
          const synced = isSynced(entry, p.id)
          return (
            <section key={p.id} className="sharepanel-person" data-tone={p.tone ?? 1} aria-label={p.name}>
              <div className="sharepanel-who">
                <Avatar name={p.name} tone={p.tone ?? 1} />
                <span className="sharepanel-name">{p.name}</span>
              </div>
              <SyncToggle person={p} on={synced} onChange={(v) => onSync(p, v)} />
              {!synced && onCopy && hasExercises(entry) && (
                <button type="button" className="btn secondary" disabled={Boolean(busy)} onClick={() => onCopy(p)}>
                  <Icon name="Copy" size={16} /> Copy my exercises to {p.name}
                </button>
              )}
              <button type="button" className="btn quiet sharepanel-off" disabled={Boolean(busy)} onClick={() => onRemove(p)}>
                <Icon name="UserMinus" size={16} /> Take {p.name} off this workout
              </button>
            </section>
          )
        })}
        {free.length > 0 && (
          <div className="list sharepanel-add">
            {free.map(p => (
              <button key={p.id} type="button" className="list-row" disabled={Boolean(busy)} onClick={() => onAdd(p)}
                aria-label={`Add ${p.name} to this workout`}>
                <Icon name="UserPlus" size={20} />
                <span className="list-row-main">
                  <span className="list-row-title">Add {p.name}</span>
                  <span className="list-row-meta">It goes in {p.name}&rsquo;s log; {p.name} logs their own numbers</span>
                </span>
              </button>
            ))}
          </div>
        )}
        {busy && <p className="sub" role="status">{busy}</p>}
        {error && <p className="withrow-err">{error}</p>}
      </div>
    </Popover>
  )
}

/**
 * The sharing chip's writes, out of the sheet (#80): add someone, take someone
 * off, switch sync, and copy the owner's exercises over. `entry` is the owner's
 * entry as of this render; `side`/`setSide` the side on screen; `theirs` the
 * copy on screen (`usePersonCopy`); `touch` marks the sheet as edited.
 * "Copy my exercises" writes through the ONE queue a side has, so for someone
 * not on screen it opens their side first and copies once their copy is read.
 */
/** Whose copy a person on the workout is, as `usePersonCopy` names the one it holds (`of`). */
export const copyOf = (person) => (person ? `${person.id}\n${person.entryId}` : null)

/**
 * May "Copy my exercises to `person`" write now? Only on their side, with THEIR
 * copy read: right after a switch the copy on screen is still the last side's,
 * and with three people two copies can share an entry id.
 */
export const copyReady = (person, side, theirs) => Boolean(person && side === person.id && theirs?.entry
  && !theirs.loading && theirs.of === copyOf(person))

export function useSharing({ entry, opt, me, onSaveEntry, side, setSide, theirs, touch = () => {} }) {
  const [state, setState] = useState({ isOpen: false, busy: null, error: null })
  const [copyFor, setCopyFor] = useState(null)
  // The entry as of the latest render: an add or a removal awaits the server, and
  // must name the person on what the entry is THEN, not on what it was when tapped.
  const latest = useRef(entry)
  latest.current = entry
  const run = async (verb, person, fn) => {
    setState(s => ({ ...s, busy: `${verb} ${person.name}…`, error: null }))
    try {
      await fn()
      setState(s => ({ ...s, busy: null, error: null }))
    } catch (err) {
      setState(s => ({ ...s, busy: null, error: `${person.name}: ${err.message}` }))
    }
  }
  const add = (person) => run('Adding', person, async () => {
    const { copy } = await addPerson({ ownerEntry: latest.current, person, session: opt,
      owner: { id: me.real.id, name: me.real.name }, api: peopleApi })
    onSaveEntry(withSharedPerson(latest.current, person.id, copy.id))
  })
  /* Nothing they logged goes (lib/shared.js `removePerson`): a copy with their
     marks stays in their log, unlinked. Said in a toast, with Undo. */
  const remove = (person) => {
    // Closed first, as on the phone: the toast's Undo must not sit under the panel's scrim.
    setState(s => ({ ...s, isOpen: false }))
    return takeOff(person)
  }
  const takeOff = (person) => run('Taking off', person, async () => {
    const taken = await removePerson({ ownerEntry: latest.current, person, session: opt, api: peopleApi })
    if (!taken) return
    if (side === person.id) setSide(null)
    onSaveEntry(withSharedPerson(latest.current, person.id, null, { remove: true }))
    pushToast(takeOffWords(person, taken), 'info', {
      duration: UNDO_MS,
      action: { label: 'Undo', icon: Undo2, onClick: () => run('Adding', person, async () => {
        onSaveEntry(await undoTakeOff({ ownerEntry: latest.current, person, taken, api: peopleApi }))
      }) },
    })
  })
  /* Sync lives on the owner's link; the server does the keeping-the-same (server/sharedsync.js). */
  const sync = (person, v) => onSaveEntry(withSync(latest.current, person.id, v))
  const copy = (person) => {
    touch()
    setState(s => ({ ...s, isOpen: false }))
    setCopyFor(person)
    if (side !== person.id) setSide(person.id)
  }
  // Their side is open and their copy is read: copy now, through its queue, once.
  useEffect(() => {
    // Only once the copy on screen IS theirs: right after a switch it is still the last side's.
    if (!copyReady(copyFor, side, theirs)) return
    const person = copyFor
    setCopyFor(null)
    if (copyExercises(theirs.entry, latest.current) === theirs.entry) { pushToast(`${person.name} has all your exercises`, 'info'); return }
    // Said once it landed: a write that did not is the copy's own Retry toast.
    theirs.update(cur => copyExercises(cur, latest.current)).then(landed => {
      if (landed) pushToast(`Copied your exercises to ${person.name}`, 'info')
    })
  }, [copyFor, side, theirs.entry, theirs.loading, theirs.of]) // eslint-disable-line react-hooks/exhaustive-deps -- copied once, when their copy on screen is read; `theirs` is a new object every render
  return {
    ...state,
    open: () => setState(s => ({ ...s, isOpen: true, error: null })),
    close: () => setState(s => ({ ...s, isOpen: false })),
    add, remove, sync, copy,
  }
}

/**
 * Each side's done state, for the person switch: the side on screen from what
 * its copy last read (`server`, never an edit still on its way), everyone
 * else's read once as the sheet opens and again on every switch, so a tick
 * given on one side shows when you come back. `{ [personId]: boolean }`.
 */
export function useSidesDone(on = [], sideId = null, sideServer = null) {
  const [read, setRead] = useState({})
  const key = on.map(p => `${p.id}:${p.entryId}`).join(',')
  useEffect(() => {
    let live = true
    for (const p of on) {
      if (p.id === sideId) continue
      getPersonEntry(p.id, p.entryId)
        .then(e => { if (live) setRead(r => ({ ...r, [p.id]: Boolean(e && !e.deleted && isDone(e)) })) })
        .catch(() => { /* offline: no tick, rather than a wrong one */ })
    }
    return () => { live = false }
  }, [key, sideId]) // eslint-disable-line react-hooks/exhaustive-deps -- read once per set of people (`key`) and side, not on every render of the list
  const out = { ...read }
  if (sideId && sideServer) out[sideId] = Boolean(!sideServer.deleted && isDone(sideServer))
  return out
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
export function PersonSwitch({ on = [], side = null, onSide, done = null }) {
  if (!on.length) return null
  const who = [{ id: null, name: 'You', tone: 0 }, ...on]
  const current = who.find(p => (p.id || null) === (side || null)) || who[0]
  return (
    <div className="personbar" data-tone={current.tone ?? 1}>
      <div className="seg whoseg" role="tablist" aria-label="Whose log this is">
        {who.map(p => {
          const sel = (p.id || null) === (side || null)
          // Each side's done state on its own tab (#80), a tick beside the name, so
          // switching is never the way to find out whether Sam's is logged.
          const d = done ? done[p.id || ''] : undefined
          return (
            <button key={p.id || 'you'} type="button" role="tab" aria-selected={sel} data-tone={p.tone ?? 1}
              className={sel ? 'personbar-btn on' : 'personbar-btn'} onClick={() => onSide(p.id || null)}
              aria-label={d === undefined ? undefined : `${p.name}: ${d ? 'done' : 'not done'}`}>
              <Avatar name={p.name} tone={p.tone ?? 1} />
              <span className="personbar-name">{p.name}</span>
              {d === true && <Icon name="CircleCheck" size={16} className="personbar-done" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** "Keep exercises in step": one switch per person, in the sharing panel. */
export function SyncToggle({ person, on, onChange }) {
  return (
    <label className="synctoggle">
      <span className="synctoggle-text">
        <span className="synctoggle-label">Keep exercises in step</span>
        <span className="synctoggle-sub">
          {on ? `Exercises and sets added or removed on your side or ${person.name}’s show on both. Numbers stay each person’s own.`
            : 'Off: changes stay on the side you make them.'}
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

/**
 * "with Alex": who a shared workout was done with, where nothing can be changed
 * about it. On a copy in step with the owner's (#80) a second line says so, so
 * the person filling it in knows that an exercise they add or take off changes
 * the owner's workout too (lib/shared.js `inStepLine`).
 */
export function SharedNote({ entry, people = [] }) {
  const line = withLine(entry, people)
  if (!line) return null
  const step = inStepLine(entry)
  return (
    <>
      <p className="sharednote"><Icon name="Users" size={12} /> {line}</p>
      {step && <p className="sharednote instep"><Icon name="Repeat" size={12} /> {step}</p>}
    </>
  )
}

/**
 * Someone's copy of a shared workout, read and written through
 * `/api/people/:id/entry`. `update(fn)` applies `fn` to the latest copy (never a
 * closure's) and shows it at once; the screen is the truth while you edit. Writes
 * go one at a time (lib/copyqueue.js). The server's merged answer replaces the
 * copy only if nothing was edited since it was sent; otherwise the copy keeps
 * your edits and takes the write's receipt as its base (lib/store.js `withAck`).
 */
export function usePersonCopy(personId, entryId, name = '') {
  // Loading from the first frame: a sheet that reopens on their side must not flash "not in their log".
  // `server` is what the server last said, apart from `entry`, which may hold a
  // write still on its way (or one that never landed): whatever must not be
  // fooled by that (a side's "done", a circuit done together) reads `server`.
  // `of` is whose copy `entry` is ("<person>\n<entry id>"): entry ids repeat across
  // people (`daily-<date>`), and for a render after a switch `entry` is still the last one's.
  const [state, setState] = useState(() => ({ entry: null, server: null, loading: Boolean(personId && entryId), error: null, of: null }))
  const latest = useRef(null)
  // Who the copy on screen belongs to, for answers that land after the sheet switched sides.
  const owner = useRef(null)
  owner.current = personId && entryId ? `${personId}\n${entryId}` : null
  const named = useRef(name)
  named.current = name
  const mine = (pid, e) => Boolean(e && owner.current === `${pid}\n${e.id}`)
  // An answer that landed while the copy was still being read (`openedCopy`).
  const early = useRef(null)
  const queue = useRef(null)
  if (!queue.current) {
    queue.current = createCopyQueue({
      send: (pid, e) => sendPersonEntry(pid, e),
      current: (pid, e) => (mine(pid, e) && latest.current?.id === e.id ? latest.current : e),
      landed: (pid, sent, reply) => {
        if (!mine(pid, sent)) return
        const merged = reply.entry
        if (!latest.current) { early.current = merged; return }
        if (latest.current === sent) { latest.current = merged; setState(s => ({ ...s, entry: merged, server: merged })) }
        else { latest.current = withAck(latest.current, sent, reply.ack); setState(s => ({ ...s, server: merged })) }
      },
      failed: (pid, sent, err) => {
        if (mine(pid, sent)) setState(s => ({ ...s, error: `Not saved to ${named.current || 'their'} log yet: ${err.message}` }))
      },
    })
  }

  useEffect(() => {
    latest.current = null
    early.current = null
    if (!personId || !entryId) { setState({ entry: null, server: null, loading: false, error: null, of: null }); return undefined }
    let live = true
    setState({ entry: null, server: null, loading: true, error: null, of: null })
    getPersonEntry(personId, entryId)
      .then(e => {
        if (!live) return
        // An edit of this copy still unanswered, or a save that landed meanwhile: not an older read.
        const mine = openedCopy(e, queue.current.newest(personId, entryId), early.current)
        early.current = null
        latest.current = mine
        setState({ entry: mine, server: e, loading: false, error: null, of: `${personId}\n${entryId}` })
      })
      .catch(err => { if (live) setState({ entry: null, server: null, loading: false, of: null, error: `Could not open ${name || 'their'} log: ${err.message}` }) })
    /*
     * Re-read while open, so an exercise they add on their own phone (or one
     * synced in from the owner's side) appears without closing the sheet. Never
     * over an edit still on its way: the server's answer to that replaces it.
     */
    const iv = setInterval(() => {
      if (queue.current.busy || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return
      const was = latest.current
      getPersonEntry(personId, entryId).then(e => {
        if (!live || !e) return
        setState(s => (s.server === e ? s : { ...s, server: e }))
        if (queue.current.busy || latest.current !== was) return
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
    setState(s => ({ ...s, entry: next, error: null }))
    return queue.current.push(personId, next)
  }, [personId])

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
 * THEIR log, so "last time" is theirs. "Copy my exercises" moved to the sharing
 * panel (#80). Pure render, so the smoke suite can draw it without a server.
 */
export function TheirSide({ session, copy, loading = false, error = null, person, ownerOut, entries = [], onSave, plan = null }) {
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
  useEffect(() => { if (left.length) retry() }, [entry?.id]) // eslint-disable-line react-hooks/exhaustive-deps -- tried once as the sheet opens; Try again is the button
  if (!left.length) return null
  return (
    <div className="sharednote together-pending" role="alert">
      <Icon name="TriangleAlert" size={12} />
      <span>The circuit is not on {andWords([...new Set(left.map(p => p.name))])}&rsquo;s log yet</span>
      <button type="button" className="btn quiet" disabled={busy} onClick={retry}>Try again</button>
    </div>
  )
}
