/*
 * Fill in `muscles` for every exercise in the lift catalog.
 *
 * Run: node muscles.build.mjs [path-to-free-exercise-db.json]
 *
 * WHY THIS IS A SCRIPT AND NOT A HAND-WRITTEN TABLE. Every lifting movement gets
 * a body diagram, and open-source data for that already exists, twice over:
 * `react-body-highlighter` (MIT)
 * draws the body, and `free-exercise-db` (public domain, 876 movements) knows
 * which muscles each one works. Typing two hundred rows of anatomy by hand would
 * have been slower, worse, and impossible to check.
 *
 *   curl -sLo /tmp/fed.json \
 *     https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json
 *
 * The output goes into `content/plan.json` beside the exercises themselves,
 * because the catalog is CONTENT — the same reason the exercises, the implements
 * and the activity list live there. Adding a movement means adding its muscles in
 * the same file, and re-running this script is how you get a first draft of them.
 *
 * WHAT IT DOES NOT DO: guess quietly. Every exercise it could not match by name
 * or alias falls back to its catalog GROUP, and the script prints exactly which
 * ones those were and what they got. A fallback is a coarse answer — "Chest" for
 * a decline press — and the point of printing them is that the coarse ones are
 * the ones worth correcting by hand afterwards.
 */

import { readFileSync, writeFileSync } from 'node:fs'

const PLAN = new URL('../test/fixtures/plan.json', import.meta.url)
const FED = process.argv[2] || '/tmp/fed.json'

/*
 * free-exercise-db's eighteen muscles onto react-body-highlighter's twenty-two.
 *
 * Two are lossy and worth knowing about. The highlighter has no `lats`, so lats
 * and mid-back both light the upper back — which is what that region of the
 * drawing actually is. And `shoulders` is one word for two muscle groups that sit
 * on opposite sides of the body, so it is resolved by the movement's own `force`:
 * a press is front delts, a row or a rear raise is back delts, and anything the
 * dataset does not classify gets both rather than a coin flip.
 */
const MAP = {
  abdominals: ['abs'],
  abductors: ['abductors'],
  adductors: ['adductor'],
  biceps: ['biceps'],
  calves: ['calves'],
  chest: ['chest'],
  forearms: ['forearm'],
  glutes: ['gluteal'],
  hamstrings: ['hamstring'],
  lats: ['upper-back'],
  'lower back': ['lower-back'],
  'middle back': ['upper-back'],
  neck: ['neck'],
  quadriceps: ['quadriceps'],
  traps: ['trapezius'],
  triceps: ['triceps'],
}

const shoulders = (force) =>
  force === 'push' ? ['front-deltoids']
    : force === 'pull' ? ['back-deltoids']
    : ['front-deltoids', 'back-deltoids']

const toMuscles = (names = [], force = null) =>
  [...new Set(names.flatMap(n => (n === 'shoulders' ? shoulders(force) : MAP[n] || [])))]

/*
 * Where the GROUP answer is not merely coarse but wrong.
 *
 * The group fallback is fine for most misses — "Core" really is abs and obliques
 * for a hollow hold — and these are the ones where it is actively misleading. A
 * back extension is not a lat movement, a Y-raise is not a front-delt movement,
 * and a Turkish get-up is not a leg movement, whatever drawer the catalog files
 * them in.
 *
 * They live HERE rather than as hand edits to plan.json so that re-running the
 * script keeps them. A correction in the file is a correction you lose the next
 * time the catalog grows.
 */
const OVERRIDES = {
  'back-extension': { primary: ['lower-back'], secondary: ['gluteal', 'hamstring'] },
  'hip-abduction': { primary: ['abductors'], secondary: ['gluteal'] },
  clamshell: { primary: ['abductors'], secondary: ['gluteal'] },
  'copenhagen-plank': { primary: ['adductor'], secondary: ['abs', 'obliques'] },
  'lateral-lunge': { primary: ['quadriceps', 'adductor'], secondary: ['gluteal'] },
  'y-raise': { primary: ['back-deltoids', 'trapezius'], secondary: [] },
  't-raise': { primary: ['back-deltoids', 'trapezius'], secondary: [] },
  'w-raise': { primary: ['back-deltoids', 'trapezius'], secondary: [] },
  'powell-raise': { primary: ['back-deltoids'], secondary: ['trapezius'] },
  'prone-trap-raise': { primary: ['trapezius'], secondary: ['back-deltoids'] },
  'scap-push-up': { primary: ['trapezius'], secondary: ['chest', 'front-deltoids'] },
  'wall-slide': { primary: ['trapezius'], secondary: ['back-deltoids'] },
  'diamond-push-up': { primary: ['triceps'], secondary: ['chest', 'front-deltoids'] },
  pullover: { primary: ['chest', 'upper-back'], secondary: ['triceps'] },
  'chest-fly': { primary: ['chest'], secondary: ['front-deltoids'] },
  'pec-deck': { primary: ['chest'], secondary: ['front-deltoids'] },
  'turkish-get-up': { primary: ['abs', 'obliques'], secondary: ['front-deltoids', 'gluteal', 'quadriceps'] },
  'push-jerk': { primary: ['front-deltoids', 'triceps'], secondary: ['quadriceps', 'gluteal', 'trapezius'] },
  'back-lever-hold': { primary: ['upper-back', 'abs'], secondary: ['lower-back'] },
  'sled-drag': { primary: ['quadriceps', 'gluteal'], secondary: ['calves', 'hamstring'] },
  'jump-rope': { primary: ['calves'], secondary: ['quadriceps', 'forearm'] },
  burpee: { primary: ['quadriceps', 'chest'], secondary: ['abs', 'front-deltoids', 'triceps'] },
  'wall-ball': { primary: ['quadriceps', 'front-deltoids'], secondary: ['gluteal', 'abs'] },
  'battle-ropes': { primary: ['front-deltoids', 'forearm'], secondary: ['abs', 'back-deltoids'] },
  'tibialis-raise': { primary: ['calves'], secondary: [] },
  'ankle-eversion': { primary: ['calves'], secondary: [] },
  'ankle-inversion': { primary: ['calves'], secondary: [] },
}

/** What a group gets when nothing in the dataset matched. Coarse, and printed. */
const BY_GROUP = {
  Chest: { primary: ['chest'], secondary: ['front-deltoids', 'triceps'] },
  Back: { primary: ['upper-back'], secondary: ['biceps', 'trapezius'] },
  Shoulders: { primary: ['front-deltoids', 'back-deltoids'], secondary: ['trapezius'] },
  Biceps: { primary: ['biceps'], secondary: ['forearm'] },
  Triceps: { primary: ['triceps'], secondary: [] },
  'Forearms & grip': { primary: ['forearm'], secondary: [] },
  Quads: { primary: ['quadriceps'], secondary: ['gluteal'] },
  'Hamstrings & glutes': { primary: ['hamstring', 'gluteal'], secondary: ['lower-back'] },
  'Calves & ankles': { primary: ['calves'], secondary: [] },
  Core: { primary: ['abs'], secondary: ['obliques'] },
  'Olympic & power': { primary: ['quadriceps', 'gluteal'], secondary: ['trapezius', 'hamstring', 'lower-back'] },
  'Carries & conditioning': { primary: ['forearm', 'trapezius'], secondary: ['abs'] },
  Neck: { primary: ['neck'], secondary: [] },
}

/* ------------------------------------------------------------------ matching */

const norm = (s) => String(s || '')
  .toLowerCase()
  .replace(/[^a-z0-9 ]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

// Words that say how a movement is LOADED, not what it works. Dropping them is
// what lets "Dumbbell bent-over row" find "Bent Over Row" — the dataset names its
// variants by equipment and the catalog carries equipment as a separate field.
const NOISE = new Set([
  'barbell', 'dumbbell', 'cable', 'machine', 'smith', 'kettlebell', 'band', 'bands',
  'weighted', 'bodyweight', 'body', 'only', 'lever', 'sled', 'plate', 'ez', 'bar',
  'with', 'the', 'a', 'and', 'or', 'on', 'of', 'to', 'up', 'ups', 'exercise',
  'standing', 'seated', 'lying', 'alternate', 'alternating', 'single', 'one', 'two',
])

const tokens = (s) => norm(s).split(' ').filter(w => w && !NOISE.has(w))

function score(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0
  const b = new Set(bTokens)
  const hit = aTokens.filter(w => b.has(w)).length
  // Symmetric, so "row" does not match "bent over row" as well as "bent over row"
  // does — a two-word query landing on a four-word name is a weaker claim.
  return (2 * hit) / (aTokens.length + bTokens.length)
}

const fed = JSON.parse(readFileSync(FED, 'utf8'))
const index = fed.map(e => ({ e, t: tokens(e.name), n: norm(e.name) }))

function match(ex) {
  const names = [ex.name, ...(ex.aka || [])]
  // Exact first, on the name or on any alias actually in use.
  for (const n of names) {
    const hit = index.find(x => x.n === norm(n))
    if (hit) return { row: hit.e, how: 'exact', on: n }
  }
  let best = null
  for (const n of names) {
    const t = tokens(n)
    for (const x of index) {
      const s = score(t, x.t)
      if (!best || s > best.s) best = { s, row: x.e, on: n }
    }
  }
  // 0.72 was picked by reading the misses either side of it: below it the matches
  // start being "leg press" onto "leg extension", which is a different muscle.
  return best && best.s >= 0.72 ? { row: best.row, how: `fuzzy ${best.s.toFixed(2)}`, on: best.on } : null
}

/* -------------------------------------------------------------------- write */

const plan = JSON.parse(readFileSync(PLAN, 'utf8'))
const field = plan.dailyMenu.flatMap(o => o.outputs || []).find(f => f.type === 'lifts')
if (!field) throw new Error('plan.json has no lifts field')

const fallbacks = []
let matched = 0

for (const ex of field.exercises) {
  // Hand-written beats measured here, because the override list only exists for
  // movements the dataset got wrong or never heard of.
  if (OVERRIDES[ex.key]) {
    ex.muscles = { ...OVERRIDES[ex.key], from: 'override' }
    matched += 1
    continue
  }
  const hit = match(ex)
  if (hit) {
    const primary = toMuscles(hit.row.primaryMuscles, hit.row.force)
    const secondary = toMuscles(hit.row.secondaryMuscles, hit.row.force)
      .filter(m => !primary.includes(m))
    if (primary.length) {
      ex.muscles = { primary, secondary, from: hit.row.name }
      matched += 1
      continue
    }
  }
  const fb = BY_GROUP[ex.group] || { primary: [], secondary: [] }
  ex.muscles = { ...fb, from: `group:${ex.group}` }
  fallbacks.push(`${ex.key} (${ex.group})`)
}

field.musclesNote =
  'Which muscles each movement works, for the body diagram — see app/src/lib/bodymap.jsx. ' +
  'Generated by app/muscles.build.mjs from free-exercise-db (public domain) and mapped onto ' +
  "react-body-highlighter's vocabulary; `from` records which dataset row each one came off, " +
  'or `group:<name>` where nothing matched and the catalog group was used instead. ' +
  'Hand corrections are welcome and will survive nothing — re-running the script overwrites ' +
  'them, so correct the script if a mapping is wrong for everyone and the file if it is wrong ' +
  'for one movement you then stop regenerating.'

writeFileSync(PLAN, `${JSON.stringify(plan, null, 2)}\n`)

console.log(`matched ${matched} of ${field.exercises.length} against the dataset`)
console.log(`fell back to the catalog group for ${fallbacks.length}:`)
for (const f of fallbacks) console.log(`  ${f}`)
