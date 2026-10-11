// App.jsx's <main> for every tab but Log: the plan loading, the plan missing,
// or the tab. Log needs no plan, so it is the one tab that renders without.
import React from 'react'
import { Card, Empty, H2, Sub } from '../../ui/kit'
import { T } from '../../ui/Text'
import { useApp } from '../../shell/AppData'

export function PlanGate({ children }: { children: (plan: any) => React.ReactNode }) {
  const { plan } = useApp()
  if (plan === undefined) return <Empty>Loading plan…</Empty>
  if (plan === null) {
    return (
      <Card>
        <H2>Program not generated yet</H2>
        <Sub style={{ marginBottom: 0 }}>
          The API, sync layer, charts and log are live, but the server could not read its content
          file. Import a plan or go back to the starter in Settings (the web app's /settings page) —
          these tabs fill in automatically, no rebuild. The <T size={13} weight={700}>Log</T> tab works right now.
        </Sub>
      </Card>
    )
  }
  return <>{children(plan)}</>
}
