/*
 * The exercise figures as data: every line of every drawing, for both apps.
 *
 * Why drawn rather than photographed (AGENTS.md §5): photographs of these drills
 * mostly do not exist under a licence we could ship, a photo of roughly the right
 * movement teaches the wrong movement, and the app has to work in a basement with
 * no signal. A line drawing of the exact prescribed position beats an
 * approximately-right photograph.
 *
 * This file is plain JavaScript with no React in it, so the web (figures.jsx) and
 * the iPhone app (mobile/src/lib/figures.tsx) draw the SAME shapes: the native
 * copy of this file is held byte for byte to this one by app/libsync.test.js, and
 * the two renderers only turn shapes into elements. Change a drawing here, once.
 *
 * ONE BODY. Every person in every figure is built by `body()` from joint
 * positions, with the limb lengths in BONES, so an arm cannot be 18 units in one
 * pose and 31 in the next (the first scap-pull read as a pull-up for exactly that
 * reason). Hands and feet are reached with two-bone IK (`reach`), so a hand meant
 * to be on a hold ends ON the hold and a foot meant to be on the floor ends on
 * the floor. Every body is recorded (BODIES) so app/figures.test.jsx can hold the
 * anatomy too: limb lengths, contacts, a head that follows its spine, two arms or
 * two legs that never fuse into one, far limbs clearly behind the near ones.
 *
 * ONE LANGUAGE (both figure councils, 2026-11-08, and their regrade):
 *   - the thumbnail is the primary size. Every figure is FRAMED: `view` is the
 *     part of the drawing the viewBox shows, fitted to the person (and the cue)
 *     with the scenery cropped, so at 50×42 the body fills the box rather than
 *     a fifth of it (`frame()` below; a figure may set its own);
 *   - one view per figure: side view for hangs, floor work and climbing, front
 *     view where the point is left and right or across, top view only where
 *     nothing else shows the shape (90/90, straddle, rotation), with a person who
 *     reads as one from above (head, shoulder bar, trunk, hip bar);
 *   - scenery is `prop` (half strength) and the body touches it;
 *   - exactly ONE cue per figure, in the cue colour (the accent), ON the thing the
 *     card's `watch` line is about, and thick enough to survive 50×42 (at least
 *     2px there; the test checks it). The vocabulary is small:
 *       a cue LIMB / PART  this stays straight, still or set (scap-pull's arms,
 *                          the stacked shoulders of the side bridge)
 *       a dashed LINE      the line the body stays on (press-up, the plumb line)
 *       a cue ARROW        the direction that matters (the slow lowering, the sweep)
 *       a RING             this joint is pinned (the elbow in external rotation)
 *     Where a watch cannot be drawn (a load, a rest), the comment says so and the
 *     cue marks the drill's one physical point instead.
 *   - motion arrows that are not the cue are thin, in the body colour, and point
 *     the way the A-to-B crossfade moves; the two poses differ by at least ten
 *     units on the part that moves, so the crossfade shows at 50px;
 *   - `detail` is a separate small drawing (finger position on an edge, the tall
 *     back) the how-to card shows BESIDE the figure, large. Thumbnails leave it
 *     out.
 *
 * Two kinds of figure:
 *   HOLD      one pose, `a` only.
 *   MOVEMENT  `a` is the start, `b` the end, crossfaded. `s` is whatever does not
 *             move, so only the part that travels changes. `over` sits above both.
 *
 * Coordinates are figure units; the canonical box is 120x100 (`view` crops it).
 */

/* ------------------------------------------------------------------ shapes */

/**
 * How each kind of shape is drawn. A shape is `{ k, d }` (a path) or `{ k, c:
 * [cx, cy, r] }` (a circle), with an optional `w` (stroke width) and `dash`.
 */
export const KINDS = {
  body: { stroke: 4.5 },                          // limbs, torso
  thin: { stroke: 3 },                            // cords, bands, belts, motion arrows
  fill: { fill: true },                           // head, hands, weights
  far: { stroke: 4.5, opacity: 0.45 },            // the far limb in a side view
  farFill: { fill: true, opacity: 0.45 },
  prop: { stroke: 3.5, opacity: 0.5 },            // floor, wall, rail outlines
  propFill: { fill: true, opacity: 0.3 },         // boards, walls, thighs
  hold: { fill: true, opacity: 0.62 },            // climbing holds and rungs
  cue: { stroke: 4, cue: true },
  cueFill: { fill: true, cue: true },
  cueBody: { stroke: 5, cue: true },              // a limb drawn in the cue colour
}

/** The canonical box, and the shape of every view (so nothing is distorted). */
export const BOX = [0, 0, 120, 100]
const ASPECT = 1.2

/* ---------------------------------------------------------------- geometry */

const r1 = (n) => Math.round(n * 10) / 10
const P = ([x, y]) => `${r1(x)} ${r1(y)}`
const rad = (deg) => (deg * Math.PI) / 180

/** The point `len` from `p` in direction `deg` (0 = right, 90 = down). */
export const go = (p, deg, len) => [p[0] + len * Math.cos(rad(deg)), p[1] + len * Math.sin(rad(deg))]
export const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1])
export const angle = (a, b) => (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI
const line = (...pts) => `M${pts.map(P).join(' L')}`
const mid = (a, b, t = 0.5) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

/** A rounded rectangle as a path. */
export const rrect = (x, y, w, h, r) =>
  `M${r1(x + r)} ${r1(y)} H${r1(x + w - r)} A${r} ${r} 0 0 1 ${r1(x + w)} ${r1(y + r)} V${r1(y + h - r)}` +
  ` A${r} ${r} 0 0 1 ${r1(x + w - r)} ${r1(y + h)} H${r1(x + r)} A${r} ${r} 0 0 1 ${r1(x)} ${r1(y + h - r)}` +
  ` V${r1(y + r)} A${r} ${r} 0 0 1 ${r1(x + r)} ${r1(y)} Z`

/** An ellipse as a path (two arcs), for loops and slings. */
const ellipse = (cx, cy, rx, ry) =>
  `M${r1(cx - rx)} ${r1(cy)} A${rx} ${ry} 0 1 0 ${r1(cx + rx)} ${r1(cy)} A${rx} ${ry} 0 1 0 ${r1(cx - rx)} ${r1(cy)}`

/**
 * An arrow from `pts[0]` through the rest, with a head at the last point. Two
 * points make a straight arrow; three make a curve through the middle one.
 */
export function arrow(pts, k = 'cue', head = 5.5, w) {
  const end = pts[pts.length - 1]
  const prev = pts[pts.length - 2]
  const d = pts.length === 3
    ? `M${P(pts[0])} Q${P(pts[1])} ${P(end)}`
    : line(...pts)
  const back = angle(end, prev)
  const shaft = { k, d }
  const tip = { k, d: line(go(end, back + 38, head), end, go(end, back - 38, head)) }
  if (w) { shaft.w = w; tip.w = w }
  return [shaft, tip]
}

/** A circular arc of radius r around c from a0 to a1 degrees, with an arrowhead at a1. */
export function arcArrow(c, r, a0, a1, k = 'cue', dash, head = 6) {
  const p0 = go(c, a0, r)
  const p1 = go(c, a1, r)
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0
  const sweep = a1 > a0 ? 1 : 0
  const back = a1 + (sweep ? -90 : 90)
  const shaft = { k, d: `M${P(p0)} A${r} ${r} 0 ${large} ${sweep} ${P(p1)}` }
  if (dash) shaft.dash = dash
  // The points the arc passes through, so its bounds are its own and not its circle's.
  shaft.via = [0.25, 0.5, 0.75].map(t => go(c, a0 + (a1 - a0) * t, r).map(r1))
  return [shaft, { k, d: line(go(p1, back + 40, head), p1, go(p1, back - 40, head)) }]
}

/* ----------------------------------------------------------------- bounds */

/** Every point a shape reaches (path vertices, arc ends padded by their radii, circles). */
function pointsOf(s) {
  const pad = (s.w ?? KINDS[s.k]?.stroke ?? 0) / 2
  if (s.c) {
    const [x, y, r] = s.c
    const e = r + pad
    return [[x - e, y - e], [x + e, y + e]]
  }
  const out = []
  const tok = s.d.match(/[MLHVQAZ]|-?\d*\.?\d+(?:e-?\d+)?/g) || []
  if (s.via) out.push(...s.via)
  let i = 0
  let cur = [0, 0]
  let cmd = 'M'
  const num = () => Number(tok[i++])
  while (i < tok.length) {
    if (/[MLHVQAZ]/.test(tok[i])) { cmd = tok[i++]; if (cmd === 'Z') continue }
    if (cmd === 'M' || cmd === 'L') cur = [num(), num()]
    else if (cmd === 'H') cur = [num(), cur[1]]
    else if (cmd === 'V') cur = [cur[0], num()]
    else if (cmd === 'Q') { out.push([num(), num()]); cur = [num(), num()] }
    else if (cmd === 'A') {
      const rx = num(); const ry = num(); i += 3
      cur = [num(), num()]
      // Small arcs (rounded corners, loops) are padded by their radius; a big
      // one's own points are in `via`.
      if (rx <= 10) out.push([cur[0] - rx, cur[1] - ry], [cur[0] + rx, cur[1] + ry])
    } else { i++; continue }
    out.push(cur)
  }
  return out.flatMap(([x, y]) => [[x - pad, y - pad], [x + pad, y + pad]])
}

/** Every point a list of shapes reaches (for the test's pose and fill checks). */
export const pointsIn = (shapes) => shapes.flatMap(pointsOf)

/** The bounding box `[x0, y0, x1, y1]` of a list of shapes. */
export function bounds(shapes) {
  const pts = shapes.flatMap(pointsOf)
  if (!pts.length) return null
  return [
    Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])),
    Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1])),
  ]
}

/** The view that frames these shapes: their box plus `pad`, widened to the set's aspect. */
function frameOf(shapes, pad = 5, min = 56) {
  const [x0, y0, x1, y1] = bounds(shapes)
  let w = Math.max(x1 - x0 + 2 * pad, min)
  let h = y1 - y0 + 2 * pad
  if (w / h < ASPECT) w = h * ASPECT
  else h = w / ASPECT
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  return [r1(cx - w / 2), r1(cy - h / 2), r1(w), r1(h)]
}

/* -------------------------------------------------------------- the body */

/** The one skeleton, in figure units. Every person in every figure is this. */
export const BONES = {
  head: 6, neck: 5, torso: 24, upperArm: 13, forearm: 12, hand: 4,
  thigh: 15, shin: 14, foot: 6, shoulders: 7, hips: 4,
}

/**
 * Two-bone IK: the middle joint and the end point of a limb rooted at `root`
 * reaching for `target`. `bend` (+1 or -1) picks which side the elbow or knee
 * goes. A target out of reach leaves the limb straight, pointing at it (the
 * test fails on that, so a figure never pretends to touch what it cannot).
 */
export function reach(root, target, l1, l2, bend) {
  const d = Math.min(dist(root, target), l1 + l2 - 1e-6)
  const base = Math.atan2(target[1] - root[1], target[0] - root[0])
  const cos = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)
  const a = Math.acos(Math.max(-1, Math.min(1, cos)))
  const m = [root[0] + l1 * Math.cos(base + bend * a), root[1] + l1 * Math.sin(base + bend * a)]
  const end = [root[0] + d * Math.cos(base), root[1] + d * Math.sin(base)]
  return [m, end]
}

/** Every limb built while the figures are made, for app/figures.test.jsx. */
export const LIMBS = []
/** Every body built, with its spine, neck and limbs, for the anatomy test. */
export const BODIES = []

/**
 * A limb: from `root`, either reaching `to` (with `bend`) or along two absolute
 * angles `dir: [upper, lower]`, then an optional hand or foot stroke at the
 * absolute angle `end` (length `tip`). Returns the path and its joints.
 */
function limb(root, spec, l1, l2, tipLen) {
  let m, end
  if (spec.dir) {
    m = go(root, spec.dir[0], l1)
    end = go(m, spec.dir[1] ?? spec.dir[0], l2)
  } else {
    [m, end] = reach(root, spec.to, l1, l2, spec.bend ?? 1)
  }
  const pts = [root, m, end]
  let tip = null
  if (spec.end != null) {
    tip = go(end, spec.end, spec.tip ?? tipLen)
    pts.push(tip)
  }
  const out = { d: line(...pts), root, mid: m, end, tip, target: spec.to || null, lengths: [l1, l2] }
  LIMBS.push(out)
  return out
}

/**
 * A person. `view` is 'side' (one shoulder point, one hip point) or 'front'
 * (a shoulder bar and a hip bar). `hip` is the hip centre, `lean` the direction
 * from hip to shoulders (-90 is upright), `neck` the direction from the
 * shoulders to the head (defaults to `lean`; the test holds it within 30°, 40°
 * for a climber looking up at the wall).
 *
 * Limbs are `armL`, `armR`, `legL`, `legR` ("L" is the one drawn on the left in
 * a front view, the near one in a side view). `far` lists the parts drawn at
 * half strength (the far side of a profile), `cue` the parts drawn in the cue
 * colour. The result maps each part to a shape, plus `joints` and `limbs`.
 */
export function body({ view = 'side', hip, lean = -90, neck, armL, armR, legL, legR, far = [], cue = [], torso = BONES.torso, looksUp = false }) {
  const B = BONES
  const sh = go(hip, lean, torso)
  const head = go(sh, neck ?? lean, B.neck + B.head)
  const front = view === 'front'
  const shL = front ? go(sh, lean - 90, B.shoulders) : sh
  const shR = front ? go(sh, lean + 90, B.shoulders) : sh
  const hipL = front ? go(hip, lean - 90, B.hips) : hip
  const hipR = front ? go(hip, lean + 90, B.hips) : hip
  const limbs = {}
  if (armL) limbs.armL = limb(shL, armL, B.upperArm, B.forearm, B.hand)
  if (armR) limbs.armR = limb(shR, armR, B.upperArm, B.forearm, B.hand)
  if (legL) limbs.legL = limb(hipL, legL, B.thigh, B.shin, B.foot)
  if (legR) limbs.legR = limb(hipR, legR, B.thigh, B.shin, B.foot)
  const kindOf = (part, base) => (cue.includes(part) ? 'cueBody' : far.includes(part) ? (base === 'fill' ? 'farFill' : 'far') : base)
  const out = {
    head: { k: kindOf('head', 'fill'), c: [r1(head[0]), r1(head[1]), B.head] },
    torso: {
      k: kindOf('torso', 'body'),
      d: front ? `${line(shL, shR)} ${line(sh, hip)} ${line(hipL, hipR)}` : line(sh, hip),
    },
    joints: { sh, shL, shR, hip, hipL, hipR, head },
    limbs,
  }
  for (const [name, l] of Object.entries(limbs)) out[name] = { k: kindOf(name, 'body'), d: l.d }
  BODIES.push({ view, lean, neck: neck ?? lean, looksUp, limbs, far })
  return out
}

/** The named parts of a body, as a shape list. */
const parts = (b, ...names) => names.map(n => b[n]).filter(Boolean)

/**
 * A person seen from above (the 90/90, the straddle, external rotation): the
 * shoulders a bar with the head drawn ON it and a small tick for the face, the
 * hips a second bar `fwd` units from the shoulders along `dir` (0 when the trunk
 * is upright; negative puts the hips toward the front, as a person sitting tall
 * is drawn from above and a little behind), and the trunk between them. `k` scales it, because from above a
 * person at standing scale is a dot with legs. Returns the shapes and the hip
 * and shoulder points, so legs and arms can be rooted on the right bar.
 */
function topPerson({ at, dir = 90, fwd = 0, k = 1.6, hipBar = true }) {
  const S = at
  const H = go(S, dir + 180, fwd)
  const side = dir + 90
  const bar = (c, half, w) => ({ k: 'body', d: line(go(c, side, half), go(c, side + 180, half)), w })
  const sh = BONES.shoulders * k
  const hp = BONES.hips * k
  // From above a head is about a third of the shoulders' width; scaled with
  // them it is a cloud (round 1's top views).
  const hr = BONES.head + 0.5
  const face = go(S, dir, hr + 0.5)
  return {
    shapes: [
      ...(hipBar ? [bar(H, hp + 1, 6)] : []),
      ...(Math.abs(fwd) > 1 ? [{ k: 'body', d: line(H, S), w: 6 }] : []),
      bar(S, sh, 7),
      { k: 'fill', c: [r1(S[0]), r1(S[1]), hr] },
      { k: 'fill', d: `M${P(go(face, side, 2.6))} L${P(go(face, dir, 3.5))} L${P(go(face, side + 180, 2.6))} Z` },
    ],
    S, H, side,
    hipL: go(H, side + 180, hp), hipR: go(H, side, hp),
    shL: go(S, side + 180, sh), shR: go(S, side, sh),
  }
}

/* ------------------------------------------------------------- scenery */

const FLOOR_Y = 90
/** Where a stroke resting on the floor is centred: half a body stroke above it. */
const ON_FLOOR = FLOOR_Y - 2
const floorLine = (x0 = -20, x1 = 140, y = FLOOR_Y) => ({ k: 'prop', d: `M${x0} ${y} H${x1}` })
const FLOOR = floorLine()

/* The hangboard every hang figure shares, front view: a block with a lip. Hands
 * sit on the lip, fingers over it. */
const BOARD = [
  { k: 'propFill', d: rrect(-10, -10, 140, 21, 3) },
  { k: 'prop', d: 'M-10 12 H130', w: 3 },
]
const LIP = 12

/** A hand on the lip of the board, front view: fingers over the edge, thumb off. */
const gripHand = (x, thumb = 1) => [
  { k: 'fill', d: rrect(x - 4.5, LIP - 3, 9, 8, 3) },
  { k: 'thin', d: line([x + thumb * 3.5, LIP + 4], [x + thumb * 6, LIP + 7]), w: 2.5 },
]

/** A climbing hold: a filled bump on a wall face. */
const hold = (x, y, r = 3.6) => ({ k: 'hold', c: [r1(x), r1(y), r] })

/** A quickdraw clipped to a bolt: two small rings and the sling between. */
const quickdraw = (x, y, k = 'thin') => {
  const cue = k !== 'thin'
  const r = cue ? 3 : 2
  const w = cue ? 3.5 : 2
  return [
    { k, c: [x, y, r], w },
    { k, d: line([x, y + r], [x - 1, y + r + 4.5]), w },
    { k, c: [x - 1, y + 2 * r + 4.8, r + 0.3], w },
  ]
}

/* Finger drawings for the card's inset, each in a 30x30 box: a side view of
 * one finger on an edge, the edge on the left, the finger rising from the hand
 * below. Bones in finger proportion (proximal 11, middle 7, distal 6). Half
 * crimp: the pad flat on the edge top, the middle joint (PIP) bent to 90° above
 * the edge, marked with the cue's right-angle tick. Open: the finger draped
 * over the edge, every joint soft. `ox` shifts it, for two side by side. */
function finger(how, ox = 0) {
  const p = (x, y) => [ox + x, y]
  const edge = { k: 'propFill', d: rrect(ox, 15, 11, 15, 2) }
  if (how === 'crimp') {
    return [
      edge,
      { k: 'body', d: line(p(3.5, 12.5), p(9.5, 12.5), p(16.5, 10.5), p(17.5, 21.5)), w: 4.5 },
      { k: 'body', d: line(p(17.5, 21.5), p(18.5, 31)), w: 7 },
      { k: 'cue', d: line(p(13.2, 11.6), p(13.6, 15.3), p(17.2, 15)), w: 2 },
    ]
  }
  return [
    edge,
    { k: 'body', d: line(p(3.5, 12.5), p(9.5, 12.8), p(15, 17.2), p(17, 27.2)), w: 4.5 },
    { k: 'body', d: line(p(17, 27.2), p(17.6, 31)), w: 7 },
  ]
}

/* ------------------------------------------------------------ the people */

/* Front-view hang from the board: hands on the lip, shoulders set low enough
 * that the neck shows (that IS "shoulders down" in a drawing), legs hanging
 * together. `relax` straightens the arms (the easy hang). */
function hanger({ hipY = 62.5, hands = [46, 74], relax = false } = {}) {
  return body({
    view: 'front', hip: [60, relax ? hipY + 0.6 : hipY],
    armL: { to: [hands[0], LIP + 3], bend: -1 },
    armR: { to: [hands[1], LIP + 3], bend: 1 },
    legL: { dir: [94, 92], end: 125, tip: 4.5 },
    legR: { dir: [86, 88], end: 55, tip: 4.5 },
  })
}

/* A climber in profile facing a wall on the right: the head along the spine,
 * tipped toward the wall to look at it. */
function climber(spec) {
  return body({ view: 'side', far: ['armR', 'legR'], looksUp: true, ...spec })
}

/* -------------------------------------------------------------- the figures */

const FIGS = {
  /* --- hanging ---------------------------------------------------------- */

  /* The cue is the shoulders going DOWN: the shoulder bar in the cue colour,
   * low enough that the neck shows, with an arrow down beside each shoulder.
   * The card's inset is the half crimp the steps ask for. */
  'hang-edge': (() => {
    const b = hanger()
    const { shL, shR, sh } = b.joints
    return {
      alt: 'Hanging from the edge with both hands, half crimp, shoulders pulled down away from the ears',
      props: BOARD,
      a: [
        ...parts(b, 'legL', 'legR', 'torso', 'armL', 'armR', 'head'),
        ...gripHand(46, 1), ...gripHand(74, -1),
        { k: 'cueBody', d: line(shL, shR) },
        ...arrow([[shL[0] - 12, sh[1] - 13], [shL[0] - 12, sh[1]]], 'cue'),
        ...arrow([[shR[0] + 12, sh[1] - 13], [shR[0] + 12, sh[1]]], 'cue'),
      ],
      detail: finger('crimp'),
    }
  })(),

  /* The same hang made easy: arms longer and relaxed, a harness loop at the
   * waist, the cord up over a pulley hung from the ceiling and down to a stack
   * of plates. The cue is the cord's pull: up, off the body. */
  'hang-assisted': (() => {
    const b = hanger({ relax: true, hands: [47, 73] })
    const { hip } = b.joints
    const clip = [hip[0] + 6.5, hip[1] - 1]
    const pulley = [104, 4]
    const inn = go(pulley, 180 + 50, 4.5)
    return {
      alt: 'Hanging from the edge, arms relaxed, a pulley and counterweight taking weight off',
      props: [...BOARD, { k: 'prop', d: `M${pulley[0]} -12 V${pulley[1] - 4.5}`, w: 2.5 }],
      a: [
        ...parts(b, 'legL', 'legR', 'torso', 'armL', 'armR', 'head'),
        ...gripHand(47, 1), ...gripHand(73, -1),
        { k: 'thin', d: ellipse(hip[0], hip[1], 7, 2.8), w: 3 },
        { k: 'thin', c: [pulley[0], pulley[1], 4.5] },
        { k: 'thin', d: `${line(clip, inn)} ${line([pulley[0] + 4.5, pulley[1]], [pulley[0] + 4.5, 34])}`, w: 3.5 },
        { k: 'fill', d: rrect(pulley[0] - 1.5, 34, 12, 8, 2) },
        { k: 'fill', d: rrect(pulley[0] - 1.5, 44, 12, 8, 2) },
        ...arrow([go(clip, angle(clip, inn), 8), go(clip, angle(clip, inn), 24)], 'cue'),
      ],
    }
  })(),

  /* Side view, facing right: hands on a rail, the far arm and far leg a clear
   * four units behind the near ones, the head above the shoulders. The knee
   * comes FORWARD and the ball of the foot touches a sling hanging from the
   * same rail in front. The dashed plumb line behind the back is the cue: the
   * watch is any swing. */
  'hang-knee-lift': (() => {
    const hip = [52, 63]
    const base = {
      view: 'side', hip, lean: -90, neck: -78,
      armL: { to: [51.5, 14], bend: -1 },
      armR: { to: [45.5, 15], bend: -1 },
      far: ['armR', 'legR'],
    }
    const down = body({ ...base, legL: { dir: [90, 90], end: 50 }, legR: { dir: [100, 98], end: 55 } })
    const up = body({ ...base, legL: { to: [73.5, 70], bend: -1, end: 8 }, legR: { dir: [100, 98], end: 55 } })
    return {
      alt: 'Hanging still in profile and lifting one knee to touch the ball of the foot to a sling in front',
      props: [
        { k: 'propFill', d: rrect(36, 4, 54, 8, 3) },
        { k: 'prop', d: line([82, 12], [82, 66.5]), w: 3 },
        { k: 'prop', d: ellipse(82, 70.5, 4.5, 3.5), w: 3.5 },
      ],
      s: [
        { k: 'cue', d: line([35, 22], [35, 98]), dash: '6 5' },
        ...parts(down, 'armR', 'legR', 'torso', 'armL', 'head'),
        { k: 'fill', d: rrect(47, 9, 9, 6, 3) },
        { k: 'farFill', d: rrect(41, 9.5, 9, 6, 3) },
      ],
      a: parts(down, 'legL'),
      b: parts(up, 'legL'),
    }
  })(),

  /* From behind, because the drill moves ACROSS: a board of rungs above, a
   * stair below. The climber hangs from two rungs with long arms (the weight is
   * on the hands), both feet on the working stair, knees soft. One hand moves
   * to the next rung along; the thin arrow is that move. The stair is the cue,
   * because the watch is the stair height. */
  'board-crawl': (() => {
    const rungY = 22
    const rungs = [12, 28, 44, 60, 76, 92, 108]
    const base = {
      view: 'front', hip: [60, 70],
      armL: { to: [44, rungY + 2.5], bend: -1 },
      legL: { to: [53, 97.5], bend: 1, end: 160, tip: 4.5 },
      legR: { to: [67, 97.5], bend: -1, end: 20, tip: 4.5 },
    }
    const a = body({ ...base, armR: { to: [60, rungY + 2.5], bend: 1 } })
    const b = body({ ...base, armR: { to: [76, rungY + 2.5], bend: 1 } })
    const hand = (x) => ({ k: 'fill', d: rrect(x - 4.5, rungY - 3, 9, 7, 3) })
    return {
      alt: 'From behind: hanging from the rungs of a board with feet on a stair, moving one hand across to the next rung',
      props: [
        { k: 'propFill', d: rrect(-20, -10, 160, 26, 3) },
        ...rungs.map(x => ({ k: 'hold', d: rrect(x - 6, rungY - 1, 12, 5, 2.5) })),
        floorLine(-20, 140, 114),
      ],
      s: [
        { k: 'cue', d: 'M30 114 V107 H38 V100 H82 V107 H90 V114', w: 4 },
        ...parts(a, 'legL', 'legR', 'torso', 'armL', 'head'),
        hand(44),
        ...arrow([[62, 13], [74, 13]], 'thin', 4),
      ],
      a: [a.armR, hand(60)],
      b: [b.armR, hand(76)],
    }
  })(),

  /* The arms are the cue and the same two lines in both poses: locked
   * straight, hands fixed. In A the shoulders are shrugged up to the ears (the
   * shoulder line kinks up to the arms and the head sinks between them, no
   * neck); in B the shoulders are pulled down, the whole body rises nine units,
   * the shoulder line goes flat and the neck shows. */
  'scap-pull': (() => {
    const wrist = [[44, LIP + 3], [76, LIP + 3]]
    const J = [go(wrist[0], 70, 25), go(wrist[1], 110, 25)]
    const arms = [
      { k: 'cueBody', d: line(wrist[0], J[0]) },
      { k: 'cueBody', d: line(wrist[1], J[1]) },
    ]
    const pose = (top, shrug) => {
      const hip = [60, top[1] + BONES.torso]
      const b = body({
        view: 'front', hip,
        legL: { dir: [94, 92], end: 125, tip: 4.5 },
        legR: { dir: [86, 88], end: 55, tip: 4.5 },
      })
      const headY = shrug ? J[0][1] + 1 : top[1] - BONES.neck - BONES.head
      return [
        { k: 'body', d: `${line(J[0], top, J[1])} ${line(top, hip)} ${line(b.joints.hipL, b.joints.hipR)}` },
        b.legL, b.legR,
        { k: 'fill', c: [60, r1(headY), BONES.head] },
      ]
    }
    return {
      alt: 'Hanging with locked straight arms, shrugged, then pulling the shoulders down so the body rises',
      props: BOARD,
      s: [...arms, ...gripHand(44, 1), ...gripHand(76, -1)],
      a: pose([60, J[0][1] + 6], true),
      b: [...pose([60, J[0][1] - 3.5], false), ...arrow([[86, 62], [86, 48]], 'thin', 4)],
    }
  })(),

  /* --- the load cell ---------------------------------------------------- */

  /* Standing tall on a webbing loop, facing you, feet apart on it. The pulling
   * arm hangs dead straight at the side (the cue: the watch is the elbow
   * bending, or a lean that bends it), the edge block in the hand, the cord taut
   * and vertical through the gauge to the loop. This is the LEFT hand (on your
   * right as the figure faces you); the right-hand rows draw it mirrored
   * (`sided`, `mirrored()` below), so the two sides are two pictures. */
  'no-hang-pull': (() => {
    const b = body({
      view: 'front', hip: [58, 58], cue: ['armR'],
      armL: { dir: [100, 97] },
      armR: { dir: [80, 82] },
      legL: { dir: [95, 93], end: 140, tip: 5 },
      legR: { dir: [85, 87], end: 40, tip: 5 },
    })
    const hand = b.limbs.armR.end
    const x = r1(hand[0])
    const y0 = r1(hand[1])
    const loopY = ON_FLOOR - 1
    return {
      alt: 'Standing tall on a webbing loop, the pulling arm straight down at the side holding an edge block tethered to the loop',
      sided: true,
      props: [floorLine(10, 110)],
      a: [
        { k: 'thin', d: rrect(44, loopY - 2.5, x - 41, 5, 2.5), w: 3.5 },
        { k: 'thin', d: `M${x} ${r1(y0 + 7)} V${loopY - 2.5}`, w: 3.5 },
        { k: 'fill', d: rrect(x - 3.5, 70, 7, 8, 1.5) },
        { k: 'fill', d: rrect(x - 5.5, y0 + 1, 11, 6, 1.5) },
        ...parts(b, 'legL', 'legR', 'torso', 'armL', 'head', 'armR'),
        { k: 'fill', c: [x, y0, 3] },
      ],
    }
  })(),

  /* --- the floor -------------------------------------------------------- */

  /* Side view, head to the left, framed tight so the plank fills the box. The
   * support forearm and the body line never move (they are in `s`); the
   * reaching arm slides out flat along the floor, well past the head, with a
   * thin arrow. The cue is the hip: the watch is the hip on the reaching side
   * rising, so the arrow holds it down. */
  'plank-reach': (() => {
    const sh = [34, ON_FLOOR - BONES.upperArm]
    const L = BONES.torso + BONES.thigh + BONES.shin
    const along = (Math.asin((ON_FLOOR - 6 - sh[1]) / L) * 180) / Math.PI
    const ankle = go(sh, along, L)
    const hip = go(sh, along, BONES.torso)
    const lean = along + 180
    const b = body({
      view: 'side', hip, lean, neck: lean + 22,
      armL: { dir: [90, 180], end: 180 },
      legL: { to: ankle, bend: 1, end: 100 },
    })
    const tucked = body({ view: 'side', hip, lean, neck: lean + 22, armR: { dir: [80, 180], end: 180 } })
    const out = body({ view: 'side', hip, lean, neck: lean + 22, armR: { dir: [148.7, 148.7], end: 180 } })
    return {
      alt: 'Forearm plank in profile, sliding one arm forward along the floor while the hips stay down',
      props: [FLOOR],
      s: [
        ...parts(b, 'legL', 'torso', 'armL', 'head'),
        ...arrow([[hip[0], hip[1] - 17], [hip[0], hip[1] - 5]], 'cue'),
      ],
      a: [tucked.armR],
      b: [out.armR],
    }
  })(),

  /* Side plank from the front, chest to the camera: the support forearm points
   * at you (a pad under the elbow), feet stacked, the top arm raised a little
   * off vertical so it never fuses with the support arm. The watch is the top
   * shoulder rolling forward, so the cue is the two shoulders, stacked one
   * above the other. The dashed body-colour guide is the line the hip dips off
   * and presses back to. */
  'side-bridge': (() => {
    const elbow = [26, ON_FLOOR - 1]
    const bottom = [26, elbow[1] - BONES.upperArm]
    const L = BONES.torso + BONES.thigh + BONES.shin
    const along = (Math.asin((ON_FLOOR - 4 - (bottom[1] - BONES.shoulders)) / L) * 180) / Math.PI
    const up = along - 90
    const sh = go(bottom, up, BONES.shoulders)
    const top = go(sh, up, BONES.shoulders)
    const ankle = go(sh, along, L)
    const straightHip = go(sh, along, BONES.torso)
    const headC = go(sh, along + 180, BONES.neck + BONES.head)
    const topArm = limb(top, { dir: [-72, -72] }, BONES.upperArm, BONES.forearm)
    const support = limb(bottom, { dir: [90, 0] }, BONES.upperArm, BONES.forearm)
    BODIES.push({ view: 'front', lean: along + 180, neck: along + 180, limbs: { armL: support, armR: topArm }, far: [] })
    const feet = (a) => ({ k: 'body', d: line(go(a, up, 4.5), go(a, up + 180, 2.5)) })
    const pose = (dip) => {
      const hip = dip ? go(sh, along + dip, BONES.torso) : straightHip
      const to = dip ? go(hip, angle(hip, ankle), BONES.thigh + BONES.shin - 0.4) : ankle
      const leg = limb(hip, { to, bend: -1 }, BONES.thigh, BONES.shin)
      return [{ k: 'body', d: line(sh, hip) }, { k: 'body', d: leg.d }, feet(leg.end)]
    }
    return {
      alt: 'Side plank on one forearm, chest to the front, shoulders stacked, dipping the hip and pressing it back up to the line',
      props: [FLOOR],
      s: [
        { k: 'thin', d: line(go(sh, along, 4), go(ankle, along, 2)), dash: '5 4', w: 2.5 },
        { k: 'fill', d: rrect(elbow[0] - 6, elbow[1] - 1, 12, 4, 2) },
        { k: 'body', d: line(elbow, bottom) },
        { k: 'body', d: topArm.d },
        { k: 'fill', c: [r1(headC[0]), r1(headC[1]), BONES.head] },
      ],
      a: pose(0),
      b: pose(16),
      over: [
        { k: 'cueBody', d: line(bottom, top), w: 6 },
        { k: 'cueFill', c: [r1(bottom[0]), r1(bottom[1]), 3.6] },
        { k: 'cueFill', c: [r1(top[0]), r1(top[1]), 3.6] },
      ],
    }
  })(),

  /* Side view, head to the left, toes on the floor, hand under the shoulder.
   * At the bottom the elbow points BACK toward the feet (tucked to the ribs).
   * The cue is the dashed line just above the back, the line the body stays
   * on: the watch is the hips sagging below it or piking above it. */
  pressup: (() => {
    const ankle = [86, 82]
    const wrist = [36, ON_FLOOR]
    const L = BONES.torso + BONES.thigh + BONES.shin
    const pose = (shY) => {
      const dx = Math.sqrt(L ** 2 - (ankle[1] - shY) ** 2)
      const sh = [ankle[0] - dx, shY]
      const lean = angle(ankle, sh)
      const hip = go(sh, lean + 180, BONES.torso)
      const b = body({
        view: 'side', hip, lean, neck: lean - 6,
        armL: { to: wrist, bend: -1, end: 180 },
        legL: { to: ankle, bend: 1, end: 100 },
      })
      return [
        ...parts(b, 'legL', 'torso', 'armL', 'head'),
        { k: 'cue', d: line(go(sh, lean + 90, 5.5), go(ankle, lean + 90, 5.5)), dash: '6 4.5' },
      ]
    }
    return {
      alt: 'Press-up in profile: body in one straight line, lowering with the elbow tucked back toward the ribs',
      props: [FLOOR],
      a: pose(wrist[1] - BONES.upperArm - BONES.forearm),
      b: pose(73),
    }
  })(),

  /* --- hips ------------------------------------------------------------- */

  /* Front view: the feet never move. In B the hip drops to knee height over
   * the bent leg (its foot flat and turned out) and the other leg stays locked
   * straight, heel down, toes up: that straight leg is the cue, because the
   * watch is it quietly bending. The plate is a filled disc held in front of
   * the sternum, the forearms on its rims. */
  cossack: (() => {
    const footL = [36, 84]
    const footR = [82, 84]
    const pose = (hip) => {
      const b = body({
        view: 'front', hip, cue: ['legR'],
        legL: { to: footL, bend: 1, end: 165, tip: 6.5 },
        legR: { to: footR, bend: -1, end: -60, tip: 8 },
      })
      const sh = b.joints.sh
      // A goblet hold seen from the front is foreshortened: the upper arms drop
      // to elbows tucked under the plate and the forearms come up to its rims,
      // so these two arms are drawn as seen, not at full length.
      const pl = [sh[0], sh[1] + 9]
      const arm = (from, side) => line(from, [sh[0] + side * 8, sh[1] + 15], [pl[0] + side * 5, pl[1] + 2])
      return [
        ...parts(b, 'legL', 'legR', 'torso', 'head'),
        { k: 'body', d: arm(b.joints.shL, -1) },
        { k: 'body', d: arm(b.joints.shR, 1) },
        { k: 'fill', c: [r1(pl[0]), r1(pl[1]), 6] },
      ]
    }
    return {
      alt: 'Cossack squat: sitting down over one bent leg, heel flat, the other leg locked straight with the toes up',
      props: [FLOOR],
      a: pose([59, 63]),
      b: [...pose([53, 70.5]), ...arrow([[66, 78], [54, 78]], 'thin', 4)],
    }
  })(),

  /* Seen from the front, sitting tall on the floor (from above, two rounds of
   * drawing read as a table or a T: the front thigh lines up with the trunk).
   * The hands are on the floor behind, so from the front they are hidden.
   * Front leg: the thigh comes toward you (short, foreshortened) and the shin
   * runs across in front, on the floor. Back leg: the thigh out to the side, the
   * knee bent, the shin going back (foreshortened). The legs are drawn as seen,
   * not at full length. The trunk is the cue, straight and tall: the watch is
   * rounding the back and collapsing. In B both knees have swept to the mirror
   * image. The card's inset is the same sit from
   * the side, where the tall back shows. */
  'ninety-ninety': (() => {
    const hip = [60, 81]
    const b = body({
      view: 'front', hip, cue: ['torso'],
    })
    const legs = (s) => {
      const x = (v) => hip[0] + s * (v - hip[0])
      const knee = (p) => ({ k: 'fill', c: [r1(x(p[0])), p[1], 3.6] })
      const fKnee = [43, 86.5]; const fFoot = [70, 88]
      const bKnee = [82, 85]; const bFoot = [91, 75]
      return [
        { k: 'body', d: line([x(56), 82], [x(fKnee[0]), fKnee[1]], [x(fFoot[0]), fFoot[1]]), w: 5.5 },
        { k: 'body', d: line([x(64), 82], [x(bKnee[0]), bKnee[1]], [x(bFoot[0]), bFoot[1]]), w: 5.5 },
        knee(fKnee), knee(bKnee),
        { k: 'fill', c: [r1(x(fFoot[0])), fFoot[1], 3] }, { k: 'fill', c: [r1(x(bFoot[0])), bFoot[1], 3] },
      ]
    }
    return {
      alt: 'Seated 90/90 from the front, sitting tall: front shin across in front, back leg out to the side, sweeping both knees to the mirror position',
      props: [floorLine(10, 110)],
      s: parts(b, 'torso', 'head'),
      a: legs(1),
      b: legs(-1),
      detail: [
        { k: 'prop', d: 'M1 27 H29', w: 2 },
        { k: 'body', d: line([8, 24], [25, 24]), w: 4.5 },
        { k: 'cueBody', d: line([8, 24], [8.5, 10.5]), w: 4.5 },
        { k: 'fill', c: [9.5, 5.5, 4] },
        { k: 'body', d: line([8.5, 13], [14, 19.5], [18, 24]), w: 3 },
      ],
    }
  })(),

  /* From above, facing the wall at the top, drawn larger like the 90/90. The
   * legs are the cue: locked straight in a V (a dot at each knee), the soles
   * flat on the wall. Only the trunk and hands move, leaning and walking
   * forward toward the wall. */
  'straddle-sit': (() => {
    const k = 1.5
    const hipC = [60, 60]
    const spread = 52
    const hipL = go(hipC, 180, BONES.hips * k)
    const hipR = go(hipC, 0, BONES.hips * k)
    const L = (BONES.thigh + BONES.shin) * k
    const ankL = go(hipL, -90 - spread, L)
    const ankR = go(hipR, -90 + spread, L)
    const wall = r1(ankL[1] - 5)
    const sole = (a) => ({ k: 'body', d: line([a[0] - 5, wall + 2.5], [a[0] + 5, wall + 2.5]) })
    const knee = (h, a) => { const q = mid(h, a, BONES.thigh / (BONES.thigh + BONES.shin)); return { k: 'fill', c: [r1(q[0]), r1(q[1]), 4] } }
    const trunk = (fwd, reach) => {
      const p = topPerson({ at: [60, hipC[1] - fwd], dir: -90, fwd, k, hipBar: false })
      const hand = (side) => go(side < 0 ? p.shL : p.shR, -90 + side * 12, reach)
      return [
        { k: 'body', d: `${line(p.shL, hand(-1))} ${line(p.shR, hand(1))}` },
        { k: 'fill', c: [...hand(-1).map(r1), 3.4] }, { k: 'fill', c: [...hand(1).map(r1), 3.4] },
        ...p.shapes,
      ]
    }
    return {
      alt: 'Seated straddle seen from above, knees locked, soles on the wall, leaning and walking the hands forward',
      props: [
        { k: 'propFill', d: `M-20 -20 H140 V${wall} H-20 Z` },
        { k: 'prop', d: `M-20 ${wall} H140` },
      ],
      s: [
        { k: 'body', d: line(hipL, hipR), w: 8 },
        { k: 'cueBody', d: line(hipL, ankL), w: 6 },
        { k: 'cueBody', d: line(hipR, ankR), w: 6 },
        knee(hipL, ankL), knee(hipR, ankR),
        sole(ankL), sole(ankR),
      ],
      a: trunk(9, 12),
      b: trunk(22, 13),
    }
  })(),

  /* --- forearms --------------------------------------------------------- */

  /* Seen from the front (from above, the hanging upper arm is hidden under
   * the shoulder and the person read as a cloud): standing, the working upper
   * arm hanging straight at the side with the elbow pinned to the ribs (the
   * ring is the cue: the watch is the elbow drifting off), the forearm swinging
   * from across the belly (A) to out to the side (B, foreshortened because it
   * also points at you). The band is dashed, from the hand to a post on the far
   * side, so it pulls the hand back across the body, and it is longer in B. */
  'ext-rotation': (() => {
    const b = body({
      view: 'front', hip: [60, 64],
      armL: { dir: [98, 95] },
      armR: { dir: [90, 90] },
      legL: { dir: [95, 93], end: 140, tip: 5 },
      legR: { dir: [85, 87], end: 40, tip: 5 },
    })
    const elbow = b.limbs.armR.mid
    const post = [24, elbow[1] + 1]
    const fore = (len) => {
      const h = [elbow[0] + len, elbow[1] + 1]
      return [
        { k: 'thin', d: line([post[0] + 4, post[1]], h), dash: '5 3.5', w: 3 },
        { k: 'body', d: line(elbow, h) },
        { k: 'fill', c: [r1(h[0]), r1(h[1]), 3.6] },
      ]
    }
    return {
      alt: 'Band external rotation from the front: elbow pinned to the ribs, the forearm turning from across the belly out to the side against a band',
      props: [{ k: 'propFill', d: rrect(post[0] - 6, post[1] - 30, 9, 60, 2) }, floorLine(10, 110)],
      s: [
        ...parts(b, 'legL', 'legR', 'torso', 'armL', 'head'),
        { k: 'body', d: line(b.joints.shR, elbow) },
        ...arrow([[elbow[0] - 8, elbow[1] + 9], [elbow[0] + 8, elbow[1] + 9]], 'thin', 4),
      ],
      a: fore(-14),
      b: fore(9),
      over: [{ k: 'cue', c: [r1(elbow[0]), r1(elbow[1]), 6] }, { k: 'fill', c: [r1(elbow[0]), r1(elbow[1]), 3] }],
    }
  })(),

  /* A close-up from the side, seated: the trunk behind, the thigh with its knee
   * and shin, the forearm (the cue: the watch is it lifting) lying ON the thigh
   * with the wrist just past the knee, so the hand hangs clear. Only the hand
   * moves, from hanging down to cocked up, palm down (the knuckles on top of the
   * fist), a dumbbell end-on in it. */
  'wrist-ext': (() => {
    const wrist = [78, 53]
    const hand = (deg) => {
      const fist = go(wrist, deg, 14)
      const top = deg - 90
      return [
        { k: 'body', d: line(wrist, go(wrist, deg, 10)), w: 8 },
        { k: 'body', c: [r1(fist[0]), r1(fist[1]), 7.5] },
        { k: 'fill', c: [r1(fist[0]), r1(fist[1]), 4.5] },
        ...[-0.8, 0, 0.8].map(t => ({ k: 'fill', c: [...go(go(wrist, deg, 7 + t * 3), top, 4).map(r1), 1.6] })),
      ]
    }
    return {
      alt: 'Wrist extension close up: seated, forearm resting on the thigh, palm down, only the hand lifting the weight',
      props: [
        { k: 'propFill', d: rrect(-16, -30, 22, 92, 10) },
        { k: 'propFill', d: 'M-4 57 H66 Q74 57 74 66 V67 Q74 75 66 75 H-4 Z' },
        { k: 'propFill', d: 'M56 70 L72 70 L66 104 L52 104 Z' },
      ],
      s: [
        { k: 'body', d: line([-2, 10], [12, 51]), w: 6 },
        { k: 'cueBody', d: line([12, 52], wrist), w: 6.5 },
        ...arcArrow(wrist, 29, 50, -42, 'thin', undefined, 6),
      ],
      a: hand(66),
      b: hand(-48),
    }
  })(),

  /*
   * Eccentric rotation, seen end-on down the forearm resting on the thigh (the
   * pale bar under the fist). Palm UP shows four curled fingertips along the top
   * of the fist; palm DOWN shows the smooth back of the hand with its knuckle
   * ridge. The plate is held by its rim on the thumb side, so it swings over the
   * top as the hand turns. In A the free hand (faint) has just turned it over:
   * the watch is never lifting with the working arm, so it is drawn doing the
   * lift. B is where the slow lowering ends. The dashed arrow (the cue) is that
   * lowering, plate to plate. The two siblings start with the plate on
   * opposite sides and turn opposite ways.
   */
  ...(() => {
    const c = [60, 60]
    const fist = (palmUp) => [
      { k: 'fill', d: rrect(c[0] - 11, c[1] - 9, 22, 19, 6) },
      ...[-7.5, -2.5, 2.5, 7.5].map(dx => ({ k: 'fill', c: [c[0] + dx, palmUp ? c[1] - 9.5 : c[1] + 10.5, 3] })),
    ]
    const plate = (side) => {
      const p = [c[0] + side * 25, c[1] - 6]
      return [
        { k: 'body', d: line([c[0] + side * 10, c[1] - 4], [p[0] - side * 9, p[1]]), w: 5 },
        { k: 'body', c: [r1(p[0]), r1(p[1]), 10], w: 5 },
        { k: 'fill', c: [r1(p[0]), r1(p[1]), 3] },
      ]
    }
    const free = (side) => {
      const g = [c[0] + side * 25, c[1] - 19]
      return [
        { k: 'farFill', d: rrect(g[0] - 6, g[1] - 5, 12, 9, 3.5) },
        { k: 'far', d: line([g[0] + side * 14, g[1] - 26], [g[0] + side * 3, g[1] - 4]), w: 5 },
      ]
    }
    const thigh = { k: 'propFill', d: rrect(20, 72, 80, 12, 6) }
    const fig = (alt, startSide) => ({
      alt,
      props: [thigh],
      s: arcArrow([c[0], c[1] - 6], 36, startSide < 0 ? -158 : -22, startSide < 0 ? -22 : -158, 'cue', '6 4.5'),
      a: [...plate(startSide), ...fist(startSide < 0), ...free(startSide)],
      b: [...plate(-startSide), ...fist(startSide > 0)],
    })
    return {
      'forearm-supination': fig('Eccentric supination seen end-on: the free hand turns the plate palm-up, then the working hand lowers it slowly back to palm-down', -1),
      'forearm-pronation': fig('Eccentric pronation seen end-on: the free hand turns the plate palm-down, then the working hand lowers it slowly back to palm-up', 1),
    }
  })(),

  /* --- grips ------------------------------------------------------------ */

  /* A close-up of one hand on the board's edge, from behind: the board above,
   * the back of the hand below, each finger reaching up over the lip. Which
   * fingers are ON is the whole distinction between the three blocks, so the
   * fingertips on the edge are the cue. A finger ON in a half crimp shows its
   * raised middle knuckle; a finger OFF is curled down into the palm, well clear
   * of the edge. The card's inset is the finger position from the side. */
  ...(() => {
    const lip = 30
    const xs = [36, 48, 60, 72]
    const edge = [
      { k: 'propFill', d: rrect(-20, -20, 160, lip + 20, 4) },
      { k: 'prop', d: `M-20 ${lip + 1} H140`, w: 3 },
    ]
    const palm = [
      { k: 'fill', d: 'M29 58 L79 58 L74 88 Q54 94 34 88 Z' },
      { k: 'fill', d: rrect(38, 86, 32, 18, 4) },
      { k: 'fill', d: 'M30 64 L20 54 Q16 50 20 47 L25 46 L36 60 Z' },
    ]
    const on = (x, crimp) => [
      { k: 'fill', d: rrect(x - 5, lip + 12, 10, 18, 4.5) },
      { k: 'fill', d: rrect(x - 5, lip - 4, 10, 14.5, 4.5) },
      ...(crimp ? [{ k: 'fill', c: [x, lip + 11, 6] }] : []),
      { k: 'cueFill', d: rrect(x - 5, lip - 4, 10, 7, 3) },
    ]
    const off = (x) => [
      { k: 'fill', d: rrect(x - 5, 50, 10, 10, 4.5) },
      { k: 'fill', c: [x, 49, 4.2] },
    ]
    const hand = (live, crimp) => [...palm, ...xs.flatMap((x, i) => (live.includes(i) ? on(x, crimp) : off(x)))]
    return {
      'grip-four': {
        alt: 'All four fingers on the edge in a half crimp, thumb off',
        props: edge, a: hand([0, 1, 2, 3], true), detail: finger('crimp'),
      },
      'grip-front-three': {
        alt: 'Index, middle and ring on the edge, open hand; the pinky curled off',
        props: edge, a: hand([0, 1, 2], false), detail: finger('open'),
      },
      'grip-two': {
        alt: 'Two fingers on the edge: the front two, then the middle two, each open and in a half crimp',
        props: edge, a: hand([0, 1], false), b: hand([1, 2], false),
        detail: [...finger('open'), ...finger('crimp', 32)],
        detailBox: [62, 32],
      },
    }
  })(),

  /* --- climbing --------------------------------------------------------- */

  /* Every climber is the same body in profile, facing the wall on the right,
   * the head along the spine and tipped to look at the wall, hands on holds,
   * a foot on a hold, far limbs faint and clearly behind. The walls differ so
   * the five read apart as thumbnails: a steep board leaning OVER the climber
   * with a regular row of holds; a vertical route with a rope and a draw; the
   * same route with the lower-and-go-again arrow; an overhang over a thick pad;
   * real rock with a tree. */

  /* An overhanging board on a kicker: the face leans over the climber, holds
   * in a regular row. Arms straight (the cue: the watch is resting, and you
   * hang off straight arms between moves), hips in close to the board, one
   * foot on a board hold, the far leg flagged out behind. */
  'climb-board': (() => {
    const base = [110, 74]
    const top = [62, 0]
    const at = (t, off = 0) => {
      const p = mid(base, top, t)
      return go(p, angle(base, top) - 90, off)
    }
    const hand = at(0.72, 4.5)
    const sh = go(hand, 120, 24.6)
    const hip = go(sh, 40, BONES.torso)
    const lean = angle(hip, sh)
    const b = climber({
      hip, lean, neck: lean + 30, cue: ['armL'],
      armL: { to: hand, bend: 1 },
      armR: { to: at(0.58, 4.5), bend: 1 },
      legL: { to: at(0.16, 7), bend: -1, end: -30, tip: 5 },
      legR: { dir: [150, 160], end: 100, tip: 5 },
    })
    return {
      alt: 'Climbing an overhanging board: the board leans over the climber, arms straight, hips in, one foot on, the other leg flagged',
      props: [
        { k: 'propFill', d: `M${base[0]} ${FLOOR_Y} V${base[1]} L${top[0]} ${top[1]} L${top[0]} -30 H160 V${FLOOR_Y} Z` },
        FLOOR,
        ...[0.04, 0.16, 0.28, 0.4, 0.5, 0.58, 0.72, 0.84, 0.96].map(t => hold(...at(t, 1.5), 3.2)),
      ],
      a: parts(b, 'armR', 'legR', 'legL', 'torso', 'armL', 'head'),
    }
  })(),

  ...(() => {
    const wallX = 76
    const wall = [
      { k: 'propFill', d: `M${wallX} -20 H160 V140 H${wallX} Z` },
      hold(wallX - 1, 13), hold(wallX - 1, 38), hold(wallX - 1, 60), hold(wallX - 1, 84), hold(wallX - 1, 104),
    ]
    const r = climber({
      hip: [58, 58], lean: -84, neck: -70,
      armL: { to: [wallX - 5, 15], bend: 1, end: -30, tip: 3 },
      armR: { dir: [110, 104] },
      legL: { to: [wallX - 8, 83], bend: -1, end: 0, tip: 5 },
      legR: { to: [wallX - 8, 62], bend: -1, end: 0, tip: 5 },
    })
    const draw = [wallX - 2, 42]
    const rope = () => [
      ...quickdraw(draw[0], draw[1]),
      { k: 'thin', d: `M${P(r.joints.hip)} Q${P([draw[0] - 8, r.joints.hip[1] - 2])} ${P([draw[0] - 1, draw[1] + 10])} L${P([draw[0] - 4, 120])}`, w: 2.5 },
    ]
    const hand = r.limbs.armR.end
    const zig = (x) => {
      const y = hand[1] - 9
      return { k: 'cue', d: line([x, y], [x - 3, y + 4.5], [x + 3, y + 9], [x - 3, y + 13.5], [x, y + 18]), w: 3.5 }
    }
    const people = parts(r, 'legR', 'legL', 'torso', 'armL', 'armR', 'head')
    return {
      /* The cue is the shake: one hand on, the other arm dropped to the hip and
       * shaken loose (a zigzag either side of the hand), which is what every lap
       * of the economy and ARC cards asks for at a stance. */
      'climb-route': {
        alt: 'Leading a vertical route: rope clipped to a quickdraw, one hand on, the other arm dropped and shaking out',
        props: [...wall, ...rope()],
        a: [...people, zig(r1(hand[0] - 8)), zig(r1(hand[0] + 8))],
      },
      /* The same route, with the cue a down-then-up arrow beside it: lower, and
       * go straight back up. The watch is the shake-out on lap two, which the
       * route figure draws; this one's point is the lap. */
      'climb-double': {
        alt: 'Climbing a route, lowering, and going straight back up again',
        props: [...wall, ...rope()],
        a: [
          ...people,
          { k: 'cue', d: 'M18 20 V80 Q18 92 28 92 Q38 92 38 80 V20', w: 5 },
          ...arrow([[18, 66], [18, 80]], 'cue', 7, 5).slice(1),
          ...arrow([[38, 34], [38, 20]], 'cue', 7, 5).slice(1),
        ],
      },
    }
  })(),

  /* Real rock: an irregular face the hands and feet are on, a bolt with a draw
   * clipped (the cue: a crag day is burns on a bolted route; the card has no
   * watch line to point at), the rope thin, and a round tree to say outdoors. */
  crag: (() => {
    const face = [[80, -20], [76, 0], [72, 13], [79, 26], [71, 40], [79, 54], [73, 70], [80, 84], [75, 100], [80, 120]]
    const b = climber({
      hip: [56, 58], lean: -84, neck: -70,
      armL: { to: [69, 14], bend: 1, end: -40, tip: 3 },
      armR: { to: [68, 39], bend: 1, end: -40, tip: 3 },
      legL: { to: [69, 82], bend: -1, end: 0, tip: 5 },
      legR: { to: [69, 66], bend: -1, end: 0, tip: 5 },
    })
    const hip = b.joints.hip
    return {
      alt: 'Climbing a route on real rock: hands and feet on the rock, rope clipped to a bolt, a tree behind',
      props: [
        { k: 'propFill', d: `M${face.map(P).join(' L')} H160 V-20 Z` },
        { k: 'prop', d: 'M-20 104 H56', w: 3 },
        { k: 'propFill', c: [27, 74, 11] },
        { k: 'propFill', c: [37, 81, 8.5] },
        { k: 'propFill', d: rrect(29, 82, 5, 22, 2) },
        { k: 'thin', d: `M${P(hip)} Q${P([66, 52])} ${P([75, 57])} L${P([72, 120])}`, w: 2.5 },
      ],
      a: [
        ...quickdraw(76, 46, 'cue'),
        ...parts(b, 'armR', 'legR', 'legL', 'torso', 'armL', 'head'),
      ],
    }
  })(),

  /* An overhanging wall over a thick crash pad, no rope, the climber low, feet
   * just above the pad, arms long. The cue outlines the pad, dashed: what you
   * fall onto, and the falls are what the card's watch counts. */
  boulder: (() => {
    const base = [100, 84]
    const top = [74, 0]
    const at = (t, off = 0) => {
      const p = mid(base, top, t)
      return go(p, angle(base, top) - 90, off)
    }
    const hand = at(0.75, 4.5)
    const sh = go(hand, 120, 24.4)
    const hip = go(sh, 45, BONES.torso)
    const lean = angle(hip, sh)
    const b = climber({
      hip, lean, neck: lean + 30,
      armL: { to: hand, bend: 1 },
      armR: { to: at(0.52, 4.5), bend: 1 },
      legL: { to: at(0.08, 7), bend: -1, end: -15, tip: 5 },
      legR: { dir: [155, 120], end: 80, tip: 5 },
    })
    return {
      alt: 'Bouldering low on an overhanging wall above a thick crash pad, no rope',
      props: [
        { k: 'propFill', d: `M${base[0]} 140 V${base[1]} L${top[0]} ${top[1]} L${top[0]} -30 H160 V140 Z` },
        hold(...at(0.75, 1.5), 4.4), hold(...at(0.52, 1.5), 4), hold(...at(0.08, 1.5), 3.6),
        hold(...at(0.3, 1.5), 4.4), hold(...at(0.92, 1.5), 3.6),
        { k: 'propFill', d: rrect(26, 86, 74, 12, 3) },
      ],
      a: [
        { k: 'cue', d: rrect(26, 86, 74, 12, 3), dash: '7 4' },
        ...parts(b, 'armR', 'legR', 'legL', 'torso', 'armL', 'head'),
      ],
    }
  })(),

  /* Front view on a wall panel, low: hand holds above the shoulders so the
   * arms are long and open, footholds just above the floor. A to B is one whole
   * step along the wall, one hold to the right: hands, hips and feet all move
   * over, which is what a traverse is. The cue is the direction of travel,
   * along the floor under the feet. */
  'wall-traverse': (() => {
    const step = 22
    const hands = [2, 24, 46, 68, 90, 112].map((x, i) => [x, i % 2 ? 9 : 12])
    const feet = [13, 35, 57, 79, 101].map((x, i) => [x, i % 2 ? 80 : 82])
    const pose = (i) => {
      const hip = [46 + i * step, 54]
      const b = body({
        view: 'front', hip,
        armL: { to: [hands[1 + i][0], hands[1 + i][1] + 3], bend: -1 },
        armR: { to: [hands[3 + i][0], hands[3 + i][1] + 3], bend: 1 },
        legL: { to: [feet[1 + i][0], feet[1 + i][1] - 5], bend: 1, end: 160, tip: 4.5 },
        legR: { to: [feet[2 + i][0], feet[2 + i][1] - 5], bend: -1, end: 20, tip: 4.5 },
      })
      return parts(b, 'legL', 'legR', 'torso', 'armL', 'armR', 'head')
    }
    return {
      alt: 'Traversing sideways low along a climbing wall, big holds, feet just above the floor',
      props: [
        { k: 'propFill', d: rrect(-40, -20, 200, FLOOR_Y + 20, 0) },
        floorLine(-40, 160),
        ...hands.map(([x, y]) => hold(x, y, 4.4)),
        ...feet.map(([x, y]) => hold(x, y, 3.8)),
      ],
      s: arrow([[38, 87], [94, 87]], 'cue', 7),
      a: pose(0),
      b: pose(1),
    }
  })(),
}

/* ----------------------------------------------------------------- framing */

/**
 * Frame every figure: the view fits the person (every pose) and the cue, with
 * the scenery cropped, so the thumbnail is the person and not a sliver of one.
 */
/** The thinnest a cue may be at the 50×42 thumbnail, in pixels. */
export const CUE_PX = 2.1

for (const fig of Object.values(FIGS)) {
  if (!fig.view) fig.view = frameOf([...(fig.s || []), ...(fig.a || []), ...(fig.b || []), ...(fig.over || [])])
  if (fig.detail && !fig.detailBox) fig.detailBox = [32, 32]
  // A wide view draws everything smaller, so a cue's stroke grows with the view
  // until it is CUE_PX at 50×42: the one thing to get right is the last thing
  // the thumbnail may lose.
  const least = CUE_PX * fig.view[2] / 50
  for (const s of ['props', 's', 'a', 'b', 'over'].flatMap(l => fig[l] || [])) {
    const k = KINDS[s.k]
    if (k.cue && !k.fill && (s.w ?? k.stroke) < least) s.w = r1(least + 0.05)
  }
}

export const FIGURES = FIGS

/**
 * Is this figure drawn mirrored for this exercise? A `sided` figure is drawn
 * for the left hand; an exercise whose name says "right" gets the mirror image.
 */
export const mirrored = (name, exerciseName) =>
  Boolean(FIGURES[name]?.sided && /\bright\b/i.test(exerciseName || ''))

/** True if the plan can name this figure. Pinned by the content test. */
export const hasFigure = (name) => Boolean(name && FIGURES[name])
