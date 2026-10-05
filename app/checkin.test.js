#!/usr/bin/env node
/*
 * The check-in's pure half.
 *
 * The card is a conversation, so the things worth pinning are the ones where
 * losing data is silent: a slider drag that eats the thread, a bodyweight that
 * stops reaching the series it has been in since the first week of the block,
 * a message written only if the network answered.
 *
 * Run: npm run test:checkin  (from app/)
 */

import { readFileSync } from 'node:fs'
import {
  DEFAULT_FIELDS, bodyweightEntry, checkinFields, checkinFor, checkinId, checkinLine,
  dayContext, dayFacts, messagesOf, summarise, venuePhrase, withFields, withMessage, withTaken,
} from './src/lib/checkin.js'

const plan = JSON.parse(readFileSync(new URL('../test/fixtures/plan.json', import.meta.url), 'utf8'))

let failed = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(ok ? `  ok    ${label}` : `  FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`)
}
const ok = (label, cond) => {
  if (!cond) failed++
  console.log(cond ? `  ok    ${label}` : `  FAIL  ${label}`)
}

const ISO = '2026-08-13'

console.log('\nthe fields are content')

const fields = checkinFields(plan)
ok('the real plan defines them', fields.length >= 2 && fields !== DEFAULT_FIELDS)
ok('every field has a key and a label', fields.every(f => f.key && f.label))
ok('every field is optional — a check-in you can fail to finish is a form',
  fields.every(f => f.optional))
ok('sliders carry their range', fields.filter(f => f.type === 'slider')
  .every(f => Number.isFinite(f.min) && Number.isFinite(f.max) && f.scale?.length))
ok('choices carry their options', fields.filter(f => f.type === 'choice')
  .every(f => f.options?.length && f.options.every(o => o.value && o.label)))
eq('exactly one field writes the bodyweight series',
  fields.filter(f => f.writes === 'bodyweight').length, 1)
eq('a plan that has not loaded still asks something', checkinFields(null), DEFAULT_FIELDS)
eq('...and so does one with an empty block', checkinFields({ checkin: { fields: [] } }), DEFAULT_FIELDS)

console.log('\nthe entry')

const entries = [
  { id: checkinId(ISO), kind: 'checkin', date: ISO, data: { fields: { feeling: 7 },
    messages: [{ role: 'you', text: 'no gym tonight', at: 'z' }] } },
  { id: 'checkin-2026-08-12', kind: 'checkin', date: '2026-08-12', data: {} },
  { id: 'gone', kind: 'checkin', date: ISO, deleted: true, data: {} },
]

eq('one check-in per day, found by date', checkinFor(entries, ISO).id, checkinId(ISO))
eq('a tombstoned one is gone', checkinFor([entries[2]], ISO), null)
eq('a day with none is null', checkinFor(entries, '2026-01-01'), null)

{
  const entry = checkinFor(entries, ISO)
  const next = withFields(entry, ISO, { ...entry.data.fields, weightLb: 150 })
  eq('changing a field keeps the thread', next.data.messages.length, 1)
  eq('...and the id, so two devices cannot fork it', next.id, checkinId(ISO))

  const said = withMessage(next, ISO, { role: 'you', text: 'actually going Sunday' })
  eq('a message appends', said.data.messages.map(m => m.text),
    ['no gym tonight', 'actually going Sunday'])
  eq('...and the fields are still there', said.data.fields.weightLb, 150)
  ok('a message is stamped', Boolean(said.data.messages.at(-1).at))
}

{
  const junk = { data: { messages: [
    { role: 'you', text: 'real' },
    { role: 'you', text: '   ' },
    null,
    { role: 'coach', text: 'also real', applied: [{ optId: 'crawls', points: 10 }, null] },
  ] } }
  const out = messagesOf(junk)
  eq('empty messages never render', out.map(m => m.text), ['real', 'also real'])
  eq('a nudge with no session is not shown as a change', out[1].applied.length, 1)
}

console.log('\nbodyweight stays a series')

eq('a weight writes the same entry the charts read',
  bodyweightEntry({ weightLb: 150 }, fields, ISO),
  { id: `bodyweight-${ISO}`, kind: 'bodyweight', date: ISO, data: { lb: 150 } })
eq('correcting it rewrites the day rather than adding a second point',
  bodyweightEntry({ weightLb: 151 }, fields, ISO).id,
  bodyweightEntry({ weightLb: 150 }, fields, ISO).id)
eq('no weight, no entry', bodyweightEntry({}, fields, ISO), null)
eq('nonsense is not a weight', bodyweightEntry({ weightLb: 0 }, fields, ISO), null)
eq('a plan with no bodyweight field writes nothing',
  bodyweightEntry({ weightLb: 150 }, [{ key: 'feeling', type: 'slider' }], ISO), null)

{
  // The Log tab renders anything nothing claims as raw JSON, and a check-in is
  // a new kind reaching it.
  const entry = { kind: 'checkin', date: ISO, data: { fields: { weightLb: 150, feeling: 4 },
    messages: [{ role: 'you', text: 'no gym tonight' }, { role: 'coach', text: 'Then it is the crawls.' }] } }
  const line = checkinLine(entry, plan)
  ok('history reads as a line', line.includes('150 lb') && line.includes('2 messages'))
  ok('...not as JSON', !line.includes('{'))
  eq('an empty check-in says so', checkinLine({ kind: 'checkin', data: {} }, plan), 'nothing filled in')
}

console.log('\nwhat the coach is told about the day')

{
  const summary = summarise({ weightLb: 150, feeling: 7, where: 'home', minutes: undefined }, fields)
  ok('the summary reads as a line, not a form', summary.join(' · ').includes('150 lb'))
  ok('a slider reads out of its own scale', summary.some(s => /7\/10/.test(s)))
  ok('a choice reads as its label', summary.includes('home'))
  ok('an unfilled field says nothing at all', !summary.join(' ').includes('undefined'))
}

{
  const menu = plan.dailyMenu
  const ctx = dayContext({
    rec: { opt: menu.find(m => m.id === 'crawls'), why: 'The pump work is owed.',
      reasons: [{ points: 22, text: 'The week template says so.' }, { points: -20, text: 'Day after a hard day.' }],
      displaced: { opt: menu.find(m => m.id === 'board'), why: 'Needs the gym.' } },
    mainEntry: { data: { optId: 'crawls', name: 'Crimp crawls', slot: 'main', done: false } },
    extraEntries: [{ data: { optId: 'hips', name: 'Hip Abduction Block', slot: 'extra', done: true } }],
    menu, iso: ISO,
  })
  eq('the coach is told what the app recommends', ctx.recommended.optId, 'crawls')
  eq('...with the engine\'s own arithmetic', ctx.reasons[0], '+22: The week template says so.')
  eq('...including what got ruled out', ctx.displaced.optId, 'board')
  eq('...and what is already on the day', ctx.onDay.map(d => d.optId), ['crawls', 'hips'])
  eq('planning is not completing here either', ctx.onDay[0].done, false)
}

eq('a day with no recommendation at all does not crash',
  dayContext({ rec: null, menu: plan.dailyMenu, iso: ISO }).recommended, null)

eq('the coach is shown the same facts the engine is scoring with',
  dayContext({ rec: null, menu: plan.dailyMenu, iso: ISO,
    facts: { venue: 'home', window: 50, fingers: 1 } }).facts.venue, 'home')

console.log('\nthe fields the engine reads')

/*
 * The bug these exist for: a check-in set to home and 50 minutes, with a message
 * saying the gym was out, and the day list went on leading with a 75-minute gym
 * session. The fields were collected, shown to the coach, and read by nothing.
 */

{
  const withFacts = (f) => [{ id: checkinId(ISO), kind: 'checkin', date: ISO, data: { fields: f } }]

  eq('where he is, how long he has, how his fingers read',
    dayFacts({ plan, entries: withFacts({ where: 'home', minutes: 50, fingers: 1 }), iso: ISO }),
    { venue: 'home', window: 50, fingers: 1 })

  eq('a day he has not checked in on states nothing',
    dayFacts({ plan, entries: [], iso: ISO }), { venue: null, window: null, fingers: null })

  eq('...and neither does a half-filled one',
    dayFacts({ plan, entries: withFacts({ feeling: 7 }), iso: ISO }),
    { venue: null, window: null, fingers: null })

  eq('nonsense is not a fact',
    dayFacts({ plan, entries: withFacts({ minutes: -3, where: '  ', fingers: 'x' }), iso: ISO }),
    { venue: null, window: null, fingers: null })

  // Which field means what is content. A plan that declares none of them leaves
  // the engine computing exactly what it computed before this existed.
  eq('a plan that declares no informs says nothing either',
    dayFacts({ plan: { checkin: { fields: [{ key: 'where', type: 'choice', optional: true }] } },
      entries: withFacts({ where: 'home' }), iso: ISO }),
    { venue: null, window: null, fingers: null })

  eq('a venue reads as a phrase, not a glued-in label', venuePhrase(plan, 'gym'), 'at the gym')
  ok('...and an unnamed one still reads', venuePhrase(plan, 'crag') === 'at the crag')
}

console.log('\nwhat the coach put in front of him')

{
  const entry = { data: { messages: [
    { role: 'coach', text: 'Crimp crawls then.', suggested: [
      { action: 'main', optId: 'crawls', why: 'home tonight' },
      { action: 'add', optId: 'core', why: 'never logged' },
      { action: 'burn-it-down', optId: 'crawls', why: 'not a button' },
      { optId: '', action: 'main', why: 'no session' },
    ] },
  ] } }

  const [msg] = messagesOf(entry)
  eq('only real actions render as offers', msg.suggested.map(s => s.action), ['main', 'add'])
  eq('an offer is an offer until he presses it', msg.suggested[0].taken, null)
  eq('...and junk in `taken` is not a tap', messagesOf({ data: { messages: [
    { role: 'coach', text: 'x', suggested: [{ action: 'main', optId: 'crawls', why: 'w', taken: {} }] },
  ] } })[0].suggested[0].taken, null)
}

{
  // The stored index, not the rendered one. Taking a suggestion writes back to
  // the message that offered it, and a junk message dropped in between would
  // shift every index after it and mark the wrong one.
  const entry = { data: { fields: { where: 'home' }, messages: [
    { role: 'you', text: 'no gym tonight' },
    { role: 'you', text: '   ' },
    { role: 'coach', text: 'Crimp crawls then.',
      suggested: [{ action: 'main', optId: 'crawls', why: 'home tonight' }] },
  ] } }
  const rendered = messagesOf(entry)
  eq('a message knows where it is stored', rendered.map(m => m.i), [0, 2])

  const took = withTaken(entry, ISO, rendered[1].i, 0, { action: 'main', optId: 'crawls', prevOptId: 'board' })
  eq('taking one records what it displaced', took.data.messages[2].suggested[0].taken.prevOptId, 'board')
  eq('...and does not touch the rest of the thread', took.data.messages.length, 3)
  eq('...and keeps the fields', took.data.fields.where, 'home')
  eq('...and writes the same entry id, so two devices cannot fork it', took.id, checkinId(ISO))

  const back = withTaken(took, ISO, rendered[1].i, 0, null)
  eq('undoing puts the offer back on the table', back.data.messages[2].suggested[0].taken, null)
  eq('...and the offer itself survives', back.data.messages[2].suggested[0].optId, 'crawls')
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks pass')
process.exit(failed ? 1 : 0)
