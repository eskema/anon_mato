// icons3 — four CONCEPTS, each a complete look with its own way of drawing:
//   constellation — the item as a star figure: dots joined by thin lines (Cancer, Lepus, Pisces)
//   token         — a board piece: the cube's hex block with the item stamped on its top face
//   brush         — two or three tapered ink strokes, sumi-e; one gesture per item
//   contour       — terraces: the silhouette as nested rings, like the elevation terraces
// Each concept carries its own cooked and fine rules. Rendered to PNG in node.
import fs from "node:fs"
import zlib from "node:zlib"
import path from "node:path"

const OUT = process.argv[2] || "."
const TAU = Math.PI * 2
const SQ = Math.sqrt(3) / 2

// ── geometry helpers ─────────────────────────────────
const ell = (cx, cy, rx, ry, rot = 0, k = 40) => {
  const c = Math.cos(rot), s = Math.sin(rot), pts = []
  for (let i = 0; i < k; i++) {
    const a = (i / k) * TAU, x = Math.cos(a) * rx, y = Math.sin(a) * ry
    pts.push([cx + x * c - y * s, cy + x * s + y * c])
  }
  return pts
}
const circ = (cx, cy, r) => ell(cx, cy, r, r)
const arcPts = (cx, cy, r, a0, a1, k = 20) => Array.from({ length: k + 1 }, (_, i) => {
  const a = a0 + (a1 - a0) * (i / k)
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]
})
const mir = pts => pts.map(p => [-p[0], ...p.slice(1)])
const inPoly = pts => p => {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j]
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
const segDist = (p, a, b) => {
  const vx = b[0] - a[0], vy = b[1] - a[1], L = vx * vx + vy * vy
  let t = L ? ((p.x - a[0]) * vx + (p.y - a[1]) * vy) / L : 0
  t = Math.max(0, Math.min(1, t))
  return [Math.hypot(p.x - (a[0] + vx * t), p.y - (a[1] + vy * t)), t]
}
const near = (pts, w) => p => {
  for (let i = 0; i < pts.length - 1; i++) if (segDist(p, pts[i], pts[i + 1])[0] <= w / 2) return true
  return false
}
const disc = (x, y, r) => p => Math.hypot(p.x - x, p.y - y) <= r
const any = fs => p => fs.some(f => f(p))
const HEX = [[0, -1], [SQ, -0.5], [SQ, 0.5], [0, 1], [-SQ, 0.5], [-SQ, -0.5]]
const hexIn = inPoly(HEX)

// ── the shared silhouettes (token and contour draw from these) ──
const SIL = {
  crabs: {
    shapes: [ell(0, 0.12, 0.42, 0.28), circ(-0.58, -0.22, 0.2), circ(0.58, -0.22, 0.2)],
    limbs: [[[-0.34, -0.02], [-0.46, -0.14]], [[-0.3, 0.22], [-0.64, 0.34]], [[-0.26, 0.36], [-0.48, 0.62]], [[-0.13, -0.14], [-0.16, -0.34]]].flatMap(l => [l, mir(l)]),
    dots: [[-0.16, -0.38, 0.06], [0.16, -0.38, 0.06]]
  },
  fish: { shapes: [ell(-0.1, 0, 0.48, 0.25), [[0.27, 0], [0.7, -0.3], [0.63, 0], [0.7, 0.3]], [[-0.23, -0.19], [-0.02, -0.46], [0.17, -0.17]]], limbs: [], dots: [] },
  hare: { shapes: [ell(0.1, 0.24, 0.44, 0.29), circ(-0.34, -0.1, 0.21), ell(-0.42, -0.46, 0.08, 0.24, -0.15), ell(-0.22, -0.44, 0.08, 0.24, 0.25), circ(0.54, 0.24, 0.1)], limbs: [], dots: [] },
  wood: { shapes: [[[-0.66, -0.22], [0.54, -0.22], [0.54, 0.22], [-0.66, 0.22]], ell(0.54, 0, 0.14, 0.22), [[-0.3, -0.2], [-0.2, -0.42], [-0.06, -0.42], [-0.1, -0.2]]], limbs: [], dots: [] },
  rock: { shapes: [[[-0.62, 0.32], [-0.52, -0.18], [-0.15, -0.48], [0.3, -0.4], [0.62, 0.02], [0.5, 0.42], [-0.2, 0.48]]], limbs: [], dots: [] },
  axe: { shapes: [[[0.29, -0.57], [0.73, -0.5], [0.43, 0.02], [0.15, -0.33]]], limbs: [[[-0.42, 0.66], [0.22, -0.45]]], dots: [] },
  basket: { shapes: [[[-0.6, -0.08], [0.6, -0.08], [0.44, 0.55], [-0.44, 0.55]]], limbs: [arcPts(0, -0.08, 0.44, Math.PI, TAU)], dots: [] },
  camp: { shapes: [[[-0.68, 0.52], [0, -0.62], [0.68, 0.52]]], limbs: [], dots: [] }
}
const T = (pts, s, dx, dy) => pts.map(([x, y]) => [x * s + dx, y * s + dy])
const silXf = (sk, s, dx, dy) => ({ shapes: sk.shapes.map(p => T(p, s, dx, dy)), limbs: sk.limbs.map(p => T(p, s, dx, dy)), dots: sk.dots.map(([x, y, r]) => [x * s + dx, y * s + dy, r * s]) })
const ORDER = ["crabs", "cooked crabs", "fish", "hare", "wood", "rock", "axe", "fine axe", "basket", "camp"]

// ═══ 1 · CONSTELLATION ═══════════════════════════════
// stars [x, y, kind] (f faint · n · B bright), edges by index; lines stop short of the stars
const STAR = { f: 0.035, n: 0.05, B: 0.075 }
const CON = {
  crabs: { stars: [[-0.32, 0.06, "n"], [0.32, 0.06, "n"], [0.22, 0.4, "n"], [-0.22, 0.4, "n"], [-0.64, -0.36, "B"], [0.64, -0.36, "B"], [-0.68, 0.3, "f"], [-0.5, 0.68, "f"], [0.68, 0.3, "f"], [0.5, 0.68, "f"]], edges: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [1, 5], [0, 6], [3, 7], [1, 8], [2, 9]] },
  fish: { stars: [[-0.62, 0, "B"], [-0.15, -0.32, "n"], [0.32, 0, "n"], [-0.15, 0.3, "n"], [0.7, -0.34, "f"], [0.7, 0.34, "f"]], edges: [[0, 1], [1, 2], [2, 3], [3, 0], [2, 4], [2, 5]] },
  hare: { stars: [[-0.52, -0.72, "f"], [-0.28, -0.76, "f"], [-0.4, -0.28, "B"], [-0.44, 0.2, "n"], [0, 0.6, "n"], [0.48, 0.3, "n"], [0.15, -0.14, "n"], [0.66, 0.06, "f"]], edges: [[0, 2], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 2], [5, 7]] },
  wood: { stars: [[-0.62, -0.1, "n"], [0.5, -0.32, "n"], [0.62, 0.14, "n"], [-0.5, 0.36, "n"], [-0.1, -0.58, "f"], [0.5, -0.06, "B"], [-0.1, -0.2, "f"]], edges: [[0, 6], [6, 1], [1, 2], [2, 3], [3, 0], [6, 4], [1, 5], [5, 2]] },
  rock: { stars: [[-0.62, 0.3, "n"], [-0.5, -0.2, "n"], [-0.12, -0.5, "n"], [0.32, -0.4, "n"], [0.62, 0.04, "n"], [0.48, 0.42, "n"], [-0.2, 0.48, "n"], [0.05, -0.02, "B"]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 0], [7, 2], [7, 4], [7, 6]] },
  axe: { stars: [[-0.46, 0.66, "n"], [0.2, -0.42, "n"], [0.3, -0.6, "f"], [0.72, -0.5, "B"], [0.44, 0.02, "f"]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 1]] },
  basket: { stars: [[-0.6, -0.08, "n"], [0.6, -0.08, "n"], [0.44, 0.55, "n"], [-0.44, 0.55, "n"], [0, -0.56, "B"]], edges: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [4, 1]] },
  camp: { stars: [[-0.68, 0.52, "n"], [0, -0.62, "B"], [0.68, 0.52, "n"], [0, 0.52, "f"]], edges: [[0, 1], [1, 2], [2, 0], [1, 3]] }
}
// cooked: the figure sits lower and three faint sparks rise off it — the same stars, no new lines
CON["cooked crabs"] = { stars: [...CON.crabs.stars.map(([x, y, k]) => [x * 0.8, y * 0.8 + 0.14, k]), [-0.14, -0.55, "f"], [0.06, -0.7, "f"], [-0.1, -0.86, "f"]], edges: CON.crabs.edges }
// fine: the tool's brightest star twinkles
CON["fine axe"] = { ...CON.axe, twinkle: 3 }
function inkConstellation(c) {
  const stars = c.stars.map(([x, y, k]) => disc(x, y, STAR[k]))
  const edges = c.edges.map(([i, j]) => {
    const a = c.stars[i], b = c.stars[j]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L
    const ga = STAR[a[2]] + 0.05, gb = STAR[b[2]] + 0.05
    return near([[a[0] + ux * ga, a[1] + uy * ga], [b[0] - ux * gb, b[1] - uy * gb]], 0.04)
  })
  const tw = c.twinkle != null ? c.stars[c.twinkle] : null
  const rays = tw ? [near([[tw[0] - 0.2, tw[1]], [tw[0] + 0.2, tw[1]]], 0.035), near([[tw[0], tw[1] - 0.2], [tw[0], tw[1] + 0.2]], 0.035), disc(tw[0], tw[1], 0.1)] : []
  return any([...stars, ...edges, ...rays])
}

// ═══ 2 · TOKEN ═══════════════════════════════════════
// the cube glyph seen from above: hex outline + inverted Y. The item lies on the
// top face, foreshortened 2:1. cooked: the top face is ink and the mark is paper
// (fired). fine: a second rim runs inside the top face.
const K = 0.68
const topMap = ([x, y]) => [x * K * SQ, -0.5 + y * K * 0.5]
const TOP = [[0, -1], [SQ, -0.5], [0, 0], [-SQ, -0.5]]
const topIn = inPoly(TOP)
const hexEdge = near([...HEX, HEX[0]], 0.07)
const spokes = any([near([[0, 0], [0, 1]], 0.07), near([[0, 0], [-SQ, -0.5]], 0.07), near([[0, 0], [SQ, -0.5]], 0.07)])
const rim = near([...TOP.map(([x, y]) => [x * 0.78, -0.5 + (y + 0.5) * 0.78]), [0, -0.5 + (TOP[0][1] + 0.5) * 0.78]], 0.045)
function inkToken(sil, { cooked = false, fine = false } = {}) {
  const mark = any([...sil.shapes.map(s => inPoly(s.map(topMap))), ...sil.limbs.map(l => near(l.map(topMap), 0.08)), ...sil.dots.map(([x, y, r]) => disc(...topMap([x, y]), r * K))])
  return p => {
    if (hexEdge(p) || spokes(p)) return true
    if (fine && rim(p)) return true
    return cooked ? topIn(p) && !mark(p) : mark(p)
  }
}
const TOK = Object.fromEntries(Object.entries(SIL).map(([n, s]) => [n, inkToken(s)]))
TOK["cooked crabs"] = inkToken(SIL.crabs, { cooked: true })
TOK["fine axe"] = inkToken(SIL.axe, { fine: true })

// ═══ 3 · BRUSH ═══════════════════════════════════════
// tapered strokes [x, y, width]: a dab, a hook, a flick — two or three per item
const B = {
  crabs: [
    [[-0.36, 0.12, 0.44], [0.36, 0.12, 0.44]],
    [[-0.4, 0, 0.16], [-0.62, -0.22, 0.18], [-0.5, -0.44, 0.04]], [[0.4, 0, 0.16], [0.62, -0.22, 0.18], [0.5, -0.44, 0.04]],
    [[-0.32, 0.28, 0.12], [-0.66, 0.36, 0.03]], [[0.32, 0.28, 0.12], [0.66, 0.36, 0.03]],
    [[-0.24, 0.34, 0.12], [-0.44, 0.66, 0.03]], [[0.24, 0.34, 0.12], [0.44, 0.66, 0.03]],
    [[-0.12, -0.16, 0.09], [-0.12, -0.2, 0.09]], [[0.12, -0.16, 0.09], [0.12, -0.2, 0.09]]
  ],
  fish: [
    [[-0.64, 0.02, 0.06], [-0.4, -0.08, 0.3], [-0.05, -0.02, 0.38], [0.25, 0.02, 0.22], [0.4, 0, 0.1]],
    [[0.38, 0, 0.1], [0.72, -0.32, 0.03]], [[0.38, 0, 0.1], [0.72, 0.32, 0.03]],
    [[-0.15, -0.2, 0.08], [0, -0.46, 0.02]]
  ],
  hare: [
    [[-0.1, 0.28, 0.5], [0.35, 0.22, 0.46]],
    [[-0.4, -0.1, 0.34], [-0.32, -0.06, 0.34]],
    [[-0.46, -0.28, 0.13], [-0.52, -0.72, 0.02]], [[-0.3, -0.28, 0.13], [-0.22, -0.7, 0.02]],
    [[0.56, 0.2, 0.16], [0.62, 0.16, 0.14]]
  ],
  wood: [[[-0.6, 0.04, 0.38], [0.56, -0.04, 0.4]], [[-0.2, -0.14, 0.14], [-0.08, -0.5, 0.02]]],
  rock: [[[-0.4, 0.22, 0.42], [-0.12, -0.3, 0.5], [0.36, -0.1, 0.5], [0.42, 0.3, 0.36]]],
  axe: [[[-0.46, 0.66, 0.09], [0.2, -0.4, 0.12]], [[0.24, -0.56, 0.3], [0.62, -0.3, 0.26]], [[0.66, -0.34, 0.1], [0.5, 0.02, 0.03]]],
  basket: [[[-0.56, -0.04, 0.12], [-0.44, 0.5, 0.14], [0.44, 0.5, 0.14], [0.56, -0.04, 0.12]], [[-0.5, 0.14, 0.08], [0.5, 0.14, 0.08]], arcPts(0, -0.06, 0.44, Math.PI, TAU).map(([x, y]) => [x, y, 0.07])],
  camp: [[[-0.66, 0.56, 0.04], [0, -0.62, 0.2]], [[0, -0.62, 0.2], [0.66, 0.56, 0.04]]]
}
const bXf = (strokes, s, dx, dy) => strokes.map(st => st.map(([x, y, w]) => [x * s + dx, y * s + dy, w * s]))
B["cooked crabs"] = [...bXf(B.crabs, 0.8, 0, 0.14), [[-0.16, -0.5, 0.1], [-0.06, -0.66, 0.07], [-0.2, -0.82, 0.02]], [[0.16, -0.5, 0.1], [0.26, -0.66, 0.07], [0.12, -0.82, 0.02]]]
B["fine axe"] = [...B.axe, [[-0.52, -0.52, 0.06], [-0.28, -0.52, 0.06]], [[-0.4, -0.64, 0.06], [-0.4, -0.4, 0.06]]]
const taper = st => p => {
  for (let i = 0; i < st.length - 1; i++) {
    const [d, t] = segDist(p, st[i], st[i + 1])
    if (d <= (st[i][2] + (st[i + 1][2] - st[i][2]) * t) / 2) return true
  }
  return false
}
const inkBrush = strokes => any(strokes.map(taper))

// ═══ 4 · CONTOUR ═════════════════════════════════════
// the silhouette as terraces: rings every D, W wide, from the edge inward (a
// distance field, chamfer transform). raw = hollow rings. cooked = solid with
// paper rings. fine = finer terraces. Thin parts (legs, handles) stay single lines.
const G = 220, EXT = 1.1, CELL = (2 * EXT) / G
function distanceField(sil) {
  const U = any(sil.shapes.map(inPoly))
  const d = new Float32Array(G * G)
  const inside = new Uint8Array(G * G)
  for (let j = 0; j < G; j++)
    for (let i = 0; i < G; i++) {
      const k = j * G + i
      inside[k] = U({ x: -EXT + (i + 0.5) * CELL, y: -EXT + (j + 0.5) * CELL }) ? 1 : 0
      d[k] = inside[k] ? 1e9 : 0
    }
  const relax = (k, kk, w) => { if (d[kk] + w < d[k]) d[k] = d[kk] + w }
  for (let j = 0; j < G; j++)
    for (let i = 0; i < G; i++) {
      const k = j * G + i
      if (i > 0) relax(k, k - 1, 1)
      if (j > 0) relax(k, k - G, 1)
      if (i > 0 && j > 0) relax(k, k - G - 1, Math.SQRT2)
      if (i < G - 1 && j > 0) relax(k, k - G + 1, Math.SQRT2)
    }
  for (let j = G - 1; j >= 0; j--)
    for (let i = G - 1; i >= 0; i--) {
      const k = j * G + i
      if (i < G - 1) relax(k, k + 1, 1)
      if (j < G - 1) relax(k, k + G, 1)
      if (i < G - 1 && j < G - 1) relax(k, k + G + 1, Math.SQRT2)
      if (i > 0 && j < G - 1) relax(k, k + G - 1, Math.SQRT2)
    }
  return p => {
    const i = Math.floor((p.x + EXT) / CELL), j = Math.floor((p.y + EXT) / CELL)
    if (i < 0 || j < 0 || i >= G || j >= G) return -1
    const k = j * G + i
    return inside[k] ? d[k] * CELL : -1
  }
}
function inkContour(sil, { cooked = false, fine = false } = {}) {
  const D = fine ? 0.1 : 0.16, W = 0.055
  const dist = distanceField(sil)
  const limbs = any(sil.limbs.map(l => near(l, cooked ? 0.1 : 0.06)))
  const dots = any(sil.dots.map(([x, y, r]) => disc(x, y, r)))
  return p => {
    const t = dist(p)
    if (t >= 0) {
      const band = t % D <= W
      return cooked ? !band : band
    }
    return limbs(p) || dots(p)
  }
}
const CTR = Object.fromEntries(Object.entries(SIL).map(([n, s]) => [n, inkContour(s)]))
CTR["cooked crabs"] = inkContour(silXf(SIL.crabs, 0.8, 0, 0.14), { cooked: true })
CTR["fine axe"] = inkContour(SIL.axe, { fine: true })

// ── the four rows ────────────────────────────────────
const CONCEPTS = [
  { id: "constellation", sub: "the item as a star figure: dots joined by thin lines, the way Cancer, Lepus and Pisces are drawn. cooked = three sparks rise off the figure · fine = the brightest star twinkles", ink: n => inkConstellation(CON[n]) },
  { id: "token", sub: "a board piece: the cube glyph seen from above, the item stamped flat on its top face. cooked = the face fires to ink and the mark shows in paper · fine = a second rim inside the face", ink: n => TOK[n] },
  { id: "brush", sub: "two or three tapered strokes, a dab and a flick — one gesture per item. cooked = smaller, lower, two steam flicks · fine = a small crossed gleam", ink: n => inkBrush(B[n]) },
  { id: "contour", sub: "terraces: the silhouette as nested rings, like the elevation terraces on the board. cooked = solid with the rings cut in paper · fine = finer terraces", ink: n => CTR[n] }
]

// ── PNG rendering ────────────────────────────────────
const INK = [238, 238, 238], PAPER = [17, 17, 17], HEXBG = [30, 30, 30]
function png(width, height, rgb) {
  const stride = width * 3 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) rgb.copy(raw, y * stride + 1, y * width * 3, (y + 1) * width * 3)
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))])
}
function paintCell(buf, W, H, ink, cx, cy, R) {
  for (let py = Math.floor(cy - R - 2); py <= cy + R + 2; py++)
    for (let px = Math.floor(cx - R - 2); px <= cx + R + 2; px++) {
      if (px < 0 || py < 0 || px >= W || py >= H) continue
      const acc = [0, 0, 0]
      for (const [sx, sy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const p = { x: (px + sx - cx) / R, y: (py + sy - cy) / R }
        const c = !hexIn(p) ? PAPER : ink(p) ? INK : HEXBG
        acc[0] += c[0]
        acc[1] += c[1]
        acc[2] += c[2]
      }
      buf.set([acc[0] / 4, acc[1] / 4, acc[2] / 4], (py * W + px) * 3)
    }
}
function sheet(rows, cell) {
  const cols = Math.max(...rows.map(r => r.cells.length))
  const W = cols * cell, H = rows.length * cell
  const buf = Buffer.alloc(W * H * 3)
  for (let i = 0; i < W * H; i++) buf.set(PAPER, i * 3)
  rows.forEach((row, ri) => row.cells.forEach((ink, ci) => paintCell(buf, W, H, ink, ci * cell + cell / 2, ri * cell + cell / 2, row.R)))
  return png(W, H, buf)
}
function single(ink, R) {
  const S = Math.ceil(R * 2.3)
  const buf = Buffer.alloc(S * S * 3)
  for (let i = 0; i < S * S; i++) buf.set(PAPER, i * 3)
  paintCell(buf, S, S, ink, S / 2, S / 2, R)
  return { size: S, data: png(S, S, buf) }
}

const inks = CONCEPTS.map(c => ORDER.map(n => c.ink(n)))
fs.writeFileSync(path.join(OUT, "sheet3-big.png"), sheet(inks.map(cells => ({ R: 36, cells })), 84))
fs.writeFileSync(path.join(OUT, "sheet3-small.png"), sheet(inks.map(cells => ({ R: 13, cells })), 32))

// ── HTML: the same renders, three sizes, ink/paper flip ──
const figs = CONCEPTS.map((c, ci) => {
  const cells = ORDER.map((n, ni) => {
    const imgs = [40, 22, 13].map(R => {
      const { size, data } = single(inks[ci][ni], R)
      return `<img width="${size}" height="${size}" src="data:image/png;base64,${data.toString("base64")}" alt="">`
    }).join("")
    return `<figure>${imgs}<figcaption>${n}</figcaption></figure>`
  }).join("")
  return `<h2>${c.id}</h2><p class="sub">${c.sub}</p><div class="row">${cells}</div>`
}).join("")
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>icon concepts</title>
<style>
:root{--text:#eee;--surface:#111}
body{margin:0;padding:16px;background:var(--surface);color:var(--text);font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
body.light{--text:#111;--surface:#eee}
body.light img{filter:invert(1)}
header{display:grid;grid-template-columns:1fr auto;align-items:center;gap:12px;margin-bottom:6px}
h1{font-size:13px;font-weight:600;margin:0}
h2{font-size:13px;font-weight:600;margin:22px 0 2px}
p.sub{margin:0 0 10px;opacity:.65;max-width:70ch}
button{font:inherit;color:var(--text);background:transparent;border:1px solid color-mix(in srgb,var(--text) 30%,transparent);border-radius:6px;padding:3px 9px;cursor:pointer}
.row{display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:6px}
figure{margin:0;display:grid;grid-template-rows:92px 52px 32px auto;justify-items:center;align-items:center;gap:2px;padding:6px 2px}
figure img{display:block;image-rendering:auto}
figcaption{opacity:.7;text-align:center}
.note{opacity:.6;margin:16px 0 0;max-width:70ch}
</style></head><body>
<header><h1>icon concepts — four complete looks, each with its own way of drawing</h1><button id="theme">light / dark</button></header>
${figs}
<p class="note">icon radius 40 · 22 · 13 px — a menu hex, a pack box, a tile badge. The faint hex is the footprint. Flip ink and paper with the button, as the game does after dark.</p>
<script>document.getElementById("theme").addEventListener("click",()=>document.body.classList.toggle("light"))</script>
</body></html>`
fs.writeFileSync(path.join(OUT, "icon-concepts.html"), html)
console.log("ok", CONCEPTS.length, "concepts ×", ORDER.length, "items")
