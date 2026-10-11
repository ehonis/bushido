// Every tab's frame: the web's header (.hdr: the mark, "Bushido", the streak,
// the profile button), the acting banner, and a scrolling body that clears the
// floating tab bar (--dock-clear). Pull down to sync, the native form of the
// store re-reading on focus.
import React, { useState } from 'react'
import { RefreshControl, ScrollView, StyleSheet, View, type ScrollViewProps } from 'react-native'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors } from '../theme'
import { T } from '../ui/Text'
import { Icon } from '../lib/icons'
import { streakDays } from '../lib/streak.js'
import { useApp } from './AppData'
import { ActingBanner } from '../features/app'
import { ProfileMenu } from '../features/profile'

/** The floating capsule's height, its gap to the screen edge, and the 16pt the CSS adds (--dock-clear). */
export const DOCK_H = 58
export const DOCK_BOTTOM = 10
export const DOCK_CLEAR = DOCK_H + DOCK_BOTTOM + 16
/** The + row sits above the dock (.fabs bottom: 76px on a phone), and the last card clears it too. */
export const FAB_CLEAR = DOCK_CLEAR + 56 + 20

/**
 * Days in a row, in the header. No background and no border: a reading, not a
 * control. Renders nothing at zero.
 */
function HeaderStreak({ entries }: { entries: any[] }) {
  const n = streakDays(entries)
  if (!n) return null
  return (
    <View style={st.streak} accessibilityLabel={`${n} day${n === 1 ? '' : 's'} trained in a row`}>
      <Icon name="Flame" size={15} color={colors.flame} />
      <T size={14} weight={600} tabular lineHeight={16}>{String(n)}</T>
    </View>
  )
}

export function Header() {
  const { store, plan, me } = useApp()
  return (
    <View style={st.hdr}>
      <View style={st.title}>
        {/* The mark takes the accent; the word stays ink. */}
        <Image source={require('../../assets/images/bushido-mark.png')} style={{ width: 18, height: 18 }} tintColor={colors.accent} />
        <T size={15} weight={600} style={{ letterSpacing: 0.3 }}>Bushido</T>
      </View>
      <HeaderStreak entries={store.entries} />
      <ProfileMenu me={me} plan={plan} entries={store.entries}
        upsertEntry={store.upsertEntry} deleteEntry={store.deleteEntry}
        status={store.status} lastSync={store.lastSync} />
    </View>
  )
}

/**
 * A tab. `scroll={false}` hands the body to a screen that scrolls itself (a
 * list, the coach thread) and must pad its own foot by FAB_CLEAR.
 */
export function Screen({ children, scroll = true, fabs = true, contentStyle, scrollProps }: {
  children: React.ReactNode
  scroll?: boolean
  /** Whether the + row floats over this tab (not on Coach). */
  fabs?: boolean
  contentStyle?: ScrollViewProps['contentContainerStyle']
  scrollProps?: ScrollViewProps
}) {
  const insets = useSafeAreaInsets()
  const { store, me, reloadPlan } = useApp()
  const [refreshing, setRefreshing] = useState(false)
  const refresh = async () => {
    setRefreshing(true)
    reloadPlan()
    try { await store.refresh() } finally { setRefreshing(false) }
  }
  const foot = (fabs ? FAB_CLEAR : DOCK_CLEAR) + insets.bottom
  return (
    <View style={[st.screen, { paddingTop: insets.top }]}>
      <Header />
      <ActingBanner me={me} />
      {scroll ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[{ padding: 16, paddingBottom: foot }, contentStyle]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.inkDim} />}
          {...scrollProps}
        >
          {children}
        </ScrollView>
      ) : <View style={{ flex: 1 }}>{children}</View>}
    </View>
  )
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  hdr: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  title: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7 },
  streak: { flexDirection: 'row', alignItems: 'center', gap: 5 },
})
