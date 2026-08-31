// ANIM LAB — the menu scene: the player cup and the tile below it, drawn by
// the game's own code (render.js), shared by the menu-open and menu-close
// benches so the two can never disagree about what the elements look like.

import { drawPlayer, playerWeight, hexCorners, biomeColor } from "../lib/render.js"
import { POINTY } from "../lib/hex.js"

export const MENU_TRACKS = [
  { id: "tile.scale", label: "tile · scale", min: 0.5, max: 3.6, step: 0.01, def: 1 },
  { id: "tile.opacity", label: "tile · opacity", min: 0, max: 1, step: 0.01, def: 1 },
  { id: "player.scale", label: "player · scale", min: 0, max: 2, step: 0.01, def: 1 },
  { id: "player.lift", label: "player · lift (tiles up)", min: -1, max: 1, step: 0.01, def: 0 },
  { id: "player.opacity", label: "player · opacity", min: 0, max: 1, step: 0.01, def: 1 }
]

export const MENU_STAGE_OPTIONS = [
  { id: "zoom", label: "tile px", type: "range", min: 32, max: 120, step: 2, value: 64 },
  { id: "furniture", label: "rest-spot furniture", type: "checkbox", value: false }
]

export function drawMenuScene(ctx, { w, h, ink, surface, opts, sample }) {
  const size = opts.zoom
  const cx = w / 2
  const cy = h / 2
  const deg = POINTY.startDeg
  const hexPath = r => {
    const cs = hexCorners(cx, cy, r, deg)
    ctx.beginPath()
    cs.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
    ctx.closePath()
  }
  // THE TILE — exactly the menu's growing hex (render.js tileHex): an opaque
  // paper coat, the tile's dress over it, a 0.35-ink edge.
  const sT = sample("tile.scale")
  const aT = sample("tile.opacity")
  const r2 = size * Math.max(0.001, sT)
  if (aT > 0.002) {
    hexPath(r2)
    ctx.globalAlpha = aT
    ctx.fillStyle = surface
    ctx.fill()
    ctx.fillStyle = biomeColor("plain") // a plain-green tile stands in for the ground
    ctx.fill()
    ctx.globalAlpha = 0.35 * aT
    ctx.strokeStyle = ink
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.globalAlpha = 1
    if (opts.furniture) {
      // drawStack's furniture-only branch, scaled with the tile: the hairline
      // ring, thin radials to the centre, the seat's inverted Y
      const W = Math.max(1.5, size * 0.1)
      ctx.globalAlpha = aT
      ctx.strokeStyle = ink
      hexPath(r2)
      ctx.lineWidth = 0.5
      ctx.lineJoin = "round"
      ctx.stroke()
      const cs = hexCorners(cx, cy, r2, deg)
      ctx.lineWidth = W * 0.2
      ctx.beginPath()
      for (const p of cs) {
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(cx, cy)
      }
      ctx.stroke()
      const seat = hexCorners(cx, cy, r2 / 3, deg)
      ctx.lineWidth = W
      ctx.lineCap = "round"
      ctx.beginPath()
      for (const i of [1, 3, 5]) {
        ctx.moveTo(cx, cy)
        ctx.lineTo(seat[i].x, seat[i].y)
      }
      ctx.stroke()
      ctx.lineCap = "butt"
      ctx.globalAlpha = 1
    }
  }
  // THE PLAYER — the cup at ⅔ of a tile (1:1 in the game today), on top
  const sP = sample("player.scale")
  const lift = sample("player.lift")
  const aP = sample("player.opacity")
  if (aP > 0.002 && sP > 0.002) {
    ctx.globalAlpha = aP
    drawPlayer(ctx, cx, cy - lift * size, size * (2 / 3) * sP, ink, surface, playerWeight(size * sP))
    ctx.globalAlpha = 1
  }
}
