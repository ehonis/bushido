/*
 * The route-grade ladder — one place, because a grade typed as a decimal is a
 * grade entered wrong.
 *
 * Until now "route grade" was a free number field labelled "5.x — enter 10.4 for
 * 5.10d", which asks them to encode a grade mid-session on a phone with chalky
 * hands, and silently accepts 10.7 and 5.10 and 104. It is a fixed, ordered set
 * of rungs, so it is a picker.
 *
 * THE RUNGS are 5.7 to 5.12, each with a − and a + modifier, and nothing outside
 * that range — the gym's own ladder tops out at 5.12+ and the block's working
 * routes are 5.10s. The endpoints carry no modifier that would leave the stated
 * range, so the ladder starts at 5.7 and ends at 5.12: sixteen rungs.
 *
 * THE STORED VALUE stays a number, `base.tenth`, with 1 = minus, 2 = plain,
 * 3 = plus — so 5.10− is 10.1 and 5.10 is 10.2, a common shorthand for
 * modifier grades. Storing the number rather than the label keeps every
 * logged grade sortable and comparable with no parsing, and keeps old entries
 * readable. Note this REDEFINES the tenths: the previous label said 10.4 meant
 * 5.10d, so a hand-written value with a 4 in the tenths is off-ladder now. It is
 * shown as the raw number the user typed rather than relabelled as something else, and
 * nothing rounds it onto a rung — see `gradeLabel`.
 *
 * THE AXIS IS ORDINAL. Charts plot `gradeIndex`, the rung's position on the
 * ladder, not the stored decimal: the gap between 5.10 and 5.10+ is a rung, not
 * a distance, and a decimal y-axis invites reading 10.3 − 10.1 as "0.2 of a
 * grade". It also means no noise band belongs on a grade chart — nothing here
 * was measured.
 */

const MODS = [
  { tenth: 1, suffix: '−' },
  { tenth: 2, suffix: '' },
  { tenth: 3, suffix: '+' },
]

/** The lowest and highest whole grade offered. */
export const GRADE_LOW = 7
export const GRADE_HIGH = 12

/**
 * Every rung, easiest first: `{ value, label }`.
 *
 * Values are parsed from their own string rather than computed as
 * `base + tenth / 10`, so a rung is bit-identical to what a `<select>` hands
 * back through `Number(e.target.value)` and `===` can be trusted.
 */
export const GRADES = (() => {
  const out = []
  for (let base = GRADE_LOW; base <= GRADE_HIGH; base++) {
    for (const { tenth, suffix } of MODS) {
      if (base === GRADE_LOW && tenth === 1) continue
      if (base === GRADE_HIGH && tenth === 3) continue
      out.push({ value: Number(`${base}.${tenth}`), label: `5.${base}${suffix}` })
    }
  }
  return out
})()

/** A finite number, or null. Absent is not zero, and 5.0 is not a grade. */
const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Where `value` sits on the ladder, or −1 if it is not a rung. */
export function gradeIndex(value) {
  const n = num(value)
  if (n == null) return -1
  return GRADES.findIndex(g => g.value === n)
}

/** The label for a rung's POSITION — what a chart's y-axis wants. '' off-ladder. */
export const rungLabel = (index) => GRADES[Number(index)]?.label ?? ''

/**
 * "5.10−" for a stored value.
 *
 * An off-ladder number comes back as itself, never rounded to the nearest rung:
 * this is a training log, and a 10.45 nobody can explain is information, while a
 * 10.45 quietly displayed as "5.10" is a lie about what was climbed.
 */
export function gradeLabel(value) {
  const n = num(value)
  if (n == null) return ''
  const i = gradeIndex(n)
  return i >= 0 ? GRADES[i].label : String(n)
}

/** Is this a rung of the ladder? */
export const isGrade = (value) => gradeIndex(value) >= 0

/* --------------------------------------------------------------- V ladder --- */

/*
 * The boulder ladder: V0 to V10, stored as the plain integer — the same number
 * the fun-boulder card's "hardest (V)" field has always taken, so the two are
 * directly comparable. It lives here so this file stays the only place a grade
 * scale is defined. V is already ordinal-by-integer, so unlike the route ladder
 * its stored value IS its chart position and needs no index step.
 */
export const VGRADES = Array.from({ length: 11 }, (_, v) => ({ value: v, label: `V${v}` }))

/** "V4" for a stored value. Off-ladder comes back raw, never rounded — see gradeLabel. */
export function vLabel(value) {
  const n = num(value)
  if (n == null) return ''
  return VGRADES.some(g => g.value === n) ? `V${n}` : String(n)
}

/** The V axis formatter: a tick between rungs loses its label, not gains a grade. */
export const vRungLabel = (value) => (VGRADES.some(g => g.value === Number(value)) ? `V${value}` : '')

/** The hardest grade in a list, or null if it holds none. */
export function hardestGrade(list) {
  const vals = (list || []).map(num).filter(v => v != null)
  return vals.length ? Math.max(...vals) : null
}

/* ------------------------------------------------------------- per-rep lists */

/*
 * PER-REP FIELDS.
 *
 * Every other logged field is one number per SET, which is right for load and
 * for a rep count. A grade is not: one set of doubled lead laps is two laps, and
 * "5.10− then 5.10" is the honest record of a set where the user stepped up mid-double.
 * So `grades` stores an ARRAY per row, one entry per rep, and its length is kept
 * equal to that row's `reps` — the rep count is the thing that says how many
 * grades there are, and two sources of truth for "how many laps" is a log that
 * disagrees with itself.
 *
 * Everything downstream still sees an ordinary `out.sets` row, so the history
 * editor, workout mode and the charts need no idea this field is a list.
 */
export const GRADE_FIELD = 'grades'

/** Does this logSpec exercise record a grade per rep? */
export const hasGrades = (fields) => (fields || []).includes(GRADE_FIELD)

/** How many rep pickers a row shows: at least one, so a blank reps cell can still be filled in. */
export function repCount(reps) {
  const n = Number(reps)
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 20) : 1
}

/**
 * A grade list resized to the row's rep count.
 *
 * Dropping a rep drops its grade, because leaving a hidden one behind means a
 * set that logs two laps and charts three. Growing pads with blanks.
 */
export function fitGrades(list, reps) {
  const arr = Array.isArray(list) ? list : []
  return Array.from({ length: repCount(reps) }, (_, i) => arr[i] ?? '')
}

/** Every per-rep grade across a list of set rows, in the order they were climbed. */
export function gradesIn(rows) {
  return (rows || []).flatMap(r => (Array.isArray(r?.[GRADE_FIELD]) ? r[GRADE_FIELD] : []))
}

/* --------------------------------------------------------- per-climb detail */

/*
 * THE FUN DAYS' OPTIONAL DETAIL.
 *
 * The fun cards log one honest number — how many things you climbed — because a
 * protocol would ruin them. But some nights the user wants the full story per
 * climb: what grade it was, whether the user fell on it, whether it felt honest for
 * the grade, and what KIND of climbing it was (a 5.10 slab and a 5.10 roof are
 * different achievements). That is per-rep data again, so it reuses the grades
 * machinery: `climbs` is a second list field, one RECORD per rep rather than
 * one number, and its length follows the row's rep count the same way.
 *
 * It is opt-in per session — the plan declares that an exercise CAN log it
 * (`logSpec.exercises[].climbLog`), and a toggle in the set log turns it on for
 * one entry. Off is the default, because ten selects you scroll past is how a
 * twenty-second form stops being filled in. Presence of the list IS the state:
 * toggling off strips it, for the same reason dropping a rep drops its grade —
 * hidden data that still charts is a log that disagrees with itself.
 */
export const CLIMB_FIELD = 'climbs'

/** Does the plan offer per-climb detail on this exercise? */
export const offersClimbs = (exercise) => Boolean(exercise?.climbLog)

/** Is per-climb detail switched on for these rows? */
export const climbsOn = (rows) => (rows || []).some(r => Array.isArray(r?.[CLIMB_FIELD]))

/*
 * DOWN-CLIMBING, on the cards where it is a real thing to do.
 *
 * For the route sessions specifically: a lap climbed AND down-climbed is
 * effectively double the value, and a lap that was ONLY a down-climb is a thing
 * too — climbing a 5.10 and then down-climbing the 5.8 next to it rather than
 * lowering off, for example. Three states, so:
 *
 *   ''      the user went up it, which is what climbing a route normally means
 *   'both'  up and back down — two lengths of the wall, one route
 *   'only'  down-climbed, not climbed up
 *
 * Blank is the default and is the same shape every climb record already had, so
 * nothing logged before this reads as anything other than "the user climbed it".
 *
 * Offered per session by the plan (`climbLog.downClimb`), not everywhere: you
 * down-climb a route, and the boulder cards would be carrying a picker for
 * something nobody does on a 12-move problem.
 */
export const DOWN_OPTIONS = [
  { value: '', label: 'climbed up' },
  { value: 'both', label: 'up + down' },
  { value: 'only', label: 'down only' },
]

/** The words for a stored value, or '' for the ordinary case. */
export const downLabel = (v) => DOWN_OPTIONS.find(o => o.value === v && o.value)?.label || ''

/** A climb nobody has said anything about yet. `felt` blank is unanswered, not "spot on". */
export const blankClimb = () => ({ grade: '', fell: false, felt: '', style: '', down: '' })

/** The climb list resized to the row's rep count — same rule as fitGrades. */
export function fitClimbs(list, reps) {
  const arr = Array.isArray(list) ? list : []
  return Array.from({ length: repCount(reps) }, (_, i) =>
    (arr[i] && typeof arr[i] === 'object' ? { ...blankClimb(), ...arr[i] } : blankClimb()))
}

/*
 * One more / one fewer climb, keeping everything already said.
 *
 * While the detail is on, the climb list is the source of truth and `reps` is
 * derived from it — the reps box is read-only and these steppers are the only
 * way the count moves. This exists because the first release kept the typed
 * number in charge, and typing "12" over a 10 passes through "1" on the way:
 * each keystroke refit the list, so correcting the count mid-session DELETED
 * the climbs already filled in. A step moves
 * the count by one, visibly, so nothing can vanish that was not on screen.
 */
export function stepClimbs(row, delta) {
  const next = Math.min(20, Math.max(1, repCount(row?.reps) + delta))
  return { ...row, reps: next, [CLIMB_FIELD]: fitClimbs(row?.[CLIMB_FIELD], next) }
}

/** Every climb record across a list of set rows, in the order they were climbed. */
export function climbsIn(rows) {
  return (rows || [])
    .flatMap(r => (Array.isArray(r?.[CLIMB_FIELD]) ? r[CLIMB_FIELD] : []))
    .filter(c => c && typeof c === 'object')
}

/** The hardest per-climb grade across a session's rows, or null if none was given. */
export const hardestClimbed = (rows) => hardestGrade(climbsIn(rows).map(c => c.grade))

/** How many climbs the user fell on. */
export const fallsIn = (rows) => climbsIn(rows).filter(c => c.fell === true).length

/** How many of them involved a down-climb, either way round. */
export const downsIn = (rows) => climbsIn(rows).filter(c => c.down === 'both' || c.down === 'only').length

/**
 * LENGTHS of wall covered, which is what a down-climb changes.
 *
 * One length is one trip up or down. An ordinary lap is one; a lap climbed and
 * down-climbed is two; a pure down-climb is one. Reps that carry no climb record
 * count as one each, so a session with the detail switched off — or switched on
 * halfway through — reads exactly as its rep count rather than dropping the laps
 * the user did not describe.
 *
 * Deliberately NOT `reps`. The rep count is how many climbs the user did and the climb
 * list follows it; lengths is how much climbing that was. Merging them would put
 * the list out of step with the count the first time the user down-climbed anything.
 */
export function lengthsIn(rows) {
  return (rows || []).reduce((sum, r) => {
    const n = repCount(r?.reps)
    const list = Array.isArray(r?.[CLIMB_FIELD]) ? r[CLIMB_FIELD] : []
    const extra = list.filter(c => c?.down === 'both').length
    return sum + n + extra
  }, 0)
}

/*
 * "How honest was the grade" — a five-point scale centred on spot-on, stored as
 * −2..+2. Blank means the user did not say, and must never be displayed as "spot on":
 * an unanswered question recorded as an answer is exactly the pre-filled-150
 * problem the time-spent field exists to avoid.
 */
export const FELT_MIN = -2
export const FELT_MAX = 2
const FELT_WORDS = ['soft for the grade', 'a touch soft', 'spot on', 'a touch stiff', 'sandbagged']

/** The words for a felt value, or '' when the user did not say. */
export function feltLabel(value) {
  const n = num(value)
  if (n == null) return ''
  return FELT_WORDS[Math.round(n) - FELT_MIN] ?? String(n)
}
