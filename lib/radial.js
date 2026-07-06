// The radial menu — a folder tree fanned around the player, drawn as icon
// badges over a soft background disc. Pure presentation: the controller
// (grid.js) owns the tree spec and the open/focus state; this module turns
// that into geometry (hit list) and pixels. No sim, no input here.
//
// Model. A NODE is { id, icon, label, run?, children?, badge?, disabled? }.
// The spec has two groups: `self` (things you do) and `them` (things with the
// figure you face). With no `them`, `self` fans the full circle; with a
// `them` group the ring SPLITS — self on the arc away from the figure, them
// on the arc toward it. A folder (has `children`) fans its children onto the
// next ring out, centred on the folder's own angle, when it is the open node.

import { drawIcon } from "./icons.js"

const TAU = Math.PI * 2

// ── geometry ─────────────────────────────────────────
// Ring radii + badge size in tile circumradius units; the disc reaches past
// the outer ring so the menu reads as its own surface up to the tiles' reach.
export function layoutRadial({ cx, cy, size, spec, openId, themAngle }) {
  const R1 = size * 1.9
  const R2 = size * 3.25
  const rb = size * 0.62
  const nodes = []
  const place = (node, ring, ang) => {
    const R = ring === 1 ? R1 : R2
    nodes.push({ id: node.id, node, ring, ang, x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang), r: rb })
  }
  // fan `list` across an arc of `span` centred on `mid` (screen radians)
  const fan = (list, mid, span, ring) => {
    if (!list.length) return
    const step = list.length > 1 ? span / (list.length - 1) : 0
    const start = mid - (list.length > 1 ? span / 2 : 0)
    list.forEach((node, i) => place(node, ring, start + i * step))
  }

  const self = spec.self || []
  const them = spec.them || []
  if (them.length) {
    // split: them toward the figure, self opposite. Half-circle arcs, padded.
    const away = themAngle + Math.PI
    fan(self, away, Math.PI * 0.72, 1)
    fan(them, themAngle, Math.PI * 0.72, 1)
  } else {
    // full circle, starting at the top, clockwise
    fan(self, -Math.PI / 2, self.length > 1 ? TAU - TAU / self.length : 0, 1)
  }

  // the open folder fans its children on ring 2 around its own angle
  if (openId != null) {
    const parent = nodes.find(n => n.id === openId)
    if (parent && parent.node.children?.length) {
      const kids = parent.node.children
      const span = Math.min(Math.PI * 1.1, kids.length * 0.55)
      fan(kids, parent.ang, span, 2)
    }
  }

  const reach = R2 + rb * 1.5
  return { disc: { x: cx, y: cy, r: reach }, badge: rb, nodes, openId }
}

// ── drawing ──────────────────────────────────────────
export function drawRadial(ctx, L, layout, { ink, surface, focusId, cx, cy }) {
  const { disc, nodes, openId } = layout
  ctx.save()

  // the background disc — a soft wash tying the menu to the board
  ctx.globalAlpha = 0.5
  ctx.fillStyle = surface
  ctx.beginPath()
  ctx.arc(disc.x, disc.y, disc.r, 0, TAU)
  ctx.fill()
  ctx.globalAlpha = 0.12
  ctx.strokeStyle = ink
  ctx.lineWidth = 1
  ctx.stroke()

  // connective spokes: hub → ring-1 badge; open folder → its children
  ctx.globalAlpha = 0.18
  ctx.strokeStyle = ink
  ctx.lineWidth = 1
  for (const n of nodes) {
    const from = n.ring === 2 ? nodes.find(p => p.id === openId) : { x: cx, y: cy }
    if (!from) continue
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(n.x, n.y)
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  // badges
  for (const n of nodes) {
    const open = n.id === openId
    const focus = n.id === focusId
    const on = !n.node.disabled
    ctx.beginPath()
    ctx.arc(n.x, n.y, n.r, 0, TAU)
    ctx.fillStyle = open ? ink : surface
    ctx.globalAlpha = on ? 0.95 : 0.6
    ctx.fill()
    ctx.strokeStyle = ink
    ctx.globalAlpha = focus ? 1 : on ? 0.55 : 0.25
    ctx.lineWidth = focus ? 2 : 1.25
    ctx.stroke()
    drawIcon(ctx, n.node.icon, n.x, n.y, n.r * 0.62, open ? surface : ink, on ? 0.95 : 0.4)
    // a small badge number (e.g. a skill level, "3→4" reduced to the target)
    if (n.node.badge != null) {
      ctx.font = `600 ${Math.round(n.r * 0.55)}px system-ui, sans-serif`
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillStyle = open ? surface : ink
      ctx.globalAlpha = 0.9
      const bx = n.x + n.r * 0.72
      const by = n.y - n.r * 0.72
      ctx.beginPath()
      ctx.arc(bx, by, n.r * 0.42, 0, TAU)
      ctx.fillStyle = ink
      ctx.fill()
      ctx.fillStyle = surface
      ctx.fillText(String(n.node.badge), bx, by)
    }
  }

  // the focused node's label — a fitted pill just outside its badge, so text
  // never crowds the icon or overflows anything
  const f = nodes.find(n => n.id === focusId)
  if (f && f.node.label) {
    ctx.font = "600 16px system-ui, sans-serif"
    const w = ctx.measureText(f.node.label).width
    const pad = 10
    const pw = w + pad * 2
    const ph = 26
    // place outward from the hub, clamped to the frame
    let px = f.x + Math.cos(f.ang) * (f.r + pw / 2 + 6)
    let py = f.y + Math.sin(f.ang) * (f.r + ph / 2 + 6)
    px = Math.max(pw / 2 + 4, Math.min(L.w - pw / 2 - 4, px))
    py = Math.max(ph / 2 + 4, Math.min(L.h - ph / 2 - 4, py))
    ctx.globalAlpha = 0.95
    ctx.fillStyle = ink
    roundRect(ctx, px - pw / 2, py - ph / 2, pw, ph, 6)
    ctx.fill()
    ctx.fillStyle = surface
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(f.node.label, px, py)
  }

  ctx.restore()
}

// hit-test: the badge (circle) under a point, or null
export function hitRadial(layout, p) {
  for (const n of layout.nodes) if (Math.hypot(p.x - n.x, p.y - n.y) <= n.r) return n
  return null
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// ── the stats panel — 8 skills as labelled bars, drawn as a card ────
export function drawStatsPanel(ctx, L, { ink, surface, title, subtitle, stats, effective, x, y }) {
  const names = Object.keys(stats)
  const pad = 14
  const rowH = 22
  const w = 232
  const h = pad * 2 + 26 + names.length * rowH
  const px = x != null ? x : 16 // top-left, clear of the logs panel (top-right)
  const py = y != null ? y : 40
  ctx.save()
  ctx.globalAlpha = 0.96
  ctx.fillStyle = surface
  roundRect(ctx, px, py, w, h, 10)
  ctx.fill()
  ctx.globalAlpha = 0.15
  ctx.strokeStyle = ink
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.textBaseline = "middle"
  ctx.fillStyle = ink
  ctx.textAlign = "left"
  ctx.font = "600 16px system-ui, sans-serif"
  ctx.fillText(title, px + pad, py + pad + 6)
  if (subtitle) {
    ctx.globalAlpha = 0.5
    ctx.textAlign = "right"
    ctx.fillText(subtitle, px + w - pad, py + pad + 6)
    ctx.globalAlpha = 1
  }
  let ry = py + pad + 30
  ctx.textAlign = "left"
  for (const n of names) {
    const cap = stats[n] // the ceiling (nature)
    const lvl = effective ? effective[n] : cap // current level
    ctx.font = "600 16px system-ui, sans-serif"
    ctx.fillStyle = ink
    ctx.globalAlpha = 0.9
    ctx.fillText(n, px + pad, ry + rowH / 2 - 2)
    const bx = px + pad + 86
    const bw = w - pad * 2 - 86 - 22
    ctx.globalAlpha = 0.12
    roundRect(ctx, bx, ry + 4, bw, 8, 4)
    ctx.fill()
    ctx.globalAlpha = 0.85
    if (lvl > 0) {
      roundRect(ctx, bx, ry + 4, (bw * lvl) / 15, 8, 4)
      ctx.fill()
    }
    // cap tick when it differs from the level
    if (cap > lvl) {
      ctx.globalAlpha = 0.4
      ctx.fillRect(bx + (bw * cap) / 15 - 1, ry + 1, 2, 14)
    }
    ctx.globalAlpha = 0.9
    ctx.textAlign = "right"
    ctx.fillText(String(lvl), px + w - pad, ry + rowH / 2 - 2)
    ctx.textAlign = "left"
    ry += rowH
  }
  ctx.restore()
  return { x: px, y: py, w, h }
}
