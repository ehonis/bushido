/*
 * Server settings: what the owner configures in the browser, with env overrides.
 *
 * One file, `data/settings.json`, mode 0600. Every value resolves in the same
 * order — an environment variable wins, then the settings file, then a default —
 * and every resolved value carries where it came from, so the Settings page can
 * say "set by BUSHIDO_TOTEM_URL" rather than show a field that silently does
 * nothing when edited.
 *
 * FRESH VERSUS EXISTING. A fresh install is a blank canvas: no AI unless a CLI is
 * found, no sibling apps, no notifications, the starter content. This server
 * also ran for a long time before settings or sign-in existed. So the first time
 * this code starts, it looks for a training log that already exists. If there is
 * one, the install is an EXISTING one: it keeps working without a login, and its
 * old tracked plan is carried into the data dir. Everything else starts as on a
 * fresh install. Either way the file is written once, a settings.json that is
 * already there is never touched, and from then on it is the only answer.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const DEFAULT_MODEL = 'claude-sonnet-5'

/*
 * An install that predates settings is migrated with exactly two changes from a
 * fresh one: sign-in stays off (it never had one), and its plan is carried into
 * the data dir. Everything else (a bridge, sibling apps, a timezone, who the
 * athlete is) starts off or blank, and is set on the Settings page.
 */
const LEGACY = { auth: { mode: 'proxy' } }

const blank = () => ({
  version: 1,
  install: 'fresh',
  createdAt: new Date().toISOString(),
  /* '' = built-in sign-in. 'proxy' = trust whatever is in front of the port. */
  auth: { mode: '' },
  athlete: { name: '', notes: '' },
  ai: { provider: 'claude-cli', bin: '', apiKey: '', model: '' },
  plan: { file: '' },
  totem: { url: '', secret: '', envFile: '', habit: '', habitSync: true, whoop: true, strava: true, goals: true },
  links: { notifyCore: '', brainFile: '', krakatoaDir: '' },
  notifications: { tz: '' },
})

/*
 * Settings that name a file or a program the server will read or run. A browser
 * that could set these could point the AI's write access at the home directory,
 * or the CLI at any binary. They come from the environment or from a hand-edited
 * data/settings.json, and the Settings page shows them read-only. plan.file is
 * not in update() at all: importing a plan is how a browser changes the plan.
 */
const FILE_ONLY = [['ai', 'bin'], ['totem', 'envFile'], ['links', 'notifyCore'], ['links', 'brainFile'], ['links', 'krakatoaDir']]

/* Settings keys that hold secrets: never sent to a browser, shown masked. */
const SECRET_KEYS = [['ai', 'apiKey'], ['totem', 'secret']]

function writePrivate(file, doc) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, file)
  try { fs.chmodSync(file, 0o600) } catch { /* not ours to fix on odd filesystems */ }
}

function onPath(name, PATH = process.env.PATH) {
  for (const dir of String(PATH || '').split(path.delimiter)) {
    if (!dir) continue
    const f = path.join(dir, name)
    try { fs.accessSync(f, fs.constants.X_OK); return f } catch { /* keep looking */ }
  }
  return null
}

/**
 * @param {object} o
 * @param {string} o.root     the repo root
 * @param {string} o.dataDir  where state.json and settings.json live
 * @param {object} [o.env]    process.env, injectable for tests
 */
function createConfig({ root, dataDir, env = process.env }) {
  const file = path.join(dataDir, 'settings.json')
  const stateFile = path.join(dataDir, 'state.json')
  let doc = null

  const abs = (p) => (p ? (path.isAbsolute(p) ? p : path.resolve(root, p)) : null)
  const has = (k) => typeof env[k] === 'string' && env[k] !== ''

  function migrate() {
    if (fs.existsSync(file)) return { created: false, install: read().install }
    // An existing install is a training log with no settings file AND no owner
    // account. A data dir with auth.json has already had sign-in set up, and must
    // never be switched to proxy (no login) by a migration.
    const existing = fs.existsSync(stateFile) && !fs.existsSync(path.join(dataDir, 'auth.json'))
    const next = blank()
    if (existing) {
      next.install = 'migrated'
      // It ran with no login, behind Cloudflare Access and the tailnet. Keep it
      // that way: an upgrade must not lock the owner out of their own log.
      next.auth = { ...LEGACY.auth }
      // The plan used to be the tracked content/plan.json; it now lives in the
      // data dir (data/plan.json, untracked), which planFile() prefers. The pull
      // that brings this code also DELETES content/plan.json, so by the time this
      // runs it is usually gone and the owner has to restore it from git (see
      // deploy/README.md). This copy only helps the rare checkout that still has
      // the file, e.g. one updated without git.
      const own = path.join(dataDir, 'plan.json')
      const old = path.join(root, 'content', 'plan.json')
      if (!fs.existsSync(own) && fs.existsSync(old)) fs.copyFileSync(old, own)
      next.plan.file = ''
    }
    writePrivate(file, next)
    doc = next
    return { created: true, install: next.install }
  }

  function read() {
    if (doc) return doc
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
      const b = blank()
      doc = {
        ...b, ...raw,
        auth: { ...b.auth, ...(raw.auth || {}) },
        athlete: { ...b.athlete, ...(raw.athlete || {}) },
        ai: { ...b.ai, ...(raw.ai || {}) },
        plan: { ...b.plan, ...(raw.plan || {}) },
        totem: { ...b.totem, ...(raw.totem || {}) },
        links: { ...b.links, ...(raw.links || {}) },
        notifications: { ...b.notifications, ...(raw.notifications || {}) },
      }
    } catch {
      doc = blank()
    }
    return doc
  }

  /**
   * Apply a patch from the Settings page. Only known sections and keys are kept.
   * A secret sent as `undefined` or the mask is left alone; an empty string clears it.
   */
  function update(patch) {
    const cur = read()
    const next = structuredClone(cur)
    for (const section of ['athlete', 'ai', 'totem', 'links', 'notifications']) {
      const p = patch?.[section]
      if (!p || typeof p !== 'object') continue
      for (const [k, v] of Object.entries(p)) {
        if (!(k in next[section])) continue
        // Paths and programs are never set from a browser: env or a hand-edited
        // settings.json only. Silently dropped, so an old page cannot error.
        if (FILE_ONLY.some(([sec, key]) => sec === section && key === k)) continue
        const isSecret = SECRET_KEYS.some(([s, key]) => s === section && key === k)
        if (isSecret && (v === undefined || v === null || (typeof v === 'string' && v.startsWith('•')))) continue
        const want = typeof next[section][k]
        if (want === 'boolean') next[section][k] = Boolean(v)
        else next[section][k] = String(v ?? '').trim().slice(0, k === 'notes' ? 4000 : 1000)
      }
    }
    next.updatedAt = new Date().toISOString()
    writePrivate(file, next)
    doc = next
    return next
  }

  /*
   * Server-side only: forget a plan file named in settings.json. Used when the
   * owner imports a plan or goes back to the starter. Not reachable through
   * update(), which never touches the plan section.
   */
  function clearPlanFile() {
    const cur = read()
    if (!cur.plan?.file) return cur
    const next = { ...structuredClone(cur), plan: { ...cur.plan, file: '' }, updatedAt: new Date().toISOString() }
    writePrivate(file, next)
    doc = next
    return next
  }

  const src = (envKey, settingsVal, fallback, fallbackSource = 'default') => {
    if (envKey && has(envKey)) return { value: env[envKey], source: `env ${envKey}` }
    if (settingsVal !== undefined && settingsVal !== null && settingsVal !== '') return { value: settingsVal, source: 'settings' }
    return { value: fallback, source: fallback == null ? 'off' : fallbackSource }
  }

  /* ---------------------------------------------------------------- AI */

  function aiBin() {
    const s = read().ai
    if (has('CLAUDE_BIN')) return { value: env.CLAUDE_BIN, source: 'env CLAUDE_BIN' }
    if (s.bin) return { value: abs(s.bin), source: 'settings' }
    const home = path.join(env.HOME || os.homedir(), '.local', 'bin', 'claude')
    if (fs.existsSync(home)) return { value: home, source: 'detected' }
    const found = onPath('claude', env.PATH)
    if (found) return { value: found, source: 'detected on PATH' }
    return { value: null, source: 'not found' }
  }

  function ai() {
    const s = read().ai
    const bin = aiBin()
    const key = src('ANTHROPIC_API_KEY', s.apiKey, null)
    const model = (envKey) => src(envKey, s.model, DEFAULT_MODEL).value
    const installed = Boolean(bin.value && fs.existsSync(bin.value))
    return {
      provider: 'claude-cli',
      bin: bin.value,
      binSource: bin.source,
      installed,
      apiKeySet: Boolean(key.value),
      apiKeySource: key.source,
      model: src(null, s.model, DEFAULT_MODEL),
      coachModel: model('BUSHIDO_COACH_MODEL'),
      plannerModel: model('BUSHIDO_PLANNER_MODEL'),
      chatModel: model('BUSHIDO_CHAT_MODEL'),
      /* The environment a CLI run gets: the server's own, plus a stored key. */
      spawnEnv() {
        if (key.source === 'settings') return { ...process.env, ...env, ANTHROPIC_API_KEY: key.value }
        return { ...process.env, ...env }
      },
    }
  }

  /* ------------------------------------------------------------- totem */

  function totem() {
    const s = read().totem
    const url = src('BUSHIDO_TOTEM_URL', s.url, null)
    const habit = src('BUSHIDO_TOTEM_HABIT', s.habit, 'move-every-day')
    const envFile = src('BUSHIDO_TOTEM_ENV', s.envFile, null)
    const enabled = Boolean(url.value)
    function secret() {
      if (has('BRIDGE_SECRET')) return env.BRIDGE_SECRET
      if (s.secret) return s.secret
      const f = abs(envFile.value)
      if (!f) return ''
      try {
        const line = fs.readFileSync(f, 'utf8').split('\n').find(l => l.startsWith('BRIDGE_SECRET='))
        return line ? line.slice('BRIDGE_SECRET='.length).trim().replace(/^["']|["']$/g, '') : ''
      } catch {
        return ''
      }
    }
    const secretSource = has('BRIDGE_SECRET') ? 'env BRIDGE_SECRET'
      : s.secret ? 'settings'
        : envFile.value ? `read from ${envFile.value}` : 'off'
    return {
      enabled,
      url: url.value ? String(url.value).replace(/\/+$/, '') : null,
      urlSource: url.source,
      habit: habit.value,
      envFile: envFile.value,
      secret,
      secretSource,
      habitSync: enabled && s.habitSync !== false,
      whoop: enabled && s.whoop !== false,
      strava: enabled && s.strava !== false,
      goals: enabled && s.goals !== false,
    }
  }

  /* ------------------------------------------------------------- links */

  function links() {
    const s = read().links
    const notifyCore = src('BUSHIDO_NOTIFY_CORE', s.notifyCore, null)
    const brainFile = src('BUSHIDO_BRAIN_FILE', s.brainFile, null)
    const krakatoaDir = src('BUSHIDO_KRAKATOA_DIR', s.krakatoaDir, null)
    return {
      notifyCore: abs(notifyCore.value), notifyCoreSource: notifyCore.source,
      brainFile: abs(brainFile.value), brainFileSource: brainFile.source,
      krakatoaDir: abs(krakatoaDir.value), krakatoaDirSource: krakatoaDir.source,
    }
  }

  function tz() {
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    return src('BUSHIDO_TZ', read().notifications.tz, local, 'server timezone').value
  }

  /* -------------------------------------------------------------- plan */

  /**
   * Which content file the app runs on, and why.
   *
   * The environment wins; then the owner's own plan in the data dir
   * (data/plan.json: imported in Settings, or carried over from an older
   * install); then a file named in settings.json; then the starter.
   */
  function planFile() {
    if (has('BUSHIDO_PLAN_FILE')) return { file: abs(env.BUSHIDO_PLAN_FILE), source: 'env BUSHIDO_PLAN_FILE' }
    if (has('BUSHIDO_CONTENT_DIR')) {
      return { file: path.join(abs(env.BUSHIDO_CONTENT_DIR), 'plan.json'), source: 'env BUSHIDO_CONTENT_DIR' }
    }
    const own = path.join(dataDir, 'plan.json')
    if (fs.existsSync(own)) return { file: own, source: 'imported' }
    const s = read().plan
    if (s.file) return { file: abs(s.file), source: 'settings' }
    return { file: path.join(root, 'content', 'starter.json'), source: 'starter' }
  }

  /*
   * The sign-in mode: BUSHIDO_AUTH, then the settings file, then built-in sign-in.
   * Deliberately NOT editable through update(): turning sign-in off is a decision
   * for whoever controls the server's files or environment, not for a browser.
   */
  function authMode() {
    const v = src('BUSHIDO_AUTH', read().auth.mode, 'password', 'default')
    return { value: String(v.value).toLowerCase() === 'proxy' ? 'proxy' : 'password', source: v.source }
  }

  function athlete() {
    const a = read().athlete
    return { name: String(a.name || '').trim(), notes: String(a.notes || '').trim() }
  }

  /** The settings as the browser may see them: secrets masked, never echoed. */
  function publicView() {
    const out = structuredClone(read())
    for (const [s, k] of SECRET_KEYS) {
      const v = out[s]?.[k]
      out[s][k] = v ? `••••${String(v).slice(-4)}` : ''
    }
    return out
  }

  return { file, migrate, read, update, clearPlanFile, ai, totem, links, tz, planFile, athlete, authMode, publicView, root, dataDir }
}

module.exports = { createConfig, LEGACY, DEFAULT_MODEL, FILE_ONLY }
