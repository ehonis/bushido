/*
 * content/exercises.json: the shared exercise library (issue #64). The app merges it
 * into every `lifts` output of whatever plan an install runs on (#63); this checks
 * the file on its own, offline, against the contract in the issue.
 *
 * Someone will do these exercises from the words on the screen, mid-session, so the
 * length limits are the feature: a how-to that does not fit on a phone does not get
 * read. Every problem is collected and reported at once, because a content edit
 * usually breaks several entries the same way.
 *
 * Run: node exercises.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MuscleType } from 'react-body-highlighter'

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'))
const lib = read('../content/exercises.json')
const fixture = read('../test/fixtures/plan.json')
const field = fixture.dailyMenu.find(c => c.id === 'log-workout').outputs.find(o => o.type === 'lifts')

// `head` and `knees` are regions of the drawing, not muscles anything trains.
const MUSCLES = new Set(Object.values(MuscleType).filter(m => m !== 'head' && m !== 'knees'))
const IMPLEMENTS = new Set(field.implements.map(i => i.value))
const PLAN = new Map(field.exercises.map(e => [e.key, e]))

// The plan's own fields win on a key it already has (#63's merge rule), so restating
// them here would only be a second copy that never shows.
const FOR_EXISTING = new Set(['key', 'aka', 'measure', 'equipment', 'tags', 'how', 'video'])
const FOR_NEW = new Set([...FOR_EXISTING, 'name', 'group', 'implements', 'muscles'])
const HOW = { gist: 140, watch: 100, easier: 100, harder: 100 }

const problems = []
const bad = (where, msg) => problems.push(`${where}: ${msg}`)
const text = (v, max) => typeof v === 'string' && v.trim() === v && v.length > 0 && v.length <= max
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

assert.equal(lib.version, 1, 'version is 1')
assert.ok(Array.isArray(lib.groups) && lib.groups.length, 'groups is a list')
assert.equal(new Set(lib.groups).size, lib.groups.length, 'groups are not repeated')
const GROUPS = new Set([...field.groups, ...lib.groups])

// Every name a person could search, to the exercise it belongs to. A library entry
// may not answer to a name the plan already gives a different exercise.
const owner = new Map()
for (const e of field.exercises) for (const n of [e.name, ...(e.aka || [])]) owner.set(norm(n), e.key)

const seenKeys = new Set()
const seenUrls = new Map()
for (const [i, ex] of lib.exercises.entries()) {
  const where = ex.key || `exercises[${i}]`
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(ex.key || '')) bad(where, 'key is not kebab-case')
  if (seenKeys.has(ex.key)) bad(where, 'key appears twice')
  seenKeys.add(ex.key)

  const existing = PLAN.has(ex.key)
  const allowed = existing ? FOR_EXISTING : FOR_NEW
  for (const k of Object.keys(ex)) if (!allowed.has(k)) bad(where, `has "${k}", which ${existing ? 'the plan already owns' : 'is not in the contract'}`)

  if (!existing) {
    if (!text(ex.name, 60)) bad(where, 'a new exercise needs a name')
    if (!GROUPS.has(ex.group)) bad(where, `group "${ex.group}" is not a plan or library group`)
    const m = ex.muscles
    if (!m || !Array.isArray(m.primary) || !m.primary.length || !Array.isArray(m.secondary) || !text(m.from, 80)) {
      bad(where, 'muscles need primary, secondary and from')
    } else {
      for (const name of [...m.primary, ...m.secondary]) if (!MUSCLES.has(name)) bad(where, `"${name}" is not a react-body-highlighter muscle`)
      if (m.primary.some(n => m.secondary.includes(n))) bad(where, 'a muscle is both primary and secondary')
    }
  }
  if (ex.implements !== undefined) {
    if (!Array.isArray(ex.implements) || !ex.implements.length) bad(where, 'implements is an empty list')
    else for (const v of ex.implements) if (!IMPLEMENTS.has(v)) bad(where, `implement "${v}" is not one of the plan's`)
  }

  const names = [...(existing ? [] : [ex.name]), ...(ex.aka || [])]
  if (ex.aka !== undefined && (!Array.isArray(ex.aka) || !ex.aka.every(a => text(a, 60)))) bad(where, 'aka is a list of names')
  for (const n of names) {
    const other = owner.get(norm(n))
    if (other && other !== ex.key) bad(where, `"${n}" is already the name of ${other}`)
    owner.set(norm(n), ex.key)
  }

  if (ex.measure !== 'reps' && ex.measure !== 'time') bad(where, 'measure is "reps" or "time"')
  if (!text(ex.equipment, 40)) bad(where, 'equipment is short words')
  const tags = ex.tags
  if (!Array.isArray(tags) || tags.length < 2 || tags.length > 12) bad(where, 'tags: 2 to 12 of them')
  else {
    for (const t of tags) if (!text(t, 30) || t !== t.toLowerCase()) bad(where, `tag "${t}" should be short lowercase words`)
    if (new Set(tags).size !== tags.length) bad(where, 'a tag is repeated')
  }

  const how = ex.how
  if (!how || typeof how !== 'object') bad(where, 'has no how')
  else {
    for (const k of Object.keys(how)) if (!(k in HOW) && k !== 'steps') bad(where, `how has "${k}"`)
    for (const [k, max] of Object.entries(HOW)) {
      const required = k === 'gist' || k === 'watch'
      if (how[k] === undefined && !required) continue
      if (!text(how[k], max)) bad(where, `how.${k} is missing or over ${max} characters`)
    }
    if (!Array.isArray(how.steps) || how.steps.length < 3 || how.steps.length > 5) bad(where, 'how.steps: 3 to 5 of them')
    else for (const [n, s] of how.steps.entries()) if (!text(s, 120)) bad(where, `step ${n + 1} is missing or over 120 characters`)
  }

  if (ex.video !== undefined) {
    const v = ex.video
    const id = /^https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})$/.exec(v?.url || '')?.[1]
    if (!id) bad(where, 'video url is not https://www.youtube.com/watch?v=<11 characters>')
    // Exactly as oEmbed gave them, which is not always trimmed (one channel name ends in a space).
    const given = (s) => typeof s === 'string' && s.trim().length > 0 && s.length <= 200
    if (!given(v?.channel) || !given(v?.title)) bad(where, 'video needs the channel and title oEmbed gave')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v?.checked || '')) bad(where, 'video needs the date it was checked')
    for (const k of Object.keys(v || {})) if (!['url', 'channel', 'title', 'checked'].includes(k)) bad(where, `video has "${k}"`)
    if (id && seenUrls.has(id)) bad(where, `the same video as ${seenUrls.get(id)}`)
    if (id) seenUrls.set(id, ex.key)
  }
}

for (const key of PLAN.keys()) if (!seenKeys.has(key)) bad(key, 'is in the plan but has no library entry')
for (const g of lib.groups) if (!lib.exercises.some(e => (e.group || PLAN.get(e.key)?.group) === g)) bad(g, 'is a group with nothing in it')
// The library ships with the app and goes public: no one's name in it. YouTube
// channel names are the one exception, as a citation.
const shipped = JSON.stringify({ ...lib, exercises: lib.exercises.map(({ video, ...e }) => e) })
// The name is read from OWNER_NAME (as the prompts do), never written here: a
// literal name in the repo is itself the leak this guards against.
const ownerName = String(process.env.OWNER_NAME || '').trim()
if (ownerName && shipped.toLowerCase().includes(ownerName.toLowerCase())) problems.push('the library names the owner')

if (problems.length) {
  console.error(problems.join('\n'))
  assert.fail(`${problems.length} problem(s) in content/exercises.json`)
}

const count = {}
for (const e of lib.exercises) {
  const g = e.group || PLAN.get(e.key).group
  count[g] ??= { total: 0, new: 0, video: 0 }
  count[g].total += 1
  if (!PLAN.has(e.key)) count[g].new += 1
  if (e.video) count[g].video += 1
}
const widest = Math.max(...Object.keys(count).map(g => g.length))
for (const [g, c] of Object.entries(count)) console.log(`  ${g.padEnd(widest)}  ${String(c.total).padStart(3)}  (${c.new} new, ${c.video} with video)`)
console.log(`exercises: ${lib.exercises.length} entries, ${lib.exercises.length - PLAN.size} new, ${seenUrls.size} videos, all valid`)
