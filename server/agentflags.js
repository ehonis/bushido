/*
 * The permission flags every model run is spawned with, in one place.
 *
 * Two jobs:
 *
 *   1. Never hand a run a directory that is too broad. A brain file configured as
 *      ~/notes.md would make its directory the whole home directory, and the
 *      coach's Write grant (and every run's --add-dir) would follow it there. So
 *      a directory that is the filesystem root, the home directory, or any
 *      ancestor of the home directory is refused, and so is one that contains the
 *      data directory or the repo (writing there could reach state.json).
 *
 *   2. Deny reads of the files that hold secrets: the owner account and session
 *      key (auth.json), stored API keys and the bridge secret (settings.json), the
 *      push identity (vapid.json, push-subscriptions.json), any .env file, and the
 *      CLI's own credentials. The runs need to read the data directory; they never
 *      need these.
 *
 * Paths in Claude Code permission rules: `//abs/path` is absolute, `~/` is the
 * home directory, and a single leading `/` is relative to the project, which is
 * why every absolute path here is written with `//`.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const rulePath = (p) => `/${path.resolve(p)}` // '/home/x' -> '//home/x'

/*
 * ISOLATION. Without these, a spawned run inherits the owner's own Claude Code
 * configuration: user and project settings (a defaultMode such as acceptEdits or
 * auto, broad Edit/Bash allows, hooks), every MCP server on the account, skills,
 * and CLAUDE.md files. Verified against Claude Code 2.1.287: with a user settings
 * file allowing Edit in acceptEdits mode, the un-isolated coach overwrote the
 * training log and loaded a dozen MCP servers.
 *
 *   --setting-sources ''        load no user, project or local settings files
 *   --strict-mcp-config + an empty --mcp-config   no MCP servers at all
 *   --permission-mode manual    the default mode, stated so nothing can raise it
 *   --permission-prompts none   anything that would prompt is refused
 *   --safe-mode                 no CLAUDE.md, hooks, plugins, skills or agents
 *   --disable-slash-commands    no skills
 *
 * Authentication is unaffected: the login lives in ~/.claude/.credentials.json,
 * which is not a settings source.
 */
const ISOLATION = [
  '--setting-sources', '',
  '--strict-mcp-config', '--mcp-config', JSON.stringify({ mcpServers: {} }),
  '--permission-mode', 'manual',
  '--permission-prompts', 'none',
  '--safe-mode',
  '--disable-slash-commands',
]

/*
 * Explicit write denials that beat any allow: the training log, the plan, the
 * account and settings files, the data directory and the repo as a whole.
 */
function denyWrites({ repoRoot, dataDir }) {
  const dirs = [...new Set([path.join(repoRoot, 'data'), dataDir].filter(Boolean).map(d => path.resolve(d)))]
  return [
    ...dirs.flatMap(d => ['state.json', 'plan.json', 'auth.json', 'settings.json'].map(f => `Edit(${rulePath(d)}/${f})`)),
    ...dirs.map(d => `Edit(${rulePath(d)}/**)`),
    `Edit(${rulePath(repoRoot)}/**)`,
  ]
}

/** Root, $HOME, or an ancestor of $HOME. */
function tooBroad(dir, home = os.homedir()) {
  const d = path.resolve(dir)
  const h = path.resolve(home)
  return d === path.parse(d).root || d === h || h.startsWith(d + path.sep)
}

const contains = (outer, inner) => {
  const o = path.resolve(outer)
  const i = path.resolve(inner)
  return i === o || i.startsWith(o + path.sep)
}

/** The data-dir files no run may read. Trailing * also covers the atomic-write temp files. */
const DATA_SECRETS = ['auth.json*', 'settings.json*', 'vapid.json*', 'push-subscriptions.json*']

function denyReads({ repoRoot, dataDir }) {
  const dirs = [...new Set([path.join(repoRoot, 'data'), dataDir].filter(Boolean).map(d => path.resolve(d)))]
  return [
    ...dirs.flatMap(d => DATA_SECRETS.map(f => `Read(${rulePath(d)}/${f})`)),
    'Read(**/.env)', 'Read(**/.env.*)', 'Read(~/.claude/**)', 'Read(~/.ssh/**)',
  ]
}

/*
 * SOMEONE ELSE'S RUN. Every person on an install gets the coach and the planners,
 * and a run for anyone but the owner must not be able to read the owner's log,
 * coach threads, coach note, caches or plan, nor another person's space. The
 * owner's space is the data dir itself and theirs sits inside it
 * (`data/users/<id>/`), and the run's cwd is the repo, which usually contains
 * the data dir, so "do not --add-dir it" is not enough: it is denied by rule.
 *
 * Deny beats allow and a deny on the data dir as a whole would also cover their
 * own space, so the rules are enumerated instead: every name directly in the
 * data dir except `users/` (read when the run is spawned, plus the owner's file
 * names whether or not they exist yet), and every other person's folder. The
 * owner's own sources (the brain file and its notebook, the food-log digest)
 * are denied by path too, so a model that guesses where they live still cannot
 * read them. Claude Code applies Read rules to Grep and Glob as well.
 */
const OWNER_FILES = ['state.json*', 'coach.json*', 'plan.json*', 'whoop.json*', 'whoop-oauth.json*', 'strava.json*', 'goals.json*',
  'users.json*', 'about.json*']
const OWNER_DIRS = ['coach', 'backups', 'users']

function denyOthersReads({ repoRoot, dataDir, person, ownerSources = [], home = os.homedir() }) {
  if (!person?.dir) return []
  const mine = path.resolve(person.dir)
  const dirs = [...new Set([path.join(repoRoot, 'data'), dataDir].filter(Boolean).map(d => path.resolve(d)))]
  const rules = []
  const both = (p) => { rules.push(`Read(${rulePath(p)})`, `Read(${rulePath(p)}/**)`) }
  const list = (d) => { try { return fs.readdirSync(d) } catch { return [] } }
  for (const d of dirs) {
    rules.push(...OWNER_FILES.map(f => `Read(${rulePath(d)}/${f})`))
    rules.push(...OWNER_DIRS.filter(x => x !== 'users').map(x => `Read(${rulePath(d)}/${x}/**)`))
    for (const name of list(d)) if (name !== 'users') both(path.join(d, name))
    for (const id of list(path.join(d, 'users'))) {
      const theirs = path.resolve(d, 'users', id)
      if (theirs !== mine) both(theirs)
    }
  }
  for (const src of ownerSources.filter(Boolean)) {
    const p = path.resolve(src)
    // A source too broad to deny as a tree (a brain file's directory that is $HOME,
    // or one containing their space or the repo) would deny what they need with it,
    // so only the path itself is denied. A file is a path either way.
    const isFile = (() => { try { return fs.statSync(p).isFile() } catch { return false } })()
    if (isFile || tooBroad(p, home) || contains(p, mine) || contains(p, repoRoot)) {
      rules.push(`Read(${rulePath(p)})`)
      continue
    }
    both(p)
  }
  return [...new Set(rules)]
}

/**
 * Which extra directories a run may see, and whether the brain directory may be
 * written. Anything refused is returned with the reason, for the server's log.
 *
 * `person` ({ dir }) marks a run for someone other than the owner: no brain, no
 * food log, no Write anywhere, and their own space is the only part of the data
 * dir passed with --add-dir.
 */
function scope({ repoRoot, dataDir, brainFile, krakatoaDir, planFile, person = null, home = os.homedir() }) {
  const refused = []
  const ok = (dir, why) => {
    if (!dir) return null
    if (tooBroad(dir, home)) { refused.push(`${why} ${dir}: the root, the home directory or an ancestor of it`); return null }
    return path.resolve(dir)
  }
  if (person) { brainFile = null; krakatoaDir = null }
  let brainDir = brainFile ? ok(path.dirname(brainFile), 'brain directory') : null
  let writeDir = brainDir
  if (writeDir && [repoRoot, dataDir].filter(Boolean).some(d => contains(writeDir, d))) {
    refused.push(`write access to ${writeDir}: it contains the repo or the data directory`)
    writeDir = null
  }
  const ownData = person
    ? ok(person.dir, 'their space')
    : dataDir && path.resolve(dataDir) !== path.resolve(repoRoot, 'data') ? ok(dataDir, 'data directory') : null
  const reads = [brainDir, ok(krakatoaDir, 'food-log directory'), planFile && ok(path.dirname(planFile), 'plan directory'), ownData]
    .filter(Boolean)
    .filter(d => !contains(repoRoot, d))
    // Their plan sits in their own space; the plan directory must not widen it to the whole data dir.
    .filter(d => !person || contains(person.dir, d) || !contains(dataDir || path.join(repoRoot, 'data'), d))
  return { reads: [...new Set(reads)], writeDir, refused }
}

/**
 * Flags for the coach: read tools and the web, plus file writes into the brain
 * directory when it is safe.
 *
 * File writes are governed by EDIT rules in Claude Code: `Edit(path)` is what
 * lets the Write and Edit tools touch files under `path`. A `Write(path)` rule is
 * not honoured, which is why the scoped grant here is `Edit(//dir/**)`. A bare
 * `Edit` or `Write` in the deny list would override the scoped allow, so they are
 * denied outright only when there is no safe brain directory. Verified against
 * Claude Code 2.1.287: with these flags a headless run wrote inside the brain
 * directory and was refused in the data directory and the repo.
 */
function coachFlags(o) {
  const { reads, writeDir, refused } = scope(o)
  return {
    refused,
    writeDir,
    args: [
      ...ISOLATION,
      ...reads.flatMap(d => ['--add-dir', d]),
      '--allowedTools',
      ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', ...(writeDir ? [`Edit(${rulePath(writeDir)}/**)`] : [])].join(','),
      '--disallowedTools',
      ['Bash', 'NotebookEdit', 'Task', ...(writeDir ? [] : ['Edit', 'Write']), ...denyReads(o), ...denyOthersReads(o), ...denyWrites(o)].join(','),
    ],
  }
}

/** Flags for the two planners: read-only, no web. */
function plannerFlags(o) {
  const { reads, refused } = scope({ ...o, krakatoaDir: null, planFile: null })
  return {
    refused,
    args: [
      ...ISOLATION,
      ...reads.flatMap(d => ['--add-dir', d]),
      '--allowedTools', ['Read', 'Grep', 'Glob'].join(','),
      '--disallowedTools', ['Bash', 'Edit', 'Write', 'NotebookEdit', 'Task', 'WebSearch', 'WebFetch', ...denyReads(o), ...denyOthersReads(o), ...denyWrites(o)].join(','),
    ],
  }
}

module.exports = { coachFlags, plannerFlags, tooBroad, denyReads, denyWrites, denyOthersReads, ISOLATION, DATA_SECRETS }
