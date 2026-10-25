import React from 'react'
import { Screen } from '../../shell/Screen'
import { useApp } from '../../shell/AppData'
import { PlanGate } from './PlanGate'
import { TodayTab } from '../tabs'

export default function TodayScreen() {
  const { store, openEntryId, setOpenEntryId, setFab, restOpt, askRest, openLog, setViewDay } = useApp()
  return (
    <Screen>
      <PlanGate>
        {(plan) => (
          <TodayTab plan={plan} entries={store.entries}
            upsertEntry={store.upsertEntry} deleteEntry={store.deleteEntry}
            openEntryId={openEntryId} onOpened={() => setOpenEntryId(null)}
            onPlan={() => setFab('plan')} onLog={openLog}
            onViewDay={setViewDay}
            onRest={restOpt ? askRest : null} />
        )}
      </PlanGate>
    </Screen>
  )
}
