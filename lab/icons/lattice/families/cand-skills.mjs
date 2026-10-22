// cand-skills — reworked skill figures (candidates to replace the weakest of families/skills.mjs)
import * as L from "../lat.mjs"
export const family = "cand-skills"

// ── lattice helpers (lattice vertex coords [c, v], c + v even) ──
const lp = pts => {
  for (const [c, v] of pts) if (((c + v) % 2 + 2) % 2 !== 0) throw new Error(`odd vertex ${c},${v}`)
  return L.lpoly(pts)
}
const I = s => L.icon().fill(s)
const tri = (k, h) => L.triAt(k, h)
const ids = ic => [...ic.on].map(id => L.TRIS.find(t => t.id === id))
// pointy-top hexagon of apothem a (strips) around (c, v)
const hexA = (a, c = 0, v = 0) => lp([[c, v - 2 * a], [c + a, v - a], [c + a, v + a], [c, v + 2 * a], [c - a, v + a], [c - a, v - a]])
const hexRing = (a, c = 0, v = 0, w = 1) => L.diff(hexA(a, c, v), hexA(a - w, c, v))
// small ◆ (two triangles sharing a vertical edge) centred on the vertical edge at c, v (c + v odd)
const gem = (c, v) => lp([[c - 1, v], [c, v - 1], [c + 1, v], [c, v + 1]])
// sawtooth: one triangle hanging under the band in each listed strip
function teeth(band, ks) {
  const out = L.icon()
  const low = new Map()
  for (const t of ids(band)) low.set(t.k, Math.max(low.get(t.k) ?? -99, t.h))
  for (const k of ks) { const t = low.has(k) && tri(k, low.get(k) + 1); if (t) out.on.add(t.id) }
  return out
}
// the player's mark (menu:cube) at apothem r round (c, v): a one-pen hex and three one-pen spokes,
// each laid on the clockwise side of its axis
function mark(r, c, v) {
  const ic = I(hexRing(r, c, v))
  const s = I(lp([[0, 0], [0, -2 * r + 2], [1, -2 * r + 3], [1, -1]]))
  return ic.add(s.clone().add(s.clone().rot60(2)).add(s.clone().rot60(4)).shift(c, v))
}
// a ∨ one pen thick from (c−A, v) down to (c, v+A) and up to (c+A, v): scout's lower lid
const vee = (A, v, c = 0) => lp([[c - A, v], [c, v + A], [c + A, v], [c + A, v + 2], [c, v + A + 2], [c - A, v + 2]])

export const icons = {
  "dream:figure": {
    title: "dream",
    concept: "scout's eye shut: its lower lid alone, with scout's own ratchet of lashes flipped to hang beneath it — and out of the shut eye's corner a thought rises, a bead, a bigger bead, a bubble, and the bubble is the player's own cube drawn hollow: the ghost of you the dream follows through tomorrow's loop",
    draw() {
      const lid = I(vee(7, 5))
      lid.add(teeth(lid, [-6, -5, -4, -3, -2, 1, 2, 3, 4, 5]))
      return lid.fill(gem(-6, 1)).fill(hexA(1, -4, -4)).add(mark(4, 2, -4))
    }
  }
}
