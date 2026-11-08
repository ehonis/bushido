/*
 * A part of the app loaded only when it is first drawn (#98): Plan a workout,
 * the interval timer's screen and WHOOP on Today were all in the one bundle
 * every visit downloads, whether or not anything was planned, timed or had
 * WHOOP.
 *
 * `lazyPart(() => import('./x.jsx'), 'Name', { failed })` is `Name` from x.jsx,
 * drawn as nothing until its file has arrived. In a gym with bad signal:
 * - Each part is fetched a few seconds after the app starts (`WARM_MS`), so the
 *   service worker has it cached (sw.js caches /assets/ on first fetch) before
 *   anyone is offline.
 * - A part that fails to load never covers anything (#98 review). `failed` says
 *   what it draws instead. Without one (WHOOP on Today, a timer resumed in the
 *   background) it draws NOTHING, exactly as an install without it. A screen the
 *   user opened passes `failed(props, retry)` and says so inside its own frame,
 *   with Try again (React keeps a failed lazy load failed, so Try again starts a
 *   fresh one) and its own way out.
 *
 * Nothing a sheet or a workout in progress draws is lazy: the log, the session
 * sheet (PlanTalk in plantalk.jsx, WHOOP workouts in whoop.jsx), the runner and
 * the timer's running face (timerrun.jsx) are all in the main bundle.
 */
import { Component, lazy, Suspense, useState } from 'react'

export const WARM_MS = 3000

export function lazyPart(load, name, { failed = null } = {}) {
  let pending = null
  const fetchPart = () => (pending ||= load().catch((e) => { pending = null; throw e }))
  const make = () => lazy(() => fetchPart().then(m => ({ default: m[name] })))
  if (typeof window !== 'undefined') setTimeout(() => { fetchPart().catch(() => {}) }, WARM_MS)

  let Loaded = make()
  function Part(props) {
    const [tries, setTries] = useState(0)
    const retry = () => { Loaded = make(); setTries(n => n + 1) }
    return (
      <PartBoundary key={tries} fallback={failed ? () => failed(props, retry) : () => null}>
        <Suspense fallback={null}><Loaded {...props} /></Suspense>
      </PartBoundary>
    )
  }
  Part.displayName = `lazy(${name})`
  return Part
}

class PartBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback() : this.props.children }
}

/** What a screen the user opened says when it did not load: in the screen, never over anything else. */
export function LoadFailed({ what, onRetry }) {
  return (
    <div className="lazy-failed" role="alert">
      <p>{what} did not load. Check the connection.</p>
      <button type="button" className="btn secondary" onClick={onRetry}>Try again</button>
    </div>
  )
}
