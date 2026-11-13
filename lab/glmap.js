// THE GPU MAP, ON ITS OWN — the lab's test of lib/glmap.js: the world from
// your save (or, with no save, a fresh one), drawn as instanced hexes. Wheel to
// zoom about the pointer, drag to pan; SWEEP runs the zoom in and out by
// itself so the frame rate can be read off a long run. Nothing here is the game.

import { createHexMap, hexInstances, sunShadow, STRIDE, KINDS, MOTIFS, DEFAULT_MOTIFS, DEFAULT_STRENGTH } from "../lib/glmap.js"
import { KEYS } from "../lib/keys.js"
import { prepareSim, savedWorld } from "../lib/grid.js"
import { createSim, worldKeyFor } from "../lib/sim.js"
import { RIVER_RIPPLE, WATER, nightPair, baseTileSize } from "../lib/render.js"
import { sunState } from "../lib/clock.js"
import { zoomAt } from "../lib/zoom.js"
import * as Hex from "../lib/hex.js"

const SURFACE = "#f2f1ee" // the game's own paper and ink (index.html :root)
const INK = "#1b1b1b"
const WORLD_R = 75 // the whole world: every tile on the map out to here (as world.html)
const SWEEP_MS = 4000 // one sweep, fitted out to close in and back
const SWEEP_PX = 120 // …the closest it goes: a tile this many px across its radius

const canvas = document.getElementById("gl")
const statsEl = document.getElementById("stats")
const btn = id => document.getElementById(id)
// a shader that won't compile says so on the page, not in a silent console
let map = null
let mapErr = null
try {
  map = createHexMap(canvas)
} catch (e) {
  mapErr = String(e.message || e)
}
const NIGHT = nightPair(INK, SURFACE, -1, true) // the pinned night pair the game paints the fog in
document.body.style.background = NIGHT.surface // the fog's own coat

let sim = null
let mode = "found"
const sets = { found: null, whole: null } // the tiles as numbers, per mode
let span = 1 // the farthest tile's centre from the middle, in tile radii
let cam = { x: 0, y: 0, s: 8 } // the world point at the centre (tile radii) and px per tile radius
let fitS = 8
let sweeping = false
let textures = true
// EACH KIND'S MOTIF, picked here and remembered — and how dark their lines are
const stored = (k, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? fallback
  } catch {
    return fallback
  }
}
let motifs = DEFAULT_MOTIFS.slice()
const kept = stored(KEYS.labGlMotifs, null)
if (Array.isArray(kept) && kept.length === motifs.length) motifs = kept.map((v, i) => (Number.isInteger(v) && v >= 0 && v < MOTIFS.length ? v : motifs[i]))
let strength = Number(stored(KEYS.labGlStrength, DEFAULT_STRENGTH)) || DEFAULT_STRENGTH
const keep = () => {
  try {
    localStorage.setItem(KEYS.labGlMotifs, JSON.stringify(motifs))
    localStorage.setItem(KEYS.labGlStrength, JSON.stringify(strength))
  } catch {}
}
let sweepT0 = 0
const stats = { frames: 0, since: 0, fps: null, sum: 0, worst: 0, shown: null }

const randKey = () => [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, "0")).join("")

async function load() {
  if (!map) {
    statsEl.textContent = mapErr || "no WebGL2 here"
    return
  }
  const w = savedWorld()
  if (w) sim = await prepareSim(w)
  else {
    const pubkey = randKey()
    const angle = Math.floor(Math.random() * 360)
    sim = createSim({ angle, pubkey, worldKey: worldKeyFor(pubkey, angle) })
    mode = "whole" // nothing found in a fresh world: show all of it
  }
  use(mode)
}

// THE TILES FOR A MODE, built once each: what you've found, or every tile on the map
function use(m) {
  mode = m
  if (!sets[m]) {
    if (m === "found") sets.found = hexInstances(sim, sim.discovered())
    else {
      const all = Hex.range(WORLD_R).filter(g => sim.onMap(g))
      sets.whole = hexInstances(sim, all, new Set(all.map(Hex.key)))
    }
  }
  const t = sets[m]
  map.setTiles(t)
  span = 1
  for (let i = 0; i < t.count; i++) span = Math.max(span, Math.hypot(t.data[i * STRIDE], t.data[i * STRIDE + 1]) + 1)
  btn("found").setAttribute("aria-pressed", String(m === "found"))
  btn("whole").setAttribute("aria-pressed", String(m === "whole"))
  fit()
}

function fit() {
  fitS = (Math.min(innerWidth, innerHeight) * 0.47) / span
  cam = { x: 0, y: 0, s: fitS }
  redraw()
}

function frame() {
  const now = performance.now()
  if (sweeping) {
    const u = 0.5 - 0.5 * Math.cos(((now - sweepT0) / SWEEP_MS) * Math.PI * 2)
    cam = { x: cam.x, y: cam.y, s: fitS * Math.pow(Math.max(1, SWEEP_PX / fitS), u) }
  }
  const t0 = performance.now()
  map.draw({
    cam,
    zoom: cam.s,
    unit: baseTileSize({ w: innerWidth, h: innerHeight }, sim), // the game's 1:1 tile in this window: lines at their game widths there
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio || 1,
    startDeg: sim.orient().startDeg,
    ground: SURFACE,
    ink: INK,
    paper: SURFACE,
    stream: WATER, // one water: the streams in the sea's blue too
    ripple: RIVER_RIPPLE,
    fog: { ink: NIGHT.ink, surface: NIGHT.surface },
    // the sun where the save's day stands (the minutes spent)
    shadow: sunShadow(sunState({ day: sim.day(), minuteOfDay: sim.dayBudget() - sim.energy(), cx: 0, cy: 0, R: 1 })),
    textures,
    motifs,
    textureStrength: strength
  })
  const ms = performance.now() - t0
  // the frame rate, read while frames run back to back (a sweep)
  stats.frames++
  stats.sum += ms
  stats.worst = Math.max(stats.worst, ms)
  if (!stats.since) stats.since = now
  if (now - stats.since >= 500) {
    stats.shown = {
      fps: sweeping ? (stats.frames * 1000) / (now - stats.since) : null,
      ms: stats.sum / stats.frames,
      worst: stats.worst
    }
    stats.frames = stats.sum = stats.worst = 0
    stats.since = now
  }
  showStats()
  if (sweeping) requestAnimationFrame(frame)
}

let queued = false
function redraw() {
  if (queued || sweeping) return
  queued = true
  requestAnimationFrame(() => {
    queued = false
    stats.since = 0 // one-off frames are no frame rate
    frame()
  })
}

function showStats() {
  const S = stats.shown
  const rows = [
    ["tiles", String(sets[mode]?.count ?? 0)],
    ["tile radius", `${cam.s.toFixed(1)} px`],
    ["game's 1:1", `${baseTileSize({ w: innerWidth, h: innerHeight }, sim).toFixed(1)} px`],
    ["fps", S?.fps ? String(Math.round(S.fps)) : "– (sweep to read)"],
    ["draw", S ? `${S.ms.toFixed(2)} ms` : "–"],
    ["worst", S ? `${S.worst.toFixed(2)} ms` : "–"]
  ]
  statsEl.replaceChildren(
    ...rows.flatMap(([k, v]) => {
      const a = document.createElement("span")
      const b = document.createElement("span")
      a.textContent = k
      b.textContent = v
      return [a, b]
    })
  )
}

// ── the hand: wheel to zoom about the pointer, drag to pan ──
let drag = null
canvas.addEventListener("pointerdown", e => {
  drag = { x: e.clientX, y: e.clientY }
  canvas.setPointerCapture(e.pointerId)
  canvas.style.cursor = "grabbing"
})
canvas.addEventListener("pointermove", e => {
  if (!drag) return
  cam = { x: cam.x - (e.clientX - drag.x) / cam.s, y: cam.y - (e.clientY - drag.y) / cam.s, s: cam.s }
  drag = { x: e.clientX, y: e.clientY }
  redraw()
})
canvas.addEventListener("pointerup", () => {
  drag = null
  canvas.style.cursor = "grab"
})
canvas.addEventListener(
  "wheel",
  e => {
    e.preventDefault()
    cam = zoomAt(cam, { x: e.clientX, y: e.clientY }, { x: innerWidth / 2, y: innerHeight / 2 }, e.deltaY, fitS * 0.5, 400)
    redraw()
  },
  { passive: false }
)
btn("found").onclick = () => sim && use("found")
btn("whole").onclick = () => sim && use("whole")
btn("fit").onclick = () => sim && fit()
btn("tex").onclick = () => {
  textures = !textures
  btn("tex").setAttribute("aria-pressed", String(textures))
  if (sim) redraw()
}
btn("sweep").onclick = () => {
  if (!sim) return
  sweeping = !sweeping
  btn("sweep").setAttribute("aria-pressed", String(sweeping))
  if (sweeping) {
    sweepT0 = performance.now()
    stats.since = 0
    requestAnimationFrame(frame)
  }
}
addEventListener("resize", () => sim && redraw())

// THE PICKERS: a motif for each kind, and how dark their lines are
function pickers() {
  const host = document.getElementById("motifs")
  const named = text => {
    const s = document.createElement("span")
    s.textContent = text
    return s
  }
  const rows = KINDS.flatMap((kind, i) => {
    const sel = document.createElement("select")
    MOTIFS.forEach((m, id) => sel.append(new Option(m, String(id), false, motifs[i + 1] === id)))
    sel.onchange = () => {
      motifs[i + 1] = Number(sel.value)
      keep()
      if (sim) redraw()
    }
    return [named(kind), sel]
  })
  const range = document.createElement("input")
  range.type = "range"
  range.min = "0.05"
  range.max = "0.8"
  range.step = "0.05"
  range.value = String(strength)
  range.oninput = () => {
    strength = Number(range.value)
    keep()
    if (sim) redraw()
  }
  const reset = document.createElement("button")
  reset.textContent = "defaults"
  reset.onclick = () => {
    motifs = DEFAULT_MOTIFS.slice()
    strength = DEFAULT_STRENGTH
    keep()
    pickers()
    if (sim) redraw()
  }
  host.replaceChildren(...rows, named("strength"), range, named(""), reset)
}
pickers()

load()
