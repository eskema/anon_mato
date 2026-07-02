// Hex grid screen.
//
// Renders a radius-4 (61-tile) hexagon as a SINGLE edge mesh: every shared edge
// is drawn once (uniform density, almost invisible), with per-edge hide/color
// control. Individual hexes have no outline — only fills for hover. The gate
// edge (home center → gate tile) is hidden.
//
// You can move to ANY tile: hovering shows the routed path from your current
// position (dashed), and the committed route from the entry to you stays solid.
// Clicking moves there. An "Enter" button below the day descends a level.
//
//   • Home grid: entry is the CENTER; the only exit is the single gate.
//   • Sub-grids: you enter at [2,2], the middle of the lower-right edge.
//
// Orientation FLIPS by depth: home is pointy-top, one level in is flat-top, and
// so on. Entering a tile rotates the world 30° so a tile's interior reads
// consistently when later shown shrunk inside its (opposite-orientation) parent.

import { theme, arrowTip } from "./draw.js"
import { DIRS, makeTile, childAt } from "./world.js"
import { createTimeline } from "./timeline.js"
import { CubeScreen } from "./cube.js"
import * as Hex from "./hex.js"

const SQRT3 = Math.sqrt(3)
const RINGS = 4 // radius-4 hexagon = 61 tiles
const GATE_DIR = 2 // home's single exit (NW; placeholder, later from the chosen angle)
const SUB_ENTRY = [2, 2] // sub-grid arrival: middle of the lower-right edge
const BASE_DEPTH = 1 // we START inside the home tile (depth 1); depth 0 is its outside/map view, gained later
const MAX_DEPTH = 2 // base (1) → one level of tiles inside the home interior (2)
// Shared time/energy pool — spent on each forward step, NEVER refunded; refilled
// only by resting at the home (base) entry. Each level deeper divides the per-step
// cost by SCALE_RATIO, so shallower = higher scale = an order of magnitude more
// energy per move (and leaving a tile out a non-entry edge costs that much). Tunable.
const ENERGY_START = 60 // minutes of usable time to start (very reduced; grows later)
const COST_HOME = 180 // per-step at the (locked) outside scale, so home-interior = 30, inside a tile = 5
const SCALE_RATIO = 6 // each level deeper divides per-step cost by this (180 → 30 → 5)
const MOVE_FRACTION = 0.4 // moving onto a KNOWN tile costs this × the level base (one-way: 2 at depth 2)
const SCOUT_FRACTION = 0.6 // SCOUT costs this × base (3 at depth 2) — deliberately MORE than a walk
const TIME_SCALE = 1000 // real ms of wait per simulated minute at speed ×1 (the unhurried pace)
const WAIT_SPEED = 60 // fast-forward factor applied for now; a future upgrade raises this so the
// real-time wait shrinks while the simulated cost stays the same
const MS_PER_MIN = TIME_SCALE / WAIT_SPEED // real ms per simulated minute — fast, but still live

// ── hex orientation ──────────────────────────────────
// Two orientations, alternating by depth. Each carries the forward/inverse
// axial↔pixel matrices, the corner start-angle, and — derived from those —
// the two corner indices that bound each neighbour's shared edge, the corners
// of the downward "enter" wedge, and the half-extents used to fit the viewport.
// Pointy corners sit at 60·i−30°, flat at 60·i; everything else falls out.
function makeOrient(f, b, startDeg) {
  const o = { f, b, startDeg }
  // the two corner indices bounding the shared edge toward each neighbour dir
  o.edgeCorners = DIRS.map(d => {
    const theta = (Math.atan2(f[2] * d.q + f[3] * d.r, f[0] * d.q + f[1] * d.r) * 180) / Math.PI
    let best = 0
    let bestDiff = Infinity
    for (let i = 0; i < 6; i++) {
      const mid = 60 * i + startDeg + 30 // midpoint angle of edge between corner i, i+1
      const diff = Math.abs(((theta - mid + 540) % 360) - 180)
      if (diff < bestDiff) {
        bestDiff = diff
        best = i
      }
    }
    return [best, (best + 1) % 6]
  })
  // corners falling in the downward arc [30°,150°] → the "enter" double-wedge
  o.enterCorners = []
  for (let i = 0; i < 6; i++) {
    const a = (((60 * i + startDeg) % 360) + 360) % 360
    if (a >= 30 && a <= 150) o.enterCorners.push(i)
  }
  // half-extents in size units (incl. a corner radius) for viewport fitting
  let hx = 0
  let hy = 0
  for (const [q, r] of mapHexes()) {
    hx = Math.max(hx, Math.abs(f[0] * q + f[1] * r))
    hy = Math.max(hy, Math.abs(f[2] * q + f[3] * r))
  }
  o.ext = { hx: hx + 1, hy: hy + 1 }
  return o
}

const POINTY = makeOrient([SQRT3, SQRT3 / 2, 0, 1.5], [SQRT3 / 3, -1 / 3, 0, 2 / 3], -30)
const FLAT = makeOrient([1.5, 0, SQRT3 / 2, SQRT3], [2 / 3, 0, -1 / 3, SQRT3 / 3], 0)
const orientOf = depth => (depth % 2 === 0 ? POINTY : FLAT) // default (inside, depth 2) pointy-top; parent flat-top

// Super-lattice offsets (small-hex axial): where the 6 neighbouring radius-RINGS
// grids tile around this one (rotating (2N+1, -N) in 60° steps). They're drawn
// nudged slightly outward so a gap shows between them and the centre grid.
const SUPER = (() => {
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
const NEIGHBOR_GAP = 0 // extra space beyond flush (0 = vertices touch), in hex-size units

const key = Hex.key // "q,r" string key (cube layer, axial storage)
const eq = Hex.equals

export function HexGridScreen() {
  let api = null
  let hovered = null // hovered hex [q,r], or null
  let hoverPath = null // routed path player→hovered, or null
  let lastP = null // last pointer position — actions re-run hover with it, since the
  // world can change under a stationary mouse (e.g. a scout lands on the hovered tile)
  let hoverWedge = null // hovered wedge index on the player tile, or null (wedge UI parked for now)
  let menuOpen = false // radial action menu around the player (toggled by clicking the cube)
  let menuBtns = [] // hit areas + actions for the open menu's slots (set each draw)
  let exitHover = -1 // neighbour index (0..5) being hovered to exit, or -1

  // We START inside the home tile (depth 1). Its outside/map view (depth 0) exists
  // as a locked parent — "gained" later, not enterable for now.
  const homeOutside = makeTile()
  const homeInside = childAt(homeOutside, "0,0")
  homeInside.discovered.add("0,0") // the home (base) centre starts known; the rest is fog
  let energy = ENERGY_START // shared across levels; spent going out, refills only by resting home
  let day = 1 // current day/expedition; energy spent = minutes past 06:00 (advances on sleep — TODO)
  let orient = orientOf(BASE_DEPTH) // base grid flat-top (we immediately enter home → pointy)
  const stack = [
    { tile: homeOutside, isHome: true, entry: [0, 0], player: [0, 0], trail: [[0, 0]], cost: COST_HOME },
    {
      tile: homeInside,
      isBase: true,
      entry: [0, 0],
      player: [0, 0],
      trail: [[0, 0]],
      cost: COST_HOME / SCALE_RATIO
    }
  ]

  let log = [] // this day's actions in order (for replay); banked + reset on sleep
  const history = [] // past days' logs (for future day-navigation)
  let todayDiscovered = [] // tiles first-discovered TODAY, so replay can re-open the fog
  let replaying = false // true while a replay is animating
  let pending = null // in-progress timed action you wait out — { desc, queue, idx, stepElapsed, total, logEntry, onDone }
  let clockExpanded = false // clock starts collapsed; clicking the status line toggles it
  let replayIdx = 0
  let replayTimer = 0
  const REPLAY_MS = 220 // ms between replayed actions

  // Single edge mesh (topology only; same for every grid) + per-edge overrides.
  const edges = buildEdges()
  const edgeState = new Map() // key → { hidden?, color? } for individual edits
  const gateEdgeKey = edgeKey(0, 0, DIRS[GATE_DIR].q, DIRS[GATE_DIR].r)
  // Outer boundary of the grid (edges whose neighbor is off-map) — the silhouette.
  const boundaryEdges = edges.filter(
    e => hexDistance(e.q + DIRS[e.dir].q, e.r + DIRS[e.dir].r) > RINGS
  )

  const timeline = createTimeline()
  let rafId = 0
  let lastT = 0

  const view = () => stack[stack.length - 1]
  const depth = () => stack.length - 1

  // Drives in-progress timed actions: advance the wait, apply each sub-step as its
  // time elapses, and finish (log + rest/sleep) when the queue drains.
  function tick(t) {
    const dt = lastT ? t - lastT : 16
    lastT = t
    if (pending) {
      pending.stepElapsed += dt
      while (
        pending &&
        pending.idx < pending.queue.length &&
        pending.stepElapsed >= pending.queue[pending.idx].dur
      ) {
        pending.stepElapsed -= pending.queue[pending.idx].dur
        pending.queue[pending.idx].apply()
        pending.idx++
      }
      if (pending && pending.idx >= pending.queue.length) {
        const p = pending
        pending = null
        log.push(p.logEntry)
        p.onDone && p.onDone()
        if (lastP) onPointerMove(lastP) // refresh hover — the world changed under the mouse
      }
    }
    api.requestRender()
    rafId = pending ? requestAnimationFrame(tick) : 0
  }

  function startLoop() {
    if (!rafId) {
      lastT = 0
      rafId = requestAnimationFrame(tick)
    }
  }

  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId)
    rafId = 0
    lastT = 0
  }

  function enter(a) {
    api = a
    hovered = hoverPath = null
  }

  function leave() {
    stopLoop()
    stopReplay()
    document.body.style.cursor = "default"
  }

  // ── hex geometry ───────────────────────────────────
  // The area the grid actually gets: full width, below the clock chrome. Centring in
  // this frame (not the raw canvas) keeps the edge tiles clear of the clock.
  function gridFrame(L) {
    const top = timeline.height(clockExpanded)
    const h = Math.max(50, L.h - top)
    return { w: L.w, h, cx: L.w / 2, cy: top + h / 2 }
  }

  function sizeFor(L) {
    const F = gridFrame(L)
    // leave room for the edge tiles' first touching row (ghost tiles + parked buttons sit
    // ~1 tile beyond the boundary) — not the whole silhouette, just that strip
    const pad = depth() > BASE_DEPTH ? 2 : 0
    return Math.min((0.45 * F.w) / (orient.ext.hx + pad), (0.45 * F.h) / (orient.ext.hy + pad))
  }

  function hexToPixel(L, q, r, size) {
    const F = gridFrame(L)
    const f = orient.f
    return { x: F.cx + size * (f[0] * q + f[1] * r), y: F.cy + size * (f[2] * q + f[3] * r) }
  }

  function pixelToHex(L, x, y, size) {
    const F = gridFrame(L)
    const b = orient.b
    const px = (x - F.cx) / size
    const py = (y - F.cy) / size
    return hexRound(b[0] * px + b[1] * py, b[2] * px + b[3] * py)
  }

  const inBounds = (q, r) => hexDistance(q, r) <= RINGS

  // ── discovery (fog of war) ─────────────────────────
  // Each world tile remembers which of its hexes have been stepped on. You only
  // see discovered tiles plus their immediate frontier; everything beyond is fog,
  // and routes may not pass THROUGH unexplored tiles (see bfsPathDisc).
  const isDiscovered = h => view().tile.discovered.has(key(h))
  // Frontier = the player's OWN undiscovered neighbours (your immediate explore
  // options). Stepping onto a tile reveals only THAT tile, never its neighbours —
  // the explore options simply shift to wherever you now stand.
  const isFrontier = h => !isDiscovered(h) && pathNeighbors(view().player).some(n => eq(n, h))

  // Neighbors for routing. Home's center connects only to the gate tile, so all
  // routes there pass through the gate.
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

  // Shortest route player→goal that travels only over DISCOVERED tiles, with a
  // single allowed final hop onto an undiscovered goal (a frontier tile). So you
  // can never path *through* unexplored tiles to reach something behind them;
  // the frontier is as far as any route can land.
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

  // Shortest route to the target through discovered tiles (movement is always over
  // known ground now; the trip home takes the shortest known path, not a retrace).
  function routeTo(target) {
    return bfsPathDisc(view().player, target)
  }

  // Gate-aware step distance from a hex to all reachable tiles. Expands only
  // through discovered tiles; frontier tiles still get a distance (you can reach
  // them) but aren't expanded past — you can't see, or move, beyond the frontier.
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

  const onTrail = tile => view().trail.some(t => eq(t, tile))

  // Per-step costs (one-way) at the current level's scale.
  const stepCost = () => view().cost * MOVE_FRACTION // move onto a known tile
  const scoutCost = () => view().cost * SCOUT_FRACTION // reveal an adjacent tile, staying put

  // A route runs through discovered tiles, so every step is a known move.
  const pathCost = path => (path.length - 1) * stepCost()

  // Shortest time to get home from `pos`: the shortest route to this level's entry
  // (through discovered tiles) plus each parent level's committed trail, all at the
  // known rate. Recomputed live, so a loop back near the entry shrinks the reserve.
  // Shortest hop count from `pos` to the nearest way OUT of the current level: any
  // border tile facing a reached edge tile (you're not tied to the entry — use
  // whichever exit is closest), or the entry itself at the home base.
  function stepsToExit(pos) {
    const v = view()
    if (v.isBase) {
      const path = bfsPathDisc(pos, v.entry)
      return path ? path.length - 1 : 0
    }
    const reached = reachedExits()
    const dist = bfsDistances(pos)
    let best = Infinity
    for (const k of v.tile.discovered) {
      const [q, r] = k.split(",").map(Number)
      let isExit = false
      for (const d of DIRS) {
        if (!inBounds(q + d.q, r + d.r) && reached.has(superIndexOf(q + d.q, r + d.r))) {
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

  function returnFrom(pos) {
    let c = 0
    for (let i = 0; i < stack.length; i++) {
      const lv = stack[i]
      const steps = i === stack.length - 1 ? stepsToExit(pos) : lv.trail.length - 1
      c += steps * (lv.cost * MOVE_FRACTION)
      // climbing out of a sub-level costs a parent-scale move (the exit up) — reserve it,
      // otherwise you can walk to the edge but not actually afford to leave and get home
      if (i > BASE_DEPTH) c += stack[i - 1].cost * MOVE_FRACTION
    }
    return c
  }
  // Inside our own safe space the energy constraint is lifted — no reserve needed.
  const returnCost = () => (view().tile.safe ? 0 : returnFrom(view().player))

  // MOVE to a discovered tile: route over known ground, keeping enough energy to
  // still reach home (shortest way) from there — unless we're in the safe space.
  function canMove(target) {
    if (!isDiscovered(target)) return false
    const path = bfsPathDisc(view().player, target)
    if (!path) return false
    return view().tile.safe || pathCost(path) + returnFrom(target) <= energy
  }

  // SCOUT an adjacent undiscovered tile (reveal it, stay put) if affordable (free if safe).
  const canScout = target => isFrontier(target) && (view().tile.safe || scoutCost() + returnCost() <= energy)

  // Screen angle of an axial vector under orientation `o`.
  const screenAngle = (o, q, r) => Math.atan2(o.f[2] * q + o.f[3] * r, o.f[0] * q + o.f[1] * r)

  // Which parent-grid DIR index a super-tile (edge tile) corresponds to: the parent DIR
  // sitting in the same on-screen direction the super-tile does (orientations differ
  // between the levels, so match by screen angle rather than assuming a fixed index).
  function parentDirIndex(i) {
    const parentO = orientOf(depth() - 1)
    const sa = screenAngle(orient, SUPER[i][0], SUPER[i][1])
    let best = 0
    let bd = Infinity
    for (let j = 0; j < 6; j++) {
      const pa = screenAngle(parentO, DIRS[j].q, DIRS[j].r)
      const d = Math.abs(Math.atan2(Math.sin(sa - pa), Math.cos(sa - pa)))
      if (d < bd) {
        bd = d
        best = j
      }
    }
    return best
  }
  const parentDirForSuper = i => DIRS[parentDirIndex(i)]

  // Is edge i sealed by a wall on the current tile? (a tile prop — no neighbour that way)
  const walled = i => !!view().tile.walls && view().tile.walls.has(parentDirIndex(i))

  // The parent-grid tile we'd land on by exiting toward super-tile i.
  function exitTarget(i) {
    const d = parentDirForSuper(i)
    const pp = stack[depth() - 1].player // the parent tile we're currently inside
    return [pp[0] + d.q, pp[1] + d.r]
  }

  // Reverse of parentDirForSuper: the edge tile (super index) facing a given parent DIR.
  function superForParentDir(d) {
    for (let i = 0; i < 6; i++) {
      const pd = parentDirForSuper(i)
      if (pd.q === d.q && pd.r === d.r) return i
    }
    return -1
  }

  // Interior border tiles whose off-map edge faces edge tile i (the "step into" options).
  const edgeTilesInto = i =>
    boundaryEdges.filter(e => superIndexOf(e.q + DIRS[e.dir].q, e.r + DIRS[e.dir].r) === i).map(e => [e.q, e.r])

  // Clean screen direction + reach of edge tile i (same placement math as drawEdgeTiles).
  function edgeGeom(i, L, size) {
    const F = gridFrame(L)
    const sc = hexToPixel(L, SUPER[i][0], SUPER[i][1], size)
    const deg = (Math.atan2(sc.y - F.cy, sc.x - F.cx) * 180) / Math.PI
    const snap = -orient.startDeg
    const clean = (Math.round((deg - snap) / 60) * 60 + snap) * (Math.PI / 180)
    const dirx = Math.cos(clean)
    const diry = Math.sin(clean)
    let ext = 0
    for (const e of boundaryEdges) {
      const base = hexToPixel(L, e.q, e.r, size)
      const cs = hexCorners(base.x, base.y, size, orient.startDeg)
      const [a, b] = orient.edgeCorners[e.dir]
      ext = Math.max(ext, (cs[a].x - F.cx) * dirx + (cs[a].y - F.cy) * diry)
      ext = Math.max(ext, (cs[b].x - F.cx) * dirx + (cs[b].y - F.cy) * diry)
    }
    return { dirx, diry, ext }
  }

  // Interior border tile at the centre of edge i — where you first stand once stepped in.
  function edgeCenterTile(i) {
    const L = api.layout
    const size = sizeFor(L)
    const { dirx, diry } = edgeGeom(i, L, size)
    const tiles = edgeTilesInto(i)
    let best = tiles[0]
    let bd = Infinity
    for (const t of tiles) {
      const p = hexToPixel(L, t[0], t[1], size)
      const perp = Math.abs((p.x - gridFrame(L).cx) * -diry + (p.y - gridFrame(L).cy) * dirx) // off-axis distance
      if (perp < bd) {
        bd = perp
        best = t
      }
    }
    return best
  }

  // Reflect an interior tile across the shared edge (midline at `ext`) to the matching
  // ghost tile of the edge tile — so things land centred on a real tile slot there.
  function ghostPos(tile, i, L, size) {
    const F = gridFrame(L)
    const { dirx, diry, ext } = edgeGeom(i, L, size)
    const cp = hexToPixel(L, tile[0], tile[1], size)
    const along = (cp.x - F.cx) * dirx + (cp.y - F.cy) * diry
    const px = cp.x - F.cx - along * dirx // keep any off-axis offset
    const py = cp.y - F.cy - along * diry
    const back = 2 * ext - along
    return { x: F.cx + back * dirx + px, y: F.cy + back * diry + py }
  }

  // Where the cube sits while parked: on the edge tile's matching centre tile.
  const parkedPos = (i, L, size) => ghostPos(edgeCenterTile(i), i, L, size)

  // The two action buttons while parked: one on the ghost tile one step along the edge
  // from the cube, the other its mirror across the cube — so there's always one on each
  // side. The higher of the two is exit-up, the other is slide.
  function parkedButtons(L, size) {
    const i = view().parked
    const center = edgeCenterTile(i)
    const c = parkedPos(i, L, size)
    const r = size * 0.5
    const nb = edgeTilesInto(i).find(t => hexDistance(t[0] - center[0], t[1] - center[1]) === 1)
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

  const parentOf = () => stack[depth() - 1] // the grid one scale up (we're inside one of its tiles)

  // Parent-scale costs for acting on an edge tile: DISCOVER (reveal the neighbour from
  // here, staying put) vs EXIT (step up onto an already-known neighbour).
  const discoverEdgeCost = () => (depth() > BASE_DEPTH ? parentOf().cost * SCOUT_FRACTION : 0)
  const exitCost = () => (depth() > BASE_DEPTH ? parentOf().cost * MOVE_FRACTION : 0)

  // Shortest way home once we've landed on parent tile t: through the parent's known
  // ground (bfs picks the shorter of the path we took or the gate route), at the parent
  // move rate, plus any levels below the parent (their committed trails).
  function exitReturn(t) {
    const parent = parentOf()
    const path = bfsPathDisc(t, parent.entry, parent)
    let c = (path ? path.length - 1 : 0) * (parent.cost * MOVE_FRACTION)
    for (let i = 0; i < depth() - 1; i++) c += (stack[i].trail.length - 1) * (stack[i].cost * MOVE_FRACTION)
    return c
  }

  // DISCOVER the parent neighbour an edge tile maps to. Only while STANDING on a tile
  // bordering that edge — not from tiles away, and never from up top — and only while
  // it's still unknown. You stay put, so the reserve is just the current way home.
  function canDiscoverEdge(i) {
    if (depth() <= BASE_DEPTH || walled(i)) return false
    if (!playerExits().has(i)) return false // must be right next to the edge
    const t = exitTarget(i)
    if (!inBounds(t[0], t[1])) return false
    if (parentOf().tile.discovered.has(key(t))) return false
    return discoverEdgeCost() + returnCost() <= energy
  }

  // EXIT up one scale onto the (already discovered) parent tile the edge maps to.
  function canExit(i) {
    if (depth() <= BASE_DEPTH || walled(i)) return false
    const t = exitTarget(i)
    if (!inBounds(t[0], t[1])) return false
    if (!parentOf().tile.discovered.has(key(t))) return false // unknown → discover, not exit
    return exitCost() + exitReturn(t) <= energy
  }

  // Dots mark the undiscovered tiles adjacent to WHERE YOU SIT that you can afford to
  // scout. So they only appear once you're actually on the neighbouring tile — never
  // just from having discovered that tile from afar.
  function reachableDots() {
    const dots = new Set()
    for (const n of pathNeighbors(view().player)) {
      if (!isDiscovered(n) && canScout(n)) dots.add(key(n))
    }
    return dots
  }

  // ── navigation ─────────────────────────────────────
  const canEnter = () => depth() < MAX_DEPTH && !eq(view().player, view().entry)

  function doEnter(force, from) {
    if (!force && !canEnter()) return // the home tile forces (it's the entry, no gate here)
    const v = view()
    // the tile we came from: passed explicitly by slides (the trail can't tell — a
    // back-slide RETRACES it, losing the history); otherwise the previous trail tile
    const A = from || (v.trail.length >= 2 ? v.trail[v.trail.length - 2] : v.entry)
    const dirAP = { q: A[0] - v.player[0], r: A[1] - v.player[1] } // direction back toward A
    const child = childAt(v.tile, key(v.player))
    // energy carries (already reflects what we spent reaching this tile); only the
    // per-step cost drops at the finer scale
    stack.push({
      tile: child,
      isHome: false,
      origin: v.player.slice(), // the parent-grid hex this tile lives in ("in [..]")
      entry: SUB_ENTRY.slice(),
      player: SUB_ENTRY.slice(),
      trail: [SUB_ENTRY.slice()],
      cost: v.cost / SCALE_RATIO,
      parked: -1
    })
    orient = orientOf(depth())
    // land PARKED on the edge tile facing A — no special entry tile, all interior fog;
    // you then step into any tile touching that edge. player/entry sit on the edge's
    // centre tile as a placeholder (undiscovered) until you step in.
    let i = superForParentDir(dirAP)
    if (i < 0) i = 0
    const center = edgeCenterTile(i)
    const cv = view()
    cv.parked = i
    cv.tile.reachedEdges.add(i) // we're standing at this edge — it's reached
    cv.fromEdge = i // the edge this sub-tile's trail returns to (kept after stepping in)
    cv.entry = center.slice()
    cv.player = center.slice()
    cv.trail = []
    hovered = hoverPath = null
  }

  // Index of `h` on the committed trail (excluding the player's own end), or -1.
  // Hovering a trail tile means RETRACING — the in-between path is invalidated.
  function trailIndexOf(h) {
    const tr = view().trail
    for (let i = 0; i < tr.length - 1; i++) if (eq(tr[i], h)) return i
    return -1
  }

  // Hover preview while parked: route from the parked EDGE (its best discovered
  // edge-row tile) to the target — the way you'd actually walk after stepping in.
  // view().player is a stale placeholder while parked, so it can't be the start.
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

  // Step in off the edge tile onto a chosen interior tile touching that edge.
  function stepInAt(tile) {
    const v = view()
    if (v.parked >= 0) v.fromEdge = v.parked // the trail now hangs off this edge
    v.parked = -1
    v.player = tile.slice()
    v.entry = tile.slice()
    v.trail = [tile.slice()]
    if (!replaying && !v.tile.discovered.has(key(tile))) todayDiscovered.push({ tile: v.tile, key: key(tile) })
    v.tile.discovered.add(key(tile))
    markReachedEdges()
  }

  // Walk the route (all over known ground) to the target, tracking the elastic
  // trail for the on-screen path. Every step costs a known move — including heading
  // home, since walking back is time that passes (but the shortest return was kept
  // in reserve, so you can always afford it).
  // One tile step over known ground (deduct the move cost, track the elastic trail).
  function stepOnto(step) {
    const v = view()
    if (v.trail.length >= 2 && eq(step, v.trail[v.trail.length - 2])) v.trail.pop()
    else v.trail.push(step)
    if (!v.tile.safe) energy -= v.cost * MOVE_FRACTION // free movement inside the safe space
    v.player = step
    markReachedEdges()
  }

  // Standing on a border tile reaches its off-map edges — a permanent ratchet (like
  // discovery). Edge tiles only show once the player has actually stood next to them.
  function markReachedEdges() {
    const v = view()
    const [pq, pr] = v.player
    for (const d of DIRS) {
      if (!inBounds(pq + d.q, pr + d.r)) {
        const i = superIndexOf(pq + d.q, pr + d.r)
        if (i >= 0) v.tile.reachedEdges.add(i)
      }
    }
  }

  // Arriving at this level's entry clears the trail; at the home base it also rests.
  function restIfHome() {
    const v = view()
    if (eq(v.player, v.entry)) {
      v.trail = [v.entry.slice()]
      if (v.isBase) energy = ENERGY_START
    }
  }

  // Apply a whole move at once (used by replay). Live moves are walked step-by-step
  // over real time via startMove().
  function moveTo(target, via = null) {
    const path = via || routeTo(target)
    if (!path) return false
    for (let i = 1; i < path.length; i++) stepOnto(path[i])
    restIfHome()
    return true
  }

  // Scout: reveal an adjacent undiscovered tile WITHOUT moving onto it (stay put).
  // Costs the scout rate; discovery is permanent, noted for replay's fog.
  function doScout(target) {
    const v = view()
    const dk = key(target)
    if (!v.tile.safe) energy -= scoutCost() // discovery is free inside the safe space
    if (!replaying && !v.tile.discovered.has(dk)) todayDiscovered.push({ tile: v.tile, key: dk })
    v.tile.discovered.add(dk)
  }

  // ── timed actions (you wait out the cost; 1 min = 1 sec) ─────────
  function startMove(target, thenPark = -1, via = null) {
    const path = via || routeTo(target) // `via` = explicit route (e.g. a trail retrace)
    if (!path) return
    const per = stepCost()
    const dur = per * MS_PER_MIN
    pending = {
      desc: `walking to ${target[0]},${target[1]}`,
      verb: "walking to",
      target,
      steps: path.length - 1,
      stepCostMin: per,
      queue: path.slice(1).map(step => ({ dur, apply: () => stepOnto(step) })),
      idx: 0,
      stepElapsed: 0,
      total: (path.length - 1) * dur,
      logEntry: via ? { type: "move", target, via } : { type: "move", target },
      onDone: () => {
        restIfHome()
        // no auto-rest on arrival — resting is a deliberate menu action at the centre
        if (thenPark >= 0) {
          view().parked = thenPark // walked to an edge: park at it on arrival
          log.push({ type: "park", superIdx: thenPark })
        }
        hovered = hoverPath = null
      }
    }
    startLoop()
  }

  function startScout(target) {
    const per = scoutCost()
    const dur = per * MS_PER_MIN
    pending = {
      desc: `scouting ${target[0]},${target[1]}`,
      verb: "scouting",
      target,
      steps: 1,
      stepCostMin: per,
      queue: [{ dur, apply: () => doScout(target) }],
      idx: 0,
      stepElapsed: 0,
      total: dur,
      logEntry: { type: "scout", target },
      onDone: null
    }
    startLoop()
  }

  // Reveal the parent neighbour an edge tile maps to, without moving (stay inside).
  function doDiscoverEdge(i) {
    const parent = parentOf()
    const dk = key(exitTarget(i))
    if (parent.tile.discovered.has(dk)) return
    energy -= discoverEdgeCost()
    if (!replaying) todayDiscovered.push({ tile: parent.tile, key: dk })
    parent.tile.discovered.add(dk)
  }

  // EXIT up one scale onto the (already discovered) parent tile the edge maps to — a
  // parent-scale move; extends or retraces the parent trail.
  function doBack(i) {
    if (depth() <= BASE_DEPTH) return // can't leave the home interior — its outside view isn't gained yet
    const t = exitTarget(i) // compute before popping (uses the child orientation)
    stack.pop()
    orient = orientOf(depth())
    const v = view() // now the parent grid
    if (v.trail.length >= 2 && eq(t, v.trail[v.trail.length - 2])) v.trail.pop()
    else v.trail.push(t)
    energy -= v.cost * MOVE_FRACTION
    v.player = t
    hovered = hoverPath = null
  }

  // Rest — a deliberate menu action at the centre special tile (never automatic, so you
  // can move across the board freely): refill, bank the day, start the next.
  function doRest() {
    const v = view()
    if (!(v.tile.safe && eq(v.player, [0, 0]))) return
    energy = ENERGY_START
    v.trail = [[0, 0]]
    v.fromEdge = -1 // fresh day anchored at the centre — no stale edge connector
    sleep()
  }

  // Walk to the nearest discovered tile bordering edge `si` and park there. Edges are
  // reachable from anywhere with a clean path — proximity only gates DISCOVERY. Works
  // from an interior tile or from another edge (step in first), so edge → edge travel
  // just chains stepIn → walk → park.
  // Shortest valid path to a discovered tile bordering edge `si` (from the parked edge
  // or the player's tile), or null.
  function bestPathToEdge(si) {
    let best = null
    for (const bt of edgeTilesInto(si)) {
      if (!isDiscovered(bt)) continue
      const path =
        view().parked >= 0 ? parkedRoute(bt) : eq(bt, view().player) ? [bt] : canMove(bt) ? routeTo(bt) : null
      if (path && (!best || path.length < best.length)) best = path
    }
    return best
  }

  function travelToEdge(si) {
    if (depth() <= BASE_DEPTH || walled(si)) return false
    if (!parentOf().tile.discovered.has(key(exitTarget(si)))) return false // unknown edge
    const best = bestPathToEdge(si)
    if (!best) return false
    if (view().parked >= 0) {
      stepInAt(best[0])
      log.push({ type: "stepIn", to: best[0] })
    }
    const dest = best[best.length - 1]
    if (eq(dest, view().player)) {
      view().parked = si // already on a bordering tile — just park
      log.push({ type: "park", superIdx: si })
    } else {
      startMove(dest, si) // walk over, park on arrival
    }
    api.requestRender()
    return true
  }

  // Slide to the neighbour across edge i: exit up onto it, then re-enter its board at the
  // same scale — you end parked on the shared edge from the other side. No pop/re-zoom.
  function boardSwitch(i) {
    const from = parentOf().player.slice() // the tile we're sliding out of (parent coords)
    doBack(i) // pops to the parent, lands on the neighbour tile (charges the parent move)
    // normal enter even for the home tile: you arrive parked at the edge you came in
    // through (its safe/walls props live on the tile, so they apply regardless).
    // doEnterHome (centre start) is only for the day's fresh start / go-home.
    doEnter(true, from)
  }

  // Sleep: returning home to rest banks the day's actions and starts the next.
  function sleep() {
    if (log.length) history.push({ day, actions: log })
    day++
    log = []
    todayDiscovered = [] // today's reveals are now permanent history
  }

  // "Go home": collapse back to the home base, stand at the entry, rest + new day. A
  // reliable way home regardless of energy (a gated ability later; on now for testing).
  function goHome() {
    while (stack.length > BASE_DEPTH + 1) stack.pop() // back to the base grid
    orient = orientOf(depth())
    const base = view()
    base.player = base.entry.slice()
    base.trail = [base.entry.slice()]
    energy = ENERGY_START
    sleep()
    doEnterHome() // home is the safe space inside the home tile now
    hovered = hoverPath = null
  }

  // "Rest and resume": advance a day, then start it having travelled back to where you
  // stand — so the fresh day's energy is already spent by the shortest trip out (the trip
  // back costs the same as the trip home, i.e. the current reserve).
  function restAndResume() {
    const back = returnCost() // shortest path home == shortest path back out to here
    sleep()
    energy = ENERGY_START - back
    hovered = hoverPath = null
  }

  // Our own safe space: land on the centre special tile (which opens the cube view),
  // discover around freely (no energy cost, no reserve), walled off from the rest.
  function doEnterHome() {
    const v = view()
    const child = childAt(v.tile, key(v.player))
    child.discovered.add(key([0, 0])) // start standing on the centre special tile
    child.safe = true // energy constraint lifted in here
    if (!child.walls) child.walls = new Set([0, 1, 2, 3, 4, 5].filter(j => j !== GATE_DIR)) // sealed but the gate
    stack.push({
      tile: child,
      isHome: false,
      origin: v.player.slice(),
      entry: [0, 0],
      player: [0, 0],
      trail: [[0, 0]],
      cost: v.cost / SCALE_RATIO,
      parked: -1
    })
    orient = orientOf(depth())
    hovered = hoverPath = null
  }
  function enterCube() {
    api.setScreen(CubeScreen(() => api.setScreen(screen)))
  }

  // Actions available on the tile the player is standing on — these fill the radial
  // menu's 6 slots (opened by clicking the cube).
  function menuActions() {
    const v = view()
    const a = []
    if (v.tile.safe && eq(v.player, [0, 0])) {
      a.push({ label: "enter cube", run: enterCube })
      a.push({ label: "rest", run: doRest })
    }
    if (canEnter()) {
      a.push({
        label: "enter",
        run: () => {
          doEnter()
          log.push({ type: "enter" })
        }
      })
    }
    return a
  }

  // ── replay ─────────────────────────────────────────
  // Play re-runs the day: reset to the day's start, then re-apply the logged
  // actions on a timer. Because moves mutate energy + the trails, the cube AND the
  // timeline animate together for free. Discovery isn't rewound (v1).
  const hitPlay = p => {
    if (!clockExpanded) return false // play button only exists on the expanded clock
    const pb = timeline.playButton(api.layout)
    return Math.hypot(p.x - pb.x, p.y - pb.y) <= pb.r
  }

  function resetToDayStart() {
    // temporarily re-fog today's discoveries so replay re-opens them as the cube walks.
    // (Discovery is permanent — this is a display-only rewind, restored on stop.)
    for (const d of todayDiscovered) d.tile.discovered.delete(d.key)
    stack.length = 2 // back to [homeOutside, homeInside(base)]
    const base = stack[1]
    base.player = base.entry.slice()
    base.trail = [base.entry.slice()]
    energy = ENERGY_START
    orient = orientOf(BASE_DEPTH)
    doEnterHome() // the day starts inside the home safe space
    hovered = hoverPath = null
  }

  const toggleReplay = () => (replaying ? stopReplay() : startReplay())

  function startReplay() {
    if (!log.length || pending) return
    replaying = true
    resetToDayStart()
    replayIdx = 0
    api.requestRender()
    scheduleReplay()
  }

  function scheduleReplay() {
    replayTimer = setTimeout(() => {
      if (!replaying) return
      if (replayIdx >= log.length) return stopReplay()
      const a = log[replayIdx++]
      if (a.type === "move") moveTo(a.target, a.via)
      else if (a.type === "scout") doScout(a.target)
      else if (a.type === "enter") doEnter(true)
      else if (a.type === "enterHome") doEnterHome()
      else if (a.type === "exit") doBack(a.superIdx)
      else if (a.type === "discoverEdge") doDiscoverEdge(a.superIdx)
      else if (a.type === "stepIn") stepInAt(a.to)
      else if (a.type === "slide") boardSwitch(a.superIdx)
      else if (a.type === "park") view().parked = a.superIdx
      api.requestRender()
      scheduleReplay()
    }, REPLAY_MS)
  }

  function stopReplay() {
    if (replayTimer) clearTimeout(replayTimer)
    replayTimer = 0
    // fast-forward any remaining actions so we land back on the live end-of-day state
    // (still flagged "replaying" here so these don't re-log discoveries)
    while (replayIdx < log.length) {
      const a = log[replayIdx++]
      if (a.type === "move") moveTo(a.target, a.via)
      else if (a.type === "scout") doScout(a.target)
      else if (a.type === "enter") doEnter(true)
      else if (a.type === "enterHome") doEnterHome()
      else if (a.type === "exit") doBack(a.superIdx)
      else if (a.type === "discoverEdge") doDiscoverEdge(a.superIdx)
      else if (a.type === "stepIn") stepInAt(a.to)
      else if (a.type === "slide") boardSwitch(a.superIdx)
      else if (a.type === "park") view().parked = a.superIdx
    }
    replaying = false
    for (const d of todayDiscovered) d.tile.discovered.add(d.key) // discovery is permanent — restore in full
    api.requestRender()
  }

  // Which of the 6 wedges (0..5) a point falls in, around a tile center.
  // Wedges 1 and 2 are the bottom pair → the downward "enter" double-wedge.
  function wedgeAt(p, center) {
    let deg = (Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI
    deg = ((deg % 360) + 360) % 360
    return Math.floor((deg + 30) / 60) % 6
  }

  const inEnterWedge = w => w === 1 || w === 2 // the bottom double-wedge

  // Which neighbouring grid (0..5) an off-map tile belongs to, or -1.
  function superIndexOf(q, r) {
    for (let i = 0; i < 6; i++) {
      if (hexDistance(q - SUPER[i][0], r - SUPER[i][1]) <= RINGS) return i
    }
    return -1
  }

  // The neighbours the player can step out into: only on a border tile, and only
  // the neighbour(s) its open (off-map) edges face.
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

  // Siblings whose boundary edge the player has physically stood at. Their edge
  // tiles stay hidden until then.
  function reachedExits() {
    return view().tile.reachedEdges // stepped-at edges only — scouting a border tile
    // from afar does NOT reveal its edge (that was the regression)
  }

  // ── pointer ────────────────────────────────────────
  function onPointerMove(p) {
    lastP = p // remembered so actions can refresh hover under a stationary mouse
    if (pending || replaying) return // locked while a timed action or replay runs
    if (timeline.draggingSpeed) {
      timeline.speedDragMove(p)
      api.requestRender()
      document.body.style.cursor = "pointer"
      return
    }

    const stepIdx = timeline.stepAt(p)
    if (stepIdx !== null) {
      let changed = timeline.setHover(stepIdx)
      if (hovered !== null) {
        hovered = hoverPath = null
        changed = true
      }
      if (changed) api.requestRender()
      document.body.style.cursor = "pointer"
      return
    }

    let changed = timeline.setHover(null)
    const size = sizeFor(api.layout)
    const { q, r } = pixelToHex(api.layout, p.x, p.y, size)
    // any in-range tile can be hovered now (undiscovered ones just show an outline);
    // move/scout is still gated below by canMove / canScout. Hover works while parked too,
    // so you can preview a route from the edge before stepping in.
    const onMap = inBounds(q, r)
    const h = onMap ? [q, r] : null
    // recompute the path every move (61-tile BFS is cheap) — the tile under a stationary
    // key may change state (scouted, stepped), so "same tile" doesn't mean "same path"
    let np = null
    if (h) {
      if (view().parked >= 0) {
        np = parkedRoute(h) // parked: preview from the edge, not the stale player tile
      } else if (!eq(h, view().player)) {
        const ti = trailIndexOf(h)
        if (ti >= 0) {
          // hovering a tile already on the trail: preview the RETRACE back to it
          const rp = view().trail.slice(ti).reverse() // player → back along the trail → h
          np = view().tile.safe || pathCost(rp) + returnFrom(h) <= energy ? rp : null
        } else if (canMove(h)) np = routeTo(h)
      }
    }
    const sig = pth => (pth ? `${pth.length}:${key(pth[0])}:${key(pth[pth.length - 1])}` : "")
    if ((h ? key(h) : null) !== (hovered ? key(hovered) : null) || sig(np) !== sig(hoverPath)) {
      hovered = h
      hoverPath = np
      changed = true
    }

    // enter double-wedge on the player tile
    const onPlayer = h && eq(h, view().player)
    const wedge = onPlayer ? wedgeAt(p, hexToPixel(api.layout, h[0], h[1], size)) : null
    if (wedge !== hoverWedge) {
      hoverWedge = wedge
      changed = true
    }
    // edge hover: discoverable (adjacent only), exitable, or travelable — a known edge
    // is directly reachable from anywhere with a clean path. The parked edge itself has
    // no hover state (we're already there; its buttons own the actions).
    let hovEx = -1
    if (!onMap) {
      const si = superIndexOf(q, r)
      if (si >= 0 && si !== view().parked && depth() > BASE_DEPTH && !walled(si)) {
        const known = parentOf().tile.discovered.has(key(exitTarget(si)))
        if (known || canDiscoverEdge(si)) hovEx = si
      }
    }
    if (hovEx !== exitHover) {
      exitHover = hovEx
      changed = true
    }
    if (changed) api.requestRender()

    const onChrome = timeline.hitButton(p) || timeline.counterAt(p) !== null || timeline.hitSlider(p)
    let overBtn = false
    if (view().parked >= 0 && canExit(view().parked)) {
      const b = parkedButtons(api.layout, size)
      overBtn = Math.hypot(p.x - b.out.x, p.y - b.out.y) <= b.out.r
    }
    // the player cube is a button (opens the radial menu); open-menu slots are too
    let overMenu = onPlayer && view().parked < 0
    if (menuOpen) for (const b of menuBtns) if (Math.hypot(p.x - b.x, p.y - b.y) <= b.r) overMenu = true
    document.body.style.cursor =
      hoverPath || overMenu || exitHover >= 0 || onChrome || overBtn ? "pointer" : "default"
  }

  function onPointerDown(p) {
    if (hitPlay(p)) {
      // play/stop button lives on the status line
      toggleReplay()
      return
    }
    if (p.y <= 24) {
      // clicking elsewhere on the status line toggles the clock expanded/collapsed
      clockExpanded = !clockExpanded
      api.requestRender()
      return
    }
    if (pending) return // waiting out a timed action
    if (replaying) return // input is locked while a replay animates
    if (menuOpen) {
      // open menu: a slot runs its action; anywhere else (incl. the player) just closes
      menuOpen = false
      for (const b of menuBtns) {
        if (Math.hypot(p.x - b.x, p.y - b.y) <= b.r) {
          b.run()
          api.requestRender()
          return
        }
      }
      api.requestRender()
      return
    }
    for (const b of timeline.homeButtons()) {
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
        b.action === "go home" ? goHome() : restAndResume()
        api.requestRender()
        return
      }
    }
    if (timeline.speedDragStart(p)) {
      api.requestRender()
      return
    }
    if (timeline.hitButton(p)) {
      timeline.toggle()
      timeline.playing ? startLoop() : stopLoop()
      api.requestRender()
      return
    }
    const tli = timeline.counterAt(p)
    if (tli !== null) {
      if (timeline.ascendTo(tli)) api.requestRender()
      return
    }
    const tstep = timeline.stepAt(p)
    if (tstep !== null) {
      if (timeline.enterStep(tstep)) api.requestRender()
      return
    }
    const size = sizeFor(api.layout)
    const { q, r } = pixelToHex(api.layout, p.x, p.y, size)
    // parked on an edge tile: slide button, step-in dots, or set off — a farther tile
    // (or another edge) with a clear path is directly reachable from here.
    if (view().parked >= 0) {
      const i = view().parked
      const b = parkedButtons(api.layout, size)
      const hit = btn => Math.hypot(p.x - btn.x, p.y - btn.y) <= btn.r
      if (canExit(i) && hit(b.out)) {
        boardSwitch(i) // straight-out: slide to the neighbour's board (go-up is hidden for now)
        log.push({ type: "slide", superIdx: i })
        api.requestRender()
        return
      }
      if (!inBounds(q, r)) {
        // another edge: walk over and park there if the path is valid (edge → edge)
        const si = superIndexOf(q, r)
        if (si >= 0 && si !== i) travelToEdge(si)
        return
      }
      const chosen = edgeTilesInto(i).find(o => eq(o, [q, r]))
      if (chosen && !isDiscovered(chosen)) {
        // first click: discover it (stay parked); hover refreshes in place so the
        // second click's affordance shows without wiggling the mouse
        doScout(chosen)
        log.push({ type: "scout", target: chosen })
        api.requestRender()
        onPointerMove(p)
      } else if (chosen) {
        // click again once known: step in onto it
        stepInAt(chosen)
        log.push({ type: "stepIn", to: chosen })
        api.requestRender()
        onPointerMove(p)
      } else {
        // farther tile with a clear path from this edge: step in and walk there
        const path = parkedRoute([q, r])
        if (path) {
          stepInAt(path[0])
          log.push({ type: "stepIn", to: path[0] })
          if (path.length > 1) startMove([q, r])
          api.requestRender()
        }
      }
      return
    }
    // outside the grid: click an edge tile
    if (!inBounds(q, r)) {
      const si = superIndexOf(q, r)
      const known = parentOf().tile.discovered.has(key(exitTarget(si)))
      if (!known && canDiscoverEdge(si)) {
        // undiscovered edge tile → reveal the neighbour up top (carved path required)
        doDiscoverEdge(si)
        log.push({ type: "discoverEdge", superIdx: si })
        api.requestRender()
        onPointerMove(p)
      } else if (known && playerExits().has(si)) {
        // discovered edge tile, standing on its border → park on it (buttons decide next)
        view().parked = si
        log.push({ type: "park", superIdx: si })
        api.requestRender()
      } else if (known) {
        // discovered edge, but we're farther away: walk to it and park (clean path only)
        travelToEdge(si)
      }
      return
    }
    const t = [q, r]
    if (eq(t, view().player)) {
      // clicking the player opens the radial action menu (the enter wedge is parked —
      // its actions live on the menu slots now)
      menuOpen = true
      api.requestRender()
      return
    }
    if (isFrontier(t)) {
      // adjacent unknown tile → scout it (reveal, stay put) rather than move
      if (canScout(t)) startScout(t)
      return
    }
    const ti = trailIndexOf(t)
    if (ti >= 0) {
      // clicking a trail tile retraces back along the trail (matches the hover preview)
      const rp = view().trail.slice(ti).reverse()
      if (view().tile.safe || pathCost(rp) + returnFrom(t) <= energy) startMove(t, -1, rp)
      return
    }
    if (canMove(t)) startMove(t)
  }

  function onPointerUp() {
    if (timeline.draggingSpeed) {
      timeline.speedDragEnd()
      api.requestRender()
    }
  }

  // Double-clicking the entry point resets the path back to it.
  // (Double-click did a debug "reset to entry" that also refilled energy at home — it was
  // a leftover shortcut and confusing, so it's removed. Use the go-home button instead.)
  function onDoubleClick() {}

  // ── draw ───────────────────────────────────────────
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

  // The "enter" control: the bottom double-wedge (the downward corners) of the
  // player tile, pointing down. Outlined; fills when hovered. Drawn under the
  // cube, so only the part below the cube shows. No label for now.
  function drawEnterWedge(ctx, L, size, v, ink) {
    if (!canEnter()) return
    const c = hexToPixel(L, v.player[0], v.player[1], size)
    const k = hexCorners(c.x, c.y, size, orient.startDeg)
    const region = [c, ...orient.enterCorners.map(i => k[i])]
    ctx.beginPath()
    region.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)))
    ctx.closePath()
    const hovering = inEnterWedge(hoverWedge)
    if (hovering) {
      ctx.fillStyle = ink
      ctx.globalAlpha = 0.12
      ctx.fill()
    }
    ctx.strokeStyle = ink
    ctx.lineWidth = 1.5
    ctx.lineJoin = "round"
    ctx.globalAlpha = hovering ? 0.9 : 0.45
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  // The 6 neighbouring grids' edge tiles (the current grid's boundary, tiled to
  // each super-lattice position). All faint; the neighbour(s) the player can
  // currently exit into are brighter, the hovered one brightest.
  // While parked: two icon buttons — curved-up = out to parent, straight-out = slide to
  // the neighbour. Dimmed when the move isn't affordable.
  function drawParkedButtons(ctx, L, size, ink) {
    const i = view().parked
    const { dirx, diry } = edgeGeom(i, L, size)
    const b = parkedButtons(L, size)
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.strokeStyle = ink
    ctx.globalAlpha = canExit(i) ? 0.9 : 0.25
    ctx.lineWidth = 2
    // go-up (out to parent) is hidden until the parent view is earned — slide only
    drawArrowStraight(ctx, b.out, dirx, diry)
    ctx.globalAlpha = 1
    ctx.lineCap = "butt"
  }

  function drawEdgeTiles(ctx, L, size, ink) {
    if (depth() <= BASE_DEPTH) return
    const exits = playerExits()
    const reached = reachedExits() // siblings whose edge we've explored to
    ctx.lineJoin = "round"
    ctx.strokeStyle = ink
    for (let i = 0; i < 6; i++) {
      if (walled(i)) continue // sealed edge — no neighbour there
      // the parent tile this edge maps to is known once discovered (incl. the one we
      // came from); show it solid then, dashed if we've only carved to its edge, else hide
      const known = parentOf().tile.discovered.has(key(exitTarget(i)))
      if (!known && !reached.has(i)) continue
      // clean big-hex direction + extent (shared with the buttons/ghost placement);
      // place at 2× so the outer vertices just meet (flush), plus an optional gap
      const { dirx, diry, ext } = edgeGeom(i, L, size)
      const Dn = 2 * ext + NEIGHBOR_GAP * size
      const ox = Dn * dirx
      const oy = Dn * diry

      const actionable = known ? exits.has(i) && canExit(i) : canDiscoverEdge(i)
      ctx.globalAlpha = exitHover === i ? 0.9 : actionable ? 0.7 : 0.25
      ctx.lineWidth = exitHover === i ? 2 : 1.5
      ctx.setLineDash(known ? [] : [5, 4]) // dashed outline = still undiscovered up top
      for (const e of boundaryEdges) {
        const base = hexToPixel(L, e.q, e.r, size)
        const cs = hexCorners(base.x + ox, base.y + oy, size, orient.startDeg)
        const [a, b] = orient.edgeCorners[e.dir]
        ctx.beginPath()
        ctx.moveTo(cs[a].x, cs[a].y)
        ctx.lineTo(cs[b].x, cs[b].y)
        ctx.stroke()
      }
    }
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }

  function draw(ctx, L) {
    const ink = theme("--text", "#eee")
    const surface = theme("--surface", "#111")
    const size = sizeFor(L)
    const v = view()

    // energy reach: forward disc from where we stand + the trail back home.
    // Alpha scales with proximity — closer (cheaper) tiles are lighter, the
    // edge of reach fades out.
    const disc = v.tile.discovered
    const trailKeys = new Set(v.trail.map(t => key(t)))
    // explored (stepped-on) tiles are filled; undiscovered tiles you can actually
    // reach this trip get a faint centre dot so you can see there's something there.
    // while parked, the step-in choices (tiles touching this edge) show as the dots
    const dots = v.parked >= 0 ? new Set(edgeTilesInto(v.parked).map(t => key(t))) : reachableDots()
    for (const [q, r] of mapHexes()) {
      const k = `${q},${r}`
      const c = hexToPixel(L, q, r, size)
      if (disc.has(k)) {
        const alpha = trailKeys.has(k) ? 0.12 : 0.05 // current trail brighter than past
        fillHex(ctx, c, size, ink, alpha, orient.startDeg)
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
    if (hovered && hoverPath) {
      fillHex(ctx, hexToPixel(L, hovered[0], hovered[1], size), size, ink, 0.12, orient.startDeg)
    }
    // hovering a reachable (dotted) undiscovered tile: reveal its outline (no fill)
    if (hovered && !disc.has(key(hovered)) && dots.has(key(hovered))) {
      const c = hexToPixel(L, hovered[0], hovered[1], size)
      const cs = hexCorners(c.x, c.y, size, orient.startDeg)
      ctx.strokeStyle = ink
      ctx.globalAlpha = 0.45
      ctx.lineWidth = 1.5
      ctx.beginPath()
      for (let i = 0; i < 6; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, cs[i].x, cs[i].y)
      ctx.closePath()
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    // single edge mesh, almost invisible, gate edge hidden at home
    ctx.strokeStyle = ink
    ctx.lineWidth = 1
    for (const e of edges) {
      if (v.isBase && e.key === gateEdgeKey) continue
      // fog: only draw edges touching a discovered tile (outlines the known area)
      const nbr = `${e.q + DIRS[e.dir].q},${e.r + DIRS[e.dir].r}`
      if (!disc.has(`${e.q},${e.r}`) && !disc.has(nbr)) continue
      const st = edgeState.get(e.key)
      if (st?.hidden) continue
      const c = hexToPixel(L, e.q, e.r, size)
      const cs = hexCorners(c.x, c.y, size, orient.startDeg)
      const [a, b] = orient.edgeCorners[e.dir]
      ctx.globalAlpha = st?.color ? 1 : 0.12
      ctx.strokeStyle = st?.color || ink
      ctx.beginPath()
      ctx.moveTo(cs[a].x, cs[a].y)
      ctx.lineTo(cs[b].x, cs[b].y)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    ctx.strokeStyle = ink

    // walls (a tile prop): sealed perimeter edges drawn bold — no neighbour that way.
    // An edge is open only if the space across it is covered by an open neighbour's
    // DRAWN silhouette (the snapped placement) — the lattice mapping alone leaves seam
    // edges (like the flat top of the top-centre tile) looking open onto nothing.
    if (v.tile.walls) {
      const openOffsets = []
      for (let i = 0; i < 6; i++) {
        if (walled(i)) continue
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
        const cs = hexCorners(c.x, c.y, size, orient.startDeg)
        const [a, b] = orient.edgeCorners[e.dir]
        // probe 1.4 hex-apothems beyond the edge midpoint: the flush placement makes the
        // silhouette boundary pass EXACTLY through the tile-centres across the seam, so a
        // shallow probe sees only the gap and a 1.0 probe is a degenerate tie — strictly
        // beyond it, open edges find silhouette interior and the seam-end tooth does not
        const mx = (cs[a].x + cs[b].x) / 2
        const my = (cs[a].y + cs[b].y) / 2
        const px = mx + (mx - c.x) * 1.4
        const py = my + (my - c.y) * 1.4
        const open = openOffsets.some(o => {
          const h = pixelToHex(L, px - o.ox, py - o.oy, size)
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

    // home tile: bump its outline so the home cell reads clearly, gate edge left open
    if (v.isBase) {
      const hc0 = hexToPixel(L, 0, 0, size)
      const hcs = hexCorners(hc0.x, hc0.y, size, orient.startDeg)
      ctx.strokeStyle = ink
      ctx.globalAlpha = 0.45
      ctx.lineWidth = 1.5
      for (let d = 0; d < 6; d++) {
        if (d === GATE_DIR) continue // the gate edge stays open
        const [a, b] = orient.edgeCorners[d]
        ctx.beginPath()
        ctx.moveTo(hcs[a].x, hcs[a].y)
        ctx.lineTo(hcs[b].x, hcs[b].y)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    // link from the edge we came in through to where we stepped in — the path back to it
    if (v.parked < 0 && v.fromEdge >= 0 && v.trail.length) {
      const e0 = parkedPos(v.fromEdge, L, size)
      const t0 = hexToPixel(L, v.trail[0][0], v.trail[0][1], size)
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

    // walked to an edge and parked there: link the trail's end to the edge position,
    // so the committed path visibly reaches the edge instead of stopping a tile short
    if (v.parked >= 0 && v.trail.length) {
      const e0 = parkedPos(v.parked, L, size)
      const t = v.trail[v.trail.length - 1]
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

    // parked: the hover preview hangs off the edge — dashed link from the cube to the
    // route's entry tile (mirrors the committed fromEdge connector)
    if (v.parked >= 0 && hoverPath && hoverPath.length) {
      const e0 = parkedPos(v.parked, L, size)
      const t0 = hexToPixel(L, hoverPath[0][0], hoverPath[0][1], size)
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

    // committed walked route (solid) with per-leg direction arrowheads; dashed hover.
    // Hovering a tile already ON the trail invalidates the stretch beyond it: the solid
    // trail only draws up to that tile, and the dashed retrace points back at it.
    const hovTrailIdx = hovered && v.parked < 0 ? trailIndexOf(hovered) : -1
    const shownTrail = hovTrailIdx >= 0 ? v.trail.slice(0, hovTrailIdx + 1) : v.trail
    drawPath(ctx, L, size, shownTrail, ink, false)
    drawTrailArrows(ctx, L, size, shownTrail, ink)
    drawPath(ctx, L, size, hoverPath, ink, true)
    // arrowhead at the hover trail's tip, pointing into the target tile
    if (hoverPath && hoverPath.length >= 2) {
      const a = hexToPixel(L, hoverPath[hoverPath.length - 2][0], hoverPath[hoverPath.length - 2][1], size)
      const b = hexToPixel(L, hoverPath[hoverPath.length - 1][0], hoverPath[hoverPath.length - 1][1], size)
      ctx.globalAlpha = 0.45
      arrowTip(ctx, a.x, a.y, b.x, b.y, ink, size * 0.32, size * 0.2, 1.5)
      ctx.globalAlpha = 1
    }

    // entry marker (ring) — only the home centre; sub-tiles have no special entry tile
    if (v.isBase) {
      const e = hexToPixel(L, v.entry[0], v.entry[1], size)
      ctx.beginPath()
      ctx.arc(e.x, e.y, 7, 0, Math.PI * 2)
      ctx.globalAlpha = 0.7
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    // centre special piece (safe space) — always visible once discovered: the same cube
    // the player uses, inverted (floor corners), full tile size, opaque like the player
    if (v.tile.safe && disc.has("0,0")) {
      const hc = hexToPixel(L, 0, 0, size)
      drawCube(ctx, hc.x, hc.y, size * 2, ink, surface, orient.startDeg, true)
    }

    // edge tiles (neighbouring sub-grids), then the cube on top
    // (the enter double-wedge is parked for now — its actions moved to the radial menu)
    drawEdgeTiles(ctx, L, size, ink)
    const pc = v.parked >= 0 ? parkedPos(v.parked, L, size) : hexToPixel(L, v.player[0], v.player[1], size)
    drawCube(ctx, pc.x, pc.y, size, ink, surface, orient.startDeg)
    if (v.parked >= 0) drawParkedButtons(ctx, L, size, ink)

    // radial action menu: 6 hex slots ringing the player tile, styled apart from the
    // board (opaque fill + bright outline). Actions fill from the top, clockwise.
    menuBtns = []
    if (menuOpen && !(v.parked >= 0)) {
      const acts = menuActions()
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
        const cs = hexCorners(s.x, s.y, size * 0.68, orient.startDeg)
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

    // live clock: energy only debits when each sub-step lands, so add the current step's
    // partial elapsed. Quantized to whole minutes so every counter is derived from the
    // same integer and steps together — no rounding drift (the wait is fast, not gone).
    const inflight = pending ? Math.min(Math.floor(pending.stepElapsed / MS_PER_MIN), energy) : 0
    const liveEnergy = energy - inflight
    const spent = ENERGY_START - liveEnergy
    const reserved = returnCost()

    // status line at the very top, before the clock (click it to toggle the clock)
    const hr = 6 + Math.floor(spent / 60)
    const mn = Math.round(spent % 60)
    const clock = `${String(hr).padStart(2, "0")}:${String(mn).padStart(2, "0")}`
    ctx.font = clockExpanded ? "600 16px system-ui, sans-serif" : "600 11px system-ui, sans-serif"
    ctx.textAlign = "left"
    ctx.textBaseline = "middle"
    ctx.fillStyle = ink
    ctx.globalAlpha = 0.9
    // name · day · wall-clock time — same in both collapsed and expanded
    const status = `anon&mato  ·  day ${day}  ·  ${clock}`
    ctx.fillText(status, 14, 14)
    ctx.globalAlpha = 1

    // coord line: "in [tile] at [player]" once inside a tile, else "at [player]"
    const at = v.origin
      ? `in [${v.origin[0]},${v.origin[1]}] at [${v.player[0]},${v.player[1]}]`
      : `at [${v.player[0]},${v.player[1]}]`
    // hover shows the pending cost (lighter); committing darkens it until it completes
    let action = null
    if (pending) {
      // remaining cost, counting down live as the action runs (spent = landed steps + partial)
      const done = pending.idx * pending.stepCostMin + inflight
      const remaining = Math.max(0, pending.steps * pending.stepCostMin - done)
      action = { text: `+${remaining} ${pending.verb} [${pending.target[0]},${pending.target[1]}]`, committed: true }
    } else if (hovered && hoverPath) action = { text: `+${Math.round(pathCost(hoverPath))} walking to [${hovered[0]},${hovered[1]}]`, committed: false }
    else if (hovered && isFrontier(hovered) && canScout(hovered)) action = { text: `+${Math.round(scoutCost())} scouting [${hovered[0]},${hovered[1]}]`, committed: false }
    else if (exitHover >= 0) {
      const t = exitTarget(exitHover)
      const known = parentOf().tile.discovered.has(key(t))
      if (!known) {
        action = { text: `+${Math.round(discoverEdgeCost())} discovering [${t[0]},${t[1]}]`, committed: false }
      } else {
        // clicking walks to the edge and parks (free); the slide cost shows once parked
        const best = bestPathToEdge(exitHover)
        const c = best ? (best.length - 1) * stepCost() : 0
        action = best ? { text: `+${Math.round(c)} to the [${t[0]},${t[1]}] edge`, committed: false } : null
      }
    }
    timeline.draw(ctx, L, ink, { day, used: spent, reserved, free: liveEnergy - reserved, at, action, expanded: clockExpanded, homeButtons: ["go home", "rest and resume"] })

    // replay play/stop button — only on the expanded clock
    if (clockExpanded) {
      const pb = timeline.playButton(L)
      ctx.fillStyle = ink
      ctx.globalAlpha = replaying || log.length ? 0.9 : 0.25
      if (replaying) {
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

  doEnterHome() // the game opens inside the home safe space (the new default view)

  const screen = {
    id: "hexgrid",
    enter,
    leave,
    onPointerMove,
    onPointerDown,
    onPointerUp,
    onDoubleClick,
    draw
  }
  return screen
}

// The player: a regular hexagon (same shape as a grid tile, half its width) with
// a filled background (hides the trail under it) plus three inner lines from
// alternating vertices to the center — reads as an iso cube.
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

export function drawCube(ctx, cx, cy, size, ink, surface, startDeg, invert = false) {
  const r = size * 0.5 // half the width of a grid tile
  const c = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i + startDeg)
    c.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  // opaque background
  ctx.beginPath()
  c.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])))
  ctx.closePath()
  ctx.globalAlpha = 1
  ctx.fillStyle = surface
  ctx.fill()
  // outline
  ctx.strokeStyle = ink
  ctx.lineWidth = 1.5
  ctx.lineJoin = "round"
  ctx.lineCap = "round"
  ctx.stroke()
  // inner edges: three alternating vertices → center. The default set reads as a solid
  // cube; the inverted set reads as an open cube / floor (the home-centre special tile).
  for (const i of invert ? [1, 3, 5] : [0, 2, 4]) {
    ctx.beginPath()
    ctx.moveTo(c[i][0], c[i][1])
    ctx.lineTo(cx, cy)
    ctx.stroke()
  }
}

// ── single edge-mesh construction ────────────────────
function buildEdges() {
  const seen = new Set()
  const out = []
  for (const [q, r] of mapHexes()) {
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
  return q1 < q2 || (q1 === q2 && r1 <= r2)
    ? `${q1},${r1}|${q2},${r2}`
    : `${q2},${r2}|${q1},${r1}`
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

// Every axial coord within RINGS of the center.
function mapHexes() {
  return Hex.range(RINGS)
}

// Cube distance from the center, over an axial pair.
function hexDistance(q, r) {
  return Hex.length([q, r])
}

// Fractional axial → nearest hex; kept as {q, r} for pixelToHex's callers.
function hexRound(qf, rf) {
  const [q, r] = Hex.round(qf, rf)
  return { q, r }
}
