// The game, pure and headless.
//
// Everything anon & mato IS lives here: the world tree, energy, costs,
// discovery, the action log, day snapshots. No canvas, no DOM, no timers —
// this module runs in plain node (the tests do). Rendering and input live in
// render.js/grid.js and only ever call queries + dispatch.
//
// SPACE IS GLOBAL. Each depth level is one continuous lattice: boards (the
// children of the parent node, one per parent hex) separated by the one-tile
// SEAM — the parent grid's edges and vertices as walkable tiles. The player,
// the entry and the trail live in GLOBAL coordinates on that lattice; the
// "current board" is derived from where the player stands and only matters
// for costs bookkeeping and the camera. Crossing into another board is an
// ordinary step — nothing is translated, truncated or re-framed, ever.
//
// The action log is the design's centre of gravity: a day is a list of
// actions re-applied onto the day-start snapshot (the sim is deterministic).
// Live play, replay and future day-editing all flow through the same
// dispatch/apply pair — there is no second code path.

import { DIRS, makeTile, childAt } from "./world.js"
import * as Hex from "./hex.js"
import { sha256 } from "./vendor/sha256.js"
import { getPublicKey } from "./vendor/nostr-pure.js"

// ── tunables (the design is still settling — expect these to move) ──
export const RINGS = 4 // radius-4 hexagon = 61 tiles per board
export const SEED_ANGLE = 1 // the setup angle (dev fixture; later committed by the angle picker)
export const BASE_DEPTH = 1 // we START inside the home tile (depth 1); depth 0 is its outside/map view, gained later
export const MAX_DEPTH = 2 // base (1) → one level of tiles inside the home interior (2)
export const SEED_MIN = 1 // day-one floor: one minute — the bare minimum to take a single action before anything is discovered
export const ENERGY_START = 60 // the home board's 60 discoverable tiles — the budget earned by clearing home (reference; the daily budget is dynamic)
export const FREE_CAP = 1440 // a full day (24h) — the dial's whole turn
// ── PLAYER ENERGY (RULES 42): the body's two base needs, on top of the budget ──
// You must SLEEP at least SLEEP_MIN a day, so the waking window can never run
// past WAKE_CAP — the budget stops there, and so does what a meal can stretch
// it to. And you cannot go more than HUNGER_MAX without EATING: waking sets the
// meal clock that far out, and from there every bite pushes it on by ITS OWN
// nourishment (RULES 47) — no flat restart, so what a food is worth is what it
// buys. Every affordability check prices against the minutes left on it as well
// as the budget (timeLeft), so the reserve always lands you at a resting place
// before you'd go hungry. Base values — skills will stretch them later.
export const SLEEP_MIN = 480 // 8h asleep, at least
export const WAKE_CAP = FREE_CAP - SLEEP_MIN // 16h — the ceiling on daily minutes
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
// leap over a seam is FORDING a river, and a river must refuse that — so the
// move returns on BOARDS ONLY. No water anywhere in it — footing, flankers or
// landing (leapNeighbors) — which keeps every crossing bridge/raft business;
// fording as an EARNED ability stays open — see DESIGN.md, *Rivers*.
export const SCHEMA = 3 // save format version — the shape of the serialized object (3: world.worldKey)
export const RULES = 50 // replay-rules version (50: A BITE IS A MINUTE — EAT_MIN goes 2 → 1, the baseline sitting for every raw food and every cooked kind alike: taking something off your back and eating it is a moment, not an errand, and at two minutes a 3-minute herb bought almost nothing. It is a FLOOR, not a flat price — a rich recipe may name a longer sitting of its own later. Every logged eat replays to a different budget and pushes the meal clock from a different minute; 49: THE DOOR OPENS UNDER YOUR FEET — a gated board no longer opens the instant its last tile is found. It opens when the board is CLEAR *and* you are STANDING ON THE DOORSTEP, the gate's own tile: knowing the way out and taking it are two different things, and the second one costs the walk across the board. Every old log that cleared a board from anywhere but the door replays with that gate still shut and the first step out through it refused, so no log that ever left home replays; the wall's debris lands on a different minute too, which moves every haul that followed it; 48: COOKED FOOD HAS A NAME — the one generic `meal` is gone and every food cooks into a KIND OF ITS OWN (`cooked fish`, `cooked berries`), worth COOK_MULT× its raw and wearing the raw's own face in capitals, so a 45-minute cooked hare and a 12-minute cooked kelp can finally be told apart in the pack. A meal's worth and its keeping are the kind's now, not the instance's, and it KEEPS TWICE ITS RAW'S SHELF and never under MEAL_SHELF_MIN (48h), so every old log that cooked replays to a differently named meal on a different spoilage clock; 47: A MEAL IS WORTH ITS OWN TIME — eating no longer RESTARTS the meal clock at a flat HUNGER_MAX; it PUSHES it on by the food's own nourishment (raw, never the ration-clipped eatBoost — a clipped push would strand you hungry with food on your back). Waking still sets the clock HUNGER_MAX out, so a foodless day is three hours as before, but a 3-minute herb now buys three minutes where it used to buy three hours, and a cooked hare buys forty-five. Every logged eat replays to a different meal clock, so any day that ate runs to a different length and no old log replays; 46: YOU START AT ONE — every skill of the PLAYER'S begins at level 1, whatever the key says, and THE CRUDE TIER COMES DOWN TO 1 WITH IT: a recipe's level is its own, not a rule about its tier, so bare hands can weave a basket or lash an axe on day one and only the fine tier still asks for 6. Nature is how gifted you are towards a skill, not what you are handed: it no longer pre-fills the edges of your first levels (baseLevel is gone, and with it the half-of-nature start), so every gate, cost, lesson and reserve prices against a lower start and no old log replays. The figures are untouched — they still sit AT their nature; 45: REST AND RESUME IS GONE — a day ends at a resting place (home or a camp) and the next starts there; the day-ender that woke you where you stood is scrapped, so any log that used it no longer replays; 44: ONE OF A KIND — you carry one tool of a kind: a fine tier is an UPGRADE that consumes the crude one (it sits in the recipe's needs), and crafting a second tool of a kind you already carry is refused, so a log that crafted a fine tool outright, or stacked two nets, no longer replays; 43: FORAGE & HUNT — every biome yields a SET (fruit, roots, berries, nuts, oysters, crabs, kelp and herbs join plants and eggs), a tile is a node for each of them on its own draw, and the regrow clock is per tile AND resource; fish, hare and eel are HUNTED with a tool of the kind on your back (net, snare, spear — the `hunt` action, which trains hunt); TOOLS NO LONGER WEAR — the axe's `uses` is gone and tools come in tiers by craft level, the fine tier lighter and quicker (`speed`); `gather` names its item (a bare one takes the first forage the tile has ready). Any old log that gathered replays to a different pack, a netted fish was a gather and is a hunt, and an axe that broke no longer does; 42: PLAYER ENERGY — the body joins the clock. SLEEP: at least SLEEP_MIN (8h) a day, so the waking window caps at WAKE_CAP (16h) instead of midnight — the budget and a meal's stretch both stop there. HUNGER: no more than HUNGER_MAX (3h) between meals — every affordability check prices against the lesser of the budget and the minutes until the next meal is due (timeLeft), so the reserve lands you at a rest spot before you'd go hungry; eating restarts the clock (and is reserve-guarded now, never refused for a small bite), and so does waking. A long day without food ends at three hours, so any old log that ran past that replays to a shorter day, and a fully-mapped world's day is 960, not 1440; 41: AN EDGE COSTS AN HOUR — a lesson's base goes 6 → 60 minutes (LESSON_COST; the +2/level drag stands, so level 15 is 90), and teaching, priced at the same base, goes with it. Every logged learn or teach replays to a different budget, and the reserve refuses lessons it used to allow; 40: THE WHEEL IS A COMPASS — heal and dream swap seats in STAT_NAMES so every skill faces its opposite across the wheel (scout↔dream, travel↔lore, gather↔heal). The order is not cosmetic: statsOf slices the 64 nibbles BY INDEX, so every key — the player's and every figure's — reads a different heal and dream than it used to, and the twelve master boards are dealt in the same order, so the board that mastered one now masters the other. Any log that learned or taught either skill replays against a different teacher; 39: YOU ARE THE MAKER — crafting stops being a commission bought from a biome-native figure and becomes a verb you perform ANYWHERE, home included: your own `craft` level against the recipe's, your own minutes, and it TRAINS craft like every other verb, so a log that walked to a specialist replays to a different pack and different skills. A recipe MAY still name a `site` biome it needs underfoot, but no crude one does — hand-work isn't pinned to terrain, and later making moves onto structures anyway; AND NOBODY STARTS AT ZERO — baseLevel floors at 1, so every skill exists for you from day one and old logs replay against different gates and costs; AND THE FIGURES' BAND — an NPC's nature is clamped to NPC_MIN..NPC_MAX (2..12), the place bonus lifts only to PLACE_CAP (11) so home ground alone never makes a master and they now sit AT it rather than half of it, so the learning ceiling moves 7 → 12 and every old lesson replays against a different teacher; twelve boards per world are drawn from the world key as guaranteed MASTERS, one per skill, so no world is a dead end in anything; and teaching now carries a figure ABOVE their nature to SKILL_CAP, which it never could before; AND A BOARD CENTRE IS NEVER WATER — isShallow was the one place that didn't exempt the centre, so a centre whose derived biome came up water (31% of them; 78% of games had at least one, some worlds nearly all 60) became a JETTY: navWater made stepsFrom refuse every exit but the way you came, and canMove priced the arrival with the wade-out reserve instead of landBack, so the figure standing there read as unreachable from any distance while every tile around them routed fine. Routes through and onto those centres now exist, so any old log near one replays differently; AND A CAMP NEEDS ONLY LAND — build's "real land underfoot" check read gatherResAt, which silently demanded a forage NODE as well, so camps that were impossible on ordinary ground now go up and the reserve eases earlier; 38: THE LEAP RETURNS, DRY-FOOTED — the diagonal power move is back on over dry land only (no water as footing, flanker or landing, so a river still can't be forded), and known-ground routes, reach and the reserve all shorten, so an old log's moves replay to different budgets; AND THE RAFT TAKES TIME — building it charges RAFT_MIN (30m, reserve-guarded; it was instant), so a log that rafted out replays to a shorter day; 37: FOOD IS TIME — eat (2m) turns a food's nourishment into extra waking minutes today (+60/day cap, midnight ceiling), cook (10m, at a hearth = any resting place) triples it into a meal; both consume dated instances, so any log that carried food replays to different budgets; 36: FISHING TAKES TACKLE — water yields fish only to a NET on your back, so a log that fished bare-handed no longer replays; 35: THE SHALLOWS ARE WATER YOU CAN STAND IN — board water of deepness 0 reads exactly like a river now (wade in from a bank, leave only that way or by bridge, build a boat there) and a raft crosses it, so reach, routes and the reserve all move; 33: THE HAUL — the felled wall leaves a pile of DEBRIS on the doorstep, and raft/bridge are paid for in loads of it dropped on the water (they were free), so an old log's crossing no longer replays; 32: SCOUTING PRICED IN STEPS — 1× home and its river ring, 2× the first shore, 3× beyond, so old days replay with different budgets (31 was a gentler ramp); 30: RIVERS — every seam is water: no river→river step, and leaving one is only back the way you came or over a BRIDGE, so old routes replay differently; 29: DROPS PERSIST — every tile is a storage cell keyed by GLOBAL coord, so an old save's home-local stash keys would read as the wrong tiles; 28: metal nodes 0.09→0.3 — the node layout shifts, so old gathers replay differently; and RULES 27's shape-is-the-level ladder) — bump on ANY change that alters what an old
// log replays to (costs, movement, gating); mismatched saves reset in dev

// ── practice: learning by DOING ────────────────────────
// Every action of a kind counts toward the skill it exercises (a step trains
// travel, a scout trains scout). Crossing a threshold bumps that skill a
// level, and thresholds DOUBLE per level (exponential backoff): level k
// lands at PRACTICE_BASE·(2^k − 1) actions total — the early levels come
// quick, the last ones take an age.
export const PRACTICE_BASE = 20
export const PRACTICE_SKILL = { move: "travel", scout: "scout", gather: "gather", hunt: "hunt", craft: "craft", build: "build", cook: "cook" } // action kind → the skill it trains.
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

const key = Hex.key
const eq = Hex.equals

// ── tile types ───────────────────────────────────────
// Every hex can carry a stored type (sparse: the lattice owner's
// tile.types[globalKey] — ONE map per lattice, interiors and seams alike);
// absent = the derived terrain for board interiors, seam for seam tiles. A
// type's properties are cost MULTIPLIERS on
// the level base — the hook for pricing tile kinds (terrain, specials)
// differently. Seams are the roads: moving along them costs half a step.
export const TILE_TYPES = {
  plain: { move: 1, scout: 1 },
  seam: { move: 0.5, scout: 1 }, // step onto a seam tile = 1 at depth 2
  // the derived biomes, PRICED (2026-07-06 — multipliers capped at 2×:
  // variance reads as flavour at 2×, as punishment beyond). Water is
  // IMPASSABLE on foot: scoutable from the shore, never walkable — seams
  // stay the roads, so no terrain roll can strand anyone; sealed pockets
  // behind water are future content (boats).
  water: { move: 1, scout: 1, impassable: true },
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
// derived pubkey alike: 64 nibbles → 8 skills, each the rounded average of
// its 8-nibble slice (0..15). Names are placeholders; the system is the point.
// TWELVE skills — the 8 place-skills (biome-bound) plus 4 celestial ones (hunt,
// cook, heal, dream — placeholder names/icons for now). The 12 skills ARE the
// year's 12 CONSTELLATIONS: each 30-day month one rides the sky and its skill is
// IN SEASON. Order = the wheel's order; index = the month it rules.
// WHEEL ORDER — clockwise from the top (matches the skill wheel + the 12
// constellations). The pillars are contiguous ARCS, 4 each: TIME straddles the top
// (farm·trade·scout·travel), SPACE the right (gather·craft·hunt·cook), MIND the left
// (dream·lore·heal·build). scout sits at 12 o'clock. See DESIGN "the three pillars".
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
  gather: { home: "plain", flavour: "the open forage", effect: "eases the forage — half the minutes at 15" },
  build: { home: "mountain", flavour: "stone sense", effect: "gates the builds" },
  craft: { home: "forest", flavour: "timber hands", effect: "gates the recipes — the fine tools open at 6" },
  trade: { home: "beach", flavour: "harbours and meetings", effect: "—" },
  scout: { home: "cliff", flavour: "the vantage", effect: "cheapens scouting — toward half price at level 15" },
  farm: { home: "marsh", flavour: "the fertile work", effect: "—" },
  lore: { home: "peak", flavour: "the summit sages", effect: "—" },
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
// sits AT their nature (they've done this all their life; the half-start is
// the player's growth arc, not theirs), so the best teacher alive can carry
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

// What each biome offers — a SET (RULES 43): its forage, what a tool can hunt
// there, and its material. Whether a given tile is a node for each entry is
// the per-resource draw in isNode; the peak grows nothing — carry food up.
export const BIOME_YIELD = {
  water: ["kelp", "fish", "eel"],
  beach: ["oysters", "crabs", "fish"],
  marsh: ["roots", "eel"],
  plain: ["fruit", "plants", "hare"],
  forest: ["berries", "nuts", "hare", "wood"],
  mountain: ["herbs", "rock"],
  cliff: ["eggs"],
  peak: ["metal"]
}

// ── the gather / craft / build layer ─────────────────────────────────
// RESOURCES: what a take costs (minutes, before the tool's speed and the
// skill's ease), what a unit weighs on your back, the tile's REGROW clock (how
// many world-minutes — 1440/day, sleep included — until it yields again), and
// a SHELF life: the raw harvest spoils and is lost after this many world-
// minutes (omit = keeps forever). Food rots; stone and metal don't. You can't
// hoard a harvest — you carry it back and use it, or lose it.
// `food` is NOURISHMENT IN MINUTES (RULES 37): what eating one raw unit adds
// to today's waking window. Cooking multiplies it (COOK_MULT) into a meal.
// `hunt` names the tool KIND a resource can't be had without — that makes it
// a HUNT (the hunt action, trains hunt); the rest is FORAGE, taken by hand
// (the gather action, trains gather). `tool` is a kind that merely EASES the
// take (the axe on wood). `tag` is the pack chip's face where the first letter
// is already taken by something else.
export const RESOURCES = {
  // FORAGE — every biome has some (BIOME_YIELD), each with its own subtlety
  plants: { weight: 1, min: 3, regrow: 120, shelf: 4320, food: 6 }, // plain: the greens, back within the day
  fruit: { weight: 1, min: 4, regrow: 4320, shelf: 4320, food: 8, tag: "fr" }, // plain: the staple — a tree takes 3 days
  roots: { weight: 1, min: 5, regrow: 1440, shelf: 7200, food: 7, tag: "ro" }, // marsh: slow to dig, keeps 5 days
  berries: { weight: 1, min: 2, regrow: 1440, shelf: 2880, food: 5, tag: "be" }, // forest: quick, gone by the second night
  nuts: { weight: 1, min: 4, regrow: 10080, shelf: 43200, food: 7, tag: "nu" }, // forest: the first food that KEEPS — trail food
  oysters: { weight: 1, min: 3, regrow: 1440, shelf: 1440, food: 8 }, // beach: eat on the shore, or cook tonight
  crabs: { weight: 1, min: 5, regrow: 2880, shelf: 1440, food: 10 }, // beach: the richer find
  kelp: { weight: 1, min: 2, regrow: 1440, shelf: 1440, food: 4 }, // shallows: barely food — the wader's ration
  eggs: { weight: 1, min: 4, regrow: 4320, shelf: 5760, food: 9 }, // cliff: 4 days
  herbs: { weight: 1, min: 4, regrow: 7200, shelf: 14400, food: 3, tag: "he" }, // mountain: barely food; heal's ingredient later
  // HUNT — pays more, spoils in a day, and needs its tool
  fish: { weight: 2, min: 5, regrow: 1440, shelf: 1440, food: 12, hunt: "net" }, // water, beach
  hare: { weight: 2, min: 6, regrow: 4320, shelf: 1440, food: 15, hunt: "snare" }, // forest, plain
  eel: { weight: 2, min: 6, regrow: 2880, shelf: 1440, food: 14, hunt: "spear", tag: "el" }, // marsh, water
  // MATERIALS — keep for good; an axe on your back eases wood
  wood: { weight: 3, min: 6, regrow: 10080, tool: "axe" }, // seasons — effectively keeps
  rock: { weight: 5, min: 8, regrow: 262800 },
  metal: { weight: 6, min: 10, regrow: 525600 },
  // DEBRIS is the one material nobody forages: no biome yields it (BIOME_YIELD),
  // so no tile is ever a node for it and `min`/`regrow` would never be read. It
  // appears as a PILE where a cleared board's wall came down (see fellWall) and
  // moves only by hand — take, carry, drop. The HEAVIEST thing in the game: one
  // load fills a base pack on its own, so a haul is one trip at double the step
  // cost, which is exactly what DESIGN.md's *Rivers* asks a haul to feel like.
  debris: { weight: 6 },
  // (COOKED FOOD lives here too — one kind per raw, generated from the table
  //  above the moment the cooking knobs are known. See MEAL_SHELF_MIN below.)
}
// FOOD IS TIME — the knobs. Eating spends EAT_MIN minutes and adds
// the food's nourishment to TODAY's waking window: at most EAT_CAP a day (the
// sacred baseline again — a second wind, not a second day), and never past
// the waking cap (WAKE_CAP). It also pushes the meal clock on by that same
// nourishment, RAW and uncapped by the ration — the ration governs the day's
// window, never the body's clock (RULES 47).
// Cooking (at a hearth: any resting place) spends
// COOK_MIN (eased by the cook skill, half at 15) and turns one raw unit into
// a meal worth COOK_MULT× its nourishment.
// ONE MINUTE IS THE BASELINE SITTING (RULES 50): a bite is a moment, not an
// errand — raw or cooked, taking something off your back and eating it costs
// the same single minute. A FLOOR rather than a flat price: a richer recipe may
// ask for a longer sitting of its own once a recipe is more than one
// ingredient; this is what everything else eats at.
export const EAT_MIN = 1
export const EAT_CAP = 60
export const COOK_MIN = 10
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
//           hare, eel, kelp, oysters, crabs — to a clear two days. (One
//           ingredient per cook today; when a recipe takes SEVERAL, the
//           shortest-lived of them has to govern.)
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
    tag: (RESOURCES[raw].tag ?? raw[0]).toUpperCase(), // (tagOf isn't declared yet — read the field itself)
    cooked: raw // what the fire was given — and the mark that says this one IS cooked
  }
// What the haul buys, in loads of debris (DESIGN.md, *Rivers*): a raft is the
// cheap starter vehicle, a bridge the permanent, heavy work — and the felled
// wall leaves a bridge's worth on the doorstep, so the first choice you make
// on the water is which of the two you spend it on.
export const RAFT_DEBRIS = 1
export const BRIDGE_DEBRIS = 3
export const RAFT_MIN = 30 // minutes to lash the raft together (RULES 38) — the haul pays the materials; this is the making
export const WALL_DEBRIS = 3
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
// NO TIER GATE (2026-09-05): a recipe's `level` is ITS OWN, never a rule about
// the tier it belongs to. The crude ones sit at 1 — where everybody starts, so
// your hands can make them from day one — and only the fine tier asks for 6.
// The axe is optional (wood comes by hand, slowly); net, snare and spear are
// required by what they hunt (RESOURCES[r].hunt).
export const RECIPES = {
  basket: { needs: { plants: 5 }, min: 10, level: 1, weight: 1, carry: 4, keeps: 1.5 }, // raises carry AND keeps food fresher — the first storage tech
  axe: { needs: { wood: 2, rock: 1 }, min: 12, level: 1, weight: 2, tool: "axe", speed: 0.5 },
  "fine axe": { needs: { axe: 1, wood: 1, rock: 1 }, min: 20, level: 6, weight: 1, tool: "axe", speed: 0.35, tag: "A" },
  net: { needs: { plants: 4 }, min: 12, level: 1, weight: 2, tool: "net", speed: 1 }, // the tackle fish come out of the water to (RULES 36)
  "fine net": { needs: { net: 1, plants: 4, wood: 1 }, min: 20, level: 6, weight: 1, tool: "net", speed: 0.6, tag: "N" },
  snare: { needs: { plants: 2, wood: 1 }, min: 10, level: 1, weight: 2, tool: "snare", speed: 1 },
  "fine snare": { needs: { snare: 1, plants: 2, wood: 1 }, min: 18, level: 6, weight: 1, tool: "snare", speed: 0.6, tag: "S" },
  spear: { needs: { wood: 1, rock: 1 }, min: 10, level: 1, weight: 3, tool: "spear", speed: 1, tag: "sp" },
  "fine spear": { needs: { spear: 1, wood: 1 }, min: 18, level: 6, weight: 2, tool: "spear", speed: 0.6, tag: "SP" }
}
// the face a pack or ground chip wears for an item: its tag, else its initial
export const tagOf = k => RESOURCES[k]?.tag ?? RECIPES[k]?.tag ?? k[0]
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
  rock: 0.18,
  metal: 0.3
}
// (metal 0.09→0.3, 2026-07-24: peaks are already 1/16 of mountain ground — at 0.09 the
// whole world held ~8 metal nodes on 7 of 61 boards, functionally unfindable. At 0.3
// it is still the scarcest resource by far, but a determined climb can find it.)
// the FORAGER'S EYE: forage nodes only mark on the map once your SCOUT skill
// reaches this — below it you learn a tile's yield only by standing on it
// (the nodes are derivable in theory; the game earns the map). Display-only,
// so it never touches replay.
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
  eel: 16
}

// Orientation alternates by depth; only the parity matters for topology.
export const orientOf = depth => (depth % 2 === 0 ? Hex.POINTY : Hex.FLAT)

// ── static topology (pure, shared by every level) ────
export const inBounds = (q, r) => Hex.length([q, r]) <= RINGS

// Sibling boards are pushed out one row: offsets are rotations of
// (2R+2, −(R+1)), which sit at the clean ±30/±90/±150° screen directions and
// leave EXACTLY one hex row between any two interiors — the seam.
export const SEAM_RING = RINGS + 1 // a board's seam ring (side seams + corner junctions)
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

// The neighbour lobes an off-board hex sits at seam distance from (side seam:
// one; junction or a neighbours' shared seam: two). Board-relative.
export function seamLobesOf(h) {
  const out = []
  for (let i = 0; i < 6; i++) {
    if (Hex.distance(h, SUPER[i]) === SEAM_RING) out.push(i)
  }
  return out
}

// A seam hex (relative to a board at the origin) belongs to no board and sits
// at seam distance from ≥2 of the seven centres — parent edges and vertices.
export function isSeamHex(h) {
  if (Hex.length(h) > VIEW_RING) return false
  if (superIndexOf(h[0], h[1]) >= 0 || Hex.length(h) <= RINGS) return false
  const mine = Hex.length(h) === SEAM_RING ? 1 : 0
  return mine + seamLobesOf(h).length >= 2
}

// The gate EDGE: where the seed angle's ray exits the board's interior — the
// single side of the last interior tile (the doorstep) that the ray crosses
// into the seam. Angle convention from the setup picker: 0° up, clockwise.
// Returns { k: doorstep hex key, side: DIR index, seam: the seam hex beyond }.
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
  for (let t = 0.5; t < SEAM_RING * 3; t += 0.05) {
    const h = Hex.round(o.b[0] * dx * t + o.b[1] * dy * t, o.b[2] * dx * t + o.b[3] * dy * t)
    if (Hex.length(h) <= RINGS) {
      door = h
      continue
    }
    if (Hex.length(h) !== SEAM_RING) break
    // grazed a corner and skipped the doorstep? re-anchor on the interior
    // neighbour of the seam hex closest to the ray
    if (Hex.distance(door, h) !== 1) {
      door = Hex.neighbors(h)
        .filter(n => Hex.length(n) <= RINGS)
        .sort((a, b) => offRay(a) - offRay(b))[0]
    }
    const side = Hex.neighbors(door).findIndex(n => eq(n, h))
    return { k: key(door), side, seam: h }
  }
  return { k: key([RINGS, 0]), side: 0, seam: [SEAM_RING, 0] } // unreachable fallback
}

// Super index i → parent DIR index, per child-depth parity. The seam obeys the
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

// The home's gate: a single EDGE of the doorstep tile, seeded by the angle.
// GATE_TILE is the seam hex just beyond it; the parent-scale gate direction
// derives from that hex's lobe — used only by the locked base view's visuals.
export const GATE_EDGE = gateEdgeFor(SEED_ANGLE)
export const GATE_TILE = GATE_EDGE.seam
export const GATE_DIR = SUPER_TO_PARENT_DIR[0][seamLobesOf(GATE_TILE)[0]]

// A full board's worth of hexes — discovering them all is what opens a gate.
export const BOARD_TILES = Hex.range(RINGS).length

// Interior border tiles that touch the seam toward neighbour i (board-relative).
export const edgeTilesInto = i =>
  Hex.ring([0, 0], RINGS).filter(t =>
    Hex.neighbors(t).some(n => Hex.length(n) === SEAM_RING && isSeamHex(n) && seamLobesOf(n).includes(i))
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

// A key's 64 chars laid onto a 61-tile board: the CENTRE takes the middle
// four, the other 60 tiles take the rest in reading order. Used twice — the
// pubkey on the home board (identity, display) and the world key on the
// PARENT grid (the terrain's base field).
function inscribe(hex64) {
  const out = new Map()
  const mid = hex64.length / 2
  const centre = hex64.slice(mid - 2, mid + 2)
  const rest = hex64.slice(0, mid - 2) + hex64.slice(mid + 2)
  let i = 0
  for (const t of readingOrder(RINGS)) out.set(key(t), t[0] === 0 && t[1] === 0 ? centre : rest[i++])
  return out
}
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
  const gateDir = SUPER_TO_PARENT_DIR[0][seamLobesOf(gateEdge.seam)[0]]

  // Identities: the PUBKEY (main key) inscribes the home board — display
  // only, who you are. The WORLD KEY (generated, throwaway) derives the
  // terrain everywhere. Both lazy and pure — nothing stored, replay-safe.
  hex64Check(pubkey, "pubkey")
  hex64Check(worldKey, "worldKey")
  const homeChars = pubkey ? inscribe(pubkey) : new Map()

  // The hex character(s) inscribed on a (home-board) tile, or null — one char
  // per tile, four on the centre. The renderer shows the key literally;
  // everything else derives from it.
  const nibbleAt = g => {
    const b = boardOf(g)
    return b && b.c[0] === 0 && b.c[1] === 0 ? (homeChars.get(key(b.local)) ?? null) : null
  }
  const homeOutside = makeTile()
  const homeInside = childAt(homeOutside, "0,0")
  homeInside.discovered.add("0,0") // the home (base) centre starts known; the rest is fog
  homeOutside.discovered.add("0,0") // …and the home tile itself is known at the parent scale (we live in it)

  let energy = SEED_MIN // shared across levels; spent going out, refills only by resting home
  let fed = 0 // minutes EATEN into today's window (RULES 37) — the budget reads dayStart + fed, so the clock only ever runs forward
  let mealAt = HUNGER_MAX // the minute of the day the next meal is DUE — waking sets it HUNGER_MAX out, and every bite pushes it on by its own nourishment

  // Discovery FEEDS the day: every interior tile you uncover — HOME INCLUDED —
  // ADDS a minute to the NEXT day's budget (the seed minute bootstraps day one,
  // so the very first tile you find already pays). Clearing the home board (its
  // 60 non-centre tiles) lifts you from the seed to ~60; past the gate each
  // outside tile carries the budget onward toward the waking cap.
  // Derived from the discovery ratchets (never snapshotted, so replay-safe);
  // boards are children of the BASE (homeInside) and each auto-known centre
  // earns nothing.
  const tilesFound = () => {
    let n = 0
    for (const k of Object.keys(homeInside.children)) {
      const d = homeInside.children[k].discovered
      n += d.size - (d.has("0,0") ? 1 : 0)
    }
    return n
  }
  const dailyBudget = () => Math.min(WAKE_CAP, SEED_MIN + tilesFound())
  let learned = {} // skill → xp, grown by LESSON actions — nurture; replays from the log like everything else
  let given = {} // skill → EDGES taught away: teaching drains the shape a lesson fills (log-derived)
  let practiced = {} // action kind → count (a step, a scout…) — practice levels derive from it (log-derived)
  let taught = {} // npc board key → { skill → levels taught }: how far you've raised a figure toward its nature
  let inventory = {} // resource/item → count on your back (log-derived, never serialized)
  let gatheredAt = {} // tile key → world-minute of its last gather (the regrow clock; log-derived)
  let stash = {} // GLOBAL tile key → { item, arr:[{at}] } — every tile is a storage cell (log-derived)
  let everTook = false // has anything ever been picked up off the ground? The first pile — the felled wall's debris on
  // the doorstep — is where the gesture is learned, and after it the corners stop explaining themselves (log-derived)
  let day = 1 // current day/expedition; energy spent = minutes since waking (00:00)
  let log = [] // this day's actions in order (replay re-applies them); banked + reset on sleep
  let logMeta = [] // per-entry minutes charged, index-aligned with log — display-only, derived, never saved
  const history = [] // past days: { day, actions, start } (for future day-navigation)
  let todayDiscovered = [] // {tile, key, seam?} first discovered TODAY — replay re-fogs these (display-only)
  let todayReached = [] // {tile, i} edges first reached TODAY — same journal for the edge ratchet
  let todayWorn = [] // {node, key} tile traversals TODAY — rewound for the display replay
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

  // ── the global lattice ──────────────────────────────
  // Basis: parent hex c sits at global basis(c) = c.q·b0 + c.r·b1.
  const basisOf = () => {
    const tbl = SUPER_TO_PARENT_DIR[parity()]
    return { b0: SUPER[tbl.indexOf(0)], b1: SUPER[tbl.indexOf(5)] }
  }
  const boardCentre = c => {
    const { b0, b1 } = basisOf()
    return [c[0] * b0[0] + c[1] * b1[0], c[0] * b0[1] + c[1] * b1[1]]
  }

  // Which board owns a global hex — and whether it's seam — is PURE lattice
  // math per depth: memoised forever (the node lookup stays live below, since
  // children appear lazily). This is the hottest call in the sim — every wall
  // check, discovery lookup and neighbour walk lands here.
  const geoCache = new Map() // "depth:q,r" → { c, centre, local } | "seam" | null
  function boardGeo(g) {
    const ck = depth() + ":" + key(g)
    const hit = geoCache.get(ck)
    if (hit !== undefined) return hit
    const { b0, b1 } = basisOf()
    const det = b0[0] * b1[1] - b1[0] * b0[1]
    const pf = [(g[0] * b1[1] - g[1] * b1[0]) / det, (g[1] * b0[0] - g[0] * b0[1]) / det]
    const pc = Hex.round(pf[0], pf[1])
    let out = null
    let seams = 0
    for (const c of [pc, ...Hex.neighbors(pc)]) {
      if (!inBounds(c[0], c[1])) continue // boards exist only over the parent grid
      const centre = boardCentre(c)
      const dist = Hex.distance(g, centre)
      if (dist <= RINGS) {
        out = { c, centre, local: [g[0] - centre[0], g[1] - centre[1]] }
        break
      }
      if (dist === SEAM_RING) seams++
    }
    if (!out && seams >= 2) out = "seam"
    geoCache.set(ck, out)
    return out
  }

  // The board owning global hex g: { c: parent hex, centre, local, node? } or null.
  function boardOf(g) {
    const geo = boardGeo(g)
    if (!geo || geo === "seam") return null
    return { c: geo.c, centre: geo.centre, local: geo.local, node: parentOf().tile.children[key(geo.c)] }
  }

  // Is global hex g on the seam (between ≥2 boards over the parent grid)?
  const isSeamAt = g => boardGeo(g) === "seam"

  // Classify ANY global coordinate — unbounded, no frames, no rings.
  function kindOf(g) {
    if (depth() <= BASE_DEPTH) return Hex.length(g) <= RINGS ? "in" : null
    const geo = boardGeo(g)
    return geo ? (geo === "seam" ? "seam" : "in") : null
  }

  const boardHexOf = g => boardOf(g)?.c ?? null
  const boardCentreOf = g => boardOf(g)?.centre ?? null

  // ── discovery journals (the ratchet never shrinks; the journal is what
  //    replay may re-fog, display-only) ────────────────
  function journalDiscover(tile, k) {
    if (tile.discovered.has(k)) return
    if (!todayDiscovered.some(d => !d.seam && d.tile === tile && d.key === k)) todayDiscovered.push({ tile, key: k })
    tile.discovered.add(k)
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
    if (tile.discovered.size < BOARD_TILES) return
    if (key(b.local) !== tile.gate.k) return // …the gate's `k` is board-LOCAL, like the walls it sits in
    tile.gateOpen = true
    tile.walls[tile.gate.k] &= ~(1 << tile.gate.side)
    fellWall(tile.gate)
    worldStamp++ // the wall is the movement graph — and fellWall bumps nothing if a pile already lies there
  }
  // …AND THE WALL LEAVES ITS RUBBLE. The stretch that came down is MATERIAL:
  // WALL_DEBRIS loads of it, piled on the doorstep tile it fell from — an
  // ordinary stash cell from there on, so the haul is the flow that already
  // exists (take → carry → drop). One load makes the raft, three the bridge.
  //
  // The pile is WORLD state, not log state, so it's planted in the day's START
  // snapshot too: a display rewind restores dayStart and re-applies the log, and
  // without this, scrubbing the day the wall fell would sweep the rubble away
  // for good (the wall itself doesn't un-fall on a rewind either).
  function fellWall(gate) {
    const sk = gate.at
    if (stash[sk]) return // something already lies there — never overwrite a tile's own pile
    stash[sk] = { item: "debris", arr: Array.from({ length: WALL_DEBRIS }, () => ({ at: worldMin() })) }
    if (dayStart && dayStart.stash) dayStart.stash[sk] = { item: "debris", arr: stash[sk].arr.map(i => ({ ...i })) }
    worldStamp++
  }
  function journalSeam(tile, gk) {
    if (tile.seamDiscovered.has(gk)) return
    if (!todayDiscovered.some(d => d.seam && d.tile === tile && d.key === gk))
      todayDiscovered.push({ tile, key: gk, seam: true })
    tile.seamDiscovered.add(gk)
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
  function journalWorn(node, k) {
    if (!node.worn) node.worn = {} // defensive: nodes always carry it, but never crash if not
    node.worn[k] = (node.worn[k] || 0) + 1
    ;(replaying ? replayWorn : todayWorn).push({ node, key: k })
    worldStamp++ // wear cheapens the tile — the reserve/route caches must re-price it
  }

  // ── discovery lookups (global) ──────────────────────
  const isDiscovered = g => {
    if (depth() <= BASE_DEPTH) return view().tile.discovered.has(key(g))
    const b = boardOf(g)
    if (b) return !!b.node && b.node.discovered.has(key(b.local))
    if (isSeamAt(g)) return parentOf().tile.seamDiscovered.has(key(g))
    return false
  }

  // ── walls (per hex side, any hex) ───────────────────
  // THE WORLD'S WALL: the map ends where no tile exists, and every existing tile
  // (seams included) WALLS its void-facing sides — so the whole map wears an
  // enclosure exactly like the home board's. Purely visual by construction:
  // steps and leaps into the void were never possible (kindOf gates every
  // neighbour walk), so no replay changes. The world is static → cached per tile,
  // since wallBits rides the reach map's hot path.
  const edgeWalls = new Map()
  const edgeWallBits = g => {
    const k = key(g)
    let bits = edgeWalls.get(k)
    if (bits === undefined) {
      bits = 0
      for (let d = 0; d < 6; d++) {
        if (!kindOf([g[0] + DIRS[d].q, g[1] + DIRS[d].r])) bits |= 1 << d
      }
      edgeWalls.set(k, bits)
    }
    return bits
  }
  function wallBits(g) {
    if (depth() <= BASE_DEPTH) return 0
    const b = boardOf(g)
    if (b) return (((b.node && b.node.walls[key(b.local)]) || 0) | edgeWallBits(g))
    if (isSeamAt(g)) return (parentOf().tile.seamWalls[key(g)] || 0) | edgeWallBits(g)
    return 0
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
      if (!kindOf(n)) continue
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
  // Ground you cannot set foot on: deep water. The SHALLOWS are not blocked —
  // you can wade in and stand there, exactly like a river (RULES 35); what you
  // may do from inside the water is stepsFrom's business, not this.
  const blocked = g => !isCentre(g) && !!typeOf(g).impassable && !isShallow(g)

  // What you can STEP between: sight minus impassable ground (water).
  const walkNeighbors = g => sightNeighbors(g).filter(n => !blocked(n))

  // ── RIVERS (RULES 30, 2026-08-03) ────────────────────────────────
  // EVERY SEAM IS A RIVER. You can wade in from any shore, but the water is
  // not a road and not a crossing:
  //   • land → river   — always (it's just a step off the bank)
  //   • river → river  — NEVER. The seam is not a path; each of its tiles
  //                      hangs off the land beside it, like a jetty.
  //   • river → land   — only back the way you came, or over a BRIDGE.
  // So reaching the next river tile means going back to land and stepping in
  // again, and reaching the far bank means building something. See DESIGN.md,
  // *Rivers*, for why (and for what the debris of a cleared board's wall pays
  // for). `stepsFrom` is the whole rule: every consumer of the movement graph
  // — routing, the reserve, retrace validation — goes through it.
  // (memoised: the routing and reserve sweeps ask this of every tile they pop,
  // and kindOf walks the board geometry to answer. Position → water is fixed
  // for the life of the sim, so it's cached once per tile.)
  const riverMemo = new Map()
  const isRiver = g => {
    const k2 = key(g)
    let r = riverMemo.get(k2)
    if (r === undefined) riverMemo.set(k2, (r = kindOf(g) === "seam"))
    return r
  }
  // a bridge is an unordered PAIR of tiles: the river tile it stands in and
  // the land tile it lands on. Log-derived, like every other bit of state.
  let bridges = new Set()
  const bridgeKey = (a, b) => [key(a), key(b)].sort().join("|")
  const hasBridge = (a, b) => bridges.has(bridgeKey(a, b))
  // THE RAFT — the first vehicle, and what the debris of a cleared board's wall
  // actually pays for. It LIVES ON THE WATER: moored at one river tile, and it
  // only moves when you're on it. Board it by stepping onto its tile from a
  // bank; aboard, the river stops being a dead end — you can navigate tile to
  // tile and land on ANY shore. Step onto land and the raft stays where you
  // left it, which is the whole game of owning one: knowing where it is.
  let raft = null // the water tile it's moored at, or null (log-derived)
  const aboard = () => !!raft && eq(raft, view().player)
  // NAVIGABLE WATER (RULES 34/35, 2026-08-04): every river tile, and the
  // SHALLOWS on a board — water of deepness 0, the kind you can see the bottom
  // of. A raft draws nothing, so a coastal fringe or a pond is road to it and a
  // lake stops being a hole in the map you walk around.
  //
  // AND THE TWO BEHAVE THE SAME ON FOOT (RULES 35): you can wade into either and
  // stand there, and from either the only ways out are the bank you came in by
  // and a bridge. That is what makes water a PLACE and not just an obstacle —
  // you stand in it to see across it, and to BUILD on it, which is where a boat
  // comes from. Deeper water is still nothing but a wall.
  // (Memoised beside isRiver: `blocked` asks this of every water tile the
  // routing sweeps touch, and deepnessAt walks a tile's neighbours to answer.
  // Terrain is fixed for the life of the sim, so it's computed once per tile.)
  const SHALLOW = 1 // deepness BELOW this is wadeable, and floats a raft
  const shallowMemo = new Map()
  // A BOARD CENTRE IS NEVER WATER (2026-09-01). The centre's derived biome can
  // come up "water" like any tile's, but the centre is the BOARD's own tile —
  // `blocked`, `stepCostAt`, `scoutCostAt` and `landAt` all already exempt it,
  // and this was the one place that didn't. Left in, a water centre became a
  // JETTY: `navWater` true meant stepsFrom let you leave only the way you came,
  // and canMove priced the arrival with the wade-out reserve (returnVia) instead
  // of landBack — which on a far-side board is Infinity, so the figure standing
  // there was unreachable from any distance while every tile around them routed
  // fine. (The symptom: "21m to <name>" in red, but walk to the next tile and
  // the same step is suddenly legal.)
  const isShallow = g => {
    const k2 = key(g)
    let r = shallowMemo.get(k2)
    if (r === undefined)
      shallowMemo.set(k2, (r = !isCentre(g) && !isRiver(g) && typeNameAt(g) === "water" && deepnessAt(g) < SHALLOW))
    return r
  }
  const navWater = g => isRiver(g) || isShallow(g) // …so a centre is never navWater either
  // Everywhere a plain step can land from `g`, given the tile you arrived
  // from. Only leaving the water is restricted, so land is unchanged.
  function stepsFrom(g, from) {
    if (raft && eq(raft, g)) return walkNeighbors(g) // aboard: navigate the water, land anywhere
    const ns = walkNeighbors(g)
    if (!navWater(g)) return ns
    // ON FOOT, IN THE WATER — river or shallows alike: it is a jetty, not a
    // path. Back to the bank you waded in from, or over a bridge, and that is
    // all. (Which is what makes standing there worth something: you can look
    // across, and you can BUILD — a boat is raised from the water you're in.)
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
  // refuses, the shallows are water too (RULES 35), and water footing belongs
  // to the jetty/raft rules (stepsFrom) — a leap must never bypass them.
  function leapNeighbors(g) {
    if (!LEAP) return []
    if (navWater(g)) return [] // no leaping out of the water
    const out = []
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6
      const A = [g[0] + DIRS[i].q, g[1] + DIRS[i].r]
      const B = [g[0] + DIRS[j].q, g[1] + DIRS[j].r]
      if (!kindOf(A) || !kindOf(B)) continue
      if (!isDiscovered(A) || !isDiscovered(B)) continue // you leap over KNOWN ground
      const t = [g[0] + DIRS[i].q + DIRS[j].q, g[1] + DIRS[i].r + DIRS[j].r]
      if (!kindOf(t)) continue
      if (stepBlocked(g, A, i) || stepBlocked(g, B, j)) continue // walls pinch the exit vertex
      if (stepBlocked(A, B, (i + 2) % 6)) continue // a wall along the ridden edge
      if (stepBlocked(A, t, j) || stepBlocked(B, t, i)) continue // walls pinch the entry vertex
      // no leaping over (or onto) water, standable or deep — straits are for
      // boats and bridges (`blocked` alone stopped covering rivers/shallows
      // when they became standable water, RULES 30/35)
      if (blocked(A) || blocked(B) || blocked(t)) continue
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
  const isFrontier = g => !isDiscovered(g) && !!kindOf(g) && sightNeighbors(view().player).some(n => eq(n, g))

  // Routing is one Dijkstra sweep from the player over DISCOVERED ground —
  // one graph, boards and seam alike — minimising lexicographically:
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

  // ── terrain (two-octave world field — identity + texture, pure) ─────
  // BASE: the PUBKEY's 64 nibbles on the PARENT grid (the same inscribe()
  // as the home board — one grammar, two scales: home IS the world minimap),
  // interpolated between board centres so the macro field is continuous
  // across seams. The signing identity shapes the continents, permanently.
  // DETAIL: the generated WORLD KEY seeds per-board SHA-256 streams that
  // tweak the base ±7.5·DETAIL — the regenerable texture. Everything below
  // is a pure function of (pubkey, worldKey, position), cached.
  const utf8 = s => new TextEncoder().encode(s)
  const hexOf = bytes => [...bytes].map(b => b.toString(16).padStart(2, "0")).join("")
  const unitXY = g => ({ x: Math.sqrt(3) * (g[0] + g[1] / 2), y: 1.5 * g[1] })
  const boardBase = new Map() // parent "q,r" → 0..15 (the pubkey's nibble for that board)
  if (pubkey) {
    for (const [k2, ch] of inscribe(pubkey)) {
      boardBase.set(k2, ch.length === 1 ? parseInt(ch, 16) : [...ch].reduce((s, c) => s + parseInt(c, 16), 0) / 4)
    }
  }
  const hasTerrain = !!(pubkey || worldKey)
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
  // The board's subkey doubles as a secret key: getPublicKey(childSeed) makes
  // each NPC a REAL derivable nostr identity — anyone can recompute your
  // world's people (puppets of the world, by design). Stats read from that
  // pubkey with the same rule as the player's. Home has no NPC — the player
  // is home's figure. Placement: the board's centre, for now.
  const hexToBytes = s => Uint8Array.from({ length: 32 }, (_, i) => parseInt(s.slice(2 * i, 2 * i + 2), 16))
  // ONE MASTER PER SKILL (2026-09-01). Even inside the band, the top is rare
  // enough that a world can hold NO teacher at all for some skill — on a
  // sampled world six of the twelve had none, which is a dead end you can't
  // see or fix. So twelve boards, drawn deterministically from the world key,
  // are each raised to NPC_MAX in ONE skill: every world can carry you to the
  // band's top in everything, and finding who is the game. Derived from the
  // key, never stored — replay-safe, and the same world always has the same
  // twelve masters.
  let masterMap = null
  const masterSkillAt = c => {
    if (!worldKey) return null
    if (!masterMap) {
      const boards = readingOrder(RINGS).filter(t => t[0] || t[1]) // home keeps no figure
      let s = ""
      for (let i = 0; s.length < 4 * boards.length; i++) s += hexOf(sha256(utf8(worldKey + ":masters:" + i)))
      // Fisher-Yates off that stream, then the first twelve take the skills in
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
    if (!worldKey || !inBounds(c[0], c[1])) return null
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
    if (!b || b === "seam") {
      // seam: the mean of its interior flanks — fields cross the roads
      let s = 0
      let n = 0
      for (const d of DIRS) {
        const ng = [g[0] + d.q, g[1] + d.r]
        const nb = boardGeo(ng)
        if (nb && nb !== "seam") {
          s += combinedAt(ng)
          n++
        }
      }
      v = n ? s / n : 7.5
    } else {
      const p = unitXY(g)
      let sum = 0
      let wsum = 0
      for (const c of [b.c, ...Hex.neighbors(b.c)]) {
        const bb = boardBase.get(key(c))
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
      if (kindOf(ng)) {
        s += combinedAt(ng)
        n++
      }
    }
    return s / n
  }
  // the terrain-relevant neighbour: straight across a seam if one intervenes
  const acrossT = (g, d) => {
    let n = [g[0] + DIRS[d].q, g[1] + DIRS[d].r]
    let k2 = kindOf(n)
    if (k2 === "seam") {
      n = [n[0] + DIRS[d].q, n[1] + DIRS[d].r]
      k2 = kindOf(n)
    }
    return k2 === "in" ? n : null
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
      if (bg && bg !== "seam" && bg.c[0] === 0 && bg.c[1] === 0) v = "marsh"
    }
    biomeCache.set(gk, v)
    return v
  }

  // ── costs ────────────────────────────────────────────
  const stepCost = () => view().cost * MOVE_COST // move onto a known tile
  const scoutCost = () => view().cost * SCOUT_COST // reveal an adjacent tile, staying put
  // Resolve a hex's type NAME: the stored sparse map first (ONE per lattice,
  // on the parent tile, keyed by GLOBAL coord — interiors and seams alike),
  // then the derived terrain, then the kind's default. typeOf feeds costs;
  // the renderer reads the name for the land's look.
  const typeNameAt = g => {
    const stored = parentOf().tile.types[key(g)]
    if (stored) return stored
    return boardOf(g) ? (hasTerrain ? biomeAt(g) : "plain") : "seam"
  }
  const typeOf = g => TILE_TYPES[typeNameAt(g)]

  // ── skills in effect (nature + nurture) ─────────────────────────────
  // The player: starts at ONE in everything and learns to the full cap of 15 —
  // the key says how gifted, never where you begin. An NPC sits AT its nature,
  // which is also its ceiling (taught later).
  // edges filled by PRACTICE (doing the skill): PRACTICE_BASE actions = one edge
  const practiceEdges = skill => {
    let n = 0
    for (const k in PRACTICE_SKILL) if (PRACTICE_SKILL[k] === skill) n += practiced[k] || 0
    return n / PRACTICE_BASE
  }
  // total edges filled above nature — whole edges from LESSONS (each = 1) plus
  // fractions from PRACTICE, on the one shared shape
  const edgesOf = skill => (learned[skill] || 0) + practiceEdges(skill)
  // the LIVE progress of a skill, from ONE total-edge currency counted from
  // level 0: NATURE PRE-FILLS the edges of your base levels, lessons/practice
  // add more, teaching drains — and the drain digs into nature like anything
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
  // nature + LEARNED/PRACTICED (edges) − TAUGHT away. Floored at 0, capped at 15.
  const skillOf = skill => (STAT_NAMES.includes(skill) ? skillProgress(skill).level : 0)
  // AN NPC SITS AT ITS NATURE (2026-09-01; it used to start at half, like you,
  // which put the best teacher alive at ⌊15/2⌋ = 7 and walled the game there).
  // They've done this all their life — the half-start is the PLAYER's growth
  // arc, not theirs. So their nature (banded NPC_MIN..NPC_MAX) is where they
  // begin, and the best of them can carry you to NPC_MAX.
  // TEACHING still lifts them, now ABOVE their nature toward SKILL_CAP: you
  // give up your own hard-won edges to raise a figure past what they were born
  // with. That can't leak levels back to you — `teach` demands you already
  // outrank them — so the last three levels stay something you GRIND, never
  // something you're handed. The transfer is EDGE FOR EDGE: taught[] counts the
  // edges you handed over and the figure climbs its own shape with them,
  // exactly as you climb yours — a level lands only when its shape completes.
  const npcProgress = (npc, skill) => {
    const nature = npc.stats[skill]
    const { levels, rem } = levelsFromEdges((taught[key(npc.board)] || {})[skill] || 0, nature)
    const level = Math.min(SKILL_CAP, nature + levels)
    const sides = edgesForLevel(level)
    return {
      level,
      sides,
      filled: level >= SKILL_CAP ? sides : Math.min(sides, Math.floor(rem)),
      partial: level >= SKILL_CAP ? 0 : rem - Math.floor(rem)
    }
  }
  const npcSkill = (npc, skill) => npcProgress(npc, skill).level
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
    for (const t of readingOrder(RINGS)) {
      if (!t[0] && !t[1]) continue
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

  // ── height: elevation / deepness ─────────────────────
  // A tile's height as the game states and prices it. Beach pins to the
  // waterline: a beach can't sit higher than the water it edges, so it reads
  // WATER_LEVEL (4) whatever the field says. Water measures DEEPNESS below
  // the line (0 at the shore … 4 at the floor, off the smoothed field the
  // water rule and the depth shading already read) instead of height.
  const elevationAt = g => (typeNameAt(g) === "beach" ? WATER_LEVEL : Math.round(combinedAt(g)))
  const deepnessAt = g => {
    const glob = Math.max(0, Math.min(WATER_LEVEL, WATER_LEVEL - Math.round(smoothedAt(g))))
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
    // and only the excess counts as depth. Most ponds land at 0 (a puddle, as
    // before), the deeper cuts at 1, the rare sink at 2. Unrounded heights, so
    // the gradation is real rather than quantised into one bucket.
    const POND_RIM = 3
    return Math.max(0, Math.min(WATER_LEVEL, Math.round(s / n - combinedAt(g) - POND_RIM)))
  }
  // …and height works the legs EXPONENTIALLY, on top of the biome
  // multiplier: sea level (4) walks at 1×; each point above multiplies the
  // step by the elevation base — ~27× at the raw peak, a wall until the legs
  // are trained. TRAVEL (grown by walking — practice) eases the base from
  // ELEV_STEP toward ELEV_STEP_FIT at 15. Water mirrors it by deepness for
  // whatever floats later — on foot it's impassable anyway. Seams and
  // unterrained boards carry no height: 1×.
  const heightFactor = g => {
    if (!hasTerrain || !boardOf(g)) return 1
    const base = ELEV_STEP - (ELEV_STEP - ELEV_STEP_FIT) * (skillOf("travel") / SKILL_CAP)
    if (typeNameAt(g) === "water") return Math.pow(base, deepnessAt(g))
    return Math.pow(base, Math.max(0, elevationAt(g) - WATER_LEVEL))
  }
  // ── the pack on your back ──────────────────────────
  // The minute of the day: what the day began with, plus what you've eaten
  // into it, minus what's left — so eating never turns the clock back.
  const minuteOfDay = () => (dayStart ? dayStart.energy : SEED_MIN) + fed - energy
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
  const timeLeft = () => Math.min(energy, hungerLeft())
  const itemWeight = k => RESOURCES[k]?.weight ?? RECIPES[k]?.weight ?? 0
  const itemDef = k => RESOURCES[k] || RECIPES[k] || {}
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
      const life = itemDef(stash[sk].item).shelf
      if (!life) continue
      stash[sk].arr = stash[sk].arr.filter(i => now - i.at < life)
      if (!stash[sk].arr.length) delete stash[sk]
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
  const wornAt = g => {
    const b = boardOf(g)
    return b && b.node && b.node.worn ? b.node.worn[key(b.local)] || 0 : 0
  }
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
  const scoutTierAt = g => Math.max(1, Hex.length(g) - SEAM_RING + 1)
  // the first stat that bites: scout level discounts scouting — at 15,
  // half price. Learned levels replay from the log, so charges stay exact.
  const scoutCostAt = g =>
    scoutCost() * (isCentre(g) ? 1 : typeOf(g).scout) * scoutTierAt(g) * (1 - skillOf("scout") / 30)
  // The safe umbrella covers safe board INTERIORS only — the seam sits outside
  // the walls, so steps/scouts targeting it charge even while based at home.
  const freeAt = g => !!boardOf(g)?.node?.safe
  // Home is no longer free: every step/scout inside a safe board counts a flat
  // COST_BASE (1), tile by tile, so clearing home spans several days. Outside,
  // biome multipliers still apply.
  const stepChargeAt = g => (freeAt(g) ? COST_BASE : stepCostAt(g))
  const scoutChargeAt = g => (freeAt(g) ? COST_BASE : scoutCostAt(g))
  const pathCost = path => {
    let c = 0
    for (let i = 1; i < path.length; i++) c += stepCostAt(path[i])
    return c
  }
  const pathCharge = path => {
    let c = 0
    for (let i = 1; i < path.length; i++) c += stepChargeAt(path[i])
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
  // bank, step ashore, then walk. A small Dijkstra over the WATER only (the seam
  // is sparse), reading the land reserve at every shore it touches. The raft
  // travels with you, which is exactly why this is allowed to cross.
  const raftCache = new Map() // "q,r" → reserve by water, per sweep stamp
  let raftCacheStamp = -1
  function riverReserve(from) {
    if (raftCacheStamp !== worldStamp) (raftCache.clear(), (raftCacheStamp = worldStamp))
    const fk = key(from)
    const memo = raftCache.get(fk)
    if (memo !== undefined) return memo
    const land = reserveBase() // the walking map — see reserveBase on why not the raft's
    const dist = new Map([[fk, 0]])
    const q = [[0, from]]
    let best = Infinity
    while (q.length) {
      q.sort((a, b) => a[0] - b[0]) // the water is a handful of tiles — a plain sort is enough
      const [d, cur] = q.shift()
      if (d > (dist.get(key(cur)) ?? Infinity) || d >= best) continue
      for (const n of walkNeighbors(cur)) {
        if (!isDiscovered(n)) continue
        if (navWater(n)) {
          const nd = d + stepChargeAt(n)
          if (nd < (dist.get(key(n)) ?? Infinity)) {
            dist.set(key(n), nd)
            q.push([nd, n])
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
        const nd = d + stepChargeAt(n)
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
        const e = [top[0] + pr[0], top[1] + pr[1], top[2] + (Hex.distance(cur, n) > 1 ? 1 : 0)]
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
  // …the two readings of a tile in that map (afloat / on foot), best first
  const reachAt = t => {
    const m = reachMap()
    const a = m.get(key(t))
    const w = m.get(key(t) + RAFT_MARK)
    if (!a) return w || null
    if (!w) return a
    return ROUTE_CMP([w.charge, w.cost, w.leaps], [a.charge, a.cost, a.leaps]) < 0 ? w : a
  }

  // The ONE rule: you may go anywhere you can afford to reach AND still walk home
  // from — cost there + the reserve back within the time left. No position state,
  // no "exhausted" lock; when only homeward steps fit the budget, this alone
  // leaves them as the only legal moves. Never-strandable, and tight.
  function canMove(target) {
    if (!Array.isArray(target) || !kindOf(target) || !isDiscovered(target)) return false
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
    journalDiscover(parent.tile, key(c)) // stepping into it discovers it at the parent scale
    parent.trail.push(c) // full record at the parent scale too — no elastic erase
    parent.player = c.slice()
    const top = view()
    top.tile = childAt(parent.tile, key(c))
    top.key = key(c)
  }

  function stepOnto(g) {
    const v = view()
    // THE RAFT COMES ALONG ON THE WATER, and is left behind on land: navigating
    // river → river carries it; stepping ashore moors it where you set off from.
    if (raft && eq(raft, v.player) && navWater(g)) {
      raft = g.slice()
      worldStamp++ // where the raft is moored IS the movement graph — re-price everything
    }
    v.trail.push(g) // the trail is a full record of the day's walk — backtracking appends, never erases
    energy -= stepChargeAt(g) // flat COST_BASE inside a safe board, biome cost outside
    v.player = g
    const b = boardOf(g)
    if (b && !eq(b.c, parentOf().player)) parentStep(b.c)
    // this traversal paid full (charged above); the wear cheapens the NEXT one.
    // Home is flat (freeAt) and centres are rest spots — neither wears.
    // ONLY NOVEL GROUND TRAINS TRAVEL (RULES 26): the step practices the skill
    // only when it lands on wear-eligible ground being worn for the FIRST time —
    // exploration teaches; the daily commute over your own trails, home's flat
    // paths and the seam roads teach nothing. (Moving is the commonest action —
    // ungated it outgrew every other skill.) The display replay wears as it
    // re-walks (journalWorn), so this gate reads the same on both paths.
    if (b && b.node && !freeAt(g) && !isCentre(g)) {
      const wk = key(b.local)
      if (!((b.node.worn && b.node.worn[wk]) || 0)) practiced.move = (practiced.move || 0) + 1 // novel — the step trains travel
      journalWorn(b.node, wk)
    }
    markReachedEdges()
    openGateIfDue() // …and arriving on the doorstep of a board you have cleared opens it
  }

  // Standing beside the seam reaches those edges — a permanent ratchet.
  function markReachedEdges() {
    const b = boardOf(view().player)
    if (!b || !b.node) return
    for (const d of DIRS) {
      const n = [b.local[0] + d.q, b.local[1] + d.r]
      if (Hex.length(n) === SEAM_RING && isSeamHex(n)) {
        const lobes = seamLobesOf(n)
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
  function doRest() {
    bankGhost()
    const v = view()
    energy = dailyBudget()
    v.trail = [v.player.slice()]
    sleep()
  }

  // Scout: reveal an adjacent undiscovered tile without moving. Board tiles
  // are revealed in the board that owns them; seam tiles on the parent
  // (shared by every board of the edge) — same action, same rates.
  function doScout(target) {
    energy -= scoutChargeAt(target)
    practiced.scout = (practiced.scout || 0) + 1 // the scout trains scouting — counted AFTER pricing
    const b = boardOf(target)
    if (b) {
      journalDiscover(childAt(parentOf().tile, key(b.c)), key(b.local))
    } else {
      journalSeam(parentOf().tile, key(target))
    }
  }

  // ── gather / craft / build ──────────────────────────
  // What the tile under your feet yields: its biome's SET (BIOME_YIELD).
  // Centres, roads and anything off-board give nothing — and NEITHER does the
  // home board: its tiles are the identity/minimap, not land (same rule as
  // landAt), so their hidden terrain is never surfaced as a harvest. You
  // gather out in the real world, past the seam.
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
  // isn't land at all: off-board (seam), a board CENTRE (the board's own tile,
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
  // ── forage & hunt (RULES 43) ────────────────────────
  // What this tile actually offers: the entries of its biome's set it is a
  // node for. FORAGE is taken by hand (gather); a HUNT needs a tool of the
  // kind the resource names on your back (hunt). Both are one TAKE: the
  // resource's minutes × the tool's speed × the verb's skill ease.
  const yieldsAt = g => {
    const land = landTypeAt(g)
    if (!land) return []
    return (BIOME_YIELD[land] || []).filter(res => isNode(g, res))
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
  // the tool a hunt can't happen without, when you haven't got one
  const lacksGear = res => {
    const kind = RESOURCES[res]?.hunt
    return kind && !bestTool(kind) ? kind : null
  }
  const takeCostAt = (g, res) => {
    if (!yieldsAt(g).includes(res)) return Infinity
    const d = RESOURCES[res]
    return d.min * toolSpeed(d.hunt || d.tool) * (1 - skillOf(verbOf(res)) / 30)
  }
  // each resource keeps its own regrow clock on a tile — picking the berries
  // leaves the nuts alone
  const regrowKey = (g, res) => key(g) + "|" + res
  const takeReadyAt = (g, res) => worldMin() - (gatheredAt[regrowKey(g, res)] ?? -1e9) >= RESOURCES[res].regrow
  // FOOD IS TIME (RULES 37) — the nourishment of a kind, and what an eat of
  // `f` minutes would ACTUALLY add today: clipped by the daily ration cap and
  // by the waking cap (the window can never outgrow the day less its sleep).
  const foodOf = k => RESOURCES[k]?.food || 0
  const eatBoostOf = f =>
    Math.max(0, Math.min(f, EAT_CAP - fed, WAKE_CAP - ((dayStart ? dayStart.energy : SEED_MIN) + fed)))
  const cookCost = () => COOK_MIN * (1 - skillOf("cook") / 30) // eased like gathering — half at 15
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
  // GLOBAL coord, so it works the same on a board, on a seam, anywhere — which
  // is what the bridge haul needs (carry rubble to a river tile, leave it,
  // come back with more). Still one item TYPE per cell.
  const stashKeyAt = g => (kindOf(g) ? key(g) : null)
  // how many of `item` lie on the tile underfoot (0 if the pile is something
  // else — one type per cell), and spending them: what a build takes, it takes
  // off the GROUND, not off your back. You haul it here first.
  const pileAt = (g, item) => {
    const sk = stashKeyAt(g)
    const s = sk && stash[sk]
    return s && s.item === item ? s.arr.length : 0
  }
  const spendPile = (g, n) => {
    const s = stash[stashKeyAt(g)]
    if (!s) return
    s.arr.splice(0, n)
    if (!s.arr.length) delete stash[stashKeyAt(g)]
  }
  // A TAKE (gather or hunt) is legal when the tile offers the resource, the
  // verb matches (fish are never picked up by hand), it has regrown, the tool
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
    practiced[verb] = (practiced[verb] || 0) + 1 // the take trains its verb
    addItem(res)
    gatheredAt[regrowKey(g, res)] = worldMin() // this resource's regrow clock on this tile starts now
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
    journalDiscover(cv.tile, key(start))
  }

  // Our own safe space: the walled home board with its angle-seeded gate.
  function doEnterHome() {
    const v = view()
    const child = childAt(v.tile, key(v.player))
    child.discovered.add(key([0, 0])) // the centre special tile starts known (pre-day; not journaled)
    child.safe = true
    stack.push(
      frame(child, key(v.player), {
        cost: v.cost / SCALE_RATIO,
        entry: [0, 0],
        player: [0, 0],
        trail: [[0, 0]]
      })
    )
    // Seal the board: every border hex walls its outward sides — including
    // the gate edge (the doorstep side the seed angle exits through), which
    // starts CLOSED. journalDiscover clears that one bit when the board is
    // cleared. Walls are plain per-hex-side data; nothing here is home-only.
    if (!child.gate) {
      for (const t of Hex.ring([0, 0], RINGS)) {
        let bits = 0
        for (let d = 0; d < 6; d++) {
          if (Hex.length([t[0] + DIRS[d].q, t[1] + DIRS[d].r]) > RINGS) bits |= 1 << d
        }
        child.walls[key(t)] = bits
      }
      // `at` is the doorstep as a GLOBAL key, for the rubble the wall leaves
      // (fellWall). On the home board local IS global — its centre is [0,0] —
      // and home is the only gated board there is; carrying the global coord
      // means a gate elsewhere would have to state its own, not inherit this.
      child.gate = { k: gateEdge.k, side: gateEdge.side, at: gateEdge.k }
    }
    worldStamp++
  }

  // Sleep: bank the day's actions (with the day-start snapshot they replay
  // from), advance the day, snapshot the new day's start.
  function sleep() {
    if (log.length) history.push({ day, actions: log, start: dayStart })
    day++
    fed = 0 // the second wind was today's — a new day starts on its own budget
    mealAt = HUNGER_MAX // …and wakes with the meal clock fresh
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
    energy = dailyBudget()
    doEnterHome()
    sleep()
  }

  // ── snapshots (how a day's start is remembered) ──────
  const snap = () => ({
    energy,
    fed,
    mealAt,
    day,
    learned: { ...learned },
    given: { ...given },
    practiced: { ...practiced },
    everTook,
    inventory: Object.fromEntries(Object.entries(inventory).map(([k, arr]) => [k, arr.map(i => ({ ...i }))])),
    stash: Object.fromEntries(Object.entries(stash).map(([sk, s]) => [sk, { item: s.item, arr: s.arr.map(i => ({ ...i })) }])),
    bridges: [...bridges],
    raft: raft ? raft.slice() : null,
    gatheredAt: { ...gatheredAt },
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
    mealAt = s.mealAt ?? HUNGER_MAX
    day = s.day
    learned = { ...(s.learned || {}) }
    given = { ...(s.given || {}) }
    practiced = { ...(s.practiced || {}) }
    everTook = !!s.everTook
    inventory = Object.fromEntries(Object.entries(s.inventory || {}).map(([k, arr]) => [k, arr.map(i => ({ ...i }))]))
    stash = Object.fromEntries(
      Object.entries(s.stash || {}).map(([sk, st]) => [sk, { item: st.item, arr: st.arr.map(i => ({ ...i })) }])
    )
    bridges = new Set(s.bridges || [])
    raft = s.raft ? s.raft.slice() : null
    gatheredAt = { ...(s.gatheredAt || {}) }
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
    for (const d of todayDiscovered) (d.seam ? d.tile.seamDiscovered : d.tile.discovered).delete(d.key)
    for (const r of todayReached) r.tile.reachedEdges.delete(r.i)
    for (const w of todayWorn) w.node.worn[w.key] = (w.node.worn[w.key] || 0) - 1 // rewind today's wear
    worldStamp++ // the rewind changed the walkable world under the caches
    restore(dayStart)
  }
  function endReplay() {
    for (const d of todayDiscovered) (d.seam ? d.tile.seamDiscovered : d.tile.discovered).add(d.key) // permanent
    for (const r of todayReached) r.tile.reachedEdges.add(r.i)
    for (const w of replayWorn) w.node.worn[w.key] = (w.node.worn[w.key] || 0) - 1 // undo the re-walk's wear, however far it got…
    replayWorn = []
    for (const w of todayWorn) w.node.worn[w.key] = (w.node.worn[w.key] || 0) + 1 // …and put the lived day's back
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
    // debris of a cleared board's wall pays for: not a crossing, a VEHICLE. It
    // moors where you leave it and only moves under you (see stepsFrom).
    //
    // PAID IN DEBRIS ON THE GROUND (RULES 33): the loads must already be lying
    // on this tile — hauled here one at a time and dropped, which is the whole
    // of the materials price (DESIGN.md, *Rivers*: "the haul") — AND IN
    // MINUTES (RULES 38): lashing it together takes RAFT_MIN, guarded by the
    // reserve like every other timed work: the way home (still on foot — the
    // raft doesn't exist until the minutes are spent) must survive the spend.
    raft: {
      can: () =>
        !raft &&
        navWater(view().player) &&
        pileAt(view().player, "debris") >= RAFT_DEBRIS &&
        RAFT_MIN + returnCost() <= timeLeft(),
      run: () => {
        energy -= RAFT_MIN
        spendPile(view().player, RAFT_DEBRIS)
        raft = view().player.slice()
        worldStamp++
      }
    },
    // BRIDGE the river you're standing in, to a LAND tile beside it — you pick
    // which one, and that choice is the crossing (permanent, both ways). A
    // bridge never lands on water: the far end is always a board tile. Three
    // loads of debris on the tile — heavy permanent work, three hauls to the
    // raft's one. (No UI raises one yet; the rule and its price are here.)
    bridge: {
      can: a => {
        const p = view().player
        if (!isRiver(p) || !a.to || !kindOf(a.to)) return false
        if (isRiver(a.to) || !isDiscovered(a.to)) return false // land only, and land you've seen
        if (!walkNeighbors(p).some(n => eq(n, a.to))) return false // adjacent, unwalled, walkable
        if (!cameFrom()) return false // you build it standing in the water, having waded in
        if (pileAt(p, "debris") < BRIDGE_DEBRIS) return false // three loads, already hauled here
        return !hasBridge(p, a.to)
      },
      // A BRIDGE SPANS THE WATER: it joins the bank you waded in from to the
      // bank you chose, over the tile you're standing in. Both ends are
      // recorded, or crossing would be one-way — you'd get to the far side and
      // find the river offering only the way you'd just come.
      run: a => {
        const p = view().player
        spendPile(p, BRIDGE_DEBRIS)
        bridges.add(bridgeKey(p, a.to))
        bridges.add(bridgeKey(p, cameFrom()))
        worldStamp++
      }
    },
    // DROP one item off your back onto the tile underfoot. It STAYS there —
    // any tile, anywhere — and `take` picks it back up. One item type per
    // tile. Free and instant.
    drop: {
      // NOTHING IS EVER LOST. A drop that has nowhere to land is REFUSED, so
      // the thing stays on your back — it never leaves the pack unless a tile
      // takes it. (This is what "dropping outside discards it" used to do
      // instead, and what made a drop on the home centre vanish: the centre
      // wasn't a cell, so the item came off your back and went nowhere.)
      can: a => {
        if (!a.item || countOf(a.item) < 1) return false
        const sk = stashKeyAt(view().player)
        if (!sk) return false // this ground can't hold anything
        if (stash[sk] && stash[sk].item !== a.item) return false // one type per cell
        return true
      },
      run: a => {
        const sk = stashKeyAt(view().player)
        const inst = sk && takeInstance(a.item)
        if (!inst) return // can() has already vouched for both; belt and braces
        const s = stash[sk] || (stash[sk] = { item: a.item, arr: [] })
        s.arr.push(inst)
        worldStamp++ // the pack and the tile both changed
      }
    },
    // TAKE one item back from the stash cell underfoot, if it fits the pack.
    take: {
      can: () => {
        const sk = stashKeyAt(view().player)
        const s = sk && stash[sk]
        if (!s || !s.arr.length) return false
        return loadOf() + itemWeight(s.item) <= carryCap()
      },
      run: () => {
        const sk = stashKeyAt(view().player)
        const s = stash[sk]
        ;(inventory[s.item] = inventory[s.item] || []).push(s.arr.shift()) // oldest out first
        if (!s.arr.length) delete stash[sk]
        everTook = true // the gesture is learned
        worldStamp++
      }
    },
    // FORAGE by hand, or HUNT with a tool — one take, two verbs, each training
    // its own skill (RULES 43). A gather without an item is a pre-43 log entry.
    gather: { can: a => canTake(a.item || defaultTake(), "gather"), run: a => doTake(a.item || defaultTake(), "gather") },
    hunt: { can: a => canTake(a.item, "hunt"), run: a => doTake(a.item, "hunt") },
    // EAT — food is time (RULES 37). Two minutes to sit and eat the OLDEST
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
    // or a camp — a fire you rest by). One raw food → one unit of the COOKED
    // KIND it makes (`fish` → `cooked fish`), which carries the worth and the
    // keeping of its own (RULES 48). Costs minutes eased by the cook skill,
    // and trains it — the first SPACE-pillar transform.
    cook: {
      can: a => {
        if (!a.item || RESOURCES[a.item]?.cooked || !foodOf(a.item)) return false // fire on RAW matter only
        if (!restSpots.some(sp => eq(sp, view().player))) return false
        if (countOf(a.item) < 1) return false
        return cookCost() + returnCost() <= timeLeft()
      },
      run: a => {
        energy -= cookCost()
        practiced.cook = (practiced.cook || 0) + 1
        takeInstance(a.item)
        addItem(cookedOf(a.item)) // its worth and its keeping are the KIND's — the instance is just a date
        worldStamp++ // a raft of fish became one meal — the load changed, so the caches must re-price
      }
    },
    // craft: YOU make it, anywhere (RULES 39) — home and the board centres
    // included. Your own craft level against the recipe's, the materials off
    // your own back, your own minutes; it trains craft like every other verb
    // you perform. Only a recipe that names a `site` asks anything of the
    // ground under you. Products are lighter than their inputs, so the
    // current-load reserve stays safe.
    craft: {
      can: a => {
        const r = RECIPES[a.recipe]
        if (!r) return false
        if (skillOf("craft") < r.level) return false
        if (r.site && landTypeAt(view().player) !== r.site) return false // this one wants its ground
        // ONE OF A KIND (RULES 44): you carry one tool of a kind. An upgrade
        // consumes the one you hold (it sits in its needs); anything else that
        // would make a second is refused.
        const have = r.tool ? carriedTool(r.tool) : null
        if (have && !(r.needs[have] > 0)) return false
        for (const k in r.needs) if (countOf(k) < r.needs[k]) return false
        return r.min + returnCost() <= timeLeft()
      },
      run: a => {
        const r = RECIPES[a.recipe]
        energy -= r.min
        for (const k in r.needs) consume(k, r.needs[k])
        addItem(a.recipe)
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
    // A lesson: LESSON_COST minutes beside a teacher who currently outranks
    // you in that skill. Talent (your key's innate) sets the xp gained; your
    // level clamps to the teacher's — nobody teaches past what they know.
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
        // lesson never carries you past them.
        energy -= lessonTime(skillOf(a.skill))
        learned[a.skill] = (learned[a.skill] || 0) + 1
      }
    },
    // Teaching: the mirror of a lesson. LESSON_COST minutes beside a figure you
    // OUTRANK in a skill — ONE EDGE moves from your shape to theirs: yours drains
    // by one (an empty shape gives up the level itself), theirs fills by one and
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
        given[a.skill] = (given[a.skill] || 0) + 1 // −1 edge OUT of yours — the same edge, moved
      }
    },
    enter: { can: () => canEnter(), run: () => doEnter() },
    rest: {
      // any RESTING PLACE ends the day: the home centre, or a built camp —
      // but only after a day that HAPPENED (2026-08-10): with an empty log
      // there is nothing to sleep off and nothing to dream, and resting would
      // just burn the day for a fresh budget. Do something first.
      can: () => log.length > 0 && restSpots.some(s => eq(s, view().player)),
      run: () => doRest()
    },
    // Dev helper: reveal the whole current board at once (free) — exactly as
    // if every hex had been scouted, so the gate condition applies normally:
    // cleared from anywhere but the doorstep, the board still waits for the walk.
    // Logged, so replay reproduces it.
    clearBoard: {
      can: () => !!boardOf(view().player),
      run: () => {
        const b = boardOf(view().player)
        const node = childAt(parentOf().tile, key(b.c))
        for (const h of Hex.range(RINGS)) journalDiscover(node, key(h))
      }
    },
    // The whole-map sibling of clearBoard: every board of the parent field
    // (interior + its standing at the parent scale) and every seam between
    // them. Free, like clearBoard — a dev helper, not a play move.
    clearMap: {
      can: () => true,
      run: () => {
        const parent = parentOf().tile
        let R = 0
        for (const ph of Hex.range(RINGS)) {
          journalDiscover(parent, key(ph))
          const node = childAt(parent, key(ph))
          for (const h of Hex.range(RINGS)) journalDiscover(node, key(h))
          R = Math.max(R, Hex.length(boardCentre(ph)))
        }
        for (const g of Hex.range(R + RINGS + 2)) if (kindOf(g) === "seam") journalSeam(parent, key(g))
      }
    },
    goHome: { can: () => true, run: () => goHomeRun() }
  }

  // Validate + mutate, no logging — replay re-applies banked actions with this.
  function apply(action) {
    const h = ACTIONS[action.type]
    if (!h) return { ok: false, reason: "unknown action " + action.type }
    pruneSpoiled()
    if (!h.can(action)) return { ok: false, reason: action.type + " rejected" }
    h.run(action)
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
    h.run(action)
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
      h.run(action)
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
    energy: () => energy,
    timeLeft, // what you can still spend today: the budget, or the minutes until the next meal is due — whichever is less (RULES 42)
    hungerLeft, // minutes until the next meal is due
    mealDue, // …as a minute of the day (the clock's deadline pin binds to it)
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
    smoothAt: g => (hasTerrain ? smoothedAt(g) : null), // the smoothed field — water depth reads from this
    // the board's MAIN land type — the most common biome across its 60 land
    // tiles (the centre isn't land); the trait the overviews report
    boardMainType: mainTypeOf,
    // a land tile's own facts (biome, elevation, its costs, what it yields) —
    // the inspected side of the menu, parallel to a figure's stats.
    // The board CENTRE is NOT land: a board is 60 land tiles + 1 centre — the
    // centre is the BOARD's own tile (its type and info are the board's, and
    // the key's middle four chars there are a reserved extra layer, TBD), so
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
      const water = biome === "water"
      return {
        biome,
        elevation: water ? null : elevationAt(g), // land only — water reads deepness instead
        deepness: water ? deepnessAt(g) : null,
        move: Math.round(t.move * heightFactor(g) * 100) / 100, // the EFFECTIVE multiplier a step here pays
        scout: t.scout,
        impassable: !!t.impassable && !isShallow(g), // the shallows take a wader (RULES 35)
        // what the biome OFFERS (a tile's own nodes you learn by standing there)
        yields: (BIOME_YIELD[biome] || []).map(r => (RESOURCES[r].hunt ? `${r} (${RESOURCES[r].hunt})` : r)).join(" · ") || "—"
      }
    },
    npcAt,
    playerStats: () => (pubkey ? statsOf(pubkey) : null),
    skillOf,
    skillProgress, // { level, sides, filled, partial } — the shape the renderer fills
    lessonCost: skill => lessonTime(skillOf(skill)), // minutes the NEXT lesson costs (rises with level)
    npcSkill,
    npcProgress,
    learnable,
    // EVERYTHING YOU COULD MAKE IS LISTED — the menu's own rule (a category
    // that hides its contents can't teach them), so this returns every recipe
    // in the game with the FIRST reason it's out of reach, or null when it
    // isn't: `{ k, site, level, needs, cost, why }`. The menu greys a row and
    // prints its `why`; `cost` is the eased minutes for the clock's estimate.
    // `site` is null for a recipe you can make anywhere (the crude tier, all
    // of it) — the menu says "anywhere" rather than naming a biome.
    craftList: () => {
      const here = landTypeAt(view().player)
      return Object.keys(RECIPES).map(k => {
        const r = RECIPES[k]
        const short = Object.keys(r.needs).filter(n => countOf(n) < r.needs[n])
        const have = r.tool ? carriedTool(r.tool) : null
        const why =
          skillOf("craft") < r.level
            ? `needs craft ${r.level}`
            : r.site && here !== r.site
              ? `only on ${r.site} land`
              : have && !(r.needs[have] > 0)
                ? `you already carry a ${r.tool}`
                : short.length
                  ? `needs ${short.map(n => `${r.needs[n] - countOf(n)} more ${n}`).join(" · ")}`
                  : r.min + returnCost() > timeLeft()
                    ? "not enough time left"
                    : null
        return { k, site: r.site || null, level: r.level, needs: { ...r.needs }, cost: r.min, why }
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
    nibbleAt,
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
    // clipped by the caps). cookList: every RAW food that a hearth could turn
    // into a meal, with the meal's worth and the cook's eased minutes.
    eatList: () =>
      Object.keys(inventory)
        .map(k => {
          const f = countOf(k) ? foodOf(k) : 0
          return f > 0 ? { k, food: eatBoostOf(f), cost: EAT_MIN } : null
        })
        .filter(Boolean),
    cookList: () =>
      Object.keys(inventory)
        .filter(k => !RESOURCES[k]?.cooked && foodOf(k) > 0 && countOf(k) > 0) // the fire takes raw matter, never its own work
        .map(k => ({ k, food: foodOf(cookedOf(k)), cost: Math.ceil(cookCost()) })),
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
    isShallow, // …board water a raft can cross (deepness 0) — impassable on foot
    navWater, // …either kind: everything the raft may navigate
    inRiver: () => isRiver(view().player),
    onWater: () => navWater(view().player), // river OR shallows — where you're afloat
    raftAt: () => (raft ? raft.slice() : null), // where the raft is moored, or null
    aboard, // …and whether you're standing on it
    // THE BUILD ON THE WATER, as the menu needs it: what a raft here would take
    // and what's actually lying underfoot. null on dry land — the only place the
    // question means nothing.
    raftPlan: () => {
      const p = view().player
      if (!navWater(p)) return null
      return { needs: RAFT_DEBRIS, have: pileAt(p, "debris"), built: !!raft, here: !!raft && eq(raft, p) }
    },
    hasBridge: (a, b) => hasBridge(a, b),
    bridges: () => [...bridges].map(bk => bk.split("|").map(k2 => k2.split(",").map(Number))),
    bridgeTargets: () => {
      const p = view().player
      if (!isRiver(p)) return []
      return walkNeighbors(p).filter(n => !isRiver(n) && isDiscovered(n) && !hasBridge(p, n))
    },
    // storage: the stash on the tile underfoot (a home tile is a cell), plus
    // every stashed cell for the map — { item, n }
    canStash: () => !!stashKeyAt(view().player),
    everTook: () => everTook, // …and whether the pick-up gesture has ever been used
    stashHere: () => {
      const sk = stashKeyAt(view().player)
      const s = sk && stash[sk]
      return s ? { item: s.item, n: s.arr.length } : null
    },
    // every pile in the world — `at` is the GLOBAL tile it lies on (RULES 29;
    // it used to be a home-board-local coord, back when only home tiles held)
    stashes: () =>
      Object.entries(stash).map(([sk, s]) => ({
        at: sk.split(",").map(Number),
        item: s.item,
        n: s.arr.length
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
    // yield, whether ANY of them is ready, and the slowest regrow among the
    // ones you've picked (0..1). The map's gather mark reads this.
    gatherStateAt: g => {
      const ys = yieldsAt(g)
      if (!ys.length) return null
      let progress = 1
      for (const res of ys) {
        const last = gatheredAt[regrowKey(g, res)]
        if (last != null) progress = Math.min(progress, (worldMin() - last) / RESOURCES[res].regrow)
      }
      return { res: ys[0], ready: ys.some(res => takeReadyAt(g, res)), progress: Math.max(0, Math.min(1, progress)) }
    },
    // the regrow ring for ONE tile — { ready, progress } for the slowest of the
    // yields you've picked there, else null. Per-tile so the renderer can bake
    // it with the ground instead of sweeping every gathered tile each frame.
    regrowRingAt: g => {
      let progress = null
      for (const res of yieldsAt(g)) {
        const last = gatheredAt[regrowKey(g, res)]
        if (last == null) continue
        const p = (worldMin() - last) / RESOURCES[res].regrow
        if (progress == null || p < progress) progress = p
      }
      if (progress == null) return null
      return { ready: progress >= 1, progress: Math.max(0, Math.min(1, progress)) }
    },
    canAct: a => !!ACTIONS[a.type] && !replaying && !!ACTIONS[a.type].can(a),
    // rules queries (all coordinates GLOBAL)
    kindOf,
    boardHexOf,
    boardCentreOf,
    centreOf: boardCentre, // parent hex → its board's global centre (minimap detail)
    isDiscovered,
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
