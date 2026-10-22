import * as L from "../lat.mjs"
export const family = "cand-quarry"

// ── helpers (lattice triangles: strip k, row h; lattice vertices (c, v), c+v even) — copied from quarry ──
const range = (a, b) => { const r = []; for (let i = a; i <= b; i++) r.push(i); return r }
const odd = n => ((n % 2) + 2) % 2 === 1
const m4 = (n, m) => ((n % m) + m) % m
const vs = (k, h0, h1) => range(Math.min(h0, h1), Math.max(h0, h1)).map(h => [k, h])
const lp = (...pts) => {
  for (const [c, v] of pts) if (odd(c + v)) throw new Error(`odd vertex ${c},${v}`)
  return L.lpoly(pts)
}
const hexp = (c, v, r) => lp([c, v - 2 * r], [c + r, v - r], [c + r, v + r], [c, v + 2 * r], [c - r, v + r], [c - r, v - r])
const ring = (c, v, r1, r2) => L.diff(hexp(c, v, r2), hexp(c, v, r1))
const up = (k0, h0, n) => { if (odd(k0 + h0)) h0 -= 1; return range(0, n - 1).flatMap(i => [[k0 + i, h0 - i], [k0 + i, h0 - i + 1]]) }
const dn = (k0, h0, n) => { if (!odd(k0 + h0)) h0 -= 1; return range(0, n - 1).flatMap(i => [[k0 + i, h0 + i], [k0 + i, h0 + i + 1]]) }
// a band along a lattice segment a→b, t pens thick: verticals grow t strips right (dir 1) or left; diagonals grow 2t rows down or up
function band([c0, v0], [c1, v1], t = 1, dir = 1) {
  if (c0 === c1) {
    const lo = Math.min(v0, v1), hi = Math.max(v0, v1)
    return lp([c0, lo], [c0, hi], [c0 + t * dir, hi + t], [c0 + t * dir, lo + t])
  }
  const d = 2 * t * dir
  return lp([c0, v0], [c1, v1], [c1, v1 + d], [c0, v0 + d])
}
const pen = (pts, t = 1, dir = 1) => L.union(...pts.slice(1).map((p, i) => band(pts[i], p, t, dir)))
const TRI = id => L.TRIS.find(q => q.id === id)
// an upright figure symmetric about c = 0, built strip by strip: {k: [top row, bottom row]} for k ≥ 0, mirrored to −k−1
function upright(spec) {
  const ic = L.icon()
  for (const [k, [a, b]] of Object.entries(spec)) ic.set(vs(+k, a, b)).set(vs(-k - 1, a, b))
  return ic
}
// the family's half-tone (▶ only) laid over the triangles of `region` that pass `keep`
const halfTone = (ic, region, keep = () => true) => {
  for (const id of region.on) if (keep(TRI(id)) && !TRI(id).right) ic.on.delete(id)
  return ic
}
// THE GLINT, the quarry's own: six rays of the lattice's node
const glint = (ic, k, h) => ic.set(vs(k, h - 3, h + 3)).set(up(k - 1, h + 1, 3)).set(dn(k - 1, h - 1, 3))
// THE PLIES: windings along the +30° lines in three bands — one ply solid, one half-tone, a gap of paper
const plies = t => { const p = m4(t.h + t.k, 6); return p < 2 ? true : p < 4 ? t.right : false }

export const icons = {
  metal: {
    title: "metal",
    concept: "the rarest find shines: a heavy nugget of two hex lobes fused, solid where rock is matte, one paper streak of reflection across its lit shoulder, and the quarry's glint flashing off its crown",
    draw() {
      const ic = L.icon().fill(hexp(-3, 1, 3)).fill(hexp(2, 2, 3))
      ic.clear(band([-5, 1], [-3, -1], 1)) // the reflection
      return glint(ic, -1, -7) // its lower ray on the left lobe's crown
    }
  },
  cord: {
    title: "cord",
    concept: "two plants twisted, wound up to keep: a ball in a one-pen rim, its windings the two plies in turn (solid, half-tone), the slack end dropping from its foot and trailing off along the ground, parting into its two plies at the tip",
    draw() {
      const c = -1, v = -3
      const ic = L.icon().pattern(hexp(c, v, 3), plies).fill(ring(c, v, 3, 4))
      ic.fill(lp([-1, 5], [-1, 7], [0, 8], [0, 6])) // the end drops from the ball's foot…
      ic.fill(pen([[0, 6], [2, 8], [4, 6], [5, 7]], 1, 1)) // …and trails off slack along the ground
      return ic.set([[5, 6], [5, 10]]) // the two plies part at its tip
    }
  },
  piercer: {
    title: "piercer",
    concept: "the shard knapped to a point, stood upright: a needle tip on the lattice's own stairs, the lit face half-tone inside a one-pen rim, the shadow face solid along the ridge, the butt cut square for the shaft",
    draw() {
      const ic = upright({ 0: [-13, 8], 1: [-10, 8], 2: [-5, 7], 3: [0, 5] })
      return halfTone(ic, upright({ 0: [-10, 6], 1: [-5, 6], 2: [0, 4] }), t => t.k < 0) // the lit face, left of the ridge
    }
  },
}
