// The FIELD GUIDE (guide.html) — a living reference of the game's systems
// (the day, the land, moving and scouting, carry, craft, build, cooking,
// crossing water, skills), built STRAIGHT FROM THE GAME'S CONSTANTS so it can
// never drift from the real rules. Tune a number in sim.js and the guide follows.

import {
  RESOURCES,
  RECIPES,
  BUILDS,
  NODE_DENSITY,
  CARRY_BASE,
  SEED_MIN,
  FREE_CAP,
  SLEEP_MIN,
  WAKE_CAP,
  HUNGER_MAX,
  BIOME_YIELD,
  BIOME_SKILL,
  SKILL_INFO,
  SKILL_CAP,
  NPC_MIN,
  NPC_MAX,
  PLACE_CAP,
  ENERGY_START,
  RAFT_NEEDS,
  RAFT_MIN,
  BRIDGE_NEEDS,
  BRIDGE_MIN,
  WALL_DROP,
  TILE_TYPES,
  COST_BASE,
  MOVE_COST,
  SCOUT_COST,
  RIVER_RING,
  ELEV_STEP,
  ELEV_STEP_FIT,
  WEAR_STEP,
  WEAR_FLOOR,
  EAT_MIN,
  EAT_CAP,
  COOK_MIN,
  COOK_KIND_MIN,
  COOK_SERVING_MIN,
  COOK_SERVINGS,
  COOK_MULT,
  MEAL_SHELF_MIN,
  FUEL,
  FUEL_COOKS,
  COMBOS,
  cookedOf,
  PRACTICE_BASE,
  PRACTICE_PER,
  LESSON_COST,
  LESSON_STEP,
  MASTERY
} from "./sim.js"

// resource marker colours + the biomes that yield each (inverse of BIOME_YIELD)
const RES_COL = {
  plants: "#8fbf5e",
  fruit: "#e0663f",
  roots: "#a6763a",
  berries: "#7b3f9e",
  nuts: "#8a5a2b",
  oysters: "#c9c2b8",
  crabs: "#d9642f",
  kelp: "#3f7d5f",
  eggs: "#d9c58a",
  herbs: "#6f9a5a",
  fish: "#3f7dbe",
  hare: "#a08060",
  eel: "#4f6d7a",
  wood: "#33691e",
  branches: "#5c4033",
  rock: "#8a877d",
  metal: "#cfcabf"
}
const BIOME_COL = {
  water: "#518bbf",
  beach: "#d9c58a",
  marsh: "#589885",
  plain: "#8fbf5e",
  forest: "#33691e",
  mountain: "#8a877d",
  cliff: "#5d6a72",
  peak: "#f0ede4"
}
// everything some biome offers, in the RESOURCES order (forage, hunt, materials)
const RES_ORDER = Object.keys(RESOURCES).filter(r => Object.values(BIOME_YIELD).some(list => list.includes(r)))
const sourcesOf = res =>
  Object.entries(BIOME_YIELD)
    .filter(([, list]) => list.includes(res))
    .map(([b]) => b)

// world-minutes → a human span (1440 min = a day, sleep hours included)
const span = m => {
  if (m == null) return "keeps"
  if (m < 60) return `${Math.round(m)}m`
  if (m < 1440) return `${Math.round(m / 60)}h`
  if (m < 10080) return `${Math.round(m / 1440)} day${m >= 2880 ? "s" : ""}`
  if (m < 60480) return `${Math.round(m / 10080)} week${m >= 20160 ? "s" : ""}`
  if (m < 525600) return `${Math.round(m / 43200)} months`
  return `${Math.round(m / 525600)} year${m >= 1051200 ? "s" : ""}`
}
const dots = (n, max = 6) =>
  `<span class="dots">${Array.from({ length: max }, (_, i) => `<span class="wt${i < n ? " on" : ""}"></span>`).join("")}</span>`
const swatch = c => `<span class="dot" style="background:${c}"></span>`
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")

// where a recipe can be made. Most ask nothing of the ground — only a recipe
// that names a `site` pins you to a biome (and then to that land's home skill)
const siteOf = site => (site ? `on ${site} · favours ${BIOME_SKILL[site]}` : "anywhere")

// ── build the page ───────────────────────────────────
const sections = []
const S = (title, ...html) => sections.push(`<section><h2>${title}</h2>${html.join("")}</section>`)

// header — the way back to the game only when the guide stands alone: framed
// (the playground's tab) it would boot a second game on the same save
const framed = window.self !== window.top
sections.push(
  `<h1>field guide <small>living reference${framed ? "" : ` · <a href="./index.html">back to the game</a>`}</small></h1>`
)

// the loop
S(
  "the loop",
  `<p class="lead">Everything runs through one day-and-reserve economy. You <b>gather</b> raw resources from forage nodes out past the river, <b>carry</b> them (weight vs capacity), <b>craft</b> them into gear (anywhere, unless a recipe names its ground), <b>cook</b> what you eat at any resting place, or <b>build</b> on the land underfoot. Home is your base and map — not a place you harvest.</p>`,
  `<div class="loop">
     <div class="node"><b>land</b><span>forage nodes, past the river</span></div>
     <div class="arr">→</div>
     <div class="node"><b>pack</b><span>weight slows every step</span></div>
     <div class="arr">→</div>
     <div class="node"><b>craft</b><span>gear you carry</span></div>
     <div class="arr">→</div>
     <div class="node"><b>build</b><span>a raft to cross on</span></div>
   </div>`
)

// the day grows with discovery
S(
  "the day grows with you",
  `<p>Your daily time isn't a fixed number — <b>it's the seed minute plus every tile you've discovered</b>, one minute each. Day one is a bare <code>${SEED_MIN}</code>-minute survey, and from there <b>every tile you uncover — the first one included — adds a minute to every day that follows</b>. Clearing your home board (its ${ENERGY_START} tiles) lifts you to roughly a full first hour; past the gate each new tile carries you further, snowballing toward the most a day can hold: <code>${FREE_CAP}</code> minutes, the whole day.</p>`,
  `<p class="muted">Rivers and board centres don't count — only real ground, home included. And the boost lands the next morning, not the moment you find it, so a day's discoveries are an investment in tomorrow.</p>`,
  `<p><b>The body has two needs of its own.</b> Bed falls due <code>${WAKE_CAP / 60}h</code> after waking, so at least <code>${SLEEP_MIN / 60}h</code> of every day is sleep, and the reserve lands you at a resting place before then. And you can't go more than <code>${HUNGER_MAX / 60}h</code> without eating: waking sets the meal clock that far out, and the reserve prices against it exactly as it does against the budget — you can only go where you can still get back to a resting place before your next meal is due. No food on your back means a three-hour day however long the budget. <b>A meal is worth its own time:</b> a bite pushes the clock on by the food's own nourishment — a scrap of herb by three minutes, a cooked hare by forty-five — so what you carry is what your day is worth. (It still adds that nourishment to the day's window too, up to the ration cap.)</p>`
)

// resources table
S(
  "resources — what the land yields",
  `<p>Every biome feeds you, each in its own way. <b>Forage</b> is what you pick up by hand — it trains gather. A <b>hunt</b> is what you have to catch with a tool of the right kind on your back (fish want a net, hare a snare, eel a spear) — it trains hunt, pays more, and spoils within the day. The peak grows nothing: carry food up.</p>`,
  `<p class="muted">A take costs minutes (eased toward half by its skill, and by a better tool). Each unit weighs on your back. What you gather <b>tires</b>: a spot gives as many gathers as your gather level, then goes bare for a day, and every further gather doubles that — 2, 4, 8 days; each full day it sits back untouched undoes one gather. A hunt regrows on its own clock. A raw harvest also spoils after its shelf life (stone and metal keep). Node rarity is the chance a matching biome tile is actually a node for that resource.</p>`,
  `<table><thead><tr><th>resource</th><th>from</th><th>how</th><th>weight</th><th>take</th><th>eaten</th><th>regrows in</th><th>spoils in</th><th>node rarity</th></tr></thead><tbody>${RES_ORDER.map(
    r => {
      const d = RESOURCES[r]
      const src = sourcesOf(r)
        .map(b => `${swatch(BIOME_COL[b])}${b}`)
        .join(" ")
      // a stream along a land tile's side brings fish in too (sim's yieldsAt)
      const stream = r === "fish" ? `<span class="muted">· a stream along a land tile's side</span>` : ""
      const rare = Math.round(NODE_DENSITY[r] * 100)
      const how = d.hunt
        ? `hunt · ${d.hunt}`
        : d.with
          ? `by hand · with a ${d.with.join(" or ")}`
          : d.tool
            ? `by hand · an ${d.tool} eases it`
            : "by hand"
      return `<tr>
        <td><span class="name">${swatch(RES_COL[r] || "#b8b2a6")}${r}</span></td>
        <td><span class="row">${src}${stream}</span></td>
        <td>${how}</td>
        <td>${dots(d.weight)}</td>
        <td>${d.min}m</td>
        <td>${d.food ? `+${d.food}m` : `<span class="muted">—</span>`}</td>
        <td>${d.hunt ? span(d.regrow) : `<span class="muted">tires</span>`}</td>
        <td>${span(d.shelf)}</td>
        <td><div class="row"><div class="bar" style="max-width:90px"><span style="width:${rare}%"></span></div><span class="muted">${rare}%</span></div></td>
      </tr>`
    }
  ).join("")}</tbody></table>`
)

// forage nodes
S(
  "forage nodes",
  `<p>Not every biome tile yields — whether a tile is a <b>node</b> for its resource is fixed by the world key and the tile's position, so a world always forages the same. Biome frequency × node rarity is the scarcity: some boards are bare of a resource, and a rare find (a metal node) is a landmark worth a camp.</p>`,
  `<p>You learn a tile's yield only by <b>standing on it</b> — the ground boxes in the lower-right show its nodes, greyed while bare or regrowing. At scout 6 you see a picked patch's regrow ring; a <b>forage map</b> that reveals node dots at a glance is a tech to be earned or learned later.</p>`
)

// moving & scouting — what a step and a look cost
S(
  "moving &amp; scouting — what the fog costs",
  `<p>A <b>step</b> onto known ground costs <code>${MOVE_COST}</code> minutes × the landing tile's terrain × its height × its wear × your load. Height works the legs exponentially: each point above the waterline multiplies a step by <code>${ELEV_STEP}</code>, and the travel skill eases that toward <code>${ELEV_STEP_FIT}</code> at ${SKILL_CAP}. A path wears in — every earlier walk onto a tile takes <code>${WEAR_STEP}</code> off its cost, down to <code>${WEAR_FLOOR}</code>. A board's centre is always one plain step, and inside home every step and every look is a flat <code>${COST_BASE}</code> minute.</p>`,
  `<p><b>Scouting</b> reveals an <b>adjacent</b> undiscovered tile without moving — the sea counts (you see it fine), but a wall does not. It costs <code>${SCOUT_COST}</code> × the terrain's scout factor × its <b>ring</b> — how far out from home's centre it lies — and the scout skill takes a thirtieth off a level (half price at ${SKILL_CAP}). Distance is dear on purpose: tomorrow's budget is today's discoveries, so cheap scouting would run away with the game. Seeing <i>further</i> — past the next row — is a tech to be earned later, not a free perk.</p>`,
  `<table><thead><tr><th>ground</th><th>step</th><th>scout</th></tr></thead><tbody>${Object.entries(TILE_TYPES)
    .map(
      ([t, c]) =>
        `<tr><td><span class="name">${BIOME_COL[t] ? swatch(BIOME_COL[t]) : ""}${t}</span></td><td>${c.move * MOVE_COST}m${c.impassable ? ` <span class="muted">· wading the shallows only</span>` : ""}</td><td>${c.scout}×</td></tr>`
    )
    .join("")}</tbody></table>`,
  `<p class="muted">The ring: home and its river (ring ${RIVER_RING} and in) scout at 1×, ring ${RIVER_RING + 1} at 2×, ring ${RIVER_RING + 2} at 3×, and one more for every ring beyond, uncapped.</p>`
)

// carry & load
S(
  "carry &amp; load",
  `<div class="callout">
     <div class="chain"><b>capacity</b> = <code>${CARRY_BASE} base + gather level + ${RECIPES.basket?.carry ?? 4} · baskets</code></div>
     <div class="chain">heavier pack <span class="arr">→</span> steps cost up to <b>2×</b> at a full load <span class="arr">→</span> the reserve shrinks your reach <span class="arr">→</span> a full pack can't pick up more</div>
   </div>`,
  `<p class="muted">Weight is the real limit on an expedition: a loaded pack literally shortens how far you can walk and still get home, so you cache the heavy, slow-spoiling haul at home and range out light.</p>`
)

// craft
S(
  "craft — what you make, and carry",
  `<p>A craft is something that is <b>yours</b>: it rides on your back, it can be spent, worn out or dropped, and it changes what <i>you</i> can do. (Build is the mirror — a thing that becomes the place and stays there.) You make it yourself, with your own <b>craft</b> level and your own minutes, and the making trains you.</p>`,
  `<p>You can make it <b>anywhere</b> — out on the land or at your own fire. A recipe may name a <b>site</b>, a biome that has to be underfoot, and then it can only be made there; none of the crude tier does. The materials come <b>off the ground at your feet first, then off your back</b>, so a load too heavy to carry can be worked where it lies. What you make goes <b>on your back while it fits and still leaves the way home, and at your feet when it doesn't</b> — so a craft is never refused for room and never breaks the reserve.</p>`,
  `<p><b>Tools come in tiers and never wear out.</b> The crude tier is heavy and slow; the fine tier, unlocked by a higher craft level, is lighter and quicker — and it <b>replaces</b> the crude one: the upgrade takes the tool you carry as one of its materials. You carry one tool of a kind; making a second is refused.</p>`,
  `<p><b>Stone is worked before it is used.</b> A rock breaks into three <b>shards</b>; a shard knapped to an edge is the <b>cutter</b> — a tool you hold — to a point the <b>piercer</b>, and to a blunt face the <b>crusher</b>. <b>Branches</b>, picked up off the forest floor, are the hafts — a head on a branch with a cord is a tool: the cutter an axe, the piercer a spear, the crusher a hammer; the snare is a branch and cord — and what the fire burns. Roots are dug and oysters prised with the cutter too.</p>`,
  `<div class="cards">${Object.entries(RECIPES)
    .map(([name, r]) => {
      const needs = Object.entries(r.needs)
        .map(([k, n]) => `<span class="pill">${n} ${k}</span>`)
        .join("")
      const held = r.with ? `<span class="pill muted">with a ${r.with.join(" or ")}</span>` : ""
      const effects = []
      if (typeof r.makes === "object")
        effects.push(`makes ${Object.entries(r.makes).map(([k, n]) => `${n} with a${/^[aeiou]/.test(k) ? "n" : ""} ${k}`).join(", ")}`)
      else if (r.makes > 1) effects.push(`makes ${r.makes}`)
      if (r.carry) effects.push(`+${r.carry} carry each`)
      if (r.keeps) effects.push(`keeps food ×${r.keeps}`)
      if (r.tool) {
        const serves = Object.keys(RESOURCES).filter(k => RESOURCES[k].hunt === r.tool || RESOURCES[k].tool === r.tool)
        if (serves.length) effects.push(`${RESOURCES[serves[0]]?.hunt ? "hunts" : "eases"} ${serves.join(", ")}${r.speed < 1 ? ` · ${Math.round((1 - r.speed) * 100)}% quicker` : ""}`)
        const takes = Object.keys(RESOURCES).filter(k => RESOURCES[k].with?.includes(r.tool))
        if (takes.length) effects.push(`gathers ${takes.join(", ")}`)
        const works = Object.keys(RECIPES).filter(k => RECIPES[k].with?.includes(r.tool))
        if (works.length) effects.push(`for ${works.join(", ")}`)
        effects.push(`weighs ${r.weight}`)
      }
      return `<div class="card">
        <h3>${r.site ? swatch(BIOME_COL[r.site]) : ""}${name}</h3>
        <div class="who">${siteOf(r.site)} · needs craft ${r.level} · ${r.min}m</div>
        <div class="row">${needs}${held}</div>
        ${effects.length ? `<div class="eff">${effects.join(" · ")}</div>` : ""}
      </div>`
    })
    .join("")}</div>`
)

// build
S(
  "build — your own ground",
  `<p>A structure raised on the tile underfoot: materials on your back, the build skill, and time. What the build menu offers today is the <b>raft</b> — raised standing in the water, out of <code>${Object.entries(RAFT_NEEDS)
    .map(([k, n]) => `${n} ${k}`)
    .join(" + ")}</code> in <code>${RAFT_MIN}</code> minutes. The <b>camp</b> below is in the rules but not on the menu yet; it's the deep-game lever — a camp near a far figure or forage region is what makes reaching them affordable.</p>`,
  `<div class="cards">${Object.entries(BUILDS)
    .map(([name, b]) => {
      const needs = Object.entries(b.needs)
        .map(([k, n]) => `<span class="pill">${n} ${k}</span>`)
        .join("")
      return `<div class="card">
        <h3>${name}</h3>
        <div class="who">needs build level ${b.level} · ${b.min}m</div>
        <div class="row">${needs}</div>
        <div class="eff">becomes a resting place — the way-home reserve re-anchors to it, and the day can end there</div>
      </div>`
    })
    .join("")}</div>`
)

// storage
S(
  "storage — drop, stash, take",
  `<p>You can drop any item on the tile underfoot, anywhere, instantly and free, and it <b>stays there</b> until you take it back — every tile is a storage cell, holding as many kinds as you put there. A pile lifts weight for the next trip, but it's a plain cell: food on the ground still spoils (a preserving store is future tech).</p>`
)

// cook & eat — food is time
const billOf = needs =>
  Object.entries(needs)
    .map(([k, n]) => `${n} ${k}`)
    .join(" + ")
const RAW_FOOD = Object.keys(RESOURCES).filter(k => RESOURCES[k].food > 0 && !RESOURCES[k].cooked)
S(
  "cook &amp; eat — food is time",
  `<p><b>Eating</b> takes <code>${EAT_MIN}</code> minute, anywhere: a food's nourishment joins today's waking window — at most <code>${EAT_CAP}</code> minutes a day, a second wind and not a second day — and pushes the meal clock on by the same minutes.</p>`,
  `<p><b>Cooking</b> happens at a hearth — any resting place, home's centre or a camp. A cook takes a <b>pot</b>: as many different foods as your cook level, up to <code>${COOK_SERVINGS}</code> of each over the skewers. A meal takes <b>one of each kind</b>, so more of a thing makes more meals, never a bigger one, and a meal of several kinds is a <b>dish</b>, named by its recipe. Cooked, a food is worth <code>${COOK_MULT}×</code> its nourishment and keeps twice as long, never under ${span(MEAL_SHELF_MIN)}. The fire burns <b>${FUEL}</b>: one lasts <code>${FUEL_COOKS}</code> cooks, and is taken off your back only when the last one's are spent. The minutes are in the variety — <code>${COOK_MIN}m</code> for the first food, <code>+${COOK_KIND_MIN}m</code> each further kind, <code>+${COOK_SERVING_MIN}m</code> each further serving — eased by the cook skill, half at ${SKILL_CAP}.</p>`,
  `<table><thead><tr><th>food</th><th>eaten raw</th><th>cooked</th><th>keeps raw</th><th>keeps cooked</th></tr></thead><tbody>${RAW_FOOD.map(r => {
    const c = RESOURCES[cookedOf(r)]
    return `<tr><td><span class="name">${swatch(RES_COL[r] || "#b8b2a6")}${r}</span></td><td>+${RESOURCES[r].food}m</td><td>+${c.food}m</td><td>${span(RESOURCES[r].shelf)}</td><td>${span(c.shelf)}</td></tr>`
  }).join("")}</tbody></table>`,
  `<p>The right mix is a <b>combo</b>: a meal holding every kind it names (more besides is fine) is worth more and may keep longer, and where several fit, the one naming the most kinds wins.</p>`,
  `<table><thead><tr><th>combo</th><th>takes</th><th>worth</th><th>keeps</th></tr></thead><tbody>${COMBOS.map(
    c =>
      `<tr><td><span class="name">${c.name}</span></td><td>${c.kinds.join(" + ")}</td><td>×${c.time}</td><td>${c.keeps > 1 ? `×${c.keeps}` : `<span class="muted">—</span>`}</td></tr>`
  ).join("")}</tbody></table>`
)

// crossing water
S(
  "crossing water",
  `<p>Every board is an island: the one-tile row between boards is <b>river</b>. You can wade in from a bank and stand there — to look across, and to build — but on foot the water is a dead end: the only way out is the bank you came in by. Board water at the shore's own height, the <b>shallows</b>, works the same; deeper water is a wall. The leap never touches water.</p>`,
  `<p>Home is walled. Its gate opens when the board is fully discovered <i>and</i> you stand on its doorstep, and the felled wall leaves a starting kit there: <code>${billOf(WALL_DROP)}</code>.</p>`,
  `<p>The first crossing is a <b>raft</b> — <code>${billOf(RAFT_NEEDS)}</code>, <code>${RAFT_MIN}m</code> — raised standing in the water it will float on; what lies at your feet counts toward the bill as well as what you carry. One raft, ever. It stays moored where you leave it and moves only with you aboard, and aboard, the water is a road: go tile to tile and land on any shore. The way home may run by water too — the reserve prices the walk back to the raft.</p>`,
  `<p class="muted">A <b>bridge</b> — <code>${billOf(BRIDGE_NEEDS)}</code>, <code>${BRIDGE_MIN}m</code> — is in the rules: raised from a river tile, it joins the bank you waded in from to the land you pick, for good and both ways. Nothing in the game raises one yet.</p>`
)

// skills
S(
  "skills — nature &amp; nurture",
  `<p class="muted">Twelve skills across three pillars. The eight place-born ones are each at home in a biome (a figure there is boosted in it); four — hunt, cook, heal, dream — are placeless, learned from people and knowledge. Grown by doing, and by lessons from figures who outrank you.</p>`,
  `<p>You start at <b>level 1 in everything</b> and can reach <b>${SKILL_CAP}</b> in anything — your nature says how <i>gifted</i> you are towards a skill, never where you begin: levels are climbed, not handed out. The figures are different: their nature is banded <b>${NPC_MIN}–${NPC_MAX}</b> and they <i>sit</i> at it, so the best teacher alive can carry you to ${NPC_MAX}. Home ground lifts a figure in its biome's skill, but only to ${PLACE_CAP} — being born on the right land is not enough to make a master. <b>The last ${SKILL_CAP - NPC_MAX} levels are yours to grind</b> — you get them by doing the thing, and nobody can hand them to you. Every world has twelve masters, one per skill, pinned at ${NPC_MAX}, one on each of the world's twelve pentagon boards: finding them is the game.</p>`,
  `<p><b>The shape is the level.</b> A skill at level L is an L-sided shape, and the next level is <b>L edges</b> away. <b>Practice</b> fills edges: ${PRACTICE_BASE} of a thing fill one — a move trains travel, but only onto ground you've never walked; scout, gather, hunt, craft, build and cook each train their own; every first time trains lore; and every night's sleep trains dream, ${PRACTICE_PER.sleep} nights to an edge. A <b>lesson</b> beside a figure who outranks you fills a whole edge in <code>${LESSON_COST} + ${LESSON_STEP} × your level</code> minutes, and <b>teaching</b> runs the other way: <code>${LESSON_COST}</code> minutes to hand a figure an edge. Below <b>${MASTERY}</b> a skill is a pool — a lesson takes its edge out of the teacher, and teaching costs you yours; at ${MASTERY} and above nothing drains.</p>`,
  `<table><thead><tr><th>skill</th><th>home</th><th>character</th><th>does</th></tr></thead><tbody>${Object.entries(
    SKILL_INFO
  )
    .map(
      ([s, info]) =>
        `<tr><td><span class="name">${s}</span></td><td><span class="row">${info.home === "—" ? `<span class="muted">—</span>` : swatch(BIOME_COL[info.home]) + info.home}</span></td><td class="muted">${esc(info.flavour)}</td><td>${info.effect === "—" ? `<span class="muted">nothing yet</span>` : esc(info.effect)}</td></tr>`
    )
    .join("")}</tbody></table>`
)

sections.push(
  `<p class="muted" style="font-size:13px">A day is worth the seed minute plus one per discovered tile — from <code>${SEED_MIN}</code>, through ~<code>${ENERGY_START}</code> after home, up to <code>${FREE_CAP}</code>, the whole day. All numbers above are read live from the game's own constants.</p>`
)

// ═══════════════════════════════════════════════════════════════════
// THE PLAN — vision sketch (NOT live: mirrors VISION.md, not constants)
// ═══════════════════════════════════════════════════════════════════

const PILLARS = [
  { n: "Time", emblem: "the wheel", hue: 30, about: "reach · flow · cycles · the long game", skills: ["scout", "travel", "trade", "farm"] },
  { n: "Space", emblem: "fire", hue: 140, about: "matter — take it and shape it with fire", skills: ["gather", "craft", "hunt", "cook"] },
  { n: "Mind", emblem: "the word", hue: 262, about: "the self, its culture & design — know · mend · envision · make", skills: ["dream", "lore", "heal", "build"] }
]

// twelve skills in wheel order (30° apart, clockwise from the top); pillar arcs: TIME
// straddles the top, SPACE the right, MIND the left (identical to the game's STAT_NAMES,
// heal/dream swapped 2026-09-01 so each skill faces its opposite — see sim's WHEEL ORDER)
const WHEEL = ["scout", "travel", "gather", "craft", "hunt", "cook", "dream", "lore", "heal", "build", "farm", "trade"]

// the tech tree — first levels pinned (tier 0 roots + tier 1 branches)
const TECHTREE = {
  Time: {
    hue: 30,
    root: { n: "the wheel", key: "travel 1", eff: "unlocks routes + the calendar sense — the road and the year's turn become legible" },
    nodes: [
      { n: "sowing", needs: "wheel · farm 2", via: "plot", eff: "plant a seed → grows over days → a harvest bigger than the seed" },
      { n: "calendar", needs: "wheel · scout 2", via: "—", eff: "read regrow & spoil timers exactly on every tile" }
    ]
  },
  Space: {
    hue: 140,
    root: { n: "fire", key: "craft 1", eff: "unlocks the forge — working matter with heat" },
    nodes: [
      { n: "preserving", needs: "fire · cook 3", via: "larder", eff: "drying & salting — stored food keeps ×2" },
      { n: "cart", needs: "fire · craft 2", via: "3 wood", eff: "+4 carry that rolls with you" },
      { n: "road", needs: "fire · build 2", via: "2 rock / tile", eff: "a paved tile costs one step less to cross" },
      { n: "kiln", needs: "fire · craft 2", via: "kiln", eff: "fire clay into vessels — a carriable preserving store" }
    ]
  },
  Mind: {
    hue: 262,
    root: { n: "the word", key: "lore 1", eff: "unlocks records; lets figures teach tech" },
    nodes: [
      { n: "tally", needs: "word · lore 2", via: "—", eff: "exact counts — the ledger reveals a node's contents & amounts" },
      { n: "writing", needs: "word · lore 3", via: "library", eff: "knowledge persists; lessons can be written" },
      { n: "sightlines", needs: "word · scout 3", via: "—", eff: "scout further — survey a row or two out, not just the adjacent tile; a tech, not a free scout-stat perk" },
      { n: "forage map", needs: "word · scout 4", via: "—", eff: "node dots appear at a glance on discovered tiles; a tech, not a free perk" }
    ]
  }
}

const CLASSES = [
  ["Materials", "durable", "gather / craft", "wood (types), stone, ore, clay, fiber, hide"],
  ["Forage", "perishable", "gather", "berries, fruit, mushrooms, nuts, honey, eggs"],
  ["Fauna", "meat + hide", "hunt", "rabbit, deer, boar, chicken, cow, fish"],
  ["Crops", "seed or food", "sow / farm", "grains, vegetables"]
]

// the skill wheel: core + a pale inner ring (tier hint) + the 12 skills on the rim
const HEXP = "M0 -46L39.8 -23L39.8 23L0 46L-39.8 23L-39.8 -23Z"
const RIM = {
  0: [340, 88], 30: [433, 88], 60: [480, 169], 90: [527, 250], 120: [480, 331], 150: [433, 412],
  180: [340, 412], 210: [246, 412], 240: [200, 331], 270: [153, 250], 300: [200, 169], 330: [246, 88]
}
const INNER = [[433, 250, 90], [387, 169, 30], [293, 169, 330], [246, 250, 270], [293, 331, 210], [387, 331, 150]]
const hexCell = (x, y, fill, label) =>
  `<g transform="translate(${x},${y})"><path d="${HEXP}" fill="${fill}"/>${label ? `<text class="wlab" text-anchor="middle" y="4">${label}</text>` : ""}</g>`
const wheelSVG = () => {
  let s = `<svg viewBox="0 0 680 500" role="img" aria-label="Skill wheel: twelve skills ringed by hue around three pillar thirds — Time (warm), Space (green), Mind (cool) — with a pale base-tier core.">`
  for (const [x, y, a] of INNER) s += hexCell(x, y, `hsl(${a},42%,80%)`, "")
  WHEEL.forEach((sk, i) => {
    const a = i * 30
    s += hexCell(RIM[a][0], RIM[a][1], `hsl(${a},66%,55%)`, sk)
  })
  s += hexCell(340, 250, "hsl(0,0%,90%)", "")
  s += `<text x="340" y="246" text-anchor="middle" class="wcore">roots</text>`
  s += `<text x="340" y="263" text-anchor="middle" class="wcore2">base tier</text>`
  return s + `</svg>`
}

sections.push(
  `<div class="roadmap">
     <span class="tag">the plan · not built yet</span>
     <h1>where this is heading</h1>
     <p class="lead">A living sketch of the resource ecosystem, the twelve skills, and the tech tree — the map we build toward. Unlike everything above, these are <b>not live yet</b>; they mirror VISION.md in the repo and will change.</p>
   </div>`
)

S(
  "one wheel — the colour language",
  `<p>It all sits on a single hex colour wheel with two axes. <b>Hue</b> (around) says <b>which domain</b> a thing belongs to — neighbours are related, the wheel flows rather than walls off. <b>Saturation</b> (core → rim) says <b>which tier</b> — the pale core is the base, the saturated rim is advanced. A colour reads both at once.</p>`,
  `<div class="wheel">${wheelSVG()}</div>`,
  `<p class="muted">The twelve skills ring the rim, tinted by their pillar third; the domains blend into each other at the borders, so the generalist skills fall on the seams and the specialties sit deep in an arc. The pale centre is where the earliest tech — fire, the wheel, the word — is learned.</p>`
)

S(
  "three pillars — Time · Space · Mind",
  `<p>Three pillars, four skills each. <b>TIME · the wheel</b> — reach, flow, cycles, the long game. <b>SPACE · fire</b> — matter, taken and shaped. <b>MIND · the word</b> — the self and its culture. Each owns a contiguous third of the wheel and blends into its neighbours at the edges; each is both a skill family and a tech domain.</p>`,
  `<div class="pillars">${PILLARS.map(
    p => `<div class="pillar">
        <h3><span class="hue" style="background:hsl(${p.hue},66%,55%)"></span>${p.n}</h3>
        <div class="muted">${p.about}</div>
        <div class="row">${p.skills.map(s => `<span class="pill">${s}</span>`).join("")}</div>
      </div>`
  ).join("")}</div>`,
  `<p class="muted">Twelve skills so they land on the clock's hour marks — and its twelve constellations. The eight place-born skills all survive; the four beyond them — <code>hunt · cook · heal · dream</code> — and every skill's seat are now settled (the game's <code>STAT_NAMES</code> is canon).</p>`
)

S(
  "the tech tree — the first levels, pinned",
  `<p>Tech is the <b>knowing</b> layer above the <b>doing</b> skills, and it is world-persistent. A skill's level does double duty — it raises how well you do its action <i>and</i> it's the key that unlocks tech: <code>cook 3</code> opens preserving. One free <b>root</b> per pillar is learned just by doing; every branch past it needs the root, a skill threshold, and a built structure — and each earns a concrete effect on a system already in the game.</p>`,
  `<div class="pillars">${Object.entries(TECHTREE)
    .map(
      ([name, t]) => `<div class="pillar">
        <h3><span class="hue" style="background:hsl(${t.hue},66%,55%)"></span>${name}</h3>
        <div class="tnode root">
          <div class="trow"><b>${t.root.n}</b><span class="badge">root · ${t.root.key}</span></div>
          <div class="teff">${t.root.eff}</div>
        </div>
        ${t.nodes
          .map(
            nd => `<div class="tnode">
          <div class="trow"><b>${nd.n}</b><span class="tmeta">needs ${nd.needs}${nd.via && nd.via !== "—" ? ` · <i>${nd.via}</i>` : ""}</span></div>
          <div class="teff">${nd.eff}</div>
        </div>`
          )
          .join("")}
      </div>`
    )
    .join("")}</div>`,
  `<p class="muted">New structures these imply, beyond the camp: <code>larder · plot · kiln · library</code> (any resting place is already a hearth). Deeper and directional (not pinned): steam &amp; engines, <b>math</b>, biology → <b>engineered seeds</b> (Time × Mind), and the <b>electricity</b> capstone where Space's power meets Mind's signal.</p>`
)

S(
  "resource classes — richness without sprawl",
  `<p>A biome offers a small hand across these classes — full without endless options. A tile can be a node for several at once (the node engine already allows it). The roster grows <i>inside</i> a class; the class count stays small.</p>`,
  `<table><thead><tr><th>class</th><th>keeps?</th><th>got by</th><th>examples</th></tr></thead><tbody>${CLASSES.map(
    ([c, keeps, by, ex]) =>
      `<tr><td><span class="name">${c}</span></td><td class="muted">${keeps}</td><td>${by}</td><td class="muted">${ex}</td></tr>`
  ).join("")}</tbody></table>`
)

S(
  "the deep mechanics — few, on purpose",
  `<div class="cards">
     <div class="card"><h3>sow vs eat</h3><div class="eff">Consume a crop now, or keep it as seed and plant it for more later. Suitable land + time to grow. Every harvest becomes an "eat or invest?" call — farming as a loop, not a resource.</div></div>
     <div class="card"><h3>hunt</h3><div class="eff">Built for meat: fish, hare and eel, each with its tool. Still to come — durable hide, then taming and herds.</div></div>
     <div class="card"><h3>tiered yields = access</h3><div class="eff">The world is deterministic, so a tile's full potential is knowable — even listable here. Depth is skill-gated <i>access</i> to known deeper yields: a peak's metal node, at high lore, also gives a rarer vein. The climb is the game, not the secret.</div></div>
     <div class="card"><h3>research</h3><div class="eff">Tech advances at a built structure, spending time + materials + lore, and persists. Only the roots skip the building.</div></div>
   </div>`
)

document.getElementById("guide").innerHTML = sections.join("")
