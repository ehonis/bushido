/*
 * The shared exercise library (issue #63): `content/exercises.json`, merged
 * into every `type: "lifts"` field of whatever plan an install runs on.
 *
 * WHY ON THE SERVER. The plan file is the content API (AGENTS.md §5), and the
 * owner's plan is not in the repository, so the library cannot be baked into
 * it. Merging where `/api/content` is served means the web, the iPhone app,
 * every person's plan and the planner's prompt all see one catalog, and no
 * client has to know a second file exists.
 *
 * THE RULE, as the contract in #63 states it:
 *
 *   - Join by `key`. Where the plan already has the exercise, the PLAN's fields
 *     win and the library only fills what the plan entry lacks: `how`, `video`,
 *     `tags`, `equipment`, `measure`, and `muscles` when the plan has none. So
 *     an entry for an exercise the plan has needs nothing but its `key` and
 *     what it fills (#64 writes them that way: no name, no group).
 *   - A library key the plan has under another spelling (`pushup` for a plan's
 *     `push-up`, or one of its `aka`) fills that exercise too, rather than
 *     adding a second one with no history.
 *   - A library exercise the plan lacks is added, and needs a `name` and a
 *     `group` for that; without them it is skipped, with a warning.
 *   - `aka` is the union of both. `groups` are the plan's, then the library's
 *     new ones, in order.
 *   - Nothing about stored log data changes: `key` is identity, and a logged
 *     row carries its own `name`.
 *
 * A missing library is an install without one, and an unreadable one is
 * logged and ignored: the plan is served exactly as it is on disk, never an
 * error. A field of the wrong shape is dropped from its entry, never the
 * entry. Pure apart from `createLibrary`, which caches on the file's mtime.
 */
'use strict'

const fs = require('fs')

const FILL = ['how', 'video', 'tags', 'equipment', 'measure']

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isStr = (v) => typeof v === 'string' && v.length > 0
const hasMuscles = (m) => isObj(m) && Array.isArray(m.primary) && m.primary.length > 0
const present = (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)
const strings = (v) => Array.isArray(v) && v.every(isStr)
/** "push-up", "Push up" and "pushup" are one spelling. */
const spelling = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

/* What each field must look like; anything else is dropped from its entry. */
const SHAPES = {
  name: isStr,
  group: isStr,
  aka: strings,
  implements: strings,
  tags: strings,
  equipment: isStr,
  measure: (v) => v === 'reps' || v === 'time',
  muscles: (m) => isObj(m) && strings(m.primary) && (m.secondary === undefined || strings(m.secondary)),
  how: (h) => isObj(h) && isStr(h.gist) && strings(h.steps)
    && ['watch', 'easier', 'harder'].every(k => h[k] === undefined || isStr(h[k])),
  video: (v) => isObj(v) && isStr(v.url) && /^https:\/\//.test(v.url),
}

/**
 * The library's usable shape, or null with the reason it is not one.
 * `problems` counts what was dropped, for one warning.
 */
function checkLibrary(lib) {
  if (!isObj(lib)) return { lib: null, error: 'not a JSON object', problems: null }
  if (lib.version !== 1) return { lib: null, error: lib.version === undefined ? 'no version' : `unknown version ${lib.version}`, problems: null }
  if (!Array.isArray(lib.exercises)) return { lib: null, error: 'no exercises array', problems: null }
  const seen = new Set()
  const problems = { entries: [], fields: [] }
  const exercises = []
  lib.exercises.forEach((ex, i) => {
    if (!isObj(ex) || !isStr(ex.key)) { problems.entries.push(`#${i}`); return }
    if (seen.has(ex.key)) { problems.entries.push(ex.key); return }
    seen.add(ex.key)
    const clean = { key: ex.key }
    for (const [k, v] of Object.entries(ex)) {
      if (k === 'key') continue
      if (!SHAPES[k]) { clean[k] = v; continue }
      if (SHAPES[k](v)) clean[k] = v
      else problems.fields.push(`${ex.key}.${k}`)
    }
    exercises.push(clean)
  })
  const groups = Array.isArray(lib.groups) ? lib.groups.filter(isStr) : []
  return { lib: { version: 1, groups, exercises }, error: null, problems: problems.entries.length || problems.fields.length ? problems : null }
}

/** One plan exercise, with what the library knows filled in around it. */
function fillExercise(own, lib) {
  const next = { ...own }
  for (const k of FILL) if (!present(own[k]) && present(lib[k])) next[k] = lib[k]
  if (!hasMuscles(own.muscles) && hasMuscles(lib.muscles)) next.muscles = lib.muscles
  const aka = [...new Set([...(strings(own.aka) ? own.aka : []), ...(lib.aka || [])])]
  if (aka.length) next.aka = aka
  return next
}

/** One `type: "lifts"` field with the library merged in; `skipped` collects what could not be added. */
function mergeField(field, lib, skipped) {
  const own = Array.isArray(field.exercises) ? field.exercises : []
  // Every spelling a plan exercise answers to: its key, then its aliases.
  const index = new Map()
  own.forEach((ex, i) => {
    if (!isObj(ex) || !ex.key) return
    for (const s of [ex.key, ...(strings(ex.aka) ? ex.aka : [])]) {
      const k = spelling(s)
      if (k && !index.has(k)) index.set(k, i)
    }
  })
  const exercises = [...own]
  const filled = new Set()
  const fillAt = (i, entry) => { exercises[i] = fillExercise(exercises[i], entry); filled.add(i) }
  // Exact keys first, so a plan exercise is filled by its own entry before an alias's.
  const exact = new Map(own.map((ex, i) => [ex?.key, i]))
  const rest = []
  for (const entry of lib.exercises) {
    if (exact.has(entry.key) && !filled.has(exact.get(entry.key))) fillAt(exact.get(entry.key), entry)
    else rest.push(entry)
  }
  for (const entry of rest) {
    const at = exact.has(entry.key) ? exact.get(entry.key) : index.get(spelling(entry.key))
    if (at !== undefined) { if (!filled.has(at)) fillAt(at, entry); continue }
    if (!isStr(entry.name) || !isStr(entry.group)) { skipped.add(entry.key); continue }
    exercises.push(entry)
  }
  const groups = [...new Set([...(Array.isArray(field.groups) ? field.groups : []), ...lib.groups])]
  return { ...field, groups, exercises }
}

/**
 * The plan with the library merged into every `type: "lifts"` output. The plan
 * object itself is never changed; the same plan back when there is no library.
 * `onSkip(keys)` hears about library exercises the plan lacks that have no
 * name or group, which are left out.
 */
function mergeLibrary(plan, library, { onSkip = null } = {}) {
  if (!isObj(plan) || !Array.isArray(plan.dailyMenu)) return plan
  const { lib } = checkLibrary(library)
  if (!lib || !lib.exercises.length) return plan
  let touched = false
  const skipped = new Set()
  const dailyMenu = plan.dailyMenu.map(opt => {
    if (!isObj(opt) || !Array.isArray(opt.outputs) || !opt.outputs.some(f => f?.type === 'lifts')) return opt
    touched = true
    return { ...opt, outputs: opt.outputs.map(f => (f?.type === 'lifts' ? mergeField(f, lib, skipped) : f)) }
  })
  if (skipped.size && onSkip) onSkip([...skipped])
  return touched ? { ...plan, dailyMenu } : plan
}

/** "3 (a, b, c…)": a count and the first few, for one line of warning. */
const some = (list) => `${list.length} (${list.slice(0, 5).join(', ')}${list.length > 5 ? ', …' : ''})`

/**
 * The library on disk, or null: absent (no warning, an install may simply not
 * have one), unreadable or invalid (one warning per change of the file). A
 * valid file with fields of the wrong shape is read without them, and says so
 * once.
 */
function createLibrary(file, warn = (m) => console.warn(m)) {
  let cached = { key: null, lib: null }
  return function readLibrary() {
    let stat
    try { stat = fs.statSync(file) } catch { cached = { key: null, lib: null }; return null }
    const key = `${stat.mtimeMs}:${stat.size}`
    if (cached.key === key) return cached.lib
    let lib = null
    try {
      const checked = checkLibrary(JSON.parse(fs.readFileSync(file, 'utf8')))
      if (checked.error) warn(`[bushido] exercise library ${file} ignored: ${checked.error}`)
      const p = checked.problems
      if (p?.entries.length) warn(`[bushido] exercise library ${file}: ${some(p.entries)} entries without a usable key, or repeated, left out`)
      if (p?.fields.length) warn(`[bushido] exercise library ${file}: ${some(p.fields)} fields of the wrong shape left out`)
      lib = checked.lib
    } catch (e) {
      warn(`[bushido] exercise library ${file} ignored: ${e.message}`)
    }
    cached = { key, lib }
    return lib
  }
}

module.exports = { mergeLibrary, checkLibrary, createLibrary }
