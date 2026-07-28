# anon&mato — resource, skill & tech vision

**What this is.** The map we build *toward* — the full shape of the resource
ecosystem, the 12 skills, and the tech tree, drawn before the code so each
increment fills the picture in rather than accidentally narrowing it. Almost
none of this is implemented yet. It is deliberately open and revisable; when a
number or a name here is wrong, change it here first.

**What this is NOT.** Not canon. [DESIGN.md](DESIGN.md) documents what actually
runs and what the rules currently are. If the two disagree, DESIGN.md wins for
*today* and this doc describes *later*.

---

## The spine: one color wheel, two axes

Everything — pillars, skills, tech, and eventually a board's own leaning — lives
on a single **hex color wheel** with two independent axes:

- **hue (angle around the wheel) = which domain.** Position is identity.
  Neighbours are analogous (related); the wheel flows, it doesn't wall off.
- **saturation / lightness (center → rim) = which tier.** The pale core is the
  base; the saturated rim is the specialised and advanced.

So a colour tells you two things at once: *what family* a thing belongs to and
*how deep* it sits. This is the language that ties biomes, skills and tech
together — read the whole structure at a glance.

The wheel is a radius-2 hexagon: **core (1) + inner ring (6) + outer ring
(12)** = 19 tiles. It is a real hex board, not a metaphor.

---

## Three pillars — Time · Space · Mind

The three things reality is made of: **space = matter, time = energy, mind =
information.** They sit as **contiguous thirds** of the wheel (not opposite
axes) — each owns a 120° arc, and the arcs *blend into each other* at their
borders. That blending is the intertwining: a domain doesn't hit a wall and
switch, it bleeds through the shared hues at its edges. The generalist,
cross-domain skills naturally fall on those borders.

| pillar | is about | wheel anchor | arc |
|--------|----------|--------------|-----|
| **Time** | energy, process, growth, cycles | red | the warm third |
| **Space** | matter, place, motion, form | green | the green third |
| **Mind** | knowledge, information, the collective | blue | the cool third |

---

## Twelve skills

Twelve so they land on the clock's hour marks (30° each) and read as three
quarters of the wheel. **Strawman placement below — the final four skills and
their exact seats are still open.** The eight current skills all survive.

- **Time (4):** tend (farming) · cook · hunt · heal
- **Space (4):** build · craft · gather · travel
- **Mind (4):** lore · scout · trade · sail

Current eight: `scout travel gather build craft trade tend lore`.
New four (candidates): `hunt cook sail heal` — **not final.**

**Unique vs shared (open question).** In the discrete draft, six skills were
"unique" to a branch and six "shared" between neighbours. On the contiguous
wheel this softens into: skills near a pillar's centre are *specialties*
(advance through that domain only); skills on a border are *generalists*
(advance through either neighbour's activities). Worth deciding as a real rule,
not just a look.

---

## The tech tree

Tech is the **knowing** layer above skills (the **doing** layer). It is
world-persistent knowledge: once the world knows fire, it knows fire.

- **Radius = progression.** Roots sit near the pale core; advanced rungs at the
  saturated rim. A tech's colour says both its pillar (hue) and its depth (how
  far out).
- **Roots are free, branches need buildings.** One primal root per pillar,
  learned early by doing/lore alone. Past the root, each rung gates behind a
  built structure (workshop → library/lab), prerequisites, and `lore`.
- **Every tech earns a concrete game effect** — no flavour-only nodes.
  Preservation extends shelf life; the wheel/road cuts step cost; engineered
  seeds raise crop yield; the clock we already have.

Roots, one per pillar:

- **Time → fire** (energy) — then cooking, preservation, power, farming
- **Space → the wheel** (motion) — then transport, construction, tools
- **Mind → the word** (language) — then number, records, signal

Two nice convergences fall out of the wheel:

- **electricity** is the capstone where **Time (power)** meets **Mind
  (signal)** — matter and information joining, which is historically exact.
- **engineered seeds** sit in **Time (farming) × Mind (number/biology)**,
  feeding the crop loop.

### Skills gate learning

A skill's level does **double duty**: it raises how well you perform its action
(the **stat**) *and* it is the **key that unlocks tech** (the **gate**). `cook 2`
opens cooking; `cook 3` opens preserving; that same cook level also speeds your
meals. So every point spent in a skill both sharpens you now and opens a door.

**Nothing is auto-given.** A skill is a *prerequisite*, never a trigger — a
threshold in it lets you *learn* a tech, but the ability itself is always a
deliberate unlock, never something that just appears when a stat crosses a line.
No passive perks from levelling. (This is why extended sight and the forage map
are techs, not scout-stat freebies.) Action *requirements* — needing `build 2`
to raise a camp — are fine; those gate what you may *do*, not free abilities.

### First levels — pinned

**Tier 0 — roots.** Learned by doing, no structure, low skill gate.

| root | pillar | key | cost | unlocks |
|------|--------|-----|------|---------|
| **fire** | Time | cook 1 | 1 wood | the cooking action + the hearth; opens Time research |
| **the wheel** | Space | craft 1 | 1 wood · 1 rock | the cart + roads; opens Space research |
| **the word** | Mind | lore 1 | — | records; opens Mind research + lets figures teach tech |

**Tier 1 — first branches.** Need the root + a skill threshold + a built
structure. Every effect hooks a system already in the game.

| tech | pillar | needs | via | effect |
|------|--------|-------|-----|--------|
| **cooking** | Time | fire · cook 2 | hearth | raw forage → a meal: more nourishing, keeps longer than its parts |
| **preserving** | Time | cooking · cook 3 | larder | drying & salting — stored food keeps **×2** (the storage-tech hook) |
| **sowing** | Time | fire · tend 2 | plot | plant a seed; it grows over days into a harvest bigger than the seed |
| **cart** | Space | wheel · craft 2 | 3 wood | **+4 carry** that rolls with you |
| **road** | Space | wheel · build 2 | 2 rock / tile | a paved tile costs **one step less** to cross |
| **kiln** | Space | fire + wheel · craft 2 | kiln | fire clay into vessels — a carriable preserving store |
| **tally** | Mind | word · lore 2 | — | exact counts — the ledger reveals a node's contents & amounts |
| **writing** | Mind | word · lore 3 | library | knowledge persists — cleared ground never re-fogs; lessons can be written |
| **calendar** | Mind | word · scout 2 | — | read regrow & spoil timers exactly on every tile |
| **sightlines** | Mind | word · scout 3 | — | scout *further* — survey undiscovered tiles a row or two out, not just the adjacent one (sight carries over water & fog; walls still block). Deliberately a tech, **not** a free scout-stat perk |
| **forage map** | Mind | word · scout 4 | — | node dots & regrow rings appear at a glance on discovered tiles — without it you learn a tile's yield only by standing on it. A tech, **not** a free scout-stat perk |

New **structures** implied (beyond the camp): `hearth · larder · plot · kiln ·
library` — these become build recipes as their tech lands.

**Deeper — directional, not pinned.** Time → charcoal → steam (engines,
automation) · medicine. Space → gear → mill → engine · concrete. Mind → **math**
(precise costs & optimisation) → biology → **engineered seeds** (Time × Mind,
crop yield ++). Capstone **electricity** = Time's steam × Mind's signal.

---

## Resource classes

Richness comes from a few **classes**, not a flat list — a biome offers a small
hand across the relevant classes (~4–6 things), which feels full without
drowning in options.

| class | keeps? | got by | examples |
|-------|--------|--------|----------|
| **Materials** | durable | gather / craft | wood (types), stone, ore, clay, fiber, hide → tools & structures |
| **Forage** | perishable | gather | berries, fruit, mushrooms, nuts, honey, eggs |
| **Fauna** | perishable (meat) + hide | **hunt** | rabbit/deer/boar (forest), chicken/cow (plains), fish (water) |
| **Crops** | seed or food | **sow / tend** | grains, roots, vegetables — the farming loop |

Roster: **expanding well past the current six.** The classes are the guardrail
against sprawl — add breadth inside a class, keep the class count small.

A tile can be a node for **several** classes at once — the per-resource node
machinery already supports this; only the single-yield lookup is a placeholder.

---

## The deep mechanics (few, on purpose)

Depth comes from a handful of composable rules, not from item count.

- **Sow vs eat.** A forage/crop item can be *consumed* (food now) or *kept as
  seed and planted* (more later). Planting needs suitable land (biome +
  elevation, deterministic) and time to grow. Every harvest becomes an
  "eat now or invest?" decision; farming becomes a loop, not a resource type.
- **Hunt.** Fauna as a gather-variant: meat (perishable) + hide (material),
  biome-flavoured. Later: taming, herds.
- **Tiered yields = access, not surprise.** The world is deterministic, so a
  tile's *full* potential is knowable — even listable in the guide. Depth is
  **skill-gated access to known deeper yields**: a peak always gives metal; at
  high lore the same node also gives a rarer vein. The tile advertises the
  ladder; the game is the climb (level the right skill, reach the right land,
  haul it home). Surprise moves from *what* to *the shape of your route up*.
- **Research.** Tech advances at a built structure, spending time + materials +
  `lore`, and persists. Early roots skip the structure.

---

## The clock, the sun & light (next — a rework)

The clock is due a rework. The model, now settled:

- **Two independent clocks.** The SUN is astronomical and doesn't care about
  you; your BUDGET (tiles discovered, see [DESIGN.md](DESIGN.md), capped at a
  full day `FREE_CAP` = 1440) is how much you can act. Separate axes.
- **The sun arcs over a horizon.** The orbit ring IS the horizon: sun above the
  line = day, below = night. It rises and sets intraday (not the dial-dot it is
  today), and its arc height / day-length drifts across the 360-day year
  (seasons), so the day↔night balance shifts through the year.
- **You start in the dark and earn the light.** You wake at **00:00 (midnight,
  no sun)** and are awake for your budget of minutes — a sub-span of the
  astronomical day, growing FORWARD from midnight. So a 1-minute day one is deep
  night and you sleep through the daylight you never reach; as the budget grows
  the window creeps toward sunrise, and **reaching daylight is itself a
  progression milestone.** The early game is nocturnal by construction.
- **Light matters → visibility by hour × light.** With no sun you see almost
  nothing. `fire` (the Time-pillar root tech) gains a **light** role — a
  compelling early reason to want it beyond cooking, and still *nothing
  auto-given* (even seeing in the dark is earned). The MOON (deferred) is a
  second, passive night-light that waxes/wanes. Effective sight/scout range
  becomes a function of the hour and your light sources; night without light is
  near-blind. This is where the day/night cycle gets teeth.
- **Night-mode UI.** While the sun is below the horizon, the whole UI feels like
  night.

**Confirm when we build it:** the nocturnal early game (above) is a direct
consequence of the window growing forward from midnight — evocative, but worth a
deliberate yes. **Deferred:** the moon.

Build order next session: (1) sun as a horizon-arc with a seasonal day-length
curve, (2) night-mode wired to sun-below, (3) sight/visibility as hour × light
(fire), (4) moon later.

---

## Determinism as structure (the through-line)

Determinism doesn't kill the game — it tells us which mechanics to build.
Surprise-based mechanics are weak (a determined player computes them).
**Access-based** mechanics are strong: the world is a known map of potential,
and play is *can I reach it, afford the reserve, and have I developed enough to
take it?* Every system above leans on access, not secrets.

---

## A board's place on the wheel (hook, not decided)

Each board already carries four unused key characters (the "reserved layer").
Candidate use: they seed the board's **hue on the wheel** — its pillar lean —
which sets what its figure teaches best and which tech it favours. Ties the new
systems back into the "identity shapes the world" spine with no new randomness.
Held as a documented option.

---

## Build order (so we ship, not drown)

1. **Biome offers a set** + a modest roster bump (Materials + Forage per
   biome), and a "which do you gather?" menu. Small — mostly tables + UX; the
   node engine is already multi-resource.
2. **Sow / eat crop loop** — the deep one.
3. **Fauna / hunt** — meat + hide.
4. **Tech tree** — start with 2–3 roots + one rung each (preservation, better
   seeds, the wheel/road).
5. **12 skills** — add the final four once their activities exist to feed them.

---

## Still open (decide before the matching build step)

- The **final four skills** and each skill's exact seat on the wheel.
- **Unique vs shared** as a real leveling rule (specialty vs generalist).
- **Research gating** specifics (which structure, what prerequisites).
- Whether the **board-hue hook** becomes real or stays flavour.
- How far **biome terrain colours** and the **skill/tech wheel** should actually
  share hues vs stay separate languages.
