/*
 * The model's side of a plan (#98: out of planner.jsx): its reasoning
 * (`PlanWhy`) and the panel that asks it to change the plan (`PlanTalk`). The
 * session sheet draws both, so they are in the main bundle: no part of a sheet
 * waits on a chunk. Plan a workout itself (planner.jsx) loads on demand.
 */

import { useEffect, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import { Markdown } from './lib/markdown.jsx'
import { reviseWorkout } from './lib/plannerapi.js'
import { normalizePrescription, reviseWeightModes } from './lib/prescription.js'
import { usePlan } from './lib/planctx.jsx'
import { liftFieldOf } from './lib/lifts.js'

/**
 * The paragraph saying what the planner was thinking.
 *
 * Collapsed by default everywhere except the review, where reading it before
 * keeping the session is the whole point. A good `why` runs to a hundred and
 * fifty words — it names what it read in their log and grades its own claims,
 * which is exactly what was asked of it — and a hundred and fifty words is most
 * of a phone screen above the sets the user came to look at.
 */
export function PlanWhy({ text, open = false }) {
  const [shown, setShown] = useState(open)
  if (!text) return null
  const long = text.length > 220
  return (
    <div className={`plan-why ${long && !shown ? 'clipped' : ''}`}>
      <span className="plan-why-ico"><Icon name="Sparkles" size={14} /></span>
      <div className="plan-why-body">
        <Markdown text={text} className="md" />
        {long && (
          <button className="linkbtn plan-why-more" onClick={() => setShown(v => !v)}>
            {shown ? 'less' : 'why this session'}
          </button>
        )}
      </div>
    </div>
  )
}

/** The quick asks, in their own vocabulary. Content would be better; four is not enough to earn it. */
const REVISE_PROMPTS = [
  'Make it shorter',
  'Go easier on me',
  'More volume',
  'Swap an exercise',
]

/**
 * Talking to it about the session it wrote.
 *
 * Once a plan existed there was no way to follow up with the model, so a section
 * at the top shows its reasoning and takes prompts that revise the workout.
 *
 * Three things about the shape.
 *
 * **The thread lives ON the prescription**, so it survives the session landing on
 * the day and the user can still argue with it at six in the evening about something
 * written at eight in the morning. It is not a coach thread — those are files on
 * the box, keyed to a conversation; this is the provenance of one workout and
 * belongs to that workout.
 *
 * **A revision replaces the whole plan, and says what it did.** `changed` is
 * rendered as the newest thing in the thread, because a revision the user cannot see is
 * the same problem the old coach's silent plan edits had.
 *
 * **Their own edits survive it.** The plan sent up is the plan as the user has it,
 * steppers and all, and the prompt tells the model those numbers are their.
 */
/*
 * `draft`: the planner's open draft (planner flow only). Then a revision is the
 * draft's, on the server: `draft.onAsk` starts it, the message and the answer
 * arrive on `pres.thread` from the draft, and `busy`/`error` are the draft's, so
 * a revision still being written when the page was left is still being written
 * when it is reopened. Without it (the session sheet), a revision is one request.
 */
export function PlanTalk({ pres, onChange, compact = false, forId = null, draft = null, entries = [], entryId = null }) {
  const [text, setText] = useState('')
  const [localAsking, setAsking] = useState(false)
  const [localError, setError] = useState(null)
  const asking = draft ? draft.busy : localAsking
  const error = draft ? draft.error : localError
  /*
   * COLLAPSED, since 2026-09-21, and in both places it appears. It was always
   * open, on the argument that a section you have to open first does not show you
   * anything. What that argument missed is what the section is BETWEEN: a
   * paragraph of reasoning, a row of prompts and a text box, all above the first
   * set of the session the user is standing there to do. So it is collapsible
   * and starts collapsed.
   *
   * The header still says how many turns the thread holds, so a conversation the user
   * had with it is never silently hidden — it is one tap, with a count on it.
   */
  const [shown, setShown] = useState(Boolean(draft?.busy || draft?.error))
  const [full, setFull] = useState(false)
  const liftField = liftFieldOf(usePlan())
  const thread = pres?.thread || []

  // A revision that did not come back: its message goes back in the box.
  const failedMessage = draft?.failedMessage || null
  useEffect(() => {
    if (failedMessage) { setText(t => t || failedMessage); setShown(true) }
  }, [failedMessage])

  const ask = async (message) => {
    const said = String(message || '').trim()
    if (!said || asking) return
    setText('')
    if (draft) {
      try { await draft.onAsk(said) } catch { setText(said) }
      return
    }
    setError(null)
    setAsking(true)
    // Their message goes on immediately. A revision takes tens of seconds, and a
    // box that swallows what you typed for the whole of it feels broken.
    const at = new Date().toISOString()
    const pending = [...thread, { role: 'you', text: said, at }]
    onChange({ ...pres, thread: pending })
    try {
      const raw = await reviseWorkout({ plan: stripThread(pres), message: said, thread, forId })
      // The model is never asked what a weight means (#58): what it kept keeps
      // its mode, what is new takes the one its exercise was last logged in.
      const next = reviseWeightModes(pres, normalizePrescription(raw, { liftField }), liftField, entries, { excludeId: entryId })
      if (!next) throw new Error('it sent back a session with nothing in it')
      onChange({
        ...pres, ...next,
        // What the user chose stays their: the category is a decision the user made on this
        // screen, and a revision is not an invitation to undo it.
        category: pres.category || next.category || null,
        activity: pres.activity || next.activity || null,
        thread: [...pending, {
          role: 'coach',
          text: next.changed || raw.changed || 'Rewritten.',
          at: new Date().toISOString(),
        }],
      })
    } catch (e) {
      setError(e.message)
      // Put their message back in the box rather than losing it to a failed turn.
      onChange({ ...pres, thread })
      setText(said)
    } finally {
      setAsking(false)
    }
  }

  const long = (pres?.why || '').length > (compact ? 200 : 420)

  return (
    <div className={`plantalk ${shown ? 'open' : ''}`}>
      <button className="plantalk-head" onClick={() => setShown(v => !v)} aria-expanded={shown}>
        <span className="plantalk-ico"><Icon name="Sparkles" size={15} /></span>
        {/* A session the user wrote themselves has no reasoning to read, and offering to
            explain one would be the app claiming an author it does not have. The
            panel is still worth having on it: the model can revise a plan
            whoever wrote it, which is the whole bridge between the two routes. */}
        <span className="plantalk-title">
          {pres?.why || thread.length
            ? 'Why this session — and what to change'
            : 'Ask the model to change this'}
        </span>
        {thread.length > 0 && <span className="plantalk-n">{Math.ceil(thread.length / 2)}</span>}
        <span className={`alt-chev ${shown ? 'open' : ''}`}><Icon name="ChevronDown" size={15} /></span>
      </button>

      {shown && (
        <div className="plantalk-body">
          {pres?.why && (
            <div className={`plantalk-whywrap ${long && !full ? 'clipped' : ''}`}>
              <Markdown text={pres.why} className="md plantalk-why" />
              {long && (
                <button className="linkbtn plantalk-more" onClick={() => setFull(v => !v)}>
                  {full ? 'less' : 'read the rest'}
                </button>
              )}
            </div>
          )}

          {thread.map((m, i) => (
            <div key={i} className={`plantalk-msg ${m.role}`}>
              <Markdown text={m.text} className="md" />
            </div>
          ))}

          {asking && (
            <div className="plantalk-msg coach thinking">
              <span className="coachdots"><i /><i /><i /></span>
              <span className="sub">Rewriting it…</span>
            </div>
          )}

          {error && (
            <p className="plantalk-err">
              <Icon name="TriangleAlert" size={13} /> {error} — your session is unchanged.
            </p>
          )}

          {!asking && (
            <div className="plantalk-prompts">
              {REVISE_PROMPTS.map(q => (
                <button key={q} className="plantalk-prompt" onClick={() => ask(q)}>{q}</button>
              ))}
            </div>
          )}

          <div className="plantalk-ask">
            <textarea rows={2} value={text} disabled={asking}
              placeholder="or type your own — &ldquo;drop the front squat&rdquo;"
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(text) }
              }} />
            <button className="btn" disabled={!text.trim() || asking} onClick={() => ask(text)}>
              {asking ? '…' : 'Change it'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** The plan without its conversation — what gets sent back up to be revised. */
const stripThread = (pres) => {
  const { thread, ...rest } = pres || {}
  return rest
}

/* -------------------------------------------------------------- step: build */
