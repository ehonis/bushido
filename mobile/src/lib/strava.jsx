/*
 * Strava, on the client.
 *
 * A context for the same reason `whoop.jsx` is one: the session log is rendered
 * from five places and a cache threaded through all of them is five places to
 * forget. `useStrava()` is safe outside a provider and returns "no data, not
 * connected" — the render suite's default, and the state the app has to be
 * indistinguishable from before Strava existed.
 *
 * The matching and the snapshot are in server/strava.js, pure, tested as
 * arithmetic, and re-exported here so the client has one import — the same
 * cross-directory reach as whoop.jsx, for the same one-copy reason.
 */

import { onForeground } from './foreground'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

export {
  rankForSession, snapshotOf, attachedMinutes, attachTo, detachFrom, activitiesOn, attachedIds,
  familyMatches, activityWindow, choiceForFamily, familyOf,
  // Several activities on one session, since 2026-09-21.
  attachedStrava, hasStrava,
} from '../../../server/strava.js'

const StravaCtx = createContext(null)

const EMPTY = {
  cache: null,
  status: null,
  pulling: false,
  error: null,
  pull: async () => {},
  detail: async () => null,
}

/** `initial` seeds the state without a fetch — for the render suite. Shaped { cache, status }. */
export function StravaProvider({ initial = null, children }) {
  const [cache, setCache] = useState(initial?.cache ?? null)
  const [status, setStatus] = useState(initial?.status ?? null)
  const [pulling, setPulling] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/strava', { cache: 'no-cache' })
      if (!r.ok) return null
      const doc = await r.json()
      setCache(doc)
      setStatus(doc?.status || null)
      return doc
    } catch {
      return null
    }
  }, [])

  /** Ask the server to refetch, and wait — one HTTP call, so the answer is the answer. */
  const pull = useCallback(async () => {
    setPulling(true)
    setError(null)
    try {
      const r = await fetch('/api/strava/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const doc = await r.json().catch(() => null)
      if (!r.ok) {
        const detail = doc?.error || doc?.status?.detail
        if (detail) { setError(detail); setStatus(doc?.status || null); return }
        // Same tunnel caveat as WHOOP: a bodiless failure is the gate's HTML, not
        // Bushido's opinion. Ask the server what it last knew instead.
        const recovered = await load()
        if (recovered?.status?.detail) return
        setError(`Could not reach Bushido (HTTP ${r.status}) — the pull may not have run.`)
        return
      }
      setCache(doc)
      setStatus(doc?.status || null)
    } catch (err) {
      setError(err.message)
    } finally {
      setPulling(false)
    }
  }, [load])

  /**
   * One activity in full (laps, splits, calories, description), fetched at the
   * moment the user attaches it. Null on any failure — the attach then carries the
   * summary, which is still every headline number, rather than failing.
   */
  const detail = useCallback(async (id) => {
    try {
      const r = await fetch(`/api/strava/activity?id=${encodeURIComponent(id)}`, { cache: 'no-cache' })
      if (!r.ok) return null
      return await r.json()
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    // Only when a provider is actually mounted in a browser — the render suite
    // seeds state and has no fetch.
    if (initial) return undefined
    load()
    return onForeground(load)
  }, [load, initial])

  const value = useMemo(
    () => ({ cache, status, pulling, error, pull, detail }),
    [cache, status, pulling, error, pull, detail],
  )
  return <StravaCtx.Provider value={value}>{children}</StravaCtx.Provider>
}

/** Safe outside a provider: no data, nothing on screen. */
export function useStrava() {
  return useContext(StravaCtx) || EMPTY
}
