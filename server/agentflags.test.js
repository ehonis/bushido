/*
 * The permission flags the workout planner is spawned with: no too-broad
 * directory, no write anywhere, and no read of a secrets file. (The coach, whose
 * brain-directory Write grant was tested here, was removed on 2026-10-25.)
 * Run: node server/agentflags.test.js
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const agentflags = require('./agentflags.js')
const { plannerFlags, tooBroad } = agentflags

let failed = 0
const check = (name, fn) => {
  try { fn(); console.log('  ok   ', name) } catch (e) { failed++; console.log('  FAIL ', name, '\n         ', e.message) }
}
const ok = (v, m) => { if (!v) throw new Error(m || 'expected truthy') }

const HOME = '/home/u'
const base = { repoRoot: '/srv/app', dataDir: '/srv/app/data', home: HOME }
const flag = (args, name) => { const i = args.indexOf(name); return i < 0 ? '' : args[i + 1] }
const addDirs = (args) => args.flatMap((a, i) => (a === '--add-dir' ? [args[i + 1]] : []))

check('root, home and ancestors of home are too broad', () => {
  for (const d of ['/', '/home', '/home/u', '/home/u/']) ok(tooBroad(d, HOME), d)
  for (const d of ['/home/u/notes', '/srv', '/home/v']) ok(!tooBroad(d, HOME), d)
})

check('the coach\'s flags went with the coach', () => {
  ok(!('coachFlags' in agentflags), 'coachFlags is still exported')
})

check('a brain file in the home directory gets no --add-dir', () => {
  const f = plannerFlags({ ...base, brainFile: '/home/u/profile.md' })
  ok(!addDirs(f.args).includes('/home/u'), '$HOME was added as a readable directory')
  ok(f.refused.length > 0, 'the refusal is not reported')
  ok(!addDirs(plannerFlags({ ...base, brainFile: '/profile.md' }).args).includes('/'), 'the root was added')
})

check('a safe brain directory is readable, and only readable', () => {
  const f = plannerFlags({ ...base, brainFile: '/home/u/brain/projects/bushido.md' })
  ok(addDirs(f.args).includes('/home/u/brain/projects'))
  ok(!/(Write|Edit)/.test(flag(f.args, '--allowedTools')), 'a write grant reached the planner')
})

check('every run denies reading the secrets files and .env', () => {
  for (const f of [plannerFlags({ ...base, dataDir: '/vol/data' })]) {
    const deny = flag(f.args, '--disallowedTools')
    for (const want of ['Read(//vol/data/auth.json*)', 'Read(//vol/data/settings.json*)', 'Read(//vol/data/vapid.json*)',
      'Read(//srv/app/data/auth.json*)', 'Read(//srv/app/data/settings.json*)', 'Read(**/.env)', 'Read(~/.claude/**)']) {
      ok(deny.includes(want), `missing deny ${want}`)
    }
  }
})

check('the planner never gets Write or the web', () => {
  const f = plannerFlags({ ...base, brainFile: '/home/u/brain/x.md' })
  ok(flag(f.args, '--allowedTools') === 'Read,Grep,Glob')
  const deny = flag(f.args, '--disallowedTools').split(',')
  for (const t of ['Write', 'Edit', 'Bash', 'WebFetch', 'WebSearch']) ok(deny.includes(t), t)
})

check('a data directory outside the repo is readable; the repo is not added twice', () => {
  ok(addDirs(plannerFlags({ ...base, dataDir: '/vol/data' }).args).includes('/vol/data'))
  ok(!addDirs(plannerFlags(base).args).length, 'the in-repo data dir was added again')
})

check('every run is isolated from the owner\'s Claude Code settings, MCP servers and CLAUDE.md', () => {
  for (const f of [plannerFlags({ ...base, brainFile: '/home/u/brain/x.md' }), plannerFlags(base)]) {
    const a = f.args
    ok(a.includes('--strict-mcp-config') && flag(a, '--mcp-config') === '{"mcpServers":{}}', 'MCP servers can load')
    ok(a.indexOf('--setting-sources') >= 0 && flag(a, '--setting-sources') === '', 'settings files can load')
    ok(flag(a, '--permission-mode') === 'manual', 'the permission mode can be raised')
    ok(flag(a, '--permission-prompts') === 'none', 'a prompt is not refused')
    ok(a.includes('--safe-mode'), 'CLAUDE.md, hooks and plugins can load')
  }
})

check('writes to the log, plan, account, settings, data dir and repo are denied outright', () => {
  for (const f of [plannerFlags({ ...base, brainFile: '/home/u/brain/x.md' }), plannerFlags(base)]) {
    const deny = flag(f.args, '--disallowedTools').split(',')
    for (const want of ['Edit(//srv/app/data/state.json)', 'Edit(//srv/app/data/plan.json)', 'Edit(//srv/app/data/auth.json)',
      'Edit(//srv/app/data/settings.json)', 'Edit(//srv/app/data/**)', 'Edit(//srv/app/**)', 'Edit', 'Write']) ok(deny.includes(want), want)
  }
})

/*
 * SOMEONE ELSE'S RUN: everything the owner keeps in the data dir, and every other
 * person's folder, is denied by rule; their own space is the only part of the data
 * dir added; the owner's brain file is neither added nor readable. The coach
 * files and goals cache an older install still has stay denied.
 */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bushido-flags-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))
const D = path.join(tmp, 'data')
for (const d of ['coach', 'backups', 'users/sam/coach', 'users/robin']) fs.mkdirSync(path.join(D, d), { recursive: true })
for (const f of ['state.json', 'coach.json', 'whoop.json', 'strava.json', 'odd-new-file.json', 'users.json', 'users/robin/state.json']) fs.writeFileSync(path.join(D, f), '{}')
const SAM = path.join(D, 'users', 'sam')
const someone = {
  repoRoot: '/srv/app', dataDir: D, home: HOME, person: { dir: SAM },
  brainFile: '/home/u/brain/projects/me.md',
  ownerSources: ['/home/u/brain/projects/me.md', '/home/u/brain/projects', '/home/u/food'],
}
const r = (p) => `/${path.resolve(p)}`

check('someone else\'s run: only their own space is added; no brain, no Write', () => {
  const f = plannerFlags(someone)
  const dirs = addDirs(f.args)
  ok(JSON.stringify(dirs) === JSON.stringify([SAM]), `added ${dirs.join(', ')}`)
  ok(!/(Write|Edit)\(/.test(flag(f.args, '--allowedTools')), 'a Write grant reached someone else\'s run')
  const deny = flag(f.args, '--disallowedTools').split(',')
  ok(deny.includes('Edit') && deny.includes('Write'), 'file writes are not denied outright for someone else')
})

check('someone else\'s run cannot read the owner\'s log, old coach files, caches, backups or anyone else\'s folder', () => {
  for (const f of [plannerFlags(someone)]) {
    const deny = flag(f.args, '--disallowedTools').split(',')
    for (const want of [`Read(${r(D)}/state.json*)`, `Read(${r(D)}/coach.json*)`, `Read(${r(D)}/coach/**)`, `Read(${r(D)}/backups/**)`,
      `Read(${r(D)}/whoop.json*)`, `Read(${r(D)}/strava.json*)`, `Read(${r(D)}/plan.json*)`, `Read(${r(D)}/goals.json*)`,
      `Read(${r(D)}/odd-new-file.json)`, `Read(${r(path.join(D, 'users', 'robin'))}/**)`,
      `Read(${r('/home/u/brain/projects/me.md')})`, `Read(${r('/home/u/brain/projects')}/**)`, `Read(${r('/home/u/food')}/**)`,
      // The repo's own data dir too, which is what the cwd can reach by default.
      'Read(//srv/app/data/state.json*)', 'Read(//srv/app/data/coach/**)']) {
      ok(deny.includes(want), `missing deny ${want}`)
    }
    ok(!deny.some(d => d.includes(r(SAM))), 'a rule denies their own space')
    ok(!deny.includes(`Read(${r(path.join(D, 'users'))}/**)`), 'the whole users folder is denied, which would cover their own')
  }
})

check('a too-broad owner source is denied as a file, never as a directory that would cover their space', () => {
  const f = plannerFlags({ ...someone, ownerSources: ['/home/u/notes.md', '/home/u'] })
  const deny = flag(f.args, '--disallowedTools').split(',')
  ok(deny.includes('Read(//home/u/notes.md)'), 'the brain file itself is not denied')
  ok(!deny.includes('Read(//home/u/**)'), '$HOME was denied, which would deny their own space with it')
})

check('the owner\'s run is unchanged by any of it', () => {
  const owner = plannerFlags({ repoRoot: '/srv/app', dataDir: D, home: HOME, brainFile: '/home/u/brain/projects/me.md' })
  const deny = flag(owner.args, '--disallowedTools')
  ok(!deny.includes(`Read(${r(D)}/state.json*)`), 'the owner is denied the owner\'s own log')
  ok(addDirs(owner.args).includes(D), 'the owner\'s data dir is not added')
  ok(addDirs(owner.args).includes('/home/u/brain/projects'), 'the owner\'s brain file is not readable')
})

if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
console.log('\nagent flags ok')
