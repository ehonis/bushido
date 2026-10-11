/*
 * Consecutive days trained.
 *
 * Lifted out of the Today tab on 2026-09-15 when the streak left the tile row for
 * the header — it now renders next to the profile button, which is outside the
 * tab that used to own the arithmetic.
 *
 * TODAY IS A GRACE DAY. An unlogged today does not break the streak, because at
 * 9am nobody has trained yet and a counter that reads zero every morning is a
 * counter that is wrong most of the time you look at it. Any EARLIER gap does
 * break it. That rule predates this file; it is the tile's own behaviour, moved.
 *
 * A COMMUTE COUNTS HERE. `isDone` is the only test, so a short ride to work
 * counts the same as a session — decided when the "not a workout, just adds
 * miles" button went in: getting on the bike is the streak's whole question. It is NOT load and, since 2026-09-21, not a quota
 * either (see `weekDaily` in quota.js), so this file is deliberately the odd one
 * out and must not grow an `isTraining` check to match them.
 */

import { localIso, fromIso } from './dates.js'
import { isDone } from './store.js'

/** Every date with something completed on it. */
export function trainedDates(entries) {
  const out = new Set()
  for (const e of entries || []) {
    if (e.kind !== 'daily' || !e.date || !isDone(e)) continue
    out.add(e.date)
  }
  return out
}

/**
 * How many days in a row, counting back from `today`.
 *
 * Anchored to the real today rather than whatever day is being previewed — the
 * streak is a fact about their training, not about what the user is looking at.
 */
export function streakDays(entries, today = localIso()) {
  const dates = trainedDates(entries)
  let n = 0
  const d = fromIso(today)
  for (;;) {
    const key = localIso(d)
    if (!dates.has(key)) {
      if (key !== today) break     // a real gap
      d.setDate(d.getDate() - 1)   // today is not a gap yet
      continue
    }
    n++
    d.setDate(d.getDate() - 1)
  }
  return n
}
