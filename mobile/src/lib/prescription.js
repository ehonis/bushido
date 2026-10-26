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

import {
  catalogOf, exerciseOf, implementLabel, implementsFor, weightPatch, rememberedWeightMode, measureFor,
} from './lifts.js'
import {
  normalizeCircuit, circuitConfig, circuitOf, compile, totalSeconds, circuitDone, view, CIRCUIT_DEFAULT, LIMITS,
} from './timer.js'
import { localIso } from './dates.js'

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

/**
 * A block's or item's `uid`, kept as given. A shared workout's sync matches by it
 * (server/sharedsync.js), so a revision that renames an exercise must hand it back
 * or the rename reads as a removal plus an addition on the other person's side.
 * Absent stays absent: the server mints one when it first syncs the plan.
 */
const uidOf = (v) => {
  const u = typeof v === 'string' ? v.trim() : ''
  return /^[\w.-]{1,64}$/.test(u) ? { uid: u } : {}
}

function normalizeBlock(b, bi, liftField) {
  const id = `b${bi}`
  const circuit = normalizeCircuit(b?.circuit)
  const items = (Array.isArray(b?.items) ? b.items : [])
    .slice(0, MAX_ITEMS)
    .map((it, ii) => normalizeItem(it, `${id}i${ii}`, liftField, circuit))
    .filter(Boolean)
  return {
    id, ...uidOf(b?.uid),
    name: str(b?.name, 60) || `Block ${bi + 1}`,
    note: str(b?.note, 300),
    // Which quota THIS block fills, and what its log form asks for. Null on a
    // warm-up, which is not a workout in its own right. A block that names a
    // category becomes its own ENTRY — see splitPrescription().
    category: str(b?.category, 40) || null,
    activity: str(b?.activity, 40) || null,
    // A timed circuit (issue #68): only on a block that is one.
    ...(circuit ? { circuit } : {}),
    items,
  }
}

/** A set with nothing in it: in a circuit, "the circuit's own time". */
const blankSet = (id, unit = null) => ({ id, reps: null, weight: null, seconds: null, distance: null, restSec: null, unit, note: '' })

function normalizeItem(it, id, liftField, circuit = null) {
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
  let weightMode = null
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
    // What the weight means: the implement's default unless the item says
    // otherwise (lib/lifts.js, `weightModesFor`).
    if (implement && liftField) ({ weightMode, weightLabel: weightLbl } = weightPatch(liftField, implement, it.weightMode))
  }

  if (!name) return null

  const unit = str(it.unit, 12) || null
  let sets = (Array.isArray(it.sets) ? it.sets : [])
    .slice(0, MAX_SETS)
    .map((s, si) => normalizeSet(s, `${id}s${si}`, unit, kind))
    .filter(Boolean)

  // In a circuit an exercise is ONE set: its own seconds or reps, or nothing,
  // which is the circuit's time. The rounds are the circuit's (`circuit.rounds`).
  if (circuit) sets = sets.length ? sets.slice(0, 1) : [blankSet(`${id}s0`, unit)]

  // An item with no sets is a sentence, not a piece of work. The planner is told
  // to put those in the block's note.
  if (!sets.length) return null

  const known = kind === 'lift' && liftField && exercise ? exerciseOf(liftField, exercise) : null
  const measure = kind === 'lift' ? itemMeasure(it, sets, known) : 'reps'
  // Seconds win on a hold: a reps count beside them would be read instead.
  if (measure === 'time') sets.forEach(s => { if (s.seconds !== null) s.reps = null })

  return {
    id, ...uidOf(it.uid), kind, name, note: str(it.note, 300),
    exercise, group, implement,
    implementLabel: implementLbl, weightLabel: weightLbl,
    ...(weightMode ? { weightMode } : {}),
    // Only a hold says so, as only a departure from the default weight mode
    // does: an item without it is reps, which every item before #63 was. A hold
    // someone switched to reps says that, or the catalog would switch it back.
    ...(measure === 'time' || (it.measure === 'reps' && known?.measure === 'time') ? { measure } : {}),
    unit, sets,
  }
}

/**
 * A lift item held for time (issue #63) or done for reps, as it is READ: what
 * its sets carry first (seconds and no reps is a hold, reps and no seconds is
 * not, whatever the item says, so a hold whose `measure` was lost still asks
 * for seconds), then what the item says. A blank is `''` on a logged row and
 * `null` on a plan, and a logged row's blank still has its key, which is its
 * measure (lib/lifts.js `liftMeasure`).
 */
export function measureOfItem(item) {
  const sets = Array.isArray(item?.sets) ? item.sets : []
  const has = (f) => sets.some(s => s?.[f] !== null && s?.[f] !== undefined)
  if (has('seconds') && !has('reps')) return 'time'
  if (has('reps') && !has('seconds')) return 'reps'
  return item?.measure === 'time' ? 'time' : 'reps'
}

/**
 * The same, as it is WRITTEN by `normalizePrescription`: the sets, then the
 * item's word, then the catalog, so a planned Plank written as reps before the
 * catalog called it a hold stays reps. A set with both (a model's `{ reps: 1,
 * seconds: 45 }`) is a hold when the catalog says so, and its reps go.
 */
function itemMeasure(it, sets, ex) {
  const has = (f) => sets.some(s => s[f] !== null && s[f] !== undefined)
  if (has('seconds') && !has('reps')) return 'time'
  if (has('reps') && !has('seconds')) return 'reps'
  if (has('reps')) return ex?.measure === 'time' || it.measure === 'time' ? 'time' : 'reps'
  if (it.measure === 'time' || it.measure === 'reps') return it.measure
  return ex?.measure === 'time' ? 'time' : 'reps'
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
  // A circuit's exercises are one set each on paper; what it has is rounds.
  const sets = prescriptionSteps(pres).filter(s => !s.block.circuit).length
  const circuits = (pres.blocks || []).filter(b => b.circuit && b.items.length)
  const word = (pres.blocks || []).some(b => b.circuit || b.items.some(i => i.kind === 'lift')) ? 'exercise' : 'piece'
  const minutes = pres.minutes || circuitMinutes(pres)
  return [
    items ? `${items} ${word}${items === 1 ? '' : 's'}` : null,
    circuits.length === 1 ? `${circuits[0].circuit.rounds} round${circuits[0].circuit.rounds === 1 ? '' : 's'}`
      : circuits.length > 1 ? `${circuits.length} circuits` : null,
    sets ? `${sets} set${sets === 1 ? '' : 's'}` : null,
    minutes ? `about ${minutes} min` : null,
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
 * A LIFT always shows reps and weight, present or not (seconds and weight for
 * one held for time, `measure: "time"`, issue #63). The planner is told to
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
  if (item?.kind === 'lift') return measureOfItem(item) === 'time' ? ['seconds', 'weight'] : ['reps', 'weight']
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
 * the log says what happened, and whether it was done is the entry's (`isDone`),
 * not a row of zeroes in the volume chart.
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
      // A circuit's exercise: one logged row, a set per round it was done in.
      if (b.circuit) {
        const row = circuitRow(it, run?.sets?.[it.sets[0]?.id])
        if (row) lifts.push(row)
        continue
      }
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
          // A mode travels with its label, as the lift log stores it (lib/lifts.js).
          ...(it.weightMode ? { weightMode: it.weightMode, weightLabel: it.weightLabel || null } : {}),
          // The same `{reps, weight}` rows the lift log writes (`{seconds,
          // weight}` for a hold). Strings there, numbers here; `liftVolume`
          // runs both through `Number()`.
          sets: rows.map(r => (measureOfItem(it) === 'time'
            ? { seconds: r.seconds ?? '', weight: r.weight ?? '' }
            : { reps: r.reps ?? '', weight: r.weight ?? '' })),
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
  // A workout that was nothing but circuits was timed by them, pauses left out:
  // that is the workout-mode clock's measured minutes (lib/minutes.js), which
  // beat the card's estimate however short, so they round up and are never 0.
  const timed = circuitTime(run)
  if (circuitOnly(pres) && timed > 0) next.elapsedMin = Math.max(1, Math.ceil(timed / 60))

  return next
}

/* --------------------------------------------------------------- circuits */

/*
 * A CIRCUIT BLOCK (issue #68): `circuit: { work, rest, rounds, roundRest,
 * countIn }` on the block, and each item ONE set saying how it is timed: its
 * own `seconds`, `reps` ("tap when done"), or nothing, which is the circuit's
 * `work`. It runs on the interval timer (lib/timer.js), the program compiled
 * from the block every time, so the timer's position on the entry
 * (`data.run.circuit`) is all that is stored while it runs.
 *
 * When it ends, finished or stopped, each item's set is marked in `run.sets`
 * with the seconds worked each round (`rounds`), and `runOutputs` turns that
 * into an ordinary logged lift row, edited afterwards like any other: a timed
 * exercise as `{ seconds, weight }` sets, one by reps as `{ reps, weight }`
 * sets with the count left for them to fill in.
 */

/**
 * How a circuit item is timed: `{ by: 'circuit' | 'time' | 'reps', seconds, reps }`.
 * Seconds with at most one rep is a timed exercise: a model writes a plank as
 * `{ reps: 1, seconds: 60 }`, library key or not, and that is sixty seconds.
 */
export function circuitTiming(item) {
  const s = item?.sets?.[0] || {}
  const reps = num(s.reps)
  const seconds = num(s.seconds)
  if (seconds > 0 && !(reps > 1)) return { by: 'time', seconds, reps: null }
  if (reps > 0) return { by: 'reps', reps, seconds: null }
  return { by: 'circuit', seconds: null, reps: null }
}

/** A circuit block as the interval timer's config, one exercise per item, in order. */
export function blockTimer(block) {
  return circuitConfig(block?.circuit, (block?.items || []).map(it => {
    const t = circuitTiming(it)
    return {
      name: it.name,
      ...(it.exercise ? { key: it.exercise } : {}),
      ...(t.by === 'reps' ? { reps: t.reps } : t.by === 'time' ? { seconds: t.seconds } : {}),
    }
  }))
}

/** A circuit block's exercises are all marked done or skipped on this run. */
export const circuitEnded = (block, run) => (block?.items || []).every(it =>
  Boolean(run?.sets?.[it.sets?.[0]?.id]) || (run?.skipped || []).includes(it.sets?.[0]?.id))

/** The next circuit in a plan this run has not been through, or null. */
export const nextCircuit = (pres, run) =>
  (pres?.blocks || []).find(b => b.circuit && b.items.length && !circuitEnded(b, run)) || null

/**
 * Which circuit the runner opens on, or null for the runner itself. One with
 * its timer on the entry comes back running. A plan that is nothing but
 * circuits opens on its first not yet done, so Start runs it, but only on the
 * side that is on screen: a shared workout's other sides wait on their own
 * Start, or one person starting would start the other's clock and log for them.
 */
export function circuitToOpen(pres, run, { shown = true } = {}) {
  if (run?.circuit?.block) return run.circuit.block
  if (!shown || !circuitOnly(pres) || run?.endedAt) return null
  return nextCircuit(pres, run)?.id || null
}

/** Is everything there is to run in this plan a circuit? Then Start runs the timer straight away. */
export function circuitOnly(pres) {
  const work = (pres?.blocks || []).filter(b => (b.items || []).length)
  return work.length > 0 && work.every(b => b.circuit)
}

/** About how long the circuits take, in minutes, or null when a count-up makes it unknowable. */
export function circuitMinutes(pres) {
  const blocks = (pres?.blocks || []).filter(b => b.circuit && b.items.length)
  if (!blocks.length || !circuitOnly(pres)) return null
  let sum = 0
  for (const b of blocks) {
    const t = totalSeconds(compile(blockTimer(b)))
    if (t == null) return null
    sum += t
  }
  return Math.max(1, Math.round(sum / 60))
}

/** One item's logged row, from what the circuit marked on its set, or null. */
function circuitRow(it, mark) {
  const rounds = Array.isArray(mark?.rounds) ? mark.rounds.filter(n => Number(n) > 0) : []
  if (!rounds.length) return null
  const byReps = circuitTiming(it).by === 'reps'
  // The planned weight is what it was done with: a plan says "15 @ 10 lb".
  const weight = num(it.sets[0]?.weight) ?? ''
  return {
    uid: it.id,
    key: it.exercise || null,
    name: it.name,
    group: it.group || null,
    implement: it.implement || '',
    implementLabel: it.implementLabel || null,
    ...(it.weightMode ? { weightMode: it.weightMode, weightLabel: it.weightLabel || null } : {}),
    sets: rounds.map(n => (byReps ? { reps: '', weight } : { seconds: Math.round(n), weight })),
  }
}

/**
 * The run, with a circuit block's result in it: each item marked with the
 * seconds worked per round (`done` is lib/timer.js `circuitDone`, by item
 * index), an item never reached skipped, the timer's position cleared and the
 * cursor on whatever comes next. `seconds` is the time the circuit took,
 * pauses left out.
 *
 * `key` (the timer run's `startedAt`) makes it safe to write twice: a result
 * already on this run under the same key returns the run as it is, so a retried
 * write of a circuit done together (lib/trainer.js `togetherWrite`) can never
 * add its minutes twice.
 */
export function endCircuit(run, pres, blockId, done = [], { at = Date.now(), seconds = 0, key = null, fill = false } = {}) {
  if (key != null && run?.circuitKeys?.[blockId] === key) return run
  const base = run || emptyRun(at)
  const block = (pres?.blocks || []).find(b => b.id === blockId)
  if (!block) return { ...base, circuit: null }
  const sets = { ...base.sets }
  let skipped = [...(base.skipped || [])]
  block.items.forEach((it, i) => {
    const setId = it.sets[0]?.id
    if (!setId) return
    // `fill` (a result from someone else's clock, lib/trainer.js `togetherWrite`):
    // an exercise this side already marked or skipped keeps what it has.
    if (fill && (sets[setId] || skipped.includes(setId))) return
    const rounds = (done[i] || []).map(n => Math.round(n)).filter(n => n > 0)
    if (rounds.length) {
      sets[setId] = { ...(circuitTiming(it).by === 'reps' ? {} : { seconds: rounds.reduce((a, b) => a + b, 0) }), rounds, at }
      skipped = skipped.filter(id => id !== setId)
    } else if (!sets[setId] && !skipped.includes(setId)) skipped.push(setId)
  })
  // Each block's own time, SET and never added to: the total is read off these
  // (`circuitTime`), so writing a block's result again cannot count it twice, and
  // a time this side already has for the block is its own and stays.
  const times = base.circuitTimes || {}
  const time = fill && times[blockId] != null ? times[blockId] : Math.max(0, Math.round(seconds))
  const next = {
    ...base, startedAt: base.startedAt || at, sets, skipped, circuit: null,
    circuitTimes: { ...times, [blockId]: time },
    ...(key != null ? { circuitKeys: { ...(base.circuitKeys || {}), [blockId]: key } } : {}),
    restUntil: 0, restFrom: 0, restOf: 0,
  }
  return { ...next, cursor: firstOpen(next, prescriptionSteps(pres)) }
}

/** Seconds this run spent in its circuits, pauses left out: the sum of each block's own. */
export const circuitTime = (run) =>
  Object.values(run?.circuitTimes || {}).reduce((sum, n) => sum + (Number(n) > 0 ? Number(n) : 0), 0)

/**
 * `out` with `next`'s logged lifts laid into it as BLANKS ONLY (a circuit done
 * together, lib/trainer.js): a row this side already has (same uid, else same
 * exercise and name) keeps every seconds, reps and weight it has and gains only
 * what it lacks, set by set; a row it lacks is added; a row only it has stays.
 * Its own measured minutes stay too. Logged data is never removed or replaced
 * by anyone else's write, the shared-sync rule (AGENTS.md §3).
 */
export function fillOut(out = {}, next = {}) {
  const mine = Array.isArray(out.lifts) ? out.lifts : []
  const blank = (v) => v === '' || v === null || v === undefined
  // A row is the same exercise by uid; one added by hand (its own uid) by its
  // catalog key, then by name, so it is filled rather than doubled. Each pass
  // runs over every row, uid first, so a hand-added row never takes the
  // partner of one that has it by uid.
  const rows = next.lifts || []
  const used = new Set()
  const pair = new Map()
  for (const same of [(a, b) => a?.uid && b?.uid === a.uid, (a, b) => a?.key && b?.key === a.key, (a, b) => a?.name && b?.name === a.name]) {
    mine.forEach((row, m) => {
      if (pair.has(m)) return
      const i = rows.findIndex((r, n) => !used.has(n) && same(row, r))
      if (i >= 0) { pair.set(m, i); used.add(i) }
    })
  }
  const lifts = mine.map((row, m) => {
    if (!pair.has(m)) return row
    const at = pair.get(m)
    const theirs = next.lifts[at]
    const sets = [...(row.sets || [])]
    ;(theirs.sets || []).forEach((t, i) => {
      if (!sets[i]) { sets[i] = t; return }
      const s = { ...sets[i] }
      for (const k of Object.keys(t)) if (blank(s[k]) && !blank(t[k])) s[k] = t[k]
      sets[i] = s
    })
    return { ...row, sets }
  })
  ;(next.lifts || []).forEach((r, i) => { if (!used.has(i)) lifts.push(r) })
  return {
    ...out,
    ...(lifts.length ? { lifts } : {}),
    ...(!(Number(out.elapsedMin) > 0) && next.elapsedMin ? { elapsedMin: next.elapsedMin } : {}),
  }
}

/**
 * Switch a block to a circuit, or back. On: every exercise keeps its first set
 * as its timing (seconds are its own time, reps are reps, a blank is the
 * circuit's), and the rounds are the most sets any of them had, so "3 × 15
 * crunches" becomes three rounds of fifteen. Off: the block is plain sets again,
 * one each, to add to, and its timing waits on the block (`wasCircuit`) so
 * switching back on is the circuit it was. `dropEmptyBlocks` drops that on the
 * way out.
 */
export function setCircuit(pres, blockId, on) {
  return reindex({
    ...pres,
    blocks: (pres?.blocks || []).map(b => {
      if (b.id !== blockId) return b
      if (!on) {
        const { circuit, ...rest } = b
        return circuit ? { ...rest, wasCircuit: circuit } : rest
      }
      if (b.circuit) return b
      const { wasCircuit, ...rest } = b
      const most = Math.max(0, ...b.items.map(it => it.sets.length))
      const rounds = most > 1 ? Math.min(LIMITS.rounds[1], most) : CIRCUIT_DEFAULT.rounds
      const circuit = normalizeCircuit(wasCircuit) || { ...CIRCUIT_DEFAULT, rounds }
      return { ...rest, circuit, items: b.items.map(it => ({ ...it, sets: it.sets.slice(0, 1) })) }
    }),
  })
}

/** A circuit item's timing, set: `{ seconds }`, `{ reps }` or `{}` for the circuit's. */
export const setTiming = (pres, itemId, { seconds = null, reps = null } = {}) =>
  mapItem(pres, itemId, it => ({
    ...it,
    sets: [{ ...(it.sets[0] || blankSet('new-s0')), seconds: reps ? null : seconds, reps: reps || null }],
  }))

/**
 * A timer preset with exercises (issue #68), as a plan: one circuit block,
 * each exercise out of the library where it is one, the rest named pieces.
 * Placing it ("Put it on today") and logging a run of it both go through this,
 * so both land as the same planned workout.
 */
export function circuitPlan(name, config, liftField = null, { at = new Date().toISOString(), category = null, activity = null } = {}) {
  const title = str(name, 80) || 'Circuit'
  let pres = blankPrescription({ title, category, activity, blocks: [{ name: title, category, activity }], at })
  pres = { ...pres, blocks: [{ ...pres.blocks[0], circuit: circuitOf(config) }] }
  for (const ex of config?.exercises || []) {
    pres = liftField && ex.key && exerciseOf(liftField, ex.key)
      ? appendLift(pres, liftField, ex.key)
      : appendNamed(pres, ex.name)
    const it = pres.blocks[0].items.at(-1)
    if (it) pres = setTiming(pres, it.id, { seconds: ex.seconds ?? null, reps: ex.reps ?? null })
  }
  const { keep: _k, ...block } = pres.blocks[0]
  pres = { ...pres, blocks: [block] }
  return { ...pres, minutes: circuitMinutes(pres) }
}

/**
 * Where a circuit from the timer is filed, which nothing else on it says.
 * `categories` and `activities` are the content's (`quotaCategories`, the
 * activity catalog). A category named like the group most of its exercises are
 * in ("Core") wins; otherwise it is filed as the content's lifting workout: the
 * first activity whose shape the lift log asks for (`liftField.when.shape`),
 * with that activity's category. Content decides both; nothing here names one.
 */
export function circuitFiling(config, liftField = null, { categories = [], activities = [] } = {}) {
  const groups = (config?.exercises || []).map(x => exerciseOf(liftField, x.key)?.group).filter(Boolean)
  const count = new Map()
  for (const g of groups) count.set(g, (count.get(g) || 0) + 1)
  const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null
  const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()
  const byGroup = top && (categories || []).find(c => same(c?.key, top) || same(c?.name, top))
  if (byGroup) return { category: byGroup.key, activity: null }
  const shapes = liftField?.when?.shape || []
  const act = (activities || []).find(a => shapes.includes(a?.shape))
  return act ? { category: act.category || null, activity: act.key } : { category: null, activity: null }
}

/**
 * A run of a timer preset with exercises, as the workout it logs (issue #68):
 * the preset as a plan (`circuitPlan`), its run finished with what each
 * exercise did each round, and the log that makes. Null when nothing was done,
 * so a circuit stopped in its count-in logs nothing. `timerRun` is lib/timer.js's.
 * `date` is the day it was STARTED: a circuit begun at nine at night and found
 * finished the next morning is the night's.
 */
export function loggedCircuit(name, config, timerRun, liftField = null, filing = {}) {
  if (!timerRun || timerRun.finishedAt == null) return null
  const program = compile(config)
  const done = circuitDone(program, timerRun)
  if (!done.some(d => d.length)) return null
  const at = timerRun.finishedAt
  const pres = circuitPlan(name, config, liftField, { ...filing, at: new Date(timerRun.startedAt).toISOString() })
  const seconds = view(program, timerRun, at).elapsed
  const run = finishRun(endCircuit(emptyRun(timerRun.startedAt), pres, 'b0', done, { at, seconds }), { at })
  return { pres, run, out: runOutputs(pres, run, {}), date: localIso(new Date(timerRun.startedAt)) }
}

/** An exercise that is not in the library, by name, timed like the rest of its circuit. */
function appendNamed(pres, name) {
  const label = str(name, 80)
  if (!label) return pres
  const item = {
    id: 'new', kind: 'interval', name: label, note: '',
    exercise: null, group: null, implement: '', implementLabel: null, weightLabel: null,
    unit: null, sets: [blankSet('new-s0')],
  }
  const blocks = [...pres.blocks]
  blocks[0] = { ...blocks[0], items: [...blocks[0].items, item] }
  return reindex({ ...pres, blocks })
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
  // A circuit runs on a clock whatever is in it (issue #68).
  if (counted.some(b => b.circuit)) return false
  const items = counted.flatMap(b => b.items)
  return items.length > 0 && items.every(it => it.kind === 'lift')
}

export const patchItem = (pres, itemId, patch) => mapItem(pres, itemId, it => {
  const next = { ...it, ...patch }
  // Only a departure from the default is stored (lib/lifts.js `weightModeOf`).
  if (next.weightMode == null) delete next.weightMode
  return next
})

/**
 * The plan item and the logged row it became, as pairs. `runOutputs` gives the
 * row the item's id as its uid and the item's name; ids are positional, so the
 * name has to agree too, or a row would pair with whatever item an edit moved
 * into its old place.
 */
function loggedPairs(data) {
  const rows = Array.isArray(data?.out?.lifts) ? data.out.lifts : []
  return (data?.plan?.blocks || []).flatMap(b => b?.items || []).filter(it => it?.kind === 'lift').flatMap(item => {
    const row = rows.find(r => r?.uid === item.id && r.name === item.name && r.key === item.exercise && r.implement === item.implement)
    return row ? [{ item, row }] : []
  })
}

/** An item or row as it is apart from what its weight means: the same before and after only if a write just switched it. */
const besideMode = ({ weightMode: _m, weightLabel: _l, ...rest }) => JSON.stringify(rest)

/** An item or row in a mode: only a departure from the default is stored. */
function inMode(x, liftField, mode) {
  const { weightMode, weightLabel } = weightPatch(liftField, x.implement, mode)
  const { weightMode: _m, ...rest } = x
  return weightMode ? { ...rest, weightMode, weightLabel } : { ...rest, weightLabel }
}

/**
 * ONE meaning for one exercise on an entry that was run (#58).
 *
 * A planned session's sheet shows the plan AND the log its run wrote, so one
 * exercise has a weight switch in each. They are kept as one value rather than
 * one of them hidden: whichever side this write switched (`before` → `after`,
 * both an entry's `data`), the other follows, and nothing else on either moves,
 * so numbers edited on the log afterwards and lifts added by hand stay as they
 * are. A pair that already disagreed and that this write did not touch is left
 * alone (stored data is never rewritten to suit the code).
 *
 * A side counts as switched only when this write changed nothing else about it:
 * the same item (or row) under the same id, apart from its mode and label. Ids
 * are positional, so after a removal or a move an id names another item, and
 * following then would rewrite the wrong exercise's log (review of #60:
 * deleting the first of two split squats set its logged row to the back-off's
 * mode). Returns `after` itself when there is nothing to follow.
 */
export function followWeightModes(before, after, liftField) {
  const pairs = loggedPairs(after)
  if (!pairs.length) return after
  const was = new Map(loggedPairs(before).map(p => [p.item.id, p]))
  let plan = after.plan
  let lifts = after.out.lifts
  for (const { item, row } of pairs) {
    const im = item.weightMode || null
    const rm = row.weightMode || null
    if (im === rm) continue
    const old = was.get(item.id)
    if (!old || besideMode(old.item) !== besideMode(item) || besideMode(old.row) !== besideMode(row)) continue
    if ((old.item.weightMode || null) !== im) {
      lifts = lifts.map(r => (r === row ? inMode(r, liftField, im) : r))
    } else if ((old.row.weightMode || null) !== rm) {
      plan = mapItem(plan, item.id, it => inMode(it, liftField, rm))
    }
  }
  if (plan === after.plan && lifts === after.out.lifts) return after
  return { ...after, plan, out: { ...after.out, lifts } }
}

/**
 * Something about one exercise changed mid-run (its weight mode, #58): the plan,
 * and its logged row in the same write (`followWeightModes`), or the log, "last
 * time" and memory would keep the old meaning; `runOutputs` only runs again when
 * a set is marked, and the label is often tapped after the last one.
 */
export function patchRunItem(pres, run, itemId, patch, out = {}, liftField = null) {
  const plan = patchItem(pres, itemId, patch)
  const next = followWeightModes({ plan: pres, out }, { plan, out }, liftField)
  return next.out === out ? { plan } : { plan, out: next.out }
}

/**
 * A model's revision, with the weight modes put back (#58).
 *
 * The model is never asked what a weight means, so its answer is in every
 * implement's default. An exercise it kept, on the same implement, keeps exactly
 * what it had, a deliberate default included: matched by `uid` where there are
 * uids, else by exercise, each earlier item used once. Only an exercise new in
 * the revision (or moved to another implement) gets memory
 * (`rememberedWeightMode`, from `entries`). server/drafts.js does the same to a
 * draft, where it survives the page closing.
 */
export function reviseWeightModes(before, after, liftField, entries = [], { excludeId = null, today } = {}) {
  if (!after?.blocks) return after
  const left = (before?.blocks || []).flatMap(b => b.items || []).filter(it => it.kind === 'lift')
  const take = (it) => {
    const at = it.uid ? left.findIndex(o => o.uid === it.uid) : left.findIndex(o => !o.uid && o.exercise === it.exercise)
    return at < 0 ? null : left.splice(at, 1)[0]
  }
  return {
    ...after,
    blocks: after.blocks.map(b => ({
      ...b,
      items: b.items.map(it => {
        if (it.kind !== 'lift' || !it.exercise || !it.implement) return it
        const old = take(it)
        const mode = old && old.implement === it.implement ? (old.weightMode || null)
          : rememberedWeightMode(liftField, entries, it.exercise, it.implement, excludeId, today)
        return inMode(it, liftField, mode)
      }),
    })),
  }
}

/** Change something about a block itself — its name, its note, its quota. */
export const patchBlock = (pres, blockId, patch) => ({
  ...pres,
  blocks: (pres.blocks || []).map(b => (b.id === blockId ? { ...b, ...patch } : b)),
})

/**
 * A blank lift row, for adding a movement the planner did not think of. An
 * implement chosen for it starts in the weight mode the exercise was last
 * logged in, as on the log (`addLift`).
 */
export function appendLift(pres, liftField, key, { blockId = null, entries = [], excludeId = null } = {}) {
  const ex = exerciseOf(liftField, key)
  if (!ex) return pres
  const offered = implementsFor(liftField, key)
  const implement = offered.length === 1 ? offered[0].value : ''
  const { weightMode, weightLabel } = implement
    ? weightPatch(liftField, implement, rememberedWeightMode(liftField, entries, key, implement, excludeId))
    : { weightMode: null, weightLabel: null }
  const item = {
    id: 'new', kind: 'lift', name: ex.name, note: '',
    exercise: key, group: ex.group || null, implement,
    implementLabel: implement ? implementLabel(liftField, implement) : null,
    weightLabel, ...(weightMode ? { weightMode } : {}),
    ...(measureFor(liftField, key) === 'time' ? { measure: 'time' } : {}),
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
  blocks: (pres?.blocks || []).filter(b => (b.items || []).length > 0 || b.note)
    // A circuit switched off in the editor has nothing left to come back to.
    .map(({ wasCircuit: _w, ...b }) => b),
})

export { catalogOf }
