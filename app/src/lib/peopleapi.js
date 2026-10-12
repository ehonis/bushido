/*
 * The owner's window into someone else's copy of a shared workout
 * (server.js `peopleRoute`, lib/shared.js). Same-origin `/api/` calls, so the
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
