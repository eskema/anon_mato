// The setup screens' window into the game.
//
// Setup doesn't mock up the world, it stands in it: a REAL sim and a REAL
// renderer, so the tile you discover here IS the home board's centre — the
// same place, the same size, the same fog, the same label it will wear a
// moment later when the world opens. Nothing here dispatches or persists;
// the stage only borrows the world's geometry and its drawing.
//
// And the same LIGHT: day one begins at 00:00, so there is none. The board is
// black because the world is black at that hour, by the same sun and the same
// moon the first morning will bring up.
//
// The pubkey is what the home board is inscribed with, so the stage is rebuilt
// once the key lands — same world, now with a name on it.

import { createSim } from "../sim.js"
import { createRenderer, cursorDot, dialRadius, drawPlayer, playerWeight, frontierDot, fogHover, fogCoat, hexCorners, mapLight, nightPair, drawSkillWheel } from "../render.js"
import { STAT_NAMES } from "../sim.js"
import { sunState, moonState } from "../clock.js"
import { drawIcon } from "../icons.js"
import { theme, hitBox } from "../draw.js"

export function createStage(pubkey = null) {
  // the angle isn't picked yet; it only moves the gate, never the orientation,
  // so the default seeds a board that already sits the way the real one will
  const sim = createSim({ pubkey })
  const renderer = createRenderer(sim)
  let geom = { x: 0, y: 0, size: 1, startDeg: 0 }

  // Where the world puts the home centre. Call once per frame before drawing —
  // the renderer's own frame + fit, so nothing drifts between here and there.
  // With the camera at rest this point is also the frame's centre, which is
  // where the sun dial hangs.
  function place(L) {
    renderer.setFrame(L)
    const size = renderer.sizeFor()
    const c = renderer.hexToPixel(L, 0, 0, size)
    geom = { x: c.x, y: c.y, size, startDeg: renderer.orient().startDeg }
    return geom
  }

  // The day's clock rings the board from the same centre at the same radius —
  // in setup that ring IS the face the angle is measured on.
  const dialR = () => dialRadius(geom.size)

  // The world's own hour, painted: the fog's base coat and the night over it.
  // Returns the dress everything drawn after should wear — after dark the
  // readable layer flips light, and setup is all readable layer.
  function night(ctx, L) {
    const spent = sim.dayBudget() - sim.energy() // minutes since waking; day one starts at 00:00
    const dial = { day: sim.day(), minuteOfDay: spent, cx: geom.x, cy: geom.y, R: dialR() }
    const { sunDeg, sunAlt, isNight } = sunState(dial)
    const dress = nightPair(theme("--text", "#eee"), theme("--surface", "#111"), sunAlt, isNight)
    fogCoat(ctx, L, dress.surface)
    mapLight(ctx, L, geom, geom.size, { sunAlt, sunDeg, isNight, moon: moonState(dial) })
    return dress
  }

  // THE YEAR'S SKY — the same constellations the game draws, brought in over
  // the ceremony's big turn (2026-08-28): by the time the wheel lands, the sky
  // it turned under is already there. `fade` is the caller's ramp.
  function sky(ctx, L, dress, fade) {
    if (fade <= 0.002) return
    const spent = sim.dayBudget() - sim.energy()
    const dial = { day: sim.day(), minuteOfDay: spent, cx: geom.x, cy: geom.y, R: dialR() }
    const s = sunState(dial)
    drawSkillWheel(ctx, {
      cx: geom.x,
      cy: geom.y,
      R: dialR(),
      size: geom.size,
      day: sim.day(),
      sunAlt: s.sunAlt,
      moonIllum: moonState(dial).illum,
      ink: dress.ink,
      dotInk: dress.ink,
      glyphInk: dress.ink,
      progressOf: i => sim.skillProgress(STAT_NAMES[i]),
      w: L.w,
      h: L.h,
      fade
    })
  }

  // The tile's hit area — its inradius, so a click lands where the shape is
  // rather than out in its bounding corners.
  // (null-safe: the setup screens redraw on fade/timer ticks before any
  //  pointer exists — a bare `p.x` there threw and killed the frame)
  const onCentre = p => !!p && Math.hypot(p.x - geom.x, p.y - geom.y) <= geom.size * 0.87

  // Undiscovered ground shows one mark. Hovering it pools light in the cell —
  // but no outline: the tile's SHAPE is the thing the angle finally settles, so
  // it isn't given away before then. `discovered` is what draws it, and `fill`
  // (0..1) is how much of its perimeter has been drawn — the walk home lays the
  // edges down one after another, so the tile finishes as you land on it.
  function drawCentre(ctx, ink, { hovered = false, discovered = false, fill = 1 } = {}) {
    if (hovered) fogHover(ctx, geom.x, geom.y, geom.size, geom.startDeg, ink, false)
    if (discovered && fill > 0) {
      const cs = hexCorners(geom.x, geom.y, geom.size, geom.startDeg)
      const legs = Math.max(0, Math.min(1, fill)) * 6
      const whole = Math.floor(legs)
      const part = legs - whole
      ctx.beginPath()
      ctx.moveTo(cs[0].x, cs[0].y)
      for (let k = 1; k <= whole; k++) ctx.lineTo(cs[k % 6].x, cs[k % 6].y)
      if (part > 0 && whole < 6) {
        const a = cs[whole % 6]
        const b = cs[(whole + 1) % 6]
        ctx.lineTo(a.x + (b.x - a.x) * part, a.y + (b.y - a.y) * part)
      }
      ctx.strokeStyle = ink
      ctx.globalAlpha = 0.45
      ctx.lineWidth = 1.5
      ctx.lineJoin = "round"
      ctx.lineCap = "round"
      ctx.stroke()
      ctx.globalAlpha = 1
    }
    frontierDot(ctx, geom.x, geom.y, ink)
  }

  // Boxes are PAPER — they keep the theme's own pair whatever the hour is doing
  // to the world behind them, so their border is the theme ink too. (The night
  // ink would be light on light paper: a border you can't see.)
  const edge = () => theme("--text", "#eee")

  // YOU, standing where you have always stood: the home centre. The same token
  // the board draws, in the theme's own pair — a figure isn't weather, so it
  // doesn't take the night ink; it's the brightest thing out there.
  function drawFigure(ctx) {
    const r = geom.size * (2 / 3)
    drawPlayer(ctx, geom.x, geom.y, r, theme("--text", "#eee"), theme("--surface", "#111"), playerWeight(geom.size))
  }

  // THE WAKE BUTTON — the same one the end of a day offers, on the same tile,
  // because this is the same moment: the world is drawn, and the next thing you
  // do is open your eyes in it. Paper under it so the glyph reads on the dark.
  // `p` (1 → 0) shrinks it about its own middle as it goes, so the player
  // underneath is UNCOVERED rather than swapped — see the picker's openAmt
  function drawWake(ctx, alpha = 1, p = 1) {
    if (p <= 0.002) return
    const ink = theme("--text", "#eee")
    const rW = geom.size * (0.66 + 0.34 * p) // …down to the player's own size, never to nothing
    const cs = hexCorners(geom.x, geom.y, rW, geom.startDeg)
    ctx.beginPath()
    cs.forEach((c, k) => (k ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)))
    ctx.closePath()
    if (p >= 1) {
      // standing: the solid button
      ctx.fillStyle = theme("--surface", "#111")
      ctx.globalAlpha = alpha
      ctx.fill()
      ctx.globalAlpha = 1
    } else {
      // GOING (2026-08-28): no paper, no weight — just the THIN LINE, the same
      // one the tile keeps for good, shrinking and fading off it
      ctx.strokeStyle = ink
      ctx.globalAlpha = alpha * p
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.globalAlpha = 1
    }
    drawIcon(ctx, "wake", geom.x, geom.y, rW / 0.9, ink, 0.95 * alpha * p)
  }

  // The world's own hover readout, riding the cursor — bordered, the way the
  // menu wears it, so it holds its own against the dark.
  const label = (ctx, L, pointer, lines) => renderer.cursorLabel(ctx, L, pointer, lines, geom.size, { stroke: edge() })

  // The same boxes, pinned to a corner and with no fan to the pointer — the
  // chrome is made of these now (the title, the key, the profile row) — and
  // they KNOW ABOUT THE POINTER: a box measures itself, and if the pointer is
  // on it, fades back out of the way. Nothing on the world above ever has to
  // dodge the chrome; the chrome dodges you. Returns its rect, so a stack can
  // anchor the next box off it.
  const CHROME_HOVER = 0.1 // what a box fades to while you're over it
  function chrome(ctx, fades, pointer, key, lines, anchor, arrive = 1) {
    const m = renderer.measure(ctx, lines)
    const rect = {
      x: anchor.left != null ? anchor.left : anchor.right - m.boxW,
      y: anchor.top != null ? anchor.top : anchor.bottom - m.boxH,
      w: m.boxW,
      h: m.boxH
    }
    const over = fades.chase(`${key}:hover`, pointer && hitBox(rect, pointer) ? CHROME_HOVER : 1)
    rect.alpha = arrive * over
    renderer.panel(ctx, lines, { left: rect.x, top: rect.y, alpha: rect.alpha }, edge())
    return rect
  }

  // The world draws OVER the chrome — but the chrome is PAPER, and after dark
  // the world's ink is light: a line crossing a box would be light on light and
  // vanish. So whatever crosses gets drawn a SECOND time inside each box, in
  // that box's own pair, at that box's own opacity. Hand it the same draw call
  // and it comes out reading on both sides.
  function overChrome(ctx, boxes, redraw) {
    const paper = { ink: theme("--text", "#eee"), surface: theme("--surface", "#111") }
    for (const b of boxes) {
      if (!b || b.alpha < 0.02) continue
      ctx.save()
      ctx.beginPath()
      ctx.rect(b.x, b.y, b.w, b.h)
      ctx.clip()
      redraw({ ...paper, fade: b.alpha })
      ctx.restore()
    }
  }

  // …and the world's own cursor. The OS one is hidden from the first frame;
  // there is no moment in this game where the pointer isn't ours.
  const cursor = (ctx, pointer, dress) => cursorDot(ctx, pointer, dress.ink, dress.surface)

  return { place, night, sky, dialR, geom: () => geom, onCentre, drawCentre, drawFigure, drawWake, label, chrome, overChrome, cursor }
}
