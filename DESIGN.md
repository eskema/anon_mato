# anon&mato — design canon

The game presents as **anon&mato** ("Thrive" was an old working name; the repo,
package id and paths keep `thrive`). It runs standalone (no build step, vanilla
ES modules, Canvas2D) and is meant to also run as a napp inside the nostrapps
launcher.

**Status: the design is still settling.** Several core systems (the energy
model above all) have already been reworked more than once and will move again.
Code should optimise for cheap change: rules and tunables in one place, no
speculative abstractions for unbuilt features.

## Pillars

- **Time loop.** Nested scales: year (12 months × 30 days) → day (24 h) → hour
  (60 min). The minute is the finest unit. A stacked clock across the top shows
  and plays this loop.
- **No win/lose.** Survival + building + resource gathering + automation. The
  player gains abilities over time and sets up "patterns" within the loop;
  patterns grow or collapse; on collapse they revert to the base pattern and
  the player goes back to tweak them.
- **Energy IS time (minutes).** Traversal spends time. Start with a very
  reduced budget (60 min, grows later). Home is timeless — no cost there, and
  it's where time/energy resets.
- **Day cycle.** Awake 06:00–22:00, must sleep at 22:00 (wakes 06:00). The
  player cannot leave home during sleep hours.
- **Time vs tiles are SEPARATE axes.** Time is one continuous clock; a
  timestamp is a moment, not a place. Tiles are space — a fractal nested hex
  world (grids inside tiles inside tiles). The one-directional link: the time
  scale influences movement resolution on the tiles (finer scale → finer
  movement). The clock breadcrumb is the CLOCK, not the spatial path.

## The world

- Radius-4 hex grid (61 tiles) per tile, arranged radially. Each tile lazily
  contains a child grid per hex (`world.js` tree) — re-entering a tile is the
  same place.
- Orientation flips by depth (flat/pointy alternate) so a tile's interior reads
  consistently when later shown shrunk inside its opposite-orientation parent.
- **We start at depth 1, INSIDE the home tile** (`BASE_DEPTH = 1`). The
  outside/map view (depth 0) exists as a locked parent, "gained" later.
- **Inside-home is the default view** and a **safe space** (`safe: true`):
  free movement/discovery (no energy cost, no reserve), walled off except the
  gate direction. You start on the **centre special tile** (opens the cube
  view — reserved for special tiles, not built out yet). The home interior is
  otherwise a NORMAL tile — no special-casing beyond its props.
- **Edge tiles** = the 6 neighbouring-grid silhouettes drawn around a tile's
  interior. They obey the UPPER (parent) grid: their screen directions snap to
  the parent grid's six directions. Exiting through one is a normal
  parent-scale move onto the mapped parent neighbour (super index i → parent
  DIR is a fixed bijection per orientation parity).
- **Sliding**: from a border edge you can slide laterally to the neighbouring
  sibling grid (exit up + re-enter, no zoom out). Go-up to the parent view is
  hidden until the parent view is earned.

## Energy / movement model (reworked 2026-07-01 — one-way costs)

- Costs are **one-way, never refunded**. Two actions:
  - **SCOUT** (`scout`): reveal an adjacent undiscovered tile WITHOUT moving,
    cost `SCOUT_FRACTION (0.6) × level base` — deliberately MORE than a walk.
  - **MOVE** (`move`): step onto *known* ground only, cost
    `MOVE_FRACTION (0.4) × level base` per step. Backtracking costs too —
    walking home is time that passes.
- Level base cost: `COST_HOME = 180` at the (locked) outside scale, divided by
  `SCALE_RATIO = 6` per level down (home interior 30, inside a tile 5). With
  `ENERGY_START = 60`, energy is literally minutes.
- **Return reserve**: the shortest known way home (BFS through discovered
  tiles to the nearest reached exit, plus parent trails and climb-out costs)
  is always reserved: `canMove(t)` = route exists AND path + return-from-t is
  affordable; `canScout` = frontier AND scout + current return affordable.
  **Never-strandable** is an invariant: the reserve always covers the trip
  home.
- Energy refills **only by resting at home** (the safe-space centre) → sleep →
  next day.

## Discovery (fog of war)

- Each tile keeps a persistent `discovered` set of explored hexes. Only
  discovered tiles + the player's own frontier render; beyond is fog.
- Exploration is **deliberate clicks** (hover must NEVER reveal or discover).
  The tedium is intentional — abilities will automate it later.
- **Discovery is an immutable one-way ratchet.** Nothing ever un-discovers a
  tile. `reachedEdges` (which of a tile's 6 edges the player has stood at) is
  the same kind of ratchet. During replay the fog is re-opened progressively —
  display-only, via per-day journals; the underlying sets never shrink.

## The action log (the design's centre of gravity)

- The game is a deterministic sim. A day's actions are recorded as a log;
  **replay = restore the day-start snapshot + re-apply the log** (the play
  button animates it: cube, timeline and fog together, like a drum machine).
- **Editing a day = change the log + re-simulate.** Edits cascade forward
  (discovery + abilities propagate to later days); the discovery ratchet means
  later days can't lose ground, but energy/abilities genuinely cascade.
  Invalid-action policy when editing lands: leaning grey-as-broken.
- Days advance on sleep. Each banked day stores its log AND its day-start
  snapshot, so any day is reconstructible (days can start away from home via
  rest-and-resume).
- Persistence (Nostr events) is deferred; log schema versioning deliberately
  NOT handled yet — revisit when persistence lands.

## Timed actions

Actions aren't instant — you wait out their cost in real time
(`TIME_SCALE = 1000` ms per minute, fast-forwarded by `WAIT_SPEED = 60` for
now; a future upgrade shrinks the real wait while the simulated cost stays).
A move walks step-by-step with the cube advancing live; a scout waits in
place. Input locks while waiting. The wait is presentation: the sim applies
the action atomically when the wait completes (abandoning mid-wait spends
nothing).

## Architecture (post-rewrite)

- `lib/hex.js` — pure hex/cube math + the two orientation matrices.
- `lib/world.js` — the fractal tile tree (spatial state only).
- `lib/sim.js` — **the game.** Pure and headless (runs in node): world, view
  stack, energy, costs, discovery, topology tables (super index ↔ parent DIR,
  parked edge-centre tiles), the action log, day snapshots, replay hooks.
  One `dispatch(action)` / `apply(action)` pair is the ONLY way state changes;
  live play, replay and future editing all flow through it. No canvas, DOM or
  timers here, ever.
- `lib/render.js` — draws sim state + presentation state. Pixels never decide
  sim outcomes.
- `lib/grid.js` — the screen/controller: pointer → actions, timed-action
  waits, replay timer, hover previews.
- `lib/timeline.js` — the stacked clock (display-only).
- `lib/app.js` — canvas/screen engine. `lib/cube.js` — cube-view experiment.
- `test/` — node:test suite pinned to INVARIANTS (never-strandable,
  replay == live, ratchets only grow, action validation), not to tunable
  numbers, so it survives design reworks.

### Invariants (tested)

1. Energy never goes negative; outside safe tiles the return reserve is always
   affordable.
2. Replay reproduces the live day exactly (same end state from snapshot+log).
3. `discovered` / `reachedEdges` only ever grow.
4. Invalid actions are rejected by the sim (not just hidden by the UI).
5. The sim runs headless.

## UI conventions

- All UI text 16px (weight/opacity for hierarchy, never smaller sizes); the
  one deliberate exception is the collapsed clock status line at 11px.
- CSS grid as the layout base; flex only for equal-distribution rows.
- "Status line" = the budget/time-left line (`at [q,r] · 60m until rest · …`),
  not the top title line.
- The player cube is a plain hexagon outline + 3 inner radial lines — NOT a
  shaded/3D cube.

## Not built yet / parked

- Cube view content (special tiles), parent-view "earn" mechanic, day
  navigation + log editing UI, abilities/automation, fruit (first resource),
  Nostr persistence, the angle-picker setup flow (`lib/setup/`, stashed).
