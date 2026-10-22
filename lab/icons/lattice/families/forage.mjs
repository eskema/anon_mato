import * as L from "../lat.mjs"
export const family = "forage"

// ── helpers (lattice triangles: strip k, row h; ▶ when k + h is odd) ──
const range = (a, b) => { const r = []; for (let i = a; i <= b; i++) r.push(i); return r }
const odd = n => ((n % 2) + 2) % 2 === 1
const isR = (k, h) => odd(k + h)
const vs = (k, h0, h1) => range(Math.min(h0, h1), Math.max(h0, h1)).map(h => [k, h]) // vertical one-pen stroke
// "\" one-pen stroke of n strips starting at strip k0, rows h0/h0+1 (smooth when k0+h0 odd)
const dn = (k0, h0, n) => { if (!odd(k0 + h0)) h0 -= 1; return range(0, n - 1).flatMap(i => [[k0 + i, h0 + i], [k0 + i, h0 + i + 1]]) }
// "/" one-pen stroke of n strips starting at strip k0, rows h0/h0+1 (smooth when k0+h0 even)
const up = (k0, h0, n) => { if (odd(k0 + h0)) h0 -= 1; return range(0, n - 1).flatMap(i => [[k0 + i, h0 - i], [k0 + i, h0 - i + 1]]) }
const row = (h, k0, k1) => range(k0, k1).map(k => [k, h])
const lp = (...pts) => L.lpoly(pts)
const hex = (c, v, s) => lp([c, v - 2 * s], [c + s, v - s], [c + s, v + s], [c, v + 2 * s], [c - s, v + s], [c - s, v - s])
// column runs: [[k, top, bottom], …]
const runs = (ic, spec, on = true) => { for (const [k, a, b] of spec) ic.set(vs(k, a, b), on); return ic }
// keep one orientation only (the half-tone)
const tex = (ic, right = true) => { for (const t of L.TRIS) if (ic.on.has(t.id) && t.right !== right) ic.on.delete(t.id); return ic }
// the family leaf: fruit's solid diamond, 4 strips by 4 rows, left tip at lattice vertex (c, v)
const leaf = (c, v) => lp([c, v], [c + 2, v - 2], [c + 4, v], [c + 2, v + 2])
// the egg: a tall stretched hex five strips wide — straight sides, 30° shoulders top and bottom, the two-strip
// crown set half a strip off centre so it leans; left side at c = a, crown at (a + 3, t), foot at (a + 2, t + 13)
const EGG = (a, t) => lp([a, t + 3], [a + 3, t], [a + 5, t + 2], [a + 5, t + 10], [a + 2, t + 13], [a, t + 11])
const EGG_IN = (a, t) => lp([a + 1, t + 4], [a + 3, t + 2], [a + 4, t + 3], [a + 4, t + 9], [a + 2, t + 11], [a + 1, t + 10])
const egg = (a, t) => L.icon().fill(EGG(a, t))
const eggIn = (a, t) => L.icon().fill(EGG_IN(a, t))

export const icons = {
  plants: {
    title: "plants",
    concept: "a frond of the plain's greens, its leaves laid alternately up a one-pen stem like the plies of a twisted cord",
    draw() {
      const ic = L.icon().set(vs(-1, -10, 10))
      const lfL = (v, n) => lp([-1, v], [-1, v - 4], [-1 - n, v - 4 - n], [-1 - n, v - n])
      const lfR = (v, n) => lp([0, v], [0, v - 4], [n, v - 4 - n], [n, v - n])
      ic.fill(lfL(7, 3)).fill(lfR(4, 3)).fill(lfL(1, 3)).fill(lfR(-2, 3)).fill(lfL(-5, 3)).fill(lfR(-8, 2))
      return ic.shift(0, 2)
    }
  },
  fruit: {
    title: "fruit",
    concept: "the apple drawn the way the lattice draws anything round, as a hex: notched shoulders, a stem, one solid leaf, a half-tone flank",
    draw() {
      const ic = L.icon()
      const outer = lp([0, -2], [-2, -4], [-5, -1], [-5, 5], [-1, 9], [0, 8], [1, 9], [5, 5], [5, -1], [2, -4])
      const inner = lp([0, 0], [-2, -2], [-4, 0], [-4, 4], [-1, 7], [0, 6], [1, 7], [4, 4], [4, 0], [2, -2])
      ic.fill(outer).clear(inner)
      ic.texture(lp([0, 0], [2, -2], [4, 0], [4, 4], [1, 7], [0, 6]), "right")
      ic.set(vs(0, -8, -2))
      ic.fill(leaf(1, -7))
      return ic
    }
  },
  roots: {
    title: "roots",
    concept: "the taproot pulled whole from the marsh: a lattice-round bulb, three blades from its crown, a rat-tail with rootlets",
    draw() {
      const ic = L.icon().fill(hex(0, 0, 3))
      ic.set(vs(-1, 6, 11)).set([[0, 7], [-2, 10]])                       // tail and rootlets
      ic.set(vs(-1, -11, -6))                                              // centre blade
      ic.set(dn(-4, -9, 3))                                                // left blade
      ic.set([[2, -10], [2, -9], [1, -9], [1, -8], [0, -8], [0, -7]])      // right blade
      return ic
    }
  },
  berries: {
    title: "berries",
    concept: "three berries on three stalks from one node, in three states: fresh and solid, going soft in half-tone, gone to an outline",
    draw() {
      const ic = L.icon()
      ic.fill(hex(-4, 0, 2)).clear(hex(-4, 0, 1))                       // gone: an outline
      ic.add(tex(L.icon().fill(hex(3, 1, 2))))                            // going soft: half-tone
      ic.add(L.icon().fill(hex(-1, 7, 2)).set([[-2, 5], [-2, 6]], false)) // fresh: solid, a glint
      ic.set(vs(-1, -10, 3)).set(up(-4, -5, 3)).set(dn(0, -7, 3))
      ic.fill(leaf(0, -10))
      return ic
    }
  },
  nuts: {
    title: "nuts",
    concept: "the acorn, the food that keeps: a half-tone cap fringed over a broad solid hull, a glint, a stub of stem",
    draw() {
      const ic = L.icon()
      const capF = lp([-4, -0.5], [-4, -4], [0, -8], [4, -4], [4, -0.5])
      const capI = lp([-3, -0.5], [-3, -3], [0, -6], [3, -3], [3, -0.5])
      ic.fill(capF).clear(capI).pattern(capI, t => (t.k < 0 ? !t.right : t.right))   // the basket's mirrored weave
      ic.set([[-3, 0], [-1, 0], [0, 0], [2, 0]])                                     // the cap's fringe
      ic.set(vs(-1, -9, -8))
      ic.add(runs(L.icon(), [[-3, 3, 9], [-2, 2, 10], [-1, 2, 11]]).symX())
      ic.set([[-2, 3], [-2, 4]], false)
      return ic
    }
  },
  oysters: {
    title: "oysters",
    concept: "the shell as a fan: solid ribs and paper grooves home to a narrow hinge, a scalloped lip, two ears",
    draw() {
      const ic = L.icon()
      for (const [k, t, b] of [[-6, -3, 0], [-5, -6, 1], [-4, -7, 2], [-3, -8, 3], [-2, -9, 4], [-1, -9, 5]]) {
        if (odd(k)) ic.set(vs(k, t, b))
        else ic.set(vs(k, t, t + 1)).set(vs(k, b - 1, b))
      }
      ic.set([...row(5, -3, -1), ...row(6, -3, -1), ...row(7, -2, -1)])
      return ic.symX().shift(0, 2)
    }
  },
  crabs: {
    title: "crabs",
    concept: "a crab squared up: half-tone back in a solid shell, eyes on stalks, solid pincers raised open, legs off the flanks",
    draw() {
      const ic = L.icon()
      ic.fill(lp([-5, 3], [0, -2], [5, 3], [5, 5], [0, 10], [-5, 5]))
      ic.texture(lp([-3, 3], [0, 0], [3, 3], [3, 5], [0, 8], [-3, 5]), "right")
      const half = L.icon()
      half.set(vs(-2, -4, 0)).set([[-3, -5], [-2, -5]])                                          // eye on a stalk
      half.fill(lp([-6, -2], [-6, -8], [-5, -9], [-5, -6], [-4, -7], [-3, -8], [-3, -3], [-4, -2]))  // open pincer
      half.set(dn(-5, -1, 3))                                                                     // arm
      half.set(up(-6, 5, 1)).set(up(-5, 8, 2))                                                    // legs
      return ic.add(half).add(half.clone().mirrorX())
    }
  },
  kelp: {
    title: "kelp",
    concept: "under the surface: three kelp fronds swaying up from a rock, each buoyed by a float just below the wave",
    draw() {
      const ic = L.icon().set([...up(-4, -9, 2), ...dn(-2, -10, 2), ...up(0, -9, 2), ...dn(2, -10, 2)])  // the surface
      ic.set([...row(8, -2, 0), ...row(9, -3, 1), ...row(10, -3, 1)])                                    // the rock
      // each frond: a float, then a one-pen stipe that sways once, ruffled on its outer edge
      ic.fill(hex(0, -4, 1)); runs(ic, [[-1, -1, 7]]); ic.set([[0, 1], [0, 3]])
      ic.fill(hex(-3, -1, 1)); runs(ic, [[-4, 2, 6], [-3, 6, 9]]); ic.set([[-5, 3], [-5, 5]])
      ic.fill(hex(3, -1, 1)); runs(ic, [[2, 2, 5], [1, 5, 9]]); ic.set([[3, 2], [3, 4]])
      return ic
    }
  },
  eggs: {
    title: "eggs",
    concept: "two cliff eggs leaning together on the nest's woven rim, each a tall stretched hex: one speckled, one plain",
    draw() {
      const speckled = egg(-6, -9).sub(eggIn(-6, -9)).add(tex(eggIn(-6, -9)))
      const plain = egg(-6, -9).sub(eggIn(-6, -9)).mirrorX()
      const ic = L.icon().add(speckled).add(plain)
      // the nest under their feet: a solid rim, a half-tone weave
      ic.set([...row(5, -6, 5), ...row(6, -6, 5)])
      ic.set(row(7, -6, 5).filter(([k, h]) => isR(k, h)))
      return ic
    }
  },
  herbs: {
    title: "herbs",
    concept: "the edelweiss of the heights: six woolly half-tone petals round heal's own solid hex, leaves rising off a one-pen stem",
    draw() {
      const petal = L.icon().fill(lp([0, -8], [1, -7], [1, -3], [0, -4], [-1, -3], [-1, -7]))   // one petal; rot60 makes the rest
      const star = L.icon()
      for (let r = 0; r < 6; r++) star.add(petal.clone().rot60(r))
      const rim = star.clone().outline()
      const ic = rim.add(tex(star.sub(rim))).fill(hex(0, 0, 1)).shift(0, -4)
      ic.set(vs(-1, 4, 12))
      ic.fill(lp([0, 8], [0, 6], [3, 3], [3, 5])).fill(lp([-1, 11], [-1, 9], [-4, 6], [-4, 8]))
      return ic
    }
  }
}
