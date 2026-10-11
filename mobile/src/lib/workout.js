/*
 * Workout mode's model: one session, flattened into the list of sets you
 * actually step through in the basement.
 *
 * Pure, and content-driven like everything else. It reads the same two places
 * the rest of the app already reads — `logSpec.exercises`, which is what gets
 * logged set by set, and `protocol.blocks[].timer`, which is how long each piece
 * lasts. Nothing about any particular session is hardcoded here: add an exercise
 * to plan.json and it shows up in workout mode.
 *
 * The two declarations can describe the same work differently, and when they do
 * the LOG wins. Sub-threshold hangs are written in the protocol as one set of
 * five reps, and in the logSpec as five loggable sets, because "hang 4 was
 * short" is a thing worth recording. So the timer contributes DURATIONS only and
 * the logSpec contributes STRUCTURE. That is why `timer.reps` and `timer.sets`
 * are deliberately unused below — they are prose for the reading view, not shape
 * for this one. Leave them be rather than "fixing" the redundancy.
 *
 * Rest is never invented. Programmed rests can be deliberately longer than
 * textbook (to suit how slowly a given athlete recovers), so a rest this file cannot
 * source from the plan is shown as a count-UP clock with no target, rather than
 * a countdown to a number somebody made up.
 */

/**
 * A block's declared intervals, as a list.
 *
 * One block, one timer was true until a block turned out to drive more than one
 * logged exercise: the twenty pulls are a single paragraph of protocol covering
 * three grip families, and splitting the prose into three blocks to carry three
 * timers would be letting the timer dictate how the session reads. So a block
 * may carry `timers: [...]` instead of `timer: {...}`, and both mean the same
 * thing here.
 */
export function blockTimers(block) {
  if (Array.isArray(block?.timers)) return block.timers
  return block?.timer ? [block.timer] : []
}

/** The declared interval for one logged exercise, or null if it has none. */
export function exerciseTimer(session, exKey) {
  for (const b of session?.protocol?.blocks || []) {
    for (const t of blockTimers(b)) if (t.exercise === exKey) return t
  }
  return null
}

/**
 * A number, or null.
 *
 * `null` in the plan means "not known yet" — a repeater load nobody has set, an
 * economy lap with no target duration — and `Number(null)` is 0, which would
 * turn every one of those into a zero-second countdown. Absent is not zero.
 */
const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * How long each piece of one exercise lasts.
 *
 *   work     seconds of a single rep, or null for "tap when you're done"
 *   reps     reps inside one set — 1 unless the clock can actually count them
 *   repRest  recovery between reps inside a set (only meaningful when reps > 1)
 *   setRest  recovery before the next set of the SAME exercise, or null
 *   nextRest recovery before the next EXERCISE, or null
 */
export function timingFor(exercise, timer, out = {}) {
  const fields = exercise?.fields || []
  const defaults = exercise?.defaults || {}

  const work = num(timer?.work) ?? (fields.includes('seconds') ? num(defaults.seconds) : null)
  const repRest = num(timer?.rest)

  /*
   * Reps inside a set are something the CLOCK does, so an exercise with no work
   * interval has one of them however many the log records.
   *
   * Twelve press-ups are twelve reps in the log and one continuous set on the
   * screen — you do them at your own pace and mark the set. Counting them here
   * instead drew twelve rep pips on a clock with nothing to advance it, so the
   * timer sat on "rep 1 of 12" forever and the only way out was Skip. That is
   * exactly what Abrahangs did before it had a timer at all.
   */
  const reps = (work && fields.includes('reps')) ? (num(defaults.reps) || 1) : 1

  // A declared setRest of 0 means "not stated here" rather than "no rest" —
  // sub-threshold hangs put their 60 seconds on `rest` and leave setRest at 0.
  // Failing that, a session that logs its own rest (the 4x4s) is the next best
  // source, and it is a real measurement rather than a guess.
  const declared = num(timer?.setRest)
  const setRest = (declared && declared > 0) ? declared
    : (repRest && reps === 1) ? repRest
    : num(out?.setRest) || null

  // The gap on the way OUT of this exercise. Only ever what the plan states —
  // moving between exercises usually has no number behind it and counts up.
  const nextRest = num(timer?.nextRest) || null

  return { work, reps, repRest, setRest, nextRest }
}

/**
 * What a set's `seconds` field should read when you finish it.
 *
 * Stated beats measured beats blank, the same order `minutesFor()` uses. Where
 * the plan declares a work interval that number IS the set — a 7-second hang is
 * seven seconds whatever the clock did. Where it does not, the phase counted UP
 * and already knows exactly how long the set took, so asking them to read it off
 * the screen and type it is pure friction.
 *
 * Board intervals are the case this exists for: the session's own check on
 * whether the dose was right is "interval 4 within 10–15% of interval 1", and
 * that check is worth nothing if the intervals do not get logged. Only the work
 * phase is measured — time spent in review or resting is not the set.
 */
export function loggedSeconds(timing, { phase, measured } = {}) {
  if (timing?.work) return timing.work
  if (phase !== 'work') return null
  const s = Math.round(num(measured) ?? 0)
  return s > 0 ? s : null
}

/**
 * Values for set `i`: what you logged, else the set before it, else the plan.
 *
 * The optional per-climb detail (`climbs`) is carried too, and by a stricter
 * rule: only ever from the set's OWN row, never from the set before it. Two
 * reasons, and they pull the same way. A set already carrying climbs must keep
 * them — a review screen that drops the field silently deletes it on commit,
 * because `writeSet` replaces the row with exactly what it is handed. And a
 * climb record must never be inherited: the board's three problems repeat every
 * interval, so copying forward would be convenient for the grade and a lie
 * about the fall, and a fall the log invented is worse than a grade re-picked.
 */
function rowValues(exercise, rows, i) {
  const fields = exercise?.fields || []
  const source = rows[i] || rows[i - 1] || exercise?.defaults || {}
  const out = {}
  for (const f of fields) {
    const v = source[f]
    out[f] = v === null || v === undefined ? '' : v
  }
  if (Array.isArray(rows[i]?.climbs)) out.climbs = rows[i].climbs
  return out
}

/**
 * Every set of every exercise, in the order you do them.
 *
 * Set count comes from the prescription but grows to fit what you logged, so a
 * session where you did four instead of three still steps through all four.
 */
export function buildSteps(session, out = {}) {
  const exercises = session?.logSpec?.exercises || []
  const stored = out?.sets || {}
  const steps = []

  for (const [exIndex, ex] of exercises.entries()) {
    const rows = Array.isArray(stored[ex.key]) ? stored[ex.key] : []
    const setCount = Math.max(Number(ex.defaultSets) || 1, rows.length)
    const timing = timingFor(ex, exerciseTimer(session, ex.key), out)

    for (let i = 0; i < setCount; i++) {
      steps.push({
        id: `${ex.key}:${i}`,
        exKey: ex.key,
        exName: ex.name,
        exIndex,
        setIndex: i,
        setCount,
        fields: ex.fields || [],
        // What one rep of this is called, for the screens that label reps — a
        // rep of a double is a lap. The plan's word, not the app's.
        repName: ex.repName || 'rep',
        // How to actually do it, straight off the exercise. Workout mode shows
        // this on the countdown and one tap away for the rest of the set.
        how: ex.how || null,
        // The plan's offer of per-climb detail, if it makes one — grade, style,
        // fell, felt, one record per rep. Carried here so the review screen can
        // offer it MID-session on the board, rather than only in the set log
        // afterwards. Null on every exercise that does not offer it.
        climbLog: ex.climbLog || null,
        // Signs sit beside `sets` in the log, not inside it — see SetLog.
        sign: out?.signs?.[ex.key] ?? ex.defaults?.sign ?? '+',
        values: rowValues(ex, rows, i),
        logged: Boolean(rows[i]),
        timing,
      })
    }
  }
  return steps
}

/**
 * Is workout mode the right tool for this session?
 *
 * IT EXISTS TO RUN A CLOCK. Where the plan states no interval of any kind, there
 * is no clock to run and the mode is a full-screen wrapper around a set log: every
 * phase counts up, nothing advances on its own, and the only thing it adds over
 * the ordinary log is a screen you have to get out of. Doubled lead laps are the
 * case that made this obvious — five minutes between doubles is real, but the user is not
 * standing at a wall driving a timer through it, and the session gets logged
 * afterwards from memory like most on-the-wall work does.
 *
 * So the offer is derived from what the plan DECLARES rather than from whether a
 * logSpec exists:
 *
 *   - any `timer`/`timers` on a protocol block — the session states an interval,
 *     whether that is a 7-second hang counting down or a board interval counting
 *     UP so its length gets logged (which is the check the board session's own
 *     dose depends on);
 *   - or a rest the session logs for itself, which is how the 4×4s get a countdown
 *     from `out.setRest` with no timer declared anywhere.
 *
 * Add a `timer` to a session in plan.json and it gains the mode with no code
 * change; that is the intended way to turn one on. `logSpec.workout: false` forces
 * it off for a session that declares a clock the user does not want driven, and `true`
 * forces it on — the escape hatch exists because "would this help" is a judgement
 * about how the user actually trains, and the interval is only a proxy for it.
 */
export function hasWorkout(session) {
  if (!(session?.logSpec?.exercises?.length > 0)) return false
  const declared = session.logSpec.workout
  if (typeof declared === 'boolean') return declared
  if ((session.protocol?.blocks || []).some(b => blockTimers(b).length > 0)) return true
  return (session.outputs || []).some(o => o?.key === 'setRest')
}

/**
 * Write one set back into the shape `SetLog` already uses, so everything
 * downstream — totalReps, topLoad, the charts, the history editor — keeps
 * working with no idea workout mode exists.
 */
export function writeSet(out, exKey, setIndex, values) {
  const sets = { ...(out?.sets || {}) }
  const rows = Array.isArray(sets[exKey]) ? [...sets[exKey]] : []
  while (rows.length <= setIndex) rows.push({})
  const row = {}
  for (const [k, v] of Object.entries(values)) {
    // A per-rep field is a LIST — a grade per lap. `Number([10.1, 10.2])` is NaN,
    // so an array is written through entry by entry rather than coerced whole.
    // An entry that is itself a RECORD (a fun day's per-climb detail) passes
    // through untouched: Number({grade: 4}) is NaN too, and half its keys are
    // not numbers to begin with.
    if (Array.isArray(v)) {
      row[k] = v.map(x => {
        if (x && typeof x === 'object') return x
        return x === '' || x === null || x === undefined ? '' : Number(x)
      })
      continue
    }
    row[k] = v === '' || v === null || v === undefined ? '' : Number(v)
  }
  rows[setIndex] = row
  sets[exKey] = rows
  return { ...out, sets }
}

/** Drop every set from `setIndex` on — "I stopped after this one". */
export function truncateSets(out, exKey, setIndex) {
  const sets = { ...(out?.sets || {}) }
  const rows = Array.isArray(sets[exKey]) ? [...sets[exKey]] : []
  if (rows.length <= setIndex) return out
  sets[exKey] = rows.slice(0, setIndex)
  return { ...out, sets }
}

/* ------------------------------------------------------------- sequencing */

/**
 * Where the workout goes next.
 *
 * Pulled out of the component and kept pure on purpose. This is the part that
 * is genuinely easy to get wrong and impossible to eyeball — a phase that
 * silently skips a set is the kind of bug you only find out about afterwards,
 * from a log that says you did four repeater sets when you did three. Covered
 * set by set in workout.test.js.
 *
 * `seconds` is the countdown for the phase being entered. Zero means it counts
 * UP with no target and waits for a tap; see the note at the top of this file
 * about not inventing rests.
 */
/**
 * Getting ready is not resting, so these are the app's numbers rather than the
 * plan's — the plan's rests are a dose and are never invented (see the header).
 *
 * Two of them because the two moments are not the same. Between sets you have
 * just spent minutes sitting down and only need long enough to get back on the
 * rung. Pressing Start, you are holding the phone: you still have to chalk up,
 * hang the counterweight and get set, and the old three seconds meant the first
 * rep of the session began while you were still putting the phone down.
 */
export const COUNT_IN = 5
export const LEAD_IN = 20

/** Entering a set — with a few seconds to get your hands on the rung first. */
export function startOf(index, steps, { lead = COUNT_IN } = {}) {
  if (index < 0 || index >= steps.length) {
    return { phase: 'finished', rep: 1, index: steps.length, seconds: 0 }
  }
  const t = steps[index].timing
  return t.work
    ? { phase: 'countin', rep: 1, index, seconds: Math.max(1, lead) }
    : { phase: 'work', rep: 1, index, seconds: 0 }
}

/** What happens when the phase on screen runs out of time. */
export function advancePhase({ phase, rep, index }, steps) {
  const t = steps[index]?.timing || { reps: 1, work: null, repRest: null }
  switch (phase) {
    case 'countin':
      return { phase: 'work', rep: 1, index, seconds: t.work || 0 }
    case 'work':
      return rep < t.reps
        ? { phase: 'represt', rep, index, seconds: t.repRest || 0 }
        : { phase: 'review', rep, index, seconds: 0 }
    case 'represt':
      return { phase: 'work', rep: rep + 1, index, seconds: t.work || 0 }
    // The set index moved forward when the rest began, so this starts the set
    // the rest was FOR. Advancing again here would skip it.
    case 'setrest':
      return startOf(index, steps)
    default:
      return { phase, rep, index, seconds: 0 }
  }
}

/**
 * Where marking a set done takes you. `last` is "that was my last set of this
 * exercise" — it jumps to the next exercise rather than the next set.
 */
export function afterSet({ index }, steps, { last = false } = {}) {
  const cur = steps[index]
  if (!cur) return { phase: 'finished', rep: 1, index: steps.length, seconds: 0 }

  const next = last ? steps.findIndex(s => s.exIndex > cur.exIndex) : index + 1
  if (next === -1 || next >= steps.length) {
    return { phase: 'finished', rep: 1, index: steps.length, seconds: 0 }
  }
  // `setRest` only covers sets of the SAME exercise. Crossing into a different
  // one usually has no number behind it and counts up — swapping hands on the
  // peak force test is three minutes nobody wrote down. Where the plan does
  // state the gap it says so with `nextRest`, and then it runs itself: the
  // twenty pulls are one 10-on/20-off metronome straight through all three
  // grip families, so stopping dead between them was never the protocol.
  const seconds = steps[next].exIndex === cur.exIndex
    ? (cur.timing.setRest || 0)
    : (cur.timing.nextRest || 0)
  return { phase: 'setrest', rep: 1, index: next, seconds }
}

/**
 * A declared work interval in words, for the list you read before you start.
 *
 * Seconds are the plan's unit and the right label for a 7-second hang. They stop
 * being readable somewhere past a minute: an ARC bout is 1200 seconds, and
 * "2 × 1200s" is a number you have to do arithmetic on while standing in a gym.
 * Minutes from two minutes up, seconds below.
 */
export const interval = (seconds) =>
  seconds >= 120 ? `${Math.round(seconds / 60)} min` : `${seconds}s`

/** mm:ss, or h:mm:ss once a gym session runs long. */
export function clock(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(h ? 2 : 1, '0')
  return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`
}

/** Minutes between two instants, rounded, never negative. */
export function elapsedMinutes(startedAt, endedAt = Date.now()) {
  const start = typeof startedAt === 'string' ? Date.parse(startedAt) : startedAt
  if (!Number.isFinite(start)) return null
  return Math.max(0, Math.round((endedAt - start) / 60000))
}
