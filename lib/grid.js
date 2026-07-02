// Hex grid screen — the controller.
//
// Owns presentation state only: hover previews, the radial menu, the
// timed-action wait, the replay timer, the clock's collapsed/expanded toggle.
// Every game-state change goes through sim.dispatch(action); everything drawn
// comes from render.js reading the sim. The rules live in sim.js.
//
// The view is interior + perimeter row; perimeter hexes are ordinary scout /
// move targets (moving onto one crosses to the sibling and the boards slide).
//
// Timed actions: you wait out an action's cost in real time (1 simulated
// minute = TIME_SCALE ms, fast-forwarded by WAIT_SPEED). The wait is
// presentation — the sim applies the action atomically when the wait lands,
// so abandoning mid-wait spends nothing. During the wait the cube ghosts
// along the route and the clock counts the in-flight minutes.

import * as Hex from "./hex.js"
import { createSim } from "./sim.js"
import { createRenderer } from "./render.js"
import { CubeScreen } from "./cube.js"

const TIME_SCALE = 1000 // real ms of wait per simulated minute at speed ×1 (the unhurried pace)
const WAIT_SPEED = 60 // fast-forward factor for now; a future upgrade raises this so the
// real-time wait shrinks while the simulated cost stays the same
const MS_PER_MIN = TIME_SCALE / WAIT_SPEED // real ms per simulated minute — fast, but still live
const REPLAY_MS = 220 // ms between replayed actions

const eq = Hex.equals
const key = Hex.key

export function HexGridScreen() {
  const sim = createSim()
  const renderer = createRenderer(sim)

  let api = null
  let hovered = null // hovered hex [q,r], or null
  let hoverPath = null // routed path player→hovered, or null
  let lastP = null // last pointer position — actions re-run hover with it, since
  // the world can change under a stationary mouse
  let clockExpanded = false // clock starts collapsed; clicking the status line toggles it
  let menuOpen = false // radial action menu on the player tile
  let pending = null // in-progress timed action — { action, verb, target, path, stepMs, totalMs, totalMin, elapsed }
  let replaying = false // true while a replay is animating
  let replayIdx = 0
  let replayTimer = 0
  let rafId = 0
  let lastT = 0

  // ── timed-action wait loop ─────────────────────────
  function tick(t) {
    const dt = lastT ? t - lastT : 16
    lastT = t
    if (pending) {
      pending.elapsed += dt
      if (pending.elapsed >= pending.totalMs) {
        const done = pending
        pending = null
        const r = sim.dispatch(done.action)
        if (!r.ok) console.warn("timed action rejected at completion:", done.action, r.reason)
        hovered = hoverPath = null
        if (lastP) onPointerMove(lastP) // refresh hover — the world changed under the mouse
      }
    }
    api.requestRender()
    rafId = pending ? requestAnimationFrame(tick) : 0
  }

  function startLoop() {
    if (!rafId) {
      lastT = 0
      rafId = requestAnimationFrame(tick)
    }
  }

  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId)
    rafId = 0
    lastT = 0
  }

  function startMove(target, { via = null } = {}) {
    const path = via || sim.routeTo(target)
    if (!path) return
    const stepMs = sim.stepCost() * MS_PER_MIN
    const crossing = sim.kindOf(target) === "nbr"
    pending = {
      action: via ? { type: "move", target, via } : { type: "move", target },
      verb: crossing ? "crossing to" : "walking to",
      target,
      path,
      stepMs,
      totalMs: (path.length - 1) * stepMs,
      totalMin: sim.pathCost(path),
      elapsed: 0
    }
    startLoop()
  }

  function startScout(target) {
    pending = {
      action: { type: "scout", target },
      verb: "scouting",
      target,
      path: null,
      stepMs: 0,
      totalMs: sim.scoutCostAt(target) * MS_PER_MIN,
      totalMin: sim.scoutCostAt(target),
      elapsed: 0
    }
    startLoop()
  }

  // Presentation of the in-flight wait: where the cube ghosts, how the trail
  // would look, and the whole-minute counters every readout derives from.
  function pendingView() {
    if (!pending) return null
    const p = pending
    // in the safe space the action is free — the clock must not phantom-drain;
    // elsewhere never show more drain than the sim will actually charge (or have)
    const inflightMin = sim.view().tile.safe
      ? 0
      : Math.min(Math.floor(p.elapsed / MS_PER_MIN), Math.ceil(p.totalMin), sim.energy())
    let ghostTile = null
    let ghostTrail = null
    if (p.path) {
      const k = Math.min(Math.floor(p.elapsed / p.stepMs), p.path.length - 1)
      ghostTile = p.path[k]
      // replay the walked prefix onto the committed trail (elastic: retracing pops)
      ghostTrail = sim.view().trail.map(t => t.slice())
      for (let i = 1; i <= k; i++) {
        const step = p.path[i]
        if (ghostTrail.length >= 2 && eq(step, ghostTrail[ghostTrail.length - 2])) ghostTrail.pop()
        else ghostTrail.push(step)
      }
    }
    return {
      verb: p.verb,
      target: p.target,
      ghostTile,
      ghostTrail,
      inflightMin,
      remainingMin: Math.max(0, Math.round(p.totalMin - inflightMin))
    }
  }

  // ── the radial menu (actions on the tile the player stands on) ──────
  function menuActions() {
    const v = sim.view()
    const a = []
    if (v.tile.safe && eq(v.player, [0, 0])) {
      a.push({ label: "enter cube", run: enterCube })
      a.push({ label: "rest", run: () => sim.dispatch({ type: "rest" }) })
    }
    if (sim.canEnter()) {
      a.push({ label: "enter", run: () => sim.dispatch({ type: "enter" }) })
    }
    return a
  }

  function enterCube() {
    api.setScreen(CubeScreen(() => api.setScreen(screen)))
  }

  // ── replay ─────────────────────────────────────────
  const hitPlay = p => {
    if (!clockExpanded) return false // play button only exists on the expanded clock
    const pb = renderer.playButton(api.layout)
    return Math.hypot(p.x - pb.x, p.y - pb.y) <= pb.r
  }

  const toggleReplay = () => (replaying ? stopReplay() : startReplay())

  function startReplay() {
    if (!sim.log().length || pending) return
    replaying = true
    replayIdx = 0
    sim.beginReplay()
    hovered = hoverPath = null
    menuOpen = false
    api.requestRender()
    scheduleReplay()
  }

  const applyLogged = a => {
    const r = sim.apply(a)
    if (!r.ok) console.warn("replay diverged — logged action rejected:", a, r.reason)
  }

  function scheduleReplay() {
    replayTimer = setTimeout(() => {
      if (!replaying) return
      const log = sim.log()
      if (replayIdx >= log.length) return stopReplay()
      applyLogged(log[replayIdx++])
      api.requestRender()
      scheduleReplay()
    }, REPLAY_MS)
  }

  function stopReplay() {
    if (replayTimer) clearTimeout(replayTimer)
    replayTimer = 0
    if (!replaying) return
    // fast-forward the rest so we land back on the live end-of-day state
    const log = sim.log()
    while (replayIdx < log.length) applyLogged(log[replayIdx++])
    sim.endReplay()
    replaying = false
    api.requestRender()
  }

  // ── pointer ────────────────────────────────────────
  function onPointerMove(p) {
    lastP = p
    if (pending || replaying) return // locked while a timed action or replay runs

    renderer.setFrame(api.layout, clockExpanded)
    const size = renderer.sizeFor()
    const { q, r } = renderer.pixelToHex(api.layout, p.x, p.y, size)
    const h = sim.kindOf([q, r]) ? [q, r] : null
    const v = sim.view()
    // recompute the path every move (the BFS is cheap) — the tile under a
    // stationary pointer can change state, so "same tile" ≠ "same path"
    let np = null
    if (h && !eq(h, v.player)) {
      // a trail tile is exclusively a RETRACE target: preview the walk back
      // along the trail or nothing (never a shortest-route fallback)
      if (sim.trailIndexOf(h) >= 0) np = sim.retraceRoute(h)
      else if (sim.canMove(h)) np = sim.routeTo(h)
    }
    const sig = pth => (pth ? `${pth.length}:${key(pth[0])}:${key(pth[pth.length - 1])}` : "")
    let changed = false
    if ((h ? key(h) : null) !== (hovered ? key(hovered) : null) || sig(np) !== sig(hoverPath)) {
      hovered = h
      hoverPath = np
      changed = true
    }
    if (changed) api.requestRender()

    // the player cube is a button (opens the radial menu); open-menu slots are too
    const onPlayer = h && eq(h, v.player)
    let overMenu = onPlayer
    if (menuOpen) for (const b of renderer.menuBtns()) if (Math.hypot(p.x - b.x, p.y - b.y) <= b.r) overMenu = true
    document.body.style.cursor = hoverPath || overMenu ? "pointer" : "default"
  }

  function onPointerDown(p) {
    if (hitPlay(p)) {
      toggleReplay()
      return
    }
    if (p.y <= 24) {
      // clicking elsewhere on the status line toggles the clock expanded/collapsed
      clockExpanded = !clockExpanded
      api.requestRender()
      return
    }
    if (pending || replaying) return // input is locked
    if (menuOpen) {
      // open menu: a slot runs its action; anywhere else (incl. the player) just closes
      menuOpen = false
      for (const b of renderer.menuBtns()) {
        if (Math.hypot(p.x - b.x, p.y - b.y) <= b.r) {
          b.run()
          hovered = hoverPath = null // the action may have changed the view (enter/rest)
          api.requestRender()
          return
        }
      }
      api.requestRender()
      return
    }
    for (const b of renderer.homeButtons()) {
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
        sim.dispatch({ type: b.action === "go home" ? "goHome" : "restResume" })
        hovered = hoverPath = null
        api.requestRender()
        return
      }
    }

    renderer.setFrame(api.layout, clockExpanded)
    const size = renderer.sizeFor()
    const { q, r } = renderer.pixelToHex(api.layout, p.x, p.y, size)
    const t = [q, r]
    if (!sim.kindOf(t)) return // beyond the field
    const v = sim.view()

    if (eq(t, v.player)) {
      // clicking the player opens the radial action menu
      menuOpen = true
      api.requestRender()
      return
    }
    if (sim.isFrontier(t)) {
      // adjacent unknown tile (perimeter included) → scout it rather than move
      if (sim.canScout(t)) startScout(t)
      return
    }
    if (sim.trailIndexOf(t) >= 0) {
      // a trail tile only ever retraces (matches the hover preview) — when the
      // retrace isn't affordable the click does nothing, never a shortest-route walk
      const via = sim.retraceRoute(t)
      if (via) startMove(t, { via })
      return
    }
    if (sim.canMove(t)) startMove(t) // a discovered perimeter target crosses on the last step
  }

  // ── screen lifecycle ───────────────────────────────
  function enter(a) {
    api = a
    hovered = hoverPath = null
  }

  function leave() {
    stopLoop()
    stopReplay()
    pending = null // atomic waits: an abandoned action never happened
    menuOpen = false
    document.body.style.cursor = "default"
  }

  function draw(ctx, L) {
    renderer.draw(ctx, L, {
      hovered,
      hoverPath,
      clockExpanded,
      replaying,
      menu: menuOpen ? menuActions() : null,
      pending: pendingView()
    })
  }

  const screen = {
    id: "hexgrid",
    enter,
    leave,
    onPointerMove,
    onPointerDown,
    onPointerUp() {},
    onDoubleClick() {},
    draw
  }
  return screen
}
