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
 * remove (with Undo; there is no X in a row since #81, and the foot's "Remove a
 * set" is the visible way, as on the web), and the range input is a
 * gesture-handler track.
 */
import React, { useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { colors, font, mix, radius, space, TAP, height } from '../theme'
import { T } from '../ui/Text'
import { Btn, Chip, Press, Segmented } from '../ui/kit'
import { Fold } from '../ui/Fold'
import { confirm, showMenu } from '../ui/menu'
import { impact, tap } from '../ui/haptics'
import { pushToast } from '../lib/toast'
import { Icon } from '../lib/icons'
import { NumInput } from './numinput'
import { SwipeRemove } from './exercises'
import { Explain } from './blurb'
import {
  GRADE_FIELD, hardestGrade, gradesIn, hasGrades, fitGrades, repCount,
  VGRADES, CLIMB_FIELD, offersClimbs, climbsOn, blankClimb, fitClimbs,
  stepClimbs, FELT_MIN, FELT_MAX, feltLabel, DOWN_OPTIONS, downLabel, lengthsIn,
  routeLadder, routeSystem, setRouteSystem, ROUTE_SYSTEMS, labelOn, scaleOfExercise,
  climbCount, detailOn, dropClimb, putClimb, climbSaid, saidIn,
  outcomesFor, outcomeOf, outcomeLabel, withOutcome, MAX_CLIMBS,
  climbsCounted, climbTotals, nearRungs, anyTold,
} from '../lib/grades.js'

const FIELD_META: Record<string, { label: string; width?: number; step?: number; kind?: string }> = {
  reps: { label: 'reps', width: 58 },
  seconds: { label: 'secs', width: 58 },
  weight: { label: 'lb', width: 68 },
  // Crimp crawls have no load cell and no counterweight — how high the feet are
  // IS the intensity dial, so the stair number is logged per set like a weight.
  stair: { label: 'stair', width: 58 },
  // The one field that is a LIST rather than a number: a doubled lead lap is two
  // laps in one set and they are not always the same route, so the grade belongs
  // to the rep. The list mechanics live in lib/grades.js.
  grades: { label: 'grade', kind: 'grades' },
}

/** An unrecognised field renders as a plain number rather than crashing the log. */
const meta = (f: string) => FIELD_META[f] || { label: f, width: 62 }

/** "route" → "routes"; the plan's own word for one climb, counted. */
export const plural = (word: string, n = 2) => (n === 1 ? word : /(s|sh|ch|x)$/.test(word) ? `${word}es` : `${word}s`)
const cap = (w: string) => (w ? w[0].toUpperCase() + w.slice(1) : w)

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
      <T size={font.input} tabular color={dim ? colors.inkDim : colors.ink} numberOfLines={1}>{text}</T>
      <Icon name="ChevronDown" size={13} color={colors.inkFaint} />
    </Press>
  )
}

/*
 * Letters (5.10a) or plus/minus (5.10+): the climber's choice, kept on the device
 * (lib/grades.js `routeSystem`). A tiny store so every route picker on screen
 * follows the switch at once.
 */
const sysListeners = new Set<() => void>()
const subscribeSystem = (fn: () => void) => { sysListeners.add(fn); return () => { sysListeners.delete(fn) } }
export function useRouteSystem(): [string, (s: string) => void] {
  const system = useSyncExternalStore(subscribeSystem, routeSystem, () => 'pm')
  const set = (next: string) => { setRouteSystem(next); for (const fn of sysListeners) fn() }
  return [system, set]
}

/** The explicit scale choice, beside the route pickers it changes. Two 44pt segments. */
export function GradeSystemSwitch() {
  const [system, setSystem] = useRouteSystem()
  return (
    <Segmented tap value={system} onChange={(v) => setSystem(v)}
      options={ROUTE_SYSTEMS.map((x) => ({ value: x.key, label: x.label }))} style={{ flexGrow: 0 }} />
  )
}

/**
 * One value off a fixed ladder: a box showing the answer that opens the system
 * action sheet. Shared with the session-level grade field, workout mode's review
 * screen and the per-climb detail, so a grade is entered the same way wherever it is.
 */
function LadderSelect({ ladder, fmt, value, onChange, label, style }: any) {
  const n = Number(value)
  const has = value !== '' && value !== null && value !== undefined && Number.isFinite(n)
  const known = has && ladder.some((g: any) => g.value === n)
  const open = () => showMenu([
    { label: '—', onPress: () => onChange('') },
    // A value off this ladder (an old hand-written grade, or one written the
    // other way) keeps its own option, so opening the picker cannot overwrite it.
    ...(has && !known ? [{ label: fmt(n), onPress: () => onChange(n) }] : []),
    ...ladder.map((g: any) => ({ label: g.label, onPress: () => onChange(g.value) })),
  ], { title: label })
  const text = has ? (ladder.find((g: any) => g.value === n)?.label ?? fmt(n)) : '—'
  return <SelectBox text={text} label={label} onPress={open} style={style} />
}

const ladderFor = (scale: string, system: string) => (scale === 'v' ? VGRADES : routeLadder(system))

/** A grade off one scale's ladder: `v` for boulders, else the routes (the profile's grades). */
export function ScaleGradeSelect({ scale, value, onChange, label, style }: any) {
  const [system] = useRouteSystem()
  return <LadderSelect ladder={ladderFor(scale, system)} fmt={(v: any) => labelOn(scale, v)} value={value} onChange={onChange} label={label} style={style} />
}

/** The route ladder, written the way this device writes it (5.5 to 5.15). */
export function GradeSelect({ value, onChange, label, style }: any) {
  const [system] = useRouteSystem()
  return <LadderSelect ladder={routeLadder(system)} fmt={(v: any) => labelOn('yds', v)} value={value} onChange={onChange} label={label} style={style} />
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
          <T size={font.caption} faint>{`${what} ${i + 1}`}</T>
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
export function RangeSlider({ min, max, step = 1, value, onChange, label, style, unset = false }: {
  /** Unanswered (AGENTS.md §6.4): the thumb sits on the default as a placeholder
      does, so nothing is lit — an empty track and a hollow thumb. A tap answers it. */
  unset?: boolean
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
          {unset ? null : <View style={[st.fill, { width: span * pct }]} />}
        </View>
        <View style={[st.thumb, unset && st.thumbUnset, { left: span * pct }]} />
      </View>
    </GestureDetector>
  )
}

/** What a described climb says, in one line: "Sent · vert · up + down · a touch stiff". */
export function climbWords(c: any) {
  const felt = c.felt === '' || c.felt == null ? null : Number(c.felt)
  const tries = Number(c.tries)
  return [
    outcomeLabel(outcomeOf(c)),
    c.style || '',
    downLabel(c.down),
    felt == null ? '' : feltLabel(felt),
    Number.isFinite(tries) && tries > 1 ? `${tries} tries` : '',
  ].filter(Boolean).join(' · ')
}

/**
 * The per-climb log (D12, issue #81): one record per climb.
 *
 * Climbs already described are one readable row each; a tap opens one again. The
 * CURRENT climb is the only one with controls: its grade, how it went (Onsight on
 * routes, Flash, Sent, Fell), and behind Details the optional rest (style, up or
 * down where the plan offers it, felt once graded, tries, Remove). The next climb
 * is added from directly under it. Undescribed climbs after the current one are
 * one quiet line. `omitGrade` is for the doubled lead laps, which already ask a
 * grade per lap; `onDrop(i)` where a climb can be taken out (the set log, with
 * Undo); workout mode moves the count with its own stepper.
 */
export function ClimbLog({ count, values, spec, onChange, onMore, onDrop, what = 'climb', where = '', omitGrade = false, initialCurrent = null, toldElsewhere = false }: any) {
  const [system] = useRouteSystem()
  const scale = spec?.scale === 'v' ? 'v' : 'yds'
  const ladder = ladderFor(scale, system)
  const fmt = (v: any) => labelOn(scale, v)
  const list = Array.isArray(values) ? values : []
  const climbs = Array.from({ length: count }, (_, i) =>
    (list[i] && typeof list[i] === 'object' ? { ...blankClimb(), ...list[i] } : blankClimb())) as any[]
  // Pinned once touched: the first undescribed climb is only the default, or
  // picking a grade would move the editor away before the outcome was tapped.
  const [picked, setPicked] = useState<number | null>(initialCurrent)
  const current = picked != null && picked < count ? picked : climbs.findIndex((c) => !climbSaid(c))
  const write = (i: number, rec: any) => { setPicked(i); onChange(climbs.map((c, k) => (k === i ? rec : c))) }
  const at = (i: number, patch: any) => write(i, { ...climbs[i], ...patch })

  const nextBlank = current >= 0 ? climbs.findIndex((c, k) => k > current && !climbSaid(c)) : -1
  const untold = current >= 0 ? climbs.filter((c, k) => k > current && !climbSaid(c)).length : 0
  // Once one climb is described the described ones are the count (lib/grades.js
  // `climbsCounted`, #97): the line says the blanks after them do not count.
  // Another set of this exercise described counts too (`anyTold`, #111).
  const anySaid = climbs.some((c) => climbSaid(c)) || toldElsewhere
  const next = nextBlank >= 0
    ? { label: `Next ${what}`, go: () => setPicked(nextBlank) }
    : onMore ? { label: `Add ${what}`, go: () => { setPicked(count); onMore() } } : null
  const nextButton = next ? <Btn kind="secondary" icon="Plus" title={next.label} onPress={next.go} /> : null

  const editor = (i: number) => {
    const c = climbs[i]
    const tag = `${where}${what} ${i + 1}`
    const felt = c.felt === '' || c.felt == null ? null : Number(c.felt)
    const hasGrade = !omitGrade && c.grade !== '' && c.grade != null
    const prev = omitGrade ? null
      : [...climbs.slice(0, i)].reverse().find((p) => p.grade !== '' && p.grade != null)?.grade ?? null
    const said = outcomeOf(c)
    const tries = Number(c.tries)
    const hasTries = Number.isFinite(tries) && tries >= 1
    return (
      <View style={st.edit}>
        <View style={st.climbRow}>
          <T size={font.label} faint>{`${what} ${i + 1}`}</T>
          {!omitGrade && (
            <LadderSelect ladder={ladder} fmt={fmt} value={c.grade} label={`${tag} grade`}
              onChange={(v: any) => at(i, { grade: v })} />
          )}
          {/* The fast path: most of an evening is the same grade again, or one
              either side of it (#97 F9c): a pick no longer starts a 31-item sheet at 5.5. */}
          {!hasGrade && !omitGrade && prev != null
            ? (nearRungs as any)(ladder, prev, fmt).map((r: any) => (
              <Chip key={r.step} out label={r.step === 0 ? `Same as last: ${r.label}` : r.label}
                onPress={() => at(i, { grade: r.value })} />
            ))
            : null}
        </View>
        <View style={st.outcomes} accessibilityLabel={`${tag}: how it went`}>
          {outcomesFor(scale).map((o: any) => (
            <Chip key={o.value} out on={said === o.value} label={o.label} style={{ minWidth: 72, justifyContent: 'center' }}
              onPress={() => write(i, withOutcome(c, said === o.value ? null : o.value))} />
          ))}
        </View>
        <Fold summary="More details">
          <View style={[st.climbRow, { paddingTop: space[2] }]}>
            {(spec?.styles?.length ?? 0) > 0 && (
              <SelectBox
                text={c.style || 'style —'} label={`${tag} style`}
                onPress={() => showMenu([
                  { label: 'style —', onPress: () => at(i, { style: '' }) },
                  ...spec.styles.map((x: string) => ({ label: x, onPress: () => at(i, { style: x }) })),
                ], { title: `${tag} style` })}
              />
            )}
            {/* Only where the plan says down-climbing is a thing on this card. */}
            {spec?.downClimb && (
              <SelectBox
                dim text={DOWN_OPTIONS.find((o) => o.value === (c.down || ''))?.label || DOWN_OPTIONS[0].label}
                label={`${tag} up or down`}
                onPress={() => showMenu(DOWN_OPTIONS.map((o) => ({ label: o.label, onPress: () => at(i, { down: o.value }) })),
                  { title: `${tag} up or down` })}
              />
            )}
            <View style={st.repstep}>
              <Press onPress={() => { tap(); at(i, { tries: hasTries && tries > 1 ? tries - 1 : '' }) }} style={st.repstepB}
                accessibilityLabel={`${tag}: one fewer try`}>
                <T size={font.title} dim>−</T>
              </Press>
              <T size={font.label} dim tabular align="center" style={{ minWidth: 56 }}>
                {hasTries ? `${tries} ${tries === 1 ? 'try' : 'tries'}` : 'tries —'}
              </T>
              <Press onPress={() => { tap(); at(i, { tries: hasTries ? tries + 1 : 1 }) }} style={st.repstepB}
                accessibilityLabel={`${tag}: one more try`}>
                <T size={font.title} dim>+</T>
              </Press>
            </View>
          </View>
          {hasGrade && (
            <View style={st.felt}>
              <RangeSlider min={FELT_MIN} max={FELT_MAX} step={1} value={felt ?? 0} unset={felt == null}
                label={`${tag} felt for the grade`}
                onChange={(v) => at(i, { felt: v })} style={{ flexGrow: 0, flexShrink: 1, flexBasis: 200 }} />
              <T size={font.label} faint numberOfLines={1}>{felt == null ? 'for the grade: —' : feltLabel(felt)}</T>
            </View>
          )}
          {onDrop ? (
            <Btn kind="quiet" icon="Trash2" title={`Remove ${what}`} style={{ alignSelf: 'flex-start', marginTop: space[2] }}
              onPress={() => { setPicked(null); onDrop(i) }} />
          ) : null}
        </Fold>
        {nextButton}
      </View>
    )
  }

  return (
    <View style={st.climblog}>
      {climbs.map((c, i) => {
        if (i === current) return <View key={i}>{editor(i)}</View>
        // Undescribed climbs after the current one are the quiet line below.
        if (current >= 0 && i > current && !climbSaid(c)) return null
        const words = climbWords(c)
        return (
          <Press key={i} onPress={() => { tap(); setPicked(i) }} accessibilityRole="button"
            accessibilityLabel={`${where}${what} ${i + 1}: change`} style={st.done}>
            <T size={font.label} faint style={{ minWidth: 64 }}>{`${what} ${i + 1}`}</T>
            {!omitGrade && <T size={font.input} weight={600} tabular style={{ minWidth: 52 }}>{fmt(c.grade) || '—'}</T>}
            {words ? <T size={font.label} dim style={{ flex: 1, minWidth: 0 }} numberOfLines={2}>{words}</T> : <View style={{ flex: 1 }} />}
            <Icon name="ChevronRight" size={16} color={colors.inkFaint} />
          </Press>
        )
      })}
      {untold > 0 ? <T size={font.label} faint>{`${untold} more ${plural(what, untold)}, not described${anySaid ? ', so not counted' : ''}`}</T> : null}
      {current < 0 ? nextButton : null}
    </View>
  )
}

/*
 * Taking climb `k` out of a row, and putting it back (the Undo). A lap's grade
 * (the doubles' per-rep list) goes and comes back WITH its climb.
 */
export function withoutClimb(row: any, k: number, perRep = false) {
  const next = dropClimb(row, k)
  if (!perRep) return next
  const grades = fitGrades(row[GRADE_FIELD], row.reps)
  return { ...next, [GRADE_FIELD]: fitGrades(grades.length > 1 ? grades.filter((_: any, x: number) => x !== k) : [''], next.reps) }
}
export function withClimbBack(row: any, k: number, climb: any, grade: any = '', perRep = false) {
  const back = putClimb(row, k, climb)
  if (!perRep) return back
  const grades = fitGrades(row[GRADE_FIELD], row.reps)
  const lone = back.reps === 1
  return { ...back, [GRADE_FIELD]: fitGrades(lone ? [grade] : [...grades.slice(0, k), grade, ...grades.slice(k)], back.reps) }
}

function Exercise({ exercise, rows, sign, onRows, onSign, hintRows = null }: any) {
  const fields: string[] = exercise.fields || []
  const perRep = hasGrades(fields)
  const what = exercise.repName || 'rep'
  // The plan says this exercise CAN log per-climb detail; the rows say whether
  // this entry IS. Presence of the list is the state — see lib/grades.js.
  const offers = offersClimbs(exercise)
  const detailed = climbsOn(rows)
  const routes = scaleOfExercise(exercise) === 'yds'
  const cols = fields.filter((f) => meta(f).kind !== 'grades')

  // An Undo runs after this render is gone: it acts on the rows as they are
  // THEN, through the writer as it is then.
  const latest = useRef({ rows, onRows })
  latest.current = { rows, onRows }
  const undo = (message: string, restore: (now: any[]) => any[]) => pushToast(message, 'info', {
    action: { label: 'Undo', icon: null, onClick: () => latest.current.onRows(restore(latest.current.rows)) },
  })

  const set = (i: number, field: string, value: any) => {
    const next = rows.map((r: any, j: number) => {
      if (j !== i) return r
      const row = { ...r, [field]: value === '' || value === null ? '' : Number(value) }
      // The pickers follow the rep count, live.
      if (perRep && field === 'reps') row[GRADE_FIELD] = fitGrades(row[GRADE_FIELD], row.reps)
      if (Array.isArray(row[CLIMB_FIELD]) && field === 'reps') row[CLIMB_FIELD] = fitClimbs(row[CLIMB_FIELD], row.reps)
      return row
    })
    onRows(next)
  }

  // On: one record per climb already counted, the count kept (lib/grades.js).
  const turnOn = () => { tap(); onRows(rows.map(detailOn)) }
  const turnOff = () => onRows(rows.map((r: any) => { const { [CLIMB_FIELD]: _dropped, ...rest } = r; return rest }))
  // Switching the detail off strips it, so when anything has been said it asks first.
  const said = saidIn(rows)
  const askOff = async () => {
    if (said === 0) { tap(); turnOff(); return }
    const ok = await confirm(`Remove what you logged for ${said} ${plural(what, said)}?`, {
      message: 'The count stays; the grades and outcomes go.', confirmLabel: 'Remove',
    })
    if (ok) turnOff()
  }

  // The only way the count moves while the detail is on: one at a time.
  const bump = (i: number, delta: number) => { tap(); onRows(rows.map((r: any, j: number) => (j === i ? stepClimbs(r, delta) : r))) }
  const setList = (i: number, field: string, list: any) =>
    onRows(rows.map((r: any, j: number) => (j === i ? { ...r, [field]: list } : r)))
  const removeClimb = (i: number, k: number) => {
    const row = rows[i]
    const gone = fitClimbs(row[CLIMB_FIELD], row.reps)[k]
    const goneGrade = perRep ? fitGrades(row[GRADE_FIELD], row.reps)[k] ?? '' : ''
    tap()
    onRows(rows.map((r: any, j: number) => (j === i ? withoutClimb(r, k, perRep) : r)))
    if (climbSaid(gone) || goneGrade !== '') {
      undo(`${cap(what)} ${k + 1} removed`, (now) => now.map((r: any, j: number) =>
        (j === i && Array.isArray(r[CLIMB_FIELD]) ? withClimbBack(r, k, gone, goneGrade, perRep) : r)))
    }
  }
  const addSet = () => { impact(); onRows([...rows, cloneRow(rows.at(-1) || {}, fields, rows.at(-1)?.reps)]) }
  const dropSet = (i: number) => {
    const gone = rows[i]
    tap()
    onRows(rows.filter((_: any, j: number) => j !== i))
    undo(`Set ${i + 1} removed`, (now) => [...now.slice(0, i), gone, ...now.slice(i)])
  }

  const hasWeight = fields.includes('weight')
  const colLabel = (f: string) => (f === 'reps' && exercise.repName ? plural(exercise.repName) : meta(f).label)
  // A described row whose only column is the count has nothing left for the table to show.
  const inTable = (r: any) => !(Array.isArray(r[CLIMB_FIELD]) && cols.every((f) => f === 'reps'))
  const table = rows.some(inTable)

  // What the rows COUNT (lib/grades.js `climbTotals`, the web's too): with the
  // detail on, the described climbs once any is (#97). Lengths of wall: a lap
  // climbed and reversed is two. Shown only when it differs.
  const foot = (climbTotals as any)(rows)
  const total = foot.count
  const falls = detailed ? foot.falls : 0
  const sent = detailed ? foot.sent : 0
  const downs = detailed ? foot.downs : 0
  const lengths = detailed ? foot.lengths : 0
  const noun = exercise.repName ? plural(exercise.repName, total) : 'reps'

  const climbList = (r: any, i: number) => (
    <ClimbLog count={climbCount(r.reps)} values={r[CLIMB_FIELD]}
      spec={exercise.climbLog} what={what} omitGrade={perRep}
      where={rows.length > 1 ? `set ${i + 1} ` : ''}
      toldElsewhere={anyTold(rows.filter((_: any, j: number) => j !== i))}
      onChange={(list: any) => setList(i, CLIMB_FIELD, list)}
      onDrop={(k: number) => removeClimb(i, k)}
      onMore={climbCount(r.reps) < MAX_CLIMBS ? () => bump(i, 1) : undefined} />
  )

  return (
    <View style={{ gap: space[2] }}>
      <View style={st.head}>
        <T size={font.input} weight={600} style={{ flex: 1, minWidth: 0 }}>{exercise.name}</T>
        {/* Letters or plus/minus, where route grades are asked. */}
        {routes && (perRep || detailed) ? <GradeSystemSwitch /> : null}
        {hasWeight && (
          <Press haptic onPress={() => onSign(sign === '-' ? '+' : '-')}
            style={[st.signtog, sign === '-' && { borderColor: mix(colors.series1, 40, colors.line) }]}>
            <T size={font.label} color={sign === '-' ? colors.series1 : colors.inkDim}>{sign === '-' ? '− counterweight' : '+ added'}</T>
          </Press>
        )}
      </View>

      {/* The per-climb option, as a button that says what it does. */}
      {offers && !detailed ? (
        <Btn kind="secondary" icon="ListPlus" title={`Log each ${what}`} onPress={turnOn} style={{ alignSelf: 'flex-start' }} />
      ) : null}

      {table ? (
        <View style={st.thead}>
          <T size={font.label} faint weight={500} align="center" style={st.cSet}>set</T>
          {cols.map((f) => (
            <T key={f} size={font.label} faint weight={500} align="center" style={{ width: meta(f).width }}>{colLabel(f)}</T>
          ))}
        </View>
      ) : null}

      {rows.map((r: any, i: number) => (
        <View key={i}>
          {inTable(r) ? (
            <SwipeRemove label="Remove" onRemove={() => dropSet(i)}>
              <View style={st.row}>
                <T size={font.label} faint tabular align="center" style={st.cSet}>{String(i + 1)}</T>
                {cols.map((f) => (
                  <View key={f}>
                    {/* While the detail is on, the climb list IS the count: shown, not typed. */}
                    {f === 'reps' && Array.isArray(r[CLIMB_FIELD]) ? (
                      <View style={[st.numBox, { width: TAP }]} accessibilityLabel={`set ${i + 1} ${colLabel(f)}`}>
                        <T size={font.input} dim tabular align="center">{String(climbsCounted(r, rows))}</T>
                      </View>
                    ) : (
                      <NumInput
                        value={r[f] ?? ''} onChange={(v: any) => set(i, f, v)} blank=""
                        placeholder={hintRows?.[i]?.[f] != null ? String(hintRows[i][f]) : undefined}
                        placeholderTextColor={colors.inkFaint}
                        accessibilityLabel={`set ${i + 1} ${meta(f).label}`}
                        keyboardAppearance="dark" selectTextOnFocus selectionColor={colors.accent}
                        style={[st.numBox, st.numIn, { width: meta(f).width }]}
                      />
                    )}
                  </View>
                ))}
              </View>
            </SwipeRemove>
          ) : rows.length > 1 ? (
            <T size={font.label} dim style={{ paddingBottom: space[1] }}>{`Set ${i + 1}`}</T>
          ) : null}
          {/* The per-rep grades get their own line under the row. */}
          {perRep && (
            <View style={table ? st.under : null}>
              <GradeLaps count={repCount(r.reps)} values={r[GRADE_FIELD]} what={what} where={`set ${i + 1} `}
                onChange={(list: any) => setList(i, GRADE_FIELD, list)} />
            </View>
          )}
          {Array.isArray(r[CLIMB_FIELD]) && (
            <View style={table ? st.under : null}>{climbList(r, i)}</View>
          )}
        </View>
      ))}

      {detailed ? <Btn kind="quiet" title="Count only" onPress={askOff} style={{ alignSelf: 'flex-start' }} /> : null}

      <View style={st.foot}>
        {/* A day of routes is one list (#111, E F2): a card that says `addSets: false`
            has Add route and no second door that starts "Set 2" at route 1. */}
        {exercise.addSets !== false ? <Btn kind="secondary" icon="Plus" title="Add set" onPress={addSet} /> : null}
        {/* Off the number row on purpose: the set comes back with Undo. */}
        {/* Any set, picked from a system sheet (the web asks in its foot, #97 F9d);
            the swipe on a row does the same. Every removal comes back with Undo. */}
        {rows.length > 1 ? (
          <Btn kind="quiet" title="Remove a set" onPress={() => showMenu(
            rows.map((_: any, i: number) => ({ label: `Set ${i + 1}`, destructive: true, onPress: () => dropSet(i) })),
            { title: 'Which set?' },
          )} />
        ) : null}
      </View>
      <T size={font.label} faint tabular>
        {(table ? `${rows.length} set${rows.length === 1 ? '' : 's'}${total ? ` · ${total} ${noun}` : ''}` : `${total} ${noun}`)
          + `${sent > 0 ? ` · ${sent} sent` : ''}`
          + `${falls > 0 ? ` · fell on ${falls}` : ''}`
          + `${downs > 0 ? ` · ${downs} down-climbed` : ''}`
          + `${lengths > total ? ` · ${lengths} lengths` : ''}`}
      </T>
    </View>
  )
}

/**
 * Does the plan put a number in any of these boxes? Only then does the log say it
 * was pre-filled (#97 review): a card with no defaults (the starter's climbing
 * cards) opened on an empty box under a line saying it was filled in from the plan.
 */
export const prefilledBy = (spec: any) => (spec?.exercises || []).some((ex: any) =>
  (ex.fields || []).some((f: string) => ex.defaults?.[f] !== undefined && ex.defaults[f] !== null && ex.defaults[f] !== ''))

export function SetLog({ session, out, onSave, hints = null }: any) {
  const spec = session?.logSpec
  if (!spec?.exercises?.length) return null

  const stored = out.sets || {}
  const signs = out.signs || {}

  const rowsFor = (ex: any) => stored[ex.key] ?? seedSets(ex)
  const signFor = (ex: any) => signs[ex.key] ?? ex.defaults?.sign ?? '+'

  const setRows = (ex: any, rows: any) => onSave({ ...out, sets: { ...stored, [ex.key]: rows } })
  const setSign = (ex: any, sign: string) => onSave({ ...out, signs: { ...signs, [ex.key]: sign } })

  return (
    <View style={{ gap: space[4] }}>
      {spec.exercises.map((ex: any) => (
        <Exercise
          key={ex.key}
          exercise={ex}
          rows={rowsFor(ex)}
          // Someone else's copy of a shared workout: the owner's rows as placeholders only.
          hintRows={hints?.sets?.[ex.key] || null}
          sign={signFor(ex)}
          onRows={(rows: any) => setRows(ex, rows)}
          onSign={(s: string) => setSign(ex, s)}
        />
      ))}
      {prefilledBy(spec) ? (
        <Explain><T size={font.caption} faint>Pre-filled from the plan: change what didn't match, and add a set if you did more.</T></Explain>
      ) : null}
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

/** Total completed reps across every exercise; a row with the detail on counts what it counts (#97). */
export function totalReps(out: any): number {
  return (Object.values(out?.sets || {}) as any[])
    .reduce((s: number, rows: any) => s + (Array.isArray(rows) ? rows : [])
      .reduce((n: number, r: any) => n + (Array.isArray(r?.[CLIMB_FIELD]) ? climbsCounted(r, rows) : (Number(r?.reps) || 0)), 0), 0)
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
  head: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
  signtog: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill,
    paddingHorizontal: space[3], minHeight: TAP, justifyContent: 'center',
  },
  thead: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingBottom: space[1] },
  cSet: { width: 22 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[1], backgroundColor: colors.panel },
  numBox: {
    minHeight: TAP, borderRadius: radius.control, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel2,
    justifyContent: 'center', paddingHorizontal: space[2],
  },
  numIn: { color: colors.ink, fontSize: font.input, textAlign: 'center', fontVariant: ['tabular-nums'], paddingVertical: space[2] },
  under: { paddingLeft: space[8], paddingRight: space[1] },
  repstep: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  repstepB: {
    minWidth: TAP, minHeight: TAP, borderRadius: radius.control, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center',
  },
  gradelaps: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space[3], rowGap: space[2], paddingTop: 2, paddingBottom: space[2] },
  gradelap: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  select: {
    flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: TAP, paddingHorizontal: space[2],
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: radius.control,
  },
  climblog: { gap: space[2], paddingTop: space[1], paddingBottom: space[2] },
  climbRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
  // A climb already described: one readable row, a tap opens it again.
  done: {
    flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: TAP, paddingHorizontal: space[2],
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: radius.control,
  },
  // The current climb: grade and how it went, then Details, then the next one.
  edit: {
    gap: space[2], padding: space[3], borderWidth: 1, borderColor: colors.lineStrong,
    borderRadius: radius.control, backgroundColor: colors.panel,
  },
  outcomes: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  felt: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingLeft: 2 },
  slider: { height: TAP, justifyContent: 'center', flexGrow: 1 },
  track: { position: 'absolute', height: 6, borderRadius: radius.mark, backgroundColor: colors.panel2, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: colors.accent },
  thumb: {
    position: 'absolute', width: 26, height: 26, borderRadius: radius.card, backgroundColor: colors.ink,
    borderWidth: 3, borderColor: colors.bg,
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 3, shadowOffset: { width: 0, height: 1 },
  },
  thumbUnset: { backgroundColor: colors.panel3, borderWidth: 2, borderColor: colors.inkFaint, shadowOpacity: 0 },
  // Add and remove sit under the rows, never beside a box being typed in.
  foot: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap', marginTop: space[1] },
})
