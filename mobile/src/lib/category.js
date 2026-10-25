/*
 * What kind of workout a logged entry was: its category (lift, run, bike, the
 * climbing cards' own…) and its discipline.
 *
 * These used to live in quota.js, because the weekly quotas were what first
 * needed them. The quotas are gone; the Log filter and the Progress page still
 * ask the same question, so the two readers stayed and the rest went.
 */

import { optFor } from './menu.js'
import { loggedActivity, disciplineFor } from './activities.js'

/**
 * The category a logged entry belongs to, or null.
 *
 * Two ways a session names its category, and the indirection is the point. The
 * climbing cards declare it outright (`category: "pe"`) because a board session is
 * power-endurance whoever logs it. *Log a workout* declares `categoryFrom:
 * "activity"` and defers to the catalog, because the card is ninety-one sports
 * wearing one form.
 *
 * A per-entry `out.category` beats both: a planned block names its own category,
 * and a dance class that is genuinely the cardio can say so without the catalog
 * being edited for everyone.
 */
export function categoryOf(entry, menu = []) {
  const out = entry?.data?.out || {}
  if (out.category) return out.category
  const opt = optFor(menu, entry?.data?.optId)
  if (!opt) return null
  if (opt.categoryFrom === 'activity') return loggedActivity(opt, out)?.category || null
  return opt.category || null
}

/** The sport family an entry belongs to (bike, run, bouldering…), or null. */
export function disciplineOf(entry, menu = []) {
  const opt = optFor(menu, entry?.data?.optId)
  return opt ? disciplineFor(opt, entry?.data?.out || {}) : null
}
