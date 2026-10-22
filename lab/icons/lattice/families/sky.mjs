// sky — body & time: the body's clocks and the sky's
import * as L from "../lat.mjs"
export const family = "sky"

// ── lattice helpers (lattice vertex coords [c, v], c + v even) ──
const even = (c, v) => ((c + v) % 2 + 2) % 2 === 0
export const lp = pts => {
  for (const [c, v] of pts) if (!even(c, v)) throw new Error(`odd vertex ${c},${v}`)
  return L.lpoly(pts)
}
export const U = L.union
export const D = L.diff
export const I = L.inter
const TRI = new Map(L.TRIS.map(t => [t.id, t]))
// pointy-top hexagon of apothem a (strips) round (c, v), and its one-pen ring
export const hexA = (a, c = 0, v = 0) => lp([[c, v - 2 * a], [c + a, v - a], [c + a, v + a], [c, v + 2 * a], [c - a, v + a], [c - a, v - a]])
export const hexRing = (a, c = 0, v = 0, w = 1) => D(hexA(a, c, v), hexA(a - w, c, v))
// ◆ two triangles sharing the vertical edge at c (c + v odd)
export const gem = (c, v) => L.lpoly([[c - 1, v], [c, v - 1], [c + 1, v], [c, v + 1]])
// filled strips: [[k, top row, bottom row], …]; sym mirrors each strip k onto −k−1
export const prof = rows => { const ic = L.icon(); for (const [k, a, b] of rows) for (let h = a; h <= b; h++) ic.set([[k, h]]); return ic }
export const sym = rows => prof(rows.flatMap(([k, a, b]) => [[k, a, b], [-k - 1, a, b]]))
export const keep = (ic, pred) => { const o = L.icon(); for (const id of ic.on) if (pred(TRI.get(id))) o.on.add(id); return o }
// rows above / below a row boundary (h ≤ r / h > r): the lattice's "horizontal" cut is a zigzag
export const above = (ic, r) => keep(ic, t => t.h <= r)
export const below = (ic, r) => keep(ic, t => t.h > r)
export const shape = (s, thr = 0.5) => L.icon().fill(s, thr)
// drop every triangle of a half-tone that shares an edge with the ink: the paper halo round a line
export function halo(tex, ink) {
  const o = L.icon()
  for (const id of tex.on) if (!L.neighbours(TRI.get(id)).some(n => ink.on.has(n.id))) o.on.add(id)
  return o
}
// the half-tone mirrored about the axis — ▶ on the left, ◀ on the right — like the mat's weave
export const weave = s => keep(shape(s), t => (t.k < 0 ? t.right : !t.right))
export const tone = (s, right = true) => keep(shape(s), t => t.right === right)
// a crescent: the disc less the same disc slid s strips along the up-right 30° line (the game's moon)
export const crescent = (a, s, c = 0, v = 0) => D(hexA(a, c, v), hexA(a, c + s, v - s))
// a vertical chain of gems on the line c, from v0 down to v1 (both odd − c): the book's fold
export const chain = (c, v0, v1) => { const ic = L.icon(); for (let v = v0; v <= v1; v += 2) ic.fill(gem(c, v)); return ic }

// one-pen stroke along a lattice polyline (vertical or 30° runs), on the right (1) or left (−1) of travel
export function pen(pts, side = 1) {
  for (const [c, v] of pts) if (!even(c, v)) throw new Error(`pen: odd vertex ${c},${v}`)
  const lines = []
  for (let i = 0; i < pts.length - 1; i++) {
    const [c0, v0] = pts[i], [c1, v1] = pts[i + 1]
    const dc = c1 - c0, dv = v1 - v0
    let ln, off
    if (dc === 0) { ln = [1, 0, c0]; off = 1 }
    else if (Math.abs(dc) === Math.abs(dv)) { ln = dc * dv > 0 ? [-1, 1, v0 - c0] : [1, 1, v0 + c0]; off = 2 }
    else throw new Error(`pen: bad segment ${c0},${v0} → ${c1},${v1}`)
    const dx = dc * L.SQ / 8, dy = dv / 16
    const nx = -dy * side, ny = dx * side
    const probe = [(c0 + c1) / 2 + (nx * 8) / L.SQ, (v0 + v1) / 2 + ny * 16]
    const val = ln[0] * probe[0] + ln[1] * probe[1] - ln[2]
    lines.push([ln[0], ln[1], ln[2] + Math.sign(val) * off])
  }
  const cross = (l1, l2) => {
    const det = l1[0] * l2[1] - l1[1] * l2[0]
    return [(l1[2] * l2[1] - l1[1] * l2[2]) / det, (l1[0] * l2[2] - l1[2] * l2[0]) / det]
  }
  const capPoint = (P, ln, other) => {
    for (const dir of other) {
      const l2 = dir === "v" ? [1, 0, P[0]] : dir === "a" ? [-1, 1, P[1] - P[0]] : [1, 1, P[1] + P[0]]
      if (Math.abs(ln[0] * l2[1] - ln[1] * l2[0]) > 1e-9) return cross(ln, l2)
    }
  }
  const n = lines.length
  const inner = [capPoint(pts[0], lines[0], lines[0][1] === 0 ? ["a", "b"] : ["v"])]
  for (let i = 0; i < n - 1; i++) inner.push(cross(lines[i], lines[i + 1]))
  inner.push(capPoint(pts[pts.length - 1], lines[n - 1], lines[n - 1][1] === 0 ? ["b", "a"] : ["v"]))
  return L.lpoly(pts.concat(inner.reverse()))
}

// sawtooth: single triangles on one side of a lattice polyline (1 right / −1 left of travel), every `every` edges
const EDGE = new Map()
for (const t of L.TRIS) for (let i = 0; i < 3; i++) {
  const key = [t.lv[i], t.lv[(i + 1) % 3]].map(p => p.join(",")).sort().join("|")
  if (!EDGE.has(key)) EDGE.set(key, [])
  EDGE.get(key).push(t)
}
export function teeth(pts, side = 1, every = 2, phase = 0) {
  for (const [c, v] of pts) if (!even(c, v)) throw new Error(`teeth: odd vertex ${c},${v}`)
  const ic = L.icon()
  let i = 0
  for (let s = 1; s < pts.length; s++) {
    const [c0, v0] = pts[s - 1], [c1, v1] = pts[s]
    const n = c1 === c0 ? Math.abs(v1 - v0) / 2 : Math.abs(c1 - c0)
    const sc = Math.sign(c1 - c0), sv = c1 === c0 ? 2 * Math.sign(v1 - v0) : Math.sign(v1 - v0)
    for (let j = 0; j < n; j++, i++) {
      if (((i + phase) % every + every) % every) continue
      const a = [c0 + j * sc, v0 + j * sv], b = [c0 + (j + 1) * sc, v0 + (j + 1) * sv]
      const A = L.V(...a), B = L.V(...b)
      for (const t of EDGE.get([a, b].map(p => p.join(",")).sort().join("|")) || []) {
        const cr = (B[0] - A[0]) * (t.cy - A[1]) - (B[1] - A[1]) * (t.cx - A[0])
        if (Math.sign(cr) === side) ic.on.add(t.id)
      }
    }
  }
  return ic
}

// the hex path of apothem r, clockwise from the top vertex, in unit steps (6r of them);
// hexArc lays a one-pen stroke just inside it over step ranges [[s0, s1], …] — dashes, arcs
export function hexSteps(r, c = 0, v = 0) {
  const V = [[c, v - 2 * r], [c + r, v - r], [c + r, v + r], [c, v + 2 * r], [c - r, v + r], [c - r, v - r]]
  const pts = []
  for (let i = 0; i < 6; i++) {
    const [a, b] = [V[i], V[(i + 1) % 6]]
    for (let j = 0; j < r; j++) pts.push([a[0] + ((b[0] - a[0]) * j) / r, a[1] + ((b[1] - a[1]) * j) / r])
  }
  return pts
}
export const hexPath = (r, s0, s1, c = 0, v = 0) => {
  const P = hexSteps(r, c, v), N = P.length, out = []
  for (let s = s0; s <= s1; s++) out.push(P[((s % N) + N) % N])
  return out
}
const corners = pts => {
  const poly = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const d1 = [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]], d2 = [pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]]
    if (d1[0] !== d2[0] || d1[1] !== d2[1]) poly.push(pts[i])
  }
  poly.push(pts[pts.length - 1])
  return poly
}
export function hexArc(r, ranges, c = 0, v = 0) {
  const ic = L.icon()
  for (const [s0, s1] of ranges) ic.fill(pen(corners(hexPath(r, s0, s1, c, v)), 1))
  return ic
}

// ── shared marks ──
const row = (h, k0, k1) => { const r = []; for (let k = k0; k <= k1; k++) r.push([k, h, h]); return r }
// forage's fruit, exactly: the lattice apple's inner line, its stem (strip 0, rows −8..−2) and its one diamond leaf
const FRUIT_IN = [[0, 0], [-2, -2], [-4, 0], [-4, 4], [-1, 7], [0, 6], [1, 7], [4, 4], [4, 0], [2, -2]]
const FRUIT_LEAF = [[1, -7], [3, -9], [5, -7], [3, -5]]
// its outer line in two halves, both clockwise: the left (flesh) side and the right (rotting) side
const FRUIT_L = [[0, 8], [-1, 9], [-5, 5], [-5, -1], [-2, -4], [0, -2]]
const FRUIT_R = [[0, -2], [2, -4], [5, -1], [5, 5], [1, 9], [0, 8]]
// a ray: a lozenge on the axis, rows a..b (both odd: pointed at both ends), turned to the n-th vertex
const ray = (a, b, n = 0) => prof([[-1, a, b], [0, a, b]]).rot60(n)
// a solid arrowhead: vertical back edge at c (v ± s), point s strips to the right (dir 1) or left (−1) — menu/reset's
const tri = (c, v, s, dir = 1) => lp([[c, v - s], [c, v + s], [c + dir * s, v]])
// the field's stubble: three stalks cut on one slant (each top a ◀), strips −4, −1, 2
const STUBBLE = [[-4, -2], [-1, -7], [2, -4]]
// an iso box: top vertex (c, t), apothem a, vertical edges h long (2a for a cube)
function faces(t, a, h = 2 * a, c = 0) {
  const T = [c, t], R = [c + a, t + a], M = [c, t + 2 * a], W = [c - a, t + a]
  const B = [c, t + 2 * a + h], BL = [c - a, t + a + h], BR = [c + a, t + a + h]
  return { T, R, M, W, B, BL, BR, top: lp([T, R, M, W]), left: lp([W, M, B, BL]), right: lp([M, R, BR, B]), sil: lp([T, R, BR, B, BL, W]) }
}
// the moon: the disc less the same disc slid along the sun's line; the dark limb a sawtooth
function moonDisc(a, s) {
  const lit = shape(crescent(a, s))
  const limb = teeth(hexPath(a, 0, 6 * a), 1, 1).sub(lit)
  return lit.add(halo(limb, lit))
}
// a steep straight edge (30° off the vertical) from the tip (c, v) down n strips, as the lattice draws it:
// one 30° step and one vertical step per strip, the inner corners on the true line
const steep = (c, v, n) => {
  const pts = [[c, v]]
  for (let i = 0; i < n; i++) pts.push([c + i + 1, v + 3 * i + 1], [c + i + 1, v + 3 * i + 3])
  return pts
}
// a right half-outline [tip … bottom] and its mirror, as one closed polygon
const mirror = half => half.concat(half.slice(1, -1).reverse().map(([c, v]) => [-c, v]))

export const icons = {
  meal: {
    title: "meal clock",
    concept: "the day dial with a bite taken out of it, tooth marks and all, its one hand pointing into the hours you ate: hunger is a clock, and every bite winds it on",
    draw() {
      const edge = [[3, -9], [3, -3], [6, 0]]
      const ic = shape(D(hexRing(6), hexA(3, 6, -6)))
      ic.fill(pen(edge, 1)).add(teeth(edge, -1, 2, 1))
      return ic.fill(hexA(1)).add(ray(-5, -1, 1))
    }
  },
  bed: {
    title: "bed due",
    concept: "the sleeping mat still rolled: a fat iso roll whose end shows its turns as a one-pen ring round a solid core, and only a short strip laid out in front of it, weave and tassels — the bed is due, waiting to be unrolled",
    draw() {
      const c0 = 4, v0 = 0, R = 3, Ln = 4, d = 4
      const T = [c0, v0 - 2 * R], TL = [c0 - R, v0 - R], BL = [c0 - R, v0 + R]
      const along = ([c, v]) => [c - Ln, v - Ln] // up the roll's axis
      const out = ([c, v]) => [c - d, v + d] // unrolled toward the viewer
      // the strip laid out: its front edge one pen, tassels off it
      const hem = [out(along(BL)), out(BL)]
      const ic = L.icon().fill(pen(hem, 1)).add(teeth(hem, -1, 1))
      // the roll: a paper body in one pen, its end the ring and core
      ic.fill(pen([T, along(T), along(TL), along(BL)], -1)).fill(pen([BL, along(BL)], 1))
      ic.clear(hexA(R, c0, v0)).fill(hexRing(R, c0, v0)).fill(hexA(1, c0, v0))
      // the strip's weave, held off every line by a paper halo
      const body = shape(lp([T, along(T), along(TL), along(BL), BL, TL]))
      return ic.add(halo(weave(lp([BL, along(BL), out(along(BL)), out(BL)])).sub(body), ic.clone()))
    }
  },
  thirst: {
    title: "thirst",
    concept: "a drop drawn at full height and run nearly dry: straight steep sides from the tip into a hex bulb, one pen, empty — the thirst — and a sawtooth puddle in its chin, all the water left",
    draw() {
      const out = lp(mirror([...steep(0, -12, 4), [5, 1], [5, 5], [0, 10]]))
      const inn = lp(mirror([...steep(0, -8, 4), [0, 8]]))
      return shape(D(out, inn)).add(keep(shape(inn), t => t.h >= 6 || (t.h === 5 && t.right === t.k >= 0)))
    }
  },
  health: {
    title: "health",
    concept: "the heart is the player's cube with a dent in its top: the cube's three spokes, drawn in paper, part it into three equal half-tone chambers — food, sleep, water — round heal's solid hex",
    draw() {
      const HEART = [[-6, -6], [-3, -9], [0, -6], [3, -9], [6, -6], [6, 4], [0, 10], [-6, 4]]
      const IN = [[-5, -5], [-3, -7], [0, -4], [3, -7], [5, -5], [5, 3], [0, 8], [-5, 3]]
      const ink = shape(D(lp(HEART), lp(IN)))
      // menu/cube's spokes (each one pen on the clockwise side of its axis, so the faces come out equal),
      // drawn here in paper: a seam through the half-tone, so the heart reads first and the cube second
      const s = shape(lp([[0, 0], [0, -12], [1, -11], [1, -1]]))
      const Y = keep(s.clone().rot60(1).add(s.clone().rot60(3)).add(s.clone().rot60(5)), t => L.coverage(lp(IN), t) > 0.5)
      const core = shape(hexA(1))
      return ink.add(halo(weave(lp(IN)).sub(Y), Y.clone().add(core))).add(core)
    }
  },
  load: {
    title: "load",
    concept: "folk's figure leaning into the road: the solid hex head, the shoulders' arch drawn out behind into a 30° back with the arm hanging in front, the three-tone box riding the back, the legs mid-stride on the ground line — the weight you carry, paid for in every step",
    draw() {
      const ic = L.icon().fill(hexA(2, -4, -6))
      const f = faces(-8, 3, 4, 2)
      ic.fill(f.left).add(tone(f.right)).fill(pen([f.W, f.T, f.R], 1))
      ic.fill(pen([[-4, -2], [2, 4]], 1)).fill(pen([[-4, -2], [-6, 0], [-6, 4]], -1))
      ic.fill(pen([[2, 4], [0, 6], [0, 10]], 1)).fill(pen([[2, 4], [2, 8], [4, 10]], -1))
      return ic.add(prof(row(11, -3, 5)))
    }
  },
  regrow: {
    title: "regrow",
    concept: "the hand's tend sprout, solid and two-leaved, risen tall out of bare's stubble, inside the regrow ring as it closes clockwise onto reset's own arrowhead",
    draw() {
      const ic = hexArc(6, [[6, 36]], 0, 2).fill(tri(0, -10, 4, 1))
      // bare's outer stalks cut short; its middle stalk the sprout's stem
      ic.add(prof([[-4, 4, 7], [2, 4, 7], [-1, 1, 7]]))
      ic.fill(lp([[0, 2], [2, 0], [2, -4], [0, -2]])).fill(lp([[-1, 1], [-3, -1], [-3, -5], [-1, -3]]))
      return ic.add(prof(row(8, -4, 3)))
    }
  },
  bare: {
    title: "bare",
    concept: "three stalks cut on one slant, standing on bare ground and nothing round them — spent, nothing coming back for days",
    draw() {
      return prof(STUBBLE.map(([k, top]) => [k, top, 3])).add(prof([...row(4, -6, 5), ...row(5, -6, 5)]))
    }
  },
  spoil: {
    title: "spoil",
    concept: "forage's own fruit coming apart along the hand's three tones — solid flesh, half-tone rot, then a rim gone to mould and dust lifting off — the shelf clock run out",
    draw() {
      const ic = L.icon().fill(pen(FRUIT_L, 1)).add(teeth(FRUIT_R, -1, 1))
      ic.add(keep(shape(lp(FRUIT_IN)), t => t.k <= -2))
      ic.add(keep(shape(lp(FRUIT_IN)), t => t.k >= -1 && t.k <= 1 && t.right))
      ic.set([[2, 4], [3, 3], [4, 2]])
      return ic.add(prof([[0, -8, -2]])).fill(lp(FRUIT_LEAF))
    }
  },
  sun: {
    title: "sun",
    concept: "the whole disc at full height: one solid hex, a ray off each of its six corners, no horizon and nothing of the night left in it",
    draw() {
      const ic = shape(hexA(3))
      for (let n = 0; n < 6; n++) ic.add(ray(-13, -9, n))
      return ic
    }
  },
  moon: {
    title: "moon",
    concept: "the game's own moon: the disc carved by the same disc slid along the sun's line — a tapered crescent lit, the dark limb a faint sawtooth",
    draw() {
      return moonDisc(5, 3)
    }
  },
  night: {
    title: "night",
    concept: "the black veil let down over the top of the tile, tasselled at its hem, the world's lower edges showing under it; three stars in a short rising belt, one bright and two faint, are holes in the cloth",
    draw() {
      const ic = above(shape(hexA(6)), 1)
      const hem = []
      for (let c = -6; c <= 6; c++) hem.push([c, c % 2 ? 1 : 2])
      ic.add(teeth(hem, -1, 2))
      ic.fill(pen([[-6, 8], [0, 14], [6, 8]], -1))
      // a short belt rising across the cloth: one star, a faint one either side
      return ic.clear(hexA(1, -1, -5)).clear(gem(-4, -3)).clear(gem(2, -7))
    }
  },
  dawn: {
    title: "dawn",
    concept: "the sun breaking the line: the top of its disc risen solid into the day and set into the horizon, three of the sun's own rays fanned above, the land under the line still in night's half-tone — reaching daylight is itself a milestone",
    draw() {
      const vh = 4
      const ic = above(shape(L.circle(0, vh / 16, 0.45)), vh - 1).add(prof(row(vh, -6, 5)))
      ic.add(ray(-13, -9, 0).add(ray(-13, -9, 1)).add(ray(-13, -9, 5)).shift(0, vh))
      return ic.add(keep(tone(hexA(7)), t => t.h >= vh + 2 && t.h <= vh + 5))
    }
  },
  year: {
    title: "year",
    concept: "360 in the hand's own lettering — the days of the year and the degrees of one full turn, the game's loop in one mark — its 0 the sun's sign, a ring round a solid core",
    draw() {
      const ic = L.icon()
      ic.fill(pen([[-7, -9], [-4, -6], [-4, 6], [-7, 9]], 1)).fill(pen([[-7, -1], [-5, 1]], 1))
      ic.fill(hexRing(2, -1, 7)).fill(pen([[-3, 5], [-3, -11], [-1, -13]], 1))
      ic.fill(D(lp([[5, -11], [8, -8], [8, 8], [5, 11], [2, 8], [2, -8]]), lp([[5, -9], [7, -7], [7, 7], [5, 9], [3, 7], [3, -7]])))
      return ic.add(prof([[4, -2, 2], [5, -2, 2]]))
    }
  },
  season: {
    title: "season",
    concept: "one tree across the year, its crown split on the tilt of the sun's line, vertex to vertex: the upper half in leaf, the lower half bare forks — the season is the angle",
    draw() {
      const ic = shape(hexRing(5, 0, -2))
      // the bare half: the trunk and one branch, forking twice, every stroke one pen on a lattice line
      const wood = L.icon().fill(pen([[0, 12], [0, 0]], -1))
      wood.fill(pen([[0, 4], [2, 2], [2, -2]], -1)).fill(pen([[2, 2], [3, 1]], -1))
      // the leaf half: the upper-left trapezoid, cut on the crown's upper-right to lower-left diagonal
      ic.add(halo(tone(I(hexA(4, 0, -2), lp([[0, -12], [5, -7], [-5, 3], [-5, -7]]))), wood)).add(wood)
      return ic.set([[-2, 10], [0, 11]])
    }
  }
}
