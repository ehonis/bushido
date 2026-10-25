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

if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
console.log('\nprompts ok')
