// Pull down on a tab: re-read the log and the plan, and ask WHOOP and Strava
// for what they have now. Their GETs (load on mount and on foreground) only
// serve the server's cache and start a refresh nobody waits for, so without
// the pull a ride that just synced shows on the second pull, not the first.
// Each pull is the same one the block's Refresh button makes, so a failure
// lands in that block's own error line, never in the log's sync state.

type Pull = () => Promise<unknown>

/** A service's provider, as `useWhoop()` / `useStrava()` return it. */
export type Service = { cache: unknown; pull: Pull }

export type PullRefreshDeps = {
  /**
   * The log's own sync (the store's pull): true once the server answered,
   * false when it could not be reached, undefined when it was skipped behind
   * a push in flight. The spinner always waits for it.
   */
  refresh: () => Promise<boolean | undefined | void>
  reloadPlan: () => void
  whoop: Service
  strava: Service
  now?: number
  /** How long the spinner waits for a slow service before letting go; its pull still lands. */
  waitMs?: number
}

export const SERVICE_WAIT_MS = 8000
/** A copy the server fetched this recently is current: pulling again only spends Strava's shared rate limit. */
export const FRESH_MS = 60_000

/**
 * Whether to pull a service: its cache says it is connected (the server's own
 * answer on every GET, for whoever's log this is, so it is never staler than
 * the last foreground) and it was not fetched within FRESH_MS.
 */
export function wantsPull(cache: unknown, now: number) {
  const c = cache as { configured?: boolean; fetchedAt?: string | null } | null
  if (c?.configured !== true) return false
  const at = c.fetchedAt ? Date.parse(c.fetchedAt) : NaN
  return !(now - at < FRESH_MS)
}

export async function pullRefresh({ refresh, reloadPlan, whoop, strava, now = Date.now(), waitMs = SERVICE_WAIT_MS }: PullRefreshDeps) {
  reloadPlan()
  // The services only once the log reached the server: offline, a pull would
  // leave "Network request failed" on every WHOOP and Strava block, where
  // nothing clears it but another pull. A sync skipped behind a push still in
  // flight has not said, so it waits for the next pull too.
  // So the spinner can run up to SERVICE_WAIT_MS past the log: one after the
  // other is the point, not an accident to make parallel again.
  const reached = await refresh().catch(() => false)
  if (reached !== true) return
  const services = [whoop, strava].filter(s => wantsPull(s.cache, now)).map(s => s.pull())
  if (!services.length) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.allSettled(services),
      new Promise(resolve => { timer = setTimeout(resolve, waitMs) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
