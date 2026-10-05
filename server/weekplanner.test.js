/* The week planner, tested as arithmetic and as a contract:
 *   node server/weekplanner.test.js
 *
 * The model is not run here. What is pinned is what goes UP (the prompt names the
 * rules the agent may not break and the categories it may use) and what comes
 * DOWN (an invented category is dropped, a count is a whole number, and zero is
 * absence rather than a stored zero).
 */

const { WEEK_SCHEMA, systemPrompt, userPrompt, toCounts } = require('./weekplanner.js')
const plan = require('../test/fixtures/plan.json')

let failed = 0
const check = (name, fn) => {
  try { fn(); console.log('  ok   ', name) } catch (e) { failed++; console.log('  FAIL ', name, '\n         ', e.message) }
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }
const ok = (v, m) => { if (!v) throw new Error(m || 'expected truthy') }

const ctx = { repoRoot: '/r', brainFile: '/b/projects/bushido.md', today: '2026-09-19', plan }

check('the schema returns the WHOLE week and says what changed', () => {
  eq(WEEK_SCHEMA.required.sort(), ['changed', 'counts', 'reply'])
  ok(WEEK_SCHEMA.properties.counts.items.additionalProperties === false, 'rows are closed objects')
})

check('the system prompt names every category key and both finger rules', () => {
  const s = systemPrompt(ctx)
  for (const c of plan.quotaCategories) ok(s.includes(`${c.key} —`), `${c.key} is not offered`)
  ok(/never two on consecutive days/i.test(s), 'the spacing rule is missing')
  ok(new RegExp(`At most ${plan.recommender.hardCap} hard finger days`).test(s), 'the cap is not the plan\'s')
  ok(/bread and butter/i.test(s), 'zone 2 volume is not stated as the default')
  ok(s.includes('/r/data/state.json') && s.includes('/b/projects/bushido.md'), 'it is not told where to look')
})

check('the user prompt carries his draft, his thread and his message', () => {
  const s = userPrompt({
    monday: '2026-09-21', counts: { bike: 3, run: 0, pe: 2 }, message: 'more swimming',
    thread: [{ role: 'you', text: 'draft it' }, { role: 'coach', text: 'done' }],
    context: 'Today is 2026-09-19.', plan, name: 'Sam',
  })
  ok(s.includes('Monday 2026-09-21'), 'no week')
  ok(s.includes('bike (Bike): 3') && s.includes('pe (Power endurance): 2'), 'the draft is not listed by name')
  ok(!s.includes('run (Run): 0'), 'a zero row is not a row')
  ok(s.includes('Sam: draft it') && s.includes('You: done'), 'the thread is missing')
  ok(s.includes('Sam says:\nmore swimming'), 'his message is missing')
})

check('with no name set, the transcript uses a neutral label', () => {
  const s = userPrompt({ monday: '2026-09-21', counts: {}, message: 'hi', plan })
  ok(s.includes('Athlete says:\nhi') && !s.includes('Ethan'), 'a fresh install must not use a hard-coded name')
})

check('the owner\'s notes reach the prompt, and no personal facts are built in', () => {
  const bare = systemPrompt({ ...ctx, brainFile: null, plan: require('../content/starter.json') })
  ok(!/Ethan|Ironman|5\.12a|new runner/.test(bare), 'a personal fact is hard-coded in the prompt')
  ok(!bare.includes('null'), 'a missing brain file leaks into the prompt')
  const told = systemPrompt({ ...ctx, name: 'Sam', notes: 'Marathon in May.' })
  ok(told.includes('Marathon in May.') && told.includes('Sam'), 'the notes are not passed on')
})

check('an empty draft says so rather than listing nothing', () => {
  ok(userPrompt({ monday: '2026-09-21', counts: {}, message: 'x', plan }).includes('nothing set yet'))
})

check('toCounts keeps real categories, whole numbers, and drops zero', () => {
  eq(toCounts([
    { category: 'bike', count: 3 },
    { category: 'run', count: 1.6 },
    { category: 'cardio', count: 4 },      // invented — must not become a quota
    { category: 'swim', count: 0 },        // zero is absence
    { category: 'pe', count: -2 },
    { category: 'lift', count: 99 },       // clamped
  ], plan), { bike: 3, run: 2, lift: 14 })
})

check('toCounts survives garbage', () => {
  eq(toCounts(null, plan), {})
  eq(toCounts([null, 'bike', { count: 2 }, { category: 'bike' }], plan), {})
})

console.log(failed ? `\n${failed} failed` : '\nweek planner ok')
process.exit(failed ? 1 : 0)
