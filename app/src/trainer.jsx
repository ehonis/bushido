/*
 * THE OWNER AS TRAINER, on screen: "For: You / Sam" in the planners, the side
 * switcher inside a workout, the owner's read-only view of someone's day, and
 * About you for everyone. The rules are in lib/trainer.js; the server's half is
 * `peopleRoute` and `aiSpaceFor` in server.js.
 *
 * Owner-only, and only on the owner's own log: `planPeople(me)` is empty for
 * anyone else, while acting as someone and on a one-person install, and then
 * none of the owner's controls here render. Act-as stays the way to open
 * someone's whole log.
 *
 * Someone else's log is never held in the owner's store or cache. What is open
 * is WHICH person and WHICH entry id; the entry is whatever the server last
 * answered, re-read when it is opened (AGENTS.md §6.2).
 */

import { useCallback, useEffect, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import { FullScreen, Modal } from './modal.jsx'
import { WorkoutRunner } from './runner.jsx'
import { WorkoutMode } from './workout.jsx'
import { SessionLog } from './sessionlog.jsx'
import { usePersonCopy } from './sharedwith.jsx'
import * as peopleApi from './lib/peopleapi.js'
import { optFor } from './lib/menu.js'
import { applyRun, applyOut, applyDone, dayOf, dayRow, runKind, plannedLine, toneFor } from './lib/trainer.js'
import { prescriptionSteps, runProgress, restLeft, itemLine, prescriptionLine } from './lib/prescription.js'
import { mondayOf, weekDays, shiftWeek } from './lib/quota.js'
import { fromIso, localIso } from './lib/dates.js'
import { currentMe } from './lib/whoami.js'

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.abs(s) % 60).padStart(2, '0')}`
const isDoneEntry = (e) => Boolean(e && !e.deleted && e.data?.done !== false)

/* ------------------------------------------------------------ For: … */

/**
 * "For: You / Sam", at the top of the planners. `people` is `planPeople(me)`:
 * nothing renders for anyone but the owner, while acting, or with one person.
 */
export function ForChoice({ people = [], target = null, onTarget }) {
  if (!people.length) return null
  return (
    <div className="forchoice" role="group" aria-label="Who this is for">
      <span className="forchoice-lead">For</span>
      <div className="seg">
        <button type="button" className={!target ? 'on' : ''} aria-pressed={!target} data-tone={0}
          onClick={() => onTarget(null)}>You</button>
        {people.map(p => (
          <button key={p.id} type="button" className={target?.id === p.id ? 'on' : ''} aria-pressed={target?.id === p.id}
            data-tone={toneFor(people, p.id)} onClick={() => onTarget(p)}>{p.name}</button>
        ))}
      </div>
    </div>
  )
}

/** "Planning for Sam", on every screen after the choice, so it cannot be forgotten halfway. */
export function ForLine({ person, people = [] }) {
  if (!person) return null
  return (
    <p className="forline" data-tone={toneFor(people, person.id)}>
      <Icon name="Users" size={13} /> Planning for <strong>{person.name}</strong>, with {person.name}&rsquo;s log. It is written to {person.name}&rsquo;s, from you.
    </p>
  )
}

/**
 * Someone's whole log and the plan their app runs on, read through the people
 * endpoints. `ready` only once the answer for THIS person is in, so nothing
 * seeds itself from an empty list or from the previous person's log.
 */
export function usePersonLog(personId) {
  const [state, setState] = useState({ id: null, entries: [], plan: null, loading: false, error: null })
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    if (!personId) { setState({ id: null, entries: [], plan: null, loading: false, error: null }); return undefined }
    let live = true
    setState(s => ({ ...s, loading: true, error: null }))
    Promise.all([peopleApi.getPersonState(personId), peopleApi.getPersonContent(personId)])
      .then(([st, plan]) => {
        if (live) setState({ id: personId, entries: Object.values(st?.entries || {}), plan, loading: false, error: null })
      })
      .catch(err => { if (live) setState({ id: null, entries: [], plan: null, loading: false, error: err.message }) })
    return () => { live = false }
  }, [personId, nonce])
  const reload = useCallback(() => setNonce(n => n + 1), [])
  return { ...state, ready: Boolean(personId) && state.id === personId && !state.loading, reload }
}

/* -------------------------------------------------- sides of a workout */

/** What a side is up to, for the switcher: its rest clock, its sets, or done. */
export function sideStatus(kind, entry, now = Date.now()) {
  if (!entry || entry.deleted) return ''
  if (isDoneEntry(entry)) return 'done'
  if (kind !== 'runner') return ''
  const run = entry.data?.run || null
  const left = restLeft(run, now)
  if (left > 0) return `rest ${mmss(left)}`
  if (run?.restUntil && now - run.restUntil < 60000) return 'rest up'
  const p = runProgress(run, prescriptionSteps(entry.data?.plan))
  return p.total ? `${p.done}/${p.total}` : ''
}

/**
 * You / Sam inside a running workout. Each name carries its colour and what that
 * side is doing right now, so the side that is NOT on screen still says when its
 * rest is up.
 */
export function SideSwitch({ sides = [], side = null, onSide, status = {} }) {
  if (sides.length < 2) return null
  return (
    <div className="seg sideswitch" role="tablist" aria-label="Whose side of the workout is showing">
      {sides.map(s => {
        const on = (s.id || null) === (side || null)
        const st = status[s.id || '']
        return (
          <button key={s.id || 'you'} type="button" role="tab" aria-selected={on} className={on ? 'on' : ''}
            data-tone={s.tone} onClick={() => onSide(s.id || null)}>
            <span className="side-dot" data-tone={s.tone} />
            <span className="side-name">{s.name}</span>
            {st && <span className="side-status">{st}</span>}
          </button>
        )
      })}
    </div>
  )
}

/**
 * A workout run from more than one person's side: the owner's and everyone the
 * entry is shared with, or just someone else's when the owner runs a session they
 * planned for them.
 *
 * Every side stays mounted, so each keeps its own clock; only the side on screen
 * makes a sound. Each side is that person's own entry with its OWN writer: the
 * owner's through the owner's store (`onOwnerRun`/`onOwnerSave`/`onOwnerDone`), anyone
 * else's through the people endpoints (`usePersonCopy`). Two entries, two
 * writers, never one writer touching both (AGENTS.md §6.2). Finishing a side
 * hands over to the next one not done yet, and the last one closes the screen.
 */
export function SidesWorkout({
  kind, session, sides = [], ownerEntry = null, entries = [],
  onOwnerRun = null, onOwnerSave = null, onOwnerDone = null, onExit, onSwitch = null,
}) {
  const [side, setSide] = useState(() => sides[0]?.id ?? null)
  const [copies, setCopies] = useState({})
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (sides.length < 2) return undefined
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [sides.length])

  const report = useCallback((id, e) => setCopies(c => (c[id] === e ? c : { ...c, [id]: e })), [])
  const entryOf = (s) => (s.id ? copies[s.id] : ownerEntry)
  const status = {}
  for (const s of sides) status[s.id || ''] = sideStatus(kind, entryOf(s), now)

  const pick = (id) => {
    if ((id || null) === (side || null)) return
    setSide(id)
    onSwitch?.(id)
  }
  const finishSide = (id) => () => {
    const next = sides.find(s => (s.id || null) !== (id || null) && !isDoneEntry(entryOf(s)))
    if (next) pick(next.id || null)
    else onExit()
  }
  const switcher = <SideSwitch sides={sides} side={side} onSide={pick} status={status} />

  return (
    <>
      {sides.map(s => {
        const shown = (s.id || null) === (side || null)
        // Whose side this is, in their colour, whenever it could be anyone but you.
        const who = sides.length > 1 || s.id ? { name: s.id ? s.name : 'You', tone: s.tone } : null
        return (
          <div key={s.id || 'you'} className="side-slot" style={shown ? undefined : { display: 'none' }} aria-hidden={!shown}>
            {s.id ? (
              <TheirSlot kind={kind} person={s} session={session} shown={shown} who={who} switcher={switcher}
                onExit={onExit} onFinish={finishSide(s.id)} report={report} />
            ) : kind === 'runner' ? (
              <WorkoutRunner session={session} entry={ownerEntry} entries={entries} onRun={onOwnerRun}
                onExit={onExit} onFinish={finishSide(null)} who={who} switcher={switcher} shown={shown} />
            ) : (
              <WorkoutMode session={session} entry={ownerEntry} onSave={onOwnerSave} onSetDone={onOwnerDone}
                onExit={onExit} onFinish={finishSide(null)} who={who} switcher={switcher} shown={shown} />
            )}
          </div>
        )
      })}
    </>
  )
}

/** Someone else's side: their own entry, read and written through /api/people/:id/entry. */
function TheirSlot({ kind, person, session, shown, who, switcher, onExit, onFinish, report }) {
  const copy = usePersonCopy(person.id, person.entryId, person.name)
  // Their own history, for "last time" in the runner: they lift different weights.
  const log = usePersonLog(kind === 'runner' ? person.id : null)
  useEffect(() => { report(person.id, copy.entry) }, [person.id, copy.entry, report])

  if (!copy.entry || copy.entry.deleted) {
    return (
      <div className="run" data-tone={who?.tone}>
        {switcher}
        <div className="run-empty">
          <p>{copy.loading ? `Opening ${person.name}’s log…` : copy.error || `This workout is not in ${person.name}’s log any more.`}</p>
          <button className="btn" onClick={onExit}>Back</button>
        </div>
      </div>
    )
  }
  return (
    <>
      {kind === 'runner' ? (
        <WorkoutRunner session={session} entry={copy.entry} entries={log.entries}
          onRun={(run, opts) => copy.update(cur => applyRun(cur, session, run, opts))}
          onExit={onExit} onFinish={onFinish} who={who} switcher={switcher} shown={shown} />
      ) : (
        <WorkoutMode session={session} entry={copy.entry}
          onSave={(out) => copy.update(cur => applyOut(cur, session, out))}
          onSetDone={(v) => copy.update(cur => applyDone(cur, v))}
          onExit={onExit} onFinish={onFinish} who={who} switcher={switcher} shown={shown} />
      )}
      {copy.error && shown && <p className="side-err" role="alert">{copy.error}</p>}
    </>
  )
}

/* ------------------------------------------------------ someone's day */

/**
 * "Sam's day", on Today: the owner's way to see what is on someone's days and
 * open one, without acting as them. Nothing for anyone else.
 */
export function PeopleDays({ people = [], date, plan }) {
  const [open, setOpen] = useState(null)
  if (!people.length) return null
  return (
    <>
      <div className="peopledays" role="group" aria-label="Other people's days">
        {people.map(p => (
          <button key={p.id} type="button" className="chip peopleday" data-tone={toneFor(people, p.id)}
            onClick={() => setOpen(p)}>
            <span className="side-dot" data-tone={toneFor(people, p.id)} /> {p.name}&rsquo;s day
          </button>
        ))}
      </div>
      {open && (
        <PersonDay person={{ ...open, tone: toneFor(people, open.id) }} date={date} plan={plan}
          onClose={() => setOpen(null)} />
      )}
    </>
  )
}

/**
 * Someone's week, read-only: each day's sessions, done or not and who planned
 * them, and a tap opens one. Read from their log on the server every time it
 * opens; edits go through that one entry.
 */
export function PersonDay({ person, date = localIso(), plan, openId: initialOpen = null, onClose }) {
  const log = usePersonLog(person.id)
  const [monday, setMonday] = useState(() => mondayOf(date))
  const [openId, setOpenId] = useState(initialOpen)
  const me = currentMe()
  const menu = (log.plan || plan)?.dailyMenu || []
  const today = localIso()
  const label = `${fromIso(monday).toLocaleDateString([], { month: 'short', day: 'numeric' })} – ` +
    `${fromIso(weekDays(monday)[6]).toLocaleDateString([], { month: 'short', day: 'numeric' })}`

  return (
    <FullScreen title={`${person.name}’s week`} sub={label} icon="Users" onBack={onClose}>
      <div className="pday-wrap" data-tone={person.tone ?? 1}>
        <div className="daynav">
          <button onClick={() => setMonday(m => shiftWeek(m, -1))} aria-label="previous week">‹</button>
          <span className="daynav-label">{label}{monday === mondayOf(today) && <em> · this week</em>}</span>
          <button onClick={() => setMonday(m => shiftWeek(m, 1))} aria-label="next week">›</button>
        </div>
        <p className="sub pday-lead">
          What is on {person.name}&rsquo;s days. Open one to log it or run it from {person.name}&rsquo;s side;
          everything you change is written to {person.name}&rsquo;s log.
        </p>
        {log.loading && <p className="sub">Opening {person.name}&rsquo;s log…</p>}
        {log.error && <p className="withrow-err">Could not open {person.name}&rsquo;s log: {log.error}</p>}
        {log.ready && weekDays(monday).map(d => {
          const rows = dayOf(log.entries, d).map(e => dayRow(e, menu, me))
          return (
            <section key={d} className={`pday ${d === today ? 'today' : ''}`}>
              <h3 className="pday-date">{fromIso(d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</h3>
              {rows.length ? rows.map(r => (
                <button key={r.id} type="button" className="pday-row" onClick={() => setOpenId(r.id)}>
                  <span className={`dl-check ${r.done ? 'on' : ''}`}>
                    <Icon name={r.done ? 'CircleCheck' : 'Circle'} size={16} />
                  </span>
                  <span className="pday-name">
                    <strong>{r.name}</strong>
                    <span className="sub">
                      {[r.running ? 'in progress' : r.done ? 'done' : 'not done yet', r.plannedBy, r.sharedFrom ? 'shared' : null]
                        .filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <Icon name="ChevronRight" size={16} />
                </button>
              )) : <p className="sub pday-none">Nothing on this day.</p>}
            </section>
          )
        })}
        <details className="fold pday-about">
          <summary>About {person.name}</summary>
          <AboutForm load={() => peopleApi.getPersonAbout(person.id)} save={(doc) => peopleApi.putPersonAbout(person.id, doc)}
            lead={`What ${person.name}'s coach and planners are told, and what yours are told when you plan for ${person.name}.`} />
        </details>
      </div>

      {openId && (
        <PersonEntrySheet person={person} entryId={openId} menu={menu} entries={log.entries}
          onClose={() => { setOpenId(null); log.reload() }} />
      )}
    </FullScreen>
  )
}

/**
 * One of someone's sessions, opened by the owner: the plan, their form (no WHOOP
 * or Strava; those are the owner's accounts), done, and Start, which runs it from
 * their side. Every write goes to that one entry in their log.
 */
export function PersonEntrySheet({ person, entryId, menu = [], entries = [], onClose }) {
  const copy = usePersonCopy(person.id, entryId, person.name)
  const [running, setRunning] = useState(false)
  const me = currentMe()
  const e = copy.entry
  const opt = e ? optFor(menu, e.data?.optId) : null
  const kind = e && opt ? runKind(e, opt) : null
  const tone = person.tone ?? 1

  if (running && e && opt && kind) {
    return (
      <SidesWorkout kind={kind} session={opt} sides={[{ id: person.id, name: person.name, entryId, tone }]}
        onExit={() => setRunning(false)} />
    )
  }

  const done = isDoneEntry(e)
  const pres = e?.data?.plan || null
  return (
    <Modal title={e?.data?.name || opt?.name || 'Session'} sub={`${person.name}’s log`} icon="Users" onClose={onClose}
      footer={e && !e.deleted ? (
        <div className="sheet-actions">
          {kind && !done && (
            <button className="btn" onClick={() => setRunning(true)}>
              <Icon name="Play" size={16} /> Start for {person.name}
            </button>
          )}
          <button className={`btn done-btn ${done ? 'ghost on' : ''}`}
            onClick={() => copy.update(cur => applyDone(cur, !done))}>
            <Icon name={done ? 'CircleCheck' : 'Circle'} size={16} />
            {done ? `Done for ${person.name} — tap to undo` : `Mark done for ${person.name}`}
          </button>
        </div>
      ) : null}>
      <p className="forline" data-tone={tone}><Icon name="Users" size={13} /> {person.name}&rsquo;s side</p>
      {copy.loading && <p className="sub">Opening {person.name}&rsquo;s log…</p>}
      {copy.error && <p className="withrow-err">{copy.error}</p>}
      {e && !e.deleted && (
        <>
          {plannedLine(e, me) && <p className="sharednote"><Icon name="ClipboardCheck" size={12} /> {plannedLine(e, me)}</p>}
          {pres && (
            <div className="pday-plan">
              <p className="sub">{prescriptionLine(pres)}</p>
              {(pres.blocks || []).map(b => (
                <div key={b.id} className="pday-block">
                  <strong>{b.name}</strong>
                  {(b.items || []).map(it => <span key={it.id} className="sub">{it.name} · {itemLine(it)}</span>)}
                  {!b.items?.length && b.note && <span className="sub">{b.note}</span>}
                </div>
              ))}
            </div>
          )}
          {opt && (
            <SessionLog session={opt} entry={e} entries={entries} measured={false} defaultOpen
              onSave={(out) => copy.update(cur => applyOut(cur, opt, out))} />
          )}
        </>
      )}
      {e?.deleted && <p className="sub">This session is not in {person.name}&rsquo;s log any more.</p>}
    </Modal>
  )
}

/* ------------------------------------------------------------ About you */

/**
 * A person's name and notes for their own coach and planners. `load` and `save`
 * are the endpoint pair: /api/about for the person themselves, or
 * /api/people/:id/about for the owner editing someone's.
 */
export function AboutForm({ load, save, lead = null }) {
  const [doc, setDoc] = useState(null)
  const [status, setStatus] = useState(null)
  useEffect(() => {
    let live = true
    load().then(d => { if (live) setDoc({ name: d?.name || '', notes: d?.notes || '' }) })
      .catch(err => { if (live) setStatus(err.message) })
    return () => { live = false }
    // Loaded once per mount: the form owns its text after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (!doc) return <p className="sub">{status || 'Loading…'}</p>
  const submit = async () => {
    setStatus('Saving…')
    try {
      const d = await save(doc)
      setDoc({ name: d?.name || '', notes: d?.notes || '' })
      setStatus('Saved')
    } catch (err) { setStatus(err.message) }
  }
  return (
    <div className="aboutform">
      {lead && <p className="sub">{lead}</p>}
      <label className="field">
        <span>Name</span>
        <input type="text" value={doc.name} maxLength={80} autoComplete="off"
          onChange={ev => { setDoc({ ...doc, name: ev.target.value }); setStatus(null) }} />
      </label>
      <label className="field">
        <span>Notes for the coach and planners</span>
        <textarea rows={5} value={doc.notes} maxLength={4000}
          placeholder="Goals, injuries, the equipment you have, anything a coach should know."
          onChange={ev => { setDoc({ ...doc, notes: ev.target.value }); setStatus(null) }} />
      </label>
      <div className="aboutform-acts">
        <button className="btn" onClick={submit}>Save</button>
        {status && <span className="sub">{status}</span>}
      </div>
    </div>
  )
}

/**
 * About you, in the profile, for anyone but the owner (whose is on the Settings
 * page). Acting as someone, it is theirs, written to their space.
 */
export function MyAbout({ me = currentMe() }) {
  if (me.owner) return null
  return (
    <div className="card">
      <h2>About you</h2>
      <AboutForm load={peopleApi.getMyAbout} save={peopleApi.putMyAbout}
        lead={me.acting ? `What ${me.name}'s coach and planners are told about ${me.name}.`
          : 'What your coach and planners are told about you. Only you and the owner of this install can see it.'} />
    </div>
  )
}
