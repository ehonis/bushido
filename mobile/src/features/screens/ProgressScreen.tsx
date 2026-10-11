import React from 'react'
import { Screen } from '../../shell/Screen'
import { useApp } from '../../shell/AppData'
import { PlanGate } from './PlanGate'
import { ProgressView } from '../progress'

export default function ProgressScreen() {
  const { store } = useApp()
  return (
    <Screen>
      <PlanGate>{(plan) => <ProgressView plan={plan} entries={store.entries} />}</PlanGate>
    </Screen>
  )
}
