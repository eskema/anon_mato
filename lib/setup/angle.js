// First intake screen. Three modes:
//   pick    — move the pointer inside the circle to choose an angle (1..359),
//             click the number to propose it.
//   confirm — the two other vertices of the inscribed triangle become yes/no.
//             No resets the pick; Yes locks it in.
//   done    — yes/no turn into their actual angle numbers and a second triangle
//             is added pointing the opposite way, giving 6 points = a hexagon.

import { theme, fillDot, hitBox } from "../draw.js"

const REM = 16
const DOT_RADIUS = REM / 2 // ~1rem diameter dots
const CIRCLE_FRACTION = 0.6 // diameter ≈ 60% of the smaller viewport side
const STROKE = 1.5 // shared line width: circle, triangles, text circles

const YES_OFFSET = 120 // triangle vertex used for "yes"
const NO_OFFSET = 240 // triangle vertex used for "no"
const HEX_OFFSETS = [0, 60, 120, 180, 240, 300] // the six hexagon points

export function AngleScreen() {
  let api = null
  let angle = 0 // 0..359 — 0 is the initial/unset position
  let mode = "pick" // "pick" | "confirm" | "done"
  let mainBox = null // clickable number in pick mode
  let yesBox = null // clickable "yes" in confirm mode
  let noBox = null // clickable "no" in confirm mode

  function enter(a) {
    api = a
    angle = 0
    mode = "pick"
    mainBox = yesBox = noBox = null
  }

  const radius = L => (L.minSide * CIRCLE_FRACTION) / 2

  // 0° points up, increasing clockwise.
  function angleFromPoint(L, x, y) {
    let deg = Math.atan2(x - L.cx, -(y - L.cy)) * (180 / Math.PI)
    if (deg < 0) deg += 360
    return Math.round(deg) % 360
  }

  function pointOnCircle(L, deg, r) {
    const rad = deg * (Math.PI / 180)
    return { x: L.cx + r * Math.sin(rad), y: L.cy - r * Math.cos(rad) }
  }

  function onPointerMove(p) {
    if (mode === "pick") {
      const L = api.layout
      // only update while the pointer is inside the circle
      if (Math.hypot(p.x - L.cx, p.y - L.cy) <= radius(L)) {
        const next = angleFromPoint(L, p.x, p.y)
        if (next !== angle) {
          angle = next
          api.requestRender()
        }
      }
      cursor(angle > 0 && hitBox(mainBox, p))
    } else if (mode === "confirm") {
      cursor(hitBox(yesBox, p) || hitBox(noBox, p))
    } else {
      cursor(false)
    }
  }

  function onPointerDown(p) {
    if (mode === "pick") {
      if (angle > 0 && hitBox(mainBox, p)) {
        mode = "confirm"
        api.requestRender()
      }
    } else if (mode === "confirm") {
      if (hitBox(yesBox, p)) {
        mode = "done"
        cursor(false)
        api.commit(angle)
        api.requestRender()
      } else if (hitBox(noBox, p)) {
        // reset the selection and pick again
        mode = "pick"
        angle = 0
        cursor(false)
        api.requestRender()
      }
    }
  }

  // A number/word centered inside its own circle, tangent to the outer circle,
  // at a constant distance. When `filled`, the circle is filled with ink and the
  // label is drawn inverted (surface color). Returns its hit box.
  function label(ctx, L, deg, r, ink, surface, text, filled) {
    ctx.font = `600 ${2 * REM}px system-ui, sans-serif`
    const w = Math.max(ctx.measureText(text).width, ctx.measureText("000").width)
    const tr = w / 2 + 8
    const c = pointOnCircle(L, deg, r + tr)

    ctx.beginPath()
    ctx.arc(c.x, c.y, tr, 0, Math.PI * 2)
    if (filled) {
      ctx.fillStyle = ink
      ctx.fill()
    }
    ctx.strokeStyle = ink
    ctx.lineWidth = STROKE
    ctx.stroke()

    ctx.fillStyle = filled ? surface : ink
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(text, c.x, c.y)

    return { x: c.x - tr, y: c.y - tr, w: 2 * tr, h: 2 * tr }
  }

  // Equilateral triangle inscribed in the circle, first vertex at `startDeg`.
  function triangle(ctx, L, startDeg, r, ink) {
    const a = pointOnCircle(L, startDeg, r)
    const b = pointOnCircle(L, startDeg + 120, r)
    const c = pointOnCircle(L, startDeg + 240, r)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.lineTo(c.x, c.y)
    ctx.closePath()
    ctx.strokeStyle = ink
    ctx.lineWidth = STROKE
    ctx.stroke()
  }

  const deg360 = d => ((Math.round(d) % 360) + 360) % 360

  function draw(ctx, L) {
    const ink = theme("--text", "#eee")
    const surface = theme("--surface", "#111")
    const r = radius(L)

    // outer circle
    ctx.beginPath()
    ctx.arc(L.cx, L.cy, r, 0, Math.PI * 2)
    ctx.strokeStyle = ink
    ctx.globalAlpha = 0.3
    ctx.lineWidth = STROKE
    ctx.stroke()
    ctx.globalAlpha = 1

    fillDot(ctx, L.cx, L.cy, DOT_RADIUS, ink) // central dot

    mainBox = yesBox = noBox = null

    // at zero (unset) nothing else shows
    if (angle === 0) return

    const outer = pointOnCircle(L, angle, r)

    // connecting line to the picked tip
    ctx.beginPath()
    ctx.moveTo(L.cx, L.cy)
    ctx.lineTo(outer.x, outer.y)
    ctx.strokeStyle = ink
    ctx.lineWidth = STROKE
    ctx.stroke()

    // first triangle; in done mode the opposite triangle completes the hexagon
    triangle(ctx, L, angle, r, ink)
    if (mode === "done") triangle(ctx, L, angle + 180, r, ink)

    if (mode === "pick") {
      mainBox = label(ctx, L, angle, r, ink, surface, `${angle}`, false)
    } else if (mode === "confirm") {
      label(ctx, L, angle, r, ink, surface, `${angle}`, true) // locked-looking
      yesBox = label(ctx, L, angle + YES_OFFSET, r, ink, surface, "yes", false)
      noBox = label(ctx, L, angle + NO_OFFSET, r, ink, surface, "no", false)
    } else {
      // done: all six hexagon points show their angle; the picked one is filled
      for (const off of HEX_OFFSETS) {
        label(ctx, L, angle + off, r, ink, surface, `${deg360(angle + off)}`, off === 0)
      }
    }
  }

  function cursor(on) {
    document.body.style.cursor = on ? "pointer" : "default"
  }

  return { id: "angle", enter, onPointerMove, onPointerDown, draw }
}
