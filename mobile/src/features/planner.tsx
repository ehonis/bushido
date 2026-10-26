/*
 * Plan a workout — the screens between "+" and a session with the sets
 * already written in. Ported from app/src/planner.jsx.
 *
 * Say what you want to do, in your own words, and how long there is; the
 * planner reads what it already has (recent sessions, current health/vitals) and
 * writes a followable workout, sets included. Kinds are optional chips under the
 * box since #59: a sentence is a brief on its own.
 *
 * **The kinds are content.** `plan.json` → `plannerKinds`, so "add Shoulders" is
 * an edit to a file rather than a rebuild.
 *
 * **The review step is a real editor, not a confirmation.** Every number is a
 * stepper before it is ever a workout, and the same editor is what the session
 * sheet shows afterwards. One component, two places, because a second would drift.
 *
 * **Nothing reaches the log until the user keeps it.** "Write it for me" is a DRAFT
 * the server keeps beside the log (lib/drafts.js, server/drafts.js): the run
 * belongs to the draft, not to this screen, so leaving, locking the phone or
 * opening another device loses nothing, and the drafts are listed on the first
 * screen to reopen where they were. The model never writes to the log — the user
 * does, with a tap, and the draft is discarded once it is kept.
 *
 * **Two routes through it**: build it by hand, or have the model write it. With
 * the model on offer the first screen is the model's (one box, one button) and
 * "Build it myself" under it opens the kinds; without it, the kinds are first.
 * `blankPrescription` makes the same object the model's JSON normalises into, so
 * everything after the fork is shared.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, font, mix, radius, space, TAP } from '../theme'
import { Icon } from '../lib/icons'
import { T } from '../ui/Text'
import { Btn, Card, Chip, IconBtn, Input, Press, SectionHeader, Toggle } from '../ui/kit'
import { FullScreen } from '../ui/Sheet'
import { Fold } from '../ui/Fold'
import { impact, success, tap, warn } from '../ui/haptics'
import { Markdown } from '../lib/markdown'
import {
  reviseWorkout, plannerContext, groupContext, aiOffered, createDraft, reviseDraft, retryDraft, saveDraft, discardDraft, claimDraft,
} from '../lib/plannerapi.js'
import {
  useDrafts, draftKey, draftStep, draftPres, draftTitle, draftLine, presForServer,
  placedDraftIds, unplacedDrafts, draftToEvict, keepGate,
} from '../lib/drafts.js'
import { confirm } from '../ui/menu'
import {
  normalizePrescription, prescriptionLine, prescriptionSteps, itemLine, setLine,
  patchSet, addSet, removeSet, removeItem, patchItem, patchBlock, appendLift, reviseWeightModes,
  splitPrescription, moveItem, blankPrescription, appendPiece, dropEmptyBlocks,
  setCircuit, setTiming, circuitTiming,
} from '../lib/prescription.js'
import { ExerciseSection } from './exercises'
import { CircuitSteppers, CircuitList, SecondsRow } from './circuit'
import { useWhoop, readinessFor } from '../lib/whoop.jsx'
import { usePlan } from '../lib/planctx.jsx'
import { currentMe } from '../lib/whoami.js'
import { ForChoice, ForLine, usePeopleLogs, type Who } from './trainer'
import * as trainerLib from '../lib/trainer.js'

// Default parameters in the ported JS narrow TypeScript's inference (mobile/AGENTS.md).
const { FOR_ME, forOf, forWords, whoOfDraft, isGroup, forSomeoneElse, namesOf, keepForEach, keepKeyFor, withoutLoads } = trainerLib as any


/** The `type: "lifts"` field spec, which carries the exercise catalog. */
export function liftFieldOf(plan: any) {
  for (const opt of plan?.dailyMenu || []) {
    for (const f of opt.outputs || []) if (f.type === 'lifts') return f
  }
  return null
}

const DEFAULT_MINUTES = [20, 30, 45, 60, 75, 90]

/* ------------------------------------------------------------- the frame */

/**
 * A step's body: the scroll, and the `.plan-actions.sticky` bar pinned under it.
 *
 * Sticky, because the ask and the review are both taller than a phone and the
 * button that ends the step should never be something you scroll to find.
 */
export function StepPage({ children, foot = null, after = null }: {
  children?: React.ReactNode
  foot?: React.ReactNode
  /** What the web renders after the sticky bar (the `.plan-fine` line). */
  after?: React.ReactNode
}) {
  const insets = useSafeAreaInsets()
  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: space.gutter, paddingBottom: foot ? space[4] : space[6] + insets.bottom }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {children}
        {after}
      </ScrollView>
      {foot ? (
        <View style={[st.sticky, { paddingBottom: space[3] + insets.bottom }]}>{foot}</View>
      ) : null}
    </View>
  )
}

/** The pulsing dots the web draws in CSS (`.plan-working-dots`, `.coachdots`). */
export function PulseDots({ size = 7, gap = 6, style }: { size?: number; gap?: number; style?: StyleProp<ViewStyle> }) {
  const vals = useRef([0, 1, 2].map(() => new Animated.Value(0.25))).current
  useEffect(() => {
    const loops = vals.map((v, i) => Animated.loop(Animated.sequence([
      Animated.delay(i * 160),
      Animated.timing(v, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0.25, duration: 600, useNativeDriver: true }),
    ])))
    loops.forEach((l) => l.start())
    return () => loops.forEach((l) => l.stop())
  }, [vals])
  return (
    <View style={[{ flexDirection: 'row', gap }, style]}>
      {vals.map((v, i) => (
        <Animated.View key={i} style={{ width: size, height: size, borderRadius: size, backgroundColor: colors.accent, opacity: v }} />
      ))}
    </View>
  )
}

/** .implchip: the small pill the editor and the block quota use. Selected is the accent tint, like .chip. */
function ImplChip({ label, icon, on, onPress }: { label: string; icon?: string; on?: boolean; onPress: () => void }) {
  const c = on ? colors.ink : colors.inkDim
  return (
    <Press haptic onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!on }}
      style={[st.implchip, on && st.implchipOn]}>
      {icon ? <Icon name={icon} size={13} color={c} /> : null}
      <T size={font.small} color={c}>{label}</T>
    </Press>
  )
}

/* ------------------------------------------------------------------ flow */

/*
 * `people`, `onKeepFor`, `onShareWith`, `onStartFor`: the owner planning for
 * other people on the install (trainer.tsx, lib/trainer.js). `people` is
 * `planPeople(me)`, empty for anyone but the owner, while acting and with one
 * person, and then nothing here changes.
 *
 * "For" is several at once since #59 (`who`). One other person: the model runs
 * on THEIR log, plan and About you, and keeping it writes into their log through
 * `onKeepFor`. More than one: one run on the owner's, told about each of them;
 * keeping it puts it in the owner's log and shares it with the others, sync on
 * (`onShareWith`), or, without the owner, into each of their logs. Still only on
 * the tap (§0.4).
 */
export function PlanFlow({ plan, entries = [], iso, onKeep, onStart, onClose, people = [], onKeepFor = null, onShareWith = null, onStartFor = null }: any) {
  const minuteChips = plan?.plannerKinds?.minutes || DEFAULT_MINUTES
  const liftField = useMemo(() => liftFieldOf(plan), [plan])
  // Who it is for. Only offered with somewhere to keep it.
  const forPeople = onKeepFor && onShareWith ? people : []
  const [who, setWho] = useState<Who>(FOR_ME)
  const group = isGroup(who)
  const words = forWords(who)
  const otherIds = who.others.map((p) => p.id)
  const theirs = usePeopleLogs(otherIds)
  const logOf = (id?: string) => (id && theirs.logs[id]) || { entries: [] as any[], plan: null as any }
  // The editor's "last time" and categories: the owner's when the owner is in it, else the first person's.
  const ctxPlan = who.me ? plan : (logOf(otherIds[0]).plan || plan)
  const ctxEntries = who.me ? entries : logOf(otherIds[0]).entries

  /*
   * The two things the app already knows, gathered here rather than passed in:
   * this component mounts inside the WHOOP provider and App does not, so reading
   * recovery from up there would silently return "no data".
   */
  const { cache: whoopCache } = (useWhoop as any)()
  // WHOOP is the owner's: someone else's plan is told nothing about recovery (§7).
  const readiness = useMemo(() => (who.me ? (readinessFor as any)(whoopCache, iso) : null), [whoopCache, iso, who.me])

  // start | working | review | failed | kept, plus `kind` and `build` — the
  // hand-built route. `start` is the model's first screen; without it, `kind` is.
  const [step, setStep] = useState(() => (aiOffered(currentMe().features) ? 'start' : 'kind'))
  const [keptId, setKeptId] = useState<string | null>(null)   // the entry "start it" would open
  const [keptCount, setKeptCount] = useState(1)
  const [keptWho, setKeptWho] = useState<Who>(FOR_ME)  // who it went to
  const [keptFailed, setKeptFailed] = useState<any[]>([])  // who it could not be written or shared for, and why
  const [keptPlan, setKeptPlan] = useState<any>(null)  // others only, kept for some of them: what "Try again" writes
  const [keptKey, setKeptKey] = useState<string | null>(null)  // …and the key that keeps it from writing a part twice
  const [saving, setSaving] = useState(false)
  // A LIST: one gym trip often covers several kinds, and picking them all up
  // front means the model is told about every one of them.
  const [picked, setPicked] = useState<any[]>([])  // kinds[] rows, plus { key: 'custom:…' }
  const [custom, setCustom] = useState('')
  const [minutes, setMinutes] = useState(45)
  const [goal, setGoal] = useState('')
  const [pres, setPres] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  /*
   * The drafts, and the one this screen has open. The run is the draft's, on the
   * server, so this screen only looks: `useDrafts` polls while one is being
   * written, and when the open draft changes STEP (its run ended, or a revision
   * started) `enter` moves the screen to match. A saved edit does not change the
   * step, so it never pulls the editor out from under them.
   *
   * Whether the model is on offer: once the server says no (`ai-not-configured`),
   * for the rest of the session (`aiOffered`, lib/plannerapi.js), this screen is
   * the hand-built route alone, with nothing that mentions a model.
   */
  const [aiRefused, setAiRefused] = useState(false)
  const ai = aiOffered(currentMe().features) && !aiRefused
  const first = ai ? 'start' : 'kind'
  const { drafts: listed, upsert, drop } = (useDrafts as any)(ai)
  /*
   * Kept ONCE. A draft whose id is already on an entry in the log (kept here,
   * maybe offline, or on another device and synced) is on a day: not offered,
   * and its discard is tried again, because the first may never have arrived.
   */
  const placed = useMemo(() => (placedDraftIds as any)(entries, ...Object.values(theirs.logs).map((l) => l.entries)), [entries, theirs.logs])
  const drafts = useMemo(() => unplacedDrafts(listed, placed), [listed, placed])
  useEffect(() => {
    for (const d of listed) {
      if (placed.has(d.id)) { drop(d.id); discardDraft(d.id).catch(() => {}) }
    }
  }, [listed, placed, drop])
  const [notice, setNotice] = useState<string | null>(null)  // why a keep was refused
  const [draftId, setDraftId] = useState<string | null>(null)
  const open: any = draftId ? drafts.find((d: any) => d.id === draftId) || null : null
  const synced = useRef<string | null>(null)   // draftKey of what the screen last showed
  const skipSave = useRef(false)               // the plan just came FROM the server
  const [talkError, setTalkError] = useState<string | null>(null)

  const label = picked.map(k => k.label).join(' + ')
  const primary = picked[0] || null
  const ownerId = currentMe().real?.id || 'owner'

  const enter = useCallback((d: any) => {
    synced.current = draftKey(d)
    const at = draftStep(d)
    if (at === 'review') {
      // Weight modes (#58) are already on it: the server lays them on when the
      // answer lands (server/drafts.js), so they are on the draft, not this screen.
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

  // Their edits on the review screen go onto the draft, so another device opens them too.
  useEffect(() => {
    if (step !== 'review' || !draftId || !pres) return undefined
    if (skipSave.current) { skipSave.current = false; return undefined }
    if (open?.status === 'working') return undefined
    const t = setTimeout(() => { saveDraft(draftId, presForServer(pres)).then(upsert).catch(() => {}) }, 800)
    return () => clearTimeout(t)
  }, [pres]) // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * "Write it for me": a draft on the server, already being written. The FIRST
   * kind picked fills what the model leaves blank (server/drafts.js). Run again
   * from the ask (Redo, Change the ask), the new draft replaces the one it redoes.
   */
  const run = useCallback(async () => {
    setStep('working')
    setError(null)
    const replacing = draftId
    // Several people: each one's last week under their name, from their own log; only the owner's WHOOP.
    const context = group
      ? (groupContext as any)({ iso, people: [
          ...(who.me ? [{ name: currentMe().real?.name || 'You', readiness, plan, entries }] : []),
          ...who.others.map((p) => ({ name: p.name, plan: logOf(p.id).plan || plan, entries: logOf(p.id).entries })),
        ] })
      : (plannerContext as any)({ readiness, plan: ctxPlan, entries: ctxEntries, iso })
    try {
      const d = await createDraft({
        picked,
        minutes,
        goal: goal.trim(),
        context,
        forId: forOf(who, ownerId),
      })
      upsert(d)
      synced.current = draftKey(d)
      setDraftId(d.id)
      if (replacing && replacing !== d.id) {
        drop(replacing)
        discardDraft(replacing).catch(() => {})
      }
    } catch (e: any) {
      // No model here after all: build it by hand, from the same picks (or pick some first).
      if (e.code === 'ai-not-configured') {
        setAiRefused(true)
        return picked.length ? buildRef.current() : setStep('kind')
      }
      setError(e.message)
      setStep('failed')
    }
  }, [picked, minutes, goal, readiness, ctxPlan, ctxEntries, iso, who, group, theirs.logs, plan, entries, ownerId, draftId, upsert, drop]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Try a failed draft again; a draft that never got made is simply made. */
  const retry = useCallback(async (d: any = open) => {
    if (!d || d.status !== 'failed') return run()
    impact()
    try {
      const next = await retryDraft(d.id)
      upsert(next)
      if (d.id === draftId) enter(next)
    } catch (e: any) {
      setError(e.message)
    }
  }, [open, run, upsert, draftId, enter])

  /** Reopen a draft from the list, at the step it is on, with what was asked. */
  const resume = (d: any) => {
    tap()
    setPicked(d.picked || [])
    setMinutes(d.ask?.minutes || 45)
    setGoal(d.ask?.goal || '')
    setWho(whoOfDraft(d, forPeople))
    setDraftId(d.id)
    enter(d)
  }

  const discard = (d: any) => {
    drop(d.id)
    discardDraft(d.id).catch(() => {})
    if (d.id === draftId) setDraftId(null)
  }

  /** A revision on the open draft: the message is on the thread at once, the answer when the run ends. */
  const talk = draftId ? {
    busy: open?.status === 'working',
    error: talkError || (open?.status === 'failed' && open?.run?.kind === 'revise' ? open.error : null),
    failedMessage: open?.status === 'failed' && open?.run?.kind === 'revise' ? open.run.message : null,
    onAsk: async (message: string) => {
      setTalkError(null)
      try {
        upsert(await reviseDraft(draftId, { message, pres: presForServer(pres) }))
      } catch (e: any) {
        setTalkError(e.message)
        throw e
      }
    },
  } : null

  /**
   * The other route: the blocks, named, with nothing in them. One block per kind
   * picked, in tap order, each carrying that kind's category and sport — the seam
   * is the block and not the author. A kind that names no category leaves the block
   * as "part of the workout beside it"; nothing here guesses on their behalf.
   */
  const build = useCallback(() => {
    setPres((blankPrescription as any)({
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
   * The discipline travels with the kind onto the next screen, but only when it
   * is UNAMBIGUOUS — every pick in the same group. "Climbing · Legs + Power
   * endurance" would be a lie about the first half.
   */
  const groups = plan?.plannerKinds?.groups || []
  const oneGroup = picked.length > 0 && picked.every(k => k.group && k.group === picked[0].group)
  const groupName = oneGroup ? groups.find((g: any) => g.key === picked[0].group)?.name : null
  const title = step === 'kept' ? forWords(keptWho).title
    : step === 'review' ? (pres?.title || 'Your workout')
    : step === 'build' ? (pres?.title || 'Your workout')
    : step === 'kind' || step === 'start' ? 'Plan a workout'
    : label ? [groupName, label].filter(Boolean).join(' · ')
    : 'Plan a workout'

  /**
   * Keep it, and stop there. Starting it is the next screen's question.
   * `dropEmptyBlocks` is for the hand-built route: a picked block never filled in
   * must not land on their day as an entry with no work in it.
   */
  const keep = async () => {
    if (saving) return
    impact()
    setError(null)
    setSaving(true)
    // Claimed first, so a draft is kept once; its id goes on the plan it places,
    // which is what retires it after an offline keep.
    const gate: any = await keepGate({ draftId, placed, claim: claimDraft } as any)
    if (!gate.go) {
      setSaving(false)
      if (!gate.gone) return setError(gate.error)
      drop(draftId)
      setDraftId(null)
      setNotice(gate.error)
      return setStep(first)
    }
    // Several people: shared structure, each logs their own loads (the model's plan has none already).
    const shaped = (dropEmptyBlocks as any)(group ? withoutLoads(pres) : pres)
    const cleaned = { ...shaped, ...(draftId ? { draftId } : {}) }
    if (!who.me) {
      // Into each of THEIR logs, through the people endpoints, one at a time, with
      // the ids their own app would mint. Landed nowhere: the editor stays as it was.
      // Landed for some: the last screen says who, and tries the rest again with the
      // same key, so a part already on someone's day is not written twice. Only
      // there: the server retires the draft once its id is in any one log (`isKept`).
      const key = keepKeyFor(cleaned)
      const r: any = await keepForEach({ people: who.others, keep: (person: any) => onKeepFor(person, cleaned, key) })
      setSaving(false)
      if (!r.first) {
        if (gate.claimed) claimDraft(draftId as string, { release: true })
        return setError(`Not on ${namesOf(who.others)}’s day: ${r.failed[0]?.error || 'it could not be written'}`)
      }
      setKeptKey(key)
      return landed(r.first, r.failed, { me: false, others: r.landed }, r.failed.length ? cleaned : null)
    }
    const kept = onKeep(cleaned)
    // You and others: one workout in your log, shared with each of them, sync on.
    let failed: any[] = []
    if (who.others.length) {
      try { ({ failed } = await onShareWith(who.others, kept.entries || [])) } catch (e: any) {
        failed = who.others.map((person) => ({ person, error: e.message }))
      }
    }
    setSaving(false)
    // One planning run can land as several workouts — see splitPrescription.
    landed(kept, failed)
  }

  // Kept, the draft has done its job: it goes, and the entry is what remains.
  const finishDraft = () => {
    if (!draftId) return
    drop(draftId)
    discardDraft(draftId).catch(() => {})
    setDraftId(null)
  }

  /** On the day. `whoLanded` is who it is actually on; `retryPlan` is set while someone still lacks it. */
  const landed = (kept: any, failed: any[] = [], whoLanded: Who = who, retryPlan: any = null) => {
    if (!retryPlan) finishDraft()
    setKeptId(kept?.first || null)
    setKeptCount(kept?.count || 1)
    setKeptWho(whoLanded)
    setKeptFailed(failed)
    setKeptPlan(retryPlan)
    setStep('kept')
    success()
  }

  /** Others only: the same plan, for the people it missed. */
  const retryKept = async () => {
    if (saving || !keptPlan) return
    impact()
    setSaving(true)
    const r: any = await keepForEach({ people: keptFailed.map((f) => f.person), keep: (person: any) => onKeepFor(person, keptPlan, keptKey) })
    setSaving(false)
    const got = new Set([...keptWho.others, ...r.landed].map((p: any) => p.id))
    setKeptWho({ me: false, others: who.others.filter((p) => got.has(p.id)) })
    setKeptFailed(r.failed)
    if (!keptId && r.first) { setKeptId(r.first.first || null); setKeptCount(r.first.count || 1) }
    if (!r.failed.length) { setKeptPlan(null); finishDraft(); success() }
  }

  /** Round again, from the top, with the last ask cleared. */
  const another = () => {
    setDraftId(null)
    setPres(null)
    setKeptId(null)
    setKeptFailed([])
    setKeptPlan(null)
    setKeptKey(null)
    setPicked([])
    setCustom('')
    setGoal('')
    setStep(first)
  }

  const back = () => {
    // The kinds, reached from the model's screen by "Build it myself", go back to it.
    if (step === 'kind' && first === 'start') return setStep('start')
    // Backing out of the builder throws away what was typed, so it goes back to
    // the kinds rather than to a screen the user did not come from.
    if (step === 'build') return setStep('kind')
    // To the first screen, where the drafts are: a failure there is one tap from
    // its retry or its bin, and a full list (429) is one tap from making room.
    if (step === 'failed') { setDraftId(null); return setStep(first) }
    // Leaving the wait cancels nothing: the draft carries on, and is listed on the
    // first screen, which is where this goes.
    if (step === 'working') { setDraftId(null); return setStep(first) }
    // Backing out of the "what now" screen is "back to today": the workout is
    // already on the day either way.
    onClose()
  }

  // Their logs are read before anything is written for them: the context and the ids come from them.
  const waiting = otherIds.length > 0 && !theirs.ready
  const waitNames = namesOf(who.others.filter((p) => theirs.waitingFor.includes(p.id)))
  const waitLine = waiting ? (theirs.error ? `Could not open ${waitNames}’s log: ${theirs.error}` : `Opening ${waitNames}’s log…`) : null
  const buildOrPick = () => (picked.length ? build() : setStep('kind'))
  const firstHead = (
    <>
      {notice ? <T size={font.small} color={colors.bad} style={st.errLine}>{notice}</T> : null}
      {ai ? <DraftList drafts={drafts} onOpen={(d: any) => { setNotice(null); resume(d) }} onRetry={retry} onDiscard={discard} /> : null}
      <ForChoice people={forPeople} who={who} onChange={setWho} />
      <ForLine who={who} people={forPeople} />
      {waitLine ? <T size={font.small} dim style={st.errLine}>{waitLine}</T> : null}
    </>
  )
  const errLine = error ? <T size={font.small} color={colors.bad} style={st.errLine}>{error}</T> : null

  return (
    <FullScreen
      title={title}
      sub={step === 'review' ? (prescriptionLine as any)(pres) : null}
      icon="ClipboardCheck"
      onBack={back}
      scroll={false}
    >
      {step === 'start' && (
        <AskStep head={firstHead} goal={goal} setGoal={setGoal} minutes={minutes} setMinutes={setMinutes} chips={minuteChips}
          plan={plan} picked={picked} setPicked={setPicked}
          evicts={draftId ? null : draftToEvict(drafts)} busy={waiting}
          onGo={() => { setNotice(null); run() }} onBuild={() => { setNotice(null); setStep('kind') }} />
      )}

      {step === 'kind' && (
        <KindStep plan={plan} custom={custom} setCustom={setCustom}
          picked={picked} setPicked={setPicked} onBuild={build} busy={waiting}
          /* `.plandrafts + .kindgroup`: the first head keeps its space only right under the drafts. */
          spaced={first === 'kind' && drafts.length > 0 && !forPeople.length}
          head={first === 'kind' ? firstHead : <ForLine who={who} people={forPeople} />} />
      )}

      {step === 'working' && (
        <StepPage>
          <ForLine who={who} people={forPeople} />
          <Working label={label} minutes={minutes} since={open?.run?.startedAt || null}
            onDiscard={open ? () => { discard(open); setStep(first) } : null} />
        </StepPage>
      )}

      {step === 'failed' && (
        <StepPage>
          <ForLine who={who} people={forPeople} />
          <View style={st.failed}>
            <View style={st.failedLead}>
              <Icon name="TriangleAlert" size={16} color={colors.bad} style={{ marginTop: 3 }} />
              <T size={font.body} color={colors.bad} style={{ flex: 1 }}>{error}</T>
            </View>
            <T size={font.small} dim>Nothing was written.</T>
            <View style={[st.actions, st.fork]}>
              <Btn icon="RotateCw" title="Try again" onPress={() => retry()} style={st.forkBtn} />
              {/* Not a dead end: a busy box is only a reason to write it yourself. */}
              <Btn kind="secondary" icon="ListPlus" title="Build it myself" onPress={buildOrPick} style={st.forkBtn} />
              <Btn kind="ghost" title="Change the ask" onPress={() => setStep('start')} style={st.forkBtn} />
              {!open && drafts.length > 0 ? (
                <Btn kind="ghost" title="See your drafts" onPress={back} style={st.forkBtn} />
              ) : null}
            </View>
          </View>
        </StepPage>
      )}

      {step === 'build' && pres && (
        <BuildStep pres={pres} setPres={setPres} liftField={liftField} entries={ctxEntries}
          categories={ctxPlan?.quotaCategories || []}
          onKeep={keep} words={words}
          head={<><ForLine who={who} people={forPeople} />{errLine}</>} />
      )}

      {step === 'review' && pres && (
        <ReviewStep pres={pres} setPres={setPres} liftField={liftField} entries={ctxEntries}
          categories={ctxPlan?.quotaCategories || []}
          onRedo={() => setStep('start')} talk={talk}
          onKeep={talk?.busy ? () => {} : keep} forId={forOf(who, ownerId)} words={words}
          head={<><ForLine who={who} people={forPeople} />{errLine}</>} />
      )}

      {step === 'kept' && pres && (
        <StepPage>
          <KeptStep pres={pres} count={keptCount} parts={(splitPrescription as any)(pres)} words={forWords(keptWho)} failed={keptFailed}
            onRetry={keptPlan ? retryKept : null} retrying={saving}
            onStart={!keptId ? null
              : keptWho.me ? () => onStart(keptId)
              : forSomeoneElse(keptWho) && onStartFor ? () => onStartFor(forSomeoneElse(keptWho), keptId) : null}
            startLabel={forSomeoneElse(keptWho) ? `Open it on ${forSomeoneElse(keptWho).name}’s side` : null}
            onAnother={another}
            onDone={onClose} />
        </StepPage>
      )}
    </FullScreen>
  )
}

/* ------------------------------------------------------------ step: what */

/**
 * The kinds, under discipline headings.
 *
 * Ungrouped, "Power" and "Endurance" were a coin flip — climbing categories here
 * and ordinary words for lifting and cardio. The groups are CONTENT
 * (`plannerKinds.groups`), and a kind whose `group` matches nothing falls into a
 * trailing section rather than vanishing: a card in the file and not on the screen
 * is a failure this app has already had.
 */
export function groupedKinds(plan: any) {
  const kinds = plan?.plannerKinds?.kinds || []
  const defs = plan?.plannerKinds?.groups || []

  const groups = defs
    .map((g: any) => ({ ...g, items: kinds.filter((k: any) => k.group === g.key) }))
    .filter((g: any) => g.items.length > 0)

  const claimed = new Set(groups.flatMap((g: any) => g.items.map((k: any) => k.key)))
  const rest = kinds.filter((k: any) => !claimed.has(k.key))
  if (rest.length) {
    groups.push({ key: '_other', name: 'Anything else', icon: 'Sparkles', items: rest })
  }
  return groups
}

/*
 * The kinds, as the hand-built route's first step: each kind becomes a named,
 * empty block. Behind "Build it myself" with the model on offer, the first screen
 * without it; either way nothing here mentions a model.
 */
export function KindStep({ plan, custom, setCustom, picked, setPicked, onBuild, head = null, spaced = false, busy = false }: any) {
  const groups = groupedKinds(plan)
  const at = (k: any) => picked.findIndex((p: any) => p.key === k.key)
  const has = (k: any) => at(k) >= 0
  const toggle = (k: any) =>
    setPicked(has(k) ? picked.filter((p: any) => p.key !== k.key) : [...picked, k])

  const addCustom = () => {
    const label = custom.trim()
    if (!label) return
    const key = `custom:${label.toLowerCase()}`
    if (!picked.some((p: any) => p.key === key)) setPicked([...picked, { key, label, prompt: label }])
    setCustom('')
  }
  const customs = picked.filter((p: any) => p.key.startsWith('custom:'))

  // Which folded groups the user opened. Lifted here because a closed fold
  // after a closed fold sits closer (`.kindgroup.folded:not([open]) + …`).
  const [opened, setOpened] = useState<Record<string, boolean>>({})
  const countIn = (g: any) => g.items.filter((k: any) => has(k)).length
  const shownOf = (g: any) => !g.collapsed || Boolean(opened[g.key]) || countIn(g) > 0
  const headTop = (i: number) => {
    if (i === 0) return spaced ? space[6] : 0
    const prev = groups[i - 1]
    return prev.collapsed && !shownOf(prev) && groups[i].collapsed ? space[1] : space[6]
  }

  // Once something is picked, because until then there is nothing to build.
  const fork = picked.length > 0 ? (
    <Btn icon="ListPlus" title="Build it myself" onPress={onBuild} disabled={busy} />
  ) : null

  /*
   * No paragraph (docs/DESIGN.md D7): the rows are toggles with a check, and the
   * check carries the ORDER the user tapped them in, because the planner writes
   * the blocks in that order — which one came first is a fact about the session.
   */
  return (
    <StepPage foot={fork}>
      {head}
      {groups.map((g: any, i: number) => (
        <KindGroup key={g.key} group={g} at={at} toggle={toggle} top={headTop(i)}
          shown={shownOf(g)} picked={countIn(g)}
          onToggle={() => setOpened(o => ({ ...o, [g.key]: !shownOf(g) }))} />
      ))}

      <View accessibilityLabel="Something else">
        <SectionHeader title="Something else" style={{ marginTop: groups.length ? space[6] : (spaced ? space[6] : 0) }} />
        {customs.length > 0 && (
          <Card style={st.list}>
            {customs.map((k: any, i: number) => (
              <KindRow key={k.key} k={k} n={at(k) + 1} first={i === 0} onToggle={() => toggle(k)} />
            ))}
          </Card>
        )}
        <View style={st.customRow}>
          <Input value={custom} onChangeText={setCustom} style={{ flex: 1, minWidth: 0 }}
            accessibilityLabel="Something else"
            placeholder="A shoulder day, a 40 minute erg, a hike"
            returnKeyType="done" onSubmitEditing={addCustom} />
          <Btn kind="secondary" title="Add" disabled={!custom.trim()} onPress={addCustom} />
        </View>
      </View>
    </StepPage>
  )
}

/** One kind as a row: its icon, its name, the one line that says what it is, and the check. */
function KindRow({ k, n, first, onToggle }: { k: any; n: number; first: boolean; onToggle: () => void }) {
  const on = n > 0
  return (
    <Press haptic onPress={onToggle} accessibilityRole="button" accessibilityState={{ selected: on }}
      accessibilityLabel={k.label} style={[st.row, !first && st.rowRule]}>
      <Icon name={k.icon || 'Dumbbell'} size={20} color={on ? colors.accent : colors.inkDim} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <T size={font.body} weight={500} numberOfLines={1}>{k.label}</T>
        {k.hint ? <T size={font.small} dim numberOfLines={1}>{k.hint}</T> : null}
      </View>
      <View style={[st.check, on && st.checkOn]}>
        {on ? <T size={font.caption} weight={600} lineHeight={16} tabular>{n}</T> : null}
      </View>
    </Press>
  )
}

/**
 * One group: a section head over one card of rows.
 *
 * A group may declare `collapsed: true` in content (the endurance catalogs:
 * thirty-odd swim, bike and run variants that would bury the rest), and then its
 * head is a fold with a count and a chevron. A group with something picked in it
 * is forced open, so what the user chose is never hidden behind its own header.
 * The groups' `blurb`s stay in the file and are not printed (D7: if a control
 * needs a paragraph, change the control).
 */
function KindGroup({ group: g, at, toggle, top, shown, picked, onToggle }: {
  group: any; at: (k: any) => number; toggle: (k: any) => void
  top: number; shown: boolean; picked: number; onToggle: () => void
}) {
  const rows = (
    <Card style={st.list}>
      {g.items.map((k: any, i: number) => (
        <KindRow key={k.key} k={k} n={at(k) + 1} first={i === 0} onToggle={() => toggle(k)} />
      ))}
    </Card>
  )

  if (!g.collapsed) {
    return (
      <View accessibilityLabel={g.name}>
        <SectionHeader title={g.name} style={{ marginTop: top }} />
        {rows}
      </View>
    )
  }

  return (
    <View>
      <Press onPress={() => { tap(); onToggle() }} accessibilityRole="button" accessibilityState={{ expanded: shown }}
        style={[st.foldHead, { marginTop: top, marginBottom: shown ? space[2] : 0 }]}>
        <T size={font.body} weight={600} style={{ flex: 1 }} numberOfLines={1}>{g.name}</T>
        <T size={font.small} dim tabular>{picked ? `${picked} picked · ` : ''}{g.items.length}</T>
        <Icon name={shown ? 'ChevronUp' : 'ChevronDown'} size={16} color={colors.inkFaint} />
      </Press>
      {shown ? rows : null}
    </View>
  )
}

/* ------------------------------------------------- step: how long, what for */

/**
 * "Write it for me": one box and one button (#59). What they want to do, in
 * their own words, is the whole brief, and the model decides the blocks. How
 * long is a row of chips under it. The kinds are still there, folded, as
 * optional chips. "Build it myself" is a quiet door at the foot.
 */
export function AskStep({
  goal, setGoal, minutes, setMinutes, chips = DEFAULT_MINUTES, plan = null, picked = [], setPicked,
  onGo, onBuild = null, evicts = null, busy = false, head = null,
}: any) {
  const groups = groupedKinds(plan)
  const has = (k: any) => picked.some((p: any) => p.key === k.key)
  const toggle = (k: any) => setPicked(has(k) ? picked.filter((p: any) => p.key !== k.key) : [...picked, k])
  const known = new Set(groups.flatMap((g: any) => g.items.map((k: any) => k.key)))
  // A draft written before #59 may carry a "Something else" kind; it is shown, and can be taken off.
  const extra = picked.filter((k: any) => !known.has(k.key))
  const ready = Boolean(goal.trim() || picked.length)
  const [kindsOpen, setKindsOpen] = useState(false)
  const chip = (k: any) => <Chip key={k.key} out icon={k.icon || 'Dumbbell'} label={k.label} on={has(k)} onPress={() => toggle(k)} />

  return (
    // Not ready, it is the neutral kind, as the web's disabled primary: a shape, not a dimmed accent.
    <StepPage foot={<Btn icon="Sparkles" title="Write it for me" onPress={onGo} kind={ready && !busy ? 'primary' : 'secondary'} disabled={!ready || busy} />}>
      {head}
      <View style={st.askblock}>
        <T size={font.title} weight={600} style={{ marginBottom: space[3] }}>What do you want to do?</T>
        <Input multiline value={goal} onChangeText={setGoal} style={{ minHeight: 128 }}
          accessibilityLabel="What do you want to do?"
          placeholder="Legs, then twenty minutes easy on the bike" />
      </View>

      <View style={st.askblock}>
        <SectionHeader title="How long?" style={{ marginTop: 0 }} />
        <View style={st.chiprow}>
          {chips.map((m: number) => (
            <Chip key={m} out label={`${m} min`} on={minutes === m} onPress={() => setMinutes(m)} />
          ))}
        </View>
        <View style={st.minstep}>
          <IconBtn bordered icon="Minus" size={16} color={colors.ink} label="five minutes less"
            onPress={() => setMinutes((m: number) => Math.max(5, m - 5))} />
          <T size={font.body} dim tabular style={{ minWidth: 72, textAlign: 'center' }}>{minutes} min</T>
          <IconBtn bordered icon="Plus" size={16} color={colors.ink} label="five minutes more"
            onPress={() => setMinutes((m: number) => Math.min(300, m + 5))} />
        </View>
      </View>

      {/* Folded, so the screen is the box and the button; open when something in it is picked. */}
      <View style={{ marginBottom: space[4] }}>
        <Press onPress={() => { tap(); setKindsOpen(!(kindsOpen || picked.length > 0)) }} accessibilityRole="button"
          accessibilityState={{ expanded: kindsOpen || picked.length > 0 }} style={st.foldHead}>
          <T size={font.body} weight={600} style={{ flex: 1 }}>Add a kind</T>
          <T size={font.small} dim>{picked.length ? `${picked.length} picked` : 'Optional'}</T>
          <Icon name={kindsOpen || picked.length > 0 ? 'ChevronUp' : 'ChevronDown'} size={16} color={colors.inkFaint} />
        </Press>
        {kindsOpen || picked.length > 0 ? (
          <>
            {extra.length > 0 ? <View style={[st.chiprow, { marginTop: space[3] }]}>{extra.map(chip)}</View> : null}
            {groups.map((g: any) => (
              <View key={g.key} style={{ marginTop: space[3] }} accessibilityLabel={g.name}>
                <T size={font.small} dim weight={500} style={{ marginBottom: space[2] }}>{g.name}</T>
                <View style={st.chiprow}>{g.items.map(chip)}</View>
              </View>
            ))}
          </>
        ) : null}
      </View>

      {onBuild ? (
        <Btn kind="quiet" icon="ListPlus" title="Build it myself" onPress={onBuild} style={{ alignSelf: 'flex-start' }} />
      ) : null}

      {/* At the cap, the oldest draft not being written makes room. Said before, not after. */}
      {evicts ? (
        <View style={st.evicts}>
          <Icon name="Info" size={14} color={colors.inkDim} />
          <T size={font.small} dim style={{ flex: 1 }}>Replaces your oldest draft, {draftTitle(evicts)}</T>
        </View>
      ) : null}
    </StepPage>
  )
}

/* ------------------------------------------------------------ step: working */

/**
 * The wait, made legible. Thirty to ninety seconds of an agent reading their log,
 * and a bare spinner for that long is a screen the user backs out of. So it says
 * what it is doing and counts up: an elapsed number is honest about a slow answer
 * in a way a progress bar pretending to know the total is not.
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
 * counts from where it is. Leaving cancels nothing (the run is the draft's, on
 * the server) and the screen says so.
 */
export function Working({ label, minutes, since = null, onDiscard = null }: {
  label: string; minutes: number; since?: string | null; onDiscard?: (() => void) | null
}) {
  const from = useMemo(() => (since ? Date.parse(since) : Date.now()), [since])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [])
  const secs = Math.max(0, Math.round((now - from) / 1000))
  const stage = WORKING_STAGES[Math.min(WORKING_STAGES.length - 1, Math.floor(secs / 12))]

  return (
    <View style={st.working}>
      <Icon name="Sparkles" size={28} color={colors.accent} />
      <T size={font.title} weight={600} align="center" style={{ marginTop: space[3] }}>
        {label ? `Building ${minutes} minutes of ${label.toLowerCase()}` : `Writing ${minutes} minutes`}
      </T>
      <T size={font.body} dim align="center" style={{ marginTop: space[2], marginBottom: space[4] }}>{stage}</T>
      <PulseDots style={{ marginBottom: space[3] }} />
      <T size={font.small} dim align="center" tabular>{secs}s · You can leave; it keeps going</T>
      {onDiscard ? (
        <Btn kind="quiet" title="Stop and throw it away" onPress={() => { warn(); onDiscard() }}
          style={{ marginTop: space[3] }} />
      ) : null}
    </View>
  )
}

/**
 * The drafts on the first screen: written, being written, or failed, as rows in
 * one card. Above the kinds, because a draft is a workout already half planned.
 * Tapping one reopens it at its step; a failed one has its retry on the row; the
 * bin throws one away. Nothing on this list is in the log, and the row never
 * claims otherwise.
 */
export function DraftList({ drafts = [], onOpen, onRetry, onDiscard, now = null }: {
  drafts: any[]; onOpen: (d: any) => void; onRetry: (d: any) => void; onDiscard: (d: any) => void; now?: number | null
}) {
  const [tick, setTick] = useState(() => now ?? Date.now())
  const working = drafts.some(d => d.status === 'working')
  useEffect(() => {
    if (!working || now != null) return undefined
    const iv = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [working, now])
  if (!drafts.length) return null
  const at = now ?? tick

  const ask = async (d: any) => {
    if (d.status === 'ready') {
      warn()
      if (!(await confirm(`Throw away “${draftTitle(d)}”?`, { confirmLabel: 'Discard' }))) return
    }
    onDiscard(d)
  }

  return (
    <View style={st.drafts} accessibilityLabel="Your drafts">
      <SectionHeader title="Drafts" right="Not on your day yet" style={{ marginTop: 0 }} />
      <Card style={st.list}>
        {drafts.map((d, i) => {
          const icon = d.status === 'working' ? 'Timer' : d.status === 'failed' ? 'TriangleAlert' : 'ClipboardCheck'
          const tint = d.status === 'ready' ? colors.accent : d.status === 'failed' ? colors.bad : colors.inkDim
          return (
            <View key={d.id} style={[st.draft, i > 0 && st.rowRule]}>
              <Press onPress={() => onOpen(d)} accessibilityRole="button" accessibilityLabel={draftTitle(d)} style={st.draftOpen}>
                {d.status === 'working'
                  ? <Pulse><Icon name={icon} size={20} color={tint} /></Pulse>
                  : <Icon name={icon} size={20} color={tint} />}
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <T size={font.body} weight={500} numberOfLines={1}>{draftTitle(d)}</T>
                  <T size={font.small} dim tabular numberOfLines={1}>{draftLine(d, at)}</T>
                </View>
              </Press>
              {d.status === 'failed' ? <Btn kind="secondary" title="Try again" onPress={() => onRetry(d)} /> : null}
              <IconBtn icon="Trash2" size={17} label={`Discard ${draftTitle(d)}`} onPress={() => ask(d)} />
            </View>
          )
        })}
      </Card>
    </View>
  )
}

/** `.plandraft.working` svg: the icon of a draft being written breathes, as the web's `planpulse` does. */
function Pulse({ children }: { children: React.ReactNode }) {
  const v = useRef(new Animated.Value(1)).current
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 0.25, duration: 800, useNativeDriver: true }),
      Animated.timing(v, { toValue: 1, duration: 800, useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [v])
  return <Animated.View style={{ opacity: v }}>{children}</Animated.View>
}

/**
 * The paragraph saying what the planner was thinking. Collapsed by default
 * everywhere except the review: a good `why` runs to a hundred and fifty words,
 * which is most of a phone screen above the sets the user came to look at.
 */
export function PlanWhy({ text, open = false }: { text?: string | null; open?: boolean }) {
  const [shown, setShown] = useState(open)
  if (!text) return null
  const long = text.length > 220
  return (
    <View style={st.why}>
      <Icon name="Sparkles" size={14} color={colors.accent} style={{ marginTop: 3 }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={long && !shown ? { maxHeight: 63, overflow: 'hidden' } : null}>
          <Markdown text={text} size={13.5} color={colors.inkDim} />
        </View>
        {long && (
          <Press onPress={() => { tap(); setShown(v => !v) }} style={{ marginTop: 6, alignSelf: 'flex-start' }}>
            <T size={12} color={colors.accent} style={st.link}>{shown ? 'less' : 'why this session'}</T>
          </Press>
        )}
      </View>
    </View>
  )
}

/** The quick asks, in their own vocabulary. */
const REVISE_PROMPTS = [
  'Make it shorter',
  'Go easier on me',
  'More volume',
  'Swap an exercise',
]

/**
 * Talking to it about the session it wrote.
 *
 * **The thread lives ON the prescription**, so it survives the session landing on
 * the day. **A revision replaces the whole plan, and says what it did** (`changed`
 * is the newest thing in the thread). **Their own edits survive it**: the plan sent
 * up is the plan as the user has it, steppers and all.
 */
/*
 * `draft`: the planner's open draft (planner flow only). Then a revision is the
 * draft's, on the server: `draft.onAsk` starts it, the message and the answer
 * arrive on `pres.thread`, and `busy`/`error` are the draft's, so a revision
 * still being written when the app was left is still being written on return.
 * Without it (the session sheet), a revision is one request.
 */
export function PlanTalk({ pres, onChange, compact = false, forId = null, draft = null, entries = [], entryId = null }: any) {
  const [text, setText] = useState('')
  const [localAsking, setAsking] = useState(false)
  const [localError, setError] = useState<string | null>(null)
  const asking = draft ? draft.busy : localAsking
  const error = draft ? draft.error : localError
  /*
   * COLLAPSED, in both places it appears: open, it sat between the user and the
   * first set of the session they are standing there to do. The header still
   * says how many turns the thread holds, so a conversation is never silently
   * hidden — it is one tap, with a count on it.
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

  const ask = async (message: string) => {
    const said = String(message || '').trim()
    if (!said || asking) return
    impact()
    setText('')
    if (draft) {
      try { await draft.onAsk(said) } catch { setText(said) }
      return
    }
    setError(null)
    setAsking(true)
    // Their message goes on immediately; a box that swallows what you typed for
    // tens of seconds feels broken.
    const at = new Date().toISOString()
    const pending = [...thread, { role: 'you', text: said, at }]
    onChange({ ...pres, thread: pending })
    try {
      const raw: any = await (reviseWorkout as any)({ plan: stripThread(pres), message: said, thread, forId })
      // The model is never asked what a weight means (#58): what it kept keeps
      // its mode, what is new takes the one its exercise was last logged in.
      const next: any = (reviseWeightModes as any)(pres, (normalizePrescription as any)(raw, { liftField }), liftField, entries, { excludeId: entryId })
      if (!next) throw new Error('it sent back a session with nothing in it')
      onChange({
        ...pres, ...next,
        // The category is a decision the user made; a revision does not undo it.
        category: pres.category || next.category || null,
        activity: pres.activity || next.activity || null,
        thread: [...pending, {
          role: 'coach',
          text: next.changed || raw.changed || 'Rewritten.',
          at: new Date().toISOString(),
        }],
      })
    } catch (e: any) {
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
    <View style={[st.talk, !shown && { backgroundColor: colors.panel2 }]}>
      <Press onPress={() => { tap(); setShown(v => !v) }} accessibilityRole="button"
        accessibilityState={{ expanded: shown }} style={st.talkHead}>
        <Icon name="Sparkles" size={15} color={colors.accent} />
        {/* A session the user wrote has no reasoning to read; the panel is still
            worth having, because the model can revise a plan whoever wrote it. */}
        <T size={13.5} weight={600} style={{ flex: 1 }}>
          {pres?.why || thread.length
            ? 'Why this session — and what to change'
            : 'Ask the model to change this'}
        </T>
        {thread.length > 0 && <TurnCount n={Math.ceil(thread.length / 2)} />}
        <Icon name={shown ? 'ChevronUp' : 'ChevronDown'} size={15} color={colors.inkFaint} />
      </Press>

      {shown && (
        <View style={st.talkBody}>
          {pres?.why ? (
            <View>
              <View style={long && !full ? { maxHeight: 84, overflow: 'hidden' } : null}>
                <Markdown text={pres.why} size={13.5} color={colors.inkDim} />
              </View>
              {long && (
                <Press onPress={() => { tap(); setFull(v => !v) }} style={{ marginTop: 6, alignSelf: 'flex-start' }}>
                  <T size={12} color={colors.accent} style={st.link}>{full ? 'less' : 'read the rest'}</T>
                </Press>
              )}
            </View>
          ) : null}

          <TalkThread thread={thread} asking={asking} thinking="Rewriting it…" />

          {error && (
            <View style={st.err}>
              <Icon name="TriangleAlert" size={13} color={colors.bad} style={{ marginTop: 3 }} />
              <T size={12.5} color={colors.bad} style={{ flex: 1 }}>{error} — your session is unchanged.</T>
            </View>
          )}

          {!asking && <TalkPrompts prompts={REVISE_PROMPTS} onAsk={ask} />}

          <TalkAsk text={text} setText={setText} asking={asking} onAsk={ask} label="Change it"
            placeholder="or type your own — “drop the front squat”" />
        </View>
      )}
    </View>
  )
}

/** .plantalk-n: the turn count on the fold. */
export function TurnCount({ n }: { n: number }) {
  return (
    <View style={st.talkN}><T size={11} weight={700} lineHeight={14} color={colors.bg}>{n}</T></View>
  )
}

/** The messages, the user's right and solid, the model's left and quiet. */
export function TalkThread({ thread, asking, thinking }: { thread: any[]; asking: boolean; thinking: string }) {
  return (
    <>
      {thread.map((m: any, i: number) => (
        <View key={i} style={[st.msg, m.role === 'you' ? st.msgYou : st.msgCoach]}>
          <Markdown text={m.text} size={13} color={m.role === 'you' ? colors.ink : colors.inkDim} />
        </View>
      ))}
      {asking && (
        <View style={[st.msg, st.msgCoach, { flexDirection: 'row', alignItems: 'center', gap: 9 }]}>
          <PulseDots size={6} gap={4} />
          <T size={12.5} dim>{thinking}</T>
        </View>
      )}
    </>
  )
}

export function TalkPrompts({ prompts, onAsk }: { prompts: string[]; onAsk: (q: string) => void }) {
  return (
    <View style={st.prompts}>
      {prompts.map(q => (
        <Press key={q} onPress={() => onAsk(q)} style={st.prompt}>
          <T size={12} dim>{q}</T>
        </Press>
      ))}
    </View>
  )
}

export function TalkAsk({ text, setText, asking, onAsk, label, placeholder }: {
  text: string; setText: (v: string) => void; asking: boolean; onAsk: (v: string) => void; label: string; placeholder: string
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
      <Input multiline value={text} editable={!asking} onChangeText={setText}
        placeholder={placeholder} style={{ flex: 1, minWidth: 0, minHeight: 56 }} />
      <Btn kind="primary" title={asking ? '…' : label} disabled={!text.trim() || asking} onPress={() => onAsk(text)} />
    </View>
  )
}

/** The plan without its conversation — what gets sent back up to be revised. */
const stripThread = (pres: any) => {
  const { thread, ...rest } = pres || {}
  void thread
  return rest
}

/* -------------------------------------------------------------- step: build */

/**
 * The same editor, opened empty: the review step with the model taken out of it.
 * The blocks are already named and already carry their quota. Missing on purpose:
 * no `PlanTalk` (nothing is being asked of a model), no "why" (nobody reasoned
 * about it), no Redo (the undo for a hand-built session is what you just typed).
 */
export function BuildStep({ pres, setPres, liftField, entries = [], categories = [], onKeep, words = forWords(FOR_ME), head = null }: any) {
  const sets = (prescriptionSteps as any)(pres).length

  return (
    <StepPage
      foot={<Btn icon="Plus" title={words.keep} disabled={!sets} onPress={onKeep} />}
      after={!sets ? <T style={st.fine}>Add an exercise or an interval to keep it</T> : null}
    >
      {head}
      <SplitNote parts={(splitPrescription as any)((dropEmptyBlocks as any)(pres))} />

      <PrescriptionEditor pres={pres} onChange={setPres} liftField={liftField} entries={entries}
        categories={categories} onAddPiece={
          (blockId: string, name: string, by: string, unit: string) =>
            setPres((appendPiece as any)(pres, name, { blockId, by, unit }))
        } />
    </StepPage>
  )
}

/**
 * A piece of work that is not a lift. Name it, say how it is MEASURED, add it:
 * an interval set shows only the fields it carries (`setFieldsFor`), so this is
 * the one moment the answer is available. Folded behind a button of its own —
 * on a lift day it is never the answer.
 */
function PieceAdder({ unit, onAdd }: { unit: string; onAdd: (name: string, by: string, unit: string) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [by, setBy] = useState('time')

  const add = () => {
    const said = name.trim()
    if (!said) return
    impact()
    onAdd(said, by, unit)
    setName('')
    setOpen(false)
  }

  if (!open) {
    return (
      <Press haptic onPress={() => setOpen(true)} style={st.addPiece}>
        <Icon name="Timer" size={15} color={colors.inkFaint} />
        <T size={font.small} faint>Add a swim set, interval or hold</T>
      </Press>
    )
  }

  return (
    <View style={st.pieceadd}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Input autoFocus value={name} onChangeText={setName} style={{ flex: 1, minWidth: 0 }}
          accessibilityLabel="What the piece is called"
          placeholder="easy spin, 400s, hollow hold…"
          returnKeyType="done" onSubmitEditing={add} />
        <IconBtn icon="X" size={16} label="Close" onPress={() => { setOpen(false); setName('') }} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {[['time', 'by time'], ['distance', 'by distance'], ['reps', 'by reps']].map(([k, lbl]) => (
          <ImplChip key={k} label={lbl} on={by === k} onPress={() => setBy(k)} />
        ))}
        <Btn title="Add" disabled={!name.trim()} onPress={add} style={{ marginLeft: 'auto' }} />
      </View>
    </View>
  )
}

/* ------------------------------------------------------------- step: review */

function ReviewStep({ pres, setPres, liftField, entries = [], categories = [], onRedo, onKeep, forId = null, words = forWords(FOR_ME), head = null, talk = null }: any) {
  return (
    <StepPage
      foot={
        <View style={{ flexDirection: 'row', gap: space[2] }}>
          <Btn kind="ghost" icon="RotateCw" title="Redo" onPress={onRedo} />
          <Btn icon="Plus" title={words.keep} onPress={onKeep}
            disabled={Boolean(talk?.busy)} flex />
        </View>
      }
    >
      {head}
      <PlanTalk pres={pres} onChange={setPres} forId={forId} draft={talk} />

      <SplitNote parts={(splitPrescription as any)(pres)} />

      <PrescriptionEditor pres={pres} onChange={setPres} liftField={liftField} entries={entries}
        categories={categories} />

      {pres.notes?.length > 0 && (
        <View style={{ marginTop: space[4], gap: space[2] }}>
          {pres.notes.map((n: string, i: number) => (
            <View key={i} style={{ flexDirection: 'row', gap: space[2], alignItems: 'flex-start' }}>
              <Icon name="Info" size={13} color={colors.inkFaint} style={{ marginTop: 3 }} />
              <T size={font.small} faint style={{ flex: 1 }}>{n}</T>
            </View>
          ))}
        </View>
      )}

      <T style={st.fine}>
        Written from {words.from}. Change anything before you keep it.
      </T>
    </StepPage>
  )
}

/**
 * What this will land as, before the user keeps it. A multi-part trip becomes
 * several entries (`splitPrescription`), which has to be said BEFORE it happens.
 * Silent on a single-part plan, which is most of them and is not news.
 */
function SplitNote({ parts }: { parts: any[] }) {
  if (parts.length < 2) return null
  return (
    <View style={st.split}>
      <Icon name="Layers" size={14} color={colors.series1} style={{ marginTop: 3 }} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <T size={font.small} weight={600}>This lands as {parts.length} separate workouts</T>
        <T size={font.small} dim>{parts.map(p => p.title).join(' · ')}</T>
      </View>
    </View>
  )
}

/**
 * Which category a BLOCK is — and therefore where the session SPLITS.
 *
 * Each workout in the session has its own category, not the session as a whole:
 * a run and a lift land as two entries, each with its own log and its own place
 * for the watch to attach to. (Until 2026-10-25 this was also which weekly quota
 * the block filled; the quotas are gone, the split stays.) `none` is a real
 * answer and the default for a warm-up: it belongs to the workout beside it.
 */
function BlockQuota({ categories, value, onChange }: any) {
  if (!categories.length) return null
  const picked = categories.find((c: any) => c.key === value) || null
  return (
    <Fold
      style={{ marginBottom: 10 }}
      headStyle={{ minHeight: 30 }}
      summary={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="Target" size={12} color={colors.inkFaint} />
          <T size={font.small} faint>
            {picked
              ? <>A separate <T size={font.small} weight={600} color={colors.accent}>{picked.name}</T> workout</>
              : 'Part of the workout beside it'}
          </T>
        </View>
      }
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, marginBottom: 2 }}>
        <ImplChip label="Part of the workout beside it" on={!value} onPress={() => onChange(null)} />
        {categories.map((c: any) => (
          <ImplChip key={c.key} icon={c.icon} label={c.name} on={value === c.key} onPress={() => onChange(c.key)} />
        ))}
      </View>
    </Fold>
  )
}

/* --------------------------------------------------------- step: what now */

/**
 * It is on the day. Now what?
 *
 * The flow used to drop the user straight into the running timer the moment a
 * workout was kept, so a session planned in the morning for the evening landed
 * in a clock. Hence three doors: starting it is the accent button because it is
 * the only one that goes somewhere new; the other two are equal ways of saying "later".
 */
export function KeptStep({ pres, count = 1, parts = [], onStart, onAnother, onDone, forName = null, words = null, failed = [], startLabel = null, onRetry = null, retrying = false }: any) {
  const many = count > 1
  const w = words || forWords(forName ? { me: false, others: [{ id: forName, name: forName }] } : FOR_ME)
  const where = w.where
  return (
    <View style={st.kept}>
      <Icon name="CircleCheck" size={44} color={colors.vizGood} />
      <T size={font.heading} weight={600} lineHeight={27} align="center" style={{ marginTop: space[3], marginBottom: space[2] }}>
        {many ? `${count} workouts are ${where}` : `${pres.title} is ${where}`}
      </T>

      {/* Named, because "2 workouts" is not an answer to "which two". */}
      {many && (
        <View style={st.keptParts}>
          {parts.map((p: any, i: number) => (
            <View key={i} style={st.keptPart}>
              <T size={font.body} weight={600}>{p.title}</T>
              <T size={font.caption} faint>{(prescriptionLine as any)(p.pres)}</T>
            </View>
          ))}
        </View>
      )}

      <T size={font.small} dim align="center" style={{ marginTop: many ? space[4] : 0 }}>
        {many ? '' : `${(prescriptionLine as any)(pres)} · `}
        {w.after}
      </T>

      {/* Not on everyone's day: said, by name, with where to try again. Planned for
          others only, that is here (`onRetry`); shared from your own workout, it is
          "With …" on its sheet. */}
      {failed.map((f: any) => (
        <T key={f.person.id} size={font.small} color={colors.bad} align="center" style={{ marginTop: space[2] }}>
          {!onRetry ? `Not with ${f.person.name}: ${f.error}. Add ${f.person.name} from the workout’s “With …”.`
            : f.written > 0 ? `${f.person.name} has part of it (${f.written} of ${f.of}): ${f.error}.`
            : `Not on ${f.person.name}’s day: ${f.error}.`}
        </T>
      ))}
      {onRetry && failed.length > 0 ? (
        <>
          <Btn kind="secondary" icon="RotateCw" title={`Try again for ${namesOf(failed.map((f: any) => f.person))}`}
            onPress={onRetry} disabled={retrying} style={{ marginTop: space[3], alignSelf: 'center' }} />
          {/* Only here: the draft is retired once it is on anyone's day. */}
          <T size={font.small} dim align="center" style={{ marginTop: space[2] }}>
            If you close this, plan {namesOf(failed.map((f: any) => f.person))}’s again from Plan a workout.
          </T>
        </>
      ) : null}

      <View style={st.keptActs}>
        {onStart && (
          <Btn icon="Play" title={startLabel || (forName ? `Open it on ${forName}’s side` : many ? 'Start the first one' : 'Start it now')}
            onPress={() => { impact(); onStart() }} style={{ minHeight: 56 }} />
        )}
        <Btn kind={onStart ? 'secondary' : 'primary'} icon="Plus" title="Plan another workout" onPress={onAnother} />
        <Btn kind="ghost" icon="House" title="Back to today" onPress={onDone} />
      </View>
    </View>
  )
}

/* ------------------------------------------------------------- the editor */

/**
 * What a distance in THIS block is measured in: a pool is yards; everything else
 * that covers ground is miles, which is what Strava hands back. A default on a
 * box the user can retype, not a conversion.
 */
const distanceUnitFor = (block: any) => (/swim/i.test(block?.activity || '') ? 'yd' : 'mi')

/** "1 set", "6 sets" — the header count. */
const setCount = (block: any) => {
  if (block?.circuit) return `${block.circuit.rounds} round${block.circuit.rounds === 1 ? '' : 's'}`
  const n = (block?.items || []).reduce((sum: number, i: any) => sum + i.sets.length, 0)
  return `${n} set${n === 1 ? '' : 's'}`
}

/**
 * Any block can be a circuit (issue #68): its exercises one after another on
 * the interval timer, which is what Start runs. A switch, with the words beside it.
 */
function CircuitSwitch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3], minHeight: TAP, marginVertical: space[1] }}>
      <View style={{ flexShrink: 1 }}>
        <T size={font.body}>Circuit</T>
        <T size={font.small} dim>Timed, one exercise after another</T>
      </View>
      <Toggle value={on} onChange={onChange} />
    </View>
  )
}

/**
 * A block switched to Circuit: the same head and fold as any block, then the
 * circuit's timing in one row, its exercises with their own timing behind a
 * tap (circuit.tsx), and the two settings people rarely change folded.
 */
/** "10 lb": a circuit exercise's planned weight, which its logged rows carry. */
const loadOf = (it: any) => {
  const w = it.sets?.[0]?.weight
  return w !== null && w !== undefined && w !== '' ? `${w} ${it.weightLabel || 'lb'}` : null
}

function CircuitBlock({ block: b, pres, onChange, liftField, entries, entryId, open, onToggle, extra }: any) {
  const [more, setMore] = useState(false)
  const c = b.circuit
  const items = b.items.map((it: any) => ({ id: it.id, key: it.exercise, name: it.name, timing: (circuitTiming as any)(it), load: loadOf(it) }))
  const timing = (next: any) => onChange((patchBlock as any)(pres, b.id, { circuit: { ...c, ...next } }))
  return (
    <View style={{ marginBottom: open ? 22 : 10 }}>
      <Press onPress={() => { tap(); onToggle() }} accessibilityRole="button" accessibilityState={{ expanded: open }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 34 }}>
        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={14} color={colors.inkFaint} />
        <T size={font.body} weight={600} style={{ flex: 1, minWidth: 0 }}>{b.name}</T>
        <T size={font.small} dim tabular>{setCount(b)}</T>
      </Press>
      {open ? (
        <>
          {extra}
          <CircuitSteppers circuit={c} onChange={timing} />
          <Btn kind="quiet" icon={more ? 'ChevronUp' : 'ChevronDown'} title={more ? 'Fewer options' : 'More options'}
            style={{ alignSelf: 'flex-start', paddingHorizontal: space[1] }} onPress={() => setMore(!more)} />
          {more ? (
            <View style={{ backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.card, marginBottom: space[2] }}>
              <SecondsRow label="Rest between rounds" value={c.roundRest} onChange={v => timing({ roundRest: v })} />
              <SecondsRow label="Get ready" value={c.countIn} max={60} onChange={v => timing({ countIn: v })} first={false} />
            </View>
          ) : null}
          <CircuitList items={items} work={c.work} liftField={liftField}
            onTiming={(i, t) => onChange((setTiming as any)(pres, items[i].id, t))}
            onRemove={(i) => onChange((removeItem as any)(pres, items[i].id))}
            onMove={(i, dir) => onChange((moveItem as any)(pres, items[i].id, dir).pres)}
            onAdd={(key) => onChange((appendLift as any)(pres, liftField, key, { blockId: b.id, entries, excludeId: entryId }))} />
        </>
      ) : null}
    </View>
  )
}

/**
 * Every set of a planned session, editable, with thumbs in mind.
 *
 * THE SAME COMPONENT THE LOG FORM USES: the card, the fold, the implement chips,
 * the steppers, the picker and reorder mode all live in `exercises` and this file
 * only says what a BLOCK is. What is left here is `BlockQuota`, which decides
 * where a session splits. Shared by the review step and the session sheet.
 */
export function PrescriptionEditor({
  pres, onChange, liftField, entries = [], entryId = null, categories = [], compact = false,
  canReorder = true, onAddPiece = null,
}: any) {
  const [shut, setShut] = useState<Set<string>>(() => new Set())  // blockIds folded away

  const total = (prescriptionSteps as any)(pres).length
  // ONE exercise starts open and it is the first in the SESSION, not the first in
  // each block — six open cards is four screens of steppers to scroll past.
  const firstItemId = (pres?.blocks || []).flatMap((b: any) => b.items || [])[0]?.id || null

  const toggleBlock = (id: string) => setShut(s => {
    const next = new Set(s)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  return (
    <View style={compact ? { gap: 0 } : null}>
      {(pres.blocks || []).map((b: any) => (b.circuit ? (
        <CircuitBlock key={b.id} block={b} pres={pres} onChange={onChange} liftField={liftField}
          entries={entries} entryId={entryId}
          open={!shut.has(b.id)} onToggle={() => toggleBlock(b.id)}
          extra={<>
            <CircuitSwitch on onChange={(on) => onChange((setCircuit as any)(pres, b.id, on))} />
            <BlockQuota categories={categories} value={b.category}
              onChange={(key: string | null) => onChange((patchBlock as any)(pres, b.id, { category: key }))} />
          </>} />
      ) : (
        <ExerciseSection key={b.id}
          title={b.name}
          count={b.items.length > 0 ? setCount(b) : null}
          items={b.items.map((it: any) => ({ ...it, line: (itemLine as any)(it) }))}
          liftField={liftField} entries={entries} entryId={entryId}
          firstOpenId={firstItemId}
          open={!shut.has(b.id)} onToggle={() => toggleBlock(b.id)}
          extra={<>
            <CircuitSwitch on={false} onChange={(on) => onChange((setCircuit as any)(pres, b.id, on))} />
            <BlockQuota categories={categories} value={b.category}
              onChange={(key: string | null) => onChange((patchBlock as any)(pres, b.id, { category: key }))} />
          </>}
          /* The hand-built route only. A session the model wrote already has its
             intervals in it, and the place to change one is the card. */
          foot={onAddPiece
            ? <PieceAdder unit={distanceUnitFor(b)}
                onAdd={(name, by, unit) => onAddPiece(b.id, name, by, unit)} />
            : null}
          onPatch={(id: string, patch: any) => onChange((patchItem as any)(pres, id, patch))}
          onPatchSet={(id: string, setId: string, patch: any) => onChange((patchSet as any)(pres, id, setId, patch))}
          onAddSet={(id: string) => onChange((addSet as any)(pres, id))}
          onRemoveSet={(id: string, setId: string) => onChange((removeSet as any)(pres, id, setId))}
          onRemove={(id: string) => onChange((removeItem as any)(pres, id))}
          onMove={canReorder ? (id: string, dir: number) => {
            const r: any = (moveItem as any)(pres, id, dir)
            onChange(r.pres)
            return r.itemId
          } : null}
          /* Same as the log form: the exercise just added opens. `appendLift`
             re-mints every id, and the new one is always last in its block. */
          onAdd={(key: string) => {
            const next: any = (appendLift as any)(pres, liftField, key, { blockId: b.id, entries, excludeId: entryId })
            onChange(next)
            const block = (next.blocks || []).find((x: any) => x.name === b.name) || next.blocks?.[0]
            return block?.items?.at(-1)?.id || null
          }} />
      )))}
      {/* Only where there is nothing to be done about it: a session still being
          built is empty because the user has not started. */}
      {!total && !onAddPiece && (
        <T style={st.subp}>Nothing left in this workout. Redo it, or close and start again.</T>
      )}
    </View>
  )
}

export { setLine }

const st = StyleSheet.create({
  sticky: {
    paddingTop: space[3], paddingHorizontal: space.gutter, backgroundColor: colors.bg,
    shadowColor: colors.bg, shadowOffset: { width: 0, height: -9 }, shadowOpacity: 1, shadowRadius: 9,
  },
  actions: { flexDirection: 'row', gap: space[2], marginTop: space[4] },
  // The fork wraps rather than squeezes: an ellipsised label is a choice nobody can read.
  fork: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  forkBtn: { flexGrow: 1, flexShrink: 1, flexBasis: 148 },
  fine: { color: colors.inkDim, fontSize: font.small, lineHeight: Math.round(font.small * 1.45), marginTop: space[2] },
  subp: { color: colors.inkDim, fontSize: 12.5, lineHeight: 19 },
  link: { textDecorationLine: 'underline' },
  errLine: { marginTop: space[2], marginBottom: space[3] },

  // One card of .list-rows with hairlines between them (the kinds, the drafts).
  list: { paddingVertical: 0, marginBottom: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 52, paddingVertical: space[2] },
  rowRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  // .kindrow-check: an empty ring, or the pick's order on the accent tint.
  check: {
    width: 24, height: 24, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: colors.lineStrong,
  },
  checkOn: { backgroundColor: colors.accentSoft, borderColor: colors.accentLine },
  foldHead: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: TAP },
  customRow: { flexDirection: 'row', gap: space[2], marginTop: space[2] },

  askblock: { marginBottom: space[6] },
  chiprow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  minstep: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginTop: space[3] },
  evicts: { flexDirection: 'row', alignItems: 'center', gap: space[2] },

  working: { alignItems: 'center', paddingVertical: space[8], paddingHorizontal: space[3] },
  drafts: { marginBottom: space[2] },
  draft: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  draftOpen: { flex: 1, minWidth: 0, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2] },
  failed: { paddingVertical: space[6] },
  failedLead: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2], marginBottom: space[2] },

  why: {
    flexDirection: 'row', gap: 10, marginBottom: 18, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12,
    backgroundColor: mix(colors.accent, 7, colors.panel2), borderWidth: 1, borderColor: mix(colors.accent, 24, colors.line),
  },

  talk: {
    marginBottom: 20, borderRadius: 12, overflow: 'hidden',
    backgroundColor: mix(colors.accent, 7, colors.panel2), borderWidth: 1, borderColor: mix(colors.accent, 24, colors.line),
  },
  talkHead: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 11, paddingHorizontal: 12, minHeight: TAP },
  talkBody: { paddingHorizontal: 12, paddingBottom: 12 },
  talkN: {
    minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent,
  },
  msg: { marginVertical: 10, paddingVertical: 9, paddingHorizontal: 11, borderRadius: 10 },
  msgYou: { marginLeft: '22%', backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line },
  msgCoach: {
    marginRight: '10%', borderLeftWidth: 2, borderLeftColor: mix(colors.accent, 50, colors.panel2),
    borderTopLeftRadius: 0, borderBottomLeftRadius: 0,
  },
  err: { flexDirection: 'row', gap: 6, marginTop: 8 },
  prompts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12, marginBottom: 10 },
  prompt: {
    minHeight: 32, paddingHorizontal: 11, borderRadius: radius.pill, justifyContent: 'center',
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line,
  },

  implchip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space[3], minHeight: 36,
    borderRadius: radius.pill, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line,
  },
  implchipOn: { borderColor: colors.accentLine, backgroundColor: colors.accentSoft },
  addPiece: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: TAP, marginTop: 6,
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, borderRadius: 8, paddingHorizontal: 10,
  },
  pieceadd: { gap: 8, padding: 10, marginTop: 6, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, borderRadius: 8 },

  split: {
    flexDirection: 'row', gap: 10, marginBottom: 18, paddingVertical: 11, paddingHorizontal: 13, borderRadius: 11,
    backgroundColor: mix(colors.series1, 9, colors.panel2), borderWidth: 1, borderColor: mix(colors.series1, 28, colors.line),
  },

  kept: { alignItems: 'center', paddingTop: 40, paddingHorizontal: 8 },
  keptParts: { alignSelf: 'stretch', gap: 8 },
  keptPart: {
    gap: 1, paddingVertical: 9, paddingHorizontal: 12, backgroundColor: colors.panel2,
    borderWidth: 1, borderColor: colors.line, borderLeftWidth: 3, borderLeftColor: colors.accent, borderRadius: 9,
  },
  keptActs: { alignSelf: 'stretch', gap: space[2], marginTop: space[6] },
})
