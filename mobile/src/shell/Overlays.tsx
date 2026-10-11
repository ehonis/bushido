// What the + opens, from any tab: App.jsx's `fab` switch. Each is the same
// component the web renders, as a native sheet; each writes only through the
// AppData write paths (placeAll, keepPlan, takeRest), on the user's tap.
import React from 'react'
import { localIso } from '../lib/dates.js'
import { useApp } from './AppData'
import { FabMenu, RestPrompt } from '../features/app'
import { ActivityChooser, SessionPicker, activityFieldOf } from '../features/picker'
import { PlanFlow } from '../features/planner'
import { WeekPlanFlow } from '../features/weekplanner'

export function Overlays() {
  const {
    store, plan, me, fab, setFab, placeToday, keepPlan, startPlanned,
    restOpt, restOn, restDate, askRest, takeRest,
  } = useApp()
  if (!fab || !plan) return null
  const close = () => setFab(null)

  if (fab === 'menu') {
    return (
      <FabMenu
        onClose={close}
        onPlan={() => setFab('plan')}
        onLog={() => setFab('log')}
        onPickSession={() => setFab('pick')}
        onRest={restOpt ? () => askRest() : null}
        onPlanWeek={me.features.ai ? () => setFab('week') : null}
      />
    )
  }
  // The week's quotas, talked through. Writes the same `quota-<monday>` entry
  // the Week tab's steppers write, and only on their tap.
  if (fab === 'week') {
    return (
      <WeekPlanFlow plan={plan} entries={store.entries} iso={localIso()}
        upsertEntry={store.upsertEntry} onPlan={() => setFab('plan')} onClose={close} />
    )
  }
  // Log a workout: the SAME screen as "pick a session", over the sports catalog.
  if (fab === 'log') {
    return (
      <ActivityChooser plan={plan} field={activityFieldOf(plan)}
        onPick={(activity: string) => placeToday('log-workout', { out: { activity } })} onClose={close} />
    )
  }
  if (fab === 'rest' && restOpt) {
    return <RestPrompt opt={restOpt} date={restDate} entryFor={restOn} onSave={takeRest} onClose={close} />
  }
  if (fab === 'pick') {
    return <SessionPicker plan={plan} onPick={(optId: string) => placeToday(optId)} onClose={close} />
  }
  if (fab === 'plan') {
    return <PlanFlow plan={plan} entries={store.entries} iso={localIso()} onKeep={keepPlan} onStart={startPlanned} onClose={close} />
  }
  return null
}
