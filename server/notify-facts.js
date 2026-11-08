/*
 * What Bushido is allowed to say, and when.
 *
 * Pure functions over data the app already holds — the training log, the WHOOP
 * cache and the Strava cache — returning facts in the shape the
 * shared planner ranks (see notify/signals.mjs in the personal-assistant repo).
 * No model decides what is true here; the model only chooses the words.
 *
 * The voice is a coach: warmer than Totem, and still specific. "Nice session"
 * with a number after it is encouragement; "nice session" on its own is noise,
 * and noise is what gets an app muted.
 */

const DAY = 86_400_000

const dayKeyOf = (ms) => new Date(ms).toISOString().slice(0, 10)

/* ------------------------------------------------------------------ helpers */

/**
 * A rest day is a real choice, and it is not a session.
 *
 * The ONE definition: server.js imports this for the habit rollup rather than
 * keeping its own copy, because the two quietly disagreeing is how "Nice
 * session \u2014 Rest day" went out twenty-seven times on 2026-09-16.
 */
export function isRestEntry(entry) {
  const id = entry?.data?.optId
  return id ? id === 'off' : /rest/i.test(entry?.data?.name || '')
}

/** The day an entry is about, falling back to when it was written. */
function entryDayKey(entry) {
  if (entry?.date) return String(entry.date)
  const ms = Date.parse(entry?.updatedAt || '')
  return Number.isFinite(ms) ? dayKeyOf(ms) : null
}

/** Whole days between two YYYY-MM-DD keys, or NaN if either is not one. */
function daysBetween(a, b) {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY
}

/**
 * Sessions done on a day (`isDone`, asked on `today`): on a day that has passed
 * a planned session counts and one marked undone does not; on today a plan
 * counts once something has been done on it (D10).
 */
export function doneEntriesFor(state, date, today = date) {
  return Object.values(state?.entries || {})
    .filter((e) => e && e.kind === 'daily' && e.date === date && isDone(e, today))
}

/* --------------------------------------------------------- workout logged */

/** Days after the fact a "you just logged this" notification still makes sense. */
const LOGGED_WINDOW_DAYS = 1

/** This machine's calendar day as YYYY-MM-DD, the same as app/src/lib/dates.js. */
function localIso(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/*
 * What says nothing about whether it happened: the shape a card is created in.
 * Part of the done rule below, so identical in the three copies too.
 */
const SHAPE_KEYS = new Set(['activity', 'category', 'title', 'titleFrom'])
const filled = (v) => (Array.isArray(v) ? v.some(filled)
  : v && typeof v === 'object' ? Object.values(v).some(filled)
    : v !== null && v !== undefined && v !== '')
const counted = (s) => ['reps', 'seconds', 'weight', 'distance'].some(f => s?.[f] !== null && s?.[f] !== undefined && s?.[f] !== '')

/**
 * Has anything been LOGGED on it: an effort, a note, a measurement attached, a
 * number on a logged lift's set, or a number someone typed into a planned set
 * (`typed`, prescription.js `patchSet`). A lift row with blank sets is an
 * exercise picked or copied in, not one done; a plan's targets are not typed.
 */
export const loggedOn = (data) =>
  Object.entries(data?.out || {}).some(([k, v]) => !SHAPE_KEYS.has(k) &&
    (k === 'lifts' ? Array.isArray(v) && v.some(l => (l?.sets || []).some(counted)) : filled(v))) ||
  (data?.plan?.blocks || []).some(b => (b?.items || []).some(it => (it?.sets || []).some(s => s?.typed === true && counted(s))))

/**
 * Has someone DONE something on it (D10): logged on it, started its run, or
 * tapped "Mark done" (`doneAt`, which `markDone` writes with `done: true`).
 */
export const touched = (data) => Boolean(data?.doneAt || data?.run?.startedAt || loggedOn(data))

/**
 * Did you do it? (docs/DESIGN.md D2, the owner's D10 in #74, AGENTS.md §4.)
 *
 * The stored flag and the answer are two different things:
 *   - `done` absent or true: done. Absent is every entry written before the flag
 *     existed, all of them by pressing "log this". True wins over everything,
 *     including a marker an older client left behind. Logging a workout on
 *     today or an earlier day writes it (`doneWhenPlaced`).
 *   - `done: false` with `undone: true`: NOT done, whatever the date. Only the
 *     "Mark undone" tap writes that pair (`markDone`), and only "Mark done" takes
 *     it off again. The day arriving never does.
 *   - `done: false` alone: planned. Not done while its day is still to come. ON
 *     its day, done once something has been done on it (`touched`: a number
 *     logged or typed, its run started, "Mark done"), so a plan put on today is
 *     not a workout yet (D10). From the next day on, done, touched or not (D2):
 *     a plan whose day has passed was done unless someone said it was not. A
 *     READ rule, so nothing has to wake at midnight to flip it and two devices
 *     agree without having synced. It reads every entry stored before either
 *     rule unchanged; old entries are never rewritten.
 *
 * `today` is a YYYY-MM-DD; anything else (the index `.filter(isDone)` would pass)
 * means the local today. The helpers above and this are identical in
 * app/src/lib/store.js, server/notify-facts.js and mobile/src/lib/store.js;
 * app/done.test.js holds the three to the same text.
 */
export const isDone = (entry, today) => {
  if (!entry || entry.deleted) return false
  const data = entry.data || {}
  if (data.done !== false) return true
  if (data.undone === true) return false
  const day = typeof today === 'string' ? today : localIso()
  if (typeof entry.date !== 'string' || entry.date > day) return false
  return entry.date < day || touched(data)
}

/**
 * Did a WRITE say done? The stored flag, read the way it always was (absent is
 * done). Only for an earlier day's entry: logging after the fact is the whole
 * act, while a planned session's day passing is not something anyone did.
 */
const markedDone = (entry) => !!entry && entry.data?.done !== false

/**
 * Is there something to announce? Done (`isDone`) AND one of: its run has
 * ended, someone tapped done (`doneAt`, stamped by `markDone` in the app),
 * something has been logged on it (`loggedOn`: an effort, a number on a set,
 * a planned set typed into), or it was WRITTEN done about an earlier day.
 * Picking a session for today, keeping a plan for today, starting its run, or
 * a plan's day passing are not yet news.
 *
 * `today` is the same for both sides of a comparison, so a day turning over
 * cannot make an old entry look new.
 */
const announceable = (entry, today) => isDone(entry, today) && Boolean(
  entry.data?.run?.endedAt || entry.data?.doneAt || loggedOn(entry.data) ||
  (markedDone(entry) && typeof entry.date === 'string' && entry.date < today))

/**
 * The daily entries a write actually COMPLETED — the only ones worth announcing.
 *
 * Two separate mistakes are ruled out here, and they are ruled out in this order
 * because the second is invisible until the first is fixed.
 *
 * The client PUTs its ENTIRE state on every sync (app/src/lib/store.js), so what
 * arrived in the payload is not what the user just logged — it is the whole training
 * log, every time. Announcing the payload instead of the change sent 63
 * notifications per sync, four syncs inside ninety seconds, for sessions going
 * back to June; that is the 2026-09-16 incident, and `before` is the fix. It is
 * the state as it was on disk immediately before the write, and the test is the
 * one `mergeState` uses to decide what to keep: an entry that does not beat the
 * copy already stored changed nothing, and an equal timestamp is a re-send of a
 * write that already happened. Keep the two in step — `mergeState` in server.js
 * is the other half of that rule.
 *
 * But a newer timestamp is not the same as a new session, and that is the
 * 2026-09-19 one: yesterday's ride was announced when the user logged it at 22:24, then
 * announced AGAIN at 09:20 the next morning when a second device caught up and
 * landed its own slightly newer copy of the same finished entry. Nothing had
 * happened. **A session is news exactly once, when a write first makes it
 * `announceable`.** An entry that already was in `before` can never be announced
 * again, however many times it is edited, re-synced or corrected afterwards.
 *
 * Why `announceable` and not `isDone` (docs/DESIGN.md D2; D10, #74). A session
 * picked for today is done from the moment it lands, before any training, and a
 * plan kept for today is done once its run starts: neither is news, so the push
 * waits for the first set logged (on the log or typed into the plan), the run
 * finishing or a "Mark done" tap. A plan reads as done once its day has passed
 * WITHOUT a write; that is never announced either, because nobody did anything at
 * midnight. Logging a workout on an earlier day is announced as it lands (within
 * `LOGGED_WINDOW_DAYS`). "Mark undone" then "Mark done" is a real second completion.
 *
 * Callers must pass `before`. The default is the empty state, which treats every
 * entry as new; that is right on first boot and wrong everywhere else. The server
 * passes `today` in the configured timezone.
 */
export function completedDailyEntries(incoming, before = {}, today = localIso()) {
  const out = []
  for (const entry of Object.values(incoming?.entries || {})) {
    if (!entry || entry.kind !== 'daily' || entry.deleted) continue
    const prior = before?.entries?.[entry.id]
    if (prior && String(entry.updatedAt || '') <= String(prior.updatedAt || '')) continue
    if (!announceable(entry, today)) continue
    if (prior && !prior.deleted && announceable(prior, today)) continue
    out.push(entry)
  }
  return out
}

/**
 * The notification the user asked for: the user just logged a session, so say something
 * about it, and say what it moved.
 *
 * Fires on the write, not on a schedule, because the whole value is that it
 * lands while the user is still getting their shoes off. It is `pinned` in the category
 * table for the same reason — this one is a response, not a nudge, and no amount
 * of feedback should train it away.
 */
export function workoutLoggedFact({ entry, now = Date.now() }) {
  if (!entry || entry.kind !== 'daily' || entry.deleted) return null
  // Not done by anyone's hand: marked undone, or a plan nothing has been logged on.
  if (entry.data?.done === false && (entry.data?.undone === true || !touched(entry.data))) return null
  // Resting is the one thing that is not a session. `workout.logged` is pinned
  // and overrides quiet hours, so there is no way for them to mute being
  // congratulated for a day off \u2014 the restraint has to live here.
  if (isRestEntry(entry)) return null

  // And only about something the user did just now. An import, a backfill, or an edit
  // to a day in August is not a session the user is still getting their shoes off from.
  // The window is a day wide in BOTH directions because `now` is UTC here while
  // `entry.date` is the day the user was living in when the user wrote it.
  const day = entryDayKey(entry)
  const age = day ? daysBetween(day, dayKeyOf(now)) : NaN
  if (!Number.isFinite(age) || age > LOGGED_WINDOW_DAYS) return null

  const data = entry.data || {}
  const name = data.name || 'Session'
  const out = data.out || {}
  // It used to say which linked Totem goal the session moved; linked goals were
  // removed on 2026-10-25 (issue #31), so it says what was logged and nothing more.
  const effort = Number.isFinite(out.rpe) ? ` RPE ${out.rpe}.` : ''
  const body = `Logged.${effort}`

  return {
    kind: 'workout.done',
    category: 'workout.logged',
    salience: 100,
    slot: null,
    subject: entry.id,
    title: `Nice session — ${name}`,
    body,
    url: '/',
    // Worthless tomorrow: it is a response to something the user did minutes ago.
    expiresAt: now + 2 * 3_600_000,
    revalidate: null,
  }
}

/* ------------------------------------------------------------- readiness */

/**
 * The morning number, read against what the user is likely to do.
 *
 * Deliberately three bands and no more. A recovery score rendered as advice is
 * only useful if it changes the decision, and "62%, moderate" changes nothing.
 */
export function readinessFacts({ whoop = null, now = Date.now(), tz = 'America/New_York' }) {
  const today = dayKeyOf(now)
  const row = (whoop?.recovery || []).find((r) => r.date === today)
  if (!row || row.calibrating || !Number.isFinite(row.recovery)) return []

  const score = Math.round(row.recovery)
  const band = score >= 67 ? 'green' : score >= 34 ? 'yellow' : 'red'
  const copy = {
    green: { title: `Recovery ${score}% — green`, body: 'Good day to go hard if the plan calls for it.' },
    yellow: { title: `Recovery ${score}% — amber`, body: 'Train, but keep something back. Not the day for a max effort.' },
    red: { title: `Recovery ${score}% — red`, body: 'Easy or off. Pushing through a red day costs more than it buys.' },
  }[band]

  return [{
    kind: `readiness.${band}`,
    category: 'readiness.morning',
    salience: band === 'red' ? 85 : band === 'green' ? 60 : 50,
    slot: 'morning',
    subject: today,
    ...copy,
    url: '/',
    expiresAt: now + 14 * 3_600_000,
    revalidate: { collector: 'readiness', factKey: `readiness:${today}` },
  }]
}

/* ------------------------------------------------------- unlogged workouts */

/**
 * WHOOP or Strava recorded something the log has no entry for.
 *
 * One fact for the lot, not one per activity: three unlogged rides is one
 * errand, and three notifications about it is a reason to turn notifications off.
 */
export function unloggedFacts({ state = null, whoop = null, strava = null, now = Date.now(), windowDays = 3 }) {
  if (!state) return []
  const since = dayKeyOf(now - windowDays * DAY)
  const today = dayKeyOf(now)

  const recorded = [
    ...(whoop?.workouts || []).map((w) => ({ date: w.date, what: w.sport })),
    ...(strava?.activities || []).map((a) => ({ date: a.date, what: a.name || a.sport })),
  ].filter((x) => x.date && x.date >= since && x.date <= today)

  // A day with any logged session counts as handled: the user logs the session, not
  // each device's record of it, and the merge of the two happens in the app.
  const missing = recorded.filter((x) => doneEntriesFor(state, x.date, today).length === 0)
  if (!missing.length) return []

  const days = [...new Set(missing.map((m) => m.date))].sort()
  const names = [...new Set(missing.map((m) => m.what).filter(Boolean))].slice(0, 2)

  return [{
    kind: 'workout.unlogged',
    category: 'workout.unlogged',
    salience: 55 + Math.min(days.length * 5, 15),
    slot: 'evening',
    subject: days.join(','),
    title: missing.length === 1
      ? `${names[0] || 'A workout'} isn't logged`
      : `${missing.length} workouts aren't logged`,
    body: `Your watch recorded ${names.join(' and ') || 'them'}${days.length > 1 ? ` across ${days.length} days` : ''}. Two taps on Today.`,
    url: '/',
    expiresAt: now + 2 * DAY,
    revalidate: { collector: 'unlogged', factKey: `unlogged:${days.join(',')}` },
    resolvedTitle: 'Everything is logged',
  }]
}

/* ---------------------------------------------------------- body warning */

/**
 * Two hard days on a low recovery. Not a training rule, a flag — the app has
 * real rules and they live in the plan; this is the one case worth interrupting
 * for, because the user cannot see it from inside it.
 */
export function bodyWarningFacts({ whoop = null, now = Date.now() }) {
  const recovery = whoop?.recovery || []
  if (recovery.length < 3) return []
  const today = dayKeyOf(now)
  const recent = recovery
    .filter((r) => r.date <= today && Number.isFinite(r.recovery) && !r.calibrating)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3)
  if (recent.length < 3) return []
  if (!recent.every((r) => r.recovery < 40)) return []

  const avg = Math.round(recent.reduce((s, r) => s + r.recovery, 0) / recent.length)
  return [{
    kind: 'body.under-recovered',
    category: 'body.warning',
    salience: 80,
    slot: 'morning',
    subject: today,
    title: `Three days under 40% recovery`,
    body: `Averaging ${avg}%. That is the pattern that precedes a niggle — a real rest day now is the cheap version.`,
    url: '/',
    expiresAt: now + 14 * 3_600_000,
    revalidate: { collector: 'readiness', factKey: `under-recovered:${today}` },
  }]
}

/* ------------------------------------------------------------- collection */

/** Everything except the workout-logged fact, which is event-driven. */
export function collectScheduledFacts({ state = null, whoop = null, strava = null, now = Date.now(), tz }) {
  return [
    ...readinessFacts({ whoop, now, tz }),
    ...bodyWarningFacts({ whoop, now }),
    ...unloggedFacts({ state, whoop, strava, now }),
  ]
}
