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
import { RINGS, SEAM_RING, VIEW_RING, BASE_DEPTH, WATER_LEVEL, STAT_NAMES, LESSON_COST, SKILL_INFO, SKILL_CAP, RESOURCES, RECIPES, BUILDS, BIOME_YIELD } from "./sim.js"
import { drawIcon, SKILL_ICON } from "./icons.js"
import { sunState, moonState, drawMoon, INTRADAY_AXIS, skillWheelPos, hhmm } from "./clock.js"
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
// THE RIVERS — the seam is water, so it wears the sea's own colour; the ripples
// are the same blue lifted toward white (see the seam branch in paintField).
const RIVER_FILL = `rgb(${BIOME_RGB.water[0]},${BIOME_RGB.water[1]},${BIOME_RGB.water[2]})`
const RIVER_RIPPLE = "rgb(150,196,236)"
const lerpRGB = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t)
]
// shade an rgb toward white (f>0) or black (f<0), |f|<=1
const shadeRGB = (c, f) => (f >= 0 ? lerpRGB(c, [255, 255, 255], f) : lerpRGB(c, [0, 0, 0], -f))

// A tile's colour: FLAT per biome (2026-07-24) — the height variation moved
// into the elevation TERRACES (elevRings), where each inset hexagon wears its
// own tint. One base per kind keeps neighbours of a type reading as one ground,
// and the terraces alone say who stands taller (or sits deeper, for water).
export function biomeColor(biome) {
  if (biome === "water") return "rgb(81,139,191)" // one water — the terraces darken it toward the floor
  const base = BIOME_RGB[biome]
  return base ? `rgb(${base[0]},${base[1]},${base[2]})` : null
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
    if (prog.sides === 1) {
      // the seed levels (0/1): the lone star's earned fraction closes as a ring
      const frac = Math.min(1, prog.filled + prog.partial)
      if (frac > 0.001) ctx.arc(pts[0][0], pts[0][1], dotR * 2.4, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2)
    } else
      for (let k = 0; k < prog.sides; k++) {
        let [ax, ay] = pts[k]
        let [bx, by] = pts[(k + 1) % prog.sides]
        if (prog.sides === 2) {
          // the two-dot line: each edge rides its own side of the segment
          const dxe = bx - ax
          const dye = by - ay
          const len = Math.hypot(dxe, dye) || 1
          ax += (-dye / len) * 1.6
          ay += (dxe / len) * 1.6
          bx += (-dye / len) * 1.6
          by += (dxe / len) * 1.6
        }
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

// ── the idioms setup borrows ────────────────────────────────────────
// Setup happens IN the game view: the tile it discovers IS the home centre,
// its status line IS the status line, its fog IS the fog. So the pieces both
// the frame and the intake screens draw live out here as plain functions —
// one definition, no lookalikes.

export const TITLE = "anon & mato"
// THE GAME FACE — Source Code Pro, shipped in fonts/ and loaded by index.html's
// @font-face. Everything the game types is this one family, canvas included; the
// fallbacks are monospace too, so a frame drawn before the webfont lands still
// has its columns square. Sizes are built off it so there's one place to change.
// REGULAR by default — Source Code Pro's semibold reads heavy at these sizes;
// the 600 face still ships for anything that wants weight (see the +/− sign).
export const FONT = '"Source Code Pro", ui-monospace, SFMono-Regular, Menlo, monospace'
export const gameFont = (px, weight = 400) => `${weight} ${px}px ${FONT}`
export const UI_FONT = gameFont(11) // the status line's type
export const UI_SEP = "  ·  " // …and what it puts between facts
export const UI_MARGIN = 14 // its inset from the corner

// A glyph centred on its own INK, not on the font's midline. `textBaseline =
// "middle"` centres the EM BOX, which is only the same thing for text that fills
// it — a lone +, − or digit sitting inside a shape lands visibly high (Source
// Code Pro's operators ride the math axis, ~8% of the size above the midline).
// Measure what will actually be drawn and shift by half its imbalance. Assumes
// the caller has set font/align/baseline (middle) and colour.
export function inkCentred(ctx, glyph, x, y) {
  const m = ctx.measureText(glyph)
  ctx.fillText(glyph, x, y + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2)
}

// The status line, top-left. `text` is the whole joined line.
export function statusLine(ctx, text, ink, alpha = 0.9) {
  ctx.font = UI_FONT
  ctx.textAlign = "left"
  ctx.textBaseline = "middle"
  ctx.fillStyle = ink
  ctx.globalAlpha = alpha
  ctx.fillText(text, UI_MARGIN, UI_MARGIN)
  ctx.globalAlpha = 1
}

// THE DIAL — the day's clock rings the board at this radius, pinned to the
// frame centre. The sun and moon ride it, the sleep line IS it, and setup's
// angle ray is measured against it.
export const dialRadius = size => size * Math.sqrt(3) * (SEAM_RING + 0.2)

// Our own cursor — a small dot over the world (the OS cursor is hidden there).
// Ink centre with a surface ring, so it separates from any ground on either
// theme.
export function cursorDot(ctx, pointer, ink, surface) {
  if (!pointer) return
  ctx.globalAlpha = 1
  ctx.beginPath()
  ctx.arc(pointer.x, pointer.y, 3, 0, Math.PI * 2)
  ctx.fillStyle = ink
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = surface
  ctx.stroke()
}

// THE PLAYER — a pointy-top isometric cube (a cup), its own glyph, drawn the
// same whichever way the tiles sit: an opaque body under a bold outline, and
// the identity Y (two arms up to the side faces, a stem down the front edge).
// The cast shadow is the frame's own business and lives with the sun; this is
// the token itself, and it's the same token in setup as on the board.
const S3 = 0.8660254 // √3/2 — the pointy hex's horizontal reach
export const playerWeight = size => Math.max(1.5, size * 0.1)
export function drawPlayer(ctx, x, y, r, ink, surface, weight) {
  const w = r * S3 // lid/surface diamond half-width
  const h = r / 2 // …and half-height (the pointy hex's side vertices sit at ±h)
  ctx.beginPath()
  ctx.moveTo(x, y - r) // top peak
  ctx.lineTo(x + w, y - h) // upper-right
  ctx.lineTo(x + w, y + h) // lower-right
  ctx.lineTo(x, y + r) // bottom point
  ctx.lineTo(x - w, y + h) // lower-left
  ctx.lineTo(x - w, y - h) // upper-left
  ctx.closePath()
  ctx.fillStyle = surface // opaque backing — the body sits solid over its own shadow
  ctx.globalAlpha = 1
  ctx.fill()
  ctx.strokeStyle = ink
  ctx.lineWidth = weight
  ctx.lineJoin = "round"
  ctx.stroke()
  const ell = r / 2
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

// A frontier mark — the only thing an undiscovered tile ever shows. Discovery
// marks live in the fog, so they ride the NIGHT ink: light points on the
// blackened unknown after dark.
export function frontierDot(ctx, x, y, ink) {
  ctx.fillStyle = ink
  ctx.globalAlpha = 0.55
  ctx.beginPath()
  ctx.arc(x, y, 2.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
}

// PEERING INTO THE FOG: hovering a reachable undiscovered tile pools a soft
// glow in the cell (the fog's own soft language, no hard fill) under a light
// outline. Both ride the night ink, so the effect reads on the blackened
// unknown after dark too (theme ink went invisible there).
// `outline` off leaves only the pooled light — for ground so unknown that even
// its shape is a spoiler (setup's very first tile).
export function fogHover(ctx, x, y, size, startDeg, ink, outline = true) {
  const cs = hexCorners(x, y, size, startDeg)
  const glow = ctx.createRadialGradient(x, y, 0, x, y, size)
  glow.addColorStop(0, rgba(ink, 0.16))
  glow.addColorStop(1, rgba(ink, 0))
  ctx.beginPath()
  for (let i = 0; i < 6; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, cs[i].x, cs[i].y)
  ctx.closePath()
  ctx.fillStyle = glow
  ctx.globalAlpha = 1
  ctx.fill()
  if (!outline) return
  ctx.strokeStyle = ink
  ctx.globalAlpha = 0.45
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.globalAlpha = 1
}

// THE READABLE LAYER'S NIGHT PAIR. After dark the ink flips light so it stays
// legible over the blackened world, and surface flips near-black for everything
// that uses a surface FILL as a backing — ink up, surface down, always as a
// pair. Not an invert: bands, glyphs and the rest keep their colours. A no-op
// by day, and on the dark theme whose ink is already light.
//
// A STEEP, EARLY switch — not a long crossfade: mid-blend, the two ramps
// converge on the same mid-gray and the whole readable layer goes same-tint
// mush. So the dress commits to the next side while the sun is still shallow
// (fully day below depth 0.10, fully night by 0.15) — a flick, not a pop.
export function nightPair(ink, surface, sunAlt, isNight) {
  const t = isNight ? Math.min(1, Math.max(0, (-sunAlt - 0.1) / 0.05)) : 0
  if (t <= 0.001) return { ink, surface, t }
  return { ink: mixHex(ink, "#e8eaf2", t), surface: mixHex(surface, "#06070f", t), t }
}

// THE FOG IS THE CANVAS — undiscovered ground is simply the untouched base
// coat, so paint it explicitly and let it follow the night: paper by day,
// BLACK after dark. (Identical to the CSS background by day — no change there.)
export function fogCoat(ctx, L, surface) {
  ctx.fillStyle = surface
  ctx.fillRect(0, 0, L.w, L.h)
}

// …and how it MEETS the drawn ground (see the frontier block in drawGrid): how
// far the fog breathes outward and eats inward, both as a fraction of the hex.
const FOG_OUT = 0.34 // the outward breath past the edge
const FOG_IN = 0.22 // how deep it eats into the tile's own rim
// the dissolve's own curve — quadratic, not a straight ramp: most of the
// strength is spent in the first third and a thin tail carries the rest, so the
// frontier reads shorter and blends smoother than a linear fade of equal depth
const fogRamp = (grad, col, peak = 1) => {
  for (let i = 0; i <= 8; i++) {
    const t = i / 8
    grad.addColorStop(t, rgba(col, peak * (1 - t) ** 2))
  }
}

// THE MAP'S LIGHT — the other half of feeling the cycle. Laid right over the
// ground layer and UNDER everything the player reads and touches (clock, menu,
// labels, trail, the player all draw after), so the dark never fights
// interaction.
//
// By night the map dims to a cool dark, deeper toward midnight, with a pool of
// light around `at` so the eye is always drawn there instead of lost, and the
// night-sight vignette past your range; a moon that's up lifts the whole gloom.
// By day a whisper of the season's own light (the sun's hue IS the day of year)
// washes over the ground, strongest at high sun, gone at the horizons — the day
// reads LIT, not merely undimmed.
//
// Returns nightDimAt(x, y): how visible a point is THROUGH the night — the
// veil's and the vignette's combined transmittance there. Anything drawn OVER
// the darkness but belonging to the WORLD multiplies by it, so the night
// swallows it exactly as it swallows the ground it stands on.
const NIGHT_SIGHT_BASE = 3.2 // tiles of usable sight at level 0
const NIGHT_SIGHT_STEP = 1.6 // + tiles per unlock level
const NIGHT_SIGHT_FADE = 2.2 // how far past the range it falls to black (× range)
export function mapLight(ctx, L, at, size, { sunAlt, sunDeg, isNight, moon }) {
  if (!isNight) {
    const lift = Math.max(0, Math.min(1, sunAlt))
    ctx.fillStyle = `hsl(${sunDeg} 70% 62% / ${(0.08 * lift).toFixed(3)})`
    ctx.fillRect(0, 0, L.w, L.h)
    return () => 1 // by day everything is fully lit
  }
  const depth = Math.max(0, Math.min(1, -sunAlt))
  const moonLight = moon.isUp ? moon.illum : 0
  // REAL darkness now: near-black by a new-moon midnight (~0.82), rising fast
  // out of dusk (the 0.7 power) but continuously from zero at the horizon, the
  // moon lifting the whole gloom. The pool keeps the ground underfoot legible —
  // the night is FELT at the edges, never fought in the middle.
  const nightA = 0.82 * Math.pow(depth, 0.7) * (1 - 0.55 * moonLight)
  const grad = ctx.createRadialGradient(at.x, at.y, size * 1.1, at.x, at.y, size * 5)
  grad.addColorStop(0, rgba("#0d1021", nightA * 0.15)) // the pool of light — barely dim
  grad.addColorStop(1, rgba("#0d1021", nightA)) // full night, out past the pool
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, L.w, L.h)
  // NIGHT SIGHT — the second ring of the double visibility: past your sight
  // range the world falls toward true black, a vignette that tightens the night
  // around you. UNLOCKABLE by design — wire `nightSightLevel` to a skill/tech
  // when that lands (each level widens the ring), 0 is today's default.
  // Strength rides the night's own depth, so it breathes in at dusk, deepest at
  // a new-moon midnight, and the moon buys you distance.
  const nightSightLevel = 0 // ← the unlock hook (skill / tech / torch)
  const sightR = size * (NIGHT_SIGHT_BASE + NIGHT_SIGHT_STEP * nightSightLevel)
  // the rim goes REALLY dark — but its +0.35 floor RAMPS in with the night's
  // first stretch instead of popping on/off exactly at the dawn/dusk crossing
  const edgeA = Math.min(0.96, nightA + 0.35 * Math.min(1, depth / 0.1))
  if (edgeA > 0.01) {
    const vg = ctx.createRadialGradient(at.x, at.y, sightR, at.x, at.y, sightR * NIGHT_SIGHT_FADE)
    vg.addColorStop(0, rgba("#06070f", 0))
    vg.addColorStop(1, rgba("#06070f", edgeA))
    ctx.fillStyle = vg
    ctx.fillRect(0, 0, L.w, L.h)
  }
  ctx.globalAlpha = 1
  return (x, y) => {
    const d = Math.hypot(x - at.x, y - at.y)
    const t1 = Math.max(0, Math.min(1, (d - size * 1.1) / (size * 3.9)))
    const t2 = Math.max(0, Math.min(1, (d - sightR) / (sightR * (NIGHT_SIGHT_FADE - 1))))
    return (1 - nightA * (0.15 + 0.85 * t1)) * (1 - edgeA * t2)
  }
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

// ELEVATION RINGS — banded contours PER TYPE (settled 2026-07-24): 0–4 inset
// hexagons marching from the edges toward the centre, marking where a tile
// sits within ITS OWN kind's height band — raised ground on land, the basin
// stepping down over water. The biome COLOUR carries the absolute height
// class; the rings carry the within-type position (a mountain-12 wears fewer
// rings than a plain-11 on purpose — like compares with like).
//   water      rings = deepness (0 shore … 4 floor — WATER_LEVEL caps it)
//   beach      0 — pinned to the waterline by design, the flat ribbon
//   lowlands   (plain/marsh/forest) ceil((elev − 4) / 2): one ring per 2 points
//              above sea, sunken flats stay flat (beach falls out at 0 too)
//   highlands  (mountain/cliff/peak) elev − 11: the tight 12–15 band gets its
//              own four steps — global banding would flatten it to a constant
const ELEV_RING_MAX = 4 // the tallest a tile gets — and the peak scale's reference
function elevRingCount(type, land) {
  const cap = n => Math.max(0, Math.min(ELEV_RING_MAX, n))
  if (!land) return 0
  if (land.deepness != null) return cap(land.deepness)
  if (type === "mountain" || type === "cliff" || type === "peak") return cap(land.elevation - 11)
  return cap(Math.ceil((land.elevation - 4) / 2))
}
// CONTOUR SPACING is part of a kind's signature — how its levels sit inside the
// tile, so terrain reads by its profile as much as its colour:
//   flat country (plain/marsh/forest/water) keeps them TIGHT to the rim — a wide
//     level shelf with a thin lip, ground that lies down
//   highlands (mountain/cliff) run LOOSER — steeper, more of the tile in relief
//   PEAKS and WATER divide the tile from the CENTRE, on the DEEPEST/TALLEST
//     distribution: the full radius splits into ELEV_RING_MAX+1 parts and ring k
//     always sits at the same ratio, whatever the tile's own level. A lesser peak
//     is a shorter cone of the same mountain; a shallower tile a gentler bowl of
//     the same basin. Water is the peak inverted — the extreme is still at the
//     centre (level 1 rings the whole body, level 4 rings only the floor), so the
//     geometry matches and the TINT carries the direction: peaks whiten upward,
//     water darkens downward. Spacing never depends on n, so both merge freely.
const CONTOUR_STEP = { mountain: 0.13, cliff: 0.13 }
const CONTOUR_FLAT = 0.07
const CONTOUR_CENTRED = new Set(["peak", "water"])
const contourScale = (type, k) =>
  CONTOUR_CENTRED.has(type)
    ? (ELEV_RING_MAX + 1 - k) / (ELEV_RING_MAX + 1)
    : 1 - (CONTOUR_STEP[type] ?? CONTOUR_FLAT) * k

function elevRings(ctx, cx, cy, r, n, startDeg, type) {
  if (n <= 0) return
  // CONTOUR LINES (settled 2026-07-24): the levels are thin BLACK outlines over
  // the flat biome colour — no tint fills. One colour per kind, carved by lines;
  // black is a map-maker's mark, the same on land, water, day and night.
  ctx.strokeStyle = "#000"
  ctx.lineWidth = 1
  ctx.globalAlpha = 0.2
  for (let k = 1; k <= n; k++) {
    const cs = hexCorners(cx, cy, r * contourScale(type, k), startDeg)
    ctx.beginPath()
    for (let i = 0; i < 6; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, cs[i].x, cs[i].y)
    ctx.closePath()
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

// MERGED CONTOURS (2026-07-24): tiles of the SAME kind at the SAME level fuse
// their elevation lines. A side facing a matching neighbour is OPEN — no ring
// segment there — and the segments on closed sides EXTEND until they hit the
// open side's tile edge. Both tiles approach that shared edge at mirrored
// angles with the same inset depth, so their endpoints meet at one point on
// it: contours run continuously around the whole region, and the interior of
// a plateau (all sides open) draws nothing at all.
function elevRingsMerged(ctx, cx, cy, r, n, startDeg, nbCounts, edgeCorners, type) {
  if (n <= 0) return
  const full = hexCorners(cx, cy, r, startDeg)
  // corner index → the two sides meeting there (from the orientation's table)
  const atCorner = {}
  for (let d = 0; d < 6; d++) for (const ci of edgeCorners[d]) (atCorner[ci] = atCorner[ci] || []).push(d)
  const inter = (p1, p2, p3, p4) => {
    const den = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x)
    if (!den) return p2
    const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / den
    return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) }
  }
  ctx.strokeStyle = "#000"
  ctx.lineWidth = 1
  ctx.globalAlpha = 0.2
  for (let k = 1; k <= n; k++) {
    // EACH LEVEL merges on its own: side d is open for ring k when the same-kind
    // neighbour reaches at least k rings — a 4 beside a 2 fuses levels 1–2 and
    // closes 3–4 around the higher ground, true topographic nesting
    const open = nbCounts.reduce((m, c2, d) => (c2 >= k ? m | (1 << d) : m), 0)
    const s = contourScale(type, k) // the kind's own spacing — merging pairs share a type, so joins stay exact
    const insetAt = i => ({ x: cx + (full[i].x - cx) * s, y: cy + (full[i].y - cy) * s })
    ctx.beginPath()
    for (let d = 0; d < 6; d++) {
      if ((open >> d) & 1) continue // this level passes through to the neighbour
      const [ca, cb] = edgeCorners[d]
      let P0 = insetAt(ca)
      let P1 = insetAt(cb)
      const base0 = P0
      const base1 = P1
      for (const [ci, ref] of [[ca, 0], [cb, 1]]) {
        const other = (atCorner[ci] || []).find(e => e !== d)
        if (other == null || !((open >> other) & 1)) continue // closed corner — normal miter
        // the adjacent side is OPEN: slide this endpoint out along the ring's own
        // line until it lands on the neighbour-facing tile edge
        const [oa, ob] = edgeCorners[other]
        const hit = inter(base0, base1, full[oa], full[ob])
        if (ref === 0) P0 = hit
        else P1 = hit
      }
      ctx.moveTo(P0.x, P0.y)
      ctx.lineTo(P1.x, P1.y)
    }
    ctx.stroke()
  }
  ctx.globalAlpha = 1
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


// Every hover readout — tile info AND menu focus — renders the same way: lines
// of dark text on snug full-white backgrounds, pinned near the cursor. It's
// split into three so the leader FAN can be drawn under the hover trail while
// the boxes + text land on top: labelLayout (place it), labelFan (the leader
// lines), labelBox (backgrounds + text). `lines` is [{ text, color?, alpha?,
// small? }] — `small` lines wear the card type (13px, shorter box). A line
// may instead carry { cells: [{ text, … }, …] }: side-by-side boxes sharing
// one row (they abut edge-to-edge, each with its own border). Each text
// must MEASURE and DRAW in its own font, or its box mis-sizes.
// The BOXES are typed in the semibold face — every one of them, everywhere.
// (Loose canvas text — the dial's readings, the badge signs — stays regular:
// gameFont's own default.)
const LABEL_FONT = gameFont(16, 600)
const LABEL_FONT_SMALL = gameFont(13, 600) // the card-content blocks
// `mono` used to mean a SECOND face for keys and literals. The game face is a
// monospace now, so these are the same type — the flag stays only so old callers
// keep working, and there is no longer any mixing of faces within a row (which
// is what made the log's columns sit at different heights).
const MONO_FONT = LABEL_FONT
const MONO_FONT_SMALL = LABEL_FONT_SMALL
const lineFont = l => (l.mono ? (l.small ? MONO_FONT_SMALL : MONO_FONT) : l.small ? LABEL_FONT_SMALL : LABEL_FONT)
const lineHOf = l => (l.small ? 17 : 22)
// measure a stack of lines: the width of every cell, every row height, and the
// block they add up to. Placement is the caller's business — labelLayout puts
// it beside the cursor, labelPanel pins it to a corner.
export function labelMeasure(ctx, lines) {
  const pad = 6
  // `minW` (a cell's minimum TEXT width) is how stacked rows share a column: give
  // every cell in a column the widest text in it and the boxes line up down the
  // page, whatever each row happens to say. Padding is added on top, as always.
  const measure = l => {
    ctx.font = lineFont(l)
    return Math.max(ctx.measureText(l.text).width, l.minW || 0) + pad * 2
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
  return { lines, hs, ys, pad, widths, cellW, boxW: Math.max(...widths), boxH }
}

// The same boxes, PINNED — a corner of the screen instead of the cursor. Give
// it `left` or `right` and `top` or `bottom`; `alpha` fades the whole block in.
// This is the UI's one furniture: everything that isn't the world is a stack of
// these, and every separator is a box edge.
export function labelPanel(ctx, lines, { left, right, top, bottom, alpha = 1 } = {}) {
  if (!lines.length) return null
  const m = labelMeasure(ctx, lines)
  const x = left != null ? left : right - m.boxW
  const y = top != null ? top : bottom - m.boxH
  return { ...m, left: x, top: y, alpha, x, y, w: m.boxW, h: m.boxH }
}

export function labelLayout(ctx, L, pointer, lines, tile, outward = false, keepClear = null) {
  if (!pointer || !lines.length) return null
  const { hs, ys, pad, widths, cellW, boxW, boxH } = labelMeasure(ctx, lines)
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
export function labelFan(ctx, lay, stroke = null) {
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

export function labelBox(ctx, lay, border = null) {
  if (!lay) return
  // themed paper + ink — the labels follow the light/dark switch
  const paper = theme("--surface", "#111")
  const inkCol = theme("--text", "#eee")
  border = border || paper
  const { lines, left, top, hs, ys, pad, widths, cellW } = lay
  const fade = lay.alpha ?? 1 // the whole block eases in as one
  if (fade <= 0.001) return
  ctx.textAlign = "left"
  ctx.textBaseline = "middle"
  ctx.lineJoin = "round"
  ctx.setLineDash([])
  // one cell = one bordered box; a plain line is a single cell, a `cells`
  // line lays its boxes edge-to-edge along the row
  const cell = (l, x, y, w, h) => {
    ctx.font = lineFont(l) // must match labelMeasure's measurement, or the box mis-sizes
    ctx.globalAlpha = fade
    ctx.fillStyle = l.invert || l.dim ? inkCol : paper // `invert` = ink box, paper figure (marks the higher side)
    // `dim` is HALF inverted — paper with the ink laid over it at half strength,
    // so the box reads as on but held back (replay mode's clock: grey, not black)
    if (l.dim) {
      ctx.fillStyle = paper
      ctx.fillRect(x, y, w, h)
      ctx.globalAlpha = fade * 0.5
      ctx.fillStyle = inkCol
    }
    ctx.fillRect(x, y, w, h)
    ctx.globalAlpha = fade
    // the WHOLE box is bordered (caps the fan so lines never poke past the edge)
    ctx.strokeStyle = l.invert || l.dim ? inkCol : border
    ctx.lineWidth = 2
    ctx.strokeRect(x, y, w, h)
    ctx.globalAlpha = (l.alpha ?? 1) * fade
    ctx.fillStyle = l.color || (l.invert || l.dim ? paper : inkCol)
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
export function cursorLabel(ctx, L, pointer, lines, tile, { outward = false, stroke = null, keepClear = null } = {}) {
  const lay = labelLayout(ctx, L, pointer, lines, tile, outward, keepClear)
  labelFan(ctx, lay, stroke)
  labelBox(ctx, lay, stroke)
}

// THE SAME BOXES, PINNED — every piece of chrome in the game is one of these:
// the title bar, the corner readouts, the setup screens' key. `anchor` takes
// `left` or `right` and `top` or `bottom`, plus an `alpha` for fading in.
// Returns its rect, so a stack can hang the next one off it.
export function panel(ctx, lines, anchor, border = null) {
  const lay = labelPanel(ctx, lines, anchor)
  labelBox(ctx, lay, border)
  return lay
}

export function createRenderer(sim0) {
  // THE SIM IS A BINDING, NOT A CONSTANT (2026-08-05). Everything below reads
  // `sim` by name, so pointing that name at a DIFFERENT sim re-aims the whole
  // renderer in one move — which is how the game looks at a past day: the
  // controller hydrates a scratch sim to the moment in question and hands it
  // over. Nothing else changes; the world simply is what it was.
  let sim = sim0
  let menuLayout = null // last radial-menu layout (hit list), refreshed each draw
  let skillLayout = [] // last skills-ring hit list (learnable slots on the clock), refreshed each draw
  let itemLayout = [] // last pack-box hit list (lower-left) — [{ k, x, y, w, h }]
  let groundLayout = [] // …and the tile's own pile (lower-right), the same shape
  let quickBtns = [] // last on-screen quick-button hit rects (lower-right: sleep, gather…) — [{ key, x, y, r }]
  let wakeBtnRect = null // the end-of-day "wake up" button rect, or null when not sleeping
  const inRect = (p, r) => !!r && p.x >= r.left && p.x <= r.left + r.w && p.y >= r.top && p.y <= r.top + r.h
  let profileRect = null // the lower-left NAME cell — opens who you are
  let placeRect = null // …and the lower-right one — opens where you are
  let titleCellRect = null // the bar's NAME cell — opens the helpers
  let dayCellRect = null // the DAY you're on, in the bar — opens the days you've played
  let barKeys = [] // the replay bar's own cells while it's up — [{ key, left, top, w, h }]
  let dayLayout = [] // …and that list's rows — [{ day, x, y, w, h }]
  let logsBarRect = null // …and the clock, which opens the log
  let helperLayout = [] // the open helpers list's rows — [{ id, x, y, w, h }]
  let logLayout = [] // …and the open log's rows — [{ i, x, y, w, h }], i indexing the day
  let logHead = null // …the newest of them, which rides the clock's own line
  let logRunRect = null // …and the REPLAY button on whichever row is hovered
  // EVERY BOX THE CHROME DRAWS, so the world knows to stop reading tiles beneath
  // it. Not just the ones that open something: a box is a box, and the map behind
  // any of them is not what you're pointing at. Kept per drawing site, because
  // the bar's rows survive a cached frame while the lists redraw every frame.
  let chromeBar = [] // the title / day / clock rows
  let helpersRect = null // …the name's list
  let packRect = null // …what you carry
  let groundRect = null // …and what lies on the tile
  const rectOf = lay => (lay ? { left: lay.left, top: lay.top, w: lay.w, h: lay.h } : null)
  let logsRect = null // the unrolled log's block (the wheel scrolls it) …
  let logsMaxScroll = 0 // …and how many rows it can still travel
  let logsLeft = 0 // …and where it hangs from: the bar's own TIME column,
  let logsTop = 0 // just under the bar
  let helpersLeft = 0 // …and where the name's list hangs from
  let helpersTop = 0
  let logsRows = [] // …and the rows themselves (both outlive the menu scene cache,
  // (both outlive the menu scene cache, which redraws the list on its own)
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
  // ── SLEEP IS NOT A SCREEN: THE CLOCK JUST RUNS ON ────────────────────
  // Lying down starts the hand sweeping from wherever the day stopped round to
  // MIDNIGHT — 1440, which is the next day's own zero. The world goes with it:
  // the sun sets, the night ink comes up, the ground darkens, all off the same
  // minute. Nothing is covered up; you watch the day end where you're standing.
  const DAY_MIN = 1440 // a full day in minutes (sim's FREE_CAP — the dial's whole turn)
  const DAY_LAST = DAY_MIN - 1 // …and its LAST minute, 23:59 — midnight already belongs
  // to the next day, so that's where the night stops and what the sleep is stamped with
  const REST_MS = 2600 // …and how long that sweep takes to play
  let restT0 = null // when this sleep began (null = awake)
  let restFrom = 0 // the minute it began at
  function restSweep(resting, spent) {
    if (!resting) return (restT0 = null), spent
    if (restT0 == null) (restT0 = performance.now()), (restFrom = spent)
    const t = Math.min(1, (performance.now() - restT0) / REST_MS)
    return restFrom + (DAY_LAST - restFrom) * easeInOut(t) // eased at both ends: the day slows into the night
  }
  // (a short tail past the sweep, so the last frame lands with the hand-over
  // FINISHED — otherwise the night could stop mid-cross-fade and leave the wake
  // glyph half-drawn until something else asked for a frame)
  const restAnimating = () => restT0 != null && performance.now() - restT0 < REST_MS + 200
  // WAKING — the day you just lived collapses onto the horizon rather than
  // blinking out. The new day's line is empty, so what flattens is the LAST one
  // drawn: its segments are kept each frame and, for a short beat after the
  // wake, re-drawn with their heights eased to nothing. Fast, but not abrupt.
  const WAKE_MS = 320
  let lastSegs = null // the day's plateaus as last drawn
  let wakeT0 = null
  const wakeCollapse = () => {
    if (wakeT0 == null) return 0
    const u = Math.min(1, (performance.now() - wakeT0) / WAKE_MS)
    if (u >= 1) (wakeT0 = null), (lastSegs = null)
    return 1 - easeOutQuart(u) // 1 = full height, 0 = flat on the horizon
  }
  const waking = () => wakeT0 != null
  // …and how far through the night we are, 0→1 (1 = the hand has reached 23:59)
  const restProgress = () => (restT0 == null ? 1 : Math.min(1, (performance.now() - restT0) / REST_MS))
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
    // minutes since waking; the day starts at 00:00 — and while you sleep the
    // hand runs on to midnight instead (restSweep), so the whole frame below
    // (sun, night, dial) plays the day ending
    const spent = restSweep(!!ui.dayEnd, dayBudget - liveEnergy)
    // the clock is PINNED to the viewport centre — never the sliding board — so it
    // stays put while the world moves under it (a seam walk, a menu-centre glide)
    const sunCentre = { x: frame.cx, y: frame.cy }
    const sunDialR = dialRadius(size) // half a tile tighter than the seam+0.7
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
    const { ink: nightInk, surface: nightSurface, t: nightInk01 } = nightPair(ink, surface, sunAlt, isNight)
    fogCoat(ctx, L, nightSurface)
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
      // THE BAR'S LISTS GO DOWN FIRST — under the ring, not over it. They live in
      // the live layer because the static scene behind is cached and they change
      // as you point at them; but the menu is the thing you're using, so where
      // the two meet the menu wins.
      drawLogs(logsLeft, logsTop, logsRows) // hangs off the bar the static scene already drew
      drawHelpers(helpersLeft, helpersTop) // …and so does the name's own list
      drawSkills()
      // the focused badge's label — looked up from the SPEC (not the layout pass),
      // so it works on cached frames too and always carries the node's LIVE text
      const focusNode = menuNodeById(ui.menu.focusId)
      if (focusNode && focusNode.label && ui.pointer)
        cursorLabel(ctx, L, ui.pointer, [{ text: focusNode.label }], size, { outward: true, stroke: ink, keepClear: playerClear() })
      else drawSkillLabel()
      if (ui.card) drawStatsPanel(ctx, L, { ink: nightInk, themeInk, surface: nightSurface, ...ui.card })
      drawSideViews() // the pack chips + the land/figure tile ride with the card
      drawItemLabel()
      drawCursorDot()
    }

    // the hovered PACK ITEM's label: everything the world knows about the thing on
    // your back — what it weighs (and what this stack costs you), how long it
    // keeps, what a tool has left, where it comes from, and what it's FOR.
    function drawItemLabel() {
      if (!ui.itemHover || !ui.pointer) return
      const k = ui.itemHover
      const d = sim.packDetail().find(x => x.k === k)
      if (!d) return
      const res = RESOURCES[k]
      const made = RECIPES[k]
      const unit = res?.weight ?? made?.weight ?? 1
      const lines = [{ cells: [{ text: k }, { text: `×${d.n}` }] }]
      lines.push({ text: `${unit} each · ${Math.round(unit * d.n * 10) / 10} of ${sim.carryCap()}`, alpha: 0.6, small: true })
      if (d.uses != null) lines.push({ text: `${d.uses} uses left`, alpha: 0.9, small: true })
      if (d.spoilsIn != null) {
        const h = Math.floor(d.spoilsIn / 60)
        const soon = d.spoilsIn <= 60
        lines.push({
          text: soon ? `spoils in ${d.spoilsIn}m` : `keeps ${h}h`,
          alpha: 0.9,
          small: true,
          color: soon ? "#c0433a" : null
        })
      } else if (res) lines.push({ text: "keeps", alpha: 0.6, small: true })
      // where it comes from — the biome that yields it (a craft names its maker)
      const from = Object.keys(BIOME_YIELD).find(b => BIOME_YIELD[b] === k)
      if (from) lines.push({ text: `gathered in ${from}`, alpha: 0.6, small: true })
      if (made) lines.push({ text: `made by a ${made.biome} figure · ${made.level}`, alpha: 0.6, small: true })
      if (made?.carry) lines.push({ text: `carries +${made.carry}`, alpha: 0.9, small: true })
      if (made?.keeps) lines.push({ text: `food keeps ×${made.keeps}`, alpha: 0.9, small: true })
      if (made?.catches) lines.push({ text: `the only way to gather ${made.catches}`, alpha: 0.9, small: true })
      // …and what it's FOR: every recipe or build that eats it
      const uses = []
      for (const [r, spec] of Object.entries(RECIPES)) if (spec.needs?.[k]) uses.push(`${spec.needs[k]} → ${r}`)
      for (const [b, spec] of Object.entries(BUILDS)) if (spec.needs?.[k]) uses.push(`${spec.needs[k]} → ${b}`)
      if (uses.length) lines.push({ text: uses.join(", "), alpha: 0.9, small: true })
      cursorLabel(ctx, L, ui.pointer, lines, size, { outward: false, stroke: ink })
    }

    const drawCursorDot = () => cursorDot(ctx, ui.pointer, ink, surface)

    // ── the SIDE VIEWS (figure-view overhaul, 2026-07-24) ─────────────────
    // Lower-left, the PLAYER'S side: the pack made VISIBLE — one pointy hex chip
    // per item UNIT, its initial letter as its face (every item name starts
    // uniquely: fish plants wood rock eggs metal basket axe debris net — keep it
    // that way when adding one, or two things wear the same chip). The in-use tool
    // carries its remaining uses; food spoiling soon turns alarm red; the load
    // line rides above — and standing on a STASH, the buried units get a dashed
    // row of their own on top. Top-right, under the card: the LAND underfoot as
    // an actual tile copy, a bit bigger — or, standing with a FIGURE, its whole
    // board as a FLAT-TOP tile (a board IS the parent scale, the other parity)
    // holding the discovered interior, home-board-miniature style.
    // WHO YOU ARE, on the cursor: the key in both spellings and what the relays
    // said, with the FACE as a box of its own down the left — one box, the full
    // height of the rows beside it, its width following the picture's own shape.
    // (The same furniture as every other label: paper, ink border, one box per
    // fact. The face is just the first box in the row.)
    function meLabel(me) {
      const lines = me.rows.map(([k, val]) => ({ cells: [{ text: k, alpha: 0.6 }, { text: String(val) }] }))
      const m = labelMeasure(ctx, lines)
      const img = me.pic
      const H = m.boxH
      // the picture keeps its shape, within reason — a panorama or a pillar
      // would wreck the block, so the width is clamped either side of square
      const ratio = img && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1
      const imgW = img ? Math.round(H * Math.max(0.6, Math.min(1.8, ratio))) : 0
      const w = m.boxW + imgW
      const p = ui.pointer
      const left = Math.max(4, Math.min(L.w - w - 4, p.x + 14))
      const top = Math.max(4, Math.min(L.h - H - 4, p.y - H - 10))
      if (img) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(left, top, imgW, H)
        ctx.fillStyle = theme("--surface", "#111")
        ctx.fill()
        ctx.clip()
        // COVER: fill the box, crop the overflow, never squash a face
        const scale = Math.max(imgW / img.naturalWidth, H / img.naturalHeight)
        const dw = img.naturalWidth * scale
        const dh = img.naturalHeight * scale
        ctx.drawImage(img, left + (imgW - dw) / 2, top + (H - dh) / 2, dw, dh)
        ctx.restore()
        ctx.strokeStyle = theme("--text", "#eee")
        ctx.lineWidth = 2
        ctx.globalAlpha = 1
        ctx.strokeRect(left, top, imgW, H)
      }
      labelBox(ctx, { lines, left: left + imgW, top, hs: m.hs, ys: m.ys, pad: m.pad, widths: m.widths, cellW: m.cellW }, ink)
    }

    function drawSideViews() {
      // THE CORNERS STAND ON THEIR NAMES (2026-08-05). Bottom-left is WHO YOU
      // ARE — the name is a button in the title bar's own idiom (inverts under
      // the pointer, stays inverted while open) and opens onto the key itself.
      // Bottom-right is WHERE YOU ARE, the same way, onto the place's own facts.
      // What you carry (left) and what lies on the tile (right) are pushed UP
      // above their name block, by however much of it is open.
      profileRect = null
      placeRect = null
      const nameBlock = (side, title, live, take) => {
        if (!title) return L.h
        const anchor = side === "left" ? { left: 0 } : { right: L.w }
        // measured before it's drawn: a live block inverts under the pointer, and
        // the pointer can only be tested against a rect we already know
        const line = [{ cells: [{ text: String(title) }] }]
        const m = labelMeasure(ctx, line)
        const rect = { left: side === "left" ? 0 : L.w - m.boxW, top: L.h - m.boxH, w: m.boxW, h: m.boxH }
        if (live) line[0].cells[0].invert = !!ui.pointer && inRect(ui.pointer, rect)
        panel(ctx, line, { ...anchor, bottom: L.h }, ink)
        take(rect)
        return rect.top
      }
      // YOU: your name, and nothing else — the key is not a thing anyone reads.
      // Everything about it (npub, pubkey, relays, follows) rides a HOVER LABEL,
      // like every other fact in this game. No profile found says exactly that,
      // and a click on it asks the relays again.
      const me = ui.me
      const leftTop = nameBlock("left", me?.name, true, r => (profileRect = r))
      // …and THE PLACE, which is a LABEL and not a button: its facts are already
      // stated in the card top-right, so the corner only names it. (The card
      // drops its own title for the same reason — one name, one place on screen.)
      const rightTop = nameBlock("right", ui.card?.title, false, r => (placeRect = r))
      if (me && ui.pointer && inRect(ui.pointer, profileRect)) meLabel(me)

      // THE PACK, one row of boxes, sitting on top of whatever the corner says
      // about you. One unit is one box (they were hexagons; the corner is chrome,
      // not world, so it wears the chrome's own furniture).
      const cells = []
      const owners = [] // cell index → which item it belongs to (hit-testing)
      for (const d of sim.packDetail())
        for (let u = 0; u < d.n; u++) {
          // spoiling soon shows in the ALARM colour; the hovered item's whole
          // stack inverts (ink box, paper letter) so it reads as picked out
          cells.push({
            text: d.k[0],
            invert: ui.itemHover === d.k,
            color: d.spoilsIn != null && d.spoilsIn <= 60 ? "#c0433a" : null
          })
          owners.push(d.k)
          if (u === 0 && d.uses != null) {
            cells.push({ text: String(d.uses), alpha: 0.6 }) // a tool's remaining uses, its own dim box
            owners.push(d.k)
          }
        }
      // NO LABELS, NO READING — just the things. What you carry is one row of
      // boxes in the left corner; what lies on the tile is the same row in the
      // right. Double-click a box to move it across: yours → the ground,
      // ground → yours. The corners ARE the transfer.
      itemLayout = []
      packRect = null
      if (cells.length) {
        const lay = panel(ctx, [{ cells }], { left: 0, bottom: leftTop }, ink)
        packRect = rectOf(lay)
        let bx = lay.left
        lay.cellW[0].forEach((w, j) => {
          itemLayout.push({ k: owners[j], x: bx, y: lay.top, w, h: lay.hs[0] })
          bx += w
        })
      }
      groundLayout = []
      groundRect = null
      const st = sim.stashHere()
      if (st) {
        const shown = Math.min(st.n, 10)
        const sc = []
        for (let u = 0; u < shown; u++) sc.push({ text: st.item[0], invert: ui.groundHover === st.item })
        if (st.n > shown) sc.push({ text: `+${st.n - shown}`, alpha: 0.6 })
        const lay = panel(ctx, [{ cells: sc }], { right: L.w, bottom: rightTop }, ink)
        groundRect = rectOf(lay)
        let bx = lay.left
        lay.cellW[0].forEach((w, j) => {
          if (j < shown) groundLayout.push({ k: st.item, x: bx, y: lay.top, w, h: lay.hs[0] })
          bx += w
        })
      }
      // — the ground's side, top right, under the card — MENU ONLY: the tile
      // copies are part of the opened-menu reading, not the walking HUD
      if (!ui.menu) return
      const cardBottom = 18 + 22 + (ui.card?.rows?.length ?? 0) * 18
      const sbc = sim.boardHexOf(v.player)
      const sNpc = sbc && sim.npcAt(sbc)
      if (sNpc && eq(sNpc.pos, v.player)) {
        // the figure's BOARD as a flat-top tile, its discovered interior inside
        const r2 = size * 1.7
        const cx2 = L.w - 14 - r2
        const cy2 = cardBottom + 16 + r2 * 0.87
        ctx.beginPath()
        for (let k = 0; k < 6; k++) {
          const a = (Math.PI / 180) * (60 * k) // flat-top — the parent parity
          const px = cx2 + r2 * Math.cos(a)
          const py = cy2 + r2 * Math.sin(a)
          k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)
        }
        ctx.closePath()
        ctx.fillStyle = surface
        ctx.globalAlpha = 0.96
        ctx.fill()
        ctx.strokeStyle = ink
        ctx.globalAlpha = 0.9
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.globalAlpha = 1
        const node = sim.parentOf().tile.children[key(sbc)]
        if (node && node.discovered.size) {
          const centre = sim.centreOf(sbc)
          const ss = r2 / 9.5
          for (const dk of node.discovered) {
            const [lq, lr] = dk.split(",").map(Number)
            const g2 = [centre[0] + lq, centre[1] + lr]
            const pal = biomeColor(sim.typeNameAt(g2), sim.heightAt(g2), sim.smoothAt(g2))
            if (pal) fillHex(ctx, { x: cx2 + Math.sqrt(3) * (lq + lr / 2) * ss, y: cy2 + 1.5 * lr * ss }, ss, pal, 0.95, o.startDeg)
          }
        }
      } else if (sim.landAt(v.player)) {
        // the land underfoot, copied a bit bigger — the world's own orientation
        const r2 = size * 1.4
        const cx2 = L.w - 14 - (Math.sqrt(3) / 2) * r2
        const cy2 = cardBottom + 16 + r2
        const pal = biomeColor(sim.typeNameAt(v.player), sim.heightAt(v.player), sim.smoothAt(v.player))
        if (pal) fillHex(ctx, { x: cx2, y: cy2 }, r2, pal, 1, o.startDeg)
        const cs2 = hexCorners(cx2, cy2, r2, o.startDeg)
        ctx.beginPath()
        cs2.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
        ctx.closePath()
        ctx.strokeStyle = ink
        ctx.globalAlpha = 0.35
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.globalAlpha = 1
        // the copy is faithful — its level tint and elevation rings too
        {
          const cLand = sim.landAt(v.player)
          const cN = elevRingCount(sim.typeNameAt(v.player), cLand)
          const cSink = cLand?.deepness != null
          const cType = sim.typeNameAt(v.player)
          const cPeak = cType === "peak"
          const cTone = cSink ? "#08131f" : cPeak ? "#ffffff" : "#000000"
          const cStep = cSink ? 0.11 : cPeak ? 0.13 : 0.07
          if (cN > 0) fillHex(ctx, { x: cx2, y: cy2 }, r2, cTone, cStep * cN, o.startDeg)
          elevRings(ctx, cx2, cy2, r2, cN, o.startDeg, sim.typeNameAt(v.player))
        }
      }
    }

    // THE DAY'S LOG — one entry is three boxes: the MINUTE it happened, WHERE, and
    // WHAT. Consecutive moves collapse into one line. It reads NEWEST FIRST, and
    // It reads NEWEST FIRST, and it is the whole day — the bar above it is just
    // the clock now (2026-08-05: the day and the log became separate lines, and
    // the closed log says only the time). Every cell keeps the game's one font;
    // the columns line up because each is measured to its widest row (minW) rather
    // than by a typewriter face, so the rows share a grid without changing type.
    // WHERE is two coordinates in ONE box, because the world is two grids: the
    // BOARD on the parent field, then the TILE inside it. Off the boards — on a
    // seam, which belongs to no board — the first reads [seam] and the second
    // gives the global hex, the only address such a tile has.
    const logWhere = g => {
      const b = sim.boardHexOf(g)
      const c = sim.boardCentreOf(g)
      return b && c ? `[${b[0]},${b[1]}][${g[0] - c[0]},${g[1] - c[1]}]` : `[seam][${g[0]},${g[1]}]`
    }
    function logLines() {
      const log = sim.log()
      const meta = sim.logMeta()
      // the day opens with WAKING — 00:00, where you opened your eyes: the first
      // tile of the day's own trail, which is where the night left you
      const out = [{ i: 0, at: hhmm(0), where: logWhere(trail[0] || v.player), what: "wake" }]
      let at = 0 // running minute-of-day: the clock when that entry landed
      // EVERY action gets its own line — no collapsing runs into "×N". (Moves used
      // to merge; a walk then read as one entry and the day lost its steps. How
      // repetition should read is still open — for now the log is literal.)
      for (let i = 0; i < log.length; i++) {
        at += meta[i] || 0
        out.push({ i: i + 1, at: hhmm(at), where: logWhere(log[i].target || v.player), what: log[i].type })
      }
      // …and when we're STANDING INSIDE a day (looking back, or replaying it), the
      // rest of it is listed too — dimmed, and with no time, because it hasn't
      // been paid for yet. Stepping forward lights each one as it happens, which
      // is the whole point: the day doesn't shrink to where you are.
      const rest = ui.logDay ? ui.logDay.acts.slice(log.length) : []
      rest.forEach((a, k) =>
        out.push({ i: log.length + k + 1, at: "--:--", where: logWhere(a.target || v.player), what: a.type, ahead: true })
      )
      // …and asleep, the day's last act is the SLEEP, where you lay down. For now
      // it simply takes what's left of the day, so it's stamped with the day's
      // last minute; once sleep is something you can set, this becomes its own.
      if (ui.dayEnd) out.push({ i: log.length + 1, at: hhmm(DAY_LAST), where: logWhere(v.player), what: "sleep" })
      return out
    }
    // Boxes are sized to what they say — no forcing a column to one width. The
    // face is monospace, so equal-length readings (every time, most coordinates)
    // come out equal anyway, and the ones that don't are simply not the same size.
    // ONE box: the whole entry, minute and all — "00:03 [0,0][-1,0] scout". The
    // face is monospace, so the readings still stack in columns inside the box.
    const logCells = (l, on = false) => [
      { text: `${l.at} ${l.where} ${l.what}`, invert: on, alpha: l.ahead ? 0.4 : 1 }
    ]
    // THE HELPERS — what the name cell raises. Each is a BUTTON: the pointer picks
    // it out by inverting it (ink box, paper text), and a click runs it. They open
    // SIDEWAYS, one row of boxes continuing the title's own line — the bar stacks
    // now, so the room beside the name is exactly the room they need.
    function drawHelpers(left, top) {
      helperLayout = []
      helpersRect = null
      if (!ui.helpers?.length) return top
      const cells = ui.helpers.map(h => ({ text: h.label, invert: ui.helperHover === h.id }))
      const lay = panel(ctx, [{ cells }], { left, top }, ink)
      helpersRect = rectOf(lay)
      let x = lay.left
      ui.helpers.forEach((h, i) => {
        const w = lay.cellW[0][i]
        helperLayout.push({ id: h.id, x, y: lay.top, w, h: lay.h })
        x += w
      })
      return lay.top + lay.h
    }
    // …and the hovered entry offers the one thing an entry can do: run the day
    // again from there. It appears beside the row it belongs to — including the
    // newest, which is up on the clock's own line.
    function logRun(i) {
      logRunRect = null
      if (i == null || ui.replay) return
      const row = logLayout.find(r => r.i === i)
      if (!row) return
      const line = [{ cells: [{ text: "replay" }] }]
      const m = labelMeasure(ctx, line)
      const rect = { left: row.x + row.w, top: row.y, w: m.boxW, h: m.boxH }
      line[0].cells[0].invert = !!ui.pointer && inRect(ui.pointer, rect)
      panel(ctx, line, { left: rect.left, top: rect.top }, ink)
      logRunRect = { i, ...rect }
    }

    // …and the list itself, hung under the bar and starting at the bar's TIME
    // column (`left`) — the log is the clock's own block, not the corner's.
    // A long day doesn't fit: the list SCROLLS (ui.logScroll, in whole rows, the
    // wheel over it), and reports back how far it can go so the controller can
    // clamp. The day never gets truncated away — you can always reach the dawn.
    function drawLogs(left, top, lines) {
      logsRect = null
      logLayout = logHead ? [logHead] : [] // the head row is on the bar, but it's still a row
      logsMaxScroll = 0
      if (!ui.logsOpen) return top
      const rest = lines.slice(0, -1).reverse() // newest first, minus the one riding the clock
      if (!rest.length) return top
      const fits = Math.max(1, Math.floor((L.h - top - 16) / 22))
      logsMaxScroll = Math.max(0, rest.length - fits)
      const from = Math.min(ui.logScroll || 0, logsMaxScroll)
      const shown = rest.slice(from, from + fits)
      const rows = shown.map(l => ({ cells: logCells(l, ui.logHover === l.i) }))
      const lay = panel(ctx, rows, { left, top }, ink)
      shown.forEach((l, i) => logLayout.push({ i: l.i, x: lay.left, y: lay.top + lay.ys[i], w: lay.widths[i], h: lay.hs[i] }))
      logsRect = { left: lay.left, top: lay.top, w: lay.w, h: lay.h }
      logRun(ui.logHover)
      return lay.top + lay.h
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
          ui.menu.focusId ?? "", ui.menu.openId ?? "",
          // the title bar's two buttons invert under the pointer, and they're
          // drawn INTO the cached scene — so the hover has to be part of its stamp
          ui.pointer && ui.pointer.y < 96 ? `${Math.round(ui.pointer.x)},${Math.round(ui.pointer.y)}` : "",
          Math.round((ui.veil || 0) * 50), // a dip is baked into the scene, so it can't be cached through one
          // …and so is the whole BAR: opening the days, the log's head row, the
          // replay transport, looking back. Without these the cache happily
          // reused a picture of the bar as it was, and a menu you opened while
          // the radial menu was up simply never appeared.
          [
            ui.days ? ui.days.length : 0,
            ui.dayHover ?? "",
            ui.logsOpen ? 1 : 0,
            ui.logHover ?? "",
            ui.replay ? 1 : 0,
            ui.playing ? 1 : 0,
            ui.browsing ? ui.browsing.day + ":" + ui.browsing.at : "",
            ui.helpers ? ui.helpers.length : 0
          ].join(",")
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
      // the walls: half their 3px stroke keeps them inside the tile, and WALL_GAP
      // (× tile, so it holds at any zoom) then stands them BACK off the edge —
      // the wall reads as built on the ground rather than painted on the border
      const WALL_GAP = 0.08
      const wInset = 1 - (3 + 2 * WALL_GAP * size) / (Math.sqrt(3) * size)
      // how far a wall runs ON past the inset corner to reach the tile's boundary
      // (a pushed-in side is shorter by exactly this at each end) — see the walls
      const wallRun = size * (1 - wInset)
      // corner index → the two sides meeting there, straight from the
      // orientation's own table; wallNext is the OTHER one — the side that would
      // carry a wall's end on around the corner
      const wallCorner = {}
      for (let d = 0; d < 6; d++) for (const ci of disp().edgeCorners[d]) (wallCorner[ci] = wallCorner[ci] || []).push(d)
      const wallNext = (ci, d) => wallCorner[ci].find(e => e !== d)
      for (const dlt of Hex.range(rCull)) {
        const h = [camAnchor[0] + dlt[0], camAnchor[1] + dlt[1]]
        const c = hexToPixel(L, h[0], h[1], size)
        if (c.x < -size - pad || c.x > L.w + size + pad || c.y < -size - pad || c.y > L.h + size + pad) continue
        const kind = sim.kindOf(h)
        if (!kind || !sim.isDiscovered(h)) continue
        fillHex(ctx, c, size, surface, 1, o.startDeg) // opaque ground — occludes whatever runs under the world (the angle line)
        fillHex(ctx, c, size, ink, 0.05, o.startDeg)
        // which of this tile's edges face the FOG — a WALLED side never does:
        // a wall is a hard boundary (the map's rim, a closed gate), so it keeps
        // its crisp stroke instead of dissolving into the unknown
        let fogBits = 0
        const fogWalls = sim.wallsAt(h)
        for (let d = 0; d < 6; d++) {
          if ((fogWalls >> d) & 1) continue
          if (!sim.isDiscovered([h[0] + DIRS[d].q, h[1] + DIRS[d].r])) fogBits |= 1 << d
        }
        if (kind === "seam") {
          // EVERY SEAM IS A RIVER (RULES 30). It used to read as a road — a pale
          // ring floating on a surface border — and now it reads as what it is:
          // water, in the sea's own colour, with a few hairline ripples across
          // it so the row between boards moves. The ripples are placed off the
          // tile's own coordinates, so the river never looks like one stamp
          // repeated down the seam.
          fillHex(ctx, c, size, RIVER_FILL, 1, o.startDeg)
          const jitter = ((h[0] * 73856093) ^ (h[1] * 19349663)) >>> 0
          ctx.strokeStyle = RIVER_RIPPLE
          ctx.globalAlpha = 0.55
          ctx.lineWidth = 1
          ctx.lineCap = "round"
          ctx.beginPath()
          for (let i = 0; i < 3; i++) {
            const b = (jitter >> (i * 5)) & 31
            const dy = (i - 1) * 0.3 + (b / 31 - 0.5) * 0.12 // three bands, nudged
            const w = 0.2 + ((b >> 2) / 7) * 0.22 // …and each a different length
            const dx = (((jitter >> (i * 7 + 3)) & 15) / 15 - 0.5) * 0.2
            ctx.moveTo(c.x + size * (dx - w), c.y + size * dy)
            ctx.lineTo(c.x + size * (dx + w), c.y + size * dy)
          }
          ctx.stroke()
          ctx.globalAlpha = 1
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
          // own polygon, so nothing paints over a neighbour or the seam.
          // PARKED at alpha 0 (2026-07-24) to try the borderless flat-terrace
          // look — same-kind neighbours merge into one ground; restore the 0.12
          // here to bring the lattice back.
          const cs = hexCorners(c.x, c.y, size * inset, o.startDeg)
          ctx.strokeStyle = ink
          ctx.globalAlpha = 0
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
          // the ELEVATION contours — within-type, baked with the ground, and
          // MERGED across same-kind same-level neighbours (undiscovered ground
          // never matches: the rim holds until the fog lifts, then rebakes)
          const eLand = sim.landAt(h)
          if (eLand) {
            const eType = sim.typeNameAt(h)
            const eN = elevRingCount(eType, eLand)
            if (eN > 0) {
              // HYPSOMETRIC TINT, INVERTED (2026-07-24) — one rule for the whole
              // map: SEA LEVEL IS BRIGHTEST and the extremes darken. Land shades
              // DARKER per step up (no white washes — the highs keep their
              // saturation), water darker per step down. …except PEAKS, which
              // reverse it: SNOW — the whitest is the highest, so summits read as
              // caps above the darkening highlands.
              // PER LEVEL (restored 2026-07-24): every elevation hexagon lays its
              // OWN step of tone on the kind's own distribution, so a tile terraces
              // within itself — flats shade in thin lips at the rim, peaks and
              // basins in broad steps toward the middle — instead of wearing one
              // flat shade. The contours below ride the same radii.
              const eSink = eLand.deepness != null
              const ePeak = eType === "peak"
              const eTone = eSink ? "#08131f" : ePeak ? "#ffffff" : "#000000"
              const eStep = eSink ? 0.11 : ePeak ? 0.13 : 0.07
              // each side's same-kind neighbour LEVEL (−1 = different kind or fog)
              const eNb = [-1, -1, -1, -1, -1, -1]
              for (let d = 0; d < 6; d++) {
                const nb = [h[0] + DIRS[d].q, h[1] + DIRS[d].r]
                if (!sim.isDiscovered(nb) || sim.typeNameAt(nb) !== eType) continue
                const nl = sim.landAt(nb)
                if (nl) eNb[d] = elevRingCount(eType, nl)
              }
              // FLAT per tile, scaled by its level: a same-level region reads as
              // one continuous shelf and the merged contours carve the steps
              // between shelves (tried per-ring stamps and per-contour masses —
              // this stayed the clearest)
              fillHex(ctx, c, size, eTone, eStep * eN, o.startDeg)
              elevRingsMerged(ctx, c.x, c.y, size, eN, o.startDeg, eNb, disp().edgeCorners, eType)
            }
          }
        }
        // the blurry frontier: fog-facing edges bleed the tint outward, a
        // gradient quad fading into the undiscovered ground. It lives entirely
        // in the fog cell, so it never paints over drawn tiles.
        if (fogBits) {
          const cf = hexCorners(c.x, c.y, size, o.startDeg)
          const g = size * FOG_OUT
          const gIn = size * FOG_IN // how deep the fog EATS into the tile's rim
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
            fogRamp(grad, nightInk, 0.05) // the frontier's breath — fog-kin, light at night
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
            fogRamp(gin, fogEdge)
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
              fogRamp(rg, fogEdge)
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
          ctx.globalAlpha = 1 // full ink: a wall is solid, not a wash over the ground
          ctx.lineWidth = 3
          // ROUND terminals: each wall is stroked as its own segment, so the ends
          // have to close the joins themselves. A butt cap cut the run dead and
          // left a notch; a square cap projected a corner past the meeting point,
          // and two of those crossing at 120° showed as a burr. A round cap is the
          // same half-width of reach with nothing to catch the eye — the caps of
          // two walls meeting pool into one disc, and a lone end reads as a
          // finished terminal.
          ctx.lineCap = "round"
          castShadow(ctx, true)
          // A wall IS the tile's own edge, pushed inward to the centre — the inset
          // hexagon's side, corners and all — so two walls in the same tile share
          // their corner to the pixel and miter there with nothing to align.
          // An end that this tile's own next side does NOT continue is a crossing
          // instead: it runs on by wallRun to the tile's boundary, and lands
          // exactly where the neighbouring tile's wall — pushed inward off ITS
          // edge — arrives from the other side. They meet flush and the cut hides
          // beneath the join. (The reach is fixed by the push: from the inset
          // corner out to the boundary is the shortfall in the side's length.)
          for (let d = 0; d < 6; d++) {
            if (!((bits >> d) & 1)) continue
            const [ca, cb] = disp().edgeCorners[d]
            const A = cw[ca]
            const B = cw[cb]
            const l = Math.hypot(B.x - A.x, B.y - A.y) || 1
            const ux = (B.x - A.x) / l
            const uy = (B.y - A.y) / l
            const aRun = (bits >> wallNext(ca, d)) & 1 ? 0 : wallRun
            const bRun = (bits >> wallNext(cb, d)) & 1 ? 0 : wallRun
            ctx.beginPath()
            ctx.moveTo(A.x - ux * aRun, A.y - uy * aRun)
            ctx.lineTo(B.x + ux * bRun, B.y + uy * bRun)
            ctx.stroke()
          }
          castShadow(ctx, false)
          ctx.lineCap = "butt" // the contours below are their own hairlines — no overhang
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
        frontierDot(ctx, c.x, c.y, nightInk)
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

    // THE RAFT — a hull on the water where you left it. You need to see it: the
    // whole game of owning one is knowing where it is (DESIGN.md, *Rivers*), and
    // a vehicle you can't find is a vehicle you don't have.
    {
      // mid-move the sim hasn't been told yet (the action lands on arrival), so
      // the controller reports the raft's LIVE place — it slides with you
      const rf = ui.pending?.raftPos || sim.raftAt()
      const rp = rf && hexToPixel(L, rf[0], rf[1], size)
      if (rp && rp.x > -size && rp.x < L.w + size && rp.y > -size && rp.y < L.h + size) {
        ctx.strokeStyle = ink
        ctx.lineWidth = 1.5
        ctx.globalAlpha = 0.9
        const w = size * 0.34
        const d = size * 0.16
        ctx.beginPath() // a shallow hull: flat deck, rounded bottom
        ctx.moveTo(rp.x - w, rp.y - d)
        ctx.lineTo(rp.x + w, rp.y - d)
        ctx.quadraticCurveTo(rp.x, rp.y + d * 2.2, rp.x - w, rp.y - d)
        ctx.stroke()
        ctx.globalAlpha = 1
      }
    }

    // (REGROW clocks on tiles you've gathered are BAKED into the ground layer —
    // see paintField — so panning/gliding a big day-N map doesn't re-sweep every
    // gathered tile each frame.)

    // FORAGE map (node dots + regrow rings on tiles you haven't gathered) is
    // deliberately NOT drawn: knowing a tile's yield at a glance is a tech to
    // be earned/learned later (see VISION.md), not a free perk. For now you
    // learn a tile's yield only by standing on it (the info card shows it).

    // PILES — a small ring on any tile holding dropped things. Global coords
    // now (RULES 29: what you put down stays where you put it, anywhere), so
    // every depot in the viewport shows, not just the home board's cells.
    {
      for (const st of sim.stashes()) {
        const sp = hexToPixel(L, st.at[0], st.at[1], size)
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

    // the map's light, laid down HERE — right over the ground layer, under
    // everything the player reads and touches. At night the pool of light
    // follows the PLAYER (mid-move, the walking ghost), so the eye is always
    // drawn to them instead of lost in the dark.
    const lightAt = hexToPixel(L, ...(ui.pending?.ghostTile || v.player), size)
    const nightDimAt = mapLight(ctx, L, lightAt, size, { sunAlt, sunDeg, isNight, moon })

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
            // NOON — the face wraps and the heights flip from outside the ring to
            // inside. Taken at the same angle that's a hard radial drop; instead
            // the flip gets the SAME one-minute diagonal every other change gets,
            // half a minute short of noon to half a minute past.
            const from = Math.max(a, 720 - 0.5)
            const to = Math.min(b, 720 + 0.5)
            arc(a, from, h)
            line.push(ptOf(from, h), ptOf(to, h))
            arc(to, b, h)
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
      // THE ONE BAND LEFT. The journey is drawn as LINES (the opaque bands that
      // used to fill both halves covered the map, the stars and the sun beneath).
      // The WAY HOME keeps a backing, though, and at .6 rather than solid: it is
      // the one reading you must never lose in a busy sky, and a translucent
      // paper band under it lifts the dashes off whatever they cross without
      // hiding it. Filled between the profile and the horizon ring.
      const fillProfile = (startMin, startH, segs, col, alpha) => {
        if (!segs.length) return
        const line = profileLine(startMin, startH, segs)
        const a = angleOf(startMin)
        const b = angleOf(segs[segs.length - 1].to)
        ctx.fillStyle = col
        ctx.globalAlpha = alpha
        ctx.beginPath()
        line.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])))
        ctx.lineTo(...at(b, R)) // …down to the horizon at the far end
        ctx.arc(cx, cy, R, b - Math.PI / 2, a - Math.PI / 2, true) // …back along it
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
      // midnight; its far end lands at 00:00, where the day's line lifts off.
      // This IS the horizon ring, so it stays FAINT: the ground the day's own
      // line is read against, never a thing to look at itself.
      drawProfile(end, H.sleep, [{ from: end, to: 1440, h: H.sleep }], ink, null, 0.3)

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
        // …and the tail up to NOW. A gap in a lived day is time you were out in
        // it, so it bridges at move height — but the SLEEP sweep is not that: it
        // is the night, and the night IS the horizon. Bridging it at h1 drew the
        // whole ring one level up, above the sleep plateau it should be joining.
        if (now - cursor > 0.01) pushSeg(litSegs, { from: cursor, to: now, h: ui.dayEnd ? H.sleep : H.move })
      }

      // the FORWARD preview continues the line ahead of now: the hovered action at
      // its own height, then the WAY HOME at move height — ink, or red once the
      // trip home can no longer beat the deadline.
      let cost = 0
      let previewH = H.move
      let ret = sim.returnCost() // reserve from where we stand (walk to the nearest rest spot)
      if (ui.pending) {
        // mid-move: the reserve was solved ONCE at the start, from the tile we're
        // walking to — replayed here, never re-solved per frame
        if (ui.pending.ret != null) ret = ui.pending.ret
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
      } else if (ui.hovered && ui.hoverPath) {
        // …including a hover the reserve REFUSES. That case is the whole point of
        // the overtime warning and it used to be skipped here (`!hoverIllegal`),
        // which is why the red never appeared: every move you're ALLOWED to make
        // is one you can get home from, by construction — the reserve guarantees
        // it — so the only trip that can be late is one the rules won't let you
        // take. Showing it is how you learn where the edge is.
        cost = sim.pathCharge(ui.hoverPath)
        // priced off the ROUTE, not the destination: in the water the way home
        // depends on the bank you came in by (or on the raft being under you),
        // and a bare tile answers Infinity — which used to be drawn as a way
        // home of ZERO, throwing the reserve marker forward on every water hover
        ret = sim.retAfterPath(ui.hoverPath)
      } else if (ui.hovered && sim.isFrontier(ui.hovered) && sim.canScout(ui.hovered)) {
        // hovering a scoutable tile: you stand still to look, so home stays from HERE
        cost = sim.scoutChargeAt(ui.hovered)
        previewH = H.high
      }
      if (!isFinite(ret)) ret = 0
      // the trip home can't beat the deadline — a HOVER warning only. Never during a
      // committed move: canMove already guarantees the reserve, so the mid-walk
      // inflight/ghost desync must not flash the clock red as you retrace home.
      // Nor ASLEEP: the hand sweeps on to 23:59 there (restSweep), so `now` runs
      // way past the deadline by design and every comparison to it would scream.
      // The day is over — there is no trip left to be late for.
      const over = !ui.pending && !ui.dayEnd && now + cost + ret > end + 1e-9

      // THE JOURNEY IS A LINE, not a mass. (Both bands — the DONE one from 00:00
      // to NOW and the WAY-BACK one below — used to be filled opaque between the
      // profile and the horizon, covering the map, stars, sun and moon beneath.
      // Dropped 2026-08-02: the profile now reads as drawing over the world.
      // Overtime still floods the way home red, in the line itself.)
      // lived day + the hovered action, one plateaued line lifting out of sleep at 00:00
      const daySegs = litSegs.slice()
      if (cost > 0) pushSeg(daySegs, { from: now, to: now + cost, h: previewH })
      // WAKING: the day that just ended flattens into the horizon it is about to
      // become — its own plateaus, scaled to nothing over WAKE_MS. (The new day
      // has no line yet; without this the old one simply vanished.)
      const fall = wakeCollapse()
      if (fall > 0 && lastSegs) drawProfile(0, H.sleep, lastSegs.map(g => ({ ...g, h: g.h * fall })), ink)
      else {
        drawProfile(0, H.sleep, daySegs, ink)
        if (daySegs.length) lastSegs = daySegs.map(g => ({ ...g }))
      }
      // the way home — dashed and lighter — from where the preview leaves off
      if (ret > 0) {
        const from0 = now + cost
        const startH = cost > 0 ? previewH : litSegs.length ? litSegs[litSegs.length - 1].h : H.sleep
        // the way home: a dashed line over its own paper band, red when the trip
        // can't beat the deadline
        const back = [{ from: from0, to: from0 + ret, h: H.move }]
        fillProfile(from0, startH, back, surface, 0.6) // …paper, so the dashes lift off the sky
        if (over) fillProfile(from0, startH, back, "#c0433a", 0.28) // …and red over it when you'd be late
        drawProfile(from0, startH, back, over ? "#c0433a" : ink, [4, 3], 0.8)
        // (the dot that marked where the way back LIFTS OFF is gone — the day's
        //  line already says where you are; the one mark worth having is where
        //  you'd land. See the arrival pin below.)
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
      // THE DAY'S END — one mark, and the only one out here. A PIN: a straight
      // stick from the horizon out to the height the day's lines ride at, with a
      // small dot on its far end, the size of the one that used to mark now. Full
      // ink, no halo, no rounding — it is a mark, not a shape. It obeys the lines'
      // own noon rule for free (radOf flips the height past 720), so an afternoon
      // deadline hangs INWARD with its dot on the inside.
      //
      // (It was an outline triangle straddling the line, and before that the
      // arrival wore a tick of its own. Both gone: the dashed way home already
      // ends where you'd land, so the only thing left worth marking is when the
      // day runs out.)
      // …and OVERTIME is what it says when the trip home can no longer beat it:
      // the pin goes red, and the way-home dashes run red past it by exactly how
      // late you'd be. (The warning used to live on the arrival tick and the
      // lift-off dot; both are gone, so it belongs on the mark that remains —
      // the deadline is the thing being missed.)
      {
        const ang = angleOf(end)
        const [hx, hy] = at(ang, radOf(end, H.move)) // the head, at height
        const [fx, fy] = at(ang, R) // …the foot, on the horizon
        const mark = over ? "#c0433a" : ink
        ctx.strokeStyle = mark
        ctx.fillStyle = mark
        ctx.globalAlpha = 1
        ctx.lineWidth = 2
        ctx.lineCap = "butt"
        ctx.beginPath()
        ctx.moveTo(fx, fy)
        ctx.lineTo(hx, hy)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(hx, hy, 2.5, 0, TAU)
        ctx.fill()
        ctx.lineWidth = 1
      }
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
          const HL = ink // the learn preview stays ink — its GROWTH (below) is what sets it apart
          if (n === 1) {
            // LEVEL 1 (and 0): the seed — there's always one dot to grow from. Its
            // single edge is a RING closing around the dot: solid for the earned
            // fraction, dashed the rest, the learn preview breathing it shut.
            const [sx2, sy2] = pts[0]
            const rr = dotR * 2.4
            const a0 = -Math.PI / 2 // grows from the top, clockwise
            const frac = Math.min(1, filled + partial)
            const arcSeg = (f0, f1, dash, alpha, col) => {
              if (f1 - f0 < 0.001) return
              ctx.strokeStyle = col || ink
              ctx.setLineDash(dash || [])
              ctx.globalAlpha = alpha
              ctx.beginPath()
              ctx.arc(sx2, sy2, rr, a0 + f0 * Math.PI * 2, a0 + f1 * Math.PI * 2)
              ctx.stroke()
            }
            if (lit) {
              const grow = (1 - Math.cos(performance.now() / 260)) / 2
              arcSeg(0, frac, null, mul)
              arcSeg(frac, frac + (1 - frac) * grow, null, 1, HL)
              arcSeg(frac + (1 - frac) * grow, 1, [3, 3], 0.5, HL)
            } else {
              arcSeg(0, frac, null, mul)
              arcSeg(frac, 1, [3, 3], dashMul)
            }
            ctx.strokeStyle = ink
            ctx.setLineDash([])
            return
          }
          for (let k = 0; k < n; k++) {
            let [ax, ay] = pts[k]
            let [bx, by] = pts[(k + 1) % n]
            if (n === 2) {
              // LEVEL 2: a two-dot LINE whose two edges share the segment — each
              // rides its own side (offset along its own travel normal, which
              // flips with direction), a doubled stroke instead of an overdraw
              const dxe = bx - ax
              const dye = by - ay
              const len = Math.hypot(dxe, dye) || 1
              const nx2 = (-dye / len) * 1.6
              const ny2 = (dxe / len) * 1.6
              ax += nx2
              ay += ny2
              bx += nx2
              by += ny2
            }
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
          ctx.font = gameFont(Math.round(size * 0.95), 600)
          ctx.globalAlpha = chrome
          ctx.textAlign = "center"
          ctx.fillStyle = ink // plain text colour, hover changes nothing
          // OPTICALLY centred, not em-centred: `middle` puts the FONT's midline
          // on numY, and Source Code Pro hangs + and − well above it (both sit on
          // the math axis) — so the sign floated toward the top of the figure's
          // shape. Centre the glyph's own INK instead: same rule for both signs,
          // and independent of whatever face the game wears.
          inkCentred(ctx, learn ? "+" : "−", numX, numY)
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
    // hover highlight — the tile border lives HERE now: the resting lattice is
    // parked, but the tile under the pointer wears a prominent outline + wash,
    // in the night ink so it reads day and night. EVERY discovered tile gets it,
    // route or none: deep water (no walkable neighbour to approach from) has no
    // hoverPath, and gating on one made it the odd tile out.
    if (ui.hovered && sim.isDiscovered(ui.hovered)) {
      const hc = hexToPixel(L, ui.hovered[0], ui.hovered[1], size)
      fillHex(ctx, hc, size, nightInk, 0.12, o.startDeg)
      const hcs = hexCorners(hc.x, hc.y, size, o.startDeg)
      ctx.beginPath()
      hcs.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
      ctx.closePath()
      ctx.strokeStyle = nightInk
      ctx.globalAlpha = 0.75
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.globalAlpha = 1
    }
    // hovering a reachable (dotted) undiscovered tile — PEERING INTO THE FOG: a
    // soft glow pools in the cell (the fog's own soft language, no hard fill),
    // under the outline. Both ride the night ink, so the effect reads on the
    // blackened unknown after dark too (theme ink went invisible there).
    if (ui.hovered && !sim.isDiscovered(ui.hovered) && dots.has(key(ui.hovered))) {
      const c = hexToPixel(L, ui.hovered[0], ui.hovered[1], size)
      fogHover(ctx, c.x, c.y, size, o.startDeg, nightInk)
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

    // THE ANGLE — the line drawn at setup, still where it was drawn. It runs out
    // of the home centre and clean off the edge of the world, at the home tile's
    // own weight, and it rides the NIGHT ink so it reads after dark exactly as it
    // did on the screen this one grew out of.
    {
      const a0 = hexToPixel(L, 0, 0, size)
      const rad = (sim.angle() * Math.PI) / 180
      const far = Math.hypot(L.w, L.h)
      ctx.beginPath()
      ctx.moveTo(a0.x, a0.y)
      ctx.lineTo(a0.x + Math.sin(rad) * far, a0.y - Math.cos(rad) * far)
      ctx.strokeStyle = nightInk
      ctx.globalAlpha = 0.45
      ctx.lineWidth = 1.5
      ctx.setLineDash([])
      ctx.stroke()
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
      // a SEAM tile is a river and has no land facts (it's nobody's board) — it
      // still gets its name, or the water would be the one thing on the map the
      // pointer couldn't tell you anything about
      const river = !eq(h, v.player) && sim.isDiscovered(h) && sim.isRiver(h)
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
        const dest = named ? npcName(named.pubkey) : land ? land.biome : river ? "river" : homeTile ? "home" : ((coordsInline = true), l2)
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
      if (l1 || land || river || centreNpc || homeRef) {
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
        // water states its price of entry — but the SHALLOWS say nothing now:
        // you can wade into them and a raft crosses them (RULES 35), so they
        // aren't impassable at all. Deeper water still wants a hull you haven't
        // built, and is the only water that warns.
        if (land?.impassable)
          lines.push({ text: land.deepness < 2 ? "needs a boat" : "needs a bigger boat", alpha: 0.6, small: true })
        // the RIVER names itself, and says which of its two readings applies:
        // a dead end you back out of, or — with the raft moored there — the road
        if (river && !l1) lines.push({ text: "river", alpha: 0.6, small: true })
        if (river) {
          const rAt = sim.raftAt()
          if (rAt && eq(rAt, h)) lines.push({ text: "raft moored", alpha: 0.9, small: true })
        }
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
    // the way-home trail: in transit it's the route pre-solved from the destination
    // (a fresh Dijkstra per frame is what used to make long walks stutter)
    const home = ui.pending ? ui.pending.homePath : sim.homePath()
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
    // The player token (drawPlayer, above) plus the one thing that belongs to
    // the frame rather than to it: the shadow the sun casts from it.
    const drawEnergyCube = (x, y, r) => {
      // one board-wide sun direction (computed from the centre tile). The
      // cast shadow aims away along it.
      const [tsx, tsy] = sunTo // toward-sun unit
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
      // 2–4) the token itself: body, bold outline, identity Y
      drawPlayer(ctx, x, y, r, ink, surface, W)
      // (the budget readout moved off the lid — it rides the clock at the NOW
      // angle; see drawClock)
    }

    // one resting tile's full stack, by who's on it
    const drawStack = (x, y, hasPlayer, hasNpc) => {
      boldHex(x, y, size, false, 0.5) // the special-tile ring — a hairline; background = the tile itself
      let prev = size
      if (hasPlayer) {
        // the seat's radials still run in from the tile edge to whatever sits in
        // it — a figure gets them, so the cup does too. Drawn BEFORE the cube, so
        // they're floor: the token covers them and its shadow falls across them.
        thinSegs(x, y, size, size * (2 / 3))
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
      if (!ui.pending && menuSnapStamp !== blurStamp) {
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
        // every badge wears its glyph at FULL tile size — the same as the map's
        // tiles, the quick buttons and the `big` nodes. (It used to be a compact
        // 0.42 inside the hex; the icons are hex-shaped themselves, so they may
        // as well fill the badge they sit in.)
        // …and a node may name the SIDE it wants (`face: "word"`); the default is
        // the figure, and an icon with only one side drawn gives that one anyway
        drawIcon(ctx, c.node.icon, p.x, p.y, size / 0.9, open2 ? surface : ink, (on ? 0.95 : 0.4) * A, c.node.face)
        if (c.node.badge != null) {
          const bx = p.x + size * 0.5
          const by = p.y - size * 0.5
          ctx.globalAlpha = A
          ctx.beginPath()
          ctx.arc(bx, by, size * 0.28, 0, Math.PI * 2)
          ctx.fillStyle = ink
          ctx.fill()
          ctx.fillStyle = surface
          ctx.font = gameFont(Math.round(size * 0.34))
          ctx.textAlign = "center"
          ctx.textBaseline = "middle"
          ctx.fillText(String(c.node.badge), bx, by)
          ctx.globalAlpha = 1
        }
        hits.push({ id: c.node.id, node: c.node, x: p.x, y: p.y, r: size * 0.82 })
      }

      // the punched-out tile, ABOVE the menu: clip to EXACTLY the current
      // tile (no oversize — neighbours' borders must not creep in) and
      // redraw it sharp from the snapshot — ground, player, figure stacked.
      // Skipped mid-walk: the cube has glided away from the sim's player tile,
      // so a sharp stamp there would be a ghost of where you left.
      if (!ui.pending) {
      ctx.save()
      const punch = hexCorners(hub.x, hub.y, size, o.startDeg)
      ctx.beginPath()
      punch.forEach((pt, k2) => (k2 ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)))
      ctx.closePath()
      ctx.clip()
      ctx.setTransform(1, 0, 0, 1, 0, 0) // pixel-exact blit (the clip stays in CSS space)
      ctx.drawImage(menuSnap, 0, 0)
      ctx.restore()
      }

      // (the focused node's label + the skill reference draw in drawMenuForeground,
      //  at the end of the frame — live on cached frames, and on top of the ring)
      menuLayout = { hits }
    }

    // the player card (your tile / the faced figure), a bare block top-right.
    // Menu open → it joins the live foreground (drawMenuForeground) instead, so it
    // sits above the ring and never bakes stale rows into the scene cache.
    if (!ui.menu) {
      if (ui.card) drawStatsPanel(ctx, L, { ink: nightInk, themeInk, surface: nightSurface, ...ui.card })
      drawSideViews() // the pack chips + the land/figure tile, menu closed too
    }

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

    // THE DIP — a day being changed. The WORLD fades out and the new one fades in;
    // the bar, the corners, the labels and the cursor do not, because they are not
    // what changed. So it goes down here: over the map, the trail and the clock,
    // under everything you read and touch. (Through the world's own colour at
    // this hour, not the theme's paper — the map is what's dimming.)
    if (ui.veil > 0.002) {
      ctx.fillStyle = nightSurface
      ctx.globalAlpha = Math.min(1, ui.veil)
      ctx.fillRect(0, 0, L.w, L.h)
      ctx.globalAlpha = 1
    }

    // THE TITLE BAR, flush in the top-left corner — the same boxes setup built
    // itself out of, each fact in its own: the title, the day, the time.
    // (The day clock proper lives on the sun dial; this is just the reading.)
    // Round to the whole minute FIRST, then split — otherwise a fractional
    // spend near the hour rounds the minutes to 60 while the hour lags (06:60).
    const total = Math.round(spent) // minutes since waking (the day begins at 00:00)
    const hr = Math.floor(total / 60)
    const mn = total % 60
    // …and the TIME cell is also the log's summary: the clock, then whatever
    // happened last, right after it. No label — the time IS the summary, and
    // clicking the bar unrolls the whole day underneath (drawLogs). Asleep, the
    // day has no more minutes to report, so the reading is simply "ended".
    const clock = `${String(hr).padStart(2, "0")}:${String(mn).padStart(2, "0")}`
    // THE BAR IS A STACK OF THREE, one thing per line: the NAME, the DAY, and
    // the CLOCK. The name raises the helpers (sideways, into the room the stack
    // freed beside it); the clock is the log's own button — closed it is nothing
    // but the time, opened the whole day unrolls beneath it. The DAY is neither:
    // it's a reading, and it sits between them saying which one this is.
    const logs = logLines()
    // measured before it's drawn: the invert has to be decided from the pointer,
    // and the pointer can only be tested against a rect we already know
    const titleRow = [{ cells: [{ text: TITLE }] }]
    const titleM = labelMeasure(ctx, titleRow)
    const overTitle = !!ui.pointer && ui.pointer.x < titleM.boxW && ui.pointer.y < titleM.boxH
    titleRow[0].cells[0].invert = overTitle || !!ui.helpers?.length
    const titleLay = panel(ctx, titleRow, { left: 0, top: 0 }, ink)
    titleCellRect = { left: titleLay.left, top: titleLay.top, w: titleLay.w, h: titleLay.h }
    // THE DAY LINE — or, in replay mode, the REPLAY BAR that takes its place.
    //
    // The word "day" is the button; the numbers are the list. Closed, one number
    // stands beside it: the day you're on. Opened, they all do, most recent on
    // the LEFT, the one you're on lit in its own ordered place.
    //
    // Replaying, this line is the transport instead — step back, step on, run it,
    // and leave. Exit puts the day line back.
    const here = sim.day()
    const cells = []
    if (ui.replay) {
      cells.push({ text: "back", key: "back", live: true }, { text: "forward", key: "forward", live: true })
      cells.push({ text: ui.playing ? "stop" : "play", key: "play", lit: !!ui.playing, live: true })
      cells.push({ text: "exit", key: "exit", live: true })
    } else {
      // OPEN reads on the button itself, black like every other opened box; the
      // day you're on is marked GREY among the numbers — chosen, but not the
      // thing you just pressed. Closed, neither: one plain box and its number.
      cells.push({ text: "day", key: "day", lit: !!ui.days, live: true })
      const nums = ui.days || [{ day: here }]
      // …the numbers only answer the pointer while the list is OPEN. Closed, the
      // one number there is a reading, not a button, and lighting it up would
      // promise something the click doesn't do.
      for (const d of nums)
        cells.push({ text: String(d.day), day: d.day, sel: !!ui.days && d.day === here, live: !!ui.days })
    }
    const dayRow = [{ cells: cells.map(c => ({ text: c.text })) }]
    const dayM = labelMeasure(ctx, dayRow)
    const dayTop = titleLay.top + titleLay.h
    const onDayRow = !!ui.pointer && ui.pointer.y >= dayTop && ui.pointer.y < dayTop + dayM.boxH
    let dx = 0
    dayLayout = []
    dayCellRect = null
    barKeys = []
    cells.forEach((c, i) => {
      const w = dayM.cellW[0][i]
      const over = !!c.live && onDayRow && ui.pointer.x >= dx && ui.pointer.x < dx + w
      dayRow[0].cells[i].invert = over || !!c.lit // the pointer always wins, in full black
      dayRow[0].cells[i].dim = !over && !!c.sel
      const rect = { left: dx, top: dayTop, w, h: dayM.boxH }
      if (c.key === "day") dayCellRect = rect
      else if (c.key) barKeys.push({ key: c.key, ...rect })
      else {
        if (ui.days) dayLayout.push({ day: c.day, x: dx, y: dayTop, w, h: dayM.boxH })
      }
      dx += w
    })
    const dayLay = panel(ctx, dayRow, { left: 0, top: dayTop }, ink)
    const timeRow = [{ cells: [{ text: clock }] }]
    const timeM = labelMeasure(ctx, timeRow) // the CLOCK alone — that's the button
    const timeTop = dayLay.top + dayLay.h
    const overTime =
      !!ui.pointer && ui.pointer.x < timeM.boxW && ui.pointer.y >= timeTop && ui.pointer.y < timeTop + timeM.boxH
    timeRow[0].cells[0].invert = (overTime || !!ui.logsOpen) && !ui.replay
    timeRow[0].cells[0].dim = !!ui.replay // replay mode: the clock is grey, not black
    // OPENED, the newest entry sits on the clock's own line and says no time of
    // its own: the clock beside it IS its time. Every other entry hangs below
    // with its minute, as usual — the last line is the one with the treatment.
    const head = ui.logsOpen ? logs[logs.length - 1] : null
    if (head) timeRow[0].cells.push({ text: `${head.where} ${head.what}`, invert: ui.logHover === head.i })
    const timeLay = panel(ctx, timeRow, { left: 0, top: timeTop }, ink)
    logsBarRect = { left: timeLay.left, top: timeLay.top, w: timeM.boxW, h: timeLay.h }
    logHead = head
      ? { i: head.i, x: timeLay.left + timeM.boxW, y: timeLay.top, w: timeLay.cellW[0][1], h: timeLay.hs[0] }
      : null
    logsLeft = timeLay.left
    logsTop = timeLay.top + timeLay.h
    logsRows = logs
    helpersLeft = titleLay.left + titleLay.w
    helpersTop = titleLay.top
    chromeBar = [rectOf(titleLay), rectOf(dayLay), rectOf(timeLay)]
    if (!ui.menu) {
      drawLogs(logsLeft, logsTop, logs) // menu open → it rides the live foreground instead
      drawHelpers(titleLay.left + titleLay.w, titleLay.top)
    }

    // the hover info box + text, on top (its fan was drawn under the trail above)
    labelBox(ctx, hoverLabel)

    // (helpers used to live bottom-left, then as a folder in the radial menu,
    //  where they read as moves in the game. They're a list under the TITLE now
    //  — drawHelpers, raised by the bar's name cell.)

    // (the logs strip lives in drawLogs, drawn by the menu's live foreground —
    //  it only shows while the menu is open)
    ctx.textAlign = "left"

    // (NIGHT dims only the MAP — it's applied right after the ground layer, above,
    // so the clock, menu, labels, trail and player all render over it and stay
    // crisp and interactive.)

    // the hovered item's readout. (The cursor DOT is drawn dead last — see the
    // end of the frame: it's the one thing that must never sit under anything.)
    if (!ui.menu) drawItemLabel()

    // ── RESTING ────────────────────────────────────────────────────────
    // Not a screen laid over the game: the world stays put and the clock runs on
    // to midnight (restSweep, above), where the bar's reading becomes "ended".
    // The day's account is the LOG — its last line is the sleep — so all this
    // adds is the WAKE tile: a hex button standing on the player. (A tally of
    // steps/scouts/gathers lived here; dropped 2026-08-02.) The day banks on wake.
    wakeBtnRect = null
    if (ui.dayEnd) {
      ctx.setLineDash([])
      const wp = hexToPixel(L, v.player[0], v.player[1], size)
      const wr = size * 0.82
      const pt = ui.dayEnd.pointer
      const night = restProgress() // 0 → 1 across the sweep to 23:59
      // THE NIGHT ON ONE TILE. The sleep glyph SLIDES off the badge you pressed
      // (pinned direct-left of you, so that's where it comes from) onto your own
      // tile and BREATHES there while the hand runs to 23:59 — the tile under it
      // holding still, since it's the sleeper that fades, not the bed. Over the
      // last stretch the two glyphs CROSS-FADE: sleep out, wake in, on the same
      // hex. Nothing is clickable until the hand-over is done.
      const HANDOVER = 0.18 // the closing share of the night the two share
      const hand = Math.max(0, Math.min(1, (night - (1 - HANDOVER)) / HANDOVER))
      const fp = hexToPixel(L, v.player[0] - 1, v.player[1], size)
      const slide = easeOutQuart(Math.min(1, night / 0.12)) // there almost at once
      const x = fp.x + (wp.x - fp.x) * slide
      const y = fp.y + (wp.y - fp.y) * slide
      const breath = slide < 1 ? 1 : 0.3 + 0.7 * (0.5 + 0.5 * Math.cos((performance.now() / 1100) * Math.PI * 2))
      ctx.globalAlpha = 1
      fillHex(ctx, { x, y }, size / 0.9, surface, 1, o.startDeg)
      if (hand < 1) drawIcon(ctx, "sleep", x, y, size / 0.9, ink, 0.95 * breath * (1 - hand))
      if (hand > 0) drawIcon(ctx, "wake", wp.x, wp.y, size / 0.9, ink, 0.95 * hand)
      ctx.globalAlpha = 1
      if (night >= 1) {
        // …and once it is, the WAKE TILE is a button: same furniture as the
        // quick buttons, hover border and cursor label included.
        const hov = !!pt && Math.hypot(pt.x - wp.x, pt.y - wp.y) <= wr
        if (hov) {
          const cs = hexCorners(wp.x, wp.y, size, o.startDeg)
          ctx.beginPath()
          for (let k2 = 0; k2 < 6; k2++) (k2 ? ctx.lineTo : ctx.moveTo).call(ctx, cs[k2].x, cs[k2].y)
          ctx.closePath()
          ctx.strokeStyle = ink
          ctx.lineWidth = 1.5
          ctx.stroke()
          cursorLabel(ctx, L, pt, [{ text: "wake" }], size, { outward: false, stroke: ink })
        }
        wakeBtnRect = { x: wp.x, y: wp.y, r: wr }
      }
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
    // THE CURSOR, DEAD LAST. Our dot IS the pointer — the OS one is hidden over
    // the whole window — so it has to sit above every box, tile and overlay,
    // including the bar, the lists and the sleeping screen. (Menu open: the
    // foreground drew it just now, above the ring; drawing it twice is harmless
    // but pointless, so that path owns it.)
    if (!ui.menu) drawCursorDot()
  }

  return {
    draw,
    setFrame,
    sizeFor,
    pixelToHex,
    hexToPixel,
    // the hover readout, exactly as the world draws it — setup borrows it so
    // its first tile answers the pointer the way every tile after it will
    cursorLabel,
    // the same boxes PINNED to a corner, with no fan: the UI's furniture
    panel,
    // what a stack of lines WOULD take, without drawing it — for laying chrome
    // out before the world it sits over
    measure: labelMeasure,
    orient: () => sim.orient(),
    camAnimating,
    menuAnimating,
    itemHit: p => itemLayout.find(it => p.x >= it.x && p.x < it.x + it.w && p.y >= it.y && p.y < it.y + it.h) || null,
    groundHit: p => groundLayout.find(it => p.x >= it.x && p.x < it.x + it.w && p.y >= it.y && p.y < it.y + it.h) || null,
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
      return !!b && Math.hypot(p.x - b.x, p.y - b.y) <= b.r
    },
    // the bar's two halves: the NAME raises the helpers, the DATE onward unrolls
    // the day (the bar's time cell is that day's latest line)
    // IS THE POINTER ON CHROME? — any box in the bar or the corners that takes a
    // click. The world asks before it reads a tile under the pointer: a hover
    // readout for whatever happens to lie beneath a button is a label about
    // somewhere you are not pointing.
    chromeHit: p =>
      [...chromeBar, logsRect, helpersRect, packRect, groundRect, profileRect, placeRect, logRunRect].some(r =>
        inRect(p, r)
      ),
    dayHit: p => inRect(p, dayCellRect),
    barHit: p => barKeys.find(b => inRect(p, b))?.key || null,
    dayListHit: p => dayLayout.find(d => p.x >= d.x && p.x < d.x + d.w && p.y >= d.y && p.y < d.y + d.h) || null,
    // a row of the open log — its index in the day's own list, so the controller
    // can put the world back to just before it happened
    logRowHit: p => logLayout.find(r => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h) || null,
    // the replay button on the hovered row — its `i` is the entry it belongs to
    logRunHit: p => (inRect(p, logRunRect) ? logRunRect.i : null),
    profileHit: p => inRect(p, profileRect),
    placeHit: p => inRect(p, placeRect),
    // …and the swap itself. Every cache keyed on the OLD sim's stamps has to go:
    // two sims can land on the same worldStamp by coincidence, and a stale
    // ground layer would be a picture of the wrong day.
    setSim: s => {
      if (!s || s === sim) return
      sim = s
      fieldCache = null
      menuScene = null
      menuSceneStamp = ""
      camTargetPos = null // …and the camera SNAPS to the new view rather than gliding across time
    },
    titleHit: p => inRect(p, titleCellRect),
    logsHit: p => inRect(p, logsBarRect),
    helperHit: p => helperLayout.find(h => p.x >= h.x && p.x < h.x + h.w && p.y >= h.y && p.y < h.y + h.h) || null,
    // is the pointer over the unrolled log, and how far can it still scroll?
    logsScrollHit: p => inRect(p, logsRect),
    logsMaxScroll: () => logsMaxScroll,
    restAnimating,
    // the day just ended: flatten what's on screen into the horizon
    wake: () => {
      wakeT0 = performance.now()
    },
    waking
  }
}
