// skills — skill figures & the three pillars
import fs from "node:fs"
import * as L from "../lat.mjs"
export const family = "skills"

const HAND = JSON.parse(fs.readFileSync(new URL("../hand.json", import.meta.url)))

// ── lattice helpers (lattice vertex coords [c, v], c + v even) ──
const lp = pts => {
  for (const [c, v] of pts) if (((c + v) % 2 + 2) % 2 !== 0) throw new Error(`odd vertex ${c},${v}`)
  return L.lpoly(pts)
}
// pointy-top hexagon of apothem a (strips) around (c, v)
const hexA = (a, c = 0, v = 0) => lp([[c, v - 2 * a], [c + a, v - a], [c + a, v + a], [c, v + 2 * a], [c - a, v + a], [c - a, v - a]])
const hexRing = (a, c = 0, v = 0, w = 1) => L.diff(hexA(a, c, v), hexA(a - w, c, v))
// vertical one-pen stroke in the strip c..c+1 from v0 down to v1; tt/bb = slope of the cut (+1 / -1)
const vbar = (c, v0, v1, tt = 1, bb = -1, w = 1) => lp([[c, v0], [c + w, v0 + tt * w], [c + w, v1 + bb * w], [c, v1]])
// 30° one-pen stroke from (c0, v0) to (c1, v1) (|dv| = |dc|), t v-units tall
const dband = (c0, v0, c1, v1, t = 2) => {
  if (Math.abs(c1 - c0) !== Math.abs(v1 - v0)) throw new Error(`not 30°: ${c0},${v0} → ${c1},${v1}`)
  return lp([[c0, v0], [c1, v1], [c1, v1 + t], [c0, v0 + t]])
}
const tri = (k, h) => L.triAt(k, h)
const ids = ic => [...ic.on].map(id => L.TRIS.find(t => t.id === id))
function mapIcon(ic, f) {
  const out = L.icon()
  for (const t of ids(ic)) {
    const [k, h] = f(t.k, t.h)
    const m = tri(k, h)
    if (m) out.on.add(m.id)
  }
  return out
}
const vflip = ic => mapIcon(ic, (k, h) => [k, -h])
const move = (ic, dc, dv) => ic.clone().shift(dc, dv)
const keep = (ic, pred) => { const o = L.icon(); for (const t of ids(ic)) if (pred(t.k, t.h)) o.on.add(t.id); return o }
const outlined = (shape, inner) => L.diff(shape, inner)
// the empty triangles enclosed by ic, flood-filled from triangle (k, h)
function interior(ic, k, h) {
  const out = L.icon()
  const start = tri(k, h)
  const stack = [start]
  const seen = new Set([start.id])
  while (stack.length) {
    const t = stack.pop()
    if (ic.on.has(t.id)) continue
    out.on.add(t.id)
    for (const n of L.neighbours(t)) if (!seen.has(n.id)) { seen.add(n.id); stack.push(n) }
  }
  return out
}
const halftone = (ic, mode = "right") => keep(ic, (k, h) => (mode === "right") === ((((k + h) % 2) + 2) % 2 === 1))

// hex spiral: sides on hex rings of apothems as[i], starting at side s0, clockwise
function hexSpiral(as, s0 = 0, c = 0, v = 0) {
  const LN = [[-1, 1, -2], [1, 0, 1], [1, 1, 2], [-1, 1, 2], [1, 0, -1], [1, 1, -2]]
  const line = (s, a) => { const [al, be, ga] = LN[((s % 6) + 6) % 6]; return [al, be, ga * a + al * c + be * v] }
  const cross = (l1, l2) => {
    const det = l1[0] * l2[1] - l1[1] * l2[0]
    return [(l1[2] * l2[1] - l1[1] * l2[2]) / det, (l1[0] * l2[2] - l1[2] * l2[0]) / det]
  }
  const shapes = []
  const n = as.length
  const corner = (i, off) => cross(line(s0 + i, as[i] - off), line(s0 + i + 1, as[i + 1] - off))
  for (let i = 1; i < n - 1; i++) {
    const o0 = corner(i - 1, 0), o1 = corner(i, 0), i1 = corner(i, 1), i0 = corner(i - 1, 1)
    shapes.push(L.lpoly([o0, o1, i1, i0]))
  }
  return L.union(...shapes)
}
// one-pen stroke along a lattice polyline (segments vertical or 30°), offset to the
// right (side = 1) or left (side = -1) of the direction of travel
function pen(pts, side = 1) {
  const lines = []
  for (let i = 0; i < pts.length - 1; i++) {
    const [c0, v0] = pts[i], [c1, v1] = pts[i + 1]
    const dc = c1 - c0, dv = v1 - v0
    let ln, off
    if (dc === 0) { ln = [1, 0, c0]; off = 1 }
    else if (Math.abs(dc) === Math.abs(dv)) { ln = dc * dv > 0 ? [-1, 1, v0 - c0] : [1, 1, v0 + c0]; off = 2 }
    else throw new Error(`pen: bad segment ${c0},${v0} → ${c1},${v1}`)
    // which way is "right" of travel (y down): rotate (dx, dy) by +90° → (-dy, dx)
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
  // endpoints of the inner edge: project the end points onto the offset lines along a lattice direction
  const capPoint = (P, ln, other) => {
    // try the three lattice directions through P, pick the one that is not parallel to ln
    for (const dir of other) {
      const l2 = dir === "v" ? [1, 0, P[0]] : dir === "a" ? [-1, 1, P[1] - P[0]] : [1, 1, P[1] + P[0]]
      const det = ln[0] * l2[1] - ln[1] * l2[0]
      if (Math.abs(det) > 1e-9) return cross(ln, l2)
    }
  }
  const inner = []
  const n = lines.length
  inner.push(capPoint(pts[0], lines[0], lines[0][1] === 0 ? ["a", "b"] : ["v"]))
  for (let i = 0; i < n - 1; i++) inner.push(cross(lines[i], lines[i + 1]))
  inner.push(capPoint(pts[pts.length - 1], lines[n - 1], lines[n - 1][1] === 0 ? ["b", "a"] : ["v"]))
  return L.lpoly(pts.concat(inner.reverse()))
}
// iso cube faces of apothem a around (c, v)
const cubeTop = (a, c = 0, v = 0) => lp([[c, v - 2 * a], [c + a, v - a], [c, v], [c - a, v - a]])
const cubeLeft = (a, c = 0, v = 0) => lp([[c - a, v - a], [c, v], [c, v + 2 * a], [c - a, v + a]])
const cubeRight = (a, c = 0, v = 0) => lp([[c, v], [c + a, v - a], [c + a, v + a], [c, v + 2 * a]])
// small ◆ (two triangles sharing a vertical edge) centred on the vertical edge at c, v (c + v odd)
const gem = (c, v) => lp([[c - 1, v], [c, v - 1], [c + 1, v], [c, v + 1]])

// sawtooth: single triangles hanging under (dir = +1) or over (dir = -1) the icon's band, every other strip
function teeth(band, dir = 1, phase = 0, ks = null) {
  const out = L.icon()
  const byK = new Map()
  for (const t of ids(band)) { if (!byK.has(t.k)) byK.set(t.k, []); byK.get(t.k).push(t.h) }
  for (const [k, hs] of byK) {
    if (ks ? !ks.includes(k) : ((k + phase) % 2 + 2) % 2 !== 0) continue
    const h = dir > 0 ? Math.max(...hs) + 1 : Math.min(...hs) - 1
    const t = tri(k, h)
    if (t) out.on.add(t.id)
  }
  return out
}

// (helpers re-exported for scratch prototyping only)
export const H = { pen, lp, hexA, hexRing, vbar, dband, tri, ids, mapIcon, vflip, move, keep, outlined, interior, halftone, hexSpiral, cubeTop, cubeLeft, cubeRight, gem, teeth, HAND }

const odd = n => ((n % 2) + 2) % 2 === 1
const vkey = p => p.join(",")
// connected pieces of an icon (edge-connected triangles), as arrays of ids
function pieces(ic) {
  const left = new Set(ic.on), out = []
  while (left.size) {
    const first = left.values().next().value
    left.delete(first)
    const piece = [first], stack = [first]
    while (stack.length) {
      const cur = stack.pop(), t = L.TRIS.find(q => q.id === cur)
      for (const n of L.neighbours(t)) if (left.has(n.id)) { left.delete(n.id); piece.push(n.id); stack.push(n.id) }
    }
    out.push(piece)
  }
  return out
}
const I = s => L.icon().fill(s)
// grow a set by one triangle across every edge
const dilate = ic => { const o = ic.clone(); for (const t of ids(ic)) for (const n of L.neighbours(t)) o.on.add(n.id); return o }
// a "horizontal" one-pen band: zigzag top edge from (c0, v), one rhombus thick
const flat = (c0, c1, v) => {
  const top = [], bot = []
  for (let c = c0; c <= c1; c++) { const z = v + (odd(c - c0) ? 1 : 0); top.push([c, z]); bot.push([c, z + 2]) }
  return lp(top.concat(bot.reverse()))
}
// the player's cube (menu:cube) seen into its corner, apothem 3 round (0, v): the one-pen rim, the mark's up spoke, and the floor
// (the lowest face) filled solid, its two upper edges standing in for the lower spokes
const cubeFloor = v => L.icon().fill(hexRing(3, 0, v)).fill(lp([[0, v], [0, v - 4], [1, v - 3], [1, v - 1]])).fill(lp([[0, v], [2, v + 2], [0, v + 4], [-2, v + 2]]))
// hex spiral as separate one-pen segments: side lines on hex rings of apothems as[i], clockwise from side s0
function spiralSegs(as, s0 = 0) {
  const LN = [[-1, 1, -2], [1, 0, 1], [1, 1, 2], [-1, 1, 2], [1, 0, -1], [1, 1, -2]]
  const line = (s, a) => { const [al, be, ga] = LN[((s % 6) + 6) % 6]; return [al, be, ga * a] }
  const cross = (l1, l2) => { const det = l1[0] * l2[1] - l1[1] * l2[0]; return [(l1[2] * l2[1] - l1[1] * l2[2]) / det, (l1[0] * l2[2] - l1[2] * l2[0]) / det] }
  const corner = (i, off) => cross(line(s0 + i, as[i] - off), line(s0 + i + 1, as[i + 1] - off))
  const out = []
  for (let i = 1; i < as.length - 1; i++) {
    const seg = L.lpoly([corner(i - 1, 0), corner(i, 0), corner(i, 1), corner(i - 1, 1)])
    seg.from = L.V(...corner(i - 1, 0)); seg.to = L.V(...corner(i, 0))
    out.push(seg)
  }
  return out
}
// dash a run of one-pen segments: one lattice step (1/8) on, one off, measured along the whole run
function dashed(segs, phase = 1) {
  const out = L.icon(), seen = new Set()
  let run = 0
  for (const sg of segs) {
    const [x0, y0] = sg.from, [x1, y1] = sg.to, len = Math.hypot(x1 - x0, y1 - y0)
    for (const t of L.TRIS) {
      if (seen.has(t.id) || L.coverage(sg, t) < 0.5) continue
      seen.add(t.id)
      const u = run + ((t.cx - x0) * (x1 - x0) + (t.cy - y0) * (y1 - y0)) / len
      if (((Math.floor(u / 0.125 + 0.001) + phase) % 2 + 2) % 2 === 0) out.on.add(t.id)
    }
    run += len
  }
  return out
}
const toe = (c, v) => lp([[c, v - 3], [c + 1, v - 2], [c + 1, v + 2], [c, v + 3], [c - 1, v + 2], [c - 1, v - 2]])
const finger = (c, top, bot) => lp([[c - 1, top + 1], [c, top], [c + 1, top + 1], [c + 1, bot], [c - 1, bot]])
// shut lid: scout's lower lid alone, two one-pen 30° strokes meeting in a point
const LID = [[-7, -1], [0, 6], [7, -1]]
// iso mat: rhombus of half-width A round (cx, cy), side corners cut to a short vertical
const mat = (A, cx, cy) => lp([[cx - A, cy - 1], [cx, cy - A - 1], [cx + A, cy - 1], [cx + A, cy + 1], [cx, cy + A + 1], [cx - A, cy + 1]])
// a Z whose bars are flat zigzag bands and whose stroke is a 30° band
function zed(ic, c, v, n) { const m = n + (n % 2); return ic.fill(flat(c, c + n, v)).fill(dband(c, v + m, c + n, v + m - n)).fill(flat(c, c + n, v + m)) }
// the medal: one-pen hex rim, milled on its inner edge (two teeth a side, twelve in all), heal's solid hex inside
function medal() {
  const ic = L.icon().fill(hexRing(4)).fill(hexA(2))
  const side = L.icon().set([[0, -5], [2, -3]])
  for (let r = 0; r < 6; r++) ic.add(side.clone().rot60(r))
  return ic
}
const and = (a, b) => { const o = L.icon(); for (const id of a.on) if (b.on.has(id)) o.on.add(id); return o }
// a kitchen/skewer chunk: the iso cube of apothem 2, one tone per face — "solid", "half" (▶) or "pen" (paper inside the hex's one-pen rim)
function chunk(c, v, top, left, right) {
  const rim = I(hexRing(2, c, v))
  const face = (shape, tone) => tone === "solid" ? I(shape) : tone === "half" ? L.icon().texture(shape, "right") : and(I(shape), rim)
  return face(cubeTop(2, c, v), top).add(face(cubeLeft(2, c, v), left)).add(face(cubeRight(2, c, v), right))
}
// works/hearth's flame, small: [strip, top row, bottom row] — the tall tongue cut like HUNT's T with a step down on
// its right, a dip, a lower tongue leaning back toward it, the left flank stepping down, all standing on a 30° V foot
const FLAME = [[0, 10, 10], [1, 7, 11], [2, 2, 12], [3, 5, 12], [4, 9, 11], [5, 6, 10]]
const columns = rows => { const ic = L.icon(); for (const [k, a, b] of rows) for (let h = a; h <= b; h++) ic.set([[k, h]]); return ic }
// scout's own iris: the notched solid hex inside the hand's eye
const IRIS = () => and(L.fromData(HAND.scout), I(hexA(2)))

export const icons = {
  "hunt:figure": {
    title: "hunt",
    concept: "a wild track pressed in the mud: a woven hex pad, four toes fanned on the pad's own 30° lines, and a claw mark floating clear of each toe",
    draw() {
      const ic = L.icon().fill(hexRing(3, 0, 4)).texture(hexA(2, 0, 4), "right")
      for (const [c, v] of [[-2, -5], [2, -5], [-5, -2], [5, -2]]) ic.fill(toe(c, v)).fill(gem(c, v - 6))
      return ic
    }
  },
  "cook:figure": {
    title: "cook",
    concept: "the kitchen's skewer held over the hearth's flame: three iso-cube chunks threaded corner to corner up the +30° stick, going raw → cooked toward the fire — outline, half-tone, solid — with a small copy of the hearth's flame licking the cooked end; the hand's three tones are the cooking",
    draw() {
      // the kitchen's chunks and handle cut, one pen higher on the stick so the flame stands clear beneath the cooked end
      const ic = chunk(-4, 2, "pen", "pen", "pen").add(chunk(0, -2, "half", "half", "pen")).add(chunk(4, -6, "solid", "solid", "solid"))
      return ic.set([[-7, 3], [-7, 4]]).add(columns(FLAME))
    }
  },
  "heal:figure": {
    title: "heal",
    concept: "the mending hand as a hamsa: two thumbs, three fingers, an open palm, and heal's solid hex held in it like scout's iris",
    draw() {
      const ic = L.icon().fill(finger(-3, -7, 0)).fill(finger(0, -10, 1))
      ic.fill(lp([[-7, 1], [-6, 0], [-5, 1], [-5, 3], [-4, 4], [-4, 6], [-7, 3]])).symX()
      return ic.clear(hexA(3, 0, 4)).fill(hexRing(4, 0, 4)).fill(hexA(2, 0, 4)).shift(0, -2)
    }
  },
  "dream:figure": {
    title: "dream",
    concept: "scout's opposite: the eye shut down to its lower lid, one clean one-pen ∨ with no lashes, and above it scout's own notched iris floats free and solid — the far sight, seen with the eye closed",
    draw() {
      return I(lp(LID.concat(LID.map(([c, v]) => [c, v + 2]).reverse()))).add(IRIS().shift(0, -4))
    }
  },
  "sleep:figure": {
    title: "sleep",
    concept: "the night's rest happens somewhere: a woven iso mat laid flat, and two Z's rising off its far corner",
    draw() {
      const ic = L.icon().fill(L.diff(mat(5, -2, 8), mat(3, -2, 8))).texture(mat(3, -2, 8), "right")
      zed(ic, 3, -1, 4)
      return zed(ic, 0, -12, 5)
    }
  },
  "wake:figure": {
    title: "wake",
    concept: "the power glyph cut from a hex, dark inside: press it and the hand stands straight up from the centre — 00:00",
    draw() {
      const ic = L.icon().fill(hexRing(5, 0, 2)).texture(hexA(3, 0, 2), "right")
      ic.clear(lp([[-3, -11], [0, -14], [3, -11], [3, -5], [0, -2], [-3, -5]]))
      const hand = I(lp([[-1, -11], [0, -12], [1, -11], [1, 1], [0, 2], [-1, 1]]))
      return ic.sub(dilate(hand)).add(hand)
    }
  },
  time: {
    title: "time",
    concept: "a line born from a solid seed, wound outward as one pen, its last lap still dashed — cycles that grow into what hasn't happened yet",
    draw() {
      const segs = spiralSegs([2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 7], 0)
      const n = segs.length - 4
      const ic = L.icon()
      segs.slice(0, n).forEach(sg => ic.fill(sg))
      // dashes: whole rhombi only, none touching the solid line even at a corner
      const solidV = new Set(ids(ic).flatMap(t => t.lv.map(vkey)))
      for (const p of pieces(dashed(segs.slice(n)).sub(dilate(ic)))) {
        const ts = p.map(id => L.TRIS.find(q => q.id === id))
        if (p.length >= 2 && !ts.some(t => t.lv.some(q => solidV.has(vkey(q))))) p.forEach(id => ic.on.add(id))
      }
      return ic.fill(hexA(1))
    }
  },
  space: {
    title: "space",
    concept: "the exploded cube: its three faces pulled apart along the three axes, one in each of the hand's tones",
    draw() {
      const ic = L.icon()
      const top = lp([[0, -12], [5, -7], [0, -2], [-5, -7]])
      ic.texture(L.inter(top, L.rect(-1, -1, 0, 1)), "left").texture(L.inter(top, L.rect(0, -1, 1, 1)), "right")
      ic.fill(lp([[-6, -4], [-1, 1], [-1, 11], [-6, 6]]))
      ic.fill(L.diff(lp([[1, 1], [6, -4], [6, 6], [1, 11]]), lp([[2, 2], [5, -1], [5, 5], [2, 8]])))
      return ic
    }
  },
  mind: {
    title: "mind",
    concept: "three minds as Borromean hex rings — each over one, under the other — bound at a solid hex where all three meet",
    draw() {
      const [A, B, C] = [[0, -4], [2, 2], [-2, 2]].map(([c, v]) => I(hexRing(4, c, v)))
      const core = I(hexA(2))
      // the under-strand is cut one triangle clear of the over-strand, at the outer crossings
      const under = (y, x) => y.clone().sub(keep(dilate(x), (k, h) => Math.hypot(tri(k, h).cx, tri(k, h).cy) > 0.3))
      const ic = under(A, C).add(under(B, A)).add(under(C, B))
      return ic.sub(dilate(core)).add(core)
    }
  },
  master: {
    title: "master",
    concept: "a laurel of twelve leaves, six to a sprig and one for each level, closing round the solid hex that no longer drains",
    draw() {
      const sprig = L.icon().fill(pen([[-1, 11], [-5, 7], [-5, -5], [-3, -7]], 1))
      // leaves alternate either side of the stem, slanted rhombi pointing up the sprig
      for (const h of [-4, 0, 4]) sprig.set([[-6, h], [-6, h - 1]])
      for (const h of [-3, 1, 5]) sprig.set([[-4, h], [-4, h - 1]])
      return L.icon().fill(hexA(2)).add(sprig).add(sprig.clone().mirrorX())
    }
  },
  lesson: {
    title: "lesson",
    concept: "the lesson is an hour: a symmetric hourglass of two equal one-pen hexes — the upper glass holding half-tone sand, running down a neck of gems into your cube below, seen into its corner, where it has settled as a solid heap on the floor, its lowest face",
    draw() {
      const ic = L.icon().fill(hexRing(3, 0, -8)).texture(hexA(2, 0, -8), "right")
      return ic.fill(gem(0, -1)).fill(gem(0, 1)).add(cubeFloor(8))
    }
  }
}
