/*
 * ONE exercise card, and one list of them, for BOTH screens.
 *
 * Planned workouts and logged workouts should look exactly the same, and where
 * they differed the plan side won. Logging a workout and planning one are the
 * same act against different numbers, so this is literally the same component
 * and cannot drift again.
 *
 * WHAT THE TWO SIDES HAND OVER is a normalised item:
 *
 *   { id, name, group, exercise, note, kind, line,
 *     implement, implementLabel, weightLabel,
 *     sets: [{ id, reps, weight, seconds, distance, unit, restSec }] }
 *
 * A PRESCRIPTION item already is one. A LOGGED lift is adapted in `liftlog.tsx`:
 * its sets are POSITIONAL, so their ids are their indices. Nothing about that
 * leaks in here. A blank is `''` on the log and `null` on a prescription; `blank`
 * on the stepper is how that survives sharing a component.
 *
 * Native: the picker is a page sheet (the keyboard waits for a tap on the
 * search box: up at once, it covered the list, #93), set rows and folded cards
 * swipe left to remove (Edit's Remove stays), every step ticks, and a set that
 * becomes complete buzzes.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, FlatList, Linking, ScrollView, StyleSheet, View, type TextInputProps } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable'
import { colors, font, mix, radius, space, TAP, height } from '../theme'
import { T } from '../ui/Text'
import { Btn, IconBtn, Input, Press } from '../ui/kit'
import { Popover, useSheetScroll } from '../ui/Sheet'
import { showMenu } from '../ui/menu'
import { impact, success, tap, warn } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { pushToast, dismissToast } from '../lib/toast'
import { NumInput } from './numinput'
import { setFieldsFor, measureOfItem, timeBox, bumpTime, setTicked, itemTicked, setHasNumber, doingMove } from '../lib/prescription.js'
import { acceptMinutesText, minutesText, numOrNull } from '../lib/numtext.js'
import {
  searchExercises, implementsFor, lastLift, catalogOf, exerciseOf, muscleName, measureFor,
  weightModesFor, weightPatch, nextWeightMode, rememberedWeightMode, weightModeWords, weightBoxOf,
  implementChoices, implementLabel, weightModeOf, weightMeaning, weightUnit, lastTimeFill, lastTimeWhen,
  pickerGroupFor, copyDownFills, canCopyDown, unfills, cardIdentity, cardKey,
} from '../lib/lifts.js'
import { ExerciseBody, BodyMap, musclesOf, muscleWords } from '../lib/bodymap'
import { HowBody } from './howto'

/**
 * What each field is called and how far one press moves it.
 *
 * Five pounds and twenty-five yards because that is what a plate and a length
 * are; one rep and five seconds because that is what those are. The weight's
 * label comes off the IMPLEMENT — "30 lb per hand" and "135 lb on the bar" are
 * different numbers and the box has to say which — and the mode the user
 * switched it to (`weightSwitch`).
 */
export const STEP: Record<string, (item?: any, set?: any) => { label: string; step: number; min: number }> = {
  reps: () => ({ label: 'reps', step: 1, min: 0 }),
  weight: (item) => ({ label: item?.weightLabel || 'lb', step: 5, min: 0 }),
  // A pool length is 25 of something and a mile is not, so the step follows the UNIT.
  distance: (item, set) => {
    const label = set?.unit || item?.unit || 'yd'
    return { label, step: /^(mi|km)$/i.test(label) ? 0.5 : 25, min: 0 }
  },
  // And the seconds step follows the SIZE: five at a time is right for a hang,
  // and 540 presses for a forty-five minute ride.
  seconds: (_item, set) => ({ label: 'sec', step: Number(set?.seconds) >= 180 ? 30 : 5, min: 0 }),
}

/**
 * The box for one field of a set, in the editor and the runner alike. A piece's
 * time is a minutes box (`timeBox`, #78: `time`), a hold's is seconds; the set
 * keeps seconds either way.
 */
export const boxFor = (f: string, item: any, set: any): { label: string; step: number; min: number; time?: boolean } =>
  (f === 'seconds' ? { ...(timeBox as any)(item, set), min: 0 } : STEP[f] ? STEP[f](item, set) : { label: f, step: 1, min: 0 })

/** One press of a stepper's −/+: the web's `stepBox`, shared by `Stepper` and the runner's `BigStepper`. */
export function stepBox({ step = 1, min = null, max = null, time = false }: { step?: number; min?: number | null; max?: number | null; time?: boolean }, value: any, d: number): number {
  if (time) return (bumpTime as any)(value, d)
  let next = (Number(value) || 0) + d * step
  if (min !== null) next = Math.max(min, next)
  if (max !== null) next = Math.min(max, next)
  return Math.round(next * 100) / 100
}

/**
 * A minutes box over seconds (#78): the web's `TimeInput`. Takes "45", "1.5" and
 * "1:40" (`acceptMinutesText`), shows "1:40", never "1.67". The keyboard has the colon.
 */
export function TimeInput({ value, onChange, blank = null, placeholder = '—', style, ...rest }: Omit<TextInputProps, 'value' | 'onChange'> & {
  value: any; onChange: (v: any) => void; blank?: any
}) {
  const shown = (minutesText as any)(value)
  const [text, setText] = useState(shown)
  const last = useRef((numOrNull as any)(value))
  useEffect(() => {
    const v = (numOrNull as any)(value)
    if (v !== last.current) { last.current = v; setText(shown) }
  }, [value, shown])
  const change = (raw: string) => {
    const r = (acceptMinutesText as any)(raw)
    if (!r) return
    setText(r.text)
    if (!r.emit) return
    last.current = r.value
    onChange(r.value === null ? blank : r.value)
  }
  const ph = (numOrNull as any)(placeholder) === null ? placeholder : (minutesText as any)(placeholder)
  return (
    <Input value={text} onChangeText={change} onBlur={() => setText(shown)} placeholder={ph}
      keyboardType="numbers-and-punctuation" style={style} {...rest} />
  )
}

/**
 * A row that swipes left to reveal Remove — the native form of the web's X,
 * which stays on the row as the visible affordance.
 */
export function SwipeRemove({ children, onRemove, label = 'Remove', enabled = true }: {
  children: React.ReactNode
  onRemove: () => void
  label?: string
  enabled?: boolean
}) {
  return (
    <ReanimatedSwipeable
      enabled={enabled}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={(_p, _t, methods) => (
        <Press
          onPress={() => { tap(); methods.close(); onRemove() }}
          accessibilityRole="button" accessibilityLabel={label}
          style={sw.act}
        >
          <Icon name="Trash2" size={16} color={colors.white} />
          <T size={font.label} weight={600} color={colors.white}>{label}</T>
        </Press>
      )}
    >
      {children}
    </ReanimatedSwipeable>
  )
}

const sw = StyleSheet.create({
  act: {
    width: 88, marginLeft: space[2], borderRadius: radius.control, backgroundColor: colors.vizCrit,
    alignItems: 'center', justifyContent: 'center', gap: 2,
  },
})

export type WeightSwap = { box: string; next: string; aria?: string; onSwitch: () => void } | null

/**
 * The tap that changes what a lift's weight means (issue #58), or null where
 * its implement has one meaning: the runner's 44pt pill. The card's is
 * `modeFlip` (#93), once per exercise and with Undo.
 */
export function weightSwitch(liftField: any, item: any, onPatch: (patch: any) => void): WeightSwap {
  if (item?.kind !== 'lift' || weightModesFor(liftField, item.implement).length < 2) return null
  const next = (weightPatch as any)(liftField, item.implement, nextWeightMode(liftField, item))
  return { box: (weightBoxOf as any)(liftField, item), next: next.weightLabel, onSwitch: () => { tap(); onPatch(next) } }
}

/**
 * What tapping an implement chip writes: the implement, in the mode this
 * exercise was last logged in with it (lib/lifts.js). Null for the chip already
 * chosen: memory is applied when an implement is picked, and a second tap on
 * the same one must not quietly undo a switch made since.
 */
export function implementPick(liftField: any, item: any, impl: any, entries: any[] = [], entryId: string | null = null) {
  if (!impl || impl.value === item.implement) return null
  return {
    implement: impl.value, implementLabel: impl.label,
    ...(weightPatch as any)(liftField, impl.value,
      (rememberedWeightMode as any)(liftField, entries, item.exercise, impl.value, entryId)),
  }
}

/**
 * The tap that counts a hold in reps instead, or back (issue #63 review), or
 * null. Offered on a movement the catalog calls a hold while nothing is counted
 * on it yet, under the count's own box, like the weight's meaning.
 */
export function countSwitch(liftField: any, item: any, onPatch: (patch: any) => void): WeightSwap {
  if (item?.kind !== 'lift' || !item.exercise || measureFor(liftField, item.exercise) !== 'time') return null
  const counted = (item.sets || []).some((s: any) => (s.reps !== null && s.reps !== undefined && s.reps !== '')
    || (s.seconds !== null && s.seconds !== undefined && s.seconds !== ''))
  if (counted) return null
  const now = measureOfItem(item)
  const next = now === 'time' ? 'reps' : 'time'
  return {
    box: now === 'time' ? 'sec' : 'reps',
    aria: `Counted in ${now === 'time' ? 'seconds' : 'reps'}. Switch to ${next === 'time' ? 'seconds' : 'reps'}`,
    next, onSwitch: () => { tap(); onPatch({ measure: next }) },
  }
}

/**
 * One number, moved with thumbs (docs/DESIGN.md, Stepper): − and + either side
 * of an input that is still an input, what it measures under it, on the tokens.
 * Two fit beside a set's ✓ on a 390pt phone (`SET_ROW`). The minus goes inert
 * at the floor rather than disappearing — a control that vanishes under your
 * thumb mid-session moves everything next to it. The big sibling is the runner's.
 *
 * THE NUMBER IS THE CELL (#93): the input is the whole middle, 44pt tall, with
 * its one-word unit drawn inside it under the number and taking no touch, so a
 * tap anywhere between the ± puts the cursor in the number. It was a 48×22 box
 * under the weight's meaning switch, whose hitSlop made it the cell's biggest
 * target: a tap aimed at 90 turned "on the bar" into "per side". What a number
 * means is the card's to say now, once (`ModeSwitch`). `label` stays the box's
 * full accessible name; `unit` is what it shows.
 */
export function Stepper({
  label, unit = null, value, step = 1, min = null, max = null, suffix = '', quiet = false,
  blank = null, placeholder = '—', onChange, time = false, grow = false, focus = false,
}: {
  /** Mount with the keyboard up: a blank set's ✓ asks for its first number this way. */
  focus?: boolean
  /** A minutes box over seconds (`boxFor`), stepped by `bumpTime`. */
  time?: boolean
  /** In a set row: take the row's spare width, so the number box is the big target. */
  grow?: boolean
  label: string
  /** The short word under the number ("lb"); `label` when absent. */
  unit?: string | null
  value: any
  placeholder?: string
  step?: number
  min?: number | null
  max?: number | null
  suffix?: string
  quiet?: boolean
  blank?: any
  onChange: (v: any) => void
}) {
  const n = Number(value) || 0
  const bump = (d: number) => { tap(); onChange(stepBox({ step, min, max, time }, value, d)) }
  return (
    <View style={[st.stepper, quiet && st.stepperQuiet, grow && st.stepperGrow]}>
      <Press onPress={() => bump(-1)} disabled={min !== null && n <= min} style={st.stepperBtn}
        accessibilityRole="button" accessibilityLabel={`less ${label}`}>
        <Icon name="Minus" size={15} color={colors.inkDim} />
      </Press>
      <View style={[st.stepperMid, grow && { flex: 1 }]}>
        {time ? (
          <TimeInput value={value} accessibilityLabel={label} placeholder={placeholder} blank={blank} onChange={onChange} autoFocus={focus}
            placeholderTextColor={colors.inkFaint} keyboardAppearance="dark" selectionColor={colors.accent}
            selectTextOnFocus style={st.stepperIn} />
        ) : (
          <NumInput
            value={value} accessibilityLabel={label} placeholder={placeholder} blank={blank} onChange={onChange} autoFocus={focus}
            placeholderTextColor={colors.inkFaint} keyboardAppearance="dark" selectionColor={colors.accent}
            selectTextOnFocus style={st.stepperIn}
          />
        )}
        <View pointerEvents="none" style={st.unit}>
          <T size={font.label} dim numberOfLines={1} align="center">{`${unit ?? label}${suffix}`}</T>
        </View>
      </View>
      <Press onPress={() => bump(1)} disabled={max !== null && n >= max} style={st.stepperBtn}
        accessibilityRole="button" accessibilityLabel={`more ${label}`}>
        <Icon name="Plus" size={15} color={colors.inkDim} />
      </Press>
    </View>
  )
}

/**
 * What one tap on the card's meaning switch does (#93): write the next meaning
 * and offer Undo, because it changes what every number on the exercise stands
 * for (and what weight memory learns). `write` writes through the card's LATEST
 * closure, so an Undo seconds later lands on today's plan. Null where the
 * implement has one meaning. The web's `modeFlip`.
 */
export function modeFlip(liftField: any, item: any, write: (patch: any) => void,
  toast: { push: typeof pushToast; dismiss: typeof dismissToast } = { push: pushToast, dismiss: dismissToast }) {
  if (item?.kind !== 'lift' || weightModesFor(liftField, item.implement).length < 2) return null
  const before = (weightPatch as any)(liftField, item.implement, weightModeOf(liftField, item))
  const next = (weightPatch as any)(liftField, item.implement, nextWeightMode(liftField, item))
  const nextWords = (weightMeaning as any)(liftField, { implement: item.implement, weightMode: next.weightMode })?.words
  return {
    words: (weightMeaning as any)(liftField, item)?.words as string,
    next: next.weightLabel as string,
    onSwitch: () => {
      tap()
      write(next)
      toast.push(`${item.name}: weight now ${nextWords}`, 'info', {
        duration: UNDO_MS,
        action: { label: 'Undo', icon: null, onClick: () => write(before) },
      })
    },
  }
}

/**
 * The card's one switch for what its weight means (#93; #58's switch, moved out
 * of every set's cell): "on the bar ⇆", once per exercise, beside what it is done
 * with. A hold's "seconds ⇆" sits here too. With one meaning the words are said,
 * not offered.
 */
function ModeSwitch({ words, aria, onSwitch }: { words: string; aria?: string; onSwitch?: () => void }) {
  if (!onSwitch) return <T size={font.label} dim style={{ paddingHorizontal: space[1] }}>{words}</T>
  return (
    <Press onPress={onSwitch} style={st.modeSwitch} accessibilityRole="button" accessibilityLabel={aria}>
      <T size={font.label} dim numberOfLines={1}>{words}</T>
      <Icon name="ArrowLeftRight" size={13} color={colors.inkDim} />
    </Press>
  )
}

/**
 * The set row's widths (#93, F N1), named so `app/smoke/system.jsx` can add
 * them up for a 390pt phone: the ✓, the gap after it (16 clear of the reps' −,
 * so a left-thumb miss on − never ticks), each stepper's middle, and the seam
 * between the two steppers. 44 + 16 + 2 × (1 + 44 + 44 + 44 + 1) + 2 = 330,
 * inside the card's 332, so reps, weight and the ✓ are ONE row;
 * they wrapped onto two (each set about 100pt tall) when the meaning switch
 * widened the weight's middle.
 */
export const SET_ROW = { tick: TAP, tickGap: space[4], mid: TAP, seam: 2 }

/* ------------------------------------------------------- what the movement is */

/**
 * One exercise, explained (issue #63): what it works, what it needs, how to do
 * it, the one thing to watch, and a video when the library has one.
 *
 * Reference, so a page sheet (the web's popover), never a full screen. It opens
 * from a lift card's name, the runner's, and the picker's "what is this?" before
 * the exercise is added. Read between sets, so the gist leads. No how-to still
 * shows the body and the muscles. `onAdd` (the picker) puts the one primary in
 * the foot. The video opens in the in-app browser, as Settings does; a link the
 * browser cannot take goes to the system.
 */
export function ExerciseSheet({ field, exercise, name = null, onClose, onAdd = null, visible = true, onDismiss }: {
  field: any; exercise: string; name?: string | null; onClose: () => void; onAdd?: (() => void) | null
  visible?: boolean; onDismiss?: () => void
}) {
  const insets = useSafeAreaInsets()
  const ex: any = (exerciseOf as any)(field, exercise)
  const title = ex?.name || name || 'Exercise'
  const m = musclesOf(field, exercise)
  const video = ex?.video?.url && /^https:\/\//.test(ex.video.url) ? ex.video : null
  const context = [ex?.group, ex?.measure === 'time' ? 'Held for time' : null].filter(Boolean).join(' · ')
  const watch = () => {
    impact()
    WebBrowser.openBrowserAsync(video.url).catch(() => { Linking.openURL(video.url).catch(() => {}) })
  }
  const fact = (k: string, v: string) => (
    <View style={st.fact}>
      <T size={font.label} dim style={{ width: TAP }}>{k}</T>
      <T size={font.label} style={{ flex: 1 }}>{v}</T>
    </View>
  )

  return (
    <Popover label={`About ${title}`} onClose={onClose} visible={visible} onDismiss={onDismiss}>
      <View style={st.sheetHead}>
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <T size={font.title} weight={600}>{title}</T>
          {context ? <T size={font.caption} dim>{context}</T> : null}
        </View>
        <IconBtn icon="X" label="Close" onPress={onClose} />
      </View>
      <ScrollView contentContainerStyle={st.sheetBody}>
        {m ? (
          <View style={st.works}>
            <BodyMap primary={m.primary} secondary={m.secondary} size={56} label={`${title} works ${m.primary.join(', ')}`} />
            <View style={{ flex: 1, gap: space[1] }}>
              {fact('Works', m.primary.map(muscleName).join(', '))}
              {m.secondary.length ? fact('Also', m.secondary.map(muscleName).join(', ')) : null}
              {ex?.equipment ? fact('Needs', ex.equipment) : null}
            </View>
          </View>
        ) : ex?.equipment ? fact('Needs', ex.equipment) : null}

        {ex?.how ? <HowBody how={ex.how} showFigure={false} />
          : <T size={font.label} dim>No step-by-step for this one yet.</T>}

        {video ? (
          <View style={{ gap: space[1], alignItems: 'flex-start' }}>
            <Btn kind="secondary" icon="Play" title="Watch how" onPress={watch} />
            {video.channel || video.title ? (
              <T size={font.caption} dim>{[video.title, video.channel].filter(Boolean).join(' · ')}</T>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      {onAdd ? (
        <View style={[st.sheetFoot, { paddingBottom: Math.max(insets.bottom, space[3]) }]}>
          <Btn icon="Plus" title={`Add ${title}`} onPress={() => { impact(); onAdd() }} />
        </View>
      ) : null}
    </Popover>
  )
}

/* ------------------------------------------------------------- the picker */

/**
 * Two hundred movements, searched rather than scrolled.
 *
 * Tapping a group chip SEARCHES for the group, so browsing and searching are the
 * same mechanism, and someone who does not want to type still has a way in.
 */
export function ExercisePicker({ field, onPick, onClose, group = null }: any) {
  const [q, setQ] = useState('')
  const { exercises, groups } = catalogOf(field) as any
  /* A tapped group chip is that group exactly; typing makes it a search again.
     It opens on the block's group (#93, `pickerGroupFor`), and the chips stay
     up with that one on; tapping it again is the whole catalog. */
  const [chip, setChip] = useState<string | null>(group && groups.includes(group) ? group : null)
  const hits = useMemo(() => (searchExercises as any)(field, chip ? '' : q, { limit: 24, group: chip }), [field, q, chip])
  /*
   * "What is this?" before adding it (issue #63): the sheet, with Add in its
   * foot. Add slides the sheet away FIRST and adds once it is gone (onDismiss):
   * closing the picker under a sheet still on its way out leaves iOS stuck
   * mid-transition. `about` stays set while it slides, so it keeps its words.
   */
  const [about, setAbout] = useState<string | null>(null)
  const [showing, setShowing] = useState(false)
  const adding = useRef<string | null>(null)
  const ask = (key: string) => { setAbout(key); setShowing(true) }
  const gone = () => {
    const key = adding.current
    adding.current = null
    setAbout(null)
    if (key) onPick(key)
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={st.pickHead}>
        <Input
          value={q} onChangeText={(t: string) => { setQ(t); setChip(null) }}
          accessibilityLabel="Search for an exercise"
          placeholder={`search ${exercises.length} exercises…`}
          autoCorrect={false} autoCapitalize="none" returnKeyType="search" clearButtonMode="while-editing"
          style={{ flex: 1, minWidth: 0 }}
        />
        {onClose && <IconBtn icon="X" size={16} label="Close" onPress={onClose} />}
      </View>

      {!q.trim() && groups.length > 0 && (
        <View style={st.pickGroups}>
          {groups.map((g: string) => (
            <Press key={g} haptic onPress={() => setChip(chip === g ? null : g)} style={[st.implchip, chip === g && st.implchipOn]}
              accessibilityRole="button" accessibilityState={{ selected: chip === g }}>
              <T size={font.label} color={chip === g ? colors.ink : colors.inkDim}>{g}</T>
            </Press>
          ))}
        </View>
      )}

      <FlatList
        data={hits}
        keyExtractor={(ex: any) => ex.key}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        renderItem={({ item: ex }: any) => (
          <View style={st.pickLine}>
            <Press onPress={() => onPick(ex.key)} style={st.pickRow} accessibilityRole="button">
              <ExerciseBody field={field} exercise={ex.key} name={ex.name} size={26} />
              <T size={font.body} style={{ flex: 1, minWidth: 0 }}>{ex.name}</T>
              {ex.group ? <T size={font.label} dim>{ex.group}</T> : null}
            </Press>
            <IconBtn icon="Info" label={`What is ${ex.name}?`} onPress={() => { tap(); ask(ex.key) }} />
          </View>
        )}
        ListEmptyComponent={q.trim() ? (
          <T size={font.label} dim style={{ padding: space[3] }}>
            Nothing matches that. Try the movement’s other name, or what it works (“lower abs”, “no equipment”).
          </T>
        ) : null}
      />
      {about ? (
        <ExerciseSheet field={field} exercise={about} visible={showing} onDismiss={gone}
          onClose={() => setShowing(false)}
          onAdd={() => { adding.current = about; setShowing(false) }} />
      ) : null}
    </View>
  )
}

/* --------------------------------------------------------------- one card */

const blankish = (v: any) => v === '' || v === null || v === undefined

/** How long an Undo stays offered: the session's own Remove toast's six seconds. */
export const UNDO_MS = 6000

/**
 * The same, without React, so it can be tested: `latest()` reads the value
 * now, `emit` writes one, `toast` is the toast store (the app's own by default).
 */
export function undoControl<V>(latest: () => V, emit: (next: V) => void,
  toast: { push: typeof pushToast; dismiss: typeof dismissToast } = { push: pushToast, dismiss: dismissToast }) {
  let pending: number | null = null
  const drop = () => {
    if (pending != null) toast.dismiss(pending)
    pending = null
  }
  return {
    drop,
    change: (next: V) => { drop(); emit(next) },
    remove: (next: V, words: string) => {
      drop()
      const before = latest()
      emit(next)
      pending = toast.push(words, 'info', {
        duration: UNDO_MS,
        action: { label: 'Undo', icon: null, onClick: () => { pending = null; emit(before) } },
      })
    },
  }
}

export function useUndoable<V>(value: V, emit: (next: V) => void) {
  const latest = useRef(value)
  latest.current = value
  // The parent's write as of the latest render, so an Undo seconds later writes through today's closure.
  const write = useRef(emit)
  write.current = emit
  const ctl = useRef<ReturnType<typeof undoControl<V>> | null>(null)
  if (!ctl.current) ctl.current = undoControl(() => latest.current, (v: V) => write.current(v))
  useEffect(() => ctl.current!.drop, [])
  return ctl.current
}

/**
 * "10 reps · 90 lb on the bar", "20 min": one set, read back, where it is
 * removed rather than typed. Each number in the words its box uses (`boxFor`):
 * a piece's time in minutes ("1:40 min"), a hold's in seconds.
 */
function setWords(item: any, s: any) {
  return setFieldsFor(item, s).map((f: string) => {
    const box: any = boxFor(f, item, s)
    if (blankish(s[f])) return `— ${box.label}`
    return `${box.time ? minutesText(s[f]) : s[f]} ${box.label}`
  }).join(' · ')
}

/**
 * What it is loaded with (#79): the implements the exercise declares, the one it
 * has now first, then "Other…" for the rest of the catalog (the web's
 * `ImplementChips`). A squat showed all nineteen.
 */
function ImplementChips({ liftField, item, entries, entryId, onPatch }: any) {
  const [everything, setEverything] = useState(false)
  const { shown, more }: any = (implementChoices as any)(liftField, item.exercise, item.implement)
  const list: any[] = everything ? (catalogOf(liftField) as any).implements : shown
  const sorted = [...list].sort((a, b) => Number(b.value === item.implement) - Number(a.value === item.implement))
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.impl}
      contentContainerStyle={{ gap: space[2], paddingRight: space[3] }} keyboardShouldPersistTaps="handled">
      {sorted.map((i) => {
        const on = item.implement === i.value
        return (
          <Press key={i.value} haptic style={[st.implchip, on && st.implchipOn]}
            accessibilityRole="button" accessibilityState={{ selected: on }}
            onPress={() => {
              const patch = implementPick(liftField, item, i, entries, entryId)
              if (patch) onPatch(patch)
            }}>
            <T size={font.label} color={on ? colors.ink : colors.inkDim}>{i.label}</T>
          </Press>
        )
      })}
      {more && !everything ? (
        <Press haptic style={[st.implchip, { borderStyle: 'dashed' }]} accessibilityRole="button" onPress={() => setEverything(true)}>
          <T size={font.label} color={colors.inkDim}>Other…</T>
        </Press>
      ) : null}
    </ScrollView>
  )
}

/** Does this card offer a choice of implement at all? One declared is no choice. */
const choosesImplement = (liftField: any, item: any) =>
  Boolean(liftField && item.exercise && (implementsFor as any)(liftField, item.exercise).length > 1)

/**
 * Doing mode's implement switch, as the system sheet (mobile/AGENTS.md: "…"
 * menus are action sheets): the declared implements, then Other… for the rest.
 */
function pickImplement(liftField: any, item: any, entries: any[], entryId: string | null, onPatch: (p: any) => void) {
  const { shown, more }: any = (implementChoices as any)(liftField, item.exercise, item.implement)
  const pick = (i: any) => { const patch = implementPick(liftField, item, i, entries, entryId); if (patch) onPatch(patch) }
  const all: any[] = (catalogOf(liftField) as any).implements
  const label = (i: any) => (i.value === item.implement ? `${i.label} ✓` : i.label)
  showMenu([
    ...shown.map((i: any) => ({ label: label(i), onPress: () => pick(i) })),
    ...(more ? [{ label: 'Other…', onPress: () => setTimeout(() => showMenu(all.map((i) => ({ label: label(i), onPress: () => pick(i) })), { title: item.name }), 350) }] : []),
  ], { title: `What ${item.name} is done with` })
}

/**
 * A set's ✓ in doing mode (#79): "I did this set as it says" (the web's
 * `SetTick`). The set's number until it is ticked, a check on the accent tint
 * after; it writes `typed` (prescription.js `tickSet`), which is the log (D11).
 * 44pt at the row's end; ticking buzzes as a set logged does.
 */
export function SetTick({ n, on, onToggle, locked = false, empty = false, onPrompt }: {
  n: number; on: boolean; onToggle: (v: boolean) => void; locked?: boolean; empty?: boolean; onPrompt?: () => void
}) {
  /* A done plan's earlier day (`asWritten`): its sets ARE the log as written, so
     the mark is read, not toggled; a number changed or a set removed corrects it. */
  if (locked) {
    return (
      <View accessible accessibilityRole="image" accessibilityLabel={on ? `Set ${n} done` : `Set ${n}, nothing logged`}
        style={[st.tick, on ? st.tickOn : { borderStyle: 'dashed' }]}>
        {on ? <Icon name="Check" size={20} color={colors.ink} /> : <T size={font.label} dim tabular>{String(n)}</T>}
      </View>
    )
  }
  /* A set with no number has nothing to log, so its ✓ cannot be ticked: the tap
     goes to the set's first box instead, which is what it is missing. */
  if (empty && !on) {
    return (
      <Press onPress={() => { tap(); onPrompt?.() }} accessibilityRole="checkbox"
        accessibilityState={{ checked: false, disabled: true }} accessibilityLabel={`Set ${n}: type what you did first`}
        style={[st.tick, { borderStyle: 'dashed' }]}>
        <T size={font.label} faint tabular>{String(n)}</T>
      </Press>
    )
  }
  return (
    <Press onPress={() => { if (!on) success(); else tap(); onToggle(!on) }}
      accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`Set ${n} done`}
      style={[st.tick, on && st.tickOn]}>
      {on ? <Icon name="Check" size={20} color={colors.ink} />
        : <T size={font.label} dim tabular>{String(n)}</T>}
    </Press>
  )
}

/**
 * Every set, editable, with thumbs in mind.
 *
 * Steppers rather than keyboards for reps and weight: the numbers move in
 * predictable increments and a numeric keyboard covers half the screen with the
 * thing you are editing underneath it. The value is still an input, so an odd
 * number is one tap and a type away.
 *
 * `doing` (#79, D9): the session sheet of a planned workout on its day or after,
 * where the lifting is done. The name, the implement as one small switch, last
 * time, and per set the two numbers and a ✓ (`onTick`); muscles in words and the
 * implement chips stay the planner's. `focus` opens the card as it becomes the
 * next one to do.
 */
export function ExerciseCard({
  item, liftField, entries = [], entryId = null, defaultOpen = false, defaultEditing = false, blank = null,
  onPatch, onPatchSet, onAddSet, onRemoveSet, onRemove, doing = false, onTick = null, focus = false,
  asWritten = false, onFill = null,
}: any) {
  const [open, setOpen] = useState(defaultOpen)
  const [about, setAbout] = useState(false)
  // Removing is its own mode (#77): never a ✕ beside a stepper.
  const [editing, setEditing] = useState(defaultEditing)
  // The next exercise to do opens as the last one is ticked off.
  useEffect(() => { if (focus) setOpen(true) }, [focus])
  /*
   * EDIT BELONGS TO THE EXERCISE, NOT THE PLACE (#93, A F1). Plan item ids are
   * positional, so after Remove the next exercise took this card's place and its
   * state, Edit included, with its Remove under the thumb. The section keys cards
   * by `uid` (`cardKey`); an item without one yet is caught here.
   */
  const ident = cardIdentity(item)
  const seen = useRef(ident)
  useEffect(() => {
    if (seen.current === ident) return
    seen.current = ident
    setEditing(false); setOpen(defaultOpen)
  }, [ident])
  // The card's writes as of the latest render, for an Undo that lands seconds later.
  const patchNow = useRef(onPatch)
  patchNow.current = onPatch
  const fillNow = useRef(onFill)
  fillNow.current = onFill
  const itemNow = useRef(item)
  itemNow.current = item
  // The set whose blank ✓ was tapped: its first box remounts focused (`asked` in its key).
  const [asked, setAsked] = useState<{ id: string; n: number } | null>(null)
  const chooses = choosesImplement(liftField, item)
  const muscles = musclesOf(liftField, item.exercise)
  /*
   * What the user did last time, while still DECIDING the numbers. Same
   * `lastLift` everywhere, so no two screens can disagree about last time.
   */
  const measure = item.kind === 'lift' ? measureOfItem(item) : null
  const prior = useMemo(
    () => (item.exercise ? (lastLift as any)(entries, item.exercise, entryId, liftField, measure) : null),
    [entries, item.exercise, entryId, liftField, measure])
  const flip = modeFlip(liftField, item, (p: any) => patchNow.current(p))
  const count = countSwitch(liftField, item, onPatch)
  const meaning: any = item.kind === 'lift' ? (weightMeaning as any)(liftField, item) : null
  // A mode other than the default, said under the name, so the summary beside it
  // stays short enough not to squeeze the name on a phone.
  const modeWords = item.kind === 'lift' ? weightModeWords(liftField, item) : null
  const ticking = Boolean(doing && onTick)
  const ticks = ticking ? item.sets.filter((s: any) => (setTicked as any)(s, asWritten)).length : 0
  const finished = ticking && (itemTicked as any)(item, asWritten)
  const line = ticking && ticks && !finished
    ? [`${ticks} of ${item.sets.length} done`, item.line].filter(Boolean).join(' · ')
    : item.line
  const fill: any[] = onFill && prior && !asWritten ? (lastTimeFill as any)(liftField, item, prior) : []
  const copyDown = onFill && !asWritten ? (s: any) => { impact(); copyDownWrite(item, s.id, (f) => fillNow.current?.(f), undefined, () => itemNow.current) } : null
  /* Doing mode moves on with the workout (#94, B F2, lib/prescription.js
     `doingMove`): finished, this card folds; next, it opens and the sheet scrolls to it. */
  const root = useRef<View>(null)
  const scrollTo = useSheetScroll()
  const was = useRef({ finished, focus })
  useEffect(() => {
    const move: any = (doingMove as any)(was.current, { finished, focus })
    was.current = { finished, focus }
    if (!ticking) return undefined
    if (move.fold) setOpen(false)
    if (!move.reveal || !scrollTo) return undefined
    const t = setTimeout(() => scrollTo(root.current), 120)
    return () => clearTimeout(t)
  }, [finished, focus, ticking, scrollTo])

  // A set whose every box now has a number is a set done: the success buzz.
  const patchSet = (s: any, patch: any) => {
    const fields: string[] = setFieldsFor(item, s)
    const next = { ...s, ...patch }
    if (fields.some((f) => blankish(s[f])) && fields.every((f) => !blankish(next[f]))) success()
    onPatchSet(s.id, patch)
  }

  const lastTime = prior ? <LastTime prior={prior} onUse={fill.length ? () => { impact(); onFill(fill) } : null} /> : null
  /* What the weight means and how a hold is counted: once, on the card, beside
     what it is done with. Never in a set's cell (#93). */
  const switches = (
    <>
      {flip ? (
        <ModeSwitch words={flip.words} onSwitch={flip.onSwitch}
          aria={`Weight is ${item.weightLabel || 'lb'}. Switch to ${flip.next}`} />
      ) : null}
      {!flip && meaning ? <ModeSwitch words={meaning.words} /> : null}
      {count ? <ModeSwitch words={count.box === 'sec' ? 'seconds' : 'reps'} aria={count.aria} onSwitch={count.onSwitch} /> : null}
    </>
  )
  const hasSwitches = Boolean(flip || meaning || count)

  const card = (
    <View ref={root} style={st.item}>
      {/*
        * The whole head folds the card, as it always has: cards start folded,
        * so this is the tap made most. A movement out of the catalog also has
        * what it is (issue #63), on its own 44pt ⓘ beside the head, as in the
        * picker.
        */}
      <View style={st.itemRow}>
        <Press onPress={() => { tap(); setOpen((v: boolean) => !v) }} style={[st.itemHead, { flex: 1 }]}
          accessibilityRole="button" accessibilityState={{ expanded: open }}>
          {/* What it works, on the row, wherever the name is. */}
          <ExerciseBody field={liftField} exercise={item.exercise} name={item.name} size={30} />
          <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
            <T size={font.body} weight={600} color={finished ? colors.inkDim : undefined}>{item.name}</T>
            {muscles && !doing ? <T size={font.caption} weight={500} dim style={{ marginTop: 2 }}>{muscleWords(muscles)}</T> : null}
            {modeWords && !doing ? <T size={font.label} dim style={{ marginTop: 2 }}>{modeWords}</T> : null}
            {/* The summary sits under the name, on one line, so the name has the
                width. How far it is leads (#93). */}
            {line ? <T size={font.label} faint tabular numberOfLines={1} style={{ marginTop: 2 }}>{line}</T> : null}
          </View>
          {finished ? (
            <View accessible accessibilityLabel="All sets done" style={{ marginTop: 1 }}>
              <Icon name="CircleCheck" size={16} color={colors.good} />
            </View>
          ) : null}
          <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={15} color={colors.inkFaint} style={{ marginTop: 1 }} />
        </Press>
        {item.exercise ? (
          <IconBtn icon="Info" label={`What is ${item.name}?`} style={st.about} onPress={() => { tap(); setAbout(true) }} />
        ) : null}
      </View>
      {about ? <ExerciseSheet field={liftField} exercise={item.exercise} name={item.name} onClose={() => setAbout(false)} /> : null}

      {open && (
        <>
          {item.note ? <T size={font.label} faint style={{ marginTop: space[1], marginBottom: space[2] }}>{item.note}</T> : null}

          {doing ? (
            /* One line under the head: what it is done with (the switch), what
               its weight means, and last time. */
            <View style={st.doingMeta}>
              {chooses ? (
                <Press onPress={() => pickImplement(liftField, item, entries, entryId, onPatch)} style={st.implSwitch}
                  accessibilityRole="button"
                  accessibilityLabel={`${implementLabel(liftField, item.implement) || 'No equipment picked'}. Change what ${item.name} is done with`}>
                  <T size={font.label} dim>{implementLabel(liftField, item.implement) || 'Equipment'}</T>
                  <Icon name="ChevronDown" size={13} color={colors.inkDim} />
                </Press>
              ) : null}
              {switches}
              {lastTime}
            </View>
          ) : null}

          {/*
            * What it is loaded with, on ONE line that scrolls. The chosen one
            * leads, so the answer is always visible without scrolling; the rest of
            * the catalog is behind "Other…" (#79). Doing: behind the switch above.
            */}
          {chooses && !doing ? (
            <ImplementChips liftField={liftField} item={item} entries={entries} entryId={entryId} onPatch={onPatch} />
          ) : null}
          {/* Planning: what the weight means and last time, right above the sets they fill. */}
          {!doing && (hasSwitches || lastTime) ? <View style={st.doingMeta}>{switches}{lastTime}</View> : null}

          {/*
            * THE SET ROW HAS NOTHING BUT NUMBERS (#77). A set is its number and
            * its steppers, and the steppers share the row's width (the number box
            * is the big target). A set comes off by a swipe on its row (iOS's own
            * gesture) or in Edit, and either way with Undo. In doing mode the
            * set's number is its ✓, in the same place at the row's START (#93):
            * at the end it sat beside the weight's +, the button pressed most,
            * and a miss logged a set.
            */}
          {editing ? (
            <View style={st.sets}>
              {item.sets.map((s: any, i: number) => (
                <View key={s.id} style={st.editRow}>
                  <T size={font.label} dim tabular align="center" style={{ width: 20 }}>{String(i + 1)}</T>
                  <T size={font.body} tabular numberOfLines={1} style={{ flex: 1 }}>{setWords(item, s)}</T>
                  <RemoveBtn label="Remove" a11y={`Remove set ${i + 1}`} onPress={() => onRemoveSet(s.id)} />
                </View>
              ))}
              {/* The whole exercise is a different size of removal, so it looks
                  like one (#93, A F11): under a rule, full width, named. */}
              <View style={st.editAll}>
                <RemoveBtn all label={`Remove ${item.name}`} a11y={`Remove ${item.name}`} onPress={onRemove} />
              </View>
            </View>
          ) : (
            <View style={st.sets}>
              {item.sets.map((s: any, i: number) => (
                <React.Fragment key={s.id}>
                <SwipeRemove label="Remove" onRemove={() => onRemoveSet(s.id)}>
                  <View style={[st.set, ticking && { gap: SET_ROW.tickGap }]}>
                    {ticking ? (
                      <SetTick n={i + 1} on={(setTicked as any)(s, asWritten)} locked={asWritten} onToggle={(v) => onTick(s.id, v)}
                        empty={!(setHasNumber as any)(s)} onPrompt={() => setAsked({ id: s.id, n: (asked?.n || 0) + 1 })} />
                    ) : <T size={font.label} dim tabular align="center" style={{ width: 20 }}>{String(i + 1)}</T>}
                    <View style={[st.setFields, ticking && { gap: SET_ROW.seam }]}>
                      {setFieldsFor(item, s).map((f: string, fi: number) => {
                        const box = boxFor(f, item, s)
                        return (
                          <Stepper key={asked && asked.id === s.id && fi === 0 ? `${f}-${asked.n}` : f} grow {...box}
                            unit={f === 'weight' ? (weightUnit as any)(box.label) : null} value={s[f]} blank={blank}
                            focus={asked?.id === s.id && fi === 0}
                            placeholder={s.hint?.[f] != null && s.hint[f] !== '' ? String(s.hint[f]) : '—'}
                            onChange={(v) => patchSet(s, { [f]: v })} />
                        )
                      })}
                      {/* Lifting has no programmed rest — see `normalizeSet`. An
                          interval piece keeps it: the rest at the wall IS the set. */}
                      {item.kind === 'interval' && (
                        <Stepper grow label="rest" value={s.restSec ?? 0} step={15} min={0} suffix=" sec" quiet
                          onChange={(v) => onPatchSet(s.id, { restSec: v })} />
                      )}
                    </View>
                  </View>
                </SwipeRemove>
                {/* Copy down (#93): its own line under the set it copies, at the
                    row's right edge, 16pt clear of the steppers above and below.
                    Numbers only, with Undo. */}
                {copyDown && (canCopyDown as any)(item.sets, i) ? (
                  <Btn kind="quiet" icon="ArrowDownToLine" title="Copy down" style={st.copyDown}
                    onPress={() => copyDown(s)} />
                ) : null}
                </React.Fragment>
              ))}
            </View>
          )}

          {/* Add on the left; Edit (where removing lives) on the far right, and in
              Edit nothing destructive takes Add's place: Done editing comes back
              where Edit was. */}
          <View style={st.itemFoot}>
            {editing ? (
              <Btn kind="quiet" icon="Check" title="Done editing" style={[st.footBtn, { marginLeft: 'auto' }]}
                onPress={() => { tap(); setEditing(false) }} />
            ) : (
              <>
                <Btn kind="quiet" icon="Plus" title="Add a set" style={st.footBtn} onPress={() => { impact(); onAddSet() }} />
                <Btn kind="quiet" icon="Pencil" title="Edit" style={[st.footBtn, { marginLeft: 'auto' }]}
                  onPress={() => { tap(); setEditing(true) }} />
              </>
            )}
          </View>
        </>
      )}
    </View>
  )

  // Folded, the whole card swipes away; open, its set rows do (one swipe target at a time).
  return open ? card : <SwipeRemove label="Remove" onRemove={onRemove}>{card}</SwipeRemove>
}

/**
 * Copy down, written (#93; the web's `copyDownWrite`): set `setId`'s numbers into
 * every empty set below it as ONE write through `fill`, then "Copied to 2 sets"
 * with Undo, which puts those sets back exactly (`unfills`). Numbers only.
 */
export function copyDownWrite(item: any, setId: string, fill: (fills: any[]) => void,
  toast: { push: typeof pushToast } = { push: pushToast }, latest: () => any = () => null) {
  const fills: any[] = (copyDownFills as any)(item.sets, setId)
  if (!fills.length) return null
  fill(fills)
  return toast.push(`Copied to ${fills.length} set${fills.length === 1 ? '' : 's'}`, 'info', {
    duration: UNDO_MS,
    action: {
      label: 'Undo', icon: null,
      onClick: () => {
        // Only the sets still as the copy left them: anything typed or ticked since stays.
        const now = latest()?.sets
        const back: any[] = (unfills as any)(item.sets, fills, now || undefined)
        if (back.length) fill(back)
      },
    },
  })
}

/**
 * Last time, in words (#93): "Last time · Fri, Nov 7: 3 × 10 @ 90 lb · EZ bar".
 * With blanks it can fill (`lastTimeFill`) it is a button that fills them in one
 * tap ("Use"), the numbers only, never ticked. With nothing to fill it is a line.
 */
function LastTime({ prior, onUse = null }: { prior: any; onUse?: (() => void) | null }) {
  const words = (
    <T size={font.label} faint tabular style={{ flex: 1 }}>
      {`Last time · ${(lastTimeWhen as any)(prior)}: `}
      <T size={font.label} weight={600} dim>{prior.summary}</T>
      {prior.implement ? ` · ${prior.implement}` : ''}
    </T>
  )
  if (!onUse) {
    return (
      <View style={st.prior}>
        <Icon name="RotateCw" size={12} color={colors.inkFaint} style={{ marginTop: 2 }} />
        {words}
      </View>
    )
  }
  return (
    <Press onPress={onUse} style={[st.prior, st.priorUse]} accessibilityRole="button"
      accessibilityLabel={`Use last time: ${prior.summary}`}>
      <Icon name="RotateCw" size={12} color={colors.inkFaint} />
      {words}
      <T size={font.label} weight={600}>Use</T>
    </Press>
  )
}

/** The card's key, re-exported where the cards are (`cardKey`, lib/lifts.js: the web's, the same file). */
export { cardKey }

/** Edit's "Remove": in the bad colour, because in Edit it is the point. 44pt, with Undo after. `all`: the whole exercise. */
function RemoveBtn({ onPress, label = 'Remove', a11y, all = false }: { onPress: () => void; label?: string; a11y?: string; all?: boolean }) {
  return (
    <Press onPress={() => { warn(); onPress() }} accessibilityRole="button" accessibilityLabel={a11y || label}
      style={[st.removeBtn, all && st.removeAll]}>
      <Icon name="Trash2" size={16} color={colors.bad} />
      <T size={font.label} weight={600} color={colors.bad}>{label}</T>
    </Press>
  )
}

/* ------------------------------------------------------------- reordering */

/**
 * One exercise, stripped to what you need to recognise it while moving it.
 *
 * A moved row glows: an arrow press moves a row under your own thumb, and without
 * a mark on it you have to re-read the list to find out whether anything
 * happened. The arrows go inert at the ends rather than disappearing.
 */
function ReorderRow({ item, liftField, first, last, moved, onSettled, onUp, onDown }: any) {
  const muscles = musclesOf(liftField, item.exercise)
  const glow = useRef(new Animated.Value(0)).current

  // Take the glow off once it has played, so the NEXT move can light it again.
  useEffect(() => {
    if (!moved) return undefined
    glow.setValue(1)
    Animated.timing(glow, { toValue: 0, duration: 900, useNativeDriver: false }).start()
    const t = setTimeout(onSettled, 900)
    return () => clearTimeout(t)
  }, [moved])

  const bg = glow.interpolate({ inputRange: [0, 0.5, 1], outputRange: [colors.panel2, mix(colors.accent, 12, colors.panel2), mix(colors.accent, 26, colors.panel2)] })
  const border = glow.interpolate({ inputRange: [0, 0.4, 1], outputRange: [colors.line, colors.accent, colors.accent] })

  return (
    <Animated.View style={[st.reorderRow, { backgroundColor: bg, borderColor: border }]}>
      <ExerciseBody field={liftField} exercise={item.exercise} name={item.name} size={28} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T size={font.body} weight={600}>{item.name}</T>
        {muscles ? <T size={font.caption} faint style={{ marginTop: 2, textTransform: 'lowercase' }}>{muscleWords(muscles)}</T> : null}
      </View>
      <Press haptic onPress={onUp} disabled={first} style={st.arrow} accessibilityLabel={`move ${item.name} up`}>
        <Icon name="ChevronUp" size={18} color={colors.inkDim} />
      </Press>
      <Press haptic onPress={onDown} disabled={last} style={st.arrow} accessibilityLabel={`move ${item.name} down`}>
        <Icon name="ChevronDown" size={18} color={colors.inkDim} />
      </Press>
    </Animated.View>
  )
}

/* ------------------------------------------------------------- the section */

/**
 * A foldable list of exercises with a way to add one and a way to reorder them.
 *
 * The whole screen on the log side and one block on the plan side. Every section
 * folds and only the first card opens: six cards open at once is four screens of
 * steppers before you reach the one you are about to do.
 *
 * `extra` sits between the header and the cards; `foot` under them (the interval
 * adder). Both hide while reordering. On the plan side a block's own settings
 * (#79) are its `menu`, a render function handed `{ reorder }` and drawn as the
 * ⋯ at the end of the head; Reorder then lives in it. `tag` is what the head
 * says of them; `lead` (a node, or a function handed the same) sits under the
 * head: the block's note. `doing`, `onTick`, `focusId` are the card's.
 * `onFill(itemId, [{ setId, patch }])` writes "use last time" as ONE write.
 */
export function ExerciseSection({
  title, count, items, liftField, entries = [], entryId = null,
  firstOpenId = null, blank = null, addLabel = 'Add an exercise here',
  open = true, onToggle = null,
  onPatch, onPatchSet, onAddSet, onRemoveSet, onRemove, onFill = null,
  onMove = null, onAdd = null, extra = null, foot = null, note = null,
  menu = null, tag = null, lead = null, doing = false, onTick = null, focusId = null, asWritten = false,
}: any) {
  const [adding, setAdding] = useState(false)
  const [ordering, setOrdering] = useState(false)
  // The row that just moved, so it can glow. Cleared by the row itself.
  const [moved, setMoved] = useState<any>(null)
  // The one just added opens, on top of the first: you added it to type its sets in.
  const [added, setAdded] = useState<any>(null)

  const move = (itemId: any, dir: string) => setMoved(onMove(itemId, dir))
  const canOrder = Boolean(onMove && items.length > 1)
  // What the block's menu and lead are handed: the way into reorder mode.
  const ctl = { reorder: canOrder ? () => { setOrdering(true); setMoved(null) } : null }

  const heading = <T size={font.body} weight={600} style={{ flexShrink: 1, minWidth: 0 }}>{title}</T>

  return (
    <View style={{ marginBottom: open ? 22 : 10 }}>
      <View style={st.blockHead}>
        {onToggle ? (
          <Press onPress={() => { tap(); onToggle() }} style={st.blockToggle}
            accessibilityRole="button" accessibilityState={{ expanded: open }}>
            <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={14} color={colors.inkFaint} />
            {heading}
          </Press>
        ) : <View style={st.blockToggle}>{heading}</View>}
        {/* The count and the reorder button travel TOGETHER, so a long title
            wraps the pair onto a second line instead of squeezing between them. */}
        <View style={st.blockMeta}>
          {tag ? <T size={font.label} dim>{tag}</T> : null}
          {count != null && <T size={font.label} dim tabular>{String(count)}</T>}
          {/* Reorder is per SECTION, because that is the only place an order
              means anything. Offered only where there is something to reorder;
              on the plan side from the block's menu, and its Done here. */}
          {canOrder && open && (ordering || !menu) && (
            <Press haptic onPress={() => { setOrdering((v) => !v); setMoved(null) }}
              accessibilityState={{ selected: ordering }} hitSlop={6}
              style={[st.reorderBtn, ordering && { borderColor: colors.accent }]}>
              <Icon name={ordering ? 'Check' : 'ArrowUpDown'} size={13} color={ordering ? colors.accent : colors.inkFaint} />
              <T size={font.label} color={ordering ? colors.accent : colors.inkFaint}>{ordering ? 'Done' : 'Reorder'}</T>
            </Press>
          )}
          {menu && !ordering ? menu(ctl) : null}
        </View>
      </View>

      {open && (
        <>
          {!ordering ? (typeof lead === 'function' ? lead(ctl) : lead) : null}
          {!ordering && extra}

          {ordering ? (
            <View style={{ gap: space[2] }}>
              {items.map((it: any, i: number) => (
                <ReorderRow key={it.id} item={it} liftField={liftField}
                  first={i === 0} last={i === items.length - 1}
                  moved={moved === it.id}
                  onSettled={() => setMoved(null)}
                  onUp={() => move(it.id, 'up')}
                  onDown={() => move(it.id, 'down')} />
              ))}
              <T size={font.label} dim style={{ marginTop: 2 }}>
                Order only — nothing else about these changes. Tap <T size={font.label} dim style={{ fontStyle: 'italic' }}>done</T> when it reads right.
              </T>
            </View>
          ) : (
            items.map((it: any) => (
              <ExerciseCard key={cardKey(it)} item={it} liftField={liftField}
                entries={entries} entryId={entryId} blank={blank}
                defaultOpen={it.id === firstOpenId || it.id === added}
                doing={doing} asWritten={asWritten} onTick={onTick ? (setId: any, v: boolean) => onTick(it.id, setId, v) : null}
                focus={Boolean(focusId) && it.id === focusId}
                onPatch={(patch: any) => onPatch(it.id, patch)}
                onPatchSet={(setId: any, patch: any) => onPatchSet(it.id, setId, patch)}
                onAddSet={() => onAddSet(it.id)}
                onRemoveSet={(setId: any) => onRemoveSet(it.id, setId)}
                onRemove={() => onRemove(it.id)}
                onFill={onFill ? (fills: any[]) => onFill(it.id, fills) : null} />
            ))
          )}

          {onAdd && liftField && !ordering && (
            <Press onPress={() => { tap(); setAdding(true) }} style={st.add} accessibilityRole="button">
              <Icon name="Plus" size={15} color={colors.inkDim} />
              <T size={font.label} dim>{addLabel}</T>
            </Press>
          )}
          {adding && (
            <Popover label="Add an exercise" onClose={() => setAdding(false)}>
              <ExercisePicker field={liftField} group={pickerGroupFor(liftField, items, title)}
                onPick={(key: string) => { impact(); setAdded(onAdd(key) || null); setAdding(false) }}
                onClose={() => setAdding(false)} />
            </Popover>
          )}

          {/* Below the catalog, because the catalog answers most of this question. */}
          {foot && !ordering && !adding && foot}

          {!items.length && note && <T size={font.label} dim style={{ marginTop: space[2] }}>{note}</T>}
        </>
      )}
    </View>
  )
}

const st = StyleSheet.create({
  stepper: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.control,
  },
  stepperQuiet: { backgroundColor: 'transparent', borderColor: colors.line },
  stepperBtn: { width: TAP, height: TAP, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center' },
  stepperGrow: { flexGrow: 1 },
  // The number is the cell (#93): the box fills the middle, the unit is drawn in it.
  stepperMid: { minWidth: SET_ROW.mid, height: TAP },
  stepperIn: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    padding: 0, paddingHorizontal: 0, paddingTop: 0, paddingBottom: space[4], textAlign: 'center', color: colors.ink,
    backgroundColor: 'transparent', borderWidth: 0, borderRadius: radius.control,
    fontSize: font.input, fontWeight: '600', fontVariant: ['tabular-nums'], minHeight: TAP, height: TAP,
  },
  unit: { position: 'absolute', left: 0, right: 0, bottom: space[1] },
  // The card's meaning switch (#93), the web's .modeswitch.
  modeSwitch: {
    flexDirection: 'row', alignItems: 'center', gap: space[1], minHeight: TAP, paddingHorizontal: space[3],
    marginVertical: -space[2], borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineStrong,
    backgroundColor: colors.panel3,
  },
  pickHead: { flexDirection: 'row', gap: space[2], padding: space[2], borderBottomWidth: 1, borderBottomColor: colors.line, alignItems: 'center' },
  pickGroups: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], padding: space[2], borderBottomWidth: 1, borderBottomColor: colors.line },
  // The picker row and its "what is this?" share one line and one divider.
  pickLine: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.line, paddingRight: space[1] },
  pickRow: {
    flex: 1, minWidth: 0,
    flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[3], paddingHorizontal: space[3], minHeight: TAP,
  },
  sheetHead: {
    flexDirection: 'row', alignItems: 'center', gap: space[3],
    paddingLeft: space[4], paddingRight: space[2], paddingVertical: space[3], borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  sheetBody: { padding: space[4], gap: space[4] },
  sheetFoot: { paddingHorizontal: space[4], paddingTop: space[3], borderTopWidth: 1, borderTopColor: colors.line },
  works: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  fact: { flexDirection: 'row', gap: space[3] },
  implchip: {
    flexDirection: 'row', alignItems: 'center', gap: space[2],
    paddingHorizontal: space[3], minHeight: TAP, borderRadius: radius.pill, justifyContent: 'center',
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line,
  },
  implchipOn: { borderColor: colors.accentLine, backgroundColor: colors.accentSoft },
  item: {
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.control, paddingVertical: space[2], paddingHorizontal: space[3], marginBottom: space[2],
  },
  itemHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2], minHeight: TAP },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space[1] },
  // The base 44pt icon button, pulled into the card's padding so the head keeps its height.
  about: { marginVertical: -space[1], marginRight: -space[2] },
  prior: { flexDirection: 'row', gap: space[2], alignItems: 'flex-start', marginTop: space[2], marginBottom: 2, width: '100%' },
  // Last time as a button (#93): it fills the blank sets.
  priorUse: {
    alignItems: 'center', minHeight: TAP, paddingHorizontal: space[3], paddingVertical: space[2],
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.lineStrong, borderRadius: radius.control,
  },
  impl: { marginVertical: space[2], marginRight: -space[3], flexGrow: 0 },
  sets: { gap: space[2], marginTop: space[2] },
  set: { flexDirection: 'row', alignItems: 'center', gap: space[2], backgroundColor: colors.panel2 },
  setFields: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: TAP },
  // With `sets`' gap of 8, 16 clear of the stepper rows on both sides (#93 review).
  copyDown: { alignSelf: 'flex-end', minHeight: TAP, paddingHorizontal: space[3], marginVertical: space[2] },
  editAll: { borderTopWidth: 1, borderTopColor: colors.line, marginTop: space[2], paddingTop: space[3] },
  removeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[1] + 2,
    minHeight: TAP, paddingHorizontal: space[3], borderRadius: radius.control,
    borderWidth: 1, borderColor: colors.line,
  },
  removeAll: { flex: 1, borderColor: mix(colors.bad, 55, colors.line) },
  // Add on the left, Remove on the far right: they do opposite things.
  itemFoot: { flexDirection: 'row', alignItems: 'center', gap: space[4], marginTop: space[2] },
  // Quiet buttons whose text lines up with the card's edge: the padding is the tap target.
  footBtn: { paddingHorizontal: space[2], marginHorizontal: -space[2] },
  blockHead: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap', marginBottom: space[1] },
  blockToggle: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: TAP },
  blockMeta: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginLeft: 'auto' },
  reorderBtn: {
    flexDirection: 'row', alignItems: 'center', gap: space[1], minHeight: TAP, paddingHorizontal: space[2],
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line,
  },
  reorderRow: {
    flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[2], paddingHorizontal: space[2],
    borderRadius: radius.control, borderWidth: 1,
  },
  arrow: {
    width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.control,
  },
  add: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2], minHeight: TAP,
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.lineStrong, borderRadius: radius.control,
  },
  // Doing mode (#79): a set's ✓ at the row's end, 44pt, the set's number until ticked.
  tick: {
    width: TAP, height: TAP, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.lineStrong,
  },
  tickOn: { backgroundColor: colors.accentSoft, borderColor: colors.accentLine },
  doingMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', rowGap: space[3], columnGap: space[2], marginTop: space[3] },
  implSwitch: {
    flexDirection: 'row', alignItems: 'center', gap: space[1], minHeight: TAP, paddingHorizontal: space[3],
    marginVertical: -space[2], borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line,
  },
})
