/*
 * Exercise figures — the "oh, THAT's what it looks like" picture
 * (app/src/lib/figures.jsx, ported).
 *
 * These are the web's own drawings: the same paths and circles, copied verbatim,
 * drawn with react-native-svg instead of the DOM. Do not redraw them here; change
 * the web's and copy again.
 *
 * Why drawn rather than photographed: photographs of these specific drills
 * mostly do not exist under a licence we could ship, a photo of roughly the right
 * movement teaches the wrong movement, and the app has to work in a basement with
 * no signal. A line drawing of the exact prescribed position beats an
 * approximately-right photograph.
 *
 * Two kinds of figure:
 *
 *   HOLD      one pose. `a` only. Nothing is moving, so nothing animates.
 *   MOVEMENT  two poses. `a` is the start, `b` is the end, and they crossfade so
 *             the movement reads at a glance. `s` holds whatever doesn't move
 *             between them, so only the limb that actually travels changes.
 *
 * `props` is scenery — the rail, the floor, the wall — drawn faint, so the body
 * is what your eye lands on. Under Reduce Motion the crossfade stops and pose B
 * stays ghosted behind pose A, as the web's .fig CSS does.
 *
 * Coordinates are a 120x100 box. Keep figures legible at 64px, which is the size
 * they render at mid-set, at arm's length, on a phone.
 */
import React, { useEffect } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import Svg, { Circle, G, Path, Rect } from 'react-native-svg'
import Animated, {
  Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming,
  cancelAnimation,
} from 'react-native-reanimated'
import { colors } from '../theme'

/* ------------------------------------------------------------------ drawing */

const LINE = {
  fill: 'none', stroke: 'currentColor', strokeWidth: 4.5,
  strokeLinecap: 'round', strokeLinejoin: 'round',
} as const

/** A limb, a torso, a rope — anything that is part of the body. */
const L = (props: any) => <Path {...LINE} {...props} />

/** Scenery: the rail you hang off, the floor you lie on, the wall you climb. */
const P = (props: any) => (
  <Path fill="none" stroke="currentColor" strokeWidth={5} strokeLinecap="round"
    opacity="0.28" {...props} />
)

const Head = ({ cx, cy, r = 6.5 }: { cx: number; cy: number; r?: number }) => <Circle cx={cx} cy={cy} r={r} fill="currentColor" />

/** A held object — a plate, a hangboard block, a crash pad. */
const Weight = ({ cx, cy, r = 7 }: { cx: number; cy: number; r?: number }) => <Circle cx={cx} cy={cy} r={r} fill="currentColor" />

/* Reusable scenery, so the six hanging figures agree about where the rail is. */
const RAIL = <P d="M24 15 H96" strokeWidth={7} />
const FLOOR = <P d="M10 90 H110" />

/* -------------------------------------------------------------- the figures */

export const FIGURES: Record<string, { alt: string; props?: React.ReactNode; s?: React.ReactNode; a: React.ReactNode; b?: React.ReactNode }> = {
  /* --- hanging ---------------------------------------------------------- */

  'hang-edge': {
    alt: 'Hanging from a hangboard edge with both hands, shoulders pulled down',
    props: RAIL,
    a: (
      <G>
        <L d="M48 18 L50 30 L52 43" /><L d="M72 18 L70 30 L68 43" />
        <L d="M52 43 H68" />
        <Head cx={60} cy={35} />
        <L d="M60 43 V66" />
        <L d="M60 66 L53 90" /><L d="M60 66 L67 90" />
      </G>
    ),
  },

  'hang-assisted': {
    alt: 'Hanging from a rung with a counterweight taking load off',
    props: (
      <G>
        {RAIL}
        <P d="M104 20 a6 6 0 1 0 0.1 0" strokeWidth={4} />
        <P d="M104 26 V44" strokeWidth={3.5} />
        <P d="M97 44 h14 l-2 14 h-10 z" strokeWidth={3.5} />
        <P d="M99 21 C86 34, 76 50, 68 62" strokeWidth={3} />
      </G>
    ),
    a: (
      <G>
        <L d="M48 18 L50 30 L52 43" /><L d="M72 18 L70 30 L68 43" />
        <L d="M52 43 H68" />
        <Head cx={60} cy={35} />
        <L d="M60 43 V64" />
        <L d="M60 64 L53 88" /><L d="M60 64 L67 88" />
      </G>
    ),
  },

  'hang-knee-lift': {
    alt: 'Hanging still and lifting one knee to touch a sling',
    props: (
      <G>
        {RAIL}
        <P d="M90 18 V56" strokeWidth={3.5} />
        <P d="M84 58 a6 4 0 1 0 12 0 a6 4 0 1 0 -12 0" strokeWidth={3.5} />
      </G>
    ),
    s: (
      <G>
        <L d="M50 18 V43" /><L d="M70 18 V43" />
        <L d="M52 43 H68" />
        <Head cx={60} cy={35} />
        <L d="M60 43 V66" />
      </G>
    ),
    a: <G><L d="M60 66 L54 90" /><L d="M60 66 L66 90" /></G>,
    b: <G><L d="M60 66 L54 90" /><L d="M60 66 L74 62 L88 58" /></G>,
  },

  /* The one figure where the POINT is that a hand is somewhere new. Feet stay
   * planted on the stair and the left arm never moves, so both live in `s` and
   * the crossfade shows exactly one thing: the right hand travelling across the
   * rungs. The stair is drawn because the stair is the load. */
  'board-crawl': {
    alt: 'Feet on a stair, hands moving from rung to rung across a hangboard',
    props: (
      <G>
        <P d="M18 14 H102" strokeWidth={7} />
        <P d="M38 9 V19 M58 9 V19 M78 9 V19" strokeWidth={2.5} />
        <P d="M8 92 H58 M58 92 V80 H82 M82 80 V70 H112" strokeWidth={4} />
      </G>
    ),
    s: (
      <G>
        <Head cx={48} cy={26} />
        <L d="M53 32 L44 24 L38 18" />
        <L d="M53 32 L70 50" />
        <L d="M70 50 L80 60 L88 69" />
        <L d="M70 50 L77 63 L84 69" />
      </G>
    ),
    a: <L d="M53 32 L56 24 L58 18" />,
    b: <L d="M53 32 L66 27 L78 18" />,
  },

  /* The arms are locked straight in both poses, so the ONLY difference is the
   * whole body rising and the head coming back out of the shoulders. Drawn with
   * more travel than the real rep has, because a truthful two-inch rise is
   * invisible at 64px and the point of the drawing is that nothing bends. */
  'scap-pull': {
    alt: 'Hanging with straight arms and pulling the shoulders down away from the ears',
    props: RAIL,
    a: (
      <G>
        <L d="M50 18 V49" /><L d="M70 18 V49" />
        <L d="M52 49 H68" />
        <Head cx={60} cy={44} />
        <L d="M60 49 V71" />
        <L d="M60 71 L54 94" /><L d="M60 71 L66 94" />
      </G>
    ),
    b: (
      <G>
        <L d="M50 18 V36" /><L d="M70 18 V36" />
        <L d="M52 36 H68" />
        <Head cx={60} cy={26} />
        <L d="M60 36 V58" />
        <L d="M60 58 L54 81" /><L d="M60 58 L66 81" />
      </G>
    ),
  },

  /* --- the load cell ---------------------------------------------------- */

  'no-hang-pull': {
    alt: 'Standing on a webbing loop, pulling straight up on an edge held at the side',
    props: (
      <G>
        <P d="M14 92 H106" />
        <P d="M66 66 V86" strokeWidth={3} />
        <P d="M58 88 a8 3.5 0 1 0 16 0 a8 3.5 0 1 0 -16 0" strokeWidth={3.5} />
        <P d="M86 84 V64 M81 69 L86 63 L91 69" strokeWidth={3.5} />
      </G>
    ),
    a: (
      <G>
        <Head cx={54} cy={16} />
        <L d="M54 23 V56" />
        <L d="M54 30 L44 54" />
        <L d="M54 30 L64 44 L66 60" />
        <Rect x="60" y="60" width="12" height="6" rx="2.5" fill="currentColor" />
        <L d="M54 56 L46 90" /><L d="M54 56 L66 90" />
      </G>
    ),
  },

  /* --- the floor -------------------------------------------------------- */

  'plank-reach': {
    alt: 'Forearm plank, sliding one arm forward along the floor past the head',
    props: <P d="M8 84 H112" />,
    s: (
      <G>
        <Head cx={38} cy={48} r={6} />
        <L d="M44 54 L80 66 L102 78" />
        <L d="M98 78 L108 81" />
      </G>
    ),
    a: <G><L d="M44 54 V80" /><L d="M44 80 H26" /></G>,
    b: <G><L d="M44 54 L18 74" /></G>,
  },

  /* The top arm points at the ceiling. It is not in the prescription — but
   * without it this is the same silhouette as the plank-reach above, and these
   * two are consecutive exercises in the same session. */
  'side-bridge': {
    alt: 'Side plank with the top arm raised, dipping the hip and pressing back to the line',
    props: <P d="M8 88 H112" />,
    s: (
      <G>
        <Head cx={24} cy={48} r={6} />
        <L d="M30 54 V78" /><L d="M30 78 H14" />
        <L d="M30 54 L34 18" />
      </G>
    ),
    a: <G><L d="M30 54 L64 68 L98 83" /><L d="M94 83 L104 85" /></G>,
    b: <G><L d="M30 54 L64 80 L98 83" /><L d="M94 83 L104 85" /></G>,
  },

  pressup: {
    alt: 'Press-up, lowering with the elbows tucked close to the ribs',
    props: <P d="M8 86 H112" />,
    a: (
      <G>
        <Head cx={26} cy={40} r={6} />
        <L d="M32 45 L72 60 L100 76" />
        <L d="M32 45 V81" />
      </G>
    ),
    b: (
      <G>
        <Head cx={24} cy={54} r={6} />
        <L d="M30 59 L72 68 L100 78" />
        <L d="M30 59 L21 72 L32 81" />
      </G>
    ),
  },

  /* --- hips ------------------------------------------------------------- */

  cossack: {
    alt: 'Cossack squat: sitting down over one leg with the other locked straight',
    props: <P d="M10 92 H110" />,
    a: (
      <G>
        <Head cx={60} cy={16} />
        <L d="M60 23 V50" />
        <L d="M60 29 L51 40" /><L d="M60 29 L69 40" />
        <Weight cx={60} cy={42} r={6.5} />
        <L d="M60 50 L38 90" /><L d="M60 50 L82 90" />
      </G>
    ),
    b: (
      <G>
        <Head cx={74} cy={32} />
        <L d="M74 39 V64" />
        <L d="M74 44 L66 54" /><L d="M74 44 L82 54" />
        <Weight cx={74} cy={56} r={6.5} />
        <L d="M74 64 L28 89" />
        <L d="M74 64 L88 76 L79 90" />
      </G>
    ),
  },

  /* Both hip drills are drawn from above, because that is the only view in which
   * "front shin across you, back shin behind you" is a shape rather than a
   * sentence. The feet are marked, or the legs read as scaffolding. */
  'ninety-ninety': {
    alt: 'Seated 90/90, sweeping both knees through to the mirror position (seen from above)',
    s: (
      <G>
        <Head cx={60} cy={24} r={7.5} />
        <L d="M48 37 H72" />
        <L d="M60 32 V56" />
      </G>
    ),
    a: (
      <G>
        <L d="M60 56 L32 57 L30 30" /><Circle cx="30" cy="27" r="4" fill="currentColor" />
        <L d="M60 56 L88 57 L90 82" /><Circle cx="90" cy="85" r="4" fill="currentColor" />
      </G>
    ),
    b: (
      <G>
        <L d="M60 56 L88 57 L90 30" /><Circle cx="90" cy="27" r="4" fill="currentColor" />
        <L d="M60 56 L32 57 L30 82" /><Circle cx="30" cy="85" r="4" fill="currentColor" />
      </G>
    ),
  },

  'straddle-sit': {
    alt: 'Seated straddle with the feet on a wall, walking the hands forward (seen from above)',
    props: <P d="M8 13 H112" strokeWidth={8} />,
    s: (
      <G>
        <L d="M60 76 L24 24" /><L d="M16 21 L32 27" />
        <L d="M60 76 L96 24" /><L d="M88 27 L104 21" />
      </G>
    ),
    a: (
      <G>
        <L d="M60 76 V58" />
        <Head cx={60} cy={49} />
        <L d="M60 60 L44 44" /><Circle cx="41" cy="41" r="4" fill="currentColor" />
        <L d="M60 60 L76 44" /><Circle cx="79" cy="41" r="4" fill="currentColor" />
      </G>
    ),
    b: (
      <G>
        <L d="M60 76 V48" />
        <Head cx={60} cy={39} />
        <L d="M60 50 L44 33" /><Circle cx="41" cy="30" r="4" fill="currentColor" />
        <L d="M60 50 L76 33" /><Circle cx="79" cy="30" r="4" fill="currentColor" />
      </G>
    ),
  },

  /* --- forearms --------------------------------------------------------- */

  /* From above. Side-on, the forearm swings straight through the torso and the
   * whole thing reads as a bar across a stick figure. */
  'ext-rotation': {
    alt: 'Band external rotation with the elbow pinned against the ribs (seen from above)',
    props: <P d="M98 48 h5 l4 -8 l5 16 l4 -8 h2" strokeWidth={3.5} />,
    s: (
      <G>
        <Head cx={58} cy={18} r={7.5} />
        <Rect x="42" y="30" width="32" height="44" rx="13" {...LINE} />
        <L d="M74 40 L79 60" />
      </G>
    ),
    a: <G><L d="M79 60 L52 68" /><Circle cx="49" cy="69" r="4.5" fill="currentColor" /></G>,
    b: <G><L d="M79 60 L96 48" /><Circle cx="98" cy="47" r="4.5" fill="currentColor" /></G>,
  },

  'wrist-ext': {
    alt: 'Wrist extension: forearm resting on the thigh, palm down, lifting the weight with the hand',
    props: <Rect x="8" y="60" width="66" height="16" rx="7" fill="currentColor" opacity="0.24" />,
    s: <G><L d="M20 50 L70 56" /><Circle cx="20" cy="50" r="5" fill="currentColor" /></G>,
    a: <G><L d="M70 56 L83 70" /><Weight cx={88} cy={76} /></G>,
    b: <G><L d="M70 56 L83 40" /><Weight cx={88} cy={34} /></G>,
  },

  /*
   * Eccentric rotation, seen end-on down the forearm: the fist is the circle,
   * the plate is the lever sticking out of it. Which way the lever swings IS
   * the exercise, and it is the thing the written protocol could not convey.
   */
  'forearm-supination': {
    alt: 'Eccentric supination: lowering a rim-held plate from palm-up back to palm-down',
    props: (
      <G>
        <P d="M14 86 H106" strokeWidth={7} />
        <P d="M86 30 A34 34 0 0 1 88 66 M82 60 L88 67 L80 70" strokeWidth={3.5} />
      </G>
    ),
    s: (
      <G>
        <Circle cx="56" cy="50" r="12" {...LINE} />
        <L d="M56 62 V82" />
      </G>
    ),
    a: <G><L d="M56 50 L28 34" /><Weight cx={24} cy={31} /></G>,
    b: <G><L d="M56 50 L28 66" /><Weight cx={24} cy={69} /></G>,
  },

  'forearm-pronation': {
    alt: 'Eccentric pronation: lowering a rim-held plate from palm-down back to palm-up',
    props: (
      <G>
        <P d="M14 86 H106" strokeWidth={7} />
        <P d="M88 66 A34 34 0 0 1 86 30 M80 36 L86 29 L92 36" strokeWidth={3.5} />
      </G>
    ),
    s: (
      <G>
        <Circle cx="56" cy="50" r="12" {...LINE} />
        <L d="M56 62 V82" />
      </G>
    ),
    a: <G><L d="M56 50 L28 66" /><Weight cx={24} cy={69} /></G>,
    b: <G><L d="M56 50 L28 34" /><Weight cx={24} cy={31} /></G>,
  },

  /* --- grips ------------------------------------------------------------ */

  /* Which fingers are ON the edge is the whole distinction between the three
   * abrahang blocks, and it is the one thing a body figure cannot show. */
  ...(() => {
    // A ledge rather than a bar, and a thumb on the palm: without both, this
    // reads as a handbag with legs rather than a hand on an edge.
    const edge = <Path d="M6 58 H114 V80 H6 Z" fill="currentColor" opacity="0.24" />
    const palm = (
      <G>
        <Rect x="28" y="14" width="64" height="28" rx="10" {...LINE} />
        <L d="M28 28 L13 40" />
      </G>
    )
    const XS = [32, 47, 62, 77]
    const on = (i: number) => (
      <Rect key={i} x={XS[i]} y="40" width="13" height="26" rx="6" {...LINE} />
    )
    const off = (i: number) => (
      <Rect key={`o${i}`} x={XS[i]} y="40" width="13" height="13" rx="6"
        {...LINE} opacity="0.25" />
    )
    const grip = (alt: string, live: number[]) => ({
      alt,
      props: edge,
      a: <G>{palm}{XS.map((_, i) => (live.includes(i) ? on(i) : off(i)))}</G>,
    })
    return {
      'grip-four': grip('All four fingers on the edge', [0, 1, 2, 3]),
      'grip-front-three': grip('Index, middle and ring on the edge; pinky lifted off', [0, 1, 2]),
      'grip-two': grip('Two fingers on the edge, the other two lifted off', [0, 1]),
    }
  })(),

  /* --- climbing --------------------------------------------------------- */

  ...(() => {
    /* One climber, reused on three different bits of terrain. Redrawing them
     * separately would only produce three slightly different climbers. */
    const climber = (
      <G>
        <Head cx={52} cy={30} />
        <L d="M54 37 L60 60" />
        <L d="M54 39 L41 22" /><L d="M54 39 L68 26" />
        <L d="M60 60 L49 80" /><L d="M60 60 L72 75" />
      </G>
    )
    const holds = (
      <G opacity="0.3" fill="currentColor">
        <Circle cx="39" cy="19" r="3.5" /><Circle cx="70" cy="23" r="3.5" />
        <Circle cx="47" cy="83" r="3.5" /><Circle cx="74" cy="73" r="3.5" />
      </G>
    )
    return {
      'climb-board': {
        alt: 'Climbing an overhanging board',
        props: <G><P d="M14 4 L82 96" strokeWidth={7} />{holds}</G>,
        a: climber,
      },
      'climb-route': {
        alt: 'Leading a route on a vertical wall',
        props: (
          <G>
            <P d="M20 4 V96" strokeWidth={7} />
            {holds}
            <P d="M60 62 C 48 78, 40 86, 30 96" strokeWidth={3} />
          </G>
        ),
        a: climber,
      },
      'climb-double': {
        alt: 'Climbing a route, lowering, and immediately climbing it again',
        props: (
          <G>
            <P d="M20 4 V96" strokeWidth={7} />
            {holds}
            <P d="M60 62 C 48 78, 40 86, 30 96" strokeWidth={3} />
            <P d="M92 26 a16 16 0 1 1 -11 27 M75 47 L81 54 L73 57" strokeWidth={3.5} />
          </G>
        ),
        a: climber,
      },
      boulder: {
        alt: 'Bouldering above a crash pad',
        props: (
          <G>
            <P d="M16 4 L74 84" strokeWidth={7} />
            {holds}
            <P d="M12 94 H82" strokeWidth={8} />
          </G>
        ),
        a: climber,
      },
      crag: {
        alt: 'Climbing a route on real rock',
        props: (
          <G>
            <P d="M22 4 L16 30 L26 52 L14 74 L22 96" strokeWidth={7} />
            {holds}
            <P d="M60 62 C 48 78, 40 86, 30 96" strokeWidth={3} />
          </G>
        ),
        a: climber,
      },
    }
  })(),

  /* A traverse is horizontal, so the wall is drawn as two rows of holds and the
   * floor is close underneath — being low IS the drill. Feet and the left hand
   * stay put in `s`; the crossfade shows the one thing that matters, the right
   * hand travelling sideways to the next hold along. */
  'wall-traverse': {
    alt: 'Traversing sideways along a climbing wall on big holds, low to the ground',
    props: (
      <G>
        {FLOOR}
        <P d="M22 26 h8 M44 20 h8 M66 26 h8 M86 20 h8" strokeWidth={4} />
        <P d="M32 68 h8 M56 70 h8 M80 66 h8" strokeWidth={4} />
      </G>
    ),
    s: (
      <G>
        <Head cx={48} cy={34} />
        <L d="M48 41 L36 32 L26 25" />
        <L d="M48 41 L50 60" />
        <L d="M50 60 L38 67" /><L d="M50 60 L60 69" />
      </G>
    ),
    a: <L d="M48 41 L58 32 L68 25" />,
    b: <L d="M48 41 L68 28 L88 19" />,
  },
}

/* ---------------------------------------------------------------- rendering */

/** True if the plan can name this figure. Pinned by the content test. */
export const hasFigure = (name: any) => Boolean(name && FIGURES[name])

/*
 * The crossfade, from styles.css: a 3s ease-in-out loop where A holds at 1 for
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

function Layer({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 120 100" color={color}>
      {children}
    </Svg>
  )
}

/**
 * One figure. Sized entirely by its container — every place that uses it is a
 * different size, from a 50pt row thumbnail to a half-screen how-to panel.
 * `color` is the CSS's currentColor (.fig is --ink-dim; .how-fig makes it --ink).
 */
export function Figure({ name, color = colors.inkDim, style }: {
  name: any
  className?: string
  color?: string
  style?: StyleProp<ViewStyle>
}) {
  const fig = name ? FIGURES[name] : null
  const moves = Boolean(fig?.b)
  const fade = useCrossfade(moves)
  if (!fig) return null
  return (
    <View style={[st.fig, style]} accessible accessibilityRole="image" accessibilityLabel={fig.alt}>
      <View style={StyleSheet.absoluteFill}>
        <Layer color={color}>{fig.props}{fig.s}{moves ? null : fig.a}</Layer>
      </View>
      {moves ? (
        <>
          <Animated.View style={[StyleSheet.absoluteFill, fade.b]}><Layer color={color}>{fig.b}</Layer></Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, fade.a]}><Layer color={color}>{fig.a}</Layer></Animated.View>
        </>
      ) : null}
    </View>
  )
}

const st = StyleSheet.create({
  fig: { width: '100%', height: '100%' },
})
