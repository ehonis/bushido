/*
 * Exercise figures on the phone (app/src/lib/figures.jsx, ported).
 *
 * The drawings are data in figuredata.js, the web's own file copied byte for
 * byte (app/libsync.test.js holds it to the web's). This file only turns shapes
 * into react-native-svg elements, exactly as figures.jsx turns them into DOM
 * ones, so the phone and the web draw the same picture. Never draw here: change
 * the web's figuredata.js and copy it again. Why they are drawn, the one
 * skeleton and the cue vocabulary are written down in that file.
 *
 * `color` is the CSS's currentColor (the how-to card passes colors.ink, a row
 * thumbnail colors.inkDim, an open row and workout mode colors.accent); `cue`
 * is --fig-cue, the accent, or ink where the body itself is the accent. Under
 * Reduce Motion the crossfade stops and pose B stays ghosted behind pose A, as
 * the web's .fig CSS does.
 */
import React, { useEffect } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import Svg, { Circle, G, Path } from 'react-native-svg'
import Animated, {
  Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming,
  cancelAnimation,
} from 'react-native-reanimated'
import { colors } from '../theme'
import { FIGURES, KINDS, hasFigure, mirrored } from './figuredata.js'

export { FIGURES, hasFigure, mirrored }

type Shape = { k: keyof typeof KINDS; d?: string; c?: [number, number, number]; w?: number; dash?: string }

function shape(s: Shape, i: number, color: string, cue: string) {
  const k: any = KINDS[s.k]
  const ink = k.cue ? cue : color
  const a: any = { key: i, opacity: k.opacity }
  if (k.fill) a.fill = ink
  else {
    Object.assign(a, {
      fill: 'none', stroke: ink, strokeWidth: s.w ?? k.stroke,
      strokeLinecap: 'round', strokeLinejoin: 'round',
    })
    if (s.dash) a.strokeDasharray = s.dash
  }
  return s.c
    ? <Circle cx={s.c[0]} cy={s.c[1]} r={s.c[2]} {...a} />
    : <Path d={s.d} {...a} />
}

const draw = (shapes: Shape[] | undefined, color: string, cue: string) =>
  (shapes || []).map((s, i) => shape(s, i, color, cue))

/*
 * The crossfade, from the web's CSS: a 3s ease-in-out loop where A holds at 1 for
 * 0–40%, fades to 0.15 by 52%, holds to 92% and comes back by 100%; B mirrors
 * it. Neither ever goes fully transparent — a figure that blinks out reads as a
 * glitch, where one that fades to a ghost reads as "and this is where it ends up".
 */
const CYCLE = 3000
const LOW = 0.15
const ease = Easing.inOut(Easing.ease)

function useCrossfade(on: boolean) {
  const reduce = useReducedMotion()
  // 0 = pose A showing, 1 = pose B showing.
  const t = useSharedValue(0)
  const run = on && !reduce
  useEffect(() => {
    if (!run) { cancelAnimation(t); t.value = 0; return }
    t.value = withRepeat(withSequence(
      withDelay(CYCLE * 0.4, withTiming(1, { duration: CYCLE * 0.12, easing: ease })),
      withDelay(CYCLE * 0.4, withTiming(0, { duration: CYCLE * 0.08, easing: ease })),
    ), -1)
    return () => cancelAnimation(t)
  }, [run, t])
  const a = useAnimatedStyle(() => ({ opacity: 1 - (1 - LOW) * t.value }))
  // Reduced motion: no animation, and B is a 0.28 ghost behind A.
  const b = useAnimatedStyle(() => ({ opacity: run ? LOW + (1 - LOW) * t.value : 0.28 }))
  return { a, b }
}

function Layer({ children, view, mirror }: { children: React.ReactNode; view: number[]; mirror?: boolean }) {
  return (
    <Svg width="100%" height="100%" viewBox={view.join(' ')}>
      <G transform={mirror ? `matrix(-1 0 0 1 ${2 * view[0] + view[2]} 0)` : undefined}>{children}</G>
    </Svg>
  )
}

/**
 * One figure, sized entirely by its container: a 50pt row thumbnail, the one in
 * workout mode, the how-to card. The viewBox is the figure's own framing
 * (`view`), so the person fills the box; `mirror` flips a sided figure for the
 * other hand (`mirrored()`), as the web's does.
 */
export function Figure({ name, color = colors.inkDim, cue, mirror = false, style }: {
  name: any
  className?: string
  color?: string
  cue?: string
  mirror?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const fig: any = name ? (FIGURES as any)[name] : null
  const moves = Boolean(fig?.b)
  const fade = useCrossfade(moves)
  if (!fig) return null
  const cueInk = cue ?? (color === colors.accent ? colors.ink : colors.accent)
  const view: number[] = fig.view
  return (
    <View style={[st.fig, style]} accessible accessibilityRole="image" accessibilityLabel={fig.alt}>
      <View style={StyleSheet.absoluteFill}>
        <Layer view={view} mirror={mirror}>
          {draw(fig.props, color, cueInk)}
          {draw(fig.s, color, cueInk)}
          {moves ? null : draw(fig.a, color, cueInk)}
          {moves ? null : draw(fig.over, color, cueInk)}
        </Layer>
      </View>
      {moves ? (
        <>
          <Animated.View style={[StyleSheet.absoluteFill, fade.b]}><Layer view={view} mirror={mirror}>{draw(fig.b, color, cueInk)}</Layer></Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, fade.a]}><Layer view={view} mirror={mirror}>{draw(fig.a, color, cueInk)}</Layer></Animated.View>
          <View style={StyleSheet.absoluteFill} pointerEvents="none"><Layer view={view} mirror={mirror}>{draw(fig.over, color, cueInk)}</Layer></View>
        </>
      ) : null}
    </View>
  )
}

/** Does this figure have a close-up for the card (a finger on an edge, the tall back)? */
export const hasDetail = (name: any) => Boolean(name && (FIGURES as any)[name]?.detail)

/** The card's close-up, drawn beside the figure, large (the web's FigureDetail). */
export function FigureDetail({ name, color = colors.ink, cue = colors.accent, style }: {
  name: any
  color?: string
  cue?: string
  style?: StyleProp<ViewStyle>
}) {
  const fig: any = name ? (FIGURES as any)[name] : null
  if (!fig?.detail) return null
  const [w, h] = fig.detailBox
  return (
    <View style={[{ height: '100%', aspectRatio: w / h }, style]} accessible accessibilityRole="image" accessibilityLabel="Close-up">
      <Svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`}>{draw(fig.detail, color, cue)}</Svg>
    </View>
  )
}

const st = StyleSheet.create({
  fig: { width: '100%', height: '100%' },
})
