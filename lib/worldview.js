// Dev-only world sandbox (world.html) — every tile of the 72 boards at the
// playing depth, and the rivers between them, fully revealed, read STRAIGHT
// FROM THE SIM: terrain and forage nodes are the real game rules. "new world"
// rolls a pubkey and an angle (the world key is worldKeyFor(pubkey, angle));
// toggle each resource to see where it drops; click a tile to "stand" there
// and shade a rough reach — terrain step costs only (no walls, river rules or
// leaps) — within a budget of minutes.
// Not the game — a lens to test board rules directly.

import { createSim, worldKeyFor, BIOME_YIELD, ENERGY_START } from "./sim.js"
import { biomeColor } from "./render.js"
import { zoomAt } from "./zoom.js"

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
const randAngle = () => Math.floor(Math.random() * 360) // 0..359, as the angle picker sets it

// resource marker colours (match the game's palette family)
const RES_COL = {
  kelp: "#2e8b80",
  fish: "#3f7dbe",
  eel: "#25405a",
  oysters: "#b9a6c8",
  crabs: "#d8473a",
  roots: "#a8642f",
  fruit: "#e8962e",
  plants: "#8fbf5e",
  hare: "#7a5c48",
  berries: "#8e3b8a",
  nuts: "#5a3a22",
  wood: "#33691e",
  branches: "#b89466",
  herbs: "#6fd0a0",
  rock: "#8a877d",
  eggs: "#d9c58a",
  metal: "#f0ede4"
}
const RES_ORDER = [...new Set(Object.values(BIOME_YIELD).flat())] // every kind any biome yields, biome by biome

const state = {
  // the world is a PUBKEY at an ANGLE: worldKeyFor(pubkey, angle) is the world
  // key that derives the whole world, and the angle also lays out the globe
  pubkey: randKey(),
  angle: randAngle(),
  worldKey: "", // derived from the two by rebuildWorld
  budget: ENERGY_START, // minutes the reach shading may spend — starts at the reference ENERGY_START
  show: Object.fromEntries(RES_ORDER.map(r => [r, true])), // which nodes to overlay
  stand: null, // the "stand here" tile [q,r], or null
  reach: null // gkey → one-way charge from stand (Dijkstra), or null
}

let sim = null // built by rebuildWorld
let world = new Map() // gkey → { g, river }
let centres = [] // board centre tiles

function rebuildWorld() {
  state.worldKey = worldKeyFor(state.pubkey, state.angle)
  sim = createSim({ angle: state.angle, pubkey: state.pubkey, worldKey: state.worldKey })
  world = new Map()
  centres = []
  const R = 75 // the net reaches about six board pitches out
  for (let q = -R; q <= R; q++) {
    for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) {
      const g = [q, r]
      if (!sim.onMap(g)) continue
      const river = sim.isRiver(g)
      world.set(key(g), { g, river })
      if (!river) {
        const c = sim.boardCentreOf(g)
        if (c && c[0] === g[0] && c[1] === g[1]) centres.push(g)
      }
    }
  }
  state.reach = null // stale under a new world
}

// ── reach: a rough one-way Dijkstra from `stand`, priced by the sim's own
// terrain step costs (stepCostAt) — no walls, water rules or leaps — out to
// the budget (state.budget minutes).
const ROUGH = "rough reach — terrain step costs only (no walls, water rules or leaps)" // the hint's name for it

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
    if (d > state.budget) continue
    for (const [dq, dr] of DIRS) {
      const n = [g[0] + dq, g[1] + dr]
      const nk = key(n)
      const w = world.get(nk)
      if (!w) continue // off the field
      const nd = d + sim.stepCostAt(n)
      if (nd <= state.budget && (best.get(nk) == null || nd < best.get(nk))) {
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
    if (!t.river) {
      const col = biomeColor(sim.typeNameAt(t.g))
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
    if (state.reach && !t.river && state.reach.get(gk) == null) {
      ctx.fillStyle = mix(css("--surface"), "transparent", 0.45)
      ctx.fill()
    }

    // forage-node marker: one wedge per toggled-on yield, in its resource colour
    if (!t.river) {
      const ys = sim.yieldsAt(t.g).map(y => y.res).filter(r => state.show[r])
      if (ys.length) {
        const rad = Math.max(1.5, s * 0.28)
        const arc = (Math.PI * 2) / ys.length
        ys.forEach((r, i) => {
          counts[r] = (counts[r] || 0) + 1
          ctx.fillStyle = RES_COL[r]
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.arc(x, y, rad, -Math.PI / 2 + i * arc, -Math.PI / 2 + (i + 1) * arc)
          ctx.closePath()
          ctx.fill()
        })
        if (s > 5) {
          ctx.beginPath()
          ctx.arc(x, y, rad, 0, Math.PI * 2)
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

  // the stand point
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

  // legend: node counts among the tiles on screen
  document.getElementById("legend").innerHTML =
    "<span>nodes on screen</span>" +
    RES_ORDER.map(r => {
      const on = state.show[r]
      return `<label${on ? "" : ' class="off"'}><input type="checkbox" data-res="${r}" ${on ? "checked" : ""}/><span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:${RES_COL[r]};margin:0 4px;vertical-align:-1px"></span>${r} ${counts[r] || 0}</label>`
    }).join("")
  for (const el of document.querySelectorAll("#legend input")) {
    el.onchange = () => {
      state.show[el.dataset.res] = el.checked
      draw()
    }
  }
  document.getElementById("key").textContent =
    "angle " + state.angle + " · pubkey " + state.pubkey.slice(0, 16) + "… · world " + state.worldKey.slice(0, 16) + "…"
  const reachN = state.reach ? state.reach.size : 0
  document.getElementById("hint").textContent = state.stand
    ? `standing at ${key(state.stand)} · ${reachN} tiles within ${state.budget} min · ${ROUGH} · click again to move · shift-click to clear`
    : `click a tile to stand there and shade its ${ROUGH}`
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
    cam = zoomAt(cam, { x: e.clientX, y: e.clientY }, { x: window.innerWidth / 2, y: window.innerHeight / 2 }, e.deltaY, 1.5, 60)
    draw()
  },
  { passive: false }
)

const angleEl = document.getElementById("angle")
const budgetEl = document.getElementById("budget")
angleEl.value = state.angle
budgetEl.value = state.budget
document.getElementById("rnd").addEventListener("click", () => {
  state.pubkey = randKey() // a new player…
  state.angle = randAngle() // …at a new angle: a new world key, a new globe
  angleEl.value = state.angle
  state.stand = null
  rebuildWorld()
  fit()
  draw()
})
// the same pubkey at another angle — another world
angleEl.addEventListener("change", () => {
  const a = Math.round(parseFloat(angleEl.value))
  if (!Number.isFinite(a)) {
    angleEl.value = state.angle
    return
  }
  state.angle = ((a % 360) + 360) % 360
  angleEl.value = state.angle
  state.stand = null
  rebuildWorld()
  fit()
  draw()
})
budgetEl.addEventListener("input", () => {
  const b = Number(budgetEl.value)
  if (!(b > 0)) return
  state.budget = b
  computeReach()
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
