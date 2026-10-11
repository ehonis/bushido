/*
 * The little body, showing what a movement works (app/src/lib/bodymap.jsx).
 *
 * NOTHING HERE IS DRAWN BY HAND. The web renders `react-body-highlighter` (MIT);
 * that package's entry renders a <div>, so it cannot run on React Native, but its
 * bodies are plain polygon data. `scripts/bodymap-data.mjs` copies those polygons
 * out of the package into `bodymapData.ts`, and this file draws them with
 * react-native-svg exactly the way the library's Model does: one polygon per
 * region, filled by how often the data names that muscle.
 *
 * The muscle lists come from the catalog (`free-exercise-db`, matched by
 * `app/muscles.build.mjs` into plan.json), as on the web.
 *
 * TWO TIERS OUT OF A FREQUENCY COUNTER. The library has no notion of primary and
 * secondary; it counts how many exercises in `data` name each muscle and indexes
 * `highlightedColors` by that count. So a primary muscle is listed twice and a
 * secondary once, which lands them on colours[1] and colours[0]. The same
 * counter is reproduced below so the two drawings agree region for region.
 *
 * BOTH VIEWS, ALWAYS. A chest press works the front and a row works the back, and
 * a single anterior body would silently render a row as a body with nothing lit.
 */
import React, { memo, useMemo } from 'react'
import { View } from 'react-native'
import Svg, { Polygon } from 'react-native-svg'
import { anteriorData, posteriorData, type BodySide } from './bodymapData'

/** The catalog's answer for one exercise key, or null. */
export function musclesOf(field: any, key: any): { primary: string[]; secondary: string[] } | null {
  if (!key) return null
  const ex = (field?.exercises || []).find((e: any) => e.key === key)
  const m = ex?.muscles
  if (!m || !Array.isArray(m.primary) || !m.primary.length) return null
  return { primary: m.primary, secondary: Array.isArray(m.secondary) ? m.secondary : [] }
}

/** Everything a whole list of movements works, for a one-body summary. */
export function musclesAcross(field: any, keys: any[] = []) {
  const primary = new Set<string>()
  const secondary = new Set<string>()
  for (const k of keys) {
    const m = musclesOf(field, k)
    if (!m) continue
    m.primary.forEach((x) => primary.add(x))
    m.secondary.forEach((x) => secondary.add(x))
  }
  if (!primary.size && !secondary.size) return null
  return {
    primary: [...primary],
    // A muscle that is primary anywhere is not also secondary.
    secondary: [...secondary].filter((x) => !primary.has(x)),
  }
}

/*
 * The palette, as literal hex, exactly the web's: `--line` for the body,
 * `--accent` for primary and a muted accent for secondary. `npm run palette`
 * does not police them because they are not data-viz roles; if the palette
 * changes, change them here and in the web's bodymap.jsx too.
 */
const BODY = '#272b27'
const SECOND = '#5f7a2f'
const PRIMARY = '#b8f23d'
const HIGHLIGHTED = [SECOND, PRIMARY]

/** The library's fillMuscleData + fillIntensityColor, as one lookup. */
function fillFor(data: { muscles: string[] }[]) {
  const freq: Record<string, number> = {}
  for (const ex of data) for (const m of ex.muscles) freq[m] = (freq[m] || 0) + 1
  return (muscle: string) => {
    const f = freq[muscle]
    if (!f) return BODY
    return HIGHLIGHTED[Math.min(HIGHLIGHTED.length - 1, f - 1)]
  }
}

function Body({ side, fill, size }: { side: BodySide; fill: (m: string) => string; size: number }) {
  // The library's svg is width 100%, height auto in a box `size` wide, over a
  // 100x200 viewBox: so the body is size wide and twice that tall.
  return (
    <Svg width={size} height={size * 2} viewBox="0 0 100 200">
      {side.map((region) => region.svgPoints.map((points, i) => (
        <Polygon key={`${region.muscle}-${i}`} points={points} fill={fill(region.muscle)} />
      )))}
    </Svg>
  )
}

/**
 * One movement, as a pair of small bodies.
 *
 * `memo` because a session sheet renders one of these per exercise and each is
 * two SVGs of about fifty polygons: cheap to draw once, wasteful to redraw every
 * time a rep stepper moves three rows below it.
 */
export const BodyMap = memo(function BodyMap({ primary = [], secondary = [], size = 34, label }: {
  primary?: string[]
  secondary?: string[]
  size?: number
  label?: string
}) {
  const fill = useMemo(() => fillFor([
    // Twice for primary, once for secondary — see the header.
    { muscles: primary },
    { muscles: primary },
    { muscles: secondary },
  ]), [primary, secondary])

  if (!primary.length && !secondary.length) return null

  return (
    <View
      style={{ flexDirection: 'row', gap: 2, alignItems: 'center', flexShrink: 0 }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label || `works ${primary.join(', ')}`}
    >
      <Body side={anteriorData} fill={fill} size={size} />
      <Body side={posteriorData} fill={fill} size={size} />
    </View>
  )
})

/** The same thing, straight off a catalog key. Null when the catalog has no answer. */
export function ExerciseBody({ field, exercise, size = 34, name }: { field: any; exercise: any; size?: number; name?: string }) {
  const m = musclesOf(field, exercise)
  if (!m) return null
  return <BodyMap primary={m.primary} secondary={m.secondary} size={size}
    label={name ? `${name} works ${m.primary.join(', ')}` : undefined} />
}

/** "Chest, front delts" — the words, for where a picture is too small to read. */
export function muscleWords(m: { primary: string[] } | null | undefined, limit = 3) {
  if (!m) return ''
  const pretty = (s: string) => s.replace(/-/g, ' ').replace('deltoids', 'delts')
  const list = m.primary.slice(0, limit).map(pretty)
  const more = m.primary.length - list.length
  return list.join(', ') + (more > 0 ? ` +${more}` : '')
}
