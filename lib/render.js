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
import { RINGS, SEAM_RING, VIEW_RING, GATE_DIR, BASE_DEPTH, ENERGY_START, isSeamHex, seamLobesOf } from "./sim.js"
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

  function sizeFor() {
    // above the base the seam + neighbour rows are part of the view — fit them.
    // (Slimmer margins than the interior-only days: two real rings joined a
    // fixed fit, so every reclaimable pixel goes back to the board.)
    const ext = sim.depth() > BASE_DEPTH ? disp().extView : disp().ext
    return Math.min((0.48 * frame.w) / ext.hx, (0.48 * frame.h) / ext.hy)
  }

  function hexToPixel(L, q, r, size) {
    const f = sim.orient().f
    return { x: frame.cx + size * (f[0] * q + f[1] * r), y: frame.cy + size * (f[2] * q + f[3] * r) }
  }

  function pixelToHex(L, x, y, size) {
    const b = sim.orient().b
    const px = (x - frame.cx) / size
    const py = (y - frame.cy) / size
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
  // midpoint, pointing in the direction travelled.
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
  // ui: { hovered, hoverPath, clockExpanded, replaying, menu,
  //       pending: null | { verb, target, ghostTile, ghostTrail, inflightMin, remainingMin } }
  function draw(ctx, L, ui) {
    const ink = theme("--text", "#eee")
    const surface = theme("--surface", "#111")
    setFrame(L, ui.clockExpanded)
    const size = sizeFor()
    const v = sim.view()
    const o = sim.orient()

    // hovering a trail tile invalidates the stretch beyond it — the solid trail
    // only draws up to that tile, and the dashed retrace points back at it
    const baseTrail = ui.pending?.ghostTrail || v.trail
    const hovTrailIdx = ui.hovered && !ui.pending ? sim.trailIndexOf(ui.hovered) : -1
    const trail = hovTrailIdx >= 0 ? baseTrail.slice(0, hovTrailIdx + 1) : baseTrail
    const trailKeys = new Set(baseTrail.map(t => key(t)))

    // the field: interior + seam + the neighbours' facing rows. Explored tiles
    // filled; scoutable neighbours (seam and crossings included) as faint dots.
    const dots = sim.reachableDots()
    const inView = h => sim.kindOf(h) !== null
    for (const h of Hex.range(VIEW_RING)) {
      if (!inView(h)) continue
      const [q, r] = h
      const k = `${q},${r}`
      const c = hexToPixel(L, q, r, size)
      if (sim.isDiscovered(h)) {
        const alpha = trailKeys.has(k) ? 0.12 : 0.05 // current trail brighter than past
        fillHex(ctx, c, size, ink, alpha, o.startDeg)
        if (sim.kindOf(h) === "seam") {
          // seam tiles (parent edges/vertices): a SURFACE border — inward like
          // every border, so it stays inside the seam's own polygon — plus the
          // inner hex punched out: the fill floats as a clean detached ring
          const lw = 2
          const inset = 1 - lw / (Math.sqrt(3) * size)
          const cs = hexCorners(c.x, c.y, size * inset, o.startDeg)
          ctx.strokeStyle = surface
          ctx.globalAlpha = 1
          ctx.lineWidth = lw
          ctx.beginPath()
          for (let i = 0; i < 6; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, cs[i].x, cs[i].y)
          ctx.closePath()
          ctx.stroke()
          fillHex(ctx, c, size * 0.72, surface, 1, o.startDeg)
        } else {
          // every tile draws its OWN border, grown inward: the stroke's outer
          // edge sits on the boundary and never leaves the tile's polygon, so
          // no tile can paint over a neighbour (or the seam) — no shared lines
          const inset = 1 - 1 / (Math.sqrt(3) * size)
          const cs = hexCorners(c.x, c.y, size * inset, o.startDeg)
          ctx.strokeStyle = ink
          ctx.globalAlpha = 0.12
          ctx.lineWidth = 1
          ctx.beginPath()
          for (let d = 0; d < 6; d++) {
            // the base home centre and its gate tile keep the gate side open
            if (v.isBase && eq(h, [0, 0]) && d === GATE_DIR) continue
            if (v.isBase && eq(h, gateTile) && d === (GATE_DIR + 3) % 6) continue
            const [ca, cb] = disp().edgeCorners[d]
            ctx.moveTo(cs[ca].x, cs[ca].y)
            ctx.lineTo(cs[cb].x, cs[cb].y)
          }
          ctx.stroke()
          ctx.globalAlpha = 1
        }
      } else if (dots.has(k)) {
        ctx.fillStyle = ink
        ctx.globalAlpha = 0.25
        ctx.beginPath()
        ctx.arc(c.x, c.y, 2, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1

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

    // walls (a tile prop): sealed directions drawn bold on the discovered
    // border tiles, along their edges toward the seam — inward like every
    // border, so the seam stays untouched.
    if (v.tile.walls) {
      ctx.strokeStyle = ink
      ctx.globalAlpha = 0.7
      ctx.lineWidth = 3
      const wInset = 1 - 3 / (Math.sqrt(3) * size)
      for (const h of Hex.ring([0, 0], RINGS)) {
        if (!sim.isDiscovered(h)) continue
        const c = hexToPixel(L, h[0], h[1], size)
        const cs = hexCorners(c.x, c.y, size * wInset, o.startDeg)
        for (let d = 0; d < 6; d++) {
          const n = [h[0] + DIRS[d].q, h[1] + DIRS[d].r]
          if (Hex.length(n) !== SEAM_RING || !isSeamHex(n)) continue
          const lobes = seamLobesOf(n)
          // a side seam is sealed when its lobe is walled; a junction only
          // when both of its lobes are (the doorpost rule)
          if (!lobes.length || !lobes.every(i => sim.walled(i))) continue
          const [ca, cb] = disp().edgeCorners[d]
          ctx.beginPath()
          ctx.moveTo(cs[ca].x, cs[ca].y)
          ctx.lineTo(cs[cb].x, cs[cb].y)
          ctx.stroke()
        }
      }
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

    // coord line + hovered/committed action cost
    const at = v.origin
      ? `in [${v.origin[0]},${v.origin[1]}] at [${cubeTile[0]},${cubeTile[1]}]`
      : `at [${cubeTile[0]},${cubeTile[1]}]`
    let action = null
    if (ui.pending) {
      const p = ui.pending
      action = { text: `+${p.remainingMin} ${p.verb} [${p.target[0]},${p.target[1]}]`, committed: true }
    } else if (ui.hovered && ui.hoverPath) {
      const crossing = sim.kindOf(ui.hovered) === "nbr"
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
      expanded: ui.clockExpanded,
      homeButtons: ["go home", "rest and resume"]
    })

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
    homeButtons: () => timeline.homeButtons(),
    menuBtns: () => menuBtns
  }
}
