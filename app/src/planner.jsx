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
 * **Nothing reaches the log until the user keeps it.** "Write it for me" is a DRAFT
 * the server keeps beside the log (lib/drafts.js, server/drafts.js): the run
 * belongs to the draft, not to this screen, so leaving, locking the phone or
 * opening another device loses nothing, and the drafts are listed on the first
 * screen to reopen where they were. A draft is not an entry. The model never
 * writes to the log — the user does, with a tap, exactly as with the coach's
 * offers, and the draft is discarded once it is kept.
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
import {
  reviseWorkout, plannerContext, aiOffered, createDraft, reviseDraft, retryDraft, saveDraft, discardDraft, claimDraft,
} from './lib/plannerapi.js'
import {
  useDrafts, draftKey, draftStep, draftPres, draftTitle, draftLine, presForServer,
  placedDraftIds, unplacedDrafts, draftToEvict, keepGate, DRAFT_MAX,
} from './lib/drafts.js'
import {
  normalizePrescription, prescriptionLine, prescriptionSteps, itemLine, setLine,
  patchSet, addSet, removeSet, removeItem, patchItem, patchBlock, appendLift, setFieldsFor,
  splitPrescription, moveItem, blankPrescription, appendPiece, dropEmptyBlocks,
} from './lib/prescription.js'
import { ExerciseSection } from './exercises.jsx'
import { useWhoop, readinessFor } from './lib/whoop.jsx'
import { usePlan } from './lib/planctx.jsx'
import { currentMe } from './lib/whoami.js'
import { ForChoice, ForLine, usePersonLog } from './trainer.jsx'

/** The `type: "lifts"` field spec, which carries the exercise catalog. */
export function liftFieldOf(plan) {
  for (const opt of plan?.dailyMenu || []) {
    for (const f of opt.outputs || []) if (f.type === 'lifts') return f
  }
  return null
}

const DEFAULT_MINUTES = [20, 30, 45, 60, 75, 90]

/* ------------------------------------------------------------------ flow */

/*
 * `people`, `onKeepFor`, `onStartFor`: the owner planning for someone else on
 * the install (trainer.jsx, lib/trainer.js). `people` is `planPeople(me)`, empty
 * for anyone but the owner, while acting and with one person, and then nothing
 * here changes. With someone picked, the model runs on THEIR log, plan and About
 * you (the server's `for`), the editor's "last time" is theirs, and keeping it
 * writes into their log through `onKeepFor`; still only on the tap (§0.4).
 */
export function PlanFlow({ plan, entries = [], iso, onKeep, onStart, onClose, people = [], onKeepFor = null, onStartFor = null }) {
  const minuteChips = plan?.plannerKinds?.minutes || DEFAULT_MINUTES
  const liftField = useMemo(() => liftFieldOf(plan), [plan])
  // Who it is for: null is you. Only offered with somewhere to keep it.
  const forPeople = onKeepFor ? people : []
  const [target, setTarget] = useState(null)
  const theirs = usePersonLog(target?.id || null)
  const ctxPlan = target ? (theirs.plan || plan) : plan
  const ctxEntries = target ? theirs.entries : entries

  /*
   * The two things the app already knows, gathered here rather than passed in.
   *
   * This component mounts inside the WHOOP provider and App does not, so reading
   * recovery from up there would silently return "no data" — which the planner
   * would then never mention, and the failure would look like a model that
   * ignored their sleep rather than a hook in the wrong place.
   */
  const { cache: whoopCache } = useWhoop()
  // WHOOP is the owner's: someone else's plan is told nothing about recovery,
  // exactly as on an install without it (§7: absent data means no section).
  const readiness = useMemo(() => (target ? null : readinessFor(whoopCache, iso)), [whoopCache, iso, target])

  // kind | ask | working | review | failed | kept, plus `build` — the hand-built
  // route, which reaches the same editor from the same kinds with no model in it.
  const [step, setStep] = useState('kind')
  const [keptId, setKeptId] = useState(null)   // the entry "start it" would open
  const [keptCount, setKeptCount] = useState(1)
  const [keptFor, setKeptFor] = useState(null)  // the person it went to, or null for you
  const [saving, setSaving] = useState(false)
  // A LIST since 2026-09-17: one gym trip often covers several kinds, and
  // picking them all up front means the model is told about every one of them.
  const [picked, setPicked] = useState([])  // kinds[] rows, plus { key: 'custom:…' }
  const [custom, setCustom] = useState('')
  const [minutes, setMinutes] = useState(45)
  const [goal, setGoal] = useState('')
  const [pres, setPres] = useState(null)
  const [error, setError] = useState(null)

  /*
   * The drafts, and the one this screen has open.
   *
   * A planning run is a model reading their log for tens of seconds, and it now
   * runs on the server under a draft, so this screen only looks: `useDrafts`
   * polls while one is being written, and when the open draft changes STEP (its
   * run ended, or a revision started) `enter` moves the screen to match. A saved
   * edit does not change the step, so it never pulls the editor out from under them.
   */
  /*
   * Whether the model is on offer. The server says no (`ai-not-configured`: a fresh
   * install with no CLI, or someone it is not set up for) and from then on, for
   * the rest of the session (`aiOffered`, lib/plannerapi.js), this screen is the
   * hand-built route alone, with nothing that mentions a model.
   */
  const [aiRefused, setAiRefused] = useState(false)
  const ai = aiOffered(currentMe().features) && !aiRefused
  const { drafts: listed, upsert, drop } = useDrafts(ai)
  /*
   * Kept ONCE. A draft whose id is already on an entry in the log (this device
   * kept it, maybe offline, or another device did and it has synced) is on a
   * day: it is not offered, and its discard is tried again here, because the
   * one fired when it was kept may never have reached the server.
   */
  const placed = useMemo(() => placedDraftIds(entries, target ? theirs.entries : []), [entries, target, theirs.entries])
  const drafts = useMemo(() => unplacedDrafts(listed, placed), [listed, placed])
  useEffect(() => {
    for (const d of listed) {
      if (placed.has(d.id)) { drop(d.id); discardDraft(d.id).catch(() => {}) }
    }
  }, [listed, placed, drop])
  const [notice, setNotice] = useState(null)  // why a keep was refused, said on the first screen
  const [draftId, setDraftId] = useState(null)
  const open = draftId ? drafts.find(d => d.id === draftId) || null : null
  const synced = useRef(null)     // draftKey of what the screen last showed
  const skipSave = useRef(false)  // the plan just came FROM the server; do not send it back
  const [talkError, setTalkError] = useState(null)

  const label = picked.map(k => k.label).join(' + ')
  const primary = picked[0] || null

  const enter = useCallback((d) => {
    synced.current = draftKey(d)
    const at = draftStep(d)
    if (at === 'review') {
      const p = draftPres(d, liftField)
      if (!p) {
        setError('the planner wrote a session with nothing in it — try again')
        return setStep('failed')
      }
      skipSave.current = true
      setPres(p)
      setError(null)
    } else {
      setError(at === 'failed' ? d.error || 'the planner failed' : null)
    }
    setTalkError(null)
    setStep(at)
  }, [liftField])

  useEffect(() => {
    if (open && draftKey(open) !== synced.current) enter(open)
  }, [open, enter])

  /*
   * Their edits on the review screen go onto the draft, so the same draft opened
   * on another device is the one they were editing. Not while a revision is being
   * written: its answer replaces the plan anyway.
   */
  useEffect(() => {
    if (step !== 'review' || !draftId || !pres) return undefined
    if (skipSave.current) { skipSave.current = false; return undefined }
    if (open?.status === 'working') return undefined
    const t = setTimeout(() => { saveDraft(draftId, presForServer(pres)).then(upsert).catch(() => {}) }, 800)
    return () => clearTimeout(t)
  }, [pres]) // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * "Write it for me": a draft on the server, already being written.
   *
   * The FIRST kind the user picked wins where the model leaves the category
   * blank (the server lays the answer on that way, server/drafts.js). With
   * several kinds in one trip there is no single right category — one entry has
   * one — so the first is only a default, and the review screen asks which.
   *
   * Run again from the ask (Redo, Change the ask), the new draft replaces the
   * one it was redoing rather than leaving two of the same workout in the list.
   */
  const run = useCallback(async () => {
    setStep('working')
    setError(null)
    const replacing = draftId
    try {
      const d = await createDraft({
        picked,
        minutes,
        goal: goal.trim(),
        context: plannerContext({ readiness, plan: ctxPlan, entries: ctxEntries, iso }),
        forId: target?.id || null,
      })
      upsert(d)
      synced.current = draftKey(d)
      setDraftId(d.id)
      if (replacing && replacing !== d.id) {
        drop(replacing)
        discardDraft(replacing).catch(() => {})
      }
    } catch (e) {
      // No model here after all: build it by hand, from the same picks.
      if (e.code === 'ai-not-configured') {
        setAiRefused(true)
        return buildRef.current()
      }
      setError(e.message)
      setStep('failed')
    }
  }, [picked, minutes, goal, readiness, ctxPlan, ctxEntries, iso, target, draftId, upsert, drop])

  /** Try a failed draft again; a draft that never got made is simply made. */
  const retry = useCallback(async (d = open) => {
    if (!d || d.status !== 'failed') return run()
    try {
      const next = await retryDraft(d.id)
      upsert(next)
      if (d.id === draftId) enter(next)
    } catch (e) {
      setError(e.message)
    }
  }, [open, run, upsert, draftId, enter])

  /** Reopen a draft from the list, at the step it is on, with what was asked. */
  const resume = (d) => {
    setPicked(d.picked || [])
    setMinutes(d.ask?.minutes || 45)
    setGoal(d.ask?.goal || '')
    setTarget(d.for ? (forPeople.find(p => p.id === d.for.id) || d.for) : null)
    setDraftId(d.id)
    enter(d)
  }

  const discard = (d) => {
    drop(d.id)
    discardDraft(d.id).catch(() => {})
    if (d.id === draftId) setDraftId(null)
  }

  /** A revision on the open draft: the message is on the thread at once, the answer when the run ends. */
  const talk = draftId ? {
    busy: open?.status === 'working',
    error: talkError || (open?.status === 'failed' && open?.run?.kind === 'revise' ? open.error : null),
    failedMessage: open?.status === 'failed' && open?.run?.kind === 'revise' ? open.run.message : null,
    onAsk: async (message) => {
      setTalkError(null)
      try {
        upsert(await reviseDraft(draftId, { message, pres: presForServer(pres) }))
      } catch (e) {
        setTalkError(e.message)
        throw e
      }
    },
  } : null

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
  const buildRef = useRef(build)
  buildRef.current = build

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
  const title = step === 'kept' ? (keptFor ? `On ${keptFor.name}’s day` : 'On your day')
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
  const keep = async () => {
    if (saving) return
    setError(null)
    setSaving(true)
    /*
     * Claimed first, so a draft is kept once: a second device that still shows it
     * is told it was kept and sent back to the list. The draft's id goes on the
     * plan it places, which is what retires it after an offline keep.
     */
    const gate = await keepGate({ draftId, placed, claim: claimDraft })
    if (!gate.go) {
      setSaving(false)
      if (!gate.gone) return setError(gate.error)
      drop(draftId)
      setDraftId(null)
      setNotice(gate.error)
      return setStep('kind')
    }
    const cleaned = { ...dropEmptyBlocks(pres), ...(draftId ? { draftId } : {}) }
    // Kept, the draft has done its job: it goes, and the entry is what remains.
    const done = () => {
      if (!draftId) return
      drop(draftId)
      discardDraft(draftId).catch(() => {})
      setDraftId(null)
    }
    if (target) {
      // Into THEIR log, through the people endpoints. Their day is read first so
      // the ids are the ones their own app would mint. It can fail (offline, their
      // log moved); then nothing is claimed and the editor stays as it was.
      try {
        const kept = await onKeepFor(target, cleaned)
        done()
        setKeptId(kept?.first || null)
        setKeptCount(kept?.count || 1)
        setKeptFor(target)
        setStep('kept')
      } catch (e) {
        if (gate.claimed) claimDraft(draftId, { release: true })
        setError(`Not on ${target.name}’s day: ${e.message}`)
      } finally {
        setSaving(false)
      }
      return
    }
    const kept = onKeep(cleaned)
    done()
    setSaving(false)
    // One planning run can land as several workouts — see splitPrescription.
    setKeptId(kept?.first || null)
    setKeptCount(kept?.count || 1)
    setKeptFor(null)
    setStep('kept')
  }

  /** Round again, from the top, with the last ask cleared. */
  const another = () => {
    setDraftId(null)
    setPres(null)
    setKeptId(null)
    setKeptFor(null)
    setPicked([])
    setCustom('')
    setGoal('')
    setStep('kind')
  }

  const back = () => {
    if (step === 'ask') { setDraftId(null); return setStep('kind') }
    // Backing out of the builder throws away what the user typed, so it goes back to
    // the kinds rather than to a screen the user did not come from.
    if (step === 'build') return setStep('kind')
    // To the first screen, where the drafts are: a failure there is one tap from
    // its retry or its bin, and a full list (429) is one tap from making room.
    if (step === 'failed') { setDraftId(null); return setStep('kind') }
    // Leaving the wait cancels nothing: the draft carries on, and is listed on the
    // first screen, which is where this goes.
    if (step === 'working') { setDraftId(null); return setStep('kind') }
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
      {step === 'kind' && notice && <p className="withrow-err plan-keep-err">{notice}</p>}
      {step === 'kind' && (
        <DraftList drafts={drafts} onOpen={(d) => { setNotice(null); resume(d) }} onRetry={retry} onDiscard={discard} />
      )}
      {step === 'kind' && <ForChoice people={forPeople} target={target} onTarget={setTarget} />}
      {step !== 'kind' && step !== 'kept' && <ForLine person={target} people={forPeople} />}

      {step === 'kind' && target && !theirs.ready && (
        <p className="sub plan-for-wait">
          {theirs.error ? `Could not open ${target.name}’s log: ${theirs.error}` : `Opening ${target.name}’s log…`}
        </p>
      )}

      {step === 'kind' && (!target || theirs.ready) && (
        <KindStep plan={plan} custom={custom} setCustom={setCustom}
          picked={picked} setPicked={setPicked} ai={ai}
          onNext={() => { setNotice(null); setStep('ask') }} onBuild={build} />
      )}

      {step === 'ask' && (
        <AskStep picked={picked} minutes={minutes} setMinutes={setMinutes}
          goal={goal} setGoal={setGoal} chips={minuteChips}
          placeholder={plan?.plannerKinds?.goalPlaceholder}
          evicts={draftId ? null : draftToEvict(drafts)}
          onGo={run} />
      )}

      {step === 'working' && (
        <Working label={label} minutes={minutes} since={open?.run?.startedAt || null}
          onDiscard={open ? () => { discard(open); setStep('kind') } : null} />
      )}

      {step === 'failed' && (
        <div className="plan-failed">
          <p className="plan-failed-lead">
            <Icon name="TriangleAlert" size={16} /> {error}
          </p>
          <p className="sub">Nothing was written.</p>
          <div className="plan-actions fork">
            <button className="btn" onClick={() => retry()}><Icon name="RotateCw" size={16} /> Try again</button>
            {/* Not a dead end. The box being busy is no reason not to plan the
                session — it is only a reason to write it yourself. */}
            <button className="btn secondary" onClick={build}>
              <Icon name="ListPlus" size={16} /> Build it myself
            </button>
            <button className="btn ghost" onClick={() => setStep('ask')}>Change the ask</button>
            {!open && drafts.length > 0 && (
              <button className="btn ghost" onClick={back}>See your drafts</button>
            )}
          </div>
        </div>
      )}

      {(step === 'build' || step === 'review') && error && <p className="withrow-err plan-keep-err">{error}</p>}

      {step === 'build' && pres && (
        <BuildStep pres={pres} setPres={setPres} liftField={liftField} entries={ctxEntries}
          categories={ctxPlan?.quotaCategories || []}
          onKeep={saving ? () => {} : keep} forName={target?.name || null} />
      )}

      {step === 'review' && pres && (
        <ReviewStep pres={pres} setPres={setPres} liftField={liftField} entries={ctxEntries}
          categories={ctxPlan?.quotaCategories || []}
          onRedo={() => setStep('ask')} talk={talk}
          onKeep={saving || talk?.busy ? () => {} : keep} forId={target?.id || null} forName={target?.name || null} />
      )}

      {step === 'kept' && pres && (
        <KeptStep pres={pres} count={keptCount} parts={splitPrescription(pres)} forName={keptFor?.name || null}
          onStart={!keptId ? null : keptFor ? (onStartFor ? () => onStartFor(keptFor, keptId) : null) : () => onStart(keptId)}
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

export function KindStep({ plan, custom, setCustom, picked, setPicked, onNext, onBuild, ai = aiOffered(currentMe().features) }) {
  const groups = groupedKinds(plan)
  const at = (k) => picked.findIndex(p => p.key === k.key)
  const has = (k) => at(k) >= 0
  const toggle = (k) =>
    setPicked(has(k) ? picked.filter(p => p.key !== k.key) : [...picked, k])

  const addCustom = () => {
    const label = custom.trim()
    if (!label) return
    const key = `custom:${label.toLowerCase()}`
    if (!picked.some(p => p.key === key)) setPicked([...picked, { key, label, prompt: label }])
    setCustom('')
  }
  const customs = picked.filter(p => p.key.startsWith('custom:'))

  /*
   * No paragraph (docs/DESIGN.md D7): the rows are toggles with a check, and the
   * check carries the ORDER the user tapped them in, because the planner writes
   * the blocks in that order — which one came first is a fact about the session.
   */
  return (
    <>
      {groups.map(g => <KindGroup key={g.key} group={g} at={at} toggle={toggle} />)}

      <section className="kindgroup" aria-label="Something else">
        <div className="section-head"><h3>Something else</h3></div>
        {customs.length > 0 && (
          <div className="card kindlist list">
            {customs.map(k => <KindRow key={k.key} k={k} n={at(k) + 1} onToggle={() => toggle(k)} />)}
          </div>
        )}
        <div className="kindcustom-row">
          <input id="plan-custom" value={custom} onChange={e => setCustom(e.target.value)}
            aria-label="Something else" placeholder="A shoulder day, a 40 minute erg, a hike"
            onKeyDown={e => { if (e.key === 'Enter') addCustom() }} />
          <button className="btn secondary" disabled={!custom.trim()} onClick={addCustom}>Add</button>
        </div>
      </section>

      {/*
        * THE FORK, and it lives here rather than on a screen of its own: what the
        * user is doing is the same question whoever writes it down. It appears once
        * something is picked, because until then neither button can do anything.
        *
        * With the model on offer, it is the primary (it is the one that goes and does
        * something) and building it yourself is the secondary beside it. Without it
        * (lib/whoami.js; the server's `ai-not-configured`), building it yourself is
        * the only button and the primary, and nothing on the screen mentions a model.
        */}
      {picked.length > 0 && (
        <div className="plan-actions sticky fork">
          {ai && (
            <button className="btn big" onClick={onNext}>
              <Icon name="Sparkles" size={17} />
              Write it for me
            </button>
          )}
          <button className={`btn big ${ai ? 'secondary' : ''}`} onClick={onBuild}>
            <Icon name="ListPlus" size={17} />
            Build it myself
          </button>
        </div>
      )}
    </>
  )
}

/** One kind as a row: its icon, its name, the one line that says what it is, and the check. */
function KindRow({ k, n, onToggle }) {
  const on = n > 0
  return (
    <button className={`list-row kindrow ${on ? 'on' : ''}`} onClick={onToggle} aria-pressed={on}>
      <Icon name={k.icon || 'Dumbbell'} size={20} />
      <span className="list-row-main">
        <span className="list-row-title">{k.label}</span>
        {k.hint && <span className="list-row-meta">{k.hint}</span>}
      </span>
      <span className="kindrow-check" aria-hidden="true">{on ? n : ''}</span>
    </button>
  )
}

/**
 * One group: a section head over one card of rows.
 *
 * A group may declare `collapsed: true` in content, and then it renders as a
 * native `<details>`: the head with a count, the rows one tap away. This arrived
 * with the endurance catalog on 2026-09-19 — thirty-odd swim, bike and run
 * variants — and thirty rows of ride variants between the zone-2 kinds and the
 * climbing section would have buried both.
 *
 * `<details>` rather than state, for two reasons. Every row is still IN the page
 * — the reachability test in smoke.jsx reads the rendered HTML, and a kind that is
 * only mounted when a group is open is a kind that test cannot see. And it costs
 * nothing on the server render. A group with something picked in it is forced
 * open, so what the user chose is never hidden behind its own header.
 *
 * The groups' `blurb` paragraphs are content and stay in the file; the screen no
 * longer prints them (D7: if a control needs a paragraph, change the control).
 */
function KindGroup({ group: g, at, toggle }) {
  const picked = g.items.filter(k => at(k) >= 0).length
  const rows = (
    <div className="card kindlist list">
      {g.items.map(k => <KindRow key={k.key} k={k} n={at(k) + 1} onToggle={() => toggle(k)} />)}
    </div>
  )

  if (!g.collapsed) {
    return (
      <section className="kindgroup" aria-label={g.name}>
        <div className="section-head"><h3>{g.name}</h3></div>
        {rows}
      </section>
    )
  }

  return (
    <details className="kindgroup folded" open={picked > 0 || undefined}>
      <summary className="section-head">
        <h3>{g.name}</h3>
        <span className="sub">{picked ? `${picked} picked · ` : ''}{g.items.length}</span>
        <Icon name="ChevronDown" size={16} className="kindgroup-chev" />
      </summary>
      {rows}
    </details>
  )
}

/* ------------------------------------------------- step: how long, what for */

function AskStep({ picked, minutes, setMinutes, goal, setGoal, chips, placeholder, onGo, evicts = null }) {
  const many = picked.length > 1
  return (
    <>
      <section className="askblock">
        <div className="section-head"><h3>How long{many ? ', altogether' : ''}?</h3></div>
        <div className="chiprow">
          {chips.map(m => (
            <button key={m} className={`out-chip ${minutes === m ? 'on' : ''}`}
              onClick={() => setMinutes(m)} aria-pressed={minutes === m}>
              {m} min
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
      </section>

      <section className="askblock">
        <div className="section-head"><h3>What do you want out of it?</h3><span className="sub">Optional</span></div>
        <textarea className="goalbox" rows={3} value={goal} onChange={e => setGoal(e.target.value)}
          aria-label="What do you want out of it?"
          placeholder={placeholder || 'A niggle, a deadline, how you feel'} />
      </section>

      {/* At the cap, the oldest draft not being written makes room. Said before, not after. */}
      {evicts && (
        <p className="sub plan-evicts">
          <Icon name="Info" size={14} /> Replaces your oldest draft, {draftTitle(evicts)}
        </p>
      )}

      <div className="plan-actions sticky">
        <button className="btn big" onClick={onGo}>
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

/*
 * `since` is when the draft's run started, so a draft reopened half way through
 * counts from where it is rather than from zero. Leaving cancels nothing (the run
 * is the draft's, on the server) and the screen says so, because the old promise
 * that it did was the reason to stand and watch it.
 */
export function Working({ label, minutes, since = null, onDiscard = null }) {
  const from = useMemo(() => (since ? Date.parse(since) : Date.now()), [since])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [])
  const secs = Math.max(0, Math.round((now - from) / 1000))
  const stage = WORKING_STAGES[Math.min(WORKING_STAGES.length - 1, Math.floor(secs / 12))]

  return (
    <div className="plan-working">
      <span className="plan-working-ico"><Icon name="Sparkles" size={28} /></span>
      <div className="plan-working-title">Building {minutes} minutes of {label.toLowerCase()}</div>
      <p className="plan-working-stage">{stage}</p>
      <div className="plan-working-dots"><i /><i /><i /></div>
      <p className="sub">{secs}s · You can leave; it keeps going</p>
      {onDiscard && (
        <button className="btn quiet plan-working-stop" onClick={onDiscard}>Stop and throw it away</button>
      )}
    </div>
  )
}

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
export function PlanTalk({ pres, onChange, compact = false, forId = null, draft = null }) {
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
export function BuildStep({ pres, setPres, liftField, entries = [], categories = [], onKeep, forName = null }) {
  const sets = prescriptionSteps(pres).length

  return (
    <>
      <SplitNote parts={splitPrescription(dropEmptyBlocks(pres))} />

      <PrescriptionEditor pres={pres} onChange={setPres} liftField={liftField} entries={entries}
        categories={categories} onAddPiece={
          (blockId, name, by, unit) => setPres(appendPiece(pres, name, { blockId, by, unit }))
        } />

      <div className="plan-actions sticky">
        <button className="btn big" disabled={!sets} onClick={onKeep}>
          <Icon name="Plus" size={17} /> {forName ? `Put it on ${forName}’s day` : 'Put it on today'}
        </button>
      </div>

      {!sets && <p className="sub plan-fine">Add an exercise or an interval to keep it</p>}
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
        <Icon name="Timer" size={15} /> <span>Add a swim set, interval or hold</span>
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

function ReviewStep({ pres, setPres, liftField, entries = [], categories = [], onRedo, onKeep, forId = null, forName = null, talk = null }) {
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
        Written from {forName ? `${forName}’s log` : 'your log'}. Change anything before you keep it.
      </p>

      <div className="plan-actions sticky">
        <button className="btn ghost" onClick={onRedo}><Icon name="RotateCw" size={16} /> Redo</button>
        <button className="btn big" onClick={onKeep} disabled={Boolean(talk?.busy)}>
          <Icon name="Plus" size={17} /> {forName ? `Put it on ${forName}’s day` : 'Put it on today'}
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

/**
 * Which category a BLOCK is — and therefore where the session SPLITS.
 *
 * Each workout in the session has its own category, not the session as a whole:
 * a run and a lift land as two entries, each with its own log and its own place
 * for the watch to attach to. (Until 2026-10-25 this was also which weekly quota
 * the block filled; the quotas are gone, the split stays.)
 *
 * `none` is a real answer and the default for a warm-up: a block that is not a
 * workout in its own right belongs to the one beside it.
 */
function BlockQuota({ categories, value, onChange }) {
  if (!categories.length) return null
  const picked = categories.find(c => c.key === value) || null
  return (
    <details className="blockquota">
      <summary>
        <Icon name="Target" size={12} />
        <span>
          {picked ? <>A separate <strong>{picked.name}</strong> workout</> : 'Part of the workout beside it'}
        </span>
      </summary>
      <div className="blockquota-chips">
        <button className={`implchip ${!value ? 'on' : ''}`}
          onClick={() => onChange(null)} aria-pressed={!value}>
          Part of the workout beside it
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
export function KeptStep({ pres, count = 1, parts = [], onStart, onAnother, onDone, forName = null }) {
  const many = count > 1
  const where = forName ? `on ${forName}’s day` : 'on today'
  return (
    <div className="kept">
      <span className="kept-ico"><Icon name="CircleCheck" size={44} /></span>
      <h2>{many ? `${count} workouts are ${where}` : `${pres.title} is ${where}`}</h2>

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
        {forName ? `Nothing has started. ${forName} can edit or log it.` : 'Nothing has started.'}
      </p>

      <div className="kept-acts">
        {onStart && (
          <button className="btn big" onClick={onStart}>
            <Icon name="Play" size={18} /> {forName ? `Open it on ${forName}’s side` : many ? 'Start the first one' : 'Start it now'}
          </button>
        )}
        <button className={`btn ${onStart ? 'secondary' : ''}`} onClick={onAnother}>
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
