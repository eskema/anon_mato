import * as L from "../lat.mjs"
import fs from "node:fs"
export const family = "tools"
const HAND = JSON.parse(fs.readFileSync(new URL("../hand.json", import.meta.url)))

// ── helpers: lattice triangles (strip k, row h), lattice vertices (c, v), c+v even ──
const range = (a, b) => { const r = []; for (let i = a; i <= b; i++) r.push(i); return r }
const odd = n => ((n % 2) + 2) % 2 === 1
const mod = (a, m) => ((a % m) + m) % m
const lp = (...pts) => {
  for (const [c, v] of pts) if (odd(c + v)) throw new Error(`odd vertex ${c},${v}`)
  return L.lpoly(pts)
}
const mask = (...pts) => L.lpoly(pts) // helper regions, any vertices
const vs = (k, h0, h1) => range(Math.min(h0, h1), Math.max(h0, h1)).map(h => [k, h])
const row = (h, k0, k1) => range(k0, k1).map(k => [k, h])
const dn = (k0, h0, n) => { if (!odd(k0 + h0)) h0 -= 1; return range(0, n - 1).flatMap(i => [[k0 + i, h0 + i], [k0 + i, h0 + i + 1]]) }
const up = (k0, h0, n) => { if (odd(k0 + h0)) h0 -= 1; return range(0, n - 1).flatMap(i => [[k0 + i, h0 - i], [k0 + i, h0 - i + 1]]) }
const hexp = (c, v, r) => lp([c, v - 2 * r], [c + r, v - r], [c + r, v + r], [c, v + 2 * r], [c - r, v + r], [c - r, v - r])
const lens = (c, v, a) => lp([c - a, v], [c, v - a], [c + a, v], [c, v + a])
const isUp = (t, M, s = 0) => { const a = mod(t.k + t.h - s, M); return a === 0 || a === 1 }
const isDn = (t, M, d = 1) => { const a = mod(t.h - t.k - d, M); return a === 0 || a === 1 }
const cols = (ic, spec, on = true) => {
  for (const [k, r] of Object.entries(spec)) for (const [a, b] of Array.isArray(r[0]) ? r : [r]) ic.set(vs(+k, a, b), on)
  return ic
}
const has = (ic, k, h) => { const t = L.triAt(k, h); return !!t && ic.on.has(t.id) }
// THE HANDLE — the hand's own (hand/build): a 60° checker chain, 4 triangles per 3 rows, running down-left
const chain60 = (k, h, n) => range(0, n - 1).flatMap(i => [[k - i, h + 3 * i], [k - i, h + 3 * i + 1], [k - i + 1, h + 3 * i + 1], [k - i + 1, h + 3 * i + 2]])
const BUILD_HANDLE = [...chain60(-1, -1, 4), [-4, 10]] // build's exact handle, butt and all
// the fine tier's handle: the same 60° line drawn as ONE PEN — strip s holds rows a−3s … a−3s+3 (a even), rows h0..h1
const pen60 = (a, h0, h1) => range(-8, 7).flatMap(s => range(a - 3 * s, a - 3 * s + 3).filter(h => h >= h0 && h <= h1).map(h => [s, h]))

// ═══ THE CRAFT GRAMMAR — the hand's three tones are the two tiers ═══
// CRUDE = KNAPPED: a half-tone body inside a hard rim, a sawtooth (chipped) working edge, an X of cord, fat knots,
// a crooked branch where a branch is the point (the snare's sapling).
// FINE = GROUND (craft 6: lighter, quicker, never wears): the same silhouette as a one-pen OUTLINE with paper
// inside, the working edge or point SOLID (keen, never chips), the wood straight and the same length, the X become
// a neat collar on the same rows, knots tied tight — and ONE small glint touching the working tip.
// THE GLINT: always these 7 triangles — a short vertical ray and two single-triangle arms, the ✦ of the lattice's
// own pen — centred on a ▶ (k + h odd), set in open paper so one arm just touches the working tip
const glint = (ic, k, h) => {
  if (!odd(k + h)) throw new Error(`glint centre ${k},${h} must be a ▶`)
  return ic.set(vs(k, h - 2, h + 2)).set([[k - 1, h], [k + 1, h + 1]])
}
// THE CRUDE KNOT: an X of cord across the haft, crossing at strip k, row h
const knotX = (ic, k, h, n = 1) => ic.set(dn(k - n, h - n, 2 * n + 1)).set(up(k - n, h + n, 2 * n + 1))
// THE FINE COLLAR: on the 60° handle, one short band square to it (along −30°), on the X's rows
const collar60 = (ic, k, h, n = 3) => ic.set(dn(k, h, n))

// ── THE BLADE: the cutter — horned, the edge taller than the back ──
const BLADE = lp([-3, -7], [-1, -9], [4, -4], [4, 2], [-1, 7], [-3, 5])
const BLADE_IN = lp([-2, -6], [-1, -7], [2, -4], [2, 2], [-1, 5], [-2, 4]) // crude: the back stays 2 strips
const TEETH = vs(-4, -6, 4).filter(([k, h]) => !odd(k + h)) // knapped: ◀ flake scars outside the edge
function bladeCrude() {
  const ic = L.icon().fill(BLADE)
  ic.clear(BLADE_IN).texture(BLADE_IN, "right")
  return ic.set(TEETH)
}

// ── THE AXE'S BLADE: the cutter's build at hafting size, turned edge-out to sit where build's long arm sits —
// back 4 rows on the handle's axis, horns 4 strips out, the edge 2 strips past them. Drawn here, then the whole
// axe is set one step up-left (AXE_AT) so blade and handle sit centred in the hex ──
const AXE_BLADE = lp([0, -6], [4, -10], [6, -8], [6, 0], [4, 2], [0, -2])
const AXE_IN = lp([5, -7], [4, -8], [2, -6], [2, -2], [4, 0], [5, -1]) // crude: the back stays 2 strips
const AXE_IN_FINE = lp([5, -7], [4, -8], [1, -5], [1, -3], [4, 0], [5, -1]) // fine: one pen all round
const AXE_EDGE2 = mask([4, -12], [6, -12], [6, 4], [4, 4]) // ground: the edge two strips
const AXE_TEETH = vs(6, -7, -1).filter(([k, h]) => odd(k + h)) // knapped: ▶ flake scars outside the edge
const AXE_HANDLE = [...chain60(-2, -2, 4), [-5, 9]] // build's handle, one step down-left: its axis through the back
const AXE_AT = [-1, -1]

// ── NET: two cords — the lattice's own two diagonals — crossing into a diamond mesh ──
// the bag's lower sides run ALONG the mesh, so the net closes on a knot at its foot (on c = 0, h 5)
const NET_UP = t => isUp(t, 6, 4)
const NET_DN = t => isDn(t, 6, 5)
const NET_IN = t => t.h >= -7 && t.k >= -6 && t.k <= 5 && t.h - t.k <= 6 && t.h + t.k <= 5
function netMesh() {
  const ic = L.icon()
  for (const t of L.TRIS) if (NET_IN(t) && (NET_UP(t) || NET_DN(t))) ic.on.add(t.id)
  return ic
}
// crossings: the ◀ of each ◀▶ pair where both cords pass
const crossings = ic => L.TRIS.filter(t => ic.on.has(t.id) && NET_UP(t) && NET_DN(t) && !t.right && has(ic, t.k + 1, t.h))
// a fat knot: a solid bead (the six triangles round the crossing's lower node) on every inside crossing, and the foot
function netKnots(ic) {
  for (const { k, h } of crossings(ic)) if ((h > -7 && h < 2) || (k === -1 && h === 5)) ic.set([[k, h + 2], [k + 1, h + 2]])
  return ic
}

// ── HAMMER: the crusher's pecked stone cut to build's head — an iso bar along −30° (2 deep, 6 long, 4 tall), its top
// face one pen in all half-tone, front and end solid — sitting on build's own handle exactly where build's head sits ──
const HAMMER_HEAD = lp([-2, -8], [0, -10], [6, -4], [6, 0], [4, 2], [-2, -4])
const HAMMER_TOP = lp([-1, -7], [0, -8], [5, -3], [4, -2])
// ── SPEAR: one long diagonal — the shaft build's 60° chain on the axis v = −3c − 4, from (2, −12) down to the head;
// the head the piercer's slim point: a 60° tip (a vertical and a 30° edge) at (−4, 8), its sides running up the axis
// in exact lattice staircases, its base V-notched (apex (−2, 2)) so the shaft's last step seats in it ──
const SP_HEAD = lp([-4, 8], [-4, 2], [-3, 1], [-3, -1], [-2, -2], [-2, 2], [0, 0], [0, 2], [-1, 3], [-1, 5], [-2, 6])
const SP_SHAFT = chain60(1, -11, 4) // four steps, the last one in the notch
const SP_TEETH = [[-5, 3], [-5, 5]] // knapped: two ◀ flake scars off the head's long edge — barbs
const SP_PEN = pen60(-6, -12, 1) // the fine shaft: the same line, one pen, run into the notch

// ── SNARE: a sapling bent over by the cord, its tip pulled down to the slip knot of a noose that lies flat in the
// hare's run beside it — the bent sapling is the spring, the flat loop the trap ──
// a one-pen band along a lattice polyline: verticals grow right, diagonals grow down
const seg1 = ([c0, v0], [c1, v1]) => c0 === c1
  ? lp([c0, Math.min(v0, v1)], [c0, Math.max(v0, v1)], [c0 + 1, Math.max(v0, v1) + 1], [c0 + 1, Math.min(v0, v1) + 1])
  : lp([c0, v0], [c1, v1], [c1, v1 + 2], [c0, v0 + 2])
const pen1 = pts => L.union(...pts.slice(1).map((p, i) => seg1(pts[i], p)))
const SN = { c: 3, v: 7, a: 4 } // the noose: a flat iso loop; its slip knot at the near (left) corner, on c = −1
const SN_BOW = [[-7, -5], [-6, -6], [-2, -2], [-2, 0]] // over the top: a short rise, the long shoulder pulled down
function snareBase(crude) {
  const { c, v, a } = SN
  const ic = L.icon()
  if (crude) {
    // the knapped tier's half-tone: a thick ring of rough cord
    const rope = L.diff(mask([c - a - 1, v], [c, v - a - 1], [c + a + 1, v], [c, v + a + 1]), mask([c - a + 2, v], [c, v - a + 2], [c + a - 2, v], [c, v + a - 2]))
    ic.texture(rope, "right")
  } else ic.fill(L.diff(lens(c, v, a), lens(c, v, a - 2)))
  ic.fill(hexp(c - a, v, 1)) // the slip knot
  if (crude) ic.set([[c - a - 1, v - 2], [c - a, v - 2], [c - a - 1, v + 2], [c - a, v + 2]]) // crude: a fat one
  ic.fill(pen1(SN_BOW))
  if (crude) cols(ic, { "-6": [2, 8], "-7": [-4, 3] }) // the trunk, grown with a jog
  else cols(ic, { "-7": [-4, 8] })
  // the cord from the bent tip down to the knot
  ic.set(vs(c - a - 1, 1, v - 2))
  return ic
}

export const icons = {
  cutter: {
    title: "cutter",
    concept: "the axe's head before the axe: a horned flint blade — knapped half-tone face, a thick solid back where the haft will sit, the thin edge chipped to a sawtooth, its flakes still falling",
    draw() {
      return bladeCrude().set([[-5, 5], [-6, 6], [-7, 7]]) // the flakes peeling off the knapped edge
    }
  },
  net: {
    title: "net",
    concept: "two cords knotted: the lattice's own two diagonals cross into a mesh closing on a knot at its foot, a fat knot at every crossing, a doubled head-rope, a rough stone sinker",
    draw() {
      const ic = netKnots(netMesh())
      ic.set(row(-9, -6, 5)).set(row(-8, -5, 4))
      ic.set([[-1, 7], [0, 7]]) // the cord: one ◆
      // a rough stone, lumpy and lopsided (the fine net grinds it to a bead)
      ic.fill(hexp(0, 10, 1)).set([[-2, 10], [-2, 11], [1, 10], [1, 11], [1, 12], [0, 12]])
      return ic
    }
  },
  axe: {
    title: "axe",
    concept: "the cutter hafted on build's own handle: the same knapped blade — horned, half-tone face, solid back, sawtooth edge — turned edge-out where build's head sits, its back on the 60° checker chain, an X of cord where the haft meets it",
    draw() {
      const ic = L.icon().fill(AXE_BLADE).clear(AXE_IN).texture(AXE_IN, "right").set(AXE_TEETH)
      ic.set(AXE_HANDLE)
      return knotX(ic, -2, 0).shift(...AXE_AT) // the X on the chain's first step, square on the haft
    }
  },
  snare: {
    title: "snare",
    concept: "a hex laid open in the hare's run: a crooked sapling bent over until its tip is tied down to the fat slip knot of a rough-cord noose lying flat beside it — the bent wood is the spring, the flat loop the trap",
    draw() {
      return snareBase(true)
    }
  },
  spear: {
    title: "spear",
    concept: "one long diagonal ending in a point: the piercer's slim head, knapped to two barbs, seated by its V-notch on the low end of build's long 60° checker chain",
    draw() {
      return L.icon().set(SP_SHAFT).fill(SP_HEAD).set(SP_TEETH)
    }
  },
  hammer: {
    title: "hammer",
    concept: "build's hammer made of the crusher's stone: the same iso bar on the same 60° checker handle, but the head pecked stone — its top face all half-tone — and an X of cord binding it to the haft",
    draw() {
      const ic = L.icon().fill(HAMMER_HEAD).clear(HAMMER_TOP).texture(HAMMER_TOP, "right")
      ic.set(BUILD_HANDLE)
      return knotX(ic, -1, 1) // on the handle's first step, just under the stone
    }
  },
  basket: {
    title: "basket",
    concept: "the gather basket put away: the hand's own flared body, chevron shoulders and diamond weave, its hoop handle traded for a one-pen lid with a knob — no longer carried, kept",
    draw() {
      const ic = L.fromData(HAND.gather)
      ic.set([[-1, -9], [0, -9], ...vs(-2, -8, -3), ...vs(1, -8, -3)], false) // the hoop handle off
      ic.fill(L.union(lp([-4, -4], [0, -8], [0, -6], [-4, -2]), lp([0, -8], [4, -4], [4, -2], [0, -6]))) // the lid
      return ic.set([[-1, -9], [0, -9]]) // its knob, a ◆
    }
  },
  "axe:fine": {
    title: "fine axe",
    concept: "ground, not knapped: the same blade drawn clean in one pen, its edge ground solid, the checker handle become one plain pen on the same 60° line, a neat collar where the X was — and the glint where the flakes were, touching the edge",
    draw() {
      const ic = L.icon().fill(AXE_BLADE).clear(AXE_IN_FINE).fill(L.inter(AXE_BLADE, AXE_EDGE2))
      ic.set(pen60(-6, -3, 10))
      collar60(ic, -3, -1) // on the X's rows
      return glint(ic.shift(...AXE_AT), 6, -5) // its left arm's tip on the edge
    }
  },
  "net:fine": {
    title: "fine net",
    concept: "the same mesh tied tight — no fat knots — one sawtooth head-rope, a ground bead for a sinker, and the glint at the foot",
    draw() {
      const ic = netMesh()
      ic.set(row(-8, -6, 5).filter(([k, h]) => odd(k + h)))
      ic.set([[-1, 7], [0, 7]]).fill(hexp(0, 10, 1))
      glint(ic, 2, 7)
      return ic
    }
  },
  "snare:fine": {
    title: "fine snare",
    concept: "the same snare: the sapling straight-grown, the noose one plain ring of cord, the slip knot a tight bead — and the glint on the loop",
    draw() {
      const ic = snareBase(false)
      glint(ic, 4, 1)
      return ic
    }
  },
  "spear:fine": {
    title: "fine spear",
    concept: "the same long diagonal, ground: the head clean-edged and keen, no flake scars, the checker shaft become one plain pen on the same 60° line — and the glint at the point",
    draw() {
      const ic = L.icon().set(SP_PEN).fill(SP_HEAD)
      return glint(ic, -6, 7) // its right arm's tip on the point
    }
  }
}
