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

/**
 * The sub-threshold ceiling, in kilograms, from the most recent critical-force
 * test. The rule is the plan's own and deliberately conservative: CFmin, or
 * CF minus the correction above, whichever is LOWER.
 *
 * Returns null rather than guessing when nothing has been tested — a made-up
 * ceiling is worse than no ceiling, because it looks authoritative.
 */
export function resolveCeiling(entries = []) {
  const test = [...entries]
    .filter(e => !e.deleted && e.kind === 'test' && e.data?.testId === 'critical-force')
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .at(-1)
  if (!test) return null

  const cf = Number(test.data.cfKg)
  if (!Number.isFinite(cf) || cf <= 0) return null

  const rawMin = Number(test.data.cfMinKg)
  const cfMin = Number.isFinite(rawMin) && rawMin > 0 ? rawMin : null
  const corrected = cf - CF_CORRECTION_KG
  const mvc = Number(test.data.mvcKg)

  return {
    cf,
    cfMin,
    corrected,
    ceiling: cfMin != null ? Math.min(cfMin, corrected) : corrected,
    // Which rule binds. If CFmin is the lower one that says something different
    // about the test than the flat correction being lower, so it is worth showing.
    bound: cfMin != null && cfMin < corrected ? 'cfmin' : 'corrected',
    mvc: Number.isFinite(mvc) && mvc > 0 ? mvc : null,
    date: test.date,
  }
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
