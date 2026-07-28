// The FIELD GUIDE (guide.html) — a living reference of the gather / craft /
// build systems, built STRAIGHT FROM THE GAME'S CONSTANTS so it can never
// drift from the real rules. Tune a number in sim.js and the guide follows.

import {
  RESOURCES,
  RECIPES,
  BUILDS,
  NODE_DENSITY,
  CARRY_BASE,
  SEED_MIN,
  FREE_CAP,
  BIOME_YIELD,
  BIOME_SKILL,
  SKILL_INFO,
  ENERGY_START
} from "./sim.js"

// resource marker colours + the biomes that yield each (inverse of BIOME_YIELD)
const RES_COL = {
  plants: "#8fbf5e",
  fish: "#3f7dbe",
  eggs: "#d9c58a",
  wood: "#33691e",
  rock: "#8a877d",
  metal: "#cfcabf"
}
const BIOME_COL = {
  water: "#3f7dbe",
  beach: "#d9c58a",
  marsh: "#3f7d5f",
  plain: "#8fbf5e",
  forest: "#33691e",
  mountain: "#8a877d",
  cliff: "#5d6a72",
  peak: "#f0ede4"
}
const RES_ORDER = ["plants", "fish", "eggs", "wood", "rock", "metal"]
const sourcesOf = res =>
  Object.entries(BIOME_YIELD)
    .filter(([, r]) => r === res)
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

// the crafting SPECIALIST for a recipe's biome (its land's home skill)
const specialistOf = biome => `${biome} · ${BIOME_SKILL[biome]}`

// ── build the page ───────────────────────────────────
const sections = []
const S = (title, ...html) => sections.push(`<section><h2>${title}</h2>${html.join("")}</section>`)

// header
sections.push(
  `<h1>field guide <small>living reference · <a href="./index.html">back to the game</a></small></h1>`
)

// the loop
S(
  "the loop",
  `<p class="lead">Everything runs through one day-and-reserve economy. You <b>gather</b> raw resources from forage nodes out past the seam, <b>carry</b> them (weight vs capacity), and bring them to specialists to <b>craft</b> or to a tile to <b>build</b>. Home is your base and map — not a place you harvest.</p>`,
  `<div class="loop">
     <div class="node"><b>land</b><span>forage nodes, past the seam</span></div>
     <div class="arr">→</div>
     <div class="node"><b>pack</b><span>weight slows every step</span></div>
     <div class="arr">→</div>
     <div class="node"><b>craft</b><span>a specialist's trade</span></div>
     <div class="arr">→</div>
     <div class="node"><b>build</b><span>a camp to base from</span></div>
   </div>`
)

// the day grows with discovery
S(
  "the day grows with you",
  `<p>Your daily time isn't a fixed number — <b>it's the seed minute plus every tile you've discovered</b>, one minute each. Day one is a bare <code>${SEED_MIN}</code>-minute survey, and from there <b>every tile you uncover — the first one included — adds a minute to every day that follows</b>. Clearing your home board (its ${ENERGY_START} tiles) lifts you to roughly a full first hour; past the gate each new tile carries you further, snowballing toward a full day of <code>${FREE_CAP}</code> minutes (24h).</p>`,
  `<p class="muted">Seams don't count — only real ground, home included. And the boost lands the next morning, not the moment you find it, so a day's discoveries are an investment in tomorrow.</p>`
)

// resources table
S(
  "resources — what the land yields",
  `<p class="muted">A gather takes minutes (eased toward half by the gather skill). Each unit weighs on your back. A tile's yield regrows on its own clock; a raw harvest also spoils after its shelf life (stone and metal keep). Node rarity is the chance a matching biome tile is actually a forage node.</p>`,
  `<table><thead><tr><th>resource</th><th>from</th><th>weight</th><th>gather</th><th>regrows in</th><th>spoils in</th><th>node rarity</th></tr></thead><tbody>${RES_ORDER.map(
    r => {
      const d = RESOURCES[r]
      const src = sourcesOf(r)
        .map(b => `${swatch(BIOME_COL[b])}${b}`)
        .join(" ")
      const rare = Math.round(NODE_DENSITY[r] * 100)
      return `<tr>
        <td><span class="name">${swatch(RES_COL[r])}${r}</span></td>
        <td><span class="row">${src}</span></td>
        <td>${dots(d.weight)}</td>
        <td>${d.min}m</td>
        <td>${span(d.regrow)}</td>
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
  `<p>For now you learn a tile's yield only by <b>standing on it</b> — the info card shows what's there and its regrow state. A <b>forage map</b> that reveals node dots and regrow rings at a glance is a tech to be earned or learned later, not a free perk.</p>`
)

// scouting / sight
S(
  "scouting — reveal the fog",
  `<p>Scouting reveals an <b>adjacent</b> undiscovered tile without moving — the sea counts (you see it fine), but a game wall like the home gate does not. Seeing <i>further</i> — surveying past the next row — is not a free perk of the scout skill; it's a tech to be earned or learned later.</p>`
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
  "craft — a specialist's trade",
  `<p>Crafting is a service the figures sell, not a self-skill. Each recipe belongs to a land type; only a figure native to that biome, skilled enough in its craft, can make it. You carry the materials to them (at their board centre) and they hand the item back. Products are lighter than their inputs, so a commission never breaks the reserve.</p>`,
  `<div class="cards">${Object.entries(RECIPES)
    .map(([name, r]) => {
      const needs = Object.entries(r.needs)
        .map(([k, n]) => `<span class="pill">${n} ${k}</span>`)
        .join("")
      const effects = []
      if (r.carry) effects.push(`+${r.carry} carry each`)
      if (r.keeps) effects.push(`keeps food ×${r.keeps}`)
      if (r.uses) effects.push(`${r.uses} uses, then breaks`)
      if (name === "axe") effects.unshift("halves wood gathering")
      return `<div class="card">
        <h3>${swatch(BIOME_COL[r.biome])}${name}</h3>
        <div class="who">${specialistOf(r.biome)} · needs level ${r.level} · ${r.min}m</div>
        <div class="row">${needs}</div>
        ${effects.length ? `<div class="eff">${effects.join(" · ")}</div>` : ""}
      </div>`
    })
    .join("")}</div>`
)

// build
S(
  "build — your own ground",
  `<p>A structure raised on the tile underfoot: materials on your back, the build skill, and time. It's the deep-game lever — a camp near a far specialist or forage region is what makes reaching them affordable.</p>`,
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
  `<p>You can drop any item on the tile underfoot, instantly and free. Out in the world a drop is <b>lost for good</b>. On a home tile it <b>stashes</b> — the identity tiles double as storage cells, one item type each, taken back later. A stash lifts weight for the next trip, but it's a plain cell: stashed food still spoils (a preserving store is future tech).</p>`
)

// skills
S(
  "skills — nature &amp; nurture",
  `<p class="muted">Twelve skills across three pillars. The eight place-born ones are each at home in a biome (a figure there is boosted in it); four — hunt, cook, heal, dream — are placeless, learned from people and knowledge. Grown by doing, by lessons from figures who outrank you, and by your key's innate talent.</p>`,
  `<table><thead><tr><th>skill</th><th>home</th><th>character</th></tr></thead><tbody>${Object.entries(
    SKILL_INFO
  )
    .map(
      ([s, info]) =>
        `<tr><td><span class="name">${s}</span></td><td><span class="row">${info.home === "—" ? `<span class="muted">—</span>` : swatch(BIOME_COL[info.home]) + info.home}</span></td><td class="muted">${esc(info.flavour)}</td></tr>`
    )
    .join("")}</tbody></table>`
)

sections.push(
  `<p class="muted" style="font-size:13px">A day is worth the seed minute plus one per discovered tile — from <code>${SEED_MIN}</code>, through ~<code>${ENERGY_START}</code> after home, up to <code>${FREE_CAP}</code>. All numbers above are read live from the game's own constants.</p>`
)

// ═══════════════════════════════════════════════════════════════════
// THE PLAN — vision sketch (NOT live: mirrors VISION.md, not constants)
// ═══════════════════════════════════════════════════════════════════

const PILLARS = [
  { n: "Time", emblem: "the wheel", hue: 30, about: "reach · flow · cycles · the long game", skills: ["scout", "travel", "trade", "farm"] },
  { n: "Space", emblem: "fire", hue: 140, about: "matter — take it and shape it with fire", skills: ["gather", "craft", "hunt", "cook"] },
  { n: "Mind", emblem: "the word", hue: 262, about: "the self, its culture & design — know · mend · envision · make", skills: ["heal", "lore", "dream", "build"] }
]

// twelve skills in wheel order (30° apart, clockwise from the top); pillar arcs: TIME
// straddles the top, SPACE the right, MIND the left (identical to the game's STAT_NAMES)
const WHEEL = ["scout", "travel", "gather", "craft", "hunt", "cook", "heal", "lore", "dream", "build", "farm", "trade"]

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
    root: { n: "fire", key: "craft 1", eff: "unlocks the hearth + forge — working matter with heat" },
    nodes: [
      { n: "cooking", needs: "fire · cook 2", via: "hearth", eff: "raw forage → a meal: more nourishing, keeps longer than its parts" },
      { n: "preserving", needs: "cooking · cook 3", via: "larder", eff: "drying & salting — stored food keeps ×2" },
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
      { n: "writing", needs: "word · lore 3", via: "library", eff: "knowledge persists — cleared ground never re-fogs; lessons can be written" }
    ]
  }
}

const CLASSES = [
  ["Materials", "durable", "gather / craft", "wood (types), stone, ore, clay, fiber, hide"],
  ["Forage", "perishable", "gather", "berries, fruit, mushrooms, nuts, honey, eggs"],
  ["Fauna", "meat + hide", "hunt", "rabbit, deer, boar, chicken, cow, fish"],
  ["Crops", "seed or food", "sow / farm", "grains, roots, vegetables"]
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
     <p class="lead">A living sketch of the resource ecosystem, the twelve skills, and the tech tree — the map we build toward. Unlike everything above, these are <b>not live yet</b>; they mirror <a href="./VISION.md">VISION.md</a> and will change.</p>
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
  `<p>Tech is the <b>knowing</b> layer above the <b>doing</b> skills, and it is world-persistent. A skill's level does double duty — it raises how well you do its action <i>and</i> it's the key that unlocks tech: <code>cook 2</code> opens cooking, <code>cook 3</code> opens preserving. One free <b>root</b> per pillar is learned just by doing; every branch past it needs the root, a skill threshold, and a built structure — and each earns a concrete effect on a system already in the game.</p>`,
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
  `<p class="muted">New structures these imply, beyond the camp: <code>hearth · larder · plot · kiln · library</code>. Deeper and directional (not pinned): steam &amp; engines, <b>math</b>, biology → <b>engineered seeds</b> (Time × Mind), and the <b>electricity</b> capstone where Time's power meets Mind's signal.</p>`
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
     <div class="card"><h3>hunt</h3><div class="eff">Fauna as a gather-variant: perishable meat plus durable hide, flavoured by biome. Later — taming, herds.</div></div>
     <div class="card"><h3>tiered yields = access</h3><div class="eff">The world is deterministic, so a tile's full potential is knowable — even listable here. Depth is skill-gated <i>access</i> to known deeper yields: a peak always gives metal; at high lore the same node also gives a rarer vein. The climb is the game, not the secret.</div></div>
     <div class="card"><h3>research</h3><div class="eff">Tech advances at a built structure, spending time + materials + lore, and persists. Only the roots skip the building.</div></div>
   </div>`
)

document.getElementById("guide").innerHTML = sections.join("")

// ── theme (same storage/default as the game) ─────────
const themeBtn = document.getElementById("theme")
const root = document.documentElement
const applyTheme = t => {
  root.dataset.theme = t
  try {
    localStorage.setItem("thrive-theme", t)
  } catch {}
  themeBtn.textContent = t === "light" ? "☾" : "☀"
}
let saved = null
try {
  saved = localStorage.getItem("thrive-theme")
} catch {}
applyTheme(saved || "light")
themeBtn.addEventListener("click", () => applyTheme(root.dataset.theme === "light" ? "dark" : "light"))
