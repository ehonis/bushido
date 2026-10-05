/*
 * The coach — the pure half.
 *
 * `POST /api/chat` runs one headless Claude turn against what the user just said
 * and hands back a reply. Everything in this file is the part that decides what
 * that reply is ALLOWED to do, and it is pure so it can be tested without
 * spending a model run: building the context the model sees, and folding what
 * it returns into today's coach note.
 *
 * The chat is the first thing in this app that lets a browser start a model, so
 * the boundaries are drawn tight and here rather than in the prompt:
 *
 * 1. THE MODEL GETS NO TOOLS. The server assembles the context — the brain
 *    file, a digest of the log, a digest of the plan, a digest of WHOOP, today's
 *    note — and the run is `--tools ""`. It cannot read a file, cannot write
 *    one, and cannot edit content/plan.json. The programme is the user's: it is
 *    edited by hand and reviewed in a diff, never by anything reachable from a
 *    phone.
 *
 * 2. ITS ADVICE IS A COACH NOTE. Reply text, plus nudges and flags folded
 *    into `data/coach.json` for TODAY, read through lib/coach.js, so it
 *    inherits all three of that file's rules for free: advice is dated,
 *    nudges are clamped to
 *    `recommender.coachCap`, and they are read after the hard blocks have
 *    already returned. A check-in cannot put two hard finger days back to back.
 *
 * 3. IT SUGGESTS SESSIONS; IT DOES NOT PLACE THEM. A nudge is worth at most
 *    `coachCap` points against gaps of forty, so for the first two weeks the
 *    coach could say "do crimp crawls instead" and change precisely nothing — it
 *    wrote a +16 nudge onto a session sitting forty points behind, reported it
 *    as a change, and the day was byte-identical on the next refresh. So a reply
 *    may now also return `sessions`. They are OFFERS: the app draws each one as
 *    a card under the reply with buttons on it, and the day does not move until
 *    the user presses one. Nothing on this path ever writes to the training log —
 *    not this file, not the route, not the model. This file checks only that a
 *    suggestion is well-formed and names a session that exists; whether a button
 *    is offered at all is decided in the app by lib/recommend.js `placeable()`,
 *    live, against the same hard blocks the day list uses.
 *
 * 4. WHAT IT OFFERED IS STORED ON THE MESSAGE THAT OFFERED IT. `applied` and
 *    `sessions` go back to the app and are kept on the turn that produced them,
 *    so the thread records both halves: what the user was offered, and which of it the user
 *    took. A coach that silently re-plans the day is the failure mode this whole
 *    feature has to avoid — and so is one that says it re-planned the day and
 *    did not.
 */

/*
 * The same arithmetic the screen uses. `server/whoop.js` is pure ESM and this is
 * CommonJS, which Node resolves; the point of the shared import is that the
 * readiness numbers in this prompt are the numbers on their card, computed once. A
 * second implementation here would drift the first time either side was tuned.
 */
const { readinessFor, baselineFor, attachedIds, hardMinutes, recordedPct, attachedMinutes, isSplit } = require('./whoop.js')
// Strava's half — the same shape of import for the same reason.
const strava = require('./strava.js')
const { speaker } = require('./prompting.js')

const MAX_MESSAGES = 40
const MAX_MESSAGE_CHARS = 2000
const MAX_REPLY_CHARS = 1600
const LOG_DAYS = 21
const CHECKIN_DAYS = 14
// How much of the WHOOP cache the coach sees. Recovery is a trend and needs a
// fortnight to be one; workouts are read one at a time, so a dozen is plenty and
// the ones that matter are already on the sessions in the log digest.
const WHOOP_DAYS = 14
const WHOOP_WORKOUTS = 12
// Strava is read as weeks — a big riding week is what tires the legs, and a
// month of them is a trend — plus the recent rides one at a time.
const STRAVA_DAYS = 28
const STRAVA_ACTIVITIES = 12
// Answering "what should I do tonight" with a list of nine is not answering it.
// Three is a swap plus two things around it, or a shortlist to choose between.
const MAX_SUGGESTIONS = 3

/** Which button the coach thinks is the answer. Mirrored in app/src/lib/checkin.js. */
const PLACEMENT_ACTIONS = ['main', 'add', 'remove']

const isIso = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)

/** N days before an ISO date, as an ISO date. Dates only — no clock, no zone. */
function daysBefore(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

/* ------------------------------------------------------------- the request */

/**
 * What a browser is allowed to send. Everything here only ever reaches the
 * prompt — the reply's authority is the nudge cap and nothing else — but a
 * request that can grow without bound is a request that can cost without bound.
 */
function parseRequest(body) {
  if (!body || typeof body !== 'object') return { error: 'expected a JSON body' }
  const date = isIso(body.date) ? body.date : null
  if (!date) return { error: 'date must be YYYY-MM-DD' }

  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .map(m => ({ role: m?.role === 'coach' ? 'coach' : 'you', text: str(m?.text, MAX_MESSAGE_CHARS) }))
    .filter(m => m.text)
    .slice(-MAX_MESSAGES)
  if (!messages.length) return { error: 'nothing to say' }
  if (messages.at(-1).role !== 'you') return { error: 'the last message must be the athlete\'s' }

  const fields = {}
  for (const [k, v] of Object.entries(body.fields || {})) {
    if (typeof k !== 'string' || k.length > 40) continue
    if (typeof v === 'number' && Number.isFinite(v)) fields[k] = v
    else if (typeof v === 'boolean') fields[k] = v
    else if (typeof v === 'string') fields[k] = v.slice(0, 80)
  }

  /*
   * WHOOP is NOT taken from the request.
   *
   * It used to be: the browser posted the ten readiness numbers it had already
   * computed for the recommender, and for one sentence of prose that was a fair
   * trade. The coach now gets the fortnight — trend, baselines, workouts, and
   * which of them the user attached to a session — and a digest that size is worth
   * lying to a coach with. It is built server-side from `data/whoop.json`, which
   * sits on the same disk as this process, so nothing about WHOOP arrives here
   * from a phone at all. See `whoopDigest`.
   */
  return {
    date, messages, fields,
    today: body.today && typeof body.today === 'object' ? body.today : null,
  }
}

/* ------------------------------------------------------------- the context */

/** The training log, trimmed to what a coach actually reads. */
function logDigest(state, date, { days = LOG_DAYS } = {}) {
  const since = daysBefore(date, days)
  const all = Object.values(state?.entries || {}).filter(e => e && !e.deleted)
  const byDate = (a, b) => String(a.date || '').localeCompare(String(b.date || ''))

  const sessions = all
    .filter(e => e.kind === 'daily' && e.date >= since)
    .sort(byDate)
    .map(e => {
      const d = e.data || {}
      const out = d.out || {}
      return {
        date: e.date,
        session: d.optId || null,
        name: d.name || null,
        slot: d.slot === 'extra' ? 'extra' : 'main',
        // Planning is not completing, and a coach that cannot tell the two apart
        // will congratulate them for a week the user did not train.
        done: d.done !== false,
        minutes: num(d.minutes),
        level: num(d.level),
        rpe: num(out.rpe),
        fingers: num(out.fingers),
        skin: num(out.skin),
        notes: str(out.notes, 400),
        improve: str(out.improve, 400),
        // The snapshot the user attached themselves, if the user did. This is the only place in
        // the prompt where a heart rate is joined to a session as FACT — the user
        // pressed the button that says these are the same thing. Trimmed to what
        // a coach reads: the whole snapshot carries zone-by-zone minutes and a
        // WHOOP id, and neither belongs in a paragraph about their week.
        whoop: whoopOnSession(out.whoop),
        // Likewise the ride the user attached — what the session WAS, not how it felt.
        strava: stravaOnSession(out.strava),
      }
    })

  const bodyweight = all
    .filter(e => e.kind === 'bodyweight' && e.date >= daysBefore(date, 120))
    .sort(byDate)
    .map(e => ({ date: e.date, lb: num(e.data?.lb) }))
    .filter(e => e.lb)

  const tests = all
    .filter(e => e.kind === 'test')
    .sort(byDate)
    .slice(-12)
    .map(e => ({ date: e.date, ...e.data }))

  // What the user told the coach on previous days is a first-class input: "gym moved
  // to Sunday" is only useful on Sunday if Sunday can still read it.
  const checkins = all
    .filter(e => e.kind === 'checkin' && e.date >= daysBefore(date, CHECKIN_DAYS))
    .sort(byDate)
    .map(e => ({
      date: e.date,
      fields: e.data?.fields || {},
      said: (e.data?.messages || [])
        .filter(m => m?.role === 'you' && str(m.text, MAX_MESSAGE_CHARS))
        .map(m => str(m.text, MAX_MESSAGE_CHARS)),
    }))
    .filter(c => c.said.length || Object.keys(c.fields).length)

  return { sessions, bodyweight, tests, checkins }
}

/** The programme, as a table rather than 340 kB of prose. */
function planDigest(plan, date) {
  const week = (plan?.weeks || []).find(w => date >= w.start && date <= w.end) || null
  return {
    sessions: (plan?.dailyMenu || [])
      .filter(m => !m.retired)
      .map(m => ({
        id: m.id,
        name: m.name,
        role: m.role,
        minutes: m.minutes ?? null,
        level: m.level ?? null,
        venue: m.sched?.venue || 'any',
        fingerLoad: m.sched?.fingerLoad || null,
        recommend: m.sched?.recommend !== false,
        // Once a day unless the card says otherwise. *Other training* is one
        // card covering a run and a lift, and a day with both in it is two of
        // them — without this the coach would read a day the user has already logged a
        // run on as a day that card is spent.
        repeatable: m.sched?.repeatable === true,
      })),
    week: week && { n: week.n, phase: week.phase, focus: week.focus, gym: week.gym, watch: week.keyMetric },
    weekTemplate: plan?.weekTemplate || null,
    rules: {
      hardCap: plan?.recommender?.hardCap ?? null,
      hardMinGapDays: plan?.recommender?.hardMinGapDays ?? null,
      coachCap: coachCap(plan),
      rule: plan?.recommender?.rule || null,
      // The day stopped having one answer on 2026-09-08. Without these the coach
      // reads a `weekTemplate` full of per-branch `picks` with no idea what a
      // branch is, and goes back to telling them what today "is" — which is the
      // guess the rebuild exists to stop making. See CHECKIN.md §3b.
      hotspotDays: plan?.recommender?.hotspotDays || null,
      hotspotRule: plan?.recommender?.hotspotRule || null,
      branchRule: plan?.recommender?.branchRule || null,
      branches: (plan?.recommender?.branches || []).map(b => ({
        key: b.key, label: b.label, venue: b.venue || null, only: b.only || null,
      })),
    },
  }
}

const coachCap = (plan) => {
  const cap = Number(plan?.recommender?.coachCap)
  return Number.isFinite(cap) && cap > 0 ? Math.round(cap) : 18
}

/* --------------------------------------------------------------- whoop */

/**
 * The WHOOP snapshot on one logged session, as a coach reads it.
 *
 * `pctAvgHr` and `hardMin` rather than the raw zone table: "68% of max for 41 of
 * 62 minutes" is a sentence about a session, and six zone counts are a spreadsheet.
 * Both are already computed elsewhere — `snapshotOf` against WHOOP's own max
 * heart rate, and `hardMinutes` for zone three and up — so nothing is derived here.
 */
function whoopOnSession(snap) {
  if (!snap || typeof snap !== 'object') return null
  const out = {
    sport: snap.sport || null,
    // THIS SESSION's minutes. Where one gym visit was logged as two sessions
    // sharing one workout, sending the workout's own length to both would tell
    // the coach the user trained the evening twice.
    minutes: num(attachedMinutes(snap)),
    strain: num(snap.strain),
    avgHr: num(snap.avgHr),
    maxHr: num(snap.maxHr),
    pctAvgHr: num(snap.pctAvgHr),
    pctMaxHr: num(snap.pctMaxHr),
    hardMin: hardMinutes(snap),
  }
  // An average over 43% of a session is not the session's average, and the number
  // must not travel without saying so. Only carried when it is a caveat — and
  // through `recordedPct`, because WHOOP's own scaling would make every complete
  // session look like a 1% one and hand the coach a caveat about all of them.
  const recorded = recordedPct(snap.percentRecorded)
  if (recorded !== null && recorded < 90) out.percentRecorded = recorded
  // Said out loud, because the strain and heart rates beside these minutes are
  // the WHOLE workout's and a coach reading them as this session's would be
  // reading one evening's strain onto two sessions.
  if (isSplit(snap)) out.partOfWorkout = { wholeWorkoutMin: num(snap.minutes) }
  return out
}

/**
 * What WHOOP has on them, as the coach sees it.
 *
 * Built HERE, server-side, from `data/whoop.json` — not taken from the request.
 * The browser used to post today's readiness, and for one sentence of prose that
 * was fine; a fortnight of trend and a dozen workouts is a different thing, and a
 * digest a phone could rewrite is a digest that can be used to talk the coach into
 * something. The cache is on the same disk as this process, so there is no reason
 * to trust anything but it.
 *
 * Three honesty rules are built into the shape rather than left to the prompt:
 *
 * 1. ABSENT READS AS ABSENT. No cache, no band, a revoked grant: this returns
 *    null and the section is not rendered at all. A coach told nothing about
 *    recovery must not conclude the user is recovered, and the surest way to get that
 *    is to give it nothing to misread.
 * 2. STALENESS IS DECLARED. `fetchedAt` and `staleHours` travel with the numbers,
 *    because "recovery 41" from three days ago is not a fact about this morning
 *    and the model cannot tell without being told.
 * 3. A WORKOUT IS NOT A SESSION UNTIL THE USER SAYS SO. Every workout carries
 *    `attached`, and unattached ones are labelled as what they are: something
 *    WHOOP saw. It might be the session, the warm-up, or an hour of belaying.
 *    Nothing in this file joins a workout to a session by time — that is
 *    `rankForSession`, it is a suggestion, and attaching is a tap.
 */
function whoopDigest(cache, date, { entries = [], now = null } = {}) {
  if (!cache || typeof cache !== 'object') return null
  const recovery = Array.isArray(cache.recovery) ? cache.recovery : []
  const workouts = Array.isArray(cache.workouts) ? cache.workouts : []
  if (!recovery.length && !workouts.length) return null

  const fetchedAt = typeof cache.fetchedAt === 'string' ? cache.fetchedAt : null
  const at = fetchedAt ? Date.parse(fetchedAt) : NaN
  const ref = now ? Date.parse(now) : Date.now()
  const staleHours = Number.isFinite(at) && Number.isFinite(ref)
    ? Math.max(0, Math.round(((ref - at) / 3600000) * 10) / 10)
    : null

  const since = daysBefore(date, WHOOP_DAYS)
  const attached = attachedIds(entries)

  // Today's readiness, computed the way the card computes it — including its
  // refusal to speak. `readinessFor` returns null for a missing row and for one
  // WHOOP itself has marked `calibrating`, which is WHOOP saying do not use this.
  const today = readinessFor(cache, date)

  const days = recovery
    .filter(r => r?.date && r.date >= since && r.date <= date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map(r => {
      const row = {
        date: r.date,
        recovery: num(r.recovery),
        hrv: num(r.hrv),
        restingHr: num(r.restingHr),
        strain: num(r.strain),
      }
      if (r.calibrating === true) row.calibrating = true
      return row
    })

  const recent = workouts
    .filter(w => w?.date && w.date >= since && w.date <= date)
    .sort((a, b) => String(b.start || b.date).localeCompare(String(a.start || a.date)))
    .slice(0, WHOOP_WORKOUTS)
    .map(w => {
      // A list now: one workout can be two sessions — see attachedIds.
      const to = attached.get(w.id) || []
      return {
        date: w.date,
        sport: w.sport || null,
        minutes: num(w.minutes),
        strain: num(w.strain),
        avgHr: num(w.avgHr),
        maxHr: num(w.maxHr),
        hardMin: hardMinutes(w),
        // Which logged session it IS, or that it is not one yet. Two names when
        // the user split one gym visit into two sessions, which is a thing the user does.
        attached: to.length ? to.map(h => h.name).join(' + ') : false,
      }
    })

  return {
    fetchedAt,
    staleHours,
    maxHeartRate: num(cache.maxHeartRate),
    today,
    baselines: {
      hrv: baselineFor(cache, date, 'hrv'),
      restingHr: baselineFor(cache, date, 'restingHr'),
    },
    days,
    workouts: recent,
  }
}

/* -------------------------------------------------------------- strava */

// A number or nothing — never a zero standing in for "not measured". A ride with
// no power meter has no watts; 0 W would tell the coach the user soft-pedalled.
const opt = (v) => (v === null || v === undefined || v === '' ? null : num(v))

/** The Strava snapshot on one logged session, as a coach reads it. Nulls dropped. */
function stravaOnSession(snap) {
  if (!snap || typeof snap !== 'object') return null
  const mins = strava.attachedMinutes(snap)
  const out = {
    name: str(snap.name, 80),
    sport: snap.sport || null,
    family: snap.family || null,
    minutes: opt(mins),
    elapsedMinutes: opt(snap.elapsedMinutes),
    distanceMi: opt(snap.distanceMi),
    elevationFt: opt(snap.elevationFt),
    avgMph: opt(snap.avgMph),
    paceLabel: snap.paceLabel || null,
    avgHr: opt(snap.avgHr),
    maxHr: opt(snap.maxHr),
    avgWatts: opt(snap.avgWatts),
    weightedAvgWatts: opt(snap.weightedAvgWatts),
    kilojoules: opt(snap.kilojoules),
    calories: opt(snap.calories),
    sufferScore: opt(snap.sufferScore),
    gear: snap.gear?.name || null,
  }
  for (const k of Object.keys(out)) if (out[k] === null || out[k] === undefined || out[k] === '') delete out[k]
  return out
}

/**
 * What Strava has on them, as the coach sees it. Built server-side from
 * `data/strava.json`, never posted by the phone — the same rule as the WHOOP
 * digest, for the same reason. Absent cache → null → no section at all.
 */
function stravaDigest(cache, date, { entries = [], now = null } = {}) {
  if (!cache || typeof cache !== 'object') return null
  const activities = Array.isArray(cache.activities) ? cache.activities : []
  if (!activities.length) return null

  const fetchedAt = typeof cache.fetchedAt === 'string' ? cache.fetchedAt : null
  const at = fetchedAt ? Date.parse(fetchedAt) : NaN
  const ref = now ? Date.parse(now) : Date.now()
  const staleHours = Number.isFinite(at) && Number.isFinite(ref)
    ? Math.max(0, Math.round(((ref - at) / 3600000) * 10) / 10)
    : null

  const since = daysBefore(date, STRAVA_DAYS)
  const attached = strava.attachedIds(entries)
  const gearName = (id) => cache.gear?.[id]?.name || null

  const recent = activities
    .filter(a => a?.date && a.date >= since && a.date <= date)
    .sort((a, b) => String(b.start || b.date).localeCompare(String(a.start || a.date)))
    .slice(0, STRAVA_ACTIVITIES)
    .map(a => {
      const to = attached.get(a.id) || []
      const row = {
        date: a.date,
        name: str(a.name, 60),
        sport: a.sport || null,
        family: a.family || null,
        minutes: opt(a.movingMin),
        distanceMi: opt(a.distanceMi),
        elevationFt: opt(a.elevationFt),
        avgMph: opt(a.avgMph),
        paceLabel: a.paceLabel || null,
        avgHr: opt(a.avgHr),
        avgWatts: opt(a.avgWatts),
        sufferScore: opt(a.sufferScore),
        gear: gearName(a.gearId),
        attached: to.length ? to.map(h => h.name).join(' + ') : false,
      }
      for (const k of Object.keys(row)) if (row[k] === null || row[k] === undefined || row[k] === '') delete row[k]
      return row
    })

  const weeks = strava.weeklyTotals(activities.filter(a => a?.date && a.date <= date), { weeks: 4, until: date })

  const gear = Object.values(cache.gear || {})
    .filter(g => g && (g.kind === 'bike' || String(g.id || '').startsWith('b')))
    .map(g => ({ name: g.name || g.id, distanceMi: opt(g.distanceMi), primary: Boolean(g.primary), retired: Boolean(g.retired) }))

  return { fetchedAt, staleHours, weeks, activities: recent, gear }
}

/**
 * The prompt. The instructions live in coach/CHECKIN.md so they are reviewable
 * and diffable rather than buried in a template literal here; this only pins
 * the data underneath them.
 */
function buildPrompt({ instructions, brain, plan, state, note, whoop = null, strava = null, request, name = '' }) {
  const { date, messages, fields, today } = request
  const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })

  const section = (title, body) => `\n\n## ${title}\n\n${body}`
  const json = (v) => '```json\n' + JSON.stringify(v, null, 1) + '\n```'

  return [
    instructions,
    section('Today', `It is ${weekday} ${date}.`),
    brain ? section('Who the athlete is (the brain file, verbatim)', brain) : '',
    section('Their check-in fields today', Object.keys(fields).length ? json(fields) : 'They filled none in.'),
    today ? section('What the app is showing them right now', json(today)) : '',
    // Absent has to read as absent rather than as "fine": a coach told nothing
    // about recovery must not conclude the user is recovered. So the whole section
    // disappears when there is no cache, and `today: null` inside it is WHOOP
    // declining to speak — a missing morning, or one it says it is still
    // calibrating — rather than a good one.
    whoop
      ? section('What WHOOP has on them', [
        json(whoop),
        'HOW TO READ THIS. `today` is this morning, and it is null when there is no trustworthy',
        'reading — treat that as no information, never as a good morning. Deltas and `baselines`',
        'are against THEIR OWN median over the fortnight, not a population: a 42 ms HRV means nothing',
        'until you know their normal is 53, so reason from the deviation. `days` is one row per day,',
        'oldest first, and is where a trend lives; one bad night is weather.',
        '',
        'This is a CACHE, refetched from WHOOP, and `staleHours` says how old it is. It may be empty,',
        'missing days, or hours behind — the band often has not synced by the time they leave the gym.',
        '',
        'A workout is only their session where `attached` names one: that is them pressing the button',
        'that says they are the same thing. `attached: false` is a workout WHOOP saw and nothing',
        'more — it might be the session, the warm-up, or an hour of belaying. Do not join them up',
        'yourself and report the result as fact.',
        '',
        'Recovery, HRV and resting HR describe LAST NIGHT, not what they can do tonight. They are worth',
        'a sentence and a nudge; they never outrank the hard rules about spacing hard finger days,',
        'and the app clamps anything you say about them anyway.',
      ].join('\n'))
      : '',
    // Same discipline as WHOOP: absent means absent. No cache, no section.
    strava
      ? section('What Strava has on them', [
        json(strava),
        'HOW TO READ THIS. Strava is what the training WAS — distance, speed, elevation, power —',
        'where WHOOP is how hard it felt to their body. `weeks` is one row per Sunday-start week, newest',
        'first, totals per family (ride, run, walk, …) with a distance-weighted average speed; that is',
        'where a big riding week and tired legs live. `activities` is the recent list. An activity is',
        'only their session where `attached` names one — they pressed the button that says so.',
        '`attached: false` is a ride Strava saw and nothing more; do not join it to a session yourself.',
        '`gear` is each bike and the miles Strava has on it.',
        '',
        'This is a CACHE and `staleHours` says how old it is; a ride finished an hour ago may not be in',
        'it. Miles on the bike do not spend a hard finger day, but they do spend recovery — a long ride',
        'the day before a board session is worth naming, and never a reason to put two hard finger',
        'days together.',
      ].join('\n'))
      : '',
    section('The programme', json(planDigest(plan, date))),
    section(`Their log, last ${LOG_DAYS} days`, json(logDigest(state, date))),
    section("Today's coach note as it stands",
      note ? json(note) : 'There is none — they have not checked in yet today.'),
    section('The conversation', messages.map(m => `${m.role === 'you' ? speaker(name).toUpperCase() : 'YOU'}: ${m.text}`).join('\n\n')),
    section('Now', 'Answer their last message. Return the JSON object described above and nothing else.'),
  ].filter(Boolean).join('')
}

/** The shape the model must return. Enforced by the CLI, re-checked below. */
const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    headline: { type: 'string' },
    nudges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          optId: { type: 'string' },
          points: { type: 'number' },
          why: { type: 'string' },
        },
        required: ['optId', 'points', 'why'],
        additionalProperties: false,
      },
    },
    flags: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tone: { type: 'string', enum: ['info', 'warn'] },
          text: { type: 'string' },
        },
        required: ['tone', 'text'],
        additionalProperties: false,
      },
    },
    sessions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: PLACEMENT_ACTIONS },
          optId: { type: 'string' },
          why: { type: 'string' },
        },
        required: ['action', 'optId', 'why'],
        additionalProperties: false,
      },
    },
  },
  required: ['reply', 'nudges', 'flags', 'sessions'],
  additionalProperties: false,
}

/* ---------------------------------------------------------------- the note */

/**
 * Fold a reply into today's coach note.
 *
 * Returns `{ note, applied }` — the document to write, and what actually
 * changed, so the app can say so on the message that caused it.
 *
 * The rules:
 *
 * - A note for another day is not merged, it is replaced. Yesterday's advice
 *   steering today is the thing lib/coach.js exists to prevent, and merging
 *   into a stale note would smuggle it past the date check.
 * - A nudge REPLACES the earlier nudge for the same session, so a later message
 *   can correct an earlier one. Zero points removes it — that is how "actually,
 *   I can make the gym after all" undoes itself.
 * - Points are clamped here as well as in the app. The app's clamp is the one
 *   that matters, but a note on disk that reads ±9000 would be a lie about what
 *   the app will do with it.
 * - `changed` is never touched. That array is the audit trail for edits to
 *   plan.json, the chat cannot make one, and inventing an entry there would put
 *   a "coach changed" label on a session nothing changed.
 */
function mergeNote({ note, reply, date, cap = 18, model = null, now = new Date().toISOString() }) {
  const base = note && Number(note.version) === 1 && note.date === date
    ? note
    : { version: 1, date, read: [], nudges: [], flags: [], changed: [] }

  const limit = Math.abs(Number(cap)) || 18
  const clamp = (n) => Math.max(-limit, Math.min(limit, Math.round(n)))

  const nudges = new Map((base.nudges || [])
    .filter(n => str(n?.optId, 64) && str(n?.why, 240) && num(n?.points))
    .map(n => [n.optId, { optId: n.optId, points: clamp(num(n.points)), why: str(n.why, 240) }]))

  const applied = []
  for (const raw of reply?.nudges || []) {
    const optId = str(raw?.optId, 64)
    const why = str(raw?.why, 240)
    const points = num(raw?.points)
    if (!optId || why === null || points === null) continue
    if (points === 0) {
      if (nudges.delete(optId)) applied.push({ optId, points: 0, why })
      continue
    }
    const next = { optId, points: clamp(points), why, from: 'checkin' }
    nudges.set(optId, next)
    applied.push({ optId, points: next.points, why })
  }

  const flags = [...(base.flags || [])]
  for (const raw of reply?.flags || []) {
    const text = str(raw?.text, 400)
    if (!text) continue
    if (flags.some(f => f?.text === text)) continue
    flags.push({ tone: raw?.tone === 'warn' ? 'warn' : 'info', text, from: 'checkin' })
  }

  return {
    note: {
      ...base,
      version: 1,
      date,
      generatedAt: now,
      model: model || base.model || 'unknown',
      headline: str(reply?.headline, 300) || str(base.headline, 300) || defaultHeadline(applied),
      read: (base.read || []).slice(0, 6),
      nudges: [...nudges.values()],
      flags: flags.slice(0, 12),
      changed: base.changed || [],
    },
    applied,
  }
}

/**
 * A note has to have a headline — the validator requires one and the card reads
 * badly without it. When a check-in creates the day's note from nothing, this is
 * the honest one: it says where the advice came from.
 */
function defaultHeadline(applied) {
  return applied.length
    ? 'Today was adjusted from your check-in.'
    : 'From your check-in — nothing about today changed.'
}

/* --------------------------------------------------------- the suggestions */

/**
 * The sessions it put forward, cleaned up.
 *
 * These are offers, not actions — the app renders each one as a card with
 * buttons and nothing happens until the user presses one — so this decides SHAPE
 * and nothing else. Whether a button is offered is the app's call, made live
 * against the same hard blocks the day list uses, because that is where the
 * engine and the log both live. What is enforced here is only what can be known
 * from the reply and the menu:
 *
 * - Every `optId` must be a session that exists and is not retired. A suggestion
 *   naming a session the plan does not have would render as a card with no name
 *   and no buttons.
 * - ONE suggestion per session, first wins. Offering the same session twice is
 *   two cards that do the same thing.
 * - At most MAX_SUGGESTIONS. Answering "what should I do tonight" with a list of
 *   nine is not answering it. Note there is no one-main rule: a shortlist of two
 *   or three genuine alternatives is a good answer now that the user is the one
 *   choosing between them.
 * - Every one carries the sentence that justifies it, like every other weighted
 *   term in this app. No reason, no card — a bare button asking them to trust a
 *   chat bubble is exactly what this must not be.
 */
function suggestions(reply, plan) {
  const ids = new Map((plan?.dailyMenu || [])
    .filter(m => m && m.id && !m.retired)
    .map(m => [m.id, m]))

  const out = []
  const seen = new Set()

  for (const raw of reply?.sessions || []) {
    if (out.length >= MAX_SUGGESTIONS) break
    const action = PLACEMENT_ACTIONS.includes(raw?.action) ? raw.action : null
    const optId = str(raw?.optId, 64)
    const why = str(raw?.why, 240)
    if (!action || !optId || !why) continue
    if (!ids.has(optId)) continue
    if (seen.has(optId)) continue
    seen.add(optId)
    out.push({ action, optId, why, name: ids.get(optId).name || optId })
  }
  return out
}

/** Reply text, trimmed to something you can read on a phone. */
const replyText = (reply) => str(reply?.reply, MAX_REPLY_CHARS)

const LIMITS = {
  MAX_MESSAGES, MAX_MESSAGE_CHARS, MAX_REPLY_CHARS, LOG_DAYS, CHECKIN_DAYS, MAX_SUGGESTIONS,
  WHOOP_DAYS, WHOOP_WORKOUTS,
}

module.exports = {
  parseRequest, logDigest, planDigest, whoopDigest, whoopOnSession, stravaDigest, stravaOnSession, coachCap, buildPrompt, REPLY_SCHEMA,
  mergeNote, suggestions, replyText, PLACEMENT_ACTIONS, LIMITS,
}
