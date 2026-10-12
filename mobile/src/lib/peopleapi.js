/*
 * The owner's window into someone else's log: their copy of a shared workout
 * (lib/shared.js), what the owner planned for them (lib/trainer.js), their day,
 * their plan and their About you (server.js `peopleRoute`). Same-origin `/api/` calls, so the
 * fetch wrapper adds `X-Bushido-User` for the OWNER's log as on every other
 * call: whose copy is in the path, not in the header, and the server refuses a
 * header that disagrees with the session exactly as it always has.
 *
 * Nothing here caches or queues. Their copy lives in their log on the server;
 * keeping it in this device's outbox would put two people's entries in one
 * store, which is the thing §3 says never happens. Offline, the write fails and
 * the sheet says so.
 */

import { nowIso } from './store.js'

async function call(path, init) {
  const res = await fetch(path, { cache: 'no-store', ...(init || {}) })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(body.error || `HTTP ${res.status}`)
    err.status = res.status
    err.code = body.code || null
    throw err
  }
  return body
}

const base = (personId) => `/api/people/${encodeURIComponent(personId)}/entry`

/** Their copy, or null if it is not there (yet, or any more: tombstones come back as entries). */
export async function getPersonEntry(personId, entryId) {
  return (await call(`${base(personId)}?id=${encodeURIComponent(entryId)}`)).entry || null
}

/** Their daily entries for one day, tombstones included, to pick the copy's id. */
export async function getPersonDay(personId, date) {
  return (await call(`${base(personId)}?date=${encodeURIComponent(date)}`)).entries || []
}

/** Upsert their copy (last write wins on `updatedAt`); resolves to the entry as merged on the server. */
export async function putPersonEntry(personId, entry) {
  const stamped = { ...entry, updatedAt: nowIso() }
  return (await call(base(personId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entry: stamped }),
  })).entry
}

/** Their whole log, read-only: for their day list and for planning with their context. */
export async function getPersonState(personId) {
  return (await call(`/api/people/${encodeURIComponent(personId)}/state`)).state || { entries: {} }
}

/** The plan their app runs on (their own import, or the starter). Null when there is none. */
export async function getPersonContent(personId) {
  try { return await call(`/api/people/${encodeURIComponent(personId)}/content`) } catch (err) {
    if (err.status === 404) return null
    throw err
  }
}

/** Their About you: `{ name, notes }`. */
export async function getPersonAbout(personId) {
  return call(`/api/people/${encodeURIComponent(personId)}/about`)
}

export async function putPersonAbout(personId, about) {
  return call(`/api/people/${encodeURIComponent(personId)}/about`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: about?.name ?? '', notes: about?.notes ?? '' }),
  })
}

/** This person's own About you (anyone but the owner, whose is in Settings). */
export async function getMyAbout() {
  return call('/api/about')
}

export async function putMyAbout(about) {
  return call('/api/about', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: about?.name ?? '', notes: about?.notes ?? '' }),
  })
}
