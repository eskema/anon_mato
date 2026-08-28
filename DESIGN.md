# anon & mato — design canon

The game presents as **anon & mato** ("Thrive" was an old working name; the repo,
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
- **post** — a seam tile where three boards meet (a parent vertex); a
  CONFLUENCE once seams are rivers — three shores to pick from, one bridge
- **gate** — the single doorstep EDGE that opens a walled board
- **cross** — stepping off the seam onto another board (the boards slide)
- **clear** — fully discover a board (what opens its gate)
- **home** — the walled safe board you start on
- **fog** — undiscovered ground; **trail** — the day's committed path
- **angle** — the setup angle (0° up, clockwise); it seeds where the gate falls
- **leap** — the power move: jump the diagonal (the tile beyond the edge two
  adjacent neighbours share) for one step's price (RETIRED 2026-08-02 —
  it fords rivers; see *Rivers*. Returns only as an earned ability.)
- **ford** — to cross a river on foot, no bridge; what the leap used to do
  to a seam, and what a river is meant to refuse

## Pillars

- **Time loop.** Nested scales: year (12 months × 30 days) → day (24 h) → hour
  (60 min). The minute is the finest unit. A stacked clock across the top shows
  and plays this loop.
- **No win/lose.** Survival + building + resource gathering + automation. The
  player gains abilities over time and sets up "patterns" within the loop;
  patterns grow or collapse; on collapse they revert to the base pattern and
  the player goes back to tweak them.
- **Energy IS time (minutes).** Traversal spends time. The daily budget IS how
  many tiles you've discovered (one minute each), floored at a tiny day-one
  survey (`SEED_MIN`) and capped at a full day (`FREE_CAP` = 1440). Home is
  where time/energy resets, but it is NOT timeless: every step/scout there costs
  a flat minute (see below), so clearing home spans several days — and clearing
  it (its 60 non-centre tiles) is exactly what earns the classic 60-minute
  budget you carry out the gate. Discoveries bank for the NEXT day.
- **Day cycle.** You wake at 00:00 and are awake for exactly your budget of
  minutes, then sleep the rest — so early on you sleep almost the whole day
  (budget 1 → awake 00:00–00:01, asleep till midnight) and the waking window
  grows on its own as the budget does. No fixed sleep hours; sleep unlocks
  itself.
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
  a flat COST_BASE (1 min) per step/scout regardless of biome, and the reserve
  prices the walk back to the centre rest spot like anywhere else. Safe means
  "can rest / no biome multipliers / no stranding," NOT free. Fully walled with
  a single (initially closed) gate. You start on the **centre special tile**
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
  on the seam (the classic inversion). A move glides the camera ONCE toward the
  DESTINATION board (averaging the whole route) instead of panning tile-by-tile
  with the ghost, so a winding path never bumps it fixed→follow→fixed; within one
  board it holds still and the cube walks across. Rendering is one global pass —
  every discovered tile in the viewport draws, culled at ~4 board-pitches around
  the camera (anchor read back from the live cam offset, so the ground tracks the
  viewport even mid-glide) or ~2 screenfuls, whichever is smaller. The old frame model (edge tiles → parked slides → frame-follows-
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
  interior moves/scouts cost the flat safe rate (1 min), while anything
  targeting seam or beyond charges the normal biome rate.
- **Tile types**: every hex can carry a type (sparse, per tile node); a type's
  properties are cost multipliers on the level base. Seam tiles default to the
  `seam` type (move ×0.5 — the cheap roads); board interiors default to
  `plain` (×1). The standing hook for terrain/specials with real costs.
  (See *Rivers* below: the reframing keeps the ×0.5 ALONG a seam and prices
  the step ACROSS it separately.)

### Rivers (settled 2026-08-02 — the seam reframed; BUILT 2026-08-03/04)

**Every seam is a river. The gate is a bridge.** Same geometry, opposite
reading: the one-hex row between boards stops being a corridor you walk
through and becomes the water you have to get across. Each board is an
ISLAND, and the map is no longer a plane you wander — it's a network you
build, one crossing at a time.

- **On foot you can stand in a river, and that's all.** A seam tile stays
  walkable: you step into the water and you're there. But from a river tile
  there is nowhere to go — not across, and **not along**. Your moves are: back
  to the tile you came from, or BUILD. A river tile is a dead end you enter and
  leave the same way. (Aboard the raft it is the opposite of a dead end — see
  the raft, below. Everything here describes being in the water on your feet.)
- **River tiles do not connect to each other.** You always enter the water FROM
  a shore, so reaching the next river tile means going back to land and
  stepping in again: river → land → river, never river → river. The seam stops
  being a path in the movement graph at all — each of its tiles hangs off the
  land beside it, like a jetty. (This is the precise form of "not along", and
  the shape the implementation wants: a river tile's only edges are to its
  banks, plus whatever a bridge adds.)
- **This retires the seam as a travel network.** The old model made seams the
  cheap roads (×0.5) and the whole ring roamable — that's exactly what a river
  is not. Nothing can strand you (coming back is always legal), but "walk the
  seam around to the gate" stops being a thing you can do. See *What moves*
  below: the ×0.5 road price and the 2026-07-03 circumnavigation both go.
- **A bridge joins TWO TILES, and you pick them.** Not an edge, not a board —
  one tile to one tile. You build standing in the river, and at the moment of
  construction you CHOOSE which tile the bridge lands on. That choice is the
  commitment: a bridge is a place you decided, and where it puts you down
  decides what you can reach next. Once built it's permanent and works both
  ways.
- **A bridge must land on LAND.** You cannot bridge to water — the far end is
  always a board tile, never another river tile. This is what settles
  JUNCTIONS: standing in a confluence, three boards touch you, and this
  first special bridge builds ONE crossing — so you pick a SIDE. The other two
  stay water until something else spans them. A confluence isn't a special
  case, it's just a river tile with more shores to choose from.
- **You can SEE across — that's what standing in a river is for.** Sight and
  walk are separate (they already are: `isFrontier` uses sightNeighbors while
  movement filters impassable ground), so from a river tile you can scout the
  far bank. Nothing to walk to, everything to look at. Which makes the river a
  VANTAGE, not just an obstacle: you wade in, scout across, see what's over
  there, and only then decide where three loads of rubble are going. The
  bridge choice is an informed one, and the looking is what earns it.
- **The wall's debris makes a RAFT, not a bridge** (2026-08-03 — this replaces
  "the debris is the first bridge"). Clearing a board tears its wall DOWN, and
  what's left is material: rubble you can pick up. What you build with it is the
  first VEHICLE. Why the change: a bridge needs a landable bank on the one river
  tile you can reach, and some worlds don't have one — a scan of sixteen test
  worlds found five where every bank off the gate tile is open water, i.e. a
  board you could never leave. Water always goes somewhere; a raft can't seal
  you in. It also makes the one-waterfront-tile rule a feature: the tile past
  your gate is your HARBOUR.
- **The SHALLOWS are a river by another name** (RULES 34/35, 2026-08-04). The
  water in play is not only the seam: board water of **deepness 0** counts too,
  so ponds, tarns and coastal fringes are road to a raft and a lake stops being
  a hole you walk around. And they behave exactly like a river ON FOOT: you wade
  in from a bank and stand there, and the only ways out are that same bank and a
  bridge. So every rule about water is one rule — a dead end you enter to LOOK
  from and to BUILD from, and a network once you're afloat. That's what makes a
  boat buildable on a lake: you can stand in it to haul the loads in and raise
  it. (The "needs swimming" the shallows used to advertise is gone with the
  rule — swimming was never a thing.) Deeper water, deepness 1+, is still
  nothing but a wall and still says so.
- **A raft lives on the water.** It is moored at one river tile and only moves
  when you're on it: board it by stepping onto its tile from a bank, and while
  aboard the river stops being a dead end — navigate tile to tile, and land on
  ANY shore. Step ashore and it stays where you left it. That's the game of
  owning one: not affording it, but knowing where it is. (One raft, for now.)
- **The haul** (built 2026-08-04, RULES 33). The raft isn't granted, it's
  CARRIED: pick up a load of debris, walk it to the water, drop it. **One load**
  — a raft is the cheap starter vehicle; a bridge's three (below) is what heavy
  permanent work costs. The rubble is VERY heavy, so even one trip is a slow
  one; the pack's weight already prices movement and this is the load that makes
  you feel it. Uses what is already there — gather/carry/drop, the carry cap,
  load → move cost. As built:
  - Opening the gate FELLS the wall, and the felled stretch leaves **three loads
    of `debris` on the DOORSTEP tile** — an ordinary pile, on the tile the wall
    stood on, one step from the water it's meant for. Three is a bridge's price;
    a raft spends one of them. (`fellWall`, keyed off the same ratchet that
    opens the gate, and planted in the day's start snapshot so a rewind can't
    sweep it away.)
  - `debris` weighs **6** — the heaviest thing in the game, a full base pack on
    its own. One load is one trip, and that trip costs double per step.
  - Building takes what's **lying on the tile**, never what's on your back: you
    haul it into the water and drop it, then build. A raft costs 1 load, a
    bridge 3. Neither costs minutes for now — the walk under the load was the
    price.
  - The way home may go BY WATER. Ashore across the river, the reserve prices
    walking back to the raft, boarding it, punting to a shore that knows the
    way, and walking from there. Without that the far bank reads as unreachable
    from home and the never-strand rule refuses to let you off the raft at all —
    you could sail anywhere and land nowhere. (`reserveMap` seeds the raft's
    tile as a second source; `reserveBase` is the walking-only map the water
    route reads, so the one raft is never counted twice.)
- **A BRIDGE is what you build later, and it's a different thing.** Once a raft
  crosses water, a bridge isn't about crossing — it's about crossing WITHOUT the
  raft: with a cart, with a load, without dismounting, every day, forever.
  That's a road. Three hauls, sited where you stand, joining two tiles you pick
  — and it DAMS the river (see below), which is now a real decision rather than
  a footnote: your first bridge closes a stretch of water you were using.
- **…and it DAMS the river.** A debris bridge sits low on the water: **boats
  cannot pass it**. Later bridges — raised, arched, built rather than tipped
  into place — will let them through. So the first crossing has a price you
  can't see when you pay it: the tile you span stops being navigable, and a
  seam you bridge early is a seam your boats can't run later until something
  better replaces it. Crossing the water and travelling the water are rival
  uses of the same tile, and that tension is the point.
- **What it preserves.** Seam tiles stay ordinary shared ground on the parent
  node; SPACE IS GLOBAL is untouched; junctions stay junctions (confluences
  now). Clearing a board still opens its gate — the gate is just re-read as
  your first bridge rather than a door swinging in a wall. The progression
  that exists keeps working; what changes is what it means.

- **The leap is retired** (2026-08-02). Hopping the diagonal across a seam is
  FORDING — crossing the water on foot, under your own power — and that is
  precisely what a river must not give away. It goes off for now. It may come
  back as something EARNED: a skill level or a learned ability that lets you
  ford, presumably at a real cost, one tile of river, and never at a
  confluence. Until then a river is crossed by bridge or not at all. (See the
  LEAP rule in *Energy / movement model* — the flag stays, the default flips.)

**Still open:**

0. **What the UI says about crossing.** The raft has a menu node (standing in
   the water, "build raft", greyed with what it still needs) and a hull drawn
   where it's moored; the card names the river and reads back your two states
   ("back the way you came" / "any shore"). The BRIDGE has its rule and its
   price in the sim and no way to raise one — it wants the tile-picking gesture
   the design asks for (you choose the far bank), which is a UI question, not a
   rules one.
1. **Bridges after the first.** The debris pays for one. The rest want to be
   a BUILD — materials + a day's work, sited where you stand — since that's
   the pillar the game already has and a bridge you sited yourself is a
   pattern you made. What it costs is open.
2. **Boats beyond the raft.** The raft (above) is the first one and it arrives
   early — the wall's own debris. What's open is what comes after it: a boat
   that carries cargo, one that's faster, one you can own more than one of, and
   whether any of them is a craft, a skill or a place. The arc is settled
   though: seams were roads → rivers you can only stand in → rivers you can run,
   from the first day you clear a board.
3. **Can a bridge be undone?** Torn down, rebuilt raised, moved — or is an
   early crossing a permanent dam on that tile? Deliberately parked
   (2026-08-02): no strong opinion yet, and nothing else waits on it.

**What it costs to cross, in practice** (measured 2026-08-03, once the rules
were in the sim): behind a walled home you can reach 62 tiles on foot — the
board and the single river tile past the gate. With a raft moored there, that
becomes ~220. So the raft is worth roughly three and a half boards of world,
and it is the difference between a life and a cell. The second thing the
measurements showed: hauling ACROSS water is expensive enough to change how you
play — carrying five items' worth of camp materials over a river is no longer a
single outing, it wants ferrying (gather, drop on the bank, come back). That is
the pack-weight rule biting exactly where it should, and it's what makes the
bridge worth its three hauls later.

**What moves when it's built:** the `seam` type's ×0.5 "cheap roads" price
(gone — a river isn't a road) and the whole seam-as-network reading in *The
world*; the 2026-07-03 frame-follows-the-seam circumnavigation (moot); the
gate bullet (gate → first bridge, sited by the player); the leap (Energy /
movement model). Implementation is probably the walls primitive already in
hand: a river tile is walled on every side, and building a bridge clears the
two facing bits between the chosen pair — exactly what the gate does today,
just chosen instead of decreed.

## Energy / movement model (reworked 2026-07-01 — one-way costs)

- Costs are **one-way, never refunded**. Two actions:
  - **SCOUT** (`scout`): reveal an adjacent undiscovered tile WITHOUT moving,
    cost `SCOUT_COST (1) × level base` — discovering is cheap; walking there
    is the commitment. **Priced PER RING OF TILES** (RULES 32, 2026-08-03) —
    one literal hex ring outward from the world's origin, one more multiple:

    | ring (hex distance from home's centre) | scout |
    | --- | --- |
    | 0–5 — the home board and the river ringing it | **1×** |
    | 6 — the first shore | **2×** |
    | 7 | **3×** |
    | *n* > 5 | **(n − 5)×**, uncapped |

    `max(1, ring − SEAM_RING + 1)`. Two gentler shapes were tried first and
    neither changed behaviour: a smooth `1 + tiles/20` ramp (RULES 31), and a
    step per BOARD ring. Why so steep: the daily budget IS your discovered tile
    count, so cheap scouting COMPOUNDS — every tile revealed buys more revealing
    tomorrow, and exploration ran away with the game. Distance had to stop being
    free real estate, so that SETTLING and working your surroundings is the
    better move. The scout SKILL is what wins the range back (−1/30 per level,
    half price at 15), which makes the ladder: stay close, get good, then go
    far. Nothing is exempt but home and its own river ring — the rivers further
    out are priced by their ring like everything else.

    **What the ramp costs, measured** (2026-08-04). A cap at 3× was tried for an
    hour and reverted — the steepness is the point — but the number is worth
    keeping: SAILING pays this ramp hardest. The ring is distance from the
    world's origin and the river network winds outward, so the water ahead of the
    boat gets dearer with every tile (ring 10 → 6×, ring 15 → 11×), and you
    cannot sail into fog. A 61-minute day afloat spent **34 minutes revealing the
    way** and had nothing left to reveal a bank, let alone step onto one: the
    raft could go anywhere and put you nowhere but the first shore past the gate.
    So a raft's range is not its own — it is the scout budget, and it is what the
    scout SKILL (and a camp on the far side, once camps carry a reserve) is for.
  - **MOVE** (`move`): step onto *known* ground only, cost
    `MOVE_COST (2) × level base` per step, halved on seam tiles (1) — the
    seams are the roads, cheap to travel. Backtracking costs too — walking
    home is time that passes.
  - **LEAP** (part of `move`, `LEAP` flag — **OFF from 2026-08-02**: it fords
    rivers, so the default flips and it returns only as an earned ability; see
    *Rivers* in The world. The rule below stands for when it does):
    jump the DIAGONAL — the tile directly beyond the
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
  Dijkstra seeded at every spot (steps inside safe interiors charge the flat
  safe rate, so the reserve prices the home walk too), cached
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
  mirrors every successful dispatch to localStorage (`anon&mato:save` — the
  STORAGE KEYS keep the old spelling on purpose: renaming one orphans a live
  save or the drawn icon store).
- Nostr rides the same format later: one event per banked day (NIP-78 style,
  `d = anon&mato:<world>:day:<n>` — editing a day republishes one event) plus
  a replaceable head event; the npub is the player, and deriving each world
  from the pubkey is a founding goal (collaboration via nostr later).

## Timed actions

Actions aren't instant. A scout / gather / craft / build waits IN PLACE for its
charge (`TIME_SCALE = 1000` ms per simulated minute, fast-forwarded by
`WAIT_SPEED = 60` for now; a future upgrade shrinks the real wait while the
simulated cost stays). Input locks while waiting; the wait is presentation — the
sim applies the action atomically on completion (abandoning mid-wait spends
nothing).

A MOVE animates instead of waiting — the cube WALKS the route, paced by the
tiles' CHARGE (reworked 2026-07-17): `MOVE_MS_PER_CHARGE` ms per charge-minute, so
costly ground walks slower than easy ground, floored at `MOVE_MS_MIN` (a brisk
single step) and capped at `MOVE_MS_MAX` (a faraway route stays WATCHABLE — you see
the whole walk — but never crawls). A board SHIFT adds a beat scaled by how far the
camera slides, so a seam crossing doesn't whip past at the step's pace. The cube
glides continuously tile-to-tile on an asymmetric-quad ease — SHORT in, LONG out
(quick off the mark, soft landing, `MOVE_EASE_IN`); the camera borrows the move's
DURATION but its own quad (longer out) and aims at the destination, a lead-and-
follow rather than one rigid motion. All the constants live in grid.js/render.js
and are the tuning knobs; the shared `draw.js` holds the `easeSplit` curve both use.

## Gather / craft / build (v1 loop, 2026-07-13)

The works layer, all through the same day/reserve economy:

- **Gather** — an action on a forage NODE underfoot, OUT PAST THE SEAM. Not
  every biome tile yields: whether a tile is a node for its resource is a
  DETERMINISTIC draw from the world key + coord (`NODE_DENSITY` per resource
  — plants 0.55 … metal 0.09), so the same world always forages the same and
  it replays. Biome frequency × node density is the scarcity: some boards
  are bare of a resource by design, and rare finds (a metal node) are
  landmarks worth a camp. The HOME board is NOT gatherable at all — its
  tiles are the identity/minimap, not land. A node gives one unit of its
  `BIOME_YIELD` resource; the map draws a dot on a ready node and a filling
  regrow ring on one you've depleted. That FORAGE MAP is a scout perk: node
  markers stay hidden until scout skill reaches `FORAGE_EYE` (the forager's
  eye) — below it you learn a tile's yield only by standing on it (the nodes
  are derivable in theory, but the game earns the map). Display-only, so the
  gate never touches replay; the dev sandbox (world.html) is omniscient.
  Costs minutes per resource (`RESOURCES[r].min`), eased by the gather skill
  toward half at 15; an axe halves wood. Each tile carries a REGROW clock
  (`RESOURCES[r].regrow`, in world-minutes — 1440/day, sleep included):
  plants return within the day, metal is a yearly pilgrimage. Affordability
  keeps the reserve invariant against the HEAVIER pack — the way home is
  re-priced at the post-pickup load, so a gather can never strand you.
  **Some harvests need GEAR** (RULES 36, 2026-08-04): fish come out of the
  water only to a **net** on your back. Wading into the shallows put fish
  within reach (see *Rivers*), and reach was never the hard part — a resource
  the map hands you the moment you can stand next to it is a resource worth
  nothing, so the tackle is the gate, not the boat. It's declared on the
  RECIPE (`catches: "fish"`), so the next piece of gear is a recipe entry and
  no new machinery: `canGather` refuses without it and `gatherInfo().lacks`
  names it, which is what the menu prints ("fish · needs a net").
- **Spoilage & wear** — the pack is dated INSTANCES, not counts. A raw
  harvest has a SHELF life (`RESOURCES[r].shelf`, world-minutes): food rots
  and is lost past it (fish 1 day, plants 3, eggs 4; wood/rock/metal keep).
  Spoilage is irreversible — expired instances are pruned at every action
  boundary, so a later preserver can't un-rot food. Tools WEAR: the axe has
  `uses` (12 wood-cuts) and breaks when spent. `worldMin` is monotonic
  (a rest jumps the day 1440 > any ≤60 refill), so both clocks replay
  deterministically. You can't hoard — you use it or lose it.
- **Carry** — items weigh (`RESOURCES/RECIPES[].weight`); capacity is
  `CARRY_BASE + gather level + baskets`. The LOAD multiplies every step
  linearly up to 2× at a full pack — through the exact reserve, weight
  literally shortens reach. Full pack = no more picking up (hard cap).
  `debris` (weight 6, the felled wall's rubble — see *Rivers*) is the extreme
  case and the reason the rule exists: one load IS a full base pack, so a haul
  is a single slow trip and nothing else comes with you.
- **Craft** — a SERVICE the NPCs sell, not a self-skill. Each recipe belongs
  to a `biome`; only a figure NATIVE to that land (their board's main type)
  can make it, and only at `level` in that land's skill. You carry the raw
  materials to them (at their board CENTRE — within a step, like teaching)
  and they spend the minutes and hand the item back; consumption spends
  OLDEST fresh stock first, and the product (lighter than its inputs) never
  breaks the reserve. Crude tier: the plains weaver's basket (5 plants → +4
  carry AND `keeps` ×1.5 on perishable shelf, the first storage tech; later
  builds preserve far longer), the forest wright's axe (2 wood + 1 rock →
  halves wood gathering, wears out), and the same weaver's **net** (4 plants),
  which is TACKLE rather than an easement — see the fishing gate below.
  Crafting is deliberately OUTBOUND and
  camp-gated: board centres sit ~10 tiles past the seam, so reaching a
  specialist to transact means anchoring the reserve with a camp nearby —
  a mid-game expedition, not a home convenience. No resident home crafter;
  the player never self-crafts (no `craft` practice).
- **Build** — a structure on the tile underfoot: materials on the back,
  build level, minutes. The CAMP (`BUILDS.camp`) joins `restSpots`: the
  reserve anchors to it immediately and the day can END there (rest works
  at any resting place, not just home).
- **Drop / take — what you put down STAYS PUT** (RULES 29, 2026-08-02;
  supersedes "a drop outside is lost for good"). You can `drop` any item onto
  the tile underfoot, instantly and free, ANYWHERE — and it lies on that exact
  tile until someone picks it up with `take`. Every tile is a storage cell,
  keyed by global coord; still ONE item type per cell. This is what makes
  material HAULING possible (carry a load to a site, leave it, come back with
  more — see *Rivers*: one load of the felled wall's debris makes the raft,
  three make a bridge, and a build takes them off the GROUND, not your back), and it
  turns any tile into a depot. Dropping lifts weight off your back for the
  next leg; dropped food still spoils (a plain tile keeps time — a carried
  basket's preserve factor does NOT reach it; a preserving STORE is future
  tech). Piles show a small ring on their tile, and the tile underfoot lists
  what's on it in the bottom-RIGHT corner, mirroring your own pack's row in
  the bottom-left.
- **Carrying wants a real system (open, 2026-08-02).** Today capacity is one
  number — weight against `CARRY_BASE + gather + baskets` — and that won't
  carry the game much further. What's needed is at least TWO axes: **weight**
  (what you can bear) and **SIZE/bulk** (what you can physically hold at
  once), so that a bridge's worth of rubble is not "heavy" but *unwieldy* —
  three trips because your arms are full, not because your back gives out.
  That split is what makes VEHICLES mean something later: a cart, a barrow, a
  raft — each one a container with its own bulk allowance, its own speed
  penalty, and its own terrain it can't cross. Not designed yet; the shape of
  the answer is "the pack is one container among several".
- **Eat & cook — FOOD IS TIME (RULES 37, 2026-08-10).** Food's sink is the
  budget itself: every raw food carries `food` — nourishment in MINUTES
  (plants 6, fish 12, eggs 9) — and `eat` (2 min, anywhere, oldest fresh
  instance first) adds it to TODAY's waking window. Capped at +60/day (the
  sacred baseline again: a second wind, not a second day) and never past
  midnight; `eat` refuses a bite worth less than the sitting, so it can't
  strand you. `cook` (10 min eased by the cook skill, half at 15; trains
  cook — the first SPACE transform) works AT A HEARTH — any resting place —
  and turns one raw unit into a MEAL worth 3× its nourishment, carried on
  the instance (`{at, food}`); meals keep 1 day (for the trip, not the
  hoard — the preserving STORE stays future tech) and weigh 1, so cooking
  never breaks the load-priced reserve. Accounting: `fed` (minutes eaten
  into today) grows the budget reading instead of un-spending energy, so
  the clock and `worldMin` stay monotonic; day-snapshotted, log-derived.
  Both live in the radial menu as folders (eat anywhere; cook at hearths).
- Practice: gather/craft/build/cook each train their own skill (the same
  doubling-threshold counters as walking and scouting).
- State (`inventory` as instance arrays, per-tile `gatheredAt`, camps) is
  log-derived; the save FORMAT is unchanged (still just the action log).
  RULES is now 10: a log containing gather/craft/build replays to different
  inventory and step costs than before, so those saves must reset — but a
  pure-exploration log has an empty pack and replays identically.

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

## The radial menu (2026-07-07)

- The action menu lives on the **real hex grid** — 6 slots on the player's
  neighbour tiles, same geometry as the map (laid out in `render.js`).
  Behind it, a **padded tile silhouette** (every occupied cell as an
  oversized hex, one union path — ~half a tile of padding), not a disc.
  Icons only — no text in the hexes (glyph system in `lib/icons.js`, shared
  with the style guide); the focused hex shows its label in a fitted pill.
  A **folder** (node with children) fans its children onto outward cells
  when opened: up to 3 on the ring-2 cells beyond its slot, then up to 5 on
  ring-3 past those.
- **Groups**: `self` (things you do) and `them` (things with the figure you
  face). With a `them` group the ring **splits** — self on the arc away from
  the figure, them on the arc toward it. Helpers (go home / rest and resume
  / clear board / reset) are now a folder here, not a bottom-left strip.
- **Focus**: opening the menu BLURS + dims the world; the tile you stand on
  is punched back out sharp (player + figure stacked, both visible). Opening
  a folder fades the previous level so attention falls on the new items.
- **Every board centre is a special tile** — the resting place of its figure
  (all six interior radial lines, like home's centre). Figures rest there
  unless tasked; the player stacks BELOW the figure so both show. You inspect
  a figure only while standing ON its centre.
- **The ring is a split**: the LEFT cells are YOU (self actions), the RIGHT
  side is whatever you're inspecting — for now just the LAND under you (its
  facts: biome, elevation, costs, yield). Home's own centre stays self-only.
  Skills and their lessons no longer live in the menu — they're on the clock
  ring (see the Skills section).
- **Auto-open**: the menu opens itself on arriving at the home centre or a
  figure's centre (a context transition); dismissing closes it until you
  move to another such spot. Clicking the player toggles it anywhere.

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

- **Skills: nature vs nurture (v1 LIVE 2026-07-06)**: everyone starts at
  HALF their nature (`baseLevel = ⌊innate/2⌋`) and grows by learning; the
  asymmetry is the design — the PLAYER caps at 15 (perseverance always
  pays; the key sets the head start and the pace via `lessonXp`, never the
  destination), an NPC caps at its OWN nature (experts keep permanent
  value). The `learn` action: 10 minutes beside a teacher who currently
  outranks you; xp clamps at the teacher's level — nobody teaches past what
  they know. Learned progress is day-snapshotted state that replays from the
  log (the save stays log-only; your skills are literally your biography).
  First stat that bites: scout level discounts scout cost (half price at 15).
- **Teaching (RULES 6, 2026-07-10; edge-for-edge since RULES 25, 2026-07-21)**:
  the mirror of a lesson, and the reason teaching is *selective*. `teach` a
  figure a skill you currently OUTRANK it in (room below its nature cap): **one
  edge moves from your shape to theirs**. Yours drains by one — `given[]`
  counts edges out of the same shape lessons fill, and giving with an empty
  shape degrades the level itself (the previous, smaller polygon comes back
  nearly complete). Progress is ONE total-edge currency counted from level 0:
  nature just PRE-FILLS your base levels' edges, and the drain digs into them
  like anything else — the base is not an infinite well; you can teach yourself
  below your nature. Theirs fills by one — `taught[boardKey][skill]` counts
  edges in, and the figure climbs its own shape from its base
  (`npcProgress`), completing a level only when the shape closes, never past
  its nature. Progress on both sides is one net-edge currency; `given` and
  `taught` are day-snapshotted and log-derived like `learned`. You literally
  give up your own edge to lift theirs — so who you teach matters.
- **Skills + lessons live on the clock ring (2026-07-10)**: the 8 skills sit
  at 45° inside the sun dial while the menu is open — glyph outward, number(s)
  inward. Facing a figure: yours and theirs with a learn/teach arrow (← take a
  lesson / → give one), equal → one number. A ← slot (green) or → slot (amber)
  is clickable in place and previews its 10-min cost on the ring. No more
  learn/teach menu folders.
- **Place is nature — for the stationary (2026-07-07)**: an NPC's home
  biome raises its innate (and so its cap) by +3 in that biome's skill.
  Eight biomes ↔ eight skills, a bijection — every skill has a home terrain
  and every terrain breeds its expert: water→travel, beach→trade,
  marsh→tend, plain→gather, forest→craft, mountain→build, cliff→scout,
  peak→lore. The player gets NO place bonus (you move; your nature is your
  key alone). A figure standing on water is unreachable until you can get
  to it — the expert you can see but not yet learn from is intentional.
- **People + stats (v0 2026-07-06)**: every board except home keeps ONE
  figure. Its board's childkey doubles as its secret key —
  `getPublicKey(childSeed)` makes each NPC a REAL derivable nostr identity
  (puppets of the world: anyone can recompute your world's people).
  Constrained to its board; placed at the centre for now; styling TBD
  (drawn as a smaller, quieter cube once its tile is discovered). **Stats
  read any key by one rule** (`statsOf`): 64 nibbles → 12 skills, each the
  rounded average of its contiguous slice (~5–6 nibbles, 0..15) — the player's
  npub reads the same way (`playerStats()`). The 12 skills and their grouping are
  canon now — see "Skills: the three pillars" (the 4 MIND skills still ride
  placeholder names/icons; mechanics hook in later).

## Skills: the three pillars (planned 2026-07-17)

The 12 skills ARE the game's verbs, and they divide equally into THREE PILLARS of
four — the organizing spine everything else hangs off. A skill is a DOMAIN (a
family of actions + modifiers), never a single button; leveling a skill improves
its verb, so progression and action are one axis.

- **TIME · the wheel** — `scout · travel · trade · farm`. Reach, flow, cycles, the
  long game: things that unfold over DURATION — grow the known world, cover
  distance, circulate goods, wait on a harvest. The cut that proves the split:
  **farm** (patience, seasons) vs gather/hunt (the immediate take).
- **SPACE · fire** — `gather · craft · hunt · cook`. Engage matter with fire: TAKE
  it (gather/hunt) and TRANSFORM it (craft/cook). The immediate physical world —
  and **cook belongs here**: cooking is literally fire on matter (raw → meal).
- **MIND · word** — `heal · lore · dream · build`. The self, its culture, and its
  DESIGN: KNOW (lore), MEND (heal), ENVISION (dream), and MAKE-REAL your patterns
  (build — "the patterns pillar" is the mind imprinting the world). The interior +
  intent.

(2026-07-17 revision: `cook` and `build` swapped pillars — cook → SPACE/fire,
build → MIND/design. TIME's four are unchanged.)

What falls out of the taxonomy (why it's more than tidy):

- **The wheel groups each pillar into a contiguous ARC** — TIME across the top,
  SPACE down the right, MIND down the left. `STAT_NAMES` is the wheel order
  clockwise from the top (`scout` at 12 o'clock), so in the linear list TIME
  STRADDLES the start (`scout·travel … farm·trade`). The year still turns through
  the pillars in ~4-month macro-seasons, with TIME wrapping the new-year turn. The
  constellation wheel already built IS the TIME pillar's emblem; `lore` living in
  MIND is why it gates the sky/calendar reveal.
- **A currency per pillar** (candidate): SPACE → matter & sustenance (materials +
  food→energy via cook), MIND → knowledge, health & design (heal/lore/build),
  TIME → reach/circulation. A three-resource economy that emerges from the
  structure instead of being bolted on.
- **Skills can be MODIFIERS, not only verbs** — `lore` governs (sleep quality,
  calendar clarity, unlocking); `travel` just discounts movement. This is what
  keeps "12 verbs" from meaning "12 equal loops to invent."

Open / revisions:

- **The biome bijection loosens.** 8 biomes but 12 skills → only SOME skills are
  place-born; the MIND four are nearly placeless (learned from people/knowledge,
  not terrain). "8 biomes ↔ 8 skills" becomes "some skills are place-born, others
  aren't" — arguably better.
- **"Pillar" is overloaded** — DESIGN already calls building "the patterns pillar";
  these three (TIME/SPACE/MIND) are skill CATEGORIES. Reconcile the word.
- The MIND four (`cook·hunt-food·heal·dream`) still ride PLACEHOLDER names/icons;
  `dream` is the natural home of the routines below (dreaming = programming
  tomorrow's loop). Sequence the build: harden the verbs that already have loops
  (scout/gather/move/craft/build), then `lore`'s governing role (cheap, ties the
  calendar together), then flesh the self-verbs around the sleep screen.
- `lib/guide.js` holds an EARLIER, different grouping (a "Time" of cook/hunt/heal/
  tend, a "sail" skill) — a scratch exploration, not this canon; reconcile or drop.

## Multi-POV days & routines (planned 2026-07-17)

Every board is already a person (childkey = identity + derived terrain + stats).
This turns that latent fact into play: you can INHABIT any figure and live its day
the same way you live yours — the old delegation idea, but as CONTROL, not a
command UI. The whole day-loop (energy → move/scout/gather → reserve home → sleep,
event-sourced) is reused verbatim, pointed at a different actor. The player is just
actor #0.

- **Shared vs per-actor.** The MAP is one shared truth: collective discovery
  (anyone reveals a tile, it's revealed for all), walls, wear, regrow clocks,
  built things — and the DAY plus its 00:00→budget hours are global. PER-ACTOR:
  energy (each has its OWN budget curve), position/trail, pack, skills/learned,
  home (its board centre) + the reserve to it, and its own per-day action log.
  Shared fog is what collapses the cost — no per-actor knowledge to multiply.
- **Same day, many POVs.** You act your own day AND switch POV to drive others
  within that SAME day. The tractable authoring model: each POV is played against
  the MORNING (day-start) world — no live cross-effect between people mid-day.
  Interactions resolve at BANK: sleep replays everyone's logs INTERLEAVED by
  in-day time (a person's clock = its own energy spent) onto the shared world, in
  order. Conflicts (B gathers a tile A already took) simply FAIL — the sim already
  refuses illegal actions, so the "merge" is a SORT, not merge code. Trade
  accepted: no live coordination within a day (you author each blind to the
  others; the bank may invalidate a few actions — grey-as-broken, interesting not
  broken). Live co-presence (handoffs on the commons) is a later, harder mode.
- **Routines = program by demonstration (the loop).** Record a person's day; that
  log becomes a TEMPLATE. "Set to loop" is a LOGGED assignment ("B runs routine R
  from day N"); the daily execution DERIVES — re-applied each day-advance, never
  stored (JOBS derive, never log). Change the loop anytime = a new logged
  assignment, effective from that day forward. The save stays tiny: you store "she
  builds boats," not a thousand banked boat-days; replay recomputes.
  - STATIONARY production (build/craft at a fixed spot from a stockpile) replays
    LITERALLY and perfectly — the safe first target (the boat-builder).
  - FORAGING (gather things that regrow elsewhere) DRIFTS under literal replay —
    the ONLY place a tiny CLOSED verb set (gather-nearest, scout-frontier,
    go-home-sleep) is warranted, added reactively when drift actually bites.
    Never conditionals/branches: the reserve invariant makes a loop SAFE BY
    CONSTRUCTION (illegal refused; worst case it stops and sleeps safe), so the
    "language" needs no error handling. That safety IS the whole anti-monster.
- **Confinement → commons.** Reuse the existing gate (open-on-clear) with the
  auto-open WITHHELD: a person is boxed in its board until a TECH opens its seam.
  Converging on a shared COMMONS board is where the multi-person mechanics finally
  pay (teach/trade/build together). Matches the arc's "grind to full freedom / the
  rim opens" — isolation early keeps it simple; the exit-tech is the payoff.
- **Anti-monster UI (this is progression).** One FLAT routine per person, on/off —
  no library, no nesting, no branches. Program by DOING (inhabit + record), not an
  editor. Surface OUTCOMES (the person's day-log/trail you already render), not
  code. A gateable INSTRUMENT unlocked in time, absent day 1 (UI = progression).

### Implementation seam (actor record + the multi-actor tick)

- **Actor record** — bundle today's player singletons into one struct, held N-up
  with an ACTIVE pointer: `energy` (+ budget curve), the level `stack`
  (position/trail/entry per level), `learned`/skills, pack/inventory, `log`,
  `dayStart`, and `restSpots` (= this actor's home). Rendering, camera, reserve
  and input all read the ACTIVE actor; a POV switch is a pointer swap.
- **Stays global** — the world tree (`discovered`, walls, wear, `types`),
  `gatheredAt` regrow clocks, `day`, `worldStamp`. Discovery journaling keeps
  writing to the shared tree; it just has several authors now.
- **`sleep()` → `advanceDay()`** — the one new engine piece (the idea box's
  "sleep-tick executor", realized): gather each actor's day (hand-driven logs +
  derived routine runs), apply them to the shared world INTERLEAVED by in-day
  time, refuse conflicts, accrue results, refill each actor's energy on its own
  curve, roll `day`. Deterministic → replay re-runs it across all days;
  day-editing cascades as today.
- **Save shape** grows from `days:[{day, actions}]` to per-actor: banked days
  carry each hand-driven actor's log; looped people carry only their ASSIGNMENT
  (routine + fromDay), execution re-derived on replay. `RULES` bumps.
- **Build order** (each shippable): 1 control handoff (inhabit + play a day, shared
  fog, own energy/home) — the fun test; 2 save-a-day-as-routine + replay on demand;
  3 auto-run routines in `advanceDay()`; 4 confinement + seam-tech + commons;
  5 parametric verbs, reactively.

Open: whether teaching/trading need LIVE co-presence (forces the harder interleave)
or can also resolve at bank; how a routine is EDITED (re-record whole vs splice);
the budget-curve source per actor (stat-derived vs flat).

## Idea box (unsorted — thrown in raw, to make sense of later)

- **NPCs as the skill economy (vision 2026-07-06)**: learn FROM them (some
  are experts — innate stats from their childkey; the best teacher for each
  skill lives somewhere in your world, find them), TEACH them, eventually
  HIRE them — automation of manual tasks = the patterns pillar made
  concrete. Architecture fit: innate stats stay pure (statsOf — the cap /
  talent), LEARNED progress is state replayed from the log (day-journaled
  ratchet like discovery; NPC overlays rebuilt from teach actions, never
  saved). learn/teach/hire = ordinary ACTIONS entries (timed, energy-priced
  — lessons cost your day). JOBS derive, never log: hire is the logged
  intent (contract in day-start snapshots); execution is a pure payroll
  tick inside sleep() (e.g. hired scout journalDiscovers N tiles in
  canonical order, N = f(stat)) — replay recomputes it, day-editing
  cascades. Wages = food/resources when they exist; contracts grow or
  collapse like patterns. Sequencing: v1 learn (one skill that bites, e.g.
  scout), v2 teach + NPC menu/stat display, v3 hire + sleep-tick executor.

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
  **Settled direction (2026-07-11): centres are NOT land.** A board is 60
  land tiles + 1 centre; the centre is the BOARD's own tile — its type and
  info are the board's, not a derived land type, so `landAt` returns null
  there (no land block on hover, no land card standing on one). HOME tiles
  are not land either (2026-07-12): home is the identity/minimap — each
  tile refers to a whole board — so `landAt` is null across the home board
  too. Hovering a centre (or the home tile referring to it) shows the
  BOARD's overview instead: the figure's name (placeholder derivation:
  three syllables off the pubkey) + npub, the board's main land type, and
  its discovery percentage — the full set only once that board's centre is
  discovered; before that just the percentage + coords. Standing on a home
  tile whose board-centre is known adds a TELEPORT item to the menu — for
  now a routed move (walk pricing; instant-teleport cost model TBD). The key's
  middle four chars stay a reserved extra layer to tweak the map (use TBD).
  Candidate future rule (NOT implemented): the centre only becomes
  available once the 60 tiles around it are cleared. **Centres price at
  BASE (RULES 9, 2026-07-12)**: stepping onto (or scouting) a centre skips
  the biome and height multipliers — one plain step — and a centre is never
  impassable, so a water-derived centre can't lock a board shut. Paint
  still derives from the biome (a follow-up if it ever bothers).

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
- **Key roles (corrected 2026-07-06 — supersedes the 07-05 note)**: the
  MAIN key (extension, NIP-07) signs, inscribes the home board, and is the
  world's BASE FIELD — the identity shapes the continents, permanently
  ("each key inhabits its own world" made literal, and home = the world
  minimap by construction: same inscription, two scales). The GENERATED
  key (throwaway) seeds the per-board DETAIL streams — the regenerable
  texture: rerolling it re-textures your world without changing its shape.
  Custody of the generated seed: local + NIP-44 self-encrypted relay
  backup (the user CAN read it — sovereignty, not a leak; a client-side
  game cannot hold a secret from its own user, and the replay/verify
  architecture requires world inputs to be publicly recomputable anyway).
  For content that must stay a surprise: time-revealed entropy (derive
  from H(seed ‖ future block hash/event id)), not secrecy.
- **Terrain is IN THE SIM (2026-07-06)**: `createSim({pubkey, worldKey})`
  derives the two-octave field world-wide — the PUBKEY's 64 nibbles
  inscribe the PARENT grid (the same `inscribe()` as the home board: home
  IS the world minimap), interpolated between board centres; the generated
  world key seeds the per-board SHA-256 detail streams (sync sha256
  vendored from @noble/hashes). Base classes (raw mountains,
  smoothed water, highland tarns) + the neighbour grammar (marsh→beach→
  forest, escarpment cliffs, f-peaks) — all pure, cached, ~35ms for the
  full world. New games generate a throwaway worldKey (main.js); the save
  stamps it (SCHEMA 3) and hydrate refuses mismatches. **Biomes are PRICED
  (RULES 2, 2026-07-06)**: plain/beach 1×, forest 1.5×, marsh 2×,
  mountain/cliff/peak 2× move + 2× scout — capped at 2×. **Water is
  IMPASSABLE on foot** but scoutable (sight vs walk split: isFrontier uses
  sightNeighbors, movement filters impassable ground; no leaping over or
  onto water — straits are for boats). **The SHALLOWS are the exception**
  (RULES 34/35, 2026-08-04): board water of deepness 0 — the kind you can
  see the bottom of — is not impassable at all. A raft crosses it, and on
  foot you can wade in and stand there under the river's own rule (out only
  by the bank you came in by, or a bridge), which is what makes a lake a
  place you can build a boat on. Only deepness 1+ is still a wall, and it is
  the only water that warns you. See *Rivers*. Seams stay the roads, so no terrain
  roll strands anyone; sealed pockets = future content. **The home board
  never rolls open water** (it must stay fully discoverable or the gate
  could never open): home water demotes to marsh, neighbours still see the
  water base so shores ring it. The renderer paints biomes for all
  discovered ground INCLUDING home — the hex-digit char view is retired
  (nibbleAt stays in the sim as identity data).
- **Height prices movement EXPONENTIALLY + practice (RULES 8, 2026-07-11)**:
  on top of the biome multiplier, a step pays base^(elevation − 4) — sea
  level 1×, and untrained (ELEV_STEP 1.35) the raw peak (15) is a ~27×
  wall: you cannot simply stroll up high ground. TRAVEL flattens the curve
  — the base eases linearly to ELEV_STEP_FIT (1.1) at travel 15, where the
  same peak costs ~2.9×. Beef up first, then climb. **Practice — skills
  grow by DOING**: every step counts toward travel, every scout toward
  scout (PRACTICE_SKILL maps action kind → skill); level k of practice
  lands at PRACTICE_BASE·(2^k − 1) actions (thresholds double — the early
  levels come quick, the last take an age). Practice levels add into
  skillOf alongside innate + lessons − taught, capped at 15; counts live in
  `practiced` (log-derived, in snapshots, replay-safe; priced-then-counted
  so a bump mid-walk only ever CHEAPENS later steps). Beach still pins to
  elevation 4; water still reads deepness (priced by the same exponent, for
  boats later); seams and safe-board interiors stay flat.
- The angle-picker setup flow is LIVE again (2026-07-04): no save → the
  picker runs first and its angle seeds the world (`createSim({angle})`,
  per-instance gate); a save carries its angle and boots straight in; the
  "reset everything" helper wipes the save and returns to the picker.
