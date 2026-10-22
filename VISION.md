# anon & mato — resource, skill & tech vision

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

The 12 skills ARE the game's verbs, and they divide equally into the three
pillars of four — the organizing spine everything else hangs off. A skill is a
DOMAIN (a family of actions + modifiers), never a single button; leveling a
skill improves its verb, so progression and action are one axis. Twelve also
lands them on the clock's hour marks (30° each).

- **TIME · the wheel** — `scout · travel · trade · farm`. Reach, flow, cycles,
  the long game: things that unfold over DURATION — grow the known world, cover
  distance, circulate goods, wait on a harvest. The cut that proves the split:
  **farm** (patience, seasons) vs gather/hunt (the immediate take).
- **SPACE · fire** — `gather · craft · hunt · cook`. Engage matter with fire:
  TAKE it (gather/hunt) and TRANSFORM it (craft/cook). The immediate physical
  world — and **cook belongs here**: cooking is literally fire on matter
  (raw → meal).
- **MIND · word** — `dream · lore · heal · build`. The self, its culture, and
  its DESIGN: KNOW (lore), MEND (heal), ENVISION (dream), and MAKE-REAL your
  patterns (build — the mind imprinting the world). The interior + intent.

What falls out of the taxonomy (why it's more than tidy):

- **Every skill faces its OPPOSITE.** The six diameters are pairs:
  **scout ↔ dream** (the open eye against the closed one — waking against
  sleeping), **travel ↔ lore** (covering ground against knowing it),
  **gather ↔ heal** (taking from the world against mending it), and
  `craft ↔ build`, `hunt ↔ farm`, `cook ↔ trade`. The wheel reads as a compass,
  not just an order. NOT cosmetic: `statsOf` slices the key's 64 nibbles BY
  INDEX and the twelve master boards are dealt in the same order, so the seating
  decides what every figure is good at.
- **The wheel groups each pillar into a contiguous ARC** — TIME across the top,
  SPACE down the right, MIND down the left. `STAT_NAMES` is the wheel order
  clockwise from the top (`scout` at 12 o'clock), so in the linear list TIME
  STRADDLES the start (`scout·travel … farm·trade`). The year still turns
  through the pillars in ~4-month macro-seasons, with TIME wrapping the new-year
  turn. The constellation wheel is built (DESIGN, *The dial, the sky and the
  night*); `lore` living in MIND is why it gates the calendar's reveal — so
  far, the day-of-year axis at lore 6.
- **A currency per pillar** (candidate): SPACE → matter & sustenance (materials
  + food→energy via cook), MIND → knowledge, health & design
  (heal/lore/build), TIME → reach/circulation. A three-resource economy that
  emerges from the structure instead of being bolted on.
- **Skills can be MODIFIERS, not only verbs** — `lore` could govern calendar
  clarity and unlocking; `travel` just flattens the climb. This is what
  keeps "12 verbs" from meaning "12 equal loops to invent."

**Unique vs shared (open).** Skills near a pillar's centre are *specialties*
(advance through that domain only); skills on a border are *generalists*
(advance through either neighbour's activities). Worth deciding as a real
leveling rule, not just a look.

**The biome bijection loosens.** 8 biomes but 12 skills → only SOME skills are
place-born: hunt, cook, heal and dream have no home land (`BIOME_SKILL`), and
are learned from people and practice, not terrain.

**"Pillar" is overloaded** — DESIGN's *Pillars* are the game's premises;
TIME/SPACE/MIND are skill CATEGORIES. Reconcile the word.

**Sequence the build.** Move, scout, gather, hunt, craft, build, cook, the
lessons and sleep all have loops now, and lore is the inner voice (DESIGN).
Next: `lore`'s governing role (the calendar), then trade, farm, heal and dream.
`dream` is the natural home of the routines below — dreaming = programming
tomorrow's loop.

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

Roots, one per pillar (as the field guide's tree has them, `lib/guide.js`):

- **Time → the wheel** (motion) — then routes, the calendar, farming
- **Space → fire** (energy) — then cooking, preservation, transport,
  construction, power
- **Mind → the word** (language) — then number, records, signal

Two nice convergences fall out of the wheel:

- **electricity** is the capstone where **Space (power)** meets **Mind
  (signal)** — matter and information joining, which is historically exact.
- **engineered seeds** sit in **Time (farming) × Mind (number/biology)**,
  feeding the crop loop.

### Skills gate learning

A skill's level does **double duty**: it raises how well you perform its action
(the **stat**) *and* it is the **key that unlocks tech** (the **gate**). `cook 3`
opens preserving; that same cook level also speeds your meals. So every point spent in a skill both sharpens you now and opens a door.

**Nothing is auto-given.** A skill is a *prerequisite*, never a trigger — a
threshold in it lets you *learn* a tech, but the ability itself is always a
deliberate unlock, never something that just appears when a stat crosses a line.
No passive perks from levelling. (This is why extended sight and the forage map
are techs, not scout-stat freebies.) Action *requirements* — needing `build 2`
to raise a camp — are fine; those gate what you may *do*, not free abilities.
Two perks break this rule today and are worth revisiting: the regrow ring at
scout 6 and the day-of-year axis at lore 6 appear on their own.

### First levels — pinned

**Tier 0 — roots.** Learned by doing, no structure, low skill gate.

| root | pillar | key | unlocks |
|------|--------|-----|---------|
| **the wheel** | Time | travel 1 | routes + the calendar sense; opens Time research |
| **fire** | Space | craft 1 | the forge — working matter with heat; opens Space research |
| **the word** | Mind | lore 1 | records; opens Mind research + lets figures teach tech |

(Cooking needs no tech today: any resting place is a hearth — DESIGN, *Eat &
cook*.)

**Tier 1 — first branches.** Need the root + a skill threshold + a built
structure. Every effect hooks a system already in the game.

| tech | pillar | needs | via | effect |
|------|--------|-------|-----|--------|
| **preserving** | Space | fire · cook 3 | larder | drying & salting — stored food keeps **×2** (the storage-tech hook; the basket's ×1.5 is built) |
| **sowing** | Time | wheel · farm 2 | plot | plant a seed; it grows over days into a harvest bigger than the seed |
| **cart** | Space | fire · craft 2 | 3 wood | **+4 carry** that rolls with you |
| **road** | Space | fire · build 2 | 2 rock / tile | a paved tile costs **one step less** to cross |
| **kiln** | Space | fire · craft 2 | kiln | fire clay into vessels — a carriable preserving store |
| **tally** | Mind | word · lore 2 | — | exact counts — the ledger reveals a node's contents & amounts |
| **writing** | Mind | word · lore 3 | library | knowledge persists; lessons can be written |
| **calendar** | Time | wheel · scout 2 | — | read regrow & spoil timers exactly on every tile |
| **sightlines** | Mind | word · scout 3 | — | scout *further* — survey undiscovered tiles a row or two out, not just the adjacent one (sight carries over water & fog; walls still block). Deliberately a tech, **not** a free scout-stat perk |
| **forage map** | Mind | word · scout 4 | — | node dots & regrow rings appear at a glance on discovered tiles — without it you learn a tile's yield only by standing on it. A tech, **not** a free scout-stat perk |

New **structures** implied (beyond the camp): `larder · plot · kiln · library`
— these become build recipes as their tech lands. (The HEARTH is already any
resting place.)

**Deeper — directional, not pinned.** Space → charcoal → steam (engines,
automation) · concrete. Time → gear → mill → engine. Mind → **math** (precise
costs & optimisation) → biology → medicine · **engineered seeds** (Time × Mind,
crop yield ++). Capstone **electricity** = Space's steam × Mind's signal.

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
| **Crops** | seed or food | **sow / farm** | grains, vegetables — the farming loop |

Roster: seventeen raw resources today (DESIGN, *Forage & hunt*), and
**expanding past them.** The classes are the guardrail against sprawl — add
breadth inside a class, keep the class count small.

---

## The deep mechanics (few, on purpose)

Depth comes from a handful of composable rules, not from item count.

- **Sow vs eat.** A forage/crop item can be *consumed* (food now) or *kept as
  seed and planted* (more later). Planting needs suitable land (biome +
  elevation, deterministic) and time to grow. Every harvest becomes an
  "eat now or invest?" decision; farming becomes a loop, not a resource type.
- **Hunt** is built for meat (DESIGN, *Forage & hunt*). Still to come: HIDE
  (a material), then taming and herds.
- **Tiered yields = access, not surprise.** The world is deterministic, so a
  tile's *full* potential is knowable — even listable in the guide. Depth is
  **skill-gated access to known deeper yields**: a peak's metal node, at high
  lore, also gives a rarer vein. The tile advertises the
  ladder; the game is the climb (level the right skill, reach the right land,
  haul it home). Surprise moves from *what* to *the shape of your route up*.
- **Research.** Tech advances at a built structure, spending time + materials +
  `lore`, and persists. Early roots skip the structure.

---

## Light (what the night still wants)

The sun, the moon, the seasons' day length, the nocturnal start and the black
night with the lamp at your eye are built (DESIGN, *The dial, the sky and the
night*). What the night does not yet do is MATTER to the rules:

- **Visibility by hour × light.** The veil is display only — the sim scouts
  the same at midnight as at noon. Sight/scout range as a function of the hour
  and your light sources is where the day/night cycle gets teeth: night
  without light near-blind.
- **Carried light is progression.** The lamp's reach (`LAMP_R` and the rest)
  is the knob a torch or a lantern widens later, and `fire` gains a LIGHT role
  — a reason to want it beyond cooking. The lamp you start with is a floor, not
  an earned thing; whether even that should be earned is open.
- **The moon** already lifts the veil a little; a second, passive night-light
  that bites on sight is the next step for it.

---

## Determinism as structure (the through-line)

Determinism doesn't kill the game — it tells us which mechanics to build.
Surprise-based mechanics are weak (a determined player computes them).
**Access-based** mechanics are strong: the world is a known map of potential,
and play is *can I reach it, afford the reserve, and have I developed enough to
take it?* Every system above leans on access, not secrets.

---

## A board's place on the wheel (hook, not decided)

Each board has its own hash stream (its texture, and its figure's key).
Candidate use: a slice of it seeds the board's **hue on the wheel** — its pillar lean —
which sets what its figure teaches best and which tech it favours. Ties the new
systems back into the "identity shapes the world" spine with no new randomness.
Held as a documented option.

---

## Build order (so we ship, not drown)

Landed already: the biome yield SET, fauna/hunt with the tools it takes (see
DESIGN, *Forage & hunt*), and lessons and teaching (DESIGN, *Figures &
lessons*). What's left:

1. **Sow / eat crop loop** — the deep one, and what finally gives `farm` a verb.
2. **Tech tree** — start with 2–3 roots + one rung each (preservation, better
   seeds, the wheel/road).
3. **The idle verbs.** All twelve skills are seated on the wheel, but
   `trade · farm · heal · dream` still carry no effect at all (`SKILL_INFO`'s
   `effect` reads "—" for each; dream is trained by sleep and does nothing with
   it). Give them loops.

---

## Still open (decide before the matching build step)

- **Unique vs shared** as a real leveling rule (specialty vs generalist).
- **Research gating** specifics (which structure, what prerequisites).
- Whether the **board-hue hook** becomes real or stays flavour.
- How far **biome terrain colours** and the **skill/tech wheel** should actually
  share hues vs stay separate languages.
- **The angle seeds the land** since RULES 58 (the world key is your key and
  the angle), which sits against *the angle is social, never power* below —
  reconcile the doctrine with it.

---

# Toward (moved from DESIGN.md 2026-09-10, reconciled 2026-10-20)

North-star sections. What has since been built — the figures and lessons, the
land, the sky, setup — now lives in DESIGN.md; what was tried and dropped on
the way is in `attic/decisions.md`.

## The arc (vision, 2026-07-04 — north star, not scheduled)

- **Your world is the globe**: seventy-two boards derived from your key and
  the angle (DESIGN, *The world* and *The land*), played flat and, once
  cleared, wrapped (*The wrap*, below).
- **Progression = the gate rule, self-similar**: clear the home board and
  stand on its door → its gate opens; clear the world (or an ability-gated threshold of
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
  HUE comes early and with a USE — it marks what's YOURS (built so far:
  the struck tile and the home centre wear it from setup on; the trail and
  later buildings to come). The faction/relational meanings wait for
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
  hidden, abilities automating exploration (exploring tile by tile is
  deliberately tedious until they do) — all instances of this rule. Built
  so far: skills appear only once met, and the parent view stays locked.
- **Seasons / weather (crude)**: sunlight varies over the 360-day year
  (built, display only: the season shifts day length); every player runs the SAME season curve, phase-rotated by their angle,
  and starts at the same relative point in their own curve — fair by
  symmetry, equal totals over the loop, identical solo experience. The
  phase exists only RELATIVE to other players, which is what powers
  front (3): your winter is literally an opposite angle's summer, so
  trade favorability EMERGES from phase-shifted surplus cycles rather
  than a bonus table. Baseline daily 60 stays sacred; seasons modulate
  the SURPLUS side (generation, growth, factory output) only — winter is
  what the builder layer must carry you through.

## Patterns

The player gains abilities over time and sets up "patterns" within the loop
(automation); patterns grow or collapse; on collapse they revert to the base
pattern and the player goes back to tweak them.

## Crossing water

- **A bridge DAMS the river.** The first bridge sits low on the water: **boats
  cannot pass it**. Later bridges — raised, arched, built rather than tipped
  into place — will let them through. So the first crossing has a price you
  can't see when you pay it: the tile you span stops being navigable, and a
  river you bridge early is a river your boats can't run later until something
  better replaces it. Crossing the water and travelling the water are rival
  uses of the same tile, and that tension is the point. (Today a raft passes
  under any bridge.)
- **Fording, earned.** The leap stays dry; fording stays open as something
  EARNED: a skill level or a learned ability that crosses one tile of river at
  a real cost, and never at a confluence.
- **Raising a bridge.** The BRIDGE has its rule and its price in the sim and no
  way to raise one — it wants the tile-picking gesture the design asks for (you
  choose the far bank), which is a UI question, not a rules one.
- **Bridges after the first.** Every bridge is materials + a morning's work
  (`BRIDGE_NEEDS`, `BRIDGE_MIN`), sited where you stand — and a bridge you
  sited yourself is a pattern you made. Whether later ones cost more is open.
- **Boats beyond the raft.** The raft is the first one and it arrives early —
  the wall's kit holds its materials. What's open is what comes after it: a
  boat that carries cargo, one that's faster, one you can own more than one of,
  and whether any of them is a craft, a skill or a place. The arc is settled
  though: the row between boards was a road → a river you can only stand in →
  a river you can run, from the first day you clear a board.
- **Can a bridge be undone?** Torn down, rebuilt raised, moved — or is an early
  crossing a permanent dam on that tile? Deliberately parked: no strong opinion
  yet, and nothing else waits on it.

## Editing a day

**Editing a day = change the log + re-simulate.** Edits cascade forward
(discovery + abilities propagate to later days); the discovery ratchet means
later days can't lose ground, but energy and abilities genuinely cascade.
Invalid-action policy when editing lands: leaning grey-as-broken. (Built so
far: looking back, replay and restore — see DESIGN, *The action log*.)

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
- **Confinement → commons.** Reuse the existing gate (open on clear, at the door) with the
  auto-open WITHHELD: a person is boxed in its board until a TECH gets it across its river.
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
  `gatheredAt` regrow clocks and `worked` spot counts, `day`, `worldStamp`. Discovery journaling keeps
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
  3 auto-run routines in `advanceDay()`; 4 confinement + crossing-tech + commons;
  5 parametric verbs, reactively.

Open: whether teaching/trading need LIVE co-presence (forces the harder interleave)
or can also resolve at bank; how a routine is EDITED (re-record whole vs splice);
the budget-curve source per actor (stat-derived vs flat).

## Idea box (unsorted — thrown in raw, to make sense of later)

- **NPCs as the skill economy (vision 2026-07-06)**: learning from figures and
  teaching them are built (DESIGN, *Figures & lessons*). What's left is to
  HIRE them — automation of manual tasks = the patterns pillar made concrete.
  JOBS derive, never log: hire is the logged intent (contract in day-start
  snapshots); execution is a pure payroll tick inside sleep() (e.g. a hired
  scout discovers N tiles in canonical order, N = f(stat)) — replay recomputes
  it, day-editing cascades. Wages = food/resources; contracts grow or collapse
  like patterns.
- **A board's centre, earned** (candidate, not implemented): the centre only
  becomes available once the tiles around it are cleared.
- **The 360-wheel is one wheel**: 360 days ↔ 360 degrees ↔ 360 hues. The
  angle, the calendar and the colour wheel are the same circle. Anything
  placed on one is automatically on the others.
- **The sun dial** is built (DESIGN, *The dial, the sky and the night*), and
  the user feels something is STILL MISSING in it — not settled. Standing
  aesthetic rule: hint at mechanics rather than simulate them.
- **Birthday unlock**: once a year the sun's hue equals the player's hue
  (sun position == chosen angle) — something unlocks/happens on YOUR day.
  What exactly: open.
- Sun ideas not built: sunlight affecting generation (ties to the builder
  layer); the dial as an earned instrument (UI-is-progression applies to it
  too — dev build shows it always).
- **The dial is a strand; the dream folds it (idea, 2026-09-01 — narrative
  first, no render code)**: the clock's dot vocabulary (the horizon is 720
  minute-dots; a lived minute is that same dot lifted to its action's height,
  standing on one thin stick; density is certainty) reads as a DNA strand —
  and the 12h face means a day is TWO LAPS around one axis: morning writes
  OUTWARD of the horizon, afternoon INWARD (`radOf`'s noon rule). Two rails,
  one backbone, the sticks as rungs: the double strand is already the
  geometry, we just never said so. What's missing is the PAIRING — 09:00 and
  21:00 land on the same angle and currently ignore each other.
  The narrative that earns it: SLEEP IS WHERE THE DAY GETS COMPRESSED. The
  dream (built 2026-08-10, display-only) already replays the day asleep — the
  camera following a hollow ghost through every logged move, one log row per
  beat on the day's own minutes, the rows lighting in step. Compressing a
  record is what folding IS, so the dream's shape is the day's own dots
  twisting off the flat ring into the folded strand as it replays: reading the
  day becomes storing it. Memory made literal — the day is transcribed while
  you sleep, and the consolidation boost (dream-level scaled, still unbuilt)
  is what the fold is FOR. It also gives the log journal its future shape: a
  banked day is a folded day, and a stack of them is what a life looks like.
  **Open before it becomes render code**: (a) what pairs — the two laps by
  angle (09:00↔21:00), or each lived minute with the way-home minute that
  answers it? (b) does the fold PERSIST (banked days keep it) or is it purely
  the sleep screen's animation? (c) if it persists, it must be the same
  element morphing, never a second copy crossfaded in (see the one-element
  rule the menu tile and the focused skill already obey); (d) the twist must
  not become decoration — whatever it draws still has to read as minutes, or
  it breaks the dial's one rule: every mark is a minute, and its place is what
  that minute did. Ties to `dream` the MIND skill (ENVISION — routines,
  programming-by-dreaming): if the fold is ever a MECHANIC and not a picture,
  this is where it hooks.

## Not built yet / parked

- Cube view content (special tiles), the parent-view "earn" mechanic, log
  editing, abilities/automation, Nostr persistence (day events; the identity
  intake is live, the save is localStorage).
- **Content that must stay a surprise**: time-revealed entropy (derive from
  H(seed ‖ future block hash/event id)), not secrecy — a client-side game
  cannot hold a secret from its own user, and the replay/verify architecture
  needs world inputs to be publicly recomputable anyway.

## The wrap

The world is a globe played flat (DESIGN, *The world*). Once every tile is
found, the map wraps: each torn river joins its twin, a step off a dashed bank
lands you on the twin board wherever the map drew it, the far side of the world
collapses from seven crossings to one, and the earned parent view is the globe
itself — a spinning polyhedron. The flat map never re-lays; the tears become
doors, and the world you cleared shows you its true shape.
