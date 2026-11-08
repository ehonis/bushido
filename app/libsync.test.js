/* The iPhone app's copy of the web's lib/ has not drifted:
 *   node app/libsync.test.js            check
 *   node app/libsync.test.js --update   rewrite app/libsync.native.diff from the files
 *
 * mobile/src/lib holds the web's app/src/lib, copied by hand at the same paths
 * (mobile/AGENTS.md, "How it fits together"). A silent difference in
 * prescription.js, shared.js or lifts.js changes what gets logged on one platform
 * only, so every copied file is held to its web original here:
 *
 *   - a copy is byte for byte the web file, or
 *   - it differs by exactly the native edits written down in app/libsync.native.diff
 *     (the hunks, without line numbers, so an edit elsewhere in the web file that was
 *     copied across still passes, and one that was not copied fails), and
 *   - every web file is either copied or named below as web-only or rewritten.
 *
 * When this fails because the web changed: copy the web file over the mobile one,
 * re-apply the native edits the diff shows, and run it again. Only when a NATIVE edit
 * changes on purpose, run it with --update and let the review read the diff.
 * done.test.js holds the three copies of `isDone` (one of them the server's) to one
 * text on top of this.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WEB = join(ROOT, 'app/src/lib')
const MOBILE = join(ROOT, 'mobile/src/lib')
const NATIVE = join(ROOT, 'app/libsync.native.diff')

/* Web files the app does not copy, and why (mobile/AGENTS.md). */
const NOT_COPIED = {
  'push.js': 'web push has no native meaning',
  'handoff.js': 'hostname moves have no native meaning',
  'icons.jsx': 'rewritten as icons.tsx (lucide-react-native, same names)',
  'viz.jsx': 'rewritten as viz.tsx',
  'figures.jsx': 'rewritten as figures.tsx, from the same data',
  'bodymap.jsx': 'rewritten as bodymap.tsx',
  'markdown.jsx': 'rewritten as markdown.tsx',
  'cues.js': 'rewritten as cues.ts (haptics for the beeps)',
  'toast.js': 'rewritten as toast.ts',
}

/* ------------------------------------------------------------ a line diff */

/** Hunks of `a` → `b` as `{ del, add }` line lists, in order (LCS, no line numbers). */
function hunks(a, b) {
  const n = a.length, m = b.length
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const out = []
  let cur = null
  const flush = () => { if (cur) out.push(cur); cur = null }
  let i = 0, j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { flush(); i++; j++ }
    else if (j < m && (i === n || lcs[i][j + 1] >= lcs[i + 1][j])) { (cur ||= { del: [], add: [] }).add.push(b[j]); j++ }
    else { (cur ||= { del: [], add: [] }).del.push(a[i]); i++ }
  }
  flush()
  return out
}

const fmt = (file, hs) => hs.map(h =>
  `=== ${file}\n${h.del.map(l => `- ${l}`).join('\n')}${h.del.length && h.add.length ? '\n' : ''}${h.add.map(l => `+ ${l}`).join('\n')}`,
).join('\n')

/** app/libsync.native.diff → { file: [{ del, add }] } */
function readNative() {
  const out = {}
  if (!existsSync(NATIVE)) return out
  let cur = null
  for (const line of readFileSync(NATIVE, 'utf8').split('\n')) {
    if (line.startsWith('#') || line === '') continue
    const head = /^=== (.+)$/.exec(line)
    if (head) { cur = { del: [], add: [] }; (out[head[1]] ||= []).push(cur); continue }
    if (!cur || !/^[-+] /.test(line)) throw new Error(`libsync.native.diff: cannot read "${line}"`)
    ;(line[0] === '-' ? cur.del : cur.add).push(line.slice(2))
  }
  return out
}

/* ------------------------------------------------------------------ check */

const lines = (p) => readFileSync(p, 'utf8').split('\n')
const webFiles = readdirSync(WEB).filter(f => /\.(js|jsx)$/.test(f)).sort()
const copied = webFiles.filter(f => existsSync(join(MOBILE, f)))
const actual = {}
for (const f of copied) {
  const hs = hunks(lines(join(WEB, f)), lines(join(MOBILE, f)))
  if (hs.length) actual[f] = hs
}

if (process.argv.includes('--update')) {
  const head = [
    '# The native edits in mobile/src/lib, as hunks of web → mobile without line numbers.',
    '# Checked by app/libsync.test.js; regenerate with `node app/libsync.test.js --update`',
    '# only when a native edit changes on purpose. "-" is the web line, "+" the mobile one.',
    '',
  ]
  writeFileSync(NATIVE, head.join('\n') + Object.entries(actual).map(([f, hs]) => fmt(f, hs)).join('\n') + '\n')
  console.log(`wrote ${Object.keys(actual).length} file(s) of native edits to app/libsync.native.diff`)
  process.exit(0)
}

let failed = 0
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`) }
  catch (err) { failed++; console.error(`  FAIL  ${name}\n${err.message.replace(/^/gm, '        ')}`) }
}

const native = readNative()

check('every web lib file is copied to the app, or named as not copied', () => {
  const missing = webFiles.filter(f => !existsSync(join(MOBILE, f)) && !NOT_COPIED[f])
  if (missing.length) throw new Error(`not in mobile/src/lib and not in NOT_COPIED: ${missing.join(', ')}`)
  const stale = Object.keys(NOT_COPIED).filter(f => !webFiles.includes(f) || existsSync(join(MOBILE, f)))
  if (stale.length) throw new Error(`NOT_COPIED names files that are gone or are copied: ${stale.join(', ')}`)
})

for (const f of copied) {
  check(`lib/${f}: ${native[f] ? 'the web file plus its native edits' : 'byte for byte the web file'}`, () => {
    const want = native[f] || []
    const got = actual[f] || []
    if (JSON.stringify(got) === JSON.stringify(want)) return
    throw new Error(
      `mobile/src/lib/${f} has drifted from app/src/lib/${f}.\n` +
      `Copy the web file across and re-apply the native edits (mobile/AGENTS.md).\n` +
      `expected:\n${fmt(f, want) || '(no difference)'}\ngot:\n${fmt(f, got) || '(no difference)'}`)
  })
}

check('the native edits name only files that are copied', () => {
  const stray = Object.keys(native).filter(f => !copied.includes(f))
  if (stray.length) throw new Error(`libsync.native.diff names ${stray.join(', ')}`)
})

console.log(failed
  ? `\n${failed} lib copy check(s) failed`
  : `\n${copied.length} copied lib files in step (${Object.keys(native).length} with native edits)`)
process.exit(failed ? 1 : 0)
