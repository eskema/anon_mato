// The game, pure and headless.
//
// Everything anon&mato IS lives here: the world tree, the view stack, energy,
// costs, discovery, the action log, day snapshots. No canvas, no DOM, no
// timers — this module runs in plain node (the tests do). Rendering and input
// live in render.js/grid.js and only ever call queries + dispatch.
//
// SPACE: sibling boards sit one row apart on a single shared lattice. The
// one-hex-thick rows between them are the SEAM — the parent grid's EDGES made
// of child-scale tiles (where three boards meet, a junction tile = a parent
// VERTEX). The seam is ordinary walkable ground shared by both boards of an
// edge; stepping off it onto a neighbour's tile is the crossing (the boards
// slide). No intermediate state — everything is scout/move on plain tiles.
//
// The action log is the design's centre of gravity: a day is a list of
// actions re-applied onto the day-start snapshot (the sim is deterministic).
// Live play, replay and future day-editing all flow through the same
// dispatch/apply pair — there is no second code path.

import { DIRS, makeTile, childAt } from "./world.js"
import * as Hex from "./hex.js"

// ── tunables (the design is still settling — expect these to move) ──
export const RINGS = 4 // radius-4 hexagon = 61 tiles per board
export const GATE_DIR = 2 // home's single exit (NW; placeholder, later from the chosen angle)
export const BASE_DEPTH = 1 // we START inside the home tile (depth 1); depth 0 is its outside/map view, gained later
export const MAX_DEPTH = 2 // base (1) → one level of tiles inside the home interior (2)
export const ENERGY_START = 60 // minutes of usable time to start (very reduced; grows later)
export const COST_HOME = 180 // per-step at the (locked) outside scale, so home-interior = 30, inside a tile = 5
export const SCALE_RATIO = 6 // each level deeper divides per-step cost by this (180 → 30 → 5)
export const MOVE_FRACTION = 0.4 // moving onto a KNOWN tile costs this × the level base (one-way: 2 at depth 2)
export const SCOUT_FRACTION = 0.6 // SCOUT costs this × base (3 at depth 2) — deliberately MORE than a walk

const key = Hex.key
const eq = Hex.equals

// ── tile types ───────────────────────────────────────
// Every hex can carry a type (sparse: tile.types["q,r"] for interiors,
// tile.seamTypes[globalKey] for seam tiles); absent = plain. A type's
// properties are cost MULTIPLIERS on the level base — all 1 for now, but this
// is the hook for pricing tile kinds (seam, terrain, specials) differently.
export const TILE_TYPES = {
  plain: { move: 1, scout: 1 }
}

// Orientation alternates by depth; only the parity matters for topology.
export const orientOf = depth => (depth % 2 === 0 ? Hex.POINTY : Hex.FLAT)

// ── static topology (pure, shared by every grid) ─────
export const inBounds = (q, r) => Hex.length([q, r]) <= RINGS

// Sibling boards are pushed out one row: offsets are rotations of
// (2R+2, −(R+1)), which sit at the clean ±30/±90/±150° screen directions and
// leave EXACTLY one hex row between any two interiors — the seam.
export const SEAM_RING = RINGS + 1 // my seam ring (side seams + corner junctions)
export const VIEW_RING = RINGS + 2 // the neighbours' facing rows (+ their seams at the corners)
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

// Which neighbouring board (0..5) owns hex h — interiors only — or -1.
export function superIndexOf(q, r) {
  for (let i = 0; i < 6; i++) {
    if (Hex.length([q - SUPER[i][0], r - SUPER[i][1]]) <= RINGS) return i
  }
  return -1
}

// The neighbour lobes an off-board hex sits at seam distance from (side seam:
// one; junction or a neighbours' shared seam: two).
export function seamLobesOf(h) {
  const out = []
  for (let i = 0; i < 6; i++) {
    if (Hex.distance(h, SUPER[i]) === SEAM_RING) out.push(i)
  }
  return out
}

// A seam hex belongs to no board and sits at seam distance from ≥2 of the
// seven centres (me + six neighbours) — parent edges and vertices as tiles.
export function isSeamHex(h) {
  if (Hex.length(h) > VIEW_RING) return false
  if (superIndexOf(h[0], h[1]) >= 0 || Hex.length(h) <= RINGS) return false
  const mine = Hex.length(h) === SEAM_RING ? 1 : 0
  return mine + seamLobesOf(h).length >= 2
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

// Interior border tiles that touch the seam toward neighbour i.
export const edgeTilesInto = i =>
  Hex.ring([0, 0], RINGS).filter(t =>
    Hex.neighbors(t).some(n => Hex.length(n) === SEAM_RING && isSeamHex(n) && seamLobesOf(n).includes(i))
  )

// Interior border tile at the centre of edge i — where entering from the
// parent lands you. Argmin of off-axis offset along the neighbour direction
// (unit scale; the same math the renderer uses, pure).
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

// ── the sim instance ─────────────────────────────────
export function createSim() {
  const homeOutside = makeTile()
  const homeInside = childAt(homeOutside, "0,0")
  homeInside.discovered.add("0,0") // the home (base) centre starts known; the rest is fog

  let energy = ENERGY_START // shared across levels; spent going out, refills only by resting home
  let day = 1 // current day/expedition; energy spent = minutes past 06:00
  let log = [] // this day's actions in order (replay re-applies them); banked + reset on sleep
  const history = [] // past days: { day, actions, start } (for future day-navigation)
  let todayDiscovered = [] // {tile, key, seam?} first discovered TODAY — replay re-fogs these (display-only)
  let todayReached = [] // {tile, i} edges first reached TODAY — same journal for the edge ratchet
  let replaying = false // suppresses logging + day-boundary side effects while a replay re-applies
  let dayStart = null // snapshot of where/how this day began (set at init and on every sleep)

  // Every frame has the same shape (base frames included).
  const frame = (tile, hexKey, o) => ({
    tile,
    key: hexKey, // hex key inside the parent tile (null for the root)
    isBase: false,
    origin: null, // the parent-grid hex this tile lives in ("in [..]")
    entry: [0, 0],
    player: [0, 0],
    trail: [[0, 0]],
    cost: 0,
    ...o
  })

  const stack = [
    frame(homeOutside, null, { cost: COST_HOME }),
    frame(homeInside, "0,0", { isBase: true, cost: COST_HOME / SCALE_RATIO })
  ]

  const view = () => stack[stack.length - 1]
  const depth = () => stack.length - 1
  const parity = () => depth() % 2
  const parentOf = () => stack[depth() - 1]

  // ── space: what a hex IS in the current view frame ──
  // 'in' my board · 'seam' the shared in-between row · 'nbr' a neighbour's
  // board (stepping there crosses) · null nothing (sealed directions are
  // still seam — walls only block REACHING them from this side).
  function kindOf(h) {
    if (Hex.length(h) <= RINGS) return "in"
    if (depth() <= BASE_DEPTH) return null // no seam at the base — crossing up there is locked
    if (Hex.length(h) > VIEW_RING) return null
    const owner = superIndexOf(h[0], h[1])
    if (owner >= 0) {
      const t = exitTarget(owner)
      return inBounds(t[0], t[1]) ? "nbr" : null // boards off the parent grid don't exist
    }
    return isSeamHex(h) ? "seam" : null
  }

  const lobeOf = h => superIndexOf(h[0], h[1])
  const siblingLocal = (h, i) => [h[0] - SUPER[i][0], h[1] - SUPER[i][1]]
  // The sibling's world node (read-only lookup — undefined until first touched).
  const siblingNodeOf = i => parentOf().tile.children[key(exitTarget(i))]

  // Seam tiles are shared world state: keyed by GLOBAL child-scale coords on
  // the parent node, so both boards of an edge read the same tile. Global =
  // parent position expressed in neighbour offsets + the local hex.
  function seamKey(h) {
    const t = SUPER_TO_PARENT_DIR[parity()]
    const b0 = SUPER[t.indexOf(0)] // parent DIR {1,0} at child scale
    const b1 = SUPER[t.indexOf(5)] // parent DIR {0,1} at child scale
    const p = parentOf().player
    return key([p[0] * b0[0] + p[1] * b1[0] + h[0], p[0] * b0[1] + p[1] * b1[1] + h[1]])
  }

  // ── discovery journals (the ratchet never shrinks; the journal is what
  //    replay may re-fog, display-only) ────────────────
  function journalDiscover(tile, k) {
    if (tile.discovered.has(k)) return
    if (!todayDiscovered.some(d => !d.seam && d.tile === tile && d.key === k)) todayDiscovered.push({ tile, key: k })
    tile.discovered.add(k)
  }
  function journalSeam(tile, gk) {
    if (tile.seamDiscovered.has(gk)) return
    if (!todayDiscovered.some(d => d.seam && d.tile === tile && d.key === gk))
      todayDiscovered.push({ tile, key: gk, seam: true })
    tile.seamDiscovered.add(gk)
  }
  function journalReach(tile, i) {
    if (tile.reachedEdges.has(i)) return
    if (!todayReached.some(r => r.tile === tile && r.i === i)) todayReached.push({ tile, i })
    tile.reachedEdges.add(i)
  }

  // ── discovery lookups (kind-aware) ──────────────────
  const isDiscovered = h => {
    const kind = kindOf(h)
    if (kind === "in") return view().tile.discovered.has(key(h))
    if (kind === "seam") return parentOf().tile.seamDiscovered.has(seamKey(h))
    if (kind === "nbr") {
      const i = lobeOf(h)
      const sib = siblingNodeOf(i)
      return !!sib && sib.discovered.has(key(siblingLocal(h, i)))
    }
    return false
  }

  // ── the walk graph ──────────────────────────────────
  // Interior-only neighbours with the base gate rule (any frame — the parent
  // frame uses this for exitReturn).
  function pathNeighbors(h, vw = view()) {
    const gate = [DIRS[GATE_DIR].q, DIRS[GATE_DIR].r]
    if (vw.isBase && eq(h, [0, 0])) {
      return inBounds(gate[0], gate[1]) ? [gate] : []
    }
    return DIRS.map(d => [h[0] + d.q, h[1] + d.r]).filter(([q, r]) => {
      if (!inBounds(q, r)) return false
      if (vw.isBase && eq([q, r], [0, 0])) return eq(h, gate) // only the gate links to the home centre
      return true
    })
  }

  // My board's wall check for stepping between an interior tile and seam hex s:
  // a side seam is blocked when its lobe is sealed; a junction (doorpost) is
  // passable when at least one of its two lobes is open.
  function wallBlocks(s) {
    if (!view().tile.walls || Hex.length(s) !== SEAM_RING) return false
    const mine = seamLobesOf(s)
    if (!mine.length) return false
    return mine.every(i => walled(i))
  }

  // The crossing wall check: entering board i across seam hex s is blocked by
  // THEIR walls when the (side) seam's direction is sealed on their node.
  function nbrWallBlocks(s, i) {
    const sib = siblingNodeOf(i)
    if (!sib || !sib.walls) return false
    const local = siblingLocal(s, i)
    const lobes = seamLobesOf(local) // seam lobes in THEIR frame
    if (Hex.length(local) !== SEAM_RING || lobes.length !== 1) return false // junctions round the doorpost
    return sib.walls.has(SUPER_TO_PARENT_DIR[parity()][lobes[0]])
  }

  // Neighbours the player can actually step between in the live view:
  // interiors (gate rule), the seam (wall rules), and — as terminal crossing
  // targets — neighbour tiles adjacent to the seam.
  function walkNeighbors(h) {
    const kh = kindOf(h)
    const out = []
    for (const d of DIRS) {
      const n = [h[0] + d.q, h[1] + d.r]
      const kn = kindOf(n)
      if (!kn) continue
      if (kh === "in" && kn === "in") {
        if (!pathNeighbors(h).some(x => eq(x, n))) continue // base gate rule
      } else if ((kh === "in" && kn === "seam") || (kh === "seam" && kn === "in")) {
        const s = kn === "seam" ? n : h
        if (wallBlocks(s)) continue // my walls sit between interior and seam
      } else if (kn === "nbr") {
        if (kh !== "seam") continue // boards never touch — crossings step off the seam
        if (nbrWallBlocks(h, lobeOf(n))) continue // their walls block sealed entries
      } else if (kh === "nbr") {
        continue // crossing targets are terminal — never step FROM them in this frame
      }
      out.push(n)
    }
    return out
  }

  // Frontier = the player's OWN undiscovered walkable neighbours.
  const isFrontier = h => !isDiscovered(h) && !!kindOf(h) && walkNeighbors(view().player).some(n => eq(n, h))

  // Shortest route start→goal over DISCOVERED ground, with a single allowed
  // final hop onto an undiscovered goal. Neighbour tiles are always terminal
  // (stepping there crosses), so routes never pass through them.
  function bfsPathDisc(start, goal, vw = view()) {
    if (eq(start, goal)) return [start]
    const live = vw === view()
    const nbrs = live ? walkNeighbors : h => pathNeighbors(h, vw)
    const disc = live ? isDiscovered : h => vw.tile.discovered.has(key(h))
    const prev = new Map()
    const unwind = cur => {
      const path = []
      let c = cur
      while (c) {
        path.unshift(c)
        c = prev.get(key(c)) || null
      }
      return path
    }
    const seen = new Set([key(start)])
    const queue = [start]
    while (queue.length) {
      const cur = queue.shift()
      for (const n of nbrs(cur)) {
        const k = key(n)
        if (seen.has(k)) continue
        if (eq(n, goal)) return [...unwind(cur), n]
        if (!disc(n)) continue // can't traverse unexplored (non-goal) tiles
        if (live && kindOf(n) === "nbr") continue // crossings are endpoints, not corridors
        seen.add(k)
        prev.set(k, cur)
        queue.push(n)
      }
    }
    return null
  }

  // Step distances from a hex over the discovered walk graph (frontier hexes
  // get a distance but aren't expanded past).
  function bfsDistances(start) {
    const dist = new Map([[key(start), 0]])
    const queue = [start]
    while (queue.length) {
      const cur = queue.shift()
      const d = dist.get(key(cur))
      for (const n of walkNeighbors(cur)) {
        if (dist.has(key(n))) continue
        dist.set(key(n), d + 1)
        if (isDiscovered(n) && kindOf(n) !== "nbr") queue.push(n)
      }
    }
    return dist
  }

  const routeTo = target => bfsPathDisc(view().player, target)

  // ── costs ────────────────────────────────────────────
  // Base rates at this level's scale; per-hex costs multiply in the target's
  // tile type (interiors from the owning board, seam tiles from the parent).
  const stepCost = () => view().cost * MOVE_FRACTION // move onto a known tile
  const scoutCost = () => view().cost * SCOUT_FRACTION // reveal an adjacent tile, staying put
  const typeOf = h => {
    const kind = kindOf(h)
    if (kind === "seam") return TILE_TYPES[parentOf().tile.seamTypes[seamKey(h)] || "plain"]
    if (kind === "nbr") {
      const i = lobeOf(h)
      const sib = siblingNodeOf(i)
      return TILE_TYPES[(sib && sib.types[key(siblingLocal(h, i))]) || "plain"]
    }
    return TILE_TYPES[view().tile.types[key(h)] || "plain"]
  }
  const stepCostAt = h => stepCost() * typeOf(h).move
  const scoutCostAt = h => scoutCost() * typeOf(h).scout
  // The safe umbrella covers the home INTERIOR only — the seam sits outside
  // the walls, so steps/scouts targeting seam or neighbour hexes charge even
  // while based at home (the step leaves the sanctuary).
  const freeAt = h => view().tile.safe && kindOf(h) === "in"
  const stepChargeAt = h => (freeAt(h) ? 0 : stepCostAt(h))
  const scoutChargeAt = h => (freeAt(h) ? 0 : scoutCostAt(h))
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
  const exitCost = () => (depth() > BASE_DEPTH ? parentOf().cost * MOVE_FRACTION : 0)

  // Topology of the current level's edges.
  const superToParentDir = i => SUPER_TO_PARENT_DIR[parity()][i]
  const walled = i => !!view().tile.walls && view().tile.walls.has(superToParentDir(i))
  function exitTarget(i) {
    const d = DIRS[superToParentDir(i)]
    const pp = parentOf().player
    return [pp[0] + d.q, pp[1] + d.r]
  }
  // The neighbour direction (super index) facing a given parent-DIR vector.
  function superForParentDir(d) {
    for (let i = 0; i < 6; i++) {
      const pd = DIRS[SUPER_TO_PARENT_DIR[parity()][i]]
      if (pd.q === d.q && pd.r === d.r) return i
    }
    return -1
  }

  // Shortest hop count from `pos` to the nearest way OUT of this level: any
  // DISCOVERED seam hex (standing there, the neighbours are one step away),
  // or the entry itself at the home base.
  function stepsToExit(pos) {
    const v = view()
    if (v.isBase) {
      const path = bfsPathDisc(pos, v.entry)
      return path ? path.length - 1 : 0
    }
    if (kindOf(pos) === "seam" && isDiscovered(pos)) return 0
    const dist = bfsDistances(pos)
    let best = Infinity
    for (const [k, d] of dist) {
      const h = k.split(",").map(Number)
      if (kindOf(h) === "seam" && isDiscovered(h) && d < best) best = d
    }
    if (best < Infinity) return best
    const path = bfsPathDisc(pos, v.entry)
    return path ? path.length - 1 : 0
  }

  // Shortest time home from `pos`: this level's steps to the nearest exit plus
  // each parent level's committed trail, all at the move rate, plus a
  // parent-scale move per climb-out. Recomputed live.
  function returnFrom(pos) {
    let c = 0
    for (let i = 0; i < stack.length; i++) {
      const lv = stack[i]
      const steps = i === stack.length - 1 ? stepsToExit(pos) : lv.trail.length - 1
      c += steps * (lv.cost * MOVE_FRACTION)
      if (i > BASE_DEPTH) c += stack[i - 1].cost * MOVE_FRACTION
    }
    return c
  }
  // Inside our own safe space (the interior — not the seam) the energy
  // constraint is lifted: no reserve.
  const returnCost = () => (freeAt(view().player) ? 0 : returnFrom(view().player))

  // Shortest way home once we've landed on parent tile t (used by canExit).
  function exitReturn(t) {
    const parent = parentOf()
    const path = bfsPathDisc(t, parent.entry, parent)
    let c = (path ? path.length - 1 : 0) * (parent.cost * MOVE_FRACTION)
    for (let i = 0; i < depth() - 1; i++) c += (stack[i].trail.length - 1) * (stack[i].cost * MOVE_FRACTION)
    return c
  }

  // ── affordability / validity ─────────────────────────
  // Reserve needed to get home AFTER crossing into board i: the updated parent
  // trail, the climb back out, plus every level below — the landing tile sits
  // ONE step from the seam (the step back onto it).
  function crossReturn(i) {
    const t = exitTarget(i)
    const landing = parentOf().tile.children[key(t)]
    if (landing && landing.safe) return 0 // crossing home: no reserve inside the safe space
    const L = stack.length - 1
    let c = 0
    for (let j = 0; j <= L; j++) {
      const lv = stack[j]
      let steps
      if (j === L) steps = 1 // back onto the seam from the landing tile
      else if (j === L - 1) {
        const tr = lv.trail
        const retraces = tr.length >= 2 && eq(t, tr[tr.length - 2])
        steps = (retraces ? tr.length - 1 : tr.length + 1) - 1
      } else steps = lv.trail.length - 1
      c += steps * (lv.cost * MOVE_FRACTION)
      if (j > BASE_DEPTH) c += stack[j - 1].cost * MOVE_FRACTION
    }
    return c
  }

  function canMove(target) {
    const kind = kindOf(target)
    if (!kind || !isDiscovered(target)) return false
    const path = bfsPathDisc(view().player, target)
    if (!path) return false
    if (kind === "nbr") {
      // crossing: what the walk actually charges plus the way home from the OTHER side
      return pathCharge(path) + crossReturn(lobeOf(target)) <= energy
    }
    // free interior steps charge 0, so pure safe-interior moves stay unconditional;
    // the reserve applies once the destination is outside the umbrella
    const reserve = freeAt(target) ? 0 : returnFrom(target)
    return pathCharge(path) + reserve <= energy
  }

  const canScout = target => isFrontier(target) && scoutChargeAt(target) + returnCost() <= energy

  // Reserve needed to get home AFTER entering the tile under the player: every
  // level's committed trail plus the climb back out of the new level. Entering
  // is free, but it must not push the reserve past the remaining energy.
  function enterReturn() {
    const child = view().tile.children[key(view().player)]
    if (child && child.safe) return 0 // entering a safe space: no reserve inside
    let c = 0
    for (let j = 0; j < stack.length; j++) {
      c += (stack[j].trail.length - 1) * (stack[j].cost * MOVE_FRACTION)
      if (j > BASE_DEPTH) c += stack[j - 1].cost * MOVE_FRACTION
    }
    c += view().cost * MOVE_FRACTION // climbing back out of the tile we enter
    return c
  }

  const canEnter = () => depth() < MAX_DEPTH && !eq(view().player, view().entry) && enterReturn() <= energy

  function canExit(i) {
    if (i < 0 || depth() <= BASE_DEPTH || walled(i)) return false
    if (!playerExits().has(i)) return false // must stand at the edge
    const t = exitTarget(i)
    if (!inBounds(t[0], t[1])) return false
    if (!parentOf().tile.discovered.has(key(t))) return false // unknown up top
    // the exit is a parent-scale step — it must be a LEGAL parent step (this is
    // what keeps the base gate rule: the home centre connects only via the gate)
    if (!pathNeighbors(parentOf().player, parentOf()).some(n => eq(n, t))) return false
    return exitCost() + exitReturn(t) <= energy
  }

  // The neighbour directions whose seam the player is standing against:
  // side-seam lobes of adjacent seam hexes, walls respected.
  function playerExits() {
    const set = new Set()
    if (depth() <= BASE_DEPTH) return set
    for (const n of walkNeighbors(view().player)) {
      if (kindOf(n) !== "seam" || Hex.length(n) !== SEAM_RING) continue
      const lobes = seamLobesOf(n)
      if (lobes.length === 1 && !walled(lobes[0])) set.add(lobes[0])
    }
    return set
  }

  // Undiscovered tiles adjacent to WHERE YOU SIT that you can afford to scout —
  // seam and neighbour tiles included (the crossing options show like any frontier).
  function reachableDots() {
    const dots = new Set()
    for (const n of walkNeighbors(view().player)) {
      if (!isDiscovered(n) && canScout(n)) dots.add(key(n))
    }
    return dots
  }

  // Index of `h` on the committed trail (excluding the player's own end), or -1.
  // Hovering a trail tile means RETRACING — the in-between path is invalidated.
  function trailIndexOf(h) {
    const tr = view().trail
    for (let i = 0; i < tr.length - 1; i++) if (eq(tr[i], h)) return i
    return -1
  }

  // The retrace back along the trail to `h` (player → … → h), or null when `h`
  // isn't on the trail or the walk back isn't affordable.
  function retraceRoute(h) {
    const ti = trailIndexOf(h)
    if (ti < 0) return null
    const rp = view().trail.slice(ti).reverse()
    return view().tile.safe || pathCost(rp) + returnFrom(h) <= energy ? rp : null
  }

  // A caller-supplied route (a trail retrace) is valid when it starts at the
  // player, steps only between walkable neighbours over discovered ground, and
  // leaves the reserve intact — replay re-validates it like a live click.
  function viaValid(via, target) {
    if (!Array.isArray(via) || via.length < 2) return false
    if (!eq(via[0], view().player) || !eq(via[via.length - 1], target)) return false
    for (let i = 1; i < via.length; i++) {
      if (kindOf(via[i]) === "nbr") return false // retraces never cross
      if (!isDiscovered(via[i])) return false
      if (!walkNeighbors(via[i - 1]).some(n => eq(n, via[i]))) return false
    }
    return view().tile.safe || pathCost(via) + returnFrom(target) <= energy
  }

  // ── mutations (internal — only apply/dispatch reach these) ──────
  function stepOnto(step) {
    const v = view()
    if (v.trail.length >= 2 && eq(step, v.trail[v.trail.length - 2])) v.trail.pop()
    else v.trail.push(step)
    energy -= stepChargeAt(step) // 0 inside the safe interior
    v.player = step
    markReachedEdges()
  }

  // Standing beside the seam reaches those edges — a permanent ratchet.
  function markReachedEdges() {
    const v = view()
    if (depth() <= BASE_DEPTH) return
    const [pq, pr] = v.player
    for (const d of DIRS) {
      const n = [pq + d.q, pr + d.r]
      if (Hex.length(n) === SEAM_RING && isSeamHex(n)) {
        const lobes = seamLobesOf(n)
        if (lobes.length === 1) journalReach(v.tile, lobes[0])
      }
    }
  }

  // Arriving at this level's entry clears the trail; at the home base it rests.
  function restIfHome() {
    const v = view()
    if (eq(v.player, v.entry)) {
      v.trail = [v.entry.slice()]
      if (v.isBase) energy = ENERGY_START
    }
  }

  // Rest — a deliberate action at the centre special tile (never automatic, so
  // you can move across the board freely): refill, bank the day, start the next.
  function doRest() {
    const v = view()
    energy = ENERGY_START
    v.trail = [[0, 0]]
    sleep()
  }

  // Scout: reveal an adjacent undiscovered tile without moving. Seam tiles are
  // revealed on the parent (shared by both boards); neighbour tiles in the
  // sibling that owns them — same action, same rates.
  function doScout(target) {
    const v = view()
    energy -= scoutChargeAt(target) // 0 for interior targets inside the safe space
    const kind = kindOf(target)
    if (kind === "seam") {
      journalSeam(parentOf().tile, seamKey(target))
    } else if (kind === "nbr") {
      const i = lobeOf(target)
      const sib = childAt(parentOf().tile, key(exitTarget(i)))
      journalDiscover(sib, key(siblingLocal(target, i)))
    } else {
      journalDiscover(v.tile, key(target))
    }
  }

  // CROSS into the board that owns hex `h`: one ordinary step off the seam that
  // lands on that exact tile on the other side — the boards just slide. At the
  // parent scale this IS a step onto the sibling's parent tile, so the parent
  // trail extends/retraces and the tile becomes discovered up top — but the
  // cost is the plain local step.
  function doCross(h) {
    const i = lobeOf(h)
    const t = exitTarget(i)
    const parent = parentOf()
    const from = view().player // the seam hex we step off — same tile, new frame coords
    energy -= stepChargeAt(h) // never free — the step leaves the safe umbrella
    journalDiscover(parent.tile, key(t)) // stepping into it discovers it at the parent scale
    if (parent.trail.length >= 2 && eq(t, parent.trail[parent.trail.length - 2])) parent.trail.pop()
    else parent.trail.push(t)
    parent.player = t
    const local = siblingLocal(h, i)
    const fromLocal = siblingLocal(from, i)
    const sib = childAt(parent.tile, key(t))
    const top = view()
    top.tile = sib
    top.key = key(t)
    top.origin = t.slice()
    top.entry = local.slice()
    top.player = local.slice()
    // the trail carries through the crossing: it anchors on the seam hex we
    // came through (just that one — the rest of the old board's trail stays
    // behind), so the committed line visibly enters through the seam
    top.trail = [fromLocal, local.slice()]
    journalDiscover(sib, key(local))
    markReachedEdges()
  }

  // EXIT up one scale onto the (already discovered) parent tile — a parent-
  // scale move; extends or retraces the parent trail. (UI keeps go-up hidden
  // until the parent view is earned; kept sane for replay/future.)
  function doBack(i) {
    if (depth() <= BASE_DEPTH) return
    const t = exitTarget(i) // compute before popping (uses the child parity)
    stack.pop()
    const v = view()
    if (v.trail.length >= 2 && eq(t, v.trail[v.trail.length - 2])) v.trail.pop()
    else v.trail.push(t)
    energy -= v.cost * MOVE_FRACTION
    v.player = t
  }

  // Descend into the tile under the player, landing on the border tile at the
  // centre of the edge facing where we came from. (Not reachable in normal
  // play while the game lives at MAX_DEPTH — kept sane for the future.)
  function doEnter(from) {
    const v = view()
    const A = from || (v.trail.length >= 2 ? v.trail[v.trail.length - 2] : v.entry)
    const dirAP = { q: A[0] - v.player[0], r: A[1] - v.player[1] }
    const child = childAt(v.tile, key(v.player))
    // energy carries; only the per-step cost drops at the finer scale
    stack.push(frame(child, key(v.player), { origin: v.player.slice(), cost: v.cost / SCALE_RATIO }))
    const cv = view()
    let i = superForParentDir(dirAP) // child parity — we just pushed
    if (i < 0) i = 0
    const center = EDGE_CENTER[parity()][i]
    journalReach(cv.tile, i) // we're standing at this edge — it's reached
    cv.entry = center.slice()
    cv.player = center.slice()
    cv.trail = [center.slice()]
    journalDiscover(cv.tile, key(center))
    markReachedEdges()
  }

  // Our own safe space: land on the centre special tile, discover freely
  // (no energy cost, no reserve), walled off except the gate.
  function doEnterHome() {
    const v = view()
    const child = childAt(v.tile, key(v.player))
    child.discovered.add(key([0, 0])) // the centre special tile starts known (pre-day; not journaled)
    child.safe = true
    if (!child.walls) child.walls = new Set([0, 1, 2, 3, 4, 5].filter(j => j !== GATE_DIR))
    stack.push(
      frame(child, key(v.player), {
        origin: v.player.slice(),
        cost: v.cost / SCALE_RATIO,
        entry: [0, 0],
        player: [0, 0],
        trail: [[0, 0]]
      })
    )
  }

  // Sleep: bank the day's actions (with the day-start snapshot they replay
  // from), advance the day, snapshot the new day's start.
  function sleep() {
    if (log.length) history.push({ day, actions: log, start: dayStart })
    day++
    log = []
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
      origin: f.origin && f.origin.slice(),
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
          origin: fs.origin && fs.origin.slice(),
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
    restore(dayStart)
  }
  function endReplay() {
    for (const d of todayDiscovered) (d.seam ? d.tile.seamDiscovered : d.tile.discovered).add(d.key) // permanent — restore in full
    for (const r of todayReached) r.tile.reachedEdges.add(r.i)
    replaying = false
  }

  // ── actions ──────────────────────────────────────────
  const ACTIONS = {
    move: {
      can: a => (a.via ? viaValid(a.via, a.target) : canMove(a.target)),
      run: a => {
        const path = a.via || routeTo(a.target)
        const crossing = kindOf(path[path.length - 1]) === "nbr"
        for (let i = 1; i < path.length - (crossing ? 1 : 0); i++) stepOnto(path[i])
        if (crossing) doCross(path[path.length - 1]) // the last step lands on the other side
        else restIfHome()
      }
    },
    scout: { can: a => canScout(a.target), run: a => doScout(a.target) },
    enter: { can: () => canEnter(), run: () => doEnter(null) },
    enterHome: {
      can: () => view().isBase && eq(view().player, view().entry),
      run: () => doEnterHome()
    },
    exit: { can: a => canExit(a.superIdx), run: a => doBack(a.superIdx) },
    rest: {
      can: () => view().tile.safe && eq(view().player, [0, 0]),
      run: () => doRest()
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

  // Day-boundary actions end/reset the log themselves; everything else is recorded.
  const LOGGED = new Set(["move", "scout", "enter", "enterHome", "exit"])

  // Validate + log + mutate — the one door live play goes through. The entry
  // is pushed BEFORE running so a day-ending move banks itself with its day.
  function dispatch(action) {
    if (replaying) return { ok: false, reason: "replaying" }
    const h = ACTIONS[action.type]
    if (!h) return { ok: false, reason: "unknown action " + action.type }
    if (!h.can(action)) return { ok: false, reason: action.type + " rejected" }
    if (LOGGED.has(action.type)) log.push(action)
    h.run(action)
    return { ok: true }
  }

  // The game opens inside the home safe space (the default view), and the
  // first day starts there.
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
    log: () => log,
    history: () => history,
    replaying: () => replaying,
    orient: () => orientOf(depth()),
    // rules queries
    kindOf,
    isDiscovered,
    isFrontier,
    canMove,
    canScout,
    canEnter,
    canExit,
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
    exitCost,
    exitTarget,
    playerExits,
    walled,
    reachableDots,
    // actions
    dispatch,
    apply,
    beginReplay,
    endReplay
  }
}
