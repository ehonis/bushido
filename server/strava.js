/*
 * Strava, as Bushido sees it.
 *
 * WHOOP tells this app how hard a session was; Strava tells it what the session
 * WAS — distance, climb, speed, which bike. The two arrive through the
 * same door (the Totem bridge) and are stored the same two ways, for the same
 * reasons written up at the top of whoop.js:
 *
 *   data/strava.json        A CACHE. Disposable, refetchable. A window onto
 *                           Strava's copy, never a record.
 *
 *   entry.data.out.strava   A SNAPSHOT the user attached by tapping a button. Their
 *                           training log; durable; survives Strava, the bridge
 *                           and the cache all going away.
 *
 * NO CREDENTIALS HERE. The bridge holds the one Strava grant and exposes
 * `GET /api/strava/training` (the recent activities, already shaped with both
 * unit systems and the athlete's local date) and `GET /api/strava/activity?id=`
 * (one activity in full, with laps and splits). Bushido reads both with the bridge
 * secret it already has for the habit push.
 *
 * MATCHING IS SUGGESTED, NEVER APPLIED — the same rule as WHOOP, for the same
 * reason. `rankForSession` may mark ONE activity as likely; attaching is their tap.
 *
 * WHAT ATTACHING DOES THAT WHOOP'S DOESN'T: on the *Other training* card the
 * snapshot also FILLS the card's own blank fields — activity, time, distance,
 * speed, elevation — because those are exactly the numbers Strava measured and
 * typing them off a screen the user is already looking at is the chore the button
 * exists to remove. Only blanks are filled, what was filled is remembered on the
 * snapshot, and detaching clears only what is still as it was filled.
 */

import { overlapMinutes, sessionWindow } from './whoop.js'

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const ms = (iso) => {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

/* ----------------------------------------------------------------- sports */

/*
 * The bridge groups Strava's ~50 sport types into families (ride, run, walk,
 * hike, swim, lift, climbing, mobility, ski, water, sport, other) and puts the
 * family on every activity. This maps a family onto the *Other training* card's
 * `activity` choice — plan.json's vocabulary, so a value here must be one of its
 * option values or the fill is refused.
 */
/*
 * Which catalog activity a Strava family is.
 *
 * Read off the card's own catalog, like the WHOOP mapping beside it — each
 * activity in plan.json may declare the Strava family that resolves to it
 * (`strava: 'ride'`). Before 2026-09-14 this was a hardcoded map onto nine fixed
 * values; it is now content, so adding a sport is one edit in one place.
 *
 * Climbing resolves to NOTHING, and the mechanism is the absence of any climbing
 * entry in the catalog rather than an explicit null. The climbing cards ask the
 * hard-finger question and this one does not, so a bouldering activity labelled
 * as a generic logged workout would hide a hard finger day from the injury rule.
 */
export function choiceForFamily(activityField, family) {
  const fam = String(family || '').toLowerCase()
  if (!fam) return null
  const hit = (activityField?.activities || []).find(a => a.strava === fam)
  return hit?.key || null
}

export const familyOf = (activity) => String(activity?.family || 'other').toLowerCase()

/**
 * Does this activity fit the session? `true` / `false` / `null` (no opinion),
 * three-valued for the same reason as whoop.js's `sportMatches`.
 *
 * Two declarations count. A session may say what it is in plan.json
 * (`sched.stravaSport: 'ride'`, or the existing `sched.whoopSport: 'climbing'`,
 * which means the same thing to Strava). And the free-form *Other training* card
 * declares itself at log time: once the user has picked "Bike", a run does not fit.
 * Before the user picks, there is no opinion — the ranking falls back to the other
 * signals rather than guessing their afternoon from a list of sports.
 */
export function familyMatches(session, out, activity) {
  const fam = familyOf(activity)
  const declared = session?.sched?.stravaSport || (session?.sched?.whoopSport === 'climbing' ? 'climbing' : null)
  if (declared) return String(declared).toLowerCase() === fam
  if (session?.nameFrom === 'activity') {
    const picked = out?.activity
    if (!picked) return null
    // What the catalog says this family is, against what the user picked. A family the
    // catalog does not name (climbing, above all) fits nothing on this card.
    const want = choiceForFamily(session?.outputs?.find(f => f.type === 'activity'), fam)
    if (!want) return false
    return want === picked
  }
  return null
}

/* ---------------------------------------------------------------- windows */

/** The clock window an activity occupied. `end` is start + elapsed, from the bridge. */
export function activityWindow(a) {
  const start = ms(a?.start)
  if (start === null) return null
  const end = ms(a?.end)
  if (end !== null && end > start) return [start, end]
  const mins = num(a?.elapsedMin) ?? num(a?.movingMin)
  return [start, start + (mins || 0) * 60000]
}

/** Activities the cache holds for one LOCAL date. */
export function activitiesOn(cache, date) {
  if (!cache || !date) return []
  return (Array.isArray(cache.activities) ? cache.activities : []).filter(a => a?.date === date)
}

/* ----------------------------------------------------------- the snapshot */

const clip = (list, n) => (Array.isArray(list) ? list.slice(0, n) : [])

const lapRow = (l) => ({
  index: num(l?.index),
  distanceMi: num(l?.distanceMi),
  movingMin: num(l?.movingMin),
  avgMph: num(l?.avgMph),
  paceMinPerMi: num(l?.paceMinPerMi),
  avgHr: num(l?.avgHr),
  maxHr: num(l?.maxHr),
  avgWatts: num(l?.avgWatts),
  elevationFt: num(l?.elevationFt),
})

/**
 * What gets copied onto the entry when the user attaches an activity.
 *
 * Flat and self-describing, like the WHOOP snapshot — a Strava id to look up
 * later would stop working exactly when the lookup did. It carries every stat
 * the summary has, plus what the detail adds (calories, description, gear name,
 * laps, splits, best efforts) when the caller fetched one. Laps and splits are
 * clipped: a century ride has a hundred mile-splits and the log is a phone's
 * localStorage.
 */
export function snapshotOf(activity, { detail = null, gear = null } = {}) {
  if (!activity?.id) return null
  const d = detail && detail.id === activity.id ? detail : null
  const src = d || activity
  const g = d?.gear || (activity.gearId && gear ? gear[activity.gearId] : null) || null
  const snap = {
    id: activity.id,
    name: src.name || activity.name || null,
    sport: src.sport || activity.sport || 'unknown',
    family: familyOf(src),
    start: src.start || null,
    end: src.end || null,
    startLocal: src.startLocal || null,
    date: src.date || null,
    // MOVING minutes are the headline, as on Strava itself; the load chart wants
    // time spent working, and a coffee stop is not training. Elapsed rides along.
    minutes: num(src.movingMin),
    elapsedMinutes: num(src.elapsedMin),
    distanceMi: num(src.distanceMi),
    distanceKm: num(src.distanceKm),
    elevationFt: num(src.elevationFt),
    avgMph: num(src.avgMph),
    maxMph: num(src.maxMph),
    paceMinPerMi: num(src.paceMinPerMi),
    paceLabel: src.paceLabel || null,
    avgHr: num(src.avgHr),
    maxHr: num(src.maxHr),
    avgWatts: num(src.avgWatts),
    weightedAvgWatts: num(src.weightedAvgWatts),
    maxWatts: num(src.maxWatts),
    deviceWatts: Boolean(src.deviceWatts),
    kilojoules: num(src.kilojoules),
    calories: num(d?.calories),
    avgCadence: num(src.avgCadence),
    avgTempF: num(src.avgTempF),
    sufferScore: num(src.sufferScore),
    prCount: num(src.prCount),
    achievementCount: num(src.achievementCount),
    kudosCount: num(src.kudosCount),
    gearId: src.gearId || null,
    gear: g ? { id: g.id, name: g.name || null, distanceMi: num(g.distanceMi) } : null,
    deviceName: src.deviceName || null,
    trainer: Boolean(src.trainer),
    commute: Boolean(src.commute),
    manual: Boolean(src.manual),
    url: src.url || `https://www.strava.com/activities/${activity.id}`,
    attachedAt: null, // stamped by the caller, which is the only thing with a clock
  }
  if (d) {
    if (d.description) snap.description = String(d.description).slice(0, 600)
    const laps = clip(d.laps, 40).map(lapRow)
    if (laps.length) snap.laps = laps
    const splits = clip(d.splitsStandard, 60).map(lapRow)
    if (splits.length) snap.splits = splits
    const efforts = clip(d.bestEfforts, 20).map(e => ({ name: e?.name || null, elapsedSec: num(e?.elapsedSec), prRank: num(e?.prRank) }))
    if (efforts.length) snap.bestEfforts = efforts
  }
  return snap
}

/**
 * How many minutes an attached activity puts on THIS session. Moving time where
 * Strava measured it, elapsed where it did not (a manual activity has no moving
 * time distinct from elapsed).
 */
export function attachedMinutes(snap) {
  if (!snap) return null
  return num(snap.minutes) ?? num(snap.elapsedMinutes)
}

/* ------------------------------------------------------- filling the card */

/**
 * The card fields a snapshot can answer, by the card's own output key.
 *
 * Only keys the session DECLARES in `outputs` are filled, and only when blank.
 * The values are the units the card asks for — plan.json's *Other training*
 * fields are mi, min, mph and ft, which is why the snapshot carries imperial.
 */
function fillValues(session, out, snap) {
  const declared = new Map((session?.outputs || []).map(f => [f.key, f]))
  const blank = (k) => out?.[k] === undefined || out?.[k] === null || out?.[k] === ''
  const values = {}
  const activityField = declared.get('activity')
  if (activityField && blank('activity')) {
    const choice = choiceForFamily(activityField, familyOf(snap))
    if (choice) values.activity = choice
  }
  // Which distance field this sport uses. A pool is yards and a ride is miles,
  // and filling both would have `filled` claiming credit for a number that the
  // card never asked for and `detachFrom` then trying to take back. Same rule as
  // server/whoop.js.
  const activityKey = values.activity ?? out?.activity
  const shape = (activityField?.activities || []).find(a => a.key === activityKey)?.shape || null

  const mins = attachedMinutes(snap)
  if (declared.has('duration') && blank('duration') && mins) values.duration = Math.round(mins)
  if (shape === 'pool') {
    const yd = num(snap.distanceMi) ? snap.distanceMi * 1760 : null
    if (declared.has('poolDistance') && blank('poolDistance') && yd) values.poolDistance = Math.round(yd)
  } else if (declared.has('distance') && blank('distance') && num(snap.distanceMi)) {
    values.distance = Math.round(snap.distanceMi * 10) / 10
  }
  if (declared.has('speed') && blank('speed') && num(snap.avgMph)) values.speed = Math.round(snap.avgMph * 10) / 10
  if (declared.has('elevation') && blank('elevation') && num(snap.elevationFt)) values.elevation = Math.round(snap.elevationFt)
  return values
}

/**
 * Attach: the new `out`, with the snapshot on it and any blank card fields
 * filled from it. The snapshot remembers what it filled (`filled: {key: value}`)
 * so that detaching can put back exactly the blanks it took — and nothing the user
 * typed over in the meantime.
 */
export function attachTo(session, out, snap, { now = new Date().toISOString() } = {}) {
  if (!snap) return { ...out }
  const values = fillValues(session, out, snap)
  const stamped = { ...snap, attachedAt: now, ...(Object.keys(values).length ? { filled: values } : {}) }

  // A second activity is ADDED. It fills only what is still blank, which after
  // the first one is usually nothing. The same id re-attached replaces itself.
  const existing = attachedStrava(out)
  if (!existing.length) return { ...out, ...values, strava: stamped }

  const next = existing.some(a => a?.id === snap.id)
    ? existing.map(a => (a?.id === snap.id ? stamped : a))
    : [...existing, stamped]
  const rest = next.slice(1)
  return { ...out, ...values, strava: next[0], stravaMore: rest.length ? rest : undefined }
}

/** Detach: drop the snapshot, and clear each filled field that is still what we filled. */
export function detachFrom(out, id = null) {
  const all = attachedStrava(out)
  if (!all.length) return { ...out }
  const snap = id ? all.find(a => a?.id === id) : all[0]
  if (!snap) return { ...out }

  const next = { ...out }
  const left = all.filter(a => a !== snap)
  delete next.strava
  delete next.stravaMore
  if (left.length) {
    next.strava = left[0]
    if (left.length > 1) next.stravaMore = left.slice(1)
  }
  for (const [key, value] of Object.entries(snap?.filled || {})) {
    if (next[key] === value) delete next[key]
  }
  return next
}

/* -------------------------------------------------------------- the ranking */

/** Which Strava ids are attached, and to which sessions. */
export function attachedIds(entries = []) {
  const map = new Map()
  for (const e of entries) {
    if (e?.deleted) continue
    for (const snap of attachedStrava(e?.data?.out)) {
      const id = snap?.id
      if (!id) continue
      const list = map.get(id) || []
      list.push({ entryId: e.id, name: e.data?.name || 'another session', date: e.date })
      map.set(id, list)
    }
  }
  return map
}

/* -------------------------------------------------- one session, N activities */

/**
 * EVERY Strava activity attached to one session, oldest attachment first.
 *
 * A combined workout can produce several Strava activities for one session, so
 * more than one can be attached. A ride out, a run, and a ride home is three
 * activities and one brick; attaching the second used to replace the first.
 *
 * Same storage decision as WHOOP's `attachedWhoop`, and for the same reason: the
 * first stays on `out.strava` so every reader written before today is still right
 * about the ordinary one-activity case, and the rest go in `out.stravaMore`.
 *
 * NOTE what does NOT change: an activity attached to two SESSIONS is still a
 * mistake and still flagged as one. Unlike WHOOP there is no part editor, because
 * a ride is one session — this is the other direction, one session with several
 * rides in it.
 */
export function attachedStrava(out) {
  const first = out?.strava
  if (!first) return []
  const more = Array.isArray(out?.stravaMore) ? out.stravaMore.filter(Boolean) : []
  return [first, ...more]
}

/** Is this activity id already on this session, in any slot? */
export const hasStrava = (out, id) => attachedStrava(out).some(a => a?.id === id)

/**
 * The day's activities, best candidate first, at most one marked `likely`.
 *
 * The same four signals as whoop.js, in the same order of trust: OVERLAP with a
 * workout-mode-timed session; the SPORT against what the session declared (in
 * plan.json, or by the activity the user picked on the card); THE ONLY ONE unattached
 * on the day; and DURATION. A sport mismatch can never be likely, and two
 * plausible candidates means no claim at all.
 */
export function rankForSession({ activities = [], entry, session, date, entries = [] }) {
  const out = entry?.data?.out || {}
  const win = sessionWindow(entry)
  const sessionMin = num(entry?.data?.minutes) ?? num(session?.minutes)
  const taken = attachedIds(entries.filter(e => e?.id !== entry?.id))
  const mine = new Set(attachedStrava(out).map(a => a?.id).filter(Boolean))

  const scored = activities
    .filter(a => a?.id && (!date || a.date === date))
    .map(a => {
      const overlapMin = win ? overlapMinutes(win, activityWindow(a)) : 0
      const fit = familyMatches(session, out, a)
      const mins = attachedMinutes(a) ?? num(a.movingMin)
      const durationDelta = sessionMin && mins ? Math.abs(mins - sessionMin) / Math.max(sessionMin, 1) : null
      let score = 0
      if (overlapMin > 0) score += 100 + Math.min(overlapMin, 120)
      if (fit === true) score += 40
      if (fit === false) score -= 100
      if (durationDelta !== null) score += Math.max(0, 20 - Math.round(durationDelta * 40))
      const attachedTo = (taken.get(a.id) || [])[0] || null
      if (attachedTo) score -= 30
      return { activity: a, score, overlapMin, fit, attachedTo, likely: false, isMine: mine.has(a.id) }
    })
    .sort((x, y) => y.score - x.score)

  const free = scored.filter(c => !c.attachedTo && c.fit !== false)
  const best = scored[0]
  if (best && best.fit !== false && !best.attachedTo) {
    const second = scored[1]
    const evidence = best.overlapMin > 0 || best.fit === true || free.length === 1
    const clear = !second || second.fit === false || second.attachedTo || best.score - second.score >= 30
    if (evidence && clear) best.likely = true
  }
  return scored
}

/* ------------------------------------------------------------- the digest */

/**
 * Monday-start week key, labelled by its Monday — the same week the quotas use
 * (`mondayOf` in app/src/lib/quota.js) and, since 2026-09-20, the same week Totem
 * cuts its goals and its own mileage buckets on. It was Sunday-start before that,
 * which meant the coach's "last four weeks" never lined up with the quota board it
 * was reading beside.
 */
export function weekOf(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

/**
 * Weekly totals by family over a cache — what a coach reads to know whether the
 * legs are tired. Distance-weighted average speed, like the bridge's roll-up.
 */
export function weeklyTotals(activities = [], { weeks = 4, until = null } = {}) {
  const buckets = new Map()
  for (const a of activities) {
    if (!a?.date || (until && a.date > until)) continue
    const wk = weekOf(a.date)
    if (!wk) continue
    const fam = familyOf(a)
    const b = buckets.get(wk) || { weekOf: wk, families: {} }
    const f = b.families[fam] || { count: 0, distanceMi: 0, movingMin: 0, elevationFt: 0 }
    f.count++
    f.distanceMi += num(a.distanceMi) || 0
    f.movingMin += num(a.movingMin) || 0
    f.elevationFt += num(a.elevationFt) || 0
    b.families[fam] = f
    buckets.set(wk, b)
  }
  return [...buckets.values()]
    .sort((x, y) => y.weekOf.localeCompare(x.weekOf))
    .slice(0, weeks)
    .map(b => ({
      weekOf: b.weekOf,
      families: Object.fromEntries(Object.entries(b.families).map(([k, f]) => [k, {
        count: f.count,
        distanceMi: Math.round(f.distanceMi * 10) / 10,
        movingMin: Math.round(f.movingMin),
        elevationFt: Math.round(f.elevationFt),
        avgMph: f.movingMin > 0 && f.distanceMi > 0 ? Math.round((f.distanceMi / (f.movingMin / 60)) * 10) / 10 : null,
      }])),
    }))
}
