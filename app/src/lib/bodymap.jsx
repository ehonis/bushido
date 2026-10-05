/*
 * The little body, showing what a movement works.
 *
 * Every lifting exercise shows a small body figure highlighting the muscles it
 * works, wherever the exercise name appears in the app.
 *
 * NOTHING HERE IS DRAWN BY HAND, and that is the point. Two open pieces do the
 * work:
 *
 *   `react-body-highlighter` (MIT) draws an anterior and a posterior body as SVG
 *     with twenty-two named muscle regions, and colours them by how often each
 *     appears in the data you hand it.
 *   `free-exercise-db` (public domain, 876 movements) knows which muscles each
 *     exercise works. `app/muscles.build.mjs` matched it against the catalog's
 *     207 and wrote the result into plan.json — see that script for the matching,
 *     the vocabulary mapping and the hand corrections.
 *
 * TWO TIERS OUT OF A FREQUENCY COUNTER. The library has no notion of primary and
 * secondary; it counts how many exercises in `data` name each muscle and indexes
 * `highlightedColors` by that count. So a primary muscle is listed twice and a
 * secondary once, which lands them on colours[1] and colours[0]. That is a
 * borrowed mechanism rather than a fought-with one, and it is why the data below
 * has two rows in it.
 *
 * BOTH VIEWS, ALWAYS. A chest press works the front and a row works the back, and
 * a single anterior body would silently render a row as a body with nothing lit.
 * Two small drawings side by side cost the space of one medium one.
 */

import { memo, useMemo } from 'react'
import * as bodyHighlighter from 'react-body-highlighter'

/*
 * The component, however deep the bundler buried it.
 *
 * The package ships CJS (`main`) and ESM (`module`), and the two disagree about
 * where the default export ends up. Vite takes the ESM build and `ns.default` is
 * the component. The smoke suite bundles with `--packages=external` and gets the
 * CJS one, where `ns.default` is the whole `module.exports` object and the
 * component is at `ns.default.default` — React renders that as "got: object" and
 * every lift screen fails to render, which is exactly what happened.
 *
 * So: walk down `.default` until something looks like a React element type. One
 * `||` was not enough and would have broken again on the next bundler.
 */
function unwrap(mod, depth = 3) {
  let cur = mod
  for (let i = 0; i < depth; i += 1) {
    if (typeof cur === 'function' || cur?.$$typeof) return cur
    if (!cur?.default) break
    cur = cur.default
  }
  return cur
}

const Model = unwrap(bodyHighlighter)

/** The catalog's answer for one exercise key, or null. */
export function musclesOf(field, key) {
  if (!key) return null
  const ex = (field?.exercises || []).find(e => e.key === key)
  const m = ex?.muscles
  if (!m || !Array.isArray(m.primary) || !m.primary.length) return null
  return { primary: m.primary, secondary: Array.isArray(m.secondary) ? m.secondary : [] }
}

/** Everything a whole list of movements works, for a one-body summary. */
export function musclesAcross(field, keys = []) {
  const primary = new Set()
  const secondary = new Set()
  for (const k of keys) {
    const m = musclesOf(field, k)
    if (!m) continue
    m.primary.forEach(x => primary.add(x))
    m.secondary.forEach(x => secondary.add(x))
  }
  if (!primary.size && !secondary.size) return null
  return {
    primary: [...primary],
    // A muscle that is primary anywhere is not also secondary.
    secondary: [...secondary].filter(x => !primary.has(x)),
  }
}

/*
 * The palette, as literal hex.
 *
 * `var(--accent)` would be nicer and does not work: the library writes these into
 * an SVG `fill` attribute rather than a style, and an attribute does not resolve
 * custom properties. These are `--accent` and a muted body tone copied from
 * styles.css, and `npm run palette` does not police them because they are not
 * data-viz roles — if the palette changes, change them here too.
 */
const BODY = '#272b27'
const SECOND = '#5f7a2f'
const PRIMARY = '#b8f23d'

/**
 * One movement, as a pair of small bodies.
 *
 * `memo` because a session sheet renders one of these per exercise and each is
 * two SVGs of about fifty paths — cheap to draw once, wasteful to redraw every
 * time a rep stepper moves three rows below it.
 */
export const BodyMap = memo(function BodyMap({ primary = [], secondary = [], size = 34, label }) {
  const data = useMemo(() => ([
    // Twice for primary, once for secondary — see the header.
    { name: 'primary', muscles: primary },
    { name: 'primary', muscles: primary },
    { name: 'secondary', muscles: secondary },
  ]), [primary, secondary])

  if (!primary.length && !secondary.length) return null
  const style = { width: size, height: 'auto' }

  return (
    <span className="bodymap" style={{ '--bm': `${size}px` }}
      role="img" aria-label={label || `works ${primary.join(', ')}`}>
      <Model data={data} type="anterior" style={style} bodyColor={BODY}
        highlightedColors={[SECOND, PRIMARY]} />
      <Model data={data} type="posterior" style={style} bodyColor={BODY}
        highlightedColors={[SECOND, PRIMARY]} />
    </span>
  )
})

/** The same thing, straight off a catalog key. Null when the catalog has no answer. */
export function ExerciseBody({ field, exercise, size = 34, name }) {
  const m = musclesOf(field, exercise)
  if (!m) return null
  return <BodyMap primary={m.primary} secondary={m.secondary} size={size}
    label={name ? `${name} works ${m.primary.join(', ')}` : undefined} />
}

/** "Chest, front delts" — the words, for where a picture is too small to read. */
export function muscleWords(m, limit = 3) {
  if (!m) return ''
  const pretty = (s) => s.replace(/-/g, ' ').replace('deltoids', 'delts')
  const list = m.primary.slice(0, limit).map(pretty)
  const more = m.primary.length - list.length
  return list.join(', ') + (more > 0 ? ` +${more}` : '')
}
