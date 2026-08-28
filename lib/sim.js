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
export const FREE_CAP = 1440 // a full day (24h) is the ceiling on daily minutes
export const COST_BASE = 1 // the unit: the level base at the playing depth (MAX_DEPTH) — everything prices off 1
export const WEAR_FLOOR = 0.5 // a worn path bottoms out at half its terrain cost — never free
export const WEAR_STEP = 0.2 // each PRIOR traversal shaves this off the step multiplier, down to the floor
export const SCALE_RATIO = 6 // each level UP multiplies the base by this (1 inside a tile → 6 home interior → 36 outside)
export const MOVE_COST = 2 // moving onto a KNOWN tile costs this × the level base (one-way: 2 at the playing depth)
export const SCOUT_COST = 1 // SCOUT costs this × base — discovering is cheap; walking there is the commitment
export const LEAP = false // the leapfrog power move: jump the DIAGONAL — the tile beyond the edge
// two adjacent neighbours share — for ONE step's price (the landing tile's).
// OFF from 2026-08-03 (RULES 30): a leap over a seam is FORDING a river, and a
// river must refuse that. The rule below is intact for when it returns as an
// earned ability (a skill level that lets you ford) — see DESIGN.md, *Rivers*.
export const SCHEMA = 3 // save format version — the shape of the serialized object (3: world.worldKey)
export const RULES = 37 // replay-rules version (37: FOOD IS TIME — eat (2m) turns a food's nourishment into extra waking minutes today (+60/day cap, midnight ceiling), cook (10m, at a hearth = any resting place) triples it into a meal; both consume dated instances, so any log that carried food replays to different budgets; 36: FISHING TAKES TACKLE — water yields fish only to a NET on your back, so a log that fished bare-handed no longer replays; 35: THE SHALLOWS ARE WATER YOU CAN STAND IN — board water of deepness 0 reads exactly like a river now (wade in from a bank, leave only that way or by bridge, build a boat there) and a raft crosses it, so reach, routes and the reserve all move; 33: THE HAUL — the felled wall leaves a pile of DEBRIS on the doorstep, and raft/bridge are paid for in loads of it dropped on the water (they were free), so an old log's crossing no longer replays; 32: SCOUTING PRICED IN STEPS — 1× home and its river ring, 2× the first shore, 3× beyond, so old days replay with different budgets (31 was a gentler ramp); 30: RIVERS — every seam is water: no river→river step, and leaving one is only back the way you came or over a BRIDGE, so old routes replay differently; 29: DROPS PERSIST — every tile is a storage cell keyed by GLOBAL coord, so an old save's home-local stash keys would read as the wrong tiles; 28: metal nodes 0.09→0.3 — the node layout shifts, so old gathers replay differently; and RULES 27's shape-is-the-level ladder) — bump on ANY change that alters what an old
// log replays to (costs, movement, gating); mismatched saves reset in dev

// ── practice: learning by DOING ────────────────────────
// Every action of a kind counts toward the skill it exercises (a step trains
// travel, a scout trains scout). Crossing a threshold bumps that skill a
// level, and thresholds DOUBLE per level (exponential backoff): level k
// lands at PRACTICE_BASE·(2^k − 1) actions total — the early levels come
// quick, the last ones take an age.
export const PRACTICE_BASE = 20
export const PRACTICE_SKILL = { move: "travel", scout: "scout", gather: "gather", build: "build", cook: "cook" } // action kind → the skill it trains (crafting is an NPC service, not self-taught).
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
// Every hex can carry a type (sparse: tile.types["q,r"] for board interiors,
// tile.seamTypes[globalKey] for seam tiles); absent = plain for board
// interiors, seam for seam tiles. A type's properties are cost MULTIPLIERS on
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
// (heal·lore·dream·build). scout sits at 12 o'clock. See DESIGN "the three pillars".
export const STAT_NAMES = ["scout", "travel", "gather", "craft", "hunt", "cook", "heal", "lore", "dream", "build", "farm", "trade"]
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
// Everyone starts at HALF their nature and grows by learning. The asymmetry:
// the PLAYER can reach full stats (cap 15 — perseverance always pays, talent
// only sets the pace and the head start); an NPC is capped by its key (its
// nature IS its ceiling) — experts keep permanent value. Learned progress is
// STATE, replayed from the log; nature stays pure.
export const SKILL_CAP = 15
export const baseLevel = innate => Math.floor(innate / 2)
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
// a lesson's TIME rises with the level you're at — a small, steady drag
export const LESSON_COST = 6 // base minutes for a lesson (at level 0)
export const LESSON_STEP = 2 // + minutes per current level
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
// it does mechanically. Only scout has a live effect today; the rest read "—"
// until their mechanic lands. Edit freely as skills gain rules.
export const SKILL_INFO = {
  travel: { home: "water", flavour: "they know the ways across", effect: "—" },
  gather: { home: "plain", flavour: "the open forage", effect: "—" },
  build: { home: "mountain", flavour: "stone sense", effect: "—" },
  craft: { home: "forest", flavour: "timber hands", effect: "—" },
  trade: { home: "beach", flavour: "harbours and meetings", effect: "—" },
  scout: { home: "cliff", flavour: "the vantage", effect: "cheapens scouting — toward half price at level 15" },
  farm: { home: "marsh", flavour: "the fertile work", effect: "—" },
  lore: { home: "peak", flavour: "the summit sages", effect: "—" },
  // the 4 celestial skills — no home biome (placeholder flavour, tuned later)
  hunt: { home: "—", flavour: "the patient chase", effect: "—" },
  cook: { home: "—", flavour: "the warm hearth", effect: "—" },
  heal: { home: "—", flavour: "the mending hand", effect: "—" },
  dream: { home: "—", flavour: "the far sight", effect: "—" }
}
export const PLACE_BONUS = 3

// what each biome yields — the resource you'd gather there (mechanics later)
export const BIOME_YIELD = {
  water: "fish",
  beach: "fish",
  marsh: "plants",
  plain: "plants",
  forest: "wood",
  mountain: "rock",
  cliff: "eggs",
  peak: "metal"
}

// ── the gather / craft / build layer ─────────────────────────────────
// RESOURCES: what a gather takes (minutes, before the gather skill eases
// it), what a unit weighs on your back, the tile's REGROW clock (how many
// world-minutes — 1440/day, sleep included — until it yields again), and a
// SHELF life: the raw harvest spoils and is lost after this many world-
// minutes (omit = keeps forever). Food rots; stone and metal don't. You
// can't hoard a harvest — you carry it back and use it, or lose it.
export const RESOURCES = {
  // `food` is NOURISHMENT IN MINUTES (RULES 37): what eating one raw unit adds
  // to today's waking window. Cooking multiplies it (COOK_MULT) into a meal.
  plants: { weight: 1, min: 3, regrow: 120, shelf: 4320, food: 6 }, // 3 days
  fish: { weight: 2, min: 5, regrow: 1440, shelf: 1440, food: 12 }, // 1 day — spoils fast
  eggs: { weight: 1, min: 4, regrow: 4320, shelf: 5760, food: 9 }, // 4 days
  wood: { weight: 3, min: 6, regrow: 10080 }, // seasons — effectively keeps
  rock: { weight: 5, min: 8, regrow: 262800 },
  metal: { weight: 6, min: 10, regrow: 525600 },
  // DEBRIS is the one material nobody forages: no biome yields it (BIOME_YIELD),
  // so no tile is ever a node for it and `min`/`regrow` would never be read. It
  // appears as a PILE where a cleared board's wall came down (see fellWall) and
  // moves only by hand — take, carry, drop. The HEAVIEST thing in the game: one
  // load fills a base pack on its own, so a haul is one trip at double the step
  // cost, which is exactly what DESIGN.md's *Rivers* asks a haul to feel like.
  debris: { weight: 6 },
  // the MEAL — cooked food, the only item that carries its nourishment PER
  // INSTANCE ({ at, food }): it remembers what it was cooked from. Nothing
  // forages it (no BIOME_YIELD entry), the hearth makes it. Shelf ONE day —
  // meals are for the trip, not the hoard (stockpiling is the STORE's job,
  // future tech); weight 1 ≤ every raw food, so cooking never breaks the
  // load-priced reserve.
  meal: { weight: 1, shelf: 1440 }
}
// FOOD IS TIME (RULES 37) — the knobs. Eating spends EAT_MIN minutes and adds
// the food's nourishment to TODAY's waking window: at most EAT_CAP a day (the
// sacred baseline again — a second wind, not a second day), and never past
// midnight (FREE_CAP). Cooking (at a hearth: any resting place) spends
// COOK_MIN (eased by the cook skill, half at 15) and turns one raw unit into
// a meal worth COOK_MULT× its nourishment.
export const EAT_MIN = 2
export const EAT_CAP = 60
export const COOK_MIN = 10
export const COOK_MULT = 3
// What the haul buys, in loads of debris (DESIGN.md, *Rivers*): a raft is the
// cheap starter vehicle, a bridge the permanent, heavy work — and the felled
// wall leaves a bridge's worth on the doorstep, so the first choice you make
// on the water is which of the two you spend it on.
export const RAFT_DEBRIS = 1
export const BRIDGE_DEBRIS = 3
export const WALL_DEBRIS = 3
// RECIPES: crafting is a SERVICE the NPCs sell. Each recipe belongs to a
// `biome` — only a figure NATIVE to that land (their board's main type) can
// make it, and only at `level` in that land's skill (BIOME_SKILL[biome]).
// You bring the materials to them; they turn `min` minutes and hand it back.
// The crude tier: the plains weaver's basket (raises carry AND keeps food
// fresher — the first storage tech), the forest wright's axe (halves wood
// gathering, but WEARS — `uses` cuts before it breaks).
export const RECIPES = {
  basket: { biome: "plain", needs: { plants: 5 }, min: 10, level: 2, weight: 1, carry: 4, keeps: 1.5 },
  axe: { biome: "forest", needs: { wood: 2, rock: 1 }, min: 12, level: 2, weight: 2, uses: 12 },
  // the NET — tackle, and the only way fish come out of the water (RULES 36).
  // Woven by the same plains hands as the basket, out of the same plants: water
  // is everywhere once you can wade, so what gates fishing is the GEAR, not the
  // going. (A boat is not required and never was — you fish from the shallows.)
  net: { biome: "plain", needs: { plants: 4 }, min: 12, level: 2, weight: 1, catches: "fish" }
}
// BUILDS: permanent structures raised on the tile you stand on — materials
// on your back, build knowledge, and time. The camp becomes a RESTING
// PLACE: the reserve anchors to it and you can sleep there.
export const BUILDS = {
  camp: { needs: { wood: 3, plants: 2 }, min: 30, level: 2 }
}
export const CARRY_BASE = 6 // hands and pockets — before skill and baskets
// forage-node rarity: the chance a matching biome tile is a NODE for its
// resource (deterministic per world+tile — see isNode). Plants are common
// forage; metal is a rare find. Combined with biome frequency, this makes
// some boards bare of a resource by design.
export const NODE_DENSITY = { plants: 0.55, fish: 0.5, eggs: 0.35, wood: 0.3, rock: 0.18, metal: 0.3 }
// (metal 0.09→0.3, 2026-07-24: peaks are already 1/16 of mountain ground — at 0.09 the
// whole world held ~8 metal nodes on 7 of 61 boards, functionally unfindable. At 0.3
// it is still the scarcest resource by far, but a determined climb can find it.)
// the FORAGER'S EYE: forage nodes only mark on the map once your SCOUT skill
// reaches this — below it you learn a tile's yield only by standing on it
// (the nodes are derivable in theory; the game earns the map). Display-only,
// so it never touches replay.
const RES_SALT = { plants: 1, fish: 2, eggs: 3, wood: 4, rock: 5, metal: 6 }

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

  // Discovery FEEDS the day: every interior tile you uncover — HOME INCLUDED —
  // ADDS a minute to the NEXT day's budget (the seed minute bootstraps day one,
  // so the very first tile you find already pays). Clearing the home board (its
  // 60 non-centre tiles) lifts you from the seed to ~60; past the gate each
  // outside tile carries the budget onward toward a full day.
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
  const dailyBudget = () => Math.min(FREE_CAP, SEED_MIN + tilesFound())
  let learned = {} // skill → xp, grown by LESSON actions — nurture; replays from the log like everything else
  let given = {} // skill → EDGES taught away: teaching drains the shape a lesson fills (log-derived)
  let practiced = {} // action kind → count (a step, a scout…) — practice levels derive from it (log-derived)
  let taught = {} // npc board key → { skill → levels taught }: how far you've raised a figure toward its nature
  let inventory = {} // resource/item → count on your back (log-derived, never serialized)
  let gatheredAt = {} // tile key → world-minute of its last gather (the regrow clock; log-derived)
  let stash = {} // GLOBAL tile key → { item, arr:[{at,uses?}] } — every tile is a storage cell (log-derived)
  let day = 1 // current day/expedition; energy spent = minutes since waking (00:00)
  let log = [] // this day's actions in order (replay re-applies them); banked + reset on sleep
  let logMeta = [] // per-entry minutes charged, index-aligned with log — display-only, derived, never saved
  const history = [] // past days: { day, actions, start } (for future day-navigation)
  let todayDiscovered = [] // {tile, key, seam?} first discovered TODAY — replay re-fogs these (display-only)
  let todayReached = [] // {tile, i} edges first reached TODAY — same journal for the edge ratchet
  let todayWorn = [] // {node, key} tile traversals TODAY — refogged on the display rewind
  let replayWorn = new Set() // display-replay stand-in for the guarded wear journal — keeps
  // the novel-ground practice gate (stepOnto) deterministic while wear is rewound
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
    // a gated board opens once the whole board is discovered — a ratchet,
    // like discovery itself: the gate edge's wall bit clears for good
    if (tile.gate && !tile.gateOpen && tile.discovered.size >= BOARD_TILES) {
      tile.gateOpen = true
      tile.walls[tile.gate.k] &= ~(1 << tile.gate.side)
      fellWall(tile.gate)
    }
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
  // next time (see wearFactor). A ratchet like the others; the display rewind
  // re-applies moves, so it's guarded — the todayWorn refog handles that side.
  function journalWorn(node, k) {
    if (replaying) return
    if (!node.worn) node.worn = {} // defensive: nodes always carry it, but never crash if not
    node.worn[k] = (node.worn[k] || 0) + 1
    todayWorn.push({ node, key: k })
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
  const isShallow = g => {
    const k2 = key(g)
    let r = shallowMemo.get(k2)
    if (r === undefined) shallowMemo.set(k2, (r = !isRiver(g) && typeNameAt(g) === "water" && deepnessAt(g) < SHALLOW))
    return r
  }
  const navWater = g => isRiver(g) || isShallow(g)
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
  function leapNeighbors(g) {
    if (!LEAP) return []
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
      // no leaping over (or onto) water — straits are for boats and bridges
      if (blocked(A) || blocked(B) || blocked(t)) continue
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
        // the place bonus: their home ground raises its skill's nature
        const homeSkill = BIOME_SKILL[biomeAt(pos)]
        if (homeSkill) stats[homeSkill] = Math.min(SKILL_CAP, stats[homeSkill] + PLACE_BONUS)
        npc = { board: c.slice(), pubkey: pk, pos, stats, place: homeSkill || null }
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
  // Resolve a hex's type NAME: stored sparse maps first, then the derived
  // terrain, then the kind's default. typeOf feeds costs; the renderer reads
  // the name for the land's look.
  const typeNameAt = g => {
    const b = boardOf(g)
    if (b) {
      const stored = b.node && b.node.types[key(b.local)]
      if (stored) return stored
      return hasTerrain ? biomeAt(g) : "plain"
    }
    return parentOf().tile.seamTypes[key(g)] || "seam"
  }
  const typeOf = g => TILE_TYPES[typeNameAt(g)]

  // ── skills in effect (nature + nurture) ─────────────────────────────
  // The player: starts at half nature, learns to the full cap of 15 — the
  // key sets the head start and the pace, never the destination. An NPC:
  // starts at half nature too, but its nature IS its ceiling (taught later).
  const innateOf = skill => (pubkey ? statsOf(pubkey)[skill] : 0)
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
    const base = baseLevel(innateOf(skill))
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
  // an NPC starts at half its nature and is raised by TEACHING toward its nature
  // — never past it (the cap that keeps experts permanently valuable). The transfer
  // is EDGE FOR EDGE: taught[] counts the edges you handed over, and the figure
  // climbs its own shape with them, exactly as you climb yours — a level lands only
  // when its shape completes.
  const npcProgress = (npc, skill) => {
    const cap = npc.stats[skill]
    const base = baseLevel(cap)
    const { levels, rem } = levelsFromEdges((taught[key(npc.board)] || {})[skill] || 0, base)
    const level = Math.min(cap, base + levels)
    const sides = edgesForLevel(level)
    return {
      level,
      sides,
      filled: level >= cap ? sides : Math.min(sides, Math.floor(rem)),
      partial: level >= cap ? 0 : rem - Math.floor(rem)
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
  // World-minutes since day one (1440/day — the sleep hours pass too): the
  // regrow and spoilage clocks tick against this. Monotonic — a rest jumps
  // the day (1440) by more than any energy refill (≤60) can pull it back.
  const worldMin = () => (day - 1) * 1440 + ((dayStart ? dayStart.energy : SEED_MIN) + fed - energy)
  const itemWeight = k => RESOURCES[k]?.weight ?? RECIPES[k]?.weight ?? 0
  const itemDef = k => RESOURCES[k] || RECIPES[k] || {}
  // ── the pack, as dated INSTANCES ────────────────────
  // inventory[k] is an ARRAY of { at } (world-minute made) — plus { uses }
  // for tools that wear. Spoilage is a DERIVED view: an instance older than
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
  const returnVia = (g, from) => {
    // the raft is under you there if it's moored at g (you'd be boarding it) or
    // if you're aboard already and g is water (it travels with you)
    if (raft && (eq(raft, g) || (aboard() && navWater(g)))) return riverReserve(g)
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
    return returnVia(end, path.length > 1 ? path[path.length - 2] : cameFrom())
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
        : returnVia(target, e.prevAt)
      : landBack(target, routeTo(target))
    return e.charge + back <= energy
  }

  const canScout = target => isFrontier(target) && scoutChargeAt(target) + returnCost() <= energy

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
    depth() < MAX_DEPTH && !!boardOf(view().player) && !eq(view().player, view().entry) && enterReturn() <= energy

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
        : returnVia(target, via[via.length - 2])
      : landBack(target, via) // a route that rode the raft prices home through its new mooring
    if (pathCharge(via) + back > energy) return false
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
    // ungated it outgrew every other skill.) During the display replay the wear
    // journal is guarded, so replayWorn mirrors today's first-steps to keep the
    // replayed practice exactly equal to the lived day's.
    if (b && b.node && !freeAt(g) && !isCentre(g)) {
      const wk = key(b.local)
      const rk = key(b.c) + "|" + wk
      const worn = ((b.node.worn && b.node.worn[wk]) || 0) + (replaying && replayWorn.has(rk) ? 1 : 0)
      if (!worn) practiced.move = (practiced.move || 0) + 1 // novel — the step trains travel
      if (replaying) replayWorn.add(rk)
      else journalWorn(b.node, wk)
    }
    markReachedEdges()
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
  // What the tile under your feet yields: its biome's resource. Centres,
  // roads and anything off-board give nothing — and NEITHER does the home
  // board: its tiles are the identity/minimap, not land (same rule as
  // landAt), so their hidden terrain is never surfaced as a harvest. You
  // gather out in the real world, past the seam.
  // ── forage NODES: not every biome tile yields. Whether a tile is a node
  // for its resource is a DETERMINISTIC draw from the world key + coord —
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
  const gatherResAt = g => {
    const b = boardOf(g)
    if (!b || isCentre(g)) return null
    if (b.c[0] === 0 && b.c[1] === 0) return null // home is the minimap, not gatherable
    const res = BIOME_YIELD[typeNameAt(g)]
    return res && isNode(g, res) ? res : null // …and only if this tile is a node
  }
  // the gather skill eases the take toward half price at 15 (like scouting);
  // a working axe on the back halves wood on top (and wears one use per cut)
  const gatherCostAt = g => {
    const res = gatherResAt(g)
    if (!res) return Infinity
    let c = RESOURCES[res].min
    if (res === "wood" && countOf("axe") > 0) c /= 2
    return c * (1 - skillOf("gather") / 30)
  }
  // wear the axe most-used-first (finish a worn one before starting the next);
  // a spent axe breaks and is gone
  const wearAxe = () => {
    const axes = freshOf("axe")
    if (!axes.length) return
    const ax = axes.reduce((a, b) => (a.uses <= b.uses ? a : b))
    ax.uses -= 1
    if (ax.uses <= 0) {
      inventory.axe = inventory.axe.filter(x => x !== ax)
      if (!inventory.axe.length) delete inventory.axe
    }
  }
  // remove n of item k, OLDEST fresh first (spend old stock, keep the fresh)
  // FOOD IS TIME (RULES 37) — the nourishment of a kind, and what an eat of
  // `f` minutes would ACTUALLY add today: clipped by the daily ration cap and
  // by midnight (the window can never outgrow the day).
  const foodOf = k => RESOURCES[k]?.food || 0
  const eatBoostOf = f =>
    Math.max(0, Math.min(f, EAT_CAP - fed, FREE_CAP - ((dayStart ? dayStart.energy : SEED_MIN) + fed)))
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
    const inst = { at: worldMin() }
    if (itemDef(k).uses) inst.uses = itemDef(k).uses
    ;(inventory[k] = inventory[k] || []).push(inst)
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
  const gatherReadyAt = g => {
    const res = gatherResAt(g)
    return !!res && worldMin() - (gatheredAt[key(g)] ?? -1e9) >= RESOURCES[res].regrow
  }
  // affordability keeps the reserve invariant with the HEAVIER pack: the way
  // home is re-priced at the post-pickup load (the load factor scales every
  // charged step uniformly, so the scaling is exact — and conservative over
  // the safe board's flat stretch)
  // WHAT A HARVEST TAKES BEYOND YOUR HANDS: the tool a resource can't be had
  // without. Fish need a NET — wading into the shallows put you within reach of
  // them, but reach was never the hard part (RULES 36). Everything else is still
  // hands-and-knees work. Reads off the recipe's own `catches`, so a second bit
  // of tackle is a RECIPES entry and nothing else.
  const gearFor = res => Object.keys(RECIPES).find(k => RECIPES[k].catches === res) || null
  const lacksGear = res => {
    const tool = gearFor(res)
    return tool && countOf(tool) < 1 ? tool : null
  }
  const canGather = () => {
    const g = view().player
    const res = gatherResAt(g)
    if (!res || !gatherReadyAt(g)) return false
    if (lacksGear(res)) return false // no tackle, no catch
    const w = RESOURCES[res].weight
    if (loadOf() + w > carryCap()) return false // the pack is full
    const post = 1 + Math.min(1, (loadOf() + w) / Math.max(1, carryCap()))
    return gatherCostAt(g) + (returnCost() / loadFactor()) * post <= energy
  }
  function doGather() {
    const g = view().player
    const res = gatherResAt(g)
    const withAxe = res === "wood" && countOf("axe") > 0
    energy -= gatherCostAt(g)
    practiced.gather = (practiced.gather || 0) + 1 // gathering trains gathering
    addItem(res)
    if (withAxe) wearAxe() // the cut wore the blade
    gatheredAt[key(g)] = worldMin() // the tile's regrow clock starts now
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

  // "Rest and resume": advance a day, then start it having already travelled
  // back out to where you stand (the trip out costs what the trip home would).
  // Collapse the day's wander onto the SHORTEST route from the entry to here, so
  // the resumed day begins on the efficient path — a later retrace home replays
  // that, not every recorded step of yesterday's meander.
  function restResumeRun() {
    bankGhost() // the actual wander, before we collapse it to the efficient route
    const back = returnCost()
    energy = dailyBudget() - back
    const v = view()
    const short = routeTo(v.entry) // player → entry over known ground (shortest)
    if (short && short.length) v.trail = short.reverse() // → entry-first, player last
    sleep()
  }

  // ── snapshots (how a day's start is remembered) ──────
  const snap = () => ({
    energy,
    fed,
    day,
    learned: { ...learned },
    given: { ...given },
    practiced: { ...practiced },
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
    day = s.day
    learned = { ...(s.learned || {}) }
    given = { ...(s.given || {}) }
    practiced = { ...(s.practiced || {}) }
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
    replayWorn = new Set() // fresh mirror of today's first-steps for the practice gate
    for (const d of todayDiscovered) (d.seam ? d.tile.seamDiscovered : d.tile.discovered).delete(d.key)
    for (const r of todayReached) r.tile.reachedEdges.delete(r.i)
    for (const w of todayWorn) w.node.worn[w.key] = (w.node.worn[w.key] || 0) - 1 // rewind today's wear
    worldStamp++ // the rewind changed the walkable world under the caches
    restore(dayStart)
  }
  function endReplay() {
    for (const d of todayDiscovered) (d.seam ? d.tile.seamDiscovered : d.tile.discovered).add(d.key) // permanent
    for (const r of todayReached) r.tile.reachedEdges.add(r.i)
    for (const w of todayWorn) w.node.worn[w.key] = (w.node.worn[w.key] || 0) + 1 // restore today's wear
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
    // of the price (DESIGN.md, *Rivers*: "the haul"). Nothing is charged in
    // minutes; the walk under a full pack was the cost.
    raft: {
      can: () => !raft && navWater(view().player) && pileAt(view().player, "debris") >= RAFT_DEBRIS,
      run: () => {
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
        worldStamp++
      }
    },
    gather: { can: () => canGather(), run: () => doGather() },
    // EAT — food is time (RULES 37). Two minutes to sit and eat the OLDEST
    // fresh instance; its nourishment joins today's waking window (fed), so
    // energy grows, the budget line grows with it, and the clock still only
    // runs forward. Net-positive by rule (can refuses a bite worth less than
    // the sitting), so eating can never strand you.
    eat: {
      can: a => {
        if (!a.item) return false
        const inst = freshOf(a.item).sort((x, y) => x.at - y.at)[0]
        if (!inst) return false
        return eatBoostOf(inst.food ?? foodOf(a.item)) > EAT_MIN
      },
      run: a => {
        const inst = takeInstance(a.item)
        const boost = eatBoostOf(inst.food ?? foodOf(a.item))
        energy -= EAT_MIN
        fed += boost
        energy += boost
      }
    },
    // COOK — fire on matter, AT A HEARTH (any resting place: the home centre
    // or a camp — a fire you rest by). One raw food → one MEAL carrying
    // COOK_MULT× its nourishment on the instance. Costs minutes eased by the
    // cook skill, and trains it — the first SPACE-pillar transform.
    cook: {
      can: a => {
        if (!a.item || a.item === "meal" || !foodOf(a.item)) return false
        if (!restSpots.some(sp => eq(sp, view().player))) return false
        if (countOf(a.item) < 1) return false
        return cookCost() + returnCost() <= energy
      },
      run: a => {
        energy -= cookCost()
        practiced.cook = (practiced.cook || 0) + 1
        takeInstance(a.item)
        ;(inventory.meal = inventory.meal || []).push({ at: worldMin(), food: Math.round(foodOf(a.item) * COOK_MULT) })
      }
    },
    // craft: a COMMISSION to the figure at hand. They must be native to the
    // recipe's biome (their land type) and skilled enough in it; you supply
    // the materials, they spend the minutes and hand the item back. Products
    // are lighter than their inputs, so the current-load reserve stays safe.
    craft: {
      can: a => {
        const r = RECIPES[a.recipe]
        if (!r) return false
        const npc = teacherNear()
        if (!npc || mainTypeOf(npc.board) !== r.biome) return false
        if (npcSkill(npc, BIOME_SKILL[r.biome]) < r.level) return false
        for (const k in r.needs) if (countOf(k) < r.needs[k]) return false
        return r.min + returnCost() <= energy
      },
      run: a => {
        const r = RECIPES[a.recipe]
        energy -= r.min
        for (const k in r.needs) consume(k, r.needs[k])
        addItem(a.recipe) // the maker's skill, not the player's — no self-practice
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
        if (!gatherResAt(g)) return false // real land underfoot only
        if (freeAt(g)) return false // home already rests you
        if (restSpots.some(s => eq(s, g))) return false // one camp per tile
        for (const k in b.needs) if (countOf(k) < b.needs[k]) return false
        return b.min + returnCost() <= energy
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
        return lessonTime(skillOf(a.skill)) + returnCost() <= energy
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
    // completes a level only when its shape closes (never past their nature).
    // Selective by design: you give up your own progress to lift theirs.
    teach: {
      can: a => {
        if (!STAT_NAMES.includes(a.skill)) return false
        const npc = teacherNear()
        if (!npc) return false
        if (skillOf(a.skill) <= npcSkill(npc, a.skill)) return false // must currently outrank them
        if (npcSkill(npc, a.skill) >= npc.stats[a.skill]) return false // they're already at their nature cap
        return LESSON_COST + returnCost() <= energy
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
    // if every hex had been scouted, so the gate condition triggers normally.
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
    goHome: { can: () => true, run: () => goHomeRun() },
    restResume: {
      // the fresh day starts out here with the trip out already spent — that only
      // works if the trip home is still affordable on what's left (never-strandable).
      // NOT IN THE WATER: a new day resets the trail, and in a river the trail IS
      // the way out (the bank you waded in from). Nobody sleeps standing in a
      // river anyway — wade back to a shore first.
      can: () => !navWater(view().player) && dailyBudget() - returnCost() >= returnCost(),
      run: () => restResumeRun()
    }
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
  // goHome, restResume): pushed BEFORE running, they bank themselves as their
  // day's last entry, which is what lets a save replay ACROSS days.
  const LOGGED = new Set([
    "move",
    "scout",
    "bridge",
    "raft",
    "gather",
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
    "goHome",
    "restResume"
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
    try {
      h.run(action)
    } catch (e) {
      return { ok: false, reason: `${action.type} threw: ${e && e.message}` }
    }
    if (log.length && log[log.length - 1] === action) logMeta.push(e0 - energy)
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
        yields: BIOME_YIELD[biome] || "—"
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
    // what the figure at hand can craft for you: recipes of their land type
    // they're skilled enough to make (whether or not you've the materials —
    // the menu greys those you can't yet afford). Empty when no figure near.
    craftsNear: () => {
      const npc = teacherNear()
      if (!npc) return []
      const mt = mainTypeOf(npc.board)
      return Object.keys(RECIPES).filter(
        r => RECIPES[r].biome === mt && npcSkill(npc, BIOME_SKILL[mt]) >= RECIPES[r].level
      )
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
    // for the pack card: how many, the soonest spoil (world-min from now),
    // and a worn tool's remaining uses
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
          const inst = freshOf(k).sort((x, y) => x.at - y.at)[0]
          const f = inst ? inst.food ?? foodOf(k) : 0
          return f > 0 ? { k, food: eatBoostOf(f), cost: EAT_MIN } : null
        })
        .filter(Boolean),
    cookList: () =>
      Object.keys(inventory)
        .filter(k => k !== "meal" && foodOf(k) > 0 && countOf(k) > 0)
        .map(k => ({ k, food: Math.round(foodOf(k) * COOK_MULT), cost: Math.ceil(cookCost()) })),
    fed: () => fed,
    packDetail: () => {
      const now = worldMin()
      return Object.keys(inventory)
        .map(k => {
          const fresh = freshOf(k)
          if (!fresh.length) return null
          const life = shelfOf(k)
          const spoilsIn = life === Infinity ? null : Math.max(0, Math.round(life - (now - Math.min(...fresh.map(i => i.at)))))
          const uses = fresh.some(i => i.uses != null) ? fresh.reduce((s, i) => s + (i.uses || 0), 0) : null
          return { k, n: fresh.length, spoilsIn, uses }
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
    gatherInfo: () => {
      const g = view().player
      const res = gatherResAt(g)
      if (!res) return null
      return {
        res,
        cost: gatherCostAt(g),
        ready: gatherReadyAt(g),
        full: loadOf() + RESOURCES[res].weight > carryCap(),
        lacks: lacksGear(res) // the tool this harvest needs and you haven't got
      }
    },
    // a tile's forage state, or null if it's not a node: { res, ready,
    // progress 0..1 }. The map reads this to mark ready nodes and draw the
    // regrow clocks on the ones you've depleted.
    gatherStateAt: g => {
      const res = gatherResAt(g)
      if (!res) return null
      const last = gatheredAt[key(g)]
      if (last == null) return { res, ready: true, progress: 1 }
      const p = (worldMin() - last) / RESOURCES[res].regrow
      return { res, ready: p >= 1, progress: Math.max(0, Math.min(1, p)) }
    },
    // the regrow ring for ONE tile — { ready, progress } if you've gathered it
    // (so the map may show its clock, unlike the fogged forage map), else null.
    // Per-tile so the renderer can bake it with the ground instead of sweeping
    // every gathered tile each frame.
    regrowRingAt: g => {
      const last = gatheredAt[key(g)]
      if (last == null) return null
      const res = gatherResAt(g)
      if (!res) return null
      const p = (worldMin() - last) / RESOURCES[res].regrow
      return { ready: p >= 1, progress: Math.max(0, Math.min(1, p)) }
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
