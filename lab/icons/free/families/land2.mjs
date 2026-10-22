import { circle, line, arc, poly, path, polar, n } from "../fv.mjs"
export const family = "land2"

// Every land tile stands on one ground line at one height: set two side by
// side and the ground runs on. Trees are always spires, water is always the
// seigaiha fan or a wave line, and the thin pen carries only the inner detail
// (fan rings, reflections, branch tiers, a leaf vein, the starfish's eye, the summit's ridge).
const G = 0.3
const X = 0.8
const ground = (a = -X, b = X) => line(a, G, b, G)
const P = (x, y) => `${n(x)} ${n(y)}`
const sineP = (x0, x1, y, amp, waves, k = 64, ph = 0) => [...Array(k + 1)].map((_, i) => { const t = i / k; return [n(x0 + (x1 - x0) * t), n(y + amp * Math.sin(ph + t * waves * 2 * Math.PI))] })
const sine = (cls, ...a) => poly(cls, sineP(...a), false)
const capsule = (cls, x, y, w, h) => `<rect class="${cls}" x="${n(x - w / 2)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(w / 2)}"/>`
const spire = (cls, x, b, h, w) => poly(cls, [[x - w, b], [x, b - h], [x + w, b]])
// a seigaiha fan (concentric half-rings on paper, standing on y), clipped to
// |x| <= lim so a row of them stops exactly where the ground line does
const fanC = (x, y, R, lim = X) => {
  const cut = r => [x - r < -lim ? 360 - (Math.acos((-lim - x) / r) * 180) / Math.PI : 180, x + r > lim ? 360 - (Math.acos((lim - x) / r) * 180) / Math.PI : 360]
  const seg = r => { const [a0, a1] = cut(r), [x0, y0] = polar(x, y, r, a0), [x1, y1] = polar(x, y, r, a1); return `M${P(Math.max(-lim, x - r), y)}L${P(x0, y0)}A${n(r)} ${n(r)} 0 0 1 ${P(x1, y1)}L${P(Math.min(lim, x + r), y)}Z` }
  const [o0, o1] = cut(R), [m0, m1] = cut(R * 0.62)
  return path("p", seg(R)) + arc("s", x, y, R, o0, o1) + arc("t", x, y, R * 0.62, m0, m1) + path("f", seg(R * 0.26))
}
// a starfish: a fat five-armed star, its tips rounded by the pen, a paper eye
const starPts = (x, y, R, rot = -90) => [...Array(10)].map((_, i) => polar(x, y, i % 2 ? R * 0.4 : R, rot + i * 36))
const starfish = (x, y, R, rot = -90) => poly("f", starPts(x, y, R, rot)) + poly("s", starPts(x, y, R, rot)) + circle("pt", x, y, R * 0.2)
// a comb of grass spikes standing on the ground line
const comb = (H, x0 = -0.66, dx = 0.165, lean = 0.06, w = 0.05) => H.map((h, i) => { const x = x0 + i * dx; return h ? poly("f", [[x - w, G], [x + lean, G - h], [x + w, G]]) : "" }).join("")
// a daisy: k petals round a paper ring and a solid eye
const daisy = (x, y, r, k = 8) => [...Array(k)].map((_, i) => `<ellipse class="f" cx="0" cy="${n(-r * 0.54)}" rx="${n(r * 0.22)}" ry="${n(r * 0.38)}" transform="translate(${n(x)} ${n(y)}) rotate(${n(i * 360 / k)})"/>`).join("") + circle("p", x, y, r * 0.27) + circle("f", x, y, r * 0.14)
// a little spire on a trunk, standing on the far bank
const tree = (x, b, h, w) => spire("f", x, b - 0.06, h - 0.06, w) + line(x, b - 0.08, x, b)
const cloudD = (x0, x1, y, k) => { const w = (x1 - x0) / k; let d = `M${P(x0, y)}`; for (let i = 0; i < k; i++) { const r = w * (0.5 + 0.12 * ((i + 1) % 2)); d += `A${n(r)} ${n(r)} 0 0 1 ${P(x0 + w * (i + 1), y)}` } return d }
const gull = (x, y, s = 1) => path("f", `M${P(x, y)}Q${P(x + 0.12 * s, y - 0.12 * s)} ${P(x + 0.24 * s, y + 0.02 * s)}Q${P(x + 0.36 * s, y - 0.12 * s)} ${P(x + 0.48 * s, y)}Q${P(x + 0.36 * s, y - 0.04 * s)} ${P(x + 0.24 * s, y + 0.1 * s)}Q${P(x + 0.12 * s, y - 0.04 * s)} ${P(x, y)}Z`)
const snowNeedle = (L, T, R, yl) => {
  const at = (a, b, y) => n(a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]))
  return path("f", `M${P(...L)}L${P(at(L, T, yl), yl)}L${P(T[0] - 0.1, yl + 0.14)}L${P(T[0] + 0.04, yl - 0.02)}L${P(T[0] + 0.14, yl + 0.12)}L${P(at(R, T, yl + 0.04), yl + 0.04)}L${P(...R)}Z`) + poly("s", [[at(L, T, yl), yl], T, [at(R, T, yl + 0.04), yl + 0.04]], false)
}

export const icons = {
  plain: { title: "plain", concept: "one daisy stands above the short grass: open ground, easy going",
    svg: ground() + comb([0.2, 0.3, 0.24, 0.14, 0, 0, 0.22, 0.3, 0.18, 0.26], -0.72, 0.16, 0.06) + line(0.02, G, 0.02, -0.2) + path("f", `M0.02 0.16Q0.04 -0.04 0.34 -0.08Q0.3 0.14 0.02 0.16Z`) + path("pt", `M0.07 0.12Q0.16 0.02 0.27 -0.04`) + daisy(0.02, -0.44, 0.42, 8) },
  river: { title: "river", concept: "the current runs between two banks, and the far bank's trees are right there",
    svg: ground() + line(-X, -0.2, X, -0.2) + tree(-0.42, -0.2, 0.5, 0.13) + tree(-0.2, -0.2, 0.34, 0.1) + tree(0.4, -0.2, 0.42, 0.12) + sine("s", -0.62, 0.62, 0.0, 0.05, 2, 48) + sine("s", -0.4, 0.4, 0.16, 0.035, 1.5, 32) },
  water: { title: "water", concept: "the sea's own pattern fills the tile, cut to the width of the ground",
    svg: fanC(-0.37, G - 0.36, 0.37) + fanC(0.37, G - 0.36, 0.37) + fanC(0, G, 0.37) + fanC(-0.74, G, 0.37) + fanC(0.74, G, 0.37) + ground() },
  beach: { title: "beach", concept: "a starfish left on the sand where the sea comes up the line",
    svg: (() => { const top = sineP(0.0, 0.8, -0.06, 0.05, 1.25, 32); return path("f", `M-0.06 ${G}C0.0 0.1 0.0 -0.04 ` + top.map(([x, y]) => `${x} ${y}`).join("L") + `V${G}Z`) + poly("ps", sineP(0.1, 0.8, 0.12, 0.04, 1.25, 32), false) + ground() + starfish(-0.44, G - 0.28, 0.28, -82) })() },
  marsh: { title: "marsh", concept: "reeds stand in still water and hang upside down in it",
    svg: ground() + [[-0.4, 0.5, false, -0.07], [-0.16, 0.86, true, -0.03], [0.12, 0.62, false, 0.05], [0.38, 0.76, true, 0.05]].map(([x, h, head, lean]) =>
      path("s", `M${P(x, G)}Q${P(x, G - h * 0.5)} ${P(x + lean, G - h)}`) + (head ? capsule("f", x + lean * 0.9, G - h + 0.05, 0.16, 0.3) : "") + line(x, G + 0.13, x, G + 0.22, "t") + (h > 0.5 ? line(x, G + 0.3, x, G + 0.38, "t") : "")).join("") },
  forest: { title: "forest", concept: "spires in file, dark in front and grey behind, their branches tiered",
    svg: spire("h", -0.28, G - 0.14, 0.86, 0.24) + spire("h", 0.32, G - 0.14, 0.96, 0.26)
      + [[0.02, 1.0, 0.27], [-0.54, 0.66, 0.2], [0.56, 0.58, 0.18]].map(([x, h, w]) => spire("p", x, G + 0.04, h + 0.12, w + 0.09) + spire("f", x, G, h, w)
        + [0.42, 0.68].map(f => { const y = G - h * (1 - f) + 0.04, hw = w * f * 0.62; return poly("pt", [[x - hw, y + 0.07], [x, y], [x + hw, y + 0.07]], false) }).join("")).join("") + ground() },
  mountain: { title: "mountain", concept: "the path switches back and forth up the mass: slow going",
    svg: path("f", `M-0.78 ${G}L-0.12 -0.56Q0 -0.68 0.12 -0.56L0.78 ${G}Z`) + poly("ps", [[0.04, G + 0.02], [-0.36, 0.14], [0.24, -0.02], [-0.18, -0.18], [0.1, -0.32], [-0.04, -0.44]], false) + ground() },
  cliff: { title: "cliff", concept: "grass to the very lip, then the rock drops sheer; from up there you look down on the gull",
    svg: (() => {
      const T = -0.46, face = [[-0.14, T], [-0.06, -0.32], [-0.14, -0.18], [-0.04, -0.02], [-0.12, 0.12], [-0.06, G]]
      const inner = face.map(([x, y]) => [x + 0.14, y]).reverse()
      return path("h", `M0.68 ${T}${face.map(p => "L" + P(...p)).join("")}L0.8 ${G}Z`) + path("f", `M${face.map(p => P(...p)).join("L")}L${inner.map(p => P(...p)).join("L")}Z`) + poly("s", [[0.68, T], ...face], false) + ground(-X, -0.06) +
        [[0.1, 0.2, -0.06], [0.28, 0.26, -0.07], [0.46, 0.16, -0.05], [0.6, 0.12, -0.04]].map(([x, h, l]) => poly("f", [[x - 0.045, T], [x + l, T - h], [x + 0.045, T]])).join("") + gull(-0.7, -0.14, 0.8)
    })() },
  peak: { title: "peak", concept: "the white summit stands clear of the cloud floor",
    svg: (() => { const cd = cloudD(-0.8, 0.8, G - 0.02, 5); return snowNeedle([-0.46, G], [0.02, -0.78], [0.5, G], -0.3) + line(0.02, -0.66, 0.08, -0.4, "t") + path("p", cd + "Z") + path("s", cd) + ground() })() },
}
