#!/usr/bin/env node
/* Is it all green? `pnpm run check` (#98): what CI runs, in one command, each
 * step run even when an earlier one failed, and a line per step at the end.
 *   tests      every app and server suite (scripts/test.mjs)
 *   lint       ESLint over app/src (app/eslint.config.js)
 *   build      the web app into dist/
 *   typecheck  strict TypeScript over mobile/src (needs `npm --prefix mobile ci`)
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const STEPS = [
  ['tests', 'pnpm test'],
  ['lint', 'pnpm run lint'],
  ['build', 'pnpm run build'],
  ['typecheck', 'pnpm run typecheck:mobile'],
]
const results = []
for (const [name, cmd] of STEPS) {
  console.log(`\n=== ${name}: ${cmd}`)
  const t0 = Date.now()
  const r = spawnSync(cmd, { cwd: ROOT, stdio: 'inherit', shell: true })
  results.push({ name, ok: r.status === 0, s: ((Date.now() - t0) / 1000).toFixed(1) })
}
console.log(`\n${'='.repeat(40)}`)
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(10)} ${r.s}s`)
const failed = results.filter(r => !r.ok)
console.log(failed.length ? `\n${failed.length} of ${results.length} steps failed` : `\nall ${results.length} steps green`)
process.exit(failed.length ? 1 : 0)
