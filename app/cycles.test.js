/* No import cycles in either app:
 *   node app/cycles.test.js
 *
 * The one cycle there was (#73) ran planner → trainer → runner → planner, because
 * the runner, the timer and Today imported a six-line helper (`liftFieldOf`) from
 * the planner. A cycle works until a module reads an import at load time, and then
 * it is `undefined` in whichever file loaded first; it also means a change to the
 * planner is a change to every screen. Each app's own source is walked from its
 * relative imports (`./x`, `../x`); packages are not followed.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EXT = ['.jsx', '.js', '.tsx', '.ts', '.mjs']

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (EXT.some(e => name.endsWith(e))) out.push(p)
  }
  return out
}

/** `./planner` → the file it names, trying each extension and an index file. */
function resolveImport(from, spec) {
  const base = resolve(dirname(from), spec)
  for (const cand of [base, ...EXT.map(e => base + e), ...EXT.map(e => join(base, 'index' + e))]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand
  }
  return null
}

// Static imports and re-exports only; `import type` has no runtime edge.
const IMPORT = /^\s*(?:import|export)\s+(?!type\s)(?:[^'";]*?\s+from\s+)?['"](\.[^'"]+)['"]/gm

function graphOf(dir) {
  const files = walk(dir)
  const edges = new Map()
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    const to = new Set()
    for (const m of src.matchAll(IMPORT)) {
      const hit = resolveImport(f, m[1])
      if (hit && hit.startsWith(dir)) to.add(hit)
    }
    edges.set(f, [...to])
  }
  return edges
}

/** Tarjan's strongly connected components; any with two or more files is a cycle. */
function cycles(edges) {
  let index = 0
  const idx = new Map(), low = new Map(), on = new Set(), stack = [], out = []
  const visit = (v) => {
    idx.set(v, index); low.set(v, index); index++
    stack.push(v); on.add(v)
    for (const w of edges.get(v) || []) {
      if (!idx.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))) }
      else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)))
    }
    if (low.get(v) === idx.get(v)) {
      const scc = []
      let w
      do { w = stack.pop(); on.delete(w); scc.push(w) } while (w !== v)
      if (scc.length > 1 || (edges.get(v) || []).includes(v)) out.push(scc)
    }
  }
  for (const v of edges.keys()) if (!idx.has(v)) visit(v)
  return out
}

let failed = 0
for (const dir of ['app/src', 'mobile/src']) {
  const found = cycles(graphOf(join(ROOT, dir)))
  if (found.length) {
    failed++
    console.error(`  FAIL  ${dir} has ${found.length} import cycle(s):`)
    for (const scc of found) console.error(`        ${scc.map(f => relative(ROOT, f)).sort().join(' ↔ ')}`)
  } else {
    console.log(`  PASS  ${dir} has no import cycle`)
  }
}

console.log(failed ? `\n${failed} cycle check(s) failed` : '\nno import cycles')
process.exit(failed ? 1 : 0)
