/*
 * What a session cost you, as a load level 1–4.
 *
 * Pure and out of the components for the same reason `minutesFor` is: this is
 * the number that decides whether a day spent a HARD FINGER EXPOSURE, which is
 * the one rule in this app that exists to stop them hurting themselves. Arithmetic
 * that decides that is worth testing as arithmetic.
 *
 * Most sessions declare a fixed `level`. The social ones declare `levelFrom`
 * instead and take it from what the user logged, because "went bouldering with
 * friends" spans an easy evening and an accidental limit day.
 */

const clamp = (n) => Math.max(1, Math.min(4, Math.round(n)))

/**
 * `levelFrom` names the logged field; `levelMap` turns its value into a level.
 *
 * The field used to be a 1–4 intensity slider sitting directly beside the 1–10
 * RPE slider, asking the same question twice in two scales, so those
 * cards now read the RPE the user gives every session anyway. That needs a mapping,
 * because a level is 1–4 and RPE is 1–10, and `levelMap` is a list of
 * `{ from, level }` thresholds which is CONTENT: the boundary that decides
 * whether a fun night spends a hard finger exposure is a number in plan.json
 * that can be read and argued with, not arithmetic buried in a component.
 *
 * `levelFromWas` is the field the card read BEFORE the merge. An entry logged
 * then carries no RPE-derived level, and re-saving it — correcting the skin
 * score on a day the user projected — must not quietly downgrade a hard day to the
 * card's nominal easy one. The old scale was already 1–4, so it needs no map.
 *
 * With neither field logged, the card's own `level` stands.
 */
export function levelFor(opt, out) {
  const key = opt?.levelFrom
  const logged = key ? Number(out?.[key]) : NaN
  if (Number.isFinite(logged)) {
    const map = opt?.levelMap
    if (Array.isArray(map) && map.length) {
      const hit = [...map]
        .sort((a, b) => Number(b.from) - Number(a.from))
        .find(r => logged >= Number(r.from))
      if (hit) return clamp(Number(hit.level))
    }
    return clamp(logged)
  }
  const legacy = opt?.levelFromWas ? Number(out?.[opt.levelFromWas]) : NaN
  if (Number.isFinite(legacy)) return clamp(legacy)
  return opt?.level ?? 1
}
