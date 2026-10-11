import React from 'react'
import { Screen } from '../../shell/Screen'
import { useApp } from '../../shell/AppData'
import { PlanGate } from './PlanGate'
import { AchievementsTab } from '../achievements'

export default function AchievementsScreen() {
  const { store } = useApp()
  return (
    <Screen>
      <PlanGate>{(plan) => <AchievementsTab plan={plan} entries={store.entries} upsertEntry={store.upsertEntry} />}</PlanGate>
    </Screen>
  )
}
