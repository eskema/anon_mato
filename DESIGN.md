# anon & mato — design canon

The game presents as **anon & mato** ("Thrive" was an old working name; the repo,
package id and paths keep `thrive`). It runs standalone (no build step, vanilla
ES modules, Canvas2D) and is meant to also run as a napp inside the nostrapps
launcher.

**This file says what the game IS** — present tense, current rules. When a rule
changes, the sentence changes and the old one goes: history is in git, the
reasoning behind what we tried and dropped is in `attic/decisions.md`, and
everything unbuilt is in [VISION.md](VISION.md). Name rules, not tunable
numbers — the values live in the code.

**The design is still settling.** Several core systems (the energy model above
all) have been reworked more than once and will move again. Code should optimise
for cheap change: rules and tunables in one place, no speculative abstractions
for unbuilt features.

## Terminology (short on purpose — these are the words we use)

- **board** — one tile's playable interior grid (radius 4, 61 hexes)
- **seam** — the shared one-tile row between boards (the parent grid's edges);
  every seam is a river
- **post** — a seam tile where three boards meet (a parent vertex); a
  CONFLUENCE — three shores to pick from, one bridge
- **gate** — the single doorstep EDGE that opens a walled board
- **cross** — stepping off the seam onto another board (the boards slide)
- **clear** — fully discover a board (half of what opens its gate: the other
  half is standing on the doorstep)
- **home** — the walled safe board you start on
- **fog** — undiscovered ground; **trail** — the day's committed path
- **angle** — the setup angle (0° up, clockwise); it seeds where the gate falls
- **leap** — the power move: jump the diagonal (the tile beyond the edge two
  adjacent neighbours share) for one step's price, DRY ground only (see *Rivers*)
- **ford** — to cross a river on foot, no bridge; what a river refuses, and what
  may yet return as an earned ability

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
  survey (`SEED_MIN`) and capped at the waking window (`WAKE_CAP` — the day less
  the sleep it owes; see *Player energy*). Home is where time/energy resets, but
  it is NOT timeless: every step/scout there costs a flat minute, so clearing
  home spans several days — and clearing it (its 60 non-centre tiles) is exactly
  what earns the classic 60-minute budget you carry out the gate. Discoveries
  bank for the NEXT day.
- **Day cycle.** You wake at 00:00 and are awake for exactly your budget of
  minutes, then sleep the rest — so early on you sleep almost the whole day
  (budget 1 → awake 00:00–00:01, asleep till midnight) and the waking window
  grows on its own as the budget does. No fixed sleep hours; sleep unlocks
  itself. The body adds two needs of its own: at least 8 hours asleep, and no
  more than 3 hours from waking to the first meal (see *Player energy*).
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
  a flat `COST_BASE` per step/scout regardless of biome, and the reserve
  prices the walk back to the centre rest spot like anywhere else. Safe means
  "can rest / no biome multipliers / no stranding," NOT free. Fully walled with
  a single (initially closed) gate. You start on the **centre special tile**
  (opens the cube view — reserved for special tiles, not built out yet). The
  home interior is otherwise a NORMAL tile — no special-casing beyond its
  props. Clearing it is the first task, and WALKING TO THE DOOR is the second:
  a gate opens under your feet (RULES 49) — the board fully discovered AND you
  standing on the doorstep tile, not the moment the last tile is found.
  Knowing the way out and taking it are two different things, and since a
  day's budget is the tiles you found BEFORE today, that walk is its own day.
- **The seam.** Sibling boards are pushed apart by exactly ONE hex row on a
  single shared lattice (offsets = rotations of (2R+2, −(R+1)), which sit at the
  clean ±30/±90/±150° screen directions — the snapped look, exact). The
  in-between row is the SEAM: the parent grid's EDGES made of child-scale tiles
  (4 side tiles per shared edge), and where three boards meet, a JUNCTION tile —
  a parent VERTEX. The view shows the interior, the seam ring, and the
  neighbours' facing rows: one continuous field.
- **Seam tiles are shared by both boards** of their edge: their state
  (discovery, types, walls) lives on the PARENT node keyed by global
  child-scale coords, so scouting one from either side reveals it for both.
  Junctions are confluences — see *Rivers* for what you can do from the water.
- **Crossing**: scout/step your way onto the seam, then step off onto a
  neighbour's tile — that landing step is the crossing; you arrive on that
  exact tile and the boards slide. No intermediate state. At the parent scale
  the crossing IS a step: the sibling's parent tile becomes discovered and the
  parent trail extends (or retraces); the cost charged is the plain local
  step. The super-index → parent-DIR bijection per orientation parity maps
  neighbour directions to parent tiles. Go-up stays hidden until earned.
- **SPACE IS GLOBAL.** Each depth level is ONE continuous lattice; the player,
  the entry and the trail live in global coordinates on it. There are no frames:
  crossing into another board is an ordinary step (the parent trail extends or
  retraces and the parent tile becomes discovered as bookkeeping), the trail is
  never translated or truncated, and retraces work across any number of boards
  natively. The camera is pure presentation: board-centred while on a board,
  player-centred on the seam (the classic inversion). A move glides the camera
  ONCE toward the DESTINATION board (averaging the whole route) instead of
  panning tile-by-tile with the ghost, so a winding path never bumps it
  fixed→follow→fixed; within one board it holds still and the cube walks across.
  Rendering is one global pass — every discovered tile in the viewport draws,
  culled at ~4 board-pitches around the camera (anchor read back from the live
  cam offset, so the ground tracks the viewport even mid-glide) or ~2
  screenfuls, whichever is smaller. Go-up and exit actions stay hidden until
  the parent view is earned.
- **Walls**: any side of any hex can be walled — walls are per-hex bitmasks
  (6 bits, one per side) on the owning board's node; seam hexes carry theirs on
  the parent node keyed by global seam coords, so both boards of an edge see the
  same. A wall on EITHER side of an edge blocks the step across it. This is the
  world-building primitive: rooms, corridors, sealed boards are all just wall
  bits.
- **The gate** belongs to the board, not the seam — it is a single EDGE of the
  doorstep tile (the last interior tile the seed angle's ray crosses on its way
  out). A gated board walls every border hex's outward sides, gate edge
  included; the gate starts CLOSED and ratchets open (that one wall bit clears
  for good) when the board is **cleared** (all 61 hexes discovered). GATE_TILE —
  the seam hex just beyond the gate edge — names where the ray exits the grid.
  The seam itself is outside every wall, and outside the safe umbrella: inside
  the home, interior moves and scouts cost the flat safe rate, while anything
  targeting seam or beyond charges the normal biome rate.
- **Tile types**: every hex can carry a type (sparse, per tile node); a type's
  properties are cost multipliers on the level base. Board interiors default to
  `plain` (×1); seam tiles carry the `seam` type, which discounts nothing — a
  river is not a road. The standing hook for terrain and specials with real
  costs.

### Rivers

**Every seam is a river. The gate is a bridge.** Same geometry as the seam,
opposite reading: the one-hex row between boards is not a corridor you walk
through, it's the water you have to get across. Each board is an ISLAND, and the
map is not a plane you wander — it's a network you build, one crossing at a
time. Clearing a board and standing on its door still opens its gate; the gate is just read as your first
bridge rather than a door swinging in a wall.

- **On foot you can stand in a river, and that's all.** A seam tile stays
  walkable: you step into the water and you're there. But from a river tile
  there is nowhere to go — not across, and **not along**. Your moves are: back
  to the tile you came from, or BUILD. A river tile is a dead end you enter and
  leave the same way. (Aboard the raft it is the opposite of a dead end — see
  the raft, below. Everything here describes being in the water on your feet.)
- **River tiles do not connect to each other.** You always enter the water FROM
  a shore, so reaching the next river tile means going back to land and
  stepping in again: river → land → river, never river → river. The seam is not
  a path in the movement graph at all — each of its tiles hangs off the land
  beside it, like a jetty. Nothing can strand you (coming back is always legal),
  but "walk the seam around to the gate" is not a thing you can do.
- **A bridge joins TWO TILES, and you pick them.** Not an edge, not a board —
  one tile to one tile. You build standing in the river, and at the moment of
  construction you CHOOSE which tile the bridge lands on. That choice is the
  commitment: a bridge is a place you decided, and where it puts you down
  decides what you can reach next. Once built it's permanent and works both
  ways.
- **A bridge must land on LAND.** You cannot bridge to water — the far end is
  always a board tile, never another river tile. This is what settles
  JUNCTIONS: standing in a confluence, three boards touch you, and one bridge
  builds ONE crossing — so you pick a SIDE. The other two stay water until
  something else spans them. A confluence isn't a special case, it's just a
  river tile with more shores to choose from.
- **You can SEE across — that's what standing in a river is for.** Sight and
  walk are separate (`isFrontier` uses sightNeighbors while movement filters
  impassable ground), so from a river tile you can scout the far bank. Nothing
  to walk to, everything to look at. The river is a VANTAGE, not just an
  obstacle: you wade in, scout across, see what's over there, and only then
  decide where three loads of rubble are going. The bridge choice is an informed
  one, and the looking is what earns it.
- **The wall's debris makes a RAFT.** Clearing a board tears its wall DOWN, and
  what's left is material: rubble you can pick up. What you build with it is the
  first VEHICLE, not the first bridge — a bridge needs a landable bank on the one
  river tile you can reach, and some worlds don't have one (a board you could
  never leave). Water always goes somewhere; a raft can't seal you in. It also
  makes the one-waterfront-tile rule a feature: the tile past your gate is your
  HARBOUR.
- **The SHALLOWS are a river by another name.** The water in play is not only
  the seam: board water of **deepness 0** counts too, so ponds, tarns and
  coastal fringes are road to a raft and a lake stops being a hole you walk
  around. On foot they behave exactly like a river: you wade in from a bank and
  stand there, and the only ways out are that same bank and a bridge. So every
  rule about water is one rule — a dead end you enter to LOOK from and to BUILD
  from, and a network once you're afloat. That's what makes a boat buildable on
  a lake: you can stand in it to haul the loads in and raise it. Deeper water,
  deepness 1+, is nothing but a wall and says so.
- **A raft lives on the water.** It is moored at one river tile and only moves
  when you're on it: board it by stepping onto its tile from a bank, and while
  aboard the river stops being a dead end — navigate tile to tile, and land on
  ANY shore. Step ashore and it stays where you left it. That's the game of
  owning one: not affording it, but knowing where it is. (One raft, for now.)
- **The haul.** The raft isn't granted, it's CARRIED: pick up a load of debris,
  walk it to the water, drop it. **One load** — a raft is the cheap starter
  vehicle; a bridge's three is what heavy permanent work costs. The rubble is
  VERY heavy, so even one trip is a slow one; the pack's weight already prices
  movement and this is the load that makes you feel it.
  - Opening the gate FELLS the wall, and the felled stretch leaves **three loads
    of `debris` on the DOORSTEP tile** — an ordinary pile, on the tile the wall
    stood on, one step from the water it's meant for. Three is a bridge's price;
    a raft spends one of them. (`fellWall`, keyed off the same ratchet that
    opens the gate, and planted in the day's start snapshot so a rewind can't
    sweep it away.)
  - `debris` is the heaviest thing in the game — a full base pack on its own.
    One load is one trip, and that trip costs double per step.
  - Building takes what's **lying on the tile**, never what's on your back: you
    haul it into the water and drop it, then build. A raft costs 1 load, a
    bridge 3. The raft also costs `RAFT_MIN` minutes to lash together —
    reserve-guarded, standing in the water, with the way home still priced on
    foot (the raft doesn't exist until the minutes are spent). The bridge costs
    no minutes for now — the three hauls under the load were the price.
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
  That's a road. Three hauls, sited where you stand, joining two tiles you pick.
- **…and it DAMS the river.** A debris bridge sits low on the water: **boats
  cannot pass it**. Later bridges — raised, arched, built rather than tipped
  into place — will let them through. So the first crossing has a price you
  can't see when you pay it: the tile you span stops being navigable, and a
  seam you bridge early is a seam your boats can't run later until something
  better replaces it. Crossing the water and travelling the water are rival
  uses of the same tile, and that tension is the point.
- **The leap is DRY.** It works on open ground and never touches water — as
  footing, as flanker or as landing (river, shallows or deep) — so a seam is
  never leapt along or across and every crossing stays bridge and raft business.
  Fording stays open as something EARNED: a skill level or a learned ability
  that crosses one tile of river at a real cost, and never at a confluence.

**What it costs to cross, in practice.** Behind a walled home you can reach 62
tiles on foot — the board and the single river tile past the gate. With a raft
moored there, that becomes ~220. So the raft is worth roughly three and a half
boards of world, and it is the difference between a life and a cell. Hauling
ACROSS water is expensive enough to change how you play: carrying five items'
worth of camp materials over a river is not a single outing, it wants ferrying
(gather, drop on the bank, come back). That is the pack-weight rule biting
exactly where it should, and it's what makes the bridge worth its three hauls.

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
2. **Boats beyond the raft.** The raft is the first one and it arrives early —
   the wall's own debris. What's open is what comes after it: a boat that
   carries cargo, one that's faster, one you can own more than one of, and
   whether any of them is a craft, a skill or a place. The arc is settled
   though: seams were roads → rivers you can only stand in → rivers you can run,
   from the first day you clear a board.
3. **Can a bridge be undone?** Torn down, rebuilt raised, moved — or is an
   early crossing a permanent dam on that tile? Deliberately parked: no strong
   opinion yet, and nothing else waits on it.

## Energy / movement model

- Costs are **one-way, never refunded**. Two actions:
  - **SCOUT** (`scout`): reveal an adjacent undiscovered tile WITHOUT moving,
    cost `SCOUT_COST × level base` — discovering is cheap; walking there is the
    commitment. **Priced PER RING OF TILES** — one literal hex ring outward from
    the world's origin, one more multiple:

    | ring (hex distance from home's centre) | scout |
    | --- | --- |
    | 0–5 — the home board and the river ringing it | **1×** |
    | 6 — the first shore | **2×** |
    | 7 | **3×** |
    | *n* > 5 | **(n − 5)×**, uncapped |

    `max(1, ring − SEAM_RING + 1)`. Why so steep: the daily budget IS your
    discovered tile count, so cheap scouting COMPOUNDS — every tile revealed
    buys more revealing tomorrow, and exploration runs away with the game.
    Distance must not be free real estate, so that SETTLING and working your
    surroundings is the better move. The scout SKILL is what wins the range back
    (−1/30 per level, half price at 15), which makes the ladder: stay close, get
    good, then go far. Nothing is exempt but home and its own river ring — the
    rivers further out are priced by their ring like everything else.

    **SAILING pays this ramp hardest.** The ring is distance from the world's
    origin and the river network winds outward, so the water ahead of the boat
    gets dearer with every tile (ring 10 → 6×, ring 15 → 11×), and you cannot
    sail into fog. A 61-minute day afloat spent 34 minutes revealing the way and
    had nothing left to reveal a bank, let alone step onto one. So a raft's
    range is not its own — it is the scout budget, and it is what the scout
    SKILL (and a camp on the far side, once camps carry a reserve) is for.
  - **MOVE** (`move`): step onto *known* ground only, cost
    `MOVE_COST × level base` per step. Backtracking costs too — walking home is
    time that passes.
  - **LEAP** (part of `move`, `LEAP` flag): jump the DIAGONAL — the tile
    directly beyond the edge two adjacent neighbours share — for the price of
    ONE step onto the landing. The leap rides that shared edge like a road: out
    through the vertex between the flankers, along their edge, in through the
    far vertex. Legal when both flanking tiles are discovered, no wall touches
    the corridor (the two edges at each vertex + the ridden edge) — so a gate
    funnels single-file STEPS, never leaps — and the whole move is DRY (see
    *Rivers*). The flankers are never stood on, charged, or trailed. Collinear
    2-out through a tile's centre is NOT a leap. Leaps are ordinary edges of the
    move graph — routing, the reserve and retraces all use them, and they chain.
    Consequence: the reserve prices the LEAP route home, so a full walking
    retrace can honestly exceed it near depletion (the UI falls back to the
    shortest route).
- Level base cost: `COST_BASE = 1` at the playing depth (the unit everything
  prices off), multiplied by `SCALE_RATIO = 6` per level UP (inside a tile 1,
  home interior 6, outside 36). With `ENERGY_START = 60`, energy is literally
  minutes.
- **Resting places + the return reserve.** The world keeps a list of RESTING
  PLACES a day can end and restart from — the home centre is entry one; built
  spots (camps, waystations…) join the list. The loop stays closed and
  compilable: you can only continue while at least one resting place is
  affordably reachable, so a saved state is always a safe state. The reserve is
  the true cheapest charge from a position to the NEAREST resting place over
  discovered ground — one multi-source Dijkstra seeded at every spot (steps
  inside safe interiors charge the flat safe rate, so the reserve prices the
  home walk too), cached until discovery, walls or the spot list change.
  `canMove(t)` = route exists AND path + reserve-from-t is affordable;
  `canScout` = frontier AND scout + current reserve affordable.
  **Never-strandable** is literal: at `energy == reserve` the trip to safety is
  affordable to the minute. The way back need not retrace: the router recomputes
  the best route (leaps and seams included), and the UI falls back from an
  unaffordable trail retrace to that shortest route, so hover and click never
  die. Resting ANYWHERE is deliberately not allowed — rest happens at resting
  places only.
- Energy refills **only by resting at a resting place** → sleep → next day.

### Player energy

The body's needs, on top of the time budget. Two base rules, both plain numbers
that skills will stretch later:

- **Sleep at least 8 hours a day** (`SLEEP_MIN`). The waking window can never
  run past `WAKE_CAP` — the day less that sleep: the budget stops there (a
  fully-mapped world's day is 16 hours, not 24), and so does what a meal can
  stretch a day to. Nothing else about the day cycle moves — you still wake at
  00:00 and sleep whatever you don't spend.
- **Three hours from waking to the first meal** (`HUNGER_MAX`), and thereafter
  **a meal is worth its own time**. The MEAL CLOCK is a due minute: waking sets
  it `HUNGER_MAX` out, and every bite pushes it on by the food's own
  nourishment — herbs three minutes, a cooked hare forty-five. The push is the
  RAW nourishment, never the ration-clipped `eatBoost`: `EAT_CAP` governs how
  much waking time food can add to the day's window, never the body's clock, and
  a clipped push would strand you hungry with food on your back. It is enforced
  the way everything else is — through the reserve. What you can still spend
  today is `timeLeft = min(energy, hungerLeft)`, and every affordability check
  (moves, scouts, gathers, crafts, builds, lessons, the raft) prices against
  that, so the sim always lands you at a resting place before the next meal is
  due, exactly as it does before the budget runs out. A day without food is
  therefore three hours long however big the budget, and ends in sleep. `eat` is
  reserve-guarded like any action (the sitting plus the way home must fit); a
  bite is always worth the clock, since every food outweighs the two-minute
  sitting.
- **A bite changes the pack, so it re-prices the world.** `eat` and `cook` bump
  `worldStamp` like every other pack-changing action, so the reach and reserve
  caches price the fresh, lighter pack instead of refusing tiles it can afford.
- **Where it bites: work, not distance.** Routes are short in minutes — on a
  test world every tile of a fully-mapped map sat within a 120-minute round
  trip, well inside one meal — so three hours never limit travel by themselves.
  What runs the clock down is time spent: gathers, crafts, builds and above all
  lessons (an hour each), and carrying food is what buys a longer working day.
- **Two deadlines, two marks** (display only). The PIN stands at the budget —
  the day discovery earned you — and the MEAL is the same mark taken apart, one
  dot at each of the dial's levels, so where the two coincide the dots hide
  exactly under the pin. Each reddens on its own clock. The lit free-time
  stretch runs to the day's ALLOWANCE (the budget less what food added), so it
  is one steady reading all day: a meal moves the marks, never the allowance.

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
  later days can't lose ground, but energy and abilities genuinely cascade.
  Invalid-action policy when editing lands: leaning grey-as-broken.
- Days advance on sleep. Each banked day stores its log AND its day-start
  snapshot, so any day is reconstructible. A day starts at a resting place —
  home or a camp — and ends at one.
- **The save IS the log**: `serialize()` returns plain JSON —
  `{schema, world: {angle, rings, rules}, days: [{day, actions}], today}` — no
  world state; everything derives by replay. `hydrate()` re-dispatches every
  action from day 1 on a FRESH sim and refuses on any mismatch: `SCHEMA` stamps
  the format, `RULES` stamps replay semantics and bumps on ANY change that
  alters what an old log replays to (dev-phase rule: mismatched saves reset,
  stashed not destroyed). Day-enders (rest / goHome) are logged — pushed before
  running, they bank as their day's last entry, which is what lets a save replay
  ACROSS days. The controller mirrors every successful dispatch to localStorage
  (`anon&mato:save` — the STORAGE KEYS keep the old spelling on purpose:
  renaming one orphans a live save or the drawn icon store).
- Nostr rides the same format later: one event per banked day (NIP-78 style,
  `d = anon&mato:<world>:day:<n>` — editing a day republishes one event) plus
  a replaceable head event; the npub is the player, and deriving each world
  from the pubkey is a founding goal (collaboration via nostr later).

## Timed actions

Actions aren't instant. A scout / gather / craft / build waits IN PLACE for its
charge (`TIME_SCALE` ms per simulated minute, fast-forwarded by `WAIT_SPEED` for
now; a future upgrade shrinks the real wait while the simulated cost stays).
Input locks while waiting; the wait is presentation — the sim applies the action
atomically on completion (abandoning mid-wait spends nothing).

A MOVE animates instead of waiting — the cube WALKS the route, paced by the
tiles' CHARGE: `MOVE_MS_PER_CHARGE` ms per charge-minute, so costly ground walks
slower than easy ground, floored at `MOVE_MS_MIN` (a brisk single step) and
capped at `MOVE_MS_MAX` (a faraway route stays WATCHABLE — you see the whole
walk — but never crawls). A board SHIFT adds a beat scaled by how far the camera
slides, so a seam crossing doesn't whip past at the step's pace. The cube glides
continuously tile-to-tile on an asymmetric-quad ease — SHORT in, LONG out (quick
off the mark, soft landing, `MOVE_EASE_IN`); the camera borrows the move's
DURATION but its own quad (longer out) and aims at the destination, a
lead-and-follow rather than one rigid motion. All the constants live in
grid.js/render.js and are the tuning knobs; the shared `draw.js` holds the
`easeSplit` curve both use.

## Gather / craft / build

The works layer, all through the same day/reserve economy:

- **Gather** — an action on a forage NODE underfoot, OUT PAST THE SEAM. Not
  every biome tile yields: whether a tile is a node for each of its biome's
  resources is a DETERMINISTIC draw from the world key + coord (`NODE_DENSITY`
  per resource), so the same world always forages the same and it replays. Biome
  frequency × node density is the scarcity: some boards are bare of a resource
  by design, and rare finds (a metal node) are landmarks worth a camp. The HOME
  board is NOT gatherable at all — its tiles are the identity/minimap, not land.
  A node gives one unit of its resource (a biome offers a SET — see *Forage &
  hunt*). For now you learn a tile's yield only by STANDING ON IT — the info
  card names what's there and its regrow state. A FORAGE MAP that marks ready
  nodes at a glance is a tech to be earned or learned later, not a free perk
  (the nodes are derivable in theory, but the game should earn the map). What
  scout already buys is the REGROW RING: at `REGROW_EYE` you see a patch you
  picked coming back. Display-only, so neither gate touches replay; the dev
  sandbox (world.html) is omniscient. Costs minutes per resource
  (`RESOURCES[r].min`), eased by the gather skill toward half at 15; an axe
  halves wood. Each tile carries a REGROW clock (`RESOURCES[r].regrow`, in
  world-minutes — 1440/day, sleep included): plants return within the day, metal
  is a yearly pilgrimage. Affordability keeps the reserve invariant against the
  HEAVIER pack — the way home is re-priced at the post-pickup load, so a gather
  can never strand you.
- **Spoilage** — the pack is dated INSTANCES, not counts. A raw harvest has a
  SHELF life (`RESOURCES[r].shelf`, world-minutes): food rots and is lost past
  it (a day for what you hunt and what comes out of the sea, days for fruit and
  roots, a month for nuts; wood/rock/metal keep). Spoilage is irreversible —
  expired instances are pruned at every action boundary, so a later preserver
  can't un-rot food. `worldMin` is monotonic (a rest jumps the day 1440 > any
  ≤60 refill), so the clocks replay deterministically. You can't hoard — you use
  it or lose it.
- **Carry** — items weigh (`RESOURCES/RECIPES[].weight`); capacity is
  `CARRY_BASE + gather level + baskets`. The LOAD multiplies every step linearly
  up to 2× at a full pack — through the exact reserve, weight literally shortens
  reach. Full pack = no more picking up (hard cap). `debris` — the felled wall's
  rubble, see *Rivers* — is the extreme case and the reason the rule exists: one
  load IS a full base pack, so a haul is a single slow trip and nothing else
  comes with you.
- **Craft vs build — the line.** Both are "materials + time + a level → a
  thing", and the two `can` blocks are the same five checks; what separates them
  is **whose the thing is**. A CRAFT is YOURS: it rides on your back, it can be
  spent, worn out or dropped, and it changes what *you* can do. A BUILD becomes
  THE PLACE: it has no weight, it can't be carried, it only ever accumulates,
  and it changes what *anyone* standing there can do. The data structures sort
  them — `raft` is one mutable pointer that re-moors as you use it, while
  `bridges`/`restSpots` are grow-only world sets. So gear, containers and
  VEHICLES are craft (a raft and a cart are containers with a bulk allowance —
  see *Carrying*, and VISION's `cart · craft 2`); camps, bridges, roads and every
  future structure are build (`road · build 2`). Two skills, not one, because
  they gate the game's two constraint systems: craft output competes for the
  PACK (weight, wear, capacity), build output competes for REACH (rest spots,
  reserve anchors, step costs) — and the 4/4/4 pillar geometry and the 12-nibble
  `statsOf` read both depend on the count.
- **Craft** — a verb YOU perform. Your own `craft` level against the recipe's
  `level`, the materials off your own back, your own minutes — and it TRAINS
  craft like every other verb. Consumption spends OLDEST fresh stock first, and
  the product (lighter than its inputs) never breaks the reserve. **You can make
  it ANYWHERE** — out on the land or at your own fire at home. A recipe MAY
  declare a `site`, a biome that must be underfoot (real land, so never home and
  never a board centre), and then it can only be made there; **no crude recipe
  does**. Pinning hand-work to terrain only reads as arbitrary — there is no
  reason you can't weave a basket by your own fire — and it isn't needed to keep
  the game outbound: the pack, the reserve and where the nodes are already do
  that. `site` waits for the recipes that will earn it (a forge that wants ore
  underfoot, a boatyard that wants a shore), and most making will move onto
  STRUCTURES anyway (VISION's kiln, larder, library), which is the better gate
  because you had to build it first. Crude tier (craft 1): the basket (5 plants
  → +4 carry AND `keeps` ×1.5 on perishable shelf, the first storage tech;
  later builds preserve far longer) and the four TOOLS — axe, net, snare,
  spear — each with a FINE tier at craft 6, lighter and quicker, and none of
  them wearing out — see *Forage & hunt*.
- **Build** — a structure on the tile underfoot: materials on the back, build
  level, minutes. Real LAND is all the site asks. The CAMP (`BUILDS.camp`) joins
  `restSpots`: the reserve anchors to it immediately and the day can END there
  (rest works at any resting place, not just home).
- **Drop / take — what you put down STAYS PUT.** You can `drop` any item onto
  the tile underfoot, instantly and free, ANYWHERE — and it lies on that exact
  tile until someone picks it up with `take`. Every tile is a storage cell,
  keyed by global coord; still ONE item type per cell. This is what makes
  material HAULING possible (carry a load to a site, leave it, come back with
  more — see *Rivers*: one load of the felled wall's debris makes the raft,
  three make a bridge, and a build takes them off the GROUND, not your back),
  and it turns any tile into a depot. Dropping lifts weight off your back for
  the next leg; dropped food still spoils (a plain tile keeps time — a carried
  basket's preserve factor does NOT reach it; a preserving STORE is future
  tech). Piles show a small ring on their tile, and the tile underfoot lists
  what's on it in the bottom-RIGHT corner, mirroring your own pack's row in the
  bottom-left.
- **Carrying wants a real system (open).** Today capacity is one number — weight
  against `CARRY_BASE + gather + baskets` — and that won't carry the game much
  further. What's needed is at least TWO axes: **weight** (what you can bear)
  and **SIZE/bulk** (what you can physically hold at once), so that a bridge's
  worth of rubble is not "heavy" but *unwieldy* — three trips because your arms
  are full, not because your back gives out. That split is what makes VEHICLES
  mean something later: a cart, a barrow, a raft — each one a container with its
  own bulk allowance, its own speed penalty, and its own terrain it can't cross.
  Not designed yet; the shape of the answer is "the pack is one container among
  several".
- **Eat & cook — FOOD IS TIME.** Food's sink is the budget itself: every raw
  food carries `food` — nourishment in MINUTES — and `eat` (1 min, anywhere,
  oldest fresh instance first) adds it to TODAY's waking window. Capped at
  `EAT_CAP` per day (the sacred baseline again: a second wind, not a second day)
  and never past the waking cap; a bite also pushes the MEAL CLOCK, and `eat` is
  reserve-guarded like any action (see *Player energy*). `cook` (10 min eased by
  the cook skill, half at 15; trains cook — the first SPACE transform) works AT
  A HEARTH — any resting place — and turns one raw unit into COOKED FOOD OF ITS
  OWN KIND: `cooked fish`, `cooked berries`, one kind per raw food, generated
  from the raw, worth 3× its nourishment and wearing the raw's own face in
  CAPITALS. The worth and the keeping belong to the KIND, not the instance,
  because a cooked hare is 45 minutes and a cooked kelp 12 — one generic `meal`
  chip made them the same grey box and hid the whole point of cooking. A meal
  keeps TWICE its raw's shelf and never under `MEAL_SHELF_MIN` (48h) — the fire
  is itself a preserving step, so every day-spoiler (fish, hare, eel, kelp,
  oysters, crabs) clears a clean two days while nuts stay the long trail food at
  60. One ingredient per cook today; when a recipe takes SEVERAL, the
  shortest-lived of them has to govern. Weight 1, so cooking never breaks the
  load-priced reserve. Accounting: `fed` (minutes eaten into today) grows the
  budget reading instead of un-spending energy, so the clock and `worldMin` stay
  monotonic; day-snapshotted, log-derived. WHERE THEY LIVE (2026-09-14): COOK is
  the radial menu's fire, and it lists only raw food — cooked, a thing leaves
  that list for good, because the fire has nothing left to do with it. EAT is
  not on the menu at all: a bite belongs to the thing itself, so it sits on the
  pack chip's own click list, in the corner where the food is.
- Practice: gather / hunt / craft / build / cook each train their own skill (the
  same doubling-threshold counters as walking and scouting) — `PRACTICE_SKILL`
  maps action kind → skill.
- State (`inventory` as instance arrays, per-tile `gatheredAt`, camps) is
  log-derived; the save FORMAT is unchanged — still just the action log.

### Forage & hunt

Every biome feeds you, each in its own way, and the tool on your back decides
what else it gives. FORAGE is what you pick up bare-handed (the `gather` action;
trains gather). A HUNT is what you have to catch with a tool of the right KIND
(the `hunt` action; trains hunt). A biome offers a SET (`BIOME_YIELD`), a tile is
a node for each entry on its own draw, and each resource keeps its own regrow
clock per tile — picking the berries leaves the nuts alone. Both verbs are one
take: `min × the tool's speed × the skill's ease` (half the minutes at 15, like
scouting). Reach was never the hard part — a resource the map hands you the
moment you can stand next to it is worth nothing, so the TOOL is the gate, not
the boat: a hunted resource names the kind it needs (`hunt: "net"`), the take is
refused without one on your back, and `gatherInfo().lacks` names it for the
ground row.

| biome | forage, by hand | hunt, with a tool | material |
| --- | --- | --- | --- |
| plain | fruit, plants | hare (snare) | |
| marsh | roots | eel (spear) | |
| forest | berries, nuts | hare (snare) | wood |
| beach | oysters, crabs | fish (net) | |
| shallows | kelp | fish (net), eel (spear) | |
| cliff | eggs | | |
| mountain | herbs | | rock |
| peak | nothing — carry food up | | metal |

The subtleties are the numbers on `RESOURCES`: berries are quick and gone by
the second night, nuts are the first food that keeps (a month — trail food),
oysters and kelp spoil by the next day, herbs are barely food (heal's
ingredient later), and every hunt pays more and spoils in a day.

**Tools come in TIERS and do not wear** (the reasoning is in
`attic/decisions.md`). A tool recipe names its KIND (`tool: "net"`) and its
`speed`, the multiplier on the minutes of every take it serves. The crude tier
(craft 1) is heavy and slow, the fine tier (craft 6) light and quick — what you
carry and how fast you work are the whole difference. **One of a kind:** the
fine tier REPLACES the crude one — the tool you carry is among the upgrade's
needs and is consumed — and you carry one tool of a kind; crafting a second
while you hold one is refused. The axe is optional (wood comes by hand, slowly);
net, snare and spear are required by what they hunt.

| tool | crude (craft 1) | the upgrade (craft 6) |
| --- | --- | --- |
| axe | 2 wood + 1 rock · weight 2 · wood in half the time | the axe + 1 wood + 1 rock · weight 1 · a third of the time |
| net | 4 plants · weight 2 | the net + 4 plants + 1 wood · weight 1 · 40% quicker |
| snare | 2 plants + 1 wood · weight 2 | the snare + 2 plants + 1 wood · weight 1 · 40% quicker |
| spear | 1 wood + 1 rock · weight 3 | the spear + 1 wood · weight 2 · 40% quicker |

`gather` names its item; a bare `gather` takes the first forage the tile has
ready, which is how older logs replay. `hunt` is its own action. The craft
category shows ONE node per tool kind — the tier you'd make next: the crude one
until you carry it, then its upgrade — and the focused fan takes as many cells
as the list needs: the six neighbours first, then the next ring out, and so on.
The ground row in the lower-right shows one box per yield, greyed with what
stops you (regrowing, pack full, the tool it wants), and a chip wears a
resource's `tag` where its first letter is already taken.

## Architecture

- `lib/hex.js` — pure hex/cube math + the two orientation matrices.
- `lib/world.js` — the fractal tile tree (spatial state only).
- `lib/sim.js` — **the game.** Pure and headless (runs in node): world, view
  stack, energy, costs, discovery, topology tables (super index ↔ parent DIR,
  parked edge-centre tiles), the action log, day snapshots, replay hooks.
  One `dispatch(action)` / `apply(action)` pair is the ONLY way state changes;
  live play, replay and future editing all flow through it. No canvas, DOM or
  timers here, ever.
- `lib/render.js` — draws sim state + presentation state, the radial menu
  included. Pixels never decide sim outcomes.
- `lib/grid.js` — the screen/controller: pointer → actions, timed-action
  waits, replay timer, hover previews.
- `lib/clock.js` — the sun and moon: `sunState`/`moonState` are pure, `drawDial`
  renders the stacked clock. Shared with the styles harness so the two can't
  drift.
- `lib/draw.js` — shared canvas helpers (the `easeSplit` curve among them).
- `lib/icons.js` — the line-art glyph system, drawn into the caller's ink.
- `lib/radial.js` — the stats card (8 skills as labelled bars): the panel the
  menu can raise, not the menu itself.
- `lib/identity.js` — who is playing, asked once.
- `lib/app.js` — canvas/screen engine. `lib/main.js` — entry point.
- `lib/cube.js` / `lib/cube3d.js` — the cube view and its draggable 3D lattice.
- Dev harnesses, each read STRAIGHT from the game's constants so they can't
  drift: `lib/guide.js` (guide.html, the gather/craft/build field guide),
  `lib/styleguide.js` (styles.html), `lib/worldview.js` (world.html, the
  fully-revealed parent field), `lib/iconmaker.js` (the icon editor).
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

## The radial menu

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
  the figure, them on the arc toward it. Helpers (playground / clear board /
  clear map / reset) hang off the TITLE cell, not the ring.
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
  Skills and their lessons live on the clock ring, not in the menu.
- **Auto-open**: the menu opens itself on arriving at the home centre or a
  figure's centre (a context transition); dismissing closes it until you
  move to another such spot. Clicking the player toggles it anywhere.
- **Inside a category**: the skill's name, its glyph and its whole reference —
  level and progress, home land, character, what it does — stand in the
  TOP-RIGHT corner (name on top, glyph below, then the words); the glyph
  travels there from its ring seat on the pull. The player's mark leaves the
  middle, which belongs to the fan. The clock stays for the cost previews.
  Clicking the corner glyph closes the category; Escape closes the menu one
  layer at a time (folder → category → ring).

## UI conventions

- All UI text 16px (weight/opacity for hierarchy, never smaller sizes); the
  one deliberate exception is the collapsed clock status line at 11px.
- ONE LOOK: the light paper, no theme switch — `--surface` and `--text` are
  fixed on `:root`; the night's ink is the game's own, not a theme.
- CSS grid as the layout base; flex only for equal-distribution rows.
- "Status line" = the budget/time-left line (`at [q,r] · 60m until rest · …`),
  not the top title line.
- The bar reads `[title][name][angle°][day N][hh:mm][log head]`: the title
  drops the helpers ("reset" alone before the world — the playground waits for
  it); your NAME drops who you are — the face down the left and your npub; the
  ANGLE drops the shelf — every game you've started by its angle alone, ordered
  alphabetically, the one you're in lit, another switching you into it by
  reload — with NEW last (parks this one and reboots straight into the compass,
  the intent kept across the reload); the day cell drops the played days; the
  clock unrolls the log. One bar menu open at a time; each slides in from under
  the bar the same way. The saves: the live game under `anon&mato:save`, every
  other game parked whole under `anon&mato:save:game:<angle:worldKey>`; "reset"
  clears the shelf too.
- The player cube is a plain hexagon outline + 3 inner radial lines — NOT a
  shaded/3D cube.

---

Everything **unbuilt** — the arc, the skills & tech vision, multi-POV days, the
idea box and what's parked — lives in [VISION.md](VISION.md).
