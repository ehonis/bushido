/*
 * The coach: a tab you can sit in, and a bubble you can ask from.
 *
 * Both render the same conversation store (see lib/coachapi.jsx): the bubble is
 * for temporary quick chats, but a quick chat
 * you later want back should be findable, and the only way to guarantee that is
 * for there to be one place things go.
 *
 * What it replaced was a coach welded into the daily check-in: one tool-less
 * turn, fed a fixed digest, writing a note for the day. This one is an agent with
 * tools that can go and read their brain, their log and the web before it answers,
 * and can append a memory. The daily form it used to live in is now the journal.
 *
 * THE OFFERS ARE THE ONLY THING IT CAN DO TO THEIR DAY, and even those it cannot do
 * alone: a session card lands when the user taps it, through the same `onPlace` the day
 * list's own taps go through, and the two unbypassable finger rules are enforced
 * in the engine before any suggestion is read. A coach that hallucinated a fourth
 * hard finger day this week produces a card that refuses to place itself, with
 * the reason on it.
 */

import { useEffect, useRef, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import { useCoach } from './lib/coachapi.jsx'
import { Markdown } from './lib/markdown.jsx'

/* --------------------------------------------------------------- the tab */

export function CoachTab({ plan, onPlace }) {
  const { threads, active, asking, error, open, start, send, remove } = useCoach()
  const [showList, setShowList] = useState(false)

  return (
    <div className="coachtab">
      <aside className={`coachlist ${showList ? 'open' : ''}`}>
        <button className="coachnew" onClick={() => { start(); setShowList(false) }}>
          <Icon name="Plus" size={15} /> <span>New chat</span>
        </button>
        {!threads.length && (
          <p className="sub coachlist-empty">
            Nothing yet. Ask it something — it can read your log, your athlete profile
            and the web before it answers.
          </p>
        )}
        {threads.map(t => (
          <div key={t.id} className={`coachlist-row ${active?.id === t.id ? 'on' : ''}`}>
            <button className="coachlist-btn" onClick={() => { open(t.id); setShowList(false) }}>
              <strong>{t.title}</strong>
              <span className="sub">{t.last}</span>
              <span className="coachlist-when">{when(t.updatedAt)} · {t.messages} messages</span>
            </button>
            <button className="coachlist-del" onClick={() => remove(t.id)} aria-label={`Delete ${t.title}`}>
              <Icon name="Trash2" size={14} />
            </button>
          </div>
        ))}
      </aside>

      <div className="coachmain">
        <button className="coachlist-toggle" onClick={() => setShowList(v => !v)}>
          <Icon name="Layers" size={15} />
          <span>{active?.title || 'New chat'}</span>
          <Icon name="ChevronDown" size={14} />
        </button>
        <Conversation plan={plan} thread={active} asking={asking} error={error}
          onSend={send} onPlace={onPlace} />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ the bubble */

/**
 * The floating box, bottom right.
 *
 * Deliberately the SAME conversation component as the tab, so a quick question
 * and a long sitting differ only in how much room they get. It opens on whatever
 * thread is active, which is usually the last thing the user was talking about — the
 * commonest quick chat being a follow-up to one.
 */
export function CoachBubble({ plan, onPlace }) {
  const { active, asking, error, send, threads, open, start } = useCoach()
  const [isOpen, setOpen] = useState(false)

  // Opening onto nothing is a blank box with no history. If the user has talked before
  // and nothing is loaded, pick up the most recent thread.
  const launch = async () => {
    if (!active && threads[0]) await open(threads[0].id)
    setOpen(true)
  }

  return (
    <>
      {!isOpen && (
        <button className="coachfab" onClick={launch} aria-label="Ask the coach">
          <Icon name="Sparkles" size={20} />
        </button>
      )}
      {isOpen && (
        <div className="coachbox">
          <header className="coachbox-head">
            <Icon name="Sparkles" size={15} />
            <span className="coachbox-title">{active?.title || 'Ask the coach'}</span>
            <button onClick={() => { start() }} title="New chat"><Icon name="Plus" size={15} /></button>
            <button onClick={() => setOpen(false)} aria-label="Close"><Icon name="X" size={16} /></button>
          </header>
          <Conversation plan={plan} thread={active} asking={asking} error={error}
            onSend={send} onPlace={onPlace} compact />
        </div>
      )}
    </>
  )
}

/* ------------------------------------------------------ the conversation */

function Conversation({ plan, thread, asking, error, onSend, onPlace, compact = false }) {
  const [text, setText] = useState('')
  const end = useRef(null)
  const messages = thread?.messages || []

  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [messages.length, asking])

  const submit = () => {
    const t = text.trim()
    if (!t || asking) return
    setText('')
    onSend(t)
  }

  return (
    <div className={`coachconv ${compact ? 'compact' : ''}`}>
      <div className="coachconv-body">
        {!messages.length && !asking && (
          <div className="coachconv-blank">
            <p className="sub">
              It can read your training log, your athlete profile in Totem&rsquo;s brain,
              the app&rsquo;s own content and the web — and it will go and look before it
              answers rather than guessing.
            </p>
            {!compact && (
              <div className="coachprompts">
                {[
                  'What should I do today, and why that?',
                  'Am I actually training my diagnosed weakness?',
                  'Look at my last month and tell me what I am avoiding.',
                  'How should I structure a week for the half iron without losing the 12a?',
                ].map(q => (
                  <button key={q} className="coachprompt" onClick={() => onSend(q)}>{q}</button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {/* Their own messages are plain text — the user did not write markdown and
                rendering it as if the user had would mangle an asterisk the user meant. */}
            {m.role === 'user'
              ? <div className="bubble-text">{m.text}</div>
              : <Markdown text={m.text} className="bubble-text md" />}

            {/* A memory it wrote. Shown because a thing that changed a file on
                their box should never be something the user has to go and find out. */}
            {m.wroteMemory && (
              <div className="bubble-memory">
                <Icon name="NotebookPen" size={12} /> <span>Remembered: {m.wroteMemory}</span>
              </div>
            )}

            {/* Offers. They do not move their day until the user presses one. */}
            {Array.isArray(m.sessions) && m.sessions.length > 0 && (
              <div className="bubble-offers">
                {m.sessions.map((s, j) => {
                  const opt = (plan?.dailyMenu || []).find(o => o.id === s.optId)
                  if (!opt) return null
                  return (
                    <button key={j} className="offer" onClick={() => onPlace?.(s)}>
                      <Icon name={opt.icon || 'Target'} size={15} />
                      <span className="offer-body">
                        <strong>{opt.name}</strong>
                        <span className="sub">{s.why}</span>
                      </span>
                      <span className="offer-act">{s.action === 'main' ? 'Make it today' : 'Add it'}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ))}

        {asking && (
          <div className="bubble coach thinking">
            <span className="coachdots"><i /><i /><i /></span>
            <span className="sub">Reading your log and your profile…</span>
          </div>
        )}

        {error && <div className="bubble error"><Icon name="TriangleAlert" size={14} /> {error}</div>}
        <div ref={end} />
      </div>

      <div className="coachconv-ask">
        <textarea
          value={text} rows={compact ? 2 : 3}
          placeholder="Ask it anything about your training"
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            // Enter sends, shift-enter breaks the line. On a phone the button is
            // the one that gets used, so this is purely for the desktop.
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
          }}
        />
        <button className="primary" onClick={submit} disabled={!text.trim() || asking}>
          {asking ? '…' : 'Ask'}
        </button>
      </div>
    </div>
  )
}

function when(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days === 0) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
