import * as L from "../lat.mjs"
export const family = "cand-land"
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
// a two-pen band centred on a lattice segment (one pen each side)
const band2 = (a, b) => L.union(band(a, b, 1), band(a, b, -1))
const pen2 = pts => L.union(...pts.slice(1).map((p, i) => band2(pts[i], p)))
// zigzag vertex list from c0 to c1, teeth `a` strips wide, crests at v0 - a
function zig(c0, c1, v0, a = 2, rise = true) {
  const out = []
  for (let c = c0, i = 0; c <= c1; c += a, i++) out.push([c, v0 - ((i % 2 === 0) === rise ? 0 : a)])
  return out
}
// the family's one water stroke: a one-pen zigzag, crests at c = -4, 0, 4
const WAVE = (v, c0 = -6, c1 = 6) => pen(zig(c0, c1, v, 2))
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
const tex = s => L.icon().texture(s, "right")
const rightOf = c => L.poly([L.V(c, -20), L.V(c, 20), L.V(12, 20), L.V(12, -20)])
const above = v => L.rect(-2, -2, 2, v / 16)
// a 60° stair-slope edge from (ca, va): `steps` treads toward `side`, each a 1-strip step and an r-row riser
function stairs(ca, va, side, steps, r = 2) {
  const out = [[ca, va]]
  let c = ca, v = va
  for (let i = 0; i < steps; i++) { c += side; v += 1; out.push([c, v]); v += r; out.push([c, v]) }
  return out
}
// a cattail: the head a solid 2-strip sausage slanted at 30° (top-left vertex (k, a), len v long),
// the stem one pen in strip k from the head down to row `base`, the spike one pen in strip k+1 above it
function cattail(ic, k, a, len, base, spike) {
  ic.fill(lp([k, a], [k + 2, a - 2], [k + 2, a + len - 2], [k, a + len]))
  return ic.set(vs(k, a + len, base)).set(vs(k + 1, a - 2 - spike, a - 2))
}
// a gull: one-pen chevron, wingtips (c, v) and (c + 2, v)
const gull = (c, v) => pen([[c, v], [c + 1, v + 1], [c + 2, v]], 1)
const headE = (c, v, d) => lp([c - d, v - d], [c, v], [c - d, v + d]) // solid ▶, apex (c, v)
const headW = (c, v, d) => lp([c + d, v - d], [c, v], [c + d, v + d]) // solid ◀, apex (c, v)
// the globe's limb: a one-pen ring, its vertical stretches straightened to one strip
const LIMB = () => { const l = L.icon().fill(L.ring(0, 0, 0.71, 0.81), 0.4); return l.set(vs(-8, -3, 3), false).set(vs(7, -3, 3), false).set(vs(-7, -7, 7)).set(vs(6, -7, 7)) }

export const icons = {
  marsh: {
    title: "marsh",
    concept: "cattails standing in still water: long solid heads slanted on one-pen stems, the waterline running across in front of them and the stems going on beneath it",
    draw() {
      const ic = L.icon()
      cattail(ic, -1, -11, 8, 10, 1)
      cattail(ic, -5, -5, 6, 10, 1)
      cattail(ic, 3, -7, 6, 10, 1)
      const W = L.icon().fill(WAVE(6))
      return ic.sub(grow(W)).add(W)
    }
  },
  cliff: {
    title: "cliff",
    concept: "a mountain the sea has cut in half: the lit slope climbs in the mountain's own stairs to the brink, the far side drops sheer and solid with two ledges for the nests, the waves at its foot and two gulls riding the drop",
    draw() {
      const ic = L.icon()
      const land = L.inter(lp(...stairs(1, -7, -1, 6, 2), [1, 11]), above(10))
      ic.add(tex(land)).add(rim(L.icon().fill(land), u => u.cy < 0.55 && u.k < 1))
      ic.fill(L.inter(lp([1, -7], [3, -9], [3, 9], [1, 9]), above(10)))
      for (const v of [-2, 4]) ic.fill(lp([3, v - 1], [4, v], [3, v + 1]))
      ic.fill(L.inter(WAVE(8, -6, 8), rightOf(3)))
      return ic.fill(gull(4, -10)).fill(gull(5, -5))
    }
  },
  post: {
    title: "post",
    concept: "the river icon three ways: three half-tone boards, the water a solid Y between them, and the post an open hex where the arms meet — three shores to choose from",
    draw() {
      const H = hexL(0, 0, 6)
      const Y = L.union(band2([0, -14], [0, 0]), pen2([[0, 0], [-8, 8]]), pen2([[0, 0], [8, 8]]), hexL(0, 0, 3))
      const water = L.icon().fill(L.inter(Y, H))
      return tex(H).sub(grow(water)).add(water).clear(hexL(0, 0, 2))
    }
  },
  stream: {
    title: "stream",
    concept: "the water you can walk across: the river's two waves drawn narrow, and three hex stones stepping over them, tile to tile",
    draw() {
      const W = L.icon().fill(L.inter(L.union(WAVE(-2, -8, 8), WAVE(4, -8, 8)), hexL(0, 0, 7)))
      const S = L.icon().fill(hexL(-2, -8, 1)).fill(hexL(0, 0, 1)).fill(hexL(2, 8, 1))
      return W.sub(grow(S)).add(S)
    }
  },
  globe: {
    title: "globe",
    concept: "the world as a ball of hex boards: home solid up where the light falls, the seams of its neighbours meeting in threes and running off round the limb",
    draw() {
      const ic = LIMB()
      ic.fill(hexL(-2, -4, 2))
      const seams = L.union(band([2, -8], [2, 0], -1), band([2, 0], [-2, 4], -1), band([-2, 4], [-6, 0], -1), band([2, 0], [6, 4], 1), band([-2, 4], [-2, 12], 1), band([2, -8], [6, -12], 1))
      return ic.fill(L.inter(seams, L.circle(0, 0, 0.75)))
    }
  },
  trail: {
    title: "trail",
    concept: "the day's path as a switchback: from you (solid) east, back west, east again — one thin line tile to tile, a solid head in the middle of every leg — to the resting place (outline)",
    draw() {
      const ic = L.icon()
      ic.set(row(8, -5, 4)).set(vs(4, 0, 8)).set(row(0, -5, 4)).set(vs(-5, -8, 0)).set(row(-8, -5, 1))
      ic.fill(headE(2, 8, 3)).fill(headW(-2, 0, 3)).fill(headE(0, -8, 3))
      return ic.fill(hexL(-6, 8, 1)).fill(hexRing(4, -8, 2))
    }
  }
}
