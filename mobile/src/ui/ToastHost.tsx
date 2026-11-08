// Toasts, from Totem's app (the web has none): one solid fill per kind, white
// text, full width under the header, stacked as a deck (newest in front, two
// peeking behind; tap to spread, which holds them). Reads lib/toast.ts, so any
// module that calls pushError() just works: the native screens use it for a
// failed request the web would have shown inline or swallowed.
import React, { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { View, StyleSheet, Pressable } from 'react-native'
import Animated, { FadeInUp, FadeOut, cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useToasts, dismissToast, holdToasts, type Toast } from '../lib/toast'
import { Icon } from '../lib/icons'
import { colors, font, radius, space, TAP } from '../theme'
import { T } from './Text'
import { Press } from './kit'
import { success, tap, warn } from './haptics'

const ICONS = { error: 'TriangleAlert', success: 'CircleCheck', info: 'Info' } as const
const FILL = { error: colors.toastError, success: colors.toastSuccess, info: colors.toastInfo }

const SHOWN = 3
const PEEK = 10
const SHRINK = 0.06
const GAP = 8
const EASE = { duration: 420, easing: Easing.bezier(0.22, 1, 0.36, 1) }

/** Time left on screen, flush with the top edge; holds while the deck is spread. */
function Countdown({ duration, held, restart }: { duration: number; held: boolean; restart: number }) {
  const left = useSharedValue(1)
  useEffect(() => { left.value = 1 }, [restart, left])
  useEffect(() => {
    if (held) { cancelAnimation(left); return }
    left.value = withTiming(0, { duration: duration * left.value, easing: Easing.linear })
  }, [held, duration, left, restart])
  const style = useAnimatedStyle(() => ({ transform: [{ scaleX: left.value }] }))
  return <Animated.View pointerEvents="none" style={[st.bar, style]} />
}

function Item({ t, index, open, offset, frontHeight, onHeight }: {
  t: Toast; index: number; open: boolean; offset: number; frontHeight: number
  onHeight: (id: number, h: number) => void
}) {
  useEffect(() => { if (t.kind === 'error') warn(); else if (t.kind === 'success') success() }, [t.kind, t.count])
  const behind = index > 0 && !open
  const y = useSharedValue(0)
  const scale = useSharedValue(1)
  const fade = useSharedValue(1)
  useEffect(() => {
    y.value = withTiming(open ? offset : index * PEEK, EASE)
    scale.value = withTiming(open ? 1 : 1 - index * SHRINK, EASE)
    fade.value = withTiming(behind ? 0 : 1, { duration: 200 })
  }, [open, offset, index, behind, y, scale, fade])
  const frame = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }, { scale: scale.value }] }))
  const body = useAnimatedStyle(() => ({ opacity: fade.value }))
  const actionIcon = t.action?.icon === null ? null : 'RotateCw'
  return (
    <Animated.View
      entering={FadeInUp.duration(180)}
      exiting={FadeOut.duration(150)}
      pointerEvents={behind ? 'none' : 'auto'}
      style={[st.toast, { backgroundColor: FILL[t.kind] || FILL.error, zIndex: SHOWN - index }, behind && { height: frontHeight }, frame]}
    >
      {t.duration > 0 ? <Countdown duration={t.duration} held={open} restart={t.count} /> : null}
      <Animated.View style={[st.row, body]} onLayout={(e) => onHeight(t.id, Math.round(e.nativeEvent.layout.height))}>
        <Icon name={ICONS[t.kind] || ICONS.error} size={16} color={colors.white} style={{ marginTop: 1 }} />
        <T size={font.label} color={colors.white} style={{ flex: 1 }}>
          {t.text}{t.count > 1 ? <T size={font.caption} weight={600} color={colors.white}>{`  ×${t.count}`}</T> : null}
        </T>
        {t.action ? (
          <Press style={st.action} onPress={() => { const run = t.action!.onClick; dismissToast(t.id); run() }}>
            {actionIcon ? <Icon name={actionIcon} size={13} color={colors.white} /> : null}
            <T size={font.label} weight={600} color={colors.white}>{t.action.label}</T>
          </Press>
        ) : null}
        <Press hitSlop={10} onPress={() => dismissToast(t.id)} accessibilityLabel="Dismiss notification">
          <Icon name="X" size={15} color="rgba(255,255,255,0.75)" />
        </Press>
      </Animated.View>
    </Animated.View>
  )
}

/*
 * ONE VISIBLE HOST, THE TOPMOST (#77). iOS draws a presented page sheet or full
 * screen above the root view, so a host mounted once at the root drew every
 * toast BEHIND an open sheet: the Undo after a removal or a done flip was
 * invisible. So each presented layer (`Modal`, `FullScreen`, `Popover` in
 * Sheet.tsx) mounts its own host inside its native modal, and only the most
 * recently mounted live one renders; the root's takes over again when the
 * last sheet goes. The toasts themselves live in lib/toast.ts, so moving
 * between hosts loses none. A layer that is mounted but not shown (a Popover
 * with visible={false}) does not take the toasts.
 *
 * Chosen over react-native-screens' FullWindowOverlay (installed, iOS only):
 * that is a separate UIWindow with its own touch and layout-animation story
 * that cannot be tried here without a device; this is the same Pressable and
 * Reanimated code the root already runs, inside the window the user sees.
 */
const hosts: number[] = []
let nextHost = 0
const hostSubs = new Set<() => void>()
const hostTop = () => (hosts.length ? hosts[hosts.length - 1] : -1)
const onHosts = (fn: () => void) => { hostSubs.add(fn); return () => { hostSubs.delete(fn) } }
const hostsChanged = () => hostSubs.forEach((fn) => fn())

function useTopHost(active: boolean) {
  const [id] = useState(() => ++nextHost)
  const top = useSyncExternalStore(onHosts, hostTop, hostTop)
  useLayoutEffect(() => {
    if (!active) return undefined
    hosts.push(id)
    hostsChanged()
    return () => {
      const i = hosts.lastIndexOf(id)
      if (i >= 0) hosts.splice(i, 1)
      hostsChanged()
    }
  }, [active, id])
  return active && top === id
}

/** `top`: where the deck starts in this layer (a sheet passes its header's height). */
export default function ToastHost({ active = true, top = null }: { active?: boolean; top?: number | null } = {}) {
  const mine = useTopHost(active)
  if (!mine) return null
  return <Deck top={top} />
}

function Deck({ top }: { top: number | null }) {
  const toasts = useToasts()
  const insets = useSafeAreaInsets()
  const [open, setOpen] = useState(false)
  const [heights, setHeights] = useState<Record<number, number>>({})
  const onHeight = useCallback((id: number, h: number) => setHeights((m) => (m[id] === h ? m : { ...m, [id]: h })), [])
  const shown = toasts.slice(-SHOWN).reverse() // front first
  useEffect(() => { if (shown.length < 2 && open) { setOpen(false); holdToasts(false) } }, [shown.length, open])
  if (!shown.length) return null

  const hOf = (t: Toast) => heights[t.id] || 48
  const frontHeight = hOf(shown[0])
  const offsets: number[] = []
  shown.reduce((y, t) => { offsets.push(y); return y + hOf(t) + GAP }, 0)
  const height = open ? offsets[shown.length - 1] + hOf(shown[shown.length - 1]) : frontHeight + (shown.length - 1) * PEEK
  const toggle = () => { if (shown.length < 2) return; tap(); setOpen(!open); holdToasts(!open) }

  return (
    <View pointerEvents="box-none" style={[st.wrap, { top: top ?? insets.top + 52, height }]}>
      <Pressable onPress={toggle} style={StyleSheet.absoluteFill} accessibilityLabel={open ? 'Stack notifications' : 'Show all notifications'}>
        {shown.map((t, i) => (
          <Item key={t.id} t={t} index={i} open={open} offset={offsets[i]} frontHeight={frontHeight} onHeight={onHeight} />
        ))}
      </Pressable>
    </View>
  )
}

const st = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, zIndex: 1000 },
  toast: {
    position: 'absolute', left: 0, right: 0, top: 0, transformOrigin: 'top',
    borderRadius: radius.card, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 8 },
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2], paddingTop: space[4], paddingBottom: space[3], paddingLeft: space[4], paddingRight: space[3] },
  bar: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.6)', transformOrigin: 'left' },
  action: {
    flexDirection: 'row', alignItems: 'center', gap: space[1], alignSelf: 'center',
    paddingHorizontal: space[2], minHeight: TAP, borderRadius: radius.control, backgroundColor: 'rgba(255,255,255,0.15)',
  },
})
