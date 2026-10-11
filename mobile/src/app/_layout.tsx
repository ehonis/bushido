import '../lib/boot'
import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Stack, ThemeProvider, DarkTheme } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { isConnected, loadConnection, resetGate, setOnSwitched, setUserId, useConnection } from '../lib/connection'
import { loadMe } from '../lib/whoami.js'
import { clearSignedOut } from '../lib/signout.js'
import ToastHost from '../ui/ToastHost'
import { ScreenError } from '../shell/ScreenError'
import { reloadApp } from '../shell/reload'
import { colors } from '../theme'

SplashScreen.preventAutoHideAsync()

// A screen that throws shows ScreenError instead of closing the app (release
// builds otherwise die on any render error). Applies to every nested screen.
export const unstable_settings = { screenErrorBoundary: ScreenError }
export { ScreenError as ErrorBoundary }

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.panel, text: colors.ink, border: colors.line, primary: colors.accent },
}

// The server answered for someone else (the act-as cookie expired, the owner
// switched on another device): restart into the right person's log.
setOnSwitched(reloadApp)

export default function RootLayout() {
  const conn = useConnection()
  const connected = isConnected(conn)
  const [loaded, setLoaded] = useState(false)
  // Whose log this is, decided BEFORE the store mounts, as main.jsx does: the
  // store reads that person's cache. Re-decided on every sign-in.
  const [meFor, setMeFor] = useState<string | null>(null)
  const key = connected ? `${conn.baseUrl}|${conn.kind}|${conn.credential.slice(-12)}` : ''

  useEffect(() => { loadConnection().finally(() => setLoaded(true)) }, [])
  useEffect(() => {
    if (!connected) { setMeFor(null); setUserId(null); return }
    let live = true
    resetGate()
    // (JS default-parameter inference is narrower than the function: hence the cast.)
    ;(loadMe as any)({ fetchFn: fetch, storage: localStorage }).then((me: any) => {
      if (!live) return
      setUserId(me.id)
      // A signed-in load: this device may keep a log again (main.jsx liftSignedOutMarker).
      clearSignedOut(localStorage, globalThis)
      setMeFor(key)
    })
    return () => { live = false }
  }, [key])

  const ready = loaded && (!connected || meFor === key)
  useEffect(() => { if (ready) SplashScreen.hideAsync() }, [ready])
  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.bg }} />

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <ThemeProvider value={theme}>
            <StatusBar style="light" />
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
              <Stack.Protected guard={connected}>
                <Stack.Screen name="(tabs)" />
              </Stack.Protected>
              <Stack.Protected guard={!connected}>
                <Stack.Screen name="connect" options={{ animation: 'fade' }} />
              </Stack.Protected>
            </Stack>
            <ToastHost />
          </ThemeProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
