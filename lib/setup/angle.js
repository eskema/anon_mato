// The angle — a WALK out and back, drawn with a COMPASS, and then the world is
// struck from it. In order:
//
//   aiming      — a circle anchored at the home dot opens to your cursor (thin
//                 SOLID: this is the line being drawn). Reaching the ring the
//                 number stands on, it SNAPS to the dial's own radius and holds
//                 there — a compass doesn't open wider than the world's circle.
//   angle held  — clicking the number keeps that circle struck for good, and a
//                 second one (DASHED — a construction line) is anchored on the
//                 number, opening to your hand as you walk back. Over the home
//                 tile it snaps to reach the centre exactly.
//   the strike  — clicking home fires the ceremony, and from here it plays
//                 itself out: a COPY of the number's circle shoots straight
//                 across and settles exactly opposite; between the two of them
//                 and the dial, all six corners of the world are cut, so the six
//                 DOTS appear; SPOKES grow from each of them into the centre;
//                 and then the whole wheel TURNS BACK INTO PLACE — one full
//                 round and home to 12 o'clock, un-sweeping the dashed segment
//                 it was measured on. The number fades and shrinks away as it
//                 goes, and the tile you're standing on draws its own six edges.
//                 Then the WAKE button, and the world when you click it.
//
// Nothing here confirms until that last click: the ceremony is the OK's arrival.
//
// This is not a widget over the game. The face is the day's CLOCK, ringing the
// board from the board's own centre, and the line we draw IS the angle.

import { theme, hitBox, arrowTip } from "../draw.js"

const REM = 16
const STROKE = 1.5 // shared line width: ring, ray, the reading's circle
const TILE_ALPHA = 0.45 // the home tile's outline — the ray and segment read as part of it
const DASH = [4, 5] // the world's own dash (the ghost trail wears it too)
const HOVER_DASH = [5, 5] // …and the world's hover-preview dash, which the aim is
// the trail weights, taken from the world (render.js): walked is solid and a
// touch thicker, the way home lighter and untravelled
const WALK_W = 2
const HOME_W = 1.5
const HOME_A = 0.4
const AIM_A = 0.6

// the compass draws at FULL INK, hairline: at the dial's size any fade at all
// disappears into daylight, and this is the line being drawn — it stays
// subordinate to the walked leg by WEIGHT (1px against 2px), not by opacity

// THE CEREMONY, in milliseconds. The rotation is a full round and then some (it
// has to unwind the angle as well), so it gets the time the sleep sweep gets —
// long enough to read as one deliberate turn, not a spin.
const T_SHOOT = 520 // the copy crossing to the far side
const T_DOTS = 260 // …the six corners struck
const T_SPOKES = 420 // …the spokes run in
const T_ROT = 1700 // …and the whole wheel turns home
const AT_DOTS = T_SHOOT
const AT_SPOKES = AT_DOTS + T_DOTS
const AT_ROT = AT_SPOKES + T_SPOKES
const DONE = AT_ROT + T_ROT

const clamp01 = v => Math.max(0, Math.min(1, v))
const span = (v, a, b) => clamp01((v - a) / (b - a))
const easeOutQuart = u => 1 - Math.pow(1 - u, 4)
const lerp = (a, b, u) => a + (b - a) * u

// `centre`/`radius` come from the hosting screen, so the face is the world's
// dial rather than a circle of its own invention. `tile` is the world's tile
// size — the trails' arrowheads are cut to it, so they weigh exactly what the
// game's do. `centreDot` is off when that screen already draws the middle.
export function AngleScreen({ centreDot = true, centre = null, radius = null, tile = null, home = null } = {}) {
  let api = null
  let angle = 0 // 0..359 — 0 is the initial/unset position
  let set = false // has the reading been clicked? (the leg commits and the way home appears)
  let pointer = null // where we're aiming, the compass's pencil, and what lights the reading
  let readBox = null // the reading's hit area
  let struck = 0 // when the ceremony was fired (performance.now), or 0

  function enter(a) {
    api = a
    angle = 0
    set = false
    pointer = null
    readBox = null
    struck = 0
  }

  // how far into the ceremony we are, in ms — 0 before it's fired
  const since = () => (struck ? performance.now() - struck : 0)

  const originOf = L => (centre ? centre() : { x: L.cx, y: L.cy })
  const radiusOf = L => (radius ? radius() : (L.minSide * 0.6) / 2)
  const tileOf = L => (tile ? tile() : L.minSide * 0.08)
  // is the pointer on the home tile? — the host owns that shape (it's the same
  // hit the accepting click uses), so it answers
  const atHome = L => !!pointer && (home ? home(pointer) : dist(pointer, originOf(L)) <= tileOf(L) * 0.87)

  // 0° points up, increasing clockwise.
  function angleFromPoint(c, x, y) {
    let deg = Math.atan2(x - c.x, -(y - c.y)) * (180 / Math.PI)
    if (deg < 0) deg += 360
    return Math.round(deg) % 360
  }

  const unit = deg => {
    const rad = deg * (Math.PI / 180)
    return { x: Math.sin(rad), y: -Math.cos(rad) }
  }
  const along = (c, deg, d) => {
    const u = unit(deg)
    return { x: c.x + u.x * d, y: c.y + u.y * d }
  }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

  // How far the ray can run from `c` before it leaves the viewport (less `pad`).
  // The seed ray is meant to run off the edge; the reading only uses this so it
  // never leaves the screen entirely where the clock does.
  function reach(L, c, deg, pad = 0) {
    const u = unit(deg)
    let t = Infinity
    if (u.x > 1e-6) t = Math.min(t, (L.w - pad - c.x) / u.x)
    if (u.x < -1e-6) t = Math.min(t, (pad - c.x) / u.x)
    if (u.y > 1e-6) t = Math.min(t, (L.h - pad - c.y) / u.y)
    if (u.y < -1e-6) t = Math.min(t, (pad - c.y) / u.y)
    return Math.max(0, t)
  }

  // Aim from anywhere — the ray follows the pointer across the whole world,
  // bearing AND length together. (No dead zone at the dot: freezing the bearing
  // while the length kept tracking left a line that grew out of nowhere. While
  // you're near the middle the ray is short enough that the swing is its own
  // answer.)
  function aimAt(p) {
    pointer = p
    angle = angleFromPoint(originOf(api.layout), p.x, p.y)
  }

  function onPointerMove(p) {
    pointer = p
    if (!set) aimAt(p) // held: the pointer walks the way home instead
    api.requestRender()
  }

  // Clicking the reading is a toggle: it commits the leg, and commits it again
  // to let go. Letting go hands the ray straight back to the pointer where it
  // already is — and un-draws the board, because the angle it was drawn at is
  // no longer chosen. Reports whether it took the click.
  function onPointerDown(p) {
    // once the world has been struck the number is on its way out — its box must
    // not go on taking clicks after you can no longer see it
    if (struck || !angle || !hitBox(readBox, p)) return false
    set = !set
    struck = 0 // the drawing was struck at an angle you no longer hold
    if (!set) aimAt(p)
    api.requestRender()
    return true
  }

  // ── the world's two strokes ────────────────────────────────────────
  // A poly-line, and one arrowhead per leg at its midpoint. These are what
  // render.js draws every trail with (strokePixels / trailArrows); setup uses
  // them because it is the same gesture, not a picture of one.
  function stroke(ctx, pts, ink, w, a, dash) {
    if (pts.length < 2 || a <= 0.002) return
    ctx.save()
    ctx.lineJoin = "round"
    ctx.lineCap = "round"
    ctx.setLineDash(dash || [])
    ctx.beginPath()
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
    ctx.strokeStyle = ink
    ctx.globalAlpha = a
    ctx.lineWidth = w
    ctx.stroke()
    ctx.restore()
    ctx.globalAlpha = 1
  }
  function legArrows(ctx, pts, ink, t, w, a) {
    if (a <= 0.002) return
    ctx.globalAlpha = a
    for (let i = 1; i < pts.length; i++) {
      const from = pts[i - 1]
      const to = pts[i]
      if (dist(from, to) < t * 0.6) continue // too short a leg to carry a head
      arrowTip(ctx, from.x, from.y, (from.x + to.x) / 2, (from.y + to.y) / 2, ink, t * 0.32, t * 0.2, w)
    }
    ctx.globalAlpha = 1
  }

  // ── the compass ────────────────────────────────────────────────────
  // Anchored where the compass point stands, reaching out to your cursor, which
  // is the pencil. It SNAPS to a meaningful radius when the cursor reaches the
  // thing that radius belongs to, and the snap is what makes the drawing exact.
  //
  //   going out   — anchored at the home dot. It snaps to the dial's own radius
  //                 as you REACH THE RING the number stands on (or its reading),
  //                 and holds there however much further out you go: the compass
  //                 doesn't open wider than the world's own circle.
  //   angle held  — that first circle STAYS, struck for good; it's the opening
  //                 line of the drawing, not a hover effect. A second one is
  //                 anchored on the number and opens to your hand as you walk
  //                 back, snapping to reach the centre exactly on the home tile.
  const SNAP_TOL = 24 // how near the ring counts as having reached it
  function ring(ctx, o, rad, ink, a, dash) {
    if (rad < 1 || a <= 0.002) return
    ctx.save()
    ctx.beginPath()
    ctx.arc(o.x, o.y, rad, 0, Math.PI * 2)
    ctx.strokeStyle = ink
    ctx.globalAlpha = a
    ctx.lineWidth = 1
    ctx.setLineDash(dash || [])
    ctx.stroke()
    ctx.restore()
    ctx.globalAlpha = 1
  }
  function compass(ctx, L, c, r, ink, A) {
    const held = !!(set && angle)
    if (!pointer && !held) return
    const a = A
    // the one you opened on the way out — SOLID, snapped at the ring, and kept
    // once the angle is held
    const reached = !!pointer && (hitBox(readBox, pointer) || dist(c, pointer) >= r - SNAP_TOL)
    ring(ctx, c, held || reached ? r : dist(c, pointer), ink, a)
    if (!held) return
    // …and the one anchored on the number, DASHED: a construction line, opening
    // to your hand on the way back. Once the ceremony is struck it stops
    // following you — it has its radius, and a COPY of it crosses to the far
    // side, which is what cuts the other four corners. Both then turn with the
    // wheel, and are rubbed out as it settles.
    const e = since()
    const rot = turn(e)
    const o = along(c, angle + rot, r)
    if (!struck) {
      ring(ctx, o, atHome(L) ? dist(o, c) : dist(o, pointer), ink, a, DASH)
      return
    }
    const fade = 1 - span(e, AT_ROT + T_ROT * 0.55, DONE) // gone by the time it lands
    const far = along(c, angle + rot + 180, r)
    const shot = easeOutQuart(span(e, 0, T_SHOOT)) // …fired straight across
    ring(ctx, o, r, ink, a * fade, DASH)
    ring(ctx, { x: lerp(o.x, far.x, shot), y: lerp(o.y, far.y, shot) }, r, ink, a * fade, DASH)
  }

  // THE WHEEL — six corners on the dial with one at the angle you chose, the
  // spokes that run in to the middle, and the turn that carries the whole thing
  // home to 12 o'clock. A full round on top of unwinding the angle, so it reads
  // as a deliberate revolution rather than a snap.
  const turn = e => (e <= AT_ROT ? 0 : -(angle + 360) * easeOutQuart(span(e, AT_ROT, DONE)))
  function wheel(ctx, c, r, t, ink, A) {
    if (!struck) return
    const e = since()
    const pop = span(e, AT_DOTS, AT_SPOKES)
    if (pop <= 0) return
    const rot = turn(e)
    const grow = easeOutQuart(span(e, AT_SPOKES, AT_ROT))
    const dot = Math.max(2, t * 0.07)
    for (let k = 0; k < 6; k++) {
      const p = along(c, angle + rot + k * 60, r)
      // the spoke first, so the corner sits on top of its own line
      if (grow > 0) stroke(ctx, [p, { x: lerp(p.x, c.x, grow), y: lerp(p.y, c.y, grow) }], ink, 1, A)
      ctx.beginPath()
      ctx.arc(p.x, p.y, dot * easeOutQuart(pop), 0, Math.PI * 2)
      ctx.fillStyle = ink
      ctx.globalAlpha = A
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  // The reading — the angle in figures, sitting ON the horizon where the ray
  // crosses it, so it's taken against the face. It stays there: the chrome
  // steps out of ITS way, not the other way round. (Only where the clock itself
  // runs off the screen does it pull in along the ray.) Its circle is an
  // affordance, not a decoration: it appears under the pointer, and stays while
  // the angle is held.
  function reading(ctx, L, c, r, deg, ink, text, ringed, A = 1, shrink = 1) {
    ctx.font = `600 ${REM}px system-ui, sans-serif`
    const w = Math.max(ctx.measureText(text).width, ctx.measureText("000").width)
    const tr = w / 2 + 6
    const p = along(c, deg, Math.min(r, reach(L, c, deg, tr + 4)))
    const box = { x: p.x - tr, y: p.y - tr, w: 2 * tr, h: 2 * tr }
    if (A <= 0.002 || shrink <= 0.002) return box

    // it goes out IN PLACE — shrinking about its own point, not sliding off
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.scale(shrink, shrink)
    if (ringed || hitBox(box, pointer)) {
      ctx.beginPath()
      ctx.arc(0, 0, tr, 0, Math.PI * 2)
      ctx.strokeStyle = ink
      ctx.globalAlpha = A
      ctx.lineWidth = STROKE / shrink
      ctx.stroke()
    }
    ctx.fillStyle = ink
    ctx.globalAlpha = A
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(text, 0, 0)
    ctx.restore()
    ctx.globalAlpha = 1
    return box
  }

  // `dress` lets a hosting screen hand in the hour's ink/surface pair (setup
  // runs at 00:00, where the readable layer has flipped) — else the theme's.
  // `dress.fade` multiplies into every alpha, so a host can re-run the whole
  // draw dimmed (the paper pass over the chrome does exactly that).
  function draw(ctx, L, dress = null) {
    const ink = dress?.ink || theme("--text", "#eee")
    const A = dress?.fade ?? 1
    const c = originOf(L)
    const r = radiusOf(L)
    const t = tileOf(L)
    readBox = null

    // THE SEGMENT — the clock's ring drawn only as far as it has been swept:
    // 00:00 round to the reading, and nothing beyond. The angle isn't only a
    // bearing, it's how far round the face you've come, and until you've come
    // any distance there's nothing to show. Dashed and at the tile's own weight
    // — it belongs with the ray, not over it. (Canvas arcs run from 3 o'clock;
    // the dial starts at 12.)
    // …and once the ceremony turns the wheel home it BACKTRACKS: the arc you
    // measured the angle along retraces itself to nothing as the shape lands.
    const e = since()
    const swept = angle * (1 - span(e, AT_ROT, DONE))
    if (swept > 0.01) {
      ctx.beginPath()
      ctx.arc(c.x, c.y, r, -Math.PI / 2, (swept - 90) * (Math.PI / 180))
      ctx.strokeStyle = ink
      ctx.globalAlpha = TILE_ALPHA * A // the same weight as the ray and the tile
      ctx.lineWidth = STROKE
      ctx.setLineDash(DASH)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1
    }

    if (centreDot) {
      ctx.beginPath()
      ctx.arc(c.x, c.y, REM / 2, 0, Math.PI * 2)
      ctx.fillStyle = ink
      ctx.globalAlpha = A
      ctx.fill()
      ctx.globalAlpha = 1
    }

    // THE COMPASS — drawn before anything else it might sit under, and from the
    // very first move: opening it IS going out.
    compass(ctx, L, c, r, ink, A)

    if (!angle) return

    const P = along(c, angle, r) // the number's own point on the horizon

    if (!set) {
      // AIMING — the world's hover preview: dashed, out to the cursor, with the
      // arrowhead at the tip where you're pointing.
      const tip = pointer || P
      stroke(ctx, [c, tip], ink, HOME_W, AIM_A * A, HOVER_DASH)
      if (dist(c, tip) > t * 0.6) {
        ctx.globalAlpha = AIM_A * A
        arrowTip(ctx, c.x, c.y, tip.x, tip.y, ink, t * 0.32, t * 0.2, HOME_W)
        ctx.globalAlpha = 1
      }
    } else {
      // the walk is over once the wheel starts turning — the leg, the ray and
      // the way home all go out with the number they were drawn to
      const W = A * (1 - span(e, AT_ROT, AT_ROT + T_ROT * 0.35))
      // THE SEED RAY, faint, running on past the number and off the edge of the
      // world — the angle doesn't stop where you stopped walking.
      const far = along(c, angle, reach(L, c, angle))
      stroke(ctx, [P, far], ink, 1, TILE_ALPHA * 0.4 * W, DASH)
      // THE LEG YOU WALKED — solid, full ink, arrowhead at its middle.
      stroke(ctx, [c, P], ink, WALK_W, W)
      legArrows(ctx, [c, P], ink, t, WALK_W, W)
      // THE WAY HOME — out of the number, through wherever you are, back to the
      // centre: the triangle closes as you come. It fades out as you land, its
      // work done.
      if (pointer && !struck) {
        const back = [P, pointer, c]
        const a = HOME_A * A * (atHome(L) ? 0 : 1)
        stroke(ctx, back, ink, HOME_W, a)
        legArrows(ctx, back, ink, t, HOME_W, a)
      }
      wheel(ctx, c, r, t, ink, A)
    }

    // the number fades out IN PLACE, shrinking, as the wheel turns
    const out = span(e, AT_ROT, AT_ROT + T_ROT * 0.45)
    readBox = reading(ctx, L, c, r, angle, ink, `${angle}`, set, A * (1 - out), 1 - out * 0.85)
  }

  return {
    id: "angle",
    enter,
    onPointerMove,
    onPointerDown,
    draw,
    value: () => (set ? angle : null),
    // THE CEREMONY: fired by the click at home, it plays itself out and ends on
    // the wake button. `animating` is what the host keeps frames coming for.
    begin: () => {
      if (!set || struck) return false
      struck = performance.now()
      api.requestRender()
      return true
    },
    animating: () => !!struck && since() < DONE,
    ready: () => !!struck && since() >= DONE, // …and now the wake button is the OK
    // the tile draws its own six edges while the wheel turns into place
    tileFill: () => (struck ? span(since(), AT_ROT + T_ROT * 0.1, DONE) : 0),
    // is the pointer on the reading? — the host drops its cursor dot there, so
    // the circle it lit is the only mark in that spot (and once the number is
    // going, it isn't a spot at all)
    onReading: () => !struck && hitBox(readBox, pointer)
  }
}
