// cand-folk — reworked identity icons for the folk family: rim, angle, hue, faction
import * as L from "../lat.mjs"
export const family = "cand-folk"

// ── lattice helpers (lattice vertex coords [c, v], c + v even) ──
const lp = pts => {
  for (const [c, v] of pts) if ((((c + v) % 2) + 2) % 2 !== 0) throw new Error(`odd vertex ${c},${v}`)
  return L.lpoly(pts)
}
// pointy-top hexagon of apothem a (strips) around (c, v)
const hexA = (a, c = 0, v = 0) => lp([[c, v - 2 * a], [c + a, v - a], [c + a, v + a], [c, v + 2 * a], [c - a, v + a], [c - a, v - a]])
const hexRing = (a, c = 0, v = 0, w = 1) => L.diff(hexA(a, c, v), hexA(a - w, c, v))
// vertical one-pen stroke in strip c..c+1 from v0 to v1, ends cut along 30° (s = +1 down-right, -1 up-right)
const vbar = (c, v0, v1, s0 = 1, s1 = 1) => lp([[c, v0], [c + 1, v0 + s0], [c + 1, v1 + s1], [c, v1]])
// a predicate written in lattice coords
const where = f => ({ in: (x, y) => f((x * 8) / L.SQ, y * 16) })
// YOUR MARK — the small solid diamond the identity triad shares
const mark = (c, v) => lp([[c - 2, v], [c, v - 2], [c + 2, v], [c, v + 2]])
// one ◀▶ diamond on vertex column c, row h (c + h odd)
const dia = (c, h) => {
  if ((((c + h) % 2) + 2) % 2 !== 1) throw new Error(`diamond ${c},${h} off-lattice`)
  return [[c - 1, h], [c, h]]
}
// iso rhombus of reach r (strips) around (c, v) — the flat face of a cube
const rh = (r, c = 0, v = 0) => lp([[c, v - r], [c + r, v], [c, v + r], [c - r, v]])
// a one-pen band leaning down-right along 30°, from vertex (c, v), n strips
const dband = (c, v, n) => lp([[c, v], [c + n, v + n], [c + n, v + n + 2], [c, v + 2]])
// a band on the up-right 30° axis, between the lines v = -c + a and v = -c + b, from strip c0 to c1 (a, b even)
const bandU = (c0, c1, a, b) => lp([[c0, -c0 + a], [c1, -c1 + a], [c1, -c1 + b], [c0, -c0 + b]])

export const icons = {
  rim: {
    title: "rim",
    concept: "the rim drawn double — the world's wall and the bank inside it — breached on one bearing: home's trail runs out through both walls to another world waiting in the corner",
    draw() {
      const ic = L.icon()
      // wall and bank, one pen each, a strip of paper between
      ic.fill(hexRing(6, -2, 2))
      ic.fill(hexRing(4, -2, 2))
      // the breach: the upper-right side of each, opened where the trail crosses it
      ic.clear(where((c, v) => c > -1.5 && c < 1.5 && v < c - 1 && v > c - 7))
      ic.clear(where((c, v) => c > -0.5 && c < 2.5 && v < c - 5 && v > c - 11))
      // home, the trail out on the 60° bearing, and the other world
      ic.fill(hexA(1, -2, 2))
      ic.set([...dia(-1, -2), ...dia(0, -5), ...dia(1, -8)])
      ic.fill(hexA(1, 2, -12))
      return ic
    }
  },
  angle: {
    title: "angle",
    concept: "∡° as the bar writes it — the noon leg up and the ray swung 120° clockwise from your mark, a dotted sweep between them, and the degree ring",
    draw() {
      const ic = L.icon()
      // noon, and the ray 120° clockwise of it, pinned at your mark
      ic.fill(vbar(-4, -12, 2, 1, -1))
      ic.fill(dband(-4, 0, 9))
      ic.fill(mark(-4, 2))
      // the sweep, dotted, on a hex arc between the legs
      ic.set([...dia(-2, -5), ...dia(0, -3), ...dia(1, 0)])
      // the °
      ic.fill(hexRing(2, 4, -8))
      return ic
    }
  },
  hue: {
    title: "hue",
    concept: "the brush in three tones — a one-pen handle, a chequered ferrule, a wide solid tuft frayed to sawtooth bristles — its tip just lifted from a one-pen tile, where it left the dab of your colour: what it touches is yours",
    draw() {
      const ic = L.icon()
      // the brush on the up-right 30° axis
      ic.fill(bandU(3, 7, -4, -2))
      ic.texture(bandU(1, 3, -6, 0), "right")
      ic.fill(bandU(-2, 1, -8, 2))
      ic.pattern(where((c, v) => c > -3 && c < -2 && v > -6 && v < 4), t => !t.right)
      // the tile, lying flat, and your dab on it
      ic.fill(L.diff(rh(6, -2, 8), rh(4, -2, 8)))
      ic.fill(mark(-2, 8))
      return ic
    }
  },
  faction: {
    title: "faction",
    concept: "a shield quartered like the wheel, noon at its chief — no lines between, the tones are the fronts: your quarter solid with your angle's ray cut through it, the opposite front in half-tone, the two others bare",
    draw() {
      const ic = L.icon()
      const out = where((c, v) => Math.abs(c) <= 6 && v >= -11 && v <= 8 - Math.abs(c))
      const inn = where((c, v) => Math.abs(c) <= 5 && v >= -9 && v <= 6 - Math.abs(c))
      ic.fill(L.diff(out, inn))
      // 0–90°: yours; 180–270°: its opposite
      ic.fill(L.inter(inn, where((c, v) => c > 0 && v < -2)))
      ic.texture(L.inter(inn, where((c, v) => c < 0 && v > -2)), "right")
      // your angle's ray, 60° from noon, cut in paper from the centre to the rim
      ic.clear(L.inter(bandU(0, 5, -4, -2), where(c => c > 0.5)))
      return ic
    }
  }
}
