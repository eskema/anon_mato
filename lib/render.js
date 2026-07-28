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

import { theme, arrowTip, easeSplit } from "./draw.js"
import { DIRS } from "./world.js"
import * as Hex from "./hex.js"
import { RINGS, SEAM_RING, VIEW_RING, BASE_DEPTH, WATER_LEVEL, STAT_NAMES, LESSON_COST, SKILL_INFO, SKILL_CAP } from "./sim.js"
import { drawIcon, SKILL_ICON } from "./icons.js"
import { sunState, moonState, drawMoon, INTRADAY_AXIS, skillWheelPos } from "./clock.js"
import { drawStatsPanel } from "./radial.js"
import { npubEncode } from "./vendor/nostr-nip19.js"

const key = Hex.key
const eq = Hex.equals

// a figure's display NAME — a placeholder read straight off the key: three
// consonant-vowel syllables from the pubkey's first three bytes. Derivable
// by anyone, like everything else about the world's people.
const NAME_C = "bcdfghjklmnprstv"
const NAME_V = "aeiou"
export function npcName(pubkey) {
  let s = ""
  for (let i = 0; i < 3; i++) {
    const b = parseInt(pubkey.slice(i * 2, i * 2 + 2), 16)
    s += NAME_C[b >> 4] + NAME_V[(b & 15) % 5]
  }
  return s[0].toUpperCase() + s.slice(1)
}

// biome palette (matches world.html) — the derived land's look in play, as
// RGB so we can shade each tile by its height for diversity
// per-board offscreen miniatures (see the home minimap in the field pass) —
// keyed by board, stamped by discovery/size/orientation
const miniCache = new Map()
const BIOME_RGB = {
  water: [63, 127, 190],
  beach: [217, 197, 138],
  marsh: [88, 152, 133], // wet teal — reads soggy, well apart from forest's leaf green
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
export function biomeColor(biome, raw, smooth) {
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
export function nibbleColor(v) {
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

// THE NIGHT SKY — the 12 skill CONSTELLATIONS ringing the dial. The whole wheel
// rotates once a year (skillWheelPos) and only the crest arc pokes ABOVE the ring;
// stars = the level dots, lines = the LEARNED wedges (the dashed not-yet edges are
// left off). Night only, and MOON-washed — bright under a new moon, barely on a
// full one. Shared by the game clock and the styles test dial so they can't drift.
// `progressOf(i)` → { sides, filled, partial } for skill i.
export function drawSkillWheel(ctx, { cx, cy, R, size, day, sunAlt, moonIllum, ink, dotInk = ink, glyphInk = ink, progressOf, w, h }) {
  const iconR = size / 0.9
  const ringR = iconR * 0.9 // the level polygon's radius (= the menu ring's)
  const dotR = size * 0.04 // tinier stars in the sky — the menu ring's dots are bigger
  const lift = size * 1.3 // the tip floats the WHOLE featured figure a bit above the ring
  const sink = size * 1.2 // the body tucks just inside the ring — hidden in the sky, "nearly touching" in the menu
  const spout = 12 // teardrop sharpness — bigger = tighter tip, fewer skills diverge out
  const vis = Math.max(0, -sunAlt) * (1 - 0.85 * moonIllum) // day / full moon → ~0
  if (vis <= 0.02) return
  ctx.save()
  // SHARP CLIP to OUTSIDE the ring — everything below the horizon is cut, so the
  // constellations rise cleanly over it (crest fully out, the rest cut away)
  ctx.beginPath()
  ctx.rect(0, 0, w, h)
  ctx.arc(cx, cy, R, 0, Math.PI * 2, true)
  ctx.clip("evenodd")
  for (let i = 0; i < 12; i++) {
    const { x, y, height, th, ux, uy } = skillWheelPos(i, { day, cx, cy, R, lift, sink, spout })
    if (height < -iconR) continue // whole figure tucked inside the ring → skip (the clip cuts the rest)
    const prog = progressOf(i)
    const rot = -th // the GLYPH's own spin: 0 (upright) exactly at its peak, winding as it rises/sets
    // the polygon does NOT spin with the year — it sits WHEEL-ANCHORED (rotated by
    // the outward unit u), phased so the growing edge's start vertex faces INWARD
    // (basis π): the exact orientation the menu ring keeps, so the two never differ.
    const off = Math.PI - (prog.filled / prog.sides) * Math.PI * 2
    const pts = []
    for (let k = 0; k < prog.sides; k++) {
      const ph = (k / prog.sides) * Math.PI * 2 + off
      const rx = ux * Math.cos(ph) - uy * Math.sin(ph)
      const ry = ux * Math.sin(ph) + uy * Math.cos(ph)
      pts.push([x + rx * ringR, y + ry * ringR])
    }
    ctx.strokeStyle = ink // the LEARNED wedges — solid + the partial fill, no dashed
    ctx.globalAlpha = vis
    ctx.lineWidth = 0.75 // thinner completed wedges in the sky
    ctx.beginPath()
    for (let k = 0; k < prog.sides; k++) {
      const [ax, ay] = pts[k]
      const [bx, by] = pts[(k + 1) % prog.sides]
      if (k < prog.filled) {
        ctx.moveTo(ax, ay)
        ctx.lineTo(bx, by)
      } else if (k === prog.filled && prog.partial > 0.001) {
        ctx.moveTo(ax, ay)
        ctx.lineTo(ax + (bx - ax) * prog.partial, ay + (by - ay) * prog.partial)
      }
    }
    ctx.stroke()
    ctx.fillStyle = dotInk // stars = the level dots — the one part that stays BRIGHT at night
    for (const [px, py] of pts) {
      ctx.beginPath()
      ctx.arc(px, py, dotR, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.save() // only the GLYPH does the constellation rotation — the shape stays put
    ctx.translate(x, y)
    ctx.rotate(rot) // upright at the season's peak (th=0), winding as it rises/sets on the flanks
    // the icon shows FAINTLY — half the stars' strength, a figure you can just
    // make out behind its own constellation
    drawIcon(ctx, SKILL_ICON[STAT_NAMES[i]], 0, 0, iconR, glyphInk, vis * 0.5)
    ctx.restore()
  }
  ctx.restore() // drop the horizon clip
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

// blend two hex colours (t: 0 = a, 1 = b) → "#rrggbb" — hex out, so the result
// can feed rgba() again (the night inks pass through gradient stops too)
function mixHex(a, b, t) {
  const px = hex => {
    let h = hex.trim().replace("#", "")
    if (h.length === 3) h = [...h].map(ch => ch + ch).join("")
    const n = parseInt(h, 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const [ar, ag, ab] = px(a)
  const [br, bg, bb] = px(b)
  const to = v => Math.round(v).toString(16).padStart(2, "0")
  return `#${to(ar + (br - ar) * t)}${to(ag + (bg - ag) * t)}${to(ab + (bb - ab) * t)}`
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

// end-of-day tips, one shown per night (picked by day so it's stable that night)
const END_TIPS = [
  "A full pack doubles every step — drop what you don't need before the long walk home.",
  "Scouting is cheap and never strands you — probe the fog even when the budget is thin.",
  "Seams are roads: stepping along a seam costs half a normal step.",
  "Learn beside a figure who outranks you — each lesson fills one edge of the skill.",
  "The day begins at midnight; your budget grows as you discover, and with it the daylight.",
  "The way home is always reserved — the clock's dashed arc is time you can still spend."
]

export function createRenderer(sim) {
  let menuLayout = null // last radial-menu layout (hit list), refreshed each draw
  let skillLayout = [] // last skills-ring hit list (learnable slots on the clock), refreshed each draw
  let quickBtns = [] // last on-screen quick-button hit rects (lower-right: sleep, gather…) — [{ key, x, y, r }]
  let wakeBtnRect = null // the end-of-day "wake up" button rect, or null when not sleeping
  let menuBlur = null // CACHED blurred+dimmed world backdrop for the menu (a full-screen
  let menuBlurStamp = "" // blur is costly) — rebuilt only when the view under it moves
  let menuSnap = null // a SHARP copy of the world, for the tile punch-out
  let menuSnapStamp = "" // …refreshed on any view/world change (cheap copy, so no glide gate)
  let menuScene = null // CACHED full static menu frame (everything BUT the live foreground),
  let menuSceneStamp = "" // blitted each idle frame so only ring/labels/card/logs/dot redraw

  const disp = () => DISPLAY.get(sim.orient())

  // ── pixel geometry ─────────────────────────────────
  // The area the grid actually gets: full width, below the top status line.
  function gridFrame(L) {
    const top = 28 // room for the status line at the very top
    const h = Math.max(50, L.h - top)
    return { w: L.w, h, cx: L.w / 2, cy: top + h / 2 }
  }
  let frame = { w: 0, h: 0, cx: 0, cy: 0 } // set per draw; hit-tests reuse the last one
  const setFrame = L => (frame = gridFrame(L))
  // SEAM VIEW: while the player stands on the seam (nobody's space), the
  // camera centres THEM and the boards move instead — the classic inversion.
  // cam is the pixel offset that pins the anchor tile to the frame centre.
  let cam = { x: 0, y: 0 }
  let camAnchor = [0, 0] // where the camera looks (global): the current board's centre, or the player on seam ground
  let fieldCache = null // the baked ground layer — see the field pass in draw()
  let camFrom = null // the slide's departure point (null = at rest)
  let camT0 = 0 // …and its start time
  let camMs = 700 // this glide's duration — SET PER SLIDE from how far it travels
  let camMove = false // is this glide MOVE-driven? (then it uses the asymmetric quad below)
  let freeCam = false // FREE-PAN mode: the camera stops following; the player drags it (menu still centres)
  const CAM_EASE_IN = 0.4 // the camera: SHORT ease-in, LONG ease-out (40% / 60%) — a gentle, drawn-out settle
  // The slide's length scales with the DISTANCE it covers (≈ how many tiles the
  // camera crosses), clamped. A single-tile step barely moves the camera, so a
  // fixed long tween left it crawling into place long after the token landed —
  // that lag is what read as jank. Short hops settle fast; only the big jumps
  // (a teleport across boards) earn the full unhurried, cinematic glide.
  const CAM_MS_PER_TILE = 120 // real ms per tile of camera travel
  const CAM_MS_MIN = 260 // a one-tile hop still eases, just briskly
  const CAM_MS_MAX = 1000 // and a long haul never drags past this
  const easeInOut = t => t * t * t * (t * (t * 6 - 15) + 10) // smootherstep: gentle out AND in
  const easeOutQuart = t => 1 - Math.pow(1 - t, 4) // strong ease-out = cubic-bezier(0.25, 1, 0.5, 1)
  // the tile the camera is FRAMING right now, from the live cam offset — this
  // seeds the field-bake cull, so the painted ground always tracks the viewport
  // even while the camera glides toward a distant anchor. (Inverse of the
  // anchor→pixel map above; a plain round is fine, the cull carries a margin.)
  const cullAnchorFrom = (f, size) => {
    const det = f[0] * f[3] - f[1] * f[2] || 1
    camAnchor = [
      Math.round((f[3] * cam.x - f[1] * cam.y) / (det * size)),
      Math.round((-f[2] * cam.x + f[0] * cam.y) / (det * size))
    ]
  }
  function setCam(anchor, size, direct = false, moveMs = 0) {
    const centre = !direct && anchor ? sim.boardCentreOf(anchor) : null
    const anchorTile = centre || anchor || [0, 0]
    const f = sim.orient().f
    const target = {
      x: size * (f[0] * anchorTile[0] + f[1] * anchorTile[1]),
      y: size * (f[2] * anchorTile[0] + f[3] * anchorTile[1])
    }
    // anchor changes — menu centring, crossings, seam walks — SLIDE eased. When a
    // MOVE drives the change, the glide borrows the move's own duration so cube and
    // camera run the same window (a DIFFERENT quad — longer in, shorter out — so it
    // trails then catches up); otherwise its LENGTH tracks the distance.
    const now = performance.now()
    if (!camTargetPos) {
      cam = camTargetPos = target // very first frame: no glide into existence
      cullAnchorFrom(f, size)
      return
    }
    // FREE-PAN: hold wherever the user dragged to — don't chase the player. The
    // menu (direct) is the exception: it still centres so the ring has room.
    if (freeCam && !direct) {
      camTargetPos = { x: cam.x, y: cam.y } // pin, so nothing reads as animating
      camFrom = null
      cullAnchorFrom(f, size)
      return
    }
    if (camTargetPos.x !== target.x || camTargetPos.y !== target.y) {
      camFrom = { x: cam.x, y: cam.y } // a new destination: depart from wherever we are
      camT0 = now
      camTargetPos = target
      if (moveMs > 0) {
        camMs = moveMs // the move's EXACT window (no min floor — it would outrun the cube)
        camMove = true
      } else {
        const tiles = Math.hypot(target.x - camFrom.x, target.y - camFrom.y) / size
        // a menu recenter (direct) runs a touch quicker than a plain glide
        camMs = Math.max(CAM_MS_MIN, Math.min(CAM_MS_MAX, tiles * CAM_MS_PER_TILE * (direct ? 0.75 : 1)))
        camMove = false // its own distance-scaled smootherstep
      }
    }
    if (!camFrom) {
      cam = target // at rest on an unchanged anchor: stay pinned
      cullAnchorFrom(f, size)
      return
    }
    const t = Math.min(1, (now - camT0) / camMs)
    const e = camMove ? easeSplit(t, CAM_EASE_IN) : easeInOut(t)
    cam = {
      x: camFrom.x + (camTargetPos.x - camFrom.x) * e,
      y: camFrom.y + (camTargetPos.y - camFrom.y) * e
    }
    if (t >= 1) {
      cam = camTargetPos
      camFrom = null
    }
    cullAnchorFrom(f, size) // track the viewport, not the (possibly distant) target
  }
  let camTargetPos = null
  const camAnimating = () => !!camTargetPos && (cam.x !== camTargetPos.x || cam.y !== camTargetPos.y)

  // MENU OPEN/CLOSE — an eased 0→1 that morphs the skill ring between the sky
  // teardrop (0) and the menu's perfect circle (1). Time-driven like the camera, so
  // the loop keeps running (menuAnimating) until it settles. Long + calm, and the
  // SAME accentuated ease-out both ways: quick off the mark, soft landing.
  const MENU_MS = 540
  let menuVal = 0
  let menuTgt = 0
  let menuFrom = 0
  let menuT0 = 0
  function menuAmount(wantOpen) {
    const want = wantOpen ? 1 : 0
    const now = performance.now()
    if (want !== menuTgt) {
      menuFrom = menuVal
      menuTgt = want
      menuT0 = now
    }
    const t = Math.min(1, (now - menuT0) / MENU_MS)
    menuVal = menuFrom + (menuTgt - menuFrom) * easeOutQuart(t) // both ways: quick off the mark, soft landing
    if (t >= 1) menuVal = menuTgt
    return menuVal
  }
  // per-skill rotation eased on HOVER — a skill straightens to upright when the
  // pointer is on it, and drifts back to its constellation tilt when it leaves. Soft,
  // slow, shortest-path. `skillRotBusy` keeps the loop alive while any are settling.
  const SKILL_ROT_TAU = 170 // ms — soft, slow approach
  let skillRot = new Array(STAT_NAMES.length).fill(0) // the GLYPH's spin (the polygon never spins)
  let skillPhase = new Array(STAT_NAMES.length).fill(0) // the polygon's eased phase — steps one dot per edge gained/given
  let skillHovA = new Array(STAT_NAMES.length).fill(0) // icon-hover amount — drives the shape fill, in sync with the straighten
  let skillRotInit = false // snapped to rest on the frame the menu opens
  let skillRotBusy = false
  let skillRotT = 0
  let menuAnts = false // facing a figure: the marching-ants + previews animate → keep frames coming
  const menuAnimating = () => menuVal !== menuTgt || skillRotBusy || menuAnts
  // FREE-PAN: the user drags the board — shift the offset by the pointer delta
  // and kill any in-flight auto-glide so the two never fight. (screen = centre −
  // cam + …, so following the finger means subtracting the delta.)
  const panBy = (dx, dy) => {
    cam = { x: cam.x - dx, y: cam.y - dy }
    camFrom = null
    camTargetPos = { x: cam.x, y: cam.y }
  }
  const setFreeCam = on => {
    freeCam = !!on
    if (!freeCam) camFrom = null // dropping back to follow: let setCam glide home from here
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
  // The trail + hover preview render in TWO passes (see the frame): first the
  // whole SILHOUETTE in surface colour (lines + heads, always solid), then the
  // ink lines and heads on top. So the border reads as one clean shape beneath
  // everything, instead of each head's border sitting over the trail line.
  // These primitives each draw ONE layer.

  // one poly-line, single colour/width (dash optional)
  function strokePath(ctx, L, size, path, color, width, alpha, dash) {
    if (!path || path.length < 2) return
    strokePixels(ctx, path.map(h => hexToPixel(L, h[0], h[1], size)), color, width, alpha, dash)
  }

  // same, but from pixel points already (so a path can end somewhere other than
  // a tile centre — e.g. the hover trail finishing at the cursor)
  function strokePixels(ctx, pts, color, width, alpha, dash) {
    if (!pts || pts.length < 2) return
    ctx.save()
    ctx.lineJoin = "round"
    ctx.lineCap = "round"
    ctx.setLineDash(dash || [])
    ctx.beginPath()
    pts.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)))
    ctx.strokeStyle = color
    ctx.globalAlpha = alpha
    ctx.lineWidth = width
    ctx.stroke()
    ctx.restore()
  }

  // one arrowhead per trail leg (at each segment midpoint), single colour/width
  function trailArrows(ctx, L, size, trail, color, width, alpha) {
    if (trail.length < 2) return
    ctx.globalAlpha = alpha
    for (let i = 1; i < trail.length; i++) {
      const a = hexToPixel(L, trail[i - 1][0], trail[i - 1][1], size)
      const b = hexToPixel(L, trail[i][0], trail[i][1], size)
      arrowTip(ctx, a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2, color, size * 0.32, size * 0.2, width)
    }
    ctx.globalAlpha = 1
  }

  // an X centred at (cx,cy) — the "move not permitted" mark, replacing the tip
  // arrowhead on an illegal hover
  function crossTip(ctx, cx, cy, color, size, width, alpha) {
    const s = size * 0.24
    ctx.globalAlpha = alpha
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.lineJoin = "round"
    ctx.lineCap = "round"
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(cx - s, cy - s)
    ctx.lineTo(cx + s, cy + s)
    ctx.moveTo(cx + s, cy - s)
    ctx.lineTo(cx - s, cy + s)
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  // Every hover readout — tile info AND menu focus — renders the same way: lines
  // of dark text on snug full-white backgrounds, pinned near the cursor. It's
  // split into three so the leader FAN can be drawn under the hover trail while
  // the boxes + text land on top: labelLayout (place it), labelFan (the leader
  // lines), labelBox (backgrounds + text). `lines` is [{ text, color?, alpha?,
  // small? }] — `small` lines wear the card type (13px, shorter box). A line
  // may instead carry { cells: [{ text, … }, …] }: side-by-side boxes sharing
  // one row (they abut edge-to-edge, each with its own border). Each text
  // must MEASURE and DRAW in its own font, or its box mis-sizes.
  const LABEL_FONT = "600 16px system-ui, sans-serif"
  const LABEL_FONT_SMALL = "600 13px system-ui, sans-serif" // the card-content blocks
  const lineFont = l => (l.small ? LABEL_FONT_SMALL : LABEL_FONT)
  const lineHOf = l => (l.small ? 17 : 22)
  function labelLayout(ctx, L, pointer, lines, tile, outward = false, keepClear = null) {
    if (!pointer || !lines.length) return null
    const pad = 6
    const measure = l => {
      ctx.font = lineFont(l)
      return ctx.measureText(l.text).width + pad * 2
    }
    const cellW = lines.map(l => (l.cells ? l.cells.map(measure) : null))
    const widths = lines.map((l, i) => (l.cells ? cellW[i].reduce((a, b) => a + b, 0) : measure(l)))
    const hs = lines.map(l => (l.cells ? Math.max(...l.cells.map(lineHOf)) : lineHOf(l)))
    const ys = [] // each line's offset from the stack top
    let boxH = 0
    for (const h of hs) {
      ys.push(boxH)
      boxH += h
    }
    const boxW = Math.max(...widths)
    const gap = tile * 1.2 // a full tile of clear space off the cursor
    // place the box a gap off the cursor along a unit direction, clamped on-screen;
    // report how far it clears the keep-clear circle (negative = overlapping)
    const place = (ux, uy) => {
      const reach = gap + (Math.abs(ux) * boxW + Math.abs(uy) * boxH) / 2
      let lft = Math.max(4, Math.min(L.w - boxW - 4, pointer.x + ux * reach - boxW / 2))
      let tp = Math.max(4, Math.min(L.h - boxH - 4, pointer.y + uy * reach - boxH / 2))
      let clr = Infinity
      if (keepClear) {
        const nx = Math.max(lft, Math.min(keepClear.x, lft + boxW))
        const ny = Math.max(tp, Math.min(keepClear.y, tp + boxH))
        clr = Math.hypot(nx - keepClear.x, ny - keepClear.y) - keepClear.r
      }
      return { left: lft, top: tp, clr }
    }
    // candidate directions, best first. With a keep-clear circle (the player),
    // aim PERPENDICULAR to the player→cursor line — a triangle of player/cursor/
    // label — trying the centre-ward side first, then the other, then straight
    // away from the player. Try each and take the first that clears; else the one
    // that clears most. (This behaves at the edges, where a single direction +
    // push would fight the clamp.)
    let dirs
    if (keepClear && !outward) {
      let px = pointer.x - keepClear.x
      let py = pointer.y - keepClear.y
      const pl = Math.hypot(px, py) || 1
      px /= pl
      py /= pl
      const towardC = -py * (L.cx - pointer.x) + px * (L.cy - pointer.y)
      const perpA = towardC >= 0 ? [-py, px] : [py, -px]
      const perpB = towardC >= 0 ? [py, -px] : [-py, px]
      dirs = [perpA, perpB, [px, py]] // two perpendiculars, then away from the player
    } else {
      const s = outward ? -1 : 1
      let dx = (L.cx - pointer.x) * s
      let dy = (L.cy - pointer.y) * s
      const dl = Math.hypot(dx, dy) || 1
      dirs = [[dx / dl, dy / dl]]
    }
    let best = null
    for (const [ux, uy] of dirs) {
      const p = place(ux, uy)
      if (p.clr >= 0) {
        best = p
        break
      }
      if (!best || p.clr > best.clr) best = p
    }
    return { lines, left: best.left, top: best.top, hs, ys, pad, widths, cellW, pointer }
  }

  // A line box read as a 3D slab lit from the cursor: only the edges that FACE the
  // cursor (the cursor is on their outer side) are "front" — the away edges are
  // hidden. Returns the front edges as [[x1,y1],[x2,y2]] segments.
  function boxFrontEdges(pointer, left, y, w, lineH) {
    const r = left + w
    const b = y + lineH
    const edges = []
    if (pointer.y < y) edges.push([[left, y], [r, y]]) // top
    if (pointer.y > b) edges.push([[left, b], [r, b]]) // bottom
    if (pointer.x < left) edges.push([[left, y], [left, b]]) // left
    if (pointer.x > r) edges.push([[r, y], [r, b]]) // right
    return edges
  }

  // thin leader lines from the cursor to the corners of the FRONT edges only — a
  // little fan (default white; black for the menu). Away corners are culled (as if
  // the box faced the cursor), and where boxes STACK the shared/interior corners
  // are dropped too. Drawn under the hover trail + boxes.
  function labelFan(ctx, lay, stroke = null) {
    if (!lay) return
    stroke = stroke || theme("--surface", "#111") // themed: the label paper colour
    const { lines, left, top, hs, ys, widths, pointer } = lay
    // count each corner across all line boxes: a point shared by ≥2 boxes sits on
    // the interior of the stacked outline, so it's not a real corner to fan to
    const count = new Map()
    lines.forEach((l, i) => {
      const y = top + ys[i]
      for (const cx of [left, left + widths[i]]) {
        for (const cy of [y, y + hs[i]]) {
          const k = cx + "," + cy
          count.set(k, (count.get(k) || 0) + 1)
        }
      }
    })
    ctx.save()
    ctx.setLineDash([])
    ctx.strokeStyle = stroke
    ctx.globalAlpha = 1
    ctx.lineWidth = 1
    ctx.lineCap = "round"
    ctx.beginPath()
    const done = new Set()
    lines.forEach((l, i) => {
      const y = top + ys[i]
      for (const [a, b] of boxFrontEdges(pointer, left, y, widths[i], hs[i])) {
        for (const c of [a, b]) {
          const k = c[0] + "," + c[1]
          if (count.get(k) >= 2 || done.has(k)) continue // shared/interior or already drawn
          done.add(k)
          ctx.moveTo(pointer.x, pointer.y)
          ctx.lineTo(c[0], c[1])
        }
      }
    })
    ctx.stroke()
    ctx.restore()
  }

  function labelBox(ctx, lay, border = null) {
    if (!lay) return
    // themed paper + ink — the labels follow the light/dark switch
    const paper = theme("--surface", "#111")
    const inkCol = theme("--text", "#eee")
    border = border || paper
    const { lines, left, top, hs, ys, pad, widths, cellW } = lay
    ctx.textAlign = "left"
    ctx.textBaseline = "middle"
    ctx.lineJoin = "round"
    ctx.setLineDash([])
    // one cell = one bordered box; a plain line is a single cell, a `cells`
    // line lays its boxes edge-to-edge along the row
    const cell = (l, x, y, w, h) => {
      ctx.font = lineFont(l) // must match labelLayout's measurement, or the box mis-sizes
      ctx.globalAlpha = 1
      ctx.fillStyle = l.invert ? inkCol : paper // `invert` = ink box, paper figure (marks the higher side)
      ctx.fillRect(x, y, w, h)
      // the WHOLE box is bordered (caps the fan so lines never poke past the edge)
      ctx.strokeStyle = l.invert ? inkCol : border
      ctx.lineWidth = 2
      ctx.strokeRect(x, y, w, h)
      ctx.globalAlpha = l.alpha ?? 1
      ctx.fillStyle = l.color || (l.invert ? paper : inkCol)
      ctx.fillText(l.text, x + pad, y + h / 2)
    }
    lines.forEach((l, i) => {
      const y = top + ys[i]
      if (l.cells) {
        let x = left
        l.cells.forEach((c2, j) => {
          cell(c2, x, y, cellW[i][j], hs[i])
          x += cellW[i][j]
        })
      } else cell(l, left, y, widths[i], hs[i])
    })
    ctx.globalAlpha = 1
  }

  // fan + box together — for the no-trail case (the radial menu's focus label),
  // which inverts: it sits AWAY from the player/tile and wears black borders
  function cursorLabel(ctx, L, pointer, lines, tile, { outward = false, stroke = null, keepClear = null } = {}) {
    const lay = labelLayout(ctx, L, pointer, lines, tile, outward, keepClear)
    labelFan(ctx, lay, stroke)
    labelBox(ctx, lay, stroke)
  }

  // ── the frame ──────────────────────────────────────
  // ui: { hovered, hoverPath, hoverIllegal, skillHover, pointer, logsOpen, replaying, menu, card,
  //       pending: null | { verb, target, ghostTile, ghostPos, ghostTrail, inflightMin, remainingMin } }
  function draw(ctx, L, ui) {
    const ink = theme("--text", "#eee")
    const surface = theme("--surface", "#111")
    setFrame(L)
    const size = sizeFor()
    const v = sim.view()
    const o = sim.orient()
    // The camera frames the DESTINATION, not the walker: it glides once toward
    // the end tile's board (averaging the whole move) instead of mirroring every
    // in-and-out of boards along the route — so a winding path doesn't bump the
    // camera fixed→follow→fixed. Within one board the end centre == the current
    // one, so it holds still and the cube walks across. An OPEN MENU centres the
    // player (board slides, seam-style) so the fanned items always have room.
    setCam(ui.pending?.target || v.player, size, !!ui.menu, ui.pending?.moveMs || 0)

    // the player cube's clearance circle — cursor labels are kept out of it
    const playerClear = () => {
      const pt = ui.pending?.ghostTile || v.player
      const pp = hexToPixel(L, pt[0], pt[1], size)
      return { x: pp.x, y: pp.y, r: size * 0.85 }
    }

    // The SUN sits at its DAY-OF-YEAR angle on the dial (the year walks the
    // colour wheel — day n wears hue n°), INDEPENDENT of your budget. The only
    // intraday motion is a SUBTLE radial WOBBLE about the orbit: it peeks just
    // ABOVE the orbit ring by day and sinks just BELOW by night, where the ring —
    // the horizon — eclipses it (hidden when down). Season shifts the wobble, so
    // day length drifts across the year. Shadows cast away from it, longest near
    // the horizon, GONE at night.
    const inflight = ui.pending ? ui.pending.inflightMin : 0
    const liveEnergy = sim.energy() - inflight
    const dayBudget = sim.dayBudget()
    const spent = dayBudget - liveEnergy // minutes since waking; the day starts at 00:00
    // the clock is PINNED to the viewport centre — never the sliding board — so it
    // stays put while the world moves under it (a seam walk, a menu-centre glide)
    const sunCentre = { x: frame.cx, y: frame.cy }
    const sunDialR = size * Math.sqrt(3) * (SEAM_RING + 0.2) // half a tile tighter than the seam+0.7
    // the SUN — shared math (lib/clock.js). At its day-of-year angle, wobbling
    // radially about the orbit (the horizon): above by day, below/eclipsed by
    // night. Season shifts the wobble → day length drifts. Shadows away from it,
    // longest near the horizon, gone at night. The dial dot + eclipse draw below.
    const { sunDeg, sunRad, sunAlt, isNight, sunPos, dayExtreme, sunLen, sunTo } = sunState({
      day: sim.day(),
      minuteOfDay: spent,
      cx: sunCentre.x,
      cy: sunCentre.y,
      R: sunDialR
    })
    // the MOON rides the same dial: it shares the sun's day angle but drifts in
    // time (its offset = its phase) and swings sideways off the axis, crossing it
    // only at the nodes — so it's usually a little to the side, and eclipses are
    // rare. A moon that's up (bright when full) lightens the night below.
    const moon = moonState({ day: sim.day(), minuteOfDay: spent, cx: sunCentre.x, cy: sunCentre.y, R: sunDialR })
    // NIGHT INK — after dark, the READABLE layer (the header text, the whole dial)
    // flips to a light ink so it stays legible over the blackened world. Not an
    // invert: bands, glyphs and the rest keep their colours. Blends in over the
    // first stretch of the sun's descent (continuous with dusk), and is a no-op on
    // the dark theme, whose ink is already light.
    const themeInk = ink // the untouched theme ink (the sky wheel's figures keep it)
    // a STEEP, EARLY switch — not a long crossfade: mid-blend the two night ramps
    // (ink coming down, surface coming up) converge on the same mid-gray and the
    // whole readable layer goes same-tint mush. So the dress commits to the next
    // side while the sun is still shallow (fully day below depth 0.10, fully night
    // by 0.15) — the 0.05 window keeps it a flick, not a pop.
    const nightInk01 = isNight ? Math.min(1, Math.max(0, (-sunAlt - 0.1) / 0.05)) : 0
    const nightInk = nightInk01 > 0.001 ? mixHex(ink, "#e8eaf2", nightInk01) : ink
    // …and surface's night counterpart — near-black — for everything that uses a
    // surface FILL as a backing (hover fills, the menu's dim wash, the way-back
    // band): the readable layer inverts as a PAIR, ink up, surface down.
    const nightSurface = nightInk01 > 0.001 ? mixHex(surface, "#06070f", nightInk01) : surface
    // THE FOG IS THE CANVAS — undiscovered ground is simply the untouched base
    // coat, so paint it explicitly and let it follow the night: paper by day,
    // BLACK after dark. (Identical to the CSS background by day — no change there.)
    ctx.fillStyle = nightSurface
    ctx.fillRect(0, 0, L.w, L.h)
    // THE SKILL WHEEL (positions) — shared math (clock.js), so the night sky (menu
    // closed) and the menu's ring (open) can't drift, and the styles test dial runs
    // the exact same geometry. The whole wheel rotates once a year, pushed up ~1 tile.
    const menuOpen01 = menuAmount(!!ui.menu) // eased open amount: 0 = sky teardrop, 1 = menu circle
    // fully closed → the sky (not the menu ring) draws, so stop easing: clear the busy
    // flag (or the loop would spin with drawSkills no longer running) and re-arm the snap
    if (!ui.menu && menuOpen01 <= 0.001) (skillRotInit = false), (skillRotBusy = false), (menuAnts = false)
    // the world changes between menu sessions, so drop the backdrop caches whenever the
    // menu isn't up — the next open rebuilds them from the current world (rounded-camera
    // keys could otherwise collide across sessions and show a stale backdrop)
    if (!ui.menu) menuBlurStamp = menuSnapStamp = ""
    const oneTile = size * Math.sqrt(3)
    const menuR = sunDialR - oneTile // the MENU ring — a perfect circle, one full tile inside the clock
    // a skill's position, morphed between the SKY teardrop (open 0) and the MENU circle
    // (open 1): same wheel angle, the radius flattens from the teardrop out to menuR.
    const skillPos = (i, open) => {
      const t = skillWheelPos(i, { day: sim.day(), cx: sunCentre.x, cy: sunCentre.y, R: sunDialR, lift: size * 1.3, sink: size * 1.2, spout: 12 })
      const tearRad = sunDialR + t.height
      const rad = tearRad + (menuR - tearRad) * open
      return { x: sunCentre.x + t.ux * rad, y: sunCentre.y + t.uy * rad, th: t.th, ux: t.ux, uy: t.uy }
    }
    const skillWheel = i => skillPos(i, menuOpen01) // the menu ring, eased between the sky teardrop and the circle

    // the hovered skill's reference label (name · level · flavour), riding the cursor
    // INWARD. Pulled out so it can draw ON TOP of the ring in every path.
    function drawSkillLabel() {
      if (!ui.menu || !ui.skillHover || !ui.pointer) return
      const s = ui.skillHover.skill
      const prog = sim.skillProgress(s)
      const pctOf = p => Math.round(((p.filled + p.partial) / p.sides) * 100) + "%"
      const myPct = prog.level >= SKILL_CAP ? "max" : pctOf(prog)
      let lines
      if (ui.skillHover.kind === "action") {
        // the EXCHANGE readout: YOUR level + progress sit LEFT of the title, the
        // FIGURE's mirror it on the RIGHT — and the higher level wears the dark
        // (inverted) box, the difference marked right where you act on it
        const bc2 = sim.boardHexOf(v.player)
        const faced2 = bc2 && sim.npcAt(bc2)
        const npc2 = faced2 && eq(faced2.pos, v.player) ? faced2 : null
        const tp = npc2 ? sim.npcProgress(npc2, s) : null
        const cells = [{ text: String(prog.level), invert: !!tp && prog.level > tp.level }, { text: myPct, alpha: 0.6 }, { text: s }]
        if (tp)
          cells.push(
            { text: String(tp.level), invert: tp.level > prog.level },
            { text: tp.level >= npc2.stats[s] ? "max" : pctOf(tp), alpha: 0.6 }
          )
        lines = [
          { cells },
          { text: ui.skillHover.action === "teach" ? "teach · give an edge" : "learn · +1 edge" },
          ...(ui.skillHover.action === "teach" && prog.filled + prog.partial < 1
            ? [{ text: "empty shape — gives up the level", alpha: 0.6, small: true }]
            : [])
        ]
      } else {
        // the reference: OUR stats, always and unchanged — name, level, progress
        // in one row of boxes (the progress moved up beside the level)
        lines = [{ cells: [{ text: s }, { text: String(prog.level) }, { text: myPct, alpha: 0.6 }] }]
        const info = SKILL_INFO[s]
        if (info) {
          lines.push({ text: `“${info.flavour}”`, alpha: 0.6, small: true })
          lines.push({ text: `favoured in ${info.home}`, alpha: 0.9, small: true })
          if (info.effect && info.effect !== "—") lines.push({ text: info.effect, alpha: 0.9, small: true })
        }
      }
      cursorLabel(ctx, L, ui.pointer, lines, size, { outward: false, stroke: ink })
    }

    // the menu's LIVE layer — everything that must track state instantly (and sit
    // ABOVE the ring): the ring itself, the focused badge's label, the hovered
    // skill's reference, the stats card, the logs strip, our cursor dot. Drawn
    // AFTER the static-scene capture on both the full and the cached path, so a
    // click (logs, camera toggle) or a pointer twitch never shows a stale frame.
    // find a node in the menu SPEC by id (folders' children included) — shared by
    // the foreground's focus label and the clock's cost preview, so both always
    // read the node's LIVE state
    function menuNodeById(id) {
      if (id == null || !ui.menu) return null
      for (const n of [...(ui.menu.self || []), ...(ui.menu.them || [])]) {
        if (n.id === id) return n
        for (const k of n.children || []) if (k.id === id) return k
      }
      return null
    }

    function drawMenuForeground() {
      drawSkills()
      // the focused badge's label — looked up from the SPEC (not the layout pass),
      // so it works on cached frames too and always carries the node's LIVE text
      const focusNode = menuNodeById(ui.menu.focusId)
      if (focusNode && focusNode.label && ui.pointer)
        cursorLabel(ctx, L, ui.pointer, [{ text: focusNode.label }], size, { outward: true, stroke: ink, keepClear: playerClear() })
      else drawSkillLabel()
      if (ui.card) drawStatsPanel(ctx, L, { ink: nightInk, surface: nightSurface, ...ui.card })
      drawLogs()
      drawCursorDot()
    }

    // our own cursor — a small dot over the world (the OS cursor is hidden there).
    // Ink centre with a surface ring, so it separates from any ground on either theme.
    function drawCursorDot() {
      if (!ui.pointer) return
      ctx.globalAlpha = 1
      ctx.beginPath()
      ctx.arc(ui.pointer.x, ui.pointer.y, 3, 0, Math.PI * 2)
      ctx.fillStyle = ink
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = surface
      ctx.stroke()
    }

    // logs: the day's action log, TOP-LEFT under the title and only while the menu
    // is open. Collapsed shows just the latest entry (a summary); a click on the
    // strip expands the full log. Small font throughout — a dev window into exactly
    // what a saved day would store (see DESIGN.md, "the action log").
    function drawLogs() {
      const ink = nightInk // logs flip light after dark, like the header
      const log = sim.log()
      const meta = sim.logMeta()
      // consecutive moves collapse into one line; each prefixed with the day
      const lines = []
      for (let i = 0; i < log.length; ) {
        let j = i + 1
        if (log[i].type === "move") while (j < log.length && log[j].type === "move") j++
        const a = log[j - 1]
        let mins = 0
        for (let k = i; k < j; k++) mins += meta[k] || 0
        let s = `d${sim.day()} · ${i === j - 1 ? `${i + 1}` : `${i + 1}–${j}`} ${a.type}`
        if (j - i > 1) s += ` ×${j - i}`
        if (a.target) s += ` [${a.target[0]},${a.target[1]}]`
        if (mins > 0) s += ` ·${Math.round(mins)}m`
        lines.push(s)
        i = j
      }
      const x = 14
      let ly = 36
      ctx.font = "600 11px system-ui, sans-serif" // small, always — even when open
      ctx.textAlign = "left"
      ctx.textBaseline = "middle"
      ctx.fillStyle = ink
      const latest = lines.length ? lines[lines.length - 1] : "no actions yet"
      ctx.globalAlpha = 0.9
      ctx.fillText(ui.logsOpen ? "logs ▾" : `logs ▸  ${latest}`, x, ly) // collapsed: summary = latest entry
      ctx.globalAlpha = 1
      if (ui.logsOpen && lines.length) {
        ly += 18
        ctx.globalAlpha = 0.6
        const max = Math.max(1, Math.floor((L.h - ly - 20) / 16))
        const start = Math.max(0, lines.length - max)
        if (start > 0) {
          ctx.fillText(`⋯ ${start} earlier`, x, ly)
          ly += 16
        }
        for (let i = start; i < lines.length; i++) {
          ctx.fillText(lines[i], x, ly)
          ly += 16
        }
        ctx.globalAlpha = 1
      }
    }

    // ── STATIC-SCENE CACHE (so animating the ring doesn't re-render the world) ──
    // With the menu settled — no pending action, no camera glide — everything BENEATH
    // the foreground (world, backdrop, clock, badges, punch-out) is driven only by the
    // fields stamped below. The whole live layer (ring, labels, card, logs, cursor dot)
    // draws POST-capture via drawMenuForeground, so the pointer is deliberately NOT in
    // the stamp: moving the mouse over the settled menu re-blits the cache and redraws
    // only the foreground. A full render happens only when a stamped field changes
    // (crossing onto a different skill/badge, an action, open/close, resize, theme).
    const menuIdle = !!ui.menu && menuOpen01 === 1 && !ui.pending && !camAnimating()
    const cv0 = ctx.canvas
    const menuStamp = menuIdle
      ? [
          sim.worldStamp(), sim.day(), Math.round(sim.dayBudget() - sim.energy()),
          Math.round(cam.x), Math.round(cam.y), cv0.width, cv0.height, surface, ink,
          // the clock's lesson-cost preview draws pre-capture from the hovered action
          ui.skillHover?.skill || "", ui.skillHover?.kind || "", ui.skillHover?.action || "",
          ui.menu.focusId ?? "", ui.menu.openId ?? ""
        ].join("|")
      : ""
    if (menuIdle && menuScene && menuSceneStamp === menuStamp) {
      ctx.save() // blit pixel-exact in backing-store space — a dpr-transformed drawImage
      ctx.setTransform(1, 0, 0, 1, 0, 0) // resamples at fractional DPRs (soft text flicker)
      ctx.drawImage(menuScene, 0, 0)
      ctx.restore()
      drawMenuForeground() // ring + labels + card + logs + cursor dot — the live layer
      return
    }

    const castShadow = (ctx, on) => {
      if (on && !isNight) {
        ctx.shadowColor = `hsla(${sunDeg}, 55%, 32%, 0.65)`
        ctx.shadowOffsetX = -Math.sin(sunRad) * sunLen
        ctx.shadowOffsetY = Math.cos(sunRad) * sunLen
        ctx.shadowBlur = 3
      } else {
        ctx.shadowColor = "transparent"
        ctx.shadowOffsetX = ctx.shadowOffsetY = ctx.shadowBlur = 0
      }
    }

    // the trail is the full record of the day's walk — backtracking appends, so
    // it never truncates on hover; the in-flight ghost overrides it mid-wait.
    const trail = ui.pending?.ghostTrail || v.trail

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
    // ── the field is a BAKED LAYER: the ground repaints only when the world,
    // the light, the zoom, the dots or the theme change — camera glides and
    // pointer frames just BLIT it. The pass below is UI-free by design. ──
    const paintField = (ctx, pad = 0) => {
      const pitch = 2 * RINGS + 2
      // the sweep's radius covers the VIEWPORT plus the bake margin (half-
      // extents from the camera anchor, corner-safe) — the margin must be
      // painted too, or panning drags blank strips in
      const rCull = Math.min(
        4 * pitch,
        Math.ceil((frame.w + 2 * pad) / (2 * size * Math.sqrt(3)) + (frame.h + 2 * pad) / (2 * size * 1.5)) + 2
      )
      const inset = 1 - 1 / (Math.sqrt(3) * size)
      const wInset = 1 - 3 / (Math.sqrt(3) * size)
      const seamLw = 2
      const seamInset = 1 - seamLw / (Math.sqrt(3) * size)
      for (const dlt of Hex.range(rCull)) {
        const h = [camAnchor[0] + dlt[0], camAnchor[1] + dlt[1]]
        const c = hexToPixel(L, h[0], h[1], size)
        if (c.x < -size - pad || c.x > L.w + size + pad || c.y < -size - pad || c.y > L.h + size + pad) continue
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
            // (and its miniature) are earned by going there. Fog-kin, so it rides
            // the night ink: a faint light wash on the blackened unknown.
            if (parent.discovered.has(lk)) fillHex(ctx, c, size, nibbleColor(v), 0.85, o.startDeg)
            else fillHex(ctx, c, size, nightInk, 0.1, o.startDeg)
            const node = parent.children[lk]
            if (node && node.discovered.size) {
              // the board's miniature is CACHED offscreen — with the whole
              // world cleared this is thousands of tiny hexes, far too many
              // to repath every frame. Re-rendered only when the board's
              // discovery, the drawn size bucket or the orientation changes.
              const px = Math.max(48, Math.min(256, Math.ceil(size / 32) * 32))
              const stamp = node.discovered.size + ":" + px + ":" + o.startDeg
              let mc = miniCache.get(lk)
              if (!mc || mc.stamp !== stamp) {
                const cnv = document.createElement("canvas")
                cnv.width = cnv.height = px * 2
                const mctx = cnv.getContext("2d")
                const centre = sim.centreOf(h)
                const ss = px / 9.5
                for (const dk of node.discovered) {
                  const [lq, lr] = dk.split(",").map(Number)
                  const g2 = [centre[0] + lq, centre[1] + lr]
                  const pal = biomeColor(sim.typeNameAt(g2), sim.heightAt(g2), sim.smoothAt(g2))
                  if (!pal) continue
                  fillHex(
                    mctx,
                    { x: px + Math.sqrt(3) * (lq + lr / 2) * ss, y: px + 1.5 * lr * ss },
                    ss,
                    pal,
                    0.95,
                    o.startDeg
                  )
                }
                mc = { stamp, cnv }
                miniCache.set(lk, mc)
              }
              ctx.globalAlpha = 1
              ctx.drawImage(mc.cnv, c.x - size, c.y - size, size * 2, size * 2)
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
          const gIn = size * 0.4 // how deep the fog EATS into the tile's rim
          // the fog's TRUE colour at the boundary: the base coat PLUS the outward
          // breath's tint — aiming at the base alone left a visible seam where the
          // two gradients met at the edge
          const fogEdge = mixHex(nightSurface, nightInk, 0.05)
          const ext = p => {
            const l = Math.hypot(p.x - c.x, p.y - c.y) || 1
            return { x: p.x + ((p.x - c.x) / l) * g, y: p.y + ((p.y - c.y) / l) * g }
          }
          // a corner pulled TOWARD the centre — adjacent fog edges share their
          // pulled corners exactly, so the inward quads tessellate with no
          // overlap (no double-dark seams) and no gaps
          const inw = p => ({ x: p.x + (c.x - p.x) * (gIn / size), y: p.y + (c.y - p.y) * (gIn / size) })
          // corner index → the two edges meeting there, straight from the
          // orientation's own table (no assumptions about corner ordering)
          const atCorner = {}
          for (let d = 0; d < 6; d++) for (const ci of disp().edgeCorners[d]) (atCorner[ci] = atCorner[ci] || []).push(d)
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
            const ux2 = (mx - c.x) / ml
            const uy2 = (my - c.y) / ml
            const grad = ctx.createLinearGradient(mx, my, mx + ux2 * g, my + uy2 * g)
            grad.addColorStop(0, rgba(nightInk, 0.05)) // the frontier's breath — fog-kin, light at night
            grad.addColorStop(1, rgba(nightInk, 0))
            ctx.fillStyle = grad
            ctx.beginPath()
            ctx.moveTo(A.x, A.y)
            ctx.lineTo(B.x, B.y)
            ctx.lineTo(B2.x, B2.y)
            ctx.lineTo(A2.x, A2.y)
            ctx.closePath()
            ctx.fill()
            // …and the fog eats INWARD: its edge colour at FULL strength on the
            // boundary (the seam disappears entirely), gone by gIn deep — the
            // frontier DISSOLVES instead of cutting. Baked gradients, no blur.
            const A3 = inw(A)
            const B3 = inw(B)
            const gin = ctx.createLinearGradient(mx, my, mx - ux2 * gIn, my - uy2 * gIn)
            gin.addColorStop(0, rgba(fogEdge, 1))
            gin.addColorStop(1, rgba(fogEdge, 0))
            ctx.fillStyle = gin
            ctx.beginPath()
            ctx.moveTo(A.x, A.y)
            ctx.lineTo(B.x, B.y)
            ctx.lineTo(B3.x, B3.y)
            ctx.lineTo(A3.x, A3.y)
            ctx.closePath()
            ctx.fill()
            // RUN-END corners — where the fog boundary stops against a discovered
            // edge, the band used to cut off laterally. A radial fan at that vertex
            // melts the end around the corner, so EVERY vertex the boundary touches
            // takes part in the dissolve. (Fog–fog corners need nothing: the pulled
            // corners miter continuously there.)
            for (const ci of [ca, cb]) {
              const other = (atCorner[ci] || []).find(e => e !== d)
              if (other == null || (fogBits >> other) & 1) continue
              const C = cf[ci]
              const [oa, ob] = disp().edgeCorners[other]
              const D2 = cf[oa === ci ? ob : oa]
              const P = { x: C.x + (D2.x - C.x) * (gIn / size), y: C.y + (D2.y - C.y) * (gIn / size) }
              const rg = ctx.createRadialGradient(C.x, C.y, 0, C.x, C.y, gIn)
              rg.addColorStop(0, rgba(fogEdge, 1))
              rg.addColorStop(1, rgba(fogEdge, 0))
              ctx.fillStyle = rg
              const C3 = inw(C)
              ctx.beginPath()
              ctx.moveTo(C.x, C.y)
              ctx.lineTo(C3.x, C3.y)
              ctx.lineTo(P.x, P.y)
              ctx.closePath()
              ctx.fill()
            }
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
          castShadow(ctx, true)
          for (let d = 0; d < 6; d++) {
            if (!((bits >> d) & 1)) continue
            const [ca, cb] = disp().edgeCorners[d]
            ctx.beginPath()
            ctx.moveTo(cw[ca].x, cw[ca].y)
            ctx.lineTo(cw[cb].x, cw[cb].y)
            ctx.stroke()
          }
          castShadow(ctx, false)
          ctx.globalAlpha = 1
        }
        // REGROW clock on a tile you've gathered — BAKED with the ground (so it
        // costs nothing per frame): a faint socket + a brighter arc filling as the
        // node grows back, full and bright once ready.
        const rg = sim.regrowRingAt(h)
        if (rg) {
          const rr = size * 0.28
          ctx.strokeStyle = ink
          ctx.lineWidth = 2
          ctx.lineCap = "round"
          ctx.globalAlpha = 0.15
          ctx.beginPath()
          ctx.arc(c.x, c.y, rr, 0, Math.PI * 2)
          ctx.stroke()
          ctx.globalAlpha = rg.ready ? 0.8 : 0.45
          ctx.beginPath()
          ctx.arc(c.x, c.y, rr, -Math.PI / 2, -Math.PI / 2 + Math.max(0.02, rg.progress) * Math.PI * 2)
          ctx.stroke()
          ctx.globalAlpha = 1
        }
      }
      // the player's own frontier dots — DISCOVERY marks live in the fog, so they
      // ride the night ink: light points on the blackened unknown after dark
      for (const k of dots) {
        const [q, r] = k.split(",").map(Number)
        const c = hexToPixel(L, q, r, size)
        ctx.fillStyle = nightInk
        ctx.globalAlpha = 0.55
        ctx.beginPath()
        ctx.arc(c.x, c.y, 2.5, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }
    {
      // bake paintField into an offscreen sheet with a pan margin around the
      // viewport; blit it every frame at the camera's current offset. The
      // stamp holds everything the pass reads; straying past the margin or
      // any stamp change re-bakes.
      // NOTE: the field spans the WHOLE canvas (tiles draw across 0..L.h,
      // not just the frame that's inset for the status line) — so the cache
      // and its blit key on L.w/L.h, or the bottom inset band goes unpainted
      const dpr = (ctx.getTransform ? ctx.getTransform().a : 1) || 1
      const M = Math.ceil(Math.max(L.w, L.h) / 4)
      // The stamp holds the DERIVED visible quantities, not their raw
      // drivers: the dots' actual keys and the wall-shadow length in whole
      // pixels (from the COMMITTED energy — never the in-flight counter).
      // A plain move on explored ground then changes nothing the field
      // draws, and costs no bake at all.
      const sunPx = Math.round(sim.dayBudget() - sim.energy()) // committed minute-of-day drives the sun's shadow
      const stamp = [
        sim.worldStamp(),
        sim.day(),
        sunPx,
        size.toFixed(2),
        o.startDeg,
        sim.depth(),
        ink,
        L.w,
        L.h,
        dpr,
        [...dots].sort().join("|")
      ].join(":")
      const cw = Math.ceil((L.w + 2 * M) * dpr)
      const chh = Math.ceil((L.h + 2 * M) * dpr)
      const stale =
        !fieldCache ||
        fieldCache.stamp !== stamp ||
        Math.abs(cam.x - fieldCache.camX) > M - 2 ||
        Math.abs(cam.y - fieldCache.camY) > M - 2
      if (stale) {
        const cnv = fieldCache && fieldCache.cnv.width === cw && fieldCache.cnv.height === chh
          ? fieldCache.cnv
          : document.createElement("canvas")
        cnv.width = cw // also clears
        cnv.height = chh
        const mctx = cnv.getContext("2d")
        mctx.setTransform(dpr, 0, 0, dpr, M * dpr, M * dpr)
        paintField(mctx, M)
        fieldCache = { cnv, stamp, camX: cam.x, camY: cam.y, M, dpr }
      }
      // blit ONLY the viewport's slice of the sheet — never scale the whole
      // margin-padded surface through drawImage
      const fc = fieldCache
      const sx = (cam.x - fc.camX + fc.M) * fc.dpr
      const sy = (cam.y - fc.camY + fc.M) * fc.dpr
      ctx.drawImage(fc.cnv, sx, sy, L.w * fc.dpr, L.h * fc.dpr, 0, 0, L.w, L.h)
    }

    // built CAMPS — a small tent over their tile (a handful at most, so the
    // dynamic layer carries them; they're resting places, worth spotting)
    for (const cmp of sim.camps()) {
      const cp = hexToPixel(L, cmp[0], cmp[1], size)
      if (cp.x < -size || cp.x > L.w + size || cp.y < -size || cp.y > L.h + size) continue
      ctx.strokeStyle = ink
      ctx.lineWidth = 1.5
      ctx.globalAlpha = 0.9
      ctx.beginPath()
      ctx.moveTo(cp.x - size * 0.3, cp.y + size * 0.2)
      ctx.lineTo(cp.x, cp.y - size * 0.28)
      ctx.lineTo(cp.x + size * 0.3, cp.y + size * 0.2)
      ctx.closePath()
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    // (REGROW clocks on tiles you've gathered are BAKED into the ground layer —
    // see paintField — so panning/gliding a big day-N map doesn't re-sweep every
    // gathered tile each frame.)

    // FORAGE map (node dots + regrow rings on tiles you haven't gathered) is
    // deliberately NOT drawn: knowing a tile's yield at a glance is a tech to
    // be earned/learned later (see VISION.md), not a free perk. For now you
    // learn a tile's yield only by standing on it (the info card shows it).

    // STASH cells — a small ring on home tiles holding stored items (only
    // meaningful over the home board, where the tile coords are home-local)
    const onHomeBoard = (() => {
      const bh = sim.boardHexOf(v.player)
      return bh && bh[0] === 0 && bh[1] === 0
    })()
    if (onHomeBoard) {
      for (const st of sim.stashes()) {
        const sp = hexToPixel(L, st.local[0], st.local[1], size)
        if (sp.x < -size || sp.x > L.w + size || sp.y < -size || sp.y > L.h + size) continue
        ctx.strokeStyle = ink
        ctx.lineWidth = 1.5
        ctx.globalAlpha = 0.85
        ctx.beginPath()
        ctx.arc(sp.x, sp.y, size * 0.22, 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalAlpha = 1
      }
    }

    // NIGHT: while the sun is below the horizon the MAP dims to a cool night,
    // deeper toward midnight. It's laid down HERE — right over the ground layer,
    // under everything the player reads and touches (clock, menu, labels, trail,
    // the player cube all draw after), so the dark never fights interaction. A
    // moon that's up lifts the whole gloom; and a soft pool of light stays around
    // the player, so the eye is always drawn there instead of lost in the dark.
    let nightDimAt = () => 1 // by day everything is fully lit
    if (isNight) {
      const depth = Math.max(0, Math.min(1, -sunAlt))
      const moonLight = moon.isUp ? moon.illum : 0
      // REAL darkness now: near-black by a new-moon midnight (~0.82), rising fast
      // out of dusk (the 0.7 power) but continuously from zero at the horizon, the
      // moon lifting the whole gloom. The player's pool keeps the ground underfoot
      // legible — the night is FELT at the edges, never fought in the middle.
      const nightA = 0.82 * Math.pow(depth, 0.7) * (1 - 0.55 * moonLight)
      const pt = ui.pending?.ghostTile || v.player
      const pp = hexToPixel(L, pt[0], pt[1], size)
      const grad = ctx.createRadialGradient(pp.x, pp.y, size * 1.1, pp.x, pp.y, size * 5)
      grad.addColorStop(0, rgba("#0d1021", nightA * 0.15)) // the player's pool of light — barely dim
      grad.addColorStop(1, rgba("#0d1021", nightA)) // full night, out past the pool
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, L.w, L.h)
      // NIGHT SIGHT — the second ring of the double visibility: past your sight
      // range the world falls toward true black, a vignette that tightens the
      // night around you. TWEAKABLE knobs below; UNLOCKABLE by design — wire
      // `nightSightLevel` to a skill/tech when that lands (each level widens the
      // ring), 0 is today's default. Strength rides the night's own depth, so it
      // breathes in at dusk, deepest at a new-moon midnight, and the moon buys
      // you distance.
      const NIGHT_SIGHT_BASE = 3.2 // tiles of usable sight at level 0
      const NIGHT_SIGHT_STEP = 1.6 // + tiles per unlock level
      const NIGHT_SIGHT_FADE = 2.2 // how far past the range it falls to black (× range)
      const nightSightLevel = 0 // ← the unlock hook (skill / tech / torch)
      const sightR = size * (NIGHT_SIGHT_BASE + NIGHT_SIGHT_STEP * nightSightLevel)
      // the rim goes REALLY dark — but its +0.35 floor RAMPS in with the night's
      // first stretch instead of popping on/off exactly at the dawn/dusk crossing
      const edgeA = Math.min(0.96, nightA + 0.35 * Math.min(1, depth / 0.1))
      if (edgeA > 0.01) {
        const vg = ctx.createRadialGradient(pp.x, pp.y, sightR, pp.x, pp.y, sightR * NIGHT_SIGHT_FADE)
        vg.addColorStop(0, rgba("#06070f", 0))
        vg.addColorStop(1, rgba("#06070f", edgeA))
        ctx.fillStyle = vg
        ctx.fillRect(0, 0, L.w, L.h)
      }
      ctx.globalAlpha = 1
      // how visible a point is THROUGH the night — the veil and the vignette's
      // combined transmittance at that spot. Anything drawn OVER the darkness but
      // belonging to the WORLD (figures on their centres) multiplies by this, so
      // the night swallows them exactly as it swallows the ground they stand on.
      nightDimAt = (x, y) => {
        const d = Math.hypot(x - pp.x, y - pp.y)
        const t1 = Math.max(0, Math.min(1, (d - size * 1.1) / (size * 3.9)))
        const t2 = Math.max(0, Math.min(1, (d - sightR) / (sightR * (NIGHT_SIGHT_FADE - 1))))
        return (1 - nightA * (0.15 + 0.85 * t1)) * (1 - edgeA * t2)
      }
    } else {
      // DAYLIGHT — the other half of feeling the cycle: a whisper of the season's
      // own light (the sun's hue IS the day-of-year) washed over the ground,
      // strongest at high sun, gone at the horizons. The day reads LIT, not
      // merely undimmed.
      const lift = Math.max(0, Math.min(1, sunAlt))
      ctx.fillStyle = `hsl(${sunDeg} 70% 62% / ${(0.08 * lift).toFixed(3)})`
      ctx.fillRect(0, 0, L.w, L.h)
    }

    // the day's CLOCK, ringing the board — a 12h face (720min = one turn, 00:00 at
    // the top, clockwise). The orbit ring and hour marks are hidden: the SLEEP line
    // rides at the orbit radius and IS the horizon we read. The day draws as a
    // diagonal landscape of dots ABOVE it — sleep at the ring, move a step up,
    // scout + every other action higher still — lifting out of the sleep ring at
    // 00:00. A dashed line rides ahead to where the way home lands; the wake/home/
    // arrival times mark the ring with their label hairlines. Dot = sun (day of year).
    function drawClock() {
      const ink = nightInk // the WHOLE dial rides the night ink (shadowed on purpose —
      // every line, marker, profile and outline below flips light after dark; the
      // sky wheel's figures alone keep the theme ink, passed explicitly as themeInk)
      const R = sunDialR
      const cx = sunCentre.x
      const cy = sunCentre.y
      const TAU = Math.PI * 2
      const big = size * 0.4 // the reference length for the height scale + label pads
      const at = (a, rad) => [cx + Math.sin(a) * rad, cy - Math.cos(a) * rad] // 0 = 12 o'clock, clockwise
      // the orbit ring + hour marks are HIDDEN — the sleep line, riding at the
      // orbit radius, is the horizon we read; the sun/moon still clip against R.
      const now = spent // minutes since waking — the day begins at 00:00
      const end = dayBudget // the day's full budget — the hard limit; we sleep the rest
      // THE DAY'S LANDSCAPE — the actions we take draw a profile ABOVE the horizon
      // as a diagonal line through dots, each action a point at its HEIGHT. THREE
      // levels only: SLEEP rides AT the orbit radius (h0 — it IS the horizon ring
      // now), MOVE one step up, and SCOUT + every other action (gather, craft,
      // learn, teach…) together on top. (The clock is a 12h face; sleep fills most
      // of the day, so it wraps into one ring at the horizon.)
      const HU = big * 0.42 // one height step between levels
      const H = { sleep: 0, move: HU, high: 2 * HU }
      const actHeight = type => (type === "move" ? H.move : H.high) // scout + all others ride h3
      const angleOf = min => (min / 720) * TAU
      // heights ride OUTWARD for the day's first lap and flip INWARD past noon —
      // the 12h face wraps at 720, and the flip keeps the two laps from writing
      // over each other (morning outside the ring, afternoon inside it)
      const radOf = (min, h) => R + (min > 720 ? -h : h)
      const ptOf = (min, h) => at(angleOf(min), radOf(min, h))

      // the lived day's runs — contiguous same-HEIGHT stretches over 0..now
      const runs = []
      {
        const log = sim.log()
        const meta = sim.logMeta()
        let cum = 0
        let runH = null
        let runStart = 0
        for (let i = 0; i < log.length; i++) {
          const m = meta[i] || 0
          if (m <= 0) continue
          const h = actHeight(log[i].type)
          if (h !== runH) {
            if (runH != null) runs.push({ from: runStart, to: cum, h: runH })
            runH = h
            runStart = cum
          }
          cum += m
        }
        if (runH != null) runs.push({ from: runStart, to: cum, h: runH })
      }
      // draw a STEP-PROFILE through contiguous segments, beginning at (startMin,
      // startH) so the line lifts OUT of that baseline. Each run is a PLATEAU — an
      // arc HELD at its level (following the ring, so it never cuts across the
      // circle) — and each change a one-minute diagonal slope to the next. Just the
      // line, no dots. `dash` + `alpha` give the way-home its provisional look.
      // the profile BOUNDARY walk, shared by the stroked line and the filled band.
      // ONE rule everywhere, minute to minute: hold the level up to a change, then
      // over the change's FIRST minute ramp diagonally up/down to it (flat when
      // unchanged). Ramping forward means every profile begins exactly at its
      // (startMin, startH), so each stroke starts where the previous one ended —
      // the day lifts off where sleep ends at 00:00, the way-home continues from
      // where the day ends — with no backward overlap, no fork.
      const profileLine = (startMin, startH, segs) => {
        const line = []
        // a PLATEAU arc (constant height, following the ring) from a→b. An arc
        // crossing NOON splits there with an explicit pair of points, so the
        // outward→inward flip is a clean radial dive instead of a smeared slant.
        const arc = (a, b, h) => {
          if (b - a < 0.01) return
          if (a < 720 && b > 720) {
            arc(a, 720, h)
            line.push(ptOf(720, h), at(angleOf(720), R - h))
            arc(720.001, b, h)
            return
          }
          const steps = Math.max(1, Math.ceil(Math.abs(angleOf(b) - angleOf(a)) / 0.05))
          for (let i = 1; i <= steps; i++) line.push(ptOf(a + (b - a) * (i / steps), h))
        }
        let curH = startH
        let curMin = startMin
        line.push(ptOf(curMin, curH))
        const lastTo = segs[segs.length - 1].to
        for (const s of segs) {
          if (s.h === curH) continue
          arc(curMin, s.from, curH) // hold the level up to the change
          const rampEnd = Math.min(s.from + 1, s.to) // one minute into the new level
          line.push(ptOf(rampEnd, s.h)) // the one-minute diagonal up/down
          curMin = rampEnd
          curH = s.h
        }
        arc(curMin, lastTo, curH) // the final plateau
        return line
      }
      const drawProfile = (startMin, startH, segs, col, dash = null, alpha = 0.9) => {
        if (!segs.length) return
        ctx.strokeStyle = col
        ctx.globalAlpha = alpha
        ctx.lineWidth = 1
        ctx.lineJoin = "round"
        ctx.lineCap = "round"
        ctx.setLineDash(dash || [])
        const line = profileLine(startMin, startH, segs)
        ctx.beginPath()
        line.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])))
        ctx.stroke()
        ctx.setLineDash([])
        ctx.globalAlpha = 1
      }
      // the FILLED BAND between a profile and the horizon ring — out along the
      // line, back along the ring (h 0), closed: the clock's area under the curve
      const fillProfile = (startMin, startH, segs, col, alpha) => {
        if (!segs.length) return
        const line = profileLine(startMin, startH, segs)
        const lastTo = segs[segs.length - 1].to
        const steps = Math.max(1, Math.ceil(Math.abs(angleOf(lastTo) - angleOf(startMin)) / 0.05))
        for (let i = 0; i <= steps; i++) line.push(ptOf(lastTo + (startMin - lastTo) * (i / steps), 0))
        ctx.fillStyle = col
        ctx.globalAlpha = alpha
        ctx.beginPath()
        line.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])))
        ctx.closePath()
        ctx.fill()
        ctx.globalAlpha = 1
      }
      // append a segment, merging into the last when it's the same height and butts
      // up against it — so a bridged gap never leaves a redundant vertical/dot
      const pushSeg = (arr, seg) => {
        const last = arr[arr.length - 1]
        if (last && Math.abs(last.to - seg.from) < 0.01 && last.h === seg.h) last.to = seg.to
        else arr.push(seg)
      }

      // THE YEAR'S SKY — the skill wheel as CONSTELLATIONS (shared drawSkillWheel, so
      // it can't drift from the styles test dial). Drawn FIRST among the dial's
      // layers: the day's bands, lines, sun and moon all ride ABOVE the stars.
      // SEQUENCED with the menu, never cross-faded: while the menu is up or its ring
      // is still easing home the sky stays out entirely (two figures blending read
      // as a smear). The frame the ring LANDS the constellations simply take its
      // place — the ring has already faded itself out on the way down.
      if (menuTgt !== 1 && menuOpen01 <= 0.001)
        drawSkillWheel(ctx, {
          cx,
          cy,
          R,
          size,
          day: sim.day(),
          sunAlt,
          moonIllum: moon.illum,
          // wedge lines keep the THEME ink (on the light theme they melt into the
          // night); the star DOTS ride the bright night ink, and the GLYPHS show
          // faintly in it too — a figure just visible behind its stars
          ink: themeInk,
          dotInk: nightInk,
          glyphInk: nightInk,
          progressOf: i => sim.skillProgress(STAT_NAMES[i]),
          w: L.w,
          h: L.h
        })

      // the sun + moon at their day angle, wobbling about the orbit — both CLIPPED
      // to OUTSIDE the orbit ring (the horizon), so each is eclipsed (hidden) once
      // it dips below. Near a NEW moon (illum < ½) the moon crosses IN FRONT of the
      // sun; near FULL it sits behind. They only actually overlap at an eclipse.
      // Drawn UNDER the day's bands and lines, so they rise and set BEHIND the
      // activity — and each wears a GLOW: the sun its own tint (the stronger),
      // the moon a soft --surface halo (inside drawMoon).
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, L.w, L.h)
      ctx.arc(cx, cy, R, 0, TAU, true) // punch out the inside of the orbit → keep only outside
      ctx.clip("evenodd")
      const drawSunDot = () => {
        const gr = 26 // the glow's reach
        const g = ctx.createRadialGradient(sunPos.x, sunPos.y, 0, sunPos.x, sunPos.y, gr)
        g.addColorStop(0, `hsl(${sunDeg} 70% 55% / 0.6)`)
        g.addColorStop(1, `hsl(${sunDeg} 70% 55% / 0)`)
        ctx.globalAlpha = 1
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(sunPos.x, sunPos.y, gr, 0, TAU)
        ctx.fill()
        ctx.fillStyle = `hsl(${sunDeg} 70% 55%)`
        ctx.beginPath()
        ctx.arc(sunPos.x, sunPos.y, 6, 0, TAU)
        ctx.fill()
        ctx.strokeStyle = ink // the --text outline, like the moon's
        ctx.lineWidth = 1
        ctx.stroke()
      }
      if (moon.illum < 0.5) {
        drawSunDot()
        drawMoon(ctx, moon, ink, 5, surface)
      } else {
        drawMoon(ctx, moon, ink, 5, surface)
        drawSunDot()
      }
      ctx.restore()

      // SLEEP — the flat baseline plateau AT the horizon (h0), deadline round to
      // midnight; its far end lands at 00:00, where the day's line lifts off
      drawProfile(end, H.sleep, [{ from: end, to: 1440, h: H.sleep }], ink)

      // the LIVED day as contiguous plateaus over 0..now — logged runs, any gap
      // (an in-flight step) bridged at move height
      const litSegs = []
      {
        let cursor = 0
        for (const r of runs) {
          if (r.from - cursor > 0.01) pushSeg(litSegs, { from: cursor, to: r.from, h: H.move })
          pushSeg(litSegs, { from: r.from, to: r.to, h: r.h })
          cursor = r.to
        }
        if (now - cursor > 0.01) pushSeg(litSegs, { from: cursor, to: now, h: H.move })
      }

      // the FORWARD preview continues the line ahead of now: the hovered action at
      // its own height, then the WAY HOME at move height — ink, or red once the
      // trip home can no longer beat the deadline.
      let cost = 0
      let previewH = H.move
      let ret = sim.returnCost() // reserve from where we stand (walk to the nearest rest spot)
      if (ui.pending) {
        // mid-move: the way back tracks the WALKING player (the ghost), landing on
        // the destination's exactly as the player arrives — no snap on commit
        if (ui.pending.ghostTile) ret = sim.returnFrom(ui.pending.ghostTile)
      } else if (ui.menu) {
        if (ui.skillHover?.action) {
          // a hovered learn/teach slot: a lesson's time rises with your level
          cost = ui.skillHover.action === "learn" ? sim.lessonCost(ui.skillHover.skill) : LESSON_COST
          previewH = H.high
        } else {
          // ANY focused button that costs minutes previews on the clock, exactly
          // like hovering a tile: its time ahead of now (in-place work rides high,
          // travel at move height), then the way home from where it would END
          const f = menuNodeById(ui.menu.focusId)
          if (f && !f.disabled && f.cost > 0) {
            cost = f.cost
            previewH = f.high ? H.high : H.move
            if (f.retFrom) ret = sim.returnFrom(f.retFrom)
          }
        }
      } else if (ui.hovered && ui.hoverPath && !ui.hoverIllegal) {
        cost = sim.pathCharge(ui.hoverPath)
        ret = sim.returnFrom(ui.hovered)
      } else if (ui.hovered && sim.isFrontier(ui.hovered) && sim.canScout(ui.hovered)) {
        // hovering a scoutable tile: you stand still to look, so home stays from HERE
        cost = sim.scoutChargeAt(ui.hovered)
        previewH = H.high
      }
      if (!isFinite(ret)) ret = 0
      // the trip home can't beat the deadline — a HOVER warning only. Never during a
      // committed move: canMove already guarantees the reserve, so the mid-walk
      // inflight/ghost desync must not flash the clock red as you retrace home.
      const over = !ui.pending && now + cost + ret > end + 1e-9

      // the DONE band — what the day has actually spent, 00:00 up to NOW, opaque
      // between the lived line and the horizon. FULL BLACK by day; at night it
      // INVERTS with the ink (light on the blackened world), so the spent time
      // never disappears into the dark. Covers map, stars, sun and moon beneath.
      if (litSegs.length) fillProfile(0, H.sleep, litSegs, mixHex("#000", "#e8eaf2", nightInk01), 1)
      // lived day + the hovered action, one plateaued line lifting out of sleep at 00:00
      const daySegs = litSegs.slice()
      if (cost > 0) pushSeg(daySegs, { from: now, to: now + cost, h: previewH })
      drawProfile(0, H.sleep, daySegs, ink)
      // the way home — dashed and lighter — from where the preview leaves off
      if (ret > 0) {
        const from0 = now + cost
        const startH = cost > 0 ? previewH : litSegs.length ? litSegs[litSegs.length - 1].h : H.sleep
        // the WAY-BACK band — the trip home punched out OPAQUE between its line and
        // the horizon: --surface by day, INVERTING to near-black at night (the
        // counterpart of the done band's flip, so the pair keep their contrast on
        // the dark face). OVERTIME floods it red either way — the alarm you can't
        // miss. The dashed line rides its outer edge.
        fillProfile(from0, startH, [{ from: from0, to: from0 + ret, h: H.move }], over ? "#c0433a" : nightSurface, 1)
        drawProfile(from0, startH, [{ from: from0, to: from0 + ret, h: H.move }], over ? "#c0433a" : ink, [4, 3], 0.8)
        // a dot marks NOW — where the way-back ring lifts off the day's line
        const [dx, dy] = ptOf(from0, startH)
        ctx.fillStyle = over ? "#c0433a" : ink
        ctx.globalAlpha = 1
        ctx.beginPath()
        ctx.arc(dx, dy, 2.5, 0, TAU)
        ctx.fill()
      }
      // the FREE-TIME gap — from where you'd arrive home (the way-back's end) on to
      // the deadline: a DOTTED arc at the horizon (h0), the slack still yours. It
      // shrinks as arrival creeps toward the deadline, and is gone once over.
      const arrive = now + cost + ret
      if (arrive < end - 1e-9) drawProfile(arrive, H.sleep, [{ from: arrive, to: end, h: H.sleep }], ink, [1.5, 4], 0.45)
      // (the day's END wears no bold tick — the home label's hairline is its
      // marker now)
      // THE DAY-OF-YEAR MARKER (gated reveal): once your LORE is high enough, the
      // sun's meridian axis draws at its day-of-year angle, so you can read where you
      // are in the cycle even when the sun is down. Below the threshold it's hidden on
      // purpose — early on you don't know, and figuring it out is part of the game.
      const SUN_AXIS_LORE = 6
      if (sim.skillOf("lore") >= SUN_AXIS_LORE) {
        const [ax, ay] = at(sunRad, R - INTRADAY_AXIS)
        const [bx, by] = at(sunRad, R + INTRADAY_AXIS)
        ctx.strokeStyle = ink
        ctx.globalAlpha = 0.4
        ctx.lineWidth = 1
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(bx, by)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.globalAlpha = 1
      }
      // THE DAY'S TIMES — each a TRIANGLE ARROWHEAD riding the ring: its base is
      // the old radial tick (straddling the ring), its tip points along it. The
      // DEADLINE points back (counter-clockwise) at the day; the WAY-BACK's landing
      // points on (clockwise) toward the deadline — the two aim at each other
      // across the free time left between them.
      const arrowMark = (ang, dir, color, rad = R) => {
        // the TIP sits exactly ON the marked time at its own radius; the base
        // trails 7px behind it along the arc (against the pointing direction)
        const tx = Math.cos(ang) * dir // arc tangent: +1 clockwise, −1 counter
        const ty = Math.sin(ang) * dir
        const [px, py] = at(ang, rad)
        const [ax, ay] = at(ang, rad - 4)
        const [bx, by] = at(ang, rad + 4)
        ctx.fillStyle = color
        ctx.globalAlpha = 1
        ctx.beginPath()
        ctx.moveTo(px, py) // the marker itself
        ctx.lineTo(ax - tx * 7, ay - ty * 7)
        ctx.lineTo(bx - tx * 7, by - ty * 7)
        ctx.closePath()
        ctx.fill()
      }
      // both markers ride at STEP-1 height (H.move) and follow the lines' noon
      // rule: outward on the day's first lap, INWARD once past noon
      arrowMark(angleOf(end), -1, ink, radOf(end, H.move)) // ARRIVAL — the deadline, pointing back at the day
      // REMAINING — where you'd land home; red once it can't beat the deadline
      const arriveMin = now + cost + ret
      arrowMark(angleOf(arriveMin), 1, over ? "#c0433a" : ink, radOf(arriveMin, H.move))
    }

    // the 12 skills on the SKILL WHEEL (skillWheel — same as the night sky), shown
    // while the menu is open: all visible, riding up/down over the year. Each glyph
    // sits on the wheel with its learn/teach sign just INWARD, reading as a little
    // triangle. Facing a figure: + (a lesson to take) or − (a level to give). A
    // learn slot is CLICKABLE (the lesson). Standing on land rings its favoured skill.
    function drawSkills() {
      // the ring rides the NIGHT pair (shadowed on purpose): wedges, dots, glyphs
      // and signs flip to the light ink after dark, and the hover fills invert to
      // the night surface — readable over the blackened, blurred world. By day
      // both are the theme colours, so this is a no-op there.
      const ink = nightInk
      const surface = nightSurface
      skillLayout = []
      // the ring's opacity floor is the SKY's own alpha, so the handoff is seamless
      // in both directions: on close the figures fade DOWN TO exactly what the
      // constellations will draw at (never dipping out and reappearing), and on open
      // the ring picks up AT the alpha the sky just cut out from. By day skyVis is 0
      // and this is a plain fade. Menu-only CHROME (dashed not-yet edges, the npc
      // shape, the +/− sign) still fades all the way out — the sky doesn't draw it.
      const skyVis = Math.max(0, -sunAlt) * (1 - 0.85 * moon.illum)
      const fade = skyVis + (1 - skyVis) * menuOpen01
      const chrome = menuOpen01
      const now = performance.now()
      const dt = skillRotT ? Math.min(64, now - skillRotT) : 16
      skillRotT = now
      const rotK = 1 - Math.exp(-dt / SKILL_ROT_TAU) // soft per-frame approach toward the target
      skillRotBusy = false
      const R = sunDialR
      const cx = sunCentre.x
      const cy = sunCentre.y
      const TAU = Math.PI * 2
      const iconR = size / 0.9 // wedge-hex (drawn at r·0.9) equals a full grid hex
      const ringR = iconR * 0.9 // your level ring (= the hex circumradius) — and the glyph's HIT radius
      const ringN = ringR * 0.8 // the npc/button ring — a bit smaller than yours; the sign's HIT radius
      const bc = sim.boardHexOf(v.player)
      const faced = bc && sim.npcAt(bc)
      const npc = faced && eq(faced.pos, v.player) ? faced : null
      // frames keep coming only while an action sign is HOVERED — that's when the
      // ants march and the learn/teach previews breathe; otherwise the ring is still
      menuAnts = !!ui.menu && !!npc && !!ui.skillHover?.action
      ctx.textBaseline = "middle"
      // THE SWEEPING HORIZON — CLOSE ONLY (opening just raises the ring, no cut): a
      // clip circle grows from the dial's centre out to the ring (landed: EXACTLY the
      // sky drawer's horizon clip), so figures geometrically SET below it — the same
      // pixels the sky will draw, at the same alpha; the handoff can't pop for anyone,
      // half-risen included. The radius rides the close's LINEAR clock on its own
      // quart ease-out — NOT the already-eased menuOpen01 (composing two quarts made
      // the visible crossing a fast early burst): it clears the empty centre in the
      // quick start and spends the whole long settle crossing the figures' outer
      // band, landing on the ring exactly as the close ends.
      const clipping = menuTgt === 0 && menuOpen01 > 0.001
      const clipR = clipping ? R * easeOutQuart(Math.min(1, (now - menuT0) / MENU_MS)) : 0
      if (clipping) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(0, 0, L.w, L.h)
        ctx.arc(cx, cy, clipR, 0, TAU, true)
        ctx.clip("evenodd")
      }
      STAT_NAMES.forEach((s, i) => {
        // the glyph rides the SAME rotating wheel as the night sky; ux/uy is its
        // OUTWARD unit (it moves, so it's read from the wheel, not a fixed angle)
        const { x: iconX, y: iconY, th, ux, uy } = skillWheel(i)
        // wholly below the sweeping horizon — the clip would eat every pixel anyway
        if (clipping && Math.hypot(iconX - cx, iconY - cy) + iconR * 1.2 < clipR) return
        // rotation is the constellation's own tilt (−th) at rest, easing to upright (0)
        // while the pointer is on it — soft, slow, the shortest way round. On the frame
        // the menu opens it SNAPS to the tilt (skillRotInit), so it keeps whatever
        // rotation it had rather than spinning into place.
        const rest = -th
        const target = ui.skillHover?.skill === s ? 0 : rest
        if (!skillRotInit) skillRot[i] = rest
        else {
          let d = target - skillRot[i]
          d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI // shortest way round
          if (Math.abs(d) > 0.002) {
            skillRot[i] += d * rotK
            skillRotBusy = true
          } else skillRot[i] = target
        }
        const spin = skillRot[i]
        const numX = iconX - ux * (ringR + ringN) // the learn/teach sign, just INWARD of the glyph
        const numY = iconY - uy * (ringR + ringN)
        const you = sim.skillOf(s)
        const them = npc ? sim.npcSkill(npc, s) : null
        const learn = npc && them > you // ← they outrank you: a lesson to take
        const teach = npc && you > them && them < npc.stats[s] // → you outrank them and they've room to grow
        // hover lights ONE section, never the whole icon: the glyph lights
        // YOUR shape, the sign lights the FIGURE's — the other stays ink at
        // half strength
        const action = learn ? "learn" : teach ? "teach" : null
        const glyphHover = ui.skillHover?.skill === s && ui.skillHover.kind === "info"
        // a stale action-hover (its button just vanished) must NOT light — gate on `action`
        const signHover = !!action && ui.skillHover?.skill === s && ui.skillHover.kind === "action"
        // the icon-hover amount — same time constant as the straighten, so the
        // shape fill fades in/out IN SYNC with the rotation
        if (!skillRotInit) skillHovA[i] = glyphHover ? 1 : 0
        else {
          const dH = (glyphHover ? 1 : 0) - skillHovA[i]
          if (Math.abs(dH) > 0.01) {
            skillHovA[i] += dH * rotK
            skillRotBusy = true
          } else skillHovA[i] = glyphHover ? 1 : 0
        }
        // the POLYGON'S PHASE: the shapes never do the constellation rotation (only
        // the glyph does) — they sit WHEEL-ANCHORED, phased so the vertex where the
        // GROWING edge starts is always at the INWARD tangent point (the dot shared
        // with a figure's shape). Gaining an edge steps the target one dot forward,
        // giving one steps it back — eased, so the shape ROTATES to the next dot.
        const prog = sim.skillProgress(s)
        const phTarget = Math.PI - (prog.filled / prog.sides) * TAU // vertex `filled` → inward
        if (!skillRotInit) skillPhase[i] = phTarget
        else {
          let dP = phTarget - skillPhase[i]
          dP = (((dP + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)) - Math.PI // shortest way round
          if (Math.abs(dP) > 0.002) {
            // only a DELIBERATE step — a lesson or a give landing under your
            // pointer — rotates to the next dot. Background steps (walk practice
            // committing a travel edge at the end of a go-home, say) SNAP silently:
            // no ghost pirouette on an unattended figure the moment a walk lands.
            if (ui.skillHover?.skill === s) {
              skillPhase[i] += dP * rotK
              skillRotBusy = true
            } else skillPhase[i] = phTarget
          } else skillPhase[i] = phTarget
        }
        // (icon hover fills the shape itself — see the fill just before the wedges)
        ctx.globalAlpha = 1
        // level dots: your level as N points evenly spaced around the icon's
        // circumscribed circle (radius = the hex's top/bottom points), point 0
        // pointing OUTWARD (toward the clock). N points read as a polygon —
        // 3 = triangle, 4 = square… Facing a figure, its level draws as a
        // dashed polygon on the NPC CIRCLE — its own ring, tangent to the
        // icon's just inward, with the sign at its centre.
        const dotR = size * (0.04 + 0.02 * menuOpen01) // eases to the sky's tinier stars at the teardrop
        // WHEEL-ANCHORED (rotated by the outward unit u), NEVER spun by the
        // constellation rotation: basis angle 0 = outward, π = inward — so the
        // phase that puts a vertex at π lands it exactly on the tangent point the
        // figure's shape touches. The sky uses the same basis, so menu and sky
        // shapes are always identical without any bridging.
        const dotPts = (n, ox, oy, off = 0, rad = ringR) => {
          const pts = []
          for (let k = 0; k < n; k++) {
            const ph = (k / n) * TAU + off
            const rx = ux * Math.cos(ph) - uy * Math.sin(ph)
            const ry = ux * Math.sin(ph) + uy * Math.cos(ph)
            pts.push([ox + rx * rad, oy + ry * rad])
          }
          return pts
        }
        // YOUR shape is the level's PROGRESS BAR: a dashed polygon of `sides`
        // edges (one more each level), the edges you've LEARNED drawn solid, the
        // current edge filled by `partial`, the rest dashed. A learn-hover LIGHTS
        // the next edge the lesson would complete — so you see it about to appear.
        // NO phase games: the polygon keeps the constellation's own orientation
        // (facing a figure included), so it always matches its sky twin exactly.
        const seg = (ax, ay, bx, by, dash, alpha, col) => {
          ctx.strokeStyle = col || ink
          ctx.setLineDash(dash || [])
          ctx.globalAlpha = alpha
          ctx.beginPath()
          ctx.moveTo(ax, ay)
          ctx.lineTo(bx, by)
          ctx.stroke()
        }
        const progressPoly = (pts, filled, partial, lit, mul, dashMul) => {
          const n = pts.length
          if (n < 2) return
          const HL = ink // the learn preview stays ink — its GROWTH (below) is what sets it apart
          for (let k = 0; k < n; k++) {
            const [ax, ay] = pts[k]
            const [bx, by] = pts[(k + 1) % n]
            const at = f => [ax + (bx - ax) * f, ay + (by - ay) * f]
            if (k < filled) seg(ax, ay, bx, by, null, mul) // learned — solid ink
            else if (k === filled && lit) {
              // the lesson completes THIS edge: keep what practice earned in ink, then
              // GROW the rest in colour (a breathing fill) so you watch the edge appear
              const grow = (1 - Math.cos(performance.now() / 260)) / 2 // 0→1→0
              const [mx, my] = at(partial)
              if (partial > 0.001) seg(ax, ay, mx, my, null, mul) // already earned by practice
              const [gx, gy] = at(partial + (1 - partial) * grow)
              seg(mx, my, gx, gy, null, 1, HL) // the growing fill, in colour
              seg(gx, gy, bx, by, [3, 3], 0.5, HL) // the not-yet-grown remainder, dashed colour
            } else if (k === filled && partial > 0.001) {
              const [mx, my] = at(partial)
              seg(ax, ay, mx, my, null, mul) // the current edge, solid up to its fill…
              seg(mx, my, bx, by, [3, 3], dashMul) // …dashed the rest
            } else seg(ax, ay, bx, by, [3, 3], dashMul) // still to learn — dashed
          }
          ctx.strokeStyle = ink // restore for the npc shape + dots that follow
          ctx.setLineDash([])
        }
        const mine = dotPts(prog.sides, iconX, iconY, skillPhase[i])
        // icon hover FILLS the shape itself — a --surface backing rising with
        // skillHovA (the same clock as the straighten, so fill and rotation move
        // as one); the wedges, dots and glyph draw over it
        const hovA = skillHovA[i]
        if (hovA > 0.01 && mine.length >= 3) {
          ctx.fillStyle = surface
          ctx.globalAlpha = hovA * fade
          ctx.beginPath()
          mine.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])))
          ctx.closePath()
          ctx.fill()
        }
        ctx.strokeStyle = ink
        ctx.lineWidth = 0.75 + 0.25 * menuOpen01 // eases to the sky's thinner wedges at the teardrop
        // a TEACH hover HINTS at the loss: the fill breathes down by just under
        // half an edge — a hint, deliberately NOT the full −1, so the click's real
        // drop lands visibly BELOW anything the preview showed (a preview that
        // reaches the final state masks the very change it announces)
        let pf = prog.filled
        let pp = prog.partial
        if (signHover && teach) {
          const drain = 0.45 * ((1 - Math.cos(performance.now() / 260)) / 2) // 0→0.45→0
          const eff = Math.max(0, prog.filled + prog.partial - drain)
          pf = Math.floor(eff)
          pp = eff - pf
        }
        // hover no longer dims the shape — the surface FILL is the hover cue, and
        // the wedges/dots ride it at full strength
        progressPoly(mine, pf, pp, signHover && learn, fade, 0.35 * chrome)
        // an equal shape with no button to act on says nothing — skip it
        if (npc && (them !== you || action)) {
          // the figure's shape is a PROGRESS shape like yours — the edges you've
          // taught drawn solid, the rest dashed — phased so its RECEIVING edge
          // grows OUT of the shared tangent dot (vertex `filled` at basis 0). A
          // teach hover breathes that next edge in (the mirror of your drain)
          // instead of pre-drawing the final state, so the click lands visibly.
          const tp = sim.npcProgress(npc, s)
          const theirs = dotPts(tp.sides, numX, numY, -(tp.filled / tp.sides) * TAU, ringN)
          // weighing the exchange FILLS the figure's shape too — same surface backing
          if (signHover && theirs.length >= 3) {
            ctx.fillStyle = surface
            ctx.globalAlpha = chrome
            ctx.beginPath()
            theirs.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])))
            ctx.closePath()
            ctx.fill()
          }
          if (signHover) ctx.lineDashOffset = -((performance.now() / 40) % 6) // the ants — only while weighing
          const mulT = (signHover ? 1 : 0.95) * chrome // as present as the icons; full while weighing
          progressPoly(theirs, tp.filled, tp.partial, signHover && teach, mulT, 0.35 * mulT)
          ctx.lineDashOffset = 0
        }
        ctx.globalAlpha = fade // full-strength dots, hovered or not — the fill carries the hover
        ctx.fillStyle = ink
        for (const [px, py] of mine) {
          ctx.beginPath()
          ctx.arc(px, py, dotR, 0, TAU)
          ctx.fill()
        }
        // the learn/teach BUTTON — a bare sign where the number used to sit; THIS
        // is the click target for the action (+ take a lesson / − give a level).
        // The glyph above stays reserved for info.
        if (action) {
          ctx.font = `700 ${Math.round(size * 0.95)}px system-ui, sans-serif`
          ctx.globalAlpha = chrome
          ctx.textAlign = "center"
          ctx.fillStyle = ink // plain text colour, hover changes nothing
          ctx.fillText(learn ? "+" : "−", numX, numY)
          // the npc circle IS the hit area (tangent to the icon's — no overlap)
          skillLayout.push({ skill: s, x: numX, y: numY, r: ringN, kind: "action", action })
        }
        // the glyph draws LAST — above the fill, the dots and the hairlines.
        // Only IT does the constellation rotation (rest −th, hover → upright);
        // the shape around it stays wheel-anchored.
        ctx.save()
        ctx.translate(iconX, iconY)
        ctx.rotate(spin)
        // 0.95 in the menu, easing to the sky's full-vis glyph at the teardrop
        drawIcon(ctx, SKILL_ICON[s], 0, 0, iconR, ink, (0.95 + 0.05 * (1 - menuOpen01)) * fade)
        ctx.restore()
        // the glyph is always an info target (hover → name, level + reference);
        // its level ring IS the hit area
        skillLayout.push({ skill: s, x: iconX, y: iconY, r: ringR, kind: "info" })
      })
      if (clipping) ctx.restore() // drop the sweeping horizon
      skillRotInit = true // subsequent frames EASE from here (only the first snaps)
      ctx.textAlign = "left"
      ctx.globalAlpha = 1 // leave the context clean for whatever draws next
    }
    // hover highlight (movable target tile)
    if (ui.hovered && ui.hoverPath) {
      fillHex(ctx, hexToPixel(L, ui.hovered[0], ui.hovered[1], size), size, ink, 0.12, o.startDeg)
    }
    // hovering a reachable (dotted) undiscovered tile — PEERING INTO THE FOG: a
    // soft glow pools in the cell (the fog's own soft language, no hard fill),
    // under the outline. Both ride the night ink, so the effect reads on the
    // blackened unknown after dark too (theme ink went invisible there).
    if (ui.hovered && !sim.isDiscovered(ui.hovered) && dots.has(key(ui.hovered))) {
      const c = hexToPixel(L, ui.hovered[0], ui.hovered[1], size)
      const cs = hexCorners(c.x, c.y, size, o.startDeg)
      const glow = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, size)
      glow.addColorStop(0, rgba(nightInk, 0.16))
      glow.addColorStop(1, rgba(nightInk, 0))
      ctx.beginPath()
      for (let i = 0; i < 6; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, cs[i].x, cs[i].y)
      ctx.closePath()
      ctx.fillStyle = glow
      ctx.globalAlpha = 1
      ctx.fill()
      ctx.strokeStyle = nightInk
      ctx.globalAlpha = 0.45
      ctx.lineWidth = 1.5
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

    // the hover readout's geometry, laid out up-front so its leader FAN can be
    // drawn UNDER the hover trail; the box + text land later, on top. (The menu's
    // focus label has no trail to worry about, so it stays a plain cursorLabel.)
    let hoverLabel = null
    if (ui.pointer && !ui.menu && !ui.pending && ui.hovered) {
      const h = ui.hovered
      const hb = sim.boardHexOf(h)
      // board tiles read as PARENT + local — the local alone is relative to
      // its board's centre and says nothing about WHICH board; seam tiles
      // (nobody's board) keep their global coords
      const l2 = hb
        ? `[${hb[0]},${hb[1]}] [${h[0] - sim.boardCentreOf(h)[0]},${h[1] - sim.boardCentreOf(h)[1]}]`
        : `[${h[0]},${h[1]}]`
      const homeTile = !!hb && hb[0] === 0 && hb[1] === 0 // any tile of the home board
      // the land card's content rides the hover — a block of the tile's own
      // facts beneath the cost readout (known ground only, no spoilers). It
      // also stands ALONE where no move can be priced (water, say), so every
      // discovered tile answers the pointer.
      const land = !eq(h, v.player) && sim.isDiscovered(h) ? sim.landAt(h) : null
      // a CENTRE tile isn't land — it's the BOARD's tile: hovering one (once
      // discovered) reads as the board's overview plus who lives there, name
      // and npub. Home's own centre stays silent (that figure is you).
      const bh2 = !eq(h, v.player) && sim.isDiscovered(h) ? sim.boardHexOf(h) : null
      const fig = bh2 && sim.npcAt(bh2)
      const centreNpc = fig && eq(fig.pos, h) ? fig : null
      // a HOME tile refers to a whole board (the minimap): hovering it reads
      // as that board's overview too — full once its centre is found, basics
      // before (home's local coords ARE the parent hex: local == global)
      const homeRef = bh2 && bh2[0] === 0 && bh2[1] === 0 && (h[0] || h[1]) ? h : null
      // …and once that board's centre is known, its figure NAMES the tile
      const homeNpc = homeRef && sim.parentOf().tile.children[key(homeRef)]?.discovered.has("0,0") ? sim.npcAt(homeRef) : null
      let l1 = null
      let coordsInline = false // the first line fell back to bare coords
      if (ui.hoverPath) {
        // the destination by NAME (a figure's tile, a known board's home tile)
        // or TYPE (its biome); bare coords only where nothing better is known
        const named = centreNpc || homeNpc
        const dest = named ? npcName(named.pubkey) : land ? land.biome : homeTile ? "home" : ((coordsInline = true), l2)
        l1 = `${Math.round(sim.pathCharge(ui.hoverPath))}m to ${dest}` // crossing a seam is just a move
      } else if (sim.isFrontier(h) && sim.canScout(h)) {
        coordsInline = !homeTile
        l1 = `${Math.round(sim.scoutChargeAt(h))}m scouting ${homeTile ? "home" : l2}`
      }
      // no route, no scout — the pointer is aiming at KNOWN ground we can't
      // reach (far fog says nothing at all: not adjacent, not ours to judge)
      const noRoute = !eq(h, v.player) && !ui.hoverPath && !sim.isFrontier(h) && sim.isDiscovered(h)
      // the label just states the facts: the priced move (red when it would
      // cost past the time left — see the `hoverIllegal` colour below), the
      // tile's own card, or "unreachable" when known ground has no way there.
      if (l1 || land || centreNpc || homeRef) {
        const lines = []
        // the FIRST line: the priced move, or the reason there isn't one, or
        // bare coords as the last resort. The tile's HEIGHT (elevation,
        // deepness on water) rides the END of the coords line as a single
        // value in its own box — wherever the coords landed.
        const val = land ? { text: String(land.deepness != null ? land.deepness : land.elevation), alpha: 0.6, small: true } : null
        let first
        if (l1) first = { text: l1, color: ui.hoverIllegal ? "#c0433a" : ink }
        else if (noRoute && land && !land.impassable) first = { text: "unreachable", color: "#c0433a" }
        else {
          first = { text: l2, alpha: 0.6 }
          coordsInline = true
        }
        lines.push(coordsInline && val ? { cells: [first, val] } : first)
        // the coords on their own line — unless the first already has them
        if (!coordsInline) {
          const coords = { text: l2, alpha: 0.6, small: true }
          lines.push(val ? { cells: [coords, val] } : coords)
        }
        // water states its price of entry: the shallows will take swimmers,
        // the depths a boat, the deeps a bigger one (mechanics to come)
        if (land?.impassable)
          lines.push({ text: land.deepness < 1 ? "needs swimming" : land.deepness < 2 ? "needs a boat" : "needs a bigger boat", alpha: 0.6, small: true })
        // one board's overview, by its parent hex: the figure (name + npub)
        // and the board's TRAITS — its main land type (the most common biome
        // over its 60 land tiles) and how much stands discovered. Until the
        // board's CENTRE is found only the basics show: the percentage (the
        // coords line above is already there).
        const boardLines = c => {
          const node = sim.parentOf().tile.children[key(c)]
          const pct = { text: `${Math.round(((node?.discovered.size ?? 0) / 61) * 100)}% discovered`, alpha: 0.6, small: true }
          const npc2 = sim.npcAt(c)
          if (!npc2 || !node?.discovered.has("0,0")) {
            // before the centre is known, say what the tile's PAINT already
            // shows — the board's seed nibble, read in the terrain bands.
            // At 0% NOTHING is known: an untouched board keeps its secret.
            const chs = (node?.discovered.size ?? 0) > 0 ? sim.nibbleAt(c) : null
            if (chs) {
              const v2 = [...chs].reduce((s2, c2) => s2 + parseInt(c2, 16), 0) / chs.length
              const band = v2 < WATER_LEVEL ? "water" : v2 >= 12 ? "mountain" : "plain"
              return [{ text: `mostly ${band}`, alpha: 0.6, small: true }, pct]
            }
            return [pct]
          }
          // (no name line here — the figure already NAMES the first line)
          const np = npubEncode(npc2.pubkey)
          // the figure's SKILLS, compact: two rows of four
          const sk = STAT_NAMES.map(s2 => `${s2} ${sim.npcSkill(npc2, s2)}`)
          return [
            { text: `${np.slice(0, 12)}…${np.slice(-4)}`, alpha: 0.6, small: true },
            { text: sk.slice(0, 4).join(" · "), alpha: 0.6, small: true },
            { text: sk.slice(4).join(" · "), alpha: 0.6, small: true },
            { text: `mostly ${sim.boardMainType(c)}`, alpha: 0.6, small: true },
            pct
          ]
        }
        if (centreNpc) lines.push(...boardLines(bh2))
        else if (homeRef) lines.push(...boardLines(homeRef))
        hoverLabel = labelLayout(ctx, L, ui.pointer, lines, size, false, playerClear())
      }
    }
    labelFan(ctx, hoverLabel) // under the trail

    // committed walked route (solid ink line + per-leg arrowheads) + a dashed
    // hover preview. Simple ink strokes, no border. An illegal hover reads in a
    // muted red and ends in an X instead of an arrowhead.
    const hov = ui.hoverPath
    const bad = ui.hoverIllegal
    const hovColor = bad ? "#c0433a" : ink
    // yesterday's walk, kept as a faint dashed ghost you can retrace back to where
    // you stood — drawn UNDER everything, no arrows, so it never competes.
    const ghost = sim.prevTrail()
    if (ghost && ghost.length >= 2) strokePath(ctx, L, size, ghost, ink, 1.5, 0.16, [4, 5])
    // the way home: the shortest walk from where we stand to the home centre —
    // still UNTRAVELLED, so drawn lighter, with arrowheads pointing home
    // mid-move the way home runs from the WALKING player (the ghost), so the
    // trail tracks along and lands home with them rather than snapping at commit
    const home = ui.pending?.ghostTile ? sim.homePathFrom(ui.pending.ghostTile) : sim.homePath()
    if (home && home.length >= 2) {
      strokePath(ctx, L, size, home, ink, 1.5, 0.4)
      trailArrows(ctx, L, size, home, ink, 1.5, 0.4)
    }
    // the traveled trail: the full day's record, full black and a touch thicker
    strokePath(ctx, L, size, trail, ink, 2, 1)
    trailArrows(ctx, L, size, trail, ink, 2, 1)
    // the hover preview follows the cursor: it runs tile-centre to tile-centre as
    // usual, but the LAST leg anchors where it enters the hovered tile (the edge
    // crossing) and finishes at the cursor rather than the tile's centre.
    if (hov && hov.length >= 2) {
      const pts = hov.map(h => hexToPixel(L, h[0], h[1], size))
      let entry = pts[pts.length - 2] // fallback: the prior tile centre
      if (ui.pointer) {
        const last = pts[pts.length - 1]
        const prev = pts[pts.length - 2]
        entry = { x: (last.x + prev.x) / 2, y: (last.y + prev.y) / 2 } // the edge crossing
        pts[pts.length - 1] = entry
        pts.push({ x: ui.pointer.x, y: ui.pointer.y })
      }
      const tip = pts[pts.length - 1]
      strokePixels(ctx, pts, hovColor, 1.5, bad ? 0.7 : 0.6, [5, 5])
      if (bad) crossTip(ctx, tip.x, tip.y, hovColor, size, 2, 0.8)
      else {
        ctx.globalAlpha = 0.6
        arrowTip(ctx, entry.x, entry.y, tip.x, tip.y, ink, size * 0.32, size * 0.2, 1.5)
        ctx.globalAlpha = 1
      }
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
    // the same whichever way the tiles sit. The liquid budget fill is STASHED
    // (the clock carries the time markers now): a plain surface body over a
    // full backing that keeps the sun's shadow strictly on the outside; the
    // bold Y is its identity.
    const S3 = 0.8660254 // √3/2 — the pointy hex's horizontal reach
    const drawEnergyCube = (x, y, r) => {
      const w = r * S3 // lid/surface diamond half-width
      const h = r / 2 // …and half-height (the pointy hex's side vertices sit at ±h)
      // one board-wide sun direction (computed from the centre tile). The
      // cast shadow aims away along it.
      const [tsx, tsy] = sunTo // toward-sun unit
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
      // 1) the cast shadow — a REAL floor projection. The cube's BASE (its bottom
      // face, a rhombus flat on the tiles) is swept along the ground away from the
      // sun by the sun-low length; the shadow is the convex hull of that base and
      // its swept copy. Emerges from the foot of the cube on the shadow side (down
      // the sun→cube line), long when the sun is low, hue-tinted and softened.
      // reaches ~the tile edge only at sunrise/sunset, shrinking to nothing at
      // noon — so the clip is invisible except at the day's extremes.
      // dayExtreme 0 (night, noon) → zero-length shadow: skip the whole step —
      // the hull would be degenerate and ctx.filter forces an intermediate
      // surface per fill, a real per-frame cost for invisible pixels.
      if (dayExtreme > 0.01) {
      const span = size * 0.6 * dayExtreme
      const Sx = -tsx * span
      const Sy = -tsy * span
      // the base rides the cube's OUTER edge: the bold outline (width W) sits
      // half outside the raw hex, so inflate the footprint by W/2
      const rb = r + W / 2
      const wb = rb * S3
      const hb = rb / 2
      const base = [
        [x, y + rb], // front-bottom corner (on the floor)
        [x + wb, y + hb], // right-bottom
        [x, y], // back-bottom (projects to the centre)
        [x - wb, y + hb] // left-bottom
      ]
      const pts = base.concat(base.map(p => [p[0] + Sx, p[1] + Sy]))
      // convex hull (monotone chain) of the base + its swept copy
      pts.sort((a, b) => a[0] - b[0] || a[1] - b[1])
      const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
      const half = seq => {
        const out = []
        for (const p of seq) {
          while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop()
          out.push(p)
        }
        out.pop()
        return out
      }
      const hull = half(pts).concat(half(pts.slice().reverse()))
      ctx.save()
      // keep the shadow within the tile it stands on — clipped to the tile hex,
      // so it reaches the edge at most and never spills onto a neighbour
      const tile = hexCorners(x, y, size, o.startDeg)
      ctx.beginPath()
      tile.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)))
      ctx.closePath()
      ctx.clip()
      ctx.filter = "blur(2px)"
      // MULTIPLY onto the tiles below: darkens their own colours instead of
      // laying a murky grey slab over them, so the shadow keeps the ground's hue
      // and just deepens it — a real cast. The fill is the day's full colour;
      // multiply supplies the darkness.
      ctx.globalCompositeOperation = "multiply"
      ctx.globalAlpha = 0.9
      ctx.beginPath()
      hull.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])))
      ctx.closePath()
      ctx.fillStyle = `hsl(${sunDeg} 55% 60%)`
      ctx.fill()
      ctx.restore()
      }
      // 2) opaque white backing — the body sits solid over its own shadow
      hex()
      ctx.fillStyle = surface
      ctx.globalAlpha = 1
      ctx.fill()
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
      // (the budget readout moved off the lid — it rides the clock at the NOW
      // angle; see drawClock)
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
    // where the cube is actually DRAWN: the continuous glide position mid-move,
    // else the tile it stands on. gliding suppresses the resting-stack snap below.
    const cubePos = ui.pending?.ghostPos || cubeTile
    const gliding = !!ui.pending?.ghostPos
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
      // mid-glide the cube never sits IN a stack — it slides over the ground as
      // the standalone cup below, so a centre it passes shows its empty seat.
      // Stacks belong to the WORLD: at night they dim with the ground they stand
      // on (a figure across the map is swallowed by the dark, not a beacon) —
      // the player's own stack sits in the light pool, so it barely dims.
      const here = eq(centre, cubeTile) && !gliding
      const dim = nightDimAt(cp.x, cp.y)
      if (dim > 0.02) {
        ctx.globalAlpha = dim
        drawStack(cp.x, cp.y, here, !!sim.npcAt(bc))
        ctx.globalAlpha = 1
      }
      if (here) playerDrawn = true
    }
    // the player anywhere else (and always mid-glide): the standalone cup, drawn
    // at the continuous position so it walks tile to tile
    if (!playerDrawn) {
      const pc = hexToPixel(L, cubePos[0], cubePos[1], size)
      drawEnergyCube(pc.x, pc.y, size * (2 / 3))
    }

    // a GATHER mark on the tile underfoot when it yields something ready — you
    // learn a tile's forage only by standing on it (the map itself stays fogged),
    // and the on-screen button offers the pick one click away
    if (sim.gatherStateAt(v.player)?.ready) {
      const gp = hexToPixel(L, v.player[0], v.player[1], size)
      drawIcon(ctx, "gather", gp.x, gp.y - size * 0.62, size * 0.4, ink, 0.9)
    }

    // the clock rides ABOVE the world — trail, tiles, cubes all draw under it.
    // Menu frames draw it AFTER the world-blur snapshot instead — drawing it
    // here too would leave its blurred ghost under the sharp redraw, reading
    // as a drop shadow
    if (!ui.menu) drawClock()
    // on CLOSE the menu is already gone (ui.menu null) but the ring is still easing
    // back down to the sky — keep drawing it over the world until it settles
    if (!ui.menu && menuOpen01 > 0.001) drawSkills()

    // the radial menu — laid out on the REAL hex grid (6 slots on the
    // player's neighbours; a folder fans onto outward cells, ≤3 then ≤5 = 8).
    // Z-order, lowest first: blurred map → menu → tile → player → npc (the
    // last three arrive together as the punched-out sharp redraw, ON TOP of
    // the menu — the player/figure stacking is already in the snapshot).
    menuLayout = null
    skillLayout = []
    if (ui.menu) {
      const P = v.player
      const hub = hexToPixel(L, P[0], P[1], size)

      // blur + dim the whole world (the sharp tile is punched back AFTER the menu is
      // drawn, so it sits above the silhouette). Cached on a stamp of everything under
      // it: view (camera/canvas/theme) AND world/time (an in-menu learn spends minutes —
      // sun, shadows and ground all move, and a stale backdrop or punch-out tile would
      // show the old world). Two caches:
      //  - menuSnap: full-res SHARP copy for the punch-out — a plain blit.
      //  - menuBlur: the backdrop, rendered at QUARTER resolution — it's blurred anyway,
      //    so upscaling it is visually lossless, and the filter cost drops ~16×. That
      //    makes it cheap enough to rebuild on every glide frame, so the blurred world
      //    TRACKS the camera during the open recenter instead of freezing and snapping.
      // Canvas sizes are only reassigned when they actually differ — reassigning even
      // the same size reallocates the whole backing store (an allocation storm at 60fps).
      const cv = ctx.canvas
      const dpr = cv.width / L.w
      const blurStamp = [
        cv.width, cv.height, Math.round(cam.x), Math.round(cam.y), surface,
        sim.worldStamp(), sim.day(), Math.round(sim.dayBudget() - sim.energy())
      ].join("|")
      if (!menuBlur) menuBlur = document.createElement("canvas")
      if (!menuSnap) menuSnap = document.createElement("canvas")
      if (menuSnap.width !== cv.width) menuSnap.width = cv.width
      if (menuSnap.height !== cv.height) menuSnap.height = cv.height
      const BLUR_SCALE = 4 // backdrop downscale (device px) — blur radius scales to match
      const bw = Math.max(1, Math.round(cv.width / BLUR_SCALE))
      const bh = Math.max(1, Math.round(cv.height / BLUR_SCALE))
      if (menuBlur.width !== bw) menuBlur.width = bw
      if (menuBlur.height !== bh) menuBlur.height = bh
      if (menuSnapStamp !== blurStamp) {
        const sx = menuSnap.getContext("2d")
        sx.setTransform(1, 0, 0, 1, 0, 0)
        sx.clearRect(0, 0, cv.width, cv.height)
        sx.drawImage(cv, 0, 0) // SHARP copy for the punch-out
        menuSnapStamp = blurStamp
      }
      if (menuBlurStamp !== blurStamp) {
        const bx = menuBlur.getContext("2d") // BLURRED + dimmed backdrop, quarter-res
        bx.setTransform(1, 0, 0, 1, 0, 0)
        bx.clearRect(0, 0, bw, bh)
        bx.filter = `blur(${((6 * dpr) / BLUR_SCALE).toFixed(2)}px)` // ≙ blur(6px) CSS at full res
        bx.drawImage(cv, 0, 0, bw, bh)
        bx.filter = "none"
        bx.globalAlpha = 0.22
        bx.fillStyle = nightSurface // the dim wash inverts with the night
        bx.fillRect(0, 0, bw, bh)
        bx.globalAlpha = 1
        menuBlurStamp = blurStamp
      }
      ctx.drawImage(menuBlur, 0, 0, L.w, L.h) // upscale — blurry pixels, lossless to stretch
      drawClock() // the clock stays sharp over the blurred, dimmed world
      // (the skills ring + its label draw LAST, at the very end of the frame, so the
      //  whole static scene beneath them can be captured for the idle-hover cache)

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
        if (c.node.id === "goHome") {
          // GO HOME wears the HOME BOARD'S CENTRE TILE's exact dress — the empty
          // resting stack from the map: hairline tile ring, thin radials, the
          // inverted bold-Y seat waiting for you. The destination itself, verbatim.
          ctx.globalAlpha = A
          drawStack(p.x, p.y, false, false)
          ctx.globalAlpha = 1
          hits.push({ id: c.node.id, node: c.node, x: p.x, y: p.y, r: size * 0.82 })
          continue
        }
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
        // `big` nodes (sleep) wear their glyph at FULL tile size — like the map's
        // tiles and the quick buttons — instead of the badge's compact 0.42
        drawIcon(ctx, c.node.icon, p.x, p.y, c.node.big ? size / 0.9 : size * 0.42, open2 ? surface : ink, (on ? 0.95 : 0.4) * A)
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
      ctx.setTransform(1, 0, 0, 1, 0, 0) // pixel-exact blit (the clip stays in CSS space)
      ctx.drawImage(menuSnap, 0, 0)
      ctx.restore()

      // (the focused node's label + the skill reference draw in drawMenuForeground,
      //  at the end of the frame — live on cached frames, and on top of the ring)
      menuLayout = { hits }
    }

    // the player card (your tile / the faced figure), a bare block top-right.
    // Menu open → it joins the live foreground (drawMenuForeground) instead, so it
    // sits above the ring and never bakes stale rows into the scene cache.
    if (ui.card && !ui.menu) drawStatsPanel(ctx, L, { ink: nightInk, surface: nightSurface, ...ui.card })

    // on-screen QUICK BUTTONS, lower-right, menu closed — the day's commonest
    // in-place actions one click away (also still in the menu): SLEEP where you
    // can rest, GATHER where the tile yields. Each is a hex tile like a menu badge
    // (icon + hover border + hover label), laid out in a row growing leftward.
    quickBtns = []
    {
      const list = []
      if (ui.restBtn) list.push({ key: "rest", icon: "sleep", label: "sleep" })
      if (ui.gatherBtn) {
        const gi = sim.gatherInfo()
        list.push({ key: "gather", icon: "gather", label: gi ? `gather ${gi.res}` : "gather" })
      }
      list.forEach((b, i) => {
        const bx = L.w - size - 20 - i * (size + 14)
        const by = L.h - size - 20
        const hov = !!ui.pointer && Math.hypot(ui.pointer.x - bx, ui.pointer.y - by) <= size * 0.82
        // a SURFACE hex behind the glyph so it reads as a solid button over the map
        fillHex(ctx, { x: bx, y: by }, size / 0.9, surface, 1, o.startDeg)
        // the icon at FULL tile size; a hex border frames it on hover
        drawIcon(ctx, b.icon, bx, by, size / 0.9, ink, 0.95)
        if (hov) {
          const cs = hexCorners(bx, by, size, o.startDeg)
          ctx.beginPath()
          for (let k2 = 0; k2 < 6; k2++) (k2 ? ctx.lineTo : ctx.moveTo).call(ctx, cs[k2].x, cs[k2].y)
          ctx.closePath()
          ctx.strokeStyle = ink
          ctx.globalAlpha = 1
          ctx.lineWidth = 1.5
          ctx.stroke()
        }
        quickBtns.push({ key: b.key, x: bx, y: by, r: size * 0.82 })
        // its label rides the cursor like the menu's focus label — but INWARD
        // (toward screen centre), so a lower-right button's label doesn't get
        // shoved off into the corner
        if (hov) cursorLabel(ctx, L, ui.pointer, [{ text: b.label }], size, { outward: false, stroke: ink })
      })
    }

    // status line at the very top — plain text now (the day clock lives on the
    // sun dial; this is just the title, day and time)
    // round to the whole minute FIRST, then split — otherwise a fractional spend
    // near the hour rounds the minutes to 60 while the hour lags (06:60)
    const total = Math.round(spent) // minutes since waking (the day begins at 00:00)
    const hr = Math.floor(total / 60)
    const mn = total % 60
    const clock = `${String(hr).padStart(2, "0")}:${String(mn).padStart(2, "0")}`
    ctx.font = "600 11px system-ui, sans-serif"
    ctx.textAlign = "left"
    ctx.textBaseline = "middle"
    ctx.fillStyle = nightInk // flips light after dark, like the dial
    ctx.globalAlpha = 0.9
    ctx.fillText(`anon&mato  ·  day ${sim.day()}  ·  ${clock}`, 14, 14)
    ctx.globalAlpha = 1

    // the hover info box + text, on top (its fan was drawn under the trail above)
    labelBox(ctx, hoverLabel)

    // (helpers used to live bottom-left; they're now a folder in the radial
    // menu — open the menu on the player and pick "helpers".)

    // (the logs strip lives in drawLogs, drawn by the menu's live foreground —
    //  it only shows while the menu is open)
    ctx.textAlign = "left"

    // (NIGHT dims only the MAP — it's applied right after the ground layer, above,
    // so the clock, menu, labels, trail and player all render over it and stay
    // crisp and interactive.)

    // our own cursor dot (drawCursorDot; the header keeps the real one, so no dot is
    // passed for it). Menu open → it joins the live foreground instead, so it rides
    // ABOVE the ring glyphs and never bakes into the scene cache.
    if (!ui.menu) drawCursorDot()

    // ── the END-OF-DAY screen ──────────────────────────────────────────
    // shown while you sleep: a calm panel over a dimmed world with the day's
    // tally + a tip, and a WAKE UP button. The day banks only when you wake.
    wakeBtnRect = null
    if (ui.dayEnd) {
      ctx.setLineDash([])
      ctx.textBaseline = "alphabetic"
      ctx.globalAlpha = 0.9 // a near-opaque veil over the world
      ctx.fillStyle = surface
      ctx.fillRect(0, 0, L.w, L.h)
      ctx.globalAlpha = 1
      const cx = L.w / 2
      // the day's tally, straight off the (not-yet-banked) log
      const log = sim.log()
      const count = {}
      for (const a of log) count[a.type] = (count[a.type] || 0) + 1
      const awake = Math.max(0, Math.round(sim.dayBudget() - sim.energy()))
      const clk = `${String(Math.floor(awake / 60)).padStart(2, "0")}:${String(awake % 60).padStart(2, "0")}`
      const rows = []
      const add = (n, label) => n && rows.push(`${n} ${label}`)
      add(count.move || 0, "steps walked")
      add(count.scout || 0, "tiles scouted")
      add(count.gather || 0, "gathers")
      add((count.learn || 0) + (count.teach || 0), "lessons")
      add(count.build || 0, "camps raised")
      add(count.craft || 0, "crafted")
      let y = Math.max(90, L.h * 0.24)
      ctx.textAlign = "center"
      ctx.fillStyle = ink
      ctx.globalAlpha = 1
      ctx.font = "600 24px system-ui, sans-serif"
      ctx.fillText(`Day ${ui.dayEnd.day} — you rest`, cx, y)
      y += 40
      ctx.font = "600 15px system-ui, sans-serif"
      ctx.globalAlpha = 0.6
      ctx.fillText(`awake for ${clk}`, cx, y)
      y += 34
      ctx.globalAlpha = 0.9
      for (const row of rows.length ? rows : ["a quiet day"]) {
        ctx.fillText(row, cx, y)
        y += 25
      }
      // one tip for the night (stable per day)
      y += 26
      ctx.globalAlpha = 0.55
      ctx.font = "600 13px system-ui, sans-serif"
      const tip = END_TIPS[ui.dayEnd.day % END_TIPS.length]
      // wrap the tip to the panel width
      const maxW = Math.min(460, L.w - 60)
      const words = tip.split(" ")
      let line = ""
      for (const w of words) {
        if (ctx.measureText(line + " " + w).width > maxW && line) {
          ctx.fillText(line, cx, y)
          y += 18
          line = w
        } else line = line ? line + " " + w : w
      }
      if (line) {
        ctx.fillText(line, cx, y)
        y += 18
      }
      // the WAKE UP button
      const bw = 168
      const bh = 46
      const bx = cx - bw / 2
      const by = Math.min(y + 26, L.h - bh - 36)
      const pt = ui.dayEnd.pointer
      const hov = !!pt && pt.x >= bx && pt.x <= bx + bw && pt.y >= by && pt.y <= by + bh
      ctx.globalAlpha = 1
      ctx.beginPath()
      const rad = 10
      ctx.moveTo(bx + rad, by)
      ctx.arcTo(bx + bw, by, bx + bw, by + bh, rad)
      ctx.arcTo(bx + bw, by + bh, bx, by + bh, rad)
      ctx.arcTo(bx, by + bh, bx, by, rad)
      ctx.arcTo(bx, by, bx + bw, by, rad)
      ctx.closePath()
      ctx.fillStyle = hov ? ink : surface
      ctx.fill()
      ctx.strokeStyle = ink
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.fillStyle = hov ? surface : ink
      ctx.font = "600 16px system-ui, sans-serif"
      ctx.textBaseline = "middle"
      ctx.fillText("wake up", cx, by + bh / 2)
      ctx.textBaseline = "alphabetic"
      ctx.textAlign = "left"
      wakeBtnRect = { x: bx, y: by, w: bw, h: bh }
    }

    // ── MENU FOREGROUND — the live layer, drawn LAST (on top of everything) ──
    // If the menu is settled, first snapshot the whole static scene beneath it, so
    // the NEXT frame hits the fast path above and skips the entire world+menu render.
    // Then the foreground (ring, labels, card, logs, dot) draws fresh — it's the
    // layer that animates and must track state instantly.
    if (ui.menu) {
      if (menuIdle) {
        if (!menuScene) menuScene = document.createElement("canvas")
        const cv3 = ctx.canvas
        if (menuScene.width !== cv3.width || menuScene.height !== cv3.height) {
          menuScene.width = cv3.width
          menuScene.height = cv3.height
        }
        const mctx = menuScene.getContext("2d")
        mctx.setTransform(1, 0, 0, 1, 0, 0)
        mctx.clearRect(0, 0, cv3.width, cv3.height)
        mctx.drawImage(cv3, 0, 0)
        menuSceneStamp = menuStamp
      }
      drawMenuForeground()
    }
  }

  return {
    draw,
    setFrame,
    sizeFor,
    pixelToHex,
    hexToPixel,
    camAnimating,
    menuAnimating,
    panBy,
    setFreeCam,
    menuHit: p => {
      if (!menuLayout) return null
      for (const n of menuLayout.hits) if (Math.hypot(p.x - n.x, p.y - n.y) <= n.r) return n
      return null
    },
    // a skill slot on the clock ring under the pointer, or null. The glyph and
    // sign circles OVERLAP — take the nearest hit (distance normalised by each
    // target's radius), so crossing from one into the other switches hover at
    // the midline instead of the first-pushed target keeping it
    skillHit: p => {
      let best = null
      let bd = Infinity
      for (const s of skillLayout) {
        const d = Math.hypot(p.x - s.x, p.y - s.y) / s.r
        if (d <= 1 && d < bd) {
          bd = d
          best = s
        }
      }
      return best
    },
    // the on-screen quick button under the pointer (lower-right), if any → its key
    quickHit: p => {
      for (const b of quickBtns) if (Math.hypot(p.x - b.x, p.y - b.y) <= b.r) return b.key
      return null
    },
    // is the pointer over the end-of-day "wake up" button?
    wakeHit: p => {
      const b = wakeBtnRect
      return !!b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h
    }
  }
}
