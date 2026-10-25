// What the + opens, from any tab: App.jsx's `fab` switch. Each is the same
// component the web renders, as a native sheet; each writes only through the
// AppData write paths (placeAll, keepPlan, takeRest), on the user's tap.
import React, { useState } from 'react'
import { localIso } from '../lib/dates.js'
import { useApp } from './AppData'
import { FabMenu, RestPrompt } from '../features/app'
import { ActivityChooser, activityFieldOf } from '../features/picker'
import { outWith } from '../lib/unlogged.js'
import { PlanFlow } from '../features/planner'
import { PersonDay } from '../features/trainer'
import { openTimerAfterSheet } from '../features/timer'
import * as trainerLib from '../lib/trainer.js'

export function Overlays() {
  const {
    store, plan, fab, setFab, placeAll, keepPlan, startPlanned,
    menuFrom, viewDay, logAt, openLog, dayLabel,
    restOpt, restOn, restDate, askRest, takeRest, people, keepPlanFor,
  } = useApp()
  // Their week, opened from the planner's last screen after planning for them.
  const [personView, setPersonView] = useState<{ person: any; entryId: string } | null>(null)
  if (personView && plan) {
    return (
      <PersonDay person={personView.person} date={localIso()} plan={plan} openId={personView.entryId}
        onClose={() => setPersonView(null)} />
    )
  }
  if (!fab || !plan) return null
  const close = () => setFab(null)

  if (fab === 'menu') {
    return (
      <FabMenu
        onClose={close}
        onPlan={() => setFab('plan')}
        onLog={() => openLog(menuFrom === 'today' ? viewDay : null)}
        onRest={restOpt ? () => askRest() : null}
        onTimer={() => { setFab(null); openTimerAfterSheet() }}
      />
    )
  }
  // Log a workout: the one door for something already done. The plan's cards
  // are in it as the climbing folders; anything else is the sports catalog,
  // answered before the form opens. A climb from the unlogged card lands on its
  // card with the measurement attached, and the sheet opens: the hard-finger
  // question is the reason it goes through a climbing card at all. Done like
  // anything on a day that has arrived; until answered, `fingerLoad` stands in.
  if (fab === 'log') {
    const date = logAt.date || localIso()
    return (
      <ActivityChooser plan={plan} field={activityFieldOf(plan)}
        dayLabel={dayLabel(logAt.date)} climbingOnly={Boolean(logAt.climb)}
        onPick={(activity: string) => placeAll([{ optId: 'log-workout', data: { out: { activity } } }], { date })}
        onPickCard={(optId: string) => {
          const opt = (plan?.dailyMenu || []).find((o: any) => o.id === optId)
          const out = logAt.climb && opt ? (outWith as any)(opt, {}, logAt.climb) : {}
          placeAll([{ optId, data: { out } }], { date })
        }}
        onClose={close} />
    )
  }
  if (fab === 'rest' && restOpt) {
    return <RestPrompt opt={restOpt} date={restDate} entryFor={restOn} onSave={takeRest} onClose={close} />
  }
  if (fab === 'plan') {
    return (
      <PlanFlow plan={plan} entries={store.entries} iso={localIso()} onKeep={keepPlan} onStart={startPlanned} onClose={close}
        people={people} onKeepFor={keepPlanFor}
        onStartFor={(person: any, entryId: string) => {
          setFab(null)
          setPersonView({ person: { ...person, tone: (trainerLib as any).toneFor(people, person.id) }, entryId })
        }} />
    )
  }
  return null
}
