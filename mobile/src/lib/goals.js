/*
 * Totem's goals, shown in Bushido.
 *
 * Goals created in Totem can be linked so they also show up in Bushido, tracked
 * in both places from the same underlying metrics.
 *
 * TOTEM OWNS THEM, and Bushido is a second window rather than a second author.
 * That is deliberate: Totem has the
 * schema, the MCP tools, the notebook-import flow and the weekly review skill.
 * Two UIs over one schema where only one of them owns the migrations is a
 * standing invitation for the other to drift.
 *
 * WHAT MAKES A GOAL A BUSHIDO GOAL is a `url` link pointing at this app. That is
 * not a convention invented here — `goal_links` exists in Totem precisely to say
 * "this is related", its own comment distinguishes it from the synced mirrors
 * beside it, and `goals__link_goal` is already a tool. So marking a goal for
 * Bushido costs nothing and adds no column:
 *
 *   goals__link_goal(id, kind: 'url', url: 'https://<your Bushido host>', label: 'Bushido')
 *
 * NOTHING HERE COMPUTES PROGRESS. The numbers — `value`, `targetValue`,
 * `percent` — are Totem's, already resolved by its own service including any
 * Strava-sourced metrics, any sub-goal rollup, and how far through a step's own
 * numbers it is. Recomputing them here would be a second opinion on a number that
 * has an owner, and the two would disagree the first time a rollup edge changed.
 */

/*
 * Build-time settings, from app/.env. Vite defines `import.meta.env`; under Node
 * (the tests) it does not exist and process.env stands in.
 *
 * Native: Metro has no import.meta.env. Expo inlines EXPO_PUBLIC_* variables
 * from mobile/.env (gitignored) when they are written out in full, so the same
 * two settings come from there, and the saved server's host stands in for the
 * page's (bushidoHost below).
 */
import { getBaseUrl } from './connection'
const ENV = {
  VITE_BUSHIDO_HOST: process.env.EXPO_PUBLIC_BUSHIDO_HOST,
  VITE_BUSHIDO_LEGACY_HOSTS: process.env.EXPO_PUBLIC_BUSHIDO_LEGACY_HOSTS,
}
const serverLocation = () => { try { return new URL(getBaseUrl()) } catch { return null } }
const list = (v) => String(v || '').split(',').map(s => s.trim()).filter(Boolean)

/**
 * The link that marks a goal as one Bushido should show: the hostname this app
 * is published at, from `VITE_BUSHIDO_HOST`. Nothing is hard-coded: when it is
 * unset, the host the page was opened at stands in (see bushidoHost).
 */
export const BUSHIDO_LINK = ENV.VITE_BUSHIDO_HOST || ''

/** The configured host, else the one this page is on, else '' (Node, tests). */
export function bushidoHost(loc = serverLocation()) {
  return BUSHIDO_LINK || loc?.host || ''
}

/*
 * Back-compat, read only: goal links already stored elsewhere may point at the
 * app's earlier hostnames. `VITE_BUSHIDO_LEGACY_HOSTS` is a comma-separated list
 * of them; new links use BUSHIDO_LINK.
 */
const LEGACY_HOSTS = list(ENV.VITE_BUSHIDO_LEGACY_HOSTS)

/** Every host that marks a goal as Bushido's. Legacy hosts are env-only. */
export const goalHosts = (loc) => [bushidoHost(loc), ...LEGACY_HOSTS].filter(Boolean)

const linksOf = (goal) => (Array.isArray(goal?.links) ? goal.links : [])

/**
 * Is this one of Bushido's?
 *
 * Matched on the host rather than the whole URL, so a link with a path, a
 * trailing slash or the old hostname still counts — the marker is "this points at
 * my health app", and being strict about the string would silently unlink every
 * goal the next time the app is renamed.
 */
export function isBushidoGoal(goal, hosts = goalHosts()) {
  const list = Array.isArray(hosts) ? hosts.filter(Boolean) : []
  return linksOf(goal).some(l => {
    if (l?.kind !== 'url' || typeof l.url !== 'string') return false
    let host
    try { host = new URL(l.url).host } catch { return false }
    return list.includes(host)
  })
}

/** The Bushido-linked goals, open ones first, each with its own metrics. */
export function bushidoGoals(cache) {
  const all = Array.isArray(cache?.goals) ? cache.goals : []
  return all
    // Wrapped, NOT passed bare. `Array.prototype.filter` calls back with
    // (element, index, array), so `all.filter(isBushidoGoal)` hands the INDEX to
    // the `hosts` parameter and `0.some` throws — taking the whole app down,
    // because this runs in a `useMemo` during the first render.
    .filter(g => isBushidoGoal(g))
    .sort((a, b) => {
      // Finished goals sink. Within a band, the one with least time left leads:
      // a month-end goal with three days on it is the one worth seeing.
      if (Boolean(a.complete) !== Boolean(b.complete)) return a.complete ? 1 : -1
      return (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999)
    })
}

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** One number, in the shape a card draws. */
const metricSummary = (m) => ({
  id: m.id,
  label: m.label,
  unit: m.unit || '',
  value: num(m.value),
  target: num(m.targetValue),
  percent: Math.max(0, Math.min(100, Math.round(num(m.percent)))),
  // Where the number comes from, in Totem's own words — "logged by hand", or a
  // connector. Shown because a number nobody is updating should look different
  // from one a connector is keeping current.
  source: m.sourceLabel || (m.sourceKind === 'manual' ? 'logged by hand' : m.sourceKind),
  manual: (m.sourceKind || 'manual') === 'manual',
  available: m.available !== false,
  unavailable: m.unavailableReason || null,
})

const metricsOf = (row) => (Array.isArray(row?.metrics) ? row.metrics : []).map(metricSummary)

/**
 * A goal reduced to what a card needs.
 *
 * `percent` is TOTEM'S, and this is the second place that mattered: a goal's
 * numbers often live on its STEPS — "complete cardio goals" with "2 bike rides"
 * and "1 swim" under it — and averaging only the goal's own metrics reported a
 * week of real riding as 0%. Totem's `progress.percent` already folds the steps
 * in (goals/progress.mjs), including any rollup, so take it. The mean below is a
 * fallback for a payload that predates it, never a second opinion.
 */
export function goalSummary(goal) {
  const metrics = metricsOf(goal)

  /*
   * Totem calls them `subGoals`. This read `goal.steps` for its first week, which
   * is a field Totem has never sent — so every step, and every number hanging off
   * one, was silently dropped and the section simply never appeared.
   */
  const steps = (Array.isArray(goal?.subGoals) ? goal.subGoals : []).map(s => ({
    id: s.id,
    title: s.title || '',
    complete: Boolean(s.complete),
    // Decided against rather than done: it stays visible, crossed off, and is out
    // of the count. Same distinction Totem draws on the goal itself.
    abandoned: Boolean(s.abandoned),
    metrics: metricsOf(s),
    percent: Math.max(0, Math.min(100, Math.round(num(s.progress?.percent)))),
  }))

  const own = metrics.length
    ? Math.round(metrics.reduce((a, m) => a + m.percent, 0) / metrics.length)
    : (goal?.complete ? 100 : 0)
  const percent = Number.isFinite(Number(goal?.progress?.percent))
    ? Math.max(0, Math.min(100, Math.round(Number(goal.progress.percent))))
    : own

  return {
    id: goal?.id,
    title: goal?.title || 'Untitled goal',
    notes: goal?.notes || '',
    period: goal?.period?.label || '',
    periodState: goal?.periodState || 'active',
    daysLeft: goal?.daysLeft ?? null,
    complete: Boolean(goal?.complete),
    postponed: num(goal?.postponedCount),
    metrics,
    percent,
    // Sub-goals, if it has them. Totem allows exactly one level, and each may
    // carry numbers of its own.
    steps,
  }
}

/** Everything a card needs, for every Bushido goal. */
export const bushidoGoalCards = (cache) => bushidoGoals(cache).map(goalSummary)

/**
 * A line about how the period is going, or null.
 *
 * Only says something when there is something to say. "16 days left" on a goal at
 * 90% is noise; "16 days left and you are at 10%" is the whole point of having
 * put the goal somewhere you look every day.
 */
export function goalNudge(card) {
  if (card.complete) return null
  if (card.daysLeft === null || card.daysLeft < 0) return null
  // Numbers anywhere — a goal whose only numbers are on its steps is exactly the
  // shape this nudge is for.
  if (!card.metrics.length && !card.steps.some(s => s.metrics.length)) return null
  if (card.daysLeft <= 7 && card.percent < 60) {
    return `${card.daysLeft} day${card.daysLeft === 1 ? '' : 's'} left and ${card.percent}% done.`
  }
  if (card.postponed >= 2) {
    return `Pushed ${card.postponed} times. That is usually a goal you have decided not to do.`
  }
  return null
}
