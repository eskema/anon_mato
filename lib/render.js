// Rendering for the hex-grid screen. Pure presentation: reads the sim (and
// the controller's ui state — hover, pending waits, replay, menu) and draws.
// Pixels never decide sim outcomes; anything topological comes from sim.js.
//
// The view is one continuous hex field: the board's interior, the one-tile
// SEAM around it (the parent grid's edges/vertices as tiles), and the
// neighbouring boards' facing rows beyond — everything on the same lattice.
//
// The style guide (styles.html) imports the icon painters from here, so the
// guide can never drift from the real rendering.

import { theme, arrowTip } from "./draw.js"
import { DIRS } from "./world.js"
import * as Hex from "./hex.js"
import { RINGS, SEAM_RING, VIEW_RING, GATE_DIR, SEED_ANGLE, BASE_DEPTH, ENERGY_START } from "./sim.js"
import { createTimeline } from "./timeline.js"

const key = Hex.key
const eq = Hex.equals

// ── shared icon painters (also used by the style guide) ──────────────
// The player: a regular hexagon (half a tile wide) with a filled background
// plus three inner lines from alternating vertices to the center — reads as an
// iso cube (NOT shaded/3D). The inverted set reads as an open cube / floor
// (the home-centre special tile).
export function drawCube(ctx, cx, cy, size, ink, surface, startDeg, invert = false) {
  const r = size * 0.5 // half the width of a grid tile
  const c = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i + startDeg)
    c.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  ctx.beginPath()
  c.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])))
  ctx.closePath()
  ctx.globalAlpha = 1
  ctx.fillStyle = surface
  ctx.fill()
  ctx.strokeStyle = ink
  ctx.lineWidth = 1.5
  ctx.lineJoin = "round"
  ctx.lineCap = "round"
  ctx.stroke()
  for (const i of invert ? [1, 3, 5] : [0, 2, 4]) {
    ctx.beginPath()
    ctx.moveTo(c[i][0], c[i][1])
    ctx.lineTo(cx, cy)
    ctx.stroke()
  }
}

// Two short barbs forming an open arrowhead at (tx,ty) opening back against (dx,dy).
export function arrowBarbs(ctx, tx, ty, dx, dy, s) {
  const a = Math.atan2(dy, dx)
  const w = 0.78 // barb half-angle — wider = more open
  ctx.beginPath()
  ctx.moveTo(tx - s * Math.cos(a - w), ty - s * Math.sin(a - w))
  ctx.lineTo(tx, ty)
  ctx.lineTo(tx - s * Math.cos(a + w), ty - s * Math.sin(a + w))
  ctx.stroke()
}

// Straight arrow through the button centre, pointing along (dx,dy).
export function drawArrowStraight(ctx, btn, dx, dy) {
  const len = btn.r * 0.6
  ctx.beginPath()
  ctx.moveTo(btn.x - dx * len, btn.y - dy * len)
  ctx.lineTo(btn.x + dx * len, btn.y + dy * len)
  ctx.stroke()
  arrowBarbs(ctx, btn.x + dx * len, btn.y + dy * len, dx, dy, btn.r * 0.5)
}

// Shaft that runs along the bottom then rounds up into a vertical shaft, pointing up —
// "get out to parent". Rounded-corner (arcTo) so the arrowhead sits on a clean vertical.
export function drawArrowUp(ctx, btn) {
  const r = btn.r
  const leftX = btn.x - r * 0.42
  const rightX = btn.x + r * 0.3
  const bottomY = btn.y + r * 0.42
  const topY = btn.y - r * 0.48
  ctx.beginPath()
  ctx.moveTo(leftX, bottomY)
  ctx.arcTo(rightX, bottomY, rightX, topY, r * 0.3) // along the bottom, round the corner up
  ctx.lineTo(rightX, topY)
  ctx.stroke()
  arrowBarbs(ctx, rightX, topY, 0, -1, r * 0.5) // head pointing up
}

export function hexCorners(cx, cy, size, startDeg) {
  const out = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i + startDeg)
    out.push({ x: cx + size * Math.cos(a), y: cy + size * Math.sin(a) })
  }
  return out
}

function fillHex(ctx, c, size, fill, alpha, startDeg) {
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i + startDeg)
    const x = c.x + size * Math.cos(a)
    const y = c.y + size * Math.sin(a)
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.globalAlpha = alpha
  ctx.fill()
  ctx.globalAlpha = 1
}

// ── display extras per orientation ───────────────────
// The two corner indices bounding each neighbour's shared edge, and the
// half-extents (interior / with perimeter) used to fit the viewport.
function displayOf(o) {
  const d = { o }
  d.edgeCorners = DIRS.map(dir => {
    const theta = (Hex.screenAngle(o, dir.q, dir.r) * 180) / Math.PI
    let best = 0
    let bestDiff = Infinity
    for (let i = 0; i < 6; i++) {
      const mid = 60 * i + o.startDeg + 30 // midpoint angle of edge between corner i, i+1
      const diff = Math.abs(((theta - mid + 540) % 360) - 180)
      if (diff < bestDiff) {
        bestDiff = diff
        best = i
      }
    }
    return [best, (best + 1) % 6]
  })
  const ext = n => {
    let hx = 0
    let hy = 0
    for (const [q, r] of Hex.range(n)) {
      hx = Math.max(hx, Math.abs(o.f[0] * q + o.f[1] * r))
      hy = Math.max(hy, Math.abs(o.f[2] * q + o.f[3] * r))
    }
    return { hx: hx + 1, hy: hy + 1 }
  }
  d.ext = ext(RINGS)
  d.extView = ext(VIEW_RING)
  return d
}
const DISPLAY = new Map([
  [Hex.POINTY, displayOf(Hex.POINTY)],
  [Hex.FLAT, displayOf(Hex.FLAT)]
])

export function createRenderer(sim) {
  const timeline = createTimeline()
  const gateTile = [DIRS[GATE_DIR].q, DIRS[GATE_DIR].r]
  let menuBtns = [] // radial-menu slot hit-circles, refreshed each draw
  let helperBtns = [] // helpers-menu hit-boxes (bottom left), refreshed each draw

  const disp = () => DISPLAY.get(sim.orient())

  // ── pixel geometry ─────────────────────────────────
  // The area the grid actually gets: full width, below the clock chrome.
  function gridFrame(L, expanded) {
    const top = timeline.height(expanded)
    const h = Math.max(50, L.h - top)
    return { w: L.w, h, cx: L.w / 2, cy: top + h / 2 }
  }
  let frame = { w: 0, h: 0, cx: 0, cy: 0 } // set per draw; hit-tests reuse the last one
  const setFrame = (L, expanded) => (frame = gridFrame(L, expanded))
  // SEAM VIEW: while the player stands on the seam (nobody's space), the
  // camera centres THEM and the boards move instead — the classic inversion.
  // cam is the pixel offset that pins the anchor tile to the frame centre.
  let cam = { x: 0, y: 0 }
  let camAnchor = [0, 0] // where the camera looks (global): the current board's centre, or the player on seam ground
  function setCam(anchor, size) {
    const centre = anchor ? sim.boardCentreOf(anchor) : null
    camAnchor = centre || anchor || [0, 0]
    const f = sim.orient().f
    cam = {
      x: size * (f[0] * camAnchor[0] + f[1] * camAnchor[1]),
      y: size * (f[2] * camAnchor[0] + f[3] * camAnchor[1])
    }
  }

  function sizeFor() {
    // above the base the seam + neighbour rows are part of the view — fit them.
    // (Slimmer margins than the interior-only days: two real rings joined a
    // fixed fit, so every reclaimable pixel goes back to the board.)
    const ext = sim.depth() > BASE_DEPTH ? disp().extView : disp().ext
    return Math.min((0.48 * frame.w) / ext.hx, (0.48 * frame.h) / ext.hy)
  }

  function hexToPixel(L, q, r, size) {
    const f = sim.orient().f
    return {
      x: frame.cx - cam.x + size * (f[0] * q + f[1] * r),
      y: frame.cy - cam.y + size * (f[2] * q + f[3] * r)
    }
  }

  function pixelToHex(L, x, y, size) {
    const b = sim.orient().b
    const px = (x - frame.cx + cam.x) / size
    const py = (y - frame.cy + cam.y) / size
    const [q, r] = Hex.round(b[0] * px + b[1] * py, b[2] * px + b[3] * py)
    return { q, r }
  }

  // ── draw pieces ────────────────────────────────────
  function drawPath(ctx, L, size, path, ink, dashed) {
    if (!path || path.length < 2) return
    ctx.save()
    ctx.strokeStyle = ink
    ctx.globalAlpha = 0.45
    ctx.lineWidth = 1.5
    ctx.lineJoin = "round"
    ctx.lineCap = "round"
    if (dashed) ctx.setLineDash([5, 5])
    ctx.beginPath()
    path.forEach((h, i) => {
      const c = hexToPixel(L, h[0], h[1], size)
      i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)
    })
    ctx.stroke()
    ctx.restore()
  }

  // Small arrowheads along the committed trail — one per leg, at each segment
  // midpoint, pointing in the direction travelled. A leap leg is just a longer
  // segment: same straight arrow, riding the crack between the flankers.
  function drawTrailArrows(ctx, L, size, trail, ink) {
    if (trail.length < 2) return
    ctx.globalAlpha = 0.45
    for (let i = 1; i < trail.length; i++) {
      const a = hexToPixel(L, trail[i - 1][0], trail[i - 1][1], size)
      const b = hexToPixel(L, trail[i][0], trail[i][1], size)
      arrowTip(ctx, a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2, ink, size * 0.32, size * 0.2, 1.5)
    }
    ctx.globalAlpha = 1
  }

  // ── the frame ──────────────────────────────────────
  // ui: { hovered, hoverPath, hoverRetrace, clockExpanded, helpersOpen, logsOpen, replaying, menu,
  //       pending: null | { verb, target, ghostTile, ghostTrail, inflightMin, remainingMin } }
  function draw(ctx, L, ui) {
    const ink = theme("--text", "#eee")
    const surface = theme("--surface", "#111")
    setFrame(L, ui.clockExpanded)
    const size = sizeFor()
    const v = sim.view()
    const o = sim.orient()
    setCam(ui.pending?.ghostTile || v.player, size) // seam view follows the walker

    // hovering a trail tile with an affordable retrace invalidates the stretch
    // beyond it — the solid trail only draws up to that tile, and the dashed
    // retrace points back at it. A fallback (non-retrace) route leaves the
    // trail whole: the walk merely passes by.
    const baseTrail = ui.pending?.ghostTrail || v.trail
    const hovTrailIdx = ui.hovered && ui.hoverRetrace && !ui.pending ? sim.trailIndexOf(ui.hovered) : -1
    const trail = hovTrailIdx >= 0 ? baseTrail.slice(0, hovTrailIdx + 1) : baseTrail

    // the angle line: the seed angle's ray out of the home centre, off screen —
    // the same ray that seeds the gate. Drawn first, so everything sits on top.
    if (v.tile.safe) {
      const rad = (SEED_ANGLE * Math.PI) / 180
      const len = frame.w + frame.h // safely past any screen edge
      ctx.strokeStyle = ink
      ctx.globalAlpha = 0.25
      ctx.lineWidth = 1
      const origin = hexToPixel(L, 0, 0, size)
      ctx.beginPath()
      ctx.moveTo(origin.x, origin.y)
      ctx.lineTo(origin.x + Math.sin(rad) * len, origin.y - Math.cos(rad) * len)
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    // the field — ONE global pass: every discovered tile in the viewport
    // draws (boards and seam alike), culled at ~4 board-pitches around the
    // camera or ~2 screenfuls, whichever is smaller. Fill, border/seam style
    // and walls all resolve per hex through the sim's global queries.
    const dots = sim.reachableDots()
    {
      const pitch = 2 * RINGS + 2
      const rCull = Math.min(4 * pitch, Math.ceil((2 * Math.max(frame.w, frame.h)) / (size * 1.5)))
      const inset = 1 - 1 / (Math.sqrt(3) * size)
      const wInset = 1 - 3 / (Math.sqrt(3) * size)
      const seamLw = 2
      const seamInset = 1 - seamLw / (Math.sqrt(3) * size)
      for (const dlt of Hex.range(rCull)) {
        const h = [camAnchor[0] + dlt[0], camAnchor[1] + dlt[1]]
        const c = hexToPixel(L, h[0], h[1], size)
        if (c.x < -size || c.x > L.w + size || c.y < -size || c.y > L.h + size) continue
        const kind = sim.kindOf(h)
        if (!kind || !sim.isDiscovered(h)) continue
        fillHex(ctx, c, size, ink, 0.05, o.startDeg)
        if (kind === "seam") {
          // seam tiles: a SURFACE border (inward) + the inner hex punched out —
          // the fill floats as a clean detached ring
          const cs = hexCorners(c.x, c.y, size * seamInset, o.startDeg)
          ctx.strokeStyle = surface
          ctx.globalAlpha = 1
          ctx.lineWidth = seamLw
          ctx.beginPath()
          for (let i = 0; i < 6; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, cs[i].x, cs[i].y)
          ctx.closePath()
          ctx.stroke()
          fillHex(ctx, c, size * 0.72, surface, 1, o.startDeg)
        } else {
          // every tile draws its OWN border, grown inward — never leaves its
          // own polygon, so nothing paints over a neighbour or the seam
          const cs = hexCorners(c.x, c.y, size * inset, o.startDeg)
          ctx.strokeStyle = ink
          ctx.globalAlpha = 0.12
          ctx.lineWidth = 1
          ctx.beginPath()
          for (let d = 0; d < 6; d++) {
            const [ca, cb] = disp().edgeCorners[d]
            ctx.moveTo(cs[ca].x, cs[ca].y)
            ctx.lineTo(cs[cb].x, cs[cb].y)
          }
          ctx.stroke()
          ctx.globalAlpha = 1
        }
        // walls: bold inward edges wherever a hex owns them — a closed gate
        // reads as wall until the board is cleared
        const bits = sim.wallsAt(h)
        if (bits) {
          const cw = hexCorners(c.x, c.y, size * wInset, o.startDeg)
          ctx.strokeStyle = ink
          ctx.globalAlpha = 0.7
          ctx.lineWidth = 3
          for (let d = 0; d < 6; d++) {
            if (!((bits >> d) & 1)) continue
            const [ca, cb] = disp().edgeCorners[d]
            ctx.beginPath()
            ctx.moveTo(cw[ca].x, cw[ca].y)
            ctx.lineTo(cw[cb].x, cw[cb].y)
            ctx.stroke()
          }
          ctx.globalAlpha = 1
        }
      }
      // the player's own frontier dots
      for (const k of dots) {
        const [q, r] = k.split(",").map(Number)
        const c = hexToPixel(L, q, r, size)
        ctx.fillStyle = ink
        ctx.globalAlpha = 0.25
        ctx.beginPath()
        ctx.arc(c.x, c.y, 2, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }

    // hover highlight (movable target tile)
    if (ui.hovered && ui.hoverPath) {
      fillHex(ctx, hexToPixel(L, ui.hovered[0], ui.hovered[1], size), size, ink, 0.12, o.startDeg)
    }
    // hovering a reachable (dotted) undiscovered tile: outline it (no fill)
    if (ui.hovered && !sim.isDiscovered(ui.hovered) && dots.has(key(ui.hovered))) {
      const c = hexToPixel(L, ui.hovered[0], ui.hovered[1], size)
      const cs = hexCorners(c.x, c.y, size, o.startDeg)
      ctx.strokeStyle = ink
      ctx.globalAlpha = 0.45
      ctx.lineWidth = 1.5
      ctx.beginPath()
      for (let i = 0; i < 6; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, cs[i].x, cs[i].y)
      ctx.closePath()
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    // home tile (base): bumped outline (inward, like every border), gate edge open
    if (v.isBase) {
      const hc0 = hexToPixel(L, 0, 0, size)
      const hcs = hexCorners(hc0.x, hc0.y, size * (1 - 1.5 / (Math.sqrt(3) * size)), o.startDeg)
      ctx.strokeStyle = ink
      ctx.globalAlpha = 0.45
      ctx.lineWidth = 1.5
      for (let d = 0; d < 6; d++) {
        if (d === GATE_DIR) continue
        const [a, b] = disp().edgeCorners[d]
        ctx.beginPath()
        ctx.moveTo(hcs[a].x, hcs[a].y)
        ctx.lineTo(hcs[b].x, hcs[b].y)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    // committed walked route (solid, with per-leg arrowheads); dashed hover
    drawPath(ctx, L, size, trail, ink, false)
    drawTrailArrows(ctx, L, size, trail, ink)
    drawPath(ctx, L, size, ui.hoverPath, ink, true)
    if (ui.hoverPath && ui.hoverPath.length >= 2) {
      const a = hexToPixel(L, ui.hoverPath[ui.hoverPath.length - 2][0], ui.hoverPath[ui.hoverPath.length - 2][1], size)
      const b = hexToPixel(L, ui.hoverPath[ui.hoverPath.length - 1][0], ui.hoverPath[ui.hoverPath.length - 1][1], size)
      ctx.globalAlpha = 0.45
      arrowTip(ctx, a.x, a.y, b.x, b.y, ink, size * 0.32, size * 0.2, 1.5)
      ctx.globalAlpha = 1
    }

    // entry marker (ring) — only the home base centre
    if (v.isBase) {
      const e = hexToPixel(L, v.entry[0], v.entry[1], size)
      ctx.strokeStyle = ink
      ctx.beginPath()
      ctx.arc(e.x, e.y, 7, 0, Math.PI * 2)
      ctx.globalAlpha = 0.7
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    // centre special piece (safe space) — always visible once discovered: the
    // same cube the player uses, inverted (floor corners), full tile size
    if (v.tile.safe && v.tile.discovered.has("0,0")) {
      const hc = hexToPixel(L, 0, 0, size)
      drawCube(ctx, hc.x, hc.y, size * 2, ink, surface, o.startDeg, true)
    }

    // the cube on top
    const cubeTile = ui.pending?.ghostTile || v.player
    const pc = hexToPixel(L, cubeTile[0], cubeTile[1], size)
    drawCube(ctx, pc.x, pc.y, size, ink, surface, o.startDeg)

    // radial action menu: 6 hex slots ringing the player tile, styled apart
    // from the board (opaque fill + bright outline). Actions fill from the
    // top, clockwise.
    menuBtns = []
    if (ui.menu) {
      const acts = ui.menu
      const c = hexToPixel(L, v.player[0], v.player[1], size)
      const slots = DIRS.map(d => hexToPixel(L, v.player[0] + d.q, v.player[1] + d.r, size)).sort(
        (a, b) =>
          (((Math.atan2(a.y - c.y, a.x - c.x) * 180) / Math.PI + 90 + 360) % 360) -
          (((Math.atan2(b.y - c.y, b.x - c.x) * 180) / Math.PI + 90 + 360) % 360)
      )
      ctx.font = "600 11px system-ui, sans-serif"
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      slots.forEach((s, idx) => {
        const act = acts[idx]
        const cs = hexCorners(s.x, s.y, size * 0.68, o.startDeg)
        ctx.beginPath()
        for (let k2 = 0; k2 < 6; k2++) (k2 ? ctx.lineTo : ctx.moveTo).call(ctx, cs[k2].x, cs[k2].y)
        ctx.closePath()
        ctx.fillStyle = surface
        ctx.globalAlpha = 0.9
        ctx.fill()
        ctx.strokeStyle = ink
        ctx.globalAlpha = act ? 0.9 : 0.25 // empty slots stay faint
        ctx.lineWidth = 1.5
        ctx.stroke()
        if (act) {
          ctx.fillStyle = ink
          ctx.globalAlpha = 0.9
          ctx.fillText(act.label, s.x, s.y)
          menuBtns.push({ x: s.x, y: s.y, r: size * 0.68, run: act.run })
        }
      })
      ctx.globalAlpha = 1
      ctx.textAlign = "left"
    }

    // live clock: nothing debits until a pending action completes, so show the
    // in-flight minutes (whole minutes, so every counter steps together)
    const inflight = ui.pending ? ui.pending.inflightMin : 0
    const liveEnergy = sim.energy() - inflight
    const spent = ENERGY_START - liveEnergy
    const reserved = ui.pending?.ghostTile
      ? v.tile.safe
        ? 0
        : sim.returnFrom(ui.pending.ghostTile)
      : sim.returnCost()

    // status line at the very top (click it to toggle the clock)
    const hr = 6 + Math.floor(spent / 60)
    const mn = Math.round(spent % 60)
    const clock = `${String(hr).padStart(2, "0")}:${String(mn).padStart(2, "0")}`
    ctx.font = ui.clockExpanded ? "600 16px system-ui, sans-serif" : "600 11px system-ui, sans-serif"
    ctx.textAlign = "left"
    ctx.textBaseline = "middle"
    ctx.fillStyle = ink
    ctx.globalAlpha = 0.9
    ctx.fillText(`anon&mato  ·  day ${sim.day()}  ·  ${clock}`, 14, 14)
    ctx.globalAlpha = 1

    // coord line + hovered/committed action cost. On a board: "in [board] at
    // [local]"; on the seam: the global position.
    const cubeBoard = sim.boardHexOf(cubeTile)
    const cubeCentre = cubeBoard ? sim.boardCentreOf(cubeTile) : null
    const at = cubeBoard
      ? `in [${cubeBoard[0]},${cubeBoard[1]}] at [${cubeTile[0] - cubeCentre[0]},${cubeTile[1] - cubeCentre[1]}]`
      : `at [${cubeTile[0]},${cubeTile[1]}]`
    let action = null
    if (ui.pending) {
      const p = ui.pending
      action = { text: `+${p.remainingMin} ${p.verb} [${p.target[0]},${p.target[1]}]`, committed: true }
    } else if (ui.hovered && ui.hoverPath) {
      const hb = sim.boardHexOf(ui.hovered)
      const crossing = !!hb && (!cubeBoard || hb[0] !== cubeBoard[0] || hb[1] !== cubeBoard[1])
      action = {
        text: `+${Math.round(sim.pathCost(ui.hoverPath))} ${crossing ? "crossing to" : "walking to"} [${ui.hovered[0]},${ui.hovered[1]}]`,
        committed: false
      }
    } else if (ui.hovered && sim.isFrontier(ui.hovered) && sim.canScout(ui.hovered)) {
      action = {
        text: `+${Math.round(sim.scoutCostAt(ui.hovered))} scouting [${ui.hovered[0]},${ui.hovered[1]}]`,
        committed: false
      }
    }
    timeline.draw(ctx, L, ink, {
      day: sim.day(),
      used: spent,
      reserved,
      free: liveEnergy - reserved,
      at,
      action,
      expanded: ui.clockExpanded
    })

    // helpers: a collapsible menu mirroring the clock line, inverted — the
    // "helpers" label sits at the very bottom, buttons stack above it
    helperBtns = []
    ctx.font = ui.helpersOpen ? "600 16px system-ui, sans-serif" : "600 11px system-ui, sans-serif"
    ctx.textAlign = "left"
    ctx.textBaseline = "middle"
    ctx.fillStyle = ink
    ctx.globalAlpha = 0.9
    ctx.fillText("helpers", 14, L.h - 14)
    ctx.globalAlpha = 1
    if (ui.helpersOpen) {
      ctx.font = "600 16px system-ui, sans-serif"
      ;["go home", "rest and resume", "clear board"].forEach((lbl, i) => {
        const by = L.h - 14 - 28 * (i + 1)
        ctx.fillStyle = ink
        ctx.globalAlpha = 0.75
        ctx.fillText(lbl, 14, by)
        helperBtns.push({ x: 10, y: by - 11, w: ctx.measureText(lbl).width + 8, h: 22, action: lbl })
      })
      ctx.globalAlpha = 1
    }

    // logs: the day's action log, collapsible from the top right — a live
    // window into exactly what a saved day would store (see DESIGN.md,
    // "the action log"). Newest at the bottom; long days elide the head.
    ctx.font = ui.logsOpen ? "600 16px system-ui, sans-serif" : "600 11px system-ui, sans-serif"
    ctx.textAlign = "right"
    ctx.textBaseline = "middle"
    ctx.fillStyle = ink
    ctx.globalAlpha = 0.9
    ctx.fillText("logs", L.w - 14, 14)
    ctx.globalAlpha = 1
    if (ui.logsOpen) {
      // consecutive moves collapse into one line (display only — the stored
      // log keeps every entry): index range, final target, minutes charged
      const log = sim.log()
      const meta = sim.logMeta()
      const lines = []
      for (let i = 0; i < log.length; ) {
        let j = i + 1
        if (log[i].type === "move") while (j < log.length && log[j].type === "move") j++
        const a = log[j - 1]
        let mins = 0
        for (let k = i; k < j; k++) mins += meta[k] || 0
        let s = i === j - 1 ? `${i + 1}` : `${i + 1}–${j}`
        s += `  ${a.type}`
        if (j - i > 1) s += ` ×${j - i}`
        if (a.target) s += ` [${a.target[0]},${a.target[1]}]`
        if (mins > 0) s += ` ·${Math.round(mins)}m`
        lines.push(s)
        i = j
      }
      ctx.font = "600 16px system-ui, sans-serif"
      ctx.globalAlpha = 0.75
      let ly = 42
      if (!lines.length) {
        ctx.fillText("no actions yet", L.w - 14, ly)
      } else {
        const max = Math.max(1, Math.floor((L.h - 84) / 24)) // lines that fit above the bottom edge
        const start = Math.max(0, lines.length - max)
        if (start > 0) {
          ctx.fillText(`⋯ ${start} earlier`, L.w - 14, ly)
          ly += 24
        }
        for (let i = start; i < lines.length; i++) {
          ctx.fillText(lines[i], L.w - 14, ly)
          ly += 24
        }
      }
      ctx.globalAlpha = 1
    }
    ctx.textAlign = "left"

    // replay play/stop button — only on the expanded clock
    if (ui.clockExpanded) {
      const pb = timeline.playButton(L)
      ctx.fillStyle = ink
      ctx.globalAlpha = ui.replaying || sim.log().length ? 0.9 : 0.25
      if (ui.replaying) {
        ctx.fillRect(pb.x - 3, pb.y - 3, 7, 7) // stop
      } else {
        ctx.beginPath()
        ctx.moveTo(pb.x - 3, pb.y - 5)
        ctx.lineTo(pb.x - 3, pb.y + 5)
        ctx.lineTo(pb.x + 5, pb.y)
        ctx.closePath()
        ctx.fill() // play
      }
      ctx.globalAlpha = 1
    }
  }

  return {
    draw,
    setFrame,
    sizeFor,
    pixelToHex,
    hexToPixel,
    playButton: L => timeline.playButton(L),
    helperBtns: () => helperBtns,
    menuBtns: () => menuBtns
  }
}
