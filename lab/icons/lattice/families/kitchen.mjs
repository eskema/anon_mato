import * as L from "../lat.mjs"
import { icons as FORAGE } from "./forage.mjs"
import { icons as QUARRY } from "./quarry.mjs"
export const family = "kitchen"

// ── helpers (triangle = strip k, row h; ▶ when k + h is odd; lattice vertex (c, v), c + v even) ──
const range = (a, b) => { const r = []; for (let i = a; i <= b; i++) r.push(i); return r }
const odd = n => ((n % 2) + 2) % 2 === 1
const vs = (k, h0, h1) => range(Math.min(h0, h1), Math.max(h0, h1)).map(h => [k, h])
const lp = (...pts) => {
  for (const [c, v] of pts) if (odd(c + v)) throw new Error(`odd vertex ${c},${v}`)
  return L.lpoly(pts)
}
const hexp = (c, v, r) => lp([c, v - 2 * r], [c + r, v - r], [c + r, v + r], [c, v + 2 * r], [c - r, v + r], [c - r, v - r])
const up = (k0, h0, n) => { if (odd(k0 + h0)) h0 -= 1; return range(0, n - 1).flatMap(i => [[k0 + i, h0 - i], [k0 + i, h0 - i + 1]]) }
const dn = (k0, h0, n) => { if (!odd(k0 + h0)) h0 -= 1; return range(0, n - 1).flatMap(i => [[k0 + i, h0 + i], [k0 + i, h0 + i + 1]]) }
const T = new Map(L.TRIS.map(t => [t.id, t]))
const nb = t => L.neighbours(t)
const nOn = (ic, t) => nb(t).filter(n => ic.on.has(n.id)).length
const shape = s => L.icon().fill(s)
const PEN = L.SQ / 8
// a one-pen band along a lattice segment: verticals grow t strips right (dir 1) or left; diagonals 2t rows down or up
function band([c0, v0], [c1, v1], t = 1, dir = 1) {
  if (c0 === c1) {
    const lo = Math.min(v0, v1), hi = Math.max(v0, v1)
    return lp([c0, lo], [c0, hi], [c0 + t * dir, hi + t], [c0 + t * dir, lo + t])
  }
  const d = 2 * t * dir
  return lp([c0, v0], [c1, v1], [c1, v1 + d], [c0, v0 + d])
}
const pen = (pts, t = 1, dir = 1) => L.union(...pts.slice(1).map((p, i) => band(pts[i], p, t, dir)))
// the triangles inside a lattice polygon lying within n pens of its edge: a clean one-pen OUTLINE (n = 1)
function rim(pts, n = 1, edges = null) {
  for (const [c, v] of pts) if (odd(c + v)) throw new Error(`odd vertex ${c},${v}`)
  const U = pts.map(([c, v]) => L.V(c, v))
  const poly = L.poly(U)
  const segs = U.map((p, i) => [p, U[(i + 1) % U.length]]).filter((_, i) => !edges || edges.includes(i))
  const ic = L.icon()
  for (const t of L.TRIS) {
    if (L.coverage(poly, t) < 0.5) continue
    let d = 9
    for (const [[ax, ay], [bx, by]] of segs) {
      const dx = bx - ax, dy = by - ay
      const s = Math.max(0, Math.min(1, ((t.cx - ax) * dx + (t.cy - ay) * dy) / (dx * dx + dy * dy)))
      d = Math.min(d, Math.hypot(ax + s * dx - t.cx, ay + s * dy - t.cy))
    }
    if (d < n * PEN - 1e-9) ic.on.add(t.id)
  }
  return ic
}
// keep only the triangles of a drawing that a texture picks: "right" ▶, "left" ◀, "diamonds" sparse ◆, or a predicate
function tex(ic, mode = "right") {
  const pick = typeof mode === "function" ? mode : t => {
    if (mode === "right") return t.right
    if (mode === "left") return !t.right
    if (mode === "diamonds") { const c = t.right ? t.k : t.k + 1; return (((c % 2) + 2) % 2 === 0) && ((((t.h - c - 1) / 2) % 2 + 2) % 2 === 0) }
  }
  for (const id of [...ic.on]) if (!pick(T.get(id))) ic.on.delete(id)
  return ic
}
const tone = (ic, right = true) => { for (const id of [...ic.on]) if (T.get(id).right !== right) ic.on.delete(id); return ic }
const mv = (pts, dc, dv) => pts.map(([c, v]) => [c + dc, v + dv])

// paper reachable from outside the hex through empty edge-neighbours
function outside(ic) {
  const seen = new Set()
  const q = L.TRIS.filter(t => nb(t).length < 3 && !ic.on.has(t.id))
  q.forEach(t => seen.add(t.id))
  while (q.length) { const t = q.pop(); for (const n of nb(t)) if (!ic.on.has(n.id) && !seen.has(n.id)) { seen.add(n.id); q.push(n) } }
  return seen
}
const sil = ic => { const o = outside(ic); const s = L.icon(); for (const t of L.TRIS) if (!o.has(t.id)) s.on.add(t.id); return s }
function dilate(ic, n = 1) { let cur = ic.clone(); for (let i = 0; i < n; i++) { const nx = cur.clone(); for (const id of cur.on) for (const m of nb(T.get(id))) nx.on.add(m.id); cur = nx } return cur }
function comps(ic, on = true) {
  const seen = new Set(), out = []
  const inSet = t => ic.on.has(t.id) === on
  for (const t0 of L.TRIS) {
    if (!inSet(t0) || seen.has(t0.id)) continue
    const c = [t0]; seen.add(t0.id)
    for (let i = 0; i < c.length; i++) for (const n of nb(c[i])) if (inSet(n) && !seen.has(n.id)) { seen.add(n.id); c.push(n) }
    out.push(c)
  }
  return out
}
// enclosed paper: the holes of a drawing (paper not reachable from outside)
const holes = ic => { const o = outside(ic); return comps(ic, false).filter(c => !o.has(c[0].id)) }
// lay a part over a drawing with a paper halo
const over = (ic, part, h = 1) => ic.sub(dilate(sil(part), h)).add(part)

// ── THE STICK: every skewer in the kitchen rides ONE line — the +30° band between c+v = −2 and c+v = 0 — and
// ends at ONE place: strip −7, cut vertical (60° to the stick), one strip inside the rim. Only the handle shows. ──
const stickTri = k => [[k, -2 - k], [k, -1 - k]]
const stick = (k0, k1) => range(k0, k1).flatMap(stickTri)
const HANDLE_END = -7

export const icons = {}

// sawtooth: single triangles in a region that share an edge with the drawing, picked by a predicate
function teeth(ic, region, pick = () => true) {
  const add = []
  for (const t of L.TRIS) if (!ic.on.has(t.id) && L.coverage(region, t) >= 0.5 && pick(t) && nb(t).some(m => ic.on.has(m.id))) add.push(t.id)
  add.forEach(id => ic.on.add(id))
  return ic
}
// ── THE FIRE, the set's one flame (hearth's, drawn large): a solid core with a V at the foot, rising in eight
// strips whose tops step like hearth's — a low outer shoulder, a one-strip tongue, a notch, the tall middle tongue
// with its shoulder beside it, a notch, a one-strip tongue, a low outer shoulder; every top cut at 30°, the three
// tongues' all rising the one way the wind takes them. FLAME_TOPS gives each strip k its top edge (k, a) → (k + 1, b);
// the foot is the V v = 4 − |c|. Other families can take it as flame(dc, dv) ──
const FLAME_TOPS = { "-4": [-2, -3], "-3": [-7, -8], "-2": [-4, -5], "-1": [-11, -12], "0": [-8, -7], "1": [-5, -6], "2": [-8, -9], "3": [-3, -2] }
export function flame(dc = 0, dv = 0) {
  const foot = c => 4 - Math.abs(c)
  return shape(L.union(...Object.entries(FLAME_TOPS).map(([k, [a, b]]) => { k = +k; return lp([k, a], [k + 1, b], [k + 1, foot(k + 1)], [k, foot(k)]) }))).shift(dc, dv)
}
const LOGS = () => over(shape(lp([-3, 3], [3, 9], [3, 11], [-3, 5])), shape(lp([-3, 9], [3, 3], [3, 5], [-3, 11])))
// ── THE SKEWER'S SERVING: an iso cube — the top seared solid, the left face half-tone, the right face paper in a pen ──
function cube(c, v) {
  const top = lp([c, v - 4], [c + 2, v - 2], [c, v], [c - 2, v - 2])
  const left = lp([c - 2, v - 2], [c, v], [c, v + 4], [c - 2, v + 2])
  const right = lp([c, v], [c + 2, v - 2], [c + 2, v + 2], [c, v + 4])
  const hexr = rim([[c, v - 4], [c + 2, v - 2], [c + 2, v + 2], [c, v + 4], [c - 2, v + 2], [c - 2, v - 2]])
  const ic = shape(top).add(tone(shape(left)))
  for (const id of hexr.on) if (L.coverage(right, T.get(id)) >= 0.5) ic.on.add(id)
  return ic
}
// ── THE POT: fired clay — a round belly in one pen rising through a short neck to a narrow iso mouth brimming with
// stew (solid), cord-marks pressed in a sawtooth under the shoulder, the belly's foot blackened by the fire in
// half-tone, two nub lugs at mid-belly, a short foot ──
const POT = [[-3, -9], [0, -12], [3, -9], [3, -7], [5, -5], [5, 3], [0, 8], [-5, 3], [-5, -5], [-3, -7]]
const POT_MOUTH = [[-3, -9], [0, -12], [3, -9], [0, -6]]
function pot(dc = 0, dv = 0, { soot = true, mouth = true } = {}) {
  const M = pts => mv(pts, dc, dv)
  const ic = rim(M(POT))
  if (mouth) ic.fill(lp(...M(POT_MOUTH)))
  teeth(ic, lp(...M([[-5, -5], [-3, -7], [3, -7], [5, -5], [5, -3], [-5, -3]])), t => t.k < dc ? !t.right : t.right)
  if (soot) ic.add(tone(shape(lp(...M([[-5, -3], [0, 2], [5, -3], [5, 3], [0, 8], [-5, 3]])))))
  ic.set([[5, -1], [5, 0], [5, 1], [-6, -1], [-6, 0], [-6, 1]].map(([k, h]) => [k + dc, h + dv]))
  return ic.fill(lp(...M([[-2, 6], [0, 8], [2, 6], [2, 8], [0, 10], [-2, 8]])))
}
// a wisp of steam: one pen, a jog to the side halfway up
const wisp = (k, h) => [...vs(k, h - 1, h), ...up(k + 1, h - 2, 1), ...vs(k + 1, h - 5, h - 3)]
// a ◆ fleck two strips wide, its left tip at (c, v)
const fleck = (c, v) => lp([c, v], [c + 1, v - 1], [c + 2, v], [c + 1, v + 1])
// the hexagram: a hex of six around a lattice vertex (c, v) with a point on each edge — the herbs' star, small
function hexagram(c, v) {
  const ic = L.icon().fill(hexp(c, v, 1))
  ic.set([[c + 1, v], [c - 2, v], [c, v - 2], [c - 1, v - 2], [c, v + 2], [c - 1, v + 2]])
  return ic
}
// the forage berry, two ways: an outline ring, or a half-tone cluster
const berryRing = (c, v) => shape(L.diff(hexp(c, v, 2), hexp(c, v, 1)))
const berryTone = (c, v) => tone(shape(hexp(c, v, 2)))
// the quarry's fish face (its head wedge, paper eye, meshed body, swallowtail), without its water
const FISH_HEAD = [[-7, -3], [-2, -8], [-2, 2]]
const MESH = t => ((((t.right ? t.k : t.k + 1) % 2) + 2) % 2) === 0
function fishFace(dc = 0, dv = 0) {
  const M = pts => mv(pts, dc, dv)
  const ic = L.icon().fill(lp(...M([[-7, -3], [-1, -9], [5, -3], [-1, 3]]))).clear(lp(...M([[-5, -3], [-1, -7], [3, -3], [-1, 1]])))
  ic.fill(lp(...M(FISH_HEAD))).set(M([[-5, -3], [-4, -3]]), false)
  ic.pattern(lp(...M([[-2, -6], [-1, -7], [3, -3], [-1, 1], [-2, 0]])), MESH)
  ic.fill(lp(...M([[3, -3], [7, -7], [7, 1]]))).clear(lp(...M([[7, -5], [5, -3], [7, -1]])))
  return ic
}
// the quarry's hare head: the wedge face, paper eye, one ear up and one laid back (ears given by the caller)
const HARE_HEAD = [[-3, -7], [-1, -5], [-1, -1], [-3, 1], [-5, -1], [-6, -2], [-6, -4], [-5, -5]]
const hareHead = (dc = 0, dv = 0) => L.icon().fill(L.lpoly(mv(HARE_HEAD, dc, dv))).set(mv([[-5, -3], [-4, -3]], dc, dv), false)

const part = (ic, pred) => { const o = L.icon(); for (const id of ic.on) if (pred(T.get(id))) o.on.add(id); return o }
// lay parts one over the next, each with its paper halo
const layer = (...parts) => parts.reduce((ic, p) => over(ic, p))

// the herbs' flower head, small: heal's solid hex for a heart, a paper ring, and six solid petals in the ring
// beyond it, one at each corner of the hex
function flower(c, v) {
  const ic = L.icon().fill(hexp(c, v, 1))
  const [x0, y0] = L.V(c, v)
  const band = L.icon().fill(hexp(c, v, 3)).sub(L.icon().fill(hexp(c, v, 2)))
  for (const id of band.on) {
    const t = T.get(id)
    const a = ((Math.atan2(t.cx - x0, y0 - t.cy) * 180 / Math.PI) % 60 + 60) % 60
    if (Math.min(a, 60 - a) <= 20) ic.on.add(id)
  }
  return ic
}
// meal:dish's one-pen chevron bowl, its lip at (±7, v0)
const bowlV = (v0 = 3) => shape(lp([-7, v0], [0, v0 + 7], [7, v0], [7, v0 + 2], [0, v0 + 9], [-7, v0 + 2]))
const berrySolid = (c, v) => shape(hexp(c, v, 2))
// the apple, small (garden bowl's hex r3 in one pen, the forage stem and solid leaf), one of its six lattice
// wedges cut out solid and moved one step out from the core (sector 0 = upper right, clockwise)
function slicedApple(c, v, sector = 0) {
  const P = [[c, v - 6], [c + 3, v - 3], [c + 3, v + 3], [c, v + 6], [c - 3, v + 3], [c - 3, v - 3]]
  const sec = lp([c, v], P[sector], P[(sector + 1) % 6])
  const [dc, dv] = [[1, -1], [2, 0], [1, 1], [-1, 1], [-2, 0], [-1, -1]][sector]
  const ic = part(rim(P), t => L.coverage(sec, t) < 0.5).add(shape(sec).shift(dc, dv))
  return ic.set(vs(c, v - 9, v - 7)).fill(fleck(c + 1, v - 9))
}
// the pot's own shell — the one-pen belly and neck, the stew-dark mouth, the foot — with the lugs asked for
function potShell(dc, dv, lugs = [-6, 5]) {
  const M = pts => mv(pts, dc, dv)
  const ic = rim(M(POT)).fill(lp(...M(POT_MOUTH)))
  for (const k of lugs) ic.set([[k + dc, dv - 1], [k + dc, dv], [k + dc, dv + 1]])
  return ic.fill(lp(...M([[-2, 6], [0, 8], [2, 6], [2, 8], [0, 10], [-2, 8]])))
}
// the marsh's one water stroke: a one-pen zigzag, teeth two strips wide, crests at v0 − 2
const marshWave = (c0, c1, v0) => { const z = []; for (let c = c0, i = 0; c <= c1; c += 2, i++) z.push([c, v0 - (i % 2) * 2]); return shape(pen(z)) }

Object.assign(icons, {
  fire: {
    title: "fire",
    concept: "the cook's centre and the dark's one light, and the set's one flame, hearth's drawn large: a solid core rising into three vertical one-strip tongues, the middle one tallest with a shoulder beside it, notches between, low shoulders outside, every top cut at 30° and the tongues all rising the one way the wind takes them, standing in the crook of its fuel — two branches crossed in iso",
    draw() { return flame().add(LOGS()) }
  },
  skewer: {
    title: "skewer",
    concept: "the first way to cook, before any pot: three servings of one kind threaded corner to corner up the +30° line — three iso cubes, top seared solid, one face half-tone, one paper — and a short handle cut at 60°",
    draw() { return cube(-3, 3).add(cube(1, -1)).add(cube(5, -5)).set(stick(HANDLE_END, -6)) }
  },
  pot: {
    title: "pot",
    concept: "fired clay, for later: a round belly in one pen rising through a short neck to a narrow iso mouth brimming with stew in solid, cord-marks pressed in sawtooth under the shoulder, the belly's foot blackened by the fire in half-tone, two nub lugs, a short foot",
    draw() { return pot(0, 0) }
  },
  "meal:dish": {
    title: "meal",
    concept: "any dish at all: the food heaped as an outlined half-tone dome seated right in a shallow one-pen bowl on a short foot, three wisps of steam",
    draw() {
      const dome = [[-6, 2], [-6, 0], [0, -6], [6, 0], [6, 2], [0, 8]]
      const ic = rim(dome, 1, [0, 1, 2, 3, 4]).add(tone(shape(lp(...dome))))
      ic.fill(lp([-7, 1], [0, 8], [7, 1], [7, 3], [0, 10], [-7, 3]))
      ic.fill(lp([-1, 9], [0, 10], [1, 9], [1, 11], [0, 12], [-1, 11]))
      return ic.set(wisp(-4, -8)).set(wisp(-1, -9)).set(wisp(2, -8)).shift(0, 2)
    }
  },
  "fruit salad": {
    title: "fruit salad",
    concept: "berries + fruit, piled in meal:dish's one-pen bowl: the apple at the back with one of its six lattice wedges cut out solid and pulled off its side like a tile wedge, pointing back into the notch it left, and in front of it, all touching, three berries in the hand's three tones — the ring, the half-tone, the solid",
    draw() { return layer(bowlV(5), slicedApple(0, -4, 1), berryRing(-4, 2), berrySolid(4, 2), berryTone(0, 4)) }
  },
  "trail mix": {
    title: "trail mix",
    concept: "berries + nuts, the mix that keeps twice as long: a pouch in one pen cinched TWICE at the neck — two stacked ∧ ties — its mouth open on a solid berry and an acorn cap side by side",
    draw() {
      const ic = rim([[-2, 0], [-5, 3], [-5, 7], [0, 12], [5, 7], [5, 3], [2, 0]], 1, [0, 1, 2, 3, 4, 5])
      ic.fill(lp([-3, -1], [0, -4], [3, -1], [3, 1], [0, -2], [-3, 1]))
      ic.fill(lp([-3, -5], [0, -8], [3, -5], [3, -3], [0, -6], [-3, -3]))
      ic.set([...vs(-3, -9, -7), ...vs(2, -9, -7)])
      ic.fill(hexp(-1, -11, 1)).fill(lp([0, -10], [2, -12], [4, -10])).set([[1, -9], [3, -9]])
      return ic
    }
  },
  omelette: {
    title: "omelette",
    concept: "eggs + herbs: an egg broken on the hot stone — a one-pen white in three clean lobes, the yolk heal's solid hex with one paper glint, a pinch of herbs in two ◆ flecks on the 30° line",
    draw() {
      const WHITE = [[-1, -9], [1, -7], [3, -9], [6, -6], [6, 0], [4, 2], [4, 6], [0, 10], [-2, 8], [-4, 10], [-7, 7], [-7, 1], [-5, -1], [-5, -5]]
      return rim(WHITE).fill(hexp(0, 0, 2)).set([[0, -1]], false).fill(fleck(-5, 3)).fill(fleck(-3, 5))
    }
  },
  "herbed fish": {
    title: "herbed fish",
    concept: "fish + herbs: the quarry's fish laid out whole — head and paper eye, diamond-mesh body, swallowtail — with the herbs' flower head laid across its back, solid petals round a paper ring and a solid heart, breaking the fish's outline like a garnish",
    draw() { return over(fishFace(0, 4), flower(0, -6)) }
  },
  "surf & turf": {
    title: "surf & turf",
    concept: "fish + hare as one creature: the hare's head and ears grown onto the fish's meshed body and swallowtail, swimming where the sea's zigzag runs out onto a ground line in grass",
    draw() {
      const ic = part(fishFace(0, 0), t => t.k >= -2)
      ic.add(hareHead(-1, -1)).set(vs(-4, -10, -8)).set(up(-3, -8, 3)).set([[-3, -7]])
      ic.fill(pen([[-6, 6], [-4, 4], [-2, 6], [0, 4]]))
      ic.set(range(0, 5).flatMap(k => [[k, 6], [k, 7]]))
      return ic.set([[1, 5], [1, 4], [3, 5], [3, 4], [2, 5], [5, 5], [5, 4], [4, 5]])
    }
  },
  "marsh pot": {
    title: "marsh pot",
    concept: "eel + roots in the kitchen's own pot: the pot's one-pen belly, dark mouth and foot, filled with the marsh's zigzag water; the root's three blades rising out of the mouth, and the eel draped over the rim — its body laid along the shoulder and hanging past the wall, the sawtooth fin up its back",
    draw() {
      // the pot one strip left of centre, so the eel hanging off its right shoulder keeps its air
      const ic = potShell(-1, 3, [-6]).add(marshWave(-5, 3, 3))
      ic.set(vs(-2, -12, -9)).set(dn(-4, -10, 2)).set(up(-1, -9, 2)) // the root's three blades
      // the eel: its body laid along the shoulder as the rim, fin teeth up its back, its tail hanging past the wall
      const eel = dn(0, -5, 6), h0 = eel[0][1]
      ic.set(eel).set([1, 3, 5].map(i => [i, h0 + i - 1]))
      ic.set(vs(5, h0 + 6, h0 + 11))
      return ic.set([1, 3, 5].map(h => [6, h]).filter(([k, h]) => odd(k + h)))
    }
  },
  "garden bowl": {
    title: "garden bowl",
    concept: "fruit + nuts + plants: the apple stuffed with the acorn cap's own weave, sitting deep in a one-pen bowl, a leaf of the plains' greens tucked in behind",
    draw() {
      const ic = rim([[-6, 0], [-6, 4], [0, 10], [6, 4], [6, 0], [0, 6]], 1, [0, 1, 2, 3])
      ic.fill(lp([-6, -2], [-6, -6], [-3, -9], [-3, -5]))
      const A = [[1, -7], [4, -4], [4, 2], [1, 5], [-2, 2], [-2, -4]]
      return over(ic, rim(A).add(tex(shape(lp(...A)).sub(rim(A)), t => (t.k < 0 ? !t.right : t.right))).set(vs(1, -10, -8)).fill(fleck(2, -10)))
    }
  },
  "shore platter": {
    title: "shore platter",
    concept: "crabs + kelp + oysters: the crab served whole, claws raised, on the oyster's own ribbed shell laid flat for a platter, over the kelp's surface wave",
    draw() {
      const F = [[-7, 1], [0, -6], [7, 1], [0, 8]]
      const ic = rim(F).add(tex(shape(lp(...F)).sub(rim(F)), t => odd(t.k)))
      const crab = L.icon().fill(hexp(0, 0, 2))
      const half = L.icon().fill(L.lpoly([[-6, -2], [-6, -8], [-5, -9], [-5, -6], [-4, -7], [-3, -8], [-3, -3], [-4, -2]])).shift(1, -1).set(dn(-4, 0, 2))
      over(ic, crab.add(half).add(half.clone().mirrorX()))
      ic.set([...up(-4, 11, 2), ...dn(-2, 10, 2), ...up(0, 11, 2), ...dn(2, 10, 2)])
      return ic.set([[-4, 11], [3, 11]], false) // the wave's ends cut at 60°, clear of the rim
    }
  },
  "hunter's stew": {
    title: "hunter's stew",
    concept: "hare + herbs + roots, the richest: the big pot itself, full to the lip, the hare sunk in the solid stew to the chin with only its eye and ears up, the herbs' six-pointed star at one shoulder and the roots' leaf tuft at the other",
    draw() {
      const ic = pot(0, 4).add(L.icon().fill(L.lpoly(mv(HARE_HEAD, 2, -2))).set(vs(-1, -13, -10)).set(up(0, -10, 2)).set([[0, -9]]))
      ic.set(mv([[-5, -3], [-4, -3]], 2, -2), false) // the hare's paper eye, cut through head and stew alike
      over(ic, hexagram(-5, -5))
      return over(ic, L.icon().set([...vs(5, -6, -4), ...up(4, -4, 1), ...dn(5, -8, 1)]).set([[5, -7], [6, -8], [6, -7]]).shift(0, 2))
    }
  },
})

// ════ THE GRAMMARS ════
const FOODS = ["plants", "fruit", "roots", "berries", "nuts", "oysters", "crabs", "kelp", "eggs", "herbs", "fish", "hare", "eel"]
const RAW = f => (FORAGE[f] || QUARRY[f]).draw().clone()
const isRim = t => nb(t).length < 3

// ── COOKED: the raw face set in CAPITALS and served on the kitchen's one stick ──
// 1 close: every one-triangle hole fills (the half-tones go solid), and a regular mesh of two-triangle holes with
//   it; a two-triangle hole that stands alone (an eye, a glint) is the face and stays paper
// 2 bold: every stroke takes a second pen on its inner side, laid one step toward the food's centre — unless ink
//   lies within three steps beyond it (a gap, a channel, the far side of a hole): there it keeps its single pen.
//   Foods already solid in the body take "close" alone; the apple fills whole and gets its ring back as paper
// 3 the stick: one handle out of the lower-left on the +30° line, ending where the skewer icon's handle ends; the
//   food slides as little as it can to sit on the stick 2–4 strips from the end, never nearer the rim
const pen30 = (m, k0, k1) => range(k0, k1).flatMap(k => [[k, 2 * m - k], [k, 2 * m + 1 - k]]) // a "/" pen between c+v = 2m and 2m+2
const pen_30 = (m, k0, k1) => range(k0, k1).flatMap(k => [[k, k + 1 + 2 * m], [k, k + 2 + 2 * m]]) // a "\\" pen between v-c = 2m and 2m+2
const at = (...cells) => t => cells.some(([k, h]) => t.k === k && t.h === h)
const COOK = {
  plants: { mode: "bold" }, roots: { mode: "bold" }, oysters: { mode: "bold" }, eel: { mode: "bold" },
  kelp: { mode: "bold", mask: t => t.h > -8 },             // the surface stays one pen: it is the kelp's sign
  fruit: { mode: "fill", ring: [[0, 2], [-2, 0], [-3, 1], [-3, 3], [-1, 5], [0, 4], [1, 5], [3, 3], [3, 1], [2, 0]] },
  herbs: { mode: "close", drop: t => t.h >= 3 },           // the flower head alone goes on the stick
  berries: { mode: "close", cut: [[2, 0], [3, 0]] },      // one paper ◆ keeps the cluster a bunch, not a burr
  nuts: { mode: "close" }, eggs: { mode: "close" },
  crabs: { mode: "close", cut: [...pen30(2, -2, -1), ...pen_30(2, 0, 1)], // the back's seam, a small ∧ in paper; served legless
    drop: at([-5, 7], [-5, 8], [-4, 6], [-4, 7], [4, 7], [4, 8], [3, 6], [3, 7], [-6, 4], [-6, 5], [5, 4], [5, 5]) },
  fish: { mode: "close", drop: t => t.h >= 3 },            // out of the water now
  hare: { mode: "close", cut: pen30(1, 0, 3), drop: t => t.k === -3 && t.h <= -12 }, // the haunch in paper; the ear off the rim
}
function closeHoles(raw) {
  const ic = raw.clone()
  const hs = holes(raw)
  const pairs = hs.filter(h => h.length === 2)
  for (const h of hs) {
    if (h.length > 2) continue
    const near = dilate(L.icon().set(h.map(t => [t.k, t.h])), 4)
    if (h.length === 2 && pairs.filter(o => o !== h && o.some(t => near.on.has(t.id))).length < 3) continue
    for (const t of h) ic.on.add(t.id)
  }
  return { ic, keep: new Set(hs.filter(h => h.length === 2 && !h.every(t => ic.on.has(t.id))).flatMap(h => h.map(t => t.id))) }
}
function bold(A, keep, mask = null) {
  const out = A.clone()
  const step = (t, d, n) => L.triAt(t.k + d[0] * n, t.h + d[1] * n)
  let cx = 0; for (const id of A.on) cx += T.get(id).cx; cx /= A.on.size
  for (const id of A.on) {
    const a = T.get(id)
    if (mask && !mask(a)) continue
    const sx = a.cx > cx + 0.6 * PEN ? -1 : 1
    for (const d of [[sx, 1], [sx, -1]]) {
      const t = step(a, d, 1)
      if (!t || A.on.has(t.id) || isRim(t) || keep.has(t.id) || nOn(A, t) >= 2) continue
      if ([2, 3].some(n => { const u = step(a, d, n); return u && A.on.has(u.id) })) continue
      out.on.add(t.id)
    }
  }
  // the second pen always rides on the first: anything it laid down that does not touch the stroke goes again
  const added = L.icon(); for (const id of out.on) if (!A.on.has(id)) added.on.add(id)
  for (const c of comps(added)) if (!c.some(t => nOn(A, t) > 0)) for (const t of c) out.on.delete(t.id)
  return out
}
// how far a drawing reaches toward the rim: the largest |c| + |v| over its vertices (16 = on the rim)
const reach = ic => Math.max(0, ...[...ic.on].flatMap(id => T.get(id).lv.map(([c, v]) => Math.max(Math.abs(c) + Math.abs(v), 2 * Math.abs(c)))))
function withHandle(food) {
  let best = null
  const r0 = Math.max(reach(food), 14)
  for (const s of [0, 1, -1, 2, -2, 3, -3]) for (const u of [0, -1, 1, -2, 2]) {
    const f = food.clone().shift(s, -s + 2 * u)
    if (f.on.size !== food.on.size || reach(f) > r0) continue
    const S = sil(f)
    let hit = null
    for (let k = HANDLE_END; k <= 7 && hit === null; k++) if (stickTri(k).some(([kk, hh]) => { const t = L.triAt(kk, hh); return t && S.on.has(t.id) })) hit = k
    if (hit === null || hit - HANDLE_END < 2 || hit - HANDLE_END > 4) continue
    const score = Math.abs(hit - HANDLE_END - 3) * 2 + Math.abs(s) + Math.abs(u) * 1.5 + Math.max(0, reach(f) - 14) * 3
    if (!best || score < best.score) best = { f, score, hit }
  }
  return best ? best.f.add(L.icon().set(stick(HANDLE_END, best.hit - 1))) : food
}
function cooked(f) {
  const o = COOK[f]
  const raw = o.drop ? part(RAW(f), t => !o.drop(t)) : RAW(f)
  const { ic, keep } = closeHoles(raw)
  let b = ic
  if (o.mode === "bold") b = bold(ic, keep, o.mask)
  if (o.mode === "fill") b = sil(ic).sub(rim(o.ring))
  if (o.cut) b.set(o.cut, false)
  return withHandle(b)
}

// ── SPOILED: past the shelf — read left to right the food comes apart through the hand's three tones:
// still whole; then a hollow husk (the solid emptied to a one-pen shell, strokes gone to sawtooth); then crumbs
// that sink down and away, a few ◆, never past the central three quarters ──
const ROT = {
  fruit: { a: 0.5, b: 0.78, protect: t => t.h <= -3 && t.k >= 0 },  // the stem and leaf hold on
  roots: { a: 0.5, b: 0.78, protect: t => t.h <= -6 },              // both blades of the tuft survive
  eel: { a: 0.6, b: 0.85 },                                          // the U-bend survives
  hare: { drop: t => t.k === -3 && t.h <= -12 },                     // the ear tip off the rim
  herbs: { key: t => t.h, a: 0.55, b: 0.8 },                         // the flower head stays, the stem goes
  kelp: { protect: t => t.h <= -8 },                                 // the surface is the kelp's sign
  berries: { key: t => -t.k, a: 0.42, b: 0.72 },                     // the cluster holds, the ring side goes
  eggs: { key: t => t.h, a: 0.4, b: 0.75 },                          // the nest gives way under both eggs
}
function spoiled(f) {
  const o = { a: 0.42, b: 0.72, key: t => t.k, ...(ROT[f] || {}) }
  const raw = o.drop ? part(RAW(f), t => !o.drop(t)) : RAW(f)
  const own = [...raw.on].map(id => T.get(id))
  const prot = o.protect ? new Set(own.filter(o.protect).map(t => t.id)) : new Set()
  const free = own.filter(t => !prot.has(t.id))
  // split on whole strips (or rows) of the key so the edges stay crisp
  const keys = [...new Set(free.map(o.key))].sort((p, q) => p - q)
  let acc = 0, ka = null, kb = null
  for (const k of keys) { acc += free.filter(t => o.key(t) === k).length; if (ka === null && acc >= free.length * o.a) ka = k; if (kb === null && acc >= free.length * o.b) kb = k }
  const zone = t => prot.has(t.id) ? 0 : o.key(t) <= ka ? 0 : o.key(t) <= kb ? 1 : 2
  const out = L.icon()
  const interior = t => nOn(raw, t) === 3
  const shell = t => nb(t).some(m => raw.on.has(m.id) && interior(m))
  const dust = []
  for (const t of own) {
    const z = zone(t)
    if (z === 0) out.on.add(t.id)
    else if (z === 1) {
      if (interior(t)) continue
      if (shell(t)) { out.on.add(t.id); continue }
      if (nOn(raw, t) <= 1) continue // half-tone flesh: rotted away
      if (t.right) out.on.add(t.id)
    } else dust.push(t)
  }
  // crumbs: a few ◆, taken from the lost part and sunk down-right, clamped to the central 3/4
  const inC = t => t.lv.every(([c, v]) => Math.abs(c) <= 6 && Math.abs(v) + Math.abs(c) <= 12)
  const crumbs = []
  const seeds = dust.filter(t => t.right).sort((p, q) => o.key(p) - o.key(q) || p.h - q.h)
  for (const t of seeds) {
    if (crumbs.length >= 5) break
    const sink = 1 + crumbs.length
    const c = L.triAt(t.k + sink, t.h + sink)
    const c2 = c && L.triAt(c.k - 1, c.h)
    if (!c || !c2 || !inC(c) || !inC(c2)) continue
    const fl = [c, c2]
    if (fl.some(x => out.on.has(x.id) || nb(x).some(m => out.on.has(m.id)))) continue
    if (crumbs.some(cr => cr.some(x => fl.some(y => y.id === x.id || nb(y).some(m => m.id === x.id))))) continue
    crumbs.push(fl)
  }
  for (const cr of crumbs) for (const t of cr) out.on.add(t.id)
  return out
}

const COOK_NOTE = {
  plants: "the ear's chevrons doubled to a heavy pen",
  fruit: "the apple filled whole, its own ring cut back in paper one pen further in",
  roots: "the leaf blades and tap-root doubled, the bulb already solid",
  berries: "the half-tone cluster closed solid but for one paper ◆, so it stays a bunch",
  nuts: "the woven cap closed solid over the hull, its fringe kept",
  oysters: "every rib doubled so the fan goes heavy, its grooves left as paper rib lines",
  crabs: "the half-tone back closed solid, a small paper ∧ seam on it, served legless — claws and back",
  kelp: "fronds and floats doubled, the surface wave kept one pen as the kelp's sign",
  eggs: "the speckled egg closed solid beside its plain mate, the nest's sawtooth kept",
  herbs: "the flower head alone, its woolly petals closed solid round the paper ring and the solid heart",
  fish: "out of the water, the mesh closed solid, the paper eye and swallowtail kept",
  hare: "the half-tone flank closed solid, one 30° pen of paper for the haunch, the eye kept",
  eel: "the ribbon doubled heavy, the sawtooth fin and paper eye kept",
}
const ROT_NOTE = {
  plants: "the ear whole on the stem side, its chevrons crumbling to sawtooth, then crumbs",
  fruit: "the ring whole on the left, the flesh rotted out to a sawtooth husk, stem and leaf holding on",
  roots: "the bulb hollowed to a husk on the right, both leaf blades kept",
  berries: "the half-tone cluster holds; the ring side and the stalk go first",
  nuts: "the hull goes hollow, the cap to sawtooth, a few ◆ crumbs falling",
  oysters: "the ribs on the right go to sawtooth and crumbs",
  crabs: "the right claw and back go to a hollow husk and a few crumbs",
  kelp: "the surface wave holds; the fronds come apart below it",
  eggs: "both eggs go hollow at the foot while the nest falls away in ◆ crumbs",
  herbs: "the flower head holds; the stem and leaves come apart underneath",
  fish: "the head and eye stay whole, the body softens, the tail and water go to crumbs",
  hare: "the head and ears whole, the flank emptied to a husk, the haunch to crumbs",
  eel: "the head and the U-bend survive; only the rising, finned tail comes apart",
}
for (const f of FOODS) {
  icons[`${f}:cooked`] = { title: `cooked ${f}`, concept: `cooked ${f}, its own face in CAPITALS: ${COOK_NOTE[f]} — served on the kitchen's one stick, a short handle out of the lower-left cut at 60°`, draw: () => cooked(f) }
  icons[`${f}:spoiled`] = { title: `spoiled ${f}`, concept: `${f} past its shelf, coming apart through the three tones (whole, hollow husk, sinking ◆ crumbs): ${ROT_NOTE[f]}`, draw: () => spoiled(f) }
}
