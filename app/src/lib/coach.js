/*
 * The coach note — the reading half.
 *
 * When the user checks in, the server runs one Claude turn against their week (see
 * `server/chat.js`) and folds what it says into ONE document per day,
 * `data/coach.json`. This file is the only thing that decides what that document
 * is allowed to do to the app. It is pure, and it is deliberately small.
 *
 * The shape of a coach note:
 *
 *   {
 *     version:     1,
 *     date:        "2026-08-10",              the day it is advice FOR
 *     generatedAt: "2026-08-10T11:02:03.000Z",
 *     model:       "claude-sonnet-5",
 *     headline:    "one sentence, the thing to actually know",
 *     read:        ["what I see in your data", ...],
 *     nudges:      [{ optId, points, why }],  weight added to the recommendation
 *     flags:       [{ tone: 'info'|'warn', text }],
 *     changed:     [{ optId?, what, why, where? }]   plan edits, if any
 *   }
 *
 * `changed` is the audit trail for edits to `content/plan.json`, and nothing
 * writes it any more: the coach that could edit the plan ran headless from a
 * timer and is gone, and the check-in explicitly refuses to invent an entry (see
 * `mergeNote` in server/chat.js). The reader stays because the field is still
 * validated and still rendered, so a note that has one is displayed honestly
 * rather than dropped — but on today's paths it is always empty.
 *
 * Three rules, and they are the whole design:
 *
 * 1. ADVICE IS DATED. A note written for Monday must never quietly steer
 *    Tuesday. `coachFor` returns null for any other day, so a coach that fails
 *    to run leaves the app exactly as it was rather than acting on stale
 *    reasoning. Silence is a safe failure; yesterday's advice is not.
 *
 * 2. NUDGES ARE CAPPED AND EXPLAINED. A nudge is one more weighted term in the
 *    same engine as everything else, with the same "every term carries the
 *    sentence that justifies it" rule. `recommender.coachCap` bounds it, so an
 *    LLM that returns 9000 points moves the recommendation by at most one term's
 *    worth. It is advice with a thumb on the scale, not an override.
 *
 * 3. IT CANNOT LIFT A SAFETY RULE. Nudges are read in `scoreSession` AFTER the
 *    hard blocks have already returned. No coach note can put two hard finger
 *    days back to back or breach the weekly cap, because by the time its points
 *    are read those sessions are already out of the running. This is enforced by
 *    where the code sits, not by asking the model nicely, and it is pinned in
 *    app/coach.test.js.
 *
 * `changed` is the audit trail. Anything the coach edited in plan.json shows up
 * in the app with a "Coach changed" label against the session it touched — a
 * plan that quietly rewrites itself overnight is worse than no coach at all.
 */

export const COACH_VERSION = 1

/** Fallback cap, so a plan.json with no `recommender` block still bounds this. */
const DEFAULT_CAP = 18

const isIso = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

/**
 * The coach note for one day, or null.
 *
 * Anything malformed comes back null rather than half-applied: the app has to be
 * usable in a basement when the coach has never run, has crashed, or has
 * returned something that is not a coach note at all.
 */
export function coachFor(coach, iso) {
  if (!coach || typeof coach !== 'object') return null
  if (Number(coach.version) !== COACH_VERSION) return null
  if (!isIso(coach.date) || coach.date !== iso) return null
  return coach
}

/** Nudges as a map, validated and clamped. Junk entries are dropped silently. */
export function nudges(coach, iso, cap = DEFAULT_CAP) {
  const doc = coachFor(coach, iso)
  const out = new Map()
  const limit = Number.isFinite(Number(cap)) ? Math.abs(Number(cap)) : DEFAULT_CAP
  for (const n of doc?.nudges || []) {
    const id = str(n?.optId, 64)
    const why = str(n?.why, 240)
    const points = Number(n?.points)
    if (!id || !why || !Number.isFinite(points) || points === 0) continue
    if (out.has(id)) continue // first nudge for a session wins; no stacking
    out.set(id, { points: Math.max(-limit, Math.min(limit, Math.round(points))), why })
  }
  return out
}

/**
 * What the coach changed in the plan, for one session.
 *
 * This is what draws the "Coach changed" label. It is not filtered by date —
 * an edit made on Monday is still an edit on Wednesday, and the label has to
 * survive as long as the change does.
 */
export function changesFor(coach, optId) {
  if (!coach || !optId) return []
  return (coach.changed || [])
    .filter(c => c && c.optId === optId && str(c.what, 400))
    .map(c => ({
      what: str(c.what, 400),
      why: str(c.why, 400) || '',
      where: str(c.where, 200) || '',
      date: isIso(c.date) ? c.date : (isIso(coach.date) ? coach.date : null),
    }))
}

/** Everything the coach changed, whatever it named. Drives the summary card. */
export function allChanges(coach) {
  if (!coach) return []
  return (coach.changed || [])
    .filter(c => c && str(c.what, 400))
    .map(c => ({
      optId: str(c.optId, 64),
      what: str(c.what, 400),
      why: str(c.why, 400) || '',
      where: str(c.where, 200) || '',
      date: isIso(c.date) ? c.date : (isIso(coach.date) ? coach.date : null),
    }))
}

/** Flags, cleaned. `warn` is the only tone that renders differently. */
export function flags(coach, iso) {
  const doc = coachFor(coach, iso)
  return (doc?.flags || [])
    .map(f => ({ tone: f?.tone === 'warn' ? 'warn' : 'info', text: str(f?.text, 400) }))
    .filter(f => f.text)
}

/** The narrative half: one headline and the observations behind it. */
export function reading(coach, iso) {
  const doc = coachFor(coach, iso)
  if (!doc) return null
  const headline = str(doc.headline, 300)
  const read = (doc.read || []).map(r => str(r, 400)).filter(Boolean).slice(0, 6)
  if (!headline && !read.length) return null
  return { headline, read, generatedAt: str(doc.generatedAt, 40), model: str(doc.model, 60) }
}

/**
 * Is there anything to show at all?
 *
 * A coach that ran and found nothing worth saying should render nothing. An
 * empty card every day trains you to stop reading the card.
 */
export function hasAdvice(coach, iso) {
  return Boolean(reading(coach, iso)) || nudges(coach, iso).size > 0 ||
    flags(coach, iso).length > 0 || allChanges(coach).length > 0
}
