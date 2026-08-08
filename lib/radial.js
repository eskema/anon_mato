// The stats card — 8 skills as labelled bars (level fill + a nature-cap
// tick). The radial MENU itself lives in render.js now, drawn on the real
// hex grid; this file is just the panel it can raise.

import { panel, gameFont } from "./render.js"

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// the info block or the skill-bars panel, by `kind` (the skill REFERENCE —
// flavour, favoured land, effect — rides the ring glyph's hover label now)
export function drawStatsPanel(ctx, L, opts) {
  return opts.kind === "info" ? drawInfoPanel(ctx, L, opts) : drawSkillPanel(ctx, L, opts)
}

// the player card — the tile you stand on / the figure you face, while the
// menu is up. The same boxes as everything else, stacked down from the
// top-right corner: the place on its own row, then a row per fact, each key
// beside its value in its own box.
// Its borders ride the THEME ink, not the night one: the box is painted in the
// theme's own paper and text (labelBox), so a night-flipped ink would go pale
// on pale paper and the borders would simply vanish after dark — the title bar
// keeps the theme ink for exactly this reason.
// (The TITLE is not here any more, 2026-08-05: the place names itself in the
// bottom-right corner now, and a name in two corners at once is one name too
// many. What's left is what the corner doesn't say — the kind of place it is,
// and its facts.)
function drawInfoPanel(ctx, L, { ink, themeInk, subtitle, rows }) {
  const lines = subtitle ? [{ cells: [{ text: subtitle, alpha: 0.6 }] }] : []
  for (const [k, val] of rows) lines.push({ cells: [{ text: k, alpha: 0.6, small: true }, { text: String(val), small: true }] })
  panel(ctx, lines, { right: L.w, top: 0 }, themeInk || ink)
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
  ctx.font = gameFont(16)
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
    ctx.font = gameFont(16)
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
