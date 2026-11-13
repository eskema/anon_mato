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
import { createSim, worldKeyFor, BIOME_SKILL, RAFT_NEEDS, RAFT_MIN, SKILL_CAP, PLAYER_START, STAT_NAMES, COOK_SERVINGS, FUEL, COMBOS, cookedOf, RESOURCES, defOf } from "./sim.js"
import { createRenderer, npcName } from "./render.js"
import { voiceOf } from "./lore.js"
import { npubEncode } from "./vendor/nostr-nip19.js"
import { savedProfile, watchProfile, rememberPubkey, forgetIdentity } from "./identity.js"
import { KEYS } from "./keys.js"
import { CubeScreen } from "./cube.js"
import { AngleScreen } from "./setup/angle.js"

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
//   UNIT  — ms for the cheapest ground (charge 1: home paths, river steps). The
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
const DRAG_THRESH = 6 // px a press must travel before it counts as a board drag, not a tap

const eq = Hex.equals
const key = Hex.key

// ── the save (localStorage mirror of sim.serialize(); nostr rides this later) ──
const SAVE_KEY = KEYS.save
// THE SHELF (2026-09-02): the game you're in lives under SAVE_KEY, as ever —
// boot, persist, browsing and restore all read that one slot. Every OTHER game
// you've started is PARKED under its own key beside it, whole. Switching parks
// the live save, promotes the chosen one into the slot and reloads (the save is
// the log — reload replays it); a new game parks the live one and opens the
// angle picker with the identity kept.
const GAME_PREFIX = SAVE_KEY + ":game:"
const INTENT_KEY = SAVE_KEY + ":intent" // NEW GAME asked for from play, kept across the reboot (session only)
const gameIdOf = w => `${w.angle}:${w.worldKey || ""}`

// The pointer over the world (and the menu) is our OWN dot, drawn on the canvas
// (see render.js) with the OS cursor hidden by the page (index.html) — full
// control, room to restyle later.
// The top strip is CHROME: the world doesn't take taps up there (the bar's own
// buttons have already had their say by then). It has nothing to do with the
// cursor any more — the dot is the cursor over chrome and world alike.
const HEADER_H = 30 // the top bar strip — its box height plus the chrome margin it now stands off the edge by

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

// every game on the shelf, the live one first: { id, angle, day, current }
export function gamesList() {
  const out = []
  const cur = savedWorld()
  if (cur) out.push({ id: gameIdOf(cur), angle: cur.angle, day: cur.day, current: true })
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(GAME_PREFIX)) continue
      const save = JSON.parse(localStorage.getItem(k))
      const w = save?.world
      if (!w || typeof w.angle !== "number") continue
      out.push({ id: k.slice(GAME_PREFIX.length), angle: w.angle, day: save.today?.day ?? 1, current: false })
    }
  } catch {}
  return out
}
// park the live save on the shelf under its own key (a no-op with no save)
function parkCurrent() {
  const w = savedWorld()
  const raw = localStorage.getItem(SAVE_KEY)
  if (w && raw) localStorage.setItem(GAME_PREFIX + gameIdOf(w), raw)
}
// step into a parked game: park the live one, promote this one, reload into it
function switchGame(id) {
  try {
    const raw = localStorage.getItem(GAME_PREFIX + id)
    if (!raw) return
    parkCurrent()
    localStorage.setItem(SAVE_KEY, raw)
    localStorage.removeItem(GAME_PREFIX + id) // it's the live slot's now — a parked copy would only go stale
  } catch {
    return
  }
  window.location.reload()
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

export function HexGridScreen({ angle, pubkey: pubkey0 = null, worldKey = null, sim: preSim = null, phase: phase0 = "play" } = {}) {
  // THE PHASE (2026-09-02): the game is ONE screen, before there is a world
  // too — setup is no longer a thing of its own. "dot": nothing but the home
  // centre's mark on black; a click asks for the key. "key": the bar is up and
  // the user box asks the signer, or shows who you are. "play": the world.
  // (The angle's phase comes next.) The sim underneath the first two is a
  // placeholder — the same one the world will be built on, swapped for the
  // real one as each thing lands, the way looking back already swaps it.
  let phase = phase0
  let pubkey = pubkey0
  let sim = preSim
  if (!sim) {
    // no pre-built sim (e.g. a direct/synchronous caller): the strict path
    sim = createSim({ angle, pubkey, worldKey })
    if (phase === "play" && !loadSave(sim)) sim = createSim({ angle, pubkey, worldKey })
  }
  if (phase === "play") persist(sim) // bank the world (angle + identity + world key) immediately — a fresh pick survives reload
  let liveSim = sim // …and the one true game, kept while `sim` looks at the past
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

  // RESTORE — rewind the SAVE itself to just before a journal entry: that
  // action and everything after it (later days included) are removed, the
  // truncated log is written back, and the page reboots into the replay — you
  // stand exactly where the world stood before the cut, raft and pack and all.
  // The discarded save is kept once under ":before-restore" (paste it back
  // over the save key to undo a restore). Born of the 2026-08-31 stranding:
  // the fixed rules refuse the bad move going forward, but only a rewind can
  // put an already-lived day right.
  function restoreTo(day, keep) {
    let save
    try {
      save = liveSim.serialize()
    } catch {
      return
    }
    if (day < liveSim.day()) {
      const d = (save.days || []).find(x => x.day === day)
      if (!d) return
      save.days = save.days.filter(x => x.day < day)
      save.today = { day, actions: d.actions.slice(0, keep) }
    } else save.today = { day: save.today.day, actions: save.today.actions.slice(0, keep) }
    try {
      const cur = localStorage.getItem(SAVE_KEY)
      if (cur != null) localStorage.setItem(SAVE_KEY + ":before-restore", cur)
      localStorage.setItem(SAVE_KEY, JSON.stringify(save))
    } catch {
      return // storage blocked — better to change nothing than to half-restore
    }
    location.reload() // the boot replay takes it from here
  }
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
    // the tile we're standing on, held across the dispatch: if this action is the
    // one that clears the board, its gate opens and the wall comes down inside
    // the sim, silently. THIS is the only live path — replay and rewind dispatch
    // on their own scratch sims — so the shot is armed here and nowhere else.
    const tile = sim.view().tile
    const shut = !!tile.gate && !tile.gateOpen
    const heard = sim.notes().length // …and the firsts already written: what this action adds goes to the box
    const r = sim.dispatch(a)
    if (r.ok) {
      if (shut && tile.gateOpen) renderer.gateShot(tile.gate)
      voiceQueue.push(...sim.notes().slice(heard))
      if (phase === "play") persist(sim) // (nothing is banked before there is a world)
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
  let rowMenu = null // the open action list ON a corner box: { side: "pack" | "load", i, k }
  let rowMenuHover = null // …and which of its rows the pointer is over (by id)
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
    return them > you || (you > them && them < SKILL_CAP) // a lesson to take, or a level to give
  }
  let worldPress = false // a press landed on the world (menu closed): the tile action fires on RELEASE
  let downTile = null // the tile the press started on — the menu opens only if release matches it
  let freeCam = false // free-pan camera mode: the camera stops auto-following, and stays where you drag it
  let perfOn = false // the frame-time readout (a dev helper; stored)
  let downP = null // screen point the press landed at — to tell a tap from a drag
  let dragPrev = null // last pointer point while panning (for the frame-to-frame delta)
  let dragged = false // this press has travelled past DRAG_THRESH → it's a pan, not a tap
  let wasShut = true // the menu was all the way down at the last draw (its close had landed)
  let lastP = null // last pointer position — actions re-run hover with it, since
  // the world can change under a stationary mouse
  let daysOpen = false // is the list of played days unrolled under the day cell?
  let dayHover = null // …and which of its rows is under the pointer
  let logHover = null // …and which log row is
  let logsOpen = false // is the day unrolled under the title bar? (collapsed: the bar itself carries the latest entry)
  let logScroll = 0 // how far down that list we've wheeled, in whole rows (0 = newest)
  let voiceQueue = [] // THE INNER VOICE: firsts written and not yet read, oldest first — each waits its turn in the box
  let journalScroll = 0 // …and how far down lore's journal we've wheeled, in entries (0 = newest)
  let journalOpen = null // …and the entry of it opened in the voice's box (a first's id), or null
  // the journal holds only the firsts already READ — one still waiting in the box isn't written in yet
  const journalNotes = () => sim.notes().filter(n => !voiceQueue.some(q => q.id === n.id))
  // the journal's opened entry, while the journal is what's open: { id, day, at, lore } or null
  const journalPick = () => (menuOpen && menuSkill === "lore" && journalOpen ? sim.notes().find(n => n.id === journalOpen) || null : null)
  let meOpen = false // …and who you are, under your NAME on the bar (2026-09-02 — it was a corner hover)
  let anglesOpen = false // …and the games, under the ANGLE's cell (2026-09-04 — they hung under the name)
  let shelfGames = [] // the shelf as read at enter, by angle, alphabetically — every park, switch or new game reloads the page, so once is enough
  let pendingNew = false // …and a new game asked for from play: the compass opens as soon as the key is settled
  let dotHot = false // the "dot" phase: is the pointer on the home centre's mark?
  let helpersOpen = false // …and the helpers list under the TITLE. ONE bar menu
  // at a time (2026-08-10): opening any of the three closes the other two.
  let helperHover = null // the helper row under the pointer, or null
  let menuOpen = false // the radial menu around the player
  let menuSkill = null // the FOCUSED skill (its glyph at the centre, its actions fanned) — null = the ring
  let menuOpenId = null // the expanded folder's id (one at a time), or null
  let menuFocusId = null // the badge under the pointer (shows its label), or null
  let pot = {} // THE KITCHEN'S POT: raw kind → units waiting for the fire (the cook category's own state)
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
        renderer.setCamHold(false) // a transit grab ends with the walk — the camera glides home
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

  // `cam` marks a CONTROLLED travel (the walk home): the camera pins to the
  // DESTINATION and glides there over the move's own window, so you travel in
  // frame. A plain tile click never asks for it — the camera keeps its
  // board-anchored composure, and free-pan keeps whatever you framed.
  function startMove(target, { via = null, cam = false } = {}) {
    const path = via || sim.routeTo(target)
    if (!path) return
    renderer.setCamHold(false) // a map the hand moved gives the camera back: it glides to you and follows
    const totalMin = sim.pathCharge(path) // what the sim will actually deduct (home and river steps 1 min)
    // PER-TILE PACING: every step gets its OWN duration from the charge of the
    // tile it enters, so a walk is felt ground by ground — marsh and mountain
    // drag, home's flat paths and the river steps fly — instead of one averaged
    // glide. (pathCharge over a single pair IS that tile's own charge.)
    const segMs = []
    const segMin = [] // …and each step's own CHARGE, so the clock can drain it while that tile is crossed
    for (let i = 1; i < path.length; i++) {
      const chg = sim.pathCharge([path[i - 1], path[i]])
      segMin.push(chg)
      segMs.push(Math.max(MOVE_MS_STEP_MIN, MOVE_MS_UNIT * Math.pow(chg, MOVE_MS_CURVE)))
    }
    const walkMs = segMs.reduce((a, b) => a + b, 0)
    // …plus time for a board SHIFT: how far the camera slides to frame the end
    // board. Within one board this is 0 (the view holds still); across a river it
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
      verb: "walking to", // crossing a river into a sibling board is just a move like any other
      target,
      path,
      segMs,
      segMin,
      walkMs,
      totalMs,
      totalMin,
      homeAfter,
      retAfter,
      cam, // controlled travel → the camera pins to where you're going
      elapsed: 0
    }
    startLoop()
  }

  // CANCEL A WALK MID-STRIDE — "stop where we stand": the route truncates to
  // the tile being entered, and the walk simply LANDS there through the normal
  // completion path (the sim then charges only what was walked). The reserve
  // is re-checked at the cut — stopping short of a rest-spot destination could
  // otherwise strand you past the way home — walking the cut back toward the
  // origin until a legal landing is found; none → the move is dropped whole
  // (nothing was committed, nothing is charged).
  function cancelMove() {
    const p = pending
    if (!p || !p.path || p.path.length < 2) return
    // the segment being crossed — the same per-tile table walk the ghost does
    const last = p.segMs.length - 1
    let t = Math.max(0, Math.min(p.elapsed, p.walkMs))
    let s = 0
    while (s < last && t >= p.segMs[s]) {
      t -= p.segMs[s]
      s++
    }
    const frac = p.segMs[s] > 0 ? t / p.segMs[s] : 1
    let cut = Math.min(frac > 0.001 ? s + 1 : s, p.path.length - 1)
    if (cut >= p.path.length - 1) return // the last step is already underway — it lands anyway
    // a landing the COMMIT will accept: viaValid re-prices the truncated route
    // at completion — its own charge plus the way back from its end, within the
    // budget — so the guard must price the SAME route. (canMove's optimal-route
    // pricing let a costlier walked path land past the reserve edge.)
    const fits = c => {
      const part2 = p.path.slice(0, c + 1)
      const back = sim.retAfterPath(part2)
      return isFinite(back) && sim.pathCharge(part2) + back <= sim.timeLeft() + 1e-9
    }
    while (cut > 0 && !fits(cut)) cut-- // a legal place to stop
    if (cut <= 0) {
      // nothing walked yet (or nowhere legal short of the target): just let go
      pending = null
      renderer.setCamHold(false) // …and any transit grab with it
      hovered = hoverPath = null, hoverIllegal = false
      if (lastP) onPointerMove(lastP)
      api.requestRender()
      return
    }
    const part = p.path.slice(0, cut + 1)
    p.path = part
    p.segMs = p.segMs.slice(0, cut)
    p.segMin = p.segMin.slice(0, cut)
    p.walkMs = p.segMs.reduce((a, b) => a + b, 0)
    p.totalMs = p.walkMs // the board-shift tail was for framing the far target — gone with it
    p.totalMin = sim.pathCharge(part)
    p.target = part[part.length - 1]
    p.action = { type: "move", target: p.target, via: part }
    p.homeAfter = sim.homePathFrom(p.target)
    p.retAfter = sim.retAfterPath(part)
    p.cam = false // no far destination to pin the camera to any more
    p.verb = "stopping"
    api.requestRender()
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
    // MINUTES DRAIN WHERE THE FEET ARE (2026-09-01, was a fixed whole-minute
    // drip): a walk's clock reads the SAME per-tile table as the ghost — each
    // step's charge lands exactly while its tile is crossed, so the dial
    // speeds and slows with the terrain underfoot. In-place work still drips
    // evenly over its window. Fractional now, so the dial's current dot can
    // rise smoothly — and never more drain than the sim will actually charge
    // (or than we have).
    let drained
    if (p.path && p.segMin) {
      const last = p.segMs.length - 1
      let t = Math.max(0, Math.min(p.elapsed, p.walkMs))
      let acc = 0
      let s = 0
      while (s < last && t >= p.segMs[s]) {
        t -= p.segMs[s]
        acc += p.segMin[s]
        s++
      }
      acc += p.segMs[s] > 0 ? Math.min(1, t / p.segMs[s]) * p.segMin[s] : p.segMin[s]
      drained = p.elapsed >= p.walkMs ? p.totalMin : acc // the board-shift tail — fully walked
    } else drained = p.elapsed / MS_PER_MIN
    const inflightMin = Math.min(drained, p.totalMin, sim.energy())
    let ghostTile = null
    let ghostPos = null
    let ghostSeg = null
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
      // …and the same step as TILES, for a walker that stands off-centre: the
      // tile it leaves, the one it enters, the one it came into `a` from
      // (none at the walk's start), and how far across
      ghostSeg = { from: a, to: b, back: s > 0 ? p.path[s - 1] : null, frac }
      // the trail: the COMPLETED tiles APPENDED, then the live glide point as
      // the head, so the drawn line always meets the moving cube. Appending
      // matches the SIM's own rule — backtracking appends, never truncates —
      // where the old elastic pop made a walk home UNWIND the day's trail to
      // almost nothing mid-flight, then the real appended record snapped back
      // whole on landing (2026-08-31).
      ghostTrail = sim.view().trail.map(t => t.slice())
      for (let i = 1; i <= s; i++) ghostTrail.push(p.path[i])
      if (frac > 0.001) ghostTrail.push(ghostPos)
      // THE RAFT TRAVELS UNDER YOU — live, not on arrival. The sim only learns
      // the move when the walk lands, so mid-sail its mooring is a tile behind:
      // replay the raft along the SETTLED steps the way the sim itself will
      // (viaValid's rule) — board it where the path touches its mooring, carry
      // it while the steps stay on water (board water too, not just rivers),
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
      // WHAT is in flight, and HOW FAR IN: the dial draws the gap at this action's
      // own height, and the skill ring fills the running lesson's edge with
      // `progress` — the edge and the clock on one timing
      type: p.action?.type || null,
      skill: p.action?.skill || null,
      progress: p.totalMs > 0 ? Math.max(0, Math.min(1, p.elapsed / p.totalMs)) : 1,
      ghostTile,
      ghostPos,
      ghostSeg,
      ghostTrail,
      raftPos, // where the raft is DURING the walk (it moves with you) — see above
      moveMs: p.path ? p.totalMs : 0, // the camera borrows this duration so a crossing glides in step
      cam: !!p.cam, // …and a controlled travel pins it to the destination
      // the pre-solved way home from the destination — no routing while in transit
      homePath: p.homeAfter ?? null,
      ret: p.retAfter ?? null,
      inflightMin,
      remainingMin: Math.max(0, Math.round(p.totalMin - inflightMin))
    }
  }

  // ── the menu ─────────────────────────────────────────────────────────
  // Built fresh each frame from what's true right now. `self` = the nodes on
  // the cells round the tile (only `enter` today); `them` is always empty. The
  // skills are the categories, on the dial's ring; the helpers hang off the
  // title (helperSpec).
  function menuSpec() {
    const v = sim.view()
    const self = []
    // (SLEEP is the dream glyph on the skill ring — see sleepGate; the
    //  playground is a line in the title's helpers.)
    if (sim.canEnter()) self.push({ id: "enter", icon: "enter", label: "enter", run: () => act({ type: "enter" }) })
    // (GATHER was a node here — removed 2026-08-08, with the rest of the works.
    //  Picking a thing up stops being a decision you take through a menu: what a
    //  tile yields will simply arrive in the pile at the bottom of the screen,
    //  where everything you carry already lives. The sim's `gather` action is
    //  untouched — nothing in the menu calls it right now.)
    // (RAFT/TELEPORT/EAT/COOK left the ring on 2026-08-10 — SKILLS ARE THE
    //  CATEGORIES now: each lives behind its skill's glyph (build, travel,
    //  cook). See kitchenSpec and timelineSpec below, and the menuSkill focus mode.)
    // (COMMISSION was a node here — removed 2026-08-08. Crafting stops being a
    //  service you buy from a stranger: the figures are to be CONTROLLED, and
    //  what they make will come from that. The sim's `craft` action is untouched;
    //  nothing in the menu commissions anything now.)
    // (BUILD CAMP was a node here — removed 2026-08-03. The build action itself
    //  is untouched in the sim; nothing in the menu raises one right now.)
    // (DROP / TAKE / EAT are not items on THIS menu — moving a thing between
    //  your back and the ground is done in the CORNERS, where the thing itself
    //  is: click a box and its own actions open on it. See rowMenuRows.)
    // your skills live on the clock ring; land/figure info is on the top-right
    // card. GO HOME left the ring on 2026-08-08: home is a place, not a verb, so
    // the way back is the home TILE itself — on screen when it's on screen, and
    // the gate's own arrow when it isn't: held inside the clock ring, pointing at
    // its doorway (a direction only, nothing to click; see `arrow` in render.js).
    // (the helpers folder used to sit here — it read as a game action among game
    //  actions, which it never was. They're a list under the TITLE now; see
    //  helperSpec, and render's top-left stack.)
    // the ring's right side is unused for now — land/figure facts live on the card
    // A FOCUSED SKILL takes over: the ring hides, nothing fans, and the
    // category's own view takes the middle — the kitchen or the timeline
    if (menuSkill)
      return {
        self: [],
        them: [],
        openId: menuOpenId,
        focusId: menuFocusId,
        skill: menuSkill,
        kitchen: menuSkill === "cook" ? kitchenSpec() : null, // …cook's ring is its pantry (see kitchenSpec)
        timeline: timelineSpec(menuSkill), // …craft's and build's, their levels (see timelineSpec)
        // …and lore's, THE JOURNAL: every first the voice wrote, newest first
        journal: menuSkill === "lore" ? { entries: journalNotes().map(voiceOf).reverse(), scroll: journalScroll, open: journalOpen } : null
      }
    return { self, them: [], openId: menuOpenId, focusId: menuFocusId, skill: null }
  }

  // THE KITCHEN (2026-09-17): the cook category is a POT, not a list. Every raw
  // food on your back or at your feet takes a seat on the ring — the stash's own box, a − and a
  // + under it — the pot fills from there, and what it would make reads out as
  // it fills. This is the controller's half: the seats, what each sign may
  // still do, the plan the readout prints, and the COOK button as a menu node
  // (so its bill, its minutes on the clock and the corners' green all work as
  // any node's do). The rules are the sim's own (cookPlan) — a further KIND
  // needs the cook level for it, a further UNIT the skewers' room.
  function kitchenSpec() {
    const pantry = sim.pantry()
    // what left the pack leaves the pot with it (eaten, dropped, spoiled)
    for (const k of Object.keys(pot)) {
      pot[k] = Math.min(pot[k], pantry.find(x => x.k === k)?.n || 0)
      if (!pot[k]) delete pot[k]
    }
    const hearth = sim.atRestSpot()
    const level = sim.skillOf("cook")
    const kinds = Object.keys(pot).length
    const plan = sim.cookPlan(pot)
    let cook = null
    if (plan) {
      // THE BILL, itemised like a recipe's: the pot's units and — the cook the
      // fire wants one — the fuel, whatever you are short of in red (the ground
      // at your feet counted, as the sim spends it); any other refusal speaks in
      // its own row
      const pack = sim.inventory()
      const needs = { ...plan.needs }
      const shortOf = k => (pack[k] || 0) < plan.offPack[k]
      const lacking = Object.keys(needs).some(shortOf)
      const cost = Math.ceil(plan.cost)
      cook = {
        id: "cook-pot",
        label: "cook",
        needs, // → the corner rows light what it takes
        offPack: plan.offPack, // …the ground first, then your back (the sim's reading)
        lines: [
          { cells: [{ text: "cook" }, { text: `${cost}m`, alpha: 0.6 }] },
          ...Object.entries(needs).map(([k, n]) => ({
            cells: [
              { text: k, color: shortOf(k) ? "#c0433a" : null },
              { text: `x${n}`, alpha: 0.6, color: shortOf(k) ? "#c0433a" : null }
            ]
          })),
          ...(plan.why && !lacking ? [{ text: plan.why, alpha: 0.9, color: "#c0433a" }] : [])
        ],
        disabled: !!plan.why,
        cost, // → the clock's hover estimate (in-place work)
        high: true,
        run: () => {
          const on = { ...pot }
          pot = {} // the pot is on the fire: the kitchen starts clean
          startTimed({ type: "cook", pot: on }, "cooking", cost)
        }
      }
    }
    return {
      hearth,
      level,
      fuel: sim.fuel(), // cooks left on the wood already burning
      cook,
      seats: pantry.map(({ k, n }) => {
        const inPot = pot[k] || 0
        return {
          k,
          have: n,
          inPot,
          canAdd: hearth && inPot < n && inPot < COOK_SERVINGS && (inPot > 0 || kinds < level),
          canRemove: inPot > 0
        }
      }),
      plan
    }
  }
  // a − or a + clicked (or a box in the pot: that is a − too): one unit in, or one back out
  function potStep(k, op) {
    const seat = kitchenSpec().seats.find(x => x.k === k)
    if (!seat) return
    if (op === "add" && seat.canAdd) pot[k] = (pot[k] || 0) + 1
    if (op === "remove" && seat.canRemove) pot[k] -= 1
    if (!pot[k]) delete pot[k]
  }

  // SKILLS ARE THE CATEGORIES: clicking an openable glyph on the ring focuses
  // the skill (menuSkill) and its category takes the middle.
  //   cook          → THE KITCHEN (see kitchenSpec). EATING is not here: a bite
  //                   belongs to the thing itself, so it lives on the pack chip's
  //                   own list.
  //   craft, build  → THE TIMELINE (see timelineSpec).
  // The rest answer with nothing yet — their glyphs stay reference-only.
  // THE TIMELINE: what a category makes, laid out by LEVEL — a column per level,
  // every level you have reached and the next one that holds anything (dashed);
  // the levels past that stay hidden. Each thing is a node: its bill (the name
  // and its minutes, a row per material — red where you are short — then any
  // other refusal), its needs (the corners light what it would take), its minutes (the
  // clock's estimate) and its run. `inward`: its bill rides the cursor toward
  // the middle, as a corner box's label does.
  function timelineSpec(skill) {
    const nodes = skill === "craft" ? craftNodes() : skill === "build" ? buildNodes() : null
    if (!nodes) return null
    const level = sim.skillOf(skill)
    const levels = [...new Set(nodes.map(n => n.level))].sort((a, b) => a - b)
    const next = levels.find(l => l > level)
    return {
      columns: levels
        .filter(l => l <= level || l === next)
        .map(l => ({ level: l, next: l > level, closed: !!timelineClosed[skill]?.has(l), items: nodes.filter(n => n.level === l) }))
    }
  }
  // A LEVEL'S COLUMN opens and closes on its number — open until closed, and a
  // closed one stays closed across reloads: per category, the closed levels.
  // It rides localStorage, not the save, like the kept seats: where the eye
  // wants things is a habit, not a move in the game.
  const TIMELINE_CLOSED_KEY = KEYS.timelineClosed
  const timelineClosed = readTimelineClosed()
  // …read defensively: anything that isn't a list of levels is dropped
  function readTimelineClosed() {
    try {
      const raw = JSON.parse(localStorage.getItem(TIMELINE_CLOSED_KEY) || "{}")
      const out = {}
      for (const [skill, levels] of Object.entries(raw)) if (Array.isArray(levels)) out[skill] = new Set(levels.filter(Number.isInteger))
      return out
    } catch {
      return {}
    }
  }
  function toggleTimelineLevel(skill, level) {
    const closed = timelineClosed[skill] || (timelineClosed[skill] = new Set())
    closed.delete(level) || closed.add(level)
    try {
      localStorage.setItem(TIMELINE_CLOSED_KEY, JSON.stringify(Object.fromEntries(Object.entries(timelineClosed).map(([k, set]) => [k, [...set]]))))
    } catch {}
  }
  // the timeline's node with this id, from the category open now
  const timelineNode = id => (timelineSpec(menuSkill)?.columns || []).flatMap(c => c.items).find(n => n.id === id) || null
  // every recipe, at its own level
  function craftNodes() {
    const level = sim.skillOf("craft")
    return sim.craftList().map(r => {
      const lacking = Object.keys(r.short).length > 0 // short of a material, the ground at your feet counted
      return {
        id: "craft-" + r.k,
        k: r.k,
        label: r.k,
        level: r.level,
        inward: true,
        needs: { ...r.needs },
        offPack: r.offPack, // how much of each comes off your back once the ground has given what it has (the sim's reading)
        lines: [
          { cells: [{ text: r.makes > 1 ? `${r.k} x${r.makes}` : r.k }, { text: `${r.cost}m`, alpha: 0.6 }] },
          ...Object.entries(r.needs).map(([k, n]) => ({ text: `${k} x${n}`, color: r.short[k] ? "#c0433a" : null })),
          // a level not yet reached always says so; any other refusal only when the red rows don't
          ...(r.why && (r.level > level || !lacking) ? [{ text: r.why, alpha: 0.9, small: true, color: "#c0433a" }] : [])
        ],
        disabled: !!r.why,
        cost: r.cost,
        high: true,
        run: () => startTimed({ type: "craft", recipe: r.k }, "making", r.cost)
      }
    })
  }
  // the raft, raised in the water it floats on. (The camp has its level in the sim but is not offered here.)
  function buildNodes() {
    const rp = sim.raftPlan() // null off the water — the plan itself is the "are you on it?"
    const lacks = rp ? rp.short : sim.shortOf(RAFT_NEEDS) // kind → how many short, what lies at your feet counted — off the water too
    const why = !rp
      ? "only on river shores"
      : rp.built
        ? "you already have one"
        : Object.keys(lacks).length
          ? null // the red material rows say it
          : !sim.canAct({ type: "raft" })
            ? "not enough time left" // the materials are to hand — the RAFT_MIN + way home no longer fit the day
            : null
    return [
      {
        id: "raft",
        k: "raft",
        label: "raft",
        level: 1,
        inward: true,
        needs: { ...RAFT_NEEDS },
        atHand: true, // its bill counts what lies at your feet, spent before what you carry (the sim's rule)
        lines: [
          { cells: [{ text: "raft" }, { text: `${RAFT_MIN}m`, alpha: 0.6 }] },
          ...Object.entries(RAFT_NEEDS).map(([k, n]) => ({ text: `${k} x${n}`, color: lacks[k] ? "#c0433a" : null })),
          ...(why ? [{ text: why, alpha: 0.9, small: true, color: "#c0433a" }] : [])
        ],
        disabled: !sim.canAct({ type: "raft" }),
        cost: RAFT_MIN,
        high: true,
        run: () => startTimed({ type: "raft" }, "building", RAFT_MIN)
      }
    ]
  }

  // WHAT YOU CAN DO RIGHT NOW, by the skill it belongs to: every recipe and
  // build its category would let you run this minute, at a hearth what the fire
  // would take, and every yield of the tile you could take — each as a heading
  // and its boxes. Craft stands over the pack; the rest stand over the ground,
  // on the tile's side. A click runs it exactly as its node does.
  function makeSpec() {
    const craft = sim
      .craftList()
      .filter(r => !r.why)
      .map(r => ({
        id: "craft-" + r.k,
        label: r.makes > 1 ? (r.k.endsWith("s") ? r.k : `${r.k}s`) : r.k, // more than one made reads as the plural
        needs: { ...r.needs }, // → the corners light what it takes, as the category's node does
        offPack: r.offPack,
        cost: r.cost, // → the clock's hover estimate, as the node's
        run: () => startTimed({ type: "craft", recipe: r.k }, "making", r.cost)
      }))
    const build = buildNodes()
      .filter(n => !n.disabled)
      .map(n => ({ id: n.id, label: n.label, needs: n.needs, atHand: n.atHand, cost: n.cost, run: n.run }))
    // COOK: each raw food you have, and each named mix you have every kind of,
    // as all of it you have up to the skewers' COOK_SERVINGS — offered only when
    // the fire would take it
    const cook = []
    if (sim.atRestSpot()) {
      const have = Object.fromEntries(sim.pantry().map(({ k, n }) => [k, n]))
      const offer = (label, pot) => {
        const plan = sim.cookPlan(pot)
        if (!plan || plan.why) return
        const cost = Math.ceil(plan.cost)
        cook.push({
          id: "cook-" + Object.keys(pot).sort().join("+"),
          label: plan.servings > 1 ? `${label} x${plan.servings}` : label,
          needs: { ...plan.needs },
          offPack: plan.offPack,
          cost,
          food: plan.meals.reduce((t, m) => t + (defOf(m.k)?.food || 0) * m.n, 0), // what the pot gives eaten, all of it
          run: () => startTimed({ type: "cook", pot }, "cooking", cost)
        })
      }
      for (const k in have) offer(cookedOf(k), { [k]: Math.min(have[k], COOK_SERVINGS) })
      for (const c of COMBOS) {
        if (!c.kinds.every(k => have[k])) continue
        const n = Math.min(COOK_SERVINGS, ...c.kinds.map(k => have[k]))
        offer(c.name, Object.fromEntries(c.kinds.map(k => [k, n])))
      }
    }
    // GATHER AND HUNT: every yield of the tile, by verb — the ones you can't
    // take this minute dimmed, with why
    const take = verb =>
      (sim.gatherInfo() || [])
        .filter(y => y.verb === verb)
        .map(y => ({
          id: `${verb}-${y.res}`,
          label: y.res,
          res: y.res, // → lights green while a bill under the pointer is short of it
          cost: y.cost,
          food: RESOURCES[y.res]?.food || 0,
          disabled: !sim.canAct({ type: y.verb, item: y.res }),
          why: y.lacks ? `needs a ${y.lacks}` : !y.ready ? "regrowing" : y.full ? "pack full" : null,
          run: () => startTimed({ type: y.verb, item: y.res }, verb === "hunt" ? "hunting" : "gathering", y.cost)
        }))
    return [
      { title: "craft", side: "left", items: craft },
      { title: "cook", side: "right", items: cook },
      { title: "build", side: "right", items: build },
      { title: "hunt", side: "right", items: take("hunt") },
      { title: "gather", side: "right", items: take("gather") }
    ]
      .filter(g => g.items.length)
      .map(g => ({ ...g, folded: makeFolded.has(g.title) }))
  }
  // A ROW FOLDS ON ITS HEADING, down to how many it holds — and a folded row
  // stays folded across reloads: localStorage, not the save, like the
  // timeline's closed levels (where the eye wants things is a habit)
  const makeFolded = (() => {
    try {
      const raw = JSON.parse(localStorage.getItem(KEYS.makeFolded) || "[]")
      return new Set(Array.isArray(raw) ? raw.filter(t => typeof t === "string") : [])
    } catch {
      return new Set()
    }
  })()
  function toggleMakeFold(title) {
    makeFolded.delete(title) || makeFolded.add(title)
    try {
      localStorage.setItem(KEYS.makeFolded, JSON.stringify([...makeFolded]))
    } catch {}
  }

  // THE HELPERS — dev and comfort switches, not moves in the game. They hang off
  // the TITLE (the bar's own name cell), the way the log hangs off the clock: one
  // list of plain rows, click one to run it. Same shape as a menu node minus the
  // ring: { id, label, run }.
  function helperSpec() {
    // before there is a world, only the way out (the playground waits for it)
    if (phase !== "play") return [{ id: "reset", label: "reset", run: doReset }]
    return [
      // PLAYGROUND — the workshop tabs (cube · icons · animate · guide ·
      // styles · world), a line in the title's list with the rest of the
      // things that aren't moves, from anywhere — but not while a walk, a wait
      // or the dream is on: leaving the screen would drop the one and lose the
      // day's banking with the other.
      ...(pending || dayEnding ? [] : [{ id: "cube", label: "playground", run: enterCube }]),
      { id: "clearBoard", label: "clear board", run: () => act({ type: "clearBoard" }) },
      { id: "clearMap", label: "clear map", run: () => act({ type: "clearMap" }) },
      // …and a unit of every raw food with the fuel for one fire, at a hearth —
      // so the kitchen can be looked at without the foraging (click again for more)
      { id: "stock", label: "stock pantry", keep: true, run: () => act({ type: "stockPantry" }) },
      // ANY SKILL TO ANY LEVEL: inside a category the rows are that skill's — a
      // step either way, or straight to either end; on the ring they move all
      // twelve together. `keep` holds the list open, so a level is a few clicks.
      ...(menuOpen && menuSkill
        ? [
            { id: "skillUp", label: `${menuSkill} +1`, keep: true, run: () => setSkills([menuSkill], l => l + 1) },
            { id: "skillDown", label: `${menuSkill} −1`, keep: true, run: () => setSkills([menuSkill], l => l - 1) },
            { id: "skillMax", label: `${menuSkill} ${SKILL_CAP}`, keep: true, run: () => setSkills([menuSkill], () => SKILL_CAP) },
            { id: "skillMin", label: `${menuSkill} ${PLAYER_START}`, keep: true, run: () => setSkills([menuSkill], () => PLAYER_START) }
          ]
        : [
            { id: "skillsUp", label: "all skills +1", keep: true, run: () => setSkills(STAT_NAMES, l => l + 1) },
            { id: "skillsDown", label: "all skills −1", keep: true, run: () => setSkills(STAT_NAMES, l => l - 1) }
          ]),
      // …the FRAME-TIME READOUT, top right: what each part of a frame costs
      { id: "perf", label: perfOn ? "frame times: on" : "frame times: off", keep: true, run: togglePerf },
      { id: "reset", label: "reset", run: doReset }
    ]
  }
  function togglePerf() {
    perfOn = !perfOn
    renderer.setPerf(perfOn)
    try {
      localStorage.setItem(KEYS.perf, perfOn ? "1" : "0")
    } catch {}
  }
  // the helper's hand on the sim: each skill named to the level `to` makes of its own
  function setSkills(skills, to) {
    for (const skill of skills) {
      const level = Math.max(PLAYER_START, Math.min(SKILL_CAP, to(sim.skillOf(skill))))
      if (level !== sim.skillOf(skill)) act({ type: "setSkill", skill, level })
    }
  }

  // the player card, top-right: land facts — or, standing ON a figure (a
  // board's centre), the same board/figure overview the centre's hover
  // shows. Shown while the menu is open (see render — ui.card).
  // WHO YOU ARE, for the bar. The NAME is what stands there — not the key,
  // which nobody reads — and the face and npub drop under it on a click, with
  // the games you've started, NEW GAME, and REFRESH (asks the relays again) at
  // the foot. With no profile found the name says so, as an invitation. (The
  // lookup lives in identity.js; setup uses the same one.)
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
    // before the key is in, the box is the ASK — what the signer is doing
    if (!pubkey) return phase === "play" ? null : { name: keyStatus(), found: false, pic: null, npub: null }
    const np = npubEncode(pubkey)
    const p = savedProfile(pubkey)
    return {
      name: profileBusy ? "looking…" : p?.name || "profile not found",
      found: !!p?.name,
      pic: faceFor(p?.picture || null), // an <img> once it has loaded, else null
      // the key as the block shows it: "npub", the 1 light (it is the only
      // delimiter), then eight…eight of the body — pubkey, relays and follows
      // left the block 2026-09-02
      npub: { pre: "npub", sep: "1", body: `${np.slice(5, 13)}…${np.slice(-8)}` },
      npubFull: np // …and whole, for the key phase's box
    }
  }
  // …and the WATCH on it (2026-09-05): the relays stay subscribed for the
  // session, so a name changed later simply lands and the block redraws itself.
  // The screen only waits for the FIRST answer — the rest arrives behind it.
  function watchMe() {
    if (!pubkey) return
    profileBusy = !savedProfile(pubkey)?.name // …only "looking…" while there is nothing to show
    api.requestRender()
    watchProfile(pubkey, () => api.requestRender()).finally(() => {
      profileBusy = false
      keySettled() // the profile is in (or not to be found): the game is chosen now
      api.requestRender()
    })
  }

  // ── THE KEY — the "key" phase ──────────────────────────────────────
  // The signer is only ever asked after a CLICK (the dot's, in the phase
  // before) and never twice for a key we hold. Without a signer the box says
  // so and keeps watching for a late injection, asking the moment one lands;
  // refused, the box becomes the button that asks again.
  let asking = false // the extension's promise is out
  let keyError = null // "signer refused" | "not a key"
  let keyWatch = 0
  const hasNostr = () => typeof window !== "undefined" && !!window.nostr?.getPublicKey
  const stopKeyWatch = () => {
    if (keyWatch) (clearInterval(keyWatch), clearTimeout(keyWatch)) // the landing timer, or the watch it became
    keyWatch = 0
  }
  function beginKey(p) {
    renderer.intakeClick(p) // the first part begins: the label's lines retreat into its box
    phase = "key"
    api.requestRender()
  }
  // …and from there it runs itself: the cursor onto the title, the reel, and
  // the blast when it reaches the centre — with which the ask goes out (see
  // the draw's intakeAskDue). Escape steps back through the parts.
  function armAsk() {
    stopKeyWatch()
    if (pubkey) return keySettled() // a key already held (back from the dot by Escape): straight to the choosing
    if (hasNostr()) askKey()
    else
      keyWatch = setInterval(() => {
        if (!hasNostr()) return
        stopKeyWatch()
        askKey()
      }, 300)
  }
  async function askKey() {
    if (asking || pubkey) return
    asking = true
    keyError = null
    api.requestRender()
    let pk = null
    try {
      pk = await window.nostr.getPublicKey()
    } catch {
      keyError = "signer refused"
    }
    asking = false
    if (pk != null) {
      if (typeof pk === "string" && /^[0-9a-f]{64}$/i.test(pk.trim())) {
        pubkey = pk.trim().toLowerCase()
        rememberPubkey(pubkey) // the moment it lands, before anything is built with it
        // the world-to-be takes the key: who you are, before any angle is struck
        sim = liveSim = createSim({ pubkey })
        renderer.setSim(sim)
        watchMe()
      } else keyError = "not a key"
    }
    api.requestRender()
  }
  const keyStatus = () => (asking ? "waiting for signer" : keyError || (hasNostr() ? "waiting for signer" : "signer not found"))

  // ── THE ANGLE — the "angle" phase (2026-09-04) ─────────────────────
  // NEW GAME from the angle menu hosts the compass picker (lib/setup/angle.js —
  // the old setup's, rough, to be refined) on the ring at rest. Held, the click
  // home strikes the world; the ceremony ends on a WAKE sign, and that click
  // mints the world's key, banks the fresh world and reboots into it.
  const picker = AngleScreen({
    centreDot: false,
    centre: () => renderer.intakeGeom() || { x: api.layout.cx, y: api.layout.cy },
    radius: () => renderer.intakeGeom()?.dial ?? api.layout.minSide * 0.3,
    tile: () => renderer.intakeGeom()?.tile ?? api.layout.minSide * 0.08,
    home: p => renderer.dotHit(p),
    used: () => shelfGames.map(g => Math.round(g.angle)), // the shelf's angles are struck already
    segment: false, // the sweep is the ring's own dots filling (render.js), not the picker's arc
    compassRing: false // …and the circle opened from the centre is the ring's other half of dots (render.js)
  })
  // THE KEY IS SETTLED — the profile in, or not to be found: the game is chosen
  // here. The angle column drops open; with nothing on the shelf, or a new game
  // asked for from play, the compass opens ON ITS OWN once the box has settled
  // onto the name — no click on NEW needed.
  function keySettled() {
    if (phase !== "key") return
    anglesOpen = true
    meOpen = false
    if (!pendingNew && shelfGames.length) return
    pendingNew = false
    setTimeout(() => {
      if (phase === "key") beginAngle()
    }, renderer.intakeSettleMs())
  }
  // ESCAPE STEPS BACK through the intake (2026-09-04, to see each part again):
  // a ceremony part to the one before it, the strike undone, the held angle
  // let go, the compass closed back onto the shelf, and the key phase back to
  // the dot with the intake's motion reset — the click plays it all again.
  function intakeBack() {
    if (phase === "angle") {
      if (!picker.back()) {
        phase = "key"
        anglesOpen = true // the shelf (or the NEW button, unpressed) — never the compass again by itself
      }
    } else if (phase === "key") {
      stopKeyWatch()
      if (renderer.intakeBack()) anglesOpen = meOpen = false // a part of the click's sequence, played again
      else {
        phase = "dot"
        anglesOpen = meOpen = helpersOpen = false
        renderer.intakeReset()
      }
    } else return false
    api.requestRender()
    return true
  }
  function beginAngle() {
    anglesOpen = shelfGames.length > 0 // NEW stays pressed in the open column until an angle is held
    meOpen = helpersOpen = false
    phase = "angle"
    picker.enter(api)
    api.requestRender()
  }
  function angleClick(p) {
    if (picker.onPointerDown(p)) {
      if (picker.value() != null) anglesOpen = false // the angle is held: the cell reads it, the column folds
      return scheduleRender()
    }
    const angle = picker.value()
    if (!angle || !renderer.dotHit(p)) return
    if (picker.ready()) {
      // the tile shrinks away first, uncovering what stands under it — and the
      // world is struck exactly as that ends, so it opens out of the reveal
      if (picker.open()) {
        scheduleRender()
        setTimeout(() => strikeWorld(angle), picker.openMs())
      }
      return
    }
    if (picker.begin()) scheduleRender() // …the press BRACES it; the release below looses it
  }
  // …and letting go is the loose. Anywhere: the press was the aim.
  function angleRelease() {
    if (phase === "angle" && picker.loose()) scheduleRender()
  }
  // THE WORLD OPENS IN PLACE (2026-09-05): no reload — that flashed the whole
  // chrome, and there is nothing to reload FOR. A fresh world has no log to
  // replay, so the screen simply takes the struck one: the angle and the world
  // key it was cut from, a sim built on them, banked so it survives a real
  // reload, and the phase turned over. The renderer's own swap clears every
  // cache keyed on the old sim and snaps the camera to the new view — the same
  // binding looking back already uses.
  function strikeWorld(a) {
    angle = a
    worldKey = worldKeyFor(pubkey, angle)
    sim = liveSim = createSim({ angle, pubkey, worldKey })
    renderer.setSim(sim)
    persist(sim)
    anglesOpen = meOpen = helpersOpen = daysOpen = logsOpen = false
    closeRowMenu()
    renderer.whoosh() // …and it wakes the way a dream does: the world smears out of the drawing
    phase = "play"
    api.requestRender()
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
      return {
        kind: "info",
        title: npcName(npc.pubkey),
        subtitle: "figure",
        rows: [
          ["npub", `${np.slice(0, 12)}…${np.slice(-4)}`],
          ["mostly", sim.boardMainType(npc.board) || "—"],
          ["discovered", `${Math.round((sim.foundOn(npc.board) / sim.tilesOf(npc.board)) * 100)}%`]
        ]
      }
    }
    // (the pack is no longer card TEXT — it lives lower-left as item chips, one
    // hex per unit, drawn by the renderer's side views)
    // THE RIVER is a place too. River tiles carry no land facts (they're nobody's
    // board), which used to leave you standing in the water reading "you ·
    // afield". What matters here is what you can do FROM it: on foot the water
    // is a dead end you back out of; aboard the raft it's the road. It goes
    // BEFORE the safe-board check: wading out of home doesn't change which board
    // the view is on, so "home" would otherwise claim the water too.
    if (sim.onWater()) {
      const rp = sim.raftPlan()
      return {
        kind: "info",
        // board water is water, not "land" (which the biome card would call it)
        title: sim.inRiver() ? "river" : sim.landAt(sim.view().player)?.elevation < 0 ? "deep water" : "shallows",
        subtitle: "water",
        rows: [
          ["moves", sim.aboard() ? "any shore" : "back the way you came"],
          [
            "raft",
            rp.here
              ? "moored here"
              : rp.built
                ? "moored elsewhere"
                : Object.keys(rp.short).length
                  ? Object.entries(rp.short)
                      .map(([k, n]) => `${n} more ${k}`)
                      .join(" · ")
                  : "ready to build"
          ]
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
        ["elevation", land.elevation],
        ["move cost", `${land.move}×`],
        ["yields", land.yields]
      ]
    }
  }

  // (the first-person 3D views live in attic/ now — see attic/README.md)

  // free-pan camera: an optional mode where the camera never follows — the
  // board stays wherever you drag it (the menu still centres). Persisted in
  // storage; off the title menu since 2026-09-02, so only the stored flag
  // turns it on.
  function toggleFreeCam() {
    freeCam = !freeCam
    renderer.setFreeCam(freeCam)
    try {
      localStorage.setItem(KEYS.freeCam, freeCam ? "1" : "0")
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
    pot = {} // nothing waits in the pot behind a closed menu
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
    // ESCAPE CLOSES THE MENU ONE LAYER AT A TIME (2026-09-02): an open folder
    // first, then a focused category steps back to the ring, then the ring
    // closes. It answers nothing else — a walk in flight, the sleep screen and
    // the past keep their own controls.
    if (e.key === "Escape" && phase !== "play") return intakeBack() // …and BACK through the intake, a step at a time
    if (e.key === "Escape") {
      if (rowMenu) {
        closeRowMenu() // the corner list is the outermost layer: it goes first
        api.requestRender()
        return true
      }
      if (!menuOpen || browse || pending || replaying || dayEnding) return false
      if (menuOpenId) menuOpenId = null
      else if (menuSkill) {
        menuSkill = null
        menuOpenId = menuFocusId = null
        skillHover = null
      } else closeMenu()
      api.requestRender()
      return true
    }
    if (e.key !== " " || phase !== "play") return false
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

  // SLEEP'S GATE — the one reading the dream glyph's click and hover both take:
  // whether lying down is on right now and, when it isn't, why not, in a few words
  function sleepGate() {
    return {
      can: !dayEnding && !browse && !replaying && !pending && sim.atRestSpot() && sim.log().length > 0,
      why: pending ? "not mid-way" : !sim.atRestSpot() ? "can't sleep here" : !sim.log().length ? "nothing to dream about" : null
    }
  }
  // SLEEP opens the end-of-day screen instead of banking the day outright — you
  // review the day's tally, then tap "wake up" to actually rest into the next.
  function beginSleep() {
    if (!sim.atRestSpot()) return
    // THE HOVER GOES WITH THE DAY: there is no hovered tile on the sleep screen,
    // and onPointerMove hands the pointer to it without touching these — so they
    // are cleared here, or the last aimed tile keeps its label through the dream.
    hovered = hoverPath = null
    hoverIllegal = false
    dayEnding = true
    nightRun = false // the dream first; the night passes when wake is clicked
    logsOpen = false // (sleeping used to unroll the logs — the dream says it all)
    // …and the ring goes away: the dream draws the dream category itself (see
    // THE DREAM MARK in render), and the mark itself is the way out
    closeMenu()
    api.requestRender()
  }
  function wakeUp() {
    // TWO PHASES (2026-08-10): the dream held the clock at the day's last
    // minute — WAKE is what lets the night pass. First the sweep to midnight
    // plays (ui.dayEnd.leaving), and only when it lands does the day bank.
    if (nightRun) return
    nightRun = true
    renderer.whoosh() // the ride home starts NOW — the motion blur rides with it
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

  // RESET EVERYTHING means everything: the save, the whole shelf, AND the key
  // with its cached profile — then the game reboots on its first phase.
  function doReset() {
    try {
      localStorage.removeItem(SAVE_KEY)
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i)
        if (k && k.startsWith(GAME_PREFIX)) localStorage.removeItem(k)
      }
    } catch {}
    forgetIdentity()
    window.location.reload()
  }
  // A NEW GAME (2026-09-02): park the one you're in and reboot — the identity
  // stays, so the game opens on the "key" phase with your name already in.
  function newGame() {
    if (phase !== "play") return beginAngle() // no game to park: straight to the compass (again, from the column)
    try {
      parkCurrent()
      localStorage.removeItem(SAVE_KEY)
      sessionStorage.setItem(INTENT_KEY, "new") // …and the reboot opens the compass itself, no second click
    } catch {}
    window.location.reload()
  }

  function enterCube() {
    if (pending || dayEnding) return // a walk, a wait or the dream is on (see helperSpec)
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
    // …and the kitchen's COOK button is a node like any other, just not one the fan draws
    const cookOn = !sh && !hit && menuSkill === "cook" && renderer.kitchenHit(p)?.op === "cook"
    // …and so is every box on the timeline
    const tl = !sh && !hit && !cookOn ? renderer.timelineHit(p) : null
    const id = hit ? hit.id : cookOn ? "cook-pot" : tl ? tl.id : null
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
    // the open helpers list picks out the row under the pointer, wherever the
    // rest of the pointer logic goes next
    const hh = helpersOpen ? renderer.helperHit(p) : null
    if ((hh?.id ?? null) !== helperHover) {
      helperHover = hh?.id ?? null
      scheduleRender()
    }
    // AN OPEN CORNER LIST OWNS THE POINTER (2026-09-14): its rows sit over the
    // world and over the boxes that opened it, so they are hovered first and
    // nothing underneath reads the pointer while they're up.
    const rm = rowMenu ? renderer.rowMenuHit(p) : null
    if ((rm?.id ?? null) !== rowMenuHover) {
      rowMenuHover = rm?.id ?? null
      scheduleRender()
    }
    if (rm) {
      if (hovered || hoverPath) (hovered = hoverPath = null), (hoverIllegal = false)
      scheduleRender()
      return
    }
    const dh = daysOpen ? renderer.dayListHit(p) : null
    if ((dh?.day ?? null) !== dayHover) {
      dayHover = dh?.day ?? null
      scheduleRender()
    }
    const lh = logsOpen
      ? renderer.logRowHit(p) ||
        ((renderer.logRunHit(p) ?? renderer.logRestoreHit(p)) != null
          ? { i: renderer.logRunHit(p) ?? renderer.logRestoreHit(p) }
          : null)
      : null
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
    if (!onRows && renderer.chromeHit(p)) {
      if (hovered || hoverPath) (hovered = hoverPath = null), (hoverIllegal = false)
      // …and the corner hovers let go too: sliding off the pack onto your name
      // (chrome, just below it) used to leave the last box lit and its label up
      if (itemHover != null || groundHover != null) (itemHover = null), (groundHover = null)
      if (phase === "angle") picker.onPointerMove(null) // the menu has the hand: the compass lets go of it
      scheduleRender()
      return
    }
    if (phase !== "play") {
      // before the world, the dot is the only thing out there to hover — and
      // the angle phase's compass follows the hand
      if (phase === "angle") picker.onPointerMove(p)
      const on = phase === "dot" && renderer.dotHit(p)
      if (on !== dotHot) dotHot = on
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
      // Anything the world was hovering goes, and stays gone while they own it.
      if (hovered || hoverPath) (hovered = hoverPath = null), (hoverIllegal = false)
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
      itemHover = itHit?.i ?? null // by BOX (its index) — a box is a kind and its count
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
      groundHover = grHit?.i ?? null // by BOX, the same
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
    // …and while the menu CLOSES the map isn't back yet: it is still zooming
    // home under the pointer, so its hover waits for the close to land (the
    // draw aims it then — see draw)
    if (!renderer.menuShut()) {
      if (hovered || hoverPath) (hovered = hoverPath = null), (hoverIllegal = false)
      scheduleRender()
      return
    }
    // A DRAG MOVES THE MAP: a press that travels past the threshold becomes a
    // board DRAG — pan the camera by the frame delta and suppress the tile
    // hover/aim underneath. The camera lets go for it — till your next move
    // (startMove), or mid-walk till the walk lands. This must sit BEFORE the
    // pending lock: the mid-walk grab is exactly a drag DURING pending
    // (2026-08-31 — below the lock it could never run, which is why the map
    // wouldn't drag in transit).
    if (worldPress && downP && (!pending || (pending.path && !pending.cam))) {
      if (!dragged && Math.hypot(p.x - downP.x, p.y - downP.y) > DRAG_THRESH) {
        dragged = true
        dragPrev = p // start the pan from HERE, so it doesn't lurch by the threshold
        if (!freeCam) renderer.setCamHold(true)
      }
      if (dragged) {
        renderer.panBy(p.x - dragPrev.x, p.y - dragPrev.y)
        dragPrev = p
        if (hovered || hoverPath) (hovered = hoverPath = null), (hoverIllegal = false)
        scheduleRender()
        return
      }
    }
    if (pending) return // WORLD hover is stale while a timed action runs — locked

    // over an on-screen quick button (sleep/gather): it owns the pointer (its own
    // hover label, like a menu badge) — no tile readout underneath it
    if (renderer.quickHit(p)) {
      if (hovered || hoverPath) (hovered = hoverPath = null), (hoverIllegal = false)
      scheduleRender()
      return
    }

    renderer.setFrame(api.layout)
    const size = renderer.sizeFor()
    const { q, r } = renderer.pixelToHex(api.layout, p.x, p.y, size)
    const h = sim.onMap([q, r]) ? [q, r] : null
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

  // ── the corner boxes' own actions ──────────────────────────────────
  // A BOX IS A THING, AND A THING CAN BE DONE WITH (2026-09-14). Clicking a box
  // of the pack opens a small list ON it: what you carry offers to be put down
  // — one, or all of the kind — and eaten if it's food; the LOAD under the pack
  // offers to put everything down. (The ground offers nothing — picking one up
  // is free and instant, so its click is the action itself; see onPointerDown.)
  // More verbs will land here as they earn it — this is where a thing's own
  // doing lives now.
  const closeRowMenu = () => ((rowMenu = null), (rowMenuHover = null))
  const rowMenuRows = () => {
    if (!rowMenu) return null
    const k = rowMenu.k
    if (rowMenu.side === "load") {
      const pack = sim.inventory()
      const all = Object.keys(pack).filter(x => pack[x] > 0)
      return [{ id: "dropEverything", label: "drop everything", disabled: !all.length || !all.every(x => sim.canAct({ type: "drop", item: x, n: pack[x] })) }]
    }
    if (rowMenu.side === "pack") {
      // THE VERB ALONE: the list stands on the box, and the box IS the thing —
      // naming it again in every row says it twice
      const n = sim.inventory()[k] || 0
      // one of it drops as it is; more offers one or all
      const rows =
        n > 1
          ? [
              { id: "drop1", label: "drop 1", disabled: !sim.canAct({ type: "drop", item: k }) },
              { id: "dropAll", label: "drop all", disabled: !sim.canAct({ type: "drop", item: k, n }) }
            ]
          : [{ id: "drop1", label: "drop", disabled: !sim.canAct({ type: "drop", item: k }) }]
      const e = sim.eatList().find(x => x.k === k)
      if (e) rows.push({ id: "eat", label: `eat · +${e.meal}m · ${e.cost}m`, meal: e.meal, cost: e.cost, disabled: !sim.canAct({ type: "eat", item: k }) })
      return rows
    }
    return null
  }
  const runRowMenu = id => {
    const box = rowMenu
    closeRowMenu()
    if (!box) return
    if (box.side === "load") {
      const pack = sim.inventory()
      for (const k of Object.keys(pack)) if (pack[k] > 0) act({ type: "drop", item: k, n: pack[k] })
      return
    }
    if (box.side === "pack") {
      if (id === "drop1") return void act({ type: "drop", item: box.k })
      if (id === "dropAll") return void act({ type: "drop", item: box.k, n: sim.inventory()[box.k] || 0 })
      return void act({ type: id, item: box.k })
    }
  }

  function onPointerDown(p) {
    worldPress = false
    // THE VOICE'S BOX is on top of everything, and a click on it is read: the
    // next first waiting takes its place, or the box goes. A journal entry in it
    // is put back.
    if (renderer.voiceHit(p)) {
      if (journalPick()) journalOpen = null
      else voiceQueue.shift()
      api.requestRender()
      return
    }
    // THE CORNERS ARE CLICKED, NOT DOUBLE-CLICKED (2026-09-14). A box opens its
    // own actions where it sits; an open list answers before the boxes under it;
    // and the world never reads any of this as a tap on the ground behind.
    if (rowMenu) {
      const row = renderer.rowMenuHit(p)
      if (row) {
        if (row.disabled) closeRowMenu()
        else runRowMenu(row.id)
        api.requestRender()
        return
      }
    }
    // WHAT YOU CAN MAKE, over the pack: a heading folds its row, and a thing
    // clicked is made — when the day is in your hands
    const mk = renderer.makeHit(p)
    if (mk) {
      closeRowMenu()
      if (mk.fold) toggleMakeFold(mk.fold)
      else if (phase === "play" && !pending && !replaying && !dayEnding && !browse)
        makeSpec()
          .flatMap(g => g.items)
          .find(it => it.id === mk.id && !it.disabled)
          ?.run()
      api.requestRender()
      return
    }
    const loadOn = renderer.loadHit(p)
    const placeOn = !loadOn && renderer.placeHit(p)
    const itHit = loadOn || placeOn ? null : renderer.itemHit(p)
    const grHit = loadOn || placeOn || itHit ? null : renderer.groundHit(p)
    if (loadOn || placeOn || itHit || grHit) {
      // nothing on the rows answers while the day is out of your hands
      if (phase !== "play" || pending || replaying || dayEnding || browse) {
        closeRowMenu()
        api.requestRender()
        return
      }
      // THE PLACE'S NAME takes everything lying here — kind by kind, in the
      // order it was put down, as much of each as still fits
      if (placeOn) {
        closeRowMenu()
        for (const e of sim.stashHere() || []) {
          let n = e.n
          while (n > 0 && !sim.canAct({ type: "take", item: e.item, n })) n--
          if (n) act({ type: "take", item: e.item, n })
        }
        api.requestRender()
        return
      }
      // A PILE NEEDS NO LIST: picking one up is free and instant, so the click
      // IS the action (the pile holds many kinds — the box names one).
      // Everything else opens what can be done with it — and the same box
      // clicked again puts the list away.
      if (grHit) {
        closeRowMenu()
        act({ type: "take", item: grHit.k })
        api.requestRender()
        return
      }
      const side = loadOn ? "load" : "pack"
      const hit = loadOn ? { i: 0, k: null } : itHit
      rowMenu = rowMenu && rowMenu.side === side && rowMenu.i === hit.i ? null : { side, i: hit.i, k: hit.k }
      rowMenuHover = null
      api.requestRender()
      return
    }
    if (rowMenu) closeRowMenu() // …and a click anywhere else puts it away (the click still lands)
    // THE BAR IS TWO BUTTONS, split where the name ends: the TITLE opens the
    // helpers, everything from the DATE forward opens the day's log. They're
    // checked before anything else claims the pointer, menu open or closed.
    // Only one list at a time; they'd otherwise hang over each other.
    // DREAMING, the day's own cells stand down (2026-09-09): the angle, the day
    // and the hours take no click and the renderer holds them inverted — the day
    // is replaying itself. The title and your name are not about the day, so
    // they still open theirs.
    const dreaming = dayEnding && !nightRun
    // YOUR NAME on the bar opens who you are (2026-09-02 — it was the lower-left
    // corner, and a hover); one bar menu at a time, like the rest of them
    if (renderer.meHit(p)) {
      // before the key is in, the box IS the ask: a click asks again after a
      // refusal, or once a signer has appeared
      if (phase !== "play" && !pubkey) {
        if (hasNostr() && !asking) askKey()
        api.requestRender()
        return
      }
      meOpen = !meOpen
      if (meOpen) (daysOpen = false), (helpersOpen = false), (logsOpen = false), (anglesOpen = false)
      api.requestRender()
      return
    }
    // THE ANGLE'S CELL drops the shelf's angles (2026-09-04) — the one you're
    // in lit, another switches you into it — with NEW last. Before the world,
    // with nothing on the shelf and no angle held, the cell IS the new button.
    if (!dreaming && renderer.angleHit(p)) {
      if (phase !== "play" && !shelfGames.length && (phase !== "angle" || picker.value() == null)) return newGame()
      anglesOpen = !anglesOpen
      if (anglesOpen) (daysOpen = false), (helpersOpen = false), (logsOpen = false), (meOpen = false)
      api.requestRender()
      return
    }
    if (anglesOpen) {
      if (renderer.angleNewHit(p)) return newGame()
      const g = renderer.angleGameHit(p)
      if (g) {
        if (g.current) {
          anglesOpen = false
          api.requestRender()
        } else switchGame(g.id)
        return
      }
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
    if (!dreaming && renderer.dayHit(p)) {
      daysOpen = !daysOpen
      if (daysOpen) (helpersOpen = false), (logsOpen = false), (meOpen = false), (anglesOpen = false) // one bar menu at a time
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
        meOpen = false
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
      // …RESTORE beside it: cut the save to just before that entry and reboot
      // (row 0 is the wake — restoring there rewinds to the day's morning)
      const rst = renderer.logRestoreHit(p)
      if (rst != null) return restoreTo(browse ? browse.day : liveSim.day(), Math.max(0, rst - 1))
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
      if (helpersOpen) (daysOpen = false), (logsOpen = false), (meOpen = false), (anglesOpen = false) // one bar menu at a time
      api.requestRender()
      return
    }
    if (!dreaming && renderer.logsHit(p)) {
      logsOpen = !logsOpen
      if (logsOpen) (daysOpen = false), (helpersOpen = false), (meOpen = false), (anglesOpen = false) // one bar menu at a time
      logScroll = 0 // a fresh open always starts at the newest entry
      api.requestRender()
      return
    }
    // a helper row: run it and close the list (a `keep` row holds it open, to be clicked again)
    const helper = helpersOpen && renderer.helperHit(p)
    if (helper) {
      const h = helperSpec().find(x => x.id === helper.id)
      if (h) {
        if (!h.keep) helpersOpen = false
        h.run()
      }
      api.requestRender()
      return
    }
    // the end-of-day screen is modal: only "wake up" is live — the DREAM
    // category's own button, standing exactly where sleep stood
    if (dayEnding) {
      if (renderer.quickHit(p) === "wake") wakeUp()
      return
    }
    if (browse) return // the past takes no other input — it is watched, not played
    if (p.y <= HEADER_H) return // the rest of the top status line is inert text now
    if (pending || replaying) {
      // input is locked mid-action — except the one control that exists FOR
      // mid-action: the corner CANCEL, which stops a walk where it stands…
      if (pending?.path && renderer.quickHit(p) === "cancel") cancelMove()
      // …and a NORMAL transit (a walk without the camera ride) lets you GRAB
      // THE MAP: the press arms as a pan — you're a passenger, but you can
      // still look around. Release-without-drag stays inert as ever.
      else if (pending?.path && !pending.cam && p.y > HEADER_H) {
        worldPress = true
        downP = dragPrev = p
        dragged = false
      }
      return
    }
    if (phase !== "play") {
      // before the world: the dot's click, or the angle phase's own
      if (phase === "dot" && renderer.dotHit(p)) beginKey(p)
      else if (phase === "angle" && !renderer.chromeHit(p)) angleClick(p)
      return
    }
    // A CORNER BUTTON, menu open or not (2026-08-28): they're permanent screen
    // furniture now, not the old "quick buttons for when the menu is closed" —
    // and that stale `!menuOpen` gate is why sleep did nothing with the ring up.
    const qb = renderer.quickHit(p)
    if (qb) {
      if (qb === "rest") beginSleep() // …lying down puts the ring away — see beginSleep
      else if (qb === "gather") {
        const y = (sim.gatherInfo() || []).find(e => sim.canAct({ type: e.verb, item: e.res }))
        if (y) startTimed({ type: y.verb, item: y.res }, y.verb === "hunt" ? "hunting" : "gathering", y.cost)
      }
      api.requestRender()
      return
    }
    if (menuOpen) {
      // THE BACK ICON, inside a category: out to the ring
      if (menuSkill && renderer.backHit(p)) {
        menuSkill = null
        menuOpenId = menuFocusId = null
        skillHover = null
        api.requestRender()
        return
      }
      // a hit on the ring: the SIGN runs learn/teach in place (menu stays up so
      // the ring updates and you can take another); the glyph's reference now
      // rides its hover label, so a glyph click is inert.
      // THE KITCHEN comes first: a unit into the pot or one back out — or the pot onto the fire
      const kh = menuSkill === "cook" ? renderer.kitchenHit(p) : null
      if (kh) {
        if (kh.op === "cook") {
          const node = kitchenSpec().cook
          if (node && !node.disabled) node.run()
          if (pending) (menuFocusId = null), (skillHover = null) // the wait began — the click consumed the label
        } else potStep(kh.k, kh.op)
        api.requestRender()
        return
      }
      // …LORE'S JOURNAL: a name opens its entry in the voice's box, and the open one puts it back
      const jh = menuSkill === "lore" ? renderer.journalHit(p) : null
      if (jh) {
        journalOpen = journalOpen === jh.id ? null : jh.id
        api.requestRender()
        return
      }
      // …THE TIMELINE'S NUMBERS: a level's number opens or closes its column
      const tn = renderer.timelineNumHit(p)
      if (tn) {
        toggleTimelineLevel(menuSkill, tn.level)
        api.requestRender()
        return
      }
      // …and THE TIMELINE: a box makes its thing; a greyed one does nothing (its bill says why)
      const th = renderer.timelineHit(p)
      if (th) {
        const node = timelineNode(th.id)
        if (node && !node.disabled) {
          node.run()
          hovered = hoverPath = null, hoverIllegal = false // the action may have changed the view
          if (pending) (menuFocusId = null), (skillHover = null) // the wait began — the click consumed the label
          else menuFocusId = th.id
        }
        api.requestRender()
        return
      }
      const sh = renderer.skillHit(p)
      if (sh) {
        if (sh.kind === "action" && sh.action === "learn") {
          // A LESSON TAKES ITS MINUTES IN ORDER — the same wait as a gather: the
          // clock drips its minutes as they pass, input locks for the duration (so
          // the button cannot be hit twice), and the sim applies the edge
          // atomically on completion, so abandoning it mid-wait spends nothing.
          // The hover deliberately STAYS: that button is the progress display
          // (the ring's growing edge — see the renderer).
          // A lesson the sim would refuse (the clock previews it red) doesn't start.
          if (sim.canAct({ type: "learn", skill: sh.skill }))
            startTimed({ type: "learn", skill: sh.skill }, "learning", sim.lessonCost(sh.skill))
        } else if (sh.kind === "action" && sh.action) {
          act({ type: sh.action, skill: sh.skill })
          // the gift may have used up the button (they hit the cap) — drop the
          // now-stale hover so it doesn't cling to a vanished button (no pointer
          // move will arrive to clear it)
          if (skillHover?.kind === "action" && !skillActionable(skillHover.skill)) skillHover = null
        } else if (sh.kind === "info" && sh.skill === "dream") {
          // THE DREAM GLYPH IS THE SLEEP BUTTON (2026-09-18): awake, its click
          // lies you down where you stand — when the gate passes. When it
          // fails the click does nothing, and the glyph's hover says why. The
          // dream category never opens from here: the only way in is to sleep
          // (the dream screen draws it itself — THE DREAM MARK in render).
          if (sleepGate().can) beginSleep()
        } else if (sh.kind === "info" && menuSkill === sh.skill) {
          // …the OPEN one is the way back out: click it again and the category
          // closes, the ring returns (2026-08-28)
          menuSkill = null
          menuOpenId = menuFocusId = null
          skillHover = null
        } else if (sh.kind === "info") {
          // a skill IS a category (2026-08-10): its glyph opens its actions —
          // the skill takes the centre, the ring gives way to its radial hexes.
          // Every skill but dream opens, an empty fan included — the category
          // exists before it has contents, and finding it empty is finding that out.
          menuSkill = sh.skill
          menuOpenId = menuFocusId = null
          skillHover = null
          journalScroll = 0 // the journal opens on its newest
          journalOpen = null // …with nothing in the box
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
      // ANYWHERE ON THE TILE dismisses the menu: the hexagon actually drawn —
      // the renderer answers from its own geometry, not from a hex-grid guess.
      // Items were claimed above, so only the tile's own ground reaches here;
      // beyond it is inert as ever — a miss doesn't close anything. Inside a
      // category the middle is the category's own: the back icon is the way out.
      if (!menuSkill && renderer.menuTileHit(p)) {
        closeMenu()
        api.requestRender()
      }
      return
    }
    // a press on the world (menu closed): don't act yet — arm it, and record the
    // tile it landed on. The tile action fires on RELEASE; a press that travels
    // instead is a drag, and moves the map.
    worldPress = true
    downP = dragPrev = p // arm the tap/drag test from here
    dragged = false
    renderer.setFrame(api.layout)
    const size = renderer.sizeFor()
    const { q, r } = renderer.pixelToHex(api.layout, p.x, p.y, size)
    downTile = sim.onMap([q, r]) ? [q, r] : null
  }

  // The tile action lands on RELEASE, at the tile the pointer lifts over —
  // unless the press travelled, which made it a drag of the map. Chrome
  // (header, replay, menu) acted on the press and left worldPress false, so
  // those releases do nothing here.
  function onPointerUp(p) {
    if (phase === "angle") return angleRelease()
    if (!worldPress) return
    worldPress = false
    // a DRAG was a pan, not a tap — consume the release, act on nothing
    const wasDrag = dragged
    dragged = false
    downP = dragPrev = null
    if (wasDrag) return
    if (!p || p.y <= HEADER_H || pending || replaying) return
    renderer.setFrame(api.layout)
    const size = renderer.sizeFor()
    const { q, r } = renderer.pixelToHex(api.layout, p.x, p.y, size)
    const t = [q, r]
    if (!sim.onMap(t)) return // beyond the field
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
    if (sim.canMove(t)) startMove(t) // walk (or back) to any reachable tile; crossing a river is just the last step
  }

  // ── screen lifecycle ───────────────────────────────
  function enter(a) {
    api = a
    hovered = hoverPath = null, hoverIllegal = false
    shelfGames = gamesList().sort((a, b) => String(Math.round(a.angle)).localeCompare(String(Math.round(b.angle))))
    try {
      freeCam = localStorage.getItem(KEYS.freeCam) === "1"
      perfOn = localStorage.getItem(KEYS.perf) === "1"
    } catch {}
    renderer.setFreeCam(freeCam)
    renderer.setPerf(perfOn)
    // a remembered key opens on the "key" phase with the name already in; if
    // the relays never answered for it, ask them now (best-effort, no prompt)
    // …and NEW GAME asked for from play (2026-09-04) reboots with that intent
    // kept: the compass opens as soon as the key's profile is settled
    try {
      pendingNew = sessionStorage.getItem(INTENT_KEY) === "new"
      sessionStorage.removeItem(INTENT_KEY)
    } catch {}
    if (phase === "key" && pubkey) watchMe() // …a name already cached settles at once; the watch runs on regardless
  }

  // THE WHEEL: over the unrolled log it scrolls a row at a time, deeper into
  // the day; on lore's journal an entry a notch; anywhere else, menu down, it
  // zooms the map about the pointer. Returns true when it took the gesture, so
  // the page doesn't also scroll.
  let zoomWake = null // the zoom readout's one wake, when its fade is due
  function onWheel(p, dy) {
    // LORE'S JOURNAL takes the wheel while it's open: an entry a notch
    if (menuOpen && menuSkill === "lore" && !(logsOpen && renderer.logsScrollHit(p))) {
      const next = Math.max(0, Math.min(journalNotes().length - 1, journalScroll + Math.sign(dy)))
      if (next !== journalScroll) {
        journalScroll = next
        api.requestRender()
      }
      return true
    }
    if (logsOpen && renderer.logsScrollHit(p)) {
      const step = Math.sign(dy) * Math.max(1, Math.round(Math.abs(dy) / 40))
      const next = Math.max(0, Math.min(renderer.logsMaxScroll(), logScroll + step))
      if (next !== logScroll) {
        logScroll = next
        api.requestRender()
      }
      return true // ours either way — at the ends too, or the page jumps instead
    }
    if (!menuOpen && phase === "play" && !dayEnding && !browse && !replaying) {
      renderer.zoomMap(p, dy)
      onPointerMove(p) // …the tile under a still pointer changed: aim the hover again
      // the zoom readout holds without frames; one wake when its fade is due
      clearTimeout(zoomWake)
      zoomWake = setTimeout(() => api.requestRender(), renderer.zoomHoldMs + 16)
      return true
    }
    return false
  }

  function leave() {
    stopLoop()
    stopReplay()
    stopKeyWatch()
    pending = null // atomic waits: an abandoned action never happened
    dayEnding = false
    menuOpen = false
    menuOpenId = menuFocusId = null
    worldPress = dragged = false
    downP = dragPrev = null
  }

  function voiceNow() {
    const picked = journalPick()
    if (picked) {
      const v = voiceOf(picked)
      return { ...v, head: v.when, more: 0 }
    }
    return voiceQueue.length ? { ...voiceOf(voiceQueue[0]), more: voiceQueue.length - 1 } : null
  }

  function draw(ctx, L) {
    // While a timed action is in transit the pointer is locked (onPointerMove
    // bails), so any hover route is STALE — and drawn at hex coords it would slide
    // along with the map under the still cursor. Drop it; it refreshes on landing.
    // …and the same holds for the day-end screen and the past: a stale world
    // hover must never outlive the moment it was aimed
    const inTransit = !!pending || dayEnding || !!browse
    renderer.draw(ctx, L, {
      hovered: inTransit ? null : hovered,
      hoverPath: inTransit ? null : hoverPath,
      hoverIllegal: inTransit ? false : hoverIllegal,
      skillHover: menuOpen ? skillHover : null, // hovered skill slot → name label + reference + cost preview
      itemHover, // hovered pack chip → its full readout (weight, keeping, uses, what it's for)
      groundHover, // …and the hovered box of the tile's own pile (lower-right)
      rowMenu: rowMenu ? { side: rowMenu.side, i: rowMenu.i, k: rowMenu.k, rows: rowMenuRows() } : null, // a box's own actions, opened on it
      rowMenuHover, // …and the row of that list under the pointer
      makes: phase === "play" && !browse ? makeSpec() : null, // what you can make right now, over the pack
      pointer: lastP, // our own cursor dot — ALWAYS, chrome and sleep screen included
      phase, // dot | key | play — before "play" the renderer draws the intake instead of the world
      dotHot, // …the dot phase's one hover
      keyWaiting: phase === "key" && !pubkey, // …and the key phase still waiting for its signal
      signer: hasNostr(), // …whether there is an extension at all: without one the dot never leaves the title
      meWaiting: phase === "key" && (!pubkey || profileBusy), // …and its box still black: no key yet, or the profile still looked up
      me: meBlock(), // who you are: your name on the bar, its facts dropped under it on a click
      meOpen, // …and whether that block is down
      games: anglesOpen ? shelfGames : null, // the angles under the ANGLE's cell — every game you've started, alphabetically
      gameCount: shelfGames.length, // …how many there are, open or not (none: the cell is the NEW button itself)
      newPressed: phase === "angle" && picker.value() == null, // …and NEW held down while the compass is out and nothing is held yet
      anglePending: phase === "angle" && picker.held(), // …and the angle held but not yet struck: its cell stands pressed too
      // the angle phase's picker, drawn by the renderer on the ring at rest
      pick: phase === "angle" ? { draw: (c, l, d) => picker.draw(c, l, d), sweep: picker.sweep(), compassR: picker.compassR(), compassA: picker.compassA(), twin: picker.twin(), bow: picker.bow(), cursor: picker.cursor(), settle: picker.settle(), fired: picker.fired(), ready: picker.ready(), openAmt: picker.openAmt(), onReading: picker.onReading() } : null,
      used: shelfGames.map(g => Math.round(g.angle)), // …and the angles already struck: hollow dots on the ring, not for choosing again
      angle: phase === "play" ? sim.angle() : phase === "angle" ? picker.value() : null, // …and the angle you chose (or hold on the compass), on the bar beside your name
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
      restBtn: false, // SLEEP is the DREAM GLYPH on the ring now (2026-09-18) — see sleepBtn
      // THE DREAM GLYPH'S GATE: awake, the glyph is the sleep button — whether it
      // can be pressed right now and, when it can't, why (its hover says so).
      sleepBtn: sleepGate(),
      // mid-WALK the corner offers the one control that still applies: STOP
      // where we stand (scouts and in-place work run their course — no path
      // to cut short). Only on walks of 3+ tiles: on a hop the button just
      // flashed past — there is nothing meaningful to cancel.
      cancelBtn: !!(pending && pending.path && pending.path.length > 3 && !replaying && !browse),
      playBtn: false, // (play folded into the title's helpers as "playground" — 2026-08-10)
      gatherBtn: false,
      dayEnd: dayEnding ? { day: sim.day(), pointer: lastP, leaving: nightRun } : null, // the end-of-day sleep screen (leaving = the wake sweep is playing)
      // THE INNER VOICE — the oldest first not yet read, and how many wait behind
      // it; or, the journal open, the entry picked there, its date where its name
      // was. It holds its tongue while you dream and while you look back.
      voice: phase === "play" && !dayEnding && !browse ? voiceNow() : null,
      pending: pendingView()
    })
    // keep frames coming while the camera glides to its new anchor, or the skill
    // ring eases between the sky teardrop and the menu's circle. MUST go through
    // scheduleRender's single-flight gate: a raw rAF here would add one whole new
    // self-perpetuating draw chain per external render request (every pointer move
    // during an animation), multiplying full draws per frame until the UI crawls.
    if (renderer.camAnimating() || renderer.menuAnimating() || renderer.restAnimating() || renderer.dreaming() || renderer.endSweeping() || renderer.quickPopping() || renderer.logFlashing() || renderer.wakeFilling() || renderer.listsAnimating() || renderer.rowMenuAnimating() || renderer.eyeMoving() || renderer.zoomFading() || renderer.previewArriving() || renderer.intakeAnimating() || renderer.gateShooting() || (phase === "angle" && picker.animating())) scheduleRender()
    // THE BLAST ASKS THE SIGNER (2026-09-04): the reel reaching the centre fires
    // it inside the draw — the prompt goes out as the dots do
    if (renderer.intakeAskDue()) armAsk()
    // THE MENU'S CLOSE LANDS: the map takes the pointer back, and its hover is
    // aimed now — no pointer move comes to ask for it
    const shut = renderer.menuShut()
    if (shut && !wasShut && lastP && phase === "play") onPointerMove(lastP)
    wasShut = shut
    // THE BOXES MOVE UNDER A STILL POINTER (2026-09-25): pick a thing up, drop
    // one, let one spoil — the corner rows re-lay out with no pointermove to
    // follow, and a hover held BY INDEX would then light whichever box slid into
    // that slot. Re-aim both against the layout THIS frame just drew: the boxes
    // have moved, so only now is the question answerable. (The menu's mid-walk
    // re-aim is the same idea from the other side — see updateMenuHover.)
    if (lastP && phase === "play") {
      const it = renderer.itemHit(lastP)?.i ?? null
      const gr = it == null ? renderer.groundHit(lastP)?.i ?? null : null
      if (it !== itemHover || gr !== groundHover) {
        itemHover = it
        groundHover = gr
        scheduleRender()
      }
    }
  }

  const screen = {
    id: "hexgrid",
    enter,
    leave,
    onPointerMove,
    onPointerDown,
    onPointerUp,
    onKey,
    onWheel,
    draw
  }
  return screen
}
