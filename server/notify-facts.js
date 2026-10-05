/*
 * What Bushido is allowed to say, and when.
 *
 * Pure functions over data the app already holds — the training log, the WHOOP
 * cache, the Strava cache, and Totem's goals — returning facts in the shape the
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

/** Sessions on a day that actually happened, ignoring plans and rest. */
export function doneEntriesFor(state, date) {
  return Object.values(state?.entries || {})
    .filter((e) => e && e.kind === 'daily' && e.date === date && !e.deleted && e.data?.done !== false)
}

/**
 * Goal metrics Strava feeds, which is what a ride or a run actually moves.
 *
 * A metric with nothing left on it is dropped, and that is not the same test as
 * `g.complete`. Completion is THEIR to assert in Totem, so a goal the user has already
 * hit sits there at 100% and `complete: false` for the rest of its period — and
 * since the nearest goal is the one named, a finished one wins every sort and
 * every ride is announced against it. "Go for one mountain bike ride — 0 to go
 * with 14 days left" went out five times before anyone read it as a bug; it is
 * arithmetic about a question the user answered a week ago. `goalPaceFacts` has always
 * drawn this line the same way (`fraction < 1`).
 */
/**
 * Every number a goal is tracking: its own first, then the ones on its steps.
 *
 * A goal's numbers usually live on its STEPS — "complete cardio goals" with "2 bike
 * rides (10+ miles)" under it — and reading `goal.metrics` alone meant the goals most
 * worth saying something about were the ones that never had anything said. The goal's
 * own come first so a step feeding a total is never the one named: the total is.
 *
 * A step decided against is left out; its numbers are not something to chase.
 */
function allMetrics(goal) {
  const steps = Array.isArray(goal?.subGoals) ? goal.subGoals : []
  return [
    ...(Array.isArray(goal?.metrics) ? goal.metrics : []),
    ...steps.filter((s) => !s?.abandoned && !s?.complete).flatMap((s) => (Array.isArray(s?.metrics) ? s.metrics : [])),
  ]
}

function movedGoals(goals, family) {
  if (!Array.isArray(goals)) return []
  const wanted = family === 'ride' ? /bik|cycl|ride/i : family === 'run' ? /run/i : null
  if (!wanted) return []
  return goals
    .filter((g) => !g.complete && g.periodState === 'active')
    .map((g) => ({
      goal: g,
      metric: allMetrics(g).find((m) => m.available !== false && wanted.test(m.label || '')),
    }))
    .filter((x) => x.metric && x.metric.targetValue > 0 && x.metric.value < x.metric.targetValue)
}

const round = (n) => Math.round(n * 10) / 10

/* --------------------------------------------------------- workout logged */

/** Days after the fact a "you just logged this" notification still makes sense. */
const LOGGED_WINDOW_DAYS = 1

/**
 * An entry counts as done unless it says otherwise.
 *
 * The same rule as `isDone` in the app and in server.js: `done` was added after
 * hundreds of entries had been written, and an absent one was only ever created
 * by pressing "log this".
 */
const isDoneEntry = (entry) => !!entry && entry.data?.done !== false

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
 * happened. **A session is news exactly once, when it becomes done** — which is
 * the app's own rule that planning is not completing, read as an event. So an
 * entry that was ALREADY done in `before` can never be announced again, however
 * many times it is edited, re-synced or corrected afterwards.
 *
 * Callers must pass `before`. The default is the empty state, which treats every
 * entry as new; that is right on first boot and wrong everywhere else.
 */
export function completedDailyEntries(incoming, before = {}) {
  const out = []
  for (const entry of Object.values(incoming?.entries || {})) {
    if (!entry || entry.kind !== 'daily' || entry.deleted) continue
    const prior = before?.entries?.[entry.id]
    if (prior && String(entry.updatedAt || '') <= String(prior.updatedAt || '')) continue
    // Planning is not completing, and neither is editing something already done.
    if (!isDoneEntry(entry)) continue
    if (prior && !prior.deleted && isDoneEntry(prior)) continue
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
export function workoutLoggedFact({ entry, goals = null, now = Date.now() }) {
  if (!entry || entry.kind !== 'daily' || entry.deleted) return null
  if (entry.data?.done === false) return null
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
  const family = String(data.family || data.activity || name).toLowerCase().includes('run') ? 'run'
    : /bike|bik|cycl|ride/i.test(String(data.family || data.activity || name)) ? 'ride'
      : null

  // What the session moved, if anything. A goal fed by Strava updates itself, so
  // by the time this reads it the new miles are already in.
  const moved = movedGoals(goals, family)
    .map(({ goal, metric }) => ({
      title: goal.title,
      left: round(metric.targetValue - metric.value),
      value: round(metric.value),
      target: round(metric.targetValue),
      unit: metric.unit || '',
      daysLeft: goal.daysLeft,
      percent: goal.progress?.percent ?? null,
    }))
    .sort((a, b) => a.left - b.left)[0]

  const effort = Number.isFinite(out.rpe) ? ` RPE ${out.rpe}.` : ''
  const body = moved
    ? `${moved.value} of ${moved.target} ${moved.unit} on ${moved.title} — ${moved.left} to go with ${moved.daysLeft} day${moved.daysLeft === 1 ? '' : 's'} left.`
    : `Logged.${effort}`

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
  const missing = recorded.filter((x) => doneEntriesFor(state, x.date).length === 0)
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

/* ------------------------------------------------------------- goal pace */

/**
 * A standing goal close enough to finish, or drifting far enough to say so.
 *
 * `nearDone` is where "you're close" is true rather than encouraging. Below it,
 * a nudge is a progress bar read aloud.
 */
export function goalPaceFacts({ goals = null, now = Date.now(), nearDone = 0.7 }) {
  if (!Array.isArray(goals)) return []
  const out = []

  for (const goal of goals) {
    if (goal.complete || goal.periodState !== 'active') continue
    const fraction = goal.progress?.fraction
    // Unreadable is not behind — a Strava metric nobody could read is unknown.
    if (fraction === null || fraction === undefined) continue

    const metric = allMetrics(goal).find((m) => m.available !== false && m.targetValue > 0)
    if (!metric) continue
    const left = round(metric.targetValue - metric.value)
    const unit = metric.unit || ''
    const days = Number(goal.daysLeft) || 0

    if (fraction >= nearDone && fraction < 1) {
      out.push({
        kind: 'goal.near',
        category: 'goal.pace',
        salience: 60 + Math.round(fraction * 20) + (days <= 2 ? 10 : 0),
        slot: 'evening',
        subject: goal.id,
        title: `${left} ${unit} from ${goal.title}`,
        body: `${goal.progress.percent}% there with ${days} day${days === 1 ? '' : 's'} left. That's one session.`,
        url: '/',
        expiresAt: now + Math.max(1, days) * DAY,
        revalidate: { collector: 'goals', factKey: `goal-near:${goal.id}:${goal.progress.percent}` },
        resolvedTitle: `${goal.title} — done`,
      })
      continue
    }

    // Behind with the window closing. Said near the end, not every evening of it.
    if (days <= 2 && fraction < nearDone) {
      const perDay = round(left / Math.max(1, days))
      out.push({
        kind: 'goal.behind',
        category: 'goal.pace',
        salience: 50,
        slot: 'night',
        subject: goal.id,
        title: `${goal.title} needs ${perDay} ${unit} a day`,
        body: `${goal.progress.percent}% with ${days} day${days === 1 ? '' : 's'} to go. Worth deciding whether it still stands.`,
        url: '/',
        expiresAt: now + Math.max(1, days) * DAY,
        revalidate: { collector: 'goals', factKey: `goal-behind:${goal.id}:${goal.progress.percent}` },
      })
    }
  }

  return out
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
export function collectScheduledFacts({ state = null, whoop = null, strava = null, goals = null, now = Date.now(), tz }) {
  return [
    ...readinessFacts({ whoop, now, tz }),
    ...bodyWarningFacts({ whoop, now }),
    ...unloggedFacts({ state, whoop, strava, now }),
    ...goalPaceFacts({ goals, now }),
  ]
}
