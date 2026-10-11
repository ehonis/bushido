/*
 * A PRESCRIPTION — the workout somebody planned, as opposed to the workout that
 * happened.
 *
 * The shape follows from users who do not stick to a set schedule or to
 * recommended workouts. So the app stopped recommending. What replaced it is not
 * a smarter recommender; it is the user asking for something like "legs, 45
 * minutes, I want my squat to stop stalling" and getting back a workout with the
 * sets already written in.
 *
 * FOUR DECISIONS WORTH NOT UNDOING.
 *
 * **The prescription and the log are different objects.** `data.plan` is what was
 * asked for; `out` is what happened. They are never the same field, because the
 * only interesting question about a planned workout is where the two diverged —
 * and an app that overwrites the target with the actual can no longer answer it.
 * The runner pre-fills the actual FROM the target, which is a different thing:
 * every number is their to change and the original is still on the entry.
 *
 * **It is one shape for lifting AND for intervals.** A lift item is three sets of
 * `{reps, weight}`; a swim item is four sets of `{distance, unit, restSec}`. Both
 * are an ITEM with a list of SETS, because the runner walks a flat list of sets
 * either way and two parallel models would mean two runners. `kind` only decides
 * which numbers the screen puts under your thumb.
 *
 * **Ids are positional and deterministic** — `b0`, `b0i1`, `b0i1s2`. Not random:
 * the run state is keyed by set id and lives on a synced entry, so an id that
 * changed when the prescription was re-read would orphan everything the user had
 * already ticked. Editing the prescription re-mints them on purpose, and
 * `remapRun` is how a completed set survives that.
 *
 * **Nothing here touches the clock.** Times are absolute epoch milliseconds
 * handed in by the caller, so this file is testable as arithmetic and the runner's
 * timer can survive the app being closed — which is the whole reason the rest
 * deadline is stored as `restUntil` rather than as "90 seconds remaining".
 */

import { catalogOf, exerciseOf, implementLabel, weightLabelFor, implementsFor } from './lifts.js'

export const PRESCRIPTION_VERSION = 1

/** The two item shapes. A third would need a third pair of thumb controls. */
export const ITEM_KINDS = ['lift', 'interval']

/** What a set can carry. Everything is optional; a set with none of it is dropped. */
const SET_FIELDS = ['reps', 'weight', 'seconds', 'distance', 'restSec']

const MAX_BLOCKS = 12
const MAX_ITEMS = 20
const MAX_SETS = 30

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const clamp = (n, lo, hi) => (n === null ? null : Math.min(hi, Math.max(lo, n)))

const str = (v, max = 120) => {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, max) : ''
}

/* ------------------------------------------------------------- normalising */

/**
 * Turn whatever the planner returned into something the runner can walk.
 *
 * Defensive on purpose. The generator is a model with a JSON schema, and a schema
 * guarantees the SHAPE of what comes back and nothing at all about whether the
 * exercise key exists in the catalog or the rest is negative. Everything it got
 * wrong is dropped here rather than rendered — an unknown exercise key would draw
 * a row with no name and no weight label, which reads as a bug in the app.
 *
 * `liftField` is the `type: "lifts"` output spec off plan.json, which carries the
 * exercise catalog. Without it, lift items keep the name the planner wrote and
 * lose only the implement's weight label.
 */
export function normalizePrescription(raw, { liftField = null } = {}) {
  if (!raw || typeof raw !== 'object') return null

  /*
   * A block survives on its items OR on its note.
   *
   * Dropping note-only blocks was the first thing this got wrong against a real
   * planning run: the agent wrote the warm-up as prose ("5 min easy bike, then
   * two ramp-up sets with the bar") exactly as it was told to, and the whole
   * block vanished on the way to the screen. An item with no sets is still
   * dropped — that IS a sentence pretending to be work — but the sentence has to
   * land somewhere, and the block note is where the prompt says to put it.
   */
  const blocks = (Array.isArray(raw.blocks) ? raw.blocks : [])
    .slice(0, MAX_BLOCKS)
    .map((b, bi) => normalizeBlock(b, bi, liftField))
    .filter(blockSurvives)

  // Nothing to DO, though, is nothing. A prescription of three paragraphs and no
  // sets is not a workout the runner can walk.
  if (!blocks.some(b => b.items.length > 0)) return null

  return {
    v: PRESCRIPTION_VERSION,
    title: str(raw.title, 80) || 'Planned workout',
    category: str(raw.category, 40) || null,
    activity: str(raw.activity, 40) || null,
    focus: str(raw.focus, 80) || null,
    minutes: clamp(num(raw.minutes), 1, 600),
    why: str(raw.why, 1200) || '',
    notes: (Array.isArray(raw.notes) ? raw.notes : []).slice(0, 8).map(n => str(n, 240)).filter(Boolean),
    // Revisions only: what it says it changed, which is what the conversation
    // panel shows them. A revision the user cannot see is the problem the old coach's
    // silent plan edits had. See PlanTalk in planner.jsx.
    changed: str(raw.changed, 600) || null,
    blocks,
    createdAt: str(raw.createdAt, 40) || null,
    model: str(raw.model, 60) || null,
  }
}

function normalizeBlock(b, bi, liftField) {
  const id = `b${bi}`
  const items = (Array.isArray(b?.items) ? b.items : [])
    .slice(0, MAX_ITEMS)
    .map((it, ii) => normalizeItem(it, `${id}i${ii}`, liftField))
    .filter(Boolean)
  return {
    id,
    name: str(b?.name, 60) || `Block ${bi + 1}`,
    note: str(b?.note, 300),
    // Which quota THIS block fills, and what its log form asks for. Null on a
    // warm-up, which is not a workout in its own right. A block that names a
    // category becomes its own ENTRY — see splitPrescription().
    category: str(b?.category, 40) || null,
    activity: str(b?.activity, 40) || null,
    items,
  }
}

function normalizeItem(it, id, liftField) {
  if (!it || typeof it !== 'object') return null
  const kind = ITEM_KINDS.includes(it.kind) ? it.kind : 'interval'

  /*
   * A lift item is resolved against the catalog, and the resolution is what makes
   * the row self-describing later: the key is what a chart groups by, the name
   * and the weight label are what the log reads back as with no catalog at all.
   * Same rule `addLift` follows — see lib/lifts.js.
   */
  let exercise = null
  let name = str(it.name, 80)
  let implement = ''
  let implementLbl = null
  let weightLbl = null
  let group = null

  if (kind === 'lift') {
    const key = str(it.exercise, 60)
    const ex = liftField ? exerciseOf(liftField, key) : null
    // An exercise the catalog has never heard of is the planner inventing a
    // movement. Keep the row — the user can still do it and still log it — but do not
    // pretend it has a catalog identity, or `lastLift` would key history off a
    // made-up string.
    exercise = ex ? key : null
    if (ex) { name = ex.name; group = ex.group || null }
    if (!name) return null

    const offered = liftField && ex ? implementsFor(liftField, key) : []
    const wanted = str(it.implement, 40)
    implement = offered.some(o => o.value === wanted) ? wanted
      : offered.length === 1 ? offered[0].value : ''
    implementLbl = implement && liftField ? (implementLabel(liftField, implement) || null) : null
    weightLbl = implement && liftField ? (weightLabelFor(liftField, implement) || null) : null
  }

  if (!name) return null

  const unit = str(it.unit, 12) || null
  const sets = (Array.isArray(it.sets) ? it.sets : [])
    .slice(0, MAX_SETS)
    .map((s, si) => normalizeSet(s, `${id}s${si}`, unit, kind))
    .filter(Boolean)

  // An item with no sets is a sentence, not a piece of work. The planner is told
  // to put those in the block's note.
  if (!sets.length) return null

  return {
    id, kind, name, note: str(it.note, 300),
    exercise, group, implement,
    implementLabel: implementLbl, weightLabel: weightLbl,
    unit, sets,
  }
}

/**
 * A LIFT HAS NO PROGRAMMED REST: rest between lifting sets is not prescribed,
 * since it is rarely kept to strictly. So the field is dropped on
 * the way in rather than merely hidden — a number stored and never shown is a
 * number that comes back the next time somebody renders the row, and the runner
 * would still have counted it down. Intervals keep theirs: a swim set's rest at
 * the wall IS the programming, which is the opposite case.
 */
function normalizeSet(s, id, unit, kind = 'interval') {
  if (!s || typeof s !== 'object') return null
  const row = { id }
  row.reps = clamp(num(s.reps), 0, 999)
  row.weight = clamp(num(s.weight), 0, 2000)
  row.seconds = clamp(num(s.seconds), 0, 7200)
  row.distance = clamp(num(s.distance), 0, 100000)
  row.restSec = kind === 'lift' ? null : clamp(num(s.restSec), 0, 3600)
  row.unit = str(s.unit, 12) || unit || null
  row.note = str(s.note, 120)
  const carries = SET_FIELDS.some(f => row[f] !== null && row[f] !== undefined)
  return carries ? row : null
}

/* -------------------------------------------------------------- the totals */

/** Every set in the prescription, flattened in the order they are done. */
export function prescriptionSteps(pres) {
  const out = []
  for (const b of pres?.blocks || []) {
    for (const it of b.items) {
      it.sets.forEach((set, i) => {
        out.push({
          setId: set.id, itemId: it.id, blockId: b.id,
          blockName: b.name, itemName: it.name, kind: it.kind,
          item: it, block: b, set,
          index: i, of: it.sets.length,
        })
      })
    }
  }
  return out
}

/** "4 exercises · 14 sets · about 45 min" — the whole thing in one line. */
export function prescriptionLine(pres) {
  if (!pres) return ''
  const items = (pres.blocks || []).reduce((n, b) => n + b.items.length, 0)
  const sets = prescriptionSteps(pres).length
  const word = (pres.blocks || []).some(b => b.items.some(i => i.kind === 'lift')) ? 'exercise' : 'piece'
  return [
    items ? `${items} ${word}${items === 1 ? '' : 's'}` : null,
    sets ? `${sets} set${sets === 1 ? '' : 's'}` : null,
    pres.minutes ? `about ${pres.minutes} min` : null,
  ].filter(Boolean).join(' · ')
}

/** "3 × 8 @ 95 lb" / "4 × 100 yd" — one item, collapsed where the sets agree. */
export function itemLine(item) {
  const rows = item?.sets || []
  if (!rows.length) return ''
  /*
   * Collapsed on what the line SHOWS, not on every field.
   *
   * `restSec` is in `SET_FIELDS` and is not in the rendered string, so comparing
   * the whole record made "3 × 10 @ 100 lb" render as the same set printed three
   * times whenever the last rest differed by fifteen seconds — which is most
   * sessions, because the last set of a movement rests into the next one.
   */
  const shown = rows.map(r => setLine(r, item))
  if (shown.every(line => line === shown[0])) return `${rows.length} × ${shown[0]}`
  return shown.join(', ')
}

/** "8 @ 95 lb", "100 yd", "45 s" — one set, in the units it was written in. */
export function setLine(set, item = null) {
  if (!set) return ''
  const bits = []
  if (set.reps !== null && set.reps !== undefined) bits.push(`${set.reps}`)
  if (set.distance !== null && set.distance !== undefined) {
    bits.push(`${set.distance}${set.unit ? ` ${set.unit}` : ''}`)
  }
  if (set.seconds !== null && set.seconds !== undefined && !bits.length) bits.push(`${set.seconds} s`)
  else if (set.seconds !== null && set.seconds !== undefined) bits.push(`${set.seconds} s`)
  const head = bits.join(' · ') || '—'
  if (set.weight === null || set.weight === undefined) return head
  // The weight column says what it MEANS — "lb per hand" is a different number
  // from "lb on the bar". See lib/lifts.js.
  const unit = item?.weightLabel || 'lb'
  return `${head} @ ${set.weight} ${unit}`
}

/**
 * Which numbers a set puts on screen.
 *
 * Written down once because the editor and the runner have to agree: a box that
 * exists on the review screen and not in the runner is a number the user can plan and
 * cannot record.
 *
 * A LIFT always shows reps and weight, present or not. The planner is told to
 * leave `weight` out rather than invent one when it has no history for the
 * movement — which is right, and it happened on the very first real run — but a
 * field that only appears once it has a value means the blank it deliberately
 * left is a blank the user cannot fill in. Absent means "you tell me", not "not
 * applicable".
 *
 * An INTERVAL shows what it actually carries, because there the absent fields
 * genuinely are not applicable: a swim piece has no reps and a plank has no
 * distance, and offering both would be the app guessing at the shape of work it
 * was handed. Failing everything, it gets a clock.
 */
export function setFieldsFor(item, set) {
  if (item?.kind === 'lift') return ['reps', 'weight']
  const has = (k) => set?.[k] !== null && set?.[k] !== undefined
  const shown = ['distance', 'seconds', 'reps'].filter(has)
  return shown.length ? shown : ['seconds']
}

/* ----------------------------------------------------------- the run state */

/**
 * Where the user is in a workout the user is actually doing.
 *
 * Lives on the entry (`data.run`), not in component state and not in
 * localStorage, for one reason: it has to survive the app being CLOSED. The
 * store already caches every entry to localStorage and syncs it to the box, so
 * putting the run there means closing Bushido mid-set, answering a text and coming
 * back lands on the same set with the rest clock still counting — and means the
 * same is true if the phone dies and the user opens it on the laptop.
 *
 * Every instant is absolute epoch milliseconds. A "72 seconds remaining" that
 * only decrements while the screen is on is the bug this shape exists to make
 * impossible.
 */
export const emptyRun = (at = Date.now()) => ({
  startedAt: at,
  endedAt: null,
  restUntil: 0,
  restFrom: 0,
  restOf: 0,
  cursor: null,
  sets: {},
  skipped: [],
})

export const runOf = (entry) => {
  const r = entry?.data?.run
  return r && typeof r === 'object' ? r : null
}

/** Seconds of rest left, or 0. Reads the wall clock, so a closed app cannot cheat it. */
export const restLeft = (run, now = Date.now()) =>
  run?.restUntil ? Math.max(0, Math.ceil((run.restUntil - now) / 1000)) : 0

/** How long the user has been at it, in whole seconds. */
export const runElapsed = (run, now = Date.now()) =>
  run?.startedAt ? Math.max(0, Math.floor(((run.endedAt || now) - run.startedAt) / 1000)) : 0

export const isLogged = (run, setId) => Boolean(run?.sets?.[setId])
export const isSkipped = (run, setId) => (run?.skipped || []).includes(setId)

/** Done, skipped, total — what the header's bar draws. */
export function runProgress(run, steps) {
  const total = steps.length
  let done = 0
  let skipped = 0
  for (const s of steps) {
    if (isLogged(run, s.setId)) done += 1
    else if (isSkipped(run, s.setId)) skipped += 1
  }
  return { done, skipped, total, left: total - done - skipped, pct: total ? done / total : 0 }
}

/** The first set that is neither logged nor skipped — where to drop them in. */
export function firstOpen(run, steps) {
  const hit = steps.find(s => !isLogged(run, s.setId) && !isSkipped(run, s.setId))
  return hit?.setId || steps.at(-1)?.setId || null
}

/**
 * Mark a set done, start its rest, and move on.
 *
 * The rest comes off the SET the user just finished rather than the one the user is about to
 * do, because rest is the tail of a set and not the head of the next one — which
 * is also why the last set of an item rests for as long as that item says and
 * the runner simply shows the next item's name under the clock.
 */
export function markSet(run, step, actual, { at = Date.now(), steps = [] } = {}) {
  const base = run || emptyRun(at)
  const rest = num(actual?.restSec) ?? num(step?.set?.restSec) ?? 0
  const here = steps.findIndex(s => s.setId === step.setId)
  const next = steps.find((s, i) =>
    i > here && s.setId !== step.setId && !isLogged(base, s.setId) && !isSkipped(base, s.setId))
  return {
    ...base,
    startedAt: base.startedAt || at,
    sets: { ...base.sets, [step.setId]: { ...cleanActual(actual), at } },
    skipped: (base.skipped || []).filter(id => id !== step.setId),
    restUntil: rest > 0 ? at + rest * 1000 : 0,
    restFrom: rest > 0 ? at : 0,
    restOf: rest > 0 ? rest : 0,
    cursor: next?.setId || step.setId,
  }
}

/** Take a set back. Clears its rest too — a set you un-did is not resting. */
export function unmarkSet(run, setId) {
  if (!run?.sets?.[setId]) return run
  const sets = { ...run.sets }
  delete sets[setId]
  return { ...run, sets, restUntil: 0, restFrom: 0, restOf: 0, cursor: setId }
}

/** "Not doing that one." Recorded rather than left blank — see the skip list on Today. */
export function skipSet(run, setId, { at = Date.now(), steps = [] } = {}) {
  const base = run || emptyRun(at)
  const sets = { ...base.sets }
  delete sets[setId]
  const skipped = base.skipped?.includes(setId) ? base.skipped : [...(base.skipped || []), setId]
  const i = steps.findIndex(x => x.setId === setId)
  const next = steps.find((s, j) => j > i && !isLogged(base, s.setId) && !skipped.includes(s.setId))
  return { ...base, sets, skipped, restUntil: 0, restFrom: 0, restOf: 0, cursor: next?.setId || setId }
}

export const unskipSet = (run, setId) => (run
  ? { ...run, skipped: (run.skipped || []).filter(id => id !== setId), cursor: setId }
  : run)

/** Stretch or cut the rest the user is in — the two buttons either side of the clock. */
export function nudgeRest(run, seconds, { at = Date.now() } = {}) {
  if (!run?.restUntil) return run
  const until = Math.max(at, run.restUntil + seconds * 1000)
  return { ...run, restUntil: until, restOf: Math.max(0, Math.round((until - run.restFrom) / 1000)) }
}

export const endRest = (run) => (run ? { ...run, restUntil: 0, restFrom: 0, restOf: 0 } : run)

/** Move the cursor without logging anything — tapping a row in the set list. */
export const goToSet = (run, setId, { at = Date.now() } = {}) =>
  ({ ...(run || emptyRun(at)), cursor: setId })

export const finishRun = (run, { at = Date.now() } = {}) =>
  ({ ...(run || emptyRun(at)), endedAt: at, restUntil: 0, restFrom: 0, restOf: 0 })

const cleanActual = (a) => {
  const row = {}
  for (const f of SET_FIELDS) {
    const n = num(a?.[f])
    if (n !== null) row[f] = n
  }
  if (a?.unit) row.unit = str(a.unit, 12)
  return row
}

/**
 * The numbers a set opens with.
 *
 * The prescription, because a set done as written should be one tap. This is the
 * one place in the app where a pre-filled number is right rather than wrong, and
 * the difference is provenance: everywhere else the app would be guessing, and
 * here it is showing them the target the user asked for and is about to confirm or
 * beat. The target stays on `data.plan` either way, so the two never merge.
 */
export function setDraft(run, step) {
  const logged = run?.sets?.[step.setId]
  if (logged) return { ...logged }
  const t = step.set
  const draft = {}
  for (const f of SET_FIELDS) if (t[f] !== null && t[f] !== undefined) draft[f] = t[f]
  if (t.unit) draft.unit = t.unit
  // Carrying the last set of the SAME item forward beats the prescription once the user
  // has changed it: if set one went up to 100 the prescription's 95 is stale, and
  // retyping it every set is exactly the friction this screen exists to remove.
  return draft
}

/**
 * What the last completed set of this item actually was — the number the next
 * set should open with once the user has moved off the prescription.
 */
export function carryForward(run, steps, step) {
  const mine = steps.filter(s => s.itemId === step.itemId)
  const i = mine.findIndex(s => s.setId === step.setId)
  for (let j = i - 1; j >= 0; j -= 1) {
    const done = run?.sets?.[mine[j].setId]
    if (done) return { ...done, restSec: step.set.restSec ?? done.restSec }
  }
  return null
}

/* -------------------------------------------------- writing back to the log */

/**
 * What the run puts in `out`, so the rest of the app never learns this screen
 * exists.
 *
 * Lift items become `out.lifts` in exactly the shape `liftlog.jsx` edits and
 * `liftVolume` sums, which is what lets a finished run be edited afterwards
 * exactly like any other logged lift, with no new editor. Interval items total into the
 * activity form's own fields where the units agree, and are left alone where
 * they do not — a swim in metres must not silently become yards.
 *
 * Only LOGGED sets count. A prescription the user never touched contributes nothing:
 * the log says what happened, and "planned but not done" is `done: false` on the
 * entry, not a row of zeroes in the volume chart.
 */
export function runOutputs(pres, run, out = {}) {
  const next = { ...out }

  const lifts = []
  let poolDistance = 0
  let poolUnit = null
  let distance = 0
  let distanceUnit = null

  for (const b of pres?.blocks || []) {
    for (const it of b.items) {
      const rows = it.sets
        .map(s => run?.sets?.[s.id])
        .filter(Boolean)
      if (!rows.length) continue

      if (it.kind === 'lift') {
        lifts.push({
          uid: it.id,
          key: it.exercise || null,
          name: it.name,
          group: it.group || null,
          implement: it.implement || '',
          implementLabel: it.implementLabel || null,
          // The same `{reps, weight}` rows the lift log writes. Strings there,
          // numbers here; `liftVolume` runs both through `Number()`.
          sets: rows.map(r => ({ reps: r.reps ?? '', weight: r.weight ?? '' })),
        })
        continue
      }

      for (const r of rows) {
        if (!(r.distance > 0)) continue
        const u = String(r.unit || it.unit || '').toLowerCase()
        if (u === 'yd' || u === 'yds' || u === 'm') {
          if (poolUnit && poolUnit !== u) continue
          poolUnit = u
          poolDistance += r.distance
        } else if (u === 'mi' || u === 'km') {
          if (distanceUnit && distanceUnit !== u) continue
          distanceUnit = u
          distance += r.distance
        }
      }
    }
  }

  if (lifts.length) next.lifts = lifts
  if (poolDistance > 0) next.poolDistance = Math.round(poolDistance)
  if (distance > 0) next.distance = Math.round(distance * 100) / 100

  return next
}

/**
 * Keep what the user has already done across an edit to the prescription.
 *
 * Ids are positional, so adding a set to block one renumbers everything after it.
 * Re-keying by (item name, set index) rather than by id is what stops that
 * renumbering from unticking half the session. An item the user deleted takes its
 * logged sets with it, which is correct — the user deleted it.
 */
export function remapRun(run, before, after) {
  if (!run?.sets) return run
  const key = (s) => `${s.itemName}::${s.index}`
  const old = new Map(prescriptionSteps(before).map(s => [s.setId, key(s)]))
  const next = new Map(prescriptionSteps(after).map(s => [key(s), s.setId]))

  const sets = {}
  for (const [id, value] of Object.entries(run.sets)) {
    const id2 = next.get(old.get(id))
    if (id2) sets[id2] = value
  }
  const skipped = (run.skipped || [])
    .map(id => next.get(old.get(id)))
    .filter(Boolean)
  return { ...run, sets, skipped, cursor: next.get(old.get(run.cursor)) || null }
}

/* ------------------------------------------------------------- the split */

/**
 * One planning run, several workouts.
 *
 * Selecting several workouts produces separate workouts on the plan rather than
 * one pooled workout, so attached WHOOP and Strava workouts land on the right
 * one.
 *
 * That is the argument that settles it, and it is not about quotas. A pooled
 * entry has ONE `out.whoop` and ONE `out.strava` — so a gym trip that was a lift
 * and a ride has one slot for two measurements, and whichever attaches first owns
 * it. Splitting gives each half its own entry, its own log form and its own place
 * for the watch to land. It also makes the quota question answer itself: one
 * entry, one category, which is what everything else in this app already assumes.
 *
 * THE RULE. A block with a `category` starts a workout. Consecutive blocks of the
 * same category are the SAME workout — a leg day with a main and an accessory
 * block is one lift, not two. A block with no category belongs to the workout
 * beside it: to the one before if there is one (a cool-down), and to the one
 * ahead if there is not (a warm-up written before anything else). A prescription
 * where no block names a category does not split at all, which is the ordinary
 * single-kind case and most of them.
 */
export function splitPrescription(pres) {
  const blocks = pres?.blocks || []
  if (!blocks.length) return []

  const groups = []
  let pending = []   // uncategorised blocks waiting for a workout to belong to

  for (const b of blocks) {
    if (!b.category) {
      // No workout open yet: hold it for the one ahead. Otherwise it trails the
      // one we are in.
      if (groups.length) groups.at(-1).blocks.push(b)
      else pending.push(b)
      continue
    }
    const last = groups.at(-1)
    if (last && last.category === b.category) {
      last.blocks.push(b)
      if (!last.activity) last.activity = b.activity || null
      continue
    }
    groups.push({
      category: b.category,
      activity: b.activity || null,
      name: b.name,
      blocks: [...pending, b],
    })
    pending = []
  }

  // Nothing named a category, or everything did but something trails: one workout.
  if (!groups.length) {
    return [{
      category: pres.category || null,
      activity: pres.activity || null,
      title: pres.title,
      pres: reindex({ ...pres }),
    }]
  }
  if (pending.length) groups[0].blocks = [...pending, ...groups[0].blocks]

  // One workout is the whole prescription, title and all — splitting a single
  // group would rename a session the user already named.
  if (groups.length === 1) {
    return [{
      category: groups[0].category || pres.category || null,
      activity: groups[0].activity || pres.activity || null,
      title: pres.title,
      pres: reindex({ ...pres, category: groups[0].category, activity: groups[0].activity }),
    }]
  }

  return groups.map(g => ({
    category: g.category,
    activity: g.activity,
    title: g.name || g.category,
    pres: reindex({
      ...pres,
      // Each half carries the whole reasoning: it was written about the trip, and
      // an entry that quotes half a paragraph reads worse than one that quotes it.
      title: g.name || g.category,
      category: g.category,
      activity: g.activity,
      minutes: null,
      blocks: g.blocks,
    }),
  }))
}

/* -------------------------------------------------------------- the editor */

/** Deep-ish clone with the ids re-minted, so an edit always renumbers cleanly. */
export function reindex(pres) {
  return {
    ...pres,
    blocks: (pres.blocks || []).map((b, bi) => ({
      ...b,
      id: `b${bi}`,
      items: b.items.map((it, ii) => ({
        ...it,
        id: `b${bi}i${ii}`,
        sets: it.sets.map((s, si) => ({ ...s, id: `b${bi}i${ii}s${si}` })),
      })),
    })),
  }
}

/*
 * Same survival rule the normaliser uses: a block lives on its items OR on its
 * note. Filtering on items alone here meant that editing one number anywhere in
 * the session silently deleted the prose warm-up — a different route to the same
 * bug, and the reason this predicate is written down twice rather than inlined.
 *
 * `keep` is the third arm and it belongs to the HAND-BUILT route: a block the user
 * made by picking a kind starts with nothing in it, and every edit anywhere else
 * in the session runs through `mapItem`. Without this, picking "Legs + Core" and
 * then typing a number into the first leg exercise deleted the core block the user had
 * not filled in yet — silently, and with no way to get it back. It is dropped for
 * real when the user keeps the session (`dropEmptyBlocks`), not while the user is building it.
 */
const blockSurvives = (b) => b.items.length > 0 || b.note || b.keep

const mapItem = (pres, itemId, fn) => reindex({
  ...pres,
  blocks: (pres.blocks || []).map(b => ({
    ...b,
    items: b.items.map(it => (it.id === itemId ? fn(it) : it)).filter(Boolean),
  })).filter(blockSurvives),
})

export const patchSet = (pres, itemId, setId, patch) =>
  mapItem(pres, itemId, it => ({
    ...it,
    sets: it.sets.map(s => (s.id === setId ? { ...s, ...patch } : s)),
  }))

/** Another set of the same thing, copying the last one — same rule `addLiftSet` follows. */
export const addSet = (pres, itemId) =>
  mapItem(pres, itemId, it => ({ ...it, sets: [...it.sets, { ...it.sets.at(-1) }] }))

/**
 * One more set of this, from the RUNNER, copying what the user just did rather than
 * what was planned: set three went to 37.5 and the fourth the user is adding is at
 * 37.5, not the prescription's 35. Without this, every added set meant typing
 * the weight in again — this is the button that does not.
 *
 * Appended at the END of the item on purpose. Ids are positional, so a set
 * inserted mid-item would renumber every set after it and orphan anything the user
 * had already logged there; appending renumbers nothing, which is why this
 * needs no `remapRun`. `like` may carry more than a set does (a draft has `at`,
 * a `unit`) — only the set fields are taken.
 */
export const addSetLike = (pres, itemId, like = null) =>
  mapItem(pres, itemId, it => {
    const row = { ...(it.sets.at(-1) || {}) }
    for (const f of SET_FIELDS) {
      const n = num(like?.[f])
      if (n !== null) row[f] = n
    }
    if (like?.unit) row.unit = str(like.unit, 12)
    return { ...it, sets: [...it.sets, row] }
  })

export const removeSet = (pres, itemId, setId) =>
  mapItem(pres, itemId, it => {
    const sets = it.sets.filter(s => s.id !== setId)
    // An item with no sets is an item the user is not doing.
    return sets.length ? { ...it, sets } : null
  })

export const removeItem = (pres, itemId) => mapItem(pres, itemId, () => null)

/**
 * Move one exercise up or down inside its own block.
 *
 * Backs the reorder mode, which strips each row down to the exercise name and
 * muscle groups and moves it with arrow buttons — this is a web app, not a
 * native one, so there is no dragging.
 *
 * WITHIN a block only. The blocks are the seams the session splits on (see
 * `splitPrescription`), so dragging a lift into the warm-up would silently move
 * it to a different entry and a different quota — a reorder should change the
 * order and nothing else.
 *
 * Ids are positional and `reindex` re-mints them, so a move renumbers every set
 * after it — which is why it hands back the moved item's NEW id along with the
 * prescription. The screen needs that to keep the glow on the row that moved,
 * and it is why this is a planning action rather than one offered mid-run.
 *
 * A move that would run off either end of the block is a no-op that still
 * answers, so the caller never has to special-case the first and last rows.
 */
export function moveItem(pres, itemId, dir) {
  const step = dir === 'up' ? -1 : 1
  let landed = itemId
  const blocks = (pres?.blocks || []).map((b, bi) => {
    const at = b.items.findIndex(it => it.id === itemId)
    if (at < 0) return b
    const to = at + step
    if (to < 0 || to >= b.items.length) return b
    const items = [...b.items]
    ;[items[at], items[to]] = [items[to], items[at]]
    landed = `b${bi}i${to}`
    return { ...b, items }
  })
  return { pres: reindex({ ...pres, blocks }), itemId: landed }
}

/**
 * Is this whole prescription lifting?
 *
 * Workout mode makes no sense for a lifting workout, which has no times. Once rest comes off
 * a lift set there is nothing left for a clock to run: no work interval, no rest
 * interval, nothing that advances on its own. So a lift-only session is edited
 * and ticked off in the sheet and is never handed the runner — the same judgement
 * `hasWorkout` makes for the climbing cards, applied to a prescription.
 *
 * MIXED sessions keep it. A gym trip that is squats then a twenty-minute row has
 * an interval in it, and the row is the part worth running.
 */
export function isLiftOnly(pres) {
  const blocks = (pres?.blocks || []).filter(b => (b.items || []).length)
  if (!blocks.length) return false
  /*
   * Judged on the blocks that are WORKOUTS.
   *
   * A block naming a category is a workout in its own right — that is the seam
   * the session splits on, see `splitPrescription`. One that names none is
   * attached to the block beside it, which is what a warm-up is. So five easy
   * minutes on the bike before a leg day does not turn a leg day into something
   * with a clock in it; a categorised twenty-minute row after one does.
   *
   * With nothing categorised at all, every block counts — there is no warm-up to
   * tell apart from the work.
   */
  const counted = blocks.some(b => b.category) ? blocks.filter(b => b.category) : blocks
  const items = counted.flatMap(b => b.items)
  return items.length > 0 && items.every(it => it.kind === 'lift')
}

export const patchItem = (pres, itemId, patch) => mapItem(pres, itemId, it => ({ ...it, ...patch }))

/** Change something about a block itself — its name, its note, its quota. */
export const patchBlock = (pres, blockId, patch) => ({
  ...pres,
  blocks: (pres.blocks || []).map(b => (b.id === blockId ? { ...b, ...patch } : b)),
})

/** A blank lift row, for adding a movement the planner did not think of. */
export function appendLift(pres, liftField, key, { blockId = null } = {}) {
  const ex = exerciseOf(liftField, key)
  if (!ex) return pres
  const offered = implementsFor(liftField, key)
  const implement = offered.length === 1 ? offered[0].value : ''
  const item = {
    id: 'new', kind: 'lift', name: ex.name, note: '',
    exercise: key, group: ex.group || null, implement,
    implementLabel: implement ? implementLabel(liftField, implement) : null,
    weightLabel: implement ? weightLabelFor(liftField, implement) : null,
    unit: null,
    sets: [{ id: 'new-s0', reps: null, weight: null, seconds: null, distance: null, restSec: null, unit: null, note: '' }],
  }
  const blocks = pres.blocks.length ? [...pres.blocks] : [{ id: 'b0', name: 'Added', note: '', items: [] }]
  const at = Math.max(0, blockId ? blocks.findIndex(b => b.id === blockId) : blocks.length - 1)
  blocks[at] = { ...blocks[at], items: [...blocks[at].items, item] }
  return reindex({ ...pres, blocks })
}

/* ------------------------------------------------------------ built by hand

 * When planning a workout, the user can build it by hand by picking exercises,
 * or take the AI route.
 *
 * So a prescription now has two authors. Everything below the fork is the same
 * object either way — the same editor renders it, the same `splitPrescription`
 * decides where it lands, the same runner walks it — because the only difference
 * between the two routes is who typed the numbers. What the model writes it
 * cannot be said to have earned; what the user writes it cannot be said to have
 * misread. The shape is not an opinion about either.
 */

/**
 * A workout with nothing in it yet.
 *
 * `normalizePrescription` deliberately returns null for a plan with no sets in
 * it — a model that answers with three paragraphs and no work has not written a
 * workout — so a blank one cannot come through there and is built here instead.
 *
 * The blocks come from the kinds the user picked, which is what makes the hand-built
 * route worth funnelling through the same screen as the model's: a block carries
 * the quota it fills and the seam the session splits on, and "Legs + a ride" has
 * to land as two entries by hand for exactly the reason it does by model.
 */
export function blankPrescription({
  title = 'Workout', category = null, activity = null, blocks = [],
  at = new Date().toISOString(),
} = {}) {
  const rows = blocks.length ? blocks : [{ name: title }]
  return {
    v: PRESCRIPTION_VERSION,
    title: str(title, 80) || 'Workout',
    category: category || null,
    activity: activity || null,
    focus: null,
    minutes: null,
    why: '',
    notes: [],
    changed: null,
    blocks: rows.map((b, i) => ({
      id: `b${i}`,
      name: str(b.name, 60) || `Block ${i + 1}`,
      note: '',
      category: b.category || null,
      activity: b.activity || null,
      // Their, and therefore kept while it is still empty. See `blockSurvives`.
      keep: true,
      items: [],
    })),
    createdAt: at,
    // NOT "a model", because none wrote it. Every screen that names an author
    // reads this, so leaving it null is what stops a session the user wrote themselves
    // being credited to something else.
    model: null,
  }
}

/**
 * What one press of the add button puts in a piece, by the shape the user chose.
 *
 * A NUMBER rather than a blank, because this is the one place in the app where
 * pre-filling is right: the runner's boxes arrive filled in for the same reason
 * (see §9 in AGENTS.md) — it is a target the user is looking at and about to change,
 * not a guess standing in for an answer the user never gave. A piece that arrives
 * reading "1 × 0 mi" reads as broken rather than as blank.
 */
const PIECE_SHAPES = {
  time: () => ({ seconds: 300 }),
  distance: (unit) => ({ distance: unit === 'yd' ? 100 : 1 }),
  reps: () => ({ reps: 1 }),
}

/**
 * A piece of work that is not a movement out of the catalog — an interval.
 *
 * The exercise picker is two hundred LIFTS, which is the whole answer for a gym
 * day and none of it for a swim, a ride or a set of 4x4s. So the hand-built route
 * needs the other half: a named piece with one set, measured the way that work is
 * actually measured.
 *
 * The SHAPE is chosen when the piece is added, because `setFieldsFor` shows an
 * interval the fields it carries and nothing else — a swim set has no reps and a
 * plank has no distance, and offering every box on every piece is the app
 * guessing at the shape of work it was handed. A piece added with the wrong one
 * is removed and added again; that is two taps, and it is cheaper than four empty
 * steppers on every row for the rest of the session.
 */
export function appendPiece(pres, name, { blockId = null, by = 'time', unit = null } = {}) {
  const label = str(name, 80)
  if (!label) return pres
  const u = by === 'distance' ? (str(unit, 12) || 'mi') : null
  const shape = (PIECE_SHAPES[by] || PIECE_SHAPES.time)(u)
  const item = {
    id: 'new', kind: 'interval', name: label, note: '',
    exercise: null, group: null, implement: '',
    implementLabel: null, weightLabel: null,
    unit: u,
    sets: [{
      id: 'new-s0', reps: null, weight: null, seconds: null, distance: null,
      restSec: null, unit: u, note: '', ...shape,
    }],
  }
  const blocks = pres?.blocks?.length
    ? [...pres.blocks]
    : [{ id: 'b0', name: 'Added', note: '', items: [] }]
  const at = Math.max(0, blockId ? blocks.findIndex(b => b.id === blockId) : blocks.length - 1)
  blocks[at] = { ...blocks[at], items: [...blocks[at].items, item] }
  return reindex({ ...pres, blocks })
}

/**
 * The blocks the user never filled in, dropped — on the way OUT, and only then.
 *
 * An empty block survives being edited (see `blockSurvives`) so that picking two
 * kinds and starting on the first does not delete the second. It must not survive
 * being kept: `splitPrescription` cuts on blocks that name a category, so an
 * empty one the user changed their mind about would land on their day as a whole entry with
 * no work in it.
 */
export const dropEmptyBlocks = (pres) => reindex({
  ...pres,
  blocks: (pres?.blocks || []).filter(b => (b.items || []).length > 0 || b.note),
})

export { catalogOf }
