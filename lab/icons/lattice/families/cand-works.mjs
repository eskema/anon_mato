// cand-works — reworked candidates for works: word, writing, wheel, preserving
import * as L from "../lat.mjs"
export const family = "cand-works"

// ── lattice helpers (vertex coords [c, v], c + v even; x = c·0.108, y = v/16) ──
const lp = pts => {
  for (const [c, v] of pts) if ((((c + v) % 2) + 2) % 2 !== 0) throw new Error(`odd vertex ${c},${v}`)
  return L.lpoly(pts)
}
const hexA = (a, c = 0, v = 0) => lp([[c, v - 2 * a], [c + a, v - a], [c + a, v + a], [c, v + 2 * a], [c - a, v + a], [c - a, v - a]])
const hexRing = (a, c = 0, v = 0, w = 1) => L.diff(hexA(a, c, v), hexA(a - w, c, v))
// flat iso mat (rhombus) of half-width r around (c, v)
const mat = (r, c = 0, v = 0) => lp([[c - r, v], [c, v - r], [c + r, v], [c, v + r]])
// 30° one-pen stroke from (c0, v0) to (c1, v1), t v-units tall (hangs below the line)
const dband = (c0, v0, c1, v1, t = 2) => {
  if (Math.abs(c1 - c0) !== Math.abs(v1 - v0)) throw new Error(`not 30°: ${c0},${v0} → ${c1},${v1}`)
  return lp([[c0, v0], [c1, v1], [c1, v1 + t], [c0, v0 + t]])
}
// one-pen zigzag through lattice vertices (every step 30°)
const zigpen = pts => L.union(...pts.slice(1).map((p, i) => dband(pts[i][0], pts[i][1], p[0], p[1])))
const spin = (one, n = 6) => { const out = one.clone(); for (let i = 1; i < n; i++) out.add(one.clone().rot60(i)); return out }
const par = (k, h) => ((((k + h) % 2) + 2) % 2 === 1) // ▶ when true
// ◆ on the vertical edge c at row h (c + h odd): ◀ in strip c−1 + ▶ in strip c
const dia = (ic, c, h, on = true) => {
  if (!par(c, h)) throw new Error(`◆ parity ${c},${h}`)
  return ic.set([[c - 1, h], [c, h]], on)
}
// fill a block of whole triangles: strips k0..k1, rows h0..h1
const rows = (ic, k0, k1, h0, h1, on = true) => { for (let k = k0; k <= k1; k++) for (let h = h0; h <= h1; h++) ic.set([[k, h]], on); return ic }
// the reed at 30°, rising right: its cut nib a solid ◀ whose back edge stands at c0 from v0 down t,
// parted by one strip from a hollow one-pen shaft that runs on to c1
function reed(c0, v0, t, c1) {
  const ic = L.icon().fill(lp([[c0, v0], [c0, v0 + t], [c0 - t / 2, v0 + t / 2]]))
  const a = c0 + 1, d = c1 - a
  const outer = lp([[a, v0 - 1], [c1, v0 - 1 - d], [c1, v0 - 1 - d + t], [a, v0 - 1 + t]])
  const inner = lp([[a + 1, v0], [c1 - 1, v0 - d + 2], [c1 - 1, v0 - d + t - 2], [a + 1, v0 + t - 4]])
  return ic.fill(L.diff(outer, inner))
}
// the sun as ☼: a one-pen hex ring of apothem a with a ◆ ray off each corner, moved by (dc, dv)
const sunO = (dc, dv, a = 2) => {
  const s = L.icon().fill(hexRing(a))
  const ray = L.icon()
  dia(ray, 0, -2 * a - 3)
  return s.add(spin(ray)).shift(dc, dv)
}

export const icons = {
  // ── roots ─────────────────────────────────────────
  wheel: {
    title: "the wheel",
    concept: "the wheel under way: a hex rim in one pen, six spokes each riding one side of its diameter so the whole wheel turns, a solid hub, and three speed lines left behind it",
    draw() {
      const w = L.icon().fill(hexRing(5))
      w.add(spin(L.icon().fill(lp([[0, -2], [0, -8], [1, -7], [1, -3]]))))
      w.fill(hexA(1))
      const ic = w.shift(2, 0)
      for (const v of [-5, -1, 3]) ic.fill(dband(-7, v, -4, v + 3))
      return ic
    },
  },
  word: {
    title: "the word",
    concept: "the first word, closed in quotes: two marks, each a solid hex head with its tail drawn down the lattice — speech before anything is written down",
    draw() {
      const mark = (c, v) => L.union(hexA(2, c, v), dband(c + 2, v + 2, c - 3, v + 7))
      return L.icon().fill(mark(-3, -3)).fill(mark(3, -3))
    },
  },
  // ── techs ─────────────────────────────────────────
  preserving: {
    title: "preserving",
    concept: "the family's fish hung by its tail on the drying stake, out under the sun — the catch that keeps twice as long",
    draw() {
      const ic = rows(L.icon(), 5, 5, -9, 12)
      const c = 0, v = 6
      ic.fill(mat(4, c, v))
      ic.fill(L.diff(lp([[c + 2, v], [c + 6, v - 4], [c + 6, v + 4]]), lp([[c + 6, v - 2], [c + 4, v], [c + 6, v + 2]])))
      ic.set([[c - 3, v]], false)
      return ic.add(sunO(-2, -6))
    },
  },
  writing: {
    title: "writing",
    concept: "the reed at work: a hollow one-pen shaft, its cut nib a solid wedge parted at the joint, and the line it has just laid down — written right to left, like the hand's own kufic",
    draw() {
      const ic = reed(-3, -1, 6, 5)
      ic.fill(zigpen([[-6, 8], [-4, 6], [-2, 8], [0, 6], [2, 8]]))
      return ic
    },
  },
}
