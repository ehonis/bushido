/*
 * Settings: a fresh install is a blank canvas, an existing one keeps every old
 * default, env always wins, and secrets never reach the browser.
 * Run: node server/config.test.js
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createConfig } = require('./config.js')

let failed = 0
const check = (name, fn) => {
  try { fn(); console.log('  ok   ', name) } catch (e) { failed++; console.log('  FAIL ', name, '\n         ', e.message) }
}
const ok = (v, m) => { if (!v) throw new Error(m || 'expected truthy') }
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }

const ROOT = path.resolve(__dirname, '..')
const made = []
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bushido-config-')); made.push(d); return d }
process.on('exit', () => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }) })
/* An environment with nothing Bushido-specific in it, and no claude to find. */
const bareEnv = (extra = {}) => ({ HOME: tmp(), PATH: '', ...extra })

check('a fresh install: every optional link is off', () => {
  const c = createConfig({ root: ROOT, dataDir: tmp(), env: bareEnv() })
  eq(c.migrate().install, 'fresh')
  const t = c.totem()
  ok(!t.enabled && !t.whoop && !t.strava && !t.goals && !t.habitSync, 'a Totem feature is on by default')
  ok(t.secret() === '', 'a fresh install found a bridge secret')
  const l = c.links()
  eq([l.notifyCore, l.brainFile, l.krakatoaDir], [null, null, null], 'a sibling path is set by default')
  ok(!c.ai().installed, 'AI claims to be set up with no CLI anywhere')
  eq(c.planFile().source, 'starter')
  ok(c.planFile().file.endsWith(path.join('content', 'starter.json')))
  eq(c.athlete(), { name: '', notes: '' }, 'a fresh install knows who its owner is')
  eq(c.authMode(), { value: 'password', source: 'default' }, 'a fresh install must require sign-in')
})

check('an existing install keeps its login-free access and otherwise starts like a fresh one', () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ version: 412, state: { entries: {} } }))
  const c = createConfig({ root: ROOT, dataDir: dir, env: bareEnv() })
  eq(c.migrate().install, 'migrated')
  ok(!c.totem().enabled, 'the migration switched a bridge on from code')
  const l = c.links()
  eq([l.notifyCore, l.brainFile, l.krakatoaDir], [null, null, null], 'the migration set a sibling path from code')
  eq(c.read().plan.file, '', 'the migration points at a file in the repo instead of the data dir')
  eq(c.read().notifications.tz, '', 'the migration set a timezone from code')
  eq(c.athlete(), { name: '', notes: '' }, 'personal facts are seeded from code')
  eq(c.read().auth.mode, 'proxy', 'the migration did not write proxy auth into settings.json')
  eq(c.authMode(), { value: 'proxy', source: 'settings' }, 'an upgraded install would start asking for a login')
})

check('a data dir with an owner account is never migrated to proxy', () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, 'state.json'), '{}')
  fs.writeFileSync(path.join(dir, 'auth.json'), '{"owner":{"username":"me","hash":"x"}}')
  const c = createConfig({ root: ROOT, dataDir: dir, env: bareEnv() })
  eq(c.migrate().install, 'fresh')
  eq(c.authMode(), { value: 'password', source: 'default' }, 'sign-in was switched off for an install that has an owner')
})

check('BUSHIDO_AUTH beats the auth mode in settings.json, either way', () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, 'state.json'), '{}')
  const c = createConfig({ root: ROOT, dataDir: dir, env: bareEnv({ BUSHIDO_AUTH: 'password' }) })
  c.migrate()
  eq(c.authMode(), { value: 'password', source: 'env BUSHIDO_AUTH' })
  const fresh = createConfig({ root: ROOT, dataDir: tmp(), env: bareEnv({ BUSHIDO_AUTH: 'proxy' }) })
  fresh.migrate()
  eq(fresh.authMode().value, 'proxy')
})

check('the browser cannot switch sign-in off', () => {
  const c = createConfig({ root: ROOT, dataDir: tmp(), env: bareEnv() })
  c.migrate()
  c.update({ auth: { mode: 'proxy' } })
  eq(c.authMode().value, 'password', 'a settings PUT turned sign-in off')
})

check('an existing install keeps its plan: the old content/plan.json is copied into the data dir', () => {
  const root = tmp()
  fs.mkdirSync(path.join(root, 'content'))
  fs.writeFileSync(path.join(root, 'content', 'plan.json'), '{"dailyMenu":[],"mine":true}')
  const dir = tmp()
  fs.writeFileSync(path.join(dir, 'state.json'), '{}')
  const c = createConfig({ root, dataDir: dir, env: bareEnv() })
  c.migrate()
  eq(c.planFile(), { file: path.join(dir, 'plan.json'), source: 'imported' })
  eq(JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf8')).mine, true)
  // ...and the pull that deletes content/plan.json changes nothing.
  fs.unlinkSync(path.join(root, 'content', 'plan.json'))
  eq(c.planFile().file, path.join(dir, 'plan.json'))
})

check('an existing data/plan.json is never overwritten by the migration', () => {
  const root = tmp()
  fs.mkdirSync(path.join(root, 'content'))
  fs.writeFileSync(path.join(root, 'content', 'plan.json'), '{"dailyMenu":[],"from":"repo"}')
  const dir = tmp()
  fs.writeFileSync(path.join(dir, 'state.json'), '{}')
  fs.writeFileSync(path.join(dir, 'plan.json'), '{"dailyMenu":[],"from":"data"}')
  createConfig({ root, dataDir: dir, env: bareEnv() }).migrate()
  eq(JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf8')).from, 'data')
})

check('data/plan.json beats a file named in settings; the environment beats both', () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ plan: { file: 'examples/plan.json' } }))
  const c = createConfig({ root: ROOT, dataDir: dir, env: bareEnv() })
  c.migrate()
  eq(c.planFile().source, 'settings')
  fs.writeFileSync(path.join(dir, 'plan.json'), '{"dailyMenu":[]}')
  eq(c.planFile().source, 'imported')
  const pinned = createConfig({ root: ROOT, dataDir: dir, env: bareEnv({ BUSHIDO_PLAN_FILE: '/x.json' }) })
  eq(pinned.planFile().source, 'env BUSHIDO_PLAN_FILE')
})

check('clearPlanFile forgets a plan file named in settings.json; update() cannot', () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ plan: { file: 'examples/plan.json' } }))
  const c = createConfig({ root: ROOT, dataDir: dir, env: bareEnv() })
  c.update({ plan: { file: '' } })
  eq(c.planFile().source, 'settings', 'a browser patch cleared plan.file')
  c.clearPlanFile()
  eq(c.planFile().source, 'starter')
  eq(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).plan.file, '', 'the setting is still on disk')
})

check('a settings.json written by hand before the first start is kept, not migrated', () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, 'state.json'), '{}')
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
    version: 1, install: 'migrated', auth: { mode: 'proxy' },
    athlete: { name: 'Sam', notes: 'n' }, notifications: { tz: 'Europe/Oslo' },
    totem: { url: 'http://bridge:1', envFile: '/b/.env' }, links: { notifyCore: '/n' },
  }))
  const c = createConfig({ root: ROOT, dataDir: dir, env: bareEnv() })
  eq(c.migrate(), { created: false, install: 'migrated' })
  eq(c.authMode().value, 'proxy')
  eq([c.athlete().name, c.tz(), c.totem().url, c.links().notifyCore], ['Sam', 'Europe/Oslo', 'http://bridge:1', '/n'])
  ok(c.totem().whoop, 'a partial file loses its defaults')
})

check('the migration runs once: later edits are not overwritten', () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, 'state.json'), '{}')
  const c = createConfig({ root: ROOT, dataDir: dir, env: bareEnv() })
  c.migrate()
  c.update({ totem: { url: 'http://set-later' } })
  const again = createConfig({ root: ROOT, dataDir: dir, env: bareEnv() })
  eq(again.migrate().created, false)
  eq(again.totem().url, 'http://set-later', 'a restart re-applied the migration')
})

check('settings.json is private', () => {
  const dir = tmp()
  const c = createConfig({ root: ROOT, dataDir: dir, env: bareEnv() })
  c.migrate()
  c.update({ ai: { apiKey: 'sk-ant-secret-1234' } })
  eq(fs.statSync(path.join(dir, 'settings.json')).mode & 0o777, 0o600)
})

check('environment variables win over settings', () => {
  const dir = tmp()
  const env = bareEnv({
    BUSHIDO_TOTEM_URL: 'http://bridge:1/', BRIDGE_SECRET: 'from-env', BUSHIDO_NOTIFY_CORE: '/n',
    CLAUDE_BIN: process.execPath, ANTHROPIC_API_KEY: 'env-key', BUSHIDO_COACH_MODEL: 'm-env',
    BUSHIDO_PLAN_FILE: '/p.json', BUSHIDO_TZ: 'Europe/Oslo',
  })
  const c = createConfig({ root: ROOT, dataDir: dir, env })
  c.migrate()
  c.update({ totem: { url: 'http://settings', secret: 'from-settings' }, ai: { apiKey: 'set-key', model: 'm-set' } })
  const t = c.totem()
  eq(t.url, 'http://bridge:1')
  eq(t.urlSource, 'env BUSHIDO_TOTEM_URL')
  eq(t.secret(), 'from-env')
  eq(c.links().notifyCore, '/n')
  const ai = c.ai()
  eq(ai.bin, process.execPath)
  ok(ai.installed)
  eq(ai.coachModel, 'm-env')
  eq(ai.plannerModel, 'm-set', 'the settings model is not the fallback for other features')
  eq(ai.spawnEnv().ANTHROPIC_API_KEY, 'env-key', 'a stored key overrode the env one')
  eq(c.planFile(), { file: '/p.json', source: 'env BUSHIDO_PLAN_FILE' })
  eq(c.tz(), 'Europe/Oslo')
})

check('a key saved in Settings reaches the CLI, and never the browser', () => {
  const c = createConfig({ root: ROOT, dataDir: tmp(), env: bareEnv({ CLAUDE_BIN: process.execPath }) })
  c.migrate()
  c.update({ ai: { apiKey: 'sk-ant-secret-1234' }, totem: { secret: 'bridge-secret-abcd' } })
  eq(c.ai().spawnEnv().ANTHROPIC_API_KEY, 'sk-ant-secret-1234')
  const view = JSON.stringify(c.publicView())
  ok(!view.includes('sk-ant-secret') && !view.includes('bridge-secret'), 'a secret is in the public view')
  ok(view.includes('1234') && view.includes('•'), 'the mask does not show the last four')
})

check('saving the masked value keeps the secret; an empty one clears it', () => {
  const c = createConfig({ root: ROOT, dataDir: tmp(), env: bareEnv() })
  c.migrate()
  c.update({ totem: { secret: 'keep-me-please-12345' } })
  c.update({ totem: { secret: c.publicView().totem.secret, url: 'http://b' } })
  eq(c.totem().secret(), 'keep-me-please-12345', 'the mask overwrote the secret')
  c.update({ totem: { secret: '' } })
  eq(c.totem().secret(), '')
})

check('a browser patch cannot set a file, a directory or a program', () => {
  const dir = tmp()
  const c = createConfig({ root: ROOT, dataDir: dir, env: bareEnv() })
  c.migrate()
  c.update({
    ai: { bin: '/bin/sh', model: 'm' }, plan: { file: '/etc/passwd' },
    totem: { envFile: '/root/.env', url: 'http://b' },
    links: { brainFile: '/home/x/.bashrc', krakatoaDir: '/', notifyCore: '/tmp/evil' },
  })
  const r = c.read()
  eq([r.ai.bin, r.plan.file, r.totem.envFile, r.links.brainFile, r.links.krakatoaDir, r.links.notifyCore],
    ['', '', '', '', '', ''], 'a path-like setting was written from a patch')
  eq([r.ai.model, r.totem.url], ['m', 'http://b'], 'ordinary settings in the same patch were lost')
})

check('unknown keys and sections are ignored', () => {
  const c = createConfig({ root: ROOT, dataDir: tmp(), env: bareEnv() })
  c.migrate()
  c.update({ evil: { x: 1 }, ai: { shell: 'rm -rf /' } })
  ok(!('evil' in c.read()) && !('shell' in c.read().ai))
})

check('an imported plan in the data dir beats the starter', () => {
  const dir = tmp()
  const c = createConfig({ root: ROOT, dataDir: dir, env: bareEnv() })
  c.migrate()
  fs.writeFileSync(path.join(dir, 'plan.json'), '{"dailyMenu":[]}')
  eq(c.planFile(), { file: path.join(dir, 'plan.json'), source: 'imported' })
})

check('the starter ships no personal content', () => {
  const s = fs.readFileSync(path.join(ROOT, 'content', 'starter.json'), 'utf8')
  ok(!/Ethan/.test(s), 'the starter names the original user')
  ok(!('facility' in JSON.parse(s)), 'the starter describes a real gym')
  const ex = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'plan.json'), 'utf8'))
  ok(ex.achievements.every(a => a.id.startsWith('example-')), 'the example plan is not the invented one')
  const plan = JSON.parse(s)
  eq(plan.achievements, [], 'the starter seeds achievements')
  ok(plan.dailyMenu.some(m => m.id === 'log-workout'), 'the starter cannot log a workout')
})

if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
console.log('\nconfig ok')
