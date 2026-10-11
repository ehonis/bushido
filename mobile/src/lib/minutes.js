/*
 * How long a session took, and how much that number can be trusted.
 *
 * Kept out of the components because it is the input to the weekly training-load
 * chart (sRPE = RPE x minutes), which makes it arithmetic rather than presentation
 * — and arithmetic that decides how hard a week looks is worth testing directly.
 */

/**
 * How long the session actually took, best source first.
 *
 * This matters more than it looks: the weekly training-load chart is sRPE —
 * your RPE multiplied by these minutes — so where this falls back to the card's
 * nominal number, that chart is reporting how long the session was SUPPOSED to
 * take. A gym night is 150 minutes whether you were there 90 or 180.
 *
 *   1. `out.minutesSpent` — the "time spent" field, which EVERY session now
 *      carries. It is app-level rather than declared per session, for the same
 *      reason the notes are: the nominal duration on a card is an estimate, and
 *      the one number that makes sRPE honest should not depend on whether
 *      whoever wrote the session remembered to ask for it.
 *   2. `minutesFrom` — a duration the session asks for in its own words (how
 *      *Other training* records a 38 minute run). Only one of these two is ever
 *      on screen: a session that already asks for its duration does not also get
 *      the generic field, because two boxes for one fact is two answers.
 *   3. What WHOOP measured for a workout the user ATTACHED to this session. Both this
 *      and 4 are measurements; attaching is the one the user had to press a button for,
 *      and an explicit act outranks a passive clock. So picking a workout sets the
 *      session's length with no second tap, and typing over it still wins.
 *      Where the user has SPLIT that workout between two sessions, this is their slice of
 *      it and not the whole thing — see `attachedMinutes`. That distinction is the
 *      whole point of the split: one gym visit that WHOOP recorded as a single
 *      130-minute workout, sitting whole on two sessions, is a day the load chart
 *      reads as 260 minutes of training.
 *   4. What workout mode measured, wall clock, from the moment you hit start.
 *   5. The card's nominal duration, which is a plan, not an observation.
 */
/**
 * A typed number, or null. Absent is not zero — but a typed ZERO is an answer.
 *
 * The rest of this file rejects zero, and should: a clock that read 0 did not
 * measure anything, and a WHOOP workout of no length is not one. A zero the user typed
 * is different in kind — it is them saying so — so the one field the user types is the
 * one place zero is allowed through.
 */
import { attachedMinutes, isSplit, attachedWhoop } from '../../../server/whoop.js'
import { optFor } from './menu.js'
import { attachedMinutes as stravaMinutes, attachedStrava } from '../../../server/strava.js'

/**
 * ALL the attached minutes, added up.
 *
 * Since 2026-09-21 a session may carry several workouts from one service — a gym
 * trip the strap recorded as a lift and then a row, a brick Strava recorded as a
 * ride and a run. The session took as long as all of them took. Summing is right
 * here for the same reason the SPLIT is right the other way round: this number
 * multiplies RPE into the week's training load, and a session that reports one of
 * its two measured pieces is under-reporting the day exactly as a double-counted
 * split over-reported it.
 *
 * `attachedMinutes` per snapshot still honours a WHOOP split, so a shared gym
 * visit contributes their slice and not the whole thing.
 */
const sumMinutes = (list, minutesOfOne) => {
  let total = 0
  for (const snap of list) {
    const n = Number(minutesOfOne(snap))
    if (Number.isFinite(n) && n > 0) total += n
  }
  return total
}

const whoopMinutes = (out) => sumMinutes(attachedWhoop(out), attachedMinutes)
const stravaTotal = (out) => sumMinutes(attachedStrava(out), stravaMinutes)

const stated = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * WHICH source is answering, as a key. The single place the order is written down.
 *
 * `minutesFor` and the provenance line both read this, so the number on screen and
 * the sentence under it can never disagree about where it came from — which they
 * did the first time this logic existed twice.
 */
export function minutesSourceOf(opt, out) {
  if (stated(out?.minutesSpent) !== null) return 'typed'
  const key = opt?.minutesFrom
  const declared = key ? Number(out?.[key]) : NaN
  if (Number.isFinite(declared) && declared > 0) return 'declared'
  const whoop = whoopMinutes(out)
  if (whoop > 0) return 'whoop'
  // A Strava activity the user attached: moving time, so a coffee stop is not training.
  // Below WHOOP because when both are on one session the strap's clock covers the
  // whole session and the ride is one part of it; above the timer for the same
  // reason WHOOP is — attaching is a button the user pressed.
  const strava = stravaTotal(out)
  if (strava > 0) return 'strava'
  const measured = Number(out?.elapsedMin)
  if (Number.isFinite(measured) && measured > 0) return 'timer'
  return 'estimate'
}

export function minutesFor(opt, out) {
  switch (minutesSourceOf(opt, out)) {
    case 'typed': return Math.round(stated(out.minutesSpent))
    case 'declared': return Math.round(Number(out[opt.minutesFrom]))
    case 'whoop': return Math.round(whoopMinutes(out))
    case 'strava': return Math.round(stravaTotal(out))
    case 'timer': return Math.round(Number(out.elapsedMin))
    default: return opt?.minutes
  }
}

/**
 * Does this session ask for its own duration, and therefore not get the generic
 * "time spent" box? `minutesFrom` is that declaration.
 */
export const asksItsOwnDuration = (opt) => Boolean(opt?.minutesFrom)

/**
 * The minutes to store on an entry when its outputs are saved.
 *
 * Exists because saving ANY output recomputes `data.minutes`, and before
 * `minutesSpent` existed a correction lived on the entry itself as
 * `minutes` + `minutesSource: 'typed'`. Recomputing over the top of one of those
 * silently replaced a number the user typed with a measurement the user did not — the
 * 2026-08-11 test day reads 40 minutes against a 3-minute workout-mode clock,
 * so editing its RPE would have rewritten the day as three minutes long and
 * still labelled it "you entered this".
 */
export function resolveMinutes(prevData, opt, out) {
  if (stated(out?.minutesSpent) === null && prevData?.minutesSource === 'typed') {
    const saved = Number(prevData.minutes)
    if (Number.isFinite(saved) && saved >= 0) return Math.round(saved)
  }
  return minutesFor(opt, out)
}

/**
 * A logged session's minutes, plus where the number came from.
 *
 * `data.minutes` is what was resolved when the session was saved. The provenance
 * is read off the FIELD that won, not guessed from the value — a typed 80
 * minutes that happens to equal the card's 80 must still say "you entered this",
 * which is exactly the case an inference gets wrong. `minutesSource: 'typed'` is
 * still honoured for the entries that predate `out.minutesSpent`.
 */
export function minutesOf(entry, menu = []) {
  const d = entry?.data || {}
  const opt = optFor(menu, d.optId)
  const saved = Number(d.minutes)
  const fallback = Number(minutesFor(opt, d.out))
  const minutes = stated(d.out?.minutesSpent) !== null ? stated(d.out.minutesSpent)
    : Number.isFinite(saved) && saved > 0 ? saved
    : Number.isFinite(fallback) && fallback > 0 ? fallback
    : null
  // The legacy stamp first: an entry corrected before `out.minutesSpent` existed
  // carries its provenance on itself. Otherwise the field that won says so.
  const source = d.minutesSource === 'typed' ? 'you entered this' : {
    typed: 'you entered this',
    declared: 'you entered this',
    whoop: attachedWhoop(d.out).length > 1
      ? `measured by WHOOP, across ${attachedWhoop(d.out).length} workouts`
      : isSplit(d.out?.whoop)
        ? 'your share of one WHOOP workout, split across two sessions'
        : 'measured by WHOOP',
    strava: attachedStrava(d.out).length > 1
      ? `moving time across the ${attachedStrava(d.out).length} Strava activities you attached`
      : 'moving time from the Strava activity you attached',
    timer: 'measured by workout mode',
    estimate: "the card's estimate — correct it if you trained longer or shorter",
  }[minutesSourceOf(opt, d.out)]
  return { minutes, source }
}

/**
 * What a day actually cost: every session logged on it, added up.
 *
 * Derived, never stored. A day total kept alongside the sessions would be a
 * second source of truth for the same fact, and the two would drift the first
 * time a session was edited.
 */
export function dayMinutes(list = [], menu = []) {
  return list
    .filter(e => e.kind === 'daily')
    .reduce((sum, e) => sum + (minutesOf(e, menu).minutes || 0), 0)
}
