#!/usr/bin/env node
/*
 * bushido — self-hosted training log API + static app server.
 *
 * Zero dependencies. Serves the built React app and a small JSON API backed by
 * a single file on disk. Single-owner sign-in (server/auth.js) unless
 * BUSHIDO_AUTH=proxy says something in front already did it.
 *
 *   GET  /setup, /login       first-run account creation and sign-in (server/pages.js)
 *   POST /logout              sign out
 *   GET  /settings            the Settings page; GET/PUT /api/settings behind it
 *   GET  /api/health          liveness + paths ({ ok } only, when not signed in)
 *   GET  /api/content         the program definition (read-only; see config.planFile)
 *   GET  /api/coach           today's coach note (read-only, from data/coach.json)
 *   GET  /api/whoop           cached WHOOP workouts, daily recovery and sleep (data/whoop.json)
 *   POST /api/whoop/pull      refetch from WHOOP now (the "Pull from WHOOP" button)
 *   GET  /api/strava          cached Strava activities + gear + athlete (data/strava.json)
 *   POST /api/strava/pull     refetch from Strava now (the "pull" button)
 *   GET  /api/strava/activity?id=  one activity in full (laps, splits), live through the bridge
 *   GET  /api/goals           Totem goals linked to this app (when the bridge is configured)
 *   GET  /api/coach/threads   the AI coach's conversations; POST /api/coach/chat for a turn
 *   POST /api/plan/workout    { kinds, minutes, goal } -> a prescription, stored nowhere
 *   POST /api/plan/revise     { plan, message } -> the same plan, changed; stored nowhere
 *   POST /api/plan/week       { monday, counts, message, thread } -> the week's quotas, proposed; stored nowhere
 *   GET  /api/state           { version, updatedAt, state }
 *   PUT  /api/state           { state } -> merged with what's on disk, returns merged doc
 *   POST /api/entry           { entry } -> upsert one entry, returns merged doc
 *   GET  /api/export          full state as a download
 *   POST /api/import          replace state wholesale (from an export file)
 *
 * Writes are last-write-wins per entry id, using each entry's own updatedAt.
 * That means two devices can both be offline, both write, and neither loses
 * anything except a genuine same-entry edit — where the later edit wins. No
 * conflict dialogs, ever.
 */

const http = require('http')
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const { spawn } = require('child_process')
const chat = require('./chat.js')
const coach = require('./coach.js')
const planner = require('./planner.js')
const weekplanner = require('./weekplanner.js')
const { createBushidoNotify } = require('./notify.js')
const notifyFacts = require('./notify-facts.js')
const { createConfig } = require('./config.js')
const { ISOLATION } = require('./agentflags.js')
const { createAuth, clientAddress, isLoopback } = require('./auth.js')
const pages = require('./pages.js')

const ROOT = path.resolve(__dirname, '..')
const DATA_DIR = process.env.BUSHIDO_DATA_DIR ? path.resolve(process.env.BUSHIDO_DATA_DIR) : path.join(ROOT, 'data')
/* Everything the owner can change in the browser. See server/config.js. */
const config = createConfig({ root: ROOT, dataDir: DATA_DIR })
const planPath = () => config.planFile().file
const DIST_DIR = process.env.BUSHIDO_DIST_DIR || path.join(ROOT, 'dist')
const STATE_FILE = path.join(DATA_DIR, 'state.json')
const COACH_FILE = path.join(DATA_DIR, 'coach.json')
const WHOOP_FILE = path.join(DATA_DIR, 'whoop.json')
const STRAVA_FILE = path.join(DATA_DIR, 'strava.json')
const BACKUP_DIR = path.join(DATA_DIR, 'backups')
/*
 * Whether the check-in coach runs at all. See the guard on /api/chat.
 * `BUSHIDO_COACH=1` forces it back on for anyone testing the rewrite.
 */
const COACH_ENABLED = process.env.BUSHIDO_COACH === '1'

const PORT = Number(process.env.BUSHIDO_PORT || 8099)
const BIND = process.env.BUSHIDO_BIND || '0.0.0.0'
/* Where to tell a stranger to open the setup link. */
const PUBLIC_URL = (process.env.BUSHIDO_PUBLIC_URL || '').replace(/\/+$/, '')
/*
 * Sign-in. `BUSHIDO_AUTH=proxy`, or `auth.mode: "proxy"` in data/settings.json
 * (written by the migration for an install that predates sign-in), turns it off
 * for an install that sits behind something that already authenticates.
 * Machine callers can use a bearer token: BUSHIDO_API_TOKEN, or the Totem bridge
 * secret when one is configured.
 */
const auth = createAuth({
  dataDir: DATA_DIR,
  mode: () => config.authMode().value,
  // Only the dedicated token. The bridge secret authenticates Bushido to Totem;
  // Totem never calls Bushido's API, so accepting it here would only widen the
  // ways in (and one saved in Settings is readable by whoever can edit them).
  bearerSecrets: () => [process.env.BUSHIDO_API_TOKEN],
})
const MAX_BACKUPS = 60

// The coach. Sonnet rather than Opus, deliberately: this is a conversation the user is
// having standing in the kitchen deciding whether to train, so it is answering in
// seconds that matters, and everything it can decide is capped anyway.
/*
 * The binary, the key and the models all come from config.ai(), resolved per
 * request so a change in Settings applies without a restart.
 */
/* One JSON per conversation. See server/coach.js on why these are files. */
const COACH_DIR = path.join(DATA_DIR, 'coach')
/* Totem's goals, cached like WHOOP and Strava are. See /api/goals below. */
const GOALS_FILE = path.join(DATA_DIR, 'goals.json')
const GOALS_TTL_MS = Number(process.env.BUSHIDO_GOALS_TTL_MS) || 10 * 60 * 1000
const COACH_EFFORT = process.env.BUSHIDO_COACH_EFFORT || 'medium'
const COACH_TIMEOUT_MS = Number(process.env.BUSHIDO_COACH_TIMEOUT_MS) || 180000
/*
 * The workout planner. Same model as the coach and deliberately LOWER effort: it
 * is answering a button the user pressed on the way out of the door, not holding a
 * conversation, and everything it writes is a prescription the user is about to edit
 * anyway. Two minutes is the ceiling, not the target.
 */
const PLANNER_EFFORT = process.env.BUSHIDO_PLANNER_EFFORT || 'low'
const PLANNER_TIMEOUT_MS = Number(process.env.BUSHIDO_PLANNER_TIMEOUT_MS) || 150000
/*
 * The week planner shares the planner's model and timeout and sits one notch
 * higher on effort: it is comparing three weeks of what the user set against what the user
 * did, which is a reading job rather than a writing one, and the user is not standing
 * in gym shorts for this one.
 */
const WEEK_EFFORT = process.env.BUSHIDO_WEEK_EFFORT || 'low'
// Measured, not assumed: the first live turn at medium effort hit the planner's
// 150s ceiling reading state.json whole. Low effort plus a pre-digested
// set-vs-did context (see weekContext in lib/plannerapi.js) is the fix; the
// longer ceiling is the safety net, and the user is not in gym shorts for this one.
const WEEK_TIMEOUT_MS = Number(process.env.BUSHIDO_WEEK_TIMEOUT_MS) || 240000
// Low effort, measured rather than assumed: on the real prompt it answered in
// 30s against 28s at medium and 54s with the default, for a third of the cost
// and a reply that was, if anything, closer to the two sentences CHECKIN.md
// asks for. Everything it can decide is capped at coachCap points anyway.
const CHAT_EFFORT = process.env.BUSHIDO_CHAT_EFFORT || 'low'
const CHAT_TIMEOUT_MS = Number(process.env.BUSHIDO_CHAT_TIMEOUT_MS || 120000)
/* The dormant check-in coach's prompt. It is written for one person and kept as an example. */
const CHECKIN_PROMPT = path.join(ROOT, 'examples', 'coach', 'CHECKIN.md')

/** What every AI route says when there is no CLI to run. */
const AI_MISSING = 'AI is not set up. Open Settings → AI and point Bushido at the Claude Code CLI.'

/** The arguments every model run shares, resolved now. */
function aiRun() {
  const ai = config.ai()
  const a = config.athlete()
  return {
    ai,
    common: {
      bin: ai.bin, env: ai.spawnEnv(),
      repoRoot: ROOT, dataDir: DATA_DIR, brainFile: config.links().brainFile,
      name: a.name, notes: a.notes,
      today: new Date().toISOString().slice(0, 10),
    },
  }
}


const EMPTY_STATE = {
  entries: {},
  settings: {},
  settingsUpdatedAt: '1970-01-01T00:00:00.000Z',
}

// ---------------------------------------------------------------- state I/O

let writeChain = Promise.resolve() // serialises writes so concurrent PUTs can't interleave

function ensureDirs() {
  for (const d of [DATA_DIR, BACKUP_DIR]) fs.mkdirSync(d, { recursive: true })
}

function readStateSync() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8')
    const doc = JSON.parse(raw)
    return {
      version: Number(doc.version) || 0,
      updatedAt: doc.updatedAt || new Date(0).toISOString(),
      state: { ...EMPTY_STATE, ...(doc.state || {}) },
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[bushido] state.json unreadable, refusing to clobber it:', err.message)
      throw err
    }
    return { version: 0, updatedAt: new Date(0).toISOString(), state: structuredClone(EMPTY_STATE) }
  }
}

async function backup(doc) {
  if (!doc || doc.version === 0) return
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = path.join(BACKUP_DIR, `state-${stamp}-v${doc.version}.json`)
  await fsp.writeFile(file, JSON.stringify(doc), 'utf8')
  // Only state snapshots rotate. Anything else in backups/ (plan backups live in
  // backups/plans/, but a hand-placed file too) is never pruned by this.
  const files = (await fsp.readdir(BACKUP_DIR)).filter(f => f.startsWith('state-') && f.endsWith('.json')).sort()
  for (const stale of files.slice(0, Math.max(0, files.length - MAX_BACKUPS))) {
    await fsp.unlink(path.join(BACKUP_DIR, stale)).catch(() => {})
  }
}

async function writeAtomic(doc) {
  const tmp = `${STATE_FILE}.tmp-${process.pid}`
  await fsp.writeFile(tmp, JSON.stringify(doc, null, 2), 'utf8')
  await fsp.rename(tmp, STATE_FILE)
}

/** Last-write-wins merge, per entry id and per settings blob. */
function mergeState(base, incoming) {
  const out = {
    entries: { ...(base.entries || {}) },
    settings: base.settings || {},
    settingsUpdatedAt: base.settingsUpdatedAt || EMPTY_STATE.settingsUpdatedAt,
  }
  for (const [id, entry] of Object.entries(incoming.entries || {})) {
    if (!entry || typeof entry !== 'object') continue
    const mine = out.entries[id]
    const theirs = { ...entry, id, updatedAt: entry.updatedAt || new Date().toISOString() }
    if (!mine || String(theirs.updatedAt) >= String(mine.updatedAt || '')) out.entries[id] = theirs
  }
  if (incoming.settings && String(incoming.settingsUpdatedAt || '') > String(out.settingsUpdatedAt)) {
    out.settings = incoming.settings
    out.settingsUpdatedAt = incoming.settingsUpdatedAt
  }
  return out
}

function commit(mutate) {
  // Queue behind any in-flight write, then read-modify-write under that lock.
  const next = writeChain.then(async () => {
    const current = readStateSync()
    const merged = mutate(current.state)
    const doc = {
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
      state: merged,
    }
    await backup(current)
    await writeAtomic(doc)
    return doc
  })
  writeChain = next.catch(() => {}) // a failed write must not poison the chain
  return next
}

// ------------------------------------------------------------ notifications

/*
 * Push notifications, as Bushido.
 *
 * Its own app on the phone, its own icon and its own VAPID identity — health
 * lives here, personal lives in Totem — but not its own machinery: the queue,
 * the encryption and the ranking are Totem's `notify/`, loaded by path the same
 * way this server already reads Totem's BRIDGE_SECRET. See server/notify.js.
 *
 * Every path below is best effort. Bushido's job is the training log; a notifier
 * that cannot start must never stop a workout being saved.
 */
let notify = null

/* Started from main(), and only when a notify core is configured. */
function startNotify() {
  const core = config.links().notifyCore
  if (!core) return Promise.resolve(null)
  return createBushidoNotify({ log: (...a) => console.log(...a), core, dataDir: DATA_DIR })
    .then((n) => {
      notify = n
      if (n) console.log('[bushido] notifications ready')
      return n
    })
    .catch((e) => { console.log('[bushido] notifications unavailable:', e.message); return null })
}

/** This week's goals, as Bushido already caches them from Totem. */
function cachedGoals() {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'goals.json'), 'utf8')).goals || null
  } catch {
    return null
  }
}

const readCache = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

/**
 * The user just logged a session. Say so, and say what it moved.
 *
 * Sent immediately rather than queued: the whole value is that it lands while the user
 * is still getting their shoes off, and a queued one would wait for the next tick.
 */
async function notifyWorkoutLogged(entry) {
  if (!notify) return
  try {
    const fact = notifyFacts.workoutLoggedFact({ entry, goals: cachedGoals(), now: Date.now() })
    if (!fact) return
    await notify.notifier.deliver({
      title: fact.title,
      body: fact.body,
      url: fact.url,
      category: fact.category,
      factKind: fact.kind,
      tag: `workout:${entry.id}`,
    })
  } catch (e) {
    console.log('[bushido] workout notification failed:', e.message)
  }
}

/**
 * The scheduled half: readiness, unlogged workouts, goal pace.
 *
 * Plans a day the way Totem's digest does — several notifications at the times
 * they can still change what the user does — then drains whatever is due. One tick, no
 * second scheduler, and the same revalidation contract: an entry is re-checked
 * against live state seconds before it is sent.
 */
let notifyTickRunning = false
async function notifyTick() {
  if (!notify || notifyTickRunning) return
  notifyTickRunning = true
  try {
    const now = Date.now()
    const snapshot = () => ({
      state: readStateSync().state,
      whoop: readCache(WHOOP_FILE),
      strava: readCache(STRAVA_FILE),
      goals: cachedGoals(),
      now,
    })

    // Re-plan once a day, in the morning, and let the queue carry the rest.
    const today = new Date(now).toISOString().slice(0, 10)
    if (notifyPlannedOn !== today) {
      const facts = notifyFacts.collectScheduledFacts(snapshot())
      if (facts.length) {
        const plan = notify.plan.planDay({
          facts,
          now,
          tz: config.tz(),
          settings: {},
          source: 'bushido-daily',
          categories: notify.categories,
        })
        if (plan.entries.length) await notify.store.applyPlan(plan)
      }
      notifyPlannedOn = today
    }

    await notify.notifier.drain({
      at: now,
      // Re-check against live state: a workout logged since the plan was built
      // should cancel the nudge about it, not arrive anyway.
      revalidate: async (entry) => {
        if (!entry.revalidate) return { state: 'fresh' }
        const facts = notifyFacts.collectScheduledFacts(snapshot())
        const live = new Set(facts.map((f) => f.revalidate?.factKey).filter(Boolean))
        if (live.has(entry.revalidate.factKey)) return { state: 'fresh' }
        return entry.resolvedTitle ? { state: 'resolved' } : { state: 'stale' }
      },
    })
  } catch (e) {
    console.log('[bushido] notification tick failed:', e.message)
  } finally {
    notifyTickRunning = false
  }
}
let notifyPlannedOn = null

// ----------------------------------------------------------- totem bridge

/*
 * Push the daily habit into Totem (the personal-assistant bridge on :8787) so
 * the streak shows up there too. Totem already owns the "move-every-day" habit
 * with months of history; we are a writer into it, not a second store.
 *
 * Deliberately server-side: BRIDGE_SECRET never reaches the browser. And
 * deliberately fire-and-forget — Totem being down must never fail a training
 * log, because the training log is the thing that matters.
 */

/*
 * All of it is optional and off on a fresh install: no URL, no bridge. The URL,
 * the secret and the habit id resolve from config per call (Settings or env).
 */
const totemUrl = () => config.totem().url
const NOT_CONFIGURED = 'not configured — set up the Totem bridge in Settings → Integrations'

let totemLast = { at: null, ok: null, detail: 'no sync attempted yet' }

function totemSecret() {
  return config.totem().secret()
}

/**
 * A session only counts once you have said you did it. Putting one on the day —
 * swapping your main, adding an extra — is planning, not completing, and must
 * never mark the habit. Entries written before `done` existed have no flag and
 * were only ever created by pressing "log this", so they count.
 */
const isDone = (entry) => !entry?.deleted && entry?.data?.done !== false

/**
 * Everything except a deliberate rest day marks the habit — the Totem habit is
 * "Move Every Day", not "Hangboard", so a run, a lift and a board session all
 * count the same. Rest is the one thing that does not: logging a chosen rest day
 * as movement would put false data in a series kept since July.
 */
/* One definition, in server/notify-facts.js, so the habit rollup and the "nice
   session" notification cannot disagree about what a rest day is. */
const isRest = (entry) => notifyFacts.isRestEntry(entry)

/** "Bouldering 4×4s (RPE 8, fingers 3/5) — grip opened on circuit 4" */
function describeSession(entry, withNote) {
  const d = entry.data || {}
  const out = d.out || {}
  const bits = []
  if (Number.isFinite(out.rpe)) bits.push(`RPE ${out.rpe}`)
  if (Number.isFinite(out.intensity)) bits.push(`intensity ${out.intensity}/4`)
  if (Number.isFinite(out.fingers)) bits.push(`fingers ${out.fingers}/5`)
  const stat = bits.length ? ` (${bits.join(', ')})` : ''
  // "How did it feel?" was retired on 2026-09-06 for asking what the RPE slider
  // already asks, so the free text on a new entry is "what to improve". Old
  // entries still carry `notes`, and they still read better here, so they win.
  const note = withNote ? String(out.notes || out.improve || '').trim() : ''
  return `${d.name || 'session'}${stat}${note ? ` — ${note}` : ''}`
}

/**
 * One habit record per DAY, not per session. A day can hold a main session plus
 * any number of extras; syncing them individually made the last one written win
 * and silently discard the rest.
 */
function habitBodyForDay(dateIso, state) {
  const done = Object.values(state?.entries || {})
    .filter(e => e?.kind === 'daily' && e.date === dateIso && isDone(e))
    .sort((a, b) =>
      Number(a.data?.slot === 'extra') - Number(b.data?.slot === 'extra') ||
      String(a.id).localeCompare(String(b.id)))

  const build = (withNotes) => {
    const parts = done.map(e => describeSession(e, withNotes))
    return parts.length ? `bushido: ${parts.join(' · ')}` : ''
  }
  // Totem caps the note at 500 chars; drop the free text before losing sessions.
  let note = build(true)
  if (note.length > 500) note = build(false)
  if (note.length > 500) note = `${note.slice(0, 497)}...`

  return { id: config.totem().habit, date: dateIso, count: done.filter(e => !isRest(e)).length, note }
}

async function syncHabitDay(dateIso, state) {
  if (!dateIso || !config.totem().habitSync) return
  const TOTEM_URL = totemUrl()
  const secret = totemSecret()
  if (!secret) {
    totemLast = { at: new Date().toISOString(), ok: false, detail: 'no BRIDGE_SECRET found' }
    return
  }
  const body = habitBodyForDay(dateIso, state)
  try {
    const ctl = AbortSignal.timeout(4000)
    const res = await fetch(`${TOTEM_URL}/api/habits/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify(body),
      signal: ctl,
    })
    totemLast = {
      at: new Date().toISOString(),
      ok: res.ok,
      detail: res.ok ? `${dateIso} count=${body.count}` : `HTTP ${res.status}`,
    }
    if (!res.ok) console.error('[bushido] totem habit sync failed:', res.status)
  } catch (err) {
    totemLast = { at: new Date().toISOString(), ok: false, detail: err.message }
    console.error('[bushido] totem unreachable:', err.message)
  }
}

// ------------------------------------------------------------------- whoop

/*
 * WHOOP workouts and daily recovery, through the Totem bridge.
 *
 * Bushido holds no WHOOP credentials. WHOOP rotates its refresh token on every
 * refresh and invalidates the old pair, so exactly one process may hold it, and
 * that is the bridge — which has held it since the sleep sync was built. Giving
 * Bushido its own copy would mean two grants for one member and one of them dying
 * quietly. So this is a read through the bridge with the secret we already read
 * for the habit push. See server/whoop.js for what is cached versus what is their.
 *
 * Everything here is best-effort. A WHOOP outage, a revoked grant, a bridge that
 * is down: all of them leave the cache exactly as it was and none of them may
 * fail a request the app needs to load. The training log is the thing that
 * matters, and it does not need WHOOP to work.
 */

const WHOOP_DAYS = Number(process.env.BUSHIDO_WHOOP_DAYS || 21)
// How stale the cache may be before opening the app refreshes it. Ten minutes is
// well inside WHOOP's 100/min limit even with the app open on two devices, and
// the band usually has not synced by the time the user leaves the gym anyway — which is
// what the Pull button is for.
const WHOOP_TTL_MS = Number(process.env.BUSHIDO_WHOOP_TTL_MS || 10 * 60 * 1000)

let whoopState = { at: null, ok: null, detail: 'no pull attempted yet' }
let whoopInFlight = null

function readWhoopCache() {
  try {
    return JSON.parse(fs.readFileSync(WHOOP_FILE, 'utf8'))
  } catch {
    return null
  }
}

async function writeWhoopCache(doc) {
  await fsp.mkdir(DATA_DIR, { recursive: true })
  const tmp = `${WHOOP_FILE}.tmp-${process.pid}`
  await fsp.writeFile(tmp, JSON.stringify(doc, null, 2))
  await fsp.rename(tmp, WHOOP_FILE)
}

/**
 * Pull from the bridge and replace the cache.
 *
 * Serialised through `whoopInFlight`: opening the app on a phone and a laptop at
 * once would otherwise start two pulls and have them race to rename the same
 * file. The second caller waits on the first's result rather than starting again.
 */
function pullWhoop({ days = WHOOP_DAYS } = {}) {
  if (!config.totem().whoop) return Promise.resolve({ ok: false, error: NOT_CONFIGURED })
  if (whoopInFlight) return whoopInFlight
  const TOTEM_URL = totemUrl()
  whoopInFlight = (async () => {
    const secret = totemSecret()
    if (!secret) {
      whoopState = { at: new Date().toISOString(), ok: false, detail: 'no BRIDGE_SECRET found' }
      return { ok: false, error: whoopState.detail }
    }
    try {
      const url = `${TOTEM_URL}/api/whoop/training?days=${encodeURIComponent(days)}`
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${secret}` },
        // Four WHOOP collections, paginated. Generous, but bounded — the app never
        // waits on this, so a slow pull costs nothing but a stale card.
        signal: AbortSignal.timeout(25000),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        // The bridge puts the FIX in the message — "reconnect WHOOP to grant the
        // scope" — so it is carried through verbatim rather than flattened to a
        // status code the card cannot act on.
        const detail = body?.error || `HTTP ${res.status}`
        whoopState = { at: new Date().toISOString(), ok: false, detail }
        return { ok: false, error: detail }
      }
      const doc = {
        fetchedAt: body.fetchedAt || new Date().toISOString(),
        days: body.days ?? days,
        maxHeartRate: body.maxHeartRate ?? null,
        workouts: Array.isArray(body.workouts) ? body.workouts : [],
        recovery: Array.isArray(body.recovery) ? body.recovery : [],
        // Absent from a bridge older than 2026-10-07; the sleep card just stays away.
        sleep: Array.isArray(body.sleep) ? body.sleep : [],
      }
      await writeWhoopCache(doc)
      whoopState = {
        at: doc.fetchedAt,
        ok: true,
        detail: `${doc.workouts.length} workouts, ${doc.recovery.length} days, ${doc.sleep.length} nights`,
      }
      return { ok: true, ...doc }
    } catch (err) {
      whoopState = { at: new Date().toISOString(), ok: false, detail: err.message }
      return { ok: false, error: err.message }
    }
  })().finally(() => { whoopInFlight = null })
  return whoopInFlight
}

/**
 * Refresh in the background if the cache is stale, and return immediately.
 *
 * The app opening must never wait on WHOOP: this fires the pull and hands back
 * whatever is on disk right now. The next load gets the fresher copy, and the
 * Pull button exists for the case where the user wants it this second.
 */
function refreshWhoopIfStale() {
  if (!config.totem().whoop) return
  const cache = readWhoopCache()
  const age = cache?.fetchedAt ? Date.now() - Date.parse(cache.fetchedAt) : Infinity
  if (!(age > WHOOP_TTL_MS)) return
  pullWhoop().catch(() => {}) // logged in whoopState; never thrown at a request
}

// ------------------------------------------------------------------ strava

/*
 * Strava activities, through the Totem bridge — the same arrangement as WHOOP
 * and for the same reason: the bridge holds the one grant, Bushido holds none.
 * `GET /api/strava/training` hands back the recent activities already shaped
 * (both unit systems, the athlete's local date), the gear they were on, and the
 * athlete's weight/FTP. See server/strava.js for what is cached versus what is
 * their. Best-effort throughout: Strava down, the bridge down, a revoked grant —
 * the cache stays as it was and no request the app needs may fail.
 */

const STRAVA_DAYS = Number(process.env.BUSHIDO_STRAVA_DAYS || 21)
const STRAVA_TTL_MS = Number(process.env.BUSHIDO_STRAVA_TTL_MS || 10 * 60 * 1000)

let stravaState = { at: null, ok: null, detail: 'no pull attempted yet' }
let stravaInFlight = null

function readStravaCache() {
  try {
    return JSON.parse(fs.readFileSync(STRAVA_FILE, 'utf8'))
  } catch {
    return null
  }
}

async function writeStravaCache(doc) {
  await fsp.mkdir(DATA_DIR, { recursive: true })
  const tmp = `${STRAVA_FILE}.tmp-${process.pid}`
  await fsp.writeFile(tmp, JSON.stringify(doc, null, 2))
  await fsp.rename(tmp, STRAVA_FILE)
}

/** Pull from the bridge and replace the cache. Serialised like the WHOOP pull. */
function pullStrava({ days = STRAVA_DAYS } = {}) {
  if (!config.totem().strava) return Promise.resolve({ ok: false, error: NOT_CONFIGURED })
  if (stravaInFlight) return stravaInFlight
  const TOTEM_URL = totemUrl()
  stravaInFlight = (async () => {
    const secret = totemSecret()
    if (!secret) {
      stravaState = { at: new Date().toISOString(), ok: false, detail: 'no BRIDGE_SECRET found' }
      return { ok: false, error: stravaState.detail }
    }
    try {
      const url = `${TOTEM_URL}/api/strava/training?days=${encodeURIComponent(days)}`
      const res = await fetch(url, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(25000) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        // The bridge puts the FIX in the message — "connect Strava from Settings",
        // "reconnect to grant activity:read_all" — so it travels verbatim.
        const detail = body?.error || `HTTP ${res.status}`
        stravaState = { at: new Date().toISOString(), ok: false, detail }
        return { ok: false, error: detail }
      }
      /*
       * The profile picture comes from a SECOND endpoint.
       *
       * `/api/strava/training` trims the athlete to the six fields training cares
       * about — id, name, weight, FTP, units — and drops `profile`. The full
       * athlete is on `/api/strava/athlete`, which is where the avatar lives.
       *
       * Fetched separately and NEVER allowed to fail the pull: a missing picture
       * is a header that falls back to initials, and losing four weeks of
       * activities over it would be the tail wagging the dog. Same reason the
       * Totem habit push is fire-and-forget.
       */
      const fullAthlete = await fetch(`${TOTEM_URL}/api/strava/athlete`, {
        headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(8000),
      })
        .then(r => (r.ok ? r.json() : null))
        .then(a => a?.athlete || null)
        .catch(() => null)

      const doc = {
        fetchedAt: body.fetchedAt || new Date().toISOString(),
        days: body.days ?? days,
        athlete: body.athlete
          ? {
              ...body.athlete,
              firstname: fullAthlete?.firstname ?? null,
              username: fullAthlete?.username ?? null,
              // `profileMedium` is the one the header uses; the large one is
              // there for a retina avatar without a second round trip.
              profile: fullAthlete?.profile ?? null,
              profileMedium: fullAthlete?.profileMedium ?? null,
            }
          : (fullAthlete || null),
        gear: body.gear && typeof body.gear === 'object' ? body.gear : {},
        activities: Array.isArray(body.activities) ? body.activities : [],
      }
      await writeStravaCache(doc)
      stravaState = { at: doc.fetchedAt, ok: true, detail: `${doc.activities.length} activities` }
      return { ok: true, ...doc }
    } catch (err) {
      stravaState = { at: new Date().toISOString(), ok: false, detail: err.message }
      return { ok: false, error: err.message }
    }
  })().finally(() => { stravaInFlight = null })
  return stravaInFlight
}

/*
 * Goals come from Totem over the same bridge everything else does.
 *
 * `/api/goals` there already existed — read-only needed no change to Totem at
 * all, which is the whole reason this was the option worth taking.
 */
let goalsInFlight = null
let goalsState = { at: null, ok: null, detail: 'not pulled yet' }

async function pullGoals() {
  if (!config.totem().goals) return { ok: false, error: NOT_CONFIGURED }
  if (goalsInFlight) return goalsInFlight
  const TOTEM_URL = totemUrl()
  goalsInFlight = (async () => {
    const secret = totemSecret()
    if (!secret) {
      goalsState = { at: new Date().toISOString(), ok: false, detail: 'no BRIDGE_SECRET found' }
      return { ok: false, error: goalsState.detail }
    }
    try {
      const res = await fetch(`${TOTEM_URL}/api/goals`, {
        headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(15000),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail = body?.error?.message || body?.error || `HTTP ${res.status}`
        goalsState = { at: new Date().toISOString(), ok: false, detail }
        return { ok: false, error: detail }
      }
      const doc = {
        fetchedAt: new Date().toISOString(),
        goals: Array.isArray(body.goals) ? body.goals : [],
      }
      await fsp.mkdir(DATA_DIR, { recursive: true })
      const tmp = `${GOALS_FILE}.tmp-${process.pid}`
      await fsp.writeFile(tmp, JSON.stringify(doc, null, 2))
      await fsp.rename(tmp, GOALS_FILE)
      goalsState = { at: doc.fetchedAt, ok: true, detail: `${doc.goals.length} goals` }
      return { ok: true, ...doc }
    } catch (err) {
      goalsState = { at: new Date().toISOString(), ok: false, detail: err.message }
      return { ok: false, error: err.message }
    }
  })().finally(() => { goalsInFlight = null })
  return goalsInFlight
}

function refreshGoalsIfStale() {
  if (!config.totem().goals) return
  const cache = readJson(GOALS_FILE, null)
  const age = cache?.fetchedAt ? Date.now() - Date.parse(cache.fetchedAt) : Infinity
  if (age > GOALS_TTL_MS) pullGoals().catch(() => {})
}

/** Refresh in the background if stale, and return immediately. */
function refreshStravaIfStale() {
  if (!config.totem().strava) return
  const cache = readStravaCache()
  const age = cache?.fetchedAt ? Date.now() - Date.parse(cache.fetchedAt) : Infinity
  if (!(age > STRAVA_TTL_MS)) return
  pullStrava().catch(() => {})
}

/**
 * One activity in full — laps, mile splits, calories, description, gear name.
 * Fetched at attach time, so the snapshot on the entry carries the whole ride
 * rather than the list row. Live through the bridge; a failure here degrades to
 * attaching the summary, which is still every headline number.
 */
async function fetchStravaDetail(id) {
  if (!config.totem().strava) return { ok: false, error: NOT_CONFIGURED }
  const TOTEM_URL = totemUrl()
  const secret = totemSecret()
  if (!secret) return { ok: false, error: 'no BRIDGE_SECRET found' }
  try {
    const url = `${TOTEM_URL}/api/strava/activity?id=${encodeURIComponent(id)}&laps=1`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(20000) })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: body?.error || `HTTP ${res.status}` }
    return { ok: true, activity: body }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/**
 * Sync every DATE the incoming payload touched, once each, from the merged doc
 * rather than from the payload — a push that edits one of three sessions still
 * has to produce the whole day's record.
 */
function syncDailyEntries(incoming, state, before) {
  const dates = new Set()
  for (const entry of Object.values(incoming?.entries || {})) {
    if (entry?.kind === 'daily' && entry.date) dates.add(entry.date)
  }
  for (const date of dates) syncHabitDay(date, state).catch(() => {})

  // The same write, announced — but only the part of it that is actually new.
  // The payload is their WHOLE log on every sync, so `before` (the state as it was
  // a moment ago, straight out of the commit lock) is the only thing that
  // separates "the user just logged this" from "their browser said hello again", and the
  // only thing that knows the session was already done before this write touched
  // it. Fire-and-forget for the same reason the habit push is: a notification
  // failing must never fail the log.
  for (const entry of notifyFacts.completedDailyEntries(incoming, before)) {
    notifyWorkoutLogged(entry).catch(() => {})
  }
}

// --------------------------------------------------------- check-in coach

/*
 * One turn of the conversation on the Today tab.
 *
 * This is the only endpoint that starts a model, and it is the only one a
 * browser can use to change what the app recommends, so the shape of it is the
 * safety argument:
 *
 *   - The run has NO TOOLS. Everything it sees is assembled here (server/chat.js)
 *     and passed on stdin. It cannot read a file, write one, or touch
 *     content/plan.json. Nothing reachable from a phone gets to edit the
 *     programme; the plan is the owner's, edited by hand.
 *   - Its output is schema-validated by the CLI and re-checked by mergeNote,
 *     which clamps every nudge to `recommender.coachCap` and refuses to invent
 *     an entry in `changed` (that array is the audit trail for plan edits, and
 *     a chat cannot make one).
 *   - What it writes is a coach note for TODAY, read through lib/coach.js. So it
 *     inherits the rules that matter: no note can put two hard finger days back
 *     to back or breach the weekly cap, because nudges are read after the hard
 *     blocks have already returned.
 *   - It may also SUGGEST sessions — swap the main, add an extra, take one off —
 *     because a capped nudge could not express "do the crawls instead" and the
 *     coach spent two weeks claiming changes that never happened. It does not
 *     perform them and neither does this route. They come back as offers; the
 *     app draws each one as a card with buttons, decides live which buttons are
 *     legal via lib/recommend.js `placeable()`, and writes an entry only when
 *     the user presses one. So this endpoint has no write access to state.json at
 *     all, and every change to the training log is still their own tap.
 *
 * Runs are serialised. Two phones asking at once would otherwise both read
 * coach.json, both merge, and the second would drop the first's nudges.
 */

let chatChain = Promise.resolve()
/* Serialised: a coach turn can WRITE a memory, and two agents appending to one
   brain file is how half a memory gets written. */
let coachChain = Promise.resolve()
let coachLast = { at: null, ok: null, detail: 'no coach turn yet' }
let chatLast = { at: null, ok: null, detail: 'no check-in yet' }

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

/** One headless turn. Resolves the parsed structured output, or throws. */
function askCoach(prompt) {
  const ai = config.ai()
  const CLAUDE_BIN = ai.bin
  return new Promise((resolve, reject) => {
    if (!ai.installed) return reject(new Error(AI_MISSING))
    const child = spawn(CLAUDE_BIN, [
      '--print',
      '--model', ai.chatModel,
      '--effort', CHAT_EFFORT,
      '--output-format', 'json',
      // No tools at all. This is the load-bearing line in the whole feature.
      '--tools', '',
      // ...and none of the owner's own settings, MCP servers or CLAUDE.md.
      ...ISOLATION,
      '--no-session-persistence',
      '--json-schema', JSON.stringify(chat.REPLY_SCHEMA),
    ], { env: ai.spawnEnv(), stdio: ['pipe', 'pipe', 'pipe'] })

    let out = ''
    let err = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('the coach took too long')) },
      CHAT_TIMEOUT_MS)

    child.stdout.on('data', c => { out += c })
    child.stderr.on('data', c => { err += c })
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`cannot run ${CLAUDE_BIN}: ${e.message}`)) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) return reject(new Error(err.trim().split('\n').pop() || `claude exited ${code}`))
      let doc
      try { doc = JSON.parse(out) } catch { return reject(new Error('the coach did not return JSON')) }
      // `structured_output` is the validated object; `result` is the same thing
      // as a string. Prefer the object, fall back rather than fail on a CLI that
      // stops sending it.
      const reply = doc.structured_output || readParsed(doc.result)
      if (!reply || typeof reply !== 'object') return reject(new Error('the coach returned nothing usable'))
      resolve({ reply, model: modelOf(doc) })
    })

    child.stdin.end(prompt)
  })
}

const readParsed = (s) => { try { return JSON.parse(s) } catch { return null } }

/**
 * Which model actually answered. The CLI reports usage for every model a run
 * touched — including the small one it uses for its own housekeeping — so the
 * answer is the one that wrote the most, not whichever key lands last. The name
 * ends up on the message in the thread, and attributing a coaching note to the
 * wrong model is a small lie that would be very hard to notice later.
 */
function modelOf(doc) {
  const usage = Object.entries(doc?.modelUsage || {})
  if (!usage.length) return config.ai().chatModel
  return usage.sort((a, b) => (b[1]?.outputTokens || 0) - (a[1]?.outputTokens || 0))[0][0]
}

async function checkIn(request) {
  const plan = readJson(planPath(), {})
  const state = readStateSync().state
  const BRAIN_FILE = config.links().brainFile
  const note = readJson(COACH_FILE, null)
  // Absent is fine and must stay fine: the profile lives in another repo, and a
  // coach with no profile is worse than one with no answer only if it pretends.
  let brain = null
  try { if (BRAIN_FILE) brain = fs.readFileSync(BRAIN_FILE, 'utf8') } catch { /* not installed */ }

  /*
   * WHOOP, from the cache on this disk rather than from the request.
   *
   * A stale cache is refreshed on the way in — a check-in is the moment the
   * numbers matter most, and this is not a page load, so it can afford to wait
   * for it. `refreshWhoopIfStale` fires in the background and does not block, so
   * a band that has not synced costs a slightly older digest and never a reply:
   * WHOOP being down must not cost them a conversation with their coach.
   */
  refreshWhoopIfStale()
  const whoop = chat.whoopDigest(readWhoopCache(), request.date, {
    entries: Object.values(state.entries || {}),
  })
  // Strava the same way: what the legs did this month, from the cache on disk.
  refreshStravaIfStale()
  const strava = chat.stravaDigest(readStravaCache(), request.date, {
    entries: Object.values(state.entries || {}),
  })

  const prompt = chat.buildPrompt({
    instructions: fs.readFileSync(CHECKIN_PROMPT, 'utf8'),
    brain, plan, state, note, whoop, strava, request, name: config.athlete().name,
  })

  const { reply, model } = await askCoach(prompt)
  const text = chat.replyText(reply)
  if (!text) throw new Error('the coach had nothing to say')

  const { note: merged, applied } = chat.mergeNote({
    note, reply, date: request.date, cap: chat.coachCap(plan), model,
  })

  // Only sessions that exist may be nudged. A nudge on an id the plan does not
  // have is inert in the app, so writing it would leave the reply describing a
  // change that never happened.
  const ids = new Set((plan.dailyMenu || []).map(m => m.id))
  merged.nudges = merged.nudges.filter(n => ids.has(n.optId))
  const kept = applied.filter(a => ids.has(a.optId))

  // The sessions it put forward. Shape-checked here and nothing more: the app
  // renders each as a card with buttons, decides live which buttons to offer,
  // and writes nothing until the user presses one. Nothing on this path touches
  // state.json — a browser-triggered model run cannot change the training log,
  // it can only put something on screen for them to accept.
  const offered = chat.suggestions(reply, plan)

  await writeCoachNote(merged)
  chatLast = {
    at: new Date().toISOString(),
    ok: true,
    detail: `${request.date}, ${kept.length} nudge(s), ${offered.length} suggestion(s)`,
  }
  return { reply: text, model, applied: kept, sessions: offered, note: merged }
}

async function writeCoachNote(note) {
  const tmp = `${COACH_FILE}.tmp-${process.pid}`
  await fsp.writeFile(tmp, JSON.stringify(note, null, 2), 'utf8')
  await fsp.rename(tmp, COACH_FILE)
}

// ------------------------------------------------------------ http plumbing

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    ...headers,
  })
  res.end(payload)
}

function readBody(req, limitBytes = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', c => {
      size += c.length
      if (size > limitBytes) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try { resolve(JSON.parse(raw)) } catch (e) { reject(new Error('invalid JSON body')) }
    })
    req.on('error', reject)
  })
}

async function serveStatic(req, res, urlPath) {
  let rel
  try {
    rel = decodeURIComponent(urlPath).replace(/^\/+/, '')
  } catch {
    return send(res, 400, 'malformed path encoding') // e.g. "/%zz"
  }
  const target = path.resolve(DIST_DIR, rel || 'index.html')
  if (!target.startsWith(path.resolve(DIST_DIR))) return send(res, 403, 'forbidden')

  let file = target
  try {
    const st = await fsp.stat(file)
    if (st.isDirectory()) file = path.join(file, 'index.html')
  } catch {
    // SPA fallback: unknown non-asset paths render the app shell
    if (path.extname(rel)) return send(res, 404, 'not found')
    file = path.join(DIST_DIR, 'index.html')
  }

  try {
    const buf = await fsp.readFile(file)
    const ext = path.extname(file).toLowerCase()
    const immutable = /\/assets\//.test(file)
    send(res, 200, buf, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
  } catch {
    send(res, 404, 'app not built yet — run `npm run build` in bushido/app')
  }
}

// ---------------------------------------------------- sign-in and settings

const EXAMPLE_PLAN = path.join(ROOT, 'examples', 'plan.json')

function html(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
    ...headers,
  })
  res.end(body)
}

function redirect(res, to, headers = {}) {
  res.writeHead(303, { Location: to, 'Cache-Control': 'no-store', ...headers })
  res.end()
}

/*
 * Only same-origin paths, so /login?next= cannot bounce a sign-in somewhere else.
 * Resolved against a dummy origin and required to stay on it; backslashes and
 * control characters (raw or %-encoded, e.g. `/%09/evil.example`) are refused
 * outright, because browsers normalise them in ways a string check misses.
 */
function safeNext(n) {
  if (typeof n !== 'string' || !n.startsWith('/') || n.length > 2000) return '/'
  let decoded = n
  try { decoded = decodeURIComponent(n) } catch { return '/' }
  if (/[\\\u0000-\u001f\u007f]/.test(n) || /[\\\u0000-\u001f\u007f]/.test(decoded)) return '/'
  try {
    const base = 'http://bushido.invalid'
    const u = new URL(n, base)
    if (u.origin !== base) return '/'
    return u.pathname + u.search + u.hash
  } catch { return '/' }
}

/** A urlencoded form (what the setup and sign-in pages post) or a JSON body. */
async function readForm(req) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > 64 * 1024) throw new Error('payload too large')
    chunks.push(c)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (/json/.test(String(req.headers['content-type'] || ''))) {
    try { return JSON.parse(raw || '{}') } catch { throw new Error('invalid JSON body') }
  }
  return Object.fromEntries(new URLSearchParams(raw))
}

/* The throttle key; see clientAddress in server/auth.js for when headers are trusted. */
const clientIp = (req) => clientAddress(req)

/** A page the app shell would answer, as opposed to a built asset. */
const isPagePath = (p) => !path.extname(p) || p.endsWith('.html')

/**
 * The routes that must work signed out: setup, sign-in, sign-out.
 * Returns true when it answered.
 */
async function authRoutes(req, res, url) {
  const p = url.pathname
  if (p === '/setup') {
    if (auth.mode === 'proxy') { redirect(res, '/'); return true }
    if (auth.hasOwner()) { html(res, 200, pages.setupClosedPage({ hasOwner: true })); return true }
    if (req.method === 'POST') {
      const form = await readForm(req)
      try {
        await auth.createOwner(form)
        console.log(`[bushido] owner account created for ${auth.owner()}`)
        const value = await auth.login({ username: form.username, password: form.password, ip: clientIp(req) })
        redirect(res, '/settings?welcome=1', { 'Set-Cookie': auth.cookieHeader(req, value) })
      } catch (err) {
        if (!auth.checkSetupToken(form.token)) html(res, 403, pages.setupClosedPage({ hasOwner: false }))
        else html(res, 400, pages.setupPage({ token: form.token, error: err.message, minPassword: auth.MIN_PASSWORD }))
      }
      return true
    }
    const token = url.searchParams.get('token')
    if (!auth.checkSetupToken(token)) { html(res, 403, pages.setupClosedPage({ hasOwner: false })); return true }
    html(res, 200, pages.setupPage({ token, minPassword: auth.MIN_PASSWORD }))
    return true
  }
  if (p === '/login') {
    if (auth.mode === 'proxy') { redirect(res, '/'); return true }
    if (!auth.hasOwner()) { redirect(res, '/setup'); return true }
    if (req.method === 'POST') {
      const form = await readForm(req)
      try {
        const value = await auth.login({ username: form.username, password: form.password, ip: clientIp(req) })
        redirect(res, safeNext(form.next), { 'Set-Cookie': auth.cookieHeader(req, value) })
      } catch (err) {
        html(res, err.status || 401, pages.loginPage({ error: err.message, next: safeNext(form.next) }))
      }
      return true
    }
    if (auth.check(req).ok) { redirect(res, safeNext(url.searchParams.get('next'))); return true }
    html(res, 200, pages.loginPage({ next: safeNext(url.searchParams.get('next')) }))
    return true
  }
  if (p === '/logout' && req.method === 'POST') {
    if (auth.mode !== 'proxy' && auth.check(req).via === 'session') auth.revokeSessions()
    redirect(res, auth.mode === 'proxy' ? '/' : '/login', {
      'Set-Cookie': auth.cookieHeader(req, '', { clear: true }),
      ...(auth.mode === 'proxy' ? {} : { 'Clear-Site-Data': '"cache"' }),
    })
    return true
  }
  return false
}

let aiVersionCache = { at: 0, bin: null, value: null }
/** `claude --version`, cached for a minute. Null when it will not run. */
function aiVersion() {
  const ai = config.ai()
  if (!ai.installed) return Promise.resolve(null)
  if (aiVersionCache.bin === ai.bin && Date.now() - aiVersionCache.at < 60_000) return Promise.resolve(aiVersionCache.value)
  return new Promise((resolve) => {
    const child = spawn(ai.bin, ['--version'], { env: ai.spawnEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
    child.stdout.on('data', c => { out += c })
    child.on('error', () => { clearTimeout(timer); resolve(null) })
    child.on('close', (code) => {
      clearTimeout(timer)
      const value = code === 0 ? out.trim().split('\n')[0].slice(0, 120) : null
      aiVersionCache = { at: Date.now(), bin: ai.bin, value }
      resolve(value)
    })
  })
}

/** One tiny request through the configured CLI, for the Test button. */
function testAi() {
  const ai = config.ai()
  if (!ai.installed) return Promise.reject(new Error(AI_MISSING))
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const child = spawn(ai.bin, [
      '--print', '--model', ai.coachModel, '--output-format', 'json',
      '--tools', '', '--no-session-persistence', ...ISOLATION,
    ], { env: ai.spawnEnv(), stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('no answer within 90 seconds')) }, 90_000)
    child.stdout.on('data', c => { out += c })
    child.stderr.on('data', c => { err += c })
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`cannot run ${ai.bin}: ${e.message}`)) })
    child.on('close', (code) => {
      clearTimeout(timer)
      let doc = null
      try { doc = JSON.parse(out) } catch { /* not JSON */ }
      if (code !== 0 || !doc || doc.is_error) {
        const why = doc?.result || err.trim().split('\n').pop() || `exited ${code}`
        return reject(new Error(`the CLI ran but the request failed: ${String(why).slice(0, 300)}. If it is not signed in, run it once in a terminal and log in, or add an API key.`))
      }
      resolve({ ok: true, ms: Date.now() - started, model: modelOf(doc) || ai.coachModel, reply: String(doc.result || '').slice(0, 200) })
    })
    child.stdin.end('Reply with the single word: ok')
  })
}

const PLAN_LABELS = { starter: 'Starter content (no plan of your own yet)', imported: 'Your own plan (data/plan.json)', settings: 'A file chosen in settings' }

async function settingsView(who) {
  const ai = config.ai()
  const t = config.totem()
  const pf = config.planFile()
  const envFileSource = process.env.BUSHIDO_TOTEM_ENV ? 'env BUSHIDO_TOTEM_ENV' : (t.envFile ? 'settings' : 'off')
  return {
    auth: { mode: auth.mode, source: config.authMode().source, user: who?.user?.username || auth.owner() },
    settings: config.publicView(),
    effective: {
      ai: {
        installed: ai.installed, bin: ai.bin, binSource: ai.binSource,
        apiKeySet: ai.apiKeySet, apiKeySource: ai.apiKeySource,
        model: ai.model.value, defaultModel: require('./config.js').DEFAULT_MODEL,
      },
      totem: {
        enabled: t.enabled, url: t.url, urlSource: t.urlSource, secretSource: t.secretSource, envFileSource,
        habitSync: t.habitSync, whoop: t.whoop, strava: t.strava, goals: t.goals,
      },
      links: config.links(),
      tz: config.tz(),
      plan: {
        file: pf.file, source: pf.source,
        label: PLAN_LABELS[pf.source] || (pf.source.startsWith('env ') ? `Pinned by ${pf.source.slice(4)}` : pf.source),
        exampleAvailable: fs.existsSync(EXAMPLE_PLAN),
      },
    },
    status: { notify: Boolean(notify), aiVersion: await aiVersion() },
  }
}

/** A content file the app can run on, or an error saying what is missing. */
function checkPlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return 'a plan is a JSON object'
  if (!Array.isArray(plan.dailyMenu)) return 'a plan needs a dailyMenu array (export the starter to see the shape)'
  if (plan.quotaCategories != null && !Array.isArray(plan.quotaCategories)) return 'quotaCategories must be an array'
  return null
}

/*
 * data/plan.json may be the owner's only copy of a plan they wrote by hand, so
 * replacing or removing it always keeps the old one in data/backups/ first.
 */
async function backupOwnPlan() {
  const file = path.join(DATA_DIR, 'plan.json')
  if (!fs.existsSync(file)) return null
  const dir = path.join(BACKUP_DIR, 'plans')
  await fsp.mkdir(dir, { recursive: true })
  const to = path.join(dir, `plan-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  await fsp.copyFile(file, to)
  return to
}

async function writeOwnPlan(plan) {
  await backupOwnPlan()
  const file = path.join(DATA_DIR, 'plan.json')
  const tmp = `${file}.tmp-${process.pid}`
  await fsp.writeFile(tmp, JSON.stringify(plan, null, 2))
  await fsp.rename(tmp, file)
  config.clearPlanFile()
}

/*
 * Cross-site and content-type checks for every request that can change
 * something (anything but GET and HEAD).
 *
 * CROSS-SITE. A browser sends Sec-Fetch-Site on every request, and Origin on
 * every non-GET one. A request another site's page made is refused, and so is
 * `Origin: null` (sandboxed frames, some redirects). The check reads
 * Sec-Fetch-Site first because behind a tunnel the Host header may not be the
 * public hostname the page was loaded from; without it, Origin must match the
 * Host, X-Forwarded-Host or BUSHIDO_PUBLIC_URL. A request with neither header is
 * not from a browser page (curl, a bearer-token script) and is allowed through
 * to the ordinary sign-in check.
 *
 * JSON. Every /api route except DELETE (no body) and the notify core's own
 * routes takes JSON, and refuses anything else with 415: a form post from
 * another site is the classic way around a same-site check.
 */
function sameOrigin(req, origin) {
  let o
  try { o = new URL(origin) } catch { return false }
  const hosts = [req.headers.host, req.headers['x-forwarded-host']].filter(Boolean).flatMap(h => String(h).split(',').map(x => x.trim()))
  if (hosts.includes(o.host)) return true
  if (PUBLIC_URL) { try { return new URL(PUBLIC_URL).origin === o.origin } catch { /* ignore */ } }
  return false
}

function requestGuard(req, p) {
  if (req.method === 'GET' || req.method === 'HEAD') return null
  const site = req.headers['sec-fetch-site']
  const origin = req.headers.origin
  if (site && site !== 'same-origin' && site !== 'none') return { status: 403, error: 'cross-site request refused' }
  if (origin === 'null') return { status: 403, error: 'cross-site request refused' }
  if (!site && origin && !sameOrigin(req, origin)) return { status: 403, error: 'cross-site request refused' }
  if (p.startsWith('/api/') && !p.startsWith('/api/push/') && req.method !== 'DELETE') {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
    if (type !== 'application/json') return { status: 415, error: 'send application/json' }
  }
  return null
}

/** In proxy mode, settings writes and the AI test only from a loopback peer. */
function proxySettingsRefusal(mode, req, p) {
  if (mode !== 'proxy' || !p.startsWith('/api/settings') || req.method === 'GET' || req.method === 'HEAD') return null
  if (isLoopback(req.socket?.remoteAddress)) return null
  return 'in proxy mode, settings can only be changed through the proxy on this machine'
}

// -------------------------------------------------------------------- routes

const server = http.createServer(async (req, res) => {
  // Must not throw outside the try: this handler is async, so an exception here
  // becomes an unhandled rejection and kills the process. A request for "//"
  // parses as a protocol-relative URL with an empty host and throws.
  let url
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  } catch {
    return send(res, 400, { error: 'malformed request URL' })
  }
  const p = url.pathname

  // Same-origin app: no CORS, so a preflight gets nothing that would allow it.
  if (req.method === 'OPTIONS') return send(res, 204, '')

  // Before anything with a side effect: refuse cross-site writes and non-JSON
  // bodies on JSON routes. See requestGuard.
  const refusal = requestGuard(req, p)
  if (refusal) return send(res, refusal.status, { error: refusal.error })

  /*
   * The gate. Setup, sign-in and sign-out answer for themselves; everything else
   * needs a session, a bearer token, or BUSHIDO_AUTH=proxy. Built assets (any path
   * with an extension) are public: they are this repo's code, and a service
   * worker refreshing them must not be bounced to a login page.
   */
  let who
  try {
    if (await authRoutes(req, res, url)) return
    who = auth.check(req)
  } catch (err) {
    if (err.message === 'payload too large') return send(res, 413, { error: err.message })
    console.error('[bushido] auth route failed:', err.message)
    return send(res, 500, { error: err.message })
  }
  if (!who.ok) {
    const pub = notify?.publicPaths
    const isPublic = Boolean(pub && (typeof pub.has === 'function' ? pub.has(p) : Array.isArray(pub) && pub.includes(p)))
    if (p === '/api/health') return send(res, 200, { ok: true, auth: auth.mode })
    if (!isPublic) {
      if (p.startsWith('/api/')) return send(res, 401, { error: 'sign in first' }, { 'X-Bushido-Auth': 'login' })
      if (isPagePath(p)) {
        if (!auth.hasOwner()) return redirect(res, '/setup')
        return redirect(res, `/login?next=${encodeURIComponent(p + url.search)}`)
      }
    }
  }

  // The push routes come from Totem's notify/http.mjs, mounted whole, when a
  // notify core is configured. They sit behind the same gate as the rest.
  if (notify && p.startsWith('/api/push')) {
    try {
      if (await notify.handler(req, res, url)) return
    } catch (e) {
      return send(res, 500, { error: e.message })
    }
  }

  try {
    if (p === '/settings' && req.method === 'GET') return html(res, 200, pages.settingsPage())

    if (p === '/api/auth/me' && req.method === 'GET') {
      return send(res, 200, { mode: auth.mode, via: who.via, user: who.user?.username || null })
    }

    /*
     * Sign out, from the app (lib/signout.js), which has already flushed and
     * asked before calling this. Revokes every session, clears the cookie, and
     * asks the browser to drop its HTTP cache. Only the answer from here makes the
     * app clear the device; a 401 (already signed out) counts too.
     */
    if (p === '/api/auth/logout' && req.method === 'POST') {
      if (auth.mode === 'proxy') return send(res, 409, { error: 'sign-in is handled by the proxy (BUSHIDO_AUTH=proxy); there is nothing to sign out of' })
      auth.revokeSessions()
      return send(res, 200, { ok: true }, {
        'Set-Cookie': auth.cookieHeader(req, '', { clear: true }),
        'Clear-Site-Data': '"cache"',
        'Cache-Control': 'no-store',
      })
    }

    if (p === '/api/auth/password' && req.method === 'POST') {
      if (auth.mode === 'proxy') return send(res, 409, { error: 'sign-in is handled by the proxy (BUSHIDO_AUTH=proxy)' })
      const body = await readBody(req, 16 * 1024)
      try {
        const value = await auth.changePassword({ current: body?.current, next: body?.next })
        return send(res, 200, { ok: true }, { 'Set-Cookie': auth.cookieHeader(req, value) })
      } catch (err) { return send(res, 400, { error: err.message }) }
    }

    if (p === '/api/settings' && req.method === 'GET') {
      return send(res, 200, await settingsView(who), { 'Cache-Control': 'no-store' })
    }

    /*
     * In proxy mode there is no login, so whoever reaches the port could change
     * settings. Writes and the AI test are then allowed only from a loopback peer:
     * the tunnel or auth proxy on this machine (cloudflared connects from
     * localhost), never a direct LAN or tailnet connection to the port.
     */
    const proxyRefusal = proxySettingsRefusal(auth.mode, req, p)
    if (proxyRefusal) return send(res, 403, { error: proxyRefusal })

    if (p === '/api/settings' && req.method === 'PUT') {
      const body = await readBody(req, 64 * 1024)
      config.update(body || {})
      return send(res, 200, await settingsView(who), { 'Cache-Control': 'no-store' })
    }

    if (p === '/api/settings/ai/test' && req.method === 'POST') {
      try { return send(res, 200, await testAi()) } catch (err) { return send(res, 502, { error: err.message }) }
    }

    if ((p === '/api/plan/import' || p === '/api/plan/example' || p === '/api/plan/reset') && req.method === 'POST') {
      const pinned = config.planFile().source
      if (pinned.startsWith('env ')) return send(res, 409, { error: `the plan is pinned by ${pinned.slice(4)}` })
      if (p === '/api/plan/reset') {
        await backupOwnPlan()
        await fsp.unlink(path.join(DATA_DIR, 'plan.json')).catch(() => {})
        config.clearPlanFile()
        return send(res, 200, { ok: true, plan: config.planFile() })
      }
      let plan
      if (p === '/api/plan/example') {
        try { plan = JSON.parse(await fsp.readFile(EXAMPLE_PLAN, 'utf8')) } catch { return send(res, 404, { error: 'examples/plan.json is not in this checkout' }) }
      } else {
        plan = (await readBody(req))?.plan
      }
      const problem = checkPlan(plan)
      if (problem) return send(res, 400, { error: problem })
      await writeOwnPlan(plan)
      return send(res, 200, { ok: true, plan: config.planFile() })
    }

    // Notifications off: say so in the shape the client already reads.
    if (!notify && p === '/api/push/key' && req.method === 'GET') {
      return send(res, 200, { configured: false, publicKey: null, error: 'Notifications are off on this server. Set them up in Settings.' })
    }

    if (p === '/api/health') {
      const doc = readStateSync()
      const ai = config.ai()
      const t = config.totem()
      const links = config.links()
      return send(res, 200, {
        ok: true,
        version: doc.version,
        entries: Object.keys(doc.state.entries || {}).length,
        stateFile: STATE_FILE,
        contentFile: planPath(),
        auth: { mode: auth.mode, owner: auth.hasOwner() },
        distDir: DIST_DIR,
        coach: { file: COACH_FILE, present: fs.existsSync(COACH_FILE) },
        chat: { model: ai.chatModel, claude: ai.installed, brain: Boolean(links.brainFile && fs.existsSync(links.brainFile)), last: chatLast },
        goals: goalsState,
        coach: { model: ai.coachModel, effort: COACH_EFFORT, dir: COACH_DIR,
                 threads: (() => { try { return coach.listThreads(COACH_DIR).length } catch { return 0 } })(),
                 last: coachLast },
        totem: { enabled: t.enabled, url: t.url, habit: t.habit, secret: Boolean(t.secret()), lastSync: totemLast },
        notify: Boolean(notify),
        whoop: { file: WHOOP_FILE, present: fs.existsSync(WHOOP_FILE), days: WHOOP_DAYS, last: whoopState },
        strava: { file: STRAVA_FILE, present: fs.existsSync(STRAVA_FILE), days: STRAVA_DAYS, last: stravaState },
      })
    }

    /*
     * The Strava cache and its pull, shaped exactly like WHOOP's: the GET serves
     * disk and refreshes in the background; the POST waits, because it is one
     * HTTP call and "did my ride come through" deserves an answer.
     */
    if (p === '/api/strava' && req.method === 'GET') {
      refreshStravaIfStale()
      const cache = readStravaCache()
      if (!config.totem().strava) {
        return send(res, 200, { fetchedAt: null, activities: [], gear: {}, athlete: null, configured: false, status: null }, { 'Cache-Control': 'no-cache' })
      }
      return send(res, 200, {
        ...(cache || { fetchedAt: null, activities: [], gear: {}, athlete: null }),
        configured: true,
        status: stravaState,
      }, { 'Cache-Control': 'no-cache' })
    }

    if (p === '/api/strava/pull' && req.method === 'POST') {
      const body = await readBody(req).catch(() => null)
      const days = Number(body?.days)
      const result = await pullStrava({
        days: Number.isFinite(days) && days > 0 ? Math.min(Math.round(days), 120) : STRAVA_DAYS,
      })
      if (!result.ok) return send(res, 502, { error: result.error, status: stravaState })
      const cache = readStravaCache()
      return send(res, 200, { ...(cache || {}), status: stravaState })
    }

    // One activity in full, for the moment the user attaches it. Live; not cached here.
    if (p === '/api/strava/activity' && req.method === 'GET') {
      const id = url.searchParams.get('id')
      if (!id) return send(res, 400, { error: 'id is required' })
      const result = await fetchStravaDetail(id)
      if (!result.ok) return send(res, 502, { error: result.error })
      return send(res, 200, result.activity, { 'Cache-Control': 'no-cache' })
    }

    /*
     * The WHOOP cache. Served from disk, and a stale copy kicks off a background
     * refresh that this request does not wait for — see refreshWhoopIfStale.
     *
     * A 200 with an empty cache rather than a 404: "WHOOP has nothing for you"
     * and "WHOOP is not reachable" are different states and the card says which,
     * so the payload always carries `status` even when there is no data at all.
     */
    if (p === '/api/whoop' && req.method === 'GET') {
      refreshWhoopIfStale()
      const cache = readWhoopCache()
      if (!config.totem().whoop) {
        return send(res, 200, { fetchedAt: null, workouts: [], recovery: [], sleep: [], maxHeartRate: null, configured: false, status: null }, { 'Cache-Control': 'no-cache' })
      }
      return send(res, 200, {
        ...(cache || { fetchedAt: null, workouts: [], recovery: [], sleep: [], maxHeartRate: null }),
        configured: true,
        status: whoopState,
      }, { 'Cache-Control': 'no-cache' })
    }

    /*
     * Pull now. This DOES wait for the result, unlike the background refresh, because it is
     * four HTTP calls rather than an Opus session, and the honest answer to "did
     * my gym session come through" is the answer, not "started".
     */
    if (p === '/api/whoop/pull' && req.method === 'POST') {
      const body = await readBody(req).catch(() => null)
      const days = Number(body?.days)
      const result = await pullWhoop({
        days: Number.isFinite(days) && days > 0 ? Math.min(Math.round(days), 60) : WHOOP_DAYS,
      })
      if (!result.ok) return send(res, 502, { error: result.error, status: whoopState })
      const cache = readWhoopCache()
      return send(res, 200, { ...(cache || {}), status: whoopState })
    }

    if (p === '/api/content' && req.method === 'GET') {
      try {
        const raw = await fsp.readFile(planPath(), 'utf8')
        return send(res, 200, raw, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache' })
      } catch {
        return send(res, 404, { error: 'plan.json not present yet' })
      }
    }

    /*
     * Today's coach note. Read-only, and read-only on purpose: the note is
     * written on the way out of /api/chat, by the server, after the model's reply
     * has been through chat.js's caps. A browser cannot PUT one, so nothing
     * reachable from a phone can forge coaching advice.
     *
     * A 404 is the ordinary case, not an error: most days the user has not talked to
     * the coach yet. The app treats an absent note as "behave exactly as you did
     * before the coach existed".
     */
    if (p === '/api/coach' && req.method === 'GET') {
      try {
        const raw = await fsp.readFile(COACH_FILE, 'utf8')
        JSON.parse(raw) // a half-written file must 404, not reach the phone as junk
        return send(res, 200, raw, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache' })
      } catch {
        return send(res, 404, { error: 'no coach note yet' })
      }
    }

    /*
     * One turn of the check-in. Slow by nature — it is a model run — so it is
     * serialised behind whatever is already in flight rather than run
     * concurrently, and every failure comes back as prose the card can show.
     * The app has already stored what the user typed by the time this is called, so a
     * 503 here costs a reply and never a training note.
     */
    /*
     * The AI coach. Threads are files under data/coach/ — see server/coach.js.
     *
     * Serialised like the old check-in was, and for a sharper reason now: a turn
     * can WRITE (a memory into the brain), and two concurrent agents appending to
     * one file is how a memory gets half-written.
     */
    /*
     * Goals, read-only, from Totem.
     *
     * Totem OWNS goals — it has the schema, the MCP tools and the notebook-import
     * flow, and there is exactly one place to author one. Bushido shows the ones
     * marked as its own and contributes nothing, chosen over a schema migration
     * in Totem's database, which holds other data too.
     *
     * Cached to disk and refreshed in the background when stale, exactly like the
     * WHOOP and Strava caches beside it: the bridge being down should make the
     * goals card stale, never make the app fail to load.
     */
    if (p === '/api/goals' && req.method === 'GET') {
      if (!config.totem().goals) return send(res, 200, { fetchedAt: null, goals: [], configured: false }, { 'Cache-Control': 'no-cache' })
      refreshGoalsIfStale()
      const cache = readJson(GOALS_FILE, null)
      return send(res, 200, { ...(cache || { fetchedAt: null, goals: [] }), configured: true }, { 'Cache-Control': 'no-cache' })
    }

    if (p === '/api/goals/pull' && req.method === 'POST') {
      return send(res, 200, await pullGoals())
    }

    if (p === '/api/coach/threads' && req.method === 'GET') {
      return send(res, 200, { threads: coach.listThreads(COACH_DIR) }, { 'Cache-Control': 'no-cache' })
    }

    if (p.startsWith('/api/coach/thread/') && req.method === 'GET') {
      try {
        const t = coach.readThread(COACH_DIR, p.slice('/api/coach/thread/'.length))
        if (!t) return send(res, 404, { error: 'no such thread' })
        return send(res, 200, t, { 'Cache-Control': 'no-cache' })
      } catch (err) { return send(res, 400, { error: err.message }) }
    }

    if (p.startsWith('/api/coach/thread/') && req.method === 'DELETE') {
      try {
        const id = p.slice('/api/coach/thread/'.length)
        return send(res, 200, { ok: coach.deleteThread(COACH_DIR, id) })
      } catch (err) { return send(res, 400, { error: err.message }) }
    }

    if (p === '/api/coach/chat' && req.method === 'POST') {
      const body = await readBody(req, 256 * 1024)
      const question = String(body?.message || '').trim()
      if (!question) return send(res, 400, { error: 'say something' })
      const { ai, common } = aiRun()
      if (!ai.installed) return send(res, 503, { error: AI_MISSING, code: 'ai-not-configured' })

      const run = async () => {
        let thread = body.threadId ? coach.readThread(COACH_DIR, body.threadId) : null
        if (!thread) thread = coach.newThread(question.slice(0, 60))

        /*
         * Their message is stored BEFORE the agent is asked, deliberately. A turn
         * takes up to three minutes and can fail; with the box unreachable the user
         * should lose the reply and never the thing the user typed. Same rule the old
         * check-in had.
         */
        thread = coach.appendMessage(thread, { role: 'user', text: question, at: new Date().toISOString() })
        coach.writeThread(COACH_DIR, thread)

        const { reply, model } = await coach.askCoach({
          ...common, model: ai.coachModel, effort: COACH_EFFORT,
          timeoutMs: COACH_TIMEOUT_MS,
          krakatoaDir: config.links().krakatoaDir, planFile: planPath(),
          thread, question, context: String(body.context || '').slice(0, 4000),
        })

        thread = coach.appendMessage(thread, {
          role: 'coach', text: reply.reply, at: new Date().toISOString(),
          sessions: Array.isArray(reply.sessions) ? reply.sessions : undefined,
          wroteMemory: reply.wroteMemory || undefined,
          model,
        })
        // A thread names itself off the first exchange rather than the first
        // question, which is usually four words and no use in a list.
        if (reply.title && (thread.messages.length <= 2 || thread.title === 'New chat')) {
          thread.title = String(reply.title).slice(0, 80)
        }
        return coach.writeThread(COACH_DIR, thread)
      }

      const next = coachChain.then(run)
      coachChain = next.catch(() => {})
      try {
        return send(res, 200, await next)
      } catch (err) {
        coachLast = { at: new Date().toISOString(), ok: false, detail: err.message }
        console.error('[bushido] coach failed:', err.message)
        return send(res, 503, { error: err.message })
      }
    }

    /*
     * Plan me a workout.
     *
     * Slow — it is a model run that reads their log first — and it returns the
     * prescription rather than storing it. Nothing lands in the log until the user taps
     * "keep it", which is the same rule the coach's session offers follow: the
     * app only ever writes because the user said so.
     *
     * NOT serialised behind the coach chain. This agent writes nothing, so two of
     * them at once is two reads, and making them queue behind a three-minute coach
     * turn to get a leg day is the wrong trade.
     */
    if (p === '/api/plan/workout' && req.method === 'POST') {
      const body = await readBody(req, 64 * 1024)
      // A list since 2026-09-17 — one gym trip can be legs AND core AND a spin.
      // A bare `kind` is still accepted so an older client keeps working.
      const kinds = (Array.isArray(body?.kinds) ? body.kinds : [body?.kind])
        .map(k => String(k || '').trim().slice(0, 120))
        .filter(Boolean)
        .slice(0, 6)
      const minutes = Math.min(600, Math.max(5, Number(body?.minutes) || 0))
      const goal = String(body?.goal || '').trim().slice(0, 1000)
      if (!kinds.length) return send(res, 400, { error: 'say what kind of session' })
      if (!minutes) return send(res, 400, { error: 'say how long you have' })
      const { ai, common } = aiRun()
      if (!ai.installed) return send(res, 503, { error: AI_MISSING, code: 'ai-not-configured' })

      try {
        const plan = planner.readPlanJson(planPath()) || {}
        const built = await planner.planWorkout({
          ...common, model: ai.plannerModel, effort: PLANNER_EFFORT,
          timeoutMs: PLANNER_TIMEOUT_MS,
          plan, kinds, minutes, goal,
          context: String(body?.context || '').slice(0, 4000),
        })
        return send(res, 200, built)
      } catch (err) {
        console.error('[bushido] planner failed:', err.message)
        return send(res, 503, { error: err.message })
      }
    }

    /*
     * Change a plan the user already has.
     *
     * Same agent and same schema as writing one — it returns the whole session
     * again rather than a patch. Stored nowhere, like the first draft: what comes
     * back is their to keep or throw away.
     */
    if (p === '/api/plan/revise' && req.method === 'POST') {
      const body = await readBody(req, 256 * 1024)
      const message = String(body?.message || '').trim().slice(0, 1000)
      const current = body?.plan
      if (!message) return send(res, 400, { error: 'say what to change' })
      if (!current || typeof current !== 'object' || !Array.isArray(current.blocks)) {
        return send(res, 400, { error: 'no plan to revise' })
      }
      const { ai, common } = aiRun()
      if (!ai.installed) return send(res, 503, { error: AI_MISSING, code: 'ai-not-configured' })

      try {
        const plan = planner.readPlanJson(planPath()) || {}
        const built = await planner.planWorkout({
          ...common, model: ai.plannerModel, effort: PLANNER_EFFORT,
          timeoutMs: PLANNER_TIMEOUT_MS,
          plan,
          revise: {
            plan: current,
            message,
            thread: Array.isArray(body?.thread) ? body.thread.slice(-8) : [],
          },
        })
        return send(res, 200, built)
      } catch (err) {
        console.error('[bushido] planner revise failed:', err.message)
        return send(res, 503, { error: err.message })
      }
    }

    /*
     * Plan the week's quotas, one turn at a time.
     *
     * Stateless like the two above: the thread and their draft go up, the whole week
     * comes back. Nothing here writes a quota entry — their tap on "Set the week"
     * does, through the ordinary state PUT. See server/weekplanner.js.
     */
    if (p === '/api/plan/week' && req.method === 'POST') {
      const body = await readBody(req, 128 * 1024)
      const message = String(body?.message || '').trim().slice(0, 1500)
      const monday = String(body?.monday || '').trim()
      if (!message) return send(res, 400, { error: 'say what you want from the week' })
      if (!/^\d{4}-\d{2}-\d{2}$/.test(monday)) return send(res, 400, { error: 'say which week' })
      const { ai, common } = aiRun()
      if (!ai.installed) return send(res, 503, { error: AI_MISSING, code: 'ai-not-configured' })

      try {
        const plan = planner.readPlanJson(planPath()) || {}
        const built = await weekplanner.planWeek({
          ...common, model: ai.plannerModel, effort: WEEK_EFFORT,
          timeoutMs: WEEK_TIMEOUT_MS,
          plan, monday, message,
          counts: (body?.counts && typeof body.counts === 'object') ? body.counts : {},
          thread: Array.isArray(body?.thread) ? body.thread.slice(-10) : [],
          context: String(body?.context || '').slice(0, 4000),
        })
        return send(res, 200, built)
      } catch (err) {
        console.error('[bushido] week planner failed:', err.message)
        return send(res, 503, { error: err.message })
      }
    }

    if (p === '/api/state' && req.method === 'GET') {
      return send(res, 200, readStateSync(), { 'Cache-Control': 'no-cache' })
    }

    if (p === '/api/state' && req.method === 'PUT') {
      const body = await readBody(req)
      if (!body || typeof body.state !== 'object' || body.state === null) {
        return send(res, 400, { error: 'expected { state: {...} }' })
      }
      // `commit` hands the mutator the state as it was on disk, under the write
      // lock. That snapshot is what makes a full-log push quiet.
      let before = null
      const doc = await commit(base => { before = base; return mergeState(base, body.state) })
      syncDailyEntries(body.state, doc.state, before)
      return send(res, 200, doc)
    }

    if (p === '/api/entry' && req.method === 'POST') {
      const body = await readBody(req)
      const entry = body && body.entry
      if (!entry || !entry.id) return send(res, 400, { error: 'expected { entry: { id, ... } }' })
      const stamped = { ...entry, updatedAt: entry.updatedAt || new Date().toISOString() }
      let before = null
      const doc = await commit(base => {
        before = base
        return mergeState(base, { entries: { [entry.id]: stamped } })
      })
      syncDailyEntries({ entries: { [entry.id]: stamped } }, doc.state, before)
      return send(res, 200, doc)
    }

    if (p === '/api/export' && req.method === 'GET') {
      const doc = readStateSync()
      const name = `bushido-${doc.updatedAt.slice(0, 10)}-v${doc.version}.json`
      return send(res, 200, JSON.stringify(doc, null, 2), {
        'Content-Type': MIME['.json'],
        'Content-Disposition': `attachment; filename="${name}"`,
      })
    }

    if (p === '/api/import' && req.method === 'POST') {
      const body = await readBody(req)
      const incoming = body && (body.state || (body.doc && body.doc.state))
      if (!incoming) return send(res, 400, { error: 'expected { state } or { doc: { state } }' })
      const doc = await commit(() => mergeState(structuredClone(EMPTY_STATE), incoming))
      return send(res, 200, doc)
    }

    if (p.startsWith('/api/')) return send(res, 404, { error: 'no such endpoint' })

    // `await` is load-bearing: returning the promise unawaited lets a rejection
    // escape this try block, and the request then hangs with no response at all.
    return await serveStatic(req, res, p)
  } catch (err) {
    // Malformed client input is a 4xx; only genuine server faults are 500s.
    if (err.message === 'invalid JSON body') return send(res, 400, { error: err.message })
    if (err.message === 'payload too large') return send(res, 413, { error: err.message })
    console.error('[bushido] request failed:', req.method, p, err.message)
    return send(res, 500, { error: err.message })
  }
})

// Safety net. This service needs to be reachable when the user's mid-session in a
// basement; a single unexpected throw should degrade one request, not the app.
// systemd would restart it anyway, but a restart drops in-flight writes.
process.on('uncaughtException', (err) => {
  console.error('[bushido] uncaught exception (staying up):', err?.stack || err)
})
process.on('unhandledRejection', (err) => {
  console.error('[bushido] unhandled rejection (staying up):', err?.stack || err)
})

// The habit-rollup helpers are pure and easy to get subtly wrong, so they are
// exported for `node server/totem.test.js` rather than only reachable by
// running the whole server and watching Totem.
/** Start the server: migrate settings, then listen. `npm start` calls this too. */
function main() {

  /*
   * Settings first, before anything below creates state.json: the migration reads
   * "is there already a training log?" to tell an existing install (keep every
   * old default) from a fresh one (everything optional off).
   */
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const migration = config.migrate()
  if (migration.created) {
    console.log(migration.install === 'migrated'
      ? `[bushido] wrote ${config.file} for an existing install: sign-in off (auth.mode proxy), every integration off until set in Settings`
      : `[bushido] new install: wrote ${config.file}; every integration is off until you set it up in Settings`)
  }
  // Say which plan is actually in use. An existing install on the starter has
  // almost certainly lost its plan to the pull that deleted content/plan.json.
  if (migration.created && migration.install === 'migrated' && config.planFile().source === 'starter') {
    console.warn('[bushido] WARNING: this install has a training log but no plan of its own; it is running on the starter.')
    console.warn('[bushido] If you had a content/plan.json before pulling, restore it with:')
    console.warn(`[bushido]   git -C ${ROOT} show 'HEAD@{1}:content/plan.json' > ${path.join(DATA_DIR, 'plan.json')}`)
  }
  ensureDirs()
  if (!fs.existsSync(STATE_FILE)) {
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify({ version: 0, updatedAt: new Date(0).toISOString(), state: EMPTY_STATE }, null, 2),
    )
    console.log('[bushido] initialised', STATE_FILE)
  }

  // One tick for the notification queue, matching Totem's 30 seconds so a
  // reminder is never more than half a minute late. Only when a notify core is
  // configured: a fresh install runs no timers at all.
  startNotify().then((n) => {
    if (n) setInterval(() => { notifyTick().catch(() => {}) }, 30_000)
  })

  server.listen(PORT, BIND, () => {
    console.log(`[bushido] listening on http://${BIND}:${PORT}`)
    console.log(`[bushido] data  ${STATE_FILE}`)
    console.log(`[bushido] app   ${DIST_DIR}`)
    console.log(`[bushido] plan  ${config.planFile().file} (${config.planFile().source})`)
    if (auth.mode === 'proxy') {
      console.log(`[bushido] sign-in is off (auth mode proxy, from ${config.authMode().source}): whatever reaches this port is trusted`)
      if (!(BIND === 'localhost' || isLoopback(BIND))) {
        const bar = '!'.repeat(72)
        console.warn(`[bushido] ${bar}`)
        console.warn(`[bushido] WARNING: proxy mode (no login) while listening on ${BIND}:${PORT}.`)
        console.warn('[bushido] Anyone who can reach this port directly can read and overwrite the log.')
        console.warn('[bushido] Bind to 127.0.0.1 behind the proxy (BUSHIDO_BIND), or firewall the port.')
        console.warn(`[bushido] ${bar}`)
      }
    } else if (!auth.hasOwner()) {
      const host = BIND === '0.0.0.0' || BIND === '::' ? 'localhost' : BIND
      const base = PUBLIC_URL || `http://${host}:${PORT}`
      console.log('')
      console.log('[bushido] No owner account yet. Open this one-time link to create it:')
      console.log(`[bushido]   ${base}/setup?token=${auth.ensureSetupToken()}`)
      console.log('')
    }
  })
}

module.exports = { habitBodyForDay, isDone, isRest, mergeState, main, safeNext, requestGuard, proxySettingsRefusal }

if (require.main === module) main()
