// The signed-in app: the web's three tabs (App.jsx TABS: Today, Log, Progress),
// with the phone layout's floating glass bar and the + row drawn by TabBar, and
// the + menu's sheets mounted once over all of them.
import React from 'react'
import { Tabs } from 'expo-router'
import { AppProvider, useApp } from '../../shell/AppData'
import { TabBar } from '../../shell/TabBar'
import { Overlays } from '../../shell/Overlays'
import { TimerHost } from '../../features/timer'
import { useAccessReauth } from '../../shell/accessReauth'
import { colors } from '../../theme'

function Inner() {
  const { store } = useApp()
  useAccessReauth(() => { void store.refresh() })
  return (
    <>
      <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}>
        <Tabs.Screen name="index" options={{ title: 'Today' }} />
        <Tabs.Screen name="log" options={{ title: 'Log' }} />
        <Tabs.Screen name="progress" options={{ title: 'Progress' }} />
      </Tabs>
      <Overlays />
      {/* The interval timer, and a run that was going when the app went away. */}
      <TimerHost entries={store.entries} upsertEntry={store.upsertEntry} deleteEntry={store.deleteEntry} />
    </>
  )
}

export default function TabsLayout() {
  return (
    <AppProvider>
      <Inner />
    </AppProvider>
  )
}
