/*
 * The charts, as data rather than as JSX.
 *
 * The old Progress page hardcoded about twenty charts in render order and showed
 * every one of them every time. That works while the app does one sport and every
 * chart is about that sport; it stops working the moment a chart can be
 * irrelevant, because nothing in the page knew how to leave one out.
 *
 * So a metric DECLARES when it means anything:
 *
 *   applies(resolved)  — is there any point drawing this for what the user picked?
 *   series(resolved)   — the points, or the weekly bars
 *
 * and the page draws whichever both apply and have enough data. That is what
 * makes one page serve "everything, last 8 weeks" and "bench press, all time"
 * without either being a special case — and what stops the endurance sports from
 * needing a second page.
 *
 * TWO POINTS IS THE FLOOR, everywhere. A line through one measurement is not a
 * trend, it is a dot with an axis, and the old page drew several of them.
 */

import { optFor } from './menu.js'
import { isTraining } from './store.js'
import { categoryOf, disciplineOf, mondayOf } from './quota.js'
import { minutesFor } from './minutes.js'
import { isHardEntry } from './recommend.js'
import { gradeIndex, rungLabel, vRungLabel, hardestGrade, hardestClimbed } from './grades.js'
import { liftsIn } from './lifts.js'
import { weeksIn } from './scope.js'

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const pos = (v) => { const n = num(v); return n !== null && n > 0 ? n : null }

/** Session load: RPE × minutes. Foster's sRPE, and what the week chart is made of. */
function sRPE(entry, plan) {
  // A commute is not load. It is miles and a streak day — see `isTraining` — but
  // telling the load chart that a short ride to work was training is how a
  // light week reads as a moderate one.
  if (!isTraining(entry)) return 0
  const opt = optFor(plan?.dailyMenu || [], entry.data?.optId)
  const rpe = pos(entry.data?.out?.rpe) ?? ((Number(entry.data?.level) || 0) * 2)
  const mins = pos(minutesFor(opt, entry.data?.out || {})) ?? 0
  return rpe > 0 && mins > 0 ? rpe * mins : 0
}

/** Bucket entries into the scope's weeks, summing whatever `value` returns. */
function byWeek(resolved, plan, value, { includeRests = false } = {}) {
  const weeks = weeksIn(resolved)
  const totals = new Map(weeks.map(w => [w, 0]))
  const source = includeRests ? [...resolved.entries, ...resolved.rests] : resolved.entries
  for (const e of source) {
    const w = mondayOf(e.date)
    if (!totals.has(w)) continue
    totals.set(w, totals.get(w) + (value(e) || 0))
  }
  // `{ x, y }` is what BarChart takes — the same shape as a line's points, so a
  // metric can change kind without its series changing shape.
  return weeks.map(w => ({ x: w, y: Math.round(totals.get(w) * 10) / 10 }))
}

/** One point per session, oldest first. */
function perSession(resolved, value) {
  return resolved.entries
    .map(e => ({ e, y: value(e) }))
    .filter(p => p.y !== null && p.y !== undefined)
    .sort((a, b) => String(a.e.date).localeCompare(String(b.e.date)))
    .map(p => ({ x: p.e.date, y: p.y }))
}

const has = (set, ...keys) => keys.some(k => set.has(k))

/*
 * Telling the two ladders apart, which the log does not do for us.
 *
 * A V-grade is stored as a small integer (V0-V10) and a route as a YDS decimal
 * (5.7 becomes 7, 5.12a becomes 12.1). They overlap between 7 and 10 — V8 and
 * 5.8 are both `8` — and nothing on the entry says which it is. What disambiguates
 * them is the FIELD: `hardest` on a bouldering card is a V-grade, `hardestYds` is
 * a route, and a per-climb `grade` is whichever its log is for.
 *
 * So these are a guard against the overlap rather than a classifier: a decimal is
 * unambiguously a route, and anything above the V ladder is too. The field itself
 * does the real work at the call sites above.
 */
const isRoute = (v) => {
  const n = num(v)
  return n !== null && (n >= 7 && (n > 10 || !Number.isInteger(n)))
}
const isBoulder = (v) => {
  const n = num(v)
  return n !== null && Number.isInteger(n) && n >= 0 && n <= 10
}

/* ------------------------------------------------------------- the metrics */

export const METRICS = [
  /* ---------------------------------------------------------- universal */
  {
    key: 'load',
    group: 'Volume',
    kind: 'bar',
    label: 'Training load per week',
    help: 'RPE × minutes, summed. The one number that treats an easy hour and a savage one differently.',
    applies: () => true,
    series: (r, plan) => byWeek(r, plan, e => sRPE(e, plan)),
  },
  {
    key: 'sessions',
    group: 'Volume',
    kind: 'bar',
    label: 'Workouts per week',
    applies: () => true,
    series: (r, plan) => byWeek(r, plan, () => 1),
  },
  {
    key: 'minutes',
    group: 'Volume',
    kind: 'bar',
    label: 'Hours per week',
    applies: () => true,
    series: (r, plan) => byWeek(r, plan, (e) => {
      const opt = optFor(plan?.dailyMenu || [], e.data?.optId)
      return (pos(minutesFor(opt, e.data?.out || {})) || 0) / 60
    }),
  },

  /* ----------------------------------------------------- distance sports */
  {
    key: 'miles',
    group: 'Distance',
    kind: 'bar',
    label: 'Miles per week',
    applies: (r) => has(r.disciplines, 'bike', 'run') ||
      r.entries.some(e => pos(e.data?.out?.distance)),
    series: (r, plan) => byWeek(r, plan, e => pos(e.data?.out?.distance) || 0),
  },
  {
    key: 'longest',
    group: 'Distance',
    kind: 'line',
    unit: ' mi',
    label: 'Longest single effort',
    help: 'The half iron is won by the long ones, not the average ones.',
    applies: (r) => r.entries.filter(e => pos(e.data?.out?.distance)).length >= 2,
    series: (r) => {
      const weeks = new Map()
      for (const e of r.entries) {
        const mi = pos(e.data?.out?.distance)
        if (!mi) continue
        const w = mondayOf(e.date)
        if (!weeks.has(w) || mi > weeks.get(w)) weeks.set(w, mi)
      }
      return [...weeks.entries()].sort().map(([w, y]) => ({ x: w, y: Math.round(y * 10) / 10 }))
    },
  },
  {
    key: 'speed',
    group: 'Distance',
    kind: 'line',
    unit: ' mph',
    label: 'Average speed',
    applies: (r) => r.entries.filter(e => pos(e.data?.out?.speed)).length >= 2,
    series: (r) => perSession(r, e => pos(e.data?.out?.speed)),
  },
  {
    key: 'yards',
    group: 'Distance',
    kind: 'bar',
    label: 'Yards swum per week',
    applies: (r) => r.entries.some(e => pos(e.data?.out?.poolDistance)),
    series: (r, plan) => byWeek(r, plan, e => pos(e.data?.out?.poolDistance) || 0),
  },

  /* ------------------------------------------------------------ climbing */
  {
    key: 'hardFingers',
    group: 'Climbing',
    kind: 'bar',
    label: 'Hard finger days per week',
    help: 'What the two unbypassable rules are counted on. Three is the cap.',
    ref: (plan) => plan?.recommender?.hardCap,
    refLabel: 'cap',
    applies: (r) => has(r.disciplines, 'climbing'),
    series: (r, plan) => byWeek(r, plan, e => (isHardEntry(e, plan?.dailyMenu || []) ? 1 : 0)),
  },
  /*
   * Hardest thing climbed, routes and boulders separately.
   *
   * These were THREE charts before 2026-09-15 — one for lead laps, one for fun
   * bouldering, one for fun sport days — which is the same measurement split by
   * which card happened to record it, and exactly the over-specificity the
   * rebuild was for. Now the scope decides which sessions are in, and there are
   * two charts because a V-grade and a YDS grade are two ladders.
   *
   * Both read the session-level field AND the per-climb detail, because a session
   * can carry either: `hardest` is what the user typed on the card, and `sets.*.climbs`
   * is what the user ticked per burn. Reading only one of them would make a chart that
   * goes blank on exactly the days the user logged more carefully.
   */
  {
    key: 'hardestRoute',
    group: 'Climbing',
    kind: 'line',
    label: 'Hardest route',
    applies: (r) => has(r.disciplines, 'climbing'),
    fmtY: (v) => rungLabel(Math.round(v)),
    series: (r) => perSession(r, e => {
      const out = e.data?.out || {}
      const fromSets = Object.values(out.sets || {}).map(hardestClimbed)
      const best = hardestGrade([out.hardestYds, ...fromSets].filter(v => isRoute(v)))
      return best === null ? null : gradeIndex(best)
    }),
  },
  {
    key: 'hardestBoulder',
    group: 'Climbing',
    kind: 'line',
    label: 'Hardest boulder',
    applies: (r) => has(r.disciplines, 'climbing'),
    fmtY: (v) => vRungLabel(Math.round(v)),
    series: (r) => perSession(r, e => {
      const out = e.data?.out || {}
      const fromSets = Object.values(out.sets || {}).map(hardestClimbed)
      return hardestGrade([out.hardest, ...fromSets].filter(v => isBoulder(v)))
    }),
  },

  /* ------------------------------------------------------- one exercise */
  {
    key: 'topLoad',
    group: 'Strength',
    kind: 'line',
    unit: ' lb',
    label: 'Top set',
    help: 'The heaviest set you did of this movement, per session.',
    applies: (r) => Boolean(r.exercise),
    series: (r) => perSession(r, e => {
      let top = null
      for (const lift of liftsIn(e.data?.out || {})) {
        if (lift.exercise !== r.exercise) continue
        for (const s of (lift.sets || [])) {
          const w = pos(s.weight)
          if (w !== null && (top === null || w > top)) top = w
        }
      }
      return top
    }),
  },
  {
    key: 'exVolume',
    group: 'Strength',
    kind: 'line',
    unit: ' lb',
    label: 'Volume — load × reps',
    applies: (r) => Boolean(r.exercise),
    series: (r) => perSession(r, e => {
      let v = 0
      for (const lift of liftsIn(e.data?.out || {})) {
        if (lift.exercise !== r.exercise) continue
        for (const s of (lift.sets || [])) v += (pos(s.weight) || 0) * (pos(s.reps) || 0)
      }
      return v > 0 ? v : null
    }),
  },
  {
    key: 'exReps',
    group: 'Strength',
    kind: 'line',
    label: 'Reps',
    applies: (r) => Boolean(r.exercise),
    series: (r) => perSession(r, e => {
      let n = 0
      for (const lift of liftsIn(e.data?.out || {})) {
        if (lift.exercise !== r.exercise) continue
        for (const s of (lift.sets || [])) n += pos(s.reps) || 0
      }
      return n > 0 ? n : null
    }),
  },

  /* --------------------------------------------------------- how it felt */
  {
    key: 'rpe',
    group: 'Effort',
    kind: 'line',
    unit: '/10',
    label: 'Session RPE',
    applies: (r) => r.entries.filter(e => pos(e.data?.out?.rpe)).length >= 2,
    series: (r) => perSession(r, e => pos(e.data?.out?.rpe)),
  },
  {
    key: 'fingers',
    group: 'Effort',
    kind: 'line',
    unit: '/5',
    label: 'Fingers afterwards',
    help: '4 is sore and 5 is something hurts — the two the recommender acts on.',
    applies: (r) => r.entries.filter(e => pos(e.data?.out?.fingers)).length >= 2,
    series: (r) => perSession(r, e => pos(e.data?.out?.fingers)),
  },
]

/* --------------------------------------------- the plan's own declarations */

/**
 * Charts a SESSION declares on its own outputs (`outputs[].chart`).
 *
 * Sixteen of these exist in plan.json — CFmin, the sub-threshold target, straddle
 * reach, 4×4 rest, elbow soreness. They are the specific ones, and they are why
 * the old page was unreadable: every one was on screen at once regardless of what
 * the user was looking at. They survive, because each is a real number tied to a real
 * protocol, but only inside a scope that contains the session that declares it.
 *
 * Content, so a new one is still a plan.json edit with no rebuild — which is the
 * property that made them worth keeping rather than folding into the registry.
 */
export function declaredMetrics(plan, resolved) {
  const menu = plan?.dailyMenu || []
  const out = []
  for (const id of resolved.sessions) {
    const opt = menu.find(m => m.id === id)
    for (const f of (opt?.outputs || [])) {
      if (!f.chart) continue
      const points = resolved.entries
        .filter(e => optFor(menu, e.data?.optId)?.id === id)
        .map(e => ({ x: e.date, y: pos(e.data?.out?.[f.key]) }))
        .filter(p => p.y !== null)
        .sort((a, b) => String(a.x).localeCompare(String(b.x)))
      if (points.length < 2) continue
      out.push({
        key: `${id}.${f.key}`,
        group: 'This session',
        kind: 'line',
        label: f.chart,
        unit: f.unit ? ` ${f.unit}` : '',
        points,
      })
    }
  }
  return out
}

/* ----------------------------------------------------------------- render */

/** Everything worth drawing for this scope, grouped, in registry order. */
export function metricsFor(plan, resolved) {
  const live = []
  for (const m of METRICS) {
    if (!m.applies(resolved)) continue
    const points = m.series(resolved, plan)
    // Two is the floor for a line. A bar chart of one week is still a fact.
    if (!points || points.length < (m.kind === 'line' ? 2 : 1)) continue
    if (m.kind === 'bar' && !points.some(p => p.y > 0)) continue
    live.push({ ...m, points, ref: typeof m.ref === 'function' ? m.ref(plan) : m.ref })
  }
  live.push(...declaredMetrics(plan, resolved))

  const groups = []
  for (const m of live) {
    let g = groups.find(x => x.name === m.group)
    if (!g) { g = { name: m.group, metrics: [] }; groups.push(g) }
    g.metrics.push(m)
  }
  return groups
}

/* ------------------------------------------------------------- the totals */

/** The headline numbers for a scope — what it adds up to, in one line each. */
export function totalsFor(plan, resolved) {
  const menu = plan?.dailyMenu || []
  let minutes = 0; let miles = 0; let yards = 0; let load = 0; let hard = 0
  const days = new Set()
  for (const e of resolved.entries) {
    const opt = optFor(menu, e.data?.optId)
    minutes += pos(minutesFor(opt, e.data?.out || {})) || 0
    miles += pos(e.data?.out?.distance) || 0
    yards += pos(e.data?.out?.poolDistance) || 0
    load += sRPE(e, plan)
    if (isHardEntry(e, menu)) hard += 1
    days.add(e.date)
  }
  return {
    sessions: resolved.entries.length,
    days: days.size,
    rests: resolved.rests.length,
    hours: Math.round(minutes / 60),
    miles: Math.round(miles * 10) / 10,
    yards: Math.round(yards),
    load: Math.round(load),
    hardFingerDays: hard,
  }
}
