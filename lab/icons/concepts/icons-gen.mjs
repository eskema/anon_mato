// icons-gen — describe an icon as geometry in the creator's unit-hex frame,
// rasterise it onto the wedge lattice (same ids as lib/icons.js / iconmaker.js),
// and emit {n, fill, lines} the creator pastes. Also renders a PNG contact sheet
// (pure node) and an HTML sheet that paints with the game's own drawWedges.
import fs from "node:fs"
import zlib from "node:zlib"
import path from "node:path"

const OUT = process.argv[2] || "."
const SQ = Math.sqrt(3) / 2
const A = [-SQ, -0.5], B = [SQ, -0.5], C = [0, 1]
const FACES = [[A, B], [A, C], [B, C]]
const HEX = [[0, -1], [SQ, -0.5], [SQ, 0.5], [0, 1], [-SQ, 0.5], [-SQ, -0.5]]

// ── shape predicates on {x,y}, unit hex frame (radius 1, pointy top, y down) ──
const circle = (cx, cy, r) => p => Math.hypot(p.x - cx, p.y - cy) <= r
const ellipse = (cx, cy, rx, ry, rot = 0) => {
  const c = Math.cos(rot), s = Math.sin(rot)
  return p => {
    const dx = p.x - cx, dy = p.y - cy
    const x = dx * c + dy * s, y = -dx * s + dy * c
    return (x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1
  }
}
const poly = pts => p => {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j]
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
const rect = (x, y, w, h) => poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]])
const segDist = (p, a, b) => {
  const vx = b[0] - a[0], vy = b[1] - a[1]
  const L = vx * vx + vy * vy
  let t = L ? ((p.x - a[0]) * vx + (p.y - a[1]) * vy) / L : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a[0] + vx * t), p.y - (a[1] + vy * t))
}
const stroke = (pts, w) => p => {
  for (let i = 0; i < pts.length - 1; i++) if (segDist(p, pts[i], pts[i + 1]) <= w / 2) return true
  return false
}
const arc = (cx, cy, r, a0, a1, w) => p => {
  const d = Math.hypot(p.x - cx, p.y - cy)
  if (Math.abs(d - r) > w / 2) return false
  let span = a1 - a0
  while (span < 0) span += Math.PI * 2
  let rel = Math.atan2(p.y - cy, p.x - cx) - a0
  while (rel < 0) rel += Math.PI * 2
  return rel <= span
}
const union = (...fs) => p => fs.some(f => f(p))
const minus = (f, ...cuts) => p => f(p) && !cuts.some(c => c(p))
const inter = (f, g) => p => f(p) && g(p)
const mirror = f => p => f({ x: -p.x, y: p.y })
const sym = f => union(f, mirror(f))
const xf = (f, { s = 1, dx = 0, dy = 0 }) => p => f({ x: (p.x - dx) / s, y: (p.y - dy) / s })
const NONE = () => false
const M = ([ax, ay, bx, by]) => [-ax, ay, -bx, by] // mirror a hairline
const xfLine = ([ax, ay, bx, by], { s = 1, dx = 0, dy = 0 }) => [ax * s + dx, ay * s + dy, bx * s + dx, by * s + dy]

// ── the lattice ──────────────────────────────────────
function wedges(n) {
  const out = []
  FACES.forEach(([e1, e2], f) => {
    const P = (a, b) => [(a / n) * e1[0] + (b / n) * e2[0], (a / n) * e1[1] + (b / n) * e2[1]]
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const p00 = P(i, j), p10 = P(i + 1, j), p11 = P(i + 1, j + 1), p01 = P(i, j + 1)
        out.push({ id: `${f}:${i}:${j}:0`, f, i, j, h: 0, p: [p00, p10, p11] })
        out.push({ id: `${f}:${i}:${j}:1`, f, i, j, h: 1, p: [p00, p11, p01] })
      }
  })
  return out
}
const cent = w => [(w.p[0][0] + w.p[1][0] + w.p[2][0]) / 3, (w.p[0][1] + w.p[1][1] + w.p[2][1]) / 3]
// a wedge is filled when its centroid is inside, or two of its three vertex-ward
// samples are — biased to fill, so thin marks hold together at small n
function raster(shape, n, shade = null) {
  const fill = []
  for (const w of wedges(n)) {
    const [cx, cy] = cent(w)
    const hit = shape({ x: cx, y: cy })
    let k = 0
    for (const v of w.p) if (shape({ x: cx + (v[0] - cx) * 0.55, y: cy + (v[1] - cy) * 0.55 })) k++
    if (!(hit || k >= 2)) continue
    if (shade && shade({ x: cx, y: cy }) && !shade.keep(w)) continue
    fill.push(w.id)
  }
  return fill
}
function verts(n) {
  const vs = []
  FACES.forEach(([e1, e2]) => {
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) vs.push([(i / n) * e1[0] + (j / n) * e2[0], (i / n) * e1[1] + (j / n) * e2[1]])
  })
  return vs
}
const snapper = n => {
  const vs = verts(n)
  const r3 = v => Math.round(v * 1000) / 1000
  return (x, y) => {
    let best = vs[0], bd = 1e9
    for (const v of vs) {
      const d = Math.hypot(v[0] - x, v[1] - y)
      if (d < bd) { bd = d; best = v }
    }
    return [r3(best[0]), r3(best[1])]
  }
}
// hairlines snap to lattice corners, as the creator's line tool does
const snapLines = (lines, n) => {
  const s = snapper(n)
  return lines.map(([ax, ay, bx, by]) => [...s(ax, ay), ...s(bx, by)])
}
function pointWedge(x, y, n) {
  for (let f = 0; f < 3; f++) {
    const [e1, e2] = FACES[f]
    const det = e1[0] * e2[1] - e1[1] * e2[0]
    const a = (x * e2[1] - y * e2[0]) / det
    const b = (e1[0] * y - e1[1] * x) / det
    if (a >= 0 && a < 1 && b >= 0 && b < 1) {
      const i = Math.floor(a * n), j = Math.floor(b * n)
      return `${f}:${i}:${j}:${a * n - i >= b * n - j ? 0 : 1}`
    }
  }
  return null
}

// ── the items: body (always wedges) + detail (wedges in A/B, hairlines in C) ──
// crab: body, two claws with a bite out, arms, three legs a side, eye stalks
const crabBody = union(
  ellipse(0, 0.12, 0.4, 0.28),
  sym(minus(circle(-0.58, -0.22, 0.21), poly([[-0.58, -0.22], [-0.8, -0.52], [-0.48, -0.5]]))),
  sym(stroke([[-0.32, -0.02], [-0.5, -0.18]], 0.13)),
  sym(stroke([[-0.3, 0.2], [-0.64, 0.3]], 0.12)),
  sym(stroke([[-0.33, 0.3], [-0.6, 0.5]], 0.12)),
  sym(stroke([[-0.25, 0.36], [-0.44, 0.62]], 0.12)),
  sym(stroke([[-0.13, -0.14], [-0.15, -0.3]], 0.09)),
  sym(circle(-0.15, -0.33, 0.065))
)
// the COOKED modifier: the same body, a little smaller and lower, steam above
const steamWisp = x => [[x, -0.5], [x + 0.08, -0.66], [x, -0.82]]
const cooked = base => ({
  body: xf(base.body, { s: 0.82, dy: 0.14 }),
  detailFill: union(...[-0.26, 0, 0.26].map(x => stroke(steamWisp(x), 0.13))),
  detailLines: [-0.26, 0, 0.26].flatMap(x => {
    const w = steamWisp(x)
    return [[...w[0], ...w[1]], [...w[1], ...w[2]]]
  })
})
// the FINE modifier: the same tool, a gleam off its working edge
const fine = (base, gx, gy) => ({
  body: base.body,
  detailFill: union(stroke([[gx - 0.15, gy], [gx + 0.15, gy]], 0.08), stroke([[gx, gy - 0.15], [gx, gy + 0.15]], 0.08)),
  detailLines: [[gx - 0.17, gy, gx + 0.17, gy], [gx, gy - 0.17, gx, gy + 0.17]]
})

const ITEMS = {}
ITEMS.crabs = { body: crabBody, detailFill: NONE, detailLines: [] }
ITEMS["cooked crabs"] = cooked(ITEMS.crabs)
ITEMS.fish = {
  body: minus(union(ellipse(-0.08, 0, 0.5, 0.27), poly([[0.3, 0], [0.72, -0.32], [0.72, 0.32]]), poly([[-0.2, -0.22], [0.02, -0.5], [0.2, -0.2]])), circle(-0.4, -0.06, 0.08)),
  detailFill: NONE,
  detailLines: [[-0.27, -0.18, -0.27, 0.18]]
}
ITEMS.hare = {
  body: minus(
    union(ellipse(0.1, 0.25, 0.48, 0.34), circle(-0.38, -0.12, 0.24), ellipse(-0.46, -0.55, 0.09, 0.3, -0.15), ellipse(-0.24, -0.52, 0.09, 0.3, 0.25), circle(0.58, 0.28, 0.12)),
    circle(-0.44, -0.16, 0.05)
  ),
  detailFill: NONE,
  detailLines: []
}
ITEMS.eggs = { body: union(ellipse(-0.3, 0.05, 0.24, 0.33, -0.15), ellipse(0.3, 0.05, 0.24, 0.33, 0.15)), detailFill: NONE, detailLines: [] }
ITEMS.berries = {
  body: union(circle(-0.27, 0.22, 0.22), circle(0.27, 0.22, 0.22), circle(0, -0.2, 0.22), stroke([[0, -0.42], [0.12, -0.72]], 0.09), ellipse(0.3, -0.62, 0.2, 0.1, -0.5)),
  detailFill: NONE,
  detailLines: []
}
ITEMS.wood = {
  body: minus(union(rect(-0.66, -0.22, 1.2, 0.44), ellipse(0.54, 0, 0.14, 0.24), poly([[-0.3, -0.2], [-0.2, -0.42], [-0.05, -0.42], [-0.1, -0.2]])), ellipse(0.54, 0, 0.06, 0.11)),
  detailFill: NONE,
  detailLines: [[-0.5, -0.08, 0.1, -0.08], [-0.3, 0.1, 0.3, 0.1]]
}
ITEMS.rock = {
  body: poly([[-0.62, 0.32], [-0.52, -0.18], [-0.15, -0.48], [0.3, -0.4], [0.62, 0.02], [0.5, 0.42], [-0.2, 0.48]]),
  detailFill: NONE,
  detailLines: [[-0.05, -0.42, 0.08, -0.05], [0.08, -0.05, -0.1, 0.2]]
}
// the handle runs at 60° — a lattice direction, so it rasterises clean at n=8
ITEMS.axe = {
  body: union(stroke([[-0.42, 0.66], [0.22, -0.45]], 0.13), poly([[0.29, -0.57], [0.73, -0.5], [0.43, 0.02], [0.15, -0.33]])),
  detailFill: NONE,
  detailLines: []
}
ITEMS["fine axe"] = fine(ITEMS.axe, -0.4, -0.52)
ITEMS.basket = {
  body: union(poly([[-0.6, -0.08], [0.6, -0.08], [0.44, 0.55], [-0.44, 0.55]]), arc(0, -0.08, 0.44, Math.PI, Math.PI * 2, 0.11)),
  detailFill: NONE,
  detailLines: [[-0.52, 0.14, 0.52, 0.14], [-0.47, 0.34, 0.47, 0.34]]
}
const hoop = minus(circle(-0.12, -0.14, 0.5), circle(-0.12, -0.14, 0.38))
// the mesh follows the lattice: a coarse grid where the wedges are coarse
const meshFill = {
  byN: n =>
    inter(
      circle(-0.12, -0.14, 0.4),
      n >= 12
        ? union(stroke([[-0.32, -0.6], [-0.32, 0.3]], 0.07), stroke([[0.08, -0.6], [0.08, 0.3]], 0.07), stroke([[-0.6, -0.34], [0.4, -0.34]], 0.07), stroke([[-0.6, 0.06], [0.4, 0.06]], 0.07))
        : union(stroke([[-0.12, -0.6], [-0.12, 0.3]], 0.1), stroke([[-0.6, -0.14], [0.4, -0.14]], 0.1))
    )
}
ITEMS.net = {
  body: union(hoop, stroke([[0.2, 0.24], [0.52, 0.6]], 0.13)),
  detailFill: meshFill,
  detailLines: [[-0.32, -0.5, -0.32, 0.22], [0.08, -0.5, 0.08, 0.22], [-0.5, -0.34, 0.26, -0.34], [-0.5, 0.06, 0.26, 0.06]]
}
ITEMS.camp = { body: minus(poly([[-0.68, 0.52], [0, -0.62], [0.68, 0.52]]), poly([[-0.16, 0.52], [0, 0.1], [0.16, 0.52]])), detailFill: NONE, detailLines: [] }

// ── styles ───────────────────────────────────────────
// shade: the lower-right half of a glyph loses every other wedge — a one-ink halftone
const shadow = { test: p => p.x + p.y > 0.12, keep: w => (w.i + w.j + w.h) % 2 === 0 }
const shadeFn = Object.assign(p => shadow.test(p), { keep: shadow.keep })
// the contour of a shape: the shape less its own erosion by w
const outline = (shape, w) => p => {
  if (!shape(p)) return false
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2
    if (!shape({ x: p.x + w * Math.cos(a), y: p.y + w * Math.sin(a) })) return true
  }
  return false
}
const detail = (it, n) => (it.detailFill && it.detailFill.byN ? it.detailFill.byN(n) : it.detailFill)
const STYLES = {
  A: { title: "A · wedge 8 — flat silhouette, the skill icons' own grid", n: 8, make: it => ({ n: 8, fill: raster(union(it.body, detail(it, 8)), 8), lines: [] }) },
  B: { title: "B · wedge 16 — the same drawings on a finer lattice", n: 16, make: it => ({ n: 16, fill: raster(union(it.body, detail(it, 16)), 16), lines: [] }) },
  C: { title: "C · wedge 8 + hairlines — silhouette body, details as the creator's line tool", n: 8, make: it => ({ n: 8, fill: raster(it.body, 8), lines: snapLines(it.detailLines, 8) }) },
  D: { title: "D · outline 16 — the same drawings as contours, kin to the menu's line art", n: 16, make: it => ({ n: 16, fill: raster(union(outline(it.body, 0.1), detail(it, 16)), 16), lines: [] }) },
  E: { title: "E · wedge 8 shaded — A with a halftone shadow on the lower-right", n: 8, make: it => ({ n: 8, fill: raster(union(it.body, detail(it, 8)), 8, shadeFn), lines: [] }) }
}
const DESIGNS = {}
for (const [sk, st] of Object.entries(STYLES)) {
  DESIGNS[sk] = {}
  for (const [name, it] of Object.entries(ITEMS)) DESIGNS[sk][name] = st.make(it)
}
fs.writeFileSync(path.join(OUT, "designs.json"), JSON.stringify(DESIGNS))

// ── PNG contact sheet (for my own eyes) ──────────────
const INK = [238, 238, 238], PAPER = [17, 17, 17], HEXBG = [30, 30, 30]
const hexIn = poly(HEX)
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
  ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))])
}
function sheet(rows, cellW, cellH) {
  const cols = Math.max(...rows.map(r => r.cells.length))
  const W = cols * cellW, H = rows.length * cellH
  const buf = Buffer.alloc(W * H * 3)
  for (let i = 0; i < W * H; i++) buf.set(PAPER, i * 3)
  rows.forEach((row, ri) => {
    row.cells.forEach((d, ci) => {
      const R = row.R, cx = ci * cellW + cellW / 2, cy = ri * cellH + cellH / 2
      const fill = new Set(d.fill)
      const lw = 0.156 // pen(): 0.14 of the icon radius, the hex being 0.9 of it
      for (let py = Math.floor(cy - R - 2); py <= cy + R + 2; py++)
        for (let px = Math.floor(cx - R - 2); px <= cx + R + 2; px++) {
          let acc = [0, 0, 0], ns = 0
          for (const [sx, sy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
            const x = (px + sx - cx) / R, y = (py + sy - cy) / R
            let c = PAPER
            if (hexIn({ x, y })) {
              c = HEXBG
              const id = pointWedge(x, y, d.n)
              if (id && fill.has(id)) c = INK
              else for (const [ax, ay, bx, by] of d.lines) if (segDist({ x, y }, [ax, ay], [bx, by]) <= lw / 2) { c = INK; break }
            }
            acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; ns++
          }
          if (px < 0 || py < 0 || px >= W || py >= H) continue
          buf.set([acc[0] / ns, acc[1] / ns, acc[2] / ns], (py * W + px) * 3)
        }
    })
  })
  return png(W, H, buf)
}
const names = Object.keys(ITEMS)
const rows = []
for (const sk of Object.keys(STYLES)) rows.push({ R: 36, cells: names.map(nm => DESIGNS[sk][nm]) })
for (const sk of Object.keys(STYLES)) rows.push({ R: 13, cells: names.map(nm => DESIGNS[sk][nm]) })
const ns = Object.keys(STYLES).length
fs.writeFileSync(path.join(OUT, "sheet-big.png"), sheet(rows.slice(0, ns), 84, 84))
fs.writeFileSync(path.join(OUT, "sheet-small.png"), sheet(rows.slice(ns), 32, 32))

// ── HTML sheet (paints with the game's own drawWedges, copied verbatim) ──
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>icon sampler</title>
<style>
:root{--text:#eee;--surface:#111}
body.light{--text:#111;--surface:#eee}
body{margin:0;padding:16px;background:var(--surface);color:var(--text);font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
header{display:grid;grid-template-columns:1fr auto;align-items:center;gap:12px;margin-bottom:10px}
h1{font-size:13px;font-weight:600;margin:0}
h2{font-size:13px;font-weight:600;margin:22px 0 8px;opacity:.9}
button{font:inherit;color:var(--text);background:transparent;border:1px solid color-mix(in srgb,var(--text) 30%,transparent);border-radius:6px;padding:3px 9px;cursor:pointer}
.row{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:6px}
figure{margin:0;display:grid;grid-template-rows:72px 40px 24px auto;justify-items:center;align-items:center;gap:2px;padding:6px 2px;border-radius:8px;cursor:copy}
figure:hover{background:color-mix(in srgb,var(--text) 6%,transparent)}
figcaption{opacity:.7;text-align:center}
.note{opacity:.6;margin:4px 0 0}
</style></head><body>
<header><h1>icon sampler — five styles, thirteen items · click an icon to copy its JSON for the creator (paste, then save under the name)</h1><button id="theme">light / dark</button></header>
<div id="sheet"></div>
<script>
const DESIGNS=${JSON.stringify(DESIGNS)}
const TITLES=${JSON.stringify(Object.fromEntries(Object.entries(STYLES).map(([k, s]) => [k, s.title])))}
const W_SQ=Math.sqrt(3)/2
const W_FACES=[[[-W_SQ,-0.5],[W_SQ,-0.5]],[[-W_SQ,-0.5],[0,1]],[[W_SQ,-0.5],[0,1]]]
function wedgeTri(id,N){const [f,i,j,h]=id.split(":").map(Number);const [e1,e2]=W_FACES[f];const P=(a,b)=>[(a/N)*e1[0]+(b/N)*e2[0],(a/N)*e1[1]+(b/N)*e2[1]];const p00=P(i,j);const p11=P(i+1,j+1);return h===0?[p00,P(i+1,j),p11]:[p00,p11,P(i,j+1)]}
function pen(ctx,r,w=0.14){ctx.lineWidth=Math.max(1,r*w);ctx.lineJoin="round";ctx.lineCap="round"}
function drawWedges(ctx,data,x,y,r){const s=r*0.9;ctx.beginPath();for(const id of data.fill){wedgeTri(id,data.n).forEach((p,k)=>{const px=x+p[0]*s,py=y+p[1]*s;k?ctx.lineTo(px,py):ctx.moveTo(px,py)});ctx.closePath()}ctx.fill();if(data.lines&&data.lines.length){pen(ctx,r);ctx.beginPath();for(const [ax,ay,bx,by] of data.lines){ctx.moveTo(x+ax*s,y+ay*s);ctx.lineTo(x+bx*s,y+by*s)}ctx.stroke()}}
const ink=()=>getComputedStyle(document.body).getPropertyValue("--text").trim()
function paint(){document.querySelectorAll("canvas").forEach(c=>{const d=JSON.parse(c.dataset.d);const dpr=devicePixelRatio||1;const px=+c.dataset.px;c.width=px*dpr;c.height=px*dpr;c.style.width=c.style.height=px+"px";const ctx=c.getContext("2d");ctx.scale(dpr,dpr);ctx.clearRect(0,0,px,px);ctx.fillStyle=ctx.strokeStyle=ink();drawWedges(ctx,d,px/2,px/2,px/2*0.92)})}
const sheet=document.getElementById("sheet")
for(const [sk,items] of Object.entries(DESIGNS)){const h=document.createElement("h2");h.textContent=TITLES[sk];sheet.append(h);const row=document.createElement("div");row.className="row";for(const [name,d] of Object.entries(items)){const fig=document.createElement("figure");for(const px of [72,40,24]){const c=document.createElement("canvas");c.dataset.d=JSON.stringify(d);c.dataset.px=px;fig.append(c)}const cap=document.createElement("figcaption");cap.textContent=name;fig.append(cap);fig.title="copy JSON";fig.addEventListener("click",()=>{navigator.clipboard?.writeText(JSON.stringify(d));cap.textContent="copied";setTimeout(()=>cap.textContent=name,900)});row.append(fig)}sheet.append(row)}
const p=document.createElement("p");p.className="note";p.textContent="72 · 40 · 24 px — the menu hex, a pack box, a tile badge. Ink and paper flip with the button, as the game does after dark.";sheet.append(p)
document.getElementById("theme").addEventListener("click",()=>{document.body.classList.toggle("light");paint()})
paint()
</script></body></html>`
fs.writeFileSync(path.join(OUT, "icon-sampler.html"), html)
console.log("ok", names.length, "items ×", Object.keys(STYLES).length, "styles")
