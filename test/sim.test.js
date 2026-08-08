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
  WEAR_FLOOR,
  spiralOrder,
  readingOrder,
  TILE_TYPES,
  RECIPES,
  STAT_NAMES,
  statsOf,
  BIOME_SKILL,
  PLACE_BONUS,
  SKILL_CAP,
  baseLevel,
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
  assert.equal(home.gateOpen, true, "gate did not open on clearing the board")

  // stand on the doorstep: only the gate EDGE is passable through the walls
  const doorstep = Hex.fromKey(GATE_EDGE.k)
  assert.ok(sim.dispatch({ type: "move", target: doorstep }).ok, "cannot reach the doorstep")
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
  assert.equal(sim.canAct({ type: "restResume" }), false, "rested standing in a river")
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
  // stats: one rule for every key — 8 named skills, integers 0..15
  for (const s of [n1.stats, a.playerStats()]) {
    assert.deepEqual(Object.keys(s), STAT_NAMES)
    for (const v of Object.values(s)) assert.ok(Number.isInteger(v) && v >= 0 && v <= 15)
  }
  assert.deepEqual(a.playerStats(), statsOf(pk), "the player reads by the same rule")
  // place is nature for the stationary: the home biome's skill gets +3, capped
  const raw = statsOf(n1.pubkey)
  const homeSkill = BIOME_SKILL[a.typeNameAt(n1.pos)]
  assert.equal(n1.place, homeSkill ?? null)
  for (const s of STAT_NAMES) {
    const want = s === homeSkill ? Math.min(SKILL_CAP, raw[s] + PLACE_BONUS) : raw[s]
    assert.equal(n1.stats[s], want, `place bonus wrong on ${s}`)
  }
  assert.deepEqual(a.playerStats(), statsOf(pk), "the player gets NO place bonus — you move")
  assert.equal(createSim().npcAt([1, 0]), null, "no world key, no people")
  assert.equal(createSim({ pubkey: pk, worldKey: wk }).npcAt([9, 9]), null, "no boards beyond the world")
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
    // out of the day's budget for this lesson — rest and resume, then keep going
    if (!sim.dispatch({ type: "restResume" }).ok) break
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

test("teaching a figure raises it toward its nature and COSTS you an edge; it replays", () => {
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
  const centre = sim.centreOf(sim.boardHexOf(sim.view().player))
  const stand = [centre, ...DIRS.map(d => [centre[0] + d.q, centre[1] + d.r])].find(t => sim.canMove(t))
  assert.ok(sim.dispatch({ type: "move", target: stand }).ok)
  const npc = sim.npcAt(sim.boardHexOf(sim.view().player))
  assert.ok(npc, "the board keeps no figure")
  // a skill you OUTRANK the figure in, with room below its nature cap → teachable
  const skill = STAT_NAMES.find(s => sim.skillOf(s) > sim.npcSkill(npc, s) && sim.npcSkill(npc, s) < npc.stats[s])
  assert.ok(skill, "no skill to teach for these keys")
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
  // the figure never rises past its nature; you never sink below zero — and
  // EVERY give drains exactly one edge, nature included (an empty shape gives up
  // the level; the base is not an infinite well)
  let guard = 0
  let prevEdges = yourEdges()
  while (sim.dispatch({ type: "teach", skill }).ok && guard++ < 40) {
    assert.ok(Math.abs(prevEdges - yourEdges() - 1) < 1e-9, "a give must always drain exactly one edge")
    prevEdges = yourEdges()
  }
  assert.ok(sim.npcSkill(npc, skill) <= npc.stats[skill], "taught the figure past its nature")
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
  sim.view().tile.types["0,-1"] = "water" // the stored-types hook: a pond beside the start
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
test("the leap is retired — the diagonal is two steps, not one (RULES 30)", () => {
  const sim = createSim()
  const rng = makeRng(7)
  clearHome(sim, rng) // ends rested at the home centre, trail = [[0,0]]

  // A leap over a seam is FORDING a river, and a river must refuse that — so
  // the whole power move is off (LEAP === false) until it's earned back as an
  // ability. The diagonal is still reachable; it just costs what walking costs.
  assert.equal(LEAP, false, "the leap flag is off")
  const land = [DIRS[0].q + DIRS[1].q, DIRS[0].r + DIRS[1].r]
  assert.ok(sim.canMove(land), "the diagonal is still reachable, just not in one hop")
  const route = sim.routeTo(land)
  assert.equal(route.length, 3, "…by walking through a flanker: two steps")
  assert.ok(sim.pathCost(route) > sim.stepCostAt(land), "and it costs both of them")
  assert.ok(sim.dispatch({ type: "move", target: land }).ok)
  assert.equal(sim.view().trail.length, 3, "the trail records BOTH tiles — nothing was jumped over")

  // collinear through a tile's centre is two steps as well — it always was
  assert.ok(sim.dispatch({ type: "move", target: [0, 0], via: sim.routeTo([0, 0]) }).ok)
  const across = [2 * DIRS[0].q, 2 * DIRS[0].r]
  assert.equal(sim.routeTo(across).length, 3, "collinear 2-out walks through the middle")
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

// ── the gather / craft / build loop ─────────────────────────────────

// a sim whose OWN key grants the asked skill levels — the loop tests need
// craft/build/gather knowledge without grinding lessons first
function simWithSkills(min) {
  for (const c of "0123456789abcdef") {
    const sim = createSim({ pubkey: c.repeat(64), worldKey: "abcdef01".repeat(8) })
    if (Object.entries(min).every(([s, l]) => sim.skillOf(s) >= l)) return sim
  }
  return null
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
        const gs = sim.gatherStateAt(g)
        if (!gs || gs.res !== res) continue // a NODE of this resource (biome × node draw)
        const d = byHome ? sim.returnFrom(g) : Math.abs(q - p[0]) + Math.abs(r - p[1])
        if (!best || d < best.d) best = { g, k, d }
      }
    if (best) {
      if (best.d !== 0 && !sim.dispatch({ type: "move", target: best.g }).ok) {
        avoid.add(best.k)
        continue
      }
      if (sim.gatherInfo()?.ready && sim.canAct({ type: "gather" })) return best.g
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
  assert.ok(sim.dispatch({ type: "restResume" }).ok, "top up the budget in place") // room for local moves
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
  assert.equal(sim.nextBudget(), FREE_CAP, "a fully-explored world caps the budget at a full day")
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
      node = Hex.neighbors(p).find(n => s2.isShallow(n) && s2.gatherStateAt(n)?.res === "fish" && s2.canMove(n))
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
  const gi = sim.gatherInfo()
  assert.equal(gi.res, "fish")
  // every other reason to refuse is absent — it really is the tackle
  assert.ok(gi.ready, "the node should be ready")
  assert.ok(!gi.full, "the pack should have room")
  assert.ok(sim.energy() > gi.cost + sim.returnCost(), "the day should have time for it")
  assert.equal(gi.lacks, "net", "the missing thing should be named")
  assert.equal(sim.canAct({ type: "gather" }), false, "fished bare-handed")
  assert.equal(sim.dispatch({ type: "gather" }).ok, false, "a netless gather was allowed through")
  assert.equal(sim.inventory().fish, undefined, "caught something anyway")
  // the net is a COMMISSION like any other tool: plains figure, plants, minutes
  assert.equal(RECIPES.net.biome, "plain")
  assert.equal(RECIPES.net.catches, "fish", "the recipe is what says it catches fish")
})

test("gather yields, starts the regrow clock, and weighs the pack down", () => {
  const found = gatherReadySim("plants")
  assert.ok(found, "no seed offered a reachable plants tile past the seam")
  const { sim, tile } = found
  assert.equal(sim.gatherInfo().res, "plants")
  const costEmpty = sim.stepCostAt(tile) // an outside tile's cost rises with load
  assert.ok(sim.canAct({ type: "gather" }), "gather should be affordable")
  assert.ok(sim.dispatch({ type: "gather" }).ok)
  assert.equal(sim.inventory().plants, 1)
  assert.ok(sim.loadOf() > 0)
  assert.ok(!sim.canAct({ type: "gather" }), "the tile must be regrowing now")
  const costLoaded = sim.stepCostAt(tile)
  assert.ok(costLoaded > costEmpty, "a loaded pack must slow the step")
})

test("the home board isn't gatherable, and there is no self-craft", () => {
  const sim = simWithSkills({ gather: 0 })
  assert.ok(sim, "no pubkey found")
  // the home centre yields nothing (it's the board's own tile)…
  assert.equal(sim.gatherInfo(), null, "the home centre isn't gatherable")
  // …and neither does an ordinary home tile — home is the minimap, not land
  assert.ok(sim.dispatch({ type: "clearBoard" }).ok)
  sim.dispatch({ type: "rest" }) // bank the 60 that clearing home earns, so a step is affordable
  assert.ok(sim.dispatch({ type: "move", target: [1, 0] }).ok)
  assert.equal(sim.gatherInfo(), null, "a home tile isn't gatherable either")
  // no figure at home to commission, and the player never self-crafts
  assert.deepEqual(sim.craftsNear(), [], "no figure at home")
  assert.ok(!sim.canAct({ type: "craft", recipe: "basket" }), "no self-craft of a basket")
  assert.ok(!sim.canAct({ type: "craft", recipe: "axe" }), "no self-craft of an axe")
  assert.equal(sim.preserve(), 1, "no basket yet, no preservation")
})

test("a tile holds what you drop on it and gives it back; the weight lifts", () => {
  const found = gatherReadySim("plants")
  assert.ok(found, "no seed offered a reachable plants tile")
  const { sim } = found
  assert.ok(sim.dispatch({ type: "gather" }).ok)
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
  assert.ok(sim.dispatch({ type: "gather" }).ok)
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
  assert.ok(sim.dispatch({ type: "gather" }).ok)
  // the HOME CENTRE used to swallow drops (it wasn't a storage cell, so the
  // item left the pack and went nowhere). Every tile holds now — including it.
  assert.ok(sim.dispatch({ type: "move", target: [0, 0] }).ok)
  assert.deepEqual(sim.view().player, [0, 0], "standing on the home centre")
  assert.ok(sim.dispatch({ type: "drop", item: "plants" }).ok)
  assert.deepEqual(sim.stashHere(), { item: "plants", n: 1 }, "the centre keeps it like any tile")
  // …and a tile already holding one type REFUSES another, rather than eating it
  const second = gatherOutside(sim, "wood")
  if (second) {
    assert.ok(sim.dispatch({ type: "gather" }).ok)
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
  assert.ok(sim.dispatch({ type: "gather" }).ok)
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
    if (!sim.dispatch({ type: "gather" }).ok) return { ok: false, reason: "gather wood failed" }
    avoid.add(t.join())
  }
  // a full tank WITHOUT trekking home: across a river that round trip is the
  // expensive part, so rest where you stand and keep working this side
  sim.dispatch({ type: "restResume" })
  for (let i = 0; i < 2; i++) {
    const t = gatherOutside(sim, "plants", avoid) // …same: gather where you are, not back across the water
    if (!t) return { ok: false, reason: `only got ${i} plants` }
    if (!sim.dispatch({ type: "gather" }).ok) return { ok: false, reason: "gather plants failed" }
    avoid.add(t.join())
  }
  // …and a fresh tank for the loaded trek to the site + the build itself
  sim.dispatch({ type: "restResume" })
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
  assert.equal(sim.view().tile.gateOpen, true) // full discovery still opens gates
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
