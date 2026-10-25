/*
 * SHARED WORKOUTS IN SYNC: one workout's STRUCTURE, seen from two logs.
 *
 * A shared workout is two entries in two people's logs (AGENTS.md §3,
 * app/src/lib/shared.js). With sync on (`sync: true` on the owner's
 * `data.sharedWith` link), adding, removing, renaming or reordering exercises
 * and blocks, and changing how many sets an exercise has, on EITHER side shows
 * up on the other. What each of them did never crosses: reps, weights, times,
 * the run (`data.run`), effort, felt, notes, gear, done and WHOOP/Strava stay in
 * the log they were written in, `done`/`undone`/`doneAt` included (lib/store.js
 * `markDone`): a receiving entry only ever has its plan, its logged lifts, its
 * run's set keys and its `syncBase` rewritten. A set that arrives from the other side is blank
 * (an interval keeps its own last set's shape, since its fields ARE its shape:
 * prescription.js `setFieldsFor`); an exercise that arrives has no numbers.
 *
 * Why it runs on the server. Only the server can write both logs, and only the
 * server sees every write: the owner's devices, the other person's own phone,
 * and the owner writing their side through the people route. The first version
 * of this (server/mirror.js, removed in #15) followed the owner one way and
 * matched exercises by NAME, so a rename was a removal plus an addition and a
 * duplicate name was a guess. This one keys everything on a stable `uid`.
 *
 * IDENTITY. Every block and plan item in a synced entry carries a `uid`, minted
 * here the first time the server sees it and never changed. Plan ids (`b0i1`)
 * are positional and re-minted by every edit (prescription.js `reindex`), so
 * they are never used for matching. An item that arrives without a uid (an
 * older app, a model revision that rebuilt the plan) takes the uid of the
 * same-named item it replaces, if there is one. Logged lifts (`out.lifts`)
 * already have uids (lib/lifts.js).
 *
 * THE RULE. Entries are last-write-wins as a whole, so any device can send back
 * an old list of exercises: a phone that has not pulled, a copy from before sync
 * was on, an app that never knew about sync. A list that merely arrived is not a
 * decision to remove what it lacks. So every synced entry carries
 * `data.syncBase`, `{ of: <entry id>, rev, plan | lifts }`: its structure as the
 * server last wrote it, a new `rev` each time that changes. A device edits the
 * entry and sends back the base it was given, and `intentOf` decides:
 *
 *   - A MATCHING OR OLDER base of this entry is structural intent, applied as a
 *     three-way change: (that base -> what it sent) onto what is stored, so
 *     whatever reached the entry since stays, and only that change is carried.
 *     (A matching base is the case where nothing has; `intentOf` calls it
 *     'current', an older one 'stale'.)
 *   - NO base, a FOREIGN one (another entry's, not a base at all, a different
 *     structure under the same rev) or a FUTURE one (a rev this entry never had),
 *     or a stored entry the sync has not stamped yet, is 'numbers': its numbers,
 *     run, notes and done land on the stored structure. It never removes,
 *     reorders or adds structure, and nothing it does is carried.
 *
 * LOGGED DATA IS NEVER REMOVED BY ANYONE ELSE'S WRITE. A carry keeps an exercise
 * or set the receiving side has logged on; a write keeps an exercise its own
 * device has logged on even when the merge lacks it (on that device's side,
 * not carried), whatever base it sent. When in doubt the structure is kept.
 *
 * Pure: no fs, no clock except `bump`, no I/O. server.js wires it to the writes.
 */
'use strict'

const BLOCK_KEYS = ['name', 'note', 'category', 'activity']
// What an exercise IS. The implement is each person's own (one on a barbell,
// one with dumbbells), like the weight that only means something against it.
const ITEM_KEYS = ['kind', 'name', 'exercise', 'group']
const LIFT_KEYS = ['key', 'name', 'group']
const MAX_SETS = 30

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const blank = (v) => v === undefined || v === null || v === ''
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o?.[k] ?? null]))

let minted = 0
const mintUid = () => `s${Date.now().toString(36)}${(minted++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

const blocksOf = (plan) => (Array.isArray(plan?.blocks) ? plan.blocks.filter(isObj) : [])
const itemsOf = (b) => (Array.isArray(b?.items) ? b.items.filter(isObj) : [])
const setsOf = (x) => (Array.isArray(x?.sets) ? x.sets : [])
const liftsOf = (data) => (Array.isArray(data?.out?.lifts) ? data.out.lifts : null)
const hasPlan = (data) => isObj(data?.plan) && Array.isArray(data.plan.blocks)

/* ------------------------------------------------------------- the shape */

/**
 * The structure of an entry: the plan's blocks and items with their set
 * counts, or (on a session without a plan) the logged lifts with theirs.
 * Null when there is nothing structural on it.
 */
function shapeOf(data) {
  if (!isObj(data)) return null
  if (hasPlan(data)) {
    return {
      plan: blocksOf(data.plan).map(b => ({
        uid: b.uid || null, ...pick(b, BLOCK_KEYS),
        items: itemsOf(b).map(it => ({ uid: it.uid || null, ...pick(it, ITEM_KEYS), sets: setsOf(it).length })),
      })),
    }
  }
  const lifts = liftsOf(data)
  if (lifts) {
    return { lifts: lifts.filter(l => isObj(l) && l.uid).map(l => ({ uid: l.uid, ...pick(l, LIFT_KEYS), sets: setsOf(l).length })) }
  }
  return null
}

/* -------------------------------------------------------------- identity */

/** Give every row a uid: its own, else the unclaimed uid of a same-named row in `ref`, else a new one. */
function stampList(list, ref, keyOf) {
  const own = new Set(list.map(x => x.uid).filter(Boolean))
  const pool = new Map()
  for (const r of ref) {
    if (!r?.uid || own.has(r.uid)) continue
    const k = keyOf(r)
    if (!pool.has(k)) pool.set(k, [])
    pool.get(k).push(r.uid)
  }
  const seen = new Set()
  let changed = false
  const out = list.map(x => {
    if (x.uid && !seen.has(x.uid)) { seen.add(x.uid); return x }
    const uid = pool.get(keyOf(x))?.shift() || mintUid()
    seen.add(uid)
    changed = true
    return { ...x, uid }
  })
  return changed ? out : list
}

function stampPlan(plan, ref) {
  const blocks0 = blocksOf(plan)
  const blocks = stampList(blocks0, blocksOf(ref), b => String(b.name || ''))
  const flat = blocks.flatMap(itemsOf)
  const items = stampList(flat, blocksOf(ref).flatMap(itemsOf), it => String(it.name || ''))
  if (blocks === blocks0 && items === flat) return plan
  let i = 0
  return { ...plan, blocks: blocks.map(b => ({ ...b, items: itemsOf(b).map(() => items[i++]) })) }
}

/** `data` with a uid on every block and plan item, matched against `ref` (what is stored). */
function stampData(data, ref = null) {
  if (!hasPlan(data)) return data
  const plan = stampPlan(data.plan, hasPlan(ref) ? ref.plan : null)
  return plan === data.plan ? data : { ...data, plan }
}

/* --------------------------------------------------------------- helpers */

/** Fill the slots `order`'s members occupy in `list` with them, in `order`'s order. Everything else stays put. */
function follow(list, order) {
  const rank = new Map(order.map((u, i) => [u, i]))
  const slots = []
  list.forEach((x, i) => { if (rank.has(x?.uid)) slots.push(i) })
  const moving = slots.map(i => list[i]).sort((a, b) => rank.get(a.uid) - rank.get(b.uid))
  const out = [...list]
  slots.forEach((i, k) => { out[i] = moving[k] })
  return out
}

/** Do the members `a` and `b` share appear in the same order in both? */
function sameOrder(a, b) {
  const inB = new Set(b)
  const inA = new Set(a)
  return same(a.filter(x => inB.has(x)), b.filter(x => inA.has(x)))
}

/** Put `x` where it sits in `order` (at index `at`): after its nearest earlier neighbour this list has. */
function place(list, x, order, at) {
  for (let j = at - 1; j >= 0; j--) {
    const k = list.findIndex(y => y?.uid === order[j])
    if (k >= 0) { list.splice(k + 1, 0, x); return }
  }
  for (let j = at + 1; j < order.length; j++) {
    const k = list.findIndex(y => y?.uid === order[j])
    if (k >= 0) { list.splice(k, 0, x); return }
  }
  list.push(x)
}

/**
 * The set count after the other side went from `b` to `n`, on a side that has
 * `t`. A side still at `b` takes `n`; a side already at `n` stays (the same
 * change arriving twice); otherwise both changed and the difference is added.
 */
function wantSets(t, b, n) {
  const want = t === b ? n : t === n ? t : t + (n - b)
  return Math.max(1, Math.min(MAX_SETS, want))
}

/* ----------------------------------------------------------------- plans */

const blankPlanSet = (unit = null) => ({ reps: null, weight: null, seconds: null, distance: null, restSec: null, unit, note: '' })

/** A set added from the other side: blank on a lift, a copy of this side's own last set on an interval. */
function newPlanSet(item, sets) {
  const last = sets.at(-1)
  if (item.kind !== 'lift' && last) return { ...last, note: '' }
  return blankPlanSet(last?.unit ?? item.unit ?? null)
}

/*
 * What arrives from the other side is built from an ALLOWLIST, never a spread of
 * what they sent: an exercise is its identity (ITEM_KEYS, uid, unit) and nothing of
 * theirs (implement, note, a run, anything else on the object) lands in this log.
 */
const SHAPE_SET_KEYS = ['reps', 'seconds', 'distance', 'restSec']
const PLAN_META_KEYS = ['v', 'title', 'category', 'activity', 'focus', 'minutes']

/** An exercise arriving from the other side: what it is, none of their numbers. */
function freshItem(s) {
  const rows = setsOf(s).length ? setsOf(s) : [{}]
  const unit = typeof s.unit === 'string' ? s.unit : null
  return {
    uid: s.uid, ...pick(s, ITEM_KEYS), unit,
    // The implement is each person's own; they pick theirs.
    implement: '', implementLabel: null, weightLabel: null, note: '',
    sets: rows.map(x => {
      const setUnit = typeof x?.unit === 'string' ? x.unit : unit
      if (s.kind === 'lift') return blankPlanSet(setUnit)
      // An interval's targets are its shape (prescription.js setFieldsFor); never a weight.
      return { ...blankPlanSet(setUnit), ...pick(x, SHAPE_SET_KEYS) }
    }),
  }
}

/** A logged lift arriving from the other side: which exercise, blank sets. */
const freshLift = (s) => ({
  uid: s.uid, ...pick(s, LIFT_KEYS), implement: '',
  sets: Array.from({ length: Math.max(1, setsOf(s).length) }, blankLiftSet),
})

const freshBlock = (s, uid) => ({
  uid, name: s?.name ?? '', note: s?.note ?? '', category: s?.category ?? null, activity: s?.activity ?? null,
  ...(s?.keep ? { keep: true } : {}), items: [],
})

function indexPlan(shape) {
  const blocks = new Map()
  const items = new Map()
  shape.forEach((b, bi) => {
    if (b.uid) blocks.set(b.uid, { ...b, at: bi })
    b.items.forEach((it, ii) => { if (it.uid) items.set(it.uid, { ...it, block: b.uid, at: ii }) })
  })
  return { blocks, items }
}

/** item uid → indexes of its sets this side has logged in its run. */
function loggedOf(plan, run) {
  const marked = new Set(Object.keys(run?.sets || {}))
  const out = new Map()
  for (const it of blocksOf(plan).flatMap(itemsOf)) {
    const idx = new Set()
    setsOf(it).forEach((s, i) => { if (s?.id && marked.has(s.id)) idx.add(i) })
    if (idx.size) out.set(it.uid, idx)
  }
  return out
}

/**
 * `target` (a full plan) with the change from `base` to `next` (plan shapes)
 * applied. `src` is the full plan `next` was taken from, for what is new.
 * `logged` (receiving side only) protects exercises and sets it has logged on:
 * a removal or a shorter set count never takes away somebody's numbers.
 */
function applyPlan(target, base, next, src, logged = null) {
  const B = indexPlan(base)
  const N = indexPlan(next)
  const srcItems = new Map(blocksOf(src).flatMap(itemsOf).map(it => [it.uid, it]))
  const srcBlocks = new Map(blocksOf(src).map(b => [b.uid, b]))
  const keeps = (uid) => Boolean(logged?.get(uid)?.size)
  let blocks = blocksOf(target).map(b => ({ ...b, items: [...itemsOf(b)] }))
  const find = (uid) => {
    for (const b of blocks) {
      const i = b.items.findIndex(x => x.uid === uid)
      if (i >= 0) return { b, i }
    }
    return null
  }
  const orderIn = (blockUid) => (next.find(b => b.uid === blockUid)?.items || []).map(i => i.uid)

  // Taken out on the other side: out here too, unless this side logged on it.
  for (const uid of B.items.keys()) {
    if (N.items.has(uid) || keeps(uid)) continue
    const at = find(uid)
    if (at) at.b.items.splice(at.i, 1)
  }

  // New blocks, where they sit on the other side.
  for (const [uid, nb] of N.blocks) {
    if (B.blocks.has(uid) || blocks.some(b => b.uid === uid)) continue
    place(blocks, freshBlock(srcBlocks.get(uid), uid), next.map(b => b.uid), nb.at)
  }

  // A block renamed (or re-noted, or moved to another quota) over there.
  for (const [uid, nb] of N.blocks) {
    const bb = B.blocks.get(uid)
    const tb = blocks.find(b => b.uid === uid)
    if (!bb || !tb) continue
    for (const k of BLOCK_KEYS) if (!same(bb[k], nb[k])) tb[k] = nb[k]
  }

  // Exercises both sides had: renamed, more or fewer sets, moved to another block.
  for (const [uid, ni] of N.items) {
    const bi = B.items.get(uid)
    const at = bi && find(uid)
    if (!at) continue
    const item = { ...at.b.items[at.i] }
    for (const k of ITEM_KEYS) if (!same(bi[k], ni[k])) item[k] = ni[k]
    if (bi.sets !== ni.sets) {
      const sets = [...setsOf(item)]
      const want = wantSets(sets.length, bi.sets, ni.sets)
      const mine = logged?.get(uid)
      while (sets.length < want) sets.push(newPlanSet(item, sets))
      while (sets.length > want && !mine?.has(sets.length - 1)) sets.pop()
      item.sets = sets
    }
    const dest = bi.block !== ni.block && blocks.find(b => b.uid === ni.block)
    if (dest && dest !== at.b) {
      at.b.items.splice(at.i, 1)
      place(dest.items, item, orderIn(ni.block), ni.at)
    } else {
      at.b.items[at.i] = item
    }
  }

  // New exercises, after the same neighbour as over there.
  for (const [uid, ni] of N.items) {
    if (B.items.has(uid) || find(uid) || !srcItems.has(uid)) continue
    let dest = blocks.find(b => b.uid === ni.block) || blocks.at(-1)
    if (!dest) { dest = freshBlock(srcBlocks.get(ni.block), ni.block); blocks.push(dest) }
    place(dest.items, freshItem(srcItems.get(uid)), orderIn(ni.block), ni.at)
  }

  // Reordered over there: this side follows, around anything only it has.
  for (const nb of next) {
    const tb = blocks.find(b => b.uid === nb.uid)
    const bb = B.blocks.get(nb.uid)
    if (!tb || !bb) continue
    const order = nb.items.map(i => i.uid)
    if (!sameOrder(base[bb.at].items.map(i => i.uid), order)) tb.items = follow(tb.items, order)
  }
  if (!sameOrder(base.map(b => b.uid), next.map(b => b.uid))) blocks = follow(blocks, next.map(b => b.uid))

  // A block taken out over there goes once nothing of this side's is left in it.
  blocks = blocks.filter(b => !(B.blocks.has(b.uid) && !N.blocks.has(b.uid) && !b.items.length))
  return { ...target, blocks }
}

/** Positional ids, as prescription.js `reindex` mints them. */
function reindex(plan) {
  return {
    ...plan,
    blocks: blocksOf(plan).map((b, bi) => ({
      ...b,
      id: `b${bi}`,
      items: itemsOf(b).map((it, ii) => ({
        ...it,
        id: `b${bi}i${ii}`,
        sets: setsOf(it).map((s, si) => ({ ...s, id: `b${bi}i${ii}s${si}` })),
      })),
    })),
  }
}

/** set id → "<item uid>#<set index>". */
function setKeys(plan) {
  const m = new Map()
  for (const it of blocksOf(plan).flatMap(itemsOf)) setsOf(it).forEach((s, i) => { if (s?.id) m.set(s.id, `${it.uid}#${i}`) })
  return m
}

/** A run re-keyed from one version of the plan to another, by item uid and set index. */
function remapRun(run, before, after) {
  if (!isObj(run)) return run
  const old = setKeys(before)
  const nxt = new Map([...setKeys(after)].map(([id, k]) => [k, id]))
  const move = (id) => nxt.get(old.get(id))
  const out = { ...run }
  if (isObj(run.sets)) {
    out.sets = {}
    for (const [id, v] of Object.entries(run.sets)) { const to = move(id); if (to) out.sets[to] = v }
  }
  if (Array.isArray(run.skipped)) out.skipped = run.skipped.map(move).filter(Boolean)
  if (run.cursor) out.cursor = move(run.cursor) || null
  return out
}

/* ----------------------------------------------------------------- lifts */

const blankLiftSet = () => ({ reps: '', weight: '' })
const liftSetMarked = (s) => !blank(s?.reps) || !blank(s?.weight)

/** The logged-lifts version of `applyPlan`. `protect` keeps rows and sets with numbers on them. */
function applyLifts(target, base, next, src, protect) {
  const B = new Map(base.map((l, i) => [l.uid, { ...l, at: i }]))
  const N = new Map(next.map((l, i) => [l.uid, { ...l, at: i }]))
  const srcBy = new Map((src || []).filter(l => l?.uid).map(l => [l.uid, l]))
  let rows = target.filter(l => !(l?.uid && B.has(l.uid) && !N.has(l.uid) && !(protect && setsOf(l).some(liftSetMarked))))
  rows = rows.map(l => {
    const b = B.get(l?.uid)
    const n = N.get(l?.uid)
    if (!b || !n) return l
    const row = { ...l }
    for (const k of LIFT_KEYS) if (!same(b[k], n[k])) row[k] = n[k]
    if (b.sets !== n.sets) {
      const sets = [...setsOf(l)]
      const want = wantSets(sets.length, b.sets, n.sets)
      while (sets.length < want) sets.push(blankLiftSet())
      while (sets.length > want && !(protect && liftSetMarked(sets.at(-1)))) sets.pop()
      row.sets = sets
    }
    return row
  })
  const order = next.map(l => l.uid)
  for (const [uid, n] of N) {
    if (B.has(uid) || rows.some(l => l?.uid === uid) || !srcBy.has(uid)) continue
    const s = srcBy.get(uid)
    place(rows, freshLift(s), order, n.at)
  }
  if (!sameOrder(base.map(l => l.uid), order)) rows = follow(rows, order)
  return rows
}

/* ------------------------------------------------------- the three moves */

/**
 * The receiving side: `target` (an entry's data) with the change the other
 * side made (structure `before` → its data `after`) applied. The same object
 * back when nothing changes.
 */
function carry(target, before, after) {
  const next = shapeOf(after)
  if (!isObj(target) || !next) return target
  if (next.plan) {
    if (target.plan && !hasPlan(target)) return target
    // A side with no plan yet takes what the other's IS (title, kind of session), its
    // exercises arriving below. Not its draftId (a draft belongs to the log it was
    // planned in, server/drafts.js), its thread or its reasoning: those are theirs.
    const meta = Object.fromEntries(PLAN_META_KEYS.filter(k => after.plan[k] !== undefined).map(k => [k, after.plan[k]]))
    const tPlan = hasPlan(target) ? target.plan : { ...meta, why: '', notes: [], blocks: [] }
    const base = hasPlan(target) ? (before?.plan || []) : []
    const plan = reindex(applyPlan(tPlan, base, next.plan, after.plan, loggedOf(tPlan, target.run)))
    if (same(plan, target.plan)) return target
    const data = { ...target, plan }
    if (target.run) data.run = remapRun(target.run, tPlan, plan)
    return data
  }
  if (hasPlan(target)) return target
  const rows = applyLifts(liftsOf(target) || [], before?.lifts || [], next.lifts, liftsOf(after), true)
  if (same(rows, liftsOf(target) || [])) return target
  return { ...target, out: { ...(target.out || {}), lifts: rows } }
}

/* --------------------------------------------- the writing side's intent */

/** The structure part of a `syncBase` (`{ plan }` or `{ lifts }`), comparable with `shapeOf`. */
const shapePart = (b) => (Array.isArray(b?.plan) ? { plan: b.plan } : Array.isArray(b?.lifts) ? { lifts: b.lifts } : null)

/** A base the server wrote for THIS entry: `{ of: <entry id>, rev, plan | lifts }`. */
const isBase = (b, id) => isObj(b) && b.of === id && Number.isInteger(b.rev) && b.rev > 0 && Boolean(shapePart(b))

/**
 * THE RULE (see the top of this file). What a write may do to the structure:
 *
 *   'current'  its base is the stored entry's base: the device saw the latest
 *              structure, so whatever structure it sent is what it means.
 *   'stale'    its base is an EARLIER base the server wrote for this entry: the
 *              device's change is (that base -> what it sent), applied onto what
 *              is stored; whatever reached the entry since stays.
 *   'numbers'  anything else: no base, a base for another entry, a base newer
 *              than or different from what this entry has had, or a stored entry
 *              the sync has never stamped. It lands per-person data only.
 */
function intentOf(stored, incoming, id) {
  const cur = stored?.syncBase
  const sent = incoming?.syncBase
  if (!isBase(cur, id) || !isBase(sent, id)) return 'numbers'
  if (sent.rev === cur.rev) return same(shapePart(sent), shapePart(cur)) ? 'current' : 'numbers'
  return sent.rev < cur.rev ? 'stale' : 'numbers'
}

/** Their sets laid onto the stored item's count; never fewer than they have logged (`keep`: indexes). */
function setsOnto(storedSets, sentSets, keep = null) {
  const n = Math.max(storedSets.length, keep?.size ? Math.max(...keep) + 1 : 0)
  return sentSets.length >= n ? sentSets.slice(0, n) : [...sentSets, ...storedSets.slice(sentSets.length, n)]
}

/**
 * The structure `merged` (stored, or stored with the device's change applied),
 * carrying the device's own per-person data: its numbers on every exercise it
 * has, its run re-keyed, its implement and notes. An exercise the device has
 * logged on but `merged` lacks is kept where the device had it, whatever its
 * base said: logged data is never removed by anyone else's write. It stays on
 * the device's own side and is not carried.
 */
function landPlan(merged, incoming) {
  const sent = new Map(blocksOf(incoming.plan).flatMap(itemsOf).map(it => [it.uid, it]))
  const logged = loggedOf(incoming.plan, incoming.run)
  const blocks = blocksOf(merged).map(b => ({
    ...b,
    items: itemsOf(b).map(it => {
      const x = sent.get(it.uid)
      return x ? { ...x, ...pick(it, ITEM_KEYS), uid: it.uid, sets: setsOnto(setsOf(it), setsOf(x), logged.get(it.uid)) } : it
    }),
  }))
  const inMerged = new Set(blocks.flatMap(b => b.items.map(i => i.uid)))
  const sentBlocks = shapeOf(incoming).plan
  for (const sb of sentBlocks) {
    sb.items.forEach((si, at) => {
      if (inMerged.has(si.uid) || !logged.has(si.uid)) return
      let dest = blocks.find(b => b.uid === sb.uid) || blocks.at(-1)
      if (!dest) { dest = { ...freshBlock(sb, sb.uid) }; blocks.push(dest) }
      place(dest.items, sent.get(si.uid), sb.items.map(i => i.uid), at)
    })
  }
  const plan = reindex({ ...incoming.plan, blocks })
  const data = { ...incoming, plan }
  if (incoming.run) data.run = remapRun(incoming.run, incoming.plan, plan)
  return data
}

/** `landPlan` for logged lifts. */
function landLifts(merged, incoming) {
  const sent = new Map(liftsOf(incoming).filter(l => l?.uid).map(l => [l.uid, l]))
  const rows = merged.map(l => {
    const x = sent.get(l?.uid)
    if (!x) return l
    const marked = new Set(setsOf(x).map((s, i) => (liftSetMarked(s) ? i : -1)).filter(i => i >= 0))
    return { ...x, ...pick(l, LIFT_KEYS), uid: l.uid, sets: setsOnto(setsOf(l), setsOf(x), marked) }
  })
  const order = liftsOf(incoming).map(l => l?.uid)
  liftsOf(incoming).forEach((l, at) => {
    if (!isObj(l) || rows.some(r => r?.uid && r.uid === l.uid) || !setsOf(l).some(liftSetMarked)) return
    place(rows, l, order, at)
  })
  return { ...incoming, out: { ...incoming.out, lifts: rows } }
}

/**
 * The writing side: what a device sent (`incoming`, stamped) laid onto what is
 * stored (`stored`), for entry `id`. Returns `{ data, carry, intent }`: `data`
 * to write; `carry` the data whose structure may travel to the other side, or
 * null when this write expresses no structural intent.
 */
function rebase(stored, incoming, id) {
  const intent = intentOf(stored, incoming, id)
  const now = shapeOf(stored)
  const mine = shapeOf(incoming)
  // Nothing stored to protect: what it sent stands (and travels only with intent).
  if (!now) return { data: incoming, carry: intent === 'numbers' ? null : incoming, intent }
  // It sent no structure at all (an app that never had the plan): the stored one stays.
  if (!mine) return { data: keepStructure(stored, incoming), carry: null, intent: 'numbers' }
  if (mine.plan && now.plan) {
    const merged = intent === 'current' ? incoming.plan
      : intent === 'stale' ? applyPlan(stored.plan, incoming.syncBase.plan, mine.plan, incoming.plan)
      : stored.plan
    const structural = intent === 'numbers' ? null : landPlan(merged, { ...incoming, run: null })
    return { data: landPlan(merged, incoming), carry: structural, intent }
  }
  if (mine.lifts && now.lifts) {
    const merged = intent === 'current' ? liftsOf(incoming)
      : intent === 'stale' ? applyLifts(liftsOf(stored), incoming.syncBase.lifts, mine.lifts, liftsOf(incoming), false)
      : liftsOf(stored)
    const unmarked = { ...incoming, out: { ...incoming.out, lifts: liftsOf(incoming).map(l => (isObj(l) ? { ...l, sets: setsOf(l).map(blankLiftSet) } : l)) } }
    return { data: landLifts(merged, incoming), carry: intent === 'numbers' ? null : landLifts(merged, unmarked), intent }
  }
  // A plan on one side and logged lifts on the other: never a structural write.
  return { data: keepStructure(stored, incoming), carry: null, intent: 'numbers' }
}

/** What it sent, on the stored structure: the stored plan, or the stored logged lifts. */
function keepStructure(stored, incoming) {
  if (hasPlan(stored)) return { ...incoming, plan: stored.plan }
  return { ...incoming, out: { ...(incoming.out || {}), lifts: liftsOf(stored) } }
}

/**
 * Sync switched on (someone added, or the toggle turned back on): their side
 * takes the owner's uids (matched by name where it has none) and every
 * exercise and set of the owner's it lacks. Only adds, like "Copy my
 * exercises", which sync replaces; from then on changes travel both ways.
 */
function align(owner, copy) {
  const o = shapeOf(owner)
  if (!o || !isObj(copy)) return copy
  if (o.plan) {
    const c = hasPlan(copy) ? stampData(copy, owner) : copy
    const cs = shapeOf(c)?.plan || []
    const blocks = new Set(cs.map(b => b.uid))
    const count = new Map(cs.flatMap(b => b.items.map(i => [i.uid, i.sets])))
    const base = o.plan.filter(b => blocks.has(b.uid))
      .map(b => ({ ...b, items: b.items.filter(i => count.has(i.uid)).map(i => ({ ...i, sets: Math.min(i.sets, count.get(i.uid)) })) }))
    return carry(c, { plan: base }, owner)
  }
  const cs = shapeOf(copy)?.lifts || []
  const count = new Map(cs.map(l => [l.uid, l.sets]))
  const base = o.lifts.filter(l => count.has(l.uid)).map(l => ({ ...l, sets: Math.min(l.sets, count.get(l.uid)) }))
  return carry(copy, { lifts: base }, owner)
}

/* ----------------------------------------------------- whole-log writes */

/** The people a shared workout is synced with: `[{ id, entryId }]`. Links without `sync: true` (older shares too) are not. */
function syncedLinks(entry) {
  const raw = entry && !entry.deleted && Array.isArray(entry.data?.sharedWith) ? entry.data.sharedWith : []
  return raw.filter(r => isObj(r) && r.id && r.sync === true).map(r => ({ id: String(r.id), entryId: String(r.entryId || entry.id) }))
}

/**
 * One millisecond past an entry's own `updatedAt`: enough to beat the version it
 * replaces, no more. Never the sender's time or the server's clock. A carried
 * change stamped at the sender's time would beat the receiver's own write saved
 * earlier but arriving later (offline sets, a phone with a slow clock), and
 * last-write-wins would throw the receiver's numbers away. The structure needs
 * no timestamp to survive that write: its stale `syncBase` keeps it (`rebase`).
 */
function bump(stamp) {
  const t = Date.parse(stamp || '')
  return new Date((Number.isFinite(t) ? t : 0) + 1).toISOString()
}

const withoutBase = ({ syncBase: _b, ...rest }) => rest

/**
 * The `syncBase` to store with `data` on entry `id`, given the one stored before
 * (`prev`): the same base while the structure is unchanged, the next revision
 * when it changed. A device sends back the base it was given; that is how the
 * server tells a current write from a stale one (`intentOf`).
 */
function nextBase(id, prev, data) {
  const shape = shapeOf(data)
  if (!shape) return undefined
  const was = isBase(prev, id) ? prev : null
  if (was && same(shapePart(was), shape)) return was
  return { of: id, rev: (was?.rev || 0) + 1, ...shape }
}

/** `data` as written, with its `syncBase`. Bumped when it no longer equals what was sent. */
function settle(entry, data, prevBase) {
  const out = { ...data }
  const base = nextBase(entry.id, prevBase, data)
  if (base) out.syncBase = base
  else delete out.syncBase
  if (same(out, entry.data)) return entry
  const moved = !same(withoutBase(out), withoutBase(entry.data))
  return { ...entry, data: out, updatedAt: moved ? bump(entry.updatedAt) : entry.updatedAt }
}

/**
 * After a write to someone's log has been merged (`prev` → `next`, the ids the
 * write carried): every synced shared entry it changed is rebased and stamped,
 * and the structural changes to carry to the other side are listed.
 *
 * `linksOf(entry, prevEntry)` says what an entry is linked to, or null:
 * `{ wasSynced, to: [carry targets, `align: true` where sync just came on],
 * ref? }`. On the owner's log those are its synced links; on anyone else's the
 * owner's entry that links this copy with sync on (`ref` is its data). Returns
 * `{ state, carries }`; `state` is `next` itself when nothing changed.
 */
function onWrite(prev, next, ids, linksOf) {
  let entries = null
  const carries = []
  for (const id of ids) {
    const e = next.entries?.[id]
    const was = prev.entries?.[id]
    if (!e || e === was || e.deleted || e.kind !== 'daily' || !isObj(e.data)) continue
    // A full-log push re-sends every entry; one that came back unchanged is not a write.
    if (was && same(e, was)) continue
    const link = linksOf(e, was)
    if (!link) continue
    const live = was && !was.deleted && isObj(was.data) ? was : null
    // A copy takes the owner's uids for anything it has none for, so a write
    // landing just as sync is switched on cannot mint uids of its own that the
    // alignment would then see as different exercises.
    const ref = link.ref ? { plan: { blocks: [...blocksOf(live?.data?.plan), ...blocksOf(link.ref.plan)] } } : live?.data
    let data = stampData(e.data, ref)
    // Only a write that expresses structural intent (`intentOf`) changes or carries structure.
    let structural = live ? null : data
    if (live && link.wasSynced) ({ data, carry: structural } = rebase(live.data, data, id))
    else if (live) structural = data
    const wrote = settle(e, data, live?.data?.syncBase)
    if (wrote !== e) { entries = entries || { ...next.entries }; entries[id] = wrote }
    const before = live && link.wasSynced ? shapeOf(live.data) : null
    const changed = Boolean(before && structural && !same(before, shapeOf(structural)))
    for (const to of link.to) {
      if (to.align) carries.push({ ...to, align: true, after: wrote.data })
      else if (changed) carries.push({ ...to, before, after: structural })
    }
  }
  return { state: entries ? { ...next, entries } : next, carries }
}

/**
 * One carry landing on the receiving entry. `accept(entry)` says whether this
 * entry may be written (a live shared copy; the owner's entry still synced
 * with the sender). The state back unchanged when there is nothing to do.
 */
function receive(state, entryId, c, accept) {
  const e = state.entries?.[entryId]
  if (!e || e.deleted || e.kind !== 'daily' || !isObj(e.data) || !accept(e)) return state
  const data = c.align ? align(c.after, e.data) : carry(stampData(e.data, c.after), c.before, c.after)
  const base = nextBase(entryId, e.data.syncBase, data)
  const out = { ...data }
  if (base) out.syncBase = base
  else delete out.syncBase
  if (same(out, e.data)) return state
  return { ...state, entries: { ...state.entries, [entryId]: { ...e, data: out, updatedAt: bump(e.updatedAt) } } }
}

module.exports = { shapeOf, stampData, carry, rebase, intentOf, nextBase, align, syncedLinks, onWrite, receive, bump }
