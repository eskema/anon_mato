// icons2 — one SKELETON per item (closed shapes, limbs, threads, details,
// dots, holes) in a unit frame (icon radius 1, y down), rendered in two skins:
//   hairline — the chrome's own pen (0.14r, round caps): union outline + lines
//   linocut  — solid one-ink silhouette, details cut out in paper
// Cooked and fine are modifiers on the skeleton, so variants share the body.
// Emits skeletons.json, a PNG contact sheet (pure node) and an HTML sheet that
// paints with canvas exactly as the game would.
import fs from "node:fs"
import zlib from "node:zlib"
import path from "node:path"

const OUT = process.argv[2] || "."
const TAU = Math.PI * 2

// ── flattened geometry ───────────────────────────────
const ell = (cx, cy, rx, ry, rot = 0, k = 48) => {
  const c = Math.cos(rot), s = Math.sin(rot), pts = []
  for (let i = 0; i < k; i++) {
    const a = (i / k) * TAU, x = Math.cos(a) * rx, y = Math.sin(a) * ry
    pts.push([cx + x * c - y * s, cy + x * s + y * c])
  }
  return pts
}
const circ = (cx, cy, r, k = 48) => ell(cx, cy, r, r, 0, k)
const arcPts = (cx, cy, rx, ry, a0, a1, k = 24) => {
  const pts = []
  for (let i = 0; i <= k; i++) {
    const a = a0 + (a1 - a0) * (i / k)
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry])
  }
  return pts
}
const quad = (p0, c, p1, k = 12) => {
  const pts = []
  for (let i = 0; i <= k; i++) {
    const t = i / k, u = 1 - t
    pts.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]])
  }
  return pts
}
const chain = (...segs) => segs.flat().filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1])
const closed = pts => [...pts, pts[0]]
const mir = pts => pts.map(([x, y]) => [-x, y])
const both = (...ps) => ps.flatMap(p => [p, mir(p)])
const ccw = pts => {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]
    a += x1 * y2 - x2 * y1
  }
  return a < 0 ? pts.slice().reverse() : pts
}
const SK = o => ({ shapes: [], limbs: [], threads: [], details: [], dots: [], holes: [], ...o })
const merge = (a, b) => Object.fromEntries(Object.keys(a).map(k => [k, [...a[k], ...(b[k] || [])]]))
const xfSk = (sk, { s = 1, dx = 0, dy = 0 }) => {
  const T = pts => pts.map(([x, y]) => [x * s + dx, y * s + dy])
  const D = ds => ds.map(([x, y, r]) => [x * s + dx, y * s + dy, r * s])
  return { shapes: sk.shapes.map(T), limbs: sk.limbs.map(T), threads: sk.threads.map(T), details: sk.details.map(T), dots: D(sk.dots), holes: D(sk.holes) }
}

// ── the items ────────────────────────────────────────
const ITEMS = {}
ITEMS.crabs = SK({
  shapes: [ell(0, 0.12, 0.42, 0.28), circ(-0.58, -0.22, 0.2), circ(0.58, -0.22, 0.2)],
  limbs: both([[-0.34, -0.02], [-0.46, -0.14]], [[-0.3, 0.22], [-0.64, 0.34]], [[-0.26, 0.36], [-0.48, 0.62]], [[-0.13, -0.14], [-0.16, -0.34]]),
  details: both([[-0.58, -0.22], [-0.72, -0.38]]),
  dots: [[-0.16, -0.38, 0.06], [0.16, -0.38, 0.06]]
})
ITEMS.fish = xfSk(
  SK({
    shapes: [ell(-0.1, 0, 0.5, 0.26), [[0.28, 0], [0.74, -0.32], [0.66, 0], [0.74, 0.32]], [[-0.24, -0.2], [-0.02, -0.48], [0.18, -0.18]]],
    details: [[[-0.28, -0.16], [-0.28, 0.16]]],
    holes: [[-0.42, -0.05, 0.06]]
  }),
  { s: 0.95 }
)
ITEMS.hare = SK({
  shapes: [ell(0.1, 0.24, 0.44, 0.29), circ(-0.34, -0.1, 0.21), ell(-0.42, -0.46, 0.08, 0.24, -0.15), ell(-0.22, -0.44, 0.08, 0.24, 0.25), circ(0.54, 0.24, 0.1)],
  details: [quad([0.02, 0.48], [0.16, 0.2], [0.42, 0.34])],
  holes: [[-0.4, -0.14, 0.05]]
})
ITEMS.eggs = SK({
  shapes: [ell(-0.29, 0.05, 0.24, 0.32, -0.12), ell(0.29, 0.05, 0.24, 0.32, 0.12)],
  limbs: [arcPts(0, 0.12, 0.6, 0.34, 0.12 * Math.PI, 0.88 * Math.PI)]
})
ITEMS.berries = SK({
  shapes: [circ(-0.27, 0.22, 0.22), circ(0.27, 0.22, 0.22), circ(0, -0.22, 0.22), ell(0.3, -0.63, 0.19, 0.09, -0.5)],
  limbs: [[[0.02, -0.44], [0.12, -0.72]]]
})
ITEMS.wood = SK({
  shapes: [[[-0.66, -0.22], [0.54, -0.22], [0.54, 0.22], [-0.66, 0.22]], ell(0.54, 0, 0.14, 0.22), [[-0.3, -0.2], [-0.2, -0.42], [-0.06, -0.42], [-0.1, -0.2]]],
  details: [arcPts(0.54, 0, 0.14, 0.22, Math.PI / 2, (3 * Math.PI) / 2), closed(ell(0.54, 0, 0.06, 0.1, 0, 24)), [[-0.5, -0.06], [0, -0.06]], [[-0.3, 0.08], [0.2, 0.08]]]
})
ITEMS.rock = SK({
  shapes: [[[-0.62, 0.32], [-0.52, -0.18], [-0.15, -0.48], [0.3, -0.4], [0.62, 0.02], [0.5, 0.42], [-0.2, 0.48]]],
  details: [[[-0.05, -0.42], [0.08, -0.05], [-0.1, 0.22]], [[0.08, -0.05], [0.42, 0.12]]]
})
ITEMS.metal = SK({
  shapes: [[[-0.55, 0.1], [0.55, 0.1], [0.42, 0.42], [-0.42, 0.42]], [[-0.35, -0.22], [0.35, -0.22], [0.24, 0.1], [-0.24, 0.1]]],
  details: [[[-0.4, 0.1], [0.4, 0.1]]]
})
ITEMS.axe = SK({
  shapes: [[[0.29, -0.57], [0.73, -0.5], [0.43, 0.02], [0.15, -0.33]]],
  limbs: [[[-0.42, 0.66], [0.22, -0.45]]],
  details: [[[0.62, -0.42], [0.38, -0.02]]]
})
ITEMS.basket = SK({
  shapes: [[[-0.6, -0.08], [0.6, -0.08], [0.44, 0.55], [-0.44, 0.55]]],
  limbs: [arcPts(0, -0.08, 0.44, 0.44, Math.PI, TAU)],
  details: [[[-0.54, 0.14], [0.54, 0.14]], [[-0.48, 0.34], [0.48, 0.34]]]
})
ITEMS.net = SK({
  limbs: [closed(circ(-0.12, -0.14, 0.46)), [[0.18, 0.21], [0.52, 0.6]]],
  threads: [[[-0.32, -0.53], [-0.32, 0.25]], [[0.08, -0.53], [0.08, 0.25]], [[-0.51, -0.34], [0.27, -0.34]], [[-0.51, 0.06], [0.27, 0.06]]]
})
ITEMS.camp = SK({
  shapes: [[[-0.68, 0.52], [0, -0.62], [0.68, 0.52]]],
  details: [[[-0.16, 0.52], [0, 0.1], [0.16, 0.52]]]
})

// ── modifiers ────────────────────────────────────────
// cooked: the same body, a touch smaller and lower, two steam curls above
const wisp = x => chain(quad([x, -0.5], [x + 0.13, -0.59], [x, -0.68]), quad([x, -0.68], [x - 0.13, -0.77], [x, -0.86]))
const cooked = base => merge(xfSk(base, { s: 0.8, dy: 0.14 }), { limbs: [wisp(-0.16), wisp(0.16)] })
// fine: the same tool with a gleam off it
const fine = (base, gx, gy) => merge(base, { limbs: [[[gx - 0.15, gy], [gx + 0.15, gy]], [[gx, gy - 0.15], [gx, gy + 0.15]]] })

const ORDER = ["crabs", "cooked crabs", "fish", "cooked fish", "hare", "eggs", "berries", "wood", "rock", "metal", "axe", "fine axe", "basket", "net", "camp"]
const ALL = { ...ITEMS, "cooked crabs": cooked(ITEMS.crabs), "cooked fish": cooked(ITEMS.fish), "fine axe": fine(ITEMS.axe, -0.4, -0.52) }
for (const sk of Object.values(ALL)) sk.shapes = sk.shapes.map(ccw)
const rnd = v => Math.round(v * 1000) / 1000
const R3 = pts => pts.map(p => p.map(rnd))
const OUTSK = Object.fromEntries(ORDER.map(n => {
  const sk = ALL[n]
  return [n, { shapes: sk.shapes.map(R3), limbs: sk.limbs.map(R3), threads: sk.threads.map(R3), details: sk.details.map(R3), dots: sk.dots.map(d => d.map(rnd)), holes: sk.holes.map(d => d.map(rnd)) }]
}))
fs.writeFileSync(path.join(OUT, "skeletons.json"), JSON.stringify(OUTSK))

// ── predicates for the node rasteriser ───────────────
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
const disc = ([x, y, r]) => p => Math.hypot(p.x - x, p.y - y) <= r
const anyOf = fs => p => fs.some(f => f(p))
const PEN = 0.14, LIMB = 0.16, CUT = 0.08, THREAD = 0.08
const DIRS = Array.from({ length: 8 }, (_, k) => [Math.cos((k / 8) * TAU), Math.sin((k / 8) * TAU)])
function inkHairline(sk) {
  const U = anyOf(sk.shapes.map(inPoly))
  const lines = anyOf([...sk.limbs, ...sk.threads, ...sk.details].map(l => near(l, PEN)))
  const dots = anyOf([...sk.dots, ...sk.holes].map(([x, y, r]) => disc([x, y, Math.max(r, 0.06)])))
  return p => {
    if (!U(p)) for (const [dx, dy] of DIRS) if (U({ x: p.x + dx * PEN, y: p.y + dy * PEN })) return true
    return lines(p) || dots(p)
  }
}
function inkLinocut(sk) {
  const U = anyOf(sk.shapes.map(inPoly))
  const cut = anyOf([...sk.details.map(d => near(d, CUT)), ...sk.holes.map(disc)])
  const add = anyOf([...sk.limbs.map(l => near(l, LIMB)), ...sk.threads.map(t => near(t, THREAD)), ...sk.dots.map(disc)])
  return p => (U(p) && !cut(p)) || add(p)
}

// ── PNG contact sheet ────────────────────────────────
const INK = [238, 238, 238], PAPER = [17, 17, 17], HEXBG = [30, 30, 30]
const SQ = Math.sqrt(3) / 2
const hexIn = inPoly([[0, -1], [SQ, -0.5], [SQ, 0.5], [0, 1], [-SQ, 0.5], [-SQ, -0.5]])
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
function sheet(rows, cell) {
  const cols = Math.max(...rows.map(r => r.cells.length))
  const W = cols * cell, H = rows.length * cell
  const buf = Buffer.alloc(W * H * 3)
  for (let i = 0; i < W * H; i++) buf.set(PAPER, i * 3)
  rows.forEach((row, ri) => {
    row.cells.forEach((ink, ci) => {
      const R = row.R, cx = ci * cell + cell / 2, cy = ri * cell + cell / 2
      for (let py = Math.floor(cy - R - 2); py <= cy + R + 2; py++)
        for (let px = Math.floor(cx - R - 2); px <= cx + R + 2; px++) {
          if (px < 0 || py < 0 || px >= W || py >= H) continue
          const acc = [0, 0, 0]
          for (const [sx, sy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
            const p = { x: (px + sx - cx) / R, y: (py + sy - cy) / R }
            const c = !hexIn(p) ? PAPER : ink(p) ? INK : HEXBG
            acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]
          }
          buf.set([acc[0] / 4, acc[1] / 4, acc[2] / 4], (py * W + px) * 3)
        }
    })
  })
  return png(W, H, buf)
}
const hair = ORDER.map(n => inkHairline(ALL[n]))
const lino = ORDER.map(n => inkLinocut(ALL[n]))
fs.writeFileSync(path.join(OUT, "sheet2-big.png"), sheet([{ R: 36, cells: hair }, { R: 36, cells: lino }], 84))
fs.writeFileSync(path.join(OUT, "sheet2-small.png"), sheet([{ R: 13, cells: hair }, { R: 13, cells: lino }], 32))

// ── HTML sheet: canvas painters, as the game would draw them ──
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>icon sampler 2</title>
<style>
:root{--text:#eee;--surface:#111}
body.light{--text:#111;--surface:#eee}
body{margin:0;padding:16px;background:var(--surface);color:var(--text);font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
header{display:grid;grid-template-columns:1fr auto;align-items:center;gap:12px;margin-bottom:10px}
h1{font-size:13px;font-weight:600;margin:0}
h2{font-size:13px;font-weight:600;margin:22px 0 4px}
p.sub{margin:0 0 10px;opacity:.65}
button{font:inherit;color:var(--text);background:transparent;border:1px solid color-mix(in srgb,var(--text) 30%,transparent);border-radius:6px;padding:3px 9px;cursor:pointer}
.row{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:6px}
figure{margin:0;display:grid;grid-template-rows:80px 44px 26px auto;justify-items:center;align-items:center;gap:2px;padding:6px 2px}
figcaption{opacity:.7;text-align:center}
.note{opacity:.6;margin:16px 0 0}
</style></head><body>
<header><h1>icon sampler 2 — two skins on one skeleton per item</h1><button id="theme">light / dark</button></header>
<div id="sheet"></div>
<script>
const SK=${JSON.stringify(OUTSK)}
const ORDER=${JSON.stringify(ORDER)}
const TAU=Math.PI*2
const path=(ctx,pts,x,y,r,close)=>{ctx.beginPath();pts.forEach(([px,py],i)=>i?ctx.lineTo(x+px*r,y+py*r):ctx.moveTo(x+px*r,y+py*r));if(close)ctx.closePath()}
const discs=(ctx,ds,x,y,r,min=0)=>{for(const [dx,dy,dr] of ds){ctx.beginPath();ctx.arc(x+dx*r,y+dy*r,Math.max(dr,min)*r,0,TAU);ctx.fill()}}
function hairline(ctx,sk,x,y,r,ink,paper){
  const w=0.14*r;ctx.lineCap=ctx.lineJoin="round"
  ctx.strokeStyle=ink;ctx.lineWidth=2*w;for(const s of sk.shapes){path(ctx,s,x,y,r,true);ctx.stroke()}
  ctx.fillStyle=paper;ctx.beginPath();for(const s of sk.shapes){s.forEach(([px,py],i)=>i?ctx.lineTo(x+px*r,y+py*r):ctx.moveTo(x+px*r,y+py*r));ctx.closePath()}ctx.fill()
  ctx.lineWidth=w;for(const l of [...sk.limbs,...sk.threads,...sk.details]){path(ctx,l,x,y,r,false);ctx.stroke()}
  ctx.fillStyle=ink;discs(ctx,[...sk.dots,...sk.holes],x,y,r,0.06)
}
function linocut(ctx,sk,x,y,r,ink,paper){
  ctx.lineCap=ctx.lineJoin="round"
  ctx.fillStyle=ink;ctx.beginPath();for(const s of sk.shapes){s.forEach(([px,py],i)=>i?ctx.lineTo(x+px*r,y+py*r):ctx.moveTo(x+px*r,y+py*r));ctx.closePath()}ctx.fill()
  ctx.strokeStyle=ink;ctx.lineWidth=0.16*r;for(const l of sk.limbs){path(ctx,l,x,y,r,false);ctx.stroke()}
  ctx.lineWidth=0.08*r;for(const t of sk.threads){path(ctx,t,x,y,r,false);ctx.stroke()}
  ctx.strokeStyle=paper;for(const d of sk.details){path(ctx,d,x,y,r,false);ctx.stroke()}
  ctx.fillStyle=paper;discs(ctx,sk.holes,x,y,r)
  ctx.fillStyle=ink;discs(ctx,sk.dots,x,y,r)
}
const STYLES=[["hairline","the chrome's own pen — one weight, round caps, an outline plus a few lines; kin to folder / back / home / camp",hairline],["linocut","solid one-ink silhouettes with the details cut out in paper; flips with the night like a stamp",linocut]]
const css=v=>getComputedStyle(document.body).getPropertyValue(v).trim()
function paint(){const ink=css("--text"),paper=css("--surface");document.querySelectorAll("canvas").forEach(c=>{const sk=SK[c.dataset.item],fn=c.dataset.style==="hairline"?hairline:linocut;const px=+c.dataset.px,dpr=devicePixelRatio||1;c.width=px*dpr;c.height=px*dpr;c.style.width=c.style.height=px+"px";const ctx=c.getContext("2d");ctx.scale(dpr,dpr);ctx.clearRect(0,0,px,px);fn(ctx,sk,px/2,px/2,px/2*0.9,ink,paper)})}
const sheet=document.getElementById("sheet")
for(const [id,sub] of STYLES){const h=document.createElement("h2");h.textContent=id;sheet.append(h);const p=document.createElement("p");p.className="sub";p.textContent=sub;sheet.append(p);const row=document.createElement("div");row.className="row";for(const name of ORDER){const fig=document.createElement("figure");for(const px of [80,44,26]){const c=document.createElement("canvas");c.dataset.item=name;c.dataset.style=id;c.dataset.px=px;fig.append(c)}const cap=document.createElement("figcaption");cap.textContent=name;fig.append(cap);row.append(fig)}sheet.append(row)}
const n=document.createElement("p");n.className="note";n.textContent="80 · 44 · 26 px — a menu hex, a pack box, a tile badge. Cooked = the same body, smaller and lower, steam above. Fine = the same tool with a gleam. Flip ink and paper with the button.";sheet.append(n)
document.getElementById("theme").addEventListener("click",()=>{document.body.classList.toggle("light");paint()})
paint()
</script></body></html>`
fs.writeFileSync(path.join(OUT, "icon-sampler-2.html"), html)
console.log("ok", ORDER.length, "items × 2 skins")
