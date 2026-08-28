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
import { easeSplit } from "./draw.js"
import { createSim, BIOME_SKILL, RECIPES, BUILDS, RAFT_DEBRIS } from "./sim.js"
import { createRenderer, npcName } from "./render.js"
import { npubEncode } from "./vendor/nostr-nip19.js"
import { savedProfile, lookupProfile } from "./identity.js"
import { CubeScreen } from "./cube.js"

const TIME_SCALE = 1000 // real ms of wait per simulated minute at speed ×1 (the unhurried pace)
const WAIT_SPEED = 60 // fast-forward factor for now; a future upgrade raises this so the
// real-time wait shrinks while the simulated cost stays the same
const MS_PER_MIN = TIME_SCALE / WAIT_SPEED // real ms per simulated minute — fast, but still live
// A tile's crossing time comes from ITS OWN charge and nothing else — the same
// ground always takes the same time, however long the trip. The map is the SQUARE
// ROOT-ish of the charge, not the charge itself: real costs span ~36× (a beach at
// 2, a peak at 72), and taken literally one mountain step would sit there for six
// seconds. The curve keeps the ORDER and the felt difference (a peak still reads
// several times a beach) inside a watchable range. No route-length cap — that
// would make the same tile fast on a long walk and slow on a short one.
// THE THREE KNOBS:
//   UNIT  — ms for the cheapest ground (charge 1: home paths, seam roads). The
//           overall pace; everything scales with it.
//   CURVE — how sharply cost maps to time. 1 = literal (a peak would sit for six
//           seconds), 0.5 = square root (flat, everything feels similar). 0.6
//           keeps a peak ~9x a home path while staying watchable.
//   STEP_MIN — a hard floor, so nothing ever flickers past.
const MOVE_MS_UNIT = 130
const MOVE_MS_CURVE = 0.6
const MOVE_MS_STEP_MIN = 150 // a lone step never dips under the tuned brisk pace
const MOVE_EASE_IN = 0.28 // a SINGLE tile keeps the tuned quad: short in, long out
// A move that SHIFTS the view to another board slides the camera a whole board
// width — far more travel than a step inside a board, at the same duration it
// would whip. Add time for how far the camera actually goes (the board-centre
// shift, in tiles), so cube + camera still land together but a crossing reads.
const MOVE_MS_PER_SHIFT_TILE = 30 // extra ms per tile of board-centre travel
const MOVE_MS_SHIFT_MAX = 420 // …but the crossing add never itself drags
const REPLAY_MS = 220 // ms between replayed actions
const DRAG_THRESH = 6 // px a press must travel (free-cam) before it counts as a board drag, not a tap

const eq = Hex.equals
const key = Hex.key

// ── the save (localStorage mirror of sim.serialize(); nostr rides this later) ──
const SAVE_KEY = "anon&mato:save"

// The pointer over the world (and the menu) is our OWN dot, drawn on the canvas
// (see render.js) with the OS cursor hidden — full control, theme-aware, room to
// restyle later. The header keeps the normal cursor as clickable chrome.
// The top strip is CHROME: the world doesn't take taps up there (the bar's own
// buttons have already had their say by then). It has nothing to do with the
// cursor any more — the dot is the cursor over chrome and world alike.
const HEADER_H = 24

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
  const liveSim = sim // …and the one true game, kept while `sim` looks at the past
  const renderer = createRenderer(sim)

  // ── LOOKING BACK ────────────────────────────────────────────────────
  // The save IS the log, so every past moment is a PREFIX of it. Browsing one
  // hydrates a SCRATCH sim to that prefix and points both this controller and
  // the renderer at it — `sim` is a binding, so every read in this file follows
  // in one move. The live game is not touched, and cannot be: `act` refuses
  // while we're looking, so nothing dispatches and nothing is ever persisted
  // from the past. Coming back is just pointing the binding home again.
  const ENDERS = new Set(["rest", "goHome"]) // …what a day ends with
  // THE DIP between days — a value the renderer paints over the WORLD (and only
  // the world: the bar and the corners never blink). Out over VEIL_MS, the swap
  // at the dark, back in over VEIL_MS. Replay does NOT use it: a loop that
  // flashed every time it came round would be unwatchable.
  const VEIL_MS = 200
  let veilFrom = 0 // when the current leg started
  let veilDir = 0 // 1 = going dark, -1 = coming back, 0 = no dip
  const veiling = () => veilDir !== 0
  function veil() {
    if (!veilDir) return 0
    const u = Math.min(1, (performance.now() - veilFrom) / VEIL_MS)
    return veilDir > 0 ? u : 1 - u
  }
  const holdVeil = (dir, ms) =>
    new Promise(res => {
      veilDir = dir
      veilFrom = performance.now()
      startLoop()
      setTimeout(res, ms)
    })
  async function dipThrough(swap) {
    await holdVeil(1, VEIL_MS)
    try {
      await swap()
    } finally {
      await holdVeil(-1, VEIL_MS)
      veilDir = 0
      api.requestRender()
    }
  }
  let browse = null // { day, at, acts } — the moment we're looking at, or null for now
  let browseBusy = false
  let playTimer = 0 // the replay loop's tick, or 0 when it isn't running

  // The day's DOINGS — everything it did, minus the sleeping that ended it. This
  // is the range a replay loops over, and the end of it is where "the end of the
  // day" lands: the last moment the day was still being lived.
  function dayActs(day) {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || "null")
    const banked = raw?.days || []
    const acts = day <= banked.length ? banked[day - 1].actions : raw?.today?.actions || []
    const last = acts.length - 1
    return { raw, banked, acts: last >= 0 && ENDERS.has(acts[last].type) ? acts.slice(0, last) : acts.slice() }
  }

  // Look at `day` as it was after `at` of its actions. The swap happens behind a
  // DIP (app.js) — the clock and the map you're on fade out, the day you asked
  // for fades in — because a day is not a place you walk to. Nothing here is the
  // end of a day: no sweep, no sleep, no wake button. You are looking, not
  // living, and the way back is the day list.
  async function browseTo(day, at, { dip = true, stop = true } = {}) {
    if (browseBusy) return
    if (stop) stopPlay()
    browseBusy = true
    pending = null // nothing is in flight in the past
    menuOpen = false
    const { raw, banked, acts } = dayActs(day)
    if (!raw) return ((browseBusy = false), undefined)
    const take = acts.slice(0, at == null ? acts.length : Math.max(0, at))
    const swap = async () => {
      try {
        const s = createSim({ angle, pubkey, worldKey })
        const r = await s.hydrateProgressive({ ...raw, days: banked.slice(0, day - 1), today: { day, actions: take } })
        if (!r.ok) return console.warn("cannot look back:", r.reason)
        browse = { day, at: take.length, acts }
        sim = s
        renderer.setSim(s)
      } catch (e) {
        console.warn("cannot look back:", e)
      }
    }
    await (dip ? dipThrough(swap) : swap()) // only a DAY CHANGE dips; stepping within one doesn't
    browseBusy = false
    api.requestRender()
  }
  const browseDayEnd = day => browseTo(day, null)
  function browseNow() {
    stopPlay()
    return dipThrough(() => {
      browse = null
      sim = liveSim
      renderer.setSim(liveSim)
      pending = null
    })
  }

  // ── REPLAY ──────────────────────────────────────────────────────────
  // The past can't be played, only WATCHED — so watching is the thing the button
  // does. It runs the day's actions on from wherever you're standing, one every
  // REPLAY_MS, and when the day runs out it starts it again from the morning:
  // a loop, because a day you're studying is one you want to see twice.
  // (Not browsing? Then it's today being asked for, from its own beginning.)
  // REPLAY MODE — entered from a log entry, which is the moment it starts at.
  // The day line becomes the transport; the day list is put away. Leaving it
  // comes home to the living game.
  let replayMode = false
  function enterReplay(i) {
    replayMode = true
    daysOpen = false
    browseTo(browse ? browse.day : liveSim.day(), Math.max(0, i - 1), { dip: false })
  }
  function exitReplay() {
    replayMode = false
    stopPlay()
    if (browse) browseNow()
    else api.requestRender()
  }
  // one step on is just the next action played; one step BACK has to be rebuilt
  // from the log, because an action is not a thing you can un-run
  function stepOn() {
    if (!browse) return
    const next = browse.acts[browse.at]
    if (!next) return
    const r = sim.dispatch(next)
    if (!r.ok) return console.warn("replay stopped:", r.reason, next)
    browse.at++
    api.requestRender()
  }
  const stepBack = () => browse && browse.at > 0 && browseTo(browse.day, browse.at - 1, { dip: false, stop: false })

  function togglePlay() {
    if (playTimer) return stopPlay()
    if (!browse) return browseTo(liveSim.day(), 0).then(() => browse && stepPlay())
    stepPlay()
  }
  function stopPlay() {
    if (playTimer) clearTimeout(playTimer)
    playTimer = 0
    api?.requestRender()
  }
  function stepPlay() {
    playTimer = setTimeout(async () => {
      playTimer = 0
      if (!browse) return
      const next = browse.acts[browse.at]
      if (!next) {
        await browseTo(browse.day, 0, { dip: false, stop: false }) // …and round again from the morning
        if (browse) stepPlay()
        return
      }
      const r = sim.dispatch(next) // the SCRATCH sim: it logs, and nothing persists
      if (!r.ok) return console.warn("replay stopped:", r.reason, next)
      browse.at++
      api.requestRender()
      stepPlay()
    }, REPLAY_MS)
  }

  // every state change goes through here: dispatch, then mirror to storage
  // (the menu never opens itself — it's always a click on the player)
  const act = a => {
    if (browse) return { ok: false, reason: "looking back" } // the past is read-only
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
  let itemHover = null // the pack chip the pointer is over (lower-left) → its full readout
  let groundHover = null // …and WHICH BOX of the tile's row (by index) the pointer is over
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
  let daysOpen = false // is the list of played days unrolled under the day cell?
  let dayHover = null // …and which of its rows is under the pointer
  let logHover = null // …and which log row is
  let logsOpen = false // is the day unrolled under the title bar? (collapsed: the bar itself carries the latest entry)
  let logScroll = 0 // how far down that list we've wheeled, in whole rows (0 = newest)
  let helpersOpen = false // …and the helpers list under the TITLE. ONE bar menu
  // at a time (2026-08-10): opening any of the three closes the other two.
  let helperHover = null // the helper row under the pointer, or null
  let menuOpen = false // the radial menu around the player
  let menuSkill = null // the FOCUSED skill (its glyph at the centre, its actions fanned) — null = the ring
  let menuOpenId = null // the expanded folder's id (one at a time), or null
  let menuFocusId = null // the badge under the pointer (shows its label), or null
  let dayEnding = false // true while the end-of-day (sleep) screen is up — the day banks on WAKE, not on sleep
  let nightRun = false // WAKE clicked: the sweep to midnight is playing; the day banks when it lands
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
    const animating = pending || veiling() || renderer.waking() || (menuOpen && skillHover?.action === "learn")
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

  // `cam` marks a CONTROLLED travel (go home, teleport): the camera re-aims and
  // follows it the whole way. A plain tile click never asks that — the camera
  // keeps its board-anchored composure (and free-pan keeps whatever you framed).
  function startMove(target, { via = null, cam = false } = {}) {
    const path = via || sim.routeTo(target)
    if (!path) return
    const totalMin = sim.pathCharge(path) // what the sim will actually deduct (home flat, seams half-price)
    // PER-TILE PACING: every step gets its OWN duration from the charge of the
    // tile it enters, so a walk is felt ground by ground — marsh and mountain
    // drag, home's flat paths and the seam roads fly — instead of one averaged
    // glide. (pathCharge over a single pair IS that tile's own charge.)
    const segMs = []
    for (let i = 1; i < path.length; i++)
      segMs.push(Math.max(MOVE_MS_STEP_MIN, MOVE_MS_UNIT * Math.pow(sim.pathCharge([path[i - 1], path[i]]), MOVE_MS_CURVE)))
    const walkMs = segMs.reduce((a, b) => a + b, 0)
    // …plus time for a board SHIFT: how far the camera slides to frame the end
    // board. Within one board this is 0 (the view holds still); across a seam it
    // trails the walk so the whole-board slide doesn't whip past — the cube lands,
    // then the world finishes settling under it.
    // THE WAY HOME, SOLVED ONCE — from the tile we'll LAND on, before a step is
    // taken. It used to be re-solved every frame from the moving ghost, and
    // homePathFrom is a full Dijkstra (heap and all) over discovered ground: on a
    // well-explored map that per-frame solve is what made a long walk stutter.
    // Held for the whole transit and simply replayed; on arrival it is already
    // exactly the route from where we stand, so nothing snaps.
    const homeAfter = sim.homePathFrom(target)
    // off the ROUTE, not the destination — a sail ends in the water, where the
    // way home is the wade-out or the raft under you, and the destination alone
    // reads Infinity (which the clock would draw as no way home at all)
    const retAfter = sim.retAfterPath(path)
    let totalMs = walkMs
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
      segMs,
      walkMs,
      totalMs,
      totalMin,
      homeAfter,
      retAfter,
      cam, // controlled travel → the renderer recentres and follows
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
    let raftPos = null
    if (p.path) {
      // walk the PER-TILE table: constant speed while crossing a tile, changing at
      // every boundary — that step-to-step change IS the terrain being felt. Only
      // the ends are eased: you push off from rest and settle into the last tile,
      // so the honest middle isn't smeared by a whole-route curve.
      const last = p.segMs.length - 1
      let t = Math.max(0, Math.min(p.elapsed, p.walkMs))
      let s = 0
      while (s < last && t >= p.segMs[s]) {
        t -= p.segMs[s]
        s++
      }
      let frac = p.segMs[s] > 0 ? Math.max(0, Math.min(1, t / p.segMs[s])) : 1
      // The ends are eased so you push off from rest and settle at the end, but
      // the curves LAND ON THE CRUISE SPEED (velocity 1 where they meet the middle)
      // — so there's no lurch at the first or last boundary, and the honest
      // per-tile middle is untouched. A lone step has no middle to protect, so it
      // keeps the tuned asymmetric quad: short in, long soft out.
      if (last === 0) frac = easeSplit(frac, MOVE_EASE_IN)
      else if (s === 0) frac = frac * frac * (2 - frac) // rest → cruise
      else if (s === last) {
        // cruise → rest, but the settle is CLIPPED to the tail of the last tile:
        // with per-tile pacing the walk is already varied, so a full-tile glide
        // out read as drifting. Cruise on to SETTLE, then ease down over what's
        // left — the arrival stays soft without stretching.
        const SETTLE = 0.55 // fraction of the last tile spent at cruise before easing
        frac =
          frac < SETTLE
            ? frac
            : SETTLE + (1 - SETTLE) * (u => u * (2 - u))((frac - SETTLE) / (1 - SETTLE))
      }
      const dist = s + frac // distance along the path, in tiles
      // ghostTile (ceil) is the tile being ENTERED — camera + border track it so a
      // board crossing hands off cleanly. The DRAWN position is continuous below.
      ghostTile = p.path[Math.min(Math.ceil(dist), p.path.length - 1)]
      // the glide: lerp within the current segment so the cube slides from tile to
      // tile instead of teleporting. Axial→pixel is linear, so this walks a
      // straight line between tile centres. (`s` and `frac` come from the table
      // walk above — the segment we're crossing and how far into it.)
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
      // THE RAFT TRAVELS UNDER YOU — live, not on arrival. The sim only learns
      // the move when the walk lands, so mid-sail its mooring is a tile behind:
      // replay the raft along the SETTLED steps the way the sim itself will
      // (viaValid's rule) — board it where the path touches its mooring, carry
      // it while the steps stay on water (shallows included, not just rivers),
      // leave it where they step ashore. (This used to key on aboard() AT
      // DEPARTURE, so a long travel that walked to the raft and boarded
      // mid-path never moved it: the hull sat on its old tile until arrival.)
      let rp = sim.raftAt()
      if (rp) {
        for (let i = 1; i <= s; i++) if (eq(p.path[i - 1], rp) && sim.navWater(p.path[i])) rp = p.path[i]
        const b2 = p.path[s + 1]
        // aboard on the live segment, headed onto water → the hull rides the glide
        raftPos = eq(rp, p.path[s]) && b2 && sim.navWater(b2) ? ghostPos : rp
      }
    }
    return {
      verb: p.verb,
      target: p.target,
      ghostTile,
      ghostPos,
      ghostTrail,
      raftPos, // where the raft is DURING the walk (it moves with you) — see above
      moveMs: p.path ? p.totalMs : 0, // the camera borrows this duration so a crossing glides in step
      cam: !!p.cam, // controlled travel (go home / teleport) — the camera re-aims and follows
      // the pre-solved way home from the destination — no routing while in transit
      homePath: p.homeAfter ?? null,
      ret: p.retAfter ?? null,
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
    // (SLEEP and PLAY left the ring on 2026-08-10 — they're the two CORNER
    //  BUTTONS now, always on screen: sleep lower-left, play lower-right. No
    //  menu needed for either. See the renderer's corner buttons.)
    if (sim.canEnter()) self.push({ id: "enter", icon: "enter", label: "enter", run: () => act({ type: "enter" }) })
    // (GATHER was a node here — removed 2026-08-08, with the rest of the works.
    //  Picking a thing up stops being a decision you take through a menu: what a
    //  tile yields will simply arrive in the pile at the bottom of the screen,
    //  where everything you carry already lives. The sim's `gather` action is
    //  untouched — nothing in the menu calls it right now.)
    // (RAFT/TELEPORT/EAT/COOK left the ring on 2026-08-10 — SKILLS ARE THE
    //  CATEGORIES now: each lives behind its skill's glyph (build, travel,
    //  cook). See skillActions below, and the menuSkill focus mode.)
    // (COMMISSION was a node here — removed 2026-08-08. Crafting stops being a
    //  service you buy from a stranger: the figures are to be CONTROLLED, and
    //  what they make will come from that. The sim's `craft` action is untouched;
    //  nothing in the menu commissions anything now.)
    // (BUILD CAMP was a node here — removed 2026-08-03. The build action itself
    //  is untouched in the sim; nothing in the menu raises one right now.)
    // (DROP / TAKE are not menu items — moving a thing between your back and
    //  the ground is done in the CORNERS: double-click a box in the lower-left
    //  to put it down, one in the lower-right to pick it up. See onDoubleClick.)
    // your skills live on the clock ring; land/figure info is on the top-right
    // card. GO HOME left the ring on 2026-08-08: home is a place, not a verb, so
    // the way back is the home TILE itself — on screen when it's on screen, and
    // pinned to the edge in its own direction when it isn't. See homeMark in
    // render.js, and onPointerDown, which walks you there when you click it.
    // (the helpers folder used to sit here — it read as a game action among game
    //  actions, which it never was. They're a list under the TITLE now; see
    //  helperSpec, and render's top-left stack.)
    // the ring's right side is unused for now — land/figure facts live on the card
    // A FOCUSED SKILL takes over: its glyph moves to the player's centre, the
    // ring hides, and ITS actions are the radial hexes (nothing else fans)
    if (menuSkill) return { self: skillActions(menuSkill), them: [], openId: menuOpenId, focusId: menuFocusId, skill: menuSkill }
    return { self, them: [], openId: menuOpenId, focusId: menuFocusId, skill: null }
  }

  // SKILLS ARE THE CATEGORIES (2026-08-10): what each skill OFFERS right now,
  // built fresh like the menu itself. Clicking an openable glyph on the ring
  // focuses the skill (menuSkill) and these fan around the player as hexes.
  //   cook   → eat what you carry (anywhere) + cook it into meals (at a hearth)
  //   craft  → make the raft (on water, paid in hauled debris)
  // The rest answer with nothing yet — their glyphs stay reference-only.
  function skillActions(skill) {
    const v = sim.view()
    const out = []
    if (skill === "cook") {
      for (const e of sim.eatList())
        out.push({
          id: "eat-" + e.k,
          icon: "gather",
          label: `eat ${e.k} · +${e.food}m · ${e.cost}m`,
          disabled: !sim.canAct({ type: "eat", item: e.k }),
          cost: e.cost, // → the clock's hover estimate (in-place)
          high: true,
          run: () => act({ type: "eat", item: e.k })
        })
      if (sim.atRestSpot())
        for (const c of sim.cookList())
          out.push({
            id: "cook-" + c.k,
            icon: "cook",
            label: `cook ${c.k} · meal +${c.food}m · ${c.cost}m`,
            disabled: !sim.canAct({ type: "cook", item: c.k }),
            cost: c.cost,
            high: true,
            run: () => startTimed({ type: "cook", item: c.k }, "cooking", c.cost)
          })
    }
    if (skill === "craft") {
      // EVERYTHING YOU COULD MAKE IS LISTED (2026-08-28), whether or not you
      // can make it here: a category that hides its contents can't teach them.
      // What's out of reach greys out and SAYS WHY on its hover, along with
      // what it takes and what it costs in minutes.
      const rp = sim.raftPlan() // null off the water — the plan itself is the "are you on it?"
      const short = rp ? Math.max(0, rp.needs - rp.have) : RAFT_DEBRIS
      const why = !rp
        ? "only on river shores"
        : rp.built
          ? "you already have one"
          : short > 0
            ? `needs ${short} more debris here`
            : null
      out.push({
        id: "raft",
        icon: "raft",
        label: "raft",
        // the hover's own readout: what it takes, what it costs, and the
        // reason it's greyed when it is
        lines: [
          { cells: [{ text: "raft" }] },
          { text: `${RAFT_DEBRIS} debris, dropped here`, alpha: 0.6, small: true },
          { text: "no minutes — the haul is the cost", alpha: 0.6, small: true },
          ...(why ? [{ text: why, alpha: 0.9, small: true, color: "#c0433a" }] : [])
        ],
        disabled: !sim.canAct({ type: "raft" }),
        run: () => act({ type: "raft" })
      })
    }
    // (TELEPORT left the ring on 2026-08-28 — the minimap trip is out of the
    //  menu entirely; the sim's move action is untouched.)
    return out
  }

  // THE HELPERS — dev and comfort switches, not moves in the game. They hang off
  // the TITLE (the bar's own name cell), the way the log hangs off the clock: one
  // list of plain rows, click one to run it. Same shape as a menu node minus the
  // ring: { id, label, run }.
  function helperSpec() {
    return [
      // PLAYGROUND — the home centre's other door. It was a corner button;
      // it's a line in the title's list now (2026-08-10), where the rest of
      // the things that aren't moves already live.
      { id: "cube", label: "playground", run: enterCube }, // …from anywhere (2026-08-28 — it was gated on the home centre)
      { id: "restResume", label: "rest and resume", run: () => act({ type: "restResume" }) },
      { id: "freecam", label: freeCam ? "camera: free" : "camera: follow", run: toggleFreeCam },
      { id: "theme", label: "theme", run: toggleTheme },
      { id: "clearBoard", label: "clear board", run: () => act({ type: "clearBoard" }) },
      { id: "clearMap", label: "clear map", run: () => act({ type: "clearMap" }) },
      { id: "reset", label: "reset everything", run: doReset }
    ]
  }

  // the player card, top-right: land facts — or, standing ON a figure (a
  // board's centre), the same board/figure overview the centre's hover
  // shows. Shown while the menu is open (see render — ui.card).
  // WHO YOU ARE, for the lower-left corner. The NAME is what stands there — not
  // the key, which nobody reads — and the rest (npub, pubkey, relays, follows)
  // rides a hover label, the way every other fact in this game does. With no
  // profile found it says so, and says it as an invitation: clicking asks the
  // relays again. (The lookup lives in identity.js; setup uses the same one.)
  let profileBusy = false
  // THE FACE, loaded once and kept. The renderer only draws; fetching belongs
  // here, where there's an api to ask for a repaint when the bytes land. No
  // crossOrigin: most picture hosts send no CORS headers, and a face we can
  // draw beats a clean canvas (app.js's fade copes with the taint).
  let picUrl = null
  let picImg = null
  function faceFor(url) {
    if (!url) return null
    if (url !== picUrl) {
      picUrl = url
      picImg = null
      const img = new Image()
      img.onload = () => {
        if (picUrl === url) picImg = img
        api?.requestRender()
      }
      img.onerror = () => {
        if (picUrl === url) picImg = null
      }
      img.src = url
    }
    return picImg
  }
  function meBlock() {
    if (!pubkey) return null
    const np = npubEncode(pubkey)
    const p = savedProfile(pubkey)
    const shown = v => (v === undefined ? "…" : v === false ? "—" : v)
    return {
      name: profileBusy ? "looking…" : p?.name || "profile not found",
      found: !!p?.name,
      pic: faceFor(p?.picture || null), // an <img> once it has loaded, else null
      rows: [
        ["npub", `${np.slice(0, 12)}…${np.slice(-4)}`],
        ["pubkey", `${pubkey.slice(0, 12)}…${pubkey.slice(-4)}`],
        ["relays", shown(p?.relays)],
        ["follows", shown(p?.follows)]
      ]
    }
  }
  // …and asking again, which is what the corner is for when there's nothing to
  // show. One at a time; the answer is cached, so the next load has it at once.
  function refreshProfile() {
    if (profileBusy || !pubkey) return
    profileBusy = true
    api.requestRender()
    lookupProfile(pubkey).finally(() => {
      profileBusy = false
      api.requestRender()
    })
  }

  // Every day the world has been through, MOST RECENT FIRST — the row reads
  // left to right from now backwards. The day you're on isn't singled out here:
  // it sits in its own ordered place and the bar draws it as the lit one.
  function dayList() {
    const out = []
    for (let d = liveSim.day(); d >= 1; d--) out.push({ day: d, label: `day ${d}` })
    return out
  }

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
    // THE RIVER is a place too. Seam tiles carry no land facts (they're nobody's
    // board), which used to leave you standing in the water reading "you ·
    // afield". What matters here is what you can do FROM it: on foot the water
    // is a dead end you back out of; aboard the raft it's the road. It goes
    // BEFORE the safe-board check: wading out of home doesn't change which board
    // the view is on, so "home" would otherwise claim the water too.
    if (sim.onWater()) {
      const rp = sim.raftPlan()
      return {
        kind: "info",
        // the shallows are water you can only be on ABOARD — calling them "land"
        // (which the biome card would) reads as a mistake with a boat under you
        title: sim.inRiver() ? "river" : "shallows",
        subtitle: "water",
        rows: [
          ["moves", sim.aboard() ? "any shore" : "back the way you came"],
          ["raft", rp.here ? "moored here" : rp.built ? "moored elsewhere" : `${rp.have} of ${rp.needs} debris`]
        ]
      }
    }
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
    menuSkill = null
    menuOpenId = null
    menuFocusId = null
    skillHover = null
  }

  // SPACEBAR IS THE PLAYER CLICK (2026-08-10): the same and only gesture the
  // mouse has on the player tile — open the ring when it's closed, dismiss it
  // when it's up. Same locks as the pointer path (modal sleep screen, browse,
  // a walk in flight, a replay); space is swallowed even then, so it never
  // scrolls the page out from under the game.
  function onKey(e) {
    if (e.key !== " ") return false
    if (e.repeat) return true // holding space is one press, not a toggle storm
    if (dayEnding) {
      // asleep, space is WAKE — the dream's camera may have carried the wake
      // tile clean out of view, so the key always reaches the bed
      wakeUp()
      return true
    }
    if (browse || pending || replaying) return true
    if (menuOpen) closeMenu()
    else {
      menuOpen = true
      menuOpenId = menuFocusId = null
    }
    api.requestRender()
    return true
  }

  // SLEEP opens the end-of-day screen instead of banking the day outright — you
  // review the day's tally, then tap "wake up" to actually rest into the next.
  function beginSleep() {
    if (!sim.atRestSpot()) return
    dayEnding = true
    nightRun = false // the dream first; the night passes when wake is clicked
    logsOpen = false // (sleeping used to unroll the logs — the dream says it all)
    document.body.style.cursor = "none" // the dot is the cursor here too — see onPointerMove
    api.requestRender()
  }
  function wakeUp() {
    // TWO PHASES (2026-08-10): the dream held the clock at the day's last
    // minute — WAKE is what lets the night pass. First the sweep to midnight
    // plays (ui.dayEnd.leaving), and only when it lands does the day bank.
    if (nightRun) return
    nightRun = true
    api.requestRender()
    setTimeout(() => {
      nightRun = false
      wakeLand()
    }, renderer.restMs + 250)
  }
  function wakeLand() {
    if (!dayEnding) return // belt and braces: a stray second timeout must never bank another day
    dayEnding = false
    act({ type: "rest" }) // NOW the day banks and the next begins
    renderer.wake() // …and the day you lived collapses into the horizon behind you
    hovered = hoverPath = null, hoverIllegal = false
    if (lastP) onPointerMove(lastP)
    startLoop() // frames for the collapse
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
    document.body.style.cursor = "none" // ours, over everything — see enter()
    // the open helpers list picks out the row under the pointer, wherever the
    // rest of the pointer logic goes next
    const hh = helpersOpen ? renderer.helperHit(p) : null
    if ((hh?.id ?? null) !== helperHover) {
      helperHover = hh?.id ?? null
      scheduleRender()
    }
    const dh = daysOpen ? renderer.dayListHit(p) : null
    if ((dh?.day ?? null) !== dayHover) {
      dayHover = dh?.day ?? null
      scheduleRender()
    }
    const lh = logsOpen ? renderer.logRowHit(p) || (renderer.logRunHit(p) != null ? { i: renderer.logRunHit(p) } : null) : null
    if ((lh?.i ?? null) !== logHover) {
      logHover = lh?.i ?? null
      scheduleRender()
    }
    // ON CHROME — a bar button, a list row, a corner name. The world stops
    // reading tiles underneath it: the box you're pointing at is the thing you're
    // pointing at, and a hover label for the map behind it is about nowhere.
    // (The two ITEM ROWS are chrome too, but they have a hover of their OWN to
    // set — their branches are further down and return by themselves. Coming
    // through here first is what silently killed their readouts.)
    const onRows = !!renderer.itemHit(p) || !!renderer.groundHit(p)
    if (!onRows && (renderer.homeHit(p) || renderer.chromeHit(p))) {
      if (hovered || hoverPath) (hovered = hoverPath = null), (hoverIllegal = false)
      // …and the corner hovers let go too: sliding off the pack onto your name
      // (chrome, just below it) used to leave the last box lit and its label up
      if (itemHover != null || groundHover != null) (itemHover = null), (groundHover = null)
      scheduleRender()
      return
    }
    if (dh || lh) {
      // the lists own the pointer while it's on them — but the DOT still has to
      // follow it. (Rendering only when the hovered row CHANGED froze the cursor
      // the moment it entered a cell and stayed there.)
      if (hovered || hoverPath) (hovered = hoverPath = null), (hoverIllegal = false)
      scheduleRender()
      return
    }
    if (dayEnding || browse) {
      // the end-of-day screen owns the pointer — only the wake button reacts.
      // (The OS pointer never comes back: our dot IS the cursor, everywhere.)
      // The past owns it the same way: it is a picture, not a place to play.
      scheduleRender()
      return
    }
    if (hh) {
      if (hovered || hoverPath) (hovered = hoverPath = null), (hoverIllegal = false)
      scheduleRender()
      return
    }
    if (replaying) return // locked during replay

    // the PACK CHIPS own their corner (they're drawn menu-open and menu-closed
    // alike) — check them first, so an item's readout wins over the ground
    const itHit = renderer.itemHit(p)
    if ((itHit?.i ?? null) !== itemHover) {
      itemHover = itHit?.i ?? null // by BOX (its index), not by kind — one unit lights, not its siblings
      scheduleRender()
    }
    if (itHit) {
      if (hovered || hoverPath) (hovered = hoverPath = null), (hoverIllegal = false)
      scheduleRender()
      return
    }
    // …and the TILE'S pile owns the other corner, the same way
    const grHit = renderer.groundHit(p)
    if ((grHit?.i ?? null) !== groundHover) {
      groundHover = grHit?.i ?? null // by BOX, not by kind — five debris are five boxes
      scheduleRender()
    }
    if (grHit) {
      if (hovered || hoverPath) (hovered = hoverPath = null), (hoverIllegal = false)
      scheduleRender()
      return
    }

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
      scheduleRender() // follow the pointer (our dot) + refresh focus/name/cost preview
      return
    }
    if (pending) return // WORLD hover is stale while a timed action runs — locked

    // over an on-screen quick button (sleep/gather): it owns the pointer (its own
    // hover label, like a menu badge) — no tile readout underneath it
    if (renderer.quickHit(p)) {
      if (hovered || hoverPath) (hovered = hoverPath = null), (hoverIllegal = false)
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
    // THE OS CURSOR IS NEVER SHOWN — our dot stands in for it over the whole
    // window, chrome included. Redraw every move so the dot follows.
    scheduleRender()
  }

  function onPointerDown(p) {
    document.body.style.cursor = "none" // …a click that arrived without a move (touch) too
    worldPress = false
    // the two item corners swallow their own clicks: the gesture there is a
    // DOUBLE click (drop / pick up), and the world must not read the halves of
    // it as taps on the ground behind them
    if (renderer.itemHit(p) || renderer.groundHit(p)) return
    // THE BAR IS TWO BUTTONS, split where the name ends: the TITLE opens the
    // helpers, everything from the DATE forward opens the day's log. Both live at
    // all times — menu open or closed, and while you sleep — so they're checked
    // before anything else claims the pointer. Only one list at a time; they'd
    // otherwise hang over each other.
    // the corner NAMES toggle their own block — checked with the bar's buttons,
    // before anything else claims the pointer
    if (renderer.profileHit(p)) {
      refreshProfile() // ask the relays again — the facts themselves ride the hover
      return
    }
    // the replay bar, while it's up
    const bar = renderer.barHit(p)
    if (bar) {
      if (bar === "back") stepBack()
      else if (bar === "forward") stepOn()
      else if (bar === "play") togglePlay()
      else if (bar === "exit") exitReplay()
      api.requestRender()
      return
    }
    if (renderer.dayHit(p)) {
      daysOpen = !daysOpen
      if (daysOpen) (helpersOpen = false), (logsOpen = false) // one bar menu at a time
      api.requestRender()
      return
    }
    // …and a day from the row it opened into: look at the END of that day — the
    // last moment it was still being lived. The CURRENT day brings you home.
    // (The day you're already on is the button itself, handled above.)
    if (daysOpen) {
      // the HOURS BOX beside the selected day: it closes the list (keeping the
      // day you're on) and unrolls that day's log — the clock's own job, moved
      // down beside the day it belongs to (2026-08-28)
      if (renderer.daysClockHit(p)) {
        daysOpen = false
        logsOpen = true
        logScroll = 0
        api.requestRender()
        return
      }
      const d = renderer.dayListHit(p)
      if (d) {
        // …and the SELECTED day is the toggle: clicking it again simply closes
        // the list, leaving that day as the one thing standing. Clicking any
        // OTHER day picks it, and the list stays open — you came here to
        // compare, and closing after every pick would make that a chore.
        const sel = browse ? browse.day : liveSim.day()
        if (d.day === sel) {
          daysOpen = false
          api.requestRender()
          return
        }
        d.day >= liveSim.day() ? browseNow() : browseDayEnd(d.day)
        return
      }
    }
    if (logsOpen) {
      // …the REPLAY button beside the hovered entry: run the day from there
      const run = renderer.logRunHit(p)
      if (run != null) return enterReplay(run)
      // …and the entry itself: stand where the world stood just AFTER it played
      // (2026-08-10, was BEFORE: the row you clicked went dim, and the newest
      // row left you one action back in the past with the world locked and no
      // way home but the day list — it read as a freeze). Now the clicked row
      // stays lit, and on the LIVE day its newest entry IS now: that click
      // comes home.
      const r = renderer.logRowHit(p)
      if (r) {
        const day = browse ? browse.day : liveSim.day()
        if (day >= liveSim.day() && r.i >= dayActs(day).acts.length) {
          if (browse) browseNow()
        } else browseTo(day, r.i, { dip: false })
        return
      }
    }
    if (renderer.titleHit(p)) {
      helpersOpen = !helpersOpen
      if (helpersOpen) (daysOpen = false), (logsOpen = false) // one bar menu at a time
      api.requestRender()
      return
    }
    if (renderer.logsHit(p)) {
      logsOpen = !logsOpen
      if (logsOpen) (daysOpen = false), (helpersOpen = false) // one bar menu at a time
      logScroll = 0 // a fresh open always starts at the newest entry
      api.requestRender()
      return
    }
    // a helper row: run it and close the list (the toggles keep theirs open)
    const helper = helpersOpen && renderer.helperHit(p)
    if (helper) {
      const h = helperSpec().find(x => x.id === helper.id)
      if (h) {
        if (h.id !== "freecam" && h.id !== "theme") helpersOpen = false
        h.run()
      }
      api.requestRender()
      return
    }
    // THE HOME TILE, pinned at the screen's edge: clicking it is clicking home.
    // (When home is in view there's no marker — you click the tile itself, and
    // that's an ordinary move.)
    if (renderer.homeHit(p)) {
      const hp = sim.homePath()
      if (hp) startMove(hp[hp.length - 1], { cam: true }) // go home is a controlled travel — ride in frame
      return
    }
    // the end-of-day screen is modal: only "wake up" is live — and it's the
    // lower-left CORNER BUTTON now (2026-08-10), where sleep stood
    if (dayEnding) {
      if (renderer.wakeHit(p)) wakeUp()
      return
    }
    if (browse) return // the past takes no other input — it is watched, not played
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
        } else if (sh.kind === "info" && menuSkill === sh.skill) {
          // …the OPEN one is the way back out: click it again and the category
          // closes, the ring returns (2026-08-28)
          menuSkill = null
          menuOpenId = menuFocusId = null
          skillHover = null
        } else if (sh.kind === "info") {
          // a skill IS a category (2026-08-10): its glyph opens its actions —
          // the skill takes the centre, the ring gives way to its radial hexes.
          // EVERY skill opens, an empty fan included — the category exists
          // before it has contents, and finding it empty is finding that out.
          menuSkill = sh.skill
          menuOpenId = menuFocusId = null
          skillHover = null
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
        // inside a focused skill, the centre steps BACK to the ring first;
        // from the ring it closes, as ever
        if (menuSkill) {
          menuSkill = null
          menuOpenId = menuFocusId = null
        } else closeMenu()
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
    if (wasDrag) return
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
    // THE DOT IS THE CURSOR, EVERYWHERE, ALWAYS. Set here and at the top of
    // every pointer entry point rather than inside the branches that happen to
    // draw something: any early return that missed it (a menu row, a bar
    // button, a list) handed the OS arrow back, and the arrow is never right.
    document.body.style.cursor = "none"
    hovered = hoverPath = null, hoverIllegal = false
    try {
      freeCam = localStorage.getItem("thrive-freecam") === "1"
    } catch {}
    renderer.setFreeCam(freeCam)
  }

  // THE WHEEL, over the unrolled log: scroll it a row at a time, deeper into the
  // day. Returns true when it took the gesture, so the page doesn't also scroll.
  // (Nowhere else wants the wheel yet — zoom would live here.)
  function onWheel(p, dy) {
    if (!logsOpen || !renderer.logsScrollHit(p)) return false
    const step = Math.sign(dy) * Math.max(1, Math.round(Math.abs(dy) / 40))
    const next = Math.max(0, Math.min(renderer.logsMaxScroll(), logScroll + step))
    if (next !== logScroll) {
      logScroll = next
      api.requestRender()
    }
    return true // ours either way — at the ends too, or the page jumps instead
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
      itemHover, // hovered pack chip → its full readout (weight, keeping, uses, what it's for)
      groundHover, // …and the hovered box of the tile's own pile (lower-right)
      pointer: lastP, // our own cursor dot — ALWAYS, chrome and sleep screen included
      me: meBlock(), // the lower-left corner: who you are (its facts ride a hover label)
      // the days you've played, and where we're looking — see browseTo
      days: daysOpen ? dayList() : null,
      playing: !!playTimer, // …and whether the day is being watched right now
      replay: replayMode, // the transport is up, and the clock reads grey
      logDay: browse ? { acts: browse.acts, at: browse.at } : null, // the whole day, so the list never shrinks
      veil: veil(), // 0..1 — the world dimming between days (render paints it, chrome excluded)
      dayHover,
      logHover,
      browsing: browse ? { day: browse.day, at: browse.at } : null,
      today: liveSim.day(), // the LIVE day — the bar's own cell keeps it, whatever we're looking at
      logsOpen, // the day unrolled under the title bar — available at all times now
      logScroll, // …and how far down it (rows; the renderer clamps to what fits)
      helpers: helpersOpen ? helperSpec().map(h => ({ id: h.id, label: h.label })) : null, // …and the helpers under the title
      helperHover,
      replaying,
      menu: menuOpen ? menuSpec() : null,
      card: infoCard(), // land / figure / place — always shown, top-right
      // the lower-right QUICK BUTTONS (sleep / gather) are OFF (2026-08-02):
      // that corner belongs to the tile's pile now, and both actions live in
      // the menu anyway. The renderer still knows how to draw them — flip
      // these back on to bring them out of hiding.
      // THE CORNER BUTTONS (2026-08-10): sleep (lower left) wherever you can
      // rest, play (lower right) on the home centre — out of the menu, always
      // on screen. Asleep, the left one becomes WAKE (the renderer swaps it).
      // …and only after a day that HAPPENED: an empty log has nothing to sleep
      // off (the sim refuses the rest, so the button must not offer it)
      restBtn: !dayEnding && !browse && !replaying && sim.atRestSpot() && sim.log().length > 0,
      playBtn: false, // (play folded into the title's helpers as "playground" — 2026-08-10)
      gatherBtn: false,
      dayEnd: dayEnding ? { day: sim.day(), pointer: lastP, leaving: nightRun } : null, // the end-of-day sleep screen (leaving = the wake sweep is playing)
      pending: pendingView()
    })
    // keep frames coming while the camera glides to its new anchor, or the skill
    // ring eases between the sky teardrop and the menu's circle. MUST go through
    // scheduleRender's single-flight gate: a raw rAF here would add one whole new
    // self-perpetuating draw chain per external render request (every pointer move
    // during an animation), multiplying full draws per frame until the UI crawls.
    if (renderer.camAnimating() || renderer.menuAnimating() || renderer.restAnimating() || renderer.dreaming() || renderer.endSweeping() || renderer.quickPopping() || renderer.wakeFilling() || renderer.listsAnimating() || renderer.eyeMoving()) scheduleRender()
  }

  const screen = {
    id: "hexgrid",
    enter,
    leave,
    onPointerMove,
    onPointerDown,
    onPointerUp,
    onKey,
    // THE CORNERS ARE THE TRANSFER: double-click a box you're carrying to put
    // it down on this tile, or one lying on the tile to pick it up. Both are
    // instant and free; the single clicks that make up the gesture are
    // swallowed in onPointerDown so the world never sees them as taps.
    onDoubleClick(p) {
      if (pending || replaying || dayEnding) return
      const mine = renderer.itemHit(p)
      if (mine) return void act({ type: "drop", item: mine.k })
      const ground = renderer.groundHit(p)
      if (!ground) return
      // …what the tile GROWS is gathered (it takes minutes, so it waits like any
      // timed work); what has been PUT DOWN on it is simply picked back up
      if (ground.grows) {
        const gi = sim.gatherInfo()
        if (gi && sim.canAct({ type: "gather" })) startTimed({ type: "gather" }, "gathering", gi.cost)
        return
      }
      act({ type: "take" })
    },
    onWheel,
    draw
  }
  return screen
}
