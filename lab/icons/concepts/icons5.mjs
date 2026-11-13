// icons5 — constellation CONSTRUCTIONS: the same chart treatment, four ways to
// build each figure:
//   skeleton — joints and limbs (the figures so far)
//   outline  — stars along the silhouette, joined in one loop
//   minimal  — the fewest stars that still say the thing
//   hex      — stars snapped to the board's triangular lattice; lines along 0°/60°/120° only
import fs from "node:fs"
import zlib from "node:zlib"
import path from "node:path"

const OUT = process.argv[2] || "."
const TAU = Math.PI * 2
const SQ = Math.sqrt(3) / 2
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
const any = fs => p => fs.some(f => f(p))
const hexIn = inPoly([[0, -1], [SQ, -0.5], [SQ, 0.5], [0, 1], [-SQ, 0.5], [-SQ, -0.5]])

// the board's lattice: row j, column i → pitch 0.25
const hx = (i, j, k) => [(i + j / 2) * 0.25, j * 0.25 * SQ, k]
const hoopAt = a => [-0.12 + 0.46 * Math.cos((a * Math.PI) / 180), -0.14 + 0.46 * Math.sin((a * Math.PI) / 180)]
const loop = n => Array.from({ length: n }, (_, i) => [i, (i + 1) % n])

// ── figures: [skeleton, outline, minimal, hex] per item ──
const FIGS = {
  crabs: [
    { stars: [[-0.32, 0.06, "n"], [0.32, 0.06, "n"], [0.22, 0.38, "n"], [-0.22, 0.38, "n"], [-0.6, -0.24, "B"], [0.6, -0.24, "B"], [-0.64, 0.34, "f"], [-0.48, 0.62, "f"], [0.64, 0.34, "f"], [0.48, 0.62, "f"], [-0.16, -0.38, "f"], [0.16, -0.38, "f"]], edges: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [1, 5], [0, 6], [3, 7], [1, 8], [2, 9]] },
    { stars: [[-0.72, -0.34, "B"], [-0.42, -0.1, "n"], [0, -0.16, "n"], [0.42, -0.1, "n"], [0.72, -0.34, "B"], [0.52, 0.2, "n"], [0.44, 0.6, "f"], [0, 0.42, "n"], [-0.44, 0.6, "f"], [-0.52, 0.2, "n"], [-0.14, -0.34, "f"], [0.14, -0.34, "f"]], edges: loop(10) },
    { stars: [[0, 0.12, "B"], [-0.62, -0.3, "n"], [0.62, -0.3, "n"], [-0.5, 0.56, "f"], [0.5, 0.56, "f"]], edges: [[0, 1], [0, 2], [0, 3], [0, 4]] },
    { stars: [hx(1, 0, "n"), hx(1, -1, "n"), hx(0, -1, "n"), hx(-1, 0, "n"), hx(-1, 1, "n"), hx(0, 1, "n"), hx(-1, -1, "n"), hx(-1, -2, "B"), hx(2, -1, "n"), hx(3, -2, "B"), hx(-2, 2, "f"), hx(-3, 3, "f"), hx(0, 2, "f"), hx(0, 3, "f")], edges: [...loop(6), [3, 6], [6, 7], [0, 8], [8, 9], [4, 10], [10, 11], [5, 12], [12, 13]] }
  ],
  fish: [
    { stars: [[-0.58, 0, "B"], [-0.02, -0.46, "n"], [0.3, 0, "n"], [-0.1, 0.25, "n"], [0.7, -0.3, "f"], [0.7, 0.3, "f"]], edges: [[0, 1], [1, 2], [2, 3], [3, 0], [2, 4], [2, 5]] },
    { stars: [[-0.6, 0, "B"], [-0.35, -0.2, "n"], [-0.02, -0.46, "n"], [0.15, -0.18, "f"], [0.3, -0.1, "n"], [0.7, -0.3, "f"], [0.55, 0, "f"], [0.7, 0.3, "f"], [0.3, 0.1, "n"], [-0.15, 0.26, "n"], [-0.42, -0.06, "f"]], edges: loop(10) },
    { stars: [[-0.6, 0, "B"], [0.3, 0, "n"], [0.7, -0.3, "f"], [0.7, 0.3, "f"]], edges: [[0, 1], [1, 2], [1, 3]] },
    { stars: [hx(-2, 0, "B"), hx(-1, -1, "n"), hx(0, -1, "n"), hx(1, -1, "n"), hx(1, 0, "n"), hx(0, 1, "n"), hx(-2, 1, "n"), hx(3, -2, "f"), hx(1, 2, "f")], edges: [...loop(7), [4, 7], [4, 8]] }
  ],
  hare: [
    { stars: [[-0.46, -0.7, "f"], [-0.17, -0.68, "f"], [-0.4, -0.14, "B"], [-0.55, -0.06, "f"], [-0.36, 0.26, "n"], [0.08, 0.52, "n"], [0.5, 0.4, "n"], [0.12, -0.04, "n"], [0.62, 0.2, "f"]], edges: [[0, 2], [1, 2], [2, 3], [2, 7], [7, 6], [6, 5], [5, 4], [4, 2], [6, 8]] },
    { stars: [[-0.58, -0.14, "n"], [-0.46, -0.72, "f"], [-0.3, -0.44, "f"], [-0.16, -0.7, "f"], [-0.15, -0.28, "n"], [0.2, -0.06, "n"], [0.64, 0.16, "f"], [0.52, 0.42, "n"], [0.1, 0.54, "n"], [-0.3, 0.44, "n"], [-0.5, 0.1, "n"], [-0.42, -0.16, "B"]], edges: loop(11) },
    { stars: [[-0.5, -0.7, "f"], [-0.24, -0.72, "f"], [-0.38, -0.2, "B"], [0.5, 0.3, "n"], [0, 0.55, "n"]], edges: [[0, 2], [1, 2], [2, 3], [3, 4], [4, 2]] },
    { stars: [hx(-1, 0, "B"), hx(-1, -1, "n"), hx(-1, -2, "f"), hx(0, -1, "n"), hx(1, -2, "f"), hx(0, 0, "n"), hx(1, 0, "n"), hx(1, 1, "n"), hx(0, 2, "n"), hx(-1, 2, "n"), hx(-1, 1, "n"), hx(2, 1, "f")], edges: [[0, 1], [1, 2], [0, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 5], [7, 11]] }
  ],
  eggs: [
    { stars: [[-0.22, 0.12, "B"], [0.22, 0.12, "B"], ...[0, 60, 120, 180, 240, 300].map(a => [0.64 * Math.cos((a * Math.PI) / 180), 0.15 + 0.4 * Math.sin((a * Math.PI) / 180), a % 120 ? "f" : "n"])], edges: [[2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 2]] },
    { stars: [[-0.32, -0.22, "f"], [-0.12, 0.1, "n"], [-0.32, 0.42, "f"], [-0.52, 0.1, "n"], [0.32, -0.22, "f"], [0.52, 0.1, "n"], [0.32, 0.42, "f"], [0.12, 0.1, "n"]], edges: [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4]] },
    { stars: [[0, -0.5, "f"], [0.36, 0.05, "n"], [0, 0.55, "f"], [-0.36, 0.05, "n"], [0, 0.05, "B"]], edges: [[0, 1], [1, 2], [2, 3], [3, 0]] },
    { stars: [hx(2, 0, "n"), hx(2, -2, "f"), hx(0, -2, "n"), hx(-2, 0, "f"), hx(-2, 2, "n"), hx(0, 2, "f"), hx(-1, 0, "B"), hx(1, 0, "B")], edges: loop(6) }
  ],
  berries: [
    { stars: [[-0.24, 0.32, "n"], [0.26, 0.36, "n"], [0.05, -0.3, "f"], [0.12, -0.72, "f"], [0.36, -0.55, "f"]], edges: [[3, 2], [2, 0], [2, 1], [3, 4]] },
    { stars: [[-0.3, 0.3, "n"], [0, 0.3, "n"], [0.3, 0.3, "n"], [-0.15, 0.05, "n"], [0.15, 0.05, "n"], [0, -0.2, "n"], [0.1, -0.62, "f"], [0.34, -0.5, "f"]], edges: [[5, 6], [6, 7]] },
    { stars: [[0, 0.2, "B"], [0.15, -0.55, "f"], [0.42, -0.4, "f"]], edges: [[0, 1], [1, 2]] },
    { stars: [hx(0, 1, "n"), hx(-1, 1, "n"), hx(-1, 2, "n"), hx(0, 0, "f"), hx(1, -1, "f"), hx(2, -2, "f"), hx(3, -2, "f")], edges: [[3, 0], [3, 1], [3, 4], [4, 5], [5, 6]] }
  ],
  wood: [
    { stars: [[-0.66, -0.22, "n"], [-0.18, -0.22, "n"], [0.54, -0.22, "n"], [0.54, 0.22, "n"], [-0.66, 0.22, "n"], [0.66, 0, "B"], [-0.13, -0.42, "f"]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [2, 5], [5, 3], [1, 6]] },
    { stars: [[-0.66, -0.2, "n"], [0.5, -0.3, "n"], [0.68, -0.1, "n"], [0.68, 0.12, "n"], [0.5, 0.3, "n"], [-0.66, 0.2, "n"], [0.5, 0, "B"], [-0.22, -0.2, "n"], [-0.13, -0.42, "f"]], edges: [[0, 7], [7, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [7, 8]] },
    { stars: [[-0.6, 0, "n"], [-0.1, 0, "n"], [0.5, 0, "B"], [-0.1, -0.45, "f"]], edges: [[0, 1], [1, 2], [1, 3]] },
    { stars: [hx(-2, 0, "n"), hx(-1, -1, "n"), hx(2, -1, "n"), hx(2, 0, "B"), hx(1, 1, "n"), hx(-2, 1, "n"), hx(0, -1, "n"), hx(1, -2, "f")], edges: [...loop(6), [6, 7]] }
  ],
  rock: [
    { stars: [[-0.62, 0.32, "n"], [-0.52, -0.18, "n"], [-0.15, -0.48, "n"], [0.3, -0.4, "n"], [0.62, 0.02, "n"], [0.5, 0.42, "n"], [-0.2, 0.48, "n"], [0.05, -0.02, "B"]], edges: [...loop(7), [7, 2], [7, 4], [7, 6]] },
    { stars: [[-0.6, 0.35, "n"], [-0.2, 0.35, "n"], [-0.4, 0.05, "n"], [0.05, 0.4, "n"], [0.6, 0.35, "n"], [0.5, -0.15, "n"], [0.15, -0.05, "n"], [-0.2, -0.45, "f"], [0.15, -0.5, "f"], [0, -0.2, "f"]], edges: [[0, 1], [1, 2], [2, 0], [3, 4], [4, 5], [5, 6], [6, 3], [7, 8], [8, 9], [9, 7]] },
    { stars: [[-0.55, 0.35, "n"], [0.55, 0.35, "n"], [0, -0.5, "n"], [0, 0.05, "B"]], edges: [[0, 1], [1, 2], [2, 0], [3, 0], [3, 1], [3, 2]] },
    { stars: [hx(-2, 2, "n"), hx(1, 2, "n"), hx(1, 0, "n"), hx(1, -2, "n"), hx(0, -2, "n"), hx(-2, 0, "n"), hx(0, 0, "B")], edges: [...loop(6), [6, 2], [6, 0]] }
  ],
  axe: [
    { stars: [[-0.42, 0.66, "n"], [0.22, -0.45, "n"], [0.29, -0.57, "f"], [0.73, -0.5, "B"], [0.43, 0.02, "f"]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 1]] },
    { stars: [[-0.5, 0.62, "n"], [-0.36, 0.7, "n"], [0.26, -0.18, "f"], [0.45, 0.04, "f"], [0.74, -0.5, "B"], [0.3, -0.6, "f"], [0.14, -0.3, "f"]], edges: loop(7) },
    { stars: [[-0.45, 0.66, "n"], [0.22, -0.42, "n"], [0.72, -0.45, "B"], [0.45, 0.02, "f"]], edges: [[0, 1], [1, 2], [2, 3], [3, 1]] },
    { stars: [hx(-3, 3, "n"), hx(1, -1, "n"), hx(3, -1, "B"), hx(3, 0, "f"), hx(1, 0, "f")], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 1]] }
  ],
  basket: [
    { stars: [[-0.6, -0.08, "n"], [0.6, -0.08, "n"], [0.44, 0.55, "n"], [-0.44, 0.55, "n"], [0, -0.52, "B"]], edges: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [4, 1]] },
    { stars: [[-0.6, -0.1, "n"], [-0.5, 0.25, "n"], [-0.3, 0.55, "n"], [0.3, 0.55, "n"], [0.5, 0.25, "n"], [0.6, -0.1, "n"], [0.42, -0.4, "f"], [0, -0.58, "B"], [-0.42, -0.4, "f"]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [5, 6], [6, 7], [7, 8], [8, 0]] },
    { stars: [[-0.5, -0.05, "n"], [0.5, -0.05, "n"], [0, 0.45, "f"], [0, -0.55, "B"]], edges: [[0, 2], [2, 1], [0, 3], [3, 1]] },
    { stars: [hx(-2, -1, "n"), hx(3, -1, "n"), hx(1, 1, "n"), hx(-2, 1, "n"), hx(0, -3, "B"), hx(3, -3, "f")], edges: [...loop(4), [0, 4], [1, 5], [4, 5]] }
  ],
  camp: [
    { stars: [[-0.68, 0.52, "n"], [0, -0.62, "B"], [0.68, 0.52, "n"], [0, 0.52, "f"]], edges: [[0, 1], [1, 2], [2, 0], [1, 3]] },
    { stars: [[0, -0.62, "B"], [0.5, 0.15, "f"], [0.7, 0.52, "n"], [-0.7, 0.52, "n"], [-0.5, 0.15, "f"], [0, 0.52, "f"]], edges: loop(5) },
    { stars: [[0, -0.62, "B"], [0.68, 0.52, "n"], [-0.68, 0.52, "n"]], edges: loop(3) },
    { stars: [hx(2, -4, "B"), hx(-4, 2, "n"), hx(2, 2, "n"), hx(-2, 2, "f"), hx(0, 2, "f"), hx(0, 0, "f")], edges: [[0, 1], [1, 2], [2, 0], [3, 5], [5, 4]] }
  ]
}
const KINDS = ["skeleton", "outline", "minimal", "hex"]
const ORDER = Object.keys(FIGS)

// ── the chart treatment ──────────────────────────────
const MAG = { f: 0.035, n: 0.05, B: 0.075 }
function chart(f) {
  const stars = f.stars.map(([x, y, k]) => disc(x, y, MAG[k]))
  const lines = f.edges.map(([i, j]) => {
    const a = f.stars[i], b = f.stars[j]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L
    const ga = MAG[a[2]] + 0.05, gb = MAG[b[2]] + 0.05
    return near([[a[0] + ux * ga, a[1] + uy * ga], [b[0] - ux * gb, b[1] - uy * gb]], 0.04)
  })
  return any([...stars, ...lines])
}

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

const inks = ORDER.map(n => FIGS[n].map(chart))
fs.writeFileSync(path.join(OUT, "sheet5-big.png"), sheet(inks.map(cells => ({ R: 36, cells })), 84))
fs.writeFileSync(path.join(OUT, "sheet5-small.png"), sheet(inks.map(cells => ({ R: 13, cells })), 32))

const rows = ORDER.map((n, ni) => {
  const cells = KINDS.map((k, ki) => {
    const imgs = [40, 13].map(R => {
      const { size, data } = single(inks[ni][ki], R)
      return `<img width="${size}" height="${size}" src="data:image/png;base64,${data.toString("base64")}" alt="">`
    }).join("")
    return `<figure>${imgs}<figcaption>${k}</figcaption></figure>`
  }).join("")
  return `<h2>${n}</h2><div class="row">${cells}</div>`
}).join("")
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>constellation constructions</title>
<style>
:root{--text:#eee;--surface:#111}
body{margin:0;padding:16px;background:var(--surface);color:var(--text);font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
body.light{--text:#111;--surface:#eee}
body.light img{filter:invert(1)}
header{display:grid;grid-template-columns:1fr auto;align-items:center;gap:12px;margin-bottom:6px}
h1{font-size:13px;font-weight:600;margin:0}
h2{font-size:13px;font-weight:600;margin:18px 0 2px}
p.sub{margin:0 0 4px;opacity:.65;max-width:78ch}
button{font:inherit;color:var(--text);background:transparent;border:1px solid color-mix(in srgb,var(--text) 30%,transparent);border-radius:6px;padding:3px 9px;cursor:pointer}
.row{display:grid;grid-template-columns:repeat(4,minmax(96px,120px));gap:6px}
figure{margin:0;display:grid;grid-template-rows:92px 32px auto;justify-items:center;align-items:center;gap:2px;padding:4px 2px}
figure img{display:block}
figcaption{opacity:.7;text-align:center}
</style></head><body>
<header><h1>constellation — four constructions per item, one treatment</h1><button id="theme">light / dark</button></header>
<p class="sub">skeleton = joints and limbs · outline = stars along the silhouette, one loop · minimal = the fewest stars that still say it · hex = stars on the board's triangular lattice, lines along 0°, 60° and 120° only. Each at icon radius 40 and 13.</p>
${rows}
<script>document.getElementById("theme").addEventListener("click",()=>document.body.classList.toggle("light"))</script>
</body></html>`
fs.writeFileSync(path.join(OUT, "constellation-constructions.html"), html)
console.log("ok", ORDER.length, "items ×", KINDS.length, "constructions")
