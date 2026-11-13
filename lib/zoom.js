// ZOOM ABOUT A POINT — shared by the world playground and the scout map. A
// camera is { x, y, s }: the world point at the view's centre `c`, and pixels
// per world unit. The wheel scales s and keeps the world point under the
// pointer `p` where it is; s stays within [min, max].
export const ZOOM_RATE = 1.0015 // per unit of wheel delta

export function zoomAt(cam, p, c, dy, min, max) {
  const wx = cam.x + (p.x - c.x) / cam.s
  const wy = cam.y + (p.y - c.y) / cam.s
  const s = Math.max(min, Math.min(max, cam.s * Math.pow(ZOOM_RATE, -dy)))
  return { x: wx - (p.x - c.x) / s, y: wy - (p.y - c.y) / s, s }
}
