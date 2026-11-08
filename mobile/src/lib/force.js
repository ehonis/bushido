/*
 * Numbers derived from the force tests.
 *
 * Pure and kept out of the view layer because what comes out of here is a
 * TRAINING LOAD — the kilograms the user sets the gauge to for every sub-threshold
 * session. Getting it wrong doesn't render badly, it trains the wrong intensity
 * for a month, so it is testable on its own (app/workout.test.js).
 */

/**
 * How far below the reported critical force the genuinely sustainable
 * intensity actually sits.
 *
 * Baláš et al. 2024 (Eur J Appl Physiol, n=12): at their calculated CF only one
 * of twelve climbers completed a 720 s trial, mean time to failure 440 ± 140 s.
 * Completion rose to 38% at CF−2 kg, 69% at CF−4 kg, and 92% at CF−6 kg. Six is
 * the value that buys the 92%, and it is why this correction exists at all —
 * the number the Tindeq app reports is not the number you can hold.
 */
export const CF_CORRECTION_KG = 6

/** Climber reference for CF as a fraction of MVC — Fryer 2019, 41.0 ± 6.2%. */
export const CF_PCT_MVC_MEAN = 41.0
export const CF_PCT_MVC_SD = 6.2

/** Test-retest CV of the 4-min all-out protocol — McClean 2023, ICC 0.848. */
export const CF_NOISE_PCT = 21

/** A positive number, or null: blank, zero, text and `Number(null)` are not a force. */
const positive = (v) => {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * The ceiling, and why there is none when there is none.
 *
 * `ceiling` is the sub-threshold ceiling from the most recent critical-force
 * test that MEASURED a critical force. The rule is the plan's own and
 * deliberately conservative: CFmin, or CF minus the correction above,
 * whichever is LOWER.
 *
 * Two things can stand in its way, and both are said rather than hidden (#76):
 *
 *   - `incomplete`: a newer critical-force result with no CF on it (a form
 *     saved half-filled, or before #76 an empty one). It never hides the last
 *     usable ceiling, because a result with no CF says nothing about the load;
 *     its date is returned so the page can say which result is being used.
 *   - `tooLow`: the newest measured CF is at or under the correction, so the
 *     rule gives zero or less. That is a real measurement and it supersedes any
 *     older one, so there is NO ceiling, rather than an older, higher one or a
 *     negative number of kilograms.
 */
export function ceilingState(entries = []) {
  const tests = [...entries]
    .filter(e => e && !e.deleted && e.kind === 'test' && e.data?.testId === 'critical-force')
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const test = tests.filter(e => positive(e.data.cfKg) != null).at(-1) || null
  const later = tests.filter(e => positive(e.data.cfKg) == null && (!test || String(e.date) > String(test.date)))
  const incomplete = later.length ? later.at(-1).date : null
  if (!test) return { ceiling: null, incomplete, tooLow: null }

  const cf = positive(test.data.cfKg)
  const cfMin = positive(test.data.cfMinKg)
  const corrected = cf - CF_CORRECTION_KG
  const ceiling = cfMin != null ? Math.min(cfMin, corrected) : corrected
  if (!(ceiling > 0)) return { ceiling: null, incomplete, tooLow: { cf, date: test.date } }

  return {
    ceiling: {
      cf,
      cfMin,
      corrected,
      ceiling,
      // Which rule binds. If CFmin is the lower one that says something different
      // about the test than the flat correction being lower, so it is worth showing.
      bound: cfMin != null && cfMin < corrected ? 'cfmin' : 'corrected',
      mvc: positive(test.data.mvcKg),
      date: test.date,
    },
    incomplete,
    tooLow: null,
  }
}

/**
 * The sub-threshold ceiling in kilograms (`ceilingState(...).ceiling`).
 *
 * Returns null rather than guessing when nothing usable has been tested — a
 * made-up ceiling is worse than no ceiling, because it looks authoritative.
 */
export function resolveCeiling(entries = []) {
  return ceilingState(entries).ceiling
}

/** CF as a percentage of the max it was measured against, or null. */
export function cfPctOfMax(ceiling) {
  if (!ceiling?.mvc) return null
  return Math.round((ceiling.cf / ceiling.mvc) * 1000) / 10
}

/** Where that percentage sits against the climber reference band. */
export function cfBand(pct) {
  if (pct == null) return null
  if (pct < CF_PCT_MVC_MEAN - CF_PCT_MVC_SD) return 'below'
  if (pct > CF_PCT_MVC_MEAN + CF_PCT_MVC_SD) return 'above'
  return 'within'
}
