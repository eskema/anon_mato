// works — builds & the tech tree
import fs from "node:fs"
import * as L from "../lat.mjs"
export const family = "works"

// ── lattice helpers (vertex coords [c, v], c + v even; x = c·0.108, y = v/16) ──
const lp = pts => {
  for (const [c, v] of pts) if ((((c + v) % 2) + 2) % 2 !== 0) throw new Error(`odd vertex ${c},${v}`)
  return L.lpoly(pts)
}
const hexA = (a, c = 0, v = 0) => lp([[c, v - 2 * a], [c + a, v - a], [c + a, v + a], [c, v + 2 * a], [c - a, v + a], [c - a, v - a]])
const hexRing = (a, c = 0, v = 0, w = 1) => L.diff(hexA(a, c, v), hexA(a - w, c, v))
// flat iso mat (rhombus) of half-width r around (c, v)
const mat = (r, c = 0, v = 0) => lp([[c - r, v], [c, v - r], [c + r, v], [c, v + r]])
// vertical one-pen bar: strip c..c+1 from v0 (top) to v1 (bottom); tt / bb slope of the end cuts
const vbar = (c, v0, v1, tt = 1, bb = -1, w = 1) => lp([[c, v0], [c + w, v0 + tt * w], [c + w, v1 + bb * w], [c, v1]])
// 30° one-pen stroke from (c0, v0) to (c1, v1), t v-units tall (hangs below the line)
const dband = (c0, v0, c1, v1, t = 2) => {
  if (Math.abs(c1 - c0) !== Math.abs(v1 - v0)) throw new Error(`not 30°: ${c0},${v0} → ${c1},${v1}`)
  return lp([[c0, v0], [c1, v1], [c1, v1 + t], [c0, v0 + t]])
}
// iso box: lowest front vertex F, a steps up-right, b steps up-left, height h (v units)
function box(F, a, b, h) {
  const [c, v] = F
  const R = [c + a, v - a], Lf = [c - b, v - b]
  return {
    right: lp([F, R, [R[0], R[1] - h], [c, v - h]]),
    left: lp([F, Lf, [Lf[0], Lf[1] - h], [c, v - h]]),
    top: lp([[c, v - h], [R[0], R[1] - h], [R[0] - b, R[1] - b - h], [Lf[0], Lf[1] - h]]),
  }
}
// small iso cube in a hex of apothem r around (c, v): three faces
const cube = (r, c = 0, v = 0) => ({
  top: lp([[c, v - 2 * r], [c + r, v - r], [c, v], [c - r, v - r]]),
  left: lp([[c - r, v - r], [c, v], [c, v + 2 * r], [c - r, v + r]]),
  right: lp([[c, v], [c + r, v - r], [c + r, v + r], [c, v + 2 * r]]),
})
const spin = (one, n = 6) => { const out = one.clone(); for (let i = 1; i < n; i++) out.add(one.clone().rot60(i)); return out }
// paint columns: { k: [[h0, h1], …] }
const cols = (ic, spec, on = true) => { for (const [k, rs] of Object.entries(spec)) for (const [a, b] of rs) for (let h = a; h <= b; h++) ic.set([[+k, h]], on); return ic }
const par = (k, h) => ((((k + h) % 2) + 2) % 2 === 1) // ▶ when true
// ◆ on the vertical edge c at row h (c + h odd): ◀ in strip c−1 + ▶ in strip c
const dia = (ic, c, h, on = true) => {
  if (!par(c, h)) throw new Error(`◆ parity ${c},${h}`)
  return ic.set([[c - 1, h], [c, h]], on)
}
// the builds' shared ground: the near two edges of the tile, one pen, apex at rows 11–12
const ground = () => lp([[-6, 4], [0, 10], [6, 4], [6, 6], [0, 12], [-6, 6]])

// loose polygon in lattice coords (no parity check) — regions to clear or texture
const pp = pts => L.poly(pts.map(([c, v]) => L.V(c, v)))
// fill a block of whole triangles: strips k0..k1, rows h0..h1
const rows = (ic, k0, k1, h0, h1, on = true) => { for (let k = k0; k <= k1; k++) for (let h = h0; h <= h1; h++) ic.set([[k, h]], on); return ic }
// lay a one-pen ring as stones: a single-triangle gap every n triangles along it
const stones = (shape, n = 4, off = 0) => {
  const ic = L.icon().fill(shape)
  for (const id of [...ic.on]) {
    const t = L.TRIS.find(q => q.id === id)
    if ((((2 * t.k + (t.right ? 0 : 1) + off) % n) + n) % n === 0) ic.on.delete(id)
  }
  return ic
}
// a closed book lying flat: spine on the left face, page edge (sawtooth) on the right face
function book(ic, F, a, b, h, { spine = "solid", top = null } = {}) {
  const q = box(F, a, b, h)
  ic.clear(q.left).clear(q.right).clear(q.top)
  const tone = (shape, t) => {
    if (t === "solid") ic.fill(shape)
    else if (t === "half") ic.texture(shape, "right")
    else if (t === "outline") ic.add(L.icon().fill(shape).outline())
  }
  tone(q.left, spine)
  ic.texture(q.right, "left")
  tone(q.top, top)
  return ic
}

const HAND = JSON.parse(fs.readFileSync(new URL("../hand.json", import.meta.url)))
// quarry's fish, smaller: a ◆ body of half-width a centred (c, v), head left, and the forked tail — two one-pen
// arms opening off the body's back point
const fish = (a, c, v) => L.icon().fill(mat(a, c, v))
  .fill(lp([[c + a - 2, v], [c + a + 2, v - 4], [c + a + 2, v + 4]]))
  .clear(lp([[c + a + 2, v - 2], [c + a, v], [c + a + 2, v + 2]]))
// keep only the ▶ of an icon (its half-tone ghost)
const halftone = ic => { const o = L.icon(); for (const id of ic.on) if (L.TRIS.find(t => t.id === id).right) o.on.add(id); return o }

export const icons = {
  // ── builds ─────────────────────────────────────────
  bridge: {
    title: "bridge",
    concept: "one arch leaps from bank to bank — the two tiles you chose — with the river running under it",
    draw() {
      const ic = L.icon()
      rows(ic, -7, -6, 3, 8)
      rows(ic, 5, 6, 3, 8)
      ic.fill(lp([[-5, 3], [0, -2], [5, 3], [5, 5], [0, 0], [-5, 5]]))
      ic.texture(pp([[-5, 6.5], [5, 6.5], [5, 12.5], [-5, 12.5]]), "right")
      return ic
    },
  },
  road: {
    title: "road",
    concept: "a paved strip laid flat across the tile: grey flagstones between two solid kerbs, its centre line left bare — the river turned inside out",
    draw() {
      // a +30° band across the tile, cut on verticals at c = ±6 and kept a strip inside the hex
      const tile = L.inter(hexA(7), pp([[-6, -20], [6, -20], [6, 20], [-6, 20]]))
      const band = (b0, b1) => L.inter(tile, pp([[-9, 9 + b0], [9, -9 + b0], [9, -9 + b1], [-9, 9 + b1]]))
      const ic = L.icon().fill(band(-4, -2)).fill(band(2, 4))
      ic.texture(band(-2, 2), "right")
      for (const c0 of [-4, 0, 4]) ic.clear(pp([[c0 - 1, -c0], [c0 + 1, -c0 - 2], [c0 + 1, -c0], [c0 - 1, -c0 + 2]]))
      return ic
    },
  },
  hearth: {
    title: "hearth",
    concept: "a ring of laid stones on the tile with a three-tongued fire standing in it — every resting place keeps one",
    draw() {
      const ic = stones(L.diff(mat(7, 0, 5), mat(5, 0, 5)), 4, 0)
      ic.clear(pp([[-4.5, 3], [-4.5, -4], [-1, -13], [0, -13], [3.5, -8], [3.5, 3], [0, 6.5]]))
      cols(ic, { "-4": [[0, 3]], "-3": [[-2, 4]], "-2": [[-6, 5]], "-1": [[-11, 6]], "0": [[-8, 6]], "1": [[-4, 5]], "2": [[-7, 4]], "3": [[-2, 3]] })
      ic.set([[-1, -2], [0, -2], [-2, -1], [1, -1]], false)
      return ic
    },
  },
  larder: {
    title: "larder",
    concept: "a store jar on the tile, dried goods heaped inside, its cloth cap tied down at the neck with the cord ends hanging",
    draw() {
      const ic = L.icon().fill(ground())
      const outer = lp([[-2, -10], [-2, -8], [-5, -5], [-5, 3], [0, 8], [5, 3], [5, -5], [2, -8], [2, -10]])
      const inner = lp([[-1, -9], [-1, -7], [-4, -4], [-4, 2], [0, 6], [4, 2], [4, -4], [1, -7], [1, -9]])
      ic.fill(L.diff(outer, inner))
      for (const [c, h] of [[0, 3], [-1, 0], [1, 0], [-2, -3], [0, -3], [2, -3]]) dia(ic, c, h)
      rows(ic, -2, 1, -10, -9)
      ic.fill(lp([[-3, -11], [0, -14], [3, -11], [2, -10], [0, -12], [-2, -10]]))
      ic.set([[2, -8], [2, -6]])
      return ic
    },
  },
  plot: {
    title: "plot",
    concept: "a furrowed iso field with forage's own frond standing in it, scaled down to an ear — what the plot gives back",
    draw() {
      const ic = L.icon().fill(L.diff(mat(7, 0, 5), mat(5, 0, 5)))
      ic.fill(dband(0, 6, 3, 3))
      ic.clear(pp([[-2, -6], [1, -6], [1, 4], [-2, 4]]))
      rows(ic, -1, -1, -9, 4)
      // forage/plants' leaves two strips long instead of three, laid alternately up the stem
      const lfL = v => lp([[-1, v], [-1, v - 4], [-3, v - 6], [-3, v - 2]])
      const lfR = v => lp([[0, v], [0, v - 4], [2, v - 6], [2, v - 2]])
      ic.fill(lfL(1)).fill(lfR(-2)).fill(lfL(-5)).fill(lfR(-8))
      return ic
    },
  },
  kiln: {
    title: "kiln",
    concept: "a beehive kiln on the tile: a corbelled dome drawn in one pen with a vent on its crown, its fire-mouth black at the foot and a pot glowing in the heat",
    draw() {
      const ic = L.icon().fill(ground())
      const out = lp([[-6, 4], [-6, -2], [-4, -4], [-4, -6], [-2, -8], [-1, -9], [-1, -11], [1, -11], [1, -9], [2, -8], [4, -6], [4, -4], [6, -2], [6, 4], [0, 10]])
      const inn = lp([[-5, 5], [-5, -1], [-3, -3], [-3, -5], [-1, -7], [0, -8], [1, -7], [3, -5], [3, -3], [5, -1], [5, 5], [0, 10]])
      ic.fill(L.diff(out, inn))
      ic.clear(L.inter(inn, pp([[0, -0.5], [4, 3.5], [4, 7], [0, 11], [-4, 7], [-4, 3.5]])))
      ic.fill(lp([[0, 2], [3, 5], [3, 7], [0, 10], [-3, 7], [-3, 5]]))
      ic.set([[-1, 6], [0, 6], [-1, 7], [0, 7]], false)
      return ic
    },
  },
  library: {
    title: "library",
    concept: "three closed books stacked on the tile, page edges in sawtooth, the top one solid — knowledge piling up and staying put",
    draw() {
      const ic = L.icon().fill(ground())
      book(ic, [0, 8], 5, 3, 2, { spine: "solid" })
      book(ic, [-1, 3], 5, 3, 2, { spine: "half" })
      book(ic, [0, -2], 5, 3, 2, { spine: "solid", top: "solid" })
      return ic
    },
  },
  cart: {
    title: "cart",
    concept: "the gather basket learnt to roll: a woven body riding two little wheels, a handle to pull it by",
    draw() {
      const ic = L.icon()
      rows(ic, -4, 5, -10, -9)
      rows(ic, -4, -4, -8, -3); rows(ic, 5, 5, -8, -3)
      rows(ic, -3, 4, -2, -1)
      ic.texture(pp([[-3, -8], [5, -8], [5, -3], [-3, -3]]), "right")
      for (const c of [-2, 4]) ic.fill(hexRing(2, c, 6)).set([[c - 1, 6], [c, 6]])
      ic.fill(dband(-6, -8, -4, -6))
      rows(ic, -7, -7, -9, -6)
      return ic
    },
  },
  // ── roots ─────────────────────────────────────────
  wheel: {
    title: "the wheel",
    concept: "a hex wheel rolling down its slope: tangent spokes turning round the SPACE cube for a hub, speed lines trailing",
    draw() {
      const w = L.icon().fill(hexRing(5))
      w.add(spin(L.icon().fill(dband(0, -4, 2, -6))))
      const q = cube(2)
      w.clear(hexA(2)).fill(q.left).fill(q.right).texture(q.top, "right")
      const ic = w.shift(1, -3)
      ic.fill(dband(-4, 4, 2, 10))
      ic.fill(dband(-7, -5, -5, -3)).fill(dband(-7, -1, -5, 1))
      return ic
    },
  },
  word: {
    title: "the word",
    concept: "the first word and its echo: a quotation mark with a solid hex head, and the same mark smaller and grey, fading after it",
    draw() {
      const ic = L.icon()
      ic.fill(L.union(hexA(3, -3, -5), dband(-7, 5, 0, -2)))
      ic.texture(L.union(hexA(2, 4, -6), dband(0, 2, 6, -4)), "right")
      return ic
    },
  },
  // ── techs ─────────────────────────────────────────
  preserving: {
    title: "preserving",
    concept: "two of quarry's fish hung by the tail on the drying stake — one fresh and solid, one already gone to half-tone — the pair keeps twice as long",
    draw() {
      const ic = L.icon()
      rows(ic, 5, 5, -10, 9)
      ic.add(fish(4, -1, -5)).add(halftone(fish(4, -1, 5)))
      dia(ic, -2, -5, false)
      return ic
    },
  },
  sowing: {
    title: "sowing",
    concept: "the broadcast throw: seeds swing down in one arc onto the plot's own field, growing as they fall, the last one lying in the furrow",
    draw() {
      const ic = L.icon().fill(L.diff(mat(7, 0, 5), mat(5, 0, 5)))
      ic.fill(dband(0, 6, 3, 3))
      ic.set([[-6, -6]])
      ic.set([[-4, -10]])
      dia(ic, -1, -10)
      dia(ic, 2, -9)
      dia(ic, 3, -4)
      dia(ic, 1, 4)
      return ic
    },
  },
  tally: {
    title: "tally",
    concept: "four strokes and the slash — the fifth that closes a count",
    draw() {
      const ic = L.icon()
      for (const [c, t, b] of [[-5, -7, 9], [-2, -10, 10], [1, -9, 11], [4, -10, 8]]) ic.fill(vbar(c, t, b))
      ic.fill(dband(-7, 5, 7, -9))
      return ic
    },
  },
  writing: {
    title: "writing",
    concept: "a clay tablet lying flat, pressed with rows of wedges — the lattice's own triangles — and the reed standing on the last one",
    draw() {
      const ic = L.icon()
      const [c0, v0] = [-1, 11], a = 8, b = 6
      ic.fill(lp([[c0, v0], [c0 + a, v0 - a], [c0 + a, v0 - a + 2], [c0, v0 + 2]]))
      ic.fill(lp([[c0, v0], [c0 - b, v0 - b], [c0 - b, v0 - b + 2], [c0, v0 + 2]]))
      ic.texture(lp([[c0 - b, v0 - b], [c0 - b + a, v0 - b - a], [c0 - b + a + 1, v0 - b - a + 1], [c0 - b + 1, v0 - b + 1]]), "left")
      ic.texture(lp([[c0 + a, v0 - a], [c0 + a - b, v0 - a - b], [c0 + a - b, v0 - a - b + 2], [c0 + a - 1, v0 - a + 1]]), "left")
      const W = []
      for (const [R, ks] of [[c0 + v0 - 9, [-4, -2, 0, 2]], [c0 + v0 - 5, [-3, -1, 1, 3]], [c0 + v0 - 1, [-2, 0, 2, 4]]]) for (const k of ks) { const h = R - k; W.push([k, par(k, h) ? h : h + 1]) }
      ic.set(W)
      const [lk, lh] = W[W.length - 1]
      ic.fill(vbar(lk + 1, -9, lh, 1, -1))
      return ic
    },
  },
  calendar: {
    title: "calendar",
    concept: "a page of days with today struck solid and a later day ringed — the day it regrows or spoils, read exactly",
    draw() {
      const ic = L.icon()
      rows(ic, -6, 5, -8, -7)
      for (let h = -6; h <= 8; h++) ic.set([[-6, h], [5, h]])
      rows(ic, -6, 5, 8, 9).set([[-6, 9], [5, 9]], false)
      const rg = L.icon().fill(vbar(-4, -12, -8)); ic.add(rg).add(rg.clone().mirrorX())
      for (const h of [-4, 0, 4]) for (const k of [-4, -2, 0, 2]) ic.set([[par(k, h) ? k : k + 1, h]])
      dia(ic, -3, -4)
      ic.clear(pp([[-0.5, 0.5], [4.2, 0.5], [4.2, 8], [-0.5, 8]]))
      ic.fill(hexRing(2, 2, 4))
      ic.set([[1, 4]])
      return ic
    },
  },
  sightlines: {
    title: "sightlines",
    concept: "the scout's own eye, and above it the fog with a lane carved a row or two in: the near tile in outline, the far one solid at the end of sight",
    draw() {
      const ic = L.fromData(HAND.scout).shift(0, 6)
      const fog = L.icon().texture(L.inter(hexA(8), pp([[-9, -20], [9, -20], [9, -5.5], [-9, -5.5]])), "right")
      fog.clear(pp([[-2.4, -13], [2.4, -13], [2.4, -4], [-2.4, -4]]))
      fog.clear(pp([[-1.4, -17], [1.4, -17], [1.4, -12], [-1.4, -12]]))
      ic.add(fog)
      ic.fill(hexRing(2, 0, -8))
      dia(ic, 0, -15)
      return ic
    },
  },
  "forage map": {
    title: "forage map",
    concept: "a map folded like a screen, three tall panels whose edges zigzag as a W: the first outlined with forage nodes on it, the second holding the regrow ring, the last fold turned away in shade",
    draw() {
      // fold lines at c = −7, −3, 3, 7, the top edge's height at each, every panel 16 tall
      const C = [-7, -3, 3, 7], T = [-9, -5, -11, -7], H = 16
      const top = c => { const i = c <= C[1] ? 0 : c <= C[2] ? 1 : 2; return T[i] + ((T[i + 1] - T[i]) * (c - C[i])) / (C[i + 1] - C[i]) }
      const panel = i => lp([[C[i], T[i]], [C[i + 1], T[i + 1]], [C[i + 1], T[i + 1] + H], [C[i], T[i] + H]])
      const inner = (a, b) => lp([[a, top(a) + 2], [b, top(b) + 2], [b, top(b) + H - 2], [a, top(a) + H - 2]])
      const ic = L.icon()
      for (const i of [0, 1, 2]) ic.fill(panel(i))
      ic.clear(inner(-6, -4)).clear(inner(-3, 3)).clear(inner(4, 6))
      ic.texture(inner(4, 6), "right")
      dia(ic, -5, -2); dia(ic, -5, 2)
      ic.fill(hexRing(2, 0, 0)).set([[-2, -3], [-2, -2], [-2, -1], [-1, -3]], false)
      return ic
    },
  },
}
