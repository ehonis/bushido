/*
 * The permission flags model runs are spawned with: no too-broad directory, no
 * Write outside a safe brain directory, and no read of a secrets file.
 * Run: node server/agentflags.test.js
 */
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

if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
console.log('\nagent flags ok')
