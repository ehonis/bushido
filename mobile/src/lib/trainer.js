/*
 * THE OWNER AS TRAINER: planning for someone else on the install, and running a
 * workout from more than one person's side, without acting as them.
 *
 * Two logs, never one (AGENTS.md §3). A session the owner plans for
 * someone lands in THEIR log, through `/api/people/:id/entry` (server.js
 * `peopleRoute`), as an ordinary entry carrying `data.plannedBy: { id, name }`,
 * stamped by the server. It arrives `done: false`, which `isDone` reads as done
 * from its day on (§4) without it ever looking like their own tick; it takes the
 * same derivable id the person's own "+" would have given it, and from then on
 * is theirs to edit, log or delete like anything else.
 *
 * In a workout, each person's side is that person's own entry with its own
 * writer: the owner's goes through the owner's store, anyone else's through the
 * people endpoints. Nothing here writes; this file is the arithmetic, and the
 * screens (trainer.jsx, planner.jsx, runner.jsx, workout.jsx)
 * do the I/O.
 *
 * Pure: no fetch, no React.
 */

import { extraEntryId, isDone, doneWhenPlaced, markDone } from './store.js'
import { localIso } from './dates.js'
import { nameFor, titleFor } from './naming.js'
import { levelFor } from './level.js'
import { resolveMinutes } from './minutes.js'
import { optFor } from './menu.js'
import { sharePeople, sharedPeopleOn, addPerson } from './shared.js'
import {
  isLiftOnly, followWeightModes, endCircuit, circuitOnly, circuitEnded, runProgress, prescriptionSteps, finishRun,
  runOutputs, fillOut, blockTimer,
} from './prescription.js'
import { compile, settle } from './timer.js'
import { liftFieldIn } from './lifts.js'
import { hasWorkout } from './workout.js'

/**
 * Who the owner can plan for: the same rule as "With …" (lib/shared.js). Nobody
 * unless this is the owner, on the owner's own log, on an install with someone
 * else on it. Empty while acting as someone and for anyone but the owner.
 */
export const planPeople = (me) => sharePeople(me)

/* ------------------------------------------------------- who it is for */

/*
 * WHO A PLAN IS FOR, since #59 a choice of several: `{ me, others }`, the owner
 * (on by default) and anyone else picked, in the order People lists them. At
 * least one. Four cases, and each keeps to a path that already existed:
 *
 *   - you alone: the owner's own plan, as always;
 *   - one other person: planned into their log (`plannedEntriesFor`), their run;
 *   - you and others: ONE workout in the owner's log, shared with each of them
 *     with sync on (lib/shared.js `addPerson`), so its structure is one thing in
 *     every log and the numbers are each person's own;
 *   - several others: planned into each of their logs, independent copies.
 *
 * More than one person is one model run on the owner's space, told about each
 * of them (server.js `aiTargetFor`); their logs reach it as context only.
 */
export const FOR_ME = Object.freeze({ me: true, others: [] })

/** Tap one person in or out; the last one picked stays picked. `id` null is the owner. */
export function toggleFor(who, person, people = []) {
  const others = who?.others || []
  if (!person?.id) {
    if (who.me && !others.length) return who
    return { ...who, me: !who.me }
  }
  const has = others.some(p => p.id === person.id)
  if (has && !who.me && others.length === 1) return who
  const ids = new Set(others.map(p => p.id))
  if (has) ids.delete(person.id); else ids.add(person.id)
  // People order, not tap order: the same group always reads the same way.
  return { ...who, others: (people || []).filter(p => ids.has(p.id)) }
}

/** Everyone it is for, as people: the owner first (`{ id: null, name: 'You' }`). */
export const forPeopleOf = (who) => [...(who?.me ? [{ id: null, name: 'You' }] : []), ...(who?.others || [])]

/** More than one person, or anyone but the owner. */
export const isGroup = (who) => forPeopleOf(who).length > 1
export const forSomeoneElse = (who) => !who?.me && (who?.others || []).length === 1 ? who.others[0] : null

/**
 * What the server is sent as `for`: nothing for the owner alone, one id for one
 * other person (exactly what every older client sends), a list for a group,
 * with the owner's own id in it when the owner is doing it too.
 */
export function forOf(who, ownerId) {
  if (!isGroup(who)) return forSomeoneElse(who)?.id || null
  return [...(who.me ? [ownerId || 'owner'] : []), ...who.others.map(p => p.id)]
}

/**
 * A draft's people as the For choice holds them. `people` (a group, #59), else
 * `for` (one person, as every draft before #59 has), else the owner's own.
 */
export function whoOfDraft(d, people = []) {
  const known = (p) => people.find(x => x.id === p.id) || { id: p.id, name: p.name }
  if (Array.isArray(d?.people) && d.people.length) {
    return { me: d.people.some(p => p.owner), others: d.people.filter(p => !p.owner).map(known) }
  }
  if (d?.for?.id) return { me: false, others: [known(d.for)] }
  return FOR_ME
}

/** "Sam", "Sam and Robin", "Sam, Robin and Kim". */
export function namesOf(list = []) {
  const names = (list || []).map(p => (typeof p === 'string' ? p : p?.name)).filter(Boolean)
  if (names.length < 2) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * The words the planner's screens use for who it is for, so the button, the
 * line under the title and the last screen cannot disagree.
 */
export function forWords(who) {
  const others = who?.others || []
  const names = namesOf(others)
  if (!others.length) {
    return { keep: 'Put it on today', where: 'on today', title: 'On your day', from: 'your log', line: null, after: 'Nothing has started.' }
  }
  if (who.me) {
    return {
      keep: `Put it on today with ${names}`, where: `on today, with ${names}`, title: `On your day, with ${names}`,
      from: `your log and ${names}’s last week`,
      line: `You and ${names} · one shared workout`,
      after: 'Nothing has started. The exercises stay the same on every side; each of you logs your own numbers.',
    }
  }
  if (others.length === 1) {
    return {
      keep: `Put it on ${names}’s day`, where: `on ${names}’s day`, title: `On ${names}’s day`,
      from: `${names}’s log`, line: `Planning for ${names} · it goes in ${names}’s log`,
      after: `Nothing has started. ${names} can edit or log it.`,
    }
  }
  return {
    keep: `Put it on ${names}’s days`, where: `on ${names}’s days`, title: `On ${names}’s days`,
    from: `${names}’s last week`, line: `Planning for ${names} · a copy goes in each of their logs`,
    after: 'Nothing has started. Each of them can edit or log their own copy.',
  }
}

/* ------------------------------------------------------------- placing */

/**
 * The entries one "put these on the day" makes, ids included, against ONE
 * snapshot of the day plus whatever this call has already placed.
 *
 * The first session on an empty day is its main (`daily-<date>`); everything
 * after is an extra minted by `extraEntryId`. This is App.jsx's `placeAll`
 * without the writes, so the owner planning for someone computes the same ids
 * against THEIR day that their own "+" would have (§4: derivable ids).
 *
 * `items` are `{ optId, data }`; unknown cards are skipped, as there.
 */
export function placeEntries({ menu = [], onDay = [], items = [], date, today = localIso() }) {
  const day = (onDay || []).filter(e => e && e.kind === 'daily' && e.date === date && !e.deleted)
  const written = []
  for (const { optId, data = {} } of items) {
    const opt = (menu || []).find(o => o.id === optId)
    if (!opt) continue
    const seen = [...day, ...written]
    const hasMain = seen.some(e => e.data?.slot !== 'extra')
    const id = hasMain ? extraEntryId(date, opt.id, seen, { fresh: true }) : `daily-${date}`
    const out = data.out || {}
    written.push({
      id, kind: 'daily', date,
      data: {
        optId: opt.id,
        name: nameFor(opt, out),
        minutes: opt.minutes, level: opt.level ?? 1,
        // Done on today or an earlier day; planned on a later one, and done
        // from its day on (`isDone`). A rest day is done whenever it is put
        // down, because choosing it is the whole action.
        done: opt.role === 'rest' || doneWhenPlaced(date, today),
        slot: hasMain ? 'extra' : 'main',
        ...data,
        out,
      },
    })
  }
  return written
}

/**
 * What a kept prescription places, one item per part (`parts` is
 * `splitPrescription(pres)`): the planned card with the plan on it, filed by the
 * part's own category and activity. The owner's keep and someone else's share it.
 */
export const plannedItems = (parts = []) => parts.map(part => ({
  optId: 'planned',
  data: {
    name: part.pres.title,
    minutes: part.pres.minutes || null,
    plan: part.pres,
    out: {
      ...(part.activity ? { activity: part.activity } : {}),
      ...(part.category ? { category: part.category } : {}),
    },
  },
}))

/** The marker on anything the owner planned for someone. The server stamps the real one. */
export const plannedByOf = (owner) => ({ id: String(owner?.id || 'owner'), name: String(owner?.name || '') })

/**
 * The entries a kept prescription becomes in someone else's log: one per part
 * (`parts` is `splitPrescription(pres)`), the same shape App.jsx's `keepPlan`
 * writes into the owner's own, plus `plannedBy`. Written `done: false` (the
 * server would make it so anyway, and `true` would read as their own tick in
 * `hasOwnMarks`); `isDone` reads it as done from its day on.
 */
export function plannedEntriesFor({ parts = [], theirDay = [], menu = [], date, owner, key = null }) {
  // With a `key` (one keep, #59), each part says which part of which keep it is, so a
  // retry can tell what is already on their day; a part that is there is not written again.
  const have = new Set((theirDay || []).filter(e => e && !e.deleted && e.data?.keepKey).map(e => e.data.keepKey))
  const items = plannedItems(parts)
    .map((it, i) => (key ? { ...it, data: { ...it.data, keepKey: `${key}:${i}` } } : it))
    .filter(it => !key || !have.has(it.data.keepKey))
  return placeEntries({ menu, onDay: theirDay, items, date })
    .map(e => ({ ...e, data: { ...e.data, done: false, plannedBy: plannedByOf(owner) } }))
}

/**
 * Write a kept prescription into someone's log. Their day is read first so the
 * ids are the ones their own app would have minted; each part is written
 * through the people endpoint, in order, so a failure part-way leaves what was
 * written and says so: the error carries `written` (how many parts are on their
 * day, counting ones an earlier try put there) and `of` (how many there are).
 *
 * `key` makes it safe to run again (#59, "Try again for Robin"): each part is
 * stamped `data.keepKey = <key>:<part>`, and a part their day already has under
 * that key is not written twice, whether the last try failed part-way or its
 * write landed and only the answer was lost. `api` is lib/peopleapi.js, injected for tests.
 */
export async function keepPlanFor({ person, parts, menu, date, owner, api, key = null }) {
  const theirDay = await api.getPersonDay(person.id, date)
  const mine = key ? (theirDay || []).filter(e => e && !e.deleted && String(e.data?.keepKey || '').startsWith(`${key}:`)) : []
  const entries = plannedEntriesFor({ parts, theirDay, menu, date, owner, key })
  const ids = mine.map(e => e.id)
  for (const e of entries) {
    try {
      ids.push((await api.putPersonEntry(person.id, e)).id)
    } catch (err) {
      throw Object.assign(err instanceof Error ? err : new Error(String(err)), { written: ids.length, of: parts.length })
    }
  }
  return { ids, count: ids.length, first: ids[0] || null }
}

/** A key for one keep, so trying it again cannot place it twice (`keepPlanFor`). */
export const keepKeyFor = (pres) => String(pres?.draftId || `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`)

/**
 * A plan for several people is shared STRUCTURE (#59): each logs their own loads.
 * The model's plans arrive without any (server/planner.js `noLoads`); one built by
 * hand loses them here, on the way into the logs, so both routes keep one rule.
 */
export const withoutLoads = (pres) => (pres ? {
  ...pres,
  blocks: (pres.blocks || []).map(b => ({
    ...b, items: (b.items || []).map(it => ({ ...it, sets: (it.sets || []).map(s => ({ ...s, weight: null })) })),
  })),
} : pres)

/**
 * The owner and others at once: the owner's just-kept entries, each shared with
 * every other person through `addPerson`, sync on, exactly as "With …" on the
 * sheet does it. Each person's copy is written first, then the owner's entry
 * names them (`save`, the owner's own store), so a failure leaves the owner's
 * entry claiming nobody it does not have. One person failing does not stop the
 * next; it is reported, and "With …" on the sheet is where it can be retried.
 * `api` is lib/peopleapi.js, injected for tests.
 */
export async function shareKept({ entries = [], people = [], menu = [], owner, api, save }) {
  const current = [...entries]
  const failed = []
  for (const person of people) {
    for (let i = 0; i < current.length; i++) {
      try {
        const { ownerEntry } = await addPerson({ ownerEntry: current[i], person, session: optFor(menu, current[i].data?.optId), owner, api })
        current[i] = ownerEntry
        save(ownerEntry)
      } catch (e) {
        failed.push({ person, error: e?.message || String(e) })
        break
      }
    }
  }
  return { entries: current, failed }
}

/**
 * Others only: the kept plan written into each person's log in turn (`keep` is
 * `keepPlanFor` for one person). One person failing does not stop the next.
 * Resolves who it landed for (in the order given), who it did not and why, and
 * the first keep's answer, which is what "Open it" opens. Run again with the
 * people in `failed` to try them again; `keep` passes the same key to
 * `keepPlanFor` both times, so nothing already on their day is written twice.
 */
export async function keepForEach({ people = [], keep }) {
  const landed = []
  const failed = []
  let first = null
  for (const person of people) {
    try {
      const kept = await keep(person)
      first = first || kept
      landed.push(person)
    } catch (e) {
      // `written`/`of`: part of it is on their day already (keepPlanFor), and the screen says so.
      failed.push({ person, error: e?.message || String(e), written: e?.written || 0, of: e?.of || 0 })
    }
  }
  return { landed, failed, first }
}

/** "planned by Alex", or "planned by you" for the owner looking at someone's day. Null on anything else. */
export function plannedLine(entry, me = null) {
  const by = entry?.data?.plannedBy
  if (!by) return null
  if (me && !me.acting && me.real?.id && by.id === me.real.id) return 'planned by you'
  return `planned by ${by.name || 'your trainer'}`
}

/* -------------------------------------------------------- writing a side */

/**
 * The owner's `saveOutputs` as a pure function: the out, and the name, level and
 * minutes it implies. The owner's store and someone else's side both write
 * through this, so the two cannot drift (mobile/AGENTS.md: logic is not forked).
 */
export function applyOut(entry, opt, out) {
  // A weight mode switched on a logged lift reaches the plan item it came from (#58).
  const data = followWeightModes(entry.data, { ...entry.data, out }, liftFieldIn(opt))
  return { ...entry, data: {
    ...data,
    level: levelFor(opt, data.out),
    name: titleFor(opt, data.out, data.plan),
    minutes: resolveMinutes(entry.data, opt, data.out),
  } }
}

/**
 * The owner's `savePlan` as a pure function, for either side: the plan, its
 * title as the name, and a weight mode switched on the plan reaching the row its
 * logged sets became (#58, `followWeightModes`).
 */
export function applyPlan(entry, opt, plan) {
  const data = followWeightModes(entry.data, { ...entry.data, plan }, liftFieldIn(opt))
  return { ...entry, data: { ...data, name: plan.title || entry.data?.name } }
}

/**
 * The runner's ONE write (AGENTS.md §6.2) as a pure function: the position, and
 * in the same write the outputs, the done flag and a plan that grew a set.
 */
export function applyRun(entry, opt, run, { out = null, done = undefined, plan = null } = {}) {
  const data = { ...entry.data, run }
  if (plan) { data.plan = plan; data.name = titleFor(opt, data.out || {}, plan) }
  if (out) {
    data.out = out
    data.level = levelFor(opt, out)
    data.minutes = resolveMinutes(entry.data, opt, out)
  }
  if (done !== undefined) return markDone({ ...entry, data }, done)
  return { ...entry, data }
}

/** The done flag alone: the "Mark done" / "Mark undone" tap (`markDone`). */
export const applyDone = (entry, done) => markDone(entry, done)

/**
 * Does this session still offer "Start"?
 *
 * It used to be "while not done", but a session is done from the moment it lands
 * on today (§4), and running it is the point of planning one. So: on today and
 * later, until its run has ended; on an earlier day, only once marked undone.
 */
export const canStart = (entry, today = localIso()) => Boolean(entry && !entry.deleted &&
  !entry.data?.run?.endedAt && ((entry.date && entry.date >= today) || !isDone(entry, today)))

/* -------------------------------------------------------------- sides */

/**
 * The people a workout can be run for, in switcher order: the owner first, then
 * everyone the owner's entry is shared with. Each side is one person's own entry
 * (`entryId` in their log), so each has its own sets, weights, rest clock and
 * done state, and its own writer. Only the owner, on the owner's own log, gets
 * more than one side.
 */
export function workoutSides(entry, me) {
  const you = { id: null, name: 'You', entryId: entry?.id || null, tone: 0 }
  const people = planPeople(me)
  if (!people.length) return [you]
  return [you, ...sharedPeopleOn(entry, me.people).map(p => ({ ...p, tone: toneFor(people, p.id) }))]
}

/**
 * Each person's colour, everywhere the owner sees more than one log: 0 is the
 * owner (the accent), then the validated series colours in the order People
 * lists everyone else. Two tones alternate; the name always goes with it.
 */
export function toneFor(people = [], id = null) {
  if (!id) return 0
  const i = (people || []).findIndex(p => p.id === id)
  return i < 0 ? 1 : (i % 2) + 1
}

/* ------------------------------------------------------- someone's day */

/** Someone's sessions on one day, live ones, main first. Read from their log, never the owner's store. */
export function dayOf(entries = [], date) {
  return (entries || [])
    .filter(e => e && e.kind === 'daily' && e.date === date && !e.deleted)
    .sort((a, b) => (a.data?.slot === 'extra') - (b.data?.slot === 'extra') || String(a.id).localeCompare(String(b.id)))
}

/** A row for the owner's read-only list of someone's day: the name, whether it is done, who planned it. */
export function dayRow(entry, menu = [], me = null) {
  const opt = optFor(menu, entry?.data?.optId)
  return {
    id: entry.id,
    name: entry.data?.name || opt?.name || 'Session',
    done: isDone(entry),
    planned: Boolean(entry.data?.plan),
    plannedBy: plannedLine(entry, me),
    sharedFrom: Boolean(entry.data?.sharedFrom),
    running: Boolean(entry.data?.plan && entry.data?.run?.startedAt && !entry.data.run.endedAt),
  }
}

/**
 * Which screen a session is run in, the same decision DaySessions makes: the
 * runner for a plan with something to run (not lift-only), workout mode for a
 * card that declares a clock, nothing otherwise.
 */
export function runKind(entry, opt) {
  const pres = entry?.data?.plan
  if (pres) return isLiftOnly(pres) ? null : 'runner'
  return hasWorkout(opt) ? 'mode' : null
}

/* ------------------------------------------------- circuits together */

/*
 * A CIRCUIT DONE TOGETHER (#68, the owner's ask: "complete the workout … for
 * both people, not just one at a time"). On a shared workout with sync on, the
 * circuit's start screen offers "Together with Sam": one clock on the screen in
 * front of you, and when it ends, finished or stopped, its result offered to
 * every other side. Off, each side runs its own clock from its own Start.
 *
 * THE TOGETHER RULE, written down after two review rounds in which each fix
 * opened a new way to lose someone's data:
 *
 * 1. TOGETHER FILLS, IT NEVER OVERWRITES. A side gets the result only where it
 *    has nothing of its own. Per exercise and per set, seconds, reps and weight
 *    land only in blanks (`endCircuit` with `fill`, `fillOut`). A side whose
 *    circuit is already ended (`circuitEnded`) or whose own clock is running
 *    (`run.circuit`) is not written at all, and is reported as "already logged"
 *    or "running", which is not a miss and has no Retry. Totals are read off
 *    what is there (`circuitTimes`, set per block), never added to. It is the
 *    shared-sync rule again: logged data is never removed by anyone else's write.
 * 2. DECIDE FROM FRESH DATA. Someone else's side is re-read from the server
 *    (`readPerson`) right before it is written, and rule 1 is applied to THAT,
 *    never to a copy on screen that may hold a write that never landed. A copy
 *    already carrying this run's key with its result in it is done: success, and
 *    nothing is sent. The key without the result is written. Retry is the same.
 * 3. ONLY OFFER IT WHERE IT CAN HELP. Sides already ended or running their own
 *    LIVE clock are left out of "Together" (`togetherSides`), and with nobody
 *    left there is no switch. Only those offered it when it started are
 *    written at its end (`result.with`).
 * 4. A MISS SURVIVES CLOSE. Each one is kept on the device
 *    (`bushido:together-pending`, by run and person) and tried again, the same
 *    way, when the workout next opens, until it lands, but only while the
 *    owner's live entry still carries that run and that person, and for a week
 *    at most (`pendingFor`): the id alone could be a new workout's.
 * 5. HONEST WORDS. "Logged for you", then per person "and Sam", "Sam already
 *    logged it", "Sam is running it" or "Not on Sam's log yet" with Try again
 *    (`togetherSaid`); never "for you and Sam" over a miss.
 *
 * Each side is written through its own path (the owner's `saveRun`, anyone
 * else's people endpoint), one write each at most, so the owner's push fires
 * once and nobody else's at all (§4).
 */

/** Remembered per device: on until someone turns it off. */
export const TOGETHER_KEY = 'bushido:circuit-together'
export const togetherPref = (storage) => {
  try { return storage?.getItem(TOGETHER_KEY) !== '0' } catch { return true }
}
export const saveTogetherPref = (storage, on) => {
  try { storage?.setItem(TOGETHER_KEY, on ? '1' : '0') } catch { /* a choice that cannot be kept is still made */ }
}

/** How long a clock may have run out, unwatched, and still count as someone running it. */
export const STALE_CLOCK_MS = 10 * 60 * 1000

/**
 * A side with its own circuit clock going, not one run together from elsewhere.
 * Live only: paused counts, but one whose program would have run out more than
 * `STALE_CLOCK_MS` ago (a phone put away mid-circuit, never reopened), or that
 * has sat that long on an exercise done to a count (which waits for a tap that
 * never came), does not, or it would block Together for that side forever.
 */
function ownClock(entry, now = Date.now()) {
  const run = entry?.data?.run
  const timer = run?.circuit?.timer
  if (!timer || timer.finishedAt != null || run.circuit.together) return false
  if (timer.pausedAt != null) return true
  const block = (entry.data?.plan?.blocks || []).find(b => b.id === run.circuit.block && b.circuit)
  if (!block) return true
  const settled = settle(compile(blockTimer(block)), timer, now)
  return now - (settled.finishedAt ?? settled.at) <= STALE_CLOCK_MS
}

/** Is this side out of reach of a together run: ended, or running its own clock? */
export const sideTaken = (entry, now = Date.now()) =>
  Boolean(entry && !entry.deleted && (entry.data?.run?.endedAt || ownClock(entry, now)))

/**
 * Who a circuit on this shared workout can be done together with: the sides
 * whose link has sync on, the owner always among them (the shares hang off the
 * owner's entry), less any side already ended or running its own clock
 * (`entryOf(side)`, what the SERVER last said; a side not read yet counts as
 * free, and the write decides again from fresh data). Fewer than two: none.
 */
export function togetherSides(ownerEntry, sides = [], entryOf = () => null) {
  const links = ownerEntry?.data?.sharedWith || []
  const synced = sides.filter(s => !s.id || links.some(l => l?.id === s.id && l.sync))
  const free = synced.filter(s => !sideTaken(s.id ? entryOf(s) : ownerEntry))
  return free.length > 1 ? free : []
}

/** "you", "you and Sam", "you, Sam and Robin". */
export const andWords = (names = []) =>
  (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] || '')

/** The people besides the side on screen: "Sam", or "you" for the owner seen from someone else's side. */
export const togetherNames = (sides = [], here = null) =>
  sides.filter(s => (s.id || null) !== (here || null)).map(s => (s.id ? s.name : 'you'))

/** "Together with Sam", "Together with Sam and Robin". */
export const togetherWords = (sides = [], here = null) => {
  const names = togetherNames(sides, here)
  return names.length ? `Together with ${andWords(names)}` : ''
}

/**
 * What one side's own entry gets from a circuit done together, by rule 1:
 *
 *   { kind: 'write', run, out, done }  write this (its writer's arguments)
 *   { kind: 'done' }      this run's result is already on it: nothing to send
 *   { kind: 'already' }   it logged this circuit itself: leave it be
 *   { kind: 'running' }   its own clock is going: leave it be
 *   { kind: 'none' }      it has no such circuit
 *
 * `result` is `{ block: { uid, id, name }, items: [{ uid, name }], done, at, seconds, key, with }`
 * from the side that ran the clock; `with` is who was offered Together when it
 * started (side ids, null for the owner), and only they are written. The block and each exercise are found here
 * by uid (the sync's identity), then by name, each of this side's exercises
 * taking at most one of the result's. An exercise this side has marked or
 * skipped keeps what it has; a logged row keeps every number on it and gains
 * only blanks. A plan of nothing but circuits whose every exercise is then
 * marked is finished and done in the same write. Weights are THIS side's own.
 */
export function togetherWrite(entry, result, now = Date.now()) {
  const pres = entry?.data?.plan
  if (!pres || entry.deleted || !result) return { kind: 'none' }
  const blocks = (pres.blocks || []).filter(b => b.circuit && b.items?.length)
  const block = (result.block?.uid && blocks.find(b => b.uid === result.block.uid))
    || blocks.find(b => b.name === result.block?.name) || null
  if (!block) return { kind: 'none' }
  const run = entry.data.run || null
  const marked = (it) => Boolean(run?.sets?.[it.sets?.[0]?.id])
  if (run?.circuitKeys?.[block.id] === result.key) {
    // Ours already: done, unless the result never actually landed with the key.
    const meant = result.done.some(d => d?.length)
    if (!meant || block.items.some(it => marked(it))) return { kind: 'done' }
  } else {
    if (ownClock(entry, now)) return { kind: 'running' }
    if (circuitEnded(block, run) || run?.endedAt) return { kind: 'already' }
  }
  const taken = new Set()
  const done = block.items.map(it => {
    let j = it.uid ? result.items.findIndex((x, n) => !taken.has(n) && x.uid === it.uid) : -1
    if (j < 0) j = result.items.findIndex((x, n) => !taken.has(n) && x.name === it.name)
    if (j < 0) return []
    taken.add(j)
    return result.done[j] || []
  })
  const base = run?.circuitKeys?.[block.id] === result.key
    ? { ...run, circuitKeys: { ...run.circuitKeys, [block.id]: null } } : run
  let next = endCircuit(base, pres, block.id, done, { at: result.at, seconds: result.seconds, key: result.key, fill: true })
  const finished = circuitOnly(pres) && runProgress(next, prescriptionSteps(pres)).left === 0
  if (finished) next = finishRun(next, { at: result.at })
  const out = fillOut(entry.data.out || {}, runOutputs(pres, next, {}))
  return { kind: 'write', run: next, out, done: finished ? true : undefined }
}

/**
 * Offer one circuit done together to every side but the one that ran it
 * (`hostId`, null for the owner), by the rule above. The owner's side is the
 * owner's own store (`ownerEntry`), written with `writeOwner(run, opts)`.
 * Anyone else's is re-read first (`readPerson(id)`, their people endpoint) and
 * written with `putPerson(id, entry)` only if rule 1 says so. Resolves
 * `[{ id, name, status }]`, status one of 'logged' (on their log now, by this
 * write or one before), 'already', 'running', 'missed' (could not be read or
 * written: try again) or 'none'. Trying again is this again, with the same
 * `result`, and sends nothing that is already there.
 */
export async function shareCircuit({
  sides = [], hostId = null, result, ownerEntry, writeOwner, readPerson, putPerson, session = null,
}) {
  const said = []
  const status = { write: 'logged', done: 'logged', already: 'already', running: 'running', none: 'none' }
  for (const s of sides) {
    if ((s.id || null) === (hostId || null)) continue
    // Only the people offered Together when the clock started (`result.with`).
    if (Array.isArray(result.with) && !result.with.includes(s.id || null)) continue
    if (!s.id) {
      const w = togetherWrite(ownerEntry, result)
      if (w.kind === 'write') writeOwner(w.run, { out: w.out, done: w.done })
      said.push({ id: null, name: 'you', status: status[w.kind] })
      continue
    }
    let cur
    try { cur = await readPerson(s.id, s.entryId) } catch { said.push({ id: s.id, name: s.name, status: 'missed' }); continue }
    const w = togetherWrite(cur, result)
    if (w.kind !== 'write') { said.push({ id: s.id, name: s.name, status: status[w.kind] }); continue }
    try {
      await putPerson(s.id, applyRun(cur, session, w.run, { out: w.out, done: w.done }))
      said.push({ id: s.id, name: s.name, status: 'logged' })
    } catch {
      said.push({ id: s.id, name: s.name, status: 'missed' })
    }
  }
  return said
}

/**
 * The finish screen's words for a circuit done together (rule 5): the head
 * names who it was logged for, the notes say who already had it or is running
 * their own, and `missed` is who it is not on yet (with Try again). Before the
 * answers are in (`said` null), it is logged for the one who ran it.
 */
export function togetherSaid(host, said = null) {
  const by = (st) => (said || []).filter(x => x.status === st).map(x => x.name)
  const logged = by('logged')
  return {
    head: `Logged for ${andWords([host, ...logged])}`,
    notes: [
      ...by('already').map(n => `${cap(n)} already logged it`),
      ...by('running').map(n => `${cap(n)} ${n === 'you' ? 'are' : 'is'} running it`),
    ],
    missed: by('missed'),
  }
}
const cap = (w) => (w ? w[0].toUpperCase() + w.slice(1) : w)

/*
 * Rule 4: misses kept on the device, by run (`key`) and person, with what is
 * needed to try again without the screen that ran it: whose copy, and the
 * result. Under `bushido:` so signing out takes them with the log.
 */
export const PENDING_KEY = 'bushido:together-pending'
/** A miss older than this is let go: the workout is long over and the note would only nag. */
export const PENDING_DAYS = 7
const readPending = (storage, now = Date.now()) => {
  let list
  try { list = JSON.parse(storage?.getItem(PENDING_KEY) || '[]') } catch { list = [] }
  if (!Array.isArray(list)) list = []
  const fresh = list.filter(p => now - (Number(p?.noted) || Number(p?.result?.at) || 0) <= PENDING_DAYS * 24 * 3600 * 1000)
  if (fresh.length !== list.length) writePending(storage, fresh)
  return fresh
}
const writePending = (storage, list) => {
  try { if (list.length) storage?.setItem(PENDING_KEY, JSON.stringify(list)); else storage?.removeItem(PENDING_KEY) } catch { /* nothing to keep it in */ }
}

/**
 * Is a kept miss still about THIS workout? Only while the owner's live entry
 * still carries that run (`circuitKeys` holds its key for its block) and the
 * person is still on it (`sharedWith`). A workout deleted and planned again on
 * the same day reuses the derivable id, so the id alone is not enough: without
 * this, the morning's numbers would land on the evening's workout.
 */
const stillMeant = (p, ownerEntry) => Boolean(ownerEntry && !ownerEntry.deleted
  && ownerEntry.data?.run?.circuitKeys?.[p.result?.block?.id] === p.result?.key
  && (ownerEntry.data?.sharedWith || []).some(l => l?.id === p.id))

/**
 * The misses waiting for one owner entry (`ownerEntry`, the LIVE one), each
 * still about it; any that is not any more is dropped from the device.
 */
export function pendingFor(storage, ownerEntry, now = Date.now()) {
  const list = readPending(storage, now)
  const id = ownerEntry?.id
  const keep = list.filter(p => p.ownerEntryId !== id || stillMeant(p, ownerEntry))
  if (keep.length !== list.length) writePending(storage, keep)
  return keep.filter(p => p.ownerEntryId === id)
}

/** After a share: keep each miss, forget each person it has now reached (or never will need to). */
export function notePending(storage, { ownerEntryId, result, said = [], people = [], now = Date.now() }) {
  const keyOf = (id) => `${result.key}:${result.block?.uid || result.block?.id}:${id}`
  let list = readPending(storage, now)
  for (const x of said) {
    if (!x.id) continue
    list = list.filter(p => p.k !== keyOf(x.id))
    if (x.status === 'missed') {
      const who = people.find(p => p.id === x.id)
      list.push({ k: keyOf(x.id), ownerEntryId, id: x.id, name: x.name, entryId: who?.entryId || null, result, noted: now })
    }
  }
  writePending(storage, list)
}

/**
 * Try every kept miss for one owner entry again (rule 2: re-read, then fill),
 * one person at a time, only those still about the live `ownerEntry`. Resolves
 * the misses still left.
 */
export async function retryPending({ storage, ownerEntry, readPerson, putPerson, session = null }) {
  for (const p of pendingFor(storage, ownerEntry)) {
    const said = await shareCircuit({
      sides: [{ id: p.id, name: p.name, entryId: p.entryId }], result: p.result, session, readPerson, putPerson,
    })
    notePending(storage, { ownerEntryId: ownerEntry.id, result: p.result, said, people: [{ id: p.id, entryId: p.entryId }] })
  }
  return pendingFor(storage, ownerEntry)
}
