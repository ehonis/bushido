/*
 * Quotas — what the week asks for, instead of what each weekday is.
 *
 * This replaced the week template: instead of pre-planned days, a quota is the
 * set of workouts planned for the week without pinning any of them to a day.
 *
 * The template's failure was structural, not cosmetic. It named ONE session per
 * weekday per branch, so Thursday WAS the board day — and a Thursday the user could not
 * make cost the board session rather than moving it. `templateDebt` existed to
 * paper over that and only ever half-worked, because a missed Thursday is not a
 * debt, it is a Thursday. A quota says how many of each kind of workout the week
 * wants and stays silent about which day each lands on.
 *
 * FOUR DECISIONS WORTH NOT UNDOING.
 *
 * **A quota counts WORKOUTS, not days**, because some days hold more than one
 * workout. A day holding a ride and a lift
 * fills two quotas. This is why the existing `companions()` machinery matters more
 * under quotas rather than less — see recommender.stackWhy.
 *
 * **The week is Monday to Sunday and misses EXPIRE.** Nothing carries as debt. A
 * week that went badly should not make the next one look worse than it is, and the
 * template's debt weight is exactly the mechanic being removed. What the user missed is
 * still in the log; it just stops nagging on Monday.
 *
 * **The user writes them; the app only offers.** `suggest()` copies last week forward,
 * because a steady week should be zero typing. It never writes — a quota that
 * appeared without being asked for is a schedule again, wearing a different hat.
 *
 * **A quota set is an ENTRY, not a setting.** Same store, same per-id
 * last-write-wins merge, same offline outbox as everything else, so editing next
 * week's quotas on a phone with no signal behaves like logging a set does. Keyed
 * `quota-<monday>`, dated to the Monday.
 */

import { fromIso, localIso } from './dates.js'
import { optFor } from './menu.js'
import { isDone, isTraining } from './store.js'
import { loggedActivity, disciplineFor } from './activities.js'

/* ------------------------------------------------------------------ the week */

/** The Monday of the week containing `iso`. Weeks start Monday, not Sunday. */
export function mondayOf(iso) {
  const d = fromIso(iso)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return localIso(d)
}

/** The seven dates of that week, Monday first. */
export function weekDays(mondayIso) {
  const d = fromIso(mondayIso)
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d)
    x.setDate(d.getDate() + i)
    return localIso(x)
  })
}

export const quotaId = (mondayIso) => `quota-${mondayIso}`

/** The Monday `n` weeks AFTER this one; negative walks back (-1 is last week). */
export function shiftWeek(mondayIso, n) {
  const d = fromIso(mondayIso)
  d.setDate(d.getDate() + n * 7)
  return localIso(d)
}

/* -------------------------------------------------------------- the entries */

export function quotaEntry(entries = [], mondayIso) {
  const id = quotaId(mondayIso)
  return entries.find(e => e?.id === id && !e.deleted) || null
}

/** `{ category: count }` for a week — `{}` when the user has not set any. */
export function quotaCounts(entries = [], mondayIso) {
  const counts = quotaEntry(entries, mondayIso)?.data?.counts
  if (!counts || typeof counts !== 'object') return {}
  const out = {}
  for (const [k, v] of Object.entries(counts)) {
    const n = Number(v)
    if (Number.isFinite(n) && n > 0) out[k] = Math.round(n)
  }
  return out
}

/**
 * The shape to hand `upsertEntry`.
 *
 * `extra` is the week's provenance when it was planned with the AI — `thread`,
 * `why`, `title`, `model` — kept beside the counts for the same reason a
 * prescription keeps its conversation on the entry: a week the user cannot see the
 * reasoning for is a week the user confirms without reading. Nothing reads it but the
 * Week tab's note; `quotaCounts` still reads `counts` and only `counts`.
 */
export const buildQuotaEntry = (mondayIso, counts, extra = {}) => ({
  id: quotaId(mondayIso),
  kind: 'quota',
  date: mondayIso,
  data: { ...extra, counts },
})

/* ------------------------------------------- which quota a workout filled in */

/**
 * The quota category a logged entry counts toward, or null.
 *
 * Two ways a session names its category, and the indirection is the point. The
 * climbing cards declare it outright (`category: "pe"`) because a board session is
 * power-endurance whoever logs it. *Log a workout* declares `categoryFrom:
 * "activity"` and defers to the catalog, because the card is ninety-one sports
 * wearing one form.
 *
 * A per-entry `out.category` beats both. That is their override — "you can point any
 * activity at any category" — so a week where dance is genuinely the cardio can say
 * so without the catalog being edited for everyone, forever.
 */
export function categoryOf(entry, menu = []) {
  const out = entry?.data?.out || {}
  if (out.category) return out.category
  const opt = optFor(menu, entry?.data?.optId)
  if (!opt) return null
  if (opt.categoryFrom === 'activity') return loggedActivity(opt, out)?.category || null
  return opt.category || null
}

/**
 * EVERY quota category one entry fills. Usually one; a planned gym trip is not.
 *
 * Each workout within a session counts toward its own quota, not the session as
 * a whole: a run and a lift on one entry fill the run quota and the lift quota.
 *
 * This corrects the first multi-select design, which was "one entry, one
 * category, you pick which" rather than splitting a gym trip into three entries —
 * in use, a session which genuinely is a lift AND a run moved only one bar. The quota rule was always that a
 * quota counts WORKOUTS and not days, and a run followed by a lift is two workouts
 * whether they are on one entry or two.
 *
 * So the BLOCK carries the category on a planned session, and this returns the
 * distinct set. One entry still, one thing to run still, but the week sees what it
 * actually covered. Everything without a plan behaves exactly as before — one
 * category, wrapped in an array, and `categoryOf` is untouched for every reader
 * that genuinely wants a single answer (spacing, the recommender, the log filter).
 */
export function categoriesOf(entry, menu = []) {
  const blocks = entry?.data?.plan?.blocks
  if (Array.isArray(blocks)) {
    const named = [...new Set(blocks.map(b => b?.category).filter(Boolean))]
    if (named.length) return named
  }
  const one = categoryOf(entry, menu)
  return one ? [one] : []
}

/** Same question for spacing: what this entry spaces against. See recommend.js. */
export function disciplineOf(entry, menu = []) {
  const opt = optFor(menu, entry?.data?.optId)
  return opt ? disciplineFor(opt, entry?.data?.out || {}) : null
}

/** The category a MENU OPTION would fill if logged now — for scoring, pre-log. */
export function categoryOfOption(opt) {
  // A card whose category comes from an activity the user has not picked yet has no
  // category to score. It is also never recommended, so this never costs a rank.
  return opt?.categoryFrom === 'activity' ? null : (opt?.category || null)
}

export const disciplineOfOption = (opt) =>
  opt?.disciplineFrom === 'activity' ? null : (opt?.discipline || null)

/* ----------------------------------------------------------------- progress */

/*
 * The week's workouts — and a commute is not one.
 *
 * `training: false` ("just miles") started out counting here, and was reversed
 * after use: an entry marked "just miles" must not fill a quota, or every commute
 * is counted as a workout. A quota is a count of TRAINING the user meant to do; a ride to work
 * filling one is the week reporting a session the user never trained, which is the same
 * failure the load chart already refused for the same reason.
 *
 * So the axis widened by exactly one reader: a non-training activity still counts
 * toward gear mileage, the daily streak, the Totem habit and the Progress page's
 * miles, and is now out of the quota as well as the training load. Nothing else
 * changed, and `isDone` is still the only test the streak makes.
 */
const weekDaily = (entries, days) => {
  const set = new Set(days)
  return entries.filter(e =>
    e?.kind === 'daily' && !e.deleted && set.has(e.date) &&
    Number(e?.data?.level) > 0 &&  // a logged rest day is not a workout
    isTraining(e))                 // nor is a commute
}

const doneDaily = (entries, days) => weekDaily(entries, days).filter(isDone)

/*
 * On the week, not done yet.
 *
 * A session the user has PUT on a day and not finished — the planner's output sitting
 * on tonight, a card the user added this morning. It is not progress and it must never
 * be counted as any, but it is not nothing either: "1 of 2, and the second one is
 * already written down" is a different week from "1 of 2, and I have not thought
 * about it". On the bars it is a dotted continuation of the fill, showing that it
 * is planned, just not done.
 *
 * Deliberately spans the WHOLE week rather than today onward. A session planned
 * for Saturday is planned; a session planned for Tuesday and never done is the
 * honest thing for the bar to keep showing, because it is still on the log as
 * something the user said the user would do.
 */
const pendingDaily = (entries, days) => weekDaily(entries, days).filter(e => !isDone(e))

/**
 * Where the week stands, per category.
 *
 * Returns EVERY category the plan declares, not only the ones with a quota, so the
 * board can show "3 rides, none asked for" without special-casing. `planned: 0`
 * with `done: 2` is a real and uninteresting state — the user rode twice in a week that
 * did not ask them to, which is allowed and always was.
 */
export function progress({ plan, entries = [], iso }) {
  const monday = mondayOf(iso)
  const days = weekDays(monday)
  const menu = plan?.dailyMenu || []
  const counts = quotaCounts(entries, monday)
  const logged = doneDaily(entries, days)
  const waiting = pendingDaily(entries, days)

  /*
   * One entry can land in more than one bucket — see `categoriesOf`. It is still
   * ONE workout per category, not one per block: a session with two lift blocks
   * and a run block fills one lift and one run, which is what the distinct set
   * gives us for free.
   */
  const byCategory = (list) => {
    const out = {}
    for (const e of list) {
      for (const c of categoriesOf(e, menu)) {
        ;(out[c] = out[c] || []).push(e)
      }
    }
    return out
  }
  const filled = byCategory(logged)
  const queued = byCategory(waiting)

  const cats = (plan?.quotaCategories || []).map(c => {
    const planned = counts[c.key] || 0
    const did = filled[c.key] || []
    const soon = queued[c.key] || []
    const remaining = Math.max(0, planned - did.length)
    return {
      ...c,
      planned,
      done: did.length,
      remaining,
      over: Math.max(0, did.length - planned),
      // On a day and not done. Never counted as progress — `doneTotal` and
      // `owed` below are untouched by it — only shown.
      pending: soon.length,
      // What the dotted segment is allowed to claim: the part of what is still
      // owed that the user has already written down. A fourth planned ride against a
      // quota of three is real and is worth nothing to a bar that only goes to
      // three, so it is clamped rather than overflowing the track.
      pendingShown: Math.min(soon.length, remaining),
      entries: did,
      pendingEntries: soon,
      complete: planned > 0 && did.length >= planned,
    }
  })

  const asked = cats.filter(c => c.planned > 0)
  return {
    monday,
    days,
    categories: cats,
    byKey: Object.fromEntries(cats.map(c => [c.key, c])),
    asked,
    owed: asked.filter(c => c.remaining > 0),
    plannedTotal: asked.reduce((a, c) => a + c.planned, 0),
    doneTotal: asked.reduce((a, c) => a + Math.min(c.done, c.planned), 0),
    // Written down against something the week asked for, and not done. The bars
    // draw this; nothing counts it as progress.
    pendingTotal: asked.reduce((a, c) => a + c.pendingShown, 0),
    isSet: asked.length > 0,
  }
}

/* --------------------------------------------------------------- suggesting */

/**
 * What to pre-fill a fresh week's quotas with.
 *
 * Last week's quotas, because a steady week should cost no typing. Failing that, what the user ACTUALLY DID last week — which is a
 * better opening bid than any default the plan could hold, since it is measured
 * rather than aspirational. Failing both, nothing: an empty board that says "set
 * your first week" is more honest than a week invented for them.
 *
 * `source` rides along so the Week tab can say where the numbers came from. A
 * pre-filled number whose provenance is invisible is a number that gets confirmed
 * without being read — the same trap the workout-mode prescription fill has.
 */
export function suggest({ plan, entries = [], iso }) {
  const monday = mondayOf(iso)
  const last = shiftWeek(monday, -1)

  const prior = quotaCounts(entries, last)
  if (Object.keys(prior).length) return { counts: prior, source: 'last-week', from: last }

  const menu = plan?.dailyMenu || []
  const did = {}
  for (const e of doneDaily(entries, weekDays(last))) {
    const c = categoryOf(e, menu)
    if (c) did[c] = (did[c] || 0) + 1
  }
  if (Object.keys(did).length) return { counts: did, source: 'did-last-week', from: last }

  return { counts: {}, source: 'empty', from: null }
}

/**
 * Has this week been set up at all?
 *
 * Distinct from "is it empty" — a week the user deliberately set to zero everything is
 * set up, and should not be nagged at. The entry existing is the answer.
 */
export const weekIsSet = (entries, iso) => Boolean(quotaEntry(entries, mondayOf(iso)))
