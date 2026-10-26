/*
 * Workout drafts: "Write it for me" as something kept on the server.
 *
 * A planning run is a minute of a model reading the log. It used to belong to
 * the page that asked for it, so leaving the page, locking the phone or picking
 * up the laptop threw the minute away. Now the run belongs to a DRAFT: one JSON
 * file in the person's own `drafts/` folder (beside their log, never in it), and
 * the server writes the run's result, or its error, onto that file when the run
 * ends, whether or not anything is still looking.
 *
 * What a draft is NOT:
 *
 *   - Not an entry. Nothing here touches `state.json`. Keeping a draft is the
 *     app's ordinary placement path, on the user's tap (AGENTS.md §7), and the
 *     app discards the draft afterwards.
 *   - Not written by the model. The run has the planner's read-only flags
 *     (agentflags.js); its JSON comes back on stdout and THIS file writes it.
 *
 * Kept ONCE. Keeping is the app's placement, and the app stamps the draft's id
 * on the plan it places (`data.plan.draftId`). Two guards follow from that: a
 * claim (`keep`) that a second device asking for the same draft is refused, and
 * `isKept`, which drops any draft whose id is already on an entry in the log, so
 * a keep made offline (whose discard never reached the server) cannot come back
 * as Ready and be kept twice.
 *
 * Bounded three ways: at most MAX_DRAFTS per person (the oldest one not being
 * written makes room), none older than MAX_AGE_MS, and a draft whose run is not
 * in this process (the server restarted mid-run) reads as failed with a retry,
 * never as "working" forever.
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const MAX_DRAFTS = 8
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
// How long a "keeping it" claim holds a draft out of the list without the entry turning up.
const CLAIM_MS = 2 * 60 * 1000
const RESTARTED = 'The server restarted before this was finished. Nothing else was lost; try again.'

const dirOf = (space) => path.join(space.dir, 'drafts')

/** Ids come off the wire. Anything that could climb out of the folder is refused. */
const sane = (id) => /^d[a-z0-9]{6,40}$/.test(String(id || '')) ? String(id) : null
const fileOf = (dir, id) => path.join(dir, `${id}.json`)
const newId = () => `d${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`

const str = (v, max) => String(v ?? '').trim().slice(0, max)

const fail = (status, message, code = null) => Object.assign(new Error(message), { status, code })

/** What the user picked on the first screen, kept so the draft can be resumed and retried. */
function cleanPicked(list) {
  return (Array.isArray(list) ? list : []).slice(0, 6).map(k => ({
    key: str(k?.key, 120), label: str(k?.label, 120), prompt: str(k?.prompt, 400),
    category: str(k?.category, 40) || null, activity: str(k?.activity, 40) || null,
    group: str(k?.group, 40) || null, hint: str(k?.hint, 200) || null, icon: str(k?.icon, 40) || null,
  })).filter(k => k.label)
}

/** The first words of what they wrote, for a draft's row when nothing was picked. */
const clip = (s, max) => (s.length <= max ? s : `${s.slice(0, max).replace(/\s+\S*$/, '')}…`)

/**
 * Who a draft for several people is for (#59), as the SERVER resolved them:
 * `owner: true` on the owner when the owner is doing it too. A draft for one
 * person keeps `for`, as it always has, so an older one reopens unchanged.
 */
const cleanPeople = (list) => list.slice(0, 8).map(p => ({
  id: str(p?.id, 64), name: str(p?.name, 80), ...(p?.owner ? { owner: true } : {}),
})).filter(p => p.id)

/** A prescription the app sent back (edited, or about to be revised). The thread stays the server's. */
function cleanPres(pres, current) {
  if (!pres || typeof pres !== 'object' || !Array.isArray(pres.blocks)) throw fail(400, 'no plan to save')
  return { ...pres, thread: current?.thread || [], ask: current?.ask || pres.ask || null }
}

function createDrafts({ max = MAX_DRAFTS, maxAgeMs = MAX_AGE_MS, now = () => Date.now() } = {}) {
  // `${file}` → the AbortController of the run writing it, in THIS process only.
  const running = new Map()

  const write = (dir, draft) => {
    fs.mkdirSync(dir, { recursive: true })
    const file = fileOf(dir, draft.id)
    const tmp = `${file}.tmp-${process.pid}`
    fs.writeFileSync(tmp, JSON.stringify(draft, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, file)
    return draft
  }

  const load = (dir, id) => {
    try { return JSON.parse(fs.readFileSync(fileOf(dir, id), 'utf8')) } catch { return null }
  }

  /*
   * Read one draft and settle it. "Working" is only true while this process holds
   * the run; after a restart nothing does, and the draft says so and offers a retry.
   */
  function read(dir, id) {
    if (!sane(id)) return null
    const d = load(dir, id)
    if (!d?.id) return null
    if (d.status === 'working' && !running.has(fileOf(dir, id))) {
      return write(dir, failed(d, RESTARTED))
    }
    return d
  }

  const claimed = (d) => d.keptAt && now() - Date.parse(d.keptAt) < CLAIM_MS

  /**
   * Newest first, without the expired, the kept (`isKept(id)`: its id is on an
   * entry, so it is deleted) and the ones a device is keeping right now.
   */
  function list(dir, { isKept = () => false } = {}) {
    let names = []
    try { names = fs.readdirSync(dir).filter(f => /^d[a-z0-9]+\.json$/.test(f)) } catch { return [] }
    const out = []
    for (const f of names) {
      const d = read(dir, f.slice(0, -5))
      if (!d) continue
      if (isKept(d.id)) { remove(dir, d.id); continue }
      if (claimed(d)) continue
      if (d.status !== 'working' && now() - Date.parse(d.updatedAt || d.createdAt || 0) > maxAgeMs) {
        remove(dir, d.id)
        continue
      }
      out.push(d)
    }
    return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  }

  function remove(dir, id) {
    if (!sane(id)) return false
    const file = fileOf(dir, id)
    running.get(file)?.abort()
    running.delete(file)
    try { fs.unlinkSync(file); return true } catch { return false }
  }

  const stamp = () => new Date(now()).toISOString()

  function failed(d, error) {
    const back = d.run?.kind === 'revise' ? dropPending(d.pres) : d.pres
    return { ...d, status: 'failed', error, pres: back, updatedAt: stamp() }
  }

  // The user's message went onto the thread when the revision started; a failed
  // one takes it off again (it is kept on `run.message`, which the retry reuses).
  const dropPending = (pres) => {
    const thread = pres?.thread || []
    return thread.at(-1)?.role === 'you' ? { ...pres, thread: thread.slice(0, -1) } : pres
  }

  /*
   * Start a run on a draft and return it as "working". `plan` is the server's
   * planner call: ({ kind, draft, message, signal }) → { plan }. Its result is
   * merged here, into whatever the draft holds when it ends, and only if the
   * draft still exists and this is still its run.
   */
  function start(dir, draft, kind, message, plan) {
    const file = fileOf(dir, draft.id)
    const ctrl = new AbortController()
    const runId = crypto.randomBytes(6).toString('hex')
    let pres = draft.pres
    if (kind === 'revise') {
      pres = { ...pres, thread: [...(pres.thread || []), { role: 'you', text: message, at: stamp() }] }
    }
    const working = write(dir, {
      ...draft, pres, status: 'working', error: null, updatedAt: stamp(),
      run: { id: runId, kind, message: kind === 'revise' ? message : null, startedAt: stamp() },
    })
    running.set(file, ctrl)

    const settle = (fn) => {
      if (running.get(file) !== ctrl) return
      running.delete(file)
      const d = load(dir, draft.id)
      if (!d || d.run?.id !== runId || d.status !== 'working') return
      write(dir, fn(d))
    }

    Promise.resolve()
      .then(() => plan({ kind, draft: working, message, signal: ctrl.signal }))
      .then((built) => settle(d => merged(d, kind, built?.plan, built?.remembered)))
      .catch((err) => settle(d => failed(d, String(err?.message || err || 'the planner failed'))))
    return working
  }

  /*
   * What a lift's weight means (#58), on the model's answer. The model is never
   * asked, so every exercise arrives in its implement's default. On a revision an
   * exercise it kept, on the same implement, keeps exactly what it had on the
   * plan it was asked of, a deliberate default included: matched by `uid` where
   * there are uids, else by exercise, each used once. Everything else (all of a
   * first draft, what is new in a revision) gets the person's memory
   * (`remembered`, from `rememberedModes`). Only the value is set; the app checks
   * it against the catalog and labels it (prescription.js `normalizeItem`). The
   * same rule as `reviseWeightModes` in app/src/lib/prescription.js, here so it
   * is on the draft, whatever happens to the page that asked.
   */
  function withWeightModes(before, after, remembered) {
    const items = (blocks) => (Array.isArray(blocks) ? blocks : []).flatMap(b => (Array.isArray(b?.items) ? b.items : []))
    const left = items(before).filter(it => it?.kind === 'lift')
    const take = (it) => {
      const at = it.uid ? left.findIndex(o => o.uid === it.uid) : left.findIndex(o => !o.uid && o.exercise === it.exercise)
      return at < 0 ? null : left.splice(at, 1)[0]
    }
    return after.map(b => (Array.isArray(b?.items) ? {
      ...b,
      items: b.items.map(it => {
        if (it?.kind !== 'lift' || !it.exercise || !it.implement) return it
        const old = take(it)
        const mode = old && old.implement === it.implement ? old.weightMode
          : remembered?.get(`${it.exercise}|${it.implement}`)
        const { weightMode: _m, ...rest } = it
        return mode ? { ...rest, weightMode: mode } : rest
      }),
    } : b))
  }

  /*
   * The model's answer, laid onto the draft the way the planner screen always
   * laid it: on a first draft the first kind picked fills what the model left
   * blank; on a revision the user's own category choice stands, and `changed`
   * becomes the newest line of the thread.
   */
  function merged(d, kind, built, remembered = null) {
    if (!built || !Array.isArray(built.blocks) || !built.blocks.length) {
      return failed(d, 'the planner returned nothing usable')
    }
    if (kind === 'revise') {
      const cur = d.pres || {}
      return {
        ...d, status: 'ready', error: null, updatedAt: stamp(),
        pres: {
          ...cur, ...built,
          blocks: withWeightModes(cur.blocks, built.blocks, remembered),
          category: cur.category || built.category || null,
          activity: cur.activity || built.activity || null,
          ask: cur.ask || null,
          thread: [...(cur.thread || []), { role: 'coach', text: built.changed || 'Rewritten.', at: stamp() }],
        },
      }
    }
    const primary = d.picked[0] || {}
    return {
      ...d, status: 'ready', error: null, updatedAt: stamp(),
      pres: {
        ...built,
        blocks: withWeightModes([], built.blocks, remembered),
        category: built.category || primary.category || null,
        activity: built.activity || primary.activity || null,
        focus: built.focus || d.ask.goal || d.ask.label,
        ask: { kinds: d.picked.map(k => k.label), minutes: d.ask.minutes, goal: d.ask.goal },
        thread: [],
      },
    }
  }

  /** "Write it for me": a new draft, already working. */
  function create(dir, body, plan, opts = {}) {
    const picked = cleanPicked(body?.picked)
    const goal = str(body?.goal, 1000)
    // Kinds are optional since #59: what they wrote is enough on its own.
    if (!picked.length && !goal) throw fail(400, 'say what you want to do')
    const minutes = Math.min(600, Math.max(5, Number(body?.minutes) || 0))
    if (!Number(body?.minutes)) throw fail(400, 'say how long you have')

    // Room first: expired ones go in list(); then the oldest that is not being written.
    const have = list(dir, opts)
    const idle = have.filter(d => d.status !== 'working').reverse()
    while (have.length >= max && idle.length) {
      const old = idle.shift()
      remove(dir, old.id)
      have.splice(have.indexOf(old), 1)
    }
    if (have.length >= max) throw fail(429, `${max} drafts are being written already. Wait for one, or discard one.`)

    const at = stamp()
    const draft = {
      id: newId(), createdAt: at, updatedAt: at, status: 'working', error: null,
      picked,
      ask: {
        kinds: picked.map(k => k.prompt || k.label),
        label: picked.map(k => k.label).join(' + ') || clip(goal, 48),
        minutes, goal,
      },
      context: str(body?.context, 4000),
      for: body?.for ? { id: str(body.for.id, 64), name: str(body.for.name, 80) } : null,
      ...(Array.isArray(body?.people) && body.people.length > 1 ? { people: cleanPeople(body.people) } : {}),
      pres: null, run: null,
    }
    return start(dir, draft, 'write', null, plan)
  }

  /** Change a draft that has a plan: the message goes on the thread now, the answer later. */
  function revise(dir, id, body, plan) {
    const d = read(dir, id)
    if (!d) throw fail(404, 'no such draft')
    if (d.status === 'working') throw fail(409, 'it is still being written')
    if (!d.pres) throw fail(409, 'there is no plan on this draft yet; try again first')
    const message = str(body?.message, 1000)
    if (!message) throw fail(400, 'say what to change')
    const pres = body?.pres ? cleanPres(body.pres, d.pres) : d.pres
    return start(dir, { ...d, pres }, 'revise', message, plan)
  }

  /** Run the failed turn again: the first draft, or the revision that did not come back. */
  function retry(dir, id, plan) {
    const d = read(dir, id)
    if (!d) throw fail(404, 'no such draft')
    if (d.status === 'working') throw fail(409, 'it is still being written')
    if (d.status !== 'failed') throw fail(409, 'nothing to try again')
    if (d.run?.kind === 'revise' && d.pres) return start(dir, d, 'revise', d.run.message, plan)
    return start(dir, { ...d, pres: null }, 'write', null, plan)
  }

  /** The user's own edits in the review step, so another device opens them too. */
  function save(dir, id, pres) {
    const d = read(dir, id)
    if (!d) throw fail(404, 'no such draft')
    if (d.status === 'working') throw fail(409, 'it is still being written')
    if (!d.pres) throw fail(409, 'there is no plan on this draft yet')
    return write(dir, { ...d, pres: cleanPres(pres, d.pres), updatedAt: stamp() })
  }

  /*
   * "Put it on today": claim the draft before the app places it. A draft already
   * on an entry, already claimed, or gone is refused, which is how the second
   * device learns it was kept on the first. `release` hands the claim back when
   * the placement failed (someone else's log, offline), so the draft is not lost.
   */
  function keep(dir, id, { isKept = () => false, release = false } = {}) {
    const d = read(dir, id)
    if (!d) throw fail(404, 'This draft is gone: it was kept or thrown away on another device.', 'kept')
    if (release) return write(dir, { ...d, keptAt: null })
    if (isKept(d.id)) { remove(dir, d.id); throw fail(409, 'This draft is already on the day it was kept for.', 'kept') }
    if (claimed(d)) throw fail(409, 'This draft is being kept on another device.', 'kept')
    if (d.status === 'working') throw fail(409, 'it is still being written')
    return write(dir, { ...d, keptAt: stamp() })
  }

  return {
    list, read, create, revise, retry, save, keep, discard: remove,
    running: (dir, id) => running.has(fileOf(dir, id)),
  }
}

/**
 * Every draft id stamped on a log's entries (`data.plan.draftId`): the drafts that
 * log has kept. A deleted entry counts too: it was kept, then removed, and the
 * draft coming back as Ready would be a decision undone behind their back.
 */
function keptIdsIn(state) {
  const ids = new Set()
  for (const e of Object.values(state?.entries || {})) {
    const id = e?.data?.plan?.draftId
    if (id) ids.add(String(id))
  }
  return ids
}

/*
 * Weight-mode memory (#58) for a whole log, read when an answer lands: for each
 * exercise and implement, the mode of its newest LOGGED row (null for the
 * default). The rule is app/src/lib/lifts.js `rememberedWeightMode`, and
 * drafts.test.js holds the two to the same answers: rows with a number on them,
 * on entries done (not marked undone) and dated on or before `today`. `entries`
 * is the stored log, an object by id.
 */
function rememberedModes(entries, today) {
  const has = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))
  const best = new Map()
  for (const e of Object.values(entries || {})) {
    if (!e || e.deleted || e.kind !== 'daily' || !(String(e.date || '') <= today)) continue
    if (e.data?.done === false && e.data?.undone === true) continue
    const at = `${e.date || ''}|${e.updatedAt || ''}`
    const seen = new Set()
    for (const l of Array.isArray(e.data?.out?.lifts) ? e.data.out.lifts : []) {
      if (!l?.key || !l.implement || !(l.sets || []).some(r => has(r?.reps) || has(r?.seconds) || has(r?.weight))) continue
      const k = `${l.key}|${l.implement}`
      if (seen.has(k)) continue
      seen.add(k)
      const b = best.get(k)
      if (!b || at > b.at) best.set(k, { at, mode: l.weightMode || null })
    }
  }
  return new Map([...best].map(([k, v]) => [k, v.mode]))
}

module.exports = { createDrafts, dirOf, keptIdsIn, rememberedModes, MAX_DRAFTS, MAX_AGE_MS, CLAIM_MS, RESTARTED }
