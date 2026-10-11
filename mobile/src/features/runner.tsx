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
 * FullScreen); the leave confirm is a system alert; the set list is a page sheet.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, KeyboardAvoidingView, Modal as RNModal, Platform, ScrollView, StyleSheet, View,
  useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Circle } from 'react-native-svg'
import { colors, radius, TAP } from '../theme'
import { T } from '../ui/Text'
import { Btn, Press } from '../ui/kit'
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
  setFieldsFor, addSetLike,
} from '../lib/prescription.js'
import { Stepper, STEP } from './exercises'
import { ExerciseBody, musclesOf, muscleWords } from '../lib/bodymap'
import { liftFieldOf } from './planner'
import { usePlan } from '../lib/planctx.jsx'

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
export function WorkoutRunner({ session, entry, entries = [], onRun, onExit }: {
  session?: any
  entry: any
  entries?: any[]
  onRun: (run: any, opts: any) => void
  onExit: () => void
}) {
  void session
  const insets = useSafeAreaInsets()
  const pres = entry?.data?.plan || null
  const steps: any[] = useMemo(() => prescriptionSteps(pres), [pres])
  const run = entry?.data?.run || null

  const [now, setNow] = useState(() => Date.now())
  const [cursor, setCursor] = useState(() => run?.cursor || (firstOpen as any)(run, steps))
  const [draft, setDraft_] = useState<any>(null)
  const [listOpen, setListOpen] = useState(false)
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
    if (!muted && Date.now() - run.restUntil < 5000) CUES.work()
  }, [rest, run?.restUntil, muted])

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
    onExit()
  }

  const askExit = () => {
    impact()
    Alert.alert(
      'Leave the workout?',
      'Everything you have marked is already saved, and the rest clock keeps running. Open it again from today and you will be on the same set.',
      [
        { text: 'Keep going', style: 'cancel' },
        { text: 'Leave it open', onPress: onExit },
        { text: 'Finish now', onPress: finish },
      ],
      { cancelable: true, userInterfaceStyle: 'dark' },
    )
  }

  const frame = (body: React.ReactNode) => (
    <RNModal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={askExit}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={[st.run, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>{body}</View>
      </GestureHandlerRootView>
    </RNModal>
  )

  if (!pres || !steps.length) {
    return frame(
      <View style={st.empty}>
        <T size={15} align="center">This session has no plan on it.</T>
        <Btn title="Back" onPress={onExit} />
      </View>,
    )
  }

  /* ---------------------------------------------------------------- render */

  return frame(
    <>
      <View style={st.head}>
        <Press haptic onPress={askExit} style={st.headBtn} accessibilityRole="button" accessibilityLabel="Leave the workout">
          <Icon name="ChevronDown" size={22} color={colors.inkDim} />
        </Press>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T size={15} weight={600} numberOfLines={1}>{pres.title}</T>
          <T size={11.5} faint tabular>{`${progress.done} of ${progress.total} sets`}</T>
        </View>
        <Press haptic onPress={() => setMuted(v => !v)} style={st.headBtn} accessibilityRole="button"
          accessibilityLabel={muted ? 'Unmute cues' : 'Mute cues'}>
          <Icon name={muted ? 'VolumeX' : 'Volume2'} size={19} color={muted ? colors.inkFaint : colors.inkDim} />
        </Press>
        <T size={15} dim tabular style={{ paddingRight: 6 }}>{mmss(elapsed)}</T>
      </View>

      <View style={st.bar} accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: progress.total, now: progress.done }}>
        <View style={[st.barFill, { width: `${Math.round(progress.pct * 100)}%` }]} />
      </View>

      {rest > 0 ? (
        <RestScreen seconds={rest} of={run.restOf} next={step}
          onAdd={(n: number) => commit((nudgeRest as any)(run, n))}
          onSkip={() => commit(endRest(run))} />
      ) : done ? (
        <FinishScreen pres={pres} progress={progress} elapsed={elapsed}
          onFinish={finish} onReview={() => setListOpen(true)} />
      ) : step ? (
        <SetScreen
          step={step} steps={steps} run={run} draft={draft} entries={entries} entryId={entry?.id}
          briefing={briefingFor(pres, step)}
          onPatch={patch} onMark={mark} onSkip={skip} onUnmark={() => unmark(step.setId)} onAddSet={addAnother}
          onList={() => setListOpen(true)} />
      ) : null}

      {listOpen && (
        <SetList pres={pres} steps={steps} run={run} cursor={cursor} onJump={jump}
          onUnmark={unmark} onUnskip={(id: string) => { tap(); commit(unskipSet(run, id)); setCursor(id) }}
          onClose={() => setListOpen(false)} onFinish={finish} />
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

function SetScreen({ step, steps, run, draft, entries, entryId, briefing = [], onPatch, onMark, onSkip, onUnmark, onList, onAddSet }: any) {
  const { item } = step
  const logged = isLogged(run, step.setId)
  const prior: any = useMemo(
    () => (item.exercise ? (lastLift as any)(entries, item.exercise, entryId) : null),
    [entries, item.exercise, entryId])
  const liftField = liftFieldOf(usePlan())
  const muscles = musclesOf(liftField, item.exercise)

  const target = setLine(step.set, item)
  const mine = steps.filter((s: any) => s.itemId === item.id)
  const doneHere = mine.filter((s: any) => isLogged(run, s.setId)).length

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={st.body}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        <View style={st.where}>
          <T size={10.5} faint caps>{step.blockName}</T>
          <T size={10.5} caps color={colors.accent}>{`set ${step.index + 1} of ${step.of}`}</T>
          {/* One more of these, same numbers. Small and beside the count it
              changes, because the enormous button on this screen is for marking
              a set and a second one would compete with it; the 44pt target is
              padding. */}
          <Press onPress={onAddSet} style={st.addSet} accessibilityRole="button"
            accessibilityLabel={`One more set of ${item.name}, same as this one`}>
            <Icon name="Plus" size={12} color={colors.inkFaint} />
            <T size={10.5} faint caps>set</T>
          </Press>
        </View>

        <T size={26} weight={700} lineHeight={30} align="center" style={{ marginTop: 10, marginBottom: 2 }}>{item.name}</T>
        {item.implementLabel ? <T size={12.5} faint align="center">{item.implementLabel}</T> : null}

        {/* What it works. Bigger here than anywhere else, because this is the one
            screen the user is looking at while doing it. */}
        {muscles ? (
          <View style={st.bodyMap}>
            <ExerciseBody field={liftField} exercise={item.exercise} name={item.name} size={52} />
            <T size={12} faint style={{ textTransform: 'lowercase' }}>{muscleWords(muscles, 4)}</T>
          </View>
        ) : null}

        {/* What was asked for, always on screen and never in the box. `data.plan`
            is the target, `data.run` is what happened. */}
        <View style={st.target}>
          <T size={9.5} faint caps>planned</T>
          <T size={15} weight={600} tabular>{target}</T>
        </View>

        {/* The same fields the editor shows, from the same function — a box the
            user can plan in and not record in is worse than no box. */}
        <View style={st.inputs}>
          {setFieldsFor(item, step.set).map((f: string) => (
            <BigStepper key={f} {...(STEP as any)[f](item, step.set)} value={draft?.[f]}
              onChange={(v: any) => onPatch({ [f]: v })} />
          ))}
        </View>

        {briefing.map((b: any, i: number) => (
          <View key={i} style={st.cue}>
            <Icon name="ClipboardCheck" size={14} color={colors.inkDim} style={{ marginTop: 3 }} />
            <T size={13} dim lineHeight={19.5} style={{ flexShrink: 1 }}>
              <T size={13} weight={600}>{`${b.name}.`}</T>{` ${b.note}`}
            </T>
          </View>
        ))}

        {(step.set.note || item.note) ? (
          <View style={st.cue}>
            <Icon name="Info" size={14} color={colors.inkDim} style={{ marginTop: 3 }} />
            <T size={13} dim lineHeight={19.5} style={{ flexShrink: 1 }}>{step.set.note || item.note}</T>
          </View>
        ) : null}

        {prior ? (
          <View style={st.prior}>
            <Icon name="RotateCw" size={13} color={colors.inkFaint} />
            <T size={12} faint tabular style={{ flexShrink: 1 }}>
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
            <T size={11.5} dim>starts when you mark the set</T>
          </View>
        ) : null}
      </ScrollView>

      {/* The bottom third is where a thumb reaches, so everything pressed mid-set
          lives here and nothing else does. */}
      <View style={st.acts}>
        {logged ? (
          <BigDone kind="on" icon="CircleCheck" iconSize={26} label="Done — tap to take it back" onPress={onUnmark} />
        ) : (
          <BigDone icon="Check" iconSize={28} label={`Mark set ${step.index + 1}`} onPress={onMark} />
        )}
        <View style={st.actsRow}>
          <Minor icon="SkipForward" label="skip" onPress={onSkip} />
          <T size={11} faint align="center" numberOfLines={1} style={{ flex: 1 }}>
            {`${doneHere}/${step.of} of this one · ${itemLine(item)}`}
          </T>
          <Minor icon="Layers" label="all sets" onPress={onList} />
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}

/** .run-done: the one enormous button. `on` is a logged set, `ghost` the rest skip. */
function BigDone({ kind, icon, iconSize, label, onPress }: {
  kind?: 'on' | 'ghost'
  icon: string
  iconSize: number
  label: string
  onPress: () => void
}) {
  const fg = kind === 'on' ? colors.vizGood : kind === 'ghost' ? colors.inkDim : colors.bg
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={[st.done, kind === 'on' && st.doneOn, kind === 'ghost' && st.doneGhost]}>
      <Icon name={icon} size={iconSize} color={fg} />
      <T size={kind === 'on' ? 15 : 19} weight={700} color={fg}>{label}</T>
    </Press>
  )
}

/** .run-minor */
function Minor({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <Press onPress={onPress} style={st.minor} accessibilityRole="button">
      <Icon name={icon} size={16} color={colors.inkFaint} />
      <T size={12.5} faint>{label}</T>
    </Press>
  )
}

/**
 * A number, at the size a phone needs.
 *
 * Its own component rather than the editor's `Stepper` because the two are
 * genuinely different controls: that one sits six to a row in a list, this one
 * is two to a screen with 68pt targets and a value you can read from arm's
 * length on the floor.
 */
function BigStepper({ label, value, step = 1, min = null, onChange }: {
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
        <Icon name="Minus" size={26} color={colors.inkDim} />
      </Press>
      <View style={st.bigstepMid}>
        {/* A placeholder, because an empty box with a label under it reads as a
            control that failed to render. Blank is a real and common state here:
            the planner leaves a weight out rather than invent one, and a dash is
            how the app says "you tell me". */}
        <NumInput accessibilityLabel={label} placeholder="—" placeholderTextColor={colors.inkFaint}
          value={value} onChange={onChange} style={st.bigstepIn} selectTextOnFocus />
        <T size={11} faint caps>{label}</T>
      </View>
      <Press onPress={() => bump(1)} style={st.bigstepBtn} accessibilityRole="button" accessibilityLabel={`more ${label}`}>
        <Icon name="Plus" size={26} color={colors.inkDim} />
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
 * and it is deliberately the quietest of the three — the commonest mistake is
 * not resting long enough.
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
        <T size={11} faint align="center" style={{ textTransform: 'uppercase', letterSpacing: 1.3 }}>rest</T>
        <View style={[st.ring, { width: size, height: size }]}>
          <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
            <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.panel2} strokeWidth={thick} fill="none" />
            {pct > 0 ? (
              <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.accent} strokeWidth={thick} fill="none"
                strokeDasharray={`${circ * pct} ${circ}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
            ) : null}
          </Svg>
          <T size={54} weight={700} tabular lineHeight={62} style={{ letterSpacing: -1 }}>{mmss(seconds)}</T>
        </View>

        <View style={st.nudge}>
          <Press haptic onPress={() => onAdd(-15)} style={st.nudgeBtn} accessibilityRole="button" accessibilityLabel="15 seconds less">
            <Icon name="Minus" size={20} color={colors.inkDim} />
            <T size={15} weight={600} dim tabular>15s</T>
          </Press>
          <Press haptic onPress={() => onAdd(30)} style={st.nudgeBtn} accessibilityRole="button" accessibilityLabel="30 seconds more">
            <Icon name="Plus" size={20} color={colors.inkDim} />
            <T size={15} weight={600} dim tabular>30s</T>
          </Press>
        </View>

        {next ? (
          <T size={13} faint align="center" style={{ marginTop: 18 }}>
            {'next: '}<T size={13} weight={600} dim>{next.item.name}</T>
            {` · set ${next.index + 1} of ${next.of} · ${setLine(next.set, next.item)}`}
          </T>
        ) : null}
      </ScrollView>

      <View style={st.acts}>
        <BigDone kind="ghost" icon="SkipForward" iconSize={24} label="Skip the rest" onPress={() => { tap(); onSkip() }} />
      </View>
    </View>
  )
}

/* --------------------------------------------------------------- finished */

function FinishScreen({ pres, progress, elapsed, onFinish, onReview }: any) {
  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={[st.body, { justifyContent: 'center', alignItems: 'center' }]}>
        <Icon name="CircleCheck" size={44} color={colors.vizGood} />
        <T size={24} weight={700} align="center" style={{ marginTop: 12, marginBottom: 6 }}>That is everything</T>
        <T size={12.5} dim align="center" lineHeight={19}>
          {`${progress.done} of ${progress.total} sets in ${mmss(elapsed)}${progress.skipped ? ` · ${progress.skipped} skipped` : ''}.`}
        </T>
        <T size={12.5} dim align="center" lineHeight={19} style={{ marginTop: 12 }}>
          {`Finishing marks the session done and writes what you did into the log, where you can edit any of it. ${pres.title} stays on the entry as what was asked for.`}
        </T>
      </ScrollView>
      <View style={st.acts}>
        <BigDone icon="Flag" iconSize={26} label="Finish and log it" onPress={onFinish} />
        <View style={[st.actsRow, { justifyContent: 'center' }]}>
          <Minor icon="Layers" label="go back over the sets" onPress={() => { tap(); onReview() }} />
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
  let lastItem: string | null = null
  // Blocks that are only prose have no rows, so they get named here rather than
  // being missing from the one screen that claims to show the whole session.
  const proseBlocks = (pres?.blocks || []).filter((b: any) => !b.items.length && b.note)
  return (
    <Modal title="Every set" onClose={onClose} bodyStyle={{ paddingHorizontal: 12, paddingTop: 8 }}
      footer={<Btn icon="Flag" title="Finish and log it" flex onPress={onFinish} />}>
      {proseBlocks.map((b: any) => (
        <View key={b.id} style={st.prose}>
          <T size={14} weight={600}>{b.name}</T>
          <T size={12} dim lineHeight={18}>{b.note}</T>
        </View>
      ))}
      {steps.map((s: any) => {
        const head = s.itemId !== lastItem ? s : null
        lastItem = s.itemId
        const logged = isLogged(run, s.setId)
        const skipped = isSkipped(run, s.setId)
        const actual = run?.sets?.[s.setId]
        return (
          <View key={s.setId}>
            {head ? (
              <View style={st.listItem}>
                <T size={13.5} weight={600} style={{ flexShrink: 1 }}>{s.item.name}</T>
                <T size={10.5} dim caps>{s.blockName}</T>
              </View>
            ) : null}
            <View style={st.listRow}>
              <Press onPress={() => onJump(s.setId)} accessibilityRole="button"
                style={[st.listGo, s.setId === cursor && { borderColor: colors.accent },
                  logged && { borderLeftWidth: 3, borderLeftColor: colors.vizGood }, skipped && { opacity: 0.55 }]}>
                <T size={11} faint tabular align="center" style={{ width: 22 }}>{String(s.index + 1)}</T>
                <T size={13.5} tabular style={{ flex: 1, minWidth: 0 }} numberOfLines={2}>
                  {logged && actual ? setLine(actual, s.item) : setLine(s.set, s.item)}
                </T>
                {logged ? <T size={9.5} caps color={colors.vizGood}>done</T> : null}
                {skipped ? <T size={9.5} caps faint>skipped</T> : null}
              </Press>
              {logged ? (
                <Press onPress={() => onUnmark(s.setId)} style={st.listUndo} accessibilityRole="button" accessibilityLabel="Un-mark this set">
                  <Icon name="RotateCw" size={15} color={colors.inkFaint} />
                </Press>
              ) : null}
              {skipped ? (
                <Press onPress={() => onUnskip(s.setId)} style={st.listUndo} accessibilityRole="button" accessibilityLabel="Put this set back">
                  <Icon name="RotateCw" size={15} color={colors.inkFaint} />
                </Press>
              ) : null}
            </View>
          </View>
        )
      })}
    </Modal>
  )
}

const st = StyleSheet.create({
  run: { flex: 1, backgroundColor: colors.bg },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  head: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  headBtn: { width: TAP, height: TAP, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  bar: { height: 3, backgroundColor: colors.panel2 },
  barFill: { height: '100%', backgroundColor: colors.accent },
  body: { flexGrow: 1, paddingTop: 18, paddingHorizontal: 16, paddingBottom: 12, width: '100%', maxWidth: 560, alignSelf: 'center' },
  where: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 20 },
  addSet: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    minHeight: TAP, minWidth: TAP, paddingHorizontal: 10, marginVertical: -12, marginLeft: 2, borderRadius: radius.pill,
    justifyContent: 'center',
  },
  bodyMap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 10, marginBottom: 2 },
  target: {
    flexDirection: 'row', alignItems: 'baseline', gap: 8, alignSelf: 'center',
    marginTop: 16, marginBottom: 8, paddingVertical: 7, paddingHorizontal: 14, borderRadius: radius.pill,
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line,
  },
  inputs: { gap: 12, marginTop: 14, marginBottom: 6 },
  bigstep: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  bigstepBtn: {
    width: 68, height: 68, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line,
  },
  bigstepMid: { flex: 1, maxWidth: 190, alignItems: 'center' },
  bigstepIn: {
    width: '100%', padding: 0, paddingHorizontal: 0, paddingVertical: 0, minHeight: 50, textAlign: 'center',
    backgroundColor: 'transparent', borderWidth: 0, color: colors.ink,
    fontSize: 46, fontWeight: '700', fontVariant: ['tabular-nums'],
  },
  cue: { flexDirection: 'row', gap: 7, alignItems: 'flex-start', justifyContent: 'center', marginTop: 12 },
  prior: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  restPlan: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 18, marginBottom: 8, flexWrap: 'wrap' },
  acts: { paddingTop: 14, paddingBottom: 16, paddingHorizontal: 16, backgroundColor: colors.bg, width: '100%', maxWidth: 560, alignSelf: 'center' },
  done: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12,
    width: '100%', minHeight: 72, borderRadius: 18, backgroundColor: colors.accent,
  },
  doneOn: { backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.vizGood },
  doneGhost: { backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line },
  actsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 10 },
  minor: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: TAP, paddingHorizontal: 10, borderRadius: 9 },
  ring: { alignSelf: 'center', marginVertical: 18, alignItems: 'center', justifyContent: 'center' },
  nudge: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  nudgeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 52, paddingHorizontal: 20, borderRadius: 14,
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line,
  },
  prose: {
    gap: 3, marginTop: 10, marginBottom: 12, paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: 9,
  },
  listItem: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 14, marginBottom: 6 },
  listRow: { flexDirection: 'row', alignItems: 'stretch', gap: 6, marginBottom: 5 },
  listGo: {
    flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10,
    minHeight: TAP, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 9,
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line,
  },
  listUndo: {
    width: TAP, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.line, borderRadius: 9,
  },
})
