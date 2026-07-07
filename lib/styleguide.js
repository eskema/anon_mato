// Style-guide page logic (styles.html) — a plain-DOM reference of the app's styles.
// Icons are drawn onto small canvases by the SAME functions the game uses (imported
// from render.js), so the guide can never drift from the real rendering.

import { theme, arrowTip } from "./draw.js"
import { drawCube, drawArrowUp, drawArrowStraight, hexCorners } from "./render.js"
import { ICONS as MENU_ICONS, drawIcon as drawMenuIcon } from "./icons.js"

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
