import * as L from "../lat.mjs"
export const family = "quarry"

// ── helpers (lattice triangles: strip k, row h; lattice vertices (c, v), c+v even) ──
const range = (a, b) => { const r = []; for (let i = a; i <= b; i++) r.push(i); return r }
const odd = n => ((n % 2) + 2) % 2 === 1
const m4 = (n, m) => ((n % m) + m) % m
const vs = (k, h0, h1) => range(Math.min(h0, h1), Math.max(h0, h1)).map(h => [k, h])
const row = (h, k0, k1) => range(k0, k1).map(k => [k, h])
const lp = (...pts) => {
  for (const [c, v] of pts) if (odd(c + v)) throw new Error(`odd vertex ${c},${v}`)
  return L.lpoly(pts)
}
const P = (...pts) => L.lpoly(pts) // loose helper regions
const X = c => (c * L.SQ) / 8
const box = (c0, v0, c1, v1) => L.rect(X(c0), v0 / 16, X(c1), v1 / 16)
const hexp = (c, v, r) => lp([c, v - 2 * r], [c + r, v - r], [c + r, v + r], [c, v + 2 * r], [c - r, v + r], [c - r, v - r])
const ring = (c, v, r1, r2) => L.diff(hexp(c, v, r2), hexp(c, v, r1))
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
// the region between two lines over c0..c1 (f0 above f1)
const between = (c0, c1, f0, f1) => P([c0, f0(c0)], [c1, f0(c1)], [c1, f1(c1)], [c0, f1(c0)])
// zigzag vertex list from c0 to c1, teeth a strips wide, crests at v0 - a
function zig(c0, c1, v0, a = 2) {
  const out = []
  for (let c = c0, i = 0; c <= c1; c += a, i++) out.push([c, v0 - (i % 2 === 0 ? 0 : a)])
  return out
}
const up = (k0, h0, n) => { if (odd(k0 + h0)) h0 -= 1; return range(0, n - 1).flatMap(i => [[k0 + i, h0 - i], [k0 + i, h0 - i + 1]]) }
const dn = (k0, h0, n) => { if (!odd(k0 + h0)) h0 -= 1; return range(0, n - 1).flatMap(i => [[k0 + i, h0 + i], [k0 + i, h0 + i + 1]]) }
// a lump built strip by strip: [k, top row, bottom row]
const lump = cols => { const ic = L.icon(); for (const [k, t, b] of cols) ic.set(vs(k, t, b)); return ic }
// a sawtooth fringe: empty triangles inside `region` that share an edge with the icon
function fringe(ic, region) {
  const add = []
  for (const t of L.TRIS) {
    if (ic.on.has(t.id) || L.coverage(region, t) < 0.5) continue
    if (L.neighbours(t).some(n => ic.on.has(n.id))) add.push(t.id)
  }
  add.forEach(id => ic.on.add(id))
  return ic
}
// walk an edge one strip at a time: l = left-down, L = left-up, r = right-down, R = right-up
function walk(a, pat) {
  const out = [a]
  let [c, v] = a
  for (const s of pat) { c += s === "l" || s === "L" ? -1 : 1; v += s === "l" || s === "r" ? 1 : -1; out.push([c, v]) }
  return out
}
const HALF = t => t.right // the family's half-tone: ▶ only
// THE FINE MARK, copied from tools (axe:fine): the glint, six rays of the lattice's own node
const glint = (ic, k, h) => ic.set(vs(k, h - 3, h + 3)).set(up(k - 1, h + 1, 3)).set(dn(k - 1, h - 1, 3))

// ── THE FISH HEAD, shared by fish and eel: a solid wedge to the gill, the paper eye at its back ──
const FISH_HEAD = lp([-7, -3], [-2, -8], [-2, 2])
const FISH_EYE = [[-5, -3], [-4, -3]]
// the net's mesh as scales: paper diamonds on every other vertical line
const MESH = t => m4(t.right ? t.k : t.k + 1, 2) === 0

// ── THE NUGGET, shared by rock and metal: one lump, two finishes — rock matte, metal solid and glinting ──
const NUGGET = [[-5, 0, 4], [-4, -2, 5], [-3, -3, 6], [-2, -4, 6], [-1, -5, 7], [0, -5, 7], [1, -5, 6], [2, -4, 6], [3, -3, 5], [4, -1, 3]]

// ── THE STONE: a lit facet in half-tone, a solid body, and one fracture edge in three big teeth ──
// ── THE CORD: a two-pen band; its plies in half-tone across each run, at 60° to it ──
const slitV = k => L.rect(X(k) + 1e-4, -2, X(k + 1) - 1e-4, 2) //              across an up-right run
const slitD = d => P([-9, -9 + d], [9, 9 + d], [9, 11 + d], [-9, -7 + d]) //    across a vertical run
const slitU = d => P([-9, 9 + d], [9, -9 + d], [9, -7 + d], [-9, 11 + d]) //    across a down-right run

export const icons = {
  fish: {
    title: "fish",
    concept: "caught in the net it wears: the net's diamond mesh is its scales, a solid head to the gill with the paper eye, a solid swallowtail, and live water under it",
    draw() {
      const ic = L.icon()
      ic.fill(lp([-7, -3], [-1, -9], [5, -3], [-1, 3])).clear(lp([-5, -3], [-1, -7], [3, -3], [-1, 1]))
      ic.fill(FISH_HEAD).set(FISH_EYE, false)
      ic.pattern(lp([-2, -6], [-1, -7], [3, -3], [-1, 1], [-2, 0]), MESH)
      ic.fill(lp([3, -3], [7, -7], [7, 1])).clear(lp([7, -5], [5, -3], [7, -1]))
      ic.fill(pen(zig(-6, 6, 6, 2)))
      return ic
    }
  },
  hare: {
    title: "hare",
    concept: "a hare hunched low: one long back rising to the haunch, a solid thigh on the big hind foot, the flank in half-tone, one ear up and one laid back",
    draw() {
      const ic = L.icon()
      ic.texture(P([-3, 1], [-1, -1], [4, -6], [5, -5], [5, 8], [-3, 8]), "right")
      ic.fill(pen([[-1, -1], [4, -6], [5, -5]], 1, 1))
      ic.set(vs(4, -4, 6))
      ic.fill(lp([1, 3], [3, 1], [5, 3], [5, 5], [3, 7], [1, 5]))
      ic.set(row(7, -3, 4)).set(row(8, -3, 3))
      ic.fill(lp([-3, -7], [-1, -5], [-1, -1], [-3, 1], [-5, -1], [-6, -2], [-6, -4], [-5, -5])).set([[-5, -3], [-4, -3]], false)
      ic.set(vs(-3, -13, -7))
      ic.set(up(-2, -7, 4)).set([[-2, -6]])
      return ic
    }
  },
  eel: {
    title: "eel",
    concept: "the fish's own head on a body that will not stop: one pen in two hex arcs, a ribbon of sawtooth fin round the outside of every bend, a pointed tail",
    draw() {
      const ic = L.icon()
      ic.fill(L.inter(ring(-1, 1, 2, 3), box(-8, 0, 8, 16)))
      ic.fill(L.inter(ring(4, 0, 2, 3), box(-8, -16, 6, 0)))
      ic.fill(lp([5, -5], [6, -4], [6, 2], [5, 3])).fill(lp([5, 3], [6, 2], [6, 4]))
      fringe(ic, L.inter(ring(-1, 1, 3, 4), box(-3, 3, 3, 16)))
      fringe(ic, L.inter(ring(4, 0, 3, 4), box(1, -16, 6, -2)))
      fringe(ic, box(6, -4, 7, 3))
      ic.fill(FISH_HEAD).set(FISH_EYE, false)
      return ic
    }
  },
  wood: {
    title: "wood",
    concept: "a log on the long diagonal: the end shows the years (bark ring, paper, heart) split by one check; the side runs away in half-tone bark",
    draw() {
      const c0 = -4, v0 = 4, R = 3, Ln = 7
      const T = [c0, v0 - 2 * R], TR = [c0 + R, v0 - R], BR = [c0 + R, v0 + R]
      const sh = ([c, v]) => [c + Ln, v - Ln]
      const ic = L.icon()
      ic.texture(lp(T, sh(T), sh(TR), sh(BR), BR, TR), "right")
      ic.fill(band(T, sh(T), 1, 1)).fill(band(BR, sh(BR), 1, -1))
      ic.fill(band(sh(T), sh(TR), 1, 1)).fill(band(sh(TR), sh(BR), 1, -1))
      ic.clear(hexp(c0, v0, R)).fill(ring(c0, v0, R - 1, R)).fill(hexp(c0, v0, 1))
      ic.clear(lp([c0 + 1, v0 - 1], [c0 + R, v0 - R], [c0 + R, v0 - R + 2], [c0 + 1, v0 + 1]))
      return ic
    }
  },
  branches: {
    title: "branches",
    concept: "a fallen bough lying along the ground, never standing: thick at the snapped butt, thinning on the long diagonal, twigs off both sides, a fork at the tip — haft and kindling in one",
    draw() {
      const ic = L.icon()
      const stick = (c0, v0, n, t = 1) => lp([c0, v0], [c0 + n, v0 - n], [c0 + n, v0 - n + 2 * t], [c0, v0 + 2 * t])
      const twig = (c0, v0, n) => lp([c0, v0], [c0 + n, v0 + n], [c0 + n, v0 + n + 2], [c0, v0 + 2])
      ic.fill(stick(-6, 6, 5, 2)).fill(stick(-1, 1, 7, 1))
      ic.fill(twig(-2, 4, 3)).fill(stick(1, 7, 2))          // a twig off the underside, turning up again
      ic.set(vs(1, -6, -1)).set(vs(-3, -2, 2))                // two off the top
      ic.fill(twig(4, -4, 2)).fill(stick(4, -4, 2))           // the fork at the tip
      ic.set([[-7, 7], [-7, 9]])                              // the butt, snapped
      return ic
    }
  },
  rock: {
    title: "rock",
    concept: "metal's own nugget, matte: the same lumpy outline, its roof lit in half-tone and its two flanks solid, split by a paper Y run out to the shoulders — the cube's corner inside every stone",
    draw() {
      const ic = lump(NUGGET)
      const [jc, jv] = [-1, 3] // the Y's arms reach the nugget's two shoulders, so the whole roof is the lit face
      const top = P([jc, jv - 2], [jc - 14, jv - 16], [jc + 14, jv - 16])
      for (const t of L.TRIS) if (ic.on.has(t.id) && L.coverage(top, t) >= 0.5 && !t.right) ic.on.delete(t.id)
      ic.clear(P([jc, jv], [jc - 12, jv - 12], [jc - 12, jv - 14], [jc, jv - 2]))
      ic.clear(P([jc, jv], [jc + 12, jv - 12], [jc + 12, jv - 14], [jc, jv - 2]))
      ic.clear(L.rect(X(jc) + 1e-4, (jv - 1) / 16, X(jc + 1) - 1e-4, 2))
      return ic
    }
  },
  metal: {
    title: "metal",
    concept: "the rarest find shines: a nugget, the rock's own lump but solid where rock is matte, and the fine tools' glint flashing across its shoulder — ink in the air, paper in the metal",
    draw() {
      const ic = lump(NUGGET)
      const g = glint(L.icon(), 3, -5)
      for (const id of g.on) ic.on.has(id) ? ic.on.delete(id) : ic.on.add(id)
      return ic
    }
  },
  cord: {
    title: "cord",
    concept: "two plants twisted into something that holds: a slack two-pen cord tied in one overhand knot, its plies in half-tone, the over strand clear of the under, both ends frayed",
    draw() {
      const under = between(-6, 3, c => -c - 2, c => -c + 2)
      const over = L.union(between(-5, 3, c => c, c => c + 4), between(3, 6, c => -c + 6, c => -c + 10))
      const ic = L.icon().fill(L.diff(ring(-1, -5, 2, 4), L.rect(-2, -1 / 16, 2, 2))).fill(under)
      ic.clear(between(-4, 2, c => c - 2, c => c + 6)).fill(over)
      ic.set([[-7, 5], [-7, 7], [6, 1], [6, 3]])
      const R = {
        tailin: between(-6, -3, c => -c - 2, c => -c + 2), right: lp([1, -7], [3, -9], [3, -1], [1, -3]),
        topR: between(-1, 3, c => c - 12, c => c - 8), topL: between(-5, -1, c => -c - 14, c => -c - 10),
        left: lp([-5, -9], [-3, -7], [-3, -3], [-5, -1]), over: between(-5, 3, c => c, c => c + 4), out: between(3, 6, c => -c + 6, c => -c + 10),
      }
      for (const [run, s] of [["right", slitD(-6)], ["right", slitD(-10)], ["topR", slitU(-10)], ["topL", slitV(-3)], ["left", slitD(0)], ["left", slitD(-4)], ["over", slitU(6)], ["over", slitU(2)], ["out", slitV(4)]])
        ic.texture(L.inter(R[run], s), "right")
      return ic
    }
  },
  rope: {
    title: "rope",
    concept: "a hank, coiled and seized: two loops of the cord's twisted band (one big, one small, never concentric), a solid seizing through the waist, the free end hanging frayed",
    draw() {
      const ic = L.icon()
      const loops = L.union(ring(-2, -4, 2, 4), ring(3, 1, 1, 3))
      ic.fill(loops).texture(L.inter(loops, L.union(...range(-8, 7).filter(k => m4(k, 3) === 0).map(slitV))), "right")
      ic.fill(P([0, -6], [2, -8], [2, 6], [0, 8]))
      ic.fill(between(-3, 0, c => -c + 4, c => -c + 8))
      return ic.set([[-4, 8], [-4, 10]])
    }
  },
  shard: {
    title: "shard",
    concept: "one flake, sharp and single: a long clean edge on the lattice's diagonal from a needle tip, a short break, the fracture underneath in three big teeth, the lit face in half-tone",
    draw() {
      const ic = L.icon().fill(lp([-6, 6], [5, -5], ...walk([5, 5], "llLllLLllLl").slice(0, -1)))
      const lit = lp([-1, 3], [4, -2], [4, 2], [2, 4])
      return ic.clear(lit).texture(lit, "right")
    }
  },
  piercer: {
    title: "piercer",
    concept: "the shard with one end knapped to a point, standing on the spear's own 60° line: a lit facet up to the tip, the back still the raw fracture in big teeth",
    draw() {
      const top = walk([1, -5], "lLlllLl"), bot = walk([-6, 2], "rRrrrRr")
      const ic = L.icon().fill(lp([6, 0], ...top, ...bot))
      const lit = P([-1, -0.1], [-1, -2.6], [1, -3.6], [4.6, -0.1])
      return ic.clear(lit).texture(lit, "right").rot60(5)
    }
  },
  crusher: {
    title: "crusher",
    concept: "the shard with one end ground blunt: the hammer's iso block — lit top in half-tone, solid side, the worked face its own outlined tone — the back left knapped rough",
    draw() {
      const ic = L.icon()
      const A = [-6, -2], B = [-2, -6], C = [4, 0], D = [0, 4], A2 = [-6, 6], D2 = [0, 12], C2 = [4, 8]
      ic.fill(lp(A, B, C, D)).fill(lp(A, D, D2, A2)).fill(lp(D, C, C2, D2))
      const top = lp([-4, -2], [-2, -4], [2, 0], [0, 2])
      ic.clear(top).texture(top, "right")
      ic.clear(lp([1, 5], [3, 3], [3, 7], [1, 9]))
      ic.set([[-6, -2], [-6, -1], [-5, -3], [-6, 1], [-6, 3], [-6, 5], [-6, 6], [-5, 7]], false)
      return ic.shift(0, -4)
    }
  },
}
