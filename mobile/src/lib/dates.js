/*
 * Local calendar dates.
 *
 * NEVER use `new Date().toISOString().slice(0, 10)` for a training date. It
 * converts to UTC first, so anything logged after ~8pm in US Eastern lands on
 * tomorrow — a Monday session filed as Tuesday, a broken streak, and a habit
 * pushed to Totem on the wrong day.
 *
 * `updatedAt` timestamps are a different thing and DO stay UTC — those are
 * instants used for last-write-wins ordering, not calendar days.
 */

/** Local calendar date as YYYY-MM-DD. */
export function localIso(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Parse a YYYY-MM-DD as local noon, so DST shifts can't move it a day. */
export function fromIso(iso) {
  return new Date(`${iso}T12:00:00`)
}

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

/** The Monday `n` weeks AFTER this one; negative walks back (-1 is last week). */
export function shiftWeek(mondayIso, n) {
  const d = fromIso(mondayIso)
  d.setDate(d.getDate() + n * 7)
  return localIso(d)
}

/** `iso` moved by `n` days, in local days. */
export const isoShift = (iso, n) => {
  const d = fromIso(iso)
  d.setDate(d.getDate() + n)
  return localIso(d)
}

/*
 * ONE way to write a day (#98, G r1 F4): the app had five ("Wed 4 Nov", "Wed, Nov 4",
 * "Sunday, Nov 8", "Nov 2 – Nov 8" and a raw "2026-10-24"). Two styles now, both
 * spelled out by hand rather than through toLocaleDateString, so the server render,
 * the phone and every browser write the same words:
 *   lists and lines  `dayWords`  "Today", "Yesterday", "Tomorrow", else "Wed, Nov 4"
 *   a heading's date `dayLong`   "Sunday, Nov 8"
 * and a week is `weekRange`, "Nov 2 – Nov 8". A year is added only when it is not
 * this one ("Wed, Nov 4, 2025").
 */
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const yearOf = (iso, today) => (fromIso(iso).getFullYear() === fromIso(today).getFullYear() ? '' : `, ${fromIso(iso).getFullYear()}`)

/** "Nov 4". */
export const monthDay = (iso) => { const d = fromIso(iso); return `${MONTH[d.getMonth()]} ${d.getDate()}` }

/** A date in a list or a line: "Wed, Nov 4" (and its year when not this one). */
export const dateWords = (iso, today = localIso()) => `${WEEKDAY[fromIso(iso).getDay()]}, ${monthDay(iso)}${yearOf(iso, today)}`

/** A day in words: "Today", "Yesterday", "Tomorrow", else "Sat, Oct 24". */
export function dayWords(iso, today = localIso()) {
  const offset = Math.round((fromIso(iso) - fromIso(today)) / 86400000)
  if (offset === 0) return 'Today'
  if (offset === -1) return 'Yesterday'
  if (offset === 1) return 'Tomorrow'
  return dateWords(iso, today)
}

/** A heading's date: "Sunday, Nov 8" (under "Today" in Today's title). */
export const dayLong = (iso, today = localIso()) => `${WEEKDAY_LONG[fromIso(iso).getDay()]}, ${monthDay(iso)}${yearOf(iso, today)}`

/** A week: "Nov 2 – Nov 8". */
export const weekRange = (mondayIso) => `${monthDay(mondayIso)} – ${monthDay(isoShift(mondayIso, 6))}`

/**
 * The same day inside a sentence: "last time (yesterday)", "last time (Sat, Oct 24)".
 * One format on a sheet (#94): it read "2026-11-07", "yesterday" and "2026-10-20".
 */
export function dayPhrase(iso, today = localIso()) {
  const words = dayWords(iso, today)
  return /^(Today|Yesterday|Tomorrow)$/.test(words) ? words.toLowerCase() : words
}
