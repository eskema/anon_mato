// The WebGL TWIN of view3d.js — an A/B experiment. Same world sampling
// (vertex-merged skin, banded heights, waterline sheets, home minimap with
// mini pillars, fog drapes), same panel and camera feel (peek, drag, aim,
// ride) — but rendered through three.js: a real DEPTH BUFFER instead of the
// painter's queue, real LIGHTS + SHADOW MAPS instead of projected shadow
// polygons. Whichever version survives absorbs the other; the sampling here
// deliberately mirrors view3d.js line for line where it can.
//
// v1 parity notes: terrain, water, roads, home + minis, walls, figure, mist,
// distance fog and cast shadows are in; the trail/hover overlays and the
// centre markers are NOT yet (they ride on the canvas renderer's projector).

import * as THREE from "./vendor/three.module.min.js"
import { theme } from "./draw.js"
import { DIRS } from "./world.js"
import { WATER_LEVEL, ENERGY_START } from "./sim.js"
import { biomeColor, nibbleColor } from "./render.js"

const FOV_H = Math.PI / 2.6 // horizontal, like the canvas twin
const VSCALE = 0.55
const WALL_H = 0.8
const S3 = Math.sqrt(3)
const SEAM_RGB = [150, 148, 140]
const FOG_RGB = [126, 126, 126]
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
const bandH = h => {
  const x = Math.max(WATER_LEVEL, h)
  if (x <= 7) return WATER_LEVEL + (x - WATER_LEVEL) * 0.15
  if (x <= 11) return WATER_LEVEL + 1.2 + (x - 7) * 0.55
  return WATER_LEVEL + 4.2 + (x - 11) * 1.0
}
const FOG_Z = WATER_LEVEL * VSCALE
const DIR_IDX = new Map(DIRS.map((d, i) => [d.q + "," + d.r, i]))
const R_DISK = 30 // the built world's radius around the player, in tiles

const hslToRgb = (h, s, l) => {
  const a = s * Math.min(l, 1 - l)
  const f = n => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
  }
  return [f(0), f(8), f(4)]
}

export function initView3dGl(sim, aim = null) {
  const MARGIN = 12
  const HDR = 16
  const MIN_W = 220
  const panel = document.createElement("div")
  panel.style.cssText =
    "position:fixed;z-index:40;border:1px solid var(--text);background:var(--surface);box-sizing:border-box;" +
    "display:flex;flex-direction:column;"
  const hdr = document.createElement("div")
  hdr.style.cssText =
    "flex:none;height:" + HDR + "px;cursor:move;touch-action:none;" +
    "background:linear-gradient(var(--text) 0 0) center / 44px 3px no-repeat;opacity:0.4;"
  const canvas = document.createElement("canvas")
  canvas.style.cssText =
    "width:100%;height:calc(100% - " + HDR + "px);display:block;cursor:grab;touch-action:none;"
  const grip = document.createElement("div")
  grip.style.cssText =
    "position:absolute;right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize;touch-action:none;" +
    "background:linear-gradient(135deg,transparent 50%,var(--text) 50%);opacity:0.35;"
  const hint = document.createElement("div")
  hint.style.cssText =
    "position:absolute;left:6px;bottom:4px;font:600 11px system-ui,sans-serif;color:var(--text);opacity:0.5;pointer-events:none;"
  panel.append(hdr, canvas, grip, hint)
  document.body.append(panel)

  // ── three.js scaffolding ──
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.05, 300)
  const setFov = () => {
    // the canvas twin's FOV is HORIZONTAL — convert for three's vertical one
    camera.fov = (2 * Math.atan(Math.tan(FOV_H / 2) / camera.aspect) * 180) / Math.PI
    camera.updateProjectionMatrix()
  }
  const hemi = new THREE.HemisphereLight(0xffffff, 0x667766, 0.7)
  const sun = new THREE.DirectionalLight(0xffffff, 2.0)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 220
  sun.shadow.camera.left = sun.shadow.camera.bottom = -46
  sun.shadow.camera.right = sun.shadow.camera.top = 46
  sun.shadow.bias = -0.0003
  sun.shadow.normalBias = 0.18 // the big flat platforms stripe (acne) below this
  scene.add(hemi, sun, sun.target)

  let pw = Math.min(560, window.innerWidth * 0.46)
  let px = 0
  let py = 0
  const layout = () => {
    const maxW = Math.min(window.innerWidth - 2 * MARGIN, ((window.innerHeight - 2 * MARGIN - HDR) * 16) / 9)
    pw = Math.max(MIN_W, Math.min(pw, maxW))
    const ph = (pw * 9) / 16 + HDR
    px = Math.max(MARGIN, Math.min(px, window.innerWidth - MARGIN - pw))
    py = Math.max(MARGIN, Math.min(py, window.innerHeight - MARGIN - ph))
    panel.style.left = px + "px"
    panel.style.top = py + "px"
    panel.style.width = pw + "px"
    panel.style.height = ph + "px"
    const cw = Math.max(64, Math.round(pw - 2))
    const ch = Math.max(36, Math.round((pw * 9) / 16))
    renderer.setSize(cw, ch, false)
    camera.aspect = cw / ch
    setFov()
  }
  px = window.innerWidth - MARGIN - pw
  py = window.innerHeight - MARGIN - ((pw * 9) / 16 + HDR)
  layout()

  let yaw = 0
  let pitch = 0.45
  let scale = 0.2
  let zoomBias = 1
  let lookX = 0
  let lookY = 0
  let lookTX = 0
  let lookTY = 0
  let drag = null
  let manual = false
  let mode = "eye"
  let rafId = 0

  const rgbOf = col => (col.match(/\d+/g) || [128, 128, 128]).map(Number)
  const nuance = (a, b, c, d) => {
    let x = (a * 374761393 + b * 668265263 + c * 1103515245 + d * 987654323) | 0
    x = ((x ^ (x >>> 13)) * 1274126177) | 0
    return 0.5 + ((x >>> 15) % 1000) / 1000
  }
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

  // ── world sampling (mirrors view3d.js) — cached until the next rebuild ──
  let tops = new Map()
  let verts = new Map()
  const topOf = g => {
    const k = g[0] + "," + g[1]
    let t = tops.get(k)
    if (t !== undefined) return t
    if (!sim.isDiscovered(g)) {
      if (!sim.kindOf(g)) t = null
      else {
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
        const rgb = water ? waterBlue(deep) : col ? rgbOf(col) : SEAM_RGB
        const seam = !col
        let h
        if (water) h = WATER_LEVEL
        else if (!seam) h = bandH(raw)
        else {
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
            const hb2 = sim.boardHexOf(ng)
            if (hb2 && hb2[0] === 0 && hb2[1] === 0) {
              s += WATER_LEVEL + 0.3
              n++
              continue
            }
            const nraw = sim.heightAt(ng)
            if (nraw == null || !biomeColor(nty, nraw, sim.smoothAt(ng))) continue
            s += bandH(nraw)
            n++
          }
          h = n ? s / n : WATER_LEVEL
        }
        t = { z: h * VSCALE, h, rgb, water, seam }
        if (water) t.deep = deep
      }
    }
    if (t && !t.fog) {
      const hb = sim.boardHexOf(g)
      if (hb && hb[0] === 0 && hb[1] === 0) {
        const chs = sim.nibbleAt(g)
        const visited = sim.parentOf().tile.discovered.has(g[0] + "," + g[1])
        t.rgb = visited && chs != null ? rgbOf(nibbleColor(chs)) : FOG_RGB.slice()
        t.h = WATER_LEVEL + 0.3
        t.z = t.h * VSCALE
        t.home = g
        t.water = t.seam = false
      }
    }
    tops.set(k, t)
    return t
  }
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

  // ── the geometry build: triangle soups → meshes ──
  const lin = u => Math.pow(u / 255, 2.2) // sRGB-ish → linear for vertex colours
  const soup = () => ({ pos: [], col: [] })
  const pushTri = (s, a, b, c, rgb) => {
    // world (x,y,z=up) → three (x, up, y)
    s.pos.push(a[0], a[2], a[1], b[0], b[2], b[1], c[0], c[2], c[1])
    const r = lin(rgb[0])
    const g = lin(rgb[1])
    const bl = lin(rgb[2])
    s.col.push(r, g, bl, r, g, bl, r, g, bl)
  }
  const pushFan = (s, pts, rgb) => {
    for (let i = 1; i < pts.length - 1; i++) pushTri(s, pts[0], pts[i], pts[i + 1], rgb)
  }
  const pushQuad = (s, a, b, c, d, rgb) => {
    pushTri(s, a, b, c, rgb)
    pushTri(s, a, c, d, rgb)
  }
  const meshOf = (s, mat) => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute("position", new THREE.Float32BufferAttribute(s.pos, 3))
    geo.setAttribute("color", new THREE.Float32BufferAttribute(s.col, 3))
    geo.computeVertexNormals()
    return new THREE.Mesh(geo, mat)
  }
  // faces sit a hair behind their wires (polygon offset), so the ink fold
  // lines — the canvas twin's graphic signature — never z-fight
  const matGround = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1
  })
  const matFog = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1
  })
  const matWire = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.3 })
  let world = null // the rebuilt group
  let figure = null
  let stamp = ""
  let buildGX = Infinity // the built disk's centre (plan) — rebuild on stray
  let buildGY = Infinity

  const buildWorld = () => {
    tops = new Map()
    verts = new Map()
    if (world) {
      world.traverse(o => o.geometry && o.geometry.dispose())
      scene.remove(world)
    }
    world = new THREE.Group()
    const ground = soup() // land, roads, home, cliffs, walls, minis
    const water = soup() // sheets + mini films (receives, never casts)
    const mist = soup() // fog drapes + their edge curtains (no shadows at all)
    const wire = [] // the ink fold lines: platform rims + apron edges
    const pushLine = (a, b) => wire.push(a[0], a[2], a[1], b[0], b[2], b[1])
    const pushOutline = pts => {
      for (let i = 0; i < pts.length; i++) pushLine(pts[i], pts[(i + 1) % pts.length])
    }
    const p = sim.view().player
    const wallHue = sim.angle()
    const wallRgb = hslToRgb(wallHue, 0.45, 0.42)
    for (let q2 = -R_DISK; q2 <= R_DISK; q2++) {
      for (let r2 = Math.max(-R_DISK, -q2 - R_DISK); r2 <= Math.min(R_DISK, -q2 + R_DISK); r2++) {
        const g = [p[0] + q2, p[1] + r2]
        const t = topOf(g)
        if (!t) continue
        const cx0 = S3 * (g[0] + g[1] / 2)
        const cy0 = 1.5 * g[1]
        const flat = !!t.home
        const cs = []
        for (let k = 0; k < 6; k++) {
          const a = Math.PI / 6 + (k * Math.PI) / 3
          const vx = cx0 + Math.cos(a)
          const vy = cy0 + Math.sin(a)
          const vz = flat ? t.z : vtxZ(vx, vy, a + Math.PI)
          cs.push([vx, vy, vz])
        }
        // walls: the void curtain at the world's edge; the game's slabs
        const wb = t.fog ? 0 : sim.wallsAt(g)
        for (let k = 0; k < 6; k++) {
          const k2 = (k + 1) % 6
          const ea = (Math.PI / 3) * (k + 1)
          const nx2 = Math.cos(ea)
          const ny2 = Math.sin(ea)
          const nb = hexAt(cx0 + nx2 * S3, cy0 + ny2 * S3)
          const n = topOf(nb)
          if (!n) {
            const sTo = t.fog ? mist : ground
            pushQuad(
              sTo,
              cs[k],
              cs[k2],
              [cs[k2][0], cs[k2][1], 0],
              [cs[k][0], cs[k][1], 0],
              t.rgb
            )
          }
          const dIdx = DIR_IDX.get(nb[0] - g[0] + "," + (nb[1] - g[1]))
          if (dIdx != null && ((wb >> dIdx) & 1) === 1) {
            const wq = 0.09
            const ox = -nx2 * wq
            const oy = -ny2 * wq
            const zk = cs[k][2] + WALL_H
            const zk2 = cs[k2][2] + WALL_H
            pushQuad(ground, cs[k], cs[k2], [cs[k2][0], cs[k2][1], zk2], [cs[k][0], cs[k][1], zk], wallRgb)
            pushQuad(
              ground,
              [cs[k][0] + ox, cs[k][1] + oy, cs[k][2]],
              [cs[k2][0] + ox, cs[k2][1] + oy, cs[k2][2]],
              [cs[k2][0] + ox, cs[k2][1] + oy, zk2],
              [cs[k][0] + ox, cs[k][1] + oy, zk],
              wallRgb
            )
            pushQuad(
              ground,
              [cs[k][0], cs[k][1], zk],
              [cs[k2][0], cs[k2][1], zk2],
              [cs[k2][0] + ox, cs[k2][1] + oy, zk2],
              [cs[k][0] + ox, cs[k][1] + oy, zk],
              wallRgb
            )
          }
        }
        if (t.home) {
          pushFan(ground, cs, t.rgb)
          pushOutline(cs)
          // the MINIS: the board's discovered interior as little pillars
          if (t.home[0] || t.home[1]) {
            const node = sim.parentOf().tile.children[t.home[0] + "," + t.home[1]]
            if (node && node.discovered.size) {
              const c0 = sim.centreOf(t.home)
              const su = 1 / 9.5
              const MINI_H = 0.15
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
                const base = t.z + 0.005
                const sr = su * 0.86
                const mpts = []
                for (let k = 0; k < 6; k++) {
                  const a = Math.PI / 6 + (k * Math.PI) / 3
                  mpts.push([mx + Math.cos(a) * sr, my + Math.sin(a) * sr])
                }
                if (ty2 === "water") {
                  const dpt = Math.max(0, Math.min(WATER_LEVEL, WATER_LEVEL - Math.round(sim.smoothAt(g2))))
                  pushFan(water, mpts.map(q => [q[0], q[1], base + 0.004]), waterBlue(dpt))
                  continue
                }
                const mh = Math.max(0.02, ((bandH(raw ?? WATER_LEVEL) - WATER_LEVEL) / (bandH(15) - WATER_LEVEL)) * MINI_H)
                pushFan(ground, mpts.map(q => [q[0], q[1], base + mh]), rgb2)
                for (let k = 0; k < 6; k++) {
                  const k2 = (k + 1) % 6
                  pushQuad(
                    ground,
                    [mpts[k][0], mpts[k][1], base + mh],
                    [mpts[k2][0], mpts[k2][1], base + mh],
                    [mpts[k2][0], mpts[k2][1], base],
                    [mpts[k][0], mpts[k][1], base],
                    rgb2
                  )
                }
              }
            }
          }
        } else if (t.fog) {
          pushFan(mist, cs, t.rgb)
        } else if (t.water) {
          pushFan(water, cs, t.rgb)
        } else {
          // land & roads: flat platform + aprons out to the merged rim
          const inner = []
          for (let k = 0; k < 6; k++) {
            const a = Math.PI / 6 + (k * Math.PI) / 3
            inner.push([cx0 + Math.cos(a) * (2 / 3), cy0 + Math.sin(a) * (2 / 3), t.z])
          }
          pushFan(ground, inner, t.rgb)
          pushOutline(inner)
          pushOutline(cs)
          for (let k = 0; k < 6; k++) {
            const k2 = (k + 1) % 6
            pushQuad(ground, inner[k], inner[k2], cs[k2], cs[k], t.rgb)
            pushLine(inner[k], cs[k]) // the apron spokes — the folds read
          }
        }
      }
    }
    const gm = meshOf(ground, matGround)
    gm.castShadow = true
    gm.receiveShadow = true
    const wm = meshOf(water, matGround)
    wm.receiveShadow = true
    const fm = meshOf(mist, matFog)
    const wgeo = new THREE.BufferGeometry()
    wgeo.setAttribute("position", new THREE.Float32BufferAttribute(wire, 3))
    world.add(gm, wm, fm, new THREE.LineSegments(wgeo, matWire))
    scene.add(world)
    // the FIGURE — a small pillar in the angle's hue (persists across builds)
    if (!figure) {
      const fg = new THREE.CylinderGeometry(0.32, 0.32, 0.85, 6)
      const fmat = new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(sim.angle() / 360, 0.6, 0.45) })
      figure = new THREE.Mesh(fg, fmat)
      figure.castShadow = true
      scene.add(figure)
    }
  }

  const frame = () => {
    const paper = new THREE.Color(theme("--surface", "#111"))
    scene.background = paper
    scene.fog = new THREE.Fog(paper, 16, 50)
    matWire.color.set(theme("--text", "#eee"))

    const p = sim.view().player
    const ex = S3 * (p[0] + p[1] / 2)
    const ey = 1.5 * p[1]
    // rebuild only when the WORLD changes (discovery, day, level) or the
    // player strays from the built disk's centre — walking known ground
    // moves only the camera, never the mesh
    const now = sim.day() + ":" + sim.depth() + ":" + sim.worldStamp()
    if (now !== stamp || Math.hypot(ex - buildGX, ey - buildGY) > 14) {
      stamp = now
      buildGX = ex
      buildGY = ey
      buildWorld()
    }

    // aim / peek / zoom easing — the same feel as the canvas twin
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
      yaw += d * 0.15
      const sT = Math.max(0.05, Math.min(12, (0.08 + aimDist / 12) * zoomBias))
      scale += (sT - scale) * 0.1
    }
    const pt0 = topOf(p)
    const eyeZ = (pt0 ? pt0.z : FOG_Z) + Math.max(0.45, 1.2 * scale)
    if (aiming) {
      const atZ = topOf(at) ? topOf(at).z : FOG_Z
      const pW = Math.max(-0.3, Math.min(1.35, Math.atan2(eyeZ - atZ, Math.max(0.4, aimDist))))
      pitch += (pW - pitch) * 0.1
    }
    lookX += (lookTX - lookX) * 0.12
    lookY += (lookTY - lookY) * 0.12
    const yawE = yaw + lookX
    let camX = ex
    let camY = ey
    let camZ = eyeZ
    let pitchF = 0
    if (mode === "follow") {
      const back = 1.4 + 2.2 * scale
      camX -= Math.sin(yawE) * back
      camY += Math.cos(yawE) * back
      camZ = (pt0 ? pt0.z : FOG_Z) + 0.9 + 1.4 * scale
      pitchF = 0.18
    }
    const pitchE = Math.max(-0.3, Math.min(1.35, pitch + lookY + pitchF))
    camera.position.set(camX, camZ, camY)
    const cosP = Math.cos(pitchE)
    camera.lookAt(camX + Math.sin(yawE) * cosP, camZ - Math.sin(pitchE), camY - Math.cos(yawE) * cosP)

    // the sun rides the day's angle, at a stylised height; shadows follow
    const sunRad = (((sim.day() - 1) % 360) * Math.PI) / 180
    const sunX = Math.sin(sunRad)
    const sunY = -Math.cos(sunRad)
    const elev = 0.62 // ~32°
    sun.position.set(ex + sunX * 60 * Math.cos(elev), 60 * Math.sin(elev), ey + sunY * 60 * Math.cos(elev))
    sun.target.position.set(ex, 0, ey)
    const low = Math.abs(1 - 2 * ((ENERGY_START - sim.energy()) / ENERGY_START))
    sun.intensity = 1.3 + 0.9 * (1 - low) // brighter at noon, softer at the day's ends

    if (figure) {
      figure.position.set(ex, (pt0 ? pt0.z : FOG_Z) + 0.425, ey)
      figure.visible = mode === "follow"
    }
    hint.textContent = `move to peek · drag to look · scroll to zoom · dblclick to ride (×${scale.toFixed(1)}) · GL`
    renderer.render(scene, camera)
  }

  const loop = () => {
    frame()
    rafId = requestAnimationFrame(loop)
  }

  // ── input: identical to the canvas twin ──
  const onDown = e => {
    drag = { x: e.clientX, y: e.clientY, yaw, pitch }
    manual = true
    canvas.style.cursor = "grabbing"
    e.stopPropagation()
  }
  const onLeave = () => {
    if (!drag) {
      manual = false
      lookTX = lookTY = 0
    }
  }
  const peekOf = (x, y) => {
    const r = canvas.getBoundingClientRect()
    return [((x - r.left) / r.width - 0.5) * Math.PI * 2, ((y - r.top) / r.height - 0.5) * 1.0]
  }
  const onPeek = e => {
    if (drag) return
    ;[lookTX, lookTY] = peekOf(e.clientX, e.clientY)
  }
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
      layout()
      return
    }
    if (sizeDrag) {
      pw = sizeDrag.w + (e.clientX - sizeDrag.x)
      layout()
      return
    }
    if (!drag) return
    yaw = drag.yaw - (e.clientX - drag.x) * 0.008
    pitch = Math.max(-0.3, Math.min(1.35, drag.pitch - (e.clientY - drag.y) * 0.006))
  }
  const onWinResize = () => layout()
  const onUp = e => {
    moveDrag = sizeDrag = null
    const wasDrag = !!drag
    drag = null
    canvas.style.cursor = "grab"
    const r = panel.getBoundingClientRect()
    const inside = e && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
    if (wasDrag && inside) {
      const [ax, ay] = peekOf(e.clientX, e.clientY)
      yaw = yaw + lookX - ax
      pitch = Math.max(-0.3, Math.min(1.35, pitch + lookY - ay))
      lookX = lookTX = ax
      lookY = lookTY = ay
    } else if (!inside) {
      manual = false
      lookTX = lookTY = 0
    }
  }
  const aimActive = () => {
    const u = (aim && aim()) || {}
    const pp = sim.view().player
    return !drag && !manual && u.at && (u.at[0] !== pp[0] || u.at[1] !== pp[1])
  }
  const onWheel = e => {
    e.preventDefault()
    zoomBias = Math.max(0.05, Math.min(15, zoomBias * Math.exp(-e.deltaY * 0.0012)))
    if (!aimActive()) scale = Math.max(0.05, Math.min(12, scale * Math.exp(-e.deltaY * 0.0012)))
  }
  const onDbl = e => {
    e.preventDefault()
    mode = mode === "eye" ? "follow" : "eye"
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
      if (world) world.traverse(o => o.geometry && o.geometry.dispose())
      if (figure) figure.geometry.dispose()
      renderer.dispose()
      panel.remove()
    }
  }
}
