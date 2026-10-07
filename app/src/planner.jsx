/*
 * Plan a workout — the four screens between "+" and a session with the sets
 * already written in.
 *
 * Pick a kind (legs, say), then say how much time there is and what the session
 * is for; the planner reads what it already has (recent sessions, current
 * health/vitals) and writes a followable workout, sets included.
 *
 * So: WHAT, then HOW LONG and WHY, then it goes and reads, then the user edits
 * it and keeps it. Three things about the shape are load-bearing.
 *
 * **The kinds are content.** `plan.json` → `plannerKinds`. A list of the things
 * the user might plan is a list that is wrong the day it ships, and "add Shoulders"
 * should be an edit to a file rather than a rebuild. Same reason the activity
 * catalog and the exercise catalog live there.
 *
 * **The review step is a real editor, not a confirmation.** Everything in a
 * planned session must be editable the same way a logged one is, so every
 * number is a stepper before it is ever a workout, and the same editor is what
 * the session sheet shows afterwards. One component, two places, because a
 * second one would drift.
 *
 * **Nothing is stored until the user keeps it.** A run that produced a session the user does
 * not want costs a model call and nothing else: no entry, no thread, no file.
 * The model never writes to the log — the user does, with a tap, exactly as with the
 * coach's offers.
 *
 * **AND THERE ARE TWO ROUTES THROUGH IT**: the user either builds the workout
 * themselves by picking exercises, or has the model write it. The fork is on the
 * FIRST screen, under the kinds, because what
 * the user is doing is the same question either way and how it gets written down is the
 * next one — and because a route step in front of it would put a tap between the
 * + button and the thing that was already there.
 *
 * What the two share is everything after the fork: `blankPrescription` makes the
 * same object the model's JSON normalises into, so the editor, the split, the
 * quota, the runner and the sheet cannot tell them apart and no second version of
 * any of them was written. What differs is two screens — the model's route asks
 * how long and then goes away and reads; their own route opens the editor with the
 * blocks named and nothing in them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import { FullScreen } from './modal.jsx'
import { Markdown } from './lib/markdown.jsx'
import { requestWorkout, reviseWorkout, plannerContext } from './lib/plannerapi.js'
import {
  normalizePrescription, prescriptionLine, prescriptionSteps, itemLine, setLine,
  patchSet, addSet, removeSet, removeItem, patchItem, patchBlock, appendLift, setFieldsFor,
  splitPrescription, moveItem, blankPrescription, appendPiece, dropEmptyBlocks,
} from './lib/prescription.js'
import { ExerciseSection } from './exercises.jsx'
import { useWhoop, readinessFor } from './lib/whoop.jsx'
import { usePlan } from './lib/planctx.jsx'
import { progress as quotaProgress } from './lib/quota.js'
import { currentMe } from './lib/whoami.js'

/** The `type: "lifts"` field spec, which carries the exercise catalog. */
export function liftFieldOf(plan) {
  for (const opt of plan?.dailyMenu || []) {
    for (const f of opt.outputs || []) if (f.type === 'lifts') return f
  }
  return null
}

const DEFAULT_MINUTES = [20, 30, 45, 60, 75, 90]

/* ------------------------------------------------------------------ flow */

export function PlanFlow({ plan, entries = [], iso, onKeep, onStart, onClose }) {
  const minuteChips = plan?.plannerKinds?.minutes || DEFAULT_MINUTES
  const liftField = useMemo(() => liftFieldOf(plan), [plan])

  /*
   * The two things the app already knows, gathered here rather than passed in.
   *
   * This component mounts inside the WHOOP provider and App does not, so reading
   * recovery from up there would silently return "no data" — which the planner
   * would then never mention, and the failure would look like a model that
   * ignored their sleep rather than a hook in the wrong place.
   */
  const { cache: whoopCache } = useWhoop()
  const readiness = useMemo(() => readinessFor(whoopCache, iso), [whoopCache, iso])
  const week = useMemo(() => quotaProgress({ plan, entries, iso }), [plan, entries, iso])

  // kind | ask | working | review | failed | kept, plus `build` — the hand-built
  // route, which reaches the same editor from the same kinds with no model in it.
  const [step, setStep] = useState('kind')
  const [keptId, setKeptId] = useState(null)   // the entry "start it" would open
  const [keptCount, setKeptCount] = useState(1)
  // A LIST since 2026-09-17: one gym trip often covers several kinds, and
  // picking them all up front means the model is told about every one of them.
  const [picked, setPicked] = useState([])  // kinds[] rows, plus { key: 'custom:…' }
  const [custom, setCustom] = useState('')
  const [minutes, setMinutes] = useState(45)
  const [goal, setGoal] = useState('')
  const [pres, setPres] = useState(null)
  const [error, setError] = useState(null)
  const abort = useRef(null)

  // A planning run is a model reading their log — it takes tens of seconds, and a
  // spinner with no sense of how long is a spinner the user taps away from. See Working.
  useEffect(() => () => abort.current?.abort(), [])

  const label = picked.map(k => k.label).join(' + ')
  const primary = picked[0] || null

  const run = useCallback(async () => {
    setStep('working')
    setError(null)
    const ctrl = new AbortController()
    abort.current = ctrl
    try {
      const raw = await requestWorkout({
        kinds: picked.map(k => k.prompt || k.label),
        minutes,
        goal: goal.trim(),
        context: plannerContext({ readiness, week, iso }),
        signal: ctrl.signal,
      })
      const built = normalizePrescription(raw, { liftField })
      if (!built) throw new Error('the planner wrote a session with nothing in it — try again')
      /*
       * The FIRST kind the user picked wins where the model left the answer blank.
       *
       * With several kinds in one trip there is no single right category — a gym
       * day that is legs and core and a spin fills one quota, not three, because
       * one entry has one category. So the first is only a default, and the
       * review screen asks which. That was chosen over splitting it into three
       * entries: one session followed start to finish is the point.
       */
      setPres({
        ...built,
        category: built.category || primary?.category || null,
        activity: built.activity || primary?.activity || null,
        focus: built.focus || goal.trim() || label,
        ask: { kinds: picked.map(k => k.label), minutes, goal: goal.trim() },
      })
      setStep('review')
    } catch (e) {
      if (ctrl.signal.aborted) return
      setError(e.message)
      setStep('failed')
    }
  }, [picked, minutes, goal, readiness, week, iso, liftField, label, primary])

  /**
   * The other route: the blocks, named, with nothing in them.
   *
   * One block per kind the user picked, in the order the user tapped them, each carrying that
   * kind's quota and sport. That is the whole of what the kinds are for here —
   * the model uses them as a brief, the user uses them as a skeleton — and it is what
   * makes "Legs + a ride" land as two entries by hand exactly as it does by
   * model, because the seam is the block and not the author.
   *
   * A kind that names no category (the sport-agnostic endurance ones, which exist
   * so the model can pick the sport from what the week owes) leaves the block
   * saying "counts toward nothing" in as many words. Nothing here guesses on their
   * behalf: the chip that fixes it is the one under the block's own name.
   */
  const build = useCallback(() => {
    setPres(blankPrescription({
      title: label || 'Workout',
      category: primary?.category || null,
      activity: primary?.activity || null,
      blocks: picked.map(k => ({
        name: k.label,
        category: k.category || null,
        activity: k.activity || null,
      })),
    }))
    setStep('build')
  }, [picked, label, primary])

  /*
   * The discipline travels with the kind onto the next screen.
   *
   * The divider on the grid answers "is this climbing?" while the user is choosing;
   * this answers it while the user is committing, which is the screen the user is actually
   * looking at when the user presses go. "Power endurance" alone is the same coin flip
   * one step later.
   */
  /*
   * The discipline prefix survives multi-select only when it is UNAMBIGUOUS —
   * every pick in the same group. "Climbing · Power endurance" is useful;
   * "Climbing · Legs + Power endurance" is a lie about the first half.
   */
  const groups = plan?.plannerKinds?.groups || []
  const oneGroup = picked.length > 0 && picked.every(k => k.group && k.group === picked[0].group)
  const groupName = oneGroup ? groups.find(g => g.key === picked[0].group)?.name : null
  const title = step === 'kept' ? 'On your day'
    : step === 'review' ? (pres?.title || 'Your workout')
    : step === 'build' ? (pres?.title || 'Your workout')
    : step === 'kind' ? 'Plan a workout'
    : label ? [groupName, label].filter(Boolean).join(' · ')
    : 'Plan a workout'

  /**
   * Keep it, and stop there. Starting it is the next screen's question.
   *
   * `dropEmptyBlocks` is for the hand-built route: a block the user picked and never
   * filled in survives every edit on purpose (see `blockSurvives`) and must not
   * survive this, or it lands on their day as an entry with no work in it.
   */
  const keep = () => {
    const kept = onKeep(dropEmptyBlocks(pres))
    // One planning run can land as several workouts — see splitPrescription.
    setKeptId(kept?.first || null)
    setKeptCount(kept?.count || 1)
    setStep('kept')
  }

  /** Round again, from the top, with the last ask cleared. */
  const another = () => {
    setPres(null)
    setKeptId(null)
    setPicked([])
    setCustom('')
    setGoal('')
    setStep('kind')
  }

  const back = () => {
    if (step === 'ask') return setStep('kind')
    // Backing out of the builder throws away what the user typed, so it goes back to
    // the kinds rather than to a screen the user did not come from.
    if (step === 'build') return setStep('kind')
    if (step === 'failed') return setStep('ask')
    if (step === 'working') { abort.current?.abort(); return setStep('ask') }
    // Backing out of the "what now" screen is the same as "back to today" — the
    // workout is already on the day either way, which is what that screen says.
    onClose()
  }

  return (
    <FullScreen
      title={title}
      sub={step === 'review' ? prescriptionLine(pres) : step === 'ask' ? 'How long, and what for' : null}
      icon="ClipboardCheck"
      onBack={back}
    >
      {step === 'kind' && (
        <KindStep plan={plan} custom={custom} setCustom={setCustom}
          picked={picked} setPicked={setPicked}
          onNext={() => setStep('ask')} onBuild={build} />
      )}

      {step === 'ask' && (
        <AskStep picked={picked} label={label} minutes={minutes} setMinutes={setMinutes}
          goal={goal} setGoal={setGoal} chips={minuteChips}
          placeholder={plan?.plannerKinds?.goalPlaceholder}
          onGo={run} />
      )}

      {step === 'working' && <Working label={label} minutes={minutes} />}

      {step === 'failed' && (
        <div className="plan-failed">
          <p className="plan-failed-lead">
            <Icon name="TriangleAlert" size={15} /> {error}
          </p>
          <p className="sub">
            Nothing was written. The planner reads your log before it answers, so a box that is
            busy or unreachable costs you the wait and nothing else.
          </p>
          <div className="plan-actions fork">
            <button className="btn" onClick={run}><Icon name="RotateCw" size={16} /> Try again</button>
            <button className="btn ghost" onClick={() => setStep('ask')}>Change the ask</button>
            {/* Not a dead end. The box being busy is no reason not to plan the
                session — it is only a reason to write it yourself. */}
            <button className="btn ghost" onClick={build}>
              <Icon name="ListPlus" size={16} /> Build it myself
            </button>
          </div>
        </div>
      )}

      {step === 'build' && pres && (
        <BuildStep pres={pres} setPres={setPres} liftField={liftField} entries={entries}
          categories={plan?.quotaCategories || []}
          onKeep={keep} />
      )}

      {step === 'review' && pres && (
        <ReviewStep pres={pres} setPres={setPres} liftField={liftField} entries={entries}
          categories={plan?.quotaCategories || []}
          onRedo={() => setStep('ask')}
          onKeep={keep} />
      )}

      {step === 'kept' && pres && (
        <KeptStep pres={pres} count={keptCount} parts={splitPrescription(pres)}
          onStart={keptId ? () => onStart(keptId) : null}
          onAnother={another}
          onDone={onClose} />
      )}
    </FullScreen>
  )
}

/* ------------------------------------------------------------ step: what */

/**
 * The kinds, under discipline headings.
 *
 * Ungrouped, this grid read wrong: "Power" and "Endurance" are climbing
 * categories in this app and both are ordinary words for lifting and cardio, so
 * on a twelve-card grid with no headings they were a coin flip. A "climbing:"
 * prefix or a divider would fix it; a divider is better, because
 * prefixing every climbing label would make four of the twelve cards two lines
 * long to solve a problem that is really about grouping.
 *
 * The groups are CONTENT (`plannerKinds.groups`) like the kinds themselves, and
 * a kind whose `group` matches nothing falls into a trailing section rather than
 * vanishing — the same rule the session picker follows, for the same reason: a
 * card that is in the file and not on the screen is the failure mode this app
 * has already had once today.
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

function KindStep({ plan, custom, setCustom, picked, setPicked, onNext, onBuild }) {
  const groups = groupedKinds(plan)
  const has = (k) => picked.some(p => p.key === k.key)
  const toggle = (k) =>
    setPicked(has(k) ? picked.filter(p => p.key !== k.key) : [...picked, k])

  const addCustom = () => {
    const label = custom.trim()
    if (!label) return
    const key = `custom:${label.toLowerCase()}`
    if (!picked.some(p => p.key === key)) setPicked([...picked, { key, label, prompt: label }])
    setCustom('')
  }

  return (
    <>
      <p className="sub plan-lead">
        Pick what you are doing — <strong>as many as you like</strong>. A gym trip that is legs,
        then core, then ten minutes on the bike is one session with three blocks. Then say who
        writes it down: you, or the model. Either way you edit every number afterwards.
      </p>

      {/*
        * What is selected, and the order it will be written in. Numbered rather
        * than merely highlighted: the planner is told to write the blocks in this
        * order, so which one the user tapped first is a real fact about the session and
        * not decoration.
        */}
      {picked.length > 0 && (
        <div className="pickedbar">
          {picked.map((k, i) => (
            <button key={k.key} className="pickedchip" onClick={() => toggle(k)}
              aria-label={`Remove ${k.label}`}>
              <span className="pickedchip-n">{i + 1}</span>
              <span>{k.label}</span>
              <Icon name="X" size={13} />
            </button>
          ))}
        </div>
      )}

      {groups.map(g => <KindGroup key={g.key} group={g} has={has} toggle={toggle} />)}

      <div className="kindcustom">
        <label htmlFor="plan-custom">Something else</label>
        <div className="kindcustom-row">
          <input id="plan-custom" value={custom} onChange={e => setCustom(e.target.value)}
            placeholder="a shoulder day, a 40 minute erg, a hike…"
            onKeyDown={e => { if (e.key === 'Enter') addCustom() }} />
          <button className="btn" disabled={!custom.trim()} onClick={addCustom}>Add</button>
        </div>
      </div>

      {/*
        * THE FORK, and it lives here rather than on a screen of its own.
        *
        * What the user is doing is the same question whoever writes it down, and it is
        * the question the user opened this screen to answer; who writes it is the next
        * one and it belongs under the answer. A route step in front of the kinds
        * would have put a tap between the + button and the thing that was already
        * there, for a choice that reads better once there is something to make it
        * about.
        *
        * Both are real buttons of the same height. The model's is the accent one
        * because it is the one that goes and does something, not because it is
        * the better answer — the build-it-yourself route exists precisely because
        * the model's is not always it.
        */}
      <div className="plan-actions sticky fork">
        <button className="btn big ghost" disabled={!picked.length} onClick={onBuild}>
          <Icon name="ListPlus" size={17} />
          Build it myself
        </button>
        {/* Not offered to someone the AI is not set up for (lib/whoami.js). */}
        {currentMe().features.ai && (
          <button className="btn big" disabled={!picked.length} onClick={onNext}>
            <Icon name="Sparkles" size={17} />
            {picked.length > 1 ? `Write me ${picked.length} in one` : 'Write it for me'}
          </button>
        )}
      </div>
      {currentMe().features.ai && (
        <p className="sub plan-fine">
          Building it yourself sends nothing anywhere and takes no time; the model takes about a
          minute and asks how long you have first.
        </p>
      )}
    </>
  )
}

/**
 * One divider and its cards.
 *
 * A group may declare `collapsed: true` in content, and then it renders as a
 * native `<details>`: the header with a count, the cards one tap away. This
 * arrived with the endurance catalog on 2026-09-19 — thirty-odd swim, bike and
 * run variants, alongside sport-agnostic zone-2 kinds meant to be the bread and
 * butter — and thirty cards of ride variants
 * between those and the climbing section would have buried both.
 *
 * `<details>` rather than state, for two reasons. Every card is still IN the page
 * — the reachability test in smoke.jsx reads the rendered HTML, and a kind that is
 * only mounted when a group is open is a kind that test cannot see. And it costs
 * nothing on the server render. A group with something picked in it is forced
 * open, so what the user chose is never hidden behind its own header.
 */
function KindGroup({ group: g, has, toggle }) {
  const picked = g.items.filter(has).length
  const cards = (
    <div className="kindgrid">
      {g.items.map(k => (
        <button key={k.key} className={`kindcard ${has(k) ? 'on' : ''}`}
          onClick={() => toggle(k)} aria-pressed={has(k)}>
          <span className="kindcard-ico">
            <Icon name={has(k) ? 'CircleCheck' : k.icon} size={22} />
          </span>
          <span className="kindcard-name">{k.label}</span>
          {k.hint && <span className="kindcard-hint">{k.hint}</span>}
        </button>
      ))}
    </div>
  )

  if (!g.collapsed) {
    return (
      <div className="kindgroup">
        <div className="kindgroup-head">
          <Icon name={g.icon} size={14} />
          <span>{g.name}</span>
        </div>
        {g.blurb && <p className="sub kindgroup-blurb">{g.blurb}</p>}
        {cards}
      </div>
    )
  }

  return (
    <details className="kindgroup folded" open={picked > 0 || undefined}>
      <summary className="kindgroup-head">
        <Icon name={g.icon} size={14} />
        <span>{g.name}</span>
        <span className="kindgroup-n">
          {picked ? `${picked} picked · ` : ''}{g.items.length} kinds
        </span>
        <Icon name="ChevronDown" size={14} className="kindgroup-chev" />
      </summary>
      {g.blurb && <p className="sub kindgroup-blurb">{g.blurb}</p>}
      {cards}
    </details>
  )
}

/* ------------------------------------------------- step: how long, what for */

function AskStep({ picked, label, minutes, setMinutes, goal, setGoal, chips, placeholder, onGo }) {
  const many = picked.length > 1
  return (
    <>
      <div className="askblock">
        <h3>How long have you got{many ? ' altogether' : ''}?</h3>
        {many && (
          <p className="sub">
            For the whole trip — {label.toLowerCase()} — not for each. It will fit them into
            this and say so if they do not all go.
          </p>
        )}
        <div className="chiprow">
          {chips.map(m => (
            <button key={m} className={`timechip ${minutes === m ? 'on' : ''}`}
              onClick={() => setMinutes(m)} aria-pressed={minutes === m}>
              {m}<span>min</span>
            </button>
          ))}
        </div>
        <div className="minstep">
          <button className="qbtn" onClick={() => setMinutes(m => Math.max(5, m - 5))}
            aria-label="five minutes less"><Icon name="Minus" size={16} /></button>
          <span className="minstep-n">{minutes} min</span>
          <button className="qbtn" onClick={() => setMinutes(m => Math.min(300, m + 5))}
            aria-label="five minutes more"><Icon name="Plus" size={16} /></button>
        </div>
      </div>

      <div className="askblock">
        <h3>What do you want out of it?</h3>
        <textarea className="goalbox" rows={4} value={goal} onChange={e => setGoal(e.target.value)}
          placeholder={placeholder || 'Optional — say what you are after and it will build around it.'} />
        <p className="sub">
          Optional. It already knows what you lifted last time and how you slept; this is for the
          part it cannot read — a niggle, a deadline, or just how you feel about it.
        </p>
      </div>

      <div className="plan-actions sticky">
        <button className="btn big" onClick={onGo}>
          <Icon name="Sparkles" size={17} />{' '}
          {many ? 'Build my session' : `Build my ${label ? label.toLowerCase() : 'workout'}`}
        </button>
      </div>
      {picked.length === 1 && picked[0].hint && (
        <p className="sub plan-fine">It will lean toward {picked[0].hint}.</p>
      )}
    </>
  )
}

/* ------------------------------------------------------------ step: working */

/**
 * The wait, made legible.
 *
 * A planning run is thirty to ninety seconds of an agent reading their log, and a
 * bare spinner for that long is a screen the user backs out of. So it says what it is
 * doing and counts up: an elapsed number is honest about a slow answer in a way
 * a progress bar pretending to know the total is not.
 */
const WORKING_STAGES = [
  'Reading your training log…',
  'Checking what you lifted last time…',
  'Reading last night\'s recovery…',
  'Checking your athlete profile…',
  'Writing the sets…',
]

function Working({ label, minutes }) {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => setSecs(s => s + 1), 1000)
    return () => clearInterval(iv)
  }, [])
  const stage = WORKING_STAGES[Math.min(WORKING_STAGES.length - 1, Math.floor(secs / 12))]

  return (
    <div className="plan-working">
      <span className="plan-working-ico"><Icon name="Sparkles" size={28} /></span>
      <div className="plan-working-title">Building {minutes} minutes of {label.toLowerCase()}</div>
      <p className="plan-working-stage">{stage}</p>
      <div className="plan-working-dots"><i /><i /><i /></div>
      <p className="sub">{secs}s — it usually takes under a minute. Leaving this screen cancels it.</p>
    </div>
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
export function PlanTalk({ pres, onChange, compact = false }) {
  const [text, setText] = useState('')
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState(null)
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
  const [shown, setShown] = useState(false)
  const [full, setFull] = useState(false)
  const liftField = liftFieldOf(usePlan())
  const thread = pres?.thread || []

  const ask = async (message) => {
    const said = String(message || '').trim()
    if (!said || asking) return
    setText('')
    setError(null)
    setAsking(true)
    // Their message goes on immediately. A revision takes tens of seconds, and a
    // box that swallows what you typed for the whole of it feels broken.
    const at = new Date().toISOString()
    const pending = [...thread, { role: 'you', text: said, at }]
    onChange({ ...pres, thread: pending })
    try {
      const raw = await reviseWorkout({ plan: stripThread(pres), message: said, thread })
      const next = normalizePrescription(raw, { liftField })
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
 * The same editor, opened empty.
 *
 * The build-it-yourself route: the user plans the session by picking exercises
 * rather than having the model write it. This is the first half, and it is deliberately not
 * a new screen so much as the review step with the model taken out of it: the
 * blocks are already named and already carry their quota, and everything the user does
 * to them — add an exercise, step a weight, reorder, change what a block counts
 * toward — is the same component doing the same thing it does to a session the
 * model wrote.
 *
 * Three things are missing from it on purpose. There is no `PlanTalk`, because
 * the point of this route is that nothing is being asked of a model; it is one
 * tap away on the entry afterwards if the user wants it. There is no "why", because
 * nobody reasoned about it. And there is no Redo, because there is nothing to
 * redo — the undo for a hand-built session is the thing you just typed.
 */
export function BuildStep({ pres, setPres, liftField, entries = [], categories = [], onKeep }) {
  const sets = prescriptionSteps(pres).length

  return (
    <>
      <p className="sub plan-lead">
        <strong>Add an exercise</strong> searches the catalogue of two hundred movements;
        <strong> add a piece</strong> is the work that is not one — a swim set, an interval,
        a hold.
      </p>

      <SplitNote parts={splitPrescription(dropEmptyBlocks(pres))} />

      <PrescriptionEditor pres={pres} onChange={setPres} liftField={liftField} entries={entries}
        categories={categories} onAddPiece={
          (blockId, name, by, unit) => setPres(appendPiece(pres, name, { blockId, by, unit }))
        } />

      <div className="plan-actions sticky">
        <button className="btn big" disabled={!sets} onClick={onKeep}>
          <Icon name="Plus" size={17} /> Put it on today
        </button>
      </div>

      <p className="sub plan-fine">
        {sets
          ? 'Nothing is written until you press it. Blocks you left empty are dropped.'
          : 'Add at least one exercise or piece and this becomes a workout you can follow.'}
      </p>
    </>
  )
}

/**
 * A piece of work that is not a lift.
 *
 * Name it, say how it is MEASURED, add it. The shape is asked for up front
 * because an interval set shows the fields it carries and nothing else — see
 * `setFieldsFor` — so this is the one moment the answer is available.
 *
 * Folded behind a button of its own, beside the exercise catalogue's, rather than
 * sitting open under every block: on a lift day it is never the answer, and a
 * text box under each of six blocks is six text boxes the user is not going to use.
 */
function PieceAdder({ unit, onAdd }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [by, setBy] = useState('time')

  const add = () => {
    const said = name.trim()
    if (!said) return
    onAdd(said, by, unit)
    setName('')
    setOpen(false)
  }

  if (!open) {
    return (
      <button className="presc-add" onClick={() => setOpen(true)}>
        <Icon name="Timer" size={15} /> <span>Add a piece — a swim set, an interval, a hold</span>
      </button>
    )
  }

  return (
    <div className="pieceadd">
      <div className="pieceadd-row">
        <input autoFocus value={name} onChange={e => setName(e.target.value)}
          aria-label="What the piece is called"
          placeholder="easy spin, 400s, hollow hold…"
          onKeyDown={e => { if (e.key === 'Enter') add() }} />
        <button className="modal-btn" onClick={() => { setOpen(false); setName('') }}
          aria-label="Close"><Icon name="X" size={16} /></button>
      </div>
      <div className="pieceadd-by">
        {[['time', 'by time'], ['distance', 'by distance'], ['reps', 'by reps']].map(([k, lbl]) => (
          <button key={k} className={`implchip ${by === k ? 'on' : ''}`}
            onClick={() => setBy(k)} aria-pressed={by === k}>{lbl}</button>
        ))}
        <button className="btn" disabled={!name.trim()} onClick={add}>Add</button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- step: review */

function ReviewStep({ pres, setPres, liftField, entries = [], categories = [], onRedo, onKeep }) {
  return (
    <>
      <PlanTalk pres={pres} onChange={setPres} />

      <SplitNote parts={splitPrescription(pres)} />

      <PrescriptionEditor pres={pres} onChange={setPres} liftField={liftField} entries={entries}
        categories={categories} />

      {pres.notes?.length > 0 && (
        <ul className="plan-notes">
          {pres.notes.map((n, i) => <li key={i}><Icon name="Info" size={13} /> {n}</li>)}
        </ul>
      )}

      <p className="sub plan-fine">
        Written by {pres.model || 'a model'} from your log and your profile. Change anything —
        what it asked for stays on the entry, so you can see afterwards where you went off it.
      </p>

      <div className="plan-actions sticky">
        <button className="btn ghost" onClick={onRedo}><Icon name="RotateCw" size={16} /> Redo</button>
        <button className="btn big" onClick={onKeep}>
          <Icon name="Plus" size={17} /> Put it on today
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
        <span className="sub">
          {parts.map(p => p.title).join(' · ')} — each with its own log and its own quota, so
          a ride your watch recorded attaches to the ride. Change a block&rsquo;s
          <em> counts toward</em> below to move the seams.
        </span>
      </div>
    </div>
  )
}

/**
 * Which quota a BLOCK fills — and therefore where the session SPLITS.
 *
 * It was one picker for the whole session for about two hours. "Counts toward"
 * belongs to each workout in the session, not to the session as a whole: a run
 * and a lift each go to their own quota. That corrects the single-category call
 * made earlier the same day — a session that genuinely is a lift AND a run should move
 * two bars, because the quota rule was always that a quota counts WORKOUTS rather
 * than days.
 *
 * `none` is a real answer and the default for a warm-up: a block that is not a
 * workout in its own right should not quietly fill a quota. See `categoriesOf` in
 * lib/quota.js for what the week does with the set.
 */
function BlockQuota({ categories, value, onChange }) {
  if (!categories.length) return null
  const picked = categories.find(c => c.key === value) || null
  return (
    <details className="blockquota">
      <summary>
        <Icon name="Target" size={12} />
        <span>
          {picked ? <>counts toward <strong>{picked.name}</strong></> : 'counts toward nothing'}
        </span>
      </summary>
      <div className="blockquota-chips">
        <button className={`implchip ${!value ? 'on' : ''}`}
          onClick={() => onChange(null)} aria-pressed={!value}>
          Nothing — part of the workout beside it
        </button>
        {categories.map(c => (
          <button key={c.key} className={`implchip ${value === c.key ? 'on' : ''}`}
            onClick={() => onChange(c.key)} aria-pressed={value === c.key}>
            <Icon name={c.icon} size={13} /> {c.name}
          </button>
        ))}
      </div>
    </details>
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
export function KeptStep({ pres, count = 1, parts = [], onStart, onAnother, onDone }) {
  const many = count > 1
  return (
    <div className="kept">
      <span className="kept-ico"><Icon name="CircleCheck" size={44} /></span>
      <h2>{many ? `${count} workouts are on today` : `${pres.title} is on today`}</h2>

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
        {many
          ? 'Separate entries, so each one logs on its own and a ride your watch recorded '
            + 'attaches to the ride rather than to the lifting. '
          : `${prescriptionLine(pres)}. `}
        Nothing has started — the clock runs when you do. You can edit any of it from the
        day, and it will still be there tonight.
      </p>

      <div className="kept-acts">
        {onStart && (
          <button className="btn big" onClick={onStart}>
            <Icon name="Play" size={18} /> {many ? 'Start the first one' : 'Start it now'}
          </button>
        )}
        <button className="btn ghost" onClick={onAnother}>
          <Icon name="Plus" size={16} /> Plan another workout
        </button>
        <button className="btn ghost" onClick={onDone}>
          <Icon name="House" size={16} /> Back to today
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- the editor */

/**
 * What a distance in THIS block is measured in.
 *
 * A pool is yards here (see the planner's own prompt, which writes swims that
 * way); everything else that covers ground is miles, which is what Strava hands
 * back and therefore what every other distance in this app already is. It is a
 * default on a box the user can retype, not a conversion.
 */
const distanceUnitFor = (block) => (/swim/i.test(block?.activity || '') ? 'yd' : 'mi')

/** "1 set", "6 sets" — the header count. It read "1 sets" until 2026-09-22. */
const setCount = (block) => {
  const n = (block?.items || []).reduce((sum, i) => sum + i.sets.length, 0)
  return `${n} set${n === 1 ? '' : 's'}`
}


/**
 * Every set, editable, with thumbs in mind.
 *
 * Steppers rather than keyboards for reps and weight: the numbers move in
 * predictable increments (a rep at a time, five pounds at a time) and a numeric
 * keyboard on a phone covers half the screen with the thing you are editing
 * underneath it. The value is still an input, so a genuinely odd number is one
 * tap and a type away.
 *
 * Shared by the review step and the session sheet on purpose. Editing a plan
 * the way a session is already edited means the same editor in both places, not
 * two that agree today.
 */
/**
 * Every set of a planned session, editable, with thumbs in mind.
 *
 * THE SAME COMPONENT THE LOG FORM USES, since 2026-09-21: planned and logged
 * workouts should look exactly the same, and where they differed the plan side
 * won. So the card,
 * the fold, the implement chips, the steppers, the picker and reorder mode all
 * live in `exercises.jsx` and this file only says what a BLOCK is. What is left
 * here is the one thing the log has no counterpart for: `BlockQuota`, which
 * decides where a session splits.
 *
 * Shared by the review step and the session sheet on purpose. Editing a plan
 * the way a session is already edited means the same editor in every place, not
 * several that agree today.
 */
export function PrescriptionEditor({
  pres, onChange, liftField, entries = [], entryId = null, categories = [], compact = false,
  canReorder = true, onAddPiece = null,
}) {
  const [shut, setShut] = useState(() => new Set())  // blockIds folded away

  const total = prescriptionSteps(pres).length
  // ONE exercise starts open and it is the first in the SESSION, not the first in
  // each block — six open cards is four screens of steppers to scroll past.
  const firstItemId = (pres?.blocks || []).flatMap(b => b.items || [])[0]?.id || null

  const toggleBlock = (id) => setShut(s => {
    const next = new Set(s)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  return (
    <div className={`presc ${compact ? 'compact' : ''}`}>
      {(pres.blocks || []).map(b => (
        <ExerciseSection key={b.id}
          title={b.name}
          count={b.items.length > 0 ? setCount(b) : null}
          items={b.items.map(it => ({ ...it, line: itemLine(it) }))}
          liftField={liftField} entries={entries} entryId={entryId}
          firstOpenId={firstItemId}
          open={!shut.has(b.id)} onToggle={() => toggleBlock(b.id)}
          extra={
            <BlockQuota categories={categories} value={b.category}
              onChange={(key) => onChange(patchBlock(pres, b.id, { category: key }))} />
          }
          /* The hand-built route only. A session the model wrote already has its
             intervals in it, and the place to change one is the card. */
          foot={onAddPiece
            ? <PieceAdder unit={distanceUnitFor(b)}
                onAdd={(name, by, unit) => onAddPiece(b.id, name, by, unit)} />
            : null}
          onPatch={(id, patch) => onChange(patchItem(pres, id, patch))}
          onPatchSet={(id, setId, patch) => onChange(patchSet(pres, id, setId, patch))}
          onAddSet={(id) => onChange(addSet(pres, id))}
          onRemoveSet={(id, setId) => onChange(removeSet(pres, id, setId))}
          onRemove={(id) => onChange(removeItem(pres, id))}
          onMove={canReorder ? (id, dir) => {
            const r = moveItem(pres, id, dir)
            onChange(r.pres)
            return r.itemId
          } : null}
          /* Same as the log form: the exercise the user just added opens. `appendLift`
             re-mints every id, and the new one is always last in its block. */
          onAdd={(key) => {
            const next = appendLift(pres, liftField, key, { blockId: b.id })
            onChange(next)
            const block = (next.blocks || []).find(x => x.name === b.name) || next.blocks?.[0]
            return block?.items?.at(-1)?.id || null
          }} />
      ))}
      {/* Only where there is nothing to be done about it. A session the user is still
          building is empty because the user has not started, and every block on the
          screen is already offering them the two ways in. */}
      {!total && !onAddPiece && (
        <p className="sub">Nothing left in this workout. Redo it, or close and start again.</p>
      )}
    </div>
  )
}

export { setLine }
