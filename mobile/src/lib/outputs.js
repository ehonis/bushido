/*
 * Which of a session's outputs are questions TODAY.
 *
 * The free-form cards ask one thing first — what did you actually do — and the
 * answer decides what the rest of the form even means. Miles and average speed
 * are the point of a run and nonsense on a lifting session; sets, reps and what
 * you loaded the bar with are the reverse. Before this existed *Other training*
 * showed all seven fields to everything, so a lifting day was logged on a form
 * asking for its distance and incline.
 *
 * A field declares its own condition in plan.json — content, so the shape of the
 * form can be revised with no rebuild:
 *
 *   { "key": "distance", "type": "number", "when": { "activity": ["run", "bike"] } }
 *   { "key": "rpe",      "type": "slider", "when": { "activity": "*" } }
 *
 * `"*"` is "once the user has answered that, whatever the user answered" — for the fields
 * that apply to everything and are still not a question on an empty card. It
 * exists so that adding an activity to the card does not mean remembering to add
 * it to every gate that lists all of them, which is a footgun that would show up
 * as one silently missing field months later.
 *
 * Three decisions worth not undoing.
 *
 * **Unanswered is hidden, not shown.** A gate whose field the user has not filled in
 * yet fails, so the card opens as one question — pick the activity — and grows
 * the fields that go with the answer. A form that shows everything until told
 * otherwise is the thing being fixed, and "show it until we know" is that form.
 *
 * **A hidden field's VALUE is dropped, not kept.** Log 3.1 miles as a run,
 * correct the activity to a lift, and the miles go. This is the same rule as the
 * per-climb detail (see lib/grades.js): hidden data that still charts is a log
 * that disagrees with itself, and a distance on a bench-press day would reach
 * the day's stats line and the coach's digest with nothing on screen to explain
 * it. Only fields that DECLARE a `when` are ever pruned — the app-level keys
 * (`minutesSpent`, `improve`, an attached workout) are not the plan's to gate.
 *
 * **A gate may ask the CATALOG, not only the answers.** With ninety-one activities
 * on the workout card, `when: { activity: [...] }` stops scaling — listing every
 * running variant on every field a run has is how one gets forgotten. So a gate key
 * the answers do not hold is handed to an optional `derive` resolver, which looks it
 * up on the catalog entry instead: `when: { shape: ["distance"] }` is every
 * distance sport at once, and adding a sport needs no edit anywhere else. The
 * resolver is `gateResolver` in lib/activities.js. Absent, every gate reads only
 * what the user answered and this file behaves exactly as it did before the pivot.
 *
 * **A number that can be computed is a placeholder, never a value.** `derive`
 * puts the arithmetic the user would have done themselves in the box as a hint — average
 * speed out of distance and time — without storing a number the user did not give.
 * Same rule as the card's own duration estimate: pre-filling it is how you get a
 * number confirmed without being read.
 */

const isBlank = (v) => v === undefined || v === null || v === ''

/**
 * Is this field a question, given what has been answered so far?
 *
 * Every gate in `when` has to pass (AND), and a gate passes when the answer is
 * one of its listed values. Compared as strings, because the values are
 * plan.json's own vocabulary and a choice stored as `2` must match `"2"`.
 */
export function fieldVisible(field, out = {}, derive = null) {
  const when = field?.when
  if (!when || typeof when !== 'object') return true
  return Object.entries(when).every(([key, allowed]) => {
    const own = out?.[key]
    const v = own === undefined && derive ? derive(key, out) : own
    if (isBlank(v)) return false
    const list = Array.isArray(allowed) ? allowed : [allowed]
    return list.some(a => a === '*' || String(a) === String(v))
  })
}

/** The fields to put on screen, in the plan's order. */
export function visibleOutputs(session, out = {}, derive = null) {
  return (session?.outputs || []).filter(f => fieldVisible(f, out, derive))
}

/**
 * `out` with every gated-but-hidden field's answer removed.
 *
 * Run on the way IN to a save rather than on the way out to the screen, so what
 * is stored and what is shown can never disagree. Iterated to a fixpoint because
 * one field's gate can be another field's answer: hiding the gate has to hide
 * what hung off it, and a single pass would leave the orphan behind.
 */
export function pruneHidden(session, out = {}, derive = null) {
  const gated = (session?.outputs || []).filter(f => f?.when && f.key)
  if (!gated.length) return out
  let next = out
  for (let pass = 0; pass <= gated.length; pass++) {
    let dropped = false
    for (const f of gated) {
      if (next[f.key] === undefined) continue
      if (fieldVisible(f, next, derive)) continue
      const { [f.key]: gone, ...rest } = next
      next = rest
      dropped = true
    }
    if (!dropped) break
  }
  return next
}

/**
 * `pruneHidden`, plus the attached snapshots' `filled` bookkeeping kept honest.
 *
 * This is the pruning that runs after a WHOOP or Strava attach. The fill works
 * off the fields the card DECLARES rather than the ones on screen, because on an
 * empty card nothing but "what did you do" is a question yet and the workout's
 * sport is what answers it — so attaching a run has to be able to fill the
 * distance the card is about to start asking for. Pruning afterwards is then what
 * stops a lifting session acquiring a distance from a mislabelled workout.
 *
 * A `filled` entry for a field that has just been pruned would claim credit for a
 * value that is no longer there, so it goes too — and `detachFrom` therefore
 * still means exactly "put back the blanks I took".
 */
export function pruneAttached(session, out, derive = null) {
  const next = { ...pruneHidden(session, out, derive) }
  for (const key of ['whoop', 'strava']) {
    const snap = next[key]
    if (!snap?.filled) continue
    const kept = Object.entries(snap.filled).filter(([k]) => k in next)
    if (kept.length === Object.keys(snap.filled).length) continue
    const { filled, ...rest } = snap
    next[key] = kept.length ? { ...rest, filled: Object.fromEntries(kept) } : rest
  }
  return next
}

/**
 * The number the app can work out for them, or null.
 *
 * Only average speed so far, and only where both halves of it were measured.
 * Returned for the PLACEHOLDER — see the note at the top of the file about why
 * it is never written to the entry.
 */
export function derivedValue(field, out = {}) {
  const min = Number(out?.duration)
  if (field?.derive === 'speed') {
    const mi = Number(out?.distance)
    if (!(mi > 0) || !(min > 0)) return null
    return Math.round((mi / (min / 60)) * 10) / 10
  }
  // Seconds per 100 yards — how a swim is actually read back, and the one number
  // a pool session is judged on. Same rule as average speed: offered as the
  // placeholder, never written, so correcting the distance corrects the pace.
  if (field?.derive === 'pace100') {
    const yd = Number(out?.poolDistance)
    if (!(yd > 0) || !(min > 0)) return null
    return Math.round((min * 60) / (yd / 100))
  }
  return null
}

/**
 * Which service filled this field in, if the value is still the one it filled.
 *
 * The bookkeeping is the snapshot's own `filled` map (see server/strava.js) —
 * read rather than inferred, because a 38 the user typed that happens to match WHOOP's
 * 38 is still a number the user gave, and the tag has to say so. Once the user types over
 * it the values differ and the tag goes, which is the same test `detachFrom`
 * uses to decide what it may clear.
 */
export function filledBy(out, key) {
  for (const [source, label] of [['whoop', 'WHOOP'], ['strava', 'Strava']]) {
    const filled = out?.[source]?.filled
    if (filled && Object.prototype.hasOwnProperty.call(filled, key) && filled[key] === out[key]) {
      return label
    }
  }
  return null
}
