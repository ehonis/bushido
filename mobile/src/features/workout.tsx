/*
 * Workout mode — the screen you actually train in front of. app/src/workout.jsx,
 * native.
 *
 * Everything else in this app is for deciding what to do and recording what you
 * did. This is the bit in between: a whole screen, one set at a time, that
 * counts the reps so you don't have to and takes one tap per SET rather than
 * per rep — the only shape that survives being used with chalk on your hands
 * halfway through a hang.
 *
 *   - The numbers are pre-filled from the prescription. A session done as
 *     written is zero typing; you confirm and move on.
 *   - The exercise's how-to is on the screen. It opens itself between sets — the
 *     moment you have hands free — and shrinks to a picture and one line while
 *     you're working, because during a hang the clock is the only thing that
 *     matters.
 *   - Sets write straight into `out.sets`, the same structure the per-set log
 *     uses, so the charts and the history editor never learn this exists.
 *   - A rest with no number behind it counts UP instead of down. See
 *     lib/workout.js — inventing a rest period is worse than not having one.
 *   - Nothing here is required. You can walk in halfway, jump to any set, edit
 *     anything, and leave without finishing.
 *
 * Native: the web's fixed `.wo` overlay is a full-screen modal this component
 * owns (tabs renders it in place of the day, as on the web); the cues are
 * haptic patterns (lib/cues.ts), so they work face-down on a pad. The leave
 * confirm is drawn on the screen, as on the web (docs/DESIGN.md, Confirm).
 */
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  KeyboardAvoidingView, Modal as RNModal, Platform, Pressable, ScrollView, StyleSheet, View,
  useWindowDimensions, type StyleProp, type ViewStyle,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, font, mix, radius, space, TAP } from '../theme'
import { T } from '../ui/Text'
import { Empty, Press, SectionHeader, Toggle, s as kit } from '../ui/kit'
import { impact, success, tap, warn } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { onForeground } from '../lib/foreground'
import { Figure } from '../lib/figures'
import { HowRow, HowSheet, HowBody } from './howto'
import { NumInput } from './numinput'
import { CUES, primeAudio, resumeAudio, acquireWakeLock, releaseWakeLock } from '../lib/cues'
import {
  buildSteps, writeSet, truncateSets, clock, interval, elapsedMinutes, loggedSeconds,
  startOf, advancePhase, afterSet, backPhase, LEAD_IN,
} from '../lib/workout.js'
import { WorkHead, LeaveDialog, ControlRow } from './timer'
import { totalSets, totalReps, GradeLaps, ClimbLog } from './setlog'
import {
  GRADE_FIELD, hasGrades, fitGrades, repCount,
  CLIMB_FIELD, fitClimbs, stepClimbs, fallsIn,
} from '../lib/grades.js'

const FIELD_LABEL: Record<string, string> = { reps: 'reps', seconds: 'secs', weight: 'lb' }

/** Which cue marks entering each phase. Distinct enough to train by feel. */
const CUE_FOR: Record<string, string> = {
  countin: 'countIn', work: 'work', represt: 'rest', setrest: 'rest', finished: 'finished',
}

/*
 * The phase tints the whole screen, so you can read it from the floor without
 * focusing on any particular number. `K` is the interval timer's phase colour
 * (timer.tsx KIND_COLOR, the web's `--k`), mapped from workout mode's phase
 * names, so the face takes the same colours as the timer.
 */
const K: Record<string, string> = {
  countin: colors.vizWarn,
  work: colors.accent,
  represt: colors.load3,
  setrest: colors.load3,
  finished: colors.vizGood,
}
const TINT: Record<string, string> = Object.fromEntries(
  Object.entries(K).map(([phase, k]) => [phase, mix(k, 13, colors.bg)]))

/** Where to drop you in: the first set you haven't logged yet. */
function firstUnlogged(steps: any[]) {
  const i = steps.findIndex(s => !s.logged)
  return i === -1 ? Math.max(0, steps.length - 1) : i
}

/*
 * `who`, `switcher`, `shown`, `embedded`: a workout run from more than one
 * person's side (trainer.tsx `SidesWorkout`). `who` puts whose side this is in
 * the header in their colour; a side that is not `shown` keeps its own clock but
 * stays silent, so a cue is always about the side on screen. Native: `embedded`
 * drops this component's own modal; SidesWorkout presents one for every side.
 */
export function WorkoutMode({ session, entry, onSave, onSetDone, onExit, onFinish = null, who = null, switcher = null, shown = true, embedded = false }: {
  session: any
  entry: any
  onSave: (out: any) => void
  onSetDone?: (v: boolean) => void
  onExit: () => void
  onFinish?: (() => void) | null
  who?: { name: string; tone?: number } | null
  switcher?: React.ReactNode
  shown?: boolean
  embedded?: boolean
}) {
  const insets = useSafeAreaInsets()
  const out = entry?.data?.out || {}
  const steps: any[] = useMemo(() => buildSteps(session, out), [session, out])

  const [i, setI] = useState(() => firstUnlogged(steps))
  const [phase, setPhase] = useState('idle') // idle|countin|work|represt|review|setrest|finished
  const [rep, setRep] = useState(1)
  const [phaseAt, setPhaseAt] = useState(() => Date.now())
  const [deadline, setDeadline] = useState(0) // 0 = counts up, no target
  const [paused, setPaused] = useState(false)
  const [heldMs, setHeldMs] = useState(0) // remaining when paused
  const [draft, setDraft] = useState<any>(null)
  const [now, setNow] = useState(() => Date.now())
  const [muted, setMuted] = useState(false)
  const [startedAt, setStartedAt] = useState<string | null>(() => out.startedAt || null)
  const [finalMin, setFinalMin] = useState('')
  const [howOpen, setHowOpen] = useState(false)
  const [confirmExit, setConfirmExit] = useState(false)
  const [jumpTo, setJumpTo] = useState<number | null>(null) // a rail jump waiting on a confirm while a clock runs

  const step = steps[i] || null
  const timing = step?.timing || { work: null, reps: 1, repRest: null, setRest: null }
  const lock = useRef<string | null>(null)

  const cue = useCallback((name: string) => { if (!muted && shown) CUES[name]?.() }, [muted, shown])

  /* ------------------------------------------------------------ the clock */

  // Repaint only. Every actual transition is driven by an exact timeout below,
  // so a suspended app can't drift the workout.
  useEffect(() => {
    if (paused || phase === 'idle' || phase === 'review' || phase === 'finished') return
    const iv = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(iv)
  }, [paused, phase])

  const left = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null
  const counted = Math.max(0, Math.floor((now - phaseAt) / 1000))
  const elapsed = startedAt ? Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000)) : 0

  /* ------------------------------------------------------- phase changes */

  /** Move to a computed position and start its clock. */
  const enter = useCallback((next: any) => {
    const at = Date.now()
    setPhase(next.phase)
    setRep(next.rep)
    setI(next.index)
    setPhaseAt(at)
    setDeadline(next.seconds ? at + next.seconds * 1000 : 0)
    setPaused(false)
    setHeldMs(0)
    if (next.phase !== 'review') setDraft(null)
    if (CUE_FOR[next.phase]) cue(CUE_FOR[next.phase])
  }, [cue])

  /** Stop the set here and confirm what actually happened. */
  const goReview = useCallback((repsDone: number | null) => {
    const s = steps[i]
    if (!s) return
    const values = { ...s.values }
    /*
     * What the timer counted is the honest default — but only where it counted
     * something. On a set with no clock the timer never left rep 1, and the
     * prescription is a far better guess at how many press-ups you just did.
     *
     * `timing.reps > 1` is the same guard from the other side: an ARC bout is one
     * 20-minute interval whose REPS are laps, which the clock has no way of
     * counting. Writing the clock's 1 into that field would be the app claiming
     * the user climbed a single lap in twenty minutes.
     */
    if (timing.work && timing.reps > 1 && s.fields.includes('reps') && repsDone != null) {
      values.reps = repsDone
    }
    if (s.fields.includes('seconds')) {
      const secs = (loggedSeconds as any)(timing, { phase, measured: (Date.now() - phaseAt) / 1000 })
      if (secs != null) values.seconds = secs
    }
    setDraft(values)
    setPhase('review')
    setDeadline(0)
    setPaused(false)
    cue('setDone')
  }, [steps, i, timing, phase, phaseAt, cue])

  const beginSet = useCallback((index: number, opts: any) => enter((startOf as any)(index, steps, opts)), [enter, steps])

  const advance = useCallback(() => {
    const next: any = advancePhase({ phase, rep, index: i }, steps)
    if (next.phase === 'review') { goReview(timing.reps); return }
    enter(next)
  }, [phase, rep, i, steps, timing.reps, enter, goReview])

  // The exact transition. Re-armed whenever the deadline or pause state moves.
  useEffect(() => {
    if (paused || !deadline) return
    const ms = deadline - Date.now()
    if (ms <= 0) { advance(); return }
    const t = setTimeout(advance, ms)
    return () => clearTimeout(t)
  }, [deadline, paused, advance])

  /*
   * Three ticks into every change of phase.
   *
   * Keyed on the phase's start instant as well as the second, so two phases
   * that happen to end the same way each get their own count rather than the
   * second one being swallowed as a repeat. This is also what tells you the
   * cues are working at all: a cue that only fires on the switch is
   * indistinguishable from a broken one until the switch arrives.
   */
  const ticked = useRef('')
  useEffect(() => {
    if (paused || left == null || left <= 0 || left > 3) return
    const key = `${phaseAt}:${left}`
    if (ticked.current === key) return
    ticked.current = key
    cue('tick')
  }, [left, paused, phaseAt, cue])

  /* --------------------------------------------------------- screen + cues */

  const active = phase !== 'idle' && phase !== 'finished'

  useEffect(() => {
    if (!active) return
    let dead = false
    acquireWakeLock().then(l => { if (dead) releaseWakeLock(l); else lock.current = l })
    // Back from a pocket: repaint at once rather than on the next tick. The
    // exact timeout above fires on resume if its moment passed meanwhile.
    const off = onForeground(() => {
      if (!lock.current) acquireWakeLock().then(l => { lock.current = l })
      resumeAudio()
      setNow(Date.now())
    })
    return () => {
      dead = true
      off()
      releaseWakeLock(lock.current)
      lock.current = null
    }
  }, [active])

  /* ---------------------------------------------------------- the actions */

  const start = () => {
    primeAudio()
    impact()
    const at = startedAt || new Date().toISOString()
    if (!startedAt) { setStartedAt(at); onSave({ ...out, startedAt: at }) }
    // The long count-in, not the between-sets one: you are still holding the
    // phone. Skipping it is one tap for the days you are already chalked and set.
    beginSet(i, { lead: LEAD_IN })
  }

  /**
   * `heldMs` means two different things depending on which way the clock runs:
   * what's LEFT on a countdown, and how far a count-up had got. Resuming has to
   * restore the right one, or pausing mid-rest on an untimed set silently
   * restarts the rest at zero.
   */
  const pause = () => {
    impact()
    const at = Date.now()
    if (paused) {
      if (deadline) setDeadline(at + heldMs)
      else setPhaseAt(at - heldMs)
      setPaused(false)
    } else {
      setHeldMs(deadline ? Math.max(0, deadline - at) : at - phaseAt)
      setPaused(true)
    }
  }

  const bump = (seconds: number) => {
    if (!deadline) return
    if (paused) { setHeldMs(h => Math.max(1000, h + seconds * 1000)); return }
    setDeadline(d => Math.max(Date.now() + 1000, d + seconds * 1000))
  }

  /** Back, as on every clock in the app (`backPhase`, lib/workout.js). */
  const goBack = () => {
    const into = (paused ? heldMs : Date.now() - phaseAt) / 1000
    // On a countdown `heldMs` is what was LEFT; how far in is the rest of it.
    const far = paused && deadline ? Math.max(0, (deadline - phaseAt - heldMs) / 1000) : into
    enter((backPhase as any)({ phase, rep, index: i, into: far }, steps))
  }

  /** Jump to a set from the rail. While a clock is running it asks first: the clock stops. */
  const jump = (n: number) => { tap(); setJumpTo(null); setDraft(null); setI(n); setPhase('idle'); setDeadline(0); setPaused(false) }
  const askJump = (n: number) => {
    if (n === i && phase === 'idle') return
    if (active && phase !== 'review' && !paused) { warn(); setJumpTo(n) } else jump(n)
  }

  /** Save the reviewed set and move on. */
  const commitSet = (last = false) => {
    const s = steps[i]
    if (!s) return
    success()
    let next = writeSet(out, s.exKey, s.setIndex, draft || s.values)
    if (last) next = truncateSets(next, s.exKey, s.setIndex + 1)
    onSave(next)
    enter((afterSet as any)({ index: i }, steps, { last }))
  }

  /*
   * Finishing writes the minutes, then whether it is done, through the caller's
   * two writers. Both build on the entry they were given, so the second waits a
   * tick for the first to land and is called through `latest`, the props of the
   * render that saw it: called straight away, the done write rebuilt the entry
   * from before the save and threw the minutes away. Finish workout is the one
   * way out and marks it done; Mark undone lives on the sheet only (#75).
   */
  const latest = useRef<any>({})
  latest.current = { onSetDone, onExit, onFinish }
  const finish = (markDone: boolean) => {
    success()
    const mins = Number(finalMin) || elapsedMinutes(startedAt) || null
    const next = { ...out }
    if (mins) next.elapsedMin = mins
    delete next.startedAt
    onSave(next)
    setTimeout(() => {
      const l = latest.current
      l.onSetDone?.(markDone)
      // With more than one side, finishing one hands over to the next (SidesWorkout).
      ;(l.onFinish || l.onExit)()
    }, 0)
  }

  const askExit = () => {
    if (!active) { onExit(); return }
    setConfirmExit(true)
  }

  /* ------------------------------------------------------------- rendering */

  const frame = (body: React.ReactNode) => embedded ? (
    <View style={st.wo}>{body}</View>
  ) : (
    <RNModal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={askExit}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={[st.wo, { paddingTop: insets.top }]}>{body}</View>
      </GestureHandlerRootView>
    </RNModal>
  )
  const bodyPad = { paddingBottom: space[5] + insets.bottom }

  if (!steps.length) {
    return frame(
      <>
        <WorkHead title={session.name} who={who} muted={muted} onMute={setMuted} onExit={onExit} />
        {switcher}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={[st.body, bodyPad]}>
          <Empty>
            This session has no per-set prescription, so there is nothing to step through.
            Log it from the session sheet instead.
          </Empty>
        </ScrollView>
      </>,
    )
  }

  /*
   * The rail is at the top, under the header, where the runner's progress bar
   * is: it says where you are. At the bottom it was the nearest thing to a thumb
   * reaching for the controls, and a tap on it threw away the set's clock (#75).
   * The control row is outside the scroll, so it stays at the bottom however
   * long the how-to between sets is.
   */
  const live = active && phase !== 'review' && step
  return frame(
    <>
      <WorkHead title={session.name} who={who} muted={muted} onMute={setMuted} onExit={askExit}
        sub={<><Icon name="Timer" size={12} color={colors.inkDim} /><T size={font.small} dim tabular>{clock(elapsed)}</T></>} />
      {switcher}

      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: TINT[phase] || colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={{ flex: 1 }}
          contentContainerStyle={[st.body, live ? { paddingBottom: space[3] } : bodyPad]}
          keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
          {phase !== 'finished' && <Rail steps={steps} current={i} onJump={askJump} />}

          {phase === 'idle' && <Intro session={session} steps={steps} onStart={start} resumed={Boolean(startedAt)} />}

          {phase === 'finished' && (
            <Finish session={session} out={out} startedAt={startedAt}
              value={finalMin} onValue={setFinalMin} onFinish={finish} />
          )}

          {live ? (
            <Face phase={phase} left={left} counted={counted} rep={rep} timing={timing} step={step}
              paused={paused} onSkip={() => { impact(); advance() }} onHow={() => { tap(); setHowOpen(true) }}
              onEndSet={() => { impact(); goReview(phase === 'work' ? rep : timing.reps) }} />
          ) : null}

          {phase === 'review' && step && (
            <Review step={step} draft={draft || step.values} onDraft={setDraft}
              onCommit={commitSet} isLastSet={i === steps.length - 1} />
          )}
        </ScrollView>

        {live ? (
          <FaceFoot phase={phase} left={left} paused={paused} bodyPad={bodyPad}
            onPause={pause} onBump={bump} onBack={goBack}
            onSkip={() => { advance() }}
            onEndSet={() => { impact(); goReview(phase === 'work' ? rep : timing.reps) }} />
        ) : null}
      </KeyboardAvoidingView>

      {howOpen && step?.how && (
        <HowSheet how={step.how} title={step.exName} onClose={() => setHowOpen(false)} />
      )}

      {confirmExit ? (
        <LeaveDialog title="Leave the workout?" body="Every set you marked is saved. The clock stops."
          onKeep={() => setConfirmExit(false)}
          actions={[{ label: 'Leave', kind: 'secondary', onClick: onExit }]} />
      ) : null}

      {jumpTo != null && steps[jumpTo] ? (
        <LeaveDialog title={`Go to ${steps[jumpTo].exName}, set ${steps[jumpTo].setIndex + 1}?`}
          body="The clock on this set stops. Nothing you marked is lost."
          onKeep={() => setJumpTo(null)}
          actions={[{ label: `Go to set ${steps[jumpTo].setIndex + 1}`, kind: 'secondary', onClick: () => jump(jumpTo) }]} />
      ) : null}
    </>,
  )
}

/* ------------------------------------------------------------------ pieces */

/**
 * button.btn.wo-start / .wo-setdone: the screen's one primary, made big (56pt,
 * title size); `quiet` is the kit's quiet button. Not the kit's Btn because the
 * handlers here choose the haptic (a set done buzzes success, a cue is its own).
 */
function BigBtn({ icon, label, onPress, style, quiet = false }: {
  icon: string; label: string; onPress: () => void; style?: StyleProp<ViewStyle>; quiet?: boolean
}) {
  const fg = quiet ? colors.inkDim : colors.onAccent
  return (
    <Press onPress={onPress} accessibilityRole="button"
      style={[kit.btn, quiet ? st.quietBtn : st.bigBtn, style]}>
      <Icon name={icon} size={quiet ? 16 : 18} color={fg} />
      <T size={quiet ? font.body : font.title} weight={600} color={fg}>{label}</T>
    </Press>
  )
}

/**
 * What you're about to do. The exercise list doubles as the how-to: every row
 * opens into its own steps, so the answer to "wait, which one is this?" is on
 * the screen you already start from.
 */
function Intro({ session, steps, onStart, resumed }: any) {
  void session
  const byEx: any[] = []
  for (const s of steps) {
    const last = byEx.at(-1)
    if (last && last.key === s.exKey) last.n++
    else byEx.push({ key: s.exKey, name: s.exName, n: 1, timing: s.timing, how: s.how })
  }
  const done = steps.filter((s: any) => s.logged).length
  const [open, setOpen] = useState(byEx[0]?.key || null)

  return (
    <View style={{ gap: space[3] }}>
      {(resumed || done) ? <T size={font.body} dim tabular>{`${done} of ${steps.length} sets marked`}</T> : null}

      <View style={{ gap: 8 }}>
        {byEx.map(e => (
          <HowRow key={e.key} exercise={{ name: e.name, how: e.how }}
            open={open === e.key} onToggle={() => setOpen(open === e.key ? null : e.key)}
            meta={`${e.n} × ${e.timing.work ? interval(e.timing.work) : 'set'}`} />
        ))}
      </View>

      <BigBtn icon="Play" label={done ? 'Continue workout' : 'Start workout'} onPress={onStart} />

      {/* Worth one tap before a session rather than finding out three sets in.
          Native: the cues are haptic (no sound), so this is "Test the buzz": how
          you learn what "go" feels like before the phone is face-down on the pad. */}
      <BigBtn quiet icon="Vibrate" label="Test the buzz" onPress={() => { primeAudio(); CUES.work() }}
        style={{ alignSelf: 'center' }} />
    </View>
  )
}

const PHASE_LABEL: Record<string, string> = { countin: 'Get ready', work: 'Work', represt: 'Rest', setrest: 'Rest between sets' }

export function Face({ phase, left, counted, rep, timing, step, paused, onSkip, onEndSet, onHow }: any) {
  const { width } = useWindowDimensions()
  const showing = left != null ? left : counted
  const pips = timing.reps > 1 && timing.reps <= 24
  // A set with no clock ends when you say it does, so ending it is the main
  // action on the screen and gets a button rather than a link under the fold.
  const openEnded = left == null && phase === 'work'
  /*
   * A clock with no target ends when you say so, and the screen said "tap done"
   * over a line of plain text — so the obvious thing to tap was the number, and
   * the number did nothing. Now it is the button. Both open-ended phases get
   * one: counting up through a set ends it, and an untargeted rest starts the
   * next one. A countdown stays inert, because there the clock is information
   * and a stray tap mid-hang should cost nothing.
   */
  const onClock = openEnded ? onEndSet : (left == null && phase === 'setrest') ? onSkip : null
  // The rest between sets is the one stretch with both hands free and minutes
  // to spare, so that is where the how-to opens itself. Everywhere else it
  // collapses to a picture and one line: mid-hang the clock is all that matters.
  const reading = phase === 'setrest' && step.how
  const k = K[phase] || colors.inkDim
  // The timer's face sizes (timer.tsx): the phase word clamp(heading, 8vw, 36),
  // and the clock clamp(88, 30vw, 180) — a little under the timer's own, because
  // here it sits among the how-to and the rail rather than filling the screen.
  const phaseSize = Math.min(36, Math.max(font.heading, width * 0.08))
  const countSize = Math.min(180, Math.max(88, width * 0.3))

  /*
   * THE INTERVAL TIMER'S FACE, where the two overlap (docs/DESIGN.md, Workout
   * mode): the phase in words, the clock as wide as the screen allows, where you
   * are, and the row of controls, drawn as timer.tsx draws them. What is workout
   * mode's own stays its own: the how-to, the rep pips, the set log and the rail.
   */
  const clockBody = (
    <>
      <T size={phaseSize} weight={600} color={k} align="center" numberOfLines={1}>
        {`${PHASE_LABEL[phase] || ''}${paused ? ' · Paused' : ''}`}
      </T>
      <T size={countSize} weight={600} tabular align="center" color={k}
        style={{ lineHeight: countSize * 1.02, letterSpacing: -0.03 * countSize, opacity: paused ? 0.4 : 1 }}>
        {left != null ? clock(showing) : clock(counted)}
      </T>
      <T size={font.title} weight={600} tabular align="center">
        {`${step.exName} · Set ${step.setIndex + 1} of ${step.setCount}`}
      </T>
      {left == null ? (
        <T size={font.small} dim align="center">
          {openEnded ? 'Tap the clock when the set is done' : 'Tap the clock to start the next set'}
        </T>
      ) : null}
    </>
  )

  return (
    <View style={st.face}>
      {step.how && !reading ? (
        <Press onPress={onHow} style={st.how} accessibilityRole="button" accessibilityLabel={`How to do ${step.exName}`}>
          <Figure name={step.how.figure} color={colors.accent} style={st.howFig} />
          <T size={font.small} dim lineHeight={18} style={{ flex: 1, minWidth: 0 }}>{step.how.gist}</T>
          <View style={st.howMore}><T size={font.small} weight={600}>How</T></View>
        </Press>
      ) : null}

      {onClock ? (
        <Pressable onPress={onClock} accessibilityRole="button"
          accessibilityLabel={openEnded ? 'End the set' : 'Start the next set'}
          style={({ pressed }) => [st.clock, st.clockTap, pressed && { backgroundColor: mix(colors.panel, 70, TINT[phase] || colors.bg) }]}>
          {clockBody}
        </Pressable>
      ) : (
        <View style={st.clock}>{clockBody}</View>
      )}

      {phase !== 'setrest' && timing.reps > 1 ? (
        pips ? (
          <View style={st.pips} accessibilityLabel={`Rep ${rep} of ${timing.reps}`}>
            {Array.from({ length: timing.reps }, (_, n) => (
              <View key={n} style={[st.pip,
                n + 1 < rep && { backgroundColor: k, borderColor: k },
                n + 1 === rep && { borderColor: k, backgroundColor: mix(k, 35, TINT[phase] || colors.bg), transform: [{ scale: 1.35 }] }]} />
            ))}
          </View>
        ) : (
          <T size={font.small} dim tabular>{`Rep ${rep} of ${timing.reps}`}</T>
        )
      ) : null}

      {reading ? (
        <View style={st.howNext}>
          <SectionHeader title={`Next up: ${step.exName}`} style={st.howNextHead} />
          <HowBody how={step.how} />
        </View>
      ) : null}
    </View>
  )
}

/**
 * The bottom of a running set: what ends it, then the one control row every
 * clock in the app has (timer.tsx `ControlRow`). A set with no clock ends on
 * Done set, the primary; a countdown can be ended early, quietly.
 */
function FaceFoot({ phase, left, paused, bodyPad, onPause, onBump, onBack, onSkip, onEndSet }: any) {
  const openEnded = left == null && phase === 'work'
  return (
    <View style={[st.foot, bodyPad]}>
      {openEnded ? (
        <BigBtn icon="Check" label="Done set" onPress={onEndSet} style={st.setDone} />
      ) : (phase === 'work' || phase === 'represt') ? (
        <BigBtn quiet icon="Flag" label="End the set here" onPress={onEndSet} style={[st.setDone, st.secondaryBtn]} />
      ) : null}
      <ControlRow paused={paused} onBack={onBack}
        onLess={left != null ? () => onBump(-10) : null}
        onPause={onPause}
        onMore={left != null ? () => onBump(10) : null}
        onSkip={onSkip} skipLabel={phase === 'setrest' ? 'Next set' : 'Skip'} />
    </View>
  )
}

/**
 * Exported for the smoke suite, the same reason `Face` is: the review screen is
 * where every set is actually written down, and a per-rep field that quietly
 * renders nothing loses the grades rather than the whole session.
 */
export function Review({ step, draft, onDraft, onCommit, isLastSet }: any) {
  // "That was my last set" is a switch at the top, read by Set done, rather
  // than a link 10pt under it that skipped the rest of the exercise (#75).
  const [last, setLast] = useState(false)
  const set = (field: string, value: any) => {
    const next = { ...draft, [field]: value === '' || value == null ? '' : Number(value) }
    // The grade pickers follow the rep count here too, so correcting "that was
    // three laps not two" on this screen grows the list rather than losing a lap.
    if (field === 'reps' && hasGrades(step.fields)) {
      next[GRADE_FIELD] = fitGrades(next[GRADE_FIELD], next.reps)
    }
    onDraft(next)
  }
  const perRep = hasGrades(step.fields)
  const what = step.repName || 'rep'

  /*
   * The optional per-climb detail, offered HERE as well as in the set log.
   *
   * The board is the first session to have both a clock and this offer, and it
   * is the one where the detail is worth most: its own target is "one fall or
   * fewer across all four intervals", and the only moment anybody honestly
   * knows which problem that fall was on is the twenty seconds after the
   * interval. Presence of the list is the state, exactly as in the set log.
   */
  const detailed = Array.isArray(draft[CLIMB_FIELD])
  const setDetail = (on: boolean) => {
    tap()
    if (!on) {
      const { [CLIMB_FIELD]: _dropped, ...rest } = draft
      onDraft(rest)
      return
    }
    // Reps is normalised on the way in, because from here the list is the source
    // of truth and the box only displays it.
    onDraft({ ...draft, reps: repCount(draft.reps), [CLIMB_FIELD]: fitClimbs(draft[CLIMB_FIELD], draft.reps) })
  }
  // While the detail is on, the count moves one at a time and only from here —
  // typing "12" over a 10 passes through "1", and that refit used to delete the
  // climbs already entered. Same rule, same reason, as the set log's steppers.
  const bump = (delta: number) => { tap(); onDraft(stepClimbs(draft, delta)) }
  const falls = detailed ? fallsIn([draft]) : 0

  return (
    <View style={st.review}>
      <T size={font.small} dim tabular align="center">{`${step.exName} · Set ${step.setIndex + 1} of ${step.setCount}`}</T>
      <T size={font.heading} weight={600} lineHeight={28} align="center" style={{ marginTop: 2 }}>What actually happened?</T>
      <T size={font.small} dim align="center" style={{ maxWidth: 280, marginBottom: space[2] }}>
        Pre-filled from the plan. Change anything that didn’t match.
      </T>

      {!isLastSet ? (
        <View style={st.lastSet}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T size={font.body}>{`Last set of ${step.exName.toLowerCase()}`}</T>
            <T size={font.small} dim>{last ? 'Set done moves on to the next exercise' : 'Skip the sets left of it'}</T>
          </View>
          <Toggle value={last} onChange={(v) => { tap(); setLast(v) }} />
        </View>
      ) : null}

      {step.climbLog ? (
        <Press onPress={() => setDetail(!detailed)} hitSlop={8} accessibilityRole="switch"
          accessibilityState={{ checked: detailed }}
          style={[st.signtog, detailed && { borderColor: mix(colors.accent, 40, colors.line) }]}>
          <T size={11} color={detailed ? colors.accent : colors.inkDim}>
            {detailed ? `logging each ${what}` : `log each ${what}`}
          </T>
        </Press>
      ) : null}

      <View style={st.fields}>
        {step.fields.filter((f: string) => f !== GRADE_FIELD).map((f: string) => (
          <View key={f} style={st.field}>
            <T size={font.small} dim align="center">
              {`${FIELD_LABEL[f] || f}${f === 'weight' && step.sign === '-' ? ' (off)' : ''}`}
            </T>
            {f === 'reps' && detailed ? (
              <View style={st.repstep}>
                <Press onPress={() => bump(-1)} style={st.repstepB} accessibilityRole="button" accessibilityLabel={`one fewer ${what}`}>
                  <T size={19} dim>−</T>
                </Press>
                <View style={[st.fieldBox, { flex: 1, paddingHorizontal: 4 }]}>
                  <T size={26} weight={600} dim tabular align="center">{String(repCount(draft.reps))}</T>
                </View>
                <Press onPress={() => bump(1)} style={st.repstepB} accessibilityRole="button" accessibilityLabel={`one more ${what}`}>
                  <T size={19} dim>+</T>
                </Press>
              </View>
            ) : (
              // A text box that owns its text (NumInput), so "37." survives typing.
              <NumInput blank="" value={draft[f] ?? ''} onChange={(v: any) => set(f, v)}
                accessibilityLabel={FIELD_LABEL[f] || f}
                style={st.fieldIn} selectTextOnFocus />
            )}
          </View>
        ))}
      </View>

      {detailed ? (
        <View style={st.climbs}>
          <T size={font.small} dim>{`each ${what}${falls > 0 ? ` · fell on ${falls}` : ''}`}</T>
          <View style={{ width: '100%', maxWidth: 340 }}>
            <ClimbLog count={repCount(draft.reps)} values={draft[CLIMB_FIELD]}
              spec={step.climbLog} what={what} omitGrade={perRep}
              where={`set ${step.setIndex + 1} `}
              onChange={(list: any) => onDraft({ ...draft, [CLIMB_FIELD]: list })}
              onMore={repCount(draft.reps) < 20 ? () => bump(1) : undefined} />
          </View>
        </View>
      ) : null}

      {/* A grade per rep, because the two laps of a double are not always the
          same route — the same control as the per-set log. */}
      {perRep ? (
        <View style={st.grades}>
          <T size={font.small} dim>{`grade per ${step.repName || 'rep'}`}</T>
          <GradeLaps count={repCount(draft.reps)} values={draft[GRADE_FIELD]}
            what={step.repName || 'rep'} where={`set ${step.setIndex + 1} `}
            onChange={(list: any) => onDraft({ ...draft, [GRADE_FIELD]: list })} />
        </View>
      ) : null}

      <BigBtn icon="Check" label="Set done" onPress={() => onCommit(last && !isLastSet)} style={st.setDone} />
    </View>
  )
}

/** Every set of the session, at a glance, at the top. Tap any to go back and fix it; with a clock running it asks. */
function Rail({ steps, current, onJump }: any) {
  const groups: any[] = []
  for (const [n, s] of steps.entries()) {
    const last = groups.at(-1)
    if (last && last.key === s.exKey) last.items.push({ n, s })
    else groups.push({ key: s.exKey, name: s.exName, items: [{ n, s }] })
  }

  return (
    <View style={st.rail}>
      {groups.map(g => (
        <View key={g.key} style={st.railRow}>
          <T size={font.small} dim numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>{g.name}</T>
          <View style={st.railSets}>
            {g.items.map(({ n, s }: any) => {
              const on = n === current
              return (
                <Press key={n} onPress={() => onJump(n)}
                  accessibilityRole="button" accessibilityLabel={`${g.name} set ${s.setIndex + 1}`}
                  style={[st.railSet, s.logged && st.railSetDone, on && st.railSetOn]}>
                  {s.logged
                    ? <Icon name="Check" size={13} color={on ? colors.ink : colors.vizGood} />
                    : <T size={font.small} tabular color={on ? colors.ink : colors.inkDim}>{String(s.setIndex + 1)}</T>}
                </Press>
              )
            })}
          </View>
        </View>
      ))}
    </View>
  )
}

function Finish({ session, out, startedAt, value, onValue, onFinish }: any) {
  const measured = elapsedMinutes(startedAt)
  const sets = totalSets(out)
  const reps = totalReps(out)

  return (
    <View style={st.finish}>
      <Icon name="CircleCheck" size={44} color={colors.vizGood} />
      <T size={font.heading} weight={600} lineHeight={28} align="center">{`${session.name} — done`}</T>

      <View style={st.stats}>
        <Stat n={sets} label="sets" />
        {reps > 0 ? <Stat n={reps} label="reps" /> : null}
        {measured != null ? <Stat n={measured} label="minutes" /> : null}
      </View>

      <View style={{ gap: 6, width: 160 }}>
        <T size={font.small} dim align="center">Minutes to record</T>
        <NumInput blank="" decimal={false} value={value} onChange={(v: any) => onValue(v == null || v === '' ? '' : String(v))}
          placeholder={measured != null ? String(measured) : String(session.minutes ?? '')}
          accessibilityLabel="Minutes to record" style={st.fieldIn} />
      </View>
      <T size={font.small} dim align="center">
        Measured from when you hit start. This is what the weekly training-load chart multiplies
        by your RPE, so a real number beats the card’s nominal one.
      </T>

      <BigBtn icon="CircleCheck" label="Finish workout" onPress={() => onFinish(true)} style={{ alignSelf: 'stretch' }} />
    </View>
  )
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <View style={{ gap: 2, alignItems: 'center' }}>
      <T size={font.display} weight={600} tabular lineHeight={38}>{String(n)}</T>
      <T size={font.small} dim>{label}</T>
    </View>
  )
}

const st = StyleSheet.create({
  wo: { flex: 1, backgroundColor: colors.bg },
  body: { flexGrow: 1, paddingTop: space[4], paddingHorizontal: space.gutter },
  // The one primary, made big: the accent at title size.
  bigBtn: { backgroundColor: colors.accent, borderColor: colors.accent, minHeight: 56 },
  quietBtn: { backgroundColor: 'transparent', borderColor: 'transparent' },
  setDone: { width: '100%', maxWidth: 340, marginTop: space[2] },
  face: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 10, paddingBottom: 18 },
  // The how-to, mid-set: a picture and one line, small enough never to compete
  // with the clock. Tapping opens the full card.
  how: {
    flexDirection: 'row', alignItems: 'center', gap: 11, width: '100%', maxWidth: 400,
    minHeight: TAP, paddingVertical: 7, paddingHorizontal: 10,
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.control,
  },
  howFig: { width: 44, height: 38 },
  howMore: {
    borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.pill,
    paddingVertical: 6, paddingHorizontal: space[3],
  },
  howNext: {
    width: '100%', maxWidth: 460, marginTop: space[4], paddingTop: 13,
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.card,
  },
  howNextHead: { marginTop: 0, marginBottom: 0, paddingHorizontal: space[4], paddingBottom: space[2] },
  // The timer's face; a button only on the open-ended phases (see Face).
  clock: { alignItems: 'center', gap: space[3], width: '100%', paddingVertical: space[2] },
  clockTap: {
    paddingVertical: space[3], paddingHorizontal: space[4],
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.lineStrong, borderRadius: radius.sheet,
  },
  pips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, justifyContent: 'center', maxWidth: 280, marginTop: 2 },
  pip: { width: 13, height: 13, borderRadius: 7, borderWidth: 2, borderColor: colors.lineStrong },
  // The bottom of a running set, outside the scroll: ending it, then the control row.
  foot: { alignItems: 'center', gap: space[2], paddingTop: space[3], paddingHorizontal: space.gutter },
  secondaryBtn: { backgroundColor: colors.panel3, borderColor: colors.lineStrong },
  lastSet: {
    flexDirection: 'row', alignItems: 'center', gap: space[3], width: '100%', maxWidth: 340,
    minHeight: TAP, marginBottom: space[2], paddingVertical: space[2], paddingHorizontal: space[3],
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.card,
  },
  review: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  signtog: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill,
    paddingVertical: 4, paddingHorizontal: 9, minHeight: 30, justifyContent: 'center',
  },
  fields: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center', width: '100%' },
  field: { gap: 6, width: 108, flexShrink: 1 },
  fieldBox: {
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: 8,
    minHeight: 62, justifyContent: 'center',
  },
  fieldIn: {
    fontSize: 26, fontWeight: '600', textAlign: 'center', fontVariant: ['tabular-nums'],
    paddingVertical: 12, paddingHorizontal: 8, minHeight: 62,
  },
  repstep: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  repstepB: {
    minWidth: 34, minHeight: TAP, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: 8,
  },
  climbs: { alignItems: 'center', gap: 4, width: '100%' },
  grades: { alignItems: 'center', gap: 6, width: '100%', marginTop: 4 },
  rail: { marginBottom: space[3], paddingBottom: space[3], borderBottomWidth: 1, borderBottomColor: colors.line, gap: space[2] },
  railRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  railSets: { flexDirection: 'row', gap: space[1], flexWrap: 'wrap', flexShrink: 1, justifyContent: 'flex-end' },
  railSet: {
    width: TAP, height: TAP, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line,
  },
  railSetDone: { borderColor: mix(colors.vizGood, 40, colors.line) },
  railSetOn: { borderColor: colors.accentLine, backgroundColor: colors.accentSoft },
  finish: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: space[3] },
  stats: { flexDirection: 'row', gap: space[6], marginVertical: space[1] },
})
