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
import { usePersonCopy, Avatar, PersonChip } from './sharedwith.jsx'
import * as peopleApi from './lib/peopleapi.js'
import { optFor } from './lib/menu.js'
import { applyRun, applyOut, applyDone, canStart, dayOf, dayRow, runKind, plannedLine, toneFor } from './lib/trainer.js'
import { isDone } from './lib/store.js'
import { prescriptionSteps, runProgress, restLeft, itemLine, prescriptionLine } from './lib/prescription.js'
import { fromIso, localIso, mondayOf, weekDays, shiftWeek } from './lib/dates.js'
import { currentMe } from './lib/whoami.js'

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.abs(s) % 60).padStart(2, '0')}`

/* ------------------------------------------------------------ For: … */

/**
 * "For: You / Sam", at the top of the planners: one person chip each, the same
 * chip as "With …". `people` is `planPeople(me)`: nothing renders for anyone but
 * the owner, while acting, or with one person.
 */
export function ForChoice({ people = [], target = null, onTarget }) {
  if (!people.length) return null
  return (
    <div className="forchoice" role="group" aria-label="Who this is for">
      <span className="forchoice-lead">For</span>
      <PersonChip person={{ name: 'You' }} tone={0} on={!target} onClick={() => onTarget(null)} />
      {people.map(p => (
        <PersonChip key={p.id} person={p} tone={toneFor(people, p.id)} on={target?.id === p.id} onClick={() => onTarget(p)} />
      ))}
    </div>
  )
}

/** "Planning for Sam", on every screen after the choice, so it cannot be forgotten halfway. */
export function ForLine({ person, people = [] }) {
  if (!person) return null
  const tone = toneFor(people, person.id)
  return (
    <p className="forline" data-tone={tone}>
      <Avatar name={person.name} tone={tone} small />
      <span>Planning for <strong>{person.name}</strong> · it goes in {person.name}&rsquo;s log</span>
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

/**
 * What a side is up to, for the switcher: its rest clock, its sets, or done.
 * "Done" is finished on this screen or a run that has ended, not `isDone`: every
 * side of today's workout is done by default (§4) before anyone has lifted.
 */
export function sideStatus(kind, entry, now = Date.now(), finished = false) {
  if (!entry || entry.deleted) return ''
  if (finished || entry.data?.run?.endedAt) return 'done'
  if (kind !== 'runner') return ''
  const run = entry.data?.run || null
  const left = restLeft(run, now)
  if (left > 0) return `rest ${mmss(left)}`
  if (run?.restUntil && now - run.restUntil < 60000) return 'rest up'
  const p = runProgress(run, prescriptionSteps(entry.data?.plan))
  return p.total ? `${p.done}/${p.total}` : ''
}

/**
 * You / Sam inside a running workout: the same segmented control as the sheet's
 * person bar, the side on screen raised in that person's colour. Each name also
 * says what that side is doing right now, so the side that is NOT on screen still
 * says when its rest is up.
 */
export function SideSwitch({ sides = [], side = null, onSide, status = {} }) {
  if (sides.length < 2) return null
  return (
    <div className="seg whoseg sideswitch" role="tablist" aria-label="Whose side of the workout is showing">
      {sides.map(s => {
        const on = (s.id || null) === (side || null)
        const st = status[s.id || '']
        return (
          <button key={s.id || 'you'} type="button" role="tab" aria-selected={on} className={on ? 'on' : ''}
            data-tone={s.tone} onClick={() => onSide(s.id || null)}>
            <Avatar name={s.name} tone={s.tone} />
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
 * hands over to the next one not yet finished, and the last one closes the screen.
 */
export function SidesWorkout({
  kind, session, sides = [], ownerEntry = null, entries = [],
  onOwnerRun = null, onOwnerSave = null, onOwnerDone = null, onExit, onSwitch = null, initialSide = null,
}) {
  const [side, setSide] = useState(() => (sides.some(s => s.id && s.id === initialSide) ? initialSide : sides[0]?.id ?? null))
  const [copies, setCopies] = useState({})
  // The sides finished on this screen, by id ('' for the owner).
  const [finished, setFinished] = useState([])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (sides.length < 2) return undefined
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [sides.length])

  const report = useCallback((id, e) => setCopies(c => (c[id] === e ? c : { ...c, [id]: e })), [])
  const entryOf = (s) => (s.id ? copies[s.id] : ownerEntry)
  const status = {}
  for (const s of sides) status[s.id || ''] = sideStatus(kind, entryOf(s), now, finished.includes(s.id || ''))

  const pick = (id) => {
    if ((id || null) === (side || null)) return
    setSide(id)
    onSwitch?.(id)
  }
  const finishSide = (id) => () => {
    const over = [...finished, id || '']
    setFinished(over)
    const next = sides.find(s => !over.includes(s.id || '') && !entryOf(s)?.data?.run?.endedAt)
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

const dayWords = (iso) => fromIso(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })

/** What a row says about one of someone's sessions: where it stands, who planned it. */
const rowMeta = (r) => [r.running ? 'In progress' : r.done ? 'Done' : 'Not done yet', r.plannedBy, r.sharedFrom ? 'shared' : null]
  .filter(Boolean).join(' · ')

/**
 * "Sam's day", on Today: one row per person, the owner's way to see and open
 * someone's days without acting as them. Nothing for anyone else.
 */
export function PeopleDays({ people = [], date, plan }) {
  const [open, setOpen] = useState(null)
  const [seen, setSeen] = useState(0)
  if (!people.length) return null
  return (
    <>
      <section className="card peopledays" aria-label="Other people's days">
        <div className="list">
          {people.map(p => (
            <PersonDayRow key={p.id} person={p} tone={toneFor(people, p.id)} date={date} plan={plan} seen={seen}
              onOpen={() => setOpen(p)} />
          ))}
        </div>
      </section>
      {open && (
        <PersonDay person={{ ...open, tone: toneFor(people, open.id) }} date={date} plan={plan}
          onClose={() => { setOpen(null); setSeen(n => n + 1) }} />
      )}
    </>
  )
}

/**
 * One person's row: their initial, "Sam's day", and what is on it, read from
 * their log on the server. Until that answers (and during SSR) the row is just
 * the door; a failed read leaves it that way.
 */
function PersonDayRow({ person, tone, date, plan, seen, onOpen }) {
  const [names, setNames] = useState(null)
  useEffect(() => {
    let live = true
    setNames(null)
    peopleApi.getPersonDay(person.id, date)
      .then(entries => { if (live) setNames(dayOf(entries, date).map(e => dayRow(e, plan?.dailyMenu || []).name)) })
      .catch(() => { /* offline or refused: the row is still the way in */ })
    return () => { live = false }
  }, [person.id, date, plan, seen])
  return (
    <button type="button" className="list-row peopleday" data-tone={tone} onClick={onOpen}>
      <Avatar name={person.name} tone={tone} />
      <span className="list-row-main">
        <span className="list-row-title">{person.name}&rsquo;s day</span>
        {names && <span className="list-row-meta">{names.length ? names.join(' · ') : 'Nothing on it yet'}</span>}
      </span>
      <Icon name="ChevronRight" size={16} className="list-row-chev" />
    </button>
  )
}

/**
 * One day's heading in someone's week. An empty day says "Nothing" on the right,
 * today included ("Today · Nothing"), so no day reads differently for being empty.
 */
export function DayHead({ date, today = false, empty = false }) {
  return (
    <div className="section-head">
      <h3>{dayWords(date)}</h3>
      {(today || empty) && (
        <span className="sub">
          {today && <span className="pday-today">Today</span>}
          {today && empty && ' · '}
          {empty && 'Nothing'}
        </span>
      )}
    </div>
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
  const thisWeek = monday === mondayOf(today)
  const label = `${fromIso(monday).toLocaleDateString([], { month: 'short', day: 'numeric' })} – ` +
    `${fromIso(weekDays(monday)[6]).toLocaleDateString([], { month: 'short', day: 'numeric' })}`

  return (
    <FullScreen title={`${person.name}’s week`} sub={label} icon="Users" onBack={onClose}>
      <div className="pday-wrap" data-tone={person.tone ?? 1}>
        <div className="pday-nav">
          <button type="button" className="iconbtn" onClick={() => setMonday(m => shiftWeek(m, -1))} aria-label="Previous week">
            {/* lib/icons.jsx (the shell's) has no ChevronLeft; the right one, mirrored. */}
            <Icon name="ChevronRight" size={20} style={{ transform: 'scaleX(-1)' }} />
          </button>
          <span className="pday-nav-label">{thisWeek ? 'This week' : label}</span>
          <button type="button" className="iconbtn" onClick={() => setMonday(m => shiftWeek(m, 1))} aria-label="Next week">
            <Icon name="ChevronRight" size={20} />
          </button>
        </div>
        <p className="sub pday-lead">
          <Avatar name={person.name} tone={person.tone ?? 1} small /> Everything you change here goes in {person.name}&rsquo;s log.
        </p>
        {log.loading && <p className="sub">Opening {person.name}&rsquo;s log…</p>}
        {log.error && <p className="withrow-err">Could not open {person.name}&rsquo;s log: {log.error}</p>}
        {log.ready && weekDays(monday).map(d => {
          const rows = dayOf(log.entries, d).map(e => dayRow(e, menu, me))
          return (
            <section key={d} className={d === today ? 'pday today' : 'pday'}>
              <DayHead date={d} today={d === today} empty={!rows.length} />
              {rows.length > 0 && (
                <div className="card pday-list">
                  <div className="list">
                    {rows.map(r => (
                      <button key={r.id} type="button" className="list-row" onClick={() => setOpenId(r.id)}>
                        <span className={r.done ? 'pday-check on' : 'pday-check'}>
                          <Icon name={r.done ? 'CircleCheck' : 'Circle'} size={20} />
                        </span>
                        <span className="list-row-main">
                          <span className="list-row-title">{r.name}</span>
                          <span className="list-row-meta">{rowMeta(r)}</span>
                        </span>
                        <Icon name="ChevronRight" size={16} className="list-row-chev" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )
        })}
        <details className="fold pday-about">
          <summary>About {person.name}</summary>
          <AboutForm load={() => peopleApi.getPersonAbout(person.id)} save={(doc) => peopleApi.putPersonAbout(person.id, doc)}
            lead={`What ${person.name}'s workout planner is told, and what yours is told when you plan for ${person.name}.`} />
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
 * One of someone's sessions, opened by the owner: whose log it is (their
 * initial, in their colour), the plan, their form (no WHOOP or Strava; those are
 * the owner's accounts), and Start, which runs it from their side. Every write
 * goes to that one entry in their log. Done is the default once its day arrives
 * (AGENTS.md §4), so the footer offers the exception: Mark undone, or Mark done
 * on one that was undone.
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

  const done = isDone(e)
  const pres = e?.data?.plan || null
  const start = Boolean(kind && e && canStart(e))
  const by = e ? plannedLine(e, me) : null
  return (
    <Modal title={e?.data?.name || opt?.name || 'Session'} sub={e?.date ? dayWords(e.date) : `${person.name}’s log`} icon="Users" onClose={onClose}
      footer={e && !e.deleted ? (
        <div className="sheet-actions">
          {start && (
            <button className="btn" onClick={() => setRunning(true)}>
              <Icon name="Play" size={16} /> Start for {person.name}
            </button>
          )}
          <button className={done ? 'btn quiet' : start ? 'btn secondary' : 'btn'} aria-pressed={done}
            onClick={() => copy.update(cur => applyDone(cur, !done))}>
            <Icon name={done ? 'CircleCheck' : 'Circle'} size={16} />
            {done ? 'Mark undone' : `Mark done for ${person.name}`}
          </button>
        </div>
      ) : null}>
      <p className="forline" data-tone={tone}>
        <Avatar name={person.name} tone={tone} small />
        <span><strong>{person.name}&rsquo;s log</strong>{by ? ` · ${by}` : ''}</span>
      </p>
      {copy.loading && <p className="sub">Opening {person.name}&rsquo;s log…</p>}
      {copy.error && <p className="withrow-err">{copy.error}</p>}
      {e && !e.deleted && (
        <>
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
        <span>Notes for the workout planner</span>
        <textarea rows={5} value={doc.notes} maxLength={4000}
          placeholder="Goals, injuries, the equipment you have, anything a planner should know."
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
        lead={me.acting ? `What ${me.name}'s workout planner is told about ${me.name}.`
          : 'What your workout planner is told about you. Only you and the owner of this install can see it.'} />
    </div>
  )
}
