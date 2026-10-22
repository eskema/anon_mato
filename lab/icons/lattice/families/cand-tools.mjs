import * as L from "../lat.mjs"
export const family = "cand-tools"

// ── helpers: lattice triangles (strip k, row h), lattice vertices (c, v), c+v even ──
const range = (a, b) => { const r = []; for (let i = a; i <= b; i++) r.push(i); return r }
const odd = n => ((n % 2) + 2) % 2 === 1
const mod = (a, m) => ((a % m) + m) % m
const lp = (...pts) => {
  for (const [c, v] of pts) if (odd(c + v)) throw new Error(`odd vertex ${c},${v}`)
  return L.lpoly(pts)
}
const mask = (...pts) => L.lpoly(pts)
const vs = (k, h0, h1) => range(Math.min(h0, h1), Math.max(h0, h1)).map(h => [k, h])
const row = (h, k0, k1) => range(k0, k1).map(k => [k, h])
const dn = (k0, h0, n) => { if (!odd(k0 + h0)) h0 -= 1; return range(0, n - 1).flatMap(i => [[k0 + i, h0 + i], [k0 + i, h0 + i + 1]]) }
const hexp = (c, v, r) => lp([c, v - 2 * r], [c + r, v - r], [c + r, v + r], [c, v + 2 * r], [c - r, v + r], [c - r, v - r])
const isUp = (t, M, s = 0) => { const a = mod(t.k + t.h - s, M); return a === 0 || a === 1 }
const isDn = (t, M, d = 1) => { const a = mod(t.h - t.k - d, M); return a === 0 || a === 1 }
const pen60 = (a, h0, h1) => range(-8, 7).flatMap(s => range(a - 3 * s, a - 3 * s + 3).filter(h => h >= h0 && h <= h1).map(h => [s, h]))

// ═══ THE CRAFT GRAMMAR — crude is knapped, fine is ground, and fine is MARKED ═══
// CRUDE = KNAPPED: half-tone, chipped edges and flake scars, a crooked branch, fat knots.
// FINE = GROUND (craft 6: lighter, quicker, never wears): the same drawing in the same place, every chip and lump
// ground off, the wood straight — and ONE mark that is the whole rule: the glint ✦, the same 7 triangles (a short
// vertical ray, two single-triangle arms) at the SAME spot in every fine icon, the hex's lower-right, centred on
// ▶ (5, 6), standing free in open paper. Handles run bottom-left and heads top-right, so that corner is the one
// every tool leaves empty: the maker's star, read at a glance at 16 px.
const G = [5, 6]
const glint = (ic, [k, h] = G) => {
  if (!odd(k + h)) throw new Error(`glint centre ${k},${h} must be a ▶`)
  return ic.set(vs(k, h - 2, h + 2)).set([[k - 1, h], [k + 1, h + 1]])
}
const collar60 = (ic, k, h, n = 3) => ic.set(dn(k, h, n))

// ── AXE (copied from the family): the cutter's blade on build's 60° line ──
const AXE_BLADE = lp([0, -6], [4, -10], [6, -8], [6, 0], [4, 2], [0, -2])
const AXE_IN_FINE = lp([5, -7], [4, -8], [1, -5], [1, -3], [4, 0], [5, -1])
const AXE_EDGE2 = mask([4, -12], [6, -12], [6, 4], [4, 4])
const AXE_AT = [-1, -1]

// ── NET (copied from the family) ──
const NET_UP = t => isUp(t, 6, 4)
const NET_DN = t => isDn(t, 6, 5)
const NET_IN = t => t.h >= -7 && t.k >= -6 && t.k <= 5 && t.h - t.k <= 6 && t.h + t.k <= 5
function netMesh() {
  const ic = L.icon()
  for (const t of L.TRIS) if (NET_IN(t) && (NET_UP(t) || NET_DN(t))) ic.on.add(t.id)
  return ic
}

// ── SPEAR: one long throw on the lattice's own 30° pen — the only diagonal a single pen draws razor-straight —
// ending in a slim leaf point. Strip k carries the shaft on rows −k, −k+1; the head widens off that band
// (rows above / below) to its shoulder near the socket, then runs its long flat top edge out to a ▶ point.
// PROFILE lists [rows above, rows below] the band, strip by strip from the socket.
const SP_K0 = -1
const SP_PROFILE = [[0, 1], [1, 2], [2, 2], [2, 1], [2, 0], [1, 0], [0, 0]]
const SP_TIP = [[6, -5]]
const SP_SCARS = [[1, 2], [3, -2]] // knapped: two flakes struck off the belly
const spShaft = (k0, k1) => range(k0, k1).flatMap(k => [[k, -k], [k, -k + 1]])
const spHead = () => SP_PROFILE.flatMap(([a, b], i) => { const k = SP_K0 + i; return vs(k, -k - a, -k + 1 + b) })
const spear = () => L.icon().set(spShaft(-7, SP_K0 - 1)).set(spHead()).set(SP_TIP)

// ── SNARE: the set, as it waits in the hare's run — a forked branch driven in for the stake, the noose laid open flat
// in the grass (an iso ring, the hand's lens), a slack end of cord between them; nothing hangs, nothing lines up ──
const lens = (c, v, a) => lp([c - a, v], [c, v - a], [c + a, v], [c, v + a])
const seg1 = ([c0, v0], [c1, v1]) => c0 === c1
  ? lp([c0, Math.min(v0, v1)], [c0, Math.max(v0, v1)], [c0 + 1, Math.max(v0, v1) + 1], [c0 + 1, Math.min(v0, v1) + 1])
  : lp([c0, v0], [c1, v1], [c1, v1 + 2], [c0, v0 + 2])
const SN_NOOSE = L.diff(lens(1, 1, 4), lens(1, 1, 2)) // (-3,1) (1,-3) (5,1) (1,5)
const SN_GRASS = row(7, -6, 0).filter(([k, h]) => !odd(k + h)) // the run: a sawtooth of grass
const SN_AT = [1, -1] // drawn against the left edge, then set one step in so it sits centred
const SN_FORK = L.union(seg1([-8, -8], [-7, -7]), seg1([-7, -7], [-5, -9]))
function snareBase() {
  const ic = L.icon().fill(SN_NOOSE).set(SN_GRASS)
  ic.fill(seg1([-6, 4], [-4, 2])) // the slack end, from the knot down to the stake
  return ic.fill(SN_FORK)
}

export const icons = {
  spear: {
    title: "spear",
    concept: "one long throw on the lattice's own 30° pen, the only diagonal one pen draws dead straight: a slim knapped leaf of a point, two flake scars chipped off its belly — barbs to hold an eel",
    draw() {
      return spear().set(SP_SCARS, false)
    }
  },
  "spear:fine": {
    title: "fine spear",
    concept: "the same throw, ground: the point keen and whole, not a scar on it — and the fine tools' glint in its place in the corner",
    draw() {
      return glint(spear())
    }
  },
  snare: {
    title: "snare",
    concept: "the set, waiting in the hare's run: a forked branch driven in for the stake (a snapped twig still on it), a fat slip knot, the noose laid open flat in the grass beside it — nothing hangs, so it reads as a trap and never as a gallows",
    draw() {
      const ic = snareBase()
      ic.fill(hexp(-3, 1, 1)).set([[-4, -1], [-3, 3]]) // the slip knot, fat and lumpy
      ic.set(vs(-7, -6, 8))
      return ic.set([[-8, -2], [-8, -1]]).shift(...SN_AT) // a snapped twig: it is a branch, not a peg
    }
  },
  "snare:fine": {
    title: "fine snare",
    concept: "the same set: the stake straight-grown, the slip knot a tight bead — and the fine tools' glint in its corner",
    draw() {
      const ic = snareBase()
      ic.fill(hexp(-3, 1, 1))
      ic.set(vs(-7, -6, 8))
      return glint(ic.shift(...SN_AT))
    }
  },
  "axe:fine": {
    title: "fine axe",
    concept: "ground, not knapped: the same blade drawn clean in one pen, its edge ground solid, the checker handle become one plain pen on the same 60° line, a neat collar where the X was — and the fine tools' glint, in the one corner every tool leaves free",
    draw() {
      const ic = L.icon().fill(AXE_BLADE).clear(AXE_IN_FINE).fill(L.inter(AXE_BLADE, AXE_EDGE2))
      ic.set(pen60(-6, -3, 10))
      collar60(ic, -3, -1)
      return glint(ic.shift(...AXE_AT))
    }
  },
  "net:fine": {
    title: "fine net",
    concept: "the same mesh tied tight — no fat knots — one sawtooth head-rope, a ground bead for a sinker, and the fine tools' glint in its corner, clear of the cord and the bead",
    draw() {
      const ic = netMesh()
      ic.set(row(-8, -6, 5).filter(([k, h]) => odd(k + h)))
      ic.set([[-1, 7], [0, 7]]).fill(hexp(0, 10, 1))
      return glint(ic)
    }
  },
}
