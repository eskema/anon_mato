// Dev-only world sandbox (world.html) — the whole parent field, fully
// revealed, read STRAIGHT FROM THE SIM: terrain, forage nodes and step costs
// are the real game rules, not a re-derivation. Randomize the world key to
// reshape the world; toggle each resource to see where it drops; click a
// tile to "stand" there and shade how far you can reach on a full tank.
// Not the game — a lens to test board rules directly.

import { createSim, ENERGY_START } from "./sim.js"
import { biomeColor } from "./render.js"

const key = ([q, r]) => q + "," + r
const DIRS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1]
]
const randKey = () => {
  const a = new Uint8Array(32)
  crypto.getRandomValues(a)
  return [...a].map(b => b.toString(16).padStart(2, "0")).join("")
}

// resource marker colours (match the game's palette family)
const RES_COL = {
  plants: "#8fbf5e",
  fish: "#3f7dbe",
  eggs: "#d9c58a",
  wood: "#33691e",
  rock: "#8a877d",
  metal: "#f0ede4"
}
const RES_ORDER = ["plants", "fish", "eggs", "wood", "rock", "metal"]

const state = {
  // the PUBKEY shapes the continents (the macro height field, inscribed on
  // the parent grid); the WORLD KEY only adds per-board detail. Randomizing
  // just the world key leaves a flat all-plains base — so we seed BOTH.
  pubkey: randKey(),
  worldKey: randKey(),
  show: Object.fromEntries(RES_ORDER.map(r => [r, true])), // which nodes to overlay
  stand: null, // the "stand here" tile [q,r], or null
  reach: null // gkey → one-way charge from stand (Dijkstra), or null
}

let sim = createSim({ pubkey: state.pubkey, worldKey: state.worldKey })
let world = new Map() // gkey → { g, kind }
let centres = [] // board centre tiles

function rebuildWorld() {
  sim = createSim({ pubkey: state.pubkey, worldKey: state.worldKey })
  world = new Map()
  centres = []
  const R = 46
  for (let q = -R; q <= R; q++) {
    for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) {
      const g = [q, r]
      const kind = sim.kindOf(g)
      if (!kind) continue
      world.set(key(g), { g, kind })
      if (kind === "in") {
        const c = sim.boardCentreOf(g)
        if (c && c[0] === g[0] && c[1] === g[1]) centres.push(g)
      }
    }
  }
  state.reach = null // stale under a new world
}

// ── reach: a one-way Dijkstra from `stand` over walkable ground, in the
// sim's own step charges — how far a full tank (ENERGY_START) carries you.
function computeReach() {
  state.reach = null
  if (!state.stand) return
  const start = key(state.stand)
  if (!world.has(start)) return
  const best = new Map([[start, 0]])
  const q = [[0, state.stand]]
  const pop = () => {
    let bi = 0
    for (let i = 1; i < q.length; i++) if (q[i][0] < q[bi][0]) bi = i
    return q.splice(bi, 1)[0]
  }
  while (q.length) {
    const [d, g] = pop()
    if (d > best.get(key(g))) continue
    if (d > ENERGY_START) continue
    for (const [dq, dr] of DIRS) {
      const n = [g[0] + dq, g[1] + dr]
      const nk = key(n)
      const w = world.get(nk)
      if (!w) continue // off the field
      const step = sim.stepCostAt(n)
      if (!isFinite(step)) continue
      const nd = d + step
      if (nd <= ENERGY_START && (best.get(nk) == null || nd < best.get(nk))) {
        best.set(nk, nd)
        q.push([nd, n])
      }
    }
  }
  state.reach = best
}

// ── canvas: pan, zoom, draw ──────────────────────────
const cv = document.getElementById("cv")
const ctx = cv.getContext("2d")
let cam = { x: 0, y: 0, s: 8 }
const unit = g => ({ x: Math.sqrt(3) * (g[0] + g[1] / 2), y: 1.5 * g[1] })
const CORNERS = [...Array(6)].map((_, k) => {
  const a = (Math.PI / 180) * (60 * k - 90)
  return [Math.cos(a), Math.sin(a)]
})
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
const mix = (c1, c2, t) => `color-mix(in srgb, ${c1} ${Math.round((1 - t) * 100)}%, ${c2})`

function fit() {
  let mx = 0
  let my = 0
  for (const t of world.values()) {
    const p = unit(t.g)
    mx = Math.max(mx, Math.abs(p.x))
    my = Math.max(my, Math.abs(p.y))
  }
  cam.s = Math.min(window.innerWidth / (2 * mx + 4), window.innerHeight / (2 * my + 4))
  cam.x = 0
  cam.y = 0
}

const screenOf = g => {
  const p = unit(g)
  return { x: window.innerWidth / 2 + (p.x - cam.x) * cam.s, y: window.innerHeight / 2 + (p.y - cam.y) * cam.s }
}

function draw() {
  const dpr = window.devicePixelRatio || 1
  const W = window.innerWidth
  const H = window.innerHeight
  cv.width = W * dpr
  cv.height = H * dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H)
  const road = mix(css("--surface") || "#f2f1ee", css("--text") || "#1b1b1b", 0.16)
  const ink = css("--text") || "#1b1b1b"
  const s = cam.s
  const counts = {}

  for (const [gk, t] of world) {
    const { x, y } = screenOf(t.g)
    if (x < -2 * s || x > W + 2 * s || y < -2 * s || y > H + 2 * s) continue
    let fill = road
    if (t.kind === "in") {
      const col = biomeColor(sim.typeNameAt(t.g), sim.heightAt(t.g), sim.smoothAt(t.g))
      fill = col || road
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

    // dim tiles OUT of reach when a stand point is set
    if (state.reach && t.kind !== "seam" && state.reach.get(gk) == null) {
      ctx.fillStyle = mix(css("--surface"), "transparent", 0.45)
      ctx.fill()
    }

    // forage-node marker (its resource colour), if toggled on
    if (t.kind === "in") {
      const gs = sim.gatherStateAt(t.g)
      if (gs && state.show[gs.res]) {
        counts[gs.res] = (counts[gs.res] || 0) + 1
        ctx.fillStyle = RES_COL[gs.res]
        ctx.beginPath()
        ctx.arc(x, y, Math.max(1.5, s * 0.28), 0, Math.PI * 2)
        ctx.fill()
        if (s > 5) {
          ctx.strokeStyle = ink
          ctx.globalAlpha = 0.5
          ctx.lineWidth = 1
          ctx.stroke()
          ctx.globalAlpha = 1
        }
      }
    }
  }

  // board centres — a hollow ring
  ctx.strokeStyle = ink
  ctx.globalAlpha = 0.55
  ctx.lineWidth = 1.5
  for (const g of centres) {
    const { x, y } = screenOf(g)
    if (x < 0 || x > W || y < 0 || y > H) continue
    ctx.beginPath()
    ctx.arc(x, y, s * 0.5, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  // the stand point + a reach ring label
  if (state.stand) {
    const { x, y } = screenOf(state.stand)
    ctx.fillStyle = ink
    ctx.beginPath()
    ctx.arc(x, y, Math.max(3, s * 0.4), 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = css("--surface")
    ctx.lineWidth = 2
    ctx.stroke()
  }

  // legend: node counts across the built field
  document.getElementById("legend").innerHTML = RES_ORDER.map(r => {
    const on = state.show[r]
    return `<label style="opacity:${on ? 1 : 0.4}"><input type="checkbox" data-res="${r}" ${on ? "checked" : ""}/><span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:${RES_COL[r]};margin:0 4px;vertical-align:-1px"></span>${r} ${counts[r] || 0}</label>`
  }).join("")
  for (const el of document.querySelectorAll("#legend input")) {
    el.onchange = () => {
      state.show[el.dataset.res] = el.checked
      draw()
    }
  }
  document.getElementById("key").textContent = "pubkey " + state.pubkey.slice(0, 16) + "… · world " + state.worldKey.slice(0, 16) + "…"
  const reachN = state.reach ? [...state.reach.values()].filter(v => v <= ENERGY_START).length : 0
  document.getElementById("hint").textContent = state.stand
    ? `standing at ${key(state.stand)} · ${reachN} tiles within one tank (${ENERGY_START}) · click again to move · shift-click to clear`
    : "click a tile to stand there and shade its reach"
}

// ── pointer: pan (drag) vs stand (click) ─────────────
const tileAt = (px, py) => {
  // nearest tile centre to the pointer (screen → world → scan close ones)
  const wx = cam.x + (px - window.innerWidth / 2) / cam.s
  const wy = cam.y + (py - window.innerHeight / 2) / cam.s
  let best = null
  for (const t of world.values()) {
    const p = unit(t.g)
    const d = (p.x - wx) ** 2 + (p.y - wy) ** 2
    if (!best || d < best.d) best = { g: t.g, d }
  }
  return best && best.d < 1.2 ? best.g : null
}
let drag = null
let moved = false
cv.addEventListener("pointerdown", e => {
  drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, shift: e.shiftKey }
  moved = false
  cv.setPointerCapture(e.pointerId)
  cv.style.cursor = "grabbing"
})
cv.addEventListener("pointermove", e => {
  if (!drag) return
  if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 3) moved = true
  cam.x = drag.cx - (e.clientX - drag.x) / cam.s
  cam.y = drag.cy - (e.clientY - drag.y) / cam.s
  draw()
})
cv.addEventListener("pointerup", e => {
  cv.style.cursor = "grab"
  if (drag && !moved) {
    if (drag.shift) {
      state.stand = null
      state.reach = null
    } else {
      const g = tileAt(e.clientX, e.clientY)
      if (g) {
        state.stand = g
        computeReach()
      }
    }
    draw()
  }
  drag = null
})
cv.addEventListener(
  "wheel",
  e => {
    e.preventDefault()
    const f = Math.pow(1.0015, -e.deltaY)
    const W = window.innerWidth
    const H = window.innerHeight
    const wx = cam.x + (e.clientX - W / 2) / cam.s
    const wy = cam.y + (e.clientY - H / 2) / cam.s
    cam.s = Math.max(1.5, Math.min(60, cam.s * f))
    cam.x = wx - (e.clientX - W / 2) / cam.s
    cam.y = wy - (e.clientY - H / 2) / cam.s
    draw()
  },
  { passive: false }
)

document.getElementById("rnd").addEventListener("click", () => {
  state.pubkey = randKey() // new continents…
  state.worldKey = randKey() // …and new detail
  state.stand = null
  rebuildWorld()
  fit()
  draw()
})
window.addEventListener("resize", draw)

// the window may report 0×0 for a frame or two on load (the preview pane
// does) — wait for a real size before fitting, or the scale collapses
function boot() {
  if (!window.innerWidth || !window.innerHeight) {
    requestAnimationFrame(boot)
    return
  }
  rebuildWorld()
  fit()
  draw()
}
boot()
