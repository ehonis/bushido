import React from 'react'
import { Screen } from '../../shell/Screen'
import { useApp } from '../../shell/AppData'
import { PlanGate } from './PlanGate'
import { TodayTab } from '../tabs'

export default function TodayScreen() {
  const { store, openEntryId, setOpenEntryId, setFab, restOpt, askRest, setTab, openLog, setViewDay } = useApp()
  return (
    <Screen>
      <PlanGate>
        {(plan) => (
          <TodayTab plan={plan} entries={store.entries}
            upsertEntry={store.upsertEntry} deleteEntry={store.deleteEntry}
            settings={store.settings} saveSettings={store.saveSettings}
            openEntryId={openEntryId} onOpened={() => setOpenEntryId(null)}
            onPlan={() => setFab('plan')} onLog={openLog}
            onViewDay={setViewDay}
            onRest={restOpt ? askRest : null}
            onSetWeek={() => setTab('week')} />
        )}
      </PlanGate>
    </Screen>
  )
}
