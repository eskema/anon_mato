# decisions — things tried and dropped

Where the code's archaeology goes. A comment should say what the code DOES and
why the rule is the rule; when it starts narrating what we tried last week, it
moves here. Newest first. Keep entries to what a future self would need to not
re-propose the idea.

## the docs sweep (→ 2026-10-20)

What DESIGN and VISION still described after the code had moved on.

- **The menu opened itself** on arriving at the home centre or a figure's
  centre. It opens only on a click on the player (or Space).
- **The ring as a split, and folders.** The left cells were YOU, the right the
  figure or the land you faced; a node with children fanned onto the outer
  cells and faded the level before it. The ring holds the skills and `enter`
  now, the land's facts ride a hover on the place name, and the fan code in
  render.js is unreachable.
- **The punch-out.** With the menu up, the tile underfoot was redrawn sharp
  over the blur from a snapshot (`menuSnap` is still filled, never drawn). The
  grown tile and the risen figure replaced it (2026-08-10).
- **The stacked clock across the top** — year / month / day / hour bars with a
  play button — gave way to the sun dial; its code is `lib/stash/timeline.js`.
  Its replay (restore the day-start snapshot, re-apply the log, re-fog through
  the journals) went with it: looking back and replay now build the moment on
  a scratch sim from the log.
- **The 11px status line** (`at [q,r] · 60m until rest · …`): `statusLine()`
  is never called.
- **The stats card**, `lib/radial.js` (8 skills as labelled bars): nothing
  imports it.
- **A category's reference in its corner** — home land, character, what it
  does (`SKILL_INFO`) — and the corner glyph closing the category. The name and
  level stand top left, the glyph carries no click, the middle tile steps back.
- **TELEPORT** from a home tile to a known board centre left the ring on
  2026-08-10.
- **The world as the 61-board parent grid with the npub inscribed on it** —
  64 nibbles → 61 boards in a centre-out spiral, home the world's minimap by
  construction, the main key the BASE field and a throwaway GENERATED key the
  per-board detail (rerollable texture), the board centre showing the key's
  middle four as a 2×2 block. RULES 51 made the world a 72-board globe, and
  RULES 58 one world key of the key and the angle: the pubkey inscribes
  nothing.
- **Starting at half your nature** (`baseLevel = ⌊innate/2⌋`, floored at 1),
  with a lesson's xp set by talent (`lessonXp`). RULES 46 starts every skill of
  yours at 1, and a lesson fills one edge.
- **Practice as doubling thresholds** — level k at `PRACTICE_BASE·(2^k − 1)`
  actions, added into the level. Practice fills fractional edges of the one
  shape instead.
- **Figures at half their nature; the place bonus to 12; masters from any
  board.** Figures started at half like you, which put the best teacher alive
  at 7; the +3 home-ground bonus reached 12, and 41% of a world's 12s came from
  it alone; the twelve masters were drawn from all boards until RULES 62 put
  them on the pentagons. The measurements sit beside `PLACE_CAP` in sim.js.
- **Eight skills for eight biomes**, a bijection. Twelve skills now; hunt,
  cook, heal and dream have no home land.

## the setup ceremony, as it was narrated (2026-09-02 → 09-08)

Moved verbatim from VISION on 2026-10-20 — DESIGN, *Setup is the game*, has
the short present-tense account. It narrates the ceremony as it was built in
early September, its tried-and-dropped notes included; details may have moved
since.

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


## deepness (→ 2026-09-30)

- **Water's own measure.** Water had no elevation: it read a separate
  `deepness`, 0 at the shore to 4 at the floor, which every reader of a tile's
  height had to ask for beside `elevation` (the hover, the place card, the
  contour rings, the shallows rule, the boat warnings). Now height is one
  number — water's elevation runs 0 to −4 — and `deepness` is gone from the
  sim's facts.

## the corners, unit by unit (→ 2026-09-30)

- **One box per UNIT.** The pack and the tile's pile drew every unit as its own
  big box wearing the item's tag (five plants were five "p" boxes), hovered and
  clicked one by one, every box in a column as wide as the widest. Now a box is
  a KIND, by its full name with how many, sized to what it says.
- **The pile along the foot.** What was put down ran left from the place's name
  along the bottom of the screen and SCROLLED (wheel, or a pull along it) where
  it would run into the pack; a press picked a box up only on release, so a
  pull could be told from a pick. Now it stands in the column on the name.
- **The load as loose text** over the pack column; now it is the box the pack
  stands on, and it opens "drop everything".
- **A craft that wouldn't fit the pack.** Once crafts drew from the ground
  (RULES 64), what they made could outweigh the pack: first the craft was
  refused ("pack full"), then your own units were swapped in for the ground's
  to make room. Both read as the game being clever at your expense; now what
  doesn't fit simply lands at your feet (RULES 66).

## the craft fan and the sticks (→ 2026-09-29)

- **Craft as a hex fan.** The recipes fanned round the player as named hexes on
  the map's own grid — the six neighbours first, then the next ring out — one
  node per tool KIND wearing the tier you'd make next, and a recipe above your
  level stayed out of it entirely. Replaced by the TIMELINE (a column per level,
  the next level dashed). Box layouts tried as mockups on the way: shelves by
  use (parts · gather · hunt · carry), columns by raw material (rejected
  outright), and a crude → fine ladder per tool — the ladder's reading is what
  survived, as the level columns; the sections went.
- **The timeline's first placement.** Its columns stood centred under the fire
  (where the kitchen's pot stands), the next level on paper with a dashed edge,
  and a box's bill stood fixed under the category's glyph at the top right,
  where the kitchen reads out. Moved the same day: the columns hang under the
  title at the top left as menus, the next level hollow, and the bill rides the
  cursor like every hover label.
- **Abbreviations in the craft menu.** Two-, three- and four-letter tags in the
  boxes, the tag's letters darker inside the full name to tie them together.
  Dropped for full names: the abbreviations confused more than they saved.
- **Sticks.** Wood was SHAPED before it went into a tool: a SMALL STICK with the
  cutter (two with the axe — the yield was the held tool's), a BIG STICK with
  the axe alone. The axe was a cutter hafted on a small stick, the snare a small
  stick and cord, the spear a point on a big stick. Awkward: working wood needed
  a tool made of worked stone, and the big stick needed the axe. Replaced by
  BRANCHES off the forest floor, which go into the tools as they are and feed
  the fire (a wood used to last ten cooks; a branch lasts two).
- **The spear point.** A shard knapped to a tip, named for the one thing it
  went into. Replaced (RULES 61) by the piercer and the crusher, heads that
  stand on their own beside the cutter — each hafted on a branch with a cord
  into its tool (axe, spear, hammer).
- **Fire-felling.** Considered and dropped before it was built: logs only from
  a tree brought down with fire, a long take burning branches, quicker with an
  axe. Wood is gathered as it was.
- **Everything crude at craft 1.** Bare hands could weave a basket or lash an
  axe on day one (RULES 46); the levels climb in steps now (RULES 60).

## regrow clocks on what you gather (→ 2026-09-29)

- **A clock per resource.** Every gathered thing came back on its own fixed
  timer in world-minutes: plants in 2 hours; berries, roots, oysters and kelp in
  a day; crabs in 2; fruit and eggs in 3; herbs in 5; nuts and wood in a week;
  rock in half a year; metal in a year. Dropped for the tiring count (RULES 59):
  a fixed clock let a spot be stripped every time it came back (a plant patch
  several times a day), and the gather level had no say in how hard a place could
  be worked. Now the level sets how much a spot gives at once, and pacing sets
  what it gives over time. Rock and metal come back in a day like everything else,
  so their scarcity rests on node rarity alone. Hunts kept their clocks.

## the wall's debris (RULES 33 → 55)

- **Debris as the crossing's price.** Opening the gate felled the wall into
  three loads of `debris` on the doorstep — the heaviest thing in the game, a
  full base pack each, so one load was one slow trip at double cost per step.
  A raft took one load and a bridge three, and building took only what lay on
  the tile, never what was on your back: haul it into the water, drop it, then
  build. Dropped (RULES 55) because it was a material with rules of its own
  that no biome grew. The wall leaves a starting kit now, and the raft and the
  bridge are ordinary bills — ferried over several trips when they outweigh
  the pack.

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

## sleep's button (2026-09-18)

- **Sleep inside the dream category.** For a few hours the dream glyph opened
  its category like any other, and the sleep button stood in scout's seat
  inside it — greyed with its reason when you couldn't. Dropped the same day: a
  category you open only to press one button is a detour. Now the dream glyph
  on the ring IS the button — hovered it wears the sleep glyph when the gate
  passes and says why when it doesn't — and the dream category is only ever
  reached by sleeping: the dream screen draws it itself.
- **A WAKE button in scout's seat.** Its other half went the same way, the same
  day: asleep, the dream mark itself is the way out (hover: "wake up").

## a category's layout (2026-09-25)

- **The glyph in the middle, the name top right.** Entering a skill, its glyph
  travelled into a white middle tile 1.5 tiles wide (scout 0.8), and its name
  and level stood big on two rows in the top-right corner. Now the hover label
  itself carries to the top left under the bar (setup's title motion), the
  glyph rests top right in the corner buttons' spot mirrored up, and the middle
  is one tile with a close on it.

## the seam, and board-local coordinates (2026-07-02 → 09-30)

- **The seam as its own kind of space.** The one-tile row between boards was a
  concept apart — the "seam": first a road you walked along at half a step, then
  (RULES 30) a river under the old name. Its tiles kept their own store on the
  parent node (`seamDiscovered`, `seamWalls`, keyed by global coord) while board
  tiles were filed on each board's node under BOARD-LOCAL keys, so every lookup
  first asked "board or seam?", and the log and the hover named a tile as
  `[board][local]`. Dropped: a tile has one address, its global hex; every
  tile's state sits in one ground per depth; the row is just the `river` type.
