/*
 * Every AI prompt, built the way a fresh install builds it: no name, no notes.
 * None may assume the athlete's gender or carry the original user's name, and a
 * name set in Settings → About you must reach each of them.
 * Run: node server/prompts.test.js
 */
const path = require('path')
const coach = require('./coach.js')
const planner = require('./planner.js')
const weekplanner = require('./weekplanner.js')
const chat = require('./chat.js')

let failed = 0
const check = (name, fn) => {
  try { fn(); console.log('  ok   ', name) } catch (e) { failed++; console.log('  FAIL ', name, '\n         ', e.message) }
}
const ok = (v, m) => { if (!v) throw new Error(m || 'expected truthy') }

const ROOT = path.resolve(__dirname, '..')
const starter = require('../content/starter.json')
const ctx = { repoRoot: '/srv/app', dataDir: '/srv/app/data', brainFile: '/b/projects/profile.md', today: '2026-10-02', plan: starter }
const thread = { messages: [{ role: 'user', text: 'legs today?' }, { role: 'coach', text: 'yes' }] }
const chatBase = {
  instructions: '', brain: 'profile', plan: starter, state: { entries: {} }, note: null,
  whoop: { today: null, days: [] }, strava: { weeks: [], activities: [] },
  request: { date: '2026-10-02', messages: [{ role: 'you', text: 'hi' }], fields: {}, today: {} },
}

/* Prompt text only: a gendered pronoun or the original name anywhere in it. */
const GENDERED = /\b(he|his|him|himself|she|her|hers|herself|ethan)\b/i

function prompts(name, notes) {
  return {
    'coach system': coach.systemPrompt({ ...ctx, krakatoaDir: '/k', name, notes }),
    'coach turn': coach.conversationPrompt(thread, 'and tomorrow?', 'Today is Friday.', name),
    'planner system': planner.systemPrompt({ ...ctx, name, notes }),
    'planner turn': planner.userPrompt({ kinds: ['legs', 'core'], minutes: 45, goal: '' }),
    'planner revise': planner.revisePrompt({ plan: { blocks: [] }, message: 'shorter', thread: [{ role: 'you', text: 'hm' }], name }),
    'week system': weekplanner.systemPrompt({ ...ctx, name, notes }),
    'week turn': weekplanner.userPrompt({ monday: '2026-10-05', counts: { run: 2 }, message: 'more', thread: [{ role: 'you', text: 'x' }], plan: starter, name }),
    'check-in (dormant)': chat.buildPrompt({ ...chatBase, name }),
  }
}

/* The schemas' descriptions are sent to the model too. */
const schemas = {
  'planner schema': planner.PLAN_SCHEMA,
  'planner revise schema': planner.REVISE_SCHEMA,
  'week schema': weekplanner.WEEK_SCHEMA,
  'coach schema': coach.REPLY_SCHEMA,
}

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
  ok(p['coach system'].includes("the athlete's training and health coach"), 'coach')
  ok(p['planner system'].includes('ONE workout for the athlete'), 'planner')
  ok(p['week system'].includes('quotas with the athlete'), 'week planner')
  // The system prompts only: the check-in carries JSON digests where null is data.
  const prose = ['coach system', 'planner system', 'week system', 'planner revise', 'week turn'].map(k => p[k]).join('\n')
  ok(!/\bundefined\b|\bnull\b/.test(prose), 'an empty value leaked into a prompt')
})

check('a name from Settings reaches every prompt that addresses the athlete', () => {
  const p = prompts('Sam', 'Marathon in May.')
  for (const k of ['coach system', 'coach turn', 'planner system', 'planner revise', 'week system', 'week turn']) {
    ok(p[k].includes('Sam'), `${k} does not use the name`)
  }
  ok(p['check-in (dormant)'].includes('SAM: hi'), 'the check-in transcript does not use the name')
  for (const k of ['coach system', 'planner system', 'week system']) {
    ok(p[k].includes('Marathon in May.'), `${k} drops the notes`)
  }
})

if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
console.log('\nprompts ok')
