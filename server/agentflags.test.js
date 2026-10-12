/*
 * The permission flags model runs are spawned with: no too-broad directory, no
 * Write outside a safe brain directory, and no read of a secrets file.
 * Run: node server/agentflags.test.js
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { coachFlags, plannerFlags, tooBroad } = require('./agentflags.js')

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

check('a brain file in the home directory gets no Write and no --add-dir', () => {
  const f = coachFlags({ ...base, brainFile: '/home/u/profile.md' })
  ok(!/(Write|Edit)\(/.test(flag(f.args, '--allowedTools')), 'Write was granted on $HOME')
  const deny = flag(f.args, '--disallowedTools').split(',')
  ok(deny.includes('Write') && deny.includes('Edit'), 'file writes are not denied outright')
  ok(!addDirs(f.args).includes('/home/u'), '$HOME was added as a readable directory')
  ok(f.refused.length > 0, 'the refusal is not reported')
})

check('a brain file at the filesystem root or one level under home is refused too', () => {
  ok(!/(Write|Edit)\(/.test(flag(coachFlags({ ...base, brainFile: '/profile.md' }).args, '--allowedTools')))
  ok(!/(Write|Edit)\(/.test(flag(coachFlags({ ...base, brainFile: '/home/profile.md' }).args, '--allowedTools')))
})

check('a brain directory that contains the data directory gets no Write', () => {
  const f = coachFlags({ ...base, brainFile: '/srv/notes.md' })
  ok(!/(Write|Edit)\(/.test(flag(f.args, '--allowedTools')), 'Write could reach state.json')
})

check('a safe brain directory gets a scoped Edit rule, which is what governs file writes', () => {
  const f = coachFlags({ ...base, brainFile: '/home/u/brain/projects/bushido.md' })
  ok(flag(f.args, '--allowedTools').includes('Edit(//home/u/brain/projects/**)'), flag(f.args, '--allowedTools'))
  ok(!/Write\(/.test(flag(f.args, '--allowedTools')), 'a Write(path) rule is not honoured by the CLI; use Edit(path)')
  const deny = flag(f.args, '--disallowedTools').split(',')
  ok(!deny.includes('Edit') && !deny.includes('Write'), 'a bare Edit/Write deny would override the scoped allow')
  ok(addDirs(f.args).includes('/home/u/brain/projects'))
})

check('every run denies reading the secrets files and .env', () => {
  for (const f of [coachFlags({ ...base, dataDir: '/vol/data' }), plannerFlags({ ...base, dataDir: '/vol/data' })]) {
    const deny = flag(f.args, '--disallowedTools')
    for (const want of ['Read(//vol/data/auth.json*)', 'Read(//vol/data/settings.json*)', 'Read(//vol/data/vapid.json*)',
      'Read(//srv/app/data/auth.json*)', 'Read(//srv/app/data/settings.json*)', 'Read(**/.env)', 'Read(~/.claude/**)']) {
      ok(deny.includes(want), `missing deny ${want}`)
    }
  }
})

check('planners never get Write or the web', () => {
  const f = plannerFlags({ ...base, brainFile: '/home/u/brain/x.md' })
  ok(flag(f.args, '--allowedTools') === 'Read,Grep,Glob')
  const deny = flag(f.args, '--disallowedTools').split(',')
  for (const t of ['Write', 'Edit', 'Bash', 'WebFetch', 'WebSearch']) ok(deny.includes(t), t)
})

check('a data directory outside the repo is readable; the repo is not added twice', () => {
  ok(addDirs(coachFlags({ ...base, dataDir: '/vol/data' }).args).includes('/vol/data'))
  ok(!addDirs(coachFlags(base).args).length, 'the in-repo data dir was added again')
})

check('every run is isolated from the owner\'s Claude Code settings, MCP servers and CLAUDE.md', () => {
  for (const f of [coachFlags({ ...base, brainFile: '/home/u/brain/x.md' }), plannerFlags(base)]) {
    const a = f.args
    ok(a.includes('--strict-mcp-config') && flag(a, '--mcp-config') === '{"mcpServers":{}}', 'MCP servers can load')
    ok(a.indexOf('--setting-sources') >= 0 && flag(a, '--setting-sources') === '', 'settings files can load')
    ok(flag(a, '--permission-mode') === 'manual', 'the permission mode can be raised')
    ok(flag(a, '--permission-prompts') === 'none', 'a prompt is not refused')
    ok(a.includes('--safe-mode'), 'CLAUDE.md, hooks and plugins can load')
  }
})

check('writes to the log, plan, account, settings, data dir and repo are denied outright', () => {
  for (const f of [coachFlags({ ...base, brainFile: '/home/u/brain/x.md' }), plannerFlags(base)]) {
    const deny = flag(f.args, '--disallowedTools').split(',')
    for (const want of ['Edit(//srv/app/data/state.json)', 'Edit(//srv/app/data/plan.json)', 'Edit(//srv/app/data/auth.json)',
      'Edit(//srv/app/data/settings.json)', 'Edit(//srv/app/data/**)', 'Edit(//srv/app/**)']) ok(deny.includes(want), want)
  }
  // ...and none of those denials covers the brain directory the coach may write.
  const coach = coachFlags({ ...base, brainFile: '/home/u/brain/x.md' })
  ok(!flag(coach.args, '--disallowedTools').includes('/home/u/brain'), 'a deny rule shadows the brain grant')
})

/*
 * SOMEONE ELSE'S RUN: everything the owner keeps in the data dir, and every other
 * person's folder, is denied by rule; their own space is the only part of the data
 * dir added; the owner's brain and food log are neither added nor readable.
 */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bushido-flags-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))
const D = path.join(tmp, 'data')
for (const d of ['coach', 'backups', 'users/sam/coach', 'users/robin']) fs.mkdirSync(path.join(D, d), { recursive: true })
for (const f of ['state.json', 'coach.json', 'whoop.json', 'strava.json', 'odd-new-file.json', 'users.json', 'users/robin/state.json']) fs.writeFileSync(path.join(D, f), '{}')
const SAM = path.join(D, 'users', 'sam')
const someone = {
  repoRoot: '/srv/app', dataDir: D, home: HOME, person: { dir: SAM },
  brainFile: '/home/u/brain/projects/me.md', krakatoaDir: '/home/u/food',
  ownerSources: ['/home/u/brain/projects/me.md', '/home/u/brain/projects', '/home/u/food'],
}
const r = (p) => `/${path.resolve(p)}`

check('someone else\'s run: only their own space is added; no brain, no food log, no Write', () => {
  for (const f of [coachFlags(someone), plannerFlags(someone)]) {
    const dirs = addDirs(f.args)
    ok(JSON.stringify(dirs) === JSON.stringify([SAM]), `added ${dirs.join(', ')}`)
    ok(!/(Write|Edit)\(/.test(flag(f.args, '--allowedTools')), 'a Write grant reached someone else\'s run')
  }
  const deny = flag(coachFlags(someone).args, '--disallowedTools').split(',')
  ok(deny.includes('Edit') && deny.includes('Write'), 'file writes are not denied outright for someone else')
})

check('someone else\'s run cannot read the owner\'s log, coach, caches, backups or anyone else\'s folder', () => {
  for (const f of [coachFlags(someone), plannerFlags(someone)]) {
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
  const f = coachFlags({ ...someone, ownerSources: ['/home/u/notes.md', '/home/u'] })
  const deny = flag(f.args, '--disallowedTools').split(',')
  ok(deny.includes('Read(//home/u/notes.md)'), 'the brain file itself is not denied')
  ok(!deny.includes('Read(//home/u/**)'), '$HOME was denied, which would deny their own space with it')
})

check('the owner\'s run is unchanged by any of it', () => {
  const owner = coachFlags({ repoRoot: '/srv/app', dataDir: D, home: HOME, brainFile: '/home/u/brain/projects/me.md' })
  const deny = flag(owner.args, '--disallowedTools')
  ok(!deny.includes(`Read(${r(D)}/state.json*)`), 'the owner is denied the owner\'s own log')
  ok(addDirs(owner.args).includes(D), 'the owner\'s data dir is not added')
  ok(flag(owner.args, '--allowedTools').includes('Edit(//home/u/brain/projects/**)'), 'the owner lost the brain Write grant')
})

if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
console.log('\nagent flags ok')
