import { circle, line, arc, path, poly, polar, n } from "../fv.mjs"
export const family = "forage"

const rOf = (c, s) => (c * c / 4 + s * s) / (2 * Math.abs(s))
// a leaf: two equal arcs between two points, bulging by s
const lens = (cls, x1, y1, x2, y2, s) => {
  const c = Math.hypot(x2 - x1, y2 - y1), r = rOf(c, s)
  return path(cls, `M${n(x1)} ${n(y1)}A${n(r)} ${n(r)} 0 0 1 ${n(x2)} ${n(y2)}A${n(r)} ${n(r)} 0 0 1 ${n(x1)} ${n(y1)}Z`)
}
const lensA = (cls, cx, cy, len, ang, s) => {
  const [x2, y2] = polar(cx, cy, len, ang)
  return lens(cls, cx, cy, x2, y2, s)
}
// half a leaf: one arc from base to tip, closed by the rib
const half = (cls, x1, y1, x2, y2, s, sweep) => {
  const c = Math.hypot(x2 - x1, y2 - y1), r = rOf(c, s)
  return path(cls, `M${n(x1)} ${n(y1)}A${n(r)} ${n(r)} 0 0 ${sweep} ${n(x2)} ${n(y2)}Z`)
}
// an egg: two half-ellipses meeting at the widest line
const egg = (cls, cx, cy, w, t, b, rot = 0) =>
  `<g transform="translate(${cx} ${cy}) rotate(${rot})"><path class="${cls}" d="M${-w / 2} 0A${w / 2} ${t} 0 0 1 ${w / 2} 0A${w / 2} ${b} 0 0 1 ${-w / 2} 0Z"/></g>`
const g = (t, s) => `<g transform="${t}">${s}</g>`
// a pear: two circles on the axis joined by their outer tangents
const pearD = (cx, y1, r1, y2, r2) => {
  const a = Math.asin(-(r1 - r2) / (y1 - y2)), c = Math.cos(a), s = Math.sin(a)
  const p = (y, r, side) => `${n(cx + side * r * c)} ${n(y + r * s)}`
  return `M${p(y2, r2, -1)}A${r2} ${r2} 0 0 1 ${p(y2, r2, 1)}L${p(y1, r1, 1)}A${r1} ${r1} 0 1 1 ${p(y1, r1, -1)}Z`
}
// a ribbon swaying along a sine, narrowing to its tip
const ribbon = (cls, x0, y0, y1, amp, waves, w0, w1, phase = 0, taper = 1) => {
  const N = 48, L = [], R = []
  for (let i = 0; i <= N; i++) {
    const t = i / N, y = y0 + (y1 - y0) * t
    const x = x0 + amp * Math.sin(phase + t * waves * 2 * Math.PI)
    const w = (w0 + (w1 - w0) * Math.pow(t, taper)) / 2
    L.push([n(x - w), n(y)]); R.push([n(x + w), n(y)])
  }
  return poly(cls, [...L, ...R.reverse()])
}
export const icons = {
  plants: {
    title: "plants",
    concept: "one leaf split down its rib: half ink, half paper",
    svg:
      half("f", -0.46, 0.46, 0.58, -0.58, 0.34, 0) +
      half("s", -0.46, 0.46, 0.58, -0.58, 0.34, 1) +
      line(-0.64, 0.64, -0.46, 0.46),
  },
  fruit: {
    title: "fruit",
    concept: "a pear built from two circles and their tangents",
    svg:
      path("f", pearD(0, 0.3, 0.45, -0.22, 0.24)) +
      path("s", "M0.02 -0.44Q0.02 -0.62 0.14 -0.78") +
      lens("s", 0.06, -0.6, 0.5, -0.66, 0.11),
  },
  roots: {
    title: "roots",
    concept: "the ground line: two leaves above, the food below",
    svg:
      line(-0.72, -0.2, 0.72, -0.2) +
      lens("s", -0.02, -0.32, -0.34, -0.74, 0.1) +
      lens("s", 0.02, -0.32, 0.32, -0.66, 0.09) +
      path("f", "M-0.26 -0.06C-0.3 0.3 -0.05 0.52 0.02 0.8C0.1 0.52 0.32 0.3 0.26 -0.06Z") +
      line(0.22, 0.22, 0.48, 0.35),
  },
  berries: {
    title: "berries",
    concept: "a bramble berry is a little hex grid",
    svg:
      [[0, 0], ...[...Array(6)].map((_, i) => polar(0, 0, 0.38, 30 + 60 * i))]
        .map(([x, y]) => circle("f", x, y + 0.18, 0.14)).join("") +
      path("s", "M-0.28 -0.4L0 -0.3L0.28 -0.4M0 -0.3Q0 -0.6 0.2 -0.78"),
  },
  nuts: {
    title: "nuts",
    concept: "the acorn is a jar: its cap lifts like a lid",
    svg:
      path("f", "M-0.38 0C-0.38 0.4 -0.16 0.7 0 0.8C0.16 0.7 0.38 0.4 0.38 0Z") +
      g("translate(-0.06 -0.2) rotate(-16)",
        path("h", "M-0.5 0A0.5 0.44 0 0 1 0.5 0Z") + path("s", "M-0.5 0A0.5 0.44 0 0 1 0.5 0Z") + line(0, -0.44, 0.08, -0.6)),
  },
  oysters: {
    title: "oysters",
    concept: "a fan shell ribbed like the sun-dial's hours: open it today, it won't keep",
    svg: () => {
      const H = [0, 0.54], R = 1.1, a0 = -134, a1 = -46, k = 7
      const P = [...Array(k + 1)].map((_, i) => polar(H[0], H[1], R, a0 + ((a1 - a0) * i) / k))
      let d = `M${H[0]} ${H[1]}L${P[0][0]} ${P[0][1]}`
      for (let i = 0; i < k; i++) d += `A0.11 0.11 0 0 1 ${P[i + 1][0]} ${P[i + 1][1]}`
      let ribs = ""
      for (let i = 1; i < k; i++) {
        const a = a0 + ((a1 - a0) * i) / k, [x1, y1] = polar(H[0], H[1], 0.32, a), [x2, y2] = polar(H[0], H[1], R - 0.12, a)
        ribs += line(x1, y1, x2, y2, "ps")
      }
      return path("f", d + "Z") + ribs + path("f", "M-0.24 0.42H0.24L0.16 0.6H-0.16Z")
    },
  },
  crabs: {
    title: "crabs",
    concept: "a half-moon shell holding up two bitten-circle pincers",
    svg: () => {
      const pin = (cx, cy, a) => {
        const [x1, y1] = polar(cx, cy, 0.2, a - 28), [x2, y2] = polar(cx, cy, 0.2, a + 28)
        return path("f", `M${cx} ${cy}L${x1} ${y1}A0.2 0.2 0 1 0 ${x2} ${y2}Z`)
      }
      return path("f", "M-0.5 0.1A0.5 0.36 0 0 0 0.5 0.1Z") + line(-0.3, 0.04, -0.46, -0.26) + line(0.3, 0.04, 0.46, -0.26) +
        pin(-0.48, -0.44, -70) + pin(0.48, -0.44, -110) + line(-0.42, 0.34, -0.68, 0.52) + line(0.42, 0.34, 0.68, 0.52)
    },
  },
  kelp: {
    title: "kelp",
    concept: "two waves stood upright, one float of air rising off them",
    svg:
      ribbon("f", -0.22, 0.82, -0.8, 0.14, 1.6, 0.2, 0.02, 0, 3) +
      ribbon("f", 0.3, 0.82, -0.35, 0.12, 1.2, 0.18, 0.02, Math.PI, 3) +
      circle("s", 0.42, -0.62, 0.1),
  },
  eggs: {
    title: "eggs",
    concept: "three eggs in a hatched nest, the front one inked",
    svg:
      egg("s", -0.36, -0.08, 0.36, 0.3, 0.22, -18) +
      egg("s", 0.36, -0.08, 0.36, 0.3, 0.22, 18) +
      egg("f", 0, -0.2, 0.4, 0.36, 0.25, 0) +
      path("h", "M-0.74 0.12A0.74 0.6 0 0 0 0.74 0.12Z") +
      line(-0.8, 0.12, 0.8, 0.12),
  },
  herbs: {
    title: "herbs",
    concept: "three leaves and a stem make the healer's cross",
    svg:
      lensA("f", 0, 0, 0.7, -90, 0.15) + lensA("f", 0, 0, 0.7, 180, 0.15) + lensA("f", 0, 0, 0.7, 0, 0.15) +
      line(0, 0, 0, 0.72),
  },
}
