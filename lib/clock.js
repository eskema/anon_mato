// The clock's SUN + MOON — the single source of truth for their math, shared by
// the game (lib/render.js) and the styles harness so the two can't drift.
// `sunState`/`moonState` are pure (no drawing, no sim); `drawDial` renders the
// standalone, interactive test dial.

export const INTRADAY_AXIS = 42 // px half-length of the hour axis: top = noon, bottom = midnight
export const SUN_WOBBLE = INTRADAY_AXIS // a body rides the axis — highest at noon, lowest at midnight
export const MOON_CYCLE = 30 // days: full (game start) → new → full
// The moon's orbit is TILTED: it swings sideways off the sun's axis, crossing it
// only at the two NODES. So most new/full moons miss — an eclipse needs a
// new/full moon to fall ON a node. A nodal period out of step with the phase
// cycle makes that coincidence rare and cyclic (eclipse seasons), not monthly.
export const NODAL_CYCLE = 27.64 // days per sideways swing — the real draconic/synodic ratio
// scaled to our 30-day month, so it never locks to the phase cycle: the miss-angle
// drifts season to season → some eclipses near-total, most partial, no two alike
export const MOON_LAT = 0.18 // rad (~10°): max sideways swing off the sun's axis
export const NODAL_PHASE = 0.25 // start (day 1, full moon) at max swing → not an eclipse

const TAU = Math.PI * 2
const clamp01 = v => Math.max(0, Math.min(1, v))

// THE SKILL WHEEL — 12 skills ring the dial and the ring ROTATES once a year (the
// in-season skill rides to the TOP). The path they travel is a TEARDROP: a tight body
// tucked just inside the ring (hidden below the horizon) with one narrow SPOUT at the
// top. So the in-season skill climbs fully OUT into the sky — the WHOLE figure above
// the ring with a small gap — while its neighbours ride up/down the spout's flanks and
// the rest stay tucked inside. Pure geometry, shared by the game and the test dial.
//   lift  — how far the tip floats the featured figure ABOVE the ring
//   sink  — how far the body tucks BELOW/inside the ring (hidden by the sky clip)
//   spout — teardrop sharpness: bigger = tighter tip, fewer skills diverge out
// Returns skill i's centre, its height (px above the ring, +out/−in) and outward unit.
export function skillWheelPos(i, { day, cx, cy, R, lift, sink, spout }) {
  const cm = (((((day - 1) % 360) + 360) % 360) / 30) // continuous month, 0..12
  const th = (i - cm) * (TAU / 12) // angle around the clock; the in-season skill at the top (0)
  const spike = Math.pow((1 + Math.cos(th)) / 2, spout) // 1 at the tip → 0 around the body
  const rad = R - sink + (lift + sink) * spike // tip = R+lift (out in the sky), body = R−sink (tucked in)
  const ux = Math.sin(th)
  const uy = -Math.cos(th)
  return { x: cx + ux * rad, y: cy + uy * rad, height: rad - R, th, ux, uy } // th = wheel angle (0 at the peak)
}

// Everything to place + shade the SUN, from (day, minute-of-day) and the dial's
// centre + radius. The sun sits at its DAY-OF-YEAR angle (the year walks the
// colour wheel) and only WOBBLES radially about the orbit over the day — above
// by day, below (eclipsed) by night. Season shifts the wobble → day length.
export function sunState({ day, minuteOfDay, cx, cy, R, wobble = SUN_WOBBLE }) {
  const sunDeg = (((day - 1) % 360) + 360) % 360 // day of the year → angle + hue
  const sunRad = (sunDeg * Math.PI) / 180
  const seasonal = 0.26 * Math.sin((sunDeg / 360) * TAU) // + = longer days
  const sunAlt = -Math.cos((minuteOfDay / 1440) * TAU) + seasonal // −1 midnight → +1 noon (+season)
  const isNight = sunAlt <= 0
  const sunR = R + sunAlt * wobble // > orbit by day (visible), < orbit by night (eclipsed)
  const sunPos = { x: cx + Math.sin(sunRad) * sunR, y: cy - Math.cos(sunRad) * sunR }
  const dayExtreme = isNight ? 0 : 1 - clamp01(sunAlt) // 1 at the horizon → 0 at noon/night
  const sunLen = 14 * dayExtreme
  const sunTo = [Math.sin(sunRad), -Math.cos(sunRad)]
  return { sunDeg, sunRad, seasonal, sunAlt, isNight, sunR, sunPos, dayExtreme, sunLen, sunTo }
}

// The MOON shares the sun's dial ANGLE but drifts in TIME — 48 min/day, a full
// lap over MOON_CYCLE days. Its offset from the sun IS its phase: opposite the
// sun (12h) = full moon (up at night, bright), with the sun (0h) = new moon
// (up by day, dark). Game starts on a full moon (day 1). Illumination follows.
export function moonState({ day, minuteOfDay, cx, cy, R, wobble = SUN_WOBBLE }) {
  const sunDeg = (((day - 1) % 360) + 360) % 360
  const sunRad = (sunDeg * Math.PI) / 180
  const seasonal = 0.26 * Math.sin((sunDeg / 360) * TAU)
  const offset = (720 + (day - 1) * (1440 / MOON_CYCLE)) % 1440 // 720 (opposite) at full, drifts to 0 (new)
  const moonMin = (((minuteOfDay + offset) % 1440) + 1440) % 1440
  const illum = (1 - Math.cos((offset / 1440) * TAU)) / 2 // 1 = full, 0 = new
  const waxing = offset < 720 // new → full (illum rising)
  const alt = -Math.cos((moonMin / 1440) * TAU) + seasonal
  const isUp = alt > 0
  const r = R + alt * wobble
  const latRad = MOON_LAT * Math.sin(((day - 1) / NODAL_CYCLE + NODAL_PHASE) * TAU) // sideways; 0 at the nodes
  const moonAngle = sunRad + latRad
  const pos = { x: cx + Math.sin(moonAngle) * r, y: cy - Math.cos(moonAngle) * r }
  // an eclipse: a new/full moon (terminator aligned) landing ON a node (no swing)
  const onNode = Math.abs(latRad) < 0.02 // ~1.1°
  const eclipse = onNode ? (illum > 0.97 ? "lunar" : illum < 0.03 ? "solar" : null) : null
  return { sunRad, offset, moonMin, illum, waxing, alt, isUp, r, latRad, moonAngle, pos, eclipse }
}

export const moonPhaseName = m =>
  m.illum > 0.97 ? "full moon" : m.illum < 0.03 ? "new moon" : `${Math.round(m.illum * 100)}% ${m.waxing ? "waxing" : "waning"}`

// hh:mm from a minute-of-day
export const hhmm = m =>
  `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`

// draw the moon disc with its phase (a shadow disc carves the lit side)
// "#rgb"/"#rrggbb" → "rgba(...)" — canvas gradient stops need explicit alpha
const rgbaOf = (hex, a) => {
  let h = hex.replace("#", "")
  if (h.length === 3) h = [...h].map(c => c + c).join("")
  const n = parseInt(h, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

export function drawMoon(ctx, m, ink, mr = 6, surface = null) {
  const { x, y } = m.pos
  ctx.globalAlpha = 1
  if (surface) {
    // the GLOW — a soft --surface halo lifting the moon off the busy map (the
    // sun's is stronger and wears its own tint; see the renderer's sun)
    const gr = mr * 3.2
    const g = ctx.createRadialGradient(x, y, 0, x, y, gr)
    g.addColorStop(0, rgbaOf(surface, 0.55))
    g.addColorStop(1, rgbaOf(surface, 0))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, gr, 0, TAU)
    ctx.fill()
  }
  ctx.fillStyle = "hsl(220 18% 86%)" // the lit side
  ctx.beginPath()
  ctx.arc(x, y, mr, 0, TAU)
  ctx.fill()
  // phase shadow, clipped to the disc: a same-size disc slid off along the SUN
  // axis (radial), so the terminator aligns with the sun instead of the screen.
  // The unlit side is FULL --surface — it melts into the halo, so only the lit
  // crescent and the ink outline read as the moon's shape.
  const ux = Math.sin(m.sunRad)
  const uy = -Math.cos(m.sunRad)
  const off = m.illum * 2 * mr
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, mr, 0, TAU)
  ctx.clip()
  ctx.fillStyle = surface || "hsl(220 20% 32%)" // the unlit side, at full strength
  ctx.beginPath()
  ctx.arc(x + ux * off, y + uy * off, mr, 0, TAU)
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = ink // the outline — full --text, no wash
  ctx.globalAlpha = 1
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(x, y, mr, 0, TAU)
  ctx.stroke()
}

// The unrestricted test dial: a 24-hour clock (midnight at top, clockwise) with
// sun + moon at their day angle, the orbit ring as the horizon eclipsing them
// below, the waking-window band, an hour hand and a moon-lightened night.
// `hoverSun` raises a grab-handle above the line. Returns { sun, moon }.
export function drawDial(ctx, { w, h, day, minuteOfDay, budget, ink, surface, hoverSun = false }) {
  ctx.clearRect(0, 0, w, h)
  const cx = w / 2
  const cy = h / 2
  const R = Math.min(w, h) * 0.36
  const at = (a, rad) => [cx + Math.sin(a) * rad, cy - Math.cos(a) * rad] // a=0 at the top, clockwise
  const s = sunState({ day, minuteOfDay, cx, cy, R })
  const m = moonState({ day, minuteOfDay, cx, cy, R })
  const clipOutside = () => {
    ctx.beginPath()
    ctx.rect(0, 0, w, h)
    ctx.arc(cx, cy, R, 0, TAU, true) // punch out the inside → keep only outside the orbit
    ctx.clip("evenodd")
  }

  // hour ticks (24h; the four cardinals run long)
  ctx.strokeStyle = ink
  ctx.lineWidth = 1
  for (let hstep = 0; hstep < 24; hstep++) {
    const a = (hstep / 24) * TAU
    const long = hstep % 6 === 0
    ctx.globalAlpha = long ? 0.5 : 0.22
    const [x1, y1] = at(a, R + 5)
    const [x2, y2] = at(a, R + (long ? 15 : 9))
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }

  // the WAKING WINDOW: 00:00 → budget, a band just inside the orbit
  ctx.strokeStyle = ink
  ctx.globalAlpha = 0.12
  ctx.lineWidth = 12
  ctx.lineCap = "butt"
  ctx.beginPath()
  ctx.arc(cx, cy, R - 11, -Math.PI / 2, -Math.PI / 2 + (budget / 1440) * TAU)
  ctx.stroke()

  // the MOON and the SUN — both clipped OUTSIDE the ring (eclipsed below the
  // horizon). Near NEW moon the moon crosses IN FRONT of the sun (illum < ½);
  // near FULL it sits behind. (They only actually overlap near new.)
  const drawSun = () => {
    ctx.globalAlpha = 1
    ctx.fillStyle = `hsl(${s.sunDeg} 70% 55%)`
    ctx.beginPath()
    ctx.arc(s.sunPos.x, s.sunPos.y, 8, 0, TAU)
    ctx.fill()
  }
  ctx.save()
  clipOutside()
  if (m.illum < 0.5) {
    drawSun()
    drawMoon(ctx, m, ink, 6, surface)
  } else {
    drawMoon(ctx, m, ink, 6, surface)
    drawSun()
  }
  ctx.restore()

  // the orbit ring (the horizon) — opaque, over the bodies, eclipsing cleanly
  ctx.strokeStyle = ink
  ctx.globalAlpha = 1
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, TAU)
  ctx.stroke()

  // the NOW hand → the current hour on the ring
  const [nx, ny] = at((minuteOfDay / 1440) * TAU, R - 7)
  ctx.strokeStyle = ink
  ctx.globalAlpha = 0.6
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(nx, ny)
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.fillStyle = ink
  ctx.beginPath()
  ctx.arc(nx, ny, 3, 0, TAU)
  ctx.fill()

  // NIGHT: below the horizon the dial dims, deeper toward midnight — but a moon
  // that's up (bright when full) pushes the dark back
  if (s.isNight) {
    const depth = clamp01(-s.sunAlt)
    const moonLight = m.isUp ? m.illum : 0
    ctx.globalAlpha = (0.1 + 0.32 * depth) * (1 - 0.55 * moonLight)
    ctx.fillStyle = "hsl(230 45% 9%)"
    ctx.fillRect(0, 0, w, h)
    ctx.globalAlpha = 1
  }

  // the intraday (radial) axis — shown on hover: the sun's HEIGHT track. Top =
  // noon (highest), bottom = midnight (lowest); the sun rides it to show the
  // hour. End-caps mark the two extremes.
  if (hoverSun) {
    const [ax, ay] = at(s.sunRad, R - INTRADAY_AXIS) // midnight end (inner)
    const [bx, by] = at(s.sunRad, R + INTRADAY_AXIS) // noon end (outer)
    const tan = [Math.cos(s.sunRad), Math.sin(s.sunRad)] // perpendicular to the axis
    ctx.strokeStyle = ink
    ctx.lineWidth = 1.5
    ctx.globalAlpha = 0.4
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(bx, by)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 0.6
    for (const [ex, ey] of [[ax, ay], [bx, by]]) {
      ctx.beginPath()
      ctx.moveTo(ex - tan[0] * 6, ey - tan[1] * 6)
      ctx.lineTo(ex + tan[0] * 6, ey + tan[1] * 6)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }
  return { sun: s, moon: m }
}
