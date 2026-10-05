/*
 * What should you actually do today?
 *
 * The week's QUOTAS are the prior, not a schedule. They say the week wants two
 * power-endurance sessions, three rides and a swim; they say nothing about which
 * day each lands on. This module recomputes the recommendation from what has
 * actually been logged: what each quota category still owes, how many hard finger
 * days the week has spent, when the last one was, how long since the user went hard in
 * each discipline, and how the fingers, skin and RPE have been reading.
 *
 * Everything is a weighted term with a sentence attached, so the answer can
 * always explain itself. FOUR things are not weights but hard blocks:
 *
 *   1. Hard finger days never go back to back  (recommender.hardMinGapDays)
 *   2. No more than N hard finger days in a plan week  (recommender.hardCap)
 *   3. You cannot do a gym session in your kitchen  (check-in `informs: venue`)
 *   4. You cannot do 75 minutes of work in 50 minutes  (`informs: window`)
 *
 * The first two are the rules that can genuinely injure them, and they stayed hard
 * through the 2026-09-14 pivot when the user was asked directly and said so: everything
 * else became advisory, these did not. They are counted on what the user LOGGED — and
 * since that pivot every card that can load the fingers ASKS, so an easy board
 * night costs nothing and a social night the user projected through costs a full
 * exposure. See `isHardEntry`, which is the most load-bearing predicate here.
 *
 * The second two are facts about whether a session can happen at all, and today's
 * check-in is where the user states them. Absent, nothing is assumed — the app no longer
 * guesses their evening from the weekday, because `hotspotDays` was that guess and
 * it cost every gym session 22 points on five days a week.
 *
 * WHAT THIS FILE USED TO BE. Until 2026-09-14 the prior was a `weekTemplate`
 * naming one session per weekday per branch, and the day was three BRANCHES —
 * at the gym, at home, not climbing. Both are gone. The template's failure was
 * structural: Thursday WAS the board day, so a Thursday the user could not make cost the
 * board session rather than moving it, and `templateDebt` only ever half-papered
 * over that. Quotas say how many of each kind the week wants and leave the days
 * alone. Branches asked "where are you"; the board asks "what does the week still
 * owe", which is the question a two-achievement, multi-sport model makes primary.
 *
 * A day is a list of sessions, so the advice for a day is a list too: one main
 * session, plus whatever genuinely rides along with it — see `companions()`. A
 * quota counts WORKOUTS, so a day holding a ride and a lift fills two.
 *
 * The coach note is one more weighted term, and nothing more than that. Its
 * nudges are read below the hard blocks and clamped to `recommender.coachCap`,
 * so a coach note can lean on the answer but can never produce an illegal one.
 * See lib/coach.js.
 *
 * Every number lives in content/plan.json under `recommender`, and every session
 * describes itself under `sched` and `category`. No training policy is hardcoded
 * here — this file only knows how to weigh what the plan declares.
 */

import { fromIso } from './dates.js'
import { isDone, isRepeatable, isTraining } from './store.js'
import { mondayOf, weekDays, progress as quotaProgress, disciplineOf, disciplineOfOption } from './quota.js'
import { optFor } from './menu.js'
import { nudges as coachNudges } from './coach.js'
import { dayFacts, venuePhrase, PLACEMENT_ACTIONS } from './checkin.js'
import { achievements, achievementOf } from './achievements.js'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Fallbacks, so a plan.json without a `recommender` block still behaves. */
const DEFAULTS = {
  hardCap: 3,
  hardMinGapDays: 2,
  hardTarget: 2,
  restAfterDays: 6,
  tiredRpe: 7.5,
  soreFingers: 4,
  hurtFingers: 5,
  soreSkin: 4,
  maxCompanions: 2,     // most extra sessions a day is ever advised to carry
  // Days the user would rather leave between HARD efforts in one discipline. Advisory
  // everywhere — only the finger rules block. Legs and fingers are separate
  // systems, so a hard ride says nothing at all about a board session.
  disciplineGap: { climbing: 2, run: 2, bike: 1, swim: 1, lift: 2, support: 0, other: 0 },
  // The whole-body ceiling, in RPE x minutes over the trailing week. Set from
  // their own logged weeks rather than a textbook — see recommender.ceiling.
  ceiling: { lookbackDays: 7, softLoad: 2800, hardLoad: 3300 },
  companionMin: 14,     // a companion has to be owed, not merely legal
  companionMinutes: 45, // total extra time, on top of the main session
  coachCap: 18,         // most a coach note can move any one session
  // What a WHOOP reading may move a session by, and where the thresholds sit.
  // Capped BELOW the coach: a physiological reading of how the user slept is a weaker
  // claim about what to train than a note that read the whole log, and score gaps
  // in a normal day run to forty.
  whoop: {
    cap: 12,            // most any WHOOP reading can move one session
    lowRecovery: 34,    // WHOOP's own red band
    highRecovery: 67,   // WHOOP's own green band
    hrvDrop: -10,       // % under their own median that counts as suppressed
  },
  weights: {
    quotaOwed: 24,          // this session's category still owes workouts this week
    quotaNearlyDone: 8,     // ...and more so when it is the last one outstanding
    quotaFull: -20,         // its category is already filled and something else is owed
    noQuota: -6,            // nothing this week asked for this category at all
    disciplineSpacing: -15, // a hard effort too soon after the last in this discipline
    disciplineRested: 9,    // ...and the bonus for one that has had its gap
    ceilingSoft: -10,       // the trailing week is past their 75th-percentile load
    ceilingHard: -22,       // ...and past their heaviest week
    hardDue: 26,        // the week is behind on hard exposures
    spacing: 7,         // per day of recovery past the minimum gap, capped
    weeklyDue: 16,      // this session's own weekly target isn't met
    repeat: -16,        // you did this one too recently
    dayAfterHard: -20,  // any finger load the day after a hard finger day
    recoveryFit: 14,    // non-finger work the day after a hard finger day
    sore: -26,          // finger load while the fingers are reading sore
    soreRelief: 12,     // non-finger work while the fingers are reading sore
    skin: -12,          // skin-hungry work on shredded skin
    mutex: -30,         // conflicts with something already on today
    onDay: -50,         // already on today
    easyWhenTired: 8,   // easy work when the last few days have been heavy
    hurt: -40,          // you logged "something hurts" — everything waits
    overreached: -18,   // days on end, all of them heavy
    budgetRisk: -14,    // could turn into a hard day you can't afford
    stale: 0.8,         // per day since you last did it, capped
    staleCap: 8,
    restBase: 8,        // rest is always available, never the default
    restFit: 18,        // ...unless the body is asking for it
    whoopRed: -12,      // finger/hard load on a genuinely unrecovered morning
    whoopRedRelief: 10, // ...and the easy work that does suit one
    whoopGreen: 8,      // hard work on a morning the athlete is demonstrably ready for
  },
}

export function recConfig(plan) {
  const cfg = plan?.recommender || {}
  return {
    ...DEFAULTS, ...cfg,
    weights: { ...DEFAULTS.weights, ...(cfg.weights || {}) },
    whoop: { ...DEFAULTS.whoop, ...(cfg.whoop || {}) },
    disciplineGap: { ...DEFAULTS.disciplineGap, ...(cfg.disciplineGap || {}) },
    ceiling: { ...DEFAULTS.ceiling, ...(cfg.ceiling || {}) },
  }
}

/*
 * The board: the day as a set of quota LANES.
 *
 * This replaced branches on 2026-09-14, and the swap is almost one-for-one. A
 * branch was a state of the world the user found out about between lunch and 8pm —
 * "I got to the gym", "I did not" — and each one selected a pool of candidates
 * from the menu. A lane is a quota category, and selects the same way. What
 * changed is the QUESTION the day answers: it used to be "where are you", and it
 * is now "what does the week still owe".
 *
 * Venue did not disappear, it demoted. It used to be a branch, a weekday guess
 * (`hotspotDays`) and two scoring weights; it is now a FILTER read off the
 * check-in. A gym session on an evening the user has said the user is home is hidden, not
 * penalised — see `venueRule` in plan.json.
 */

/** The quota categories, as the plan declares them. */
export function lanes(plan) {
  return plan?.quotaCategories || []
}

/**
 * Everything that could fill this quota category.
 *
 * Two kinds of lane. A CLIMBING lane has real menu sessions tagged to it — board
 * intervals are power-endurance whoever logs them — and they are the candidates.
 * An ENDURANCE lane has none, because a ride has no protocol and never needed
 * one; its candidate is the workout card itself, opened with the activity
 * already picked (`quotaCategories[].logWith`).
 *
 * The fallback OVERRIDES `sched.recommend: false`, and that is not a
 * contradiction. The flag means "never the app's unprompted advice" — it exists
 * so the app never tells them to go and do something unspecified. A lane for a
 * quota THE USER SET is not unprompted: the user asked for three rides, and the board saying
 * two are outstanding is the thing the user asked for. This is the same override the
 * old other-training branch carried, for the same reason.
 */
function laneCandidates(plan, menu, key) {
  const live = menu.filter(m => !m.retired && m.role === 'session')
  const own = live.filter(m => m.category === key && sched(m).recommend !== false)
  if (own.length) return own
  const cat = lanes(plan).find(c => c.key === key)
  if (!cat || !('logWith' in cat)) return []
  const card = live.find(m => m.categoryFrom === 'activity')
  return card ? [card] : []
}

/**
 * Is this session possible where the user has said the user is?
 *
 * `null` venue means the user has not said, and then everything is possible — the app
 * does not get to guess their evening from the weekday any more. That guess was
 * `hotspotDays`, and it cost the gym sessions 22 points on five days a week.
 */
export function venueAllows(opt, venue) {
  if (!venue) return true
  const v = sched(opt).venue || 'any'
  return v === 'any' || v === venue
}

export function whoopVerdict(readiness, cfg) {
  const w = cfg?.whoop || DEFAULTS.whoop
  if (!readiness) return null
  const rec = Number.isFinite(readiness.recovery) ? readiness.recovery : null
  const hrvDrop = Number.isFinite(readiness.hrvDeltaPct) ? readiness.hrvDeltaPct : null

  // Two independent ways to be under-recovered, because either alone is soft:
  // WHOOP's own red band, or an HRV meaningfully below THEIR median. Agreement
  // between them is worth more than either, which is what `strength` carries.
  const redBits = []
  if (rec !== null && rec < w.lowRecovery) redBits.push(`recovery ${rec}%`)
  if (hrvDrop !== null && hrvDrop <= w.hrvDrop) redBits.push(`HRV ${hrvDrop}% under your median`)

  if (redBits.length) {
    return {
      band: 'red',
      strength: redBits.length > 1 ? 1 : 0.6,
      why: `WHOOP has you at ${redBits.join(' and ')} this morning.`,
    }
  }
  if (rec !== null && rec >= w.highRecovery) {
    return { band: 'green', strength: 1, why: `WHOOP has you recovered (${rec}%) this morning.` }
  }
  return null
}

const dayDiff = (a, b) => Math.round((fromIso(b) - fromIso(a)) / 86400000)
const sched = (opt) => opt?.sched || {}

/**
 * How much this session costs your fingers. Declared per session; falls back to
 * the load level so a menu entry with no `sched` still classifies sanely.
 */
export function fingerLoad(opt) {
  const declared = sched(opt).fingerLoad
  if (declared) return declared
  const lvl = Number(opt?.level) || 1
  return lvl >= 4 ? 'hard' : lvl >= 3 ? 'light' : 'none'
}

const LOADED = new Set(['hard', 'light', 'sub', 'variable'])

/**
 * Does this entry make its DATE a hard finger day?
 *
 * This is the single most load-bearing predicate in the app: both hard blocks —
 * the 48-hour spacing and the weekly cap — are counted on what it returns, and
 * they are the two rules in the plan justified by injury risk rather than
 * preference. Three ways in, read in this order: the session cannot load the
 * fingers at all, the user ANSWERED the question, or the plan's declaration stands.
 */
export function isHardEntry(entry, menu = []) {
  // `optFor`, not a raw find. An entry logged against a card that has since been
  // RENAMED would otherwise resolve to nothing, skip every branch below, and fall
  // through to "level 4 or more" — which turned nine pre-pivot bike rides into
  // hard FINGER days the moment *Other training* became *Log a workout*. The
  // whole point of this predicate is that a savage ride costs the fingers
  // nothing, and a stale id was quietly inverting it. See lib/menu.js.
  const opt = optFor(menu, entry?.data?.optId)
  const load = opt ? fingerLoad(opt) : null

  // A session that cannot load the fingers never spends the finger budget, no
  // matter how hard it was — a savage bike ride is a level-4 day and zero
  // finger exposures. Asked before the logged answer is read, because the
  // workout card has no hard-finger question to answer and must not acquire one
  // from a stale `out` written against some other session.
  if (load === 'none') return false

  // WHAT THE USER LOGGED WINS. Since 2026-09-14 every card that can load the fingers
  // ASKS — pre-filled from the plan's own declaration, and their answer overrides
  // it in both directions. A board session the user took easy costs nothing; a social
  // night the user projected through costs a full exposure. Before this the plan's
  // declaration was final for everything except the `variable` cards, which made
  // an easy board night as expensive as a hard one and left them with no way to
  // say otherwise short of logging it as a different session.
  const said = entry?.data?.out?.hardFingers
  if (said === true || said === false) return said

  // Nothing said. Fall back to exactly what the app did before the question
  // existed, so every entry logged before today still classifies the same way.
  if (load === 'hard') return true
  if (load === 'sub') return false
  return Number(entry?.data?.level) >= 4
}

/** The dates, in order, that cost you a hard finger exposure. */
export function hardDates(entries, menu) {
  return [...new Set(entries
    .filter(e => e.kind === 'daily' && isDone(e) && e.date && isHardEntry(e, menu))
    .map(e => e.date))].sort()
}

/**
 * Everything the scorer needs, derived once. Session-level facts come from the
 * plan; body-level facts come from what you logged.
 *
 * `iso` is the day being decided. History means strictly before it, so the
 * recommendation for a day does not change as you log that day — the one thing
 * more annoying than a fixed schedule is a recommendation that moves under you.
 */
export function buildContext({ plan, entries = [], iso, ignorePlanned = false, coach = null, readiness = null, lane = null }) {
  const cfg = recConfig(plan)
  const menu = plan?.dailyMenu || []
  const dow = fromIso(iso).getDay()
  // The week is now a calendar week, Monday to Sunday, not a numbered week of a
  // dated block. There is no block: `weeks[]` and `phases[]` went on 2026-09-14
  // along with the trip they counted down to.
  const monday = mondayOf(iso)
  const week = { start: monday, end: weekDays(monday)[6] }
  const quota = quotaProgress({ plan, entries, iso })

  const daily = entries.filter(e => e.kind === 'daily' && e.date)
  const done = daily.filter(isDone)
  const past = done.filter(e => e.date < iso)
  // What is already on today. The DAY's recommendation ignores this — it is the
  // answer to "what should today be", and it must not change out from under you
  // the moment you act on it. The swap list does use it, because "you already
  // have that one" is exactly what you want to know there.
  const onDay = ignorePlanned
    ? new Set()
    : new Set(daily.filter(e => e.date === iso).map(e => e.data?.optId).filter(Boolean))

  const hard = hardDates(done, menu)
  const priorHard = hard.filter(d => d < iso)
  const lastHardIso = priorHard.at(-1) || null
  const hardGap = lastHardIso ? dayDiff(lastHardIso, iso) : Infinity
  const hardThisWeek = hard.filter(d => d >= week.start && d < iso).length

  // Week-to-date: how many times each session has been done, and what the
  // the week owes per category.
  const doneThisWeek = new Map()
  for (const e of past) {
    if (week && (e.date < week.start || e.date > week.end)) continue
    const id = e.data?.optId
    if (id) doneThisWeek.set(id, (doneThisWeek.get(id) || 0) + 1)
  }

  const lastDone = new Map()
  for (const e of past) {
    const id = e.data?.optId
    if (id && (!lastDone.has(id) || e.date > lastDone.get(id))) lastDone.set(id, e.date)
  }

  /*
   * The last HARD day in each discipline, for per-discipline spacing.
   *
   * Hard means level 4 or up — the same bar `isHardEntry` falls back to. Only
   * hard efforts space: three easy rides in a row is a normal week and the app
   * has no business having an opinion about it.
   *
   * Tracked separately per discipline because legs and fingers are separate
   * systems. This is the term that stops the whole-body rhythm from nagging them
   * about a board session the day after a fun ride.
   */
  const lastHardIn = new Map()
  for (const e of past) {
    if (Number(e?.data?.level) < 4) continue
    const d = disciplineOf(e, menu)
    if (!d) continue
    if (!lastHardIn.has(d) || e.date > lastHardIn.get(d)) lastHardIn.set(d, e.date)
  }

  /*
   * The trailing week's total load, in RPE x minutes.
   *
   * The whole-body ceiling: per-discipline spacing
   * catches "another hard ride too soon", and this catches the week where every
   * discipline was individually fine and the total was not. Thresholds come from
   * their OWN six logged weeks (median 2441, p75 2764, p90 3204), so a normal week
   * is never flagged — see recommender.ceiling.
   */
  const lookback = cfg.ceiling?.lookbackDays ?? 7
  const trailingLoad = past
    .filter(e => dayDiff(e.date, iso) <= lookback && isTraining(e))
    .reduce((sum, e) => {
      const rpe = Number(e?.data?.out?.rpe) || (Number(e?.data?.level) || 0) * 2
      const min = Number(e?.data?.minutesSpent ?? e?.data?.minutes) || 0
      return sum + (rpe > 0 && min > 0 ? rpe * min : 0)
    }, 0)
  const ceilingBand =
    trailingLoad >= (cfg.ceiling?.hardLoad ?? Infinity) ? 'hard'
    : trailingLoad >= (cfg.ceiling?.softLoad ?? Infinity) ? 'soft'
    : null

  // Body signals, worst-case over the recent window — one sore report matters
  // more than three fine ones.
  const within = (days) => past.filter(e => dayDiff(e.date, iso) <= days)
  const worst = (list, key) => list
    .map(e => Number(e.data?.out?.[key]))
    .filter(Number.isFinite)
    .reduce((a, b) => Math.max(a, b), 0)

  // What the user said about today in the check-in card. Absent for any day the user has not
  // checked in on, which is every future day and most past ones.
  const facts = dayFacts({ plan, entries, iso })

  const recent = within(2)
  // How the fingers read RIGHT NOW beats how they read after Tuesday's session.
  // The user is the instrument here, and the check-in is the more recent measurement —
  // saying "fingers are fine" and still being told to rest because Tuesday was
  // sore is the app arguing with them about their own hands.
  const fingersRecent = facts.fingers ?? worst(recent, 'fingers')
  const skinRecent = worst(recent, 'skin')

  const rpes = within(3).map(e => Number(e.data?.out?.rpe)).filter(Number.isFinite)
  const rpeRecent = rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : 0

  // Consecutive days trained, ending yesterday.
  const dates = new Set(past.map(e => e.date))
  let streakDays = 0
  for (let d = prevIso(iso); dates.has(d); d = prevIso(d)) streakDays++

  const daysLeftInWeek = dayDiff(iso, week.end) + 1
  const hardSlotsLeft = Math.max(1, Math.floor((daysLeftInWeek + 1) / cfg.hardMinGapDays))

  // The earliest date a hard finger day is legal again.
  const nextHardIso = lastHardIso && hardGap < cfg.hardMinGapDays
    ? addDays(lastHardIso, cfg.hardMinGapDays)
    : iso

  return {
    cfg, menu, plan, iso, dow, week, onDay, facts,
    // Which quota lane is being scored, or null for the whole menu at once.
    lane, quota,
    lastHardIso, hardGap, hardThisWeek, hardDates: hard, nextHardIso,
    lastHardIn, trailingLoad, ceilingBand,
    doneThisWeek, lastDone,
    fingersRecent, fingersSaid: facts.fingers !== null, skinRecent, rpeRecent, streakDays,
    daysLeftInWeek, hardSlotsLeft,
    // Validated, clamped and dated. An absent or stale coach note is an empty
    // map, which is exactly the same computation the app did before the coach
    // existed — the failure mode of the coach is that nothing happens.
    coach: coachNudges(coach, iso, cfg.coachCap),
    // How the user arrived, per WHOOP, or null. Same failure mode as the coach note by
    // construction: null means every term below behaves as it did before WHOOP.
    // The reading itself is computed in server/whoop.js — this only reads it.
    whoop: whoopVerdict(readiness, cfg),
  }
}

const addDays = (iso, n) => {
  const d = fromIso(iso)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const nextIso = (iso) => addDays(iso, 1)
const prevIso = (iso) => addDays(iso, -1)

const dayName = (iso) => DAY_NAMES[fromIso(iso).getDay()]
const agoPhrase = (n) => n === 1 ? 'yesterday' : `${n} days ago`
/** Whether the finger reading is what the user just said or what their log remembers. */
const fingersWhen = (ctx) => ctx.fingersSaid ? 'right now' : 'after your last session'

/**
 * Score one session for one day.
 *
 * Returns `{ blocked, why, score, reasons }`. A blocked session is never
 * recommended and shows as "Not today" in the swap list — those are the plan's
 * safety rules, not preferences. Everything else is the sum of weighted terms,
 * each carrying the sentence that justifies it.
 */
export function scoreSession(opt, ctx) {
  const { cfg, week } = ctx
  const W = cfg.weights
  const s = sched(opt)
  const load = fingerLoad(opt)
  const reasons = []
  const add = (points, text) => {
    if (!points || !text) return
    reasons.push({ points: Math.round(points), text })
  }
  const blocked = (why) => ({
    id: opt.id, opt, blocked: true, why, score: -Infinity,
    reasons: [{ points: 0, text: why }],
  })

  // This morning's coach note, if it named this session. Labelled, so the
  // reasoning card can never present a machine's opinion as the plan's.
  const addCoach = () => {
    const n = ctx.coach?.get(opt.id)
    if (n) add(n.points, `Coach: ${n.why}`)
  }

  /*
   * This morning's WHOOP reading, if there is one.
   *
   * Called from the same place as the coach nudge and for the same reason: below
   * every hard block, so it can reorder a list of legal sessions and can never
   * make an illegal one legal. Clamped to `whoop.cap` on top of that, and labelled
   * "WHOOP:" so the reasoning card never presents a wearable's read of last night
   * as the programme's opinion.
   *
   * What it does NOT do is decide the day is a rest day. Rest scores better on a
   * red morning; choosing it stays their.
   */
  const addWhoop = () => {
    const v = ctx.whoop
    if (!v) return
    const cap = ctx.cfg.whoop.cap
    const at = (points) => Math.max(-cap, Math.min(cap, Math.round(points * v.strength)))
    // 'hard' and 'variable' are the loads a bad morning should push away from —
    // the second because "bouldering with friends" is the session most likely to
    // become a hard day by accident, which is precisely what a red morning cannot
    // afford. `sub` and `light` are deliberately not here: sub-threshold work is
    // the plan's answer to a day that cannot take hard work, not another cost.
    const hardish = load === 'hard' || load === 'variable' || (Number(opt.level) || 1) >= 4

    if (v.band === 'red') {
      if (hardish) add(at(W.whoopRed), `WHOOP: ${v.why}`)
      // The counterpart, so a red morning has somewhere to go rather than only
      // things it disapproves of.
      else if (load === 'none' || load === 'sub' || (Number(opt.level) || 1) <= 2) {
        add(at(W.whoopRedRelief), `WHOOP: ${v.why} This one asks little of you.`)
      }
    } else if (v.band === 'green' && hardish) {
      add(at(W.whoopGreen), `WHOOP: ${v.why}`)
    }
  }

  // ---- hard blocks: the rules that can actually hurt you -------------------

  // `sched.weeks` — "weeks 7-10 only" — went with the dated block on 2026-09-14.
  // There is no week 7 to be in. Left in place it would have read week.n as
  // undefined and blocked the 4x4s and the calibration day permanently, which is
  // the quiet kind of breakage nobody notices until a category never fills.

  if (Array.isArray(s.days) && s.days.length && !s.days.includes(ctx.dow)) {
    return blocked(`${s.days.map(d => DAY_NAMES[d]).join(' / ')} only — today is ${DAY_NAMES[ctx.dow]}.`)
  }

  if (load === 'hard') {
    if (ctx.hardGap < cfg.hardMinGapDays) {
      return blocked(
        `Your last hard finger day was ${agoPhrase(ctx.hardGap)}. Hard finger days never go back to back — ` +
        `the next one is legal ${dayName(ctx.nextHardIso)}.`)
    }
    if (ctx.hardThisWeek >= cfg.hardCap) {
      return blocked(
        `That would be hard finger day ${ctx.hardThisWeek + 1} this week, and the cap is ${cfg.hardCap}. ` +
        `The week resets ${dayName(nextIso(week?.end || ctx.iso))}.`)
    }
  }

  // ---- what the user told the app about today ------------------------------------
  //
  // Deliberately below the injury rules, so a session that is both unsafe and
  // unavailable says it is unsafe. The user can override the two below by swapping the
  // session in themselves; the user should never be able to do that without having read
  // the spacing rule first.

  const venue = s.venue || 'any'
  if (ctx.facts.venue && venue !== 'any' && venue !== ctx.facts.venue) {
    return blocked(`You said you're ${venuePhrase(ctx.plan, ctx.facts.venue)} tonight, ` +
      `and this one is ${venuePhrase(ctx.plan, venue)}.`)
  }

  if (ctx.facts.window && Number(opt.minutes) > ctx.facts.window) {
    return blocked(
      `You said you have ${ctx.facts.window} minutes and this one is ${opt.minutes}. ` +
      'The menu has shorter blocks for exactly this.')
  }

  // ---- weighted terms ------------------------------------------------------

  if (opt.role === 'rest') {
    add(W.restBase, 'A deliberate rest day is always on the table.')
    if (ctx.streakDays >= cfg.restAfterDays) {
      add(W.restFit, `${ctx.streakDays} straight days trained — the streak is not worth an injury.`)
    }
    if (ctx.fingersRecent >= cfg.hurtFingers) {
      add(W.restFit * 1.5, ctx.fingersSaid
        ? 'You said something hurts. Nothing else outranks that.'
        : 'You logged "something hurts" after your last session. Nothing else outranks that.')
    } else if (ctx.fingersRecent >= cfg.soreFingers) {
      add(W.restFit, `Your fingers scored ${ctx.fingersRecent}/5 ${fingersWhen(ctx)}.`)
    }
    if (ctx.rpeRecent >= cfg.tiredRpe + 0.5) {
      add(W.restFit * 0.6, `Your last few sessions averaged RPE ${ctx.rpeRecent.toFixed(1)}.`)
    }
    addCoach()
    return finish(opt, reasons)
  }

  if (ctx.onDay.has(opt.id)) add(W.onDay, 'Already on today.')

  /*
   * WHAT THE WEEK STILL OWES. This is the term the week template used to be.
   *
   * The template said "Thursday is the board day", which was only ever useful if
   * Thursday was when the user got to the gym — and a Thursday the user could not make cost
   * the board session rather than moving it. A quota says the week wants two
   * power-endurance workouts and stays silent about which days they land on, so
   * this term reads the CATEGORY rather than the weekday.
   *
   * `quotaNearlyDone` leans harder when a category is the last thing outstanding,
   * because "one swim left and four days to do it in" is a more useful nudge on
   * Thursday than it was on Monday.
   */
  // Inside a lane, the LANE's category is what is being scored — the workout
  // card carries no category of its own, because ninety-one sports share it.
  const category = ctx.lane || opt.category || null
  const laneState = category ? ctx.quota.byKey[category] : null
  if (laneState) {
    const { planned, done, remaining, name } = laneState
    if (remaining > 0) {
      const lastOne = ctx.quota.owed.length === 1
      add(W.quotaOwed + (lastOne ? W.quotaNearlyDone : 0),
        `${name}: ${done} of ${planned} done this week, ${remaining} to go` +
        (lastOne ? ' — the only thing the week still owes.' : '.'))
    } else if (planned > 0 && ctx.quota.owed.length) {
      // Filled, and something else is not. Not a blocker — an extra ride in a
      // week that asked for three is allowed and always was — but it should not
      // outrank the swim the user has not done.
      add(W.quotaFull, `${name} is done for the week (${done} of ${planned}).`)
    } else if (planned === 0 && ctx.quota.isSet) {
      // The week was set up and did not ask for this at all.
      add(W.noQuota, `Nothing this week asked for ${String(name).toLowerCase()}.`)
    }
  }

  if (Array.isArray(s.prefDays) && s.prefDays.includes(ctx.dow)) {
    add(s.prefDays[0] === ctx.dow ? W.prefDay : W.prefDay * 0.6,
      `${DAY_NAMES[ctx.dow]} is when this session normally goes.`)
  }

  /*
   * PER-DISCIPLINE SPACING, and the whole-body ceiling above it.
   *
   * Advisory, both of them — the only hard blocks in this file are the two finger
   * rules. Spacing is tracked per discipline because legs and fingers are
   * separate systems: a hard ride yesterday is a real reason not to ride hard
   * today and no reason at all to skip the board. A single global hard/easy
   * rhythm would nag about a board session the day after a fun ride, which is
   * exactly the kind of advice that teaches you to ignore the app.
   */
  const discipline = disciplineOfOption(opt)
  const hardish = load === 'hard' || (Number(opt.level) || 1) >= 4
  if (discipline && hardish) {
    const gap = ctx.cfg.disciplineGap?.[discipline] ?? 0
    const lastIn = ctx.lastHardIn.get(discipline)
    const since = lastIn ? dayDiff(lastIn, ctx.iso) : Infinity
    if (gap > 0 && since < gap) {
      add(W.disciplineSpacing * (1 - since / gap),
        `You went hard on this ${agoPhrase(since)}, and ${gap} days is the gap you want between them.`)
    } else if (gap > 0 && Number.isFinite(since)) {
      add(W.disciplineRested, `${since} days since you last went hard at this.`)
    }
  }

  /*
   * The whole-body ceiling. Per-discipline spacing cannot see the week where
   * every discipline was individually fine and the total was too much, so this
   * reads the trailing seven days of RPE x minutes against their own history.
   */
  if (ctx.ceilingBand && hardish) {
    const load7 = Math.round(ctx.trailingLoad)
    if (ctx.ceilingBand === 'hard') {
      add(W.ceilingHard, `The last 7 days total ${load7} of load — heavier than any week you have logged.`)
    } else {
      add(W.ceilingSoft, `The last 7 days total ${load7} of load, which is a heavy week for you.`)
    }
  }

  if (load === 'hard') {
    const deficit = cfg.hardTarget - ctx.hardThisWeek
    if (deficit > 0) {
      add(W.hardDue * Math.min(1, deficit / ctx.hardSlotsLeft),
        `${ctx.hardThisWeek} of ${cfg.hardTarget} hard finger days done, ${ctx.daysLeftInWeek} day${ctx.daysLeftInWeek === 1 ? '' : 's'} left in the week.`)
    }
    if (Number.isFinite(ctx.hardGap)) {
      const extra = Math.min(3, ctx.hardGap - cfg.hardMinGapDays)
      add(W.spacing * extra, `${ctx.hardGap} days since your last hard finger day — fully recovered.`)
    }
  }

  if (s.weeklyTarget > 0) {
    const doneN = ctx.doneThisWeek.get(opt.id) || 0
    if (doneN < s.weeklyTarget) {
      add(W.weeklyDue * (1 - doneN / s.weeklyTarget),
        doneN === 0 ? 'Not done yet this week.' : `${doneN} of ${s.weeklyTarget} this week.`)
    }
  }

  const lastIso = ctx.lastDone.get(opt.id)
  if (lastIso) {
    const since = dayDiff(lastIso, ctx.iso)
    const minGap = s.spacingDays ?? 2
    if (since < minGap) add(W.repeat * (1 - since / minGap), `You did this ${agoPhrase(since)}.`)
    else add(Math.min(W.staleCap, W.stale * since), `You haven't done this in ${since} days.`)
  } else {
    add(W.staleCap * 0.5, 'You have not done this one yet this block.')
  }

  // The day after a hard finger day is for recovering, not for topping up.
  if (ctx.hardGap === 1) {
    const scale = { hard: 1, light: 1, variable: 1, sub: 0.7, none: 0 }[load] ?? 0
    if (scale) add(W.dayAfterHard * scale, 'Yesterday was a hard finger day — today is for recovering from it.')
    else add(W.recoveryFit, 'Yesterday was a hard finger day and nothing here loads the fingers.')
  }

  // "Something hurts" is the top of the scale and it outranks the entire menu —
  // whatever the week owes can wait a day. Everything gets pushed below rest.
  if (ctx.fingersRecent >= cfg.hurtFingers) {
    add(W.hurt, ctx.fingersSaid
      ? 'You said something hurts — take the day off before you train through it.'
      : 'You logged "something hurts" after your last session — take the day off before you train through it.')
  } else if (ctx.fingersRecent >= cfg.soreFingers) {
    if (LOADED.has(load)) add(W.sore, `Your fingers read ${ctx.fingersRecent}/5 ${fingersWhen(ctx)}.`)
    else add(W.soreRelief, `Your fingers read ${ctx.fingersRecent}/5 — this loads none of them.`)
  }

  if (ctx.streakDays >= cfg.restAfterDays && ctx.rpeRecent >= cfg.tiredRpe) {
    add(W.overreached,
      `${ctx.streakDays} straight days trained at an average RPE of ${ctx.rpeRecent.toFixed(1)}.`)
  }

  if (s.skinCost && ctx.skinRecent >= cfg.soreSkin) {
    add(W.skin, `Skin read ${ctx.skinRecent}/5 and this session eats skin.`)
  }

  if (ctx.rpeRecent >= cfg.tiredRpe && (Number(opt.level) || 1) <= 2 && load === 'none') {
    add(W.easyWhenTired, `Your last few sessions averaged RPE ${ctx.rpeRecent.toFixed(1)} — this is a genuinely easy one.`)
  }

  // "Bouldering with friends" can become a hard day by accident. If there is no
  // budget left for that to happen, say so before it does.
  if (load === 'variable' && ctx.hardThisWeek >= cfg.hardCap - 1) {
    add(W.budgetRisk,
      `If this turns into a real session it counts as a hard finger day, and you have ${Math.max(0, cfg.hardCap - ctx.hardThisWeek)} left this week.`)
  }

  const clash = (s.mutex || []).filter(id => ctx.onDay.has(id))
  if (clash.length) {
    const names = clash.map(id => ctx.menu.find(m => m.id === id)?.name || id)
    add(W.mutex, `Doesn't stack with ${names.join(' or ')}, which is already on today.`)
  }

  addWhoop()
  addCoach()

  return finish(opt, reasons)
}

function finish(opt, reasons) {
  const score = reasons.reduce((sum, r) => sum + r.points, 0)
  return { id: opt.id, opt, blocked: false, score, reasons }
}

/** Positive reasons first, biggest first — the case FOR doing it. */
export const pros = (r) => (r?.reasons || []).filter(x => x.points > 0).sort((a, b) => b.points - a.points)
/** The case against, same ordering. Blocked sessions have their block reason here. */
export const cons = (r) => (r?.reasons || []).filter(x => x.points < 0).sort((a, b) => a.points - b.points)

/**
 * Today's actual recommendation.
 *
 * Everything in the menu that could be a main session is scored; the winner is
 * whatever the day's real numbers point at. Rest scores like everything else, so
 * a week that has gone badly can genuinely recommend a rest day rather than
 * pretending Thursday is still Thursday.
 */
export function recommend({ plan, entries = [], iso, ignorePlanned = false, coach = null, readiness = null, lane = null }) {
  const ctx = buildContext({ plan, entries, iso, ignorePlanned, coach, readiness, lane })
  const menu = plan?.dailyMenu || []
  // Inside a lane, the candidates are that quota category's own — that is what a
  // lane IS. Rest is never one of them: resting is not a way to fill a quota, it
  // is the answer to a different question, and `board()` asks it separately.
  //
  //
  // Where the user has SAID the user is is NOT filtered here. It is already a hard block in
  // `scoreSession`, which returns the session with "you said you're at home
  // tonight, and this one is at the gym" attached — and that sentence is the most
  // useful thing on the day. Filtering the candidate out instead would drop it
  // from `ranked` and take the explanation with it, so the board would go quiet
  // about the one thing the user most wants explained.
  const candidates = lane
    ? laneCandidates(plan, menu, lane)
    : menu.filter(m => !m.retired && (m.role === 'session' || m.role === 'rest'))
  if (!candidates.length) return null

  const ranked = candidates
    .map(o => scoreSession(o, ctx))
    .sort((a, b) => b.score - a.score ||
      candidates.indexOf(a.opt) - candidates.indexOf(b.opt))

  // A card can be available without being advice. The free-form "other training"
  // card exists so a run or a bike ride can be logged at all — recommending it
  // unprompted would be the app telling them to go and do something unspecified.
  // A lane that NAMES it is not unprompted: `laneCandidates` has already decided
  // what belongs to this quota category, so re-filtering would empty a lane of
  // the only card it has.
  const open = lane
    ? ranked.filter(r => !r.blocked)
    : ranked.filter(r => !r.blocked && sched(r.opt).recommend !== false)
  const top = open[0] || ranked[0]
  const runnerUp = open[1] || null

  /*
   * The best thing the week OWES that the user cannot do today, if there is one.
   *
   * This is the question "why isn't it telling me to climb", and under quotas it
   * has a better answer than it had under the template: not "Thursday wanted the
   * board" but "the week still owes two power-endurance sessions and both are
   * blocked until tomorrow". Only ever a session in an owed category, because a
   * blocked session nothing asked for is not a displacement, it is just a session
   * the user was not going to do.
   */
  const owed = new Set(ctx.quota.owed.map(c => c.key))
  const displaced = owed.size
    ? ranked.find(r => r.blocked && r.opt?.category && owed.has(r.opt.category) && r.id !== top.id) || null
    : null

  return {
    opt: top.opt,
    blocked: Boolean(top.blocked),
    score: top.score,
    reasons: top.reasons,
    why: pros(top).slice(0, 2).map(r => r.text).join(' ') || 'Nothing else in the menu fits today.',
    caveats: cons(top).map(r => r.text),
    displaced: displaced && { opt: displaced.opt, why: displaced.why },
    runnerUp: runnerUp && { opt: runnerUp.opt, score: runnerUp.score },
    ranked,
    ctx,
  }
}

/**
 * The day as a QUOTA BOARD: what the week still owes, and what would fill it.
 *
 * This replaced `plans()` — the three branch cards — on 2026-09-14, when the app
 * stopped being a climbing log and became two achievements with weekly quotas. The
 * branches answered "where are you"; the board answers "what does the week still
 * owe", which is the question a quota model makes primary.
 *
 * One lane per quota category, each computed by the same engine with the same
 * blocks and the same sentences. Four things it deliberately does NOT do:
 *
 *  - It does not decide. A lane is an offer with its reasons attached; the order
 *    is a ranking, never a schedule, and nothing is ever assigned to a weekday.
 *  - It does not multiply the finger budget. Lanes are alternatives, so several
 *    can offer hard finger work at once — the user logs one, and the budget is counted
 *    on what is LOGGED, never on what was offered. This is the single safety
 *    property the board must not cost, and it is the same one the branches had.
 *  - It does not block on quotas. A category the week did not ask for still
 *    computes and still ranks; it just scores `noQuota` and sits lower. The user said
 *    recommended and not-recommended should stay a feature but not block them,
 *    and the only hard blocks left in this file are the two finger rules.
 *  - It does not guess where the user is. A lane whose sessions all need the gym is
 *    empty on an evening the user said the user is home, with the reason on it — see
 *    `venueAllows`. Absent a check-in, nothing is filtered at all.
 *
 * Rest is computed alongside rather than as a lane, for the reason it was never a
 * branch: resting is not a way to fill a quota, it is the answer to "should I
 * train at all", and it has to be able to outrank the whole board on a week that
 * has gone badly.
 */
export function board({ plan, entries = [], iso, ignorePlanned = true, coach = null, readiness = null, skip = [] }) {
  const cfg = recConfig(plan)
  const menu = plan?.dailyMenu || []
  const dow = fromIso(iso).getDay()
  const facts = dayFacts({ plan, entries, iso })
  const quota = quotaProgress({ plan, entries, iso })
  // Derived rather than read off the category: plan.json's `goal` back-reference
  // went when achievements became editable. See lib/achievements.js.
  const achs = achievements(plan, entries)

  const rows = lanes(plan).map(cat => {
    const state = quota.byKey[cat.key] || { planned: 0, done: 0, remaining: 0 }
    const rec = recommend({ plan, entries, iso, ignorePlanned, coach, readiness, lane: cat.key })
    const top = rec && !rec.blocked ? rec : null
    return {
      category: cat,
      key: cat.key,
      achievement: achievementOf(cat.key, achs)?.id || null,
      planned: state.planned,
      done: state.done,
      remaining: state.remaining,
      over: state.over || 0,
      complete: Boolean(state.complete),
      // Owed leads. Within that, a lane the week asked for beats one it did not.
      owed: state.remaining > 0,
      opt: top?.opt || null,
      score: top?.score ?? null,
      reasons: top?.reasons || [],
      why: top?.why || null,
      caveats: top?.caveats || [],
      // A lane with no session of its own opens the workout card. `prefill` is
      // the activity to arrive with, so tapping "Bike" is one tap and not a
      // search — and null for the misc lane, which is a search by definition.
      logOnly: Boolean(top?.opt?.categoryFrom === 'activity'),
      prefill: top?.opt?.categoryFrom === 'activity' ? (cat.logWith || null) : null,
      // Nothing in this lane is possible today. The top-scoring blocked session's
      // reason is the honest explanation, because it is the one the user would have
      // picked — and on a stated-venue evening it is "you said you're at home".
      empty: top ? null : (rec?.ranked || []).find(r => r.blocked)?.why
        || (facts.venue ? `Nothing here works ${venuePhrase(plan, facts.venue)}.`
                        : 'Nothing in this category fits today.'),
      // Whether this lane is empty because of where the user is, rather than because of
      // the finger rules — a different sentence, and a recoverable one: the user can
      // say "home" at five and make the gym at eight.
      venueBlocked: !top && Boolean(facts.venue) &&
        laneCandidates(plan, menu, cat.key).every(m => !venueAllows(m, facts.venue)),
      companions: top
        ? companions({ plan, entries, iso, mainId: top.opt.id, skip, coach, readiness })
        : [],
    }
  })

  // Owed first, then what the week asked for, then the rest. Inside each band,
  // by score — so the board reads top-to-bottom as "do this next".
  const rank = (r) => (r.owed ? 0 : r.planned > 0 ? 1 : 2)
  rows.sort((a, b) => rank(a) - rank(b) || (b.score ?? -Infinity) - (a.score ?? -Infinity))

  const overall = recommend({ plan, entries, iso, ignorePlanned, coach, readiness })
  const restOpt = menu.find(m => m.role === 'rest' && !m.retired) || null
  const restScored = restOpt ? overall?.ranked?.find(r => r.id === restOpt.id) : null

  return {
    iso,
    dow,
    quota,
    lanes: rows,
    owed: rows.filter(r => r.owed),
    // The user has said where the user is, so the board is filtered. Kept explicit so the
    // screen can say so rather than appearing to have lost half its lanes.
    venue: facts.venue || null,
    // The week has not been set up at all. Distinct from a week set to nothing,
    // which is a choice and should not be nagged at.
    unset: !quota.isSet,
    restWins: overall?.opt?.role === 'rest',
    rest: restScored && {
      opt: restScored.opt,
      score: restScored.score,
      why: pros(restScored).slice(0, 2).map(r => r.text).join(' ') || null,
    },
    overall,
  }
}

/**
 * The rest of the day.
 *
 * A day is a list of sessions, and the week owes more short blocks than it has
 * days — core, hips, eccentrics, antagonists and the lead laps all want a slot
 * and the template only has seven. So the advice for a day is a list too: the
 * main session answers "what is today", and companions answer "and what else
 * goes alongside it".
 *
 * Companions come out of the same ranking as everything else — the swap list,
 * the recommendation and this can never disagree about a session. What is extra
 * here are the rules for what may share a day:
 *
 *   1. Never a hard finger session, UNLESS the plan declares that exact pairing
 *      with something already on the day (`sched.stacksWith`). Two unrelated
 *      hard sessions in a day is a volume spike the per-day hard budget would
 *      not even notice. Max hangs and repeaters are not unrelated — they were
 *      one session until 2026-08-10, they still belong on the same Monday, and
 *      splitting them must not quietly halve that Monday.
 *   2. Never finger work on a day that already has finger work, unless the plan
 *      says that pair is programmed (`sched.stacksWith` — the doubled lead laps
 *      on the gym night are the case this exists for).
 *   3. Never somewhere you aren't. You cannot do a home block during a three
 *      hour gym session, so venues have to agree.
 *   4. Never something declared `mutex` with anything already on the day.
 *   5. It has to be genuinely owed (`companionMin` points), inside the day's
 *      spare time (`companionMinutes`), and there are at most `maxCompanions`.
 *
 * `mainId` is the session the day actually has — the recommendation if nothing
 * is planned yet, or whatever got swapped in. `skip` is what you've dismissed;
 * dismissing is a real answer, so it is not quietly re-suggested.
 */
export function companions({ plan, entries = [], iso, mainId = null, skip = [], coach = null, readiness = null, lane = null }) {
  const ctx = buildContext({ plan, entries, iso, coach, readiness, lane })
  const cfg = ctx.cfg
  const menu = ctx.menu
  const main = menu.find(m => m.id === mainId) || null
  // Where the rest of the day happens. The user is the only source for this now: a
  // stated venue, or the main session's own, or no opinion. The branches used to
  // answer it and there are no branches.
  const where = ctx.facts.venue || sched(main).venue || 'any'

  // A rest day is the whole of the advice. Anything you add to it is your call.
  if (main?.role === 'rest') return []

  const skipped = new Set(skip)
  // Everything the day already carries — the main included, even when it is
  // still only a recommendation.
  const taken = new Set(ctx.onDay)
  if (mainId) taken.add(mainId)
  const stack = [...taken].map(id => menu.find(m => m.id === id)).filter(Boolean)

  /*
   * PROGRAMMED PAIRINGS GO FIRST.
   *
   * A pairing the PLAN declares (`sched.stacksWith` naming something already on
   * the day) is not a preference the scorer gets to weigh up — it is the plan
   * saying these two belong together. The doubled lead laps on the board night
   * are the case this exists for: they ARE the gym night's second half.
   *
   * It became load-bearing on 2026-09-14. Freeing the support blocks from
   * `venue: 'home'` to `any` — so a hip block is available at a commercial gym,
   * which it obviously is — made them eligible on the climbing-gym night too, and
   * they promptly took both companion slots and crowded the laps off the day. The
   * ranking was not wrong about them; it just had no way to know that one of the
   * candidates was programmed and the others were merely owed.
   */
  const ranked = menu
    .filter(m => m.role === 'session' && !m.retired)
    .map(o => scoreSession(o, ctx))
    .sort((a, b) =>
      (programmedWith(b.opt, stack) - programmedWith(a.opt, stack)) || b.score - a.score)

  // How much extra time the day has. A window the user stated in the check-in is the
  // whole evening, main session included — telling the app you have fifty
  // minutes and being handed a 22-minute session plus 45 more of companions is
  // the app not listening. With no window stated, the plan's own default.
  const budget = ctx.facts.window
    ? Math.max(0, ctx.facts.window - (main?.minutes || 0))
    : cfg.companionMinutes

  const picks = []
  let minutes = 0
  for (const r of ranked) {
    if (picks.length >= cfg.maxCompanions) break
    const opt = r.opt
    if (r.blocked || sched(opt).recommend === false) continue
    if (taken.has(opt.id) || skipped.has(opt.id)) continue
    if (r.score < cfg.companionMin) continue
    if (fingerLoad(opt) === 'hard' && !programmedWith(opt, stack)) continue
    if (!venueFits(opt, main, where)) continue
    if (!stacksWith(opt, stack)) continue
    if (minutes + (opt.minutes || 0) > budget) continue

    picks.push({ ...r, why: pros(r)[0]?.text || '', caveats: cons(r).map(c => c.text) })
    taken.add(opt.id)
    stack.push(opt)
    minutes += opt.minutes || 0
  }
  return picks
}

/**
 * May this session go on today, or come off it?
 *
 * The check-in coach cannot put anything on the day by itself — it suggests, and
 * the user taps. So this does not gate the coach, it decides whether a BUTTON is
 * offered, and the `why` becomes the line under a suggestion that has no buttons.
 *
 * It is deliberately NOT the companion ranking: companions are the app
 * volunteering a session unasked and have to clear `companionMin` points to be
 * worth interrupting them with, whereas this is a session the user is being shown
 * because the user asked a question about their evening. Something that scores badly but
 * is legal is their to choose, and the button is how the user chooses it.
 *
 * What has no button, and why each one:
 *
 * - Anything `scoreSession` BLOCKS. That is the whole point of the block list:
 *   the two finger rules that can injure them, and the two facts the user just typed
 *   into the check-in about where the user is and how long the user has. The swap dialog's
 *   "make it my main anyway" is still the deliberate override, and it is
 *   deliberately somewhere other than a chat bubble.
 * - A session already marked DONE cannot be removed. Un-logging training the user has
 *   said the user did would rewrite history, and the streak, the load calendar, the
 *   finger budget and the Totem habit are all downstream of it.
 * - `add` is stricter than `main`: an extra has to SHARE the day, under the same
 *   venue, stacking and hard-finger rules `companions()` uses, because two
 *   unrelated hard sessions in a day is a volume spike the per-day budget cannot
 *   see. So the two buttons on one suggestion can genuinely disagree.
 *
 * Returns `{ ok }` or `{ ok: false, why }`, and the `why` is shown to them
 * verbatim. A suggestion that silently loses its buttons reads as a broken card.
 */
export function placeable({ plan, entries = [], iso, optId, action, mainId = null, coach = null, readiness = null }) {
  const ctx = buildContext({ plan, entries, iso, coach, readiness })
  const no = (why) => ({ ok: false, why })
  const opt = ctx.menu.find(m => m.id === optId)

  if (!opt) return no('There is no such session in the programme.')
  if (opt.retired) return no(`${opt.name} has been retired from the menu.`)
  if (opt.role === 'adjunct') return no(`${opt.name} is an add-on — it is ticked on the session it rides with.`)
  if (!PLACEMENT_ACTIONS.includes(action)) return no('That is not something the coach can do to a day.')

  const onDay = entries.filter(e => e.kind === 'daily' && e.date === iso && !e.deleted)

  if (action === 'remove') {
    const already = onDay.find(e => e.data?.optId === optId)
    if (already && isDone(already)) {
      return no(`You've already marked ${opt.name} done. The coach doesn't get to un-log training you did.`)
    }
    return { ok: true }
  }

  const scored = scoreSession(opt, ctx)
  if (scored.blocked) return no(scored.why)
  if (action === 'main') return { ok: true }

  // ---- `add`: it has to fit alongside what the day already is ---------------

  // Once a day for everything except the cards the plan marks `repeatable` —
  // *Other training* is one card covering a run and a lift, and a day with both
  // in it is two entries. See `isRepeatable` in lib/store.js.
  if (!isRepeatable(opt) && onDay.some(e => e.data?.optId === optId)) {
    return no(`${opt.name} is already on today.`)
  }

  const main = ctx.menu.find(m => m.id === mainId) || null
  const stack = onDay
    .map(e => optFor(ctx.menu, e.data?.optId))
    .filter(Boolean)
    .filter(o => o.id !== optId)
  if (main && !stack.some(o => o.id === main.id)) stack.push(main)

  if (fingerLoad(opt) === 'hard' && !programmedWith(opt, stack)) {
    return no(`${opt.name} is a hard finger session, and the plan doesn't programme it alongside what today already is.`)
  }
  if (!venueFits(opt, main)) {
    return no(`${opt.name} isn't in the same place as the rest of your day.`)
  }
  if (!stacksWith(opt, stack)) {
    return no(`${opt.name} doesn't share a day with what's already on it.`)
  }
  if (ctx.facts.window) {
    const spent = stack.reduce((n, o) => n + (Number(o.minutes) || 0), 0)
    if (spent + (Number(opt.minutes) || 0) > ctx.facts.window) {
      return no(`That would put the day over the ${ctx.facts.window} minutes you said you have.`)
    }
  }

  return { ok: true }
}

/**
 * Both buttons on one suggested session, judged live.
 *
 * The check-in card offers what the coach suggested as two ordinary buttons —
 * swap it in as your main, or add it as an extra — so this answers what each one
 * should do when the user looks at it. It is deliberately re-run on every render
 * rather than decided once when the reply landed: if the user swaps their main to
 * something the suggested block cannot share a day with, the "add as extra"
 * button has to go away and say why, and a verdict frozen at reply time would
 * still be offering it.
 */
export function offers({ plan, entries = [], iso, optId, mainId = null, coach = null, readiness = null }) {
  const one = (action) => placeable({ plan, entries, iso, optId, action, mainId, coach, readiness })
  return { main: one('main'), add: one('add'), remove: one('remove') }
}

/**
 * Does the plan explicitly programme this session alongside something already on
 * the day? This is the ONLY way a hard finger session rides along with another,
 * and it has to be declared in plan.json — never inferred from the score.
 */
function programmedWith(opt, stack) {
  const declared = sched(opt).stacksWith || []
  return stack.some(o => declared.includes(o.id))
}

/**
 * You can only be in one place at a time. `any` fits anywhere.
 *
 * `where` is the branch's own place, and it is not redundant with the main
 * session's. The other-training branch's main card is venue-`any` — a run is a
 * run wherever you are — so on its own it let the doubled lead laps ride along
 * with a bike ride. The branch knows what the main card cannot: the user is out on a
 * run, so the user is not at the gym.
 */
function venueFits(opt, main, where = 'any') {
  const a = sched(opt).venue || 'any'
  const b = main ? (sched(main).venue || 'any') : 'any'
  const fits = (x, y) => x === 'any' || y === 'any' || x === y
  return fits(a, b) && fits(a, where)
}


/** Does this session share a day with everything already on it? */
function stacksWith(opt, stack) {
  const s = sched(opt)
  for (const other of stack) {
    if ((s.mutex || []).includes(other.id)) return false
    if ((sched(other).mutex || []).includes(opt.id)) return false
  }
  // Finger work rides along with other finger work only where the plan declares
  // the pairing. Everything else keeps a day to one finger session.
  if (fingerLoad(opt) !== 'none' && stack.some(o => fingerLoad(o) !== 'none')) {
    const programmed = stack.some(o => (s.stacksWith || []).includes(o.id))
    if (!programmed) return false
  }
  return true
}

/**
 * Rank an alternative against the day's recommendation. Same scores, same
 * reasons — the swap list and the recommendation can never disagree, because
 * they are the same computation read two ways.
 */
export function classify(result, recScore) {
  if (result.blocked) return { tier: 'avoid', why: result.why }
  const gap = recScore - result.score
  const con = cons(result)[0]
  if (gap <= 12) {
    return { tier: 'swap', why: pros(result)[0]?.text || 'Costs the same as today\'s pick. Swap freely.' }
  }
  return {
    tier: 'ok',
    why: con ? con.text : `A step down from today's pick, but nothing here is a problem. ${pros(result)[0]?.text || ''}`.trim(),
  }
}
