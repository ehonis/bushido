/*
 * Finding the session an entry was logged against.
 *
 * `menu.find(m => m.id === entry.data.optId)` is what this was, in a dozen
 * places, and it was right until a card got renamed. The 2026-09-14 pivot renamed
 * *Other training* to *Log a workout*, and fifteen entries — nine rides, two
 * runs, two lifts — instantly resolved to NOTHING. They did not break loudly:
 * they quietly stopped having a category, so they vanished from the Log feed's
 * filters, stopped counting toward a bike quota, and could not be attributed to a
 * bike on the gear page. A quarter of their history, silently outside the app.
 *
 * So a session may declare the ids it used to have, and every lookup that starts
 * from an ENTRY goes through here. Lookups that start from the PLAN — a `mutex`
 * list, a `stacksWith`, a coach suggestion — do not: those ids are written by the
 * same file that defines them, and cannot be stale.
 *
 * `aka` is content, so the next rename is an edit rather than a migration. It is
 * deliberately NOT a rewrite of the stored entries: an entry records what the user
 * logged at the time, and editing history to match a new vocabulary is how a log
 * stops being evidence of anything.
 */

/** The session an entry was logged against, following renames. */
export function optFor(menu, optId) {
  if (!optId) return null
  const live = (menu || []).find(m => m.id === optId)
  if (live) return live
  return (menu || []).find(m => Array.isArray(m.aka) && m.aka.includes(optId)) || null
}

/** Every id that resolves to this session, its own first. */
export const idsOf = (opt) => [opt?.id, ...(opt?.aka || [])].filter(Boolean)
