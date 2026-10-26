/*
 * The runner — the screen the user trains in front of, rebuilt for a phone.
 * app/src/runner.jsx, native.
 *
 * This replaces `workout.tsx` for PLANNED sessions. That screen is still right
 * for the climbing cards, which are a fixed protocol with a rep clock; this one
 * is for a prescription that was written an hour ago and will be edited mid-set.
 *
 * FIVE DECISIONS, and every one of them is the phone.
 *
 * **The timer lives on the ENTRY, not in this component.** `data.run.restUntil`
 * is an absolute epoch millisecond. Nothing here counts down; it subtracts. So
 * closing Bushido, answering a text and coming back lands on the right second —
 * and so does opening it on the laptop, because the entry syncs. A `useState`
 * counter would have been four lines shorter and wrong the first time the phone
 * locked. This is also why `lib/prescription.js` takes `now` as an argument.
 *
 * **One set fills the screen.** The number under the thumb is the only number
 * that matters; everything else is one tap away in the set list. Everything
 * the user presses mid-set is in the bottom third, where a thumb reaches.
 *
 * **The numbers arrive filled in.** The prescription for an untouched set; what
 * the user actually did on the last set of the same movement once they have
 * moved off it. The target stays on `data.plan` untouched, so the log can still
 * show where the user went off it.
 *
 * **Marking a set is the only required action.** No start, no count-in, no
 * confirm. Rest starts itself off the set just finished, because rest is the
 * tail of a set rather than the head of the next one.
 *
 * **Leaving is not losing.** Every mark writes the entry immediately. There is
 * no "save workout" button and no state that exists only here.
 *
 * Native: the web's fixed `.run` overlay is a full-screen modal this component
 * owns (tabs renders it in place of the day, as on the web, not inside a
 * FullScreen); the set list is a page sheet. The leave confirm is drawn on the
 * screen, as on the web (docs/DESIGN.md, Confirm: a screen, not a system dialog).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  KeyboardAvoidingView, Modal as RNModal, Platform, ScrollView, StyleSheet, View,
  useWindowDimensions, type StyleProp, type ViewStyle,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Circle } from 'react-native-svg'
import { colors, font, radius, space, TAP } from '../theme'
import { T } from '../ui/Text'
import { Btn, Card, IconBtn, Press, SectionHeader, Sub, s as kit, type BtnKind } from '../ui/kit'
import { Modal } from '../ui/Sheet'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { impact, success, tap } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { onForeground } from '../lib/foreground'
import { NumInput } from './numinput'
import { CUES, primeAudio, resumeAudio, acquireWakeLock, releaseWakeLock } from '../lib/cues'
import { lastLift } from '../lib/lifts.js'
import {
  prescriptionSteps, runProgress, firstOpen, restLeft, runElapsed,
  markSet, unmarkSet, skipSet, unskipSet, nudgeRest, endRest, goToSet, finishRun,
  emptyRun, setDraft, carryForward, runOutputs, isLogged, isSkipped, setLine, itemLine,
  setFieldsFor, addSetLike, patchRunItem,
} from '../lib/prescription.js'
import { Stepper, STEP, weightSwitch, type WeightSwap } from './exercises'
import { ExerciseBody, musclesOf, muscleWords } from '../lib/bodymap'
import { liftFieldOf } from './planner'
import { usePlan } from '../lib/planctx.jsx'
import { SideRule, SideWho } from '../ui/Person'

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.abs(s) % 60).padStart(2, '0')}`

/**
 * The runner.
 *
 * ONE writer. `onRun(run, { out, done })` persists the position, and folds in the
 * outputs and the done flag when they changed. It was two calls for about an
 * hour and that was a bug rather than a style: both spread the same `entry` prop,
 * so the second landed on top of the first and every set the user marked came
 * back as set one with the clock at zero. See `saveRun` in tabs.
 *
 * `out` is left off a rest-clock nudge, which changes the position and nothing
 * else — recomputing the lifts, the load level and the minutes on every tick
 * would be work for no change to any of them.
 */
/*
 * `who`, `switcher`, `shown`, `embedded`: a workout run from more than one
 * person's side (trainer.tsx `SidesWorkout`). Each side is its own runner over
 * that person's own entry with its own `onRun`, so there is still ONE writer per
 * entry. `who` ({ name, tone }) names whose side this is in the header, in their
 * colour; a side that is not `shown` keeps its clock but rings nothing.
 * Native: `embedded` drops this component's own full-screen modal, because
 * SidesWorkout presents ONE modal for every side (iOS presents one at a time).
 */
export function WorkoutRunner({ session, entry, entries = [], onRun, onExit, onFinish = null, who = null, switcher = null, shown = true, embedded = false }: {
  session?: any
  entry: any
  entries?: any[]
  onRun: (run: any, opts: any) => void
  onExit: () => void
  onFinish?: (() => void) | null
  who?: { name: string; tone?: number } | null
  switcher?: React.ReactNode
  shown?: boolean
  embedded?: boolean
}) {
  void session
  const insets = useSafeAreaInsets()
  const pres = entry?.data?.plan || null
  const steps: any[] = useMemo(() => prescriptionSteps(pres), [pres])
  const liftField = liftFieldOf(usePlan())
  const run = entry?.data?.run || null

  const [now, setNow] = useState(() => Date.now())
  const [cursor, setCursor] = useState(() => run?.cursor || (firstOpen as any)(run, steps))
  const [draft, setDraft_] = useState<any>(null)
  const [listOpen, setListOpen] = useState(false)
  const [confirmExit, setConfirmExit] = useState(false)
  const [muted, setMuted] = useState(false)
  const lock = useRef<string | null>(null)
  const rangAt = useRef(0)

  const step = steps.find(s => s.setId === cursor) || steps[0] || null
  const progress: any = runProgress(run, steps)
  const rest = restLeft(run, now)
  const elapsed = runElapsed(run, now)
  const done = progress.left === 0 && progress.total > 0

  /* ------------------------------------------------------------ the clock */

  // A repaint tick, nothing more. Every value on screen is derived by
  // subtracting from Date.now(), so a suspended app cannot drift the session —
  // it just repaints less often while nobody is looking.
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(iv)
  }, [])

  // The screen stays on while the user is in here, and the clock resyncs the
  // instant the app comes back from a pocket rather than on the next tick.
  useEffect(() => {
    let live = true
    acquireWakeLock().then(l => { if (live) lock.current = l; else releaseWakeLock(l) })
    const off = onForeground(() => {
      setNow(Date.now())
      resumeAudio()
    })
    return () => {
      live = false
      off()
      releaseWakeLock(lock.current)
    }
  }, [])

  /*
   * The rest bell.
   *
   * Fires once, on the transition to zero, keyed by the deadline it belongs to —
   * `rangAt` rather than a boolean, because a second rest of the same length
   * must ring again and a re-render must not.
   *
   * Native: iOS suspends JS in the background, so a rest that ran out while the
   * phone was locked is noticed on return. A buzz then, seconds or minutes late,
   * would be a false "go now", so only a bell within a few seconds of the
   * deadline rings. The web's service-worker notification has no native
   * counterpart without expo-notifications; the clock is still right on return,
   * which is the guarantee that matters.
   */
  useEffect(() => {
    if (!run?.restUntil || rest > 0) return
    if (rangAt.current === run.restUntil) return
    rangAt.current = run.restUntil
    if (shown && !muted && Date.now() - run.restUntil < 5000) CUES.work()
  }, [rest, run?.restUntil, muted, shown])

  /* ------------------------------------------------------------- the draft */

  // What is in the boxes for the set the user is on. Recomputed when the set
  // changes, never while the user is typing in it.
  useEffect(() => {
    if (!step) { setDraft_(null); return }
    const carried = isLogged(run, step.setId) ? null : carryForward(run, steps, step)
    setDraft_(carried ? { ...setDraft(run, step), ...carried } : setDraft(run, step))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, step?.setId])

  const patch = (p: any) => setDraft_((d: any) => ({ ...(d || {}), ...p }))

  /* ------------------------------------------------------------- the writes */

  /** Persist run state, and the outputs it implies where they changed. */
  const commit = useCallback((nextRun: any, { outputs = false, done = undefined }: { outputs?: boolean; done?: boolean } = {}) => {
    onRun(nextRun, {
      out: outputs ? runOutputs(pres, nextRun, entry?.data?.out || {}) : null,
      done,
    })
  }, [onRun, pres, entry])

  const mark = () => {
    if (!step) return
    primeAudio()
    // A logged set always answers the thumb; the mute is for the clock's cues.
    if (muted) success(); else CUES.setDone()
    const next: any = (markSet as any)(run || emptyRun(), step, draft || {}, { steps })
    commit(next, { outputs: true })
    setCursor(next.cursor)
  }

  const unmark = (setId: string) => {
    tap()
    const next = unmarkSet(run, setId)
    commit(next, { outputs: true })
    setCursor(setId)
  }

  const skip = () => {
    if (!step) return
    tap()
    const next: any = (skipSet as any)(run || emptyRun(), step.setId, { steps })
    commit(next)
    setCursor(next.cursor)
  }

  /**
   * One more set of the one the user is on, with the numbers in the boxes right
   * now. The plan grows a set at the end of this item and nothing else moves:
   * the cursor stays where it is, the draft is untouched, and `out` is left off
   * because no logged set changed. The clock is not started by it either —
   * adding a set is not doing one.
   */
  const addAnother = () => {
    if (!step) return
    impact()
    onRun(run, { plan: (addSetLike as any)(pres, step.itemId, { ...step.set, ...(draft || {}) }) })
  }

  // What this exercise's weight means (#58), on the plan, and on the log in the
  // same write once a set of it is logged, so every set and the log say the same.
  const patchThisItem = (p: any) => {
    if (step) onRun(run, (patchRunItem as any)(pres, run, step.itemId, p, entry?.data?.out || {}, liftField))
  }

  const jump = (setId: string) => {
    tap()
    commit((goToSet as any)(run || emptyRun(), setId))
    setCursor(setId)
    setListOpen(false)
  }

  const finish = () => {
    if (muted) success(); else CUES.finished()
    // Done, the outputs and the end time in one write, for the same reason as
    // above — `onSetDone` used to be a second call and would have taken the run
    // with it.
    commit((finishRun as any)(run || emptyRun()), { outputs: true, done: true })
    // With more than one side, finishing one hands over to the next (SidesWorkout).
    ;(onFinish || onExit)()
  }

  const askExit = () => {
    impact()
    setConfirmExit(true)
  }

  const frame = (body: React.ReactNode) => embedded ? (
    <View style={[st.run, { paddingBottom: insets.bottom }]}>{body}</View>
  ) : (
    <RNModal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={askExit}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={[st.run, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>{body}</View>
      </GestureHandlerRootView>
    </RNModal>
  )

  if (!pres || !steps.length) {
    return frame(
      <View style={st.empty}>
        {switcher}
        <T size={font.body} align="center">This session has no plan on it.</T>
        <Btn title="Back" onPress={onExit} />
      </View>,
    )
  }

  /* ---------------------------------------------------------------- render */

  return frame(
    <>
      <SideRule who={who} />
      <View style={st.head}>
        <IconBtn icon="ChevronDown" size={22} label="Leave the workout" onPress={askExit} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <SideWho who={who} />
          <T size={font.title} weight={600} lineHeight={22} numberOfLines={1}>{pres.title}</T>
          <T size={font.small} dim tabular>{`${progress.done} of ${progress.total} sets`}</T>
        </View>
        <IconBtn icon={muted ? 'VolumeX' : 'Volume2'} size={19} color={muted ? colors.inkFaint : colors.inkDim}
          label={muted ? 'Unmute cues' : 'Mute cues'} onPress={() => setMuted(v => !v)} />
        <T size={font.body} dim tabular style={{ paddingRight: 6 }}>{mmss(elapsed)}</T>
      </View>

      {switcher}

      <View style={st.bar} accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: progress.total, now: progress.done }}>
        <View style={[st.barFill, { width: `${Math.round(progress.pct * 100)}%` }]} />
      </View>

      {rest > 0 ? (
        <RestScreen seconds={rest} of={run.restOf} next={step}
          onAdd={(n: number) => commit((nudgeRest as any)(run, n))}
          onSkip={() => commit(endRest(run))} />
      ) : done ? (
        <FinishScreen progress={progress} elapsed={elapsed}
          onFinish={finish} onReview={() => setListOpen(true)} />
      ) : step ? (
        <SetScreen
          step={step} steps={steps} run={run} draft={draft} entries={entries} entryId={entry?.id}
          briefing={briefingFor(pres, step)}
          onPatch={patch} onMark={mark} onSkip={skip} onUnmark={() => unmark(step.setId)} onAddSet={addAnother}
          onPatchItem={patchThisItem}
          onList={() => setListOpen(true)} />
      ) : null}

      {listOpen && (
        <SetList pres={pres} steps={steps} run={run} cursor={cursor} onJump={jump}
          onUnmark={unmark} onUnskip={(id: string) => { tap(); commit(unskipSet(run, id)); setCursor(id) }}
          onClose={() => setListOpen(false)} onFinish={finish} />
      )}

      {confirmExit && (
        <View style={st.confirm} accessibilityViewIsModal accessibilityLabel="Leave the workout?">
          <View style={st.confirmBox}>
            <T size={font.title} weight={600} style={{ marginBottom: space[2] }}>Leave the workout?</T>
            <Sub>Every set you marked is saved, and the clock keeps running.</Sub>
            {/* One primary: finishing is the decision this asks for; leaving it open
                is the quieter second, and Keep going backs out. */}
            <View style={st.confirmActs}>
              <Btn kind="ghost" title="Keep going" style={st.confirmBtn} onPress={() => setConfirmExit(false)} />
              <Btn kind="secondary" title="Leave it open" style={st.confirmBtn} onPress={onExit} />
              <Btn title="Finish now" style={st.confirmBtn} onPress={() => { setConfirmExit(false); finish() }} />
            </View>
          </View>
        </View>
      )}
    </>,
  )
}

/* ------------------------------------------------------------- one set */

/**
 * The prose a block carries, shown on the set it belongs to.
 *
 * A block may be nothing BUT prose — "5 min easy bike, then two ramp-up sets
 * with the bar" is a real warm-up with no sets in it. That block has no step,
 * so without this it would be invisible for the whole of the session it is the
 * warm-up for.
 *
 * Shown on the FIRST set of a block and nowhere else, because a cue repeated on
 * every set of five is a cue the user stops reading by set two. The leading
 * note-only blocks ride along with the first real set of the session.
 */
function briefingFor(pres: any, step: any) {
  const blocks = pres?.blocks || []
  const here = blocks.findIndex((b: any) => b.id === step.blockId)
  if (here < 0) return []
  const block = blocks[here]
  // Not the first set of the block: the user is mid-way through and has read it.
  if (block.items[0]?.id !== step.itemId || step.index !== 0) return []

  const out: { name: string; note: string }[] = []
  // Prose blocks that come before the first block with any work in it.
  const firstReal = blocks.findIndex((b: any) => b.items.length > 0)
  if (here === firstReal) {
    for (let i = 0; i < here; i += 1) {
      if (!blocks[i].items.length && blocks[i].note) out.push({ name: blocks[i].name, note: blocks[i].note })
    }
  }
  if (block.note) out.push({ name: block.name, note: block.note })
  return out
}

function SetScreen({ step, steps, run, draft, entries, entryId, briefing = [], onPatch, onMark, onSkip, onUnmark, onList, onAddSet, onPatchItem }: any) {
  const { item } = step
  const logged = isLogged(run, step.setId)
  const liftField = liftFieldOf(usePlan())
  const prior: any = useMemo(
    () => (item.exercise ? (lastLift as any)(entries, item.exercise, entryId, liftField) : null),
    [entries, item.exercise, entryId, liftField])
  const muscles = musclesOf(liftField, item.exercise)
  const swap = weightSwitch(liftField, item, onPatchItem)

  const target = setLine(step.set, item)
  const mine = steps.filter((s: any) => s.itemId === item.id)
  const doneHere = mine.filter((s: any) => isLogged(run, s.setId)).length

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={st.body}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        <View style={st.where}>
          <T size={font.small} dim tabular numberOfLines={1} style={{ flexShrink: 1 }}>
            {`${step.blockName} · Set ${step.index + 1} of ${step.of}`}
          </T>
          {/* One more of these, same numbers. Quiet and beside the count it
              changes, because the big button on this screen is for marking a set
              and a second one would compete with it; the 44pt target is padding. */}
          <Press onPress={onAddSet} style={st.addSet} accessibilityRole="button"
            accessibilityLabel={`One more set of ${item.name}, same as this one`}>
            <Icon name="Plus" size={14} color={colors.inkDim} />
            <T size={font.small} dim>Add a set</T>
          </Press>
        </View>

        <T size={font.heading} weight={600} lineHeight={28} align="center" style={{ marginTop: space[3], marginBottom: 2 }}>{item.name}</T>
        {item.implementLabel ? <T size={font.small} dim align="center">{item.implementLabel}</T> : null}

        {/* What it works. Bigger here than anywhere else, because this is the one
            screen the user is looking at while doing it. */}
        {muscles ? (
          <View style={st.bodyMap}>
            <ExerciseBody field={liftField} exercise={item.exercise} name={item.name} size={52} />
            <T size={font.caption} faint style={{ textTransform: 'lowercase' }}>{muscleWords(muscles, 4)}</T>
          </View>
        ) : null}

        {/* What was asked for, always on screen and never in the box. `data.plan`
            is the target, `data.run` is what happened. */}
        <T size={font.small} dim tabular align="center" style={st.target}>
          {'Planned '}<T size={font.body} weight={600} tabular>{target}</T>
        </T>

        {/* The same fields the editor shows, from the same function — a box the
            user can plan in and not record in is worse than no box. */}
        <View style={st.inputs}>
          {setFieldsFor(item, step.set).map((f: string) => (
            <BigStepper key={f} {...(STEP as any)[f](item, step.set)} value={draft?.[f]}
              swap={f === 'weight' ? swap : null}
              onChange={(v: any) => onPatch({ [f]: v })} />
          ))}
        </View>

        {briefing.map((b: any, i: number) => (
          <View key={i} style={st.cue}>
            <Icon name="ClipboardCheck" size={14} color={colors.inkDim} style={{ marginTop: 3 }} />
            <T size={font.small} dim lineHeight={20} style={{ flexShrink: 1 }}>
              <T size={font.small} weight={600}>{`${b.name}.`}</T>{` ${b.note}`}
            </T>
          </View>
        ))}

        {(step.set.note || item.note) ? (
          <View style={st.cue}>
            <Icon name="Info" size={14} color={colors.inkDim} style={{ marginTop: 3 }} />
            <T size={font.small} dim lineHeight={20} style={{ flexShrink: 1 }}>{step.set.note || item.note}</T>
          </View>
        ) : null}

        {prior ? (
          <View style={st.prior}>
            <Icon name="RotateCw" size={13} color={colors.inkDim} />
            <T size={font.small} dim tabular style={{ flexShrink: 1 }}>
              {`last time (${prior.date}): ${prior.summary}${prior.implement ? ` · ${prior.implement}` : ''}`}
            </T>
          </View>
        ) : null}

        {/* Lifting has no programmed rest, and `normalizeSet` drops the field for
            a lift item, so a stepper here would be editing a number nothing
            reads. An interval piece keeps it: the rest at the wall IS the set. */}
        {item.kind !== 'lift' ? (
          <View style={st.restPlan}>
            <Stepper label="rest" value={draft?.restSec ?? step.set.restSec ?? 0} step={15} min={0} suffix=" sec" quiet
              onChange={(v: any) => onPatch({ restSec: v })} />
            <Sub>starts when you mark the set</Sub>
          </View>
        ) : null}
      </ScrollView>

      {/* The bottom third is where a thumb reaches, so everything pressed mid-set
          lives here and nothing else does. ONE primary on this screen (D7): Done
          set. A set already marked offers its undo as a secondary in its place. */}
      <View style={st.acts}>
        {logged ? (
          <RunBtn big kind="secondary" icon="RotateCw" iconSize={20} label="Undo this set" onPress={onUnmark} />
        ) : (
          <RunBtn big icon="Check" iconSize={24} label="Done set" onPress={onMark} />
        )}
        <View style={st.actsRow}>
          <RunBtn kind="quiet" icon="SkipForward" label="Skip" onPress={onSkip} />
          <T size={font.caption} dim tabular align="center" numberOfLines={1} style={{ flex: 1 }}>
            {`${doneHere} of ${step.of} · ${itemLine(item)}`}
          </T>
          <RunBtn kind="quiet" icon="Layers" label="All sets" onPress={onList} />
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}

const RUN_FG: Record<BtnKind, string> = {
  primary: colors.onAccent, secondary: colors.ink, ghost: colors.inkDim, quiet: colors.inkDim, bad: colors.bg,
}
const RUN_BG: Record<BtnKind, ViewStyle> = {
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  secondary: { backgroundColor: colors.panel3, borderColor: colors.lineStrong },
  ghost: { backgroundColor: 'transparent', borderColor: colors.lineStrong },
  quiet: { backgroundColor: 'transparent', borderColor: 'transparent' },
  bad: { backgroundColor: colors.vizCrit, borderColor: colors.vizCrit },
}

/**
 * The kit's button (`kit.btn` and its kinds), with `big` for the runner's one
 * full-width action (64pt, title size) — `.run-acts .btn.big` on the web. Its
 * own because the handlers here choose the haptic (a logged set buzzes success),
 * where the kit's Btn would tap first.
 */
function RunBtn({ kind = 'primary', big, icon, iconSize = 16, label, a11y, onPress, haptic, style }: {
  kind?: BtnKind
  big?: boolean
  icon: string
  iconSize?: number
  label: string
  a11y?: string
  onPress: () => void
  haptic?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const fg = RUN_FG[kind]
  return (
    <Press haptic={haptic} onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y || label}
      style={[kit.btn, RUN_BG[kind], big && st.big, kind === 'quiet' && st.quietBtn, style]}>
      <Icon name={icon} size={iconSize} color={fg} />
      <T size={big ? font.title : font.body} weight={600} color={fg} numberOfLines={1}>{label}</T>
    </Press>
  )
}

/**
 * A number, at the size a phone needs.
 *
 * Its own component rather than the editor's `Stepper` because the two are
 * genuinely different controls: that one sits six to a row in a list, this one
 * is two to a screen with 64pt targets and a value you can read from arm's
 * length on the floor. Its 56pt number is one of the two sizes above
 * font.display (the interval timer's clock is the other, docs/DESIGN.md "Type").
 */
function BigStepper({ label, value, step = 1, min = null, onChange, swap = null }: {
  swap?: WeightSwap
  label: string
  value: any
  step?: number
  min?: number | null
  onChange: (v: any) => void
}) {
  const n = Number(value)
  const bump = (d: number) => {
    tap()
    const next = (Number.isFinite(n) ? n : 0) + d * step
    onChange(min !== null ? Math.max(min, next) : next)
  }
  return (
    <View style={st.bigstep}>
      <Press onPress={() => bump(-1)} style={st.bigstepBtn} accessibilityRole="button" accessibilityLabel={`less ${label}`}>
        <Icon name="Minus" size={26} color={colors.ink} />
      </Press>
      <View style={st.bigstepMid}>
        {/* A placeholder, because an empty box with a label under it reads as a
            control that failed to render. Blank is a real and common state here:
            the planner leaves a weight out rather than invent one, and a dash is
            how the app says "you tell me". */}
        <NumInput accessibilityLabel={label} placeholder="—" placeholderTextColor={colors.inkFaint}
          value={value} onChange={onChange} style={st.bigstepIn} selectTextOnFocus />
        {swap ? (
          <Press onPress={swap.onSwitch} style={st.swap}
            accessibilityRole="button" accessibilityLabel={`Weight in ${label}. Switch to ${swap.next}`}>
            <T size={font.small} dim>{swap.box}</T>
            <Icon name="ArrowLeftRight" size={13} color={colors.inkDim} />
          </Press>
        ) : <T size={font.small} dim>{label}</T>}
      </View>
      <Press onPress={() => bump(1)} style={st.bigstepBtn} accessibilityRole="button" accessibilityLabel={`more ${label}`}>
        <Icon name="Plus" size={26} color={colors.ink} />
      </Press>
    </View>
  )
}

/* ---------------------------------------------------------------- resting */

/**
 * The rest, given the whole screen.
 *
 * Big enough to read from the floor, and the two nudge buttons are the ones the
 * user will actually want: a set that went badly needs another thirty seconds
 * and a set that went well does not need the full ninety. "Skip" is the third,
 * and it is deliberately the quietest of the three — no primary while resting,
 * because the commonest mistake is not resting long enough.
 */
function RestScreen({ seconds, of, next, onAdd, onSkip }: any) {
  const pct = of > 0 ? Math.max(0, Math.min(1, seconds / of)) : 0
  const { width } = useWindowDimensions()
  // The web's conic ring (min(62vw, 230px), the inner 79% cut out), as one arc.
  const size = Math.min(width * 0.62, 230)
  const thick = size * 0.105
  const r = size / 2 - thick / 2
  const circ = 2 * Math.PI * r
  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={[st.body, { justifyContent: 'center' }]}>
        <T size={font.title} weight={600} dim align="center">Rest</T>
        <View style={[st.ring, { width: size, height: size }]}>
          <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
            <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.panel2} strokeWidth={thick} fill="none" />
            {pct > 0 ? (
              <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.accent} strokeWidth={thick} fill="none"
                strokeDasharray={`${circ * pct} ${circ}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
            ) : null}
          </Svg>
          {/* The runner's own clock size (above font.display, as BigStepper's). */}
          <T size={56} weight={600} tabular lineHeight={64}>{mmss(seconds)}</T>
        </View>

        <View style={st.nudge}>
          <RunBtn haptic kind="secondary" icon="Minus" iconSize={18} label="15s" a11y="15 seconds less" style={st.nudgeBtn} onPress={() => onAdd(-15)} />
          <RunBtn haptic kind="secondary" icon="Plus" iconSize={18} label="30s" a11y="30 seconds more" style={st.nudgeBtn} onPress={() => onAdd(30)} />
        </View>

        {next ? (
          <T size={font.small} dim align="center" style={{ marginTop: space[4] }}>
            {'Next: '}<T size={font.small} weight={600}>{next.item.name}</T>
            {` · Set ${next.index + 1} of ${next.of} · ${setLine(next.set, next.item)}`}
          </T>
        ) : null}
      </ScrollView>

      <View style={st.acts}>
        <RunBtn kind="ghost" icon="SkipForward" iconSize={18} label="Skip the rest" style={{ width: '100%' }}
          onPress={() => { tap(); onSkip() }} />
      </View>
    </View>
  )
}

/* --------------------------------------------------------------- finished */

function FinishScreen({ progress, elapsed, onFinish, onReview }: any) {
  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={[st.body, { justifyContent: 'center', alignItems: 'center' }]}>
        <Icon name="CircleCheck" size={44} color={colors.vizGood} />
        <T size={font.heading} weight={600} align="center" style={{ marginTop: space[3], marginBottom: space[1] }}>That is everything</T>
        <Sub style={{ textAlign: 'center' }}>
          {`${progress.done} of ${progress.total} sets in ${mmss(elapsed)}${progress.skipped ? ` · ${progress.skipped} skipped` : ''}`}
        </Sub>
      </ScrollView>
      <View style={st.acts}>
        <RunBtn big icon="Flag" iconSize={22} label="Finish and log it" onPress={onFinish} />
        <View style={[st.actsRow, { justifyContent: 'center' }]}>
          <RunBtn kind="quiet" icon="Layers" label="Go back over the sets" onPress={() => { tap(); onReview() }} />
        </View>
      </View>
    </View>
  )
}

/* -------------------------------------------------------------- every set */

/**
 * The whole session as a list — where you go to jump, to fix a set you marked
 * wrong, or to see what is left. A sheet rather than a permanent column, because
 * on a phone it would cost the set screen the room that makes it readable.
 */
function SetList({ pres, steps, run, cursor, onJump, onUnmark, onUnskip, onClose, onFinish }: any) {
  // Blocks that are only prose have no rows, so they get named here rather than
  // being missing from the one screen that claims to show the whole session.
  const proseBlocks = (pres?.blocks || []).filter((b: any) => !b.items.length && b.note)
  // One section per exercise: its name as the head, its sets as rows in one card.
  const groups: { itemId: string; item: any; blockName: string; sets: any[] }[] = []
  for (const s of steps) {
    const g = groups.at(-1)
    if (g && g.itemId === s.itemId) g.sets.push(s)
    else groups.push({ itemId: s.itemId, item: s.item, blockName: s.blockName, sets: [s] })
  }
  return (
    <Modal title="All sets" onClose={onClose} bodyStyle={{ paddingHorizontal: space.gutter, paddingTop: space[4] }}
      footer={<Btn icon="Flag" title="Finish and log it" flex onPress={onFinish} />}>
      {proseBlocks.map((b: any) => (
        <View key={b.id} style={st.prose}>
          <T size={font.body} weight={600}>{b.name}</T>
          <Sub>{b.note}</Sub>
        </View>
      ))}
      {groups.map((g, gi) => (
        <View key={g.itemId} accessibilityLabel={g.item.name}>
          <SectionHeader title={g.item.name} style={(gi === 0 && !proseBlocks.length) ? { marginTop: 0 } : null}
            right={<Sub style={{ maxWidth: '45%' }}>{g.blockName}</Sub>} />
          <Card style={st.listCard}>
            {g.sets.map((s: any, n: number) => {
              const logged = isLogged(run, s.setId)
              const skipped = isSkipped(run, s.setId)
              const here = s.setId === cursor
              const actual = run?.sets?.[s.setId]
              return (
                <View key={s.setId} style={[st.listRow, n > 0 && st.listRowLine]}>
                  <Press onPress={() => onJump(s.setId)} accessibilityRole="button"
                    accessibilityState={{ selected: here }} style={st.listGo}>
                    <Icon name={logged ? 'CircleCheck' : skipped ? 'SkipForward' : 'Circle'} size={20}
                      color={logged ? colors.vizGood : here ? colors.accent : colors.inkFaint} />
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <T size={font.body} weight={here ? 600 : 500} tabular numberOfLines={1}
                        color={skipped ? colors.inkDim : colors.ink}
                        style={skipped ? { textDecorationLine: 'line-through' } : null}>
                        {logged && actual ? setLine(actual, s.item) : setLine(s.set, s.item)}
                      </T>
                      <T size={font.small} dim tabular>
                        {`Set ${s.index + 1}${logged ? ' · Done' : skipped ? ' · Skipped' : here ? ' · Next' : ''}`}
                      </T>
                    </View>
                  </Press>
                  {logged ? (
                    <IconBtn icon="RotateCw" size={17} label={`Undo set ${s.index + 1} of ${s.item.name}`}
                      onPress={() => onUnmark(s.setId)} />
                  ) : null}
                  {skipped ? (
                    <IconBtn icon="RotateCw" size={17} label={`Put set ${s.index + 1} of ${s.item.name} back`}
                      onPress={() => onUnskip(s.setId)} />
                  ) : null}
                </View>
              )
            })}
          </Card>
        </View>
      ))}
    </Modal>
  )
}

const st = StyleSheet.create({
  run: { flex: 1, backgroundColor: colors.bg },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[3], padding: space[6] },
  head: {
    flexDirection: 'row', alignItems: 'center', gap: space[2],
    paddingHorizontal: 10, paddingVertical: space[2], borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  bar: { height: 3, backgroundColor: colors.panel2 },
  barFill: { height: '100%', backgroundColor: colors.accent },
  body: { flexGrow: 1, paddingTop: space[5], paddingHorizontal: space.gutter, paddingBottom: space[3], width: '100%', maxWidth: 560, alignSelf: 'center' },
  where: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2], height: 20 },
  // "Add a set" beside the count: quiet, and 44pt tall. The negative margins keep
  // the row its own height while the padding reaches the tap size.
  addSet: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[1],
    minHeight: TAP, paddingHorizontal: space[3], marginVertical: -12, borderRadius: radius.pill,
  },
  bodyMap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 10, marginBottom: 2 },
  target: { marginTop: space[4], marginBottom: space[2] },
  inputs: { gap: space[4], marginTop: space[3], marginBottom: space[2] },
  bigstep: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[3] },
  bigstepBtn: {
    width: 64, height: 64, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.lineStrong,
  },
  bigstepMid: { flex: 1, maxWidth: 190, alignItems: 'center', gap: space[1] },
  // The web's .bigstep .stepper-swap: the weight's meaning as a 44px pill (#58).
  swap: {
    flexDirection: 'row', alignItems: 'center', gap: space[1], minHeight: TAP, paddingHorizontal: space[4],
    borderRadius: radius.pill, backgroundColor: colors.panel3, borderWidth: 1, borderColor: colors.lineStrong,
  },
  bigstepIn: {
    width: '100%', padding: 0, paddingHorizontal: 0, paddingVertical: 0, minHeight: 58, textAlign: 'center',
    backgroundColor: 'transparent', borderWidth: 0, color: colors.ink,
    fontSize: 56, fontWeight: '600', fontVariant: ['tabular-nums'],
  },
  cue: { flexDirection: 'row', gap: space[2], alignItems: 'flex-start', justifyContent: 'center', marginTop: space[3] },
  prior: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', marginTop: space[2] },
  restPlan: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[3], marginTop: space[4], marginBottom: space[2], flexWrap: 'wrap' },
  // One primary, full width, where the thumb is.
  acts: { paddingTop: space[3], paddingBottom: space[4], paddingHorizontal: space.gutter, backgroundColor: colors.bg, width: '100%', maxWidth: 560, alignSelf: 'center' },
  big: { width: '100%', minHeight: 64 },
  quietBtn: { paddingHorizontal: space[2] },
  actsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2], marginTop: space[2] },
  ring: { alignSelf: 'center', marginVertical: space[4], alignItems: 'center', justifyContent: 'center' },
  nudge: { flexDirection: 'row', justifyContent: 'center', gap: space[2] },
  nudgeBtn: { minWidth: 112 },
  prose: {
    gap: space[1], marginBottom: space[3], paddingVertical: space[3], paddingHorizontal: space[4],
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.card,
  },
  listCard: { paddingVertical: 0, marginBottom: 0 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  listRowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  listGo: { flex: 1, minWidth: 0, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2] },
  // The leave confirm: a box over the scrim, the clock still running behind it.
  confirm: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.scrim,
    alignItems: 'center', justifyContent: 'center', padding: space[5],
  },
  confirmBox: {
    width: '100%', maxWidth: 420, padding: space[5],
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sheet,
  },
  confirmActs: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[5] },
  confirmBtn: { flexGrow: 1, flexBasis: 118 },
})
