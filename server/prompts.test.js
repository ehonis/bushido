/*
 * Every AI prompt, built the way a fresh install builds it: no name, no notes.
 * Since 2026-10-25 (issue #31) that is the workout planner alone: the coach, the
 * check-in and the week planner were removed.
 * None may assume the athlete's gender or carry the original user's name, and a
 * name set in Settings → About you must reach each of them.
 * Run: node server/prompts.test.js
 */
const path = require('path')
const planner = require('./planner.js')

let failed = 0
const check = (name, fn) => {
  try { fn(); console.log('  ok   ', name) } catch (e) { failed++; console.log('  FAIL ', name, '\n         ', e.message) }
}
const ok = (v, m) => { if (!v) throw new Error(m || 'expected truthy') }

const ROOT = path.resolve(__dirname, '..')
const starter = require('../content/starter.json')
const ctx = { repoRoot: '/srv/app', dataDir: '/srv/app/data', brainFile: '/b/projects/profile.md', today: '2026-10-02', plan: starter }

/* Prompt text only: a gendered pronoun or the original name anywhere in it. */
const GENDERED = /\b(he|his|him|himself|she|her|hers|herself|ethan)\b/i

function prompts(name, notes) {
  return {
    'planner system': planner.systemPrompt({ ...ctx, name, notes }),
    'planner turn': planner.userPrompt({ kinds: ['legs', 'core'], minutes: 45, goal: '' }),
    'planner revise': planner.revisePrompt({ plan: { blocks: [] }, message: 'shorter', thread: [{ role: 'you', text: 'hm' }], name }),
  }
}

/* The schemas' descriptions are sent to the model too. */
const schemas = {
  'planner schema': planner.PLAN_SCHEMA,
  'planner revise schema': planner.REVISE_SCHEMA,
}

check('a revision can hand back each block\'s and exercise\'s uid, and is told to', () => {
  const item = planner.REVISE_SCHEMA.properties.blocks.items.properties.items.items
  const block = planner.REVISE_SCHEMA.properties.blocks.items
  if (item.properties.uid?.type !== 'string' || block.properties.uid?.type !== 'string') throw new Error('the reply schema has no uid, so a revision cannot keep one')
  if (item.required.includes('uid') || block.required.includes('uid')) throw new Error('uid must be optional: a new exercise has none')
  if (!/keeps its `uid`/.test(planner.revisePrompt({ plan: { blocks: [] }, message: 'shorter', thread: [] }))) throw new Error('the revise prompt does not ask for the uid back')
})

check('the shared exercise library reaches the planner as keys, holds named as timed (#63)', () => {
  const { mergeLibrary } = require('./library.js')
  const lib = require('../test/fixtures/exercises.json')
  const text = planner.systemPrompt({ ...ctx, plan: mergeLibrary(starter, lib), name: '', notes: '' })
  ok(/couch-stretch/.test(text), 'a library-only exercise is not offered')
  const timed = text.split('TIMED EXERCISES')[1]?.split('\n')[1] || ''
  ok(/\bplank\b/.test(timed) && /\bcouch-stretch\b/.test(timed) && /\bwall-sit\b/.test(timed), `the holds are not named as timed: ${timed}`)
  ok(!/\bdead-bug\b/.test(timed), 'a reps exercise was called timed')
  ok(!/TIMED EXERCISES/.test(planner.systemPrompt({ ...ctx, name: '', notes: '' })), 'a catalog with no holds still talks about them')
  const m = text.match(GENDERED)
  ok(!m, `the library brought a gendered word into the prompt: ${m && m[0]}`)
})

check('no prompt assumes a gender or names the original user', () => {
  const bad = []
  for (const [k, text] of Object.entries(prompts('', ''))) {
    const m = text.match(GENDERED)
    if (m) bad.push(`${k}: "${text.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\n/g, ' ')}"`)
  }
  for (const [k, schema] of Object.entries(schemas)) {
    const m = JSON.stringify(schema).match(GENDERED)
    if (m) bad.push(`${k}: "${m[0]}"`)
  }
  ok(!bad.length, bad.join('\n          '))
})

check('with no name, the prompts say "the athlete" rather than a blank', () => {
  const p = prompts('', '')
  ok(p['planner system'].includes('ONE workout for the athlete'), 'planner')
  const prose = ['planner system', 'planner revise'].map(k => p[k]).join('\n')
  ok(!/\bundefined\b|\bnull\b/.test(prose), 'an empty value leaked into a prompt')
})

check('a name from Settings reaches every prompt that addresses the athlete', () => {
  const p = prompts('Sam', 'Marathon in May.')
  for (const k of ['planner system', 'planner revise']) {
    ok(p[k].includes('Sam'), `${k} does not use the name`)
  }
  for (const k of ['planner system']) {
    ok(p[k].includes('Marathon in May.'), `${k} drops the notes`)
  }
})

/*
 * Someone else's runs: their own log path, their name and notes, and no section
 * for the owner's sources at all (§7: absent data means no section). Built as the
 * server builds them for anyone but the owner (`aiRun`): no brain file, no food
 * log, no WHOOP or Strava, `logDir` their own space.
 */
function someoneElse(name, notes) {
  const c = { repoRoot: '/srv/app', dataDir: '/srv/app/data', logDir: '/srv/app/data/users/sam', brainFile: null,
    today: '2026-10-02', plan: starter, name, notes, measurements: false }
  return {
    'planner system': planner.systemPrompt(c),
  }
}

check('someone else\'s prompts point at their own log and carry their own About you', () => {
  for (const [k, text] of Object.entries(someoneElse('Sam', 'Knee rehab.'))) {
    ok(text.includes('/srv/app/data/users/sam/state.json'), `${k} does not point at their log`)
    ok(!text.includes('/srv/app/data/state.json'), `${k} points at the owner's log`)
    ok(text.includes('Sam') && text.includes('Knee rehab.'), `${k} drops their name or notes`)
  }
})

check('someone else\'s prompts have no brain, food-log, WHOOP or Strava section', () => {
  for (const [k, text] of Object.entries(someoneElse('', ''))) {
    for (const never of ['whoop.json', 'strava.json', 'digest.json', 'athlete profile', 'notebook', 'WHAT YOU MAY WRITE\n\nYou may append']) {
      ok(!text.includes(never), `${k} mentions ${never}`)
    }
    const m = text.match(GENDERED)
    ok(!m, `${k} assumes a gender: "${m && text.slice(Math.max(0, m.index - 40), m.index + 40)}"`)
    ok(!/\bundefined\b|\bnull\b/.test(text), `${k}: an empty value leaked into a prompt`)
  }
})

check('the planner picks a sport from what was logged, never from a quota', () => {
  // The quotas were removed on 2026-10-25 (issue #31); the client sends the last
  // week's workouts instead (plannerContext in app/src/lib/plannerapi.js).
  const p = prompts('', '')
  const all = [p['planner system'], JSON.stringify(schemas['planner schema'])].join('\n')
  ok(!/quota|still owes|week owes/i.test(all), `quota language in the planner: ${all.match(/.{40}(quota|owes).{40}/i)?.[0]}`)
  ok(/done LEAST in the last week/.test(p['planner system']), 'the planner is not told how to pick a sport')
})

/*
 * One session for several people (#59): an owner run that names each of them and
 * carries each one's notes, asks for one structure with no loads in it, and still
 * says nothing gendered. Without the owner in it, no path to the owner's log,
 * brain or measurements at all.
 */
const GROUP = [{ id: 'owner', name: '', notes: '', owner: true }, { id: 'sam', name: 'Sam', notes: 'Knee rehab.', owner: false }]
check('a plan for several people names each, carries each one\'s notes, and asks for no loads', () => {
  const text = planner.systemPrompt({ ...ctx, name: '', notes: '', group: GROUP })
  ok(text.includes('ONE workout for the athlete and Sam'), 'the people are not named')
  ok(text.includes('Knee rehab.'), 'Sam\'s notes are not in it')
  ok(/MORE THAN ONE PERSON/.test(text) && /Leave `weight` out of every set/.test(text), 'it is not told the plan is shared structure')
  // One story about loads: none of the one-person wording that asks for them.
  for (const never of ['every load a number', 'Load comes from the log', 'write 3×8 at 100']) ok(!text.includes(never), `the group prompt still says "${never}"`)
  ok(planner.systemPrompt({ ...ctx, name: '', notes: '' }).includes('every load a number'), 'the one-person prompt lost its loads')
  ok(text.includes('/srv/app/data/state.json'), 'the owner\'s own log is not offered')
  const m = text.match(GENDERED)
  ok(!m, `a gendered word: "${m && text.slice(Math.max(0, m.index - 40), m.index + 40)}"`)
  ok(!/\bundefined\b|\bnull\b/.test(text), 'an empty value leaked into a prompt')
  const rev = planner.revisePrompt({ plan: { blocks: [] }, message: 'shorter', thread: [], name: 'Alex and Sam' })
  ok(!rev.match(GENDERED), 'the group revision is gendered')
})

check('a plan for others only points at nobody\'s log, brain or measurements', () => {
  const others = [{ id: 'sam', name: 'Sam', notes: '' }, { id: 'robin', name: 'Robin', notes: 'New to lifting.' }]
  const text = planner.systemPrompt({ ...ctx, brainFile: null, measurements: false, name: '', notes: '', group: others })
  for (const never of ['state.json', 'whoop.json', 'strava.json', 'athlete profile']) ok(!text.includes(never), `it mentions ${never}`)
  ok(text.includes('Sam and Robin') && text.includes('New to lifting.'), 'the people or their notes are missing')
  for (const never of ['every load a number', 'Load comes from the log']) ok(!text.includes(never), `others-only still says "${never}"`)
  ok(!text.match(GENDERED), 'gendered')
})

check('a prompt alone is a brief: no kinds, and the model picks the blocks and categories', () => {
  const text = planner.userPrompt({ kinds: [], minutes: 40, goal: 'legs then a short run', context: '' })
  ok(text.includes('"legs then a short run"'), 'what they wrote is not the brief')
  ok(/did not pick a kind/.test(text) && /`category` and `activity`/.test(text), 'the model is not told to choose the blocks\' categories')
  ok(text.includes('40 minutes'), 'the time budget is missing')
  ok(!/\bundefined\b|\bnull\b/.test(text) && !text.match(GENDERED), 'a bad value or a gendered word')
  ok(/a workout/.test(planner.userPrompt({ kinds: [], minutes: 30, goal: '' })), 'an empty brief says nothing')
})

check('a plan for several people carries no loads, whatever the model wrote', () => {
  const out = planner.noLoads({ blocks: [{ name: 'A', items: [{ kind: 'lift', name: 'Squat', sets: [{ reps: 5, weight: 135 }, { reps: 5 }] }] }] })
  const sets = out.blocks[0].items[0].sets
  ok(sets.every(s => !('weight' in s)) && sets[0].reps === 5, JSON.stringify(sets))
})

check('a block\'s category or activity the content does not know is dropped, not failed', () => {
  const cat = starter.quotaCategories[0].key
  const act = planner.activityField(starter).activities[0].key
  const out = planner.realKeys({ title: 'x', category: 'made-up', activity: act, blocks: [
    { name: 'A', category: cat, activity: 'nonsense', items: [] },
    { name: 'B', category: 'nope', items: [] },
  ] }, starter)
  ok(!('category' in out) && out.activity === act, `the session: ${JSON.stringify(out)}`)
  ok(out.blocks[0].category === cat && !('activity' in out.blocks[0]), `block A: ${JSON.stringify(out.blocks[0])}`)
  ok(!('category' in out.blocks[1]) && out.blocks.length === 2, 'block B was dropped, or kept its bad key')
  // A content file with no lists checks nothing.
  ok(planner.realKeys({ category: 'x', blocks: [] }, {}).category === 'x', 'an unknowable key was dropped')
})

check('a block can be a timed circuit (#68): the schema takes its timing, the prompt says how, loads still go', () => {
  for (const schema of [planner.PLAN_SCHEMA, planner.REVISE_SCHEMA]) {
    const c = schema.properties.blocks.items.properties.circuit
    ok(c && c.type === 'object', 'no circuit on a block in the reply schema')
    for (const k of ['work', 'rest', 'rounds', 'roundRest', 'countIn']) ok(c.properties[k]?.type === 'number', `no ${k} on a circuit`)
    ok(!schema.properties.blocks.items.required.includes('circuit'), 'every block would have to be a circuit')
  }
  const text = planner.systemPrompt({ ...ctx, name: '', notes: '' })
  ok(/A CIRCUIT is a block/.test(text) && /never repeat a set per round/.test(text), 'the prompt does not say how to write a circuit')
  const built = { blocks: [{ name: 'Core', circuit: { work: 40, rest: 20, rounds: 3 }, items: [{ kind: 'lift', name: 'x', sets: [{ weight: 20 }, {}] }] }] }
  const stripped = planner.noLoads(built)
  ok(stripped.blocks[0].circuit.rounds === 3, 'taking the loads out took the circuit')
  ok(!JSON.stringify(stripped).includes('"weight"'), 'a load survived on a circuit for several people')
})

if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
console.log('\nprompts ok')
