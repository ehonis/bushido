// The phone's frame rules while typing (#77, #98), run in node: the predicates
// in mobile/src/ui/sheetPolicy.ts (bundled by esbuild, which reads TypeScript),
// and pins that every layer with something at its foot asks them rather than a
// copy of its own. A React Native screen cannot be rendered here (no native
// test renderer is installed, and D13 adds no dependency to mobile/), so the
// rule is tested as data and each call site is held to it in the source.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { keyboardEvents, showFoot, canSwipe, showActs } from '../mobile/src/ui/sheetPolicy.ts'
import { pullRefresh, wantsPull, FRESH_MS } from '../mobile/src/shell/pullRefresh.ts'

const ROOT = new URL('../mobile/src/', import.meta.url).pathname
const read = (f) => readFileSync(join(ROOT, f), 'utf8')
const walk = (dir) => readdirSync(join(ROOT, dir)).flatMap(n => {
  const p = join(dir, n)
  return statSync(join(ROOT, p)).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : []
})

const tests = []
const test = (name, fn) => tests.push([name, fn])

test('the keys count as up from keyboardWillShow and as gone only on keyboardDidHide', () => {
  assert.deepEqual(keyboardEvents('ios'), { show: 'keyboardWillShow', hide: 'keyboardDidHide' })
  assert.deepEqual(keyboardEvents('android'), { show: 'keyboardDidShow', hide: 'keyboardDidHide' })
})

test('a footer: none while typing, none while confirming, none when there is none', () => {
  assert.equal(showFoot({ footer: 'Start', typing: false }), true)
  assert.equal(showFoot({ footer: 'Start', typing: true }), false, 'the footer rides the keyboard onto the keypad')
  assert.equal(showFoot({ footer: 'Start', confirming: true, typing: false }), false)
  assert.equal(showFoot({ footer: null, typing: false }), false)
})

test('a swipe down closes only an untouched sheet with no box being typed in', () => {
  assert.equal(canSwipe({ touched: false, typing: false }), true)
  assert.equal(canSwipe({ touched: true, typing: false }), false, 'a swipe throws away what was typed')
  assert.equal(canSwipe({ touched: false, typing: true }), false, 'a swipe closes the sheet mid-number')
  assert.equal(canSwipe({ dismissable: false, touched: false, typing: false }), false)
})

test("the runner's Done set and All sets are not drawn while the keys are up", () => {
  assert.equal(showActs({ typing: true }), false)
  assert.equal(showActs({ typing: false }), true)
})

test('every layer asks sheetPolicy: the sheet, the planner’s sticky bar, the runner, the keyboard hook', () => {
  const sheet = read('ui/Sheet.tsx')
  if (!/const canSwipe = swipeAllowed\(\{ dismissable, touched, typing \}\)/.test(sheet) || !/allowSwipeDismissal=\{canSwipe\}/.test(sheet)
    || !/onRequestClose=\{\(\) => \{ if \(canSwipe\) onClose\(\) \}\}/.test(sheet)) throw new Error('the sheet decides its own swipe')
  if (!/const showFoot = footAllowed\(\{ footer, confirming, typing \}\)/.test(sheet) || !/\{showFoot \? \(/.test(sheet)) throw new Error('the sheet decides its own footer')
  if (!/const markDirty = useCallback\(\(\) => setTouched\(true\), \[\]\)/.test(sheet) || !/<SheetDirty\.Provider value=\{markDirty\}>/.test(sheet)) throw new Error('an edit no longer locks the swipe')
  const planner = read('features/planner.tsx')
  if (!/const showFoot = footAllowed\(\{ footer: foot, typing \}\)/.test(planner)) throw new Error('the planner’s bar decides for itself')
  const runner = read('features/runner.tsx')
  if (!/\{!showActs\(\{ typing \}\) \? null : \(\s*<View style=\{st\.acts\}>/.test(runner)) throw new Error('the runner draws its actions over the keys')
  const bar = read('ui/KeyboardBar.tsx')
  if (!/const on = keyboardEvents\(Platform\.OS\)/.test(bar)) throw new Error('useKeyboardShown has its own events')
})

test('ONE keyboard hook: nothing else listens to the keyboard, and nothing waits on keyboardWillHide', () => {
  const others = walk('.').filter(f => f !== 'ui/KeyboardBar.tsx' && /Keyboard\.addListener\(/.test(read(f)))
  assert.deepEqual(others, [], 'a second keyboard hook is back')
  const will = walk('.').filter(f => f !== 'ui/sheetPolicy.ts' && /keyboardWillHide/.test(read(f)))
  assert.deepEqual(will, [], 'something comes back while the keys are still leaving')
  for (const f of ['ui/Sheet.tsx', 'features/planner.tsx', 'features/runner.tsx']) {
    if (!/useKeyboardShown\(\)/.test(read(f))) throw new Error(`${f} does not read the one hook`)
  }
})

test('every Input carries the keyboard bar, and no sheet footer is a Close', () => {
  const kit = read('ui/kit.tsx')
  if (!/\{bar \? <KeyboardBar nativeID=\{bar\} \/> : null\}/.test(kit)) throw new Error('kit Input lost its keyboard bar')
  const raw = walk('features').filter(f => /<TextInput\b/.test(read(f)))
  assert.deepEqual(raw, [], 'a raw TextInput has no keyboard bar (use kit Input)')
  const bad = []
  for (const f of walk('.')) {
    const s = read(f)
    for (const m of s.matchAll(/\bfooter=\{/g)) {
      const foot = s.slice(m.index, m.index + 400)
      if (/title="(Close|Done)"/.test(foot)) bad.push(f)
    }
  }
  assert.deepEqual(bad, [], 'a Close is back in a sheet footer')
})

test('the coach is gone from the dock too (#31, F F8)', () => {
  if (/coach/.test(read('shell/TabBar.tsx'))) throw new Error('the tab bar still checks for a coach tab')
  if (/coach/i.test(read('lib/foreground.ts'))) throw new Error('foreground.ts still names a coach provider')
})

/*
 * Pull down on a tab: the log syncs AND WHOOP and Strava are pulled.
 * Their GETs only serve the server's cache, so without a pull the ride that
 * just synced showed up one refresh late.
 */
const NOW = Date.parse('2026-11-11T12:00:00Z')
const ago = (ms) => new Date(NOW - ms).toISOString()
const calls = () => {
  const log = []
  const later = (name, ms = 0, value) => () => new Promise(r => setTimeout(() => { log.push(name); r(value) }, ms))
  const svc = (name, cache, pull = later(name)) => ({ cache, pull })
  const base = { refresh: later('log', 0, true), reloadPlan: () => log.push('plan'), now: NOW }
  return { log, later, svc, base }
}
const on = (fetchedAt = ago(10 * 60_000)) => ({ configured: true, fetchedAt })

test('pull to refresh pulls WHOOP and Strava along with the log', async () => {
  const { log, svc, base } = calls()
  await pullRefresh({ ...base, whoop: svc('whoop', on()), strava: svc('strava', on(null)) })
  assert.deepEqual([...log].sort(), ['log', 'plan', 'strava', 'whoop'], 'a cache never fetched is pulled too')
})

test('pull to refresh never pulls a service its cache says is not connected', async () => {
  const { log, svc, base } = calls()
  await pullRefresh({ ...base, whoop: svc('whoop', { configured: false, fetchedAt: null }), strava: svc('strava', null) })
  assert.deepEqual([...log].sort(), ['log', 'plan'], 'not connected, or no answer yet: only the log')
})

test('pull to refresh leaves a copy fetched in the last minute alone', async () => {
  const { log, svc, base } = calls()
  await pullRefresh({ ...base, whoop: svc('whoop', on(ago(FRESH_MS - 1000))), strava: svc('strava', on(ago(FRESH_MS + 1000))) })
  assert.deepEqual([...log].sort(), ['log', 'plan', 'strava'])
  assert.equal(wantsPull(on('not a date'), NOW), true, 'an unreadable fetchedAt is not fresh')
})

test('offline, the log is retried and the services are not touched', async () => {
  const { log, later, svc, base } = calls()
  await pullRefresh({ ...base, refresh: later('log', 0, false), whoop: svc('whoop', on()), strava: svc('strava', on()) })
  assert.deepEqual(log, ['plan', 'log'], 'an offline pull would leave a network error on every block')
  log.length = 0
  await pullRefresh({ ...base, refresh: () => Promise.reject(new Error('offline')), whoop: svc('whoop', on()), strava: svc('strava', on()) })
  assert.deepEqual(log, ['plan'], 'a log sync that throws counts as offline')
})

test('a failed or slow service never holds the spinner past the log and the cap', async () => {
  const { log, later, svc, base } = calls()
  const t0 = Date.now()
  await pullRefresh({ ...base, refresh: later('log', 5, true), waitMs: 30,
    whoop: svc('whoop', on(), () => new Promise(() => {})), strava: svc('strava', on(), () => Promise.reject(new Error('down'))) })
  assert.deepEqual(log, ['plan', 'log'])
  assert.ok(Date.now() - t0 < 500, 'a hung WHOOP pull let the spinner go at the cap')
})

test('the services are pulled once the log has reached the server, and the spinner waits for both', async () => {
  const { log, later, svc, base } = calls()
  await pullRefresh({ ...base, refresh: later('log', 20, true), reloadPlan: () => {}, whoop: svc('whoop', on(), later('whoop', 10)), strava: svc('strava', null) })
  assert.deepEqual(log, ['log', 'whoop'])
  log.length = 0
  await pullRefresh({ ...base, refresh: later('log', 0, undefined), reloadPlan: () => {}, whoop: svc('whoop', on()), strava: svc('strava', null) })
  assert.deepEqual(log, ['log'], 'a log sync skipped behind a push in flight has not said the server is there')
})

test('Screen is the only pull to refresh, so none skips the services', () => {
  if (!/pullRefresh\(/.test(read('shell/Screen.tsx'))) throw new Error('Screen.tsx no longer refreshes through pullRefresh')
  const others = walk('.').filter(f => f !== 'shell/Screen.tsx' && /<RefreshControl|\bonRefresh=/.test(read(f)))
  if (others.length) throw new Error(`a second pull to refresh that skips the services: ${others.join(', ')}`)
})

/*
 * The typecheck means something only where nothing is cast away (#98, H F4):
 * a lib function TypeScript reads too narrowly gets a JSDoc type in the lib
 * (both copies), never an `as any` at the call. A ratchet: these numbers only
 * go down. Lower them when you remove casts.
 */
const AS_ANY = { total: 217, hot: { 'features/sheet.tsx': 0, 'features/editor.tsx': 1, 'features/exercises.tsx': 3, 'features/runner.tsx': 2 } }
test(`no more \`as any\` than the ratchet (${AS_ANY.total} in mobile/src)`, () => {
  const count = (f) => (read(f).match(/\bas any\b/g) || []).length
  const total = walk('.').reduce((n, f) => n + count(f), 0)
  if (total > AS_ANY.total) throw new Error(`${total} \`as any\` in mobile/src, up from ${AS_ANY.total}: type the lib function with JSDoc instead`)
  for (const [f, n] of Object.entries(AS_ANY.hot)) {
    if (count(f) > n) throw new Error(`${f}: ${count(f)} \`as any\`, up from ${n}`)
  }
})

let failed = 0
for (const [name, fn] of tests) {
  try { await fn(); console.log(`  ok  ${name}`) } catch (e) { failed += 1; console.log(`  FAIL ${name}\n       ${e.message}`) }
}
console.log(failed ? `${failed} of ${tests.length} native frame cases failed` : `${tests.length} native frame cases`)
process.exit(failed ? 1 : 0)
