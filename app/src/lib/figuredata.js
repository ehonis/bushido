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
 * positions, with the limb lengths below, so an arm cannot be 18 units in one
 * pose and 31 in the next (the old scap-pull read as a pull-up for exactly that
 * reason). Hands and feet are reached with two-bone IK (`reach`), so a hand that
 * is meant to be on a hold ends ON the hold and a foot meant to be on the floor
 * ends on the floor; app/figures.test.js checks every limb length and contact.
 *
 * ONE LANGUAGE (both figure councils, 2026-11-08):
 *   - one view per figure: side view for hangs, floor work and climbing (most
 *     mistakes are angles in that plane), front view where the point is left and
 *     right, top view only where nothing else shows the shape (90/90, straddle,
 *     rotation), with the head ON the shoulders;
 *   - scenery is `prop` (half strength, never a 25% ghost) and the body touches it;
 *   - exactly ONE cue per figure, drawn in the cue colour (the accent), on the
 *     thing the `watch` line is about. The cue vocabulary is small and the same
 *     everywhere:
 *       a cue LIMB      this part stays straight / still (scap-pull's arms)
 *       a dashed LINE   the line the body stays on (press-up, side bridge)
 *       a cue ARROW     the direction that matters (the slow lowering, the sweep)
 *       a RING          this joint is pinned (the elbow in external rotation)
 *   - motion arrows that are not the cue are thin, in the body colour, and point
 *     the way the A-to-B crossfade moves;
 *   - `detail` is a corner inset for what a body this size cannot carry (finger
 *     position on an edge). It is drawn on the how-to card and left out of the
 *     50×42 row thumbnail, where it would be noise.
 *
 * Two kinds of figure:
 *   HOLD      one pose, `a` only.
 *   MOVEMENT  `a` is the start, `b` the end, crossfaded. `s` is whatever does not
 *             move, so only the part that travels changes.
 *
 * Coordinates are a 120x100 box.
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
  propFill: { fill: true, opacity: 0.32 },        // boards, thighs, pads
  hold: { fill: true, opacity: 0.62 },            // climbing holds and rungs
  cue: { stroke: 3, cue: true },
  cueFill: { fill: true, cue: true },
  cueBody: { stroke: 4.5, cue: true },            // a limb drawn in the cue colour
}

/* ---------------------------------------------------------------- geometry */

const r1 = (n) => Math.round(n * 10) / 10
const P = ([x, y]) => `${r1(x)} ${r1(y)}`
const rad = (deg) => (deg * Math.PI) / 180

/** The point `len` from `p` in direction `deg` (0 = right, 90 = down). */
export const go = (p, deg, len) => [p[0] + len * Math.cos(rad(deg)), p[1] + len * Math.sin(rad(deg))]
export const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1])
const angle = (a, b) => (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI
const line = (...pts) => `M${pts.map(P).join(' L')}`

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
export function arrow(pts, k = 'cue', head = 4.5) {
  const end = pts[pts.length - 1]
  const prev = pts[pts.length - 2]
  const d = pts.length === 3
    ? `M${P(pts[0])} Q${P(pts[1])} ${P(end)}`
    : line(...pts)
  const back = angle(end, prev)
  const h1 = go(end, back + 35, head)
  const h2 = go(end, back - 35, head)
  return [{ k, d }, { k, d: line(h1, end, h2) }]
}

/** A circular arc of radius r around c from a0 to a1 degrees, with an arrowhead at a1. */
export function arcArrow(c, r, a0, a1, k = 'cue', dash) {
  const p0 = go(c, a0, r)
  const p1 = go(c, a1, r)
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0
  const sweep = a1 > a0 ? 1 : 0
  const tangent = a1 + (sweep ? 90 : -90)
  const back = tangent + 180
  const shaft = { k, d: `M${P(p0)} A${r} ${r} 0 ${large} ${sweep} ${P(p1)}` }
  if (dash) shaft.dash = dash
  return [shaft, { k, d: line(go(p1, back + 35, 5), p1, go(p1, back - 35, 5)) }]
}

/* -------------------------------------------------------------- the body */

/** The one skeleton, in figure units. Every person in every figure is this. */
export const BONES = {
  head: 6, neck: 3, torso: 24, upperArm: 13, forearm: 12, hand: 4,
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
  const mid = [root[0] + l1 * Math.cos(base + bend * a), root[1] + l1 * Math.sin(base + bend * a)]
  const end = [root[0] + d * Math.cos(base), root[1] + d * Math.sin(base)]
  return [mid, end]
}

/**
 * A limb: from `root`, either reaching `to` (with `bend`) or along two absolute
 * angles `dir: [upper, lower]`, then an optional hand or foot stroke at the
 * absolute angle `end` (length `tip`). Returns the path and its joints.
 */
/** Every limb built while the figures below are made, for app/figures.test.js. */
export const LIMBS = []

function limb(root, spec, l1, l2, tipLen) {
  let mid, end
  if (spec.dir) {
    mid = go(root, spec.dir[0], l1)
    end = go(mid, spec.dir[1] ?? spec.dir[0], l2)
  } else {
    [mid, end] = reach(root, spec.to, l1, l2, spec.bend ?? 1)
  }
  const pts = [root, mid, end]
  let tip = null
  if (spec.end != null) {
    tip = go(end, spec.end, spec.tip ?? tipLen)
    pts.push(tip)
  }
  const out = { d: line(...pts), root, mid, end, tip, target: spec.to || null, lengths: [l1, l2] }
  LIMBS.push(out)
  return out
}

/**
 * A person. `view` is 'side' (one shoulder point, one hip point) or 'front'
 * (a shoulder bar and a hip bar). `hip` is the hip centre, `lean` the direction
 * from hip to shoulders (-90 is upright), `neck` the direction from the
 * shoulders to the head (defaults to `lean`).
 *
 * Limbs are `armL`, `armR`, `legL`, `legR` ("L" is the one drawn on the left in
 * a front view, the near one in a side view). `far` lists the parts drawn at
 * half strength (the far side of a profile), `cue` the parts drawn in the cue
 * colour. The result maps each part to a shape, plus `joints` and `limbs` for
 * the test and for figures that hang props off a joint.
 */
export function body({ view = 'side', hip, lean = -90, neck, armL, armR, legL, legR, far = [], cue = [], torso = BONES.torso }) {
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
  return out
}

/** The named parts of a body, as a shape list. */
const parts = (b, ...names) => names.map(n => b[n]).filter(Boolean)

/* ------------------------------------------------------------- scenery */

const FLOOR_Y = 90
/** Where a stroke resting on the floor is centred: half a body stroke above it. */
const ON_FLOOR = FLOOR_Y - 2
const FLOOR = { k: 'prop', d: `M6 ${FLOOR_Y} H114` }

/* The hangboard every hang and grip figure shares, front view: a block with a
 * lip. Hands sit on the lip, fingers over it. */
const BOARD = [
  { k: 'propFill', d: rrect(16, 1, 88, 10, 3) },
  { k: 'prop', d: 'M16 12 H104', w: 3 },
]
const LIP = 12

/** A hand on the lip of the board, front view: fingers over the edge. */
const gripHand = (x) => ({ k: 'fill', d: rrect(x - 4.5, LIP - 3, 9, 7, 3) })

/** A climbing hold: a filled bump on a wall face. */
const hold = (x, y, r = 3.6) => ({ k: 'hold', c: [r1(x), r1(y), r] })

/** A quickdraw clipped to a bolt: two small rings and the sling between. */
const quickdraw = (x, y) => [
  { k: 'thin', c: [x, y, 1.8], w: 2 },
  { k: 'thin', d: line([x, y + 1.8], [x - 1, y + 6]), w: 2 },
  { k: 'thin', c: [x - 1, y + 8, 2], w: 2 },
]

/* Finger insets: a side view of one finger on an edge, drawn in a 30x30 box
 * at (ox, oy). The edge is on the left; the finger comes up from the hand
 * below. Half crimp: the middle joint (PIP) bent to about 90° above the edge,
 * the tip on the edge. Open: the finger draped over the edge, joints soft. */
function fingerInset(ox, oy, how) {
  const p = (x, y) => [ox + x, oy + y]
  const frame = { k: 'prop', d: rrect(ox, oy, 30, 30, 5), w: 1.5 }
  const edge = { k: 'propFill', d: rrect(ox + 1, oy + 15, 11, 14, 2) }
  if (how === 'crimp') {
    return [
      frame, edge,
      { k: 'body', d: line(p(7, 13.4), p(12, 8.4), p(20, 8.4), p(20.5, 20), p(21, 28)), w: 4 },
      { k: 'cue', d: line(p(16, 8.4), p(16, 12.6), p(20.3, 12.6)), w: 1.8 },
    ]
  }
  return [
    frame, edge,
    { k: 'body', d: line(p(5, 13.4), p(12.5, 14.4), p(17.5, 20.5), p(20, 28)), w: 4 },
  ]
}

/* ------------------------------------------------------------ the people */

/* Front-view hang from the board: hands on the lip, shoulders set low enough
 * that the neck shows (that IS "shoulders down" in a drawing), arms a touch
 * bent, legs hanging together. */
function hanger({ hipY = 62.5, hands = [46, 74] } = {}) {
  return body({
    view: 'front', hip: [60, hipY],
    armL: { to: [hands[0], LIP + 3], bend: -1 },
    armR: { to: [hands[1], LIP + 3], bend: 1 },
    legL: { dir: [93, 91], end: 125, tip: 4 },
    legR: { dir: [87, 89], end: 55, tip: 4 },
  })
}

/* A climber in profile facing a wall on the right. */
function climber(spec) {
  return body({ view: 'side', neck: -100, far: ['armR', 'legR'], ...spec })
}

/* -------------------------------------------------------------- the figures */

export const FIGURES = {
  /* --- hanging ---------------------------------------------------------- */

  /* The cue is the shoulders going DOWN: the neck shows between head and
   * shoulder bar, and two arrows say which way. The inset is the half crimp
   * the steps ask for (middle knuckles about 90°), which no full body at this
   * size can show. */
  'hang-edge': (() => {
    const b = hanger()
    const { shL, shR } = b.joints
    return {
      alt: 'Hanging from the edge with both hands, half crimp, shoulders pulled down away from the ears',
      props: BOARD,
      a: [
        ...parts(b, 'legL', 'legR', 'torso', 'armL', 'armR', 'head'),
        gripHand(46), gripHand(74),
        ...arrow([[shL[0] - 17, shL[1] - 12], [shL[0] - 17, shL[1] + 1]], 'cue', 3.5),
        ...arrow([[shR[0] + 17, shR[1] - 12], [shR[0] + 17, shR[1] + 1]], 'cue', 3.5),
      ],
      detail: fingerInset(87, 64, 'crimp'),
    }
  })(),

  /* The same hang with a pulley taking weight off: a belt at the hip, the cord
   * up over a pulley on the board's end and down to a solid weight. The cue is
   * the cord's pull: up, off the body. */
  'hang-assisted': (() => {
    const b = hanger()
    const { hip } = b.joints
    const belt = [hip[0] + 6, hip[1]]
    const pulley = [110, 9]
    const inn = [pulley[0] - 4, pulley[1] + 1.5]
    return {
      alt: 'Hanging from the edge with a pulley and counterweight taking weight off',
      props: [
        ...BOARD,
        { k: 'prop', d: line([104, 6], [pulley[0], pulley[1] - 4.5]), w: 2.5 },
      ],
      a: [
        ...parts(b, 'legL', 'legR', 'torso', 'armL', 'armR', 'head'),
        gripHand(46), gripHand(74),
        { k: 'thin', d: line([hip[0] - 6, hip[1]], belt) },
        { k: 'thin', c: [pulley[0], pulley[1], 4.5] },
        { k: 'thin', d: `${line(belt, inn)} ${line([pulley[0] + 4.5, pulley[1]], [pulley[0] + 4.5, 40])}` },
        { k: 'fill', d: rrect(pulley[0] - 1, 40, 11, 15, 2.5) },
        ...arrow([go(belt, angle(belt, inn), 7), go(belt, angle(belt, inn), 21)], 'cue', 4),
      ],
    }
  })(),

  /* Side view, facing right, so the knee comes FORWARD to a sling hanging in
   * front, the way the drill goes. The torso never leans back; the dashed line
   * behind the back is the plumb the body must not swing off. */
  'hang-knee-lift': (() => {
    const hip = [52, 63]
    const base = {
      view: 'side', hip, lean: -90, neck: -62,
      armL: { to: [49, 14], bend: -1 },
      armR: { to: [48, 15], bend: -1 },
      far: ['armR', 'legR'],
    }
    const down = body({ ...base, legL: { dir: [90, 90], end: 55 }, legR: { dir: [92, 92], end: 57 } })
    const up = body({ ...base, legL: { to: [73.5, 75], bend: -1, end: 5 }, legR: { dir: [92, 92], end: 57 } })
    return {
      alt: 'Hanging still in profile and lifting one knee to touch the ball of the foot to a sling in front',
      props: [
        { k: 'propFill', d: rrect(40, 4, 22, 8, 3) },
        { k: 'prop', d: line([82, 8], [82, 71]), w: 3 },
        { k: 'prop', d: ellipse(82, 75, 4.5, 3.5), w: 3 },
      ],
      s: [
        { k: 'cue', d: line([38, 20], [38, 96]), dash: '3 4', w: 2.5 },
        ...parts(down, 'armR', 'legR', 'torso', 'armL', 'head'),
        { k: 'fill', d: rrect(44, 9, 9, 6, 3) },
      ],
      a: parts(down, 'legL'),
      b: parts(up, 'legL'),
    }
  })(),

  /* Side view on a wall-mounted board: feet on a stair against the wall (the
   * stair is the load, so it is the cue), hands on the rungs. Only one hand
   * moves, to the next rung up; the arrow is that move. */
  'board-crawl': (() => {
    const hip = [65, 57]
    const rung = (y) => ({ k: 'hold', d: rrect(84, y - 2, 8, 4, 2) })
    const base = {
      view: 'side', hip, lean: -76, neck: -100, far: ['armR', 'legR'],
      armR: { to: [83, 40], bend: 1, end: -40, tip: 3 },
      legL: { to: [80, 66], bend: -1, end: 0, tip: 5 },
      legR: { to: [77, 66], bend: -1, end: 0, tip: 5 },
    }
    const a = body({ ...base, armL: { to: [83, 28], bend: 1, end: -40, tip: 3 } })
    const b = body({ ...base, armL: { to: [83, 16], bend: 1, end: -40, tip: 3 } })
    return {
      alt: 'Feet on a stair against the wall, hands on the board, moving one hand to the next rung',
      props: [
        { k: 'propFill', d: 'M92 0 H118 V100 H92 Z' },
        rung(16), rung(28), rung(40),
        FLOOR,
      ],
      s: [
        { k: 'cue', d: `M40 ${FLOOR_Y} V80 H64 V70 H92`, w: 3.5 },
        ...parts(a, 'armR', 'legR', 'legL', 'torso', 'head'),
      ],
      a: parts(a, 'armL'),
      b: parts(b, 'armL'),
    }
  })(),

  /* The arms are the cue and they are the same lines in both poses: locked
   * straight, hands fixed. What changes is the body under them. In A the
   * shoulders are shrugged up to the ears (the shoulder line kinks up to the
   * arms and the head sinks between them); in B the shoulders are pulled down,
   * so the whole body rises, the shoulder line goes flat and the neck shows. */
  'scap-pull': (() => {
    const wrist = [[44, LIP + 3], [76, LIP + 3]]
    const J = [go(wrist[0], 70, 25), go(wrist[1], 110, 25)]
    const arms = [
      { k: 'cueBody', d: line(wrist[0], J[0]) },
      { k: 'cueBody', d: line(wrist[1], J[1]) },
    ]
    const torso = (top, dropHead) => {
      const hip = [60, top[1] + BONES.torso]
      const b = body({
        view: 'front', hip,
        legL: { dir: [93, 91], end: 125, tip: 4 },
        legR: { dir: [87, 89], end: 55, tip: 4 },
      })
      const headY = dropHead ? J[0][1] + 2 : top[1] - BONES.neck - BONES.head
      return [
        { k: 'body', d: `${line(J[0], top, J[1])} ${line(top, hip)} ${line(b.joints.hipL, b.joints.hipR)}` },
        b.legL, b.legR,
        { k: 'fill', c: [60, r1(headY), BONES.head] },
      ]
    }
    return {
      alt: 'Hanging with locked straight arms, shrugged, then pulling the shoulders down so the body rises',
      props: BOARD,
      s: [...arms, gripHand(44), gripHand(76)],
      a: torso([60, J[0][1] + 3.5], true),
      b: torso([60, J[0][1] - 2.5], false),
    }
  })(),

  /* --- the load cell ---------------------------------------------------- */

  /* Standing tall on the webbing loop, the pulling arm straight down at the
   * side holding the edge block, the cord taut from the block through the
   * gauge to the loop. The straight arm is the cue: a bent elbow or a lean
   * puts the body into the number. */
  'no-hang-pull': (() => {
    const b = body({
      view: 'front', hip: [50, 57], cue: ['armR'],
      armL: { dir: [100, 97] },
      armR: { dir: [79, 80] },
      legL: { dir: [96, 94], end: 160, tip: 5 },
      legR: { dir: [90, 92], end: 20, tip: 5 },
    })
    const hand = b.limbs.armR.end
    const x = r1(hand[0])
    return {
      alt: 'Standing on a webbing loop, the pulling arm straight down at the side, pulling an edge block tethered to the loop',
      props: [FLOOR],
      a: [
        { k: 'thin', d: `M${x} ${r1(hand[1] + 8)} V${ON_FLOOR - 1} H38` },
        { k: 'thin', d: rrect(x - 3.5, 72, 7, 8, 1.5) },
        { k: 'fill', d: rrect(x - 4, hand[1] + 1, 8, 7, 2) },
        ...parts(b, 'legL', 'legR', 'torso', 'armL', 'armR', 'head'),
        ...arrow([[x + 11, hand[1] + 9], [x + 11, hand[1] - 9]], 'thin', 3.5),
      ],
    }
  })(),

  /* --- the floor -------------------------------------------------------- */

  /* Side view, head to the left. The support forearm and the body line never
   * move (they are in `s`, so the support arm cannot vanish); the reaching arm
   * slides out along the floor. The cue is the hip: it stays down. */
  'plank-reach': (() => {
    const sh = [30, ON_FLOOR - BONES.upperArm]
    const L = BONES.torso + BONES.thigh + BONES.shin
    const along = (Math.asin((ON_FLOOR - 6 - sh[1]) / L) * 180) / Math.PI
    const ankle = go(sh, along, L)
    const hip = go(sh, along, BONES.torso)
    const lean = along + 180
    const b = body({
      view: 'side', hip, lean, neck: 192,
      armL: { dir: [90, 180], end: 180 },
      legL: { to: ankle, bend: 1, end: 100 },
    })
    const tucked = body({ view: 'side', hip, lean, armR: { dir: [86, 180], end: 180 } })
    const out = body({ view: 'side', hip, lean, armR: { dir: [148.7, 148.7], end: 180 } })
    return {
      alt: 'Forearm plank in profile, sliding one arm forward along the floor while the hips stay down',
      props: [FLOOR],
      s: [
        ...parts(b, 'legL', 'torso', 'armL', 'head'),
        ...arrow([[hip[0], hip[1] - 16], [hip[0], hip[1] - 6]], 'cue', 3.5),
      ],
      a: [tucked.armR],
      b: [out.armR],
    }
  })(),

  /* Side plank from the front, chest to the camera, on one forearm (a pad
   * under the elbow: the forearm points at you), so it never reads as the
   * plank: the shoulders are stacked one above the other on the support arm,
   * the top arm goes up from the top shoulder to the ceiling, the head sits
   * between them at the end of the spine, the feet are stacked. The cue is the
   * straight line from shoulders to ankle, dashed over the body: the dip drops
   * the hip off it and the rep presses back onto it. */
  'side-bridge': (() => {
    const elbow = [24, ON_FLOOR - 1]
    const bottom = [24, elbow[1] - BONES.upperArm]
    const L = BONES.torso + BONES.thigh + BONES.shin
    const along = (Math.asin((ON_FLOOR - 4 - (bottom[1] - BONES.shoulders)) / L) * 180) / Math.PI
    const up = along - 90
    const sh = go(bottom, up, BONES.shoulders)
    const top = go(sh, up, BONES.shoulders)
    const ankle = go(sh, along, L)
    const straightHip = go(sh, along, BONES.torso)
    const headC = go(sh, along + 180, BONES.neck + BONES.head)
    // The dip turns the trunk down about the shoulders (the hip drops about 6
    // units). Rigid bones cannot dip a straight body between a fixed shoulder
    // and a fixed ankle, so the stacked feet slide in the unit or so they
    // really do, and every bone keeps its length.
    const feet = (a) => ({ k: 'body', d: line(go(a, up, 4), go(a, up + 180, 3)) })
    const pose = (dip) => {
      const hip = dip ? go(sh, along + dip, BONES.torso) : straightHip
      const to = dip ? go(hip, angle(hip, ankle), BONES.thigh + BONES.shin - 0.4) : ankle
      const leg = limb(hip, { to, bend: 1 }, BONES.thigh, BONES.shin)
      return [{ k: 'body', d: line(sh, hip) }, { k: 'body', d: leg.d }, feet(leg.end)]
    }
    return {
      alt: 'Side plank on one forearm, chest to the front, top arm to the ceiling, dipping the hip and pressing it back up to the line',
      props: [FLOOR],
      s: [
        { k: 'fill', d: rrect(elbow[0] - 6, elbow[1] - 1, 12, 4, 2) },
        { k: 'body', d: line(elbow, bottom, top, go(top, -90, BONES.upperArm + BONES.forearm)) },
        { k: 'fill', c: [r1(headC[0]), r1(headC[1]), BONES.head] },
      ],
      a: pose(0),
      b: pose(15),
      over: [{ k: 'cue', d: line(sh, ankle), dash: '4 3.5', w: 2.5 }],
    }
  })(),

  /* Side view, head to the left, toes on the floor, hand under the shoulder.
   * At the bottom the elbow points BACK toward the feet (tucked to the ribs),
   * and the body stays one straight line: the dashed cue rides on it, and it
   * is the line hips must not sag below or pike above. */
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
        view: 'side', hip, lean, neck: lean - 8,
        armL: { to: wrist, bend: -1, end: 180 },
        legL: { to: ankle, bend: 1, end: 100 },
      })
      return [
        ...parts(b, 'legL', 'torso', 'armL', 'head'),
        { k: 'cue', d: line(sh, ankle), dash: '4 3.5', w: 2.5 },
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

  /* Front view: the feet never move. In B the hips drop to knee height over
   * the bent leg (its foot flat, turned out) and the other leg stays locked
   * straight with the heel down and the toes pulled up. That straight leg is
   * the cue. The plate is a ring held at the chest. */
  cossack: (() => {
    const footL = [36, 84]
    const footR = [82, 84]
    const pose = (hip) => {
      const b = body({
        view: 'front', hip, cue: ['legR'],
        legL: { to: footL, bend: 1, end: 165, tip: 6 },
        legR: { to: footR, bend: -1, end: -62, tip: 6 },
      })
      const sh = b.joints.sh
      const pl = [sh[0], sh[1] + 9]
      const arm = (from, side) => limb(from, { to: [pl[0] + side * 6.5, pl[1] + 1], bend: side > 0 ? 1 : -1 }, BONES.upperArm, BONES.forearm)
      return [
        ...parts(b, 'legL', 'legR', 'torso', 'head'),
        { k: 'thin', c: [r1(pl[0]), r1(pl[1]), 6.5] },
        { k: 'fill', c: [r1(pl[0]), r1(pl[1]), 1.8] },
        { k: 'body', d: arm(b.joints.shL, -1).d },
        { k: 'body', d: arm(b.joints.shR, 1).d },
      ]
    }
    return {
      alt: 'Cossack squat: sitting down over one bent leg, heel flat, the other leg locked straight with the toes up',
      props: [FLOOR],
      a: pose([59, 63]),
      b: pose([53, 70.5]),
    }
  })(),

  /* Seen from above, sitting tall, drawn larger than the standing figures
   * because from above a person is mostly legs. The head is ON the shoulders
   * (a nose tick says which way they face). Front thigh forward, its shin
   * across the front; back thigh out to the side, its shin pointing back: 90°
   * at both hips and both knees. The cue is the sweep: both knees together,
   * clockwise, to the mirror image. The inset is the side view the watch is
   * about: the back tall, not rounded. */
  'ninety-ninety': (() => {
    const k = 1.6
    const c = [60, 38]
    const hipL = [c[0] - 6, c[1] + 4]
    const hipR = [c[0] + 6, c[1] + 4]
    const T = BONES.thigh * k
    const S = BONES.shin * k
    const leg = (hip, thighDir, shinDir) => {
      const knee = go(hip, thighDir, T)
      const ft = go(knee, shinDir, S)
      return [{ k: 'body', d: line(hip, knee, ft), w: 6 }, { k: 'fill', c: [r1(ft[0]), r1(ft[1]), 3.6] }]
    }
    const inset = (ox, oy) => [
      { k: 'prop', d: rrect(ox, oy, 26, 30, 5), w: 1.5 },
      { k: 'prop', d: `M${ox + 3} ${oy + 25} H${ox + 23}`, w: 2 },
      { k: 'body', d: line([ox + 8, oy + 21.5], [ox + 21, oy + 21.5]), w: 3.5 },
      { k: 'cueBody', d: line([ox + 8, oy + 21.5], [ox + 8, oy + 11]), w: 3.5 },
      { k: 'fill', c: [ox + 8.5, oy + 6.5, 3.5] },
    ]
    return {
      alt: 'Seated 90/90 seen from above, sitting tall, sweeping both knees through to the mirror position',
      s: [
        ...arcArrow([c[0], c[1] - 6], 50, 62, 118, 'cue'),
      ],
      a: [...leg(hipL, 90, 0), ...leg(hipR, 0, -90)],
      b: [...leg(hipR, 90, 180), ...leg(hipL, 180, -90)],
      over: [
        { k: 'body', d: line([c[0] - 12, c[1]], [c[0] + 12, c[1]]), w: 8 },
        { k: 'fill', c: [c[0], c[1], 8] },
        { k: 'fill', d: `M${c[0] - 3} ${c[1] + 6.5} L${c[0]} ${c[1] + 12} L${c[0] + 3} ${c[1] + 6.5} Z` },
      ],
      detail: inset(2, 68),
    }
  })(),

  /* From above, facing the wall at the top, drawn larger like the 90/90. The
   * legs are the cue, locked straight in a V with the soles flat on the wall;
   * only the trunk and hands move, walking forward toward the wall. */
  'straddle-sit': (() => {
    const k = 1.55
    const hip = [60, 56]
    const spread = 52
    const hipL = [hip[0] - 6, hip[1]]
    const hipR = [hip[0] + 6, hip[1]]
    const L = (BONES.thigh + BONES.shin) * k
    const ankL = go(hipL, -90 - spread, L)
    const ankR = go(hipR, -90 + spread, L)
    const wall = r1(ankL[1] - 4.5)
    const sole = (a) => ({ k: 'body', d: line([a[0] - 4.5, wall + 2.5], [a[0] + 4.5, wall + 2.5]) })
    const trunk = (fwd, reach) => {
      const sh = [60, hip[1] - fwd]
      const hand = (side) => [sh[0] + side * 12, sh[1] - reach]
      return [
        { k: 'body', d: `${line(hip, sh)} ${line(hipL, hipR)}`, w: 6 },
        { k: 'body', d: `${line([sh[0] - 11, sh[1]], hand(-1))} ${line([sh[0] + 11, sh[1]], hand(1))}` },
        { k: 'fill', c: [...hand(-1).map(r1), 3.4] }, { k: 'fill', c: [...hand(1).map(r1), 3.4] },
        { k: 'body', d: line([sh[0] - 12, sh[1]], [sh[0] + 12, sh[1]]), w: 8 },
        { k: 'fill', c: [60, r1(sh[1]), 8] },
        { k: 'fill', d: `M57 ${r1(sh[1] - 6.5)} L60 ${r1(sh[1] - 12)} L63 ${r1(sh[1] - 6.5)} Z` },
      ]
    }
    return {
      alt: 'Seated straddle seen from above, knees locked, soles on the wall, walking the hands forward',
      props: [
        { k: 'propFill', d: `M4 0 H116 V${wall} H4 Z` },
        { k: 'prop', d: `M4 ${wall} H116` },
      ],
      s: [
        { k: 'cueBody', d: line(hipL, ankL), w: 6 }, { k: 'cueBody', d: line(hipR, ankR), w: 6 },
        sole(ankL), sole(ankR),
      ],
      a: trunk(3, 13),
      b: trunk(17, 14),
    }
  })(),

  /* --- forearms --------------------------------------------------------- */

  /* From above, standing, facing down the page, drawn larger like the other
   * top views: the head on the shoulders, the working elbow pinned to the ribs
   * (from above the upper arm is just that point: the ring is the cue), the
   * forearm swinging from across the belly to out to the side. The band runs
   * from an anchor on the far side, so it pulls the hand back across the body;
   * it stretches in B. */
  'ext-rotation': (() => {
    const elbow = [80, 42]
    const anchor = [10, 64]
    const fore = (deg) => {
      const w = go(elbow, deg, 22)
      const h = go(elbow, deg, 25)
      return [
        { k: 'thin', d: line([anchor[0] + 4, anchor[1]], h) },
        { k: 'body', d: line(elbow, w), w: 6 },
        { k: 'fill', c: [r1(h[0]), r1(h[1]), 4.5] },
      ]
    }
    return {
      alt: 'Band external rotation seen from above: elbow pinned to the ribs, the forearm turning out against a band anchored on the other side',
      props: [{ k: 'propFill', d: rrect(anchor[0] - 6, anchor[1] - 8, 10, 16, 2) }],
      s: [
        { k: 'fill', d: rrect(30, 31, 54, 15, 7.5) },
        { k: 'fill', c: [36, 42, 5] },
        { k: 'fill', c: [57, 37, 10] },
        { k: 'fill', d: 'M53.5 46 L57 52 L60.5 46 Z' },
        ...arcArrow(elbow, 14, 150, 62, 'thin'),
      ],
      a: fore(154),
      b: fore(62),
      over: [{ k: 'cue', c: [elbow[0], elbow[1], 7.5] }, { k: 'fill', c: [elbow[0], elbow[1], 4] }],
    }
  })(),

  /* A close-up from the side: the thigh with its knee and shin, the forearm
   * (the cue: it stays down) lying ON the thigh with the wrist at the knee,
   * and only the hand moving, from hanging down to cocked up, a dumbbell seen
   * end-on in the fist. */
  'wrist-ext': (() => {
    const wrist = [70, 53]
    const hand = (deg) => {
      const fist = go(wrist, deg, 15)
      return [
        { k: 'body', d: line(wrist, go(wrist, deg, 11)), w: 8 },
        { k: 'body', c: [r1(fist[0]), r1(fist[1]), 7.5] },
        { k: 'fill', c: [r1(fist[0]), r1(fist[1]), 4.5] },
      ]
    }
    return {
      alt: 'Wrist extension close up: forearm resting on the thigh, palm down, only the hand lifting the weight',
      props: [
        { k: 'propFill', d: 'M2 57 H66 Q74 57 74 66 V67 Q74 75 66 75 H2 Z' },
        { k: 'propFill', d: 'M56 70 L72 70 L66 100 L52 100 Z' },
      ],
      s: [
        { k: 'body', d: line([4, 16], [15, 51]), w: 6 },
        { k: 'cueBody', d: line([15, 52], wrist), w: 6.5 },
        ...arcArrow(wrist, 31, 48, -42, 'thin'),
      ],
      a: hand(64),
      b: hand(-50),
    }
  })(),

  /*
   * Eccentric rotation, seen end-on down the forearm resting on the thigh (the
   * pale oval is the knee behind it). The fist has a thumb, so palm up and palm
   * down are different pictures; the plate is held by its rim so it hangs off
   * one side of the fist. A is where the free hand has turned it; B is where
   * the slow lowering ends. The dashed arrow (the cue) is that lowering, and it
   * runs the way the plate moves. Supination and pronation are mirror images:
   * the plate starts on the other side and the arrow turns the other way.
   */
  ...(() => {
    const c = [60, 58]
    const fist = (thumbLeft) => [
      { k: 'fill', d: rrect(c[0] - 10, c[1] - 9, 20, 18, 6) },
      { k: 'fill', d: rrect(c[0] + (thumbLeft ? -12 : 1), c[1] - 13, 11, 6, 3) },
    ]
    const plateAt = (deg) => {
      const p = go(c, deg, 23)
      return [
        { k: 'body', c: [r1(p[0]), r1(p[1]), 11], w: 5 },
        { k: 'fill', c: [r1(p[0]), r1(p[1]), 3] },
      ]
    }
    const knee = { k: 'propFill', d: ellipse(60, 84, 34, 11) }
    return {
      'forearm-supination': {
        alt: 'Eccentric supination seen end-on: the free hand turns the plate palm-up, then the working hand lowers it slowly back to palm-down',
        props: [knee],
        s: arcArrow(c, 44, -22, -158, 'cue', '5 4'),
        a: [...plateAt(-5), ...fist(true)],
        b: [...plateAt(185), ...fist(false)],
      },
      'forearm-pronation': {
        alt: 'Eccentric pronation seen end-on: the free hand turns the plate palm-down, then the working hand lowers it slowly back to palm-up',
        props: [knee],
        s: arcArrow(c, 44, -158, -22, 'cue', '5 4'),
        a: [...plateAt(185), ...fist(false)],
        b: [...plateAt(-5), ...fist(true)],
      },
    }
  })(),

  /* --- grips ------------------------------------------------------------ */

  /* A close-up of one hand on the board's edge, from behind: the board above,
   * the back of the hand below, each finger reaching up over the lip. Which
   * fingers are ON is the whole distinction between the three blocks, so the
   * fingertips on the edge are the cue, and a finger that is OFF is curled
   * short, well clear of the edge. The inset shows the finger position. */
  ...(() => {
    const lip = 30
    const xs = [36, 48, 60, 72]
    const edge = [
      { k: 'propFill', d: rrect(4, 4, 112, lip - 4, 4) },
      { k: 'prop', d: `M4 ${lip + 1} H116`, w: 3 },
    ]
    const palm = [
      { k: 'fill', d: 'M29 58 L79 58 L74 88 Q54 94 34 88 Z' },
      { k: 'fill', d: rrect(38, 86, 32, 14, 4) },
      { k: 'fill', d: 'M30 64 L20 54 Q16 50 20 47 L25 46 L36 60 Z' },
    ]
    const on = (x) => [
      { k: 'fill', d: rrect(x - 5, lip + 12, 10, 18, 4.5) },
      { k: 'fill', d: rrect(x - 5, lip - 4, 10, 14.5, 4.5) },
      { k: 'cueFill', d: rrect(x - 5, lip - 4, 10, 6, 3) },
    ]
    const off = (x) => [
      { k: 'fill', d: rrect(x - 5, 48, 10, 12, 4.5) },
      { k: 'fill', d: rrect(x - 4, 44, 8, 6, 3) },
    ]
    const hand = (live) => [...palm, ...xs.flatMap((x, i) => (live.includes(i) ? on(x) : off(x)))]
    return {
      'grip-four': {
        alt: 'All four fingers on the edge in a half crimp, thumb off',
        props: edge, a: hand([0, 1, 2, 3]), detail: fingerInset(87, 66, 'crimp'),
      },
      'grip-front-three': {
        alt: 'Index, middle and ring on the edge, open hand; the pinky curled off',
        props: edge, a: hand([0, 1, 2]), detail: fingerInset(87, 66, 'open'),
      },
      'grip-two': {
        alt: 'Two fingers on the edge: the front two, then the middle two; the others curled off',
        props: edge, a: hand([0, 1]), b: hand([1, 2]),
      },
    }
  })(),

  /* --- climbing --------------------------------------------------------- */

  /* Every climber is the same body in profile, facing the wall on the right,
   * hands on holds and a foot on a hold, far limbs faint. The walls differ so
   * the five read apart even as thumbnails: a steep board leaning OVER the
   * climber with a regular row of holds; a vertical route with a rope and a
   * draw; the same route with the lower-and-go-again arrow; an overhang over a
   * thick pad; real rock with a tree. */

  /* An overhanging board on a kicker: the face leans over the climber, holds
   * in a regular row. Arms straight, hips in to the board, one foot on, the
   * other leg hanging. The cue is the straight arms: you hang off them. */
  'climb-board': (() => {
    const base = [110, 70]
    const top = [56, 0]
    const at = (t, off = 0) => {
      const p = [base[0] + (top[0] - base[0]) * t, base[1] + (top[1] - base[1]) * t]
      return go(p, angle(base, top) - 90, off)
    }
    const hand = at(0.75, 4.5)
    const sh = go(hand, 100, 24.6)
    const hip = go(sh, 55, BONES.torso)
    const b = climber({
      hip, lean: angle(hip, sh), neck: -12, cue: ['armL'],
      armL: { to: hand, bend: 1 },
      armR: { to: at(0.6, 4.5), bend: 1 },
      legL: { to: at(0.1, 7), bend: -1, end: -25, tip: 5 },
      legR: { dir: [140, 110], end: 60, tip: 5 },
    })
    return {
      alt: 'Climbing an overhanging board: the board leans over the climber, arms straight, hips in, one foot on',
      props: [
        { k: 'propFill', d: `M${base[0]} ${FLOOR_Y} V${base[1]} L${top[0]} ${top[1]} H120 V${FLOOR_Y} Z` },
        FLOOR,
        ...[0.1, 0.225, 0.35, 0.475, 0.6, 0.75, 0.875].map(t => hold(...at(t, 1.5), 3.2)),
      ],
      a: parts(b, 'armR', 'legR', 'legL', 'torso', 'armL', 'head'),
    }
  })(),

  ...(() => {
    const wallX = 88
    const wall = [
      { k: 'propFill', d: `M${wallX} 0 H120 V100 H${wallX} Z` },
      hold(wallX - 1, 13), hold(wallX - 1, 36), hold(wallX - 1, 64), hold(wallX - 1, 84),
    ]
    const r = climber({
      hip: [66, 58], lean: -84, neck: -70, far: ['legR'],
      armL: { to: [wallX - 5, 15], bend: 1, end: -30, tip: 3 },
      armR: { dir: [118, 104] },
      legL: { to: [wallX - 9, 84], bend: -1, end: 0, tip: 5 },
      legR: { to: [wallX - 8, 66], bend: -1, end: 0, tip: 5 },
    })
    const draw = [wallX - 2, 41]
    const rope = (k = 'thin') => [
      ...quickdraw(draw[0], draw[1]),
      { k, d: `M${P(r.joints.hip)} Q${P([draw[0] - 8, r.joints.hip[1] - 2])} ${P([draw[0] - 1, draw[1] + 9.5])} L${P([draw[0] - 4, 100])}`, w: 2.2 },
    ]
    const hand = r.limbs.armR.end
    const shake = [
      { k: 'cue', d: `M${P([hand[0] - 6, hand[1] - 5])} Q${P([hand[0] - 10, hand[1]])} ${P([hand[0] - 6, hand[1] + 5])}`, w: 2.5 },
      { k: 'cue', d: `M${P([hand[0] - 12, hand[1] - 8])} Q${P([hand[0] - 17, hand[1]])} ${P([hand[0] - 12, hand[1] + 8])}`, w: 2.5 },
    ]
    const people = parts(r, 'legR', 'legL', 'torso', 'armL', 'armR', 'head')
    return {
      /* The cue is the shake: one hand on, the other arm dropped and shaken
       * loose, which is what every lap of the economy and ARC cards asks for. */
      'climb-route': {
        alt: 'Leading a vertical route: rope clipped to a quickdraw, one hand on, the other arm down shaking out',
        props: wall,
        a: [...rope(), ...people, ...shake],
      },
      /* The same route, with the cue a down-then-up arrow beside it: lower,
       * and go straight back up. */
      'climb-double': {
        alt: 'Climbing a route, lowering, and going straight back up again',
        props: wall,
        a: [
          ...rope(), ...people,
          { k: 'cue', d: 'M20 22 V74 Q20 84 28 84 Q36 84 36 74 V22' },
          ...arrow([[20, 60], [20, 74]], 'cue', 5).slice(1),
          ...arrow([[36, 34], [36, 22]], 'cue', 5).slice(1),
        ],
      },
    }
  })(),

  /* Real rock: an irregular face the hands and feet are on, a bolt with the
   * rope clipped (the cue: burns on a route), and a tree to say outdoors. */
  crag: (() => {
    const face = [[90, 0], [83, 13], [89, 26], [82, 40], [90, 54], [84, 70], [91, 84], [86, 100]]
    const b = climber({
      hip: [66, 58], lean: -84, neck: -70, far: ['armR', 'legR'],
      armL: { to: [80, 14], bend: 1, end: -40, tip: 3 },
      armR: { to: [79, 39], bend: 1, end: -40, tip: 3 },
      legL: { to: [80, 82], bend: -1, end: 0, tip: 5 },
      legR: { to: [80, 68], bend: -1, end: 0, tip: 5 },
    })
    const hip = b.joints.hip
    return {
      alt: 'Climbing a route on real rock: hands and feet on the rock, rope clipped to a bolt, a tree behind',
      props: [
        { k: 'propFill', d: `M${face.map(P).join(' L')} H120 V0 Z` },
        { k: 'prop', d: 'M2 96 H44', w: 3 },
        { k: 'propFill', d: 'M22 48 L36 78 H27 V96 H17 V78 H8 Z' },
      ],
      a: [
        ...quickdraw(86, 46),
        { k: 'cue', d: `M${P(hip)} Q${P([77, 56])} ${P([85, 55.5])} L${P([82, 100])}`, w: 2.5 },
        ...parts(b, 'armR', 'legR', 'legL', 'torso', 'armL', 'head'),
      ],
    }
  })(),

  /* An overhanging wall over a thick crash pad, no rope, the climber low,
   * feet just above the pad. The cue outlines the pad: what you fall onto,
   * and the falls are what the card asks you to count honestly. */
  boulder: (() => {
    const base = [100, 82]
    const top = [76, 0]
    const at = (t, off = 0) => {
      const p = [base[0] + (top[0] - base[0]) * t, base[1] + (top[1] - base[1]) * t]
      return go(p, angle(base, top) - 90, off)
    }
    const hand = at(0.75, 4.5)
    const sh = go(hand, 105, 24.4)
    const hip = go(sh, 68, BONES.torso)
    const b = climber({
      hip, lean: angle(hip, sh), neck: -15,
      armL: { to: hand, bend: 1 },
      armR: { to: at(0.56, 4.5), bend: 1 },
      legL: { to: at(0.13, 7), bend: -1, end: -15, tip: 5 },
      legR: { dir: [155, 120], end: 70, tip: 5 },
    })
    return {
      alt: 'Bouldering low on an overhanging wall above a thick crash pad, no rope',
      props: [
        { k: 'propFill', d: `M${base[0]} 100 V${base[1]} L${top[0]} ${top[1]} H120 V100 Z` },
        hold(...at(0.75, 1.5), 4.4), hold(...at(0.56, 1.5), 4), hold(...at(0.13, 1.5), 3.6),
        hold(...at(0.36, 1.5), 4.4), hold(...at(0.92, 1.5), 3.6),
      ],
      a: [
        { k: 'propFill', d: rrect(14, 84, 86, 12, 3) },
        { k: 'cue', d: rrect(14, 84, 86, 12, 3), w: 2.5 },
        ...parts(b, 'armR', 'legR', 'legL', 'torso', 'armL', 'head'),
      ],
    }
  })(),

  /* Front view, low on the wall, a row of hand holds and a row of footholds
   * just above the floor. From A to B the whole body moves one step right:
   * the leading hand to the next hold, the trailing hand stays, the hips move
   * over and one foot steps through. The cue is the direction of travel. */
  'wall-traverse': (() => {
    const hands = [[14, 30], [34, 26], [54, 30], [74, 26], [94, 30]]
    const feet = [[24, 78], [44, 80], [64, 78], [84, 80], [104, 78]]
    const pose = (hip, hL, hR, fL, fR) => {
      const b = body({
        view: 'front', hip,
        armL: { to: [hL[0], hL[1] + 3], bend: -1 },
        armR: { to: [hR[0], hR[1] + 3], bend: 1 },
        legL: { to: [fL[0], fL[1] - 5], bend: 1, end: 160, tip: 4 },
        legR: { to: [fR[0], fR[1] - 5], bend: -1, end: 20, tip: 4 },
      })
      return parts(b, 'legL', 'legR', 'torso', 'armL', 'armR', 'head')
    }
    return {
      alt: 'Traversing sideways low along a climbing wall, big holds, feet just above the floor',
      props: [
        FLOOR,
        ...hands.map(([x, y]) => hold(x, y, 4.2)),
        ...feet.map(([x, y]) => hold(x, y, 3.6)),
      ],
      s: arrow([[44, 8], [78, 8]], 'cue', 5),
      a: pose([50, 54], hands[1], hands[3], feet[1], feet[2]),
      b: pose([63, 54], hands[1], hands[4], feet[1], feet[3]),
    }
  })(),
}

/** True if the plan can name this figure. Pinned by the content test. */
export const hasFigure = (name) => Boolean(name && FIGURES[name])
