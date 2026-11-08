/*
 * Gear: what you own, and what it has done.
 *
 * Modelled on how Strava handles gear: dates and mileage on each item, and the
 * ability to attach gear to a workout. What it replaced was a 17-item BUYING list with prices and a paragraph
 * each on whether to purchase them, of which three were ever marked bought. The
 * old object had no notion of use at all; this one is mostly about use.
 *
 * TWO ORIGINS, AND THE SPLIT IS DELIBERATE.
 *
 * Strava owns bikes and shoes. It has their real odometers, it keeps counting them
 * whether or not this app is running, and it is the number the user already trusts. So
 * those are SYNCED: read-only here, `source: 'strava'`, and the odometer on screen
 * is Strava's own. Everything Strava has never heard of — ropes, harnesses, the
 * Port-A-Board, a stack of cast-iron plates — the user adds here, and the app counts
 * their use out of the log.
 *
 * The alternative was importing Strava's gear once and letting the app count
 * everything itself. That produces two odometers for one bike which disagree
 * quietly and forever, and the one people believe is the one on Strava.
 *
 * WHAT A KIND IS MEASURED IN is a property of the kind, declared in plan.json:
 * miles for bikes and shoes, time for climbing gear, time AND reps for weights,
 * because a 40-minute session and 300 reps are different kinds of wear. So adding a kind
 * is content, and no code here knows what a rope is.
 *
 * THE MILEAGE GAP, stated rather than hidden. A trainer ride logged here with no
 * Strava activity attached never reaches Strava's odometer. So a synced item shows
 * Strava's number as the headline and, separately, whatever this app logged
 * against it that Strava cannot have seen. Adding those together into one total
 * would silently double-count every ride that WAS on Strava.
 */

import { isDone } from './store.js'
import { optFor } from './menu.js'
import { loggedActivity } from './activities.js'
import { loggedMinutes } from './minutes.js'

export const GEAR_KIND = 'gear'

/* ------------------------------------------------------------- the catalog */

export const gearKinds = (plan) => plan?.gearKinds || []
export const kindOf = (plan, key) => gearKinds(plan).find(k => k.key === key) || null

/** How this kind of thing wears out: 'miles' | 'time' | 'reps'. */
export const metricOf = (plan, key) => kindOf(plan, key)?.metric || 'time'

/* --------------------------------------------------------------- the items */

/**
 * Everything the user owns, from both origins, newest-acquired last.
 *
 * Strava's gear is keyed by its own id (`b18571256`), and a local item by a
 * generated one. They never collide, so a single list is safe — and the list is
 * what every other function here takes, so nothing downstream has to care which
 * origin an item came from except when it is deciding what to display.
 */
export function gearItems({ entries = [], strava = null, plan = null }) {
  const out = []

  // Synced. Retired gear stays visible — a rope you have retired is a thing you
  // want to see the hours on, which is usually WHY you retired it.
  for (const g of Object.values(strava?.gear || {})) {
    if (!g?.id) continue
    out.push({
      id: g.id,
      source: 'strava',
      name: g.nickname || g.name || g.id,
      kind: kindFromStrava(plan, g),
      retired: Boolean(g.retired),
      primary: Boolean(g.primary),
      // Strava's own odometer, in miles. The headline for a synced item.
      stravaMiles: num(g.distanceMi),
      brand: g.brand || null,
      model: g.model || null,
    })
  }

  // Local. One entry per item, so it syncs and merges like everything else.
  for (const e of entries) {
    if (e?.kind !== GEAR_KIND || e.deleted) continue
    const d = e.data || {}
    // The old buying-list entries were `{ item, bought }` and have no kind. They
    // are not gear in this sense and must not appear as nameless rows.
    if (!d.name || !d.kind) continue
    out.push({
      id: e.id,
      source: 'local',
      name: d.name,
      kind: d.kind,
      retired: Boolean(d.retired),
      primary: Boolean(d.primary),
      acquired: d.acquired || null,
      retiredOn: d.retiredOn || null,
      notes: d.notes || null,
      // What it had already done before the app started counting. A rope with 200
      // hours on it does not become new because the user only just added it.
      priorMiles: num(d.priorMiles),
      priorMinutes: num(d.priorMinutes),
      priorReps: num(d.priorReps),
    })
  }

  return out
}

/** Strava calls them `bike` and `shoes`; the plan says which kind that is. */
function kindFromStrava(plan, g) {
  const hit = gearKinds(plan).find(k => k.strava && k.strava === g.kind)
  return hit?.key || (g.kind === 'bike' ? 'bike' : 'shoes')
}

/**
 * What the form's "already on it" box shows, in the unit its kind is counted in.
 *
 * Time is STORED in minutes (`priorMinutes`, the unit every logged workout adds)
 * and TYPED in hours. Until #76 the form put the stored minutes straight into
 * the hours box, so a rope added with 2 hours reopened showing 120, and saving
 * it untouched made it 120 hours: every reopen multiplied it by sixty. This and
 * `priorFieldsFor` are the one conversion each way, and
 * `priorFieldsFor(metric, priorValueFor(item, metric))` gives back the item's
 * own prior for every metric (app/gear.test.js).
 *
 * Only the field the kind is counted in is read: a weight's prior is its reps,
 * never a time or a distance it happened to carry.
 */
export function priorValueFor(item, metric) {
  if (metric === 'miles') return num(item?.priorMiles) || null
  if (metric === 'reps') return num(item?.priorReps) || null
  const minutes = num(item?.priorMinutes)
  if (!minutes) return null
  // Hundredths of an hour; a prior too small for that is shown, not shown as 0.
  return Math.round((minutes / 60) * 100) / 100 || Number((minutes / 60).toPrecision(2))
}

/**
 * The stored prior fields for what the box holds, as `priorValueFor`'s inverse.
 *
 * Fields of the OTHER metrics are kept as the item had them (a weight counted in
 * reps keeps any minutes it carried), so saving the form changes only what the
 * form shows. Blank or zero leaves the shown metric's prior out: nothing on it yet.
 *
 * A box left as it was shown keeps the stored number EXACTLY. The hours shown
 * are rounded, so converting them back would move 79.8 minutes to 80 and drop a
 * prior under a fifth of a minute (shown blank) altogether; only a box the user
 * changed is converted.
 */
export function priorFieldsFor(metric, value, item = null) {
  const key = metric === 'miles' ? 'priorMiles' : metric === 'reps' ? 'priorReps' : 'priorMinutes'
  const out = {}
  for (const k of ['priorMiles', 'priorMinutes', 'priorReps']) {
    if (k !== key && num(item?.[k])) out[k] = num(item[k])
  }
  const shown = item ? priorValueFor(item, metric) : null
  if (item && (num(value) || null) === shown) {
    if (num(item[key])) out[key] = num(item[key])
    return out
  }
  const n = num(value)
  if (n) {
    out[key] = key !== 'priorMinutes' ? n
      // Hours typed; minutes stored, whole minutes so an odometer never drifts
      // by a fraction of a second on every save.
      : Math.round(n * 60)
  }
  return out
}

export const buildGearEntry = (id, data) => ({ id, kind: GEAR_KIND, data })
export const newGearId = () =>
  `gear-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

/* ------------------------------------------------------------ what it did */

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** The gear ids a logged workout was done on. Always an array. */
export function gearOn(entry) {
  const g = entry?.data?.out?.gear
  if (Array.isArray(g)) return g.filter(Boolean)
  return g ? [g] : []
}

/**
 * What each item has done, across every logged workout.
 *
 * Returns one row per item with `miles`, `minutes` and `reps` — all three, always,
 * because which of them is the headline is the KIND's business and this is just
 * arithmetic. `stravaMiles` rides along untouched for synced gear.
 *
 * `loggedMiles` for a synced item deliberately counts ONLY workouts with no Strava
 * activity attached. Those are the rides Strava's odometer cannot have seen — a
 * trainer session, a ride logged by hand — and they are the gap. Every other ride
 * is already in the odometer, and adding it again would inflate the bike by double.
 */
export function gearUsage({ plan, entries = [], strava = null }) {
  const items = gearItems({ entries, strava, plan })
  const byId = new Map(items.map(i => [i.id, {
    ...i,
    metric: metricOf(plan, i.kind),
    miles: i.priorMiles || 0,
    minutes: i.priorMinutes || 0,
    reps: i.priorReps || 0,
    sessions: 0,
    lastUsed: null,
    // Logged here and invisible to Strava. Only meaningful for synced gear.
    unsyncedMiles: 0,
  }]))

  const menu = plan?.dailyMenu || []
  for (const e of entries) {
    if (e?.kind !== 'daily' || e.deleted || !isDone(e)) continue
    const ids = gearOn(e)
    if (!ids.length) continue

    const out = e.data?.out || {}
    const miles = num(out.distance)
    // Typed or measured time only (#97, F6). `data.minutes` is filled with the
    // card's estimate when no time was given, so a 39-minute climbing session
    // logged on a 120-minute card added two hours to the shoes. An entry whose
    // card is gone keeps the one time it carries, its own duration.
    const opt = optFor(menu, e.data?.optId)
    const minutes = num(loggedMinutes(e, opt) ?? (opt ? 0 : out.duration))
    const reps = repsIn(e, menu)
    const onStrava = Boolean(out.strava?.id)

    for (const id of ids) {
      const row = byId.get(id)
      if (!row) continue          // gear the user deleted; the workout keeps its record
      row.miles += miles
      row.minutes += minutes
      row.reps += reps
      row.sessions += 1
      if (!onStrava) row.unsyncedMiles += miles
      if (!row.lastUsed || e.date > row.lastUsed) row.lastUsed = e.date
    }
  }

  return [...byId.values()]
}

/**
 * Reps in a logged session — the lift chooser's sets, and the climbing set log's.
 *
 * Only `weights` gear reads this, but it is computed for everything because the
 * alternative is this function knowing what a squat rack is.
 */
function repsIn(entry, menu) {
  const out = entry?.data?.out || {}
  let n = 0
  for (const lift of (Array.isArray(out.lifts) ? out.lifts : [])) {
    for (const set of (Array.isArray(lift.sets) ? lift.sets : [])) n += num(set.reps) || 1
  }
  // The climbing set log, where a session declares its own exercises.
  const opt = optFor(menu, entry?.data?.optId)
  // Its rows live in `out.sets[key]` (#97, F6: this read `out[key]`, where they
  // never are, so a climbing set log added no reps at all).
  for (const ex of (opt?.logSpec?.exercises || [])) {
    const rows = out.sets?.[ex.key]
    for (const set of (Array.isArray(rows) ? rows : [])) {
      n += num(set?.reps) || 1
    }
  }
  return n
}

/** The headline number for a row, as its kind measures it. */
export function headlineFor(row) {
  if (row.metric === 'miles') {
    const mi = row.source === 'strava' ? (row.stravaMiles || 0) : row.miles
    return { value: Math.round(mi * 10) / 10, unit: 'mi' }
  }
  if (row.metric === 'reps') return { value: row.reps, unit: 'reps' }
  return { value: Math.round(row.minutes / 60), unit: 'hr' }
}

/* -------------------------------------------------------------- defaulting */

/**
 * The gear a workout should arrive with, given what it is.
 *
 * Strava's model: an item can be `primary` for its kind,
 * and a workout in a matching discipline picks it up with no taps. Wrong often
 * enough to be worth changing, right often enough to be worth defaulting — and the
 * change is one tap on the workout, not a settings page.
 *
 * Returns `[]` rather than a guess when nothing is primary. A default nobody chose
 * is how a bike quietly accrues someone else's miles.
 */
export function defaultGearFor({ plan, entries = [], strava = null, opt, out = {} }) {
  const kinds = kindsForWorkout(plan, opt, out)
  if (!kinds.length) return []
  const items = gearItems({ entries, strava, plan }).filter(i => !i.retired)
  const picks = []
  for (const k of kinds) {
    const inKind = items.filter(i => i.kind === k)
    const primary = inKind.find(i => i.primary) || (inKind.length === 1 ? inKind[0] : null)
    if (primary) picks.push(primary.id)
  }
  return picks
}

/**
 * Which kinds of gear this workout could plausibly have been done on.
 *
 * Driven by the activity's DISCIPLINE, not by its name, so a gravel ride and a
 * mountain bike ride both want a bike without either being listed anywhere. A
 * climbing session wants climbing shoes; a finger session wants the board and the
 * gauge, which is the pair that makes "how many hours on the Port-A-Board" a
 * question with an answer.
 */
export function kindsForWorkout(plan, opt, out = {}) {
  const activity = loggedActivity(opt, out)
  const discipline = activity?.discipline || opt?.discipline || null
  const category = opt?.category || activity?.category || null

  if (discipline === 'bike') return ['bike']
  if (discipline === 'run') return ['shoes']
  if (discipline === 'swim') return ['swim']
  if (discipline === 'lift') return ['weights']
  if (discipline === 'climbing') {
    if (category === 'fingers') return ['board', 'gauge']
    return ['climbing-shoes', 'harness', 'rope']
  }
  return []
}

/** Everything the user owns that suits this workout, for the picker. */
export function gearChoicesFor({ plan, entries = [], strava = null, opt, out = {} }) {
  const kinds = new Set(kindsForWorkout(plan, opt, out))
  return gearItems({ entries, strava, plan })
    .filter(i => !i.retired && kinds.has(i.kind))
}
