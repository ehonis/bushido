/*
 * content/starter.json and examples/plan.json are generated from
 * test/fixtures/plan.json. If the shared parts of the fixture (the catalogs, the
 * recommender, the journal) change, both have to be rebuilt or a fresh install
 * drifts from the app it ships with.
 * Run: node starter.test.mjs   (fix: node starter.build.mjs)
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildStarter, buildExample } from './starter.build.mjs'

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'))
const fixture = read('../test/fixtures/plan.json')
const starter = read('../content/starter.json')
const example = read('../examples/plan.json')

assert.deepEqual(starter, buildStarter(fixture),
  'content/starter.json is stale: run `node app/starter.build.mjs` and commit the result')
assert.deepEqual(example, buildExample(starter),
  'examples/plan.json is stale: run `node app/starter.build.mjs` and commit the result')
assert.equal(starter.achievements.length, 0, 'a fresh install must not seed achievements')
for (const [name, doc] of [['starter', starter], ['example', example], ['fixture', fixture]]) {
  assert.ok(!/Ethan/.test(JSON.stringify(doc)), `the ${name} names the original user`)
  assert.ok(!('facility' in doc), `the ${name} describes a real gym`)
}
// The example's own cards must point at categories it has.
const cats = new Set(example.quotaCategories.map(c => c.key))
for (const m of example.dailyMenu) if (m.category) assert.ok(cats.has(m.category), `${m.id} fills an unknown category`)
for (const a of example.achievements) for (const c of a.categories) assert.ok(cats.has(c), `${a.id} owns an unknown category`)
console.log('starter and example: in sync with test/fixtures/plan.json')
