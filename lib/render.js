// Rendering for the hex-grid screen. Pure presentation: reads the sim (and
// the controller's ui state — hover, pending waits, replay, menu) and draws.
// Pixels never decide sim outcomes; anything topological comes from sim.js.
//
// The style guide (styles.html) imports the icon painters from here, so the
// guide can never drift from the real rendering.

import { theme, arrowTip } from "./draw.js"
import { DIRS } from "./world.js"
import * as Hex from "./hex.js"
import {
  RINGS,
  GATE_DIR,
  BASE_DEPTH,
  ENERGY_START,
  SUPER,
  inBounds,
  boundaryEdges,
  edgeTilesInto
} from "./sim.js"
import { createTimeline } from "./timeline.js"

const key = Hex.key
const eq = Hex.equals
const NEIGHBOR_GAP = 0 // extra space beyond flush (0 = vertices touch), in hex-size units

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

// Straight arrow through the button centre, pointing along (dx,dy) — "slide to neighbour".
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
// half-extents used to fit the viewport.
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
  let hx = 0
  let hy = 0
  for (const [q, r] of Hex.range(RINGS)) {
    hx = Math.max(hx, Math.abs(o.f[0] * q + o.f[1] * r))
    hy = Math.max(hy, Math.abs(o.f[2] * q + o.f[3] * r))
  }
  d.ext = { hx: hx + 1, hy: hy + 1 }
  return d
}
const DISPLAY = new Map([
  [Hex.POINTY, displayOf(Hex.POINTY)],
  [Hex.FLAT, displayOf(Hex.FLAT)]
])

// ── the edge mesh (render-only: every shared edge drawn once) ────────
function buildEdges() {
  const seen = new Set()
  const out = []
  for (const [q, r] of Hex.range(RINGS)) {
    for (let d = 0; d < 6; d++) {
      const nq = q + DIRS[d].q
      const nr = r + DIRS[d].r
      const k = edgeKey(q, r, nq, nr)
      if (seen.has(k)) continue
      seen.add(k)
      out.push({ q, r, dir: d, key: k })
    }
  }
  return out
}

// Canonical unordered key for the edge between two hexes.
function edgeKey(q1, r1, q2, r2) {
  return q1 < q2 || (q1 === q2 && r1 <= r2) ? `${q1},${r1}|${q2},${r2}` : `${q2},${r2}|${q1},${r1}`
}

export function createRenderer(sim) {
  const timeline = createTimeline()
  const edges = buildEdges()
  const gateEdgeKey = edgeKey(0, 0, DIRS[GATE_DIR].q, DIRS[GATE_DIR].r)
  let menuBtns = [] // radial-menu slot hit-circles, refreshed each draw

  const disp = () => DISPLAY.get(sim.orient())

  // ── pixel geometry ─────────────────────────────────
  // The area the grid actually gets: full width, below the clock chrome.
  // Centring in this frame keeps the edge tiles clear of the clock.
  function gridFrame(L, expanded) {
    const top = timeline.height(expanded)
    const h = Math.max(50, L.h - top)
    return { w: L.w, h, cx: L.w / 2, cy: top + h / 2 }
  }
  let frame = { w: 0, h: 0, cx: 0, cy: 0 } // set per draw; hit-tests reuse the last one
  const setFrame = (L, expanded) => (frame = gridFrame(L, expanded))

  function sizeFor(L) {
    const { ext } = disp()
    // leave room for the edge tiles' first touching row (ghost tiles + parked
    // buttons sit ~1 tile beyond the boundary) — just that strip
    const pad = sim.depth() > BASE_DEPTH ? 2 : 0
    return Math.min((0.45 * frame.w) / (ext.hx + pad), (0.45 * frame.h) / (ext.hy + pad))
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

  // Clean screen direction + reach of edge tile i (shared by placement + walls).
  function edgeGeom(i, L, size) {
    const o = sim.orient()
    const sc = hexToPixel(L, SUPER[i][0], SUPER[i][1], size)
    const deg = (Math.atan2(sc.y - frame.cy, sc.x - frame.cx) * 180) / Math.PI
    const snap = -o.startDeg
    const clean = (Math.round((deg - snap) / 60) * 60 + snap) * (Math.PI / 180)
    const dirx = Math.cos(clean)
    const diry = Math.sin(clean)
    let ext = 0
    for (const e of boundaryEdges) {
      const base = hexToPixel(L, e.q, e.r, size)
      const cs = hexCorners(base.x, base.y, size, o.startDeg)
      const [a, b] = disp().edgeCorners[e.dir]
      ext = Math.max(ext, (cs[a].x - frame.cx) * dirx + (cs[a].y - frame.cy) * diry)
      ext = Math.max(ext, (cs[b].x - frame.cx) * dirx + (cs[b].y - frame.cy) * diry)
    }
    return { dirx, diry, ext }
  }

  // Reflect an interior tile across the shared edge to the matching ghost tile
  // of the edge tile — so things land centred on a real tile slot there.
  function ghostPos(tile, i, L, size) {
    const { dirx, diry, ext } = edgeGeom(i, L, size)
    const cp = hexToPixel(L, tile[0], tile[1], size)
    const along = (cp.x - frame.cx) * dirx + (cp.y - frame.cy) * diry
    const px = cp.x - frame.cx - along * dirx // keep any off-axis offset
    const py = cp.y - frame.cy - along * diry
    const back = 2 * ext - along
    return { x: frame.cx + back * dirx + px, y: frame.cy + back * diry + py }
  }

  // Where the cube sits while parked: on the edge tile's matching centre tile.
  const parkedPos = (i, L, size) => ghostPos(sim.edgeCenterOf(i), i, L, size)

  // The two action spots while parked: one on the ghost tile a step along the
  // edge, the other its mirror — the higher is exit-up, the other slide.
  function parkedButtons(L, size) {
    const i = sim.view().parked
    const center = sim.edgeCenterOf(i)
    const c = parkedPos(i, L, size)
    const r = size * 0.5
    const nb = edgeTilesInto(i).find(t => Hex.length([t[0] - center[0], t[1] - center[1]]) === 1)
    let a
    if (nb) {
      a = { ...ghostPos(nb, i, L, size), r }
    } else {
      const { dirx, diry } = edgeGeom(i, L, size)
      const g = size * 1.7
      a = { x: c.x - diry * g, y: c.y + dirx * g, r }
    }
    const b = { x: 2 * c.x - a.x, y: 2 * c.y - a.y, r } // mirror across the cube
    return a.y <= b.y ? { up: a, out: b } : { up: b, out: a }
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

  // While parked: the slide-to-neighbour arrow. (Go-up stays hidden until the
  // parent view is earned.)
  function drawParkedButtons(ctx, L, size, ink) {
    const i = sim.view().parked
    const { dirx, diry } = edgeGeom(i, L, size)
    const b = parkedButtons(L, size)
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.strokeStyle = ink
    ctx.globalAlpha = sim.canSlide(i) ? 0.9 : 0.25
    ctx.lineWidth = 2
    drawArrowStraight(ctx, b.out, dirx, diry)
    ctx.globalAlpha = 1
    ctx.lineCap = "butt"
  }

  // The 6 neighbouring grids' edge tiles. Faint; actionable brighter, hovered
  // brightest; dashed while the mapped parent tile is still undiscovered.
  function drawEdgeTiles(ctx, L, size, ink, exitHover) {
    if (sim.depth() <= BASE_DEPTH) return
    const o = sim.orient()
    const exits = sim.playerExits()
    const reached = sim.reachedExits()
    ctx.lineJoin = "round"
    ctx.strokeStyle = ink
    for (let i = 0; i < 6; i++) {
      if (sim.walled(i)) continue
      const known = sim.parentOf().tile.discovered.has(key(sim.exitTarget(i)))
      if (!known && !reached.has(i)) continue
      const { dirx, diry, ext } = edgeGeom(i, L, size)
      const Dn = 2 * ext + NEIGHBOR_GAP * size
      const ox = Dn * dirx
      const oy = Dn * diry

      const actionable = known ? exits.has(i) && sim.canExit(i) : sim.canDiscoverEdge(i)
      ctx.globalAlpha = exitHover === i ? 0.9 : actionable ? 0.7 : 0.25
      ctx.lineWidth = exitHover === i ? 2 : 1.5
      ctx.setLineDash(known ? [] : [5, 4]) // dashed outline = still undiscovered up top
      for (const e of boundaryEdges) {
        const base = hexToPixel(L, e.q, e.r, size)
        const cs = hexCorners(base.x + ox, base.y + oy, size, o.startDeg)
        const [a, b] = disp().edgeCorners[e.dir]
        ctx.beginPath()
        ctx.moveTo(cs[a].x, cs[a].y)
        ctx.lineTo(cs[b].x, cs[b].y)
        ctx.stroke()
      }
    }
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }

  // ── the frame ──────────────────────────────────────
  // ui: { hovered, hoverPath, exitHover, clockExpanded, replaying, menu,
  //       pending: null | { verb, target, ghostTile, ghostTrail, inflightMin, remainingMin } }
  function draw(ctx, L, ui) {
    const ink = theme("--text", "#eee")
    const surface = theme("--surface", "#111")
    setFrame(L, ui.clockExpanded)
    const size = sizeFor(L)
    const v = sim.view()
    const o = sim.orient()
    const disc = v.tile.discovered

    // hovering a trail tile invalidates the stretch beyond it — the solid trail
    // only draws up to that tile, and the dashed retrace points back at it
    const baseTrail = ui.pending?.ghostTrail || v.trail
    const hovTrailIdx = ui.hovered && v.parked < 0 && !ui.pending ? sim.trailIndexOf(ui.hovered) : -1
    const trail = hovTrailIdx >= 0 ? baseTrail.slice(0, hovTrailIdx + 1) : baseTrail
    const trailKeys = new Set(baseTrail.map(t => key(t)))

    // explored tiles filled; scoutable neighbours as faint dots (step-in
    // choices while parked)
    const dots = v.parked >= 0 ? new Set(edgeTilesInto(v.parked).map(t => key(t))) : sim.reachableDots()
    for (const [q, r] of Hex.range(RINGS)) {
      const k = `${q},${r}`
      const c = hexToPixel(L, q, r, size)
      if (disc.has(k)) {
        const alpha = trailKeys.has(k) ? 0.12 : 0.05 // current trail brighter than past
        fillHex(ctx, c, size, ink, alpha, o.startDeg)
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
    if (ui.hovered && !disc.has(key(ui.hovered)) && dots.has(key(ui.hovered))) {
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

    // single edge mesh, almost invisible; gate edge hidden at the base; only
    // edges touching a discovered tile draw (outlines the known area)
    ctx.strokeStyle = ink
    ctx.lineWidth = 1
    ctx.globalAlpha = 0.12
    for (const e of edges) {
      if (v.isBase && e.key === gateEdgeKey) continue
      const nbr = `${e.q + DIRS[e.dir].q},${e.r + DIRS[e.dir].r}`
      if (!disc.has(`${e.q},${e.r}`) && !disc.has(nbr)) continue
      const c = hexToPixel(L, e.q, e.r, size)
      const cs = hexCorners(c.x, c.y, size, o.startDeg)
      const [a, b] = disp().edgeCorners[e.dir]
      ctx.beginPath()
      ctx.moveTo(cs[a].x, cs[a].y)
      ctx.lineTo(cs[b].x, cs[b].y)
      ctx.stroke()
    }
    ctx.globalAlpha = 1

    // walls (a tile prop): sealed perimeter edges drawn bold. An edge is open
    // only if the space across it is covered by an open neighbour's DRAWN
    // silhouette — probed 1.4 apothems beyond the midpoint (the flush snapped
    // placement makes shallower probes degenerate; see baseline history).
    if (v.tile.walls) {
      const openOffsets = []
      for (let i = 0; i < 6; i++) {
        if (sim.walled(i)) continue
        const g = edgeGeom(i, L, size)
        const Dn = 2 * g.ext + NEIGHBOR_GAP * size
        openOffsets.push({ ox: Dn * g.dirx, oy: Dn * g.diry })
      }
      ctx.strokeStyle = ink
      ctx.globalAlpha = 0.7
      ctx.lineWidth = 3
      for (const e of boundaryEdges) {
        if (!disc.has(`${e.q},${e.r}`)) continue
        const c = hexToPixel(L, e.q, e.r, size)
        const cs = hexCorners(c.x, c.y, size, o.startDeg)
        const [a, b] = disp().edgeCorners[e.dir]
        const mx = (cs[a].x + cs[b].x) / 2
        const my = (cs[a].y + cs[b].y) / 2
        const px = mx + (mx - c.x) * 1.4
        const py = my + (my - c.y) * 1.4
        const open = openOffsets.some(off => {
          const h = pixelToHex(L, px - off.ox, py - off.oy, size)
          return inBounds(h.q, h.r)
        })
        if (open) continue
        ctx.beginPath()
        ctx.moveTo(cs[a].x, cs[a].y)
        ctx.lineTo(cs[b].x, cs[b].y)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    // home tile (base): bumped outline, gate edge left open
    if (v.isBase) {
      const hc0 = hexToPixel(L, 0, 0, size)
      const hcs = hexCorners(hc0.x, hc0.y, size, o.startDeg)
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

    // link from the edge we came in through to where we stepped in
    if (v.parked < 0 && v.fromEdge >= 0 && trail.length) {
      const e0 = parkedPos(v.fromEdge, L, size)
      const t0 = hexToPixel(L, trail[0][0], trail[0][1], size)
      ctx.strokeStyle = ink
      ctx.globalAlpha = 0.45
      ctx.lineWidth = 1.5
      ctx.lineCap = "round"
      ctx.beginPath()
      ctx.moveTo(e0.x, e0.y)
      ctx.lineTo(t0.x, t0.y)
      ctx.stroke()
      ctx.lineCap = "butt"
      ctx.globalAlpha = 1
    }

    // walked to an edge and parked there: link the trail's end to the edge, so
    // the committed path visibly reaches the edge instead of stopping short
    if (v.parked >= 0 && trail.length) {
      const e0 = parkedPos(v.parked, L, size)
      const t = trail[trail.length - 1]
      const t0 = hexToPixel(L, t[0], t[1], size)
      ctx.strokeStyle = ink
      ctx.globalAlpha = 0.45
      ctx.lineWidth = 1.5
      ctx.lineCap = "round"
      ctx.beginPath()
      ctx.moveTo(t0.x, t0.y)
      ctx.lineTo(e0.x, e0.y)
      ctx.stroke()
      ctx.lineCap = "butt"
      ctx.globalAlpha = 1
    }

    // parked: dashed link from the cube to the hover route's entry tile
    if (v.parked >= 0 && ui.hoverPath && ui.hoverPath.length) {
      const e0 = parkedPos(v.parked, L, size)
      const t0 = hexToPixel(L, ui.hoverPath[0][0], ui.hoverPath[0][1], size)
      ctx.save()
      ctx.strokeStyle = ink
      ctx.globalAlpha = 0.45
      ctx.lineWidth = 1.5
      ctx.lineCap = "round"
      ctx.setLineDash([5, 5])
      ctx.beginPath()
      ctx.moveTo(e0.x, e0.y)
      ctx.lineTo(t0.x, t0.y)
      ctx.stroke()
      ctx.restore()
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
    if (v.tile.safe && disc.has("0,0")) {
      const hc = hexToPixel(L, 0, 0, size)
      drawCube(ctx, hc.x, hc.y, size * 2, ink, surface, o.startDeg, true)
    }

    // edge tiles, then the cube on top (the enter double-wedge is parked —
    // its actions live on the radial menu now)
    drawEdgeTiles(ctx, L, size, ink, ui.exitHover)
    const cubeTile = ui.pending?.ghostTile || v.player
    const pc = v.parked >= 0 ? parkedPos(v.parked, L, size) : hexToPixel(L, cubeTile[0], cubeTile[1], size)
    drawCube(ctx, pc.x, pc.y, size, ink, surface, o.startDeg)
    if (v.parked >= 0) drawParkedButtons(ctx, L, size, ink)

    // radial action menu: 6 hex slots ringing the player tile, styled apart
    // from the board (opaque fill + bright outline). Actions fill from the
    // top, clockwise.
    menuBtns = []
    if (ui.menu && !(v.parked >= 0)) {
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
        for (let k = 0; k < 6; k++) (k ? ctx.lineTo : ctx.moveTo).call(ctx, cs[k].x, cs[k].y)
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
      action = {
        text: `+${Math.round(sim.pathCost(ui.hoverPath))} walking to [${ui.hovered[0]},${ui.hovered[1]}]`,
        committed: false
      }
    } else if (ui.hovered && sim.isFrontier(ui.hovered) && sim.canScout(ui.hovered)) {
      action = { text: `+${Math.round(sim.scoutCost())} scouting [${ui.hovered[0]},${ui.hovered[1]}]`, committed: false }
    } else if (ui.exitHover >= 0) {
      const t = sim.exitTarget(ui.exitHover)
      const known = sim.parentOf().tile.discovered.has(key(t))
      if (!known) {
        action = { text: `+${Math.round(sim.discoverEdgeCost())} discovering [${t[0]},${t[1]}]`, committed: false }
      } else {
        // clicking walks to the edge and parks (free); the slide cost shows once parked
        const best = sim.bestPathToEdge(ui.exitHover)
        const c = best ? (best.length - 1) * sim.stepCost() : 0
        action = best ? { text: `+${Math.round(c)} to the [${t[0]},${t[1]}] edge`, committed: false } : null
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
    parkedButtons,
    playButton: L => timeline.playButton(L),
    homeButtons: () => timeline.homeButtons(),
    menuBtns: () => menuBtns
  }
}
