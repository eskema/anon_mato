// ANIM LAB — the keyframe bench, mounted by the lab shell (animate.html).
//
// A bench isolates ONE animation: a fake screen drawn by the game's own code,
// and a timeline showing ONE track at a time (switch by clicking the track
// titles). Keyframes are draggable diamonds; between them the curve itself is
// editable — every segment carries a cubic-bezier ease whose two round
// HANDLES you drag right on the lane. The named eases are just presets that
// place the handles. The tuned document round-trips as JSON: copy → paste in
// chat → it gets translated back into render.js.
//
// mountBench(host, cfg) → { destroy }, where cfg is a registry entry from
// animations.js: { anim/id, title, subtitle, store, tracks, stageOptions,
// game, drawScene }.

import { theme } from "../lib/draw.js"

// ── eases ──────────────────────────────────────────────────────────────
// A keyframe's `e` is the ease TOWARD the next keyframe (the last has none):
// a [x1, y1, x2, y2] cubic-bezier, a preset name that stands for one, or
// "hold" (step). y's may leave 0..1 — that's what a backstep or an overshoot
// IS. The presets are the css equivalents of the game's formulas (within a
// fraction of a percent of a tile — visually identical).
export const PRESETS = {
  "out-quart": [0.25, 1, 0.5, 1], // the game's default landing (render.js easeOutQuart)
  "out-back": [0.34, 1.56, 0.64, 1], // overshoots, then settles (EASE.back)
  "out-sine": [0.39, 0.575, 0.565, 1], // quick away, soft arrival
  "in-back": [0.36, 0, 0.66, -0.56], // swells a hair backward, then goes
  "in-out": [0.76, 0, 0.24, 1], // settle both ends (EASE.io)
  smoother: [0.45, 0, 0.55, 1], // the camera's glide (smootherstep)
  "in-quad": [0.11, 0, 0.5, 0],
  linear: [0.333, 0.333, 0.667, 0.667] // handles on the diagonal = a straight line
}
// exact legacy curves old saved docs may still name — sampled exactly, but
// not hand-editable (pick a preset to take one over)
const growEase = t => {
  // render.js growEase verbatim: −6% backstep, then an overshooting back-ease
  const B = 0.15
  if (t < B) return -0.06 * Math.sin((t / B) * (Math.PI / 2))
  const u = (t - B) / (1 - B)
  const c1 = 1.70158
  const c3 = c1 + 1
  return -0.06 + 1.06 * (1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2))
}
const LEGACY = { "game-grow": growEase }
const HOLD = () => 0

// cubic-bezier(x1,y1,x2,y2) evaluator — solve x(s)=u by bisection, return y(s)
const bezCache = new Map()
export function bezierFn(a) {
  const key = a.join(",")
  const hit = bezCache.get(key)
  if (hit) return hit
  const [x1, y1, x2, y2] = a
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sx = s => ((ax * s + bx) * s + cx) * s
  const f = u => {
    if (u <= 0) return 0
    if (u >= 1) return 1
    let lo = 0
    let hi = 1
    for (let i = 0; i < 30; i++) {
      const m = (lo + hi) / 2
      sx(m) < u ? (lo = m) : (hi = m)
    }
    const s = (lo + hi) / 2
    return ((ay * s + by) * s + cy) * s
  }
  if (bezCache.size > 500) bezCache.clear()
  bezCache.set(key, f)
  return f
}
export function easeFn(e) {
  if (Array.isArray(e)) return bezierFn(e)
  if (e === "hold") return HOLD
  if (e == null) return u => u
  if (LEGACY[e]) return LEGACY[e]
  if (PRESETS[e]) return bezierFn(PRESETS[e])
  return u => u
}
// the handle positions a segment DISPLAYS (null = no handles: hold / legacy)
export function easeHandles(e) {
  if (Array.isArray(e)) return e
  if (e == null) return PRESETS.linear
  if (e === "hold" || LEGACY[e]) return null
  return PRESETS[e] || PRESETS.linear
}
const matchPreset = arr =>
  Object.keys(PRESETS).find(n => PRESETS[n].every((v, i) => Math.abs(v - arr[i]) < 0.0005)) || null

// ── the pure core (imported by node tests too) ─────────────────────────
// value of track `id` at `time`, for an animation document + track metas
export function sampleTrack(doc, tracks, id, time) {
  const ks = doc.tracks[id]
  const meta = tracks.find(x => x.id === id)
  if (!ks || !ks.length) return meta.def
  if (time <= ks[0].t) return ks[0].v
  const last = ks[ks.length - 1]
  if (time >= last.t) return last.v
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i]
    const b = ks[i + 1]
    // strict `<` so a moment ON a keyframe reads from the segment it starts,
    // not the one it ends — a hold would report the old value
    if (time >= a.t && time < b.t) {
      const u = (time - a.t) / Math.max(1, b.t - a.t)
      return a.v + (b.v - a.v) * easeFn(a.e)(u)
    }
  }
  return last.v
}

// accept only what we understand: known tracks, numeric keys, valid eases
export function saneDoc(raw, tracks, game) {
  if (!raw || typeof raw !== "object" || typeof raw.tracks !== "object") return null
  const doc = game()
  doc.duration = Math.max(100, Math.min(5000, Math.round(+raw.duration || doc.duration)))
  const r3 = v => Math.round(v * 1000) / 1000
  const saneEase = e => {
    if (Array.isArray(e) && e.length === 4 && e.every(n => Number.isFinite(+n))) {
      const c01 = v => Math.min(1, Math.max(0, r3(+v)))
      const cy = v => Math.min(5, Math.max(-4, r3(+v)))
      return [c01(e[0]), cy(e[1]), c01(e[2]), cy(e[3])]
    }
    if (e === "hold" || (typeof e === "string" && (PRESETS[e] || LEGACY[e]))) return e
    return undefined
  }
  for (const tr of tracks) {
    const ks = Array.isArray(raw.tracks[tr.id]) ? raw.tracks[tr.id] : null
    if (!ks || !ks.length) continue
    const clean = ks
      .filter(k => k && Number.isFinite(+k.t) && Number.isFinite(+k.v))
      .map(k => {
        const e = saneEase(k.e)
        return {
          t: Math.max(0, Math.min(doc.duration, Math.round(+k.t))),
          v: Math.max(tr.min, Math.min(tr.max, r3(+k.v))),
          ...(e !== undefined ? { e } : {})
        }
      })
      .sort((a, b) => a.t - b.t)
    if (clean.length) doc.tracks[tr.id] = clean
  }
  return doc
}

// pretty JSON with one keyframe per line — pasteable both ways
export function formatDoc(doc) {
  const lines = ["{", `  "anim": ${JSON.stringify(doc.anim)},`, `  "duration": ${doc.duration},`, '  "tracks": {']
  const ids = Object.keys(doc.tracks)
  ids.forEach((id, i) => {
    lines.push(`    ${JSON.stringify(id)}: [`)
    const ks = doc.tracks[id]
    ks.forEach((k, j) => lines.push(`      ${JSON.stringify(k)}${j < ks.length - 1 ? "," : ""}`))
    lines.push(`    ]${i < ids.length - 1 ? "," : ""}`)
  })
  lines.push("  }", "}")
  return lines.join("\n")
}

// ── the bench ──────────────────────────────────────────────────────────
export function mountBench(host, cfg) {
  const { tracks, game, drawScene } = cfg
  const store = cfg.store
  const animId = cfg.anim || cfg.id

  // same theme rule as the game (main.js): saved wins, light is the default
  let savedTheme = null
  try { savedTheme = localStorage.getItem("thrive-theme") } catch {}
  document.documentElement.dataset.theme = savedTheme || "light"

  const root = document.createElement("div")
  root.className = "bench"
  root.innerHTML = `
    <section id="stagewrap">
      <canvas id="stage"></canvas>
      <div id="stagehead">
        <div class="t">${cfg.title || animId}</div>
        ${cfg.subtitle ? `<div class="s">${cfg.subtitle}</div>` : ""}
      </div>
      <div id="stageopts"></div>
    </section>
    <section id="transport">
      <button id="play" class="primary">pause</button>
      <button id="restart">⟲</button>
      <label><input id="loop" type="checkbox" checked /> loop</label>
      <select id="speed">
        <option value="1">1×</option>
        <option value="0.5">½×</option>
        <option value="0.25">¼×</option>
        <option value="0.1">⅒×</option>
      </select>
      <span id="readout"></span>
      <label>length <input id="length" type="number" min="100" max="5000" step="10" /> ms</label>
      <button id="reset">reset to game</button>
    </section>
    <section id="timeline">
      <div id="ttabs"></div>
      <div class="lane" id="ruler-lane"><canvas></canvas></div>
      <div class="lane" id="track-lane"><canvas></canvas></div>
    </section>
    <section id="inspector"></section>
    <section id="exchange">
      <button id="copy" class="primary">copy JSON</button>
      <button id="apply">apply pasted</button>
      <textarea id="json" spellcheck="false" placeholder="copy JSON fills this — paste a set back and apply"></textarea>
      <span id="status">tune → copy JSON → paste it in chat</span>
    </section>`
  host.textContent = ""
  host.append(root)

  const $ = s => root.querySelector(s)
  const stage = $("#stage")
  const playEl = $("#play")
  const loopEl = $("#loop")
  const speedEl = $("#speed")
  const readoutEl = $("#readout")
  const lengthEl = $("#length")
  const inspectorEl = $("#inspector")
  const jsonEl = $("#json")
  const statusEl = $("#status")
  const laneCv = $("#track-lane canvas")
  const rulerCv = $("#ruler-lane canvas")
  const say = m => { statusEl.textContent = m }

  // ── stage options (scene-specific knobs, not animated) ───────────────
  const opts = {}
  {
    const hostOpts = $("#stageopts")
    for (const o of cfg.stageOptions || []) {
      opts[o.id] = o.value
      const lab = document.createElement("label")
      if (o.type === "checkbox") {
        lab.innerHTML = `<input type="checkbox" ${o.value ? "checked" : ""} /> ${o.label}`
        lab.querySelector("input").addEventListener("change", e => (opts[o.id] = e.target.checked))
      } else {
        lab.innerHTML = `${o.label} <input type="range" min="${o.min}" max="${o.max}" step="${o.step}" value="${o.value}" />`
        lab.querySelector("input").addEventListener("input", e => (opts[o.id] = +e.target.value))
      }
      hostOpts.appendChild(lab)
    }
  }

  // ── the animation document ───────────────────────────────────────────
  function load() {
    try { return saneDoc(JSON.parse(localStorage.getItem(store)), tracks, game) } catch { return null }
  }
  let doc = load() || game()
  const save = () => { try { localStorage.setItem(store, JSON.stringify(doc)) } catch {} }
  const sampleAt = (id, time) => sampleTrack(doc, tracks, id, time)
  lengthEl.value = doc.duration

  // ── playback state ───────────────────────────────────────────────────
  let playing = true
  let loop = true
  let speed = 1
  let clock = 0 // runs past duration by LOOP_GAP before wrapping
  const LOOP_GAP = 350 // a beat of rest on the landed pose before each loop
  const playT = () => Math.min(clock, doc.duration)
  let sel = null // { id, k } — selected keyframe (by object identity)
  let active = 0 // which track the lane shows

  // ── track tabs: one lane at a time, switched by clicking the titles ──
  const tabs = tracks.map((meta, i) => {
    const b = document.createElement("button")
    b.className = "ttab"
    b.innerHTML = `<span class="tn">${meta.label}</span><span class="tv"></span><span class="live"></span>`
    b.addEventListener("click", () => {
      active = i
      sel = null
      renderInspector()
      syncTabs()
    })
    $("#ttabs").append(b)
    return { meta, b, tv: b.querySelector(".tv"), live: b.querySelector(".live") }
  })
  const syncTabs = () => tabs.forEach((t, i) => t.b.classList.toggle("active", i === active))
  syncTabs()

  // ── canvas plumbing (dpr-crisp, lazily resized) ──────────────────────
  function fit(cv) {
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(cv.clientWidth * dpr))
    const h = Math.max(1, Math.round(cv.clientHeight * dpr))
    if (cv.width !== w) cv.width = w
    if (cv.height !== h) cv.height = h
    const ctx = cv.getContext("2d")
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    return ctx
  }
  const accentColor = () =>
    getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#d84a3f"

  // ── the fake screen ──────────────────────────────────────────────────
  function drawStage() {
    const ctx = fit(stage)
    const w = stage.clientWidth
    const h = stage.clientHeight
    const ink = theme("--text", "#eee")
    const surface = theme("--surface", "#111")
    ctx.fillStyle = surface
    ctx.fillRect(0, 0, w, h)
    const t = playT()
    drawScene(ctx, { w, h, t, ink, surface, opts, sample: id => sampleAt(id, t) })
  }

  // ── timeline geometry ────────────────────────────────────────────────
  const PADX = 12
  const PADY = 10
  const xOf = (time, w) => PADX + (time / doc.duration) * (w - 2 * PADX)
  const tOf = (x, w) => Math.max(0, Math.min(doc.duration, ((x - PADX) / Math.max(1, w - 2 * PADX)) * doc.duration))
  const yOf = (v, meta, h) => PADY + (1 - (v - meta.min) / (meta.max - meta.min)) * (h - 2 * PADY)
  const vOf = (y, meta, h) => {
    const raw = meta.min + (1 - (y - PADY) / Math.max(1, h - 2 * PADY)) * (meta.max - meta.min)
    return Math.max(meta.min, Math.min(meta.max, raw))
  }
  // handle pixel positions for segment ks[i]→ks[i+1] (null if not editable)
  function handlePts(meta, ks, i, w, h) {
    const H = easeHandles(ks[i].e)
    if (!H) return null
    const ax = xOf(ks[i].t, w)
    const bx = xOf(ks[i + 1].t, w)
    const ay = yOf(ks[i].v, meta, h)
    const by = yOf(ks[i + 1].v, meta, h)
    return {
      ax, ay, bx, by,
      h1: { x: ax + H[0] * (bx - ax), y: ay + H[1] * (by - ay) },
      h2: { x: ax + H[2] * (bx - ax), y: ay + H[3] * (by - ay) }
    }
  }

  function drawRuler() {
    const ctx = fit(rulerCv)
    const w = rulerCv.clientWidth
    const h = rulerCv.clientHeight
    const ink = theme("--text", "#eee")
    ctx.clearRect(0, 0, w, h)
    ctx.strokeStyle = ink
    for (let ms = 0; ms <= doc.duration; ms += 20) {
      const major = ms % 100 === 0
      ctx.globalAlpha = major ? 0.5 : 0.18
      ctx.lineWidth = 1
      const x = Math.round(xOf(ms, w)) + 0.5
      ctx.beginPath()
      ctx.moveTo(x, h)
      ctx.lineTo(x, h - (major ? 11 : 5))
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    const x = xOf(playT(), w)
    ctx.strokeStyle = accentColor()
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
  }

  function drawLane() {
    const meta = tracks[active]
    const ctx = fit(laneCv)
    const w = laneCv.clientWidth
    const h = laneCv.clientHeight
    const ink = theme("--text", "#eee")
    const accent = accentColor()
    const ks = doc.tracks[meta.id] || []
    ctx.clearRect(0, 0, w, h)
    // the resting value's guide — a dotted line at the track's default
    ctx.strokeStyle = ink
    ctx.globalAlpha = 0.14
    ctx.lineWidth = 1
    ctx.setLineDash([2, 4])
    const gy = Math.round(yOf(meta.def, meta, h)) + 0.5
    ctx.beginPath()
    ctx.moveTo(PADX, gy)
    ctx.lineTo(w - PADX, gy)
    ctx.stroke()
    ctx.setLineDash([])
    // the value curve, sampled — dips and steps show as they'll play
    ctx.globalAlpha = 0.8
    ctx.lineWidth = 1.5
    ctx.beginPath()
    for (let px = PADX; px <= w - PADX; px += 2) {
      const v = sampleAt(meta.id, tOf(px, w))
      const y = yOf(v, meta, h)
      px === PADX ? ctx.moveTo(px, y) : ctx.lineTo(px, y)
    }
    ctx.stroke()
    ctx.globalAlpha = 1
    // the playhead
    const phx = xOf(playT(), w)
    ctx.strokeStyle = accent
    ctx.globalAlpha = 0.7
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(phx, 0)
    ctx.lineTo(phx, h)
    ctx.stroke()
    ctx.globalAlpha = 1
    // the segments' curve handles — the round dots you drag to shape the ease
    for (let i = 0; i < ks.length - 1; i++) {
      const hp = handlePts(meta, ks, i, w, h)
      if (!hp) continue
      ctx.strokeStyle = ink
      ctx.globalAlpha = 0.3
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(hp.ax, hp.ay)
      ctx.lineTo(hp.h1.x, hp.h1.y)
      ctx.moveTo(hp.bx, hp.by)
      ctx.lineTo(hp.h2.x, hp.h2.y)
      ctx.stroke()
      ctx.globalAlpha = 1
      for (const p of [hp.h1, hp.h2]) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2)
        ctx.fillStyle = theme("--surface", "#111")
        ctx.fill()
        ctx.strokeStyle = ink
        ctx.globalAlpha = 0.75
        ctx.lineWidth = 1.25
        ctx.stroke()
        ctx.globalAlpha = 1
      }
    }
    // the keyframes — diamonds; the selected one wears the accent
    for (const k of ks) {
      const x = xOf(k.t, w)
      const y = yOf(k.v, meta, h)
      const r = 5
      ctx.beginPath()
      ctx.moveTo(x, y - r)
      ctx.lineTo(x + r, y)
      ctx.lineTo(x, y + r)
      ctx.lineTo(x - r, y)
      ctx.closePath()
      const selected = sel && sel.k === k
      ctx.fillStyle = selected ? accent : theme("--surface", "#111")
      ctx.fill()
      ctx.strokeStyle = selected ? accent : ink
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
  }

  // ── inspector ────────────────────────────────────────────────────────
  function renderInspector() {
    if (!sel) {
      inspectorEl.innerHTML =
        `<span class="hint">click a track title to switch lanes · dblclick: add key · drag diamonds (keys) and round dots ` +
        `(curve handles) · ⇧ value-only · ⌥ time-only · del: remove · space: play</span>`
      return
    }
    const { id, k } = sel
    const meta = tracks.find(x => x.id === id)
    const ks = doc.tracks[id]
    const isLast = ks[ks.length - 1] === k
    const e = k.e
    const cur = isLast
      ? ""
      : e === "hold"
        ? "hold"
        : typeof e === "string"
          ? e
          : Array.isArray(e)
            ? matchPreset(e) || "custom"
            : "linear"
    const options = Object.keys(PRESETS)
      .concat("hold")
      .map(n => `<option value="${n}" ${cur === n ? "selected" : ""}>${n}</option>`)
    if (cur === "custom") options.unshift(`<option value="custom" selected disabled>custom</option>`)
    if (LEGACY[cur]) options.unshift(`<option value="${cur}" selected disabled>${cur} (legacy)</option>`)
    const H = easeHandles(e)
    inspectorEl.innerHTML = `
      <span class="who">${meta.label}</span>
      <label>t <input id="ins-t" type="number" min="0" max="${doc.duration}" step="1" value="${k.t}" /> ms</label>
      <label>value <input id="ins-v" type="number" min="${meta.min}" max="${meta.max}" step="${meta.step}" value="${k.v}" /></label>
      ${isLast ? `<span class="bez">last key — no outgoing ease</span>` : `
        <label>ease <select id="ins-e">${options.join("")}</select></label>
        <span class="bez">${e === "hold" ? "step" : LEGACY[cur] ? "exact legacy curve" : `[${(H || []).join(", ")}]`}</span>`}
      <button id="ins-del">remove</button>`
    $("#ins-t").addEventListener("change", ev => {
      k.t = Math.max(0, Math.min(doc.duration, Math.round(+ev.target.value || 0)))
      touch()
    })
    $("#ins-v").addEventListener("change", ev => {
      k.v = Math.max(meta.min, Math.min(meta.max, +ev.target.value || 0))
      touch()
    })
    $("#ins-e")?.addEventListener("change", ev => {
      const n = ev.target.value
      k.e = n === "hold" ? "hold" : n // preset names stay names — readable in the JSON
      touch()
      renderInspector()
    })
    $("#ins-del").addEventListener("click", () => removeKey(id, k))
  }

  function removeKey(id, k) {
    const ks = doc.tracks[id]
    if (ks.length <= 1) return say("a track keeps at least one key")
    doc.tracks[id] = ks.filter(x => x !== k)
    if (sel && sel.k === k) sel = null
    touch()
    renderInspector()
  }

  // every mutation lands here: keep order, persist, refresh the numbers
  function touch() {
    for (const tr of tracks) doc.tracks[tr.id].sort((a, b) => a.t - b.t)
    save()
    if (sel) {
      const insT = $("#ins-t")
      const insV = $("#ins-v")
      if (insT && document.activeElement !== insT) insT.value = sel.k.t
      if (insV && document.activeElement !== insV) insV.value = sel.k.v
    }
  }

  // ── lane interaction: keys, curve handles, scrub ─────────────────────
  let drag = null
  laneCv.addEventListener("pointerdown", e => {
    const meta = tracks[active]
    const ks = doc.tracks[meta.id] || []
    const rect = laneCv.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const w = laneCv.clientWidth
    const h = laneCv.clientHeight
    // a keyframe first…
    let k = null
    let bd = 9
    for (const kk of ks) {
      const d = Math.hypot(xOf(kk.t, w) - x, yOf(kk.v, meta, h) - y)
      if (d < bd) { bd = d; k = kk }
    }
    if (k) {
      const i = ks.indexOf(k)
      drag = {
        type: "key",
        k,
        prev: i > 0 ? ks[i - 1].t + 1 : 0,
        next: i < ks.length - 1 ? ks[i + 1].t - 1 : doc.duration,
        lockT: e.shiftKey,
        lockV: e.altKey || e.metaKey,
        // a DEAD ZONE before the drag bites: a click that only selects must
        // never nudge the key (a one-pixel slip once shipped 0.978 opacity)
        x0: x, y0: y, live: false
      }
      sel = { id: meta.id, k }
      renderInspector()
      laneCv.setPointerCapture(e.pointerId)
      return
    }
    // …then a curve handle…
    for (let i = 0; i < ks.length - 1; i++) {
      const hp = handlePts(meta, ks, i, w, h)
      if (!hp) continue
      for (const which of [0, 1]) {
        const p = which ? hp.h2 : hp.h1
        if (Math.hypot(p.x - x, p.y - y) < 8) {
          // grabbing a preset's handle takes the curve over: materialize the
          // named ease into an editable array on the segment's start key
          const a = ks[i]
          if (!Array.isArray(a.e)) a.e = [...(easeHandles(a.e) || PRESETS.linear)]
          drag = { type: "handle", a, b: ks[i + 1], which, x0: x, y0: y, live: false }
          laneCv.setPointerCapture(e.pointerId)
          return
        }
      }
    }
    // …else scrub
    sel = null
    renderInspector()
    playing = false
    playEl.textContent = "play"
    clock = tOf(x, w)
    drag = { type: "scrub" }
    laneCv.setPointerCapture(e.pointerId)
  })
  laneCv.addEventListener("pointermove", e => {
    if (!drag) return
    const meta = tracks[active]
    const rect = laneCv.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const w = laneCv.clientWidth
    const h = laneCv.clientHeight
    if (drag.type === "scrub") {
      clock = tOf(x, w)
      return
    }
    if (!drag.live) {
      if (Math.hypot(x - drag.x0, y - drag.y0) < 4) return
      drag.live = true
    }
    if (drag.type === "key") {
      if (!drag.lockT) drag.k.t = Math.round(Math.max(drag.prev, Math.min(drag.next, tOf(x, w))))
      if (!drag.lockV) drag.k.v = +vOf(y, meta, h).toFixed(3)
      touch()
    } else {
      const { a, b, which } = drag
      const ax = xOf(a.t, w)
      const bx = xOf(b.t, w)
      const ay = yOf(a.v, meta, h)
      const by = yOf(b.v, meta, h)
      const fx = Math.min(1, Math.max(0, (x - ax) / Math.max(1, bx - ax)))
      // a flat segment has no vertical span — its shape can't matter, so the
      // handle only slides in time
      const fy = by - ay !== 0 ? Math.min(5, Math.max(-4, (y - ay) / (by - ay))) : a.e[which * 2 + 1]
      a.e[which * 2] = +fx.toFixed(3)
      a.e[which * 2 + 1] = +fy.toFixed(3)
      touch()
    }
  })
  const dragDone = () => {
    const was = drag
    drag = null
    if (was?.type === "handle") renderInspector() // the ease select may read "custom" now
  }
  laneCv.addEventListener("pointerup", dragDone)
  laneCv.addEventListener("pointercancel", dragDone)
  laneCv.addEventListener("dblclick", e => {
    const meta = tracks[active]
    const ks = doc.tracks[meta.id]
    const rect = laneCv.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const w = laneCv.clientWidth
    const h = laneCv.clientHeight
    for (const kk of ks) if (Math.hypot(xOf(kk.t, w) - x, yOf(kk.v, meta, h) - y) < 9) return // never spawn a twin
    const k = { t: Math.round(tOf(x, w)), v: +vOf(y, meta, h).toFixed(3), e: "out-quart" }
    ks.push(k)
    touch() // sorts the new key into place…
    // …and a segment now feeding into it keeps a real ease (the house quart)
    const before = ks[ks.indexOf(k) - 1]
    if (before && before.e == null) {
      before.e = "out-quart"
      save()
    }
    sel = { id: meta.id, k }
    renderInspector()
  })

  // the ruler scrubs
  {
    let scrubbing = false
    const scrub = e => {
      const rect = rulerCv.getBoundingClientRect()
      clock = tOf(e.clientX - rect.left, rulerCv.clientWidth)
    }
    rulerCv.addEventListener("pointerdown", e => {
      scrubbing = true
      playing = false
      playEl.textContent = "play"
      rulerCv.setPointerCapture(e.pointerId)
      scrub(e)
    })
    rulerCv.addEventListener("pointermove", e => scrubbing && scrub(e))
    rulerCv.addEventListener("pointerup", () => (scrubbing = false))
    rulerCv.addEventListener("pointercancel", () => (scrubbing = false))
  }

  // ── transport ────────────────────────────────────────────────────────
  function setPlaying(p) {
    playing = p
    if (playing && clock >= doc.duration) clock = 0
    playEl.textContent = playing ? "pause" : "play"
  }
  playEl.addEventListener("click", () => setPlaying(!playing))
  $("#restart").addEventListener("click", () => { clock = 0 })
  loopEl.addEventListener("change", () => (loop = loopEl.checked))
  speedEl.addEventListener("change", () => (speed = +speedEl.value))
  lengthEl.addEventListener("change", () => {
    const nd = Math.max(100, Math.min(5000, Math.round(+lengthEl.value || doc.duration)))
    const k = nd / doc.duration
    for (const ks of Object.values(doc.tracks)) for (const kf of ks) kf.t = Math.round(kf.t * k)
    doc.duration = nd
    lengthEl.value = nd
    touch()
    renderInspector()
    say(`length ${nd}ms — keyframes rescaled with it`)
  })
  $("#reset").addEventListener("click", () => {
    if (!confirm("drop your tweaks and go back to the game's current animation?")) return
    doc = game()
    sel = null
    clock = 0
    lengthEl.value = doc.duration
    try { localStorage.removeItem(store) } catch {}
    renderInspector()
    say("back to the game's animation")
  })

  // ── exchange ─────────────────────────────────────────────────────────
  $("#copy").addEventListener("click", async () => {
    const s = formatDoc(doc)
    jsonEl.value = s
    jsonEl.select()
    try {
      await navigator.clipboard.writeText(s)
      say("copied — paste it in chat")
    } catch {
      say("clipboard blocked — it's selected, ⌘C")
    }
  })
  $("#apply").addEventListener("click", () => {
    let next = null
    try { next = saneDoc(JSON.parse(jsonEl.value), tracks, game) } catch {}
    if (!next) return say("couldn't read that — paste a copied JSON block")
    doc = next
    sel = null
    clock = 0
    lengthEl.value = doc.duration
    touch()
    renderInspector()
    say("applied")
  })

  // ── keyboard ─────────────────────────────────────────────────────────
  const onKey = e => {
    if (e.target.matches("input, textarea, select")) return
    if (e.code === "Space") {
      e.preventDefault()
      setPlaying(!playing)
    } else if ((e.key === "Delete" || e.key === "Backspace") && sel) {
      e.preventDefault()
      removeKey(sel.id, sel.k)
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault()
      const d = (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 25 : 5)
      if (sel) {
        sel.k.t = Math.max(0, Math.min(doc.duration, sel.k.t + d))
        touch()
      } else {
        playing = false
        playEl.textContent = "play"
        clock = Math.max(0, Math.min(doc.duration, playT() + d))
      }
    } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && sel) {
      e.preventDefault()
      const meta = tracks.find(x => x.id === sel.id)
      const d = (e.key === "ArrowUp" ? 1 : -1) * meta.step * (e.shiftKey ? 10 : 1)
      sel.k.v = +Math.max(meta.min, Math.min(meta.max, sel.k.v + d)).toFixed(3)
      touch()
    }
  }
  window.addEventListener("keydown", onKey)

  // ── the loop ─────────────────────────────────────────────────────────
  renderInspector()
  let rafId = 0
  let last = performance.now()
  function frame(now) {
    const dt = Math.min(100, now - last)
    last = now
    if (playing) {
      clock += dt * speed
      if (clock > doc.duration + LOOP_GAP * speed) {
        if (loop) clock = 0
        else {
          clock = doc.duration
          setPlaying(false)
        }
      }
    }
    readoutEl.textContent = `${Math.round(playT())} / ${doc.duration}ms ${playing ? (loop ? "· looping" : "") : "· paused"}`
    for (const tb of tabs) {
      tb.tv.textContent = sampleAt(tb.meta.id, playT()).toFixed(2)
      const ks = doc.tracks[tb.meta.id] || []
      tb.live.textContent = ks.length > 1 || (ks[0] && ks[0].v !== tb.meta.def) ? "●" : ""
    }
    drawStage()
    drawRuler()
    drawLane()
    rafId = requestAnimationFrame(frame)
  }
  rafId = requestAnimationFrame(frame)

  return {
    destroy() {
      cancelAnimationFrame(rafId)
      window.removeEventListener("keydown", onKey)
      root.remove()
    }
  }
}
