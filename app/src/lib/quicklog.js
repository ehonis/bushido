/*
 * Logging in two taps (docs/DESIGN.md, "Logging in two taps").
 *
 * The common case is "I did a run, write it down", and it used to be + → Log a
 * workout → find Run → the form → close. The quick-log rows make it + → Run: the
 * activities of the last few distinct workouts logged, newest first, each one tap
 * that puts that workout on the day and opens its sheet.
 *
 * Pure, so the + menu, Today's empty day, Log a workout's Recent group and the
 * iPhone app all read the same list (mobile/src/lib/quicklog.js is this file,
 * byte for byte).
 */

import { localIso } from './dates.js'
import { catalogOf, activityOf, pinnedActivities } from './activities.js'
import { placeEntries } from './trainer.js'

/** The card a quick log places: the free-form workout card, with the activity answered. */
export const QUICK_CARD = 'log-workout'

/** How many rows. Three fits under Log a workout without pushing the other doors off a phone. */
export const QUICK_MAX = 3

/**
 * Up to `max` catalog activities: the ones on the newest logged workouts first,
 * each once, then the catalog's pinned sports to fill the rest, so a fresh
 * install offers its pins and a log with one run in it offers Run and then the
 * pins. Never a future day (a plan for tomorrow is not something you did), never
 * a deleted entry, and never an activity the catalog no longer knows: the row
 * would place a card that cannot say what it is.
 *
 * Climbing cards have no catalog activity, so they never appear: a climb goes
 * through Log a workout → Climbing, where the hard-finger question is asked
 * (AGENTS.md §6.1).
 */
export function recentActivities(entries = [], field = null, { max = QUICK_MAX, today = localIso() } = {}) {
  if (!catalogOf(field).activities.length) return []
  const logged = (entries || [])
    .filter(e => e && e.kind === 'daily' && !e.deleted && e.date && e.date <= today && e.data?.out?.activity)
    .sort((a, b) => (b.date === a.date
      ? String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
      : b.date.localeCompare(a.date)))
  const out = []
  const seen = new Set()
  const take = (a) => {
    if (!a || seen.has(a.key) || out.length >= max) return
    seen.add(a.key)
    out.push(a)
  }
  for (const e of logged) take(activityOf(field, e.data.out.activity))
  for (const a of pinnedActivities(field)) take(a)
  return out
}

/**
 * The entry one quick-log tap writes: the workout card on `date` with the
 * activity answered, minted by `placeEntries` against that day, exactly as Log a
 * workout's own pick would (same id, same done-by-default, AGENTS.md §4). A
 * future date lands on today instead: you cannot have done tomorrow's workout.
 * Null when the plan has no workout card.
 */
export function quickEntry({ menu = [], entries = [], activity, date = null, today = localIso() }) {
  const day = date && date <= today ? date : today
  const [entry] = placeEntries({
    menu, onDay: entries, date: day, today,
    items: [{ optId: QUICK_CARD, data: { out: { activity } } }],
  })
  return entry || null
}
