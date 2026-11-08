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
import { mondayOf } from './dates.js'
import { resolveMinutes, minutesSourceOf } from './minutes.js'
import { isHardEntry } from './fingers.js'
import {
  gradeIndex, rungLabel, vRungLabel, hardestSent, climbsOf, sessionGradesOf, climbVolume,
  bandOf, bandLabel, axisLadder, indexOn,
} from './grades.js'
import { liftsDone, liftKeyOf, liftMeasure } from './lifts.js'
import { loggedActivity } from './activities.js'
import { weeksIn } from './scope.js'

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const pos = (v) => { const n = num(v); return n !== null && n > 0 ? n : null }

const optOf = (plan, e) => optFor(plan?.dailyMenu || [], e.data?.optId)

/* ---------------------------------------------------------------- minutes */

/*
 * An entry's minutes, the way the rest of the app reads them: typed or measured,
 * and a correction stored before `out.minutesSpent` existed (`data.minutes` +
 * `minutesSource: 'typed'`) still beating the card's estimate. Progress used to
 * read `minutesFor(opt, out)`, which cannot see that correction, so a session
 * corrected to 12 minutes counted as the card's 120 here while its row said 12
 * (F7 of the 2026-11-08 grading).
 */
function entryMinutes(entry, plan) {
  return pos(resolveMinutes(entry.data, optOf(plan, entry), entry.data?.out || {}))
}

/** Is this entry's time only the card's estimate: nothing typed, measured or corrected? */
function estimated(entry, plan) {
  if (entry.data?.minutesSource === 'typed') return false
  return minutesSourceOf(optOf(plan, entry), entry.data?.out || {}) === 'estimate' &&
    entryMinutes(entry, plan) !== null
}

/**
 * "3 workouts use the card's estimate", under a chart that adds minutes up, so a
 * total that is partly a plan does not pass for a measurement. Nothing when every
 * minute was typed or measured.
 */
function estimateNote(r, plan) {
  const n = r.entries.filter(e => isTraining(e) && estimated(e, plan)).length
  return n ? `${n} workout${n === 1 ? ' uses' : 's use'} the card's estimate` : null
}

/** Session load: RPE × minutes. Foster's sRPE, and what the week chart is made of. */
function sRPE(entry, plan) {
  // A commute is not load. It is miles and a streak day — see `isTraining` — but
  // telling the load chart that a short ride to work was training is how a
  // light week reads as a moderate one.
  if (!isTraining(entry)) return 0
  const rpe = pos(entry.data?.out?.rpe) ?? ((Number(entry.data?.level) || 0) * 2)
  const mins = entryMinutes(entry, plan) ?? 0
  return rpe > 0 && mins > 0 ? rpe * mins : 0
}

/* ----------------------------------------------------------------- shapes */

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

/**
 * One point per DATE, oldest first. Two sessions on one day are one point, the
 * higher of the two: every per-session series here is a best (the top set, the
 * hardest send, the fastest ride), and two dots on one day drawn apart claimed a
 * timeline the day did not have (F10).
 */
function perSession(resolved, value) {
  const best = new Map()
  for (const e of resolved.entries) {
    const y = value(e)
    if (y === null || y === undefined || !Number.isFinite(y)) continue
    if (!best.has(e.date) || y > best.get(e.date)) best.set(e.date, y)
  }
  return [...best.entries()]
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([x, y]) => ({ x, y }))
}

const has = (set, ...keys) => keys.some(k => set.has(k))

/**
 * The dates in scope that cost a hard finger exposure. A DAY is a hard finger
 * day, not a session: a split night (max hangs, then repeaters) is one exposure,
 * and counting sessions made it two (F5). `lib/fingers.js` `hardDates` is the
 * same rule; this one keeps to the scope's entries, which are already done.
 */
function hardDays(resolved, plan) {
  const menu = plan?.dailyMenu || []
  return [...new Set(resolved.entries.filter(e => isHardEntry(e, menu)).map(e => e.date))].sort()
}

/* --------------------------------------------------- one exercise, compared */

/** The rows of the scope's movement on one entry: what was lifted (liftsDone, D11). */
const rowsOf = (e, key) => liftsDone(e).filter(l => liftKeyOf(l) === key)
const isHold = (row) => liftMeasure(row) === 'time'

/*
 * COMPARABLE SETS ONLY (F9). A top set on a barbell and one on a pair of
 * dumbbells are two numbers wearing one unit, and "per hand" against "on the
 * bar" is another again (#58). So a strength line compares the sets done on the
 * implement, and with the weight meaning, of the NEWEST row of the movement that
 * names one. A row that names no implement (older rows, a quick log) is not a
 * different implement but an unknown one, and is kept.
 */
function referenceRow(r) {
  const newest = [...r.entries].sort((a, b) => String(b.date).localeCompare(String(a.date)))
  for (const e of newest) {
    const row = rowsOf(e, r.exercise).find(l => l.implement && !isHold(l))
    if (row) return row
  }
  return null
}
const sameKind = (ref) => (row) => !ref || !row.implement ||
  (row.implement === ref.implement && (row.weightMode || '') === (ref.weightMode || ''))

/** "On the barbell" / "On the dumbbell, per hand": what the strength lines compare. */
function kindWords(r) {
  const ref = referenceRow(r)
  if (!ref) return null
  const what = String(ref.implementLabel || ref.implement).toLowerCase()
  return `On the ${what}${ref.weightMode && ref.weightLabel ? `, ${ref.weightLabel}` : ''}`
}

/** Fold the comparable rep-counted sets of the scope's movement on one entry. */
function overSets(r, e, fn, start) {
  const ok = sameKind(referenceRow(r))
  let acc = start
  for (const row of rowsOf(e, r.exercise)) {
    if (isHold(row) || !ok(row)) continue
    for (const s of (row.sets || [])) acc = fn(acc, s)
  }
  return acc
}

/* ------------------------------------------------------------- one sport */

/**
 * Do the entries carrying this measurement all come from ONE sport? An average
 * speed across a 6 mph run and a 16 mph ride is not a trend, and the first-to-
 * last arrow drew a sport switch as improvement (F9).
 */
function oneSport(plan, entries) {
  const sports = new Set(entries.map(e => {
    const opt = optOf(plan, e)
    return (opt && loggedActivity(opt, e.data?.out)?.key) || opt?.id || '?'
  }))
  return sports.size === 1
}

/* ------------------------------------------------------------- climbing */

/**
 * The grade pyramid for one ladder over the scope: one row per whole grade the
 * climbs touched (5.10 a to d and − to + are one row, so a log written both ways
 * reads as one), HARDEST FIRST, each `{ label, band, sent, tried }`. `tried` is
 * every climb described at that grade, `sent` the ones that went clean (lib/
 * grades.js `isClean`). A session's own "hardest" field is one send at its grade,
 * counted only when the session described no climbs on that ladder, since then it
 * is one of them. Off-ladder grades are left out, never rounded onto a rung.
 */
export function pyramidOf(resolved, plan, scale) {
  const rows = new Map()
  const bump = (band, clean) => {
    const row = rows.get(band) || { band, label: bandLabel(scale, band), sent: 0, tried: 0 }
    row.tried += 1
    if (clean) row.sent += 1
    rows.set(band, row)
  }
  for (const e of resolved.entries) {
    const opt = optOf(plan, e)
    if (!opt) continue
    const out = e.data?.out || {}
    const climbs = climbsOf(opt, out).filter(c => c.scale === scale && bandOf(scale, c.grade) !== null)
    for (const c of climbs) bump(bandOf(scale, c.grade), c.clean)
    if (climbs.length) continue
    for (const g of sessionGradesOf(opt, out)) {
      const b = g.scale === scale ? bandOf(scale, g.grade) : null
      if (b !== null) bump(b, true)
    }
  }
  return [...rows.values()].sort((a, b) => b.band - a.band)
}

/** The hardest send of one ladder per session, as a chart value (a rung index for routes). */
/** The ladder the scope's route sends are written on (see axisLadder in grades.js). */
const routeAxis = (r, plan) => axisLadder(r.entries.map(e => {
  const opt = optOf(plan, e)
  return opt ? hardestSent(opt, e.data?.out || {}, 'yds') : null
}))

const sentOn = (plan, scale) => (e) => {
  const opt = optOf(plan, e)
  const best = opt ? hardestSent(opt, e.data?.out || {}, scale) : null
  if (best === null) return null
  return scale === 'v' ? best : gradeIndex(best)
}

/* ---------------------------------------------------------------- the body */

/**
 * Bodyweight, inside the page's period (F17: the 8-week page drew its body graph
 * from August). One point per date, the last weighed that day.
 */
export function bodyweightSeries(entries = [], from = null) {
  const byDate = new Map()
  for (const e of entries) {
    if (e?.kind !== 'bodyweight' || e.deleted || !e.date || !(Number(e.data?.lb) > 0)) continue
    if (from && e.date < from) continue
    byDate.set(e.date, Number(e.data.lb))
  }
  return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([x, y]) => ({ x, y }))
}

/* ------------------------------------------------------------- the metrics */

export const METRICS = [
  /* ---------------------------------------------------------- universal */
  /*
   * Titled in plain words since wave 2 (issue #43): "Time per week", "Effort per
   * week". "Training load" and "RPE × minutes" are the sports-science names for
   * the same numbers and mean nothing to someone who has not read the paper.
   * How often and how long lead; effort, the derived one, follows.
   */
  {
    key: 'sessions',
    group: 'Training',
    kind: 'bar',
    label: 'Workouts per week',
    applies: () => true,
    series: (r, plan) => byWeek(r, plan, () => 1),
  },
  {
    key: 'minutes',
    group: 'Training',
    kind: 'bar',
    unit: ' h',
    label: 'Time per week',
    help: (r, plan) => estimateNote(r, plan),
    applies: () => true,
    series: (r, plan) => byWeek(r, plan, e => (entryMinutes(e, plan) || 0) / 60),
  },
  {
    key: 'load',
    group: 'Training',
    kind: 'bar',
    label: 'Effort per week',
    help: (r, plan) => ['How hard it felt × minutes, added up', estimateNote(r, plan)].filter(Boolean).join(' · '),
    applies: () => true,
    series: (r, plan) => byWeek(r, plan, e => sRPE(e, plan)),
  },

  /* ----------------------------------------------------- distance sports */
  {
    key: 'miles',
    group: 'Distance',
    kind: 'bar',
    unit: ' mi',
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
    label: 'Longest each week',
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
    // One sport at a time: the scope has to have narrowed the speeds to one.
    applies: (r, plan) => {
      const timed = r.entries.filter(e => pos(e.data?.out?.speed))
      return timed.length >= 2 && oneSport(plan, timed)
    },
    series: (r) => perSession(r, e => pos(e.data?.out?.speed)),
  },
  {
    key: 'yards',
    group: 'Distance',
    kind: 'bar',
    unit: ' yd',
    label: 'Yards swum per week',
    applies: (r) => r.entries.some(e => pos(e.data?.out?.poolDistance)),
    series: (r, plan) => byWeek(r, plan, e => pos(e.data?.out?.poolDistance) || 0),
  },

  /* ------------------------------------------------------- one exercise */
  {
    key: 'topLoad',
    group: 'Strength',
    kind: 'line',
    unit: ' lb',
    label: 'Top set',
    help: (r) => ['The heaviest set of it, each time', kindWords(r)].filter(Boolean).join(' · '),
    applies: (r) => Boolean(r.exercise),
    series: (r) => perSession(r, e => overSets(r, e, (top, s) => {
      const w = pos(s.weight)
      return w !== null && (top === null || w > top) ? w : top
    }, null)),
  },
  {
    key: 'exVolume',
    group: 'Strength',
    kind: 'line',
    unit: ' lb',
    label: 'Weight × reps',
    help: (r) => kindWords(r),
    applies: (r) => Boolean(r.exercise),
    series: (r) => perSession(r, e => {
      const v = overSets(r, e, (sum, s) => sum + (pos(s.weight) || 0) * (pos(s.reps) || 0), 0)
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
      const n = overSets(r, e, (sum, s) => sum + (pos(s.reps) || 0), 0)
      return n > 0 ? n : null
    }),
  },
  {
    // A hold is counted in seconds (#63), and its weight×reps is nothing. Its line
    // is the longest it was held, each time.
    key: 'exHold',
    group: 'Strength',
    kind: 'line',
    unit: ' s',
    label: 'Longest hold',
    applies: (r) => Boolean(r.exercise),
    series: (r) => perSession(r, e => {
      let top = null
      for (const row of rowsOf(e, r.exercise)) {
        if (!isHold(row)) continue
        for (const s of (row.sets || [])) {
          const sec = pos(s.seconds)
          if (sec !== null && (top === null || sec > top)) top = sec
        }
      }
      return top
    }),
  },

  /* --------------------------------------------------------- how it felt */
  {
    key: 'rpe',
    group: 'Effort',
    kind: 'line',
    unit: '/10',
    label: 'How hard it felt',
    applies: (r) => r.entries.filter(e => pos(e.data?.out?.rpe)).length >= 2,
    series: (r) => perSession(r, e => pos(e.data?.out?.rpe)),
  },

  /* ------------------------------------------------------------ climbing */
  /*
   * LAST, on purpose (2026-10-25, issue #31). Groups render in the order their
   * first chart appears here, and this is a workout log first: the climbing
   * charts follow the general ones rather than leading them.
   */
  {
    key: 'hardFingers',
    group: 'Climbing',
    kind: 'bar',
    label: 'Hard finger days per week',
    applies: (r) => has(r.disciplines, 'climbing'),
    series: (r, plan) => {
      const days = new Set(hardDays(r, plan))
      // Each DATE once, in its week, however many sessions it held.
      const firsts = new Set()
      return byWeek(r, plan, e => {
        if (!days.has(e.date) || firsts.has(e.date)) return 0
        firsts.add(e.date)
        return 1
      })
    },
  },
  {
    key: 'climbs',
    group: 'Climbing',
    kind: 'bar',
    label: 'Climbs per week',
    help: 'Routes, problems and laps counted, described or not',
    applies: (r) => has(r.disciplines, 'climbing'),
    series: (r, plan) => byWeek(r, plan, e => {
      const opt = optOf(plan, e)
      return opt ? climbVolume(opt, e.data?.out || {}) : 0
    }),
  },
  /*
   * D12: what was climbed, by grade. A pyramid per ladder (V and routes are two
   * ladders), the sends solid and the climbs that did not go faint beside them,
   * so attempts against sends is read off the same rows.
   */
  {
    key: 'boulderPyramid',
    group: 'Climbing',
    kind: 'pyramid',
    label: 'Boulders by grade',
    help: 'Sent, of everything tried at each grade',
    applies: (r) => has(r.disciplines, 'climbing'),
    series: (r, plan) => pyramidOf(r, plan, 'v'),
  },
  /*
   * Hardest SENT, routes and boulders separately: the hardest climb that went
   * clean (topped, going up), from the per-climb detail, the doubled lead laps'
   * per-lap grades and the card's own "hardest" field alike. Hardest TRIED is
   * the pyramid's top row; the two are separate facts (F12).
   */
  {
    key: 'hardestBoulder',
    group: 'Climbing',
    kind: 'line',
    label: 'Hardest boulder sent',
    applies: (r) => has(r.disciplines, 'climbing'),
    fmtY: (v) => vRungLabel(Math.round(v)),
    series: (r, plan) => perSession(r, sentOn(plan, 'v')),
  },
  {
    key: 'routePyramid',
    group: 'Climbing',
    kind: 'pyramid',
    label: 'Routes by grade',
    help: 'Sent, of everything tried at each grade',
    applies: (r) => has(r.disciplines, 'climbing'),
    series: (r, plan) => pyramidOf(r, plan, 'yds'),
  },
  {
    key: 'hardestRoute',
    group: 'Climbing',
    kind: 'line',
    label: 'Hardest route sent',
    applies: (r) => has(r.disciplines, 'climbing'),
    // The axis is the ladder the log is written on (axisLadder): a plus/minus
    // log is not labelled with letter rungs it never used.
    fmtY: (v) => rungLabel(Math.round(v)),
    fmtYFor: (r, plan) => {
      const ladder = routeAxis(r, plan)
      return (v) => (Number.isInteger(v) ? ladder[v]?.label ?? '' : '')
    },
    series: (r, plan) => {
      const ladder = routeAxis(r, plan)
      return perSession(r, (e) => {
        const opt = optOf(plan, e)
        const best = opt ? hardestSent(opt, e.data?.out || {}, 'yds') : null
        return best === null ? null : indexOn(ladder, best)
      })
    },
  },

  {
    key: 'fingers',
    group: 'Climbing',
    kind: 'line',
    unit: '/5',
    label: 'Fingers afterwards',
    help: '4 is sore, 5 is something hurts',
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

/** How few points a kind needs before it is drawn: a line is a trend from two. */
const FLOOR = { line: 2, bar: 1, pyramid: 1 }

/** Everything worth drawing for this scope, grouped, in registry order. */
export function metricsFor(plan, resolved) {
  const live = []
  for (const m of METRICS) {
    if (!m.applies(resolved, plan)) continue
    const points = m.series(resolved, plan)
    // Two is the floor for a line. A bar chart of one week is still a fact.
    if (!points || points.length < (FLOOR[m.kind] ?? 1)) continue
    if (m.kind === 'bar' && !points.some(p => p.y > 0)) continue
    live.push({
      ...m, points,
      help: (typeof m.help === 'function' ? m.help(resolved, plan) : m.help) || undefined,
      fmtY: typeof m.fmtYFor === 'function' ? m.fmtYFor(resolved, plan) : m.fmtY,
      ref: typeof m.ref === 'function' ? m.ref(plan) : m.ref,
    })
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
  let minutes = 0; let miles = 0; let yards = 0; let load = 0
  const days = new Set()
  for (const e of resolved.entries) {
    minutes += entryMinutes(e, plan) || 0
    miles += pos(e.data?.out?.distance) || 0
    yards += pos(e.data?.out?.poolDistance) || 0
    load += sRPE(e, plan)
    days.add(e.date)
  }
  return {
    sessions: resolved.entries.length,
    days: days.size,
    rests: resolved.rests.length,
    minutes: Math.round(minutes),
    hours: Math.round(minutes / 60),
    miles: Math.round(miles * 10) / 10,
    yards: Math.round(yards),
    load: Math.round(load),
    hardFingerDays: hardDays(resolved, plan).length,
  }
}
