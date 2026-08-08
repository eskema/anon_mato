// The 3D cube — a solid 8×8×8 lattice drawn in orthographic 3D that you can drag
// to rotate. Self-contained DOM component (its own canvas), mounted in the cube
// view's "cube" tab. Default rotation looks down the space diagonal (isometric):
// the silhouette is a regular hexagon.

import { theme } from "./draw.js"

export function initCube3d(mount) {
  const N = 8
  const dpr = window.devicePixelRatio || 1
  let yaw = -Math.PI / 4
  let pitch = Math.atan(1 / Math.SQRT2)
  let drag = null
  let W = 600
  let H = 500

  mount.textContent = ""
  const canvas = document.createElement("canvas")
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;cursor:grab;touch-action:none;"
  mount.append(canvas)
  const ctx = canvas.getContext("2d")

  function rot(p) {
    const cyaw = Math.cos(yaw)
    const syaw = Math.sin(yaw)
    const cpit = Math.cos(pitch)
    const spit = Math.sin(pitch)
    const x = p[0] * cyaw + p[2] * syaw
    const z0 = -p[0] * syaw + p[2] * cyaw
    const y = p[1] * cpit - z0 * spit
    return [x, y]
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    const ink = theme("--text", "#eee")
    const s = (Math.min(W, H) * 0.6) / N
    const cx = W / 2
    const cy = H / 2
    const project = (x, y, z) => {
      const r = rot([x - N / 2, y - N / 2, z - N / 2])
      return { X: cx + r[0] * s, Y: cy - r[1] * s }
    }
    const faces = [
      { axis: "x", val: 0 },
      { axis: "x", val: N },
      { axis: "y", val: 0 },
      { axis: "y", val: N },
      { axis: "z", val: 0 },
      { axis: "z", val: N }
    ].map(f => {
      const pt =
        f.axis === "x" ? (i, j) => [f.val, i, j] : f.axis === "y" ? (i, j) => [i, f.val, j] : (i, j) => [i, j, f.val]
      return { ...f, pt }
    })
    ctx.lineJoin = "round"
    ctx.strokeStyle = ink
    ctx.globalAlpha = 0.25
    ctx.lineWidth = 1
    for (const f of faces) {
      for (let i = 0; i <= N; i++) {
        const a = project(...f.pt(i, 0))
        const b = project(...f.pt(i, N))
        const c = project(...f.pt(0, i))
        const d = project(...f.pt(N, i))
        ctx.beginPath()
        ctx.moveTo(a.X, a.Y)
        ctx.lineTo(b.X, b.Y)
        ctx.moveTo(c.X, c.Y)
        ctx.lineTo(d.X, d.Y)
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 0.45
    ctx.fillStyle = ink
    ctx.font = "600 14px var(--font)"
    ctx.textAlign = "center"
    ctx.textBaseline = "alphabetic"
    ctx.fillText("cube · 8×8×8 · drag to rotate", cx, H - 22)
    ctx.globalAlpha = 1
  }

  function resize() {
    W = mount.clientWidth || 600
    H = mount.clientHeight || 500
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    draw()
  }
  const ro = new ResizeObserver(resize)
  ro.observe(mount)

  const onDown = e => {
    drag = { x: e.clientX, y: e.clientY, yaw, pitch }
    canvas.style.cursor = "grabbing"
  }
  const onMove = e => {
    if (!drag) return
    yaw = drag.yaw + (e.clientX - drag.x) * 0.01
    pitch = Math.max(-1.35, Math.min(1.35, drag.pitch + (e.clientY - drag.y) * 0.01))
    draw()
  }
  const onUp = () => {
    drag = null
    canvas.style.cursor = "grab"
  }
  canvas.addEventListener("pointerdown", onDown)
  window.addEventListener("pointermove", onMove)
  window.addEventListener("pointerup", onUp)

  resize()
  return {
    destroy: () => {
      ro.disconnect()
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      mount.textContent = ""
    }
  }
}
