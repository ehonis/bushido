/*
 * "Last time you did this" and "The last 5 times you did this": which earlier
 * entries are THIS workout (#74).
 *
 * A card is its own history: every repeaters night is the repeaters card, so
 * matching by card id is right, plus the ids the card has answered to (`aka`,
 * `priorIds`). Two cards are containers instead (`sched.repeatVia`): Plan a
 * workout's `planned` and Log a workout's `log-workout`. Every planned workout
 * shares one card id, and so does every free-form one, so by card a Pull day's
 * history was the Core & hips and the Leg day before it, and a Lift's was last
 * week's walks. For those the workout is the identity:
 *
 *   - a planned workout matches another planned one with the same title, or
 *     one that shares at least two exercises and half of the smaller one's
 *     (`sameExercises`), so "Pull" finds the "Pull day"s with the same rows and
 *     curls in them, and not the Push day that also benched;
 *   - a free-form one matches the same card logged as the same activity.
 *
 * Pure, shared by the web and the phone (mobile/src/lib/history.js, byte for byte).
 */

import { liftsDone, liftKeyOf } from './lifts.js'
import { isDone } from './store.js'

/**
 * Which optIds count as "this session", for history.
 *
 * A card's own id, plus the ids it has ANSWERED TO — `aka` (a rename) and
 * `priorIds` (a card this one was split out of). Every repeaters session before
 * 2026-08-10 is stored under `hard-home`, the card max hangs and repeaters were
 * until then; without `priorIds` the one place the history is meant to be useful,
 * standing there about to do it again, was the one place it was truncated.
 *
 * Content, not code: the ids live on the card in plan.json, the same way the
 * rename does, because which card a card used to be is a fact about the program.
 */
export function priorIdsOf(session) {
  if (!session?.id) return []
  return [session.id, ...(session.aka || []), ...(session.priorIds || [])]
}

/**
 * Mostly the same exercises: at least two in common, and at least half of the
 * smaller workout's. Measured on the owner's own log, where a pull day keeps
 * three of five exercises from one week to the next and a push day shares two
 * of six with it; sharing a third of the bigger one would have missed the first.
 */
export const sameExercises = (a, b) => {
  let both = 0
  for (const k of a) if (b.has(k)) both++
  return both >= 2 && both / Math.min(a.size, b.size) >= 0.5
}

const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const titleOf = (e) => words(e?.data?.plan?.title || e?.data?.name)

/** The exercises a workout is made of: its plan's, or what was lifted on it. */
function exercisesOf(e) {
  const keys = new Set()
  for (const b of e?.data?.plan?.blocks || []) for (const it of b?.items || []) if (it?.exercise) keys.add(it.exercise)
  if (!keys.size) for (const l of liftsDone(e)) if (liftKeyOf(l)) keys.add(liftKeyOf(l))
  return keys
}

/** Is `e` the same planned workout as `entry`? The same title, or mostly the same exercises. */
export function samePlanned(entry, e) {
  if (!e?.data?.plan) return false
  const t = titleOf(entry)
  if (t && t === titleOf(e)) return true
  return sameExercises(exercisesOf(entry), exercisesOf(e))
}

/**
 * Every time you DID this workout (`isDone`: not a plan still to come, not one
 * marked undone), newest first, the entry being shown left out. `entry` is that
 * entry; without it, it is looked up by `excludeId`, and a container's history
 * without an entry to compare is none, never a guess.
 */
export function priorSessions(entries, session, excludeId, entry = null) {
  const ids = priorIdsOf(session)
  if (!ids.length) return []
  const all = (entries || []).filter(e => e?.kind === 'daily' && e.id !== excludeId && isDone(e))
  const me = entry || (entries || []).find(e => e?.id === excludeId) || null
  let hits
  if (!session?.sched?.repeatVia) hits = all.filter(e => ids.includes(e.data?.optId))
  else if (me?.data?.plan) hits = all.filter(e => samePlanned(me, e))
  else {
    const activity = me?.data?.out?.activity
    hits = activity ? all.filter(e => ids.includes(e.data?.optId) && !e.data?.plan && e.data?.out?.activity === activity) : []
  }
  return hits.sort((a, b) => String(b.date).localeCompare(String(a.date)))
}
