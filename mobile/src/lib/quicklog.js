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

/** What an entry may hold and still be only the tap that placed it. */
const PLACED_KEYS = new Set(['activity', 'category'])

/**
 * A WAY BACK FROM ONE TAP (#94, A F3). A quick-log row, or a pick in Log a
 * workout, writes a done workout the moment it is tapped, and its sheet opens
 * on it. Closed with nothing added, that row counts for the streak, the habit
 * and the calendar, and the only way back was the bin and a confirm. So the
 * sheet of a workout placed this way says what was logged as it closes, with
 * Undo: `placedUndoText` is those words, or null when there is nothing to undo
 * because something was put on it (a number, a note, a plan, a run, a
 * measurement, a rename), which makes it a log someone meant.
 */
export function placedUndoText(entry, opt = null, field = null) {
  if (!entry || entry.deleted || entry.kind !== 'daily') return null
  const data = entry.data || {}
  if (data.plan || data.run) return null
  const out = data.out || {}
  if (Object.keys(out).some(k => !PLACED_KEYS.has(k) && out[k] !== undefined && out[k] !== null && out[k] !== '')) return null
  const name = activityOf(field, out.activity)?.name || data.name || opt?.name || null
  return name ? `Logged ${name}` : 'Logged'
}

/**
 * What an Undo offered by `placedUndoText` removes, decided when it is PRESSED,
 * from the entries as they are then (#101 review): the workout if it is still
 * only the tap that placed it, else null. The toast lasts six seconds and the
 * sheet can be reopened and written on in that time; an Undo that removed what
 * it saw at close would take a note typed since with it.
 */
export function placedToUndo(entries = [], id, opt = null, field = null) {
  const now = (entries || []).find(e => e && e.id === id) || null
  return now && placedUndoText(now, opt, field) ? now : null
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
