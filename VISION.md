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
  turn. The constellation wheel already built IS the TIME pillar's emblem;
  `lore` living in MIND is why it gates the sky/calendar reveal.
- **A currency per pillar** (candidate): SPACE → matter & sustenance (materials
  + food→energy via cook), MIND → knowledge, health & design
  (heal/lore/build), TIME → reach/circulation. A three-resource economy that
  emerges from the structure instead of being bolted on.
- **Skills can be MODIFIERS, not only verbs** — `lore` governs (sleep quality,
  calendar clarity, unlocking); `travel` just discounts movement. This is what
  keeps "12 verbs" from meaning "12 equal loops to invent."

**Unique vs shared (open).** Skills near a pillar's centre are *specialties*
(advance through that domain only); skills on a border are *generalists*
(advance through either neighbour's activities). Worth deciding as a real
leveling rule, not just a look.

**The biome bijection loosens.** 8 biomes but 12 skills → only SOME skills are
place-born; the MIND four are nearly placeless (learned from people and
knowledge, not terrain). "8 biomes ↔ 8 skills" becomes "some skills are
place-born, others aren't" — arguably better.

**"Pillar" is overloaded** — DESIGN calls building "the patterns pillar"; these
three (TIME/SPACE/MIND) are skill CATEGORIES. Reconcile the word.

**Sequence the build.** Harden the verbs that already have loops (scout, gather,
move, craft, build), then `lore`'s governing role (cheap, ties the calendar
together), then flesh the self-verbs around the sleep screen. `dream` is the
natural home of the routines below — dreaming = programming tomorrow's loop.

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
  you; your BUDGET (tiles discovered, see [DESIGN.md](DESIGN.md), capped at the
  waking window `WAKE_CAP` — the day less the sleep it owes) is how much you
  can act. Separate axes.
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

Landed already: the biome yield SET with its ground-row menu, and fauna/hunt
with the tools it takes (see DESIGN, *Forage & hunt*). What's left:

1. **Sow / eat crop loop** — the deep one, and what finally gives `farm` a verb.
2. **Tech tree** — start with 2–3 roots + one rung each (preservation, better
   seeds, the wheel/road).
3. **The idle verbs.** All twelve skills are seated on the wheel, but
   `trade · farm · lore · heal · dream` still carry no effect at all
   (`STAT_EFFECTS` reads "—" for each). Give them loops — `lore`'s governing
   role first, since it's cheap and ties the calendar together.

---

## Still open (decide before the matching build step)

- **Unique vs shared** as a real leveling rule (specialty vs generalist).
- **Research gating** specifics (which structure, what prerequisites).
- Whether the **board-hue hook** becomes real or stays flavour.
- How far **biome terrain colours** and the **skill/tech wheel** should actually
  share hues vs stay separate languages.

---

# Moved from DESIGN.md (2026-09-10)

Verbatim, not yet reconciled with the sections above — several of these cover
the same ground (the pillars, the skills, the sun & clock, resource classes).

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

- **Skills: nature vs nurture (v1 LIVE 2026-07-06; floored 2026-09-01)**:
  everyone starts at HALF their nature (`baseLevel = ⌊innate/2⌋`) **but never
  below 1** — a nibble average of 0 or 1 used to leave you at level 0, no
  shape at all, which contradicts the ladder's own "level 1 is the single seed
  dot, there's always one dot to grow from". You begin competent at
  everything, however faintly; nature sets the head start above that floor,
  not whether the verb exists for you. NPCs read the same helper, but their
  The floor is where you START, not a permanent one — teaching an edge away
  still empties the shape back down. Then it grows by learning; the
  asymmetry is the design — the PLAYER caps at 15 (perseverance always
  pays; the key sets the head start and the pace via `lessonXp`, never the
  destination). The `learn` action: an HOUR beside a teacher who currently
  outranks you; xp clamps at the teacher's level — nobody teaches past what
  they know. Learned progress is day-snapshotted state that replays from the
  log (the save stays log-only; your skills are literally your biography).
  First stat that bites: scout level discounts scout cost (half price at 15).
- **The FIGURES' BAND, and the last three levels (2026-09-01)**: the half-start
  is the **player's** arc, not everyone's. Figures have done their work all
  their lives, so they **sit at their nature** — and their nature is squeezed
  into `NPC_MIN..NPC_MAX` = **2..12**. Nobody in the world is born useless and
  nobody is born a master of everything; **13–15 is yours to GRIND**, by doing
  the verb, and cannot be handed to you. *Why this was needed:* NPCs used to
  start at half their nature, and `statsOf` averages 5–6 nibbles, so natures
  collapse toward 7.5 with almost no tails — on a sampled world only 2 of 720
  (figure, skill) pairs reached nature 15. Half of that is **7**, and 7 was
  therefore a hard, invisible ceiling on everything learnable, in a game whose
  own text promises the player reaches 15. The band keeps the distribution's
  shape but makes its top reachable.
- **The MASTER guarantee (2026-09-01)**: even banded, the top is rare enough
  that a world can hold **no teacher at all** for some skill — six of twelve on
  one sampled world. So twelve boards, drawn deterministically from the world
  key (a seeded shuffle, `masterSkillAt`), are each pinned to `NPC_MAX` in ONE
  skill — a shuffle, so no board masters two. Every world can therefore carry
  you to 12 in all twelve, and **finding who** is the game. Derived from the
  key, never stored: replay-safe, and the same world always anoints the same
  twelve.
- **The place bonus stops one short (`PLACE_CAP` = `NPC_MAX − 1` = 11,
  2026-09-01)**: home ground still lifts a figure in its biome's skill, but
  never to the band's top — reaching 12 takes real nature or the master
  guarantee. It can only ever LIFT (a figure already at 12 by nature keeps it).
  *Why:* at +3 to 12, any place-skill figure of nature ≥9 hit the ceiling, so
  **41% of every 12 in a world came from the bonus alone** and 56% of figures
  were a master of something — 12 stopped meaning anything, and `gather`
  (plains being common) had 15–21 masters per world against 1–4 for the rest.
  With the cap: the bonus contributes **0%** of the 12s, `gather` sits at 2–3
  like everything else, and the shape is 61.9% of figures with none, 31.4% with
  one, 6.3% with two, 0.4% with three (mean 0.45). The guarantee is untouched —
  every world still reaches 12 in all twelve skills, because mastery is applied
  last and independently of the bonus.
- **Teaching (RULES 6, 2026-07-10; edge-for-edge since RULES 25, 2026-07-21)**:
  the mirror of a lesson, and the reason teaching is *selective*. `teach` a
  figure a skill you currently OUTRANK it in (room left below `SKILL_CAP`):
  **one edge moves from your shape to theirs**. Yours drains by one — `given[]`
  counts edges out of the same shape lessons fill, and giving with an empty
  shape degrades the level itself (the previous, smaller polygon comes back
  nearly complete). Progress is ONE total-edge currency counted from level 0:
  nature just PRE-FILLS your base levels' edges, and the drain digs into them
  like anything else — the base is not an infinite well; you can teach yourself
  below your nature. Theirs fills by one — `taught[boardKey][skill]` counts
  edges in, and the figure climbs its own shape from its nature
  (`npcProgress`), completing a level only when the shape closes. Since
  2026-09-01 it carries them **above their nature, up to `SKILL_CAP`** — the
  end-game gift, and the only way anyone in the world passes 12. That can't
  leak levels back to you: `teach` demands you already outrank them, so you can
  never be handed a level you didn't grind first, which is exactly what keeps
  13–15 grind-only. Progress on both sides is one net-edge currency; `given`
  and `taught` are day-snapshotted and log-derived like `learned`. You
  literally give up your own edge to lift theirs — so who you teach matters.
- **Skills + lessons live on the clock ring (2026-07-10)**: the 8 skills sit
  at 45° inside the sun dial while the menu is open — glyph outward, number(s)
  inward. Facing a figure: yours and theirs with a learn/teach arrow (← take a
  lesson / → give one), equal → one number. A ← slot (green) or → slot (amber)
  is clickable in place and previews its cost on the ring. No more
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
- **Setup IS the game (2026-09-02)** — one screen with a PHASE, no flow of
  its own (the old screens and stage are in `attic/setup/`; the picker in
  `lib/setup/angle.js` waits for the angle phase). `dot`: black and the home
  centre's mark, which PULLS at the cursor (2026-09-03): the dot brightens as
  you near it, an edge stretches from the centre toward a point lagging your
  hand — a hair far out, the whole way at the tile, on a damped spring that
  quickens as you close in — breathes when you hold still, and marches like
  ants once you are inside the tile, the title standing at the cursor as the
  game's own hover label — its lines grown out of the cursor to the paper's
  corners, then the paper wiped across from the lines' side to reveal the
  type. The click starts a STEPPED sequence (2026-09-04, to work on each
  part): the label's lines retreat into its box and the box wipes out where
  it stands — the reveal's own wipe, the same way, hiding — while the title
  wipes in at its corner, the edge travelling the same way, and the cursor
  and a SECOND DOT rides out to that box's lower-right corner and rests
  there, hovering it: the line runs centre — dot — your cursor, ants marching
  on both. With a signer in place and the hand resting, the tether retreats
  into the dot and is gone, leaving one line from the title to the centre;
  THAT is what the reel pulls in — drawn to the centre, gathering speed, the
  whole thing handed back to your hand by a move — and
  reaching the centre it blasts 360 of the clock's dots out to the ring, the
  signer asked as they go. WITHOUT a signer there is no pull: the dot waits
  on the title and the word rides your cursor — "signer not found", and under
  it "make sure it's enabled". An extension that appears late
  is picked up on its own: the pull starts, and the ask follows. Escape steps
  back
  through them, and from the first back to the dot. `key`: the bar is up —
  the same bar, the same
  lists, the same menus — and the user box asks the signer: "waiting for
  signer" while the extension thinks, "signer not found" without one (it
  keeps watching for a late injection), "signer refused" as a button that
  asks again; the ring and the (inverted) box breathe as one meanwhile. The
  key in hand, the box reads the npub in full — still black, still breathing
  — while the profile is looked up, and a light runs round the ring,
  scanning; the profile found, the breath stops, the box shrinks onto the
  name and turns to paper, and the ANGLE MENU fades in beside it: with
  nothing on the shelf, NEW itself as a single button — and the compass then
  opens on its own, NEW pressed, no click needed; with a shelf, no cell but
  the angles dropped open on the bar's row, NEW last. `angle`
  (2026-09-04, rough — to be refined): NEW hosts the compass picker of
  `lib/setup/angle.js` on the ring at rest, in the glow, and stays pressed
  until the reading is held — then the cell reads the angle and the column
  folds. The strike then SETTLES the angle rather than firing a wheel (the
  spokes and the turn home went 2026-09-04): the drawing stands down to the
  one line the game draws an angle with — flaring at the fat arrow's width
  and cooling to a hairline, its dashes closing up into it — and the two
  crossings the walk had lit keep THE STRING'S OWN POSITION: the two lines from
  them in to the middle, which are two spokes of the hexagon, wearing the angle
  line's own faint hairline because they are drawing now and not gesture.
  The WAKE opens the world IN PLACE (2026-09-05, it used to reload and
  flash the whole chrome): the tile shrinks away and the screen simply takes
  the struck world — its angle and world key, a sim on them, banked, and the
  phase turned over through the same binding looking back uses. Six corners,
  all by hand. THE CLICK IS THE IMPACT: it keeps the second lap the
  alignment earned, and the hexagon and its dots are knocked inward onto it and
  stand there struck. A beat later the blow lets them go — the hexagon drawn
  fast through to the tile, SMOOTH ALL THE WAY (2026-09-06: it used to stop dead
  three-quarters through and wobble onto its mark, a bump in the middle of the
  one movement that should not have one). It sheds a copy in passing at that
  same moment, the two still one size, and the SAME SWING sheds a second right
  after it — but THE SECOND COMES OUT OF THE FIRST (2026-09-07), not out of the
  shape: it is shed at exactly the radius the player's hex has reached by then, so
  the stack is drawn one out of the next rather than two off the same swing at
  the same size. Both carry on in and land together, one at the
  player's own size and one at a figure's — three hexes nested, which is the
  game's own resting stack, and the shape you will stand there as. THE CLICK IS A PRESS AND A RELEASE, and the press GROWS EVERYTHING OUTWARD (2026-09-07):
  every dot on the ring is taken off it at once — the ordinary
  ones a level clear of the horizon, the six corners rising off the lap to stand
  highest of all at the END MARKER'S own height — and the shape, which those
  corners were holding on the ring, is let go with them. Then IT ALL GOES INWARD
  TOGETHER, in one move and at one instant, full speed the moment it is let go
  and a long smooth settle after: the ring's dots down through the ring onto the
  second lap, where they stand at its second height, still lit — they are the
  drawing now, and the lap they land on has gone back to being the dial; the
  hexagon through to the tile from where the press detached it; and the six
  corners all the way out to the tiles beside you, discovery's own distance. Each
  corner GROWS inward — its tip running to the mark while its far end stands where
  the press left it — and only once the tip is there does that end come after and
  SHRINK it onto the dot, where it stays. THE TIPS RIDE THE HEXAGON'S OWN DRIVE
  (2026-09-07), the same curve over the same window, so they come in with it
  rather than running on ahead — and each takes THE COLOUR OF THE BEARING IT WAS
  CUT AT on the way, so it is that colour by the time it settles.

  THE ANGLE'S OWN CORNER IS THE EXCEPTION (2026-09-07). It travels in line with
  the other five, at their exact radius and well clear of the shape, and only
  near the end does it PEEL OFF THEM — a smoothstep from their line onto THE
  HEXAGON'S OWN CORNER RADIUS, flat at both ends, so it picks up the speed the
  shape is going and eases out in sync with it rather than running a curve of its
  own. It reaches that corner a moment after the five have stopped, and rides it
  from there. (Sent straight at the corner it simply lay on the shape's edge from
  the first frame, which read as the two being stuck together; given its own
  second ease it stopped dead at the mark and started again, which read as a
  bump. One line off one line, and neither happens.) THE STACK WAITS FOR THAT
  TOUCH: the second hex is shed at the instant the line meets the corner, and
  what it paints behind it is the HOME TILE — the ground in the angle's colour,
  black over it, and the tile's own FURNITURE, the hairline ring and the thin
  radials running in from the edge, the way the world draws a rest spot. What
  stands in the seat is THE GAME'S OWN PLAYER (`drawPlayer`, imported), at the
  same radius, weight and colours the world gives it, turned to the shape's own
  bearing — north here is the angle. The figure follows it in, and the five
  gather onto their marks, arriving WHITE: the colour is what they travel in.
  AND GATHERED, EACH POPS: a stick shrunk to its own two caps is the ring's dot,
  and this one swells from there to the game's own FRONTIER mark, twice that
  size. The ring's own markers go the other way — shrinking OUTWARD onto the lap
  they stand on, greying as they go and fading out entirely as they land, since
  the lap's own 720 dots are already there and two coincident sets read brighter
  than the dial anywhere else. AND THE TURN OVER, THE FIVE GO (2026-09-07):
  they fade out where they stand, and what is left standing at minute 0 is THE
  DIAL'S OWN END MARKER — which is not a new thing put there. IT IS THE ANGLE'S
  OWN CORNER (2026-09-08): the mark cut on the angle, the one that ran on into
  the middle, RETREATS off the hexagon's corner back to the horizon and goes
  WHITE as it goes, arriving at the end marker's own span — foot on the horizon,
  head standing outward off it at the deadline pin's height. Then it STANDS
  THERE and nothing moves, and only after that hold does the shape turn,
  carrying it round to twelve o'clock. So what turns is a finished mark, and the
  drawing hands over to the clock by the ceremony's own last mark BECOMING the
  day's rather than being replaced by one: 320ms across, 260ms standing, and the
  turn eased IN as well as out, so it takes the movement up out of that hold
  instead of snatching it. (The retreat was spread over the whole beat first,
  which only made it slow — there was no gap at all between the mark landing and
  the shape moving, and the hold is what the beat was missing.) THE SIXTH
  DISCOVERY DOT goes down in its place (2026-09-08): five corners came out to
  the tiles beside you and this one went to the clock, leaving one neighbour
  unmarked — so a mark is put there on the same beat the five pop, at the same
  size and shade. Six tiles, six marks; what the angle's corner became is a
  separate matter. And as the shape turns THE WHOLE FACE TAKES ITS HUES
  (2026-09-07): every degree wears the colour the world paints THAT bearing
  with — 120 arcs of one colour, 3° and six of the ring's sticks each, rather
  than the conic gradient it was, which is not everywhere supported — and the
  six markers each take their own bearing's. THE ANGLE'S LINE DOES NOT
  (2026-09-08): it stays the game's own hairline. ONE PIECE PER
  CORNER: the marker IS that dot, and the ring does not draw a second one under
  it. The ring's own dots go from where the press left them — heads level with
  the corners, feet a level and a half out — down through the ring onto the lap.
  And the six TURN WITH THE SHAPE onto those tiles' own centres — a half
  step further round than the hexagon goes, because the tiles beside you sit
  BETWEEN its corners and not on them, so a mark that only rode the shape's own
  turn would come to rest 30° off its tile, which is no tile at all
  (2026-09-07). (Before this it took three beats and a crawl — the ring broke its descent
  in two and stalled between them, and the corners sat still for the best part of
  a second before setting off, which read as the drawing losing its nerve.) The finished
  tile then answers a hover: it takes the
  angle's own hue, the one the world paints the home centre with, and the
  wake mark stands on the player — that tile is the way in, and the only
  thing to click (the standing "wake" sign went with it, 2026-09-05). Only then — the mark drawn back and stood
  there — does the shape TURN, the shortest way, to a pointy top, and as it
  finishes the five go and that mark is what stands at minute 0. NO SKY COMES IN UNDER IT (2026-09-07): the twelve
  constellations used to rise over the horizon here, turned to your angle, but at
  00:00 of day one the moon is exactly FULL, which by the game's own rule washes
  the stars to a sixth of their strength — so all that arrived was a lone moon,
  reading as a stray mark rather than a sky. The ground stays black and the world
  draws its own when it opens. Both rings fill back to 720, the clock's two
  minute laps. Then the tile is the way in.
  The sweep from 00:00 to the reading is the ring's own dots filling,
  one per degree, not the picker's dashed arc — and CHOOSING takes it back:
  the lit arc goes out from 00:00 round to the reading, dot by dot as the
  front passes, drawn into the angle so that a clean ring is what is left; the circle the compass opens
  from the centre is the ring's other half — 360 dots on the half-degrees at
  the unchosen shade — so on reaching the ring the 720 align; an angle
  already struck (a game on the shelf) is a hollow dot, used, and the aim
  steps past it to the nearest free degree.

  CHOOSING SHOOTS THE RAY OUT: the aim's own marching line leaves the middle
  for the number while its head runs on past it and off the edge of the world
  — one segment, both ends travelling, which is the angle's seed ray.
  Meanwhile the reading SHUTS: its outline alone shrinks over the number, which
  stands at its own size and is clipped to whatever still fits inside, until at
  the bottom of that shrink the last of it goes and the circle takes the ink
  ground that makes it the angle's own dot. That runs BETWEEN THE TWO SNAPS —
  nothing while you are still in the ring's band, where the aim is held on the
  angle's dot and the number stands whole and readable — and it is your hand
  driving it, so walking back out opens it again.

  THE COLOUR IS WHAT THE ANGLE REACHES (2026-09-08). The angle line takes the
  ANGLE'S OWN HUE on the shot, and it runs through its own corner — so that
  corner is lit from the loose. THE MARKS DO NOT TAKE IT: the colour belongs to
  the RAYS, which are what the construction is doing, and a lit mark would read
  as the drawing keeping a record it has not earned. The angle's own marker is
  the one exception, and only because the angle line passes through it. From
  there the hue TRAVELS the
  construction: a lit corner's ray carries it to the corner it strikes, and the
  edge that deflects off there carries it on to the next. Each hop takes only as
  much as its source already has, so it RUNS round the drawing rather than
  switching on, and it holds only while something lit still reaches it — pull
  your hand off the middle and the chain breaks, most of the drawing drops back
  to plain ink, and the angle's own ray is left alone with it. Which makes
  the colour the ALIGNMENT'S OWN READING: one hue, spreading as far as the
  drawing is connected to the angle you chose, and covering all six only when
  the six rays have found their dots. (The ray graph alone doesn't close — on
  the middle each ray strikes the corner OPPOSITE it, three disjoint pairs — so
  it is the deflections, the hexagon's own edges, that carry the hue the rest of
  the way round. The thing that closes the shape is the thing that colours it.)
  The bowstring stops being drawn once it is fully into its nocks: with no
  length left, its round cap was a grey dot standing on a corner that has since
  been lit.

  THE PRESS TAKES THE SHAPE TO DASHES AND FILLS THEM IN (2026-09-08). Held, the
  hexagon goes to a STILL dash — the construction's own dash, not marching,
  because nothing is travelling any more — and then a solid line in the angle's
  colour runs out of THE ANGLE'S OWN CORNER and round the six the way the rays
  reflected — and STRAIGHT DOWN ITS OWN SPOKE at the same time, so that reaching
  the middle it goes the other five ways AT ONCE, out of the centre rather than
  in from each corner. (Six spokes each creeping inward off their own corner on
  their own beat read as six colours popping on, which is no travel at all; one
  line arriving at the middle and bursting out of it is one movement, and the
  spokes are done inside the first third of the press.) It is the MARKERS' own
  width, not the hairline: what the dashes were promising, made good. The front
  moves at one pace, straight off the press's window and not eased. AND A QUICK
  PRESS STILL PLAYS ITS PART (2026-09-08): let go before that window is out and
  the release WAITS on it — the answer is taken at the click, but the shape has
  to finish going to dashes and filling before it is allowed to leave with them.
  THE ANGLE'S OWN CORNER IS COLOURED THROUGHOUT: the angle line lit it at the
  loose and it does not give it back, so it stands in the hue through the press
  while the other five are still plain ink — it is the corner the fill comes
  out of, and it looks like it. (Tried first on the RAYS — keeping them alive through the press so
  their ants could go solid. Wrong twice over: they are still hung off your
  cursor at that point, which the press has finished with, and it took a
  restructure of the whole bow block to keep them. The shape is already there,
  already closed, and already the thing the ceremony is about.)
  AND THE ANGLE'S OWN CORNER DOES NOT LIFT (2026-09-08): the press takes the
  other five outward off the ring, but this one HOLDS ON THE HEXAGON, going in
  with the shape as it detaches and pulls in by the lap's own gap, keeping the
  span it had. It is the corner the fill runs out of, and it has to be touching
  to run. Its head reaches the end marker's height on THE DRIVE instead, so the
  press does nothing to this one but walk it in.

  THE LOOSE EMPTIES THE MIDDLE (2026-09-08). Two things go on the shot: the
  CENTRE DOT, which fades out over the loose's own beat as the cords run out of
  it to the corners — and the mark that actually goes is THE INTAKE'S OWN
  (render.js), not the picker's: the picker is handed `centreDot: false` because
  this screen already draws the middle, so it publishes the loose's amount
  (`fired`) and the intake's dot rides it out — and THE ANGLE LINE'S INNER HALF — the stretch from the
  middle out to the number, which the loose used to lay back down behind the
  departing arrow and now simply never draws. The angle is the part standing
  OUTSIDE the circle, from its number on the horizon clean off the edge of the
  world. Inside the circle there is your hand and the lines coming in from the
  corners, and nothing else.

  THE WAY BACK IS A BOW, and ONE WALK ARMS IT IN TWO HALVES (2026-09-07) — no
  click between them; what the walk is doing simply changes at the halfway mark.
  A circle of 720 grey dots is anchored on the number and opens as you come; where
  it cuts the dial are the bow's two NOCKS, the ring's own dots between them —
  the arc through the number — are its LIMB, lighting as the compass takes them
  in, and the STRING runs from nock to your hand to nock. ONLY HOW FAR ALONG THE
  ANGLE'S LINE you have come arms it: the string crosses that line square, so the
  bow reads your hand's distance along it and nothing else. ACROSS it your hand
  is your own — moving up and down arms nothing, it TILTS THE ARROW, which is
  threaded through the number and swings on it, and bends the string hanging off
  your hand; on the line those two limbs are in line and the string is STRAIGHT.
  And the hand THE BOW IS HELD BY cannot leave the circle it is opening: the
  string hangs off that one and the arrow's back sits on it, so both are held
  inside the circle anchored on the number. THE CURSOR IS NOT — it stays under
  your pointer wherever you take it, and what you see is the string refusing to
  follow you out. Fully open, that circle passes through
  the MIDDLE — so the pull reaches the middle exactly and no further — and how far
  you may swing across is the circle's own width, which is nothing at all at the
  number and grows with the draw.
  Out to HALFWAY the circle OPENS with you, its chord's middle held exactly level
  with your hand — a bow being positioned rather than drawn, with nothing behind
  you and the circle reaching on past — and at halfway it stands open at its full
  60°, the nocks exactly on the hexagon's first two corners, and STOPS. From there in nothing opens: what
  moves is the STRING, drawn back off that chord with the arrow, bending into the
  two limbs that meet at your hand, until it is home at the middle. (A chord's
  middle stands r − rho²/2r from the centre, so the radius that keeps it under
  your hand is √(2r(r−u)) — which is exactly r, the 60° bow, at halfway. And it
  is ONE drawing either way: the string is always nock-hand-nock, and in the
  first half those two limbs are simply in line.) They are ordinary ring dots until then; chosen, each grows A STICK
  that follows the string, standing on its own dot and rising along the cord
  where it leaves the nock, turning with it as you draw. THE LIMB IS NOTCHED
  too: every ring dot the bow has taken in wears a shorter one standing off the
  ring inward, and at the loose they all flick the other way, outward, on the
  string's own elastic — the limb letting go. Both are THE CLOCK'S OWN STICK
  (`dotRun`): a dot dragged along its minute — rooted on the ring, `DOT_R * 2`
  thick, round-ended, the caps ARE the dots, so at no length at all it is
  exactly the ring's own dot.

  Drawing the string draws THE ARROW, held at its back by your hand and
  threaded through THE ANGLE, which is a hole: it always points at the number,
  so moving your hand swings it. It GROWS AS THE CIRCLE'S FULL DIAMETER, its
  head held on that circle's far end, so the number sits at the middle of the
  shaft and the head runs out ahead as fast as your hand comes back — until it
  reaches its maximum, the dial's radius and the overhang. There it DETACHES
  from that far end and is simply PULLED: fixed now, the head following the
  hand back in. Heavier and brighter than the drawing round it, because it is
  the thing being aimed. Which makes the aim the whole task, since only one
  place puts it right: bring your hand to the MIDDLE and it lies along the
  dial's own radius, standing its overhang past the number — the line the angle
  is. Reaching the centre pulls the cursor into it to confirm.

  THE FIRE IS TWO PARTS. THE PRESS BRACES IT: before anything leaves, every dot the limb holds
  throws a STICK INWARD off the ring — the limb's at the dial's second height,
  the two nocks at the end marker's own — and the cords are given one last pull,
  each running a little past your hand toward the point it answers (the cords'
  own reach, not the hand's: the hand does not move). Those sticks
  are THE CLOCK'S OWN (`dotRun`): a dot dragged along its minute, rooted on the
  ring, `DOT_R * 2` thick, round-ended, the caps being the dots, so at no length
  at all a stick is exactly the ring's own dot.

  The press draws against resistance, easing out onto its stop, and NOTHING
  CHANGES PLACE (2026-09-07): it used to draw the whole hand back off the middle
  along the angle — the cords, the arrow and the cursor with it — and that small
  shift under a still pointer read as drift rather than draw. What the press does
  is stand the markers up. The string goes SOLID on that press: it is
  committed now, not a gesture. It stays braced for as long as you hold. LET GO OFF THE MARK — the cursor moved out of the middle —
  and NOTHING FIRES: the bow stands down, easing back off the draw, and the shot
  is yours to take again. Let go ON it and IT LOOSES, violently: the string is at
  rest almost at once and the arrow is gone with that first swing, and then the
  string RINGS, its swings dying away as it settles. That one press-and-release takes every point (the second
  pull it used to need — carrying the compass out to the far dot and back —
  was redundant and dull, dropped 2026-09-06). The arrow goes, gathering speed
  off along its bearing until it has cleared the world, and the game's own angle
  line is left standing where it lay, at its own hairline with the dashes
  closing into it. Nothing flares: the bright flash that used to go up here only
  made the moment harder to read (2026-09-06). THE CORD SNAPS INTO PLACE with it —
  not a new line but the same one, its apex leaving your hand for the chord's
  own middle, going there the way a released string does: at once, a little
  past, and settled — its stretch gone, and the sticks sliding the other way,
  outward, on that same elastic. Solid from the instant it fires; a snap has no
  trail to draw. AND ITS EXIT IS NOT A FADE (2026-09-07): settling, and before it
  has quite settled, the string BREAKS AT THE MIDDLE and each half is drawn into
  its own nock, shrinking to nothing there — and the halves land exactly as the
  six rays set out, so the bow HANDS THE DRAWING OVER rather than dissolving out
  from under it. Nothing fades: the line takes itself away. AND THE SHAPE YOU PULLED STAYS BEHIND (2026-09-07): the two limbs
  as they stood at the loose, faint and MARCHING — the record of the pull, and
  the hexagon's own first two spokes — while the string itself snaps off them to
  its rest. They march with the three cords running out of the middle, which
  makes five of the six spokes one moving line; the sixth is the angle line. The arrow goes on the string's own
  clock: it is the string that sends it. And THE CIRCLE COMES HOME on that same beat, off the number to the
  middle, where the two are one — circles a radius apart, so the travel is a
  radius along the angle: the middle lands on the dot opposite the number and
  each nock on the far crossing beside it. THE CORDS RUN ON OUT OF THE MIDDLE
  (2026-09-07): the string you pulled does not stop at its rest — three lines
  GROW out of the middle where it landed, marching, one to each of those three
  corners. Rooted and growing, not thrown, and QUICKER than the circle carrying
  its points, so the drawing runs ahead of the shot rather than trailing it: what
  you pulled is already part of what comes next. They stand until the six rays
  come and go into them. (All three leave from the MIDDLE: two used to set out
  from the nocks and run across to the corner on their own side, and the cords a
  further pair on through the middle to the corners opposite — but a moment later
  every corner sends a ray through your hand to another corner anyway, so those
  were the same corner-to-corner line drawn again and again. They were thrown,
  too — both ends travelling, stretching out of one dot and gathering into the
  other — which read as three things arriving rather than one drawing carrying
  on.)
  A MARKER IS BORN WHERE EACH CORD LANDS, and not before it (2026-09-07): its
  clock starts as they arrive and ends as the rays set out, so the mark is PUT
  THERE by the line reaching it rather than standing up to meet it. What stands
  where each one goes in is THE MARKER — no dot left
  over, the stick IS the mark: the dial's own, rooted on the ring and rising
  OUTWARD, square to it like every mark the clock makes. The brace's limb
  notches slide out and shrink away with the release, having been the brace and
  not the drawing, but THE NOCKS' OWN STAY, sliding out and standing there: those
  two are markers, the first two corners cut. The lit limb goes with the arrow,
  closing back toward the number and gone. THE READING GOES TOO (2026-09-07):
  it has shrunk to a dot on its own corner by the time the shot lands, and the
  marker born on that spot is that dot — a zero-length stick is one — so keeping
  it on left two marks for one corner. What is left is the angle line and six
  markers, one per corner and nothing else.

  THE SECOND LAP IS WHAT ALIGNING BUYS: until the six rays close there is one
  ring and the markers stand OUTSIDE it, their own length past the horizon; close
  them and the lap comes out under it, filling to 720, and EVERYTHING COMES DOWN
  ONTO IT — the corners, the balls, the ray tips and the markers with them, so
  the hexagon itself tightens by the lap's own gap and you feel it close.
  Misalign and it goes back the way it came. It cannot chase itself: how far a
  ray misses its ball is twice your hand's own offset and does not depend on the
  ring's radius, so tightening the ring never breaks the alignment that earned
  it.

  IT IS ALL ONE ACTION: the arrow is gone at 130ms, the string has rung out by
  340, the circle lands and the markers grow out of the ring on the shot's own
  ease at 520, and by 940 the markers have drawn back in and the rays are
  there. (The circle used to make that journey in 300 and the one move the whole
  loose is built on was over before it read.) (There used to be the best part of a second of nothing between the shot
  and them, which broke the loose in half.) And ALL SIX
  CORNERS REACH FOR YOUR HAND — a line out of each, its ants marching toward you
  — and each marker draws itself in until it SPANS THE TWO LAPS and no more, foot
  on the second and head on the horizon, which is the whole of what a corner
  needs to be. All six are that one stick, the number's own included, so the
  corners are one set of one kind. The cord goes as those rays come: the string
  has had its say, and what the drawing waits on now is your hand, not the bow. Each ray is CONTINUOUS: it comes out of its
  corner, passes THROUGH your hand and carries straight on to the ring — it does
  not stop where you are and it does not bend there. And EVERY CORNER CARRIES AN
  INVISIBLE BALL: one grown from its dot on the ring until it is FLUSH WITH THE
  LAP INSIDE IT, about three of the ring's own dots across. It is only how we
  know the ray struck that corner — nothing bounces off its surface. Strike one
  and the ray ENDS ON THE DOT, and the deflection leaves from the same place, so
  the two meet at the mark. And it leaves along an edge, DIRECTED and only made
  to look reflected — a true reflection off something that small could reach the
  next dot from one exact angle and never from the middle, so lighting them all
  would be impossible. THE WAY ROUND IS GLOBAL, one for all six: let each take
  the side it happened to be struck on and half of them turn back on the other
  half, which never closes and so never reads as anything at all. So the only
  question a ray asks is whether it found its dot. Find the middle, all six find
  theirs, and the six edges ARE the hexagon, closed. Nothing there is switched
  on: an edge GROWS along itself when its ray finds the dot, very fast, and
  draws itself back in the same way when the ray leaves — and it MARCHES with the
  ray that made it (2026-09-07), the same dash at the same offset, so a
  deflection reads as that one line carrying on rather than a second line put
  there. Nor does the lap cut in
  — a dot on the move is A DOT DRAGGED, the clock's own stick stretched between
  where it set out and where it has got to, gathered back into a dot as it
  lands, so the ring PEELS off the one it was on and the other 360 are drawn out
  of the dots beside them. It comes in LIT and STAYS LIT (2026-09-07), the whole
  lap of dots at full ink for as long as the alignment holds — this lap is the
  drawing, not the dial at rest. It dims by GOING, when the alignment is lost and
  it goes back the way it came, and by THE PRESS, which grows the ring above it
  into the drawing and hands the lap back to the dial — and the middle breathes for
  the click, the same sign it wore when it was waiting to be struck, for the same
  thing. Miss the ball and there is no mirror. The
  drawing waits there for the click that brings the shape home — and THAT CLICK
  IS ITSELF A PRESS AND A RELEASE (2026-09-07), the loose's own gesture again.
  The press GROWS every dot outward off the ring and holds it there for as long as
  you hold: nothing else has moved, and the shape stands closed on the ring with
  the rays gone. It is ONE MOVEMENT, not two: every head runs the same path out to
  the end marker's own height, the corners' and the ring's alike, so they are
  flush the whole way and flush at the top. What makes the six read as corners is
  their FEET — a corner's rises off the lap and roots on the ring, while the
  ring's own sets off late and follows its head out, coming to rest a level short
  of it. AND THE LAP UNDER THEM DIMS (2026-09-07): it came out lit and stayed lit
  while it was the drawing, but the press grows the ring above it into the
  drawing — so on the same ease as that growth the lap goes back to the dial's own
  rest, and is the face underneath again. The lit thing is the ring that GREW.
  AND THE HEXAGON DETACHES with it: it lets go of the ring its corners were held
  on and pulls in by THE LAPS' OWN GAP — the one distance the dial has — standing
  there for as long as you hold, so what you see under your finger is a shape
  that has come free. The release drives it home from that radius. The stick grows, and then it is dragged. (It was two eased moves at
  first, a growth and then a rise: each decelerated onto its own stop, and the
  press read as two steps rather than one.) Letting go plays the rest. Only an
  ALIGNED press takes it — the hexagon has to be closed for there to be anything
  to take, so a press off true is not a press here at all — and letting go OFF
  THE MARK stands it back down, finished and waiting, the way the bow does. The circle itself stays at FULL SIZE through all
  of this — the drawing is on the dial and stays on it — and the whole thing
  then HOLDS there, finished, until a click brings the shape home. THAT click
  is the impact: only then is everything knocked inward onto the clock's second
  minute lap.

  The ceremony ends on the tile itself, which lights under your hand and wears
  the wake mark; that click mints a world key, banks the fresh world and opens
  it in place.
  `play`: the world. The extension is only ever asked after the dot's click,
  and a remembered key is never asked for again (it boots straight to `key`,
  the angle menu open at once). The sim under the first phases is a
  placeholder, swapped for the keyed one through the same binding that
  looking back uses. No save → the game opens on `dot` or `key`; a save boots
  straight to `play`; "new game" parks the current game and reboots; "reset"
  wipes key and shelf and reboots.
