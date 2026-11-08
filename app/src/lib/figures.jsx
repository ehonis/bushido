/*
 * Exercise figures on the web: the "oh, THAT's what it looks like" picture.
 *
 * The drawings themselves are data in figuredata.js, shared byte for byte with
 * the iPhone app; this file only turns shapes into SVG. Why they are drawn, the
 * one skeleton and the cue vocabulary are written down there.
 *
 * Colours come from the container: the body is `currentColor` (`.fig` inherits
 * it, so the how-to card is --ink, a row thumbnail --ink-dim and an open row or
 * workout mode --accent), and the one cue per figure is `--fig-cue` (the accent,
 * or --ink where the body itself is the accent). See .fig in css/sheet.css.
 * Under prefers-reduced-motion the crossfade stops and pose B stays ghosted
 * behind pose A.
 */

import { FIGURES, KINDS, hasFigure } from './figuredata.js'

export { FIGURES, hasFigure }

function Shape({ s }) {
  const k = KINDS[s.k]
  const a = { opacity: k.opacity }
  if (k.cue) a.className = 'fig-cue'
  if (k.fill) a.fill = 'currentColor'
  else {
    Object.assign(a, {
      fill: 'none', stroke: 'currentColor', strokeWidth: s.w ?? k.stroke,
      strokeLinecap: 'round', strokeLinejoin: 'round',
    })
    if (s.dash) a.strokeDasharray = s.dash
  }
  return s.c
    ? <circle cx={s.c[0]} cy={s.c[1]} r={s.c[2]} {...a} />
    : <path d={s.d} {...a} />
}

const layer = (shapes) => (shapes || []).map((s, i) => <Shape key={i} s={s} />)

/**
 * One figure, sized entirely by its container: a 50×42 row thumbnail, the
 * 44×38 one in workout mode, the how-to card. `detail` (the finger inset) is
 * for the card; thumbnails pass false.
 */
export function Figure({ name, className = '', detail = true }) {
  const fig = FIGURES[name]
  if (!fig) return null
  const moves = Boolean(fig.b)
  return (
    <svg className={`fig ${moves ? 'fig-move' : ''} ${className}`.trim()}
      viewBox="0 0 120 100" role="img" aria-label={fig.alt} focusable="false">
      {layer(fig.props)}
      {layer(fig.s)}
      {moves && <g className="fig-p2">{layer(fig.b)}</g>}
      <g className={moves ? 'fig-p1' : ''}>{layer(fig.a)}</g>
      {layer(fig.over)}
      {detail && fig.detail && <g className="fig-detail">{layer(fig.detail)}</g>}
    </svg>
  )
}
