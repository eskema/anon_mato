import { circle, line, arc, poly, path, polar, ngonPts, n } from "../fv.mjs"
export const family = "land"

// Every land tile is drawn on the same ground line, at the same height: set
// any two side by side and the ground runs on. Each tile is what happens on,
// above or beyond that one line.
const G = 0.3
const X = 0.8
const ground = (a = -X, b = X) => line(a, G, b, G)
// a solid body along centreline f(t) with half-width w(t)
const tube = (cls, f, w, k = 90) => {
  const L = [], R = []
  for (let i = 0; i <= k; i++) {
    const t = i / k, [x, y] = f(t), [x1, y1] = f(Math.max(0, t - 1e-3)), [x2, y2] = f(Math.min(1, t + 1e-3))
    const l = Math.hypot(x2 - x1, y2 - y1), dx = (x2 - x1) / l, dy = (y2 - y1) / l
    L.push([n(x - dy * w(t)), n(y + dx * w(t))]); R.push([n(x + dy * w(t)), n(y - dx * w(t))])
  }
  return poly(cls, [...L, ...R.reverse()])
}
// a swell: a solid sine ribbon that tapers to a point at both ends
const swell = (x0, x1, y, amp, waves, hw) =>
  tube("f", t => [x0 + (x1 - x0) * t, y + amp * Math.sin(t * waves * 2 * Math.PI)], t => hw * Math.pow(Math.sin(Math.PI * t), 0.6), 160)
// a solid grass blade rooted at x on the ground, leaning to (x+lean, G-h)
const blade = (x, w, lean, h) => path("f", `M${n(x - w)} ${G}Q${n(x + lean * 0.15)} ${n(G - h * 0.55)} ${n(x + lean)} ${n(G - h)}Q${n(x + lean * 0.35 + w)} ${n(G - h * 0.45)} ${n(x + w)} ${G}Z`)
const cloudD = (x0, x1, y) => `M${x0} ${y}A0.13 0.13 0 0 1 ${n(x0 + 0.2)} ${n(y - 0.15)}A0.2 0.2 0 0 1 ${n(x0 + 0.56)} ${n(y - 0.16)}A0.15 0.15 0 0 1 ${x1} ${y}Z`
const gull = (x, y, s = 1) => path("f", `M${n(x)} ${n(y)}Q${n(x + 0.12 * s)} ${n(y - 0.12 * s)} ${n(x + 0.24 * s)} ${n(y + 0.02 * s)}Q${n(x + 0.36 * s)} ${n(y - 0.12 * s)} ${n(x + 0.48 * s)} ${n(y)}Q${n(x + 0.36 * s)} ${n(y - 0.04 * s)} ${n(x + 0.24 * s)} ${n(y + 0.1 * s)}Q${n(x + 0.12 * s)} ${n(y - 0.04 * s)} ${n(x)} ${n(y)}Z`)
// x on the left flank of a needle with apex (0, top) and half-base hb at G
const flank = (y, top, hb) => n(-hb * (y - top) / (G - top))

export const icons = {
  plain: { title: "plain", concept: "the line lies level and one tuft leans in a wind with nothing to stop it",
    svg: ground() + blade(-0.36, 0.09, 0.26, 0.64) + blade(-0.04, 0.09, 0.34, 0.96) + blade(0.28, 0.09, 0.26, 0.52) },
  river: { title: "river", concept: "one swell between two banks: the far side is near enough to see",
    svg: line(-X, G - 0.56, X, G - 0.56) + swell(-0.66, 0.66, G - 0.28, 0.07, 2, 0.11) + ground() },
  water: { title: "water", concept: "the ground stops at the line; beyond it only swells, and no far bank",
    svg: swell(-0.408, 0.408, G - 0.56, -0.06, 1.5, 0.085) + swell(-0.68, 0.68, G - 0.26, 0.07, 2.5, 0.1) + ground() },
  beach: { title: "beach", concept: "the line tilts down into the sea and a wave curls onto it",
    svg: path("h", `M-${X} -0.1L${X} 0.36H-${X}Z`) + line(-X, -0.1, X, 0.36) + `<g transform="translate(0.3 0.25) scale(1.2) translate(-0.3 -0.25)">` + path("f", "M0.05 0.17A0.3 0.3 0 1 1 0.62 -0.01A0.16 0.16 0 1 0 0.3 -0.01L0.3 0.25Z") + `</g>` },
  marsh: { title: "marsh", concept: "the line breaks into pools and a bulrush stands in the gap",
    svg: line(-X, G, -0.24, G) + line(0.24, G, X, G) + line(-0.5, G + 0.24, 0.5, G + 0.24) + line(0, G + 0.12, 0, -0.7) + `<rect class="f" x="-0.11" y="-0.52" width="0.22" height="0.48" rx="0.11"/>` + path("s", `M0 ${G + 0.12}Q-0.08 -0.02 -0.42 -0.18`) + path("s", `M0 ${G + 0.12}Q0.1 0.08 0.4 0.02`) },
  forest: { title: "forest", concept: "one dark canopy on many trunks: the ground shows only between them",
    svg: ground() + path("f", `M-0.7 0.02A0.2 0.2 0 0 1 -0.4 -0.33A0.26 0.26 0 0 1 0.08 -0.45A0.24 0.24 0 0 1 0.5 -0.29A0.2 0.2 0 0 1 0.7 0.02Z`) + [-0.45, -0.1, 0.22, 0.5].map(x => line(x, 0.02, x, G)).join("") },
  mountain: { title: "mountain", concept: "a cloud lies across the solid mass: you can't survey the top",
    svg: path("f", `M-0.74 ${G}L0 -0.56L0.74 ${G}Z`) + path("p", cloudD(-0.36, 0.34, -0.02)) + ground() },
  cliff: { title: "cliff", concept: "the line steps up and juts out over the drop; a gull rides the edge",
    svg: path("h", `M-${X} -0.3H0.12L-0.02 -0.16L0.04 ${G}H-${X}Z`) + path("s", `M-${X} -0.3H0.12L-0.02 -0.16L0.04 ${G}H${X}`) + gull(0.22, -0.56, 1.25) },
  peak: { title: "peak", concept: "the ground torn up into two bare needles, and up there something glints",
    svg: ground() + path("f", `M-0.6 ${G}L-0.18 -0.68L0.04 -0.12L0.24 -0.38L0.56 ${G}Z`) + poly("f", [...Array(8)].map((_, i) => polar(0.44, -0.6, i % 2 ? 0.05 : 0.16, -90 + i * 45))) },
}
