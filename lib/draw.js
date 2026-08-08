// Shared canvas helpers used across screens.

// Asymmetric quadratic ease — a TRIANGULAR velocity profile: accelerate to a
// peak at time `s` (a fraction 0→1 of the timeline), then decelerate to rest.
// s < 0.5 is a SHORT ease-in + LONG ease-out (a quick departure that glides to a
// soft stop); s > 0.5 is the reverse. One continuous swoosh, no constant middle
// (so a multi-tile walk doesn't beat out each step). Returns distance covered
// (0→1) at normalized time u. The walking cube and the camera use DIFFERENT s so
// they lead-and-follow rather than move as one.
export function easeSplit(u, s) {
  if (u <= 0) return 0
  if (u >= 1) return 1
  s = Math.min(0.9, Math.max(0.1, s)) // keep the two phases non-degenerate
  if (u < s) return (u * u) / s // accelerate (peak velocity = 2 at u = s)
  const w = 1 - u
  return 1 - (w * w) / (1 - s) // decelerate to a soft landing
}

// Read a launcher theme token (falls back when running standalone).
export function theme(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

// Filled disc.
export function fillDot(ctx, x, y, r, fill) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = fill
  ctx.fill()
}

// Outlined ring (filled with the background so anything beneath is hidden).
export function ringDot(ctx, x, y, r, fill, stroke, lineWidth = 2) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.strokeStyle = stroke
  ctx.lineWidth = lineWidth
  ctx.stroke()
}

// Open (two-stroke) arrowhead at (toX,toY), pointing along from→to.
export function arrowTip(ctx, fromX, fromY, toX, toY, stroke, len = 20, halfW = 13, lineWidth = 2) {
  const dx = toX - fromX
  const dy = toY - fromY
  const d = Math.hypot(dx, dy) || 1
  const ux = dx / d
  const uy = dy / d
  const baseX = toX - ux * len
  const baseY = toY - uy * len
  const px = -uy // perpendicular
  const py = ux
  ctx.beginPath()
  ctx.moveTo(baseX + px * halfW, baseY + py * halfW)
  ctx.lineTo(toX, toY)
  ctx.lineTo(baseX - px * halfW, baseY - py * halfW)
  ctx.strokeStyle = stroke
  ctx.lineWidth = lineWidth
  ctx.lineJoin = "round"
  ctx.lineCap = "round"
  ctx.setLineDash([]) // arrowheads are always solid, whatever the line under them does
  ctx.stroke()
}

// Axis-aligned box hit test. A missing box or a pointer that hasn't landed yet
// (before the first move, or a click with no move before it) is simply a miss.
export function hitBox(box, p) {
  return !!box && !!p && p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h
}
