// Invariant tests for the sim core. Deliberately pinned to INVARIANTS, not to
// tunable numbers — the energy model will keep moving; these should survive it.
//
//   node --test test/

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  createSim,
  SUPER_TO_PARENT_DIR,
  EDGE_CENTER,
  edgeTilesInto,
  superIndexOf,
  isSeamHex,
  seamLobesOf,
  gateEdgeFor,
  GATE_EDGE,
  SUPER,
  RINGS,
  SEAM_RING,
  VIEW_RING,
  GATE_TILE,
  BOARD_TILES,
  ENERGY_START,
  spiralOrder,
  NIBBLE_TYPES
} from "../lib/sim.js"
import { DIRS } from "../lib/world.js"
import * as Hex from "../lib/hex.js"

// Seeded PRNG so failures reproduce.
const makeRng = seed => () => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 2 ** 32)
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)]

// ── topology tables ──────────────────────────────────
test("super→parent-DIR is a bijection for both parities", () => {
  for (const table of SUPER_TO_PARENT_DIR) {
    assert.equal(new Set(table).size, 6, `not a bijection: ${table}`)
  }
})

test("super→parent-DIR matches the verified mapping (flat child, RINGS=4)", () => {
  // Verified by hand 2026-07-01 (recorded when children sat at odd depth, i.e.
  // FLAT child / POINTY parent): super 0→[1,0] 1→[0,1] 2→[-1,1] 3→[-1,0] 4→[0,-1] 5→[1,-1]
  const expected = [
    [1, 0],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [0, -1],
    [1, -1]
  ]
  const flat = SUPER_TO_PARENT_DIR[1] // parity 1 = flat child
  flat.forEach((dirIdx, i) => {
    assert.deepEqual([DIRS[dirIdx].q, DIRS[dirIdx].r], expected[i], `super ${i}`)
  })
  // The pointy-child table is the same bijection rotated one super position
  // (the super lattice sits 30° differently against a pointy interior).
  const pointy = SUPER_TO_PARENT_DIR[0]
  pointy.forEach((dirIdx, i) => {
    assert.equal(dirIdx, flat[(i + 5) % 6], `pointy super ${i} should match flat super ${(i + 5) % 6}`)
  })
})

test("every edge-centre tile borders its edge", () => {
  for (const parity of [0, 1]) {
    for (let i = 0; i < 6; i++) {
      const c = EDGE_CENTER[parity][i]
      assert.ok(c, `edge ${i} parity ${parity} has no centre`)
      assert.ok(
        edgeTilesInto(i).some(t => t[0] === c[0] && t[1] === c[1]),
        `centre ${c} not on edge ${i}`
      )
    }
  }
})

test("superIndexOf is safe off the lattice and covers all six boards", () => {
  assert.equal(superIndexOf(100, 100), -1) // far away → -1, never a crash
  SUPER.forEach(([q, r], i) => assert.equal(superIndexOf(q, r), i))
})

test("the seam is exactly one tile thick and partitions cleanly", () => {
  // my seam ring: every ring-(RINGS+1) hex is seam (side or junction), owned by no board
  let side = 0
  let junction = 0
  for (const h of Hex.ring([0, 0], SEAM_RING)) {
    assert.ok(isSeamHex(h), `ring-${SEAM_RING} hex ${h} is not seam`)
    assert.equal(superIndexOf(h[0], h[1]), -1, `seam hex ${h} owned by a board`)
    const lobes = seamLobesOf(h)
    if (lobes.length === 1) side++
    else if (lobes.length === 2) junction++
    else assert.fail(`seam hex ${h} has ${lobes.length} lobes`)
  }
  assert.equal(side, 24) // 4 side tiles per shared edge
  assert.equal(junction, 6) // 1 junction tile per parent vertex
  // interiors never touch: no interior hex is adjacent to a neighbour's interior
  for (const h of Hex.ring([0, 0], RINGS)) {
    for (const n of Hex.neighbors(h)) {
      assert.ok(superIndexOf(n[0], n[1]) === -1 || Hex.length(n) <= RINGS, `boards touch at ${h}→${n}`)
    }
  }
})

// ── fuzzing helpers ──────────────────────────────────
// Enumerate currently-valid actions the UI could produce. The field is the
// interior, the seam, and the neighbours' facing rows; every hex is scouted /
// moved-onto alike (moving onto a neighbour's tile crosses).
function candidates(sim) {
  const out = []
  const v = sim.view()
  for (const d of Hex.range(VIEW_RING)) {
    const h = [v.player[0] + d[0], v.player[1] + d[1]]
    if (!sim.kindOf(h)) continue
    if (sim.canMove(h) && !Hex.equals(h, v.player)) out.push({ type: "move", target: h })
    else if (sim.isFrontier(h) && sim.canScout(h)) out.push({ type: "scout", target: h })
  }
  // retrace moves carry their explicit route in the log (the `via` form)
  for (let i = 0; i < v.trail.length - 1; i++) {
    const via = sim.retraceRoute(v.trail[i])
    if (via) out.push({ type: "move", target: v.trail[i], via })
  }
  if (sim.canEnter()) out.push({ type: "enter" })
  if (v.tile.safe && Hex.equals(v.player, [0, 0])) out.push({ type: "rest" })
  return out
}

// Serializable signature of the whole world tree (discovery, edges, props).
function worldSig(tile, path = "root", out = []) {
  out.push({
    path,
    discovered: [...tile.discovered].sort(),
    seams: [...tile.seamDiscovered].sort(),
    reached: [...tile.reachedEdges].sort(),
    safe: tile.safe,
    walls: Object.entries(tile.walls)
      .filter(([, b]) => b)
      .sort(),
    seamWalls: Object.entries(tile.seamWalls)
      .filter(([, b]) => b)
      .sort(),
    gate: tile.gate || null,
    gateOpen: !!tile.gateOpen
  })
  for (const k of Object.keys(tile.children).sort()) worldSig(tile.children[k], path + "/" + k, out)
  return out
}

// Discover the whole home board (free inside the safe space) — the gate's
// opening condition. Random scout-first walk; deterministic per seed.
function clearHome(sim, rng) {
  const home = sim.view().tile
  for (let guard = 0; guard < 4000 && home.discovered.size < BOARD_TILES; guard++) {
    const opts = candidates(sim)
    const scouts = opts.filter(o => o.type === "scout")
    if (scouts.length) {
      sim.dispatch(pick(rng, scouts))
      continue
    }
    const moves = opts.filter(o => o.type === "move")
    if (!moves.length) break
    sim.dispatch(pick(rng, moves))
  }
  assert.equal(home.discovered.size, BOARD_TILES, "failed to clear the home board")
  return home
}

function stateSig(sim) {
  const v = sim.view()
  const p = sim.parentOf()
  return JSON.stringify({
    energy: Math.round(sim.energy() * 1e6),
    day: sim.day(),
    depth: sim.depth(),
    player: v.player,
    entry: v.entry,
    trail: v.trail,
    parentPlayer: p.player,
    parentTrail: p.trail,
    world: worldSig(sim.root())
  })
}

// Fuzz a session: dispatch `steps` random valid actions, asserting invariants
// after every one. Picks the action TYPE first (uniformly among available
// types), so rare transitions — park, slide, discoverEdge — get exercised
// instead of drowning in the 40-odd move candidates.
function fuzz(sim, rng, steps, { allowRest = true } = {}) {
  const seen = new Set()
  for (let n = 0; n < steps; n++) {
    const opts = candidates(sim)
    if (allowRest && rng() < 0.03) opts.push({ type: rng() < 0.5 ? "goHome" : "restResume" })
    if (!opts.length) {
      assert.ok(sim.dispatch({ type: "goHome" }).ok)
      continue
    }
    const types = [...new Set(opts.map(o => o.type))]
    const type = pick(rng, types)
    const a = pick(rng, opts.filter(o => o.type === type))
    seen.add(a.type)
    if (a.type === "move") {
      const tb = sim.boardHexOf(a.target)
      const pb = sim.boardHexOf(sim.view().player)
      if (tb && (!pb || tb[0] !== pb[0] || tb[1] !== pb[1])) seen.add("cross")
    }
    const sizeBefore = sim.view().tile.discovered.size
    const r = sim.dispatch(a)
    // restResume legitimately rejects when the way back out isn't affordable
    if (a.type === "restResume" && !r.ok) continue
    assert.ok(r.ok, `enumerated action rejected: ${JSON.stringify(a)} (${r.reason})`)
    // Invariant 1: energy never negative, never above the refill.
    assert.ok(sim.energy() > -1e-9, `energy went negative (${sim.energy()}) after ${a.type}`)
    assert.ok(sim.energy() <= ENERGY_START + 1e-9, `energy above start after ${a.type}`)
    // Invariant 2: never strandable — outside safe tiles the reserve stays affordable.
    if (!sim.view().tile.safe) {
      assert.ok(
        sim.returnCost() <= sim.energy() + 1e-9,
        `stranded: reserve ${sim.returnCost()} > energy ${sim.energy()} after ${a.type}`
      )
    }
    // Invariant 3: the discovery ratchet only grows.
    assert.ok(sim.view().tile.discovered.size >= Math.min(sizeBefore, sim.view().tile.discovered.size), "ratchet")
    // Invariant 4: the trail is a connected walk of legal move segments —
    // adjacent steps or diagonal leaps; no gaps, ever
    const diagLeap = (p, q2) =>
      DIRS.some((d, i3) => {
        const e = DIRS[(i3 + 1) % 6]
        return p[0] + d.q + e.q === q2[0] && p[1] + d.r + e.r === q2[1]
      })
    const tr = sim.view().trail
    for (let i2 = 1; i2 < tr.length; i2++) {
      const dd = Hex.distance(tr[i2 - 1], tr[i2])
      assert.ok(dd === 1 || (dd === 2 && diagLeap(tr[i2 - 1], tr[i2])), `trail gap after ${a.type}`)
    }
    // and an immediate there-and-back must have popped, not appended
    if (tr.length >= 3) {
      const [a3, , c3] = [tr[tr.length - 3], tr[tr.length - 2], tr[tr.length - 1]]
      assert.ok(!Hex.equals(a3, c3), `unpopped backtrack after ${a.type}`)
    }
  }
  return seen
}

// ── invariants under random play ─────────────────────
test("energy, reserve and ratchet invariants hold under random play", () => {
  const covered = new Set()
  for (const seed of [1, 2, 42, 1337, 99991]) {
    const sim = createSim()
    clearHome(sim, makeRng(seed)) // open the gate so the fuzz can leave home
    for (const t of fuzz(sim, makeRng(seed), 400)) covered.add(t)
  }
  // The fuzz must actually cross out of the safe home, or the run proves nothing.
  for (const must of ["move", "scout", "cross"]) {
    assert.ok(covered.has(must), `fuzz never exercised '${must}'`)
  }
})

// ── the gate: the seed angle's seam tile, closed until home is cleared ──
test("the gate opens on clearing home, and is the only way through the walls", () => {
  assert.equal(Hex.length(GATE_TILE), SEAM_RING, "gate does not open onto the seam ring")
  assert.ok(isSeamHex(GATE_TILE), "gate does not open onto a seam tile")
  assert.equal(Hex.length(Hex.fromKey(GATE_EDGE.k)), RINGS, "doorstep is not a border tile")
  assert.deepEqual(gateEdgeFor(1), GATE_EDGE)

  const sim = createSim()
  const home = sim.view().tile
  assert.equal(home.gateOpen, false, "gate open at birth")
  // sealed: nothing outside the board is reachable
  for (const o of candidates(sim)) {
    if (o.target) assert.ok(Hex.length(o.target) <= RINGS, `non-interior target ${o.target} while sealed`)
  }

  clearHome(sim, makeRng(5))
  assert.equal(home.gateOpen, true, "gate did not open on clearing the board")

  // stand on the doorstep: only the gate EDGE is passable through the walls
  const doorstep = Hex.fromKey(GATE_EDGE.k)
  assert.ok(sim.dispatch({ type: "move", target: doorstep }).ok, "cannot reach the doorstep")
  assert.ok(sim.canScout(GATE_TILE), "open gate not scoutable")
  for (const n of Hex.neighbors(doorstep)) {
    if (Hex.length(n) === SEAM_RING && !Hex.equals(n, GATE_TILE)) {
      assert.equal(sim.canScout(n), false, `sealed seam ${n} is scoutable`)
    }
  }

  // and through: scout the gate, step onto it, cross to the neighbour
  assert.ok(sim.dispatch({ type: "scout", target: GATE_TILE }).ok)
  assert.ok(sim.dispatch({ type: "move", target: GATE_TILE }).ok)
  const nbr = Hex.neighbors(GATE_TILE).find(n => superIndexOf(n[0], n[1]) >= 0)
  assert.ok(sim.dispatch({ type: "scout", target: nbr }).ok)
  assert.ok(sim.dispatch({ type: "move", target: nbr }).ok)
  assert.notEqual(sim.view().tile, home, "did not cross through the gate")
})

// ── crossing: seam in between, one global world ───
test("crossing steps over the seam onto the exact tile and discovers the parent tile", () => {
  const sim = createSim()
  const rng = makeRng(777)
  clearHome(sim, rng) // the gate only opens on a cleared board
  // wander until a crossing is available (through the gate)
  let crossTarget = null
  for (let n = 0; n < 800 && !crossTarget; n++) {
    const opts = candidates(sim)
    crossTarget =
      opts.find(o => {
        if (o.type !== "move") return false
        const tb = sim.boardHexOf(o.target)
        return tb && (tb[0] !== 0 || tb[1] !== 0)
      })?.target || null
    if (crossTarget) break
    const scouts = opts.filter(o => o.type === "scout")
    const moves = opts.filter(o => o.type === "move")
    const a = scouts.length && rng() < 0.7 ? pick(rng, scouts) : moves.length ? pick(rng, moves) : null
    if (!a) break
    sim.dispatch(a)
  }
  assert.ok(crossTarget, "never found a crossing out of the home safe space")

  const home = sim.view().tile
  const targetBoard = sim.boardHexOf(crossTarget)
  const route = sim.routeTo(crossTarget)
  const seamHex = route[route.length - 2]
  assert.equal(sim.kindOf(seamHex), "seam", "the hop before a crossing must be seam ground")
  assert.equal(
    sim.parentOf().tile.discovered.has(`${targetBoard[0]},${targetBoard[1]}`),
    false,
    "parent tile known too early"
  )

  const trailBefore = sim.view().trail.length
  assert.ok(sim.dispatch({ type: "move", target: crossTarget }).ok, "crossing rejected")
  // one world: the player IS the target — no translation, no re-framing
  assert.deepEqual(sim.view().player, crossTarget)
  assert.notEqual(sim.view().tile, home, "board bookkeeping did not follow")
  assert.equal(sim.depth(), 2, "crossing must not change depth")
  assert.ok(sim.parentOf().tile.discovered.has(`${targetBoard[0]},${targetBoard[1]}`), "parent tile not discovered")
  assert.deepEqual(sim.parentOf().player, targetBoard, "parent player did not step")
  // the trail is continuous through the crossing (grew by the walked route)
  assert.ok(sim.view().trail.length > trailBefore, "trail did not continue through the crossing")
  assert.ok(sim.isDiscovered(seamHex), "seam discovery lost")

  // and straight back: the same coordinates, the same world
  const back = route[0]
  const via = sim.retraceRoute(back)
  assert.ok(via, "cannot retrace back across the crossing")
  assert.ok(sim.dispatch({ type: "move", target: back, via }).ok)
  assert.deepEqual(sim.view().player, back)
  // walk home to its centre — bookkeeping lands back on the home board
  assert.ok(sim.dispatch({ type: "move", target: [0, 0] }).ok, "cannot walk back to the home centre")
  assert.equal(sim.view().tile, home, "board bookkeeping did not follow back")
})

// The reported stranding, global edition: leave home, wander the seam network
// anywhere, and home must stay addressable — same coordinates, no frames.
test("the seam network is fully roamable and home stays reachable from any side", () => {
  const sim = createSim()
  const rng = makeRng(9)
  clearHome(sim, rng)
  const home = sim.view().tile
  const doorstep = Hex.fromKey(GATE_EDGE.k)

  // out through the gate onto the seam
  assert.ok(sim.dispatch({ type: "move", target: doorstep }).ok)
  assert.ok(sim.dispatch({ type: "scout", target: GATE_TILE }).ok)
  assert.ok(sim.dispatch({ type: "move", target: GATE_TILE }).ok)
  assert.equal(sim.kindOf(sim.view().player), "seam")

  // walk the seam AROUND home — scout ahead, step, repeat; never enter a board
  let walked = 0
  for (let guard = 0; guard < 40 && walked < 8; guard++) {
    const v = sim.view()
    const next = Hex.neighbors(v.player).find(
      n =>
        sim.kindOf(n) === "seam" &&
        !v.trail.some(t2 => Hex.equals(t2, n)) &&
        (sim.isDiscovered(n) || sim.canScout(n))
    )
    if (!next) break
    if (!sim.isDiscovered(next)) assert.ok(sim.dispatch({ type: "scout", target: next }).ok)
    if (!sim.canMove(next)) break // the honest reserve ends the outing — not a bug, the budget
    assert.ok(sim.dispatch({ type: "move", target: next }).ok, "seam walk rejected")
    assert.equal(sim.kindOf(sim.view().player), "seam", "walked off the seam")
    walked++
  }
  assert.ok(walked >= 6, `seam walk stalled after ${walked} steps`)

  // rest where we stand (a day on the road), then walk straight back in —
  // same coordinates, no frames
  assert.ok(sim.dispatch({ type: "restResume" }).ok, "cannot rest on the seam")
  assert.ok(sim.canMove(GATE_TILE), "gate seam unreachable from out on the network")
  assert.ok(sim.dispatch({ type: "move", target: GATE_TILE }).ok)
  assert.ok(sim.dispatch({ type: "move", target: doorstep }).ok, "gate edge refused re-entry")
  assert.equal(sim.view().tile, home)
  assert.equal(sim.kindOf(sim.view().player), "in")
})

// ── world derivation: the key inscribed on the home board ─────────
test("the spiral covers the board once, centre-out, ring by ring", () => {
  const spiral = spiralOrder()
  assert.equal(spiral.length, BOARD_TILES)
  assert.deepEqual(spiral[0], [0, 0])
  assert.equal(new Set(spiral.map(Hex.key)).size, BOARD_TILES, "spiral revisits a tile")
  // ring k occupies indices 1+3k(k-1) .. 3k(k+1), and every tile is ON ring k
  for (let k = 1; k <= RINGS; k++) {
    for (let i = 1 + 3 * k * (k - 1); i <= 3 * k * (k + 1); i++) {
      assert.equal(Hex.length(spiral[i]), k, `spiral index ${i} off ring ${k}`)
    }
  }
  // consecutive intra-ring entries are adjacent — the key reads as one walk
  for (let i = 2; i < spiral.length; i++) {
    if (Hex.length(spiral[i]) === Hex.length(spiral[i - 1]))
      assert.equal(Hex.distance(spiral[i - 1], spiral[i]), 1, `spiral gap at ${i}`)
  }
})

test("a pubkey inscribes the home board and binds the save", () => {
  const pk = "f0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd"
  const sim = createSim({ pubkey: pk })
  // nibble 0 = 'f' = spring at the centre; nibble 1 = '0' = meadow at [0,-1]
  assert.equal(sim.typeNameAt([0, 0]), "spring")
  assert.equal(sim.typeNameAt([0, -1]), "meadow")
  assert.equal(sim.typeNameAt([1, -1]), NIBBLE_TYPES[1]) // nibble 2 → spiral index 2
  // the inscription is home-only: a keyless sim stays plain
  assert.equal(createSim().typeNameAt([0, 0]), "plain")
  // home is safe — derived types must not change what anything charges there
  const e0 = sim.energy()
  assert.ok(sim.dispatch({ type: "scout", target: [0, -1] }).ok)
  assert.ok(sim.dispatch({ type: "move", target: [0, -1] }).ok)
  assert.equal(sim.energy(), e0, "derived types must charge nothing inside the safe home")
  const save = sim.serialize()
  assert.equal(save.world.pubkey, pk)
  assert.ok(createSim({ pubkey: pk }).hydrate(JSON.parse(JSON.stringify(save))).ok)
  assert.equal(createSim().hydrate(save).ok, false, "a keyless sim must refuse an inscribed world's save")
})

// The chosen angle is per-world: it places the gate and rides the save stamp.
test("a chosen angle places the gate and binds the save to its world", () => {
  const a = 90
  const sim = createSim({ angle: a })
  assert.equal(sim.angle(), a)
  const edge = gateEdgeFor(a)
  sim.dispatch({ type: "clearBoard" }) // clearing home opens the gate wherever it fell
  assert.ok(sim.dispatch({ type: "move", target: Hex.fromKey(edge.k) }).ok, "doorstep unreachable")
  assert.ok(sim.dispatch({ type: "scout", target: edge.seam }).ok)
  assert.ok(sim.dispatch({ type: "move", target: edge.seam }).ok, "the gate did not open at the chosen angle")
  const save = sim.serialize()
  assert.equal(save.world.angle, a)
  assert.ok(createSim({ angle: a }).hydrate(JSON.parse(JSON.stringify(save))).ok)
  assert.equal(createSim().hydrate(save).ok, false, "a default-angle sim must refuse another world's save")
})

// ── persistence: the save IS the log ─────────────────
test("serialize → hydrate rebuilds the same world across days", () => {
  const sim = createSim()
  clearHome(sim, makeRng(31))
  fuzz(sim, makeRng(31), 150) // allowRest on: crosses day boundaries via rest/goHome/restResume
  const raw = JSON.stringify(sim.serialize()) // through JSON, exactly like localStorage
  assert.ok(sim.day() > 1, "the fuzz never crossed a day — the test proves nothing")

  const sim2 = createSim()
  const r = sim2.hydrate(JSON.parse(raw))
  assert.ok(r.ok, `hydrate rejected: ${r.reason}`)
  assert.equal(stateSig(sim2), stateSig(sim), "hydrated world diverged from the live one")
  assert.deepEqual(sim2.serialize(), JSON.parse(raw), "re-serialize drifted")

  // guards: dirty sims and mismatched stamps are refused
  assert.equal(sim.hydrate(JSON.parse(raw)).ok, false, "hydrate onto a dirty sim must refuse")
  const bad = JSON.parse(raw)
  bad.world.rules = -1
  assert.equal(createSim().hydrate(bad).ok, false, "a rules mismatch must refuse")
})

// The leap: the DIAGONAL — the tile beyond the edge two adjacent neighbours
// share — for ONE step's price, over known unwalled ground. Straight through
// a tile's CENTRE is not a leap; the crack between tiles is the road.
test("the leap jumps the diagonal for one step's price and retraces elastically", () => {
  const sim = createSim()
  const rng = makeRng(7)
  clearHome(sim, rng)
  assert.ok(sim.dispatch({ type: "move", target: [0, 0] }).ok) // recentre; trail resets at the entry

  // in the cleared home: the router takes the diagonal leap, priced as one step
  const land = [DIRS[0].q + DIRS[1].q, DIRS[0].r + DIRS[1].r]
  assert.ok(sim.canMove(land), "leap landing not movable")
  const route = sim.routeTo(land)
  assert.equal(route.length, 2, "router did not take the leap")
  assert.equal(sim.pathCost(route), sim.stepCostAt(land), "a leap must price as ONE step onto the landing")
  assert.ok(sim.dispatch({ type: "move", target: land }).ok)
  assert.equal(sim.view().trail.length, 2, "the trail records the landing only — the flankers are jumped over")

  // leaping back pops the trail like any elastic retrace
  const back = sim.retraceRoute([0, 0])
  assert.ok(back, "leap segment refused the retrace")
  assert.equal(back.length, 2)
  assert.ok(sim.dispatch({ type: "move", target: [0, 0], via: back }).ok)
  assert.equal(sim.view().trail.length, 1, "the retraced leap did not pop")

  // collinear through a tile's centre is NOT a leap: 2 straight-out takes 2 steps
  const across = [2 * DIRS[0].q, 2 * DIRS[0].r]
  assert.equal(sim.routeTo(across).length, 3, "collinear 2-out must walk through the middle")

  // ...and neither is a seam run (seam tiles line up collinear): no seam leaps
  const doorstep = Hex.fromKey(GATE_EDGE.k)
  assert.ok(sim.dispatch({ type: "move", target: doorstep }).ok)
  assert.ok(sim.dispatch({ type: "scout", target: GATE_TILE }).ok)
  assert.ok(sim.dispatch({ type: "move", target: GATE_TILE }).ok)
  const at = sim.view().player
  const d = [0, 1, 2, 3, 4, 5].find(i => {
    const m = [at[0] + DIRS[i].q, at[1] + DIRS[i].r]
    const l = [at[0] + 2 * DIRS[i].q, at[1] + 2 * DIRS[i].r]
    return sim.kindOf(m) === "seam" && sim.kindOf(l) === "seam"
  })
  assert.notEqual(d, undefined, "no straight seam run off the gate tile")
  const mid = [at[0] + DIRS[d].q, at[1] + DIRS[d].r]
  const far = [at[0] + 2 * DIRS[d].q, at[1] + 2 * DIRS[d].r]
  assert.ok(sim.dispatch({ type: "scout", target: mid }).ok)
  assert.ok(sim.dispatch({ type: "move", target: mid }).ok)
  assert.ok(sim.dispatch({ type: "scout", target: far }).ok)
  assert.ok(sim.dispatch({ type: "move", target: at, via: sim.retraceRoute(at) }).ok) // back to the gate tile
  assert.equal(sim.routeTo(far).length, 3, "a collinear seam run must walk, not leap")
})

// The depletion regression: with the budget spent down to the reserve, the
// trail home must stay walkable — every trail tile behind the player is a
// valid retrace target, and the full retrace lands home with energy ≥ 0.
// (The old approximate reserve mispriced the way back, so at depletion even
// the honest retrace was rejected and hover/backtrack died.)
test("retracing home stays affordable at full depletion", () => {
  const sim = createSim()
  const rng = makeRng(5)
  clearHome(sim, rng)
  const doorstep = Hex.fromKey(GATE_EDGE.k)
  assert.ok(sim.dispatch({ type: "move", target: doorstep }).ok)
  assert.ok(sim.dispatch({ type: "scout", target: GATE_TILE }).ok)
  assert.ok(sim.dispatch({ type: "move", target: GATE_TILE }).ok)

  // spend the day walking outward along the seam until nothing outward is affordable
  for (let guard = 0; guard < 60; guard++) {
    const v = sim.view()
    const next = Hex.neighbors(v.player).find(
      n => sim.kindOf(n) === "seam" && !v.trail.some(t => Hex.equals(t, n)) && (sim.isDiscovered(n) || sim.canScout(n))
    )
    if (!next) break
    if (!sim.isDiscovered(next) && !sim.dispatch({ type: "scout", target: next }).ok) break
    if (!sim.canMove(next)) break
    assert.ok(sim.dispatch({ type: "move", target: next }).ok)
  }
  const v = sim.view()
  assert.ok(sim.kindOf(v.player) === "seam", "never made it out onto the seam")
  assert.ok(sim.energy() < ENERGY_START / 2, "the outing never depleted the budget")

  // THE regression: depletion must never kill the way home. (With the leap,
  // the reserve prices the LEAP route — the full walking retrace may honestly
  // exceed it; the UI then falls back to the shortest route. What must always
  // hold: home is clickable and the walk lands with energy intact.)
  assert.ok(sim.canMove(v.entry), "home unreachable at depletion")
  assert.ok(sim.dispatch({ type: "move", target: v.entry }).ok, "the walk home was rejected")
  assert.ok(sim.energy() >= 0, "walking home overdrew the budget")
  assert.ok(Hex.equals(sim.view().player, sim.view().entry), "did not land back on the entry")
})

test("seam scouting respects the reserve outside the safe space", () => {
  let checked = 0
  for (const seed of [11, 222, 3333, 777]) {
    const sim = createSim()
    const rng = makeRng(seed)
    clearHome(sim, rng)
    for (let n = 0; n < 900; n++) {
      const opts = candidates(sim)
      if (!opts.length) break
      const type = pick(rng, [...new Set(opts.map(o => o.type))])
      sim.dispatch(pick(rng, opts.filter(o => o.type === type)))
      const v = sim.view()
      if (v.tile.safe) continue
      for (const d of [0, 1, 2, 3, 4, 5]) {
        const n2 = [v.player[0] + DIRS[d].q, v.player[1] + DIRS[d].r]
        if (sim.kindOf(n2) !== "seam" || !sim.isFrontier(n2)) continue
        const affordable = sim.scoutCostAt(n2) + sim.returnCost() <= sim.energy()
        const r = sim.dispatch({ type: "scout", target: n2 })
        assert.equal(r.ok, affordable, "seam scout affordability mismatch")
        checked++
        break
      }
    }
  }
  assert.ok(checked > 0, "fuzz never reached a non-safe seam frontier")
})

test("the discovery ratchet only ever grows across a session", () => {
  const sim = createSim()
  const rng = makeRng(4242)
  let last = 0
  for (let n = 0; n < 200; n++) {
    const opts = candidates(sim)
    if (!opts.length) break
    sim.dispatch(pick(rng, opts))
    const total = worldSig(sim.root()).reduce((s, t) => s + t.discovered.length + t.reached.length, 0)
    assert.ok(total >= last, "world discovery shrank")
    last = total
  }
})

// ── replay reproduces the live day exactly ───────────
test("replay == live for the in-progress day", () => {
  for (const seed of [7, 21, 555, 8080, 60321]) {
    const sim = createSim()
    fuzz(sim, makeRng(seed), 120, { allowRest: true })
    const before = stateSig(sim)
    const log = sim.log().slice()
    sim.beginReplay()
    for (const a of log) {
      const r = sim.apply(a)
      assert.ok(r.ok, `replayed action rejected (seed ${seed}): ${JSON.stringify(a)} (${r.reason})`)
    }
    sim.endReplay()
    assert.equal(stateSig(sim), before, `replay diverged (seed ${seed})`)
  }
})

test("replay == live for a day started away from home (rest-and-resume regression)", () => {
  const sim = createSim()
  const rng = makeRng(2718)
  fuzz(sim, makeRng(31), 60, { allowRest: false })
  assert.ok(sim.dispatch({ type: "restResume" }).ok) // new day starts in the field
  fuzz(sim, rng, 40, { allowRest: false })
  const before = stateSig(sim)
  const log = sim.log().slice()
  sim.beginReplay()
  for (const a of log) assert.ok(sim.apply(a).ok, "replay action failed")
  sim.endReplay()
  assert.equal(stateSig(sim), before, "replay of a rest-and-resume day diverged")
})

test("interrupted replay + fast-forward lands on the live end state", () => {
  const sim = createSim()
  fuzz(sim, makeRng(555), 100, { allowRest: false })
  const before = stateSig(sim)
  const log = sim.log().slice()
  sim.beginReplay()
  // replay only half, then fast-forward the rest (what pressing stop does)
  const half = Math.floor(log.length / 2)
  for (let i = 0; i < half; i++) assert.ok(sim.apply(log[i]).ok)
  for (let i = half; i < log.length; i++) assert.ok(sim.apply(log[i]).ok)
  sim.endReplay()
  assert.equal(stateSig(sim), before, "fast-forwarded replay diverged")
})

// ── validation: the sim rejects what the UI merely hides ────────────
test("invalid actions are rejected, not crashes", () => {
  const sim = createSim()
  assert.equal(sim.apply({ type: "exit", superIdx: -1 }).ok, false)
  assert.equal(sim.apply({ type: "move", target: [3, -3] }).ok, false) // undiscovered
  assert.equal(sim.apply({ type: "move", target: [20, -10] }).ok, false) // beyond the view
  assert.equal(sim.apply({ type: "scout", target: [0, -5] }).ok, false) // seam, not adjacent
  assert.equal(sim.apply({ type: "park", superIdx: 0 }).ok, false) // retired action
  assert.equal(sim.apply({ type: "slide", superIdx: 0 }).ok, false) // retired action
  assert.equal(sim.apply({ type: "bogus" }).ok, false)
  assert.equal(sim.kindOf([100, 100]), null)
})

test("dispatch is refused during replay", () => {
  const sim = createSim()
  const dots = [...sim.reachableDots()]
  assert.ok(dots.length > 0)
  const t = dots[0].split(",").map(Number)
  assert.ok(sim.dispatch({ type: "scout", target: t }).ok)
  sim.beginReplay()
  assert.equal(sim.dispatch({ type: "scout", target: t }).ok, false)
  sim.endReplay()
})

test("classification and discovery are global — no frame, no range limit", () => {
  const sim = createSim()
  clearHome(sim, makeRng(9))
  const doorstep = Hex.fromKey(GATE_EDGE.k)
  assert.ok(sim.dispatch({ type: "move", target: doorstep }).ok)
  assert.ok(sim.dispatch({ type: "scout", target: GATE_TILE }).ok)
  assert.ok(sim.dispatch({ type: "move", target: GATE_TILE }).ok)
  const nbr = Hex.neighbors(GATE_TILE).find(n => {
    const b = sim.boardHexOf(n)
    return b && (b[0] !== 0 || b[1] !== 0)
  })
  assert.ok(sim.dispatch({ type: "scout", target: nbr }).ok)
  assert.ok(sim.dispatch({ type: "move", target: nbr }).ok)
  // from the neighbour board, home keeps its one true name — [0,0] is still
  // the home centre, and reads discovered from anywhere
  assert.equal(sim.kindOf([0, 0]), "in")
  assert.ok(sim.isDiscovered([0, 0]), "home centre lost its discovery")
  assert.ok(sim.isDiscovered(GATE_TILE), "gate seam lost its discovery")
  // far empty space is nothing
  assert.equal(sim.kindOf([60, 60]), null)
  assert.equal(sim.isDiscovered([60, 60]), false)
})

test("clearBoard reveals the whole board, opens the gate, and replays cleanly", () => {
  const sim = createSim()
  assert.ok(sim.dispatch({ type: "clearBoard" }).ok)
  const home = sim.view().tile
  assert.equal(home.discovered.size, BOARD_TILES)
  assert.equal(home.gateOpen, true)
  const before = stateSig(sim)
  const log = sim.log().slice()
  sim.beginReplay()
  for (const a of log) assert.ok(sim.apply(a).ok)
  sim.endReplay()
  assert.equal(stateSig(sim), before, "clearBoard day diverged on replay")
})

// ── headlessness ─────────────────────────────────────
test("the sim runs with no DOM (this whole file is the proof)", () => {
  assert.equal(typeof globalThis.document, "undefined")
  const sim = createSim()
  assert.equal(sim.depth(), 2) // starts inside the home safe space
  assert.ok(sim.view().tile.safe)
})
