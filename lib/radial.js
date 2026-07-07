// The stats card — 8 skills as labelled bars (level fill + a nature-cap
// tick). The radial MENU itself lives in render.js now, drawn on the real
// hex grid; this file is just the panel it can raise.

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// the top-left panel: skill bars OR plain key/value rows, by `kind`
export function drawStatsPanel(ctx, L, opts) {
  return opts.kind === "info" ? drawInfoPanel(ctx, L, opts) : drawSkillPanel(ctx, L, opts)
}

function panelFrame(ctx, L, ink, surface, title, subtitle, w, h, x, y) {
  const pad = 14
  ctx.globalAlpha = 0.96
  ctx.fillStyle = surface
  roundRect(ctx, x, y, w, h, 10)
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
  ctx.fillText(title, x + pad, y + pad + 6)
  if (subtitle) {
    ctx.globalAlpha = 0.5
    ctx.textAlign = "right"
    ctx.fillText(subtitle, x + w - pad, y + pad + 6)
    ctx.globalAlpha = 1
  }
}

function drawInfoPanel(ctx, L, { ink, surface, title, subtitle, rows, x, y }) {
  const pad = 14
  const rowH = 24
  const w = 232
  const h = pad * 2 + 26 + rows.length * rowH
  const px = x != null ? x : 16
  const py = y != null ? y : 40
  ctx.save()
  panelFrame(ctx, L, ink, surface, title, subtitle, w, h, px, py)
  let ry = py + pad + 30
  for (const [k, val] of rows) {
    ctx.font = "600 16px system-ui, sans-serif"
    ctx.fillStyle = ink
    ctx.globalAlpha = 0.55
    ctx.textAlign = "left"
    ctx.fillText(k, px + pad, ry + rowH / 2 - 2)
    ctx.globalAlpha = 0.95
    ctx.textAlign = "right"
    ctx.fillText(String(val), px + w - pad, ry + rowH / 2 - 2)
    ry += rowH
  }
  ctx.restore()
  return { x: px, y: py, w, h }
}

function drawSkillPanel(ctx, L, { ink, surface, title, subtitle, stats, effective, x, y }) {
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
