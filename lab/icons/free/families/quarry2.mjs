import { circle, line, arc, poly, path, polar, n } from "../fv.mjs"
export const family = "quarry2"

// ── construction helpers ──────────────────────────────────────────────
const P = list => list.map(([x, y]) => [n(x), n(y)])
const samp = (f, k = 90, a = 0, b = 1) => [...Array(k + 1)].map((_, i) => f(a + ((b - a) * i) / k))
const curve = (cls, f, k = 90, a = 0, b = 1) => poly(cls, P(samp(f, k, a, b)), false)
// unit tangent of a curve f(t)
const tan = (f, t) => {
  const [x1, y1] = f(Math.max(0, t - 1e-3)), [x2, y2] = f(Math.min(1, t + 1e-3)), l = Math.hypot(x2 - x1, y2 - y1)
  return [(x2 - x1) / l, (y2 - y1) / l]
}
// a body of half-width w(t) along the centreline f
const bodyPts = (f, w, k = 90, a = 0, b = 1) => {
  const L = [], R = []
  for (let i = 0; i <= k; i++) {
    const t = a + ((b - a) * i) / k, [x, y] = f(t), [dx, dy] = tan(f, t), ww = w(t)
    L.push([x - dy * ww, y + dx * ww]); R.push([x + dy * ww, y - dx * ww])
  }
  return [...L, ...R.reverse()]
}
const body = (cls, f, w, k = 90, a = 0, b = 1) => poly(cls, P(bodyPts(f, w, k, a, b)))
// Catmull-Rom through points, as f(t)
const thru = Q => t => {
  const m = Q.length - 1, u = Math.min(t * m, m - 1e-9), i = Math.floor(u), s = u - i
  const p0 = Q[Math.max(0, i - 1)], p1 = Q[i], p2 = Q[i + 1], p3 = Q[Math.min(m, i + 2)]
  return [0, 1].map(k => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * s + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * s * s + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * s * s * s))
}
// arc-length lookup for a curve
const arclen = (f, k = 400) => {
  const S = [0]; let p = f(0)
  for (let i = 1; i <= k; i++) { const q = f(i / k); S.push(S[i - 1] + Math.hypot(q[0] - p[0], q[1] - p[1])); p = q }
  const L = S[k]
  const tAt = s => { s = Math.max(0, Math.min(L, s)); let i = 0; while (i < k && S[i + 1] < s) i++; const d = S[i + 1] - S[i]; return (i + (d ? (s - S[i]) / d : 0)) / k }
  return { L, tAt }
}
// a lens between two points, bulging h to each side
const lensD = (x1, y1, x2, y2, h, h2 = h) => {
  const c = Math.hypot(x2 - x1, y2 - y1), r = (c * c / 4 + h * h) / (2 * h), r2 = (c * c / 4 + h2 * h2) / (2 * h2)
  return `M${n(x1)} ${n(y1)}A${n(r)} ${n(r)} 0 0 1 ${n(x2)} ${n(y2)}A${n(r2)} ${n(r2)} 0 0 1 ${n(x1)} ${n(y1)}Z`
}
const lens = (cls, x1, y1, x2, y2, h, h2 = h) => path(cls, lensD(x1, y1, x2, y2, h, h2))
// a tapered stick with round ends
const taper = (cls, x1, y1, x2, y2, w1, w2) => {
  const l = Math.hypot(x2 - x1, y2 - y1), nx = -(y2 - y1) / l, ny = (x2 - x1) / l
  return poly(cls, P([[x1 + nx * w1, y1 + ny * w1], [x2 + nx * w2, y2 + ny * w2], [x2 - nx * w2, y2 - ny * w2], [x1 - nx * w1, y1 - ny * w1]])) + circle(cls, x2, y2, w2) + circle(cls, x1, y1, w1)
}
// circle through three points; an arc A→B passing M, sampled
const circ3 = ([ax, ay], [bx, by], [cx, cy]) => {
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d
  return [ux, uy, Math.hypot(ax - ux, ay - uy)]
}
const arcPts = (A, B, M, k = 40) => {
  const [cx, cy, r] = circ3(A, M, B), norm = a => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  const a0 = Math.atan2(A[1] - cy, A[0] - cx), a1 = Math.atan2(B[1] - cy, B[0] - cx), am = Math.atan2(M[1] - cy, M[0] - cx)
  const span = norm(am - a0) < norm(a1 - a0) ? norm(a1 - a0) : -norm(a0 - a1)
  return samp(t => [cx + r * Math.cos(a0 + span * t), cy + r * Math.sin(a0 + span * t)], k)
}
// a two-arc lens from N to X, its upper arc through U and lower through D
const lensPoly = (N, X, U, D) => [...arcPts(N, X, U), ...arcPts(X, N, D).slice(1, -1)]
// an elliptical arc, degrees, as a polyline
const ellArc = (cls, cx, cy, rx, ry, rotd, a0, a1, k = 40) => poly(cls, P(samp(t => {
  const a = (a0 + (a1 - a0) * t) * Math.PI / 180, x = rx * Math.cos(a), y = ry * Math.sin(a), r = rotd * Math.PI / 180
  return [cx + x * Math.cos(r) - y * Math.sin(r), cy + x * Math.sin(r) + y * Math.cos(r)]
}, k)), false)
// a laid rope: a solid band of half-width W along f, its strands cut slanting across in the thin paper pen, the ends rounded
const laid = (f, W, per = 0.17, sl = 0.24, bow = 0.2) => {
  const { L, tAt } = arclen(f)
  const at = (s, u) => { const t = tAt(s), [x, y] = f(t), [dx, dy] = tan(f, t); return [x - dy * W * u, y + dx * W * u] }
  let o = poly("f", P(bodyPts(f, () => W, 160))) + circle("f", ...f(0), W) + circle("f", ...f(1), W)
  for (let s0 = per * 0.6; s0 < L - per * 0.3; s0 += per) {
    const B = [...Array(9)].map((_, i) => { const u = -1 + i / 4; return [s0 + (sl / 2) * u + bow * per * (1 - u * u), u] }).filter(([s]) => s > 0.01 && s < L - 0.01)
    if (B.length > 1) o += poly("pt", P(B.map(([s, u]) => at(s, u * 1.15))), false)
  }
  return o
}

const unit = (a, b) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l] }
const add = (p, v, k = 1) => [p[0] + v[0] * k, p[1] + v[1] * k]
const rotv = (v, a) => { const r = a * Math.PI / 180; return [v[0] * Math.cos(r) - v[1] * Math.sin(r), v[0] * Math.sin(r) + v[1] * Math.cos(r)] }
// a leaping fish: two-arc body N→X, a forked tail of two lens lobes, its ripple drawn behind and before it
const leap = (N, X, { back = 0.3, belly = 0.26, ripple = [-0.3, 0.52, 0.56, 0.15], fork = 36, tl = 0.4, lb = 0.08 } = {}) => {
  const d = unit(N, X), nn = [-d[1], d[0]], mid = [(N[0] + X[0]) / 2, (N[1] + X[1]) / 2]
  const L = lensPoly(N, X, add(mid, nn, back), add(mid, nn, -belly))
  const base = add(X, d, -0.1)
  const lob = s => { const tip = add(X, rotv(d, s * fork), tl); return lens("f", ...(s > 0 ? [base, tip] : [tip, base]).flat(), lb) }
  const pedu = poly("f", P([add(base, nn, 0.07), add(X, d, 0.05), add(base, nn, -0.07)]))
  const [cx, cy, rx, ry] = ripple
  const eye = add(add(N, d, 0.2), nn, 0.07), g = add(N, d, 0.04), ga = Math.atan2(d[1], d[0]) * 180 / Math.PI
  return ellArc("s", cx, cy, rx, ry, 0, 195, 345) + poly("f", P(L)) + pedu + lob(1) + lob(-1) +
    ellArc("ps", cx, cy, rx, ry, 0, 25, 155) + ellArc("s", cx, cy, rx, ry, 0, 15, 165) +
    circle("p", ...eye, 0.05) + arc("pt", ...g, 0.34, ga - 38, ga + 38)
}

// ── the stone: one lump peaked off-centre, three faces (hatched flank, inked flank, a paper facet on top) ──
const S = [[-0.76, 0.42], [-0.62, -0.06], [-0.28, -0.48], [0.06, -0.58], [0.38, -0.32], [0.76, 0.04], [0.72, 0.42]]
const V = [0.04, -0.21], F = [0.12, 0.42]

export const icons = {
  fish: {
    title: "fish",
    concept: "a fish leaps clear of its own ripple: the moment the net has to meet",
    svg: () => leap([0.66, -0.58], [-0.12, 0.06], { ripple: [-0.18, 0.52, 0.46, 0.14] })
  },
  hare: {
    title: "hare",
    concept: "a hare at full stretch, ears laid flat: the runner the snare is set for",
    svg: () => {
      const B = lensPoly([-0.56, 0.08], [0.36, 0.0], [-0.1, -0.22], [-0.1, 0.18])
      return poly("f", P(B)) + circle("f", 0.44, -0.04, 0.15) + poly("f", P([[0.52, 0.0], [0.76, 0.1], [0.5, 0.11]])) +
        lens("f", 0.36, -0.12, -0.24, -0.4, 0.07) + lens("s", 0.46, -0.16, -0.02, -0.5, 0.06) + line(0.24, -0.18, -0.08, -0.34, "pt") +
        taper("f", -0.44, 0.12, -0.86, 0.3, 0.1, 0.035) + taper("f", 0.28, 0.08, 0.74, 0.36, 0.05, 0.035) +
        circle("f", -0.58, -0.02, 0.085) + circle("p", 0.5, -0.08, 0.034)
    }
  },
  eel: {
    title: "eel",
    concept: "one long wave of ink, the fin a thin line run round the tail; the small fin behind the head says fish, not snake",
    svg: () => {
      const C = t => [-0.82 + 1.56 * t, -0.24 * Math.sin(2 * Math.PI * (t * 1.08 - 0.04)) + 0.04]
      const W = 0.15, gap = 0.06, r = W * 0.43
      const w = t => (t > 0.9 ? W - (t - 0.9) * (W - 0.065) / 0.1 : W * Math.min(1, Math.pow(Math.max(t, 0.001) / 0.5, 0.6)))
      // the fin: off the back from 0.62, round the tail tip, back along the belly to 0.45
      const off = s => t => { const [x, y] = C(t), [dx, dy] = tan(C, t), d = s * (w(t) + gap * Math.min(1, Math.min(t, 0.999) / 0.04)); return [x - dy * d, y + dx * d] }
      const tip = C(0), [tdx, tdy] = tan(C, 0.0005)
      const fin = [...samp(off(1), 60, 0.62, 0.002), [tip[0] - tdx * gap, tip[1] - tdy * gap], ...samp(off(-1), 60, 0.002, 0.45)]
      const [px, py] = C(0.8), [dx, dy] = tan(C, 0.8), wp = w(0.8)
      const [ex, ey] = C(0.93), [edx, edy] = tan(C, 0.93), [mx, my] = C(1), [mdx, mdy] = tan(C, 1)
      return poly("t", P(fin), false) + body("f", C, w, 200) + circle("f", mx, my, r) +
        lens("f", px - dy * (wp - 0.02), py + dx * (wp - 0.02), px - dy * (wp + 0.17) - dx * 0.1, py + dx * (wp + 0.17) - dy * 0.1, 0.05) +
        circle("p", ex + edy * 0.055, ey - edx * 0.055, 0.038) + line(mx + mdx * r - mdy * 0.015, my + mdy * r + mdx * 0.015, mx + mdx * (r - 0.08) - mdy * 0.03, my + mdy * (r - 0.08) + mdx * 0.03, "pt")
    }
  },
  wood: {
    title: "wood",
    concept: "three rounds stacked end-on: bark, rings and heart, timber as it leaves the forest",
    svg: () => {
      const round = (cx, cy, r) => circle("f", cx, cy, r) + circle("p", cx, cy, r - 0.1) + circle("t", cx + 0.01, cy + 0.02, r * 0.48) + circle("f", cx + 0.02, cy + 0.03, 0.05)
      return round(-0.37, 0.3, 0.36) + round(0.37, 0.3, 0.36) + round(0, -0.34, 0.36)
    }
  },
  branches: {
    title: "branches",
    concept: "two sticks dropped across each other, twigs still on: what the floor gives up",
    svg: () => {
      const k = 0.94, st = (x1, y1, x2, y2, w1, w2) => taper("f", x1 * k, y1 * k, x2 * k, y2 * k, w1, w2)
      return st(-0.74, 0.5, 0.62, -0.5, 0.08, 0.035) + st(-0.66, 0.08, 0.76, -0.12, 0.075, 0.035) +
        st(0.18, -0.18, 0.3, -0.56, 0.045, 0.028) + st(-0.22, 0.04, -0.34, -0.3, 0.04, 0.025) + st(0.42, -0.1, 0.58, 0.18, 0.04, 0.025)
    }
  },
  rock: {
    title: "rock",
    concept: "a lump of three faces, one in each tone: hatch, ink and a paper facet on top; three faces, three shards to come",
    svg: () => poly("h", P([S[0], S[1], S[2], V, F])) + poly("f", P([V, S[4], S[5], S[6], F])) + poly("s", P(S)) + poly("s", P([S[2], V, S[4]]), false) + line(...V, ...F) +
      poly("pt", P([[0.3, -0.06], [0.46, 0.06], [0.42, 0.22]]), false)
  },
  metal: {
    title: "metal",
    concept: "not a stone but a heavy chunk, tipped up, all ink: its facets meet in a Y, a glint runs down one face and the shine is thrown off the top",
    svg: () => {
      const c = [-0.04, 0.06], C = [0.95, 0.72, 1.0, 0.8, 0.98, 0.74, 0.9, 0.7].map((k, i) => polar(...c, 0.62 * k, -100 + i * 45))
      return poly("f", P(C)) + poly("s", P(C)) + path("pt", `M${c.join(" ")}L${C[0].join(" ")}M${c.join(" ")}L${C[3].join(" ")}M${c.join(" ")}L${C[5].join(" ")}`) +
        line(-0.42, 0.0, -0.22, -0.3, "ps") + line(0.4, -0.5, 0.48, -0.62, "t") + line(0.56, -0.4, 0.7, -0.46, "t") + line(0.24, -0.56, 0.24, -0.7, "t")
    }
  },
  cord: {
    title: "cord",
    concept: "a ball of twine, wound round and round, its end run out along the ground",
    svg: () => {
      const c = [0.12, -0.18], r = 0.5
      let w = ""
      for (const [rr, k] of [[-30, 0.36], [-30, 0.72], [50, 0.5]]) w += ellArc("t", ...c, r * 0.97, r * k, rr, 0, 180)
      return circle("p", ...c, r) + w + circle("s", ...c, r) + path("s", `M${n(c[0] - 0.36)} ${n(c[1] + 0.35)}C-0.46 0.34 -0.7 0.44 -0.6 0.58C-0.5 0.68 -0.1 0.62 0.36 0.62`)
    }
  },
  rope: {
    title: "rope",
    concept: "a heavy laid rope thrown in a loop over itself, its strands slanting across",
    svg: () => {
      const f = thru([[-0.7, 0.6], [-0.4, 0.42], [0.0, 0.2], [0.38, -0.06], [0.52, -0.42], [0.26, -0.68], [-0.1, -0.56], [-0.14, -0.22], [0.2, 0.14], [0.58, 0.58]].map(([x, y]) => [x * 0.84 + 0.04, y * 0.84 + 0.04]))
      const W = 0.15
      return laid(t => f(t * 0.5), W) + body("p", f, () => W + 0.08, 60, 0.62, 0.86) + laid(t => f(0.5 + t * 0.5), W)
    }
  },
  shard: {
    title: "shard",
    concept: "the lump split along a jagged break, a chip still flying",
    svg: () => {
      const brk = [[-0.04, -0.56], [0.02, -0.38], [-0.08, -0.2], [0.02, -0.01], [-0.08, 0.2], [0.0, 0.42]], d = 0.16
      const Lp = [S[0], S[1], S[2], ...brk], Rp = [[brk[0][0] + d, brk[0][1]], S[4], S[5], S[6], ...brk.slice().reverse().map(([x, y]) => [x + d, y])]
      return poly("h", P(Lp)) + poly("s", P(Lp)) + poly("f", P(Rp)) + poly("f", P([[0.02, -0.68], [0.1, -0.82], [0.18, -0.66]]))
    }
  },
  piercer: {
    title: "piercer",
    concept: "a point knapped from a shard: one face inked and flake-scarred, one hatched, notched at the base for the shaft",
    svg: () => {
      const R = [[0, -0.86], [0.18, -0.3], [0.26, 0.22], [0.16, 0.34], [0.26, 0.48], [0.18, 0.66], [0, 0.72]]
      const L = R.map(([x, y]) => [-x, y])
      return poly("f", P(R)) + poly("h", P(L)) + poly("s", P([...R, ...L.slice(1, -1).reverse()])) + line(0, -0.86, 0, 0.72) +
        path("pt", "M0.15 -0.4Q0.06 -0.34 0.02 -0.22M0.2 -0.1Q0.1 -0.04 0.02 0.08M0.22 0.18Q0.12 0.2 0.04 0.3")
    }
  },
  crusher: {
    title: "crusher",
    concept: "a knapped head driven flat face first into stone: the stone cracks and chips fly",
    svg: () => {
      const H = [[0.18, -0.36], [-0.2, -0.4], [-0.5, -0.3], [-0.72, -0.06], [-0.66, 0.14], [-0.42, 0.34], [0.18, 0.36]]
      const lo = [[0.18, 0], [-0.69, 0], [-0.66, 0.14], [-0.42, 0.34], [0.18, 0.36]], x = 0.28
      return poly("h", P(H)) + poly("f", P(lo)) + poly("s", P(H)) + line(-0.69, 0, 0.18, 0) +
        path("s", `M${x} -0.66L${x} -0.12L${n(x + 0.14)} 0L${x} 0.12L${x} 0.66`) + poly("s", P([[x + 0.14, 0], [x + 0.26, 0.06], [x + 0.36, -0.02]]), false) + line(x, -0.12, x + 0.2, -0.3) + line(x, 0.12, x + 0.18, 0.3) +
        poly("f", P([[0.5, -0.46], [0.66, -0.56], [0.62, -0.38]])) + poly("f", P([[0.54, 0.44], [0.7, 0.4], [0.62, 0.56]]))
    }
  }

}
