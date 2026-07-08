// STASHED — not wired into the game. A mouse-tracking googly eye for the player
// cube's top face. Pulled from render.js's drawEnergyCube because at the current
// player scale it read as noise rather than charm; kept here to drop onto a
// bigger figure later (a special tile, a portrait, a zoomed cube…).
//
// What it draws, on a pointy-top iso cube's TOP FACE (the lid diamond):
//   • an iris — a full-value shade of the angle colour, as tall as the diamond
//   • a pupil — a small dark dot; its rim crosses the middle of…
//   • a glint — a white reflection fixed at the CHOSEN ANGLE's spot on the wheel
//     (0°=up, clockwise): the pupil reads as the sun's orbit, the glint as the
//     sun frozen at the player's angle, so the eye reflects the angle choice
//   • the whole eyeball slides as ONE toward the pointer, clipped to the lid
//     diamond so its edges tuck under the cube's border + interior creases
//
// To reinstate, inside drawEnergyCube call `drawEye(ctx, opts)` AFTER the liquid
// faces but BEFORE the outline + Y (so those cap it), and remove the standalone
// outline/Y-first ordering. It needs:
//   • the pointer's pixel position — thread `pointer: lastP` into the renderer's
//     `ui` (grid.js draw()), and redraw on every pointer move (grid.js already
//     coalesces redraws through scheduleRender()).
//   • geometry from the cube: centre (x,y), radius r, lid half-width w = r·√3/2,
//     half-height h = r/2, plus hue/ink/surface and the bold width W.

// opts: { x, y, r, w, h, hue, ink, pointer }  — pointer is {x,y} in the same
// (CSS-pixel) space as the cube, or null.
export function drawEye(ctx, { x, y, r, w, h, hue, ink, pointer }) {
  const dCx = x
  const dCy = y - r / 2 // the lid's centre
  const irisR = r * 0.5 // as tall as the diamond (peak → centre)
  const glintDist = r * 0.15 // the glint's distance from the pupil centre
  const pupilR = glintDist // pupil sized so its rim crosses the glint's middle
  const glintR = r * 0.09
  const maxTravel = r * 0.22
  let ox = 0
  let oy = 0
  if (pointer && Math.hypot(pointer.x - x, pointer.y - y) >= r) {
    const dx = pointer.x - dCx
    const dy = pointer.y - dCy
    const m = Math.hypot(dx, dy) || 1
    const t = Math.min(maxTravel, m)
    ox = (dx / m) * t
    oy = (dy / m) * t
  }
  ctx.save()
  ctx.beginPath() // clip to the lid diamond — the eye's socket
  ctx.moveTo(x, y - r)
  ctx.lineTo(x + w, y - h)
  ctx.lineTo(x, y)
  ctx.lineTo(x - w, y - h)
  ctx.closePath()
  ctx.clip()
  ctx.beginPath() // iris — a full-value shade of the angle colour, no border
  ctx.arc(dCx + ox, dCy + oy, irisR, 0, Math.PI * 2)
  ctx.fillStyle = `hsl(${hue} 82% 46%)`
  ctx.fill()
  ctx.beginPath() // pupil
  ctx.arc(dCx + ox, dCy + oy, pupilR, 0, Math.PI * 2)
  ctx.fillStyle = ink
  ctx.fill()
  const aRad = (hue * Math.PI) / 180 // the glint at the chosen angle on the wheel
  ctx.beginPath()
  ctx.arc(dCx + ox + Math.sin(aRad) * glintDist, dCy + oy - Math.cos(aRad) * glintDist, glintR, 0, Math.PI * 2)
  ctx.fillStyle = "#fff"
  ctx.fill()
  ctx.restore()
}
