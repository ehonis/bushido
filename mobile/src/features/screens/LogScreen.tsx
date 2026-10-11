import React from 'react'
import { Screen } from '../../shell/Screen'
import { useApp } from '../../shell/AppData'
import { LogTab } from '../log'

// The one tab that renders without a plan (App.jsx: needsPlan = tab !== 'log').
export default function LogScreen() {
  const { store, plan } = useApp()
  return (
    <Screen>
      <LogTab plan={plan} entries={store.entries} upsertEntry={store.upsertEntry} deleteEntry={store.deleteEntry} />
    </Screen>
  )
}
