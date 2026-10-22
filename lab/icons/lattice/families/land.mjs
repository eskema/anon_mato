import * as L from "../lat.mjs"
export const family = "land"
const range = (a, b) => { const r = []; for (let i = a; i <= b; i++) r.push(i); return r }
const vs = (k, h0, h1) => range(Math.min(h0, h1), Math.max(h0, h1)).map(h => [k, h]) // vertical one-pen stroke
const row = (h, k0, k1) => range(k0, k1).map(k => [k, h])
const lp = (...pts) => { for (const [c, v] of pts) if (Number.isInteger(c) && Number.isInteger(v) && (c + v) % 2) throw new Error(`parity ${c},${v}`); return L.lpoly(pts) }
// pointy hex centred on lattice vertex (c, v), half-width s strips (vertical radius 2s)
const hexL = (c, v, s) => lp([c, v - 2 * s], [c + s, v - s], [c + s, v + s], [c, v + 2 * s], [c - s, v + s], [c - s, v - s])
const hexRing = (c, v, s) => L.diff(hexL(c, v, s), hexL(c, v, s - 1))
// one-pen band along a lattice segment a→b (vertical or 30°):
// verticals grow RIGHT one strip (dir=+1) or LEFT; diagonals grow DOWN 2v (dir=+1) or UP
function band([c0, v0], [c1, v1], dir = 1) {
  if (c0 === c1) {
    const lo = Math.min(v0, v1), hi = Math.max(v0, v1)
    return lp([c0, lo], [c0, hi], [c0 + dir, hi + 1], [c0 + dir, lo + 1])
  }
  const d = 2 * dir
  return lp([c0, v0], [c1, v1], [c1, v1 + d], [c0, v0 + d])
}
const pen = (pts, dir = 1) => L.union(...pts.slice(1).map((p, i) => band(pts[i], p, dir)))
// zigzag vertex list from c0 to c1, teeth `a` strips wide, crests at v0 - a
function zig(c0, c1, v0, a = 2, rise = true) {
  const out = []
  for (let c = c0, i = 0; c <= c1; c += a, i++) out.push([c, v0 - ((i % 2 === 0) === rise ? 0 : a)])
  return out
}
// the family's one water stroke: a one-pen zigzag, crests at c = -4, 0, 4
const WAVE = (v, c0 = -6, c1 = 6) => pen(zig(c0, c1, v, 2))
// ◆ straddling vertical lattice line c at row h (needs c + h odd)
const dia = (c, h) => [[c - 1, h], [c, h]]
const spine = (c, h0, h1, step = 2) => { const out = []; for (let h = h0; h <= h1; h += step) out.push(...dia(c, h)); return out }
// ── triangle-level morphology (vertex neighbours) ──
const VK = ([c, v]) => c + "," + v
const byVert = new Map()
for (const t of L.TRIS) for (const p of t.lv) { const k = VK(p); if (!byVert.has(k)) byVert.set(k, []); byVert.get(k).push(t) }
const vnb = t => { const s = new Set(); for (const p of t.lv) for (const u of byVert.get(VK(p))) if (u !== t) s.add(u); return [...s] }
const TBY = new Map(L.TRIS.map(t => [t.id, t]))
// the triangles of `a` that touch (by a vertex) something outside `a` — a one-pen inner edge band
function rim(a, outsideOnly = null) {
  const out = L.icon()
  for (const id of a.on) {
    const t = TBY.get(id)
    const nb = vnb(t)
    if (nb.length < 12 || nb.some(u => !a.on.has(u.id) && (!outsideOnly || outsideOnly(u)))) out.on.add(id)
  }
  return out
}
const grow = a => { const out = a.clone(); for (const id of a.on) for (const u of vnb(TBY.get(id))) out.on.add(u.id); return out }
const growE = a => { const out = a.clone(); for (const id of a.on) for (const u of L.neighbours(TBY.get(id))) out.on.add(u.id); return out }
// drop crumbs: triangles left with no edge-neighbour
const prune = a => { const out = L.icon(); for (const id of a.on) if (L.neighbours(TBY.get(id)).some(u => a.on.has(u.id))) out.on.add(id); return out }
const tAnd = (a, pred) => { const out = L.icon(); for (const id of a.on) if (pred(TBY.get(id))) out.on.add(id); return out }
function stairs(ca, va, side, steps, r = 2) {
  const out = [[ca, va]]
  let c = ca, v = va
  for (let i = 0; i < steps; i++) { c += side; v += 1; out.push([c, v]); v += r; out.push([c, v]) }
  return out
}
// a 60° stair-slope peak, apex (ca, va), flat foot at vb
function peakShape(ca, va, vb, r = 2) {
  if ((ca + va) % 2) throw new Error("apex parity " + ca + "," + va)
  const n = Math.ceil((vb - va) / (r + 1))
  const Ls = stairs(ca, va, -1, n, r), Rs = stairs(ca, va, 1, n, r)
  return L.inter(L.lpoly([...Rs, [Rs[Rs.length - 1][0], vb + 4], [Ls[Ls.length - 1][0], vb + 4], ...Ls.reverse()]), L.rect(-2, -2, 2, vb / 16))
}
const leftOf = c => L.poly([L.V(c, -20), L.V(c, 20), L.V(-12, 20), L.V(-12, -20)])
const rightOf = c => L.poly([L.V(c, -20), L.V(c, 20), L.V(12, 20), L.V(12, -20)])
const above = v => L.rect(-2, -2, 2, v / 16)
// polygon on one side of a zigzag line (the zig's vertices, extended to the canvas edge)
const zigSide = (pts, up) => { const y = up ? -24 : 24; return L.lpoly([[pts[0][0] - 4, pts[0][1]], ...pts, [pts[pts.length - 1][0] + 4, pts[pts.length - 1][1]], [pts[pts.length - 1][0] + 4, y], [pts[0][0] - 4, y]]) }
// a fir tier: a chevron band 4v thick, apex (c, a), half-width w — tiers stacked with a paper chevron between
const chev = (c, a, w, t = 4) => lp([c, a], [c + w, a + w], [c + w, a + w + t], [c, a + t], [c - w, a + w + t], [c - w, a + w])
// the globe's limb: a one-pen ring, its vertical stretches straightened to one strip
const LIMB = () => { const l = L.icon().fill(L.ring(0, 0, 0.71, 0.81), 0.4); return l.set(vs(-8, -3, 3), false).set(vs(7, -3, 3), false).set(vs(-7, -7, 7)).set(vs(6, -7, 7)) }
// the gate's frame: stonework towers with merlons, the pointed arch, a shared threshold, the moat
function gateFrame(ic, gap) {
  const half = L.icon()
  half.set(vs(-6, -9, 5)).set(vs(-4, -9, 5))
  half.set(vs(-5, -6, -5)).set([[-5, 5]])
  for (const h of [-4, -2, 0, 2]) half.set([[-5, h]])
  half.symX()
  ic.add(half)
  ic.fill(pen([[-3, -3], [0, -6], [3, -3]], 1))
  ic.set(row(6, -6, 5))
  if (gap) ic.set(row(6, -2, 1), false)
  ic.fill(WAVE(10))
  return ic
}
export const icons = {
  plain: {
    title: "plain",
    concept: "the open plain is the land of the lone flat-topped tree: a wide crown on a forked trunk, and nothing else to the horizon but grass",
    draw() {
      const ic = L.icon()
      ic.set(row(8, -6, 5))
      for (const k of [-5, -3, 3, 5]) ic.set([[k, 7]])
      ic.fill(lp([-6, -4], [-4, -6], [4, -6], [6, -4], [4, -2], [-4, -2]))
      ic.fill(band([0, -2], [0, 8], 1))
      ic.fill(band([0, 0], [-2, -2], 1)).fill(band([1, 1], [4, -2], 1))
      return ic
    }
  },
  marsh: {
    title: "marsh",
    concept: "cattails standing in still water, a tall one and a short one with a reed between — and under the waterline their reflection, as beads: only still water reflects",
    draw() {
      const ic = L.icon()
      ic.fill(WAVE(4))
      ic.set(spine(-1, 0, 2)).fill(lp([-1, -9], [0, -8], [0, -2], [-1, -1], [-2, -2], [-2, -8])).set(dia(-1, -10))
      ic.set(spine(3, 0, 2)).fill(lp([3, -7], [4, -6], [4, -2], [3, -1], [2, -2], [2, -6])).set(dia(3, -8))
      ic.fill(band([-4, 4], [-4, -2], 1)).fill(band([-4, -2], [-5, -3], -1))
      ic.set(spine(-1, 8, 10)).set(spine(3, 8, 10)).set(dia(-4, 9))
      return ic
    }
  },
  forest: {
    title: "forest",
    concept: "two firs, each a stack of chevron tiers notched apart: the near one solid, the far one in half-tone behind it",
    draw() {
      const ic = L.icon()
      const N = L.icon().fill(L.union(chev(-2, -12, 2), chev(-2, -6, 3), chev(-2, 0, 4))).set(spine(-2, 5, 7))
      const F = L.icon().fill(L.union(chev(3, -5, 2), chev(3, 1, 3))).set(spine(3, 6, 6))
      const vis = F.clone().sub(grow(N))
      ic.add(tAnd(L.icon().texture(L.all(), "right"), t => vis.on.has(t.id)))
      return ic.add(N)
    }
  },
  beach: {
    title: "beach",
    concept: "a wave rises out of a crest of the waterline and curls over, its eye one solid bead; the swash's lace, then the sand",
    draw() {
      const ic = L.icon()
      ic.fill(pen([[-4, 0], [-4, -6], [-1, -9], [2, -6], [2, -2], [0, 0], [-2, -2], [-2, -4]], 1))
      ic.set(dia(0, -5))
      ic.fill(WAVE(2))
      ic.set([[-6, 4], [-3, 4], [-2, 4], [1, 4], [2, 4], [5, 4]])
      ic.texture(L.inter(L.rect(L.V(-6, 0)[0], 5.5 / 16, L.V(6, 0)[0], 8.5 / 16), hexL(0, 0, 8)), "diamonds")
      ic.texture(L.inter(L.rect(L.V(-6, 0)[0], 8.6 / 16, L.V(6, 0)[0], 10.5 / 16), hexL(0, 0, 8)), "right")
      return ic
    }
  },
  water: {
    title: "water",
    concept: "three waves, three depths: a clean line, then a line of beads, then a line weighted by its own fringe — water darkens downward",
    draw() {
      const ic = L.icon()
      ic.fill(WAVE(-6))
      const keep = new Set([-6, -5, -2, -1, 0, 1, 4, 5])
      ic.add(tAnd(L.icon().fill(WAVE(0)), t => keep.has(t.k)))
      ic.fill(WAVE(6))
      ic.set([[-6, 8], [-3, 8], [-2, 8], [1, 8], [2, 8], [5, 8]])
      return ic
    }
  },
  cliff: {
    title: "cliff",
    concept: "the vantage: you stand on the brink of a gentle rise, and under your feet the land drops sheer and black into the sea, strata notched into the face",
    draw() {
      const ic = L.icon()
      ic.texture(L.inter(L.lpoly([[-6, 2], [-1, -3], [1, -3], [1, 11], [-6, 12]]), above(8)), "right")
      ic.fill(band([-6, 0], [-1, -5], 1)).set(row(-4, -1, 0)).set(row(-3, -1, 0))
      ic.fill(L.inter(L.lpoly([[1, -5], [3, -5], [3, 11], [1, 11]]), above(9)))
      ic.set([[2, -2], [2, 2]], false)
      ic.fill(L.inter(WAVE(8), rightOf(2)))
      ic.fill(hexL(-1, -7, 1))
      return ic
    }
  },
  mountain: {
    title: "mountain",
    concept: "a range on 60° stairs: the far peak all half-tone, the near one split into a lit face edged in stair teeth and a solid shadow",
    draw() {
      const ic = L.icon()
      const f = peakShape(1, -7, 8), b = L.inter(peakShape(-3, -3, 8), rightOf(-6))
      const F = L.icon().fill(f)
      const back = L.icon().texture(b, "right")
      back.sub(grow(F))
      const lit = tAnd(F, t => t.k < 1)
      const edge = rim(lit, u => u.k < 1)
      ic.add(back)
      ic.add(tAnd(F, t => t.k >= 1)).add(edge).add(L.icon().texture(L.inter(f, leftOf(1)), "right").sub(grow(edge).sub(lit)))
      return ic
    }
  },
  peak: {
    title: "peak",
    concept: "the summit alone: a snow cap in outline over half-tone and shadow, a solid pennant — the climb you carry your food up",
    draw() {
      const ic = L.icon()
      const f = peakShape(0, -6, 8)
      const F = L.icon().fill(f)
      ic.add(tAnd(F, t => t.k >= 0)).texture(L.inter(f, leftOf(0)), "right")
      const snow = [[-3, 1], [-2, 0], [-1, 1], [0, 0], [1, 1], [2, 0], [3, 1]]
      const cap = L.icon().fill(L.inter(f, zigSide(snow, true)))
      ic.sub(cap).add(rim(cap, u => !F.on.has(u.id)))
      ic.set(vs(-1, -10, -7)).fill(lp([0, -12], [0, -6], [3, -9]))
      return ic
    }
  },
  river: {
    title: "river",
    concept: "the one-tile row between two boards: two honeycomb shores in half-tone, and between them the water, solid, with a paper ripple",
    draw() {
      const ic = L.icon()
      const H = hexL(0, 0, 7)
      ic.fill(L.inter(L.union(WAVE(-2, -8, 8), WAVE(2, -8, 8)), H))
      ic.texture(L.inter(H, zigSide(zig(-8, 8, -4), true)), "right")
      ic.texture(L.inter(H, zigSide(zig(-8, 8, 6), false)), "right")
      return ic
    }
  },
  post: {
    title: "post",
    concept: "a confluence is the cube seen corner-on: three boards as three faces in three tones, a Y of rivers between them, one solid plank across",
    draw() {
      const ic = L.icon()
      const top = lp([0, -12], [5, -7], [0, -2], [-5, -7])
      const left = lp([-6, -6], [-1, -1], [-1, 11], [-6, 6])
      const right = lp([0, 0], [6, -6], [6, 6], [0, 12])
      ic.fill(top).clear(lp([0, -10], [3, -7], [0, -4], [-3, -7]))
      ic.texture(left, "diamonds")
      ic.texture(right, "right")
      const P = L.icon().fill(band([-3, 7], [1, 3], 1))
      ic.sub(growE(P)).add(P)
      return ic
    }
  },
  gate: {
    title: "gate",
    concept: "the home's one doorway: stonework towers with merlons, a pointed arch, the door the only solid — shut, on its threshold, over the moat",
    draw() {
      const ic = gateFrame(L.icon(), false)
      ic.fill(lp([-2, 6], [-2, 0], [0, -2], [2, 0], [2, 6]))
      ic.set(dia(0, 3), false)
      return ic.shift(0, -2)
    }
  },
  "gate:open": {
    title: "gate open",
    concept: "the same gate with its door let down flat across the moat, latch and all: the doorway empty, the door become your first bridge",
    draw() {
      const ic = gateFrame(L.icon(), true)
      const br = lp([0, 6], [3, 9], [0, 12], [-3, 9])
      ic.sub(growE(L.icon().fill(br))).fill(br)
      ic.set(dia(0, 9), false) // the door's own latch, now lying face-up
      return prune(ic).shift(0, -2)
    }
  },
  fog: {
    title: "fog",
    concept: "a fog bank whose lit crest is the tops of three hex tiles; below it the tiles stop resolving — half-tone, then beads, then wisps",
    draw() {
      const ic = L.icon()
      const cells = [[-4, -2, 2], [0, -4, 2], [4, -2, 2]]
      const cloudS = L.union(...cells.map(([c, vv, s]) => hexL(c, vv, s)), L.lpoly([[-6, 0], [6, 0], [6, 4], [-6, 4]]))
      const C = L.icon().fill(cloudS)
      const edge = L.icon(); for (const id of C.on) { const t = TBY.get(id); if (vnb(t).some(u => !C.on.has(u.id) && u.cy < t.cy - 0.01)) edge.on.add(id) }
      ic.add(edge)
      ic.add(tAnd(L.icon().texture(cloudS, "right"), t => C.on.has(t.id) && t.h <= 0))
      ic.add(tAnd(L.icon().texture(cloudS, "diamonds"), t => C.on.has(t.id) && t.h > 0))
      ic.set(row(6, -5, 2)).set(row(8, -3, 4))
      return ic
    }
  },
  trail: {
    title: "trail",
    concept: "the day's path as a switchback: you (solid) → dotted legs, each closed by its arrowhead → the resting place (outline)",
    draw() {
      const ic = L.icon()
      ic.fill(hexL(-4, 6, 2))
      ic.set(row(6, -2, 2)).fill(lp([3, 3], [3, 9], [6, 6]))
      ic.set(dia(5, 2)).set(dia(5, 0))
      ic.set(row(-1, -2, 2)).fill(lp([-2, -4], [-2, 2], [-5, -1]))
      ic.set(dia(-5, -4)).set(dia(-5, -6))
      ic.set(row(-7, -3, 0)).fill(hexRing(3, -7, 2))
      return ic
    }
  },
  stream: {
    title: "stream",
    concept: "the water you can walk across: a narrow channel running down the slope between two grassy banks, and three hex stepping stones laid across it, tile to tile",
    draw() {
      const ic = L.icon()
      const H = hexL(0, 0, 7)
      // a bank: one-pen band along the +30° line c + v = k0, 2v thick downward
      const bank = k0 => lp([-8, k0 + 8], [8, k0 - 8], [8, k0 - 6], [-8, k0 + 10])
      ic.fill(L.inter(L.union(bank(-10), bank(8)), H))
      // grass: every other triangle standing on the bank's dry side
      const grass = (kk, side, par) => tAnd(L.icon().fill(H), t => {
        const off = t.lv.find(([c, v]) => c + v !== kk)
        return t.lv.filter(([c, v]) => c + v === kk).length === 2 && Math.sign(off[0] + off[1] - kk) === side && (t.k + 16) % 2 === par
      })
      ic.add(grass(-10, -1, 0)).add(grass(10, 1, 1))
      for (const c of [-4, 0, 4]) ic.fill(hexL(c, 0, 1))
      return ic
    }
  },
  pentagon: {
    title: "pentagon",
    concept: "a hex board with one wedge lifted clean out: five solid wedges, and the sixth hovering above its own gap as an outline",
    draw() {
      const ic = L.icon()
      const O = [[0, -10], [5, -5], [5, 5], [0, 10], [-5, 5], [-5, -5]]
      for (let i = 1; i < 6; i++) ic.fill(lp([0, 0], O[i], O[(i + 1) % 6]))
      ic.clear(band([0, 0], [0, 10], 1)).clear(band([0, 0], [5, 5], -1)).clear(band([0, 0], [-5, 5], -1)).clear(band([0, 0], [-5, -5], 1))
      ic.fill(L.diff(lp([1, -3], [1, -13], [6, -8]), lp([2, -10], [4, -8], [2, -6])))
      return ic
    }
  },
  globe: {
    title: "globe",
    concept: "the world as a ball of hex boards: a home cell, its six seams running off round the limb, and the night side turning away in half-tone",
    draw() {
      const ic = L.icon()
      const night = t => (t.cx / 0.36) ** 2 + (t.cy / 0.72) ** 2 > 1 && t.cx > 0
      const web = L.icon()
      web.fill(hexRing(0, 0, 3))
      web.fill(band([3, -3], [7, -7], 1)).fill(band([-3, -3], [-7, -7], 1)).fill(band([3, 3], [7, 7], -1)).fill(band([-3, 3], [-7, 7], -1))
      web.set(spine(0, -11, -7)).set(spine(0, 7, 11))
      ic.add(tAnd(web, t => L.coverage(L.circle(0, 0, 0.7), t) > 0.6 && !night(t)))
      ic.add(tAnd(L.icon().texture(L.circle(0, 0, 0.7), "right"), night))
      ic.add(tAnd(LIMB(), t => !night(t) || t.cx < 0.2))
      return ic
    }
  }
}
