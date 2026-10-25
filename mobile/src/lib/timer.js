/*
 * The interval timer's model: a config becomes a flat list of segments, and a
 * running timer is a handful of instants measured against that list.
 *
 * Pure, and `now` is always an argument, the same rule as lib/prescription.js.
 * Nothing in here counts down. A run records the instant its current segment
 * began; where the clock is NOW is arithmetic on that, so a phone that spent ten
 * minutes in a pocket comes back to exactly the segment it would have reached,
 * and a reload picks the run up from storage without losing a second. That is
 * the runner's `restUntil` idea (AGENTS.md §6.5) applied to a whole timer.
 *
 * The shape of a timer, in the words a timer app uses:
 *
 *   count-in    a few seconds to get set, once, before anything
 *   work, rest  one ROUND; a rest of 0 means back-to-back work
 *   rounds      rounds in a set
 *   sets        sets, with a rest between them
 *   cool-down   once, at the end
 *   intervals   optional: a named sequence that replaces work/rest as the round
 *   repeat      go round again until stopped
 *
 * A segment with `seconds: null` has no target. It counts UP and waits for a
 * tap, which is how the climbing cards' undeclared rests have always run:
 * inventing a number for a rest nobody wrote down is worse than none.
 */

import { buildSteps, startOf, advancePhase, afterSet, LEAD_IN } from './workout.js'

/** What each kind of segment is called on screen, unless it carries its own name. */
export const KIND_LABEL = {
  countin: 'Get ready',
  work: 'Work',
  rest: 'Rest',
  setrest: 'Rest between sets',
  cooldown: 'Cool-down',
}
const KINDS = Object.keys(KIND_LABEL)

/** Bounds for every number in a config. The steppers stop here; stored data is clamped here. */
export const LIMITS = {
  countIn: [0, 60],
  work: [5, 3600],
  rest: [0, 3600],
  rounds: [1, 99],
  sets: [1, 20],
  setRest: [0, 3600],
  coolDown: [0, 3600],
  interval: [1, 3600],
}
/** How many named intervals the editor lets you build. A plan's sequence may be longer. */
export const MAX_NAMED = 12
const MAX_INTERVALS = 400

/** What a timer with nothing chosen runs: a common, middling interval session. */
export const DEFAULT_CONFIG = Object.freeze({
  countIn: 10, work: 30, rest: 15, rounds: 8, sets: 1, setRest: 60, coolDown: 0,
  intervals: [], repeat: false,
})

/** Shipped presets. Ids are stable so a pick survives a re-render. */
export const BUILT_INS = [
  { id: 'builtin-30-15', name: '30 on, 15 off', config: { ...DEFAULT_CONFIG } },
  { id: 'builtin-tabata', name: 'Tabata', config: { ...DEFAULT_CONFIG, work: 20, rest: 10, rounds: 8 } },
  { id: 'builtin-emom', name: 'Every minute', config: { ...DEFAULT_CONFIG, work: 60, rest: 0, rounds: 10 } },
]

const clampInt = (v, [lo, hi], fallback) => {
  const n = Math.round(Number(v))
  if (v === null || v === undefined || v === '' || !Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, n))
}

/** One named interval, or null if it is not one. `seconds: null` counts up. */
function normalizeInterval(raw) {
  if (!raw || typeof raw !== 'object') return null
  const kind = KINDS.includes(raw.kind) ? raw.kind : 'work'
  const seconds = raw.seconds === null || raw.seconds === undefined ? null
    : clampInt(raw.seconds, LIMITS.interval, null)
  const out = { kind, seconds }
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 40) : ''
  if (name) out.name = name
  if (typeof raw.note === 'string' && raw.note) out.note = raw.note.slice(0, 80)
  return out
}

/**
 * Any config, as one the timer can run. Presets are synced data written by
 * whichever version of the app was current, so this never trusts a field.
 */
export function normalizeConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {}
  const d = DEFAULT_CONFIG
  return {
    countIn: clampInt(c.countIn, LIMITS.countIn, d.countIn),
    work: clampInt(c.work, LIMITS.work, d.work),
    rest: clampInt(c.rest, LIMITS.rest, d.rest),
    rounds: clampInt(c.rounds, LIMITS.rounds, d.rounds),
    sets: clampInt(c.sets, LIMITS.sets, d.sets),
    setRest: clampInt(c.setRest, LIMITS.setRest, d.setRest),
    coolDown: clampInt(c.coolDown, LIMITS.coolDown, d.coolDown),
    intervals: (Array.isArray(c.intervals) ? c.intervals : [])
      .map(i => normalizeInterval(i)).filter(Boolean).slice(0, MAX_INTERVALS),
    repeat: Boolean(c.repeat),
  }
}

export const sameConfig = (a, b) =>
  JSON.stringify(normalizeConfig(a)) === JSON.stringify(normalizeConfig(b))

/* ------------------------------------------------------------- compiling */

/** A round's last stretch of rest, cut where something else follows it or nothing does. */
function dropTrailingRest(items) {
  let end = items.length
  while (end > 0 && items[end - 1].kind !== 'work') end--
  return end === 0 ? items : items.slice(0, end)
}

/**
 * A config as the list of segments it runs through, in order.
 *
 * The rest after a set's last round is dropped where the rest between sets
 * replaces it, and after the very last round, where there is nothing left to
 * rest for. With `repeat`, the end of the last set behaves like the end of any
 * other and the run goes back to `loopFrom` (the first segment after the
 * count-in), so a lap never counts you in twice.
 */
export function compile(config) {
  const c = normalizeConfig(config)
  const round = c.intervals.length
    ? c.intervals
    : [{ kind: 'work', seconds: c.work }, ...(c.rest > 0 ? [{ kind: 'rest', seconds: c.rest }] : [])]

  const segments = []
  const push = (item, at) => segments.push({
    kind: item.kind,
    name: item.name || KIND_LABEL[item.kind],
    seconds: item.seconds ?? null,
    note: item.note || null,
    ...at,
  })

  if (c.countIn > 0) push({ kind: 'countin', seconds: c.countIn }, { round: 1, rounds: c.rounds, set: 1, sets: c.sets })
  const loopFrom = c.repeat ? segments.length : null

  for (let set = 1; set <= c.sets; set++) {
    const lastSet = set === c.sets && !c.repeat
    const setGap = !lastSet && c.setRest > 0
    for (let r = 1; r <= c.rounds; r++) {
      const items = r === c.rounds && (lastSet || setGap) ? dropTrailingRest(round) : round
      for (const item of items) push(item, { round: r, rounds: c.rounds, set, sets: c.sets })
    }
    if (setGap) push({ kind: 'setrest', seconds: c.setRest }, { round: c.rounds, rounds: c.rounds, set, sets: c.sets })
  }
  if (!c.repeat && c.coolDown > 0) {
    push({ kind: 'cooldown', seconds: c.coolDown }, { round: c.rounds, rounds: c.rounds, set: c.sets, sets: c.sets })
  }
  segments.forEach((s, i) => { s.index = i })
  return { segments, loopFrom }
}

/** The whole timer's length, or null where it cannot be known (a count-up, or repeat). */
export function totalSeconds(program) {
  if (program.loopFrom != null) return null
  let sum = 0
  for (const s of program.segments) {
    if (s.seconds == null) return null
    sum += s.seconds
  }
  return sum
}

/* ------------------------------------------------------------------ a run */

/*
 * A run is:
 *
 *   startedAt   the instant Start was pressed
 *   index       the segment on screen
 *   lap         1, 2, 3… with repeat
 *   at          the instant that segment began, moved later by every pause
 *   extra       seconds added (or taken off) the segment with +/-
 *   pausedAt    the instant it was paused, or null
 *   pausedMs    time spent paused before now, so elapsed is time worked
 *   finishedAt  the instant it ran out, or null
 *
 * Every function takes a run and returns one, and returns the SAME object when
 * nothing changed, so a caller can tell a transition from a repaint.
 */
export function startRun(program, now) {
  const empty = !program.segments.length
  return { startedAt: now, index: 0, lap: 1, at: now, extra: 0, pausedAt: null, pausedMs: 0, finishedAt: empty ? now : null }
}

const clockOf = (run, now) => (run.pausedAt != null ? run.pausedAt : now)

/** Move on from the segment on screen, the new one starting at `at`. */
function enterNext(program, run, at) {
  const n = program.segments.length
  if (run.index + 1 < n) return { ...run, index: run.index + 1, at, extra: 0 }
  if (program.loopFrom != null && program.loopFrom < n) {
    return { ...run, index: program.loopFrom, lap: run.lap + 1, at, extra: 0 }
  }
  return { ...run, index: n, at, extra: 0, finishedAt: at }
}

const endOf = (seg, run) => run.at + (seg.seconds + run.extra) * 1000

/**
 * Where the run is at `now`.
 *
 * Every segment that ran out is stepped over, and the next one starts at the
 * instant the last one ENDED, not at `now`. That is the whole of surviving a
 * background tab: ten minutes asleep is just more segments stepped over here.
 */
export function settle(program, run, now) {
  if (!run || run.finishedAt != null) return run
  const t = clockOf(run, now)
  let r = run
  for (let guard = 0; guard < 100000; guard++) {
    const seg = program.segments[r.index]
    if (!seg || seg.seconds == null) break
    const end = endOf(seg, r)
    if (end > t) break
    r = enterNext(program, r, end)
    if (r.finishedAt != null) break
  }
  return r
}

export function pause(program, run, now) {
  const r = settle(program, run, now)
  if (r.pausedAt != null || r.finishedAt != null) return r
  return { ...r, pausedAt: now }
}

/** Resuming moves the segment's start later by however long it sat paused. */
export function resume(program, run, now) {
  if (run.pausedAt == null) return run
  const held = Math.max(0, now - run.pausedAt)
  return { ...run, at: run.at + held, pausedMs: run.pausedMs + held, pausedAt: null }
}

export const togglePause = (program, run, now) =>
  run.pausedAt != null ? resume(program, run, now) : pause(program, run, now)

/**
 * Straight to the next segment, with its full time. A paused run stays paused:
 * skipping through the rest of a sequence to look at it should not start it.
 */
export function skip(program, run, now) {
  const r = settle(program, run, now)
  if (r.finishedAt != null) return r
  const t = clockOf(r, now)
  return enterNext(program, r, t)
}

/**
 * A music player's back button: the first few seconds of a segment go to the
 * one before it, any later restarts this one. From the finish it returns to the
 * last segment.
 */
export const BACK_GRACE = 3
export function back(program, run, now) {
  const r = settle(program, run, now)
  const n = program.segments.length
  if (!n) return r
  if (r.finishedAt != null) {
    return { ...r, index: n - 1, at: now, extra: 0, finishedAt: null, pausedAt: null }
  }
  const t = clockOf(r, now)
  const into = (t - r.at) / 1000
  if (into > BACK_GRACE) return { ...r, at: t, extra: 0 }
  if (r.index > 0 && !(program.loopFrom != null && r.index === program.loopFrom && r.lap > 1)) {
    return { ...r, index: r.index - 1, at: t, extra: 0 }
  }
  if (program.loopFrom != null && r.lap > 1) return { ...r, index: n - 1, lap: r.lap - 1, at: t, extra: 0 }
  return { ...r, at: t, extra: 0 }
}

/** +/- on the segment on screen. Never takes it below a second left. Count-ups have nothing to bump. */
export function bump(program, run, now, delta) {
  const r = settle(program, run, now)
  const seg = program.segments[r.index]
  if (!seg || seg.seconds == null || r.finishedAt != null) return r
  const t = clockOf(r, now)
  const floor = (t + 1000 - r.at) / 1000 - seg.seconds
  return { ...r, extra: Math.max(r.extra + delta, floor) }
}

/** Everything the run screen draws, at `now`. Call `settle` first; this only reads. */
export function view(program, run, now) {
  const t = clockOf(run, now)
  const elapsed = Math.max(0, ((run.finishedAt ?? t) - run.startedAt - run.pausedMs) / 1000)
  if (run.finishedAt != null) {
    return { finished: true, segment: null, next: null, left: null, counted: 0, duration: null, progress: 1, paused: false, lap: run.lap, elapsed }
  }
  const segment = program.segments[run.index]
  const counted = Math.max(0, (t - run.at) / 1000)
  const duration = segment.seconds == null ? null : segment.seconds + run.extra
  const left = duration == null ? null : Math.max(0, duration - counted)
  const next = program.segments[run.index + 1]
    || (program.loopFrom != null ? program.segments[program.loopFrom] : null)
  return {
    finished: false, segment, next, left, counted, duration,
    progress: duration ? Math.min(1, counted / duration) : null,
    paused: run.pausedAt != null, lap: run.lap, elapsed,
  }
}

/** Which cue marks arriving somewhere. Names are lib/cues' CUES. */
export function cueFor(program, run) {
  if (run.finishedAt != null) return 'finished'
  const kind = program.segments[run.index]?.kind
  return kind === 'countin' ? 'countIn' : kind === 'work' ? 'work' : kind ? 'rest' : null
}

/** Did the run move to a different segment (or finish) between two readings? */
export const moved = (a, b) =>
  a.index !== b.index || a.lap !== b.lap || a.finishedAt !== b.finishedAt

/* -------------------------------------------------------------- display */

/** "45s", "1:30", "20:00". */
export const secondsLabel = (s) => {
  if (s == null) return 'open'
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

/**
 * The next value a seconds stepper lands on: 5s steps under a minute, 15s to
 * five minutes, 30s to ten, whole minutes above. Snaps to the grid, so a value
 * that arrived off it (from a plan) steps onto it rather than staying odd.
 */
export function stepSeconds(value, dir) {
  const size = (x) => (x < 60 ? 5 : x < 300 ? 15 : x < 600 ? 30 : 60)
  const v = Math.max(0, Math.round(Number(value) || 0))
  if (dir > 0) { const s = size(v); return Math.floor(v / s) * s + s }
  if (v <= 0) return 0
  const s = size(v - 1)
  return Math.ceil(v / s) * s - s
}

/** One line saying what a config is, for the setup screen and the preset list. */
export function describe(config) {
  const c = normalizeConfig(config)
  const round = c.intervals.length
    ? `${c.intervals.length} interval${c.intervals.length === 1 ? '' : 's'}`
    : `${secondsLabel(c.work)} work${c.rest ? ` · ${secondsLabel(c.rest)} rest` : ''}`
  const rounds = c.rounds > 1 ? `${c.rounds} × ` : ''
  const sets = c.sets > 1 ? `${c.sets} sets of ` : ''
  return `${sets}${rounds}${round}${c.repeat ? ' · repeats' : ''}`
}

/* ---------------------------------------------- the plan's timers as presets */

const KIND_OF_PHASE = { countin: 'countin', work: 'work', represt: 'rest', setrest: 'setrest' }

/**
 * A session's declared timers, as a preset.
 *
 * Walks the session exactly as workout mode does (lib/workout.js:
 * startOf → advancePhase → afterSet) and writes down every phase that has a
 * clock. The one thing it leaves out is workout mode's review, because that is
 * where a set gets LOGGED, and the general timer logs nothing: the climbing set
 * log stays workout mode's. A rest the plan does not state stays a count-up.
 *
 * Null for a session with nothing to step through, or no clock in it at all.
 */
export function sessionTimer(session, out = {}) {
  const steps = buildSteps(session, out)
  if (!steps.length) return null
  const intervals = []
  let pos = startOf(0, steps, { lead: LEAD_IN })
  for (let guard = 0; guard < 5000 && pos.phase !== 'finished'; guard++) {
    if (pos.phase === 'review') { pos = afterSet(pos, steps); continue }
    const s = steps[pos.index]
    const kind = KIND_OF_PHASE[pos.phase]
    const reps = s.timing.reps > 1 ? ` · ${s.repName} ${pos.rep} of ${s.timing.reps}` : ''
    intervals.push({
      kind,
      ...(kind === 'work' ? { name: s.exName } : {}),
      seconds: pos.seconds || null,
      note: `${s.exName} · set ${s.setIndex + 1} of ${s.setCount}${kind === 'work' || kind === 'rest' ? reps : ''}`,
    })
    pos = advancePhase(pos, steps)
  }
  if (!intervals.some(i => i.seconds != null && i.kind !== 'countin')) return null
  return {
    id: `session-${session.id}`,
    name: session.name,
    fromPlan: true,
    config: { ...DEFAULT_CONFIG, countIn: 0, rounds: 1, sets: 1, coolDown: 0, intervals },
  }
}

/* ------------------------------------------------------------- presets */

/*
 * Saved presets live in the person's own log, one undated entry each
 * (`kind: 'timer'`), the way gear does. That makes them per person (each
 * person's log is their own file), synced like everything else, and merged
 * per preset: renaming one on the phone while saving another on the laptop
 * keeps both, which one settings blob for all of them would not. Deleting is
 * the store's ordinary tombstone. No existing entry is touched.
 *
 * The one-tap default is `timer-last`: the last config started, rewritten
 * only when Start runs something different from it.
 */
export const TIMER_KIND = 'timer'
export const LAST_TIMER_ID = 'timer-last'

export const newTimerId = () =>
  `timer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

export const buildTimerEntry = (id, name, config) => ({
  id,
  kind: TIMER_KIND,
  // Undated on purpose: a preset did not happen on a day.
  date: null,
  data: { name: String(name || '').trim().slice(0, 40) || 'Timer', config: normalizeConfig(config) },
})

export const buildLastTimerEntry = (name, config) => buildTimerEntry(LAST_TIMER_ID, name, config)

/** The saved presets, by name. */
export function savedTimers(entries = []) {
  return entries
    .filter(e => e?.kind === TIMER_KIND && !e.deleted && e.id !== LAST_TIMER_ID && e.data?.config)
    .map(e => ({ id: e.id, name: e.data.name || 'Timer', config: normalizeConfig(e.data.config), saved: true }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The last timer started, or null. */
export function lastTimer(entries = []) {
  const e = entries.find(x => x?.id === LAST_TIMER_ID && x.kind === TIMER_KIND && !x.deleted)
  return e?.data?.config ? { id: LAST_TIMER_ID, name: e.data.name || 'Last used', config: normalizeConfig(e.data.config) } : null
}

/**
 * Every preset the setup screen offers, the default first: the plan's own
 * timers for the workout it was opened from, then the last one run, then
 * the person's saved ones, then the shipped ones.
 */
export function presetList(entries = [], sessionPresets = []) {
  const last = lastTimer(entries)
  return [
    ...sessionPresets.filter(Boolean),
    ...(last ? [last] : []),
    ...savedTimers(entries),
    ...BUILT_INS,
  ]
}

/* -------------------------------------------------- a run that survives */

/*
 * A running timer is kept on the device, not in the log: it is a clock, not a
 * record, and two phones should not share one. Under a `bushido:` key so
 * signing out takes it with the log (lib/signout.js), one per person so acting
 * as someone else never resumes the owner's.
 */
export const runKeyFor = (personId) =>
  (!personId || personId === 'owner' ? 'bushido:timer-run' : `bushido:timer-run:${personId}`)

export function saveRun(storage, key, doc) {
  try {
    if (doc) storage?.setItem(key, JSON.stringify(doc))
    else storage?.removeItem(key)
  } catch { /* a timer that cannot be saved still runs */ }
}

/** A stored run, or null. A finished one is not resumed, and nor is one left for a day. */
export function loadRun(storage, key, now) {
  try {
    const doc = JSON.parse(storage?.getItem(key) || 'null')
    const r = doc?.run
    if (!r || !Number.isFinite(r.startedAt) || !Number.isFinite(r.at) || r.finishedAt != null) return null
    if (now - r.startedAt > 24 * 3600 * 1000) return null
    const config = normalizeConfig(doc.config)
    const program = compile(config)
    const run = {
      startedAt: r.startedAt, at: r.at,
      index: Math.min(Math.max(0, Math.round(r.index) || 0), Math.max(0, program.segments.length - 1)),
      lap: Math.max(1, Math.round(r.lap) || 1),
      extra: Number(r.extra) || 0,
      pausedAt: Number.isFinite(r.pausedAt) ? r.pausedAt : null,
      pausedMs: Number(r.pausedMs) || 0,
      finishedAt: null,
    }
    return { name: doc.name || 'Timer', title: doc.title || null, config, run }
  } catch {
    return null
  }
}
