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
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  KeyboardAvoidingView, Modal as RNModal, Platform, ScrollView, StyleSheet, View,
  useWindowDimensions, type StyleProp, type ViewStyle,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Circle } from 'react-native-svg'
import { colors, font, mix, radius, space, TAP, clockSize, height } from '../theme'
import { T } from '../ui/Text'
import { Btn, Card, IconBtn, Press, SectionHeader, Sub, Toggle, s as kit, type BtnKind } from '../ui/kit'
import { Modal } from '../ui/Sheet'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import ToastHost from '../ui/ToastHost'
import { useKeyboardShown } from '../ui/KeyboardBar'
import { showActs } from '../ui/sheetPolicy'
import { impact, success, tap, warn } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { onForeground } from '../lib/foreground'
import { NumInput } from './numinput'
import { CUES, primeAudio, resumeAudio, acquireWakeLock, releaseWakeLock } from '../lib/cues'
import { lastLift, liftFieldOf } from '../lib/lifts.js'
import {
  isLogged, isSkipped, setLine, itemLine, setFieldsFor, measureOfItem, blockTimer, circuitOnly, circuitTiming,
} from '../lib/prescription.js'
import * as timerLib from '../lib/timer.js'
import { useRunner, circuitTick } from '../lib/runflow.js'
import { clock } from '../lib/workout.js'
import { TimerRun, WorkHead, LeaveDialog, leaveActions, ControlRow, setsWord, KIND_COLOR } from './timer'
import { timingWords } from './circuit'
import * as trainerLib from '../lib/trainer.js'
import { Stepper, boxFor, stepBox, TimeInput, weightSwitch, ExerciseSheet, type WeightSwap } from './exercises'
import { ExerciseBody, musclesOf, muscleWords } from '../lib/bodymap'
import { usePlan } from '../lib/planctx.jsx'
import { dayPhrase } from '../lib/dates.js'

const { back: tBack, bump: tBump, skip: tSkip, togglePause, view: tView, isTimedSet } = timerLib

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
/*
 * `together` (trainer.tsx `SidesWorkout`, #68): on a shared workout with sync on,
 * a circuit waits on its start screen, where "Together with Sam" is chosen, and
 * one run in front of you is written to every side when it ends.
 */
export function WorkoutRunner({ session, entry, entries = [], onRun, onExit, onFinish = null, who = null, switcher = null, shown = true, embedded = false, together = null }: {
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
  together?: any
}) {
  void session
  const insets = useSafeAreaInsets()
  const liftField = liftFieldOf(usePlan())
  const lock = useRef<string | null>(null)
  // The state and every tap's write are lib/runflow.js, the web's own; this
  // file is the screens, and the phone's cues and haptics.
  const r = useRunner({ entry, onRun, onExit, onFinish, shown, together, liftField, feedback: nativeFeedback })
  const { pres, steps, run, step, progress, rest, restPaused, elapsed, done, hold, holdProgram, holdNow, muted, circuitBlock } = r

  // The screen stays on while the user is in here, and the clock resyncs the
  // instant the app comes back from a pocket rather than on the next tick.
  useEffect(() => {
    let live = true
    acquireWakeLock().then(l => { if (live) lock.current = l; else releaseWakeLock(l) })
    const off = onForeground(() => {
      r.tick()
      resumeAudio()
    })
    return () => {
      live = false
      off()
      releaseWakeLock(lock.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- once per runner; `tick` only sets the clock

  const askExit = r.askLeave

  const frame = (body: React.ReactNode) => embedded ? (
    <View style={[st.run, { paddingBottom: insets.bottom }]}>{body}</View>
  ) : (
    <RNModal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={askExit}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={[st.run, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>{body}</View>
        {/* This screen's own toasts: iOS draws it above the root's host (#94, F N6). */}
        <ToastHost />
      </GestureHandlerRootView>
    </RNModal>
  )

  if (circuitBlock) {
    const only = circuitOnly(pres)
    const body = (
      <CircuitRun key={circuitBlock.id} pres={pres} block={circuitBlock} run={run} only={only}
        together={together} onShare={r.shareResult} shared={r.shared} onRetry={r.retryShared}
        intro={r.chained ? `Next: ${circuitBlock.name}` : null}
        onNext={r.circuitNext}
        who={who} switcher={switcher} shown={shown}
        onRun={r.circuitWrite}
        onBack={() => r.circuitBack(only)}
        onLeave={onExit} />
    )
    // The timer pads its own foot, so its frame pads only the top.
    return embedded ? <View style={{ flex: 1 }}>{body}</View> : (
      <RNModal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onExit}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>{body}</View>
          {/* This screen's own toasts: iOS draws it above the root's host (#94, F N6). */}
          <ToastHost />
        </GestureHandlerRootView>
      </RNModal>
    )
  }

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
      <WorkHead title={pres.title} who={who} muted={muted} onMute={r.setMuted}
        sub={`${progress.done} of ${progress.total} sets · ${mmss(elapsed)}`}
        onExit={askExit} />

      {switcher}

      <View style={st.bar} accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: progress.total, now: progress.done }}>
        <View style={[st.barFill, { width: `${Math.round(progress.pct * 100)}%` }]} />
      </View>

      {rest > 0 ? (
        // After the last set the cursor stays on it: no "Next" that is the set just done (#98 review).
        <RestScreen seconds={rest} of={run.restOf} next={step && !isLogged(run, step.setId) ? step : null} paused={restPaused}
          onBack={r.restGoBack} onBump={r.restBump} onPause={r.restPause} onSkip={r.restSkip} />
      ) : done ? (
        <FinishScreen progress={progress} elapsed={elapsed}
          onFinish={r.finish} onReview={r.openList} />
      ) : step?.block?.circuit ? (
        <CircuitStep block={step.block} together={together}
          onStart={() => { impact(); r.startCircuit(step.blockId) }}
          onList={() => { tap(); r.openList() }}
          onSkip={() => { warn(); r.askSkipCircuit() }} />
      ) : hold && holdNow ? (
        <HoldScreen step={step} program={holdProgram} timer={holdNow} now={r.now}
          onFace={() => r.holdAct(togglePause)}
          onBack={() => r.holdAct(tBack)} onBump={(n: number) => r.holdAct(tBump, n)} onPause={() => r.holdAct(togglePause)}
          onSkip={() => r.holdAct(tSkip)} onStop={r.stopHold} />
      ) : step ? (
        <SetScreen
          step={step} steps={steps} run={run} draft={r.draft} entries={entries} entryId={entry?.id}
          briefing={briefingFor(pres, step)}
          onPatch={r.patch} onMark={r.mark} onSkip={r.skip} onUnmark={() => r.unmark(step.setId)} onAddSet={r.addSet}
          onStartHold={r.beginHold}
          onPatchItem={r.patchItem}
          onList={r.openList} />
      ) : null}

      {r.listOpen && (
        <SetList pres={pres} steps={steps} run={run} cursor={r.cursor} onJump={r.jump}
          onUnmark={r.unmark} onUnskip={r.unskip}
          onClose={r.closeList} onFinish={progress.left === 0 ? r.finish : null} />
      )}

      {r.leaving === 'ask' ? (
        <LeaveDialog title="Leave the workout?"
          body="Every set you marked is saved, and the clock keeps running."
          onKeep={r.keepGoing}
          actions={leaveActions({ left: progress.left, onLeave: onExit, onFinish: r.finish, onAskFinish: () => { warn(); r.askFinish() } })} />
      ) : null}
      {r.leaving === 'finish' ? (
        <LeaveDialog title={`Finish with ${setsWord(progress.left)} left?`}
          body="They stay unmarked. Start on the workout's sheet opens it again."
          onKeep={r.keepGoing}
          actions={[{ label: 'Finish anyway', kind: 'secondary', onClick: r.finish }]} />
      ) : null}
      {r.skipping && step?.block?.circuit ? (
        <LeaveDialog title={`Skip ${step.block.name}?`}
          body="None of the circuit is logged. All sets puts it back."
          keepLabel="Keep it" onKeep={r.keepCircuit}
          actions={[{ label: 'Skip the circuit', kind: 'secondary', onClick: r.skipCircuit }]} />
      ) : null}
    </>,
  )
}

/**
 * The phone's cues and haptics for the runner's taps (lib/runflow.js
 * `feedback`). A logged set always answers the thumb: muted, it is a haptic
 * instead of the cue. A hold's end on a side not on screen is silent, as on the
 * web; a late rest bell (the phone was locked through the deadline) would be a
 * false "go now", so only one within a few seconds of it rings. The web's
 * service-worker notification has no native counterpart without a native module.
 */
function nativeFeedback(event: string, { muted, shown, cue, restUntil }: { muted: boolean; shown: boolean; cue?: string; restUntil?: number }) {
  switch (event) {
    case 'mark': primeAudio(); if (muted) success(); else CUES.setDone(); break
    case 'holdEnd': if (shown) { if (muted) success(); else CUES.setDone() } break
    case 'finish': if (muted) success(); else CUES.finished(); break
    case 'unmark': case 'skip': case 'unskip': case 'jump': case 'holdStop': tap(); break
    case 'addSet': case 'holdStart': impact(); break
    case 'cue': (CUES as any)[cue as string]?.(); break
    case 'restOver': if (!muted && restUntil != null && Date.now() - restUntil < 5000) CUES.work(); break
    default: break
  }
}

/* --------------------------------------------------------------- circuits */

/**
 * A circuit block, run on the interval timer's screen (timer.tsx `TimerRun`),
 * its program compiled from the block (lib/prescription.js `blockTimer`). The
 * timer's position lives on the entry as `run.circuit`, written through the
 * runner's one writer. When it ends, finished or stopped, what each exercise
 * did each round is marked on the run (`endCircuit`) and the log follows in the
 * same write; a plan that is nothing but circuits is finished and done in it
 * too. Stopped before anything was done, it is as if it never started.
 */
function CircuitRun({ pres, block, run, only, intro, who, switcher, shown, onRun, onNext, onBack, onLeave,
  together = null, onShare = null, shared = [], onRetry = null }: any) {
  const { compile, startRun } = timerLib
  const { andWords, togetherSaid } = trainerLib
  const config = useMemo(() => blockTimer(block), [block])
  const program = useMemo(() => compile(config), [config])
  const live = run?.circuit?.block === block.id && run.circuit.timer ? run.circuit.timer : null
  const [initial] = useState(() => live || startRun(program, Date.now()))
  // Together or not is decided at Start, and kept on the entry so a cold start remembers it.
  const [withThem] = useState(() => Boolean(together && (live ? run.circuit.together : together.offer && together.on)))
  // Who was offered Together as it started (side ids, null the owner): the only
  // people its result is written for, kept on the run for a reload.
  const [withIds] = useState(() => (live ? run.circuit.with || null : together?.offerTo || null))
  const [logged, setLogged] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const runRef = useRef(run)
  runRef.current = run

  // Every change of the clock, and what follows it, is lib/runflow.js `circuitTick`.
  const onTimer = (timer: any) => {
    const t = circuitTick({ run: runRef.current, pres, block, program, timer, only, together: withThem, withIds })
    onRun(...t.write)
    if (t.back) { onBack(); return }
    if (t.ended) success()
    // Done together: the same result on every other side, each through its own writer.
    if (t.share && onShare) onShare(t.share)
    // A plan of circuits runs the next one straight after, not back to the day.
    if (t.next) { onNext(t.next); return }
    if (t.logged) setLogged(t.logged)
  }
  // Starting is a write: the entry says it is running from the first second.
  useEffect(() => { if (!live) onTimer(initial) }, []) // eslint-disable-line react-hooks/exhaustive-deps -- once, as the circuit opens

  // Done together, the words come from what each side SAID (rule 5); never
  // "for you and Sam" over a miss.
  const mine = shared.find((x: any) => x.result.block.id === block.id)
  const told = withThem && mine ? togetherSaid(together.host, mine.said) : null
  const missedAll: string[] = [...new Set<string>(shared.flatMap((x: any) => (x.said || []).filter((y: any) => y.status === 'missed').map((y: any) => y.name)))]
  const after = told || missedAll.length ? (
    <View style={{ alignSelf: 'stretch', alignItems: 'center', gap: space[2] }}>
      {told?.notes.map((n: string) => <T key={n} size={font.body}>{n}</T>)}
      {mine && mine.said === null ? <T size={font.label} dim>Saving to {andWords(together.names)}’s log…</T> : null}
      {missedAll.length ? (
        <>
          <T size={font.body} accessibilityRole="alert">Not on {andWords(missedAll)}’s log yet</T>
          <Btn kind="secondary" icon="RotateCw" title="Try again" onPress={onRetry} style={{ alignSelf: 'stretch' }} />
        </>
      ) : null}
    </View>
  ) : null

  return (
    <TimerRun name={block.name} title={pres.title && pres.title !== block.name ? pres.title : null}
      config={config} initialRun={initial} onRun={onTimer} logged={told && logged ? told.head : logged} intro={intro} after={after}
      onStop={() => setConfirming(true)} confirming={confirming} onKeep={() => setConfirming(false)}
      onClose={onBack} onLeave={onLeave} closeLabel={only ? 'Close' : 'Back to the workout'}
      who={who} switcher={switcher} shown={shown} />
  )
}

/**
 * A circuit's start screen: what it is, and Start. On a shared workout with
 * sync on it also asks whether it is done together: one clock, logged for
 * everyone in it. Remembered per device; on until turned off.
 */
function CircuitStep({ block, onStart, onSkip, onList, together = null }: any) {
  const { compile, describe, totalSeconds } = timerLib
  const { andWords } = trainerLib
  const config = blockTimer(block)
  const total = totalSeconds(compile(config))
  return (
    <ScrollView contentContainerStyle={{ padding: space.gutter, gap: space[3] }}>
      {/* Skipping a whole circuit is at the top, away from Start, and asks first. */}
      <View style={[st.where, { justifyContent: 'space-between' }]}>
        <T size={font.label} dim numberOfLines={1} style={{ flexShrink: 1 }}>{block.name} · Circuit</T>
        <Press onPress={onSkip} style={st.addSet} accessibilityRole="button" accessibilityLabel={`Skip ${block.name}`}>
          <Icon name="SkipForward" size={14} color={colors.inkDim} />
          <T size={font.label} dim>Skip</T>
        </Press>
      </View>
      <T size={font.screen} weight={600}>{block.name}</T>
      <T size={font.label} dim>{describe(config)}{total ? ` · ${clock(total)}` : ''}</T>
      <Card style={{ padding: 0 }}>
        {block.items.map((it: any, i: number) => (
          <View key={it.id} style={[{ flexDirection: 'row', justifyContent: 'space-between', gap: space[3], padding: space[3] },
            i > 0 && { borderTopWidth: 1, borderTopColor: colors.line }]}>
            <T size={font.body} style={{ flexShrink: 1 }}>{it.name}</T>
            <T size={font.label} dim tabular>{timingWords(circuitTiming(it) as any, block.circuit.work)}</T>
          </View>
        ))}
      </Card>
      {together?.offer && !together.busyOn ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3],
          padding: space[3], borderRadius: radius.card, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line }}>
          <View style={{ flexShrink: 1 }}>
            <T size={font.body}>{together.words}</T>
            <T size={font.label} dim>{together.on ? `One clock, logged for ${andWords([together.host, ...together.names])}` : 'Each of you starts your own'}</T>
          </View>
          <Toggle value={together.on} onChange={together.onToggle} />
        </View>
      ) : null}
      {together?.busyOn ? (
        <T size={font.label} dim>Running together on {together.busyOn === 'your' ? 'your' : `${together.busyOn}’s`} side. It logs here when it ends.</T>
      ) : (
        <>
          <Btn icon="Play" title="Start the circuit" onPress={onStart} style={{ minHeight: height.run }} />
          <Btn kind="quiet" icon="Layers" title="All sets" onPress={onList} />
        </>
      )}
    </ScrollView>
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

function SetScreen({ step, steps, run, draft, entries, entryId, briefing = [], onPatch, onMark, onSkip, onUnmark, onList, onAddSet, onPatchItem, onStartHold }: any) {
  const { item } = step
  const logged = isLogged(run, step.setId)
  const liftField = liftFieldOf(usePlan())
  const prior: any = useMemo(
    () => (item.exercise ? lastLift(entries, item.exercise, entryId, liftField, item.kind === 'lift' ? measureOfItem(item) : null) : null),
    [entries, item, entryId, liftField])
  const muscles = musclesOf(liftField, item.exercise)
  const swap = weightSwitch(liftField, item, onPatchItem)
  const [about, setAbout] = useState(false)

  const target = setLine(step.set, item)
  const mine = steps.filter((s: any) => s.itemId === item.id)
  const doneHere = mine.filter((s: any) => isLogged(run, s.setId)).length
  const fields: string[] = setFieldsFor(item, step.set)
  // Seconds and nothing else counted: the primary starts its clock (#75).
  const timed = !logged && isTimedSet(fields, { seconds: draft?.seconds ?? step.set.seconds })
  const holdFor = Number(draft?.seconds) > 0 ? Number(draft.seconds) : Number(step.set.seconds)
  const typing = useKeyboardShown()

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={st.body}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        {/* Skip is up here, beside the count it changes, and not under Done set:
            the two were 8pt apart where the thumb works (#75). A skip is put back
            from All sets. */}
        <View style={st.where}>
          <T size={font.label} dim tabular numberOfLines={1} style={{ flexShrink: 1 }}>
            {`${step.blockName} · Set ${step.index + 1} of ${step.of}`}
          </T>
          {!logged ? (
            <Press onPress={onSkip} style={st.addSet} accessibilityRole="button"
              accessibilityLabel={`Skip set ${step.index + 1} of ${item.name}`}>
              <Icon name="SkipForward" size={14} color={colors.inkDim} />
              <T size={font.label} dim>Skip</T>
            </Press>
          ) : null}
        </View>

        {/* A catalog movement's name opens what it is (issue #63), for the set
            you are about to do; nothing else on this screen moves. */}
        {item.exercise ? (
          <Press onPress={() => { tap(); setAbout(true) }} style={st.moveAbout}
            accessibilityRole="button" accessibilityLabel={`${item.name}: how to do it`}>
            <T size={font.screen} weight={600} align="center" style={{ flexShrink: 1 }}>{item.name}</T>
            <Icon name="Info" size={18} color={colors.inkFaint} />
          </Press>
        ) : (
          <T size={font.screen} weight={600} align="center" style={{ marginTop: space[3], marginBottom: 2 }}>{item.name}</T>
        )}
        {about ? <ExerciseSheet field={liftField} exercise={item.exercise} name={item.name} onClose={() => setAbout(false)} /> : null}
        {item.implementLabel ? <T size={font.label} dim align="center">{item.implementLabel}</T> : null}

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
        <T size={font.label} dim tabular align="center" style={st.target}>
          {'Planned '}<T size={font.body} weight={600} tabular>{target}</T>
        </T>

        {/* The same fields the editor shows, from the same function — a box the
            user can plan in and not record in is worse than no box. */}
        <View style={st.inputs}>
          {fields.map((f: string) => (
            <BigStepper key={f} {...boxFor(f, item, step.set)} value={draft?.[f]}
              swap={f === 'weight' ? swap : null}
              onChange={(v: any) => onPatch({ [f]: v })} />
          ))}
        </View>

        {briefing.map((b: any, i: number) => (
          <View key={i} style={st.cue}>
            <Icon name="ClipboardCheck" size={14} color={colors.inkDim} style={{ marginTop: space[1] }} />
            <T size={font.label} dim style={{ flexShrink: 1 }}>
              <T size={font.label} weight={600}>{`${b.name}.`}</T>{` ${b.note}`}
            </T>
          </View>
        ))}

        {(step.set.note || item.note) ? (
          <View style={st.cue}>
            <Icon name="Info" size={14} color={colors.inkDim} style={{ marginTop: space[1] }} />
            <T size={font.label} dim style={{ flexShrink: 1 }}>{step.set.note || item.note}</T>
          </View>
        ) : null}

        {timed ? (
          <RunBtn kind="quiet" icon="Check" label="Log this set without the clock" style={{ alignSelf: 'center', marginTop: space[2] }}
            onPress={onMark} />
        ) : null}

        {prior ? (
          <View style={st.prior}>
            <Icon name="RotateCw" size={13} color={colors.inkDim} />
            <T size={font.label} dim tabular style={{ flexShrink: 1 }}>
              {`last time (${dayPhrase(prior.date)}): ${prior.summary}${prior.implement ? ` · ${prior.implement}` : ''}`}
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

      {/* The bottom third is where a thumb reaches. ONE primary (D7): Done set,
          or for a timed set Start, which marks it when the clock runs out. A set
          already marked offers its undo as a secondary in its place. Under it only
          things that cannot lose a set: All sets and one more set.
          While the keyboard is up none of it is drawn, so nothing rides onto the
          keypad (#75); the keys' own bar (‹ › Done editing, kit's Input) puts it
          away. They come back once the keys have gone (`keyboardDidHide`, the
          sheet's rule), not as they start to leave under a lifting thumb (#94). */}
      {!showActs({ typing }) ? null : (
        <View style={st.acts}>
          {logged ? (
            <RunBtn big kind="secondary" icon="RotateCw" iconSize={20} label="Undo this set" onPress={onUnmark} />
          ) : timed ? (
            <RunBtn big icon="Play" iconSize={24} label={`Start ${mmss(holdFor)}`} onPress={onStartHold} />
          ) : (
            <RunBtn big icon="Check" iconSize={24} label="Done set" onPress={onMark} />
          )}
          <View style={st.actsRow}>
            <RunBtn kind="quiet" icon="Layers" label="All sets" onPress={() => { tap(); onList() }} />
            <T size={font.caption} dim tabular align="center" numberOfLines={1} style={{ flex: 1 }}>
              {`${doneHere} of ${step.of} · ${itemLine(item)}`}
            </T>
            {/* One more of these, same numbers: quiet, the big button is for marking a set. */}
            <RunBtn kind="quiet" icon="Plus" label="Add a set" a11y={`One more set of ${item.name}, same as this one`} onPress={onAddSet} />
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  )
}

const RUN_FG: Record<BtnKind, string> = {
  primary: colors.onAccent, secondary: colors.ink, quiet: colors.inkDim, destructive: colors.bg,
}
const RUN_BG: Record<BtnKind, ViewStyle> = {
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  secondary: { backgroundColor: colors.panel3, borderColor: colors.lineStrong },
  quiet: { backgroundColor: 'transparent', borderColor: 'transparent' },
  destructive: { backgroundColor: colors.vizCrit, borderColor: colors.vizCrit },
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
 * font.stat (the interval timer's clock is the other, docs/DESIGN.md "Type").
 */
function BigStepper({ label, value, step = 1, min = null, onChange, swap = null, time = false }: {
  swap?: WeightSwap
  /** A piece's time: a minutes box (`boxFor`, #78), as in the editor. */
  time?: boolean
  label: string
  value: any
  step?: number
  min?: number | null
  onChange: (v: any) => void
}) {
  // A piece's time is a minutes box (`boxFor`, #78), pressed exactly as the editor's.
  const bump = (d: number) => { tap(); onChange(stepBox({ step, min, time }, value, d)) }
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
        {time ? (
          <TimeInput accessibilityLabel={label} placeholder="—" placeholderTextColor={colors.inkFaint}
            value={value} onChange={onChange} style={st.bigstepIn} selectTextOnFocus />
        ) : (
          <NumInput accessibilityLabel={label} placeholder="—" placeholderTextColor={colors.inkFaint}
            value={value} onChange={onChange} style={st.bigstepIn} selectTextOnFocus />
        )}
        {swap ? (
          <Press onPress={swap.onSwitch} style={st.swap}
            accessibilityRole="button" accessibilityLabel={`Weight in ${label}. Switch to ${swap.next}`}>
            <T size={font.label} dim>{swap.box}</T>
            <Icon name="ArrowLeftRight" size={13} color={colors.inkDim} />
          </Press>
        ) : <T size={font.label} dim>{label}</T>}
      </View>
      <Press onPress={() => bump(1)} style={st.bigstepBtn} accessibilityRole="button" accessibilityLabel={`more ${label}`}>
        <Icon name="Plus" size={26} color={colors.ink} />
      </Press>
    </View>
  )
}


/* ------------------------------------------------------------ a timed set */

/**
 * A timed set running (#75): the interval timer's face, coloured by its phase,
 * and the one control row. It marks itself when it runs out (WorkoutRunner).
 * Stopping the clock is at the top, away from the thumb, and logs nothing.
 */
function HoldScreen({ step, program, timer, now, onFace, onBack, onBump, onPause, onSkip, onStop }: any) {
  const { width } = useWindowDimensions()
  const v: any = tView(program, timer, now)
  if (v.finished) return null
  const seg = v.segment
  const counting = seg.kind === 'countin'
  const k = KIND_COLOR[seg.kind] || colors.inkDim
  const big = clockSize(width)
  return (
    <View style={{ flex: 1 }}>
      <View style={[st.body, { flex: 1 }]}>
        <View style={[st.where, { justifyContent: 'space-between' }]}>
          <T size={font.label} dim tabular numberOfLines={1} style={{ flexShrink: 1 }}>
            {`${step.blockName} · Set ${step.index + 1} of ${step.of}`}
          </T>
          <Press onPress={onStop} style={st.addSet} accessibilityRole="button" accessibilityLabel="Stop the clock, log nothing">
            <Icon name="X" size={14} color={colors.inkDim} />
            <T size={font.label} dim>Stop the clock</T>
          </Press>
        </View>
        <T size={font.screen} weight={600} align="center" style={{ marginTop: space[3] }}>{step.item.name}</T>
        <Press onPress={() => { impact(); onFace() }} accessibilityRole="button" accessibilityLabel={v.paused ? 'Resume' : 'Pause'}
          style={st.face}>
          <T size={Math.min(font.stat, Math.max(font.screen, width * 0.08))} weight={600} color={k}>{counting ? 'Get ready' : 'Hold'}</T>
          <T size={big} weight={600} tabular color={k}
            style={{ lineHeight: big * 1.02, opacity: v.paused ? 0.4 : 1 }}>
            {clock(Math.ceil(v.left))}
          </T>
          {v.progress != null ? (
            <View style={[st.holdBar, { backgroundColor: mix(k, 20, colors.bg) }]}>
              <View style={{ width: `${v.progress * 100}%`, height: '100%', backgroundColor: k }} />
            </View>
          ) : null}
          <T size={font.label} dim>{v.paused ? 'Paused · tap to carry on' : counting ? 'Then the set starts' : 'It marks itself at zero · Skip ends it here'}</T>
        </Press>
      </View>
      <View style={st.acts}>
        <ControlRow paused={v.paused} onBack={onBack} onLess={() => onBump(-10)} onPause={onPause}
          onMore={() => onBump(10)} onSkip={onSkip} skipLabel={counting ? 'Skip the count-in' : 'End the set here'} />
      </View>
    </View>
  )
}

/* ---------------------------------------------------------------- resting */

/**
 * The rest, given the whole screen. Big enough to read from the floor, with the
 * one control row every clock in the app has (#75): Back to the set just done,
 * ten seconds either way, Pause, and Skip. No primary while resting: the
 * commonest mistake is not resting long enough.
 */
function RestScreen({ seconds, of, next, paused, onBack, onBump, onPause, onSkip }: any) {
  const pct = of > 0 ? Math.max(0, Math.min(1, seconds / of)) : 0
  const { width } = useWindowDimensions()
  // The web's conic ring (min(72vw, 280px), the inner 79% cut out), as one arc.
  const size = Math.min(width * 0.72, 280)
  const thick = size * 0.105
  const r = size / 2 - thick / 2
  const circ = 2 * Math.PI * r
  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={[st.body, { justifyContent: 'center' }]}>
        <T size={font.title} weight={600} dim align="center">{paused ? 'Rest · paused' : 'Rest'}</T>
        <View style={[st.ring, { width: size, height: size }]}>
          <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
            <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.panel2} strokeWidth={thick} fill="none" />
            {pct > 0 ? (
              <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.accent} strokeWidth={thick} fill="none"
                strokeDasharray={`${circ * pct} ${circ}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
            ) : null}
          </Svg>
          {/* A live clock at its floor (font.clock), the ring sized so it fits. */}
          <T size={font.clock} weight={600} tabular lineHeight={font.clock} style={{ opacity: paused ? 0.4 : 1 }}>{mmss(seconds)}</T>
        </View>

        {next ? (
          <T size={font.label} dim align="center" style={{ marginTop: space[4] }}>
            {'Next: '}<T size={font.label} weight={600}>{next.item.name}</T>
            {` · Set ${next.index + 1} of ${next.of} · ${setLine(next.set, next.item)}`}
          </T>
        ) : (
          <T size={font.label} dim align="center" style={{ marginTop: space[4] }}>That was the last set.</T>
        )}
      </ScrollView>

      <View style={st.acts}>
        <ControlRow paused={paused} onBack={onBack} onLess={() => onBump(-10)} onPause={onPause}
          onMore={() => onBump(10)} onSkip={onSkip} skipLabel="Skip the rest" />
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
        <T size={font.screen} weight={600} align="center" style={{ marginTop: space[3], marginBottom: space[1] }}>That is everything</T>
        <Sub style={{ textAlign: 'center' }}>
          {`${progress.done} of ${progress.total} sets in ${mmss(elapsed)}${progress.skipped ? ` · ${progress.skipped} skipped` : ''}`}
        </Sub>
      </ScrollView>
      <View style={st.acts}>
        <RunBtn big icon="Flag" iconSize={22} label="Finish workout" onPress={onFinish} />
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
 * Finishing is in its footer only once every set is marked or skipped
 * (`onFinish` null otherwise): opened to jump to a set, it used to offer
 * "Finish and log it" at one set of seven with no confirm (#75).
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
      footer={onFinish ? <Btn icon="Flag" title="Finish workout" flex onPress={onFinish} /> : undefined}>
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
                      <T size={font.label} dim tabular>
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
  moveAbout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2], marginTop: space[3], marginBottom: 2, minHeight: TAP, alignSelf: 'center' },
  run: { flex: 1, backgroundColor: colors.bg },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[3], padding: space[6] },
  bar: { height: 3, backgroundColor: colors.panel2 },
  barFill: { height: '100%', backgroundColor: colors.accent },
  body: { flexGrow: 1, paddingTop: space[6], paddingHorizontal: space.gutter, paddingBottom: space[3], width: '100%', maxWidth: 560, alignSelf: 'center' },
  where: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2], height: 20 },
  // "Add a set" beside the count: quiet, and 44pt tall. The negative margins keep
  // the row its own height while the padding reaches the tap size.
  addSet: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[1],
    minHeight: TAP, paddingHorizontal: space[3], marginVertical: -space[3], borderRadius: radius.pill,
  },
  bodyMap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2], marginTop: space[2], marginBottom: 2 },
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
    fontSize: font.live, fontWeight: '600', fontVariant: ['tabular-nums'],
  },
  cue: { flexDirection: 'row', gap: space[2], alignItems: 'flex-start', justifyContent: 'center', marginTop: space[3] },
  prior: { flexDirection: 'row', gap: space[2], alignItems: 'center', justifyContent: 'center', marginTop: space[2] },
  restPlan: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[3], marginTop: space[4], marginBottom: space[2], flexWrap: 'wrap' },
  // One primary, full width, where the thumb is.
  acts: { paddingTop: space[3], paddingBottom: space[4], paddingHorizontal: space.gutter, backgroundColor: colors.bg, width: '100%', maxWidth: 560, alignSelf: 'center' },
  big: { width: '100%', minHeight: height.run },
  quietBtn: { paddingHorizontal: space[2] },
  actsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2], marginTop: space[2] },
  ring: { alignSelf: 'center', marginVertical: space[4], alignItems: 'center', justifyContent: 'center' },
  // The timer's face, for a timed set (timer.tsx `st.face`/`st.bar`).
  face: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[3] },
  holdBar: { width: '80%', maxWidth: 320, height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  prose: {
    gap: space[1], marginBottom: space[3], paddingVertical: space[3], paddingHorizontal: space[4],
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.card,
  },
  listCard: { paddingVertical: 0, marginBottom: 0 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  listRowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  listGo: { flex: 1, minWidth: 0, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2] },
})
