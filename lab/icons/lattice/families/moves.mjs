import fs from "node:fs"
import * as L from "../lat.mjs"
export const family = "moves"
const HAND = JSON.parse(fs.readFileSync(new URL("../hand.json", import.meta.url)))

// ── helpers: triangles are (k, h) — strip k, row h; lattice vertices are (c, v) with c+v even ──
const range = (a, b) => { const o = []; for (let i = a; i <= b; i++) o.push(i); return o }
const odd = n => (((n % 2) + 2) % 2) === 1
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
// a ◆ bead straddling the vertical lattice line c at row h (◀ in strip c−1, ▶ in strip c)
const bead = (ic, c, h, on = true) => {
  if (!odd(c + h)) throw new Error(`bead parity ${c},${h}`)
  return ic.set([[c - 1, h], [c, h]], on)
}
const hex = (c, v, m) => {
  if (odd(c + v)) throw new Error(`hex parity ${c},${v}`)
  return L.lpoly([[c, v - 2 * m], [c + m, v - m], [c + m, v + m], [c, v + 2 * m], [c - m, v + m], [c - m, v - m]])
}
const hexRing = (c, v, m) => L.diff(hex(c, v, m), hex(c, v, m - 1))
const rhomb = (c, v, a) => L.lpoly([[c - a, v], [c, v - a], [c + a, v], [c, v + a]])
const halo = ic => { const o = L.icon(); for (const id of ic.on) for (const n of L.neighbours(L.TRIS.find(q => q.id === id))) o.on.add(n.id); return o }
const lay = (ic, top) => ic.sub(halo(top)).add(top) // put `top` over `ic`, a one-triangle gap around it
// a one-pen zigzag of 30° slopes, half-period 2 strips: strips c0..c1−1, crest vertices at vTop
const wave = (ic, c0, c1, vTop) => {
  for (let c = c0; c < c1; c += 4) {
    ds(ic, c, Math.min(c + 1, c1 - 1), vTop + 1, +1)
    if (c + 2 <= c1 - 1) ds(ic, c + 2, Math.min(c + 3, c1 - 1), vTop + 2, -1)
  }
  return ic
}
// the region a shape encloses: everything the outside can't reach (lid = extra triangles closing an open top)
const filled = (ic, lid) => {
  const wall = ic.clone(); if (lid) wall.add(lid)
  const out = new Set()
  const q = L.TRIS.filter(t => !wall.on.has(t.id) && L.neighbours(t).length < 3)
  q.forEach(t => out.add(t.id))
  while (q.length) {
    const t = q.pop()
    for (const n of L.neighbours(t)) if (!wall.on.has(n.id) && !out.has(n.id)) { out.add(n.id); q.push(n) }
  }
  const f = L.icon(); for (const t of L.TRIS) if (!out.has(t.id)) f.on.add(t.id)
  return f
}
const onlyRight = ic => { const o = L.icon(); for (const id of ic.on) if (L.TRIS.find(q => q.id === id).right) o.on.add(id); return o }
const rows = (ic, pred) => { const o = L.icon(); for (const id of ic.on) { const t = L.TRIS.find(q => q.id === id); if (pred(t.h, t.k)) o.on.add(id) } return o }

// ── the house: one construction at any size, so home and the way home are one place ──
// c0 centre line, vA the roof's outer apex, w half the wall span (walls in strips c0−w and c0+w−1),
// eaves one strip past the walls, floor = two zigzag rows from vF, door apex at dT,
// thatch = a sawtooth fringe, one triangle per strip along the roof's outer slopes (the eye's lashes)
const house = (c0, vA, w, vF, dT) => {
  const ic = L.icon()
  const e = w + 1
  ic.fill(L.lpoly([[c0 - e, vA + e], [c0, vA], [c0 + e, vA + e], [c0 + e, vA + e + 2], [c0, vA + 2], [c0 - e, vA + e + 2]]))
  vs(ic, c0 - w, vA + 2 + w, vF); vs(ic, c0 + w - 1, vA + 2 + w, vF)
  ic.set(range(c0 - w, c0 + w - 1).flatMap(k => [[k, vF], [k, vF + 1]]))
  ic.fill(L.lpoly([[c0 - 1, vF + 1], [c0 - 1, dT + 1], [c0, dT], [c0 + 1, dT + 1], [c0 + 1, vF + 1]]))
  for (let k = c0 - e + 1; k <= c0 - 1; k++) {
    const h = vA + c0 - k - 1
    ic.set([[k, h], [2 * c0 - 1 - k, h]])
  }
  return ic
}

// ── the footprint: walk's body, carried by cross ──
// a right print: a slanted forefoot (high at the big toe, low at the little toe), the inner edge
// bitten by a shallow 30° waist, a narrower heel; the toes a sawtooth fringe down the slant
const SOLE = [[0, -6], [1, -7], [5, -3], [5, 3], [3, 5], [1, 3], [1, 1], [2, 0], [2, -2], [0, -4]]
const TOES = [[0, -10], [0, -9], [1, -10], [1, -9], [2, -8], [3, -7], [4, -6]]
const sole = (dc = 0, dv = 0, flip = false) => L.lpoly(SOLE.map(([c, v]) => [(flip ? -c : c) + dc, v + dv]))
const toes = (dc = 0, dv = 0, flip = false) => {
  const ic = L.icon().set(TOES)
  if (flip) ic.mirrorX()
  return ic.shift(dc, dv)
}
// the same print at two-thirds size, for icons that carry it alongside other things
const MSOLE = [[0, -4], [1, -5], [4, -2], [4, 2], [3, 3], [1, 1], [1, -1], [0, -2]]
const MTOES = [[0, -7], [1, -7], [2, -6], [3, -5]]
const msole = (dc = 0, dv = 0, flip = false) => L.lpoly(MSOLE.map(([c, v]) => [(flip ? -c : c) + dc, v + dv]))
const mtoes = (dc = 0, dv = 0, flip = false) => {
  const ic = L.icon().set(MTOES)
  if (flip) ic.mirrorX()
  return ic.shift(dc, dv)
}
// the cube in three tones: paper lid inside a one-pen outline, solid left face, half-tone right face
// (◀ only, so its outer edge stays crisp and a paper zigzag parts it from the solid face); near-top corner (c, v)
const cube = (c, v, m, H) => {
  const left = L.lpoly([[c, v], [c - m, v - m], [c - m, v - m + H], [c, v + H]])
  const right = L.lpoly([[c, v], [c + m, v - m], [c + m, v - m + H], [c, v + H]])
  return L.icon().fill(left).texture(right, "left").fill(L.diff(rhomb(c, v - m, m), rhomb(c, v - m, m - 2)))
}
// one-pen chevrons 2m strips wide, centred on c = 0: ∨ with its arms' upper ends at vTop, ∧ with its apex at vTop
const vee = (ic, m, vTop) => { ds(ic, -m, -1, vTop + 1, +1); return ds(ic, 0, m - 1, vTop + m, -1) }
const hat = (ic, m, vTop) => { ds(ic, -m, -1, vTop + m, -1); return ds(ic, 0, m - 1, vTop + 1, +1) }
const chevDown = (ic, h0) => { ds(ic, -2, -1, h0, +1); return ds(ic, 0, 1, h0 + 1, -1) } // one-pen ∨, vertices h0−1..h0+3

export const icons = {
  home: {
    title: "home",
    concept: "a thatched hut: one-pen walls, eaves past them, a sawtooth thatch fringe like the eye's lashes, and the solid door at the centre where you sleep",
    draw() {
      return house(0, -10, 5, 8, 2)
    }
  },

  camp: {
    title: "camp",
    concept: "a tipi pitched anywhere: two thin sixty-degree poles crossed once in an X at the top, the lee panel in half-tone, home's own door, a peg at each foot",
    draw() {
      const vX = -5
      const p = L.icon()
      for (let k = -5; k <= 1; k++) { const top = vX - 3 * k - 3; p.set(range(top, top + 3).map(h => [k, h])) }
      p.symX()
      for (const d of [-3, -2, 2, 3]) p.set([[-1, vX + d], [0, vX + d]], false)
      const door = L.icon().set(range(7, 10).flatMap(h => [[-1, h], [0, h]]))
      const lee = L.icon().texture(L.lpoly([[0, vX + 3], [5, vX + 15], [0, vX + 15]]), "right").sub(halo(p)).sub(halo(door))
      return L.icon().add(p).add(lee).add(door).set([[-6, 10], [5, 10]])
    }
  },

  enter: {
    title: "enter",
    concept: "a beaded stem threads the tile's rim and points into the half-tone board inside it, at the solid tile inside that — tile → board → tile",
    draw() {
      const ic = L.icon().fill(hexRing(0, 2, 6)).texture(hexRing(0, 4, 3), "right").fill(hex(0, 4, 1))
      const ar = L.icon()
      for (let h = -11; h <= -3; h += 2) bead(ar, 0, h)
      chevDown(ar, -3)
      return lay(ic, ar)
    }
  },

  walk: {
    title: "walk",
    concept: "two bare prints a stride apart, slanted forefoot and sawtooth toes: the spent step greyed to half-tone, the step being paid solid",
    draw() {
      const lead = L.icon().fill(sole(0, -2)).add(toes(0, -2))
      const trail = L.icon().texture(sole(0, 6, true), "right").add(toes(0, 6, true))
      return lead.add(trail)
    }
  },

  leap: {
    title: "leap",
    concept: "the rule seen from above: you (solid) → one straight stroke slipping through the seam two half-tone neighbours share → the ring of the tile beyond; one step's price for two",
    draw() {
      const ic = L.icon().fill(hex(-5, 5, 2)).fill(hexRing(5, -5, 2))
      ic.texture(rhomb(-2, -3, 3), "left").texture(rhomb(1, 2, 3), "right") // their seam: c + v = −2 | 0
      return ds(ic, -3, 1, 1, -1) // the stroke fills the seam, from your corner to one strip short of the ring
    }
  },

  ford: {
    title: "ford",
    concept: "the hand-drawn travel boot wading: its pen solid above the waterline, half-tone below it",
    draw() {
      const boot = L.fromData(HAND.travel).shift(0, -2)
      const sil = filled(boot, L.icon().set([[2, -8], [3, -8], [2, -7], [3, -7]]))
      const ic = L.icon().add(rows(boot, h => h <= -2)).add(rows(onlyRight(sil), h => h > 1))
      lay(ic, wave(L.icon(), -6, 6, -2))
      return lay(ic, wave(L.icon(), -2, 2, 6))
    }
  },

  cross: {
    title: "cross",
    concept: "out of the river onto the next board: a bare print standing dry inside the far hex, the river lapping at its shore corner",
    draw() {
      const ic = L.icon().fill(hexRing(1, -1, 5))
      lay(ic, L.icon().fill(msole(-1, 1)).add(mtoes(-1, 1)))
      lay(ic, wave(L.icon(), -6, -1, 2))
      return lay(ic, wave(L.icon(), -6, 1, 6))
    }
  },

  "way home": {
    title: "way home",
    concept: "the reserved road back: paid-ahead steps from you to the door of the same thatched hut as home",
    draw() {
      const ic = house(2, -12, 3, -2, -6)
      for (const [c, h] of [[2, 1], [0, 3], [-1, 6]]) bead(ic, c, h)
      return ic.fill(hex(-4, 6, 2))
    }
  },

  drop: {
    title: "drop",
    concept: "a ∨ as wide as the cube brings it down; it sits on the ground, a sawtooth line hugging its foot",
    draw() {
      const ic = vee(L.icon(), 4, -10).add(cube(0, 6, 4, 6))
      // the ground: the band under the cube's foot, only its lower triangles, each touching the cube at a point
      const band = L.icon().fill(L.lpoly([[-6, 6], [0, 12], [6, 6], [6, 8], [0, 14], [-6, 8]]))
      for (const id of band.on) { const t = L.TRIS.find(q => q.id === id); if (t.right === (t.k >= 0)) ic.on.add(id) }
      return ic
    }
  },

  take: {
    title: "take",
    concept: "the same cube lifted under a ∧ as wide as it; a clear gap, and only its solid shadow stays on the ground",
    draw() {
      return hat(L.icon(), 4, -12).add(cube(0, 2, 4, 6)).fill(rhomb(0, 12, 2))
    }
  },

  eat: {
    title: "eat",
    concept: "meat on the bone with a bite out of its far end — the bone and its double knuckle keep it clear of every bitten disc",
    draw() {
      const meat = hex(-2, -4, 3)
      const ic = L.icon().fill(meat)
      ds(ic, 1, 3, 0, +1)
      ic.fill(hex(4, 4, 1)).fill(hex(5, 1, 1))
      const bite = hex(-5, -9, 2)
      ic.clear(bite)
      const gone = L.icon().fill(L.inter(meat, bite))
      for (const id of halo(gone).sub(gone).on) if (ic.on.has(id) && !L.TRIS.find(q => q.id === id).right) ic.on.delete(id)
      return ic
    }
  },

  rest: {
    title: "rest",
    concept: "the scout's eye, shut: one lid line, the lashes hanging below it",
    draw() {
      const ic = L.icon()
      ds(ic, -6, -1, -5, +1)
      for (const k of [-6, -4, -2]) { const h = k + 3; vs(ic, k, h, h + (k === -2 ? 3 : 2)) }
      return ic.symX()
    }
  }
}
