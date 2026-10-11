import React from 'react'
import { Screen } from '../../shell/Screen'
import { useApp } from '../../shell/AppData'
import { PlanGate } from './PlanGate'
import { WeekTab } from '../tabs'

export default function WeekScreen() {
  const { store } = useApp()
  return (
    <Screen>
      <PlanGate>{(plan) => <WeekTab plan={plan} entries={store.entries} upsertEntry={store.upsertEntry} />}</PlanGate>
    </Screen>
  )
}
