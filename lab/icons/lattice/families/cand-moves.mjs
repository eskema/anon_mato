import * as L from "../lat.mjs"
export const family = "cand-moves"

// ── helpers: triangles are (k, h) — strip k, row h; lattice vertices are (c, v) with c+v even ──
const TRI = new Map(L.TRIS.map(t => [t.id, t]))
const range = (a, b) => { const o = []; for (let i = a; i <= b; i++) o.push(i); return o }
const odd = n => (((n % 2) + 2) % 2) === 1
const lp = pts => { for (const [c, v] of pts) if (odd(c + v)) throw new Error(`odd vertex ${c},${v}`); return L.lpoly(pts) }
const shape = s => L.icon().fill(s)
// vertical one-pen stroke: strip k, rows h0..h1
const vs = (ic, k, h0, h1, on = true) => ic.set(range(h0, h1).map(h => [k, h]), on)
// 30° one-pen stroke (rhombus chain), strips k0..k1, rows (h, h+1) at k0; dir +1 descends to the right
const ds = (ic, k0, k1, h0, dir, on = true) => {
  const par = (((k0 + h0) % 2) + 2) % 2
  if ((dir === 1 && par !== 1) || (dir === -1 && par !== 0)) throw new Error(`ds parity ${k0},${h0},${dir}`)
  const out = []
  for (let k = k0; k <= k1; k++) { const h = h0 + dir * (k - k0); out.push([k, h], [k, h + 1]) }
  return ic.set(out, on)
}
const hex = (c, v, m) => {
  if (odd(c + v)) throw new Error(`hex parity ${c},${v}`)
  return L.lpoly([[c, v - 2 * m], [c + m, v - m], [c + m, v + m], [c, v + 2 * m], [c - m, v + m], [c - m, v - m]])
}
const hexRing = (c, v, m) => L.diff(hex(c, v, m), hex(c, v, m - 1))
const halo = ic => { const o = L.icon(); for (const id of ic.on) for (const n of L.neighbours(TRI.get(id))) o.on.add(n.id); return o }
const lay = (ic, top) => ic.sub(halo(top)).add(top) // put `top` over `ic`, a one-triangle gap around it
// a one-pen zigzag of 30° slopes, half-period 2 strips: strips c0..c1−1, crest vertices at vTop
const wave = (ic, c0, c1, vTop) => {
  for (let c = c0; c < c1; c += 4) {
    ds(ic, c, Math.min(c + 1, c1 - 1), vTop + 1, +1)
    if (c + 2 <= c1 - 1) ds(ic, c + 2, Math.min(c + 3, c1 - 1), vTop + 2, -1)
  }
  return ic
}
// one-pen stroke along a lattice polyline (vertical or 30° runs), on the right (1) or left (−1) of travel
function pen(pts, side = 1) {
  for (const [c, v] of pts) if (odd(c + v)) throw new Error(`pen: odd vertex ${c},${v}`)
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
function teeth(pts, side = 1, every = 2, phase = 0) {
  for (const [c, v] of pts) if (odd(c + v)) throw new Error(`teeth: odd vertex ${c},${v}`)
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

// ── the house: home's own construction (c0 + vA, c0 + vF, c0 + dT all even) ──
// c0 centre line, vA the roof's outer apex, w half the wall span (walls in strips c0−w and c0+w−1),
// eaves one strip past the walls, floor = two zigzag rows from vF, door apex at dT,
// thatch = a sawtooth fringe, one triangle per strip along the roof's outer slopes
const house = (c0, vA, w, vF, dT) => {
  if (odd(c0 + vA) || odd(c0 + vF) || odd(c0 + dT)) throw new Error(`house parity ${c0},${vA},${vF},${dT}`)
  const ic = L.icon()
  const e = w + 1
  ic.fill(L.lpoly([[c0 - e, vA + e], [c0, vA], [c0 + e, vA + e], [c0 + e, vA + e + 2], [c0, vA + 2], [c0 - e, vA + e + 2]]))
  vs(ic, c0 - w, vA + 2 + w, vF); vs(ic, c0 + w - 1, vA + 2 + w, vF)
  ic.set(range(c0 - w, c0 + w - 1).flatMap(k => [[k, vF], [k, vF + 1]]))
  ic.fill(L.lpoly([[c0 - 1, vF + 1], [c0 - 1, dT + 1], [c0, dT], [c0 + 1, dT + 1], [c0 + 1, vF + 1]]))
  for (let k = c0 - e + 1; k <= c0 - 1; k++) { const h = vA + c0 - k - 1; ic.set([[k, h], [2 * c0 - 1 - k, h]]) }
  return ic
}

// ── the game's moon (sky's): the disc less the same disc slid s strips up the 30° line, the dark limb a sawtooth ──
const hexSteps = (r, c, v) => {
  const V = [[c, v - 2 * r], [c + r, v - r], [c + r, v + r], [c, v + 2 * r], [c - r, v + r], [c - r, v - r]]
  const pts = []
  for (let i = 0; i < 6; i++) { const [a, b] = [V[i], V[(i + 1) % 6]]; for (let j = 0; j < r; j++) pts.push([a[0] + ((b[0] - a[0]) * j) / r, a[1] + ((b[1] - a[1]) * j) / r]) }
  pts.push(V[0])
  return pts
}
const moon = (a, s, c, v) => {
  const lit = shape(L.diff(hex(c, v, a), hex(c + s, v - s, a)))
  const limb = teeth(hexSteps(a, c, v), 1, 1).sub(lit)
  for (const id of limb.on) if (!L.neighbours(TRI.get(id)).some(n => lit.on.has(n.id))) lit.on.add(id)
  return lit
}

// ── the bare print (right foot, big toe on the left); local (0, 0) = the top of the inner edge ──
// a slanted forefoot four strips wide, a one-strip arch bitten from the inner side, a round three-strip heel;
// the toes a sawtooth hung one row above the slant: the big toe a ◆, three small ones stepping down
const SOLE = [[0, 0], [4, 4], [4, 8], [3, 9], [3, 11], [1, 13], [0, 12], [0, 8], [1, 7], [1, 5], [0, 4]]
const TOES = [[-1, -3], [0, -3], [1, -1], [2, 0], [3, 1]]
const print = (dc, dv, flip = false) => {
  const ic = shape(lp(SOLE.map(([c, v]) => [(flip ? -c : c) + dc, v + dv])))
  return ic.set(TOES.map(([k, h]) => [(flip ? -k - 1 : k) + dc, h + dv]))
}

// ── forage's apple, its outer line, and the family leaf ──
const APPLE = [[0, -2], [-2, -4], [-5, -1], [-5, 5], [-1, 9], [0, 8], [1, 9], [5, 5], [5, -1], [2, -4]]
const leaf = (c, v) => lp([[c, v], [c + 2, v - 2], [c + 4, v], [c + 2, v + 2]])

export const icons = {
  walk: {
    title: "walk",
    concept: "two bare prints a stride apart, both paid in full: a slanted forefoot, the arch bitten from the inner side, a round heel, and the toes a sawtooth hung over each — the big toe a ◆",
    draw() {
      return print(1, -9).add(print(-1, -1, true))
    }
  },

  ford: {
    title: "ford",
    concept: "folk's figure wading the river chest-deep, no bridge: the solid hex head, the hex-arch shoulders in one pen, and the river's two ripples running clean across the chest",
    draw() {
      const ic = L.icon().fill(hex(0, -8, 2))
      ic.fill(pen([[-4, 6], [-4, 0], [0, -4], [4, 0], [4, 6]], -1))
      const w = L.icon(); wave(w, -6, 6, 2); wave(w, -6, 6, 6)
      return lay(ic, w)
    }
  },

  eat: {
    title: "eat",
    concept: "forage's apple, solid, with a bite out of its flank — the bite rimmed with meal's own tooth marks",
    draw() {
      const ic = shape(lp(APPLE))
      vs(ic, 0, -8, -2)
      ic.fill(leaf(1, -7))
      ic.clear(hex(6, 2, 3))
      return ic.add(teeth([[6, -4], [3, -1], [3, 5], [6, 8]], -1, 2, 1))
    }
  },

  rest: {
    title: "rest",
    concept: "the day ends at a resting place: home's own thatched hut, door shut, with the game's moon risen whole behind its shoulder — lit crescent solid, dark limb a faint sawtooth",
    draw() {
      // the crescent's lower tip, nicked by the hut's eave, is cut back to a clean point, and the one limb tooth
      // left stranded over the thatch goes, so the dark limb is the four teeth along the moon's upper edge
      return lay(moon(4, 3, -2, -2), house(3, -1, 3, 9, 5)).shift(0, -2).set([[-3, 3], [-2, 3], [1, -5]], false)
    }
  },

  leap: {
    title: "leap",
    concept: "you (solid) clear the corner in one stroke — a single hex arch, one step's price for a tile two away — and its arrowhead comes down into the tile beyond (outline)",
    draw() {
      const ic = L.icon().fill(hex(-4, 8, 2)).fill(hexRing(4, 8, 2))
      ic.fill(pen([[-4, 2], [-4, -2], [0, -6], [4, -2], [4, 0]], -1))
      ic.fill(lp([[2, 0], [4, 2], [6, 0], [6, 2], [4, 4], [2, 2]]))
      return ic.shift(0, -2)
    }
  }
}
