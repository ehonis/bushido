// The phone layout's tab bar (styles.css, max-width 719px): a glass capsule
// floating over the bottom of the screen, icon over label, colour alone marking
// the selected tab, with the session scrolling underneath it. Above it on the
// right, the two floating buttons (.fabs): the + (the action, filled) and the
// coach bubble (the thing you ask when you do not know what the action is).
// They are drawn here because the bar is the one thing that knows which tab is
// showing, and the + is hidden on Coach.
import React from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { BlurView } from 'expo-blur'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { BottomTabBarProps } from 'expo-router/tabs'
import { alpha, colors } from '../theme'
import { T } from '../ui/Text'
import { Press } from '../ui/kit'
import { Icon, TAB_ICONS } from '../lib/icons'
import { impact, tap } from '../ui/haptics'
import { useApp } from './AppData'
import { DOCK_BOTTOM, DOCK_CLEAR, DOCK_H } from './Screen'
import { tabsFor } from '../features/app'
import { CoachBubble } from '../features/coach'

/** Route name (src/app/(tabs)/*) to the web's tab id. */
const ID_OF: Record<string, string> = { index: 'today' }

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets()
  const { me, plan, setFab, placeFromCoach } = useApp()
  const allowed = new Set(tabsFor(me.features, me.owner).map((t) => t.id as string))
  const routes = state.routes.filter((r) => allowed.has(ID_OF[r.name] || r.name))
  const activeName = state.routes[state.index]?.name
  const activeId = ID_OF[activeName] || activeName
  const bottom = Math.max(DOCK_BOTTOM, insets.bottom)

  return (
    <>
      {/* Cards dissolve into the bottom of the screen instead of meeting a hard edge. */}
      <LinearGradient
        pointerEvents="none"
        colors={['transparent', alpha(colors.bg, 0.62), alpha(colors.bg, 0.97)]}
        locations={[0, 0.44, 1]}
        style={[st.fade, { height: DOCK_CLEAR + insets.bottom + 26 }]}
      />

      {activeId !== 'coach' && plan ? (
        <View style={[st.fabs, { bottom: bottom + DOCK_H + 18 }]} pointerEvents="box-none">
          {me.features.ai ? <CoachBubble plan={plan} onPlace={placeFromCoach} /> : null}
          <Press accessibilityLabel="Add a workout" onPress={() => { impact(); setFab('menu') }} style={st.plus}>
            <Icon name="Plus" size={24} color={colors.bg} />
          </Press>
        </View>
      ) : null}

      <View style={[st.dock, { bottom }]}>
        {Platform.OS === 'ios' ? <BlurView tint="dark" intensity={60} style={StyleSheet.absoluteFill} /> : null}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: alpha(colors.panel, Platform.OS === 'ios' ? 0.56 : 0.92) }]} />
        {routes.map((route) => {
          const id = ID_OF[route.name] || route.name
          const label = tabsFor(me.features, me.owner).find((t) => t.id === id)?.label || id
          const on = id === activeId
          const color = on ? colors.accent : colors.inkDim
          return (
            <Press
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={label}
              style={st.tab}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
                if (!on && !event.defaultPrevented) { tap(); navigation.navigate(route.name) }
              }}
            >
              <Icon name={TAB_ICONS[id]} size={17} color={color} strokeWidth={on ? 2 : 1.75} />
              <T size={10} weight={600} color={color} lineHeight={12} numberOfLines={1} style={{ letterSpacing: 0.1 }}>{label}</T>
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
    position: 'absolute', left: 10, right: 10, height: DOCK_H,
    flexDirection: 'row', alignItems: 'stretch', paddingHorizontal: 5, gap: 2,
    borderRadius: 26, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  tab: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 20, paddingHorizontal: 2 },
  fabs: { position: 'absolute', right: 18, flexDirection: 'row', alignItems: 'center', gap: 10 },
  plus: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 8 },
  },
})
