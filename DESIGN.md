# anon&mato — design canon

The game presents as **anon&mato** ("Thrive" was an old working name; the repo,
package id and paths keep `thrive`). It runs standalone (no build step, vanilla
ES modules, Canvas2D) and is meant to also run as a napp inside the nostrapps
launcher.

**Status: the design is still settling.** Several core systems (the energy
model above all) have already been reworked more than once and will move again.
Code should optimise for cheap change: rules and tunables in one place, no
speculative abstractions for unbuilt features.

## Terminology (short on purpose — these are the words we use)

- **board** — one tile's playable interior grid (radius 4, 61 hexes)
- **seam** — the shared one-tile row between boards (the parent grid's edges)
- **post** — a seam tile where three boards meet (a parent vertex)
- **gate** — the single doorstep EDGE that opens a walled board
- **cross** — stepping off the seam onto another board (the boards slide)
- **clear** — fully discover a board (what opens its gate)
- **home** — the walled safe board you start on
- **fog** — undiscovered ground; **trail** — the day's committed path
- **angle** — the setup angle (0° up, clockwise); it seeds where the gate falls

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
  free movement/discovery (no energy cost, no reserve), fully walled with a
  single (initially closed) gate. You start on the **centre special tile**
  (opens the cube view — reserved for special tiles, not built out yet). The
  home interior is otherwise a NORMAL tile — no special-casing beyond its
  props. Clearing it is the first task: that opens the gate.
- **The seam** (settled 2026-07-02, superseding both the edge-tile silhouettes
  and the brief flush-perimeter version): sibling boards are pushed apart by
  exactly ONE hex row on a single shared lattice (offsets = rotations of
  (2R+2, −(R+1)), which sit at the clean ±30/±90/±150° screen directions — the
  snapped look, now exact). The in-between row is the SEAM: the parent grid's
  EDGES made of child-scale tiles (4 side tiles per shared edge), and where
  three boards meet, a JUNCTION tile — a parent VERTEX. The view shows the
  interior, the seam ring, and the neighbours' facing rows: one continuous
  field.
- **Seam tiles are ordinary walkable ground, shared by both boards** of their
  edge: their state (discovery, types) lives on the PARENT node keyed by
  global child-scale coords, so scouting one from either side reveals it for
  both. Junctions behave like the rest of the seam — little crossroads into
  any of the three boards they touch.
- **Crossing**: scout/step your way onto the seam, then step off onto a
  neighbour's tile — that landing step is the crossing; you arrive on that
  exact tile and the boards slide. No intermediate state. At the parent scale
  the crossing IS a step: the sibling's parent tile becomes discovered and the
  parent trail extends (or retraces); the cost charged is the plain local
  step. The old parent-discovery gate (discoverEdge) is gone. The super-index
  → parent-DIR bijection per orientation parity remains the constant that maps
  neighbour directions to parent tiles. Go-up stays hidden until earned.
- **The frame follows the seam** (2026-07-03, fixes stranding behind walled
  boards): a move ending on a seam tile beyond the current board's ring slides
  the view to a board that owns that segment (preferring one already
  discovered at the parent scale), the player staying on the very same seam
  tile. No discovery, no entering — the camera's board changes hands, the
  parent trail extends/retraces, the step costs its plain charge. This makes
  the whole seam network roamable and any walled board's ring circumnavigable
  from outside back to its gate.
- **SPACE IS GLOBAL** (2026-07-03, the third and final spatial model): each
  depth level is ONE continuous lattice; the player, the entry and the trail
  live in global coordinates on it. There are no frames: crossing into another
  board is an ordinary step (the parent trail extends/retraces and the parent
  tile becomes discovered as bookkeeping), the trail is never translated or
  truncated, and retraces work across any number of boards natively. The
  camera is pure presentation: board-centred while on a board, player-centred
  on the seam (the classic inversion), panning with the walking ghost.
  Rendering is one global pass — every discovered tile in the viewport draws,
  culled at ~4 board-pitches around the camera or ~2 screenfuls, whichever is
  smaller. The old frame model (edge tiles → parked slides → frame-follows-
  the-seam) is fully retired; go-up/exit actions are retired with it until
  the parent view is earned.
- **Walls** (generalised 2026-07-03): any side of any hex can be walled —
  walls are per-hex bitmasks (6 bits, one per side) on the owning board's
  node; seam hexes carry theirs on the parent node keyed by global seam
  coords, so both boards of an edge see the same. A wall on EITHER side of an
  edge blocks the step across it. This is the world-building primitive:
  rooms, corridors, sealed boards are all just wall bits.
- **The gate** (refined 2026-07-03): the gate belongs to the board, not the
  seam — it is a single EDGE of the doorstep tile (the last interior tile the
  seed angle's ray crosses on its way out). A gated board walls every border
  hex's outward sides, gate edge included; the gate starts CLOSED and
  ratchets open (that one wall bit clears for good) when the board is
  **cleared** (all 61 hexes discovered). GATE_TILE — the seam hex just beyond
  the gate edge — still names where the ray exits the grid. The seam itself
  is outside every wall — and outside the safe umbrella: inside the home,
  interior moves/scouts are free, but anything targeting seam or beyond
  charges normally.
- **Tile types**: every hex can carry a type (sparse, per tile node); a type's
  properties are cost multipliers on the level base. Seam tiles default to the
  `seam` type (move ×0.5 — the cheap roads); board interiors default to
  `plain` (×1). The standing hook for terrain/specials with real costs.

## Energy / movement model (reworked 2026-07-01 — one-way costs)

- Costs are **one-way, never refunded**. Two actions:
  - **SCOUT** (`scout`): reveal an adjacent undiscovered tile WITHOUT moving,
    cost `SCOUT_COST (1) × level base` — discovering is cheap; walking there
    is the commitment.
  - **MOVE** (`move`): step onto *known* ground only, cost
    `MOVE_COST (2) × level base` per step, halved on seam tiles (1) — the
    seams are the roads, cheap to travel. Backtracking costs too — walking
    home is time that passes.
- Level base cost: `COST_BASE = 1` at the playing depth (the unit everything
  prices off), multiplied by `SCALE_RATIO = 6` per level UP (inside a tile 1,
  home interior 6, outside 36). With `ENERGY_START = 60`, energy is literally
  minutes.
- **Return reserve** (made EXACT 2026-07-03): the reserve is the true cheapest
  charge of walking from a position back to the day's entry over discovered
  ground — one Dijkstra sweep from the entry (steps into safe interiors charge
  0), cached until discovery/walls/entry change. `canMove(t)` = route exists
  AND path + return-from-t is affordable; `canScout` = frontier AND scout +
  current return affordable. **Never-strandable** is literal: at
  `energy == reserve` the walk home is affordable to the minute, so every
  trail tile behind the player stays a valid retrace all the way down to
  depletion. (The UI additionally falls back from an unaffordable trail
  retrace to the plain shortest route, so hover/click never die.)
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
