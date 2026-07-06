// The game, pure and headless.
//
// Everything anon&mato IS lives here: the world tree, energy, costs,
// discovery, the action log, day snapshots. No canvas, no DOM, no timers —
// this module runs in plain node (the tests do). Rendering and input live in
// render.js/grid.js and only ever call queries + dispatch.
//
// SPACE IS GLOBAL. Each depth level is one continuous lattice: boards (the
// children of the parent node, one per parent hex) separated by the one-tile
// SEAM — the parent grid's edges and vertices as walkable tiles. The player,
// the entry and the trail live in GLOBAL coordinates on that lattice; the
// "current board" is derived from where the player stands and only matters
// for costs bookkeeping and the camera. Crossing into another board is an
// ordinary step — nothing is translated, truncated or re-framed, ever.
//
// The action log is the design's centre of gravity: a day is a list of
// actions re-applied onto the day-start snapshot (the sim is deterministic).
// Live play, replay and future day-editing all flow through the same
// dispatch/apply pair — there is no second code path.

import { DIRS, makeTile, childAt } from "./world.js"
import * as Hex from "./hex.js"
import { sha256 } from "./vendor/sha256.js"

// ── tunables (the design is still settling — expect these to move) ──
export const RINGS = 4 // radius-4 hexagon = 61 tiles per board
export const SEED_ANGLE = 1 // the setup angle (dev fixture; later committed by the angle picker)
export const BASE_DEPTH = 1 // we START inside the home tile (depth 1); depth 0 is its outside/map view, gained later
export const MAX_DEPTH = 2 // base (1) → one level of tiles inside the home interior (2)
export const ENERGY_START = 60 // minutes of usable time to start (very reduced; grows later)
export const COST_BASE = 1 // the unit: the level base at the playing depth (MAX_DEPTH) — everything prices off 1
export const SCALE_RATIO = 6 // each level UP multiplies the base by this (1 inside a tile → 6 home interior → 36 outside)
export const MOVE_COST = 2 // moving onto a KNOWN tile costs this × the level base (one-way: 2 at the playing depth)
export const SCOUT_COST = 1 // SCOUT costs this × base — discovering is cheap; walking there is the commitment
export const LEAP = true // the leapfrog power move: jump the DIAGONAL — the tile beyond the edge
// two adjacent neighbours share — for ONE step's price (the landing tile's).
// Dev-on for playtesting; later an unlockable ability.
export const SCHEMA = 3 // save format version — the shape of the serialized object (3: world.worldKey)
export const RULES = 2 // replay-rules version (2: biome costs + impassable water) — bump on ANY change that alters what an old
// log replays to (costs, movement, gating); mismatched saves reset in dev

const key = Hex.key
const eq = Hex.equals

// ── tile types ───────────────────────────────────────
// Every hex can carry a type (sparse: tile.types["q,r"] for board interiors,
// tile.seamTypes[globalKey] for seam tiles); absent = plain for board
// interiors, seam for seam tiles. A type's properties are cost MULTIPLIERS on
// the level base — the hook for pricing tile kinds (terrain, specials)
// differently. Seams are the roads: moving along them costs half a step.
export const TILE_TYPES = {
  plain: { move: 1, scout: 1 },
  seam: { move: 0.5, scout: 1 }, // step onto a seam tile = 1 at depth 2
  // the derived biomes, PRICED (2026-07-06 — multipliers capped at 2×:
  // variance reads as flavour at 2×, as punishment beyond). Water is
  // IMPASSABLE on foot: scoutable from the shore, never walkable — seams
  // stay the roads, so no terrain roll can strand anyone; sealed pockets
  // behind water are future content (boats).
  water: { move: 1, scout: 1, impassable: true },
  beach: { move: 1, scout: 1 }, // easy ground, the water's edge
  marsh: { move: 2, scout: 1 }, // fertile but slow
  forest: { move: 1.5, scout: 1 }, // the timber belt
  mountain: { move: 2, scout: 2 }, // slow, hard to survey
  cliff: { move: 2, scout: 2 }, // the sheer faces
  peak: { move: 2, scout: 2 } // the deep grind (metal, later)
}

// ── terrain tunables (graduated from world.html 2026-07-06) ─────────
export const DETAIL = 0.4 // how hard the per-board subkeys tweak the base field
export const WATER_LEVEL = 4 // water below this, on the smoothed field
export const TARN_FLOOR = 9 // highland basins hold water only above this neighbourhood
export const TARN_DEPTH = 3 // …when carved at least this far below it
export const CLIFF_DROP = 5 // a mountain over a drop this sharp is a cliff
export const PEAK_NIBBLE = 15 // a peak is the subkey's own f on mountain ground

// Centre-out ring spiral: ring k starts at the "up" tile (0,−k) and walks
// clockwise — consecutive nibbles are (near-)adjacent tiles, so the key
// reads as a spiral inscription outward from home.
const SPIRAL_STEP = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]]
export function spiralOrder(R = RINGS) {
  const out = [[0, 0]]
  for (let k = 1; k <= R; k++) {
    let q = 0
    let r = -k
    for (const [dq, dr] of SPIRAL_STEP) {
      for (let j = 0; j < k; j++) {
        out.push([q, r])
        q += dq
        r += dr
      }
    }
  }
  return out
}

// Reading order: rows top to bottom, left to right within a row (pointy-top:
// a row = constant r, left-to-right = ascending q) — the key reads like text.
export function readingOrder(R = RINGS) {
  const out = []
  for (let r = -R; r <= R; r++) {
    for (let q = Math.max(-R, -r - R); q <= Math.min(R, R - r); q++) out.push([q, r])
  }
  return out
}

// Orientation alternates by depth; only the parity matters for topology.
export const orientOf = depth => (depth % 2 === 0 ? Hex.POINTY : Hex.FLAT)

// ── static topology (pure, shared by every level) ────
export const inBounds = (q, r) => Hex.length([q, r]) <= RINGS

// Sibling boards are pushed out one row: offsets are rotations of
// (2R+2, −(R+1)), which sit at the clean ±30/±90/±150° screen directions and
// leave EXACTLY one hex row between any two interiors — the seam.
export const SEAM_RING = RINGS + 1 // a board's seam ring (side seams + corner junctions)
export const VIEW_RING = RINGS + 2 // …and the neighbours' facing rows just beyond
export const SUPER = (() => {
  const out = []
  let q = 2 * RINGS + 2
  let r = -(RINGS + 1)
  for (let i = 0; i < 6; i++) {
    out.push([q, r])
    const nq = -r
    const nr = q + r
    q = nq
    r = nr
  }
  return out
})()

// Which neighbouring board (0..5) owns hex h relative to a board at the
// origin — interiors only — or -1. (Board-relative helper for pure topology.)
export function superIndexOf(q, r) {
  for (let i = 0; i < 6; i++) {
    if (Hex.length([q - SUPER[i][0], r - SUPER[i][1]]) <= RINGS) return i
  }
  return -1
}

// The neighbour lobes an off-board hex sits at seam distance from (side seam:
// one; junction or a neighbours' shared seam: two). Board-relative.
export function seamLobesOf(h) {
  const out = []
  for (let i = 0; i < 6; i++) {
    if (Hex.distance(h, SUPER[i]) === SEAM_RING) out.push(i)
  }
  return out
}

// A seam hex (relative to a board at the origin) belongs to no board and sits
// at seam distance from ≥2 of the seven centres — parent edges and vertices.
export function isSeamHex(h) {
  if (Hex.length(h) > VIEW_RING) return false
  if (superIndexOf(h[0], h[1]) >= 0 || Hex.length(h) <= RINGS) return false
  const mine = Hex.length(h) === SEAM_RING ? 1 : 0
  return mine + seamLobesOf(h).length >= 2
}

// The gate EDGE: where the seed angle's ray exits the board's interior — the
// single side of the last interior tile (the doorstep) that the ray crosses
// into the seam. Angle convention from the setup picker: 0° up, clockwise.
// Returns { k: doorstep hex key, side: DIR index, seam: the seam hex beyond }.
export function gateEdgeFor(angleDeg, parity = 0) {
  const o = orientOf(parity)
  const rad = (angleDeg * Math.PI) / 180
  const dx = Math.sin(rad)
  const dy = -Math.cos(rad) // canvas y grows downward
  const offRay = h => {
    const x = o.f[0] * h[0] + o.f[1] * h[1]
    const y = o.f[2] * h[0] + o.f[3] * h[1]
    return Math.abs(x * -dy + y * dx) // perpendicular distance to the ray
  }
  let door = [0, 0]
  for (let t = 0.5; t < SEAM_RING * 3; t += 0.05) {
    const h = Hex.round(o.b[0] * dx * t + o.b[1] * dy * t, o.b[2] * dx * t + o.b[3] * dy * t)
    if (Hex.length(h) <= RINGS) {
      door = h
      continue
    }
    if (Hex.length(h) !== SEAM_RING) break
    // grazed a corner and skipped the doorstep? re-anchor on the interior
    // neighbour of the seam hex closest to the ray
    if (Hex.distance(door, h) !== 1) {
      door = Hex.neighbors(h)
        .filter(n => Hex.length(n) <= RINGS)
        .sort((a, b) => offRay(a) - offRay(b))[0]
    }
    const side = Hex.neighbors(door).findIndex(n => eq(n, h))
    return { k: key(door), side, seam: h }
  }
  return { k: key([RINGS, 0]), side: 0, seam: [SEAM_RING, 0] } // unreachable fallback
}

// Super index i → parent DIR index, per child-depth parity. The seam obeys the
// parent grid, so the mapping matches each neighbour direction to the parent
// DIR at the same screen angle — exact matches at the pushed-out offsets.
export const SUPER_TO_PARENT_DIR = [0, 1].map(parity => {
  const child = orientOf(parity)
  const parent = orientOf(parity + 1)
  return SUPER.map(([sq, sr]) => {
    const sa = Hex.screenAngle(child, sq, sr)
    let best = 0
    let bd = Infinity
    for (let j = 0; j < 6; j++) {
      const pa = Hex.screenAngle(parent, DIRS[j].q, DIRS[j].r)
      const d = Math.abs(Math.atan2(Math.sin(sa - pa), Math.cos(sa - pa)))
      if (d < bd) {
        bd = d
        best = j
      }
    }
    return best
  })
})

// The home's gate: a single EDGE of the doorstep tile, seeded by the angle.
// GATE_TILE is the seam hex just beyond it; the parent-scale gate direction
// derives from that hex's lobe — used only by the locked base view's visuals.
export const GATE_EDGE = gateEdgeFor(SEED_ANGLE)
export const GATE_TILE = GATE_EDGE.seam
export const GATE_DIR = SUPER_TO_PARENT_DIR[0][seamLobesOf(GATE_TILE)[0]]

// A full board's worth of hexes — discovering them all is what opens a gate.
export const BOARD_TILES = Hex.range(RINGS).length

// Interior border tiles that touch the seam toward neighbour i (board-relative).
export const edgeTilesInto = i =>
  Hex.ring([0, 0], RINGS).filter(t =>
    Hex.neighbors(t).some(n => Hex.length(n) === SEAM_RING && isSeamHex(n) && seamLobesOf(n).includes(i))
  )

// Interior border tile at the centre of edge i — where entering from the
// parent lands you. Argmin of off-axis offset along the neighbour direction.
export const EDGE_CENTER = [0, 1].map(parity => {
  const o = orientOf(parity)
  return SUPER.map((s, i) => {
    const ang = Hex.screenAngle(o, s[0], s[1])
    const dirx = Math.cos(ang)
    const diry = Math.sin(ang)
    let best = null
    let bd = Infinity
    for (const t of edgeTilesInto(i)) {
      const x = o.f[0] * t[0] + o.f[1] * t[1]
      const y = o.f[2] * t[0] + o.f[3] * t[1]
      const perp = Math.abs(x * -diry + y * dirx)
      if (perp < bd) {
        bd = perp
        best = t
      }
    }
    return best
  })
})

// A key's 64 chars laid onto a 61-tile board: the CENTRE takes the middle
// four, the other 60 tiles take the rest in reading order. Used twice — the
// pubkey on the home board (identity, display) and the world key on the
// PARENT grid (the terrain's base field).
function inscribe(hex64) {
  const out = new Map()
  const mid = hex64.length / 2
  const centre = hex64.slice(mid - 2, mid + 2)
  const rest = hex64.slice(0, mid - 2) + hex64.slice(mid + 2)
  let i = 0
  for (const t of readingOrder(RINGS)) out.set(key(t), t[0] === 0 && t[1] === 0 ? centre : rest[i++])
  return out
}
const hex64Check = (v, name) => {
  if (v != null && !/^[0-9a-f]{64}$/.test(v)) throw new Error(name + " must be 64 lowercase hex chars")
}

// ── the sim instance ─────────────────────────────────
export function createSim({ angle = SEED_ANGLE, pubkey = null, worldKey = null } = {}) {
  // The world's one chosen input: the setup angle seeds where the gate falls
  // (and, later, everything social — hue, faction, season phase). Per
  // instance: every sim carries its own; the module-level GATE_* constants
  // remain the dev-default fixtures.
  const gateEdge = gateEdgeFor(angle)
  const gateDir = SUPER_TO_PARENT_DIR[0][seamLobesOf(gateEdge.seam)[0]]

  // Identities: the PUBKEY (main key) inscribes the home board — display
  // only, who you are. The WORLD KEY (generated, throwaway) derives the
  // terrain everywhere. Both lazy and pure — nothing stored, replay-safe.
  hex64Check(pubkey, "pubkey")
  hex64Check(worldKey, "worldKey")
  const homeChars = pubkey ? inscribe(pubkey) : new Map()

  // The hex character(s) inscribed on a (home-board) tile, or null — one char
  // per tile, four on the centre. The renderer shows the key literally;
  // everything else derives from it.
  const nibbleAt = g => {
    const b = boardOf(g)
    return b && b.c[0] === 0 && b.c[1] === 0 ? (homeChars.get(key(b.local)) ?? null) : null
  }
  const homeOutside = makeTile()
  const homeInside = childAt(homeOutside, "0,0")
  homeInside.discovered.add("0,0") // the home (base) centre starts known; the rest is fog
  homeOutside.discovered.add("0,0") // …and the home tile itself is known at the parent scale (we live in it)

  let energy = ENERGY_START // shared across levels; spent going out, refills only by resting home
  let day = 1 // current day/expedition; energy spent = minutes past 06:00
  let log = [] // this day's actions in order (replay re-applies them); banked + reset on sleep
  let logMeta = [] // per-entry minutes charged, index-aligned with log — display-only, derived, never saved
  const history = [] // past days: { day, actions, start } (for future day-navigation)
  let todayDiscovered = [] // {tile, key, seam?} first discovered TODAY — replay re-fogs these (display-only)
  let todayReached = [] // {tile, i} edges first reached TODAY — same journal for the edge ratchet
  let replaying = false // suppresses logging + day-boundary side effects while a replay re-applies
  let dayStart = null // snapshot of where/how this day began (set at init and on every sleep)

  // Levels. Below the top everything is bookkeeping: `player` on a lower
  // level is the parent hex the level above lives in, `trail` its committed
  // parent-scale path (the reserve prices its legs). On the TOP level player /
  // entry / trail are GLOBAL lattice coordinates.
  const frame = (tile, hexKey, o) => ({
    tile, // the current/last board's world node (top) or this level's node
    key: hexKey, // hex key inside the parent tile (null for the root)
    isBase: false,
    entry: [0, 0],
    player: [0, 0],
    trail: [[0, 0]],
    cost: 0,
    ...o
  })

  const stack = [
    frame(homeOutside, null, { cost: COST_BASE * SCALE_RATIO ** MAX_DEPTH }),
    frame(homeInside, "0,0", { isBase: true, cost: COST_BASE * SCALE_RATIO ** (MAX_DEPTH - 1) })
  ]

  const view = () => stack[stack.length - 1]
  const depth = () => stack.length - 1
  const parity = () => depth() % 2
  const parentOf = () => stack[depth() - 1]

  // ── the global lattice ──────────────────────────────
  // Basis: parent hex c sits at global basis(c) = c.q·b0 + c.r·b1.
  const basisOf = () => {
    const tbl = SUPER_TO_PARENT_DIR[parity()]
    return { b0: SUPER[tbl.indexOf(0)], b1: SUPER[tbl.indexOf(5)] }
  }
  const boardCentre = c => {
    const { b0, b1 } = basisOf()
    return [c[0] * b0[0] + c[1] * b1[0], c[0] * b0[1] + c[1] * b1[1]]
  }

  // Which board owns a global hex — and whether it's seam — is PURE lattice
  // math per depth: memoised forever (the node lookup stays live below, since
  // children appear lazily). This is the hottest call in the sim — every wall
  // check, discovery lookup and neighbour walk lands here.
  const geoCache = new Map() // "depth:q,r" → { c, centre, local } | "seam" | null
  function boardGeo(g) {
    const ck = depth() + ":" + key(g)
    const hit = geoCache.get(ck)
    if (hit !== undefined) return hit
    const { b0, b1 } = basisOf()
    const det = b0[0] * b1[1] - b1[0] * b0[1]
    const pf = [(g[0] * b1[1] - g[1] * b1[0]) / det, (g[1] * b0[0] - g[0] * b0[1]) / det]
    const pc = Hex.round(pf[0], pf[1])
    let out = null
    let seams = 0
    for (const c of [pc, ...Hex.neighbors(pc)]) {
      if (!inBounds(c[0], c[1])) continue // boards exist only over the parent grid
      const centre = boardCentre(c)
      const dist = Hex.distance(g, centre)
      if (dist <= RINGS) {
        out = { c, centre, local: [g[0] - centre[0], g[1] - centre[1]] }
        break
      }
      if (dist === SEAM_RING) seams++
    }
    if (!out && seams >= 2) out = "seam"
    geoCache.set(ck, out)
    return out
  }

  // The board owning global hex g: { c: parent hex, centre, local, node? } or null.
  function boardOf(g) {
    const geo = boardGeo(g)
    if (!geo || geo === "seam") return null
    return { c: geo.c, centre: geo.centre, local: geo.local, node: parentOf().tile.children[key(geo.c)] }
  }

  // Is global hex g on the seam (between ≥2 boards over the parent grid)?
  const isSeamAt = g => boardGeo(g) === "seam"

  // Classify ANY global coordinate — unbounded, no frames, no rings.
  function kindOf(g) {
    if (depth() <= BASE_DEPTH) return Hex.length(g) <= RINGS ? "in" : null
    const geo = boardGeo(g)
    return geo ? (geo === "seam" ? "seam" : "in") : null
  }

  const boardHexOf = g => boardOf(g)?.c ?? null
  const boardCentreOf = g => boardOf(g)?.centre ?? null

  // ── discovery journals (the ratchet never shrinks; the journal is what
  //    replay may re-fog, display-only) ────────────────
  function journalDiscover(tile, k) {
    if (tile.discovered.has(k)) return
    if (!todayDiscovered.some(d => !d.seam && d.tile === tile && d.key === k)) todayDiscovered.push({ tile, key: k })
    tile.discovered.add(k)
    worldStamp++
    // a gated board opens once the whole board is discovered — a ratchet,
    // like discovery itself: the gate edge's wall bit clears for good
    if (tile.gate && !tile.gateOpen && tile.discovered.size >= BOARD_TILES) {
      tile.gateOpen = true
      tile.walls[tile.gate.k] &= ~(1 << tile.gate.side)
    }
  }
  function journalSeam(tile, gk) {
    if (tile.seamDiscovered.has(gk)) return
    if (!todayDiscovered.some(d => d.seam && d.tile === tile && d.key === gk))
      todayDiscovered.push({ tile, key: gk, seam: true })
    tile.seamDiscovered.add(gk)
    worldStamp++
  }
  function journalReach(tile, i) {
    if (tile.reachedEdges.has(i)) return
    if (!todayReached.some(r => r.tile === tile && r.i === i)) todayReached.push({ tile, i })
    tile.reachedEdges.add(i)
  }

  // ── discovery lookups (global) ──────────────────────
  const isDiscovered = g => {
    if (depth() <= BASE_DEPTH) return view().tile.discovered.has(key(g))
    const b = boardOf(g)
    if (b) return !!b.node && b.node.discovered.has(key(b.local))
    if (isSeamAt(g)) return parentOf().tile.seamDiscovered.has(key(g))
    return false
  }

  // ── walls (per hex side, any hex) ───────────────────
  function wallBits(g) {
    if (depth() <= BASE_DEPTH) return 0
    const b = boardOf(g)
    if (b) return (b.node && b.node.walls[key(b.local)]) || 0
    if (isSeamAt(g)) return parentOf().tile.seamWalls[key(g)] || 0
    return 0
  }

  // A wall on EITHER side of an edge blocks the step across it.
  const stepBlocked = (a, b, d) => ((wallBits(a) >> d) & 1) === 1 || ((wallBits(b) >> ((d + 3) % 6)) & 1) === 1

  // Neighbours the player can actually step between — global, wall-aware.
  // What you can SEE from a tile: wall-filtered adjacency, passability
  // irrelevant — you scout the sea from the shore, you just can't stand on it.
  function sightNeighbors(g) {
    const out = []
    for (let d = 0; d < 6; d++) {
      const n = [g[0] + DIRS[d].q, g[1] + DIRS[d].r]
      if (!kindOf(n)) continue
      if (stepBlocked(g, n, d)) continue
      out.push(n)
    }
    return out
  }

  // What you can STEP between: sight minus impassable ground (water).
  const walkNeighbors = g => sightNeighbors(g).filter(n => !typeOf(n).impassable)

  // Leap targets: the six DIAGONALS (g + DIRS[i] + DIRS[i+1]) — the tile that
  // sits directly beyond the edge shared by two adjacent neighbours. The leap
  // rides that edge like a road: out through the vertex between the two
  // flankers, along their shared edge, in through the far vertex. Legal when
  // both flanking tiles are discovered walkable ground and no wall touches
  // the corridor (the two edges at each vertex, and the ridden edge itself —
  // so a gate still funnels single-file steps, never leaps). The flankers are
  // jumped OVER — never stood on, never charged; the leap prices as ONE step
  // onto the landing, so routing prefers it wherever the ground is known.
  // Chains naturally: each leap is one edge of the move graph.
  function leapNeighbors(g) {
    if (!LEAP) return []
    const out = []
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6
      const A = [g[0] + DIRS[i].q, g[1] + DIRS[i].r]
      const B = [g[0] + DIRS[j].q, g[1] + DIRS[j].r]
      if (!kindOf(A) || !kindOf(B)) continue
      if (!isDiscovered(A) || !isDiscovered(B)) continue // you leap over KNOWN ground
      const t = [g[0] + DIRS[i].q + DIRS[j].q, g[1] + DIRS[i].r + DIRS[j].r]
      if (!kindOf(t)) continue
      if (stepBlocked(g, A, i) || stepBlocked(g, B, j)) continue // walls pinch the exit vertex
      if (stepBlocked(A, B, (i + 2) % 6)) continue // a wall along the ridden edge
      if (stepBlocked(A, t, j) || stepBlocked(B, t, i)) continue // walls pinch the entry vertex
      // no leaping over (or onto) water — straits are for boats and bridges
      if (typeOf(A).impassable || typeOf(B).impassable || typeOf(t).impassable) continue
      out.push(t)
    }
    return out
  }

  // Everywhere one MOVE action can land from g: plain steps + leaps. This is
  // the movement graph — routing, the reserve and retrace validation all
  // derive from it, so the power move flows through every affordability check.
  const moveNeighbors = g => [...walkNeighbors(g), ...leapNeighbors(g)]

  // Frontier = the player's OWN undiscovered VISIBLE neighbours (scouting
  // stays adjacent-only — no leap-scouting; the sea counts, you see it fine).
  const isFrontier = g => !isDiscovered(g) && !!kindOf(g) && sightNeighbors(view().player).some(n => eq(n, g))

  // Routing is one Dijkstra sweep from the player over DISCOVERED ground —
  // one graph, boards and seam alike — minimising lexicographically:
  //   1. CHARGE (what you actually pay — free safe ground beats cheap ground)
  //   2. COST (time on the road, so free-ground ties still take the short way)
  //   3. LEAPS (a leap that saves nothing is just showing off — walk instead)
  // Cached per (world, player); routeTo unwinds prev pointers, canMove reads
  // the charge. See reachMap below (after the cost helpers it depends on).
  const ROUTE_CMP = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

  function routeTo(target) {
    if (eq(target, view().player)) return [target]
    const m = reachMap()
    if (!m.has(key(target))) return null
    const path = []
    for (let cur = target; cur; cur = m.get(key(cur)).prev) path.unshift(cur)
    return path
  }

  // ── terrain (two-octave world field — worldKey → biome, pure) ───────
  // BASE: the world key's 64 nibbles on the PARENT grid (the same inscribe()
  // as home, one scale up), interpolated between board centres so the macro
  // field is continuous across seams — the world's shape IS the key.
  // DETAIL: per-board SHA-256 streams tweak the base ±7.5·DETAIL.
  // Everything below is a pure function of (worldKey, position), cached.
  const utf8 = s => new TextEncoder().encode(s)
  const hexOf = bytes => [...bytes].map(b => b.toString(16).padStart(2, "0")).join("")
  const unitXY = g => ({ x: Math.sqrt(3) * (g[0] + g[1] / 2), y: 1.5 * g[1] })
  const boardBase = new Map() // parent "q,r" → 0..15 (the key's nibble for that board)
  if (worldKey) {
    for (const [k2, ch] of inscribe(worldKey)) {
      boardBase.set(k2, ch.length === 1 ? parseInt(ch, 16) : [...ch].reduce((s, c) => s + parseInt(c, 16), 0) / 4)
    }
  }
  const PITCH = Math.hypot(
    unitXY(boardCentre([1, 0])).x - unitXY(boardCentre([0, 0])).x,
    unitXY(boardCentre([1, 0])).y - unitXY(boardCentre([0, 0])).y
  )
  const streamCache = new Map() // parent "q,r" → 64 hex chars (the board's subkey)
  const streamOf = ck => {
    let s = streamCache.get(ck)
    if (!s) {
      s = hexOf(sha256(utf8(worldKey + ":board:" + ck)))
      streamCache.set(ck, s)
    }
    return s
  }
  const localIdx = new Map(readingOrder(RINGS).map((t, i) => [key(t), i]))
  // combined height of an INTERIOR tile (base field ± subkey tweak)
  const combinedCache = new Map()
  function combinedAt(g) {
    const gk = key(g)
    let v = combinedCache.get(gk)
    if (v !== undefined) return v
    const b = boardGeo(g)
    if (!b || b === "seam") {
      // seam: the mean of its interior flanks — fields cross the roads
      let s = 0
      let n = 0
      for (const d of DIRS) {
        const ng = [g[0] + d.q, g[1] + d.r]
        const nb = boardGeo(ng)
        if (nb && nb !== "seam") {
          s += combinedAt(ng)
          n++
        }
      }
      v = n ? s / n : 7.5
    } else {
      const p = unitXY(g)
      let sum = 0
      let wsum = 0
      for (const c of [b.c, ...Hex.neighbors(b.c)]) {
        const bb = boardBase.get(key(c))
        if (bb === undefined) continue
        const cu = unitXY(boardCentre(c))
        const d = Math.hypot(p.x - cu.x, p.y - cu.y)
        if (d >= PITCH) continue
        const w = 1 - d / PITCH
        sum += w * bb
        wsum += w
      }
      const base = wsum ? sum / wsum : 7.5
      const local = parseInt(streamOf(key(b.c))[localIdx.get(key(b.local))], 16)
      v = Math.max(0, Math.min(15, base + (local - 7.5) * DETAIL))
    }
    combinedCache.set(gk, v)
    return v
  }
  const smoothedAt = g => {
    let s = 2 * combinedAt(g)
    let n = 2
    for (const d of DIRS) {
      const ng = [g[0] + d.q, g[1] + d.r]
      if (kindOf(ng)) {
        s += combinedAt(ng)
        n++
      }
    }
    return s / n
  }
  // the terrain-relevant neighbour: straight across a seam if one intervenes
  const acrossT = (g, d) => {
    let n = [g[0] + DIRS[d].q, g[1] + DIRS[d].r]
    let k2 = kindOf(n)
    if (k2 === "seam") {
      n = [n[0] + DIRS[d].q, n[1] + DIRS[d].r]
      k2 = kindOf(n)
    }
    return k2 === "in" ? n : null
  }
  // base class: mountain (raw spikes), water (smoothed lowlands + highland
  // tarns — basins carved below a high neighbourhood), else plain
  const baseClassCache = new Map()
  function baseClassAt(g) {
    const gk = key(g)
    let v = baseClassCache.get(gk)
    if (v) return v
    const raw = combinedAt(g)
    let s = 0
    let n = 0
    for (let d = 0; d < 6; d++) {
      const ng = acrossT(g, d)
      if (!ng) continue
      s += combinedAt(ng)
      n++
    }
    const nbrAvg = n ? s / n : raw
    const tarn = nbrAvg >= TARN_FLOOR && raw <= nbrAvg - TARN_DEPTH
    v = tarn ? "water" : raw >= 12 ? "mountain" : smoothedAt(g) < WATER_LEVEL ? "water" : "plain"
    baseClassCache.set(gk, v)
    return v
  }
  // full biome: the neighbour grammar on top of the base class
  const biomeCache = new Map()
  function biomeAt(g) {
    const gk = key(g)
    let v = biomeCache.get(gk)
    if (v) return v
    const b = baseClassAt(g)
    let water = 0
    let mountain = 0
    let minNbr = 15
    for (let d = 0; d < 6; d++) {
      const ng = acrossT(g, d)
      if (!ng) continue
      const nb = baseClassAt(ng)
      if (nb === "water") water++
      if (nb === "mountain") mountain++
      minNbr = Math.min(minNbr, combinedAt(ng))
    }
    v = b
    if (b === "mountain") {
      const local = parseInt(streamOf(key(boardGeo(g).c))[localIdx.get(key(boardGeo(g).local))], 16)
      v = local === PEAK_NIBBLE ? "peak" : water || combinedAt(g) - minNbr >= CLIFF_DROP ? "cliff" : "mountain"
    } else if (b === "plain") {
      v = water >= 2 ? "marsh" : water ? "beach" : mountain ? "forest" : "plain"
    } else if (b === "water") {
      // the HOME board never holds open water: it must stay fully walkable
      // or the gate could never open (clear = discover all 61). Water there
      // reads as marsh — wet ground. Neighbour grammar still sees the water
      // base, so shores ring it naturally.
      const bg = boardGeo(g)
      if (bg && bg !== "seam" && bg.c[0] === 0 && bg.c[1] === 0) v = "marsh"
    }
    biomeCache.set(gk, v)
    return v
  }

  // ── costs ────────────────────────────────────────────
  const stepCost = () => view().cost * MOVE_COST // move onto a known tile
  const scoutCost = () => view().cost * SCOUT_COST // reveal an adjacent tile, staying put
  // Resolve a hex's type NAME: stored sparse maps first, then the derived
  // terrain, then the kind's default. typeOf feeds costs; the renderer reads
  // the name for the land's look.
  const typeNameAt = g => {
    const b = boardOf(g)
    if (b) {
      const stored = b.node && b.node.types[key(b.local)]
      if (stored) return stored
      return worldKey ? biomeAt(g) : "plain"
    }
    return parentOf().tile.seamTypes[key(g)] || "seam"
  }
  const typeOf = g => TILE_TYPES[typeNameAt(g)]
  const stepCostAt = g => stepCost() * typeOf(g).move
  const scoutCostAt = g => scoutCost() * typeOf(g).scout
  // The safe umbrella covers safe board INTERIORS only — the seam sits outside
  // the walls, so steps/scouts targeting it charge even while based at home.
  const freeAt = g => !!boardOf(g)?.node?.safe
  const stepChargeAt = g => (freeAt(g) ? 0 : stepCostAt(g))
  const scoutChargeAt = g => (freeAt(g) ? 0 : scoutCostAt(g))
  const pathCost = path => {
    let c = 0
    for (let i = 1; i < path.length; i++) c += stepCostAt(path[i])
    return c
  }
  const pathCharge = path => {
    let c = 0
    for (let i = 1; i < path.length; i++) c += stepChargeAt(path[i])
    return c
  }

  // ── resting places & the reserve (the EXACT way to safety) ──────────
  // The world's list of places a day can end and restart from. The home
  // centre is entry ONE; future built rest spots (camps, waystations…) push
  // here. The loop stays closed: you can only continue while at least one
  // resting place is still affordably reachable — that's what makes a saved
  // state always a safe state.
  const restSpots = [[0, 0]]

  // The reserve is the true cheapest cost of walking from a position to the
  // NEAREST resting place over discovered ground — one multi-source Dijkstra
  // seeded at every rest spot (edge weight = the charge of the tile stepped
  // onto, going spot-ward), cached until the world or the spot list changes.
  // This makes never-strandable LITERAL: at energy == reserve the trip to
  // safety is affordable to the minute, every minute.
  let worldStamp = 0 // bumped on discovery/wall changes — invalidates the map
  let reserveCache = { stamp: -1, spots: 0, map: null }

  function reserveMap() {
    if (reserveCache.stamp === worldStamp && reserveCache.spots === restSpots.length) return reserveCache.map
    const dist = new Map(restSpots.map(s => [key(s), 0]))
    // Dijkstra over the discovered ground, min-heap on cost
    const q = restSpots.map(s => [0, s])
    const up = i => {
      for (let p; i && q[(p = (i - 1) >> 1)][0] > q[i][0]; i = p) [q[p], q[i]] = [q[i], q[p]]
    }
    const down = () => {
      for (let i = 0; ; ) {
        let m = i
        const l = 2 * i + 1
        if (l < q.length && q[l][0] < q[m][0]) m = l
        if (l + 1 < q.length && q[l + 1][0] < q[m][0]) m = l + 1
        if (m === i) break
        ;[q[m], q[i]] = [q[i], q[m]]
        i = m
      }
    }
    while (q.length) {
      const [d, cur] = q[0]
      const last = q.pop()
      if (q.length) {
        q[0] = last
        down()
      }
      if (d > (dist.get(key(cur)) ?? Infinity)) continue
      const charge = stepChargeAt(cur) // stepping (or leaping) from a neighbour toward `cur` charges entering cur
      for (const n of moveNeighbors(cur)) {
        if (!isDiscovered(n)) continue // the way home runs over known ground
        const nd = d + charge
        if (nd < (dist.get(key(n)) ?? Infinity)) {
          dist.set(key(n), nd)
          q.push([nd, n])
          up(q.length - 1)
        }
      }
    }
    reserveCache = { stamp: worldStamp, spots: restSpots.length, map: dist }
    return dist
  }

  const returnFrom = pos => reserveMap().get(key(pos)) ?? Infinity
  // No reserve while inside our own safe board.
  const returnCost = () => (freeAt(view().player) ? 0 : returnFrom(view().player))

  // ── affordability / validity ─────────────────────────
  // The route map behind routeTo/canMove: one Dijkstra sweep from the player
  // over discovered ground, minimising (charge, cost, leaps) — see ROUTE_CMP.
  // Every entry: { charge, cost, leaps, prev } for one global hex.
  let reachCache = { stamp: -1, from: "", map: null }
  function reachMap() {
    const fk = key(view().player)
    if (reachCache.stamp === worldStamp && reachCache.from === fk) return reachCache.map
    const best = new Map([[fk, { charge: 0, cost: 0, leaps: 0, prev: null }]])
    // min-heap of [charge, cost, leaps, pos] under ROUTE_CMP, lazy deletion
    const q = [[0, 0, 0, view().player]]
    const up = i => {
      for (let p; i && ROUTE_CMP(q[(p = (i - 1) >> 1)], q[i]) > 0; i = p) [q[p], q[i]] = [q[i], q[p]]
    }
    const down = () => {
      for (let i = 0; ; ) {
        let m = i
        const l = 2 * i + 1
        if (l < q.length && ROUTE_CMP(q[l], q[m]) < 0) m = l
        if (l + 1 < q.length && ROUTE_CMP(q[l + 1], q[m]) < 0) m = l + 1
        if (m === i) break
        ;[q[m], q[i]] = [q[i], q[m]]
        i = m
      }
    }
    while (q.length) {
      const top = q[0]
      const last = q.pop()
      if (q.length) {
        q[0] = last
        down()
      }
      const cur = top[3]
      const b = best.get(key(cur))
      if (ROUTE_CMP(top, [b.charge, b.cost, b.leaps]) > 0) continue // stale heap entry
      for (const n of moveNeighbors(cur)) {
        if (!isDiscovered(n)) continue // routes run over known ground only
        const e = [top[0] + stepChargeAt(n), top[1] + stepCostAt(n), top[2] + (Hex.distance(cur, n) > 1 ? 1 : 0)]
        const nk = key(n)
        const nb = best.get(nk)
        if (!nb || ROUTE_CMP(e, [nb.charge, nb.cost, nb.leaps]) < 0) {
          best.set(nk, { charge: e[0], cost: e[1], leaps: e[2], prev: cur })
          q.push([e[0], e[1], e[2], n])
          up(q.length - 1)
        }
      }
    }
    reachCache = { stamp: worldStamp, from: fk, map: best }
    return best
  }

  function canMove(target) {
    if (!kindOf(target) || !isDiscovered(target)) return false
    const e = reachMap().get(key(target))
    if (!e) return false
    const reserve = freeAt(target) ? 0 : returnFrom(target)
    return e.charge + reserve <= energy
  }

  const canScout = target => isFrontier(target) && scoutChargeAt(target) + returnCost() <= energy

  // Reserve needed to get home AFTER entering the tile under the player.
  function enterReturn() {
    const b = boardOf(view().player)
    const child = b && b.node && b.node.children[key(b.local)]
    if (child && child.safe) return 0
    let c = 0
    for (let j = 0; j < stack.length; j++) {
      c += (stack[j].trail.length - 1) * (stack[j].cost * MOVE_COST)
      if (j > BASE_DEPTH) c += stack[j - 1].cost * MOVE_COST
    }
    c += view().cost * MOVE_COST // climbing back out of the tile we enter
    return c
  }

  const canEnter = () =>
    depth() < MAX_DEPTH && !!boardOf(view().player) && !eq(view().player, view().entry) && enterReturn() <= energy

  // Undiscovered tiles adjacent to WHERE YOU SIT that you can afford to scout.
  function reachableDots() {
    const dots = new Set()
    for (const n of sightNeighbors(view().player)) {
      if (!isDiscovered(n) && canScout(n)) dots.add(key(n))
    }
    return dots
  }

  // Index of `g` on the committed trail (excluding the player's own end), or -1.
  function trailIndexOf(g) {
    const tr = view().trail
    for (let i = 0; i < tr.length - 1; i++) if (eq(tr[i], g)) return i
    return -1
  }

  // The retrace back along the trail to `g` — the trail is one global walk,
  // so a retrace is just a via move over it, crossings included.
  function retraceRoute(g) {
    const ti = trailIndexOf(g)
    if (ti < 0) return null
    const rp = view().trail.slice(ti).reverse()
    return viaValid(rp, g) ? rp : null
  }

  // A caller-supplied route (a trail retrace) is valid when it starts at the
  // player, steps only between walkable neighbours over discovered ground,
  // and leaves the reserve intact — replay re-validates it like a live click.
  function viaValid(via, target) {
    if (!Array.isArray(via) || via.length < 2) return false
    if (!eq(via[0], view().player) || !eq(via[via.length - 1], target)) return false
    for (let i = 1; i < via.length; i++) {
      if (!isDiscovered(via[i])) return false
      if (!moveNeighbors(via[i - 1]).some(n => eq(n, via[i]))) return false
    }
    const reserve = freeAt(target) ? 0 : returnFrom(target)
    return pathCharge(via) + reserve <= energy
  }

  // ── mutations (internal — only apply/dispatch reach these) ──────
  // Entering a different board is part of an ordinary step: the parent trail
  // extends/retraces, the parent tile becomes discovered, the bookkeeping
  // (current board node, camera anchor) follows. The global trail is untouched.
  function parentStep(c) {
    const parent = parentOf()
    journalDiscover(parent.tile, key(c)) // stepping into it discovers it at the parent scale
    if (parent.trail.length >= 2 && eq(c, parent.trail[parent.trail.length - 2])) parent.trail.pop()
    else parent.trail.push(c)
    parent.player = c.slice()
    const top = view()
    top.tile = childAt(parent.tile, key(c))
    top.key = key(c)
  }

  function stepOnto(g) {
    const v = view()
    if (v.trail.length >= 2 && eq(g, v.trail[v.trail.length - 2])) v.trail.pop()
    else v.trail.push(g)
    energy -= stepChargeAt(g) // 0 inside a safe board
    v.player = g
    const b = boardOf(g)
    if (b && !eq(b.c, parentOf().player)) parentStep(b.c)
    markReachedEdges()
  }

  // Standing beside the seam reaches those edges — a permanent ratchet.
  function markReachedEdges() {
    const b = boardOf(view().player)
    if (!b || !b.node) return
    for (const d of DIRS) {
      const n = [b.local[0] + d.q, b.local[1] + d.r]
      if (Hex.length(n) === SEAM_RING && isSeamHex(n)) {
        const lobes = seamLobesOf(n)
        if (lobes.length === 1) journalReach(b.node, lobes[0])
      }
    }
  }

  // Arriving back at the day's entry clears the trail.
  function restIfHome() {
    const v = view()
    if (eq(v.player, v.entry)) v.trail = [v.entry.slice()]
  }

  // Rest — a deliberate action at the centre special tile: refill, bank the
  // day, start the next.
  function doRest() {
    const v = view()
    energy = ENERGY_START
    v.trail = [v.player.slice()]
    sleep()
  }

  // Scout: reveal an adjacent undiscovered tile without moving. Board tiles
  // are revealed in the board that owns them; seam tiles on the parent
  // (shared by every board of the edge) — same action, same rates.
  function doScout(target) {
    energy -= scoutChargeAt(target)
    const b = boardOf(target)
    if (b) {
      journalDiscover(childAt(parentOf().tile, key(b.c)), key(b.local))
    } else {
      journalSeam(parentOf().tile, key(target))
    }
  }

  // Descend into the tile under the player. (Not reachable in normal play
  // while the game lives at MAX_DEPTH — kept sane for the future.)
  function doEnter() {
    const b = boardOf(view().player)
    if (!b) return
    const child = childAt(childAt(parentOf().tile, key(b.c)), key(b.local))
    stack.push(frame(child, key(b.local), { cost: view().cost / SCALE_RATIO }))
    const cv = view()
    const centre = boardCentre([0, 0]) // the new level anchors its own plane
    const start = EDGE_CENTER[parity()][0]
    cv.entry = [centre[0] + start[0], centre[1] + start[1]]
    cv.player = cv.entry.slice()
    cv.trail = [cv.entry.slice()]
    journalDiscover(cv.tile, key(start))
  }

  // Our own safe space: the walled home board with its angle-seeded gate.
  function doEnterHome() {
    const v = view()
    const child = childAt(v.tile, key(v.player))
    child.discovered.add(key([0, 0])) // the centre special tile starts known (pre-day; not journaled)
    child.safe = true
    stack.push(
      frame(child, key(v.player), {
        cost: v.cost / SCALE_RATIO,
        entry: [0, 0],
        player: [0, 0],
        trail: [[0, 0]]
      })
    )
    // Seal the board: every border hex walls its outward sides — including
    // the gate edge (the doorstep side the seed angle exits through), which
    // starts CLOSED. journalDiscover clears that one bit when the board is
    // cleared. Walls are plain per-hex-side data; nothing here is home-only.
    if (!child.gate) {
      for (const t of Hex.ring([0, 0], RINGS)) {
        let bits = 0
        for (let d = 0; d < 6; d++) {
          if (Hex.length([t[0] + DIRS[d].q, t[1] + DIRS[d].r]) > RINGS) bits |= 1 << d
        }
        child.walls[key(t)] = bits
      }
      child.gate = { k: gateEdge.k, side: gateEdge.side }
    }
    worldStamp++
  }

  // Sleep: bank the day's actions (with the day-start snapshot they replay
  // from), advance the day, snapshot the new day's start.
  function sleep() {
    if (log.length) history.push({ day, actions: log, start: dayStart })
    day++
    log = []
    logMeta = []
    todayDiscovered = []
    todayReached = []
    dayStart = snap()
  }

  // "Go home": collapse to the base, rest inside the home safe space, new day.
  // (A reliable way home regardless of energy — a gated ability later.)
  function goHomeRun() {
    while (stack.length > BASE_DEPTH + 1) stack.pop()
    const base = view()
    base.player = base.entry.slice()
    base.trail = [base.entry.slice()]
    energy = ENERGY_START
    doEnterHome()
    sleep()
  }

  // "Rest and resume": advance a day, then start it having already travelled
  // back out to where you stand (the trip out costs what the trip home would).
  function restResumeRun() {
    const back = returnCost()
    energy = ENERGY_START - back
    sleep()
  }

  // ── snapshots (how a day's start is remembered) ──────
  const snap = () => ({
    energy,
    day,
    frames: stack.slice(1).map(f => ({
      key: f.key,
      isBase: f.isBase,
      entry: f.entry.slice(),
      player: f.player.slice(),
      trail: f.trail.map(t => t.slice()),
      cost: f.cost
    }))
  })

  function restore(s) {
    energy = s.energy
    day = s.day
    stack.length = 1
    for (const fs of s.frames) {
      const parent = stack[stack.length - 1]
      stack.push(
        frame(childAt(parent.tile, fs.key), fs.key, {
          isBase: fs.isBase,
          entry: fs.entry.slice(),
          player: fs.player.slice(),
          trail: fs.trail.map(t => t.slice()),
          cost: fs.cost
        })
      )
    }
  }

  // ── replay (display rewind; the ratchets never shrink for real) ──
  function beginReplay() {
    replaying = true
    for (const d of todayDiscovered) (d.seam ? d.tile.seamDiscovered : d.tile.discovered).delete(d.key)
    for (const r of todayReached) r.tile.reachedEdges.delete(r.i)
    worldStamp++ // the rewind changed the walkable world under the caches
    restore(dayStart)
  }
  function endReplay() {
    for (const d of todayDiscovered) (d.seam ? d.tile.seamDiscovered : d.tile.discovered).add(d.key) // permanent
    for (const r of todayReached) r.tile.reachedEdges.add(r.i)
    worldStamp++
    replaying = false
  }

  // ── actions ──────────────────────────────────────────
  const ACTIONS = {
    move: {
      can: a => (a.via ? viaValid(a.via, a.target) : canMove(a.target)),
      run: a => {
        const path = a.via || routeTo(a.target)
        for (let i = 1; i < path.length; i++) stepOnto(path[i])
        restIfHome()
      }
    },
    scout: { can: a => canScout(a.target), run: a => doScout(a.target) },
    enter: { can: () => canEnter(), run: () => doEnter() },
    rest: {
      can: () => {
        const b = boardOf(view().player)
        return !!b && !!b.node && b.node.safe && eq(b.local, [0, 0])
      },
      run: () => doRest()
    },
    // Dev helper: reveal the whole current board at once (free) — exactly as
    // if every hex had been scouted, so the gate condition triggers normally.
    // Logged, so replay reproduces it.
    clearBoard: {
      can: () => !!boardOf(view().player),
      run: () => {
        const b = boardOf(view().player)
        const node = childAt(parentOf().tile, key(b.c))
        for (const h of Hex.range(RINGS)) journalDiscover(node, key(h))
      }
    },
    goHome: { can: () => true, run: () => goHomeRun() },
    restResume: {
      // the fresh day starts out here with the trip out already spent — that only
      // works if the trip home is still affordable on what's left (never-strandable)
      can: () => ENERGY_START - returnCost() >= returnCost(),
      run: () => restResumeRun()
    }
  }

  // Validate + mutate, no logging — replay re-applies banked actions with this.
  function apply(action) {
    const h = ACTIONS[action.type]
    if (!h) return { ok: false, reason: "unknown action " + action.type }
    if (!h.can(action)) return { ok: false, reason: action.type + " rejected" }
    h.run(action)
    return { ok: true }
  }

  // Every state-changing action is recorded — including the day-enders (rest,
  // goHome, restResume): pushed BEFORE running, they bank themselves as their
  // day's last entry, which is what lets a save replay ACROSS days.
  const LOGGED = new Set(["move", "scout", "enter", "clearBoard", "rest", "goHome", "restResume"])

  // Validate + log + mutate — the one door live play goes through. The entry
  // is pushed BEFORE running so a day-ending move banks itself with its day.
  function dispatch(action) {
    if (replaying) return { ok: false, reason: "replaying" }
    const h = ACTIONS[action.type]
    if (!h) return { ok: false, reason: "unknown action " + action.type }
    if (!h.can(action)) return { ok: false, reason: action.type + " rejected" }
    if (LOGGED.has(action.type)) log.push(action)
    const e0 = energy
    h.run(action)
    // display-only metadata: what the entry charged, index-aligned with the
    // log. DERIVED, never serialized — replay is the source of truth. (A
    // day-ender empties the log as it runs, so it never gets a meta row.)
    if (log.length && log[log.length - 1] === action) logMeta.push(e0 - energy)
    return { ok: true }
  }

  // ── persistence (the save IS the log — see DESIGN.md) ───────────────
  // Plain-JSON, no world state: banked day logs + today's partial log, plus
  // the version stamps that gate whether a replay still means what it meant.
  const serialize = () => ({
    app: "anon&mato",
    schema: SCHEMA,
    world: { angle, pubkey, worldKey, rings: RINGS, rules: RULES },
    days: history.map(h => ({ day: h.day, actions: h.actions })),
    today: { day, actions: log.slice() }
  })

  // Rebuild a save by re-dispatching every action from day 1 on a FRESH sim.
  // Any rejection means the save no longer replays under current rules —
  // the caller decides what to do with it (dev: stash and start over).
  function hydrate(save) {
    if (day !== 1 || log.length || history.length) return { ok: false, reason: "hydrate needs a fresh sim" }
    if (!save || save.schema !== SCHEMA) return { ok: false, reason: "schema mismatch" }
    const w = save.world || {}
    if (w.rules !== RULES) return { ok: false, reason: "rules mismatch" }
    if (w.angle !== angle || w.rings !== RINGS) return { ok: false, reason: "world mismatch" }
    if ((w.pubkey ?? null) !== pubkey) return { ok: false, reason: "identity mismatch" }
    if ((w.worldKey ?? null) !== worldKey) return { ok: false, reason: "world-key mismatch" }
    for (const d of save.days || []) {
      for (const a of d.actions) {
        const r = dispatch(a)
        if (!r.ok) return { ok: false, reason: `day ${d.day}: ${r.reason}` }
      }
    }
    if (save.today && save.today.day !== day) return { ok: false, reason: "day drift — truncated save?" }
    for (const a of save.today?.actions || []) {
      const r = dispatch(a)
      if (!r.ok) return { ok: false, reason: `today: ${r.reason}` }
    }
    return { ok: true }
  }

  // The game opens inside the home safe space (the default view), and the
  // first day starts there. Home sits at the global origin.
  doEnterHome()
  dayStart = snap()

  return {
    // state
    view,
    depth,
    parentOf,
    root: () => stack[0].tile,
    energy: () => energy,
    day: () => day,
    angle: () => angle,
    pubkey: () => pubkey,
    worldKey: () => worldKey,
    gateDir: () => gateDir,
    typeNameAt,
    nibbleAt,
    log: () => log,
    logMeta: () => logMeta,
    history: () => history,
    replaying: () => replaying,
    orient: () => orientOf(depth()),
    // rules queries (all coordinates GLOBAL)
    kindOf,
    boardHexOf,
    boardCentreOf,
    isDiscovered,
    isFrontier,
    canMove,
    canScout,
    canEnter,
    routeTo,
    retraceRoute,
    trailIndexOf,
    pathCost,
    stepCost,
    stepCostAt,
    scoutCost,
    scoutCostAt,
    returnCost,
    returnFrom,
    wallsAt: wallBits,
    reachableDots,
    // actions
    dispatch,
    apply,
    beginReplay,
    endReplay,
    // persistence
    serialize,
    hydrate
  }
}
