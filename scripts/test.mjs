#!/usr/bin/env node
/* Every test suite, one after another, and a summary at the end:
 *   node scripts/test.mjs            app suites, then server suites (`npm test`)
 *   node scripts/test.mjs app        the app's own (`npm --prefix app test`)
 *   node scripts/test.mjs server     server/*.test.js (`npm run test:server`)
 *
 * It runs every suite even when one fails, and exits non-zero if any did. It used
 * to be one `&&` chain, so the first red suite stopped the run and everything after
 * it never started: a red result that did not say nothing else had been tried.
 *
 * The app's suites are its package.json scripts, run here in APP_SUITES order (so
 * `npm --prefix app run test:gear` still runs one alone); the server's are every
 * server/*.test.js.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname, resolve, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const APP = join(ROOT, 'app')
const SERVER = join(ROOT, 'server')

const APP_SUITES = [
  'test:handoff', 'palette', 'test:fingers', 'test:streak', 'test:gear', 'test:progress',
  'test:workout', 'test:circuit', 'test:tests', 'test:sessionops', 'test:lifts', 'test:presc', 'test:naming',
  'test:md', 'test:starter', 'test:exercises', 'test:signout', 'test:whoami', 'test:shared',
  'test:trainer', 'test:drafts', 'test:planflow', 'test:done', 'test:history', 'test:libsync', 'test:cycles', 'smoke',
]

const scripts = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8')).scripts
const unknown = APP_SUITES.filter(s => !scripts[s])
if (unknown.length) {
  console.error(`scripts/test.mjs names app scripts that do not exist: ${unknown.join(', ')}`)
  process.exit(2)
}
// A suite added to app/package.json but not here would never run.
const unlisted = Object.keys(scripts).filter(s => /^test:/.test(s) && !APP_SUITES.includes(s))
if (unlisted.length) {
  console.error(`app/package.json has test scripts scripts/test.mjs does not run: ${unlisted.join(', ')}`)
  process.exit(2)
}

const which = process.argv[2] || 'all'
const suites = []
if (which === 'all' || which === 'app') {
  for (const s of APP_SUITES) suites.push({ name: `app ${s}`, cwd: APP, cmd: scripts[s] })
}
if (which === 'all' || which === 'server') {
  for (const f of readdirSync(SERVER).filter(f => f.endsWith('.test.js')).sort()) {
    suites.push({ name: `server ${f}`, cwd: SERVER, cmd: `node ${f}` })
  }
}
if (!suites.length) {
  console.error(`unknown suite group "${which}": use app, server or nothing`)
  process.exit(2)
}

// What `npm run` would add: the app's local binaries (esbuild) on the PATH.
const env = { ...process.env, PATH: [join(APP, 'node_modules', '.bin'), process.env.PATH].join(delimiter) }

const results = []
for (const s of suites) {
  console.log(`\n== ${s.name}`)
  const t0 = Date.now()
  const r = spawnSync(s.cmd, { cwd: s.cwd, env, stdio: 'inherit', shell: true })
  results.push({ ...s, ok: r.status === 0, ms: Date.now() - t0, status: r.status ?? r.signal })
}

const failed = results.filter(r => !r.ok)
console.log(`\n${'='.repeat(60)}`)
for (const r of results) {
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(28)} ${(r.ms / 1000).toFixed(1)}s${r.ok ? '' : `  (exit ${r.status})`}`)
}
console.log(`\n${results.length} suites: ${results.length - failed.length} passed, ${failed.length} failed` +
  (failed.length ? `: ${failed.map(r => r.name).join(', ')}` : ''))
process.exit(failed.length ? 1 : 0)
