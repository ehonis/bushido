/*
 * The plan, available anywhere without threading it through five components.
 *
 * Added 2026-09-15 for the gear picker. `SessionLog` is rendered from the day
 * list, the session sheet, the full-screen session, workout mode and the history
 * feed, and none of them passed the plan because nothing inside it had needed the
 * plan before — the session object it renders was always enough.
 *
 * Gear broke that. Which kinds of gear a workout can use, and what is primary for
 * each, are facts about the PLAN and the log rather than about the session in
 * hand, and adding a `plan` prop to five call sites to reach one control is how a
 * prop ends up threaded through components that have no opinion about it.
 *
 * The same arrangement as WhoopProvider and StravaProvider, and for the same
 * reason. Outside a provider `usePlan()` returns null and every consumer is
 * expected to render nothing rather than crash — which is what the render suite
 * mounts most components without one to check.
 */

import { createContext, useContext } from 'react'

const PlanCtx = createContext(null)

export function PlanProvider({ plan, children }) {
  return <PlanCtx.Provider value={plan || null}>{children}</PlanCtx.Provider>
}

export const usePlan = () => useContext(PlanCtx)
