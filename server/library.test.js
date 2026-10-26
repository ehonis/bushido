/*
 * The shared exercise library (issue #63), merged into a plan's lift catalogs.
 * Run: node server/library.test.js
 *
 * The rule: join by key, the plan's fields win and the library fills only what
 * the plan entry lacks; new keys are added, `aka` is unioned, and a missing or
 * invalid library serves the plan exactly as it is on disk. server/http.test.js
 * drives the same through /api/content.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { mergeLibrary, checkLibrary, createLibrary } = require('./library.js')

let failed = 0
const check = (name, fn) => {
  try { fn(); console.log('  ok   ', name) } catch (e) { failed++; console.log('  FAIL ', name, '\n         ', e.message) }
}
const ok = (v, m) => { if (!v) throw new Error(m || 'expected truthy') }
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }

const liftsField = (exercises, groups = ['Chest', 'Core']) => ({ key: 'lifts', type: 'lifts', groups, implements: [{ value: 'barbell', label: 'Barbell' }], exercises })
const planWith = (...fields) => ({
  dailyMenu: [
    { id: 'log-workout', outputs: [{ key: 'activity', type: 'activity' }, ...fields] },
    { id: 'rest', outputs: [{ key: 'why', type: 'choice' }] },
  ],
})
const bench = { key: 'bench-press', name: 'Bench press', group: 'Chest', aka: ['bp'], muscles: { primary: ['chest'], secondary: ['triceps'] } }
const plank = { key: 'plank', name: 'Plank', group: 'Core' }
const exercisesOf = (plan, i = 0) => plan.dailyMenu[0].outputs.filter(f => f.type === 'lifts')[i].exercises
const byKey = (list, key) => list.find(e => e.key === key)

const LIB = {
  version: 1,
  groups: ['Core', 'Mobility & stretching'],
  exercises: [
    { key: 'bench-press', name: 'Barbell bench press', group: 'Push', aka: ['bench', 'bp'], muscles: { primary: ['triceps'] },
      equipment: 'Bench', tags: ['push'], how: { gist: 'Press it.', steps: ['a', 'b', 'c'] } },
    { key: 'plank', name: 'Front plank', group: 'Core', measure: 'time', aka: ['front hold'], muscles: { primary: ['abs'], secondary: [] },
      video: { url: 'https://www.youtube.com/watch?v=00000000000', channel: 'c', title: 't', checked: '2026-10-26' } },
    { key: 'couch-stretch', name: 'Couch stretch', group: 'Mobility & stretching', measure: 'time' },
  ],
}

check("the plan's fields win; the library fills only what the plan lacks", () => {
  const merged = mergeLibrary(planWith(liftsField([bench, plank])), LIB)
  const b = byKey(exercisesOf(merged), 'bench-press')
  eq(b.name, 'Bench press', 'the plan names it')
  eq(b.group, 'Chest', 'the plan files it')
  eq(b.muscles, bench.muscles, 'the plan has muscles, so they stand')
  eq(b.equipment, 'Bench')
  eq(b.tags, ['push'])
  eq(b.how.gist, 'Press it.')
  const p = byKey(exercisesOf(merged), 'plank')
  eq(p.name, 'Plank')
  eq(p.measure, 'time', 'measure is filled')
  eq(p.muscles, { primary: ['abs'], secondary: [] }, 'muscles fill when the plan has none')
  eq(p.video.url, LIB.exercises[1].video.url)
})

check('a field the plan HAS is never overwritten, even with a different measure', () => {
  const own = { ...plank, measure: 'reps', how: { gist: 'Mine.' } }
  const p = byKey(exercisesOf(mergeLibrary(planWith(liftsField([own])), LIB)), 'plank')
  eq(p.measure, 'reps')
  eq(p.how, { gist: 'Mine.' })
})

check('a library exercise the plan lacks is added; a plan one the library lacks stays', () => {
  const squat = { key: 'back-squat', name: 'Back squat', group: 'Quads' }
  const list = exercisesOf(mergeLibrary(planWith(liftsField([bench, squat])), LIB))
  eq(list.map(e => e.key), ['bench-press', 'back-squat', 'plank', 'couch-stretch'], 'plan order first, then new ones in library order')
  eq(byKey(list, 'back-squat'), squat, 'untouched')
  eq(byKey(list, 'couch-stretch'), LIB.exercises[2], 'added whole')
})

check('aka is the union of both, the plan\'s first', () => {
  const b = byKey(exercisesOf(mergeLibrary(planWith(liftsField([bench])), LIB)), 'bench-press')
  eq(b.aka, ['bp', 'bench'])
  const p = byKey(exercisesOf(mergeLibrary(planWith(liftsField([plank])), LIB)), 'plank')
  eq(p.aka, ['front hold'], 'a plan entry with no aka takes the library\'s')
})

check('groups: the plan\'s, then the library\'s new ones, in order, no duplicates', () => {
  const merged = mergeLibrary(planWith(liftsField([bench])), LIB)
  eq(merged.dailyMenu[0].outputs[1].groups, ['Chest', 'Core', 'Mobility & stretching'])
})

check('every lifts field in the plan is merged; nothing else changes', () => {
  const plan = planWith(liftsField([bench]), liftsField([plank]))
  const merged = mergeLibrary(plan, LIB)
  eq(exercisesOf(merged, 0).map(e => e.key), ['bench-press', 'plank', 'couch-stretch'])
  eq(exercisesOf(merged, 1).map(e => e.key), ['plank', 'bench-press', 'couch-stretch'])
  eq(merged.dailyMenu[1], plan.dailyMenu[1], 'a card with no lifts field is the same')
  ok(merged.dailyMenu[1] === plan.dailyMenu[1], 'and the same object')
})

check('what the file reader hands over merges: the check is idempotent', () => {
  const { lib } = checkLibrary(LIB)
  eq(checkLibrary(lib).error, null)
  eq(byKey(exercisesOf(mergeLibrary(planWith(liftsField([plank])), lib)), 'plank').measure, 'time')
})

check('the plan object itself is never changed', () => {
  const plan = planWith(liftsField([bench, plank]))
  const before = JSON.stringify(plan)
  mergeLibrary(plan, LIB)
  eq(JSON.stringify(plan), before)
})

check('a missing, empty or invalid library means the plan, unchanged', () => {
  const plan = planWith(liftsField([bench]))
  for (const lib of [null, undefined, {}, [], 'x', { version: 1, exercises: 'no' }, { version: 2, exercises: LIB.exercises },
    { exercises: LIB.exercises }, { version: 1, exercises: [] }]) {
    ok(mergeLibrary(plan, lib) === plan, `changed by ${JSON.stringify(lib)}`)
  }
  ok(mergeLibrary({ nope: true }, LIB).nope, 'not a plan: back as it came')
})

check('entries without a key, and repeated keys, are dropped and counted, not fatal', () => {
  const { lib, error, problems } = checkLibrary({ version: 1, exercises: [{ key: 'a' }, { name: 'b' }, null, 7, { key: 'c', name: 'C' }, { key: 'c', name: 'C again' }] })
  eq(error, null)
  eq(lib.exercises.map(e => e.key), ['a', 'c'], 'a key alone is an entry: it can fill a plan exercise')
  eq(problems.entries, ['#1', '#2', '#3', 'c'])
  eq(checkLibrary({ version: 1, exercises: [] }).error, null)
  ok(checkLibrary({ version: 3, exercises: [] }).error, 'an unknown version is refused')
  ok(checkLibrary({ exercises: [] }).error, 'no version is refused')
})

check('a field of the wrong shape is dropped from its entry, and counted', () => {
  const { lib, problems } = checkLibrary({ version: 1, exercises: [{
    key: 'x', name: 'X', group: 'Core', aka: 'xx', tags: 'core', measure: 'minutes', implements: ['band', 3],
    how: { gist: 'g', steps: 'one' }, video: { url: 'http://insecure' }, muscles: { primary: 'abs' }, equipment: 'None',
  }, { key: 'y', how: { gist: 'g', steps: ['a', 'b', 'c'], watch: 'w' }, aka: ['why'] }] })
  eq(lib.exercises[0], { key: 'x', name: 'X', group: 'Core', equipment: 'None' })
  eq(problems.fields.sort(), ['x.aka', 'x.how', 'x.implements', 'x.measure', 'x.muscles', 'x.tags', 'x.video'])
  eq(lib.exercises[1].how.steps.length, 3, 'a good how-to was dropped')
  // A string aka would have been spread into letters by the union.
  const merged = byKey(exercisesOf(mergeLibrary(planWith(liftsField([{ ...bench, key: 'x', name: 'X' }])), { version: 1, exercises: [{ key: 'x', aka: 'xx' }] })), 'x')
  eq(merged.aka, ['bp'])
})

check('an entry with only a key and what it fills fills the plan exercise; it needs no name (#64)', () => {
  const fill = { version: 1, exercises: [{ key: 'bench-press', measure: 'reps', how: { gist: 'Press.', steps: ['a', 'b', 'c'] }, tags: ['push'] }] }
  const b = byKey(exercisesOf(mergeLibrary(planWith(liftsField([bench])), fill)), 'bench-press')
  eq([b.name, b.group, b.how.gist, b.tags, b.measure], ['Bench press', 'Chest', 'Press.', ['push'], 'reps'])
})

check('a NEW exercise without a name or a group is left out, and the caller hears which', () => {
  const lib = { version: 1, exercises: [{ key: 'mystery', how: { gist: 'g', steps: ['a', 'b', 'c'] } }, { key: 'nogroup', name: 'No group' }, { key: 'ok', name: 'OK', group: 'Core' }] }
  let heard = null
  const list = exercisesOf(mergeLibrary(planWith(liftsField([bench])), lib, { onSkip: (keys) => { heard = keys } }))
  eq(list.map(e => e.key), ['bench-press', 'ok'])
  eq(heard, ['mystery', 'nogroup'])
})

check('a library key the plan has under another spelling or alias fills it, never a second exercise', () => {
  const pushUp = { key: 'push-up', name: 'Push-up', group: 'Chest', aka: ['press up'] }
  const lib = { version: 1, exercises: [
    { key: 'pushup', name: 'Pushup', group: 'Chest', how: { gist: 'Push.', steps: ['a', 'b', 'c'] } },
    { key: 'press-up', name: 'Press-up', group: 'Chest', tags: ['other'] },
  ] }
  const list = exercisesOf(mergeLibrary(planWith(liftsField([pushUp])), lib))
  eq(list.map(e => e.key), ['push-up'], 'a second push-up was added')
  eq([list[0].name, list[0].how.gist, list[0].tags], ['Push-up', 'Push.', undefined], 'filled once, by the first spelling')
  eq(list[0].aka, ['press up', 'pushup'], 'the spelling it joined by is not an alias, so typing it finds nothing')
  // Its own key beats an alias that reaches it first.
  const own = exercisesOf(mergeLibrary(planWith(liftsField([pushUp])), { version: 1, exercises: [{ key: 'pushup', tags: ['alias'] }, { key: 'push-up', tags: ['own'] }] }))
  eq(own[0].tags, ['own'])
})

check('the file: absent is silent, unreadable is one warning per change, never a throw', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bushido-library-'))
  const file = path.join(dir, 'exercises.json')
  const warnings = []
  const read = createLibrary(file, (m) => warnings.push(m))
  eq(read(), null, 'absent')
  eq(warnings, [], 'an install without a library says nothing')
  fs.writeFileSync(file, '{ not json')
  eq(read(), null)
  eq(read(), null)
  eq(warnings.length, 1, 'warned once for the same broken file')
  fs.writeFileSync(file, JSON.stringify({ version: 1, exercises: { nope: 1 } }))
  const t = new Date(Date.now() + 5000)
  fs.utimesSync(file, t, t)
  eq(read(), null)
  eq(warnings.length, 2, 'a new problem is a new warning')
  fs.writeFileSync(file, JSON.stringify(LIB))
  const t2 = new Date(Date.now() + 10000)
  fs.utimesSync(file, t2, t2)
  eq(read().exercises.length, 3, 'a fixed file is read')
  eq(warnings.length, 2, 'a good file warned')
  fs.writeFileSync(file, JSON.stringify({ ...LIB, exercises: [...LIB.exercises, { key: 'bad', aka: 'b' }, { name: 'no key' }] }))
  const t3 = new Date(Date.now() + 15000)
  fs.utimesSync(file, t3, t3)
  eq(read().exercises.length, 4)
  eq(warnings.length, 4, 'one warning for entries, one for fields')
  ok(/1 \(#4\)/.test(warnings[2]) && /1 \(bad\.aka\)/.test(warnings[3]), warnings.slice(2).join(' / '))
  fs.rmSync(dir, { recursive: true, force: true })
})

/*
 * The real library (#64), when it exists: merged into the starter, nothing is
 * dropped and every starter lift gets a how-to. Skipped before #64 lands.
 */
check('content/exercises.json, when present, fills every starter lift and drops nothing', () => {
  const real = path.join(__dirname, '..', 'content', 'exercises.json')
  if (!fs.existsSync(real)) { console.log('         (skipped: no content/exercises.json yet)'); return }
  const lib = JSON.parse(fs.readFileSync(real, 'utf8'))
  const checked = checkLibrary(lib)
  eq(checked.error, null)
  eq(checked.problems, null, 'entries or fields were dropped')
  const starter = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'starter.json'), 'utf8'))
  let skipped = []
  const merged = mergeLibrary(starter, lib, { onSkip: (k) => { skipped = k } })
  eq(skipped, [], 'library exercises were left out')
  for (const f of merged.dailyMenu.flatMap(m => m.outputs || []).filter(o => o.type === 'lifts')) {
    const bare = f.exercises.filter(e => !e.how)
    eq(bare.map(e => e.key), [], 'starter lifts without a how-to')
    const holds = f.exercises.filter(e => e.measure === 'time')
    ok(holds.some(e => e.key === 'plank'), 'the plank is not a hold')
  }
})

check('the test fixture is a valid library with a hold, a video and an entry without a how-to', () => {
  const lib = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'test', 'fixtures', 'exercises.json'), 'utf8'))
  const { lib: ok_, error } = checkLibrary(lib)
  eq(error, null)
  eq(ok_.exercises.length, lib.exercises.length, 'every entry is usable')
  ok(lib.exercises.some(e => e.measure === 'time'), 'a hold')
  ok(lib.exercises.some(e => e.video?.url), 'a video')
  ok(lib.exercises.some(e => !e.how), 'one without a how-to')
  for (const ex of lib.exercises) {
    if (!ex.how) continue
    ok(ex.how.gist.length <= 140, `${ex.key}: gist too long`)
    ok(ex.how.steps.length >= 3 && ex.how.steps.length <= 5, `${ex.key}: 3–5 steps`)
    ok(ex.how.steps.every(s => s.length <= 120), `${ex.key}: a step is too long`)
  }
})

if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
