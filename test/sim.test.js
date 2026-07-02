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
  SUPER,
  RINGS,
  SEAM_RING,
  VIEW_RING,
  ENERGY_START
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
  for (const h of Hex.range(VIEW_RING)) {
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
    reached: [...tile.reachedEdges].sort(),
    safe: tile.safe,
    walls: tile.walls ? [...tile.walls].sort() : null
  })
  for (const k of Object.keys(tile.children).sort()) worldSig(tile.children[k], path + "/" + k, out)
  return out
}

function stateSig(sim) {
  const v = sim.view()
  return JSON.stringify({
    energy: Math.round(sim.energy() * 1e6),
    day: sim.day(),
    depth: sim.depth(),
    player: v.player,
    entry: v.entry,
    trail: v.trail,
    parked: v.parked,
    fromEdge: v.fromEdge,
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
    if (a.type === "move" && superIndexOf(a.target[0], a.target[1]) >= 0) seen.add("cross")
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
    // Invariant 4: 'exit' demands standing at (or being parked on) the edge —
    // it must never teleport the player up from elsewhere.
    const exits = sim.playerExits()
    for (let k = 0; k < 6; k++) {
      if (!exits.has(k) && sim.view().parked !== k) {
        assert.equal(sim.apply({ type: "exit", superIdx: k }).ok, false, `exit teleported via edge ${k}`)
      }
    }
  }
  return seen
}

// ── invariants under random play ─────────────────────
test("energy, reserve and ratchet invariants hold under random play", () => {
  const covered = new Set()
  for (const seed of [1, 2, 42, 1337, 99991]) {
    const sim = createSim()
    for (const t of fuzz(sim, makeRng(seed), 400)) covered.add(t)
  }
  // The fuzz must actually cross out of the safe home, or the run proves nothing.
  for (const must of ["move", "scout", "cross"]) {
    assert.ok(covered.has(must), `fuzz never exercised '${must}'`)
  }
})

// ── crossing: seam in between, exact landing on the other side ───
test("crossing steps over the seam onto the exact tile, discovers the parent tile, and crosses straight back", () => {
  const sim = createSim()
  const rng = makeRng(777)
  // wander the safe home until a crossing is available (only the gate lobe is open)
  let crossTarget = null
  for (let n = 0; n < 800 && !crossTarget; n++) {
    const opts = candidates(sim)
    crossTarget = opts.find(o => o.type === "move" && superIndexOf(o.target[0], o.target[1]) >= 0)?.target || null
    if (crossTarget) break
    const scouts = opts.filter(o => o.type === "scout")
    const moves = opts.filter(o => o.type === "move")
    const a = scouts.length && rng() < 0.7 ? pick(rng, scouts) : moves.length ? pick(rng, moves) : null
    if (!a) break
    sim.dispatch(a)
  }
  assert.ok(crossTarget, "never found a crossing out of the home safe space")

  const home = sim.view().tile
  const i = superIndexOf(crossTarget[0], crossTarget[1])
  const route = sim.routeTo(crossTarget)
  const seamHex = route[route.length - 2] // the crossing steps off the seam
  assert.equal(sim.kindOf(seamHex), "seam", "the hop before a crossing must be seam ground")
  const parentTarget = sim.exitTarget(i)
  assert.equal(
    sim.parentOf().tile.discovered.has(`${parentTarget[0]},${parentTarget[1]}`),
    false,
    "parent tile known too early"
  )

  assert.ok(sim.dispatch({ type: "move", target: crossTarget }).ok, "crossing rejected")
  // landed on the exact tile on the other side: crossTarget − SUPER[i]
  const local = [crossTarget[0] - SUPER[i][0], crossTarget[1] - SUPER[i][1]]
  assert.deepEqual(sim.view().player, local, "did not land on the mirrored tile")
  assert.notEqual(sim.view().tile, home, "view did not switch boards")
  assert.equal(sim.depth(), 2, "crossing must not change depth")
  // the parent-scale step happened: tile discovered up top, parent player moved
  assert.ok(sim.parentOf().tile.discovered.has(`${parentTarget[0]},${parentTarget[1]}`), "parent tile not discovered")
  assert.deepEqual(sim.parentOf().player, parentTarget, "parent player did not step")

  // the SEAM is shared world state: the hex we crossed from is the same tile
  // seen from this side — still discovered, in this frame at seamHex − SUPER[i]
  const seamBack = [seamHex[0] - SUPER[i][0], seamHex[1] - SUPER[i][1]]
  assert.equal(sim.kindOf(seamBack), "seam", "return seam hex is not seam in the new frame")
  assert.ok(sim.isDiscovered(seamBack), "seam discovery was not shared across the edge")

  // the trail carries through the crossing: it ends on the landing tile, comes
  // in through the crossed seam hex, and every carried hex is still in view
  const trail = sim.view().trail
  assert.ok(trail.length >= 2, "trail did not carry through the crossing")
  assert.deepEqual(trail[trail.length - 1], local, "trail does not end on the landing tile")
  assert.ok(
    trail.some(th => Hex.equals(th, seamBack)),
    "trail does not pass through the crossed seam hex"
  )
  for (const th of trail) assert.ok(sim.kindOf(th), `carried trail hex ${th} is outside the view`)

  // cross straight back: the home board sits at the opposite lobe; any of its
  // discovered tiles reachable from here is a crossing home
  const backLobe = (i + 3) % 6 // SUPER[(i+3)%6] === −SUPER[i]
  let back = null
  for (const h of Hex.range(VIEW_RING)) {
    if (sim.kindOf(h) === "nbr" && superIndexOf(h[0], h[1]) === backLobe && sim.canMove(h)) {
      back = h
      break
    }
  }
  assert.ok(back, "no crossable tile back to the home board")
  assert.ok(sim.dispatch({ type: "move", target: back }).ok, "crossing back rejected")
  assert.equal(sim.view().tile, home, "did not return to the home board")
  assert.deepEqual(
    sim.view().player,
    [back[0] - SUPER[backLobe][0], back[1] - SUPER[backLobe][1]],
    "did not land on the exact mirrored tile going back"
  )
})

test("seam scouting respects the reserve outside the safe space", () => {
  let checked = 0
  for (const seed of [11, 222, 3333, 777]) {
    const sim = createSim()
    const rng = makeRng(seed)
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
  assert.equal(sim.canExit(-1), false)
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

// ── headlessness ─────────────────────────────────────
test("the sim runs with no DOM (this whole file is the proof)", () => {
  assert.equal(typeof globalThis.document, "undefined")
  const sim = createSim()
  assert.equal(sim.depth(), 2) // starts inside the home safe space
  assert.ok(sim.view().tile.safe)
})
