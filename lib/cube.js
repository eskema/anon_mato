// Cube view — an experiment. A solid N×N×N lattice drawn in orthographic 3D that you can
// drag to rotate, to get a feel for whether the "inner view" could live in a cube instead
// of a hex grid. Self-contained screen; nothing else in the app depends on it.

import { theme } from "./draw.js"

export function CubeScreen(onBack) {
  const N = 8
  let api = null
  // Default rotation looks straight down the cube's space diagonal (isometric): the
  // silhouette is a perfect regular hexagon, and the top-front vertex projects exactly
  // onto the bottom-back vertex at the centre.
  let yaw = -Math.PI / 4 // rotation about the vertical axis (drag left/right)
  let pitch = Math.atan(1 / Math.SQRT2) // tilt (drag up/down)
  let drag = null
  const back = { x: 14, y: 14, w: 74, h: 28 }

  const enter = a => (api = a)

  // Rotate a centred point by yaw (about vertical Y) then pitch (about X); z is depth.
  function rot(p) {
    const cyaw = Math.cos(yaw)
    const syaw = Math.sin(yaw)
    const cpit = Math.cos(pitch)
    const spit = Math.sin(pitch)
    const x = p[0] * cyaw + p[2] * syaw
    const z0 = -p[0] * syaw + p[2] * cyaw
    const y = p[1] * cpit - z0 * spit
    const z = p[1] * spit + z0 * cpit
    return [x, y, z]
  }

  function draw(ctx, L) {
    const ink = theme("--text", "#eee")
    const s = (Math.min(L.w, L.h) * 0.6) / N
    const project = (x, y, z) => {
      const r = rot([x - N / 2, y - N / 2, z - N / 2])
      return { X: L.cx + r[0] * s, Y: L.cy - r[1] * s, depth: r[2] }
    }

    // the 6 faces, each an N×N grid — no fill/tint: a fully transparent wireframe
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
    ctx.globalAlpha = 1

    ctx.font = "600 16px system-ui, sans-serif"
    ctx.textAlign = "left"
    ctx.textBaseline = "middle"
    ctx.fillStyle = ink
    ctx.globalAlpha = 0.9
    ctx.fillText("← back", back.x, back.y + back.h / 2)
    ctx.globalAlpha = 0.45
    ctx.fillText("cube · 8×8×8 · drag to rotate", back.x, L.h - 22)
    ctx.globalAlpha = 1
  }

  function onPointerDown(p) {
    if (p.x >= back.x - 4 && p.x <= back.x + back.w && p.y >= back.y && p.y <= back.y + back.h) {
      onBack()
      return
    }
    drag = { x: p.x, y: p.y, yaw, pitch }
    document.body.style.cursor = "grabbing"
  }
  function onPointerMove(p) {
    if (!drag) return
    yaw = drag.yaw + (p.x - drag.x) * 0.01
    pitch = Math.max(-1.35, Math.min(1.35, drag.pitch + (p.y - drag.y) * 0.01))
    api.requestRender()
  }
  function onPointerUp() {
    drag = null
    document.body.style.cursor = "default"
  }

  return { id: "cube", enter, draw, onPointerDown, onPointerMove, onPointerUp }
}
