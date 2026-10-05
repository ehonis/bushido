/* Recommendation engine tests. Pure, no DOM, run against the real plan.json:
 *   node app/recommend.test.js
 *
 * The scenarios here are real ones. The first is the one that produced the
 * engine: the user moved a gym day to Wednesday, and on Thursday the app
 * cheerfully suggested a second gym day — which would have been a third hard
 * finger day, the day after the last one.
 */

import { readFileSync } from 'node:fs'
import {
  recommend, companions, buildContext, scoreSession, classify, isHardEntry, fingerLoad,
  placeable, offers, whoopVerdict, recConfig, hardDates,
  board, lanes, venueAllows,
} from './src/lib/recommend.js'
import { buildQuotaEntry, mondayOf } from './src/lib/quota.js'

const plan = JSON.parse(readFileSync(new URL('../test/fixtures/plan.json', import.meta.url), 'utf8'))
const menu = plan.dailyMenu
const opt = (id) => menu.find(m => m.id === id)

let failed = 0
const check = (name, fn) => {
  try {
    fn()
    console.log(`  PASS  ${name}`)
  } catch (err) {
    failed++
    console.error(`  FAIL  ${name}\n        ${err.message}`)
  }
}
/** Weekday names, and one real ISO date per weekday: 9-15 Aug 2026 is Sun-Sat. */
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const ISO = [...Array(7)].map((_, d) => `2026-08-${String(9 + d).padStart(2, '0')}`)

const eq = (got, want, what = '') => {
  if (got !== want) throw new Error(`${what || 'value'}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg) }

/** A done daily entry, the shape the store actually writes. */
const day = (date, optId, extra = {}) => ({
  id: `daily-${date}-${optId}`, kind: 'daily', date, updatedAt: `${date}T20:00:00Z`,
  data: { slot: 'main', optId, level: opt(optId)?.level ?? 1, done: true, out: {}, ...extra },
})

/* ------------------------------------------------------------ the scenario */

// The week of Mon 3 Aug – Sun 9 Aug, which asked for two power-endurance
// sessions and two finger days. Under the old model this was week 1 of a dated
// block; it is now just a calendar week with quotas on it.
const movedWeek = [
  buildQuotaEntry('2026-08-03', { pe: 2, fingers: 2, endurance: 1, support: 2 }),
  day('2026-08-03', 'max-hangs', { out: { rpe: 7, fingers: 2, skin: 2 } }),
  day('2026-08-04', 'subthreshold', { out: { rpe: 3, fingers: 1 } }),
  // Wednesday became the gym day, off the usual schedule.
  day('2026-08-05', 'four-by-four', { out: { rpe: 8, fingers: 3 } }),
  { ...day('2026-08-05', 'fun-boulder'), id: 'daily-2026-08-05-fun-boulder',
    data: { slot: 'extra', optId: 'fun-boulder', level: 3, done: true, out: { intensity: 3, rpe: 7, fingers: 3, skin: 3 } } },
]

check('the bug: Thursday does not recommend a second hard gym day', () => {
  const rec = recommend({ plan, entries: movedWeek, iso: '2026-08-06', ignorePlanned: true })
  ok(rec.opt.id !== 'board', `recommended ${rec.opt.id}`)
  eq(fingerLoad(rec.opt), 'none', 'the day after a hard day should load no fingers')
})

check('the blocked session the week still owes is explained, not silently dropped', () => {
  // This is the question "why isn't it telling me to climb", and under quotas it
  // has a better answer than it had under the template: not "Thursday wanted the
  // board" but "power-endurance is still owed and every session in it is blocked
  // until tomorrow".
  const rec = recommend({ plan, entries: movedWeek, iso: '2026-08-06', ignorePlanned: true })
  ok(rec.displaced, 'something owed is blocked and it should say so')
  ok(['pe', 'fingers'].includes(rec.displaced.opt.category),
    `displaced should be a category the week owes, got ${rec.displaced.opt.category}`)
  ok(/back to back/i.test(rec.displaced.why), `why: ${rec.displaced.why}`)
})

check('back-to-back hard days are blocked even with cap headroom', () => {
  const ctx = buildContext({ plan, entries: movedWeek, iso: '2026-08-06' })
  eq(ctx.hardThisWeek, 2, 'hard days so far this week')
  ok(ctx.hardThisWeek < ctx.cfg.hardCap, 'the cap alone would allow a third')
  const r = scoreSession(opt('board'), ctx)
  ok(r.blocked, 'the board day should be blocked by spacing, not by the cap')
})

check('the third hard day IS allowed once it is spaced', () => {
  const ctx = buildContext({ plan, entries: movedWeek, iso: '2026-08-07' })
  eq(ctx.hardGap, 2, 'days since the last hard day')
  ok(!scoreSession(opt('board'), ctx).blocked, 'Friday is 48h clear — legal')
})

check('the fourth hard day is not', () => {
  const four = [...movedWeek, day('2026-08-07', 'board', { out: { rpe: 8, fingers: 3 } })]
  const ctx = buildContext({ plan, entries: four, iso: '2026-08-09' })
  eq(ctx.hardThisWeek, 3, 'hard days this week')
  const r = scoreSession(opt('max-hangs'), ctx)
  ok(r.blocked && /cap is 3/.test(r.why), `why: ${r.why}`)
})

check('a category the week has not filled reads as owed, and says so', () => {
  // The replacement for `templateDebt`. A missed Tuesday is not a debt, it is a
  // Tuesday — but a quota that has not been filled IS still outstanding, and that
  // is a fact about the week rather than about a weekday.
  const ctx = buildContext({ plan, entries: movedWeek, iso: '2026-08-06' })
  const owed = ctx.quota.owed.map(c => c.key)
  ok(owed.includes('endurance'), `endurance should be owed, owed is [${owed}]`)
  const r = scoreSession(opt('lead-laps'), ctx)
  ok(r.reasons.some(x => /to go/.test(x.text)), 'being owed should be a stated reason')
})

check('a week that owes nothing nags about nothing', () => {
  // Misses EXPIRE — nothing carries into next week as debt. A week the user never set
  // up owes nothing at all, and the board must not invent obligations for them.
  const ctx = buildContext({ plan, entries: [], iso: '2026-08-06' })
  eq(ctx.quota.owed.length, 0)
  eq(ctx.quota.isSet, false)
  const r = scoreSession(opt('lead-laps'), ctx)
  ok(!r.reasons.some(x => /to go|owed/.test(x.text)), 'nothing was asked for, so nothing is owed')
})

check('filling a quota sinks it below one still outstanding', () => {
  const entries = [
    buildQuotaEntry('2026-08-03', { pe: 1, endurance: 1 }),
    day('2026-08-03', 'board', { out: { rpe: 7, fingers: 2 } }),
  ]
  const ctx = buildContext({ plan, entries, iso: '2026-08-05' })
  const laps = scoreSession(opt('lead-laps'), ctx)
  const more = scoreSession(opt('four-by-four'), ctx)
  ok(laps.score > more.score,
    `the owed endurance session (${laps.score}) should outrank the filled PE one (${more.score})`)
})

/* ------------------------------------------------- the ordinary week still works */

check('a clean week with a hard exposure owed recommends one', () => {
  const prior = [
    buildQuotaEntry('2026-08-10', { fingers: 2, pe: 1, support: 1 }),
    day('2026-08-08', 'core'), day('2026-08-09', 'audit'),
  ]
  const b = board({ plan, entries: prior, iso: '2026-08-10' })
  const hard = b.lanes.filter(l => l.opt && fingerLoad(l.opt) === 'hard')
  ok(hard.length, 'the week owes two finger days and nothing blocks one')
  ok(b.lanes[0].owed, 'the board leads with something outstanding')
})

check('a week that owes power-endurance offers the board session', () => {
  const prior = [
    buildQuotaEntry('2026-08-10', { pe: 1, fingers: 1 }),
    day('2026-08-10', 'max-hangs', { out: { rpe: 7, fingers: 2 } }),
    day('2026-08-11', 'unilateral'),
    day('2026-08-12', 'hips'),
  ]
  const rec = recommend({ plan, entries: prior, iso: '2026-08-13', ignorePlanned: true })
  eq(rec.opt.category, 'pe', `recommended ${rec.opt.id}`)
})

check('the weekday no longer decides anything about the gym', () => {
  // `hotspotDays` guessed their evening from the calendar and cost every gym
  // session 22 points on five days a week. It is gone: with nothing said, every
  // day scores the board identically.
  const q = [buildQuotaEntry('2026-08-10', { pe: 1 })]
  const scores = ISO.map(iso => scoreSession(opt('board'), buildContext({ plan, entries: q, iso })))
  for (const r of scores) {
    ok(!r.reasons.some(x => /gym day/i.test(x.text)),
      'no session should be penalised for which weekday it is')
  }
})

/* --------------------------------------------------------- body signals */

check('sore fingers push finger work down and rest up', () => {
  const sore = [
    day('2026-08-10', 'max-hangs', { out: { rpe: 9, fingers: 5, skin: 4 } }),
  ]
  const ctx = buildContext({ plan, entries: sore, iso: '2026-08-11' })
  eq(ctx.fingersRecent, 5, 'worst recent finger score')
  const sub = scoreSession(opt('subthreshold'), ctx)
  const hips = scoreSession(opt('hips'), ctx)
  ok(hips.score > sub.score, `non-finger ${hips.score} should beat sub-threshold ${sub.score}`)
})

check('a long streak with bad numbers can actually recommend rest', () => {
  const grind = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15']
    .map((d, i) => day(d, i === 0 ? 'max-hangs' : 'hips', { out: { rpe: 9, fingers: 5, skin: 4 } }))
  const rec = recommend({ plan, entries: grind, iso: '2026-08-16', ignorePlanned: true })
  eq(rec.opt.role, 'rest', `recommended ${rec.opt.id}`)
})

check('rest is never the default on a fresh week', () => {
  const rec = recommend({ plan, entries: [], iso: '2026-08-10', ignorePlanned: true })
  ok(rec.opt.role !== 'rest', `recommended ${rec.opt.id}`)
})

/* ------------------------------------------------------- honest logging */

check('a social day logged at intensity 4 counts as a hard finger day', () => {
  const hardFun = { ...day('2026-08-12', 'fun-boulder'),
    data: { slot: 'main', optId: 'fun-boulder', level: 4, done: true, out: { intensity: 4, rpe: 8, fingers: 3 } } }
  ok(isHardEntry(hardFun, menu), 'intensity 4 must count')
  const ctx = buildContext({ plan, entries: [hardFun], iso: '2026-08-13' })
  eq(ctx.hardGap, 1, 'yesterday')
  ok(scoreSession(opt('board'), ctx).blocked, 'and it must block the next day')
})

check('planning something is not doing it', () => {
  const planned = { ...day('2026-08-12', 'board'), data: { slot: 'main', optId: 'board', level: 4, done: false, out: {} } }
  const ctx = buildContext({ plan, entries: [planned], iso: '2026-08-13' })
  eq(ctx.hardThisWeek, 0, 'an unfinished session must not spend the budget')
})

/* -------------------------------------------------- everything else counts */

check('a savage bike ride is a heavy day but not a hard finger day', () => {
  const ride = { ...day('2026-08-12', 'log-workout'),
    data: { slot: 'main', optId: 'log-workout', name: 'Bike', level: 4, done: true,
            out: { activity: 'bike', distance: 42, duration: 140, effort: 4, rpe: 9 } } }
  ok(!isHardEntry(ride, menu), 'legs are not fingers')
  const ctx = buildContext({ plan, entries: [ride], iso: '2026-08-13' })
  eq(ctx.hardThisWeek, 0, 'it must not spend the finger budget')
  ok(!scoreSession(opt('board'), ctx).blocked, 'and it must not block tomorrow\'s board day')
})

check('...but it does still register as fatigue', () => {
  const ride = { ...day('2026-08-12', 'log-workout'),
    data: { slot: 'main', optId: 'log-workout', level: 4, done: true, out: { effort: 4, rpe: 9 } } }
  const ctx = buildContext({ plan, entries: [ride], iso: '2026-08-13' })
  eq(ctx.rpeRecent, 9, 'RPE carries across every kind of session')
  eq(ctx.streakDays, 1, 'and it keeps the streak')
})

check('the free-form card is available but never recommended', () => {
  const ctx = buildContext({ plan, entries: [], iso: '2026-08-12' })
  ok(!scoreSession(opt('log-workout'), ctx).blocked, 'it must always be addable')
  for (let d = 0; d < 7; d++) {
    const iso = `2026-08-${String(9 + d).padStart(2, '0')}`
    const rec = recommend({ plan, entries: [], iso, ignorePlanned: true })
    ok(rec.opt.id !== 'log-workout', `recommended on ${iso}`)
  }
})

/* ------------------------------------------------- the block that is gone */

check('nothing is gated on a week number any more', () => {
  // `sched.weeks` — "weeks 7-10 only" — went with `weeks[]` on 2026-09-14. Left
  // in place it would have read an undefined week number and blocked the 4x4s and
  // the calibration day permanently: the quiet kind of breakage nobody notices
  // until a quota category never fills.
  for (const m of menu) {
    ok(!m.sched?.weeks, `${m.id} still gates on a week number that cannot exist`)
  }
  for (const id of ['four-by-four', 'calibration']) {
    const ctx = buildContext({ plan, entries: [], iso: '2026-08-13' })
    ok(!scoreSession(opt(id), ctx).blocked, `${id} should be available on any week`)
  }
})

check('the plan no longer carries a dated block at all', () => {
  for (const key of ['weeks', 'phases', 'weekTemplate', 'trip', 'routes']) {
    ok(!plan[key], `plan.${key} survived the pivot and will drift`)
  }
})

check('the Sunday audit is a Sunday appointment', () => {
  ok(scoreSession(opt('audit'), buildContext({ plan, entries: [], iso: '2026-08-12' })).blocked, 'Wednesday')
  ok(!scoreSession(opt('audit'), buildContext({ plan, entries: [], iso: '2026-08-16' })).blocked, 'Sunday')
})

/* ------------------------------------------------------------- companions */

/** ids of the extra sessions advised alongside `mainId`. */
const also = (entries, iso, mainId, skip = []) =>
  companions({ plan, entries, iso, mainId, skip }).map(c => c.opt.id)

check('a day can recommend more than one session', () => {
  const rec = recommend({ plan, entries: [], iso: '2026-08-10', ignorePlanned: true }) // Monday
  const extra = also([], '2026-08-10', rec.opt.id)
  ok(extra.length > 0, 'Monday should carry something alongside the hard home session')
  ok(extra.length <= plan.recommender.maxCompanions, `${extra.length} companions`)
})

check('the doubled lead laps ride along with the gym night', () => {
  const week = [
    buildQuotaEntry('2026-08-10', { pe: 1, fingers: 1 }),
    day('2026-08-10', 'max-hangs', { out: { rpe: 7, fingers: 2 } }),
  ]
  eq(recommend({ plan, entries: week, iso: '2026-08-13', ignorePlanned: true }).opt.category, 'pe',
    'the week still owes power-endurance')
  ok(also(week, '2026-08-13', 'board').includes('lead-laps'),
    'the laps are programmed alongside the board block — sched.stacksWith')
})

check('...and nothing else finger-loading does', () => {
  const extra = also([], '2026-08-13', 'board')
  for (const id of extra) {
    ok(fingerLoad(opt(id)) === 'none' || (opt(id).sched.stacksWith || []).includes('board'),
      `${id} loads fingers on a day that already does`)
  }
})

check('a hard session is only ever a companion where the plan says so', () => {
  for (let d = 0; d < 7; d++) {
    const iso = `2026-08-${String(10 + d).padStart(2, '0')}`
    const rec = recommend({ plan, entries: [], iso, ignorePlanned: true })
    for (const id of also([], iso, rec.opt.id)) {
      if (fingerLoad(opt(id)) !== 'hard') continue
      ok((opt(id).sched.stacksWith || []).includes(rec.opt.id),
        `${id} rode along with ${rec.opt.id} on ${iso} without a declared pairing`)
    }
  }
})

check('you cannot be at home and at the climbing gym at once', () => {
  for (const id of also([], '2026-08-13', 'board')) {
    const venue = opt(id).sched.venue
    ok(venue === 'climbing-gym' || venue === 'any',
      `${id} is a ${venue} session on a climbing-gym night`)
  }
})

check('a rest day is the whole of the advice', () => {
  eq(also([], '2026-08-11', 'off').length, 0, 'companions on a rest day')
})

check('mutually exclusive sessions never share a day', () => {
  // Sub-threshold hangs, unilateral blocks and Abrahangs all declare each other.
  const extra = also([], '2026-08-11', 'subthreshold')
  for (const id of extra) ok(!(opt('subthreshold').sched.mutex).includes(id), `${id} is mutex with the main`)
})

check('what is already on the day is not suggested again', () => {
  const onDay = [
    { ...day('2026-08-13', 'lead-laps'), data: { slot: 'extra', optId: 'lead-laps', level: 3, done: false, out: {} } },
  ]
  ok(!also(onDay, '2026-08-13', 'board').includes('lead-laps'), 'already added')
})

check('dismissing one is a real answer — it does not come back', () => {
  const rec = recommend({ plan, entries: [], iso: '2026-08-10', ignorePlanned: true })
  const first = also([], '2026-08-10', rec.opt.id)
  ok(first.length > 0, 'nothing to dismiss')
  ok(!also([], '2026-08-10', rec.opt.id, [first[0]]).includes(first[0]), `${first[0]} came back`)
})

check('sore fingers turn the extras into non-finger work', () => {
  const sore = [day('2026-08-10', 'max-hangs', { out: { rpe: 8, fingers: 4, skin: 4 } })]
  const rec = recommend({ plan, entries: sore, iso: '2026-08-11', ignorePlanned: true })
  for (const id of also(sore, '2026-08-11', rec.opt.id)) {
    eq(fingerLoad(opt(id)), 'none', `${id} loads fingers that read 4/5`)
  }
})

check('a hurt day carries nothing at all', () => {
  const hurt = [day('2026-08-10', 'max-hangs', { out: { rpe: 9, fingers: 5, skin: 4 } })]
  const rec = recommend({ plan, entries: hurt, iso: '2026-08-11', ignorePlanned: true })
  eq(rec.opt.role, 'rest', 'the day itself')
  eq(also(hurt, '2026-08-11', rec.opt.id).length, 0, 'and nothing alongside it')
})

check('the day has a time budget and every companion explains itself', () => {
  for (let d = 0; d < 7; d++) {
    const iso = `2026-08-${String(10 + d).padStart(2, '0')}`
    const rec = recommend({ plan, entries: [], iso, ignorePlanned: true })
    const picks = companions({ plan, entries: [], iso, mainId: rec.opt.id })
    const mins = picks.reduce((n, p) => n + (p.opt.minutes || 0), 0)
    ok(mins <= plan.recommender.companionMinutes, `${mins} min of extras on ${iso}`)
    for (const p of picks) ok(p.why.length > 5, `${p.opt.id} on ${iso} must say why`)
  }
})

/* -------------------------------------- the Monday split, and the test day */

/*
 * Max hangs and repeaters were one card until 2026-08-10. Splitting them is only
 * an improvement if Monday still carries both — the risk of the split is that
 * the recommendation quietly becomes half a session and nobody notices for a
 * fortnight.
 */

check('the fingers lane is both halves: max hangs, with repeaters riding along', () => {
  const prior = [
    buildQuotaEntry('2026-08-10', { fingers: 2 }),
    day('2026-08-08', 'core'), day('2026-08-09', 'audit'),
  ]
  const fingers = board({ plan, entries: prior, iso: '2026-08-10' }).lanes.find(l => l.key === 'fingers')
  eq(fingers.opt.id, 'max-hangs', 'the main session')
  ok(fingers.companions.map(c => c.opt.id).includes('repeaters'),
    'repeaters must ride along — sched.stacksWith declares the pairing')
})

check('...and the pair costs ONE hard finger exposure, not two', () => {
  // The whole reason stacking is safe: the budget is counted per DATE.
  const monday = [
    day('2026-08-10', 'max-hangs', { out: { rpe: 7, fingers: 2 } }),
    { ...day('2026-08-10', 'repeaters'), id: 'daily-2026-08-10-repeaters',
      data: { slot: 'extra', optId: 'repeaters', level: 4, done: true, out: { rpe: 7, fingers: 3 } } },
  ]
  const ctx = buildContext({ plan, entries: monday, iso: '2026-08-12' })
  eq(ctx.hardThisWeek, 1, 'two sessions, one hard day')
})

check('repeaters the DAY AFTER max hangs is still blocked', () => {
  // Splitting the card must not have created a back door to two hard finger
  // days in a row. Same day is programmed; consecutive days is not.
  const monday = [day('2026-08-10', 'max-hangs', { out: { rpe: 7, fingers: 2 } })]
  const ctx = buildContext({ plan, entries: monday, iso: '2026-08-11' })
  const r = scoreSession(opt('repeaters'), ctx)
  ok(r.blocked && /back to back/i.test(r.why), `why: ${r.why}`)
})

check('the MVC test can take the Monday, and repeaters still ride along', () => {
  // The test can replace max hangs on a Monday while the repeaters still happen.
  const prior = [day('2026-08-08', 'core'), day('2026-08-09', 'audit')]
  ok(!scoreSession(opt('mvc-test'), buildContext({ plan, entries: prior, iso: '2026-08-10' })).blocked,
    'the test has to be legal on a clean Monday')
  ok(also(prior, '2026-08-10', 'mvc-test').includes('repeaters'),
    'repeaters must ride along with the test too')
})

check('...but max hangs and the test never share a day', () => {
  ok(!also([], '2026-08-10', 'mvc-test').includes('max-hangs'), 'mutex, and both are hard')
  ok(!also([], '2026-08-10', 'max-hangs').includes('mvc-test'))
})

check('the MVC-7 test can take the Monday too, and repeaters still ride along', () => {
  // Before the first MVC-7, every percentage in the plan is a percentage of a
  // number that does not exist yet, so the test has to fit the week.
  const prior = [day('2026-08-08', 'core'), day('2026-08-09', 'audit')]
  ok(!scoreSession(opt('mvc7-test'), buildContext({ plan, entries: prior, iso: '2026-08-10' })).blocked,
    'the test has to be legal on a clean Monday')
  ok(also(prior, '2026-08-10', 'mvc7-test').includes('repeaters'),
    'repeaters must ride along with the anchor test too')
})

check('...and it never shares a day with the other two ways of testing a max', () => {
  // Three cards all measure a maximum and all replace Monday. Two of them on one
  // day is a doubled maximal exposure that the per-day budget cannot see.
  for (const other of ['max-hangs', 'mvc-test', 'calibration']) {
    ok(!also([], '2026-08-10', 'mvc7-test').includes(other), `${other} rode along with the MVC-7`)
    ok(!also([], '2026-08-10', other).includes('mvc7-test'), `the MVC-7 rode along with ${other}`)
  }
})

check('the MVC-7 the day after a hard finger day is blocked like anything else', () => {
  const monday = [day('2026-08-10', 'max-hangs', { out: { rpe: 7, fingers: 2 } })]
  const r = scoreSession(opt('mvc7-test'), buildContext({ plan, entries: monday, iso: '2026-08-11' }))
  ok(r.blocked && /back to back/i.test(r.why), `why: ${r.why}`)
})

check('a retired session is never advised, but its history still counts', () => {
  const retired = menu.filter(m => m.retired).map(m => m.id)
  ok(retired.includes('hard-home'), 'the pre-split Monday card should be retired, not deleted')
  ok(retired.includes('hard-gym'), 'the pre-split Thursday card should be retired, not deleted')
  for (let d = 0; d < 7; d++) {
    const iso = `2026-08-${String(10 + d).padStart(2, '0')}`
    const rec = recommend({ plan, entries: [], iso, ignorePlanned: true })
    ok(!retired.includes(rec.opt.id), `recommended a retired session on ${iso}`)
    for (const id of also([], iso, rec.opt.id)) ok(!retired.includes(id), `${id} on ${iso}`)
  }
  // The day the user actually logged against it is still a hard finger day.
  const old = [day('2026-08-10', 'hard-home', { out: { rpe: 7, fingers: 2 } })]
  eq(buildContext({ plan, entries: old, iso: '2026-08-11' }).hardGap, 1, 'yesterday still counts')
  // Same for the welded gym card: retiring it must not un-spend the Thursdays the user
  // already did against it, or the spacing rule goes blind across the split.
  const oldGym = [day('2026-08-13', 'hard-gym', { out: { rpe: 8, fingers: 3 } })]
  eq(buildContext({ plan, entries: oldGym, iso: '2026-08-14' }).hardGap, 1, 'the old gym day still counts')
})

/* --------------------------------------------------------- crimp crawls */

check('crimp crawls load the fingers without spending a hard exposure', () => {
  eq(fingerLoad(opt('crawls')), 'light', 'low peak force, but not free')
  const done = { ...day('2026-08-12', 'crawls'),
    data: { slot: 'main', optId: 'crawls', level: 3, done: true, out: { rpe: 6, fingers: 2, pump: 4 } } }
  ok(!isHardEntry(done, menu), 'it must not spend a hard finger day')
  eq(buildContext({ plan, entries: [done], iso: '2026-08-13' }).hardThisWeek, 0)
  ok(!scoreSession(opt('board'), buildContext({ plan, entries: [done], iso: '2026-08-13' })).blocked,
    'and it must not block the board day')
})

check('...and it is not a recovery session either', () => {
  // "Easy on the tissue, hard on the system" — it loads the fingers, so the day
  // after a hard finger day must penalise it like any other finger work.
  const hard = [day('2026-08-10', 'max-hangs', { out: { rpe: 8, fingers: 3 } })]
  const ctx = buildContext({ plan, entries: hard, iso: '2026-08-11' })
  const r = scoreSession(opt('crawls'), ctx)
  ok(r.reasons.some(x => x.points < 0 && /hard finger day/i.test(x.text)),
    'the day after a hard day should count against it')
  ok(scoreSession(opt('hips'), ctx).score > r.score, 'genuinely non-finger work should beat it there')
})

/* --------------------------------------------------------------- coach */

/*
 * The morning coach is one weighted term. These pin the three properties that
 * make that safe: it is dated, it is capped, and it cannot reach past a hard
 * block. Everything else about it is presentation.
 */
const note = (over = {}) => ({
  version: 1, date: '2026-08-11', generatedAt: '2026-08-11T07:20:00.000Z', model: 'test',
  headline: 'x', read: [], nudges: [], flags: [], changed: [], ...over,
})

check('a coach nudge moves the score and says who said so', () => {
  const coach = note({ nudges: [{ optId: 'crawls', points: 12, why: 'your notes say pump, twice' }] })
  const base = scoreSession(opt('crawls'), buildContext({ plan, entries: [], iso: '2026-08-11' }))
  const led = scoreSession(opt('crawls'), buildContext({ plan, entries: [], iso: '2026-08-11', coach }))
  eq(led.score - base.score, 12, 'the nudge is applied')
  ok(led.reasons.some(r => /^Coach: /.test(r.text)), 'and it is labelled as the coach, not as the plan')
})

check('a nudge is capped, however big the model made it', () => {
  const cap = plan.recommender.coachCap
  const coach = note({ nudges: [{ optId: 'crawls', points: 9000, why: 'do it' }] })
  const base = scoreSession(opt('crawls'), buildContext({ plan, entries: [], iso: '2026-08-11' }))
  const led = scoreSession(opt('crawls'), buildContext({ plan, entries: [], iso: '2026-08-11', coach }))
  eq(led.score - base.score, cap, `clamped to ${cap}`)
})

check('a coach note for another day does nothing at all', () => {
  const stale = note({ date: '2026-08-10', nudges: [{ optId: 'crawls', points: 18, why: 'yesterday' }] })
  const base = scoreSession(opt('crawls'), buildContext({ plan, entries: [], iso: '2026-08-11' }))
  const led = scoreSession(opt('crawls'), buildContext({ plan, entries: [], iso: '2026-08-11', coach: stale }))
  eq(led.score, base.score, 'stale advice must not steer a different day')
})

check('a malformed coach note is ignored rather than half-applied', () => {
  const base = scoreSession(opt('crawls'), buildContext({ plan, entries: [], iso: '2026-08-11' })).score
  const junk = [
    null, 'nonsense', {}, note({ version: 99 }), note({ nudges: 'lots' }),
    note({ nudges: [{ optId: 'crawls', points: 12 }] }),          // no why
    note({ nudges: [{ points: 12, why: 'x' }] }),                 // no session
    note({ nudges: [{ optId: 'crawls', points: 'heaps', why: 'x' }] }),
  ]
  for (const coach of junk) {
    eq(scoreSession(opt('crawls'), buildContext({ plan, entries: [], iso: '2026-08-11', coach })).score,
      base, `junk got through: ${JSON.stringify(coach)}`)
  }
})

check('THE ONE THAT MATTERS: no coach note can unblock a hard finger day', () => {
  const monday = [day('2026-08-10', 'max-hangs', { out: { rpe: 7, fingers: 2 } })]
  const coach = note({ nudges: [{ optId: 'repeaters', points: 18, why: 'finish Monday off' }] })
  const ctx = buildContext({ plan, entries: monday, iso: '2026-08-11', coach })
  const r = scoreSession(opt('repeaters'), ctx)
  ok(r.blocked, 'the spacing rule is checked before any coach points are read')
  const rec = recommend({ plan, entries: monday, iso: '2026-08-11', ignorePlanned: true, coach })
  ok(rec.opt.id !== 'repeaters', `recommended ${rec.opt.id}`)
})

check('...nor breach the weekly cap', () => {
  const spent = [
    day('2026-08-10', 'max-hangs', { out: { fingers: 2 } }),
    day('2026-08-12', 'board', { out: { fingers: 3 } }),
    day('2026-08-14', 'max-hangs', { out: { fingers: 3 } }),
  ]
  const coach = note({ date: '2026-08-16', nudges: [{ optId: 'board', points: 18, why: 'one more' }] })
  const r = scoreSession(opt('board'), buildContext({ plan, entries: spent, iso: '2026-08-16', coach }))
  ok(r.blocked && /cap is 3/.test(r.why), `why: ${r.why}`)
})

check('a coach can put a session on the day, within the same safety rules', () => {
  // A positive nudge is how the coach adds a companion: it goes through the
  // ordinary companion filter, so it can suggest but never smuggle.
  const sore = [day('2026-08-10', 'max-hangs', { out: { rpe: 8, fingers: 4, skin: 4 } })]
  const coach = note({ nudges: [{ optId: 'crawls', points: 18, why: 'the pump work is owed' }] })
  const picks = companions({ plan, entries: sore, iso: '2026-08-11', mainId: 'hips', coach })
  for (const p of picks) {
    eq(fingerLoad(p.opt), 'none', `${p.opt.id} loads fingers that read 4/5, coach or no coach`)
  }
})

/* ------------------------------------------------------ swap classification */

check('swap tiers agree with the recommendation', () => {
  const rank = recommend({ plan, entries: movedWeek, iso: '2026-08-06' })
  const gym = rank.ranked.find(r => r.id === 'board')
  eq(classify(gym, rank.score).tier, 'avoid', 'a blocked session')
  const top = rank.ranked.find(r => !r.blocked)
  eq(classify(top, rank.score).tier, 'swap', 'the winner swaps with itself')
})

check('every menu session scores without throwing, on every weekday', () => {
  for (let d = 0; d < 7; d++) {
    const iso = `2026-08-${String(9 + d).padStart(2, '0')}`
    const ctx = buildContext({ plan, entries: movedWeek, iso })
    for (const m of menu) {
      if (m.role === 'adjunct') continue
      const r = scoreSession(m, ctx)
      ok(typeof r.score === 'number' || r.blocked, `${m.id} on ${iso}`)
      ok(r.blocked ? typeof r.why === 'string' && r.why.length > 10 : r.reasons.length > 0,
        `${m.id} on ${iso} must explain itself`)
    }
  }
})

check('every non-adjunct menu session declares its scheduling facts', () => {
  for (const m of menu) {
    if (m.role === 'adjunct') continue
    ok(m.sched, `${m.id} has no sched block`)
    ok(['hard', 'light', 'sub', 'none', 'variable'].includes(m.sched.fingerLoad), `${m.id} fingerLoad`)
  }
})

check('there is always a recommendation, even with nothing logged', () => {
  for (let d = 0; d < 7; d++) {
    const iso = `2026-08-${String(9 + d).padStart(2, '0')}`
    const rec = recommend({ plan, entries: [], iso, ignorePlanned: true })
    ok(rec?.opt, `no recommendation for ${iso}`)
    ok(rec.why.length > 5, `no why for ${iso}`)
  }
})

/* ------------------------------------------- what the check-in said about today */

/*
 * The check-in's three hard fields, and the reason they are hard blocks.
 *
 * This is the bug that produced them: a check-in set to home and 50 minutes,
 * with a message saying the gym was out tonight, and the day list went on
 * leading with a 75-minute gym session. The fields were collected, shown to the
 * coach and read by nothing. The engine's venue term came from `gymDays` — from
 * it being a Thursday — so the app was arguing with the user about where they were.
 */

const CHECKIN_ISO = '2026-08-13'
const checkin = (fields) => [{
  id: `checkin-${CHECKIN_ISO}`, kind: 'checkin', date: CHECKIN_ISO, updatedAt: 'z', data: { fields },
}]

check('the check-in fields are declared as facts in the plan, not guessed at in code', () => {
  const fields = plan.checkin?.fields || []
  for (const informs of ['venue', 'window', 'fingers']) {
    ok(fields.some(f => f.informs === informs), `no check-in field informs '${informs}'`)
  }
  const where = fields.find(f => f.informs === 'venue')
  // "You're gym tonight" is what gluing a label into prose gets you.
  ok(where.options?.every(o => o.phrase), 'every venue option needs a phrase to read as a sentence')
})

check('the bug: a gym session is not offered to a man standing in his kitchen', () => {
  const entries = [buildQuotaEntry(mondayOf(CHECKIN_ISO), { pe: 2 }), ...checkin({ where: 'home' })]
  const rec = recommend({ plan, entries, iso: CHECKIN_ISO, ignorePlanned: true })
  eq(rec.opt.sched.venue !== 'gym', true, `recommended ${rec.opt.id}, which needs the gym`)
  // The week still owes two power-endurance sessions and every one of them needs
  // the gym, which is the single most useful sentence on the day.
  ok(rec.displaced, 'something the week owes is blocked and it should say so')
  eq(rec.displaced.opt.category, 'pe')
  ok(/at home/.test(rec.displaced.why), `and says why not: ${rec.displaced.why}`)
})

check('...and having said nothing, nothing at all is assumed', () => {
  const ctx = buildContext({ plan, entries: [], iso: CHECKIN_ISO })
  eq(JSON.stringify(ctx.facts), '{"venue":null,"window":null,"fingers":null}')
  const r = scoreSession(opt('board'), ctx)
  ok(!r.blocked, 'with no stated venue the board is on the table, whatever day it is')
  ok(!r.reasons.some(x => /gym day/i.test(x.text)),
    'and the app does not guess his evening from the calendar any more')
})

check('a stated venue is spent as the block and scores nothing on top', () => {
  // Once the user has said where the user is, everything still on the table is somewhere the user
  // can be. A term every survivor earns equally decides no ranking, and it would
  // push the one informative sentence off the top of the reasoning card.
  const blind = buildContext({ plan, entries: [], iso: CHECKIN_ISO })
  const home = buildContext({ plan, entries: checkin({ where: 'home' }), iso: CHECKIN_ISO })
  eq(scoreSession(opt('crawls'), home).score, scoreSession(opt('crawls'), blind).score,
    'a home session scores the same either way')
  ok(!scoreSession(opt('crawls'), home).reasons.some(r => /you're at home/i.test(r.text)),
    'and does not spend the top reason saying he is where he said he is')
})

check('a session longer than the window he gave is off the table', () => {
  const ctx = buildContext({ plan, entries: checkin({ minutes: 20 }), iso: CHECKIN_ISO })
  const r = scoreSession(opt('board'), ctx)   // 75 minutes
  ok(r.blocked, 'a 75-minute session in a 20-minute window')
  ok(/20 minutes/.test(r.why), `and says so: ${r.why}`)
  ok(!scoreSession(opt('core'), ctx).blocked, 'a 14-minute one still fits')
})

check('the window is the whole evening, not the slot after the main session', () => {
  const entries = checkin({ where: 'home', minutes: 30 })
  const rec = recommend({ plan, entries, iso: CHECKIN_ISO, ignorePlanned: true })
  const picks = companions({ plan, entries, iso: CHECKIN_ISO, mainId: rec.opt.id })
  const total = (rec.opt.minutes || 0) + picks.reduce((n, p) => n + (p.opt.minutes || 0), 0)
  ok(total <= 30, `the day adds up to ${total} minutes against the 30 he has`)
})

check('fingers right now beat fingers after Tuesday', () => {
  // Yesterday's session read 4/5. The user says they are fine today, and the user is the
  // more recent instrument — being told to rest on Tuesday's data is the app
  // arguing with them about their own hands.
  const yesterday = [day('2026-08-12', 'max-hangs', { out: { rpe: 7, fingers: 4 } })]
  const sore = buildContext({ plan, entries: yesterday, iso: CHECKIN_ISO })
  eq(sore.fingersRecent, 4, 'the log is read when nothing else is said')
  eq(sore.fingersSaid, false)

  const said = buildContext({ plan, entries: [...yesterday, ...checkin({ fingers: 1 })], iso: CHECKIN_ISO })
  eq(said.fingersRecent, 1, 'what he just said wins')
  eq(said.fingersSaid, true)
  ok(scoreSession(opt('crawls'), sore).score < scoreSession(opt('crawls'), said).score,
    'and finger work is no longer penalised for a soreness he says is gone')
})

check('...and it works the other way, which is the half that matters', () => {
  const ctx = buildContext({ plan, entries: checkin({ fingers: 5 }), iso: CHECKIN_ISO })
  const hurt = scoreSession(opt('crawls'), ctx)
  ok(hurt.reasons.some(r => /something hurts/.test(r.text)), 'saying it hurts is heard without a session logged')
  ok(scoreSession(opt('off'), ctx).score > hurt.score, 'and rest outranks finger work')
})

check('a fact cannot lift a safety rule — it can only add another one', () => {
  // Yesterday was hard. Saying "I am at the gym with three hours" must not make
  // a back-to-back hard finger day legal.
  const entries = [
    day('2026-08-12', 'board', { out: { rpe: 8, fingers: 3 } }),
    ...checkin({ where: 'gym', minutes: 180 }),
  ]
  const r = scoreSession(opt('board'), buildContext({ plan, entries, iso: CHECKIN_ISO }))
  ok(r.blocked, 'still blocked')
  ok(/back to back/i.test(r.why), `and for the injury reason, not the venue one: ${r.why}`)
})

/* ------------------------------------------------------------- suggestions */

/*
 * What the check-in card offers them.
 *
 * A nudge is capped at 18 points against score gaps of forty, so for two weeks
 * the coach could answer "do the crawls instead", write the nudge, report it as
 * a change, and leave the day byte-identical. The fix is a button, not a bigger
 * nudge: the coach names a session, the card draws *swap in as main* and *add as
 * extra* under the reply, and nothing touches the day until the user presses one.
 *
 * `placeable()` therefore does not gate the coach — it decides whether a BUTTON
 * is offered, and its `why` is the line shown where the buttons would have been.
 */

const buttons = (optId, over = {}) => offers({
  plan, iso: CHECKIN_ISO, entries: checkin({ where: 'home', minutes: 50 }), optId, ...over,
})

check('the fix: the session he asked about comes with a button', () => {
  const b = buttons('crawls')
  ok(b.main.ok, `swap in as main: ${b.main.why || 'offered'}`)
  ok(b.add.ok, `add as extra: ${b.add.why || 'offered'}`)
})

check('a session the day cannot take has no buttons, and says why instead', () => {
  const b = buttons('board')
  ok(!b.main.ok && !b.add.ok, 'neither button')
  ok(/at home/.test(b.main.why), `and the reason is legible: ${b.main.why}`)
})

check('...including the two that can injure him', () => {
  const entries = [
    day('2026-08-12', 'max-hangs', { out: { rpe: 8, fingers: 3 } }),
    ...checkin({ where: 'home' }),
  ]
  const b = buttons('repeaters', { entries })
  ok(!b.main.ok, 'no swap button the day after a hard finger day')
  ok(/back to back/i.test(b.main.why), b.main.why)
})

check('the two buttons can genuinely disagree', () => {
  // Sharing a day is stricter than owning it. Crimp crawls is fine as tonight's
  // main; riding it along with a hard finger session is not.
  const b = buttons('crawls', { mainId: 'max-hangs', entries: checkin({ where: 'home' }) })
  ok(b.main.ok, 'it can be the main session')
  ok(!b.add.ok, 'but not an extra on a hard finger night')
  ok(b.add.why.length > 10, b.add.why)
})

check('the verdict is taken against the day as it stands, not as it was', () => {
  // The core block is home work either way. What changes is what it has to share
  // the evening with, which is why this is recomputed on every render.
  eq(buttons('core', { mainId: 'crawls' }).add.ok, true, 'alongside a home session')
  eq(buttons('core', { mainId: 'crawls', entries: checkin({ where: 'home', minutes: 30 }) }).add.ok,
    false, 'not once the evening is only 30 minutes long')
})

check('once a day, except the card that is genuinely twice', () => {
  // *Other training* is one card covering a run and a lift, and 2026-09-09 was
  // both. Everything else is once a day by nature — two sets of max hangs in an
  // evening is one session with more sets in it, not two sessions.
  const onDay = (optId) => [{
    id: `daily-${CHECKIN_ISO}-${optId}`, kind: 'daily', date: CHECKIN_ISO, updatedAt: 'z',
    data: { optId, slot: 'extra', done: false, out: {} },
  }, ...checkin({ where: 'home' })]

  const again = buttons('log-workout', { entries: onDay('log-workout') })
  ok(again.add.ok, `a second one should be addable: ${again.add.why || ''}`)

  const twice = buttons('core', { entries: onDay('core') })
  ok(!twice.add.ok, 'the core block was offered twice in one day')
  ok(/already on today/.test(twice.add.why), twice.add.why)
})

check('nothing un-logs training he has already done', () => {
  const done = { id: `daily-${CHECKIN_ISO}`, kind: 'daily', date: CHECKIN_ISO, updatedAt: 'z',
    data: { optId: 'max-hangs', slot: 'main', done: true } }
  const b = buttons('max-hangs', { entries: [done, ...checkin({})] })
  ok(!b.remove.ok, 'no take-it-off button')
  ok(/already marked/.test(b.remove.why), b.remove.why)

  const planned = { ...done, data: { ...done.data, done: false } }
  ok(buttons('max-hangs', { entries: [planned, ...checkin({})] }).remove.ok,
    'but one he only planned can come off')
})

check('an extra that would overrun the evening has no add button', () => {
  // Crimp crawls is 22 minutes and the core block is 14. Both are home work and
  // the plan is happy to stack them; thirty minutes is simply not thirty-six.
  const tight = buttons('core', { mainId: 'crawls', entries: checkin({ where: 'home', minutes: 30 }) })
  ok(!tight.add.ok && /30 minutes/.test(tight.add.why), tight.add.why)
  ok(buttons('core', { mainId: 'crawls' }).add.ok, 'and it is offered when the evening is long enough')
})

check('a suggestion naming nothing real offers nothing', () => {
  for (const bad of ['no-such-session', 'hard-home', 'warmup']) {
    const b = buttons(bad)
    ok(!b.main.ok && !b.add.ok && !b.remove.ok, `${bad} must offer no buttons`)
    ok(b.main.why.length > 10, `${bad} must say why not`)
  }
})

/* ------------------------------------------------------ whoop, as a weak term */

/* The whole safety argument for letting a wearable near the recommendation is
 * that it is a CLAMPED WEIGHT read AFTER the hard blocks, exactly like the coach
 * note. These pin that rather than trusting it: the failure mode of WHOOP has to
 * be that nothing happens, and its success mode must still be unable to break a
 * rule that can injure them. */

const cfg = recConfig(plan)
const readiness = (over = {}) => ({
  date: '2026-08-06', recovery: 55, hrv: 53, hrvBaseline: 53, hrvDeltaPct: 0,
  restingHr: 52, restingHrBaseline: 52, restingHrDelta: 0, strain: 9, ...over,
})

check('no reading computes exactly what the app computed before WHOOP existed', () => {
  for (const iso of ['2026-08-06', '2026-08-08', '2026-08-10']) {
    const before = recommend({ plan, entries: movedWeek, iso, ignorePlanned: true })
    for (const r of [null, undefined]) {
      const after = recommend({ plan, entries: movedWeek, iso, ignorePlanned: true, readiness: r })
      eq(after.opt.id, before.opt.id, `${iso}: the pick moved with no reading`)
      eq(after.score, before.score, `${iso}: the score moved with no reading`)
    }
  }
})

check('a middling reading says nothing at all', () => {
  eq(whoopVerdict(readiness(), cfg), null, 'recovery 55 with a flat HRV is not a verdict')
  eq(whoopVerdict(null, cfg), null)
  eq(whoopVerdict({}, cfg), null)
  // And that means the ranking is untouched.
  const before = recommend({ plan, entries: movedWeek, iso: '2026-08-08', ignorePlanned: true })
  const after = recommend({ plan, entries: movedWeek, iso: '2026-08-08', ignorePlanned: true, readiness: readiness() })
  eq(after.score, before.score)
})

check('either red signal alone is a verdict, and both together is a stronger one', () => {
  const low = whoopVerdict(readiness({ recovery: 28 }), cfg)
  eq(low.band, 'red')
  eq(low.strength, 0.6, 'one signal is a soft verdict')
  const drop = whoopVerdict(readiness({ hrv: 42, hrvDeltaPct: -21 }), cfg)
  eq(drop.band, 'red')
  const both = whoopVerdict(readiness({ recovery: 28, hrv: 42, hrvDeltaPct: -21 }), cfg)
  eq(both.strength, 1, 'two independent signals agreeing is worth more than one')
  ok(/recovery 28%/.test(both.why) && /HRV -21%/.test(both.why), `the why must name both: ${both.why}`)
  eq(whoopVerdict(readiness({ recovery: 80 }), cfg).band, 'green')
})

check('a red morning pushes hard work down and easy work up, and says why', () => {
  const iso = '2026-08-08' // Saturday, two clear days after Wednesday's gym day
  const red = readiness({ recovery: 25, hrv: 41, hrvDeltaPct: -23 })
  const ctxRed = buildContext({ plan, entries: movedWeek, iso, ignorePlanned: true, readiness: red })
  const ctxNone = buildContext({ plan, entries: movedWeek, iso, ignorePlanned: true })

  const hard = scoreSession(opt('max-hangs'), ctxRed)
  const base = scoreSession(opt('max-hangs'), ctxNone)
  ok(hard.score < base.score, `hard work should cost more on a red morning (${hard.score} vs ${base.score})`)
  const said = hard.reasons.find(r => /^WHOOP:/.test(r.text))
  ok(said, 'the term must carry its own sentence')
  ok(/recovery 25%/.test(said.text), `and name the number: ${said.text}`)

  const easy = scoreSession(opt('subthreshold'), ctxRed)
  ok(easy.score > scoreSession(opt('subthreshold'), ctxNone).score,
    'a red morning needs somewhere to go, not only things it disapproves of')
})

check('the label says WHOOP, so a strap is never mistaken for the programme', () => {
  const ctx = buildContext({
    plan, entries: movedWeek, iso: '2026-08-08', ignorePlanned: true,
    readiness: readiness({ recovery: 25 }),
  })
  for (const id of ['max-hangs', 'board', 'subthreshold', 'core']) {
    for (const r of scoreSession(opt(id), ctx).reasons) {
      if (!/whoop/i.test(r.text)) continue
      ok(r.text.startsWith('WHOOP:'), `unlabelled WHOOP reasoning on ${id}: ${r.text}`)
    }
  }
})

check('a reading is clamped, however extreme the numbers are', () => {
  const cap = cfg.whoop.cap
  const iso = '2026-08-08'
  const absurd = readiness({ recovery: -500, hrv: 1, hrvDeltaPct: -999 })
  const ctx = buildContext({ plan, entries: movedWeek, iso, ignorePlanned: true, readiness: absurd })
  for (const id of ['max-hangs', 'board', 'four-by-four', 'subthreshold', 'core', 'off']) {
    for (const r of scoreSession(opt(id), ctx).reasons) {
      if (!/^WHOOP:/.test(r.text)) continue
      ok(Math.abs(r.points) <= cap, `${id}: ${r.points} exceeds the cap of ${cap}`)
    }
  }
})

check('NO reading can put two hard finger days back to back', () => {
  // Wednesday 5 Aug was a hard finger day, so Thursday is blocked outright. A
  // green morning is exactly the reading that would argue for training hard.
  const green = readiness({ recovery: 99, hrv: 80, hrvDeltaPct: 40 })
  const ctx = buildContext({ plan, entries: movedWeek, iso: '2026-08-06', ignorePlanned: true, readiness: green })
  for (const id of menu.filter(m => fingerLoad(m) === 'hard').map(m => m.id)) {
    const r = scoreSession(opt(id), ctx)
    eq(r.blocked, true, `${id} must stay blocked the day after a hard finger day`)
  }
  const rec = recommend({ plan, entries: movedWeek, iso: '2026-08-06', ignorePlanned: true, readiness: green })
  eq(fingerLoad(rec.opt), 'none', `a perfect recovery score recommended ${rec.opt.id}`)
})

check('NO reading can breach the weekly hard cap', () => {
  const iso = '2026-08-07'
  const spread = [
    day('2026-08-03', 'max-hangs', { out: { rpe: 7, fingers: 2 } }),
    day('2026-08-05', 'board', { out: { rpe: 8, fingers: 3 } }),
    // Three hard finger days already, all legally spaced.
    { ...day('2026-08-01', 'four-by-four'), date: '2026-08-01' },
  ]
  const week = [...spread, day('2026-08-07', 'off')].filter(e => e.date < iso)
  const green = readiness({ recovery: 99, hrv: 80, hrvDeltaPct: 40 })
  const ctx = buildContext({ plan, entries: week, iso, ignorePlanned: true, readiness: green })
  const hardIds = menu.filter(m => fingerLoad(m) === 'hard' && !m.retired).map(m => m.id)
  const capped = hardIds.filter(id => scoreSession(opt(id), ctx).blocked)
  ok(capped.length === hardIds.length || ctx.hardThisWeek < cfg.hardCap,
    'a green morning must not unlock a hard day the weekly cap forbids')
})

check('a reading cannot make a blocked session legal, whatever it says', () => {
  const iso = '2026-08-06'
  for (const r of [null, readiness({ recovery: 99, hrvDeltaPct: 50 }), readiness({ recovery: 3, hrvDeltaPct: -60 })]) {
    const ctx = buildContext({ plan, entries: movedWeek, iso, ignorePlanned: true, readiness: r })
    // Every session blocked with no reading is still blocked with any reading.
    const bare = buildContext({ plan, entries: movedWeek, iso, ignorePlanned: true })
    for (const m of menu.filter(x => !x.retired)) {
      if (!scoreSession(m, bare).blocked) continue
      eq(scoreSession(m, ctx).blocked, true, `${m.id} became legal because of a WHOOP reading`)
    }
  }
})

check('a red morning cannot decide the day is a rest day', () => {
  // It may make rest score better. Choosing it stays their — a wearable that can
  // cancel training is one the user would stop wearing.
  const iso = '2026-08-08'
  const red = readiness({ recovery: 20, hrv: 38, hrvDeltaPct: -30 })
  const rest = scoreSession(opt('off'), buildContext({
    plan, entries: movedWeek, iso, ignorePlanned: true, readiness: red,
  }))
  eq(rest.blocked, false)
  // Rest is available but is not automatically the answer.
  const rec = recommend({ plan, entries: movedWeek, iso, ignorePlanned: true, readiness: red })
  ok(rec.opt, 'there is still a recommendation')
})

check('every refusal is a sentence he can read', () => {
  for (const id of ['board', 'hard-gym', 'no-such-session']) {
    for (const v of Object.values(buttons(id))) {
      if (v.ok) continue
      ok(/[a-z]/.test(v.why) && v.why.trim().endsWith('.'), `not a sentence: ${v.why}`)
    }
  }
})

/* ----------------------------------------------------- the quota board */

/*
 * The day stopped having one answer on 2026-09-08, and stopped being a day at
 * all on 2026-09-14.
 *
 * First fixed gym nights went away — the gym happens when it happens — and the
 * day became three BRANCHES: at the gym, at home, not climbing. Then the app
 * pivoted to two goals and weekly quotas, and the question the day answers
 * changed again: not "where are you" but "what does the week still owe".
 *
 * Lanes are quota categories. What these tests are really for is the thing a
 * board of eleven lanes could plausibly have broken, and which the three
 * branches were tested for before it: the finger budget. Several lanes can offer
 * hard finger work at once; the user logs one; the budget must count one.
 */

const CFG = recConfig(plan)
const QUOTA = (counts, monday = '2026-08-10') => buildQuotaEntry(monday, counts)
const FULL = { pe: 2, fingers: 2, endurance: 1, power: 1, fun: 1, support: 2, bike: 2, run: 1, swim: 1 }

check('the quota categories are content, not code', () => {
  ok(Array.isArray(plan.quotaCategories), 'plan.json must declare quotaCategories')
  ok(plan.quotaCategories.length >= 4, 'a board of two lanes is a schedule again')
  for (const c of lanes(plan)) {
    ok(c.key && c.name && c.icon, `${c.key}: needs a key, a name and an icon`)
    ok(c.discipline, `${c.key}: needs a discipline, or nothing spaces against it`)
    ok(c.blurb, `${c.key}: needs a blurb, or the board is eleven unexplained words`)
  }
})

check('every lane can be filled by something real', () => {
  const b = board({ plan, entries: [QUOTA(FULL)], iso: '2026-08-13' })
  for (const l of b.lanes) {
    ok(l.opt || l.empty, `${l.key}: offers nothing and does not say why`)
    if (l.opt) ok(opt(l.opt.id), `${l.key}: offers "${l.opt.id}", which is not in the menu`)
  }
})

check('a lane with no session of its own opens the workout card, pre-picked', () => {
  // A ride has no protocol and never needed one. The endurance lanes fall back to
  // the log card, which OVERRIDES its own `recommend: false` — a quota the user set is
  // not the app volunteering something unspecified.
  const b = board({ plan, entries: [QUOTA(FULL)], iso: '2026-08-13' })
  for (const key of ['bike', 'run', 'swim']) {
    const lane = b.lanes.find(l => l.key === key)
    ok(lane.logOnly, `${key} should fall back to the workout card`)
    eq(lane.prefill, key, `${key}: should arrive with the activity already picked`)
  }
})

check('the board leads with what the week still owes', () => {
  const entries = [QUOTA({ pe: 1, bike: 2 }), day('2026-08-10', 'board')]
  const b = board({ plan, entries, iso: '2026-08-12' })
  eq(b.lanes[0].key, 'bike', 'pe is done, bike is not')
  ok(b.lanes.findIndex(l => l.key === 'pe') > 0, 'a filled lane sinks')
})

check('a week nobody set up says so, rather than inventing one', () => {
  eq(board({ plan, entries: [], iso: '2026-08-13' }).unset, true)
  eq(board({ plan, entries: [QUOTA(FULL)], iso: '2026-08-13' }).unset, false)
})

check('THE ONE THAT MATTERS: eleven lanes cost at most one hard finger day', () => {
  // Several lanes can offer hard finger work on the same day, because they are
  // alternatives and the user only does one. The budget is counted on what is LOGGED,
  // never on what was offered. If this ever inverts, the app starts refusing
  // training the user has not done.
  const b = board({ plan, entries: [QUOTA(FULL)], iso: '2026-08-13' })
  const offered = b.lanes.filter(l => l.opt && fingerLoad(l.opt) === 'hard')
  ok(offered.length >= 2, 'the case is only interesting when several offer it')
  // The user takes one of them.
  const took = [QUOTA(FULL), day('2026-08-13', offered[0].opt.id)]
  eq(hardDates(took, menu).length, 1, 'one logged session, one exposure')
})

check('...and the lanes obey the spacing rule, all of them at once', () => {
  const prior = [QUOTA(FULL), day('2026-08-12', 'board')]
  const b = board({ plan, entries: prior, iso: '2026-08-13' })
  for (const l of b.lanes) {
    if (l.opt) ok(fingerLoad(l.opt) !== 'hard',
      `${l.key} offered ${l.opt.id} the day after a hard finger day`)
  }
})

check('...and the weekly cap, on every lane at once', () => {
  const spent = [
    QUOTA(FULL),
    day('2026-08-10', 'board'), day('2026-08-12', 'max-hangs'), day('2026-08-14', 'limit-boulder'),
  ]
  const b = board({ plan, entries: spent, iso: '2026-08-16' })
  for (const l of b.lanes) {
    if (l.opt) ok(fingerLoad(l.opt) !== 'hard', `${l.key} offered a fourth hard day`)
  }
})

check('the workout card is still never volunteered outside a lane that names it', () => {
  const ctx = buildContext({ plan, entries: [QUOTA(FULL)], iso: '2026-08-13' })
  ok(!scoreSession(opt('log-workout'), ctx).blocked, 'it must always be addable')
  for (const iso of ISO) {
    const rec = recommend({ plan, entries: [QUOTA(FULL)], iso })
    ok(rec.opt.id !== 'log-workout', `volunteered on ${iso}`)
  }
})

/* ------------------------------------------------------- venue as a filter */

check('saying where you are FILTERS the board rather than penalising it', () => {
  // Venue used to be a branch, a weekday guess and two scoring weights. It is now
  // one thing: a gym session on an evening the user said the user is home is impossible, not
  // unattractive, and it should be absent rather than ranked last.
  const b = board({ plan, entries: [QUOTA(FULL), ...checkin({ where: 'home' })], iso: '2026-08-13' })
  eq(b.venue, 'home')
  for (const l of b.lanes) {
    if (l.opt) ok((l.opt.sched?.venue || 'any') !== 'gym',
      `${l.key} offered ${l.opt.id}, which needs the gym`)
  }
})

check('a lane emptied by where he is says so, instead of vanishing', () => {
  const b = board({ plan, entries: [QUOTA(FULL), ...checkin({ where: 'home' })], iso: '2026-08-13' })
  const pe = b.lanes.find(l => l.key === 'pe')
  ok(!pe.opt, 'every power-endurance session needs the gym')
  ok(pe.empty, 'and the lane has to explain itself rather than disappearing')
})

check('having said nothing, nothing is filtered', () => {
  // The app no longer guesses their evening from the weekday. `hotspotDays` was
  // that guess, and it cost every gym session 22 points on five days a week.
  const b = board({ plan, entries: [QUOTA(FULL)], iso: '2026-08-13' })
  eq(b.venue, null)
  ok(b.lanes.some(l => l.opt && l.opt.sched?.venue === 'climbing-gym'),
    'the climbing gym stays on the table')
})

check('venueAllows is three-valued about having no opinion', () => {
  eq(venueAllows(opt('board'), null), true, 'no stated venue rules nothing out')
  eq(venueAllows(opt('board'), 'home'), false)
  eq(venueAllows(opt('board'), 'climbing-gym'), true)
  eq(venueAllows(opt('log-workout'), 'home'), true, 'a run is a run wherever you are')
})

check('the two gyms are genuinely different places', () => {
  // Until 2026-09-14 `gym` meant the climbing gym, because it was the only gym.
  // Saying "I'm at the gym" must not offer board intervals to a man standing at a
  // squat rack — and must still offer them the lift and the support blocks.
  eq(venueAllows(opt('board'), 'gym'), false, 'the board is not in the weights room')
  eq(venueAllows(opt('log-workout'), 'gym'), true, 'but a lift is')
  eq(venueAllows(opt('hips'), 'gym'), true, 'and so is a hip block — a floor is a floor')
  eq(venueAllows(opt('max-hangs'), 'gym'), false, 'his hangboard dose is a home protocol')
})

check('the programmed pairing outranks whatever the scorer merely likes', () => {
  // Freeing the support blocks to `any` made them eligible on the gym night, and
  // they took both companion slots off the doubled lead laps — which the plan
  // declares as the board night's second half via `sched.stacksWith`.
  const week = [buildQuotaEntry('2026-08-10', { pe: 1, fingers: 1 }),
                day('2026-08-10', 'max-hangs', { out: { rpe: 7, fingers: 2 } })]
  const rec = recommend({ plan, entries: week, iso: '2026-08-13', ignorePlanned: true })
  ok(also(week, '2026-08-13', rec.opt.id).includes('lead-laps'),
    'a pairing the plan declares must not be crowded out by one merely owed')
})

/* ----------------------------------------------------------------- rest */

check('a bad enough week can still say do not train, board or not', () => {
  const grim = [
    QUOTA(FULL),
    ...[...Array(8)].map((_, i) => day(`2026-08-${String(5 + i).padStart(2, '0')}`, 'board',
      { out: { rpe: 9, fingers: 5, skin: 5 } })),
  ]
  const b = board({ plan, entries: grim, iso: '2026-08-13' })
  ok(b.restWins, 'a long grim streak has to be able to outrank the whole board')
})

check('a normal day does not say do not train', () => {
  const b = board({ plan, entries: [QUOTA(FULL)], iso: '2026-08-13' })
  ok(!b.restWins)
  ok(b.lanes.every(l => l.opt || l.empty), 'every lane still answers')
})

console.log(failed ? `\n${failed} test(s) failed` : '\nall recommendation tests pass')
process.exit(failed ? 1 : 0)
