// The icon system — thin line-art glyphs for the radial menu (and the style
// guide). Each painter draws a symbol centred at (x,y) inside a box of radius
// r, using the caller's strokeStyle/fillStyle so it inherits the ink colour.
// Keep them simple: single-weight strokes, no fills except tiny accents —
// they read at badge size and match the game's hairline aesthetic.
//
// Naming is by MEANING, so the same glyph can serve several actions:
// verbs (rest, enter, home…), skills (scout, travel…), and structure
// (folder, back, dots). Add new symbols here; the menu references them by key.

const TAU = Math.PI * 2

// stroke setup: line width scales with the icon, round joins/caps
function pen(ctx, r, w = 0.14) {
  ctx.lineWidth = Math.max(1, r * w)
  ctx.lineJoin = "round"
  ctx.lineCap = "round"
}
const poly = (ctx, pts, close = true) => {
  ctx.beginPath()
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  if (close) ctx.closePath()
}
const dot = (ctx, x, y, rr) => {
  ctx.beginPath()
  ctx.arc(x, y, rr, 0, TAU)
  ctx.fill()
}

export const ICONS = {
  // ── the player + structure ──────────────────────────
  cube(ctx, x, y, r) {
    pen(ctx, r)
    const pts = []
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i - 90)
      pts.push([x + r * 0.9 * Math.cos(a), y + r * 0.9 * Math.sin(a)])
    }
    poly(ctx, pts)
    ctx.stroke()
    for (const i of [0, 2, 4]) {
      ctx.beginPath()
      ctx.moveTo(pts[i][0], pts[i][1])
      ctx.lineTo(x, y)
      ctx.stroke()
    }
  },
  folder(ctx, x, y, r) {
    // a cluster of dots — "more inside", fans open when chosen
    for (let i = 0; i < 3; i++) {
      const a = (Math.PI / 180) * (-90 + i * 120)
      dot(ctx, x + r * 0.42 * Math.cos(a), y + r * 0.42 * Math.sin(a), r * 0.16)
    }
  },
  back(ctx, x, y, r) {
    pen(ctx, r)
    poly(ctx, [[x + r * 0.4, y - r * 0.5], [x - r * 0.45, y], [x + r * 0.4, y + r * 0.5]], false)
    ctx.stroke()
  },
  close(ctx, x, y, r) {
    pen(ctx, r)
    ctx.beginPath()
    ctx.moveTo(x - r * 0.45, y - r * 0.45)
    ctx.lineTo(x + r * 0.45, y + r * 0.45)
    ctx.moveTo(x + r * 0.45, y - r * 0.45)
    ctx.lineTo(x - r * 0.45, y + r * 0.45)
    ctx.stroke()
  },

  // ── verbs ───────────────────────────────────────────
  rest(ctx, x, y, r) {
    // crescent moon
    pen(ctx, r)
    ctx.beginPath()
    ctx.arc(x + r * 0.15, y, r * 0.6, Math.PI * 0.35, Math.PI * 1.65)
    ctx.stroke()
  },
  home(ctx, x, y, r) {
    pen(ctx, r)
    poly(ctx, [[x - r * 0.55, y + r * 0.55], [x - r * 0.55, y - r * 0.05], [x, y - r * 0.6], [x + r * 0.55, y - r * 0.05], [x + r * 0.55, y + r * 0.55]])
    ctx.stroke()
  },
  camp(ctx, x, y, r) {
    // rest-and-resume: a tent
    pen(ctx, r)
    poly(ctx, [[x - r * 0.6, y + r * 0.5], [x, y - r * 0.6], [x + r * 0.6, y + r * 0.5]])
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x, y - r * 0.6)
    ctx.lineTo(x, y + r * 0.5)
    ctx.stroke()
  },
  enter(ctx, x, y, r) {
    // arrow down into a slot
    pen(ctx, r)
    ctx.beginPath()
    ctx.moveTo(x, y - r * 0.6)
    ctx.lineTo(x, y + r * 0.2)
    ctx.stroke()
    poly(ctx, [[x - r * 0.28, y - r * 0.08], [x, y + r * 0.25], [x + r * 0.28, y - r * 0.08]], false)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x - r * 0.5, y + r * 0.45)
    ctx.lineTo(x + r * 0.5, y + r * 0.45)
    ctx.stroke()
  },
  reset(ctx, x, y, r) {
    // circular arrow
    pen(ctx, r)
    ctx.beginPath()
    ctx.arc(x, y, r * 0.55, Math.PI * 0.6, Math.PI * 2.2)
    ctx.stroke()
    const ex = x + r * 0.55 * Math.cos(Math.PI * 0.6)
    const ey = y + r * 0.55 * Math.sin(Math.PI * 0.6)
    poly(ctx, [[ex - r * 0.05, ey - r * 0.3], [ex, ey], [ex - r * 0.32, ey + r * 0.02]], false)
    ctx.stroke()
  },
  reveal(ctx, x, y, r) {
    // dev "clear board": a dashed hex
    pen(ctx, r, 0.12)
    ctx.setLineDash([r * 0.3, r * 0.22])
    const pts = []
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i - 90)
      pts.push([x + r * 0.7 * Math.cos(a), y + r * 0.7 * Math.sin(a)])
    }
    poly(ctx, pts)
    ctx.stroke()
    ctx.setLineDash([])
  },
  talk(ctx, x, y, r) {
    // speech bubble
    pen(ctx, r)
    ctx.beginPath()
    ctx.moveTo(x - r * 0.55, y + r * 0.05)
    ctx.arc(x, y - r * 0.1, r * 0.55, Math.PI * 0.75, Math.PI * 2.25)
    ctx.lineTo(x - r * 0.15, y + r * 0.3)
    ctx.lineTo(x - r * 0.15, y + r * 0.55)
    ctx.lineTo(x - r * 0.4, y + r * 0.28)
    ctx.stroke()
  },
  stats(ctx, x, y, r) {
    // three bars
    pen(ctx, r, 0.2)
    ctx.beginPath()
    ctx.moveTo(x - r * 0.4, y + r * 0.45)
    ctx.lineTo(x - r * 0.4, y + r * 0.05)
    ctx.moveTo(x, y + r * 0.45)
    ctx.lineTo(x, y - r * 0.5)
    ctx.moveTo(x + r * 0.4, y + r * 0.45)
    ctx.lineTo(x + r * 0.4, y - r * 0.15)
    ctx.stroke()
  },

  // ── the eight skills (each is also its teachers' terrain) ───────
  scout(ctx, x, y, r) {
    // eye
    pen(ctx, r)
    ctx.beginPath()
    ctx.moveTo(x - r * 0.6, y)
    ctx.quadraticCurveTo(x, y - r * 0.55, x + r * 0.6, y)
    ctx.quadraticCurveTo(x, y + r * 0.55, x - r * 0.6, y)
    ctx.stroke()
    dot(ctx, x, y, r * 0.16)
  },
  travel(ctx, x, y, r) {
    // a boot print — two staggered marks
    pen(ctx, r)
    for (const [dx, dy] of [[-r * 0.28, -r * 0.2], [r * 0.28, r * 0.2]]) {
      ctx.beginPath()
      ctx.ellipse(x + dx, y + dy, r * 0.18, r * 0.3, 0, 0, TAU)
      ctx.stroke()
    }
  },
  gather(ctx, x, y, r) {
    // a leaf
    pen(ctx, r)
    ctx.beginPath()
    ctx.moveTo(x - r * 0.45, y + r * 0.45)
    ctx.quadraticCurveTo(x - r * 0.5, y - r * 0.5, x + r * 0.45, y - r * 0.45)
    ctx.quadraticCurveTo(x - r * 0.5, y - r * 0.5, x - r * 0.45, y + r * 0.45)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x - r * 0.45, y + r * 0.45)
    ctx.lineTo(x + r * 0.2, y - r * 0.2)
    ctx.stroke()
  },
  build(ctx, x, y, r) {
    // hammer
    pen(ctx, r)
    ctx.beginPath()
    ctx.moveTo(x + r * 0.35, y - r * 0.55)
    ctx.lineTo(x - r * 0.35, y + r * 0.55)
    ctx.stroke()
    poly(ctx, [[x + r * 0.05, y - r * 0.6], [x + r * 0.6, y - r * 0.25], [x + r * 0.4, y - r * 0.02], [x - r * 0.15, y - r * 0.35]])
    ctx.stroke()
  },
  craft(ctx, x, y, r) {
    // anvil
    pen(ctx, r)
    poly(ctx, [[x - r * 0.5, y - r * 0.15], [x + r * 0.55, y - r * 0.15], [x + r * 0.3, y + r * 0.1], [x + r * 0.2, y + r * 0.1], [x + r * 0.2, y + r * 0.45], [x - r * 0.2, y + r * 0.45], [x - r * 0.2, y + r * 0.1], [x - r * 0.35, y - r * 0.15]])
    ctx.stroke()
  },
  trade(ctx, x, y, r) {
    // a coin with a mark
    pen(ctx, r)
    ctx.beginPath()
    ctx.arc(x, y, r * 0.55, 0, TAU)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x, y - r * 0.3)
    ctx.lineTo(x, y + r * 0.3)
    ctx.moveTo(x - r * 0.18, y - r * 0.12)
    ctx.lineTo(x + r * 0.18, y - r * 0.12)
    ctx.stroke()
  },
  tend(ctx, x, y, r) {
    // a sprout
    pen(ctx, r)
    ctx.beginPath()
    ctx.moveTo(x, y + r * 0.5)
    ctx.lineTo(x, y - r * 0.15)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(x - r * 0.22, y - r * 0.15, r * 0.24, Math.PI * 1.2, Math.PI * 2.1)
    ctx.arc(x + r * 0.22, y - r * 0.15, r * 0.24, Math.PI + Math.PI * 0.9, Math.PI + Math.PI * 1.8, true)
    ctx.stroke()
  },
  lore(ctx, x, y, r) {
    // an open book
    pen(ctx, r)
    ctx.beginPath()
    ctx.moveTo(x, y - r * 0.4)
    ctx.quadraticCurveTo(x - r * 0.55, y - r * 0.55, x - r * 0.55, y - r * 0.3)
    ctx.lineTo(x - r * 0.55, y + r * 0.4)
    ctx.quadraticCurveTo(x - r * 0.5, y + r * 0.25, x, y + r * 0.4)
    ctx.quadraticCurveTo(x + r * 0.5, y + r * 0.25, x + r * 0.55, y + r * 0.4)
    ctx.lineTo(x + r * 0.55, y - r * 0.3)
    ctx.quadraticCurveTo(x + r * 0.55, y - r * 0.55, x, y - r * 0.4)
    ctx.moveTo(x, y - r * 0.4)
    ctx.lineTo(x, y + r * 0.4)
    ctx.stroke()
  }
}

// The skill → icon map (also the skill → home-biome affinity, by meaning).
export const SKILL_ICON = {
  scout: "scout",
  travel: "travel",
  gather: "gather",
  build: "build",
  craft: "craft",
  trade: "trade",
  tend: "tend",
  lore: "lore"
}

export function drawIcon(ctx, name, x, y, r, color, alpha = 1) {
  const fn = ICONS[name]
  if (!fn) return
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.globalAlpha = alpha
  fn(ctx, x, y, r)
  ctx.restore()
}
