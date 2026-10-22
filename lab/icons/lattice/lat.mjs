// lat.mjs — the anon&mato icon lattice as a drawing toolkit.
// The canvas is a POINTY-TOP HEX of radius 1 (unit frame: x right, y DOWN,
// top vertex (0,-1), side vertices at x = ±0.866), cut into a regular
// TRIANGULAR lattice of side 1/8: 384 triangles, each with a VERTICAL edge, so
// every triangle points LEFT or RIGHT. Lattice lines run vertical, +30° and −30°.
// This is exactly the user's hand-drawn icon lattice (iso-cube faces, n = 8);
// a triangle's id is the creator's "face:i:j:half" wedge id.
//
// Two coordinate systems:
//   unit  (x, y)        — continuous, hex radius 1
//   lattice (c, v)      — integer lattice VERTICES: x = c·SQ/8, y = v/16,
//                          with c + v EVEN. |c| ≤ 8, |v| + |c| ≤ 16.
//                          V(c, v) converts to unit. Vertical neighbour: v±2;
//                          diagonal neighbours: (c±1, v±1).
// A triangle is (k, h): strip k ∈ [-8, 7] (between c = k and c = k+1) and
// centroid row h (y = h/16). In strip k every integer h holds one triangle:
// it points RIGHT (vertical edge on the left, at c = k) when k + h is ODD,
// LEFT (vertical edge on the right, at c = k+1) when k + h is EVEN.

export const N = 8
export const SQ = Math.sqrt(3) / 2
const FACES = [[[-SQ, -0.5], [SQ, -0.5]], [[-SQ, -0.5], [0, 1]], [[SQ, -0.5], [0, 1]]]

function wedgeTri(id) {
  const [f, i, j, h] = id.split(":").map(Number)
  const [e1, e2] = FACES[f]
  const P = (a, b) => [(a / N) * e1[0] + (b / N) * e2[0], (a / N) * e1[1] + (b / N) * e2[1]]
  return h === 0 ? [P(i, j), P(i + 1, j), P(i + 1, j + 1)] : [P(i, j), P(i + 1, j + 1), P(i, j + 1)]
}

// ── the 384 triangles ────────────────────────────────
export const TRIS = [] // { id, k, h, right, pts:[[x,y]×3], lv:[[c,v]×3], cx, cy }
const byKH = new Map()
const khKey = (k, h) => `${k},${h}`
for (let f = 0; f < 3; f++)
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++)
      for (let hh = 0; hh < 2; hh++) {
        const id = `${f}:${i}:${j}:${hh}`
        const pts = wedgeTri(id)
        const lv = pts.map(([x, y]) => [Math.round((x / SQ) * N), Math.round(y * 2 * N)])
        const cx = (pts[0][0] + pts[1][0] + pts[2][0]) / 3
        const cy = (pts[0][1] + pts[1][1] + pts[2][1]) / 3
        const k = Math.floor((cx / SQ) * N)
        const h = Math.round(cy * 2 * N)
        const t = { id, k, h, right: (((k + h) % 2) + 2) % 2 === 1, pts, lv, cx, cy }
        TRIS.push(t)
        byKH.set(khKey(k, h), t)
      }
export const triAt = (k, h) => byKH.get(khKey(k, h)) || null
export const V = (c, v) => [(c * SQ) / N, v / (2 * N)]
export const U2L = (x, y) => [(x / SQ) * N, y * 2 * N] // unit → fractional lattice coords

// edge-neighbours of a triangle (up to 3)
export function neighbours(t) {
  const out = []
  const up = triAt(t.k, t.h - 2)
  const dn = triAt(t.k, t.h + 2)
  // across the vertical edge: right-pointing tri's vertical edge is at c = k → strip k-1
  const side = t.right ? triAt(t.k - 1, t.h) : triAt(t.k + 1, t.h)
  // the two slanted edges connect to the triangles directly above/below in the same strip (h±1)
  const a = triAt(t.k, t.h - 1)
  const b = triAt(t.k, t.h + 1)
  for (const n of [a, b, side]) if (n) out.push(n)
  return out
}

// ── shapes: predicates over unit points ───────────────
// Every shape is { in(x, y) → bool }. Compose with union / diff / inter / xf.
const S = fn => ({ in: fn })
export const all = () => S(() => true)
export const none = () => S(() => false)
export function poly(pts) {
  // even-odd point-in-polygon; pts in UNIT coords
  return S((x, y) => {
    let c = false
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i]
      const [xj, yj] = pts[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
    }
    return c
  })
}
export const lpoly = lpts => poly(lpts.map(([c, v]) => V(c, v))) // polygon in LATTICE coords
export const circle = (cx, cy, r) => S((x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r)
export const ellipse = (cx, cy, rx, ry, rot = 0) =>
  S((x, y) => {
    const dx = x - cx
    const dy = y - cy
    const c = Math.cos(-rot)
    const s = Math.sin(-rot)
    const u = dx * c - dy * s
    const w = dx * s + dy * c
    return (u / rx) ** 2 + (w / ry) ** 2 <= 1
  })
export const ring = (cx, cy, r1, r2) => S((x, y) => {
  const d = (x - cx) ** 2 + (y - cy) ** 2
  return d >= r1 * r1 && d <= r2 * r2
})
export const rect = (x0, y0, x1, y1) => S((x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1)
// capsule: segment a→b with half-width w (round ends) — or square ends when cap = false
export function seg(a, b, w, cap = true) {
  return S((x, y) => {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const L2 = dx * dx + dy * dy || 1e-9
    let t = ((x - a[0]) * dx + (y - a[1]) * dy) / L2
    if (!cap && (t < 0 || t > 1)) return false
    t = Math.max(0, Math.min(1, t))
    const px = a[0] + t * dx - x
    const py = a[1] + t * dy - y
    return px * px + py * py <= w * w
  })
}
// polyline of capsules
export const path = (pts, w, cap = true) => union(...pts.slice(1).map((p, i) => seg(pts[i], p, w, cap)))
// arc stroke: centre, radius, half-width, angles in radians (0 = +x, clockwise since y is down)
export function arc(cx, cy, r, w, a0, a1) {
  return S((x, y) => {
    const d = Math.hypot(x - cx, y - cy)
    if (Math.abs(d - r) > w) return false
    let a = Math.atan2(y - cy, x - cx)
    const norm = t => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    const span = norm(a1 - a0)
    return norm(a - a0) <= span
  })
}
// regular polygon (hexagon default), pointy-top when rot = -90°
export function ngon(cx, cy, r, n = 6, rotDeg = -90) {
  const pts = []
  for (let i = 0; i < n; i++) {
    const a = ((rotDeg + (360 / n) * i) * Math.PI) / 180
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return poly(pts)
}
export const union = (...ss) => S((x, y) => ss.some(s => s.in(x, y)))
export const inter = (...ss) => S((x, y) => ss.every(s => s.in(x, y)))
export const diff = (a, ...bs) => S((x, y) => a.in(x, y) && !bs.some(b => b.in(x, y)))
export const not = a => S((x, y) => !a.in(x, y))
// transform: translate (dx,dy), rotate (deg, about origin), scale, mirror x
export function xf(s, { dx = 0, dy = 0, rot = 0, sc = 1, sx = 1, sy = 1, flipX = false, flipY = false, ox = 0, oy = 0 } = {}) {
  const r = (-rot * Math.PI) / 180
  const c = Math.cos(r)
  const sn = Math.sin(r)
  return S((x, y) => {
    let u = x - dx - ox
    let w = y - dy - oy
    const u2 = u * c - w * sn
    const w2 = u * sn + w * c
    u = u2 / (sc * sx)
    w = w2 / (sc * sy)
    if (flipX) u = -u
    if (flipY) w = -w
    return s.in(u + ox, w + oy)
  })
}

// ── rasterising ───────────────────────────────────────
// coverage of a shape over a triangle, by barycentric supersampling
const SAMPLES = (() => {
  const out = []
  const n = 6
  for (let a = 0; a < n; a++)
    for (let b = 0; b < n - a; b++) {
      const u = (a + 1 / 3) / n
      const v = (b + 1 / 3) / n
      if (u + v < 1) out.push([u, v])
    }
  return out
})()
export function coverage(shape, t) {
  const [A, B, C] = t.pts
  let hit = 0
  for (const [u, v] of SAMPLES) {
    const x = A[0] + u * (B[0] - A[0]) + v * (C[0] - A[0])
    const y = A[1] + u * (B[1] - A[1]) + v * (C[1] - A[1])
    if (shape.in(x, y)) hit++
  }
  return hit / SAMPLES.length
}

// ── the canvas: a set of filled triangles, painted in order ──
export class Icon {
  constructor() {
    this.on = new Set() // triangle ids
  }
  // thr = coverage threshold (0.5 = majority; lower = bolder, higher = thinner)
  fill(shape, thr = 0.5) {
    for (const t of TRIS) if (coverage(shape, t) >= thr) this.on.add(t.id)
    return this
  }
  clear(shape, thr = 0.5) {
    for (const t of TRIS) if (coverage(shape, t) >= thr) this.on.delete(t.id)
    return this
  }
  toggle(shape, thr = 0.5) {
    for (const t of TRIS) if (coverage(shape, t) >= thr) this.on.has(t.id) ? this.on.delete(t.id) : this.on.add(t.id)
    return this
  }
  // TEXTURE: fill only the triangles of one ORIENTATION inside the shape —
  // "right" (▶), "left" (◀) — the lattice's half-tone (the user's basket
  // weave and book pages). `phase` alternates by row pairs for a checker.
  texture(shape, mode = "right", thr = 0.5) {
    for (const t of TRIS) {
      if (coverage(shape, t) < thr) continue
      let pick
      if (mode === "right") pick = t.right
      else if (mode === "left") pick = !t.right
      else if (mode === "checker") pick = (Math.floor((t.h + 64) / 2) + t.k) % 2 === 0
      else if (mode === "stripes") pick = (((t.k % 2) + 2) % 2) === 0
      else if (mode === "rows") pick = (((Math.floor(t.h / 2) % 2) + 2) % 2) === 0
      else if (mode === "zigzag") pick = (((Math.floor(t.h / 2) % 2) + 2) % 2) === 0
      else if (mode === "diamonds") {
        // ◆ pairs sharing a vertical edge (a ▶ at strip c with the ◀ at strip c−1),
        // on a sparse grid so no two diamonds share an edge
        const c = t.right ? t.k : t.k + 1
        pick = (((c % 2) + 2) % 2 === 0) && ((((t.h - c - 1) / 2) % 2 + 2) % 2 === 0)
      }
      if (pick) this.on.add(t.id)
      else this.on.delete(t.id)
    }
    return this
  }
  // custom pattern: fn(t) → bool, t = { k, h, right, cx, cy } — inside the shape only
  pattern(shape, fn, thr = 0.5) {
    for (const t of TRIS) {
      if (coverage(shape, t) < thr) continue
      fn(t) ? this.on.add(t.id) : this.on.delete(t.id)
    }
    return this
  }
  // is a triangle at unit point (x, y) filled?
  has(x, y) {
    let best = null
    let bd = 1e9
    for (const q of TRIS) {
      const d = (q.cx - x) ** 2 + (q.cy - y) ** 2
      if (d < bd) (bd = d), (best = q)
    }
    return best ? this.on.has(best.id) : false
  }
  clone() {
    const c = new Icon()
    for (const id of this.on) c.on.add(id)
    return c
  }
  // set individual triangles by lattice (k, h)
  set(list, on = true) {
    for (const [k, h] of list) {
      const t = triAt(k, h)
      if (t) on ? this.on.add(t.id) : this.on.delete(t.id)
    }
    return this
  }
  // keep only the boundary band (triangles in the set touching a non-set one)
  outline() {
    const keep = new Set()
    for (const id of this.on) {
      const t = TRIS.find(q => q.id === id)
      const nb = neighbours(t)
      if (nb.length < 3 || nb.some(n => !this.on.has(n.id))) keep.add(id)
    }
    this.on = keep
    return this
  }
  mirrorX() {
    const next = new Set()
    for (const id of this.on) {
      const t = TRIS.find(q => q.id === id)
      const m = triAt(-t.k - 1, t.h)
      if (m) next.add(m.id)
    }
    this.on = next
    return this
  }
  // add the mirror image (left↔right) — symmetric figures
  symX() {
    const add = []
    for (const id of this.on) {
      const t = TRIS.find(q => q.id === id)
      const m = triAt(-t.k - 1, t.h)
      if (m) add.push(m.id)
    }
    add.forEach(id => this.on.add(id))
    return this
  }
  // shift by whole lattice steps: dc strips (must keep parity: dv ≡ dc mod 2)
  shift(dc, dv) {
    const next = new Set()
    for (const id of this.on) {
      const t = TRIS.find(q => q.id === id)
      const m = triAt(t.k + dc, t.h + dv)
      if (m) next.add(m.id)
    }
    this.on = next
    return this
  }
  // rotate by a multiple of 60° about the centre (the lattice is 6-fold symmetric)
  rot60(times = 1) {
    const r = ((times % 6) + 6) % 6
    if (!r) return this
    const a = (r * Math.PI) / 3
    const next = new Set()
    for (const id of this.on) {
      const t = TRIS.find(q => q.id === id)
      const x = t.cx * Math.cos(a) - t.cy * Math.sin(a)
      const y = t.cx * Math.sin(a) + t.cy * Math.cos(a)
      let best = null
      let bd = 1e9
      for (const q of TRIS) {
        const d = (q.cx - x) ** 2 + (q.cy - y) ** 2
        if (d < bd) (bd = d), (best = q)
      }
      if (best && bd < 1e-4) next.add(best.id)
    }
    this.on = next
    return this
  }
  add(other) {
    for (const id of other.on) this.on.add(id)
    return this
  }
  sub(other) {
    for (const id of other.on) this.on.delete(id)
    return this
  }
  get count() {
    return this.on.size
  }
  toData() {
    return { n: N, fill: [...this.on].sort(), lines: [] }
  }
}
export const icon = () => new Icon()
export const fromData = d => {
  const ic = new Icon()
  for (const id of d.fill) ic.on.add(id)
  return ic
}

// ── vector output: merge the triangles into clean outline loops ──
// Interior edges appear twice (opposite directions) and cancel; what's left is
// the boundary, walked into closed loops. Coordinates in unit frame.
export function outlineLoops(ids) {
  const set = ids instanceof Set ? ids : new Set(ids)
  const key = ([c, v]) => `${c},${v}`
  const edges = new Map() // "a|b" directed
  for (const t of TRIS) {
    if (!set.has(t.id)) continue
    // orient triangle CCW in lattice space (consistent winding)
    let [a, b, c] = t.lv
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    if (cross < 0) [b, c] = [c, b]
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const rev = `${key(q)}|${key(p)}`
      if (edges.has(rev)) edges.delete(rev)
      else edges.set(`${key(p)}|${key(q)}`, [p, q])
    }
  }
  const from = new Map()
  for (const [, [p, q]] of edges) {
    const k = key(p)
    if (!from.has(k)) from.set(k, [])
    from.get(k).push(q)
  }
  const loops = []
  const used = new Set()
  for (const [, [p0, q0]] of edges) {
    const ek = `${key(p0)}|${key(q0)}`
    if (used.has(ek)) continue
    const loop = [p0]
    let p = p0
    let q = q0
    used.add(ek)
    let guard = 0
    while (key(q) !== key(p0) && guard++ < 5000) {
      loop.push(q)
      const nexts = (from.get(key(q)) || []).filter(n => !used.has(`${key(q)}|${key(n)}`))
      if (!nexts.length) break
      // at a pinch vertex prefer the sharpest turn (keeps loops simple)
      let n = nexts[0]
      if (nexts.length > 1) {
        const dir = Math.atan2(q[1] - p[1], q[0] - p[0])
        let best = -1e9
        for (const cand of nexts) {
          let turn = Math.atan2(cand[1] - q[1], cand[0] - q[0]) - dir
          while (turn <= -Math.PI) turn += 2 * Math.PI
          while (turn > Math.PI) turn -= 2 * Math.PI
          if (turn > best) (best = turn), (n = cand)
        }
      }
      used.add(`${key(q)}|${key(n)}`)
      p = q
      q = n
    }
    // drop collinear points
    const simp = loop.filter((pt, i) => {
      const a = loop[(i - 1 + loop.length) % loop.length]
      const b = loop[(i + 1) % loop.length]
      return (pt[0] - a[0]) * (b[1] - a[1]) - (pt[1] - a[1]) * (b[0] - a[0]) !== 0 || false
    })
    loops.push((simp.length >= 3 ? simp : loop).map(([c, v]) => V(c, v)))
  }
  return loops
}
// SVG path data, scaled to a box of half-size R centred at (ox, oy)
export function svgPath(ids, R = 1, ox = 0, oy = 0, prec = 2) {
  return outlineLoops(ids)
    .map(l => "M" + l.map(([x, y]) => `${(ox + x * R).toFixed(prec)} ${(oy + y * R).toFixed(prec)}`).join("L") + "Z")
    .join("")
}
export const hexPts = (R = 1, ox = 0, oy = 0) =>
  [...Array(6)].map((_, i) => {
    const a = ((60 * i - 90) * Math.PI) / 180
    return [ox + R * Math.cos(a), oy + R * Math.sin(a)]
  })
