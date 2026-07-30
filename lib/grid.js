// Hex grid screen — the controller.
//
// Owns presentation state only: hover previews, the radial menu, the
// timed-action wait, the replay timer.
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
import { createSim, BIOME_SKILL, RECIPES, BUILDS } from "./sim.js"
import { createRenderer, npcName } from "./render.js"
import { easeSplit } from "./draw.js"
import { npubEncode } from "./vendor/nostr-nip19.js"
import { CubeScreen } from "./cube.js"

const TIME_SCALE = 1000 // real ms of wait per simulated minute at speed ×1 (the unhurried pace)
const WAIT_SPEED = 60 // fast-forward factor for now; a future upgrade raises this so the
// real-time wait shrinks while the simulated cost stays the same
const MS_PER_MIN = TIME_SCALE / WAIT_SPEED // real ms per simulated minute — fast, but still live
// A move is paced by the tiles' CHARGE, so costly ground (mountains, mud) walks
// slower than easy ground — the delay tracks the same cost the sim deducts. The
// scale is set so the CHEAPEST tile (charge ≈ COST_BASE = 1) walks at today's
// fast pace; pricier tiles stretch from there by their cost ratio. A single easy
// step still floors at MIN (brisk), a long route caps at MAX (never crawls), and
// the camera borrows this same duration at a seam so the two glide in lockstep.
const MOVE_MS_PER_CHARGE = 150 // real ms per charge-minute (COST_BASE = 1 → this many ms)
const MOVE_MS_MIN = 150 // the fastest a step goes — the easy-tile speed, as now
const MOVE_MS_MAX = 2400 // a faraway route takes real, WATCHABLE time — you see the whole walk
// A move that SHIFTS the view to another board slides the camera a whole board
// width — far more travel than a step inside a board, at the same duration it
// would whip. Add time for how far the camera actually goes (the board-centre
// shift, in tiles), so cube + camera still land together but a crossing reads.
const MOVE_MS_PER_SHIFT_TILE = 30 // extra ms per tile of board-centre travel
const MOVE_MS_SHIFT_MAX = 420 // …but the crossing add never itself drags
const MOVE_EASE_IN = 0.28 // the cube: SHORT ease-in, LONG ease-out — quick off the mark, soft landing
const REPLAY_MS = 220 // ms between replayed actions
const DRAG_THRESH = 6 // px a press must travel (free-cam) before it counts as a board drag, not a tap

const eq = Hex.equals
const key = Hex.key

// ── the save (localStorage mirror of sim.serialize(); nostr rides this later) ──
const SAVE_KEY = "anon&mato:save"

// The pointer over the world (and the menu) is our OWN dot, drawn on the canvas
// (see render.js) with the OS cursor hidden — full control, theme-aware, room to
// restyle later. The header keeps the normal cursor as clickable chrome.
const HEADER_H = 24 // the top status/logs strip — chrome, so it keeps a normal cursor

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

// Build the sim and replay its save PROGRESSIVELY (trusted, chunked), driving a
// loader between batches. This is the path boot uses; it heals legacy saves by
// re-persisting once the via-routes have been stamped in. `onProgress(done,
// total)` should update the UI and yield a frame. A rejected save is stashed.
export async function prepareSim({ angle, pubkey = null, worldKey = null } = {}, onProgress = null) {
  const world = { angle, pubkey, worldKey }
  let sim = createSim(world)
  let raw = null
  try {
    raw = localStorage.getItem(SAVE_KEY)
  } catch {
    return sim // storage blocked — a fresh, unsaved life
  }
  if (!raw) return sim // no save — a fresh life (nothing to replay)
  try {
    const r = await sim.hydrateProgressive(JSON.parse(raw), { onProgress })
    if (r.ok) {
      persist(sim) // re-bank: any via-routes stamped in during replay are now saved (self-heal)
      return sim
    }
    console.warn("save rejected — starting fresh:", r.reason)
  } catch (e) {
    console.warn("save unreadable — starting fresh:", e)
  }
  try {
    localStorage.setItem(SAVE_KEY + ":rejected", raw)
    localStorage.removeItem(SAVE_KEY)
  } catch {}
  sim = createSim(world) // the previous sim is poisoned mid-replay — start over
  persist(sim)
  return sim
}

export function HexGridScreen({ angle, pubkey = null, worldKey = null, sim: preSim = null, onReset } = {}) {
  let sim = preSim
  if (!sim) {
    // no pre-built sim (e.g. a direct/synchronous caller): the strict path
    sim = createSim({ angle, pubkey, worldKey })
    if (!loadSave(sim)) sim = createSim({ angle, pubkey, worldKey })
  }
  persist(sim) // bank the world (angle + identity + world key) immediately — a fresh pick survives reload
  const renderer = createRenderer(sim)

  // every state change goes through here: dispatch, then mirror to storage
  // (the menu never opens itself — it's always a click on the player)
  const act = a => {
    const r = sim.dispatch(a)
    if (r.ok) {
      persist(sim)
      startLoop() // drive frames until the camera glide settles
    }
    return r
  }

  let api = null
  let hovered = null // hovered hex [q,r], or null
  let hoverPath = null // routed path player→hovered, or null
  let hoverIllegal = false // true when hoverPath is a reachable-but-unaffordable move (shown ghosted)
  let skillHover = null // the skill slot the pointer is over (menu open) → name label + (if actionable) cost preview
  // does this skill still offer a learn/teach with the figure at hand? — used to
  // drop a hover once its button has been used up (no pointer move comes to clear it)
  const skillActionable = s => {
    const p = sim.view().player
    const bc = sim.boardHexOf(p)
    const faced = bc && sim.npcAt(bc)
    const npc = faced && eq(faced.pos, p) ? faced : null
    if (!npc) return false
    const you = sim.skillOf(s)
    const them = sim.npcSkill(npc, s)
    return them > you || (you > them && them < npc.stats[s]) // a lesson to take, or a level to give
  }
  let worldPress = false // a press landed on the world (menu closed): the tile action fires on RELEASE
  let downTile = null // the tile the press started on — the menu opens only if release matches it
  let freeCam = false // free-pan camera mode: drag the board around; the camera stops auto-following
  let downP = null // screen point the press landed at — to tell a tap from a drag
  let dragPrev = null // last pointer point while panning (for the frame-to-frame delta)
  let dragged = false // this press has travelled past DRAG_THRESH → it's a pan, not a tap
  let lastP = null // last pointer position — actions re-run hover with it, since
  // the world can change under a stationary mouse
  let logsOpen = false // the action-log panel (top-left, menu-only) — collapsed by default, shows the latest entry
  let menuOpen = false // the radial menu around the player
  let menuOpenId = null // the expanded folder's id (one at a time), or null
  let menuFocusId = null // the badge under the pointer (shows its label), or null
  let dayEnding = false // true while the end-of-day (sleep) screen is up — the day banks on WAKE, not on sleep
  let pending = null // in-progress timed action — { action, verb, target, path, totalMs, totalMin, elapsed }
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
        hovered = hoverPath = null, hoverIllegal = false
        if (lastP) onPointerMove(lastP) // refresh hover — the world changed under the mouse
      }
    }
    // mid-walk the world glides under a STILL pointer — no pointermove fires, so
    // re-aim the menu hover here, once per frame, against the live layout
    if (pending && menuOpen && lastP) updateMenuHover(lastP)
    api.requestRender() // draw this frame → the camera eases toward its anchor
    // keep animating while a timed action runs OR a learn button is hovered (its
    // preview edge grows), so the growth reads as motion, not a static line
    const animating = pending || (menuOpen && skillHover?.action === "learn")
    rafId = animating ? requestAnimationFrame(tick) : 0
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
    const totalMin = sim.pathCharge(path) // what the sim will actually deduct (home flat, seams half-price)
    // paced by the ROUTE'S CHARGE: costly ground walks slower, easy ground stays
    // brisk — the delay tracks the real cost, floored/capped so it never over- or
    // under-shoots the feel we tuned
    let totalMs = Math.max(MOVE_MS_MIN, Math.min(MOVE_MS_MAX, totalMin * MOVE_MS_PER_CHARGE))
    // …plus time for a board SHIFT: how far the camera slides to frame the end
    // board. Within one board this is 0 (the view holds still); across a seam it
    // adds a beat so the whole-board slide doesn't whip past at the step's pace.
    const ob = sim.boardCentreOf(path[0])
    const db = sim.boardCentreOf(target)
    if (ob && db) totalMs += Math.min(MOVE_MS_SHIFT_MAX, Hex.distance(ob, db) * MOVE_MS_PER_SHIFT_TILE)
    pending = {
      // record the resolved route (never just the target): a via-move replays
      // without re-routing, which is what keeps load time linear in day count
      action: { type: "move", target, via: path },
      verb: "walking to", // crossing a seam into a sibling board is just a move like any other
      target,
      path,
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
      totalMs: sim.scoutChargeAt(target) * MS_PER_MIN,
      totalMin: sim.scoutChargeAt(target),
      elapsed: 0
    }
    startLoop()
  }

  // a timed action taken IN PLACE (gather, craft, build) — same wait loop as
  // a scout, with a floor so even the quick ones read as work
  function startTimed(action, verb, totalMin) {
    pending = {
      action,
      verb,
      target: sim.view().player,
      path: null,
      totalMs: Math.max(240, totalMin * MS_PER_MIN),
      totalMin,
      elapsed: 0
    }
    startLoop()
  }

  // Presentation of the in-flight wait: where the cube ghosts, how the trail
  // would look, and the whole-minute counters every readout derives from.
  function pendingView() {
    if (!pending) return null
    const p = pending
    // never show more drain than the sim will actually charge (or than we have)
    const inflightMin = Math.min(Math.floor(p.elapsed / MS_PER_MIN), Math.ceil(p.totalMin), sim.energy())
    let ghostTile = null
    let ghostPos = null
    let ghostTrail = null
    if (p.path) {
      // one continuous asymmetric-quad swoosh over the WHOLE walk: quick off the
      // mark, a long glide into a soft landing. No constant middle, so a multi-tile
      // route reads as a single motion instead of beating out each step.
      const u = Math.min(1, p.elapsed / p.totalMs)
      const dist = easeSplit(u, MOVE_EASE_IN) * (p.path.length - 1) // eased distance along the path, in tiles
      // ghostTile (ceil) is the tile being ENTERED — camera + border track it so a
      // board crossing hands off cleanly. The DRAWN position is continuous below.
      ghostTile = p.path[Math.min(Math.ceil(dist), p.path.length - 1)]
      // the glide: lerp within the current segment so the cube slides from tile to
      // tile instead of teleporting. Axial→pixel is linear, so this walks a
      // straight line between tile centres.
      const s = Math.max(0, Math.min(p.path.length - 2, Math.floor(dist)))
      const frac = p.path.length < 2 ? 0 : Math.max(0, Math.min(1, dist - s))
      const a = p.path[s]
      const b = p.path[s + 1] || a
      ghostPos = [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac]
      // the trail: the COMPLETED tiles (elastic — retracing pops), then the live
      // glide point as the head, so the drawn line always meets the moving cube
      ghostTrail = sim.view().trail.map(t => t.slice())
      for (let i = 1; i <= s; i++) {
        const step = p.path[i]
        if (ghostTrail.length >= 2 && eq(step, ghostTrail[ghostTrail.length - 2])) ghostTrail.pop()
        else ghostTrail.push(step)
      }
      if (frac > 0.001) ghostTrail.push(ghostPos)
    }
    return {
      verb: p.verb,
      target: p.target,
      ghostTile,
      ghostPos,
      ghostTrail,
      moveMs: p.path ? p.totalMs : 0, // the camera borrows this duration so a crossing glides in step
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
    // resting works at ANY resting place — home's centre or a built camp. AT HOME
    // (standing on the centre — homePath is null there) sleep TAKES OVER go-home's
    // pinned W cell: the button you'd walk home with becomes the bed you came for.
    // At a camp it stays a regular node and go home remains. Full-size icon (big).
    const homeWalk = sim.homePath() // null when standing at the home centre
    const atHome = sim.atRestSpot() && !homeWalk
    if (sim.atRestSpot())
      self.push({ id: "rest", icon: "sleep", label: "sleep", closeMenu: true, big: true, ...(atHome ? { slot: "W" } : {}), run: beginSleep })
    if (v.tile.safe && eq(v.player, [0, 0])) {
      self.push({ id: "cube", icon: "cube", label: "enter cube", run: enterCube })
    }
    if (sim.canEnter()) self.push({ id: "enter", icon: "enter", label: "enter", run: () => act({ type: "enter" }) })
    // the WORKS: gather what the tile yields; craft from the pack; raise a camp
    const gi = sim.gatherInfo()
    if (gi) {
      self.push({
        id: "gather",
        icon: "gather",
        label: !gi.ready ? "gather · regrowing" : gi.full ? "gather · pack full" : `gather ${gi.res} · ${Math.ceil(gi.cost)}m`,
        disabled: !sim.canAct({ type: "gather" }),
        cost: gi.cost, // → the clock's hover estimate (in-place work)
        high: true,
        run: () => startTimed({ type: "gather" }, "gathering", gi.cost)
      })
    }
    // COMMISSION: standing with a figure whose land type they craft, list
    // the wares they can make. You bring the materials (greyed when short).
    const wares = sim.craftsNear()
    if (wares.length) {
      self.push({
        id: "craft",
        icon: "craft",
        label: "commission",
        children: wares.map(r => {
          const need = Object.entries(RECIPES[r].needs)
            .map(([k, n]) => `${n} ${k}`)
            .join(" + ")
          return {
            id: "craft-" + r,
            icon: "craft",
            label: `${r} · ${need} · ${RECIPES[r].min}m`,
            disabled: !sim.canAct({ type: "craft", recipe: r }),
            cost: RECIPES[r].min, // → the clock's hover estimate
            high: true,
            run: () => startTimed({ type: "craft", recipe: r }, "commissioning", RECIPES[r].min)
          }
        })
      })
    }
    self.push({
      id: "buildCamp",
      icon: "build",
      label: `build camp · ${BUILDS.camp.min}m`,
      disabled: !sim.canAct({ type: "build", what: "camp" }),
      cost: BUILDS.camp.min, // → the clock's hover estimate
      high: true,
      run: () => startTimed({ type: "build", what: "camp" }, "building", BUILDS.camp.min)
    })
    // STASH / TAKE: a home tile is a storage cell (one item type each);
    // anywhere else, dropping discards the item for good. Instant, free.
    const pack = Object.keys(sim.inventory())
    if (sim.canStash()) {
      const here = sim.stashHere()
      const stashable = pack.filter(k => !here || here.item === k)
      if (stashable.length) {
        self.push({
          id: "stash",
          icon: "gather",
          label: "stash",
          children: stashable.map(k => ({
            id: "stash-" + k,
            icon: "gather",
            label: `stash ${k}`,
            disabled: !sim.canAct({ type: "drop", item: k }),
            run: () => act({ type: "drop", item: k })
          }))
        })
      }
      if (here) {
        self.push({
          id: "take",
          icon: "gather",
          label: `take ${here.item} (${here.n})`,
          disabled: !sim.canAct({ type: "take" }),
          run: () => act({ type: "take" })
        })
      }
    } else if (pack.length) {
      self.push({
        id: "drop",
        icon: "reset",
        label: "drop · lost",
        children: pack.map(k => ({
          id: "drop-" + k,
          icon: "reset",
          label: `discard ${k}`,
          disabled: !sim.canAct({ type: "drop", item: k }),
          run: () => act({ type: "drop", item: k })
        }))
      })
    }
    // your skills live on the clock ring; land/figure info is on the top-right
    // card. go home stands on its OWN, pinned direct-left of the player; the rest
    // of the utilities fold into helpers (kept to the left, below go-home).
    // AT HOME the cell belongs to sleep instead (above) — nowhere to walk.
    if (!atHome)
      self.push({
        id: "goHome",
        icon: "home",
        label: "go home",
        slot: "W",
        cost: homeWalk ? sim.pathCharge(homeWalk) : 0, // → the clock's hover estimate
        retFrom: homeWalk ? homeWalk[homeWalk.length - 1] : null, // home: the way-back leg collapses to 0
        // walk the shortest route back to the home centre and stop there — resting
        // is then a separate, deliberate choice (it no longer auto-rests/ends the day)
        run: () => {
          const hp = sim.homePath()
          if (hp) startMove(hp[hp.length - 1])
        }
      })
    // TELEPORT (minimap travel): standing on a home tile whose corresponding
    // board's CENTRE has been discovered offers a jump to that centre. Cost model
    // (settled 2026-07-22): the charge of WALKING there — the shortest discovered
    // path to the centre — but the jump itself is INSTANT (the move commits in one
    // beat, no walk animation). Same reserve gate as walking (canMove).
    const hb = sim.boardHexOf(v.player)
    if (hb && hb[0] === 0 && hb[1] === 0 && !eq(v.player, [0, 0])) {
      const node = sim.parentOf().tile.children[key(v.player)]
      if (node && node.discovered.has("0,0")) {
        const target = sim.centreOf(v.player)
        const route = sim.routeTo(target)
        self.push({
          id: "teleport",
          icon: "travel",
          label: "teleport",
          disabled: !sim.canMove(target),
          cost: route ? sim.pathCharge(route) : 0, // → the clock's hover estimate
          retFrom: target, // …and the way home previews from where you'd LAND
          run: () => {
            const via = sim.routeTo(target)
            if (via) act({ type: "move", target, via }) // instant — charged like the walk
          }
        })
      }
    }
    self.push({
      id: "helpers",
      icon: "folder",
      label: "helpers",
      children: [
        { id: "restResume", icon: "camp", label: "rest and resume", run: () => act({ type: "restResume" }) },
        { id: "freecam", icon: "travel", label: freeCam ? "camera: free" : "camera: follow", keepOpen: true, run: toggleFreeCam },
        { id: "theme", icon: "sleep", label: "theme", keepOpen: true, run: toggleTheme },
        { id: "clearBoard", icon: "reveal", label: "clear board", run: () => act({ type: "clearBoard" }) },
        { id: "clearMap", icon: "reveal", label: "clear map", run: () => act({ type: "clearMap" }) },
        { id: "reset", icon: "reset", label: "reset everything", run: doReset }
      ]
    })
    // the ring's right side is unused for now — land/figure facts live on the card
    return { self, them: [], openId: menuOpenId, focusId: menuFocusId }
  }

  // the player card, top-right: land facts — or, standing ON a figure (a
  // board's centre), the same board/figure overview the centre's hover
  // shows. Shown while the menu is open (see render — ui.card).
  function infoCard() {
    const v = sim.view()
    const npc = onNpc()
    if (npc) {
      const np = npubEncode(npc.pubkey)
      const node = sim.parentOf().tile.children[key(npc.board)]
      return {
        kind: "info",
        title: npcName(npc.pubkey),
        subtitle: "figure",
        rows: [
          ["npub", `${np.slice(0, 12)}…${np.slice(-4)}`],
          ["mostly", sim.boardMainType(npc.board) || "—"],
          ["discovered", `${Math.round(((node?.discovered.size ?? 0) / 61) * 100)}%`]
        ]
      }
    }
    // (the pack is no longer card TEXT — it lives lower-left as item chips, one
    // hex per unit, drawn by the renderer's side views)
    // anywhere on the safe home board reads as "home" (its tiles aren't land)
    if (v.tile.safe) return { kind: "info", title: "home", subtitle: "your board", rows: [] }
    const land = sim.landAt(v.player)
    if (!land) return { kind: "info", title: "you", subtitle: "afield", rows: [] }
    const favoured = BIOME_SKILL[land.biome]
    return {
      kind: "info",
      title: land.biome,
      subtitle: "land",
      rows: [
        ["favours", favoured || "—"],
        land.deepness != null ? ["deepness", land.deepness] : ["elevation", land.elevation],
        ["move cost", `${land.move}×`],
        ["yields", land.yields]
      ]
    }
  }

  // (the first-person 3D views live in attic/ now — see attic/README.md)

  // flip the light/dark theme (the corner button moved into this menu)
  function toggleTheme() {
    const root = document.documentElement
    root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light"
    try {
      localStorage.setItem("thrive-theme", root.dataset.theme)
    } catch {}
    api.requestRender()
  }

  // free-pan camera: an optional mode where the camera stops following and you
  // drag the board yourself (the menu still centres). Persisted like the theme.
  function toggleFreeCam() {
    freeCam = !freeCam
    renderer.setFreeCam(freeCam)
    try {
      localStorage.setItem("thrive-freecam", freeCam ? "1" : "0")
    } catch {}
    api.requestRender()
  }

  // the menu NEVER opens itself — it's always a deliberate click on the
  // player, wherever you stand (home, a figure's tile, anywhere).
  // the figure you're ON: figures rest at board centres, so you inspect one
  // only while standing on its tile (not merely nearby)
  function onNpc() {
    const v = sim.view()
    const b = sim.boardHexOf(v.player)
    const npc = b && sim.npcAt(b)
    return npc && eq(v.player, npc.pos) ? npc : null
  }

  function closeMenu() {
    menuOpen = false
    menuOpenId = null
    menuFocusId = null
    skillHover = null
  }

  // SLEEP opens the end-of-day screen instead of banking the day outright — you
  // review the day's tally, then tap "wake up" to actually rest into the next.
  function beginSleep() {
    if (!sim.atRestSpot()) return
    dayEnding = true
    document.body.style.cursor = "default"
    api.requestRender()
  }
  function wakeUp() {
    dayEnding = false
    act({ type: "rest" }) // NOW the day banks and the next begins
    hovered = hoverPath = null, hoverIllegal = false
    if (lastP) onPointerMove(lastP)
    api.requestRender()
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
  // (the play button was retired with the header clock; replay has no UI trigger
  // for now — startReplay/stopReplay stay for when it gets a new home)
  const toggleReplay = () => (replaying ? stopReplay() : startReplay())

  function startReplay() {
    if (!sim.log().length || pending) return
    replaying = true
    replayIdx = 0
    sim.beginReplay()
    hovered = hoverPath = null, hoverIllegal = false
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
  // Coalesce pointer-driven redraws to one per frame: mousemove fires faster
  // than we can paint, so rendering synchronously on each event lags. rAF caps
  // it at the display rate.
  let renderQueued = false
  function scheduleRender() {
    if (renderQueued) return
    renderQueued = true
    requestAnimationFrame(() => {
      renderQueued = false
      api.requestRender()
    })
  }
  // re-aim the menu hover at p against the CURRENT layout. Called on real pointer
  // moves — and once per animation frame while a timed action runs, because the
  // world (badges included) glides under a STILL pointer then: no pointermove
  // fires, yet what's under the cursor changes every frame. Without this, a
  // clicked badge's label fossilises for the whole walk.
  function updateMenuHover(p) {
    const sh = renderer.skillHit(p)
    const hit = sh ? null : renderer.menuHit(p)
    const id = hit ? hit.id : null
    // compare kind too: the glyph and the sign of the SAME skill are
    // different targets — matching on skill alone kept the old one stuck
    if (id !== menuFocusId || sh?.skill !== skillHover?.skill || sh?.kind !== skillHover?.kind) {
      menuFocusId = id
      skillHover = sh // the whole slot (name + action), or null
      if (sh?.action === "learn") startLoop() // animate the growing preview edge
    }
  }
  function onPointerMove(p) {
    lastP = p
    if (dayEnding) {
      // the end-of-day screen owns the pointer — only the wake button reacts
      document.body.style.cursor = renderer.wakeHit(p) ? "pointer" : "default"
      scheduleRender()
      return
    }
    if (replaying) return // locked during replay

    // the radial menu grabs the pointer first — a learnable skill slot on the
    // ring takes precedence (it previews the lesson cost on the clock), else the
    // badge under the pointer gets focus. The menu is VIEWPORT-anchored, so its
    // hover stays LIVE even mid-walk (pending); and because the WORLD also glides
    // under a STILL pointer during a walk (no pointermove fires then), the tick
    // loop re-aims this same hover once per frame — see updateMenuHover.
    // Only the WORLD hover below is stale during a move, so the pending lock
    // sits after this branch.
    if (menuOpen) {
      updateMenuHover(p)
      document.body.style.cursor = p.y <= HEADER_H ? "default" : "none"
      scheduleRender() // follow the pointer (our dot) + refresh focus/name/cost preview
      return
    }
    if (pending) return // WORLD hover is stale while a timed action runs — locked

    // over an on-screen quick button (sleep/gather): it owns the pointer (its own
    // hover label, like a menu badge) — no tile readout underneath it
    if (renderer.quickHit(p)) {
      if (hovered || hoverPath) (hovered = hoverPath = null), (hoverIllegal = false)
      document.body.style.cursor = "none"
      scheduleRender()
      return
    }

    // FREE-CAM: a press that travels past the threshold becomes a board DRAG —
    // pan the camera by the frame delta and suppress the tile hover/aim underneath
    if (worldPress && freeCam && downP) {
      if (!dragged && Math.hypot(p.x - downP.x, p.y - downP.y) > DRAG_THRESH) {
        dragged = true
        dragPrev = p // start the pan from HERE, so it doesn't lurch by the threshold
      }
      if (dragged) {
        renderer.panBy(p.x - dragPrev.x, p.y - dragPrev.y)
        dragPrev = p
        if (hovered || hoverPath) (hovered = hoverPath = null), (hoverIllegal = false)
        document.body.style.cursor = "grabbing"
        scheduleRender()
        return
      }
    }

    renderer.setFrame(api.layout)
    const size = renderer.sizeFor()
    const { q, r } = renderer.pixelToHex(api.layout, p.x, p.y, size)
    const h = sim.kindOf([q, r]) ? [q, r] : null
    const v = sim.view()
    // recompute the path every move (the BFS is cheap) — the tile under a
    // stationary pointer can change state, so "same tile" ≠ "same path"
    let np = null
    let illegal = false
    if (h && !eq(h, v.player)) {
      // every reachable tile previews its shortest route — a tile behind you on
      // the trail is no different, you just walk (back) to it, recording the steps.
      // Show the route even when unaffordable (ghosted) so you can see the way
      // before you can pay for it.
      np = sim.routeTo(h)
      illegal = !!np && !sim.canMove(h)
      // impassable ground (water) has no route — still show the WAY there:
      // the best approach through a walkable neighbour plus the final step,
      // ghosted illegal (same muted-red as an unaffordable route, for now)
      if (!np && sim.isDiscovered(h) && sim.landAt(h)?.impassable) {
        let best = null
        let bestCharge = Infinity
        for (const n of Hex.neighbors(h)) {
          if (!sim.isDiscovered(n)) continue
          const p2 = sim.routeTo(n)
          if (!p2) continue
          const c2 = sim.pathCharge(p2)
          if (c2 < bestCharge) {
            bestCharge = c2
            best = p2
          }
        }
        if (best) {
          np = [...best, h]
          illegal = true
        }
      }
    }
    const sig = pth => (pth ? `${pth.length}:${key(pth[0])}:${key(pth[pth.length - 1])}` : "")
    if (
      (h ? key(h) : null) !== (hovered ? key(hovered) : null) ||
      sig(np) !== sig(hoverPath) ||
      illegal !== hoverIllegal
    ) {
      hovered = h
      hoverPath = np
      hoverIllegal = illegal
    }
    // hide the OS cursor over the world (our dot stands in for it); the header
    // keeps the normal cursor. Redraw every move so the dot follows.
    document.body.style.cursor = p.y <= HEADER_H ? "default" : "none"
    scheduleRender()
  }

  function onPointerDown(p) {
    worldPress = false
    // the end-of-day screen is modal: only "wake up" is live
    if (dayEnding) {
      if (renderer.wakeHit(p)) wakeUp()
      return
    }
    // the logs live top-left under the title and only while the menu is open — a
    // click on that strip toggles the full log open/closed
    if (menuOpen && p.x <= 300 && p.y > HEADER_H && p.y <= HEADER_H + 26) {
      logsOpen = !logsOpen
      api.requestRender()
      return
    }
    if (p.y <= HEADER_H) return // the rest of the top status line is inert text now
    if (pending || replaying) return // input is locked
    // an on-screen quick button (lower-right, menu closed): run it in one click.
    // rest is instant; gather is a timed in-place action (same wait loop as the menu)
    const qb = !menuOpen && renderer.quickHit(p)
    if (qb) {
      if (qb === "rest") beginSleep()
      else if (qb === "gather") {
        const gi = sim.gatherInfo()
        if (gi) startTimed({ type: "gather" }, "gathering", gi.cost)
      }
      api.requestRender()
      return
    }
    if (menuOpen) {
      // a hit on the ring: the SIGN runs learn/teach in place (menu stays up so
      // the ring updates and you can take another); the glyph's reference now
      // rides its hover label, so a glyph click is inert.
      const sh = renderer.skillHit(p)
      if (sh) {
        if (sh.kind === "action" && sh.action) {
          act({ type: sh.action, skill: sh.skill })
          // the lesson/gift may have used up the button (you reached the teacher,
          // or the cap) — drop the now-stale hover so it doesn't cling to a
          // vanished button (no pointer move will arrive to clear it)
          if (skillHover?.kind === "action" && !skillActionable(skillHover.skill)) skillHover = null
        }
        api.requestRender()
        return
      }
      // a badge: a folder toggles its fan-out; a leaf RUNS and the ring STAYS UP
      // (stash, gather, build… — chain as many as you like). Only a click back on
      // the player tile dismisses the menu. (`closeMenu` nodes still close, e.g.
      // sleep, which hands off to the end-of-day screen.)
      const hit = renderer.menuHit(p)
      if (hit) {
        if (hit.node.children) {
          menuOpenId = menuOpenId === hit.id ? null : hit.id
        } else if (!hit.node.disabled && hit.node.run) {
          hit.node.run()
          hovered = hoverPath = null, hoverIllegal = false // the action may have changed the view
          if (hit.node.closeMenu) closeMenu()
          else if (pending) (menuFocusId = null), (skillHover = null) // a walk/wait began — the click consumed the label
          else menuFocusId = hit.id // keep the ring up
        }
        api.requestRender()
        return
      }
      // only a click back on the PLAYER tile dismisses the menu (the same spot
      // that opened it); anywhere else is inert — a miss doesn't close it
      renderer.setFrame(api.layout)
      const size = renderer.sizeFor()
      const { q, r } = renderer.pixelToHex(api.layout, p.x, p.y, size)
      if (eq([q, r], sim.view().player)) {
        closeMenu()
        api.requestRender()
      }
      return
    }
    // a press on the world (menu closed): don't act yet — arm it, and record the
    // tile it landed on. You can press, drag your finger to aim (the trail
    // previews under it), and the tile action fires on RELEASE.
    worldPress = true
    downP = dragPrev = p // free-cam: arm the tap/drag test from here
    dragged = false
    renderer.setFrame(api.layout)
    const size = renderer.sizeFor()
    const { q, r } = renderer.pixelToHex(api.layout, p.x, p.y, size)
    downTile = sim.kindOf([q, r]) ? [q, r] : null
  }

  // The tile action lands on RELEASE, at whatever tile the pointer lifts over —
  // so a drag-to-aim commits on lift. Chrome (header, replay, menu) acted on the
  // press and left worldPress false, so those releases do nothing here.
  function onPointerUp(p) {
    if (!worldPress) return
    worldPress = false
    // a free-cam DRAG was a pan, not a tap — consume the release, act on nothing
    const wasDrag = dragged
    dragged = false
    downP = dragPrev = null
    if (wasDrag) {
      document.body.style.cursor = "none"
      return
    }
    if (!p || p.y <= HEADER_H || pending || replaying) return
    renderer.setFrame(api.layout)
    const size = renderer.sizeFor()
    const { q, r } = renderer.pixelToHex(api.layout, p.x, p.y, size)
    const t = [q, r]
    if (!sim.kindOf(t)) return // beyond the field
    const v = sim.view()

    if (eq(t, v.player)) {
      // lifting on the player opens the radial menu ONLY if the press started
      // there too; a drag that started elsewhere and ends on the player cancels
      if (downTile && eq(downTile, v.player)) {
        menuOpen = true
        menuOpenId = menuFocusId = null
        api.requestRender()
      }
      return
    }
    if (sim.isFrontier(t)) {
      // adjacent unknown tile (perimeter included) → scout it rather than move
      if (sim.canScout(t)) startScout(t)
      return
    }
    if (sim.canMove(t)) startMove(t) // walk (or back) to any reachable tile; crossing a seam is just the last step
  }

  // ── screen lifecycle ───────────────────────────────
  function enter(a) {
    api = a
    hovered = hoverPath = null, hoverIllegal = false
    try {
      freeCam = localStorage.getItem("thrive-freecam") === "1"
    } catch {}
    renderer.setFreeCam(freeCam)
  }

  function leave() {
    stopLoop()
    stopReplay()
    pending = null // atomic waits: an abandoned action never happened
    dayEnding = false
    menuOpen = false
    menuOpenId = menuFocusId = null
    worldPress = dragged = false
    downP = dragPrev = null
    document.body.style.cursor = "default"
  }

  function draw(ctx, L) {
    // While a timed action is in transit the pointer is locked (onPointerMove
    // bails), so any hover route is STALE — and drawn at hex coords it would slide
    // along with the map under the still cursor. Drop it; it refreshes on landing.
    const inTransit = !!pending
    renderer.draw(ctx, L, {
      hovered: inTransit ? null : hovered,
      hoverPath: inTransit ? null : hoverPath,
      hoverIllegal: inTransit ? false : hoverIllegal,
      skillHover: menuOpen ? skillHover : null, // hovered skill slot → name label + reference + cost preview
      pointer: dayEnding ? null : lastP && lastP.y > HEADER_H ? lastP : null, // our custom cursor dot (hidden over the header)
      logsOpen, // logs only render while the menu is open (see render)
      replaying,
      menu: menuOpen ? menuSpec() : null,
      card: infoCard(), // land / figure / place — always shown, top-right
      restBtn: !dayEnding && sim.atRestSpot() && !menuOpen, // an on-screen rest button when you can rest
      gatherBtn: !dayEnding && !menuOpen && sim.canAct({ type: "gather" }), // …and a gather button when the tile yields
      dayEnd: dayEnding ? { day: sim.day(), pointer: lastP } : null, // the end-of-day sleep screen
      pending: pendingView()
    })
    // keep frames coming while the camera glides to its new anchor, or the skill
    // ring eases between the sky teardrop and the menu's circle. MUST go through
    // scheduleRender's single-flight gate: a raw rAF here would add one whole new
    // self-perpetuating draw chain per external render request (every pointer move
    // during an animation), multiplying full draws per frame until the UI crawls.
    if (renderer.camAnimating() || renderer.menuAnimating()) scheduleRender()
  }

  const screen = {
    id: "hexgrid",
    enter,
    leave,
    onPointerMove,
    onPointerDown,
    onPointerUp,
    onDoubleClick() {},
    draw
  }
  return screen
}
