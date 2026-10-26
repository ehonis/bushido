/*
 * Building a circuit (issue #68) — app/src/circuit.jsx, native.
 *
 * ONE editor for both doors to a circuit: a plan's block switched to Circuit
 * (planner.tsx) and an interval-timer preset with exercises (timer.tsx). Pick
 * exercises, one row of steppers (work, rest, rounds), done. How long each
 * exercise lasts is set once for the circuit; one that is different says so
 * behind a tap on its row, and nowhere else.
 */
import React, { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors, font, radius, space, TAP } from '../theme'
import { T } from '../ui/Text'
import { Btn, IconBtn, Press, Segmented } from '../ui/kit'
import { Popover } from '../ui/Sheet'
import { tap, impact } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { ExerciseBody, musclesOf, muscleWords } from '../lib/bodymap'
import { ExercisePicker, ExerciseSheet } from './exercises'
import * as timer from '../lib/timer.js'

const { secondsLabel, stepSeconds, LIMITS } = timer as any

export type Timing = { by: 'circuit' | 'time' | 'reps'; seconds?: number | null; reps?: number | null }

/** "40s", "1:00", "15 reps": what one exercise runs for, the circuit's own time when it says nothing. */
export const timingWords = (t: Timing, work: number) =>
  (t.by === 'reps' ? `${t.reps} reps` : secondsLabel(t.by === 'time' ? t.seconds : work))

/** The ± beside a number: the kit's bordered icon button (the web's .qbtn). */
function StepBtn({ icon, onPress, label, size = 16 }: { icon: string; onPress: (() => void) | null; label: string; size?: number }) {
  return <IconBtn bordered icon={icon} size={size} color={colors.ink} label={label} disabled={!onPress} onPress={onPress || undefined} />
}

/** The three numbers a circuit is, in one row: each its label, its value, and − + under it at full tap size. */
export function CircuitSteppers({ circuit, onChange }: { circuit: any; onChange: (c: any) => void }) {
  const set = (k: string, v: number) => { tap(); onChange({ ...circuit, [k]: v }) }
  const cells = [
    { k: 'work', label: 'Work', value: secondsLabel(circuit.work), min: LIMITS.work[0], max: LIMITS.work[1], seconds: true },
    { k: 'rest', label: 'Rest', value: circuit.rest ? secondsLabel(circuit.rest) : 'None', min: 0, max: LIMITS.rest[1], seconds: true },
    { k: 'rounds', label: 'Rounds', value: String(circuit.rounds), min: 1, max: LIMITS.rounds[1], seconds: false },
  ]
  return (
    <View style={st.steps} accessibilityLabel="Circuit timing">
      {cells.map(c => {
        const v = circuit[c.k]
        const down = c.seconds ? Math.max(c.min, stepSeconds(v, -1)) : v - 1
        const up = c.seconds ? Math.min(c.max, stepSeconds(v, 1)) : v + 1
        return (
          <View key={c.k} style={st.cell}>
            <T size={font.small} dim>{c.label}</T>
            <T size={font.title} weight={600} tabular>{c.value}</T>
            <View style={st.cellStep}>
              <StepBtn icon="Minus" label={`Less ${c.label.toLowerCase()}`} onPress={v <= c.min ? null : () => set(c.k, down)} />
              <StepBtn icon="Plus" label={`More ${c.label.toLowerCase()}`} onPress={v >= c.max ? null : () => set(c.k, up)} />
            </View>
          </View>
        )
      })}
    </View>
  )
}

/** One labelled seconds stepper on a row: the circuit's less common settings. */
export function SecondsRow({ label, value, max = 3600, onChange, first = true }: {
  label: string; value: number; max?: number; onChange: (v: number) => void; first?: boolean
}) {
  return (
    <View style={[st.row, !first && st.rowLine]}>
      <T size={font.body} dim style={{ flexShrink: 1 }}>{label}</T>
      <View style={st.step}>
        <StepBtn icon="Minus" size={18} label={`Less ${label.toLowerCase()}`} onPress={value <= 0 ? null : () => { tap(); onChange(stepSeconds(value, -1)) }} />
        <T size={font.title} weight={600} tabular style={st.value}>{value ? secondsLabel(value) : 'None'}</T>
        <StepBtn icon="Plus" size={18} label={`More ${label.toLowerCase()}`} onPress={value >= max ? null : () => { tap(); onChange(Math.min(max, stepSeconds(value, 1))) }} />
      </View>
    </View>
  )
}

/**
 * The exercises of a circuit, in order. `items` are `{ id, key, name, timing }`;
 * every change is a callback by index, so the plan and the preset each keep
 * their own store. The open row is held by position: ids are positional, so a
 * move takes the open panel with the exercise.
 */
export function CircuitList({ items, work, liftField, onTiming, onRemove, onMove, onAdd, adding: startAdding = false }: {
  items: { id: string; key: string | null; name: string; timing: Timing; load?: string | null }[]
  work: number
  liftField: any
  onTiming: (i: number, t: any) => void
  onRemove: (i: number) => void
  onMove?: ((i: number, dir: 'up' | 'down') => void) | null
  onAdd?: ((key: string) => void) | null
  adding?: boolean
}) {
  const [open, setOpen] = useState<number | null>(null)
  const [adding, setAdding] = useState(startAdding)
  const [about, setAbout] = useState<{ key: string; name: string } | null>(null)

  return (
    <View style={{ gap: space[2] }}>
      {items.map((it, i) => {
        const shown = open === i
        const m = musclesOf(liftField, it.key)
        const own = it.timing.by !== 'circuit'
        return (
          <View key={it.id} style={st.item}>
            <View style={st.itemRow}>
              <Press onPress={() => { tap(); setOpen(shown ? null : i) }} style={st.itemHead}
                accessibilityRole="button" accessibilityState={{ expanded: shown }}
                accessibilityLabel={`${it.name}, ${timingWords(it.timing, work)}. Change`}>
                <ExerciseBody field={liftField} exercise={it.key} name={it.name} size={28} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T size={font.body} weight={600}>{it.name}</T>
                  {m ? <T size={font.small} dim>{muscleWords(m)}</T> : null}
                </View>
                <T size={font.small} weight={own ? 600 : 400} color={own ? colors.ink : colors.inkDim} tabular>{timingWords(it.timing, work)}{it.load ? ` @ ${it.load}` : ''}</T>
                <Icon name={shown ? 'ChevronUp' : 'ChevronDown'} size={15} color={colors.inkFaint} />
              </Press>
              {it.key ? <IconBtn icon="Info" size={18} label={`What is ${it.name}?`} onPress={() => setAbout({ key: it.key!, name: it.name })} /> : null}
            </View>
            {shown ? (
              <TimingEdit timing={it.timing} work={work} name={it.name}
                first={i === 0} last={i === items.length - 1}
                onTiming={(t) => onTiming(i, t)}
                onUp={onMove ? () => { onMove(i, 'up'); setOpen(i - 1) } : null}
                onDown={onMove ? () => { onMove(i, 'down'); setOpen(i + 1) } : null}
                onRemove={() => { setOpen(null); onRemove(i) }} />
            ) : null}
          </View>
        )
      })}
      {about ? <ExerciseSheet field={liftField} exercise={about.key} name={about.name} onClose={() => setAbout(null)} /> : null}

      {onAdd && liftField ? (
        <Press onPress={() => { tap(); setAdding(true) }} style={st.add} accessibilityRole="button">
          <Icon name="Plus" size={15} color={colors.inkDim} />
          <T size={font.small} dim>{items.length ? 'Add an exercise' : 'Pick the exercises'}</T>
        </Press>
      ) : null}
      {adding && onAdd ? (
        <Popover label="Add an exercise" onClose={() => setAdding(false)}>
          <ExercisePicker field={liftField}
            onPick={(key: string) => { impact(); onAdd(key); setAdding(false) }}
            onClose={() => setAdding(false)} />
        </Popover>
      ) : null}
    </View>
  )
}

/** One exercise's timing: the circuit's, its own seconds, or reps done to a count. Then where it sits. */
function TimingEdit({ timing, work, name, first, last, onTiming, onUp, onDown, onRemove }: {
  timing: Timing; work: number; name: string; first: boolean; last: boolean
  onTiming: (t: any) => void; onUp: (() => void) | null; onDown: (() => void) | null; onRemove: () => void
}) {
  const by = timing.by
  const choose = (next: Timing['by']) => {
    if (next === by) return
    if (next === 'circuit') onTiming({})
    else if (next === 'time') onTiming({ seconds: work })
    else onTiming({ reps: 10 })
  }
  const secs = timing.seconds || work
  const reps = timing.reps || 1
  return (
    <View style={st.edit}>
      <Segmented tap value={by} onChange={choose} options={[
        { value: 'circuit', label: `Circuit's ${secondsLabel(work)}` },
        { value: 'time', label: 'Own time' },
        { value: 'reps', label: 'Reps' },
      ]} />
      {by === 'time' ? (
        <View style={st.step}>
          <StepBtn icon="Minus" label={`Less time on ${name}`}
            onPress={secs <= LIMITS.work[0] ? null : () => { tap(); onTiming({ seconds: Math.max(LIMITS.work[0], stepSeconds(secs, -1)) }) }} />
          <T size={font.title} weight={600} tabular style={st.value}>{secondsLabel(secs)}</T>
          <StepBtn icon="Plus" label={`More time on ${name}`}
            onPress={secs >= LIMITS.work[1] ? null : () => { tap(); onTiming({ seconds: Math.min(LIMITS.work[1], stepSeconds(secs, 1)) }) }} />
        </View>
      ) : null}
      {by === 'reps' ? (
        <View style={[st.step, { gap: space[3] }]}>
          <View style={st.step}>
            <StepBtn icon="Minus" label={`Fewer reps of ${name}`} onPress={reps <= 1 ? null : () => { tap(); onTiming({ reps: reps - 1 }) }} />
            <T size={font.title} weight={600} tabular style={st.value}>{reps} reps</T>
            <StepBtn icon="Plus" label={`More reps of ${name}`} onPress={reps >= LIMITS.reps[1] ? null : () => { tap(); onTiming({ reps: reps + 1 }) }} />
          </View>
          <T size={font.small} dim>Tap when done</T>
        </View>
      ) : null}
      <View style={st.acts}>
        {onUp ? <Btn kind="quiet" small icon="ChevronUp" title="Earlier" disabled={first} onPress={onUp} /> : null}
        {onDown ? <Btn kind="quiet" small icon="ChevronDown" title="Later" disabled={last} onPress={onDown} /> : null}
        <View style={{ flex: 1 }} />
        <Btn kind="quiet" small icon="Trash2" title="Remove" onPress={onRemove} />
      </View>
    </View>
  )
}

// The web's .cx-* rules in timer.css, on the same tokens.
const st = StyleSheet.create({
  steps: { flexDirection: 'row', gap: space[2], marginVertical: space[2] },
  cell: {
    flex: 1, alignItems: 'center', gap: space[1], paddingVertical: space[2], paddingHorizontal: space[1],
    borderRadius: radius.card, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line,
  },
  cellStep: { flexDirection: 'row', gap: space[2] },
  row: {
    minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3],
    paddingLeft: space[4], paddingRight: space[2], paddingVertical: space[1],
  },
  rowLine: { borderTopWidth: 1, borderTopColor: colors.line },
  step: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  value: { minWidth: 64, textAlign: 'center' },
  item: {
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: radius.card,
    paddingVertical: space[1], paddingLeft: space[3], paddingRight: space[1],
  },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  itemHead: { flex: 1, minWidth: 0, minHeight: TAP, flexDirection: 'row', alignItems: 'center', gap: space[3] },
  edit: { gap: space[2], paddingTop: space[2], paddingBottom: space[1], paddingRight: space[2] },
  acts: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  add: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2], minHeight: TAP,
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.lineStrong, borderRadius: radius.control,
  },
})
