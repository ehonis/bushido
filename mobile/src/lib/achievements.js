/*
 * Achievements — the standing things the user is training FOR.
 *
 * Formerly called "goals", renamed because Totem already has goals and they
 * mean something different. A Totem goal is a period — a week, a quarter — with
 * metrics that roll up and a date it expires. One of these is open-ended: climb
 * 5.12a, finish a half iron. Two things called the same word, one screen apart,
 * is a bug in the vocabulary. See lib/goals.js, which is still Totem's and stays
 * named for them.
 *
 * WHERE THEY LIVE, and why it is two places.
 *
 * `content/plan.json` carries the seeds. It also carries the quota categories,
 * the session catalog and the recommender's weights, and an achievement that owns
 * categories has to sit beside them or the file stops being readable on its own.
 *
 * The STORE carries everything the user does to them — the ones the user adds, the edits the user
 * makes to the seeded two, and tombstones for any the user removes. That is what makes
 * them custom, which is the other half of what the user asked for, and it means a new
 * achievement syncs to their phone like everything else rather than needing a file
 * edit on the box.
 *
 * Merged here, at read time, so neither file has to know about the other.
 *
 * THE FORWARD LIST IS AUTHORITATIVE. `achievement.categories` says which quota
 * categories belong to it. plan.json used to ALSO carry a `goal` back-reference on
 * each category, saying the same thing in the other direction; the two agreed, but
 * only because nothing had edited either yet. A custom achievement has to be able
 * to claim categories without rewriting plan.json, so the back-reference is gone
 * and `achievementOf` derives it.
 */

import { nowIso } from './store.js'

export const KIND = 'achievement'

/** Entry id for an achievement. Stable, so an edit updates rather than duplicates. */
export const entryIdFor = (id) => `achievement-${id}`

const clean = (s) => String(s ?? '').trim()

/** A name to an id: lowercase, hyphenated, and unique against what exists. */
export function idFor(name, taken = []) {
  const base = clean(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    || 'achievement'
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`
}

/** The shape everything downstream expects, with every field present. */
function normalise(raw, seeded) {
  return {
    id: raw.id,
    name: clean(raw.name) || 'Untitled',
    // The short name is what the Progress filter and the chart legends use, where
    // "Half Ironman" does not fit. Falls back to the full name rather than to a
    // truncation, because a truncated name reads as a bug.
    short: clean(raw.short) || clean(raw.name) || 'Untitled',
    icon: clean(raw.icon) || 'Target',
    date: raw.date || null,
    blurb: clean(raw.blurb),
    categories: Array.isArray(raw.categories) ? raw.categories.filter(Boolean) : [],
    // Whether plan.json knows about it. The UI says so, because deleting a seeded
    // one is a different act from deleting one you typed last week — the seed
    // comes back if the tombstone is ever lost.
    seeded,
    createdAt: raw.createdAt || null,
  }
}

const storeRows = (entries) =>
  (entries || []).filter(e => e?.kind === KIND && e?.data?.id)

/**
 * The achievements, seeds merged with their edits.
 *
 * `facts` is the profile entry's facts, read ONLY for `goalDates` — where target
 * dates lived before achievements could hold their own. It is a fallback, never a
 * write target: an achievement that has been edited carries its own date and this
 * is not consulted. Dropping it would have silently cleared the two dates the user had
 * already set, which is the kind of quiet data loss a rename should never cause.
 */
export function achievements(plan, entries = [], facts = null) {
  const seeds = Array.isArray(plan?.achievements) ? plan.achievements : []
  const legacyDates = facts?.goalDates || {}
  const out = new Map()

  for (const s of seeds) {
    if (!s?.id) continue
    out.set(s.id, normalise({ ...s, date: s.date ?? legacyDates[s.id] ?? null }, true))
  }

  for (const e of storeRows(entries)) {
    const id = e.data.id
    if (e.deleted || e.data.deleted) { out.delete(id); continue }
    const seed = out.get(id)
    out.set(id, normalise({
      ...(seed || {}),
      ...e.data,
      // An edited achievement owns its date outright, including clearing it.
      date: 'date' in e.data ? (e.data.date || null) : (seed?.date ?? legacyDates[id] ?? null),
    }, Boolean(seed)))
  }

  // Seeds in plan order, then their own oldest first. Not alphabetical: the order
  // the user added them in is the order the user thinks about them in.
  const seedOrder = new Map(seeds.map((s, i) => [s.id, i]))
  return [...out.values()].sort((a, b) => {
    const ai = seedOrder.has(a.id) ? seedOrder.get(a.id) : Infinity
    const bi = seedOrder.has(b.id) ? seedOrder.get(b.id) : Infinity
    if (ai !== bi) return ai - bi
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
  })
}

/** Which achievement owns this quota category, or null. */
export function achievementOf(catKey, list) {
  if (!catKey) return null
  return (list || []).find(a => a.categories.includes(catKey)) || null
}

/**
 * The category keys an achievement owns, as a Set — or null for "all of them".
 *
 * An id that matches nothing narrows to NOTHING, not to everything. Since the user can
 * delete an achievement while it is the active Progress filter, that case is
 * reachable; a blank page reads as "this filter matches nothing", which is true,
 * where quietly showing everything under a chip naming a deleted achievement
 * reads as the filter being broken. The page clears the stale id anyway — see
 * ProgressView — so this is the belt to that braces.
 */
export function categorySet(list, id) {
  if (!id) return null
  const a = (list || []).find(x => x.id === id)
  return a ? new Set(a.categories) : new Set()
}

/** Categories no achievement has claimed. */
export const unclaimed = (plan, list) =>
  (plan?.quotaCategories || []).filter(c => !achievementOf(c.key, list))

/** A store entry for one achievement. Upsert this to add or edit. */
export function buildEntry(ach) {
  return {
    id: entryIdFor(ach.id),
    kind: KIND,
    date: null,
    updatedAt: nowIso(),
    data: {
      id: ach.id,
      name: clean(ach.name),
      short: clean(ach.short),
      icon: clean(ach.icon) || 'Target',
      date: ach.date || null,
      blurb: clean(ach.blurb),
      categories: Array.isArray(ach.categories) ? ach.categories.filter(Boolean) : [],
      createdAt: ach.createdAt || nowIso(),
    },
  }
}

/**
 * A tombstone.
 *
 * Deleting a SEEDED achievement cannot just drop the entry — plan.json would put
 * it straight back on the next load. So removal is a row that says "gone", which
 * is also what makes the deletion sync to their other devices instead of reappearing
 * the moment one of them writes.
 */
export function buildTombstone(id) {
  return {
    id: entryIdFor(id),
    kind: KIND,
    date: null,
    updatedAt: nowIso(),
    deleted: true,
    data: { id, deleted: true },
  }
}

/** An empty one, for the editor. */
export const blank = () => ({
  id: null, name: '', short: '', icon: 'Target', date: null, blurb: '',
  categories: [], seeded: false, createdAt: null,
})
