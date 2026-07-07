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
import { SKILL_ICON } from "./icons.js"

const TIME_SCALE = 1000 // real ms of wait per simulated minute at speed ×1 (the unhurried pace)
const WAIT_SPEED = 60 // fast-forward factor for now; a future upgrade raises this so the
// real-time wait shrinks while the simulated cost stays the same
const MS_PER_MIN = TIME_SCALE / WAIT_SPEED // real ms per simulated minute — fast, but still live
const REPLAY_MS = 220 // ms between replayed actions

const eq = Hex.equals
const key = Hex.key

// ── the save (localStorage mirror of sim.serialize(); nostr rides this later) ──
const SAVE_KEY = "anon&mato:save"

function persist(sim) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(sim.serialize()))
  } catch {} // storage unavailable/full — play on, unsaved
}

// Load into a FRESH sim; false = hydration failed (the sim is now poisoned
// mid-replay — the caller must start over). A rejected save is stashed, not
// destroyed: dev-phase rule is saves reset on rules changes, but keep the bytes.
function loadSave(sim) {
  let raw = null
  try {
    raw = localStorage.getItem(SAVE_KEY)
  } catch {
    return true
  }
  if (!raw) return true
  try {
    const r = sim.hydrate(JSON.parse(raw))
    if (r.ok) return true
    console.warn("save rejected — starting fresh:", r.reason)
  } catch (e) {
    console.warn("save unreadable — starting fresh:", e)
  }
  try {
    localStorage.setItem(SAVE_KEY + ":rejected", raw)
    localStorage.removeItem(SAVE_KEY)
  } catch {}
  return false
}

// The world a stored save was played in ({angle, pubkey, worldKey, day}), or
// null when there's no (readable) save — boot and the identity card read this.
export function savedWorld() {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    const save = raw ? JSON.parse(raw) : null
    const w = save?.world
    return w && typeof w.angle === "number"
      ? { angle: w.angle, pubkey: w.pubkey ?? null, worldKey: w.worldKey ?? null, day: save.today?.day ?? 1 }
      : null
  } catch {
    return null
  }
}

export function HexGridScreen({ angle, pubkey = null, worldKey = null, onReset } = {}) {
  let sim = createSim({ angle, pubkey, worldKey })
  if (!loadSave(sim)) sim = createSim({ angle, pubkey, worldKey })
  persist(sim) // bank the world (angle + identity + world key) immediately — a fresh pick survives reload
  const renderer = createRenderer(sim)

  // every state change goes through here: dispatch, then mirror to storage,
  // then let the menu open itself if we've arrived somewhere it should
  const act = a => {
    const r = sim.dispatch(a)
    if (r.ok) {
      persist(sim)
      autoMenu()
    }
    return r
  }

  let api = null
  let hovered = null // hovered hex [q,r], or null
  let hoverPath = null // routed path player→hovered, or null
  let hoverRetrace = false // true when hoverPath is a trail retrace (drawn as trail truncation)
  let lastP = null // last pointer position — actions re-run hover with it, since
  // the world can change under a stationary mouse
  let clockExpanded = false // clock starts collapsed; clicking the status line toggles it
  let logsOpen = true // the top-right action-log panel — expanded by default (it's a dev window into the save format)
  let menuOpen = false // the radial menu around the player
  let menuOpenId = null // the expanded folder's id (one at a time), or null
  let menuFocusId = null // the badge under the pointer (shows its label), or null
  let statsShow = null // stats panel: null | "you" | "them"
  let menuCtx = null // last auto-open context key ("home" | "npc:q,r" | null) — the menu opens on transitions into one
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
        const r = act(done.action)
        if (!r.ok) console.warn("timed action rejected at completion:", done.action, r.reason)
        hovered = hoverPath = null, hoverRetrace = false
        if (lastP) onPointerMove(lastP) // refresh hover — the world changed under the mouse (act() already ran autoMenu)
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
    const totalMin = sim.pathCost(path) // typed steps (seams half-price) — the wait matches the charge
    const totalMs = totalMin * MS_PER_MIN
    const tb = sim.boardHexOf(target)
    const pb = sim.boardHexOf(sim.view().player)
    const crossing = !!tb && (!pb || tb[0] !== pb[0] || tb[1] !== pb[1])
    pending = {
      action: via ? { type: "move", target, via } : { type: "move", target },
      verb: crossing ? "crossing to" : "walking to",
      target,
      path,
      stepMs: totalMs / (path.length - 1),
      totalMs,
      totalMin,
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

  // ── the radial menu (a folder tree fanned around the player) ────────
  // Built fresh each frame from what's true right now. `self` = things you
  // do; `them` = things with the figure you face (splits the ring when
  // present). Helpers live here as a folder now.
  function menuSpec() {
    const v = sim.view()
    const self = []
    if (v.tile.safe && eq(v.player, [0, 0])) {
      self.push({ id: "rest", icon: "rest", label: "rest", run: () => act({ type: "rest" }) })
      self.push({ id: "cube", icon: "cube", label: "enter cube", run: enterCube })
    }
    if (sim.canEnter()) self.push({ id: "enter", icon: "enter", label: "enter", run: () => act({ type: "enter" }) })
    if (sim.playerStats())
      self.push({ id: "you", icon: "stats", label: "your skills", keepOpen: true, run: () => (statsShow = statsShow === "you" ? null : "you") })
    self.push({
      id: "helpers",
      icon: "folder",
      label: "helpers",
      children: [
        { id: "goHome", icon: "home", label: "go home", run: () => act({ type: "goHome" }) },
        { id: "restResume", icon: "camp", label: "rest and resume", run: () => act({ type: "restResume" }) },
        { id: "clearBoard", icon: "reveal", label: "clear board", run: () => act({ type: "clearBoard" }) },
        { id: "reset", icon: "reset", label: "reset everything", run: doReset }
      ]
    })

    // them: the RIGHT side of the ring — the thing you're inspecting. A
    // figure if you stand on its centre, otherwise the land under your feet.
    // (Home's own centre stays self-only.)
    const them = []
    const atHome = v.tile.safe && eq(v.player, [0, 0])
    const npc = onNpc()
    if (npc) {
      const lessons = sim
        .learnable()
        .sort((x, y) => y.teacher - y.at - (x.teacher - x.at))
        .map(l => ({
          id: "learn:" + l.skill,
          icon: SKILL_ICON[l.skill] || "lore",
          label: `learn ${l.skill} ${l.at}→${l.at + 1}`,
          badge: l.at + 1,
          keepOpen: true, // lessons repeat — keep the ring up
          run: () => act({ type: "learn", skill: l.skill })
        }))
      if (lessons.length) them.push({ id: "learn", icon: "lore", label: "learn", children: lessons })
      them.push({ id: "them", icon: "stats", label: "their skills", keepOpen: true, run: () => (statsShow = statsShow === "them" ? null : "them") })
    } else if (!atHome && sim.landAt(v.player)) {
      // land inspection — its facts now; gather/work actions come with resources
      them.push({ id: "land", icon: "gather", label: "this land", keepOpen: true, run: () => (statsShow = statsShow === "land" ? null : "land") })
    }
    return { self, them, openId: menuOpenId, focusId: menuFocusId }
  }

  // the top-left panel: your skills, a figure's skills, or the land's facts
  function statsPanel() {
    const v = sim.view()
    if (statsShow === "you" && sim.playerStats()) {
      const nature = sim.playerStats()
      const eff = {}
      for (const k in nature) eff[k] = sim.skillOf(k)
      return { kind: "skills", title: "your skills", subtitle: "you", stats: nature, effective: eff }
    }
    if (statsShow === "them") {
      const npc = onNpc()
      if (!npc) return null
      const eff = {}
      for (const k in npc.stats) eff[k] = sim.npcSkill(npc, k)
      const place = npc.place ? `of the ${sim.typeNameAt(npc.pos)}` : "figure"
      return { kind: "skills", title: "figure", subtitle: place, stats: npc.stats, effective: eff }
    }
    if (statsShow === "land") {
      const land = sim.landAt(v.player)
      if (!land) return null
      return {
        kind: "info",
        title: land.biome,
        subtitle: "land",
        rows: [
          ["elevation", `${land.elevation}/15`],
          ["move cost", `${land.move}×`],
          ["scout cost", `${land.scout}×`],
          ["yields", land.yields]
        ]
      }
    }
    return null
  }

  // ── auto-open: the menu opens itself the moment you ARRIVE on the home
  // centre or beside a figure (a context transition). Dismissing it just
  // closes it — it won't reopen until you move to another such spot.
  // the figure you're ON: figures rest at board centres, so you inspect one
  // only while standing on its tile (not merely nearby)
  function onNpc() {
    const v = sim.view()
    const b = sim.boardHexOf(v.player)
    const npc = b && sim.npcAt(b)
    return npc && eq(v.player, npc.pos) ? npc : null
  }
  function menuContextKey() {
    const v = sim.view()
    if (v.tile.safe && eq(v.player, [0, 0])) return "home"
    const npc = onNpc()
    return npc ? "npc:" + npc.board[0] + "," + npc.board[1] : null
  }
  function autoMenu() {
    const k = menuContextKey()
    if (k === menuCtx) return // no transition
    menuCtx = k
    if (k) {
      menuOpen = true
      menuOpenId = menuFocusId = null
    }
  }

  function closeMenu() {
    menuOpen = false
    menuOpenId = null
    menuFocusId = null
  }

  function doReset() {
    try {
      localStorage.removeItem(SAVE_KEY)
    } catch {}
    if (onReset) onReset()
    else window.location.reload()
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
    hovered = hoverPath = null, hoverRetrace = false
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

    // the radial menu grabs the pointer first — focus the badge under it
    if (menuOpen) {
      const hit = renderer.menuHit(p)
      const id = hit ? hit.id : null
      if (id !== menuFocusId) {
        menuFocusId = id
        api.requestRender()
      }
      document.body.style.cursor = hit ? "pointer" : "default"
      return
    }

    renderer.setFrame(api.layout, clockExpanded)
    const size = renderer.sizeFor()
    const { q, r } = renderer.pixelToHex(api.layout, p.x, p.y, size)
    const h = sim.kindOf([q, r]) ? [q, r] : null
    const v = sim.view()
    // recompute the path every move (the BFS is cheap) — the tile under a
    // stationary pointer can change state, so "same tile" ≠ "same path"
    let np = null
    let retrace = false
    if (h && !eq(h, v.player)) {
      // a trail tile prefers a RETRACE: preview the walk back along the trail
      // (one global walk — retraces cross boards natively). When the full
      // retrace isn't affordable, fall back to the shortest route like any
      // discovered tile, so the way home never dies with the budget.
      if (sim.trailIndexOf(h) >= 0) {
        np = sim.retraceRoute(h)
        retrace = !!np
      }
      if (!np && sim.canMove(h)) np = sim.routeTo(h)
    }
    const sig = pth => (pth ? `${pth.length}:${key(pth[0])}:${key(pth[pth.length - 1])}` : "")
    let changed = false
    if ((h ? key(h) : null) !== (hovered ? key(hovered) : null) || sig(np) !== sig(hoverPath) || retrace !== hoverRetrace) {
      hovered = h
      hoverPath = np
      hoverRetrace = retrace
      changed = true
    }
    if (changed) api.requestRender()

    // the player cube is a button (opens the radial menu)
    const onPlayer = h && eq(h, v.player)
    document.body.style.cursor = hoverPath || onPlayer ? "pointer" : "default"
  }

  function onPointerDown(p) {
    if (hitPlay(p)) {
      toggleReplay()
      return
    }
    if (p.y <= 24 && p.x >= api.layout.w - 70) {
      // the top-right corner of the status line is the "logs" toggle
      logsOpen = !logsOpen
      api.requestRender()
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
      // a badge: a folder toggles its fan-out; a leaf runs and closes; a
      // click on empty space closes the menu (a dismissal, per context)
      const hit = renderer.menuHit(p)
      if (hit) {
        if (hit.node.children) {
          menuOpenId = menuOpenId === hit.id ? null : hit.id
        } else if (!hit.node.disabled && hit.node.run) {
          hit.node.run()
          if (hit.node.keepOpen) {
            menuFocusId = hit.id // a panel toggle — leave the ring up
          } else {
            hovered = hoverPath = null, hoverRetrace = false // the action may have changed the view
            closeMenu()
          }
        }
        api.requestRender()
        return
      }
      closeMenu()
      api.requestRender()
      return
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
      menuOpenId = menuFocusId = null
      api.requestRender()
      return
    }
    if (sim.isFrontier(t)) {
      // adjacent unknown tile (perimeter included) → scout it rather than move
      if (sim.canScout(t)) startScout(t)
      return
    }
    if (sim.trailIndexOf(t) >= 0) {
      // a trail tile prefers the retrace (matches the hover preview) — when
      // that isn't affordable it falls through to a plain shortest-route walk
      const via = sim.retraceRoute(t)
      if (via) {
        startMove(t, { via })
        return
      }
    }
    if (sim.canMove(t)) startMove(t) // a discovered neighbour target crosses on the last step
  }

  // ── screen lifecycle ───────────────────────────────
  function enter(a) {
    api = a
    hovered = hoverPath = null, hoverRetrace = false
    autoMenu() // day one opens on the home centre
  }

  function leave() {
    stopLoop()
    stopReplay()
    pending = null // atomic waits: an abandoned action never happened
    menuOpen = false
    menuOpenId = menuFocusId = null
    document.body.style.cursor = "default"
  }

  function draw(ctx, L) {
    renderer.draw(ctx, L, {
      hovered,
      hoverPath,
      hoverRetrace,
      clockExpanded,
      logsOpen,
      replaying,
      menu: menuOpen ? menuSpec() : null,
      statsPanel: statsShow ? statsPanel() : null,
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
