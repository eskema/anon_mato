// Shared canvas helpers used across screens.

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

// Axis-aligned box hit test.
export function hitBox(box, p) {
  return box && p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h
}
