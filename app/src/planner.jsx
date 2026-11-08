/*
 * Plan a workout — the screens between "+" and a session with the sets
 * already written in.
 *
 * Two routes, one editor. **Write it for me**: say what you want to do in your
 * own words ("legs, then twenty minutes easy on the bike") and how long there is;
 * the model reads the recent log and writes a followable workout, sets included,
 * as a DRAFT on the server (lib/drafts.js), so leaving the page loses nothing.
 * **Build it myself**: the same editor, open at once with one empty block; the
 * kinds are an optional "start from" row, never a required step (#78).
 *
 * What the two share is everything after the fork: `blankPrescription` makes the
 * same object the model's JSON normalises into, so the editor, the split, the
 * runner and the sheet cannot tell them apart. Nothing reaches the log until the
 * user keeps it, on the day chosen here (`date`).
 *
 * The flow's state and rules are `lib/planflow.js` (`usePlanFlow`), shared with
 * the phone; this file is the web's view of it.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import { FullScreen } from './modal.jsx'
import { PrescriptionEditor } from './editor.jsx'
import { Markdown } from './lib/markdown.jsx'
import { NumInput } from './numinput.jsx'
import { reviseWorkout } from './lib/plannerapi.js'
import { draftTitle, draftLine, draftToEvict } from './lib/drafts.js'
import {
  normalizePrescription, prescriptionLine, prescriptionSteps,
  reviseWeightModes, splitPrescription, appendPiece, dropEmptyBlocks,
} from './lib/prescription.js'
import { usePlan } from './lib/planctx.jsx'
import { ForChoice, ForLine, usePeopleLogs } from './trainer.jsx'
import { FOR_ME, forWords, forSomeoneElse, namesOf } from './lib/trainer.js'
import { liftFieldOf } from './lib/lifts.js'
import { fromIso, isoShift, dayWords, dayPhrase } from './lib/dates.js'
import { usePlanFlow, hasWork, dayBounds, DEFAULT_MINUTES } from './lib/planflow.js'

/* ------------------------------------------------------------------ flow */

/*
 * `iso` is today; `date` the day Today is showing (a plan lands there, or later).
 * `people`, `onKeepFor`, `onShareWith`, `onStartFor`: the owner planning for
 * other people on the install (lib/trainer.js). `people` is empty for anyone but
 * the owner, while acting and with one person, and then nothing here changes.
 */
export function PlanFlow({ plan, entries = [], iso, date = null, onKeep, onStart, onClose, people = [], onKeepFor = null, onShareWith = null, onStartFor = null, onShowDay = null }) {
  const f = usePlanFlow({
    plan, entries, iso, date, people, usePeopleLogs, onKeep, onKeepFor, onShareWith, onClose, onStart, onStartFor,
    confirmDiscard: (message) => typeof window === 'undefined' || window.confirm(message),
  })
  const { state: s, set, first, forPeople } = f
  const minuteChips = plan?.plannerKinds?.minutes || DEFAULT_MINUTES
  const categories = f.ctxPlan?.quotaCategories || []
  const day = <PlanDay value={s.date} today={f.today} onChange={set.date} />
  const fileAs = f.asksFiling ? <FileAs choices={f.fileChoices} value={s.filing} onChange={set.filing} /> : null
  const kept = s.kept

  return (
    <FullScreen title={f.title} sub={f.sub} icon="ClipboardCheck" onBack={f.back}>
      {s.step === first && s.notice && <p className="withrow-err plan-keep-err">{s.notice}</p>}
      {s.step === first && f.ai && (
        <DraftList drafts={f.drafts} onOpen={(d) => f.resume(d)} onRetry={f.retry} onDiscard={f.discard} />
      )}
      {s.step === first && <ForChoice people={forPeople} who={s.who} onChange={set.who} />}
      {s.step !== 'kept' && <ForLine who={s.who} people={forPeople} />}
      {s.step === first && f.waitLine && <p className="sub plan-for-wait">{f.waitLine}</p>}

      {s.step === 'start' && (
        <AskStep goal={s.goal} setGoal={set.goal} minutes={s.minutes} setMinutes={set.minutes} chips={minuteChips}
          plan={plan} picked={s.picked} setPicked={set.picked} day={day}
          evicts={s.draftId ? null : draftToEvict(f.drafts)} busy={f.waiting}
          building={hasWork(s.scratch)}
          onGo={() => { set.notice(null); f.run() }} onBuild={() => { set.notice(null); f.build() }} />
      )}

      {s.step === 'working' && (
        <Working label={s.picked.map(k => k.label).join(' + ')} minutes={s.minutes} since={f.open?.run?.startedAt || null}
          onDiscard={f.open ? () => { f.discard(f.open); f.toFirst() } : null} />
      )}

      {s.step === 'failed' && (
        <div className="plan-failed">
          <p className="plan-failed-lead">
            <Icon name="TriangleAlert" size={16} /> {s.error}
          </p>
          <p className="sub">Nothing was written.</p>
          <div className="plan-actions fork">
            <button className="btn" onClick={() => f.retry()}><Icon name="RotateCw" size={16} /> Try again</button>
            {/* Not a dead end: a busy box is only a reason to write it yourself. */}
            <button className="btn secondary" onClick={f.build}>
              <Icon name="ListPlus" size={16} /> Build it myself
            </button>
            <button className="btn secondary" onClick={f.toFirst}>Change the ask</button>
            {!f.open && f.drafts.length > 0 && (
              <button className="btn secondary" onClick={f.back}>See your drafts</button>
            )}
          </div>
        </div>
      )}

      {(s.step === 'build' || s.step === 'review') && s.error && <p className="withrow-err plan-keep-err">{s.error}</p>}

      {s.step === 'build' && s.pres && (
        <BuildStep pres={s.pres} setPres={set.pres} liftField={f.liftField} entries={f.ctxEntries}
          categories={categories} plan={plan} picked={s.picked} setPicked={set.picked} day={day} fileAs={fileAs}
          busy={f.waiting} onKeep={s.saving ? () => {} : f.keep} words={f.words} />
      )}

      {s.step === 'review' && s.pres && (
        <ReviewStep pres={s.pres} setPres={set.pres} liftField={f.liftField} entries={f.ctxEntries}
          categories={categories} day={day} fileAs={fileAs}
          onRedo={f.toFirst} talk={f.talk}
          onKeep={s.saving || f.talk?.busy ? () => {} : f.keep} forId={f.forId} words={f.words} />
      )}

      {s.step === 'kept' && s.pres && kept && (
        <KeptStep pres={s.pres} count={kept.count} parts={splitPrescription(s.pres)} words={f.keptWords} failed={kept.failed}
          onRetry={kept.plan ? f.retryKept : null} retrying={s.saving}
          /* Nothing to start on a later day; leaving asks first if a workout is set aside (`keptStart`). */
          onStart={f.start?.run || null} startLabel={f.start?.label || null}
          onAnother={f.another}
          /* Kept for you on a later day: the way to it, on Today, in place of Back to
             today (#94, C N15: a plan for Monday offered no way to open it). */
          onSee={onShowDay && kept.who?.me !== false && kept.date && kept.date > f.today
            ? () => { onShowDay(kept.date); f.close() } : null}
          seeLabel={kept.date ? seeWords(kept.date, f.today) : null}
          onDone={f.close} />
      )}
    </FullScreen>
  )
}

/* ------------------------------------------------------------- the day */

/**
 * Which day it goes on (#78): the day Today was showing, or any later one. Today
 * at the earliest, because a workout already done is logged, not planned. The
 * same ‹ day › as the rest day's form (`.dayswitch`), in words.
 */
export function PlanDay({ value, today, onChange }) {
  const { min, max } = dayBounds(today)
  const words = dayWords(value, today)
  const date = /^(Today|Tomorrow)$/.test(words)
    ? fromIso(value).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
    : null
  return (
    <section className="planday" aria-label="Which day">
      <span className="planday-label">Day</span>
      <div className="dayswitch">
        <button type="button" className="iconbtn" onClick={() => onChange(isoShift(value, -1))} disabled={value <= min}
          aria-label="The day before"><Icon name="ChevronLeft" size={20} /></button>
        <div className="dayswitch-words" aria-live="polite">
          <span>{words}</span>
          {date && <span className="sub">{date}</span>}
        </div>
        <button type="button" className="iconbtn" onClick={() => onChange(isoShift(value, 1))} disabled={value >= max}
          aria-label="The day after"><Icon name="ChevronRight" size={20} /></button>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------ what it is */

/**
 * "What is it?" (#78): asked on the keep step only when nothing on the workout
 * says (no kind, no sport on a block, no lift to file it by; `needsFiling`), so a
 * hand-built ride does not land filed under nothing. One row of the catalog's
 * pinned sports; "Other…" opens the rest of the catalog, grouped. One tap, and
 * never in the way: Keep works without it.
 */
export function FileAs({ choices, value = null, onChange }) {
  const [more, setMore] = useState(false)
  const pinned = choices?.pinned || []
  const other = value && !pinned.some(a => a.key === value)
  const chip = (a) => (
    <button key={a.key} className={`out-chip ${value === a.key ? 'on' : ''}`} aria-pressed={value === a.key}
      onClick={() => { onChange(value === a.key ? null : a.key); setMore(false) }}>
      <Icon name={a.icon || 'Dumbbell'} size={15} /> {a.name}
    </button>
  )
  return (
    <section className="planfile" aria-label="What is it?">
      <div className="section-head"><h3>What is it?</h3></div>
      <div className="chiprow">
        {pinned.map(chip)}
        {other && chip({ key: value, name: choices.nameOf(value) || value })}
        <button className={`out-chip ${more ? 'on' : ''}`} aria-expanded={more} onClick={() => setMore(v => !v)}>Other…</button>
      </div>
      {more && (choices?.groups || []).map(g => (
        <div key={g.name} className="askkinds-group" role="group" aria-label={g.name}>
          <h4>{g.name}</h4>
          <div className="chiprow">{g.items.map(chip)}</div>
        </div>
      ))}
    </section>
  )
}

/* ------------------------------------------------------------ the kinds */

/**
 * The kinds, under discipline headings.
 *
 * Ungrouped, "Power" and "Endurance" were a coin flip: climbing categories in
 * this app and ordinary words for lifting and cardio. The groups are CONTENT
 * (`plannerKinds.groups`) like the kinds, and a kind whose `group` matches
 * nothing falls into a trailing section rather than vanishing: a card in the
 * file and not on the screen is the failure this app has already had.
 */
export function groupedKinds(plan) {
  const kinds = plan?.plannerKinds?.kinds || []
  const defs = plan?.plannerKinds?.groups || []

  const groups = defs
    .map(g => ({ ...g, items: kinds.filter(k => k.group === g.key) }))
    .filter(g => g.items.length > 0)

  const claimed = new Set(groups.flatMap(g => g.items.map(k => k.key)))
  const rest = kinds.filter(k => !claimed.has(k.key))
  if (rest.length) {
    groups.push({ key: '_other', name: 'Anything else', icon: 'Sparkles', items: rest })
  }
  return groups
}

/**
 * Every kind as an optional chip, folded under one head, open once one is
 * picked. The ask's "Add a kind" and the builder's "Start from" are this one
 * component. Labels only: a kind's `hint` and `prompt` are written for the
 * model and never reach the hand-built route. Every kind is in the page (a
 * `<details>`), so the reachability tests can see each one.
 *
 * `onPicked` (the builder's Start from, #95, C N4): a pick folds the list and
 * hands the kind back, so the screen can go to the block it made. Left open,
 * the list was three screens of chips and the block landed under all of it:
 * the chip lit, and nothing seemed to happen. Folded, its head says what was
 * picked; open it again to add another.
 */
export function KindChips({ plan, picked = [], setPicked, title, className = 'askkinds', onPicked = null }) {
  const groups = groupedKinds(plan)
  const [open, setOpen] = useState(!onPicked && picked.length > 0)
  const has = (k) => picked.some(p => p.key === k.key)
  const toggle = (k) => {
    const adding = !has(k)
    setPicked(adding ? [...picked, k] : picked.filter(p => p.key !== k.key))
    if (adding && onPicked) { setOpen(false); onPicked(k) }
  }
  const known = new Set(groups.flatMap(g => g.items.map(k => k.key)))
  // A draft written before #59 may carry a "Something else" kind; it is shown, and can be taken off.
  const extra = picked.filter(k => !known.has(k.key))
  const chip = (k) => (
    <button key={k.key} className={`out-chip ${has(k) ? 'on' : ''}`} onClick={() => toggle(k)} aria-pressed={has(k)}>
      <Icon name={k.icon || 'Dumbbell'} size={15} /> {k.label}
    </button>
  )
  return (
    <details className={className} open={(onPicked ? open : open || picked.length > 0) || undefined}
      onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="section-head">
        <h3>{title}</h3>
        <span className="sub">{!picked.length ? 'Optional' : onPicked ? kindsLine(picked) : `${picked.length} picked`}</span>
        <Icon name="ChevronDown" size={16} className="kindgroup-chev" />
      </summary>
      {extra.length > 0 && <div className="chiprow askkinds-group">{extra.map(chip)}</div>}
      {groups.map(g => (
        <div key={g.key} className="askkinds-group" role="group" aria-label={g.name}>
          <h4>{g.name}</h4>
          <div className="chiprow">{g.items.map(chip)}</div>
        </div>
      ))}
    </details>
  )
}

/** "Legs + Zone 2 ride": what a folded Start from has picked. */
export const kindsLine = (picked) => picked.map(k => k.label).join(' + ')

/* ------------------------------------------------- step: how long, what for */

/**
 * How long, set ONE way (#78): the content's chips, and "Other" for anything
 * else, which opens a box in minutes. A time from an older draft that is not a
 * chip shows as its own chip, picked.
 */
export function MinuteChips({ minutes, setMinutes, chips = DEFAULT_MINUTES }) {
  const [other, setOther] = useState(false)
  const listed = chips.includes(minutes)
  return (
    <div className="chiprow">
      {chips.map(m => (
        <button key={m} className={`out-chip ${minutes === m && !other ? 'on' : ''}`}
          onClick={() => { setOther(false); setMinutes(m) }} aria-pressed={minutes === m && !other}>
          {m} min
        </button>
      ))}
      {!listed && !other && (
        <button className="out-chip on" aria-pressed="true" onClick={() => setOther(true)}>{minutes} min</button>
      )}
      {other ? (
        <label className="minother">
          <NumInput value={minutes} decimal={false} aria-label="How many minutes" autoFocus
            onChange={(v) => { if (v) setMinutes(Math.min(300, Math.max(5, v))) }} />
          <span>min</span>
        </label>
      ) : (
        <button className="out-chip" onClick={() => setOther(true)} aria-pressed="false">Other</button>
      )}
    </div>
  )
}

/**
 * "Write it for me": one box and one button (#59).
 *
 * What they want to do, in their own words, is the whole brief: the model decides
 * the blocks and what each one is. How long is a row of chips; the day is the
 * ‹ day ›; the kinds are folded optional chips. "Build it myself" is a quiet door
 * at the foot, straight to the editor ("Back to your workout" once one is set aside).
 */
export function AskStep({
  goal, setGoal, minutes, setMinutes, chips = DEFAULT_MINUTES, plan = null, picked = [], setPicked,
  onGo, onBuild = null, evicts = null, busy = false, day = null, building = false,
}) {
  const ready = Boolean(goal.trim() || picked.length)

  return (
    <>
      <section className="askcanvas">
        <label className="askcanvas-label" htmlFor="plan-ask">What do you want to do?</label>
        <textarea id="plan-ask" className="askcanvas-box" rows={4} value={goal} onChange={e => setGoal(e.target.value)}
          placeholder="Legs, then twenty minutes easy on the bike" />
      </section>

      <section className="askblock">
        <div className="section-head"><h3>How long?</h3></div>
        <MinuteChips minutes={minutes} setMinutes={setMinutes} chips={chips} />
      </section>

      {day && <div className="askblock">{day}</div>}

      {/* Folded, so the screen is the box and the button; open when something in it is picked. */}
      <KindChips plan={plan} picked={picked} setPicked={setPicked} title="Add a kind" />

      {onBuild && (
        <button className="btn quiet plan-buildself" onClick={onBuild}>
          <Icon name="ListPlus" size={16} /> {building ? 'Back to your workout' : 'Build it myself'}
        </button>
      )}

      {/* At the cap, the oldest draft not being written makes room. Said before, not after. */}
      {evicts && (
        <p className="sub plan-evicts">
          <Icon name="Info" size={14} /> Replaces your oldest draft, {draftTitle(evicts)}
        </p>
      )}

      <div className="plan-actions sticky">
        <button className="btn big" onClick={onGo} disabled={!ready || busy}>
          <Icon name="Sparkles" size={17} /> Write it for me
        </button>
      </div>
    </>
  )
}

/* ------------------------------------------------------------ step: working */

/**
 * The wait, made legible.
 *
 * A planning run is thirty to ninety seconds of an agent reading their log, and a
 * bare spinner for that long is a screen the user backs out of. So it counts up:
 * an elapsed number is honest about a slow answer in a way a progress bar
 * pretending to know the total is not. One line says what it is doing, and only
 * what it is doing: no stages on a timer that the run never reported (#78).
 *
 * `since` is when the draft's run started, so a draft reopened half way through
 * counts from where it is. Leaving cancels nothing (the run is the draft's, on the
 * server) and the screen says so.
 */
export function Working({ label, minutes, since = null, onDiscard = null }) {
  const from = useMemo(() => (since ? Date.parse(since) : Date.now()), [since])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [])
  const secs = Math.max(0, Math.round((now - from) / 1000))

  return (
    <div className="plan-working">
      <span className="plan-working-ico"><Icon name="Sparkles" size={28} /></span>
      <div className="plan-working-title">
        {label ? `Building ${minutes} minutes of ${label.toLowerCase()}` : `Writing ${minutes} minutes`}
      </div>
      <p className="plan-working-stage">{WORKING_LINE}</p>
      <div className="plan-working-dots"><i /><i /><i /></div>
      <p className="sub">{secs}s · You can leave; it keeps going</p>
      {onDiscard && (
        <button className="btn quiet plan-working-stop" onClick={onDiscard}>Stop and throw it away</button>
      )}
    </div>
  )
}

export const WORKING_LINE = 'Reading your recent workouts and writing the sets…'

/**
 * The drafts on the first screen: written, being written, or failed.
 *
 * Above the kinds, because a draft is a workout already half planned and the
 * first thing to offer is finishing it. Tapping one reopens it at its step; a
 * failed one has its retry on the row; the bin throws one away. Nothing on this
 * list is in the log, and the row never claims otherwise.
 */
export function DraftList({ drafts = [], onOpen, onRetry, onDiscard, now = null }) {
  const [tick, setTick] = useState(() => now ?? Date.now())
  const working = drafts.some(d => d.status === 'working')
  useEffect(() => {
    if (!working || now != null) return undefined
    const iv = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [working, now])
  if (!drafts.length) return null
  const at = now ?? tick

  return (
    <section className="plandrafts" aria-label="Your drafts">
      <div className="section-head"><h3>Drafts</h3><span className="sub">Not on your day yet</span></div>
      <div className="card list">
        {drafts.map(d => (
          <div key={d.id} className={`list-row plandraft ${d.status}`}>
            <button className="plandraft-open" onClick={() => onOpen(d)}>
              <Icon name={d.status === 'working' ? 'Timer' : d.status === 'failed' ? 'TriangleAlert' : 'ClipboardCheck'} size={20} />
              <span className="list-row-main">
                <span className="list-row-title">{draftTitle(d)}</span>
                <span className="list-row-meta">{draftLine(d, at)}</span>
              </span>
            </button>
            {d.status === 'failed' && (
              <button className="btn secondary plandraft-retry" onClick={() => onRetry(d)}>Try again</button>
            )}
            <button className="iconbtn plandraft-del" onClick={() => {
              if (d.status === 'ready' && typeof window !== 'undefined' && !window.confirm(`Throw away “${draftTitle(d)}”?`)) return
              onDiscard(d)
            }} aria-label={`Discard ${draftTitle(d)}`} title="Discard">
              <Icon name="Trash2" size={17} />
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

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

/**
 * The same editor, open from the first tap (#78).
 *
 * The build-it-yourself route: no kind is needed first. It opens on one empty
 * block, and the kinds are an optional "Start from" row above it while nothing
 * is in it yet: tapping Legs and Ride makes the two blocks "Legs + a ride" needs
 * to land as two entries. Once an exercise is in, the blocks are the user's and
 * the row goes. The name comes from the kinds, else from what is in it.
 *
 * Missing on purpose: no `PlanTalk` (nothing is being asked of a model), no "why"
 * (nobody reasoned about it), no Redo (the undo for a hand-built session is what
 * you just typed).
 */
export function BuildStep({
  pres, setPres, liftField, entries = [], categories = [], onKeep, words = forWords(FOR_ME),
  plan = null, picked = [], setPicked = null, day = null, busy = false, fileAs = null,
}) {
  const sets = prescriptionSteps(pres).length
  const empty = !hasWork(pres)
  // A Start-from pick makes a block (last, in the order tapped): go to it once it is drawn.
  const editor = useRef(null)
  const goToNew = useRef(false)
  useEffect(() => {
    if (!goToNew.current) return
    goToNew.current = false
    const last = [...(editor.current?.querySelectorAll('.presc-block') || [])].at(-1)
    last?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }, [pres])

  return (
    <>
      {empty && setPicked && (
        <KindChips plan={plan} picked={picked} setPicked={setPicked} title="Start from" className="askkinds plan-from"
          onPicked={() => { goToNew.current = true }} />
      )}

      <SplitNote parts={splitPrescription(dropEmptyBlocks(pres))} />

      <div ref={editor}>
        <PrescriptionEditor pres={pres} onChange={setPres} liftField={liftField} entries={entries}
          categories={categories} onAddPiece={
            (blockId, name, by, unit) => setPres(appendPiece(pres, name, { blockId, by, unit }))
          } />
      </div>

      {fileAs && <div className="plan-dayfoot">{fileAs}</div>}
      {day && <div className="plan-dayfoot">{day}</div>}

      <div className="plan-actions sticky">
        <button className="btn big" disabled={!sets || busy} onClick={onKeep}>
          <Icon name="Plus" size={17} /> {words.keep}
        </button>
      </div>

      {!sets && <p className="sub plan-fine">Add an exercise or an interval to keep it</p>}
    </>
  )
}

/* ------------------------------------------------------------- step: review */

function ReviewStep({ pres, setPres, liftField, entries = [], categories = [], onRedo, onKeep, forId = null, words = forWords(FOR_ME), talk = null, day = null, fileAs = null }) {
  return (
    <>
      <PlanTalk pres={pres} onChange={setPres} forId={forId} draft={talk} />

      <SplitNote parts={splitPrescription(pres)} />

      <PrescriptionEditor pres={pres} onChange={setPres} liftField={liftField} entries={entries}
        categories={categories} />

      {pres.notes?.length > 0 && (
        <ul className="plan-notes">
          {pres.notes.map((n, i) => <li key={i}><Icon name="Info" size={13} /> {n}</li>)}
        </ul>
      )}

      <p className="sub plan-fine">
        Written from {words.from}. Change anything before you keep it.
      </p>

      {fileAs && <div className="plan-dayfoot">{fileAs}</div>}
      {day && <div className="plan-dayfoot">{day}</div>}

      <div className="plan-actions sticky">
        <button className="btn secondary" onClick={onRedo}><Icon name="RotateCw" size={16} /> Redo</button>
        <button className="btn big" onClick={onKeep} disabled={Boolean(talk?.busy)}>
          <Icon name="Plus" size={17} /> {words.keep}
        </button>
      </div>
    </>
  )
}

/**
 * What this will land as, before the user keeps it.
 *
 * A multi-part trip becomes several entries — see `splitPrescription` — and that
 * is a surprising enough thing to do to their day that it has to be said BEFORE it
 * happens rather than announced afterwards. It is also how the seams become
 * visible: each part is a block with a `counts toward`, so if the split is wrong
 * the fix is the chip on the block below, which is right there.
 *
 * Silent on a single-part plan, which is most of them and is not news.
 */
function SplitNote({ parts }) {
  if (parts.length < 2) return null
  return (
    <div className="splitnote">
      <Icon name="Layers" size={14} />
      <div>
        <strong>This lands as {parts.length} separate workouts</strong>
        <span className="sub">{parts.map(p => p.title).join(' · ')}</span>
      </div>
    </div>
  )
}

/* --------------------------------------------------------- step: what now */

/**
 * It is on the day. Now what?
 *
 * The flow used to drop the user straight into the running timer the moment a
 * workout was kept, which quietly assumed the only reason to plan one is to do it
 * in the next ten seconds. A session planned in the morning for that evening
 * landed straight in a clock. Hence these three doors.
 *
 * Deliberately NOT ranked by a primary/secondary split beyond the obvious one:
 * starting it is the accent button because it is the only one that goes
 * somewhere new, and the other two are equal ways of saying "later".
 */
/** "See it tomorrow", "See it on Mon, Nov 9": the kept screen's way to a later day (#94). */
export const seeWords = (date, today) => {
  const words = dayPhrase(date, today)
  return /^(today|tomorrow)$/.test(words) ? `See it ${words}` : `See it on ${words}`
}

export function KeptStep({ pres, count = 1, parts = [], onStart, onAnother, onDone, forName = null, words = null, failed = [], startLabel = null, onRetry = null, retrying = false, onSee = null, seeLabel = null }) {
  const many = count > 1
  const w = words || forWords(forName ? { me: false, others: [{ id: forName, name: forName }] } : FOR_ME)
  return (
    <div className="kept">
      <span className="kept-ico"><Icon name="CircleCheck" size={44} /></span>
      <h2>{many ? `${count} workouts are ${w.where}` : `${pres.title} is ${w.where}`}</h2>

      {/* Named, because "2 workouts" is not an answer to "which two". */}
      {many && (
        <ul className="kept-parts">
          {parts.map((p, i) => (
            <li key={i}>
              <strong>{p.title}</strong>
              <span className="sub">{prescriptionLine(p.pres)}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="sub">
        {many ? '' : `${prescriptionLine(pres)} · `}
        {w.after}
      </p>

      {/* Not on everyone's day: said, by name, with where to try again. Planned for
          others only, that is here (`onRetry`); shared from your own workout, it is
          "With …" on its sheet. */}
      {failed.map(f => (
        <p key={f.person.id} className="withrow-err plan-keep-err">
          {!onRetry ? `Not with ${f.person.name}: ${f.error}. Add ${f.person.name} from the workout’s “With …”.`
            : f.written > 0 ? `${f.person.name} has part of it (${f.written} of ${f.of}): ${f.error}.`
            : `Not on ${f.person.name}’s day: ${f.error}.`}
        </p>
      ))}
      {onRetry && failed.length > 0 && (
        <>
          <button className="btn secondary plan-keep-retry" onClick={onRetry} disabled={retrying}>
            <Icon name="RotateCw" size={16} /> Try again for {namesOf(failed.map(f => f.person))}
          </button>
          {/* Only here: the draft is retired once it is on anyone's day. */}
          <p className="sub plan-fine">
            If you close this, plan {namesOf(failed.map(f => f.person))}’s again from Plan a workout.
          </p>
        </>
      )}

      <div className="kept-acts">
        {onStart && (
          <button className="btn big" onClick={onStart}>
            <Icon name="Play" size={18} /> {startLabel || (forName ? `Open it on ${forName}’s side` : many ? `Start ${parts[0]?.title || 'workout'}` : 'Start workout')}
          </button>
        )}
        <button className={`btn ${onStart ? 'secondary' : ''}`} onClick={onAnother}>
          <Icon name="Plus" size={16} /> Plan another workout
        </button>
        {onSee ? (
          <button className="btn secondary" onClick={onSee}>
            <Icon name="CalendarDays" size={16} /> {seeLabel}
          </button>
        ) : (
          <button className="btn secondary" onClick={onDone}>
            <Icon name="House" size={16} /> Back to today
          </button>
        )}
      </div>
    </div>
  )
}

