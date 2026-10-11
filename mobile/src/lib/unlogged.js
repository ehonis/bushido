/*
 * Workouts your watch knows about and your log does not.
 *
 * They are offered on Today rather than somewhere quieter: WHOOP and Strava
 * already recorded the ride, so the app should put it in front of the user
 * rather than wait to be asked.
 *
 * It exists because the old flow only ran one way. You picked a card, then went
 * looking for the measurement to attach to it — which is the right order for a
 * board session you planned, and exactly backwards for a ride you just did. The
 * ride is the thing that happened; the log entry is the paperwork.
 *
 * FOUR RULES, and three of them are about not being annoying.
 *
 * **Climbing is never offered here.** A WHOOP `rock-climbing` workout resolves to
 * no catalog activity on purpose (see server/whoop.js), so it cannot be one-tap
 * logged as a generic workout — that would put a hard finger day somewhere the
 * injury budget cannot see it. Climbing gets logged on the climbing cards, which
 * ask the hard-finger question. A climbing workout therefore simply does not
 * appear in this list, and the climbing cards' own attach flow is unchanged.
 *
 * **Already attached is already logged.** Anything whose id appears on an entry
 * is gone from the list, whichever session took it — including a gym visit split
 * across two sessions.
 *
 * **Dismissing is an answer.** Waving one off records a skip, exactly the way
 * waving off a recommended session does, so it does not come back tomorrow. The
 * skip is keyed by the workout id rather than a session id, because that is what
 * is actually being declined.
 *
 * **It writes nothing by itself.** The tap calls the same `onLog` the day list's
 * taps go through, which writes the same ordinary entry the user can edit or delete.
 * There is no such thing as a service's write.
 */

import {
  attachedIds as whoopAttached, workoutsOn, choiceForSport,
  workoutWindow, overlapMinutes, attachTo as whoopAttachTo, snapshotOf as whoopSnapshotOf,
} from '../../../server/whoop.js'
import {
  attachedIds as stravaAttached, activitiesOn, choiceForFamily, familyOf,
  activityWindow, attachTo as stravaAttachTo, snapshotOf as stravaSnapshotOf,
} from '../../../server/strava.js'
import { activityOf } from './activities.js'

export const SKIP_KIND = 'skip-workout'

/*
 * MERGING THE SAME WORKOUT RECORDED TWICE.
 *
 * Strava and WHOOP often record the same workout, so the two can be merged into
 * one on that screen. A ride a bike computer sent to Strava and a strap recorded
 * to WHOOP is ONE ride, and offering it as
 * two cards is offering to log the same afternoon twice — which would fill two
 * bike quotas and double its contribution to the load chart.
 *
 * The entry model already supported this and nothing had to change for it: an
 * `out` can hold `out.whoop` AND `out.strava` at once, `filledBy` reads both, and
 * `minutesFor` already knows which to believe. What was missing was only the
 * question "are these two the same thing".
 *
 * TIME IS THE EVIDENCE. Two activities that overlap substantially are the same
 * activity, because you cannot ride and swim simultaneously — so the overlap does
 * almost all the work, and the sport agreement is a sanity check rather than the
 * test. Requiring the sports to MATCH would refuse the most valuable merge there
 * is: WHOOP's generic `activity`, which is the strap noticing effort it could not
 * name, paired with the Strava ride that names it.
 */

/** Overlap has to be most of the shorter activity, and not a trivial brush. */
const MERGE_MIN_OVERLAP_PCT = 0.5
const MERGE_MIN_OVERLAP_MIN = 5

const spanMinutes = (w) => (w ? Math.max(1, Math.round((w[1] - w[0]) / 60000)) : 0)

/**
 * Do these two measurements describe one activity? Returns the overlap, or 0.
 *
 * `generic` is the escape valve for WHOOP's unlabelled `activity` and anything
 * else that lands on the catch-all: it cannot contradict a sport, because it is
 * not claiming one.
 */
export function mergeScore(whoopItem, stravaItem) {
  const a = workoutWindow(whoopItem?.raw)
  const b = activityWindow(stravaItem?.raw)
  if (!a || !b) return 0
  const mins = overlapMinutes(a, b)
  if (mins < MERGE_MIN_OVERLAP_MIN) return 0
  const shorter = Math.min(spanMinutes(a), spanMinutes(b))
  if (!shorter || mins / shorter < MERGE_MIN_OVERLAP_PCT) return 0

  const ka = whoopItem.activity?.key
  const kb = stravaItem.activity?.key
  const generic = (k) => !k || k === 'other'
  // A real disagreement — a logged swim overlapping a logged ride — is data worth
  // showing them as two rows rather than silently reconciling.
  if (!generic(ka) && !generic(kb) && ka !== kb) return 0
  return mins
}

/**
 * Pair the two lists up, best overlap first.
 *
 * Greedy on the strongest pair rather than in list order, so three overlapping
 * things cannot have the weakest match claim a partner the best match wanted.
 * `split` is the ids the user has asked to keep apart, which beats any score.
 */
function pairUp(whoopItems, stravaItems, split = new Set()) {
  const scored = []
  for (const w of whoopItems) {
    for (const t of stravaItems) {
      if (split.has(mergedId(w, t))) continue
      const score = mergeScore(w, t)
      if (score) scored.push({ w, t, score })
    }
  }
  scored.sort((x, y) => y.score - x.score)

  const takenW = new Set(); const takenT = new Set(); const pairs = []
  for (const { w, t, score } of scored) {
    if (takenW.has(w.id) || takenT.has(t.id)) continue
    takenW.add(w.id); takenT.add(t.id)
    pairs.push({ w, t, score })
  }
  return { pairs, takenW, takenT }
}

/** Stable and order-independent, so a split survives a cache refetch. */
export const mergedId = (a, b) => [a.id, b.id].sort().join('+')

/**
 * One offer out of two measurements.
 *
 * The named activity wins over the generic one — a Strava ride beats WHOOP's
 * "activity", which is the whole point of allowing that pairing. Minutes take the
 * larger, because the shorter measurement is the one that missed something.
 */
function mergeItems(w, t, score) {
  const named = !w.activity || w.activity.key === 'other' ? t : w
  return {
    id: mergedId(w, t),
    merged: true,
    parts: [w, t],
    sources: ['whoop', 'strava'],
    activity: named.activity,
    minutes: Math.max(w.minutes || 0, t.minutes || 0),
    label: t.label || w.label,
    overlap: score,
    // The union of the two windows, for the same reason the minutes take the
    // larger: the shorter measurement is the one that missed something. Two
    // straps describing one ride disagree about its edges by a minute or two.
    ...unionWindow(w, t),
  }
}

/** The earliest start and latest end across parts, skipping what is missing. */
function unionWindow(...items) {
  const stamps = (key) => items.map(i => Date.parse(i?.[key])).filter(Number.isFinite)
  const starts = stamps('start')
  const ends = stamps('end')
  return {
    start: starts.length ? new Date(Math.min(...starts)).toISOString() : null,
    end: ends.length ? new Date(Math.max(...ends)).toISOString() : null,
  }
}

/**
 * The `out` for a merged pair: both snapshots, one entry.
 *
 * STRAVA GOES FIRST, and the order is the whole decision. Both modules fill only
 * BLANK fields, so whoever runs first claims each one — and for a pair that are
 * the same activity, Strava is the better witness for every field there is a
 * contest over. It has GPS, so its distance and elevation are measured rather than
 * inferred; its headline minutes are MOVING time, which is what the load chart
 * wants, because a coffee stop is not training.
 *
 * This is NOT the same question `minutes.js` answers when it puts WHOOP above
 * Strava. That order is for one session carrying two measurements of DIFFERENT
 * scope — a gym visit the strap timed whole, with the ride as one part of it. Here
 * the two describe the same activity end to end, and the more precise instrument
 * should win. WHOOP still attaches, still contributes its heart rate and strain,
 * and still fills anything Strava had no answer for.
 */
export function mergedOut(card, item, base = {}) {
  const attachedAt = new Date().toISOString()
  const byId = Object.fromEntries(item.parts.map(p => [p.source, p]))
  let out = base
  if (byId.strava) out = stravaAttachTo(card, out, { ...stravaSnapshotOf(byId.strava.raw), attachedAt })
  if (byId.whoop) out = whoopAttachTo(card, out, { ...whoopSnapshotOf(byId.whoop.raw), attachedAt })
  return out
}

/**
 * One measurement (or a merged pair) attached onto an `out`.
 *
 * The single place that answers "what does this workout do to a session's
 * outputs", used both when the row becomes a NEW entry (`base` is `{}`) and when
 * it is merged into one that already exists. Both modules fill only blank fields,
 * so attaching onto a session the user has already typed into cannot overwrite them.
 */
export function outWith(card, base, item) {
  if (item.merged) return mergedOut(card, item, base)
  const attachedAt = new Date().toISOString()
  return item.source === 'whoop'
    ? whoopAttachTo(card, base, { ...whoopSnapshotOf(item.raw), attachedAt })
    : stravaAttachTo(card, base, { ...stravaSnapshotOf(item.raw), attachedAt })
}

/**
 * The logged sessions this measurement could be the same activity as.
 *
 * WHY THIS EXISTS. `pairUp` folds a WHOOP workout and a Strava activity into one
 * offer — but only while BOTH are still unlogged. The gap: Strava syncs first,
 * the ride is logged off it, and WHOOP's copy of the same hour arrives afterwards
 * with nothing left to pair with. It sat on the card as a second bike ride that
 * could only be logged twice or dismissed, and dismissing
 * it threw away the heart-rate data.
 *
 * The root cause is not the pairing rules, it is the ASSUMPTION that both
 * measurements show up before either is logged. Sync order is not something this
 * app controls, so the fix is a route that does not care about it: merge the
 * late one into the entry the early one already became.
 *
 * What is offered: every daily entry on the day that is not a rest day and does
 * not already carry a snapshot from this source. That last exclusion is the one
 * that matters — attaching a second WHOOP workout to a session that already has
 * one would silently replace it, and "which of the two is on there now" is not a
 * question the log should be able to raise. Deliberately NOT filtered by
 * activity: the user is the one asserting they are the same thing, and an app that
 * hides the ride the user means because the catalog disagrees is an app arguing with
 * them about their own day.
 */
export function mergeTargets({ entries = [], iso, item, menu = [] }) {
  if (!item) return []
  const sources = item.merged ? item.sources : [item.source]
  return entries
    .filter(e => e?.kind === 'daily' && e.date === iso && !e.deleted)
    .filter(e => {
      const opt = menu.find(m => m.id === e.data?.optId)
      if (opt?.role === 'rest') return false
      return !sources.some(src => e.data?.out?.[src])
    })
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
}

/** The one card that can hold any sport, and the catalog field on it. */
export const logCardOf = (plan) =>
  (plan?.dailyMenu || []).find(m => m.categoryFrom === 'activity') || null
export const activityFieldOf = (card) =>
  (card?.outputs || []).find(f => f.type === 'activity') || null

/**
 * What the services recorded on `iso` that the log has no entry for.
 *
 * Pure and here rather than in the component, the same way `lifts.js` sits under
 * `liftlog.jsx`: the rules above are the part worth testing as arithmetic, and
 * `app/quota.test.js` runs them against their real `data/whoop.json`.
 */
export function unloggedWorkouts({ plan, entries = [], iso, whoop = null, strava = null, skipped = [], split = [] }) {
  const card = logCardOf(plan)
  const field = activityFieldOf(card)
  if (!card || !field) return []

  const skip = new Set(skipped)
  const whoopItems = []
  const stravaItems = []

  const takenWhoop = whoopAttached(entries)
  for (const w of workoutsOn(whoop, iso)) {
    if (takenWhoop.has(w.id) || skip.has(`whoop:${w.id}`)) continue
    // No catalog activity means the app has no honest place to put it in one
    // tap. For climbing that is deliberate; for a sport nobody has added yet it
    // is the correct silence.
    const key = choiceForSport(field, w.sport)
    if (!key) continue
    whoopItems.push({
      source: 'whoop', id: `whoop:${w.id}`, raw: w,
      activity: activityOf(field, key),
      minutes: Math.round(Number(w.minutes) || 0),
      label: w.sport,
      // WHEN, not only how long: a duration alone does not say when the workout
      // was completed, and the whole question this card raises is which of the day's efforts a row is, which
      // a duration answers only by coincidence. Carried as the absolute instant
      // both services already publish; the row formats it in local time.
      start: w.start || null,
      end: w.end || null,
    })
  }

  const takenStrava = stravaAttached(entries)
  for (const a of activitiesOn(strava, iso)) {
    if (takenStrava.has(a.id) || skip.has(`strava:${a.id}`)) continue
    const key = choiceForFamily(field, familyOf(a))
    if (!key) continue
    stravaItems.push({
      source: 'strava', id: `strava:${a.id}`, raw: a,
      activity: activityOf(field, key),
      minutes: Math.round(Number(a.movingMin ?? a.elapsedMin) || 0),
      label: a.name || a.family,
      start: a.start || null,
      end: a.end || null,
    })
  }

  /*
   * Fold the pairs together, and leave everything unpaired exactly as it was.
   * Merged rows lead, because a pair is the most certain thing on the card: two
   * instruments independently recorded it.
   */
  const { pairs, takenW, takenT } = pairUp(whoopItems, stravaItems, new Set(split))
  const all = [
    ...pairs.map(({ w, t, score }) => mergeItems(w, t, score)),
    ...whoopItems.filter(w => !takenW.has(w.id)),
    ...stravaItems.filter(t => !takenT.has(t.id)),
  ]
  return all.filter(item => !skip.has(item.id))
}

/**
 * The ones the user waved off, so the user can get them back.
 *
 * Dismissing used to be permanent, and that was worse than merely inconvenient — the only way to
 * recover a ride you dismissed by mistake was to find its id in the log and hand-
 * edit a skip entry, which is not a thing anybody does. A dismissal should mean
 * "not now", and the difference between that and "never" is one undo.
 *
 * Built by resolving the scope WITHOUT the skip list and keeping what the skip
 * list removed, rather than by storing the dismissed items — so a workout that
 * stopped existing (a Strava activity the user deleted) simply stops being offered
 * back, and the merge grouping is the same on both sides.
 */
export function dismissedWorkouts(args) {
  const skip = new Set(args?.skipped || [])
  if (!skip.size) return []
  const all = unloggedWorkouts({ ...args, skipped: [] })
  return all.filter(item => skip.has(item.id))
}
