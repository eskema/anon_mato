// Dev-only world viewer (world.html) — the whole parent level, fully
// discovered: 61 boards on the real lattice (geometry straight from sim.js),
// terrain derived from a randomizable WORLD KEY via per-board hash streams.
// Drag to pan, wheel to zoom. Not part of the game — a development lens for
// judging terrain rules at the scale they'll actually live at.

import { createSim, readingOrder, RINGS } from "./sim.js"

const sim = createSim()
const key = ([q, r]) => q + "," + r
const DIRS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1]
]

// ── enumerate the whole world once (real lattice, real seams) ────────
const world = new Map() // gkey → { g, kind, boardKey, localKey }
const boardCentres = new Map() // boardKey → global centre [q,r]
{
  const R = 48
  for (let q = -R; q <= R; q++) {
    for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) {
      const g = [q, r]
      const kind = sim.kindOf(g)
      if (!kind) continue
      let boardKey = null
      let localKey = null
      if (kind === "in") {
        const b = sim.boardHexOf(g)
        const c = sim.boardCentreOf(g)
        boardKey = key(b)
        localKey = key([g[0] - c[0], g[1] - c[1]])
        if (!boardCentres.has(boardKey)) boardCentres.set(boardKey, c)
      }
      world.set(key(g), { g, kind, boardKey, localKey })
    }
  }
}
const localIndex = new Map(readingOrder(RINGS).map((t, i) => [key(t), i]))

// ── derivation: world key → per-board nibble streams → values ───────
async function sha256hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("")
}
const randKey = () => {
  const a = new Uint8Array(32)
  crypto.getRandomValues(a)
  return [...a].map(b => b.toString(16).padStart(2, "0")).join("")
}

const state = {
  worldKey: randKey(),
  wl: 4, // water below this (on smoothed values)
  passes: 1, // smoothing passes
  detail: 0.4, // how hard the per-board subkeys tweak the base field
  rawView: false,
  base: new Map(), // gkey → 0..15 float — the WORLD-scale field (key on the parent grid)
  local: new Map(), // gkey → 0..15 int — the per-board subkey nibble
  raw: new Map(), // gkey → combined value (seams get the mean of their flanks)
  smooth: new Map(),
  biome: new Map(), // gkey → type name (interior only)
  counts: {}
}

// the unit-space pitch between adjacent board centres (for base interpolation)
const unitOf = g => ({ x: Math.sqrt(3) * (g[0] + g[1] / 2), y: 1.5 * g[1] })
const PITCH = (() => {
  const a = unitOf(boardCentres.get("0,0"))
  const b = unitOf(boardCentres.get("1,0"))
  return Math.hypot(b.x - a.x, b.y - a.y)
})()

async function derive() {
  // BASE: the world key's own 64 nibbles laid on the PARENT grid in reading
  // order (centre board = the middle four, averaged — the same scheme as the
  // home inscription). This is the macro shape: the world looks like ONE tile.
  const mid = 32
  const centreVal = [...state.worldKey.slice(mid - 2, mid + 2)].reduce((s, c) => s + parseInt(c, 16), 0) / 4
  const rest = state.worldKey.slice(0, mid - 2) + state.worldKey.slice(mid + 2)
  const boardBase = new Map()
  let bi = 0
  for (const t of readingOrder(RINGS)) {
    boardBase.set(key(t), t[0] === 0 && t[1] === 0 ? centreVal : parseInt(rest[bi++], 16))
  }
  // per-tile base: inverse-pitch interpolation over the nearby board centres —
  // continuous across seams, so the macro field never steps at a board edge
  state.base = new Map()
  for (const [gk, t] of world) {
    if (t.kind !== "in") continue
    const p = unitOf(t.g)
    let sum = 0
    let wsum = 0
    for (const [bk, c] of boardCentres) {
      const cu = unitOf(c)
      const d = Math.hypot(p.x - cu.x, p.y - cu.y)
      if (d >= PITCH) continue
      const w = 1 - d / PITCH
      sum += w * boardBase.get(bk)
      wsum += w
    }
    state.base.set(gk, wsum ? sum / wsum : 7.5)
  }
  // DETAIL: per-board subkey streams — local diversity that tweaks the base
  const streams = new Map()
  const boards = [...boardCentres.keys()]
  await Promise.all(
    boards.map(async b => streams.set(b, await sha256hex(state.worldKey + ":board:" + b)))
  )
  state.local = new Map()
  for (const [gk, t] of world) {
    if (t.kind !== "in") continue
    state.local.set(gk, parseInt(streams.get(t.boardKey)[localIndex.get(t.localKey)], 16))
  }
  classify()
}

// combined value = base field ± subkey tweak (detail sets the swing)
function combine() {
  state.raw = new Map()
  for (const [gk, t] of world) {
    if (t.kind !== "in") continue
    const v = state.base.get(gk) + (state.local.get(gk) - 7.5) * state.detail
    state.raw.set(gk, Math.max(0, Math.min(15, v)))
  }
  for (const [gk, t] of world) {
    if (t.kind !== "seam") continue
    let s = 0
    let n = 0
    for (const [dq, dr] of DIRS) {
      const v = state.raw.get(key([t.g[0] + dq, t.g[1] + dr]))
      if (v != null) {
        s += v
        n++
      }
    }
    state.raw.set(gk, n ? s / n : 8)
  }
}

// The terrain-relevant neighbour: straight across a seam if one intervenes
// (seams are roads, transparent to the terrain grammar).
function across(g, d) {
  let n = [g[0] + DIRS[d][0], g[1] + DIRS[d][1]]
  let t = world.get(key(n))
  if (t && t.kind === "seam") {
    n = [n[0] + DIRS[d][0], n[1] + DIRS[d][1]]
    t = world.get(key(n))
  }
  return t && t.kind === "in" ? key(n) : null
}

function classify() {
  combine()
  // smoothing over ALL world tiles (seams carry values so fields cross them)
  let cur = state.raw
  for (let p = 0; p < state.passes; p++) {
    const nx = new Map()
    for (const [gk, t] of world) {
      const v = cur.get(gk)
      let s = 2 * v
      let n = 2
      for (const [dq, dr] of DIRS) {
        const nv = cur.get(key([t.g[0] + dq, t.g[1] + dr]))
        if (nv != null) {
          s += nv
          n++
        }
      }
      nx.set(gk, s / n)
    }
    cur = nx
  }
  state.smooth = cur
  // bases: raw spikes stay mountains, water reads the smoothed field — PLUS
  // highland basins: a tile carved well below its surroundings on high
  // ground holds water (tarns/mountain lakes — the middle ground a smooth
  // base field otherwise forbids; this is what puts water next to mountains)
  const base = new Map()
  for (const [gk, t] of world) {
    if (t.kind !== "in") continue
    const raw = state.raw.get(gk)
    let s = 0
    let n = 0
    for (let d = 0; d < 6; d++) {
      const nk = across(t.g, d)
      if (!nk) continue
      s += state.raw.get(nk)
      n++
    }
    const nbrAvg = n ? s / n : raw
    const tarn = nbrAvg >= 9 && raw <= nbrAvg - 3
    base.set(
      gk,
      tarn ? "water" : raw >= 12 ? "mountain" : state.smooth.get(gk) < state.wl ? "water" : "plain"
    )
  }
  // subtypes from the neighbour grammar (marsh → beach → forest)
  state.biome = new Map()
  for (const [gk, t] of world) {
    if (t.kind !== "in") continue
    const b = base.get(gk)
    let water = 0
    let mountain = 0
    let minNbr = 15
    for (let d = 0; d < 6; d++) {
      const nk = across(t.g, d)
      if (!nk) continue
      if (base.get(nk) === "water") water++
      if (base.get(nk) === "mountain") mountain++
      minNbr = Math.min(minNbr, state.raw.get(nk))
    }
    let out = b
    // a peak is the SUBKEY's own f on mountain ground — one digit in sixteen,
    // the rarest mark in the key, regardless of how high the base runs.
    // A cliff is a mountain over a sharp DROP (≥5) — bands sit 8 levels apart
    // on a smooth base field, so literal mountain-meets-water can't occur;
    // steepness is the honest reading (water contact still qualifies).
    if (b === "mountain")
      out =
        state.local.get(gk) === 15
          ? "peak"
          : water || state.raw.get(gk) - minNbr >= 5
            ? "cliff"
            : "mountain"
    else if (b === "plain") out = water >= 2 ? "marsh" : water ? "beach" : mountain ? "forest" : "plain"
    state.biome.set(gk, out)
  }
  state.counts = {}
  for (const v of state.biome.values()) state.counts[v] = (state.counts[v] || 0) + 1
}

// ── colours ──────────────────────────────────────────
const PAL = {
  water: null, // depth-shaded below
  beach: "#d9c58a",
  marsh: "#3f7d5f",
  plain: "#8fbf5e",
  forest: "#33691e",
  mountain: "#8a877d",
  cliff: "#5d6a72",
  peak: "#f0ede4"
}
const lerp = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t))
const waterCol = v => {
  const t = Math.max(0, Math.min(1, state.wl ? v / state.wl : 0))
  return `rgb(${lerp([12, 68, 124], [91, 155, 216], t)})`
}
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
const mix = (c1, c2, t) => `color-mix(in srgb, ${c1} ${Math.round((1 - t) * 100)}%, ${c2})`

// ── canvas: pan, zoom, draw ──────────────────────────
const cv = document.getElementById("cv")
const ctx = cv.getContext("2d")
let cam = { x: 0, y: 0, s: 8 } // world-unit offset of the view centre + pixels per unit

const unit = g => ({ x: Math.sqrt(3) * (g[0] + g[1] / 2), y: 1.5 * g[1] })
const CORNERS = [...Array(6)].map((_, k) => {
  const a = (Math.PI / 180) * (60 * k - 90)
  return [Math.cos(a), Math.sin(a)]
})

function fit() {
  let mx = 0
  let my = 0
  for (const t of world.values()) {
    const p = unit(t.g)
    mx = Math.max(mx, Math.abs(p.x))
    my = Math.max(my, Math.abs(p.y))
  }
  cam.s = Math.min(cv.clientWidth / (2 * mx + 4), cv.clientHeight / (2 * my + 4))
  cam.x = 0
  cam.y = 0
}

function draw() {
  const dpr = window.devicePixelRatio || 1
  const W = cv.clientWidth
  const H = cv.clientHeight
  cv.width = W * dpr
  cv.height = H * dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H)
  const road = mix(css("--surface") || "#f2f1ee", css("--text") || "#1b1b1b", 0.16)
  const s = cam.s
  for (const [gk, t] of world) {
    const p = unit(t.g)
    const x = W / 2 + (p.x - cam.x) * s
    const y = H / 2 + (p.y - cam.y) * s
    if (x < -2 * s || x > W + 2 * s || y < -2 * s || y > H + 2 * s) continue
    let fill
    if (t.kind === "seam") fill = road
    else if (state.rawView) {
      const b = Math.round((state.raw.get(gk) / 15) * 255)
      fill = `rgb(${b},${b},${b})`
    } else {
      const biome = state.biome.get(gk)
      fill = biome === "water" ? waterCol(state.smooth.get(gk)) : PAL[biome]
    }
    ctx.fillStyle = fill
    ctx.beginPath()
    for (let k = 0; k < 6; k++) {
      const cx = x + CORNERS[k][0] * s * 0.98
      const cy = y + CORNERS[k][1] * s * 0.98
      k ? ctx.lineTo(cx, cy) : ctx.moveTo(cx, cy)
    }
    ctx.closePath()
    ctx.fill()
  }
  const order = ["water", "beach", "marsh", "plain", "forest", "mountain", "cliff", "peak"]
  document.getElementById("legend").innerHTML = order
    .map(b => {
      const c = b === "water" ? waterCol(state.wl * 0.6) : PAL[b]
      return `<span><span style="display:inline-block;width:11px;height:11px;border-radius:2px;background:${c};margin-right:5px;vertical-align:-1px"></span>${b} ${state.counts[b] || 0}</span>`
    })
    .join("")
  document.getElementById("key").textContent = state.worldKey
}

// ── input ────────────────────────────────────────────
let drag = null
cv.addEventListener("pointerdown", e => {
  drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y }
  cv.setPointerCapture(e.pointerId)
  cv.style.cursor = "grabbing"
})
cv.addEventListener("pointermove", e => {
  if (!drag) return
  cam.x = drag.cx - (e.clientX - drag.x) / cam.s
  cam.y = drag.cy - (e.clientY - drag.y) / cam.s
  draw()
})
cv.addEventListener("pointerup", () => {
  drag = null
  cv.style.cursor = "grab"
})
cv.addEventListener(
  "wheel",
  e => {
    e.preventDefault()
    const f = Math.pow(1.0015, -e.deltaY)
    const W = cv.clientWidth
    const H = cv.clientHeight
    const wx = cam.x + (e.clientX - W / 2) / cam.s
    const wy = cam.y + (e.clientY - H / 2) / cam.s
    cam.s = Math.max(1.5, Math.min(60, cam.s * f))
    cam.x = wx - (e.clientX - W / 2) / cam.s
    cam.y = wy - (e.clientY - H / 2) / cam.s
    draw()
  },
  { passive: false }
)

const on = (id, ev, fn) => document.getElementById(id).addEventListener(ev, fn)
on("rnd", "click", async () => {
  state.worldKey = randKey()
  await derive()
  draw()
})
on("wl", "input", e => {
  state.wl = +e.target.value
  document.getElementById("wlv").textContent = state.wl
  classify()
  draw()
})
on("sp", "input", e => {
  state.passes = +e.target.value
  document.getElementById("spv").textContent = state.passes
  classify()
  draw()
})
on("dt", "input", e => {
  state.detail = +e.target.value / 100
  document.getElementById("dtv").textContent = e.target.value
  classify()
  draw()
})
on("raw", "change", e => {
  state.rawView = e.target.checked
  draw()
})
window.addEventListener("resize", draw)

await derive()
fit()
draw()
