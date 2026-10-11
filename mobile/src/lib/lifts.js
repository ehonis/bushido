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

export const LIFT_FIELD = 'lifts'

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

/* -------------------------------------------------------------- the search */

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
 *
 * Multi-word queries have to match every word somewhere ("db bent row"), which is
 * how a half-remembered name still finds the exercise. With no query at all it
 * returns the catalog in its own order, so the list is browsable rather than only
 * searchable.
 */
export function searchExercises(field, query = '', { limit = 60 } = {}) {
  const { exercises } = catalogOf(field)
  const q = String(query || '').trim().toLowerCase()
  if (!q) return exercises.slice(0, limit)
  const words = q.split(/\s+/).filter(Boolean)

  const scored = []
  for (const ex of exercises) {
    const name = String(ex.name || '').toLowerCase()
    const group = String(ex.group || '').toLowerCase()
    const aka = (ex.aka || []).map(a => String(a).toLowerCase())
    const haystack = [name, group, String(ex.key || '').replace(/-/g, ' '), ...aka].join(' ')

    // Every word has to be in there somewhere, or "bent row" would match
    // anything with "row" in it and the ranking below would be sorting noise.
    if (!words.every(w => haystack.includes(w))) continue

    const rank = name.startsWith(q) ? 0
      : name.split(/[\s-]+/).some(part => part.startsWith(q)) ? 1
      : aka.some(a => a.startsWith(q)) ? 2
      : name.includes(q) ? 3
      : 4
    scored.push({ ex, rank })
  }
  return scored
    .sort((a, b) => a.rank - b.rank || a.ex.name.localeCompare(b.ex.name))
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
 * gives it exactly one honest answer — otherwise it is a question.
 */
export function addLift(field, list, key) {
  const ex = exerciseOf(field, key)
  if (!ex) return list
  const offered = implementsFor(field, key)
  const rows = liftsIn({ [LIFT_FIELD]: list })
  return [...rows, {
    uid: nextUid(rows, key),
    key,
    name: ex.name,
    group: ex.group || null,
    implement: offered.length === 1 ? offered[0].value : '',
    sets: [blankSet()],
  }]
}

export const blankSet = () => ({ reps: '', weight: '' })

const mapLift = (list, uid, fn) => liftsIn({ [LIFT_FIELD]: list }).map(l => (l.uid === uid ? fn(l) : l))

export function removeLift(list, uid) {
  return liftsIn({ [LIFT_FIELD]: list }).filter(l => l.uid !== uid)
}

/** Change the implement (or anything else) on one logged exercise. */
export function patchLift(field, list, uid, patch) {
  return mapLift(list, uid, l => {
    const next = { ...l, ...patch }
    // The label travels with the value for the same reason the exercise name
    // does — the log has to read back without the catalog.
    if ('implement' in patch) next.implementLabel = implementLabel(field, patch.implement) || null
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
    return { ...l, sets: [...rows, last ? { ...last } : blankSet()] }
  })
}

export function removeLiftSet(list, uid, i) {
  return mapLift(list, uid, l => {
    const rows = (Array.isArray(l.sets) ? l.sets : []).filter((_, j) => j !== i)
    // Never zero rows: an exercise with no sets is an exercise the user did not do,
    // and the way to say that is to remove the exercise.
    return { ...l, sets: rows.length ? rows : [blankSet()] }
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
 * As ENTERED, which for dumbbells is per hand. Doubling it here would be the app
 * deciding that two 30s is 60, which is true of the tonnage and false of the
 * number the user will compare against next week, and the weight column already says
 * which it is (see `weightLabelFor`). Only sets with both numbers count; a set
 * logged as reps alone contributes nothing rather than zero-weight noise.
 */
export function liftVolume(out) {
  let total = 0
  for (const l of liftsIn(out)) {
    for (const r of l.sets || []) {
      const reps = num(r.reps)
      const w = num(r.weight)
      if (reps !== null && w !== null) total += reps * w
    }
  }
  return Math.round(total)
}

/** "3 × 10 @ 30 lb", or "3 × 10" where no load was logged. Collapses equal sets. */
export function liftSummary(lift) {
  const rows = (lift?.sets || []).filter(r => num(r.reps) !== null || num(r.weight) !== null)
  if (!rows.length) return ''
  const same = rows.every(r => String(r.reps) === String(rows[0].reps) && String(r.weight) === String(rows[0].weight))
  const load = (r) => (num(r.weight) === null ? '' : ` @ ${num(r.weight)} lb`)
  if (same) {
    const reps = num(rows[0].reps)
    return `${rows.length} × ${reps ?? '—'}${load(rows[0])}`
  }
  return rows.map(r => `${num(r.reps) ?? '—'}${load(r)}`).join(', ')
}

/** One line for the whole session: "6 exercises · 18 sets · 4,120 lb". */
export function liftsLine(out) {
  const n = liftsIn(out).length
  if (!n) return ''
  const sets = liftSets(out)
  const vol = liftVolume(out)
  return [
    `${n} exercise${n === 1 ? '' : 's'}`,
    sets ? `${sets} set${sets === 1 ? '' : 's'}` : null,
    vol ? `${vol.toLocaleString()} lb` : null,
  ].filter(Boolean).join(' · ')
}

/**
 * The last time the user did this exercise, whatever session it was logged on.
 *
 * The lifting equivalent of `PriorNote`, and there for the same reason: what you
 * pressed last time is the number you are trying to beat, and looking it up in
 * the history tab mid-set is not something that happens. Newest first, the entry
 * being edited excluded.
 */
export function lastLift(entries = [], key, excludeId = null) {
  const hits = []
  for (const e of entries) {
    if (e?.deleted || e?.kind !== 'daily' || e.id === excludeId) continue
    for (const l of liftsIn(e.data?.out)) {
      if (l?.key !== key) continue
      const summary = liftSummary(l)
      if (summary) hits.push({ date: e.date, implement: l.implementLabel || l.implement || null, summary })
    }
  }
  return hits.sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null
}
