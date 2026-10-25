/*
 * The draft store on its own: no server, no model. Each planner run is a
 * promise the test resolves or rejects by hand, so "mid-run" is a real state
 * rather than a race. Run: node server/drafts.test.js
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createDrafts, keptIdsIn, RESTARTED, CLAIM_MS } = require('./drafts.js')

let failed = 0
const ok = (v, m) => { if (!v) throw new Error(m || 'expected truthy') }
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }
async function step(name, fn) {
  try { await fn(); console.log('  ok   ', name) } catch (e) { failed++; console.log('  FAIL ', name, '\n         ', e.message) }
}

const made = []
process.on('exit', () => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }) })
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bushido-drafts-')); made.push(d); return path.join(d, 'drafts') }
const tick = () => new Promise(r => setImmediate(r))

/** A planner the test drives: each call waits until resolved or rejected. */
function fakePlanner() {
  const calls = []
  const fn = (args) => new Promise((resolve, reject) => { calls.push({ ...args, resolve, reject }) })
  return { fn, calls }
}
const PLAN = (extra = {}) => ({ plan: { title: 'Legs', minutes: 40, why: 'because', blocks: [{ name: 'Main', items: [{ kind: 'lift', name: 'Squat', sets: [{ reps: 5 }] }] }], ...extra } })
const ASK = { picked: [{ key: 'legs', label: 'Legs', prompt: 'a leg day', category: 'strength', activity: 'lift' }], minutes: 45, goal: 'heavy', context: 'Today is x.' }

;(async () => {
  await step('a new draft is working, on disk, and becomes ready when the run ends', async () => {
    const dir = tmp(); const s = createDrafts(); const p = fakePlanner()
    const d = s.create(dir, ASK, p.fn)
    eq(d.status, 'working')
    ok(fs.existsSync(path.join(dir, `${d.id}.json`)), 'the draft is not a file in drafts/')
    await tick()
    eq(p.calls.length, 1); eq(p.calls[0].kind, 'write'); eq(p.calls[0].draft.ask.kinds, ['a leg day'])
    // A "reload" mid-run: a fresh read still says working.
    eq(s.read(dir, d.id).status, 'working', 'mid-run read')
    eq(s.list(dir).map(x => x.status), ['working'])
    p.calls[0].resolve(PLAN({ category: undefined }))
    await tick()
    const after = s.read(dir, d.id)
    eq(after.status, 'ready')
    eq(after.pres.title, 'Legs')
    eq(after.pres.category, 'strength', 'the first kind did not fill the category the model left blank')
    eq(after.pres.ask, { kinds: ['Legs'], minutes: 45, goal: 'heavy' })
    eq(after.pres.thread, [])
    // A "reload" after it finished: still there, still ready.
    eq(createDrafts().read(dir, d.id).status, 'ready', 'a finished draft did not survive a new reader')
  })

  await step('two drafts at once run and land independently', async () => {
    const dir = tmp(); const s = createDrafts(); const p = fakePlanner()
    const a = s.create(dir, ASK, p.fn)
    const b = s.create(dir, { ...ASK, goal: 'light' }, p.fn)
    await tick()
    eq(p.calls.length, 2)
    p.calls[1].resolve(PLAN({ title: 'Second' }))
    await tick()
    eq([s.read(dir, a.id).status, s.read(dir, b.id).status], ['working', 'ready'])
    p.calls[0].resolve(PLAN({ title: 'First' }))
    await tick()
    eq([s.read(dir, a.id).pres.title, s.read(dir, b.id).pres.title], ['First', 'Second'])
  })

  await step('a failed run is a draft with the error, and a retry', async () => {
    const dir = tmp(); const s = createDrafts(); const p = fakePlanner()
    const d = s.create(dir, ASK, p.fn)
    await tick()
    p.calls[0].reject(new Error('the planner took too long'))
    await tick()
    const f = s.read(dir, d.id)
    eq([f.status, f.error, f.pres], ['failed', 'the planner took too long', null])
    const again = s.retry(dir, d.id, p.fn)
    eq(again.status, 'working')
    await tick()
    eq(p.calls[1].kind, 'write')
    p.calls[1].resolve(PLAN())
    await tick()
    eq(s.read(dir, d.id).status, 'ready')
  })

  await step('a server restart mid-run leaves the draft failed with a retry, not working forever', async () => {
    const dir = tmp(); const before = createDrafts(); const p = fakePlanner()
    const d = before.create(dir, ASK, p.fn)
    await tick()
    const after = createDrafts()   // a new process: it holds no runs
    const f = after.read(dir, d.id)
    eq([f.status, f.error], ['failed', RESTARTED])
    eq(after.list(dir)[0].status, 'failed')
    after.retry(dir, d.id, p.fn)
    await tick()
    p.calls[1].resolve(PLAN({ title: 'Retried' }))
    await tick()
    // The old process's run ending late must not overwrite the retry.
    p.calls[0].resolve(PLAN({ title: 'Stale' }))
    await tick()
    eq(after.read(dir, d.id).pres.title, 'Retried')
  })

  await step('discarding a draft mid-run cancels the run and nothing comes back', async () => {
    const dir = tmp(); const s = createDrafts(); const p = fakePlanner()
    const d = s.create(dir, ASK, p.fn)
    await tick()
    eq(s.discard(dir, d.id), true)
    ok(p.calls[0].signal.aborted, 'the run was not cancelled')
    p.calls[0].resolve(PLAN())
    await tick()
    eq(s.read(dir, d.id), null, 'a discarded draft came back')
    eq(fs.readdirSync(dir), [])
  })

  await step('a revision puts the message on the thread now and the answer on it later', async () => {
    const dir = tmp(); const s = createDrafts(); const p = fakePlanner()
    const d = s.create(dir, ASK, p.fn)
    await tick(); p.calls[0].resolve(PLAN()); await tick()
    // The user changed the category on the review screen; it is theirs.
    const mine = { ...s.read(dir, d.id).pres, category: 'run', thread: [{ role: 'you', text: 'forged', at: 'x' }] }
    const w = s.revise(dir, d.id, { message: 'shorter', pres: mine }, p.fn)
    eq(w.status, 'working')
    eq(w.pres.thread.map(m => [m.role, m.text]), [['you', 'shorter']], 'the client rewrote the thread, or the message is not on it')
    await tick()
    eq(p.calls[1].kind, 'revise'); eq(p.calls[1].message, 'shorter')
    p.calls[1].resolve(PLAN({ title: 'Shorter', category: 'strength', changed: 'Cut a set.' }))
    await tick()
    const r = s.read(dir, d.id)
    eq([r.status, r.pres.title, r.pres.category], ['ready', 'Shorter', 'run'])
    eq(r.pres.thread.map(m => [m.role, m.text]), [['you', 'shorter'], ['coach', 'Cut a set.']])
  })

  await step('a failed revision keeps the plan, takes the message off the thread, and retries it', async () => {
    const dir = tmp(); const s = createDrafts(); const p = fakePlanner()
    const d = s.create(dir, ASK, p.fn)
    await tick(); p.calls[0].resolve(PLAN()); await tick()
    s.revise(dir, d.id, { message: 'more volume' }, p.fn)
    await tick(); p.calls[1].reject(new Error('box busy')); await tick()
    const f = s.read(dir, d.id)
    eq([f.status, f.error, f.pres.title, f.pres.thread.length, f.run.message], ['failed', 'box busy', 'Legs', 0, 'more volume'])
    s.retry(dir, d.id, p.fn)
    await tick()
    eq([p.calls[2].kind, p.calls[2].message], ['revise', 'more volume'])
    p.calls[2].resolve(PLAN({ changed: 'Added a set.' })); await tick()
    eq(s.read(dir, d.id).pres.thread.map(m => m.role), ['you', 'coach'])
  })

  await step('the user\'s edits are saved onto the draft, never while it is being written', async () => {
    const dir = tmp(); const s = createDrafts(); const p = fakePlanner()
    const d = s.create(dir, ASK, p.fn)
    await tick()
    let threw = null
    try { s.save(dir, d.id, { blocks: [] }) } catch (e) { threw = e.status }
    eq(threw, 409, 'saved over a draft being written')
    p.calls[0].resolve(PLAN()); await tick()
    const edited = { ...s.read(dir, d.id).pres, title: 'My legs' }
    s.save(dir, d.id, edited)
    eq(createDrafts().read(dir, d.id).pres.title, 'My legs')
  })

  await step('bounded: a cap per person, and an age limit', async () => {
    const dir = tmp(); let at = Date.parse('2026-10-01T00:00:00Z')
    const s = createDrafts({ max: 3, maxAgeMs: 1000, now: () => at }); const p = fakePlanner()
    const ids = []
    for (let i = 0; i < 3; i++) { at += 1; ids.push(s.create(dir, ASK, p.fn).id) }
    // All three are being written: a fourth is refused, nothing is evicted.
    let threw = null
    try { s.create(dir, ASK, p.fn) } catch (e) { threw = e.status }
    eq(threw, 429)
    await tick()
    p.calls[0].resolve(PLAN()); await tick()
    at += 1
    const fourth = s.create(dir, ASK, p.fn)
    eq(s.read(dir, ids[0]), null, 'the oldest finished draft did not make room')
    eq(s.list(dir).length, 3)
    // Age: finished drafts past the limit are gone; ones still being written stay.
    p.calls[1].resolve(PLAN()); await tick()
    at += 5000
    eq(s.list(dir).map(d => d.id).sort(), [ids[2], fourth.id].sort())
  })

  await step('kept once: a second keep is refused, a failed placement hands the claim back', async () => {
    const dir = tmp(); let at = Date.parse('2026-10-25T12:00:00Z')
    const s = createDrafts({ now: () => at }); const p = fakePlanner()
    const d = s.create(dir, ASK, p.fn)
    await tick(); p.calls[0].resolve(PLAN()); await tick()
    eq(s.keep(dir, d.id).status, 'ready')
    let threw = null
    try { s.keep(dir, d.id) } catch (e) { threw = e.status }
    eq(threw, 409, 'a second device kept the same draft')
    eq(s.list(dir).map(x => x.id), [], 'a draft being kept is still offered')
    s.keep(dir, d.id, { release: true })
    eq(s.list(dir).map(x => x.id), [d.id], 'a released draft did not come back')
    s.keep(dir, d.id)
    // A claim whose entry never turned up (the device died mid-keep) lapses.
    at += CLAIM_MS + 1
    eq(s.list(dir).map(x => x.id), [d.id], 'a lapsed claim hid the draft for good')
    s.discard(dir, d.id)
    threw = null
    try { s.keep(dir, d.id) } catch (e) { threw = e.status }
    eq(threw, 404, 'a draft kept and discarded elsewhere could be kept again')
  })

  await step('a draft whose id is on an entry is kept: not listed, not keepable, deleted', async () => {
    const dir = tmp(); const s = createDrafts(); const p = fakePlanner()
    const a = s.create(dir, ASK, p.fn); const b = s.create(dir, ASK, p.fn)
    await tick(); p.calls[0].resolve(PLAN()); p.calls[1].resolve(PLAN()); await tick()
    // An offline keep: the entry synced, the discard never arrived.
    const kept = keptIdsIn({ entries: {
      'daily-2026-10-25': { data: { plan: { draftId: a.id } } },
      'daily-2026-10-24': { data: { plan: {} } },
    } })
    eq([...kept], [a.id])
    const isKept = (id) => kept.has(id)
    eq(s.list(dir, { isKept }).map(x => x.id), [b.id])
    eq(s.read(dir, a.id), null, 'the kept draft was not deleted')
    let threw = null
    try { s.keep(dir, b.id, { isKept: () => true }) } catch (e) { threw = e.status }
    eq(threw, 409)
  })

  await step('ids off the wire cannot climb out of the folder', async () => {
    const dir = tmp(); const s = createDrafts()
    eq(s.read(dir, '../state'), null)
    eq(s.discard(dir, '../../state.json'), false)
  })

  if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
  console.log('\ndrafts ok')
})()
