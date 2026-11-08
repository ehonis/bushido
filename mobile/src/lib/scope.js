/*
 * What you are looking at on the Progress page.
 *
 * Rebuilt 2026-09-15, because the old one had about twenty charts and all of them
 * were on screen at once: peak force, critical force, impulse above end-test
 * force, board repeated ascents, repeaters-to-failure, ARC lengths, straddle
 * reach, elbow soreness. Every one of them was a real number and the page was
 * still unreadable — and nineteen of the twenty were climbing, on an app that now
 * also does three endurance sports, and most charts were too specific to be
 * useful on their own.
 *
 * A SCOPE is the filter, and it is deliberately a plain object rather than a
 * component's state, so the whole thing can be tested as arithmetic:
 *
 *   { activity, category, session, exercise, band, weeks }
 *
 * Every field is independent and every one is optional. Absent means "don't
 * narrow on this" rather than a default, so an empty scope is honestly "all of
 * it" rather than a hidden preference.
 *
 * The three narrowings nest naturally without
 * being a hierarchy: a CATEGORY holds sessions, a SESSION is one card, and an EXERCISE is one movement inside a lift. Picking a session
 * does not require picking its category first, because "show me just my mountain
 * biking" should be one tap and not three.
 *
 * WHAT COMES BACK is the entries, plus a description of what is IN them — the
 * disciplines, categories and sessions actually present. That is what decides
 * which charts exist (see metrics.js): the page does not ask "is this the
 * climbing filter", it asks "does this selection contain any climbing", which is
 * the same question for a named filter and for the unfiltered default.
 */

import { isDone } from './store.js'
import { optFor } from './menu.js'
import { categoryOf, disciplineOf } from './category.js'
import { mondayOf, weekDays, shiftWeek } from './dates.js'
import { loggedActivity } from './activities.js'
import { liftsDone, liftKeyOf } from './lifts.js'
import { bandsOf, bandLabel } from './grades.js'

export const EMPTY_SCOPE = { activity: null, category: null, session: null, exercise: null, band: null, weeks: 8 }

/* ---------------------------------------------------- the activity, first */

/*
 * THE FIRST QUESTION is what kind of thing it was: climbing, a lift, a run, a
 * ride, a swim, or something else (docs/DESIGN.md, the G-visual-ia contract,
 * #81). The plan's categories (Power, Fingers, Fun, Endurance…) are the SECOND
 * question, asked inside one of these: on its own "Endurance" does not say
 * whether it means running or climbing, and a row mixing Bike with Fingers mixes
 * a sport with a training intent. Log and Progress both read this one list, so
 * the two screens ask the same first question in the same words.
 *
 * Derived from the entry's discipline (lib/category.js), never stored, and the
 * fallback is Other, so a card or an activity nothing maps is still reachable.
 */
export const ACTIVITY_SCOPES = [
  { key: 'climbing', name: 'Climbing', icon: 'Mountain' },
  { key: 'lift', name: 'Lift', icon: 'Dumbbell' },
  { key: 'run', name: 'Run', icon: 'Footprints' },
  { key: 'bike', name: 'Bike', icon: 'Bike' },
  { key: 'swim', name: 'Swim', icon: 'Waves' },
  { key: 'other', name: 'Other', icon: 'Sparkles' },
]
const CLIMBING = new Set(['climbing', 'bouldering', 'rock-climbing'])
const SPORTS = new Set(['lift', 'run', 'bike', 'swim'])

/**
 * Which first-level activity an entry is: its discipline, else (a planned
 * workout that names only a category) the discipline its category declares.
 */
export function activityScopeOf(entry, plan) {
  const menu = plan?.dailyMenu || []
  let d = disciplineOf(entry, menu)
  if (!d) {
    const cat = categoryOf(entry, menu)
    d = (plan?.quotaCategories || []).find(c => c.key === cat)?.discipline || null
  }
  if (CLIMBING.has(d)) return 'climbing'
  return SPORTS.has(d) ? d : 'other'
}

/** "Climbing", "Lift"… for a first-level key. */
export const activityName = (key) => ACTIVITY_SCOPES.find(a => a.key === key)?.name || key

/** Which lift exercises this entry recorded: logged, or done on its plan (`liftsDone`, D11). */
function exercisesIn(entry) {
  return liftsDone(entry).map(liftKeyOf).filter(Boolean)
}

/**
 * The entries in scope, and what they turn out to contain.
 *
 * Rest days are excluded from the SET but their dates are kept: "I deliberately
 * rested" is a fact the load chart needs — a week of five sessions and two rests
 * is a different week from five sessions and two unexplained gaps — while a rest
 * day has no distance, no grade and no exercises and would drag every average it
 * touched toward zero.
 */
export function resolveScope({ plan, entries = [], scope = EMPTY_SCOPE, today = null }) {
  const menu = plan?.dailyMenu || []

  // The window, as whole weeks back from this one, so the bars line up with the
  // calendar rather than cutting a week in half.
  let from = null
  if (scope.weeks) {
    const monday = mondayOf(today || new Date().toISOString().slice(0, 10))
    from = shiftWeek(monday, -(scope.weeks - 1))
  }

  const all = entries.filter(e =>
    e?.kind === 'daily' && !e.deleted && e.date && isDone(e) &&
    (!from || e.date >= from))

  const rests = []
  const hits = []

  for (const e of all) {
    const opt = optFor(menu, e.data?.optId)
    const level = Number(e.data?.level) || 0
    if (level === 0 || opt?.role === 'rest') { rests.push(e); continue }

    if (scope.activity && activityScopeOf(e, plan) !== scope.activity) continue

    const cat = categoryOf(e, menu)
    if (scope.category && cat !== scope.category) continue

    // A session filter matches the CARD for a climbing session, and the ACTIVITY
    // for a logged workout — because "mountain bike" is a thing the user did, and the
    // card it was logged on is an implementation detail the user should never have to
    // know about to filter by it.
    if (scope.session) {
      const act = opt ? loggedActivity(opt, e.data?.out) : null
      if (opt?.id !== scope.session && act?.key !== scope.session) continue
    }

    if (scope.exercise && !exercisesIn(e).includes(scope.exercise)) continue

    // A grade band ("V4", "5.10"): the sessions that touched it, sent or not.
    if (scope.band && !(opt && bandsOf(opt, e.data?.out).includes(scope.band))) continue

    hits.push(e)
  }

  const disciplines = new Set()
  const categories = new Set()
  const sessions = new Set()
  const activities = new Set()
  for (const e of hits) {
    const opt = optFor(menu, e.data?.optId)
    const d = disciplineOf(e, menu); if (d) disciplines.add(d)
    const c = categoryOf(e, menu); if (c) categories.add(c)
    if (opt?.id) sessions.add(opt.id)
    const act = opt ? loggedActivity(opt, e.data?.out) : null
    if (act?.key) activities.add(act.key)
  }

  return {
    scope,
    from,
    entries: hits,
    rests,
    disciplines, categories, sessions, activities,
    exercise: scope.exercise || null,
    isEmpty: hits.length === 0,
  }
}

/* ------------------------------------------------------- what can be picked */

/**
 * The filter options, built from what the user has ACTUALLY LOGGED.
 *
 * Not from the plan's full vocabulary. A dropdown offering eleven categories when
 * the user has logged five, or ninety-one activities when the user has done seven, is a
 * dropdown that mostly returns empty charts — and a control that usually shows
 * nothing teaches you not to touch it. The counts ride along so each option can
 * say how much is behind it.
 */
export function scopeOptions({ plan, entries = [], today = null, weeks = null, activity = null }) {
  const menu = plan?.dailyMenu || []
  const base = resolveScope({ plan, entries, scope: { ...EMPTY_SCOPE, weeks }, today })

  const count = (map, key) => { if (key) map.set(key, (map.get(key) || 0) + 1) }
  const acts = new Map(); const cats = new Map(); const sess = new Map(); const exs = new Map(); const bands = new Map()

  for (const e of base.entries) {
    const opt = optFor(menu, e.data?.optId)
    const act = activityScopeOf(e, plan)
    count(acts, act)
    // The second level is the categories INSIDE the activity picked, so "Fun"
    // and "Fingers" are offered under Climbing and not beside Bike.
    if (!activity || act === activity) count(cats, categoryOf(e, menu))
    if (act === 'climbing' && opt) for (const b of bandsOf(opt, e.data?.out)) count(bands, b)
    const logged = opt ? loggedActivity(opt, e.data?.out) : null
    // One list, because the user does not think of them as two: the thing the user picks is
    // "mountain bike" or "max hangs", and which of those is a card and which is a
    // catalog activity is the app's problem.
    count(sess, logged?.key || opt?.id)
    for (const x of exercisesIn(e)) count(exs, x)
  }

  const catDefs = plan?.quotaCategories || []
  const liftField = (menu.find(m => m.categoryFrom === 'activity')?.outputs || [])
    .find(o => o.type === 'lifts')
  const actField = (menu.find(m => m.categoryFrom === 'activity')?.outputs || [])
    .find(o => o.type === 'activity')

  const nameOf = (key) =>
    (actField?.activities || []).find(a => a.key === key)?.name
    || menu.find(m => m.id === key)?.name
    || key

  const byCount = (a, b) => b.n - a.n || String(a.label).localeCompare(String(b.label))

  // Bands read easiest first, boulders before routes: a grade list is a ladder,
  // and a ladder sorted by how often each rung was touched is not one.
  const bandSort = (a, b) => a.scale.localeCompare(b.scale) || a.band - b.band
  return {
    activities: ACTIVITY_SCOPES
      .filter(a => acts.has(a.key))
      .map(a => ({ value: a.key, n: acts.get(a.key), label: a.name, icon: a.icon })),

    bands: [...bands.entries()]
      .map(([k, n]) => {
        const [scale, b] = k.split(':')
        return { value: k, n, scale, band: Number(b), label: bandLabel(scale, Number(b)) }
      })
      .sort(bandSort),

    categories: [...cats.entries()]
      .map(([k, n]) => ({
        value: k, n,
        label: catDefs.find(c => c.key === k)?.name || k,
        icon: catDefs.find(c => c.key === k)?.icon,
      }))
      .sort(byCount),

    sessions: [...sess.entries()]
      .map(([k, n]) => ({ value: k, n, label: nameOf(k) }))
      .sort(byCount),

    exercises: [...exs.entries()]
      .map(([k, n]) => ({
        value: k, n,
        label: (liftField?.exercises || []).find(x => x.key === k)?.name || k,
      }))
      .sort(byCount),
  }
}

/** "Bike · last 8 weeks" — what the page is currently showing, in words. */
export function describeScope({ plan, scope, options }) {
  const bits = []
  const find = (list, v) => (list || []).find(o => o.value === v)?.label
  if (scope.activity) bits.push(find(options?.activities, scope.activity) || activityName(scope.activity))
  if (scope.category) bits.push(find(options?.categories, scope.category) || scope.category)
  if (scope.session) bits.push(find(options?.sessions, scope.session) || scope.session)
  if (scope.exercise) bits.push(find(options?.exercises, scope.exercise) || scope.exercise)
  if (scope.band) bits.push(find(options?.bands, scope.band) || scope.band)
  const what = bits.length ? bits.join(' · ') : 'Everything'
  const when = scope.weeks ? `last ${scope.weeks} weeks` : 'all time'
  return `${what} · ${when}`
}

/* --------------------------------------------------------------- the weeks */

/** Every Monday in the scope's window, oldest first — the x-axis for the bars. */
export function weeksIn(resolved, today = null) {
  const dates = [...resolved.entries, ...resolved.rests].map(e => e.date).sort()
  const last = mondayOf(today || dates.at(-1) || new Date().toISOString().slice(0, 10))
  const first = resolved.from || mondayOf(dates[0] || last)
  const out = []
  for (let m = first; m <= last; m = shiftWeek(m, 1)) out.push(m)
  return out
}

export { weekDays }
