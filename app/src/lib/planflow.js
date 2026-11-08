/*
 * Plan a workout, as state (issue #78): one reducer and one hook that the web's
 * `PlanFlow` (app/src/planner.jsx) and the phone's (mobile/src/features/planner.tsx)
 * both run, so each platform keeps only its view.
 *
 * The steps: `start` (Write it for me: one box), `working`, `review`, `failed`,
 * `build` (the hand-built route: the editor, which can start empty) and `kept`.
 * With the model on offer the flow opens on `start`; without it, on `build`.
 *
 * Invariants kept here, so neither view can lose them:
 * - Nothing reaches the log until the keep tap (AGENTS.md §0.4). The model's
 *   answer is a draft on the server; keeping it goes through the app's own write
 *   paths (`onKeep`, `onKeepFor`, `onShareWith`).
 * - A plan lands on `date`: the day Today is showing, or a later one the user
 *   picks; never an earlier one (Log a workout is the door for what was done).
 *   Whether it reads as done is the store's rule (AGENTS.md §4, D10), not ours.
 * - A hand-built workout survives Back: it is set aside (`scratch`) and reopened
 *   by "Build it myself"; only closing the planner throws it away, and that asks.
 */

import { useCallback, useEffect, useMemo, useReducer } from 'react'
import { localIso, isoShift, dayWords } from './dates.js'
import { currentMe } from './whoami.js'
import { liftFieldOf } from './lifts.js'
import { activityOf, pinnedActivities, groupedActivities } from './activities.js'
import { useWhoop, readinessFor } from './whoop.jsx'
import {
  plannerContext, groupContext, aiOffered, createDraft, reviseDraft, retryDraft, saveDraft, discardDraft, claimDraft,
} from './plannerapi.js'
import {
  useDrafts, draftKey, draftStep, draftPres, presForServer, placedDraftIds, unplacedDrafts, keepGate,
} from './drafts.js'
import { blankPrescription, dropEmptyBlocks, circuitFiling } from './prescription.js'
import {
  FOR_ME, forOf, forWords, whoOfDraft, isGroup, namesOf, keepForEach, keepKeyFor, withoutLoads, forSomeoneElse,
} from './trainer.js'

export const DEFAULT_MINUTES = [20, 30, 45, 60, 75, 90]

/* ------------------------------------------------------------------ days */

/**
 * The day a plan lands on when the flow opens: the day Today is showing if that
 * is today or later, else today. Planning is for a session still to come; a past
 * day's workout is logged, not planned.
 */
export const planDay = (viewDay, today = localIso()) => (viewDay && viewDay > today ? viewDay : today)

/** The day in the words a sentence takes: "today", "tomorrow", "Sat, Oct 24". */
export function dayPhrase(date, today = localIso()) {
  const w = dayWords(date || today, today)
  return w === 'Today' || w === 'Tomorrow' ? w.toLowerCase() : w
}

/** The day stepper's bounds: today at the earliest, a year out at the latest. */
export const dayBounds = (today = localIso()) => ({ min: today, max: isoShift(today, 365) })

/* ----------------------------------------------------------------- shapes */

/** Anything the user put in it: an exercise, a piece or a block note. */
export const hasWork = (pres) => (pres?.blocks || []).some(b => (b.items || []).length > 0 || Boolean(b.note))

const kindLabel = (picked) => picked.map(k => k.label).join(' + ')

/**
 * The hand-built workout before anything is in it: one block per kind picked, in
 * the order tapped, each carrying that kind's category and sport (the seam is the
 * block, not the author, so "Legs + a ride" lands as two entries either way). No
 * kind is needed: with none it is one block, and the name comes from what goes in.
 */
export function blankFor(picked = [], at = undefined) {
  const primary = picked[0] || null
  return blankPrescription({
    title: kindLabel(picked) || 'Workout',
    category: primary?.category || null,
    activity: primary?.activity || null,
    blocks: picked.map(k => ({ name: k.label, category: k.category || null, activity: k.activity || null })),
    ...(at ? { at } : {}),
  })
}

/**
 * A name for a workout built by hand with no kind picked, from what is in it:
 * the exercises' groups ("Quads", "Quads and chest", "Quads, chest and more"),
 * else the first piece ("Easy spin"), else "Workout". A title anyone gave it is
 * kept as it is.
 */
export function workTitle(pres) {
  if (pres?.title && pres.title !== 'Workout') return pres.title
  const items = (pres?.blocks || []).flatMap(b => b.items || [])
  const groups = [...new Set(items.filter(i => i.kind === 'lift' && i.group).map(i => i.group))]
  if (groups.length) {
    const [a, b] = groups
    const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1)
    if (groups.length === 1) return a
    if (groups.length === 2) return `${a} and ${lower(b)}`
    return `${a}, ${lower(b)} and more`
  }
  const first = items.find(i => i.name)
  if (first) return first.name
  return 'Workout'
}

/** The activity catalog field (`type: "activity"`) the content declares, or null. */
export function activityFieldIn(plan) {
  for (const opt of plan?.dailyMenu || []) {
    const f = (opt.outputs || []).find(o => o.type === 'activity')
    if (f) return f
  }
  return null
}

/**
 * Where a workout is filed when nothing on it names a category, so it still
 * counts in Log and Progress (#78). In order:
 * - a block's (or the plan's) activity, filed by the catalog;
 * - its lifts, by the rule a circuit from the timer already uses
 *   (`circuitFiling`: the category named for their commonest group, else the
 *   content's lifting activity);
 * - `chosen`, the activity the user picked on the keep step ("What is it?").
 * A workout that names a category anywhere is left exactly as it is, and so is
 * one where none of these says anything.
 */
export function filedFor(pres, plan, liftField, chosen = null) {
  if (!pres || pres.category || (pres.blocks || []).some(b => b.category)) return pres
  const field = activityFieldIn(plan)
  const byActivity = (key) => {
    const a = activityOf(field, key)
    return a ? { category: a.category || null, activity: a.key } : null
  }
  let f = byActivity((pres.blocks || []).map(b => b.activity).find(Boolean) || pres.activity)
  if (!f) {
    const lifts = (pres.blocks || []).flatMap(b => b.items || []).filter(i => i.kind === 'lift' && i.exercise)
    if (lifts.length) {
      f = circuitFiling({ exercises: lifts.map(i => ({ key: i.exercise })) }, liftField,
        { categories: plan?.quotaCategories || [], activities: field?.activities || [] })
    }
  }
  if (!f?.category && !f?.activity && chosen) f = byActivity(chosen)
  return f && (f.category || f.activity) ? { ...pres, category: f.category || null, activity: f.activity || null } : pres
}

/**
 * Nothing on it says what it is: the keep step asks, once, in one row
 * (`fileChoices`). Asked exactly where `filedFor` would use the answer: a
 * category on the plan or on any block files it already (a model's Lift block
 * beside its Run block), and a question whose answer is thrown away is a dead
 * control (C N6).
 */
export function needsFiling(pres, plan, liftField) {
  if (!hasWork(pres)) return false
  if (pres.category || (pres.blocks || []).some(b => b.category)) return false
  const f = filedFor(pres, plan, liftField)
  return !f.category && !f.activity
}

/**
 * "What is it?": the catalog's pinned sports as chips, the rest of the catalog,
 * grouped, behind "Other…". Content, so the row is the owner's own six sports.
 */
export function fileChoices(plan) {
  const field = activityFieldIn(plan)
  const pinned = pinnedActivities(field)
  const shown = new Set(pinned.map(a => a.key))
  return {
    pinned,
    groups: groupedActivities(field)
      .map(g => ({ name: g.name, items: g.items.filter(a => !shown.has(a.key)) }))
      .filter(g => g.items.length),
    nameOf: (key) => activityOf(field, key)?.name || null,
  }
}

/** The header's one line: "5 exercises · about 50 min". Short, so it never wraps. */
export function shortLine(pres) {
  if (!pres) return ''
  const items = (pres.blocks || []).reduce((n, b) => n + (b.items || []).length, 0)
  const lifting = (pres.blocks || []).some(b => b.circuit || (b.items || []).some(i => i.kind === 'lift'))
  const word = lifting ? 'exercise' : 'piece'
  return [
    items ? `${items} ${word}${items === 1 ? '' : 's'}` : null,
    pres.minutes ? `about ${pres.minutes} min` : null,
  ].filter(Boolean).join(' · ')
}

/* ------------------------------------------------------------------ state */

/**
 * `ai` is whether the model is on offer now (the server's `features.ai`, less a
 * refusal since). `date` is where a kept plan lands. `scratch` is a hand-built
 * workout set aside by Back. `kept` is the last screen's facts. `presFrom` says
 * whether the plan on screen just came from the server (then it is not saved back).
 */
export function initialFlow({ ai = false, date = localIso(), minutes = 45 } = {}) {
  return {
    ai, step: ai ? 'start' : 'build',
    who: FOR_ME, date, picked: [], minutes, goal: '',
    pres: ai ? null : blankFor([]), presFrom: 'you', scratch: null,
    error: null, notice: null, talkError: null,
    draftId: null, synced: null,
    saving: false, kept: null,
    filing: null,  // the activity picked on "What is it?", for a workout nothing else files
  }
}

export const firstStep = (state) => (state.ai ? 'start' : 'build')

/** A draft opened (or changed step under the screen): the step it is on, and its plan. */
function entered(state, draft, liftField) {
  const at = draftStep(draft)
  const base = { ...state, synced: draftKey(draft), talkError: null }
  if (at === 'review') {
    const pres = draftPres(draft, liftField)
    if (!pres) return { ...base, step: 'failed', error: 'the planner wrote a session with nothing in it — try again' }
    return { ...base, step: 'review', pres, presFrom: 'server', error: null }
  }
  return { ...base, step: at, error: at === 'failed' ? draft.error || 'the planner failed' : null }
}

/** To the builder: what was set aside, else a blank from the kinds picked. */
function toBuild(state) {
  const pres = state.scratch || blankFor(state.picked)
  return { ...state, step: 'build', pres, presFrom: 'you', scratch: null, error: null }
}

export function flowReducer(state, a) {
  switch (a.type) {
    case 'who': return { ...state, who: a.who }
    case 'date': return { ...state, date: a.date }
    case 'goal': return { ...state, goal: a.goal }
    case 'minutes': return { ...state, minutes: a.minutes }
    case 'notice': return { ...state, notice: a.notice }
    case 'filing': return { ...state, filing: a.filing }
    case 'talkError': return { ...state, talkError: a.error }
    case 'error': return { ...state, error: a.error }
    /*
     * Kinds. In the builder they are where it starts from, so while it is still
     * empty the blocks follow the picks; once something is in it, the blocks are
     * the user's and a pick changes nothing there.
     */
    case 'picked': {
      const next = { ...state, picked: a.picked }
      if (state.step === 'build' && !hasWork(state.pres)) return { ...next, pres: blankFor(a.picked), presFrom: 'you' }
      return next
    }
    case 'pres': return { ...state, pres: a.pres, presFrom: 'you' }
    case 'build': return toBuild(state)
    // The server has no model for this person after all: the hand-built route, from the same picks.
    case 'refused': return toBuild({ ...state, ai: false })
    case 'run': return { ...state, step: 'working', error: null }
    case 'drafted': return { ...state, draftId: a.draft.id, synced: draftKey(a.draft) }
    case 'failed': return { ...state, step: 'failed', error: a.error }
    case 'enter': return entered(state, a.draft, a.liftField)
    case 'resume': return entered({
      ...state,
      picked: a.draft.picked || [],
      minutes: a.draft.ask?.minutes || 45,
      goal: a.draft.ask?.goal || '',
      who: whoOfDraft(a.draft, a.people || []),
      // The day it was asked for, if that has not passed (`planDay`); else the one already chosen.
      date: a.draft.ask?.day ? planDay(a.draft.ask.day, a.today || localIso()) : state.date,
      draftId: a.draft.id,
      notice: null,
    }, a.draft, a.liftField)
    case 'discarded': return a.id === state.draftId ? { ...state, draftId: null } : state
    // Redo, Change the ask: the open draft stays open, so the next run replaces it rather than adding one.
    case 'toFirst': return { ...state, step: firstStep(state) }
    case 'keeping': return { ...state, saving: true, error: null }
    case 'keepFailed': return { ...state, saving: false, error: a.error }
    case 'keepGone': return { ...state, saving: false, draftId: null, notice: a.notice, step: firstStep(state) }
    // The last screen shows the plan as it was placed: named, filed, empty blocks gone.
    case 'kept': return {
      ...state, saving: false, step: 'kept', pres: a.pres || state.pres,
      draftId: a.retryPlan ? state.draftId : null,
      kept: {
        id: a.kept?.first || null, count: a.kept?.count || 1, who: a.who, failed: a.failed || [],
        plan: a.retryPlan || null, key: a.key || null, date: state.date,
      },
    }
    case 'retrying': return { ...state, saving: true }
    case 'retried': {
      const k = state.kept
      const got = new Set([...k.who.others, ...a.r.landed].map(p => p.id))
      const first = !k.id && a.r.first ? a.r.first : null
      const done = !a.r.failed.length
      return {
        ...state, saving: false, draftId: done ? null : state.draftId,
        kept: {
          ...k,
          who: { me: false, others: state.who.others.filter(p => got.has(p.id)) },
          failed: a.r.failed,
          id: first ? first.first || null : k.id,
          count: first ? first.count || 1 : k.count,
          plan: done ? null : k.plan,
        },
      }
    }
    // Round again, from the top: the ask cleared; who, when and a workout set aside kept.
    case 'another': return {
      ...initialFlow({ ai: state.ai, date: state.date, minutes: state.minutes }), who: state.who, scratch: state.scratch,
    }
    case 'back': {
      const b = backOf(state)
      if (b.close) return state
      return { ...state, step: b.to, scratch: b.scratch !== undefined ? b.scratch : state.scratch, draftId: b.clearDraft ? null : state.draftId }
    }
    default: return state
  }
}

/** A hand-built workout with work in it that is not on a day yet: on screen, or set aside. */
export const unkeptWork = (state) =>
  (state.step === 'build' && hasWork(state.pres)) || hasWork(state.scratch)

/**
 * What Back does from where the user is.
 * - The builder, reached from the ask: back to the ask, the workout set aside so
 *   "Back to your workout" reopens it as it was (G-visual-ia F6).
 * - The wait and a failure: to the first screen, where the drafts are; leaving the
 *   wait cancels nothing, the draft carries on.
 * - Anywhere else it closes the planner. A review is a draft on the server and
 *   survives that; a hand-built workout does not, so any close that would lose
 *   one, on screen or set aside, asks first (`confirm`).
 */
export function backOf(state) {
  const first = firstStep(state)
  if (state.step === 'build' && first !== 'build') return { to: first, scratch: hasWork(state.pres) ? state.pres : null }
  if (state.step === 'failed' || state.step === 'working') return { to: first, clearDraft: true }
  return { close: true, confirm: unkeptWork(state) }
}

/**
 * Every way out of the planner (Back, Back to today, Start it now) goes through
 * this: a hand-built workout not on a day yet (`unkeptWork`) is never lost
 * without `confirmDiscard` saying so. `go` runs only if it may.
 */
export const leaver = (state, confirmDiscard = () => true) => async (go) => {
  if (unkeptWork(state) && !(await confirmDiscard('Throw away the workout you were building?'))) return undefined
  return go()
}

/**
 * The last screen's Start: `{ run, label }` or null. Null on a later day (there is
 * nothing to start now) and where there is nowhere to open it. It leaves the
 * planner, so it goes through `leave`, the same confirm as every other way out
 * (a workout set aside is never lost without asking).
 */
export function keptStart(kept, today, { onStart = null, onStartFor = null, leave = (go) => go() } = {}) {
  if (!kept?.id || kept.date > today) return null
  if (kept.who.me) return onStart ? { run: () => leave(() => onStart(kept.id)), label: null } : null
  const person = forSomeoneElse(kept.who)
  if (!person || !onStartFor) return null
  return { run: () => leave(() => onStartFor(person, kept.id)), label: `Open it on ${person.name}’s side` }
}

/** The screen's title. */
export function flowTitle(state, plan = null, today = localIso()) {
  const { step, pres, picked } = state
  if (step === 'kept') return forWords(state.kept?.who || FOR_ME, dayPhrase(state.kept?.date, today)).title
  if (step === 'review') return pres?.title || 'Your workout'
  if (step === 'build') return workTitle(pres)
  if (step === 'start') return 'Plan a workout'
  /*
   * The wait and a failure say what was asked. The discipline goes in front only
   * when every pick is in the same group: "Climbing · Legs + Power endurance"
   * would be a lie about the first half.
   */
  const label = kindLabel(picked)
  if (!label) return 'Plan a workout'
  const groups = plan?.plannerKinds?.groups || []
  const oneGroup = picked.every(k => k.group && k.group === picked[0].group)
  const groupName = oneGroup ? groups.find(g => g.key === picked[0].group)?.name : null
  return [groupName, label].filter(Boolean).join(' · ')
}

/* ------------------------------------------------------------------- hook */

/**
 * The whole flow for one platform's view. `usePeopleLogs` is the platform's own
 * hook (features/trainer), passed in so the lib does not import a view file.
 * `confirmDiscard(message)` returns (or resolves to) true to throw a hand-built
 * workout away; the web passes `window.confirm`, the phone its system alert.
 */
export function usePlanFlow({
  plan, entries = [], iso, date = null, people = [], usePeopleLogs,
  onKeep, onKeepFor = null, onShareWith = null, onClose, onStart = null, onStartFor = null, confirmDiscard = () => true,
}) {
  const today = iso || localIso()
  const liftField = useMemo(() => liftFieldOf(plan), [plan])
  const [state, dispatch] = useReducer(flowReducer, null,
    () => initialFlow({ ai: aiOffered(currentMe().features), date: planDay(date, today) }))
  // A refusal anywhere since the app started counts here too (lib/plannerapi.js).
  const ai = state.ai && aiOffered(currentMe().features)
  const flow = ai === state.ai ? state : { ...state, ai }

  // Who it is for. Only offered with somewhere to keep it.
  const forPeople = onKeepFor && onShareWith ? people : []
  const { who } = flow
  const group = isGroup(who)
  const otherIds = who.others.map(p => p.id)
  const theirs = usePeopleLogs(otherIds)
  const logOf = (id) => (id && theirs.logs[id]) || { entries: [], plan: null }
  // "Last time" and categories: the owner's when the owner is in it, else the first person's.
  const ctxPlan = who.me ? plan : (logOf(otherIds[0]).plan || plan)
  const ctxEntries = who.me ? entries : logOf(otherIds[0]).entries

  /*
   * WHOOP is read here, inside the provider, because App mounts above it and
   * would silently get "no data". It is the owner's: someone else's plan is told
   * nothing about recovery, exactly as on an install without it (§7).
   */
  const { cache: whoopCache } = useWhoop()
  const readiness = useMemo(() => (who.me ? readinessFor(whoopCache, today) : null), [whoopCache, today, who.me])

  const { drafts: listed, upsert, drop } = useDrafts(ai)
  /*
   * Kept ONCE. A draft whose id is already on an entry (kept here, maybe offline,
   * or on another device and synced) is on a day: it is not offered, and its
   * discard is tried again, because the first may never have reached the server.
   */
  const placed = useMemo(() => placedDraftIds(entries, ...Object.values(theirs.logs).map(l => l.entries)), [entries, theirs.logs])
  const drafts = useMemo(() => unplacedDrafts(listed, placed), [listed, placed])
  useEffect(() => {
    for (const d of listed) if (placed.has(d.id)) { drop(d.id); discardDraft(d.id).catch(() => {}) }
  }, [listed, placed, drop])
  const open = flow.draftId ? drafts.find(d => d.id === flow.draftId) || null : null

  // The open draft changed STEP under the screen (its run ended, a revision started): follow it.
  useEffect(() => {
    if (open && draftKey(open) !== flow.synced) dispatch({ type: 'enter', draft: open, liftField })
  }, [open, flow.synced, liftField])

  // Edits on the review go onto the draft, so another device opens them too; not while a revision runs.
  useEffect(() => {
    if (flow.step !== 'review' || !flow.draftId || !flow.pres || flow.presFrom === 'server') return undefined
    if (open?.status === 'working') return undefined
    const t = setTimeout(() => { saveDraft(flow.draftId, presForServer(flow.pres)).then(upsert).catch(() => {}) }, 800)
    return () => clearTimeout(t)
  }, [flow.pres]) // eslint-disable-line react-hooks/exhaustive-deps

  const ownerId = currentMe().real?.id || 'owner'
  const phrase = dayPhrase(flow.date, today)
  const words = forWords(who, phrase)

  /*
   * "Write it for me": a draft on the server, already being written. Several
   * people: each one's last week under their name, from their own log, and only
   * the owner's WHOOP. Run again from the ask, the new draft replaces the old.
   */
  const run = async () => {
    dispatch({ type: 'run' })
    const replacing = flow.draftId
    const day = flow.date
    const context = group
      ? groupContext({ iso: today, day, people: [
          ...(who.me ? [{ name: currentMe().real?.name || 'You', readiness, plan, entries }] : []),
          ...who.others.map(p => ({ name: p.name, plan: logOf(p.id).plan || plan, entries: logOf(p.id).entries })),
        ] })
      : plannerContext({ readiness, plan: ctxPlan, entries: ctxEntries, iso: today, day })
    try {
      const d = await createDraft({ picked: flow.picked, minutes: flow.minutes, goal: flow.goal.trim(), context, forId: forOf(who, ownerId), day })
      upsert(d)
      dispatch({ type: 'drafted', draft: d })
      if (replacing && replacing !== d.id) { drop(replacing); discardDraft(replacing).catch(() => {}) }
    } catch (e) {
      if (e.code === 'ai-not-configured') return dispatch({ type: 'refused' })
      dispatch({ type: 'failed', error: e.message })
    }
  }

  /** Try a failed draft again; a draft that never got made is simply made. */
  const retry = async (d = open) => {
    if (!d || d.status !== 'failed') return run()
    try {
      const next = await retryDraft(d.id)
      upsert(next)
      if (d.id === flow.draftId) dispatch({ type: 'enter', draft: next, liftField })
    } catch (e) {
      dispatch({ type: 'error', error: e.message })
    }
  }

  const resume = (d) => dispatch({ type: 'resume', draft: d, people: forPeople, liftField, today })
  const discard = (d) => {
    drop(d.id)
    discardDraft(d.id).catch(() => {})
    dispatch({ type: 'discarded', id: d.id })
  }

  /** A revision on the open draft: its message is on the thread at once, the answer when the run ends. */
  const talk = flow.draftId ? {
    busy: open?.status === 'working',
    error: flow.talkError || (open?.status === 'failed' && open?.run?.kind === 'revise' ? open.error : null),
    failedMessage: open?.status === 'failed' && open?.run?.kind === 'revise' ? open.run.message : null,
    onAsk: async (message) => {
      dispatch({ type: 'talkError', error: null })
      try {
        upsert(await reviseDraft(flow.draftId, { message, pres: presForServer(flow.pres) }))
      } catch (e) {
        dispatch({ type: 'talkError', error: e.message })
        throw e
      }
    },
  } : null

  const finishDraft = (id) => {
    if (!id) return
    drop(id)
    discardDraft(id).catch(() => {})
  }

  /**
   * Keep it, and stop there: starting it is the next screen's question. A draft
   * is claimed first, so it is kept once, and its id goes on the plan it places,
   * which is what retires it after an offline keep. `dropEmptyBlocks`: a picked
   * block never filled in must not land on the day as an entry with no work in it.
   */
  const keep = async () => {
    if (flow.saving) return
    const { draftId, date: day } = flow
    dispatch({ type: 'keeping' })
    const gate = await keepGate({ draftId, placed, claim: claimDraft })
    if (!gate.go) {
      if (!gate.gone) return dispatch({ type: 'keepFailed', error: gate.error })
      drop(draftId)
      return dispatch({ type: 'keepGone', notice: gate.error })
    }
    const named = flow.step === 'build' ? { ...flow.pres, title: workTitle(flow.pres) } : flow.pres
    const base = filedFor(named, ctxPlan, liftField, flow.filing)
    // Several people: shared structure, each logs their own loads.
    const shaped = dropEmptyBlocks(group ? withoutLoads(base) : base)
    const cleaned = { ...shaped, ...(draftId ? { draftId } : {}) }
    if (!who.me) {
      /*
       * Into each of THEIR logs, one person at a time, with the ids their own app
       * would mint. Landed nowhere: nothing is claimed and the editor stays. Landed
       * for some: the last screen says who and offers the rest again with the same
       * key, so no part is written twice; the server retires the draft once its id
       * is in any one log (`isKept`).
       */
      const key = keepKeyFor(cleaned)
      const r = await keepForEach({ people: who.others, keep: (person) => onKeepFor(person, cleaned, key, day) })
      if (!r.first) {
        if (gate.claimed) claimDraft(draftId, { release: true })
        return dispatch({ type: 'keepFailed', error: `Not on ${namesOf(who.others)}’s day: ${r.failed[0]?.error || 'it could not be written'}` })
      }
      if (!r.failed.length) finishDraft(draftId)
      return dispatch({ type: 'kept', pres: cleaned, kept: r.first, failed: r.failed, who: { me: false, others: r.landed }, retryPlan: r.failed.length ? cleaned : null, key })
    }
    const kept = onKeep(cleaned, { date: day })
    // You and others: one workout in your log, shared with each of them, sync on.
    let failed = []
    if (who.others.length) {
      try { ({ failed } = await onShareWith(who.others, kept.entries || [])) } catch (e) {
        failed = who.others.map(person => ({ person, error: e.message }))
      }
    }
    finishDraft(draftId)
    dispatch({ type: 'kept', pres: cleaned, kept, failed, who })
  }

  /** Others only: the same plan, for the people it missed. */
  const retryKept = async () => {
    const k = flow.kept
    if (flow.saving || !k?.plan) return
    dispatch({ type: 'retrying' })
    const r = await keepForEach({ people: k.failed.map(f => f.person), keep: (person) => onKeepFor(person, k.plan, k.key, k.date) })
    if (!r.failed.length) finishDraft(flow.draftId)
    dispatch({ type: 'retried', r })
  }

  const leave = leaver(flow, confirmDiscard)
  const close = () => leave(onClose)
  const back = async () => (backOf(flow).close ? close() : dispatch({ type: 'back' }))

  // Their logs are read before anything is written for them: the context and the ids come from them.
  const waiting = otherIds.length > 0 && !theirs.ready
  const waitNames = namesOf(who.others.filter(p => theirs.waitingFor.includes(p.id)))
  const waitLine = !waiting ? null
    : theirs.error ? `Could not open ${waitNames}’s log: ${theirs.error}` : `Opening ${waitNames}’s log…`

  const set = {
    who: useCallback((v) => dispatch({ type: 'who', who: v }), []),
    date: useCallback((v) => dispatch({ type: 'date', date: v }), []),
    goal: useCallback((v) => dispatch({ type: 'goal', goal: v }), []),
    minutes: useCallback((v) => dispatch({ type: 'minutes', minutes: v }), []),
    picked: useCallback((v) => dispatch({ type: 'picked', picked: v }), []),
    pres: useCallback((v) => dispatch({ type: 'pres', pres: v }), []),
    notice: useCallback((v) => dispatch({ type: 'notice', notice: v }), []),
    filing: useCallback((v) => dispatch({ type: 'filing', filing: v }), []),
  }

  return {
    state: flow, dispatch, set, today,
    ai, first: firstStep(flow), title: flowTitle(flow, plan, today), sub: flow.step === 'review' || flow.step === 'build' ? shortLine(flow.pres) : null,
    words, keptWords: flow.kept ? forWords(flow.kept.who, dayPhrase(flow.kept.date, today)) : null,
    later: flow.date > today,
    liftField, forPeople, group, ctxPlan, ctxEntries, ownerId, forId: forOf(who, ownerId),
    // "What is it?" on the keep step, only while nothing else says (`filedFor`).
    asksFiling: (flow.step === 'build' || flow.step === 'review') && needsFiling(flow.pres, ctxPlan, liftField),
    fileChoices: useMemo(() => fileChoices(ctxPlan), [ctxPlan]),
    drafts, open, talk, waiting, waitLine,
    run, retry, resume, discard, keep, retryKept, back, close,
    start: keptStart(flow.kept, today, { onStart, onStartFor, leave }),
    build: () => dispatch({ type: 'build' }),
    another: () => dispatch({ type: 'another' }),
    toFirst: () => dispatch({ type: 'toFirst' }),
  }
}
