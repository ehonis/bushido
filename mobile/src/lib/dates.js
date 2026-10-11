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
