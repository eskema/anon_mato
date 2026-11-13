// FIGURE LAB — see figure.html. The live values are the pose (each joint's
// values, how open each hand is, `under`), the skeleton's lengths and the
// line weight; everything else is a way of playing them: pull a part on the
// stage or slide it in its card, keep poses in the gallery, pick two as A
// and B and let the loop run between them. The JSON goes out to the
// clipboard and comes back from it — nothing on the page holds it.
import { SKELETON, POSES, LIMBS, JOINTS, AXES, RANGE, FOLD, HAND_OPEN, kindOf, mixPose, figureJoints, drawFigure, jointTurn, turn, viewOf } from "../lib/figure.js"
import { KEYS } from "../lib/keys.js"
import { zoomAt } from "../lib/zoom.js"

const INK = "#1b1b1b"
const PAPER = "#f2f1ee"
const ACCENT = "#d84a3f"
const easeOutQuart = t => 1 - Math.pow(1 - t, 4)
const clone = o => JSON.parse(JSON.stringify(o))
const other = limb => (limb[0] === "l" ? "r" : "l") + limb.slice(1)
const wrap = a => ((((a + 180) % 360) + 360) % 360) - 180
const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v))
const deg = a => (a * 180) / Math.PI
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
const $ = id => document.getElementById(id)

// ── the state: what the JSON carries, and how the page stands ───────────
const state = {
  pose: clone(POSES.stand),
  skel: { ...SKELETON },
  weight: 0.1, // of the head's radius
  gallery: Object.entries(POSES).map(([name, pose]) => ({ name, pose: clone(pose) })),
  A: "stand", // the loop's two ends, by name in the gallery
  B: "sit",
  ms: 900,
  mirror: true,
  joints: true, // the dots
  paint: true, // the picked part in the accent
  mode: "build",
  side: false, // the stage seen from the figure's left side, not its front
  cam: null // the stage's camera, as the map's: { x, y, s } — the head-radii point at the stage's centre, and pixels per head radius
}
try {
  const saved = JSON.parse(localStorage.getItem(KEYS.labFigure) || "null")
  if (saved) {
    // an older pose shape (hinges with two values, or no gallery): what was kept is dropped
    if (saved.pose?.larm?.elbow?.length !== 1 || !Array.isArray(saved.gallery)) for (const k of ["pose", "A", "B", "gallery"]) delete saved[k]
    Object.assign(state, saved)
  }
  state.skel = { ...SKELETON, ...state.skel }
  for (const k of Object.keys(state.skel)) if (!(k in SKELETON)) delete state.skel[k] // lengths and ranges since dropped (the palm, the old ankle and wrist)
} catch {}
const save = () => {
  try {
    localStorage.setItem(KEYS.labFigure, JSON.stringify(state))
  } catch {}
}
let playing = false
// the camera starts on the standing figure's middle, a head radius 24px
if (!state.cam) state.cam = { x: 0, y: figureJoints(POSES.stand, SKELETON, 1).mid, s: 24 }
const ZOOM = [6, 240] // pixels per head radius, at the least and the most

// ── the parts ───────────────────────────────────────────────────────────
// A JOINT part turns, a BONE part is a length in the skeleton; the wrist
// carries the hand's spread too. Each part has a dot on the stage and the
// segment it paints: a joint's is the segment it turns.
const BONE = { upper: "upperArm", fore: "lowerArm", thigh: "upperLeg", shin: "lowerLeg", finger: "finger", thumb: "thumb", stem: "foot", toe: "toe", heel: "heel" }
const LONG = ["upperArm", "lowerArm", "upperLeg", "lowerLeg"]
const boneBounds = key => (LONG.includes(key) ? [0.5, 4] : [0, 2])
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
// a limb's parts laid on the figure `j`: { at, seg, start, scale } each
function partsOf(j, limb) {
  const i = limb[0] === "l" ? 0 : 1
  const kind = kindOf(limb)
  const pts = kind === "arm" ? j.arms[i] : j.legs[i]
  const [j1, j2, j3] = JOINTS[kind]
  const [b1, b2] = kind === "arm" ? ["upper", "fore"] : ["thigh", "shin"]
  const parts = {
    [j1]: { at: pts[0], seg: [[pts[0], pts[1]]] },
    [b1]: { at: mid(pts[0], pts[1]), seg: [[pts[0], pts[1]]], start: pts[0], scale: 2 },
    [j2]: { at: pts[1], seg: [[pts[1], pts[2]]] },
    [b2]: { at: mid(pts[1], pts[2]), seg: [[pts[1], pts[2]]], start: pts[1], scale: 2 }
  }
  if (kind === "arm") {
    const [finger, thumb] = j.hands[i] // each [wrist, tip]
    parts.wrist = { at: pts[2], seg: [finger, thumb] }
    parts.finger = { at: finger[1], seg: [finger], start: finger[0], scale: 1 }
    parts.thumb = { at: thumb[1], seg: [thumb], start: thumb[0], scale: 1 }
  } else {
    const [stem, toe, heel] = j.feet[i]
    parts.ankle = { at: pts[2], seg: [stem] }
    parts.stem = { at: stem[1], seg: [stem], start: stem[0], scale: 1 }
    parts.toe = { at: toe[1], seg: [toe], start: toe[0], scale: 1 }
    parts.heel = { at: heel[1], seg: [heel], start: heel[0], scale: 1 }
  }
  return parts
}
const isJoint = part => !!RANGE[part]
// a joint's rig on the figure `j`: where it is, the frame it turns in, the reach of what it turns
const rigOf = (j, limb, part) => j.rig[limb][JOINTS[kindOf(limb)].indexOf(part)]
const valsOf = (limb, part) => RANGE[part].map((_, i) => state.pose[limb][part]?.[i] ?? 0)
// the stage's view: its yaw, and a figure point (three dimensions) on the screen
const yaw = () => (state.side ? 90 : 0)
const view = () => viewOf(yaw())
const onScreen = p => [dot(p, view().side), p[1]]
// where a joint's NODE — the far end of what it turns — lands for values
// `v`: on the screen, and how far it leans toward the eye
const nodeAt = (rg, part, v) => {
  const a = jointTurn(rg.F, part, v).along
  const [sx, sy] = onScreen([rg.at[0] + a[0] * rg.R, rg.at[1] + a[1] * rg.R, rg.at[2] + a[2] * rg.R])
  return [sx, sy, dot(a, view().depth)]
}
// the pick: `hot` is under the pointer, `sel` was clicked — each { limb, part }
let hot = null
let sel = null
const same = (a, limb, part) => !!a && a.part === part && (a.limb === limb || (state.mirror && other(a.limb) === limb))

// ── the stage ───────────────────────────────────────────────────────────
const canvas = $("stage")
const ctx = canvas.getContext("2d")
let loopT0 = 0
let grab = null // what is being pulled
let pan = null // …or the stage being dragged: { last, moved }
let placed = null // where the figure last drew: { x, y, r, j }
let placeCard = true // the card is set beside the figure on the next frame
const HIT = 12 // a dot's grab radius, css px
const findPose = name => state.gallery.find(g => g.name === name)?.pose

function frame(now) {
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    placeCard = true
    layGallery()
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, w, h)
  // the loop: A → B on the quart ease, a beat, B → A the same, over and over
  let pose = state.pose
  const A = findPose(state.A)
  const B = findPose(state.B)
  if (playing && A && B) {
    const leg = state.ms
    const hold = leg * 0.4
    const cycle = 2 * (leg + hold)
    const t = (now - loopT0) % cycle
    let k
    if (t < leg) k = easeOutQuart(t / leg)
    else if (t < leg + hold) k = 1
    else if (t < 2 * leg + hold) k = 1 - easeOutQuart((t - leg - hold) / leg)
    else k = 0
    pose = mixPose(A, B, k)
  }
  // the figure through the camera: the head's centre where the camera puts it
  const r = state.cam.s
  const j = figureJoints(pose, state.skel, r, yaw())
  const x = w / 2 - state.cam.x * r
  const y = h / 2 - state.cam.y * r
  const weight = Math.max(1.5, r * state.weight)
  drawFigure(ctx, x, y, r, INK, PAPER, weight, pose, state.skel, 1, 1, yaw())
  placed = { x, y, r, j }
  if (placeCard) setCard()
  if (playing) return requestAnimationFrame(frame)
  // the picked part, painted over in the accent
  if (state.paint && sel) {
    ctx.strokeStyle = ACCENT
    ctx.lineWidth = weight
    ctx.lineCap = "round"
    ctx.beginPath()
    for (const limb of LIMBS) {
      if (!same(sel, limb, sel.part)) continue
      for (const [a, b] of partsOf(j, limb)[sel.part].seg) {
        ctx.moveTo(x + a[0], y + a[1])
        ctx.lineTo(x + b[0], y + b[1])
      }
    }
    ctx.stroke()
  }
  // the picked joint's reach, on the sphere its node travels
  if (sel && isJoint(sel.part)) drawReach(j, sel.limb, sel.part, x, y)
  // the dots: one per part, the hot one wide, the picked one filled
  if (state.joints) {
    ctx.lineWidth = 1
    for (const limb of LIMBS) {
      for (const [part, p] of Object.entries(partsOf(j, limb))) {
        const isSel = same(sel, limb, part)
        const isHot = same(hot, limb, part)
        ctx.strokeStyle = ctx.fillStyle = isSel || isHot ? ACCENT : INK
        ctx.globalAlpha = isSel || isHot ? 1 : 0.35
        ctx.beginPath()
        ctx.arc(x + p.at[0], y + p.at[1], isHot ? r * 0.2 : r * 0.12, 0, Math.PI * 2)
        if (isSel) ctx.fill()
        else ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
  }
  requestAnimationFrame(frame)
}

// THE REACH: the sphere the joint's node can travel, as a faint dashed
// circle — and on it, dashed, the path each of the joint's turns takes the
// node through its whole range, the other values held. The near half of a
// path draws strong, the far half faint, so the sphere reads in depth. The
// node itself gets a ring: pull it over the sphere.
function drawReach(j, limb, part, x, y) {
  const rg = rigOf(j, limb, part)
  const v = valsOf(limb, part)
  const [ax, ay] = onScreen(rg.at)
  const cx = x + ax
  const cy = y + ay
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.strokeStyle = INK
  ctx.globalAlpha = 0.25
  ctx.beginPath()
  ctx.arc(cx, cy, rg.R, 0, Math.PI * 2)
  ctx.stroke()
  // a path through one value's range: its points, then its near and far runs
  const path = axis => {
    const [lo, hi] = RANGE[part][axis]
    const pts = []
    for (let a = lo; a <= hi + 1e-9; a += Math.max(1, (hi - lo) / 90)) {
      const u = [...v]
      u[axis] = Math.min(a, hi)
      pts.push(nodeAt(rg, part, u))
    }
    let run = []
    let near = null
    let gone = 0 // the dash's place, carried from run to run
    const flush = () => {
      if (run.length < 2) return
      ctx.globalAlpha = near ? 1 : 0.3
      ctx.lineDashOffset = -gone
      ctx.beginPath()
      ctx.moveTo(x + run[0][0], y + run[0][1])
      for (let i = 1; i < run.length; i++) {
        ctx.lineTo(x + run[i][0], y + run[i][1])
        gone += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1])
      }
      ctx.stroke()
    }
    for (const p of pts) {
      const n = p[2] >= -1e-6
      if (near !== null && n !== near) {
        const last = run[run.length - 1]
        flush()
        run = [last]
      }
      near = n
      run.push(p)
    }
    flush()
    // the range's ends
    ctx.setLineDash([])
    for (const p of [pts[0], pts[pts.length - 1]]) {
      ctx.globalAlpha = p[2] >= -1e-6 ? 1 : 0.3
      ctx.beginPath()
      ctx.arc(x + p[0], y + p[1], 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.setLineDash([4, 4])
  }
  ctx.strokeStyle = ctx.fillStyle = ACCENT
  if (FOLD[part]) path(0)
  else {
    path(0)
    path(1)
  }
  ctx.setLineDash([])
  ctx.lineDashOffset = 0
  // the node's ring
  const n = nodeAt(rg, part, v)
  ctx.globalAlpha = 1
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(x + n[0], y + n[1], 6, 0, Math.PI * 2)
  ctx.stroke()
  ctx.globalAlpha = 1
}

// ── pulling ─────────────────────────────────────────────────────────────
// A JOINT is pulled by its node: the pointer's move carries the node over
// its sphere (on the half it is on, toward the eye or away — hold shift for
// the other), and the joint takes the values that put it there, held to its
// reach; a hinge's node keeps to its one fold. A BONE stretches to where the
// pointer stands along its line. Both work in either view.
const partAt = (mx, my) => {
  if (!placed || playing) return null
  // the picked joint's node ring first
  if (sel && isJoint(sel.part)) {
    for (const limb of LIMBS) {
      if (!same(sel, limb, sel.part)) continue
      const n = nodeAt(rigOf(placed.j, limb, sel.part), sel.part, valsOf(limb, sel.part))
      if (Math.hypot(placed.x + n[0] - mx, placed.y + n[1] - my) <= HIT) return { limb, part: sel.part, d: 0 }
    }
  }
  if (!state.joints) return null
  let best = null
  for (const limb of LIMBS)
    for (const [part, p] of Object.entries(partsOf(placed.j, limb))) {
      const d = Math.hypot(placed.x + p.at[0] - mx, placed.y + p.at[1] - my)
      if (d <= HIT && (!best || d < best.d)) best = { limb, part, d }
    }
  return best
}
const pointer = e => {
  const b = canvas.getBoundingClientRect()
  return [e.clientX - b.left, e.clientY - b.top]
}
// a ball joint's values that point its node along `w` (a unit vector), in range, nearest the current
function aim(rg, part, w, cur) {
  const a = dot(w, rg.F.out)
  const b = dot(w, rg.F.along)
  const c = dot(w, rg.F.toward)
  const y0 = deg(Math.asin(Math.max(-1, Math.min(1, c))))
  const x0 = deg(Math.atan2(a, b))
  let best = null
  for (const [cx, cy] of [[x0, y0], [wrap(x0 + 180), 180 - y0], [wrap(x0 + 180), -180 - y0]]) {
    const x = clamp(cx, RANGE[part][0])
    const y = clamp(cy, RANGE[part][1])
    const got = turn(rg.F, x, y).along
    const e = (got[0] - w[0]) ** 2 + (got[1] - w[1]) ** 2 + (got[2] - w[2]) ** 2 + 1e-5 * ((x - cur[0]) ** 2 + (y - cur[1]) ** 2)
    if (!best || e < best.e) best = { x, y, e }
  }
  return [Math.round(best.x), Math.round(best.y)]
}
// the wheel zooms about the pointer, as the map's does
canvas.addEventListener(
  "wheel",
  e => {
    e.preventDefault()
    const [mx, my] = pointer(e)
    state.cam = zoomAt(state.cam, { x: mx, y: my }, { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }, e.deltaY, ZOOM[0], ZOOM[1])
    placeCard = true
    save()
  },
  { passive: false }
)
canvas.addEventListener("pointerdown", e => {
  const [mx, my] = pointer(e)
  const g = partAt(mx, my)
  if (!g) {
    pan = { last: [mx, my], moved: false } // empty stage: drag to pan, a plain click clears the pick
    canvas.classList.add("grab")
    canvas.setPointerCapture(e.pointerId)
    return
  }
  grab = { limb: g.limb, part: g.part, from: [mx, my] }
  if (isJoint(g.part)) {
    const n = nodeAt(rigOf(placed.j, g.limb, g.part), g.part, valsOf(g.limb, g.part))
    grab.node = [n[0], n[1]] // where the node stood, in the figure's px
    grab.side = n[2] < -0.02 ? -1 : 1 // the half of the sphere it is on
  }
  if (!same(sel, g.limb, g.part) || sel.limb !== g.limb) pick({ limb: g.limb, part: g.part })
  canvas.classList.add("grab")
  canvas.setPointerCapture(e.pointerId)
})
canvas.addEventListener("pointermove", e => {
  const [mx, my] = pointer(e)
  if (pan) {
    const [lx, ly] = pan.last
    if (Math.hypot(mx - lx, my - ly) > 2) pan.moved = true
    state.cam.x -= (mx - lx) / state.cam.s
    state.cam.y -= (my - ly) / state.cam.s
    pan.last = [mx, my]
    placeCard = true
    return
  }
  if (!grab) {
    const near = partAt(mx, my)
    hot = near ? { limb: near.limb, part: near.part } : null
    canvas.classList.toggle("near", !!near)
    return
  }
  const { limb, part } = grab
  if (isJoint(part)) {
    const rg = rigOf(placed.j, limb, part)
    const tx = grab.node[0] + mx - grab.from[0] // where the node is pulled to, in the figure's px
    const ty = grab.node[1] + my - grab.from[1]
    const cur = valsOf(limb, part)
    if (FOLD[part]) {
      // a hinge: the bend whose node lands nearest
      let best = null
      const [lo, hi] = RANGE[part][0]
      for (let b = lo; b <= hi; b++) {
        const n = nodeAt(rg, part, [b])
        const d = (n[0] - tx) ** 2 + (n[1] - ty) ** 2 + 0.05 * (b - cur[0]) ** 2
        if (!best || d < best.d) best = { b, d }
      }
      setJoint(limb, part, 0, best.b)
    } else {
      const [cx, cy] = onScreen(rg.at)
      let vx = (tx - cx) / rg.R
      let vy = (ty - cy) / rg.R
      const d2 = vx * vx + vy * vy
      if (d2 > 1) {
        vx /= Math.sqrt(d2)
        vy /= Math.sqrt(d2)
      }
      const half = e.shiftKey ? -grab.side : grab.side
      const vz = half * Math.sqrt(Math.max(0, 1 - vx * vx - vy * vy))
      // the screen's right, down and toward the eye, back in the figure's own terms
      const V = view()
      const wv = [0, 1, 2].map(i => V.side[i] * vx + (i === 1 ? vy : 0) + V.depth[i] * vz)
      const [ax, ay] = aim(rg, part, wv, cur)
      setJoint(limb, part, 0, ax)
      setJoint(limb, part, 1, ay)
    }
  } else {
    const p = partsOf(placed.j, limb)[part]
    const key = BONE[part]
    const [a, b] = p.seg[0]
    const [sx, sy] = [placed.x + p.start[0], placed.y + p.start[1]]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    // along the bone's line where it has one; straight out from its start where it is still nothing
    const along = len > 0.5 ? ((mx - sx) * (b[0] - a[0]) + (my - sy) * (b[1] - a[1])) / len : Math.hypot(mx - sx, my - sy)
    const step = LONG.includes(key) ? 0.1 : 0.05
    state.skel[key] = +clamp(Math.round((along * p.scale) / placed.r / step) * step, boneBounds(key)).toFixed(2)
  }
  sync()
  save()
})
const release = () => {
  if (pan && !pan.moved) pick(null)
  if (pan) save()
  grab = null
  pan = null
  canvas.classList.remove("grab")
}
canvas.addEventListener("pointerup", release)
canvas.addEventListener("pointercancel", release)
canvas.addEventListener("pointerleave", () => {
  if (!grab) hot = null
})

// ── the card: the picked part's sliders, beside the figure ──────────────
const card = $("card")
let cardSync = [] // the open card's rows
const fmt = (v, step) => (step < 1 ? (+v).toFixed(2).replace(/\.?0+$/, "") : String(Math.round(+v)))
function cardRow(label, min, max, step, get, set) {
  const el = document.createElement("div")
  el.className = "row"
  const n = document.createElement("span")
  n.className = "n"
  n.textContent = label
  const input = document.createElement("input")
  input.type = "range"
  input.min = min
  input.max = max
  input.step = step
  const val = document.createElement("span")
  val.className = "v"
  el.append(n, input, val)
  card.append(el)
  cardSync.push(() => {
    input.value = get()
    val.textContent = fmt(get(), step)
  })
  input.addEventListener("input", () => {
    set(+input.value)
    sync()
    save()
  })
}
// a joint's value: `mirror` on, the other side of the body takes the same
const setJoint = (limb, jn, axis, v) => {
  for (const l of state.mirror ? [limb, other(limb)] : [limb]) {
    const vals = valsOf(l, jn)
    vals[axis] = clamp(v, RANGE[jn][axis])
    state.pose[l][jn] = vals
  }
}
const setOpen = (limb, v) => {
  state.pose[limb].open = v
  if (state.mirror) state.pose[other(limb)].open = v
}
// the card is filled for the pick, once; its rows read the state on sync
function fillCard() {
  card.replaceChildren()
  cardSync = []
  if (!sel) return
  const { limb, part } = sel
  const kind = kindOf(limb)
  const head = document.createElement("div")
  head.className = "head"
  const t = document.createElement("span")
  t.className = "t"
  // a bone's length is the skeleton's, both sides; a joint is a side's own unless mirrored
  t.textContent = isJoint(part) && !state.mirror ? `${limb[0] === "l" ? "left" : "right"} ${part}` : part
  head.append(t)
  if (isJoint(part) && !state.mirror) {
    const otherName = limb[0] === "l" ? "right" : "left"
    const take = document.createElement("button")
    take.className = "take"
    take.textContent = `← ${otherName} ${kind}`
    take.title = `take the ${otherName} ${kind}'s settings`
    take.addEventListener("click", () => {
      state.pose[limb] = clone(state.pose[other(limb)])
      sync()
      save()
    })
    head.append(take)
  }
  card.append(head)
  if (isJoint(part)) {
    AXES[part].forEach((label, i) => cardRow(label, RANGE[part][i][0], RANGE[part][i][1], 1, () => valsOf(limb, part)[i], v => setJoint(limb, part, i, v)))
    if (part === "wrist") cardRow("open", 0, 180, 1, () => state.pose[limb].open ?? HAND_OPEN, v => setOpen(limb, v))
  } else {
    const key = BONE[part]
    const [lo, hi] = boneBounds(key)
    cardRow("length", lo, hi, LONG.includes(key) ? 0.1 : 0.05, () => state.skel[key], v => (state.skel[key] = v))
  }
}
// the card beside the figure, level with the part: out past the figure on
// the part's own side, kept inside the stage, under the strip and over the
// gallery. Set when the pick, the camera or the stage changes — not while
// you slide, so it holds still under the pointer.
function setCard() {
  placeCard = false
  if (!sel || playing || !placed) {
    card.hidden = true
    return
  }
  card.hidden = false
  const p = partsOf(placed.j, sel.limb)[sel.part]
  const anchor = p.start || p.at
  const W = canvas.clientWidth
  const H = canvas.clientHeight
  const cw = card.offsetWidth
  const ch = card.offsetHeight
  const gap = 24
  const x = sel.limb[0] === "l" ? placed.x + placed.j.left - gap - cw : placed.x + placed.j.right + gap
  const y = placed.y + anchor[1] - ch / 2
  const top = $("strip").offsetHeight + 8
  const bottom = H - $("gallery").offsetHeight - ch - 8
  card.style.left = clamp(x, [8, Math.max(8, W - cw - 8)]) + "px"
  card.style.top = clamp(y, [top, Math.max(top, bottom)]) + "px"
}
function pick(p) {
  sel = p
  fillCard()
  sync()
  placeCard = true
}

// ── the gallery: the kept poses, each a little figure ───────────────────
const gallery = $("gallery")
const TILE = 76 // a tile's width, css px
const THUMB = 64 // its figure's square
let thumbs = [] // [canvas, pose] per tile, redrawn on sync
function drawThumb(c, pose) {
  const dpr = window.devicePixelRatio || 1
  c.width = THUMB * dpr
  c.height = THUMB * dpr
  const g = c.getContext("2d")
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.fillStyle = PAPER
  g.fillRect(0, 0, THUMB, THUMB)
  const j1 = figureJoints(pose, state.skel, 1)
  const r = Math.min((THUMB - 8) / (j1.bottom - j1.top), (THUMB - 8) / (j1.right - j1.left))
  drawFigure(g, THUMB / 2 - ((j1.left + j1.right) / 2) * r, THUMB / 2 - j1.mid * r, r, INK, PAPER, Math.max(1, r * state.weight), pose, state.skel, 1, 1)
}
function fillGallery() {
  gallery.replaceChildren()
  thumbs = []
  const animate = state.mode === "animate"
  for (const entry of state.gallery) {
    const tile = document.createElement("div")
    tile.className = "tile"
    tile.title = `load ${entry.name}`
    const c = document.createElement("canvas")
    const name = document.createElement("span")
    name.className = "name"
    name.textContent = entry.name
    const del = document.createElement("button")
    del.className = "del"
    del.textContent = "×"
    del.title = `delete ${entry.name}`
    del.addEventListener("click", e => {
      e.stopPropagation()
      state.gallery = state.gallery.filter(g => g !== entry)
      fillGallery()
      save()
    })
    tile.append(c, name, del)
    if (animate) {
      const abs = document.createElement("span")
      abs.className = "abs"
      for (const k of ["A", "B"]) {
        const b = document.createElement("button")
        b.textContent = k
        b.title = `make ${entry.name} the loop's ${k}`
        b.classList.toggle("on", state[k] === entry.name)
        b.addEventListener("click", e => {
          e.stopPropagation()
          state[k] = entry.name
          loopT0 = performance.now()
          fillGallery()
          save()
        })
        abs.append(b)
      }
      tile.append(abs)
    }
    tile.addEventListener("click", () => {
      state.pose = clone(entry.pose)
      setPlaying(false)
      sync()
      save()
    })
    gallery.append(tile)
    thumbs.push([c, entry.pose])
  }
  const add = document.createElement("button")
  add.className = "tile add"
  add.textContent = "+ save"
  add.title = "keep the pose on the stage, by a name"
  add.addEventListener("click", () => {
    const name = (window.prompt("name the pose") || "").trim()
    if (!name) return
    const kept = findPose(name)
    if (kept) state.gallery.find(g => g.name === name).pose = clone(state.pose)
    else state.gallery.push({ name, pose: clone(state.pose) })
    fillGallery()
    save()
    status(kept ? `${name} kept again` : `${name} kept`)
  })
  gallery.append(add)
  layGallery()
  drawThumbs()
  placeCard = true
}
// the tiles run along the stage's foot, in as many rows as the width needs
function layGallery() {
  const n = state.gallery.length + 1
  const cols = Math.max(1, Math.min(n, Math.floor(canvas.clientWidth / TILE)))
  gallery.style.gridTemplateColumns = `repeat(${cols}, ${TILE}px)`
}
const drawThumbs = () => thumbs.forEach(([c, pose]) => drawThumb(c, pose))

// ── the strip: build ────────────────────────────────────────────────────
const stripSync = []
const sync = () => {
  cardSync.forEach(f => f())
  stripSync.forEach(f => f())
  drawThumbs()
}
const bindCheck = (id, get, set) => {
  const el = $(id)
  el.addEventListener("change", () => {
    set(el.checked)
    sync()
    save()
  })
  stripSync.push(() => (el.checked = get()))
}
bindCheck("mirror", () => state.mirror, v => {
  state.mirror = v
  if (v) for (const kind of ["arm", "leg"]) state.pose["r" + kind] = clone(state.pose["l" + kind]) // the right follows the left
  fillCard() // the card's title and its take-the-other-side
})
bindCheck("under", () => !!state.pose.under, v => (state.pose.under = v))
bindCheck("joints", () => state.joints, v => {
  state.joints = v
  if (!v) pick(null)
})
bindCheck("paint", () => state.paint, v => (state.paint = v))
bindCheck("side", () => state.side, v => {
  state.side = v
  placeCard = true
})
{
  const el = $("weight")
  const val = $("weightv")
  el.addEventListener("input", () => {
    state.weight = +el.value
    sync()
    save()
  })
  stripSync.push(() => {
    el.value = state.weight
    val.textContent = fmt(state.weight, 0.01)
  })
}

// ── the modes ───────────────────────────────────────────────────────────
const setMode = mode => {
  state.mode = mode
  for (const b of document.querySelectorAll("#modes .atab")) b.classList.toggle("active", b.dataset.mode === mode)
  $("build").hidden = mode !== "build"
  $("animate").hidden = mode !== "animate"
  if (mode !== "animate") setPlaying(false)
  fillGallery() // the tiles carry A and B in animate
  placeCard = true // the strip changed width
  save()
}
for (const b of document.querySelectorAll("#modes .atab")) b.addEventListener("click", () => setMode(b.dataset.mode))

// ── the strip: animate ──────────────────────────────────────────────────
function setPlaying(on) {
  if (on && !(findPose(state.A) && findPose(state.B))) {
    status("pick A and B")
    on = false
  }
  playing = on
  if (on) loopT0 = performance.now()
  $("play").textContent = on ? "stop" : "play"
  placeCard = true // the card hides while the loop plays
}
$("play").addEventListener("click", () => setPlaying(!playing))
{
  const el = $("ms")
  el.value = state.ms
  el.addEventListener("change", () => {
    state.ms = +el.value
    save()
  })
}

// ── exchange: the JSON out to the clipboard, and back in from it ────────
const statusEl = $("status")
let statusT = 0
function status(s) {
  statusEl.textContent = s
  clearTimeout(statusT)
  statusT = setTimeout(() => (statusEl.textContent = ""), 1500)
}
const round = p => {
  const out = p.under ? { under: true } : {}
  for (const k of LIMBS) {
    out[k] = {}
    for (const jn of JOINTS[kindOf(k)]) out[k][jn] = RANGE[jn].map((_, i) => Math.round(p[k][jn]?.[i] ?? 0))
    if (kindOf(k) === "arm") out[k].open = Math.round(p[k].open ?? HAND_OPEN)
  }
  return out
}
const toJson = () =>
  JSON.stringify({ pose: round(state.pose), skel: state.skel, weight: state.weight, gallery: state.gallery.map(g => ({ name: g.name, pose: round(g.pose) })), A: state.A, B: state.B })
$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(toJson())
    status("copied")
  } catch {
    window.prompt("copy this", toJson())
  }
})
$("paste").addEventListener("click", async () => {
  let text = ""
  try {
    text = await navigator.clipboard.readText()
  } catch {
    text = window.prompt("paste JSON") || ""
  }
  try {
    const o = JSON.parse(text)
    if (o.pose) state.pose = o.pose
    if (o.skel) state.skel = { ...state.skel, ...o.skel }
    if (o.weight) state.weight = o.weight
    if (Array.isArray(o.gallery)) state.gallery = o.gallery
    if (typeof o.A === "string") state.A = o.A
    if (typeof o.B === "string") state.B = o.B
    fillGallery()
    sync()
    save()
    status("applied")
  } catch {
    status("not JSON")
  }
})

setMode(state.mode)
sync()
requestAnimationFrame(frame)
