/*
 * Which of two sessions came first (#96, #111): what "the last time" means
 * everywhere it is asked. `priorSessions` (lib/history.js) and `lastLift`
 * (lib/lifts.js) both bound by it, so "The last 5 times you did this" and "Last
 * time · …" over an exercise never disagree about which day was before which.
 * Its own file because lib/history.js imports lib/lifts.js.
 */

/**
 * Where an entry sits in its day, as the day list shows it (tabs.jsx): the main
 * session first, then the extras by id.
 */
const dayPlace = (e) => [e?.data?.slot === 'extra' ? 1 : 0, String(e?.id || '')]

/**
 * When a session started, in ms, where something measured or stamped it: its
 * run, the WHOOP or Strava workout attached to it, then its done tap. Null when
 * nothing did (a lift typed on the sheet): a day carries no other clock.
 */
function startedAt(e) {
  const d = e?.data || {}
  for (const v of [d.run?.startedAt, d.out?.whoop?.start, d.out?.strava?.start, d.doneAt]) {
    const t = typeof v === 'number' ? v : Date.parse(v)
    if (Number.isFinite(t) && t > 0) return t
  }
  return null
}

/**
 * Is `e` before `me`: an earlier day, or earlier the same day, by when each
 * started where both say, else by the day list's order.
 */
export function before(e, me) {
  if (String(e.date) !== String(me.date)) return String(e.date) < String(me.date)
  const [ta, tb] = [startedAt(e), startedAt(me)]
  if (ta !== null && tb !== null && ta !== tb) return ta < tb
  const [a, b] = [dayPlace(e), dayPlace(me)]
  return a[0] !== b[0] ? a[0] < b[0] : a[1] < b[1]
}
