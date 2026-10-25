/*
 * AI workout drafts, on the app's side (server/drafts.js is the other half).
 *
 * "Write it for me" no longer belongs to the screen that asked. The server keeps
 * a draft in this person's space and writes the model's answer onto it when the
 * run ends, so the planner only has to LOOK: list the drafts, poll while one is
 * being written, and reopen one at the step it is on. Nothing here writes the
 * log; keeping a draft is the planner's ordinary placement, on the tap.
 *
 * Copied to mobile/src/lib/drafts.js byte for byte.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { normalizePrescription } from './prescription.js'
import { listDrafts } from './plannerapi.js'

/** How often a draft being written is looked at. A run takes thirty to ninety seconds. */
export const DRAFT_POLL_MS = 2500

/** How many drafts a person keeps. The same number as MAX_DRAFTS in server/drafts.js (drafts.test.js checks). */
export const DRAFT_MAX = 8

const newestFirst = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt))

/** What changes the step a draft is on; a saved edit does not. */
export const draftKey = (d) => (d ? `${d.id}|${d.status}|${d.run?.id || ''}` : null)

/**
 * The step a draft reopens at. A plan on it means the review (a revision being
 * written, or one that failed, is shown there, in the conversation); no plan yet
 * means the wait, or the failure with its retry.
 */
export function draftStep(d) {
  if (!d) return 'kind'
  if (d.pres && (d.status !== 'working' || d.run?.kind === 'revise')) return 'review'
  return d.status === 'failed' ? 'failed' : 'working'
}

/** The draft's plan as the editor takes it: normalised, with its thread and ask kept. */
export function draftPres(d, liftField) {
  if (!d?.pres) return null
  const built = normalizePrescription(d.pres, { liftField })
  if (!built) return null
  return { ...built, ask: d.pres.ask || null, thread: Array.isArray(d.pres.thread) ? d.pres.thread : [] }
}

export const draftTitle = (d) => d?.pres?.title || d?.ask?.label || 'Workout'

const ago = (iso, now) => {
  const s = Math.max(0, Math.round((now - Date.parse(iso || 0)) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  const d = Math.round(s / 86400)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

/** The second line of a draft's row: what it is doing, or what it has. */
export function draftLine(d, now = Date.now()) {
  const who = d?.for?.name ? `For ${d.for.name} · ` : ''
  if (d?.status === 'working') {
    const secs = Math.max(0, Math.round((now - Date.parse(d.run?.startedAt || d.updatedAt || 0)) / 1000))
    return `${who}${d.run?.kind === 'revise' ? 'Rewriting it' : 'Being written'}… ${secs}s`
  }
  if (d?.status === 'failed') return `${who}Did not finish: ${d.error || 'the planner failed'}`
  const minutes = d?.pres?.minutes || d?.ask?.minutes
  return `${who}Ready${minutes ? ` · ${minutes} min` : ''} · ${ago(d?.updatedAt, now)}`
}

/**
 * The drafts a log has KEPT: keeping stamps the draft's id on the plan it places
 * (`data.plan.draftId`, carried onto every part by splitPrescription). A draft
 * in here is on a day already, whatever the server's list still says.
 */
export function placedDraftIds(...logs) {
  const ids = new Set()
  for (const entries of logs) {
    for (const e of entries || []) if (e?.data?.plan?.draftId) ids.add(String(e.data.plan.draftId))
  }
  return ids
}

/** The drafts still to offer: not already on a day. */
export const unplacedDrafts = (drafts, placed) => (drafts || []).filter(d => !placed.has(d.id))

/**
 * The draft starting another would throw away: at the cap, the oldest one not
 * being written (server/drafts.js evicts the same one). Said before it happens.
 */
export function draftToEvict(drafts) {
  const list = drafts || []
  if (list.length < DRAFT_MAX) return null
  return [...list].sort(newestFirst).reverse().find(d => d.status !== 'working') || null
}

/**
 * Whether "Put it on today" may place this draft. Kept once: not if this log
 * already has it, not if the server says another device kept it (or is keeping
 * it), and claimed first otherwise. Offline, it goes ahead: the plan carries the
 * draft's id, so the entry retires the draft when it syncs.
 */
export async function keepGate({ draftId, placed, claim }) {
  if (!draftId) return { go: true, claimed: false }
  if (placed.has(draftId)) return { go: false, gone: true, error: 'This draft is already on your day.' }
  const r = await claim(draftId)
  if (r.state === 'claimed') return { go: true, claimed: true }
  if (r.state === 'offline') return { go: true, claimed: false }
  return { go: false, gone: r.code === 'kept', error: r.error || 'It could not be kept.' }
}

/** The prescription without what the server owns on a draft (its thread and ask). */
export const presForServer = (pres) => {
  const { thread, ask, ...rest } = pres || {}
  void thread; void ask
  return rest
}

/**
 * This person's drafts, polled while any is being written.
 *
 * `upsert` and `drop` put a draft the app just created, revised or kept into the
 * list at once. A poll that started before one of them is thrown away when it
 * lands (`seq`), so a slow answer can never put back what was just changed.
 */
export function useDrafts(enabled = true) {
  const [drafts, setDrafts] = useState([])
  const seq = useRef(0)

  const refresh = useCallback(async () => {
    if (!enabled) return
    const at = seq.current
    try {
      const list = await listDrafts()
      if (seq.current === at) setDrafts([...list].sort(newestFirst))
    } catch { /* offline or busy: keep what is on screen and look again on the next tick */ }
  }, [enabled])

  useEffect(() => { refresh() }, [refresh])

  const working = drafts.some(d => d.status === 'working')
  useEffect(() => {
    if (!working) return undefined
    const iv = setInterval(refresh, DRAFT_POLL_MS)
    return () => clearInterval(iv)
  }, [working, refresh])

  const upsert = useCallback((d) => {
    if (!d?.id) return
    seq.current++
    setDrafts(list => [d, ...list.filter(x => x.id !== d.id)].sort(newestFirst))
  }, [])
  const drop = useCallback((id) => {
    seq.current++
    setDrafts(list => list.filter(x => x.id !== id))
  }, [])

  return { drafts, refresh, upsert, drop }
}
