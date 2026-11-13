// The game, pure and headless.
//
// Everything anon & mato IS lives here: the world tree, energy, costs,
// discovery, the action log, day snapshots. No canvas, no DOM, no timers —
// this module runs in plain node (the tests do). Rendering and input live in
// render.js/grid.js and only ever call queries + dispatch.
//
// SPACE IS GLOBAL. Each depth level is one continuous lattice, and every tile
// on it — board land and river alike — keeps its state in ONE store per depth
// (the ground), keyed by its GLOBAL coordinate. Boards (one per parent hex) are
// ringed by rivers: the parent grid's edges and vertices as tiles of type
// `river`. The player, the entry and the trail live in global coordinates too;
// which board a tile falls in is a lookup, used for board-level things (the
// gate, clearing, biomes, the camera) and never as a frame. Crossing into
// another board is an ordinary step — nothing is translated, truncated or
// re-framed, ever.
//
// The action log is the design's centre of gravity: a day is a list of
// actions re-applied onto the day-start snapshot (the sim is deterministic).
// Live play and replay flow through the same dispatch/apply pair; the trusted
// reload (trustApply) re-applies the same runs without re-checking them.

import { DIRS, makeTile, childAt } from "./world.js"
import { netFor } from "./globe.js"
import * as Hex from "./hex.js"
import { sha256 } from "./vendor/sha256.js"
import { getPublicKey } from "./vendor/nostr-pure.js"

// ── tunables (the design is still settling — expect these to move) ──
export const RINGS = 4 // radius-4 hexagon = 61 tiles per board
export const SEED_ANGLE = 1 // the setup angle (dev fixture; later committed by the angle picker)
export const BASE_DEPTH = 1 // the parent lattice — one hex per board, the map view, gained later; depth 0 is the tile that holds it
export const MAX_DEPTH = 2 // the playing depth: the tiles inside the boards
export const SEED_MIN = 1 // day-one floor: one minute — the bare minimum to take a single action before anything is discovered
export const ENERGY_START = 60 // the home board's 60 discoverable tiles — the budget earned by clearing home (reference; the daily budget is dynamic)
export const FREE_CAP = 1440 // a full day (24h) — the dial's whole turn
// ── PLAYER ENERGY (RULES 42): the body's two base needs, on top of the budget ──
// You must SLEEP at least SLEEP_MIN a day: BED IS DUE WAKE_CAP after waking
// (RULES 52) — a due minute like the meal's, and the reserve prices every trip
// against the nearest of budget, meal and bed. Discovery itself is uncapped
// short of the full day: the budget runs to FREE_CAP, and so does what a meal
// can stretch a day to. What a day runs past WAKE_CAP is how late you may
// wake instead (wakeRange) — the dial's end pin stands at bed or the budget,
// whichever comes first.
export const SLEEP_MIN = 480 // 8h asleep, at least
export const WAKE_CAP = FREE_CAP - SLEEP_MIN // 16h — when bed is due, counted from waking
export const HUNGER_MAX = 180 // 3h from waking to the first meal — thereafter the food itself says how long
export const COST_BASE = 1 // the unit: the level base at the playing depth (MAX_DEPTH) — everything prices off 1
export const WEAR_FLOOR = 0.5 // a worn path bottoms out at half its terrain cost — never free
export const WEAR_STEP = 0.2 // each PRIOR traversal shaves this off the step multiplier, down to the floor
export const SCALE_RATIO = 6 // each level UP multiplies the base by this (1 inside a tile → 6 home interior → 36 outside)
export const MOVE_COST = 2 // moving onto a KNOWN tile costs this × the level base (one-way: 2 at the playing depth)
export const SCOUT_COST = 1 // SCOUT costs this × base — discovering is cheap; walking there is the commitment
export const LEAP = true // the leapfrog power move: jump the DIAGONAL — the tile beyond the edge
// two adjacent neighbours share — for ONE step's price (the landing tile's).
// BACK ON, DRY-FOOTED (2026-08-31, RULES 38) after a month off (RULES 30): a
// leap over a river is FORDING it, and a river must refuse that — so the
// move returns on BOARDS ONLY. No water anywhere in it — footing, flankers or
// landing (leapNeighbors) — which keeps every crossing bridge/raft business;
// fording as an EARNED ability stays open — see DESIGN.md, *Rivers*.
export const SCHEMA = 3 // save format version — the shape of the serialized object (3: world.worldKey)
export const RULES = 76 // replay-rules version (76: THE RAFT IS SLOW — every raft step, water to water, costs RAFT_STEP (2)× on top of depth and current, so a still river costs what flat ground does to walk and only the current beats it. A log that sailed replays to a different budget, so none of them replay; 75: DEEP WATER TAKES A WADER AND FLOATS THE RAFT — any board water, at any depth, is waded into from a bank and left only the way you came or over a bridge, as the shallows were, and the raft is raised on it and crosses it; each point of depth doubles a step on water (DEPTH_STEP), where it was the height base the travel skill eased. AND RIVERS RUN TO THE SEA — a raft step from one river tile to the next costs CURRENT_WITH (half) down the current and CURRENT_AGAINST (double) up it, the current running along the river to the nearest tile that touches the sea. A log that sailed a river or stood in water deeper than the shallows replays to a different budget, so none of them replay; 74: CRAFT LEVELS FASTER — a craft fills an edge every 5 crafts, where it took 20. A log that crafted replays to a higher craft and everything it unlocks; 73: THE RAFT IS A BUILD — making it trains build like any build and is written down as the first build, where it trained nothing and was a first of its own. A log that rafted replays to a higher build and a different lore, so none of them replay; 72: COOKING TAKES FROM THE GROUND — the pot and the fire's fuel come off the tile you stand on first, then off your back, as a craft's needs do, and the meals land on your back while they fit and still leave the way home, at your feet when they don't. A log that cooked on a pile, or cooked onto a full pack, replays to a different pack and pile; AND THE CLEARS COUNT AS ONE SCOUT — clear board and clear map scout the cheapest tile you could scout from where you stand first, priced, trained and written down as any scout is, and the rest comes free, where it all came free and wrote nothing. A log that cleared a board or the map replays to a shorter day and a higher scout and lore; 71: A FIGURE IS MET ONCE FOUND — the `figure` first waits until the figure's own tile is discovered, and is written after any action that leaves you beside one, a scout of it from beside included, where it was written on any step beside its tile, found or not. A log that stepped beside an unfound figure replays to that first later, so none of them replay; 70: A FIRST IS A VERB — the kinds are no longer firsts of their own (`gather:berries`, `craft:axe` and the rest): only the first time you do each verb, and the moments, are written down and train lore. Every log that took, made, ate, cooked, built, learned or taught more than one kind replays to a lower lore, so none of them replay; 69: THE FIRST EXHAUSTION — the first action that leaves no minutes left (timeLeft at zero) is a first of its own, `exhaustion`, and trains lore like any other. Every log that ran a day down replays to a higher lore, so none of them replay; 68: EVERY NIGHT TRAINS DREAM — each sleep is a practice of dream, six to an edge (PRACTICE_PER), so a week of nights fills one. Every log that slept replays to a higher dream, so none of them replay; 67: A FIRST TRAINS LORE — the first time you do a thing (a verb, a kind of thing, a moment) is written down in `noted`, and each one counts toward lore as one practice does toward its skill. Every log replays to a higher lore, so none of them replay; 66: WHAT A CRAFT MAKES LANDS AT YOUR FEET WHEN IT WON'T FIT — each unit made goes on your back while it fits and still leaves the way home at that load, and onto the tile you stand on when it doesn't, so a craft is never refused for room; its needs come off the ground first with no exceptions (64's swap of your own units for the ground's is gone). A log that crafted onto a full pack from a pile replays to a different pack and pile; 65: THE LAND RUNS ROUND THE GLOBE — a board's height blends with the board across each of its sides, and over a torn river that is now the globe's real neighbour, weighed as if it lay in the empty cell beyond, where the blend used to stop at the rim and leave the board's own base raw. Every rim board's land is a different one, so no old log replays; 64:A CRAFT WORKS WHAT LIES AT YOUR FEET — a recipe's needs come off the ground underfoot first and then off your back, as the raft's and the bridge's bills already did (the tool an upgrade replaces is still the one you hold). What it makes lands on your back, so a craft fed from the ground must fit the pack and prices the way home at the heavier load — and where it wouldn't, your own units go in place of the ground's, so the ground only ever helps. A log that crafted while standing on a pile of its own materials replays to a different pack and pile; 63: TWELVE IS KEPT — below MASTERY (12) a skill is a pool that edges move out of: a lesson now takes its edge FROM the teacher, who drains and can fall below their nature until taught back up, and teaching still costs you yours. At 12 or above nothing drains — a master teaches without losing, and so do you. Every log that learned from a figure below 12 replays against a teacher who ran lower, and every log that taught from 12 or above replays to a fuller shape, so none of them replay; 62: THE MASTERS SIT ON THE PENTAGONS — the twelve one-skill masters are dealt over the twelve pentagon boards instead of twelve boards drawn from all of them, so every log that learned from a figure replays against a different teacher; 61: THE STONE HEADS — the spear point is gone: a shard knaps into a cutter, a PIERCER or a CRUSHER (craft 2), and a head on a branch with a cord is a tool (craft 3) — the cutter an axe, the piercer a spear, the crusher the new HAMMER, which nothing takes yet. Every log that made a spear point replays to a refused craft, so none of them replay; 60: BRANCHES, AND THE LEVELS CLIMB IN STEPS — the forest floor yields `branches`, picked up by hand. The fire burns them (FUEL: a branch lasts FUEL_COOKS cooks, where a wood lasted ten), they are the tools' hafts — the axe, the snare and the spear take a branch where they took a small or a big stick, and both sticks are gone — the raft takes branches instead of wood, and the felled wall's kit leaves branches where it left wood. The recipes' levels climb: 1 turns raw matter into material (cord, shards), 2 works one material into a thing (cutter, spear point, rope, basket, net), 3 puts parts together (axe, snare, spear), 6 is the fine tier. Every log that cooked, crafted or rafted replays to a different pack, so none of them replay; 59: A SPOT TIRES AS YOU WORK IT — everything you GATHER (forage, wood, rock, metal) trades its regrow clock for a COUNT per tile and resource: your gather level is how many gathers a spot gives before it goes bare, then it is bare a day and every further gather doubles that (2, 4, 8… days, by the calendar), and each full day it sits back and untouched undoes one gather. Hunts keep their clocks. Plants no longer come back within the day, and rock and metal come back in one where they took half a year and a year, so a log that went back to a spot sooner than its count allows no longer replays; 58: THE WORLD IS THE KEY AND THE ANGLE — one world key, worldKeyFor(pubkey, angle), derives everything: the continents came from the pubkey alone (the same land at every angle) and the world key was rolled at random (the same angle never the same world twice). The board bases now come from the world key, and the pubkey no longer inscribes anything, so every world's land is a different one and no old log replays; 57: A WOOD BURNS FOR TEN COOKS — the fire takes COOK_WOOD off your back only when the last wood's WOOD_COOKS cooks are spent (`fuel`, log-derived and snapshotted, carried across days and hearths), where every cook used to burn one. Every log that cooked twice replays to a heavier pack, so no such log replays; 56: MATERIALS ARE WORKED BEFORE THEY ARE USED — a rock is a lump: broken, it is three SHARDS (`makes`: a recipe can yield more than one), a shard knapped to an edge is the CUTTER, a tool you hold, and knapped to a tip the SPEAR POINT. Wood is shaped with a tool on your back (`with`, held and not spent): a SMALL STICK with the cutter, two with the axe (`makes` by the tool held), a BIG STICK with the axe. The tools are made of the worked parts — the axe a cutter hafted on a small stick with cord, the snare a small stick and cord, the spear a point on a big stick with cord — and the fine tiers refuse without an edge held. Roots and oysters are forage that asks for the cutter itself, dug and prised rather than picked. Every log that made an axe, a snare or a spear replays to a different pack, so none of them replay; 55: CORD IS THE FIRST THING YOU MAKE — plants twist into `cord` (craft 1) and cord into `rope` (craft 2, nothing takes it yet), and every recipe that bound anything now asks for cord: the net and the basket are cord alone, the snare, axe and spear take one each, and the fine tiers with them. AND DEBRIS IS GONE — the one material with rules of its own, that no biome grew and that had to be HAULED to the water and left lying there, is no longer an item. The raft and the bridge are ordinary bills paid off your back (RAFT_NEEDS, BRIDGE_NEEDS), the bridge costs BRIDGE_MIN minutes like any other work, and a felled wall leaves a starting kit instead of a load: WALL_DROP, some of every material, enough to make your first things and no more. AND A TILE HOLDS MANY KINDS — the one-kind-per-cell pile is a map of kind → units, so a `take` names which kind it lifts (a bare one, as every older log wrote, takes the first the cell holds). Every log that crafted, rafted, bridged or cleared a board replays to a different pack, so none of them replay; 54: THE POT — a cook takes a POT (`pot`: raw kind → units) instead of one `item`: as many different ingredients as your cook level, up to COOK_SERVINGS of each over the skewers, and COOK_WOOD wood burnt with every cook. A meal takes one of each kind, so more of a thing makes more meals; a meal of several kinds is a DISH, a kind named by its own recipe, and the right mix is a COMBO worth more and keeping longer. The minutes are in the variety (COOK_KIND_MIN a further kind, COOK_SERVING_MIN a further serving). Every logged cook named an `item` and burnt nothing, so no log that cooked replays; 53: A TORN RIVER KEEPS ONE BANK — a river whose two boards lie apart on the flat map has its tiles on the bank nearer home (dealt first on a tie) and none on the other, whose border faces the void like a wall; no river is doubled any more, so the rim's water and every scout of it replay differently; 52: THE DAY IS THE WHOLE DAY — discovery is no longer capped at the waking window: the budget runs to FREE_CAP (24h), and so does what a meal can stretch a day to. Sleep stops being a ceiling and becomes a marker like the meal: BED IS DUE WAKE_CAP (16h) after waking, its own pin on the dial, and every affordability check prices against the nearest of budget, meal and bed. A mapped world wakes on 1440, not 960, and eats into a taller window, so old logs replay to different budgets; 51: THE WORLD IS A GLOBE LAID FLAT — seventy-two boards close into a sphere (60 hexagons and the 12 pentagons a hex grid must pay to close), cut along its rivers by the angle and laid on the parent lattice: an irregular rim instead of the radius-4 hexagon, home's pentagon across the gate, and a pentagon board is a hex board with one wedge lifted out — 51 tiles, five rivers, a bite of void you walk round. Every board edge has its river, the rim's included: a torn river's tiles exist on each bank as dead-end water, nothing beyond. The world's shape is a different one, so no old log replays; 50: A BITE IS A MINUTE — EAT_MIN goes 2 → 1, the baseline sitting for every raw food and every cooked kind alike: taking something off your back and eating it is a moment, not an errand, and at two minutes a 3-minute herb bought almost nothing. It is a FLOOR, not a flat price — a rich recipe may name a longer sitting of its own later. Every logged eat replays to a different budget and pushes the meal clock from a different minute; 49: THE DOOR OPENS UNDER YOUR FEET — a gated board no longer opens the instant its last tile is found. It opens when the board is CLEAR *and* you are STANDING ON THE DOORSTEP, the gate's own tile: knowing the way out and taking it are two different things, and the second one costs the walk across the board. Every old log that cleared a board from anywhere but the door replays with that gate still shut and the first step out through it refused, so no log that ever left home replays; the wall's debris lands on a different minute too, which moves every haul that followed it; 48: COOKED FOOD HAS A NAME — the one generic `meal` is gone and every food cooks into a KIND OF ITS OWN (`cooked fish`, `cooked berries`), worth COOK_MULT× its raw and wearing the raw's own face in capitals, so a 45-minute cooked hare and a 12-minute cooked kelp can finally be told apart in the pack. A meal's worth and its keeping are the kind's now, not the instance's, and it KEEPS TWICE ITS RAW'S SHELF and never under MEAL_SHELF_MIN (48h), so every old log that cooked replays to a differently named meal on a different spoilage clock; 47: A MEAL IS WORTH ITS OWN TIME — eating no longer RESTARTS the meal clock at a flat HUNGER_MAX; it PUSHES it on by the food's own nourishment (raw, never the ration-clipped eatBoost — a clipped push would strand you hungry with food on your back). Waking still sets the clock HUNGER_MAX out, so a foodless day is three hours as before, but a 3-minute herb now buys three minutes where it used to buy three hours, and a cooked hare buys forty-five. Every logged eat replays to a different meal clock, so any day that ate runs to a different length and no old log replays; 46: YOU START AT ONE — every skill of the PLAYER'S begins at level 1, whatever the key says, and THE CRUDE TIER COMES DOWN TO 1 WITH IT: a recipe's level is its own, not a rule about its tier, so bare hands can weave a basket or lash an axe on day one and only the fine tier still asks for 6. Nature is how gifted you are towards a skill, not what you are handed: it no longer pre-fills the edges of your first levels (baseLevel is gone, and with it the half-of-nature start), so every gate, cost, lesson and reserve prices against a lower start and no old log replays. The figures are untouched — they still sit AT their nature; 45: REST AND RESUME IS GONE — a day ends at a resting place (home or a camp) and the next starts there; the day-ender that woke you where you stood is scrapped, so any log that used it no longer replays; 44: ONE OF A KIND — you carry one tool of a kind: a fine tier is an UPGRADE that consumes the crude one (it sits in the recipe's needs), and crafting a second tool of a kind you already carry is refused, so a log that crafted a fine tool outright, or stacked two nets, no longer replays; 43: FORAGE & HUNT — every biome yields a SET (fruit, roots, berries, nuts, oysters, crabs, kelp and herbs join plants and eggs), a tile is a node for each of them on its own draw, and the regrow clock is per tile AND resource; fish, hare and eel are HUNTED with a tool of the kind on your back (net, snare, spear — the `hunt` action, which trains hunt); TOOLS NO LONGER WEAR — the axe's `uses` is gone and tools come in tiers by craft level, the fine tier lighter and quicker (`speed`); `gather` names its item (a bare one takes the first forage the tile has ready). Any old log that gathered replays to a different pack, a netted fish was a gather and is a hunt, and an axe that broke no longer does; 42: PLAYER ENERGY — the body joins the clock. SLEEP: at least SLEEP_MIN (8h) a day, so the waking window caps at WAKE_CAP (16h) instead of midnight — the budget and a meal's stretch both stop there. HUNGER: no more than HUNGER_MAX (3h) between meals — every affordability check prices against the lesser of the budget and the minutes until the next meal is due (timeLeft), so the reserve lands you at a rest spot before you'd go hungry; eating restarts the clock (and is reserve-guarded now, never refused for a small bite), and so does waking. A long day without food ends at three hours, so any old log that ran past that replays to a shorter day, and a fully-mapped world's day is 960, not 1440; 41: AN EDGE COSTS AN HOUR — a lesson's base goes 6 → 60 minutes (LESSON_COST; the +2/level drag stands, so level 15 is 90), and teaching, priced at the same base, goes with it. Every logged learn or teach replays to a different budget, and the reserve refuses lessons it used to allow; 40: THE WHEEL IS A COMPASS — heal and dream swap seats in STAT_NAMES so every skill faces its opposite across the wheel (scout↔dream, travel↔lore, gather↔heal). The order is not cosmetic: statsOf slices the 64 nibbles BY INDEX, so every key — the player's and every figure's — reads a different heal and dream than it used to, and the twelve master boards are dealt in the same order, so the board that mastered one now masters the other. Any log that learned or taught either skill replays against a different teacher; 39: YOU ARE THE MAKER — crafting stops being a commission bought from a biome-native figure and becomes a verb you perform ANYWHERE, home included: your own `craft` level against the recipe's, your own minutes, and it TRAINS craft like every other verb, so a log that walked to a specialist replays to a different pack and different skills. A recipe MAY still name a `site` biome it needs underfoot, but no crude one does — hand-work isn't pinned to terrain, and later making moves onto structures anyway; AND NOBODY STARTS AT ZERO — baseLevel floors at 1, so every skill exists for you from day one and old logs replay against different gates and costs; AND THE FIGURES' BAND — an NPC's nature is clamped to NPC_MIN..NPC_MAX (2..12), the place bonus lifts only to PLACE_CAP (11) so home ground alone never makes a master and they now sit AT it rather than half of it, so the learning ceiling moves 7 → 12 and every old lesson replays against a different teacher; twelve boards per world are drawn from the world key as guaranteed MASTERS, one per skill, so no world is a dead end in anything; and teaching now carries a figure ABOVE their nature to SKILL_CAP, which it never could before; AND A BOARD CENTRE IS NEVER WATER — isShallow was the one place that didn't exempt the centre, so a centre whose derived biome came up water (31% of them; 78% of games had at least one, some worlds nearly all 60) became a JETTY: navWater made stepsFrom refuse every exit but the way you came, and canMove priced the arrival with the wade-out reserve instead of landBack, so the figure standing there read as unreachable from any distance while every tile around them routed fine. Routes through and onto those centres now exist, so any old log near one replays differently; AND A CAMP NEEDS ONLY LAND — build's "real land underfoot" check read gatherResAt, which silently demanded a forage NODE as well, so camps that were impossible on ordinary ground now go up and the reserve eases earlier; 38: THE LEAP RETURNS, DRY-FOOTED — the diagonal power move is back on over dry land only (no water as footing, flanker or landing, so a river still can't be forded), and known-ground routes, reach and the reserve all shorten, so an old log's moves replay to different budgets; AND THE RAFT TAKES TIME — building it charges RAFT_MIN (30m, reserve-guarded; it was instant), so a log that rafted out replays to a shorter day; 37: FOOD IS TIME — eat (2m) turns a food's nourishment into extra waking minutes today (+60/day cap, midnight ceiling), cook (10m, at a hearth = any resting place) triples it into a meal; both consume dated instances, so any log that carried food replays to different budgets; 36: FISHING TAKES TACKLE — water yields fish only to a NET on your back, so a log that fished bare-handed no longer replays; 35: THE SHALLOWS ARE WATER YOU CAN STAND IN — board water at elevation 0 reads exactly like a river now (wade in from a bank, leave only that way or by bridge, build a boat there) and a raft crosses it, so reach, routes and the reserve all move; 33: THE HAUL — the felled wall leaves a pile of DEBRIS on the doorstep, and raft/bridge are paid for in loads of it dropped on the water (they were free), so an old log's crossing no longer replays; 32: SCOUTING PRICED IN STEPS — 1× home and its river ring, 2× the first shore, 3× beyond, so old days replay with different budgets (31 was a gentler ramp); 30: RIVERS — every seam is water: no river→river step, and leaving one is only back the way you came or over a BRIDGE, so old routes replay differently; 29: DROPS PERSIST — every tile is a storage cell keyed by GLOBAL coord, so an old save's home-local stash keys would read as the wrong tiles; 28: metal nodes 0.09→0.3 — the node layout shifts, so old gathers replay differently; and RULES 27's shape-is-the-level ladder) — bump on ANY change that alters what an old
// log replays to (costs, movement, gating); mismatched saves reset in dev

// ── practice: learning by DOING ────────────────────────
// Every action of a kind counts toward the skill it exercises (a step trains
// travel, a scout trains scout). PRACTICE_BASE actions fill one EDGE of the
// skill's shape (fractions carry), the same edges a lesson fills — and a
// level L takes L edges, so the early levels come quick and the last take an
// age.
export const PRACTICE_BASE = 20
export const PRACTICE_SKILL = { move: "travel", scout: "scout", gather: "gather", hunt: "hunt", craft: "craft", build: "build", cook: "cook", first: "lore", sleep: "dream" } // action kind → the skill it trains (`first`: every first time — see `noted`; `sleep`: every night).
// …and the kinds that take fewer than PRACTICE_BASE to an edge: a night's sleep
// is once a day where a scout is many, so dream fills an edge a WEEK of nights
export const PRACTICE_PER = { sleep: 6, craft: 5 } // …and a craft is slow work where a scout is quick: craft fills an edge every 5
// Moves only count on NOVEL ground — the first wear of a tile (RULES 26): exploration
// teaches; the commute doesn't. Scout/gather/build are inherently fresh work.

// ── elevation pricing ──────────────────────────────────
// Height works the legs EXPONENTIALLY: sea level (4) walks at 1×, each point
// above multiplies a step by the elevation base — the raw peak (15) is a
// ~27× wall you cannot simply stroll up. Trained legs flatten the curve:
// TRAVEL (the doing-grown skill) eases the base toward ELEV_STEP_FIT at 15,
// where the same peak costs ~2.9×. Beef up first, then climb.
export const ELEV_STEP = 1.35 // per elevation point above 4, untrained
export const ELEV_STEP_FIT = 1.1 // per point at travel 15
// …and depth works the other way: each point below the water's own 0 doubles a
// step on it. A raft's pole reaches the bottom of the shallows; past them
// you're paddling by hand. Training doesn't ease it — a better boat will.
export const DEPTH_STEP = 2
// THE RAFT IS SLOW: every step it takes, water to water, costs RAFT_STEP×,
// so it is a predictable road and never a comfortable one — a better boat is
// the way past it.
export const RAFT_STEP = 2
// RIVERS RUN TO THE SEA: a raft step from one river tile to the next costs
// CURRENT_WITH of its price down the current, CURRENT_AGAINST up it.
export const CURRENT_WITH = 0.5
export const CURRENT_AGAINST = 2

const key = Hex.key
const eq = Hex.equals

// ── tile types ───────────────────────────────────────
// Every hex can carry a stored type (sparse: the ground's types[globalKey] —
// ONE map per depth); absent = the derived terrain on a board, `river` between
// boards. A type's properties are cost MULTIPLIERS on the level base — the
// hook for pricing tile kinds (terrain, specials) differently. A river step
// costs 1 minute.
export const TILE_TYPES = {
  plain: { move: 1, scout: 1 },
  river: { move: 0.5, scout: 1 }, // step onto a river tile = 1 at depth 2
  // the derived biomes, PRICED (2026-07-06 — multipliers capped at 2×:
  // variance reads as flavour at 2×, as punishment beyond). Water takes a
  // wader from its bank at any depth, and its depth prices every step on it
  // (DEPTH_STEP).
  water: { move: 1, scout: 1 },
  beach: { move: 1, scout: 1 }, // easy ground, the water's edge
  marsh: { move: 2, scout: 1 }, // fertile but slow
  forest: { move: 1.5, scout: 1 }, // the timber belt
  mountain: { move: 2, scout: 2 }, // slow, hard to survey
  cliff: { move: 2, scout: 2 }, // the sheer faces
  peak: { move: 2, scout: 2 } // the deep grind (metal, later)
}

// ── terrain tunables (graduated from world.html 2026-07-06) ─────────
export const DETAIL = 0.4 // how hard the per-board subkeys tweak the base field
export const WATER_LEVEL = 4 // water below this, on the smoothed field
export const TARN_FLOOR = 9 // highland basins hold water only above this neighbourhood
export const TARN_DEPTH = 3 // …when carved at least this far below it
export const CLIFF_DROP = 5 // a mountain over a drop this sharp is a cliff
export const PEAK_NIBBLE = 15 // a peak is the subkey's own f on mountain ground

// Centre-out ring spiral: ring k starts at the "up" tile (0,−k) and walks
// clockwise — consecutive nibbles are (near-)adjacent tiles, so the key
// reads as a spiral inscription outward from home.
const SPIRAL_STEP = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]]
export function spiralOrder(R = RINGS) {
  const out = [[0, 0]]
  for (let k = 1; k <= R; k++) {
    let q = 0
    let r = -k
    for (const [dq, dr] of SPIRAL_STEP) {
      for (let j = 0; j < k; j++) {
        out.push([q, r])
        q += dq
        r += dr
      }
    }
  }
  return out
}

// Reading order: rows top to bottom, left to right within a row (pointy-top:
// a row = constant r, left-to-right = ascending q) — the key reads like text.
export function readingOrder(R = RINGS) {
  const out = []
  for (let r = -R; r <= R; r++) {
    for (let q = Math.max(-R, -r - R); q <= Math.min(R, R - r); q++) out.push([q, r])
  }
  return out
}

// ── stats (any key → how good its bearer is at things) ──────────────
// One rule reads EVERY key the same way — the player's npub and each NPC's
// derived pubkey alike: 64 nibbles → 12 skills, each the rounded average of
// its contiguous 5–6-nibble slice (0..15).
// TWELVE skills — the 8 place-skills (biome-bound) plus 4 with no home land
// (hunt, cook, heal, dream). The 12 skills ARE the
// year's 12 CONSTELLATIONS: each 30-day month one rides the sky and its skill is
// IN SEASON. Order = the wheel's order; index = the month it rules.
// WHEEL ORDER — clockwise from the top (matches the skill wheel + the 12
// constellations). The pillars are contiguous ARCS, 4 each: TIME straddles the top
// (farm·trade·scout·travel), SPACE the right (gather·craft·hunt·cook), MIND the left
// (dream·lore·heal·build). scout sits at 12 o'clock. See DESIGN, *Skills*.
// EVERY SKILL FACES ITS OPPOSITE (2026-09-01, RULES 40): heal and dream swapped
// seats — same pillar, same arc, different order — so the six diameters each read
// as a pair. scout ↔ dream: the open eye against the closed one, waking against
// sleeping. travel ↔ lore: covering ground against knowing it. gather ↔ heal:
// taking from the world against mending. craft ↔ build, hunt ↔ farm, cook ↔ trade
// already sat right. The wheel is a compass now, not just an order.
export const STAT_NAMES = ["scout", "travel", "gather", "craft", "hunt", "cook", "dream", "lore", "heal", "build", "farm", "trade"]
export const SKY_SKILLS = STAT_NAMES // economy and sky are one and the same now
export const YEAR_DAYS = 360
export const MONTH_DAYS = 30 // 12 months × 30 = 360
export const SEASON_BOOST = 2 // the in-season skill's natural lift (display-only for now)

export function statsOf(hex64) {
  const out = {}
  const n = STAT_NAMES.length
  // partition the 64 nibbles into n contiguous groups (5–6 wide at n=12), each
  // skill the rounded average of its slice — covers the whole key, any n
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * 64) / n)
    const b = Math.floor(((i + 1) * 64) / n)
    let s = 0
    for (let j = a; j < b; j++) s += parseInt(hex64[j], 16)
    out[STAT_NAMES[i]] = Math.round(s / (b - a))
  }
  return out
}

// ── skills: nature vs nurture (settled 2026-07-06) ──────────────────
// The PLAYER STARTS AT ONE IN EVERYTHING (2026-09-05) — level 1 is the single
// seed dot, and everybody's is the same size. Your key's nature says how GIFTED
// you are towards a skill, not what you are handed: levels are not given, they
// are climbed, so nature no longer pre-fills the edges of your first ones (it
// used to start you at half of it). You can reach the cap of 15 in anything.
// An NPC is a different animal: its nature IS where it sits (see npcProgress)
// and its ceiling. Learned progress is STATE, replayed from the log; nature
// stays pure.
export const SKILL_CAP = 15
export const PLAYER_START = 1 // …where every skill of yours begins, whatever the key says
// LEARNING BY EDGES (2026-07-16; resynced 2026-07-24, RULES 27): a skill at
// level L IS an L-sided shape — the number and the vertices can never disagree.
// Climbing L→L+1 fills the L edges of your OWN shape; when it closes, the next
// polygon (one more vertex) appears. The ladder still steepens with height
// (≈L²/2 edges to reach L). BOTH sources fill the SAME edges: a LESSON
// completes one whole edge, PRACTICE (doing the skill) trickles fractions,
// and fractions carry. The degenerate lows are the design: level 1 is the
// single seed dot — there's always one dot to grow from — and level 2 a
// two-dot line; levels 0 and 1 each need just one edge, so early lessons land.
export const edgesForLevel = L => Math.max(1, L) // edges to advance from level L to L+1
// edges filled → levels gained above `base`, plus the leftover into the current
// level. Pure + exported so every reader derives the same nurture.
export const levelsFromEdges = (edges, base) => {
  let lvl = 0
  let rem = edges
  while (base + lvl < SKILL_CAP && rem >= edgesForLevel(base + lvl)) {
    rem -= edgesForLevel(base + lvl)
    lvl++
  }
  return { levels: lvl, rem } // rem = edges into the current level (0 .. edgesForLevel)
}
// AN EDGE COSTS AN HOUR: a lesson is a real sitting, not an errand — the one
// action you plan a day around. Its TIME rises with the level you're at, a
// small steady drag on top of the hour.
export const LESSON_COST = 60 // base minutes for a lesson (at level 0)
export const LESSON_STEP = 2 // + minutes per current level (level 15 → 90)
export const lessonTime = level => LESSON_COST + LESSON_STEP * level

// Place is part of nature — for the STATIONARY. An NPC's home biome raises
// its innate (and therefore its cap) in that biome's skill: every skill has
// a home terrain, every terrain breeds its kind of expert. The player gets
// no place bonus — you move; your nature is your key alone.
export const BIOME_SKILL = {
  water: "travel", // they know the ways across
  beach: "trade", // harbours and meetings
  marsh: "farm", // the fertile work
  plain: "gather", // the open forage
  forest: "craft", // timber hands
  mountain: "build", // stone sense
  cliff: "scout", // the vantage
  peak: "lore" // the summit sages
}
// Reference copy for the skill info panel — clicking a skill glyph opens this.
// `home` = the land that favours it, `flavour` = its character, `effect` = what
// it does mechanically ("—" until its mechanic lands). Edit freely as skills
// gain rules.
export const SKILL_INFO = {
  travel: { home: "water", flavour: "they know the ways across", effect: "flattens the climb — high ground costs less" },
  gather: { home: "plain", flavour: "the open forage", effect: "a spot gives as many gathers as your level before it goes bare; eases the forage — half the minutes at 15" },
  build: { home: "mountain", flavour: "stone sense", effect: "gates the builds" },
  craft: { home: "forest", flavour: "timber hands", effect: "gates the recipes — the fine tools open at 6" },
  trade: { home: "beach", flavour: "harbours and meetings", effect: "—" },
  scout: { home: "cliff", flavour: "the vantage", effect: "cheapens scouting — toward half price at level 15" },
  farm: { home: "marsh", flavour: "the fertile work", effect: "—" },
  lore: { home: "peak", flavour: "the summit sages", effect: "the inner voice — every first time is written down, and trains it; the more lore, the more it says" },
  // the 4 celestial skills — no home biome (placeholder flavour, tuned later)
  hunt: { home: "—", flavour: "the patient chase", effect: "eases the hunt — half the minutes at 15" },
  cook: { home: "—", flavour: "the warm hearth", effect: "eases cooking — half the minutes at 15" },
  heal: { home: "—", flavour: "the mending hand", effect: "—" },
  dream: { home: "—", flavour: "the far sight", effect: "—" }
}
export const PLACE_BONUS = 3
// THE FIGURES' BAND (2026-09-01). A figure's nature is squeezed into
// NPC_MIN..NPC_MAX: nobody in the world is born useless, and nobody is born a
// master of everything. NPC_MAX is therefore the LEARNING ceiling — a figure
// sits AT their nature (they've done this all their life; climbing from one
// is the player's growth arc, not theirs), so the best teacher alive can carry
// you to 12. The last three levels to SKILL_CAP are yours to GRIND, by doing
// the verb — not something anyone can hand you.
// Why a band at all: `statsOf` averages 5–6 nibbles, so natures collapse
// toward 7.5 and the tails all but vanish (2 of 720 pairs hit 15 on a sampled
// world). Clamping keeps the shape but makes the top reachable.
export const NPC_MIN = 2
export const NPC_MAX = 12
// …and the PLACE BONUS stops one short of it (2026-09-01). Home ground still
// lifts a figure in its biome's skill, but never all the way to the band's
// top: reaching NPC_MAX takes real nature, or the master guarantee. Without
// this, +3 carried every place-skill figure of nature ≥9 to the ceiling and
// 41% of all the 12s in a world came from the bonus alone — a level-12 figure
// stopped being notable (56% of them were one). The bonus can only ever LIFT:
// a figure already at NPC_MAX by nature keeps it.
export const PLACE_CAP = NPC_MAX - 1
// TWELVE IS KEPT: at MASTERY or above a skill no longer drains — a master
// teaches without losing, and so do you. Below it a skill is a pool: a lesson
// moves its edge out of the teacher, a teaching out of you.
export const MASTERY = NPC_MAX

// What each biome offers — a SET (RULES 43): its forage, what a tool can hunt
// there, and its material — and the river between the boards, which holds
// fish. Whether a given tile is a node for each entry is the per-resource draw
// in isNode; the peak grows nothing — carry food up.
export const BIOME_YIELD = {
  water: ["kelp", "fish", "eel"],
  beach: ["oysters", "crabs", "fish"],
  marsh: ["roots", "eel"],
  plain: ["fruit", "plants", "hare"],
  forest: ["berries", "nuts", "hare", "wood", "branches"],
  mountain: ["herbs", "rock"],
  cliff: ["eggs"],
  peak: ["metal"],
  river: ["fish"]
}

// ── the gather / craft / build layer ─────────────────────────────────
// RESOURCES: what a take costs (minutes, before the tool's speed and the
// skill's ease), what a unit weighs on your back, a HUNT's REGROW clock (how
// many world-minutes — 1440/day, sleep included — until the node yields
// again; what you gather has no clock, it tires as you work it — see
// bareDays), and a SHELF life: the raw harvest spoils and is lost after this many world-
// minutes (omit = keeps forever). Food rots; stone and metal don't. You can't
// hoard a harvest — you carry it back and use it, or lose it.
// `food` is NOURISHMENT IN MINUTES (RULES 37): what eating one raw unit adds
// to today's waking window. Cooking multiplies it (COOK_MULT) into a meal.
// `kcal` and `protein` (grams) are a unit's NUTRITION — SIMULATED: no rule reads
// them yet. The kitchen sums them into its readout, and that is all they do
// until a health system is wired to them.
// `hunt` names the tool KIND a resource can't be had without — that makes it
// a HUNT (the hunt action, trains hunt); the rest is FORAGE, taken by hand
// (the gather action, trains gather). `with` is a forage's own tool: the KINDS
// (any one of them, on your back) it can't be taken without — roots are dug
// and oysters prised with a cutter — and it stays a gather. `tool` is a kind
// that merely EASES the take (the axe on wood). `tag` is the pack chip's face
// where the first letter is already taken by something else.
export const RESOURCES = {
  // FORAGE — every biome has some (BIOME_YIELD), each with its own subtlety
  plants: { weight: 1, min: 3, shelf: 4320, food: 6, kcal: 40, protein: 3 }, // plain: the greens
  fruit: { weight: 1, min: 4, shelf: 4320, food: 8, kcal: 90, protein: 1, tag: "fr" }, // plain: the staple
  roots: { weight: 1, min: 5, shelf: 7200, food: 7, kcal: 110, protein: 2, with: ["cutter"], tag: "ro" }, // marsh: slow to dig (with a cutter), keeps 5 days
  berries: { weight: 1, min: 2, shelf: 2880, food: 5, kcal: 50, protein: 1, tag: "be" }, // forest: quick, gone by the second night
  nuts: { weight: 1, min: 4, shelf: 43200, food: 7, kcal: 180, protein: 6, tag: "nu" }, // forest: the first food that KEEPS — trail food
  oysters: { weight: 1, min: 3, shelf: 1440, food: 8, kcal: 70, protein: 8, with: ["cutter"] }, // beach: prised off with a cutter — eat on the shore, or cook tonight
  crabs: { weight: 1, min: 5, shelf: 1440, food: 10, kcal: 90, protein: 16 }, // beach: the richer find
  kelp: { weight: 1, min: 2, shelf: 1440, food: 4, kcal: 30, protein: 2 }, // shallows: barely food — the wader's ration
  eggs: { weight: 1, min: 4, shelf: 5760, food: 9, kcal: 140, protein: 12 }, // cliff: 4 days
  herbs: { weight: 1, min: 4, shelf: 14400, food: 3, kcal: 10, protein: 1, tag: "he" }, // mountain: barely food; heal's ingredient later
  // HUNT — pays more, spoils in a day, and needs its tool
  fish: { weight: 2, min: 5, regrow: 1440, shelf: 1440, food: 12, kcal: 200, protein: 38, hunt: "net" }, // water, beach
  hare: { weight: 2, min: 6, regrow: 4320, shelf: 1440, food: 15, kcal: 320, protein: 50, hunt: "snare" }, // forest, plain
  eel: { weight: 2, min: 6, regrow: 2880, shelf: 1440, food: 14, kcal: 280, protein: 34, hunt: "spear", tag: "el" }, // marsh, water
  // MATERIALS — keep for good; an axe on your back eases wood
  wood: { weight: 3, min: 6, tool: "axe" },
  branches: { weight: 2, min: 2, tag: "br" }, // forest floor, by hand: the fire's fuel and the tools' hafts
  rock: { weight: 5, min: 8 },
  metal: { weight: 6, min: 10 },
  // (CORD and ROPE are MADE, not foraged, so they live in RECIPES with the rest
  //  of what your hands produce — their weight and face are written there.)
  // (COOKED FOOD lives here too — one kind per raw, generated from the table
  //  above the moment the cooking knobs are known. See MEAL_SHELF_MIN below.)
}
// FOOD IS TIME — the knobs. Eating spends EAT_MIN minutes and adds
// the food's nourishment to TODAY's waking window: at most EAT_CAP a day (the
// sacred baseline again — a second wind, not a second day), and never past
// the full day (FREE_CAP). It also pushes the meal clock on by that same
// nourishment, RAW and uncapped by the ration — the ration governs the day's
// window, never the body's clock (RULES 47).
// Cooking (at a hearth: any resting place) turns raw food into meals worth
// COOK_MULT× their nourishment. THE POT (RULES 54): a cook takes `pot` — raw
// kind → units — and
//   kinds     as many DIFFERENT ingredients as your cook level (1 → 15)
//   units     up to COOK_SERVINGS of any one of them: skewers over the fire are
//             all there is today, and a bigger vessel will lift this
//   fuel      a FUEL (branches) burns for FUEL_COOKS cooks: the fire takes
//             COOK_FUEL (off the ground at your feet, then your back) only when
//             the last one's cooks are spent
//             (`fuel`)
//   minutes   COOK_MIN for the first ingredient, COOK_KIND_MIN for each further
//             kind, COOK_SERVING_MIN for each further serving (eased by the cook
//             skill, half at 15) — the time is in the VARIETY, so cooking surplus
//             is nearly free and the question becomes how to keep it
// ONE MINUTE IS THE BASELINE SITTING (RULES 50): a bite is a moment, not an
// errand — raw or cooked, taking something off your back and eating it costs
// the same single minute. A FLOOR rather than a flat price: a richer recipe may
// ask for a longer sitting of its own once a recipe is more than one
// ingredient; this is what everything else eats at.
export const EAT_MIN = 1
export const EAT_CAP = 60
export const COOK_MIN = 10
export const COOK_KIND_MIN = 5
export const COOK_SERVING_MIN = 2
export const COOK_SERVINGS = 3
export const FUEL = "branches"
export const COOK_FUEL = 1
export const FUEL_COOKS = 2
export const COOK_MULT = 3
// COOKED FOOD HAS A NAME (RULES 48). A meal used to be ONE generic item carrying
// its worth per instance, so a 45-minute cooked hare and a 12-minute cooked kelp
// sat in the pack as the same grey chip — the whole point of cooking, invisible.
// Now the fire names what it made. One kind per raw food, generated from the raw
// and never hand-written:
//   worth   COOK_MULT× the raw's nourishment — on the KIND, so nothing has to
//           remember what an instance was cooked from
//   keeps   TWICE the raw's shelf, and never under MEAL_SHELF_MIN: the fire is
//           itself a preserving step, and it lifts every day-spoiler — fish,
//           hare, eel, kelp, oysters, crabs — to a clear two days.
//   weighs  1 — ≤ every raw food, so cooking never breaks the load-priced reserve
//   wears   the raw's own face in CAPITALS (`f` → `F`, `be` → `BE`)
// Nothing forages them (no BIOME_YIELD entry): the hearth is the only source.
export const MEAL_SHELF_MIN = 2880 // 48h — the floor under every meal
export const cookedOf = raw => `cooked ${raw}`
for (const raw of Object.keys(RESOURCES).filter(k => RESOURCES[k].food))
  RESOURCES[cookedOf(raw)] = {
    weight: 1,
    shelf: Math.max(MEAL_SHELF_MIN, RESOURCES[raw].shelf * 2),
    food: Math.round(RESOURCES[raw].food * COOK_MULT),
    kcal: RESOURCES[raw].kcal,
    protein: RESOURCES[raw].protein,
    tag: (RESOURCES[raw].tag ?? raw[0]).toUpperCase(), // (tagOf isn't declared yet — read the field itself)
    cooked: raw // what the fire was given — and the mark that says this one IS cooked
  }
// COMBOS: the mixes worth finding. A meal that holds EVERY kind a combo names
// (more besides is fine) is worth `time`× its minutes and keeps `keeps`× as
// long, and wears the combo's name and face. Where several fit, the one naming
// the most kinds wins, then the richer `time`.
export const COMBOS = [
  { name: "fruit salad", kinds: ["berries", "fruit"], time: 1.2, keeps: 1, tag: "FS" },
  { name: "trail mix", kinds: ["berries", "nuts"], time: 1.1, keeps: 2, tag: "TM" },
  { name: "omelette", kinds: ["eggs", "herbs"], time: 1.3, keeps: 1, tag: "OM" },
  { name: "herbed fish", kinds: ["fish", "herbs"], time: 1.25, keeps: 1, tag: "HF" },
  { name: "surf & turf", kinds: ["fish", "hare"], time: 1.3, keeps: 1, tag: "ST" },
  { name: "marsh pot", kinds: ["eel", "roots"], time: 1.25, keeps: 1.5, tag: "MP" },
  { name: "garden bowl", kinds: ["fruit", "nuts", "plants"], time: 1.3, keeps: 1, tag: "GB" },
  { name: "shore platter", kinds: ["crabs", "kelp", "oysters"], time: 1.4, keeps: 1, tag: "SH" },
  { name: "hunter's stew", kinds: ["hare", "herbs", "roots"], time: 1.5, keeps: 1.5, tag: "HS" }
]
export const comboOf = kinds => {
  let best = null
  for (const c of COMBOS) {
    if (!c.kinds.every(k => kinds.includes(k))) continue
    if (!best || c.kinds.length > best.kinds.length || (c.kinds.length === best.kinds.length && c.time > best.time)) best = c
  }
  return best
}
// A DISH — a meal of SEVERAL kinds — is a kind too, and its NAME IS ITS RECIPE:
// `cooked fish + herbs`, the raws in alphabetical order. Everything about it is
// read off that name and nothing else (RULES 48 holds: the worth is the kind's,
// an instance is still just a date), so a dish needs no table entry and no
// registering — dishDef works it out on first sight and remembers the answer:
//   worth   COOK_MULT× the summed nourishment, × its combo's `time`
//   keeps   as the SHORTEST-LIVED ingredient would cooked alone, × its combo's `keeps`
//   weighs  1, like every meal
//   wears   its combo's face — or, plain, its richest ingredient's capitals and
//           how many kinds went in (`F3`)
export const dishOf = kinds => (kinds.length === 1 ? cookedOf(kinds[0]) : `cooked ${[...kinds].sort().join(" + ")}`)
const DISHES = new Map()
export const dishDef = k => {
  if (DISHES.has(k)) return DISHES.get(k)
  let def = null
  const kinds = typeof k === "string" && k.startsWith("cooked ") ? k.slice(7).split(" + ") : []
  if (kinds.length > 1 && kinds.every(x => RESOURCES[x]?.food && !RESOURCES[x].cooked) && dishOf(kinds) === k && new Set(kinds).size === kinds.length) {
    const combo = comboOf(kinds)
    const sum = f => kinds.reduce((s, x) => s + RESOURCES[x][f], 0)
    const lead = kinds.reduce((a, b) => (RESOURCES[b].food > RESOURCES[a].food ? b : a))
    def = {
      weight: 1,
      shelf: Math.round(Math.max(MEAL_SHELF_MIN, Math.min(...kinds.map(x => RESOURCES[x].shelf)) * 2) * (combo?.keeps ?? 1)),
      food: Math.round(sum("food") * COOK_MULT * (combo?.time ?? 1)),
      kcal: sum("kcal"),
      protein: sum("protein"),
      tag: combo?.tag ?? RESOURCES[cookedOf(lead)].tag + kinds.length,
      cooked: kinds,
      combo: combo?.name ?? null
    }
  }
  DISHES.set(k, def)
  return def
}
// THE WATER'S TWO ANSWERS (DESIGN.md, *Rivers*): a raft is the cheap starter
// vehicle, a bridge the permanent, heavy work. Both are paid in ORDINARY
// MATERIALS off your back now — no special load to haul, no pile that has to be
// standing on the water first.
export const RAFT_NEEDS = { branches: 3, cord: 4 }
export const BRIDGE_NEEDS = { wood: 6, cord: 8 }
export const RAFT_MIN = 30 // minutes to lash the raft together (RULES 38)
export const BRIDGE_MIN = 90 // …and to span the water, a morning's work
// WHAT A FELLED WALL LEAVES on the doorstep: a starting kit, not a haul. Enough
// to make your first things and meet every material once; it does not last.
export const WALL_DROP = { cord: 8, branches: 4, rock: 2, metal: 1 }
// RECIPES: what CRAFT makes — a thing that is YOURS. It rides on your back,
// it can be spent or dropped, and what it changes is what YOU can do (carry
// more, cut faster, catch fish). That is the whole line against BUILDS below,
// which change what a PLACE is and stay there forever.
// You make it yourself: your own `craft` level against the recipe's `level`,
// your own minutes. (Until 2026-09-01 this was a commission you bought from a
// biome-native figure — see RULES 39.)
// YOU CAN MAKE IT ANYWHERE, unless the recipe says otherwise (2026-09-01).
// A recipe MAY declare a `site` — a biome that must be underfoot — and then it
// can only be made there (real land, so never home and never a board centre).
// Absent, which is every crude recipe today, means exactly what it says: any
// tile, home included. Weaving a basket by your own fire is not a thing the
// rules should forbid, and pinning hand-work to a biome only reads as arbitrary.
// `site` is here for the recipes that will earn it — a forge that wants the ore
// underfoot, a boatyard that wants a shore — and later most making moves onto
// STRUCTURES anyway (see VISION's kiln/larder/library), which is a better gate
// than terrain because you had to build it first.
// TOOLS COME IN TIERS AND DO NOT WEAR (RULES 43). A tool recipe names its KIND
// (`tool`) and its `speed` — the multiplier on the minutes of every take it
// serves; the best of a kind on your back is the one that counts (bestTool).
// The crude tier is heavy and slow, the fine tier (a higher craft level) light
// and quick: what you carry and how fast you work are the whole difference.
// ONE OF A KIND (RULES 44): the fine tier REPLACES the crude one — the crude
// tool is among the upgrade's needs and is consumed — and you carry one tool
// of a kind: crafting a second while you hold one is refused (craft.can).
// A recipe's `level` is ITS OWN, never a rule about the tier it belongs to. The
// levels climb in steps (RULES 60, 61): 1 turns raw matter into material (cord,
// shards), 2 works one material into a thing (the cutter, the piercer, the
// crusher, rope, the basket, the net), 3 puts parts together into the axe, the
// snare, the spear and the hammer, and 6 is the fine tier of the axe, the net,
// the snare and the spear.
// The axe is optional (wood comes by hand, slowly); net, snare and spear are
// required by what they hunt (RESOURCES[r].hunt).
// A TOOL YOU HOLD, NOT SPEND (RULES 56): `with` names the tool KINDS a recipe
// wants on your back — any one of them — and leaves them there. It is each
// recipe's own list: the fine tiers are worked with an edge, a cutter or the
// axe; what else a tool is good for, that recipe (or that forage) says.
// `makes` is how many a recipe yields: one unless it says, a number, or a map
// of held tool kind → yield when the tool decides it (the best held counts).
export const RECIPES = {
  // CORD FIRST. Plants twisted into something that holds — the cheapest thing
  // you can make and the one nearly everything else asks for, so a day's forage
  // turns into the stuff a day's making runs on. ROPE is cord doubled up: it
  // waits for the heavy work, and nothing takes it yet.
  cord: { needs: { plants: 2 }, min: 5, level: 1, weight: 1, tag: "cd" }, // "c" is the crab's
  rope: { needs: { cord: 3 }, min: 10, level: 2, weight: 2, tag: "rp" },
  basket: { needs: { cord: 3 }, min: 10, level: 2, weight: 1, carry: 4, keeps: 1.5 }, // raises carry AND keeps food fresher — the first storage tech
  // STONE (RULES 56, 61). A rock is a lump: break it and it is three SHARDS. A
  // shard knapped to an edge is the CUTTER — what digs roots and prises oysters,
  // and an edge the fine tiers are worked with; to a point, the PIERCER; to a
  // blunt face, the CRUSHER. Nothing asks for the piercer or the crusher on
  // their own yet.
  shard: { needs: { rock: 1 }, makes: 3, min: 2, level: 1, weight: 1, tag: "sh" }, // "s" is the snare's
  cutter: { needs: { shard: 1 }, min: 5, level: 2, weight: 1, tool: "cutter", speed: 1, tag: "cu" },
  piercer: { needs: { shard: 1 }, min: 5, level: 2, weight: 1, tag: "pi" }, // "p" is the plants'
  crusher: { needs: { shard: 1 }, min: 5, level: 2, weight: 1, tag: "cr" },
  // BRANCHES ARE THE HAFTS (RULES 60, 61): a stone head on a branch with a cord
  // is a tool — the cutter an axe, the piercer a spear, the crusher a hammer —
  // and the snare is a branch and cord.
  axe: { needs: { cutter: 1, branches: 1, cord: 1 }, min: 12, level: 3, weight: 2, tool: "axe", speed: 0.5 },
  "fine axe": { needs: { axe: 1, wood: 1, rock: 1, cord: 1 }, min: 20, level: 6, weight: 1, tool: "axe", speed: 0.35, tag: "A" },
  net: { needs: { cord: 2 }, min: 12, level: 2, weight: 2, tool: "net", speed: 1 }, // the tackle fish come out of the water to (RULES 36)
  "fine net": { needs: { net: 1, cord: 2, wood: 1 }, with: ["cutter", "axe"], min: 20, level: 6, weight: 1, tool: "net", speed: 0.6, tag: "N" },
  snare: { needs: { cord: 1, branches: 1 }, min: 10, level: 3, weight: 2, tool: "snare", speed: 1 },
  "fine snare": { needs: { snare: 1, cord: 1, wood: 1 }, with: ["cutter", "axe"], min: 18, level: 6, weight: 1, tool: "snare", speed: 0.6, tag: "S" },
  spear: { needs: { piercer: 1, branches: 1, cord: 1 }, min: 10, level: 3, weight: 3, tool: "spear", speed: 1, tag: "sp" },
  "fine spear": { needs: { spear: 1, wood: 1, cord: 1 }, with: ["cutter", "axe"], min: 18, level: 6, weight: 2, tool: "spear", speed: 0.6, tag: "SP" },
  hammer: { needs: { crusher: 1, branches: 1, cord: 1 }, min: 10, level: 3, weight: 2, tool: "hammer", speed: 1, tag: "hm" } // nothing takes a hammer yet
}
// an item's short face — what the kitchen wears it by: its tag, else its initial
export const tagOf = k => RESOURCES[k]?.tag ?? RECIPES[k]?.tag ?? dishDef(k)?.tag ?? k[0]
// …and everything a kind IS, wherever it is written down: the tables, or a dish's own name
export const defOf = k => RESOURCES[k] || RECIPES[k] || dishDef(k) || null
// BUILDS: what BUILD makes — a thing that becomes THE PLACE. Raised on the
// tile you stand on out of materials off your back, it has no weight, it
// can't be carried or spent, it only ever accumulates, and it changes what
// anyone standing there can do. The mirror of RECIPES above: craft is yours
// and mobile, build is the world's and sited.
// The camp becomes a RESTING PLACE: the reserve anchors to it and you can
// sleep there.
export const BUILDS = {
  camp: { needs: { wood: 3, plants: 2 }, min: 30, level: 2 }
}
export const CARRY_BASE = 6 // hands and pockets — before skill and baskets
// A SPOT TIRES AS YOU WORK IT (RULES 59). What you GATHER keeps a count per
// tile and resource instead of a clock: your gather level is how many gathers
// a spot gives before it goes bare, then it is bare one day, and every further
// gather doubles that. Days by the calendar, so a bare day ends when you wake.
// Each full day a spot sits back and untouched undoes one gather: a spot you
// pace holds steady, one you strip every time it's back falls away fast.
// The days a spot stays bare after its `n`th gather on the count:
export const bareDays = (n, level) => (n < level ? 0 : 2 ** (n - level))
// forage-node rarity: the chance a matching biome tile is a NODE for its
// resource (deterministic per world+tile — see isNode). Plants are common
// forage; metal is a rare find. Combined with biome frequency, this makes
// some boards bare of a resource by design.
export const NODE_DENSITY = {
  plants: 0.55,
  fruit: 0.35,
  roots: 0.5,
  berries: 0.5,
  nuts: 0.25,
  oysters: 0.5,
  crabs: 0.3,
  kelp: 0.6,
  eggs: 0.35,
  herbs: 0.3,
  fish: 0.5,
  hare: 0.3,
  eel: 0.35,
  wood: 0.3,
  branches: 0.6,
  rock: 0.18,
  metal: 0.3
}
// (metal 0.09→0.3, 2026-07-24: peaks are already 1/16 of mountain ground — at 0.09 the
// whole world held ~8 metal nodes on 7 of 61 boards, functionally unfindable. At 0.3
// it is still the scarcest resource by far, but a determined climb can find it.)
// (the first six keep their salts, so the layouts of the original resources
// didn't move when the rest joined in RULES 43)
const RES_SALT = {
  plants: 1,
  fish: 2,
  eggs: 3,
  wood: 4,
  rock: 5,
  metal: 6,
  fruit: 7,
  roots: 8,
  berries: 9,
  nuts: 10,
  oysters: 11,
  crabs: 12,
  kelp: 13,
  herbs: 14,
  hare: 15,
  eel: 16,
  branches: 17
}

// Orientation alternates by depth; only the parity matters for topology.
export const orientOf = depth => (depth % 2 === 0 ? Hex.POINTY : Hex.FLAT)

// ── static topology (pure, shared by every level) ────
export const inBounds = (q, r) => Hex.length([q, r]) <= RINGS

// Sibling boards are pushed out one row: offsets are rotations of
// (2R+2, −(R+1)), which sit at the clean ±30/±90/±150° screen directions and
// leave EXACTLY one hex row between any two interiors — the river.
export const RIVER_RING = RINGS + 1 // a board's river ring (side rivers + corner confluences)
export const VIEW_RING = RINGS + 2 // …and the neighbours' facing rows just beyond
export const SUPER = (() => {
  const out = []
  let q = 2 * RINGS + 2
  let r = -(RINGS + 1)
  for (let i = 0; i < 6; i++) {
    out.push([q, r])
    const nq = -r
    const nr = q + r
    q = nq
    r = nr
  }
  return out
})()

// Which neighbouring board (0..5) owns hex h relative to a board at the
// origin — interiors only — or -1. (Board-relative helper for pure topology.)
export function superIndexOf(q, r) {
  for (let i = 0; i < 6; i++) {
    if (Hex.length([q - SUPER[i][0], r - SUPER[i][1]]) <= RINGS) return i
  }
  return -1
}

// The neighbour lobes an off-board hex sits at river distance from (a side
// river: one; a confluence or a neighbours' shared river: two). Board-relative.
export function riverLobesOf(h) {
  const out = []
  for (let i = 0; i < 6; i++) {
    if (Hex.distance(h, SUPER[i]) === RIVER_RING) out.push(i)
  }
  return out
}

// A river hex (relative to a board at the origin) belongs to no board and sits
// at river distance from ≥2 of the seven centres — parent edges and vertices.
export function isRiverHex(h) {
  if (Hex.length(h) > VIEW_RING) return false
  if (superIndexOf(h[0], h[1]) >= 0 || Hex.length(h) <= RINGS) return false
  const mine = Hex.length(h) === RIVER_RING ? 1 : 0
  return mine + riverLobesOf(h).length >= 2
}

// The gate EDGE: where the seed angle's ray exits the board's interior — the
// single side of the last interior tile (the doorstep) that the ray crosses
// into the river. Angle convention from the setup picker: 0° up, clockwise.
// Returns { k: doorstep hex key, side: DIR index, river: the river hex beyond }.
export function gateEdgeFor(angleDeg, parity = 0) {
  const o = orientOf(parity)
  const rad = (angleDeg * Math.PI) / 180
  const dx = Math.sin(rad)
  const dy = -Math.cos(rad) // canvas y grows downward
  const offRay = h => {
    const x = o.f[0] * h[0] + o.f[1] * h[1]
    const y = o.f[2] * h[0] + o.f[3] * h[1]
    return Math.abs(x * -dy + y * dx) // perpendicular distance to the ray
  }
  let door = [0, 0]
  for (let t = 0.5; t < RIVER_RING * 3; t += 0.05) {
    const h = Hex.round(o.b[0] * dx * t + o.b[1] * dy * t, o.b[2] * dx * t + o.b[3] * dy * t)
    if (Hex.length(h) <= RINGS) {
      door = h
      continue
    }
    if (Hex.length(h) !== RIVER_RING) break
    // grazed a corner and skipped the doorstep? re-anchor on the interior
    // neighbour of the river hex closest to the ray
    if (Hex.distance(door, h) !== 1) {
      door = Hex.neighbors(h)
        .filter(n => Hex.length(n) <= RINGS)
        .sort((a, b) => offRay(a) - offRay(b))[0]
    }
    const side = Hex.neighbors(door).findIndex(n => eq(n, h))
    return { k: key(door), side, river: h }
  }
  return { k: key([RINGS, 0]), side: 0, river: [RIVER_RING, 0] } // unreachable fallback
}

// Super index i → parent DIR index, per child-depth parity. The river obeys the
// parent grid, so the mapping matches each neighbour direction to the parent
// DIR at the same screen angle — exact matches at the pushed-out offsets.
export const SUPER_TO_PARENT_DIR = [0, 1].map(parity => {
  const child = orientOf(parity)
  const parent = orientOf(parity + 1)
  return SUPER.map(([sq, sr]) => {
    const sa = Hex.screenAngle(child, sq, sr)
    let best = 0
    let bd = Infinity
    for (let j = 0; j < 6; j++) {
      const pa = Hex.screenAngle(parent, DIRS[j].q, DIRS[j].r)
      const d = Math.abs(Math.atan2(Math.sin(sa - pa), Math.cos(sa - pa)))
      if (d < bd) {
        bd = d
        best = j
      }
    }
    return best
  })
})

// A pentagon board is a hex board with one 60° wedge lifted out, toward one
// neighbour direction: that edge's corner column and the side tiles after it,
// ring by ring (1+2+3+4 = 10 interior tiles) plus that edge's 5 river tiles.
// Its two cuts are one line on the globe; laid flat it is void you walk round.
// Keyed by SUPER index, board-local coords.
const flanksOf = u => {
  // the two corner directions either side of neighbour direction u
  const a = DIRS.findIndex((d, i) => {
    const e = DIRS[(i + 1) % 6]
    return RIVER_RING * (d.q + e.q) === u[0] && RIVER_RING * (d.r + e.r) === u[1]
  })
  return [DIRS[a], DIRS[(a + 1) % 6]]
}
export const BITE = SUPER.map(u => {
  const [da, db] = flanksOf(u)
  const out = new Set()
  for (let k = 1; k <= RIVER_RING; k++) {
    for (let j = 0; j < k; j++) out.add(key([k * da.q + j * (db.q - da.q), k * da.r + j * (db.r - da.r)]))
  }
  return out
})
export const BITE_TILES = RINGS * (RINGS + 1) / 2 // interior tiles a wedge takes: 10 of 61
// The river along one edge of a board: its 4 side tiles and the 2 confluence
// corners that end it (corners belong to both edges they join). Keyed by SUPER
// index, board-local coords.
export const EDGE_RIVER = SUPER.map(u => {
  const [da, db] = flanksOf(u)
  const out = new Set()
  for (let j = 0; j <= RIVER_RING; j++) out.add(key([RIVER_RING * da.q + j * (db.q - da.q), RIVER_RING * da.r + j * (db.r - da.r)]))
  return out
})

// The home's gate: a single EDGE of the doorstep tile, seeded by the angle.
// GATE_TILE is the river hex just beyond it; the parent-scale gate direction
// derives from that hex's lobe — used only by the locked base view's visuals.
export const GATE_EDGE = gateEdgeFor(SEED_ANGLE)
export const GATE_TILE = GATE_EDGE.river
export const GATE_DIR = SUPER_TO_PARENT_DIR[0][riverLobesOf(GATE_TILE)[0]]

// A full board's worth of hexes — discovering them all is what opens a gate.
export const BOARD_TILES = Hex.range(RINGS).length

// Interior border tiles that touch the river toward neighbour i (board-relative).
export const edgeTilesInto = i =>
  Hex.ring([0, 0], RINGS).filter(t =>
    Hex.neighbors(t).some(n => Hex.length(n) === RIVER_RING && isRiverHex(n) && riverLobesOf(n).includes(i))
  )

// Interior border tile at the centre of edge i — where entering from the
// parent lands you. Argmin of off-axis offset along the neighbour direction.
export const EDGE_CENTER = [0, 1].map(parity => {
  const o = orientOf(parity)
  return SUPER.map((s, i) => {
    const ang = Hex.screenAngle(o, s[0], s[1])
    const dirx = Math.cos(ang)
    const diry = Math.sin(ang)
    let best = null
    let bd = Infinity
    for (const t of edgeTilesInto(i)) {
      const x = o.f[0] * t[0] + o.f[1] * t[1]
      const y = o.f[2] * t[0] + o.f[3] * t[1]
      const perp = Math.abs(x * -diry + y * dirx)
      if (perp < bd) {
        bd = perp
        best = t
      }
    }
    return best
  })
})

// THE WORLD KEY IS THE KEY AND THE ANGLE: one seed for everything a world
// derives — its land, its texture, its people, its masters, its forage. The
// same key at the same angle is the same world again; another angle is a
// world as different as another key's.
export const worldKeyFor = (pubkey, angle) =>
  [...sha256(new TextEncoder().encode(`${pubkey}:${angle}`))].map(b => b.toString(16).padStart(2, "0")).join("")
const hex64Check = (v, name) => {
  if (v != null && !/^[0-9a-f]{64}$/.test(v)) throw new Error(name + " must be 64 lowercase hex chars")
}

// ── the sim instance ─────────────────────────────────
export function createSim({ angle = SEED_ANGLE, pubkey = null, worldKey = null } = {}) {
  // The world's one chosen input: the setup angle seeds where the gate falls
  // (and, later, everything social — hue, faction, season phase). Per
  // instance: every sim carries its own; the module-level GATE_* constants
  // remain the dev-default fixtures.
  const gateEdge = gateEdgeFor(angle)
  const gateDir = SUPER_TO_PARENT_DIR[0][riverLobesOf(gateEdge.river)[0]]

  // THE WORLD IS THE GLOBE LAID FLAT (RULES 51): seventy-two boards, cut along
  // their rivers by the angle and laid on the parent lattice, home at the
  // origin and its pentagon across the gate. A board's cell, its side count
  // and (for a pentagon) the parent DIR its wedge faces, all pure from the angle.
  const net = netFor(angle, gateDir)
  const boardInfo = c => net.boards.get(key(c))
  const biteOf = info => (info && info.gapDir != null ? BITE[SUPER_TO_PARENT_DIR[MAX_DEPTH % 2].indexOf(info.gapDir)] : null)
  // the river tiles a board has, board-local: every edge that carries a river
  // on the map (a torn river keeps one bank — see globe.js). Memoised per board.
  const riverCache = new Map()
  const riversOf = info => {
    let set = riverCache.get(info)
    if (!set) {
      set = new Set()
      SUPER.forEach((_, i) => {
        if ((info.rivers >> SUPER_TO_PARENT_DIR[MAX_DEPTH % 2][i]) & 1) for (const k2 of EDGE_RIVER[i]) set.add(k2)
      })
      riverCache.set(info, set)
    }
    return set
  }
  const tilesOf = c => (boardInfo(c)?.sides === 5 ? BOARD_TILES - BITE_TILES : BOARD_TILES) // what clearing a board takes

  // Identities: the PUBKEY is who you are — your nature, and what binds the
  // save. The WORLD KEY (worldKeyFor: the key and the angle) derives the whole
  // world. Both lazy and pure — nothing stored, replay-safe.
  hex64Check(pubkey, "pubkey")
  hex64Check(worldKey, "worldKey")
  const homeOutside = makeTile()
  const homeInside = childAt(homeOutside, "0,0")

  // THE GROUND — every tile's state, ONE store per depth, keyed by the tile's
  // GLOBAL coord on that depth's lattice: whether it's discovered, the walls on
  // its sides (6 bits), how worn in it is, and any stored type. Board land and
  // river file alike; no board is asked where a tile's state lives.
  const grounds = []
  const groundAt = d => grounds[d] || (grounds[d] = { discovered: new Set(), walls: {}, worn: {}, types: {} })
  groundAt(BASE_DEPTH).discovered.add("0,0") // the home (base) centre starts known; the rest is fog
  groundAt(0).discovered.add("0,0") // …and the home tile itself is known at the parent scale (we live in it)

  let energy = SEED_MIN // shared across levels; spent going out, refills only by resting home
  let fed = 0 // minutes EATEN into today's window (RULES 37) — the budget reads dayStart + fed, so the clock only ever runs forward
  let wakeAt = 0 // the minute of the day you woke: 00:00 until the day outgrows WAKE_CAP, then as late as the slack allows (see wakeRange)
  let mealAt = HUNGER_MAX // the minute of the day the next meal is DUE — waking sets it HUNGER_MAX out, and every bite pushes it on by its own nourishment

  // Discovery FEEDS the day: every interior tile you uncover — HOME INCLUDED —
  // ADDS a minute to the NEXT day's budget (the seed minute bootstraps day one,
  // so the very first tile you find already pays). Clearing the home board (its
  // 60 non-centre tiles) lifts you from the seed to 61; past the gate each
  // outside tile carries the budget onward toward the full day (FREE_CAP).
  // Derived from the discovery ratchets (never snapshotted, so replay-safe):
  // the board tiles found on the boards' lattice — rivers and centres earn
  // nothing.
  const tilesFound = () => {
    let n = 0
    for (const k of groundAt(MAX_DEPTH).discovered) {
      const geo = boardGeo(Hex.fromKey(k), MAX_DEPTH)
      if (geo && geo !== "river" && (geo.local[0] || geo.local[1])) n++
    }
    return n
  }
  const dailyBudget = () => Math.min(FREE_CAP, SEED_MIN + tilesFound())
  let learned = {} // skill → xp, grown by LESSON actions — nurture; replays from the log like everything else
  let given = {} // skill → EDGES taught away: teaching drains the shape a lesson fills (log-derived)
  let practiced = {} // action kind → count (a step, a scout…) — practice levels derive from it (log-derived)
  let taught = {} // npc board key → { skill → NET edges in }: +1 per edge you teach them, −1 per lesson they give below MASTERY (log-derived)
  let inventory = {} // resource/item → count on your back (log-derived, never serialized)
  let gatheredAt = {} // spot (tile|resource) → world-minute of its last take (a hunt's regrow clock; log-derived)
  let worked = {} // spot (tile|resource) → { n, day }: the gathers on its count and the day of the last (RULES 59; log-derived)
  let stash = {} // GLOBAL tile key → { [item]: [{at}] } — every tile is a storage cell, and holds as MANY KINDS as you put there (log-derived)
  let fuel = 0 // cooks left on the fuel already on the fire (RULES 57) — log-derived, snapshotted with the day
  // THE INNER VOICE (lore): the FIRST time you do a thing is written down — a
  // verb, or a moment (the open gate, another board, a figure). First id →
  // { day, at (the minute of the day), lore (your lore as it was written) }, in
  // the order they happened; each one trains lore as one practice trains its
  // skill (PRACTICE_SKILL.first). Log-derived, snapshotted with the day.
  let noted = {}
  let day = 1 // current day/expedition; energy spent = minutes since waking (00:00)
  let log = [] // this day's actions in order (replay re-applies them); banked + reset on sleep
  let logMeta = [] // per-entry minutes charged, index-aligned with log — display-only, derived, never saved
  const history = [] // past days: { day, actions, start } (for future day-navigation)
  let todayDiscovered = [] // {d, key} first discovered TODAY (depth + global key) — replay re-fogs these (display-only)
  let todayReached = [] // {tile, i} edges first reached TODAY — same journal for the edge ratchet
  let todayWorn = [] // {d, key} tile traversals TODAY — rewound for the display replay
  let replayWorn = [] // …and the replay's own re-walk of them, undone at endReplay before the lived journal is put back
  let replaying = false // suppresses logging + day-boundary side effects while a replay re-applies
  let loadingTrust = false // true only during a trusted progressive reload (see hydrateProgressive)
  let dayStart = null // snapshot of where/how this day began (set at init and on every sleep)
  let dayGhost = null // the PREVIOUS day's full walked trail, kept so it can be shown as a faint ghost to retrace

  // Levels. Below the top everything is bookkeeping: `player` on a lower
  // level is the parent hex the level above lives in, `trail` its committed
  // parent-scale path (the reserve prices its legs). On the TOP level player /
  // entry / trail are GLOBAL lattice coordinates.
  const frame = (tile, hexKey, o) => ({
    tile, // the current/last board's world node (top) or this level's node
    key: hexKey, // hex key inside the parent tile (null for the root)
    isBase: false,
    entry: [0, 0],
    player: [0, 0],
    trail: [[0, 0]],
    cost: 0,
    ...o
  })

  const stack = [
    frame(homeOutside, null, { cost: COST_BASE * SCALE_RATIO ** MAX_DEPTH }),
    frame(homeInside, "0,0", { isBase: true, cost: COST_BASE * SCALE_RATIO ** (MAX_DEPTH - 1) })
  ]

  const view = () => stack[stack.length - 1]
  const depth = () => stack.length - 1
  const parity = () => depth() % 2
  const parentOf = () => stack[depth() - 1]
  const ground = () => groundAt(depth())

  // ── the global lattice ──────────────────────────────
  // Basis: parent hex c sits at global basis(c) = c.q·b0 + c.r·b1.
  const basisOf = (d = depth()) => {
    const tbl = SUPER_TO_PARENT_DIR[d % 2]
    return { b0: SUPER[tbl.indexOf(0)], b1: SUPER[tbl.indexOf(5)] }
  }
  const boardCentre = (c, d = depth()) => {
    const { b0, b1 } = basisOf(d)
    return [c[0] * b0[0] + c[1] * b1[0], c[0] * b0[1] + c[1] * b1[1]]
  }

  // Which board a global hex falls in — or that it's river — is PURE lattice
  // math per depth: memoised forever (the node lookup stays live below, since
  // children appear lazily). This is the hottest call in the sim — every wall
  // check, type lookup and neighbour walk lands here.
  const geoCache = new Map() // "depth:q,r" → { c, centre, local } | "river" | null
  function boardGeo(g, d = depth()) {
    const ck = d + ":" + key(g)
    const hit = geoCache.get(ck)
    if (hit !== undefined) return hit
    const { b0, b1 } = basisOf(d)
    const det = b0[0] * b1[1] - b1[0] * b0[1]
    const pf = [(g[0] * b1[1] - g[1] * b1[0]) / det, (g[1] * b0[0] - g[0] * b0[1]) / det]
    const pc = Hex.round(pf[0], pf[1])
    let out = null
    let banks = 0
    for (const c of [pc, ...Hex.neighbors(pc)]) {
      const info = boardInfo(c)
      if (!info) continue // boards exist only over the net
      const centre = boardCentre(c, d)
      const dist = Hex.distance(g, centre)
      if (dist > RIVER_RING) continue
      const local = [g[0] - centre[0], g[1] - centre[1]]
      const bite = biteOf(info)
      if (bite && bite.has(key(local))) continue // a pentagon's wedge: void, nobody's
      if (dist <= RINGS) {
        out = { c, centre, local }
        break
      }
      if (riversOf(info).has(key(local))) banks++ // on an edge of this board that carries its river
    }
    // a river tile is any board's: one bank is enough, and a torn river has only one
    if (!out && banks >= 1) out = "river"
    geoCache.set(ck, out)
    return out
  }

  // The board global hex g falls in: { c: parent hex, centre, local, node? } or null.
  function boardOf(g) {
    const geo = boardGeo(g)
    if (!geo || geo === "river") return null
    return { c: geo.c, centre: geo.centre, local: geo.local, node: parentOf().tile.children[key(geo.c)] }
  }

  // Is g a tile of the map at all? ANY global coordinate — unbounded, no
  // frames, no rings.
  function onMap(g) {
    if (depth() <= BASE_DEPTH) return depth() === BASE_DEPTH ? !!boardInfo(g) : Hex.length(g) <= RINGS
    return !!boardGeo(g)
  }

  const boardHexOf = g => boardOf(g)?.c ?? null
  const boardCentreOf = g => boardOf(g)?.centre ?? null

  // The tiles found on board c (its centre included).
  const foundOn = c => {
    const centre = boardCentre(c)
    let n = 0
    for (const l of Hex.range(RINGS)) {
      const g = [centre[0] + l[0], centre[1] + l[1]]
      const b = boardOf(g)
      if (b && eq(b.c, c) && isDiscovered(g)) n++
    }
    return n
  }

  // ── discovery journals (the ratchet never shrinks; the journal is what
  //    replay may re-fog, display-only) ────────────────
  function journalDiscover(k, d = depth()) {
    const found = groundAt(d).discovered
    if (found.has(k)) return
    if (!todayDiscovered.some(e => e.d === d && e.key === k)) todayDiscovered.push({ d, key: k })
    found.add(k)
    worldStamp++
    openGateIfDue() // …the last tile might be the one that lets you out — if you are standing on the door
  }
  // A GATED BOARD OPENS UNDER YOUR FEET (RULES 49). Clearing it is no longer
  // enough on its own: the board must be fully discovered AND YOU MUST BE
  // STANDING ON THE DOORSTEP — the gate's own tile. Knowing the way out and
  // taking it are two different things, and the second one costs the walk over
  // there. It asks about the board you are ON, not the one just discovered, so
  // the two callers are the two ways the pair of facts can come true: you scout
  // the last tile while standing on the door, or you walk to the door with the
  // board already clear. A ratchet either way, like discovery itself — the gate
  // edge's wall bit clears for good.
  function openGateIfDue() {
    const b = boardOf(view().player)
    const tile = b && b.node
    if (!tile || !tile.gate || tile.gateOpen) return
    if (key(view().player) !== tile.gate.k) return
    if (foundOn(b.c) < tilesOf(b.c)) return
    tile.gateOpen = true
    note("gate", true)
    ground().walls[tile.gate.k] &= ~(1 << tile.gate.side)
    fellWall(tile.gate)
    worldStamp++ // the wall is the movement graph — and fellWall bumps nothing if a pile already lies there
  }
  // …AND THE WALL LEAVES A STARTING KIT: WALL_DROP, piled on the doorstep tile
  // it fell from — an ordinary stash cell from there on, taken like anything
  // else lying on the ground. It holds a raft's cord and branches.
  //
  // The pile is WORLD state, not log state, so it's planted in the day's START
  // snapshot too: a display rewind restores dayStart and re-applies the log, and
  // without this, scrubbing the day the wall fell would sweep the kit away
  // for good (the wall itself doesn't un-fall on a rewind either).
  function fellWall(gate) {
    const sk = gate.k
    if (stash[sk]) return // something already lies there — never overwrite a tile's own pile
    const now = worldMin()
    stash[sk] = Object.fromEntries(Object.entries(WALL_DROP).map(([k, n]) => [k, Array.from({ length: n }, () => ({ at: now }))]))
    if (dayStart && dayStart.stash)
      dayStart.stash[sk] = Object.fromEntries(Object.entries(stash[sk]).map(([k, arr]) => [k, arr.map(i => ({ ...i }))]))
    worldStamp++
  }
  function journalReach(tile, i) {
    if (tile.reachedEdges.has(i)) return
    if (!todayReached.some(r => r.tile === tile && r.i === i)) todayReached.push({ tile, i })
    tile.reachedEdges.add(i)
  }
  // Walking a tile WEARS IT IN — a per-tile traversal count that cheapens it
  // next time (see wearFactor). A ratchet like the others. The display replay
  // rewinds today's wear and re-walks the day, so the re-walk must wear too —
  // a tile crossed twice in a day is cheaper the second time, live and
  // replayed alike; its increments go to replayWorn, undone at endReplay
  // before the lived journal is put back.
  function journalWorn(k) {
    const worn = ground().worn
    worn[k] = (worn[k] || 0) + 1
    ;(replaying ? replayWorn : todayWorn).push({ d: depth(), key: k })
    worldStamp++ // wear cheapens the tile — the reserve/route caches must re-price it
  }

  // ── discovery lookups (global) ──────────────────────
  const isDiscovered = g => ground().discovered.has(key(g))

  // ── walls (per hex side, any hex) ───────────────────
  // THE WORLD'S WALL: the map ends where no tile exists, and every existing tile
  // (rivers included) WALLS its void-facing sides — so the whole map wears an
  // enclosure exactly like the home board's. Purely visual by construction:
  // steps and leaps into the void were never possible (onMap gates every
  // neighbour walk), so no replay changes. The world is static → cached per tile,
  // since wallBits rides the reach map's hot path.
  const edgeWalls = new Map()
  const edgeWallBits = g => {
    const k = key(g)
    let bits = edgeWalls.get(k)
    if (bits === undefined) {
      bits = 0
      for (let d = 0; d < 6; d++) {
        if (!onMap([g[0] + DIRS[d].q, g[1] + DIRS[d].r])) bits |= 1 << d
      }
      edgeWalls.set(k, bits)
    }
    return bits
  }
  function wallBits(g) {
    if (depth() <= BASE_DEPTH || !onMap(g)) return 0
    return (ground().walls[key(g)] || 0) | edgeWallBits(g)
  }

  // A wall on EITHER side of an edge blocks the step across it.
  const stepBlocked = (a, b, d) => ((wallBits(a) >> d) & 1) === 1 || ((wallBits(b) >> ((d + 3) % 6)) & 1) === 1

  // Neighbours the player can actually step between — global, wall-aware.
  // What you can SEE from a tile: wall-filtered adjacency, passability
  // irrelevant — you scout the sea from the shore, you just can't stand on it.
  function sightNeighbors(g) {
    const out = []
    for (let d = 0; d < 6; d++) {
      const n = [g[0] + DIRS[d].q, g[1] + DIRS[d].r]
      if (!onMap(n)) continue
      if (stepBlocked(g, n, d)) continue
      out.push(n)
    }
    return out
  }

  // A board CENTRE is not land (see landAt): it neither carries the derived
  // biome's multipliers nor its impassability — the board's own tile is
  // always plainly enterable, at base price.
  const isCentre = g => {
    const b = boardOf(g)
    return !!b && b.local[0] === 0 && b.local[1] === 0
  }
  // What you can STEP between: everything you can see. No ground refuses a
  // step — water takes a wader from its bank at any depth (RULES 75); what you
  // may do from inside it is stepsFrom's business.
  const walkNeighbors = sightNeighbors

  // ── RIVERS (RULES 30, 2026-08-03) ────────────────────────────────
  // THE ROW BETWEEN BOARDS IS RIVER. You can wade in from any shore, but the
  // water is not a road and not a crossing:
  //   • land → river   — always (it's just a step off the bank)
  //   • river → river  — NEVER. The river is not a path; each of its tiles
  //                      hangs off the land beside it, like a jetty.
  //   • river → land   — only back the way you came, or over a BRIDGE.
  // So reaching the next river tile means going back to land and stepping in
  // again, and reaching the far bank means building something. See DESIGN.md,
  // *Rivers*, for why. `stepsFrom` is the whole rule: every consumer of the movement graph
  // — routing, the reserve, retrace validation — goes through it.
  // A river is a tile TYPE: a map tile whose type reads `river`.
  // (memoised: the routing and reserve sweeps ask this of every tile they pop,
  // and the type walks the board geometry to answer. Position → water is fixed
  // for the life of the sim, so it's cached once per tile.)
  const riverMemo = new Map()
  const isRiver = g => {
    const k2 = key(g)
    let r = riverMemo.get(k2)
    if (r === undefined) riverMemo.set(k2, (r = onMap(g) && typeNameAt(g) === "river"))
    return r
  }
  // a bridge is an unordered PAIR of tiles: the river tile it stands in and
  // the land tile it lands on. Log-derived, like every other bit of state.
  let bridges = new Set()
  const bridgeKey = (a, b) => [key(a), key(b)].sort().join("|")
  const hasBridge = (a, b) => bridges.has(bridgeKey(a, b))
  // THE RAFT — the first vehicle, and the first real thing you spend timber and
  // cord on. It LIVES ON THE WATER: moored at one river tile, and it
  // only moves when you're on it. Board it by stepping onto its tile from a
  // bank; aboard, the river stops being a dead end — you can navigate tile to
  // tile and land on ANY shore. Step onto land and the raft stays where you
  // left it, which is the whole game of owning one: knowing where it is.
  let raft = null // the water tile it's moored at, or null (log-derived)
  let raftShore = null // the land you last stepped off it onto — the bank it lies against (null aboard, or never left)
  let centred = false // you've stood on a board centre beyond home — it meets trade (log-derived)
  const aboard = () => !!raft && eq(raft, view().player)
  // NAVIGABLE WATER (RULES 75): every river tile and all the water on a board,
  // at any depth. A raft draws nothing, so the whole of it is road — the depth
  // only makes it slow (DEPTH_STEP).
  //
  // AND ON FOOT IT IS ALL ONE KIND: you can wade into any of it and stand there,
  // and from it the only ways out are the bank you came in by and a bridge.
  // That is what makes water a PLACE and not just an obstacle — you stand in it
  // to see across it, to fish it, and to BUILD on it, which is where the raft
  // comes from.
  // A BOARD CENTRE IS NEVER WATER: its derived biome can come up water like any
  // tile's, but it is the board's own tile, and every rule reads it as plain
  // ground (stepCostAt, scoutCostAt and landAt exempt it too).
  // (Memoised beside isRiver: the routing sweeps ask it of every tile they
  // touch, and terrain is fixed for the life of the sim.)
  const boardWaterMemo = new Map()
  const isBoardWater = g => {
    const k2 = key(g)
    let r = boardWaterMemo.get(k2)
    if (r === undefined) boardWaterMemo.set(k2, (r = !isCentre(g) && !isRiver(g) && typeNameAt(g) === "water"))
    return r
  }
  const navWater = g => isRiver(g) || isBoardWater(g)
  // THE CURRENT (RULES 75): RIVERS RUN TO THE SEA. A river tile's FLOW is how
  // many river tiles lie between it and the nearest one touching the sea
  // (board water below the waterline), counted along the river, and the
  // current runs down that count. Where a river touches the sea it has no
  // current, and neither has the sea; a river that never reaches it stands
  // still. Worked out one river system at a time, the first time any tile of
  // it is asked.
  const flowMemo = new Map()
  const isSea = g => isBoardWater(g) && smoothedAt(g) < WATER_LEVEL
  function flowAt(g) {
    if (!isRiver(g)) return null
    const k0 = key(g)
    if (flowMemo.has(k0)) return flowMemo.get(k0)
    const sys = [g] // every river tile this one joins
    const seen = new Set([k0])
    for (let i = 0; i < sys.length; i++)
      for (const n of sightNeighbors(sys[i]))
        if (isRiver(n) && !seen.has(key(n))) {
          seen.add(key(n))
          sys.push(n)
        }
    const dist = new Map() // …counted out from its mouths, a ring at a time
    let ring = sys.filter(t => Hex.neighbors(t).some(isSea))
    for (const t of ring) dist.set(key(t), 0)
    for (let d = 1; ring.length; d++) {
      const next = []
      for (const t of ring)
        for (const n of sightNeighbors(t))
          if (isRiver(n) && !dist.has(key(n))) {
            dist.set(key(n), d)
            next.push(n)
          }
      ring = next
    }
    for (const t of sys) flowMemo.set(key(t), dist.get(key(t)) ?? Infinity)
    return flowMemo.get(k0)
  }
  // what the raft does to a step from a to b: only a raft steps from water to
  // water, and every such step costs RAFT_STEP×; from one river tile to the
  // next it rides or fights the current as well
  const raftFactor = (a, b) => {
    if (!a || !navWater(a) || !navWater(b)) return 1
    if (!isRiver(a) || !isRiver(b)) return RAFT_STEP
    const fa = flowAt(a)
    const fb = flowAt(b)
    if (fa === fb || fa === Infinity || fb === Infinity) return RAFT_STEP
    return RAFT_STEP * (fb < fa ? CURRENT_WITH : CURRENT_AGAINST)
  }
  // Everywhere a plain step can land from `g`, given the tile you arrived
  // from. Only leaving the water is restricted, so land is unchanged.
  function stepsFrom(g, from) {
    if (raft && eq(raft, g)) return walkNeighbors(g) // aboard: navigate the water, land anywhere
    const ns = walkNeighbors(g)
    if (!navWater(g)) return ns
    // ON FOOT, IN THE WATER — river or board water alike: it is a jetty, not a
    // path. Back to the bank you waded in from, or over a bridge, and that is
    // all. (Which is what makes standing there worth something: you can look
    // across, and you can BUILD — the raft is raised from the water you're in.)
    return ns.filter(n => !navWater(n) && ((from && eq(n, from)) || hasBridge(g, n)))
  }

  // Leap targets: the six DIAGONALS (g + DIRS[i] + DIRS[i+1]) — the tile that
  // sits directly beyond the edge shared by two adjacent neighbours. The leap
  // rides that edge like a road: out through the vertex between the two
  // flankers, along their shared edge, in through the far vertex. Legal when
  // both flanking tiles are discovered walkable ground and no wall touches
  // the corridor (the two edges at each vertex, and the ridden edge itself —
  // so a gate still funnels single-file steps, never leaps). The flankers are
  // jumped OVER — never stood on, never charged; the leap prices as ONE step
  // onto the landing, so routing prefers it wherever the ground is known.
  // Chains naturally: each leap is one edge of the move graph.
  // BOARDS ONLY (RULES 38): the whole move rides DRY land — footing, both
  // flankers and the landing. A river flanker is exactly the ford RULES 30
  // refuses, board water is water too, and water footing belongs to the
  // jetty/raft rules (stepsFrom) — a leap must never bypass them.
  function leapNeighbors(g) {
    if (!LEAP) return []
    if (navWater(g)) return [] // no leaping out of the water
    const out = []
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6
      const A = [g[0] + DIRS[i].q, g[1] + DIRS[i].r]
      const B = [g[0] + DIRS[j].q, g[1] + DIRS[j].r]
      if (!onMap(A) || !onMap(B)) continue
      if (!isDiscovered(A) || !isDiscovered(B)) continue // you leap over KNOWN ground
      const t = [g[0] + DIRS[i].q + DIRS[j].q, g[1] + DIRS[i].r + DIRS[j].r]
      if (!onMap(t)) continue
      if (stepBlocked(g, A, i) || stepBlocked(g, B, j)) continue // walls pinch the exit vertex
      if (stepBlocked(A, B, (i + 2) % 6)) continue // a wall along the ridden edge
      if (stepBlocked(A, t, j) || stepBlocked(B, t, i)) continue // walls pinch the entry vertex
      // no leaping over (or onto) water — straits are for rafts and bridges
      if (navWater(A) || navWater(B) || navWater(t)) continue
      out.push(t)
    }
    return out
  }

  // Everywhere one MOVE action can land from g: plain steps + leaps. This is
  // the movement graph — routing, the reserve and retrace validation all
  // derive from it, so the power move flows through every affordability check.
  // `from` is the tile you arrived on g from; it only matters in the water
  // (see stepsFrom), where the way out is the way you came in.
  const moveNeighbors = (g, from) => [...stepsFrom(g, from), ...leapNeighbors(g)]

  // Frontier = the player's OWN undiscovered VISIBLE neighbours. Scouting
  // stays adjacent-only — no leap-scouting, the sea counts (you see it fine).
  // Seeing FURTHER (viewing past the next row) is deliberately NOT a free
  // consequence of the scout stat; it is a tech to be earned/learned later
  // (see VISION.md — a Mind-pillar unlock), not something you have from day one.
  const isFrontier = g => !isDiscovered(g) && onMap(g) && sightNeighbors(view().player).some(n => eq(n, g))

  // Routing is one Dijkstra sweep from the player over DISCOVERED ground —
  // one graph, boards and rivers alike — minimising lexicographically:
  //   1. CHARGE (what you actually pay — free safe ground beats cheap ground)
  //   2. COST (time on the road, so free-ground ties still take the short way)
  //   3. LEAPS (a leap that saves nothing is just showing off — walk instead)
  // Cached per (world, player); routeTo unwinds prev pointers, canMove reads
  // the charge. See reachMap below (after the cost helpers it depends on).
  const ROUTE_CMP = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

  function routeTo(target) {
    if (eq(target, view().player)) return [target]
    const m = reachMap()
    const end = reachAt(target)
    if (!end) return null
    // unwind the NODE chain (hex + afloat), keeping just the hexes
    const path = [end.at]
    for (let n = end.prev; n; n = m.get(n).prev) path.unshift(m.get(n).at)
    return path
  }

  // ── terrain (two-octave world field, both from the WORLD KEY, pure) ─────
  // BASE: one nibble per board on the PARENT grid, interpolated between board
  // centres so the macro field is continuous across rivers — the continents —
  // torn rivers included: a board on the rim blends with its globe neighbour.
  // DETAIL: per-board SHA-256 streams that tweak the base ±7.5·DETAIL — the
  // texture. Everything below is a pure function of (worldKey, position),
  // cached.
  const utf8 = s => new TextEncoder().encode(s)
  const hexOf = bytes => [...bytes].map(b => b.toString(16).padStart(2, "0")).join("")
  const unitXY = g => ({ x: Math.sqrt(3) * (g[0] + g[1] / 2), y: 1.5 * g[1] })
  const boardBase = new Map() // parent "q,r" → 0..15 (that board's base nibble)
  if (worldKey) for (const ck of net.boards.keys()) boardBase.set(ck, parseInt(hexOf(sha256(utf8(worldKey + ":base:" + ck)))[0], 16))
  const hasTerrain = !!worldKey
  const PITCH = Math.hypot(
    unitXY(boardCentre([1, 0])).x - unitXY(boardCentre([0, 0])).x,
    unitXY(boardCentre([1, 0])).y - unitXY(boardCentre([0, 0])).y
  )
  const streamCache = new Map() // parent "q,r" → 64 hex chars (the board's subkey)
  const streamOf = ck => {
    let s = streamCache.get(ck)
    if (!s) {
      s = hexOf(sha256(utf8(worldKey + ":board:" + ck)))
      streamCache.set(ck, s)
    }
    return s
  }
  const localIdx = new Map(readingOrder(RINGS).map((t, i) => [key(t), i]))
  // a board-interior tile's detail nibble — 7.5 (no tweak) without a world key
  const localNibble = b => (worldKey ? parseInt(streamOf(key(b.c))[localIdx.get(key(b.local))], 16) : 7.5)

  // ── people (every board keeps a figure; its childkey IS its identity) ──
  // The board's subkey (streamOf) doubles as a secret key: getPublicKey of it makes
  // each NPC a REAL derivable nostr identity — anyone can recompute your
  // world's people (puppets of the world, by design). Stats read from that
  // pubkey with the same rule as the player's. Home has no NPC — the player
  // is home's figure. Placement: the board's centre, for now.
  const hexToBytes = s => Uint8Array.from({ length: 32 }, (_, i) => parseInt(s.slice(2 * i, 2 * i + 2), 16))
  // ONE MASTER PER SKILL, ON THE PENTAGONS. Even inside the band, the top is
  // rare enough that a world can hold NO teacher at all for some skill — a
  // dead end you can't see or fix. So the twelve pentagon boards are each
  // raised to NPC_MAX in ONE skill, dealt from the world key: every world can
  // carry you to the band's top in everything, and finding who is the game.
  // Derived from the key, never stored — replay-safe.
  let masterMap = null
  const masterSkillAt = c => {
    if (!worldKey) return null
    if (!masterMap) {
      const boards = net.order.filter(t => (t[0] || t[1]) && boardInfo(t)?.sides === 5).map(t => t.slice()) // the pentagons, in crossing order from home
      let s = ""
      for (let i = 0; s.length < 4 * boards.length; i++) s += hexOf(sha256(utf8(worldKey + ":masters:" + i)))
      // Fisher-Yates off that stream, then the pentagons take the skills in
      // wheel order — a shuffle, so no board can be master of two
      for (let i = boards.length - 1, j = 0; i > 0; i--, j++) {
        const k2 = parseInt(s.slice(j * 4, j * 4 + 4), 16) % (i + 1)
        ;[boards[i], boards[k2]] = [boards[k2], boards[i]]
      }
      masterMap = new Map(STAT_NAMES.map((sk, i) => [key(boards[i]), sk]))
    }
    return masterMap.get(key(c)) || null
  }
  const npcCache = new Map()
  function npcAt(c) {
    if (!worldKey || !boardInfo(c)) return null
    if (c[0] === 0 && c[1] === 0) return null // home is the player's own board
    const ck = key(c)
    let npc = npcCache.get(ck)
    if (npc === undefined) {
      let seed = hexToBytes(streamOf(ck))
      let pk = null
      for (let guard = 0; guard < 8 && !pk; guard++) {
        try {
          pk = getPublicKey(seed)
        } catch {
          seed = sha256(seed) // ~2^-128 per try; deterministic fallback
        }
      }
      if (pk) {
        const pos = boardCentre(c)
        const stats = statsOf(pk)
        // squeeze their nature into the figures' band (NPC_MIN..NPC_MAX)…
        for (const s of STAT_NAMES) stats[s] = Math.max(NPC_MIN, Math.min(NPC_MAX, stats[s]))
        // …then the place bonus: their home ground raises its skill's nature,
        // but only to PLACE_CAP — one short of the band's top, so home ground
        // alone never makes a master. Math.max keeps it a LIFT: a figure
        // already at NPC_MAX by nature is not dragged down to PLACE_CAP.
        const homeSkill = BIOME_SKILL[biomeAt(pos)]
        if (homeSkill) stats[homeSkill] = Math.max(stats[homeSkill], Math.min(PLACE_CAP, stats[homeSkill] + PLACE_BONUS))
        // …and last, the master guarantee — this board's one anointed skill
        const mastery = masterSkillAt(c)
        if (mastery) stats[mastery] = NPC_MAX
        npc = { board: c.slice(), pubkey: pk, pos, stats, place: homeSkill || null, mastery: mastery || null }
      } else npc = null
      npcCache.set(ck, npc)
    }
    return npc
  }
  // combined height of an INTERIOR tile (base field ± subkey tweak)
  const combinedCache = new Map()
  function combinedAt(g) {
    const gk = key(g)
    let v = combinedCache.get(gk)
    if (v !== undefined) return v
    const b = boardGeo(g)
    if (!b || b === "river") {
      // river: the mean of its interior flanks — fields cross the water
      let s = 0
      let n = 0
      for (const d of DIRS) {
        const ng = [g[0] + d.q, g[1] + d.r]
        const nb = boardGeo(ng)
        if (nb && nb !== "river") {
          s += combinedAt(ng)
          n++
        }
      }
      v = n ? s / n : 7.5
    } else {
      const p = unitXY(g)
      let sum = 0
      let wsum = 0
      // the board itself (-1), then the cell over each side. Over a torn river
      // that cell is empty: the globe's real neighbour stands in, weighed from
      // there as if it lay on the map — the field runs on round the globe.
      const across = boardInfo(b.c).across
      for (let dir = -1; dir < 6; dir++) {
        const c = dir < 0 ? b.c : Hex.neighbor(b.c, dir)
        const bb = boardBase.get(key(c)) ?? (dir >= 0 && across[dir] ? boardBase.get(key(across[dir])) : undefined)
        if (bb === undefined) continue
        const cu = unitXY(boardCentre(c))
        const d = Math.hypot(p.x - cu.x, p.y - cu.y)
        if (d >= PITCH) continue
        const w = 1 - d / PITCH
        sum += w * bb
        wsum += w
      }
      const base = wsum ? sum / wsum : 7.5
      v = Math.max(0, Math.min(15, base + (localNibble(b) - 7.5) * DETAIL))
    }
    combinedCache.set(gk, v)
    return v
  }
  const smoothedAt = g => {
    let s = 2 * combinedAt(g)
    let n = 2
    for (const d of DIRS) {
      const ng = [g[0] + d.q, g[1] + d.r]
      if (onMap(ng)) {
        s += combinedAt(ng)
        n++
      }
    }
    return s / n
  }
  // the terrain-relevant neighbour: straight across a river if one intervenes
  // (the lattice's own geometry — terrain lies under any stored type)
  const acrossT = (g, d) => {
    let n = [g[0] + DIRS[d].q, g[1] + DIRS[d].r]
    let geo = boardGeo(n)
    if (geo === "river") {
      n = [n[0] + DIRS[d].q, n[1] + DIRS[d].r]
      geo = boardGeo(n)
    }
    return geo && geo !== "river" ? n : null
  }
  // base class: mountain (raw spikes), water (smoothed lowlands + highland
  // tarns — basins carved below a high neighbourhood), else plain
  const baseClassCache = new Map()
  function baseClassAt(g) {
    const gk = key(g)
    let v = baseClassCache.get(gk)
    if (v) return v
    const raw = combinedAt(g)
    let s = 0
    let n = 0
    for (let d = 0; d < 6; d++) {
      const ng = acrossT(g, d)
      if (!ng) continue
      s += combinedAt(ng)
      n++
    }
    const nbrAvg = n ? s / n : raw
    const tarn = nbrAvg >= TARN_FLOOR && raw <= nbrAvg - TARN_DEPTH
    v = tarn ? "water" : raw >= 12 ? "mountain" : smoothedAt(g) < WATER_LEVEL ? "water" : "plain"
    baseClassCache.set(gk, v)
    return v
  }
  // full biome: the neighbour grammar on top of the base class
  const biomeCache = new Map()
  function biomeAt(g) {
    const gk = key(g)
    let v = biomeCache.get(gk)
    if (v) return v
    const b = baseClassAt(g)
    let water = 0
    let mountain = 0
    let minNbr = 15
    for (let d = 0; d < 6; d++) {
      const ng = acrossT(g, d)
      if (!ng) continue
      const nb = baseClassAt(ng)
      if (nb === "water") water++
      if (nb === "mountain") mountain++
      minNbr = Math.min(minNbr, combinedAt(ng))
    }
    v = b
    if (b === "mountain") {
      v = localNibble(boardGeo(g)) === PEAK_NIBBLE ? "peak" : water || combinedAt(g) - minNbr >= CLIFF_DROP ? "cliff" : "mountain"
    } else if (b === "plain") {
      v = water >= 2 ? "marsh" : water ? "beach" : mountain ? "forest" : "plain"
    } else if (b === "water") {
      // the HOME board never holds open water: it must stay fully walkable
      // or the gate could never open (clear = discover all 61). Water there
      // reads as marsh — wet ground. Neighbour grammar still sees the water
      // base, so shores ring it naturally.
      const bg = boardGeo(g)
      if (bg && bg !== "river" && bg.c[0] === 0 && bg.c[1] === 0) v = "marsh"
    }
    biomeCache.set(gk, v)
    return v
  }

  // ── costs ────────────────────────────────────────────
  const stepCost = () => view().cost * MOVE_COST // move onto a known tile
  const scoutCost = () => view().cost * SCOUT_COST // reveal an adjacent tile, staying put
  // Resolve a hex's type NAME: the ground's stored sparse map first (keyed by
  // GLOBAL coord), then the derived terrain on a board, else `river` — what
  // lies between the boards. typeOf feeds costs; the renderer reads the name
  // for the land's look.
  const typeNameAt = g => {
    const stored = ground().types[key(g)]
    if (stored) return stored
    return boardOf(g) ? (hasTerrain ? biomeAt(g) : "plain") : "river"
  }
  const typeOf = g => TILE_TYPES[typeNameAt(g)]

  // ── skills in effect (nature + nurture) ─────────────────────────────
  // The player: starts at ONE in everything and learns to the full cap of 15 —
  // the key says how gifted, never where you begin. An NPC sits AT its nature,
  // which is also its ceiling (taught later).
  // edges filled by PRACTICE (doing the skill): PRACTICE_BASE actions = one edge,
  // or a kind's own PRACTICE_PER
  const practiceEdges = skill => {
    let n = 0
    for (const k in PRACTICE_SKILL) if (PRACTICE_SKILL[k] === skill) n += (practiced[k] || 0) / (PRACTICE_PER[k] || PRACTICE_BASE)
    return n
  }
  // total edges filled above nature — whole edges from LESSONS (each = 1) plus
  // fractions from PRACTICE, on the one shared shape
  const edgesOf = skill => (learned[skill] || 0) + practiceEdges(skill)
  // the LIVE progress of a skill, from ONE total-edge currency counted from
  // level 0: PLAYER_START pre-fills the edges below it, lessons/practice add
  // more, teaching drains — and the drain digs into that start like anything
  // else. No infinite well at the base: an empty shape gives up the level, all
  // the way down. The renderer draws `sides` dashed edges, `filled` of them
  // solid, the current one `partial` full.
  const skillProgress = skill => {
    if (!STAT_NAMES.includes(skill)) return { level: 0, sides: 1, filled: 0, partial: 0 }
    const base = PLAYER_START
    let prefill = 0 // the edges nature already climbed for you (levels 0..base)
    for (let l = 0; l < base; l++) prefill += edgesForLevel(l)
    const total = Math.max(0, prefill + edgesOf(skill) - (given[skill] || 0))
    const { levels, rem } = levelsFromEdges(total, 0)
    const level = Math.min(SKILL_CAP, levels)
    const sides = edgesForLevel(level) // edges of the level currently filling
    return {
      level,
      sides,
      filled: level >= SKILL_CAP ? sides : Math.min(sides, Math.floor(rem)),
      partial: level >= SKILL_CAP ? 0 : rem - Math.floor(rem)
    }
  }
  // a skill you've MET: practised once, or taught by a figure (heal, farm and
  // trade have no practice, so a lesson is the only way in). Travel is met
  // with the first step, craft and build with the first thing you pick up,
  // cook with the first food you gather or hunt, dream with the first
  // exhaustion, trade with the first board centre beyond home — their glyphs
  // are where they're done, so they can't wait to be practised.
  const pickedUp = () => !!(noted.take || noted.gather || noted.hunt)
  const pickedFood = () => Object.keys(gatheredAt).some(k => RESOURCES[k.slice(k.lastIndexOf("|") + 1)]?.food > 0)
  const skillMet = skill =>
    (skill === "travel" && !!noted.move) ||
    ((skill === "craft" || skill === "build") && pickedUp()) ||
    (skill === "cook" && pickedFood()) ||
    (skill === "dream" && !!noted.exhaustion) ||
    (skill === "trade" && centred) ||
    (learned[skill] || 0) > 0 ||
    Object.keys(PRACTICE_SKILL).some(k => PRACTICE_SKILL[k] === skill && (practiced[k] || 0) > 0)
  // nature + LEARNED/PRACTICED (edges) − TAUGHT away. Floored at 0, capped at 15.
  const skillOf = skill => (STAT_NAMES.includes(skill) ? skillProgress(skill).level : 0)
  // AN NPC SITS AT ITS NATURE. They've done this all their life — climbing from
  // one is the PLAYER's growth arc, not theirs. So their nature (banded NPC_MIN..NPC_MAX) is where they
  // begin, and the best of them can carry you to NPC_MAX.
  // TEACHING still lifts them, now ABOVE their nature toward SKILL_CAP: you
  // give up your own hard-won edges to raise a figure past what they were born
  // with. That can't leak levels back to you — `teach` demands you already
  // outrank them — so the last three levels stay something you GRIND, never
  // something you're handed. The transfer is EDGE FOR EDGE, both ways: taught[]
  // is the net of edges handed in and lessons taken out below MASTERY, on ONE
  // total-edge currency counted from level 0 like yours — their nature
  // pre-fills it, and a drain digs into it until you teach them back up.
  const npcProgress = (npc, skill) => {
    const nature = npc.stats[skill]
    let prefill = 0 // the edges their nature already climbed (levels 0..nature)
    for (let l = 0; l < nature; l++) prefill += edgesForLevel(l)
    const net = (taught[key(npc.board)] || {})[skill] || 0
    const { levels, rem } = levelsFromEdges(Math.max(0, prefill + net), 0)
    const level = Math.min(SKILL_CAP, levels)
    const sides = edgesForLevel(level)
    return {
      level,
      sides,
      filled: level >= SKILL_CAP ? sides : Math.min(sides, Math.floor(rem)),
      partial: level >= SKILL_CAP ? 0 : rem - Math.floor(rem)
    }
  }
  const npcSkill = (npc, skill) => npcProgress(npc, skill).level
  // write a first down — once, ever. One that comes of WORLD state a rewind
  // doesn't re-run (the gate, which never un-falls) is planted in the day's
  // start too, as the wall's kit is, or scrubbing that day would lose it.
  const note = (id, world = false) => {
    if (noted[id]) return
    noted[id] = { day, at: minuteOfDay(), lore: skillOf("lore") }
    practiced.first = (practiced.first || 0) + 1
    if (world && dayStart) {
      dayStart.noted = { ...(dayStart.noted || {}), [id]: noted[id] }
      dayStart.practiced = { ...(dayStart.practiced || {}), first: ((dayStart.practiced || {}).first || 0) + 1 }
    }
  }
  // the teacher at hand: the current board's figure, when within a step
  const teacherNear = () => {
    const b = boardHexOf(view().player)
    const npc = b && npcAt(b)
    return npc && Hex.distance(view().player, npc.pos) <= 1 ? npc : null
  }
  // the board's dominant biome — a figure's LAND TYPE, which decides what
  // they can craft. Tally the 60 interior tiles, most-common wins.
  const mainTypeOf = c => {
    if (!hasTerrain) return null
    const c0 = boardCentre(c)
    const tally = {}
    const bite = biteOf(boardInfo(c))
    for (const t of readingOrder(RINGS)) {
      if (!t[0] && !t[1]) continue
      if (bite && bite.has(key(t))) continue
      const b2 = typeNameAt([c0[0] + t[0], c0[1] + t[1]])
      tally[b2] = (tally[b2] || 0) + 1
    }
    return Object.keys(tally).sort((x, y) => tally[y] - tally[x])[0]
  }
  // what the nearby teacher can still teach: skills where they outrank you
  const learnable = () => {
    const npc = teacherNear()
    if (!npc) return []
    return STAT_NAMES.filter(s => npcSkill(npc, s) > skillOf(s)).map(s => ({
      skill: s,
      at: skillOf(s),
      teacher: npcSkill(npc, s)
    }))
  }

  // ── height: elevation ────────────────────────────────
  // A tile's height as the game states and prices it — ONE number, land and
  // water alike. Beach pins to the waterline: a beach can't sit higher than
  // the water it edges, so it reads WATER_LEVEL (4) whatever the field says.
  // WATER runs from 0 down: 0 at the shore … −4 at the floor, off the smoothed
  // field the water rule and the water's shading already read.
  const elevationAt = g => {
    const t = typeNameAt(g)
    return t === "water" ? waterElevationAt(g) : t === "beach" ? WATER_LEVEL : Math.round(combinedAt(g))
  }
  const waterElevationAt = g => {
    const glob = 0 - Math.max(0, Math.min(WATER_LEVEL, WATER_LEVEL - Math.round(smoothedAt(g))))
    // …but an ISOLATED pond has no sea to be level with, so the global measure is
    // meaningless for it: a mountain tarn sits far ABOVE the waterline, clamps to
    // 0, and every pond in the world reads dead flat. Measure a lone pool against
    // its OWN RIM instead — how far it lies below the land ringing it — at 2/3
    // weight, so a pond reads as a modest dip and the deepest tints stay with the
    // real sea floor. Connected water (any water neighbour) is untouched.
    if (Hex.neighbors(g).some(nb => typeNameAt(nb) === "water")) return glob
    let s = 0
    let n = 0
    for (const nb of Hex.neighbors(g)) {
      const t = typeNameAt(nb)
      if (!t || t === "water") continue
      s += combinedAt(nb)
      n++
    }
    if (!n) return glob
    // A pool only EXISTS because it sits well below its rim (a tarn needs
    // TARN_DEPTH), so the drop is never small — POND_RIM discounts that baseline
    // and only the excess counts. Most ponds land at 0 (a puddle), the deeper
    // cuts at −1, the rare sink at −2. Unrounded heights, so the gradation is
    // real rather than quantised into one bucket.
    const POND_RIM = 3
    return 0 - Math.max(0, Math.min(WATER_LEVEL, Math.round(s / n - combinedAt(g) - POND_RIM)))
  }
  // …and height works the legs EXPONENTIALLY, on top of the biome
  // multiplier: sea level (4) walks at 1×; each point above multiplies the
  // step by the elevation base — ~27× at the raw peak, a wall until the legs
  // are trained. TRAVEL (grown by walking — practice) eases the base from
  // ELEV_STEP toward ELEV_STEP_FIT at 15. Water mirrors it downward: each point
  // below its own 0 doubles a step on it (DEPTH_STEP), wading or aboard, and
  // the legs don't ease it. Rivers and unterrained boards carry no height: 1×.
  const heightFactor = g => {
    if (!hasTerrain || !boardOf(g)) return 1
    if (typeNameAt(g) === "water") return Math.pow(DEPTH_STEP, -elevationAt(g))
    const base = ELEV_STEP - (ELEV_STEP - ELEV_STEP_FIT) * (skillOf("travel") / SKILL_CAP)
    return Math.pow(base, Math.max(0, elevationAt(g) - WATER_LEVEL))
  }
  // ── the pack on your back ──────────────────────────
  // The minute of the day: what the day began with, plus what you've eaten
  // into it, minus what's left — so eating never turns the clock back.
  const minuteOfDay = () => wakeAt + (dayStart ? dayStart.energy : SEED_MIN) + fed - energy
  // World-minutes since day one (1440/day — the sleep hours pass too): the
  // regrow and spoilage clocks tick against this. Monotonic — a rest jumps
  // the day (1440) by more than any energy refill (≤60) can pull it back.
  const worldMin = () => (day - 1) * 1440 + minuteOfDay()
  // THE MEAL CLOCK (RULES 42): a minute of the day the next meal falls due.
  // Waking sets it HUNGER_MAX out — the body's own starting reserve — and from
  // there EVERY BITE PUSHES IT ON BY WHAT THE FOOD IS WORTH (RULES 47; it used
  // to restart the whole three hours whatever you ate, so a 3-minute herb
  // bought the same day a cooked hare did). What you can still spend today is
  // the lesser of the budget and the minutes until then — every affordability
  // check prices against timeLeft, so the reserve lands you at a resting
  // place before you'd go hungry, exactly as it does before the budget runs out.
  const mealDue = () => mealAt
  const hungerLeft = () => mealDue() - minuteOfDay()
  // BED IS DUE (RULES 52): WAKE_CAP after waking, the same kind of due minute
  // as the meal's — nothing pushes it, so it stands 16h past the wake
  const bedDue = () => wakeAt + WAKE_CAP
  // THE WAKE MOVES (2026-11-13): a day longer than WAKE_CAP can't all be
  // spent awake — bed binds first — so what it runs past 16h is how late you
  // may wake instead, up to SLEEP_MIN. Asleep, you choose tomorrow's wake in
  // that window: no later than the new day's slack, and no earlier than a full
  // SLEEP_MIN after the minute you lay down. Without a choice the wake stays
  // where it was, so every log written before it wakes at 00:00 as it did.
  const wakeRange = (slept = minuteOfDay()) => {
    const hi = Math.max(0, Math.min(SLEEP_MIN, dailyBudget() - WAKE_CAP))
    const lo = Math.min(hi, Math.max(0, slept - WAKE_CAP))
    return { lo, hi }
  }
  const sleepLeft = () => bedDue() - minuteOfDay()
  const timeLeft = () => Math.min(energy, hungerLeft(), sleepLeft())
  const itemWeight = k => defOf(k)?.weight ?? 0
  const itemDef = k => defOf(k) || {}
  // ── the pack, as dated INSTANCES ────────────────────
  // inventory[k] is an ARRAY of { at } (world-minute made) — nothing else: what
  // a thing weighs, is worth and keeps for all belong to its KIND. Spoilage is a
  // DERIVED view: an instance older than
  // its shelf life (times the preserve factor of your storage) is gone —
  // it neither counts nor weighs. All log-derived, snapshot-restored.
  const preserveFactor = () => {
    let f = 1
    for (const k in inventory) {
      const keeps = RECIPES[k]?.keeps
      if (keeps && (inventory[k]?.length || 0) > 0) f = Math.max(f, keeps)
    }
    return f
  }
  const shelfOf = k => {
    const s = itemDef(k).shelf
    return s ? s * preserveFactor() : Infinity
  }
  const freshOf = k => {
    const arr = inventory[k]
    if (!arr) return []
    const now = worldMin()
    const life = shelfOf(k)
    return life === Infinity ? arr : arr.filter(i => now - i.at < life)
  }
  const countOf = k => freshOf(k).length
  // spoilage is IRREVERSIBLE: prune expired instances at every action
  // boundary (before any preserve factor can change), so gaining a basket
  // later never un-rots food already lost. Costs nothing — freshOf already
  // excluded them; this just makes the removal permanent. Deterministic:
  // worldMin is monotonic, so the same actions prune the same instances.
  const pruneSpoiled = () => {
    const now = worldMin()
    for (const k of Object.keys(inventory)) {
      const life = shelfOf(k)
      if (life === Infinity) continue
      inventory[k] = inventory[k].filter(i => now - i.at < life)
      if (!inventory[k].length) delete inventory[k]
    }
    // a stash keeps time too — but it's a plain cell, no preserve factor
    // (that's a CARRIED basket's trick), so stashed food rots at base shelf
    for (const sk of Object.keys(stash)) {
      for (const k of Object.keys(stash[sk])) {
        const life = itemDef(k).shelf // the RAW shelf: a cell has no basket's preserve
        if (!life) continue // …and no shelf at all means it keeps forever (wood, rock, cord)
        stash[sk][k] = stash[sk][k].filter(i => now - i.at < life)
        if (!stash[sk][k].length) delete stash[sk][k]
      }
      if (!Object.keys(stash[sk]).length) delete stash[sk]
    }
  }
  const loadOf = () => {
    let s = 0
    for (const k in inventory) s += itemWeight(k) * countOf(k)
    return s
  }
  // capacity: hands + the gather skill + every (fresh) basket carried
  const carryCap = () => CARRY_BASE + skillOf("gather") + countOf("basket") * (RECIPES.basket.carry || 0)
  // the LOAD slows every step, linearly up to 2× at a full pack — through
  // the reserve, a heavy pack literally shortens how far you can go
  const loadFactor = () => 1 + Math.min(1, loadOf() / Math.max(1, carryCap()))
  // centres price at BASE: no biome multiplier, no height — the board's own
  // tile always costs one plain step (scouting one likewise skips the terrain
  // multiplier; the scout-skill discount still applies)
  // how many times you've walked ONTO this tile, and the discount that earns:
  // each prior traversal shaves WEAR_STEP off the multiplier, down to WEAR_FLOOR
  const wornAt = g => ground().worn[key(g)] || 0
  const wearFactor = g => Math.max(WEAR_FLOOR, 1 - WEAR_STEP * wornAt(g))
  const stepCostAt = g => (isCentre(g) ? stepCost() : stepCost() * typeOf(g).move * heightFactor(g) * wearFactor(g)) * loadFactor()
  // DISCOVERY IS PRICED PER RING OF TILES (RULES 32, 2026-08-03 — supersedes
  // both the smooth ramp of RULES 31 and a per-BOARD step, neither of which
  // bit). One literal hex ring outward, one more multiple:
  //
  //   ring ≤ 5  (home, and the river ringing it)   1×
  //   ring 6    (the first shore)                  2×
  //   ring 7                                       3×
  //   …and so on, a step per ring, uncapped.
  //
  // The daily budget IS your discovered tile count, so cheap scouting compounds
  // — every tile revealed buys more revealing tomorrow, and exploration ran
  // away with the game. Making distance dear is what makes SETTLING and working
  // your surroundings the better move; the scout SKILL (below) is what wins the
  // range back later, so the ladder reads: stay close, get good, then go far.
  //
  // (A cap at 3× was tried and REVERTED, 2026-08-04 — the ramp is deliberate.
  // What it costs is measured in DESIGN.md: sailing pays it hardest, since the
  // ring is distance from the world's origin and the river winds outward, so a
  // day afloat spends most of itself revealing the water ahead of the boat.)
  const scoutTierAt = g => Math.max(1, Hex.length(g) - RIVER_RING + 1)
  // the first stat that bites: scout level discounts scouting — at 15,
  // half price. Learned levels replay from the log, so charges stay exact.
  const scoutCostAt = g =>
    scoutCost() * (isCentre(g) ? 1 : typeOf(g).scout) * scoutTierAt(g) * (1 - skillOf("scout") / 30)
  // The safe umbrella covers safe board INTERIORS only — the river sits outside
  // the walls, so steps/scouts targeting it charge even while based at home.
  const freeAt = g => !!boardOf(g)?.node?.safe
  // Home is no longer free: every step/scout inside a safe board counts a flat
  // COST_BASE (1), tile by tile, so clearing home spans several days. Outside,
  // biome multipliers still apply.
  const stepChargeAt = g => (freeAt(g) ? COST_BASE : stepCostAt(g))
  const scoutChargeAt = g => (freeAt(g) ? COST_BASE : scoutCostAt(g))
  // a route's price, step by step — a raft's steps priced as a raft's (raftFactor)
  const pathCost = path => {
    let c = 0
    for (let i = 1; i < path.length; i++) c += stepCostAt(path[i]) * raftFactor(path[i - 1], path[i])
    return c
  }
  const pathCharge = path => {
    let c = 0
    for (let i = 1; i < path.length; i++) c += stepChargeAt(path[i]) * raftFactor(path[i - 1], path[i])
    return c
  }

  // ── resting places & the reserve (the EXACT way to safety) ──────────
  // The world's list of places a day can end and restart from. The home
  // centre is entry ONE; future built rest spots (camps, waystations…) push
  // here. The loop stays closed: you can only continue while at least one
  // resting place is still affordably reachable — that's what makes a saved
  // state always a safe state.
  const restSpots = [[0, 0]]

  // The reserve is the true cheapest cost of walking from a position to the
  // NEAREST resting place over discovered ground — one multi-source Dijkstra
  // seeded at every rest spot (edge weight = the charge of the tile stepped
  // onto, going spot-ward), cached until the world or the spot list changes.
  // This makes never-strandable LITERAL: at energy == reserve the trip to
  // safety is affordable to the minute, every minute.
  let worldStamp = 0 // bumped on discovery/wall changes — invalidates the map
  let reserveCache = { stamp: -1, spots: 0, map: null }

  // The way home, swept BACKWARDS from every resting place: `dist` is seeded
  // with the tiles that are already home (cost 0) and `q` with the same, and
  // the sweep relaxes outward. Split out so the map can be grown a second time
  // from a new seed — the raft (see reserveMap).
  function sweepHome(dist, q) {
    const up = i => {
      for (let p; i && q[(p = (i - 1) >> 1)][0] > q[i][0]; i = p) [q[p], q[i]] = [q[i], q[p]]
    }
    const down = () => {
      for (let i = 0; ; ) {
        let m = i
        const l = 2 * i + 1
        if (l < q.length && q[l][0] < q[m][0]) m = l
        if (l + 1 < q.length && q[l + 1][0] < q[m][0]) m = l + 1
        if (m === i) break
        ;[q[m], q[i]] = [q[i], q[m]]
        i = m
      }
    }
    while (q.length) {
      const [d, cur] = q[0]
      const last = q.pop()
      if (q.length) {
        q[0] = last
        down()
      }
      if (d > (dist.get(key(cur)) ?? Infinity)) continue
      const charge = stepChargeAt(cur) // stepping (or leaping) from a neighbour toward `cur` charges entering cur
      // THE WAY HOME CROSSES WATER ONLY ON A BRIDGE. Passing `null` for the
      // tile-you-came-from is what says so: a river tile then offers only its
      // bridged banks, never the wade-back-out edge (that one depends on how
      // you got in, which a sweep from home can't know — the call sites price
      // it with returnVia instead).
      for (const n of moveNeighbors(cur, null)) {
        if (!isDiscovered(n)) continue // the way home runs over known ground
        const nd = d + charge
        if (nd < (dist.get(key(n)) ?? Infinity)) {
          dist.set(key(n), nd)
          q.push([nd, n])
          up(q.length - 1)
        }
      }
    }
    return dist
  }

  // THE WAY HOME ON FOOT — rest spots only, walking and bridges. This is the
  // map the water route reads (riverReserve), so it must never itself depend on
  // the raft: pricing a sail home off a shore whose own way home is that same
  // sail would be counting the one raft twice.
  let reserveBaseCache = { stamp: -1, spots: 0, map: null }
  function reserveBase() {
    if (reserveBaseCache.stamp === worldStamp && reserveBaseCache.spots === restSpots.length) return reserveBaseCache.map
    const map = sweepHome(new Map(restSpots.map(s => [key(s), 0])), restSpots.map(s => [0, s]))
    reserveBaseCache = { stamp: worldStamp, spots: restSpots.length, map }
    return map
  }
  // …AND THE WAY HOME WITH THE RAFT. Ashore on the far side, the walk home runs
  // back to the water, boards the raft where it's moored, punts to a shore that
  // knows the way, and walks from there — so the raft's tile is a second SOURCE
  // for the sweep, priced at what the water route costs from it. Without this
  // the whole far bank reads as unreachable-from-home and the reserve refuses
  // to let you off the raft at all: you could sail anywhere and land nowhere.
  function reserveMap() {
    if (reserveCache.stamp === worldStamp && reserveCache.spots === restSpots.length) return reserveCache.map
    const base = reserveBase()
    let map = base
    if (raft && isDiscovered(raft)) {
      const w = riverReserve(raft)
      if (w < Infinity && w < (base.get(key(raft)) ?? Infinity)) {
        map = new Map(base)
        map.set(key(raft), w)
        sweepHome(map, [[w, raft]])
      }
    }
    reserveCache = { stamp: worldStamp, spots: restSpots.length, map }
    return map
  }

  // THE WAY HOME BY WATER. Aboard the raft the river is a network again, so the
  // reserve from a river tile is: navigate to the cheapest tile with a landable
  // bank, step ashore, then walk. A Dijkstra over the WATER only (rivers, lakes
  // and the sea), riding the current, reading the land reserve at every shore
  // it touches. The raft travels with you, which is exactly why this is allowed
  // to cross.
  const raftCache = new Map() // "q,r" → reserve by water, per sweep stamp
  let raftCacheStamp = -1
  function riverReserve(from) {
    if (raftCacheStamp !== worldStamp) (raftCache.clear(), (raftCacheStamp = worldStamp))
    const fk = key(from)
    const memo = raftCache.get(fk)
    if (memo !== undefined) return memo
    const land = reserveBase() // the walking map — see reserveBase on why not the raft's
    const dist = new Map([[fk, 0]])
    const q = [[0, from]] // min-heap on [0], lazy deletion
    const up = i => {
      for (let p; i && q[(p = (i - 1) >> 1)][0] > q[i][0]; i = p) [q[p], q[i]] = [q[i], q[p]]
    }
    const pop = () => {
      const top = q[0]
      const last = q.pop()
      if (q.length) {
        q[0] = last
        for (let i = 0; ; ) {
          let m = i
          const l = 2 * i + 1
          if (l < q.length && q[l][0] < q[m][0]) m = l
          if (l + 1 < q.length && q[l + 1][0] < q[m][0]) m = l + 1
          if (m === i) break
          ;[q[m], q[i]] = [q[i], q[m]]
          i = m
        }
      }
      return top
    }
    let best = Infinity
    while (q.length) {
      const [d, cur] = pop()
      if (d > (dist.get(key(cur)) ?? Infinity) || d >= best) continue
      for (const n of walkNeighbors(cur)) {
        if (!isDiscovered(n)) continue
        if (navWater(n)) {
          const nd = d + stepChargeAt(n) * raftFactor(cur, n)
          if (nd < (dist.get(key(n)) ?? Infinity)) {
            dist.set(key(n), nd)
            q.push([nd, n])
            up(q.length - 1)
          }
        } else {
          const home = land.get(key(n)) // a shore that knows the way home
          if (home != null) best = Math.min(best, d + stepChargeAt(n) + home)
        }
      }
    }
    raftCache.set(fk, best)
    return best
  }

  // Standing IN a river you are not on the way home — you're off it, in the
  // water. The reserve is the step back onto a bank you may use (the one you
  // waded in from, or one a bridge reaches) plus the way home from there. With
  // the raft under you, it's the water route instead.
  //
  // `afloat` says whether the raft would be under you AT g — and callers that
  // price a HYPOTHETICAL arrival (canMove, viaValid, retAfterPath) must pass
  // what their own route says, explicitly. The default is the LIVE rule (g is
  // where you stand), and it is WRONG for a hypothetical: it reads aboard()
  // off the current player, so pricing a route that steps OFF the raft onto
  // land and wades into other water answered with the sail-away reserve for a
  // tile you'd reach raftless. That undercount let a move commit whose true
  // wade-out reserve exceeded the energy left — the stranding of 2026-08-31
  // (lab/stranded-save.json, day 24: aboard at [-7,-8], landed [-4,-10] with
  // 23.9 energy against a 39.4 reserve).
  const returnVia = (g, from, afloat = !!raft && (eq(raft, g) || (aboard() && navWater(g)))) => {
    if (afloat) return riverReserve(g)
    let best = Infinity
    for (const n of stepsFrom(g, from)) {
      const d = reserveMap().get(key(n))
      if (d != null) best = Math.min(best, stepChargeAt(n) + d)
    }
    return best
  }
  // …so a river tile has no reserve of its own: ask returnVia, which needs to
  // know which bank you'd be leaving by.
  const returnFrom = pos => (navWater(pos) ? Infinity : reserveMap().get(key(pos)) ?? Infinity)
  // THE RESERVE FROM A LAND ARRIVAL (2026-08-10, generalised the same day: the
  // first cut only priced routes whose FINAL step came off the raft, so a
  // target one tile further inland was refused all over again). A route that
  // touches the raft takes the MOORING with it, and the standing reserveMap —
  // raft seeded where it floats TODAY — can neither see the new mooring nor be
  // trusted about the old one. So a land target is priced two ways, cheaper wins:
  //   • the WALK home — reserveMap when the route leaves the raft alone,
  //     reserveBase (raft-free) when it moves it;
  //   • the RETRACE — walk the just-arrived route back to where it left the
  //     raft moored, board it, and sail home (riverReserve). An upper bound
  //     (a cheaper walk to the mooring may exist), but always executable —
  //     and exactly the way home the far bank actually has.
  function landBack(target, path) {
    let rp = raft
    if (rp && Array.isArray(path))
      for (let i = 1; i < path.length; i++) if (eq(rp, path[i - 1]) && navWater(path[i])) rp = path[i]
    const moved = !!raft && !eq(rp, raft)
    const walk = moved ? reserveBase().get(key(target)) ?? Infinity : returnFrom(target)
    if (!rp || !Array.isArray(path)) return walk
    let j = -1
    for (let i = path.length - 1; i >= 0; i--)
      if (eq(path[i], rp)) {
        j = i
        break
      }
    if (j < 0) return walk // the route never rides the raft — the walk map already knows best
    let rev = 0
    for (let i = path.length - 2; i >= j; i--) rev += stepChargeAt(path[i])
    return Math.min(walk, rev + riverReserve(rp))
  }
  // the tile you stepped onto the current one from — the way back out of the water
  const cameFrom = () => {
    const t = view().trail
    return t.length > 1 ? t[t.length - 2] : null
  }
  // The reserve to walk back to the nearest rest spot — now that home costs, this
  // prices the walk to the home centre from inside home too. In the water it
  // prices the wade back out first (returnVia, by the bank you came in from).
  const returnCost = () => {
    const p = view().player
    return navWater(p) ? returnVia(p, cameFrom()) : returnFrom(p)
  }
  // Would the raft be under you at the END of this route? You board it by
  // stepping onto its tile and it comes along over water, so: the route touches
  // the mooring and never leaves the water after that. (Mirrors reachMap's own
  // afloat rule — see RAFT_MARK.)
  const aboardAfter = path => {
    if (!raft) return false
    const i = path.findIndex(t => eq(t, raft))
    return i >= 0 && path.slice(i).every(t => navWater(t))
  }
  // THE RESERVE AFTER ARRIVING BY THIS ROUTE. A tile alone can't answer it in the
  // water: the way out depends on the bank you came in by (returnVia) or on
  // having the raft under you (riverReserve) — which is exactly what the ROUTE
  // knows and a bare coordinate doesn't. Everything that previews a trip (the
  // clock's hover line, the in-flight walk) prices it through here, or a water
  // destination reads as Infinity and gets drawn as a way home of ZERO — the
  // reserve marker jumping forward as if the trip home were free.
  const retAfterPath = path => {
    if (!Array.isArray(path) || !path.length) return Infinity
    const end = path[path.length - 1]
    if (!navWater(end)) return landBack(end, path) // a route that rode the raft prices home through its new mooring
    if (aboardAfter(path)) return riverReserve(end)
    // the route ends in water WITHOUT the raft — price the wade, never the sail
    return returnVia(end, path.length > 1 ? path[path.length - 2] : cameFrom(), false)
  }

  // The way home: the shortest walk from the player to a rest spot, read off the
  // reserve map by greedily stepping to the neighbour nearest home. [player, …,
  // home]; null if home isn't reachable over known ground (or we're already there).
  function homePath() {
    // the reach map already routes shortest from the player over known ground —
    // the way home is just the route to the home centre (nearest rest spot)
    const p = routeTo(restSpots[0])
    return p && p.length > 1 ? p : null
  }
  // The way home from an ARBITRARY tile (the walking player's ghost mid-move):
  // a small Dijkstra from src to the home centre over discovered ground, so the
  // way-home trail can track the player and land with them instead of snapping.
  // Display-only; never mutates state.
  function homePathFrom(src, from = null) {
    const home = restSpots[0]
    if (eq(src, home)) return null
    // NODES, not tiles: a hex plus whether you're afloat on it (RAFT_MARK), the
    // same two states the router sweeps — see reachMap.
    const srcOn = !!raft && eq(raft, src)
    const srcNode = key(src) + (srcOn ? RAFT_MARK : "")
    const dist = new Map([[srcNode, 0]])
    const seen = new Map([[srcNode, { at: src, on: srcOn }]]) // node → { hex, afloat }
    const prev = new Map()
    const q = [[0, srcNode]]
    const up = i => {
      for (let p; i && q[(p = (i - 1) >> 1)][0] > q[i][0]; i = p) [q[p], q[i]] = [q[i], q[p]]
    }
    const pop = () => {
      const top = q[0]
      const last = q.pop()
      if (q.length) {
        q[0] = last
        for (let i = 0; ; ) {
          let m = i
          const l = 2 * i + 1
          if (l < q.length && q[l][0] < q[m][0]) m = l
          if (l + 1 < q.length && q[l + 1][0] < q[m][0]) m = l + 1
          if (m === i) break
          ;[q[m], q[i]] = [q[i], q[m]]
          i = m
        }
      }
      return top
    }
    while (q.length) {
      const [d, node] = pop()
      const info = seen.get(node)
      if (eq(info.at, home)) break
      if (d > (dist.get(node) ?? Infinity)) continue
      // leaving the water: only by the bank you came in from (or a bridge) —
      // for the FIRST tile that's the step that put us here. ABOARD (the raft is
      // moored where we stand, or came along with us) the whole river is open,
      // exactly as the router sees it — a way home that sails two tiles is a way
      // home, and this is the trail that draws it.
      const pv = prev.get(node)
      const cameBy = pv ? seen.get(pv).at : eq(info.at, src) ? from : null
      for (const n of info.on ? walkNeighbors(info.at) : moveNeighbors(info.at, cameBy)) {
        if (!isDiscovered(n)) continue
        const nOn = navWater(n) && (info.on || (raft && eq(raft, n)))
        const nk = key(n) + (nOn ? RAFT_MARK : "")
        const nd = d + stepChargeAt(n) * raftFactor(info.at, n)
        if (nd < (dist.get(nk) ?? Infinity)) {
          dist.set(nk, nd)
          seen.set(nk, { at: n, on: nOn })
          prev.set(nk, node)
          q.push([nd, nk])
          up(q.length - 1)
        }
      }
    }
    if (!prev.has(key(home))) return null // home is land — it never wears the mark
    const path = []
    for (let cur = key(home); cur; cur = prev.get(cur)) {
      path.unshift(seen.get(cur).at)
      if (cur === srcNode) break
    }
    return path.length > 1 ? path : null
  }

  // ── affordability / validity ─────────────────────────
  // The route map behind routeTo/canMove: one Dijkstra sweep from the player
  // over discovered ground, minimising (charge, cost, leaps) — see ROUTE_CMP.
  // Every entry: { charge, cost, leaps, prev, at, prevAt, on } for one NODE —
  // a hex plus whether you're afloat on it (RAFT_MARK), since the raft changes
  // what the next step can do. `prev` is the node you came from; `at`/`prevAt`
  // are the plain hexes, which is what routes are made of.
  const RAFT_MARK = "~"
  let reachCache = { stamp: -1, from: "", map: null }
  function reachMap() {
    const fk = key(view().player) + (aboard() ? RAFT_MARK : "")
    if (reachCache.stamp === worldStamp && reachCache.from === fk) return reachCache.map
    // the sweep starts where you stand — and if that's IN the water, the only
    // way out is the bank you waded in from. That entry is kept BESIDE the
    // graph, not in the start node's `prev`: routeTo unwinds prev to build a
    // path, so a start node pointing at a real tile makes it walk in circles.
    const start = view().player
    const entry = cameFrom()
    const best = new Map([[fk, { charge: 0, cost: 0, leaps: 0, prev: null, at: start, prevAt: entry, on: aboard() }]])
    const price = new Map() // per-tile [charge, cost] memo for this sweep
    // min-heap of [charge, cost, leaps, pos] under ROUTE_CMP, lazy deletion
    const q = [[0, 0, 0, fk]]
    const up = i => {
      for (let p; i && ROUTE_CMP(q[(p = (i - 1) >> 1)], q[i]) > 0; i = p) [q[p], q[i]] = [q[i], q[p]]
    }
    const down = () => {
      for (let i = 0; ; ) {
        let m = i
        const l = 2 * i + 1
        if (l < q.length && ROUTE_CMP(q[l], q[m]) < 0) m = l
        if (l + 1 < q.length && ROUTE_CMP(q[l + 1], q[m]) < 0) m = l + 1
        if (m === i) break
        ;[q[m], q[i]] = [q[i], q[m]]
        i = m
      }
    }
    while (q.length) {
      const top = q[0]
      const last = q.pop()
      if (q.length) {
        q[0] = last
        down()
      }
      const node = top[3]
      const b = best.get(node)
      if (ROUTE_CMP(top, [b.charge, b.cost, b.leaps]) > 0) continue // stale heap entry
      const cur = b.at
      // ON FOOT or ABOARD — the sweep carries both, because the raft changes
      // what a step can do. Aboard, every neighbour is open (the raft comes
      // along on the water, and moors when you step ashore); on foot, the water
      // is the dead end stepsFrom describes.
      const ns = b.on ? walkNeighbors(cur) : moveNeighbors(cur, eq(cur, start) ? entry : b.prevAt)
      for (const n of ns) {
        // a tile's discovery and step price are sweep-stable — memoise
        // both, each tile gets relaxed from many sides (the hottest lines)
        const nk = key(n)
        let pr = price.get(nk)
        if (pr === undefined) {
          pr = isDiscovered(n) ? [stepChargeAt(n), stepCostAt(n)] : null
          price.set(nk, pr)
        }
        if (!pr) continue // routes run over known ground only
        // you're aboard on the far side of this step if it lands on water and
        // either you were already aboard or the raft is moored right there
        const nOn = navWater(n) && (b.on || (raft && eq(raft, n)))
        const nn = nk + (nOn ? RAFT_MARK : "")
        const f = raftFactor(cur, n) // the raft's price is the step's, not the tile's — off the memo
        const e = [top[0] + pr[0] * f, top[1] + pr[1] * f, top[2] + (Hex.distance(cur, n) > 1 ? 1 : 0)]
        const nb = best.get(nn)
        if (!nb || ROUTE_CMP(e, [nb.charge, nb.cost, nb.leaps]) < 0) {
          best.set(nn, { charge: e[0], cost: e[1], leaps: e[2], prev: node, at: n, prevAt: cur, on: nOn })
          q.push([e[0], e[1], e[2], nn])
          up(q.length - 1)
        }
      }
    }
    reachCache = { stamp: worldStamp, from: fk, map: best }
    return best
  }
  // …the two readings of a tile in that map (afloat / on foot), best first —
  // except aboard: water goes by water, the raft along, whenever that way and
  // the way home by water fit the day; it walks only when the walk fits and
  // the sail doesn't
  const reachAt = t => {
    const m = reachMap()
    const a = m.get(key(t))
    const w = m.get(key(t) + RAFT_MARK)
    if (!a) return w || null
    if (!w) return a
    if (aboard()) {
      const fits = e => e.charge + (e.on ? riverReserve(t) : returnVia(t, e.prevAt, false)) <= timeLeft()
      return fits(w) || !fits(a) ? w : a
    }
    return ROUTE_CMP([w.charge, w.cost, w.leaps], [a.charge, a.cost, a.leaps]) < 0 ? w : a
  }

  // The ONE rule: you may go anywhere you can afford to reach AND still walk home
  // from — cost there + the reserve back within the time left. No position state,
  // no "exhausted" lock; when only homeward steps fit the budget, this alone
  // leaves them as the only legal moves. Never-strandable, and tight.
  function canMove(target) {
    if (!Array.isArray(target) || !onMap(target) || !isDiscovered(target)) return false
    const e = reachAt(target)
    if (!e) return false
    // in the water the reserve is priced by how you'd be there: afloat, it's the
    // way home BY WATER (the raft is under you); on foot, the step back onto the
    // bank you'd have come from. A LAND target prices home off the route itself
    // (landBack): a route that rides the raft moves the mooring, and the way
    // back is through where it ends up, not through today's reserveMap.
    const back = navWater(target)
      ? e.on
        ? riverReserve(target)
        : returnVia(target, e.prevAt, false) // the reach map says you'd arrive RAFTLESS — price the wade, never the sail
      : landBack(target, routeTo(target))
    return e.charge + back <= timeLeft()
  }

  const canScout = target => isFrontier(target) && scoutChargeAt(target) + returnCost() <= timeLeft()

  // Reserve needed to get home AFTER entering the tile under the player.
  function enterReturn() {
    const b = boardOf(view().player)
    const child = b && b.node && b.node.children[key(b.local)]
    if (child && child.safe) return 0
    let c = 0
    for (let j = 0; j < stack.length; j++) {
      c += (stack[j].trail.length - 1) * (stack[j].cost * MOVE_COST)
      if (j > BASE_DEPTH) c += stack[j - 1].cost * MOVE_COST
    }
    c += view().cost * MOVE_COST // climbing back out of the tile we enter
    return c
  }

  const canEnter = () =>
    depth() < MAX_DEPTH && !!boardOf(view().player) && !eq(view().player, view().entry) && enterReturn() <= timeLeft()

  // Undiscovered tiles adjacent to WHERE YOU SIT that you can afford to scout.
  function reachableDots() {
    const dots = new Set()
    for (const n of sightNeighbors(view().player)) {
      if (!isDiscovered(n) && canScout(n)) dots.add(key(n))
    }
    return dots
  }

  // A caller-supplied route (a walk back over your own steps, or any routed path)
  // is valid when it starts at the player, steps only between walkable neighbours
  // over discovered ground, and leaves the reserve intact — replay re-validates
  // it like a live click.
  function viaValid(via, target) {
    if (!Array.isArray(via) || via.length < 2) return false
    if (!eq(via[0], view().player) || !eq(via[via.length - 1], target)) return false
    // walk the route the way the move itself will, carrying the raft along the
    // water: what a step may do depends on where the raft is BY THEN
    let rp = raft
    for (let i = 1; i < via.length; i++) {
      if (!isDiscovered(via[i])) return false
      const here = via[i - 1]
      const afloat = rp && eq(rp, here)
      const from = i > 1 ? via[i - 2] : cameFrom()
      const ok = afloat ? walkNeighbors(here).some(n => eq(n, via[i])) : moveNeighbors(here, from).some(n => eq(n, via[i]))
      if (!ok) return false
      if (afloat && navWater(via[i])) rp = via[i] // the raft comes along
    }
    const afloatAtEnd = rp && eq(rp, target)
    const back = navWater(target)
      ? afloatAtEnd
        ? riverReserve(target)
        : returnVia(target, via[via.length - 2], false) // the via ends raftless — price the wade, never the sail
      : landBack(target, via) // a route that rode the raft prices home through its new mooring
    if (pathCharge(via) + back > timeLeft()) return false
    return true
  }

  // ── mutations (internal — only apply/dispatch reach these) ──────
  // Entering a different board is part of an ordinary step: the parent trail
  // extends/retraces, the parent tile becomes discovered, the bookkeeping
  // (current board node, camera anchor) follows. The global trail is untouched.
  function parentStep(c) {
    const parent = parentOf()
    journalDiscover(key(c), depth() - 1) // stepping into it discovers it at the parent scale
    if (c[0] || c[1]) note("board") // …and the first board that isn't home
    parent.trail.push(c) // full record at the parent scale too — no elastic erase
    parent.player = c.slice()
    const top = view()
    top.tile = childAt(parent.tile, key(c))
    top.key = key(c)
  }

  function stepOnto(g) {
    const v = view()
    // THE RAFT COMES ALONG ON THE WATER, and is left behind on land: navigating
    // river → river carries it; stepping ashore moors it where you set off from,
    // against the bank you stepped onto.
    if (raft && eq(raft, v.player)) {
      if (navWater(g)) {
        raft = g.slice()
        raftShore = null
        worldStamp++ // where the raft is moored IS the movement graph — re-price everything
      } else raftShore = g.slice()
    }
    v.trail.push(g) // the trail is a full record of the day's walk — backtracking appends, never erases
    energy -= stepChargeAt(g) * raftFactor(v.player, g) // flat COST_BASE inside a safe board, biome cost outside; a raft's step its own
    v.player = g
    const b = boardOf(g)
    if (b && !eq(b.c, parentOf().player)) parentStep(b.c)
    // this traversal paid full (charged above); the wear cheapens the NEXT one.
    // Home is flat (freeAt) and centres are rest spots — neither wears.
    // ONLY NOVEL GROUND TRAINS TRAVEL (RULES 26): the step practices the skill
    // only when it lands on wear-eligible ground being worn for the FIRST time —
    // exploration teaches; the daily commute over your own trails, home's flat
    // paths and the rivers teach nothing. (Moving is the commonest action —
    // ungated it outgrew every other skill.) The display replay wears as it
    // re-walks (journalWorn), so this gate reads the same on both paths.
    if (b && !freeAt(g) && !isCentre(g)) {
      if (!wornAt(g)) practiced.move = (practiced.move || 0) + 1 // novel — the step trains travel
      journalWorn(key(g))
    }
    if (b && isCentre(g) && (b.c[0] || b.c[1])) centred = true // a centre that isn't home's
    markReachedEdges()
    openGateIfDue() // …and arriving on the doorstep of a board you have cleared opens it
  }

  // Standing beside the river reaches those edges — a permanent ratchet.
  function markReachedEdges() {
    const b = boardOf(view().player)
    if (!b || !b.node) return
    for (const d of DIRS) {
      const n = [b.local[0] + d.q, b.local[1] + d.r]
      if (Hex.length(n) === RIVER_RING && isRiverHex(n)) {
        const lobes = riverLobesOf(n)
        if (lobes.length === 1) journalReach(b.node, lobes[0])
      }
    }
  }

  // Bank the day just walked as the ghost trail — the full breadcrumb, captured
  // before a day-advance resets it, so the next day can show it faintly to retrace.
  const bankGhost = () => {
    dayGhost = view().trail.map(t => t.slice())
  }

  // Rest — a deliberate action at the centre special tile: refill, bank the
  // day, start the next.
  function doRest(wake) {
    bankGhost()
    const v = view()
    const slept = minuteOfDay() // the minute you lay down, before the refill moves the clock
    energy = dailyBudget()
    v.trail = [v.player.slice()]
    sleep(wake, slept)
  }

  // Scout: reveal an adjacent undiscovered tile without moving — board land
  // and river alike, one ground, same action, same rates.
  function doScout(target) {
    energy -= scoutChargeAt(target)
    practiced.scout = (practiced.scout || 0) + 1 // the scout trains scouting — counted AFTER pricing
    journalDiscover(key(target))
  }
  // THE CLEARS COUNT AS ONE SCOUT (RULES 72): the cheapest tile you could scout
  // from where you stand is scouted first, priced, trained and written down as
  // any scout is, so what a scout sets going still happens (day one's minute
  // runs out and the dream is met). Nothing left to scout, nothing is counted.
  function firstScout() {
    const first = sightNeighbors(view().player)
      .filter(canScout)
      .sort((p, q) => scoutChargeAt(p) - scoutChargeAt(q))[0]
    if (!first) return
    note("scout")
    doScout(first)
  }

  // ── gather / craft / build ──────────────────────────
  // What the tile under your feet yields: its biome's SET (BIOME_YIELD).
  // Centres, roads and anything off-board give nothing — and NEITHER does the
  // home board: its tiles are the identity/minimap, not land (same rule as
  // landAt), so their hidden terrain is never surfaced as a harvest. You
  // gather out in the real world, past the river.
  // ── forage NODES: not every biome tile yields. Whether a tile is a node
  // for each of its biome's resources is a DETERMINISTIC draw from the world key + coord —
  // the same world always forages the same, replay-safe. Density per
  // resource sets the rarity (plants common, metal a rare find). Biome
  // frequency × node density is the scarcity: some boards are bare of a
  // given resource by design; reach (camps) covers the gaps, not a floor.
  // A keyless dev world yields everywhere (keeps keyless play/tests simple).
  const nodeSeed = worldKey ? parseInt(worldKey.slice(0, 8), 16) >>> 0 : 0
  const isNode = (g, res) => {
    if (!worldKey) return true
    let x =
      (nodeSeed ^ Math.imul(g[0] | 0, 374761393) ^ Math.imul(g[1] | 0, 668265263) ^ Math.imul(RES_SALT[res], 2246822519)) | 0
    x = Math.imul(x ^ (x >>> 15), 2246822519)
    x = Math.imul(x ^ (x >>> 13), 3266489917)
    x = (x ^ (x >>> 16)) >>> 0
    return x / 4294967296 < NODE_DENSITY[res]
  }
  // REAL LAND UNDERFOOT — the biome of the tile you're on, or null if it
  // isn't land at all: off-board (river), a board CENTRE (the board's own tile,
  // not land), or anywhere on HOME (its tiles are the identity/minimap — each
  // one refers to a whole board). The same three rules the public `landAt`
  // query applies, without building the whole fact card. Everything that has
  // to happen SOMEWHERE reads this: gathering, crafting (the recipe's biome)
  // and building.
  const landTypeAt = g => {
    const b = boardOf(g)
    if (!b || isCentre(g)) return null
    if (b.c[0] === 0 && b.c[1] === 0) return null // home is the minimap, not land
    return typeNameAt(g)
  }
  // ── streams ─────────────────────────────────────────
  // A STREAM runs along tile EDGES, corner to corner, from a board's highest
  // mountain tile down to its river — through every lake on the board lower
  // than where it rises, highest first: it runs into a lake and on out of it
  // from anywhere on the shore. It is at least STREAM_MIN edges long, taking
  // a detour where the way down is shorter. It goes downhill: every point of
  // height it has to climb costs STREAM_UPHILL steps, so it climbs only when
  // there is no way round, and otherwise takes the shortest way. It runs only
  // between two dry tiles of its board, and never over itself. A board with
  // no mountain has no stream. Home has no elevation: its stream runs from the
  // centre to the doorstep and meets the river at the gate. Pure from the
  // world — derived, never stored. A corner is the three tiles around it; an
  // edge the two.
  const STREAM_UPHILL = 8
  const STREAM_MIN = 3
  const cornerKey = ts => ts.map(key).sort().join("|")
  const edgeKey = (a, b) => [key(a), key(b)].sort().join("|")
  const cornersOf = t => DIRS.map((d, i) => [t, [t[0] + d.q, t[1] + d.r], [t[0] + DIRS[(i + 1) % 6].q, t[1] + DIRS[(i + 1) % 6].r]])
  const brookCache = new Map()
  const brookOf = c => {
    const ck = depth() + ":" + key(c)
    let out = brookCache.get(ck)
    if (out) return out
    out = { edges: new Set() }
    brookCache.set(ck, out)
    if (depth() <= BASE_DEPTH || !boardInfo(c)) return out
    const centre = boardCentre(c)
    const home = !c[0] && !c[1]
    const mine = t => {
      const b = boardOf(t)
      return !!b && eq(b.c, c)
    }
    const isLake = t => mine(t) && !isCentre(t) && typeNameAt(t) === "water"
    const dry = t => mine(t) && !isLake(t)
    const tiles = Hex.range(RINGS).map(l => [centre[0] + l[0], centre[1] + l[1]]).filter(mine)
    // where it may rise: home's centre, or the board's mountains, highest first
    const srcs = home
      ? [centre]
      : hasTerrain
        ? tiles.filter(t => !isCentre(t) && ["mountain", "peak", "cliff"].includes(typeNameAt(t))).sort((a, b) => combinedAt(b) - combinedAt(a))
        : []
    // the board's lakes: its water tiles, joined where they touch
    const lakes = []
    const inLake = new Set()
    for (const t of tiles) {
      if (!isLake(t) || inLake.has(key(t))) continue
      const lake = new Set([key(t)])
      inLake.add(key(t))
      for (const q of lake) // a Set's loop takes in what it gains on the way
        for (const n of Hex.neighbors(Hex.fromKey(q)))
          if (isLake(n) && !inLake.has(key(n))) {
            inLake.add(key(n))
            lake.add(key(n))
          }
      lakes.push(lake)
    }
    // home's stream is the gate's: it ends on the doorstep, at the river past it
    const door = home ? [centre[0] + Hex.fromKey(gateEdge.k)[0], centre[1] + Hex.fromKey(gateEdge.k)[1]] : null
    const gateRiver = door ? [door[0] + DIRS[gateEdge.side].q, door[1] + DIRS[gateEdge.side].r] : null
    const heightOf = ts => {
      if (home) return 0
      const own = ts.filter(mine)
      return own.reduce((a, t) => a + combinedAt(t), 0) / (own.length || 1)
    }
    const real = ts => ts.every(onMap)
    const atMouth = ts => ts.some(isRiver) && (!home || ts.some(t => eq(t, door)))
    // One leg, Dijkstra over (corner, edges so far up to STREAM_MIN): from the
    // `from` corners to the first corner `arrived` accepts, never into a corner
    // of an earlier leg or back over its own way. Returns the corners.
    const leg = (from, arrived, count0, used) => {
      const dist = new Map()
      const prev = new Map()
      const tilesAt = new Map()
      const open = []
      const sk = (k, n) => k + "#" + n
      for (const ts of from) {
        const k = cornerKey(ts)
        const s0 = sk(k, count0)
        dist.set(s0, 0)
        tilesAt.set(s0, ts)
        open.push(s0)
      }
      const done = new Set()
      while (open.length) {
        open.sort((a, b) => dist.get(a) - dist.get(b) || (a < b ? -1 : 1))
        const s0 = open.shift()
        if (done.has(s0)) continue
        done.add(s0)
        const ts = tilesAt.get(s0)
        const n0 = +s0.slice(s0.lastIndexOf("#") + 1)
        if (arrived(ts, n0)) {
          const path = []
          for (let x = s0; x; x = prev.get(x)) path.unshift(tilesAt.get(x))
          return path
        }
        const onWay = new Set()
        for (let x = s0; x; x = prev.get(x)) onWay.add(cornerKey(tilesAt.get(x)))
        const h = heightOf(ts)
        for (let i = 0; i < 3; i++) {
          const [a, b, far] = [ts[i], ts[(i + 1) % 3], ts[(i + 2) % 3]]
          if (!dry(a) || !dry(b)) continue // it runs between two dry tiles
          const nts = [a, b, [a[0] + b[0] - far[0], a[1] + b[1] - far[1]]] // across edge a–b
          const nk = cornerKey(nts)
          if (!real(nts) || used.has(nk) || onWay.has(nk)) continue
          const ns = sk(nk, Math.min(STREAM_MIN, n0 + 1))
          if (done.has(ns)) continue
          let step = 1 + STREAM_UPHILL * Math.max(0, heightOf(nts) - h)
          if (home && atMouth(nts) && !nts.some(t => eq(t, gateRiver))) step += 0.5 // the gate's own edge, where it can
          const nd = dist.get(s0) + step
          if (dist.has(ns) && dist.get(ns) <= nd) continue
          dist.set(ns, nd)
          prev.set(ns, s0)
          tilesAt.set(ns, nts)
          open.push(ns)
        }
      }
      return null
    }
    // the whole run from one source: into each lower lake in turn, then out
    // to the river — a lake it can't reach, or couldn't get back out of to
    // the river (a pocket against the void), is passed by
    const shoreOf = lake => {
      const out2 = []
      for (const lk of lake) for (const ts of cornersOf(Hex.fromKey(lk))) if (real(ts)) out2.push(ts)
      return out2
    }
    const run = src => {
      const used = new Set()
      const legs = []
      let from = cornersOf(src).filter(real)
      let count = 0
      const toMouth = (ts, n) => n >= STREAM_MIN && atMouth(ts)
      const take = path => {
        legs.push(path)
        for (const ts of path) used.add(cornerKey(ts))
        count = Math.min(STREAM_MIN, count + path.length - 1)
      }
      const lower = lakes
        .map(lake => ({ lake, h: [...lake].reduce((a, lk) => a + combinedAt(Hex.fromKey(lk)), 0) / lake.size }))
        .filter(l => l.h < combinedAt(src))
        .sort((a, b) => b.h - a.h)
      for (const { lake } of lower) {
        const path = leg(from, ts => ts.some(t => lake.has(key(t))), count, used)
        if (!path) continue
        // …and out again from anywhere on its shore, where the way in arrived too
        const used2 = new Set(used)
        for (const ts of path) used2.add(cornerKey(ts))
        const from2 = [path[path.length - 1], ...shoreOf(lake).filter(ts => !used2.has(cornerKey(ts)))]
        if (!leg(from2, toMouth, Math.min(STREAM_MIN, count + path.length - 1), used2)) continue
        take(path)
        from = from2
      }
      const last = leg(from, toMouth, count, used)
      if (!last) return null
      take(last)
      return legs
    }
    let legs = null
    for (const src of srcs) if ((legs = run(src))) break
    if (!legs) return out
    for (const path of legs)
      for (let i = 1; i < path.length; i++) {
        const [x, y] = path[i].filter(t => path[i - 1].some(u => eq(u, t)))
        out.edges.add(edgeKey(x, y))
      }
    return out
  }
  // which of a tile's six sides carry its board's stream, as DIR bits
  const streamBits = g => {
    const b = boardOf(g)
    if (!b) return 0
    const { edges } = brookOf(b.c)
    let bits = 0
    if (edges.size) for (let d = 0; d < 6; d++) if (edges.has(edgeKey(g, [g[0] + DIRS[d].q, g[1] + DIRS[d].r]))) bits |= 1 << d
    return bits
  }

  // ── forage & hunt (RULES 43) ────────────────────────
  // What this tile actually offers: the entries of its biome's set it is a
  // node for. FORAGE is taken by hand (gather); a HUNT needs a tool of the
  // kind the resource names on your back (hunt). Both are one TAKE: the
  // resource's minutes × the tool's speed × the verb's skill ease.
  const yieldsAt = g => {
    const land = isRiver(g) ? "river" : landTypeAt(g)
    if (!land) return []
    const set = BIOME_YIELD[land] || []
    // a stream along one of its sides brings the fish in
    const all = !set.includes("fish") && streamBits(g) ? [...set, "fish"] : set
    return all.filter(res => isNode(g, res))
  }
  const verbOf = res => (RESOURCES[res]?.hunt ? "hunt" : "gather")
  // the best tool of a KIND on your back — the lowest `speed` — or null
  const bestTool = kind => {
    let best = null
    for (const k in RECIPES) {
      const r = RECIPES[k]
      if (r.tool === kind && countOf(k) > 0 && (!best || r.speed < best.speed)) best = r
    }
    return best
  }
  const toolSpeed = kind => (kind ? (bestTool(kind)?.speed ?? 1) : 1)
  // …and the KEY of the one tool of a kind on your back (there is at most one — RULES 44)
  const carriedTool = kind => Object.keys(RECIPES).find(k => RECIPES[k].tool === kind && countOf(k) > 0) || null
  // any one of these tool KINDS on your back (a recipe's or a forage's `with`)
  const holdsAny = kinds => !kinds || kinds.some(k => !!bestTool(k))
  // what a recipe yields with the tools on your back: its number, or — where
  // the tool decides (`makes` a map of kind → yield) — the best held kind's;
  // holding none, the least it lists, which is what the bill promises
  const yieldOf = r => {
    if (typeof r.makes !== "object") return r.makes || 1
    const held = Object.keys(r.makes).filter(k => bestTool(k)).map(k => r.makes[k])
    return held.length ? Math.max(...held) : Math.min(...Object.values(r.makes))
  }
  // the tool a take can't happen without, when you haven't got one: a hunt's
  // tackle, or the tool a forage names (`with` — the first of them, by name)
  const lacksGear = res => {
    const d = RESOURCES[res]
    if (d?.hunt && !bestTool(d.hunt)) return d.hunt
    if (d?.with && !holdsAny(d.with)) return d.with[0]
    return null
  }
  const takeCostAt = (g, res) => {
    if (!yieldsAt(g).includes(res)) return Infinity
    const d = RESOURCES[res]
    return d.min * toolSpeed(d.hunt || d.tool) * (1 - skillOf(verbOf(res)) / 30)
  }
  // each resource is its own spot on a tile — picking the berries leaves the
  // nuts alone. A hunt comes back on its regrow clock; what you gather TIRES
  // (bareDays): it's back on the day its count allows, and the count it stands
  // at is its gathers less one for every full day it has sat back untouched.
  const regrowKey = (g, res) => key(g) + "|" + res
  const backDay = w => w.day + bareDays(w.n, skillOf("gather"))
  const spotCount = (g, res) => {
    const w = worked[regrowKey(g, res)]
    return w ? Math.max(0, w.n - Math.max(0, day - Math.max(backDay(w), w.day + 1))) : 0
  }
  const takeReadyAt = (g, res) => {
    if (verbOf(res) === "hunt") return worldMin() - (gatheredAt[regrowKey(g, res)] ?? -1e9) >= RESOURCES[res].regrow
    const w = worked[regrowKey(g, res)]
    return !w || day >= backDay(w)
  }
  // how far a picked yield is on its way back, 0..1 — null if never picked. A
  // gathered spot runs from the take to the morning of the day it's back.
  const regrowProgress = (g, res) => {
    const at = gatheredAt[regrowKey(g, res)]
    if (at == null) return null
    if (verbOf(res) === "hunt") return (worldMin() - at) / RESOURCES[res].regrow
    const w = worked[regrowKey(g, res)]
    const back = w ? (backDay(w) - 1) * 1440 : at
    return back <= at ? 1 : (worldMin() - at) / (back - at)
  }
  // FOOD IS TIME (RULES 37) — the nourishment of a kind, and what an eat of
  // `f` minutes would ACTUALLY add today: clipped by the daily ration cap and
  // by the day itself (the window can never outgrow the full day).
  const foodOf = k => itemDef(k).food || 0
  const eatBoostOf = f =>
    Math.max(0, Math.min(f, EAT_CAP - fed, FREE_CAP - ((dayStart ? dayStart.energy : SEED_MIN) + fed)))
  // THE POT (RULES 54): what a cook would make of `pot` ({ raw kind: units }) and
  // the first reason it can't — one reading for the kitchen's readout and the
  // cook action's own gate, so the two cannot disagree. null = not a pot at all.
  // A MEAL TAKES ONE OF EACH KIND: serving j is every kind the pot holds at
  // least j of, so 2 fish + 1 herbs is one `cooked fish + herbs` and one
  // `cooked fish` — more of a thing makes MORE MEALS, never a bigger one, and
  // every meal is a kind of its own with its worth on the kind.
  const cookPlan = pot => {
    const kinds = Object.keys(pot || {})
      .filter(k => pot[k] > 0)
      .sort()
    if (!kinds.length) return null
    if (!kinds.every(k => Number.isInteger(pot[k]) && RESOURCES[k]?.food > 0 && !RESOURCES[k].cooked)) return null // fire on RAW matter only
    const servings = Math.max(...kinds.map(k => pot[k]))
    const meals = []
    for (let j = 1; j <= servings; j++) {
      const k = dishOf(kinds.filter(x => pot[x] >= j))
      const m = meals.find(x => x.k === k)
      if (m) m.n++
      else meals.push({ k, n: 1 })
    }
    const cost =
      (COOK_MIN + COOK_KIND_MIN * (kinds.length - 1) + COOK_SERVING_MIN * (servings - 1)) * (1 - skillOf("cook") / 30) // eased like gathering — half at 15
    const burn = fuel > 0 ? 0 : COOK_FUEL // the fire wants fuel only once the last one's cooks are spent
    // THE BILL, read as a craft's is (RULES 72): the pot and the fire's fuel come
    // off the ground at your feet first, then off your back. `offPack` is kind →
    // units off your back.
    const g = view().player
    const needs = Object.fromEntries(kinds.map(k => [k, pot[k]]))
    if (burn) needs[FUEL] = burn
    const offPack = {}
    let off = 0
    for (const k in needs) {
      offPack[k] = Math.max(0, needs[k] - pileAt(g, k))
      off += offPack[k] * itemWeight(k)
    }
    const short = kinds.filter(k => atHand(k) < pot[k])
    // THE MEALS LAND ON YOUR BACK WHILE THEY FIT — and still leave the way home
    // at that load — AND AT YOUR FEET WHEN THEY DON'T: `kept` is how many of
    // them you end up carrying, in the order they're listed
    const units = meals.flatMap(m => Array(m.n).fill(m.k))
    const load = loadOf()
    const base = returnCost() / loadFactor()
    let after = load - off
    let kept = 0
    while (kept < units.length) {
      const a = after + itemWeight(units[kept])
      const cap = carryCap()
      if (a > load && (a > cap || cost + base * (1 + Math.min(1, a / Math.max(1, cap))) > timeLeft())) break
      after = a
      kept++
    }
    const why = !restSpots.some(sp => eq(sp, g))
      ? "only at a hearth"
      : kinds.length > skillOf("cook")
        ? `needs cook ${kinds.length}`
        : servings > COOK_SERVINGS
          ? `skewers take ${COOK_SERVINGS} of a kind`
          : short.length
            ? `needs ${short.map(k => `${pot[k] - atHand(k)} more ${k}`).join(" · ")}`
            : atHand(FUEL) < burn
              ? `needs ${burn - atHand(FUEL)} more ${FUEL}`
              : kept < units.length && !stashKeyAt(g)
                ? "pack full"
                : cost + returnCost() > timeLeft()
                  ? "not enough time left"
                  : null
    return { kinds, servings, meals: meals.map(m => ({ ...m, ...itemDef(m.k) })), cost, burn, fuel, needs, offPack, kept, why }
  }
  const consume = (k, n) => {
    const drop = new Set(
      freshOf(k)
        .sort((a, b) => a.at - b.at)
        .slice(0, n)
    )
    inventory[k] = (inventory[k] || []).filter(x => !drop.has(x))
    if (!inventory[k].length) delete inventory[k]
  }
  const addItem = k => {
    ;(inventory[k] = inventory[k] || []).push({ at: worldMin() })
  }
  // pull the OLDEST fresh instance of k off your back (keeps its age/wear),
  // returning it — for stashing or discarding
  const takeInstance = k => {
    const fresh = freshOf(k).sort((a, b) => a.at - b.at)
    if (!fresh.length) return null
    const inst = fresh[0]
    inventory[k] = inventory[k].filter(x => x !== inst)
    if (!inventory[k].length) delete inventory[k]
    return inst
  }
  // WHAT YOU PUT DOWN STAYS PUT (RULES 29, 2026-08-02 — supersedes "dropping
  // outside loses it for good"). Every tile is a storage cell: drop something
  // and it lies there, on that exact tile, until someone picks it up. Keyed by
  // GLOBAL coord, so it works the same on a board, on a river, anywhere — which
  // is what ferrying a bill needs (carry materials to a river tile, leave them,
  // come back with more). A cell holds as many kinds as you put there.
  const stashKeyAt = g => (onMap(g) ? key(g) : null)
  // how many of `item` lie on the tile underfoot, and spending them.
  // A BILL OF MATERIALS FOR WORK DONE ON THE SPOT (raft, bridge). It counts what
  // you CARRY and what LIES AT YOUR FEET alike: a raft's bill outweighs a base
  // pack, so you ferry it to the water over several trips and build from the heap
  // you made there. Spent ground-first, so the load you just put down goes before
  // the one still on your back.
  const atHand = k => countOf(k) + pileAt(view().player, k)
  const hasAll = needs => Object.keys(needs).every(k => atHand(k) >= needs[k])
  const spendAll = needs => {
    for (const k in needs) {
      const fromGround = Math.min(needs[k], pileAt(view().player, k))
      if (fromGround) spendPile(view().player, k, fromGround)
      if (needs[k] > fromGround) consume(k, needs[k] - fromGround)
    }
  }
  // …and what's still missing, kind → how many short (empty = you have it all)
  const shortOf = needs => {
    const out = {}
    for (const k in needs) if (atHand(k) < needs[k]) out[k] = needs[k] - atHand(k)
    return out
  }
  // A CRAFT'S BILL (RULES 64, 66), read once for the action's gate and for the
  // menu's list, so the two cannot disagree. Its needs come off the GROUND
  // first and then off your back, as atHand counts them — except the tool an
  // upgrade replaces, which is always the one you hold. `offPack` is kind →
  // units off your back, `short` what is still missing.
  // WHAT IT MAKES LANDS ON YOUR BACK WHILE IT FITS — and still leaves the way
  // home at that load, priced as a take's is — AND AT YOUR FEET WHEN IT DOESN'T:
  // `kept` is how many of the yield you end up carrying. So a craft is never
  // refused for room, and the ground only ever helps: `late` is the day running
  // out at the load you already carry, and `full` only a tile that can hold nothing.
  const craftBill = r => {
    const g = view().player
    const have = r.tool ? carriedTool(r.tool) : null
    const offPack = {}
    const short = {}
    let off = 0
    for (const k in r.needs) {
      offPack[k] = k === have ? r.needs[k] : Math.max(0, r.needs[k] - pileAt(g, k))
      if (countOf(k) < offPack[k]) short[k] = offPack[k] - countOf(k)
      off += offPack[k] * itemWeight(k)
    }
    const load = loadOf()
    const base = returnCost() / loadFactor()
    const n = yieldOf(r)
    let after = load - off
    let kept = 0
    while (kept < n) {
      const a = after + (r.weight || 0)
      const cap = carryCap() + (r.carry || 0) * (kept + 1) // a basket makes its own room
      if (a > load && (a > cap || r.min + base * (1 + Math.min(1, a / Math.max(1, cap))) > timeLeft())) break
      after = a
      kept++
    }
    return { have, offPack, short, kept, full: kept < n && !stashKeyAt(g), late: r.min + returnCost() > timeLeft() }
  }
  const pileAt = (g, item) => {
    const sk = stashKeyAt(g)
    const s = sk && stash[sk]
    return (s && s[item] && s[item].length) || 0
  }
  const spendPile = (g, item, n) => {
    const sk = stashKeyAt(g)
    const s = sk && stash[sk]
    if (!s || !s[item]) return
    s[item].splice(0, n)
    if (!s[item].length) delete s[item]
    if (!Object.keys(s).length) delete stash[sk]
  }
  // A TAKE (gather or hunt) is legal when the tile offers the resource, the
  // verb matches (fish are never picked up by hand), it's back, the tool
  // is there for a hunt, the pack has room, and the reserve survives the
  // HEAVIER pack: the way home is re-priced at the post-pickup load (the load
  // factor scales every charged step uniformly, so the scaling is exact — and
  // conservative over the safe board's flat stretch).
  const canTake = (res, verb) => {
    const g = view().player
    if (!res || verbOf(res) !== verb || !yieldsAt(g).includes(res)) return false
    if (!takeReadyAt(g, res)) return false
    if (lacksGear(res)) return false // no tool, no catch
    const w = RESOURCES[res].weight
    if (loadOf() + w > carryCap()) return false // the pack is full
    const post = 1 + Math.min(1, (loadOf() + w) / Math.max(1, carryCap()))
    return takeCostAt(g, res) + (returnCost() / loadFactor()) * post <= timeLeft()
  }
  // a `gather` that names nothing (the logs before RULES 43) takes the first
  // forage the tile has ready
  const defaultTake = () => yieldsAt(view().player).find(res => verbOf(res) === "gather" && canTake(res, "gather")) || null
  function doTake(res, verb) {
    const g = view().player
    energy -= takeCostAt(g, res)
    if (verb === "gather") worked[regrowKey(g, res)] = { n: spotCount(g, res) + 1, day } // the spot's count as it stands, plus this one
    practiced[verb] = (practiced[verb] || 0) + 1 // the take trains its verb
    addItem(res)
    gatheredAt[regrowKey(g, res)] = worldMin() // a hunt's regrow clock starts now (and a gathered spot's ring runs from here)
    worldStamp++ // the pack changed: step costs, reserve and reach all move
  }

  // Descend into the tile under the player. (Not reachable in normal play
  // while the game lives at MAX_DEPTH — kept sane for the future.)
  function doEnter() {
    const b = boardOf(view().player)
    if (!b) return
    const child = childAt(childAt(parentOf().tile, key(b.c)), key(b.local))
    stack.push(frame(child, key(b.local), { cost: view().cost / SCALE_RATIO }))
    const cv = view()
    const centre = boardCentre([0, 0]) // the new level anchors its own plane
    const start = EDGE_CENTER[parity()][0]
    cv.entry = [centre[0] + start[0], centre[1] + start[1]]
    cv.player = cv.entry.slice()
    cv.trail = [cv.entry.slice()]
    journalDiscover(key(cv.entry))
  }

  // Our own safe space: the walled home board with its angle-seeded gate.
  function doEnterHome() {
    const v = view()
    const child = childAt(v.tile, key(v.player))
    child.safe = true
    stack.push(
      frame(child, key(v.player), {
        cost: v.cost / SCALE_RATIO,
        entry: [0, 0],
        player: [0, 0],
        trail: [[0, 0]]
      })
    )
    // Home sits at the global origin, so its board coords ARE global ones.
    const home = ground()
    home.discovered.add(key([0, 0])) // the centre special tile starts known (pre-day; not journaled)
    // Seal the board: every border hex walls its outward sides — including
    // the gate edge (the doorstep side the seed angle exits through), which
    // starts CLOSED. openGateIfDue clears that one bit when the board is
    // cleared. Walls are plain per-hex-side data; nothing here is home-only.
    if (!child.gate) {
      for (const t of Hex.ring([0, 0], RINGS)) {
        let bits = 0
        for (let d = 0; d < 6; d++) {
          if (Hex.length([t[0] + DIRS[d].q, t[1] + DIRS[d].r]) > RINGS) bits |= 1 << d
        }
        home.walls[key(t)] = bits
      }
      child.gate = { k: gateEdge.k, side: gateEdge.side }
    }
    worldStamp++
  }

  // Sleep: bank the day's actions (with the day-start snapshot they replay
  // from), advance the day, snapshot the new day's start.
  function sleep(wake, slept) {
    practiced.sleep = (practiced.sleep || 0) + 1 // every night trains dream — before the new day's start is taken
    if (log.length) history.push({ day, actions: log, start: dayStart })
    const { lo, hi } = wakeRange(slept)
    wakeAt = Math.max(lo, Math.min(hi, Math.round(wake ?? wakeAt))) // the chosen wake, or yesterday's, inside tonight's window
    day++
    fed = 0 // the second wind was today's — a new day starts on its own budget
    mealAt = wakeAt + HUNGER_MAX // …and wakes with the meal clock fresh
    log = []
    logMeta = []
    todayDiscovered = []
    todayReached = []
    todayWorn = []
    dayStart = snap()
  }

  // "Go home": collapse to the base, rest inside the home safe space, new day.
  // (A reliable way home regardless of energy — a gated ability later.)
  function goHomeRun() {
    bankGhost() // remember today's wander before we collapse home
    while (stack.length > BASE_DEPTH + 1) stack.pop()
    const base = view()
    base.player = base.entry.slice()
    base.trail = [base.entry.slice()]
    const slept = minuteOfDay()
    energy = dailyBudget()
    doEnterHome()
    sleep(undefined, slept)
  }

  // ── snapshots (how a day's start is remembered) ──────
  const snap = () => ({
    energy,
    fed,
    wakeAt,
    mealAt,
    day,
    learned: { ...learned },
    given: { ...given },
    practiced: { ...practiced },
    noted: { ...noted },
    fuel,
    inventory: Object.fromEntries(Object.entries(inventory).map(([k, arr]) => [k, arr.map(i => ({ ...i }))])),
    stash: Object.fromEntries(
      Object.entries(stash).map(([sk, s]) => [sk, Object.fromEntries(Object.entries(s).map(([k, arr]) => [k, arr.map(i => ({ ...i }))]))])
    ),
    bridges: [...bridges],
    raft: raft ? raft.slice() : null,
    raftShore: raftShore ? raftShore.slice() : null,
    centred,
    gatheredAt: { ...gatheredAt },
    worked: Object.fromEntries(Object.entries(worked).map(([k, w]) => [k, { ...w }])),
    camps: restSpots.slice(1).map(c => c.slice()),
    taught: Object.fromEntries(Object.entries(taught).map(([bk, sk]) => [bk, { ...sk }])),
    frames: stack.slice(1).map(f => ({
      key: f.key,
      isBase: f.isBase,
      entry: f.entry.slice(),
      player: f.player.slice(),
      trail: f.trail.map(t => t.slice()),
      cost: f.cost
    }))
  })

  function restore(s) {
    energy = s.energy
    fed = s.fed || 0
    wakeAt = s.wakeAt || 0
    mealAt = s.mealAt ?? wakeAt + HUNGER_MAX
    day = s.day
    learned = { ...(s.learned || {}) }
    given = { ...(s.given || {}) }
    practiced = { ...(s.practiced || {}) }
    noted = { ...(s.noted || {}) }
    fuel = s.fuel || 0
    inventory = Object.fromEntries(Object.entries(s.inventory || {}).map(([k, arr]) => [k, arr.map(i => ({ ...i }))]))
    stash = Object.fromEntries(
      Object.entries(s.stash || {}).map(([sk, st]) => [
        sk,
        // an OLD one-kind cell ({ item, arr }) reads as the single-kind map it was
        st.arr ? { [st.item]: st.arr.map(i => ({ ...i })) } : Object.fromEntries(Object.entries(st).map(([k, arr]) => [k, arr.map(i => ({ ...i }))]))
      ])
    )
    bridges = new Set(s.bridges || [])
    raft = s.raft ? s.raft.slice() : null
    raftShore = s.raftShore ? s.raftShore.slice() : null
    centred = !!s.centred
    gatheredAt = { ...(s.gatheredAt || {}) }
    worked = Object.fromEntries(Object.entries(s.worked || {}).map(([k, w]) => [k, { ...w }]))
    restSpots.length = 1
    for (const c of s.camps || []) restSpots.push(c.slice())
    taught = Object.fromEntries(Object.entries(s.taught || {}).map(([bk, sk]) => [bk, { ...sk }]))
    stack.length = 1
    for (const fs of s.frames) {
      const parent = stack[stack.length - 1]
      stack.push(
        frame(childAt(parent.tile, fs.key), fs.key, {
          isBase: fs.isBase,
          entry: fs.entry.slice(),
          player: fs.player.slice(),
          trail: fs.trail.map(t => t.slice()),
          cost: fs.cost
        })
      )
    }
  }

  // ── replay (display rewind; the ratchets never shrink for real) ──
  function beginReplay() {
    replaying = true
    replayWorn = [] // the re-walk's own wear, undone at endReplay
    for (const e of todayDiscovered) groundAt(e.d).discovered.delete(e.key)
    for (const r of todayReached) r.tile.reachedEdges.delete(r.i)
    for (const w of todayWorn) groundAt(w.d).worn[w.key] = (groundAt(w.d).worn[w.key] || 0) - 1 // rewind today's wear
    worldStamp++ // the rewind changed the walkable world under the caches
    restore(dayStart)
  }
  function endReplay() {
    for (const e of todayDiscovered) groundAt(e.d).discovered.add(e.key) // permanent
    for (const r of todayReached) r.tile.reachedEdges.add(r.i)
    for (const w of replayWorn) groundAt(w.d).worn[w.key] = (groundAt(w.d).worn[w.key] || 0) - 1 // undo the re-walk's wear, however far it got…
    replayWorn = []
    for (const w of todayWorn) groundAt(w.d).worn[w.key] = (groundAt(w.d).worn[w.key] || 0) + 1 // …and put the lived day's back
    worldStamp++
    replaying = false
  }

  // ── actions ──────────────────────────────────────────
  const ACTIONS = {
    move: {
      // legality is purely the reserve — reach + the way home within the budget
      can: a => (a.via ? viaValid(a.via, a.target) : canMove(a.target)),
      run: a => {
        const path = a.via || routeTo(a.target)
        // On a trusted reload, stamp the resolved route back onto the action so
        // it's recorded in the save — a via-move replays without routing, which
        // is what keeps load LINEAR. Legacy (via-less) saves self-heal here.
        if (loadingTrust && !a.via) a.via = path
        for (let i = 1; i < path.length; i++) stepOnto(path[i])
      }
    },
    scout: { can: a => canScout(a.target), run: a => doScout(a.target) },
    // BUILD THE RAFT — one, on the water you're standing in. This is what the
    // first real bill you pay in materials: not a crossing, a VEHICLE. It
    // moors where you leave it and only moves under you (see stepsFrom).
    //
    // PAID IN MATERIALS (RAFT_NEEDS), what you carry and what lies on this tile
    // alike — a bill heavier than your pack is ferried here over several trips
    // (see atHand) — AND IN MINUTES (RULES 38): lashing it together takes RAFT_MIN, guarded by the
    // reserve like every other timed work: the way home (still on foot — the
    // raft doesn't exist until the minutes are spent) must survive the spend.
    raft: {
      can: () =>
        !raft &&
        navWater(view().player) &&
        hasAll(RAFT_NEEDS) &&
        RAFT_MIN + returnCost() <= timeLeft(),
      run: () => {
        energy -= RAFT_MIN
        spendAll(RAFT_NEEDS)
        practiced.build = (practiced.build || 0) + 1 // the raft is a build, and trains it
        raft = view().player.slice()
        raftShore = null
        worldStamp++
      }
    },
    // BRIDGE the river you're standing in, to a LAND tile beside it — you pick
    // which one, and that choice is the crossing (permanent, both ways). A
    // bridge never lands on water: the far end is always a board tile. Timber
    // and cord off your back, and a morning's work — the heavy, permanent
    // answer to the raft. (No UI raises one yet; the rule and its price are here.)
    bridge: {
      can: a => {
        const p = view().player
        if (!isRiver(p) || !a.to || !onMap(a.to)) return false
        if (navWater(a.to) || !isDiscovered(a.to)) return false // land only — never water — and land you've seen
        if (!walkNeighbors(p).some(n => eq(n, a.to))) return false // adjacent, unwalled, walkable
        if (!cameFrom()) return false // you build it standing in the water, having waded in
        if (!hasAll(BRIDGE_NEEDS)) return false // the timber and the cord, on your back
        if (BRIDGE_MIN + returnCost() > timeLeft()) return false // …and a morning to spend on it
        return !hasBridge(p, a.to)
      },
      // A BRIDGE SPANS THE WATER: it joins the bank you waded in from to the
      // bank you chose, over the tile you're standing in. Both ends are
      // recorded, or crossing would be one-way — you'd get to the far side and
      // find the river offering only the way you'd just come.
      run: a => {
        const p = view().player
        energy -= BRIDGE_MIN
        spendAll(BRIDGE_NEEDS)
        bridges.add(bridgeKey(p, a.to))
        bridges.add(bridgeKey(p, cameFrom()))
        worldStamp++
      }
    },
    // DROP an item off your back onto the tile underfoot — one, or `n` of the
    // kind at once (oldest first). It STAYS there — any tile, anywhere — and
    // `take` picks it back up. A tile holds AS MANY KINDS as you put on it.
    // Free and instant.
    drop: {
      // NOTHING IS EVER LOST. A drop that has nowhere to land is REFUSED, so
      // the thing stays on your back — it never leaves the pack unless a tile
      // takes it. (This is what "dropping outside discards it" used to do
      // instead, and what made a drop on the home centre vanish: the centre
      // wasn't a cell, so the item came off your back and went nowhere.)
      can: a => {
        const n = a.n ?? 1
        if (!a.item || !Number.isInteger(n) || n < 1 || countOf(a.item) < n) return false
        return !!stashKeyAt(view().player) // this ground can hold anything, and any number of kinds
      },
      run: a => {
        const sk = stashKeyAt(view().player)
        if (!sk) return // can() has already vouched for it; belt and braces
        for (let i = 0; i < (a.n ?? 1); i++) {
          const inst = takeInstance(a.item)
          if (!inst) break
          const s = stash[sk] || (stash[sk] = {})
          ;(s[a.item] = s[a.item] || []).push(inst)
        }
        worldStamp++ // the pack and the tile both changed
      }
    },
    // TAKE one item back from the stash cell underfoot, if it fits the pack.
    take: {
      // a pile holds MANY KINDS now, so a take names one — and a bare take (every
      // log written before it did) means the first kind the cell holds. `n` takes
      // that many of it at once; one unless it says.
      can: a => {
        const sk = stashKeyAt(view().player)
        const s = sk && stash[sk]
        if (!s) return false
        const k = (a && a.item) || Object.keys(s)[0]
        const n = (a && a.n) ?? 1
        if (!k || !s[k] || !Number.isInteger(n) || n < 1 || s[k].length < n) return false
        return loadOf() + itemWeight(k) * n <= carryCap()
      },
      run: a => {
        const sk = stashKeyAt(view().player)
        const s = stash[sk]
        const k = (a && a.item) || Object.keys(s)[0]
        for (let i = 0; i < ((a && a.n) ?? 1); i++) (inventory[k] = inventory[k] || []).push(s[k].shift()) // oldest out first
        if (!s[k].length) delete s[k]
        if (!Object.keys(s).length) delete stash[sk]
        worldStamp++
      }
    },
    // FORAGE by hand, or HUNT with a tool — one take, two verbs, each training
    // its own skill (RULES 43). A gather without an item is a pre-43 log entry.
    gather: { can: a => canTake(a.item || defaultTake(), "gather"), run: a => doTake(a.item || defaultTake(), "gather") },
    hunt: { can: a => canTake(a.item, "hunt"), run: a => doTake(a.item, "hunt") },
    // EAT — food is time (RULES 37). A minute (EAT_MIN) to sit and eat the OLDEST
    // fresh instance; its nourishment joins today's waking window (fed), so
    // energy grows, the budget line grows with it, and the clock still only
    // runs forward. AND IT PUSHES THE MEAL CLOCK ON BY ITS OWN NOURISHMENT
    // (RULES 47, was a flat HUNGER_MAX restart): what a food is worth is what
    // it buys you — herbs hold hunger off for three minutes, a cooked hare for
    // forty-five, and nothing hands you a whole three hours for a scrap. The
    // push is the RAW nourishment, never the eatBoost: that one is clipped by
    // the day's ration cap, and pushing by a clipped nothing would strand you
    // hungry with food in the pack. A bite is always worth the sitting, so
    // `can` is the plain reserve guard — the way home must still fit what's
    // left once the sitting is paid and the nourishment banked. The sitting
    // itself is never held to the meal clock: eating is what pushes it.
    eat: {
      can: a => {
        if (!a.item || !countOf(a.item)) return false
        return EAT_MIN - eatBoostOf(foodOf(a.item)) + returnCost() <= energy
      },
      run: a => {
        takeInstance(a.item)
        const food = foodOf(a.item) // what it is WORTH — cooked or raw, the kind says
        const boost = eatBoostOf(food) // …and what of that today's window can still take
        energy -= EAT_MIN
        fed += boost
        energy += boost
        mealAt += food // the clock goes on by the food's own minutes, uncapped
        worldStamp++ // the pack got lighter: step costs, reserve and reach all move
      }
    },
    // COOK — fire on matter, AT A HEARTH (any resting place: the home centre
    // or a camp — a fire you rest by). The POT goes on (`a.pot`, raw kind →
    // units; see cookPlan) and comes off as MEALS, each a kind of its own that
    // carries its worth and its keeping (RULES 48). A FUEL BURNS FOR FUEL_COOKS
    // COOKS (RULES 57, 60): the fire takes one only when the last one's cooks are
    // spent, and every cook spends one of them. The pot and the fuel come off the
    // ground at your feet first, then off your back, and the meals land on your
    // back while they fit, at your feet when they don't (RULES 72, see cookPlan).
    // Costs minutes eased by the cook skill, and trains it — one cook, one
    // practice, however full the pot — the first SPACE-pillar transform.
    cook: {
      can: a => {
        const plan = cookPlan(a.pot)
        return !!plan && !plan.why
      },
      run: a => {
        const plan = cookPlan(a.pot) // read, like the meals, BEFORE anything is spent
        const g = view().player
        energy -= plan.cost
        practiced.cook = (practiced.cook || 0) + 1
        for (const k in plan.needs) {
          if (plan.needs[k] > plan.offPack[k]) spendPile(g, k, plan.needs[k] - plan.offPack[k])
          if (plan.offPack[k]) consume(k, plan.offPack[k])
        }
        if (plan.burn) fuel += FUEL_COOKS
        fuel -= 1
        // the instance is just a date — on your back while it fits, put down where you stand when it doesn't
        let i = 0
        for (const m of plan.meals)
          for (let j = 0; j < m.n; j++, i++) {
            if (i < plan.kept) addItem(m.k)
            else {
              const s = stash[stashKeyAt(g)] || (stash[stashKeyAt(g)] = {})
              ;(s[m.k] = s[m.k] || []).push({ at: worldMin() })
            }
          }
        worldStamp++ // the pot became meals — the load changed, so the caches must re-price
      }
    },
    // craft: YOU make it, anywhere (RULES 39) — home and the board centres
    // included. Your own craft level against the recipe's, your own minutes,
    // and the materials off the ground at your feet and then off your back;
    // what it makes lands on your back while it fits, at your feet when it
    // doesn't (RULES 64, 66 — see craftBill). It trains craft like every other
    // verb you perform. Only a recipe that names a `site` asks anything of the
    // ground under you.
    craft: {
      can: a => {
        const r = RECIPES[a.recipe]
        if (!r) return false
        if (skillOf("craft") < r.level) return false
        if (r.site && landTypeAt(view().player) !== r.site) return false // this one wants its ground
        const b = craftBill(r)
        // ONE OF A KIND (RULES 44): you carry one tool of a kind. An upgrade
        // consumes the one you hold (it sits in its needs); anything else that
        // would make a second is refused.
        if (b.have && !(r.needs[b.have] > 0)) return false
        if (Object.keys(b.short).length) return false
        if (!holdsAny(r.with)) return false // the tool it is worked with, held and not spent (RULES 56)
        return !b.full && !b.late
      },
      run: a => {
        const r = RECIPES[a.recipe]
        const g = view().player
        const b = craftBill(r) // read, like the yield, BEFORE anything is spent
        const n = yieldOf(r)
        energy -= r.min
        for (const k in r.needs) {
          if (r.needs[k] > b.offPack[k]) spendPile(g, k, r.needs[k] - b.offPack[k])
          if (b.offPack[k]) consume(k, b.offPack[k])
        }
        for (let i = 0; i < b.kept; i++) addItem(a.recipe)
        if (n > b.kept) {
          // …and what your back has no room for is put down where you stand
          const sk = stashKeyAt(g)
          const s = stash[sk] || (stash[sk] = {})
          for (let i = b.kept; i < n; i++) (s[a.recipe] = s[a.recipe] || []).push({ at: worldMin() })
        }
        practiced.craft = (practiced.craft || 0) + 1 // making trains the maker
        worldStamp++
      }
    },
    // build: raise a structure on the tile underfoot. The camp joins the
    // RESTING PLACES — the reserve anchors to it, and the day can end there.
    build: {
      can: a => {
        const b = BUILDS[a.what]
        if (!b || skillOf("build") < b.level) return false
        const g = view().player
        if (!landTypeAt(g)) return false // real land underfoot only (RULES 39: was gatherResAt, which
        //  silently demanded a forage NODE too — camps were pinned to nodes, never the intent)
        if (freeAt(g)) return false // home already rests you
        if (restSpots.some(s => eq(s, g))) return false // one camp per tile
        for (const k in b.needs) if (countOf(k) < b.needs[k]) return false
        return b.min + returnCost() <= timeLeft()
      },
      run: a => {
        const b = BUILDS[a.what]
        energy -= b.min
        for (const k in b.needs) consume(k, b.needs[k])
        restSpots.push(view().player.slice())
        practiced.build = (practiced.build || 0) + 1
        worldStamp++ // a new resting place: the reserve eases at once
      }
    },
    // A lesson: lessonTime(your level) minutes within a step of a teacher who
    // currently outranks you in that skill — one whole edge. Your level stops at
    // the teacher's: nobody teaches past what they know.
    learn: {
      can: a => {
        if (!STAT_NAMES.includes(a.skill)) return false
        const npc = teacherNear()
        if (!npc || npcSkill(npc, a.skill) <= skillOf(a.skill)) return false
        return lessonTime(skillOf(a.skill)) + returnCost() <= timeLeft()
      },
      run: a => {
        // one lesson fills one whole edge; its TIME rises with your level. The
        // teacher gate (can) stops you the moment you match their level, so a
        // lesson never carries you past what they knew. Below MASTERY the edge
        // is THEIRS, moved: the teacher drains by one.
        const npc = teacherNear()
        if (npcSkill(npc, a.skill) < MASTERY) {
          const bk = key(npc.board)
          taught[bk] = { ...(taught[bk] || {}), [a.skill]: ((taught[bk] || {})[a.skill] || 0) - 1 } // −1 edge OUT of their shape
        }
        energy -= lessonTime(skillOf(a.skill))
        learned[a.skill] = (learned[a.skill] || 0) + 1
      }
    },
    // Teaching: the mirror of a lesson. LESSON_COST minutes beside a figure you
    // OUTRANK in a skill — ONE EDGE moves from your shape to theirs: yours drains
    // by one (an empty shape gives up the level itself) unless you're at MASTERY
    // or above, where it's kept and only copied; theirs fills by one and
    // completes a level only when its shape closes. It now carries them ABOVE
    // their nature, all the way to SKILL_CAP — the end-game gift, and the only
    // way anyone in the world passes NPC_MAX. Selective by design: you give up
    // your own progress to lift theirs, and since you must outrank them first,
    // it can never hand you back a level you didn't grind yourself.
    teach: {
      can: a => {
        if (!STAT_NAMES.includes(a.skill)) return false
        const npc = teacherNear()
        if (!npc) return false
        if (skillOf(a.skill) <= npcSkill(npc, a.skill)) return false // must currently outrank them
        if (npcSkill(npc, a.skill) >= SKILL_CAP) return false // nothing left to give them
        return LESSON_COST + returnCost() <= timeLeft()
      },
      run: a => {
        const npc = teacherNear()
        energy -= LESSON_COST
        const bk = key(npc.board)
        taught[bk] = { ...(taught[bk] || {}), [a.skill]: ((taught[bk] || {})[a.skill] || 0) + 1 } // +1 edge INTO their shape
        if (skillOf(a.skill) < MASTERY) given[a.skill] = (given[a.skill] || 0) + 1 // −1 edge OUT of yours — the same edge, moved
      }
    },
    enter: { can: () => canEnter(), run: () => doEnter() },
    rest: {
      // any RESTING PLACE ends the day: the home centre, or a built camp —
      // but only after a day that HAPPENED (2026-08-10): with an empty log
      // there is nothing to sleep off and nothing to dream, and resting would
      // just burn the day for a fresh budget. Do something first.
      can: () => log.length > 0 && restSpots.some(s => eq(s, view().player)),
      run: a => doRest(a.wake) // `wake`: tomorrow's wake minute, chosen asleep (see wakeRange)
    },
    // Dev helper: reveal the whole current board at once — exactly as if every
    // hex had been scouted, so the gate condition applies normally: cleared from
    // anywhere but the doorstep, the board still waits for the walk. It counts
    // as ONE SCOUT, as clear map does (see firstScout); the rest comes free.
    // Logged, so replay reproduces it.
    clearBoard: {
      can: () => !!boardOf(view().player),
      run: () => {
        firstScout()
        const b = boardOf(view().player)
        const bite = biteOf(boardInfo(b.c))
        for (const h of Hex.range(RINGS)) if (!bite || !bite.has(key(h))) journalDiscover(key([b.centre[0] + h[0], b.centre[1] + h[1]]))
      }
    },
    // The whole-map sibling of clearBoard: every board of the parent field
    // (interior + its standing at the parent scale) and every river between
    // them. It counts as ONE SCOUT too (see firstScout); the rest comes free.
    clearMap: {
      can: () => true,
      run: () => {
        firstScout()
        let R = 0
        for (const { c: ph } of net.boards.values()) {
          journalDiscover(key(ph), depth() - 1)
          const centre = boardCentre(ph)
          const bite = biteOf(boardInfo(ph))
          for (const h of Hex.range(RINGS)) if (!bite || !bite.has(key(h))) journalDiscover(key([centre[0] + h[0], centre[1] + h[1]]))
          R = Math.max(R, Hex.length(centre))
        }
        for (const g of Hex.range(R + RINGS + 2)) if (isRiver(g)) journalDiscover(key(g))
      }
    },
    // Dev helper: one unit of every raw food, and the fuel for a fire, straight
    // onto your back whatever it weighs — so the kitchen can be looked at without
    // a week's foraging. AT A HEARTH ONLY: a pack that far over doubles every
    // step, and out in the world that could price the way home out of reach.
    // Free and logged, like the clears.
    stockPantry: {
      can: () => restSpots.some(s => eq(s, view().player)),
      run: () => {
        for (const k in RESOURCES) if (RESOURCES[k].food > 0 && !RESOURCES[k].cooked) addItem(k)
        for (let i = 0; i < COOK_FUEL; i++) addItem(FUEL)
        worldStamp++ // the pack changed: step costs, reserve and reach all move
      }
    },
    // Dev helper: stand a skill AT a level (PLAYER_START..SKILL_CAP), its shape
    // empty — the level's first edge still to earn. What practice and teaching
    // had moved is wiped with it, so the level lands exactly. Free and logged,
    // like the clears.
    setSkill: {
      can: a => STAT_NAMES.includes(a.skill) && Number.isInteger(a.level) && a.level >= PLAYER_START && a.level <= SKILL_CAP,
      run: a => {
        let edges = 0
        for (let l = PLAYER_START; l < a.level; l++) edges += edgesForLevel(l)
        for (const k in PRACTICE_SKILL) if (PRACTICE_SKILL[k] === a.skill) delete practiced[k]
        delete given[a.skill]
        learned[a.skill] = edges
        worldStamp++ // every cost a skill eases re-prices
      }
    },
    goHome: { can: () => true, run: () => goHomeRun() }
  }

  // WHAT AN ACTION DOES FOR THE FIRST TIME: its verb, whatever it does it to.
  // The dev helpers are not things you do, and write nothing of their own
  // (a clear's one scout writes the scout's).
  const FIRST_VERB = { move: "move", scout: "scout", gather: "gather", hunt: "hunt", eat: "eat", cook: "cook", craft: "craft", build: "build", drop: "drop", take: "take", learn: "learn", teach: "teach", raft: "build", bridge: "bridge", rest: "sleep", goHome: "sleep" }
  const noteFirsts = a => {
    if (FIRST_VERB[a.type]) note(FIRST_VERB[a.type])
  }
  // …and what an action leaves you in: no minutes left, or beside a figure
  // whose tile you've found (stepped up to or scouted from beside)
  const noteAfter = () => {
    if (timeLeft() <= 0) note("exhaustion")
    const npc = teacherNear()
    if (npc && isDiscovered(npc.pos)) note("figure")
  }

  // Validate + mutate, no logging — replay re-applies banked actions with this.
  function apply(action) {
    const h = ACTIONS[action.type]
    if (!h) return { ok: false, reason: "unknown action " + action.type }
    pruneSpoiled()
    if (!h.can(action)) return { ok: false, reason: action.type + " rejected" }
    noteFirsts(action)
    h.run(action)
    noteAfter()
    return { ok: true }
  }

  // Every state-changing action is recorded — including the day-enders (rest,
  // goHome): pushed BEFORE running, they bank themselves as their
  // day's last entry, which is what lets a save replay ACROSS days.
  const LOGGED = new Set([
    "move",
    "scout",
    "bridge",
    "raft",
    "gather",
    "hunt",
    "eat",
    "cook",
    "craft",
    "build",
    "drop",
    "take",
    "learn",
    "teach",
    "enter",
    "clearBoard",
    "clearMap",
    "setSkill",
    "stockPantry",
    "rest",
    "goHome"
  ])

  // Validate + log + mutate — the one door live play goes through. The entry
  // is pushed BEFORE running so a day-ending move banks itself with its day.
  function dispatch(action) {
    if (replaying) return { ok: false, reason: "replaying" }
    const h = ACTIONS[action.type]
    if (!h) return { ok: false, reason: "unknown action " + action.type }
    pruneSpoiled()
    if (!h.can(action)) return { ok: false, reason: action.type + " rejected" }
    if (LOGGED.has(action.type)) log.push(action)
    const e0 = energy
    const f0 = fed
    noteFirsts(action)
    h.run(action)
    noteAfter()
    // display-only metadata: what the entry charged, index-aligned with the
    // log. DERIVED, never serialized — replay is the source of truth. (A
    // day-ender empties the log as it runs, so it never gets a meta row.)
    // Measured as the SPENT-TODAY delta — charge minus any window growth — so
    // an eat reads as its sitting minutes, not as negative time.
    if (log.length && log[log.length - 1] === action) logMeta.push(e0 - energy + (fed - f0))
    return { ok: true }
  }

  // ── persistence (the save IS the log — see DESIGN.md) ───────────────
  // Plain-JSON, no world state: banked day logs + today's partial log, plus
  // the version stamps that gate whether a replay still means what it meant.
  const serialize = () => ({
    app: "anon & mato",
    schema: SCHEMA,
    world: { angle, pubkey, worldKey, rings: RINGS, rules: RULES },
    days: history.map(h => ({ day: h.day, actions: h.actions })),
    today: { day, actions: log.slice() }
  })

  // The gate every load passes: a fresh sim, and version/world stamps that
  // still mean what the log meant. Returns a rejection, or null to proceed.
  function hydrateGate(save) {
    if (day !== 1 || log.length || history.length) return { ok: false, reason: "hydrate needs a fresh sim" }
    if (!save || save.schema !== SCHEMA) return { ok: false, reason: "schema mismatch" }
    const w = save.world || {}
    if (w.rules !== RULES) return { ok: false, reason: "rules mismatch" }
    if (w.angle !== angle || w.rings !== RINGS) return { ok: false, reason: "world mismatch" }
    if ((w.pubkey ?? null) !== pubkey) return { ok: false, reason: "identity mismatch" }
    if ((w.worldKey ?? null) !== worldKey) return { ok: false, reason: "world-key mismatch" }
    return null
  }

  // Rebuild a save by re-dispatching every action from day 1 on a FRESH sim —
  // full validation, the reference path (tests, and the strict fallback). Any
  // rejection means the save no longer replays under current rules.
  function hydrate(save) {
    const bad = hydrateGate(save)
    if (bad) return bad
    for (const d of save.days || []) {
      for (const a of d.actions) {
        const r = dispatch(a)
        if (!r.ok) return { ok: false, reason: `day ${d.day}: ${r.reason}` }
      }
    }
    if (save.today && save.today.day !== day) return { ok: false, reason: "day drift — truncated save?" }
    for (const a of save.today?.actions || []) {
      const r = dispatch(a)
      if (!r.ok) return { ok: false, reason: `today: ${r.reason}` }
    }
    return { ok: true }
  }

  // Apply a banked action WITHOUT re-deciding it. The log is already known-good
  // (it was validated when played, and hydrateGate rejects any rules drift), so
  // on reload we re-APPLY history instead of re-ROUTING it — no per-action
  // Dijkstra, so load stays linear in day count. Same run() as live play, so
  // the resulting state is identical; only the redundant `can` check is skipped.
  function trustApply(action) {
    const h = ACTIONS[action.type]
    if (!h) return { ok: false, reason: "unknown action " + action.type }
    pruneSpoiled()
    if (LOGGED.has(action.type)) log.push(action)
    const e0 = energy
    const f0 = fed
    try {
      noteFirsts(action)
      h.run(action)
      noteAfter()
    } catch (e) {
      return { ok: false, reason: `${action.type} threw: ${e && e.message}` }
    }
    if (log.length && log[log.length - 1] === action) logMeta.push(e0 - energy + (fed - f0))
    return { ok: true }
  }

  // The reload the game actually boots through: trusted (fast) replay, chunked
  // so the browser can paint a progress bar between batches. `onProgress(done,
  // total)` is awaited every `chunk` actions — the caller updates the loader and
  // yields a frame. Purity kept: no timers/DOM here; the caller owns the yield.
  async function hydrateProgressive(save, { onProgress = null, chunk = 60 } = {}) {
    const bad = hydrateGate(save)
    if (bad) return bad
    const total = (save.days || []).reduce((n, d) => n + d.actions.length, 0) + (save.today?.actions?.length || 0)
    let done = 0
    loadingTrust = true
    try {
      for (const d of save.days || []) {
        for (const a of d.actions) {
          const r = trustApply(a)
          if (!r.ok) return { ok: false, reason: `day ${d.day}: ${r.reason}` }
          if (++done % chunk === 0 && onProgress) await onProgress(done, total)
        }
      }
      if (save.today && save.today.day !== day) return { ok: false, reason: "day drift — truncated save?" }
      for (const a of save.today?.actions || []) {
        const r = trustApply(a)
        if (!r.ok) return { ok: false, reason: `today: ${r.reason}` }
        if (++done % chunk === 0 && onProgress) await onProgress(done, total)
      }
    } finally {
      loadingTrust = false
    }
    if (onProgress) await onProgress(total, total)
    return { ok: true }
  }

  // The YEAR'S CONSTELLATION — which of the 12 sky-skills rules the current month
  // (0..11), and its natural boost. Pure functions of the day counter, so they
  // replay for free and need no state.
  const seasonIndex = () => Math.floor((((day - 1) % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS / MONTH_DAYS)
  const seasonSkill = () => SKY_SKILLS[seasonIndex()]
  const seasonBoost = skill => (skill === seasonSkill() ? SEASON_BOOST : 0)
  const yearFrac = () => ((((day - 1) % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS) / YEAR_DAYS

  // The game opens inside the home safe space (the default view), and the
  // first day starts there. Home sits at the global origin.
  doEnterHome()
  dayStart = snap()

  return {
    // state
    view,
    depth,
    parentOf,
    root: () => stack[0].tile,
    ground: (d = depth()) => groundAt(d), // a depth's tile store: { discovered, walls, worn, types }, keyed by global coord
    energy: () => energy,
    timeLeft, // what you can still spend today: the budget, or the minutes until the next meal is due — whichever is less (RULES 42)
    hungerLeft, // minutes until the next meal is due
    mealDue, // …as a minute of the day (the clock's deadline pin binds to it)
    sleepLeft, // minutes until bed is due
    wakeAt: () => wakeAt, // the minute of the day you woke
    wakeRange: () => wakeRange(), // tonight's window for tomorrow's wake: { lo, hi }
    bedDue, // …as a minute of the day: WAKE_CAP after waking — the dial's third mark; nothing pushes it yet
    dayBudget: () => (dayStart ? dayStart.energy : SEED_MIN) + fed, // today's full window — what it began with plus what you've eaten into it
    nextBudget: () => dailyBudget(), // what the NEXT rest will grant (tiles found, floored & capped)
    tilesFound: () => tilesFound(), // discovered tiles (home included) feeding the budget
    day: () => day,
    seasonIndex, // 0..11 — which constellation/skill rules this month
    seasonSkill, // the skill in season now
    seasonBoost, // its natural lift (0 for out-of-season skills)
    yearFrac, // 0..1 progress around the year — turns the night sky
    angle: () => angle,
    pubkey: () => pubkey,
    worldKey: () => worldKey,
    heightAt: g => (hasTerrain ? combinedAt(g) : null), // 0..15 combined field — the renderer shades by it
    smoothAt: g => (hasTerrain ? smoothedAt(g) : null), // the smoothed field — water's shading reads from this
    // the board's MAIN land type — the most common biome across its 60 land
    // tiles (the centre isn't land); the trait the overviews report
    boardMainType: mainTypeOf,
    // a land tile's own facts (biome, elevation, its costs, what it yields) —
    // the inspected side of the menu, parallel to a figure's stats.
    // The board CENTRE is NOT land: a board is 60 land tiles + 1 centre — the
    // centre is the BOARD's own tile (its type and info are the board's), so
    // it gets no per-tile land facts. (Future candidate: the centre only
    // becomes available once the 60 around it are cleared.)
    // HOME tiles aren't land either: home is the identity/minimap — each tile
    // refers to a whole BOARD, so it shows no derived land type of its own.
    landAt: g => {
      const b = boardOf(g)
      if (!hasTerrain || !b) return null
      if (b.local[0] === 0 && b.local[1] === 0) return null // the centre is the board's tile, not land
      if (b.c[0] === 0 && b.c[1] === 0) return null // home tiles are the minimap, not land
      const biome = typeNameAt(g)
      const t = TILE_TYPES[biome] || TILE_TYPES.plain
      return {
        biome,
        elevation: elevationAt(g), // water's runs from 0 (the shore) down to −4 (the floor)
        move: Math.round(t.move * heightFactor(g) * 100) / 100, // the EFFECTIVE multiplier a step here pays
        scout: t.scout,
        // what the biome OFFERS (a tile's own nodes you learn by standing there)
        yields: (BIOME_YIELD[biome] || []).map(r => (RESOURCES[r].hunt ? `${r} (${RESOURCES[r].hunt})` : r)).join(" · ") || "—"
      }
    },
    npcAt,
    playerStats: () => (pubkey ? statsOf(pubkey) : null),
    skillOf,
    skillProgress, // { level, sides, filled, partial } — the shape the renderer fills
    skillMet, // practised or taught at least once — the menu shows only these
    lessonCost: skill => lessonTime(skillOf(skill)), // minutes the NEXT lesson costs (rises with level)
    npcSkill,
    npcProgress,
    learnable,
    // EVERYTHING YOU COULD MAKE IS LISTED — the menu's own rule (a category
    // that hides its contents can't teach them), so this returns every recipe
    // in the game with the FIRST reason it's out of reach, or null when it
    // isn't: `{ k, site, level, needs, offPack, short, cost, why }`. The menu
    // greys a row and prints its `why`; `cost` is the eased minutes for the
    // clock's estimate. `site` is null for a recipe you can make anywhere (the
    // crude tier, all of it) — the menu says "anywhere" rather than naming a
    // biome. `makes` is the yield with the tools you hold (a rock breaks into
    // three shards). `offPack` and `short` are the bill's own reading
    // (craftBill): what comes off your back once the ground has given what it
    // has, and what is still missing.
    craftList: () => {
      const here = landTypeAt(view().player)
      const aOrAn = k => `${/^[aeiou]/.test(k) ? "an" : "a"} ${k}`
      return Object.keys(RECIPES).map(k => {
        const r = RECIPES[k]
        const b = craftBill(r)
        const short = Object.keys(b.short)
        const why =
          skillOf("craft") < r.level
            ? `needs craft ${r.level}`
            : r.site && here !== r.site
              ? `only on ${r.site} land`
              : b.have && !(r.needs[b.have] > 0)
                ? `you already carry ${aOrAn(r.tool)}`
                : short.length
                  ? `needs ${short.map(n => `${b.short[n]} more ${n}`).join(" · ")}`
                  : !holdsAny(r.with)
                    ? `needs ${r.with.map(aOrAn).join(" or ")}`
                    : b.full
                      ? "pack full"
                      : b.late
                        ? "not enough time left"
                        : null
        return { k, site: r.site || null, level: r.level, needs: { ...r.needs }, offPack: b.offPack, short: b.short, makes: yieldOf(r), cost: r.min, why }
      })
    },
    // …and the same for BUILDS: what could be raised, and why not here.
    buildList: () => {
      const g = view().player
      return Object.keys(BUILDS).map(k => {
        const b = BUILDS[k]
        const short = Object.keys(b.needs).filter(n => countOf(n) < b.needs[n])
        const why =
          skillOf("build") < b.level
            ? `needs build ${b.level}`
            : !landTypeAt(g)
              ? "only on real land"
              : freeAt(g) || restSpots.some(s => eq(s, g))
                ? "you already rest here"
                : short.length
                  ? `needs ${short.map(n => `${b.needs[n] - countOf(n)} more ${n}`).join(" · ")}`
                  : b.min + returnCost() > timeLeft()
                    ? "not enough time left"
                    : null
        return { k, level: b.level, needs: { ...b.needs }, cost: b.min, why }
      })
    },
    gateDir: () => gateDir,
    typeNameAt,
    log: () => log,
    logMeta: () => logMeta,
    history: () => history,
    replaying: () => replaying,
    orient: () => orientOf(depth()),
    worldStamp: () => worldStamp, // display cache key: bumps only when the walkable world changes
    // the pack & the works
    // FRESH counts only (spoiled instances are gone), plus per-item detail
    // for the pack card: how many, and the soonest spoil (world-min from now)
    inventory: () => {
      const out = {}
      for (const k in inventory) {
        const n = countOf(k)
        if (n > 0) out[k] = n
      }
      return out
    },
    // FOOD IS TIME — what the menu lists. eatList: every edible kind on your
    // back with what a bite would ADD today (oldest instance's nourishment,
    // clipped by the caps). pantry: every RAW food on your back or at your feet, in the table's
    // own order (so a kitchen seat never moves), with how many — what the fire
    // could still do something with. cookPlan: what a pot of them would make.
    eatList: () =>
      Object.keys(inventory)
        .map(k => {
          const f = countOf(k) ? foodOf(k) : 0
          return f > 0 ? { k, food: eatBoostOf(f), meal: f, cost: EAT_MIN } : null // food: what it adds to today; meal: how far it pushes the meal clock
        })
        .filter(Boolean),
    pantry: () =>
      Object.keys(RESOURCES)
        .filter(k => RESOURCES[k].food > 0 && !RESOURCES[k].cooked && atHand(k) > 0) // the fire takes raw matter, never its own work
        .map(k => ({ k, n: atHand(k) })),
    cookPlan,
    fuel: () => fuel, // cooks left on the wood already burning
    fed: () => fed,
    packDetail: () => {
      const now = worldMin()
      return Object.keys(inventory)
        .map(k => {
          const fresh = freshOf(k)
          if (!fresh.length) return null
          const life = shelfOf(k)
          const spoilsIn = life === Infinity ? null : Math.max(0, Math.round(life - (now - Math.min(...fresh.map(i => i.at)))))
          return { k, n: fresh.length, spoilsIn }
        })
        .filter(Boolean)
    },
    loadOf,
    carryCap,
    preserve: () => preserveFactor(), // the shelf-life multiplier your storage grants
    // RIVERS: is this tile water, what does a bridge here reach, and which
    // land could one be built to from where you stand (the far bank included —
    // that's the point of building it)
    isRiver,
    navWater, // …or any board water: everything you may wade into and the raft may navigate
    flowAt, // a river tile's distance to the sea along the river — the current runs down it; null off the river
    inRiver: () => isRiver(view().player),
    onWater: () => navWater(view().player), // river OR board water — where you're in the water
    raftAt: () => (raft ? raft.slice() : null), // where the raft is moored, or null
    raftAtDayStart: () => (dayStart && dayStart.raft ? dayStart.raft.slice() : null), // …and where it was moored when today began
    raftShore: () => (raftShore ? raftShore.slice() : null), // the bank it lies against: the land you last stepped off it onto, or null
    raftShoreAtDayStart: () => (dayStart && dayStart.raftShore ? dayStart.raftShore.slice() : null), // …and as today began
    aboard, // …and whether you're standing on it
    // THE BUILD ON THE WATER, as the menu needs it: what a raft here would take
    // and what's actually lying underfoot. null on dry land — the only place the
    // question means nothing.
    shortOf: needs => shortOf(needs), // kind → how many short of a bill, what lies at your feet counted
    raftPlan: () => {
      const p = view().player
      if (!navWater(p)) return null
      return { needs: { ...RAFT_NEEDS }, short: shortOf(RAFT_NEEDS), built: !!raft, here: !!raft && eq(raft, p) }
    },
    hasBridge: (a, b) => hasBridge(a, b),
    bridges: () => [...bridges].map(bk => bk.split("|").map(k2 => k2.split(",").map(Number))),
    bridgeTargets: () => {
      const p = view().player
      if (!isRiver(p)) return []
      return walkNeighbors(p).filter(n => !navWater(n) && isDiscovered(n) && !hasBridge(p, n))
    },
    // storage: the stash on the tile underfoot (a home tile is a cell), plus
    // every stashed cell for the map — { item, n }
    canStash: () => !!stashKeyAt(view().player),
    notes: () => Object.entries(noted).map(([id, n]) => ({ id, ...n })), // every first, in the order it happened: { id, day, at, lore }
    // …as a LIST, one entry per kind lying here, in the order they were put down
    stashHere: () => {
      const sk = stashKeyAt(view().player)
      const s = sk && stash[sk]
      return s ? Object.keys(s).map(k => ({ item: k, n: s[k].length })) : null
    },
    // every pile in the world — `at` is the GLOBAL tile it lies on
    stashes: () =>
      Object.entries(stash).map(([sk, s]) => ({
        at: sk.split(",").map(Number),
        kinds: Object.keys(s).map(k => ({ item: k, n: s[k].length })),
        n: Object.values(s).reduce((a, arr) => a + arr.length, 0)
      })),
    camps: () => restSpots.slice(1).map(c => c.slice()),
    atRestSpot: () => restSpots.some(s => eq(s, view().player)),
    // WHAT THE TILE UNDERFOOT OFFERS, one row per yield — the ground row and
    // its hover labels read this: the verb (gather/hunt), the tool a hunt
    // wants, the eased minutes, and every reason it can't be taken right now.
    // null where nothing grows.
    gatherInfo: () => {
      const g = view().player
      const list = yieldsAt(g).map(res => ({
        res,
        verb: verbOf(res),
        tool: RESOURCES[res].hunt || null,
        cost: takeCostAt(g, res),
        ready: takeReadyAt(g, res),
        full: loadOf() + RESOURCES[res].weight > carryCap(),
        lacks: lacksGear(res) // the tool this hunt needs and you haven't got
      }))
      return list.length ? list : null
    },
    // every yield of a tile: { res, verb, tool, ready } — the raw list
    yieldsAt: g => yieldsAt(g).map(res => ({ res, verb: verbOf(res), tool: RESOURCES[res].hunt || null, ready: takeReadyAt(g, res) })),
    // a tile's forage at a glance, or null if nothing grows there: the first
    // yield, whether ANY of them is ready, and the slowest way back among the
    // ones you've picked (0..1). The map's gather mark reads this.
    gatherStateAt: g => {
      const ys = yieldsAt(g)
      if (!ys.length) return null
      let progress = 1
      for (const res of ys) {
        const p = regrowProgress(g, res)
        if (p != null) progress = Math.min(progress, p)
      }
      return { res: ys[0], ready: ys.some(res => takeReadyAt(g, res)), progress: Math.max(0, Math.min(1, progress)) }
    },
    // the regrow ring for ONE tile — { ready, progress } for the slowest of the
    // yields you've picked there, else null. Per-tile so the renderer can bake
    // it with the ground instead of sweeping every gathered tile each frame.
    regrowRingAt: g => {
      let progress = null
      for (const res of yieldsAt(g)) {
        const p = regrowProgress(g, res)
        if (p != null && (progress == null || p < progress)) progress = p
      }
      if (progress == null) return null
      return { ready: progress >= 1, progress: Math.max(0, Math.min(1, progress)) }
    },
    // every yield ever taken on ONE tile, gathered or hunted — [{ res, verb }].
    // The scout map's hover reads it.
    takenAt: g => yieldsAt(g).filter(res => gatheredAt[regrowKey(g, res)] != null).map(res => ({ res, verb: verbOf(res) })),
    canAct: a => !!ACTIONS[a.type] && !replaying && !!ACTIONS[a.type].can(a),
    // rules queries (all coordinates GLOBAL)
    onMap, // is this a tile of the map at all (board land or river)?
    boardHexOf,
    boardCentreOf,
    centreOf: c => boardCentre(c), // parent hex → its board's global centre (minimap detail)
    boards: () => net.order.map(c => c.slice()), // every board's parent cell, in crossing order from home
    boardInfo: c => boardInfo(c) || null, // { c, sides, gapDir, hops } — a pentagon's gapDir is the parent DIR its wedge faces
    tilesOf, // interior tiles a board has: 61, or 51 for a pentagon
    mapReach: () => Math.max(...net.order.map(c => Hex.length(boardCentre(c)))), // the farthest board centre, in tiles
    isDiscovered,
    discovered: () => [...ground().discovered].map(Hex.fromKey), // every tile found on this depth's lattice
    foundOn, // parent hex → the tiles found on that board (its centre included)
    isFrontier,
    canMove,
    canScout,
    canEnter,
    routeTo,
    pathCost,
    pathCharge,
    stepCost,
    stepCostAt,
    wornAt: g => wornAt(g), // times you've walked onto a tile (drives its wear discount)
    wearFactor: g => wearFactor(g), // the current step-cost multiplier from wear (1 → WEAR_FLOOR)
    scoutCost,
    scoutCostAt,
    scoutChargeAt,
    returnCost,
    returnFrom,
    // …and the reserve from a RIVER tile, which has none of its own: give the
    // bank you'd be leaving by (the one you waded in from, or a bridged one).
    // The UI hovering a river tile should ask this, with the route's last land
    // tile — returnFrom alone reads Infinity there, by design.
    returnVia,
    // …and the ready-made answer for a whole ROUTE: the reserve you'd be left
    // with on arriving by it, water and raft included. Preview code wants this
    // one, never returnFrom on the destination alone.
    retAfterPath,
    homePath,
    homePathFrom: (src, from = null) => homePathFrom(src, from), // the way home from a given tile (the ghost mid-move)
    prevTrail: () => dayGhost, // yesterday's full walked trail (the ghost), or null
    wallsAt: wallBits,
    streamAt: streamBits, // which sides of a tile its board's stream runs along, as DIR bits
    reachableDots,
    // actions
    dispatch,
    apply,
    beginReplay,
    endReplay,
    // persistence
    serialize,
    hydrate,
    hydrateProgressive
  }
}
