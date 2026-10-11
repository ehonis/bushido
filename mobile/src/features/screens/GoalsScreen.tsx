import React from 'react'
import { Screen } from '../../shell/Screen'
import { PlanGate } from './PlanGate'
import { TotemGoals } from '../goals'

// Totem's, and read-only. `full` because on its own tab there is no reason to
// hide the explanation the way a card on Today had to.
export default function GoalsScreen() {
  return (
    <Screen>
      <PlanGate>{() => <TotemGoals full />}</PlanGate>
    </Screen>
  )
}
