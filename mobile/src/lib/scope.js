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
 *   { achievement, category, session, exercise, weeks }
 *
 * Every field is independent and every one is optional. Absent means "don't
 * narrow on this" rather than a default, so an empty scope is honestly "all of
 * it" rather than a hidden preference.
 *
 * The four narrowings nest naturally without
 * being a hierarchy: an ACHIEVEMENT owns categories, a CATEGORY holds sessions, a
 * SESSION is one card, and an EXERCISE is one movement inside a lift. Picking a session
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
import { categoryOf, disciplineOf, mondayOf, weekDays, shiftWeek } from './quota.js'
import { loggedActivity } from './activities.js'
import { liftsIn } from './lifts.js'
import { achievements as mergeAchievements, achievementOf, categorySet } from './achievements.js'

export const EMPTY_SCOPE = { achievement: null, category: null, session: null, exercise: null, weeks: 8 }

/**
 * The merged achievements, unless the caller already has them.
 *
 * Passed in from the page, which has them anyway; computed here when a test or a
 * lone call does not. Target dates are irrelevant to scoping, so the profile
 * facts are not needed — only `categories` is read.
 */
const listOf = (plan, entries, given) => given || mergeAchievements(plan, entries)

/** Which lift exercises this entry recorded. */
function exercisesIn(entry) {
  return liftsIn(entry?.data?.out || {}).map(l => l.exercise).filter(Boolean)
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
export function resolveScope({ plan, entries = [], scope = EMPTY_SCOPE, today = null, achievements = null }) {
  const menu = plan?.dailyMenu || []
  const achCats = categorySet(listOf(plan, entries, achievements), scope.achievement)

  // The window, as whole weeks back from this one, so the bars line up with the
  // Week tab rather than cutting a week in half.
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

    const cat = categoryOf(e, menu)
    if (achCats && !achCats.has(cat)) continue
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
export function scopeOptions({ plan, entries = [], today = null, weeks = null, achievements = null }) {
  const menu = plan?.dailyMenu || []
  const achs = listOf(plan, entries, achievements)
  const base = resolveScope({ plan, entries, scope: { ...EMPTY_SCOPE, weeks }, today, achievements: achs })

  const count = (map, key) => { if (key) map.set(key, (map.get(key) || 0) + 1) }
  const cats = new Map(); const sess = new Map(); const exs = new Map()

  for (const e of base.entries) {
    const opt = optFor(menu, e.data?.optId)
    count(cats, categoryOf(e, menu))
    const act = opt ? loggedActivity(opt, e.data?.out) : null
    // One list, because the user does not think of them as two: the thing the user picks is
    // "mountain bike" or "max hangs", and which of those is a card and which is a
    // catalog activity is the app's problem.
    count(sess, act?.key || opt?.id)
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

  return {
    achievements: achs.map(a => ({
      value: a.id,
      label: a.short || a.name,
      icon: a.icon,
      n: [...cats.entries()]
        .filter(([k]) => a.categories.includes(k))
        .reduce((a2, [, v]) => a2 + v, 0),
    })).filter(o => o.n > 0),

    categories: [...cats.entries()]
      .map(([k, n]) => ({
        value: k, n,
        label: catDefs.find(c => c.key === k)?.name || k,
        icon: catDefs.find(c => c.key === k)?.icon,
        // Derived, not read off the category — plan.json's back-reference went
        // when achievements became editable. See lib/achievements.js.
        achievement: achievementOf(k, achs)?.id || null,
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
  if (scope.achievement) bits.push(find(options?.achievements, scope.achievement) || scope.achievement)
  if (scope.category) bits.push(find(options?.categories, scope.category) || scope.category)
  if (scope.session) bits.push(find(options?.sessions, scope.session) || scope.session)
  if (scope.exercise) bits.push(find(options?.exercises, scope.exercise) || scope.exercise)
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
