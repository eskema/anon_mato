// Replay a save event-by-event through the LIVE dispatch (can() enforced) and
// probe the reserve invariant after every action: energy must always cover the
// way back to a rest spot (returnCost). Prints every action of the days given
// on the command line (default: the last day), flagging rejections and
// invariant breaks — the exact commit that stranded the player.
//
//   node lab/diagnose-stranded.mjs [dayFrom [dayTo]]
import { readFileSync } from "node:fs"
import { createSim } from "../lib/sim.js"

const save = JSON.parse(readFileSync(new URL("./stranded-save.json", import.meta.url)))
const days = save.days
const dayFrom = Number(process.argv[2] ?? days[days.length - 1].day)
const dayTo = Number(process.argv[3] ?? dayFrom)

const sim = createSim(save.world)
const fmt = n => (Number.isFinite(n) ? Math.round(n * 100) / 100 : "∞")
const label = a =>
  a.type + (a.target ? ` ${JSON.stringify(a.target)}` : "") + (a.via ? ` via ${a.via.length - 1} steps` : "") + (a.skill ? ` ${a.skill}` : "")

let broke = null
for (const d of days) {
  const verbose = d.day >= dayFrom && d.day <= dayTo
  if (verbose) console.log(`\n== day ${d.day} ==`)
  for (const a of d.actions) {
    const before = { e: sim.energy(), ret: sim.returnCost(), at: sim.view().player.slice() }
    // what viaValid compares for a move: charge of the via + the way back from
    // its end (retAfterPath = landBack for land targets) against energy
    const probeMove = a.type === "move" && a.via && a.via.length >= 4 && d.day >= dayFrom && d.day <= dayTo
    if (a.type === "move" && a.via && d.day >= dayFrom && d.day <= dayTo) {
      const charge = sim.pathCharge(a.via)
      const back = sim.retAfterPath(a.via)
      const rf = sim.returnFrom(a.target)
      console.log(
        `    viaValid sees: charge ${fmt(charge)} + back ${fmt(back)} = ${fmt(charge + back)} vs e ${fmt(sim.energy())}` +
          `   (returnFrom(target) ${fmt(rf)})`
      )
      if (probeMove) {
        const end = a.via[a.via.length - 1]
        const prev = a.via[a.via.length - 2]
        for (const t of a.via)
          console.log(
            `      via ${JSON.stringify(t)} navWater ${sim.navWater(t)} returnFrom ${fmt(sim.returnFrom(t))} worn ${sim.wornAt(t)}`
          )
        console.log(`      PRE  returnVia(end, prev) = ${fmt(sim.returnVia(end, prev))}`)
      }
    }
    const r = sim.dispatch(a)
    if (probeMove) {
      const end = a.via[a.via.length - 1]
      const prev = a.via[a.via.length - 2]
      console.log(`      POST returnVia(end, prev) = ${fmt(sim.returnVia(end, prev))}  returnCost ${fmt(sim.returnCost())}`)
      for (const t of a.via) console.log(`      post ${JSON.stringify(t)} returnFrom ${fmt(sim.returnFrom(t))}`)
    }
    const after = { e: sim.energy(), ret: sim.returnCost(), at: sim.view().player.slice() }
    const bad = !r.ok || (a.type !== "rest" && a.type !== "goHome" && after.e + 1e-9 < after.ret)
    if (verbose || bad) {
      console.log(
        `${r.ok ? "ok " : "REJ"} ${label(a).padEnd(46)} ` +
          `e ${fmt(before.e)}→${fmt(after.e)}  ret ${fmt(before.ret)}→${fmt(after.ret)}` +
          `${bad && r.ok ? "  ← INVARIANT BROKEN (energy < reserve)" : ""}${!r.ok ? `  ← ${r.reason}` : ""}`
      )
    }
    if (bad && r.ok && !broke) broke = { day: d.day, action: a, before, after }
  }
}

if (broke) {
  console.log(`\nFIRST BREAK: day ${broke.day} — ${label(broke.action)}`)
  console.log(`  landed at ${JSON.stringify(broke.after.at)} with energy ${fmt(broke.after.e)} < reserve ${fmt(broke.after.ret)}`)
} else console.log("\nno invariant break found across the whole log")
