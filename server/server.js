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
 *   GET  /api/whoop           cached WHOOP workouts, daily recovery and sleep (data/whoop.json)
 *   POST /api/whoop/pull      refetch from WHOOP now (the "Pull from WHOOP" button)
 *   GET  /api/strava          this person's cached Strava activities + gear + athlete (strava.json)
 *   POST /api/strava/pull     refetch from Strava now (the "pull" button)
 *   GET  /api/strava/activity?id=  one activity in full (laps, splits), live from Strava
 *   POST /api/strava/connect  connect your own Strava; GET /strava/callback finishes it,
 *                             POST /api/strava/disconnect ends it
 *   POST /api/strava/owner    { method, args } on the owner's Strava client, for Totem
 *   POST /api/whoop/connect   connect the owner's WHOOP; GET /whoop/callback finishes it,
 *                             POST /api/whoop/disconnect ends it
 *   POST /api/whoop/owner     { method, args } on the owner's WHOOP client, for Totem and Krakatoa
 *   POST /api/plan/workout    { kinds, minutes, goal } -> a prescription, stored nowhere
 *   POST /api/plan/revise     { plan, message } -> the same plan, changed; stored nowhere
 *   GET  /api/plan/drafts     this person's AI workout drafts; POST one to start writing it;
 *                             GET/PUT/DELETE /api/plan/drafts/:id, POST …/:id/revise, …/retry, …/keep
 *                             (server/drafts.js: the run belongs to the draft, not the page)
 *   GET  /api/state           { version, updatedAt, state }
 *   PUT  /api/state           { state } -> merged with what's on disk, returns merged doc
 *   POST /api/entry           { entry } -> upsert one entry, returns merged doc
 *   GET  /api/export          full state as a download
 *   POST /api/import          replace state wholesale (from an export file)
 *   POST /api/act-as          { id } -> the owner acts as someone else (null: back to themselves)
 *   GET  /api/settings/users  the people on this install; POST/PUT/DELETE to change them
 *   GET  /api/people          the owner's list for "With …"; GET/POST /api/people/:id/entry
 *                             reads and writes someone's copy of a shared workout, or a session
 *                             the owner planned for them; /state, /content and /about read their
 *                             log, plan and About you (peopleRoute)
 *   GET/PUT /api/about        this person's own About you (anyone but the owner, whose is in Settings)
 *
 * More than one person can use an install (server/users.js). Everything above
 * that reads or writes a log does so for the person the request is for: the
 * owner's files are the data dir itself, anyone else's are data/users/<id>/.
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
const planner = require('./planner.js')
const { createDrafts, dirOf: draftsDir, keptIdsIn } = require('./drafts.js')
const { createBushidoNotify } = require('./notify.js')
const notifyFacts = require('./notify-facts.js')
const { createConfig } = require('./config.js')
const { ISOLATION } = require('./agentflags.js')
const { createAuth, clientAddress, isLoopback, isHttps } = require('./auth.js')
const { createUsers, createAccessVerifier, identify, actAsCookie, OWNER } = require('./users.js')
const { mergeDaily } = require('./whoop.js')
const sharedSync = require('./sharedsync.js')
const pages = require('./pages.js')

const ROOT = path.resolve(__dirname, '..')
const DATA_DIR = process.env.BUSHIDO_DATA_DIR ? path.resolve(process.env.BUSHIDO_DATA_DIR) : path.join(ROOT, 'data')
/* Everything the owner can change in the browser. See server/config.js. */
const config = createConfig({ root: ROOT, dataDir: DATA_DIR })
const DIST_DIR = process.env.BUSHIDO_DIST_DIR || path.join(ROOT, 'dist')
const WHOOP_FILE = path.join(DATA_DIR, 'whoop.json')

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

/*
 * The people on this install and how a request says which one it is. See
 * server/users.js. With no Cloudflare Access settings, every request is the
 * owner's and nothing below behaves any differently from a one-person install.
 */
const users = createUsers({ dataDir: DATA_DIR, ownerName: () => config.athlete().name })
// BUSHIDO_ACCESS_CERTS_URL is for the test suite, which plays Cloudflare on localhost.
const access = createAccessVerifier({ settings: () => config.access(), certsUrl: process.env.BUSHIDO_ACCESS_CERTS_URL || '' })
const STARTER_PLAN = path.join(ROOT, 'content', 'starter.json')

/**
 * Everything that belongs to one person: their log, its backups and their plan.
 * (A space may also hold coach.json and coach/ from the removed AI coach; nothing
 * reads them, and nothing deletes them either.) The owner's space is the data dir itself, which is where
 * all of it lived before there was more than one person, so nothing moved.
 */
function spaceFor(user) {
  const id = user?.id || OWNER
  const owner = id === OWNER
  const dir = users.dirOf(id)
  return {
    id, owner, dir,
    name: user?.name || '',
    stateFile: path.join(dir, 'state.json'),
    backupDir: path.join(dir, 'backups'),
    /*
     * The owner's plan resolves through config (env, data/plan.json, settings,
     * starter). Anyone else runs on their own imported plan or the starter;
     * an env-pinned plan is the owner's programme, not theirs.
     */
    planFile() {
      if (owner) return config.planFile()
      const own = path.join(dir, 'plan.json')
      return fs.existsSync(own) ? { file: own, source: 'imported' } : { file: STARTER_PLAN, source: 'starter' }
    },
  }
}
const OWNER_SPACE = spaceFor({ id: OWNER })

/*
 * What a person's app may offer. Integrations hold the owner's accounts (WHOOP,
 * Totem habits, the push identity, the brain file), so for anyone
 * else they are off, which renders exactly as an install that never set them
 * up. Strava is the exception: everyone connects their own account here once
 * Settings has a Strava API app.
 *
 * AI is everyone's once a CLI is configured and runs (`aiUsable`): each run is
 * built from the person's own space, About you and plan (`aiRun`), and a run for
 * anyone but the owner is denied the owner's files by flag (agentflags.js).
 * Without one it is off for everyone, the owner included (#55): Plan a workout is
 * the hand-built route alone, and setting AI up is Settings → AI's to say.
 */
function featuresFor(space) {
  const t = config.totem()
  const own = space.owner
  return {
    ai: aiUsable(),
    // The owner's grant, held here (whoopLinked); and a WHOOP app to connect it through.
    whoop: own && whoopLinked(),
    whoopConnect: own && config.whoop().configured,
    // Everyone's own grant, held here (stravaLinked); the owner's too.
    strava: stravaLinked(space),
    // There is a Strava app to connect through.
    stravaConnect: config.strava().configured,
    habitSync: own && t.habitSync,
    notifications: own && Boolean(notify),
  }
}

/*
 * The binary, the key and the models all come from config.ai(), resolved per
 * request so a change in Settings applies without a restart.
 */
/*
 * The workout planner, at deliberately LOW effort: it
 * is answering a button the user pressed on the way out of the door, not holding a
 * conversation, and everything it writes is a prescription the user is about to edit
 * anyway. Two minutes is the ceiling, not the target.
 */
const PLANNER_EFFORT = process.env.BUSHIDO_PLANNER_EFFORT || 'low'
const PLANNER_TIMEOUT_MS = Number(process.env.BUSHIDO_PLANNER_TIMEOUT_MS) || 150000
/* "Write it for me" drafts, and the runs writing them. See server/drafts.js. */
const drafts = createDrafts()

/** What every AI route says when there is no CLI to run. */
const AI_MISSING = 'AI is not set up. Open Settings → AI and point Bushido at the Claude Code CLI.'

/*
 * ABOUT YOU, per person. The owner's is in Settings (data/settings.json), as it
 * always was. Anyone else's is `about.json` in their own space, written by them
 * from the app (PUT /api/about) or by the owner (PUT /api/people/:id/about), and
 * falls back to the name the owner gave them in People.
 */
const ABOUT_NAME_MAX = 80
const ABOUT_NOTES_MAX = 4000
const aboutFile = (space) => path.join(space.dir, 'about.json')

function aboutFor(space) {
  if (space.owner) return config.athlete()
  const a = readJson(aboutFile(space), null) || {}
  return {
    name: String(a.name || '').trim().slice(0, ABOUT_NAME_MAX) || users.get(space.id)?.name || space.name || '',
    notes: String(a.notes || '').trim().slice(0, ABOUT_NOTES_MAX),
  }
}

function writeAbout(space, body) {
  if (space.owner) throw new Error('the owner\'s About you is on the Settings page')
  const doc = {
    name: String(body?.name ?? '').trim().slice(0, ABOUT_NAME_MAX),
    notes: String(body?.notes ?? '').trim().slice(0, ABOUT_NOTES_MAX),
    updatedAt: new Date().toISOString(),
  }
  ensureDirs(space)
  const file = aboutFile(space)
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, file)
  return aboutView(space)
}

const aboutView = (space) => ({ ...aboutFor(space), owner: space.owner, editable: !space.owner })

/**
 * The arguments every model run shares, resolved now, for ONE person's space.
 *
 * The owner's run is what it always was: the data dir, the brain file, the food
 * log, WHOOP and Strava. Anyone else's is built from their own space only: their
 * log (`logDir`), their About you, and none of the owner's sources, which are
 * also denied by path (`person`, `ownerSources`; see agentflags.js). Their absence
 * renders exactly as an install that never configured them: no section at all.
 */
function aiRun(space = OWNER_SPACE) {
  const ai = config.ai()
  const a = aboutFor(space)
  const links = config.links()
  const own = space.owner
  return {
    ai,
    common: {
      bin: ai.bin, env: ai.spawnEnv(),
      repoRoot: ROOT, dataDir: DATA_DIR,
      logDir: own ? DATA_DIR : space.dir,
      brainFile: own ? links.brainFile : null,
      person: own ? null : { dir: space.dir },
      // The owner's own plan too, when it is the owner's (not the shared starter) and lives
      // outside the data dir, which is denied wholesale anyway.
      ownerSources: own ? [] : [links.brainFile, links.brainFile && path.dirname(links.brainFile),
        (() => { const f = config.planFile().file; return f && path.resolve(f) !== path.resolve(STARTER_PLAN) ? f : null })()],
      measurements: own,
      name: a.name, notes: a.notes,
      today: new Date().toISOString().slice(0, 10),
    },
  }
}

/**
 * Whose context an AI route runs on. The requester's own space, unless the
 * owner asked for someone else (`for`): the trainer planning a session or a week
 * for another person on the install, without acting as them. Owner only, not
 * while acting, never "for" the owner.
 */
function aiSpaceFor(body, ctx, space) {
  const id = body?.for ? String(body.for) : null
  if (!id || id === space.id) return { space }
  if (!ctx?.real.admin) return { refused: [403, { error: 'only the owner can plan for someone else' }] }
  if (ctx.acting) return { refused: [409, { error: 'stop logging for someone else first', code: 'acting' }] }
  if (id === OWNER) return { refused: [400, { error: 'that is your own log' }] }
  const person = users.get(id)
  if (!person) return { refused: [404, { error: 'no such person' }] }
  return { space: spaceFor(person) }
}


const EMPTY_STATE = {
  entries: {},
  settings: {},
  settingsUpdatedAt: '1970-01-01T00:00:00.000Z',
}

// ---------------------------------------------------------------- state I/O

/*
 * One write chain per person: two people saving at once touch different files
 * and need not wait for each other, but two devices of the same person must.
 */
const writeChains = new Map()

function ensureDirs(space = OWNER_SPACE) {
  for (const d of [space.dir, space.backupDir]) fs.mkdirSync(d, { recursive: true })
}

function readStateSync(space = OWNER_SPACE) {
  try {
    const raw = fs.readFileSync(space.stateFile, 'utf8')
    const doc = JSON.parse(raw)
    return {
      version: Number(doc.version) || 0,
      updatedAt: doc.updatedAt || new Date(0).toISOString(),
      state: { ...EMPTY_STATE, ...(doc.state || {}) },
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[bushido] ${space.stateFile} unreadable, refusing to clobber it:`, err.message)
      throw err
    }
    return { version: 0, updatedAt: new Date(0).toISOString(), state: structuredClone(EMPTY_STATE) }
  }
}

async function backup(space, doc) {
  if (!doc || doc.version === 0) return
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = path.join(space.backupDir, `state-${stamp}-v${doc.version}.json`)
  await fsp.writeFile(file, JSON.stringify(doc), 'utf8')
  // Only state snapshots rotate. Anything else in backups/ (plan backups live in
  // backups/plans/, but a hand-placed file too) is never pruned by this.
  const files = (await fsp.readdir(space.backupDir)).filter(f => f.startsWith('state-') && f.endsWith('.json')).sort()
  for (const stale of files.slice(0, Math.max(0, files.length - MAX_BACKUPS))) {
    await fsp.unlink(path.join(space.backupDir, stale)).catch(() => {})
  }
}

async function writeAtomic(space, doc) {
  const tmp = `${space.stateFile}.tmp-${process.pid}`
  await fsp.writeFile(tmp, JSON.stringify(doc, null, 2), 'utf8')
  await fsp.rename(tmp, space.stateFile)
}

/*
 * An old client's untick, kept as one.
 *
 * Before 2026-10-25 "Done — tap to undo" wrote a bare `done: false`. Under the
 * done-by-default rule (AGENTS.md §4) that reads as done again on any day that
 * has arrived, so an old phone or a cached web bundle would untick and nothing
 * would change. New code never writes done to not-done without `undone: true`
 * (`markDone`), so a bare `done: false` landing on an entry stored as done can
 * only be that old toggle, and it gets the marker here. It also keeps a marker
 * the stored copy already has, or the old device re-sending its copy at the same
 * `updatedAt` would strip it. An entry stored as `done: false` with no marker (a
 * plan, or a legacy one) is left exactly as it is.
 */
function keepUntick(mine, theirs) {
  if (!mine || mine.deleted || theirs.deleted || (theirs.kind || mine.kind) !== 'daily') return theirs
  const was = mine.data || {}
  const now = theirs.data || {}
  if (now.done !== false || now.undone === true) return theirs
  if (was.done === false && was.undone !== true) return theirs
  return { ...theirs, data: { ...now, undone: true } }
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
    if (!mine || String(theirs.updatedAt) >= String(mine.updatedAt || '')) out.entries[id] = keepUntick(mine, theirs)
  }
  if (incoming.settings && String(incoming.settingsUpdatedAt || '') > String(out.settingsUpdatedAt)) {
    out.settings = incoming.settings
    out.settingsUpdatedAt = incoming.settingsUpdatedAt
  }
  return out
}

function commit(space, mutate) {
  // Queue behind any in-flight write of this person's log, then read-modify-write under that lock.
  const chain = writeChains.get(space.id) || Promise.resolve()
  const next = chain.then(async () => {
    ensureDirs(space) // someone else's folder appears on their first save
    const current = readStateSync(space)
    const merged = mutate(current.state)
    // A mutator with nothing to change hands back what it was given: no new version, no backup.
    if (merged === current.state) return current
    const doc = {
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
      state: merged,
    }
    await backup(space, current)
    await writeAtomic(space, doc)
    return doc
  })
  writeChains.set(space.id, next.catch(() => {})) // a failed write must not poison the chain
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
    const fact = notifyFacts.workoutLoggedFact({ entry, now: Date.now() })
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
 * The scheduled half: readiness and unlogged workouts.
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
      state: readStateSync(OWNER_SPACE).state,
      whoop: readCache(WHOOP_FILE),
      strava: readStravaCache(OWNER_SPACE),
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

/*
 * Done once its day has arrived, unless marked undone (AGENTS.md §4). The ONE
 * server definition is in server/notify-facts.js, word for word the app's, so the
 * habit and the "nice session" push cannot disagree about it. It takes today as
 * a date, and the server's today is the configured timezone's, not the machine's.
 */
const isDone = notifyFacts.isDone
const todayKey = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: config.tz(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)

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
 *
 * A session planned for a later day is not in that day's record until the day
 * arrives (`isDone`). Nothing wakes at midnight to send it then: the next write
 * after that does, because every sync re-sends the record of every day the
 * payload holds (`syncDailyEntries`), and the record is rebuilt whole each time,
 * so sending it again is harmless.
 */
function habitBodyForDay(dateIso, state, today = todayKey()) {
  const done = Object.values(state?.entries || {})
    .filter(e => e?.kind === 'daily' && e.date === dateIso && isDone(e, today))
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
 * The owner's WHOOP: workouts, daily recovery and sleep.
 *
 * The grant is held here (since 2026-10-14; before that, by the Totem bridge).
 * WHOOP rotates its refresh token on every refresh and voids the old pair, so
 * exactly one process may hold it, and within it one refresh may run at a time
 * (server/whoop-api/client.mjs). Totem's sleep habit and Krakatoa's calorie
 * burn read through this one client (`POST /api/whoop/owner`), never their own.
 * Owner only: the WHOOP app in Settings is the owner's.
 *
 * Everything here is best-effort. A WHOOP outage or a revoked grant leaves the
 * cache exactly as it was and none of them may fail a request the app needs to
 * load. See server/whoop.js for what is cached versus what is theirs.
 */

const WHOOP_DAYS = Number(process.env.BUSHIDO_WHOOP_DAYS || 21)
/*
 * The most one pull fetches. A cache that has never had a long pull gets one,
 * once, so the sleep graph opens on two months rather than three weeks; after
 * that the ordinary pulls extend it (see mergeDaily in server/whoop.js).
 */
const WHOOP_BACKFILL_DAYS = 60
// How stale the cache may be before opening the app refreshes it. Ten minutes is
// well inside WHOOP's 100/min limit even with the app open on two devices, and
// the band usually has not synced by the time the user leaves the gym anyway — which is
// what the Pull button is for.
const WHOOP_TTL_MS = Number(process.env.BUSHIDO_WHOOP_TTL_MS || 10 * 60 * 1000)
const WHOOP_TOKENS_FILE = path.join(DATA_DIR, 'whoop-oauth.json')

let whoopState = { at: null, ok: null, detail: 'no pull attempted yet' }
let whoopInFlight = null
let whoopClient = null
const whoopHolder = { redirectUri: '' }

function whoopClientOf() {
  if (!whoopClient) {
    const { createWhoopClient } = require('./whoop-api/client.mjs')
    const app = () => config.whoop()
    whoopClient = createWhoopClient({
      clientId: () => app().clientId,
      clientSecret: () => app().clientSecret(),
      redirectUri: () => app().redirectUri || whoopHolder.redirectUri,
      tokensFile: WHOOP_TOKENS_FILE,
      log: (m) => console.error(`[whoop] ${m}`),
    })
  }
  return whoopClient
}

/** Whether the owner's grant is on disk. Sync: featuresFor runs on every request. */
function whoopLinked() {
  if (!config.whoop().configured) return false
  return Boolean(readJson(WHOOP_TOKENS_FILE, null)?.refresh_token)
}

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
 * Pull from WHOOP and replace the cache.
 *
 * Serialised through `whoopInFlight`: opening the app on a phone and a laptop at
 * once would otherwise start two pulls and have them race to rename the same
 * file. The second caller waits on the first's result rather than starting again.
 */
function pullWhoop({ days = WHOOP_DAYS } = {}) {
  if (!whoopLinked()) return Promise.resolve({ ok: false, error: 'WHOOP is not connected: connect it in profile → Settings' })
  if (whoopInFlight) return whoopInFlight
  const prev = readWhoopCache()
  if (!prev?.backfilledAt) days = Math.max(days, WHOOP_BACKFILL_DAYS)
  whoopInFlight = (async () => {
    try {
      const body = await whoopClientOf().training({ days })
      const today = new Date().toISOString().slice(0, 10)
      const sleep = Array.isArray(body.sleep) ? body.sleep : []
      const doc = {
        fetchedAt: body.fetchedAt || new Date().toISOString(),
        days: body.days ?? days,
        maxHeartRate: body.maxHeartRate ?? null,
        workouts: Array.isArray(body.workouts) ? body.workouts : [],
        // Laid over what was cached, so the sleep graph can look back further than one pull.
        recovery: mergeDaily(prev?.recovery, Array.isArray(body.recovery) ? body.recovery : [], { today }),
        sleep: mergeDaily(prev?.sleep, sleep, { today }),
        // Only once a long pull actually brought nights back.
        backfilledAt: prev?.backfilledAt || (days >= WHOOP_BACKFILL_DAYS && sleep.length ? new Date().toISOString() : null),
      }
      await writeWhoopCache(doc)
      whoopState = {
        at: doc.fetchedAt,
        ok: true,
        detail: `${doc.workouts.length} workouts, ${doc.recovery.length} days, ${doc.sleep.length} nights`,
      }
      return { ok: true, ...doc }
    } catch (err) {
      // The client puts the FIX in the message ("reconnect WHOOP in Bushido to
      // grant the scope"), so it is carried through verbatim.
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
  if (!whoopLinked()) return
  const cache = readWhoopCache()
  const age = cache?.fetchedAt ? Date.now() - Date.parse(cache.fetchedAt) : Infinity
  if (!(age > WHOOP_TTL_MS)) return
  pullWhoop().catch(() => {}) // logged in whoopState; never thrown at a request
}

/*
 * What Totem and Krakatoa may call on the owner's client (`POST /api/whoop/owner`):
 * Totem's Connections row reads `status`, its sleep habit `sleepNights`, and
 * Krakatoa's calorie burn `training`. Connecting is not on the list.
 */
const WHOOP_OWNER_METHODS = new Set(['status', 'training', 'sleepNights'])

/* Where WHOOP sends the owner back to; the WHOOP app must list this exact URL. */
function whoopRedirectFor(req) {
  if (PUBLIC_URL) return `${PUBLIC_URL}/whoop/callback`
  const proto = String(req.headers['x-forwarded-proto'] || (isHttps(req) ? 'https' : 'http')).split(',')[0].trim()
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim()
  return `${proto}://${host}/whoop/callback`
}

// ------------------------------------------------------------------ strava

/*
 * Strava, for everyone on the install, the owner included.
 *
 * Bushido holds the grants. Each person connects their own account through the
 * Strava API app in Settings (config.strava()); the grant and the cache live in
 * their space (strava-oauth.json, strava.json), which for the owner is the data
 * dir itself. The client is server/strava-api/, which used to be Totem's: Totem
 * now reads the owner's Strava from here (`POST /api/strava/owner`) rather than
 * holding its own grant, so the owner's client also keeps the full activity
 * mirror (strava-activities.json) Totem's goals and mileage read.
 *
 * Best-effort throughout: Strava down or a revoked grant leaves the cache as it
 * was, and no request the app needs may fail over it.
 */
const STRAVA_DAYS = Number(process.env.BUSHIDO_STRAVA_DAYS || 21)
const STRAVA_TTL_MS = Number(process.env.BUSHIDO_STRAVA_TTL_MS || 10 * 60 * 1000)
/* Everyone else's: reads only. The owner's: everything, for Totem's agents (rename a ride, log one, set weight). */
const STRAVA_READ_SCOPES = ['read', 'profile:read_all', 'activity:read_all']

const stravaClients = new Map()
const stravaStates = new Map()
const stravaInFlight = new Map()

function stravaClientFor(space) {
  let client = stravaClients.get(space.id)
  if (!client) {
    const { createStravaClient } = require('./strava-api/client.mjs')
    const app = () => config.strava()
    const holder = { redirectUri: '' }
    client = createStravaClient({
      clientId: () => app().clientId,
      clientSecret: () => app().clientSecret(),
      redirectUri: () => app().redirectUri || holder.redirectUri,
      tokensFile: path.join(space.dir, 'strava-oauth.json'),
      cacheFile: path.join(space.dir, 'strava-activities.json'),
      ...(space.owner ? {} : { scopes: STRAVA_READ_SCOPES }),
      timeZone: config.tz(),
      log: (m) => console.error(`[strava ${space.id}] ${m}`),
    })
    client.holder = holder
    stravaClients.set(space.id, client)
  }
  return client
}

const stravaFileOf = (space) => path.join(space.dir, 'strava.json')
const stravaStateOf = (space) => stravaStates.get(space.id) || { at: null, ok: null, detail: 'no pull attempted yet' }

/** Whether this person has a grant on disk. Sync: featuresFor runs on every request. */
function stravaLinked(space) {
  if (!config.strava().configured) return false
  try {
    return Boolean(JSON.parse(fs.readFileSync(path.join(space.dir, 'strava-oauth.json'), 'utf8')).refresh_token)
  } catch {
    return false
  }
}

function readStravaCache(space = OWNER_SPACE) {
  return readJson(stravaFileOf(space), null)
}

/**
 * Pull the recent window and replace the cache. Serialised per person: opening
 * the app on a phone and a laptop at once would otherwise race two renames.
 */
function pullStrava(space = OWNER_SPACE, { days = STRAVA_DAYS } = {}) {
  if (!stravaLinked(space)) return Promise.resolve({ ok: false, error: 'Strava is not connected for this account' })
  if (stravaInFlight.has(space.id)) return stravaInFlight.get(space.id)
  const run = (async () => {
    const client = stravaClientFor(space)
    try {
      // `training()` trims the athlete to what training needs; the picture is on the full one.
      const [body, athlete] = await Promise.all([client.training({ days }), client.athlete().catch(() => null)])
      const doc = {
        fetchedAt: body.fetchedAt || new Date().toISOString(),
        days: body.days ?? days,
        athlete: body.athlete
          ? {
              ...body.athlete,
              firstname: athlete?.firstname ?? null,
              username: athlete?.username ?? null,
              profile: athlete?.profile ?? null,
              profileMedium: athlete?.profileMedium ?? null,
            }
          : (athlete || null),
        gear: body.gear && typeof body.gear === 'object' ? body.gear : {},
        activities: Array.isArray(body.activities) ? body.activities : [],
      }
      const file = stravaFileOf(space)
      await fsp.mkdir(space.dir, { recursive: true })
      const tmp = `${file}.tmp-${process.pid}`
      await fsp.writeFile(tmp, JSON.stringify(doc, null, 2))
      await fsp.rename(tmp, file)
      stravaStates.set(space.id, { at: doc.fetchedAt, ok: true, detail: `${doc.activities.length} activities` })
      return { ok: true, ...doc }
    } catch (err) {
      stravaStates.set(space.id, { at: new Date().toISOString(), ok: false, detail: err.message })
      return { ok: false, error: err.message }
    }
  })().finally(() => stravaInFlight.delete(space.id))
  stravaInFlight.set(space.id, run)
  return run
}

/** Refresh in the background if stale, and return immediately. */
function refreshStravaIfStale(space = OWNER_SPACE) {
  if (!stravaLinked(space)) return
  const cache = readStravaCache(space)
  const age = cache?.fetchedAt ? Date.now() - Date.parse(cache.fetchedAt) : Infinity
  if (age > STRAVA_TTL_MS) pullStrava(space).catch(() => {})
}

/**
 * One activity in full: laps, mile splits, calories, description, gear name.
 * Fetched at attach time, so the snapshot carries the whole ride; a failure
 * degrades to attaching the summary, which is still every headline number.
 */
async function fetchStravaDetail(space, id) {
  try {
    return { ok: true, activity: await stravaClientFor(space).activity(id, { laps: true }) }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/*
 * What Totem may call on the owner's client (`POST /api/strava/owner`). The
 * same methods Totem's own client had, so its goals, MCP tools and CLI did not
 * change when the grant moved here. Connecting is not on the list: that is done
 * in Bushido, by the owner.
 */
const STRAVA_OWNER_METHODS = new Set([
  'status', 'athlete', 'stats', 'zones', 'activities', 'activity', 'gear', 'routes', 'routeStreams',
  'segments', 'clubs', 'updateActivity', 'createActivity', 'updateAthlete', 'sync', 'readCache',
  'cachedList', 'cachedMileage', 'training',
])

/*
 * Where Strava sends them back to. A redirect URI in Settings wins; otherwise
 * this request's own origin, which is the address they opened the app on. The
 * Strava app's "Authorization Callback Domain" has to cover that host.
 */
function stravaRedirectFor(req) {
  if (PUBLIC_URL) return `${PUBLIC_URL}/strava/callback`
  const proto = String(req.headers['x-forwarded-proto'] || (isHttps(req) ? 'https' : 'http')).split(',')[0].trim()
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim()
  return `${proto}://${host}/strava/callback`
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
  for (const entry of notifyFacts.completedDailyEntries(incoming, before, todayKey())) {
    notifyWorkoutLogged(entry).catch(() => {})
  }
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
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
  /*
   * Sign-in for the native app (mobile/): the same check as /login, answered as
   * JSON with the session value instead of a cookie. The app keeps it in the
   * keychain and sends it as `Authorization: Bearer`, which auth.check reads the
   * same way it reads the cookie. Nothing about the browser's sign-in changes.
   */
  if (p === '/api/auth/session' && req.method === 'POST') {
    if (auth.mode === 'proxy') { send(res, 409, { error: 'sign-in is handled by the proxy (BUSHIDO_AUTH=proxy)' }); return true }
    if (!auth.hasOwner()) { send(res, 409, { error: 'this Bushido has no account yet: open the setup link from the server log in a browser first' }); return true }
    let body
    try { body = await readBody(req, 16 * 1024) } catch (err) { send(res, 400, { error: err.message }); return true }
    try {
      const session = await auth.login({ username: body?.username, password: body?.password, ip: clientIp(req) })
      send(res, 200, { session, user: auth.owner() }, { 'Cache-Control': 'no-store' })
    } catch (err) {
      send(res, err.status || 401, { error: err.message })
    }
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
let aiVersionRun = null
const aiVersionFresh = (bin) => aiVersionCache.bin === bin && Date.now() - aiVersionCache.at < 60_000
/** `claude --version`, cached for a minute. Null when it will not run. */
function aiVersion() {
  const ai = config.ai()
  if (!ai.executable) return Promise.resolve(null)
  if (aiVersionFresh(ai.bin)) return Promise.resolve(aiVersionCache.value)
  if (aiVersionRun?.bin === ai.bin) return aiVersionRun.promise
  const promise = new Promise((resolve) => {
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
  }).finally(() => { if (aiVersionRun?.promise === promise) aiVersionRun = null })
  aiVersionRun = { bin: ai.bin, promise }
  return promise
}

/*
 * Whether the configured CLI can be run: found, executable, and not a binary
 * whose last `--version` failed. Sync, because featuresFor asks on every
 * request, so it reads the cached probe and starts a fresh one when it is stale;
 * until the first probe answers, an executable file is taken at its word.
 */
function aiUsable() {
  const ai = config.ai()
  if (!ai.executable) return false
  if (!aiVersionFresh(ai.bin)) aiVersion()
  return !(aiVersionCache.bin === ai.bin && aiVersionCache.at && aiVersionCache.value === null)
}

/** One tiny request through the configured CLI, for the Test button. */
function testAi() {
  const ai = config.ai()
  if (!ai.installed) return Promise.reject(new Error(AI_MISSING))
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const child = spawn(ai.bin, [
      '--print', '--model', ai.plannerModel, '--output-format', 'json',
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
      resolve({ ok: true, ms: Date.now() - started, model: modelOf(doc) || ai.plannerModel, reply: String(doc.result || '').slice(0, 200) })
    })
    child.stdin.end('Reply with the single word: ok')
  })
}

const PLAN_LABELS = { starter: 'Starter content (no plan of your own yet)', imported: 'Your own plan (data/plan.json)', settings: 'A file chosen in settings' }

async function settingsView(who, ctx) {
  const ai = config.ai()
  const t = config.totem()
  const space = spaceFor(ctx.user)
  const pf = space.planFile()
  const acc = config.access()
  const envFileSource = process.env.BUSHIDO_TOTEM_ENV ? 'env BUSHIDO_TOTEM_ENV' : (t.envFile ? 'settings' : 'off')
  return {
    auth: { mode: auth.mode, source: config.authMode().source, user: who?.user?.username || auth.owner() },
    settings: config.publicView(),
    people: {
      users: users.list(),
      access: { enabled: acc.enabled, team: acc.team, teamSource: acc.teamSource, aud: acc.aud, audSource: acc.audSource },
      /* The plan card below is this person's: acting as someone changes whose plan it imports. */
      planFor: space.owner ? null : ctx.user.name,
    },
    effective: {
      ai: {
        installed: ai.installed, bin: ai.bin, binSource: ai.binSource,
        apiKeySet: ai.apiKeySet, apiKeySource: ai.apiKeySource,
        model: ai.model.value, defaultModel: require('./config.js').DEFAULT_MODEL,
      },
      totem: {
        enabled: t.enabled, url: t.url, urlSource: t.urlSource, secretSource: t.secretSource, envFileSource,
        habitSync: t.habitSync,
      },
      strava: (() => {
        const sa = config.strava()
        return { configured: sa.configured, clientIdSource: sa.clientIdSource, secretSource: sa.secretSource, redirectUriSource: sa.redirectUriSource, publicUrl: PUBLIC_URL || null }
      })(),
      whoop: (() => {
        const wa = config.whoop()
        return { configured: wa.configured, clientIdSource: wa.clientIdSource, secretSource: wa.secretSource, redirectUriSource: wa.redirectUriSource, linked: whoopLinked(), publicUrl: PUBLIC_URL || null }
      })(),
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
async function backupOwnPlan(space) {
  const file = path.join(space.dir, 'plan.json')
  if (!fs.existsSync(file)) return null
  const dir = path.join(space.backupDir, 'plans')
  await fsp.mkdir(dir, { recursive: true })
  const to = path.join(dir, `plan-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  await fsp.copyFile(file, to)
  return to
}

async function writeOwnPlan(space, plan) {
  await backupOwnPlan(space)
  ensureDirs(space)
  const file = path.join(space.dir, 'plan.json')
  const tmp = `${file}.tmp-${process.pid}`
  await fsp.writeFile(tmp, JSON.stringify(plan, null, 2))
  await fsp.rename(tmp, file)
  if (space.owner) config.clearPlanFile()
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

/*
 * THE OWNER AS TRAINER: shared workouts and sessions planned for someone else.
 *
 * The owner, logging a workout together with someone else on the install, reads
 * and writes that person's copy of it from the owner's own sheet; and plans a
 * session or a week for them that lands in THEIR log. Act-as switches the whole
 * app; this touches one entry at a time.
 *
 *   GET  /api/people                         { people: [{ id, name, owner }] }
 *   GET  /api/people/:id/entry?id=<entryId>  { entry | null, version }
 *   GET  /api/people/:id/entry?date=<iso>    { entries: [that day's daily entries, tombstones too], version }
 *   POST /api/people/:id/entry   { entry }   { entry (as merged), version }
 *   GET  /api/people/:id/state               their whole log, read-only ({ state, version, … } like /api/state)
 *   GET  /api/people/:id/content             the plan their app runs on
 *   GET/PUT /api/people/:id/about            their About you ({ name, notes })
 *
 * The rules, each of which is a refusal below:
 *
 *   - The owner only, and not while acting as someone (the app hides the control
 *     then; a request that still arrives is from a confused tab).
 *   - Never the owner's own log: that has `/api/entry`, with habit sync and the
 *     "logged" push. These writes are in someone else's space, so neither fires.
 *   - A daily entry, written through the same commit (backup on write, one
 *     write chain per person) and the same last-write-wins merge as the person's
 *     own saves. A removal is a tombstone, as everywhere else.
 *   - Only the parts of their log that came from the owner: a shared workout
 *     (`data.sharedFrom`) or a session the owner planned for them
 *     (`data.plannedBy`). A live entry at that id carrying neither is something
 *     they logged themselves, and the owner must never overwrite it (409
 *     `not-shared`; the app picks another id).
 *     Both markers are stamped here from users.json, never taken from the request.
 *   - A planned session is a daily entry with a derivable id. (Planning someone's
 *     week, their `quota-<monday>`, went with the quotas on 2026-10-25.)
 *   - A new daily entry is `done: false` whatever the request said, so it never
 *     looks like their own tick (`hasOwnMarks` in lib/shared.js). `isDone` still
 *     reads it as done from its day on, like any planned session (AGENTS.md §4).
 */
/*
 * SYNC (server/sharedsync.js). A shared workout with sync on is one structure
 * in two logs, so every write that lands on either side goes through here:
 * the owner's own saves (`/api/state`, `/api/entry`), the other person's own
 * saves, and the owner writing their side through `/api/people/:id/entry`.
 * The write is rebased on what is stored (a stale device cannot undo the
 * other side's changes), then its structural change is carried to the other
 * log. The carry is best effort: a failure is logged and never fails the
 * save, like habit sync. Writes made BY the carry go straight to `commit` and
 * are not carried again.
 */

/** What an entry being written is synced with: see sharedSync.onWrite. */
function syncLinksFor(space) {
  if (space.owner) {
    return (e, was) => {
      const links = sharedSync.syncedLinks(e)
      if (!links.length) return null
      const prev = sharedSync.syncedLinks(was)
      return {
        wasSynced: prev.length > 0,
        to: links.map(l => ({ personId: l.id, entryId: l.entryId, align: !prev.some(p => p.id === l.id && p.entryId === l.entryId) })),
      }
    }
  }
  let ownerLog = null
  return (e) => {
    if (!e.data?.sharedFrom) return null
    ownerLog = ownerLog || readStateSync(OWNER_SPACE).state.entries || {}
    const owner = ownerEntryLinking(ownerLog, space.id, e)
    return owner ? { wasSynced: true, ref: owner.data, to: [{ ownerEntryId: owner.id }] } : null
  }
}

/** The owner's entry that links this copy with sync on, or null. */
function ownerEntryLinking(ownerLog, personId, copy) {
  for (const e of Object.values(ownerLog)) {
    if (e?.kind !== 'daily' || e.date !== copy.date) continue
    if (sharedSync.syncedLinks(e).some(l => l.id === personId && l.entryId === copy.id)) return e
  }
  return null
}

/**
 * `commit` for a write that may touch a shared workout. `merge(base)` is the
 * write's own merge; `ids` the entries it carried. Resolves `{ doc, before }`
 * once the other side has been written too.
 */
async function commitSynced(space, ids, merge) {
  let before = null
  let carries = []
  const doc = await commit(space, base => {
    before = base
    const next = merge(base)
    const r = sharedSync.onWrite(base, next, ids, syncLinksFor(space))
    carries = r.carries
    return r.state
  })
  for (const c of carries) {
    try { await carryShared(space, c) } catch (err) { console.error('[bushido] shared workout sync failed:', err.message) }
  }
  return { doc, before }
}

const isCopy = (e) => Boolean(e.data?.sharedFrom)

async function carryShared(from, c) {
  if (from.owner) {
    const person = users.get(c.personId)
    if (person) await commit(spaceFor(person), st => sharedSync.receive(st, c.entryId, c, isCopy))
    return
  }
  // From someone's copy to the owner's entry, then on to anyone else on it.
  const stillLinked = (e) => sharedSync.syncedLinks(e).some(l => l.id === from.id)
  const doc = await commit(OWNER_SPACE, st => sharedSync.receive(st, c.ownerEntryId, c, stillLinked))
  for (const l of sharedSync.syncedLinks(doc.state.entries[c.ownerEntryId])) {
    const person = l.id !== from.id && users.get(l.id)
    if (person) await commit(spaceFor(person), st => sharedSync.receive(st, l.entryId, c, isCopy))
  }
}

const DAILY_ID_RE = /^daily-(\d{4}-\d{2}-\d{2})(?:-[\w.-]{1,80})?$/
const fromOwner = (data) => Boolean(data && (data.sharedFrom || data.plannedBy))

async function peopleRoute(req, res, url, ctx) {
  if (!ctx?.real.admin) return send(res, 403, { error: 'only the owner can do that' })
  if (ctx.acting) {
    return send(res, 409, { error: 'stop logging for someone else first', code: 'acting' }, { 'Cache-Control': 'no-store' })
  }
  const p = url.pathname
  if (p === '/api/people' && req.method === 'GET') {
    return send(res, 200, { people: users.list().map(u => ({ id: u.id, name: u.name, owner: u.owner })) },
      { 'Cache-Control': 'no-store' })
  }
  const m = /^\/api\/people\/([^/]+)\/(entry|state|content|about)$/.exec(p)
  if (!m) return send(res, 404, { error: 'no such endpoint' })
  const id = decodeURIComponent(m[1])
  if (id === OWNER || id === ctx.real.id) {
    return send(res, 400, { error: 'that is your own log; it is written through /api/entry' })
  }
  const person = users.get(id)
  if (!person) return send(res, 404, { error: 'no such person' })
  const space = spaceFor(person)
  const what = m[2]

  /* Read-only views, for the owner's "their day" list and for planning with their context. */
  if (what === 'state') {
    if (req.method !== 'GET') return send(res, 405, { error: 'GET only; entries are written one at a time through /entry' })
    return send(res, 200, readStateSync(space), { 'Cache-Control': 'no-store' })
  }
  if (what === 'content') {
    if (req.method !== 'GET') return send(res, 405, { error: 'GET only' })
    try {
      const raw = await fsp.readFile(space.planFile().file, 'utf8')
      return send(res, 200, raw, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' })
    } catch { return send(res, 404, { error: 'no plan for them yet' }) }
  }
  if (what === 'about') {
    if (req.method === 'GET') return send(res, 200, aboutView(space), { 'Cache-Control': 'no-store' })
    if (req.method === 'PUT') {
      const body = await readBody(req, 32 * 1024)
      return send(res, 200, writeAbout(space, body), { 'Cache-Control': 'no-store' })
    }
    return send(res, 405, { error: 'GET or PUT' })
  }

  if (req.method === 'GET') {
    const doc = readStateSync(space)
    const all = doc.state.entries || {}
    const entryId = url.searchParams.get('id')
    const date = url.searchParams.get('date')
    if (entryId) return send(res, 200, { entry: all[entryId] || null, version: doc.version }, { 'Cache-Control': 'no-store' })
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const entries = Object.values(all).filter(e => e?.kind === 'daily' && e.date === date)
      return send(res, 200, { entries, version: doc.version }, { 'Cache-Control': 'no-store' })
    }
    return send(res, 400, { error: 'ask for ?id=<entry id> or ?date=<yyyy-mm-dd>' })
  }

  if (req.method === 'POST') {
    const body = await readBody(req, 1024 * 1024)
    const entry = body?.entry
    const idm = DAILY_ID_RE.exec(String(entry?.id || ''))
    const daily = Boolean(entry && idm && entry.kind === 'daily' && entry.date === idm[1])
    if (!entry || typeof entry !== 'object' || !daily) {
      return send(res, 400, { error: 'expected { entry: { id: "daily-<date>…", kind, date, data } }' })
    }
    if (!entry.data || typeof entry.data !== 'object' || !fromOwner(entry.data)) {
      return send(res, 400, { error: 'only a shared workout (data.sharedFrom) or something you planned for them (data.plannedBy) can be written here' })
    }
    const owner = users.owner()
    const NOT_SHARED = 'not-shared'
    let doc
    try {
      ;({ doc } = await commitSynced(space, [entry.id], base => {
        const cur = base.entries?.[entry.id]
        const live = cur && !cur.deleted
        // Thrown, not returned: a refusal must not write a new version or a backup.
        if (live && !fromOwner(cur.data)) throw new Error(NOT_SHARED)
        const stamp = { id: owner.id, name: owner.name }
        const data = { ...entry.data }
        if (data.sharedFrom) data.sharedFrom = stamp
        if (data.plannedBy) data.plannedBy = stamp
        if (!live && !entry.deleted) data.done = false
        const stamped = { ...entry, data, updatedAt: entry.updatedAt || new Date().toISOString() }
        return mergeState(base, { entries: { [entry.id]: stamped } })
      }))
    } catch (err) {
      if (err.message !== NOT_SHARED) throw err
      return send(res, 409, {
        error: `${person.name} already logged something else under that id`,
        code: NOT_SHARED,
      })
    }
    // No syncDailyEntries: habit sync and the "logged" push are the owner's, about the owner's log.
    return send(res, 200, { entry: doc.state.entries[entry.id], version: doc.version })
  }

  return send(res, 405, { error: 'GET or POST' })
}

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

  /*
   * Which person this is, and whose log it is for. See server/users.js. A
   * signed-out request that got this far is a public notify path; it is nobody's.
   */
  let ctx = null
  if (who.ok) {
    try {
      ctx = await identify({ req, gate: who, mode: auth.mode, users, access })
    } catch (err) {
      console.error('[bushido] identify failed:', err.message)
      return send(res, 500, { error: err.message })
    }
    if (ctx.refused) {
      if (p.startsWith('/api/')) return send(res, ctx.refused.status, { error: ctx.refused.error })
      return html(res, ctx.refused.status, pages.refusedPage({ message: ctx.refused.error }))
    }
    /*
     * The app says whose log it thinks it is holding. If that is not who this
     * request is for (the owner stopped acting as someone in another tab, the
     * act-as cookie expired), nothing is read or written: one person's cached log
     * must never be merged into another's. The app reloads on this answer.
     */
    const claimed = req.headers['x-bushido-user']
    if (claimed && p.startsWith('/api/') && claimed !== ctx.user.id) {
      return send(res, 409, { error: 'this device was showing someone else\'s log; reloading', code: 'user-changed' },
        { 'X-Bushido-Auth': 'switched', 'Cache-Control': 'no-store' })
    }
  }
  const space = ctx ? spaceFor(ctx.user) : OWNER_SPACE
  const features = featuresFor(space)

  /*
   * Notifications are the owner's: one push identity, and every fact it sends
   * is about the owner's log. Anyone else is told they are off, in the shape the
   * client already reads, and cannot subscribe a device to the owner's pushes.
   */
  if (ctx && !space.owner && p.startsWith('/api/push')) {
    if (p === '/api/push/key' && req.method === 'GET') {
      return send(res, 200, { configured: false, publicKey: null, error: 'Notifications are not available on this account yet.' })
    }
    const pub = notify?.publicPaths
    const isPublic = Boolean(pub && (typeof pub.has === 'function' ? pub.has(p) : Array.isArray(pub) && pub.includes(p)))
    if (!isPublic) return send(res, 403, { error: 'notifications are not available on this account yet' })
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
    /*
     * Settings are the install's, so they are the owner's (the admin's) alone.
     * Someone else signed in through Access gets the app and their own log.
     */
    const adminOnly = p === '/settings' || p.startsWith('/api/settings') || p === '/api/act-as'
    if (adminOnly && !ctx?.real.admin) {
      if (p === '/settings') return html(res, 403, pages.refusedPage({ message: 'Settings are for the owner of this install.' }))
      return send(res, 403, { error: 'only the owner can do that' })
    }

    if (p === '/settings' && req.method === 'GET') return html(res, 200, pages.settingsPage())

    /*
     * Connecting your own Strava, owner or not. Refused while acting as someone:
     * the owner would be granting his account to their log. The callback comes
     * back through the same sign-in, so it lands in the space of whoever started
     * it; the client's `state` ties it to that start.
     */
    if (p === '/api/strava/connect' || p === '/api/strava/disconnect' || p === '/strava/callback') {
      const refuse = ctx?.acting ? 'Stop logging for someone else first.'
          : !features.stravaConnect ? 'Strava is not set up on this install yet.' : ''
      if (p === '/strava/callback' && req.method === 'GET') {
        if (refuse) return html(res, 409, pages.refusedPage({ message: refuse }))
        const result = await stravaClientFor(space).completeAuth(url.searchParams).catch(err => ({ ok: false, message: err.message }))
        if (!result.ok) return html(res, 400, pages.refusedPage({ message: result.message }))
        await pullStrava(space)
        return redirect(res, '/?strava=connected')
      }
      if (refuse) return send(res, 409, { error: refuse })
      if (p === '/api/strava/connect' && req.method === 'POST') {
        const client = stravaClientFor(space)
        client.holder.redirectUri = stravaRedirectFor(req)
        return send(res, 200, await client.startAuth(), { 'Cache-Control': 'no-store' })
      }
      if (p === '/api/strava/disconnect' && req.method === 'POST') {
        const result = await stravaClientFor(space).disconnect()
        await fsp.rm(stravaFileOf(space), { force: true })
        stravaStates.delete(space.id)
        return send(res, 200, result)
      }
    }

    /*
     * Totem's way to the owner's Strava: `{ method, args }` run on the owner's
     * client (STRAVA_OWNER_METHODS), answered with the result. A StravaError keeps
     * its message and flags, because Totem's dashboard and agents show the fix it
     * carries ("reconnect to grant activity:write"). Owner only, never acting.
     */
    if (p === '/api/strava/owner' && req.method === 'POST') {
      if (!space.owner || ctx?.acting) return send(res, 403, { error: 'only the owner\'s Strava is served to Totem' })
      const body = await readBody(req).catch(() => null)
      const method = String(body?.method || '')
      if (!STRAVA_OWNER_METHODS.has(method)) return send(res, 400, { error: `unknown Strava method: ${method || '(none)'}` })
      if (!config.strava().configured) return send(res, 409, { error: 'Bushido has no Strava app yet: add one in Bushido Settings → Strava.', needsReauth: true })
      const args = Array.isArray(body?.args) ? body.args : []
      const client = stravaClientFor(space)
      try {
        const result = await client[method](...args)
        if (method === 'status') {
          result.connectWhere = 'profile → Settings → Connect Strava'
          result.rateLimit = client.rateLimit
        }
        if (method === 'sync' || method === 'updateActivity' || method === 'createActivity') stravaStates.delete(space.id)
        return send(res, 200, { result: result ?? null }, { 'Cache-Control': 'no-store' })
      } catch (err) {
        const status = err.name === 'StravaError' ? (err.status === 404 ? 404 : err.rateLimited ? 429 : 502) : 500
        return send(res, status, {
          error: err.message || String(err), status: err.status ?? null,
          needsReauth: err.needsReauth || undefined, missingScope: err.missingScope || undefined, rateLimited: err.rateLimited || undefined,
        })
      }
    }

    /*
     * Connecting the owner's WHOOP. Owner only and never while acting as someone:
     * the WHOOP app in Settings is the owner's, and Totem and Krakatoa read this
     * grant. The callback comes back through the same sign-in; the client's
     * `state` ties it to the start.
     */
    if (p === '/api/whoop/connect' || p === '/api/whoop/disconnect' || p === '/whoop/callback') {
      const refuse = !space.owner || ctx?.acting ? 'Only the owner connects WHOOP, and not while logging for someone else.'
          : !features.whoopConnect ? 'WHOOP is not set up on this install yet: add the WHOOP app in Settings.' : ''
      if (p === '/whoop/callback' && req.method === 'GET') {
        if (refuse) return html(res, 409, pages.refusedPage({ message: refuse }))
        const result = await whoopClientOf().completeAuth(url.searchParams).catch(err => ({ ok: false, message: err.message }))
        if (!result.ok) return html(res, 400, pages.refusedPage({ message: result.message }))
        await pullWhoop()
        return redirect(res, '/?whoop=connected')
      }
      if (refuse) return send(res, 409, { error: refuse })
      if (p === '/api/whoop/connect' && req.method === 'POST') {
        whoopHolder.redirectUri = whoopRedirectFor(req)
        return send(res, 200, whoopClientOf().startAuth(), { 'Cache-Control': 'no-store' })
      }
      if (p === '/api/whoop/disconnect' && req.method === 'POST') {
        const result = await whoopClientOf().disconnect()
        whoopState = { at: new Date().toISOString(), ok: null, detail: 'disconnected' }
        return send(res, 200, result)
      }
    }

    /*
     * Totem's and Krakatoa's way to the owner's WHOOP: `{ method, args }` run on
     * the one client (WHOOP_OWNER_METHODS), answered with the result. Its errors
     * keep their message and flags, because both show the fix it carries
     * ("reconnect WHOOP in Bushido"). Owner only, never acting.
     */
    if (p === '/api/whoop/owner' && req.method === 'POST') {
      if (!space.owner || ctx?.acting) return send(res, 403, { error: 'only the owner\'s WHOOP is served' })
      const body = await readBody(req).catch(() => null)
      const method = String(body?.method || '')
      if (!WHOOP_OWNER_METHODS.has(method)) return send(res, 400, { error: `unknown WHOOP method: ${method || '(none)'}` })
      if (!config.whoop().configured) return send(res, 409, { error: 'Bushido has no WHOOP app yet: add one in Bushido Settings → WHOOP.', needsReauth: true })
      const args = Array.isArray(body?.args) ? body.args : []
      try {
        const result = await whoopClientOf()[method](...args)
        if (method === 'status') result.connectWhere = 'profile → Settings → Connect WHOOP'
        return send(res, 200, { result: result ?? null }, { 'Cache-Control': 'no-store' })
      } catch (err) {
        const status = err.name === 'WhoopError' ? (err.rateLimited ? 429 : 502) : 500
        return send(res, status, {
          error: err.message || String(err), status: err.status ?? null,
          needsReauth: err.needsReauth || undefined, missingScope: err.missingScope || undefined, rateLimited: err.rateLimited || undefined,
        })
      }
    }

    /*
     * Who this is, for the app's boot (lib/whoami.js): whose log to cache, under
     * which key, and what to offer. `people` only for an admin, for the switcher.
     */
    if (p === '/api/auth/me' && req.method === 'GET') {
      return send(res, 200, {
        mode: auth.mode, via: who.via, user: who.user?.username || null,
        me: { id: ctx.user.id, name: ctx.user.name, owner: space.owner },
        real: { id: ctx.real.id, name: ctx.real.name, admin: ctx.real.admin },
        acting: ctx.acting,
        features,
        people: ctx.real.admin ? users.list().map(u => ({ id: u.id, name: u.name })) : undefined,
      }, { 'Cache-Control': 'no-store' })
    }

    /*
     * Act as someone (the owner marking a partner's sets for them), or stop.
     * A cookie, so every request after it, including a download or the Settings
     * page, is for that person; the app reloads into their log on the answer.
     */
    if (p === '/api/act-as' && req.method === 'POST') {
      const body = await readBody(req, 4 * 1024)
      const id = body?.id ? String(body.id) : null
      if (id && id !== ctx.real.id && !users.get(id)) return send(res, 404, { error: 'no such person' })
      const target = id && id !== ctx.real.id ? id : null
      return send(res, 200, { ok: true, acting: Boolean(target), id: target || ctx.real.id },
        { 'Set-Cookie': actAsCookie(target, { secure: isHttps(req) }), 'Cache-Control': 'no-store' })
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
        'Set-Cookie': [auth.cookieHeader(req, '', { clear: true }), actAsCookie(null, { secure: isHttps(req) })],
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
      return send(res, 200, await settingsView(who, ctx), { 'Cache-Control': 'no-store' })
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
      return send(res, 200, await settingsView(who, ctx), { 'Cache-Control': 'no-store' })
    }

    /*
     * The people on this install. Under /api/settings, so in proxy mode it is
     * loopback-only like every other settings write, and admin-only above. Taking
     * someone off the list stops them getting in; their folder stays on disk.
     */
    if (p === '/api/settings/users' && req.method === 'GET') {
      return send(res, 200, { users: users.list() }, { 'Cache-Control': 'no-store' })
    }
    if (p === '/api/settings/users' && (req.method === 'POST' || req.method === 'PUT')) {
      const body = await readBody(req, 16 * 1024)
      try {
        const user = req.method === 'POST'
          ? users.add({ name: body?.name, emails: body?.emails })
          : users.update(String(body?.id || ''), { name: body?.name, emails: body?.emails })
        return send(res, 200, { user, users: users.list() })
      } catch (err) { return send(res, 400, { error: err.message }) }
    }
    if (p.startsWith('/api/settings/users/') && req.method === 'DELETE') {
      try {
        users.remove(decodeURIComponent(p.slice('/api/settings/users/'.length)))
        return send(res, 200, { users: users.list() })
      } catch (err) { return send(res, 400, { error: err.message }) }
    }

    /*
     * Shared workouts: the owner reads and writes the copy of a workout that sits
     * in someone else's log, from the owner's own sheet, without acting as them.
     * See peopleRoute.
     */
    if (p === '/api/people' || p.startsWith('/api/people/')) return await peopleRoute(req, res, url, ctx)

    if (p === '/api/settings/ai/test' && req.method === 'POST') {
      try { return send(res, 200, await testAi()) } catch (err) { return send(res, 502, { error: err.message }) }
    }

    if ((p === '/api/plan/import' || p === '/api/plan/example' || p === '/api/plan/reset') && req.method === 'POST') {
      const pinned = space.planFile().source
      if (pinned.startsWith('env ')) return send(res, 409, { error: `the plan is pinned by ${pinned.slice(4)}` })
      if (p === '/api/plan/reset') {
        await backupOwnPlan(space)
        await fsp.unlink(path.join(space.dir, 'plan.json')).catch(() => {})
        if (space.owner) config.clearPlanFile()
        return send(res, 200, { ok: true, plan: space.planFile() })
      }
      let plan
      if (p === '/api/plan/example') {
        try { plan = JSON.parse(await fsp.readFile(EXAMPLE_PLAN, 'utf8')) } catch { return send(res, 404, { error: 'examples/plan.json is not in this checkout' }) }
      } else {
        plan = (await readBody(req))?.plan
      }
      const problem = checkPlan(plan)
      if (problem) return send(res, 400, { error: problem })
      await writeOwnPlan(space, plan)
      return send(res, 200, { ok: true, plan: space.planFile() })
    }

    // Notifications off: say so in the shape the client already reads.
    if (!notify && p === '/api/push/key' && req.method === 'GET') {
      return send(res, 200, { configured: false, publicKey: null, error: 'Notifications are off on this server. Set them up in Settings.' })
    }

    if (p === '/api/health') {
      const doc = readStateSync(space)
      const ai = config.ai()
      const t = config.totem()
      const links = config.links()
      return send(res, 200, {
        ok: true,
        version: doc.version,
        entries: Object.keys(doc.state.entries || {}).length,
        user: space.id,
        stateFile: space.stateFile,
        contentFile: space.planFile().file,
        auth: { mode: auth.mode, owner: auth.hasOwner(), access: config.access().enabled, people: users.list().length },
        distDir: DIST_DIR,
        ai: { model: ai.plannerModel, claude: ai.installed, brain: Boolean(links.brainFile && fs.existsSync(links.brainFile)) },
        totem: { enabled: t.enabled, url: t.url, habit: t.habit, secret: Boolean(t.secret()), lastSync: totemLast },
        notify: Boolean(notify),
        whoop: { file: WHOOP_FILE, present: fs.existsSync(WHOOP_FILE), linked: whoopLinked(), days: WHOOP_DAYS, last: whoopState },
        strava: { file: stravaFileOf(space), present: fs.existsSync(stravaFileOf(space)), linked: stravaLinked(space), days: STRAVA_DAYS, last: stravaStateOf(space) },
      })
    }

    /*
     * The Strava cache and its pull, shaped exactly like WHOOP's: the GET serves
     * disk and refreshes in the background; the POST waits, because it is one
     * HTTP call and "did my ride come through" deserves an answer.
     */
    if (p === '/api/strava' && req.method === 'GET') {
      if (!features.strava) {
        return send(res, 200, { fetchedAt: null, activities: [], gear: {}, athlete: null, configured: false, status: null }, { 'Cache-Control': 'no-cache' })
      }
      refreshStravaIfStale(space)
      const cache = readStravaCache(space)
      return send(res, 200, {
        ...(cache || { fetchedAt: null, activities: [], gear: {}, athlete: null }),
        configured: true,
        status: stravaStateOf(space),
      }, { 'Cache-Control': 'no-cache' })
    }

    if ((p === '/api/strava/pull' || p === '/api/strava/activity') && !features.strava) {
      return send(res, 409, { error: 'Strava is not connected for this account' })
    }
    if ((p === '/api/whoop/pull') && !features.whoop) {
      return send(res, 409, { error: 'WHOOP is not connected for this account' })
    }

    if (p === '/api/strava/pull' && req.method === 'POST') {
      const body = await readBody(req).catch(() => null)
      const days = Number(body?.days)
      const span = Number.isFinite(days) && days > 0 ? Math.min(Math.round(days), 120) : STRAVA_DAYS
      const result = await pullStrava(space, { days: span })
      const status = stravaStateOf(space)
      if (!result.ok) return send(res, 502, { error: result.error, status })
      const cache = readStravaCache(space)
      return send(res, 200, { ...(cache || {}), status })
    }

    // One activity in full, for the moment the user attaches it. Live; not cached here.
    if (p === '/api/strava/activity' && req.method === 'GET') {
      const id = url.searchParams.get('id')
      if (!id) return send(res, 400, { error: 'id is required' })
      const result = await fetchStravaDetail(space, id)
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
      if (!features.whoop) {
        return send(res, 200, { fetchedAt: null, workouts: [], recovery: [], sleep: [], maxHeartRate: null, configured: false, status: null }, { 'Cache-Control': 'no-cache' })
      }
      refreshWhoopIfStale()
      const cache = readWhoopCache()
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
        const raw = await fsp.readFile(space.planFile().file, 'utf8')
        return send(res, 200, raw, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache' })
      } catch {
        return send(res, 404, { error: 'plan.json not present yet' })
      }
    }

    /*
     * About you, for anyone but the owner: their name and notes for their own AI
     * runs, kept in their own space. Acting as someone, it is theirs. The owner's
     * is on the Settings page (and stays loopback-only in proxy mode there).
     */
    if (p === '/api/about' && req.method === 'GET') {
      return send(res, 200, aboutView(space), { 'Cache-Control': 'no-store' })
    }
    if (p === '/api/about' && req.method === 'PUT') {
      if (space.owner) return send(res, 409, { error: 'your About you is on the Settings page', code: 'settings' })
      const body = await readBody(req, 32 * 1024)
      return send(res, 200, writeAbout(space, body), { 'Cache-Control': 'no-store' })
    }

    /*
     * AI is everyone's when a CLI is configured and runs (featuresFor), and every
     * run is built from ONE person's space (aiRun): their log, About you and plan,
     * and for anyone but the owner none of the owner's sources. Without one the
     * answer is `ai-not-configured` for everyone (the owner is told where to set it
     * up), and no app offers it.
     */
    const aiRoute = p === '/api/plan/workout' || p === '/api/plan/revise'
      || p === '/api/plan/drafts' || p.startsWith('/api/plan/drafts/')
    if (aiRoute && !features.ai) {
      if (p === '/api/plan/drafts' && req.method === 'GET') return send(res, 200, { drafts: [] }, { 'Cache-Control': 'no-cache' })
      return send(res, 503, { error: space.owner ? AI_MISSING : 'The workout planner is not available on this account yet.', code: 'ai-not-configured' })
    }

    /*
     * Plan me a workout.
     *
     * Slow — it is a model run that reads their log first — and it returns the
     * prescription rather than storing it. Nothing lands in the log until the user taps
     * "keep it": the app only ever writes because the user said so.
     *
     * NOT serialised. This agent writes nothing, so two of them at once is two
     * reads.
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
      // `for`: the owner planning for someone else, on THEIR log, plan and About you.
      const target = aiSpaceFor(body, ctx, space)
      if (target.refused) return send(res, ...target.refused)
      const { ai, common } = aiRun(target.space)
      if (!ai.installed) return send(res, 503, { error: AI_MISSING, code: 'ai-not-configured' })

      try {
        const plan = planner.readPlanJson(target.space.planFile().file) || {}
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
      const target = aiSpaceFor(body, ctx, space)
      if (target.refused) return send(res, ...target.refused)
      const { ai, common } = aiRun(target.space)
      if (!ai.installed) return send(res, 503, { error: AI_MISSING, code: 'ai-not-configured' })

      try {
        const plan = planner.readPlanJson(target.space.planFile().file) || {}
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
     * AI workout drafts (server/drafts.js, docs/DESIGN.md D3).
     *
     * "Write it for me" is a draft in the REQUESTER's own space (`drafts/` beside
     * their log, never in it), and the model run belongs to the draft: the server
     * writes its result or its error onto the file when it ends, so leaving the
     * page, locking the phone or opening another device loses nothing. A draft
     * for someone else (`for`) is still the owner's draft; its runs are built on
     * that person's space, exactly as /api/plan/workout's are. Nothing here
     * writes the log: keeping a draft is the app's own placement, on a tap, and
     * the app discards the draft afterwards.
     */
    if (p === '/api/plan/drafts' || p.startsWith('/api/plan/drafts/')) {
      const dir = draftsDir(space)
      const rest = p.slice('/api/plan/drafts'.length).split('/').filter(Boolean)
      const [id, action] = rest
      if (rest.length > 2) return send(res, 404, { error: 'not found' })
      /*
       * The drafts this space has already kept: ids stamped on entries in its own
       * log and, for a draft planned for someone, in theirs. Read per request (a
       * keep made offline arrives with the log's next sync, not here).
       */
      const keptIds = new Map()
      const isKept = (draftId) => {
        const d = drafts.read(dir, draftId)
        const owners = [space, ...(d?.for?.id && users.get(d.for.id) ? [spaceFor(users.get(d.for.id))] : [])]
        return owners.some(sp => {
          if (!keptIds.has(sp.stateFile)) {
            let ids = new Set()
            try { ids = keptIdsIn(readStateSync(sp).state) } catch { /* unreadable: nothing is known kept */ }
            keptIds.set(sp.stateFile, ids)
          }
          return keptIds.get(sp.stateFile).has(draftId)
        })
      }
      // Whose context a draft's runs are built on: its `for`, resolved now, for this request.
      const targetOf = (draft) => aiSpaceFor({ for: draft?.for?.id || null }, ctx, space)
      const runner = (target) => ({ kind, draft, message, signal }) => {
        const { ai, common } = aiRun(target)
        if (!ai.installed) throw new Error(AI_MISSING)
        const plan = planner.readPlanJson(target.planFile().file) || {}
        const { thread = [], ...current } = draft.pres || {}
        return planner.planWorkout({
          ...common, model: ai.plannerModel, effort: PLANNER_EFFORT,
          timeoutMs: PLANNER_TIMEOUT_MS, plan, signal,
          ...(kind === 'revise'
            // The thread as it was before this message, which is the run's own `message`.
            ? { revise: { plan: current, message, thread: thread.slice(0, -1).slice(-8) } }
            : { kinds: draft.ask.kinds, minutes: draft.ask.minutes, goal: draft.ask.goal, context: draft.context }),
        })
      }
      const answer = (fn) => {
        try { return send(res, 200, { draft: fn() }) } catch (err) {
          if (err.status) return send(res, err.status, { error: err.message, ...(err.code ? { code: err.code } : {}) })
          throw err
        }
      }
      const ready = (target) => {
        if (target.refused) return target.refused
        if (!aiRun(target.space).ai.installed) return [503, { error: AI_MISSING, code: 'ai-not-configured' }]
        return null
      }

      if (!id && req.method === 'GET') {
        return send(res, 200, { drafts: drafts.list(dir, { isKept }) }, { 'Cache-Control': 'no-cache' })
      }
      if (!id && req.method === 'POST') {
        const body = await readBody(req, 64 * 1024)
        const target = aiSpaceFor(body, ctx, space)
        const refused = ready(target)
        if (refused) return send(res, ...refused)
        const forWho = target.space === space ? null : { id: target.space.id, name: aboutFor(target.space).name }
        return answer(() => drafts.create(dir, { ...body, for: forWho }, runner(target.space), { isKept }))
      }

      const draft = drafts.read(dir, id)
      // Gone is how a second device learns the draft was kept (or thrown away) on another.
      if (!draft) return send(res, 404, { error: 'This draft is gone: it was kept or thrown away on another device.', code: 'kept' })
      if (!action && req.method === 'GET') return send(res, 200, { draft }, { 'Cache-Control': 'no-cache' })
      if (!action && req.method === 'DELETE') return send(res, 200, { ok: drafts.discard(dir, id) })
      if (!action && req.method === 'PUT') {
        const body = await readBody(req, 256 * 1024)
        return answer(() => drafts.save(dir, id, body?.pres))
      }
      // Claimed before the app places it, so a draft is kept once; `release` gives it back.
      if (action === 'keep' && req.method === 'POST') {
        const body = await readBody(req, 4 * 1024)
        return answer(() => drafts.keep(dir, id, { isKept, release: body?.release === true }))
      }
      if ((action === 'revise' || action === 'retry') && req.method === 'POST') {
        const body = await readBody(req, 256 * 1024)
        const target = targetOf(draft)
        const refused = ready(target)
        if (refused) return send(res, ...refused)
        return answer(() => action === 'revise'
          ? drafts.revise(dir, id, body, runner(target.space))
          : drafts.retry(dir, id, runner(target.space)))
      }
      return send(res, 405, { error: 'method not allowed' })
    }

    if (p === '/api/state' && req.method === 'GET') {
      return send(res, 200, readStateSync(space), { 'Cache-Control': 'no-cache' })
    }

    if (p === '/api/state' && req.method === 'PUT') {
      const body = await readBody(req)
      if (!body || typeof body.state !== 'object' || body.state === null) {
        return send(res, 400, { error: 'expected { state: {...} }' })
      }
      // `commit` hands the mutator the state as it was on disk, under the write
      // lock. That snapshot is what makes a full-log push quiet.
      const { doc, before } = await commitSynced(space, Object.keys(body.state.entries || {}), base => mergeState(base, body.state))
      // The habit and the "nice session" push are the owner's, about the owner's log.
      if (space.owner) syncDailyEntries(body.state, doc.state, before)
      return send(res, 200, doc)
    }

    if (p === '/api/entry' && req.method === 'POST') {
      const body = await readBody(req)
      const entry = body && body.entry
      if (!entry || !entry.id) return send(res, 400, { error: 'expected { entry: { id, ... } }' })
      const stamped = { ...entry, updatedAt: entry.updatedAt || new Date().toISOString() }
      const { doc, before } = await commitSynced(space, [entry.id], base => mergeState(base, { entries: { [entry.id]: stamped } }))
      if (space.owner) syncDailyEntries({ entries: { [entry.id]: stamped } }, doc.state, before)
      return send(res, 200, doc)
    }

    if (p === '/api/export' && req.method === 'GET') {
      const doc = readStateSync(space)
      const name = `bushido-${space.owner ? '' : `${space.id}-`}${doc.updatedAt.slice(0, 10)}-v${doc.version}.json`
      return send(res, 200, JSON.stringify(doc, null, 2), {
        'Content-Type': MIME['.json'],
        'Content-Disposition': `attachment; filename="${name}"`,
      })
    }

    if (p === '/api/import' && req.method === 'POST') {
      const body = await readBody(req)
      const incoming = body && (body.state || (body.doc && body.doc.state))
      if (!incoming) return send(res, 400, { error: 'expected { state } or { doc: { state } }' })
      const doc = await commit(space, () => mergeState(structuredClone(EMPTY_STATE), incoming))
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
  if (!fs.existsSync(OWNER_SPACE.stateFile)) {
    fs.writeFileSync(
      OWNER_SPACE.stateFile,
      JSON.stringify({ version: 0, updatedAt: new Date(0).toISOString(), state: EMPTY_STATE }, null, 2),
    )
    console.log('[bushido] initialised', OWNER_SPACE.stateFile)
  }

  // One tick for the notification queue, matching Totem's 30 seconds so a
  // reminder is never more than half a minute late. Only when a notify core is
  // configured: a fresh install runs no timers at all.
  startNotify().then((n) => {
    if (n) setInterval(() => { notifyTick().catch(() => {}) }, 30_000)
  })

  server.listen(PORT, BIND, () => {
    console.log(`[bushido] listening on http://${BIND}:${PORT}`)
    console.log(`[bushido] data  ${OWNER_SPACE.stateFile}`)
    if (config.access().enabled) console.log(`[bushido] people ${users.list().length} (Cloudflare Access identifies them)`)
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
