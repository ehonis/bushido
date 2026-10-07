/*
 * WHOOP, as Bushido sees it.
 *
 * WHAT LIVES WHERE, because this is the decision the rest of the file follows
 * from. WHOOP data arrives in two very different roles and they are stored in two
 * different places on purpose:
 *
 *   data/whoop.json          A CACHE. Disposable, refetchable, owned by nobody.
 *                            Delete it and the next pull rebuilds it. Nothing in
 *                            the app may depend on it having a particular entry —
 *                            it is a window onto WHOOP's copy, not a record.
 *
 *   entry.data.out.whoop     A SNAPSHOT the user attached, by tapping a button. This is
 *                            their training log and is durable: once a workout is
 *                            attached to a session, that session's heart rate
 *                            survives WHOOP going down, the cache being deleted,
 *                            the workout being edited in the WHOOP app, and the
 *                            grant being revoked.
 *
 * That split is also the honest reading of WHOOP's API terms, which ask that you
 * not "create permanent copies of WHOOP Data": the refreshable mirror stays
 * refreshable, and what persists is the training record the user made from it.
 *
 * NO CREDENTIALS HERE. WHOOP rotates its refresh token on every refresh and
 * invalidates the old pair, so exactly one process may hold it — and that is the
 * Totem bridge, which has held it since the sleep sync was built. Bushido asks the
 * bridge (`GET /api/whoop/training`) with the bridge secret it already reads for
 * the habit push. A second copy of the credentials here would give one member two
 * grants, and the loser stops working silently.
 *
 * MATCHING IS SUGGESTED, NEVER APPLIED. `rankForSession` scores the day's
 * workouts and may mark ONE as likely; attaching is a tap. Getting this wrong
 * writes false training history — a belay partner's climb, or the lift before the
 * session rather than the session — and the app's standing rule is that the
 * coach suggests and the buttons are the user's.
 */

/* ------------------------------------------------------------------ helpers */

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const ms = (iso) => {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

/** Minutes two [start, end] windows share. 0 when either is unknown. */
export function overlapMinutes(a, b) {
  if (!a || !b) return 0
  const lo = Math.max(a[0], b[0])
  const hi = Math.min(a[1], b[1])
  return hi > lo ? Math.round((hi - lo) / 60000) : 0
}

/**
 * The clock window a logged session occupied, or null when nobody wrote one down.
 *
 * Only workout mode knows this: it stamps `out.startedAt` when you press start.
 * Everything else in the log is dated but not timed, and the honest answer for a
 * session logged by hand is that its time of day is unknown — so this returns
 * null rather than assuming an evening, and the ranking falls back to signals
 * that do not need a clock.
 */
export function sessionWindow(entry) {
  const out = entry?.data?.out || {}
  const start = ms(out.startedAt)
  if (start === null) return null
  const mins = num(out.elapsedMin) ?? num(entry?.data?.minutes)
  const span = mins && mins > 0 ? mins : 60
  return [start, start + span * 60000]
}

/** The window a WHOOP workout occupied. */
export function workoutWindow(workout) {
  const start = ms(workout?.start)
  const end = ms(workout?.end)
  if (start === null) return null
  return [start, end !== null && end > start ? end : start + (num(workout?.minutes) || 0) * 60000]
}

/* ------------------------------------------------------------------- sports */

/*
 * WHOOP's vocabulary for climbing.
 *
 * Matched LOOSELY — lowercased with separators collapsed — because the exact
 * casing is not something to bet a match on: WHOOP's own docs show
 * `"sport_name": "running"` while the v1 tables read "Rock Climbing", and real
 * data arrives as `rock-climbing` and `bouldering`. A comparison that hinges on
 * which of those is right silently stops matching the day the API tidies itself up.
 */
const CLIMBING_SPORTS = [
  'rock-climbing', 'bouldering', 'climbing', 'indoor-climbing', 'sport-climbing',
]

const SPORT_FAMILIES = { climbing: CLIMBING_SPORTS }

export const normalizeSport = (name) =>
  String(name || '').trim().toLowerCase().replace(/[\s_]+/g, '-')

/**
 * Which family of WHOOP activity this session is, or null for no opinion.
 *
 * Declared in plan.json as `sched.whoopSport`, not inferred here, for the reason
 * every other session fact is: the app does not get to decide that a hangboard
 * session is climbing. `venue: 'gym'` looks like it would work and does not — the
 * grip economy drill is on a wall and crimp crawls are on a stair at home, and
 * nothing about the venue tells you which is which.
 */
export const sportFamily = (session) => session?.sched?.whoopSport || null

/**
 * Does this workout's title fit the session? `null` means no opinion.
 *
 * Three-valued on purpose. `false` is a real signal — a session declared as
 * climbing paired with a Weightlifting workout is a mismatch worth acting on —
 * while `null` (an undeclared session) has to leave the ranking exactly as it was.
 */
export function sportMatches(session, workout) {
  const family = sportFamily(session)
  if (!family) return null
  const names = SPORT_FAMILIES[family]
  if (!names) return null
  return names.includes(normalizeSport(workout?.sport))
}

/* ------------------------------------------------------------- the snapshot */

/**
 * What gets copied onto the entry when the user attaches a workout.
 *
 * Deliberately a flat, self-describing object rather than a WHOOP id to look up
 * later: the whole point is that it keeps working when the lookup cannot. It also
 * carries `percentRecorded`, because an average heart rate over 43% of a session
 * is not the session's average and the number must not travel without that.
 */
export function snapshotOf(workout, { maxHeartRate = null } = {}) {
  if (!workout?.id) return null
  const avgHr = num(workout.avgHr)
  const maxHr = num(workout.maxHr)
  const max = num(maxHeartRate)
  const zones = workout.zones || {}
  const snap = {
    id: workout.id,
    sport: workout.sport || 'unknown',
    start: workout.start || null,
    end: workout.end || null,
    minutes: num(workout.minutes),
    strain: num(workout.strain),
    avgHr, maxHr,
    calories: num(workout.calories),
    percentRecorded: recordedPct(workout.percentRecorded),
    // Heart rate only means something against a ceiling. WHOOP knows their; where
    // it does not, the percentages are absent rather than computed off a guess
    // like 220-minus-age, which is a population average with a ±10 bpm SD.
    maxHeartRate: max,
    pctAvgHr: max && avgHr ? Math.round((avgHr / max) * 100) : null,
    pctMaxHr: max && maxHr ? Math.round((maxHr / max) * 100) : null,
    zones: {
      zero: num(zones.zero), one: num(zones.one), two: num(zones.two),
      three: num(zones.three), four: num(zones.four), five: num(zones.five),
    },
    attachedAt: null, // stamped by the caller, which is the only thing with a clock
  }
  if (num(workout.distanceMeter)) snap.distanceMeter = num(workout.distanceMeter)
  if (num(workout.altitudeGainMeter)) snap.altitudeGainMeter = num(workout.altitudeGainMeter)
  return snap
}

/**
 * How much of a workout the strap actually saw, as a percentage — or null.
 *
 * WHOOP's `percent_recorded` arrives as a FRACTION: a fully recorded session
 * comes back as `1`, not `100`. Read literally that is "1% recorded", which is
 * how every workout on the card ended up captioned `only 1% recorded` and how the
 * coach would have been handed a caveat about every session the user has ever logged.
 *
 * Both scalings are accepted rather than one being trusted, because this number
 * crosses two systems and neither documents which it uses: `<= 1` is a fraction
 * and anything above it is already a percentage. The ambiguity is only at 1
 * itself — a genuinely 1%-recorded workout and a complete one — and reading that
 * as complete is the safe way round: the caveat exists to stop an average being
 * quoted off a sliver of a session, and there is no average worth quoting off 1%
 * anyway. Snapshots already attached carry the fraction, so this has to be
 * applied on the way OUT as well as on the way in.
 */
export function recordedPct(v) {
  const n = num(v)
  if (n === null || n < 0) return null
  return n <= 1 ? Math.round(n * 100) : Math.round(n)
}

/** Minutes at or above zone three — the part of a session that was actually hard. */
export function hardMinutes(snap) {
  const z = snap?.zones || {}
  const vals = [z.three, z.four, z.five].map(num).filter(v => v !== null)
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null
}

/* -------------------------------------------------------------- the ranking */

/**
 * Which WHOOP ids are attached to a session, and to WHICH sessions — a LIST per
 * id, because one workout legitimately belongs to two of them.
 *
 * WHOOP records a gym visit as one workout, but one visit often holds two logged
 * sessions — the board and then the laps — so that one workout can be put on both,
 * each saying which part of it was its own. So
 * "already taken" is no longer the right question; "who else has it, and did they
 * split it" is. See `partOf`.
 */
export function attachedIds(entries = []) {
  const map = new Map()
  for (const e of entries) {
    if (e?.deleted) continue
    for (const snap of attachedWhoop(e?.data?.out)) {
    const id = snap?.id
    if (!id) continue
    const list = map.get(id) || []
    list.push({
      entryId: e.id,
      name: e.data?.name || 'another session',
      date: e.date,
      // Whether that session took a slice or the whole thing. A workout on two
      // sessions where neither is split has its minutes counted twice by the day
      // total, and this is what lets the screen say so.
      part: snap.part || null,
    })
    map.set(id, list)
    }
  }
  return map
}

/* --------------------------------------------------- one session, N workouts */

/**
 * EVERY WHOOP workout attached to one session, oldest attachment first.
 *
 * A combined workout can produce several WHOOP workouts for one session, so more
 * than one can be attached. A gym trip the strap recorded as a lift and
 * then a row is two workouts and one session; before this, attaching the second
 * silently replaced the first, which is a measurement quietly disappearing.
 *
 * The first one stays on `out.whoop` and the rest go in `out.whoopMore`, rather
 * than the whole thing becoming a list. That is not squeamishness about a
 * migration — it is what makes every reader written before today keep working
 * and keep being RIGHT about the ordinary case: one attached workout is still
 * exactly the shape it always was, on the same key, and a reader that wants the
 * lot asks for it here. `out.whoop` is their log and the one file in this system
 * with no upstream copy; changing its type under hundreds of entries to save a
 * field name is not a trade worth making.
 */
export function attachedWhoop(out) {
  const first = out?.whoop
  if (!first) return []
  const more = Array.isArray(out?.whoopMore) ? out.whoopMore.filter(Boolean) : []
  return [first, ...more]
}

/** Is this workout id already on this session, in any slot? */
export const hasWhoop = (out, id) => attachedWhoop(out).some(w => w?.id === id)

/* -------------------------------------------------- one workout, two sessions */

/**
 * The slice of an attached workout that belongs to one session.
 *
 * Returns `{ start, end, minutes }`, where `minutes` is the OVERLAP with the
 * workout rather than the length of the window the user typed. Typing 6:00–7:00 against
 * a workout that ended at 6:40 gives 40 minutes, not 60: the question this answers
 * is "how much of what WHOOP recorded was this session", and time either side of
 * the recording is not part of it. A window entirely outside the workout comes
 * back as zero minutes rather than as null, because zero is the honest answer and
 * a screen can say so — see `WhoopWorkouts`.
 *
 * ONLY MINUTES ARE SPLIT. Strain, average and max heart rate, calories and the
 * zone breakdown are properties of the whole workout, and WHOOP publishes no way
 * to recover them for a slice of it: an average over the first half is not half
 * the average, and pro-rating a strain score would be inventing a number. So the
 * snapshot keeps carrying the workout's own figures, the split governs the
 * MINUTES — which is what the training-load chart multiplies — and the card says
 * plainly which numbers are the whole workout's.
 */
export function partOf(snap, { start, end } = {}) {
  const win = workoutWindow(snap)
  const a = ms(start)
  const b = ms(end)
  // No workout is not a zero-minute part of one — there is nothing to be part of.
  if (!win || a === null || b === null || b <= a) return null
  return {
    start: new Date(a).toISOString(),
    end: new Date(b).toISOString(),
    minutes: overlapMinutes([a, b], win),
  }
}

/**
 * How many minutes of an attached workout belong to THIS session: the split
 * where there is one, the whole workout where there is not.
 *
 * The one place that question is answered. `minutesFor` reads it, the coach's
 * digest reads it, and the card shows it, so the number on screen, the number in
 * the training-load chart and the number the coach is told can never disagree.
 */
export function attachedMinutes(snap) {
  if (!snap) return null
  const part = num(snap.part?.minutes)
  return part !== null ? part : num(snap.minutes)
}

/** Is this session carrying only a slice of its workout? */
export const isSplit = (snap) => Boolean(snap?.part)

/* ------------------------------------------------------- filling the card */

/*
 * Which catalog activity a WHOOP sport is.
 *
 * This was a hardcoded map of about forty sport names onto the nine values the
 * old *Other training* card offered. It is now READ OFF THE CATALOG — each
 * activity in plan.json declares the WHOOP `sport_name` values that resolve to
 * it — for the reason the catalog exists at all: adding a sport should be a
 * content edit with no rebuild, and a second list of sport names in code is a
 * second list to forget to update.
 *
 * The old map was also wrong in a way nobody noticed. A real
 * `data/whoop.json` held six sports and THREE of them resolved to nothing:
 * `dance`, `mountain-biking`, and WHOOP's own generic `activity`. Attaching one
 * of those filled in no activity at all, which on a card whose every other field
 * is gated behind the activity meant attaching it did nothing visible.
 *
 * CLIMBING STILL MAPS TO NOTHING, and that is deliberate and unchanged. The
 * climbing sessions are their own cards, they ask the hard-finger question, and
 * that answer is what the injury budget counts. Quietly labelling a bouldering
 * workout as a generic logged activity would put a hard finger day somewhere the
 * budget cannot see it. The catalog simply contains no climbing entries, so this
 * falls out of the content rather than needing a special case.
 */

/** `{ normalized sport name -> activity key }`, built from a card's catalog. */
export function sportIndex(activityField) {
  const index = new Map()
  for (const a of activityField?.activities || []) {
    for (const name of a.whoop || []) index.set(normalizeSport(name), a.key)
  }
  return index
}

/** The activity key for a WHOOP sport, or null for no opinion. */
export function choiceForSport(activityField, sport) {
  return sportIndex(activityField).get(normalizeSport(sport)) || null
}

const M_PER_MI = 1609.344
const YD_PER_M = 1.093613
const FT_PER_M = 3.28084

/**
 * The card fields a WHOOP snapshot can answer, by the card's own output key.
 *
 * WHOOP measured the time; asking them to type it in off a screen the user is looking
 * at is the chore this removes: nobody should have to calculate or enter a time
 * WHOOP already measured.
 *
 * The rules are strava.js's, deliberately identical: only keys the session
 * DECLARES are filled, and only where they are BLANK — nothing the user typed is ever
 * overwritten — and the values are the units the card asks for, which means
 * converting out of WHOOP's metres.
 *
 * Note that this fills every field the card declares, not only the ones on
 * screen. It has to: on an empty card nothing but "what did you do" is a
 * question yet, and the sport is the thing that answers it. The caller prunes
 * afterwards (`pruneAttached` in lib/outputs.js), which is also what stops a
 * distance landing on a lifting session.
 *
 * Duration is their SLICE of the workout, not the whole thing, or a gym visit
 * split across the board and the laps would put its full length on both.
 */
function fillValues(fields, out, snap) {
  const declared = new Map((fields || []).map(f => [f.key, f]))
  const blank = (k) => out?.[k] === undefined || out?.[k] === null || out?.[k] === ''
  const values = {}

  const activityField = declared.get('activity')
  if (activityField && blank('activity')) {
    // Resolved against the card's OWN catalog, so a value can never be filled in
    // that the card does not offer — the same rule the `options` check enforced
    // before the catalog existed.
    const choice = choiceForSport(activityField, snap?.sport)
    if (choice) values.activity = choice
  }

  /*
   * Which distance field this workout's sport actually uses.
   *
   * A pool is counted in yards and a ride in miles, and they are two different
   * fields. Filling BOTH and letting `pruneAttached` drop the wrong one would
   * work on screen and still be wrong, because `filled` is the bookkeeping that
   * lets `detachFrom` put back exactly the blanks it took — and it would then be
   * claiming credit for a number that never landed.
   */
  const activityKey = values.activity ?? out?.activity
  const shape = (activityField?.activities || []).find(a => a.key === activityKey)?.shape || null
  const mins = attachedMinutes(snap)
  if (declared.has('duration') && blank('duration') && mins) values.duration = Math.round(mins)
  const metres = num(snap?.distanceMeter) ? snap.distanceMeter : null
  if (shape === 'pool') {
    const yd = metres === null ? null : metres * YD_PER_M
    if (declared.has('poolDistance') && blank('poolDistance') && yd) values.poolDistance = Math.round(yd)
  } else {
    const mi = metres === null ? null : metres / M_PER_MI
    if (declared.has('distance') && blank('distance') && mi) values.distance = Math.round(mi * 10) / 10
  }
  const ft = num(snap?.altitudeGainMeter) ? snap.altitudeGainMeter * FT_PER_M : null
  if (declared.has('elevation') && blank('elevation') && ft) values.elevation = Math.round(ft)
  return values
}

/**
 * Attach a snapshot: the new `out`, with any blank field it can answer filled in.
 *
 * Takes a snapshot that is already built (`snapshotOf` plus the caller's
 * `attachedAt`, and the suggested `part` where workout mode timed the session),
 * because stamping a clock and proposing a split are the component's job. What
 * this owns is the fill and its bookkeeping: `filled: { key: value }` on the
 * snapshot, which is what lets `detachFrom` put back exactly the blanks it took
 * and nothing the user has typed over since.
 */
export function attachTo(session, out, snap) {
  if (!snap) return { ...out }
  const values = fillValues(session?.outputs, out, snap)
  const stamped = { ...snap, ...(Object.keys(values).length ? { filled: values } : {}) }

  /*
   * A SECOND workout is added, not substituted.
   *
   * It still only fills BLANKS — `fillValues` has always worked that way — so the
   * first attachment answers the card's questions and later ones answer whatever
   * is still unanswered, which is usually nothing. Re-attaching the SAME id
   * replaces that one in place, because that is what changing a split does.
   */
  const existing = attachedWhoop(out)
  if (!existing.length) return { ...out, ...values, whoop: stamped }

  const next = existing.some(w => w?.id === snap.id)
    ? existing.map(w => (w?.id === snap.id ? stamped : w))
    : [...existing, stamped]
  return { ...out, ...values, whoop: next[0], ...moreOf(next) }
}

/** `whoopMore` set, or removed when there is nothing left in it. */
function moreOf(list) {
  const rest = list.slice(1)
  return rest.length ? { whoopMore: rest } : { whoopMore: undefined }
}

/** Detach: drop the snapshot, and clear each filled field that is still what we filled. */
export function detachFrom(out, id = null) {
  const all = attachedWhoop(out)
  if (!all.length) return { ...out }
  // No id named means the one the caller is looking at, which for every screen
  // written before multi-attach is the only one there is.
  const snap = id ? all.find(w => w?.id === id) : all[0]
  if (!snap) return { ...out }

  const next = { ...out }
  const left = all.filter(w => w !== snap)
  delete next.whoop
  delete next.whoopMore
  if (left.length) {
    next.whoop = left[0]
    if (left.length > 1) next.whoopMore = left.slice(1)
  }
  // Give back exactly the blanks THIS one took, and nothing the user has typed over.
  for (const [key, value] of Object.entries(snap?.filled || {})) {
    if (next[key] === value) delete next[key]
  }
  return next
}

/**
 * The day's workouts, best candidate first, with at most one marked `likely`.
 *
 * Four signals, in the order they can be trusted:
 *
 *   OVERLAP — the session was timed by workout mode and the workout overlaps it.
 *     This is the only signal that is close to evidence, so it dominates.
 *   THE SPORT — the workout's own title against what the session IS
 *     (`sched.whoopSport`). A climbing session and a workout WHOOP called
 *     `rock-climbing` or `bouldering` agree about what happened, which is a real
 *     claim and not a coincidence of length; a climbing session and a
 *     Weightlifting workout disagree, and a mismatch can never be `likely`.
 *   THE ONLY ONE — exactly one unattached workout on the day. Not proof, but the
 *     question "which of these was it" has one answer, so it is offered as one.
 *   DURATION — how close the workout's length is to the session's. A weak signal
 *     and treated as one: it orders the list and never on its own makes a
 *     candidate `likely`, because "about the same length" is true of the warm-up,
 *     the session, and the hour belaying afterwards.
 *
 * An already-attached workout stays in the list, marked with where it went. Hiding
 * it makes a mis-attachment invisible, and moving one is a normal correction.
 */
export function rankForSession({ workouts = [], entry, session, date, entries = [] } = {}) {
  const taken = attachedIds(entries)
  const mine = new Set(attachedWhoop(entry?.data?.out).map(w => w?.id).filter(Boolean))
  const window = sessionWindow(entry)
  const target = num(entry?.data?.minutes) ?? num(session?.minutes)

  const scored = workouts
    .filter(w => w?.id && (!date || w.date === date))
    .map(w => {
      const overlap = overlapMinutes(window, workoutWindow(w))
      const span = num(w.minutes) || 0
      // Overlap as a fraction of the SHORTER window, so a 20-minute block fully
      // inside a two-hour session reads as fully overlapping rather than as 17%.
      const shorter = Math.min(span || Infinity, target || Infinity)
      const overlapPct = overlap && Number.isFinite(shorter) && shorter > 0
        ? Math.min(100, Math.round((overlap / shorter) * 100))
        : 0
      const closeness = target && span
        ? Math.max(0, 100 - Math.round((Math.abs(span - target) / target) * 100))
        : 0
      // The first OTHER session holding it. With multi-attach allowed, "someone
      // else has this" and "I have this" are no longer mutually exclusive.
      const heldBy = (taken.get(w.id) || []).find(h => h.entryId !== entry?.id) || null
      const sportFit = sportMatches(session, w)
      return {
        workout: w,
        overlapMin: overlap,
        overlapPct,
        closeness,
        // true / false / null — null being "this session has no declared sport",
        // which must leave the ranking exactly as it was before sports existed.
        sportFit,
        /*
         * Overlap outranks the sport, which outranks duration.
         *
         * One is a measurement of the same stretch of time; the second is two
         * sources agreeing about what the activity WAS; the third is a coincidence
         * of length. The mismatch penalty is heavy enough to sink a workout below
         * every plausible one without needing to hide it.
         */
        score: overlapPct * 10 + (sportFit === true ? 200 : sportFit === false ? -400 : 0) + closeness,
        attachedTo: heldBy,
        attached: mine.has(w.id),
      }
    })
    .sort((a, b) => b.score - a.score || String(a.workout.start).localeCompare(String(b.workout.start)))

  const free = scored.filter(c => !c.attachedTo && !c.attached)
  const best = free[0]
  // The sport-matching workouts on the day, whoever holds them: "the only climb
  // tonight" has to stop being true the moment there are two, including one
  // already attached to something else.
  const sameSport = scored.filter(c => c.sportFit === true)

  /*
   * `likely` is claimed only where there is a reason to claim it.
   *
   * Any of three reasons. A real OVERLAP with a session the clock actually timed.
   * The only workout on the day whose SPORT is what this session is — a gym night
   * with one `rock-climbing` and one `Weightlifting` has an obvious answer even
   * with no clock, which is the case this rule exists for. Or ONE workout on the
   * whole day: the only workout, not merely the only one left once the others were
   * spoken for, because "there is one answer to this question" and "here is the
   * leftover" are different things — a night with the climb already attached
   * elsewhere and a warm-up lift going spare must suggest nothing at all.
   *
   * Never on duration alone: "about the same length" is true of the warm-up, the
   * session, and the hour spent belaying afterwards. And never on a workout whose
   * sport CONTRADICTS the session, whatever else lines up.
   */
  const claim = best && best.sportFit !== false && (
    best.overlapPct >= 50 ||
    (best.sportFit === true && sameSport.length === 1) ||
    scored.length === 1
  )
  const likely = claim ? best.workout.id : null

  return scored.map(c => ({ ...c, likely: c.workout.id === likely }))
}

/* --------------------------------------------------------------- the cache */

/** The recovery row for one local date, or null. */
export function recoveryFor(cache, date) {
  if (!date) return null
  return (cache?.recovery || []).find(r => r?.date === date) || null
}

/** The day's workouts, newest first. */
export function workoutsOn(cache, date) {
  if (!date) return []
  return (cache?.workouts || []).filter(w => w?.date === date)
}

/**
 * How a recovery number reads against their own recent baseline.
 *
 * A raw 42 ms HRV means nothing without knowing their normal; WHOOP's own app leads
 * with the deviation for the same reason. The baseline is the median of the days
 * BEFORE this one in the window — a mean would be dragged by the one night the user
 * slept four hours, which is exactly the kind of day that must not move a
 * baseline. Fewer than four prior days returns null rather than a shaky trend.
 */
export function baselineFor(cache, date, key = 'hrv') {
  const prior = (cache?.recovery || [])
    .filter(r => r?.date && r.date < date && num(r[key]) !== null)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 14)
    .map(r => num(r[key]))
  if (prior.length < 4) return null
  const sorted = [...prior].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return Math.round(median * 10) / 10
}

/**
 * Today's readiness, as a small object the recommender and the coach both read.
 *
 * Returns null when there is nothing trustworthy to say — no row, or WHOOP itself
 * reporting `calibrating`, which is it telling you not to use the number yet.
 * Null is the whole safety story: every consumer treats "no reading" as "behave
 * exactly as you did before WHOOP existed".
 */
export function readinessFor(cache, date) {
  const row = recoveryFor(cache, date)
  if (!row || row.calibrating) return null
  const recovery = num(row.recovery)
  const hrv = num(row.hrv)
  const restingHr = num(row.restingHr)
  if (recovery === null && hrv === null) return null

  const hrvBase = baselineFor(cache, date, 'hrv')
  const rhrBase = baselineFor(cache, date, 'restingHr')
  return {
    date,
    recovery,
    hrv,
    hrvBaseline: hrvBase,
    hrvDeltaPct: hrvBase && hrv ? Math.round(((hrv - hrvBase) / hrvBase) * 100) : null,
    restingHr,
    restingHrBaseline: rhrBase,
    restingHrDelta: rhrBase && restingHr ? Math.round((restingHr - rhrBase) * 10) / 10 : null,
    strain: num(row.strain),
    spo2: num(row.spo2),
    skinTempC: num(row.skinTempC),
  }
}

/* -------------------------------------------------------------------- sleep */

/*
 * Sleep is WHOOP's, filled in by the Totem bridge's nightly sync and handed over in
 * the same pull as recovery (`sleep[]` on /api/whoop/training). One night per WAKE
 * date, so the night you woke up from today is filed under today — the same
 * calendar `recovery` is on, which is what lets the two sit on one card.
 */

/** The night that ended on this morning, or null. */
export function sleepFor(cache, date) {
  if (!date) return null
  return (cache?.sleep || []).find(n => n?.date === date) || null
}

/** Up to `count` nights ending on `date`, oldest first, with nulls for nights WHOOP has nothing. */
export function sleepNights(cache, date, count = 14) {
  if (!date) return []
  const byDate = new Map((cache?.sleep || []).filter(n => n?.date).map(n => [n.date, n]))
  const [y, m, d] = date.split('-').map(Number)
  const out = []
  for (let i = count - 1; i >= 0; i--) {
    const iso = new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10)
    out.push({ date: iso, night: byDate.get(iso) || null })
  }
  return out
}
