# anon & mato — design canon

The game presents as **anon & mato**. It runs standalone (no build step, vanilla
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
- **pentagon** — one of the twelve five-sided boards the globe needs: a board
  with one 60° wedge lifted out (51 hexes, five rivers, a bite of void)
- **tear** — a torn river: its two boards lie apart on the flat map, its tiles
  sit on one bank only, and the other bank's border faces the void
- **river** — the one-tile row between boards (the parent grid's edges): tiles
  of type `river`, on the same lattice and in the same store as every other tile
- **post** — a river tile where three boards meet (a parent vertex); a
  CONFLUENCE — three shores to pick from, one bridge
- **gate** — the single doorstep EDGE that opens a walled board
- **cross** — stepping out of the river onto another board (the boards slide)
- **clear** — fully discover a board (half of what opens its gate: the other
  half is standing on the doorstep)
- **home** — the walled safe board you start on
- **fog** — undiscovered ground; **trail** — the day's committed path
- **angle** — the setup angle (0° up, clockwise); with your key it seeds the
  whole world (the world key), and it decides where the gate falls
- **figure** — the one person on every board but home, standing at its centre
- **master** — the figure that holds one skill at the band's top; twelve of
  them, one per skill, on the pentagons
- **edge** — a side of a skill's shape: a skill at level L is an L-sided shape,
  and the next level is L edges away
- **first** — the first time you do a verb; lore writes it down
- **leap** — the power move: jump the diagonal (the tile beyond the edge two
  adjacent neighbours share) for one step's price, DRY ground only (see *Rivers*)
- **ford** — to cross a river on foot, no bridge; what a river refuses, and what
  may yet return as an earned ability

## Pillars

- **Time loop.** Nested scales: year (12 months × 30 days) → day (24 h) → hour
  (60 min). The minute is the clock's unit; a charge can come to a fraction of
  one (wear and load scale it). The sun dial round the board shows the day; the
  bar reads the day number and the time.
- **No win/lose.** Survival, gathering, making and building; skills grow with
  practice and lessons.
- **Energy IS time (minutes).** Traversal spends time. The daily budget IS how
  many tiles you've discovered (one minute each) plus one seed minute
  (`SEED_MIN`) so day one can act at all, capped at the full day (`FREE_CAP`;
  bed is a due minute, not a ceiling — see *Player energy*). Home is where
  time/energy resets, but it is NOT timeless: every step/scout there costs a
  flat minute, so clearing home spans several days — and clearing it (its 60
  non-centre tiles) is what earns the 61-minute budget you carry out the gate.
  Discoveries bank for the NEXT day.
- **Day cycle.** You wake at 00:00 and spend your budget; the day ends when you
  lie down at a resting place, and only after a day in which you did
  something. Early on the budget is a few minutes, so you sleep almost the
  whole day, and the waking window grows on its own as the budget does. No
  fixed sleep hours. The body adds two marks of its own: bed due 16 hours after
  waking, and no more than 3 hours from waking to the first meal (see *Player
  energy*).
- **Time vs tiles are SEPARATE axes.** Time is one continuous clock; a
  timestamp is a moment, not a place. Tiles are space — a fractal nested hex
  world (grids inside tiles inside tiles). The one-directional link: the time
  scale influences movement resolution on the tiles (finer scale → finer
  movement). The dial reads the CLOCK, never the spatial path.

## The world

- Radius-4 hex grid (61 tiles) per tile, arranged radially. Each tile lazily
  contains a child grid per hex (`world.js` tree) — re-entering a tile is the
  same place.
- **The world is a globe laid flat.** Seventy-two boards close into a sphere:
  60 hexagons and the 12 pentagons a hex grid must pay to close, at the corners
  of an icosahedron (every hexagon touches exactly one pentagon — twelve
  flowers of six). It is PLAYED FLAT: the angle cuts the globe along its rivers
  and lays every board on the parent lattice (`globe.js`) — home at the origin,
  its pentagon across the gate, an irregular rim in place of the old radius-4
  hexagon, every board at its true crossing distance from home. One angle, one
  map. A **pentagon board** is a hex board with one wedge lifted out: 51 tiles,
  five rivers, and a bite of void you walk round (its two cuts are one line on
  the globe). **A torn river keeps one bank.** Every river exists once: where its two
  boards lie apart on the map, its tiles sit on the bank nearer home (dealt
  first on a tie) — dead-end water you can stand in and not scout past — and
  the other bank is bare, its border facing the void like a wall. The wrap that
  joins the twins is unbuilt (VISION, *The wrap*).
- Orientation flips by depth (flat/pointy alternate) so a tile's interior reads
  consistently when later shown shrunk inside its opposite-orientation parent.
- **Play happens at depth 2** (`MAX_DEPTH`), on the lattice of tiles inside
  the boards. Depth 1 (`BASE_DEPTH`) is the parent lattice — one hex per board,
  the map view — locked, "gained" later; depth 0 is the tile that holds it.
- **Inside-home is the default view** and a **safe space** (`safe: true`):
  a flat `COST_BASE` per step/scout regardless of biome, and the reserve
  prices the walk back to the centre rest spot like anywhere else. Safe means
  "can rest / no biome multipliers / no stranding," NOT free. Fully walled with
  a single (initially closed) gate. You start on the **centre special tile**.
  The home board is not land: its tiles are your identity and the minimap, so
  nothing grows or is gathered there and nothing is built (it already rests
  you); making and cooking work there as anywhere. Water never rolls on it (it
  reads as marsh), so it can always be cleared. Clearing it is the first task,
  and WALKING TO THE DOOR is the second: a gate opens under your feet (RULES
  49) — the board fully discovered AND you standing on the doorstep tile.
  Scout the last tile from the doorstep and it opens on the spot; clear the
  board from anywhere else and it waits for the walk.
- **The river row.** Sibling boards are pushed apart by exactly ONE hex row on
  a single shared lattice (offsets = rotations of (2R+2, −(R+1)), which sit at
  the clean ±30/±90/±150° screen directions — the snapped look, exact). The
  in-between row is RIVER: the parent grid's EDGES made of child-scale tiles
  (4 side tiles per shared edge), and where three boards meet, a CONFLUENCE
  tile — a parent VERTEX. The view shows the interior, the river ring, and the
  neighbours' facing rows: one continuous field.
- **One ground per depth.** Every tile's state — discovery, walls, wear,
  stored type — lives in ONE store per depth, keyed by the tile's GLOBAL
  coordinate. Board land and river file alike; a river tile is no one board's,
  so scouting it from either bank reveals it for both (a torn river's tiles
  exist on the one bank that keeps them). A board is only a lookup — which
  board a tile falls in — for board-level things: the gate, clearing, biomes,
  the camera. The world tree's nodes keep just those board properties.
  Confluences — see *Rivers* for what you can do from the water.
- **Crossing**: scout/step your way into the river, then step out onto a
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
  player-centred in a river (the classic inversion). A move glides the camera
  ONCE, on the move's own duration, to the board the route ENDS on instead of
  panning tile-by-tile with the cube, so a winding path never bumps it
  fixed→follow→fixed; within one board it holds still and the cube walks across.
  Opening the menu centres the tile you stand on. Dragging or zooming the map
  holds the camera where you put it until your next move takes it back (mid-
  walk, until the walk lands). Zoomed in past 1:1 a board no longer fits the
  frame, so the camera frames your tile (or a walk's end) instead of the
  board's middle. The ground is the GPU map: every found tile, every frame
  (see *The menu*). Go-up and exit actions stay hidden until the parent view
  is earned.
- **Walls**: any side of any hex can be walled — walls are per-hex bitmasks
  (6 bits, one per side) in the ground, keyed by global coords, so both boards
  of a river see the same. A wall on EITHER side of an edge blocks the step
  across it. This is the
  world-building primitive: rooms, corridors, sealed boards are all just wall
  bits. The map's own edge is a wall too: every tile walls the sides that face
  the void (computed, never stored), so the whole world wears an enclosure like
  the home board's.
- **The gate** belongs to the board, not the river — it is a single EDGE of the
  doorstep tile (the last interior tile the angle's ray crosses on its way
  out; `gateEdgeFor(angle)`, and the river hex just beyond it is where the ray
  leaves the board). A gated board walls every border hex's outward sides, gate
  edge included; the gate starts CLOSED and ratchets open (that one wall bit
  clears for good) when the board is **cleared** (every tile discovered) and you
  stand on the doorstep. The river itself is outside every wall, and outside the
  safe umbrella: inside the home, interior moves and scouts cost the flat safe
  rate, while anything targeting the river or beyond charges the normal rate.
- **Tile types**: every hex can carry a type (sparse, in the ground); a type's
  properties are cost multipliers on the level base (`TILE_TYPES`). Board
  interiors default to their derived terrain (`plain` ×1 without a world key);
  the row between boards is the `river` type, at half a plain step — a step into
  the water is one minute. The standing hook for terrain and specials with real
  costs.

  | type | move | scout |
  | --- | --- | --- |
  | plain, beach | 1 | 1 |
  | forest | 1.5 | 1 |
  | marsh | 2 | 1 |
  | mountain, cliff, peak | 2 | 2 |
  | river | ½ | 1 |
  | water | impassable on foot (the shallows excepted — see *Rivers*) | 1 |

### The land

- **The world key is your key and the angle**: `worldKeyFor(pubkey, angle)`,
  a hash of the two. It derives everything a world has — its land, its
  texture, its figures, its masters, its forage. The same key at the same angle
  is the same world again; another angle is a world as different as another
  key's.
- **Two octaves.** BASE: one nibble per board, hashed from the world key and
  the board, blended between board centres so the continents run continuous
  across rivers — and round the globe: over a torn river a rim board blends
  with its real globe neighbour, weighed as if it lay in the empty cell beyond
  (RULES 65). DETAIL: each board's own hash stream, one nibble per tile in
  reading order, tweaks the base by `DETAIL`. Pure and cached.
- **Base class, then the neighbour grammar.** A tile is water (smoothed below
  `WATER_LEVEL`, or a highland TARN carved below a high neighbourhood),
  mountain (raw 12 or more) or plain. Mountain becomes PEAK where its detail
  nibble is 15, CLIFF where it touches water or drops sharply (`CLIFF_DROP`),
  else stays mountain; plain becomes MARSH beside two or more water, BEACH
  beside one, FOREST beside a mountain, else stays plain. Eight biomes.
- **Height is one number, its elevation**: land reads the field's own 0–15
  with the beach pinned at the waterline (4), and water runs from 0 at the
  shore down to −4 at the floor (a lone pond is measured against its own rim).

### Rivers

**The row between boards is river. The gate is a bridge.** The one-hex row
between boards is not a corridor you walk
through, it's the water you have to get across. Each board is an ISLAND, and the
map is not a plane you wander — it's a network you build, one crossing at a
time. Clearing a board and standing on its door still opens its gate; the gate is just read as your first
bridge rather than a door swinging in a wall.

- **On foot you can stand in a river, and that's all.** A river tile stays
  walkable: you step into the water and you're there. But from a river tile
  there is nowhere to go — not across, and **not along**. Your moves are: back
  to the tile you came from, or BUILD. A river tile is a dead end you enter and
  leave the same way. (Aboard the raft it is the opposite of a dead end — see
  the raft, below. Everything here describes being in the water on your feet.)
- **River tiles do not connect to each other.** You always enter the water FROM
  a shore, so reaching the next river tile means going back to land and
  stepping in again: river → land → river, never river → river. The river is not
  a path in the movement graph at all — each of its tiles hangs off the land
  beside it, like a jetty. Nothing can strand you (coming back is always legal),
  but "walk the river around to the gate" is not a thing you can do.
- **A bridge joins TWO TILES: the bank you waded in from, and the one you
  pick.** Not an edge, not a board — one tile to one tile, over the river tile
  you stand in. At the moment of construction you CHOOSE which tile the far end
  lands on. That choice is the commitment: a bridge is a place you decided, and
  where it puts you down decides what you can reach next. Once built it's
  permanent and works both ways.
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
  decide where a bridge's timber is going. The bridge choice is an informed
  one, and the looking is what earns it.
- **The first crossing is a RAFT.** Opening the gate fells that stretch of
  wall, and it leaves a STARTING KIT on the doorstep (`WALL_DROP`: 8 cord,
  4 branches, 2 rock, 1 metal — a little of most materials, enough to make your
  first things), and it holds a raft's cord and branches. (`fellWall`, keyed
  off the same ratchet that opens the gate, and planted in the day's start
  snapshot so a rewind can't sweep it away.) What you cross with first is a
  VEHICLE, not a bridge — a bridge needs a landable bank on the one river tile
  you can reach, and some worlds don't have one (a board you could never
  leave). Water always goes somewhere; a raft can't seal you in. It also makes
  the one-waterfront-tile rule a feature: the tile past your gate is your
  HARBOUR.
- **The SHALLOWS are a river by another name.** The water in play is not only
  the river: board water at **elevation 0** counts too, so ponds, tarns and
  coastal fringes are road to a raft and a lake stops being a hole you walk
  around. On foot they behave exactly like a river: you wade in from a bank and
  stand there, and the only way out is that same bank (a bridge is raised only
  from a river tile). So every
  rule about water is one rule — a dead end you enter to LOOK from and to BUILD
  from, and a network once you're afloat. That's what makes a boat buildable on
  a lake: you can stand in it to bring the materials in and raise it. Deeper water,
  elevation −1 and below, is nothing but a wall and says so. (A tile's height is
  ONE number, its elevation: land reads the field's own 0–15 with the beach
  pinned at 4, and water runs from 0 at the shore down to −4 at the floor.)
- **A STREAM runs along tile edges** (`streamAt`), corner to corner, from a
  board's highest mountain tile down to its river, through every lake on the
  board LOWER than where it rises, highest first — into a lake, and on out of
  it from anywhere on its shore. It is at least 3 edges long, detouring where
  the way down is shorter. Downhill: it climbs only where there is no way
  round, otherwise it takes the shortest way. It runs only between two dry
  tiles, never over itself, and it passes by a lake it couldn't get back out
  of to the river. A board with no mountain has none. Home has no elevation:
  its stream runs from the centre to the doorstep and meets the river at the
  gate. It is not a river: you walk across it freely. A tile with a stream
  along a side can hold fish (the same node draw as anywhere). Drinking, and
  work that needs water underfoot, come later.
- **A raft lives on the water.** It is raised in the water you stand in (river
  or shallows), moored on that one tile, and only moves when you're on it:
  board it by stepping onto its tile from a bank, and while aboard the water
  stops being a dead end — navigate tile to tile, and land on ANY shore. Step
  ashore and it stays where you left it. That's the game of owning one: not
  affording it, but knowing where it is. One raft, ever: a second is refused.
  Lashing it trains nothing.
- **The bill, ferried.** A raft costs `RAFT_NEEDS` (3 branches + 4 cord) and
  `RAFT_MIN` minutes to lash together — reserve-guarded, standing in the water,
  with the way home still priced on foot (the raft doesn't exist until the
  minutes are spent). A bridge costs `BRIDGE_NEEDS` (6 wood + 8 cord) and
  `BRIDGE_MIN` minutes, a morning's work. Work done ON THE SPOT counts what you
  CARRY and what LIES AT YOUR FEET alike (`atHand`, spent ground-first): what
  can't be carried in one go takes several trips — drop a load in the water, go
  back for the rest, build from the heap. A raft's bill (weight 10) already
  outweighs a starting pack (7); a bridge's (26) is a morning of ferrying before
  the morning of work.
  - The way home may go BY WATER. Ashore across the river, the reserve prices
    walking back to the raft, boarding it, punting to a shore that knows the
    way, and walking from there. Without that the far bank reads as unreachable
    from home and the never-strand rule refuses to let you off the raft at all —
    you could sail anywhere and land nowhere. (`reserveMap` seeds the raft's
    tile as a second source; `reserveBase` is the walking-only map the water
    route reads, so the one raft is never counted twice.)
- **A BRIDGE is what you build later, and it's a different thing.** Once a raft
  crosses water, a bridge isn't about crossing — it's about crossing WITHOUT the
  raft: with a load, without dismounting, every day, forever. That's a road,
  sited where you stand. The rule and its price are in the sim; nothing in the
  UI raises one yet (it wants the far-bank-picking gesture), and a raft passes
  under it. VISION, *Crossing water*, holds what bridges are still to become.
- **The leap is DRY.** It works on open ground and never touches water — as
  footing, as flanker or as landing (river, shallows or deep) — so a river is
  never leapt along or across and every crossing stays bridge and raft business.
- **What the UI says about crossing.** The raft sits on the build category's
  timeline (standing in the water, faded with what it still needs) and a hull
  is drawn where it's moored; the place card names the water and reads back
  your two states ("back the way you came" / "any shore").

**What it costs to cross, in practice.** Behind a walled home you can reach 62
tiles on foot — the board and the single river tile past the gate. With a raft
moored there, every river is road and every bank a landing, as far as you have
scouted (you cannot sail into fog). It is the difference between a life and a
cell. Hauling ACROSS water is expensive enough to change how you play: carrying
five items' worth of camp materials over a river is not a single outing, it
wants ferrying (gather, drop on the bank, come back). That is the pack-weight
rule biting exactly where it should, and it's what makes the bridge worth its
ferrying.

## Energy / movement model

- Costs are **one-way, never refunded**. Two actions:
  - **SCOUT** (`scout`): reveal an adjacent undiscovered tile WITHOUT moving,
    cost `SCOUT_COST × level base` × the tile's terrain scout factor (2× on
    mountain, cliff and peak; a board centre never) × its ring × the scout
    skill's discount — discovering is cheap; walking there is the commitment.
    Inside a safe board every scout is a flat `COST_BASE`. **Priced PER RING OF
    TILES** — one literal hex ring outward from the world's origin, one more
    multiple:

    | ring (hex distance from home's centre) | scout |
    | --- | --- |
    | 0–5 — the home board and the river ringing it | **1×** |
    | 6 — the first shore | **2×** |
    | 7 | **3×** |
    | *n* > 5 | **(n − 4)×**, uncapped |

    `max(1, ring − RIVER_RING + 1)`. Why so steep: the daily budget IS your
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
  - **MOVE** (`move`): step onto *known* ground only. A step costs
    `MOVE_COST × level base` (2 minutes at the playing depth) × the landing
    tile's terrain (see *Tile types*) × its HEIGHT × its WEAR × your LOAD:
    - **height** works the legs exponentially: each elevation point above the
      waterline (4) multiplies the step by `ELEV_STEP` (1.35 — the raw peak is a
      ~27× wall), and the travel skill eases that base toward `ELEV_STEP_FIT`
      (1.1) at 15;
    - **wear**: every earlier walk onto a tile takes `WEAR_STEP` (0.2) off its
      multiplier, down to `WEAR_FLOOR` (half) — a path you use gets cheaper, and
      the wear is a ratchet like discovery;
    - **load**: 1× empty up to 2× at a full pack (see *Carry*).

    A board centre is always one plain step (no terrain, no height). Inside a
    safe board every step is a flat `COST_BASE`. Backtracking costs too —
    walking home is time that passes.
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
  prices off), multiplied by `SCALE_RATIO = 6` per level UP (1 at the playing
  depth, 6 on the parent map, 36 above it). Energy is literally minutes;
  `ENERGY_START` (60) is only a reference — the budget is the tiles you found.
- **Resting places + the return reserve.** The world keeps a list of RESTING
  PLACES a day can end and restart from — the home centre is entry one; built
  spots (camps, waystations…) join the list. The loop stays closed and
  compilable: you can only continue while at least one resting place is
  affordably reachable, so a saved state is always a safe state. The reserve is
  the true cheapest charge from a position to the NEAREST resting place over
  discovered ground — one multi-source Dijkstra seeded at every spot (steps
  inside safe interiors charge the flat safe rate, so the reserve prices the
  home walk too), cached until discovery, walls or the spot list change.
  `canMove(t)` = route exists AND path + reserve-from-t fits `timeLeft`;
  `canScout` = frontier AND scout + current reserve fits `timeLeft`.
  **Never-strandable** is literal: at `timeLeft == reserve` the trip to safety
  is affordable to the minute. The way back need not retrace: the router recomputes
  the best route (leaps and rivers included), and the UI falls back from an
  unaffordable trail retrace to that shortest route, so hover and click never
  die. Resting ANYWHERE is deliberately not allowed — rest happens at resting
  places only.
- Energy refills **only by resting at a resting place** → sleep → next day.

### Player energy

The body's needs, on top of the time budget. Two base rules, both plain numbers
that skills will stretch later:

- **Bed is due 16 hours after waking** (`WAKE_CAP` — the day less the
  `SLEEP_MIN` it owes): a due minute like the meal's, its own mark on the dial.
  It is a marker, not a ceiling: the budget and what a meal can stretch a day to
  both run to the full day (`FREE_CAP`), and the reserve prices every trip
  against the nearest of budget, meal due and bed due, so it lands you at a
  resting place before bed exactly as before hunger. Nothing pushes the bed
  pin yet. Nothing else about the day cycle moves — you still wake at 00:00 and
  sleep whatever you don't spend.
- **Three hours from waking to the first meal** (`HUNGER_MAX`), and thereafter
  **a meal is worth its own time**. The MEAL CLOCK is a due minute: waking sets
  it `HUNGER_MAX` out, and every bite pushes it on by the food's own
  nourishment — herbs three minutes, a cooked hare forty-five. The push is the
  RAW nourishment, never the ration-clipped `eatBoost`: `EAT_CAP` governs how
  much waking time food can add to the day's window, never the body's clock, and
  a clipped push would strand you hungry with food on your back. It is enforced
  the way everything else is — through the reserve. What you can still spend
  today is `timeLeft = min(energy, hungerLeft, sleepLeft)`, and every
  affordability check (moves, scouts, gathers, crafts, builds, lessons, the
  raft) prices against that, so the sim always lands you at a resting place
  before the next meal or bed is due, exactly as it does before the budget runs
  out. A day without food is therefore three hours long however big the budget,
  and ends in sleep. `eat` is the one action checked against the budget alone:
  the sitting, less what the bite adds, plus the way home must fit `energy` —
  never the meal clock, since eating is what pushes it. A bite is always worth
  it, since every food outweighs the one-minute sitting (`EAT_MIN`).
- **A bite changes the pack, so it re-prices the world.** `eat` and `cook` bump
  `worldStamp` like every other pack-changing action, so the reach and reserve
  caches price the fresh, lighter pack instead of refusing tiles it can afford.
- **Where it bites: work, near home; travel, far and high.** Near routes are
  short in minutes — on a fully-mapped test world everything within eight tiles
  of home's centre sat inside a 94-minute round trip, well inside one meal — so
  there three hours never limit travel by themselves. What runs the clock down
  is time spent: gathers, crafts, builds and above all lessons (an hour each).
  Height prices steeply, though: on the same world high ground a dozen tiles
  out was a 314-minute round trip, past one meal. Carrying food is what buys a
  longer working day, and a longer reach.
- **Three deadlines, three marks** (display only). The PIN stands at the budget
  — the day discovery earned you — and the MEAL and BED are the same mark taken
  apart, one dot at each of the dial's levels. Both are clamped to the budget,
  so past it they ride up to the pin and hide exactly under it. Each reddens on
  its own clock. The lit free-time
  stretch runs to the day's ALLOWANCE (the budget less what food added), so it
  is one steady reading all day: a meal moves the marks, never the allowance.

## Discovery (fog of war)

- Each depth keeps ONE persistent `discovered` set, keyed by global coordinate
  (the ground — see *The world*). Only discovered tiles + the player's own
  frontier render; beyond is fog.
- Exploration is **deliberate clicks** (hover must NEVER reveal or discover).
- **Discovery is an immutable one-way ratchet.** Nothing ever un-discovers a
  tile. `reachedEdges` (which of a tile's 6 edges the player has stood at) and
  WEAR (how often each tile has been walked onto) are the same kind of ratchet.
  Looking back at a past moment builds that moment on a scratch sim, so its fog
  is the fog it had; the live sets never shrink.

## The action log (the design's centre of gravity)

- The game is a deterministic sim. A day's actions are recorded as a log, and
  every past moment is a PREFIX of it.
- Days advance on sleep. Each banked day stores its log AND its day-start
  snapshot, so any day is reconstructible. A day starts at a resting place —
  home or a camp — and ends at one.
- **The save IS the log**: `serialize()` returns plain JSON —
  `{app, schema, world: {angle, pubkey, worldKey, rings, rules}, days: [{day,
  actions}], today}` — no world state; everything derives by replay. Every load
  passes one gate on a FRESH sim and refuses on any mismatch: `SCHEMA` stamps
  the format, `RULES` stamps replay semantics and bumps on ANY change that
  alters what an old log replays to, and the angle, the key and the world key
  must be this world's (dev-phase rule: mismatched saves reset, stashed under
  `hex:save:rejected`, not destroyed). `hydrate()` re-dispatches every
  action with full validation — the reference path the tests use. The game
  boots through `hydrateProgressive()`, which re-APPLIES the known-good log
  without re-deciding it (the same `run` as live play, only the `can` check
  skipped; a move carries its resolved route, `via`, so nothing is re-routed),
  in chunks behind a progress bar. Day-enders (`rest`; `goHome`, which sleeps
  you from anywhere and survives only so old logs replay — nothing in the UI
  dispatches it) are logged — pushed before running, they bank as their day's
  last entry, which is what lets a save replay ACROSS days. The controller
  mirrors every successful dispatch to localStorage (`hex:save` — the
  STORAGE KEYS keep the old spelling on purpose: renaming one orphans a live
  save or the drawn icon store).
- **Looking back.** The day cell on the bar drops the played days, and the
  time cell unrolls the day's log. Picking a day, or a row of its log, builds
  that moment on a SCRATCH sim (the save hydrated up to that prefix) and points
  the screen at it; the live game is untouched, and the past is read-only — no
  action dispatches while you look. Changing day dips the world through a short
  fade; stepping within a day doesn't.
- **Replay.** A log row's REPLAY button plays the day on from that row, one
  action every `REPLAY_MS`, and loops back to the morning when the day runs
  out. The bar becomes the transport: `[title][name][angle][back][forward]
  [play][exit][hh:mm]`; a step back is rebuilt from the log, since an action
  cannot be un-run. Exit comes home to the living game.
- **Restore.** A log row's RESTORE rewinds the SAVE itself to just before that
  row — it and everything after it, later days included, are cut — and
  reboots into the shortened log. The discarded save is kept once under
  `hex:save:before-restore`.
- Nostr rides the same format later: one event per banked day (NIP-78 style,
  `d = hex:<world>:day:<n>` — editing a day republishes one event) plus
  a replaceable head event; the npub is the player, and deriving each world
  from the pubkey is a founding goal (collaboration via nostr later).

## Timed actions

Actions aren't instant. A scout / gather / craft / build waits IN PLACE for its
charge (`TIME_SCALE` ms per simulated minute, fast-forwarded by `WAIT_SPEED` for
now, never under a short floor; a future upgrade shrinks the real wait while the
simulated cost stays). Input locks while waiting; the wait is presentation — the
sim applies the action atomically on completion (abandoning mid-wait spends
nothing).

A MOVE animates instead of waiting — the cube WALKS the route, each tile paced
by its CHARGE: `max(MOVE_MS_STEP_MIN, MOVE_MS_UNIT × charge^MOVE_MS_CURVE)`, so
costly ground walks slower than easy ground and nothing flickers past; there is
no cap, so a far route is watched whole. A board SHIFT adds a beat scaled by how
far the camera slides (`MOVE_MS_PER_SHIFT_TILE`, capped at `MOVE_MS_SHIFT_MAX`),
so a river crossing doesn't whip past at the step's pace. A single step glides
on an asymmetric quad — SHORT in, LONG out (`MOVE_EASE_IN`, the shared
`easeSplit` in `draw.js`); a longer walk eases in on its first tile, runs at an
even pace, and settles over its last. The camera borrows the move's DURATION
but its own quad, a lead-and-follow rather than one rigid motion. A walk of
three or more steps shows STOP: it lands on the nearest legal tile and charges
only what was walked. All the constants live in grid.js/render.js and are the
tuning knobs.

## Gather / craft / build

The works layer, all through the same day/reserve economy:

- **Gather** — an action on a forage NODE underfoot, OUT PAST THE RIVER. Not
  every biome tile yields: whether a tile is a node for each of its biome's
  resources is a DETERMINISTIC draw from the world key + coord (`NODE_DENSITY`
  per resource), so the same world always forages the same and it replays. Biome
  frequency × node density is the scarcity: some boards are bare of a resource
  by design, and rare finds (a metal node) are landmarks worth a camp. The HOME
  board is NOT gatherable at all — its tiles are the identity/minimap, not land.
  A node gives one unit of its resource (a biome offers a SET — see *Forage &
  hunt*). You learn a tile's yield only by STANDING ON IT — the ground boxes in
  the lower-right corner show its real nodes, greyed while bare or regrowing
  (the place card lists the biome's whole set). What scout buys is the REGROW
  RING: at scout `REGROW_EYE` (6) you see a patch you picked coming back. Display-only, so neither gate touches replay; the dev
  sandbox (world.html) is omniscient. Costs minutes per resource
  (`RESOURCES[r].min`), eased by the gather skill toward half at 15; an axe
  halves wood. **A spot TIRES as you work it** (`bareDays`): each tile keeps a
  count per resource, and your gather level is how many gathers it gives before
  it goes bare; then it is bare a day, and every further gather doubles that —
  2, 4, 8 days, by the calendar, so a bare day ends when you wake. Each full day
  a spot sits back and untouched undoes one gather, so a spot you pace holds
  steady (at gather 1, every other day) and one you strip every time it's back
  falls away fast (days 0, 1, 3, 7, 15…). Wood, rock and metal tire the same
  way. Hunts keep a REGROW clock instead (`RESOURCES[r].regrow`, in
  world-minutes — 1440/day, sleep included). Affordability keeps the reserve
  invariant against the HEAVIER pack — the way home is re-priced at the
  post-pickup load, so a gather can never strand you.
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
  reach. Full pack = no more picking up (hard cap): a bill heavier than your
  pack — a raft's, a bridge's — is ferried over several trips (see *Rivers*).
- **Craft vs build — the line.** Both are "materials + time + a level → a
  thing"; what separates them is **whose the thing is**. A CRAFT is YOURS: it rides on your back, it can be
  spent, worn out or dropped, and it changes what *you* can do. A BUILD becomes
  THE PLACE: it has no weight, it can't be carried, it only ever accumulates,
  and it changes what *anyone* standing there can do. The data structures sort
  them — `raft` is one mutable pointer that re-moors as you use it, while
  `bridges`/`restSpots` are grow-only world sets. So gear, containers and
  VEHICLES are craft (a raft and a cart are containers with a bulk allowance —
  see *Carrying*, and VISION's `cart · craft 2`) — though the raft, raised on
  the spot in the water it floats on, is listed under build; camps, bridges, roads and every
  future structure are build (`road · build 2`). Two skills, not one, because
  they gate the game's two constraint systems: craft output competes for the
  PACK (weight, wear, capacity), build output competes for REACH (rest spots,
  reserve anchors, step costs) — and the 4/4/4 pillar geometry and the
  twelve-way `statsOf` read both depend on the count.
- **Craft** — a verb YOU perform. Your own `craft` level against the recipe's
  `level`, your own minutes, and the materials **off the ground at your feet
  first, then off your back** (RULES 64, as the raft's and the bridge's bills —
  only the tool an upgrade replaces is always the one you hold) — and it TRAINS
  craft like every other verb. Consumption spends OLDEST fresh stock first.
  **What it makes lands on your back while it fits** — and still leaves the way
  home at that load — **and at your feet when it doesn't** (RULES 66, unit by
  unit), so a craft is never refused for room and never breaks the reserve. **You can make
  it ANYWHERE** — out on the land or at your own fire at home. A recipe MAY
  declare a `site`, a biome that must be underfoot (real land, so never home and
  never a board centre), and then it can only be made there; **no crude recipe
  does**. Pinning hand-work to terrain only reads as arbitrary — there is no
  reason you can't weave a basket by your own fire — and it isn't needed to keep
  the game outbound: the pack, the reserve and where the nodes are already do
  that. `site` waits for the recipes that will earn it (a forge that wants ore
  underfoot, a boatyard that wants a shore), and most making will move onto
  STRUCTURES anyway (VISION's kiln, larder, library), which is the better gate
  because you had to build it first. **The levels climb in steps** (a recipe's
  level is its own): craft 1 turns raw matter into material — cord, shards;
  craft 2 works one material into a thing — the cutter, the piercer, the
  crusher, rope, the basket (3 cord → +4 carry AND `keeps` ×1.5 on perishable
  shelf, the first storage tech; later builds preserve far longer), the net;
  craft 3 puts parts together — the axe, the snare, the spear, the hammer; and
  the four hunting/felling tools each have a FINE tier at craft 6, lighter and
  quicker, none of them wearing out — see *Forage & hunt*. **Stone is worked
  before it is used**: a rock is broken into shards, a shard knapped into a
  HEAD that stands on its own — the cutter (an edge), the piercer (a point), the
  crusher (a blunt face). **Branches are the hafts**: picked up off the forest
  floor, a branch goes in as it is, and a head on a branch with a cord is a
  tool — the cutter an axe, the piercer a spear, the crusher a hammer (which
  nothing takes yet); the snare is a branch and cord. **A tool held, not spent** (`with`): a recipe
  may name the tool KINDS it is worked with, any one of which must be on your
  back and none of which it consumes — the fine net, snare and spear say
  `cutter` or `axe`.
  **The yield can be the tool's** (`makes` a map of held tool → yield). What a
  held tool is good for is each recipe's own list, never a rule about a class
  of things.
- **Build** — a structure on the tile underfoot: materials on the back, build
  level, minutes. Real LAND is all the site asks. The CAMP (`BUILDS.camp`) joins
  `restSpots`: the reserve anchors to it immediately and the day can END there
  (rest works at any resting place, not just home); one camp per tile, never on
  home. The build category lists the RAFT at build 1 (3 branches + 4 cord,
  raised standing in the water). The camp (build 2: 3 wood + 2 plants, 30
  minutes) is in the sim but not on the menu.
- **Drop / take — what you put down STAYS PUT.** You can `drop` any item onto
  the tile underfoot, instantly and free, ANYWHERE — and it lies on that exact
  tile until someone picks it up with `take`. Every tile is a storage cell,
  keyed by global coord, and holds as many kinds as you put there. A drop with
  nowhere to land is refused, so nothing leaves your back unless a tile takes
  it. This is what makes
  material HAULING possible (carry a load to a site, leave it, come back with
  more — see *Rivers*: the raft and the bridge count what lies at your feet as
  well as what you carry),
  and it turns any tile into a depot. Dropping lifts weight off your back for
  the next leg; dropped food still spoils (a plain tile keeps time — a carried
  basket's preserve factor does NOT reach it; a preserving STORE is future
  tech). Piles show a small ring on their tile. **The corners**: what you carry
  stands in a column bottom-LEFT on the LOAD (weight against allowance — a box
  that opens "drop everything"); what the tile underfoot grows and what lies on
  it stand in one column bottom-RIGHT on the place's name, what's been put down
  nearest the name and what grows a gap above it; a RAFT moored where you stand
  is a box on the name's own line, left of it. While you walk, that corner stands down, and the tile you
  arrive on fills it when you get there. One box per KIND by its full name, with how many when
  there's more than one, each box as wide as what it says. A pack box opens
  "drop" — "drop 1" and "drop all" when there's more than one (a `drop` can
  take `n`) — and, for food, "eat"; a pile box picks one up on a click, and
  the place's name, clicked, picks up everything lying there — kind by kind in
  the order it was put down, as much of each as still fits (a `take` can take
  `n` too).
- **Carrying wants a real system (open).** Today capacity is one number — weight
  against `CARRY_BASE + gather + baskets` — and that won't carry the game much
  further. What's needed is at least TWO axes: **weight** (what you can bear)
  and **SIZE/bulk** (what you can physically hold at once), so that a bridge's
  worth of timber is not "heavy" but *unwieldy* — several trips because your arms
  are full, not because your back gives out. That split is what makes VEHICLES
  mean something later: a cart, a barrow, a raft — each one a container with its
  own bulk allowance, its own speed penalty, and its own terrain it can't cross.
  Not designed yet; the shape of the answer is "the pack is one container among
  several".
- **Eat & cook — FOOD IS TIME.** Food's sink is the budget itself: every raw
  food carries `food` — nourishment in MINUTES — and `eat` (1 min, anywhere,
  oldest fresh instance first) adds it to TODAY's waking window. Capped at
  `EAT_CAP` per day (the sacred baseline again: a second wind, not a second day)
  and never past the full day (`FREE_CAP`); a bite also pushes the MEAL CLOCK,
  and `eat` is reserve-guarded (see *Player energy*). `cook` (eased by the
  cook skill, half at 15; trains cook — the first SPACE transform) works AT A
  HEARTH — any resting place — and turns raw food into COOKED FOOD OF ITS OWN
  KIND: `cooked fish`, `cooked berries`, one kind per raw food, generated from
  the raw, worth 3× its nourishment, its tag the raw's in CAPITALS.
  The worth and the keeping belong to the KIND, not the instance, because a
  cooked hare is 45 minutes and a cooked kelp 12 — one generic `meal` chip made
  them the same grey box and hid the whole point of cooking. A meal keeps TWICE
  its raw's shelf and never under `MEAL_SHELF_MIN` (48h) — the fire is itself a
  preserving step, so every day-spoiler (fish, hare, eel, kelp, oysters, crabs)
  clears a clean two days while nuts stay the long trail food at 60. Weight 1,
  so cooking never breaks the load-priced reserve. See *The pot* below for what
  goes on the fire. Accounting: `fed` (minutes eaten into today) grows the
  budget reading instead of un-spending energy, so the clock and `worldMin` stay
  monotonic; day-snapshotted, log-derived. WHERE THEY LIVE: COOK is the
  kitchen (the cook category), and it lists only raw food — cooked, a thing leaves
  that list for good, because the fire has nothing left to do with it. EAT is
  not on the menu at all: a bite belongs to the thing itself, so it sits on the
  pack box's own click list, in the corner where the food is.
- **The pot (RULES 54, 57, 60).** A cook takes a POT — raw kind → units — not one item.
  As many DIFFERENT ingredients as your cook level (1 → 15), and up to
  `COOK_SERVINGS` (3) of any one of them: there is no pot at the start, only
  SKEWERS over the fire, and a bigger vessel (pottery, later) is what will lift
  that. The fire burns BRANCHES (`FUEL`), and **a branch lasts `FUEL_COOKS` (2)
  cooks**: the fire takes `COOK_FUEL` (1) off your back only when the last one's
  cooks are spent (`fuel`, log-derived, carried across days and hearths), a
  single ingredient included. **A meal takes one of each kind**: serving *j*
  is every kind the pot holds at least *j* of, so 2 fish + 1 herbs is one
  `cooked fish + herbs` and one `cooked fish` — more of a thing makes MORE MEALS,
  never a bigger one. A meal of several kinds is a DISH, and its name is its
  recipe (the raws in order), so the worth stays on the kind and nothing is
  registered anywhere (`dishDef` reads the name): 3× the summed nourishment, the
  SHORTEST-LIVED ingredient governs the keeping, weight 1. The right mix is a
  COMBO (`COMBOS`): a meal holding every kind a combo names — more besides is
  fine, the combo naming the most kinds wins — is worth `time`× its minutes,
  keeps `keeps`× as long, and wears the combo's name and face; a plain dish
  wears its richest ingredient's capitals and how many kinds went in (`F3`).
  The nine: fruit salad (berries + fruit, ×1.2), trail mix (berries + nuts,
  ×1.1, keeps ×2), omelette (eggs + herbs, ×1.3), herbed fish (fish + herbs,
  ×1.25), surf & turf (fish + hare, ×1.3), marsh pot (eel + roots, ×1.25, keeps
  ×1.5), garden bowl (fruit + nuts + plants, ×1.3), shore platter (crabs + kelp
  + oysters, ×1.4), hunter's stew (hare + herbs + roots, ×1.5, keeps ×1.5).
  **The minutes are in the variety**: `COOK_MIN` (10) for the first ingredient,
  `COOK_KIND_MIN` (5) each further kind, `COOK_SERVING_MIN` (2) each further
  serving — so cooking surplus is nearly free, and the question it leaves is how
  to keep it. One cook is one practice, however full the pot. IN THE MENU the
  cook category is THE KITCHEN, and it is drawn in THE STASH'S OWN BOXES — no
  hexagons, and nothing on the hex grid (the category fans nothing). Round the
  ring every raw food you carry has its seat (always the same seat): its box,
  big, wearing the food's TAG, and under it a − and a + either side of `in the
  pot / on your back`; pointing at the box says what it is worth cooked. Under the fire
  stands THE POT, a row a meal — the boxes that go into it and the name it
  comes out under, a box clicked going back to the pack — and under that the
  COOK button (a menu node like any other: its bill on the cursor, its minutes
  on the clock, its needs lit green in the corners). What the pot would make
  reads out under the category's corner, narrow: a COLUMN a meal under its tag
  — minutes, keeping, calories, proteins — then the
  cook's minutes (and the branch, the cook the fire wants one), and the kinds
  used against your level with the cooks the last branch still has in it.
- **Nutrition is simulated.** Every food carries `kcal` and `protein`, a dish
  the sum of its parts; the kitchen prints them and NOTHING reads them. They
  are there to be tuned by eye before a health system (food balance, sleep,
  water — none of it designed yet) is wired to them.
- Practice: gather / hunt / craft / build / cook each train their own skill,
  as walking and scouting do (see *Skills*); the raft trains nothing.
- State (`inventory` as instance arrays, per-tile `gatheredAt` and `worked`
  counts, camps) is log-derived; the save FORMAT is unchanged — still just the
  action log.

### Forage & hunt

Every biome feeds you, each in its own way, and the tool on your back decides
what else it gives. FORAGE is what you pick up bare-handed (the `gather` action;
trains gather). A HUNT is what you have to catch with a tool of the right KIND
(the `hunt` action; trains hunt). A biome offers a SET (`BIOME_YIELD`), a tile is
a node for each entry on its own draw, and each resource on a tile is a spot of
its own — picking the berries leaves the nuts alone. Both verbs are one
take: `min × the tool's speed × the skill's ease` (half the minutes at 15, like
scouting). Reach was never the hard part — a resource the map hands you the
moment you can stand next to it is worth nothing, so the TOOL is the gate, not
the boat: a hunted resource names the kind it needs (`hunt: "net"`), the take is
refused without one on your back, and `gatherInfo().lacks` names it for the
ground boxes. A forage can name a tool of its own too (`with: ["cutter"]`) —
roots are dug and oysters prised with the cutter, refused without it — and it
stays a gather, by hand and training gather.

| biome | forage, by hand | hunt, with a tool | material |
| --- | --- | --- | --- |
| plain | fruit, plants | hare (snare) | |
| marsh | roots (cutter) | eel (spear) | |
| forest | berries, nuts | hare (snare) | wood, branches |
| beach | oysters (cutter), crabs | fish (net) | |
| water (the shallows) | kelp | fish (net), eel (spear) | |
| cliff | eggs | | |
| mountain | herbs | | rock |
| peak | nothing — carry food up | | metal |

Any land tile with a STREAM along a side also offers fish (net).

The subtleties are the numbers on `RESOURCES`: berries are quick and gone by
the second night, nuts are the first food that keeps (a month — trail food),
oysters and kelp spoil by the next day, herbs are barely food (heal's
ingredient later), and every hunt pays more and spoils in a day.

**Tools come in TIERS and do not wear** (the reasoning is in
`attic/decisions.md`). A tool recipe names its KIND (`tool: "net"`) and its
`speed`, the multiplier on the minutes of every take it serves. The crude tier
is heavy and slow, the fine tier (craft 6) light and quick — what you carry and
how fast you work are the whole difference. **One of a kind:** the fine tier
REPLACES the crude one — the tool you carry is among the upgrade's needs and is
consumed — and you carry one tool of a kind; crafting a second while you hold
one is refused. The axe is optional (wood comes by hand, slowly); net, snare
and spear are required by what they hunt. **Stone is worked before it is
used:** a rock is a lump — broken (2 min) it is three SHARDS, and a shard
knapped (5 min) is a HEAD: the CUTTER, the tool roots and oysters ask for; the
PIERCER; the CRUSHER. **Branches go in as they are:** picked up off the forest
floor (weight 2), a branch is the haft of the axe, the spear, the hammer and
the snare, and what the fire burns. A recipe worked with a held tool says so
(`with`), and holds it rather than spends it.

| part | made of | craft | minutes |
| --- | --- | --- | --- |
| cord | 2 plants | 1 | 5 |
| shard ×3 | 1 rock | 1 | 2 |
| rope | 3 cord | 2 | 10 |
| piercer | 1 shard | 2 | 5 |
| crusher | 1 shard | 2 | 5 |
| basket | 3 cord | 2 | 10 — weight 1, +4 carry, food on your back keeps ×1.5 |

| tool | crude | the upgrade (craft 6) |
| --- | --- | --- |
| cutter | craft 2 · 1 shard · 5 min · weight 1 · digs roots, prises oysters | |
| net | craft 2 · 2 cord · 12 min · weight 2 | the net + 2 cord + 1 wood, with a cutter or an axe · 20 min · weight 1 · 40% quicker |
| axe | craft 3 · the cutter + 1 branch + 1 cord · 12 min · weight 2 · wood in half the time | the axe + 1 wood + 1 rock + 1 cord · 20 min · weight 1 · a third of the time |
| snare | craft 3 · 1 branch + 1 cord · 10 min · weight 2 | the snare + 1 cord + 1 wood, with a cutter or an axe · 18 min · weight 1 · 40% quicker |
| spear | craft 3 · the piercer + 1 branch + 1 cord · 10 min · weight 3 | the spear + 1 wood + 1 cord, with a cutter or an axe · 18 min · weight 2 · 40% quicker |
| hammer | craft 3 · the crusher + 1 branch + 1 cord · 10 min · weight 2 · nothing takes it yet | |

`gather` names its item; a bare `gather` takes the first forage the tile has
ready, which is how older logs replay. `hunt` is its own action. **The craft
category is a TIMELINE**, and so is build: a COLUMN per level — every level
you have reached and the next one that holds anything, while the levels past
that stay hidden — the columns spread evenly round the clock, the first at 12
o'clock: two sit top and bottom, three four hours apart, twelve an hour
apart. The level stands as a big bare number just inside the dial, where a
clock writes its hours, and its things hang inward from it, toward the middle,
by their full names, in label-size boxes as wide as the column's widest; a
thing you can't make now is faded, and the next level is hollow — dashed
borders only, its number faint. Clicking a number closes its column, or opens
it again; columns start open and a closed one stays closed across reloads
(`hex:timelineclosed`). Pointing at a closed number raises its names on
the cursor. Pointing at a thing inverts it, lights what it
takes green in the timeline, and raises its BILL on the cursor like any hover
label — the name and minutes, a row per material, red where you are short, then
any other refusal. Clicking makes it. **The corners light what the bill would
actually take**, in the order it would take it and no more than it needs: off
the ground at your feet first, then off your back (a craft and the raft; the
pot takes off your back alone) — a box goes green only when some of it would
be spent. What is
still short stands as a RED thin-dashed slot at the top of the pack, with how
many, and what the tile grows lights when it is one of those.
The ground column in the lower-right shows one box per yield by its full name,
greyed with what stops you (regrowing, pack full, the tool it wants). A
resource's `tag` is the face it wears in the kitchen.

## Skills

- **Twelve skills on one wheel** (`STAT_NAMES`, clockwise from scout at the
  top): scout · travel · gather · craft · hunt · cook · dream · lore · heal ·
  build · farm · trade. The three pillars are contiguous arcs of four: TIME
  (farm · trade · scout · travel) across the top, SPACE (gather · craft · hunt ·
  cook) down the right, MIND (dream · lore · heal · build) down the left. Every
  skill faces its opposite: scout ↔ dream, travel ↔ lore, gather ↔ heal,
  craft ↔ build, hunt ↔ farm, cook ↔ trade. The order is not cosmetic:
  `statsOf` reads any key's 64 nibbles into the twelve BY INDEX (each the
  rounded average of a contiguous slice of 5–6), and the masters are dealt in
  the same order.
- **You start at one.** A key's reading is its NATURE — how gifted its bearer
  is. Yours sets no start: every skill of yours begins at 1 (`PLAYER_START`)
  and climbs to 15 (`SKILL_CAP`).
- **The shape is the level.** A skill at level L is an L-sided shape — level 1
  the single seed dot, level 2 a two-dot line — and the next level is L edges
  away (`edgesForLevel`). Lessons, practice and teaching all count in the same
  edges. A level reads as a figure like `3.42`: level 3, 42% into the next.
- **Practice: doing trains.** `PRACTICE_SKILL` maps action → skill: a move
  trains travel (only onto NOVEL ground — a tile's first wear), a scout trains
  scout, and gather, hunt, craft, build and cook each train their own; every
  first trains lore (see *The inner voice*) and every night's sleep trains
  dream. `PRACTICE_BASE` (20) of a kind fill an edge; a night comes once a day,
  so sleep fills one in six (`PRACTICE_PER`) — an edge a week.
- **What they do** (`SKILL_INFO`): travel flattens the climb; gather sets how
  many gathers a spot gives before it tires, eases the forage (half the
  minutes at 15) and adds to what you carry; craft and build gate their
  recipes; scout cheapens scouting (toward half at 15) and at 6 shows the
  regrow ring; lore is the inner voice, and at 6 draws the day-of-year axis on
  the dial; hunt eases the hunt and cook the cooking (half at 15), and cook
  sets how many kinds the pot takes. Trade, farm, heal and dream do nothing
  yet.

## Figures & lessons

- **Every board but home keeps one figure**, standing at its centre. Its key
  is the board's own hash stream — a real nostr identity anyone can recompute
  from the world key. `statsOf` reads its nature, squeezed into the band
  `NPC_MIN..NPC_MAX` (2..12): nobody is born useless, nobody a master of
  everything. A figure SITS AT its nature.
- **Place is nature, for the stationary.** A figure's home biome lifts that
  biome's skill (`BIOME_SKILL`: water → travel, beach → trade, marsh → farm,
  plain → gather, forest → craft, mountain → build, cliff → scout, peak → lore)
  by `PLACE_BONUS` (3), never past `PLACE_CAP` (11): home ground alone never
  makes a master. Hunt, cook, heal and dream have no home land. You get no
  place bonus — you move.
- **One master per skill, on the pentagons.** The twelve pentagon boards each
  hold the master of one skill at `NPC_MAX` (12), dealt from the world key in
  wheel order — so every world can carry you to 12 in everything, and finding
  who is the game.
- **Learn.** Within a step of a figure, a lesson in a skill they currently
  outrank you in fills one whole edge of yours. It takes an hour and a bit
  (`lessonTime`: 60 + 2 × your level) and is reserve-guarded like any work.
  Nobody teaches past what they know: you stop at their level.
- **Teach.** The mirror, `LESSON_COST` (60) minutes, in a skill you outrank
  them in: one edge into their shape. It can carry a figure past its nature up
  to 15 — the only way anyone in the world passes 12 — and since you must
  outrank them first, it never hands you back a level you didn't grind.
- **Twelve is kept** (`MASTERY`). Below 12 a skill is a pool and every
  exchange moves an edge out of someone: a lesson takes its edge FROM the
  teacher, who stays drained until taught back up, and teaching costs you
  yours. At 12 or above nothing drains — a master teaches without losing, and
  so do you. An ordinary figure meets you in the middle; only a master carries
  you to 12.
- **Where.** With the menu open the twelve skills ride the ring just outside
  the dial, each with its sign just inward of its glyph; facing a figure the sign
  reads + (a lesson to take) or − (a level to give), and either is clicked in
  place. A lesson waits out its minutes like any timed work.

## The inner voice (lore)

- **Lore is the player's inner voice.** The FIRST time you do a thing, it is
  written down: a verb (move, scout, gather, hunt, eat, cook, craft, build,
  drop, take, learn, teach, raft, bridge, sleep) or a moment (the open gate,
  the first board that isn't home, the first figure found beside you, the first time
  an action leaves no minutes left). What the verb was done to is not a first
  of its own: the first craft is written, not every new thing made. The dev
  helpers write nothing.
- **Each first trains lore** as one practice trains its skill
  (`PRACTICE_SKILL.first`): twenty firsts make an edge.
- **Log-derived.** The sim's `noted` (first id → its day, its minute, and your
  lore as it was written) is rebuilt by replay like everything else and
  snapshotted with the day; the save format is unchanged. The gate, which never
  un-falls on a rewind, is planted in the day's start as the wall's kit is.
- **What it says** is `lib/lore.js`: an entry is lines by lore (`SAYS`) — the
  first is always said, each further one only if your lore had reached its rung
  when it was written. Every line is written by hand.
- **The box.** A first is said the moment it happens, in the big type, bottom
  centre over everything: what was first, inverted, with how many more wait
  behind it, then the lines. A click reads it and the next takes its place. It
  holds its tongue while you dream and while you look back.
- **The journal** is lore's category: a column of names, newest first, under
  the category's title — a remote for the box. It holds only what's been read:
  a first still waiting in the box joins it when clicked. A name opens its entry there,
  its date where its name was, and stands inverted while it's open; clicking it
  or the box puts it back. The wheel steps through the names one at a time.

## Setup is the game

There is one screen, with a PHASE: `dot` → `key` → `angle` → `play`. The sim
under the first phases is a placeholder, swapped for the keyed one through the
same binding looking back uses. No save opens on `dot` (or on `key`, when a key
is remembered — a key is never asked for twice); a save boots straight to
`play`. Escape steps back through the phases.

- **`dot`** — black, and the home centre's mark, which PULLS at the cursor: an
  edge stretches from it toward your hand on a damped spring, and the title
  stands at the cursor as the game's own hover label. The click asks for the
  key — the signer is only ever asked after it.
- **`key`** — the bar is up, and the user box asks the NIP-07 signer: "waiting
  for signer", "signer not found" (it keeps watching for a late extension and
  asks the moment one lands), or "signer refused" as a button that asks again.
  With the key, the box reads the npub in full while the profile is looked up,
  then shrinks onto your name, and the ANGLE MENU fades in beside it: with
  nothing on the shelf, NEW alone, and the compass opens on its own; with a
  shelf, the angles drop open, NEW last.
- **`angle`** — the compass (`lib/setup/angle.js`) on the dial. The aim is a
  BOW: walking in from the number toward the middle opens a circle and draws a
  string, and an arrow threaded through the number points wherever your hand
  is; only the middle lays it along the dial's own radius. Press and release
  ON the middle to loose (off it, the bow stands down): the arrow flies off
  along its bearing and leaves the angle line standing. Then every corner of
  the hexagon sends a ray through your hand; at the middle all six find their
  dots, the edges grow along them, and the shape closes onto the clock's
  second minute lap. An angle already on the shelf is a hollow dot, and the aim
  steps past it. A second press and release brings the shape home: it is
  knocked inward onto the tile, the player's hex and a figure's nested in it
  — the game's own resting stack — and the five other corners come out to
  the tiles beside you while the angle's own corner becomes the dial's end
  marker at minute 0. The finished tile takes the angle's hue under your hand
  and wears the wake mark.
- **`play`** — that click derives the world key from your key and the angle,
  builds the world, banks it and opens it IN PLACE, with the wake's whoosh.

## The dial, the sky and the night

- **The dial** is a ring round the board — the river ring's circumcircle —
  pinned to the viewport centre, so the world slides under it. It is a 12-hour
  face made of minute dots: the morning's 720 ARE the horizon, the afternoon's
  720 a lap just inside. Every lived minute is its dot lifted to its action's
  height — sleep on the horizon, a move one step up, everything else two — so
  the day draws itself as you live it, morning outward and afternoon inward.
  The three deadline marks stand on it (see *Player energy*).
- **The sun** sits at its day-of-year angle — the year walks the colour wheel,
  and the sun wears that day's hue — and rises above the ring by day and sinks
  below it by night; the season shifts that wobble, so day length drifts across
  the year. **The moon** shares the sun's angle and drifts 48 minutes a day: a
  30-day cycle, full on day 1, on a tilted orbit, so an eclipse comes only when
  a new or full moon falls on a node.
- **The sky.** The twelve skills are constellations: stars are a skill's level
  dots, lines its filled edges. The wheel turns once a year and carries the
  in-season skill up out of the ring at the top; only the crest shows above
  the horizon, only at night, washed out by the moon, and only for skills
  you've met. At lore 6 the sun's day-of-year axis draws on the dial, dashed,
  so you can read where you are in the year with the sun down.
- **The night is black, and the light is the lamp at your eye.** Below the
  horizon a black veil comes down, up to `NIGHT_MAX` by a new-moon midnight; a
  full moon lifts it only a little. The one light you carry is a round lamp on
  the player's eye dot, which leans after the cursor, so the light sways with
  your hand. The world has its own: the arrow standing in the home doorway
  keeps a light at its tip that never goes out — the way out is findable after
  dark. Walls stop light. Dreaming douses your lamp, never the world's. The
  player draws above the veil. The chrome's ink and paper flip for the night
  (`nightPair`) in a quick switch, not a slow crossfade; by day the world takes
  a faint wash of the sun's hue.
- **The arrow comes back.** When the home gate opens on a live step, the
  camera rides to the doorstep, the arrow you shot at setup comes back down the
  angle line, breaks the wall where the line crosses it, and stays spanning the
  doorway. It is not state: an open gate IS the arrow standing in it, so it
  survives a rewind as the felled wall does, and replays don't re-shoot it.

## Sleep, the dream and waking

- **The dream glyph is the sleep button.** It lies you down at a resting place
  once the day has done something; elsewhere, or mid-walk, its hover says why
  not. It opens no category.
- **The dream.** Asleep, the view relives the day: the camera follows a
  hollow ghost through every logged move, a beat per log row, the rows
  lighting in step, the clock and the sky passing overhead. Display only.
- **Waking** (the wake mark, or Space): the clock sweeps to midnight, the
  camera rides home to the bed with a motion-blur whoosh, and only then does
  `rest` dispatch — the day banks and the next begins — while the day you lived
  collapses into the horizon behind you. A fresh world opens with the same
  whoosh.

## Architecture

- `lib/hex.js` — pure hex/cube math + the two orientation matrices.
- `lib/world.js` — the fractal tile tree (spatial state only).
- `lib/globe.js` — the globe: the 72-board Goldberg polyhedron and `netFor`,
  which cuts it along its rivers by the angle and lays it flat. Pure geometry.
- `lib/sim.js` — **the game.** Pure and headless (runs in node): world, view
  stack, terrain, figures, energy, costs, discovery, skills, the action log,
  day snapshots, save and load. One `dispatch(action)` / `apply(action)` pair
  is the way state changes in play; the trusted reload re-applies the same
  `run`s. No canvas, DOM or timers here, ever.
- `lib/lore.js` — what the inner voice says (the sim keeps when).
- `lib/render.js` — draws sim state + presentation state, the menu, the dial,
  the sky and the night included. Pixels never decide sim outcomes.
- `lib/grid.js` — the screen/controller: the phases, pointer and keys →
  actions, timed-action waits, looking back, replay and restore, the save and
  the shelf.
- `lib/setup/angle.js` — the compass the `angle` phase hosts.
- `lib/clock.js` — the sun and moon: `sunState`/`moonState` are pure, the
  skill wheel's geometry, `hhmm`, and `drawDial`, the clock page's test dial.
  Shared with the clock harness so the two can't drift.
- `lib/draw.js` — shared canvas helpers (the `easeSplit` curve among them).
- `lib/icons.js` — the line-art glyph system, drawn into the caller's ink.
- `lib/identity.js` — who is playing, asked once: the pubkey kept, and the
  profile looked up live from a few public relays.
- `lib/app.js` — canvas/screen engine. `lib/main.js` — entry point: a save
  boots the game, no save boots the first phases.
- `lib/cube.js` — the PLAYGROUND (the title's helpers, from anywhere): tabs
  cube · icons · guide · clock · world · gpu map over the game canvas.
  `lib/cube3d.js` is its draggable 3D lattice, `lib/iconmaker.js` the icon
  editor. `lib/chrome.css` dresses it and the pages it frames as the game's
  chrome: the game face at 16px on the light paper, and only what you click
  boxed — every control a square label box with a 2px ink border, inverted
  when pointed at or open, its text faded when it's off; the rest plain text,
  held back by its strength. The anim lab wears the same at the small row
  (13px), in its own `bench.css`.
- Dev harnesses, each read STRAIGHT from the game's constants so they can't
  drift: `lib/guide.js` (guide.html, the field guide — the day, resources,
  moving and scouting, carry, craft, build, cooking, crossing water, skills),
  `lib/clockview.js` (clock.html, the test dial for the sun and moon math, on
  sliders), `lib/worldview.js` (world.html, the fully-revealed parent field).
- `lib/vendor/` — nostr-tools (pure, nip19, pool; nip44 vendored and not yet
  imported) and a sync sha256. `lib/stash/` — code kept and not wired in (the
  googly eye, the old stacked-clock timeline). `lib/radial.js` — the old stats
  card; nothing imports it.
- `lab/` — the animation lab, standing alone at `/lab/animate.html`
  (`animate.html` + `animations.js` registry + `bench.js` keyframe bench +
  `menu-scene.js`), `diagnose-stranded.mjs` (replays
  a save through the live `can` checks and flags where the reserve broke), and
  the icon pipelines (`icons/free`, `icons/lattice`).
- `tools/serve.mjs` — the dev server (`bun run dev`). `tools/build-napp.mjs` —
  `bun run napp` assembles a clean `napp/` folder: the game and the pages the
  playground frames (guide, clock, world, gpu map), with every module,
  stylesheet and font they reach.
- `test/` — the sim suite (`bun test`), pinned to INVARIANTS (never-strandable,
  replay == live, ratchets only grow, action validation) and, here and there,
  to rules stated as numbers.

### Invariants (tested)

1. Energy never goes negative; outside safe tiles the return reserve is always
   affordable.
2. Replay reproduces the live day exactly (same end state from snapshot+log).
3. `discovered` / `reachedEdges` only ever grow.
4. Invalid actions are rejected by the sim (not just hidden by the UI).
5. The sim runs headless.

## The menu

- **Clicking the player (or Space) opens it**, anywhere; it never opens
  itself. The MAP ITSELF ZOOMS IN around the tile you stand on — an even,
  unhurried camera move; opened off-centre, the map first glides you to the
  middle and the zoom picks up as that glide settles, scaling round your tile
  wherever it is on the way, so the two read as one move — until that
  tile's corners stand one view tile inside the drawn-in dial (on a
  figure's centre, a further two of the figure's shapes in); your tile
  stays sharp, the zoomed world around it blurred and dimmed, and you rise as
  a figure — the head lifted over a body. Clicking the tile again (or Space)
  closes it, and the map zooms back to its own zoom; its hover waits for the
  close to land. Every category keeps that zoom.
- **The map zooms.** Menu down, the wheel zooms it about the pointer — from
  the whole found world fitting the window in to one tile filling the dial —
  and a drag pans it, on a leash: the middle of the frame stays over found
  ground. The menu opens from whatever zoom the map is at and closes back to
  it. EVERYTHING ON THE MAP IS A SHARE OF ITS TILE — the ground's lines, the
  trails, the stacks and seats, camps, piles, the raft, the frontier dots, the
  angle line and the arrow, your token — while the dial, the ring, the fan,
  the labels and the chrome never zoom; the night is the same at every zoom.
  The hover label on a tile tells its price, its name and height, where it
  is, and what you ever gathered, hunted or built there.
- **The skills are the categories.** Opening, the dial draws in to about four
  fifths of its size — its minutes, the day, the sun and moon all riding it —
  and the twelve stand out round it, in wheel order at the angle the season
  has turned the wheel to, each one's shape touching the LIMIT from inside —
  the biggest circle round the dial that keeps the window's margin on every
  side, the bar's own depth (its margin and one box row), drawn as a thin
  dashed circle while the menu is up; closing, it grows back. A skill is shown
  only once met (below). Clicking
  one opens it — every skill but dream, which is the sleep button. The only
  other node today is `enter`, on the hex cells round the tile (from ring 2
  out, the leap cells first), icons only, its label riding the cursor. Behind
  the cells, one silhouette flush to the hexes.
- **Helpers** (playground / clear board / clear map / stock pantry / skill
  levels / frame times / reset) hang off the TITLE cell, not the ring. FRAME
  TIMES (stored) stands a readout top right: each part of a drawn frame (the
  map and, apart, its tile builds, the night veil, the menu's blur, the clock,
  the ring, the labels) in milliseconds of script, averaged over half a second, with the
  worst frame and the frame rate while frames run back to back. STOCK PANTRY (the
  logged `stockPantry` dev action, at a hearth only)
  puts a unit of every raw food and one fire's branch on your back, whatever it
  weighs, so the kitchen can be looked at without the foraging. The
  SKILL LEVEL rows put any skill at any level (the logged `setSkill` dev action,
  free like the clears): inside a category they are that skill's — +1, −1, 15,
  1 — and on the ring they move all twelve by one; they hold the list open, so
  a level is a few clicks.
- **THE MAP IS DRAWN ON THE GPU** (`lib/glmap.js`): the found world's ground
  as a handful of WebGL2 draws on a canvas of its own, every frame at the
  frame's camera and zoom, laid down as the world's first layer over the fog's
  coat — everything else the world draws (the trail, the stacks and seats, the
  raft, the night veil, the tokens) stays on the game's canvas over it, and
  the menu's blur and the whoosh take the ground with the rest. Every tile is an instance of one quad, one shader painting it from a
  few numbers, read off the same rules as everything else (`tileDressOf`,
  `contourScale`): its ground — ONE COLOUR A KIND, no height shading (the
  contours tell the height) — its kind's TEXTURE, its joined contours, home's
  rule, the light SHORE line along water that meets land, the fog eating its
  rim where it faces the unknown, its walls over the sun's shadow (the sun as
  it stands that frame), its regrow clock; then the streams and the fog's
  outward breath over all the tiles. The camera is two uniforms, so zoom and pan repaint nothing; the tiles go up as numbers
  only when the world changes (and the hour, while the regrow clocks show),
  each tile's standing facts read once per world. EVERY LINE IS A SHARE OF
  ITS TILE — the game's widths at its 1:1 tile (`baseTileSize`), scaling with
  the zoom from there; no pixel widths held, nothing fading in at a
  threshold, a line under a pixel wide drawn faint in proportion. ONE WATER:
  river, sea and streams wear the same blue. THE MOTIFS are the tile
  patterns of the Moorish south, simplified: each tile carries its OWN design,
  the same in every tile of its kind, drawn from its own middle right out to
  its edges — built on its corners and edge midpoints, or spaced to fit the
  grid's own steps exactly — so the lines one tile brings to its border are
  where its neighbour's begin, and a run of one kind reads as one continuous
  field. The library: rosette (the seed of life), bubbles (a circle round
  every corner), rings (circles on the edges' middles), star (through the
  corners), star lattice (through the edges' middles), ribbon (a band round
  alternate corners), meander (the band, each tile turning its own way),
  scales, waves (level, close), hexagon (on the edges' middles), snowflake
  (the star with a ring in its heart), fine lattice, diamonds, lines, fine
  lines, weave (wavy lines all three ways of the grid, crossing in the
  middle). The game wears the user's own picks (2026-10-27): water and river
  waves, beach hexagon, marsh rosette, plain weave, forest bubbles, mountain
  star lattice, cliff lines, peak star; home and the centres plain. Their
  lines are the tile's own colour darkened by 0.15. The playground's `gpu
  map` tab (`lab/glmap.html`) tries other picks and strengths on your world
  or a whole one, and remembers its own.
- **A tile is seven spots** — zoomed in the menu, it shows an inner hex and
  the six wedges between it and the rim. You stand on the wedge you stepped in
  through (a leap: the corner between two; a fresh day: the middle). The map
  and move costs don't see the wedges — it's where the shore, the stream and
  a building's footprint will live.
- **Every board centre is a special tile** — the resting place of its figure
  (all six interior radial lines, like home's centre). Figures rest there; the
  player stacks BELOW the figure so both show. You inspect a figure only while
  standing ON its centre, and there the menu zooms a little less, to clear the
  figure's shapes.
- **The place card.** The place's name stands bottom-right under what lies and
  grows there; pointing at it raises its card: on land the land's facts (the
  biome's whole yield set among them), in the water what you can do from it
  (the moves, the raft), and on a figure's centre the figure — its name, its
  npub, what its board mostly is and how much of it you've found.
- **Skills are met, then shown**: the ring holds only the skills you've
  practised once or been taught (`skillMet`), so the first open is just you
  and the tile. Travel is met with the first step, craft and build with the
  first thing you pick up, cook with the first food, dream (the sleep button)
  with the first exhaustion — their glyphs are where they're done. A newly met skill fades in on the next
  open, after the ring lands; from then on the sky draws its constellation too.
- **Inside a category**: the skill's name and level (`3.42`) go to the top
  LEFT, under your name, and under the title stands the skill's WORD icon
  (its main one where it has no word yet), as wide as the title — the way back
  to the ring. The glyph and its turning level shape go together to the
  top-right seat, larger, and clicking the glyph there is a way back too; the
  middle belongs to the category's own view and does nothing when clicked. A
  category's lists hang under the skill's label, flush with its left edge.
  Cook is THE KITCHEN; craft and build hang their TIMELINE round the clock;
  lore holds its JOURNAL; scout holds what you have FOUND: its lists stand top
  left — the heights found and how many tiles stand at each, the kinds and
  their counts (the world itself is the main map, zoomed out). A skill with
  nothing of its own yet opens empty. The
  clock stays for the cost previews. Escape closes the menu one layer at a
  time (the corner list → category → ring).

## UI conventions

- UI text is 16px, with weight/opacity for hierarchy; the exceptions in the
  code today are a 13px small row (`LABEL_FONT_SMALL`, the menu's refusal
  lines and the like), the 32px big boxes (the kitchen's seats) and the 48px
  timeline numbers.
- ONE LOOK: the light paper, no theme switch — `--surface` and `--text` are
  fixed on `:root`; the night's ink is the game's own, not a theme.
- CSS grid as the layout base; flex only for equal-distribution rows.
- "Status line" = the budget/time-left reading. There is no separate status
  line drawn today: the bar's time cell and the dial carry it.
- **Controls.** A click on the player or Space opens and closes the menu;
  asleep, Space wakes. Escape closes one layer at a time and, before there is a
  world, steps back through the phases. You can press and drag to aim a walk,
  and drag the map while one is under way.
- The bar reads `[title][name][angle°][day N][hh:mm][log head]`: the title
  drops the helpers ("reset" alone before the world — the playground waits for
  it); your NAME drops who you are — the face down the left and your npub; the
  ANGLE drops the shelf — every game you've started by its angle alone, ordered
  alphabetically, the one you're in lit, another switching you into it by
  reload — with NEW last (parks this one and reboots straight into the compass,
  the intent kept across the reload); the day cell drops the played days; the
  clock unrolls the log. One bar menu open at a time; each slides in from under
  the bar the same way. Replaying, the day cell gives way to the transport (see
  *The action log*). The saves: the live game under `hex:save`, every other
  game parked whole under `hex:save:game:<angle:worldKey>`; "reset" clears the
  shelf too, and forgets the key and its profile. Other keys:
  `:save:rejected` and `:save:before-restore` (see *The action log*),
  `:save:intent` (session only), `hex:identity`, `hex:icons`, and per-viewer
  comforts (kept menu seats, the free camera, closed timeline levels). EVERY
  KEY lives in `lib/keys.js` under the one neutral prefix `hex:` — never the
  game's title, which has changed before — and is never renamed; the old
  names (`anon&mato:…`, `anon_mato-…`, `thrive-…`) are carried over once per
  browser on load, the old copies left in place.
- The player cube is a plain hexagon outline + 3 inner radial lines — NOT a
  shaded/3D cube.

---

Everything **unbuilt** — the arc, the skills & tech vision, multi-POV days, the
idea box and what's parked — lives in [VISION.md](VISION.md).
