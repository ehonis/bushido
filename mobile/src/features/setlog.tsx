/*
 * Per-set logging.
 *
 * Sets arrive pre-filled from the prescription, so a session you did exactly as
 * written is zero typing — you just confirm. Everything is editable and sets can
 * be added or removed, because the interesting sessions are the ones where you
 * did four instead of three, or the last set fell apart at rep 7.
 *
 * Load is stored SIGNED: positive is weight added, negative is counterweight
 * removed. On a 20mm edge most repeater work is negative, so the sign is a
 * per-exercise toggle rather than something you type.
 *
 * Native: the web's <select>s are system action sheets, a set row swipes left to
 * remove (the X stays, it is the visible affordance), and the range input is a
 * gesture-handler track.
 */
import React, { useMemo, useRef, useState } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { colors, mix, TAP } from '../theme'
import { T } from '../ui/Text'
import { Press } from '../ui/kit'
import { showMenu } from '../ui/menu'
import { impact, tap } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { NumInput } from './numinput'
import { SwipeRemove } from './exercises'
import {
  GRADES, GRADE_FIELD, gradeLabel, hardestGrade, gradesIn, hasGrades, fitGrades, repCount,
  VGRADES, vLabel, CLIMB_FIELD, offersClimbs, climbsOn, blankClimb, fitClimbs, fallsIn,
  stepClimbs, FELT_MIN, FELT_MAX, feltLabel, DOWN_OPTIONS, downsIn, lengthsIn,
} from '../lib/grades.js'

const FIELD_META: Record<string, { label: string; width?: number; step?: number; kind?: string }> = {
  reps: { label: 'reps', width: 58, step: 1 },
  seconds: { label: 'secs', width: 58, step: 1 },
  weight: { label: 'lb', width: 68, step: 0.5 },
  // Crimp crawls have no load cell and no counterweight — how high the feet are
  // IS the intensity dial, so the stair number is logged per set like a weight.
  stair: { label: 'stair', width: 58, step: 1 },
  // The one field that is a LIST rather than a number: a doubled lead lap is two
  // laps in one set and they are not always the same route, so the grade belongs
  // to the rep. The list mechanics live in lib/grades.js.
  grades: { label: 'grade', kind: 'grades' },
}

/** An unrecognised field renders as a plain number rather than crashing the log. */
const meta = (f: string) => FIELD_META[f] || { label: f, width: 62, step: 1 }

/** Build the default set rows for one exercise straight from the prescription. */
export function seedSets(exercise: any) {
  const { defaultSets, defaults = {}, fields } = exercise
  const row: any = {}
  for (const f of fields) row[f] = defaults[f] ?? ''
  // Fresh array per row — a shared reference would make every set of doubles
  // show the grade the user picked for the first one.
  return Array.from({ length: defaultSets }, () => cloneRow(row, fields, row.reps))
}

/** A row copy whose per-rep lists are their own arrays and the right length. */
function cloneRow(row: any, fields: string[], reps: any) {
  const next = { ...row }
  if (hasGrades(fields)) next[GRADE_FIELD] = fitGrades(next[GRADE_FIELD], reps)
  // A copied set keeps the detail SWITCHED ON but not its answers — the grades
  // of the last ten problems say nothing about the next ten.
  if (Array.isArray(next[CLIMB_FIELD])) next[CLIMB_FIELD] = fitClimbs([], reps)
  return next
}

/**
 * A <select> on a phone: a box showing the answer that opens the system action
 * sheet. The OS sheet is the better target for one thumb with chalk on it than
 * four rows of chips per lap.
 */
function SelectBox({ text, label, onPress, dim, style }: {
  text: string
  label: string
  onPress: () => void
  dim?: boolean
  style?: StyleProp<ViewStyle>
}) {
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={[st.select, style]}>
      <T size={16} tabular color={dim ? colors.inkDim : colors.ink} numberOfLines={1}>{text}</T>
      <Icon name="ChevronDown" size={13} color={colors.inkFaint} />
    </Press>
  )
}

/**
 * One value off a fixed ladder.
 *
 * Shared with the session-level grade field, workout mode's review screen and
 * the per-climb detail, so a grade is entered the same way wherever it is.
 */
function LadderSelect({ ladder, fmt, value, onChange, label, style }: any) {
  const n = Number(value)
  const has = value !== '' && value !== null && value !== undefined && Number.isFinite(n)
  const known = has && ladder.some((g: any) => g.value === n)
  const open = () => showMenu([
    { label: '—', onPress: () => onChange('') },
    // An off-ladder value keeps its own option, so opening the picker on an old
    // hand-written grade cannot silently overwrite it.
    ...(has && !known ? [{ label: fmt(n), onPress: () => onChange(n) }] : []),
    ...ladder.map((g: any) => ({ label: g.label, onPress: () => onChange(g.value) })),
  ], { title: label })
  const text = has ? (ladder.find((g: any) => g.value === n)?.label ?? fmt(n)) : '—'
  return <SelectBox text={text} label={label} onPress={open} style={style} />
}

/** The route ladder — 5.7 to 5.12. */
export function GradeSelect({ value, onChange, label, style }: any) {
  return <LadderSelect ladder={GRADES} fmt={gradeLabel} value={value} onChange={onChange} label={label} style={style} />
}

/**
 * The grade pickers for one set — one per rep, labelled by rep number.
 *
 * `what` is what a rep of this exercise is CALLED, from the exercise's own
 * `repName`: a rep of a double is a lap.
 */
export function GradeLaps({ count, values, onChange, what = 'rep', where = '' }: any) {
  const list = Array.isArray(values) ? values : []
  const at = (i: number, v: any) => onChange(Array.from({ length: count }, (_, k) => (k === i ? v : list[k] ?? '')))
  return (
    <View style={st.gradelaps}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={st.gradelap}>
          <T size={10} faint caps>{`${what} ${i + 1}`}</T>
          <GradeSelect value={list[i]} onChange={(v: any) => at(i, v)} label={`${where}${what} ${i + 1} grade`} />
        </View>
      ))}
    </View>
  )
}

/**
 * The range input, for a chalky thumb: a 6pt track and a 26pt thumb on a 44pt
 * band. Drag or tap. A tap always answers, even one that lands where the thumb
 * already sits, because dead centre ("spot on") is where an untouched slider sits.
 */
export function RangeSlider({ min, max, step = 1, value, onChange, label, style }: {
  min: number
  max: number
  step?: number
  value: number
  onChange: (v: number) => void
  label?: string
  style?: StyleProp<ViewStyle>
}) {
  const [w, setW] = useState(0)
  const cur = useRef(value)
  cur.current = value
  const cb = useRef(onChange)
  cb.current = onChange
  const width = useRef(0)
  width.current = w
  const THUMB = 26

  const gesture = useMemo(() => {
    const pick = (x: number, always: boolean) => {
      const span = width.current - THUMB
      if (span <= 0) return
      const p = Math.min(1, Math.max(0, (x - THUMB / 2) / span))
      const raw = min + p * (max - min)
      const v = Math.round((Math.round((raw - min) / step) * step + min) * 100) / 100
      if (v !== cur.current) tap()
      if (always || v !== cur.current) { cur.current = v; cb.current(v) }
    }
    const pan = Gesture.Pan().runOnJS(true).activeOffsetX([-6, 6]).failOffsetY([-12, 12])
      .onStart((e) => pick(e.x, false))
      .onUpdate((e) => pick(e.x, false))
    const press = Gesture.Tap().runOnJS(true).onEnd((e) => pick(e.x, true))
    return Gesture.Race(pan, press)
  }, [min, max, step])

  const pct = Math.min(1, Math.max(0, ((Number(value) || 0) - min) / (max - min)))
  const span = Math.max(0, w - THUMB)
  const bump = (d: number) => {
    const v = Math.min(max, Math.max(min, (Number(value) || 0) + d * step))
    tap(); onChange(v)
  }
  return (
    <GestureDetector gesture={gesture}>
      <View
        style={[st.slider, style]}
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min, max, now: Number(value) || 0 }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => bump(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
      >
        <View style={[st.track, { left: THUMB / 2, right: THUMB / 2 }]}>
          <View style={[st.fill, { width: span * pct }]} />
        </View>
        <View style={[st.thumb, { left: span * pct }]} />
      </View>
    </GestureDetector>
  )
}

/**
 * The optional per-climb detail — one record per rep: grade, style, whether the
 * user fell, and how honest the grade felt.
 *
 * `spec` is the exercise's `climbLog` from the plan: `scale` picks the ladder
 * ('v' for boulders) and `styles` is the vocabulary. The felt slider appears only
 * once a climb HAS a grade, and stays unanswered until touched.
 *
 * `omitGrade` is for exercises that ALREADY log a grade per rep — two grade
 * pickers per lap is a bug waiting to disagree with itself — so there this
 * renders only what it adds: the style and whether the user fell.
 */
export function ClimbLog({ count, values, spec, onChange, onMore, what = 'climb', where = '', omitGrade = false }: any) {
  const list = Array.isArray(values) ? values : []
  const climbAt = (i: number) => (list[i] && typeof list[i] === 'object' ? { ...blankClimb(), ...list[i] } : blankClimb())
  const at = (i: number, patch: any) =>
    onChange(Array.from({ length: count }, (_, k) => (k === i ? { ...climbAt(k), ...patch } : climbAt(k))))
  const ladder = spec?.scale === 'v' ? VGRADES : GRADES
  const fmt = spec?.scale === 'v' ? vLabel : gradeLabel

  return (
    <View style={st.climblog}>
      {Array.from({ length: count }, (_, i) => {
        const c = climbAt(i)
        const felt = c.felt === '' || c.felt == null ? null : Number(c.felt)
        const hasGrade = !omitGrade && c.grade !== '' && c.grade != null
        const tag = `${where}${what} ${i + 1}`
        return (
          <View key={i} style={st.climb}>
            <View style={st.climbRow}>
              <T size={10} faint caps>{`${what} ${i + 1}`}</T>
              {!omitGrade && (
                <LadderSelect ladder={ladder} fmt={fmt} value={c.grade} label={`${tag} grade`}
                  onChange={(v: any) => at(i, { grade: v })} />
              )}
              {(spec?.styles?.length ?? 0) > 0 && (
                <SelectBox
                  text={c.style || 'style —'} label={`${tag} style`}
                  onPress={() => showMenu([
                    { label: 'style —', onPress: () => at(i, { style: '' }) },
                    ...spec.styles.map((s: string) => ({ label: s, onPress: () => at(i, { style: s }) })),
                  ], { title: `${tag} style` })}
                />
              )}
              {/* Only where the plan says down-climbing is a thing on this card —
                  you down-climb a route, not a twelve-move boulder problem. */}
              {spec?.downClimb && (
                <SelectBox
                  dim text={DOWN_OPTIONS.find((o) => o.value === (c.down || ''))?.label || DOWN_OPTIONS[0].label}
                  label={`${tag} up or down`}
                  onPress={() => showMenu(DOWN_OPTIONS.map((o) => ({ label: o.label, onPress: () => at(i, { down: o.value }) })),
                    { title: `${tag} up or down` })}
                />
              )}
              <Press
                haptic onPress={() => at(i, { fell: !c.fell })}
                accessibilityRole="button" accessibilityState={{ selected: Boolean(c.fell) }}
                style={[st.fell, c.fell && st.fellOn]}
              >
                <Icon name={c.fell ? 'CircleSlash' : 'Circle'} size={13} color={c.fell ? colors.vizCrit : colors.inkFaint} />
                <T size={12} color={c.fell ? colors.ink : colors.inkDim}>fell</T>
              </Press>
            </View>
            {hasGrade && (
              <View style={st.felt}>
                <RangeSlider min={FELT_MIN} max={FELT_MAX} step={1} value={felt ?? 0}
                  label={`${tag} felt for the grade`}
                  onChange={(v) => at(i, { felt: v })} style={{ flexGrow: 0, flexShrink: 1, flexBasis: 200 }} />
                <T size={11} faint numberOfLines={1}>{felt == null ? 'for the grade: —' : feltLabel(felt)}</T>
              </View>
            )}
          </View>
        )
      })}
      {/* The next climb is added from HERE: it is filled in one climb at a time
          mid-session and the bottom of the list is where the thumb already is. */}
      {onMore && (
        <Press onPress={() => { impact(); onMore() }} style={[st.add, { alignSelf: 'flex-start' }]} accessibilityRole="button">
          <T size={12} dim>{`+ one more ${what}`}</T>
        </Press>
      )}
    </View>
  )
}

function Exercise({ exercise, rows, sign, onRows, onSign }: any) {
  const fields: string[] = exercise.fields || []
  const perRep = hasGrades(fields)
  const what = exercise.repName || 'rep'
  // The plan says this exercise CAN log per-climb detail; the rows say whether
  // this entry IS. Presence of the list is the state — see lib/grades.js.
  const offers = offersClimbs(exercise)
  const detailed = climbsOn(rows)
  const cols = fields.filter((f) => meta(f).kind !== 'grades')

  const set = (i: number, field: string, value: any) => {
    const next = rows.map((r: any, j: number) => {
      if (j !== i) return r
      const row = { ...r, [field]: value === '' || value === null ? '' : Number(value) }
      // The pickers follow the rep count, live — change 2 laps to 3 and a third
      // grade appears rather than the row quietly logging two.
      if (perRep && field === 'reps') row[GRADE_FIELD] = fitGrades(row[GRADE_FIELD], row.reps)
      if (Array.isArray(row[CLIMB_FIELD]) && field === 'reps') row[CLIMB_FIELD] = fitClimbs(row[CLIMB_FIELD], row.reps)
      return row
    })
    onRows(next)
  }

  const setDetail = (on: boolean) => onRows(rows.map((r: any) => {
    // Reps is normalised to the row count on the way in: from here the list is
    // the source of truth and the box only displays it.
    if (on) return { ...r, reps: repCount(r.reps), [CLIMB_FIELD]: fitClimbs(r[CLIMB_FIELD], r.reps) }
    const { [CLIMB_FIELD]: _dropped, ...rest } = r
    return rest
  }))

  // The only way the count moves while the detail is on. One at a time and
  // always at the end, so nothing filled in can vanish that was not on screen.
  const bump = (i: number, delta: number) => { tap(); onRows(rows.map((r: any, j: number) => (j === i ? stepClimbs(r, delta) : r))) }
  const setList = (i: number, field: string, list: any) =>
    onRows(rows.map((r: any, j: number) => (j === i ? { ...r, [field]: list } : r)))
  const addSet = () => { impact(); onRows([...rows, cloneRow(rows.at(-1) || {}, fields, rows.at(-1)?.reps)]) }
  const dropSet = (i: number) => { tap(); onRows(rows.filter((_: any, j: number) => j !== i)) }

  const hasWeight = fields.includes('weight')
  const total = rows.reduce((s: number, r: any) => s + (Number(r.reps) || 0), 0)
  const falls = detailed ? fallsIn(rows) : 0
  // Lengths of wall: a lap climbed and reversed is two. Shown only when it
  // differs from the rep count.
  const downs = detailed ? downsIn(rows) : 0
  const lengths = detailed ? lengthsIn(rows) : 0

  return (
    <View>
      <View style={st.head}>
        <T size={13} weight={600} style={{ flex: 1, minWidth: 0 }}>{exercise.name}</T>
        {/* A toggle rather than always-on: ten selects you scroll past is how a
            twenty-second form stops being filled in. */}
        {offers && (
          <Press haptic onPress={() => setDetail(!detailed)} accessibilityState={{ selected: detailed }}
            style={[st.signtog, detailed && { borderColor: mix(colors.accent, 40, colors.line) }]} hitSlop={6}>
            <T size={11} color={detailed ? colors.accent : colors.inkDim}>{detailed ? `logging each ${what}` : `log each ${what}`}</T>
          </Press>
        )}
        {hasWeight && (
          <Press haptic onPress={() => onSign(sign === '-' ? '+' : '-')}
            style={[st.signtog, sign === '-' && { borderColor: mix(colors.series1, 40, colors.line) }]} hitSlop={6}>
            <T size={11} color={sign === '-' ? colors.series1 : colors.inkDim}>{sign === '-' ? '− counterweight' : '+ added'}</T>
          </Press>
        )}
      </View>

      <View style={st.thead}>
        <T size={10} faint caps weight={500} align="center" style={st.cSet}>set</T>
        {cols.map((f) => (
          <T key={f} size={10} faint caps weight={500} align="center" style={{ width: meta(f).width }}>{meta(f).label}</T>
        ))}
      </View>

      {rows.map((r: any, i: number) => (
        <View key={i}>
          <SwipeRemove label="Remove" onRemove={() => dropSet(i)}>
            <View style={st.row}>
              <T size={13} faint tabular align="center" style={st.cSet}>{String(i + 1)}</T>
              {cols.map((f) => (
                <View key={f}>
                  {/* While the detail is on, the climb list IS the count: the box
                      only displays it and the steppers move it one at a time.
                      Typing "12" over a 10 passes through "1" and each keystroke
                      refit the list, deleting climbs already filled in. */}
                  {f === 'reps' && Array.isArray(r[CLIMB_FIELD]) ? (
                    <View style={st.repstep}>
                      <Press onPress={() => bump(i, -1)} style={st.repstepB} accessibilityLabel={`set ${i + 1}: one fewer ${what}`}>
                        <T size={19} dim lineHeight={22}>−</T>
                      </Press>
                      <View style={[st.numBox, { width: 44 }]} accessibilityLabel={`set ${i + 1} ${meta(f).label}`}>
                        <T size={16} dim tabular align="center">{String(repCount(r.reps))}</T>
                      </View>
                      <Press onPress={() => bump(i, 1)} style={st.repstepB} accessibilityLabel={`set ${i + 1}: one more ${what}`}>
                        <T size={19} dim lineHeight={22}>+</T>
                      </Press>
                    </View>
                  ) : (
                    <NumInput
                      value={r[f] ?? ''} onChange={(v: any) => set(i, f, v)} blank=""
                      accessibilityLabel={`set ${i + 1} ${meta(f).label}`}
                      keyboardAppearance="dark" selectTextOnFocus selectionColor={colors.accent}
                      style={[st.numBox, st.numIn, { width: meta(f).width }]}
                    />
                  )}
                </View>
              ))}
              <View style={{ flex: 1 }} />
              <Press onPress={() => dropSet(i)} style={st.x} accessibilityLabel={`Remove set ${i + 1}`} hitSlop={4}>
                <Icon name="X" size={14} color={colors.inkFaint} />
              </Press>
            </View>
          </SwipeRemove>
          {/* The per-rep grades get their own line under the row: a third column
              of selects pushes the reps cell off a phone screen. */}
          {perRep && (
            <View style={st.under}>
              <GradeLaps count={repCount(r.reps)} values={r[GRADE_FIELD]} what={what} where={`set ${i + 1} `}
                onChange={(list: any) => setList(i, GRADE_FIELD, list)} />
            </View>
          )}
          {/* The optional per-climb detail, same full-width slot. */}
          {Array.isArray(r[CLIMB_FIELD]) && (
            <View style={st.under}>
              <ClimbLog count={repCount(r.reps)} values={r[CLIMB_FIELD]}
                spec={exercise.climbLog} what={what} omitGrade={perRep}
                where={rows.length > 1 ? `set ${i + 1} ` : ''}
                onChange={(list: any) => setList(i, CLIMB_FIELD, list)}
                onMore={repCount(r.reps) < 20 ? () => bump(i, 1) : undefined} />
            </View>
          )}
        </View>
      ))}

      <View style={st.foot}>
        <Press onPress={addSet} style={st.add} accessibilityRole="button">
          <T size={12} dim>+ add set</T>
        </Press>
        <T size={12} faint tabular style={{ flex: 1 }}>
          {`${rows.length} set${rows.length === 1 ? '' : 's'}${total ? ` · ${total} reps` : ''}`
            + `${downs > 0 ? ` · ${downs} down-climbed` : ''}`
            + `${lengths > total ? ` · ${lengths} lengths` : ''}`
            + `${falls > 0 ? ` · fell on ${falls}` : ''}`}
        </T>
      </View>
    </View>
  )
}

export function SetLog({ session, out, onSave }: any) {
  const spec = session?.logSpec
  if (!spec?.exercises?.length) return null

  const stored = out.sets || {}
  const signs = out.signs || {}

  const rowsFor = (ex: any) => stored[ex.key] ?? seedSets(ex)
  const signFor = (ex: any) => signs[ex.key] ?? ex.defaults?.sign ?? '+'

  const setRows = (ex: any, rows: any) => onSave({ ...out, sets: { ...stored, [ex.key]: rows } })
  const setSign = (ex: any, sign: string) => onSave({ ...out, signs: { ...signs, [ex.key]: sign } })

  return (
    <View style={{ gap: 18 }}>
      {spec.exercises.map((ex: any) => (
        <Exercise
          key={ex.key}
          exercise={ex}
          rows={rowsFor(ex)}
          sign={signFor(ex)}
          onRows={(rows: any) => setRows(ex, rows)}
          onSign={(s: string) => setSign(ex, s)}
        />
      ))}
      <T size={12} faint lineHeight={17}>
        {'Pre-filled from the plan — change anything that didn\'t match, add a set if you did more, '
          + 'remove one if you stopped early. Load is per set, so a drop-off shows up; where a grade is '
          + 'asked for it is per rep, so a set of two laps on two different routes reads as two.'
          + (spec.exercises.some((e: any) => offersClimbs(e))
            ? ' Entirely optional: "log each climb" opens a line per climb — style, whether you fell, and (where the grade is not already asked per rep) its grade and how honest that felt.'
            : '')}
      </T>
    </View>
  )
}

/* --------------------------------------------------------------- derived --- */

/** Signed load for a row, honouring the exercise's +/− toggle. */
export function signedLoad(row: any, sign: string) {
  const w = Number(row?.weight)
  if (!Number.isFinite(w)) return null
  return sign === '-' ? -Math.abs(w) : Math.abs(w)
}

/** Total completed reps across every exercise in a logged session. */
export function totalReps(out: any): number {
  return (Object.values(out?.sets || {}) as any[])
    .flat()
    .reduce((s: number, r: any) => s + (Number(r?.reps) || 0), 0)
}

/**
 * Lengths of wall climbed across every exercise — a lap climbed AND down-climbed
 * is two of them. Equal to `totalReps` until something is marked down-climbed,
 * which is what makes it safe to plot.
 */
export function totalLengths(out: any): number {
  return (Object.values(out?.sets || {}) as any[]).reduce((s: number, rows: any) => s + lengthsIn(rows), 0)
}

/** Total sets across every exercise. */
export function totalSets(out: any): number {
  return (Object.values(out?.sets || {}) as any[]).reduce((s: number, rows: any) => s + rows.length, 0)
}

/** Every per-rep grade logged for one exercise, in the order they were climbed. */
export function gradesFor(out: any, key: string) {
  return gradesIn(out?.sets?.[key])
}

/** The hardest rung logged for one exercise, or null if none was. */
export function topGrade(out: any, key: string) {
  return hardestGrade(gradesFor(out, key))
}

/** Heaviest signed load recorded for one exercise. */
export function topLoad(out: any, key: string) {
  const rows = out?.sets?.[key] || []
  const sign = out?.signs?.[key] ?? '+'
  const vals = rows.map((r: any) => signedLoad(r, sign)).filter((v: any) => v != null)
  return vals.length ? Math.max(...vals) : null
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 7 },
  signtog: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 999,
    paddingHorizontal: 10, minHeight: 32, justifyContent: 'center',
  },
  thead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 4 },
  cSet: { width: 22 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3, backgroundColor: colors.panel },
  numBox: {
    minHeight: TAP, borderRadius: 8, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel2,
    justifyContent: 'center', paddingHorizontal: 6,
  },
  numIn: { color: colors.ink, fontSize: 16, textAlign: 'center', fontVariant: ['tabular-nums'], paddingVertical: 6 },
  x: { width: TAP, height: TAP, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  under: { paddingLeft: 30, paddingRight: 4 },
  repstep: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  repstepB: {
    minWidth: TAP, minHeight: TAP, borderRadius: 8, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center',
  },
  gradelaps: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 8, paddingTop: 2, paddingBottom: 6 },
  gradelap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  select: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: TAP, paddingHorizontal: 10,
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: 8,
  },
  climblog: { gap: 10, paddingTop: 4, paddingBottom: 6 },
  climb: { gap: 2 },
  climbRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  fell: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: TAP, paddingHorizontal: 13,
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: 999,
  },
  fellOn: { borderColor: mix(colors.accent, 55, colors.line), backgroundColor: mix(colors.accent, 12, colors.panel2) },
  felt: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 2 },
  slider: { height: TAP, justifyContent: 'center', flexGrow: 1 },
  track: { position: 'absolute', height: 6, borderRadius: 3, backgroundColor: colors.panel2, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: colors.accent },
  thumb: {
    position: 'absolute', width: 26, height: 26, borderRadius: 13, backgroundColor: colors.ink,
    borderWidth: 3, borderColor: colors.bg,
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 3, shadowOffset: { width: 0, height: 1 },
  },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  add: {
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, borderRadius: 7,
    paddingHorizontal: 11, minHeight: TAP, justifyContent: 'center',
  },
})
