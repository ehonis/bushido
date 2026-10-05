#!/usr/bin/env node
/*
 * Tests for the check-in coach's pure half.
 *
 * These exist because this is the one path where something a browser triggers
 * can change what the app tells the user to do with their fingers. The model run
 * itself is not testable without spending money; everything that decides what
 * its answer is allowed to DO is in server/chat.js, and all of that is here.
 *
 * Run: node server/chat.test.js
 */

const {
  parseRequest, logDigest, planDigest, whoopDigest, mergeNote, suggestions, replyText,
  REPLY_SCHEMA, LIMITS,
} = require('./chat.js')

let failed = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(ok ? `  ok    ${label}` : `  FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`)
}
const ok = (label, cond) => {
  if (!cond) failed++
  console.log(cond ? `  ok    ${label}` : `  FAIL  ${label}`)
}

const TODAY = '2026-08-13'

/* ------------------------------------------------------------- the request */

console.log('\nrequest')

eq('a request needs a date',
  parseRequest({ messages: [{ role: 'you', text: 'hi' }] }).error, 'date must be YYYY-MM-DD')
eq('a request needs something to say',
  parseRequest({ date: TODAY, messages: [] }).error, 'nothing to say')
eq('the last word has to be his',
  parseRequest({ date: TODAY, messages: [{ role: 'coach', text: 'hi' }] }).error, "the last message must be the athlete's")

{
  // A thread longer than the cap keeps the RECENT end — the last thing the user said
  // is the thing being answered.
  const messages = Array.from({ length: 60 }, (_, i) => ({ role: 'you', text: `m${i}` }))
  const parsed = parseRequest({ date: TODAY, messages })
  eq('a long thread is trimmed from the front', parsed.messages.length, 40)
  eq('...keeping the newest message', parsed.messages.at(-1).text, 'm59')
}

{
  const parsed = parseRequest({
    date: TODAY,
    messages: [{ role: 'you', text: 'x'.repeat(9000) }],
    fields: { weightLb: 150, where: 'home', junk: { a: 1 }, long: 'y'.repeat(500) },
  })
  eq('a message is capped', parsed.messages[0].text.length, 2000)
  eq('field values are scalars only', parsed.fields.junk, undefined)
  eq('...and strings are capped', parsed.fields.long.length, 80)
  eq('...and real values survive', [parsed.fields.weightLb, parsed.fields.where], [150, 'home'])
}

/* -------------------------------------------------------------- the digest */

console.log('\ncontext')

const state = {
  entries: {
    a: { id: 'a', kind: 'daily', date: '2026-08-12', data: { optId: 'board', name: 'Gym: board', done: true,
      out: { rpe: 8, fingers: 3, notes: 'grip opened on the last circuit' } } },
    // Planned but not done. A coach that reads this as training would be
    // congratulating them for a session the user skipped.
    b: { id: 'b', kind: 'daily', date: '2026-08-13', data: { optId: 'crawls', done: false, out: {} } },
    // Older than the window.
    c: { id: 'c', kind: 'daily', date: '2026-06-01', data: { optId: 'crawls', done: true, out: {} } },
    // Deleted entries are gone, not "gone from the UI".
    d: { id: 'd', kind: 'daily', date: '2026-08-11', deleted: true, data: { optId: 'crawls', done: true } },
    e: { id: 'e', kind: 'bodyweight', date: '2026-08-12', data: { lb: 150 } },
    f: { id: 'f', kind: 'checkin', date: '2026-08-11', data: { fields: { feeling: 7 },
      messages: [{ role: 'you', text: 'gym moved to Sunday' }, { role: 'coach', text: 'noted' }] } },
    g: { id: 'g', kind: 'skip', date: '2026-08-12', data: { optIds: ['hips'] } },
  },
}

const digest = logDigest(state, TODAY)
eq('the log window holds', digest.sessions.map(s => s.date), ['2026-08-12', '2026-08-13'])
eq('planned is not completed', digest.sessions.find(s => s.date === TODAY).done, false)
eq('his own words survive', digest.sessions[0].notes, 'grip opened on the last circuit')
eq('bodyweight comes along', digest.bodyweight, [{ date: '2026-08-12', lb: 150 }])
eq('what he told the coach before is readable', digest.checkins[0].said, ['gym moved to Sunday'])
ok('the coach\'s own replies are not fed back as his words',
  !JSON.stringify(digest.checkins).includes('noted'))
ok('dismissals are not training history', !JSON.stringify(digest).includes('skip'))

const plan = {
  dailyMenu: [
    { id: 'crawls', name: 'Crimp crawls', role: 'session', minutes: 22, sched: { venue: 'home' } },
    { id: 'board', name: 'Gym: board', role: 'session', minutes: 75, sched: { venue: 'gym', fingerLoad: 'hard' } },
    { id: 'hard-home', name: 'Old pair', role: 'session', retired: true },
  ],
  weeks: [{ n: 2, start: '2026-08-10', end: '2026-08-16', phase: 'base', focus: 'x', gym: 'Thu' }],
  recommender: { hardCap: 3, hardMinGapDays: 2, coachCap: 18,
    hotspotDays: [1, 3, 4, 0], hotspotRule: 'the days he usually gets to the gym',
    branchRule: 'three plans a day', branches: [
      { key: 'gym', label: 'At the gym', short: 'Gym', venue: 'gym' },
      { key: 'home', label: 'At home', short: 'Home', venue: 'home' },
      { key: 'other', label: 'Other training', only: ['other-training'] },
    ] },
}

eq('a retired session is not offered to the coach',
  planDigest(plan, TODAY).sessions.map(s => s.id), ['crawls', 'board'])
eq('the week comes with it', planDigest(plan, TODAY).week.n, 2)
eq('so do the rules it cannot break',
  planDigest(plan, TODAY).rules.hardMinGapDays, 2)

/*
 * And the shape of the day itself. The week template is per-BRANCH now — three
 * picks a weekday, not one — so a coach that is handed it without being told what
 * a branch is goes straight back to announcing what today "is", which is the
 * guess the rebuild exists to stop making. See coach/CHECKIN.md §3b.
 */
eq('the coach knows which days he usually gets to the gym',
  planDigest(plan, TODAY).rules.hotspotDays, [1, 3, 4, 0])
eq('...and that a day has one plan per branch',
  planDigest(plan, TODAY).rules.branches.map(b => b.key), ['gym', 'home', 'other'])
eq('...and what each branch selects from the menu',
  planDigest(plan, TODAY).rules.branches.map(b => b.venue || (b.only || []).join()),
  ['gym', 'home', 'other-training'])
ok('...and the rule in prose, not just the list',
  Boolean(planDigest(plan, TODAY).rules.branchRule && planDigest(plan, TODAY).rules.hotspotRule))

/* --------------------------------------------------------- the whoop digest */

/*
 * What the coach is told about WHOOP.
 *
 * The risk here is not a wrong number, it is a CONFIDENT number: a coach that
 * reads an empty cache as a good morning, treats a three-day-old recovery as this
 * morning's, or calls a workout WHOOP happened to see "your session" is worse
 * than a coach with no band at all. So most of what is pinned below is the
 * refusal to speak.
 */

console.log('\nwhat it tells the coach about whoop')

const CACHE = {
  fetchedAt: '2026-08-13T11:00:00.000Z',
  maxHeartRate: 195,
  recovery: [
    { date: '2026-08-07', recovery: 71, hrv: 54, restingHr: 49, strain: 9.1 },
    { date: '2026-08-08', recovery: 66, hrv: 51, restingHr: 50, strain: 12.4 },
    { date: '2026-08-09', recovery: 74, hrv: 56, restingHr: 48, strain: 8.0 },
    { date: '2026-08-10', recovery: 69, hrv: 53, restingHr: 49, strain: 14.2 },
    { date: '2026-08-11', recovery: 58, hrv: 47, restingHr: 52, strain: 15.8 },
    { date: '2026-08-13', recovery: 34, hrv: 39, restingHr: 57, strain: 4.2 },
    // Tomorrow exists in the cache the moment WHOOP scores a cycle across
    // midnight. It is not today's business.
    { date: '2026-08-14', recovery: 80, hrv: 60, restingHr: 46, strain: 1.0 },
  ],
  workouts: [
    { id: 'w1', date: '2026-08-11', start: '2026-08-11T22:30:00.000Z', sport: 'rock-climbing',
      minutes: 96, strain: 13.1, avgHr: 121, maxHr: 168, zones: { three: 18, four: 6, five: 0 } },
    { id: 'w2', date: '2026-08-11', start: '2026-08-11T20:00:00.000Z', sport: 'weightlifting',
      minutes: 41, strain: 7.2, avgHr: 104, maxHr: 141, zones: { three: 3 } },
    { id: 'old', date: '2026-07-01', start: '2026-07-01T22:00:00.000Z', sport: 'rock-climbing',
      minutes: 60, strain: 9 },
  ],
}

const ENTRIES = [
  { id: 'e1', kind: 'daily', date: '2026-08-11', data: { optId: 'board', name: '4×4s on the board',
    out: { whoop: { id: 'w1', sport: 'rock-climbing', minutes: 96, strain: 13.1, avgHr: 121, maxHr: 168,
      pctAvgHr: 62, pctMaxHr: 86, percentRecorded: 100, zones: { three: 18, four: 6, five: 0 } } } } },
]

eq('no cache is no section at all', whoopDigest(null, TODAY), null)
eq('an empty cache is not a good morning', whoopDigest({ recovery: [], workouts: [] }, TODAY), null)

{
  const d = whoopDigest(CACHE, TODAY, { entries: ENTRIES, now: '2026-08-13T17:00:00.000Z' })
  eq('today is today', d.today.recovery, 34)
  eq('...against his own median, not a population', d.today.hrvBaseline, 53)
  eq('...so the number to reason from is the deviation', d.today.hrvDeltaPct, -26)
  eq('the trend is oldest first', d.days.map(r => r.date), [
    '2026-08-07', '2026-08-08', '2026-08-09', '2026-08-10', '2026-08-11', '2026-08-13'])
  ok('a day WHOOP has not scored is simply absent',
    !d.days.some(r => r.date === '2026-08-12'))
  eq('tomorrow is not today\'s business', d.days.filter(r => r.date > TODAY).length, 0)
  eq('how old the cache is travels with it', d.staleHours, 6)
  eq('heart rate has a ceiling to be read against', d.maxHeartRate, 195)
}

{
  const d = whoopDigest(CACHE, TODAY, { entries: ENTRIES, now: '2026-08-13T17:00:00.000Z' })
  // Both are the 11th; the later START comes first, which is what "newest" means
  // on a day with a lift before the session.
  eq('workouts are newest first', d.workouts.map(w => w.sport),
    ['rock-climbing', 'weightlifting'])
  eq('a workout he attached says which session it is', d.workouts[0].attached, '4×4s on the board')
  eq('one he did not is not his session', d.workouts[1].attached, false)
  eq('the hard part of a session is summed, not tabulated', d.workouts[0].hardMin, 24)
  ok('a workout older than the window is dropped', !d.workouts.some(w => w.date === '2026-07-01'))
}

{
  // WHOOP saying it does not trust its own number has to survive all the way to
  // the prompt as "no reading", not as a low one.
  const calibrating = { ...CACHE, recovery: [{ date: TODAY, recovery: 40, hrv: 44, calibrating: true }] }
  const d = whoopDigest(calibrating, TODAY, { now: '2026-08-13T17:00:00.000Z' })
  eq('a calibrating morning is no reading at all', d.today, null)
  eq('...and says so in the trend too', d.days[0].calibrating, true)
}

{
  // The digest is built from disk, so the request cannot carry one.
  const parsed = parseRequest({
    date: TODAY,
    messages: [{ role: 'you', text: 'how am I?' }],
    readiness: { recovery: 99, hrv: 200 },
  })
  eq('a browser cannot post its own readiness', parsed.readiness, undefined)
}

{
  const { sessions } = logDigest({ entries: Object.fromEntries(ENTRIES.map(e => [e.id, e])) }, TODAY)
  eq('a session carries the snapshot he attached', sessions[0].whoop.avgHr, 121)
  eq('...as a percentage of a real ceiling', sessions[0].whoop.pctAvgHr, 62)
  eq('...and the minutes that were actually hard', sessions[0].whoop.hardMin, 24)
  eq('a full recording needs no caveat', sessions[0].whoop.percentRecorded, undefined)
  const partial = { id: 'p', kind: 'daily', date: '2026-08-12',
    data: { name: 'x', out: { whoop: { id: 'w9', avgHr: 130, percentRecorded: 43 } } } }
  const one = logDigest({ entries: { p: partial } }, TODAY).sessions[0]
  eq('an average over half a session says so', one.whoop.percentRecorded, 43)
  // WHOOP sends a fraction, and snapshots attached before that was noticed still
  // carry it. A complete session must not reach the coach as a 1% one.
  const asFraction = { id: 'q', kind: 'daily', date: '2026-08-12',
    data: { name: 'x', out: { whoop: { id: 'w8', avgHr: 130, percentRecorded: 1 } } } }
  eq('a fraction of 1 is a complete session, not a caveat',
    logDigest({ entries: { q: asFraction } }, TODAY).sessions[0].whoop.percentRecorded, undefined)
  eq('a session with no snapshot has none', logDigest({ entries: { z: {
    id: 'z', kind: 'daily', date: TODAY, data: { name: 'y', out: {} } } } }, TODAY).sessions[0].whoop, null)
}

/* ---------------------------------------------------------------- the note */

console.log('\nthe note it writes')

const NOW = '2026-08-13T18:00:00.000Z'
const merge = (note, reply) => mergeNote({ note, reply, date: TODAY, cap: 18, model: 'claude-sonnet-5', now: NOW })

{
  const { note, applied } = merge(null, {
    reply: 'x', nudges: [{ optId: 'crawls', points: 10, why: 'home tonight' }], flags: [],
  })
  eq('a day with no note gets one', [note.version, note.date], [1, TODAY])
  eq('the nudge lands', note.nudges, [{ optId: 'crawls', points: 10, why: 'home tonight', from: 'checkin' }])
  eq('and is reported back', applied, [{ optId: 'crawls', points: 10, why: 'home tonight' }])
  ok('a note always has a headline', Boolean(note.headline))
  eq('a chat never claims a plan edit', note.changed, [])
}

{
  // The cap is the app's, not the model's. A note on disk that reads 9000 would
  // be a lie about what the app will do with it.
  const { note } = merge(null, { reply: 'x', nudges: [{ optId: 'crawls', points: 9000, why: 'w' }], flags: [] })
  eq('points are clamped', note.nudges[0].points, 18)
}

{
  // A second check-in the same evening must not throw away the first one's work.
  const earlier = {
    version: 1, date: TODAY, generatedAt: '2026-08-13T17:12:00.000Z', model: 'claude-sonnet-5',
    headline: 'Your last two sessions read fingers 3/5.',
    read: ['RPE has averaged 7.7.'],
    nudges: [{ optId: 'crawls', points: 8, why: 'pump work is owed' }],
    flags: [{ tone: 'warn', text: 'Skin read 4/5 on Saturday.' }],
    changed: [{ optId: 'crawls', what: 'raised the stair', why: 'RPE 4 twice' }],
  }

  const { note } = merge(earlier, {
    reply: 'x', nudges: [{ optId: 'board', points: -18, why: "you're not at the gym" }],
    flags: [{ tone: 'info', text: 'Sunday is the gym day this week.' }],
  })
  eq('an earlier turn\'s nudges survive the next one', note.nudges.length, 2)
  eq('...and its reading survives', note.read, ['RPE has averaged 7.7.'])
  eq('a `changed` entry already on the note is never rewritten', note.changed, earlier.changed)
  eq('its headline stands unless the chat replaces it', note.headline, earlier.headline)
  eq('flags accumulate', note.flags.length, 2)

  const second = merge(note, { reply: 'x', nudges: [], flags: [{ tone: 'info', text: 'Sunday is the gym day this week.' }] })
  eq('the same flag is not added twice', second.note.flags.length, 2)

  const third = merge(note, { reply: 'x', nudges: [{ optId: 'board', points: 0, why: 'he can make it after all' }], flags: [] })
  eq('zero points removes the nudge', third.note.nudges.map(n => n.optId), ['crawls'])
  eq('...and says it did', third.applied, [{ optId: 'board', points: 0, why: 'he can make it after all' }])

  const fourth = merge(note, { reply: 'x', nudges: [{ optId: 'board', points: -5, why: 'still awkward' }], flags: [] })
  eq('a later nudge replaces the earlier one for the same session',
    fourth.note.nudges.find(n => n.optId === 'board').points, -5)
}

{
  // Yesterday's note must not be merged into. Merging would carry stale nudges
  // into a document dated today, which is exactly the failure lib/coach.js's
  // date rule exists to prevent.
  const stale = { version: 1, date: '2026-08-12', headline: 'yesterday', read: ['old'],
    nudges: [{ optId: 'crawls', points: 18, why: 'yesterday' }], flags: [], changed: [] }
  const { note } = merge(stale, { reply: 'x', nudges: [], flags: [] })
  eq('a stale note is replaced, not extended', [note.date, note.nudges.length, note.read.length], [TODAY, 0, 0])
}

{
  const { note } = merge(null, { reply: 'x', nudges: [
    { optId: '', points: 5, why: 'no id' },
    { optId: 'crawls', points: 5, why: '' },
    { optId: 'crawls', points: NaN, why: 'not a number' },
  ], flags: [{ text: '' }] })
  eq('junk nudges are dropped', note.nudges, [])
  eq('junk flags are dropped', note.flags, [])
}

/* --------------------------------------------------------- the suggestions */

/*
 * The sessions it puts forward.
 *
 * These are offers, not actions: the app draws each as a card with buttons and
 * nothing touches the day until the user presses one. So this half only decides
 * SHAPE. Which buttons a card actually gets is the app's call, made live in
 * lib/recommend.js against the same hard blocks the day list enforces — see
 * `offers()` and its tests in app/recommend.test.js.
 */

console.log('\nthe sessions it offers')

{
  const offered = suggestions({ sessions: [
    { action: 'main', optId: 'crawls', why: 'he is at home tonight' },
    { action: 'add', optId: 'board', why: 'and the board after' },
  ] }, plan)
  eq('an offer comes through with its reason', offered.length, 2)
  eq('...and the name the card will show', offered[0].name, 'Crimp crawls')
}

eq('an offer of a session the plan does not have is dropped',
  suggestions({ sessions: [{ action: 'main', optId: 'invented', why: 'x' }] }, plan), [])

eq('...and so is one on a retired card',
  suggestions({ sessions: [{ action: 'main', optId: 'hard-home', why: 'x' }] }, plan), [])

eq('an action that is not one of the three is dropped',
  suggestions({ sessions: [{ action: 'delete', optId: 'crawls', why: 'x' }] }, plan), [])

eq('an offer with no reason is not an offer — a bare button is what this must not be',
  suggestions({ sessions: [{ action: 'main', optId: 'crawls', why: '  ' }] }, plan), [])

{
  const offered = suggestions({ sessions: [
    { action: 'add', optId: 'crawls', why: 'do it' },
    { action: 'remove', optId: 'crawls', why: "no, don't" },
  ] }, plan)
  eq('one card per session', offered.map(p => p.action), ['add'])
}

{
  // Unlike a placement, two mains is a legitimate shortlist now that the user is the
  // one choosing between them — so there is no one-main rule to pin.
  const offered = suggestions({ sessions: [
    { action: 'main', optId: 'crawls', why: 'the pump option' },
    { action: 'main', optId: 'board', why: 'if you can get out after all' },
  ] }, plan)
  eq('two real alternatives are a good answer', offered.map(p => p.optId), ['crawls', 'board'])
}

{
  const many = Array.from({ length: 9 }, (_, i) => (
    { action: 'add', optId: i % 2 ? 'crawls' : 'board', why: `x${i}` }))
  ok('answering with a list of nine is capped',
    suggestions({ sessions: many }, plan).length <= LIMITS.MAX_SUGGESTIONS)
}

eq('a reply that offers nothing is the normal answer', suggestions({ sessions: [] }, plan), [])
eq('...and so is one that omits them', suggestions({}, plan), [])

ok('the schema forces the model to answer the question',
  REPLY_SCHEMA.required.includes('sessions'))

console.log('\nreply text')
eq('an empty reply is not a reply', replyText({ reply: '   ' }), null)
eq('a long reply is trimmed', replyText({ reply: 'x'.repeat(5000) }).length, 1600)

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks pass')
process.exit(failed ? 1 : 0)
