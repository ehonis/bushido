/*
 * Hard finger days: which logged sessions spent one.
 *
 * This is what is left of lib/recommend.js. The recommender, its quota board,
 * the coach's nudges and the check-in's placement checks were removed on
 * 2026-10-25 (issue #31): nothing ranks or offers sessions any more, and the
 * only things that ever read the two finger rules (no hard finger day the day
 * after another, no more than `recommender.hardCap` a week) were those offers.
 * Placement itself never consulted them.
 *
 * What still reads this is history: the Progress page's "Hard finger days" chart
 * and total, in the Climbing group. So the predicate stays exactly as it was,
 * because changing it would rewrite what an old climbing week reads as.
 */

import { isDone } from './store.js'
import { optFor } from './menu.js'

const sched = (opt) => opt?.sched || {}

/**
 * How much this session costs your fingers. Declared per session; falls back to
 * the load level so a menu entry with no `sched` still classifies sanely.
 */
export function fingerLoad(opt) {
  const declared = sched(opt).fingerLoad
  if (declared) return declared
  const lvl = Number(opt?.level) || 1
  return lvl >= 4 ? 'hard' : lvl >= 3 ? 'light' : 'none'
}

/**
 * Does this entry make its DATE a hard finger day?
 *
 * Three ways in, read in this order: the session cannot load the fingers at all,
 * the user ANSWERED the question, or the plan's declaration stands.
 */
export function isHardEntry(entry, menu = []) {
  // `optFor`, not a raw find. An entry logged against a card that has since been
  // RENAMED would otherwise resolve to nothing and fall through to "level 4 or
  // more", which once turned nine bike rides into hard FINGER days. See lib/menu.js.
  const opt = optFor(menu, entry?.data?.optId)
  const load = opt ? fingerLoad(opt) : null

  // A session that cannot load the fingers never counts, however hard it was: a
  // savage bike ride is a heavy day and zero finger exposures. Asked before the
  // logged answer, so a stale `out.hardFingers` cannot give a ride one.
  if (load === 'none') return false

  // What the user logged wins, in both directions: an easy board night costs
  // nothing and a social night they projected through costs a full exposure.
  const said = entry?.data?.out?.hardFingers
  if (said === true || said === false) return said

  // Nothing said: exactly what the app did before the question existed, so every
  // older entry still classifies the same way.
  if (load === 'hard') return true
  if (load === 'sub') return false
  return Number(entry?.data?.level) >= 4
}

/** The dates, in order, that cost a hard finger exposure. */
export function hardDates(entries, menu) {
  return [...new Set(entries
    .filter(e => e.kind === 'daily' && isDone(e) && e.date && isHardEntry(e, menu))
    .map(e => e.date))].sort()
}
