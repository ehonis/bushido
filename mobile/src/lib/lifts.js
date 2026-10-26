/*
 * Lifting, logged the way lifting actually happens.
 *
 * A typical session: dumbbell bent-over row, seated dumbbell shoulder press,
 * cable tricep extension, bench press, straight-legged deadlift, and seated
 * external shoulder rotation. Six exercises, each with its own implement, each with its own sets and reps and
 * load. That is not a shape the existing set log can hold, and the difference is
 * the whole design problem:
 *
 *   `logSpec.exercises` — the climbing sessions — is a list the PLAN declares.
 *   Max hangs are three sets of one seven-second rep before the user touches the app,
 *   so the rows arrive pre-filled and the user confirms them.
 *
 *   A lift session's exercises are chosen AT LOG TIME, out of a catalog of two
 *   hundred, and nothing knows which six until the user says. So they are their own
 *   list on the entry (`out.lifts`), and nothing is ever pre-filled.
 *
 * Everything here is pure so it can be tested as arithmetic — `app/lifts.test.js`
 * — rather than through a rendered table. The screen is `liftlog.jsx`.
 *
 * THE CATALOG IS CONTENT. Exercises, implements, and which implements a movement
 * can be done with all live on the field's own spec in plan.json, exactly as the
 * per-climb detail carries its `styles` vocabulary. Adding an exercise is an edit
 * to that file and needs no rebuild — which is the point, because "every kind of
 * lift you can think of" is a list that will be wrong the day it ships.
 *
 * WHAT IS STORED IS SELF-DESCRIBING. Each logged exercise keeps its own `name`
 * and `implement` label alongside the catalog keys, for the reason a WHOOP
 * snapshot keeps its numbers: renaming or dropping an exercise from the catalog
 * must not turn a session the user did into a row of blanks. The keys are what a
 * future chart would group by; the names are what the log reads back as.
 */

import { localIso } from './dates.js'

export const LIFT_FIELD = 'lifts'

/** The `type: "lifts"` field on a session card, or null. */
export const liftFieldIn = (opt) => (opt?.outputs || []).find(f => f?.type === 'lifts') || null

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/* ------------------------------------------------------------- the catalog */

/** The catalog off a `type: "lifts"` field. Empty rather than undefined. */
export function catalogOf(field) {
  return {
    implements: field?.implements || [],
    exercises: field?.exercises || [],
    groups: field?.groups || [],
  }
}

/** One exercise by key, or null. */
export function exerciseOf(field, key) {
  return catalogOf(field).exercises.find(e => e.key === key) || null
}

/* ---------------------------------------------------- reps, or held for time */

/*
 * How a movement's sets are counted (issue #63). Most are reps; a hold or a
 * stretch is SECONDS (`measure: "time"` in the catalog), and its sets are
 * `{ seconds, weight }` instead of `{ reps, weight }`. Time sets have no
 * volume: forty-five seconds under a plate is not a number to multiply.
 */

/** The catalog's answer for a movement: 'time' or 'reps'. */
export const measureFor = (field, key) => (exerciseOf(field, key)?.measure === 'time' ? 'time' : 'reps')

/**
 * How one LOGGED row is counted, read off the row's own sets before the
 * catalog: a Plank logged as reps before the catalog called it a hold has
 * `reps` on its sets and stays reps, whatever the catalog says now. Only a row
 * with no sets to read falls back to the catalog.
 */
export function liftMeasure(row, field = null) {
  const sets = (Array.isArray(row?.sets) ? row.sets : []).filter(r => r && typeof r === 'object')
  if (sets.some(r => 'seconds' in r)) return 'time'
  if (sets.some(r => 'reps' in r)) return 'reps'
  return measureFor(field, row?.key)
}

/* ------------------------------------------------------------ muscles, in words */

/*
 * The body map's vocabulary (react-body-highlighter) in the words people use,
 * for the detail sheet and for search: nobody types "gluteal". The first word
 * is what is shown; the rest are only searched.
 */
const MUSCLE_WORDS = {
  'front-deltoids': ['front delts', 'shoulders', 'deltoids'],
  'back-deltoids': ['rear delts', 'shoulders', 'deltoids'],
  gluteal: ['glutes', 'gluteal', 'butt'],
  quadriceps: ['quads', 'quadriceps', 'thighs'],
  hamstring: ['hamstrings'],
  adductor: ['adductors', 'inner thighs'],
  abductors: ['abductors', 'outer hips'],
  trapezius: ['traps', 'trapezius'],
  forearm: ['forearms', 'grip'],
  abs: ['abs', 'core'],
  obliques: ['obliques', 'core'],
  'upper-back': ['upper back'],
  'lower-back': ['lower back'],
}

/** "front delts" for "front-deltoids"; the vocabulary's word, de-hyphenated, otherwise. */
export const muscleName = (m) => MUSCLE_WORDS[m]?.[0] || String(m || '').replace(/-/g, ' ')

/**
 * The implements this movement can be loaded with.
 *
 * An exercise may name its own list — a pull-up is bodyweight, a band or a belt,
 * and offering "Smith machine" for one is the catalog being unhelpful. Most name
 * nothing and get the whole list, because most lifts genuinely can be done with
 * most things and a catalog that guesses at that is a catalog that argues with
 * them about their own gym.
 */
export function implementsFor(field, key) {
  const { implements: all } = catalogOf(field)
  const only = exerciseOf(field, key)?.implements
  if (!Array.isArray(only) || !only.length) return all
  const set = new Set(only)
  return all.filter(i => set.has(i.value))
}

const implementOf = (field, value) => catalogOf(field).implements.find(i => i.value === value) || null

/** "Dumbbell", or the raw value if the catalog no longer knows it. */
export function implementLabel(field, value) {
  if (!value) return ''
  return implementOf(field, value)?.label || String(value)
}

/**
 * What the weight column MEANS for this implement, which is not the same
 * question as how much it was.
 *
 * A pair of 30s is "30 lb per hand" and a bar with two 45s on it is "135 lb
 * total", and a log that calls both of them "lb" is a log you cannot read back in
 * six weeks. Declared per implement in plan.json; falls back to plain pounds.
 */
export function weightLabelFor(field, value) {
  return implementOf(field, value)?.weightLabel || 'lb'
}

/* ------------------------------------------------------ what the weight means */

/*
 * The other things the weight can mean, by implement (issue #58).
 *
 * The implement alone does not settle it. A Bulgarian split squat holding ONE
 * dumbbell is "25 lb, one dumbbell", and the app insisting on "lb per hand"
 * left no way to say so; a loaded bar is counted on the bar or per side
 * depending on the gym. So a lift row may carry a `weightMode`, switched on the
 * label beside the weight box, and the label says which.
 *
 * In code, because the owner's plan file is not in the repository and must keep
 * working unchanged; an implement may override them with its own `weightModes`
 * (`[{ value, label }]`, the first being the default, `[]` for no switch).
 * Anything not listed here has its declared label and no switch: a cable stack
 * or a band has one honest meaning, and offering another would be the app
 * inventing a choice. A mode is `{ value, label, short, box, partial }`: `short`
 * is the words a card's header uses ("one dumbbell"), `box` the few under the
 * weight box itself ("1 DB", so it fits one line beside the reps), and `partial`
 * marks a number that is not the whole load (per side), which `liftsLine` says
 * out loud. Summaries and "last time" use the full `label`.
 */
const PER_HAND = { value: 'pair', label: 'lb per hand', short: 'per hand', box: 'per hand' }
const ONE = (what, box) => ({ value: 'one', label: `lb · one ${what}`, short: `one ${what}`, box })
const BAR = [
  { value: 'total', label: 'lb on the bar', short: 'on the bar', box: 'on the bar' },
  { value: 'side', label: 'lb per side', short: 'per side', box: 'per side', partial: true },
]
const WEIGHT_MODES = {
  dumbbell: [PER_HAND, ONE('dumbbell', '1 DB')],
  kettlebell: [PER_HAND, ONE('kettlebell', '1 KB')],
  barbell: BAR, 'ez-bar': BAR, 'trap-bar': BAR, smith: BAR, landmine: BAR,
}

/**
 * The meanings on offer for an implement, default first; empty when there is
 * nothing to switch. The default reads as the plan file declares it, so a row
 * that never had a mode keeps the label it always had.
 */
export function weightModesFor(field, implement) {
  if (!implement) return []
  const impl = implementOf(field, implement)
  if (Array.isArray(impl?.weightModes)) {
    const own = impl.weightModes
      .filter(m => m?.value && m?.label)
      .map(m => ({
        value: String(m.value), label: String(m.label), short: String(m.short || m.label),
        box: String(m.box || m.short || m.label), partial: Boolean(m.partial),
      }))
    return own.length > 1 ? own : []
  }
  const coded = WEIGHT_MODES[implement]
  if (!coded) return []
  return [{ ...coded[0], label: impl?.weightLabel || coded[0].label }, ...coded.slice(1)]
}

/**
 * A row's mode when it is one its implement offers and NOT the default, else
 * null. Only a departure from the default is stored, so a row with no mode (every
 * row logged before #58) reads exactly as it did.
 */
export function weightModeOf(field, row) {
  const mode = row?.weightMode
  if (!mode) return null
  return weightModesFor(field, row.implement).slice(1).some(m => m.value === mode) ? mode : null
}

/** The row's mode as defined for its implement, when it is not the default; else null. */
const modeOf = (field, row) => {
  const mode = weightModeOf(field, row)
  return mode ? weightModesFor(field, row.implement).find(m => m.value === mode) : null
}

/**
 * The label of a row's mode when it is not the default, else null. A mode its
 * implement does not offer (one dumbbell stored on a barbell row) is no mode.
 * The row's own stored label stands only where neither the catalog nor the
 * coded modes know the implement any more, so history still reads back what
 * was meant.
 */
function modeLabel(field, row) {
  const mode = modeOf(field, row)
  if (mode) return mode.label
  const known = implementOf(field, row?.implement) || WEIGHT_MODES[row?.implement]
  if (row?.weightMode && row?.weightLabel && !known) return String(row.weightLabel)
  return null
}

/** What the weight on this row means. */
export function weightLabelOf(field, row) {
  return modeLabel(field, row) || weightLabelFor(field, row?.implement)
}

/** The words under the weight box for a row's mode, the default's included ("per hand", "1 DB"); null with no switch. */
export function weightBoxOf(field, row) {
  const modes = weightModesFor(field, row?.implement)
  if (modes.length < 2) return null
  return (modeOf(field, row) || modes[0]).box
}

/** A card header's words for a row's mode when it is not the default ("one dumbbell"), else null. */
export function weightModeWords(field, row) {
  return modeOf(field, row)?.short || null
}

/** `{ weightMode, weightLabel }` for an implement in a mode; an invalid or default mode is null. */
export function weightPatch(field, implement, mode = null) {
  const weightMode = weightModeOf(field, { implement, weightMode: mode })
  return { weightMode, weightLabel: weightLabelOf(field, { implement, weightMode }) }
}

/**
 * The mode one tap on the label moves to: the next one round, back to the
 * default after the last. Two meanings is a toggle, which is every coded case.
 */
export function nextWeightMode(field, row) {
  const modes = weightModesFor(field, row?.implement)
  if (modes.length < 2) return null
  const at = Math.max(0, modes.findIndex(m => m.value === (weightModeOf(field, row) || modes[0].value)))
  const next = modes[(at + 1) % modes.length].value
  return next === modes[0].value ? null : next
}

/**
 * The mode this exercise was last LOGGED in with this implement, or null for the
 * default (issue #58: a new Bulgarian split squat starts as "one dumbbell" if
 * that is how the last one was done). Per implement, because a mode belongs to one.
 *
 * THE RULE, the result of two rounds of review in which every heuristic opened
 * a new case:
 *
 *   - Memory is READ one way only: from logged rows (`out.lifts`) with a number
 *     on them, on entries that are done (not marked undone) and dated on or
 *     before `today`. The newest decides; a row with no mode was logged in the
 *     default, and going back to the default is a choice too. Plan items are not
 *     choices. A planned exercise that was done reaches memory anyway, because
 *     the runner and the sheet keep its logged row in step (prescription.js
 *     `runOutputs`, `followWeightModes`).
 *   - Memory is APPLIED once, when an exercise is created, and never again: a new
 *     row in the lift log (`addLift`, or picking its implement), a new exercise in
 *     the editor (`appendLift`), each lift of a model's FIRST draft
 *     (server/drafts.js). On a revision, an exercise the model kept keeps exactly
 *     what it had, a deliberate default included; only one new in the revision
 *     gets memory (`reviseWeightModes`, and server/drafts.js for a draft).
 *   - A mode is per person: whatever copies a lift to someone else strips it
 *     (lib/shared.js, server/sharedsync.js).
 *
 * `undone` and `done` are read as `isDone` (lib/store.js) reads them for a day
 * that has arrived. server/drafts.js `rememberedModes` is the same rule for a
 * whole log, and server/drafts.test.js holds the two to the same answers.
 */
export function rememberedWeightMode(field, entries = [], key, implement, excludeId = null, today = localIso()) {
  if (!key || !implement) return null
  let best = null
  for (const e of entries) {
    if (e?.deleted || e?.kind !== 'daily' || e.id === excludeId || !(String(e.date || '') <= today)) continue
    if (e.data?.done === false && e.data?.undone === true) continue
    const row = liftsIn(e.data?.out).find(l => l?.key === key && l.implement === implement
      && (l.sets || []).some(r => num(r?.reps) !== null || num(r?.seconds) !== null || num(r?.weight) !== null))
    if (!row) continue
    const at = `${e.date || ''}|${e.updatedAt || ''}`
    if (!best || at > best.at) best = { at, row }
  }
  return best ? weightModeOf(field, best.row) : null
}

/* -------------------------------------------------------------- the search */

/*
 * What a search reads off one exercise, worked out once per exercise object
 * (the catalog is about five hundred of them, searched on every keystroke).
 * `name` … `base` are what the search has always matched; `about` is the words
 * of its description (issue #63): tags, muscles in words, equipment, the gist
 * and the steps.
 */
const searchable = new WeakMap()
function searchText(ex) {
  let t = searchable.get(ex)
  if (t) return t
  const name = String(ex.name || '').toLowerCase()
  const group = String(ex.group || '').toLowerCase()
  const aka = (ex.aka || []).map(a => String(a).toLowerCase())
  const muscles = [...(ex.muscles?.primary || []), ...(ex.muscles?.secondary || [])]
    .flatMap(m => [String(m).replace(/-/g, ' '), ...(MUSCLE_WORDS[m] || [])])
  const words = (list) => list.join(' ').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  t = {
    name, group, aka,
    base: [name, group, String(ex.key || '').replace(/-/g, ' '), ...aka].join(' '),
    // Tags, muscles and equipment are said ABOUT the movement; the gist and
    // the steps only mention things, so they rank last.
    about: words([...(Array.isArray(ex.tags) ? ex.tags : []), ...muscles, String(ex.equipment || '')]),
    how: words([String(ex.how?.gist || ''), ...(Array.isArray(ex.how?.steps) ? ex.how.steps : [])]),
  }
  searchable.set(ex, t)
  return t
}

/**
 * The catalog, filtered and ranked for a typed query.
 *
 * A search box rather than a select, because two hundred options in an OS picker
 * is a scroll wheel you cannot aim — and because the user knows what the movement is
 * called. Ranking, best first:
 *
 *   0  the name starts with the query          "bench" → Bench press
 *   1  a WORD of the name starts with it       "press" → Bench press, Leg press
 *   2  an alias starts with it                 "rdl"   → Romanian deadlift
 *   3  the name contains it anywhere           "row"   → Pendlay row
 *   4  the muscle group matches                "back"  → everything for backs
 *   5  its tags, muscles or equipment          "lower abs no equipment" → Dead bug
 *   6  its gist or steps                       "wall" → Couch stretch
 *
 * Multi-word queries have to match every word somewhere ("db bent row"), which is
 * how a half-remembered name still finds the exercise. A word matches the name,
 * group, key or an alias anywhere in it, as it always has, or the START of a word
 * in the description, so "abs" does not find everything with "tabs" in a step.
 * With no query at all it returns the catalog in its own order, so the list is
 * browsable rather than only searchable.
 *
 * `group` is a picker's group chip: exactly that group, in catalog order, and
 * nothing that merely mentions it ("Triceps" is not a bench press). Description
 * matching is for words someone typed.
 */
export function searchExercises(field, query = '', { limit = 60, group = null } = {}) {
  const { exercises } = catalogOf(field)
  if (group) return exercises.filter(ex => ex.group === group).slice(0, limit)
  const q = String(query || '').trim().toLowerCase()
  if (!q) return exercises.slice(0, limit)
  const words = q.split(/\s+/).filter(Boolean)
  const starts = (list, w) => list.some(x => x.startsWith(w))

  const scored = []
  for (const ex of exercises) {
    const t = searchText(ex)
    // Every word has to be in there somewhere, or "bent row" would match
    // anything with "row" in it and the ranking below would be sorting noise.
    let rank
    if (words.every(w => t.base.includes(w))) {
      rank = t.name.startsWith(q) ? 0
        : t.name.split(/[\s-]+/).some(part => part.startsWith(q)) ? 1
        : t.aka.some(a => a.startsWith(q)) ? 2
        : t.name.includes(q) ? 3
        : 4
    } else if (words.every(w => t.base.includes(w) || starts(t.about, w))) {
      rank = 5
    } else if (words.every(w => t.base.includes(w) || starts(t.about, w) || starts(t.how, w))) {
      rank = 6
    } else continue
    scored.push({ ex, rank })
  }
  return scored
    .sort((a, b) => a.rank - b.rank || String(a.ex.name).localeCompare(String(b.ex.name)))
    .slice(0, limit)
    .map(s => s.ex)
}

/* -------------------------------------------------------- the logged list */

/** Every exercise logged on this entry. */
export function liftsIn(out) {
  return Array.isArray(out?.[LIFT_FIELD]) ? out[LIFT_FIELD] : []
}

/**
 * A fresh uid for an exercise that may legitimately appear twice.
 *
 * Supersets and second blocks are real — two goes at the same movement in one
 * session is not a mistake to dedupe — so identity is per ROW rather than per
 * exercise. `max + 1` rather than `count + 1`, or removing the first of two rows
 * would mint an id that collides with the surviving one.
 */
function nextUid(list, key) {
  const used = list
    .filter(l => l?.key === key)
    .map(l => Number(String(l.uid || '').replace(`${key}-`, '')))
    .filter(Number.isFinite)
  return `${key}-${(used.length ? Math.max(...used) : 0) + 1}`
}

/**
 * Add an exercise, with one blank set.
 *
 * One set and not three, and blank rather than seeded: there is no prescription
 * here to confirm, so any number in the box would be the app's invention. The
 * implement defaults to the movement's first offered one only when the catalog
 * gives it exactly one honest answer — otherwise it is a question. An implement
 * chosen that way starts in the weight mode the exercise was last logged in
 * (`rememberedWeightMode`, from `entries`).
 */
export function addLift(field, list, key, { entries = [], excludeId = null } = {}) {
  const ex = exerciseOf(field, key)
  if (!ex) return list
  const offered = implementsFor(field, key)
  const rows = liftsIn({ [LIFT_FIELD]: list })
  const implement = offered.length === 1 ? offered[0].value : ''
  return [...rows, withWeightMode(field, {
    uid: nextUid(rows, key),
    key,
    name: ex.name,
    group: ex.group || null,
    implement,
    sets: [blankSet(measureFor(field, key))],
  }, rememberedWeightMode(field, entries, key, implement, excludeId))]
}

/**
 * A row in a mode: `weightMode` and its label stored only for a departure from
 * the implement's default, and taken off otherwise, so a default row is the
 * shape every row had before modes existed.
 */
function withWeightMode(field, row, mode) {
  const { weightMode, weightLabel } = weightPatch(field, row.implement, mode)
  const { weightMode: _m, ...rest } = row
  if (weightMode) return { ...rest, weightMode, weightLabel }
  return 'weightLabel' in rest ? { ...rest, weightLabel } : rest
}

/** One empty set: `{ reps, weight }`, or `{ seconds, weight }` for a movement held for time. */
export const blankSet = (measure = 'reps') => (measure === 'time' ? { seconds: '', weight: '' } : { reps: '', weight: '' })

const mapLift = (list, uid, fn) => liftsIn({ [LIFT_FIELD]: list }).map(l => (l.uid === uid ? fn(l) : l))

export function removeLift(list, uid) {
  return liftsIn({ [LIFT_FIELD]: list }).filter(l => l.uid !== uid)
}

/**
 * Whether a row is counted in reps or held for seconds can be switched while
 * it has no count on it yet (issue #63: someone may count a hold in reps). The
 * row's own sets ARE its measure (`liftMeasure`), so switching renames the
 * blank count on each set and keeps the weights; nothing else is stored.
 */
export function canSwitchMeasure(field, row) {
  if (measureFor(field, row?.key) !== 'time') return false
  return (Array.isArray(row?.sets) ? row.sets : []).every(r => num(r?.reps) === null && num(r?.seconds) === null)
}

function withMeasure(row, measure) {
  const sets = (Array.isArray(row.sets) ? row.sets : []).map(r => {
    const { reps: _r, seconds: _s, ...rest } = r || {}
    return measure === 'time' ? { seconds: '', ...rest } : { reps: '', ...rest }
  })
  return { ...row, sets: sets.length ? sets : [blankSet(measure)] }
}

/** Change the implement (or anything else) on one logged exercise. `measure` switches reps and seconds. */
export function patchLift(field, list, uid, patch) {
  return mapLift(list, uid, l => {
    if ('measure' in patch) {
      const { measure, ...rest } = patch
      const switched = canSwitchMeasure(field, l) ? withMeasure(l, measure === 'time' ? 'time' : 'reps') : l
      return Object.keys(rest).length ? patchLift(field, [switched], uid, rest)[0] : switched
    }
    const next = { ...l, ...patch }
    // The label travels with the value for the same reason the exercise name
    // does — the log has to read back without the catalog.
    if ('implement' in patch) next.implementLabel = implementLabel(field, patch.implement) || null
    // A new implement starts in the mode it is given, else its default: one
    // dumbbell means nothing on a barbell.
    if ('implement' in patch || 'weightMode' in patch) return withWeightMode(field, next, patch.weightMode ?? null)
    return next
  })
}

/**
 * A new set, carrying the previous one's numbers forward.
 *
 * This is copying what the user TYPED, which is a different thing from pre-filling
 * what the plan guessed: three sets of ten at thirty is one set entered and two
 * confirmed, and the second set of a lift is the same as the first far more often
 * than it is not. Everything stays editable, so a set that dropped off reads as
 * the drop-off it was.
 */
export function addLiftSet(list, uid) {
  return mapLift(list, uid, l => {
    const rows = Array.isArray(l.sets) ? l.sets : []
    const last = rows.at(-1)
    return { ...l, sets: [...rows, last ? { ...last } : blankSet(liftMeasure(l))] }
  })
}

export function removeLiftSet(list, uid, i) {
  return mapLift(list, uid, l => {
    const rows = (Array.isArray(l.sets) ? l.sets : []).filter((_, j) => j !== i)
    // Never zero rows: an exercise with no sets is an exercise the user did not do,
    // and the way to say that is to remove the exercise.
    return { ...l, sets: rows.length ? rows : [blankSet(liftMeasure(l))] }
  })
}

/**
 * Move one logged exercise up or down the list.
 *
 * The log's counterpart to `moveItem` on a prescription, added 2026-09-21 when
 * the two screens became one component. Simpler than that one in exactly one
 * way: a logged lift's identity is its `uid` and uids are minted rather than
 * positional, so a move renumbers nothing and there is no landing id to hand
 * back — the row keeps the id it had, which is what the glow follows.
 *
 * A move off either end is a no-op that still answers, so no caller has to
 * special-case the first and last rows.
 */
export function moveLift(list, uid, dir) {
  const rows = liftsIn({ [LIFT_FIELD]: list })
  const at = rows.findIndex(l => l.uid === uid)
  const to = at + (dir === 'up' ? -1 : 1)
  if (at < 0 || to < 0 || to >= rows.length) return rows
  const next = [...rows]
  ;[next[at], next[to]] = [next[to], next[at]]
  return next
}

export function setLiftSet(list, uid, i, patch) {
  return mapLift(list, uid, l => ({
    ...l,
    sets: (Array.isArray(l.sets) ? l.sets : []).map((r, j) => (j === i ? { ...r, ...patch } : r)),
  }))
}

/* ------------------------------------------------------------ what it adds up to */

export const liftSets = (out) => liftsIn(out).reduce((n, l) => n + (l.sets?.length || 0), 0)

export const liftReps = (out) =>
  liftsIn(out).reduce((n, l) => n + (l.sets || []).reduce((m, r) => m + (num(r.reps) || 0), 0), 0)

/**
 * Total tonnage — reps × load, summed.
 *
 * As ENTERED, whatever the weight means (`weightLabelOf`): per hand is not
 * doubled and one dumbbell is not halved. Doubling here would be the app
 * deciding that two 30s is 60, which is true of the tonnage and false of the
 * number the user will compare against next week, and the weight column already
 * says which it is. "Per side" is counted as entered too, which makes the sum
 * plainly not the load moved, so `liftsLine` says "as entered" whenever a set
 * in it was per side rather than present it as the total. Only sets with both
 * numbers count; a set logged as reps alone contributes nothing rather than
 * zero-weight noise. A row held for time has no volume at all (`liftMeasure`).
 */
export function liftVolume(out) {
  let total = 0
  for (const l of liftsIn(out)) {
    if (liftMeasure(l) === 'time') continue
    for (const r of l.sets || []) {
      const reps = num(r.reps)
      const w = num(r.weight)
      if (reps !== null && w !== null) total += reps * w
    }
  }
  return Math.round(total)
}

/**
 * "3 × 10 @ 30 lb", or "3 × 10" where no load was logged. Collapses equal sets.
 * A row in a mode other than its default says so ("3 × 8 @ 25 lb · one
 * dumbbell"), unless `mode: false` (a card's header, which says the mode under
 * the name instead). `field` is the catalog; without one, the coded modes.
 * A row held for time reads "3 × 45 s" (`liftMeasure`).
 */
export function liftSummary(lift, field = null, { mode = true } = {}) {
  const count = liftMeasure(lift, field) === 'time' ? 'seconds' : 'reps'
  const rows = (lift?.sets || []).filter(r => num(r?.[count]) !== null || num(r?.weight) !== null)
  if (!rows.length) return ''
  const same = rows.every(r => String(r[count]) === String(rows[0][count]) && String(r.weight) === String(rows[0].weight))
  const unit = (mode && modeLabel(field, lift)) || 'lb'
  const load = (r) => (num(r.weight) === null ? '' : ` @ ${num(r.weight)} ${unit}`)
  const each = (r) => {
    const n = num(r[count])
    if (n === null) return '—'
    return count === 'seconds' ? `${n} s` : `${n}`
  }
  if (same) return `${rows.length} × ${each(rows[0])}${load(rows[0])}`
  return rows.map(r => `${each(r)}${load(r)}`).join(', ')
}

/** One line for the whole session: "6 exercises · 18 sets · 4,120 lb". `field` as for `liftSummary`. */
export function liftsLine(out, field = null) {
  const n = liftsIn(out).length
  if (!n) return ''
  const sets = liftSets(out)
  const vol = liftVolume(out)
  // See `liftVolume`: a per-side set makes the sum something other than a total.
  const perSide = liftsIn(out).some(l => modeOf(field, l)?.partial
    && (l.sets || []).some(r => num(r.reps) !== null && num(r.weight) !== null))
  return [
    `${n} exercise${n === 1 ? '' : 's'}`,
    sets ? `${sets} set${sets === 1 ? '' : 's'}` : null,
    vol ? `${vol.toLocaleString()} lb${perSide ? ' as entered' : ''}` : null,
  ].filter(Boolean).join(' · ')
}

/**
 * The last time the user did this exercise, whatever session it was logged on.
 *
 * The lifting equivalent of `PriorNote`, and there for the same reason: what you
 * pressed last time is the number you are trying to beat, and looking it up in
 * the history tab mid-set is not something that happens. Newest first, the entry
 * being edited excluded. `measure` keeps a hold's last time to holds: sixty
 * reps of an old Plank is not a number to beat in seconds.
 */
export function lastLift(entries = [], key, excludeId = null, field = null, measure = null) {
  const hits = []
  for (const e of entries) {
    if (e?.deleted || e?.kind !== 'daily' || e.id === excludeId) continue
    for (const l of liftsIn(e.data?.out)) {
      if (l?.key !== key) continue
      if (measure && liftMeasure(l, field) !== measure) continue
      const summary = liftSummary(l, field)
      if (summary) hits.push({ date: e.date, implement: l.implementLabel || l.implement || null, summary })
    }
  }
  return hits.sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null
}
