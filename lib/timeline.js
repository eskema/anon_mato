// The clock across the top — stacked scales driven by the game (energy =
// minutes; time spent = minutes past 06:00). Scales: YEAR (bars = years
// earned, 1 for now) / MONTH (12) / DAY-of-month (30) / HOUR (24) / MINUTE (60).
//
// Display-only: the clock follows the game; grid.js owns all interaction.
// Collapsed (default): no bars — just the status line under the title.
// Expanded: each scale gets its own label line above a tall bar. The reserved
// return trip is the medium segment on the bars.

const SLEEP = [6, 2] // sleeping hours: first 6 + last 2 → awake 06:00–22:00
const WAKE_HOUR = SLEEP[0]
const BED_HOUR = 24 - SLEEP[1]
const MONTHS = 12
const DAYS_PER_MONTH = 30
const TOP = 28
const PAD_L = 12
const PAD_R = PAD_L // symmetric margins now that the play button sits on the status line
const LABEL_H = 18 // expanded label line height
const LABEL_MARGIN = 4 // gap below a label before its bar
const EXP_BAR_H = 18 // expanded bar height
const EXP_GAP = 8
const ROWS = 5 // year / month / day / hour / minute
const STATUS_H = 28 // room for the status (coords · budget) line under the bars

function buildRows(clock) {
  const used = clock?.used || 0
  const reserved = clock?.reserved || 0
  const spent = used + reserved
  const years = clock?.years || 1
  const day = clock?.day || 1
  const dayIdx = day - 1 // 0-based day of the year
  const totalUsed = WAKE_HOUR * 60 + used
  const totalSpent = WAKE_HOUR * 60 + spent
  return [
    {
      label: `year ${Math.floor(dayIdx / (MONTHS * DAYS_PER_MONTH)) + 1}`,
      steps: years,
      cur: Math.floor(dayIdx / (MONTHS * DAYS_PER_MONTH))
    },
    {
      label: `month ${(Math.floor(dayIdx / DAYS_PER_MONTH) % MONTHS) + 1}`,
      steps: MONTHS,
      cur: Math.floor(dayIdx / DAYS_PER_MONTH) % MONTHS
    },
    { label: `day ${day}`, steps: DAYS_PER_MONTH, cur: dayIdx % DAYS_PER_MONTH },
    {
      label: `hour ${6 + Math.floor(used / 60)}`,
      steps: 24,
      cur: Math.floor(totalUsed / 60),
      com: Math.floor(totalSpent / 60),
      hour: true
    },
    {
      label: `minute ${Math.round(used % 60)}`,
      steps: 60,
      cur: Math.floor(used) % 60,
      com: Math.min(60, Math.ceil(spent)),
      minutes: true
    }
  ]
}

function drawBars(ctx, ink, row, x, y, w, h) {
  const n = row.steps
  const com = row.com ?? row.cur
  const barW = w / n
  const inner = Math.max(1, barW - 2) // fill the slot, leaving a 2px gap between steps
  for (let i = 0; i < n; i++) {
    const bx = x + i * barW + (barW - inner) / 2
    const asleep = row.hour && (i < WAKE_HOUR || i >= BED_HOUR)
    if (asleep) {
      // sleeping hours: very dim fill + a thin outline so the block reads clearly
      ctx.fillStyle = ink
      ctx.globalAlpha = 0.05
      ctx.fillRect(bx, y, inner, h)
      ctx.strokeStyle = ink
      ctx.globalAlpha = 0.3
      ctx.lineWidth = 1
      ctx.strokeRect(bx + 0.5, y + 0.5, Math.max(1, inner - 1), Math.max(1, h - 1))
    } else {
      // past = dim, now = bright, reserved = medium, free = faint
      ctx.fillStyle = ink
      ctx.globalAlpha = i === row.cur ? 0.95 : i < row.cur ? 0.3 : i < com ? 0.55 : 0.1
      ctx.fillRect(bx, y, inner, h)
    }
  }
  ctx.globalAlpha = 1
}

function fmtBudget(free) {
  // remaining budget as "3d 12h 34m until rest" — only the non-zero parts
  free = Math.round(free)
  const suffix = " until rest"
  if (free <= 60) return `${free}m${suffix}`
  const d = Math.floor(free / 1440)
  const h = Math.floor((free % 1440) / 60)
  const m = free % 60
  const parts = []
  if (d) parts.push(`${d}d`)
  if (h) parts.push(`${h}h`)
  if (m) parts.push(`${m}m`)
  return `${parts.join(" ")}${suffix}`
}

function drawAvailable(ctx, ink, x, y, free, font, at, action) {
  // position · budget on one line; a hovered/committed action cost trails after
  // it — lighter while hovering, darker once committed
  ctx.font = font
  ctx.textAlign = "left"
  ctx.textBaseline = "middle"
  const base = `${at ? at + "  ·  " : ""}${fmtBudget(free)}`
  ctx.fillStyle = ink
  ctx.globalAlpha = 0.6
  ctx.fillText(base, x, y)
  if (action?.text) {
    ctx.globalAlpha = action.committed ? 0.95 : 0.3
    ctx.fillText("  " + action.text, x + ctx.measureText(base).width, y)
  }
  ctx.globalAlpha = 1
}

// Right-aligned text buttons at the end of the budget line (go home / rest &
// resume). Records hit-boxes into `out` for the grid to test.
function drawHomeButtons(ctx, ink, L, y, labels, font, out) {
  if (!labels || !labels.length) return
  ctx.font = font
  ctx.textAlign = "right"
  ctx.textBaseline = "middle"
  let rx = L.w - PAD_R
  for (let i = labels.length - 1; i >= 0; i--) {
    const lbl = labels[i]
    const wtxt = ctx.measureText(lbl).width
    ctx.fillStyle = ink
    ctx.globalAlpha = 0.75
    ctx.fillText(lbl, rx, y)
    out.push({ x: rx - wtxt - 4, y: y - 11, w: wtxt + 8, h: 22, action: lbl })
    rx -= wtxt + 18
  }
  ctx.globalAlpha = 1
  ctx.textAlign = "left"
}

export function createTimeline() {
  let homeBoxes = [] // hit-boxes for the budget-line buttons, refreshed each draw

  function draw(ctx, L, ink, clock) {
    homeBoxes.length = 0
    const rows = buildRows(clock)
    const free = Math.round(clock?.free || 0)
    const x = PAD_L
    const w = L.w - PAD_L - PAD_R
    let y = TOP
    const statusFont = clock?.expanded ? "600 16px system-ui, sans-serif" : "600 11px system-ui, sans-serif"
    if (clock?.expanded) {
      ctx.textAlign = "left"
      ctx.textBaseline = "middle"
      ctx.font = "600 16px system-ui, sans-serif"
      for (const row of rows) {
        ctx.fillStyle = ink
        ctx.globalAlpha = 0.7
        ctx.fillText(row.label, x, y + LABEL_H / 2) // label on its own line
        ctx.globalAlpha = 1
        y += LABEL_H + LABEL_MARGIN
        drawBars(ctx, ink, row, x, y, w, EXP_BAR_H)
        y += EXP_BAR_H + EXP_GAP
      }
      drawAvailable(ctx, ink, x, y + EXP_BAR_H / 2, free, statusFont, clock?.at, clock?.action)
      drawHomeButtons(ctx, ink, L, y + EXP_BAR_H / 2, clock?.homeButtons, statusFont, homeBoxes)
    } else {
      // collapsed: no bars at all — just the status line under the title
      drawAvailable(ctx, ink, x, TOP + 4, free, statusFont, clock?.at, clock?.action)
      drawHomeButtons(ctx, ink, L, TOP + 4, clock?.homeButtons, statusFont, homeBoxes)
    }
  }

  // Total height of the clock chrome — the grid reserves this at the top so edge
  // tiles never sit under the clock.
  const height = expanded =>
    expanded
      ? TOP + ROWS * (LABEL_H + LABEL_MARGIN + EXP_BAR_H + EXP_GAP) + EXP_BAR_H + STATUS_H
      : TOP + STATUS_H

  // Where grid.js places the play/stop button: on the status line, top-right.
  const playButton = L => ({ x: L.w - 20, y: 14, r: 7 })

  return { draw, playButton, homeButtons: () => homeBoxes, height }
}
