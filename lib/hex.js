// Cube-coordinate layer over the axial [q, r] representation used across the app.
//
// Storage stays axial (compact "q,r" keys); this module derives the third cube
// axis on demand and centralizes the hex math that benefits from cube form —
// distance, rotation, reflection, rings, lines, and pixel rounding. The grid and
// the (upcoming) per-tile pointy-top cube view both draw their math from here, so
// they can never disagree.
//
// Conventions: axial q = cube x, axial r = cube z, and the implied third axis
// s (= cube y) = -q - r. A hex is an axial pair [q, r]; cube form is [x, y, z]
// with the invariant x + y + z = 0.

import { DIRS } from "./world.js"

// ── axial ⇄ cube ─────────────────────────────────────
export const sAxis = ([q, r]) => -q - r // the implied third axis
export const toCube = ([q, r]) => [q, -q - r, r] // [x, y, z]
export const fromCube = ([x, , z]) => [x, z] // y is redundant (x + y + z = 0)

// ── vector ops (axial) ───────────────────────────────
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]]
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]]
export const scale = (a, k) => [a[0] * k, a[1] * k]
export const equals = (a, b) => a[0] === b[0] && a[1] === b[1]

// ── keys (match the app's "q,r" string form) ─────────
export const key = h => `${h[0]},${h[1]}`
export const fromKey = k => k.split(",").map(Number)

// ── neighbors (shared DIRS ordering, so dir indices agree app-wide) ──
export const neighbor = (h, dir) => [h[0] + DIRS[dir].q, h[1] + DIRS[dir].r]
export const neighbors = h => DIRS.map((_, d) => neighbor(h, d))

// ── distance ─────────────────────────────────────────
export const distance = (a, b) => {
  const dq = a[0] - b[0]
  const dr = a[1] - b[1]
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2
}
export const length = h => distance(h, [0, 0])

// ── rotation about a center (60° steps; cube permutation) ──
// One CW step:  [x,y,z] → [-z,-x,-y].  One CCW step: [x,y,z] → [-y,-z,-x].
export const rotateCW = h => {
  const [x, y, z] = toCube(h)
  return fromCube([-z, -x, -y])
}
export const rotateCCW = h => {
  const [x, y, z] = toCube(h)
  return fromCube([-y, -z, -x])
}
// Rotate by `steps` × 60° (positive = CW) about `center`.
export const rotate = (h, steps = 1, center = [0, 0]) => {
  const n = ((steps % 6) + 6) % 6
  let v = sub(h, center)
  for (let i = 0; i < n; i++) v = rotateCW(v)
  return add(v, center)
}

// ── reflection across each cube axis ─────────────────
export const reflectQ = h => fromCube(toCube(h).map((_, i, c) => [c[0], c[2], c[1]][i]))
export const reflectR = h => fromCube(toCube(h).map((_, i, c) => [c[1], c[0], c[2]][i]))
export const reflectS = h => fromCube(toCube(h).map((_, i, c) => [c[2], c[1], c[0]][i]))

// ── fractional axial → nearest hex (cube rounding) ───
export const round = (qf, rf) => {
  let x = qf
  let z = rf
  let y = -x - z
  let rx = Math.round(x)
  let ry = Math.round(y)
  let rz = Math.round(z)
  const dx = Math.abs(rx - x)
  const dy = Math.abs(ry - y)
  const dz = Math.abs(rz - z)
  if (dx > dy && dx > dz) rx = -ry - rz
  else if (dy > dz) ry = -rx - rz
  else rz = -rx - ry
  return [rx, rz]
}

// ── regions ──────────────────────────────────────────
// All hexes within `n` of `center` (filled disc).
export const range = (n, center = [0, 0]) => {
  const out = []
  for (let q = -n; q <= n; q++) {
    for (let r = Math.max(-n, -q - n); r <= Math.min(n, -q + n); r++) {
      out.push(add(center, [q, r]))
    }
  }
  return out
}

// The single ring of hexes exactly `radius` out from `center`.
export const ring = (center, radius) => {
  if (radius <= 0) return [center.slice()]
  const out = []
  let h = add(center, scale([DIRS[4].q, DIRS[4].r], radius)) // start on one corner
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      out.push(h)
      h = neighbor(h, side)
    }
  }
  return out
}

// ── line drawing (cube lerp + round) ─────────────────
const flt = (a, b, t) => a + (b - a) * t
export const line = (a, b) => {
  const n = distance(a, b)
  const [ax, , az] = toCube(a)
  const [bx, , bz] = toCube(b)
  const out = []
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n
    out.push(round(flt(ax, bx, t), flt(az, bz, t)))
  }
  return out
}
