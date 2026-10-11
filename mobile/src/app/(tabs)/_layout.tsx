// The signed-in app: the web's seven tabs (App.jsx TABS, filtered by tabsFor),
// with the phone layout's floating glass bar and the + row drawn by TabBar, and
// the + menu's sheets mounted once over all of them.
import React from 'react'
import { Tabs } from 'expo-router'
import { AppProvider, useApp } from '../../shell/AppData'
import { TabBar } from '../../shell/TabBar'
import { Overlays } from '../../shell/Overlays'
import { useAccessReauth } from '../../shell/accessReauth'
import { colors } from '../../theme'

function Inner() {
  const { store } = useApp()
  useAccessReauth(() => { void store.refresh() })
  return (
    <>
      <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}>
        <Tabs.Screen name="index" options={{ title: 'Today' }} />
        <Tabs.Screen name="week" options={{ title: 'Week' }} />
        <Tabs.Screen name="log" options={{ title: 'Log' }} />
        <Tabs.Screen name="progress" options={{ title: 'Progress' }} />
        <Tabs.Screen name="achievements" options={{ title: 'Achievements' }} />
        <Tabs.Screen name="goals" options={{ title: 'Goals' }} />
        <Tabs.Screen name="coach" options={{ title: 'Coach' }} />
      </Tabs>
      <Overlays />
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
