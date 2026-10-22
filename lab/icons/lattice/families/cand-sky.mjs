// cand-sky — reworked load / bare / spoil for sky (body & time)
import * as L from "../lat.mjs"
export const family = "cand-sky"

// ── lattice helpers (vertex coords [c, v], c + v even; x = c·0.108, y = v/16) ──
const even = (c, v) => ((c + v) % 2 + 2) % 2 === 0
const lp = pts => {
  for (const [c, v] of pts) if (!even(c, v)) throw new Error(`odd vertex ${c},${v}`)
  return L.lpoly(pts)
}
const D = L.diff
const TRI = new Map(L.TRIS.map(t => [t.id, t]))
const shape = (s, thr = 0.5) => L.icon().fill(s, thr)
const keep = (ic, pred) => { const o = L.icon(); for (const id of ic.on) if (pred(TRI.get(id))) o.on.add(id); return o }
const tone = (s, right = true) => keep(shape(s), t => t.right === right)
// filled strips: [[k, top row, bottom row], …]; row h across strips k0..k1 (a chain of ◆)
const prof = rows => { const ic = L.icon(); for (const [k, a, b] of rows) for (let h = a; h <= b; h++) ic.set([[k, h]]); return ic }
const row = (h, k0, k1) => { const r = []; for (let k = k0; k <= k1; k++) r.push([k, h, h]); return r }
// drop every triangle of `tex` that shares an edge with the ink: the paper halo round a line
const halo = (tex, ink) => { const o = L.icon(); for (const id of tex.on) if (!L.neighbours(TRI.get(id)).some(n => ink.on.has(n.id))) o.on.add(id); return o }
// flat iso rhombus of half-width a round (c, v)
const rhomb = (c, v, a) => lp([[c - a, v], [c, v - a], [c + a, v], [c, v + a]])

// one-pen stroke along a lattice polyline (vertical or 30° runs), on the right (1) or left (−1) of travel
function pen(pts, side = 1) {
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

// the hex path of apothem r, clockwise from the top vertex, in unit steps; hexArc lays a one-pen
// stroke just inside it over step ranges [[s0, s1], …] — regrow's ring
function hexSteps(r, c = 0, v = 0) {
  const V = [[c, v - 2 * r], [c + r, v - r], [c + r, v + r], [c, v + 2 * r], [c - r, v + r], [c - r, v - r]]
  const pts = []
  for (let i = 0; i < 6; i++) {
    const [a, b] = [V[i], V[(i + 1) % 6]]
    for (let j = 0; j < r; j++) pts.push([a[0] + ((b[0] - a[0]) * j) / r, a[1] + ((b[1] - a[1]) * j) / r])
  }
  return pts
}
const hexPath = (r, s0, s1, c = 0, v = 0) => {
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
function hexArc(r, ranges, c = 0, v = 0) {
  const ic = L.icon()
  for (const [s0, s1] of ranges) ic.fill(pen(corners(hexPath(r, s0, s1, c, v)), 1))
  return ic
}

// ── shared marks ──
// take/drop's crate: paper lid inside a one-pen rhombus, solid left face, ◀ half-tone right face;
// front-top corner (c, v), apothem m, faces H tall; lid = false where a crate above hides it
function crate(c, v, m, H, lid = true) {
  const ic = L.icon()
  if (lid) ic.fill(D(rhomb(c, v - m, m), rhomb(c, v - m, m - 2)))
  ic.fill(lp([[c, v], [c - m, v - m], [c - m, v - m + H], [c, v + H]]))
  return ic.add(tone(lp([[c, v], [c + m, v - m], [c + m, v - m + H], [c, v + H]]), false))
}
// quarry's fish (head wedge to the gill, paper eye, one-pen body with its meshed back, swallowtail),
// moved down dv rows: body centre (−1, dv − 3)
const MESH = t => ((((t.right ? t.k : t.k + 1) % 2) + 2) % 2) === 0
function fishFace(dv = 0) {
  const M = pts => lp(pts.map(([c, v]) => [c, v + dv]))
  const ic = L.icon().fill(M([[-7, -3], [-1, -9], [5, -3], [-1, 3]])).clear(M([[-5, -3], [-1, -7], [3, -3], [-1, 1]]))
  ic.fill(M([[-7, -3], [-2, -8], [-2, 2]])).set([[-5, -3 + dv], [-4, -3 + dv]], false)
  ic.pattern(M([[-2, -6], [-1, -7], [3, -3], [-1, 1], [-2, 0]]), MESH)
  ic.fill(M([[3, -3], [7, -7], [7, 1]])).clear(M([[7, -5], [5, -3], [7, -1]]))
  return ic
}

export const icons = {
  load: {
    title: "load",
    concept: "take and drop's own crate stacked three high: the load corner's column of what you carry, paper lid on top, solid backs, half-tone sides, and each crate another weight on every step",
    draw() {
      return crate(0, -4, 4, 4).add(crate(0, 2, 4, 4, false)).add(crate(0, 8, 4, 4, false))
    }
  },
  bare: {
    title: "bare",
    concept: "bare's stubble cut on one slant, standing inside regrow's ring before it has begun: the track only a half-tone ghost with its teeth turned in. The spot is spent and nothing is turning yet",
    draw() {
      // the ring in half-tone, mirrored about the axis (▶ on the left, ◀ on the right) so every tooth points in
      const track = keep(hexArc(6, [[0, 36]], 0, 2), t => (t.k < 0 ? t.right : !t.right))
      // bare's three stalks (each top a ◀), on a ground whose lower row is cut back clear of the ring's teeth
      const stubble = prof([[-4, -2, 5], [-1, -5, 5], [2, -4, 5], ...row(6, -4, 3), ...row(7, -3, 2)])
      return halo(track, stubble).add(stubble)
    }
  },
  spoil: {
    title: "spoil",
    concept: "quarry's fish run past its shelf clock: the head and paper eye still whole, a little meshed flesh behind the gill, and the rest eaten back to bone, two ribs, a spine and a bare fork of a tail. Food that rots is lost",
    draw() {
      // the head, eye and meshed flesh up to the gill's strip; then the spine, two ribs and the forked tail bone
      const ic = keep(fishFace(4), t => t.k <= -1)
      ic.add(prof([...row(0, 0, 4), ...row(1, 0, 4), [1, -3, 5], [3, -1, 3]]))
      return ic.fill(pen([[4, 0], [7, -3]], 1)).fill(pen([[4, 2], [7, 5]], -1))
    }
  }
}
