/*
 * Plan a workout — the four screens between "+" and a session with the sets
 * already written in. Ported from app/src/planner.jsx.
 *
 * Pick a kind (legs, say), then say how much time there is and what the session
 * is for; the planner reads what it already has (recent sessions, current
 * health/vitals) and writes a followable workout, sets included.
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
 * **Two routes through it**: build it by hand, or have the model write it. The
 * fork is on the FIRST screen, under the kinds. `blankPrescription` makes the same
 * object the model's JSON normalises into, so everything after the fork is shared.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, mix, radius, TAP } from '../theme'
import { Icon } from '../lib/icons'
import { T } from '../ui/Text'
import { Btn, IconBtn, Input, Press } from '../ui/kit'
import { FullScreen } from '../ui/Sheet'
import { Fold } from '../ui/Fold'
import { impact, success, tap, warn } from '../ui/haptics'
import { Markdown } from '../lib/markdown'
import {
  reviseWorkout, plannerContext, createDraft, reviseDraft, retryDraft, saveDraft, discardDraft, claimDraft,
} from '../lib/plannerapi.js'
import {
  useDrafts, draftKey, draftStep, draftPres, draftTitle, draftLine, presForServer,
  placedDraftIds, unplacedDrafts, draftToEvict, keepGate, DRAFT_MAX,
} from '../lib/drafts.js'
import { confirm } from '../ui/menu'
import {
  normalizePrescription, prescriptionLine, prescriptionSteps, itemLine, setLine,
  patchSet, addSet, removeSet, removeItem, patchItem, patchBlock, appendLift,
  splitPrescription, moveItem, blankPrescription, appendPiece, dropEmptyBlocks,
} from '../lib/prescription.js'
import { ExerciseSection } from './exercises'
import { useWhoop, readinessFor } from '../lib/whoop.jsx'
import { usePlan } from '../lib/planctx.jsx'
import { progress as quotaProgress } from '../lib/quota.js'
import { currentMe } from '../lib/whoami.js'
import { ForChoice, ForLine, usePersonLog } from './trainer'


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
        contentContainerStyle={{ padding: 16, paddingBottom: foot ? 16 : 28 + insets.bottom }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {children}
        {after}
      </ScrollView>
      {foot ? (
        <View style={[st.sticky, { paddingBottom: 12 + insets.bottom }]}>{foot}</View>
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

/** .implchip: the small pill the editor and the block quota use. */
function ImplChip({ label, icon, on, onPress }: { label: string; icon?: string; on?: boolean; onPress: () => void }) {
  const c = on ? colors.accent : colors.inkFaint
  return (
    <Press haptic onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!on }}
      style={[st.implchip, on && { borderColor: colors.accent }]}>
      {icon ? <Icon name={icon} size={13} color={c} /> : null}
      <T size={12} color={c}>{label}</T>
    </Press>
  )
}

/* ------------------------------------------------------------------ flow */

/*
 * `people`, `onKeepFor`, `onStartFor`: the owner planning for someone else on
 * the install (trainer.tsx, lib/trainer.js). `people` is `planPeople(me)`, empty
 * for anyone but the owner, while acting and with one person, and then nothing
 * here changes. With someone picked, the model runs on THEIR log, plan and About
 * you, the editor's "last time" is theirs, and keeping it writes into their log
 * through `onKeepFor`; still only on the tap (§0.4).
 */
export function PlanFlow({ plan, entries = [], iso, onKeep, onStart, onClose, people = [], onKeepFor = null, onStartFor = null }: any) {
  const minuteChips = plan?.plannerKinds?.minutes || DEFAULT_MINUTES
  const liftField = useMemo(() => liftFieldOf(plan), [plan])
  // Who it is for: null is you. Only offered with somewhere to keep it.
  const forPeople = onKeepFor ? people : []
  const [target, setTarget] = useState<any>(null)
  const theirs = usePersonLog(target?.id || null)
  const ctxPlan = target ? (theirs.plan || plan) : plan
  const ctxEntries = target ? theirs.entries : entries

  /*
   * The two things the app already knows, gathered here rather than passed in:
   * this component mounts inside the WHOOP provider and App does not, so reading
   * recovery from up there would silently return "no data".
   */
  const { cache: whoopCache } = (useWhoop as any)()
  // WHOOP is the owner's: someone else's plan is told nothing about recovery (§7).
  const readiness = useMemo(() => (target ? null : (readinessFor as any)(whoopCache, iso)), [whoopCache, iso, target])
  const week = useMemo(() => (quotaProgress as any)({ plan: ctxPlan, entries: ctxEntries, iso }), [ctxPlan, ctxEntries, iso])

  // kind | ask | working | review | failed | kept, plus `build` — the hand-built
  // route, which reaches the same editor from the same kinds with no model in it.
  const [step, setStep] = useState('kind')
  const [keptId, setKeptId] = useState<string | null>(null)   // the entry "start it" would open
  const [keptCount, setKeptCount] = useState(1)
  const [keptFor, setKeptFor] = useState<any>(null)  // the person it went to, or null for you
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
   */
  const ai = currentMe().features.ai
  const { drafts: listed, upsert, drop } = (useDrafts as any)(ai)
  /*
   * Kept ONCE. A draft whose id is already on an entry in the log (kept here,
   * maybe offline, or on another device and synced) is on a day: not offered,
   * and its discard is tried again, because the first may never have arrived.
   */
  const placed = useMemo(() => placedDraftIds(entries, target ? theirs.entries : []), [entries, target, theirs.entries])
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

  const enter = useCallback((d: any) => {
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
    try {
      const d = await createDraft({
        picked,
        minutes,
        goal: goal.trim(),
        context: (plannerContext as any)({ readiness, week, iso }),
        forId: target?.id || null,
      })
      upsert(d)
      synced.current = draftKey(d)
      setDraftId(d.id)
      if (replacing && replacing !== d.id) {
        drop(replacing)
        discardDraft(replacing).catch(() => {})
      }
    } catch (e: any) {
      setError(e.message)
      setStep('failed')
    }
  }, [picked, minutes, goal, readiness, week, iso, target, draftId, upsert, drop])

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
    setTarget(d.for ? (forPeople.find((p: any) => p.id === d.for.id) || d.for) : null)
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
   * picked, in tap order, each carrying that kind's quota and sport — the seam is
   * the block and not the author. A kind that names no category leaves the block
   * saying "counts toward nothing"; nothing here guesses on their behalf.
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

  /*
   * The discipline travels with the kind onto the next screen, but only when it
   * is UNAMBIGUOUS — every pick in the same group. "Climbing · Legs + Power
   * endurance" would be a lie about the first half.
   */
  const groups = plan?.plannerKinds?.groups || []
  const oneGroup = picked.length > 0 && picked.every(k => k.group && k.group === picked[0].group)
  const groupName = oneGroup ? groups.find((g: any) => g.key === picked[0].group)?.name : null
  const title = step === 'kept' ? (keptFor ? `On ${keptFor.name}’s day` : 'On your day')
    : step === 'review' ? (pres?.title || 'Your workout')
    : step === 'build' ? (pres?.title || 'Your workout')
    : step === 'kind' ? 'Plan a workout'
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
      return setStep('kind')
    }
    const cleaned = { ...(dropEmptyBlocks as any)(pres), ...(draftId ? { draftId } : {}) }
    // Kept, the draft has done its job: it goes, and the entry is what remains.
    const done = () => {
      if (!draftId) return
      drop(draftId)
      discardDraft(draftId).catch(() => {})
      setDraftId(null)
    }
    if (target) {
      // Into THEIR log, through the people endpoints, with the ids their own app
      // would mint. A failure leaves the editor as it was and says so.
      try {
        const kept = await onKeepFor(target, cleaned)
        done()
        setKeptId(kept?.first || null)
        setKeptCount(kept?.count || 1)
        setKeptFor(target)
        setStep('kept')
        success()
      } catch (e: any) {
        if (gate.claimed) claimDraft(draftId as string, { release: true })
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
    success()
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
    // Backing out of the builder throws away what was typed, so it goes back to
    // the kinds rather than to a screen the user did not come from.
    if (step === 'build') return setStep('kind')
    // To the first screen, where the drafts are: a failure there is one tap from
    // its retry or its bin, and a full list (429) is one tap from making room.
    if (step === 'failed') { setDraftId(null); return setStep('kind') }
    // Leaving the wait cancels nothing: the draft carries on, and is listed on the
    // first screen, which is where this goes.
    if (step === 'working') { setDraftId(null); return setStep('kind') }
    // Backing out of the "what now" screen is "back to today": the workout is
    // already on the day either way.
    onClose()
  }

  return (
    <FullScreen
      title={title}
      sub={step === 'review' ? (prescriptionLine as any)(pres) : step === 'ask' ? 'How long, and what for' : null}
      icon="ClipboardCheck"
      onBack={back}
      scroll={false}
    >
      {step === 'kind' && (
        <KindStep plan={plan} custom={custom} setCustom={setCustom}
          picked={picked} setPicked={setPicked}
          onNext={() => { setNotice(null); setStep('ask') }} onBuild={build}
          waiting={target && !theirs.ready
            ? (theirs.error ? `Could not open ${target.name}’s log: ${theirs.error}` : `Opening ${target.name}’s log…`) : null}
          head={<>
            {notice ? <T size={12.5} color={colors.bad} style={{ marginBottom: 12 }}>{notice}</T> : null}
            <DraftList drafts={drafts} onOpen={(d: any) => { setNotice(null); resume(d) }} onRetry={retry} onDiscard={discard} />
            <ForChoice people={forPeople} target={target} onTarget={setTarget} />
          </>} />
      )}

      {step === 'ask' && (
        <AskStep head={<ForLine person={target} people={forPeople} />} picked={picked} label={label} minutes={minutes} setMinutes={setMinutes}
          goal={goal} setGoal={setGoal} chips={minuteChips}
          placeholder={plan?.plannerKinds?.goalPlaceholder}
          evicts={draftId ? null : draftToEvict(drafts)}
          onGo={run} />
      )}

      {step === 'working' && (
        <StepPage>
          <Working label={label} minutes={minutes} since={open?.run?.startedAt || null}
            onDiscard={open ? () => { discard(open); setStep('kind') } : null} />
        </StepPage>
      )}

      {step === 'failed' && (
        <StepPage>
          <View style={st.failed}>
            <View style={st.failedLead}>
              <Icon name="TriangleAlert" size={15} color={colors.bad} style={{ marginTop: 3 }} />
              <T size={14} color={colors.bad} style={{ flex: 1 }}>{error}</T>
            </View>
            <T size={12.5} dim lineHeight={19}>
              Nothing was written. The planner reads your log before it answers, so a box that is
              busy or unreachable costs you the wait and nothing else.
            </T>
            <View style={[st.actions, st.fork]}>
              <Btn icon="RotateCw" title="Try again" onPress={() => retry()} style={st.forkBtn} />
              <Btn kind="ghost" title="Change the ask" onPress={() => setStep('ask')} style={st.forkBtn} />
              {!open && drafts.length > 0 ? (
                <Btn kind="ghost" title="See your drafts" onPress={back} style={st.forkBtn} />
              ) : null}
              {/* Not a dead end: a busy box is only a reason to write it yourself. */}
              <Btn kind="ghost" icon="ListPlus" title="Build it myself" onPress={build} style={st.forkBtn} />
            </View>
          </View>
        </StepPage>
      )}

      {step === 'build' && pres && (
        <BuildStep pres={pres} setPres={setPres} liftField={liftField} entries={ctxEntries}
          categories={ctxPlan?.quotaCategories || []}
          onKeep={keep} forName={target?.name || null}
          head={<><ForLine person={target} people={forPeople} />{error ? <T size={12} color={colors.bad} style={{ marginBottom: 10 }}>{error}</T> : null}</>} />
      )}

      {step === 'review' && pres && (
        <ReviewStep pres={pres} setPres={setPres} liftField={liftField} entries={ctxEntries}
          categories={ctxPlan?.quotaCategories || []}
          onRedo={() => setStep('ask')} talk={talk}
          onKeep={talk?.busy ? () => {} : keep} forId={target?.id || null} forName={target?.name || null}
          head={<><ForLine person={target} people={forPeople} />{error ? <T size={12} color={colors.bad} style={{ marginBottom: 10 }}>{error}</T> : null}</>} />
      )}

      {step === 'kept' && pres && (
        <StepPage>
          <KeptStep pres={pres} count={keptCount} parts={(splitPrescription as any)(pres)} forName={keptFor?.name || null}
            onStart={!keptId ? null : keptFor ? (onStartFor ? () => onStartFor(keptFor, keptId) : null) : () => onStart(keptId)}
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

function KindStep({ plan, custom, setCustom, picked, setPicked, onNext, onBuild, head = null, waiting = null }: any) {
  const groups = groupedKinds(plan)
  const has = (k: any) => picked.some((p: any) => p.key === k.key)
  const toggle = (k: any) =>
    setPicked(has(k) ? picked.filter((p: any) => p.key !== k.key) : [...picked, k])

  const addCustom = () => {
    const label = custom.trim()
    if (!label) return
    const key = `custom:${label.toLowerCase()}`
    if (!picked.some((p: any) => p.key === key)) setPicked([...picked, { key, label, prompt: label }])
    setCustom('')
  }

  const ai = currentMe().features.ai

  /*
   * THE FORK, under the answer to "what are you doing". Both are real buttons of
   * the same height; the model's is the accent one because it is the one that
   * goes and does something, not because it is the better answer.
   */
  const fork = (
    <View style={st.fork}>
      <Btn kind="ghost" icon="ListPlus" title="Build it myself" disabled={!picked.length}
        onPress={onBuild} style={[st.forkBtn, st.big]} />
      {/* Not offered to someone the AI is not set up for (lib/whoami.js). */}
      {ai ? (
        <Btn icon="Sparkles" title={picked.length > 1 ? `Write me ${picked.length} in one` : 'Write it for me'}
          disabled={!picked.length} onPress={onNext} style={[st.forkBtn, st.big]} />
      ) : null}
    </View>
  )

  // Planning for someone: their log loads before anything can be picked from it.
  if (waiting) return <StepPage>{head}<T style={st.lead}>{waiting}</T></StepPage>

  return (
    <StepPage
      foot={fork}
      after={ai ? (
        <T style={st.fine}>
          Building it yourself sends nothing anywhere and takes no time; the model takes about a
          minute and asks how long you have first.
        </T>
      ) : null}
    >
      {head}
      <T style={st.lead}>
        Pick what you are doing — <T size={12.5} dim weight={700}>as many as you like</T>. A gym trip that is legs,
        then core, then ten minutes on the bike is one session with three blocks. Then say who
        writes it down: you, or the model. Either way you edit every number afterwards.
      </T>

      {/* Numbered rather than merely highlighted: the planner is told to write the
          blocks in this order, so which was tapped first is a real fact. */}
      {picked.length > 0 && (
        <View style={st.pickedbar}>
          {picked.map((k: any, i: number) => (
            <Press key={k.key} haptic onPress={() => toggle(k)} style={st.pickedchip}
              accessibilityLabel={`Remove ${k.label}`}>
              <View style={st.pickedchipN}><T size={10} weight={700} lineHeight={13} color={colors.bg}>{i + 1}</T></View>
              <T size={13}>{k.label}</T>
              <Icon name="X" size={13} color={colors.inkDim} />
            </Press>
          ))}
        </View>
      )}

      {groups.map((g: any) => <KindGroup key={g.key} group={g} has={has} toggle={toggle} />)}

      <View style={{ marginTop: 20 }}>
        <T size={12} faint style={{ marginBottom: 6 }}>Something else</T>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Input value={custom} onChangeText={setCustom} style={{ flex: 1, minWidth: 0 }}
            placeholder="a shoulder day, a 40 minute erg, a hike…"
            returnKeyType="done" onSubmitEditing={addCustom} />
          <Btn title="Add" disabled={!custom.trim()} onPress={addCustom} />
        </View>
      </View>
    </StepPage>
  )
}

/** Two to a row, the `.kindgrid` minmax(140px) grid on a phone. */
function pairs<X>(xs: X[]): X[][] {
  const out: X[][] = []
  for (let i = 0; i < xs.length; i += 2) out.push(xs.slice(i, i + 2))
  return out
}

/**
 * One divider and its cards.
 *
 * A group may declare `collapsed: true` in content (the endurance catalogs:
 * thirty-odd swim, bike and run variants that would bury the rest), and then it
 * folds behind its header with a count. A group with something picked in it is
 * forced open, so what the user chose is never hidden behind its own header.
 */
function KindGroup({ group: g, has, toggle }: any) {
  const picked = g.items.filter((k: any) => has(k)).length
  const [open, setOpen] = useState(false)
  const cards = (
    <View style={{ gap: 10 }}>
      {pairs(g.items).map((row: any[], r: number) => (
        <View key={r} style={{ flexDirection: 'row', gap: 10 }}>
          {row.map((k: any) => {
            const on = has(k)
            return (
              <Press key={k.key} haptic onPress={() => toggle(k)} accessibilityState={{ selected: on }}
                style={[st.kindcard, on && st.kindcardOn]}>
                <Icon name={on ? 'CircleCheck' : k.icon} size={22} color={colors.accent} />
                <T size={15} weight={600} lineHeight={20} color={on ? colors.accent : colors.ink}>{k.label}</T>
                {k.hint ? <T size={11.5} faint lineHeight={16}>{k.hint}</T> : null}
              </Press>
            )
          })}
          {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
        </View>
      ))}
    </View>
  )
  const blurb = g.blurb ? <T size={12.5} dim lineHeight={19} style={{ marginBottom: 12 }}>{g.blurb}</T> : null

  if (!g.collapsed) {
    return (
      <View style={{ marginBottom: 22 }}>
        <View style={st.kindhead}>
          <Icon name={g.icon} size={14} color={colors.inkFaint} />
          <T size={10.5} caps faint>{g.name}</T>
          <View style={st.kindheadRule} />
        </View>
        {blurb}
        {cards}
      </View>
    )
  }

  const shown = open || picked > 0
  return (
    <Fold
      isOpen={shown}
      onToggle={(v) => setOpen(v)}
      style={{ marginBottom: shown ? 22 : 4 }}
      headStyle={{ minHeight: TAP, marginBottom: shown ? 9 : 0 }}
      summary={
        <View style={[st.kindhead, { marginBottom: 0 }]}>
          <Icon name={g.icon} size={14} color={colors.inkFaint} />
          <T size={10.5} caps faint>{g.name}</T>
          <View style={st.kindheadRule} />
          <T size={11.5} faint tabular>{picked ? `${picked} picked · ` : ''}{g.items.length} kinds</T>
        </View>
      }
    >
      {blurb}
      {cards}
    </Fold>
  )
}

/* ------------------------------------------------- step: how long, what for */

function AskStep({ picked, label, minutes, setMinutes, goal, setGoal, chips, placeholder, onGo, head = null, evicts = null }: any) {
  const many = picked.length > 1
  return (
    <StepPage
      foot={
        <Btn icon="Sparkles" onPress={onGo} style={st.big}
          title={many ? 'Build my session' : `Build my ${label ? label.toLowerCase() : 'workout'}`} />
      }
      after={<>
        {/* At the cap, the oldest draft not being written makes room. Said before, not after. */}
        {evicts ? (
          <T style={st.fine}>
            You already have {DRAFT_MAX} drafts. Writing this one throws away the oldest you have not
            kept: <T size={11.5} weight={700}>{draftTitle(evicts)}</T>.
          </T>
        ) : null}
        {picked.length === 1 && picked[0].hint ? (
          <T style={st.fine}>It will lean toward {picked[0].hint}.</T>
        ) : null}
      </>}
    >
      {head}
      <View style={st.askblock}>
        <T size={15} weight={600} style={{ marginBottom: 10 }}>How long have you got{many ? ' altogether' : ''}?</T>
        {many && (
          <T style={[st.subp, { marginBottom: 10 }]}>
            For the whole trip — {label.toLowerCase()} — not for each. It will fit them into
            this and say so if they do not all go.
          </T>
        )}
        <View style={st.chiprow}>
          {chips.map((m: number) => {
            const on = minutes === m
            return (
              <Press key={m} haptic onPress={() => setMinutes(m)} accessibilityState={{ selected: on }}
                style={[st.timechip, on && st.timechipOn]}>
                <T size={19} weight={600} tabular lineHeight={23} color={on ? colors.accent : colors.inkDim}>{m}</T>
                <T size={10} weight={500} lineHeight={13} color={on ? colors.accent : colors.inkFaint} style={{ letterSpacing: 0.5 }}>min</T>
              </Press>
            )
          })}
        </View>
        <View style={st.minstep}>
          <IconBtn bordered icon="Minus" size={16} color={colors.ink} label="five minutes less"
            onPress={() => setMinutes((m: number) => Math.max(5, m - 5))} />
          <T size={14} dim tabular style={{ minWidth: 72, textAlign: 'center' }}>{minutes} min</T>
          <IconBtn bordered icon="Plus" size={16} color={colors.ink} label="five minutes more"
            onPress={() => setMinutes((m: number) => Math.min(300, m + 5))} />
        </View>
      </View>

      <View style={st.askblock}>
        <T size={15} weight={600} style={{ marginBottom: 10 }}>What do you want out of it?</T>
        <Input multiline value={goal} onChangeText={setGoal} style={{ minHeight: 100 }}
          placeholder={placeholder || 'Optional — say what you are after and it will build around it.'} />
        <T style={[st.subp, { marginTop: 8 }]}>
          Optional. It already knows what you lifted last time and how you slept; this is for the
          part it cannot read — a niggle, a deadline, or just how you feel about it.
        </T>
      </View>
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
      <T size={17} weight={600} align="center" style={{ marginTop: 14 }}>Building {minutes} minutes of {label.toLowerCase()}</T>
      <T size={13.5} dim align="center" style={{ marginTop: 8, marginBottom: 16 }}>{stage}</T>
      <PulseDots style={{ marginBottom: 14 }} />
      <T style={st.subp} align="center" tabular>
        {secs}s — it usually takes under a minute. You can leave: it carries on, and waits for
        you under Plan a workout.
      </T>
      {onDiscard ? (
        <Press onPress={() => { warn(); onDiscard() }} style={{ marginTop: 14, minHeight: TAP, justifyContent: 'center' }}>
          <T size={13} dim style={st.link}>Stop and throw it away</T>
        </Press>
      ) : null}
    </View>
  )
}

/**
 * The drafts on the first screen: written, being written, or failed. Above the
 * kinds, because a draft is a workout already half planned. Tapping one reopens
 * it at its step; a failed one has its retry on the row. Nothing on this list
 * is in the log, and the row never claims otherwise.
 */
export function DraftList({ drafts = [], onOpen, onRetry, onDiscard }: {
  drafts: any[]; onOpen: (d: any) => void; onRetry: (d: any) => void; onDiscard: (d: any) => void
}) {
  const [now, setNow] = useState(() => Date.now())
  const working = drafts.some(d => d.status === 'working')
  useEffect(() => {
    if (!working) return undefined
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [working])
  if (!drafts.length) return null

  const ask = async (d: any) => {
    if (d.status === 'ready') {
      warn()
      if (!(await confirm(`Throw away “${draftTitle(d)}”?`, { confirmLabel: 'Discard' }))) return
    }
    onDiscard(d)
  }

  return (
    <View style={st.drafts}>
      <View style={st.kindhead}>
        <Icon name="Sparkles" size={14} color={colors.inkDim} />
        <T size={12} weight={600} dim>Drafts — not on your day yet</T>
        <View style={st.kindheadRule} />
      </View>
      {drafts.map(d => {
        const tint = d.status === 'failed' ? colors.bad : colors.accent
        return (
          <View key={d.id} style={[st.draft, d.status === 'ready' && { borderColor: mix(colors.accent, 34, colors.line) }]}>
            <Press onPress={() => onOpen(d)} accessibilityRole="button" style={st.draftOpen}>
              <Icon name={d.status === 'working' ? 'Timer' : d.status === 'failed' ? 'TriangleAlert' : 'ClipboardCheck'} size={17} color={tint} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <T size={14} weight={600} numberOfLines={1}>{draftTitle(d)}</T>
                <T size={12} dim numberOfLines={d.status === 'failed' ? 2 : 1}>{draftLine(d, now)}</T>
              </View>
            </Press>
            {d.status === 'failed' ? <Btn kind="ghost" icon="RotateCw" title="Try again" onPress={() => onRetry(d)} /> : null}
            <Press onPress={() => ask(d)} accessibilityLabel={`Discard ${draftTitle(d)}`} style={st.draftDel}>
              <Icon name="Trash2" size={15} color={colors.inkDim} />
              <T size={12.5} dim>Discard</T>
            </Press>
          </View>
        )
      })}
    </View>
  )
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
export function PlanTalk({ pres, onChange, compact = false, forId = null, draft = null }: any) {
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
      const next: any = (normalizePrescription as any)(raw, { liftField })
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
export function BuildStep({ pres, setPres, liftField, entries = [], categories = [], onKeep, forName = null, head = null }: any) {
  const sets = (prescriptionSteps as any)(pres).length

  return (
    <StepPage
      foot={<Btn icon="Plus" title={forName ? `Put it on ${forName}’s day` : 'Put it on today'} disabled={!sets} onPress={onKeep} style={st.big} />}
      after={
        <T style={st.fine}>
          {sets
            ? 'Nothing is written until you press it. Blocks you left empty are dropped.'
            : 'Add at least one exercise or piece and this becomes a workout you can follow.'}
        </T>
      }
    >
      {head}
      <T style={st.lead}>
        <T size={12.5} dim weight={700}>Add an exercise</T> searches the catalogue of two hundred movements;
        <T size={12.5} dim weight={700}> add a piece</T> is the work that is not one — a swim set, an interval,
        a hold.
      </T>

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
        <T size={13} faint>Add a piece — a swim set, an interval, a hold</T>
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

function ReviewStep({ pres, setPres, liftField, entries = [], categories = [], onRedo, onKeep, forId = null, forName = null, head = null, talk = null }: any) {
  return (
    <StepPage
      foot={
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Btn kind="ghost" icon="RotateCw" title="Redo" onPress={onRedo} />
          <Btn icon="Plus" title={forName ? `Put it on ${forName}’s day` : 'Put it on today'} onPress={onKeep}
            disabled={Boolean(talk?.busy)} style={[st.big, { flex: 1 }]} />
        </View>
      }
    >
      {head}
      <PlanTalk pres={pres} onChange={setPres} forId={forId} draft={talk} />

      <SplitNote parts={(splitPrescription as any)(pres)} />

      <PrescriptionEditor pres={pres} onChange={setPres} liftField={liftField} entries={entries}
        categories={categories} />

      {pres.notes?.length > 0 && (
        <View style={{ marginTop: 16, gap: 7 }}>
          {pres.notes.map((n: string, i: number) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <Icon name="Info" size={13} color={colors.inkFaint} style={{ marginTop: 3 }} />
              <T size={12.5} faint lineHeight={19} style={{ flex: 1 }}>{n}</T>
            </View>
          ))}
        </View>
      )}

      <T style={st.fine}>
        Written by {pres.model || 'a model'} from {forName ? `${forName}’s log and profile` : 'your log and your profile'}.
        Change anything — what it asked for stays on the entry, so you can see afterwards where
        {forName ? ` ${forName} went` : ' you went'} off it.
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
        <T size={13.5} weight={700}>This lands as {parts.length} separate workouts</T>
        <T size={12} dim lineHeight={18}>
          {parts.map(p => p.title).join(' · ')} — each with its own log and its own quota, so
          a ride your watch recorded attaches to the ride. Change a block’s
          <T size={12} color={colors.accent}> counts toward</T> below to move the seams.
        </T>
      </View>
    </View>
  )
}

/**
 * Which quota a BLOCK fills — and therefore where the session SPLITS.
 *
 * "Counts toward" belongs to each workout in the session, not the session as a
 * whole: a run and a lift each go to their own quota. `none` is a real answer and
 * the default for a warm-up — a block that is not a workout in its own right
 * should not quietly fill a quota. See `categoriesOf` in lib/quota.js.
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
          <T size={11.5} faint>
            {picked
              ? <>counts toward <T size={11.5} weight={600} color={colors.accent}>{picked.name}</T></>
              : 'counts toward nothing'}
          </T>
        </View>
      }
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, marginBottom: 2 }}>
        <ImplChip label="Nothing — part of the workout beside it" on={!value} onPress={() => onChange(null)} />
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
export function KeptStep({ pres, count = 1, parts = [], onStart, onAnother, onDone, forName = null }: any) {
  const many = count > 1
  const where = forName ? `on ${forName}’s day` : 'on today'
  return (
    <View style={st.kept}>
      <Icon name="CircleCheck" size={44} color={colors.vizGood} />
      <T size={22} weight={600} lineHeight={27} align="center" style={{ marginTop: 14, marginBottom: 8 }}>
        {many ? `${count} workouts are ${where}` : `${pres.title} is ${where}`}
      </T>

      {/* Named, because "2 workouts" is not an answer to "which two". */}
      {many && (
        <View style={st.keptParts}>
          {parts.map((p: any, i: number) => (
            <View key={i} style={st.keptPart}>
              <T size={14} weight={700}>{p.title}</T>
              <T size={11.5} faint>{(prescriptionLine as any)(p.pres)}</T>
            </View>
          ))}
        </View>
      )}

      <T style={[st.subp, { textAlign: 'center', marginTop: many ? 16 : 0 }]}>
        {many
          ? 'Separate entries, so each one logs on its own and a ride your watch recorded '
            + 'attaches to the ride rather than to the lifting. '
          : `${(prescriptionLine as any)(pres)}. `}
        {forName
          ? `Nothing has started. It shows on ${forName}’s day as planned by you, and ${forName} can edit or log it like anything else.`
          : 'Nothing has started — the clock runs when you do. You can edit any of it from the day, and it will still be there tonight.'}
      </T>

      <View style={st.keptActs}>
        {onStart && (
          <Btn icon="Play" title={forName ? `Open it on ${forName}’s side` : many ? 'Start the first one' : 'Start it now'}
            onPress={() => { impact(); onStart() }} style={{ minHeight: 56 }} />
        )}
        <Btn kind="ghost" icon="Plus" title="Plan another workout" onPress={onAnother} />
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
  const n = (block?.items || []).reduce((sum: number, i: any) => sum + i.sets.length, 0)
  return `${n} set${n === 1 ? '' : 's'}`
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
      {(pres.blocks || []).map((b: any) => (
        <ExerciseSection key={b.id}
          title={b.name}
          count={b.items.length > 0 ? setCount(b) : null}
          items={b.items.map((it: any) => ({ ...it, line: (itemLine as any)(it) }))}
          liftField={liftField} entries={entries} entryId={entryId}
          firstOpenId={firstItemId}
          open={!shut.has(b.id)} onToggle={() => toggleBlock(b.id)}
          extra={
            <BlockQuota categories={categories} value={b.category}
              onChange={(key: string | null) => onChange((patchBlock as any)(pres, b.id, { category: key }))} />
          }
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
            const next: any = (appendLift as any)(pres, liftField, key, { blockId: b.id })
            onChange(next)
            const block = (next.blocks || []).find((x: any) => x.name === b.name) || next.blocks?.[0]
            return block?.items?.at(-1)?.id || null
          }} />
      ))}
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
    paddingTop: 12, paddingHorizontal: 16, backgroundColor: colors.bg,
    shadowColor: colors.bg, shadowOffset: { width: 0, height: -9 }, shadowOpacity: 1, shadowRadius: 9,
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  fork: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  forkBtn: { flexGrow: 1, flexShrink: 1, flexBasis: 148 },
  big: { minHeight: 54 },
  lead: { color: colors.inkDim, fontSize: 12.5, lineHeight: 19, marginBottom: 16 },
  fine: { color: colors.inkDim, fontSize: 11.5, lineHeight: 17, marginTop: 10 },
  subp: { color: colors.inkDim, fontSize: 12.5, lineHeight: 19 },
  link: { textDecorationLine: 'underline' },

  pickedbar: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 18, padding: 10, borderRadius: 12,
    backgroundColor: mix(colors.accent, 8, colors.panel2), borderWidth: 1, borderColor: mix(colors.accent, 26, colors.line),
  },
  pickedchip: {
    flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 34, paddingHorizontal: 10,
    borderRadius: radius.pill, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line,
  },
  pickedchipN: {
    width: 17, height: 17, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent,
  },

  kindhead: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 9 },
  kindheadRule: { flex: 1, height: 1, backgroundColor: colors.line },
  kindcard: {
    flex: 1, gap: 4, alignItems: 'flex-start', padding: 14, minHeight: 96,
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: 12,
  },
  kindcardOn: { borderColor: colors.accent, backgroundColor: mix(colors.accent, 10, colors.panel2) },

  askblock: { marginBottom: 26 },
  chiprow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  timechip: {
    alignItems: 'center', justifyContent: 'center', minWidth: 62, minHeight: 58, paddingVertical: 6, paddingHorizontal: 10,
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: 12,
  },
  timechipOn: { borderColor: colors.accent, backgroundColor: mix(colors.accent, 12, colors.panel2) },
  minstep: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },

  working: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 12 },
  drafts: { gap: 8, marginBottom: 22 },
  draft: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 4,
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: 12,
  },
  draftOpen: { flex: 1, minWidth: 0, minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingLeft: 12 },
  draftDel: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: TAP, paddingHorizontal: 8 },
  failed: { paddingVertical: 24 },
  failedLead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 10 },

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
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 11, minHeight: 34,
    borderRadius: radius.pill, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line,
  },
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
  keptActs: { alignSelf: 'stretch', gap: 10, marginTop: 28 },
})
