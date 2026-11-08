/*
 * Plan a workout — the screens between "+" and a session with the sets
 * already written in. Ported from app/src/planner.jsx.
 *
 * Two routes, one editor. **Write it for me**: one box, how long, the day; the
 * model writes a followable workout as a DRAFT on the server (lib/drafts.js), so
 * leaving loses nothing. **Build it myself**: the same editor, open at once with
 * one empty block; the kinds are an optional "Start from" row (#78).
 *
 * The flow's state and rules are `lib/planflow.js` (`usePlanFlow`), shared with
 * the web, so this file is only the phone's view of it. Nothing reaches the log
 * until the user keeps it, on the day chosen here.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, font, mix, radius, space, TAP, height } from '../theme'
import { Icon } from '../lib/icons'
import { T } from '../ui/Text'
import { Btn, Card, Chip, IconBtn, Input, Press, SectionHeader } from '../ui/kit'
import { FullScreen } from '../ui/Sheet'
import { useKeyboardShown } from '../ui/KeyboardBar'
import { showFoot as footAllowed } from '../ui/sheetPolicy'
import { PrescriptionEditor } from './editor'
import { NumInput } from './numinput'
import { impact, success, tap, warn } from '../ui/haptics'
import { Markdown } from '../lib/markdown'
import { reviseWorkout } from '../lib/plannerapi.js'
import { draftTitle, draftLine, draftToEvict } from '../lib/drafts.js'
import { confirm, showActionTree } from '../ui/menu'
import {
  normalizePrescription, prescriptionLine, prescriptionSteps, reviseWeightModes,
  splitPrescription, appendPiece, dropEmptyBlocks,
} from '../lib/prescription.js'
import { usePlan } from '../lib/planctx.jsx'
import { liftFieldOf } from '../lib/lifts.js'
import { fromIso, isoShift, dayWords, dayPhrase } from '../lib/dates.js'
import { usePlanFlow, hasWork, dayBounds, DEFAULT_MINUTES } from '../lib/planflow.js'
import { ForChoice, ForLine, usePeopleLogs } from './trainer'
import * as trainerLib from '../lib/trainer.js'

// Default parameters in the ported JS narrow TypeScript's inference (mobile/AGENTS.md).
const { FOR_ME, forWords, forSomeoneElse, namesOf } = trainerLib as any



/* ------------------------------------------------------------- the frame */

/**
 * A step's body: the scroll, and the `.plan-actions.sticky` bar pinned under it.
 *
 * Sticky, because the ask and the review are both taller than a phone and the
 * button that ends the step should never be something you scroll to find.
 * But NOT while typing (#77): the full screen's KeyboardAvoidingView lifted
 * the bar onto the keypad, so "Put it on today" (it keeps the plan) and Redo
 * sat where a thumb lands reaching for the keys. While the keyboard is up the
 * bar is gone and the keyboard's own Done editing is the way out; it comes
 * back once the keys have left.
 */
export function StepPage({ children, foot = null, after = null, scrollRef = null }: {
  children?: React.ReactNode
  foot?: React.ReactNode
  /** What the web renders after the sticky bar (the `.plan-fine` line). */
  after?: React.ReactNode
  /** The page's scroller, for a step that moves the reader (the builder's Start from). */
  scrollRef?: React.RefObject<ScrollView | null> | null
}) {
  const insets = useSafeAreaInsets()
  const typing = useKeyboardShown()
  const showFoot = footAllowed({ footer: foot, typing })
  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: space.gutter, paddingBottom: showFoot ? space[4] : typing ? space[6] : space[6] + insets.bottom }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {children}
        {after}
      </ScrollView>
      {showFoot ? (
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

/* ------------------------------------------------------------------ flow */

/*
 * `iso` is today; `date` the day Today is showing (a plan lands there, or later).
 * `people`, `onKeepFor`, `onShareWith`, `onStartFor`: the owner planning for
 * other people on the install (lib/trainer.js); empty `people` changes nothing.
 */
export function PlanFlow({ plan, entries = [], iso, date = null, onKeep, onStart, onClose, people = [], onKeepFor = null, onShareWith = null, onStartFor = null, onShowDay = null }: any) {
  const f: any = (usePlanFlow as any)({
    plan, entries, iso, date, people, usePeopleLogs, onKeep, onKeepFor, onShareWith, onClose, onStart, onStartFor,
    confirmDiscard: (message: string) => confirm(message, { confirmLabel: 'Throw away' }),
  })
  const { state: s, set, first, forPeople } = f
  const minuteChips = plan?.plannerKinds?.minutes || DEFAULT_MINUTES
  const categories = f.ctxPlan?.quotaCategories || []
  const kept = s.kept
  // A workout on the day is something done: the haptic says so once, as it lands.
  const landed = useRef(false)
  useEffect(() => {
    if (s.step === 'kept' && !landed.current) success()
    landed.current = s.step === 'kept'
  }, [s.step])

  const day = <PlanDay value={s.date} today={f.today} onChange={set.date} />
  const fileAs = f.asksFiling ? <FileAs choices={f.fileChoices} value={s.filing} onChange={set.filing} /> : null
  const firstHead = (
    <>
      {s.notice ? <T size={font.label} color={colors.bad} style={st.errLine}>{s.notice}</T> : null}
      {f.ai ? <DraftList drafts={f.drafts} onOpen={(d: any) => { tap(); f.resume(d) }} onRetry={(d: any) => { impact(); f.retry(d) }} onDiscard={f.discard} /> : null}
      <ForChoice people={forPeople} who={s.who} onChange={set.who} />
      <ForLine who={s.who} people={forPeople} />
      {f.waitLine ? <T size={font.label} dim style={st.errLine}>{f.waitLine}</T> : null}
    </>
  )
  const errLine = s.error ? <T size={font.label} color={colors.bad} style={st.errLine}>{s.error}</T> : null
  const forLine = <ForLine who={s.who} people={forPeople} />
  const keep = () => { impact(); f.keep() }

  return (
    <FullScreen title={f.title} sub={f.sub} icon="ClipboardCheck" onBack={f.back} scroll={false}>
      {s.step === 'start' && (
        <AskStep head={firstHead} goal={s.goal} setGoal={set.goal} minutes={s.minutes} setMinutes={set.minutes} chips={minuteChips}
          plan={plan} picked={s.picked} setPicked={set.picked} day={day}
          evicts={s.draftId ? null : draftToEvict(f.drafts)} busy={f.waiting} building={hasWork(s.scratch)}
          onGo={() => { set.notice(null); f.run() }} onBuild={() => { set.notice(null); f.build() }} />
      )}

      {s.step === 'working' && (
        <StepPage>
          {forLine}
          <Working label={s.picked.map((k: any) => k.label).join(' + ')} minutes={s.minutes} since={f.open?.run?.startedAt || null}
            onDiscard={f.open ? () => { f.discard(f.open); f.toFirst() } : null} />
        </StepPage>
      )}

      {s.step === 'failed' && (
        <StepPage>
          {forLine}
          <View style={st.failed}>
            <View style={st.failedLead}>
              <Icon name="TriangleAlert" size={16} color={colors.bad} style={{ marginTop: space[1] }} />
              <T size={font.body} color={colors.bad} style={{ flex: 1 }}>{s.error}</T>
            </View>
            <T size={font.label} dim>Nothing was written.</T>
            <View style={[st.actions, st.fork]}>
              <Btn icon="RotateCw" title="Try again" onPress={() => { impact(); f.retry() }} style={st.forkBtn} />
              {/* Not a dead end: a busy box is only a reason to write it yourself. */}
              <Btn kind="secondary" icon="ListPlus" title="Build it myself" onPress={f.build} style={st.forkBtn} />
              <Btn kind="secondary" title="Change the ask" onPress={f.toFirst} style={st.forkBtn} />
              {!f.open && f.drafts.length > 0 ? (
                <Btn kind="secondary" title="See your drafts" onPress={f.back} style={st.forkBtn} />
              ) : null}
            </View>
          </View>
        </StepPage>
      )}

      {s.step === 'build' && s.pres && (
        <BuildStep pres={s.pres} setPres={set.pres} liftField={f.liftField} entries={f.ctxEntries}
          categories={categories} plan={plan} picked={s.picked} setPicked={set.picked} day={day} fileAs={fileAs}
          busy={f.waiting} onKeep={keep} words={f.words}
          head={<>{first === 'build' ? firstHead : forLine}{errLine}</>} />
      )}

      {s.step === 'review' && s.pres && (
        <ReviewStep pres={s.pres} setPres={set.pres} liftField={f.liftField} entries={f.ctxEntries}
          categories={categories} day={day} fileAs={fileAs}
          onRedo={f.toFirst} talk={f.talk}
          onKeep={f.talk?.busy ? () => {} : keep} forId={f.forId} words={f.words}
          head={<>{forLine}{errLine}</>} />
      )}

      {s.step === 'kept' && s.pres && kept && (
        <StepPage>
          <KeptStep pres={s.pres} count={kept.count} parts={(splitPrescription as any)(s.pres)} words={f.keptWords} failed={kept.failed}
            onRetry={kept.plan ? () => { impact(); f.retryKept() } : null} retrying={s.saving}
            /* Nothing to start on a later day; leaving asks first if a workout is set aside (`keptStart`). */
            onStart={f.start?.run || null} startLabel={f.start?.label || null}
            onAnother={f.another}
            /* Kept for you on a later day: the way to it, on Today, in place of Back to
               today (#94, C N15). */
            onSee={onShowDay && kept.who?.me !== false && kept.date && kept.date > f.today
              ? () => { onShowDay(kept.date); f.close() } : null}
            seeLabel={kept.date ? seeWords(kept.date, f.today) : null}
            onDone={f.close} />
        </StepPage>
      )}
    </FullScreen>
  )
}

/* ------------------------------------------------------------- the day */

/**
 * Which day it goes on (#78): the day Today was showing, or any later one, never
 * earlier than today (a workout already done is logged, not planned). The web's
 * `PlanDay`: a label beside ‹ day ›, in words.
 */
export function PlanDay({ value, today, onChange }: { value: string; today: string; onChange: (iso: string) => void }) {
  const { min, max } = (dayBounds as any)(today)
  const words = (dayWords as any)(value, today)
  const date = /^(Today|Tomorrow)$/.test(words)
    ? (fromIso as any)(value).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
    : null
  return (
    <View style={st.planday} accessibilityLabel="Which day">
      <T size={font.label} dim weight={500}>Day</T>
      <View style={st.dayswitch}>
        <Press haptic onPress={() => onChange((isoShift as any)(value, -1))} disabled={value <= min} style={[st.dayBtn, value <= min && { opacity: 0.3 }]}
          accessibilityRole="button" accessibilityLabel="The day before">
          <Icon name="ChevronLeft" size={20} color={colors.inkDim} />
        </Press>
        <View style={{ flex: 1, minWidth: 0, alignItems: 'center' }} accessibilityLiveRegion="polite">
          <T size={font.body} weight={600}>{words}</T>
          {date ? <T size={font.caption} dim>{date}</T> : null}
        </View>
        <Press haptic onPress={() => onChange((isoShift as any)(value, 1))} disabled={value >= max} style={st.dayBtn}
          accessibilityRole="button" accessibilityLabel="The day after">
          <Icon name="ChevronRight" size={20} color={colors.inkDim} />
        </Press>
      </View>
    </View>
  )
}

/* ------------------------------------------------------------ what it is */

/**
 * "What is it?" (#78): the web's `FileAs`. Asked on the keep step only when
 * nothing on the workout says what it is (`needsFiling`). The catalog's pinned
 * sports as chips; "Other…" is the rest of the catalog as a system menu, by
 * group. One tap, never in the way: Keep works without it.
 */
export function FileAs({ choices, value = null, onChange }: { choices: any; value?: string | null; onChange: (k: string | null) => void }) {
  const pinned: any[] = choices?.pinned || []
  const other = value && !pinned.some((a: any) => a.key === value)
  const more = () => showActionTree(
    (choices?.groups || []).map((g: any) => ({ title: g.name, subactions: g.items.map((a: any) => ({ id: a.key, title: a.name })) })),
    (key: string) => onChange(key), 'What is it?')
  return (
    <View accessibilityLabel="What is it?">
      <SectionHeader title="What is it?" style={{ marginTop: 0 }} />
      <View style={st.chiprow}>
        {pinned.map((a: any) => (
          <Chip key={a.key} out icon={a.icon || 'Dumbbell'} label={a.name} on={value === a.key}
            onPress={() => onChange(value === a.key ? null : a.key)} />
        ))}
        {other ? <Chip out label={choices.nameOf(value) || String(value)} on onPress={() => onChange(null)} /> : null}
        <Chip out label="Other…" onPress={more} />
      </View>
    </View>
  )
}

/* ------------------------------------------------------------ the kinds */

/**
 * The kinds, under discipline headings. The groups are CONTENT
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

/**
 * Every kind as an optional chip, folded under one head, open once one is
 * picked: the ask's "Add a kind" and the builder's "Start from". Labels only: a
 * kind's `hint` and `prompt` are written for the model and never reach the
 * hand-built route.
 *
 * `onPicked` (the builder's Start from, #95, C N4, the web's): a pick folds the
 * list and hands the kind back, so the page can go to the block it made. Left
 * open it was three screens of chips with the new block under all of them.
 * Folded, its head says what was picked.
 */
export function KindChips({ plan, picked = [], setPicked, title, style, onPicked = null }: {
  plan: any; picked?: any[]; setPicked: (p: any[]) => void; title: string; style?: StyleProp<ViewStyle>
  onPicked?: ((k: any) => void) | null
}) {
  const groups = groupedKinds(plan)
  const has = (k: any) => picked.some((p: any) => p.key === k.key)
  const toggle = (k: any) => {
    const adding = !has(k)
    setPicked(adding ? [...picked, k] : picked.filter((p: any) => p.key !== k.key))
    if (adding && onPicked) { setOpened(false); onPicked(k) }
  }
  const known = new Set(groups.flatMap((g: any) => g.items.map((k: any) => k.key)))
  // A draft written before #59 may carry a "Something else" kind; it is shown, and can be taken off.
  const extra = picked.filter((k: any) => !known.has(k.key))
  const [opened, setOpened] = useState(false)
  const shown = opened || (!onPicked && picked.length > 0)
  const chip = (k: any) => <Chip key={k.key} out icon={k.icon || 'Dumbbell'} label={k.label} on={has(k)} onPress={() => toggle(k)} />

  return (
    <View style={style}>
      <Press onPress={() => { tap(); setOpened(!shown) }} accessibilityRole="button"
        accessibilityState={{ expanded: shown }} style={st.foldHead}>
        <T size={font.body} weight={600} style={{ flex: 1 }}>{title}</T>
        <T size={font.label} dim numberOfLines={1} style={{ flexShrink: 1 }}>
          {!picked.length ? 'Optional' : onPicked ? picked.map((k: any) => k.label).join(' + ') : `${picked.length} picked`}
        </T>
        <Icon name={shown ? 'ChevronUp' : 'ChevronDown'} size={16} color={colors.inkFaint} />
      </Press>
      {shown ? (
        <>
          {extra.length > 0 ? <View style={[st.chiprow, { marginTop: space[3] }]}>{extra.map(chip)}</View> : null}
          {groups.map((g: any) => (
            <View key={g.key} style={{ marginTop: space[3] }} accessibilityLabel={g.name}>
              <T size={font.label} dim weight={500} style={{ marginBottom: space[2] }}>{g.name}</T>
              <View style={st.chiprow}>{g.items.map(chip)}</View>
            </View>
          ))}
        </>
      ) : null}
    </View>
  )
}

/* ------------------------------------------------- step: how long, what for */

/**
 * How long, set ONE way (#78): the content's chips, and "Other" for anything
 * else, a box in minutes in the row. A time from an older draft that is not a
 * chip shows as its own chip, picked.
 */
export function MinuteChips({ minutes, setMinutes, chips = DEFAULT_MINUTES }: {
  minutes: number; setMinutes: (m: number) => void; chips?: number[]
}) {
  const [other, setOther] = useState(false)
  const listed = chips.includes(minutes)
  return (
    <View style={st.chiprow}>
      {chips.map((m: number) => (
        <Chip key={m} out label={`${m} min`} on={minutes === m && !other} onPress={() => { setOther(false); setMinutes(m) }} />
      ))}
      {!listed && !other ? <Chip out label={`${minutes} min`} on onPress={() => setOther(true)} /> : null}
      {other ? (
        <View style={st.minOther}>
          <NumInput value={minutes} decimal={false} accessibilityLabel="How many minutes" autoFocus
            keyboardType="number-pad" keyboardAppearance="dark" selectTextOnFocus style={st.minOtherIn}
            onChange={(v: any) => { if (v) setMinutes(Math.min(300, Math.max(5, v))) }} />
          <T size={font.label} dim>min</T>
        </View>
      ) : (
        <Chip out label="Other" onPress={() => setOther(true)} />
      )}
    </View>
  )
}

/**
 * "Write it for me": one box and one button (#59). What they want to do, in
 * their own words, is the whole brief. How long is a row of chips; the day is
 * the ‹ day ›; the kinds are folded optional chips. "Build it myself" is a quiet
 * door at the foot, straight to the editor ("Back to your workout" once one is set aside).
 */
export function AskStep({
  goal, setGoal, minutes, setMinutes, chips = DEFAULT_MINUTES, plan = null, picked = [], setPicked,
  onGo, onBuild = null, evicts = null, busy = false, head = null, day = null, building = false,
}: any) {
  const ready = Boolean(goal.trim() || picked.length)

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
        <MinuteChips minutes={minutes} setMinutes={setMinutes} chips={chips} />
      </View>

      {day ? <View style={st.askblock}>{day}</View> : null}

      {/* Folded, so the screen is the box and the button; open when something in it is picked. */}
      <KindChips plan={plan} picked={picked} setPicked={setPicked} title="Add a kind" style={{ marginBottom: space[4] }} />

      {onBuild ? (
        <Btn kind="quiet" icon="ListPlus" title={building ? 'Back to your workout' : 'Build it myself'} onPress={onBuild} style={{ alignSelf: 'flex-start' }} />
      ) : null}

      {/* At the cap, the oldest draft not being written makes room. Said before, not after. */}
      {evicts ? (
        <View style={st.evicts}>
          <Icon name="Info" size={14} color={colors.inkDim} />
          <T size={font.label} dim style={{ flex: 1 }}>Replaces your oldest draft, {draftTitle(evicts)}</T>
        </View>
      ) : null}
    </StepPage>
  )
}

/* ------------------------------------------------------------ step: working */

/**
 * The wait, made legible. Thirty to ninety seconds of an agent reading their log,
 * and a bare spinner for that long is a screen the user backs out of. So it counts
 * up, and one line says what it is doing and only that: no stages on a timer the
 * run never reported (#78). `since` is when the draft's run started; leaving
 * cancels nothing (the run is the draft's, on the server) and the screen says so.
 */
export const WORKING_LINE = 'Reading your recent workouts and writing the sets…'

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

  return (
    <View style={st.working}>
      <Icon name="Sparkles" size={28} color={colors.accent} />
      <T size={font.title} weight={600} align="center" style={{ marginTop: space[3] }}>
        {label ? `Building ${minutes} minutes of ${label.toLowerCase()}` : `Writing ${minutes} minutes`}
      </T>
      <T size={font.body} dim align="center" style={{ marginTop: space[2], marginBottom: space[4] }}>{WORKING_LINE}</T>
      <PulseDots style={{ marginBottom: space[3] }} />
      <T size={font.label} dim align="center" tabular>{secs}s · You can leave; it keeps going</T>
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
                  <T size={font.label} dim tabular numberOfLines={1}>{draftLine(d, at)}</T>
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
      <Icon name="Sparkles" size={14} color={colors.accent} style={{ marginTop: space[1] }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={long && !shown ? { maxHeight: 63, overflow: 'hidden' } : null}>
          <Markdown text={text} size={13.5} color={colors.inkDim} />
        </View>
        {long && (
          <Press onPress={() => { tap(); setShown(v => !v) }} style={{ marginTop: space[2], alignSelf: 'flex-start' }}>
            <T size={font.label} color={colors.accent} style={st.link}>{shown ? 'less' : 'why this session'}</T>
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
        <T size={font.label} weight={600} style={{ flex: 1 }}>
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
                <Press onPress={() => { tap(); setFull(v => !v) }} style={{ marginTop: space[2], alignSelf: 'flex-start' }}>
                  <T size={font.label} color={colors.accent} style={st.link}>{full ? 'less' : 'read the rest'}</T>
                </Press>
              )}
            </View>
          ) : null}

          <TalkThread thread={thread} asking={asking} thinking="Rewriting it…" />

          {error && (
            <View style={st.err}>
              <Icon name="TriangleAlert" size={13} color={colors.bad} style={{ marginTop: space[1] }} />
              <T size={font.caption} color={colors.bad} style={{ flex: 1 }}>{error} — your session is unchanged.</T>
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
    <View style={st.talkN}><T size={font.caption} weight={700} lineHeight={14} color={colors.bg}>{n}</T></View>
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
        <View style={[st.msg, st.msgCoach, { flexDirection: 'row', alignItems: 'center', gap: space[2] }]}>
          <PulseDots size={6} gap={4} />
          <T size={font.caption} dim>{thinking}</T>
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
          <T size={font.caption} dim>{q}</T>
        </Press>
      ))}
    </View>
  )
}

export function TalkAsk({ text, setText, asking, onAsk, label, placeholder }: {
  text: string; setText: (v: string) => void; asking: boolean; onAsk: (v: string) => void; label: string; placeholder: string
}) {
  return (
    <View style={{ flexDirection: 'row', gap: space[2], alignItems: 'flex-end' }}>
      <Input multiline value={text} editable={!asking} onChangeText={setText}
        placeholder={placeholder} style={{ flex: 1, minWidth: 0, minHeight: height.row }} />
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
 * The same editor, open from the first tap (#78): no kind is needed. It opens on
 * one empty block, with the kinds as an optional "Start from" row while nothing
 * is in it (Legs and Ride make the two blocks "Legs + a ride" lands as); once an
 * exercise is in, the blocks are the user's and the row goes. Missing on purpose:
 * no `PlanTalk`, no "why", no Redo.
 */
export function BuildStep({
  pres, setPres, liftField, entries = [], categories = [], onKeep, words = forWords(FOR_ME), head = null,
  plan = null, picked = [], setPicked = null, day = null, busy = false, fileAs = null,
}: any) {
  const sets = (prescriptionSteps as any)(pres).length
  const empty = !(hasWork as any)(pres)
  /* A Start-from pick folds the chips and makes a block: the page goes to the
     editor once it has moved up into place (its onLayout after the fold). */
  const scroller = useRef<ScrollView | null>(null)
  const goToNew = useRef(false)
  const editorAt = (y: number) => {
    if (!goToNew.current) return
    goToNew.current = false
    scroller.current?.scrollTo({ y: Math.max(0, y - space[2]), animated: true })
  }

  return (
    <StepPage scrollRef={scroller}
      foot={<Btn icon="Plus" title={words.keep} disabled={!sets || busy} onPress={onKeep} />}
      after={!sets ? <T style={st.fine}>Add an exercise or an interval to keep it</T> : null}
    >
      {head}
      {empty && setPicked ? (
        <KindChips plan={plan} picked={picked} setPicked={setPicked} title="Start from" style={{ marginBottom: space[4] }}
          onPicked={() => { goToNew.current = true; setTimeout(() => { goToNew.current = false }, 800) }} />
      ) : null}
      <SplitNote parts={(splitPrescription as any)((dropEmptyBlocks as any)(pres))} />

      <View onLayout={(e) => editorAt(e.nativeEvent.layout.y)}>
        <PrescriptionEditor pres={pres} onChange={setPres} liftField={liftField} entries={entries}
          categories={categories} onAddPiece={
            (blockId: string, name: string, by: string, unit: string) =>
              setPres((appendPiece as any)(pres, name, { blockId, by, unit }))
          } />
      </View>

      {fileAs ? <View style={{ marginTop: space[6] }}>{fileAs}</View> : null}
      {day ? <View style={{ marginTop: space[6] }}>{day}</View> : null}
    </StepPage>
  )
}

/* ------------------------------------------------------------- step: review */

function ReviewStep({ pres, setPres, liftField, entries = [], categories = [], onRedo, onKeep, forId = null, words = forWords(FOR_ME), head = null, talk = null, day = null, fileAs = null }: any) {
  return (
    <StepPage
      foot={
        <View style={{ flexDirection: 'row', gap: space[2] }}>
          <Btn kind="secondary" icon="RotateCw" title="Redo" onPress={onRedo} />
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
              <Icon name="Info" size={13} color={colors.inkFaint} style={{ marginTop: space[1] }} />
              <T size={font.label} faint style={{ flex: 1 }}>{n}</T>
            </View>
          ))}
        </View>
      )}

      <T style={st.fine}>
        Written from {words.from}. Change anything before you keep it.
      </T>

      {fileAs ? <View style={{ marginTop: space[6] }}>{fileAs}</View> : null}
      {day ? <View style={{ marginTop: space[6] }}>{day}</View> : null}
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
      <Icon name="Layers" size={14} color={colors.series1} style={{ marginTop: space[1] }} />
      <View style={{ flex: 1, minWidth: 0, gap: space[1] }}>
        <T size={font.label} weight={600}>This lands as {parts.length} separate workouts</T>
        <T size={font.label} dim>{parts.map(p => p.title).join(' · ')}</T>
      </View>
    </View>
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
/** "See it tomorrow", "See it on Mon, Nov 9": the kept screen's way to a later day (#94). */
export const seeWords = (date: string, today: string) => {
  const words: string = (dayPhrase as any)(date, today)
  return /^(today|tomorrow)$/.test(words) ? `See it ${words}` : `See it on ${words}`
}

export function KeptStep({ pres, count = 1, parts = [], onStart, onAnother, onDone, forName = null, words = null, failed = [], startLabel = null, onRetry = null, retrying = false, onSee = null, seeLabel = null }: any) {
  const many = count > 1
  const w = words || forWords(forName ? { me: false, others: [{ id: forName, name: forName }] } : FOR_ME)
  const where = w.where
  return (
    <View style={st.kept}>
      <Icon name="CircleCheck" size={44} color={colors.vizGood} />
      <T size={font.screen} weight={600} align="center" style={{ marginTop: space[3], marginBottom: space[2] }}>
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

      <T size={font.label} dim align="center" style={{ marginTop: many ? space[4] : 0 }}>
        {many ? '' : `${(prescriptionLine as any)(pres)} · `}
        {w.after}
      </T>

      {/* Not on everyone's day: said, by name, with where to try again. Planned for
          others only, that is here (`onRetry`); shared from your own workout, it is
          "With …" on its sheet. */}
      {failed.map((f: any) => (
        <T key={f.person.id} size={font.label} color={colors.bad} align="center" style={{ marginTop: space[2] }}>
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
          <T size={font.label} dim align="center" style={{ marginTop: space[2] }}>
            If you close this, plan {namesOf(failed.map((f: any) => f.person))}’s again from Plan a workout.
          </T>
        </>
      ) : null}

      <View style={st.keptActs}>
        {onStart && (
          <Btn icon="Play" title={startLabel || (forName ? `Open it on ${forName}’s side` : many ? `Start ${parts[0]?.title || 'workout'}` : 'Start workout')}
            onPress={() => { impact(); onStart() }} style={{ minHeight: height.row }} />
        )}
        <Btn kind={onStart ? 'secondary' : 'primary'} icon="Plus" title="Plan another workout" onPress={onAnother} />
        {onSee
          ? <Btn kind="secondary" icon="CalendarDays" title={seeLabel} onPress={onSee} />
          : <Btn kind="secondary" icon="House" title="Back to today" onPress={onDone} />}
      </View>
    </View>
  )
}


const st = StyleSheet.create({
  sticky: {
    paddingTop: space[3], paddingHorizontal: space.gutter, backgroundColor: colors.bg,
    shadowColor: colors.bg, shadowOffset: { width: 0, height: -9 }, shadowOpacity: 1, shadowRadius: 9,
  },
  actions: { flexDirection: 'row', gap: space[2], marginTop: space[4] },
  // The fork wraps rather than squeezes: an ellipsised label is a choice nobody can read.
  fork: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  forkBtn: { flexGrow: 1, flexShrink: 1, flexBasis: 148 },
  fine: { color: colors.inkDim, fontSize: font.label, lineHeight: Math.round(font.label * 1.45), marginTop: space[2] },
  link: { textDecorationLine: 'underline' },
  errLine: { marginTop: space[2], marginBottom: space[3] },

  // One card of .list-rows with hairlines between them (the drafts).
  list: { paddingVertical: 0, marginBottom: 0 },
  rowRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  foldHead: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: TAP },

  askblock: { marginBottom: space[6] },
  // How long, "Other": a box in minutes in the chip row.
  minOther: {
    flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: TAP, paddingLeft: space[1], paddingRight: space[3],
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.accentLine, backgroundColor: colors.accentSoft,
  },
  minOtherIn: { width: 56, minHeight: TAP, paddingVertical: 0, textAlign: 'center' },
  // Which day (#78): a label beside the rest day's ‹ day ›.
  planday: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  dayswitch: {
    flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space[1],
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: radius.control,
  },
  dayBtn: { width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center' },
  chiprow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  evicts: { flexDirection: 'row', alignItems: 'center', gap: space[2] },

  working: { alignItems: 'center', paddingVertical: space[8], paddingHorizontal: space[3] },
  drafts: { marginBottom: space[2] },
  draft: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  draftOpen: { flex: 1, minWidth: 0, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2] },
  failed: { paddingVertical: space[6] },
  failedLead: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2], marginBottom: space[2] },

  why: {
    flexDirection: 'row', gap: space[2], marginBottom: space[4], paddingVertical: space[3], paddingHorizontal: space[4], borderRadius: radius.card,
    backgroundColor: mix(colors.accent, 7, colors.panel2), borderWidth: 1, borderColor: mix(colors.accent, 24, colors.line),
  },

  talk: {
    marginBottom: space[6], borderRadius: radius.card, overflow: 'hidden',
    backgroundColor: mix(colors.accent, 7, colors.panel2), borderWidth: 1, borderColor: mix(colors.accent, 24, colors.line),
  },
  talkHead: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[3], paddingHorizontal: space[3], minHeight: TAP },
  talkBody: { paddingHorizontal: space[3], paddingBottom: space[3] },
  talkN: {
    minWidth: 20, height: 20, paddingHorizontal: space[2], borderRadius: radius.pill,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent,
  },
  msg: { marginVertical: space[2], paddingVertical: space[2], paddingHorizontal: space[3], borderRadius: radius.control },
  msgYou: { marginLeft: '22%', backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line },
  msgCoach: {
    marginRight: '10%', borderLeftWidth: 2, borderLeftColor: mix(colors.accent, 50, colors.panel2),
    borderTopLeftRadius: 0, borderBottomLeftRadius: 0,
  },
  err: { flexDirection: 'row', gap: space[2], marginTop: space[2] },
  prompts: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[3], marginBottom: space[2] },
  prompt: {
    minHeight: TAP, paddingHorizontal: space[3], borderRadius: radius.pill, justifyContent: 'center',
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line,
  },

  split: {
    flexDirection: 'row', gap: space[2], marginBottom: space[4], paddingVertical: space[3], paddingHorizontal: space[3], borderRadius: radius.card,
    backgroundColor: mix(colors.series1, 9, colors.panel2), borderWidth: 1, borderColor: mix(colors.series1, 28, colors.line),
  },

  kept: { alignItems: 'center', paddingTop: space[8], paddingHorizontal: space[2] },
  keptParts: { alignSelf: 'stretch', gap: space[2] },
  keptPart: {
    gap: 1, paddingVertical: space[2], paddingHorizontal: space[3], backgroundColor: colors.panel2,
    borderWidth: 1, borderColor: colors.line, borderLeftWidth: 3, borderLeftColor: colors.accent, borderRadius: radius.control,
  },
  keptActs: { alignSelf: 'stretch', gap: space[2], marginTop: space[6] },
})
