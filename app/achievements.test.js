/* Achievements — the seeds, the user's edits, and the merge between them:
 *   node app/achievements.test.js
 *
 * Added 2026-09-15 when "goals" was renamed and became editable. Run against the
 * REAL plan.json, because the seeds and their category lists are the fixture that
 * matters — a made-up plan would not catch a category key being renamed out from
 * under an achievement.
 *
 * The merge is the part worth testing hard. It is the only place in the app where
 * a content file and the synced log both have an opinion about the same object,
 * and the failure mode is silent: a seeded achievement the user edited on another
 * device quietly reverting to plan.json's copy the next time the page loads.
 */

import { readFileSync } from 'node:fs'
import {
  achievements, achievementOf, categorySet, unclaimed,
  buildEntry, buildTombstone, entryIdFor, idFor, blank, KIND,
} from './src/lib/achievements.js'

const url = (p) => new URL(p, import.meta.url)
const plan = JSON.parse(readFileSync(url('../test/fixtures/plan.json'), 'utf8'))

let failed = 0
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`) }
  catch (err) { failed++; console.error(`  FAIL  ${name}\n        ${err.message}`) }
}
const eq = (got, want, what = '') => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error(`${what || 'value'}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
  }
}
const ok = (cond, what) => { if (!cond) throw new Error(what || 'expected true') }

/* ------------------------------------------------------------- the seeds */

check('plan.json seeds both achievements, and the old key is gone', () => {
  ok(Array.isArray(plan.achievements), 'plan.achievements is missing')
  ok(!('goals' in plan), 'plan.json still has a `goals` key')
  eq(plan.achievements.map(a => a.id), ['climb-12a', 'half-iron'])
})

check('the back-reference is gone and nothing needs it', () => {
  // `achievement.categories` is the only direction now. A leftover `goal` on a
  // category would be a second, silently diverging source of truth.
  for (const c of plan.quotaCategories) ok(!('goal' in c), `${c.key} still carries a goal`)
})

check('with no entries the seeds come through intact', () => {
  const list = achievements(plan, [])
  eq(list.map(a => a.id), ['climb-12a', 'half-iron'])
  eq(list[0].name, 'Climb 5.12a')
  eq(list.every(a => a.seeded), true, 'both should be marked as coming with the app')
  eq([...categorySet(list, 'half-iron')].sort(), ['bike', 'run', 'swim'])
})

check('every category a seed claims actually exists', () => {
  const keys = new Set(plan.quotaCategories.map(c => c.key))
  for (const a of plan.achievements) {
    for (const k of a.categories) ok(keys.has(k), `${a.id} claims a missing category ${k}`)
  }
})

check('no category is claimed twice', () => {
  // `achievementOf` returns the first match, so two owners would mean the Week
  // tab silently filed a category under whichever happened to be earlier.
  for (const c of plan.quotaCategories) {
    const owners = plan.achievements.filter(a => a.categories.includes(c.key))
    ok(owners.length <= 1, `${c.key} is claimed by ${owners.map(o => o.id)}`)
  }
})

check('lift, support and misc belong to nothing, and say so', () => {
  eq(unclaimed(plan, achievements(plan, [])).map(c => c.key), ['lift', 'support', 'misc'])
})

/* ------------------------------------------------------------ user edits */

const entry = (data, extra = {}) => ({
  id: entryIdFor(data.id), kind: KIND, date: null,
  updatedAt: '2026-09-15T12:00:00.000Z', data, ...extra,
})

check('THE ASK: one he adds himself shows up, after the seeds', () => {
  const list = achievements(plan, [entry({
    id: 'run-a-50k', name: 'Run a 50k', short: '50k', icon: 'Footprints',
    categories: ['run'], createdAt: '2026-09-15T12:00:00.000Z',
  })])
  eq(list.map(a => a.id), ['climb-12a', 'half-iron', 'run-a-50k'])
  eq(list[2].seeded, false, 'his own is not a seed')
  eq([...categorySet(list, 'run-a-50k')], ['run'])
})

check('editing a seed overrides it rather than duplicating it', () => {
  const list = achievements(plan, [entry({
    id: 'climb-12a', name: 'Climb 5.12b', short: '12b', categories: ['power', 'pe'],
  })])
  eq(list.length, 2, 'an edit must not add a row')
  eq(list[0].name, 'Climb 5.12b')
  eq([...categorySet(list, 'climb-12a')], ['power', 'pe'])
  eq(list[0].seeded, true, 'it is still the one that came with the app')
})

check('an edit that omits a field keeps the seed\'s', () => {
  // The editor always writes every field, but a hand-written entry or an older
  // app version might not — and losing the blurb on a name change would be quiet.
  const list = achievements(plan, [entry({ id: 'half-iron', name: 'Half Iron (2027)' })])
  eq(list[1].name, 'Half Iron (2027)')
  ok(list[1].blurb.startsWith('1.2 mi swim'), 'the seeded blurb should survive')
  eq([...categorySet(list, 'half-iron')].sort(), ['bike', 'run', 'swim'])
})

check('deleting a seeded one needs a tombstone, and that is what it gets', () => {
  // Dropping the entry would not be enough: plan.json would seed it back.
  const list = achievements(plan, [buildTombstone('climb-12a')])
  eq(list.map(a => a.id), ['half-iron'])
})

check('a tombstone beats an earlier edit of the same one', () => {
  const list = achievements(plan, [
    entry({ id: 'half-iron', name: 'Renamed' }),
    buildTombstone('half-iron'),
  ])
  eq(list.map(a => a.id), ['climb-12a'])
})

check('his own, ordered oldest first', () => {
  const list = achievements(plan, [
    entry({ id: 'b', name: 'Second', createdAt: '2026-09-15T12:00:00.000Z' }),
    entry({ id: 'a', name: 'First', createdAt: '2026-09-01T12:00:00.000Z' }),
  ])
  eq(list.map(a => a.id), ['climb-12a', 'half-iron', 'a', 'b'])
})

/* ----------------------------------------------------------- the dates */

check('THE MIGRATION: target dates set before achievements existed survive', () => {
  // They lived in the profile entry as `facts.goalDates`, and both seeds can have
  // one set. A rename that silently cleared them would be the worst outcome here.
  const facts = { goalDates: { 'climb-12a': '2026-11-30', 'half-iron': '2027-10-31' } }
  const list = achievements(plan, [], facts)
  eq(list.map(a => a.date), ['2026-11-30', '2027-10-31'])
})

check('an edited achievement owns its date, including clearing it', () => {
  const facts = { goalDates: { 'climb-12a': '2026-11-30' } }
  const moved = achievements(plan, [entry({ id: 'climb-12a', date: '2027-01-15' })], facts)
  eq(moved[0].date, '2027-01-15', 'the edit wins over the legacy fact')
  const cleared = achievements(plan, [entry({ id: 'climb-12a', date: null })], facts)
  eq(cleared[0].date, null, 'clearing must stick rather than falling back')
})

/* ------------------------------------------------------------- the rest */

check('achievementOf answers which one owns a category', () => {
  const list = achievements(plan, [])
  eq(achievementOf('swim', list)?.id, 'half-iron')
  eq(achievementOf('pe', list)?.id, 'climb-12a')
  eq(achievementOf('lift', list), null, 'an unclaimed category belongs to nobody')
  eq(achievementOf(null, list), null)
})

check('a deleted achievement matches nothing, not everything', () => {
  eq([...categorySet(achievements(plan, []), 'gone')], [])
  eq(categorySet(achievements(plan, []), null), null, 'no filter means no narrowing')
})

check('ids are slugs, and never collide', () => {
  eq(idFor('Run a 50k'), 'run-a-50k')
  eq(idFor('  Climb 5.12a!  '), 'climb-5-12a')
  eq(idFor('Run a 50k', ['run-a-50k']), 'run-a-50k-2')
  eq(idFor('Run a 50k', ['run-a-50k', 'run-a-50k-2']), 'run-a-50k-3')
  eq(idFor('***'), 'achievement', 'a name with no letters still has to produce an id')
})

check('a blank one is safe to render before anything is typed', () => {
  const b = blank()
  eq(b.id, null)
  eq(b.categories, [])
  eq(b.icon, 'Target')
})

check('buildEntry round-trips through the merge', () => {
  const made = buildEntry({
    id: 'swim-a-mile', name: 'Swim a mile', short: 'Mile', icon: 'Waves',
    date: '2027-06-01', blurb: 'Open water.', categories: ['swim'],
  })
  eq(made.id, 'achievement-swim-a-mile')
  eq(made.kind, KIND)
  const back = achievements(plan, [made]).find(a => a.id === 'swim-a-mile')
  eq(back.name, 'Swim a mile')
  eq(back.date, '2027-06-01')
  eq(back.categories, ['swim'])
  ok(back.createdAt, 'a new one should be stamped so the ordering is stable')
})

check('rubbish in the log does not take the list down', () => {
  const list = achievements(plan, [
    null, { kind: 'daily', date: '2026-09-15' }, { kind: KIND, data: {} },
    entry({ id: 'ok', name: '' }),
  ])
  eq(list.map(a => a.id), ['climb-12a', 'half-iron', 'ok'])
  eq(list[2].name, 'Untitled', 'a nameless one still needs something to render')
})

console.log(failed ? `\n${failed} achievement test(s) failed` : '\nall achievement tests pass')
process.exit(failed ? 1 : 0)
