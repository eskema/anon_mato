// A CRUDE first-person view of the world from the player's eyes — a tiny
// polygon renderer with ONE honest primitive: a render QUEUE. Every polygon
// (tile top, cliff wall, game wall, mini pillar face, the figure) is emitted
// with its own camera depth, sorted once, drawn far→near, and near-plane
// clipped. Nothing is hostage to its tile's draw turn, so tall content near
// tile edges (the minimap's pillars, walls) occludes and is occluded
// correctly from any angle and any size.
//
// The world reads from the sim alone: tops are VERTEX-MERGED into a
// continuous skin (high ground dominates, a per-tile nuance lets one side
// take over), WATER and the seam roads lie flat at the waterline, HOME is
// the flat identity minimap carrying its boards' discovered interiors as
// little walled pillars, and the UNDISCOVERED fills with a mist that hugs
// the known terrain's average height (only that average leaks — no spoilers).
//
// Look: the camera looks AT the tile the board pointer hovers — yaw, pitch
// and SIZE (zoom) all ease so the aimed tile sits in frame, near or far.
// Moving the mouse over the panel PEEKS elastically around that anchor
// (borders reach ±180°); dragging moves the anchor itself (inverted — you
// grab the world), releasing REBASES so the framing holds; scrolling biases
// the auto-zoom; double-click hops between first person and ride-behind.

import { theme } from "./draw.js"
import { DIRS } from "./world.js"
import { WATER_LEVEL, ENERGY_START } from "./sim.js"
import { biomeColor, nibbleColor, npcName } from "./render.js"

const W = 480 // internal resolution — still chunky, but the edges read
const H = 270
const FOV = Math.PI / 2.6
const VSCALE = 0.55 // one height point in world units (hex pitch ≈ 1.73 units)
const WALL_H = 0.8 // a game wall's standing height, in world units
const S3 = Math.sqrt(3)
const SEAM_RGB = [150, 148, 140] // the roads — no biome of their own
const FOG_RGB = [126, 126, 126] // the mist over the unknown
// the water's blues, by deepness LEVEL — the map's palette, stepped so each
// tier reads as its own hue
const WATER_SHALLOW = [110, 170, 220]
const WATER_DEEP = [12, 68, 124]
const waterBlue = deep => {
  const t = Math.min(1, deep / WATER_LEVEL)
  return [
    Math.round(WATER_SHALLOW[0] + (WATER_DEEP[0] - WATER_SHALLOW[0]) * t),
    Math.round(WATER_SHALLOW[1] + (WATER_DEEP[1] - WATER_SHALLOW[1]) * t),
    Math.round(WATER_SHALLOW[2] + (WATER_DEEP[2] - WATER_SHALLOW[2]) * t)
  ]
}
// the FLATTER world: display heights band together — everything below the
// waterline STANDS at it (dry depressions), the flats (4..7) nearly level,
// a step up into the hills (8..11), a bigger one into the peaks (12+).
// Display only — the sim's real heights keep pricing movement.
const bandH = h => {
  const x = Math.max(WATER_LEVEL, h)
  if (x <= 7) return WATER_LEVEL + (x - WATER_LEVEL) * 0.15
  if (x <= 11) return WATER_LEVEL + 1.2 + (x - 7) * 0.55
  return WATER_LEVEL + 4.2 + (x - 11) * 1.0
}
const FOG_Z = WATER_LEVEL * VSCALE // its floor when nothing nearby is known
const DIR_IDX = new Map(DIRS.map((d, i) => [d.q + "," + d.r, i])) // axial delta → wall-bit index

export function initView3d(sim, aim = null) {
  // the PANEL: movable (drag its top bar) and resizable (drag the corner
  // grip), aspect-locked. Sizes clamp between a readable minimum and the
  // viewport minus a margin — it can neither go full screen nor be pushed out.
  const MARGIN = 12
  const HDR = 16 // the drag bar's height
  const MIN_W = 220
  const panel = document.createElement("div")
  panel.style.cssText =
    "position:fixed;z-index:40;border:1px solid var(--text);background:var(--surface);box-sizing:border-box;" +
    "display:flex;flex-direction:column;"
  const hdr = document.createElement("div")
  // the panel's mover (the canvas itself is drag-to-look) — a centred grip
  // pill so the strip reads as a handle, not a stray blank band
  hdr.style.cssText =
    "flex:none;height:" + HDR + "px;cursor:move;touch-action:none;" +
    "background:linear-gradient(var(--text) 0 0) center / 44px 3px no-repeat;opacity:0.4;"
  const canvas = document.createElement("canvas")
  canvas.width = W
  canvas.height = H
  canvas.style.cssText =
    "width:100%;height:calc(100% - " + HDR + "px);display:block;image-rendering:pixelated;cursor:grab;touch-action:none;"
  const grip = document.createElement("div")
  grip.style.cssText =
    "position:absolute;right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize;touch-action:none;" +
    "background:linear-gradient(135deg,transparent 50%,var(--text) 50%);opacity:0.35;"
  panel.append(hdr, canvas, grip)
  document.body.append(panel)
  const ctx = canvas.getContext("2d")

  let pw = Math.min(560, window.innerWidth * 0.46)
  let px = 0
  let py = 0
  const layout = () => {
    // width caps at the viewport (margins held), height follows 16:9 + bar
    const maxW = Math.min(window.innerWidth - 2 * MARGIN, ((window.innerHeight - 2 * MARGIN - HDR) * 16) / 9)
    pw = Math.max(MIN_W, Math.min(pw, maxW))
    const ph = (pw * 9) / 16 + HDR
    px = Math.max(MARGIN, Math.min(px, window.innerWidth - MARGIN - pw))
    py = Math.max(MARGIN, Math.min(py, window.innerHeight - MARGIN - ph))
    panel.style.left = px + "px"
    panel.style.top = py + "px"
    panel.style.width = pw + "px"
    panel.style.height = ph + "px"
  }
  px = window.innerWidth - MARGIN - pw // starts where it always did: bottom-right
  py = window.innerHeight - MARGIN - ((pw * 9) / 16 + HDR)
  layout()

  let yaw = 0 // the ANCHOR gaze: 0 = up-screen north, clockwise
  let pitch = 0.45 // >0 looks DOWN
  let scale = 0.2 // your SIZE — the aim's distance drives it; scroll biases it
  let zoomBias = 1
  let shCache = [] // world-space cast-shadow polys — rebuilt only when the world changes
  let shStamp = ""
  let shCX = Infinity // the cached disk's centre — rebuilt when strayed from
  let shCY = Infinity
  // the world sampling caches PERSIST across frames — repainting is per-frame
  // work, re-deriving the world is not. Cleared when the world stamp turns.
  let tops = new Map()
  let verts = new Map()
  let topsStamp = ""
  // the PEEK: mouse position over the panel looks around the anchor without
  // clicking — an elastic offset that springs back when the pointer leaves
  let lookX = 0
  let lookY = 0
  let lookTX = 0
  let lookTY = 0
  let drag = null
  let manual = false // a drag PINS the view — held until the pointer leaves the panel
  let mode = "eye" // "eye" = first person; "follow" = right behind and above the figure
  let rafId = 0

  const rgbOf = col => (col.match(/\d+/g) || [128, 128, 128]).map(Number)
  // deterministic per-(vertex, tile) nuance in 0.5..1.5 — the "sometimes one
  // side takes over" of the merge
  const nuance = (a, b, c, d) => {
    let x = (a * 374761393 + b * 668265263 + c * 1103515245 + d * 987654323) | 0
    x = ((x ^ (x >>> 13)) * 1274126177) | 0
    return 0.5 + ((x >>> 15) % 1000) / 1000
  }
  // unit plane → nearest hex (the sim's unitXY convention, inverted + cube-rounded)
  function hexAt(x, y) {
    const r = y / 1.5
    const q = x / S3 - r / 2
    let rq = Math.round(q)
    let rr = Math.round(r)
    const rs = Math.round(-q - r)
    const dq = Math.abs(rq - q)
    const dr = Math.abs(rr - r)
    const ds = Math.abs(rs + q + r)
    if (dq > dr && dq > ds) rq = -rs - rr
    else if (dr > ds) rr = -rs - rq
    return [rq, rr]
  }

  function draw() {
    const surface = theme("--surface", "#111")
    const ink = theme("--text", "#eee")
    const p = sim.view().player
    const ex = S3 * (p[0] + p[1] / 2)
    const ey = 1.5 * p[1]
    // the gaze follows the pointer's tile on the board — unless a drag pinned
    // the view (released once the pointer leaves the panel)
    const ui = (aim && aim()) || {}
    const at = ui.at
    const aiming = !drag && !manual && at && (at[0] !== p[0] || at[1] !== p[1])
    let aimDist = 0
    if (aiming) {
      const tx = S3 * (at[0] + at[1] / 2) - ex
      const ty = 1.5 * at[1] - ey
      aimDist = Math.hypot(tx, ty)
      const want = Math.atan2(tx, -ty)
      let d = want - yaw
      while (d > Math.PI) d -= 2 * Math.PI
      while (d < -Math.PI) d += 2 * Math.PI
      yaw += d * 0.15 // ease toward it
    }
    // the sun: the dial's wheel (day n at angle n°); strength follows the hour
    const sunRad = (((sim.day() - 1) % 360) * Math.PI) / 180
    const sunX = Math.sin(sunRad)
    const sunY = -Math.cos(sunRad)
    const low = Math.abs(1 - 2 * ((ENERGY_START - sim.energy()) / ENERGY_START)) // 0 noon → 1 at the ends
    const sunStrength = 0.18 + 0.3 * low
    // …and the sun's 3D direction for surface shading: azimuth from the
    // dial, but a STYLISED fixed height — an overhead noon sun washes all
    // slope contrast out, and the terrain must stay readable at every hour
    const wallHue = sim.angle() // the game's walls wear the player's angle hue
    const sunUp = 1.2
    const sunM = Math.hypot(1, sunUp)
    const s3x = sunX / sunM
    const s3y = sunY / sunM
    const s3z = sunUp / sunM
    const lambert = (nx, ny, nz) => 0.32 + 0.78 * Math.max(0, nx * s3x + ny * s3y + nz * s3z)

    // CAST shadows — PROJECTED, not per-face. Every tile top is a flat
    // hexagon, so its shadow is that silhouette swept down-sun along a low
    // stylised ray and clipped against each lower flat face it lands on —
    // a dark cut ACROSS the receiving platform, not a tint of it.
    const SH_SLOPE = 0.3 // the shadow ray's rise per plan unit toward the sun
    const SH_REACH = 3 // the longest throw, in plan units — near things, not smears
    const SH_ALPHA = 0.25 // the cut's darkness (a translucent ink layer)
    const shX = -sunX // the direction shadows FALL
    const shY = -sunY
    const hexPts = (cx, cy, r) => {
      const o = []
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + (k * Math.PI) / 3
        o.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
      }
      return o
    }
    // convex hull (monotone chain) — at most 12 points, so it stays cheap
    const hull = pts => {
      const p = pts.slice().sort((u, v) => u[0] - v[0] || u[1] - v[1])
      const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
      const lo = []
      for (const q of p) {
        while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop()
        lo.push(q)
      }
      const hi = []
      for (let i = p.length - 1; i >= 0; i--) {
        const q = p[i]
        while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop()
        hi.push(q)
      }
      lo.pop()
      hi.pop()
      return lo.concat(hi)
    }
    // clip a convex polygon to a convex window (Sutherland–Hodgman); the
    // inside sign comes from the window's own centre, so winding never bites
    const clipPoly = (poly, win, wcx, wcy) => {
      let out = poly
      for (let i = 0; i < 6 && out.length; i++) {
        const a = win[i]
        const b = win[(i + 1) % 6]
        const ex = b[0] - a[0]
        const ey = b[1] - a[1]
        const ref = ex * (wcy - a[1]) - ey * (wcx - a[0])
        const side = p => (ex * (p[1] - a[1]) - ey * (p[0] - a[0])) * ref >= 0
        const nxt = []
        for (let j = 0; j < out.length; j++) {
          const p = out[j]
          const q = out[(j + 1) % out.length]
          const pin = side(p)
          const qin = side(q)
          if (pin) nxt.push(p)
          if (pin !== qin) {
            const dp = ex * (p[1] - a[1]) - ey * (p[0] - a[0])
            const dq = ex * (q[1] - a[1]) - ey * (q[0] - a[0])
            const u = dp / (dp - dq)
            nxt.push([p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u])
          }
        }
        out = nxt
      }
      return out
    }

    // tile-top cache: key → { z, h, rgb, water, seam, fog, home } | null
    // (beyond the world) — persistent; dropped when the world stamp turns
    const topsNow = sim.day() + ":" + sim.depth() + ":" + sim.worldStamp()
    if (topsNow !== topsStamp) {
      topsStamp = topsNow
      tops = new Map()
      verts = new Map()
    }
    const topOf = g => {
      const k = g[0] + "," + g[1]
      let t = tops.get(k)
      if (t !== undefined) return t
      if (!sim.isDiscovered(g)) {
        if (!sim.kindOf(g)) t = null
        else {
          // the MIST hugs the known terrain: a fog pad sits a shade below
          // its LOWEST discovered neighbour (in DISPLAY heights — the same
          // bands the land wears), at the waterline when nothing nearby is
          // known. It never towers over what's already been seen.
          let m = Infinity
          for (const [dq, dr] of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]) {
            const ng = [g[0] + dq, g[1] + dr]
            if (!sim.isDiscovered(ng)) continue
            const raw = sim.heightAt(ng)
            if (raw == null) continue
            const nh = sim.typeNameAt(ng) === "water" ? WATER_LEVEL : bandH(raw)
            if (nh < m) m = nh
          }
          const h = m < Infinity ? Math.max(WATER_LEVEL, m - 0.5) : WATER_LEVEL
          t = { z: h * VSCALE, h, rgb: FOG_RGB, fog: true }
        }
      } else {
        const raw = sim.heightAt(g)
        if (raw == null) t = null
        else {
          const ty = sim.typeNameAt(g)
          const water = ty === "water"
          const deep = water
            ? Math.max(0, Math.min(WATER_LEVEL, WATER_LEVEL - Math.round(sim.smoothAt(g))))
            : 0
          const col = biomeColor(ty, raw, sim.smoothAt(g))
          // water paints in its LEVEL's blue; seams (and unknown types) the road grey
          const rgb = water ? waterBlue(deep) : col ? rgbOf(col) : SEAM_RGB
          const seam = !col
          let h
          if (water) h = WATER_LEVEL
          else if (!seam) h = bandH(raw) // land flattens into bands
          else {
            // the ROADS ride the terrain: a seam stands at the average of
            // its KNOWN non-road neighbours (the waterline when nothing is
            // known yet), so crossings read as slopes — never walls
            let s = 0
            let n = 0
            for (const d of DIRS) {
              const ng = [g[0] + d.q, g[1] + d.r]
              if (!sim.isDiscovered(ng)) continue
              const nty = sim.typeNameAt(ng)
              if (nty === "water") {
                s += WATER_LEVEL
                n++
                continue
              }
              // a HOME-board neighbour counts as the plateau the view draws,
              // not its hidden raw terrain — else the road climbs the wall
              const hb = sim.boardHexOf(ng)
              if (hb && hb[0] === 0 && hb[1] === 0) {
                s += WATER_LEVEL + 0.3
                n++
                continue
              }
              const nraw = sim.heightAt(ng)
              if (nraw == null || !biomeColor(nty, nraw, sim.smoothAt(ng))) continue // another road
              s += bandH(nraw)
              n++
            }
            h = n ? s / n : WATER_LEVEL
          }
          t = { z: h * VSCALE, h, rgb, water, seam }
          if (water) t.deep = deep
        }
      }
      tops.set(k, t)
      if (t && !t.fog) {
        // HOME is the minimap, not land: DEAD flat, grounded at the waterline,
        // painted like the grid view — the identity in terrain colours once
        // the board is visited, grey before
        const hb = sim.boardHexOf(g)
        if (hb && hb[0] === 0 && hb[1] === 0) {
          const chs = sim.nibbleAt(g)
          if (chs) {
            const v = [...chs].reduce((s2, c2) => s2 + parseInt(c2, 16), 0) / chs.length
            t.h = WATER_LEVEL + 0.3
            t.z = t.h * VSCALE
            t.home = g
            t.rgb = sim.parentOf().tile.discovered.has(g[0] + "," + g[1]) ? rgbOf(nibbleColor(v)) : FOG_RGB
          }
        }
        // a CENTRE tile has no height of its own — it assumes its neighbours'
        // average (neighbours are never centres; fog pads don't vote)
        if (!t.water) {
          const bc = sim.boardCentreOf(g)
          if (bc && bc[0] === g[0] && bc[1] === g[1]) {
            let s = 0
            let n = 0
            for (const [dq, dr] of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]) {
              const nt = topOf([g[0] + dq, g[1] + dr])
              if (nt && !nt.fog) {
                s += nt.h
                n++
              }
            }
            if (n) {
              t.h = s / n
              t.z = t.h * VSCALE
            }
          }
        }
      }
      return t
    }

    // vertex-merged heights: a corner blends the three tiles sharing it —
    // weighted by the nuance hash and by HEIGHT (cubed), so the high ground
    // takes over and a true peak stays a peak. Water/seams/mist contribute
    // only a gentle tug (they lie low and drape). The cache persists with
    // tops — cleared together when the world stamp turns.
    const vtxZ = (vx, vy, back) => {
      const vk = Math.round(vx * 2) + "," + Math.round(vy * 2)
      let z = verts.get(vk)
      if (z !== undefined) return z
      let sum = 0
      let wsum = 0
      for (let m = 0; m < 3; m++) {
        const a = back + (m * 2 * Math.PI) / 3
        const g = hexAt(vx + 0.5 * Math.cos(a), vy + 0.5 * Math.sin(a))
        const t = topOf(g)
        if (!t) continue
        // any vertex touching WATER pins exactly to the waterline — the
        // sheet and the land's aprons meet there with no gap
        if (t.water) {
          z = WATER_LEVEL * VSCALE
          verts.set(vk, z)
          return z
        }
        const nu = nuance(Math.round(vx * 2), Math.round(vy * 2), g[0], g[1])
        const w = t.seam || t.fog ? 0.5 * nu : (1 + Math.pow(t.h / 15, 3) * 8) * nu
        sum += t.z * w
        wsum += w
      }
      z = wsum ? sum / wsum : FOG_Z
      verts.set(vk, z)
      return z
    }

    // SIZE follows the aim: a far tile lifts the eye so it fits the frame, a
    // near one brings you back down; the scroll's bias scales the fit
    if (aiming) {
      const sT = Math.max(0.05, Math.min(12, (0.08 + aimDist / 12) * zoomBias))
      scale += (sT - scale) * 0.1
    }
    // the eyes stand on the RENDERED floor, with a floor of clearance so the
    // minimap's pillars never tower over a tiny observer
    const pt0 = topOf(p)
    const eyeZ = (pt0 ? pt0.z : FOG_Z) + Math.max(0.45, 1.2 * scale)
    // …and the pitch eases to LOOK AT the aimed tile, height included
    if (aiming) {
      const atZ = topOf(at) ? topOf(at).z : FOG_Z
      const pW = Math.max(-0.3, Math.min(1.35, Math.atan2(eyeZ - atZ, Math.max(0.4, aimDist))))
      pitch += (pW - pitch) * 0.1
    }

    // the peek springs toward its target (and back to rest when it leaves)
    lookX += (lookTX - lookX) * 0.12
    lookY += (lookTY - lookY) * 0.12
    const yawE = yaw + lookX
    // the CAMERA: eye mode stands in the figure's eyes; follow mode sits
    // right behind and above it, looking down the same gaze (dblclick flips)
    let camX = ex
    let camY = ey
    let camZ = eyeZ
    let pitchF = 0
    if (mode === "follow") {
      const back = 1.4 + 2.2 * scale
      camX -= Math.sin(yawE) * back
      camY += Math.cos(yawE) * back
      camZ = (pt0 ? pt0.z : FOG_Z) + 0.9 + 1.4 * scale
      pitchF = 0.18 // a touch more downward, keeping the figure framed
    }
    const pitchE = Math.max(-0.3, Math.min(1.35, pitch + lookY + pitchF))
    // camera basis (yaw about up, then pitch about right; pitch>0 looks down)
    const fx = Math.sin(yawE)
    const fy = -Math.cos(yawE)
    const rx = Math.cos(yawE)
    const ry = Math.sin(yawE)
    const cosP = Math.cos(pitchE)
    const sinP = Math.sin(pitchE)
    const focal = W / (2 * Math.tan(FOV / 2))
    const NEAR = 0.12
    const toCam = (wx, wy, wz) => {
      const dx = wx - camX
      const dy = wy - camY
      const dz = wz - camZ
      const yf = dx * fx + dy * fy
      return { x: dx * rx + dy * ry, d: yf * cosP - dz * sinP, v: dz * cosP + yf * sinP }
    }
    const toScreen = c => ({ x: W / 2 + (c.x / c.d) * focal, y: H / 2 - (c.v / c.d) * focal })
    // clip a camera-space polygon against the near plane, THEN project
    const clipNear = pts => {
      const out = []
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]
        const b = pts[(i + 1) % pts.length]
        const ain = a.d >= NEAR
        if (ain) out.push(a)
        if (ain !== b.d >= NEAR) {
          const t2 = (NEAR - a.d) / (b.d - a.d)
          out.push({ x: a.x + (b.x - a.x) * t2, d: NEAR, v: a.v + (b.v - a.v) * t2 })
        }
      }
      return out
    }
    const pathRing = pts => {
      const cp = clipNear(pts)
      if (cp.length < 3) return false
      cp.forEach((c, i) => {
        const s = toScreen(c)
        i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y)
      })
      ctx.closePath()
      return true
    }
    const fillPoly = pts => {
      ctx.beginPath()
      return pathRing(pts)
    }

    // the distance fade paints OPAQUE: colours sink toward the sky by mixing,
    // never by alpha — translucent tiles let the geometry behind bleed through
    const cssRgb = c => {
      if (c[0] === "#" && c.length >= 7) {
        const n = parseInt(c.slice(1, 7), 16)
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      }
      return (c.match(/\d+/g) || [128, 128, 128]).slice(0, 3).map(Number)
    }
    const surfRgb = cssRgb(surface)
    const groundCol = (rgb, b, f) =>
      `rgb(${Math.round(Math.min(255, rgb[0] * b) * f + surfRgb[0] * (1 - f))},${Math.round(Math.min(255, rgb[1] * b) * f + surfRgb[1] * (1 - f))},${Math.round(Math.min(255, rgb[2] * b) * f + surfRgb[2] * (1 - f))})`

    // ── the render QUEUE: every polygon carries its own sort key. ──
    // Keys are PLAN DISTANCE from the camera's ground position — the
    // correct occlusion sweep for a 2.5D world under perspective (view-plane
    // depth only works for orthographic cameras and drifts at the frame's
    // sides). Floors key on their FARTHEST corner (they must precede what
    // stands on them); walls on their edge midpoint; compact objects (a mini
    // pillar, the figure) on their centre, one shared key for all faces —
    // the sort is stable, so an object's internal order holds.
    const pd2 = (wx, wy) => (wx - camX) ** 2 + (wy - camY) ** 2
    const queue = []
    const emit = (pts, fill, key, alpha = 1, stroke = null, strokeAlpha = 1, rings = false) => {
      queue.push({ d: key, pts, fill, alpha, stroke, strokeAlpha, rings })
    }

    // gather the disk of tiles around the player and emit their geometry
    // the canvas twin REPAINTS the whole disk per frame — its ceiling stays
    // lower than the GL twin's, or high zoom melts into 150ms frames
    const R = Math.max(8, Math.min(24, Math.round(14 * Math.sqrt(Math.max(0.35, scale)))))
    // cast shadows are WORLD-space: rebuild only when the world changes
    // (discovery, day, level), the coverage radius changes, or the player
    // strays from the cached disk's centre — never on a plain step
    const shStampNow = sim.day() + ":" + sim.depth() + ":" + sim.worldStamp() + ":" + R
    const shRebuild = shStampNow !== shStamp || (ex - shCX) ** 2 + (ey - shCY) ** 2 > 14 * 14
    if (shRebuild) {
      shStamp = shStampNow
      shCX = ex
      shCY = ey
      shCache = []
    }
    const maxD = R * S3
    const markers = [] // obelisks + labels, drawn over the flushed queue
    for (let q2 = -R; q2 <= R; q2++) {
      for (let r2 = Math.max(-R, -q2 - R); r2 <= Math.min(R, -q2 + R); r2++) {
        const g = [p[0] + q2, p[1] + r2]
        const t = topOf(g)
        if (!t) continue
        const cx0 = S3 * (g[0] + g[1] / 2)
        const cy0 = 1.5 * g[1]
        const d2 = (cx0 - ex) ** 2 + (cy0 - ey) ** 2
        const fade = 1 - 0.45 * Math.min(1, Math.sqrt(d2) / maxD) // far ground sinks toward the sky
        // the six top corners: only HOME lies flat (the minimap plateau —
        // its minis must sit exactly on it). Land, water, seams and the mist
        // all merge at the rim — water and roads keep their flat platforms
        // and blend only at the edges.
        const flat = !!t.home
        const cs = []
        for (let k = 0; k < 6; k++) {
          const a = Math.PI / 6 + (k * Math.PI) / 3
          const vx = cx0 + Math.cos(a)
          const vy = cy0 + Math.sin(a)
          const vz = flat ? t.z : vtxZ(vx, vy, a + Math.PI)
          cs.push({ cam: toCam(vx, vy, vz), vx, vy, vz })
        }
        if (cs.every(c => c.cam.d < NEAR)) continue
        // WALLS, where the skin truly breaks: only beyond the world's edge —
        // water, roads and mist all merge into the ground at the vertices.
        // The mist closes its own edge too (a grey curtain to the void), so
        // no bare background ever peeks through between fog ridges.
        {
          const wb = t.fog ? 0 : sim.wallsAt(g)
          for (let k = 0; k < 6; k++) {
            const k2 = (k + 1) % 6
            const ea = (Math.PI / 3) * (k + 1) // the edge's outward normal angle
            const nx2 = Math.cos(ea)
            const ny2 = Math.sin(ea)
            const nb = hexAt(cx0 + nx2 * S3, cy0 + ny2 * S3)
            const n = topOf(nb)
            let nz = null
            if (!n) nz = 0 // beyond the world: down to the void floor
            // walls key on their EDGE MIDPOINT — not a far corner — so the
            // things standing just in front of or behind them order correctly
            const midX = (cs[k].vx + cs[k2].vx) / 2
            const midY = (cs[k].vy + cs[k2].vy) / 2
            if (nz != null && nz < Math.min(cs[k].vz, cs[k2].vz) - 0.04) {
              // the same lambert as the land faces — a vertical wall is just
              // a face with a horizontal normal
              emit(
                [cs[k].cam, cs[k2].cam, toCam(cs[k2].vx, cs[k2].vy, nz), toCam(cs[k].vx, cs[k].vy, nz)],
                groundCol(t.rgb, lambert(nx2, ny2, 0), fade),
                pd2(midX, midY)
              )
            }
            // the GAME's walls: a THICK slab in the player's angle hue —
            // inner face, outer face and a top cap (drawn once, from the
            // side that owns the bit; a paper-thin ink sheet read wrong)
            const dIdx = DIR_IDX.get(nb[0] - g[0] + "," + (nb[1] - g[1]))
            if (dIdx != null && ((wb >> dIdx) & 1) === 1) {
              const wq = 0.09 // the slab's thickness, pulled inward
              const ox = -nx2 * wq
              const oy = -ny2 * wq
              const zk = cs[k].vz + WALL_H
              const zk2 = cs[k2].vz + WALL_H
              const wcol = l => `hsl(${wallHue} 45% ${Math.round(20 + l * 34)}%)`
              const wKey = pd2(midX, midY)
              emit(
                [
                  toCam(cs[k].vx + ox, cs[k].vy + oy, zk),
                  toCam(cs[k2].vx + ox, cs[k2].vy + oy, zk2),
                  toCam(cs[k2].vx + ox, cs[k2].vy + oy, cs[k2].vz),
                  toCam(cs[k].vx + ox, cs[k].vy + oy, cs[k].vz)
                ],
                wcol(lambert(-nx2, -ny2, 0)),
                wKey
              )
              emit(
                [cs[k].cam, cs[k2].cam, toCam(cs[k2].vx, cs[k2].vy, zk2), toCam(cs[k].vx, cs[k].vy, zk)],
                wcol(lambert(nx2, ny2, 0)),
                wKey
              )
              emit(
                [
                  toCam(cs[k].vx, cs[k].vy, zk),
                  toCam(cs[k2].vx, cs[k2].vy, zk2),
                  toCam(cs[k2].vx + ox, cs[k2].vy + oy, zk2),
                  toCam(cs[k].vx + ox, cs[k].vy + oy, zk)
                ],
                wcol(lambert(0, 0, 1)),
                wKey
              )
            }
          }
        }
        // the TOP face: biome colour, sun-shaded by the higher/lower ground
        // on the sun side; home, roads and mist stay flat paint
        const nSun = topOf(hexAt(cx0 + sunX * S3, cy0 + sunY * S3))
        const sh =
          nSun && !nSun.fog && !t.home && !t.seam && !t.fog
            ? Math.max(-1, Math.min(1, ((nSun.h - t.h) / 15) * 3))
            : 0
        const b = Math.max(0.55, Math.min(1.25, 1 - sh * sunStrength * (sh > 0 ? 3 : 1.5)))
        const cpd = cs.map(c => pd2(c.vx, c.vy))
        const tKey = Math.max(...cpd) // the floor's farthest corner — it precedes its standers
        const fadeT = t.fog ? fade * 0.9 : fade
        if (t.home) {
          // HOME: one flat identity hexagon — the minimap plateau
          emit(cs.map(c => c.cam), groundCol(t.rgb, b, fadeT), tKey, 1, ink, 0.3 * fade)
        } else if (t.fog) {
          // the MIST: one merged drape, seamless (no grid, no platform)
          emit(cs.map(c => c.cam), groundCol(t.rgb, b, fadeT), tKey)
        } else if (t.water) {
          // WATER: one flat opaque sheet at the waterline in its LEVEL's
          // blue — its corners (and every land vertex it touches) are
          // pinned to the line, so the shore aprons meet it exactly
          emit(cs.map(c => c.cam), groundCol(t.rgb, 1, fadeT), tKey)
        } else {
          // LAND and the ROADS: a FLAT inner platform (2/3 size, at the
          // tile's own height) with a sloped APRON out to the vertex-merged
          // rim — level ground everywhere, the blending at the edges. Each
          // apron quad wears its TRUE angle (lambert against the 3D sun)
          // and a wire so the folds read.
          const inner = []
          const iw = []
          for (let k = 0; k < 6; k++) {
            const a = Math.PI / 6 + (k * Math.PI) / 3
            const ix = cx0 + Math.cos(a) * (2 / 3)
            const iy = cy0 + Math.sin(a) * (2 / 3)
            iw.push([ix, iy])
            inner.push(toCam(ix, iy, t.z))
          }
          // each face keys on its OWN farthest corner: far aprons paint
          // first, then the platform, then the near aprons — whichever way
          // the camera looks (one shared key left them in insertion order,
          // and steep banded aprons made the far side paint over the near)
          const ipd = iw.map(p => pd2(p[0], p[1]))
          const pKey = Math.max(...ipd)
          for (let k = 0; k < 6; k++) {
            const k2 = (k + 1) % 6
            // the quad's normal from its diagonals (kept pointing up)
            const d1x = cs[k2].vx - iw[k][0]
            const d1y = cs[k2].vy - iw[k][1]
            const d1z = cs[k2].vz - t.z
            const d2x = cs[k].vx - iw[k2][0]
            const d2y = cs[k].vy - iw[k2][1]
            const d2z = cs[k].vz - t.z
            let nx3 = d1y * d2z - d1z * d2y
            let ny3 = d1z * d2x - d1x * d2z
            let nz3 = d1x * d2y - d1y * d2x
            if (nz3 < 0) {
              nx3 = -nx3
              ny3 = -ny3
              nz3 = -nz3
            }
            const nm = Math.hypot(nx3, ny3, nz3) || 1
            const lit = lambert(nx3 / nm, ny3 / nm, nz3 / nm)
            emit(
              [inner[k], inner[k2], cs[k2].cam, cs[k].cam],
              groundCol(t.rgb, lit, fadeT),
              Math.max(cpd[k], cpd[k2], ipd[k], ipd[k2]),
              1,
              ink,
              0.3 * fade
            )
          }
          // the platform under the SAME light (its normal is straight up) —
          // one model for every face, so folds always change the shade
          emit(inner, groundCol(t.rgb, lambert(0, 0, 1), fadeT), pKey, 1, ink, 0.3 * fade)
        }
        // ── PROJECTED cast shadows: throw this tile's flat top down-sun.
        // For every lower flat face within reach, sweep the silhouette along
        // the shadow ray onto that face's plane and clip it to the face —
        // a dark polygon CUTTING across the receiver. Computed only on
        // rebuild frames; the cache holds world-space polys.
        if (shRebuild && !t.fog && !t.water) {
          const silR = t.home ? 1 : 2 / 3 // home is a full flat hexagon
          let sil = null // built lazily — most tiles cast on nothing
          const seen = new Set()
          for (let d = 0.87; d <= SH_REACH + 1.8; d += 0.87) {
            for (const side of [0, 1, -1]) {
              const rg = hexAt(cx0 + shX * d - shY * 0.87 * side, cy0 + shY * d + shX * 0.87 * side)
              const rk = rg[0] + "," + rg[1]
              if (seen.has(rk)) continue
              seen.add(rk)
              if (rg[0] === g[0] && rg[1] === g[1]) continue
              const Rt = topOf(rg)
              if (!Rt || Rt.fog) continue
              if (t.z <= Rt.z + 0.03) continue // not lower — no shadow lands here
              const L = Math.min((t.z - Rt.z) / SH_SLOPE, SH_REACH)
              const rcx = S3 * (rg[0] + rg[1] / 2)
              const rcy = 1.5 * rg[1]
              if (Math.hypot(rcx - cx0, rcy - cy0) > L + 1.9) continue // beyond this drop's throw
              if (!sil) sil = hexPts(cx0, cy0, silR)
              const swept = hull(sil.concat(sil.map(p => [p[0] + shX * L, p[1] + shY * L])))
              const win = hexPts(rcx, rcy, Rt.water || Rt.home ? 1 : 2 / 3)
              const poly = clipPoly(swept, win, rcx, rcy)
              if (poly.length >= 3) shCache.push({ poly, z: Rt.z + 0.02, wc: win, rcx, rcy })
            }
          }
        }
        // the discovered MINIS: a home tile carries its board's known interior
        // as LOW walled pillars — the floor is elevation 4 (the waterline).
        // They mirror the world's look: land rises in the same flattened
        // BANDS, water lies flat in its LEVEL's blue
        if (t.home && (t.home[0] || t.home[1])) {
          const node = sim.parentOf().tile.children[t.home[0] + "," + t.home[1]]
          if (node && node.discovered.size) {
            const c0 = sim.centreOf(t.home)
            const su = 1 / 9.5
            const MINI_H = 0.15 // the tallest bump, in world units — low relief
            for (const dk of node.discovered) {
              const [lq, lr] = dk.split(",").map(Number)
              const g2 = [c0[0] + lq, c0[1] + lr]
              const raw = sim.heightAt(g2)
              const ty2 = sim.typeNameAt(g2)
              const pal = biomeColor(ty2, raw, sim.smoothAt(g2))
              if (!pal) continue
              const mx = cx0 + S3 * (lq + lr / 2) * su
              const my = cy0 + 1.5 * lr * su
              const rgb2 = rgbOf(pal)
              const base = t.z + 0.01
              // a hair of daylight between the pillars: shrunk corners mean
              // neighbours never share an edge on screen, so borderline
              // paint-order ties have nothing to fight over
              const sr = su * 0.86
              const csx = []
              const csy = []
              for (let k = 0; k < 6; k++) {
                const a = Math.PI / 6 + (k * Math.PI) / 3
                csx.push(mx + Math.cos(a) * sr)
                csy.push(my + Math.sin(a) * sr)
              }
              const pKey = pd2(mx, my) // ONE pillar = ONE key: its centre
              if (ty2 === "water") {
                const dpt = Math.max(0, Math.min(WATER_LEVEL, WATER_LEVEL - Math.round(sim.smoothAt(g2))))
                const film = []
                for (let k = 0; k < 6; k++) film.push(toCam(csx[k], csy[k], base + 0.01))
                emit(film, groundCol(waterBlue(dpt), 1, fade), pKey)
                continue
              }
              const mh = Math.max(
                0.02,
                ((bandH(raw ?? WATER_LEVEL) - WATER_LEVEL) / (bandH(15) - WATER_LEVEL)) * MINI_H
              )
              // the little pillars cast too — a steeper sun at their scale
              // (a full-slope throw smears 5× the pillar), and the plateau
              // is ONE plane, so the cast spills across home-tile borders
              if (shRebuild && mh > 0.03) {
                const msil = hexPts(mx, my, sr)
                const mL = mh / (SH_SLOPE * 2)
                const swept = hull(msil.concat(msil.map(q => [q[0] + shX * mL, q[1] + shY * mL])))
                const cands = new Map()
                const addC = (x, y) => {
                  const rg = hexAt(x, y)
                  cands.set(rg[0] + "," + rg[1], rg)
                }
                addC(mx, my)
                addC(mx + shX * (mL + sr), my + shY * (mL + sr))
                for (const rg of cands.values()) {
                  const Rt = topOf(rg)
                  if (!Rt || !Rt.home) continue
                  const rcx = S3 * (rg[0] + rg[1] / 2)
                  const rcy = 1.5 * rg[1]
                  const win = hexPts(rcx, rcy, 1)
                  const mpoly = clipPoly(swept, win, rcx, rcy)
                  if (mpoly.length >= 3) shCache.push({ poly: mpoly, z: base + 0.005, wc: win, rcx, rcy })
                }
              }
              // all faces share the pillar's key; walls emit before the lid
              // (the sort is stable, so that order holds)
              const baseCam = []
              const topCam = []
              for (let k = 0; k < 6; k++) {
                baseCam.push(toCam(csx[k], csy[k], base))
                topCam.push(toCam(csx[k], csy[k], base + mh))
              }
              // walls all around (camera-facing only — the rest are hidden)
              for (let k = 0; k < 6; k++) {
                const k2 = (k + 1) % 6
                const ea = (Math.PI / 3) * (k + 1)
                const nx3 = Math.cos(ea)
                const ny3 = Math.sin(ea)
                if ((mx + nx3 * su - camX) * nx3 + (my + ny3 * su - camY) * ny3 > 0) continue // faces away
                const lit = 0.62 + 0.22 * (nx3 * sunX + ny3 * sunY) // gentle — tiny flanks go coal-black on a full range
                emit([topCam[k], topCam[k2], baseCam[k2], baseCam[k]], groundCol(rgb2, lit, fade), pKey)
              }
              emit(topCam, groundCol(rgb2, 1, fade), pKey)
            }
          }
        }
        // CENTRE tiles wear a MARKER — an obelisk + name, drawn as overlay
        const bc2 = sim.boardCentreOf(g)
        if (!t.fog && bc2 && bc2[0] === g[0] && bc2[1] === g[1]) {
          const base = toCam(cx0, cy0, t.z)
          const tip = toCam(cx0, cy0, t.z + 1.1)
          if (base.d >= NEAR && tip.d >= NEAR) {
            const bh = sim.boardHexOf(g)
            const fig = bh && sim.npcAt(bh)
            const text = fig ? npcName(fig.pubkey) : bh && !bh[0] && !bh[1] ? "home" : null
            markers.push({ bs: toScreen(base), ts: toScreen(tip), text, fade })
          }
        }
      }
    }

    // the cached CAST shadows: world-space polys — only their sort keys,
    // fade and projection are per-frame camera work. All the casts landing
    // on ONE receiver merge into a single union fill (no double-darkening).
    const byRecv = new Map()
    for (const sh of shCache) {
      const rk = sh.rcx + "," + sh.rcy
      let e = byRecv.get(rk)
      if (!e) byRecv.set(rk, (e = { z: sh.z, wc: sh.wc, rcx: sh.rcx, rcy: sh.rcy, polys: [] }))
      e.polys.push(sh.poly)
    }
    for (const e of byRecv.values()) {
      let rKey = 0
      for (const q of e.wc) rKey = Math.max(rKey, pd2(q[0], q[1]))
      const df = Math.hypot(e.rcx - ex, e.rcy - ey)
      const f = 1 - 0.45 * Math.min(1, df / maxD)
      emit(
        e.polys.map(r => r.map(q => toCam(q[0], q[1], e.z))),
        ink,
        rKey - 1e-4,
        SH_ALPHA * f,
        null,
        1,
        true
      )
    }

    // the FIGURE — you, a small pillar in your angle's hue with an ink-lined
    // lid (follow mode only: in eye mode you ARE it) — queued like the rest,
    // so terrain properly occludes it
    if (mode === "follow") {
      const pz = pt0 ? pt0.z : FOG_Z
      const hue = sim.angle()
      const figR = 0.32
      const figH = 0.85
      const fb = []
      const ft = []
      const fKey = pd2(ex, ey) // the figure sorts by its centre too
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + (k * Math.PI) / 3
        fb.push(toCam(ex + Math.cos(a) * figR, ey + Math.sin(a) * figR, pz))
        ft.push(toCam(ex + Math.cos(a) * figR, ey + Math.sin(a) * figR, pz + figH))
      }
      for (let k = 0; k < 6; k++) {
        const k2 = (k + 1) % 6
        const ea = (Math.PI / 3) * (k + 1)
        const lit = 0.25 + 0.6 * Math.max(0, Math.cos(ea) * sunX + Math.sin(ea) * sunY)
        emit([ft[k], ft[k2], fb[k2], fb[k]], `hsl(${hue} 60% ${Math.round(25 + lit * 35)}%)`, fKey)
      }
      emit(ft, `hsl(${hue} 70% 55%)`, fKey, 1, ink, 0.9)
    }

    // ── flush: the sky, then every polygon far → near ──
    ctx.globalAlpha = 1
    ctx.fillStyle = surface
    ctx.fillRect(0, 0, W, H)
    ctx.lineJoin = "round"
    queue.sort((a, b) => b.d - a.d)
    for (const it of queue) {
      if (it.rings) {
        // several rings, ONE fill: nonzero winding unions them, so
        // overlapping casts never double-darken
        ctx.beginPath()
        let any = false
        for (const ring of it.pts) any = pathRing(ring) || any
        if (!any) continue
        ctx.fillStyle = it.fill
        ctx.globalAlpha = it.alpha
        ctx.fill()
        continue
      }
      ctx.fillStyle = it.fill
      ctx.globalAlpha = it.alpha
      if (!fillPoly(it.pts)) continue
      ctx.fill()
      if (it.stroke) {
        ctx.strokeStyle = it.stroke
        ctx.globalAlpha = it.strokeAlpha
        ctx.lineWidth = 1
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1

    // a path riding the rendered floor — the walked trail, the hover preview
    const floorPath = (pts, color, width, alpha, dash) => {
      if (!pts || pts.length < 2) return
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.globalAlpha = alpha
      ctx.lineJoin = "round"
      ctx.setLineDash(dash || [])
      ctx.beginPath()
      let pen = false
      for (const gt of pts) {
        const tt = topOf(gt)
        const c = tt && toCam(S3 * (gt[0] + gt[1] / 2), 1.5 * gt[1], tt.z + 0.08)
        if (!c || c.d < NEAR) {
          pen = false
          continue
        }
        const s = toScreen(c)
        pen ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y)
        pen = true
      }
      ctx.stroke()
      ctx.setLineDash([])
    }
    floorPath(sim.view().trail, ink, 2, 0.9) // the day's walked record
    // the HOVER trail — dashed, red when the move can't be paid
    floorPath(ui.path, ui.bad ? "#c0433a" : ink, 1.5, 0.7, [4, 4])

    // the markers (obelisk + name) float over the world, like the labels
    ctx.font = "600 10px system-ui, sans-serif"
    ctx.textAlign = "center"
    ctx.textBaseline = "alphabetic"
    for (const m of markers) {
      ctx.strokeStyle = ink
      ctx.globalAlpha = 0.9 * m.fade
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(m.bs.x, m.bs.y)
      ctx.lineTo(m.ts.x, m.ts.y)
      ctx.stroke()
      ctx.fillStyle = ink
      ctx.beginPath()
      ctx.arc(m.ts.x, m.ts.y, 2, 0, Math.PI * 2)
      ctx.fill()
      if (m.text) {
        ctx.globalAlpha = 0.95
        ctx.strokeStyle = surface
        ctx.lineWidth = 3
        ctx.strokeText(m.text, m.ts.x, m.ts.y - 4)
        ctx.fillStyle = ink
        ctx.fillText(m.text, m.ts.x, m.ts.y - 4)
      }
    }

    ctx.globalAlpha = 0.5
    ctx.fillStyle = ink
    ctx.font = "600 11px system-ui, sans-serif"
    ctx.textAlign = "left"
    ctx.textBaseline = "alphabetic"
    ctx.fillText(`move to peek · drag to look · scroll to zoom · dblclick to ride (×${scale.toFixed(1)})`, 5, H - 6)
    ctx.globalAlpha = 1
  }

  const loop = () => {
    draw() // the world changes under it as you walk — keep it live
    rafId = requestAnimationFrame(loop)
  }

  const onDown = e => {
    drag = { x: e.clientX, y: e.clientY, yaw, pitch }
    manual = true // hold the dragged view until the pointer leaves the panel
    canvas.style.cursor = "grabbing"
    e.stopPropagation()
  }
  const onLeave = () => {
    if (!drag) {
      manual = false // stepping off the panel hands the gaze back to the board
      lookTX = lookTY = 0 // …and the peek springs back to the anchor
    }
  }
  // the pointer's ABSOLUTE peek offset for a panel position — the borders
  // turn the gaze to the EXTREME, ±180°
  const peekOf = (x, y) => {
    const r = canvas.getBoundingClientRect()
    return [((x - r.left) / r.width - 0.5) * Math.PI * 2, ((y - r.top) / r.height - 0.5) * 1.0]
  }
  // moving the mouse over the panel PEEKS — an elastic look around the anchor
  const onPeek = e => {
    if (drag) return
    ;[lookTX, lookTY] = peekOf(e.clientX, e.clientY)
  }
  // moving/resizing the panel itself (the top bar, the corner grip)
  let moveDrag = null
  let sizeDrag = null
  const onHdrDown = e => {
    moveDrag = { dx: e.clientX - px, dy: e.clientY - py }
    e.preventDefault()
    e.stopPropagation()
  }
  const onGripDown = e => {
    sizeDrag = { w: pw, x: e.clientX }
    e.preventDefault()
    e.stopPropagation()
  }
  const onMove = e => {
    if (moveDrag) {
      px = e.clientX - moveDrag.dx
      py = e.clientY - moveDrag.dy
      layout() // clamps to the viewport margins
      return
    }
    if (sizeDrag) {
      pw = sizeDrag.w + (e.clientX - sizeDrag.x)
      layout() // clamps between MIN_W and the viewport cap
      return
    }
    if (!drag) return
    // inverted: you GRAB the world and pull it, the gaze goes the other way
    yaw = drag.yaw - (e.clientX - drag.x) * 0.008
    pitch = Math.max(-0.3, Math.min(1.35, drag.pitch - (e.clientY - drag.y) * 0.006))
  }
  const onWinResize = () => layout() // the viewport shrank: pull the panel back in
  const onUp = e => {
    moveDrag = sizeDrag = null
    const wasDrag = !!drag
    drag = null
    canvas.style.cursor = "grab"
    const r = panel.getBoundingClientRect()
    const inside = e && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
    if (wasDrag && inside) {
      // REBASE: the framing you released on IS the wanted centre. Fold the
      // pointer's absolute peek into the anchor so nothing pans afterward.
      const [ax, ay] = peekOf(e.clientX, e.clientY)
      yaw = yaw + lookX - ax
      pitch = Math.max(-0.3, Math.min(1.35, pitch + lookY - ay))
      lookX = lookTX = ax
      lookY = lookTY = ay
    } else if (!inside) {
      manual = false // released beyond the panel: the leave already happened mid-drag — unpin
      lookTX = lookTY = 0
    }
  }
  const onWheel = e => {
    e.preventDefault()
    zoomBias = Math.max(0.05, Math.min(15, zoomBias * Math.exp(-e.deltaY * 0.0012)))
    if (!aimActive()) scale = Math.max(0.05, Math.min(12, scale * Math.exp(-e.deltaY * 0.0012)))
  }
  const onDbl = e => {
    e.preventDefault()
    mode = mode === "eye" ? "follow" : "eye" // hop out of (or back into) the figure
  }
  const aimActive = () => {
    const u = (aim && aim()) || {}
    const pp = sim.view().player
    return !drag && !manual && u.at && (u.at[0] !== pp[0] || u.at[1] !== pp[1])
  }
  canvas.addEventListener("pointerdown", onDown)
  canvas.addEventListener("pointermove", onPeek)
  hdr.addEventListener("pointerdown", onHdrDown)
  grip.addEventListener("pointerdown", onGripDown)
  window.addEventListener("pointermove", onMove)
  window.addEventListener("pointerup", onUp)
  window.addEventListener("resize", onWinResize)
  canvas.addEventListener("wheel", onWheel, { passive: false })
  canvas.addEventListener("dblclick", onDbl)
  panel.addEventListener("pointerleave", onLeave)

  loop()
  return {
    destroy: () => {
      cancelAnimationFrame(rafId)
      canvas.removeEventListener("pointerdown", onDown)
      canvas.removeEventListener("pointermove", onPeek)
      hdr.removeEventListener("pointerdown", onHdrDown)
      grip.removeEventListener("pointerdown", onGripDown)
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("resize", onWinResize)
      canvas.removeEventListener("wheel", onWheel)
      canvas.removeEventListener("dblclick", onDbl)
      panel.removeEventListener("pointerleave", onLeave)
      panel.remove()
    }
  }
}
