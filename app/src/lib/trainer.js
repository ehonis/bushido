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
import { sharePeople, sharedPeopleOn } from './shared.js'
import { isLiftOnly, followWeightModes } from './prescription.js'
import { liftFieldIn } from './lifts.js'
import { hasWorkout } from './workout.js'

/**
 * Who the owner can plan for: the same rule as "With …" (lib/shared.js). Nobody
 * unless this is the owner, on the owner's own log, on an install with someone
 * else on it. Empty while acting as someone and for anyone but the owner.
 */
export const planPeople = (me) => sharePeople(me)

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

/** The marker on anything the owner planned for someone. The server stamps the real one. */
export const plannedByOf = (owner) => ({ id: String(owner?.id || 'owner'), name: String(owner?.name || '') })

/**
 * The entries a kept prescription becomes in someone else's log: one per part
 * (`parts` is `splitPrescription(pres)`), the same shape App.jsx's `keepPlan`
 * writes into the owner's own, plus `plannedBy`. Written `done: false` (the
 * server would make it so anyway, and `true` would read as their own tick in
 * `hasOwnMarks`); `isDone` reads it as done from its day on.
 */
export function plannedEntriesFor({ parts = [], theirDay = [], menu = [], date, owner }) {
  const items = parts.map(part => ({
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
  return placeEntries({ menu, onDay: theirDay, items, date })
    .map(e => ({ ...e, data: { ...e.data, done: false, plannedBy: plannedByOf(owner) } }))
}

/**
 * Write a kept prescription into someone's log. Their day is read first so the
 * ids are the ones their own app would have minted; each part is written
 * through the people endpoint, in order, so a failure part-way leaves what was
 * written and says so. `api` is lib/peopleapi.js, injected for tests.
 */
export async function keepPlanFor({ person, parts, menu, date, owner, api }) {
  const theirDay = await api.getPersonDay(person.id, date)
  const entries = plannedEntriesFor({ parts, theirDay, menu, date, owner })
  const ids = []
  for (const e of entries) ids.push((await api.putPersonEntry(person.id, e)).id)
  return { ids, count: ids.length, first: ids[0] || null }
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
