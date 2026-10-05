/*
 * Plan the week — the conversation between "+" and a set of quotas.
 *
 * A mode on the "+" screen for planning the week's quotas in a back-and-forth
 * with the model.
 *
 * The Week tab already has the steppers; this is the same numbers with an agent
 * beside them. Three things about the shape are load-bearing, and all three are
 * the workout planner's rules applied to a week.
 *
 * **Nothing is written until the user taps "Set the week".** A turn proposes counts and
 * puts them in the steppers; the steppers are their to move; the quota entry is
 * written once, by their tap, through the same `upsertEntry` the Week tab uses.
 * Closing the screen after three turns costs three model calls and nothing else.
 *
 * **The conversation lands on the quota entry** (`data.thread`, `data.why`,
 * `data.title`), the way a prescription keeps its thread. The Week tab shows the
 * reasoning under the week it explains, and a week the user set by hand simply has none.
 *
 * **It does not run on open.** A model call the user did not ask for is forty seconds
 * and a dollar spent on a question the user may not have had; the screen opens on the
 * numbers as they stand and the prompts, and the first turn is their.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import { FullScreen } from './modal.jsx'
import { Markdown } from './lib/markdown.jsx'
import { requestWeek, weekContext } from './lib/plannerapi.js'
import {
  progress as quotaProgress, mondayOf, weekDays, shiftWeek, quotaCounts, quotaEntry, suggest,
  buildQuotaEntry,
} from './lib/quota.js'
import { fromIso } from './lib/dates.js'
import { achievements, unclaimed } from './lib/achievements.js'
import { profileFacts } from './lib/profile.js'

/** The quick asks. Content would be better; five is not yet enough to earn it. */
const WEEK_PROMPTS = [
  'Draft the week for me',
  'Like last week, but more zone 2',
  'I am short on time this week',
  'Lean toward the half iron',
  'Lean toward the 12a',
]

/**
 * Which Monday to open on.
 *
 * Saturday and Sunday are when a week gets planned, and the week being planned
 * then is the next one — opening on a week with one day left in it would be
 * asking them to set quotas the user cannot fill. Any other day it is this week.
 */
export function defaultMonday(iso) {
  const dow = fromIso(iso).getDay()  // 0 Sunday … 6 Saturday
  const thisMonday = mondayOf(iso)
  // `shiftWeek(m, n)` moves n weeks FORWARD (its own tests: -1 is last week).
  return dow === 0 || dow === 6 ? shiftWeek(thisMonday, 1) : thisMonday
}

const weekLabel = (monday) =>
  `${fromIso(monday).toLocaleDateString([], { month: 'short', day: 'numeric' })} – ` +
  `${fromIso(weekDays(monday)[6]).toLocaleDateString([], { month: 'short', day: 'numeric' })}`

export function WeekPlanFlow({ plan, entries = [], iso, upsertEntry, onClose, onPlan = null }) {
  const [monday, setMonday] = useState(() => defaultMonday(iso))
  const thisMonday = mondayOf(iso)
  const isCurrent = monday === thisMonday

  const stored = useMemo(() => quotaCounts(entries, monday), [entries, monday])
  const existing = useMemo(() => quotaEntry(entries, monday), [entries, monday])
  const offer = useMemo(() => suggest({ plan, entries, iso: monday }), [plan, entries, monday])
  const week = useMemo(() => quotaProgress({ plan, entries, iso: monday }), [plan, entries, monday])

  // The boxes. Seeded from what the user SET for that week (or its thread, if it was
  // planned here before), never from the suggestion — see WeekTab for why.
  const [draft, setDraft] = useState(() => stored)
  const [thread, setThread] = useState(() => existing?.data?.thread || [])
  const [why, setWhy] = useState(() => existing?.data?.why || null)
  const [title, setTitle] = useState(() => existing?.data?.title || null)
  const [model, setModel] = useState(() => existing?.data?.model || null)
  // What the last turn moved, so the rows can say "was 2".
  const [before, setBefore] = useState(null)
  const [text, setText] = useState('')
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState(null)
  const [step, setStep] = useState('plan')  // plan | set
  const abort = useRef(null)
  useEffect(() => () => abort.current?.abort(), [])

  const changeWeek = (m) => {
    abort.current?.abort()
    setMonday(m)
    const e = quotaEntry(entries, m)
    setDraft(quotaCounts(entries, m))
    setThread(e?.data?.thread || [])
    setWhy(e?.data?.why || null)
    setTitle(e?.data?.title || null)
    setModel(e?.data?.model || null)
    setBefore(null)
    setError(null)
  }

  const set = (key, n) => {
    const next = { ...draft }
    if (n > 0) next[key] = n
    else delete next[key]
    setDraft(next)
  }

  const total = Object.values(draft).reduce((a, b) => a + b, 0)
  const dirty = JSON.stringify(draft) !== JSON.stringify(stored) || (thread.length > 0 && !existing?.data?.thread)

  const ask = async (message) => {
    const said = String(message || '').trim()
    if (!said || asking) return
    setText('')
    setError(null)
    setAsking(true)
    // Their message goes on immediately. A turn is tens of seconds of an agent
    // reading three weeks of their log, and a box that swallows what you typed for
    // the whole of it feels broken.
    const pending = [...thread, { role: 'you', text: said, at: new Date().toISOString() }]
    setThread(pending)
    const ctrl = new AbortController()
    abort.current = ctrl
    try {
      const res = await requestWeek({
        monday, counts: draft, message: said, thread,
        context: weekContext({ week, monday, iso, plan, entries }),
        signal: ctrl.signal,
      })
      setBefore(draft)
      setDraft(res.counts || {})
      setWhy(res.reply || null)
      if (res.title) setTitle(res.title)
      if (res.model) setModel(res.model)
      setThread([...pending, {
        role: 'coach',
        text: res.changed || 'Left as you had it.',
        at: new Date().toISOString(),
      }])
    } catch (e) {
      if (ctrl.signal.aborted) return
      setError(e.message)
      // Put their message back in the box rather than losing it to a failed turn.
      setThread(thread)
      setText(said)
    } finally {
      if (!ctrl.signal.aborted) setAsking(false)
    }
  }

  /** The one write. Same builder, same entry id, as the Week tab's steppers. */
  const keep = () => {
    upsertEntry(buildQuotaEntry(monday, draft, {
      ...(thread.length ? { thread } : {}),
      ...(why ? { why } : {}),
      ...(title ? { title } : {}),
      ...(model ? { model } : {}),
    }))
    setStep('set')
  }

  const achs = useMemo(() => achievements(plan, entries, profileFacts(entries)), [plan, entries])
  const cats = plan?.quotaCategories || []
  const catsOf = (a) => cats.filter(c => a.categories.includes(c.key))
  const loose = useMemo(() => unclaimed(plan, achs), [plan, achs])

  const Row = (c) => {
    const n = draft[c.key] || 0
    const was = before ? (before[c.key] || 0) : null
    const moved = was !== null && was !== n
    const state = isCurrent ? (week.byKey[c.key] || { done: 0 }) : { done: 0 }
    return (
      <div key={c.key} className={`quotarow wk-row ${moved ? 'moved' : ''}`}>
        <span className="quotarow-ico"><Icon name={c.icon} size={16} /></span>
        <span className="quotarow-name">
          <strong>{c.name}</strong>
          {moved && <span className="wk-was">was {was}</span>}
        </span>
        <span className="quotarow-did">{state.done > 0 ? `${state.done} done` : ''}</span>
        <span className="quotarow-set">
          <button className="qbtn" onClick={() => set(c.key, Math.max(0, n - 1))}
            aria-label={`one fewer ${c.name}`} disabled={!n}><Icon name="Minus" size={14} /></button>
          <span className="qbtn-n">{n || '–'}</span>
          <button className="qbtn" onClick={() => set(c.key, n + 1)}
            aria-label={`one more ${c.name}`}><Icon name="Plus" size={14} /></button>
        </span>
      </div>
    )
  }

  if (step === 'set') {
    return (
      <FullScreen title="Week is set" sub={weekLabel(monday)} icon="CalendarRange" onBack={onClose}>
        <div className="kept">
          <span className="kept-ico"><Icon name="CircleCheck" size={44} /></span>
          <h2>{title || 'The week is set'}</h2>
          <p className="sub">
            {total} workout{total === 1 ? '' : 's'} asked for, {weekLabel(monday)}. Nothing is on a day
            yet — the bars on Today fill as you log, and the Week tab is where these live now.
          </p>
          <div className="kept-acts">
            {onPlan && (
              <button className="btn big" onClick={onPlan}>
                <Icon name="Sparkles" size={18} /> Plan the first workout
              </button>
            )}
            <button className="btn ghost" onClick={onClose}>
              <Icon name="House" size={16} /> Back to today
            </button>
          </div>
        </div>
      </FullScreen>
    )
  }

  return (
    <FullScreen title="Plan the week" sub={weekLabel(monday)} icon="CalendarRange" onBack={onClose}>
      <div className="wk-weeks" role="tablist">
        <button role="tab" className={`wk-week ${isCurrent ? 'on' : ''}`} aria-selected={isCurrent}
          onClick={() => changeWeek(thisMonday)}>
          This week
        </button>
        <button role="tab" className={`wk-week ${!isCurrent ? 'on' : ''}`} aria-selected={!isCurrent}
          onClick={() => changeWeek(shiftWeek(thisMonday, 1))}>
          Next week
        </button>
        <span className="sub wk-weekmeta">
          {isCurrent
            ? `${week.doneTotal} of ${week.plannedTotal || '–'} filled · ${week.days.filter(d => d > iso).length} days left`
            : 'nothing has happened yet'}
        </span>
      </div>

      <div className="plantalk wk-talk">
        <div className="plantalk-head static">
          <span className="plantalk-ico"><Icon name="MessagesSquare" size={15} /></span>
          <span className="plantalk-title">
            {why ? 'What it proposes — and what to change' : 'Talk the week through'}
          </span>
          {thread.length > 0 && <span className="plantalk-n">{Math.ceil(thread.length / 2)}</span>}
        </div>
        <div className="plantalk-body">
          {!why && !thread.length && (
            <p className="sub wk-blank">
              It reads what you set and what you actually did the last few weeks, how you have
              been recovering, and what you are training for — then proposes the counts below.
              You move any of them, and nothing is written until you set the week.
            </p>
          )}

          {why && <Markdown text={why} className="md plantalk-why" />}

          {thread.map((m, i) => (
            <div key={i} className={`plantalk-msg ${m.role}`}>
              <Markdown text={m.text} className="md" />
            </div>
          ))}

          {asking && (
            <div className="plantalk-msg coach thinking">
              <span className="coachdots"><i /><i /><i /></span>
              <span className="sub">Reading your last few weeks…</span>
            </div>
          )}

          {error && (
            <p className="plantalk-err">
              <Icon name="TriangleAlert" size={13} /> {error} — the numbers below are unchanged.
            </p>
          )}

          {!asking && (
            <div className="plantalk-prompts">
              {WEEK_PROMPTS.map(q => (
                <button key={q} className="plantalk-prompt" onClick={() => ask(q)}>{q}</button>
              ))}
            </div>
          )}

          <div className="plantalk-ask">
            <textarea rows={2} value={text} disabled={asking}
              placeholder="or say it — &ldquo;gym Thursday, long ride Sunday, keep the fingers light&rdquo;"
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(text) }
              }} />
            <button className="btn" disabled={!text.trim() || asking} onClick={() => ask(text)}>
              {asking ? '…' : 'Ask'}
            </button>
          </div>
        </div>
      </div>

      {!Object.keys(draft).length && offer.source !== 'empty' && (
        <button className="restbtn" onClick={() => { setBefore(null); setDraft(offer.counts) }}>
          <Icon name="Repeat" size={17} />
          <span>
            {offer.source === 'last-week'
              ? 'Start from last week\'s quotas'
              : 'Start from what you actually did last week'}
          </span>
        </button>
      )}

      <div className="card wk-card">
        <h2>{title || 'What this week asks for'}</h2>
        <p className="sub">
          Counts of <strong>workouts</strong>, not days. Move any number — what it proposed is a
          proposal, and what you set is the week.
        </p>

        {achs.map(a => (
          <div key={a.id} className="quotagroup">
            <h3><Icon name={a.icon} size={15} /> {a.name}</h3>
            {catsOf(a).map(Row)}
          </div>
        ))}

        {loose.length > 0 && (
          <div className="quotagroup">
            <h3><Icon name="Sparkles" size={15} /> Nothing in particular</h3>
            {loose.map(Row)}
          </div>
        )}
      </div>

      <div className="plan-actions sticky">
        <button className="btn ghost" onClick={onClose}>Close</button>
        <button className="btn big" onClick={keep} disabled={!total && !dirty}>
          <Icon name="CalendarRange" size={17} />{' '}
          {existing ? 'Update the week' : 'Set the week'} · {total}
        </button>
      </div>
    </FullScreen>
  )
}
