import { circle, line, path, poly, polar, n } from "../fv.mjs"
export const family = "forage2"

const rOf = (c, s) => (c * c / 4 + s * s) / (2 * Math.abs(s))
// a leaf: two equal arcs between two points, bulging by s
const lens = (cls, x1, y1, x2, y2, s) => {
  const c = Math.hypot(x2 - x1, y2 - y1), r = rOf(c, s)
  return path(cls, `M${n(x1)} ${n(y1)}A${n(r)} ${n(r)} 0 0 1 ${n(x2)} ${n(y2)}A${n(r)} ${n(r)} 0 0 1 ${n(x1)} ${n(y1)}Z`)
}
const lensA = (cls, cx, cy, len, ang, s) => lens(cls, cx, cy, ...polar(cx, cy, len, ang), s)
const g = (t, s) => `<g transform="${t}">${s}</g>`
// an egg: two half-ellipses meeting at the widest line (t = top height, b = bottom height)
const egg = (cls, cx, cy, w, t, b, rot = 0) =>
  g(`translate(${cx} ${cy}) rotate(${rot})`, path(cls, `M${-w / 2} 0A${w / 2} ${t} 0 0 1 ${w / 2} 0A${w / 2} ${b} 0 0 1 ${-w / 2} 0Z`))
// a circle joined to a point by its two tangents
const drop = (cls, cx, cy, r, px, py) => {
  const d = Math.hypot(cx - px, cy - py), psi = Math.atan2(py - cy, px - cx), b = Math.acos(r / d)
  const [x1, y1] = [cx + r * Math.cos(psi + b), cy + r * Math.sin(psi + b)], [x2, y2] = [cx + r * Math.cos(psi - b), cy + r * Math.sin(psi - b)]
  return path(cls, `M${n(px)} ${n(py)}L${n(x1)} ${n(y1)}A${n(r)} ${n(r)} 0 1 1 ${n(x2)} ${n(y2)}Z`)
}
const bez = (p0, p1, p2, p3) => t => {
  const u = 1 - t
  return [0, 1].map(i => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i])
}
const normal = (C, t) => {
  const e = 1e-3, a = C(Math.max(0, t - e)), b = C(Math.min(1, t + e)), l = Math.hypot(b[0] - a[0], b[1] - a[1])
  return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l]
}
// a band along the curve C; w(t) is its width, or [left, right] half-widths
const strip = (cls, C, w, t0 = 0, t1 = 1, N = 64) => {
  const L = [], R = []
  for (let i = 0; i <= N; i++) {
    const t = t0 + ((t1 - t0) * i) / N, [x, y] = C(t), [nx, ny] = normal(C, t)
    let ww = w(t); if (!Array.isArray(ww)) ww = [ww / 2, ww / 2]
    L.push([n(x + nx * ww[0]), n(y + ny * ww[0])]); R.push([n(x - nx * ww[1]), n(y - ny * ww[1])])
  }
  return poly(cls, [...L, ...R.reverse()])
}
const along = (cls, C, t0 = 0, t1 = 1, N = 40) => poly(cls, [...Array(N + 1)].map((_, i) => C(t0 + ((t1 - t0) * i) / N).map(n)), false)
const arcLen = C => { let L = 0, p = C(0); for (let i = 1; i <= 100; i++) { const q = C(i / 100); L += Math.hypot(q[0] - p[0], q[1] - p[1]); p = q } return L }
// a kelp strap: thin stipe, full width W, blunt round tip, one edge ruffled by r
const strapW = (C, W, r, k, sg) => {
  const f = W / 2 / arcLen(C), base = 0.14
  return t => {
    let w = W
    if (t < base) w = 0.05 + (W - 0.05) * Math.sin((Math.PI / 2) * (t / base))
    if (t > 1 - f) w = W * Math.sqrt(Math.max(0, 1 - ((t - (1 - f)) / f) ** 2))
    const rf = t > base ? r * Math.abs(Math.sin(t * k * Math.PI)) * Math.min(1, (t - base) * 6) * Math.min(1, (1 - t) * 8) : 0
    return sg > 0 ? [w / 2, w / 2 + rf] : [w / 2 + rf, w / 2]
  }
}
// move and scale a drawing in place (absolute path commands, circles, lines), so the pen keeps its width
const xf = (svg, k, dx = 0, dy = 0) => svg
  .replace(/ d="([^"]+)"/g, (_, d) => ` d="${d.replace(/([MLCQSTAHV])([^MLCQSTAHVZ]*)/gi, (m, c, a) => {
    const v = a.trim().split(/[\s,]+/).filter(Boolean).map(Number), C = c.toUpperCase()
    const o = v.map((x, i) => C === "A" ? ([2, 3, 4].includes(i % 7) ? x : i % 7 === 6 ? n(x * k + dy) : i % 7 === 5 ? n(x * k + dx) : n(x * k)) : C === "H" ? n(x * k + dx) : C === "V" ? n(x * k + dy) : n(x * k + (i % 2 ? dy : dx)))
    return c + o.join(" ")
  })}"`)
  .replace(/ (cx|x1|x2)="([^"]+)"/g, (_, a, v) => ` ${a}="${n(+v * k + dx)}"`).replace(/ (cy|y1|y2)="([^"]+)"/g, (_, a, v) => ` ${a}="${n(+v * k + dy)}"`).replace(/ r="([^"]+)"/g, (_, v) => ` r="${n(+v * k)}"`)

export const icons = {
  plants: {
    title: "plants",
    concept: "a leaf on its stalk given half a turn, veined face then hatched back: the first twist of a cord",
    svg: () => {
      const C = bez([-0.37, 0.61], [-0.27, -0.03], [0.27, -0.03], [0.4, -0.7])
      const w = t => 0.46 * Math.abs(Math.sin(2 * Math.PI * t)) * (1 - 0.34 * t)
      let v = ""
      for (const t of [0.13, 0.22, 0.31]) {
        const [x, y] = C(t), [fx, fy] = C(t + 0.06), [nx, ny] = normal(C, t), hw = (w(t + 0.05) / 2) * 0.7
        v += `M${n(x)} ${n(y)}L${n(fx + nx * hw)} ${n(fy + ny * hw)}M${n(x)} ${n(y)}L${n(fx - nx * hw)} ${n(fy - ny * hw)}`
      }
      return line(-0.37, 0.61, -0.45, 0.76) + strip("f", C, w, 0, 0.5) + along("pt", C, 0.06, 0.44) + path("pt", v) + strip("h", C, w, 0.5, 1) + strip("s", C, w, 0.5, 1)
    },
  },
  fruit: {
    title: "fruit",
    concept: "one apple, half whole in ink, half cut open to its core",
    svg: g("translate(0 0.1)",
      path("f", "M0 -0.34C-0.18 -0.56 -0.68 -0.52 -0.66 -0.02C-0.64 0.42 -0.34 0.68 -0.12 0.64Q0 0.6 0 0.6Z") +
      path("s", "M0 -0.34C0.18 -0.56 0.68 -0.52 0.66 -0.02C0.64 0.42 0.34 0.68 0.12 0.64Q0 0.6 0 0.6") +
      path("t", "M0 -0.24C0.2 -0.08 0.2 0.22 0 0.38") + egg("f", 0.08, 0.07, 0.12, 0.11, 0.07, 160) +
      path("pt", "M-0.46 -0.1Q-0.44 -0.3 -0.28 -0.36") +
      path("s", "M0 -0.34Q0 -0.56 0.12 -0.76") + lens("f", 0.08, -0.62, 0.5, -0.74, 0.1) + path("pt", "M0.14 -0.64L0.42 -0.72")),
  },
  roots: {
    title: "roots",
    concept: "a turnip: inked crown above, hatched taper below, three leaves up",
    svg:
      drop("h", 0, 0.04, 0.44, 0.0, 0.86) + drop("s", 0, 0.04, 0.44, 0.0, 0.86) +
      path("f", "M-0.44 0.04A0.44 0.44 0 0 1 0.44 0.04Q0.22 0.16 0 0.08Q-0.22 0.0 -0.44 0.04Z") +
      path("pt", "M-0.28 -0.14Q-0.24 -0.26 -0.12 -0.3") +
      lensA("s", -0.05, -0.42, 0.42, -122, 0.12) + lensA("f", 0, -0.44, 0.44, -88, 0.12) + lensA("s", 0.05, -0.42, 0.42, -56, 0.12),
  },
  berries: {
    title: "berries",
    concept: "a hanging strig of currants, each with its glint",
    svg: () => {
      const B = [[-0.36, -0.2, 0.18], [0.42, 0.0, 0.18], [-0.2, 0.4, 0.2], [0.26, 0.64, 0.19]]
      return path("s", "M-0.02 -0.8Q-0.06 -0.2 0.2 0.36") +
        lens("f", -0.01, -0.6, 0.48, -0.68, 0.12) + path("pt", "M0.06 -0.62L0.4 -0.67M0.16 -0.64L0.23 -0.57M0.28 -0.66L0.35 -0.59") +
        path("s", "M-0.01 -0.45L-0.28 -0.28M0.04 -0.16L0.34 -0.04M0.11 0.13L-0.12 0.32M0.2 0.36L0.24 0.48") +
        B.map(([x, y, r]) => circle("f", x, y, r) + circle("p", x - r * 0.4, y - r * 0.4, 0.045)).join("")
    },
  },
  nuts: {
    title: "nuts",
    concept: "two acorns hung from one forked stalk, one inked in a hatched cup, one drawn in a scaled cup",
    svg: () => {
      const RIM = "M-0.29 -0.02C-0.29 -0.2 -0.16 -0.27 0 -0.27C0.16 -0.27 0.29 -0.2 0.29 -0.02Z", NUT = "M-0.22 -0.04C-0.22 0.26 -0.08 0.46 0 0.54C0.08 0.46 0.22 0.26 0.22 -0.04Z"
      const acorn = (x, y, r, cup, nut) => g(`translate(${x} ${y}) rotate(${r})`,
        path("p", "M-0.3 -0.04C-0.3 0.32 -0.12 0.56 0 0.66C0.12 0.56 0.3 0.32 0.3 -0.04Z") + path(nut, NUT) +
        (nut === "f" ? path("pt", "M-0.12 0.06Q-0.12 0.26 -0.05 0.38") : path("s", NUT)) +
        path("p", "M-0.36 0.02C-0.36 -0.24 -0.2 -0.34 0 -0.34C0.2 -0.34 0.36 -0.24 0.36 0.02Z") + path(cup, RIM) + path("s", RIM) +
        (cup === "f" ? path("pt", "M-0.17 -0.09Q0 -0.15 0.17 -0.09M-0.1 -0.19Q0 -0.22 0.1 -0.19") : "") + line(0, -0.27, 0, -0.38))
      return path("s", "M0.04 -0.76Q0.02 -0.6 -0.3 -0.5M0.02 -0.62Q0.2 -0.56 0.36 -0.4") + acorn(-0.36, -0.1, 18, "h", "f") + acorn(0.36, 0.06, -16, "f", "s")
    },
  },
  oysters: {
    title: "oysters",
    concept: "prised open at the hinge: a rough lid lifted off a pearl",
    svg:
      path("f", "M-0.66 0.16C-0.3 0.08 0.3 0.04 0.7 0.1Q0.7 0.26 0.58 0.3Q0.58 0.44 0.42 0.48Q0.36 0.62 0.18 0.6Q0.04 0.7 -0.12 0.62Q-0.3 0.64 -0.38 0.52Q-0.56 0.48 -0.56 0.34Q-0.7 0.28 -0.66 0.16Z") +
      path("s", "M-0.62 0.0C-0.3 -0.12 0.2 -0.24 0.58 -0.34Q0.6 -0.5 0.46 -0.54Q0.42 -0.7 0.24 -0.7Q0.1 -0.82 -0.08 -0.72Q-0.26 -0.72 -0.34 -0.58Q-0.52 -0.52 -0.54 -0.36Q-0.68 -0.24 -0.62 0.0Z") +
      path("t", "M-0.4 -0.06Q-0.48 -0.28 -0.34 -0.44M-0.16 -0.13Q-0.28 -0.4 -0.12 -0.58M0.1 -0.2Q0.0 -0.44 0.18 -0.56M0.34 -0.27Q0.3 -0.42 0.42 -0.48") +
      path("pt", "M-0.4 0.22Q-0.3 0.4 -0.06 0.46M0.0 0.24Q0.14 0.36 0.36 0.32") +
      circle("p", 0.16, 0.0, 0.19) + circle("s", 0.16, 0.0, 0.13),
  },
  crabs: {
    title: "crabs",
    concept: "seen from above: a toothed shell, two raised split claws, eyes on stalks",
    svg: () => {
      const claw = sg => path("s", `M${0.3 * sg} -0.08L${0.54 * sg} -0.22L${0.56 * sg} -0.34`) + lens("f", 0.56 * sg, -0.28, 0.42 * sg, -0.84, 0.18 * sg) + line(0.51 * sg, -0.5, 0.44 * sg, -0.86, "ps")
      const legs = sg => path("s", `M${0.46 * sg} 0.06L${0.72 * sg} -0.02L${0.84 * sg} 0.16M${0.46 * sg} 0.24L${0.72 * sg} 0.26L${0.8 * sg} 0.46M${0.36 * sg} 0.38L${0.56 * sg} 0.52L${0.58 * sg} 0.72`)
      return xf(path("f", "M-0.5 0.02L-0.44 -0.12L-0.36 -0.12L-0.3 -0.18L-0.2 -0.17L-0.1 -0.2H0.1L0.2 -0.17L0.3 -0.18L0.36 -0.12L0.44 -0.12L0.5 0.02C0.5 0.32 0.24 0.5 0 0.5C-0.24 0.5 -0.5 0.32 -0.5 0.02Z") +
        claw(1) + claw(-1) + legs(1) + legs(-1) + path("s", "M-0.1 -0.2L-0.12 -0.32M0.1 -0.2L0.12 -0.32") + circle("f", -0.12, -0.36, 0.065) + circle("f", 0.12, -0.36, 0.065) +
        path("pt", "M-0.26 0.04Q-0.16 0.14 -0.2 0.28M0.26 0.04Q0.16 0.14 0.2 0.28"), 0.9, 0, 0.05)
    },
  },
  kelp: {
    title: "kelp",
    concept: "three blunt ruffled straps leaning one way under the surface line",
    svg: () => {
      const A = bez([-0.16, 0.8], [-0.3, 0.3], [-0.5, -0.04], [-0.24, -0.46])
      const B = bez([-0.04, 0.8], [-0.04, 0.3], [0.0, 0.0], [0.3, -0.34])
      const C = bez([0.06, 0.8], [0.2, 0.5], [0.34, 0.3], [0.62, 0.16])
      const wA = strapW(A, 0.2, 0.025, 7, -1), wB = strapW(B, 0.22, 0.03, 6, 1), wC = strapW(C, 0.16, 0.02, 6, 1)
      return path("s", "M-0.6 -0.62Q-0.45 -0.7 -0.3 -0.62T0 -0.62T0.3 -0.62T0.6 -0.62") + strip("s", C, wC) +
        strip("p", B, t => wB(t).map(v => v + 0.07)) + strip("f", B, wB) + along("pt", B, 0.18, 0.86) +
        strip("p", A, t => wA(t).map(v => v + 0.07)) + strip("h", A, wA) + strip("s", A, wA)
    },
  },
  eggs: {
    title: "eggs",
    concept: "two speckled eggs on a few straws, one inked, one drawn",
    svg:
      egg("s", 0.38, 0.22, 0.44, 0.38, 0.28, 26) + circle("f", 0.44, 0.14, 0.035) + circle("f", 0.32, 0.32, 0.03) + circle("f", 0.52, 0.34, 0.03) +
      egg("p", -0.14, 0.02, 0.82, 0.72, 0.54, -12) + egg("f", -0.14, 0.02, 0.7, 0.64, 0.46, -12) +
      circle("p", -0.26, -0.28, 0.05) + circle("p", 0.0, -0.16, 0.04) + circle("p", -0.32, 0.1, 0.04) + circle("p", 0.02, 0.2, 0.05) + circle("p", -0.12, 0.0, 0.03) +
      path("t", "M-0.7 0.56L0.2 0.48M-0.4 0.6L0.72 0.5M-0.62 0.48L0.0 0.62"),
  },
  herbs: {
    title: "herbs",
    concept: "a lavender spike: whorls of buds climbing one stem",
    svg: () => {
      let s = path("s", "M0 0.84Q0.02 0.3 0 -0.14")
      for (const [y, L, a] of [[-0.14, 0.22, 52], [-0.32, 0.2, 48], [-0.49, 0.17, 44], [-0.64, 0.14, 40]]) s += lensA("f", 0, y, L, -90 - a, 0.06) + lensA("f", 0, y, L, -90 + a, 0.06)
      return s + lensA("f", 0, -0.64, 0.18, -90, 0.06) + lensA("s", 0.01, 0.48, 0.5, -150, 0.09) + lensA("s", 0.01, 0.48, 0.5, -30, 0.09)
    },
  },
}
