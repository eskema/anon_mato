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
- **leap** — the power move: jump the diagonal (the tile beyond the edge two
  adjacent neighbours share) for one step's price

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
  - **LEAP** (part of `move`, `LEAP` flag — dev-on for playtesting, later an
    unlockable ability): jump the DIAGONAL — the tile directly beyond the
    edge two adjacent neighbours share — for the price of ONE step onto the
    landing (2 plain, 1 seam). The leap rides that shared edge like a road:
    out through the vertex between the flankers, along their edge, in through
    the far vertex. Legal when both flanking tiles are discovered and no wall
    touches the corridor (the two edges at each vertex + the ridden edge) —
    so a gate funnels single-file STEPS, never leaps. The flankers are never
    stood on, charged, or trailed. Collinear 2-out through a tile's centre is
    NOT a leap, and seam runs line up collinear — no leaping along the seam
    (the seam keeps its own half-price steps instead). Leaps are ordinary
    edges of the move graph — routing, the reserve and retraces all use them,
    and they chain. Consequence: the reserve prices the LEAP route home, so a
    full walking retrace can honestly exceed it near depletion (the UI falls
    back to the shortest route).
- Level base cost: `COST_BASE = 1` at the playing depth (the unit everything
  prices off), multiplied by `SCALE_RATIO = 6` per level UP (inside a tile 1,
  home interior 6, outside 36). With `ENERGY_START = 60`, energy is literally
  minutes.
- **Resting places + the return reserve** (generalised 2026-07-04): the world
  keeps a list of RESTING PLACES a day can end and restart from — the home
  centre is entry one; future built spots (camps, waystations…) join the
  list. The loop stays closed and compilable: you can only continue while at
  least one resting place is affordably reachable, so a saved state is always
  a safe state. The reserve is the true cheapest charge from a position to
  the NEAREST resting place over discovered ground — one multi-source
  Dijkstra seeded at every spot (steps into safe interiors charge 0), cached
  until discovery/walls/the spot list change. `canMove(t)` = route exists AND
  path + reserve-from-t is affordable; `canScout` = frontier AND scout +
  current reserve affordable. **Never-strandable** is literal: at
  `energy == reserve` the trip to safety is affordable to the minute. The way
  back need not retrace: the router recomputes the best route (leaps and
  seams included), and the UI falls back from an unaffordable trail retrace
  to that shortest route, so hover/click never die. Resting ANYWHERE is
  deliberately not allowed — rest happens at resting places only.
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
- **The save IS the log** (landed 2026-07-04): `serialize()` returns plain
  JSON — `{schema, world: {angle, rings, rules}, days: [{day, actions}],
  today}` — no world state; everything derives by replay. `hydrate()`
  re-dispatches every action from day 1 on a FRESH sim and refuses on any
  mismatch: `SCHEMA` stamps the format, `RULES` stamps replay semantics and
  bumps on ANY change that alters what an old log replays to (dev-phase rule:
  mismatched saves reset, stashed not destroyed). Day-enders (rest / goHome /
  restResume) are logged — pushed before running, they bank as their day's
  last entry, which is what lets a save replay ACROSS days. The controller
  mirrors every successful dispatch to localStorage (`anon&mato:save`).
- Nostr rides the same format later: one event per banked day (NIP-78 style,
  `d = anon&mato:<world>:day:<n>` — editing a day republishes one event) plus
  a replaceable head event; the npub is the player, and deriving each world
  from the pubkey is a founding goal (collaboration via nostr later).

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

## The arc (vision, 2026-07-04 — north star, not scheduled)

- **Your world is the parent grid**: the 61-board depth-1 level (~3721
  interior tiles + seams) is the player's own derived world. The literal
  npub inscription lives at THIS scale — 64 pubkey nibbles → 61 parent
  tiles (centre-out spiral; nibble 0 = the home board) + 3 meta; each
  nibble sets a board's biome/character, child boards derive from the
  hash chain (`childSeed = H(parentSeed ‖ path)`).
- **Progression = the gate rule, self-similar**: clear the home board →
  its gate opens; clear the world (or an ability-gated threshold of
  boards) → the world's RIM opens onto the inter-player lattice. Outside:
  other players' npub-derived worlds, generated/collaborative maps, and —
  far out — mining worlds. You grind to full freedom.
- **Builder loop**: buildings/factories/tasks (the "patterns" pillar made
  concrete) generate energy inside the day cycle. **High score = surplus
  energy at the end of the year loop** — and because the save is the log
  and worlds derive from the npub, a published year is a VERIFIABLE
  score: anyone replays the log on the derived world and confirms it.
  Trustless leaderboards for free.
- **The angle is social, never power** (doctrine 2026-07-04): luck may
  come ONLY from the pubkey — the dice you can't load (vanity grinding
  is the bounded exception, and the only place effort buys luck). The
  angle is a free choice, so it must never confer solo advantage or
  players converge on the "best" number. What it does is create FACTIONS
  and narrative, all of it relational: (1) same angle = same faction,
  and the angle IS a hue (HSL's 0–360 wheel, no mapping needed) — your
  color on the lattice, trail tint, flag; (2) the circle divides into 4
  quadrants — the coarse fronts; (3) opposite/complementary angles shape
  collaboration and trade favorability; triads (±120°), near-kin (±5°),
  and 180° rival-and-ideal-trading-partner are free extensions.
  **The meanings are CONCEALED at pick time**: the picker shows pure
  geometry (a number, a ray) — no hue preview, no faction hint. The
  consequences reveal themselves in play, each at its own moment: the
  HUE comes fairly early and with a USE — it marks what's YOURS (trail,
  angle line, later buildings; candidate reveal moment: the first gate
  opening — exact moment TBD). The faction/relational meanings wait for
  the social layer; the season phase is noticed, not announced. Choosing
  blind makes the choice expressive rather than optimal; spoilers only
  ever buy aesthetics, so foreknowledge is harmless.
- **The UI is progression** (2026-07-04): you don't only gain stats —
  you gain INSTRUMENTS. Day one is nearly naked (a board, fog, your
  feet); the clock, the expanded timeline, replay, the logs journal,
  helpers, day navigation, the map/parent view — each is an unlockable
  tool revealed at its own time, teaching its concept the moment it
  arrives (onboarding = the reveal schedule; no tutorial). The dev build
  is simply "everything unlocked". Discipline: build every UI surface as
  an independent, gateable panel — never assume a panel exists from
  day 1. This unifies the earlier notes: parent view "earned", go-up
  hidden, abilities automating exploration — all instances of this rule.
- **Seasons / weather (crude)**: sunlight varies over the 360-day year;
  every player runs the SAME season curve, phase-rotated by their angle,
  and starts at the same relative point in their own curve — fair by
  symmetry, equal totals over the loop, identical solo experience. The
  phase exists only RELATIVE to other players, which is what powers
  front (3): your winter is literally an opposite angle's summer, so
  trade favorability EMERGES from phase-shifted surplus cycles rather
  than a bonus table. Baseline daily 60 stays sacred; seasons modulate
  the SURPLUS side (generation, growth, factory output) only — winter is
  what the builder layer must carry you through.

## Idea box (unsorted — thrown in raw, to make sense of later)

- **Land types (proposed 2026-07-05, not settled)**: heights from the key —
  water classified on SMOOTHED values (coherent seas), mountains keep RAW
  spikes. Three bases (water/plain/mountain) + subtypes from the neighbour
  grammar (own base + 6 neighbours, priority marsh→beach→forest→plain):
  water (fish, impassable on foot), plain (plants), beach (plain+water:
  fish), marsh (plain+≥2 water: rich plants, slow), forest (plain+mountain:
  WOOD, animals), mountain (ROCK), cliff (mountain+water: eggs, rock), peak
  (raw ≥e: METAL, rare). 8 types total; quadrants are SKIN not mechanics
  (same forest, boreal vs jungle look). Materials wood/rock/metal each have
  one home; food = plants (plain/marsh) + animals (forest/fish).
  **WORLD-SCALE (clarified 2026-07-06)**: the terrain field spans the whole
  parent level (~3721 tiles across all 61 boards, per-board nibble streams
  from the hash chain; the literal npub inscription stays home-only =
  identity, not terrain). Smoothing/adjacency are global, so seas and
  ranges span boards. Seams stay always-walkable roads → water can be
  hard-impassable with no stranding; interior tiles sealed behind water are
  FUTURE CONTENT (boats). Open: seams in the terrain field — lean (b) roads
  mechanically, dressed by what they pass through (ford/bridge/trail).
  Bonus correspondence: home board (61 tiles) ↔ world (61 boards) — home
  as the literal world minimap, earned by clearing it.
  **TWO-OCTAVE DERIVATION (validated in world.html, user-approved
  2026-07-06)**: BASE = the world key's 64 nibbles on the PARENT grid in
  reading order (centre board = middle four averaged — the home-inscription
  scheme one scale up), interpolated between board centres (inverse-pitch
  weights) so the macro field is continuous across seams — the world's
  continental shape IS the key, readable at map scale. DETAIL = per-board
  hash streams tweaking the base by (subkey − 7.5) × detail (~40% felt
  right; slider 0% shows the pure macro = the key as one tile). Classify
  water/mountains and run the biome grammar on the COMBINED field. This is
  what graduates into the sim as the real height field.

- **The centre tile vs the key's middle four (NOT settled)**: inscription is
  reading order (top-left→bottom-right, like text); 64 chars vs 61 tiles.
  Current build: centre shows the middle four as a 2×2 block. The user leans
  toward the centre showing NO chars — candidate resolution: the middle four
  go INSIDE the centre (they seed the special tile's interior / future cube
  view) — conservation holds (the land contains the whole key; one tile's
  share is interior, not surface) and the centre stays visually clean.
  Also unsettled: what vanity-grinding buys under reading order (leading
  chars = the board's TOP edge now, not the centre ring).

- **The 360-wheel is one wheel**: 360 days ↔ 360 degrees ↔ 360 hues. The
  angle, the calendar and the colour wheel are the same circle. Anything
  placed on one is automatically on the others.
- **The sun dial** (built 2026-07-04, map-scale): a ring around the whole
  board (over the seam), following the camera's board; the sun dot steps one
  position per day and wears the day's hue. Shadows on walls/cubes are
  hue-tinted and the HOUR raises/lowers the sun — shadow length stretches at
  06:00/22:00, shrinks toward 14:00; length only, never rotation. No globe —
  hint at mechanics rather than simulate them (standing aesthetic rule).
  The user feels something is STILL MISSING in this idea — it's not settled.
- **Birthday unlock**: once a year the sun's hue equals the player's hue
  (sun position == chosen angle) — something unlocks/happens on YOUR day.
  What exactly: open.
- Sun ideas not built: shadows lengthening with season; sunlight affecting
  generation (ties to the builder layer); the dial as an earned instrument
  (UI-is-progression applies to it too — dev build shows it always).

## Not built yet / parked

- Cube view content (special tiles), parent-view "earn" mechanic, day
  navigation + log editing UI, abilities/automation, fruit (first resource),
  Nostr persistence (day events; the identity intake is live).
- **Key roles (settled 2026-07-05)**: the MAIN key (extension, NIP-07) only
  signs and inscribes the home tile — never a computational seed beyond
  that. WORLDS derive from a separately GENERATED private key (throwaway):
  malleability by design — regenerable worlds, multiple worlds per account,
  rules migrations that don't touch identity. Custody of the generated
  seed: local + NIP-44 self-encrypted relay backup (the user CAN read it —
  sovereignty, not a leak; a client-side game cannot hold a secret from its
  own user, and the replay/verify architecture requires the world seed to
  be publicly recomputable anyway). For content that must stay a surprise:
  time-revealed entropy (derive from H(seed ‖ future block hash/event id)),
  not secrecy.
- npub→world derivation: **v0 LIVE 2026-07-04** — setup step zero connects
  window.nostr (NIP-07, keyless fallback = plain world); the pubkey's 64
  nibbles inscribe the HOME board's tile types in centre-out spiral order
  (weighted table meadow/grove/marsh/crag/spring, multipliers capped 2×,
  free inside the safe home so replay semantics are untouched); the save
  stamps world.pubkey and hydrate refuses identity mismatches. Researched
  and parked for later: parent-scale inscription (the arc's real home for
  it), hash-chain child derivation, seam symmetry, elevation layers from
  SHA256(key), vanity mining as feature.
- The angle-picker setup flow is LIVE again (2026-07-04): no save → the
  picker runs first and its angle seeds the world (`createSim({angle})`,
  per-instance gate); a save carries its angle and boots straight in; the
  "reset everything" helper wipes the save and returns to the picker.
