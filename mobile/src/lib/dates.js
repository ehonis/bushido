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

/** A day in words: "Today", "Yesterday", "Tomorrow", else "Sat, Oct 24". */
export function dayWords(iso, today = localIso()) {
  const offset = Math.round((fromIso(iso) - fromIso(today)) / 86400000)
  if (offset === 0) return 'Today'
  if (offset === -1) return 'Yesterday'
  if (offset === 1) return 'Tomorrow'
  return fromIso(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

/**
 * The same day inside a sentence: "last time (yesterday)", "last time (Sat, Oct 24)".
 * One format on a sheet (#94): it read "2026-11-07", "yesterday" and "2026-10-20".
 */
export function dayPhrase(iso, today = localIso()) {
  const words = dayWords(iso, today)
  return /^(Today|Yesterday|Tomorrow)$/.test(words) ? words.toLowerCase() : words
}
