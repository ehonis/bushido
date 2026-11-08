/*
 * The app's state and its write paths (#98: out of App.jsx), as the phone's
 * shell/AppData.tsx is: which + overlay is open, which day things land on, and
 * every way a workout reaches the log from outside a sheet (placing, a rest
 * day, keeping a plan, keeping one for someone else, a circuit from the timer).
 * `App` renders; this decides.
 */

import { useState } from 'react'
import { localIso, dateWords } from './lib/dates.js'
import { liftFieldOf } from './lib/lifts.js'
import { splitPrescription, circuitPlan, loggedCircuit, circuitFiling } from './lib/prescription.js'
import { optFor } from './lib/menu.js'
import { activityFieldOf } from './picker.jsx'
import * as peopleApi from './lib/peopleapi.js'
import { placeEntries, planPeople, keepPlanFor, plannedItems, shareKept, applyRun } from './lib/trainer.js'

/**
 * @param {{ store: any, plan: any, me: any, setTab: (tab: string) => void }} args
 */
export function useAppData({ store, plan, me, setTab }) {
  /* ------------------------------------------------------- the + button */

  /*
   * Adding to the day, from anywhere.
   *
   * This is where the swap list, the quota lanes and the "add another session"
   * link all went on 2026-09-17. Today stopped offering sessions, so the way to
   * put one on the day had to stop being part of Today — it is a floating
   * button now, reachable from every tab, with the things the user actually
   * does under it.
   *
   * PLAN one and the planner writes the sets (see planner.jsx). LOG one and the
   * ordinary workout card opens with nothing filled in. Both land as ordinary
   * entries; neither is written by anything except their tap.
   */
  const [fab, setFab] = useState(null)         // null | 'menu' | 'plan' | 'log' | 'rest'
  const [openEntryId, setOpenEntryId] = useState(null)
  // A day for Today to show, asked for from elsewhere (the planner's "See it on Mon", #94).
  const [showDay, setShowDay] = useState(null)

  /*
   * WHICH DAY a logged workout lands on.
   *
   * Until 2026-10-14 every pick landed on today, whatever day the user was
   * looking at, so Monday's board session could not be logged on Monday. Now Log
   * a workout lands on the day Today is showing (never a future one: you cannot
   * have done tomorrow's workout), from the + button as much as from the day.
   * `climb` is a WHOOP or Strava climb from the unlogged card, attached to
   * whichever card the user picks for it.
   */
  const [viewDay, setViewDay] = useState(null)
  const [logAt, setLogAt] = useState({ date: null, climb: null })
  const logDay = (date) => {
    const today = localIso()
    return date && date <= today ? date : today
  }
  const openLog = (date, { climb = null } = {}) => {
    setLogAt({ date: logDay(date), climb })
    setFab('log')
  }
  const dayLabel = (date) => (date && date !== localIso()
    ? `for ${dateWords(date)}`
    : null)

  /**
   * Put one or more sessions on today, in one go.
   *
   * BATCHED ON PURPOSE, and the reason is a bug this had for about ten minutes.
   * The first thing on an empty day is the day's MAIN session and everything
   * after is an extra — so placing two sessions means the second has to see the
   * first. Calling a single-place function twice cannot: both read `store.entries`
   * out of the same render's closure, both find an empty day, both mint
   * `daily-<date>`, and the second silently overwrites the first. A gym trip
   * planned as a lift and a run landed as just the run, while the screen said two
   * workouts were on today.
   *
   * So ids are allocated against ONE snapshot plus whatever this call has already
   * written. It is the same stale-closure shape as the runner's double write
   * earlier today, and the same fix: one function that knows about the whole
   * batch, rather than two calls that each know about half of it.
   *
   * `open` and `close` are what the PLANNER needs and nobody else does. Picking a
   * session or an activity is one decision — you chose it, here it is, get on
   * with it — so both default to true. Keeping a plan is not: writing a workout
   * down and starting it are two decisions, and the flow stays up to ask which.
   */
  const placeAll = (items, opts) => placeWritten(items, opts).map(e => e.id)
  const placeWritten = (items, { open = true, close = true, date = localIso() } = {}) => {
    /*
     * The ids and the entry shape are `placeEntries` (lib/trainer.js), the same
     * function the owner planning for someone else runs against THEIR day, so
     * the two cannot mint different ids for the same act. A card that names
     * itself from what you picked says so from the moment it lands, and it is
     * done on today or an earlier day, planned on a later one (AGENTS.md §4).
     */
    const written = placeEntries({ menu: plan?.dailyMenu || [], onDay: store.entries, items, date })
    for (const entry of written) store.upsertEntry(entry)

    if (close) setFab(null)
    if (open && written[0]) setOpenEntryId(written[0].id)
    setTab('today')
    return written
  }

  /**
   * A rest day on the date RestPrompt was given (today from the +, the viewed day
   * from Your day, and the user can change it there), with the why it asked for. Done on arrival (a rest
   * day is done whatever its date) and no sheet opens — the prompt was the form. A day already
   * resting gets its why edited rather than a second rest entry.
   */
  const restOpt = (plan?.dailyMenu || []).find(m => m.role === 'rest' && !m.retired) || null
  const restOn = (date) => restOpt && store.entries.find(e => e.kind === 'daily' && e.date === date
    && !e.deleted && e.data?.optId === restOpt.id)
  const [restDate, setRestDate] = useState(null)
  const askRest = (date) => { setRestDate(date || localIso()); setFab('rest') }
  const takeRest = ({ date, why, notes }) => {
    const hit = restOn(date)
    if (hit) {
      store.upsertEntry({ ...hit,
        data: { ...hit.data, out: { ...(hit.data.out || {}), why, notes } } })
      setFab(null); setTab('today')
      return
    }
    placeAll([{ optId: restOpt.id, data: { out: { why, notes } } }], { open: false, date })
  }

  /** One session. Everything goes through the batch, so ids cannot collide. */
  const placeToday = (optId, data = {}, opts = {}) => placeAll([{ optId, data }], opts)[0] || null

  /**
   * Keep a prescription.
   *
   * The whole thing goes on the entry as `data.plan` — what was ASKED for, kept
   * separate from `out`, which is what happened. `out.category` and
   * `out.activity` are what file it in the Log and Progress filters and pick the
   * log form. See lib/prescription.js and lib/category.js.
   */
  /**
   * Keep a prescription — as one entry per WORKOUT in it.
   *
   * A plan with several kinds of workout in it becomes several separate entries
   * rather than one pooled one, so WHOOP and Strava activities attach to the
   * right workout.
   *
   * The attach argument is the one that settles it. A pooled entry has ONE
   * `out.whoop` and ONE `out.strava`, so a trip that was a lift and a ride has a
   * single slot for two measurements and whichever lands first owns it. Split,
   * each half has its own entry, its own log form and its own place for the watch
   * to attach to, and one entry with one category is what the rest of this app
   * already assumes.
   *
   * `splitPrescription` decides where the seams are; a single-kind plan comes back
   * as one part and behaves exactly as it did. Returns the FIRST id, which is what
   * "start it now" opens.
   */
  const keepPlan = (pres, { date = localIso() } = {}) => {
    const entries = placeWritten(
      plannedItems(splitPrescription(pres)),
      {
        // They land on the day, but nothing opens: the planner's last screen asks
        // whether to go back, plan another or start now. Planning at eight for a
        // session at six is the normal case, and dropping the user into a running
        // timer was the app assuming the answer to a question it never asked.
        // The day is the planner's (#78): the one Today showed, or a later one.
        open: false, close: false, date,
      })
    const ids = entries.map(e => e.id)
    return { ids, count: ids.length, first: ids[0] || null, entries }
  }

  /*
   * THE OWNER AS TRAINER (lib/trainer.js, trainer.jsx). Who the owner can plan for:
   * nobody unless this is the owner on the owner's own log with someone else on the
   * install. A plan kept for someone goes into THEIR log through the people
   * endpoints, with the same ids their own "+" would mint against their day.
   */
  const people = planPeople(me)
  const keepPlanForPerson = (person, pres, key = null, date = localIso()) => keepPlanFor({
    person, parts: splitPrescription(pres), menu: plan?.dailyMenu || [], date,
    owner: { id: me.real.id, name: me.real.name }, api: peopleApi, key,
  })
  /*
   * You and others (#59): the entries just kept, shared with each of them, sync
   * on, through the same `addPerson` as "With …" on the sheet. Each updated entry
   * of yours is written through your own store.
   */
  const shareKeptWith = (others, kept) => shareKept({
    entries: kept, people: others, menu: plan?.dailyMenu || [],
    owner: { id: me.real.id, name: me.real.name }, api: peopleApi, save: store.upsertEntry,
  })
  const [personView, setPersonView] = useState(null) // { person, entryId } — their week, opened from the planner

  /*
   * A circuit from the + timer (issue #68). "Put it on today" places it as a
   * planned workout, as keeping a plan does. Run, it logs itself when it ends:
   * the same planned workout, placed the same way, with its run finished and
   * its log in the same write (`applyRun`, the runner's own), done like any
   * workout finished in the runner. Nothing done, nothing placed. It lands on
   * the day it was started, and is filed by what its exercises are
   * (`circuitFiling`), since a preset says nothing else about it.
   */
  const filingOf = (config) => circuitFiling(config, liftFieldOf(plan),
    { categories: plan?.quotaCategories || [], activities: activityFieldOf(plan)?.activities || [] })
  const placeCircuit = (name, config) =>
    placeWritten(plannedItems(splitPrescription(circuitPlan(name, config, liftFieldOf(plan), filingOf(config)))), { open: false })
  const logCircuit = (name, config, timerRun) => {
    const done = loggedCircuit(name, config, timerRun, liftFieldOf(plan), filingOf(config))
    if (!done) return false
    const menu = plan?.dailyMenu || []
    const [entry] = placeEntries({ menu, onDay: store.entries, items: plannedItems(splitPrescription(done.pres)), date: done.date })
    if (!entry) return false
    store.upsertEntry(applyRun(entry, optFor(menu, entry.data.optId), done.run, { out: { ...entry.data.out, ...done.out }, done: true }))
    return true
  }

  /** "Start it now", from the planner's last screen. */
  const startPlanned = (id) => {
    setFab(null)
    setOpenEntryId(id)
    setTab('today')
  }

  return {
    fab, setFab, openEntryId, setOpenEntryId, showDay, setShowDay, viewDay, setViewDay, logAt, logDay, openLog, dayLabel, placeAll, restOpt, restOn, restDate, askRest, takeRest, placeToday, keepPlan, people, keepPlanForPerson, shareKeptWith, personView, setPersonView, placeCircuit, logCircuit, startPlanned,
  }
}
