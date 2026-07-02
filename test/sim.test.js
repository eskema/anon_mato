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
  SUPER,
  RINGS,
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

test("every parked edge-centre tile borders its edge", () => {
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

test("superIndexOf is safe off the lattice and covers all six lobes", () => {
  assert.equal(superIndexOf(100, 100), -1) // far away → -1, never a crash
  SUPER.forEach(([q, r], i) => assert.equal(superIndexOf(q, r), i))
})

// ── fuzzing helpers ──────────────────────────────────
// Enumerate currently-valid actions the UI could produce.
function candidates(sim) {
  const out = []
  const v = sim.view()
  if (v.parked >= 0) {
    for (const t of edgeTilesInto(v.parked)) {
      if (!sim.isDiscovered(t)) out.push({ type: "scout", target: t })
      else out.push({ type: "stepIn", to: t })
    }
    if (sim.canSlide(v.parked)) out.push({ type: "slide", superIdx: v.parked })
  } else {
    for (const [q, r] of Hex.range(RINGS)) {
      const t = [q, r]
      if (sim.canMove(t) && !Hex.equals(t, v.player)) out.push({ type: "move", target: t })
      else if (sim.isFrontier(t) && sim.canScout(t)) out.push({ type: "scout", target: t })
    }
    if (sim.canEnter()) out.push({ type: "enter" })
    for (const i of sim.playerExits()) {
      if (sim.canDiscoverEdge(i)) out.push({ type: "discoverEdge", superIdx: i })
      else if (sim.canExit(i)) out.push({ type: "park", superIdx: i })
    }
  }
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
    const sizeBefore = sim.view().tile.discovered.size
    const r = sim.dispatch(a)
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
  // The fuzz must actually leave the safe home interior, or the run proves nothing.
  for (const must of ["move", "scout", "discoverEdge", "park", "slide", "stepIn"]) {
    assert.ok(covered.has(must), `fuzz never exercised '${must}'`)
  }
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
  assert.equal(sim.apply({ type: "park", superIdx: -1 }).ok, false)
  assert.equal(sim.apply({ type: "slide", superIdx: -1 }).ok, false)
  assert.equal(sim.apply({ type: "exit", superIdx: -1 }).ok, false)
  assert.equal(sim.apply({ type: "discoverEdge", superIdx: -1 }).ok, false)
  assert.equal(sim.apply({ type: "move", target: [3, -3] }).ok, false) // undiscovered
  assert.equal(sim.apply({ type: "stepIn", to: [0, 0] }).ok, false) // not parked
  assert.equal(sim.apply({ type: "bogus" }).ok, false)
  assert.equal(sim.canExit(-1), false)
  assert.equal(sim.canDiscoverEdge(-1), false)
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

test("parked scouting respects the reserve (regression: it used to skip all checks)", () => {
  const sim = createSim()
  const rng = makeRng(31337)
  let checked = 0
  for (let n = 0; n < 600; n++) {
    const opts = candidates(sim)
    if (!opts.length) break
    const types = [...new Set(opts.map(o => o.type))]
    const type = pick(rng, types)
    sim.dispatch(pick(rng, opts.filter(o => o.type === type)))
    const v = sim.view()
    if (v.parked >= 0 && !v.tile.safe) {
      for (const t of edgeTilesInto(v.parked)) {
        if (sim.isDiscovered(t)) continue
        const affordable = sim.scoutCost() + sim.returnCost() <= sim.energy()
        const r = sim.dispatch({ type: "scout", target: t })
        assert.equal(r.ok, affordable, "parked scout affordability mismatch")
        if (r.ok) {
          assert.ok(sim.energy() > -1e-9)
          assert.ok(sim.returnCost() <= sim.energy() + 1e-9, "parked scout broke the reserve")
        }
        checked++
        break
      }
    }
  }
  assert.ok(checked > 0, "fuzz never reached a parked non-safe state; adjust the seed")
})

// ── headlessness ─────────────────────────────────────
test("the sim runs with no DOM (this whole file is the proof)", () => {
  assert.equal(typeof globalThis.document, "undefined")
  const sim = createSim()
  assert.equal(sim.depth(), 2) // starts inside the home safe space
  assert.ok(sim.view().tile.safe)
})
