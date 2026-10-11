/*
 * Asking the box to write a workout.
 *
 * A fetch layer and nothing more — deliberately not a context like the coach's,
 * because a planning run is one request with one answer and no history. What
 * comes back is a prescription that has been stored NOWHERE: it exists in the
 * component that asked for it until the user taps "put it on today", at which point it
 * becomes an ordinary entry and joins the synced log like everything else.
 *
 * That is the same rule the coach's session offers follow, and it is worth
 * stating once more because this is the first thing in the app that produces a
 * whole session: the model never writes to the log. The user does.
 */

import { progress as quotaProgress, quotaCounts, shiftWeek } from './quota.js'

/** Rough context the app can hand over for free, so the agent spends its budget elsewhere. */
export function plannerContext({ readiness = null, week = null, iso = null }) {
  const bits = []
  if (iso) bits.push(`Today is ${iso}.`)
  if (readiness) {
    const r = readiness
    bits.push(`WHOOP this morning: recovery ${r.recovery ?? '—'}%, HRV ${r.hrv ?? '—'}, ` +
      `resting HR ${r.rhr ?? '—'}, sleep ${r.sleepHours ? `${r.sleepHours}h` : '—'}.`)
  }
  if (week?.isSet) {
    const owed = week.owed.map(c => `${c.remaining} ${c.name.toLowerCase()}`).join(', ')
    bits.push(`This week's quotas: ${week.doneTotal} of ${week.plannedTotal} filled.` +
      (owed ? ` Still owed: ${owed}.` : ' Nothing outstanding.'))
  }
  return bits.join(' ')
}

/**
 * One planning run.
 *
 * Throws with the server's own sentence rather than a status code — every failure
 * here has to be showable on a card, and "HTTP 503" is not a thing to read while
 * standing in gym shorts.
 */
export async function requestWorkout({ kinds, minutes, goal, context, signal }) {
  const r = await fetch('/api/plan/workout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kinds, minutes, goal, context }),
    signal,
  })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body?.error || `the box said ${r.status}`)
  if (!body?.plan) throw new Error('the planner returned nothing usable')
  return body.plan
}

/**
 * What the app knows about a WEEK, for the week planner.
 *
 * The same idea as `plannerContext`: the cheap facts the agent should not have to
 * spend a tool call on. `week` is `progress()` for the Monday in question — filled
 * so far if it is the current week, nothing if it is a coming one.
 */
export function weekContext({ week = null, monday = null, iso = null, plan = null, entries = [] }) {
  const bits = []
  if (iso) bits.push(`Today is ${iso}.`)
  if (monday) bits.push(`The week being planned starts Monday ${monday}.`)
  if (week && iso && monday) {
    const current = week.monday === monday && week.days.includes(iso)
    if (current) {
      const left = week.days.filter(d => d > iso).length
      bits.push(`It is the CURRENT week: ${left} day${left === 1 ? '' : 's'} left after today.`)
      const did = week.categories.filter(c => c.done > 0).map(c => `${c.done} ${c.name.toLowerCase()}`)
      bits.push(did.length ? `Already done this week: ${did.join(', ')}.` : 'Nothing logged this week yet.')
      const soon = week.categories.filter(c => c.pending > 0).map(c => `${c.pending} ${c.name.toLowerCase()}`)
      if (soon.length) bits.push(`On the day and not done yet: ${soon.join(', ')}.`)
    } else {
      bits.push('It is a COMING week — nothing in it has happened yet.')
    }
  }
  /*
   * The last three weeks, set against done, so the agent does not have to parse a
   * 200 KB log to learn what it most needs to know. The first live turn spent its
   * whole two minutes doing exactly that and timed out.
   */
  if (plan && monday && entries.length) {
    const names = Object.fromEntries((plan.quotaCategories || []).map(c => [c.key, c.name.toLowerCase()]))
    const lines = []
    for (let back = 1; back <= 3; back++) {
      const m = shiftWeek(monday, -back)
      const set = quotaCounts(entries, m)
      const did = quotaProgress({ plan, entries, iso: m }).categories.filter(c => c.done > 0)
      const keys = [...new Set([...Object.keys(set), ...did.map(c => c.key)])]
      if (!keys.length) continue
      const row = keys.map(k => {
        const d = did.find(c => c.key === k)?.done || 0
        return `${names[k] || k} ${d}/${set[k] || 0}`
      }).join(', ')
      lines.push(`  week of ${m}: ${row}`)
    }
    if (lines.length) bits.push(`\nWhat was DONE against what was SET (done/set), most recent first:\n${lines.join('\n')}`)
  }
  return bits.join(' ')
}

/**
 * One turn of planning the week's quotas.
 *
 * Stateless on the server, like a workout revision: the whole thread and the
 * current draft go up each time, and what comes back is the WHOLE week again plus
 * what it says. Nothing is written until the user taps "Set the week" — see
 * weekplanner.jsx.
 */
export async function requestWeek({ monday, counts, message, thread = [], context, signal }) {
  const r = await fetch('/api/plan/week', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ monday, counts, message, thread, context }),
    signal,
  })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body?.error || `the box said ${r.status}`)
  if (!body?.counts || typeof body.counts !== 'object') throw new Error('the planner returned nothing usable')
  return body
}

/**
 * Change a plan the user already has.
 *
 * Returns the whole revised plan, not a patch — see `revisePrompt` in
 * server/planner.js for why. The thread is sent so a third message can refer to
 * the second ("no, the other one"), and trimmed server-side.
 */
export async function reviseWorkout({ plan, message, thread = [], signal }) {
  const r = await fetch('/api/plan/revise', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ plan, message, thread }),
    signal,
  })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body?.error || `the box said ${r.status}`)
  if (!body?.plan) throw new Error('the planner returned nothing usable')
  return body.plan
}
