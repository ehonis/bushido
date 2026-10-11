import React from 'react'
import { Screen } from '../../shell/Screen'
import { useApp } from '../../shell/AppData'
import { PlanGate } from './PlanGate'
import { CoachTab } from '../coach'

// The thread scrolls itself and the composer sits on the keyboard, so the
// frame does not scroll; there is no + on this tab.
export default function CoachScreen() {
  const { me, placeFromCoach } = useApp()
  return (
    <Screen scroll={false} fabs={false}>
      <PlanGate>{(plan) => (me.features.ai ? <CoachTab plan={plan} onPlace={placeFromCoach} /> : null)}</PlanGate>
    </Screen>
  )
}
