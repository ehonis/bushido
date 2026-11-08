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
 * EXERCISES (the plan's items and set counts, or the logged lifts). What each of
 * them DID (reps, weights, grades, effort, how it felt, notes, gear, done, the
 * owner's WHOOP and Strava) is theirs: the copy leaves it blank and the owner's
 * numbers appear only as placeholders (AGENTS.md §6.4: a number the app could
 * guess is a placeholder, never a value).
 *
 * SYNC. Someone is added with `sync: true` on their link. While it is on, the
 * server keeps the exercises the same on both sides, whichever side changes
 * them (server/sharedsync.js); nothing here merges. Turned off, each side stays
 * as it is, and "Copy my exercises" (`copyExercises`) is the way to bring the
 * owner's over by hand. A link without the flag (shared before sync existed)
 * is off.
 *
 * Pure: no fetch, no React. The sheet (sharedwith.jsx) does the I/O.
 */

import { extraEntryId } from './store.js'
import { localIso } from './dates.js'
import { blankSet, liftMeasure } from './lifts.js'
import { reindex, remapRun } from './prescription.js'

/**
 * Facts of the workout itself, as opposed to how it went for one person. What
 * KIND of workout it was (`activity`, `category`) is one of them: without it
 * the other person's copy of a planned or free-form workout filed under nothing
 * and asked them what sport it was (#74).
 */
export const SHARED_OUT_KEYS = Object.freeze([
  'activity', 'category',
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
    const link = { id: String(id), entryId: String((typeof r === 'object' && r?.entryId) || entry.id) }
    if (typeof r === 'object' && r?.sync === true) link.sync = true
    out.push(link)
  }
  return out
}

/** The people on this entry, named from the list the owner was given. Unknown ids keep their id. */
export function sharedPeopleOn(entry, people = []) {
  return sharedWithOf(entry).map(s => ({ ...s, name: people.find(p => p.id === s.id)?.name || s.id }))
}

/** "Sam", "Sam and Robin", "Sam, Robin and Jo". */
const namesWords = (names) => (names.length <= 1 ? names.join('')
  : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`)

/** "with Sam", "with Sam and Robin": small, for a row or a sheet. Null when it is nobody's but yours. */
export function withLine(entry, people = []) {
  const from = entry?.data?.sharedFrom
  const names = from?.name ? [String(from.name)] : sharedPeopleOn(entry, people).map(p => p.name)
  if (!names.length) return null
  return `with ${namesWords(names)}`
}

/**
 * Is this copy's structure kept in step with the owner's workout? The server's
 * word (`sharedFrom.sync`, server/sharedsync.js `flagged`, #80), since the link
 * that says so is on the owner's entry, which this person cannot read. A copy
 * written before #80 carries no flag: it is in step if the sync ever stamped it
 * (`syncBase`, which nothing else writes).
 */
export function inStep(entry) {
  const from = entry?.data?.sharedFrom
  if (!from || typeof from !== 'object') return false
  if (typeof from.sync === 'boolean') return from.sync
  return Number.isInteger(entry?.data?.syncBase?.rev) && entry.data.syncBase.rev > 0
}

/**
 * The line the other person reads on their own copy, under "with Alex", so they
 * know that an exercise they add or take off changes the owner's workout too
 * (#80). Null on a copy that is not in step, and on anything that is no copy.
 */
export function inStepLine(entry) {
  if (!inStep(entry)) return null
  const name = String(entry.data.sharedFrom.name || '').trim()
  return name ? `Exercises stay in step with ${name}\u2019s` : 'Exercises stay in step with the workout it was shared from'
}

/**
 * The owner's one row about who is on a workout (#80, folded from the "With"
 * chips and one Sync card per person): "Add someone" with nobody on it,
 * "with Sam · in sync", "with Sam · not in sync", or, with sync differing,
 * "with Sam and Jo · Sam in sync". `on` is `sharedPeopleOn(entry, people)`.
 */
export function shareSummary(entry, on = []) {
  if (!on.length) return { title: 'Add someone', sync: null }
  const synced = on.filter(p => isSynced(entry, p.id)).map(p => p.name)
  const sync = synced.length === on.length ? 'in sync' : !synced.length ? 'not in sync' : `${namesWords(synced)} in sync`
  return { title: `with ${namesWords(on.map(p => p.name))}`, sync }
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
  // A number they typed into their plan's sets is their log too (D11), and on a copy
  // so is any weight, typed mark or not: a share never copies the owner's (#80).
  if (planTyped(entry.data?.plan) || (entry.data?.sharedFrom && planWeighed(entry.data?.plan))) return true
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

/** Have they typed a number into any of their plan's sets (`typed`, prescription.js `patchSet`)? */
const planTyped = (plan) => (plan?.blocks || []).some(b => (b?.items || []).some(it => (it?.sets || [])
  .some(s => s?.typed === true && (!blank(s.reps) || !blank(s.seconds) || !blank(s.weight)))))

/** A weight on any lift set of the plan, marked or not (server/sharedsync.js `ownWeight`). */
const planWeighed = (plan) => (plan?.blocks || []).some(b => (b?.items || []).some(it => it?.kind === 'lift'
  && (it?.sets || []).some(s => !blank(s?.weight))))

/** Have they put a number on any of these logged lifts? */
export const liftsMarked = (lifts) => Array.isArray(lifts)
  && lifts.some(l => (l?.sets || []).some(s => !blank(s?.reps) || !blank(s?.seconds) || !blank(s?.weight)))

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

/*
 * What the owner's weight means is the owner's (#58), as the implement-free
 * exercise arriving through sync is (server/sharedsync.js): a copy is in the
 * implement's default, with no mode and no label of the owner's. The box under
 * the weight still offers the switch, from the implement.
 */
const noMode = ({ weightMode: _m, weightLabel: _l, ...rest }) => rest

/** A copy of their own last set: its numbers as a start, but not typed (or ticked) until they type into it. */
const untypedCopy = ({ typed: _t, ticked: _k, ...s }) => ({ ...s, note: '' })

/**
 * One of the owner's sets as it arrives on someone else's side (#111, D F1):
 * the target, never the owner's weight, cue, or anything the owner did. On a
 * workout dated today or earlier (`logged`), a lift set the owner typed into or
 * ticked is the owner's LOG (D11), so it crosses blank, as every lift set the server's sync carries does (server/sharedsync.js
 * `freshItem`, held to this by sharedsync.test.js): carried as a target, the
 * owner's 10 reps read on their side, from the next day on, as reps they lifted.
 * An untouched target crosses as the plan wrote it. On a plan for a later day
 * nothing has been lifted yet: a number typed there is planning (`patchSet`
 * marks every edit), a target like any other, and crosses as one. An
 * interval's numbers are its shape, typed or not, as the server keeps them.
 *
 * @param {string | undefined} kind @param {any} s @param {{ logged?: boolean }} [opts]
 */
export function crossingSet(kind, s, { logged = true } = {}) {
  const { typed, ticked: _k, ...rest } = s || {}
  const owners = logged && kind === 'lift' && typed === true
  return { ...rest, ...(owners ? { reps: null, seconds: null, distance: null } : {}), weight: null, note: '' }
}

/**
 * One of the owner's exercises on their side: the target, not the owner's
 * weight, what it meant, or the planner's note on it ("3x10 at 95 was RPE 6
 * last time", written from the owner's log).
 */
const theirItem = (item, logged) => ({ ...noMode(item), note: '', sets: (item.sets || []).map(x => crossingSet(item.kind, x, { logged })) })

/**
 * The owner's plan as the start of theirs: the exercises, never the owner's
 * numbers, never the owner's `draftId` (lib/drafts.js reads every draftId in a
 * log as a draft already placed THERE, and the draft is the owner's), and never
 * the owner's conversation with the planner or its reasoning about the owner's
 * log (`thread`, `why`, `notes`, `changed`).
 */
function theirPlan(mine, logged) {
  const { draftId: _d, ...plan } = ownerWordsOff(mine)
  return { ...plan, blocks: mine.blocks.map(b => ({ ...b, items: (b.items || []).map(it => theirItem(it, logged)) })) }
}

/**
 * A plan without the words the planner wrote for the person it was made for:
 * its reasoning (`why`), notes, the conversation (`thread`), the request (`ask`),
 * what a revision changed, and its note on each exercise and set. On a copy
 * those are the OWNER's: written from the owner's log, WHOOP recovery and
 * weights included ("Yellow recovery today (51%)…", "3x10 at 95 was RPE 6 last
 * time"), and nothing on them is about the person whose copy it is. A block's
 * note stays: it is the workout's own prose (a warm-up block exists by it) and
 * shared structure (server/sharedsync.js BLOCK_KEYS).
 */
function ownerWordsOff({ why: _w, notes: _n, thread: _t, ask: _a, changed: _c, ...plan }) {
  const blocks = Array.isArray(plan.blocks) ? plan.blocks.map(b => ({
    ...b,
    items: (Array.isArray(b?.items) ? b.items : []).map(it => ({
      ...it, note: '', sets: (Array.isArray(it?.sets) ? it.sets : []).map(x => ({ ...x, note: '' })),
    })),
  })) : plan.blocks
  return { ...plan, why: '', notes: [], blocks }
}

/** One shown plan per stored plan, so a screen given it keeps one object while nothing changed. */
const shownOf = new WeakMap()

/**
 * The plan as THIS log's person sees it (#96): every screen that draws a plan
 * reads it through here (the sheet's editor, notes and model panel, the
 * runner), on the web and the phone. On a copy (`sharedFrom`) the owner's
 * words are left out at display time, because copies shared before
 * `theirPlan` stripped them still carry them. Display only: nothing stored is
 * rewritten (AGENTS.md §4), by reading or by writing. Every write from such a
 * screen goes back through `withStoredWords`, which puts each hidden word back
 * exactly as stored, so the person's edit lands on the stored plan.
 *
 * Words the person wrote with the model on their own copy are theirs, and the
 * sheet stamps them so (`ownWords`, `ownWordsOn`): such a plan is shown whole.
 */
export function planShown(entry) {
  const plan = entry?.data?.plan
  if (!plan || typeof plan !== 'object') return null
  if (!entry.data.sharedFrom || plan.ownWords === true) return plan
  if (!shownOf.has(plan)) shownOf.set(plan, ownerWordsOff(plan))
  return shownOf.get(plan)
}

const WORD_KEYS = ['why', 'notes', 'thread', 'ask', 'changed']

/** `to` with `key` exactly as `from` has it: the same value, or no key when `from` has none. */
function sameKey(to, from, key) {
  if (from && Object.prototype.hasOwnProperty.call(from, key)) return to[key] === from[key] ? to : { ...to, [key]: from[key] }
  if (!Object.prototype.hasOwnProperty.call(to, key)) return to
  const { [key]: _gone, ...rest } = to
  return rest
}

/**
 * A plan edited on a screen that was SHOWN `planShown`, made a write to the
 * stored plan (#96 review 2): the filter is for what is drawn, never for what
 * is stored (AGENTS.md §4). Every word it hid comes back exactly as stored,
 * byte for byte, a key the stored plan never had included: the plan's own
 * (`why`, `notes`, `thread`, `ask`, `changed`) and each exercise's and set's
 * `note`. An exercise is the stored one by its uid, else by its name and which
 * of that name it is (`keyed`), else by its id; a set by its place in it. What
 * the person added has nothing stored to take, and keeps its blank. Anything
 * the filter did not touch (not a copy, or words that are the person's own,
 * `ownWords`, which a model revision on their copy writes) is `next` as it is.
 * Used by every write from those screens: the sheet's editor, on the person's
 * own side and on the owner's view of it, and the runner.
 */
export function withStoredWords(entry, next) {
  const stored = entry?.data?.plan
  if (!next || typeof next !== 'object' || !stored || typeof stored !== 'object') return next
  if (!entry.data.sharedFrom || stored.ownWords === true || next.ownWords === true) return next
  const byUid = new Map()
  const byKey = new Map()
  const byId = new Map()
  for (const { key, item } of keyed(stored)) {
    if (item?.uid) byUid.set(item.uid, item)
    byKey.set(key, item)
    if (item?.id) byId.set(item.id, item)
  }
  const claimed = new Set()
  const claim = (m) => (m && !claimed.has(m) ? (claimed.add(m), m) : null)
  const seen = new Map()
  let plan = next
  for (const k of WORD_KEYS) plan = sameKey(plan, stored, k)
  if (!Array.isArray(next.blocks)) return plan
  const blocks = next.blocks.map(b => ({
    ...b,
    items: (Array.isArray(b?.items) ? b.items : []).map(it => {
      const name = String(it?.name || '')
      const n = (seen.get(name) || 0) + 1
      seen.set(name, n)
      const was = claim(it?.uid && byUid.get(it.uid)) || claim(byKey.get(`${name}#${n}`)) || claim(it?.id && byId.get(it.id))
      if (!was) return it
      const sets = (Array.isArray(it.sets) ? it.sets : []).map((x, i) => (was.sets?.[i] ? sameKey(x, was.sets[i], 'note') : x))
      return { ...sameKey(it, was, 'note'), sets }
    }),
  }))
  return { ...plan, blocks }
}

/**
 * A plan written by the model panel on this person's own copy: its words are
 * now theirs (`planShown` shows them). Anything that is not a copy is as it is.
 */
export const ownWordsOn = (entry, plan) => (entry?.data?.sharedFrom && plan ? { ...plan, ownWords: true } : plan)

/**
 * Who a removal's toast says the exercises stay in step with (lib/removal.js
 * `syncLine`), or null: the other sides of this synced workout, from where the
 * sheet stands (#96, folded out of both sheets). On the owner's side, everyone
 * on it with sync on (`on`, `sharedPeopleOn`); on someone else's side, the owner
 * ("you"); and on the other person's OWN copy, whoever shared it, when the
 * server says it is in step (`inStep`): a removal there reaches the owner's log too.
 */
export function syncedSides(entry, on = [], side = null) {
  if (side) return isSynced(entry, side.id) ? ['you'] : null
  const names = on.filter(p => isSynced(entry, p.id)).map(p => p.name)
  if (names.length) return names
  if (!on.length && inStep(entry)) return [String(entry.data.sharedFrom.name || '').trim() || 'the person who shared it']
  return null
}

/** Their plan with every exercise and set of the owner's that it lacks. Never takes anything out. */
function copyPlan(theirs, mine, logged) {
  if (!mine?.blocks?.length) return theirs
  if (!theirs?.blocks?.length) return theirPlan(mine, logged)
  const have = new Map(keyed(theirs).map(x => [x.key, x.item]))
  const blocks = theirs.blocks.map(b => ({ ...b, items: [...(b.items || [])] }))
  let changed = false
  for (const { key, item, bi } of keyed(mine)) {
    const t = have.get(key)
    if (!t) {
      // A new exercise goes at the end of the same block (a block of the owner's if they have none there).
      while (blocks.length <= bi) blocks.push({ ...mine.blocks[blocks.length], items: [] })
      blocks[bi].items.push(theirItem(item, logged))
      changed = true
    } else if ((item.sets || []).length > (t.sets || []).length) {
      // More sets of the owner's: copies of their own last set, as adding a set does.
      const sets = [...(t.sets || [])]
      while (sets.length < item.sets.length) sets.push(sets.length ? untypedCopy(sets.at(-1)) : crossingSet(item.kind, item.sets[sets.length], { logged }))
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
    // A hold arrives as a hold: its blank sets are seconds, read off the owner's row.
    if (!t) out = [...out, { ...noMode(m), sets: Array.from({ length: want }, () => blankSet(liftMeasure(m))) }]
    else if ((t.sets || []).length < want) {
      const sets = [...(t.sets || [])]
      while (sets.length < want) sets.push(blankSet(liftMeasure(t)))
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
 * they are. The same object back when there is nothing to copy. `today`
 * decides whether the owner's typed numbers are a log or still a plan
 * (`crossingSet`).
 *
 * @param {any} copy @param {any} ownerEntry @param {string} [today]
 */
export function copyExercises(copy, ownerEntry, today = localIso()) {
  const mine = ownerEntry?.data
  if (!copy?.data || copy.deleted || !mine || ownerEntry.deleted) return copy
  if (mine.plan) {
    const before = copy.data.plan
    const logged = !ownerEntry.date || String(ownerEntry.date) <= today
    const plan = copyPlan(before, mine.plan, logged)
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
 * as done once they do something on it or its day has passed (AGENTS.md §4),
 * without it counting as their own mark;
 * the session, the shared facts and the owner's exercises without the owner's
 * weights; none of the owner's numbers, effort or notes.
 */
export function sharedCopy(ownerEntry, { id, session = null, owner = null, today = localIso() } = {}) {
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
  return copyExercises({ id: copyId, kind: 'daily', date: ownerEntry.date, data }, ownerEntry, today)
}

/** Are this workout's exercises kept the same on this person's side? */
export const isSynced = (entry, personId) => sharedWithOf(entry).some(s => s.id === personId && s.sync === true)

/** Is anyone else on this workout: shared by its owner, or someone's copy? Then a set added may cross (#111). */
export const isSharedEntry = (entry) => sharedWithOf(entry).length > 0 || Boolean(entry?.data?.sharedFrom)

/** The owner's entry with someone added to it, synced (or, `remove`, taken off it). */
export function withSharedPerson(ownerEntry, personId, entryId, { remove = false } = {}) {
  const rest = sharedWithOf(ownerEntry).filter(s => s.id !== personId)
  const next = remove ? rest : [...rest, { id: personId, entryId, sync: true }]
  const data = { ...(ownerEntry.data || {}) }
  if (next.length) data.sharedWith = next
  else delete data.sharedWith
  return { ...ownerEntry, data }
}

/** The owner's entry with sync for one person switched on or off. Their place in the list stays. */
export function withSync(ownerEntry, personId, on) {
  const links = sharedWithOf(ownerEntry)
  if (!links.some(s => s.id === personId)) return ownerEntry
  const sharedWith = links.map(s => {
    if (s.id !== personId) return s
    const { sync: _sync, ...link } = s
    return on ? { ...link, sync: true } : link
  })
  return { ...ownerEntry, data: { ...(ownerEntry.data || {}), sharedWith } }
}

/**
 * Which side a shared workout's sheet opens on: the one last viewed on this
 * device (`saved`, a person id or null for the owner's), if that person is still
 * on it. `on` is `sharedPeopleOn(entry, …)`.
 */
export const openSide = (saved, on = []) => (saved && on.some(p => p.id === saved) ? saved : null)

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
 * Take someone off the owner's workout (#96). Nothing they logged is ever lost
 * by it: a copy they have put something of their own on (`hasOwnMarks`) is KEPT
 * in their log as their workout, only no longer linked (the server then flags
 * it not in step, `flagChanges`); one they have not touched is tombstoned, as
 * it holds nothing but the owner's exercises. No question either way: the toast
 * says which (`takeOffWords`), with Undo (`undoTakeOff`).
 *
 * This used to tombstone a logged copy too, after a bare "take it out of Sam's
 * log anyway?" with no Undo: one tap on the owner's phone deleted someone
 * else's sets and weights.
 *
 * Resolves `{ ownerEntry, link, copy, kept }`, or null when they are not on it:
 * the owner's entry to write, the link as it was, and their copy as it was read.
 */
export async function removePerson({ ownerEntry, person, session = null, api }) {
  const link = sharedWithOf(ownerEntry).find(s => s.id === person.id)
  if (!link) return null
  const copy = await api.getPersonEntry(person.id, link.entryId)
  const live = Boolean(copy && !copy.deleted)
  const kept = live && hasOwnMarks(copy, session)
  if (live && !kept) await api.putPersonEntry(person.id, tombstoneOf(copy))
  return { ownerEntry: withSharedPerson(ownerEntry, person.id, null, { remove: true }), link, copy: live ? copy : null, kept }
}

/** What taking someone off did, in the toast: only what is certain. */
export function takeOffWords(person, { kept = false } = {}) {
  return kept
    ? `Took ${person.name} off this workout. It stays in ${person.name}\u2019s log with what ${person.name} logged.`
    : `Took ${person.name} off this workout`
}

/**
 * Undo of `removePerson`: their copy back if it was tombstoned (the copy as it
 * was, stamped now so it wins over the tombstone), then the owner's entry with
 * the link exactly as it was, sync flag included. Resolves the owner's entry to
 * write. `ownerEntry` is the owner's entry NOW, not as it was taken off.
 */
export async function undoTakeOff({ ownerEntry, person, taken, api, now = new Date().toISOString() }) {
  const { link, copy, kept } = taken
  if (copy && !kept) {
    const { deleted: _d, ...back } = copy
    await api.putPersonEntry(person.id, { ...back, updatedAt: now })
  }
  const rest = sharedWithOf(ownerEntry).filter(s => s.id !== person.id)
  return { ...ownerEntry, data: { ...(ownerEntry.data || {}), sharedWith: [...rest, link] } }
}
