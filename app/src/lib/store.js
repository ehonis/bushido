/*
 * Offline-tolerant, multi-device store.
 *
 * The server merges last-write-wins per entry id; this client does the same merge
 * locally, so the two can never disagree about the outcome. Practical effect:
 * log a set on your phone in the basement with no signal, log another on the
 * laptop, and both survive. Only editing the *same* entry on both devices can
 * lose anything, and then the later edit wins.
 *
 * localStorage is a cache and an outbox, never the source of truth.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { handoffTarget, retirePushSubscription } from './handoff.js'
import { isSignedOut, makeLocalPersist, onSignedOutElsewhere } from './signout.js'
import { cacheKeyFor, currentMe } from './whoami.js'

/*
 * One cache per person (lib/whoami.js). The owner's keeps the key it always had.
 * Read when used, not at import: main.jsx decides whose log this is first.
 */
const cacheKey = () => cacheKeyFor(currentMe().id)
// Back-compat for the 2026-10-02 rename: devices installed before it hold their
// cache (and any unsynced outbox) under the old key. Can go once every device has
// opened the app once since then.
const LEGACY_CACHE_KEY = 'rung:cache-v1'
/** On an old hostname, move once nothing local is left unpushed (handoff.js). */
async function handoffIfSynced(isDirty) {
  const to = !isDirty() && typeof window !== 'undefined' ? handoffTarget(window.location) : null
  if (!to) return
  await retirePushSubscription()
  // An edit during the unsubscribe is unpushed again; its push comes back here.
  if (!isDirty()) window.location.replace(to)
}

const EMPTY = { entries: {}, settings: {}, settingsUpdatedAt: '1970-01-01T00:00:00.000Z' }

export const nowIso = () => new Date().toISOString()
export const newId = () =>
  (globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(16).slice(2)}`)

/** Last-write-wins merge. Identical to the server's, deliberately. */
export function mergeState(base, incoming) {
  const out = {
    entries: { ...(base.entries || {}) },
    settings: base.settings || {},
    settingsUpdatedAt: base.settingsUpdatedAt || EMPTY.settingsUpdatedAt,
  }
  for (const [id, entry] of Object.entries(incoming?.entries || {})) {
    if (!entry || typeof entry !== 'object') continue
    const mine = out.entries[id]
    if (!mine || String(entry.updatedAt || '') >= String(mine.updatedAt || '')) {
      out.entries[id] = { ...entry, id }
    }
  }
  if (incoming?.settings && String(incoming.settingsUpdatedAt || '') > String(out.settingsUpdatedAt)) {
    out.settings = incoming.settings
    out.settingsUpdatedAt = incoming.settingsUpdatedAt
  }
  return out
}

function readCache() {
  try {
    const CACHE_KEY = cacheKey()
    let raw = localStorage.getItem(CACHE_KEY)
    // The pre-rename cache is the owner's: there was only one person then.
    if (!raw && currentMe().owner && !isSignedOut(localStorage, window) && (raw = localStorage.getItem(LEGACY_CACHE_KEY))) {
      // Moving the key is best effort: a second copy can exceed the quota, and
      // the outbox in `raw` must still load either way, dirty flag and all.
      try {
        localStorage.setItem(CACHE_KEY, raw)
        localStorage.removeItem(LEGACY_CACHE_KEY)
      } catch { /* left under the old key; read again from there next time */ }
    }
    if (!raw) return { state: structuredClone(EMPTY), version: 0, dirty: false }
    const c = JSON.parse(raw)
    return {
      state: { ...EMPTY, ...(c.state || {}) },
      version: Number(c.version) || 0,
      dirty: Boolean(c.dirty),
    }
  } catch {
    return { state: structuredClone(EMPTY), version: 0, dirty: false }
  }
}

/*
 * Every cache write goes through here. Signing out, in this tab or any other,
 * takes the log off the device (lib/signout.js); a sync landing afterwards must
 * not write it back, so the write refuses once the shared marker is set or while
 * a sign-out is in progress. Quota and private mode are silent refusals too: the
 * server is still the source of truth.
 */
let persist = null
function writeCache(state, version, dirty) {
  if (typeof window === 'undefined') return
  persist = persist || makeLocalPersist({ storage: window.localStorage, flagTarget: window, key: cacheKey() })
  persist({ state, version, dirty })
}

export function useStore() {
  const boot = useMemo(readCache, [])
  const [state, setState] = useState(boot.state)
  const [status, setStatus] = useState('loading') // loading | synced | syncing | offline
  const [lastSync, setLastSync] = useState(null)

  const versionRef = useRef(boot.version)
  const dirtyRef = useRef(boot.dirty) // unpushed local edits exist
  const stateRef = useRef(boot.state)
  const pushTimer = useRef(null)
  const inFlight = useRef(false)
  // Bumped by every dirty local write. A push only clears `dirty` when nothing
  // was written while it was in flight; the follow-up push for such an edit is
  // skipped by the in-flight guard, so without this it would be marked synced
  // without ever having been sent.
  const writes = useRef(0)

  const commitLocal = useCallback((next, { dirty }) => {
    stateRef.current = next
    if (dirty) { dirtyRef.current = true; writes.current += 1 }
    setState(next)
    writeCache(next, versionRef.current, dirtyRef.current)
  }, [])

  /** Send everything we have; the server merges and returns the truth. */
  const push = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    const sent = writes.current
    setStatus('syncing')
    try {
      const res = await fetch('/api/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: stateRef.current }),
      })
      if (!res.ok) throw new Error(`push failed: ${res.status}`)
      const doc = await res.json()
      versionRef.current = doc.version
      dirtyRef.current = writes.current !== sent
      // Server's merged doc may contain edits from the other device.
      const merged = mergeState(stateRef.current, doc.state)
      stateRef.current = merged
      setState(merged)
      writeCache(merged, doc.version, dirtyRef.current)
      setStatus(dirtyRef.current ? 'syncing' : 'synced')
      setLastSync(new Date())
      handoffIfSynced(() => dirtyRef.current)
      // An edit made mid-flight had its own push turned away by the in-flight
      // guard, so send it now (after `finally` has released the guard).
      if (dirtyRef.current) setTimeout(() => pushRef.current?.(), 0)
    } catch {
      setStatus('offline') // stays dirty; retried on the next tick or focus
    } finally {
      inFlight.current = false
    }
  }, [])
  const pushRef = useRef(null)
  pushRef.current = push

  const pull = useCallback(async () => {
    if (inFlight.current) return
    try {
      const res = await fetch('/api/state', { cache: 'no-store' })
      if (!res.ok) throw new Error(`pull failed: ${res.status}`)
      const doc = await res.json()
      if (doc.version !== versionRef.current || dirtyRef.current) {
        const merged = mergeState(stateRef.current, doc.state)
        versionRef.current = doc.version
        stateRef.current = merged
        setState(merged)
        writeCache(merged, doc.version, dirtyRef.current)
      }
      setStatus(dirtyRef.current ? 'syncing' : 'synced')
      setLastSync(new Date())
      if (dirtyRef.current) push()
      else handoffIfSynced(() => dirtyRef.current)
    } catch {
      setStatus('offline')
    }
  }, [push])

  const schedulePush = useCallback(() => {
    clearTimeout(pushTimer.current)
    pushTimer.current = setTimeout(push, 600) // debounce rapid edits into one write
  }, [push])

  // Initial load, then poll; refresh whenever the tab regains focus so picking
  // up the phone after logging on the laptop shows current data immediately.
  // Another tab signed out: this one holds the log in memory, so leave for the
  // sign-in page rather than keep showing (or re-caching) it.
  useEffect(() => onSignedOutElsewhere({
    win: window,
    fn: () => { clearInterval(pushTimer.current); window.location.assign('/login') },
  }), [])

  useEffect(() => {
    pull()
    const iv = setInterval(pull, 20000)
    const onFocus = () => { if (document.visibilityState === 'visible') pull() }
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('online', onFocus)
    return () => {
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener('online', onFocus)
      clearTimeout(pushTimer.current)
    }
  }, [pull])

  const upsertEntry = useCallback((entry) => {
    const id = entry.id || newId()
    const stamped = { ...entry, id, updatedAt: nowIso() }
    commitLocal(mergeState(stateRef.current, { entries: { [id]: stamped } }), { dirty: true })
    schedulePush()
    return id
  }, [commitLocal, schedulePush])

  const deleteEntry = useCallback((id) => {
    const prev = stateRef.current.entries[id]
    if (!prev) return
    // Tombstone rather than drop, or the other device would resurrect it on merge.
    const tomb = { ...prev, id, deleted: true, updatedAt: nowIso() }
    commitLocal(mergeState(stateRef.current, { entries: { [id]: tomb } }), { dirty: true })
    schedulePush()
  }, [commitLocal, schedulePush])

  const saveSettings = useCallback((patch) => {
    const next = {
      ...stateRef.current,
      settings: { ...stateRef.current.settings, ...patch },
      settingsUpdatedAt: nowIso(),
    }
    commitLocal(next, { dirty: true })
    schedulePush()
  }, [commitLocal, schedulePush])

  const entries = useMemo(
    () => Object.values(state.entries || {}).filter(e => !e.deleted),
    [state.entries],
  )

  return {
    entries,
    settings: state.settings || {},
    status,
    lastSync,
    upsertEntry,
    deleteEntry,
    saveSettings,
    refresh: pull,
  }
}

/**
 * Did you actually do it?
 *
 * Putting a session on the day — picking the recommendation, swapping your main,
 * adding an extra — is planning. Completing it is a separate, explicit act, and
 * only completion counts towards the streak, the load calendar, the hard-finger
 * budget, the recommendation for tomorrow, or the Totem habit.
 *
 * Entries written before this flag existed carry no `done` and were only ever
 * created by pressing "log this", so an absent flag means done.
 */
export const isDone = (entry) => !entry?.deleted && entry?.data?.done !== false

/*
 * Was this TRAINING, or just something the user did?
 *
 * A bike commute is not really a workout, but its miles still matter. That had
 * no way to be said — every
 * logged entry was training, so a commute either went unlogged (and the bike's
 * odometer drifted) or it landed as a workout and told the recommender the user had
 * ridden that day.
 *
 * ONE AXIS, and it is narrower than it sounds. A non-training activity still
 * counts toward gear mileage, the daily streak and the Totem habit, and the
 * Progress page's miles. What it is excluded from is everything that reads it as
 * a SESSION: training load (sRPE, the load calendar's sense of a heavy day, the
 * recommender's whole-body ceiling) and — since 2026-09-21 — the weekly quotas.
 *
 * The quotas were the other way round for six days: a commute initially filled
 * one, and in use that turned every commute into a counted workout. A quota
 * is a count of training the user meant to do, so `quota.js` drops these now. See
 * `weekDaily` there.
 *
 * Absent means training, because every entry written before 2026-09-15 was.
 */
export const isTraining = (entry) => entry?.data?.training !== false

/**
 * Can this session legitimately be logged more than once in a day?
 *
 * Declared in plan.json as `sched.repeatable`, and true of exactly one card so
 * far: *Other training*. Running AND lifting on the same day is two
 * workouts and not one — different effort, different length, different detail —
 * and one entry per session per day could only hold the second one on top of the
 * first. Everything else in the menu is once a day by nature: two sets of max
 * hangs in an evening is one session with more sets in it.
 */
export const isRepeatable = (opt) => Boolean(opt?.sched?.repeatable)

/**
 * The button that logs a second one, in the card's own words.
 *
 * Declared as `sched.repeatLabel` because the generic phrasing is bad English:
 * *Other training* is the card's NAME, so "log another other training" is what
 * building this label out of it gets you. The fallback is still there for a card
 * that becomes repeatable without saying how to ask for one.
 */
export const repeatLabel = (opt) =>
  opt?.sched?.repeatLabel || `Log another ${String(opt?.name || 'session').toLowerCase()}`

/**
 * The entry id for an extra session on a day.
 *
 * Ordinary extras are `daily-<date>-<optId>`, which is DELIBERATELY derivable:
 * adding the hip block twice by tapping twice writes the same entry both times
 * rather than two, and every offline device computes the same id for the same
 * act so the last-write-wins merge has something to agree about.
 *
 * `fresh` is the second run of the day — an explicit "log another one of these",
 * only ever offered for a `repeatable` session. It takes the next free number
 * (`-2`, `-3`), so the first one keeps the plain id it has always had and
 * everything logged before this existed reads back unchanged.
 */
export function extraEntryId(iso, optId, dayEntries = [], { fresh = false } = {}) {
  const base = `daily-${iso}-${optId}`
  const taken = new Set((dayEntries || []).map(e => e?.id))
  if (!fresh || !taken.has(base)) return base
  for (let n = 2; n < 100; n++) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
  }
  // A hundred of one session in a day is not a real day, but a collision would
  // silently overwrite training the user logged, so fall through to something unique.
  return `${base}-${Date.now()}`
}

/** Entries of one kind, oldest first. */
export function byKind(entries, kind) {
  return entries
    .filter(e => e.kind === kind)
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
}
