/*
 * WHOOP, on the client.
 *
 * A context rather than a prop threaded through six components, for the same
 * reason `prefs.jsx` is one: SessionLog is rendered from the Today tab, the
 * session sheet, the fullscreen page, trip mode and the history editor, and
 * passing a cache down all five paths would mean five places to forget.
 *
 * `useWhoop()` is safe outside a provider and returns "no data, not connected",
 * which is what every server-render smoke case gets. That is deliberate: the
 * absence of WHOOP has to render as the app behaving exactly as it did before
 * WHOOP existed, and the cheapest way to guarantee that is for the no-provider
 * path to be the one the tests exercise most.
 *
 * The MATCHING and the SNAPSHOT shape are not here — they are pure, they decide
 * what gets written into the training log, and they are tested as arithmetic in
 * server/whoop.js. This file re-exports them so the client has one import.
 *
 * That import reaches OUT of app/ on purpose. One copy of "which workout is this
 * session" is the point: the server hands the same numbers to the coach that the
 * screen shows them, and a second implementation would drift the first time one
 * side was tuned. Both bundlers resolve the relative path with no config, and the
 * module is plain pure ESM that CommonJS can `require` — server.js does.
 */

import { onForeground } from './foreground'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

export {
  rankForSession, snapshotOf, hardMinutes, recordedPct, readinessFor, recoveryFor, workoutsOn,
  overlapMinutes, sessionWindow, workoutWindow, attachedIds, baselineFor,
  // One gym visit, two logged sessions: the slice and how long it was.
  partOf, attachedMinutes, isSplit,
  // Attaching a workout also fills the blank fields it can answer — see the
  // `fillValues` note in server/whoop.js.
  attachTo, detachFrom, choiceForSport,
  // Several workouts on one session, since 2026-09-21.
  attachedWhoop, hasWhoop,
  // Last night and the fortnight before it, since 2026-10-07.
  sleepFor, sleepNights,
} from '../../../server/whoop.js'

const WhoopCtx = createContext(null)

const EMPTY = {
  cache: null,
  status: null,
  pulling: false,
  error: null,
  pull: async () => {},
}

/**
 * `initial` seeds the state without a fetch.
 *
 * The app never passes it — the real cache arrives from `/api/whoop`. It exists so
 * the render suite can mount the POPULATED states, which is where the bugs are:
 * an empty cache renders nothing, so testing only the default would test only the
 * blank screen. Shaped `{ cache, status }` so a test can pin "connected with data"
 * and "reachable but broken" separately.
 */
export function WhoopProvider({ initial = null, children }) {
  const [cache, setCache] = useState(initial?.cache ?? null)
  const [status, setStatus] = useState(initial?.status ?? null)
  const [pulling, setPulling] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/whoop', { cache: 'no-cache' })
      if (!r.ok) return null
      const doc = await r.json()
      setCache(doc)
      setStatus(doc?.status || null)
      return doc
    } catch {
      // A cache that will not load is indistinguishable from no WHOOP at all, and
      // that is the correct outcome — it must never break the page it sits on.
      return null
    }
  }, [])

  /**
   * Ask the server to refetch, and wait.
   *
   * Unlike the coach run this is four HTTP calls, not an Opus session, so the
   * honest answer to "did my gym session come through" is the answer rather than
   * "started". The server serialises concurrent pulls, so mashing the button
   * cannot start two.
   */
  const pull = useCallback(async () => {
    setPulling(true)
    setError(null)
    try {
      const r = await fetch('/api/whoop/pull', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })
      const doc = await r.json().catch(() => null)
      if (!r.ok) {
        // The bridge puts the FIX in the message ("click Connect WHOOP again to
        // grant it"), so it is shown as-is rather than replaced with "failed".
        const detail = doc?.error || doc?.status?.detail
        if (detail) {
          setError(detail)
          setStatus(doc?.status || null)
          return
        }
        /*
         * A failure with no readable body did not come from bushido.
         *
         * There is a Cloudflare Access gate and a tunnel in front of this app, and
         * both answer with their own HTML when the server behind them is
         * restarting or the link drops. Reporting their status code as the reason
         * buried the one sentence that mattered — a real "reconnect WHOOP to grant
         * the scope" rendered as "WHOOP pull failed (HTTP 502)", which tells them
         * nothing and reads like the feature is broken.
         *
         * The server remembers the last genuine reason in its own status, so ask
         * for it instead of inventing one from the code.
         */
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

  useEffect(() => {
    load()
    // The band syncs when the phone is next near it, which is usually after the
    // session rather than during it — so coming back to the app re-reads, the same
    // way the coach note does.
    return onForeground(load)
  }, [load])

  const value = useMemo(
    () => ({ cache, status, pulling, error, pull }),
    [cache, status, pulling, error, pull],
  )
  return <WhoopCtx.Provider value={value}>{children}</WhoopCtx.Provider>
}

/** Safe outside a provider: no data, and nothing on screen. */
export function useWhoop() {
  return useContext(WhoopCtx) || EMPTY
}
