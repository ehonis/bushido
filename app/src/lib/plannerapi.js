/*
 * Asking the box to write a workout.
 *
 * A fetch layer and nothing more — deliberately not a context.
 * "Write it for me" is a DRAFT the server keeps beside the log (see the draft
 * calls at the end, and lib/drafts.js), so a run outlives the screen that asked
 * for it. A draft is still not the log: it becomes an ordinary entry, joining
 * the synced log like everything else, only when the user taps "put it on today".
 *
 * It is worth stating once more because this produces a whole session: the
 * model never writes to the log. The user does.
 */

import { fromIso, localIso } from './dates.js'
import { isDone, isTraining } from './store.js'
import { categoryOf } from './category.js'

/**
 * What was logged in the last `days` days, one line per workout, newest first.
 *
 * This is what the planner picks a sport from when the kind names none ("Zone 2",
 * "Tempo"): what has NOT been done lately, rather than what a weekly quota still
 * owed (the quotas were removed on 2026-10-25). Pre-digested here so the model
 * does not spend its budget reading the whole log to learn it.
 */
export function recentWorkouts({ plan = null, entries = [], iso, days = 7 }) {
  if (!iso) return []
  const from = fromIso(iso)
  from.setDate(from.getDate() - (days - 1))
  const since = localIso(from)
  const menu = plan?.dailyMenu || []
  const names = Object.fromEntries((plan?.quotaCategories || []).map(c => [c.key, c.name]))
  return entries
    .filter(e => e?.kind === 'daily' && !e.deleted && e.date >= since && e.date <= iso &&
      Number(e.data?.level) > 0 && isDone(e) && isTraining(e))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .map(e => {
      const cat = categoryOf(e, menu)
      const what = [e.data?.name, cat && names[cat] && names[cat] !== e.data?.name ? `(${names[cat]})` : null]
      return `${e.date}: ${what.filter(Boolean).join(' ') || 'a workout'}`
    })
}

/** Rough context the app can hand over for free, so the agent spends its budget elsewhere. */
export function plannerContext({ readiness = null, plan = null, entries = [], iso = null }) {
  const bits = []
  if (iso) bits.push(`Today is ${iso}.`)
  if (readiness) {
    const r = readiness
    bits.push(`WHOOP this morning: recovery ${r.recovery ?? '—'}%, HRV ${r.hrv ?? '—'}, ` +
      `resting HR ${r.rhr ?? '—'}, sleep ${r.sleepHours ? `${r.sleepHours}h` : '—'}.`)
  }
  const recent = recentWorkouts({ plan, entries, iso })
  if (iso) {
    bits.push(recent.length
      ? `Logged in the last 7 days, newest first: ${recent.join('; ')}.`
      : 'Nothing logged in the last 7 days.')
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
/*
 * `forId`: the owner planning for someone else on the install (lib/trainer.js).
 * The server runs on THEIR log, plan and About you; nothing else changes.
 */
export async function requestWorkout({ kinds, minutes, goal, context, signal, forId = null }) {
  const r = await fetch('/api/plan/workout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kinds, minutes, goal, context, ...(forId ? { for: forId } : {}) }),
    signal,
  })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body?.error || `the box said ${r.status}`)
  if (!body?.plan) throw new Error('the planner returned nothing usable')
  return body.plan
}

/**
 * Change a plan the user already has.
 *
 * Returns the whole revised plan, not a patch — see `revisePrompt` in
 * server/planner.js for why. The thread is sent so a third message can refer to
 * the second ("no, the other one"), and trimmed server-side.
 */
export async function reviseWorkout({ plan, message, thread = [], signal, forId = null }) {
  const r = await fetch('/api/plan/revise', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ plan, message, thread, ...(forId ? { for: forId } : {}) }),
    signal,
  })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body?.error || `the box said ${r.status}`)
  if (!body?.plan) throw new Error('the planner returned nothing usable')
  return body.plan
}

/*
 * Drafts: "Write it for me" kept on the server (server/drafts.js, lib/drafts.js).
 *
 * Creating one starts the model run and answers at once with the draft, still
 * working; the server writes the plan or the error onto it when the run ends.
 * Every call answers with the draft as it now is, so the screen can show it
 * without waiting for the next poll.
 */
async function draftCall(path, { method = 'GET', body, signal } = {}) {
  const r = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  })
  const out = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(out?.error || `The server could not do that (error ${r.status}).`), { status: r.status, code: out?.code || null })
  return out
}

export async function listDrafts() {
  const out = await draftCall('/api/plan/drafts')
  return Array.isArray(out?.drafts) ? out.drafts : []
}

/** `picked` is the kinds as the first screen holds them; the server keeps them to resume and retry. */
export async function createDraft({ picked, minutes, goal, context, forId = null }) {
  const out = await draftCall('/api/plan/drafts', {
    method: 'POST',
    body: { picked, minutes, goal, context, ...(forId ? { for: forId } : {}) },
  })
  return out.draft
}

export const reviseDraft = async (id, { message, pres }) =>
  (await draftCall(`/api/plan/drafts/${encodeURIComponent(id)}/revise`, { method: 'POST', body: { message, pres } })).draft

export const retryDraft = async (id) =>
  (await draftCall(`/api/plan/drafts/${encodeURIComponent(id)}/retry`, { method: 'POST', body: {} })).draft

export const saveDraft = async (id, pres) =>
  (await draftCall(`/api/plan/drafts/${encodeURIComponent(id)}`, { method: 'PUT', body: { pres } })).draft

/**
 * Claim a draft before it is placed, so it is kept once (server/drafts.js `keep`).
 * `claimed`, or `refused` with the server's reason (`code: 'kept'` when another
 * device kept it or threw it away), or `offline` when the server could not be
 * asked in a few seconds: then it is placed anyway, stamped with its id, and the
 * entry retires the draft when it syncs. `release` hands a claim back.
 */
export async function claimDraft(id, { release = false, timeoutMs = 5000 } = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    await draftCall(`/api/plan/drafts/${encodeURIComponent(id)}/keep`, { method: 'POST', body: release ? { release: true } : {}, signal: ctrl.signal })
    return { state: 'claimed' }
  } catch (e) {
    if (!e.status || e.status >= 500) return { state: 'offline' }
    return { state: 'refused', code: e.code, error: e.message }
  } finally {
    clearTimeout(t)
  }
}

export const discardDraft = (id) =>
  draftCall(`/api/plan/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' })
