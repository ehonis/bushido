/*
 * Climbing grades: the only grade scales in the app, and how a grade is stored.
 *
 * A grade typed as a decimal is a grade entered wrong, so every grade is picked
 * off a fixed ladder. The STORED VALUE is a number, because a number sorts and
 * compares with no parsing; the label is derived. THIS IS A DATA CONTRACT
 * (AGENTS.md §6.4, "Grades"): every value ever stored must read back exactly as it
 * did, so the encodings below only ever gain values, never change one.
 *
 * ROUTES (YDS), two ways of writing the same ladder, because gyms do both:
 *
 *   plus/minus  `base.tenth`, 1 = minus, 2 = plain, 3 = plus. 5.10− is 10.1,
 *               5.10 is 10.2, 5.10+ is 10.3. The original encoding, unchanged.
 *   letters     `base.x5`: a = .05, b = .15, c = .25, d = .35. 5.10a is 10.05,
 *               5.11b is 11.15. Only from 5.10 up, where letters exist.
 *
 * The two INTERLEAVE in numeric order, which is the point of picking those
 * hundredths: 5.10a (10.05) < 5.10− (10.1) < 5.10b (10.15) < 5.10 (10.2) <
 * 5.10c (10.25) < 5.10+ (10.3) < 5.10d (10.35) < 5.11a (11.05). So `hardestGrade`
 * is still Math.max over a mixed log, and a minus sits between a and b exactly as
 * gyms mean it. A hundredth ending in 5 is a letter; one tenth digit is a modifier;
 * nothing else is a rung. A hand-written value outside both (a 10.4 from the days
 * the label said "enter 10.4 for 5.10d", an integer typed before there was a
 * ladder) is OFF-LADDER: shown as the raw number, never rounded onto a rung, and
 * never plotted as one (see `gradeLabel`, `gradeIndex`).
 *
 * The ladder runs 5.5 to 5.15. The ends carry no modifier that would leave it
 * (no 5.5−, no 5.15+). Which way a picker WRITES (letters or plus/minus) is the
 * climber's choice (`routeSystem`), a device setting; whichever it is, a value
 * written the other way keeps its own label and its own option in the picker.
 *
 * BOULDERS (V) are the plain integer, V0 to V17: the same number the boulder
 * cards' "hardest" field has always taken. V is ordinal by integer, so its stored
 * value is its chart position.
 *
 * WHICH ladder a number is on is said by the FIELD it is in (an exercise's
 * `climbLog.scale`, a per-rep `grades` list, a `type: "grade"` output), never
 * guessed from the number: V8 and 5.8 are both near 8. See `climbsOf`.
 *
 * THE AXIS IS ORDINAL. Route charts plot `gradeIndex`, the rung's position on the
 * full ladder, not the stored decimal: the gap between 5.10 and 5.10+ is a rung,
 * not a distance, and no noise band belongs on a grade chart, because nothing here
 * was measured.
 */

const MODS = [
  { frac: '1', suffix: '−' },
  { frac: '2', suffix: '' },
  { frac: '3', suffix: '+' },
]
const LETTERS = [
  { frac: '05', suffix: 'a' },
  { frac: '15', suffix: 'b' },
  { frac: '25', suffix: 'c' },
  { frac: '35', suffix: 'd' },
]

/** The lowest and highest whole route grade offered, and where letters begin. */
export const GRADE_LOW = 5
export const GRADE_HIGH = 15
export const LETTERS_FROM = 10

/*
 * Values are parsed from their own string rather than computed as
 * `base + tenth / 10`, so a rung is bit-identical to what a picker hands back
 * through `Number(e.target.value)` and `===` can be trusted.
 */
const rung = (base, { frac, suffix }, system) =>
  ({ value: Number(`${base}.${frac}`), label: `5.${base}${suffix}`, base, system })

/** Every route rung, both ways of writing it, easiest first. The chart axis. */
export const ROUTE_GRADES = (() => {
  const out = []
  for (let base = GRADE_LOW; base <= GRADE_HIGH; base++) {
    for (const m of MODS) {
      if (base === GRADE_LOW && m.suffix === '−') continue
      if (base === GRADE_HIGH && m.suffix === '+') continue
      out.push(rung(base, m, m.suffix ? 'pm' : 'plain'))
    }
    if (base >= LETTERS_FROM) for (const l of LETTERS) out.push(rung(base, l, 'letters'))
  }
  return out.sort((a, b) => a.value - b.value)
})()

/** The two ways a route picker can write, in the order a switch offers them. */
export const ROUTE_SYSTEMS = [
  { key: 'pm', label: '5.10+', name: 'Plus and minus' },
  { key: 'letters', label: '5.10a', name: 'Letters' },
]

/**
 * The rungs a route picker offers. Plus/minus: 5.5 to 5.15 with − and +. Letters:
 * 5.5 to 5.9 plain, then 5.10a to 5.15d. Easiest first.
 */
export function routeLadder(system = 'pm') {
  return system === 'letters'
    ? ROUTE_GRADES.filter(g => g.system === 'letters' || (g.system === 'plain' && g.base < LETTERS_FROM))
    : ROUTE_GRADES.filter(g => g.system !== 'letters')
}

/** The plus/minus ladder, the one the app has always offered (now 5.5 to 5.15). */
export const GRADES = routeLadder('pm')

/** A finite number, or null. Absent is not zero, and 5.0 is not a grade. */
const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Where `value` sits on the full route ladder, or −1 if it is not a rung. */
export function gradeIndex(value) {
  const n = num(value)
  if (n == null) return -1
  return ROUTE_GRADES.findIndex(g => g.value === n)
}

/** The label for a rung's POSITION — what a chart's y-axis wants. '' off-ladder. */
export const rungLabel = (index) => (Number.isInteger(Number(index)) ? ROUTE_GRADES[Number(index)]?.label ?? '' : '')

/**
 * "5.10−" or "5.10a" for a stored value.
 *
 * An off-ladder number comes back as itself, never rounded to the nearest rung:
 * this is a training log, and a 10.45 nobody can explain is information, while a
 * 10.45 quietly displayed as "5.10" is a lie about what was climbed.
 */
export function gradeLabel(value) {
  const n = num(value)
  if (n == null) return ''
  const i = gradeIndex(n)
  return i >= 0 ? ROUTE_GRADES[i].label : String(n)
}

/** Is this a rung of the route ladder (either way of writing it)? */
export const isGrade = (value) => gradeIndex(value) >= 0

/** 'letters', 'pm' or 'plain' for a route rung; null off-ladder. */
export const gradeSystemOf = (value) => ROUTE_GRADES[gradeIndex(value)]?.system ?? null

/*
 * Which way THIS device's route pickers write. A setting, not a guess: the
 * climber's gym grades one way or the other, and both are on the ladder. Kept
 * on the device (it is how this person reads a wall, not part of the log), and
 * read defensively, because a server render and a test have no localStorage.
 */
const SYSTEM_KEY = 'bushido:route-grades'
export function routeSystem() {
  try {
    const v = globalThis.localStorage?.getItem(SYSTEM_KEY)
    return v === 'letters' ? 'letters' : 'pm'
  } catch { return 'pm' }
}
export function setRouteSystem(system) {
  try { globalThis.localStorage?.setItem(SYSTEM_KEY, system === 'letters' ? 'letters' : 'pm') } catch { /* nothing to keep it in */ }
}

/**
 * The ladder a route CHART is drawn on: the one its values are written on. A log
 * kept in plus/minus gets an axis of 5.10−, 5.10, 5.10+, not of the letter rungs
 * between them it never used; one kept in letters gets letters; a log written
 * both ways gets the full ladder, where both sit in order. Ordinal either way.
 */
export function axisLadder(values) {
  const on = (values || []).filter(v => isGrade(v))
  for (const system of ['pm', 'letters']) {
    const ladder = routeLadder(system)
    if (on.every(v => ladder.some(g => g.value === num(v)))) return ladder
  }
  return ROUTE_GRADES
}

/** A value's position on a given ladder, −1 off it. */
export const indexOn = (ladder, value) => { const n = num(value); return n === null ? -1 : ladder.findIndex(g => g.value === n) }

/* --------------------------------------------------------------- V ladder --- */

/** V0 to V17, stored as the plain integer. */
export const V_HIGH = 17
export const VGRADES = Array.from({ length: V_HIGH + 1 }, (_, v) => ({ value: v, label: `V${v}` }))

/** "V4" for a stored value. Off-ladder comes back raw, never rounded — see gradeLabel. */
export function vLabel(value) {
  const n = num(value)
  if (n == null) return ''
  return VGRADES.some(g => g.value === n) ? `V${n}` : String(n)
}

/** Is this a rung of the V ladder? */
/**
 * A grade someone typed as text ("5.11b", "5.10-", "V5"), read off the ladder
 * the FIELD names (`scale`), for display only (#98: the profile's grades were
 * text boxes; they are pickers now, and what was typed is never rewritten).
 * Exactly a rung's own label, a hyphen read as its minus, or null: nothing is
 * guessed onto a rung.
 */
export function gradeFromText(text, scale) {
  if (typeof text !== 'string') return null
  const t = text.trim().toLowerCase().replace(/\s+/g, '').replace(/-/g, '−')
  if (!t) return null
  const ladder = scale === 'v' ? VGRADES : ROUTE_GRADES
  const hit = ladder.find(g => g.label.toLowerCase() === t)
  return hit ? hit.value : null
}

export const isVGrade = (value) => { const n = num(value); return n !== null && VGRADES.some(g => g.value === n) }

/** The V axis formatter: a tick between rungs loses its label, not gains a grade. */
export const vRungLabel = (value) => (VGRADES.some(g => g.value === Number(value)) ? `V${value}` : '')

/** The hardest grade in a list, or null if it holds none. */
export function hardestGrade(list) {
  const vals = (list || []).map(num).filter(v => v != null)
  return vals.length ? Math.max(...vals) : null
}

/* ------------------------------------------------------------ scale-aware --- */

/**
 * The rungs beside a grade on a ladder, for one-tap picks: one easier, the same,
 * one harder, as `{ step, value, label }` (#97). A grade off this ladder (written
 * the other way, or by hand) offers only itself, labelled by `fmt`; the ends offer
 * what is there.
 */
export function nearRungs(ladder, value, fmt = String) {
  const list = ladder || []
  const at = list.findIndex(g => g.value === Number(value))
  if (at < 0) return [{ step: 0, value: Number(value), label: fmt(Number(value)) }]
  return [-1, 0, 1]
    .map(step => ({ step, rung: list[at + step] }))
    .filter(x => x.rung)
    .map(({ step, rung }) => ({ step, value: rung.value, label: rung.label }))
}

/** The label for a value on a named scale: 'v' is the V ladder, anything else routes. */
export const labelOn = (scale, value) => (scale === 'v' ? vLabel(value) : gradeLabel(value))

/** Is this value a rung of that scale's ladder? Off-ladder values are kept, never plotted. */
export const onLadder = (scale, value) => (scale === 'v' ? isVGrade(value) : isGrade(value))

/**
 * The whole grade a rung belongs to, for grouping: 10 for every 5.10 (a to d, −,
 * plain, +), 4 for V4. Null off-ladder. Letters and plus/minus land in the same
 * band, which is what lets one log written both ways be read as one pyramid.
 */
export function bandOf(scale, value) {
  if (!onLadder(scale, value)) return null
  return scale === 'v' ? num(value) : ROUTE_GRADES[gradeIndex(value)].base
}

/** "5.10" or "V4" for a band. */
export const bandLabel = (scale, band) => (scale === 'v' ? `V${band}` : `5.${band}`)

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

/*
 * How many climbs a row can hold: per-rep grade pickers and climb records alike.
 * It was twenty, and switching the detail on wrote `repCount(25)`, 20, into the
 * count, so describing a session shortened it; a set of 25 laps had 25 climb
 * records and 20 grade pickers. One bound for both, so a lap's grade and its
 * record always pair up. 99 is a sanity bound against a typo, not a session length.
 */
export const MAX_CLIMBS = 99

/** How many rep pickers a row shows: at least one, so a blank reps cell can still be filled in. */
export function repCount(reps) {
  const n = Number(reps)
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), MAX_CLIMBS) : 1
}

/** How many climb records a row holds while each climb is logged (the same bound). */
export function climbCount(reps) {
  const n = Number(reps)
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), MAX_CLIMBS) : 1
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

/**
 * A climb nobody has said anything about yet. `felt` blank is unanswered, not
 * "spot on". There is no `outcome` key until one is picked: a record without one
 * reads as every record before outcomes did (see `outcomeOf`).
 */
export const blankClimb = () => ({ grade: '', fell: false, felt: '', style: '', down: '' })

/** The climb list resized to the row's rep count — same rule as fitGrades. */
export function fitClimbs(list, reps) {
  const arr = Array.isArray(list) ? list : []
  return Array.from({ length: climbCount(reps) }, (_, i) =>
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
  const next = Math.min(MAX_CLIMBS, Math.max(1, climbCount(row?.reps) + delta))
  return { ...row, reps: next, [CLIMB_FIELD]: fitClimbs(row?.[CLIMB_FIELD], next) }
}

/**
 * Switch the per-climb detail on for a row: one record per climb already counted.
 * The count is kept as it was (25 problems stay 25, F8 of the 2026-11-08 grading);
 * only a blank or silly count becomes the one record a list needs.
 */
export function detailOn(row) {
  return { ...row, reps: climbCount(row?.reps), [CLIMB_FIELD]: fitClimbs(row?.[CLIMB_FIELD], row?.reps) }
}

/**
 * Take climb `i` out of a row, and the count with it: while the detail is on the
 * list is the count. The last record left is cleared rather than removed, because
 * a row with the detail on always holds at least one. Undo is `putClimb`.
 */
export function dropClimb(row, i) {
  const list = fitClimbs(row?.[CLIMB_FIELD], row?.reps)
  if (list.length <= 1) return { ...row, reps: 1, [CLIMB_FIELD]: [blankClimb()] }
  const next = list.filter((_, k) => k !== i)
  return { ...row, reps: next.length, [CLIMB_FIELD]: next }
}

/** Put a removed climb back where it was (the Undo of `dropClimb`). */
export function putClimb(row, i, climb) {
  const list = fitClimbs(row?.[CLIMB_FIELD], row?.reps)
  // A lone blank record is the "cleared" state dropClimb leaves: replace it.
  if (list.length === 1 && !climbSaid(list[0])) return { ...row, reps: 1, [CLIMB_FIELD]: [{ ...blankClimb(), ...climb }] }
  const at = Math.max(0, Math.min(i, list.length))
  const next = [...list.slice(0, at), { ...blankClimb(), ...climb }, ...list.slice(at)]
  return { ...row, reps: Math.min(next.length, MAX_CLIMBS), [CLIMB_FIELD]: next.slice(0, MAX_CLIMBS) }
}

/** Has anything been said about this climb? A blank record is not an answer. */
export function climbSaid(c) {
  if (!c || typeof c !== 'object') return false
  return (c.grade !== '' && c.grade != null) || c.fell === true || Boolean(c.outcome) ||
    (c.felt !== '' && c.felt != null) || Boolean(c.style) || Boolean(c.down) || num(c.tries) !== null
}

/** How many climbs in these rows have something said about them — what turning the detail off would lose. */
export const saidIn = (rows) => climbsIn(rows).filter(climbSaid).length

/*
 * WHAT A ROW COUNTS (regrade F1, #97).
 *
 * A count-only row counts its `reps`: the number in the box, typed or left as the
 * plan wrote it, in plain sight and editable. With the per-climb detail on, the
 * box is gone and the number becomes the length of a list of mostly blank
 * records: "Log each problem" over the plan's 10, three problems described, and
 * the night read "10 problems" everywhere while the climber had said three. The
 * blanks are the plan's number standing in, a placeholder (AGENTS.md §6.4), never
 * climbs. So once any climb in a row is DESCRIBED, the described climbs are the
 * row's count; until one is, the row still counts `reps`, exactly as it did with
 * the detail off (switching it on alone says nothing new).
 *
 * A read rule, not a migration: stored rows are read as they are, and every row
 * logged before this whose climbs were all described (every one in the logs
 * this was checked on) reads exactly as before.
 *
 * A lap is described when its record says something, or, on the doubled lead
 * laps that ask a grade per lap, when its grade was picked.
 */
function toldOf(row) {
  const n = climbCount(row?.reps)
  const list = Array.isArray(row?.[CLIMB_FIELD]) ? row[CLIMB_FIELD] : []
  const grades = Array.isArray(row?.[GRADE_FIELD]) ? row[GRADE_FIELD] : []
  const told = []
  for (let k = 0; k < n; k++) {
    if (climbSaid(list[k]) || (grades[k] !== '' && grades[k] != null)) told.push(k)
  }
  return told
}

/** How many climbs this row counts: the described ones once any is, else its count. */
export function climbsCounted(row) {
  const reps = Math.max(0, Math.floor(Number(row?.reps) || 0))
  if (!Array.isArray(row?.[CLIMB_FIELD])) return reps
  const told = toldOf(row).length
  return told > 0 ? told : reps
}

/** Climbs in the row's list nobody has described, while others are: not counted. */
export function untoldIn(row) {
  if (!Array.isArray(row?.[CLIMB_FIELD])) return 0
  const told = toldOf(row).length
  return told > 0 ? climbCount(row?.reps) - told : 0
}

/**
 * The foot of a climbing exercise, in numbers, for both set logs: how many climbs
 * count, how many of those went clean or fell, down-climbs, lengths of wall, and
 * how many listed climbs are waiting to be described (and so do not count).
 */
export function climbTotals(rows) {
  const list = rows || []
  const count = list.reduce((s, r) => s + climbsCounted(r), 0)
  const said = climbsIn(list).filter(climbSaid)
  return {
    count,
    sent: said.filter(isClean).length,
    falls: fallsIn(list),
    downs: downsIn(list),
    lengths: lengthsIn(list),
    untold: list.reduce((s, r) => s + untoldIn(r), 0),
  }
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
export const fallsIn = (rows) => climbsIn(rows).filter(c => outcomeOf(c) === 'fell').length

/** How many of them involved a down-climb, either way round. */
export const downsIn = (rows) => climbsIn(rows).filter(c => c.down === 'both' || c.down === 'only').length

/**
 * LENGTHS of wall covered, which is what a down-climb changes.
 *
 * One length is one trip up or down. An ordinary lap is one; a lap climbed and
 * down-climbed is two; a pure down-climb is one. The laps are the row's COUNTED
 * climbs (`climbsCounted`): with the detail off, its rep count; with it on, the
 * climbs described, once any is, since the blank records after them are the
 * plan's number standing in, not laps.
 *
 * Deliberately NOT `reps`. The rep count is how many climbs the user did and the climb
 * list follows it; lengths is how much climbing that was. Merging them would put
 * the list out of step with the count the first time the user down-climbed anything.
 */
export function lengthsIn(rows) {
  return (rows || []).reduce((sum, r) => {
    const n = climbsCounted(r)
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

/* ---------------------------------------------------------------- outcomes */

/*
 * HOW A CLIMB WENT, one tap per climb (D12, issue #81).
 *
 *   onsight  first go, nothing known about it (routes only: on a boulder a
 *            first-go send is a flash, beta or not)
 *   flash    first go
 *   send     topped it, after goes
 *   fell     did not top it
 *
 * Stored as `outcome` on the climb record, beside the `fell` flag the record has
 * always had, which is kept equal to `outcome === 'fell'` so an older app reads a
 * new record correctly. A record WITHOUT an outcome (every record before #81, and
 * a new one nobody tapped an outcome on) reads exactly as before: fell if `fell`
 * is true, otherwise climbed. That is what the old form meant, a "fell" chip left
 * off; reading it as anything else would rewrite history.
 *
 * `tries` is how many goes it took (optional, a whole number).
 */
export const OUTCOMES = [
  { value: 'onsight', label: 'Onsight', routesOnly: true },
  { value: 'flash', label: 'Flash' },
  { value: 'send', label: 'Sent' },
  { value: 'fell', label: 'Fell' },
]
const CLEAN = new Set(['onsight', 'flash', 'send'])

/** The outcomes a scale offers: no onsight on a boulder. */
export const outcomesFor = (scale) => OUTCOMES.filter(o => !(o.routesOnly && scale === 'v'))

/** What happened on a climb: an outcome value, or '' when nothing was said. */
export function outcomeOf(c) {
  if (!c || typeof c !== 'object') return ''
  if (OUTCOMES.some(o => o.value === c.outcome)) return c.outcome
  return c.fell === true ? 'fell' : ''
}

/** The record with an outcome picked, or cleared with null. Keeps `fell` in step. */
export function withOutcome(c, outcome) {
  const { outcome: _was, ...rest } = c || {}
  if (!outcome) return { ...blankClimb(), ...rest, fell: false }
  return { ...blankClimb(), ...rest, outcome, fell: outcome === 'fell' }
}

/** The words for an outcome value. */
export const outcomeLabel = (v) => OUTCOMES.find(o => o.value === v)?.label || ''

/**
 * Did this climb go clean: topped, going up? An explicit send, or (no outcome
 * said) not a fall and not a down-climb only. A pure down-climb is climbing, but
 * it is not a send of the route.
 */
export function isClean(c) {
  if (!c || typeof c !== 'object') return false
  if (c.down === 'only') return false
  const o = outcomeOf(c)
  return o ? CLEAN.has(o) : true
}

/** Goes taken on a climb: what was said, else one. */
export const triesOf = (c) => { const n = num(c?.tries); return n !== null && n >= 1 ? Math.floor(n) : 1 }

/* ------------------------------------------------- reading a session's climbs */

const exercisesOf = (opt) => opt?.logSpec?.exercises || []

/**
 * Which ladder an exercise's grades are on: 'v', 'yds', or null for an exercise
 * that does not grade what it logs. Declared by the plan (`climbLog.scale`), and a
 * per-rep `grades` list is always the route ladder, which is the only one its
 * picker has offered. Never guessed from the number.
 */
export function scaleOfExercise(ex) {
  if (ex?.climbLog?.scale === 'v') return 'v'
  if (ex?.climbLog || hasGrades(ex?.fields)) return 'yds'
  return null
}

/** Does this exercise count climbs (routes, problems, laps), not hangs or reps of a drill? */
export const countsClimbs = (ex) => scaleOfExercise(ex) !== null

/**
 * The ladder a session-level output is on, or null: `scale` if the output says,
 * a `type: "grade"` field is the route picker, and `hardest` on a card is the
 * boulder cards' V number (the key every boulder card has used for it).
 */
export function scaleOfOutput(f) {
  if (f?.scale === 'v' || f?.scale === 'yds') return f.scale
  if (f?.type === 'grade') return 'yds'
  if (f?.key === 'hardest') return 'v'
  return null
}

/**
 * Every climb a logged session recorded, one record per climb:
 * `{ scale, grade, outcome, clean, tries, exercise }`, `grade` null when none was
 * picked. Reads both list shapes: per-climb `climbs` records, and the per-rep
 * `grades` list the doubled lead laps log (a lap's grade is `grades[i]`, its
 * outcome the matching climb record when the detail is on too). The scale is the
 * exercise's own declaration; an exercise the plan no longer has is skipped
 * rather than guessed. Count-only rows add nothing here: their climbs were not
 * described (see `climbVolume`).
 */
export function climbsOf(opt, out) {
  const found = []
  for (const ex of exercisesOf(opt)) {
    const scale = scaleOfExercise(ex)
    const rows = out?.sets?.[ex.key]
    if (!scale || !Array.isArray(rows)) continue
    const perRep = hasGrades(ex.fields)
    for (const r of rows) {
      const grades = perRep && Array.isArray(r?.[GRADE_FIELD]) ? r[GRADE_FIELD] : []
      const list = Array.isArray(r?.[CLIMB_FIELD]) ? r[CLIMB_FIELD] : []
      const n = Math.max(grades.length, list.length)
      for (let i = 0; i < n; i++) {
        const c = list[i] && typeof list[i] === 'object' ? list[i] : {}
        found.push({
          scale,
          grade: num(perRep ? grades[i] : c.grade),
          outcome: outcomeOf(c),
          clean: isClean(c),
          tries: triesOf(c),
          exercise: ex.key,
        })
      }
    }
  }
  return found
}

/** The session-level grades a card asks for (its "hardest" fields), as `{ scale, grade }`. */
export function sessionGradesOf(opt, out) {
  return (opt?.outputs || [])
    .map(f => ({ scale: scaleOfOutput(f), grade: num(out?.[f.key]) }))
    .filter(g => g.scale && g.grade !== null)
}

/**
 * How many climbs a session was: what every climbing exercise's rows COUNT
 * (`climbsCounted`: the count, or the described climbs once the detail has any).
 * The same number the set log's foot shows.
 */
export function climbVolume(opt, out) {
  let n = 0
  for (const ex of exercisesOf(opt)) {
    if (!countsClimbs(ex)) continue
    for (const r of out?.sets?.[ex.key] || []) n += climbsCounted(r)
  }
  return n
}

/*
 * DESCRIBED CLIMBS WIN. A session that graded its climbs one by one says, for
 * each, whether it went; the card's own "hardest" field is one number typed for
 * the whole evening, and on a night with detail it is usually the hardest thing
 * TRIED (a 5.11+ fallen off, typed as "hardest 5.11+"). So the field counts only
 * on a ladder the session described no graded climb on: then it is all there is,
 * and it is read as what it says, the hardest climbed. The pyramid
 * (metrics.js `pyramidOf`) reads it the same way.
 */
const graded = (opt, out, scale) => climbsOf(opt, out).filter(c => c.scale === scale && onLadder(scale, c.grade))
const typedHardest = (opt, out, scale) =>
  sessionGradesOf(opt, out).filter(g => g.scale === scale && onLadder(scale, g.grade)).map(g => g.grade)
const most = (vals) => (vals.length ? Math.max(...vals) : null)

/**
 * The hardest CLEAN grade a session holds on one scale, on the ladder only: the
 * hardest described climb that went clean, or, with no graded climb on that
 * ladder, the card's own "hardest" field. Null when nothing on it went clean.
 */
export function hardestSent(opt, out, scale) {
  const climbs = graded(opt, out, scale)
  return climbs.length ? most(climbs.filter(c => c.clean).map(c => c.grade)) : most(typedHardest(opt, out, scale))
}

/** The hardest grade TRIED on one scale (sent or not), on the ladder only; same rule. */
export function hardestTried(opt, out, scale) {
  const climbs = graded(opt, out, scale)
  return climbs.length ? most(climbs.map(c => c.grade)) : most(typedHardest(opt, out, scale))
}

/**
 * Is a card's typed "hardest" field moot here: the session graded climbs on its
 * ladder, so every reader takes those instead (`hardestSent`, the pyramid)? The
 * form then leaves it out (#97, F9b): under a list of described climbs it was a
 * second answer to the question the list answers, and it was ignored anyway. Its
 * stored value is kept and comes back with the field if the detail goes.
 */
export function mootHardest(opt, out, f) {
  const scale = scaleOfOutput(f)
  return Boolean(scale) && graded(opt, out, scale).length > 0
}

/** The grade bands (whole grades) a session touched, as `"v:4"` / `"yds:10"` keys. */
export function bandsOf(opt, out) {
  const keys = new Set()
  for (const c of [...climbsOf(opt, out), ...sessionGradesOf(opt, out)]) {
    const b = bandOf(c.scale, c.grade)
    if (b !== null) keys.add(`${c.scale}:${b}`)
  }
  return [...keys]
}

const plural = (word, n) => (n === 1 ? word : /(s|sh|ch|x)$/.test(word) ? `${word}es` : `${word}s`)

/**
 * The one line a climbing session reads as in a list: "8 routes · hardest 5.10+".
 * The count is the session's climbs, named as the plan names them; the grade is
 * the hardest that went clean, or, when nothing did, the hardest tried, said as
 * such. Empty when the session counted no climbs and graded none (a hangboard day).
 */
export function climbLine(opt, out) {
  const climbing = exercisesOf(opt).filter(countsClimbs)
  const n = climbVolume(opt, out)
  const bits = []
  if (n > 0) {
    const names = [...new Set(climbing.filter(ex => (out?.sets?.[ex.key] || []).length).map(ex => ex.repName || 'climb'))]
    bits.push(`${n} ${names.length === 1 ? plural(names[0], n) : plural('climb', n)}`)
  }
  for (const scale of ['yds', 'v']) {
    const sent = hardestSent(opt, out, scale)
    if (sent !== null) { bits.push(`hardest ${labelOn(scale, sent)}`); continue }
    const tried = hardestTried(opt, out, scale)
    if (tried !== null) bits.push(`tried ${labelOn(scale, tried)}`)
  }
  return bits.join(' · ')
}
