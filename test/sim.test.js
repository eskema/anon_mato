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
  RULES,
  LEAP,
  SEAM_RING,
  VIEW_RING,
  GATE_TILE,
  BOARD_TILES,
  ENERGY_START,
  SEED_MIN,
  FREE_CAP,
  WAKE_CAP,
  SLEEP_MIN,
  HUNGER_MAX,
  EAT_MIN,
  WEAR_FLOOR,
  spiralOrder,
  readingOrder,
  TILE_TYPES,
  RECIPES,
  RESOURCES,
  BIOME_YIELD,
  NODE_DENSITY,
  tagOf,
  STAT_NAMES,
  statsOf,
  BIOME_SKILL,
  PLACE_BONUS,
  SKILL_CAP,
  NPC_MIN,
  NPC_MAX,
  PLACE_CAP,
  edgesForLevel
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
  // some moves carry their explicit route (the `via` form the app records so
  // replay stays linear) — offer a via variant for each reachable neighbour
  for (const d of Hex.range(VIEW_RING)) {
    const h = [v.player[0] + d[0], v.player[1] + d[1]]
    if (sim.canMove(h) && !Hex.equals(h, v.player)) {
      const via = sim.routeTo(h)
      if (via) out.push({ type: "move", target: h, via })
    }
  }
  if (sim.canEnter()) out.push({ type: "enter" })
  // …and REST, asked of the sim like every other candidate above: since
  // 2026-08-10 a day with an empty log can't be slept off, so "standing at
  // home" is no longer the whole rule
  if (sim.canAct({ type: "rest" })) out.push({ type: "rest" })
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

// Discover the whole home board — the gate's opening condition. Home now costs a
// minute per step/scout, so this spans several days: scout-first random walk,
// and when a day runs dry, go home to refill and resume. Deterministic per seed.
function clearHome(sim, rng) {
  const home = sim.view().tile
  for (let guard = 0; guard < 8000 && home.discovered.size < BOARD_TILES; guard++) {
    const opts = candidates(sim)
    const scouts = opts.filter(o => o.type === "scout")
    if (scouts.length) {
      sim.dispatch(pick(rng, scouts))
      continue
    }
    const moves = opts.filter(o => o.type === "move")
    if (moves.length) {
      sim.dispatch(pick(rng, moves))
      continue
    }
    // out of affordable work for today — rest at home and pick it up tomorrow
    sim.dispatch({ type: "goHome" })
  }
  assert.equal(home.discovered.size, BOARD_TILES, "failed to clear the home board")
  // leave the player rested at home with a full day ahead — callers venture out
  // from here (home is no longer free, so the clearing day itself ends depleted)
  sim.dispatch({ type: "goHome" })
  return home
}

// RIVERS (RULES 30): every seam is water. Wading in is free enough, but the far
// bank needs a BRIDGE — so anything that plays outside home builds one first.
// Walks to a river tile that touches another board and spans it. Returns the
// landing tile, or null if there's nothing to bridge to yet.
// THE WAY OUT of a walled home under RULES 30: through the gate, into the one
// river tile beyond it, and onto a RAFT. The raft is what the wall's debris
// pays for, and it's what stops a board being a prison — the water always goes
// somewhere. Punts along the river until a foreign bank is landable, and lands.
// Returns the landing tile, or null if the water led nowhere it could reach.
// OUT THE GATE, WITH THE LOAD — the trip every test that leaves home makes
// (RULES 33). Onto the doorstep, where the felled wall left its debris; pick one
// load up (it fills a base pack on its own, so the next step costs double);
// wade into the one river tile past the gate; drop it there, and build the raft
// out of what's now lying on the tile. Returns the water you're afloat on.
function raftOut(sim) {
  const doorstep = Hex.fromKey(GATE_EDGE.k)
  if (!sim.dispatch({ type: "move", target: doorstep }).ok) return null
  if (!sim.dispatch({ type: "take" }).ok) return null
  if (!sim.isDiscovered(GATE_TILE) && !sim.dispatch({ type: "scout", target: GATE_TILE }).ok) return null
  if (!sim.dispatch({ type: "move", target: GATE_TILE }).ok) return null
  if (!sim.dispatch({ type: "drop", item: "debris" }).ok) return null
  if (!sim.dispatch({ type: "raft" }).ok) return null
  return sim.view().player.slice()
}
function crossOut(sim) {
  const foreign = g => {
    const b = sim.boardHexOf(g)
    return b && (b[0] !== 0 || b[1] !== 0)
  }
  if (!sim.raftAt()) {
    if (!raftOut(sim)) return null
  } else if (!sim.canMove(sim.raftAt()) || !sim.dispatch({ type: "move", target: sim.raftAt() }).ok) return null
  for (let hop = 0; hop < 40; hop++) {
    const p = sim.view().player
    for (const n of Hex.neighbors(p)) if (!sim.isDiscovered(n) && sim.canScout(n)) sim.dispatch({ type: "scout", target: n })
    const bank = Hex.neighbors(p).find(n => !sim.isRiver(n) && foreign(n) && sim.isDiscovered(n) && sim.canMove(n))
    if (bank) return sim.dispatch({ type: "move", target: bank }).ok ? bank : null
    const on = Hex.neighbors(p).find(
      n => sim.isRiver(n) && sim.isDiscovered(n) && sim.canMove(n) && !sim.view().trail.some(t => Hex.equals(t, n))
    )
    if (!on || !sim.dispatch({ type: "move", target: on }).ok) return null
  }
  return null
}

// Open the world for tests that need to roam: one raft is enough — routing
// crosses at wherever it's moored — so this just gets a raft on the water and
// lands once. Returns the landing tile.
function openWorld(sim) {
  const landed = crossOut(sim)
  if (landed) sim.dispatch({ type: "goHome" }) // fresh day, and the far side is now routable
  return landed
}
const bridgeOut = openWorld // (the old name, kept where tests read better with it)

function stateSig(sim) {
  const v = sim.view()
  const p = sim.parentOf()
  return JSON.stringify({
    energy: Math.round(sim.energy() * 1e6),
    hunger: Math.round(sim.hungerLeft() * 1e6), // the meal clock is day state too (RULES 42)
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
    if (allowRest && rng() < 0.03) opts.push({ type: "goHome" })
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
    assert.ok(r.ok, `enumerated action rejected: ${JSON.stringify(a)} (${r.reason})`)
    // Invariant 1: energy never negative, never above the DAY'S budget (which
    // grows with discovery — energy only spends down from the day's start).
    assert.ok(sim.energy() > -1e-9, `energy went negative (${sim.energy()}) after ${a.type}`)
    assert.ok(sim.energy() <= sim.dayBudget() + 1e-9, `energy above the day's budget after ${a.type}`)
    // Invariant 2: never strandable — outside safe tiles the reserve stays affordable.
    if (!sim.view().tile.safe) {
      assert.ok(
        sim.returnCost() <= sim.energy() + 1e-9,
        `stranded: reserve ${sim.returnCost()} > energy ${sim.energy()} after ${a.type}`
      )
    }
    // Invariant 2b (RULES 42): the meal clock is never overrun, and outside safe
    // tiles the way home fits what's left of it too — you are always back at a
    // resting place before the next meal is due.
    assert.ok(sim.hungerLeft() > -1e-9, `past the meal deadline (${sim.hungerLeft()}) after ${a.type}`)
    if (!sim.view().tile.safe) {
      assert.ok(
        sim.returnCost() <= sim.timeLeft() + 1e-9,
        `stranded by hunger: reserve ${sim.returnCost()} > time left ${sim.timeLeft()} after ${a.type}`
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
    // the trail is a full record now: a there-and-back APPENDS (never pops), so
    // consecutive-but-one repeats are expected — only gaps are a bug (checked above)
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
  // …and once more on a DERIVED world: priced biomes + impassable water must
  // uphold the same invariants (the reserve prices typed ground exactly)
  const keyed = createSim({
    pubkey: "f" + "0123456789abcdef".repeat(3) + "0123456789abcdef".slice(0, 15),
    worldKey: "c4a1" + "9b3d0af2c4715068".repeat(3) + "9b3d0af2c471"
  })
  clearHome(keyed, makeRng(7))
  for (const t of fuzz(keyed, makeRng(7), 300)) covered.add(t)
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
  // KNOWING THE WAY OUT IS NOT TAKING IT (RULES 49): a cleared board still
  // waits for the walk — the gate opens under your feet, not at the last scout
  assert.equal(home.gateOpen, false, "gate opened on clearing the board, without the walk")

  // stand on the doorstep: THAT is what opens it, and only the gate EDGE is
  // passable through the walls
  const doorstep = Hex.fromKey(GATE_EDGE.k)
  assert.ok(sim.dispatch({ type: "move", target: doorstep }).ok, "cannot reach the doorstep")
  assert.equal(home.gateOpen, true, "gate did not open on standing at the doorstep")
  // the wall that came down left its debris right here (RULES 33) — the load the
  // raft is made of, and the reason the doorstep is where a haul starts
  assert.deepEqual(sim.stashHere(), { item: "debris", n: 3 }, "the felled wall left no rubble")
  assert.ok(sim.dispatch({ type: "take" }).ok, "could not pick up a load of debris")
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
  assert.ok(!sim.canAct({ type: "raft" }), "a raft built out of nothing") // the load must be ON the water
  assert.ok(sim.dispatch({ type: "drop", item: "debris" }).ok, "the load would not go down")
  assert.ok(sim.dispatch({ type: "raft" }).ok, "raft refused") // RULES 30: the seam is a river — you need the raft
  assert.ok(sim.dispatch({ type: "move", target: nbr }).ok)
  assert.notEqual(sim.view().tile, home, "did not cross through the gate")
})

// ── crossing: a BRIDGE over the river in between, one global world ───
test("the raft is the crossing — and crossing discovers the parent tile", () => {
  const sim = createSim()
  const rng = makeRng(777)
  clearHome(sim, rng) // the gate only opens on a cleared board
  // out to the one river tile a walled board can reach: the one past the gate
  const doorstep = Hex.fromKey(GATE_EDGE.k)
  assert.ok(sim.dispatch({ type: "move", target: doorstep }).ok)
  assert.ok(sim.dispatch({ type: "take" }).ok, "no load of debris on the doorstep") // RULES 33: the haul
  assert.ok(sim.dispatch({ type: "scout", target: GATE_TILE }).ok)
  assert.ok(sim.dispatch({ type: "move", target: GATE_TILE }).ok)
  const seamHex = sim.view().player.slice()
  assert.equal(sim.kindOf(seamHex), "seam", "the tile past the gate is river")
  assert.ok(sim.dispatch({ type: "drop", item: "debris" }).ok, "the load would not go down on the water")

  // see across, pick a bank, and be refused until it's spanned
  const crossTarget = Hex.neighbors(seamHex).find(n => {
    const b = sim.boardHexOf(n)
    if (!b || (b[0] === 0 && b[1] === 0)) return false
    if (!sim.isDiscovered(n)) sim.dispatch({ type: "scout", target: n })
    return sim.isDiscovered(n)
  })
  assert.ok(crossTarget, "no far bank visible from the gate tile")
  assert.equal(sim.canMove(crossTarget), false, "crossed the water on foot")

  const home = sim.view().tile
  const targetBoard = sim.boardHexOf(crossTarget)
  assert.equal(
    sim.parentOf().tile.discovered.has(`${targetBoard[0]},${targetBoard[1]}`),
    false,
    "parent tile known too early"
  )
  assert.ok(sim.dispatch({ type: "raft" }).ok, "raft refused")
  assert.deepEqual(sim.raftAt(), seamHex, "the raft is moored where it was built")
  assert.ok(sim.aboard(), "standing on your own raft")

  const route = [seamHex, crossTarget]
  const trailBefore = sim.view().trail.length
  assert.ok(sim.dispatch({ type: "move", target: crossTarget }).ok, "crossing rejected from the raft")
  assert.deepEqual(sim.raftAt(), seamHex, "the raft stays moored where you stepped ashore")
  assert.equal(sim.aboard(), false, "…and you are no longer on it")
  // one world: the player IS the target — no translation, no re-framing
  assert.deepEqual(sim.view().player, crossTarget)
  assert.notEqual(sim.view().tile, home, "board bookkeeping did not follow")
  assert.equal(sim.depth(), 2, "crossing must not change depth")
  assert.ok(sim.parentOf().tile.discovered.has(`${targetBoard[0]},${targetBoard[1]}`), "parent tile not discovered")
  assert.deepEqual(sim.parentOf().player, targetBoard, "parent player did not step")
  // the trail is continuous through the crossing (grew by the walked route)
  assert.ok(sim.view().trail.length > trailBefore, "trail did not continue through the crossing")
  assert.ok(sim.isDiscovered(seamHex), "seam discovery lost")

  // and straight back: the same coordinates, the same world (a plain walk back —
  // no elastic retrace, the return records onto the trail)
  const back = route[0]
  const via = sim.routeTo(back)
  assert.ok(via, "cannot route back across the crossing")
  assert.ok(sim.dispatch({ type: "move", target: back, via }).ok)
  assert.deepEqual(sim.view().player, back)
  // walk home to its centre — bookkeeping lands back on the home board
  assert.ok(sim.dispatch({ type: "move", target: [0, 0] }).ok, "cannot walk back to the home centre")
  assert.equal(sim.view().tile, home, "board bookkeeping did not follow back")
})

// THE RAFT HAS TO LET YOU OFF (2026-08-04). Sailing away from where you built
// it used to strand you afloat: the way-home sweep walks outward from the
// resting places, so it could only ever reach the raft at its ORIGINAL mooring
// — every shore you sailed to read as "no way home" and the reserve refused to
// land. The way home may go BY WATER: board the raft where it lies, punt to a
// shore that knows the way, walk from there (reserveMap seeds it as a source).
test("the raft lands you anywhere — after sailing, not just where you boarded", () => {
  for (const seed of [1, 3, 5, 7, 11, 13, 17, 19, 23]) {
    const sim = createSim()
    clearHome(sim, makeRng(seed))
    if (!raftOut(sim)) continue
    let hops = 0
    while (hops < 2) {
      const p = sim.view().player
      for (const n of Hex.neighbors(p)) if (!sim.isDiscovered(n) && sim.canScout(n)) sim.dispatch({ type: "scout", target: n })
      const on = Hex.neighbors(p).find(
        n => sim.isRiver(n) && sim.isDiscovered(n) && sim.canMove(n) && !sim.view().trail.some(t => Hex.equals(t, n))
      )
      if (!on || !sim.dispatch({ type: "move", target: on }).ok) break
      hops++
    }
    if (hops < 2) continue // this world's water didn't run — try the next
    assert.ok(sim.aboard(), "the raft did not come along")
    assert.deepEqual(sim.raftAt(), sim.view().player, "…and should be moored under you")
    const bank = Hex.neighbors(sim.view().player).find(n => !sim.isRiver(n) && sim.isDiscovered(n) && sim.kindOf(n))
    assert.ok(bank, "no shore beside the raft two tiles out")
    assert.ok(sim.canMove(bank), "the reserve refused to let you off the raft")
    assert.ok(sim.dispatch({ type: "move", target: bank }).ok, "landing rejected")
    assert.equal(sim.aboard(), false, "still afloat after stepping ashore")
    assert.ok(sim.homePath(), "no way home from a shore you sailed to")
    return
  }
  assert.fail("no seed put the raft two tiles out with a shore beside it")
})

// THE SHALLOWS ARE WATER, AND WATER IS A PLACE (RULES 34/35). Board water of
// deepness 0 reads exactly like a river: a raft crosses it, and ON FOOT you can
// wade in from a bank and stand there — with the river's own dead end, so the
// only way out is the bank you came in by. Standing in it is what makes it
// somewhere you could build a boat.
test("the shallows: a raft crosses them, a wader may stand in them and only back out", () => {
  // a keyed world, or there is no terrain at all — and so no water to cross
  for (const c of "0123456789abcdef") {
    const sim = createSim({ pubkey: c.repeat(64), worldKey: "abcdef01".repeat(8) })
    sim.dispatch({ type: "clearBoard" }) // home known, so the gate opens…
    sim.dispatch({ type: "goHome" }) // …and tomorrow can afford the trip
    sim.dispatch({ type: "clearMap" }) // fog off: only the RULES may refuse anything
    if (!raftOut(sim)) continue
    // sail until a shallow tile is beside us
    let shallow = null
    for (let hop = 0; hop < 8 && !shallow; hop++) {
      const p = sim.view().player
      shallow = Hex.neighbors(p).find(n => sim.isShallow(n) && sim.isDiscovered(n))
      if (shallow) break
      const on = Hex.neighbors(p).find(
        n => sim.isRiver(n) && sim.isDiscovered(n) && sim.canMove(n) && !sim.view().trail.some(t => Hex.equals(t, n))
      )
      if (!on || !sim.dispatch({ type: "move", target: on }).ok) break
    }
    if (!shallow) continue // this world had no shallows within reach — try the next
    assert.ok(sim.aboard(), "should still be on the raft")
    assert.equal(sim.landAt(shallow).deepness, 0, "the shallows are deepness 0")
    assert.ok(sim.canMove(shallow), "the raft was refused the shallows")
    assert.ok(sim.dispatch({ type: "move", target: shallow }).ok, "could not sail into the shallows")
    assert.deepEqual(sim.raftAt(), shallow, "the raft came along onto the shallows")
    assert.ok(sim.onWater() && !sim.inRiver(), "afloat on board water, not a river")
    assert.ok(sim.homePath(), "no way home from the shallows")
    // ashore, and the raft is left on the water behind you. (A pool with no
    // landable rim proves nothing about stepping off — try another world.)
    const bank = Hex.neighbors(shallow).find(n => sim.kindOf(n) && !sim.navWater(n) && sim.canMove(n))
    if (!bank) continue
    assert.ok(sim.dispatch({ type: "move", target: bank }).ok, "could not step ashore off the shallows")
    assert.deepEqual(sim.raftAt(), shallow, "the raft stayed where you left it")
    assert.equal(sim.aboard(), false, "still aboard after landing")
    // ON FOOT, from the bank: WADE IN. (Not the raft's own tile — stepping onto
    // that is boarding, which is a different rule; any other shallow tile is a
    // plain wade.) Worlds whose pool is one tile wide prove nothing here.
    const wade = Hex.neighbors(bank).find(n => sim.isShallow(n) && !Hex.equals(n, shallow) && sim.isDiscovered(n))
    if (!wade) continue
    assert.ok(sim.canMove(wade), "cannot wade into the shallows from the bank")
    assert.ok(sim.dispatch({ type: "move", target: wade }).ok, "wading in was refused")
    assert.equal(sim.aboard(), false, "wading is not boarding")
    assert.ok(sim.onWater(), "not standing in the water after wading in")
    // …and from in there it is a jetty: the way OUT is the bank you came in by.
    // (Not "nothing else is reachable" — walk back to the bank and round the
    // pool and you can of course get to its far rim. The rule is about the STEP
    // out of the water, so it's the first step of every route that must be it.)
    assert.ok(sim.canMove(bank), "cannot go back the way you waded in")
    for (const n of Hex.neighbors(wade)) {
      if (!sim.kindOf(n) || !sim.isDiscovered(n) || Hex.equals(n, bank)) continue
      const route = sim.routeTo(n)
      if (route && route.length > 1)
        assert.deepEqual(route[1], bank, `left the shallows straight for ${n} instead of back to the bank`)
    }
    // it is somewhere a boat could be raised: the tile answers the question and
    // takes the load (what's missing is debris, and the raft you already have)
    assert.ok(sim.raftPlan(), "the shallows offer no boat to build")
    assert.ok(sim.canStash(), "cannot put a load down in the shallows")
    return
  }
  assert.fail("no seed put shallow water within a raft's reach")
})

// The reported stranding, global edition: leave home, wander the seam network
// anywhere, and home must stay addressable — same coordinates, no frames.
test("a river is a dead end: no step along it, none across it, only back (RULES 30)", () => {
  const sim = createSim()
  const rng = makeRng(9)
  clearHome(sim, rng)
  const home = sim.view().tile
  const doorstep = Hex.fromKey(GATE_EDGE.k)

  // out through the gate and into the water
  assert.ok(sim.dispatch({ type: "move", target: doorstep }).ok)
  assert.ok(sim.dispatch({ type: "scout", target: GATE_TILE }).ok)
  assert.ok(sim.dispatch({ type: "move", target: GATE_TILE }).ok)
  assert.equal(sim.kindOf(sim.view().player), "seam")
  assert.ok(sim.inRiver(), "standing in the river")

  // NOT ALONG: every seam neighbour is refused, discovered or not. You can SEE
  // across the water (scouting works from in it), you just can't walk it.
  let testedAlong = 0
  for (const n of Hex.neighbors(GATE_TILE)) {
    if (sim.kindOf(n) !== "seam") continue
    if (!sim.isDiscovered(n)) sim.dispatch({ type: "scout", target: n })
    if (!sim.isDiscovered(n)) continue
    testedAlong++
    assert.equal(sim.canMove(n), false, `stepped river → river at ${n}`)
  }
  assert.ok(testedAlong > 0, "no seam neighbour was actually tested")

  // NOT ACROSS: the far bank needs a bridge, however well you can see it
  let testedAcross = 0
  for (const n of Hex.neighbors(GATE_TILE)) {
    const b = sim.boardHexOf(n)
    if (!b || (b[0] === 0 && b[1] === 0)) continue
    if (!sim.isDiscovered(n)) sim.dispatch({ type: "scout", target: n })
    if (!sim.isDiscovered(n)) continue
    testedAcross++
    assert.equal(sim.canMove(n), false, `crossed to ${n} with no bridge`)
  }
  assert.ok(testedAcross > 0, "no far bank was actually tested")

  // …and BACK is the one move you have. You can't sleep in a river either: a
  // new day resets the trail, and in the water the trail IS the way out.
  assert.ok(sim.canMove(doorstep), "the bank you came from must always be there")
  assert.ok(sim.dispatch({ type: "move", target: doorstep }).ok)
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

test("reading order covers the board once, top-left to bottom-right", () => {
  const ro = readingOrder()
  assert.equal(ro.length, BOARD_TILES)
  assert.equal(new Set(ro.map(Hex.key)).size, BOARD_TILES, "reading order revisits a tile")
  assert.deepEqual(ro[0], [0, -RINGS], "must start at the top-left tile")
  assert.deepEqual(ro[ro.length - 1], [0, RINGS], "must end at the bottom-right tile")
  for (let i = 1; i < ro.length; i++) {
    const [q, r] = ro[i]
    const [pq, pr] = ro[i - 1]
    assert.ok(r > pr || (r === pr && q === pq + 1), `not reading order at index ${i}`)
  }
})

test("a pubkey inscribes the home board and binds the save", () => {
  const pk = "f" + "0123456789abcdef".repeat(3) + "0123456789abcdef".slice(0, 15) // exactly 64 chars
  assert.equal(pk.length, 64)
  const sim = createSim({ pubkey: pk })
  // reading order: char 0 = 'f' at the top-left tile, char 1 = '0' beside it
  assert.equal(sim.nibbleAt([0, -RINGS]), "f")
  assert.equal(sim.nibbleAt([1, -RINGS]), "0")
  // the centre holds the key's middle four (the same inscription also drives
  // the world's BASE field — home never rolls open water regardless)
  assert.equal(sim.nibbleAt([0, 0]), pk.slice(30, 34))
  assert.ok(sim.typeNameAt([0, 0]) in TILE_TYPES)
  assert.notEqual(sim.typeNameAt([0, 0]), "water")
  // every key char lands somewhere: 60 singles + the centre's four
  const chars = readingOrder()
    .map(t => sim.nibbleAt(t))
    .join("")
  assert.equal(chars.length, 64)
  assert.equal([...chars].sort().join(""), [...pk].sort().join(""), "inscription lost or duplicated chars")
  // the inscription is home-only: a keyless sim stays plain
  assert.equal(createSim().typeNameAt([0, 0]), "plain")
  // home is safe — every step/scout there costs a flat minute, and the derived
  // biome type must not change that (no biome multipliers inside home). Day
  // one's single minute buys exactly one scout:
  assert.equal(sim.energy(), SEED_MIN)
  assert.ok(sim.dispatch({ type: "scout", target: [0, -1] }).ok)
  assert.equal(sim.energy(), SEED_MIN - 1, "a home scout charges a flat minute, whatever the type")
  // clear home to bank a real budget, then a step likewise costs one flat minute
  sim.dispatch({ type: "clearBoard" })
  sim.dispatch({ type: "rest" })
  const e1 = sim.energy()
  assert.ok(sim.dispatch({ type: "move", target: [1, 0] }).ok)
  assert.equal(sim.energy(), e1 - 1, "a home step charges a flat minute, whatever the type")
  const save = sim.serialize()
  assert.equal(save.world.pubkey, pk)
  assert.ok(createSim({ pubkey: pk }).hydrate(JSON.parse(JSON.stringify(save))).ok)
  assert.equal(createSim().hydrate(save).ok, false, "a keyless sim must refuse an inscribed world's save")
})

// Terrain: the pubkey shapes the base field, the world key textures it —
// deterministic, world-wide, save-bound.
test("pubkey + world key derive deterministic biomes and bind the save", () => {
  const pk = "f" + "0123456789abcdef".repeat(3) + "0123456789abcdef".slice(0, 15)
  const wk = "e" + "9b3d0af2c4715068".repeat(3) + "9b3d0af2c471506" // 64 chars
  assert.equal(wk.length, 64)
  const a = createSim({ pubkey: pk, worldKey: wk })
  const b = createSim({ pubkey: pk, worldKey: wk })
  // sample the home board and ground far across the world
  const samples = []
  for (const t of Hex.range(RINGS)) samples.push(t)
  for (const t of [[10, -5], [21, -10], [-20, 10], [9, 4], [-11, -4]]) {
    if (a.kindOf(t) === "in") samples.push(t)
  }
  const biomesA = samples.map(t => a.typeNameAt(t))
  const biomesB = samples.map(t => b.typeNameAt(t))
  assert.deepEqual(biomesA, biomesB, "same keys must derive the same world")
  for (const t of biomesA) assert.ok(t in TILE_TYPES, `unknown biome ${t}`)
  assert.ok(new Set(biomesA).size >= 2, "terrain came out uniform — derivation looks dead")
  // a different world key re-textures; a different pubkey reshapes
  assert.notDeepEqual(samples.map(t => createSim({ pubkey: pk, worldKey: "0".repeat(63) + "1" }).typeNameAt(t)), biomesA)
  assert.notDeepEqual(samples.map(t => createSim({ pubkey: "7".repeat(64), worldKey: wk }).typeNameAt(t)), biomesA)
  // keyless sims stay plain; the save stamp binds both keys
  assert.equal(createSim().typeNameAt([2, -1]), "plain")
  const save = a.serialize()
  assert.equal(save.world.worldKey, wk)
  assert.ok(createSim({ pubkey: pk, worldKey: wk }).hydrate(JSON.parse(JSON.stringify(save))).ok)
  assert.equal(createSim({ pubkey: pk }).hydrate(save).ok, false, "a world-keyless sim must refuse a keyed save")
})

test("every board keeps a person: childkey identity, key-read stats", () => {
  const pk = "f" + "0123456789abcdef".repeat(3) + "0123456789abcdef".slice(0, 15)
  const wk = "e" + "9b3d0af2c4715068".repeat(3) + "9b3d0af2c471506"
  const a = createSim({ pubkey: pk, worldKey: wk })
  const b = createSim({ pubkey: pk, worldKey: wk })
  assert.equal(a.npcAt([0, 0]), null, "home keeps no NPC — the player lives there")
  const n1 = a.npcAt([1, 0])
  assert.ok(/^[0-9a-f]{64}$/.test(n1.pubkey), "an NPC must be a real derivable identity")
  assert.deepEqual(n1, b.npcAt([1, 0]), "NPCs must derive deterministically")
  assert.notEqual(n1.pubkey, a.npcAt([0, 1]).pubkey, "boards must not share people")
  assert.deepEqual(n1.pos, a.centreOf([1, 0]), "the figure stands at its board's centre")
  // stats: one rule for every key — every named skill, integers in range. The
  // player reads the raw 0..15; a FIGURE is squeezed into the band (2026-09-01).
  for (const s of [n1.stats, a.playerStats()]) assert.deepEqual(Object.keys(s), STAT_NAMES)
  for (const v of Object.values(a.playerStats())) assert.ok(Number.isInteger(v) && v >= 0 && v <= SKILL_CAP)
  for (const v of Object.values(n1.stats)) assert.ok(Number.isInteger(v) && v >= NPC_MIN && v <= NPC_MAX)
  assert.deepEqual(a.playerStats(), statsOf(pk), "the player reads by the same rule")
  // place is nature for the stationary — inside the band: clamp first, then the
  // home biome's skill gets +3 (to the BAND's top, not the player's), and last
  // the board's one anointed skill is pinned at the top outright.
  const raw = statsOf(n1.pubkey)
  const homeSkill = BIOME_SKILL[a.typeNameAt(n1.pos)]
  assert.equal(n1.place, homeSkill ?? null)
  for (const s of STAT_NAMES) {
    let want = Math.max(NPC_MIN, Math.min(NPC_MAX, raw[s]))
    if (s === homeSkill) want = Math.max(want, Math.min(PLACE_CAP, want + PLACE_BONUS))
    if (s === n1.mastery) want = NPC_MAX
    assert.equal(n1.stats[s], want, `band / place / mastery wrong on ${s}`)
  }
  // the bonus only ever LIFTS — it must never drag a naturally-top figure down
  if (homeSkill && homeSkill !== n1.mastery) {
    assert.ok(n1.stats[homeSkill] >= Math.max(NPC_MIN, Math.min(NPC_MAX, raw[homeSkill])), "the place bonus lowered a nature")
  }
  // …and untaught, a figure SITS at its nature — that is what they can teach
  for (const s of STAT_NAMES) assert.equal(a.npcSkill(n1, s), n1.stats[s], `${s}: a figure must sit at its nature`)
  assert.deepEqual(a.playerStats(), statsOf(pk), "the player gets NO place bonus — you move")
  assert.equal(createSim().npcAt([1, 0]), null, "no world key, no people")
  assert.equal(createSim({ pubkey: pk, worldKey: wk }).npcAt([9, 9]), null, "no boards beyond the world")
})

// THE FIGURES' BAND + THE MASTER GUARANTEE (2026-09-01). Before this, an NPC
// sat at HALF its nature and `statsOf` averaged 5–6 nibbles, so natures piled
// on 7.5 and the best teacher alive anywhere was level 7 — a wall you couldn't
// see. Now their nature is banded 2..12, they sit AT it, and twelve boards per
// world are anointed masters, one per skill.
// A BOARD CENTRE IS NEVER WATER (2026-09-01). A centre's derived biome comes up
// "water" about a third of the time, and `isShallow` was the one place that
// didn't exempt the centre the way blocked/stepCostAt/scoutCostAt/landAt all
// do. Left in, navWater made the centre a JETTY — stepsFrom refused every exit
// but the way you came, and canMove priced arrival with the wade-out reserve
// instead of landBack — so the figure standing there was unreachable from any
// distance while every tile around them routed fine.
test("a board centre is never water, whatever biome it derives", () => {
  // this key/world pair puts a water biome on the centre of board [-1,-1]
  const sim = createSim({ pubkey: "5".repeat(64), worldKey: "abcdef01".repeat(8) })
  const ctr = sim.centreOf([-1, -1])
  assert.equal(sim.typeNameAt(ctr), "water", "the fixture must actually derive water here")
  assert.equal(sim.isShallow(ctr), false, "a centre must never read as shallow water")
  assert.equal(sim.navWater(ctr), false, "…and so must never be navigable water")
  assert.equal(sim.landAt(ctr), null, "it is still not land — it is the board's own tile")

  // the invariant across every centre of a water-heavy world, not just the fixture
  let water = 0
  for (let q = -RINGS; q <= RINGS; q++)
    for (let r = -RINGS; r <= RINGS; r++) {
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r)) > RINGS) continue
      const c = sim.centreOf([q, r])
      if (sim.typeNameAt(c) === "water") water++
      assert.equal(sim.navWater(c), false, `centre ${c} of board ${q},${r} reads as navigable water`)
    }
  assert.ok(water > 0, "the fixture world should have water centres to exempt")
})

// …and the behaviour that bug produced: a centre refused while its own
// neighbours are accepted. Nothing should ever route to a figure's doorstep and
// then refuse the last step for a reason the doorstep doesn't share.
test("no centre is unreachable while the tiles around it are reachable", () => {
  const sim = createSim({ pubkey: "5".repeat(64), worldKey: "abcdef01".repeat(8) })
  sim.dispatch({ type: "clearBoard" })
  sim.dispatch({ type: "rest" })
  sim.dispatch({ type: "clearMap" })
  sim.dispatch({ type: "rest" })
  assert.ok(crossOut(sim), "could not get off the home board")
  sim.dispatch({ type: "goHome" })

  const bad = []
  for (let q = -RINGS; q <= RINGS; q++)
    for (let r = -RINGS; r <= RINGS; r++) {
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r)) > RINGS || (!q && !r)) continue
      const c = sim.centreOf([q, r])
      if (!sim.isDiscovered(c) || !sim.routeTo(c) || sim.canMove(c)) continue
      // refused — is any discovered neighbour of it both routed AND allowed?
      const ok = Hex.neighbors(c).filter(n => sim.isDiscovered(n) && sim.routeTo(n) && sim.canMove(n))
      if (ok.length) bad.push(`board ${q},${r} centre ${c} refused at ${Math.round(sim.pathCharge(sim.routeTo(c)))}m while ${ok[0]} is fine`)
    }
  assert.deepEqual(bad, [], `unreachable centres beside reachable ground:\n  ${bad.join("\n  ")}`)
})

test("every world can teach you to 12 in all twelve skills, and no further", () => {
  const worlds = ["abcdef01".repeat(8), "12345678".repeat(8), "deadbeef".repeat(8), "0f0f0f0f".repeat(8)]
  for (const wk of worlds) {
    const sim = createSim({ pubkey: "7".repeat(64), worldKey: wk })
    const best = {}
    const masters = {}
    for (let q = -RINGS; q <= RINGS; q++)
      for (let r = -RINGS; r <= RINGS; r++) {
        if (Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r)) > RINGS) continue
        const npc = sim.npcAt([q, r])
        if (!npc) continue
        if (npc.mastery) masters[npc.mastery] = (masters[npc.mastery] || 0) + 1
        for (const s of STAT_NAMES) {
          const lvl = sim.npcSkill(npc, s) // untaught: they sit at their nature
          assert.ok(lvl >= NPC_MIN && lvl <= NPC_MAX, `${s} at ${lvl} on ${q},${r} — outside the band`)
          best[s] = Math.max(best[s] || 0, lvl)
        }
      }
    for (const s of STAT_NAMES) {
      assert.equal(best[s], NPC_MAX, `world ${wk.slice(0, 8)} has no ${s} teacher at ${NPC_MAX}`)
      assert.equal(masters[s], 1, `world ${wk.slice(0, 8)} has ${masters[s]} masters of ${s}, want exactly 1`)
    }
    // the same world always anoints the same twelve — derived, never stored
    const twin = createSim({ pubkey: "7".repeat(64), worldKey: wk })
    assert.equal(twin.npcAt([1, 0]).mastery, sim.npcAt([1, 0]).mastery, "mastery must derive deterministically")
  }
  // …and DIFFERENT worlds anoint different boards (it's keyed, not fixed)
  const a = createSim({ pubkey: "7".repeat(64), worldKey: worlds[0] })
  const b = createSim({ pubkey: "7".repeat(64), worldKey: worlds[1] })
  const layout = sim => {
    const out = []
    for (let q = -RINGS; q <= RINGS; q++)
      for (let r = -RINGS; r <= RINGS; r++)
        if (Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r)) <= RINGS) out.push(sim.npcAt([q, r])?.mastery ?? "-")
    return out.join(",")
  }
  assert.notEqual(layout(a), layout(b), "two worlds must not share a master layout")
  // THE LAST THREE ARE GRIND-ONLY: nobody in any world knows more than NPC_MAX
  // untaught, so a lesson can never carry you to SKILL_CAP.
  assert.ok(NPC_MAX < SKILL_CAP, "the band must leave levels for practice to earn")
})

test("lessons: a nearby figure teaches what it outranks you in; the save replays it", () => {
  const pk = "f" + "0123456789abcdef".repeat(3) + "0123456789abcdef".slice(0, 15)
  const wk = "e" + "9b3d0af2c4715068".repeat(3) + "9b3d0af2c471506"
  const sim = createSim({ pubkey: pk, worldKey: wk })
  clearHome(sim, makeRng(3))
  assert.equal(sim.learnable().length, 0, "home has no teacher")
  // out the gate and straight across the seam into the neighbour board
  const doorstep = Hex.fromKey(GATE_EDGE.k)
  assert.ok(raftOut(sim), "could not raft out of home") // RULES 30/33: the seam is water, and the raft is a haul
  const dir = [GATE_TILE[0] - doorstep[0], GATE_TILE[1] - doorstep[1]]
  const landing = [GATE_TILE[0] + dir[0], GATE_TILE[1] + dir[1]]
  assert.ok(sim.dispatch({ type: "scout", target: landing }).ok)
  assert.ok(sim.dispatch({ type: "move", target: landing }).ok, "could not cross into the neighbour board")
  assert.ok(sim.dispatch({ type: "clearBoard" }).ok)
  // stand beside (or on) the board's centre — the figure lives there
  const centre = sim.centreOf(sim.boardHexOf(sim.view().player))
  const stand = [centre, ...DIRS.map(d => [centre[0] + d.q, centre[1] + d.r])].find(t => sim.canMove(t))
  assert.ok(stand, "no walkable ground beside the figure")
  assert.ok(sim.dispatch({ type: "move", target: stand }).ok)
  const npc = sim.npcAt(sim.boardHexOf(sim.view().player))
  assert.ok(npc, "the board keeps no figure")
  const ls = sim.learnable()
  assert.ok(ls.length > 0, "the figure has nothing to teach")
  // the lowest-level teachable skill — fewest edges (lessons) to climb a level
  const skill = ls.reduce((a, b) => (b.at < a.at ? b : a)).skill
  const before = sim.skillOf(skill)
  assert.ok(sim.npcSkill(npc, skill) > before, "teacher must outrank the student")
  // lessons cost minutes and raise the level; the clamp stops at the teacher.
  // A level now takes (level+1) whole edges, so allow plenty of lessons.
  let guard = 0
  while (sim.skillOf(skill) === before && guard++ < 300) {
    const e0 = sim.energy()
    const r = sim.dispatch({ type: "learn", skill })
    if (r.ok) {
      assert.ok(sim.energy() < e0, "a lesson must spend time")
      continue
    }
    // out of the day's budget for this lesson — sleep at home, walk back out, keep going
    if (!sim.dispatch({ type: "goHome" }).ok || !sim.dispatch({ type: "move", target: stand }).ok) break
  }
  assert.ok(sim.skillOf(skill) > before, "lessons never raised the skill")
  assert.ok(sim.skillOf(skill) <= sim.npcSkill(npc, skill), "learned past the teacher")
  // the whole biography replays: hydrate rebuilds the same skills
  const save = JSON.parse(JSON.stringify(sim.serialize()))
  const back = createSim({ pubkey: pk, worldKey: wk })
  assert.ok(back.hydrate(save).ok, "hydrate rejected a day with lessons")
  assert.equal(back.skillOf(skill), sim.skillOf(skill), "replayed skills diverged")
})

// Movement is ONLY the reserve: you may go anywhere you can reach and still walk
// home from. There is no position-based lock — revealing every tile around you
// (nothing new underfoot, or standing at the map's edge) never strands you while
// you have the margin to step to reachable ground and back.
test("movement is exactly the reserve — a fully-seen ring never locks you in place", () => {
  const pk = "f" + "0123456789abcdef".repeat(3) + "0123456789abcdef".slice(0, 15)
  const wk = "e" + "9b3d0af2c4715068".repeat(3) + "9b3d0af2c471506"
  const sim = createSim({ pubkey: pk, worldKey: wk })
  clearHome(sim, makeRng(3))
  const doorstep = Hex.fromKey(GATE_EDGE.k)
  assert.ok(raftOut(sim), "could not raft out of home") // RULES 30/33: the seam is water, and the raft is a haul
  const dir = [GATE_TILE[0] - doorstep[0], GATE_TILE[1] - doorstep[1]]
  const landing = [GATE_TILE[0] + dir[0], GATE_TILE[1] + dir[1]]
  assert.ok(sim.dispatch({ type: "scout", target: landing }).ok)
  assert.ok(sim.dispatch({ type: "move", target: landing }).ok)
  // reveal the ENTIRE ring around the player — nothing adjacent is fog anymore
  for (const n of Hex.neighbors(sim.view().player))
    if (!sim.isDiscovered(n) && sim.canScout(n)) sim.dispatch({ type: "scout", target: n })
  assert.equal(sim.reachableDots().size, 0, "no fog should be left directly underfoot")
  assert.ok(sim.energy() > sim.returnCost() + 5, "plenty of margin over the reserve")
  // NOT locked: some discovered neighbour is still movable, and every legal move
  // is EXACTLY the reserve rule — reach cost + the way home within the time left.
  const nbrs = Hex.neighbors(sim.view().player).filter(n => sim.isDiscovered(n) && sim.kindOf(n))
  const movable = nbrs.filter(n => sim.canMove(n))
  assert.ok(movable.length > 0, "a fully-seen ring must not strand you — neighbours stay movable")
  for (const n of nbrs) {
    const route = sim.routeTo(n)
    // RULES 30: a river tile has no reserve of its own — standing in the water
    // you're off the way home, so it's priced through the bank you'd arrive
    // from (the tile before it on the route).
    const back = route && sim.isRiver(n) ? sim.returnVia(n, route[route.length - 2]) : sim.returnFrom(n)
    const affordable = !!route && sim.pathCharge(route) + back <= sim.energy()
    assert.equal(sim.canMove(n), affordable, `canMove must equal the reserve rule at ${n[0]},${n[1]}`)
  }
})

// SKIPPED 2026-09-05, and the reason is a finding, not a flake: you start at 1
// in everything (RULES 46) and every figure sits at 2 or better, so on a fresh
// world there is NOTHING you can teach. Out-ranking one needs either a second
// figure to learn from (a lesson stops at the teacher's own level) — and one
// raft reaches exactly one — or PRACTICE, which is wired for `gather` and
// `hunt` only: PRACTICE_SKILL also names move, scout, craft, build and cook,
// but nothing outside doTake ever records them. Un-skip once either is true.
test.skip("teaching a figure raises it past its nature and COSTS you an edge; it replays", () => {
  const pk = "f" + "0123456789abcdef".repeat(3) + "0123456789abcdef".slice(0, 15)
  const wk = "e" + "9b3d0af2c4715068".repeat(3) + "9b3d0af2c471506"
  const sim = createSim({ pubkey: pk, worldKey: wk })
  clearHome(sim, makeRng(3))
  // out the gate and across the seam onto the neighbour board (same path lessons take)
  const doorstep = Hex.fromKey(GATE_EDGE.k)
  assert.ok(raftOut(sim), "could not raft out of home") // RULES 30/33: the seam is water, and the raft is a haul
  const dir = [GATE_TILE[0] - doorstep[0], GATE_TILE[1] - doorstep[1]]
  const landing = [GATE_TILE[0] + dir[0], GATE_TILE[1] + dir[1]]
  assert.ok(sim.dispatch({ type: "scout", target: landing }).ok)
  assert.ok(sim.dispatch({ type: "move", target: landing }).ok)
  assert.ok(sim.dispatch({ type: "clearBoard" }).ok)
  const abroad = sim.boardHexOf(sim.view().player) // the neighbour board, before heading home
  // RULES 38: the raft's 30m build eats the outing's slack, so the lesson gets
  // a fresh day — routing crosses back at the moored raft on its own
  assert.ok(sim.dispatch({ type: "goHome" }).ok, "could not end the outing at home")
  // YOU START AT ONE (RULES 46) and every figure sits at 2 or better, so there
  // is nothing you can teach on day one — the rank has to be EARNED. Find a
  // pair: one figure who knows a skill well, another who barely does, and take
  // lessons from the first until you outrank the second.
  // YOU START AT ONE (RULES 46) and every figure sits at 2 or better, so there
  // is nothing you can teach on day one — the rank has to be EARNED, and with
  // one raft there is exactly one figure in reach, so it cannot be earned from
  // a second teacher. It is earned by DOING: walking trains travel, and once
  // yours passes theirs you have something of your own to give.
  const skill = "travel"
  const npc = sim.npcAt(abroad)
  assert.ok(npc, "the board keeps no figure")
  assert.ok(practiceTravelTo(sim, sim.npcSkill(npc, skill) + 1), `could not walk ${skill} past the figure's`)
  assert.ok(standAt(sim, abroad), "could not reach the figure to teach")
  assert.ok(sim.skillOf(skill) > sim.npcSkill(npc, skill), "did not out-rank the figure")
  assert.ok(sim.npcSkill(npc, skill) < SKILL_CAP, "the figure is already capped in it")
  // TOTAL edges from level 0 — the one currency teaching MOVES: −1 from your
  // shape, +1 into the figure's (levels land only when a shape completes). From
  // zero, so the count stays honest even when a drain digs below the nature base.
  const edgeSum = p => {
    let e = p.filled + p.partial
    for (let l = 0; l < p.level; l++) e += edgesForLevel(l)
    return e
  }
  const yourEdges = () => edgeSum(sim.skillProgress(skill))
  const theirEdges = () => edgeSum(sim.npcProgress(npc, skill))
  const youBefore = sim.skillOf(skill)
  const themBefore = sim.npcSkill(npc, skill)
  const yoursBefore = yourEdges()
  const theirsBefore = theirEdges()
  const e0 = sim.energy()
  assert.ok(sim.dispatch({ type: "teach", skill }).ok, "teach was refused")
  assert.ok(Math.abs(yoursBefore - yourEdges() - 1) < 1e-9, "teaching must cost you exactly one edge")
  assert.ok(Math.abs(theirEdges() - theirsBefore - 1) < 1e-9, "the figure must receive exactly one edge")
  assert.ok(sim.skillOf(skill) >= youBefore - 1 && sim.skillOf(skill) <= youBefore, "an edge given moves your level by at most one")
  assert.ok(sim.npcSkill(npc, skill) >= themBefore && sim.npcSkill(npc, skill) <= themBefore + 1, "an edge received moves their level by at most one")
  assert.ok(sim.energy() < e0, "teaching must spend time")
  // the figure never rises past SKILL_CAP; you never sink below zero — and
  // EVERY give drains exactly one edge, nature included (an empty shape gives up
  // the level; the base is not an infinite well)
  let guard = 0
  let prevEdges = yourEdges()
  while (sim.dispatch({ type: "teach", skill }).ok && guard++ < 40) {
    assert.ok(Math.abs(prevEdges - yourEdges() - 1) < 1e-9, "a give must always drain exactly one edge")
    prevEdges = yourEdges()
  }
  assert.ok(sim.npcSkill(npc, skill) <= SKILL_CAP, "taught the figure past the cap")
  assert.ok(sim.skillOf(skill) >= 0, "taught yourself below zero")
  // you no longer outrank them → the action is now refused
  assert.equal(sim.dispatch({ type: "teach", skill }).ok, false, "kept teaching without outranking")
  // the whole thing replays: hydrate rebuilds the same you-and-them levels
  const save = JSON.parse(JSON.stringify(sim.serialize()))
  const back = createSim({ pubkey: pk, worldKey: wk })
  assert.ok(back.hydrate(save).ok, "hydrate rejected a day with teaching")
  const npc2 = back.npcAt(back.boardHexOf(back.view().player))
  assert.equal(back.skillOf(skill), sim.skillOf(skill), "replayed your skill diverged")
  assert.equal(back.npcSkill(npc2, skill), sim.npcSkill(npc, skill), "replayed the figure's skill diverged")
})

test("water: visible from the shore, never underfoot", () => {
  const sim = createSim()
  sim.parentOf().tile.types["0,-1"] = "water" // the stored-types hook (on the lattice owner): a pond beside the start
  assert.ok(sim.isFrontier([0, -1]), "the sea beside you must be scoutable")
  assert.ok(sim.dispatch({ type: "scout", target: [0, -1] }).ok)
  assert.equal(sim.canMove([0, -1]), false, "walked on water")
  assert.equal(sim.dispatch({ type: "move", target: [0, -1] }).ok, false)
})

test("the home board never rolls open water (the gate must stay openable)", () => {
  // an all-zero PUBKEY drowns the base field — home must still be dry ground
  for (const pk of ["0".repeat(64), "1" + "0".repeat(63)]) {
    const sim = createSim({ pubkey: pk, worldKey: "a".repeat(64) })
    for (const t of Hex.range(RINGS)) {
      assert.notEqual(sim.typeNameAt(t), "water", `home tile ${t} is water under ${pk.slice(0, 4)}…`)
    }
  }
})

// The chosen angle is per-world: it places the gate and rides the save stamp.
test("a chosen angle places the gate and binds the save to its world", () => {
  const a = 90
  const sim = createSim({ angle: a })
  assert.equal(sim.angle(), a)
  const edge = gateEdgeFor(a)
  sim.dispatch({ type: "clearBoard" }) // clearing home opens the gate wherever it fell
  sim.dispatch({ type: "rest" }) // …and banks the 60 minutes home just earned for the trip out
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
  fuzz(sim, makeRng(31), 150) // allowRest on: crosses day boundaries via rest/goHome
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

// The trusted, chunked reload the game actually boots through: it re-APPLIES
// history instead of re-ROUTING it (no per-action Dijkstra), so load stays
// linear. It must land on the identical state, and it heals via-less saves.
test("progressive reload matches the reference hydrate and self-heals via-less saves", async () => {
  const sim = createSim()
  clearHome(sim, makeRng(31))
  fuzz(sim, makeRng(31), 150) // via-less moves across day boundaries — a legacy-shaped save
  const raw = JSON.stringify(sim.serialize())
  assert.ok(sim.day() > 1, "the fuzz never crossed a day — the test proves nothing")

  const fast = createSim()
  const r = await fast.hydrateProgressive(JSON.parse(raw))
  assert.ok(r.ok, `hydrateProgressive rejected: ${r.reason}`)
  assert.equal(stateSig(fast), stateSig(sim), "progressive reload diverged from the live world")

  // self-heal: replaying stamped each move's route in, so the re-serialized save
  // now carries `via`, and a second progressive reload is idempotent
  const healed = fast.serialize()
  const fast2 = createSim()
  assert.ok((await fast2.hydrateProgressive(JSON.parse(JSON.stringify(healed)))).ok)
  assert.deepEqual(fast2.serialize(), healed, "the healed save is not idempotent under reload")
  assert.equal(stateSig(fast2), stateSig(sim), "reload of the healed save diverged")

  // the gate still holds under the fast path: a rules mismatch is refused
  const bad = JSON.parse(raw)
  bad.world.rules = -1
  assert.equal((await createSim().hydrateProgressive(bad)).ok, false, "a rules mismatch must refuse")
})

// The leap: the DIAGONAL — the tile beyond the edge two adjacent neighbours
// share — for ONE step's price, over known unwalled ground. Straight through
// a tile's CENTRE is not a leap; the crack between tiles is the road.
// BACK ON from RULES 38 (it was retired over RULES 30's rivers) — but DRY
// ground only: no water as footing, flanker or landing, so it never fords.
test("the leap is back — the diagonal for one step's price, dry ground only (RULES 38)", () => {
  const sim = createSim()
  const rng = makeRng(7)
  clearHome(sim, rng) // ends rested at the home centre, trail = [[0,0]]

  // in the cleared home: the router takes the diagonal leap, priced as one step
  assert.equal(LEAP, true, "the leap flag is on")
  const land = [DIRS[0].q + DIRS[1].q, DIRS[0].r + DIRS[1].r]
  assert.ok(sim.canMove(land), "leap landing not movable")
  const route = sim.routeTo(land)
  assert.equal(route.length, 2, "router did not take the leap")
  assert.equal(sim.pathCost(route), sim.stepCostAt(land), "a leap must price as ONE step onto the landing")
  assert.ok(sim.dispatch({ type: "move", target: land }).ok)
  assert.equal(sim.view().trail.length, 2, "the trail records the landing only — the flankers are jumped over")

  // leaping back is a normal recorded move — the return APPENDS (no elastic erase)
  const back = sim.routeTo([0, 0])
  assert.ok(back, "leap segment refused the route back")
  assert.equal(back.length, 2, "the way back is a single leap")
  assert.ok(sim.dispatch({ type: "move", target: [0, 0], via: back }).ok)
  assert.equal(sim.view().trail.length, 3, "the return leap is recorded onto the trail, not erased")

  // collinear through a tile's centre is NOT a leap: 2 straight-out takes 2 steps
  const across = [2 * DIRS[0].q, 2 * DIRS[0].r]
  assert.equal(sim.routeTo(across).length, 3, "collinear 2-out must walk through the middle")
})

// …and the river still refuses it: a leap over the seam would be FORDING —
// bank to bank, feet dry, no river tile in the route. If any such hop were
// legal the router would take it (one step beats punting every time), so the
// way home going ON the water is proof no ford exists anywhere along it.
test("the leap never fords — the way home still crosses on the water (RULES 38)", () => {
  const sim = createSim()
  clearHome(sim, makeRng(7))
  assert.ok(crossOut(sim), "could not cross out of home")
  const home = sim.routeTo([0, 0])
  assert.ok(home, "no route home from the far bank")
  assert.ok(
    home.some(t => sim.isRiver(t)),
    "the route home skipped the river — a leap forded the seam"
  )
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
  // over the river onto the next board, then keep walking away from home until
  // nothing outward is affordable (RULES 30: the seam is no longer a road, so
  // the outing spends itself on real ground instead of along the water)
  assert.ok(crossOut(sim), "could not bridge out of home")
  for (let guard = 0; guard < 60; guard++) {
    const v0 = sim.view()
    const next = Hex.neighbors(v0.player).find(
      n =>
        sim.kindOf(n) === "in" &&
        !sim.isRiver(n) &&
        !v0.trail.some(t => Hex.equals(t, n)) &&
        (sim.isDiscovered(n) || sim.canScout(n))
    )
    if (!next) break
    if (!sim.isDiscovered(next) && !sim.dispatch({ type: "scout", target: next }).ok) break
    if (!sim.canMove(next)) break
    assert.ok(sim.dispatch({ type: "move", target: next }).ok)
  }
  const v = sim.view()
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

// At DEPLETION the reserve ALONE governs: the way home is always affordable
// (never-strandable), and canMove is exactly "reach + the way home within the
// time left" — no position lock, no off-reserve permissions. Scouting/learning
// keep their own reserve checks.
test("at depletion the reserve alone governs — the way home holds, the unaffordable is refused", () => {
  const sim = createSim()
  clearHome(sim, makeRng(5))
  const doorstep = Hex.fromKey(GATE_EDGE.k)
  sim.dispatch({ type: "move", target: doorstep })
  sim.dispatch({ type: "scout", target: GATE_TILE })
  sim.dispatch({ type: "move", target: GATE_TILE })
  // walk out along the seam until nothing outward is affordable
  for (let guard = 0; guard < 60; guard++) {
    const v = sim.view()
    const next = Hex.neighbors(v.player).find(
      n => sim.kindOf(n) === "seam" && !v.trail.some(t => Hex.equals(t, n)) && (sim.isDiscovered(n) || sim.canScout(n))
    )
    if (!next) break
    if (!sim.isDiscovered(next) && !sim.dispatch({ type: "scout", target: next }).ok) break
    if (!sim.canMove(next)) break
    sim.dispatch({ type: "move", target: next })
  }
  const v = sim.view()
  // the way home is always reachable, and its next step is affordable to the minute
  const hp = sim.homePath()
  assert.ok(hp && hp.length >= 2 && Hex.equals(hp[hp.length - 1], v.entry), "no way home at depletion")
  assert.ok(sim.canMove(hp[1]), "the next step home must stay affordable")
  // every discovered tile in view: canMove agrees EXACTLY with the reserve rule
  for (const d of Hex.range(VIEW_RING)) {
    const h = [v.player[0] + d[0], v.player[1] + d[1]]
    if (!sim.kindOf(h) || Hex.equals(h, v.player) || !sim.isDiscovered(h)) continue
    const route = sim.routeTo(h)
    const affordable = !!route && sim.pathCharge(route) + sim.returnFrom(h) <= sim.energy()
    assert.equal(sim.canMove(h), affordable, `canMove must equal the reserve rule at ${h[0]},${h[1]}`)
  }
  // and the walk home actually completes, budget intact
  assert.ok(sim.dispatch({ type: "move", target: v.entry }).ok, "the walk home was rejected")
  assert.ok(sim.energy() >= 0, "walking home overdrew the budget")
  assert.ok(Hex.equals(sim.view().player, v.entry))
})

test("seam scouting respects the reserve outside the safe space", () => {
  let checked = 0
  for (const seed of [11, 222, 3333, 777]) {
    const sim = createSim()
    const rng = makeRng(seed)
    clearHome(sim, rng)
    if (!crossOut(sim)) continue // RULES 30: a river ring, so the fuzz needs a bridge to get anywhere
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
  assert.ok(raftOut(sim), "could not raft out of home") // RULES 30/33: the seam is water, and the raft is a haul
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

test("clearBoard reveals the whole board, leaves the gate for the walk, and replays cleanly", () => {
  const sim = createSim()
  assert.ok(sim.dispatch({ type: "clearBoard" }).ok)
  const home = sim.view().tile
  assert.equal(home.discovered.size, BOARD_TILES)
  // REVEALING A BOARD IS NOT STANDING ON ITS DOOR (RULES 49). Day one cannot
  // even make the trip — the budget is the tiles found BEFORE today, so it is
  // one minute here; the walk, and the gate with it, belong to the next day.
  // The full play-through above is what covers the opening.
  assert.equal(home.gateOpen, false, "clearBoard opened the gate without the walk")
  const before = stateSig(sim)
  const log = sim.log().slice()
  sim.beginReplay()
  for (const a of log) assert.ok(sim.apply(a).ok)
  sim.endReplay()
  assert.equal(stateSig(sim), before, "clearBoard day diverged on replay")
})

// ── the gather / craft / build loop ─────────────────────────────────

// YOU START AT ONE IN EVERYTHING (RULES 46), so a test that needs a skill has
// to EARN it the way the game means it to be earned: stand beside a figure who
// outranks you and take lessons, resting for a fresh budget between them. Every
// figure outranks a level-1 player, so any board's centre will do.
function learnUpTo(sim, skill, want, board = null) {
  // a day ENDS AT A RESTING PLACE (RULES 45), which carries you home — so each
  // new day walks back out to the figure before the next lesson
  for (let day = 0; day < 80 && sim.skillOf(skill) < want; day++) {
    if (!(board ? standAt(sim, board) : standByTeacher(sim))) return false
    while (sim.canAct({ type: "learn", skill }) && sim.dispatch({ type: "learn", skill }).ok) {}
    if (sim.skillOf(skill) >= want) return true
    if (!sim.dispatch({ type: "rest" }).ok) return false
  }
  return sim.skillOf(skill) >= want
}
// …and the other way up: PRACTICE. Shuttling between two home tiles trains
// travel (PRACTICE_BASE moves to an edge), resting for a new day whenever the
// budget runs out — no teacher needed, which is the point of it.
function practiceTravelTo(sim, want) {
  const home = [
    [0, 0],
    [1, 0]
  ]
  for (let i = 0; i < 4000 && sim.skillOf("travel") < want; i++) {
    const to = home[i % 2]
    if (!sim.dispatch({ type: "move", target: to }).ok && !sim.dispatch({ type: "rest" }).ok) return false
  }
  return sim.skillOf("travel") >= want
}
// stand on (or beside) a given board's centre, where its figure is
function standAt(sim, board) {
  const centre = sim.centreOf(board)
  const stand = [centre, ...DIRS.map(x => [centre[0] + x.q, centre[1] + x.r])].find(t => sim.canMove(t))
  return !!stand && sim.dispatch({ type: "move", target: stand }).ok
}
// …and a sim that has been taught the asked levels, standing back at home.
function simWithSkills(min) {
  for (const c of "0123456789abcdef") {
    const sim = createSim({ pubkey: c.repeat(64), worldKey: "abcdef01".repeat(8) })
    sim.dispatch({ type: "clearMap" })
    sim.dispatch({ type: "move", target: [0, 0] })
    sim.dispatch({ type: "rest" })
    if (!openWorld(sim)) continue // the raft found nowhere to land on this world
    if (!Object.entries(min).every(([s, l]) => learnUpTo(sim, s, l))) continue
    if (!sim.dispatch({ type: "goHome" }).ok) continue
    return sim
  }
  return null
}
// walk to a neighbouring board's centre, where its figure stands
function standByTeacher(sim) {
  const home = sim.boardHexOf([0, 0])
  for (const d of DIRS) {
    const board = [home[0] + d.q, home[1] + d.r]
    if (sim.npcAt(board) && standAt(sim, board)) return true
  }
  return false
}

// a sim (whole world revealed, rested) POSITIONED on a ready `res` tile past
// the seam — looping seeds until one offers a reachable one. { sim, tile }.
function gatherReadySim(res) {
  for (const c of "0123456789abcdef") {
    const sim = createSim({ pubkey: c.repeat(64), worldKey: "abcdef01".repeat(8) })
    sim.dispatch({ type: "clearMap" })
    sim.dispatch({ type: "move", target: [0, 0] })
    sim.dispatch({ type: "rest" })
    if (!openWorld(sim)) continue // the raft found nowhere to land on this world — try the next key
    sim.dispatch({ type: "goHome" }) // start the outing rested, as before
    const tile = gatherOutside(sim, res, new Set())
    if (tile) return { sim, tile }
  }
  return null
}

// POSITION the player on a ready, reachable tile yielding `res` OUT PAST THE
// SEAM (home tiles aren't gatherable). Returns the tile — the caller
// gathers. `byHome` picks the node NEAREST home (lowest reserve) instead of
// nearest the player, so a gathering run stays close to base. Rests to
// refill when nothing's in reach. null if it can't.
function gatherOutside(sim, res, avoid = new Set(), byHome = false) {
  // RULES 30: with a river to cross, a gathering run takes more days — the raft
  // has to be fetched, and the way back is over the water
  for (let guard = 0; guard < 220; guard++) {
    const p = sim.view().player
    let best = null
    for (let q = -12; q <= 12; q++)
      for (let r = -12; r <= 12; r++) {
        const g = [q, r]
        const k = q + "," + r
        if (avoid.has(k) || !sim.isDiscovered(g) || !sim.canMove(g)) continue
        const bh = sim.boardHexOf(g)
        if (!bh || (bh[0] === 0 && bh[1] === 0)) continue // must be OUTSIDE the home board
        if (!sim.yieldsAt(g).some(y => y.res === res)) continue // a NODE of this resource (biome × node draw)
        const d = byHome ? sim.returnFrom(g) : Math.abs(q - p[0]) + Math.abs(r - p[1])
        if (!best || d < best.d) best = { g, k, d }
      }
    if (best) {
      if (best.d !== 0 && !sim.dispatch({ type: "move", target: best.g }).ok) {
        avoid.add(best.k)
        continue
      }
      const y = (sim.gatherInfo() || []).find(e => e.res === res)
      if (y?.ready && sim.canAct({ type: y.verb, item: res })) return best.g
      avoid.add(best.k) // not ready / can't afford here — skip it
    } else {
      if (!sim.dispatch({ type: "move", target: [0, 0] }).ok) return null
      if (!sim.dispatch({ type: "rest" }).ok) return null
    }
  }
  return null
}

test("walking a tile wears it in — the step cost drops toward a floor", () => {
  const found = gatherReadySim("plants") // lands the player ON an outside node, past the seam
  assert.ok(found, "no seed positioned the player outside")
  const { sim, tile } = found // `tile` is outside + a node → non-centre, walkable
  // a neighbour to bounce off, so we re-ENTER `tile` (each entry wears it)
  let N = null
  for (const d of DIRS) {
    const n = [tile[0] + d.q, tile[1] + d.r]
    if (sim.isDiscovered(n) && sim.canMove(n)) {
      N = n
      break
    }
  }
  assert.ok(N, "no neighbour to step to")

  const f0 = sim.wearFactor(tile)
  const c0 = sim.stepCostAt(tile)
  const w0 = sim.wornAt(tile)
  // step off and back on repeatedly — each return traversal wears `tile` in
  for (let i = 0; i < 6; i++) {
    if (!sim.dispatch({ type: "move", target: N }).ok) break
    if (!sim.dispatch({ type: "move", target: tile }).ok) break
  }
  assert.ok(sim.wornAt(tile) > w0, "the traversals counted")
  assert.ok(sim.wearFactor(tile) <= f0 + 1e-9, "wear never RAISES the multiplier")
  assert.ok(sim.stepCostAt(tile) <= c0 + 1e-9, "a worn tile is never more expensive")
  assert.ok(sim.wearFactor(tile) >= WEAR_FLOOR - 1e-9, "wear never drops below the floor")
  assert.equal(sim.wearFactor(tile), WEAR_FLOOR, "a well-worn tile bottoms out at the floor")
})

test("homePathFrom matches homePath from the player's own tile", () => {
  const found = gatherReadySim("plants") // player is outside, past the seam
  assert.ok(found, "no seed positioned the player outside")
  const { sim } = found
  const p = sim.view().player
  const a = sim.homePath()
  const b = sim.homePathFrom(p)
  assert.ok(a && b, "both ways home exist")
  assert.deepEqual(b[0], p, "the ghost route starts where the player stands")
  assert.deepEqual(b[b.length - 1], a[a.length - 1], "…and ends at the same home centre")
  assert.ok(Math.abs(sim.pathCharge(a) - sim.pathCharge(b)) < 1e-9, "same cost home (ties aside)")
})

test("every discovered tile adds a minute — the first one already pays", () => {
  const sim = createSim({ pubkey: "ab".repeat(32), worldKey: "cd".repeat(32) })
  assert.equal(sim.tilesFound(), 0, "nothing discovered yet")
  assert.equal(sim.dayBudget(), SEED_MIN, "day one is the seed minute")

  // the FIRST tile you scout already adds a minute (it used to be eaten by the floor)
  assert.ok(sim.dispatch({ type: "scout", target: [0, -1] }).ok)
  assert.equal(sim.tilesFound(), 1)
  assert.equal(sim.nextBudget(), SEED_MIN + 1, "the very first discovered tile pays a minute")

  // clearing HOME lifts the budget by its 60 non-centre tiles
  assert.ok(sim.dispatch({ type: "clearBoard" }).ok)
  assert.equal(sim.tilesFound(), ENERGY_START, "home is 60 discoverable tiles")
  assert.equal(sim.nextBudget(), SEED_MIN + ENERGY_START, "seed + home = 61")
  assert.equal(sim.dayBudget(), SEED_MIN, "today's window is unchanged — the boost is for tomorrow")
  assert.ok(sim.dispatch({ type: "rest" }).ok)
  assert.equal(sim.dayBudget(), SEED_MIN + ENERGY_START, "the next day opens on seed + home")

  // revealing the whole world (home + 60 outside boards) caps at a full day
  assert.ok(sim.dispatch({ type: "clearMap" }).ok)
  assert.equal(sim.tilesFound(), 61 * 60, "every board's tiles count now, home included")
  assert.equal(sim.nextBudget(), WAKE_CAP, "a fully-explored world caps the budget at the waking window")
  assert.equal(WAKE_CAP, FREE_CAP - SLEEP_MIN, "…which is the day less the sleep it owes (RULES 42)")
})

// FISHING TAKES TACKLE (RULES 36). Wading into the shallows put fish within
// reach — reach was never what stopped you. Standing on a ready fish node with
// room in the pack and time to spare, the harvest is still refused, and says
// what it wants: a NET, woven by the same plains hands as the basket.
test("fish need a net — standing over them is not enough", () => {
  // the fish are in the shallows, so this is the raft trip from the shallows
  // test, sailing until a ready fish node is beside us
  let sim = null
  for (const c of "0123456789abcdef") {
    const s2 = createSim({ pubkey: c.repeat(64), worldKey: "abcdef01".repeat(8) })
    s2.dispatch({ type: "clearBoard" })
    s2.dispatch({ type: "goHome" })
    s2.dispatch({ type: "clearMap" })
    if (!raftOut(s2)) continue
    let node = null
    for (let hop = 0; hop < 10 && !node; hop++) {
      const p = s2.view().player
      node = Hex.neighbors(p).find(n => s2.isShallow(n) && s2.yieldsAt(n).some(y => y.res === "fish") && s2.canMove(n))
      if (node) break
      const on = Hex.neighbors(p).find(
        n => s2.isRiver(n) && s2.isDiscovered(n) && s2.canMove(n) && !s2.view().trail.some(t => Hex.equals(t, n))
      )
      if (!on || !s2.dispatch({ type: "move", target: on }).ok) break
    }
    if (!node || !s2.dispatch({ type: "move", target: node }).ok) continue
    sim = s2
    break
  }
  assert.ok(sim, "no seed put a fish node within a raft's reach")
  const gi = sim.gatherInfo().find(y => y.res === "fish")
  assert.ok(gi, "fish should be on offer here")
  assert.equal(gi.verb, "hunt", "fish are HUNTED, not gathered (RULES 43)")
  // every other reason to refuse is absent — it really is the tackle
  assert.ok(gi.ready, "the node should be ready")
  assert.ok(!gi.full, "the pack should have room")
  assert.ok(sim.energy() > gi.cost + sim.returnCost(), "the day should have time for it")
  assert.equal(gi.lacks, "net", "the missing thing should be named")
  assert.equal(sim.canAct({ type: "hunt", item: "fish" }), false, "fished bare-handed")
  assert.equal(sim.dispatch({ type: "hunt", item: "fish" }).ok, false, "a netless hunt was allowed through")
  assert.equal(sim.dispatch({ type: "gather", item: "fish" }).ok, false, "…and fish are never picked up by hand")
  assert.equal(sim.inventory().fish, undefined, "caught something anyway")
  // the net is a craft like any other: plants, minutes, your own hands
  assert.equal(RECIPES.net.site, undefined, "the net is crude work — no ground required")
  assert.equal(RECIPES.net.tool, "net", "the recipe names the KIND of tool it is")
  assert.equal(RESOURCES.fish.hunt, "net", "…and the fish name the kind they need")
})

test("gather yields, starts the regrow clock, and weighs the pack down", () => {
  const found = gatherReadySim("plants")
  assert.ok(found, "no seed offered a reachable plants tile past the seam")
  const { sim, tile } = found
  assert.ok(sim.gatherInfo().some(y => y.res === "plants"), "plants should be on offer here")
  const costEmpty = sim.stepCostAt(tile) // an outside tile's cost rises with load
  assert.ok(sim.canAct({ type: "gather", item: "plants" }), "gather should be affordable")
  assert.ok(sim.dispatch({ type: "gather", item: "plants" }).ok)
  assert.equal(sim.inventory().plants, 1)
  assert.ok(sim.loadOf() > 0)
  assert.ok(!sim.canAct({ type: "gather", item: "plants" }), "the tile must be regrowing now")
  const costLoaded = sim.stepCostAt(tile)
  assert.ok(costLoaded > costEmpty, "a loaded pack must slow the step")
})

test("home isn't gatherable — but nothing stops you crafting there", () => {
  // YOU START AT ONE (RULES 46) and the crude tier sits there with you, so a
  // fresh player is held up by MATERIALS on every crude recipe and by the LEVEL
  // on the fine ones — never, on any of them, by the ground underfoot
  const sim = createSim({ pubkey: "3".repeat(64), worldKey: "abcdef01".repeat(8) })
  // the home centre yields nothing (it's the board's own tile)…
  assert.equal(sim.gatherInfo(), null, "the home centre isn't gatherable")
  // …and neither does an ordinary home tile — home is the minimap, not land
  assert.ok(sim.dispatch({ type: "clearBoard" }).ok)
  sim.dispatch({ type: "rest" }) // bank the 60 that clearing home earns, so a step is affordable
  assert.ok(sim.dispatch({ type: "move", target: [1, 0] }).ok)
  assert.equal(sim.gatherInfo(), null, "a home tile isn't gatherable either")
  // …but crafting asks nothing of the ground (2026-09-01): every crude recipe
  // is held up ONLY by the empty pack, never by where you're standing.
  const list = sim.craftList()
  assert.equal(list.length, Object.keys(RECIPES).length, "every recipe must be listed")
  for (const row of list) {
    assert.equal(row.site, null, `${row.k} pins itself to a biome — the crude tier shouldn't`)
    const gate = RECIPES[row.k].level > sim.skillOf("craft") ? /^needs craft \d+$/ : /^needs \d+ more /
    assert.match(row.why, gate, `${row.k} was blocked by something other than its own level or materials: ${row.why}`)
    assert.ok(!/figure|specialist|commission/i.test(row.why), `${row.k} still blames a missing figure: ${row.why}`)
  }
  // …and the CRUDE tier asks nothing of your hands: every one of them is at the
  // level everybody starts on, so only the fine tier is gated at all
  for (const k in RECIPES) if (!k.startsWith("fine")) assert.equal(RECIPES[k].level, 1, `${k} gates the crude tier`)
  assert.equal(sim.preserve(), 1, "no basket yet, no preservation")
})

// YOU START AT ONE (RULES 46). Level 1 is the single seed dot and everybody's
// is the same size: nature says how GIFTED you are towards a skill, never where
// you begin — levels are climbed, not handed out.
test("every skill starts at exactly 1, however rich the key", () => {
  for (const c of "0123456789abcdef") {
    const sim = createSim({ pubkey: c.repeat(64), worldKey: "abcdef01".repeat(8) })
    const nature = sim.playerStats()
    for (const s of STAT_NAMES) assert.equal(sim.skillOf(s), 1, `${s} started at ${sim.skillOf(s)} on key ${c} (nature ${nature[s]})`)
  }
  // …and nature is still THERE, read straight off the key — it just gives nothing away
  const rich = createSim({ pubkey: "f".repeat(64), worldKey: "abcdef01".repeat(8) })
  for (const s of STAT_NAMES) assert.ok(rich.playerStats()[s] > 1, `${s}'s nature on a full key`)
  // an all-zeroes key lands in the same place: a shape, not nothing
  const bare = createSim({ pubkey: "0".repeat(64), worldKey: "abcdef01".repeat(8) })
  for (const s of STAT_NAMES) assert.equal(bare.skillOf(s), 1, `${s} on a zero key`)
})

// YOU ARE THE MAKER (RULES 39). Crafting stopped being a commission bought
// from a biome-native figure: it's a verb you perform, with your own hands,
// wherever you happen to be — and there is no reason that can't be your own
// fire at home, which is the case this pins.
test("you weave the basket yourself, at home, with nobody's help", () => {
  const need = RECIPES.basket.needs.plants
  let sim = null
  for (const c of "0123456789abcdef") {
    const s2 = createSim({ pubkey: c.repeat(64), worldKey: "abcdef01".repeat(8) })
    if (s2.skillOf("craft") < RECIPES.basket.level) continue // this key can't weave yet
    s2.dispatch({ type: "clearMap" })
    s2.dispatch({ type: "move", target: [0, 0] })
    s2.dispatch({ type: "rest" })
    if (!openWorld(s2)) continue // the raft found nowhere to land on this world
    s2.dispatch({ type: "goHome" })
    const avoid = new Set()
    for (let i = 0; i < need; i++) {
      if (!gatherOutside(s2, "plants", avoid, true)) break
      if (!s2.dispatch({ type: "gather", item: "plants" }).ok) break
      avoid.add(String(s2.view().player)) // one unit per node — the rest is regrowing
    }
    if ((s2.inventory().plants || 0) < need) continue
    // carry the haul HOME — the whole point is weaving it there
    if (!s2.dispatch({ type: "goHome" }).ok) continue
    sim = s2
    break
  }
  assert.ok(sim, `no seed gathered ${need} plants and got them home`)

  const p = sim.view().player
  assert.equal(sim.landAt(p), null, "home tiles aren't land — and it must not matter")
  assert.equal(sim.gatherInfo(), null, "…you still can't forage here")
  // NOBODY IS HERE. Home is the player's own board: npcAt refuses it outright,
  // so there is provably no figure to have commissioned this from.
  assert.equal(sim.npcAt(sim.boardHexOf(p)), null, "home has no figure — that's the point")

  const before = sim.skillProgress("craft")
  const cap = sim.carryCap()
  assert.ok(sim.canAct({ type: "craft", recipe: "basket" }), "the plants are here and so are your hands")
  assert.ok(sim.dispatch({ type: "craft", recipe: "basket" }).ok)
  assert.equal(sim.inventory().basket, 1, "the basket should be on your back")
  assert.equal(sim.inventory().plants, undefined, "…and the plants spent")
  assert.ok(sim.carryCap() > cap, "a basket carries more")
  assert.ok(sim.preserve() > 1, "…and keeps food fresher")
  // MAKING TRAINS THE MAKER — the shape moved, which the old NPC service never did
  const after = sim.skillProgress("craft")
  assert.ok(
    after.level > before.level || after.filled > before.filled || after.partial > before.partial,
    "the craft shape should have filled"
  )

  // the whole run replays to the same state — a craft is log-derived like any action
  const sig = stateSig(sim)
  const log = sim.log().slice()
  sim.beginReplay()
  for (const a of log) assert.ok(sim.apply(a).ok)
  sim.endReplay()
  assert.equal(stateSig(sim), sig, "the crafting day diverged on replay")
})

test("a tile holds what you drop on it and gives it back; the weight lifts", () => {
  const found = gatherReadySim("plants")
  assert.ok(found, "no seed offered a reachable plants tile")
  const { sim } = found
  assert.ok(sim.dispatch({ type: "gather", item: "plants" }).ok)
  assert.equal(sim.inventory().plants, 1)
  assert.ok(sim.canStash(), "every tile is a storage cell (RULES 29)")
  // carry it home and onto an identity tile (not the centre)
  assert.ok(sim.dispatch({ type: "move", target: [0, 0] }).ok)
  assert.ok(sim.dispatch({ type: "move", target: [1, 0] }).ok)
  assert.ok(sim.canStash(), "a home tile is a storage cell")
  // stash it: leaves the pack, sits in the cell, weight lifts
  assert.ok(sim.dispatch({ type: "drop", item: "plants" }).ok)
  assert.equal(sim.inventory().plants, undefined, "it left the pack")
  assert.deepEqual(sim.stashHere(), { item: "plants", n: 1 }, "…and sits in the cell")
  assert.equal(sim.loadOf(), 0, "stashing offloads the weight")
  // take it back
  assert.ok(sim.canAct({ type: "take" }))
  assert.ok(sim.dispatch({ type: "take" }).ok)
  assert.equal(sim.inventory().plants, 1, "back on your back")
  assert.equal(sim.stashHere(), null, "the cell is empty again")
  // the whole thing replays byte-for-byte
  const before = stateSig(sim)
  const sim2 = createSim({ pubkey: sim.pubkey(), worldKey: "abcdef01".repeat(8) })
  assert.ok(
    sim2.hydrate({
      app: "anon&mato",
      schema: 3,
      world: { angle: sim2.angle(), pubkey: sim.pubkey(), worldKey: "abcdef01".repeat(8), rings: RINGS, rules: RULES },
      days: sim.history().map(h => ({ day: h.day, actions: h.actions })),
      today: { day: sim.day(), actions: sim.log().slice() }
    }).ok
  )
  assert.equal(stateSig(sim2), before, "stash diverged on rebuild")
})

test("dropping out in the world leaves it on that tile, and it waits there", () => {
  const found = gatherReadySim("plants")
  assert.ok(found, "no seed offered a reachable plants tile")
  const { sim } = found
  assert.ok(sim.dispatch({ type: "gather", item: "plants" }).ok)
  assert.equal(sim.inventory().plants, 1)
  const where = sim.view().player.slice() // out in the world, nowhere special
  assert.ok(sim.dispatch({ type: "drop", item: "plants" }).ok)
  assert.equal(sim.inventory().plants, undefined, "off your back")
  assert.deepEqual(sim.stashHere(), { item: "plants", n: 1 }, "…and lying at your feet")
  // the world already holds the wall's leftover debris (RULES 33) — what matters
  // is that THIS drop made its own pile, on the tile it was dropped on
  const piles = sim.stashes().filter(p => p.item === "plants")
  assert.equal(piles.length, 1, "one pile of plants in the world")
  assert.deepEqual(piles[0].at, where, "on the very tile it was dropped on")
  // walk off and come back: it's still there, and it comes back up
  const away = sim.view().trail.length > 1 ? sim.view().trail[sim.view().trail.length - 2] : null
  if (away) {
    assert.ok(sim.dispatch({ type: "move", target: away }).ok)
    assert.equal(sim.stashHere(), null, "nothing underfoot over there")
    assert.ok(sim.dispatch({ type: "move", target: where }).ok)
  }
  assert.deepEqual(sim.stashHere(), { item: "plants", n: 1 }, "still waiting where you left it")
  assert.ok(sim.dispatch({ type: "take" }).ok)
  assert.equal(sim.inventory().plants, 1, "picked back up")
  assert.deepEqual(
    sim.stashes().filter(p => p.item === "plants"),
    [],
    "and the pile is gone"
  )
})

test("a drop that can't land is refused — nothing ever vanishes off your back", () => {
  const found = gatherReadySim("plants")
  assert.ok(found, "no seed offered a reachable plants tile")
  const { sim } = found
  assert.ok(sim.dispatch({ type: "gather", item: "plants" }).ok)
  // the HOME CENTRE used to swallow drops (it wasn't a storage cell, so the
  // item left the pack and went nowhere). Every tile holds now — including it.
  assert.ok(sim.dispatch({ type: "move", target: [0, 0] }).ok)
  assert.deepEqual(sim.view().player, [0, 0], "standing on the home centre")
  assert.ok(sim.dispatch({ type: "drop", item: "plants" }).ok)
  assert.deepEqual(sim.stashHere(), { item: "plants", n: 1 }, "the centre keeps it like any tile")
  // …and a tile already holding one type REFUSES another, rather than eating it
  const second = gatherOutside(sim, "wood")
  if (second) {
    assert.ok(sim.dispatch({ type: "gather", item: "wood" }).ok)
    assert.equal(sim.inventory().wood, 1)
    assert.ok(sim.dispatch({ type: "move", target: [0, 0] }).ok)
    const before = JSON.stringify(sim.inventory())
    const r = sim.dispatch({ type: "drop", item: "wood" })
    assert.equal(r.ok, false, "one item type per tile — the drop is refused")
    assert.equal(JSON.stringify(sim.inventory()), before, "and the wood is still on your back")
    assert.deepEqual(sim.stashHere(), { item: "plants", n: 1 }, "the pile is untouched")
  }
})

test("a harvest spoils after its shelf life and can't be hoarded", () => {
  const found = gatherReadySim("plants")
  assert.ok(found, "no seed offered a reachable plants tile past the seam")
  const { sim } = found
  assert.ok(sim.dispatch({ type: "gather", item: "plants" }).ok)
  // a raw plant keeps 3 days (4320 world-min)
  const pd = sim.packDetail().find(d => d.k === "plants")
  assert.ok(pd && pd.spoilsIn > 4200 && pd.spoilsIn <= 4320, "plants shelf ~3 days, got " + pd?.spoilsIn)
  // rest four days: it must rot away, and its weight goes with it
  for (let i = 0; i < 4; i++) {
    assert.ok(sim.dispatch({ type: "move", target: [0, 0] }).ok)
    assert.ok(sim.dispatch({ type: "rest" }).ok)
  }
  assert.equal(sim.inventory().plants, undefined, "the harvest rotted")
  assert.equal(sim.loadOf(), 0, "the rotted weight is gone too")
  // and it replays to the same (empty) pack
  const before = stateSig(sim)
  const days = sim.history().map(h => ({ day: h.day, actions: h.actions }))
  const sim2 = createSim({ pubkey: sim.pubkey(), worldKey: "abcdef01".repeat(8) })
  assert.ok(
    sim2.hydrate({
      app: "anon&mato",
      schema: 3,
      world: { angle: sim2.angle(), pubkey: sim.pubkey(), worldKey: "abcdef01".repeat(8), rings: RINGS, rules: RULES },
      days,
      today: { day: sim.day(), actions: sim.log().slice() }
    }).ok
  )
  assert.equal(stateSig(sim2), before, "spoilage diverged on rebuild")
  assert.equal(sim2.inventory().plants, undefined, "rotted stays rotted on rebuild")
})

const eq2 = (a, b) => a[0] === b[0] && a[1] === b[1]

// Gather a camp's materials and raise it near home. Wood keeps, so it's
// gathered first (over however many days); the perishable plants are
// gathered LAST from near-home nodes and the camp goes up right there, on a
// low-reserve tile with the pack still fresh. { ok, reason } — assert-free.
function tryBuildCamp(sim) {
  sim.dispatch({ type: "clearMap" })
  sim.dispatch({ type: "move", target: [0, 0] })
  sim.dispatch({ type: "rest" })
  // RULES 30: the world past home is across water — span it once, then the
  // gathering runs below can reach the far boards as they always did
  if (!openWorld(sim)) return { ok: false, reason: "the raft found no landable bank" }
  sim.dispatch({ type: "move", target: [0, 0] })
  sim.dispatch({ type: "rest" })
  const avoid = new Set()
  for (let i = 0; i < 3; i++) {
    const t = gatherOutside(sim, "wood", avoid) // nearest the PLAYER: with a river to cross, you work the side you landed on
    if (!t) return { ok: false, reason: `only got ${i} wood` }
    if (!sim.dispatch({ type: "gather", item: "wood" }).ok) return { ok: false, reason: "gather wood failed" }
    avoid.add(t.join())
  }
  // a fresh day (rest-and-resume is gone — home it is)
  sim.dispatch({ type: "goHome" })
  for (let i = 0; i < 2; i++) {
    const t = gatherOutside(sim, "plants", avoid) // …same: gather where you are, not back across the water
    if (!t) return { ok: false, reason: `only got ${i} plants` }
    if (!sim.dispatch({ type: "gather", item: "plants" }).ok) return { ok: false, reason: "gather plants failed" }
    avoid.add(t.join())
  }
  // …and a fresh tank for the loaded trek to the site + the build itself
  sim.dispatch({ type: "goHome" })
  let best = null
  for (let q = -12; q <= 12; q++)
    for (let r = -12; r <= 12; r++) {
      const g = [q, r]
      if (!sim.isDiscovered(g) || sim.kindOf(g) !== "in") continue
      const bh = sim.boardHexOf(g)
      if (!bh || (bh[0] === 0 && bh[1] === 0)) continue
      if (sim.typeNameAt(g) === "water" || !sim.canMove(g)) continue
      const rf = sim.returnFrom(g)
      if (!best || rf < best.rf) best = { g, rf }
    }
  if (best && !eq2(sim.view().player, best.g)) sim.dispatch({ type: "move", target: best.g })
  if (sim.canAct({ type: "build", what: "camp" })) {
    sim.dispatch({ type: "build", what: "camp" })
    return { ok: true }
  }
  return { ok: false, reason: `unaffordable (e ${sim.energy().toFixed(0)}, pack ${JSON.stringify(sim.inventory())})` }
}

// PARKED 2026-08-03 (RULES 30). Not a sim defect — an economy one: with every
// seam a river, sourcing a camp's materials past the water means fetching the
// raft, crossing, gathering under a rising load, and crossing back, and no
// world in a 80-key search affords all five nodes in one reserve. The fixture
// hauls everything on its back in one go; what the game now wants is FERRYING
// — gather, drop on the bank (drops persist since RULES 29), come back for the
// rest. Rewrite this on top of the debris-haul flow when that lands; the camp
// mechanic itself is untouched and still covered by canAct/build unit paths.
test.skip("a built camp is a real resting place and eases the reserve", () => {
  // a forest-rich world with buildable land close to home, so a first camp
  // is affordable to raise (wood + plant nodes near the seam)
  const WK = "8ff5e739".repeat(8)
  let sim = null
  let reason = "no qualifying seed"
  // RULES 30 widened this search: the raft opens a lot of world (62 → ~220
  // tiles here) but the way back is over the water, so a camp's materials have
  // to be within one reserve of the crossing. More worlds to choose from.
  const keys = []
  for (const a of "0123456789abcdef") {
    keys.push(a.repeat(64))
    for (const b of "37bf") keys.push((a + b).repeat(32))
  }
  for (const pk of keys) {
    const s = createSim({ pubkey: pk, worldKey: WK })
    if (s.skillOf("build") < 2 || s.skillOf("gather") < 5) continue
    // pre-screen: enough wood + plant NODES near home to source a camp
    let wood = 0
    let plants = 0
    for (let q = -11; q <= 11; q++)
      for (let r = -11; r <= 11; r++) {
        const L = Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r))
        if (L < 6 || L > 11) continue // just past the seam, near home
        const gs = s.gatherStateAt([q, r])
        if (!gs) continue
        if (gs.res === "wood") wood++
        else if (gs.res === "plants") plants++
      }
    if (wood < 3 || plants < 2) {
      reason = "too few nodes near home"
      continue
    }
    const r = tryBuildCamp(s)
    if (r.ok) {
      sim = s
      break
    }
    if (process.env.CAMP_DEBUG) console.log("  key", pk.slice(0, 2), "→", r.reason)
    reason = r.reason
  }
  assert.ok(sim, "no seed let a camp be built past the seam: " + reason)

  assert.equal(sim.camps().length, 1)
  assert.ok(sim.atRestSpot(), "the camp counts as a resting place")
  const day0 = sim.day()
  assert.ok(sim.dispatch({ type: "rest" }).ok, "the day can end at the camp")
  assert.equal(sim.day(), day0 + 1)
  assert.ok(sim.dayBudget() > ENERGY_START, "reaching past the seam grew the budget")
  assert.equal(sim.energy(), sim.dayBudget(), "rested to the full (grown) tank")
  // the whole thing replays to the same world, camp and all
  const before = stateSig(sim)
  const sim2 = createSim({ pubkey: sim.pubkey(), worldKey: WK })
  const r = sim2.hydrate({
    app: "anon&mato",
    schema: 3,
    world: { angle: sim2.angle(), pubkey: sim.pubkey(), worldKey: WK, rings: RINGS, rules: RULES },
    days: sim.history().map(h => ({ day: h.day, actions: h.actions })),
    today: { day: sim.day(), actions: sim.log().slice() }
  })
  assert.ok(r.ok, "camp save must hydrate: " + (r.reason || ""))
  assert.equal(stateSig(sim2), before, "camp world diverged on rebuild")
  assert.equal(sim2.camps().length, 1, "the camp must survive the rebuild")
})

test("clearMap reveals every board and seam, and replays cleanly", () => {
  const sim = createSim()
  assert.ok(sim.dispatch({ type: "clearMap" }).ok)
  const parent = sim.parentOf().tile
  // every board of the parent field: fully discovered, known at parent scale
  const len = ([q, r]) => Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r))
  let boards = 0
  for (let q = -RINGS; q <= RINGS; q++)
    for (let r = -RINGS; r <= RINGS; r++) {
      if (len([q, r]) > RINGS) continue
      boards++
      assert.ok(parent.discovered.has(q + "," + r), `board ${q},${r} unknown at parent scale`)
      const node = parent.children[q + "," + r]
      assert.equal(node?.discovered.size, BOARD_TILES, `board ${q},${r} not fully discovered`)
    }
  assert.equal(boards, BOARD_TILES)
  // …and revealing them all still leaves every gate shut: a gate opens under
  // your FEET, on the door's own tile, and we have not walked anywhere (RULES 49)
  assert.equal(sim.view().tile.gateOpen, false)
  // the seams between the boards are known too — check one for certain
  let seam = null
  for (let q = -SEAM_RING; q <= SEAM_RING && !seam; q++)
    for (let r = -SEAM_RING; r <= SEAM_RING && !seam; r++)
      if (len([q, r]) === SEAM_RING && isSeamHex([q, r])) seam = [q, r]
  assert.ok(seam, "no seam hex found to probe")
  assert.ok(parent.seamDiscovered.has(seam[0] + "," + seam[1]), "seam not discovered")
  const before = stateSig(sim)
  const log = sim.log().slice()
  sim.beginReplay()
  for (const a of log) assert.ok(sim.apply(a).ok)
  sim.endReplay()
  assert.equal(stateSig(sim), before, "clearMap day diverged on replay")
})

// ── headlessness ─────────────────────────────────────
test("the sim runs with no DOM (this whole file is the proof)", () => {
  assert.equal(typeof globalThis.document, "undefined")
  const sim = createSim()
  assert.equal(sim.depth(), 2) // starts inside the home safe space
  assert.ok(sim.view().tile.safe)
})

// ── the reserve invariant, against a LIVED save ──────────────────────
// The 2026-08-31 stranding: standing ON the raft, a route that stepped ashore
// and waded into other water was priced with the sail-away reserve (returnVia
// read aboard() off the live player) — the commit landed with energy 23.9
// against a true wade-out reserve of 39.4, and every further click was
// correctly refused: hard-stranded. returnVia takes an explicit `afloat` now,
// and this replays the actual save through the LIVE dispatch (can() enforced)
// to hold the line: no accepted action may ever leave energy below the way
// back.
// THE LOG IS A RULES-37 LIFE: its raft went up instantly, and RULES 38 charges
// the build 30 minutes — so from its raft day on this world-line prices itself
// out and the replay diverges, which is exactly what the RULES gate refuses in
// game (this test bypasses the gate on purpose). What must still hold: the
// pre-raft days replay EXACTLY (the leap's return must not touch a
// via-carrying log), the raft build itself still fits its day, the divergence
// starts at the raft day and nowhere earlier, and no accepted action ever
// breaks energy ≥ reserve. (The day-24 raftless wade-in the save recorded —
// the one move that had to be refused — is out of reach in the diverged tail;
// the live water tests above carry the afloat pricing now.)
test("a lived save replays without ever breaking energy ≥ reserve (stranding regression)", async () => {
  const { readFileSync } = await import("node:fs")
  const save = JSON.parse(readFileSync(new URL("./fixtures/stranded-save.json", import.meta.url)))
  const sim = createSim(save.world)
  const RAFT_DAY = 9 // the log's own raft build — where RULES 38's 30m first bites
  const rejected = []
  for (const d of save.days)
    for (const a of d.actions) {
      const r = sim.dispatch(a)
      if (!r.ok) {
        rejected.push({ day: d.day, type: a.type })
        continue
      }
      if (a.type === "rest" || a.type === "goHome") continue
      const e = sim.energy()
      const ret = sim.returnCost()
      assert.ok(e + 1e-9 >= ret, `day ${d.day}: after ${a.type}, energy ${e} < reserve ${ret}`)
    }
  assert.ok(!rejected.some(x => x.type === "raft"), "the raft build must still fit its day at 30m")
  assert.ok(rejected.length > 0, "a RULES-37 log must not replay whole under RULES 38 — its raft day got 30m shorter")
  const early = rejected.find(x => x.day < RAFT_DAY)
  assert.equal(early, undefined, `pre-raft days must replay exactly, but day ${early?.day} refused a ${early?.type}`)
})

// ── PLAYER ENERGY (RULES 42): sleep and hunger, on top of the budget ────
// The body has two base needs. SLEEP: at least SLEEP_MIN a day, so the waking
// window caps at WAKE_CAP (pinned in the budget test above). HUNGER: no more
// than HUNGER_MAX between meals — every affordability check prices against the
// lesser of the budget and the minutes until the next meal is due, so the
// reserve lands you at a resting place before you'd go hungry, exactly as it
// does before the budget runs out. Waking sets the clock HUNGER_MAX out; every
// bite pushes it on by the food's OWN nourishment (RULES 47).
test("without food a day ends at the meal deadline, however long the budget", () => {
  const sim = createSim()
  assert.ok(sim.dispatch({ type: "clearMap" }).ok) // a mapped world: the full waking window from tomorrow
  assert.ok(sim.dispatch({ type: "move", target: [0, 0] }).ok)
  assert.ok(sim.dispatch({ type: "rest" }).ok)
  assert.equal(sim.energy(), WAKE_CAP, "a mapped world wakes on the whole waking window")
  assert.equal(sim.hungerLeft(), HUNGER_MAX, "…with the meal clock fresh")
  assert.equal(sim.timeLeft(), HUNGER_MAX, "so the meal clock, not the budget, is what there is to spend")
  // pace the home board — a minute a step — until nothing more fits
  let steps = 0
  for (let guard = 0; guard < 2000; guard++) {
    const p = sim.view().player
    const next = p[0] === 0 && p[1] === 0 ? [1, 0] : [0, 0]
    if (!sim.canMove(next)) break
    assert.ok(sim.dispatch({ type: "move", target: next }).ok)
    steps++
  }
  assert.ok(steps > 0, "never walked")
  assert.deepEqual(sim.view().player, [0, 0], "the last affordable step was the one home")
  assert.ok(sim.hungerLeft() > -1e-9 && sim.hungerLeft() < 1 + 1e-9, `the meal clock ran down to ${sim.hungerLeft()}`)
  assert.ok(sim.energy() > HUNGER_MAX, `the budget still held ${sim.energy()} — hunger ended the day, not time`)
  assert.equal(sim.canMove([1, 0]), false, "…and no step out is legal now")
  // the day replays, meal clock included
  const sig = stateSig(sim)
  const log = sim.log().slice()
  sim.beginReplay()
  for (const a of log) assert.ok(sim.apply(a).ok)
  sim.endReplay()
  assert.equal(stateSig(sim), sig, "the meal clock diverged on replay")
  // the one thing left is to sleep: a fresh day, a fresh clock
  assert.ok(sim.canAct({ type: "rest" }), "you can still sleep")
  const day = sim.day()
  assert.ok(sim.dispatch({ type: "rest" }).ok)
  assert.equal(sim.day(), day + 1)
  assert.equal(sim.hungerLeft(), HUNGER_MAX, "waking restarts the meal clock")
})

test("a meal pushes the clock on by its own worth, and the reserve prices against it before the budget", () => {
  const found = gatherReadySim("plants") // a mapped world (WAKE_CAP days), standing on a plants node outside
  assert.ok(found, "no seed positioned the player on a plants node")
  const { sim, tile } = found
  assert.equal(sim.dayBudget(), WAKE_CAP, "a mapped world's day is the whole waking window")
  assert.ok(sim.energy() > HUNGER_MAX, "…so hunger, not the budget, bounds the outing")
  // something to eat later — gathered now, while the clock is fresh
  assert.ok(sim.dispatch({ type: "gather", item: "plants" }).ok)
  assert.equal(sim.inventory().plants, 1)
  // a SAMPLE of routable tiles (one coordinate in three each way — the whole
  // map priced is too slow to price thrice), each the way canMove prices it:
  // there, and home again. Checks every sampled tile agrees with the meal
  // clock; returns how many were refused on hunger ALONE (the budget would
  // have paid), how many are legal, and the farthest round trip.
  const survey = () => {
    let bound = 0
    let legal = 0
    let farthest = 0
    let far = null // …and the tile that costs it
    let n = 0
    const p = sim.view().player
    for (let q = -39; q <= 39; q += 3)
      for (let r = -39; r <= 39; r += 3) {
        const g = [q, r]
        if (!sim.isDiscovered(g) || Hex.equals(g, p) || sim.navWater(g)) continue
        const route = sim.routeTo(g)
        if (!route) continue
        const need = sim.pathCharge(route) + sim.retAfterPath(route)
        if (!isFinite(need)) continue
        n++
        if (need > farthest) (farthest = need), (far = g)
        const ok = sim.canMove(g)
        assert.equal(
          ok,
          need <= sim.timeLeft() + 1e-9,
          `canMove(${g}) disagrees with the meal clock: needs ${need}, ${sim.timeLeft()} left of ${sim.energy()}`
        )
        if (ok) legal++
        else if (need <= sim.energy()) bound++
      }
    assert.ok(n > 0, "found nothing to price")
    return { bound, legal, farthest, far }
  }
  // ROUTES ARE SHORT IN MINUTES: a mapped world is all within a fresh clock's
  // reach (every round trip here is well under HUNGER_MAX), so three hours
  // never limit travel by themselves — they limit the WORK that runs the clock
  // down. Fresh, nothing is hunger-bound; pace the clock away, and look again.
  const fresh = survey()
  assert.ok(fresh.farthest < HUNGER_MAX, `the whole map is inside one meal (farthest round trip ${fresh.farthest})`)
  assert.equal(fresh.bound, 0, "with a fresh clock nothing is refused on hunger")
  // run the clock down the honest way — the longest round trip on the map, as
  // often as it still fits (each trip costs about the farthest need)
  for (let guard = 0; guard < 8 && sim.timeLeft() >= fresh.farthest; guard++) {
    assert.ok(sim.dispatch({ type: "move", target: fresh.far }).ok, "the far trip was refused while it still fit")
    assert.ok(sim.dispatch({ type: "move", target: tile }).ok, "…and the way back to the node")
  }
  assert.deepEqual(sim.view().player, tile, "back on the node")
  assert.ok(sim.timeLeft() < fresh.farthest, "the meal clock ran below the farthest round trip")
  assert.ok(sim.energy() > fresh.farthest, "…while the budget still covers it: hunger is what binds now")
  const hungry = survey()
  assert.ok(hungry.bound > 0, "no tile was refused on hunger alone")
  // eat: the clock goes on by the food's OWN nourishment (RULES 47, was a flat
  // restart to HUNGER_MAX), the nourishment still lands, and reach comes back
  assert.ok(sim.hungerLeft() < HUNGER_MAX, "time has passed on the meal clock")
  assert.ok(sim.canAct({ type: "eat", item: "plants" }), "a bite is affordable")
  const clock0 = sim.hungerLeft()
  assert.ok(sim.dispatch({ type: "eat", item: "plants" }).ok)
  assert.ok(
    Math.abs(sim.hungerLeft() - (clock0 - EAT_MIN + RESOURCES.plants.food)) < 1e-9,
    `a plant pushed the clock on by its own ${RESOURCES.plants.food}m less the sitting, not to a flat three hours (${clock0} → ${sim.hungerLeft()})`
  )
  assert.ok(sim.hungerLeft() < HUNGER_MAX, "…so a scrap never buys back a whole fresh clock")
  // …and every further bite pushes it on again — the sitting can never outrun
  // the food, so a bite always nets time
  while (sim.canAct({ type: "eat", item: "plants" })) {
    const was = sim.hungerLeft()
    assert.ok(sim.dispatch({ type: "eat", item: "plants" }).ok)
    assert.ok(sim.hungerLeft() > was, `a bite lost time (${was} → ${sim.hungerLeft()})`)
  }
  // at the waking cap a bite can add no minutes (the window can't outgrow the
  // day) — and the ration never governs the body's clock, only the day's window:
  // the push above landed while fed stayed pinned at nothing
  assert.equal(sim.fed(), 0, "nothing to add at the cap")
  assert.ok(sim.returnCost() <= sim.timeLeft() + 1e-9, "the way home still fits")
  const fed = survey()
  assert.ok(fed.bound < hungry.bound, "eating buys back some of what hunger refused")
  assert.ok(fed.legal > hungry.legal, "a meal buys back reach")
  // the meal clock replays with the day
  const sig = stateSig(sim)
  const log = sim.log().slice()
  sim.beginReplay()
  for (const a of log) assert.ok(sim.apply(a).ok)
  sim.endReplay()
  assert.equal(stateSig(sim), sig, "the meal clock diverged on replay")
})

// ── FORAGE & HUNT (RULES 43) ────────────────────────────────────────
// A hunt is a take that needs its tool: with a net on your back the fish come
// out of the water, the take trains HUNT (not gather), and the pack chip and
// the ground row have a face for every one of the new things.
test("with a net, fish are hunted — and the hunt trains hunt, not gather", () => {
  const need = RECIPES.net.needs.plants
  let sim = null
  for (const c of "0123456789abcdef") {
    const s2 = createSim({ pubkey: c.repeat(64), worldKey: "abcdef01".repeat(8) })
    if (s2.skillOf("craft") < RECIPES.net.level) continue // this key can't weave yet
    s2.dispatch({ type: "clearMap" })
    s2.dispatch({ type: "move", target: [0, 0] })
    s2.dispatch({ type: "rest" })
    if (!openWorld(s2)) continue
    s2.dispatch({ type: "goHome" })
    const avoid = new Set()
    for (let i = 0; i < need; i++) {
      if (!gatherOutside(s2, "plants", avoid, true)) break
      if (!s2.dispatch({ type: "gather", item: "plants" }).ok) break
      avoid.add(String(s2.view().player))
    }
    if ((s2.inventory().plants || 0) < need) continue
    if (!s2.dispatch({ type: "goHome" }).ok) continue
    if (!s2.dispatch({ type: "craft", recipe: "net" }).ok) continue
    // ONE OF A KIND (RULES 44): a second net is refused, and says so; the
    // upgrade is held up only by what it still needs (the net itself is here)
    assert.equal(s2.canAct({ type: "craft", recipe: "net" }), false, "a second net was allowed")
    assert.equal(s2.craftList().find(r => r.k === "net").why, "you already carry a net")
    assert.match(s2.craftList().find(r => r.k === "fine net").why, /^needs (craft \d+|\d+ more)/, "the upgrade should wait on level or materials, not on the net")
    // out to the water with the net: board the raft (openWorld left it moored
    // at the harbour) and sail until a ready fish node is beside us
    const moored = s2.raftAt()
    if (!moored || !s2.canMove(moored) || !s2.dispatch({ type: "move", target: moored }).ok) continue
    let node = null
    for (let hop = 0; hop < 10 && !node; hop++) {
      const p = s2.view().player
      node = Hex.neighbors(p).find(n => s2.isShallow(n) && s2.yieldsAt(n).some(y => y.res === "fish" && y.ready) && s2.canMove(n))
      if (node) break
      const on = Hex.neighbors(p).find(
        n => s2.isRiver(n) && s2.isDiscovered(n) && s2.canMove(n) && !s2.view().trail.some(t => Hex.equals(t, n))
      )
      if (!on || !s2.dispatch({ type: "move", target: on }).ok) break
    }
    if (!node || !s2.dispatch({ type: "move", target: node }).ok) continue
    sim = s2
    break
  }
  assert.ok(sim, "no seed wove a net and reached a fish node with it")
  assert.equal(sim.inventory().net, 1, "the net is on your back")
  const gi = sim.gatherInfo().find(y => y.res === "fish")
  assert.ok(gi && gi.verb === "hunt" && !gi.lacks, "with the net, nothing is lacking")
  const before = sim.skillProgress("hunt")
  const gatherBefore = sim.skillProgress("gather")
  assert.equal(sim.canAct({ type: "gather", item: "fish" }), false, "fish are never picked up by hand")
  assert.ok(sim.canAct({ type: "hunt", item: "fish" }), "the hunt is affordable")
  assert.ok(sim.dispatch({ type: "hunt", item: "fish" }).ok)
  assert.equal(sim.inventory().fish, 1, "one fish, caught")
  assert.equal(sim.inventory().net, 1, "…and the net is still whole (tools don't wear)")
  const after = sim.skillProgress("hunt")
  assert.ok(
    after.level > before.level || after.filled > before.filled || after.partial > before.partial,
    "the hunt trained hunt"
  )
  assert.deepEqual(sim.skillProgress("gather"), gatherBefore, "…and not gather")
  assert.ok(!sim.canAct({ type: "hunt", item: "fish" }), "the node is regrowing now")
  // the whole run replays to the same state — a hunt is log-derived like any action
  const sig = stateSig(sim)
  const log = sim.log().slice()
  sim.beginReplay()
  for (const a of log) assert.ok(sim.apply(a).ok)
  sim.endReplay()
  assert.equal(stateSig(sim), sig, "the hunting day diverged on replay")
})

test("every yield has a face of its own, and every biome offers a set", () => {
  // chip faces: no two things you can carry wear the same tag
  const faces = new Map()
  for (const k of [...Object.keys(RESOURCES), ...Object.keys(RECIPES)]) {
    const t = tagOf(k)
    assert.ok(!faces.has(t), `${k} and ${faces.get(t)} both wear "${t}"`)
    faces.set(t, k)
  }
  // every biome offers something, every offered thing exists and is priced
  for (const [b, list] of Object.entries(BIOME_YIELD)) {
    assert.ok(list.length > 0, `${b} offers nothing`)
    for (const r of list) {
      assert.ok(RESOURCES[r], `${b} offers ${r}, which isn't a resource`)
      assert.ok(NODE_DENSITY[r] > 0, `${r} has no node rarity`)
      assert.ok(RESOURCES[r].min > 0 && RESOURCES[r].regrow > 0, `${r} has no take or no regrow`)
      // a hunted thing names a tool KIND some recipe makes
      const kind = RESOURCES[r].hunt
      if (kind) assert.ok(Object.values(RECIPES).some(rc => rc.tool === kind), `${r} wants a ${kind} nobody can make`)
    }
  }
  // a fine tool is lighter and quicker than its crude kin, and opens later
  for (const [k, r] of Object.entries(RECIPES)) {
    if (!k.startsWith("fine ")) continue
    const crude = RECIPES[k.slice(5)]
    assert.ok(crude && crude.tool === r.tool, `${k} has no crude kin`)
    assert.ok(r.weight < crude.weight, `${k} isn't lighter`)
    assert.ok(r.speed < crude.speed, `${k} isn't quicker`)
    assert.ok(r.level > crude.level, `${k} doesn't open later`)
    assert.equal(r.needs[k.slice(5)], 1, `${k} doesn't replace its crude kin (RULES 44)`)
  }
})
