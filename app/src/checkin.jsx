/*
 * The daily check-in.
 *
 * This is where the quick log used to be. The quick log took a bodyweight and a
 * one-line note and did nothing with either — they went into the history and
 * were read again by nobody. What the user actually wanted to say was the thing
 * neither field could hold: can't get to the gym tonight, going Sunday instead,
 * feeling fine.
 *
 * So the card is a conversation with hard fields on the front of it:
 *
 * - The FIELDS are the things a coach would ask before saying anything, and
 *   they are typed inputs rather than prose because bodyweight is a series and
 *   "how do you feel" is only worth having if it is comparable across days.
 *   They come from plan.json (`checkin.fields`) like every other field in the
 *   app, and they save as you touch them — no submit button.
 * - The MESSAGE is everything a form cannot know in advance. It is written into
 *   the entry BEFORE the coach is asked, so a dead tailnet costs you a reply
 *   and never the thing you said.
 * - The REPLY can do two different things, and the difference matters. It can
 *   lean on tomorrow's arithmetic through the same capped, dated, explained
 *   nudge the coach note carries (see lib/coach.js). And it can OFFER sessions:
 *   named cards under the reply, each with the reason it is there and two
 *   ordinary buttons — swap it in as your main, or add it as an extra.
 *
 * The offers are the part that had to change. A nudge is worth at most
 * `recommender.coachCap` points against score gaps of forty, so for the first
 * two weeks the coach could answer "go with the crimp crawls instead", write the
 * nudge, report it as a change, and leave a day that was byte-identical on the
 * next refresh. It was not lying so much as reaching for the only lever it had,
 * and the lever did not reach.
 *
 * The lever it has now is a button, and NOTHING happens until the user presses it.
 * That is deliberate and it was their call: a coach that re-plans the evening on
 * its own is one you have to audit every time you open the app, and the reason
 * to read the reply at all is that the day underneath it has not moved. So the
 * card suggests, the user decides, and a suggestion the user ignores costs them a glance.
 *
 * What the buttons do is checked by `placeable()` against the same hard blocks
 * the day list enforces — the two finger rules, and the venue and window the user
 * typed into the fields above — and re-checked on every render rather than once
 * when the reply landed, so a button stops being offered the moment the day
 * stops allowing it. A suggestion with no button says why in its place. Taking
 * one writes the same entry their own tap writes, and can be undone from the same
 * card.
 */

import { useEffect, useRef, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import { offers, recommend } from './lib/recommend.js'
import { useWhoop, readinessFor } from './lib/whoop.jsx'
import {
  bodyweightEntry, checkinFields, checkinFor, dayContext, dayFacts, fieldsOf,
  messagesOf, summarise, withFields, withMessage, withTaken,
} from './lib/checkin.js'

const MAX_CHARS = 2000

/**
 * The buttons a suggestion carries, and what each reads like afterwards.
 *
 * `main` and `add` are offered on every suggested session whichever one the
 * coach asked for — it is their day, and "actually I'll do that as well rather
 * than instead" is the commonest correction there is. `remove` is its own thing
 * and stands alone: there is nothing to add about a session being taken off.
 */
const ACTIONS = {
  main: { label: 'Swap in as main', done: 'now your main', icon: 'Repeat' },
  add: { label: 'Add as extra', done: 'added to today', icon: 'Plus' },
  remove: { label: 'Take it off today', done: 'taken off today', icon: 'X' },
}
const OFFERED = { main: ['main', 'add'], add: ['add', 'main'], remove: ['remove'] }

/**
 * The entry to append to: whatever the component has been re-rendered with,
 * unless that is somehow behind the one this send already wrote — the message
 * the user typed is the thing that must never be dropped.
 */
const freshest = (ref, written) =>
  ((ref.current?.data?.messages?.length || 0) >= written.data.messages.length ? ref.current : written)

/** The same field types the session log renders, kept deliberately compact. */
function Field({ field, value, onChange }) {
  if (field.type === 'slider') {
    const v = value ?? field.default
    const pct = ((v - field.min) / (field.max - field.min)) * 100
    return (
      <div className="ci-field">
        <div className="out-label">
          <span>{field.label}</span>
          <span className="out-value">{value === undefined ? '—' : v}</span>
        </div>
        <input type="range" className="slider" min={field.min} max={field.max} step={field.step}
          value={v} style={{ '--pct': `${pct}%` }}
          onChange={e => onChange(Number(e.target.value))} />
        {field.scale && (
          <div className="out-scale">{field.scale.map((s, i) => <span key={i}>{s}</span>)}</div>
        )}
      </div>
    )
  }

  if (field.type === 'choice') {
    return (
      <div className="ci-field">
        <div className="out-label"><span>{field.label}</span></div>
        <div className="out-choices">
          {(field.options || []).map(o => {
            const on = value === o.value
            return (
              <button key={o.value} type="button" className={`out-chip ${on ? 'on' : ''}`}
                aria-pressed={on} onClick={() => onChange(on ? undefined : o.value)}>
                {o.icon && <Icon name={o.icon} size={14} />}
                <span>{o.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  if (field.type === 'toggle') {
    return (
      <label className="out-toggle">
        <input type="checkbox" checked={Boolean(value)} onChange={e => onChange(e.target.checked)} />
        <span>{field.label}</span>
      </label>
    )
  }

  return (
    <label className="field ci-num">
      {field.label}{field.unit ? ` (${field.unit})` : ''}
      <input type="number" inputMode="decimal" placeholder={field.hint} value={value ?? ''}
        onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
    </label>
  )
}

/**
 * One session the coach put forward, and the buttons to actually take it.
 *
 * Both halves are load-bearing. The card names the session, its length and the
 * coach's own sentence for why it is there, because a bare button labelled "swap
 * in" is asking them to trust a chat bubble. And every button is judged live
 * against the day as it stands right now — swap your main to something this
 * cannot share an evening with and the "add as extra" button goes away and says
 * why, rather than sitting there ready to build an illegal day.
 */
function Suggestion({ suggestion, opt, verdicts, onTake, onUndo }) {
  const taken = suggestion.taken
  const actions = OFFERED[suggestion.action] || []

  if (taken) {
    return (
      <li className="ci-offer took">
        <span className="ci-offer-head">
          <Icon name={ACTIONS[taken.action].icon} size={13} />
          <strong>{opt?.name || suggestion.optId}</strong>
          <span className="coachchip did">{ACTIONS[taken.action].done}</span>
        </span>
        {onUndo && <button className="linkbtn ci-undo" onClick={onUndo}>undo</button>}
      </li>
    )
  }

  // Every button refused. Say so where the buttons would have been — a card that
  // silently loses them reads as broken, and the reason is the useful part.
  const open = actions.filter(a => verdicts[a]?.ok)
  const blocked = !open.length && verdicts[actions[0]]?.why

  return (
    <li className="ci-offer">
      <span className="ci-offer-head">
        <Icon name={opt?.icon || 'Dumbbell'} size={14} />
        <strong>{opt?.name || suggestion.optId}</strong>
        {opt?.minutes ? <span className="ci-offer-min">{opt.minutes} min</span> : null}
      </span>
      {suggestion.why && <span className="ci-offer-why">{suggestion.why}</span>}
      {blocked ? (
        <span className="ci-offer-no"><Icon name="CircleSlash" size={12} /> {blocked}</span>
      ) : (
        <span className="ci-offer-acts">
          {open.map((a, k) => (
            <button key={a} className={`btn ci-offer-btn ${k ? 'ghost' : ''}`} onClick={() => onTake(a)}>
              <Icon name={ACTIONS[a].icon} size={14} /> {ACTIONS[a].label}
            </button>
          ))}
        </span>
      )}
    </li>
  )
}

/** One turn of the conversation. */
function Message({ message, menu, verdictsFor, onTake, onUndo }) {
  const name = (id) => menu.find(m => m.id === id)?.name || id
  const when = message.at
    ? new Date(message.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null

  return (
    <div className={`ci-msg ${message.role}`}>
      <div className="ci-msg-who">
        {message.role === 'coach'
          ? <><Icon name="Sparkles" size={12} /> Coach</>
          : 'You'}
        {when && <span className="ci-msg-when">{when}</span>}
      </div>
      {message.text.split(/\n{2,}/).map((para, i) => <p key={i} className="ci-msg-text">{para}</p>)}

      {/* What it is offering. Nothing here has happened to the day — these are
          buttons, and the day is exactly as the user left it until the user presses one. */}
      {message.suggested.length > 0 && (
        <ul className="ci-offers">
          {message.suggested.map((s, j) => (
            <Suggestion key={j} suggestion={s} opt={menu.find(m => m.id === s.optId)}
              verdicts={verdictsFor ? verdictsFor(s) : {}}
              onTake={(action) => onTake?.(message.i, j, { ...s, action })}
              onUndo={onUndo ? () => onUndo(message.i, j) : null} />
          ))}
        </ul>
      )}

      {message.applied.length > 0 && (
        <ul className="ci-applied">
          {message.applied.map((a, i) => (
            <li key={i}>
              <span className="coachchip">nudged</span>
              <strong>{name(a.optId)}</strong> {a.points > 0 ? `+${a.points}` : a.points} points
              {a.why && <span className="coach-why"> — {a.why}</span>}
            </li>
          ))}
        </ul>
      )}
      {message.failed && (
        <p className="ci-failed">
          <Icon name="TriangleAlert" size={12} /> Saved, but the coach didn't answer. Try again when you're back on the tailnet.
        </p>
      )}
    </div>
  )
}

/**
 * The wait, made honest.
 *
 * A turn takes about half a minute — it is a model reading three weeks of log
 * and their whole profile before it answers, not a chat bot. A spinner that could
 * equally mean "hung" is worse than a number, so this counts, and says what it
 * is doing while it counts.
 */
function Thinking() {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => setSecs(s => s + 1), 1000)
    return () => clearInterval(iv)
  }, [])
  return (
    <div className="ci-msg coach">
      <div className="ci-msg-who"><Icon name="Sparkles" size={12} /> Coach</div>
      <p className="ci-msg-text ci-thinking">
        reading your log and your notes… {secs > 0 && `${secs}s`}
      </p>
    </div>
  )
}

export function CheckIn({
  plan, entries, iso, coach = null, upsertEntry, mainEntry = null, extraEntries = [],
  onCoachNote, onPlaceSession = null, onUndoPlacement = null,
}) {
  const defs = checkinFields(plan)
  // How the user arrived, per WHOOP. Feeds the ranking behind the reply's buttons, and
  // is handed to the coach so it can say something about it — see readinessFor.
  const { cache: whoopCache } = useWhoop()
  const readiness = readinessFor(whoopCache, iso)
  const entry = checkinFor(entries, iso)
  const fields = fieldsOf(entry)
  const messages = messagesOf(entry)
  const menu = plan?.dailyMenu || []
  const copy = plan?.checkin || {}

  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [showFields, setShowFields] = useState(messages.length === 0)
  const threadRef = useRef(null)

  // A turn takes about half a minute, and the user can fill fields in while it runs.
  // The reply has to be appended to whatever the entry is by THEN, not to the
  // copy this closure was created with, or a slider dragged mid-answer is
  // silently rolled back when the answer lands.
  const latest = useRef(entry)
  latest.current = entry

  // A reply lands at the bottom of the thread; on a phone that is off-screen.
  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight
  }, [messages.length, busy])

  const setField = (key, value) => {
    const next = { ...fields, [key]: value }
    upsertEntry(withFields(entry, iso, next))
    // Bodyweight has been its own series since the first week of the block, and
    // six months of chart must not care that the form around it changed.
    const bw = bodyweightEntry(next, defs, iso)
    if (bw) upsertEntry(bw)
  }

  const send = async (text) => {
    const message = String(text || '').trim().slice(0, MAX_CHARS)
    if (!message || busy) return
    setDraft('')
    setError(null)

    // Written first, and unconditionally. What the user said is a training note
    // whether or not anything answers it.
    const withYou = withMessage(entry, iso, { role: 'you', text: message })
    upsertEntry(withYou)
    setBusy(true)

    try {
      // Computed here rather than in render: the coach is handed the day the
      // app is actually showing, and nothing pays for that until you send.
      const rec = recommend({ plan, entries, iso, ignorePlanned: true, coach, readiness })
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: iso,
          fields,
          messages: [...messages, { role: 'you', text: message }].map(m => ({ role: m.role, text: m.text })),
          today: dayContext({ rec, mainEntry, extraEntries, menu, iso, facts: dayFacts({ plan, entries, iso }) }),
          // No WHOOP here on purpose. The server reads the cache itself and hands
          // the coach the fortnight — see whoopDigest in server/chat.js. Posting
          // it from the browser would mean a digest a browser could rewrite.
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.reply) throw new Error(body?.error || `coach returned ${res.status}`)

      // Stored, not applied. The sessions it named become buttons under the
      // reply; the day does not move until the user presses one.
      upsertEntry(withMessage(freshest(latest, withYou), iso, {
        role: 'coach', text: body.reply, model: body.model || null,
        applied: body.applied || [], suggested: body.sessions || [],
      }))
      // The recommendation reads the note, so hand it straight over rather than
      // waiting for the next poll — the day should change while the user is looking at it.
      if (body.note && onCoachNote) onCoachNote(body.note)
    } catch (err) {
      setError(err.message || 'could not reach your coach')
      upsertEntry(withMessage(freshest(latest, withYou), iso, { role: 'coach', text: '', failed: true }))
    } finally {
      setBusy(false)
    }
  }

  // Which buttons a suggestion should carry, against the day as it stands right
  // now. Recomputed every render on purpose: the answer changes as the user acts on
  // the day, and a button frozen at reply time would offer a session the day has
  // since stopped allowing.
  const verdictsFor = (suggestion) => offers({
    plan, entries, iso, coach, readiness, optId: suggestion.optId,
    mainId: mainEntry?.data?.optId || null,
  })

  /**
   * The user pressed one. Doing it to the day is the caller's job — it owns the
   * entries — and recording it on the message is this card's, so the thread says
   * which suggestion the user took. Written against `latest.current` because a reply
   * may have landed since this render.
   */
  const take = (messageIndex, suggestionIndex, placement) => {
    const entry = latest.current
    if (entry?.data?.messages?.[messageIndex]?.suggested?.[suggestionIndex]?.taken) return
    const record = onPlaceSession?.(placement)
    if (!record) return
    upsertEntry(withTaken(entry, iso, messageIndex, suggestionIndex, record))
  }

  /** ...and changed their mind. The offer goes back to being an offer. */
  const undo = (messageIndex, suggestionIndex) => {
    const entry = latest.current
    const taken = entry?.data?.messages?.[messageIndex]?.suggested?.[suggestionIndex]?.taken
    if (!taken) return
    onUndoPlacement?.(taken)
    upsertEntry(withTaken(entry, iso, messageIndex, suggestionIndex, null))
  }

  const summary = summarise(fields, defs)

  return (
    <div className="card checkin">
      <h2>{copy.title || 'Check in with your coach'}</h2>

      <button className="ci-fieldhead" onClick={() => setShowFields(v => !v)} aria-expanded={showFields}>
        <span>{summary.length ? summary.join(' · ') : 'Weight, how you feel, how long you have'}</span>
        <span className={`alt-chev ${showFields ? 'open' : ''}`}><Icon name="ChevronDown" size={15} /></span>
      </button>

      {showFields && (
        <div className="ci-fields">
          {defs.map(f => (
            <Field key={f.key} field={f} value={fields[f.key]} onChange={v => setField(f.key, v)} />
          ))}
        </div>
      )}

      {messages.length === 0 && copy.intro && <p className="sub ci-intro">{copy.intro}</p>}

      {messages.length > 0 && (
        <div className="ci-thread" ref={threadRef}>
          {messages.filter(m => m.text || m.failed).map(m => (
            <Message key={m.i} message={m} menu={menu} verdictsFor={verdictsFor}
              onTake={onPlaceSession ? take : null}
              onUndo={onUndoPlacement ? undo : null} />
          ))}
          {busy && <Thinking />}
        </div>
      )}

      {messages.length === 0 && (copy.starters || []).length > 0 && !busy && (
        <div className="ci-starters">
          {copy.starters.map(s => (
            <button key={s} className="ci-starter" onClick={() => send(s)}>{s}</button>
          ))}
        </div>
      )}

      <div className="ci-compose">
        <textarea
          rows={2}
          value={draft}
          maxLength={MAX_CHARS}
          placeholder={copy.placeholder || 'how you are, what the day looks like…'}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            // Enter sends; Shift+Enter is a newline. On a phone the button is
            // the target, so this is only for the laptop.
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(draft) }
          }}
        />
        <button className="btn ci-send" disabled={busy || !draft.trim()} onClick={() => send(draft)}>
          {busy ? 'thinking…' : 'Send'}
        </button>
      </div>

      {error && <p className="ci-error"><Icon name="TriangleAlert" size={13} /> {error}</p>}
    </div>
  )
}
