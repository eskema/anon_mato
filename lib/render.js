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
import { RINGS, SEAM_RING, VIEW_RING, BASE_DEPTH, ENERGY_START, WATER_LEVEL } from "./sim.js"
import { createTimeline } from "./timeline.js"
import { drawIcon } from "./icons.js"
import { drawStatsPanel, roundRect } from "./radial.js"

const key = Hex.key
const eq = Hex.equals

// biome palette (matches world.html) — the derived land's look in play, as
// RGB so we can shade each tile by its height for diversity
const BIOME_RGB = {
  water: [63, 127, 190],
  beach: [217, 197, 138],
  marsh: [63, 125, 95],
  plain: [143, 191, 94],
  forest: [51, 105, 30],
  mountain: [138, 135, 125],
  cliff: [93, 106, 114],
  peak: [240, 237, 228]
}
const lerpRGB = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t)
]
// shade an rgb toward white (f>0) or black (f<0), |f|<=1
const shadeRGB = (c, f) => (f >= 0 ? lerpRGB(c, [255, 255, 255], f) : lerpRGB(c, [0, 0, 0], -f))

// A tile's colour: water reads as depth (deep→shallow over the smoothed
// field, like world.html); land nudges its biome lighter/darker by its
// height so ranges and slopes get a little variation instead of flat fills.
function biomeColor(biome, raw, smooth) {
  if (biome === "water") {
    const t = Math.max(0, Math.min(1, smooth / WATER_LEVEL)) // 0 deep, 1 at the shoreline
    return `rgb(${lerpRGB([12, 68, 124], [110, 170, 220], t)})`
  }
  const base = BIOME_RGB[biome]
  if (!base) return null
  const f = raw == null ? 0 : Math.max(-1, Math.min(1, (raw - 7.5) / 7.5)) * 0.16
  return `rgb(${shadeRGB(base, f)})`
}

// the identity view: a pubkey nibble rendered in the terrain palette — the
// key as land, same bands as the world (water <4, flats, mountains ≥12), so
// home reads in the world's visual language while showing WHO you are
function nibbleColor(v) {
  const lerp = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t))
  let c
  if (v < 4) c = lerp([12, 68, 124], [91, 155, 216], v / 4)
  else if (v >= 12) c = lerp([138, 135, 125], [240, 237, 228], (v - 12) / 3)
  else c = lerp([143, 191, 94], [186, 117, 23], (v - 4) / 8)
  return `rgb(${c})`
}

// ── shared icon painters (also used by the style guide) ──────────────
// The player: a regular hexagon (half a tile wide) with a filled background
// plus three inner lines from alternating vertices to the center — reads as an
// iso cube (NOT shaded/3D). The inverted set reads as an open cube / floor
// (the home-centre special tile).
export function drawCube(ctx, cx, cy, size, ink, surface, startDeg, invert = false, alpha = 1) {
  const r = size * 0.5 // half the width of a grid tile
  const c = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i + startDeg)
    c.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  ctx.beginPath()
  c.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])))
  ctx.closePath()
  ctx.globalAlpha = alpha
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
  ctx.globalAlpha = 1
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

// "#rgb"/"#rrggbb" → "rgba(r,g,b,a)" — canvas gradient stops need the alpha
// baked into the colour string.
function rgba(hex, a) {
  let h = hex.trim().replace("#", "")
  if (h.length === 3) h = [...h].map(ch => ch + ch).join("")
  const n = parseInt(h, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
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
  let menuLayout = null // last radial-menu layout (hit list), refreshed each draw
  let blurCanvas = null // reused offscreen for the menu's world blur (avoid per-frame allocation)

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
  let camLastT = 0 // for the eased slide between camera anchors
  function setCam(anchor, size, direct = false) {
    const centre = !direct && anchor ? sim.boardCentreOf(anchor) : null
    camAnchor = centre || anchor || [0, 0]
    const f = sim.orient().f
    const target = {
      x: size * (f[0] * camAnchor[0] + f[1] * camAnchor[1]),
      y: size * (f[2] * camAnchor[0] + f[3] * camAnchor[1])
    }
    // ease toward the target (exponential, ~120ms time constant) so anchor
    // changes — menu centring, crossings, seam walks — slide instead of snap
    const now = performance.now()
    const dt = camLastT ? Math.min(100, now - camLastT) : Infinity
    camLastT = now
    if (dt === Infinity) {
      cam = target // very first frame: no glide into existence
      return
    }
    const k = 1 - Math.exp(-dt / 120)
    cam = { x: cam.x + (target.x - cam.x) * k, y: cam.y + (target.y - cam.y) * k }
    if (Math.hypot(target.x - cam.x, target.y - cam.y) < 0.4) cam = target
    camTargetPos = target
  }
  let camTargetPos = null
  const camAnimating = () => !!camTargetPos && (cam.x !== camTargetPos.x || cam.y !== camTargetPos.y)

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
  // ui: { hovered, hoverPath, hoverRetrace, clockExpanded, logsOpen, replaying, menu, statsPanel,
  //       pending: null | { verb, target, ghostTile, ghostTrail, inflightMin, remainingMin } }
  function draw(ctx, L, ui) {
    const ink = theme("--text", "#eee")
    const surface = theme("--surface", "#111")
    setFrame(L, ui.clockExpanded)
    const size = sizeFor()
    const v = sim.view()
    const o = sim.orient()
    // seam view follows the walker; an OPEN MENU centres the player too (the
    // board slides, seam-style) so the fanned items always have room
    setCam(ui.pending?.ghostTile || v.player, size, !!ui.menu)

    // the sun: one step per day around the 360-day year, on the SAME 0°=up
    // clockwise wheel as the angle — and the day's hue (day n wears hue n°,
    // so the year walks the colour wheel, passing each player's own colour
    // once). Elements cast hue-tinted shadows away from it; the HOUR raises
    // and lowers the sun — shadows stretch at the day's ends (06:00/22:00)
    // and shrink toward its middle (14:00). Length only, never rotation.
    const inflight = ui.pending ? ui.pending.inflightMin : 0
    const liveEnergy = sim.energy() - inflight
    const spent = ENERGY_START - liveEnergy
    // spendable budget = raw energy minus the reserve to reach a rest spot; this
    // is the "m until rest" the status line shows, and it's what the player's
    // water level tracks so the cup runs dry exactly as the budget hits zero
    const reserved = ui.pending?.ghostTile
      ? v.tile.safe
        ? 0
        : sim.returnFrom(ui.pending.ghostTile)
      : sim.returnCost()
    const freeEnergy = liveEnergy - reserved
    const sunDeg = (sim.day() - 1) % 360
    const sunRad = (sunDeg * Math.PI) / 180
    const sunLen = 3 + 7 * Math.min(1, Math.abs(6 + spent / 60 - 14) / 8)
    const castShadow = on => {
      if (on) {
        ctx.shadowColor = `hsla(${sunDeg}, 70%, 45%, 0.45)`
        ctx.shadowOffsetX = -Math.sin(sunRad) * sunLen
        ctx.shadowOffsetY = Math.cos(sunRad) * sunLen
        ctx.shadowBlur = 1.5
      } else {
        ctx.shadowColor = "transparent"
        ctx.shadowOffsetX = ctx.shadowOffsetY = ctx.shadowBlur = 0
      }
    }

    // hovering a trail tile with an affordable retrace invalidates the stretch
    // beyond it — the solid trail only draws up to that tile, and the dashed
    // retrace points back at it. A fallback (non-retrace) route leaves the
    // trail whole: the walk merely passes by.
    const baseTrail = ui.pending?.ghostTrail || v.trail
    const hovTrailIdx = ui.hovered && ui.hoverRetrace && !ui.pending ? sim.trailIndexOf(ui.hovered) : -1
    const trail = hovTrailIdx >= 0 ? baseTrail.slice(0, hovTrailIdx + 1) : baseTrail

    // the angle line: the seed angle's ray out of the home centre (global
    // origin), off past any screen edge — the same ray that seeds the gate.
    // Drawn UNDER the ground: discovered tiles paint an opaque base coat
    // over it, so the ray only shows in the fog, poking out beyond the
    // explored edge — wherever you are, home points at you.
    {
      const rad = (sim.angle() * Math.PI) / 180
      const len = 2 * (frame.w + frame.h) // safely past any screen edge, even with the camera away from home
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
        fillHex(ctx, c, size, surface, 1, o.startDeg) // opaque ground — occludes whatever runs under the world (the angle line)
        fillHex(ctx, c, size, ink, 0.05, o.startDeg)
        // which of this tile's edges face the fog (undiscovered ground) —
        // those edges lose their crisp border and bleed outward instead
        let fogBits = 0
        for (let d = 0; d < 6; d++) {
          if (!sim.isDiscovered([h[0] + DIRS[d].q, h[1] + DIRS[d].r])) fogBits |= 1 << d
        }
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
          // HOME is the identity AND the minimap: the pubkey inscription in
          // terrain colours, dimmed while the corresponding board is still
          // undiscovered, and overlaid with that board's discovered interior
          // as miniature hexes — the floor gains detail as the world does.
          // Everywhere else: the derived terrain's biome colour straight from
          // the world key (keyless dev worlds fall through to plain ink).
          const chs = sim.nibbleAt(h)
          if (chs != null && h[0] === 0 && h[1] === 0) {
            // the centre of home is simply YOURS: the angle's hue, no map
            fillHex(ctx, c, size, `hsl(${sim.angle()} 70% 55%)`, 0.85, o.startDeg)
          } else if (chs != null) {
            const v = [...chs].reduce((s, c2) => s + parseInt(c2, 16), 0) / chs.length
            const parent = sim.parentOf().tile
            const lk = key(h) // home sits at the global origin: local == global
            // a board you've never set foot on shows as grey fog — its colour
            // (and its miniature) are earned by going there
            if (parent.discovered.has(lk)) fillHex(ctx, c, size, nibbleColor(v), 0.85, o.startDeg)
            else fillHex(ctx, c, size, ink, 0.1, o.startDeg)
            const node = parent.children[lk]
            if (node && node.discovered.size) {
              const centre = sim.centreOf(h)
              const ss = size / 9.5
              for (const dk of node.discovered) {
                const [lq, lr] = dk.split(",").map(Number)
                const g2 = [centre[0] + lq, centre[1] + lr]
                const pal = biomeColor(sim.typeNameAt(g2), sim.heightAt(g2), sim.smoothAt(g2))
                if (!pal) continue
                fillHex(
                  ctx,
                  { x: c.x + Math.sqrt(3) * (lq + lr / 2) * ss, y: c.y + 1.5 * lr * ss },
                  ss,
                  pal,
                  0.95,
                  o.startDeg
                )
              }
            }
          } else if (sim.worldKey()) {
            const pal = biomeColor(sim.typeNameAt(h), sim.heightAt(h), sim.smoothAt(h))
            if (pal) fillHex(ctx, c, size, pal, 1, o.startDeg)
          }
          // every tile draws its OWN border, grown inward — never leaves its
          // own polygon, so nothing paints over a neighbour or the seam
          const cs = hexCorners(c.x, c.y, size * inset, o.startDeg)
          ctx.strokeStyle = ink
          ctx.globalAlpha = 0.12
          ctx.lineWidth = 1
          ctx.beginPath()
          for (let d = 0; d < 6; d++) {
            if ((fogBits >> d) & 1) continue // fog edges get the soft rim, not a line
            const [ca, cb] = disp().edgeCorners[d]
            ctx.moveTo(cs[ca].x, cs[ca].y)
            ctx.lineTo(cs[cb].x, cs[cb].y)
          }
          ctx.stroke()
          ctx.globalAlpha = 1
        }
        // the blurry frontier: fog-facing edges bleed the tint outward, a
        // gradient quad fading into the undiscovered ground. It lives entirely
        // in the fog cell, so it never paints over drawn tiles.
        if (fogBits) {
          const cf = hexCorners(c.x, c.y, size, o.startDeg)
          const g = size * 0.6
          const ext = p => {
            const l = Math.hypot(p.x - c.x, p.y - c.y) || 1
            return { x: p.x + ((p.x - c.x) / l) * g, y: p.y + ((p.y - c.y) / l) * g }
          }
          ctx.globalAlpha = 1
          for (let d = 0; d < 6; d++) {
            if (!((fogBits >> d) & 1)) continue
            const [ca, cb] = disp().edgeCorners[d]
            const A = cf[ca]
            const B = cf[cb]
            const A2 = ext(A)
            const B2 = ext(B)
            const mx = (A.x + B.x) / 2
            const my = (A.y + B.y) / 2
            const ml = Math.hypot(mx - c.x, my - c.y) || 1
            const grad = ctx.createLinearGradient(mx, my, mx + ((mx - c.x) / ml) * g, my + ((my - c.y) / ml) * g)
            grad.addColorStop(0, rgba(ink, 0.05))
            grad.addColorStop(1, rgba(ink, 0))
            ctx.fillStyle = grad
            ctx.beginPath()
            ctx.moveTo(A.x, A.y)
            ctx.lineTo(B.x, B.y)
            ctx.lineTo(B2.x, B2.y)
            ctx.lineTo(A2.x, A2.y)
            ctx.closePath()
            ctx.fill()
          }
        }
        // walls: bold inward edges wherever a hex owns them — a closed gate
        // reads as wall until the board is cleared
        const bits = sim.wallsAt(h)
        if (bits) {
          const cw = hexCorners(c.x, c.y, size * wInset, o.startDeg)
          ctx.strokeStyle = ink
          ctx.globalAlpha = 0.7
          ctx.lineWidth = 3
          castShadow(true)
          for (let d = 0; d < 6; d++) {
            if (!((bits >> d) & 1)) continue
            const [ca, cb] = disp().edgeCorners[d]
            ctx.beginPath()
            ctx.moveTo(cw[ca].x, cw[ca].y)
            ctx.lineTo(cw[cb].x, cw[cb].y)
            ctx.stroke()
          }
          castShadow(false)
          ctx.globalAlpha = 1
        }
      }
      // the player's own frontier dots
      for (const k of dots) {
        const [q, r] = k.split(",").map(Number)
        const c = hexToPixel(L, q, r, size)
        ctx.fillStyle = ink
        ctx.globalAlpha = 0.55
        ctx.beginPath()
        ctx.arc(c.x, c.y, 2.5, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }

    // the sun dial — a ring around the whole board, an integral part of the
    // map (it follows the camera's board; on the seam it rings the walker).
    // The dot is the sun: one step per day, wearing the day's hue.
    {
      const cc = hexToPixel(L, camAnchor[0], camAnchor[1], size)
      const r = size * Math.sqrt(3) * (SEAM_RING + 0.7)
      ctx.strokeStyle = ink
      ctx.globalAlpha = 0.15
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(cc.x, cc.y, r, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 1
      ctx.fillStyle = `hsl(${sunDeg} 70% 55%)`
      ctx.beginPath()
      ctx.arc(cc.x + Math.sin(sunRad) * r, cc.y - Math.cos(sunRad) * r, 6, 0, Math.PI * 2)
      ctx.fill()
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
        if (d === sim.gateDir()) continue
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

    // ── the nested-cube grammar (reference sheet 2026-07-07) ────────────
    // Bold outlines (weight W), thin interiors (0.2·W). Levels concentric
    // with ALIGNED corners, in thirds: tile (R) ⊃ player (2R/3) ⊃ figure
    // (R/3). Thin radial segments connect consecutive levels' corners; the
    // innermost level carries the identity — the player's bold Y (arms R/3),
    // a figure's thin cube lines, or the bold-Y "seat" stub on an empty
    // resting tile. The tile ring is unfilled: its background is the tile.
    const W = Math.max(1.5, size * 0.1)
    const hexPts = (x, y, r) => {
      const pts = []
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 180) * (60 * i + o.startDeg)
        pts.push([x + r * Math.cos(a), y + r * Math.sin(a)])
      }
      return pts
    }
    const boldHex = (x, y, r, fill, lw = W) => {
      const pts = hexPts(x, y, r)
      ctx.beginPath()
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])))
      ctx.closePath()
      if (fill) {
        ctx.fillStyle = surface
        ctx.fill()
      }
      ctx.strokeStyle = ink
      ctx.lineWidth = lw
      ctx.lineJoin = "round"
      ctx.stroke()
    }
    const thinSegs = (x, y, r1, r2, idxs = [0, 1, 2, 3, 4, 5]) => {
      const a1 = hexPts(x, y, r1)
      const a2 = r2 > 0 ? hexPts(x, y, r2) : null
      ctx.strokeStyle = ink
      ctx.lineWidth = W * 0.2
      ctx.beginPath()
      for (const i of idxs) {
        ctx.moveTo(a1[i][0], a1[i][1])
        ctx.lineTo(a2 ? a2[i][0] : x, a2 ? a2[i][1] : y)
      }
      ctx.stroke()
    }
    const boldY = (x, y, len, invert = false) => {
      const pts = hexPts(x, y, len)
      ctx.strokeStyle = ink
      ctx.lineWidth = W
      ctx.lineCap = "round"
      ctx.beginPath()
      for (const i of invert ? [1, 3, 5] : [0, 2, 4]) {
        ctx.moveTo(x, y)
        ctx.lineTo(pts[i][0], pts[i][1])
      }
      ctx.stroke()
    }
    // The player is a POINTY-top isometric cube (a cup) — its own glyph, drawn
    // the same whichever way the tiles sit. A lighter angle-hue lid, two darker
    // side faces, and the day's spendable budget shown as liquid: a diamond
    // surface (the lid's shape) that sinks straight down as the budget drains,
    // the side faces filling darker below it. A full white backing keeps the
    // sun's shadow strictly on the outside; the bold Y is its identity.
    const S3 = 0.8660254 // √3/2 — the pointy hex's horizontal reach
    const drawEnergyCube = (x, y, r) => {
      const w = r * S3 // lid/surface diamond half-width
      const h = r / 2 // …and half-height (the pointy hex's side vertices sit at ±h)
      const hue = sim.angle()
      // sun-lit faces: each of the cube's three faces brightens as it turns to
      // face the sun and darkens on the shadow side — using the SAME sun azimuth
      // that aims the cast shadow (sunRad), so the shading rotates with it. The
      // face screen-normals are up (lid), down-right, down-left.
      const lit = (nx, ny, baseL, swing) => {
        const d = nx * Math.sin(sunRad) - ny * Math.cos(sunRad) // ·(toward-sun screen dir)
        return `hsl(${hue} ${swing > 6 ? 58 : 68}% ${Math.max(20, Math.min(80, baseL + d * swing))}%)`
      }
      const lidCol = lit(0, -1, 62, 4) // the top face is sky-lit — a gentle swing, always the brightest
      const rightCol = lit(S3, 0.5, 46, 9)
      const leftCol = lit(-S3, 0.5, 46, 9)
      const hex = () => {
        ctx.beginPath()
        ctx.moveTo(x, y - r) // top peak
        ctx.lineTo(x + w, y - h) // upper-right
        ctx.lineTo(x + w, y + h) // lower-right
        ctx.lineTo(x, y + r) // bottom point
        ctx.lineTo(x - w, y + h) // lower-left
        ctx.lineTo(x - w, y - h) // upper-left
        ctx.closePath()
      }
      // 1) opaque white backing — the shadow it casts stays exterior
      castShadow(true)
      hex()
      ctx.fillStyle = surface
      ctx.globalAlpha = 1
      ctx.fill()
      castShadow(false)
      // 2) the liquid, clipped to the cube
      const frac = Math.max(0, Math.min(1, freeEnergy / ENERGY_START))
      if (frac > 0) {
        // surface centre: full → the lid's centre (y − h); empty → the bottom point
        const yc = y + r - 1.5 * r * frac
        ctx.save()
        hex()
        ctx.clip()
        // the two side faces below the surface, split down the front edge (x) so
        // each takes its own sun-lit shade
        ctx.beginPath()
        ctx.moveTo(x, yc + h) // front-bottom corner (the near dip)
        ctx.lineTo(x + w, yc)
        ctx.lineTo(x + w, y + r)
        ctx.lineTo(x, y + r)
        ctx.closePath()
        ctx.fillStyle = rightCol
        ctx.fill()
        ctx.beginPath()
        ctx.moveTo(x, yc + h)
        ctx.lineTo(x - w, yc)
        ctx.lineTo(x - w, y + r)
        ctx.lineTo(x, y + r)
        ctx.closePath()
        ctx.fillStyle = leftCol
        ctx.fill()
        // the surface diamond — the descending lid (sky-lit)
        ctx.beginPath()
        ctx.moveTo(x, yc - h)
        ctx.lineTo(x + w, yc)
        ctx.lineTo(x, yc + h)
        ctx.lineTo(x - w, yc)
        ctx.closePath()
        ctx.fillStyle = lidCol
        ctx.fill()
        ctx.restore()
      }
      // 3) the bold outline
      hex()
      ctx.strokeStyle = ink
      ctx.lineWidth = W
      ctx.lineJoin = "round"
      ctx.stroke()
      // 4) the identity Y — two arms up to the side faces, a stem down the front edge
      const ell = r / 2
      ctx.strokeStyle = ink
      ctx.lineWidth = W
      ctx.lineCap = "round"
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + ell * S3, y - ell / 2)
      ctx.moveTo(x, y)
      ctx.lineTo(x - ell * S3, y - ell / 2)
      ctx.moveTo(x, y)
      ctx.lineTo(x, y + ell)
      ctx.stroke()
    }

    // one resting tile's full stack, by who's on it
    const drawStack = (x, y, hasPlayer, hasNpc) => {
      boldHex(x, y, size, false, 0.5) // the special-tile ring — a hairline; background = the tile itself
      let prev = size
      if (hasPlayer) {
        drawEnergyCube(x, y, size * (2 / 3)) // the cup — its own pointy glyph, carries its Y
        prev = size * (2 / 3)
      }
      if (hasNpc) {
        thinSegs(x, y, prev, size / 3)
        boldHex(x, y, size / 3, true)
        thinSegs(x, y, size / 3, 0, [0, 2, 4]) // the figure's thin cube lines
      } else if (!hasPlayer) {
        thinSegs(x, y, prev, 0) // empty seat: thin radials all the way in…
        boldY(x, y, size / 3, true) // …and the seat stub — a FLOOR, so inverted
      }
    }

    const cubeTile = ui.pending?.ghostTile || v.player
    // the CURRENT tile — wherever you stand — wears a 1pt full-ink border
    {
      const cp0 = hexToPixel(L, cubeTile[0], cubeTile[1], size)
      const cs0 = hexCorners(cp0.x, cp0.y, size, o.startDeg)
      ctx.beginPath()
      cs0.forEach((pt, k2) => (k2 ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)))
      ctx.closePath()
      ctx.strokeStyle = ink
      ctx.globalAlpha = 1
      ctx.lineWidth = 1
      ctx.stroke()
    }
    let playerDrawn = false
    for (const bc of Hex.range(RINGS)) {
      const centre = sim.centreOf(bc)
      if (!sim.isDiscovered(centre)) continue
      const cp = hexToPixel(L, centre[0], centre[1], size)
      if (cp.x < -size * 2 || cp.x > L.w + size * 2 || cp.y < -size * 2 || cp.y > L.h + size * 2) continue
      const here = eq(centre, cubeTile)
      drawStack(cp.x, cp.y, here, !!sim.npcAt(bc))
      if (here) playerDrawn = true
    }
    // the player anywhere else: the standalone cup
    if (!playerDrawn) {
      const pc = hexToPixel(L, cubeTile[0], cubeTile[1], size)
      drawEnergyCube(pc.x, pc.y, size * (2 / 3))
    }

    // the radial menu — laid out on the REAL hex grid (6 slots on the
    // player's neighbours; a folder fans onto outward cells, ≤3 then ≤5 = 8).
    // Z-order, lowest first: blurred map → menu → tile → player → npc (the
    // last three arrive together as the punched-out sharp redraw, ON TOP of
    // the menu — the player/figure stacking is already in the snapshot).
    menuLayout = null
    if (ui.menu) {
      const P = v.player
      const hub = hexToPixel(L, P[0], P[1], size)

      // blur + dim the whole world (the sharp tile is punched back AFTER the
      // menu is drawn, so it sits above the silhouette)
      const cv = ctx.canvas
      if (!blurCanvas) blurCanvas = document.createElement("canvas")
      const snap = blurCanvas
      snap.width = cv.width
      snap.height = cv.height
      snap.getContext("2d").drawImage(cv, 0, 0)
      ctx.save()
      ctx.filter = "blur(6px)"
      ctx.drawImage(snap, 0, 0, L.w, L.h)
      ctx.filter = "none"
      ctx.globalAlpha = 0.22
      ctx.fillStyle = surface
      ctx.fillRect(0, 0, L.w, L.h)
      ctx.restore()

      const pc = hub
      // screen angle of a cell from the player: 0 at top, clockwise
      const ang = cell => {
        const q = hexToPixel(L, cell[0], cell[1], size)
        return (Math.atan2(q.x - pc.x, -(q.y - pc.y)) + Math.PI * 2) % (Math.PI * 2)
      }
      const angDiff = (a, b) => {
        let d = Math.abs(a - b) % (Math.PI * 2)
        return d > Math.PI ? Math.PI * 2 - d : d
      }
      const neigh = DIRS.map(d => [P[0] + d.q, P[1] + d.r])
      const ring1 = neigh.slice().sort((a, b) => ang(a) - ang(b))
      const used = new Set([key(P)])
      const cells = [] // { node, cell, child }
      const self = ui.menu.self || []
      const them = ui.menu.them || []
      // slots: skills pin to the DIRECT-left/right cells; the rest of self
      // fills the left side, them the right (full ring when nothing faces us)
      const cellX = cell => hexToPixel(L, cell[0], cell[1], size).x
      const cellY = cell => hexToPixel(L, cell[0], cell[1], size).y
      const claim = (n, cell, child) => {
        if (!cell || used.has(key(cell))) return false
        cells.push({ node: n, cell, child })
        used.add(key(cell))
        return true
      }
      const pinnedCell = n =>
        n.slot === "W" ? [P[0] - 1, P[1]] : n.slot === "E" ? [P[0] + 1, P[1]] : null
      for (const n of [...self, ...them]) if (n.slot) claim(n, pinnedCell(n))
      const free = side =>
        ring1
          .filter(c => !used.has(key(c)) && (side === 0 || Math.sign(cellX(c) - pc.x) === side))
          .sort((a, b) => cellY(a) - cellY(b))
      for (const n of them) if (!n.slot) claim(n, free(1)[0])
      for (const n of self) if (!n.slot) claim(n, free(them.length ? -1 : 0)[0])

      // the open folder fans its children onto outward cells: the (≤3) ring-2
      // cells beyond its slot, then (≤5) ring-3 past those — 8 = two full rows.
      // Only cells that actually receive a child join the silhouette (snug fit).
      const open = cells.find(c => c.node.id === ui.menu.openId)
      let folderCells = null
      if (open && open.node.children?.length) {
        const r2 = Hex.neighbors(open.cell)
          .filter(c => Hex.distance(P, c) === 2 && !used.has(key(c)))
          .sort((a, b) => angDiff(ang(a), ang(open.cell)) - angDiff(ang(b), ang(open.cell)))
          .slice(0, 3)
        const r3 = []
        for (const c of r2)
          for (const n of Hex.neighbors(c))
            if (Hex.distance(P, n) === 3 && !r3.some(x => eq(x, n))) r3.push(n)
        r3.sort((a, b) => angDiff(ang(a), ang(open.cell)) - angDiff(ang(b), ang(open.cell)))
        const outCells = [...r2, ...r3.slice(0, 5)]
        folderCells = [open.cell]
        open.node.children.forEach((n, i) => {
          if (outCells[i] && claim(n, outCells[i], true)) folderCells.push(outCells[i])
        })
      }

      // background silhouettes — occupied cells as oversized hexes in ONE
      // path each (no seams), ~quarter-tile padding. The open folder's group
      // gets its own snug silhouette with a darker thin border around it.
      const silhouette = cellList => {
        ctx.beginPath()
        for (const cell of cellList) {
          const cp2 = hexToPixel(L, cell[0], cell[1], size)
          const cs = hexCorners(cp2.x, cp2.y, size * 1.25, o.startDeg)
          cs.forEach((pt, k2) => (k2 ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)))
          ctx.closePath()
        }
      }
      // rim trick: stroke the union path first (2px, half in half out), then
      // fill it — the fill covers the inner half and every internal edge, so
      // only a crisp ~1px outer border survives around the union
      // the silhouette card: drop shadow under the union, then a 1pt white
      // (surface) border — internal stroke edges vanish into the same-colour
      // fill, so only the outer boundary reads
      const rimmed = cellList => {
        silhouette(cellList)
        ctx.save()
        ctx.shadowColor = "rgba(0,0,0,0.28)"
        ctx.shadowBlur = 12
        ctx.shadowOffsetY = 3
        ctx.fillStyle = surface
        ctx.globalAlpha = 0.97
        ctx.fill()
        ctx.restore()
        ctx.strokeStyle = surface
        ctx.globalAlpha = 1
        ctx.lineWidth = 1
        ctx.stroke()
      }
      ctx.save()
      rimmed([P, ...cells.filter(c => !c.child).map(c => c.cell)])
      if (folderCells) rimmed(folderCells)
      ctx.restore()

      // the item hexes. When a folder is open, the previous level (ring-1,
      // save the open folder itself) fades so focus falls on the new items.
      const dimPrev = ui.menu.openId != null
      const hits = []
      for (const c of cells) {
        const p = hexToPixel(L, c.cell[0], c.cell[1], size)
        const open2 = c.node.id === ui.menu.openId
        const focus = c.node.id === ui.menu.focusId
        const on = !c.node.disabled
        const faded = dimPrev && !c.child && !open2
        const A = faded ? 0.3 : 1
        // full tile-size hexes — the menu obeys the map's grid exactly
        const cs = hexCorners(p.x, p.y, size, o.startDeg)
        ctx.beginPath()
        for (let k2 = 0; k2 < 6; k2++) (k2 ? ctx.lineTo : ctx.moveTo).call(ctx, cs[k2].x, cs[k2].y)
        ctx.closePath()
        ctx.fillStyle = open2 ? ink : surface
        ctx.globalAlpha = (on ? 1 : 0.6) * A
        ctx.fill()
        ctx.strokeStyle = ink
        ctx.globalAlpha = (on ? 1 : 0.4) * A // full black; states read via fade
        ctx.lineWidth = 0.2
        ctx.stroke()
        ctx.globalAlpha = 1
        drawIcon(ctx, c.node.icon, p.x, p.y, size * 0.42, open2 ? surface : ink, (on ? 0.95 : 0.4) * A)
        if (c.node.badge != null) {
          const bx = p.x + size * 0.5
          const by = p.y - size * 0.5
          ctx.globalAlpha = A
          ctx.beginPath()
          ctx.arc(bx, by, size * 0.28, 0, Math.PI * 2)
          ctx.fillStyle = ink
          ctx.fill()
          ctx.fillStyle = surface
          ctx.font = `600 ${Math.round(size * 0.34)}px system-ui, sans-serif`
          ctx.textAlign = "center"
          ctx.textBaseline = "middle"
          ctx.fillText(String(c.node.badge), bx, by)
          ctx.globalAlpha = 1
        }
        hits.push({ id: c.node.id, node: c.node, x: p.x, y: p.y, r: size * 0.82 })
      }

      // the punched-out tile, ABOVE the menu: clip to EXACTLY the current
      // tile (no oversize — neighbours' borders must not creep in) and
      // redraw it sharp from the snapshot — ground, player, figure stacked
      ctx.save()
      const punch = hexCorners(hub.x, hub.y, size, o.startDeg)
      ctx.beginPath()
      punch.forEach((pt, k2) => (k2 ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)))
      ctx.closePath()
      ctx.clip()
      ctx.drawImage(snap, 0, 0, L.w, L.h)
      ctx.restore()

      // the focused node's label — a fitted pill just outside its hex
      const f = cells.find(c => c.node.id === ui.menu.focusId)
      if (f && f.node.label) {
        const p = hexToPixel(L, f.cell[0], f.cell[1], size)
        const a = ang(f.cell)
        ctx.font = "600 16px system-ui, sans-serif"
        const pw = ctx.measureText(f.node.label).width + 20
        const ph = 26
        let lx = p.x + Math.sin(a) * (size + pw / 2)
        let ly = p.y - Math.cos(a) * (size + ph / 2)
        lx = Math.max(pw / 2 + 4, Math.min(L.w - pw / 2 - 4, lx))
        ly = Math.max(ph / 2 + 4, Math.min(L.h - ph / 2 - 4, ly))
        ctx.globalAlpha = 0.96
        ctx.fillStyle = ink
        roundRect(ctx, lx - pw / 2, ly - ph / 2, pw, ph, 6)
        ctx.fill()
        ctx.fillStyle = surface
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillText(f.node.label, lx, ly)
        ctx.globalAlpha = 1
      }
      menuLayout = { hits }
    }

    // the stats panel (player or a faced figure), a card top-left
    if (ui.statsPanel) drawStatsPanel(ctx, L, { ink, surface, ...ui.statsPanel })

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

    // (helpers used to live bottom-left; they're now a folder in the radial
    // menu — open the menu on the player and pick "helpers".)

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
    camAnimating,
    menuHit: p => {
      if (!menuLayout) return null
      for (const n of menuLayout.hits) if (Math.hypot(p.x - n.x, p.y - n.y) <= n.r) return n
      return null
    }
  }
}
