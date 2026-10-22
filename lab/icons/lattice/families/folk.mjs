// folk — people, worlds & the social layer
import * as L from "../lat.mjs"
export const family = "folk"

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
const X = c => (c * L.SQ) / 8
const left = c => L.rect(-2, -2, X(c), 2)
const right = c => L.rect(X(c), -2, 2, 2)
// a predicate written in lattice coords
const where = f => ({ in: (x, y) => f((x * 8) / L.SQ, y * 16) })
// hex distance (apothem, in strips) of lattice point (c, v) from (c0, v0)
const hexd = (c, v, c0 = 0, v0 = 0) => Math.max(Math.abs(c - c0), (Math.abs(c - c0) + Math.abs(v - v0)) / 2)
// YOUR MARK — the small solid diamond the identity triad (faction, angle, hue) shares
const mark = (c, v) => lp([[c - 2, v], [c, v - 2], [c + 2, v], [c, v + 2]])
// one ◀▶ diamond on vertex column c, row h (c + h odd)
const dia = (c, h) => {
  if ((((c + h) % 2) + 2) % 2 !== 1) throw new Error(`diamond ${c},${h} off-lattice`)
  return [[c - 1, h], [c, h]]
}
// the hammer's handle: a chain of rhombi leaning 30° off vertical, from strip k row h (k + h even) down-left, n links
const chain = (k, h, n) => {
  const out = []
  for (let i = 0; i < n; i++) out.push([k - i, h + 3 * i], [k - i, h + 3 * i + 1], [k - i + 1, h + 3 * i + 1], [k - i + 1, h + 3 * i + 2])
  return out
}

// iso rhombus of reach r (strips) around (c, v) — the flat face of a cube
const rh = (r, c = 0, v = 0) => lp([[c, v - r], [c + r, v], [c, v + r], [c - r, v]])
// a vertical run of triangles in strip k, rows h0..h1
const run = (k, h0, h1) => Array.from({ length: h1 - h0 + 1 }, (_, i) => [k, h0 + i])
// the one-pen ring of a hex, keeping only some of its sides (0 right, 1 lower-right, 2 lower-left, 3 left, 4 upper-left, 5 upper-right)
const sides = (a, c, v, keep) => {
  const ring = L.icon().fill(hexRing(a, c, v))
  const out = L.icon()
  for (const id of ring.on) {
    const t = L.TRIS.find(q => q.id === id)
    const ang = (Math.atan2(t.cy - v / 16, t.cx - (c * L.SQ) / 8) * 180) / Math.PI
    if (keep.includes(Math.floor((((ang + 30) % 360) + 360) % 360 / 60))) out.on.add(id)
  }
  return out
}

// the skill wheel: three 120° arcs of one ring (apothem 7), a one-rhombus gap at every other corner
const wheel = () => {
  const ic = L.icon()
  const band = hexRing(7, 0, 0, 2)
  const line = hexRing(7, 0, 0, 1)
  // Time: the top chevron, solid, its four skills cut through it as slots
  ic.fill(L.inter(band, where((c, v) => v + c < -2 && v - c < -2)))
  const slot = k => [[k, k - 12], [k, k - 11], [-k - 1, k - 12], [-k - 1, k - 11]]
  ic.set([...slot(1), ...slot(3)], false)
  // Space: the right-hand arc in half-tone
  ic.texture(L.inter(band, where((c, v) => v + c > 2 && c > 1)), "right")
  // Mind: a bare line down the left, its four skills as teeth on the inner edge
  ic.fill(L.inter(line, where((c, v) => v - c > 2 && c < -1)))
  const teeth = L.icon().set([1, 4].flatMap(k => [[k, k - 11], [-k - 1, k - 11]])).rot60(4)
  return ic.add(teeth)
}

export const icons = {
  "skill wheel": {
    title: "skill wheel",
    concept: "the wheel as a triad: three 120° arcs of one ring, a gap at every other corner — Time solid across the top with its four skills cut through it as slots, Space in half-tone, Mind a bare line with four teeth",
    draw: () => wheel()
  },
  rim: {
    title: "rim",
    concept: "the rim of your world with one side swung open on its corner like a door, your trail walking out through it into another world's fog",
    draw() {
      const ic = L.icon()
      // the fog beyond the doorway
      ic.texture(where((c, v) => v < c - 7 && c > -4 && c < 3 && hexd(c, v) < 6.6 && !(Math.abs(c - 1) < 2.5 && Math.abs(v + 6) < 3)), "right")
      // the rim: one pen, its upper-right side gone from the frame
      const ring = hexRing(4, -1, 1)
      ic.fill(L.inter(ring, where((c, v) => !(v < c - 3 && c > -1 && c < 2))))
      // ...and standing open on its hinge, swung out to the vertical
      ic.fill(lp([[3, -9], [4, -10], [4, -4], [3, -3]]))
      // the trail out through the doorway
      ic.set([...dia(-1, 0), ...dia(0, -3), ...dia(1, -6)])
      return ic
    }
  },
  angle: {
    title: "angle",
    concept: "∠ — one stroke pinned at your mark and swung clockwise from noon, a dotted sweep between: the bare angle you chose blind",
    draw() {
      const ic = L.icon()
      // the legs: noon, and 120° clockwise of it, pinned at your mark
      ic.fill(lp([[-4, -10], [-3, -11], [-3, 3], [3, 9], [3, 11], [-4, 4]]))
      ic.fill(mark(-4, 4))
      // the sweep, dotted, at half the legs' reach
      ic.set([...dia(-1, -4), ...dia(1, -2), ...dia(2, 3)])
      return ic
    }
  },
  figure: {
    title: "figure",
    concept: "a figure seated cross-legged at the board's centre, hands folded, on a tasselled mat — the board itself",
    draw() {
      const ic = L.icon()
      ic.fill(hexA(2, 0, -6))
      // robe: hex-arch shoulders, arms, knees out — one pen
      ic.fill(lp([[0, -2], [3, 1], [3, 3], [5, 5], [5, 7], [2, 4], [2, 2], [0, 0], [-2, 2], [-2, 4], [-5, 7], [-5, 5], [-3, 3], [-3, 1]]))
      ic.set(dia(0, 5))
      // the mat: the front of an iso rhombus under him, half-tone, tassels at its corners
      ic.texture(where((c, v) => v > Math.abs(c) + 2 && v < 12 - Math.abs(c) && (v > 7 || Math.abs(c) > 2)), "right")
      ic.set([[5, 6], [5, 8], [-6, 6], [-6, 8]])
      return ic
    }
  },
  stranger: {
    title: "stranger",
    concept: "another player: your own cube glyph seen from below — its hidden face dark — on a body still coming out of the fog",
    draw() {
      const ic = L.icon()
      // head: a cube seen from beneath, the never-seen face solid
      ic.fill(hexRing(3, 0, -6))
      ic.fill(lp([[0, -12], [1, -11], [1, -7], [0, -6]]))
      ic.fill(lp([[0, -6], [3, -3], [0, 0], [-3, -3]]))
      // body: half-tone under one-pen shoulders, fraying out into fog
      // (woven like the dream mat: ▶ on the left, ◀ on the right, pointing in to the middle)
      const inward = t => (t.k < 0 ? t.right : !t.right)
      const kk = t => (t.k < 0 ? t.k : -t.k - 1)
      ic.pattern(where((c, v) => Math.abs(c) < 6 && v > Math.abs(c) + 2 && v < 9), inward)
      ic.pattern(where((c, v) => Math.abs(c) < 6 && v > Math.abs(c) + 2 && v >= 9 && v < 12 && hexd(c, v) < 6.4), t => inward(t) && (((kk(t) - t.h) % 4) + 4) % 4 === 1)
      ic.fill(lp([[0, 0], [6, 6], [6, 8], [0, 2], [-6, 8], [-6, 6]]))
      return ic
    }
  },
  faction: {
    title: "faction",
    concept: "a banner quartered like the wheel — four fronts, the one that is yours struck solid, its opposite in half-tone — your mark atop the pole, a fringe on the fly",
    draw() {
      const ic = L.icon()
      // the pole, your mark for its finial
      ic.fill(vbar(-4, -6, 10, 1, -1))
      ic.fill(mark(-3, -7))
      // the banner rising to the fly, one pen, quartered on lattice lines (c = 0, v = -c)
      const flag = lp([[-3, -3], [4, -10], [4, 2], [-3, 9]])
      const inner = lp([[-3, -1], [3, -7], [3, 1], [-3, 7]])
      ic.fill(L.diff(flag, inner))
      ic.fill(L.inter(inner, right(0), where((c, v) => v < -c)))
      ic.texture(L.inter(inner, left(0), where((c, v) => v > -c)), "right")
      // the fringe on the fly
      ic.set([[4, -9], [4, -7], [4, -5], [4, -3], [4, -1], [4, 1]])
      return ic
    }
  },
  hue: {
    title: "hue",
    concept: "a brush on the hammer's chequered handle, its solid tuft just touching a bare one-pen tile — and on the tile, a solid dab: the colour you put down is yours",
    draw() {
      const ic = L.icon()
      // the tile: a one-pen iso rhombus lying flat
      ic.fill(L.diff(rh(6, -1, 7), rh(4, -1, 7)))
      // the dab of paint at its lower left
      ic.fill(hexA(1, -2, 8))
      // the brush: build's chequered handle at 60°, then the solid tuft, its chisel tip on the tile's edge
      ic.set(chain(4, -10, 2))
      ic.set([...run(3, -4, -2), ...run(2, -4, 1), ...run(1, -3, 2)])
      return ic
    }
  },
  world: {
    title: "world",
    concept: "four boards dealt in spiral order, each sharing an edge with the next and fainter than the last — solid, outline, half-tone, then a rim broken open into the fog",
    draw() {
      const ic = L.icon()
      // clockwise from home: solid, then one pen, then half-tone...
      ic.fill(hexA(3, -2, -4))
      ic.fill(hexRing(3, 4, -4))
      ic.texture(hexA(3, 1, 5), "right")
      // ...then a smaller board, only its far rim left
      ic.add(sides(2, -4, 4, [2, 3, 4]))
      return ic
    }
  },
  log: {
    title: "log",
    concept: "the day as a scroll between two rollers, its lines dotted like text, a milled seal struck with the replay ▶ on its corner — a proof anyone can verify",
    draw() {
      const ic = L.icon()
      // page sides
      ic.fill(vbar(-4, -8, 8, 1, 1)).fill(vbar(3, -7, 9, -1, -1))
      // rollers: two-row solid bars, cut on the slant, a strip past the page each side
      const bar = h => { const out = []; for (let k = -5; k <= 4; k++) out.push([k, h], [k, h + 1]); return out }
      ic.set([...bar(-10), ...bar(8)]).set([[-5, -10], [4, -10]], false)
      // text: dotted lines three rows apart
      ic.set([...dia(-2, -5), ...dia(2, -5)])
      ic.set([...dia(-1, -2), ...dia(1, -2)])
      ic.set([...dia(-2, 1)])
      ic.set([...dia(-1, 4)])
      // the seal: a milled disc struck with the replay ▶, a strip of paper round it
      ic.clear(hexA(3, 3, 7))
      ic.fill(hexA(2, 3, 7))
      ic.clear(lp([[2, 4], [4, 6], [2, 8]]))
      ic.set([[0, 6], [1, 10], [5, 8], [4, 4], [2, 3]])
      return ic
    }
  },
  surplus: {
    title: "surplus",
    concept: "the year's cup heaped past the brim — a wide shallow bowl with handles curling up, on a short stem and a flat foot, its overflow mounded above the lip and dripping down the outside",
    draw() {
      const ic = L.icon()
      // the heap: half-tone, mounded above the lip
      ic.texture(lp([[-5, -5], [0, -10], [5, -5]]), "right")
      // the bowl: one pen, wide and shallow — the raft's hull
      ic.fill(L.diff(lp([[-5, -5], [-5, 1], [0, 6], [5, 1], [5, -5]]), lp([[-4, -6], [-4, 0], [0, 4], [4, 0], [4, -6]])))
      // the lip: a zigzag band across the brim
      for (let k = -5; k < 5; k++) ic.set([[k, -5], [k, -4]])
      // drips running down the outside, three lengths
      ic.set([...run(-3, -3, -2), ...run(0, -3, 0), ...run(2, -3, -1)])
      // handles curling upward
      ic.fill(lp([[5, 1], [6, 0], [6, -4], [7, -5], [7, 1], [5, 3]])).fill(lp([[-5, 1], [-6, 0], [-6, -4], [-7, -5], [-7, 1], [-5, 3]]))
      // a short stem on a flat rhombus foot — the solids
      ic.set([[-1, 6], [0, 6], [-1, 7], [0, 7]])
      ic.fill(rh(3, 0, 11))
      return ic
    }
  },
  gift: {
    title: "gift",
    concept: "a cube — a world, sealed — tied with ribbon, a bow standing on its peak: a parcel handed across from one world to another",
    draw() {
      const ic = L.icon()
      const top = lp([[0, -8], [5, -3], [0, 2], [-5, -3]])
      const lf = lp([[-5, -3], [0, 2], [0, 12], [-5, 7]])
      const rf = lp([[0, 2], [5, -3], [5, 7], [0, 12]])
      // the faces: paper lid, solid left, half-tone right
      ic.fill(lf)
      ic.texture(rf, "right")
      // the ribbon: a solid cross on the lid, running on down both faces
      ic.fill(L.inter(top, where((c, v) => v > c - 4 && v < c - 2)))
      ic.fill(L.inter(top, where((c, v) => v > -c - 4 && v < -c - 2)))
      ic.clear(L.inter(lf, right(-3), left(-2)))
      ic.fill(L.inter(rf, right(2), left(3)))
      // the bow: two loops standing on the peak, a diamond knot on the axis
      ic.fill(L.union(lp([[-2, -12], [0, -10], [-2, -8]]), lp([[2, -12], [0, -10], [2, -8]])))
      ic.set(dia(0, -9))
      return ic.shift(0, 2)
    }
  }
}
