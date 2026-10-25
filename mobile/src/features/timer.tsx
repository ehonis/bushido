/*
 * The interval timer — app/src/timer.jsx, native.
 *
 * Two screens, the way the good timer apps are built: SETUP, where the answer
 * to "what am I running" is already filled in and Start is the biggest thing
 * on it, and RUN, which is one number you can read from across a room.
 * Customising is steppers, never typing a number.
 *
 * It is a clock, not a log: the climbing cards' set log stays workout mode's,
 * and their declared timers are offered here as presets (lib/timer.js
 * `sessionTimer`). Presets and the last timer run are the person's own
 * entries in their own log, so the one-tap default follows them between
 * devices. The run is absolute instants kept in localStorage (expo-sqlite's,
 * see boot.ts), so a locked phone or a cold start comes back to the second.
 *
 * Native: a full-screen modal; the cues are lib/cues.ts haptics (no sound —
 * nothing installed can beep without a native change, D5); the screen is kept
 * awake with expo-keep-awake through the same cues module; stopping asks on
 * the screen, the visual system's confirm. iOS presents one modal at a time, so the session sheet and
 * the + menu close first and the timer opens once they have gone
 * (`openTimerAfterSheet`).
 */
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Modal as RNModal, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, font, mix, radius, space } from '../theme'
import { T } from '../ui/Text'
import { Btn, Chip, IconBtn, Input, Press, SectionHeader, Sub, Toggle } from '../ui/kit'
import { impact, tap, warn } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { onForeground } from '../lib/foreground'
import { CUES, acquireWakeLock, releaseWakeLock } from '../lib/cues'
import { clock } from '../lib/workout.js'
import { currentMe } from '../lib/whoami.js'
import * as timer from '../lib/timer.js'

const {
  compile, normalizeConfig, sameConfig, totalSeconds, describe, secondsLabel, stepSeconds,
  startRun, settle, togglePause, skip, back, bump, view, cueFor, moved,
  presetList, lastTimer, buildTimerEntry, buildLastTimerEntry, newTimerId, sessionTimer,
  runKeyFor, saveRun, loadRun, LIMITS, MAX_NAMED, KIND_LABEL,
} = timer as any

/** Each kind of segment's colour, the web's `.it.k-*`. */
const KIND_COLOR: Record<string, string> = {
  countin: colors.vizWarn,
  work: colors.accent,
  rest: colors.load3,
  setrest: colors.load3,
  cooldown: colors.series3,
  finished: colors.vizGood,
}

/* ----------------------------------------------------------- who opens it */

type Req = { title: string | null; presets: any[]; seq: number }
let request: Req | null = null
let seq = 0
const listeners = new Set<() => void>()
const notify = () => { for (const fn of listeners) fn() }
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
const getRequest = () => request

/** Open the timer. `title` is the workout it was opened from; `presets` that workout's own timers. */
export function openTimer({ title = null, presets = [] }: { title?: string | null; presets?: any[] } = {}) {
  request = { title, presets: presets.filter(Boolean), seq: ++seq }
  notify()
}
export function closeTimer() { request = null; notify() }

/** From inside another modal: give it time to go before presenting this one. */
export function openTimerAfterSheet(req?: { title?: string | null; presets?: any[] }) {
  setTimeout(() => openTimer(req), 450)
}

/** What the session sheet asks for: the workout's name, and its plan's timer if it declares one. */
export function timerRequestFor(opt: any, entry: any = null) {
  return {
    title: entry?.data?.name || opt?.name || null,
    presets: [sessionTimer(opt, entry?.data?.out || {})],
  }
}

const storage = () => (globalThis as any).localStorage || null

/** Mounted once, beside the + menu's overlays. */
export function TimerHost({ entries, upsertEntry, deleteEntry }: { entries: any[]; upsertEntry: (e: any) => void; deleteEntry: (id: string) => void }) {
  const req = useSyncExternalStore(subscribe, getRequest, getRequest)
  const key = runKeyFor(currentMe().id)
  const [resumed, setResumed] = useState<any>(() => loadRun(storage(), key, Date.now()))
  if (!req && !resumed) return null
  const close = () => {
    saveRun(storage(), key, null)
    setResumed(null)
    closeTimer()
  }
  return (
    <IntervalTimer key={resumed ? 'resumed' : req!.seq}
      title={resumed ? resumed.title : req!.title}
      sessionPresets={resumed ? [] : req!.presets}
      resumed={resumed} entries={entries} upsertEntry={upsertEntry} deleteEntry={deleteEntry}
      persist={(doc: any) => saveRun(storage(), key, doc)} onClose={close} />
  )
}

function IntervalTimer({ title, sessionPresets = [], resumed = null, entries = [], upsertEntry, deleteEntry, persist, onClose }: {
  title: string | null
  sessionPresets?: any[]
  resumed?: any
  entries?: any[]
  upsertEntry?: (e: any) => void
  deleteEntry?: (id: string) => void
  persist: (doc: any) => void
  onClose: () => void
}) {
  const insets = useSafeAreaInsets()
  const [live, setLive] = useState<any>(resumed)
  const [confirming, setConfirming] = useState(false)

  const start = (name: string, config: any) => {
    impact()
    const clean = normalizeConfig(config)
    const last = lastTimer(entries)
    if (upsertEntry && (!last || !sameConfig(last.config, clean) || last.name !== name)) {
      upsertEntry(buildLastTimerEntry(name, clean))
    }
    const run = startRun(compile(clean), Date.now())
    const next = { name, title, config: clean, run }
    persist(next)
    setLive(next)
  }

  const askClose = () => {
    if (!live) { onClose(); return }
    warn()
    setConfirming(true)
  }

  return (
    <RNModal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={askClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={[st.it, { paddingTop: insets.top }]}>
          {live ? (
            <TimerRun title={title} name={live.name} config={live.config} initialRun={live.run}
              onRun={(run: any) => persist(run.finishedAt != null ? null : { ...live, title, run })}
              onAgain={() => start(live.name, live.config)} onStop={askClose} onClose={onClose}
              confirming={confirming} onKeep={() => setConfirming(false)} />
          ) : (
            <TimerSetup title={title} presets={presetList(entries, sessionPresets)}
              onStart={start} onClose={onClose}
              onSave={upsertEntry ? (id: string, name: string, config: any) => upsertEntry(buildTimerEntry(id, name, config)) : null}
              onDelete={deleteEntry || null} />
          )}
        </View>
      </GestureHandlerRootView>
    </RNModal>
  )
}

/* ------------------------------------------------------------------ setup */

function TimerSetup({ title, presets, onStart, onSave, onDelete, onClose }: {
  title: string | null
  presets: any[]
  onStart: (name: string, config: any) => void
  onSave: ((id: string, name: string, config: any) => void) | null
  onDelete: ((id: string) => void) | null
  onClose: () => void
}) {
  const insets = useSafeAreaInsets()
  const [pick, setPick] = useState<string | null>(presets[0]?.id || null)
  const chosen = presets.find(p => p.id === pick) || null
  const [config, setConfig] = useState<any>(() => normalizeConfig(presets[0]?.config))
  const [more, setMore] = useState(false)
  const [naming, setNaming] = useState<string | null>(null)

  const edited = Boolean(chosen && !sameConfig(chosen.config, config))
  const program = useMemo(() => compile(config), [config])
  const total = totalSeconds(program)
  const set = (k: string, v: any) => setConfig((c: any) => normalizeConfig({ ...c, [k]: v }))
  const choose = (p: any) => { tap(); setPick(p.id); setConfig(normalizeConfig(p.config)); setNaming(null) }
  const name = chosen && !edited ? chosen.name : (chosen?.saved ? chosen.name : 'Custom')
  const named = config.intervals.length > 0
  const planSequence = config.intervals.length > MAX_NAMED

  const saveAs = () => {
    const label = (naming || '').trim()
    if (!label || !onSave) return
    const id = newTimerId()
    onSave(id, label, config)
    setNaming(null)
    setPick(id)
  }

  const secs = (key: string, lo = (LIMITS as any)[key][0]) => ({
    onDown: config[key] > lo ? () => set(key, stepSeconds(config[key], -1)) : null,
    onUp: config[key] < (LIMITS as any)[key][1] ? () => set(key, stepSeconds(config[key], 1)) : null,
  })
  const count = (key: string) => ({
    onDown: config[key] > 1 ? () => set(key, config[key] - 1) : null,
    onUp: config[key] < (LIMITS as any)[key][1] ? () => set(key, config[key] + 1) : null,
  })
  const orNone = (s: number) => (s ? secondsLabel(s) : 'None')

  return (
    <>
      <View style={st.head}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T size={font.title} weight={600} numberOfLines={1}>Interval timer</T>
          {title ? <Sub>{title}</Sub> : null}
        </View>
        <IconBtn icon="X" size={20} label="Close the timer" onPress={onClose} />
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={[st.body, { paddingBottom: space[5] + insets.bottom }]}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -space.gutter, flexGrow: 0 }}
          contentContainerStyle={{ gap: space[2], paddingHorizontal: space.gutter }}>
          {presets.map(p => (
            <Chip key={p.id} on={p.id === pick} onPress={() => choose(p)}
              icon={p.fromPlan ? 'ClipboardCheck' : undefined}
              label={p.id === 'timer-last' ? `Last used · ${p.name}` : p.name} />
          ))}
        </ScrollView>

        <View style={{ alignItems: 'center', paddingTop: space[2], gap: space[1] }}>
          <T size={font.display} weight={600} tabular>{total != null ? clock(total) : config.repeat ? 'Until you stop' : 'Open-ended'}</T>
          <T size={font.small} dim align="center">{name}{edited && chosen?.saved ? ' (changed)' : ''} · {describe(config)}</T>
        </View>

        <Btn icon="Play" title="Start" onPress={() => onStart(name, config)} style={st.start} />

        <View style={st.rows}>
          {!named ? (
            <>
              <Stepper label="Work" value={secondsLabel(config.work)} {...secs('work')} />
              <Stepper label="Rest" value={orNone(config.rest)} {...secs('rest')} first={false} />
            </>
          ) : null}
          <Stepper label="Rounds" value={String(config.rounds)} {...count('rounds')} first={named} />
        </View>

        <Btn kind="quiet" icon={more ? 'ChevronUp' : 'ChevronDown'} style={st.quiet} onPress={() => setMore(!more)}
          title={more ? 'Fewer options' : 'More options'} />

        {more ? (
          <View style={st.rows}>
            <Stepper label="Get ready" value={orNone(config.countIn)} {...secs('countIn')} />
            <Stepper label="Sets" value={String(config.sets)} {...count('sets')} first={false} />
            {config.sets > 1 ? (
              <Stepper label="Rest between sets" value={orNone(config.setRest)} {...secs('setRest')} first={false} />
            ) : null}
            {!config.repeat ? (
              <Stepper label="Cool-down" value={orNone(config.coolDown)} {...secs('coolDown')} first={false} />
            ) : null}
            <View style={[st.row, st.rowLine]}>
              <T size={font.body} dim>Repeat until I stop</T>
              <Toggle value={config.repeat} onChange={(v) => set('repeat', v)} />
            </View>
            <View style={st.rowLine}>
              <Intervals config={config} planSequence={planSequence} onChange={(list: any[]) => set('intervals', list)} />
            </View>
          </View>
        ) : null}

        {onSave || onDelete ? (
          <View>
            {naming != null ? (
              <View style={{ flexDirection: 'row', gap: space[2], alignItems: 'center' }}>
                <Input value={naming} placeholder="Name this preset" maxLength={40} autoFocus
                  onChangeText={setNaming} onSubmitEditing={saveAs} returnKeyType="done" style={{ flex: 1 }} />
                <Btn title="Save" kind="secondary" disabled={!naming.trim()} onPress={saveAs} />
                <Btn title="Cancel" kind="ghost" onPress={() => setNaming(null)} />
              </View>
            ) : (
              <>
                {chosen?.saved && edited && onSave ? (
                  <Link icon="Check" label={`Save changes to ${chosen.name}`} onPress={() => onSave(chosen.id, chosen.name, config)} />
                ) : null}
                {onSave && (!chosen?.saved || edited) ? (
                  <Link icon="Plus" label="Save as a preset" onPress={() => setNaming('')} />
                ) : null}
                {chosen?.saved && onDelete ? (
                  <Link icon="Trash2" label={`Delete ${chosen.name}`} onPress={() => {
                    onDelete(chosen.id)
                    setPick(presets.find(p => p.id !== chosen.id)?.id || null)
                  }} />
                ) : null}
              </>
            )}
          </View>
        ) : null}
      </ScrollView>
    </>
  )
}

/** A minor action: the kit's quiet button. */
function Link({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return <Btn kind="quiet" icon={icon} title={label} onPress={onPress} style={st.quiet} />
}

/** The ± beside a number: the kit's bordered icon button (the web's .qbtn). */
function StepBtn({ icon, onPress, label, size = 18 }: { icon: string; onPress: (() => void) | null; label: string; size?: number }) {
  return <IconBtn bordered icon={icon} size={size} color={colors.ink} label={label} disabled={!onPress} onPress={onPress || undefined} />
}

/** One setting: label, − value +. A null handler is a disabled end of the range. */
function Stepper({ label, value, onDown, onUp, first = true }: {
  label: string; value: string; onDown: (() => void) | null; onUp: (() => void) | null; first?: boolean
}) {
  return (
    <View style={[st.row, !first && st.rowLine]}>
      <T size={font.body} dim style={{ flexShrink: 1 }}>{label}</T>
      <View style={st.step}>
        <StepBtn icon="Minus" onPress={onDown} label={`Less ${label.toLowerCase()}`} />
        <T size={font.title} weight={600} tabular style={st.value}>{value}</T>
        <StepBtn icon="Plus" onPress={onUp} label={`More ${label.toLowerCase()}`} />
      </View>
    </View>
  )
}

/** Named intervals: the web's, with a plan's long sequence shown as what it is. */
function Intervals({ config, planSequence, onChange }: { config: any; planSequence: boolean; onChange: (list: any[]) => void }) {
  const list: any[] = config.intervals
  if (planSequence) {
    const names = [...new Set(list.filter(i => i.kind === 'work').map(i => i.name).filter(Boolean))]
    return (
      <View style={st.intervals}>
        <SectionHeader title={`From the plan: ${list.length} intervals`} />
        <Sub>{names.join(', ')}. Rests the plan does not state count up until you tap.</Sub>
        <Link icon="X" label="Use plain work and rest instead" onPress={() => onChange([])} />
      </View>
    )
  }
  if (!list.length) {
    return (
      <View style={{ paddingHorizontal: space[3] }}>
        <Link icon="ListPlus" label="Name the intervals in a round" onPress={() => onChange([
          { kind: 'work', seconds: config.work, name: 'Work' },
          ...(config.rest ? [{ kind: 'rest', seconds: config.rest }] : []),
        ])} />
      </View>
    )
  }
  const put = (n: number, patch: any) => onChange(list.map((x, i) => (i === n ? { ...x, ...patch } : x)))
  return (
    <View style={st.intervals}>
      <SectionHeader title="Each round" />
      {list.map((iv, n) => {
        const tint = iv.kind === 'work' ? colors.accent : colors.load3
        return (
          <View key={n} style={[st.iv, { borderLeftColor: tint }]}>
            <Input value={iv.name || ''} maxLength={40} placeholder={KIND_LABEL[iv.kind]}
              accessibilityLabel={`Interval ${n + 1} name`} onChangeText={(v) => put(n, { name: v })}
              style={{ flex: 1, minWidth: 0 }} />
            <Chip out on={iv.kind === 'work'} label={iv.kind === 'work' ? 'Work' : 'Rest'}
              onPress={() => put(n, { kind: iv.kind === 'work' ? 'rest' : 'work' })} />
            <StepBtn icon="Minus" size={16} label="Shorter"
              onPress={iv.seconds != null && iv.seconds <= 5 ? null : () => put(n, { seconds: iv.seconds == null ? 30 : Math.max(5, stepSeconds(iv.seconds, -1)) })} />
            <T size={font.body} weight={600} tabular style={{ minWidth: 44, textAlign: 'center' }}>{secondsLabel(iv.seconds)}</T>
            <StepBtn icon="Plus" size={16} label="Longer"
              onPress={() => put(n, { seconds: iv.seconds == null ? 30 : Math.min(LIMITS.interval[1], stepSeconds(iv.seconds, 1)) })} />
            <StepBtn icon="Trash2" size={15} label={`Remove interval ${n + 1}`}
              onPress={() => onChange(list.filter((_, i) => i !== n))} />
          </View>
        )
      })}
      {list.length < MAX_NAMED ? (
        <Link icon="Plus" label="Add an interval" onPress={() => onChange([...list, { kind: 'work', seconds: 30, name: '' }])} />
      ) : null}
    </View>
  )
}

/* -------------------------------------------------------------------- run */

const counters = (seg: any, lap: number, repeat: boolean) => [
  seg.rounds > 1 ? `Round ${seg.round} of ${seg.rounds}` : null,
  seg.sets > 1 ? `Set ${seg.set} of ${seg.sets}` : null,
  repeat ? `Lap ${lap}` : null,
].filter(Boolean).join(' · ')

function TimerRun({ title, name, config, initialRun, onRun, onAgain, onStop, onClose, confirming, onKeep }: {
  title: string | null
  name: string
  config: any
  initialRun: any
  onRun: (run: any) => void
  onAgain: () => void
  onStop: () => void
  onClose: () => void
  confirming: boolean
  onKeep: () => void
}) {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const program = useMemo(() => compile(config), [config])
  const [run, setRun] = useState<any>(() => settle(program, initialRun, Date.now()))
  const runRef = useRef(run)
  const [now, setNow] = useState(() => Date.now())
  const [muted, setMuted] = useState(false)
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  const onRunRef = useRef(onRun)
  onRunRef.current = onRun

  const cue = (cueName: string | null) => { if (cueName && !mutedRef.current) CUES[cueName]?.() }

  const commit = useCallback((next: any, t: number) => {
    const was = runRef.current
    if (next !== was) {
      runRef.current = next
      setRun(next)
      onRunRef.current(next)
      if (moved(was, next)) cue(cueFor(program, next))
    }
    setNow(t)
  }, [program])

  const tick = useCallback(() => {
    const t = Date.now()
    commit(settle(program, runRef.current, t), t)
  }, [program, commit])

  const act = (fn: any, ...args: any[]) => {
    const t = Date.now()
    commit(fn(program, runRef.current, t, ...args), t)
  }

  const v = view(program, run, now)
  const active = !v.finished
  const ticking = active && !v.paused

  // Repaint only: transitions are arithmetic in settle(), so a suspended app can
  // only make the screen late, never the timer wrong.
  useEffect(() => {
    if (!ticking) return
    const iv = setInterval(tick, 200)
    return () => clearInterval(iv)
  }, [ticking, tick])

  // An exact wake-up at the end of the segment, so the buzz lands on the second.
  useEffect(() => {
    if (!ticking || v.left == null) return
    const t = setTimeout(tick, Math.max(0, v.left * 1000) + 5)
    return () => clearTimeout(t)
  }, [ticking, run, tick]) // eslint-disable-line react-hooks/exhaustive-deps

  const ticked = useRef('')
  const whole = v.left == null ? null : Math.ceil(v.left)
  useEffect(() => {
    if (!ticking || whole == null || whole <= 0 || whole > 3) return
    const key = `${run.index}:${run.lap}:${run.at}:${whole}`
    if (ticked.current === key) return
    ticked.current = key
    cue('tick')
  }, [whole, ticking, run]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!active) return
    let dead = false
    let lock: string | null = null
    acquireWakeLock().then(l => { if (dead) releaseWakeLock(l); else lock = l })
    const off = onForeground(() => tick())
    return () => { dead = true; off(); releaseWakeLock(lock) }
  }, [active, tick])

  const seg = v.segment
  const kind = v.finished ? 'finished' : seg.kind
  const k = KIND_COLOR[kind] || colors.inkDim
  const open = !v.finished && v.left == null
  const big = Math.min(220, Math.max(96, width * 0.34))

  return (
    <View style={{ flex: 1, backgroundColor: mix(k, 13, colors.bg) }}>
      <View style={st.head}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T size={font.title} weight={600} numberOfLines={1}>{name}{title ? ` · ${title}` : ''}</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
            <Icon name="Timer" size={12} color={colors.inkDim} />
            <T size={font.small} dim tabular>{clock(v.elapsed)}</T>
          </View>
        </View>
        <IconBtn icon={muted ? 'VolumeX' : 'Volume2'} size={20} onPress={() => setMuted(!muted)}
          label={muted ? 'Turn cues on' : 'Turn cues off'} />
        <IconBtn icon="X" size={20} label="Stop the timer" onPress={active ? onStop : onClose} />
      </View>

      {confirming && active ? (
        // The visual system's confirm: a screen, not a system dialog. The clock keeps running behind it.
        <View style={[st.body, st.finish, { paddingBottom: space[5] + insets.bottom }]}>
          <Icon name="TriangleAlert" size={28} color={colors.vizCrit} />
          <T size={font.title} weight={600}>Stop the timer?</T>
          <Sub style={{ textAlign: 'center' }}>This run ends here. Your presets are kept.</Sub>
          <View style={{ flexDirection: 'row', gap: space[2], alignSelf: 'stretch', marginTop: space[4] }}>
            <Btn title="Keep it" kind="ghost" flex onPress={onKeep} />
            <Btn title="Stop" kind="bad" flex onPress={onClose} />
          </View>
        </View>
      ) : v.finished ? (
        <View style={[st.body, st.finish, { paddingBottom: space[5] + insets.bottom }]}>
          <Icon name="CircleCheck" size={56} color={k} />
          <T size={font.heading} weight={600} color={k}>Done</T>
          <T size={Math.min(120, big * 0.6)} weight={600} tabular color={k}>{clock(v.elapsed)}</T>
          <Btn icon="RotateCw" title="Again" onPress={onAgain} style={[st.start, { alignSelf: 'stretch' }]} />
          <Btn title="Close" kind="ghost" onPress={onClose} style={{ alignSelf: 'stretch' }} />
        </View>
      ) : (
        <View style={[st.body, { flex: 1, justifyContent: 'space-between', paddingBottom: space[5] + insets.bottom }]}>
          {/* Tap anywhere on the clock: pause or resume. A count-up has no end of its
              own, so there the tap IS the end, and pausing is the button below. */}
          <Press onPress={() => { impact(); act(open ? skip : togglePause) }} accessibilityRole="button"
            accessibilityLabel={open ? 'Done, next' : v.paused ? 'Resume' : 'Pause'} style={st.face}>
            <T size={Math.min(36, Math.max(font.heading, width * 0.08))} weight={600} color={k} numberOfLines={1}>{seg.name}</T>
            <T size={big} weight={600} tabular color={k}
              style={{ lineHeight: big * 1.02, letterSpacing: -big * 0.03, opacity: v.paused ? 0.4 : 1 }}>
              {clock(open ? v.counted : Math.ceil(v.left))}
            </T>
            {counters(seg, v.lap, config.repeat) ? <T size={font.title} weight={600} tabular>{counters(seg, v.lap, config.repeat)}</T> : null}
            {seg.note ? <Sub style={{ textAlign: 'center' }}>{seg.note}</Sub> : null}
            {v.progress != null ? (
              <View style={[st.bar, { backgroundColor: mix(k, 20, colors.bg) }]}>
                <View style={{ width: `${v.progress * 100}%`, height: '100%', backgroundColor: k }} />
              </View>
            ) : null}
            <T size={font.small} dim>{v.paused ? 'Paused · tap to carry on' : open ? 'No set time · tap when done' : 'Tap to pause'}</T>
          </Press>

          <View style={st.next}>
            <T size={font.body} dim align="center" numberOfLines={1}>
              {v.next ? <>Next: <T size={font.body} weight={600}>{v.next.name}</T> {v.next.seconds != null ? secondsLabel(v.next.seconds) : ''}</> : 'Last one'}
            </T>
          </View>

          <View style={st.ctl}>
            <CtlBtn icon="SkipBack" label="Back" onPress={() => { tap(); act(back) }} />
            <CtlBtn icon="Minus" label="10s" a11y="10 seconds less" disabled={open} onPress={() => { tap(); act(bump, -10) }} />
            <CtlBtn icon={v.paused ? 'Play' : 'Pause'} label={v.paused ? 'Resume' : 'Pause'} primary onPress={() => { impact(); act(togglePause) }} />
            <CtlBtn icon="Plus" label="10s" a11y="10 seconds more" disabled={open} onPress={() => { tap(); act(bump, 10) }} />
            <CtlBtn icon="SkipForward" label="Skip" onPress={() => { tap(); act(skip) }} />
          </View>
        </View>
      )}
    </View>
  )
}

function CtlBtn({ icon, label, a11y, onPress, primary, disabled }: {
  icon: string; label: string; a11y?: string; onPress: () => void; primary?: boolean; disabled?: boolean
}) {
  return (
    <Press onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={a11y || label}
      style={[st.ctlBtn, primary && st.ctlPrimary]}>
      <Icon name={icon} size={primary ? 20 : 18} color={primary ? colors.ink : colors.inkDim} />
      <T size={font.caption} weight={primary ? 600 : 400} color={primary ? colors.ink : colors.inkDim}>{label}</T>
    </Press>
  )
}

// The web's timer.css, on the same tokens.
const st = StyleSheet.create({
  it: { flex: 1, backgroundColor: colors.bg },
  head: {
    flexDirection: 'row', alignItems: 'center', gap: space[1],
    paddingLeft: space.gutter, paddingRight: space[2], paddingVertical: space[2],
    borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  body: { paddingHorizontal: space.gutter, paddingTop: space[4], gap: space[3] },
  // The screen's one primary, made big: it is the whole of the one-tap default.
  start: { minHeight: 56 },
  quiet: { alignSelf: 'flex-start', paddingHorizontal: space[1] },
  rows: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.card },
  row: {
    minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3],
    paddingLeft: space[4], paddingRight: space[2], paddingVertical: space[1],
  },
  rowLine: { borderTopWidth: 1, borderTopColor: colors.line },
  step: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  value: { minWidth: 64, textAlign: 'center' },
  intervals: { gap: space[2], paddingTop: space[4], paddingBottom: space[2], paddingLeft: space[4], paddingRight: space[2] },
  iv: { flexDirection: 'row', alignItems: 'center', gap: space[1], borderLeftWidth: 3, paddingLeft: space[2] },
  face: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[3] },
  bar: { width: '80%', maxWidth: 320, height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  next: { padding: space[3], borderRadius: radius.card, backgroundColor: mix(colors.panel, 70, colors.bg) },
  ctl: { flexDirection: 'row', gap: space[2], justifyContent: 'center' },
  ctlBtn: {
    flex: 1, maxWidth: 92, minHeight: 60, gap: 2, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.card,
  },
  // Pause is the control you reach for: the secondary button's raised surface, not the accent.
  ctlPrimary: { maxWidth: 110, backgroundColor: colors.panel3 },
  finish: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[3] },
})
