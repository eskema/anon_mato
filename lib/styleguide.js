// Style-guide page logic (styles.html) — a plain-DOM reference of the app's styles.
// Icons are drawn onto small canvases by the SAME functions the game uses (imported
// from render.js), so the guide can never drift from the real rendering.

import { theme, arrowTip } from "./draw.js"
import { drawCube, drawArrowUp, drawArrowStraight, hexCorners, drawSkillWheel } from "./render.js"
import { ICONS as MENU_ICONS, drawIcon as drawMenuIcon } from "./icons.js"
import { initIconMaker } from "./iconmaker.js"
import { drawDial, hhmm, moonPhaseName, INTRADAY_AXIS } from "./clock.js"

const SNAP = 8 // playground grid pitch
const SIZES = [16, 24, 32, 48, 64]
const ICONS = ["cube", "floor", "up", "slide", "tip", "play", "stop", "hex-pointy", "hex-flat", "ring", "dot", "wall"]

const ink = () => theme("--text", "#eee")
const surface = () => theme("--surface", "#111")

// Draw any of the game's icons centred in a box of side s.
function drawIcon(ctx, kind, x, y, s) {
  ctx.strokeStyle = ink()
  ctx.fillStyle = ink()
  ctx.lineWidth = 2
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  if (kind === "cube") drawCube(ctx, x, y, s, ink(), surface(), -30)
  else if (kind === "floor") drawCube(ctx, x, y, s, ink(), surface(), -30, true) // the cube, inverted
  else if (kind === "up") drawArrowUp(ctx, { x, y, r: s * 0.5 })
  else if (kind === "slide") drawArrowStraight(ctx, { x, y, r: s * 0.5 }, 1, 0)
  else if (kind === "tip") arrowTip(ctx, x - s * 0.5, y, x + s * 0.3, y, ink(), s * 0.5, s * 0.3, 2)
  else if (kind === "play") {
    ctx.beginPath()
    ctx.moveTo(x - s * 0.25, y - s * 0.35)
    ctx.lineTo(x - s * 0.25, y + s * 0.35)
    ctx.lineTo(x + s * 0.35, y)
    ctx.closePath()
    ctx.fill()
  } else if (kind === "stop") ctx.fillRect(x - s * 0.25, y - s * 0.25, s * 0.5, s * 0.5)
  else if (kind === "hex-pointy") hexPath(ctx, x, y, s * 0.5, -30)
  else if (kind === "hex-flat") hexPath(ctx, x, y, s * 0.5, 0)
  else if (kind === "ring") {
    ctx.globalAlpha = 0.7
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(x, y, s * 0.25, 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = 1
  } else if (kind === "dot") {
    ctx.globalAlpha = 0.25
    ctx.beginPath()
    ctx.arc(x, y, Math.max(2, s * 0.08), 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  } else if (kind === "wall") {
    ctx.globalAlpha = 0.7
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(x - s * 0.5, y)
    ctx.lineTo(x + s * 0.5, y)
    ctx.stroke()
    ctx.globalAlpha = 1
  }
}

function hexPath(ctx, x, y, r, startDeg) {
  const cs = hexCorners(x, y, r, startDeg)
  ctx.globalAlpha = 0.7
  ctx.lineWidth = 1.5
  ctx.beginPath()
  cs.forEach((c, k) => (k ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)))
  ctx.closePath()
  ctx.stroke()
  ctx.globalAlpha = 1
}

// A crisp (dpr-aware) canvas of CSS size box×box with the icon centred in it.
const iconCanvases = [] // re-rendered on theme change
function iconCanvas(kind, size, box = size + 8) {
  const c = document.createElement("canvas")
  const dpr = window.devicePixelRatio || 1
  c.width = Math.round(box * dpr)
  c.height = Math.round(box * dpr)
  c.style.width = `${box}px`
  c.style.height = `${box}px`
  const render = () => {
    const ctx = c.getContext("2d")
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, box, box)
    drawIcon(ctx, kind, box / 2, box / 2, size)
  }
  render()
  iconCanvases.push(render)
  return c
}

// ── sections ─────────────────────────────────────────
// The canonical 6-step ink ladder — every canvas alpha in the app is one of these.
const alphas = [
  [0.05, "faintest — tile fill, sleep"],
  [0.12, "soft — mesh, trail fill, free bars"],
  [0.25, "quiet — dots, dim, past"],
  [0.45, "mid — paths, reserved"],
  [0.7, "strong — walls, labels"],
  [0.9, "primary"]
]
document.getElementById("alphas").append(
  ...alphas.map(([a, use]) => {
    const cell = document.createElement("div")
    cell.className = "cell"
    const sw = document.createElement("div")
    sw.className = "swatch"
    sw.style.opacity = a
    const lbl = document.createElement("span")
    lbl.textContent = `${a} ${use}`
    cell.append(sw, lbl)
    return cell
  })
)

const lines = [
  ["1", "1px"],
  ["1.5", "1.5px"],
  ["2", "2px"],
  ["3", "3px"],
  ["hover [5,5]", null],
  ["undisc. [5,4]", "undisc"]
]
document.getElementById("lines").append(
  ...lines.map(([name, h]) => {
    const cell = document.createElement("div")
    cell.className = "cell"
    const stroke = document.createElement("div")
    if (h === null || h === "undisc") {
      stroke.className = h ? "dash undisc" : "dash"
    } else {
      stroke.className = "stroke"
      stroke.style.height = h
    }
    const lbl = document.createElement("span")
    lbl.textContent = name
    cell.append(stroke, lbl)
    return cell
  })
)

const icons = document.getElementById("icons")
icons.append(document.createElement("span"))
for (const s of SIZES) {
  const head = document.createElement("div")
  head.className = "head"
  head.style.textAlign = "center"
  head.textContent = `${s}px`
  icons.append(head)
}
for (const kind of ICONS) {
  const name = document.createElement("div")
  name.className = "name"
  name.textContent = kind
  icons.append(name)
  for (const s of SIZES) icons.append(iconCanvas(kind, s, 72))
}

// menu-icon gallery: every glyph in lib/icons.js, drawn the way the menu does
const menuEl = document.getElementById("menuicons")
if (menuEl) {
  const MSIZES = [24, 32, 48]
  menuEl.style.gridTemplateColumns = `120px repeat(${MSIZES.length}, 72px)`
  menuEl.append(document.createElement("span"))
  for (const s of MSIZES) {
    const head = document.createElement("div")
    head.className = "head"
    head.style.textAlign = "center"
    head.textContent = `${s}px`
    menuEl.append(head)
  }
  for (const name of Object.keys(MENU_ICONS)) {
    const label = document.createElement("div")
    label.className = "name"
    label.textContent = name
    menuEl.append(label)
    for (const s of MSIZES) {
      const cv = document.createElement("canvas")
      const box = 72
      const dpr = window.devicePixelRatio || 1
      cv.width = box * dpr
      cv.height = box * dpr
      cv.style.width = cv.style.height = box + "px"
      const ctx = cv.getContext("2d")
      // register a theme-aware redraw (like iconCanvas) — the page flips to
      // its saved theme AFTER this runs, so a draw-once icon would keep the
      // wrong (dark-default) ink and vanish on the light background
      const render = () => {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, box, box)
        drawMenuIcon(ctx, name, box / 2, box / 2, s / 2, theme("--text", "#1b1b1b"))
      }
      render()
      iconCanvases.push(render)
      menuEl.append(cv)
    }
  }
}

// ── playground ───────────────────────────────────────
const pg = document.getElementById("pg")
const rulerV = pg.querySelector(".ruler.v")
const rulerH = pg.querySelector(".ruler.h")
const coords = pg.querySelector(".coords")
const palette = document.getElementById("palette")
const sizeout = document.getElementById("sizeout")
let selected = "cube"
let placeSize = 32
let ghost = null

for (const kind of ICONS) {
  const b = document.createElement("button")
  b.title = kind
  b.append(iconCanvas(kind, 16, 24))
  if (kind === selected) b.classList.add("sel")
  b.addEventListener("click", () => {
    palette.querySelectorAll("button").forEach(x => x.classList.remove("sel"))
    b.classList.add("sel")
    selected = kind
    refreshGhost()
  })
  palette.append(b)
}

document.getElementById("smaller").addEventListener("click", () => setSize(placeSize - 8))
document.getElementById("bigger").addEventListener("click", () => setSize(placeSize + 8))
document.getElementById("clear").addEventListener("click", () => pg.querySelectorAll(".item").forEach(x => x.remove()))
function setSize(s) {
  placeSize = Math.min(96, Math.max(8, s))
  sizeout.textContent = placeSize
  refreshGhost()
}

function refreshGhost() {
  ghost?.remove()
  ghost = document.createElement("div")
  ghost.className = "ghost"
  ghost.hidden = true
  ghost.append(iconCanvas(selected, placeSize))
  pg.append(ghost)
}
refreshGhost()

const snap = v => Math.round(v / SNAP) * SNAP
const pgPos = e => {
  const r = pg.getBoundingClientRect()
  return { x: snap(e.clientX - r.left), y: snap(e.clientY - r.top) }
}

pg.addEventListener("mousemove", e => {
  const { x, y } = pgPos(e)
  rulerV.hidden = rulerH.hidden = coords.hidden = ghost.hidden = false
  rulerV.style.left = `${x}px`
  rulerH.style.top = `${y}px`
  ghost.style.left = `${x}px`
  ghost.style.top = `${y}px`
  coords.textContent = `${x},${y}`
})
pg.addEventListener("mouseleave", () => {
  rulerV.hidden = rulerH.hidden = coords.hidden = true
  if (ghost) ghost.hidden = true
})
pg.addEventListener("click", e => {
  const hitItem = e.target.closest?.(".item")
  if (hitItem) {
    hitItem.remove() // clicking a placed item removes it
    return
  }
  const { x, y } = pgPos(e)
  const item = document.createElement("div")
  item.className = "item"
  item.style.left = `${x}px`
  item.style.top = `${y}px`
  item.append(iconCanvas(selected, placeSize))
  pg.append(item)
})

// ── icon creator ─────────────────────────────────────
const imEl = document.getElementById("iconmaker")
if (imEl) {
  const im = initIconMaker(imEl)
  if (im?.redraw) iconCanvases.push(im.redraw) // redraw on theme flip
}

// ── clock harness — the game's dial, driven by sliders instead of the sim ────
const clockCanvas = document.getElementById("clockcanvas")
if (clockCanvas) {
  const cctx = clockCanvas.getContext("2d")
  const W = clockCanvas.width
  const H = clockCanvas.height
  const dayIn = document.getElementById("clockday")
  const hourIn = document.getElementById("clockhour")
  const budgetIn = document.getElementById("clockbudget")
  const dayv = document.getElementById("clockdayv")
  const hourv = document.getElementById("clockhourv")
  const budgetv = document.getElementById("clockbudgetv")
  const out = document.getElementById("clockout")
  let hoverSun = false
  let dragging = false
  let last = null
  let dragStart = null
  let dragAxis = null // "day" (around the ring) or "hour" (in/out) — locked per drag
  let risingHalf = true // hour: AM (rising to noon) vs PM (setting to midnight); flips at the extremes
  // faked, varied skill progress so the constellation polygons differ (the game
  // feeds real sim.skillProgress here; the wheel/visibility code is identical)
  const fakeProgress = i => ({ sides: 2 + ((i * 3 + 2) % 7), filled: (i * 2 + 1) % (2 + ((i * 3 + 2) % 7)), partial: (i * 0.37) % 1 })
  const drawClockDemo = () => {
    const day = +dayIn.value
    const minuteOfDay = +hourIn.value
    const budget = +budgetIn.value
    const { sun, moon } = drawDial(cctx, { w: W, h: H, day, minuteOfDay, budget, ink: ink(), surface: surface(), hoverSun })
    // the skill-wheel CONSTELLATIONS — the exact same drawSkillWheel the game clock
    // runs, so the test and the game can't drift. Night-only, moon-washed, rotating.
    const cwR = Math.min(W, H) * 0.36 // == drawDial's ring radius
    drawSkillWheel(cctx, { cx: W / 2, cy: H / 2, R: cwR, size: cwR / 9, day, sunAlt: sun.sunAlt, moonIllum: moon.illum, ink: ink(), progressOf: fakeProgress, w: W, h: H })
    dayv.textContent = day
    hourv.textContent = hhmm(minuteOfDay)
    budgetv.textContent = budget + "m"
    const season = sun.seasonal > 0.02 ? "long days" : sun.seasonal < -0.02 ? "short days" : "equinox"
    const swing = `${(moon.latRad * 180 / Math.PI).toFixed(1)}° off axis`
    out.innerHTML =
      `${hhmm(minuteOfDay)} · <b>${sun.isNight ? "night" : "day"}</b> · day ${day}<br>` +
      `sun altitude ${sun.sunAlt.toFixed(2)} · season: ${season}<br>` +
      `moon: ${moonPhaseName(moon)} · ${moon.isUp ? "up" : "down"} · ${swing}` +
      (moon.eclipse ? ` · <b>${moon.eclipse} eclipse</b>` : "")
  }
  for (const el of [dayIn, hourIn, budgetIn]) el.addEventListener("input", drawClockDemo)

  // PLAY — auto-advance the day so you can watch the whole YEAR turn: the skill
  // wheel rotating, the moon phase cycling (and washing the constellations in/out),
  // the sun's hue walking the colour wheel. Loops day 1 → 360.
  const playBtn = document.getElementById("clockplay")
  let playTimer = 0
  if (playBtn)
    playBtn.addEventListener("click", () => {
      if (playTimer) {
        clearInterval(playTimer)
        playTimer = 0
        playBtn.textContent = "▶ play the year"
        return
      }
      playBtn.textContent = "⏸ pause"
      playTimer = setInterval(() => {
        dayIn.value = (+dayIn.value % 360) + 1 // 1..360, looping
        drawClockDemo()
      }, 120)
    })

  // pointer → canvas pixels
  const toCanvas = e => {
    const r = clockCanvas.getBoundingClientRect()
    return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)]
  }
  // The grab target is the whole SUN AXIS at the current day angle — a band
  // around the line from the midnight end (inner) to the noon end (outer). The
  // hidden inner half only counts once we're already hovering: you first catch
  // the visible OUTER half (the axis is invisible until then), and then the
  // whole axis stays hot until you leave the band. `allowInner` opens the
  // inner half; pass the current hover state so it unlocks after entry.
  const overAxis = (px, py, allowInner) => {
    const cx = W / 2
    const cy = H / 2
    const R = Math.min(W, H) * 0.36
    const a = ((((+dayIn.value - 1) % 360) + 360) % 360) * (Math.PI / 180)
    const ux = Math.sin(a)
    const uy = -Math.cos(a)
    const dx = px - cx
    const dy = py - cy
    const along = dx * ux + dy * uy // signed radius along the axis
    const perp = Math.abs(dx * uy - dy * ux) // distance off the axis line
    const lo = allowInner ? R - INTRADAY_AXIS : R // inner (hidden) half opens only on hover
    return perp <= 12 && along >= lo - 10 && along <= R + INTRADAY_AXIS + 10
  }
  clockCanvas.addEventListener("pointermove", e => {
    const [px, py] = toCanvas(e)
    if (dragging) {
      // a POLAR slider on the sun, locked per drag: AROUND the ring → day, IN/OUT
      // → hour. Both are ABSOLUTE (the sun follows the cursor). For the hour, the
      // cursor's HEIGHT on the axis is the sun's altitude: top = noon, bottom =
      // midnight. AM/PM share the axis and flip at the extremes, so a continuous
      // up-then-down sweep covers the full 24h.
      const cx = W / 2
      const cy = H / 2
      const R = Math.min(W, H) * 0.36
      const angOf = (x, y) => Math.atan2(x - cx, -(y - cy))
      const radOf = (x, y) => Math.hypot(x - cx, y - cy)
      const curR = radOf(px, py)
      if (!dragAxis) {
        let tA = angOf(px, py) - angOf(dragStart[0], dragStart[1])
        if (tA > Math.PI) tA -= 2 * Math.PI
        if (tA < -Math.PI) tA += 2 * Math.PI
        const tangential = Math.abs(tA) * curR
        const radial = Math.abs(curR - radOf(dragStart[0], dragStart[1]))
        if (Math.max(tangential, radial) > 5) dragAxis = tangential > radial ? "day" : "hour"
      }
      if (dragAxis === "day") {
        dayIn.value = ((Math.round((angOf(px, py) * 180) / Math.PI) % 360) + 360) % 360 + 1
      } else if (dragAxis === "hour") {
        const nAlt = Math.max(-1, Math.min(1, (curR - R) / INTRADAY_AXIS)) // −1 midnight → +1 noon
        const baseH = (Math.acos(-nAlt) / Math.PI) * 720 // 0..720, this height's rising hour
        // reaching an extreme sets which half you leave it into: noon → PM
        // (descending is afternoon), midnight → AM (rising is morning)
        if (nAlt >= 0.98) risingHalf = false
        else if (nAlt <= -0.98) risingHalf = true
        hourIn.value = Math.round(risingHalf ? baseH : 1440 - baseH) % 1440
      }
      last = [px, py]
      drawClockDemo()
    } else {
      const h = overAxis(px, py, hoverSun) // once hovering, the whole axis stays hot
      if (h !== hoverSun) {
        hoverSun = h
        clockCanvas.style.cursor = h ? "grab" : "default"
        drawClockDemo()
      }
    }
  })
  clockCanvas.addEventListener("pointerdown", e => {
    const [px, py] = toCanvas(e)
    if (!overAxis(px, py, hoverSun)) return // grab anywhere along the axis
    dragging = true
    last = [px, py]
    dragStart = [px, py]
    dragAxis = null
    risingHalf = +hourIn.value <= 720 // start in the half the current hour is in
    clockCanvas.setPointerCapture(e.pointerId)
    clockCanvas.style.cursor = "grabbing"
  })
  const endDrag = () => {
    dragging = false
    clockCanvas.style.cursor = hoverSun ? "grab" : "default"
  }
  clockCanvas.addEventListener("pointerup", endDrag)
  clockCanvas.addEventListener("pointercancel", endDrag)
  iconCanvases.push(drawClockDemo) // redraw on the theme flip (and the initial applyTheme)
}

// ── theme (same storage/default as the game) ─────────
const themeBtn = document.getElementById("theme")
const root = document.documentElement
const applyTheme = t => {
  root.dataset.theme = t
  try {
    localStorage.setItem("thrive-theme", t)
  } catch {}
  themeBtn.textContent = t === "light" ? "☾" : "☀"
  for (const render of iconCanvases) render() // ink changed — redraw every icon
}
let saved = null
try {
  saved = localStorage.getItem("thrive-theme")
} catch {}
applyTheme(saved || "light")
themeBtn.addEventListener("click", () => applyTheme(root.dataset.theme === "light" ? "dark" : "light"))
