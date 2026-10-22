// fv.mjs — tiny helpers for free vector icons (unit frame: x right, y DOWN,
// the icon lives inside a circle of radius ~0.85 centred at 0,0).
// An icon is a string of SVG elements using ONLY these classes:
//   s  — the one pen: stroke 0.1, round caps & joins, no fill
//   f  — solid ink
//   h  — half-tone (a fine hatch of ink)
//   p  — paper fill (knocks a shape out of ink)
//   ps — the pen in paper (cuts a line through ink)
// Never set stroke-width, colours or opacity yourself.
export const PEN = 0.1
export const n = v => +v.toFixed(4)
export const rad = d => (d * Math.PI) / 180
// point at angle a (degrees, 0 = right, 90 = DOWN, -90 = up) on a circle
export const polar = (cx, cy, r, a) => [n(cx + r * Math.cos(rad(a))), n(cy + r * Math.sin(rad(a)))]
export const pts = list => list.map(p => p.join(",")).join(" ")
// open arc path from angle a0 to a1 (degrees, clockwise when a1 > a0)
export function arcD(cx, cy, r, a0, a1) {
  const [x0, y0] = polar(cx, cy, r, a0)
  const [x1, y1] = polar(cx, cy, r, a1)
  const large = Math.abs(a1 - a0) % 360 > 180 ? 1 : 0
  const sweep = a1 > a0 ? 1 : 0
  return `M${x0} ${y0}A${n(r)} ${n(r)} 0 ${large} ${sweep} ${x1} ${y1}`
}
export const arc = (cls, cx, cy, r, a0, a1) => `<path class="${cls}" d="${arcD(cx, cy, r, a0, a1)}"/>`
export const circle = (cls, cx, cy, r) => `<circle class="${cls}" cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"/>`
export const line = (x1, y1, x2, y2, cls = "s") => `<line class="${cls}" x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}"/>`
export const poly = (cls, list, closed = true) => `<${closed ? "polygon" : "polyline"} class="${cls}" points="${pts(list)}"/>`
export const path = (cls, d) => `<path class="${cls}" d="${d}"/>`
export const ngonPts = (cx, cy, r, k = 6, rotDeg = -90) => [...Array(k)].map((_, i) => polar(cx, cy, r, rotDeg + (360 / k) * i))
