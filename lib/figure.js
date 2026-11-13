// THE ARTICULATED FIGURE — the player's body on a skeleton. Head, two chest
// hexes, hip and base are the player's own (drawPlayerBody's layout, in head
// radii); the arms and legs hang from the same roots but as CHAINS of joints
// in three dimensions, so a limb can point anywhere on a sphere: a figure can
// sit, rest a hand on a knee, reach toward you, or move. The drawing is the
// plain front view — a segment turned toward or away from you foreshortened.
// The head is drawn like the cube: its outline at the body's weight, the Y
// inside as hairlines only.
//
// A POSE is, per limb, its joints' values in degrees — an arm's shoulder,
// elbow and wrist, a leg's hip, knee and ankle (AXES):
//   · a BALL joint (shoulder, hip, wrist, ankle) is `[x, y, twist]`: `x`
//     turns the segment in the picture's plane, positive toward the limb's
//     outer side; `y` tilts it toward the viewer; `twist` turns everything
//     below about the segment's own line, positive outward (the limb's front
//     turning to its side) — so a twist at the hip turns the plane the knee
//     folds in, and the foot with it.
//   · a HINGE (elbow, knee) is `[bend]`: it folds in depth, as the body's do
//     — the elbow brings the forearm toward the viewer, the knee takes the
//     shin away (FOLD). Seen straight on, a bend only shortens the limb; a
//     twist above it lays the fold into the picture.
// Each joint turns in the frame the joint before it left. An arm also says
// how OPEN its hand is — the angle between fingers and thumb, 0 closed to 180
// flat, HAND_OPEN when left out — and a pose may say `under` to draw its
// limbs beneath the body's paper. RANGE is each value's human reach; a pose
// past a limit is held at it.
//
// The SKELETON is the segment lengths, in head radii: the four limb
// segments, and the HANDS and FEET. A hand is a clamp from the wrist: the
// THUMB on the inside, the FINGERS, longer, outside, open by the pose's say.
// A foot is the player's own Y stood on its head: the stem from the ankle
// down to the ground, the toe forward toward the viewer and the heel back,
// 60° off the stem each — so from the front a straight leg's foot lies on
// the leg's own line, and shows only as the leg or the ankle turns. All plain data — the lab (lab/figure.html) tunes them
// and hands back JSON; the game draws what it is given.
const S3 = 0.8660254 // √3/2 — the pointy hex's horizontal reach

export const SKELETON = { upperArm: 2, lowerArm: 2, upperLeg: 2, lowerLeg: 2.6, finger: 0.75, thumb: 0.5, foot: 0.5, toe: 1, heel: 0.25 } // limbs tuned in the lab (2026-11-06)

export const LIMBS = ["larm", "rarm", "lleg", "rleg"]
// a limb's joints, root first
export const JOINTS = { arm: ["shoulder", "elbow", "wrist"], leg: ["hip", "knee", "ankle"] }
export const kindOf = limb => (limb.endsWith("arm") ? "arm" : "leg")
// each joint's values, and their reach in degrees, [min, max] per value
export const AXES = { shoulder: ["x", "y", "twist"], elbow: ["bend"], wrist: ["x", "y", "twist"], hip: ["x", "y", "twist"], knee: ["bend"], ankle: ["x", "y", "twist"] }
export const RANGE = {
  shoulder: [[-60, 180], [-60, 180], [-90, 90]],
  elbow: [[0, 165]],
  wrist: [[-60, 60], [-70, 70], [-90, 90]],
  hip: [[-45, 150], [-30, 120], [-45, 90]],
  knee: [[0, 165]],
  ankle: [[-50, 50], [-60, 60], [-90, 90]]
}
// which way a hinge folds: +1 toward the viewer, −1 away
export const FOLD = { elbow: 1, knee: -1 }
export const HAND_OPEN = 120 // a hand's opening when the pose says nothing
const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v))
const rad = deg => (deg * Math.PI) / 180

// the sit's hands and feet, found to lie in the picture as they did before
// the limbs could twist (2026-11-07; the foot again once it rested pointing
// forward, 2026-11-08): the hand exactly; the foot as near as the ankle's
// reach allows — the old one needs its y at +50
const SIT_WRIST = [4, -70, 86]
const SIT_ANKLE = [50, 20, 29]
const arm = (shoulder, elbow, wrist, open = HAND_OPEN) => ({ shoulder, elbow: [elbow], wrist, open })
const leg = (hip, knee, ankle) => ({ hip, knee: [knee], ankle })
export const POSES = {
  // the standing figure: every limb straight down, as drawPlayerBody draws it
  stand: { larm: arm([0, 0, 0], 0, [0, 0, 0]), rarm: arm([0, 0, 0], 0, [0, 0, 0]), lleg: leg([0, 0, 0], 0, [0, 0, 0]), rleg: leg([0, 0, 0], 0, [0, 0, 0]) },
  // sitting cross-legged, tuned in the lab (2026-11-06): the thighs wide and
  // turned out, the shins folded sharply back in across each other; the
  // upper arms down by the chest and turned in, the forearms folded up and in
  sit: { larm: arm([0, 0, -90], 120, SIT_WRIST), rarm: arm([0, 0, -90], 120, SIT_WRIST), lleg: leg([60, 0, 90], 160, SIT_ANKLE), rleg: leg([60, 0, 90], 160, SIT_ANKLE) }
}

// a pose part-way between two, by `t`
export function mixPose(a, b, t) {
  const out = { under: t < 0.5 ? !!a.under : !!b.under }
  for (const k of LIMBS) {
    const o = {}
    for (const jn of JOINTS[kindOf(k)]) {
      const A = a[k][jn] ?? []
      const B = b[k][jn] ?? []
      o[jn] = RANGE[jn].map((_, i) => (A[i] ?? 0) + ((B[i] ?? 0) - (A[i] ?? 0)) * t)
    }
    if (kindOf(k) === "arm") {
      const oa = a[k].open ?? HAND_OPEN
      const ob = b[k].open ?? HAND_OPEN
      o.open = oa + (ob - oa) * t
    }
    out[k] = o
  }
  return out
}

// A FRAME is three world vectors — `out` to the limb's side, `along` down the
// segment, `toward` the viewer. `carry` takes a vector given in a frame's own
// terms into the world; `turn` is the frame past a ball joint, turned `x` in
// the plane, tilted `y` toward the viewer and twisted `t` about its new line;
// `jointTurn` is the frame past a named joint, its values held to their reach.
export const carry = (F, [a, b, c]) => [0, 1, 2].map(i => F.out[i] * a + F.along[i] * b + F.toward[i] * c)
export function turn(F, x, y, t = 0) {
  const cx = Math.cos(rad(x))
  const sx = Math.sin(rad(x))
  const cy = Math.cos(rad(y))
  const sy = Math.sin(rad(y))
  const ct = Math.cos(rad(t))
  const st = Math.sin(rad(t))
  const along = carry(F, [sx * cy, cx * cy, sy])
  const out = carry(F, [cx, -sx, 0])
  const toward = carry(F, [-sx * sy, -cx * sy, cy])
  return { along, out: out.map((v, i) => v * ct - toward[i] * st), toward: toward.map((v, i) => v * ct + out[i] * st) }
}
export function jointTurn(F, jn, vals = []) {
  const v = RANGE[jn].map((r, i) => clamp(vals[i] ?? 0, r))
  return FOLD[jn] ? turn(F, 0, FOLD[jn] * v[0]) : turn(F, v[0], v[1], v[2])
}

// THE VIEW: the figure is seen from the front at `yaw` 0; a yaw turns the
// eye about the body's upright line, 90 seeing it from its left side (its
// front to the right). `side` is the screen's right in the figure's own
// terms, `depth` the way to the eye.
export const viewOf = (yaw = 0) => {
  const c = Math.cos(rad(yaw))
  const s = Math.sin(rad(yaw))
  return { side: [c, 0, s], depth: [-s, 0, c] }
}
// every joint of the figure, relative to the head's centre at (0, 0), for a
// head of radius `r`, seen at `yaw` — and the figure's extent (top, bottom,
// left, right), so a caller can seat its middle on a point. The drawn points
// are the screen's; `rig` keeps, per limb, each joint's place in the
// figure's own three dimensions, the frame it turns in and the reach of what
// it turns, for a tool that edits them.
export function figureJoints(pose, skel = SKELETON, r = 1, yaw = 0) {
  const w = r * S3
  const h = r / 2
  const d = 2 * S3 * r // centre to centre, as tiles sit
  const chestY = d * S3
  const hipY = chestY + d * S3
  const baseY = hipY + r
  const step = (p, F, v, len) => {
    const [dx, dy, dz] = carry(F, v)
    return [p[0] + dx * len * r, p[1] + dy * len * r, p[2] + dz * len * r]
  }
  // a limb: root, elbow/knee, wrist/ankle — the frame its hand or foot hangs
  // in, and each joint's rig: where it is, the frame before it, the reach of
  // the segment it turns (a wrist's the fingers', an ankle's the stem's)
  const limb = (rootX, rootY, s, P, names, lens) => {
    let F = { out: [s, 0, 0], along: [0, 1, 0], toward: [0, 0, 1] }
    let p = [rootX, rootY, 0]
    const pts = [p]
    const rig = []
    names.forEach((jn, i) => {
      rig.push({ joint: jn, at: p, F, R: lens[i] * r })
      F = jointTurn(F, jn, P[jn])
      if (i < 2) {
        p = step(p, F, [0, 1, 0], lens[i])
        pts.push(p)
      }
    })
    return { pts, F, rig, open: P.open ?? HAND_OPEN }
  }
  // the HAND, as strokes (point pairs): from the wrist, the fingers out to
  // its own side and the thumb in
  const hand = l => {
    const tip = l.pts[2]
    return [[l.open / 2, skel.finger], [-l.open / 2, skel.thumb]].map(([t, len]) => [tip, step(tip, l.F, [Math.sin(rad(t)), Math.cos(rad(t)), 0], len)])
  }
  // the FOOT: the stem from the ankle down to the ground, the toe forward
  // toward the viewer and the heel back, 60° off the stem each
  const foot = l => {
    const tip = l.pts[2]
    const ground = step(tip, l.F, [0, 1, 0], skel.foot)
    const toe = step(ground, l.F, [0, 0.5, S3], skel.toe)
    const heel = step(ground, l.F, [0, 0.5, -S3], skel.heel)
    return [[tip, ground], [ground, toe], [ground, heel]]
  }
  // the shoulders are the chest hexes' outer UPPER corners, the hips the base's lower ones
  const armLens = [skel.upperArm, skel.lowerArm, skel.finger]
  const legLens = [skel.upperLeg, skel.lowerLeg, skel.foot]
  const armsL = [limb(-(d / 2 + w), chestY - h, -1, pose.larm, JOINTS.arm, armLens), limb(d / 2 + w, chestY - h, 1, pose.rarm, JOINTS.arm, armLens)]
  const legsL = [limb(-w, baseY + h, -1, pose.lleg, JOINTS.leg, legLens), limb(w, baseY + h, 1, pose.rleg, JOINTS.leg, legLens)]
  const V = viewOf(yaw)
  const flat = p => [p[0] * V.side[0] + p[2] * V.side[2], p[1]]
  const arms = armsL.map(l => l.pts.map(flat))
  const legs = legsL.map(l => l.pts.map(flat))
  const hands = armsL.map(l => hand(l).map(s => s.map(flat)))
  const feet = legsL.map(l => foot(l).map(s => s.map(flat)))
  let top = -r
  let bottom = baseY + r
  let left = -(d / 2 + w) * Math.abs(V.side[0])
  let right = (d / 2 + w) * Math.abs(V.side[0])
  for (const [px, py] of [...arms.flat(), ...legs.flat(), ...hands.flat(2), ...feet.flat(2)]) {
    top = Math.min(top, py)
    bottom = Math.max(bottom, py)
    left = Math.min(left, px)
    right = Math.max(right, px)
  }
  const rig = { larm: armsL[0].rig, rarm: armsL[1].rig, lleg: legsL[0].rig, rleg: legsL[1].rig }
  return { head: [0, 0], chest: [[(-d / 2) * V.side[0], chestY], [(d / 2) * V.side[0], chestY]], hip: [0, hipY], base: [0, baseY], arms, legs, hands, feet, rig, top, bottom, left, right, mid: (top + bottom) / 2 }
}

// draw the figure with its head centred on (x, y). `body` is the body's own
// alpha (hexes and limbs) under the head's: at 0 the head alone draws, so a
// figure can grow its body in from the lone token the map shows. At a `yaw`
// the body's hexes, flat as paper, narrow toward their edge.
export function drawFigure(ctx, x, y, r, ink, surface, weight, pose, skel = SKELETON, alpha = 1, body = 1, yaw = 0) {
  const j = figureJoints(pose, skel, r, yaw)
  const w = r * S3 * viewOf(yaw).side[0]
  const h = r / 2
  const hex = (cx, cy) => {
    ctx.beginPath()
    ctx.moveTo(cx, cy - r)
    ctx.lineTo(cx + w, cy - h)
    ctx.lineTo(cx + w, cy + h)
    ctx.lineTo(cx, cy + r)
    ctx.lineTo(cx - w, cy + h)
    ctx.lineTo(cx - w, cy - h)
    ctx.closePath()
  }
  ctx.strokeStyle = ink
  ctx.fillStyle = surface
  ctx.lineWidth = weight
  ctx.lineJoin = "round"
  ctx.lineCap = "round"
  // the head: the cube's own look — outline at the weight, and inside it the
  // cube's three thin edges, centre to the upper corners and the foot
  const head = () => {
    ctx.globalAlpha = alpha
    hex(x, y)
    ctx.fill()
    ctx.stroke()
    ctx.lineWidth = weight * 0.2
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + w, y - h)
    ctx.moveTo(x, y)
    ctx.lineTo(x - w, y - h)
    ctx.moveTo(x, y)
    ctx.lineTo(x, y + r)
    ctx.stroke()
    ctx.lineWidth = weight
  }
  if (body <= 0.002) {
    head()
  } else {
    const limbs = () => {
      ctx.globalAlpha = alpha * body
      ctx.beginPath()
      for (const l of [...j.arms, ...j.legs]) {
        ctx.moveTo(x + l[0][0], y + l[0][1])
        ctx.lineTo(x + l[1][0], y + l[1][1])
        ctx.lineTo(x + l[2][0], y + l[2][1])
      }
      for (const [a, b] of [...j.hands.flat(), ...j.feet.flat()]) {
        ctx.moveTo(x + a[0], y + a[1])
        ctx.lineTo(x + b[0], y + b[1])
      }
      ctx.stroke()
    }
    const paper = () => {
      ctx.globalAlpha = alpha * body
      for (const [cx, cy] of [j.base, j.hip, ...j.chest]) {
        hex(x + cx, y + cy)
        ctx.fill()
        ctx.stroke()
      }
      head()
    }
    // the limbs draw OVER the paper, head included, unless the pose says
    // `under` — then they go down first and their roots tuck beneath it
    if (pose.under) {
      limbs()
      paper()
    } else {
      paper()
      limbs()
    }
  }
  ctx.lineWidth = weight
  ctx.globalAlpha = 1
}
