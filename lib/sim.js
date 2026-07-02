// The game, pure and headless.
//
// Everything anon&mato IS lives here: the world tree, the view stack, energy,
// costs, discovery, the action log, day snapshots. No canvas, no DOM, no
// timers — this module runs in plain node (the tests do). Rendering and input
// live in render.js/grid.js and only ever call queries + dispatch.
//
// The action log is the design's centre of gravity: a day is a list of
// actions re-applied onto the day-start snapshot (the sim is deterministic).
// Live play, replay and future day-editing all flow through the same
// dispatch/apply pair — there is no second code path.

import { DIRS, makeTile, childAt } from "./world.js"
import * as Hex from "./hex.js"

// ── tunables (the design is still settling — expect these to move) ──
export const RINGS = 4 // radius-4 hexagon = 61 tiles
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

// Orientation alternates by depth; only the parity matters for topology.
export const orientOf = depth => (depth % 2 === 0 ? Hex.POINTY : Hex.FLAT)

// ── static topology (pure, shared by every grid) ─────
export const inBounds = (q, r) => Hex.length([q, r]) <= RINGS

// Super-lattice offsets (small-hex axial): where the 6 neighbouring
// radius-RINGS grids tile around this one (rotating (2N+1, -N) in 60° steps).
export const SUPER = (() => {
  const out = []
  let q = 2 * RINGS + 1
  let r = -RINGS
  for (let i = 0; i < 6; i++) {
    out.push([q, r])
    const nq = -r
    const nr = q + r
    q = nq
    r = nr
  }
  return out
})()

// Which neighbouring grid (0..5) an off-map hex belongs to, or -1.
export function superIndexOf(q, r) {
  for (let i = 0; i < 6; i++) {
    if (Hex.length([q - SUPER[i][0], r - SUPER[i][1]]) <= RINGS) return i
  }
  return -1
}

// Boundary edges of the grid: {q, r, dir} where the neighbour is off-map.
export const boundaryEdges = (() => {
  const out = []
  for (const [q, r] of Hex.range(RINGS)) {
    for (let d = 0; d < 6; d++) {
      if (!inBounds(q + DIRS[d].q, r + DIRS[d].r)) out.push({ q, r, dir: d })
    }
  }
  return out
})()

// Interior border tiles whose off-map edge faces super-tile i.
export const edgeTilesInto = i =>
  boundaryEdges.filter(e => superIndexOf(e.q + DIRS[e.dir].q, e.r + DIRS[e.dir].r) === i).map(e => [e.q, e.r])

// Super index i → parent DIR index, per child-depth parity. The edge tiles
// obey the parent grid, so the mapping matches each super-lattice direction to
// the parent DIR at the same screen angle. This is a CONSTANT of the two
// orientations — computed once here from the shared matrices (it used to be
// re-derived per call from mutable render state).
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

// Interior border tile at the centre of edge i — where you stand when parked.
// Argmin of off-axis offset along the snapped edge direction (the same math
// the renderer uses for placement, at unit scale — pure, no viewport).
export const EDGE_CENTER = [0, 1].map(parity => {
  const o = orientOf(parity)
  return SUPER.map((s, i) => {
    const deg = (Hex.screenAngle(o, s[0], s[1]) * 180) / Math.PI
    const snap = -o.startDeg
    const clean = ((Math.round((deg - snap) / 60) * 60 + snap) * Math.PI) / 180
    const dirx = Math.cos(clean)
    const diry = Math.sin(clean)
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
  let todayDiscovered = [] // {tile, key} first discovered TODAY — replay re-fogs these (display-only)
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
    parked: -1, // edge index we're parked on, or -1
    fromEdge: -1, // the edge this level's trail returns to (kept after stepping in)
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

  // ── discovery journals (the ratchet never shrinks; the journal is what
  //    replay may re-fog, display-only) ────────────────
  function journalDiscover(tile, k) {
    if (tile.discovered.has(k)) return
    if (!todayDiscovered.some(d => d.tile === tile && d.key === k)) todayDiscovered.push({ tile, key: k })
    tile.discovered.add(k)
  }
  function journalReach(tile, i) {
    if (tile.reachedEdges.has(i)) return
    if (!todayReached.some(r => r.tile === tile && r.i === i)) todayReached.push({ tile, i })
    tile.reachedEdges.add(i)
  }

  // ── routing ──────────────────────────────────────────
  const isDiscovered = h => view().tile.discovered.has(key(h))
  // Frontier = the player's OWN undiscovered neighbours (your immediate explore options).
  const isFrontier = h => !isDiscovered(h) && pathNeighbors(view().player).some(n => eq(n, h))

  // Neighbours for routing. The base home centre connects only to the gate tile.
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

  // Shortest route start→goal over DISCOVERED tiles, with a single allowed
  // final hop onto an undiscovered goal (a frontier tile).
  function bfsPathDisc(start, goal, vw = view()) {
    if (eq(start, goal)) return [start]
    const prev = new Map()
    const seen = new Set([key(start)])
    const queue = [start]
    while (queue.length) {
      const cur = queue.shift()
      for (const n of pathNeighbors(cur, vw)) {
        const k = key(n)
        if (seen.has(k)) continue
        if (eq(n, goal)) {
          const path = [n]
          let c = cur
          while (c) {
            path.unshift(c)
            c = prev.get(key(c)) || null
          }
          return path
        }
        if (!vw.tile.discovered.has(k)) continue // can't traverse unexplored (non-goal) tiles
        seen.add(k)
        prev.set(k, cur)
        queue.push(n)
      }
    }
    return null
  }

  // Gate-aware step distance from a hex to all reachable tiles (expands only
  // through discovered tiles; frontier tiles get a distance but aren't expanded).
  function bfsDistances(start) {
    const dist = new Map([[key(start), 0]])
    const queue = [start]
    while (queue.length) {
      const cur = queue.shift()
      const d = dist.get(key(cur))
      for (const n of pathNeighbors(cur)) {
        if (dist.has(key(n))) continue
        dist.set(key(n), d + 1)
        if (isDiscovered(n)) queue.push(n)
      }
    }
    return dist
  }

  const routeTo = target => bfsPathDisc(view().player, target)

  // ── costs ────────────────────────────────────────────
  const stepCost = () => view().cost * MOVE_FRACTION // move onto a known tile
  const scoutCost = () => view().cost * SCOUT_FRACTION // reveal an adjacent tile, staying put
  const pathCost = path => (path.length - 1) * stepCost() // routes run over known ground
  const discoverEdgeCost = () => (depth() > BASE_DEPTH ? parentOf().cost * SCOUT_FRACTION : 0)
  const exitCost = () => (depth() > BASE_DEPTH ? parentOf().cost * MOVE_FRACTION : 0)

  // Topology of the current level's edges.
  const superToParentDir = i => SUPER_TO_PARENT_DIR[parity()][i]
  const walled = i => !!view().tile.walls && view().tile.walls.has(superToParentDir(i))
  function exitTarget(i) {
    const d = DIRS[superToParentDir(i)]
    const pp = parentOf().player
    return [pp[0] + d.q, pp[1] + d.r]
  }
  // The edge tile (super index) facing a given parent-DIR vector.
  function superForParentDir(d) {
    for (let i = 0; i < 6; i++) {
      const pd = DIRS[SUPER_TO_PARENT_DIR[parity()][i]]
      if (pd.q === d.q && pd.r === d.r) return i
    }
    return -1
  }

  // Shortest hop count from `pos` to the nearest way OUT of this level: any
  // border tile facing a reached edge (the entry itself at the home base).
  // Parked on an edge, the player IS at an exit.
  function stepsToExit(pos) {
    const v = view()
    if (v.parked >= 0 && eq(pos, v.player)) return 0
    if (v.isBase) {
      const path = bfsPathDisc(pos, v.entry)
      return path ? path.length - 1 : 0
    }
    const reached = v.tile.reachedEdges
    const dist = bfsDistances(pos)
    let best = Infinity
    for (const k of v.tile.discovered) {
      const [q, r] = k.split(",").map(Number)
      let isExit = false
      for (const d of DIRS) {
        if (inBounds(q + d.q, r + d.r)) continue
        const si = superIndexOf(q + d.q, r + d.r)
        // an edge only counts as a way out if it's reached, unsealed, AND the
        // parent tile behind it is discovered — a reached edge whose parent is
        // still unknown can't actually be exited, so it mustn't shrink the reserve
        if (si >= 0 && reached.has(si) && !walled(si) && parentOf().tile.discovered.has(key(exitTarget(si)))) {
          isExit = true
          break
        }
      }
      if (isExit) {
        const dd = dist.get(k)
        if (dd != null && dd < best) best = dd
      }
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
  // Inside our own safe space the energy constraint is lifted — no reserve.
  const returnCost = () => (view().tile.safe ? 0 : returnFrom(view().player))

  // Shortest way home once we've landed on parent tile t (used by canExit).
  function exitReturn(t) {
    const parent = parentOf()
    const path = bfsPathDisc(t, parent.entry, parent)
    let c = (path ? path.length - 1 : 0) * (parent.cost * MOVE_FRACTION)
    for (let i = 0; i < depth() - 1; i++) c += (stack[i].trail.length - 1) * (stack[i].cost * MOVE_FRACTION)
    return c
  }

  // ── affordability / validity ─────────────────────────
  function canMove(target) {
    if (view().parked >= 0) return false // parked: step in first (or slide)
    if (!isDiscovered(target)) return false
    const path = bfsPathDisc(view().player, target)
    if (!path) return false
    return view().tile.safe || pathCost(path) + returnFrom(target) <= energy
  }

  const canScout = target => isFrontier(target) && (view().tile.safe || scoutCost() + returnCost() <= energy)

  // Parked on an edge: scouting is limited to the tiles touching that edge
  // (and, like everywhere else, must leave the return reserve intact).
  const canScoutParked = target =>
    view().parked >= 0 &&
    !isDiscovered(target) &&
    edgeTilesInto(view().parked).some(t => eq(t, target)) &&
    (view().tile.safe || scoutCost() + returnCost() <= energy)

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

  const canEnter = () =>
    view().parked < 0 && depth() < MAX_DEPTH && !eq(view().player, view().entry) && enterReturn() <= energy

  function canDiscoverEdge(i) {
    if (i < 0 || depth() <= BASE_DEPTH || view().parked >= 0 || walled(i)) return false
    if (!playerExits().has(i)) return false // must be right next to the edge
    const t = exitTarget(i)
    if (!inBounds(t[0], t[1])) return false
    if (parentOf().tile.discovered.has(key(t))) return false
    return discoverEdgeCost() + returnCost() <= energy
  }

  function canExit(i) {
    if (i < 0 || depth() <= BASE_DEPTH || walled(i)) return false
    if (view().parked !== i && !playerExits().has(i)) return false // must stand at (or be parked on) the edge
    const t = exitTarget(i)
    if (!inBounds(t[0], t[1])) return false
    if (!parentOf().tile.discovered.has(key(t))) return false // unknown → discover, not exit
    // the exit is a parent-scale step — it must be a LEGAL parent step (this is
    // what keeps the base gate rule: the home centre connects only via the gate)
    if (!pathNeighbors(parentOf().player, parentOf()).some(n => eq(n, t))) return false
    return exitCost() + exitReturn(t) <= energy
  }

  // Reserve needed to get home AFTER sliding across edge i — i.e. from parked
  // in the neighbour: the updated parent trail, the climb back out of the
  // neighbour, plus every level below. canExit alone under-counts this by the
  // climb-out, which used to let a slide strand you (found by the fuzz tests).
  function slideReturn(i) {
    const t = exitTarget(i)
    const landing = parentOf().tile.children[key(t)]
    if (landing && landing.safe) return 0 // sliding home: no reserve inside the safe space
    const L = stack.length - 1
    let c = 0
    for (let j = 0; j <= L; j++) {
      const lv = stack[j]
      let steps
      if (j === L) steps = 0 // we land parked ON the shared edge — already at an exit
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

  const canSlide = i => i >= 0 && view().parked === i && canExit(i) && exitCost() + slideReturn(i) <= energy

  // The neighbours the player can step out into: only on a border tile, and
  // only the neighbour(s) its open (off-map) edges face.
  function playerExits() {
    const set = new Set()
    if (depth() <= BASE_DEPTH) return set
    const [pq, pr] = view().player
    for (const d of DIRS) {
      const nq = pq + d.q
      const nr = pr + d.r
      if (!inBounds(nq, nr)) {
        const i = superIndexOf(nq, nr)
        if (i >= 0 && !walled(i)) set.add(i)
      }
    }
    return set
  }

  const reachedExits = () => view().tile.reachedEdges

  // Undiscovered tiles adjacent to WHERE YOU SIT that you can afford to scout.
  function reachableDots() {
    const dots = new Set()
    for (const n of pathNeighbors(view().player)) {
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
  // player, steps only between neighbours over discovered ground, and leaves
  // the reserve intact — replay re-validates it just like a live click.
  function viaValid(via, target) {
    if (view().parked >= 0) return false // parked: step in first, like any move
    if (!Array.isArray(via) || via.length < 2) return false
    if (!eq(via[0], view().player) || !eq(via[via.length - 1], target)) return false
    for (let i = 1; i < via.length; i++) {
      if (!isDiscovered(via[i])) return false
      if (!pathNeighbors(via[i - 1]).some(n => eq(n, via[i]))) return false
    }
    return view().tile.safe || pathCost(via) + returnFrom(target) <= energy
  }

  // Shortest valid path to a discovered tile bordering edge `si` (from the
  // parked edge or the player's tile), or null. Edges are reachable from
  // anywhere with a clean path — proximity only gates DISCOVERY.
  function bestPathToEdge(si) {
    if (si < 0 || depth() <= BASE_DEPTH || walled(si)) return null
    if (!parentOf().tile.discovered.has(key(exitTarget(si)))) return null // unknown edge
    let best = null
    for (const bt of edgeTilesInto(si)) {
      if (!isDiscovered(bt)) continue
      const path =
        view().parked >= 0 ? parkedRoute(bt) : eq(bt, view().player) ? [bt] : canMove(bt) ? routeTo(bt) : null
      if (path && (!best || path.length < best.length)) best = path
    }
    return best
  }

  // Hover preview while parked: route from the parked edge's best discovered
  // edge-row tile to the target — the way you'd walk after stepping in.
  function parkedRoute(h) {
    if (!isDiscovered(h)) return null
    let best = null
    for (const t of edgeTilesInto(view().parked)) {
      if (!isDiscovered(t)) continue
      const path = bfsPathDisc(t, h)
      if (path && (!best || path.length < best.length)) best = path
    }
    if (!best) return null
    return view().tile.safe || pathCost(best) + returnFrom(h) <= energy ? best : null
  }

  // ── mutations (internal — only apply/dispatch reach these) ──────
  function stepOnto(step) {
    const v = view()
    if (v.trail.length >= 2 && eq(step, v.trail[v.trail.length - 2])) v.trail.pop()
    else v.trail.push(step)
    if (!v.tile.safe) energy -= v.cost * MOVE_FRACTION // free movement inside the safe space
    v.player = step
    markReachedEdges()
  }

  // Standing on a border tile reaches its off-map edges — a permanent ratchet.
  function markReachedEdges() {
    const v = view()
    const [pq, pr] = v.player
    for (const d of DIRS) {
      if (!inBounds(pq + d.q, pr + d.r)) {
        const i = superIndexOf(pq + d.q, pr + d.r)
        if (i >= 0) journalReach(v.tile, i)
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
    v.fromEdge = -1 // fresh day anchored at the centre — no stale edge connector
    sleep()
  }

  function doScout(target) {
    const v = view()
    if (!v.tile.safe) energy -= scoutCost() // discovery is free inside the safe space
    journalDiscover(v.tile, key(target))
  }

  // Reveal the parent neighbour an edge tile maps to, without moving.
  function doDiscoverEdge(i) {
    const parent = parentOf()
    const dk = key(exitTarget(i))
    if (parent.tile.discovered.has(dk)) return
    energy -= discoverEdgeCost()
    journalDiscover(parent.tile, dk)
  }

  // EXIT up one scale onto the (already discovered) parent tile the edge maps
  // to — a parent-scale move; extends or retraces the parent trail.
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

  // Descend into the tile under the player, landing PARKED on the edge facing
  // where we came from (`from` is passed by slides — the trail can't tell,
  // a back-slide retraces it).
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
    cv.parked = i
    journalReach(cv.tile, i) // we're standing at this edge — it's reached
    cv.fromEdge = i
    cv.entry = center.slice()
    cv.player = center.slice()
    cv.trail = []
  }

  // Step in off the edge onto a chosen interior tile touching it.
  function stepInAt(tile) {
    const v = view()
    if (v.parked >= 0) v.fromEdge = v.parked // the trail now hangs off this edge
    v.parked = -1
    v.player = tile.slice()
    v.entry = tile.slice()
    v.trail = [tile.slice()]
    journalDiscover(v.tile, key(tile))
    markReachedEdges()
  }

  // Slide to the neighbour across edge i: exit up onto it, then re-enter its
  // board at the same scale — you end parked on the shared edge's other side.
  function boardSwitch(i) {
    const from = parentOf().player.slice() // the tile we're sliding out of (parent coords)
    doBack(i) // pops to the parent, lands on the neighbour (charges the parent move)
    doEnter(from) // arrive parked at the edge we came in through
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
    base.parked = -1
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
      cost: f.cost,
      parked: f.parked,
      fromEdge: f.fromEdge
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
          cost: fs.cost,
          parked: fs.parked,
          fromEdge: fs.fromEdge
        })
      )
    }
  }

  // ── replay (display rewind; the ratchets never shrink for real) ──
  function beginReplay() {
    replaying = true
    for (const d of todayDiscovered) d.tile.discovered.delete(d.key)
    for (const r of todayReached) r.tile.reachedEdges.delete(r.i)
    restore(dayStart)
  }
  function endReplay() {
    for (const d of todayDiscovered) d.tile.discovered.add(d.key) // discovery is permanent — restore in full
    for (const r of todayReached) r.tile.reachedEdges.add(r.i)
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
    scout: {
      can: a => (view().parked >= 0 ? canScoutParked(a.target) : canScout(a.target)),
      run: a => doScout(a.target)
    },
    enter: { can: () => canEnter(), run: () => doEnter(null) },
    enterHome: {
      can: () => view().isBase && eq(view().player, view().entry),
      run: () => doEnterHome()
    },
    exit: { can: a => canExit(a.superIdx), run: a => doBack(a.superIdx) },
    discoverEdge: { can: a => canDiscoverEdge(a.superIdx), run: a => doDiscoverEdge(a.superIdx) },
    stepIn: {
      can: a =>
        view().parked >= 0 && isDiscovered(a.to) && edgeTilesInto(view().parked).some(t => eq(t, a.to)),
      run: a => stepInAt(a.to)
    },
    slide: {
      can: a => canSlide(a.superIdx),
      run: a => boardSwitch(a.superIdx)
    },
    park: {
      can: a =>
        a.superIdx >= 0 &&
        view().parked < 0 &&
        playerExits().has(a.superIdx) &&
        parentOf().tile.discovered.has(key(exitTarget(a.superIdx))),
      run: a => {
        view().parked = a.superIdx
      }
    },
    rest: {
      can: () => view().tile.safe && view().parked < 0 && eq(view().player, [0, 0]),
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
  const LOGGED = new Set(["move", "scout", "enter", "enterHome", "exit", "discoverEdge", "stepIn", "slide", "park"])

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
    isDiscovered,
    isFrontier,
    canMove,
    canScout,
    canEnter,
    canExit,
    canSlide,
    canDiscoverEdge,
    routeTo,
    parkedRoute,
    retraceRoute,
    trailIndexOf,
    bestPathToEdge,
    pathCost,
    stepCost,
    scoutCost,
    returnCost,
    returnFrom,
    discoverEdgeCost,
    exitCost,
    exitTarget,
    edgeCenterOf: i => EDGE_CENTER[parity()][i],
    playerExits,
    reachedExits,
    walled,
    reachableDots,
    // actions
    dispatch,
    apply,
    beginReplay,
    endReplay
  }
}
