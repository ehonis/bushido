/* What one workout is CALLED:
 *   node app/naming.test.js
 *
 * Three related behaviours — rename a single workout, name a "just miles" ride
 * "Commute" by itself, and offer names as taps rather than typing — are all
 * decided here rather than in a component.
 * Run against the real `content/plan.json`, because the vocabulary is content and
 * a chip list nobody declares is a text box.
 */

import { readFileSync } from 'node:fs'
import {
  nameFor, titleFor, titleOf, rename, quickNames, casualName, withCasualName,
} from './src/lib/naming.js'

const plan = JSON.parse(readFileSync(new URL('../test/fixtures/plan.json', import.meta.url), 'utf8'))

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
const ok = (v, what) => { if (!v) throw new Error(what || 'expected truthy') }

const card = (id) => plan.dailyMenu.find(m => m.id === id)
const workout = card('log-workout')
const board = card('board')
ok(workout, 'plan.json has no log-workout card')
ok(board, 'plan.json has no board card')

/* ------------------------------------------------------------------ renaming */

check('THE ASK: a rename beats what the card calls it', () => {
  eq(nameFor(workout, { activity: 'bike' }), 'Bike', 'the catalog names it by default')
  eq(nameFor(workout, { activity: 'bike', title: 'Lunch ride with the club' }), 'Lunch ride with the club')
  eq(nameFor(board, { title: 'Board, felt strong' }), 'Board, felt strong',
    'a climbing card can be renamed too — it is app-level, not declared')
})

check('blank is not a name', () => {
  eq(titleOf({}), null)
  eq(titleOf({ title: '   ' }), null, 'whitespace is not a name')
  eq(nameFor(workout, { activity: 'bike', title: '  ' }), 'Bike')
})

check('clearing the box hands the default back', () => {
  const named = rename({ activity: 'bike' }, 'Commute')
  eq(named.title, 'Commute')
  eq(rename(named, '').title, undefined, 'blank removes the key rather than storing ""')
  eq(nameFor(workout, rename(named, '')), 'Bike')
})

check('a rename is trimmed, and it is HIS once he types it', () => {
  const app = withCasualName({ activity: 'bike' }, { plan, opt: workout, on: true })
  eq(app.titleFrom, 'casual', 'the app wrote that one')
  const typed = rename(app, '  Ride to work  ')
  eq(typed.title, 'Ride to work')
  eq(typed.titleFrom, undefined,
    'typing it makes it his, even if he typed what the app suggested')
})

check('his rename outranks the planner, and the planner outranks the card', () => {
  const pres = { title: 'Legs' }
  eq(titleFor(workout, {}, pres), 'Legs')
  eq(titleFor(workout, { title: 'Squats, finally' }, pres), 'Squats, finally')
  eq(titleFor(workout, { activity: 'bike' }, null), 'Bike')
  eq(titleFor(board, {}, null), board.name)
})

/* --------------------------------------------------------------- just miles */

check('THE ASK: a bike ride marked just miles calls itself Commute', () => {
  // Marking a bike ride as just miles names it "Commute" by default.
  const out = withCasualName({ activity: 'bike', distance: 1.75 },
    { plan, opt: workout, on: true })
  eq(out.title, 'Commute')
  eq(nameFor(workout, out), 'Commute')
})

check('unticking it takes the app\'s name back — and only the app\'s', () => {
  const on = withCasualName({ activity: 'bike' }, { plan, opt: workout, on: true })
  const off = withCasualName(on, { plan, opt: workout, on: false })
  eq(off.title, undefined)
  eq(off.titleFrom, undefined)
  eq(nameFor(workout, off), 'Bike')

  // A name the user typed survives the box being unticked. This is the whole reason
  // the provenance is stored at all.
  const his = rename(on, 'Ride to work')
  eq(withCasualName(his, { plan, opt: workout, on: false }).title, 'Ride to work')
})

check('it never overwrites a name he already gave it', () => {
  const his = { activity: 'bike', title: 'Errand' }
  eq(withCasualName(his, { plan, opt: workout, on: true }).title, 'Errand')
  eq(withCasualName(his, { plan, opt: workout, on: true }).titleFrom, undefined)
})

check('a walk marked just miles is NOT called a commute', () => {
  // The default is keyed by discipline on purpose: "Commute" is right for the
  // ride to work and wrong for the walk round the block, and a wrong default
  // reads as something the user asserted.
  eq(casualName(plan, workout, { activity: 'walk' }), null)
  const out = withCasualName({ activity: 'walk' }, { plan, opt: workout, on: true })
  eq(out.title, undefined)
  eq(nameFor(workout, out), 'Walk')
})

check('a run commutes too', () => {
  eq(casualName(plan, workout, { activity: 'run' }), 'Commute')
})

/* ------------------------------------------------------------ the quick names */

check('THE ASK: the chips are content, and they follow the discipline', () => {
  // Renaming offers quick-entry names as taps, so typing is only needed for a
  // genuinely specific name.
  const bike = quickNames(plan, workout, { activity: 'bike' })
  const run = quickNames(plan, workout, { activity: 'run' })
  ok(bike.length >= 6, `a bike ride should offer a real list, got ${bike.length}`)
  eq(bike[0], 'Commute', 'the one he makes most often leads')
  ok(run.includes('Long run'), 'a run should offer running names')
  ok(!run.includes('Zone 2 ride'), 'and not the bike ones')
})

check('the climbing cards get climbing names', () => {
  const climbing = quickNames(plan, board, {})
  ok(climbing.includes('Projecting'), `got ${JSON.stringify(climbing)}`)
})

check('the generic names ride along with every discipline', () => {
  for (const out of [{ activity: 'bike' }, { activity: 'swim' }, {}]) {
    for (const any of plan.quickNames.any) {
      ok(quickNames(plan, workout, out).includes(any),
        `"${any}" should be offered for ${JSON.stringify(out)}`)
    }
  }
})

check('no name is offered twice', () => {
  for (const key of Object.keys(plan.quickNames.byDiscipline)) {
    const list = quickNames(plan, { discipline: key }, {})
    eq(list.length, new Set(list).size, `${key} has a duplicate chip`)
  }
})

check('every declared name is a real, tappable string', () => {
  const all = [
    ...Object.values(plan.quickNames.byDiscipline).flat(),
    ...plan.quickNames.any,
    ...Object.values(plan.quickNames.casual),
  ]
  for (const n of all) {
    ok(typeof n === 'string' && n.trim() && n.length <= 24,
      `"${n}" is not a name a chip can hold`)
  }
})

check('every discipline the catalog uses has names, and none are invented', () => {
  // A discipline with no chips is a text box, and a chip list for a discipline
  // nothing can be logged as is a list nobody will ever see.
  const field = (workout.outputs || []).find(f => f.type === 'activity')
  const used = new Set((field.activities || []).map(a => a.discipline).filter(Boolean))
  for (const d of used) {
    ok(plan.quickNames.byDiscipline[d], `the catalog logs "${d}" and it has no quick names`)
  }
  const declared = new Set(plan.dailyMenu.map(m => m.discipline).filter(Boolean))
  for (const key of Object.keys(plan.quickNames.byDiscipline)) {
    ok(used.has(key) || declared.has(key), `"${key}" is not a discipline anything uses`)
  }
  for (const key of Object.keys(plan.quickNames.casual)) {
    ok(used.has(key), `"${key}" cannot be logged, so nothing can be a casual one`)
  }
})

check('no plan is a plain text box, not a crash', () => {
  eq(quickNames(null, workout, { activity: 'bike' }), [])
  eq(casualName(null, workout, { activity: 'bike' }), null)
  eq(withCasualName({ activity: 'bike' }, { plan: null, opt: workout, on: true }),
    { activity: 'bike' }, 'nothing to name it, so nothing changes')
})

console.log(failed ? `\n${failed} naming test(s) failed` : '\nall naming tests passed')
process.exit(failed ? 1 : 0)
