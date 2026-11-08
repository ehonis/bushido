/*
 * Where a chart puts its points along x. Pure, so it is tested as arithmetic
 * (app/progress.test.js) and shared word for word by the web's viz.jsx and the
 * phone's viz.tsx.
 *
 * A date series is spaced by TIME (F10 of the 2026-11-08 grading): Nov 1, Nov 2
 * and Dec 2 used to sit at equal steps, so a month off read as a day and the
 * "since" arrow described a timeline the plot did not draw. Anything that is not
 * an ISO date keeps its order, evenly spaced. One point sits in the middle.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/
const dayOf = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86400000
}

/** `x(i)` for the i-th of `xs`, mapped onto [left, left + width]. */
export function timeX(xs, left, width) {
  const n = xs.length
  if (n <= 1) return () => left + width / 2
  if (xs.every(x => ISO.test(String(x)))) {
    const days = xs.map(dayOf)
    const lo = Math.min(...days)
    const span = Math.max(...days) - lo
    if (span > 0) return (i) => left + ((days[i] - lo) / span) * width
  }
  return (i) => left + (i / (n - 1)) * width
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * "Oct 19", or "Oct 19 2025" when the year is not obvious: the series crosses a
 * year, or the date is not in this one. By hand, so every renderer agrees.
 */
export function dateWords(iso, { withYear = false } = {}) {
  const [y, m, d] = String(iso).split('-').map(Number)
  if (!m || !d) return String(iso)
  return withYear ? `${MONTH[m - 1]} ${d} ${y}` : `${MONTH[m - 1]} ${d}`
}

/** Does a date series need its year said? It crosses one, or it is not this year's. */
export function needsYear(xs, thisYear = new Date().getFullYear()) {
  const years = new Set(xs.filter(x => ISO.test(String(x))).map(x => Number(String(x).slice(0, 4))))
  return years.size > 1 || (years.size === 1 && !years.has(thisYear))
}
