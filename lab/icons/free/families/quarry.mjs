import { circle, line, arc, arcD, poly, path, polar, n, rad } from "../fv.mjs"
export const family = "quarry"

// the line f(t) for t in [a, b]
const curve = (cls, f, k = 90, a = 0, b = 1) => poly(cls, [...Array(k + 1)].map((_, i) => f(a + ((b - a) * i) / k)).map(([x, y]) => [n(x), n(y)]), false)
// a solid body along a centreline f(t), t in [a, b], with half-width w(t)
const body = (cls, f, w, k = 90, a = 0, b = 1) => {
  const L = [], R = []
  for (let i = 0; i <= k; i++) {
    const t = a + ((b - a) * i) / k, [x, y] = f(t), [x1, y1] = f(Math.max(0, t - 1e-3)), [x2, y2] = f(Math.min(1, t + 1e-3))
    const l = Math.hypot(x2 - x1, y2 - y1), dx = (x2 - x1) / l, dy = (y2 - y1) / l
    L.push([n(x - dy * w(t)), n(y + dx * w(t))]); R.push([n(x + dy * w(t)), n(y - dx * w(t))])
  }
  return poly(cls, [...L, ...R.reverse()])
}
// Catmull-Rom curve through points, as f(t)
const thru = P => t => {
  const m = P.length - 1, u = Math.min(t * m, m - 1e-9), i = Math.floor(u), s = u - i
  const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(m, i + 2)]
  return [0, 1].map(k => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * s + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * s * s + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * s * s * s))
}
// where a sampled curve crosses itself: [[t on the first pass, t on the second], …]
const crossings = (f, k = 400) => {
  const P = [...Array(k + 1)].map((_, i) => f(i / k)), X = []
  for (let i = 0; i < k; i++) for (let j = i + 3; j < k; j++) {
    const a = P[i], b = P[i + 1], c = P[j], d = P[j + 1], r = [b[0] - a[0], b[1] - a[1]], q = [d[0] - c[0], d[1] - c[1]], den = r[0] * q[1] - r[1] * q[0]
    if (Math.abs(den) < 1e-12) continue
    const t = ((c[0] - a[0]) * q[1] - (c[1] - a[1]) * q[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den
    if (t >= 0 && t < 1 && u >= 0 && u < 1) X.push([(i + t) / k, (j + u) / k])
  }
  return X
}
// the curve f offset sideways by d
const beside = (f, d) => t => {
  const [x, y] = f(t), [x1, y1] = f(Math.max(0, t - 1e-3)), [x2, y2] = f(Math.min(1, t + 1e-3)), l = Math.hypot(x2 - x1, y2 - y1)
  return [x - ((y2 - y1) / l) * d, y + ((x2 - x1) / l) * d]
}
// k strands laid side by side along f; where it crosses itself the first pass rides over, cut clean in paper
const laid = (f, k, sp) => {
  const ds = [...Array(k)].map((_, i) => (i - (k - 1) / 2) * sp), hw = ((k - 1) / 2) * sp + 0.05
  const draw = (a, b, m) => ds.map(d => curve("s", beside(f, d), m, a, b)).join("")
  let s = draw(0, 1, 200)
  for (const [t] of crossings(f)) {
    const w = 0.07 + hw * 0.4
    s += body("p", f, () => hw + 0.1, 30, t - w, t + w) + draw(Math.max(0, t - w * 1.3), Math.min(1, t + w * 1.3), 40)
  }
  return s
}
// the loose loop that cord and rope are both laid in
const LOOP = thru([[-0.7, 0.48], [-0.3, 0.42], [0.26, 0.1], [0.42, -0.3], [0.0, -0.56], [-0.4, -0.3], [-0.24, 0.1], [0.3, 0.42], [0.7, 0.48]])
const star = (cx, cy, r) => poly("f", [...Array(8)].map((_, i) => polar(cx, cy, i % 2 ? r * 0.3 : r, -90 + i * 45)))

// the lump shared by rock / shard / metal
const LUMP = [[-0.72, 0.46], [-0.62, 0.0], [-0.28, -0.44], [0.2, -0.5], [0.6, -0.18], [0.72, 0.46]]
const CORE = [0.0, 0.04], FOOT = [-0.12, 0.46]

export const icons = {
  fish: {
    title: "fish",
    concept: "one mesh of the net: a solid diamond whose knot runs on into the tail",
    svg: () => {
      const N = [-0.72, 0], T = [-0.12, -0.42], B = [-0.12, 0.42], X = [0.48, 0]
      return poly("f", [N, T, X, B]) + line(0.48, 0, 0.78, -0.21) + line(0.48, 0, 0.78, 0.21) + circle("p", -0.4, -0.04, 0.07)
    }
  },
  hare: {
    title: "hare",
    concept: "only the ears and the crown show above the grass",
    svg: () => {
      const ear = (bx, by, ang, len, w, cls) => {
        const [tx, ty] = polar(bx, by, len, ang), [mx, my] = polar(bx, by, len / 2, ang), [px, py] = polar(0, 0, w, ang + 90)
        return path(cls, `M${bx} ${by}Q${n(mx + px)} ${n(my + py)} ${tx} ${ty}Q${n(mx - px)} ${n(my - py)} ${bx} ${by}Z`)
      }
      return line(-0.75, 0.5, 0.75, 0.5) + arc("s", 0, 0.5, 0.34, 180, 360) +
        ear(-0.12, 0.18, -105, 0.78, 0.2, "f") + ear(0.12, 0.18, -70, 0.74, 0.2, "s") + circle("f", 0.14, 0.34, 0.06)
    }
  },
  eel: {
    title: "eel",
    concept: "two tangent arcs make one wave of ink, jaw agape: a fish built like a river",
    svg: () => {
      // the spine: an arc over the top, then a second arc, tangent to it, back the other way
      const c1 = [-0.42, -0.12], r1 = 0.43, a0 = -122, a1 = 10, r2 = 0.47, b1 = 54
      const c2 = polar(c1[0], c1[1], r1 + r2, a1), la = (a1 - a0) * r1, lb = (a1 + 180 - b1) * r2
      const E = t => { const s = t * (la + lb); return s <= la ? polar(c1[0], c1[1], r1, a0 + (a1 - a0) * s / la) : polar(c2[0], c2[1], r2, a1 + 180 - (a1 + 180 - b1) * (s - la) / lb) }
      const w = t => (t < 0.1 ? 0.075 + 0.075 * Math.sqrt(t / 0.1) : t < 0.55 ? 0.15 : 0.15 * Math.pow((1 - t) / 0.45, 0.8))
      const [hx, hy] = E(0), [kx, ky] = E(0.02), l = Math.hypot(kx - hx, ky - hy), dx = (kx - hx) / l, dy = (ky - hy) / l
      const [ex, ey] = E(0.09)
      return body("f", E, w, 200) + line(hx - dx * 0.04, hy - dy * 0.04, hx + dx * 0.13, hy + dy * 0.13, "ps") + circle("p", ex + dy * 0.05, ey - dx * 0.05, 0.045)
    }
  },
  wood: {
    title: "wood",
    concept: "a felled log: bark in half-tone, the cut face bare to its ring and heart",
    svg: () => {
      const c = [-0.25, 0.2], r = 0.48, dir = -35
      const [bx, by] = polar(c[0], c[1], 0.62, dir)
      const [u1x, u1y] = polar(c[0], c[1], r, dir - 90), [u2x, u2y] = polar(bx, by, r, dir - 90)
      const [l1x, l1y] = polar(c[0], c[1], r, dir + 90), [l2x, l2y] = polar(bx, by, r, dir + 90)
      const back = arcD(bx, by, r, dir - 90, dir + 90)
      return path("h", `M${n(u1x)} ${n(u1y)}L${n(u2x)} ${n(u2y)}${back.replace(/^M[^A]+/, "")}L${n(l1x)} ${n(l1y)}Z`) +
        line(u1x, u1y, u2x, u2y) + line(l1x, l1y, l2x, l2y) + path("s", back) +
        circle("p", c[0], c[1], r) + circle("s", c[0], c[1], r) + circle("s", c[0], c[1], 0.25) + circle("f", c[0], c[1], 0.07)
    }
  },
  branches: {
    title: "branches",
    concept: "a forked stick, snapped square at the thick end and thin at the tips: every haft begins as a fork",
    svg: () => {
      const taper = (x1, y1, x2, y2, w1, w2) => {
        const l = Math.hypot(x2 - x1, y2 - y1), nx = -(y2 - y1) / l, ny = (x2 - x1) / l
        return poly("f", [[x1 + nx * w1, y1 + ny * w1], [x2 + nx * w2, y2 + ny * w2], [x2 - nx * w2, y2 - ny * w2], [x1 - nx * w1, y1 - ny * w1]].map(([x, y]) => [n(x), n(y)])) + circle("f", x2, y2, w2)
      }
      return taper(-0.54, 0.64, 0.52, -0.58, 0.12, 0.05) + taper(0.06, -0.06, -0.3, -0.62, 0.075, 0.045) + taper(0.32, -0.34, 0.64, -0.3, 0.06, 0.04)
    }
  },
  rock: {
    title: "rock",
    concept: "a lump already cracked into the three shards it will give; one is inked",
    svg: () => poly("f", [CORE, LUMP[4], LUMP[5]]) + poly("s", LUMP) + poly("s", [LUMP[2], CORE, LUMP[5]], false) + line(...CORE, ...FOOT)
  },
  metal: {
    title: "metal",
    concept: "the same lump, all ink, with a paper glint: the one stone that shines",
    svg: () => poly("f", LUMP) + poly("s", LUMP) + path("ps", arcD(0.0, 0.3, 0.52, 210, 255)) + star(0.58, -0.6, 0.19)
  },
  cord: {
    title: "cord",
    concept: "two strands laid in a loose loop: the first turn of every knot",
    svg: () => laid(LOOP, 2, 0.15)
  },
  rope: {
    title: "rope",
    concept: "the same loop laid three strands wide, and wider for it: cord, for the heavy work",
    svg: () => laid(thru([[-0.7, 0.52], [-0.32, 0.46], [0.3, 0.14], [0.5, -0.28], [0.0, -0.6], [-0.48, -0.28], [-0.28, 0.14], [0.32, 0.46], [0.7, 0.52]]), 3, 0.15)
  },
  shard: {
    title: "shard",
    concept: "the rock, broken: its three pieces eased apart",
    svg: () => {
      const pieces = [[CORE, FOOT, LUMP[0], LUMP[1], LUMP[2]], [CORE, LUMP[2], LUMP[3], LUMP[4]], [CORE, LUMP[4], LUMP[5], FOOT]]
      const g = 0.075
      return pieces.map(P => {
        const cx = P.reduce((s, p) => s + p[0], 0) / P.length - CORE[0], cy = P.reduce((s, p) => s + p[1], 0) / P.length - CORE[1], l = Math.hypot(cx, cy)
        return poly("f", P.map(([x, y]) => [n(x + (cx / l) * g), n(y + (cy / l) * g)]))
      }).join("")
    }
  },
  piercer: {
    title: "piercer",
    concept: "a shard knapped to a point: two faces meet on the ridge, one in shadow",
    svg: () => {
      const P = [[0, -0.8], [0.32, 0.27], [0, 0.68], [-0.32, 0.27]]
      return poly("f", [P[0], P[1], P[2]]) + poly("s", P)
    }
  },
  crusher: {
    title: "crusher",
    concept: "the piercer's blunt twin: knapped round, no point anywhere, a flat face to strike with",
    svg: () => path("f", "M0 -0.66C0.3 -0.66 0.62 0.1 0.62 0.36C0.62 0.56 0.4 0.6 0 0.6Z") +
      path("s", "M0 -0.66C0.3 -0.66 0.62 0.1 0.62 0.36C0.62 0.56 0.4 0.6 0 0.6C-0.4 0.6 -0.62 0.56 -0.62 0.36C-0.62 0.1 -0.3 -0.66 0 -0.66Z") + line(0, -0.66, 0, 0.6)
  }
}
