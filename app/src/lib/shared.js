/*
 * SHARED WORKOUTS: the owner logging a workout together with someone else on
 * the install, from one sheet, without switching the whole app (act-as).
 *
 * Two logs, never one. The workout lands in each person's OWN log as an
 * ordinary entry; nothing reads across. The owner's entry says who else was on
 * it (`data.sharedWith: [{ id, entryId }]`), the other person's copy says who
 * it came from (`data.sharedFrom: { id, name }`, stamped by the server), and
 * the owner's sheet reads and writes that copy through `/api/people/:id/entry`
 * (server.js `peopleRoute`), never through the owner's own store or cache.
 *
 * What is copied is what the two of them SHARED: the session, the day, the
 * activity, the name, how long it took and how far it went, and the owner's
 * EXERCISES (the plan's items and set counts, or the logged lifts) as they were
 * when the person was added. Exercises the owner adds later are copied over only
 * when the owner asks (`copyExercises`, "Copy my exercises" on their side). What
 * each of them DID (reps, weights, grades, effort, how it felt, notes, gear,
 * done, the owner's WHOOP and Strava) is theirs: the copy leaves it blank and the
 * owner's numbers appear only as placeholders (AGENTS.md §6.4: a number the app
 * could guess is a placeholder, never a value).
 *
 * Pure: no fetch, no React. The sheet (sharedwith.jsx) does the I/O.
 */

import { extraEntryId } from './store.js'
import { blankSet } from './lifts.js'
import { reindex, remapRun } from './prescription.js'

/** Facts of the workout itself, as opposed to how it went for one person. */
export const SHARED_OUT_KEYS = Object.freeze([
  'title', 'titleFrom', 'duration', 'minutesSpent', 'distance', 'poolDistance', 'elevation', 'incline', 'route',
])

/**
 * Who the owner can add to a workout. Nobody unless this is the owner, on the
 * owner's own log (not acting as someone), on an install with someone else on it.
 */
export function sharePeople(me) {
  if (!me?.real?.admin || me.acting || (me.id && me.id !== me.real.id)) return []
  const people = Array.isArray(me.people) ? me.people : []
  return people.filter(p => p && p.id && p.id !== me.real.id)
}

/** `data.sharedWith`, cleaned: one record per person, in the order added. */
export function sharedWithOf(entry) {
  const raw = entry?.data?.sharedWith
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const out = []
  for (const r of raw) {
    const id = typeof r === 'string' ? r : r?.id
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ id: String(id), entryId: String((typeof r === 'object' && r?.entryId) || entry.id) })
  }
  return out
}

/** The people on this entry, named from the list the owner was given. Unknown ids keep their id. */
export function sharedPeopleOn(entry, people = []) {
  return sharedWithOf(entry).map(s => ({ ...s, name: people.find(p => p.id === s.id)?.name || s.id }))
}

/** "with Sam", "with Sam and Robin": small, for a row or a sheet. Null when it is nobody's but yours. */
export function withLine(entry, people = []) {
  const from = entry?.data?.sharedFrom
  const names = from?.name ? [String(from.name)] : sharedPeopleOn(entry, people).map(p => p.name)
  if (!names.length) return null
  if (names.length === 1) return `with ${names[0]}`
  return `with ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** The parts of an `out` both people did: the session's identity field plus SHARED_OUT_KEYS. */
export function sharedOut(out = {}, session = null) {
  const keys = new Set(SHARED_OUT_KEYS)
  if (session?.nameFrom) keys.add(session.nameFrom)
  const next = {}
  for (const [k, v] of Object.entries(out || {})) if (keys.has(k) && v !== undefined) next[k] = v
  return next
}

/** Has this person put anything of their own on their copy? Their sets, their effort, a note, done. */
export function hasOwnMarks(entry, session = null) {
  if (!entry || entry.deleted) return false
  if (entry.data?.done === true) return true
  if (entry.data?.run?.startedAt) return true
  const keys = new Set(SHARED_OUT_KEYS)
  if (session?.nameFrom) keys.add(session.nameFrom)
  for (const [k, v] of Object.entries(entry.data?.out || {})) {
    if (keys.has(k) || v === undefined || v === null || v === '') continue
    if (Array.isArray(v) && !v.length) continue
    // The owner's exercises, copied in with nothing marked on them, are not theirs.
    if (k === 'lifts' && !liftsMarked(v)) continue
    return true
  }
  return false
}

/* ------------------------------------------------ the owner's exercises, copied */

const blank = (v) => v === undefined || v === null || v === ''

/** Have they put a number on any of these logged lifts? */
export const liftsMarked = (lifts) => Array.isArray(lifts)
  && lifts.some(l => (l?.sets || []).some(s => !blank(s?.reps) || !blank(s?.weight)))

/** Each plan item with its key: the name, numbered when it appears twice, as `remapRun` matches them. */
function keyed(pres) {
  const seen = new Map()
  return (pres?.blocks || []).flatMap((b, bi) => (b?.items || []).map(item => {
    const name = String(item?.name || '')
    const n = (seen.get(name) || 0) + 1
    seen.set(name, n)
    return { key: `${name}#${n}`, item, bi }
  }))
}

/** One of the owner's exercises on their side: the target, not the owner's weight. */
const theirItem = (item) => ({ ...item, sets: (item.sets || []).map(s => ({ ...s, weight: null })) })

/** Their plan with every exercise and set of the owner's that it lacks. Never takes anything out. */
function copyPlan(theirs, mine) {
  if (!mine?.blocks?.length) return theirs
  if (!theirs?.blocks?.length) return { ...mine, blocks: mine.blocks.map(b => ({ ...b, items: (b.items || []).map(theirItem) })) }
  const have = new Map(keyed(theirs).map(x => [x.key, x.item]))
  const blocks = theirs.blocks.map(b => ({ ...b, items: [...(b.items || [])] }))
  let changed = false
  for (const { key, item, bi } of keyed(mine)) {
    const t = have.get(key)
    if (!t) {
      // A new exercise goes at the end of the same block (a block of the owner's if they have none there).
      while (blocks.length <= bi) blocks.push({ ...mine.blocks[blocks.length], items: [] })
      blocks[bi].items.push(theirItem(item))
      changed = true
    } else if ((item.sets || []).length > (t.sets || []).length) {
      // More sets of the owner's: copies of their own last set, as adding a set does.
      const sets = [...(t.sets || [])]
      while (sets.length < item.sets.length) sets.push(sets.length ? { ...sets.at(-1), note: '' } : { ...item.sets[sets.length], weight: null })
      const b = blocks.find(x => x.items.includes(t))
      b.items = b.items.map(x => (x === t ? { ...t, sets } : x))
      changed = true
    }
  }
  return changed ? { ...theirs, blocks } : theirs
}

/** Their logged lifts with every lift and set of the owner's that they lack, blank. */
function copyLifts(theirs, mine) {
  const rows = Array.isArray(theirs) ? theirs : []
  let out = rows
  for (const m of Array.isArray(mine) ? mine : []) {
    if (!m?.uid) continue
    const t = out.find(r => r?.uid === m.uid)
    const want = Math.max(1, (m.sets || []).length)
    if (!t) out = [...out, { ...m, sets: Array.from({ length: want }, blankSet) }]
    else if ((t.sets || []).length < want) {
      const sets = [...(t.sets || [])]
      while (sets.length < want) sets.push(blankSet())
      out = out.map(r => (r === t ? { ...t, sets } : r))
    }
  }
  return out
}

/**
 * Their copy with the owner's exercises copied over: on a planned session the
 * plan's exercises and set counts (with no weight; their logged sets kept across
 * the renumber), otherwise the logged lifts as blank rows. Only ever adds: their
 * numbers, their own exercises and anything they took out of a set count stay as
 * they are. The same object back when there is nothing to copy.
 */
export function copyExercises(copy, ownerEntry) {
  const mine = ownerEntry?.data
  if (!copy?.data || copy.deleted || !mine || ownerEntry.deleted) return copy
  if (mine.plan) {
    const before = copy.data.plan
    const plan = copyPlan(before, mine.plan)
    if (plan === before) return copy
    const next = reindex(plan)
    const data = { ...copy.data, plan: next }
    if (before?.blocks && copy.data.run) data.run = remapRun(copy.data.run, before, next)
    return { ...copy, data }
  }
  const lifts = copyLifts(copy.data.out?.lifts, mine.out?.lifts)
  if (lifts.length === (copy.data.out?.lifts || []).length && lifts.every((l, i) => l === copy.data.out.lifts[i])) return copy
  return { ...copy, data: { ...copy.data, out: { ...(copy.data.out || {}), lifts } } }
}

/** Does the owner's entry have any exercises to copy? */
export const hasExercises = (ownerEntry) => keyed(ownerEntry?.data?.plan).length > 0
  || (!ownerEntry?.data?.plan && (ownerEntry?.data?.out?.lifts || []).some(l => l?.uid))

/**
 * Which id the copy takes in the other person's log.
 *
 * The SAME id as the owner's entry when it is free there (or already the copy),
 * so a second add, another device or a retry all land on one entry: ids are
 * derivable on purpose (AGENTS.md §4). When that id holds something they logged
 * themselves, the copy becomes an extra on their day, minted by `extraEntryId`
 * like every other extra; the server refuses to overwrite their own entry anyway.
 */
export function copyIdFor(ownerEntry, theirDay = []) {
  const optId = ownerEntry?.data?.optId
  const live = (theirDay || []).filter(e => e && !e.deleted)
  const takenByThem = (id) => live.some(e => e.id === id && !e.data?.sharedFrom)
  if (!takenByThem(ownerEntry.id)) return ownerEntry.id
  const base = extraEntryId(ownerEntry.date, optId, live)
  if (!takenByThem(base)) return base
  return extraEntryId(ownerEntry.date, optId, live, { fresh: true })
}

/**
 * The other person's copy of the owner's entry. `done: false`, which `isDone` reads
 * as done from its day on (AGENTS.md §4) without it counting as their own mark;
 * the session, the shared facts and the owner's exercises without the owner's
 * weights; none of the owner's numbers, effort or notes.
 */
export function sharedCopy(ownerEntry, { id, session = null, owner = null } = {}) {
  const d = ownerEntry?.data || {}
  const copyId = id || ownerEntry.id
  const data = {
    optId: d.optId,
    slot: copyId === `daily-${ownerEntry.date}` ? 'main' : 'extra',
    name: d.name,
    level: d.level,
    done: false,
    out: sharedOut(d.out, session),
    sharedFrom: { id: owner?.id || 'owner', name: owner?.name || '' },
  }
  if (d.minutes !== undefined) data.minutes = d.minutes
  if (d.training === false) data.training = false
  return copyExercises({ id: copyId, kind: 'daily', date: ownerEntry.date, data }, ownerEntry)
}

/** The owner's entry with someone added to it (or, `remove`, taken off it). */
export function withSharedPerson(ownerEntry, personId, entryId, { remove = false } = {}) {
  const rest = sharedWithOf(ownerEntry).filter(s => s.id !== personId)
  const next = remove ? rest : [...rest, { id: personId, entryId }]
  const data = { ...(ownerEntry.data || {}) }
  if (next.length) data.sharedWith = next
  else delete data.sharedWith
  return { ...ownerEntry, data }
}

/** A tombstone for their copy, the same shape the store writes. */
export const tombstoneOf = (entry, now = new Date().toISOString()) => ({ ...entry, deleted: true, updatedAt: now })

/**
 * Add someone to the owner's workout: their copy first, then the owner's entry
 * names them. In that order so a failure leaves the owner's entry claiming
 * nobody it does not have. A copy that already exists (another device added
 * them, or a retry) is kept as it is, marks and all.
 *
 * `api` is lib/peopleapi.js, injected so this is testable without a server.
 * Resolves `{ copy, ownerEntry }`; the caller writes `ownerEntry` through the
 * owner's own store.
 */
export async function addPerson({ ownerEntry, person, session = null, owner = null, api }) {
  const already = sharedWithOf(ownerEntry).find(s => s.id === person.id)
  if (already) {
    const copy = await api.getPersonEntry(person.id, already.entryId)
    if (copy && !copy.deleted) return { copy, ownerEntry }
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const day = await api.getPersonDay(person.id, ownerEntry.date)
    const id = copyIdFor(ownerEntry, day)
    const existing = day.find(e => e.id === id && !e.deleted && e.data?.sharedFrom)
    try {
      const copy = existing || await api.putPersonEntry(person.id, sharedCopy(ownerEntry, { id, session, owner }))
      return { copy, ownerEntry: withSharedPerson(ownerEntry, person.id, id) }
    } catch (err) {
      // They logged something under that id between the read and the write: read again, once.
      if (err?.code !== 'not-shared' || attempt) throw err
    }
  }
  throw new Error('could not add them')
}

/**
 * Take someone off the owner's workout. Their copy is tombstoned only if they
 * have put nothing of their own on it; otherwise `confirmFn` is asked first, and
 * a no leaves both entries as they were. Resolves the owner's entry to write,
 * or null when nothing should change.
 */
export async function removePerson({ ownerEntry, person, session = null, api, confirmFn }) {
  const link = sharedWithOf(ownerEntry).find(s => s.id === person.id)
  if (!link) return null
  const copy = await api.getPersonEntry(person.id, link.entryId)
  if (copy && !copy.deleted) {
    if (hasOwnMarks(copy, session)) {
      const yes = await confirmFn(`${person.name} has already logged some of this. Take it out of ${person.name}'s log anyway?`)
      if (!yes) return null
    }
    await api.putPersonEntry(person.id, tombstoneOf(copy))
  }
  return withSharedPerson(ownerEntry, person.id, null, { remove: true })
}
