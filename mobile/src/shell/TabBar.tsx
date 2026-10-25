// The phone layout's tab bar (styles.css, max-width 719px): a glass capsule
// floating over the bottom of the screen, icon over label, the selected tab a
// lit pill with its icon in the accent, the session scrolling underneath it.
// With three or four tabs (`compactDock`) the + sits beside the capsule in the
// same row and at the same height, so the foot of the screen is one row of
// things to press; with more, the capsule takes the width and the + floats
// above it. Drawn here because the bar is the one thing that knows which tab is
// showing (the + menu's Log a workout uses the day Today is showing only when
// opened from Today).
import React from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { BlurView } from 'expo-blur'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { BottomTabBarProps } from 'expo-router/tabs'
import { alpha, colors, elevation, font, radius } from '../theme'
import { T } from '../ui/Text'
import { Press } from '../ui/kit'
import { Icon, TAB_ICONS } from '../lib/icons'
import { impact, tap } from '../ui/haptics'
import { useApp } from './AppData'
import { compactDock, DOCK_BOTTOM, DOCK_CLEAR, DOCK_H } from './Screen'
import { tabsFor } from '../features/app'

/** Route name (src/app/(tabs)/*) to the web's tab id. */
const ID_OF: Record<string, string> = { index: 'today' }

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets()
  const { me, plan, openMenu } = useApp()
  const allowed = new Set(tabsFor(me.features, me.owner).map((t) => t.id as string))
  const routes = state.routes.filter((r) => allowed.has(ID_OF[r.name] || r.name))
  const activeName = state.routes[state.index]?.name
  const activeId = ID_OF[activeName] || activeName
  const bottom = Math.max(DOCK_BOTTOM, insets.bottom)
  const compact = compactDock(me)
  const side = 12

  return (
    <>
      {/* Cards dissolve into the bottom of the screen instead of meeting a hard edge. */}
      <LinearGradient
        pointerEvents="none"
        colors={['transparent', alpha(colors.bg, 0.62), alpha(colors.bg, 0.97)]}
        locations={[0, 0.44, 1]}
        style={[st.fade, { height: DOCK_CLEAR + insets.bottom + 26 }]}
      />

      {plan ? (
        <View
          style={compact ? [st.fabsCompact, { bottom, right: side }] : [st.fabs, { bottom: bottom + DOCK_H + 18 }]}
          pointerEvents="box-none"
        >
          <Press accessibilityLabel="Add a workout" onPress={() => { impact(); openMenu(activeId) }}
            style={[st.plus, compact && { width: DOCK_H, height: DOCK_H, borderRadius: DOCK_H / 2 }]}>
            <Icon name="Plus" size={24} color={colors.onAccent} />
          </Press>
        </View>
      ) : null}

      <View style={[st.dock, { bottom, left: side, right: compact && activeId !== 'coach' && plan ? side + DOCK_H + 10 : side }]}>
        {Platform.OS === 'ios' ? <BlurView tint="dark" intensity={60} style={StyleSheet.absoluteFill} /> : null}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: alpha(colors.panel, Platform.OS === 'ios' ? 0.56 : 0.92) }]} />
        {routes.map((route) => {
          const id = ID_OF[route.name] || route.name
          const label = tabsFor(me.features, me.owner).find((t) => t.id === id)?.label || id
          const on = id === activeId
          return (
            <Press
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={label}
              style={[st.tab, on && st.tabOn]}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
                if (!on && !event.defaultPrevented) { tap(); navigation.navigate(route.name) }
              }}
            >
              <Icon name={TAB_ICONS[id]} size={compact ? 20 : 17} color={on ? colors.accent : colors.inkDim} strokeWidth={on ? 2 : 1.75} />
              <T size={compact ? font.caption : font.micro} weight={600} color={on ? colors.ink : colors.inkDim} lineHeight={14} numberOfLines={1}>{label}</T>
            </Press>
          )
        })}
      </View>
    </>
  )
}

const st = StyleSheet.create({
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  dock: {
    position: 'absolute', height: DOCK_H,
    flexDirection: 'row', alignItems: 'stretch', padding: 5, gap: 2,
    borderRadius: radius.pill, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  tab: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: radius.pill, paddingHorizontal: 2 },
  // The selected tab is a lit pill as well as a colour, so it never relies on colour alone.
  tabOn: { backgroundColor: 'rgba(255,255,255,0.09)' },
  fabs: { position: 'absolute', right: 18, flexDirection: 'row', alignItems: 'center', gap: 10 },
  fabsCompact: { position: 'absolute', flexDirection: 'column-reverse', alignItems: 'flex-end', gap: 10 },
  plus: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    ...elevation[2],
  },
})
