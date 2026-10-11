/*
 * What one workout is CALLED.
 *
 * Three things make up the design. A logged workout can be renamed; the rename
 * is mostly a TAP on a quick name, not typing; and the most common rename — a
 * bike ride marked "just miles" becoming a commute — happens by itself.
 *
 * THE NAME IS ON THE OUT, as `out.title`. Every reader of a session's name
 * already goes through `nameFor(opt, out)` (the day list, the log feed, the sheet
 * and fullscreen headers, the entry's own `data.name`, and therefore the Totem
 * habit note), so putting the override where that function can see it renames it
 * everywhere at once and survives the recomputation that follows any save. This
 * is the same trap `resolveMinutes` had to dodge: saving an output recomputes
 * `data.name`, so a rename stored anywhere BUT the out would be silently
 * overwritten by the next slider the user touched.
 *
 * A NAME THE APP WROTE IS LABELLED, as `out.titleFrom: 'casual'`. Same rule as a
 * WHOOP-filled field's `filled` map and `minutesSource`: a value the user did not type
 * must never be indistinguishable from one the user did, because that is what makes it
 * safe to take back. Unticking "just miles" removes the app's "Commute" and never
 * a name the user chose.
 *
 * THE VOCABULARY IS CONTENT — `quickNames` in plan.json, keyed by discipline,
 * echoing `plannerKinds` labels on purpose so a ride the user PLANNED as "Zone 2 ride"
 * and one the user renames afterwards read the same in the log.
 */

import { disciplineFor } from './activities.js'

/** Their own name for this workout, or null. Blank and whitespace are not names. */
export function titleOf(out) {
  const t = String(out?.title || '').trim()
  return t || null
}

/**
 * The chips: what fits this discipline, then what fits anything.
 *
 * Deduped and order-preserving, so a name that is on both lists ("Commute" is
 * discipline-specific for a bike and generic for nothing) appears once and in the
 * more specific position. No plan means no chips and a plain text box — the same
 * rule every other `usePlan()` consumer follows.
 */
export function quickNames(plan, opt, out) {
  const spec = plan?.quickNames || {}
  const byDiscipline = spec.byDiscipline?.[disciplineFor(opt, out)] || []
  const names = [...byDiscipline, ...(spec.any || [])]
    .map(n => String(n || '').trim())
    .filter(Boolean)
  return [...new Set(names)]
}

/**
 * The name a "just miles" entry gives itself, or null.
 *
 * Keyed by discipline and declared in content, because "Commute" is right for the
 * ride to work and wrong for the walk round the block — and a default that is
 * wrong is worse than none, since it reads as something the user asserted.
 */
export function casualName(plan, opt, out) {
  return plan?.quickNames?.casual?.[disciplineFor(opt, out)] || null
}

/**
 * The name a "warm-up" entry gives itself.
 *
 * Lets a one-off effort, such as a row done as a warm-up, be labelled as a
 * warm-up. Not keyed by discipline, unlike `casual`: a
 * warm-up is a warm-up whatever the rower, the bike or the treadmill recorded,
 * and there is no equivalent of "a walk is not a commute" to get wrong.
 */
export function warmupName(plan) {
  return plan?.quickNames?.warmup || null
}

/**
 * Rename it. Blank puts it back to whatever the card would have called it.
 *
 * Clears the provenance either way: once the user has typed in the box the name is their,
 * even if the user typed exactly what the app had suggested.
 */
export function rename(out, text) {
  const next = { ...out }
  delete next.titleFrom
  const name = String(text || '').trim()
  if (name) next.title = name
  else delete next.title
  return next
}

/**
 * Tick or untick "just miles", and the name that comes with it.
 *
 * Only ever fills a BLANK name, and only ever removes one it wrote itself.
 */
export function withCasualName(out, { plan, opt, on }) {
  const next = { ...out }
  if (on) {
    const name = casualName(plan, opt, out)
    if (name && !titleOf(out)) {
      next.title = name
      next.titleFrom = 'casual'
    }
    return next
  }
  if (next.titleFrom === 'casual') {
    delete next.title
    delete next.titleFrom
  }
  return next
}

/**
 * Name it "Warm-up", the same way and under the same rules.
 *
 * `titleFrom: 'warmup'` rather than `'casual'` so the two are told apart on the
 * entry — they mean different things even though they share a fate (neither
 * fills a quota, neither counts as training load), and a name the app wrote has
 * to be attributable to WHICH button wrote it before it is safe to take back.
 */
export function withWarmupName(out, { plan, on }) {
  const next = { ...out }
  if (on) {
    const name = warmupName(plan)
    if (name && !titleOf(out)) {
      next.title = name
      next.titleFrom = 'warmup'
    }
    return next
  }
  if (next.titleFrom === 'warmup') {
    delete next.title
    delete next.titleFrom
  }
  return next
}

/* ------------------------------------------------------- what the day calls it */

/**
 * What the day calls this session.
 *
 * Moved out of `tabs.jsx` on 2026-09-21 when it stopped being one line of
 * component glue: it is now the single reader of their rename, and everything that
 * shows a session's name goes through it.
 *
 * THEIR WORDS FIRST. Then the card's own indirection: most sessions are their own
 * name, and the free-form ones declare `nameFrom` and take it from what the user
 * picked, so a card called "Log a workout" shows up in their day, their history and
 * their Totem habit note as "Run" or "Bike".
 */
export function nameFor(opt, out) {
  const own = titleOf(out)
  if (own) return own
  const key = opt?.nameFrom
  if (!key) return opt?.name
  const picked = out?.[key]
  if (!picked) return opt?.name
  const field = (opt.outputs || []).find(f => f.key === key)
  // Two vocabularies can name a card. A `choice` field names itself out of its
  // own `options`; the activity catalog names itself out of `activities`, which
  // is a different list on the same field spec. Missing this is how a logged
  // mountain bike ride read back as "Log a workout" everywhere it appeared —
  // the day list, the history, and the Totem habit note.
  const label = field?.options?.find(o => o.value === picked)?.label
    || field?.activities?.find(a => a.key === picked)?.name
  return label || opt.name
}

/**
 * The same question where a PRESCRIPTION is in play, which is every header and
 * every `data.name` write.
 *
 * The order is the whole point: their rename beats the planner's title beats the
 * card. A planned session is titled by its plan — "Legs" must not become "Lift"
 * the first time the user touches the effort slider — but a title the user typed over it is
 * more recent than both.
 */
export const titleFor = (opt, out, pres = null) =>
  titleOf(out) || pres?.title || nameFor(opt, out) || opt?.name
