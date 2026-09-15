# decisions — things tried and dropped

Where the code's archaeology goes. A comment should say what the code DOES and
why the rule is the rule; when it starts narrating what we tried last week, it
moves here. Newest first. Keep entries to what a future self would need to not
re-propose the idea.

## the home board as a cave (2026-09-09 → 2026-09-10)

- **The cave.** Home took no light from the sky at any hour: a REGION on the
  night veil — the board's own 61 tiles at global `[0,0]`, one `Path2D` filled
  nonzero — held at its own darkness whatever the sun was doing. Sealed it sat at
  0.93 (7% of the world showing, your lamp the only thing you could read by);
  once the arrow was in it the whole room came up to 0.74 (26%, about a full-moon
  midnight) on the line's own run-in, so you watched light come down the ray and
  then FILL the place. Its one aperture was the break the arrow made: daylight at
  the lamp's own reach, swelling and dying with the sun so the hour still read
  from inside. Reverted on sight — too dark to like. Kept whole underneath it:
  the veil-as-one-mask, the lights list, and `occlude`.
- **Two things worth not re-deriving if it comes back.** The region has to LAND
  on its value, never add to it: piling black over the night gives a cave that is
  darker at midnight than at noon. One fill does it either way round — black ON
  at `(dark − nightA)/(1 − nightA)` when the cave is the darker, black OFF at
  `1 − dark/nightA` when it is the lighter, which a lit room IS against a moonless
  night. And it must be ONE fill: clearing the region first and refilling after
  leaves a bright hairline all round the board at night, because the antialiased
  rim comes out lighter than either side.
- **The sacred fire (never landed).** The arrow was to plant on the doorstep and
  leave a fire burning there forever, with carrying fire away — a branch, a burn
  duration — as the Time pillar's root tech. Cut back to just the arrow before it
  was drawn. VISION's line is the one to argue with first: *fire* is that root
  tech and "even seeing in the dark is earned", so a fire that lights the doorway
  for nothing is the auto-given it rules out. The version that survives it is a
  fire that is a PLACE, not a power: it burns at the one spot, it is not yours to
  carry or make again, and the tech becomes learning to take it with you.

## icons (2026-09-09)

- **The two-face coin.** Every icon was one NAME with exactly two sides — a
  FIGURE (a drawing of the thing) and a WORD (the word spelt in wedges) — and a
  side that was blank borrowed the other one. Dropped as too rigid: the division
  was structural, so a third drawing of the same thing had nowhere to live, and
  the borrow rule meant `sleep` quietly rendered its word because its figure was
  empty. Replaced by GROUPS: one `default` per name plus any number of LABELLED
  alternates, a call asking by label and falling back to the default. `word` is
  now just a label like any other. The store keys are unchanged (`build` /
  `build:word`), so nothing had to be rewritten — old entries' `face: "word"`
  reads as the label, `face: "figure"` as the default.

## the day, the look (2026-09-02)

- **Rest and resume.** A day-ender that slept you where you stood and woke
  you there with the trip out already on the clock. Scrapped: a day ends at a
  resting place — home, or a camp you built — and starts there. It was also
  the one action the meal clock had to special-case (the trip out and back
  both inside the first three hours).
- **The theme switch.** Light/dark, persisted, with a toggle in the title
  menu. Dropped for ONE look: the light paper on `:root`, nothing to switch.
  The night is not a theme — it's the game's own ink, and it stays.
- **The camera toggle** left the title menu with them; the free-pan mode
  itself is still in the controller behind its stored flag.

## the pack (2026-09-02)

- **Tool wear.** The axe carried `uses` (12 cuts) and broke when spent — the
  pack chips even showed the count in a dim box. Dropped as complexity the
  game doesn't need yet: progression on tools is TIERS by craft level instead
  (RULES 43), the fine tier lighter and quicker, so a tool is a thing you
  upgrade, not a thing you replace. Wear may come back with REPAIR as a verb,
  if repair ever earns its place.

## the clock (2026-09-01 → 02)

- **The dial's one soft shadow.** The whole clock drew into an offscreen layer
  whose alpha-boosted silhouette cast a single shadow, then blitted sharp on
  top — because a canvas shadow is the ink's own alpha blurred, so a 1px dot's
  spreads to nothing and only the way-home band ever visibly shaded. Dropped:
  no shadow anywhere, the clock draws straight onto the screen.
- **Hollow preview dots.** The spoken-for minutes as outlines instead of a
  paler fill. At `DOT_R` the hole is ~1.6px and closes up entirely at 1×, so it
  read as a slightly fatter dot. If the preview ever needs to read as its own
  STATE rather than a tint, the lever has to be bigger than an outline. (What
  worked instead: the preview carries no sticks — hovered time floats, lived
  time is planted.)
- **The way home in full bars.** For an hour the trip home wore the deadline
  pin's dot-thick round-ended bars while the lived day wore hairlines. Inverted
  the same day and it stands: done time is heavy, promised time is light.
- **The preview climbing out of the horizon.** A hovered action's minutes rose
  from the ring to their height. Wrong twice over: a dot part-way up sits at a
  height that MEANS something else on this dial (a scout reading as a walk on
  the way up), and the travel dragged the eye back across the grid it had just
  left. Now they grow in place, at the true height.
- **The lesson's edge fill, briefly reverted.** Removing it left the edge simply
  appearing full with the shape rotating around it — the one moment worth
  watching, skipped. Restored, and now drawn at the landed edge's own alpha so
  nothing steps in brightness at the handoff.
- **The click as an inverted button.** The figure's backing ran surface → ink
  with the sign inverted on top, fading back. Lighting the whole button read
  heavier than the click deserved. The press is the sign fading out while the
  ants close into a solid ring.
- **Tuning that landed after more than one try**: `STICK_W` 0.5 (washed to its
  dot's alpha) → 0.75 → 0.6 at full ink; the moon's lift on the night veil 0.55
  → 0.3 → 0.12; the horizon one ring of 720 dots at r=1 → two rings, 1440 dots
  at `DOT_R`, morning on the orbit radius and afternoon set `LAP_GAP` inward.
- **REFRESH under the name (2026-09-02 → 2026-09-04).** A row at the foot of
  the user block asked the relays again. Dropped: the lookup runs itself on
  every boot that lacks a name, and the block is meant to be just the face and
  the key.
- **Name and angle in one box (2026-09-02 → 2026-09-04).** Merged so the bar
  read `name · angle°`. Split again once the angle became a menu of its own —
  NEW GAME and the shelf drop from it — and the name's block kept only who you
  are. "reset everything" became "reset" the same day, and the playground line
  stays out of the title menu before there is a world.
- **The setup's shades, first pass (2026-09-05).** Every dimmed thing on the
  black setup screen was set against a lit screen: the dial's dots at rest
  0.25, the way home 0.4, the settled angle line 0.45, the ray 0.5, the aim
  0.6, the waiting breath's floor 0.2, the centre dot's rest 0.3. In actual
  daylight the whole drawing disappeared. Lifted about a third across the
  board — `DOT_A`/`DIAL_REST` 0.4, `HOME_A` 0.55, `GAME_A` 0.6, `RAY_A` 0.68,
  `AIM_A` 0.78, `TILE_ALPHA` 0.6, the breath floored at 0.35 — keeping every
  gap between them, so the drawing still reads in the same order. `SCOUT`
  (0.55) is left alone: it is the game's own discovery mark, quoted.
- **The wall (2026-09-04 → 2026-09-05).** The second minute lap was made by the
  homecoming: the ring, the hexagon and the dots all braked onto it together at
  `AT_HOME`, so for the 560ms after the last click nothing answered the click at
  all. Tried building the wall on the click and still braking the shape onto it
  — two clocks, and the shape still ignored the blow. Dropped for one: the click
  IS the impact (`struckIn`/`struckR`), everything is knocked down the `LAP_GAP`
  at once and stands struck, and `HOLD` later the blow lets it go. `T_HIT`,
  `wallAt`, `wallR` and `dotWall` all went with it.
- **The profile as a QUESTION (2026-09-05).** It was asked and hung up on:
  `pool.get` in two rounds — the NIP-65 relay list first, then the profile and
  follows off the key's own relays — each resolving only on EOSE from EVERY
  relay, so one dead bootstrap relay cost its full 3s connection timeout twice
  over, for three replaceable events. A first pass fixed the speed (one round,
  first answer wins, close on it) and was dropped the same day for the right
  shape: it is a WATCH. One subscription on all three kinds, open for the
  session, the key's own relays joining it when its list lands, nothing ever
  closed. The screen goes on the moment a kind-0 arrives (or one is already
  cached); everything else — including a name changed an hour later — folds in
  behind and redraws.
- **The sweep dropped all at once (2026-09-05).** `settle` was one scalar on the
  strike: every dot the sweep had lit went dark together, a beat that belonged
  to nothing. It is a FRONT now, run from the click that chooses the angle —
  out from 00:00 round to the reading, each dot going as it is passed, so the
  arc is drawn back into the angle it names.
- **The bows (2026-09-04 → 2026-09-05).** The angle line lifted twice, each bow
  rounding into a true half circle and folding into the triangle that met the
  crossing — one sampled path, so it really was the line moving. It drew the
  hexagon's spokes and edges as it went, and it was the most worked-on thing in
  the ceremony. Dropped anyway: it was a shape reaching for a point, and the
  construction it belongs to doesn't reach — it MARKS. The crossings are ticked
  now, and the hexagon is drawn through the six marks when it comes home.
- **The ticks (2026-09-05, one day).** The bows were replaced by a hand's tick
  mark through each crossing — a stick growing both ways out of it, square to
  the arcs. Gone the same day: the construction already leaves a truer record
  there. What stays at the crossings is THE STRING'S OWN POSITION, the two lines
  from them in to the middle, which are two spokes of the hexagon — and they are
  drawn as you pull rather than stamped at the click.
- **The carry (2026-09-04 → 2026-09-06).** The strike handed you the number's
  circle: you held it by the rim (so it travelled twice your hand), walked it out
  to the opposite dot, set it down, then held it by its middle and brought it
  home — two more clicks, cutting the last two corners. It was the most
  mechanical thing in the ceremony and the least interesting to do twice.
  Dropped whole, with `carryPlan`/`carryAmt`/`carryGrab`/`CARRY_GAIN` and the
  stepped `STAGES` that existed to hold between its clicks. ONE PULL takes every
  point now: the cords and the angle line simply run on through the middle to
  the crossings opposite them.
- **The strike's flare (2026-09-04 → 2026-09-06).** The angle line went up at the
  fat arrow's own width, full ink, and cooled to the game's hairline — the
  "glow". It survived being moved from the strike to the loose and back. Hidden
  in the end: with the arrow flying, the string snapping and the circle carrying
  its dots home all on the same beat, one more bright thing made the moment
  harder to read, not easier. `FLARE_W` went with it.
- **The three-beat homecoming, and the six dots (2026-09-06 → 2026-09-07, one
  day).** The click's choreography went: the corner markers snap OUT while every
  other ring dot grows DOWN to the second lap; the ring then MOVES UP through
  itself, the whole stick carried past it; then it SNAPS BACK onto the lap and
  stands to the second height. The corners set off only on that third beat, on a
  `thrown` ease that crawled for the first 82% of its 1140ms. Two stalls, and
  both read as the drawing losing its nerve — the descent was 85% done a third of
  the way through its beat and then sat until the next one fired, and the corners
  sat still for the best part of a second while it happened. Replaced by ONE
  flick outward and ONE move inward, everything at the same instant on one
  explosive ease (`blast`), which is what the click's impact was always trying to
  be. `explode`, `thrown`, `T_UP`/`T_BACK`/`AT_UP`/`AT_BACK` went with it.
  Alongside them went THE SIX DOTS — the frontier marks thrown in behind the
  shape, turning on past it into the tiles beside you and fading a second after
  the turn (`dotThrow`/`dotTurn`/`dotTurnIn`/`dotOut`, `T_DOT_TURN`, `DOT_HOLD`,
  `DOT_OUT`, `FRONTIER_DOT`). Once the markers travelled to the same mark they
  were a second copy of the same corner arriving at the same place: two pieces
  drawing one thing. The marker IS the corner's dot now, it is the only one
  drawn there, and it stays.
- **The setup's sky (2026-09-04 → 2026-09-07).** The twelve skill constellations
  rose over the horizon under the angle's last turn, with the moon on its axis,
  drawn by the world's own calls at 00:00 of day one — and the WHEEL stood turned
  to YOUR ANGLE rather than to zero (it turns a degree a day, so handing it
  `angle + 1` put the constellation of that bearing at the top), with the wake
  turning it home to day one before the world took over. It never read. At 00:00
  of day one the moon is exactly FULL, and the sky's own rule —
  `max(0, −sunAlt) · (1 − 0.85 · illum)` — washes the stars to 0.15 of their
  strength on a full moon, so what actually arrived was a lone moon and nothing
  else: a stray mark under the turn rather than a sky. Dropped whole, with
  `sky`/`skyDay`/`T_SKY_HOME` and the wake's wait on them (`openMs` is now just
  the tile's own uncovering). The world draws its own sky when it opens.
- **The angle line's colour, and the end marker put there fresh (2026-09-07 →
  2026-09-08).** Two things went together. The angle's own line took the hue at
  the end, starting AT THE ANGLE where the number stood and growing both ways
  out of it — inward to the middle, outward off the edge of the world — one
  stroke, one gradient. Scratched when the mark cut on the angle became the day's
  own: the face behind the line already wears every bearing's colour, that one
  included, so the paint said nothing the ring wasn't already saying. It stays
  the plain hairline the game draws. And the clock's END MARKER used to RISE at minute 0 while the six
  corners shrank away — a mark arriving to replace the one that was leaving, at
  the same spot, on the same beat: two pieces drawing one thing, the same fault
  the corners and the frontier dots had. Now the angle's own corner IS it — the
  mark cut on the angle retreats off the hexagon's corner to the horizon,
  whitening as it goes, stands there while nothing moves, and the turn carries it
  round to twelve. Only five corners go. The retreat was first spread across the
  whole beat to buy the gap, which just made it slow; the gap is its own beat
  (`T_HOLD`), and the turn eases IN out of it as well as out at the end.
- **The face's conic gradient (2026-09-07 → 2026-09-08).** The hues went on as
  ONE `createConicGradient` over the ring's own sticks, so the coloured face was
  still the single stroke it had always been. Replaced by 120 arcs of one colour,
  3° and six sticks each: the conic gradient is not supported everywhere, and
  where it isn't the whole face came up flat. 120 is under the eye's step at this
  radius, and the stroke count is the ring's own.

## the scout ramp (2026-08-03 → 04)

- **Two gentler ramps, neither of which changed anything.** Before the per-ring
  step landed, scouting was priced by a smooth `1 + tiles/20` curve, and then by
  a step per BOARD ring. Both were tried and both left behaviour where it was:
  exploration still ran away with the game, because the budget IS the discovered
  tile count and any cheap scout COMPOUNDS — every tile revealed buys more
  revealing tomorrow. The per-TILE ring is the one that bit. If the steepness
  ever looks unreasonable, this is why the gentle versions don't work.
- **The 3× cap.** The ramp was capped at 3× for about an hour and reverted the
  same day. The steepness IS the mechanic: uncapped is what makes distance stop
  being free real estate and settling the better move. What the cap did prove is
  worth keeping — see DESIGN's *Energy / movement model*: sailing pays the ramp
  hardest, because the ring is distance from the world's origin and the river
  network winds outward, so a raft's range is really the scout budget.
