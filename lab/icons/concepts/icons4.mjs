// icons4 — three VERSIONS of the constellation concept, same figures throughout:
//   chart   — solid stars in three magnitudes, thin connectors that stop short of the stars
//   plate   — the chart over a faint ghost of the figure (the old atlas convention)
//   markers — the board's own vocabulary: bright stars solid, middle stars rings,
//             faint stars pinpricks, connectors dotted
// cooked = the figure sits lower and three sparks rise off it · fine = the brightest star twinkles
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
const arcPts = (cx, cy, rx, ry, a0, a1, k = 20) => Array.from({ length: k + 1 }, (_, i) => {
  const a = a0 + (a1 - a0) * (i / k)
  return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]
})
const closed = pts => [...pts, pts[0]]
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
  return Math.hypot(p.x - (a[0] + vx * t), p.y - (a[1] + vy * t))
}
const near = (pts, w) => p => {
  for (let i = 0; i < pts.length - 1; i++) if (segDist(p, pts[i], pts[i + 1]) <= w / 2) return true
  return false
}
const disc = (x, y, r) => p => Math.hypot(p.x - x, p.y - y) <= r
const ring = (x, y, r, w) => p => Math.abs(Math.hypot(p.x - x, p.y - y) - r) <= w / 2
const any = fs => p => fs.some(f => f(p))
const HEX = [[0, -1], [SQ, -0.5], [SQ, 0.5], [0, 1], [-SQ, 0.5], [-SQ, -0.5]]
const hexIn = inPoly(HEX)
const DIRS = Array.from({ length: 8 }, (_, k) => [Math.cos((k / 8) * TAU), Math.sin((k / 8) * TAU)])

// ── silhouettes: the ghost behind the plate version ──
const SIL = {
  crabs: {
    shapes: [ell(0, 0.12, 0.42, 0.28), circ(-0.58, -0.22, 0.2), circ(0.58, -0.22, 0.2)],
    limbs: [[[-0.34, -0.02], [-0.46, -0.14]], [[-0.3, 0.22], [-0.64, 0.34]], [[-0.26, 0.36], [-0.48, 0.62]], [[-0.13, -0.14], [-0.16, -0.34]]].flatMap(l => [l, mir(l)])
  },
  fish: { shapes: [ell(-0.1, 0, 0.48, 0.25), [[0.27, 0], [0.7, -0.3], [0.63, 0], [0.7, 0.3]], [[-0.23, -0.19], [-0.02, -0.46], [0.17, -0.17]]], limbs: [] },
  hare: { shapes: [ell(0.1, 0.24, 0.44, 0.29), circ(-0.34, -0.1, 0.21), ell(-0.42, -0.46, 0.08, 0.24, -0.15), ell(-0.22, -0.44, 0.08, 0.24, 0.25), circ(0.54, 0.24, 0.1)], limbs: [] },
  // eggs lie inside a nest ring; berries hang as a pair off a forked stem
  eggs: { shapes: [ell(-0.22, 0.12, 0.2, 0.27, -0.12), ell(0.22, 0.12, 0.2, 0.27, 0.12)], limbs: [closed(ell(0, 0.15, 0.64, 0.4, 0, 40))] },
  berries: { shapes: [circ(-0.24, 0.32, 0.2), circ(0.26, 0.36, 0.2), ell(0.36, -0.55, 0.18, 0.08, -0.5)], limbs: [[[0.12, -0.72], [0.05, -0.3]], [[0.05, -0.3], [-0.2, 0.14]], [[0.05, -0.3], [0.22, 0.18]]] },
  wood: { shapes: [[[-0.66, -0.22], [0.54, -0.22], [0.54, 0.22], [-0.66, 0.22]], ell(0.54, 0, 0.14, 0.22), [[-0.3, -0.2], [-0.2, -0.42], [-0.06, -0.42], [-0.1, -0.2]]], limbs: [] },
  rock: { shapes: [[[-0.62, 0.32], [-0.52, -0.18], [-0.15, -0.48], [0.3, -0.4], [0.62, 0.02], [0.5, 0.42], [-0.2, 0.48]]], limbs: [] },
  metal: { shapes: [[[-0.55, 0.1], [0.55, 0.1], [0.42, 0.42], [-0.42, 0.42]], [[-0.35, -0.22], [0.35, -0.22], [0.24, 0.1], [-0.24, 0.1]]], limbs: [] },
  axe: { shapes: [[[0.29, -0.57], [0.73, -0.5], [0.43, 0.02], [0.15, -0.33]]], limbs: [[[-0.42, 0.66], [0.22, -0.45]]] },
  basket: { shapes: [[[-0.6, -0.08], [0.6, -0.08], [0.44, 0.55], [-0.44, 0.55]]], limbs: [arcPts(0, -0.08, 0.44, 0.44, Math.PI, TAU)] },
  net: { shapes: [], limbs: [closed(circ(-0.12, -0.14, 0.46)), [[0.18, 0.21], [0.52, 0.6]], [[-0.32, -0.53], [-0.32, 0.25]], [[0.08, -0.53], [0.08, 0.25]], [[-0.51, -0.34], [0.27, -0.34]], [[-0.51, 0.06], [0.27, 0.06]]] },
  camp: { shapes: [[[-0.68, 0.52], [0, -0.62], [0.68, 0.52]]], limbs: [[[-0.16, 0.52], [0, 0.1], [0.16, 0.52]]] }
}
const T = (pts, s, dx, dy) => pts.map(([x, y]) => [x * s + dx, y * s + dy])
const silXf = (sk, s, dx, dy) => ({ shapes: sk.shapes.map(p => T(p, s, dx, dy)), limbs: sk.limbs.map(p => T(p, s, dx, dy)) })

// ── the star figures: stars [x, y, magnitude f|n|B], edges by index ──
const hoopAt = a => [-0.12 + 0.46 * Math.cos((a * Math.PI) / 180), -0.14 + 0.46 * Math.sin((a * Math.PI) / 180)]
const FIG = {
  crabs: {
    stars: [[-0.32, 0.06, "n"], [0.32, 0.06, "n"], [0.22, 0.38, "n"], [-0.22, 0.38, "n"], [-0.6, -0.24, "B"], [0.6, -0.24, "B"], [-0.64, 0.34, "f"], [-0.48, 0.62, "f"], [0.64, 0.34, "f"], [0.48, 0.62, "f"], [-0.16, -0.38, "f"], [0.16, -0.38, "f"]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [1, 5], [0, 6], [3, 7], [1, 8], [2, 9]]
  },
  fish: { stars: [[-0.58, 0, "B"], [-0.02, -0.46, "n"], [0.3, 0, "n"], [-0.1, 0.25, "n"], [0.7, -0.3, "f"], [0.7, 0.3, "f"]], edges: [[0, 1], [1, 2], [2, 3], [3, 0], [2, 4], [2, 5]] },
  hare: {
    stars: [[-0.46, -0.7, "f"], [-0.17, -0.68, "f"], [-0.4, -0.14, "B"], [-0.55, -0.06, "f"], [-0.36, 0.26, "n"], [0.08, 0.52, "n"], [0.5, 0.4, "n"], [0.12, -0.04, "n"], [0.62, 0.2, "f"]],
    edges: [[0, 2], [1, 2], [2, 3], [2, 7], [7, 6], [6, 5], [5, 4], [4, 2], [6, 8]]
  },
  eggs: {
    stars: [[-0.22, 0.12, "B"], [0.22, 0.12, "B"], ...[0, 60, 120, 180, 240, 300].map(a => [0.64 * Math.cos((a * Math.PI) / 180), 0.15 + 0.4 * Math.sin((a * Math.PI) / 180), a % 120 ? "f" : "n"])],
    edges: [[2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 2]]
  },
  berries: { stars: [[-0.24, 0.32, "n"], [0.26, 0.36, "n"], [0.05, -0.3, "f"], [0.12, -0.72, "f"], [0.36, -0.55, "f"]], edges: [[3, 2], [2, 0], [2, 1], [3, 4]] },
  wood: { stars: [[-0.66, -0.22, "n"], [-0.18, -0.22, "n"], [0.54, -0.22, "n"], [0.54, 0.22, "n"], [-0.66, 0.22, "n"], [0.66, 0, "B"], [-0.13, -0.42, "f"]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [2, 5], [5, 3], [1, 6]] },
  rock: { stars: [[-0.62, 0.32, "n"], [-0.52, -0.18, "n"], [-0.15, -0.48, "n"], [0.3, -0.4, "n"], [0.62, 0.02, "n"], [0.5, 0.42, "n"], [-0.2, 0.48, "n"], [0.05, -0.02, "B"]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 0], [7, 2], [7, 4], [7, 6]] },
  metal: { stars: [[-0.55, 0.1, "n"], [0.55, 0.1, "n"], [0.42, 0.42, "n"], [-0.42, 0.42, "n"], [-0.35, -0.22, "n"], [0.35, -0.22, "B"], [0.24, 0.1, "f"], [-0.24, 0.1, "f"]], edges: [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [4, 7]] },
  axe: { stars: [[-0.42, 0.66, "n"], [0.22, -0.45, "n"], [0.29, -0.57, "f"], [0.73, -0.5, "B"], [0.43, 0.02, "f"]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 1]] },
  basket: { stars: [[-0.6, -0.08, "n"], [0.6, -0.08, "n"], [0.44, 0.55, "n"], [-0.44, 0.55, "n"], [0, -0.52, "B"]], edges: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [4, 1]] },
  net: {
    stars: [...[50, 110, 170, 230, 290, 350].map(a => [...hoopAt(a), "n"]), [-0.12, -0.14, "B"], [0.52, 0.6, "n"]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [6, 0], [6, 2], [6, 4], [0, 7]]
  },
  camp: { stars: [[-0.68, 0.52, "n"], [0, -0.62, "B"], [0.68, 0.52, "n"], [0, 0.52, "f"]], edges: [[0, 1], [1, 2], [2, 0], [1, 3]] }
}
const figXf = (f, s, dx, dy) => ({ ...f, stars: f.stars.map(([x, y, k]) => [x * s + dx, y * s + dy, k]) })
FIG["cooked crabs"] = { ...figXf(FIG.crabs, 0.8, 0, 0.14), sparks: [[-0.14, -0.55], [0.06, -0.7], [-0.1, -0.86]] }
FIG["fine axe"] = { ...FIG.axe, twinkle: 3 }
SIL["cooked crabs"] = silXf(SIL.crabs, 0.8, 0, 0.14)
SIL["fine axe"] = SIL.axe
const ORDER = ["crabs", "cooked crabs", "fish", "hare", "eggs", "berries", "wood", "rock", "metal", "axe", "fine axe", "basket", "net", "camp"]

// ── the three treatments (each returns an ink LEVEL 0..1 per point) ──
const MAG = { f: 0.035, n: 0.05, B: 0.075 }
const connectors = f => f.edges.map(([i, j]) => {
  const a = f.stars[i], b = f.stars[j]
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L
  const ga = MAG[a[2]] + 0.05, gb = MAG[b[2]] + 0.05
  return [[a[0] + ux * ga, a[1] + uy * ga], [b[0] - ux * gb, b[1] - uy * gb]]
})
const twinkleOf = f => {
  if (f.twinkle == null) return []
  const t = f.stars[f.twinkle]
  return [near([[t[0] - 0.2, t[1]], [t[0] + 0.2, t[1]]], 0.035), near([[t[0], t[1] - 0.2], [t[0], t[1] + 0.2]], 0.035), disc(t[0], t[1], 0.1)]
}
const sparksOf = f => (f.sparks || []).map(([x, y]) => disc(x, y, MAG.f))

function chart(f) {
  const ink = any([...f.stars.map(([x, y, k]) => disc(x, y, MAG[k])), ...connectors(f).map(c => near(c, 0.04)), ...twinkleOf(f), ...sparksOf(f)])
  return p => (ink(p) ? 1 : 0)
}
function plate(f, sil) {
  const stars = chart(f)
  const U = any(sil.shapes.map(inPoly))
  const limbs = any(sil.limbs.map(l => near(l, 0.05)))
  const ghost = p => {
    if (limbs(p)) return true
    if (U(p)) return false
    for (const [dx, dy] of DIRS) if (U({ x: p.x + dx * 0.05, y: p.y + dy * 0.05 })) return true
    return false
  }
  return p => (stars(p) ? 1 : ghost(p) ? 0.33 : 0)
}
function markers(f) {
  const stars = f.stars.map(([x, y, k]) => (k === "B" ? disc(x, y, 0.075) : k === "n" ? ring(x, y, 0.055, 0.03) : disc(x, y, 0.028)))
  const dotted = connectors(f).map(([a, b]) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / 0.07))
    return any(Array.from({ length: n + 1 }, (_, i) => disc(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, 0.017)))
  })
  const ink = any([...stars, ...dotted, ...twinkleOf(f), ...sparksOf(f)])
  return p => (ink(p) ? 1 : 0)
}
const VERSIONS = [
  { id: "chart", sub: "solid stars in three magnitudes, thin connectors that stop short of the stars. The version you saw, with the figures tidied.", ink: n => chart(FIG[n]) },
  { id: "plate", sub: "the chart over a faint ghost of the figure, as the old atlases drew the animal behind the stars. The ghost carries recognition; the stars carry the mark.", ink: n => plate(FIG[n], SIL[n]) },
  { id: "markers", sub: "the board's own vocabulary: bright stars solid, middle stars rings, faint stars pinpricks, connectors dotted. Kin to the corners and the ring markers.", ink: n => markers(FIG[n]) }
]

// ── PNG rendering ────────────────────────────────────
const INK = [238, 238, 238], PAPER = [17, 17, 17], HEXBG = [30, 30, 30]
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
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
        const c = !hexIn(p) ? PAPER : mix(HEXBG, INK, ink(p))
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

const inks = VERSIONS.map(v => ORDER.map(n => v.ink(n)))
fs.writeFileSync(path.join(OUT, "sheet4-big.png"), sheet(inks.map(cells => ({ R: 36, cells })), 84))
fs.writeFileSync(path.join(OUT, "sheet4-small.png"), sheet(inks.map(cells => ({ R: 13, cells })), 32))

const figs = VERSIONS.map((v, vi) => {
  const cells = ORDER.map((n, ni) => {
    const imgs = [40, 22, 13].map(R => {
      const { size, data } = single(inks[vi][ni], R)
      return `<img width="${size}" height="${size}" src="data:image/png;base64,${data.toString("base64")}" alt="">`
    }).join("")
    return `<figure>${imgs}<figcaption>${n}</figcaption></figure>`
  }).join("")
  return `<h2>${v.id}</h2><p class="sub">${v.sub}</p><div class="row">${cells}</div>`
}).join("")
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>constellation versions</title>
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
figure img{display:block}
figcaption{opacity:.7;text-align:center}
.note{opacity:.6;margin:16px 0 0;max-width:70ch}
</style></head><body>
<header><h1>constellation — three versions, the same star figures throughout</h1><button id="theme">light / dark</button></header>
${figs}
<p class="note">icon radius 40 · 22 · 13 px — a menu hex, a pack box, a tile badge. cooked = the figure sits lower and three sparks rise off it · fine = the brightest star twinkles. Flip ink and paper with the button.</p>
<script>document.getElementById("theme").addEventListener("click",()=>document.body.classList.toggle("light"))</script>
</body></html>`
fs.writeFileSync(path.join(OUT, "constellation-versions.html"), html)
console.log("ok", VERSIONS.length, "versions ×", ORDER.length, "items")
