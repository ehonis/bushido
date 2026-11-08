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
 *   exercises   optional: a CIRCUIT (issue #68), exercises one after another,
 *               each for `work` (or its own seconds, or reps), `rest` between
 *               them and `roundRest` between rounds; replaces intervals too
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
  roundRest: [0, 3600],
  reps: [1, 999],
}
/** How many named intervals the editor lets you build. A plan's sequence may be longer. */
export const MAX_NAMED = 12
const MAX_INTERVALS = 400
/** How many exercises a circuit holds. */
export const MAX_EXERCISES = 30

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
 * One exercise of a circuit, or null. `reps` makes it a count-up ("tap when
 * done"); `seconds` is its own time; neither means the circuit's `work`. The
 * key is the exercise library's, so the run screen can say what it works.
 */
function normalizeExercise(raw) {
  if (!raw || typeof raw !== 'object') return null
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 80) : ''
  if (!name) return null
  const out = { name }
  const key = typeof raw.key === 'string' ? raw.key.trim() : ''
  if (/^[\w.-]{1,60}$/.test(key)) out.key = key
  // Zero reps or seconds is no override, not the smallest one.
  const reps = Number(raw.reps) > 0 ? clampInt(raw.reps, LIMITS.reps, null) : null
  const seconds = Number(raw.seconds) > 0 ? clampInt(raw.seconds, LIMITS.interval, null) : null
  if (reps != null) out.reps = reps
  else if (seconds != null) out.seconds = seconds
  return out
}

/**
 * Any config, as one the timer can run. Presets are synced data written by
 * whichever version of the app was current, so this never trusts a field.
 *
 * A circuit's two keys (`exercises`, `roundRest`) are there only on a circuit,
 * so every preset saved before circuits normalizes to exactly what it did. A
 * circuit is rounds of its exercises and nothing else: one set, no cool-down,
 * no repeat, because a plan's circuit block has none of them and placing the
 * preset as a plan must not drop part of what it ran (the setup hides them).
 */
export function normalizeConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {}
  const d = DEFAULT_CONFIG
  const exercises = (Array.isArray(c.exercises) ? c.exercises : [])
    .map(x => normalizeExercise(x)).filter(Boolean).slice(0, MAX_EXERCISES)
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
    ...(exercises.length ? {
      sets: 1, coolDown: 0, repeat: false,
      exercises, roundRest: clampInt(c.roundRest, LIMITS.roundRest, 0),
    } : {}),
  }
}

/* ------------------------------------------------------------- circuits */

/*
 * A CIRCUIT (issue #68) is the same timer with exercises in the round: an ab
 * circuit is five exercises, forty seconds each, twenty between them, three
 * rounds. It is set once for the whole circuit and each exercise may say
 * otherwise (its own seconds, or reps). A plan's circuit block carries the
 * timing as `circuit` (lib/prescription.js); a preset carries it as a config
 * with `exercises`. Both run as this one program, so pausing, skipping, going
 * back, a pocket and a reload behave exactly as they do for any timer.
 */
export const CIRCUIT_DEFAULT = Object.freeze({ work: 40, rest: 20, rounds: 3, roundRest: 60, countIn: 10 })

/** A circuit's timing, clamped, or null if it is not one. A rest between rounds nobody gave is none. */
export function normalizeCircuit(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const d = CIRCUIT_DEFAULT
  return {
    work: clampInt(raw.work, LIMITS.work, d.work),
    rest: clampInt(raw.rest, LIMITS.rest, d.rest),
    rounds: clampInt(raw.rounds, LIMITS.rounds, d.rounds),
    roundRest: clampInt(raw.roundRest, LIMITS.roundRest, 0),
    countIn: clampInt(raw.countIn, LIMITS.countIn, d.countIn),
  }
}

/** A circuit's timing and its exercises, as a timer config. */
export function circuitConfig(circuit, exercises = []) {
  const c = normalizeCircuit(circuit) || { ...CIRCUIT_DEFAULT }
  return normalizeConfig({
    ...DEFAULT_CONFIG, countIn: c.countIn, work: c.work, rest: c.rest, rounds: c.rounds,
    sets: 1, coolDown: 0, intervals: [], repeat: false, exercises, roundRest: c.roundRest,
  })
}

/** The other way: a config's circuit timing, for placing a preset as a plan. */
export function circuitOf(config) {
  const c = normalizeConfig(config)
  return { work: c.work, rest: c.rest, rounds: c.rounds, roundRest: c.roundRest || 0, countIn: c.countIn }
}

export const isCircuit = (config) => Boolean(config?.exercises?.length)

/**
 * One round of a circuit: each exercise, the rest between them, and at the end
 * the rest between rounds (or, with none, the ordinary rest), which `compile`
 * cuts after the last round like any round's rest.
 */
function circuitRound(c) {
  const items = []
  c.exercises.forEach((ex, n) => {
    if (n > 0 && c.rest > 0) items.push({ kind: 'rest', seconds: c.rest })
    items.push({
      kind: 'work', name: ex.name,
      // Reps have no clock: a count-up that waits for the tap, like an undeclared rest.
      seconds: ex.reps ? null : (ex.seconds ?? c.work),
      note: ex.reps ? `${ex.reps} reps` : null,
      ex: n, key: ex.key || null, reps: ex.reps || null,
    })
  })
  if (c.roundRest > 0) items.push({ kind: 'rest', name: 'Rest between rounds', seconds: c.roundRest })
  else if (c.rest > 0) items.push({ kind: 'rest', seconds: c.rest })
  return items
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
 *
 * The rest between sets exists only where there ARE sets. With one set there
 * is nothing to rest between, so a repeating timer runs lap into lap on the
 * round's own rest: Tabata on repeat is 20/10 forever, not 20/10 ×8 and then a
 * minute nobody asked for (the stored `setRest` keeps its default either way).
 */
export function compile(config) {
  const c = normalizeConfig(config)
  const round = c.exercises?.length ? circuitRound(c)
    : c.intervals.length ? c.intervals
      : [{ kind: 'work', seconds: c.work }, ...(c.rest > 0 ? [{ kind: 'rest', seconds: c.rest }] : [])]

  const segments = []
  // A circuit's work carries which exercise it is (`ex`, its index), so the run
  // screen can show it and the log can say how long each was done.
  const push = (item, at) => segments.push({
    kind: item.kind,
    name: item.name || KIND_LABEL[item.kind],
    seconds: item.seconds ?? null,
    note: item.note || null,
    ...(item.ex != null ? { ex: item.ex, key: item.key, reps: item.reps, exs: c.exercises.length } : {}),
    ...at,
  })

  if (c.countIn > 0) push({ kind: 'countin', seconds: c.countIn }, { round: 1, rounds: c.rounds, set: 1, sets: c.sets })
  const loopFrom = c.repeat ? segments.length : null

  for (let set = 1; set <= c.sets; set++) {
    const lastSet = set === c.sets && !c.repeat
    const setGap = !lastSet && c.sets > 1 && c.setRest > 0
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
 *   spent       a circuit only: seconds worked on each exercise segment left,
 *               by `<lap>:<index>`, which is what the circuit logs
 *   stopped     a circuit stopped early (`stopRun`)
 *
 * Every function takes a run and returns one, and returns the SAME object when
 * nothing changed, so a caller can tell a transition from a repaint.
 */
export function startRun(program, now) {
  const empty = !program.segments.length
  return { startedAt: now, index: 0, lap: 1, at: now, extra: 0, pausedAt: null, pausedMs: 0, finishedAt: empty ? now : null }
}

const clockOf = (run, now) => (run.pausedAt != null ? run.pausedAt : now)

/**
 * A circuit's exercise segment, booked with the time worked on it up to `at`:
 * the whole of it when it ran out, what was done when it was skipped or tapped.
 * Every other segment, and every timer that is not a circuit, books nothing.
 * Going back to one already done and skipping it again keeps the most worked
 * on it: Back is for looking, and must not unlog forty seconds.
 */
function booked(program, run, at) {
  if (program.segments[run.index]?.ex == null) return run
  const key = `${run.lap}:${run.index}`
  const secs = Math.max(0, (at - run.at) / 1000, Number(run.spent?.[key]) || 0)
  return { ...run, spent: { ...(run.spent || {}), [key]: secs } }
}

/** Move on from the segment on screen, the new one starting at `at`. */
function enterNext(program, run0, at) {
  const run = booked(program, run0, at)
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
 * last segment, and the time spent looking at Done is not time worked: it is
 * booked like a pause.
 */
export const BACK_GRACE = 3
export function back(program, run, now) {
  const r = settle(program, run, now)
  const n = program.segments.length
  if (!n) return r
  if (r.finishedAt != null) {
    const idle = Math.max(0, now - r.finishedAt)
    return { ...r, index: n - 1, at: now, extra: 0, finishedAt: null, pausedAt: null, pausedMs: r.pausedMs + idle }
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

/**
 * Stop a circuit where it is: what was done of the exercise on screen is
 * booked, and the run is finished, as running out would have finished it, so
 * stopping early logs exactly like finishing (issue #68).
 */
export function stopRun(program, run, now) {
  const r = settle(program, run, now)
  if (r.finishedAt != null) return r
  const t = clockOf(r, now)
  return { ...booked(program, r, t), pausedAt: null, finishedAt: t, stopped: true }
}

/**
 * How long an exercise has to have been worked on to count as done. Shorter is
 * a skip, a mis-tap or a look at what comes next, not a set: it is not logged,
 * and a circuit stopped with nothing past it logs nothing at all.
 */
export const DONE_AFTER = 3

/**
 * What a circuit run did, per exercise (by its index in the config): the
 * seconds worked each time it came round, in order, each at least
 * `DONE_AFTER`. Empty lists all round: nothing to log.
 */
export function circuitDone(program, run) {
  const count = program.segments.reduce((n, s) => (s.ex != null ? Math.max(n, s.ex + 1) : n), 0)
  const done = Array.from({ length: count }, () => [])
  const spent = run?.spent || {}
  const keys = Object.keys(spent)
    .map(k => k.split(':').map(Number))
    .filter(([lap, index]) => Number.isFinite(lap) && Number.isFinite(index))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
  for (const [lap, index] of keys) {
    const seg = program.segments[index]
    // Judged on the raw time, so 2.5 s is a skip, not a rounded-up 3.
    const secs = Number(spent[`${lap}:${index}`]) || 0
    if (seg?.ex != null && secs >= DONE_AFTER) done[seg.ex].push(Math.round(secs))
  }
  return done
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
  if (c.exercises?.length) {
    const n = c.exercises.length
    return [
      c.rounds > 1 ? `${c.rounds} rounds` : null,
      `${n} exercise${n === 1 ? '' : 's'}`,
      `${secondsLabel(c.work)} each`,
      c.rest ? `${secondsLabel(c.rest)} rest` : null,
    ].filter(Boolean).join(' · ') + (c.repeat ? ' · repeats' : '')
  }
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
      ...(r.spent && typeof r.spent === 'object' && !Array.isArray(r.spent) ? { spent: r.spent } : {}),
    }
    return { name: doc.name || 'Timer', title: doc.title || null, config, run }
  } catch {
    return null
  }
}

/* ------------------------------------------- the runner's own clocks (#75) */

/*
 * TWO CLOCKS IN THE RUNNER, both kept as instants on the planned workout's run
 * (`data.run`, lib/prescription.js), so a pocket, a reload or the other device
 * lands on the right second, and both pure, with `now` an argument.
 *
 * A TIMED SET (a plank, a 90-second interval: seconds and no reps or distance)
 * runs on this timer, as a circuit of one exercise and one round with a short
 * count-in. That is not a trick to save code: it is exactly a circuit's
 * booking, so what is logged is the seconds actually held (Skip ends a hold
 * early and logs what was done; less than DONE_AFTER is a mis-tap and logs
 * nothing), and Back, ±10, Pause and Skip mean on it what they mean on every
 * other clock in the app. It lives on the run as `hold: { setId, seconds, timer }`.
 */
export const HOLD_COUNT_IN = 5

/** The program a timed set runs: a short count-in, then the seconds asked for. */
export function holdConfig(seconds, { name = 'Hold', key = null } = {}) {
  const s = clampInt(seconds, LIMITS.work, null)
  if (s == null) return null
  return circuitConfig({ work: s, rest: 0, rounds: 1, roundRest: 0, countIn: HOLD_COUNT_IN },
    [{ name, ...(key ? { key } : {}), seconds: s }])
}

/**
 * Does the runner time this set? Seconds asked for, and nothing else counted
 * (`setFieldsFor`), and within what a timer runs (LIMITS.work, 5 s to an
 * hour): a 90-minute ride would be clamped to an hour and logged as one, so
 * outside that it stays a number with Done set.
 *
 * @param {string[]} [fields] @param {{ seconds?: any } | null} [set]
 */
export const isTimedSet = (fields = [], set = null) =>
  fields.includes('seconds') && !fields.includes('reps') && !fields.includes('distance') &&
  Number(set?.seconds) >= LIMITS.work[0] && Number(set.seconds) <= LIMITS.work[1]

/** The hold running on this set, or null. */
export const holdOn = (run, setId) =>
  (setId && run?.hold?.setId === setId && run.hold.timer && Number(run.hold.seconds) > 0 ? run.hold : null)

/** Start the clock on a timed set. The run's other fields are untouched; the caller passes a run. */
export function startHold(run, setId, seconds, now, { name, key } = {}) {
  const config = holdConfig(seconds, { name, key })
  if (!run || !config) return run
  return { ...run, startedAt: run.startedAt || now, hold: { setId, seconds: config.work, timer: startRun(compile(config), now) } }
}

/** The seconds a finished hold logs, or null when nothing counts as done. */
export function heldSeconds(program, timer) {
  if (timer?.finishedAt == null) return null
  const done = circuitDone(program, timer)[0] || []
  return done.length ? done[0] : null
}

/*
 * THE RUNNER'S REST, PAUSED. The rest is `restUntil` (an instant); a pause is
 * `restPause: { until, at }`, naming the rest it belongs to by that deadline.
 * Marking the next set writes a new `restUntil`, so a pause left behind by a
 * rest that has since been replaced is ignored rather than freezing the next.
 */
export const restPausedAt = (run) =>
  (run?.restUntil && run.restPause && run.restPause.until === run.restUntil ? run.restPause.at : null)

/** Seconds of rest left at `now`, standing still while paused. */
export function restClock(run, now) {
  if (!run?.restUntil) return 0
  const t = restPausedAt(run) ?? now
  return Math.max(0, Math.ceil((run.restUntil - t) / 1000))
}

export function pauseRest(run, now) {
  if (!run?.restUntil || restPausedAt(run) != null || run.restUntil <= now) return run
  return { ...run, restPause: { until: run.restUntil, at: now } }
}

/**
 * Resuming moves the deadline later by however long it sat paused. Only the
 * deadline: `restFrom` is the instant the set that started the rest was marked,
 * which is how Back finds that set (`restBack`), and a pause does not move it.
 */
export function resumeRest(run, now) {
  const at = restPausedAt(run)
  if (at == null) return run
  const held = Math.max(0, now - at)
  return { ...run, restUntil: run.restUntil + held, restPause: null }
}

export const toggleRest = (run, now) => (restPausedAt(run) != null ? resumeRest(run, now) : pauseRest(run, now))

/** ±seconds on the rest, never below a second left; a paused rest stays paused. */
export function bumpRest(run, now, delta) {
  if (!run?.restUntil) return run
  const paused = restPausedAt(run)
  const t = paused ?? now
  const until = Math.max(t + 1000, run.restUntil + delta * 1000)
  return {
    ...run, restUntil: until,
    // The rest's length moves with the deadline (not from `restFrom`, which a pause leaves behind).
    restOf: Math.max(0, Math.round((Number(run.restOf) || 0) + (until - run.restUntil) / 1000)),
    ...(paused != null ? { restPause: { until, at: paused } } : {}),
  }
}

/**
 * Back, from a rest: to the set whose mark started it (the one logged at the
 * rest's own start), to look at or correct it. The rest ends; the set stays logged.
 */
export function restBack(run) {
  if (!run?.restUntil) return run
  const owner = Object.entries(run.sets || {}).find(([, v]) => v?.at === run.restFrom)?.[0]
  return { ...run, restUntil: 0, restFrom: 0, restOf: 0, restPause: null, cursor: owner || run.cursor }
}

/**
 * A finished run, reopened (#75). Start reopens a finished workout, and the
 * first thing written in it takes the end off, so it is running again. A write
 * that sets a NEW end (finishing, again) keeps it.
 */
export const reopened = (next, before) =>
  (next?.endedAt && next.endedAt === before?.endedAt ? { ...next, endedAt: null } : next)
