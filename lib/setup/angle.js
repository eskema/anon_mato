// The angle — a WALK out and back, drawn with a COMPASS, and then the world is
// struck from it. In order:
//
//   aiming      — a circle anchored at the home dot opens to your cursor (thin
//                 SOLID: this is the line being drawn). Reaching the ring the
//                 number stands on, it SNAPS to the dial's own radius and holds
//                 there — a compass doesn't open wider than the world's circle.
//   angle held  — clicking the number keeps that circle struck for good, and a
//                 second one (DASHED — a construction line) is anchored on the
//                 number, opening to your hand as you walk back. Over the home
//                 tile it snaps to reach the centre exactly.
//                 That opening circle cuts the dial in two places: those are
//                 the BOW's nocks, the ring's dots between them its limb, and
//                 the string runs nock-hand-nock. Drawing it draws the ARROW,
//                 threaded through the number as through a hole.
//   the loose   — clicking home FIRES: the arrow goes off along its bearing and
//                 clear of the world, and the line it lay on flares up behind it
//                 and cools to the one line the game draws an angle with. The
//                 cord FIRES INTO PLACE with it - the same line, its apex
//                 leaving your hand for the chord's middle, coming to rest
//                 straight between the nocks - and the CIRCLE carries its own
//                 three points home in the same move, each drawing its line on
//                 the way and landing on the corner opposite it. Then all six
//                 reach for your hand, and each one's ray is DIRECTED off the
//                 corner it strikes to the next: SIX CORNERS OUT OF ONE PULL
//                 (the second pull it used to take was redundant and dull,
//                 2026-09-06). The drawing then HOLDS, finished, until a click
//                 brings the shape home; the tile lights under your hand, and
//                 the world when you click it.
//
// Nothing here confirms until that click: the ceremony is the OK's arrival.
//
// The shape of this - a compass, a bow, a construction that marks its own points
// - is worth keeping for the game itself: it would make a good puzzle.
//
// This is not a widget over the game. The face is the day's CLOCK, ringing the
// board from the board's own centre, and the line we draw IS the angle.

import { theme, hitBox, arrowTip, clickPulse } from "../draw.js"
import { drawPlayer, playerWeight } from "../render.js" // …the game's own token, so the stack IS the game's stack
import { drawIcon } from "../icons.js"

const REM = 16
const STROKE = 1.5 // shared line width: ring, ray, the reading's circle
const TILE_ALPHA = 0.6 // the home tile's outline — the ray and segment read as part of it
const DASH = [4, 5] // the world's own dash (the ghost trail wears it too)
const HOVER_DASH = [5, 5] // …and the world's hover-preview dash, which the aim is
// the trail weights, taken from the world (render.js): walked is solid and a
// touch thicker, the way home lighter and untravelled
const WALK_W = 2
const HOME_W = 1.5
const ARROW_W = 2.5 // …and the arrow in your hand, heavier than the drawing round it: it is the thing being aimed
const POKE = 0.85 // × a tile: how far its head stands clear of the number — enough to read as an overhang, not as a line ending on the ring
const HOME_A = 0.55
const AIM_A = 0.78

// the compass draws at FULL INK, hairline: at the dial's size any fade at all
// disappears into daylight, and this is the line being drawn — it stays
// subordinate to the walked leg by WEIGHT (1px against 2px), not by opacity

// THE CEREMONY, in milliseconds — two beats, one either side of the middle,
// each held until you move it on (see STAGES).
// THE STRIKE'S COLLAPSE (2026-09-04): the click home doesn't only fire the
// ceremony, it SETTLES THE ANGLE. The drawing's parts stand down — the dial's
// dots and the compass's circles dim to a whisper, the arrowheads flatten in,
// the reading's circle shrinks to a dot — and the leg and the ray CLOSE UP
// into one line: the dashes' gaps go to nothing, so what is left is a single
// stroke from the middle clean off the edge, at the exact weight and fade the
// GAME draws the angle with. It flares at the fat arrow's own width, full
// bright, and cools into that. The two points where the circles crossed, and
// the dot where the number stood, stay lit. The circles themselves keep the
// shade they always had — they are the drawing, not its scaffolding.
const T_FLASH = 560 // …one beat of the ceremony's own clock: the loose's parts all run inside the first
const T_SHOT = 380 // THE LOOSE: the aim's own line leaves the middle and runs off the edge of the world
const T_WIND = 300 // THE BRACE: the press draws against resistance, easing out onto its stop
const T_CORD = 340 // …and the release is VIOLENT: the string is at rest almost at once and then RINGS, dying out over the rest of this
const T_FLY = 130 // …while the arrow, gone with that first swing, clears the world in this
const T_PULLIN = 220 // …and the string's own exit: it breaks at the middle and each half is drawn into its nock, landing as the rays set out
const T_RUN = 240 // …and the cords run on out of the middle to the corners over this, ahead of the circle
const T_SHOOT = 520 // …and the circle is carried home over this, hard off the mark but long enough to be SEEN arriving: at 300 the one move the whole loose is built on was over before it read
const T_UNBRACE = 280 // …while the brace's own notches take this to slide out and shrink away
const T_UNSWEEP = 900 // …and the arc the sweep lit is drawn back into the angle at this pace — a whole lap's worth, so the front travels at one speed whatever the angle
const GAME_W = 1.5 // …and the line it cools to — render.js's own angle ray
const GAME_A = 0.6
const FAINT = 0.6 // …× that, for a line CONTINUED rather than drawn: the cords run on past the middle in it
const RAY_A = 0.68 // the line that runs ON past the number, once the angle is held
const T_DOTS = T_FLASH // …and the drawing's own beat, which the loose plays out inside (see T_SHOOT, T_CORD, T_UNBRACE)
const AT_DOTS = T_FLASH
const AT_ALIGN = AT_DOTS + T_DOTS // …then the circle comes home to the middle
const T_ALIGN = T_FLASH // …the last two edges settling closes the hexagon
const AT_HOME = AT_ALIGN + T_ALIGN
// ONE ACTION, NOT TWO (2026-09-06): the markers settle and the rays come the
// moment the flights land — there used to be the best part of a second of
// nothing between the shot and them, which broke the loose in half.
const AT_MARK = T_SHOOT
const T_MARK = 420
const T_EDGE = 90 // …and an edge grows along itself this fast when its ray finds the dot, and back in when it leaves
const T_LIT = 120 // …and the angle's colour runs into a corner this fast once something lit reaches it, and back out when it stops
const DRAWN = AT_MARK + T_MARK // …and the drawing is done: it holds here for the click
// …and THE CLICK ITSELF IS THE IMPACT: every dot on the ring is FLICKED
// OUTWARD off it at once — the corners rising off the lap to stand highest —
// and then the whole drawing goes inward together, hard: the ring down onto the
// second lap, the corners on to the tiles beside you, the hexagon through to
// the tile. ONE MOVE, NOT THREE (2026-09-07): the ring used to break its descent
// into beats and the corners to crawl for most of a second before setting off,
// and both read as the drawing stalling.
// …and THE PRESS GROWS EVERYTHING OUTWARD off the ring in ONE movement: every
// head runs the same path out to the end marker's height, the corners' and the
// ring's alike, so they are flush the whole way and flush at the top. What makes
// the six read as corners is their FEET: a corner's rises off the lap and roots
// on the ring, while the ring's own sets off late and follows its head out,
// coming to rest a level short of it — the stick grows, and then it is dragged.
const T_TRIG = 380 // …the whole press: the release plays what follows
const T_DRAG = 130 // …how late the ring's feet set off after their heads
const T_DOWN = 340 // …then the ring's own dots go down onto the lap, in one movement — a short move, and quick with it: they are down while the long travellers are still going
const T_PUNCH = 760 // …and how long the hexagon takes to come through
const COPY_AT = 0.78 // …and the share of that drive at which the copy comes off it
// THE RELEASE OPENS ON THE TURN, ALONE (2026-09-08). Letting go SNAPS the shape
// out of the angle's orientation and brings it round to a pointy top, and while
// that runs nothing else moves — not the drive, not the ring's descent, not the
// face's hues. It used to be the LAST thing, after the shape was home and the
// stack was shed and the mark had drawn back and stood; it is the first thing now.
const AT_SPIN = AT_HOME + T_TRIG // …the instant the press is let go of
const T_TURN = 1760 // …and how long the whole beat takes: the shape comes round AND comes in over it
// THE BREAK GOES THE WRONG WAY, AND IT IS ONE MINUTE (2026-09-08). Letting go
// SNAPS the shape a minute of the dial AGAINST the way it is about to turn — a
// wind-up, held — and only then does it reverse and come round. Breaking the
// wrong way is what makes it read as breaking at all: a thing that sets off in
// the direction it is going has only started. ONE MINUTE, not a share of the
// turn: a share collapses as the turn does, so an angle needing a couple of
// degrees would barely break and one sitting on a corner would not break at all.
// The clock is 720 dots to the lap, so a minute is HALF A DEGREE.
const SNAP_MS = 100 // …how long the break takes — an absolute, so lengthening the turn never drags it out
const SNAP_DEG = 0.5 // …and how far it goes: one minute of the dial
const SNAP_T = SNAP_MS / T_TURN
const HOLD_MS = 260 // …and it STANDS at the wind-up this long before the rotation starts: the break needs the room to be heard
const HOLD_T = (SNAP_MS + HOLD_MS) / T_TURN
const EASE_IN = 1.3 // …how much the run leans into itself out of the break (1 = none)
const FILL_LAG = 1.6 // …and how much the tile holds back against the closing edge (1 = none)
const AT_Y = 1585 // …when the seat's stub starts growing out of the middle
const BACK_C = 1 // …and how far past its length it goes before settling: ~3.7%
const GHOSTS = 10 // …the trail's own copies, across the arc the shape has just come through
const SMEAR_MS = 100 // …over the break's own window, which is what it belongs to
const SMEAR_DEG = 9 // …and how far back along the arc it reaches, at its widest
const AT_PUNCH = AT_SPIN + T_TURN // …and the parked drive home would start here
const AT_THROW = AT_PUNCH // …and the corners set off with it, in the same instant as the ring's descent
// …and THE ANGLE'S OWN CORNER DOES NOT STOP AT THE MARK (2026-09-07): the other
// five gather onto theirs, but this one carries on at the same pace, into the
// MIDDLE, and stands there full length in the angle's colour — which is that
// angle's own leg, drawn by the mark that was cut on it.
const LEAVE = 0.7 // …the share of the shape's drive at which the angle's own corner starts to leave the other five
const T_LATE = 180 // …and how long after they stop it takes to reach the hexagon's corner
const AT_TOUCH = AT_PUNCH + T_PUNCH + T_LATE // …when the angle's own corner reaches the hexagon's
const AT_COPY = AT_TOUCH // …and THE STACK COMES OFF AS IT PASSES: the shape is home, the five are on their marks, and this one is going through…
const COPY_GAP = 140 // …and a third off the same swing, this far behind it
const AT_FIG = AT_COPY + COPY_GAP
const T_STACK = 460 // …and both carry on in over this
const AT_STACK = AT_FIG + T_STACK // …where the stack lands, and THE ANGLE'S MARK WITH IT: from the mark on it is on the copies' own clock and curve, one motion carrying all three, so it never stops and starts again
const T_GATHER = 447 // …the five tails gathering onto their marks, from the moment that hex is shed
const AT_GATHERED = AT_COPY + T_GATHER
const PLAYER_R = 2 / 3 // …× a tile: where the first comes to rest — the player's own radius (drawStack)
const FIGURE_R = 1 / 3 // …and where the second does: a figure's, so the tile ends as the game's own stack
const AT_TURN = Math.max(AT_STACK, AT_GATHERED)
const T_DRAWIN = 320 // …and the mark cut on the angle RETREATS off the hexagon's corner back to the horizon: quick across, easing onto its place…
const T_HOLD = 260 // …then it STANDS THERE, at the top of the dial, and nothing moves
const T_SETTLE = 300 // …and how long the popped dot takes to settle to the discovery's shade
const BACK_OUT = u => (u <= 0 ? 0 : u >= 1 ? 1 : 1 + (BACK_C + 1) * (u - 1) ** 3 + BACK_C * (u - 1) ** 2)
// AND IT ENDS ON THE TURN (2026-09-08). The new version is being built a beat at
// a time, and this is the only beat it has: the clock stops where the turn does.
// Everything past here — the drive home, the stack shed off it, the five
// gathering and popping, the mark's retreat and its hold — is the PARKED version.
// It is all still in this file, and none of it runs: the clock never reaches its
// windows, so every one of them reads zero.
const DONE = AT_PUNCH // …which is the turn's own end
const LAST = DONE
const HUE_ARCS = 120 // …and in how many arcs of one colour the face takes its hues: 3° each, six of the ring's sticks
const DOT_H = 1 // …the height the ring's own dots grow to, in those steps: one level, against the corners' 2.5
const LAP_GAP = 4 // the clock's SECOND minute lap stands this far inside the horizon (render.js's own)
const NEIGHBOUR = Math.sqrt(3) // × a tile: how far the tiles beside you have their centres
const FRONTIER_DOT = 2.5 // …and the size each ends as: the game's own frontier mark, twice the dial's dot
const T_POP = 20 // …which it takes on RIGHT AT THE END, gathered and held a fraction first: until then it is the dial's own stick at the dial's own width
const T_OPEN = 620 // …and the wake tile shrinks away, uncovering the player under it
const T_WAIT = 1000 // …and the finished tile stands EMPTY this long before anyone is in it
const T_BREATH = 3200 // …then THE SLEEPER'S OWN BREATH: one slow swell out of nothing and back into it

const clamp01 = v => Math.max(0, Math.min(1, v))
const span = (v, a, b) => clamp01((v - a) / (b - a))
const easeOutQuart = u => 1 - Math.pow(1 - u, 4)
// …and a smoothstep: flat at both ends, so a thing leaving a line it was travelling
// on parts from it gradually rather than stepping off
const smooth = u => u * u * (3 - 2 * u)
// …and a thing let go of: there at once, a little past, and settled
// …a string let go of: at rest almost at once, then RINGING, the swings dying
// away as it settles
const elasticOut = u => (u <= 0 ? 0 : u >= 1 ? 1 : 1 - Math.pow(1 - u, 3) * Math.cos(u * 24))
// …a BLAST (2026-09-07): full speed at the instant it is let go, then a long
// smooth settle. Every part of the homecoming runs on this one — the ring's
// descent, the corners' run to the mark and the hexagon's drive — so they read
// as one thing let go of rather than three things starting.
const blast = u => (u <= 0 ? 0 : u >= 1 ? 1 : 1 - Math.pow(2, -9 * u))
const lerp = (a, b, u) => a + (b - a) * u

// `centre`/`radius` come from the hosting screen, so the face is the world's
// dial rather than a circle of its own invention. `tile` is the world's tile
// size — the trails' arrowheads are cut to it, so they weigh exactly what the
// game's do. `centreDot` is off when that screen already draws the middle.
// `used` hands in the angles already struck (games on the shelf): the aim steps
// past them to the nearest free degree. `segment: false` leaves the dashed
// sweep to the host (the game lights the ring's own dots instead), and
// `compassRing: false` the circle opened from the centre (the game draws it as
// the ring's other half of dots — see `compassR`).
export function AngleScreen({ centreDot = true, centre = null, radius = null, tile = null, home = null, used = null, segment = true, compassRing = true } = {}) {
  let api = null
  let angle = 0 // 0..359 — 0 is the initial/unset position
  let set = false // has the reading been clicked? (the leg commits and the way home appears)
  let pointer = null // where we're aiming, the compass's pencil, and what lights the reading
  let readBox = null // the reading's hit area
  let struck = 0 // when the ceremony was LOOSED (performance.now), or 0
  let pulled = null // …and WHERE YOUR HAND WAS when it was: the shape you pulled stays behind
  let braced = 0 // …and when it was BRACED, the press that comes before it
  let slack = 0 // …and when a brace STOOD DOWN unfired, so it can ease off rather than blink out
  let slackAt = 0 // …from the amount it had drawn to
  let stage = 0 // THE CEREMONY IS STEPPED (2026-09-04): which of its parts is playing or holding…
  let stageAt = 0 // …and when that part began
  let lastL = null // the layout the last frame drew with — the waiting pulse asks it for the home test
  let opened = 0 // …and when the WAKE was clicked, for its own shrink
  let setAt = 0 // …and when the angle was CHOSEN: the circle you drew out goes then
  let snapAmt = 0 // THE SNAP ZONE (2026-09-04): 0 aiming free, 1 snapped onto the angle's dot — eased, held at 1 with the angle
  let snapAt = 0 // …its clock
  let homeAmt = 0 // …and the same pull INTO THE CENTRE on the way back, the angle held (2026-09-04)
  let hotAmt = 0 // …and the finished tile answering a hover, which is the way in
  let aligned = false // …all six rays found their dot in the frame just drawn
  const edgeHit = [0, 0, 0, 0, 0, 0] // …which corners were struck in it…
  const edgeAmt = [0, 0, 0, 0, 0, 0] // …and how far each one's edge has grown for it
  const litHit = [0, 0, 0, 0, 0, 0] // …how far the angle's colour reached each corner this frame…
  const litAmt = [0, 0, 0, 0, 0, 0] // …and how far it has actually come into each
  let letGo = 0 // …a release taken before the press had played out: held here (1 off the mark, 2 home) until it has
  let alignAmt = 0 // …and how far the second lap has come out for it
  let shutAmt = 0 // …and the reading's own closing, driven by the walk home (see draw)
  let fillAmt = 0 // …and the ink coming into it, which waits for that closing to END

  function enter(a) {
    api = a
    angle = 0
    set = false
    pointer = null
    readBox = null
    struck = 0
    pulled = null
    braced = 0
    slack = 0
    setAt = 0
    stage = 0
    stageAt = 0
    snapAmt = 0
    snapAt = 0
    homeAmt = 0
    hotAmt = 0
    aligned = false
    alignAmt = 0
    edgeHit.fill(0)
    edgeAmt.fill(0)
    litHit.fill(0)
    litAmt.fill(0)
    letGo = 0
    shutAmt = 0
    fillAmt = 0
  }

  // how far into the ceremony we are, in ms — 0 before it's fired
  // THE CEREMONY'S CLOCK, STEPPED (2026-09-04): its two beats — the strike's
  // own collapse, and the far side's once the carried circle is set down —
  // each play out and then HOLD at their end. The clock reads as one
  // continuous elapsed time; it simply stops between them.
  // THREE BEATS (2026-09-07): the drawing, then the shape coming home — and that
  // one is ITSELF a press and a release, the same gesture as the loose. The
  // PRESS grows every dot outward off the ring and the beat ENDS THERE, held
  // for as long as you hold: the markers stand at their highest and nothing else
  // has moved. The RELEASE plays the rest, which is everything going inward at
  // once.
  const STAGES = [
    [0, DRAWN],
    [AT_HOME, T_TRIG],
    [AT_HOME + T_TRIG, LAST - AT_HOME - T_TRIG]
  ]
  const since = () => {
    if (!struck) return 0
    const [at, len] = STAGES[stage]
    return at + Math.min(len, performance.now() - stageAt)
  }
  const stageDone = () => !!struck && performance.now() - stageAt >= STAGES[stage][1]
  // …and the collapse itself, which the HOST fades its own dial dots by
  // THE LOOSE (2026-09-06): the click at the middle FIRES. The arrow goes,
  // gathering speed off along its own bearing until it has cleared the world,
  // and the game's own angle line is left standing where it lay — at its own
  // hairline, dashes closing into it. NOTHING FLARES (2026-09-06): the bright
  // flash that used to go up here only made the moment harder to read.
  const fireAmt = () => (struck ? easeOutQuart(span(since(), 0, T_FLASH)) : 0) // …what the dashes close on
  const flyAt = () => (struck ? Math.pow(span(since(), 0, T_FLY), 3) : 0) // …cubed: it barely moves, then it is gone
  // …and THE BRACE: the press drawing against its stop, held for as long as you
  // hold — and easing back off it if the press is let go off the mark, which
  // stands the bow down instead of firing it.
  const windAt = () => {
    if (struck) return 1
    if (braced) return easeOutQuart(clamp01((performance.now() - braced) / T_WIND))
    return slack ? slackAt * (1 - clamp01((performance.now() - slack) / T_UNBRACE)) : 0
  } // …on the CORD'S own clock: the string is what sends it
  // THE COMPASS IS CARRIED, NOT SHOT (2026-09-04): the collapse done, the click
  // has left you standing at the middle — which is a point ON the circle the
  // number anchors, where it meets the centre — and that is where you TAKE IT
  // OVER. You HOLD IT BY THAT EDGE, not by its middle: it does not move when
  // you take it. And held at the rim it has LEVERAGE — it travels twice what
  // your hand does, so your hand walking the angle line from the middle out to
  // the opposite dot carries the circle's middle exactly onto that dot, which
  // is a reach of one radius, not two. There is no copy — nothing stays where
  // it stood; only the dots it has already marked stay, as markers. The angle
  // line runs on THROUGH the middle to that dot, dashed with its arrowhead —
  // the game's own trail — and there it SNAPS, and the click sets it down.
  // Its crossings with the dial cut the other two corners: six, all by hand.
  // …and then AGAIN, home to the middle: this time you hold it BY ITS MIDDLE,
  // so it goes exactly where your hand does, and two lines out of the crossings
  // it just cut tie it to the dial's own circle as it comes. Set it down on the
  // middle and the two circles are one.
  // …and the loose, off the click that CHOOSES: the aim's line shot outward,
  // then drawn back in from the number to the middle
  const shotIn = () => (struck ? 1 : setAt ? clamp01((performance.now() - setAt) / T_SHOT) : 0)
  const lerp2 = (a, b, u) => ({ x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) })
  // THE SHAPE COMES HOME (2026-09-04): closed, the hexagon first SHRINKS onto
  // the tile you stand on, still at the angle it was drawn at — and only then
  // TURNS, the shortest way, to a pointy top. Its six corner markers go past it
  // as it shrinks and STOP at the tiles beside you, standing there for good.
  // The circle you brought home is already
  // there — the click put it, and everything else, on the clock's second minute
  // lap, both rings filled back to 720, which is the clock's own face.
  const homing = () => !!struck && stage >= 1 // …only once the hold is clicked past
  const readyNow = () => !!struck && stage >= 1 && since() >= DONE // the drawing is done
  // THE CLICK IS THE IMPACT (2026-09-05): setting the circle down on the middle
  // is a BLOW, and the whole drawing takes it at once — the ring, the hexagon
  // and its six corners all knocked the LAP_GAP inward onto the clock's second
  // minute lap, both rings filling to 720 there. Nothing brakes onto a wall
  // afterwards: they are already down, struck, and what follows is the drawing
  // moving as if that blow had freed it.
  // THE SECOND LAP IS WHAT ALIGNING BUYS (2026-09-06): until the six rays close
  // there is one ring and the markers stand OUTSIDE it; close them and the lap
  // comes out under it, filling to 720, and everything comes down onto it — the
  // corners, the balls, the ray tips and the markers with them, so the hexagon
  // itself TIGHTENS by the lap's own gap. Misalign and it goes back the way it
  // came. (It cannot chase itself: how far a ray misses its ball is twice your
  // hand's own offset and does not depend on the ring's radius, so tightening
  // the ring never breaks the alignment that earned it.)
  const struckIn = () => alignAmt
  // …and ITS DOTS COME IN LIT and STAY LIT (2026-09-07): the whole lap of them at
  // full ink as it peels off the ring, and full ink for as long as the alignment
  // holds — this lap is the drawing, not the dial at rest. They dim by going,
  // when the alignment is lost and the lap goes back the way it came — and BY
  // THE PRESS (2026-09-07), which grows the ring above it into the drawing and
  // leaves the lap as the dial underneath again.
  const lapLit = () => struckIn() * (1 - (homing() ? easeOutQuart(span(since(), AT_HOME, AT_HOME + T_TRIG)) : 0))
  const struckR = r => lerp(r, r - LAP_GAP, struckIn()) // …the radius everything is left at
  const punchIn = () => blast(span(since(), AT_PUNCH, AT_PUNCH + T_PUNCH))
  // …and the copies' own radii. The first comes off at the drive's FIRST stop,
  // both still the tile's size; the hexagon springs back on its wobble and
  // leaves it behind — and the SAME SWING sheds a second right after it, a
  // `COPY_GAP` later. Both go on in and land at the moment the dots do, one at
  // the player's radius and one at a figure's: three hexes nested, which is the
  // game's own resting stack.
  const copyR = (t, at, to, from = t) => {
    const e = since()
    if (!homing() || e < at) return 0
    return lerp(from, t * to, easeOutQuart(span(e, at, AT_STACK)))
  }
  // …and THE TURN EASES IN as well as out (2026-09-08): coming out of the hold it
  // takes up the movement rather than snatching it, and sets the shape down the
  // same way at the other end
  // THE BEAT'S OWN TWO AMOUNTS. `windDeg` is the break: a minute of the dial
  // against the way the shape is about to go, taken sharply and then HELD.
  // `runAt` is everything after it — a quintic, flatter at both ends than a
  // smoothstep, its input warped (v^EASE_IN) so the shape leans into the
  // movement rather than taking it up the moment the break lets go, and the
  // settle is left long. The turn and the draw-in both ride it, so they are one
  // movement with two things happening in it.
  const beatAt = () => (homing() ? span(since(), AT_SPIN, AT_SPIN + T_TURN) : 0)
  // …both taken AT A GIVEN POINT of the beat, not only at now, so the trail can
  // ask where the shape actually WAS a moment ago
  const breakAt = u => {
    if (u <= 0) return 0
    const back = hexTurn() >= 0 ? -SNAP_DEG : SNAP_DEG
    return u < SNAP_T ? back * easeOutQuart(u / SNAP_T) : back
  }
  const runOf = u => {
    if (u <= HOLD_T) return 0
    if (u >= 1) return 1
    const v = ((u - HOLD_T) / (1 - HOLD_T)) ** EASE_IN
    return v * v * v * (v * (v * 6 - 15) + 10)
  }
  const rotOf = u => {
    const w = breakAt(u)
    return w + (hexTurn() - w) * runOf(u)
  }
  const windDeg = () => breakAt(beatAt())
  const runAt = () => runOf(beatAt())
  const turnIn = () => beatAt() // …what the host keeps frames coming for
  // …which of the ring's 720 half-degrees a CORNER stands on: those six are the
  // markers themselves and the ring does not draw them a second time
  const corner = k => k % 2 === 0 && (((k / 2 - angle) % 60) + 60) % 60 === 0
  // the shortest turn that puts a corner at 12 o'clock…
  const hexTurn = () => {
    let d = -((((angle % 60) + 60) % 60))
    return d < -30 ? d + 60 : d
  }
  // …and THE MARKERS' OWN, a half step further the same way: they end on the
  // tiles BESIDE you, and those sit between the hexagon's corners, not on them —
  // so a marker that only rode the shape's turn would come to rest 30° off its
  // tile, which is no tile at all.
  const markTurn = () => hexTurn() + (hexTurn() < 0 ? -30 : 30)
  const opening = () => !!opened && performance.now() - opened < T_OPEN
  const wakeIn = () => (opened ? clamp01((performance.now() - opened) / T_OPEN) : 0) // …and how far it has come
  // …and how long the drawing has STOOD FINISHED, which is the only clock the
  // sleeper runs on: the ceremony's own stops at LAST
  const settled = () => (readyNow() ? performance.now() - stageAt - STAGES[2][1] : 0)

  const originOf = L => (centre ? centre() : { x: L.cx, y: L.cy })
  const radiusOf = L => (radius ? radius() : (L.minSide * 0.6) / 2)
  const tileOf = L => (tile ? tile() : L.minSide * 0.08)
  const huOf = L => tileOf(L) * 0.4 * 0.42 // …one of the dial's own height steps (render.js: dialHU)
  // is the pointer on the home tile? — the host owns that shape (it's the same
  // hit the accepting click uses), so it answers
  const atHome = L => !!pointer && (home ? home(pointer) : dist(pointer, originOf(L)) <= tileOf(L) * 0.87)

  // 0° points up, increasing clockwise.
  function angleFromPoint(c, x, y) {
    let deg = Math.atan2(x - c.x, -(y - c.y)) * (180 / Math.PI)
    if (deg < 0) deg += 360
    return Math.round(deg) % 360
  }

  const unit = deg => {
    const rad = deg * (Math.PI / 180)
    return { x: Math.sin(rad), y: -Math.cos(rad) }
  }
  const along = (c, deg, d) => {
    const u = unit(deg)
    return { x: c.x + u.x * d, y: c.y + u.y * d }
  }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

  // How far the ray can run from `c` before it leaves the viewport (less `pad`).
  // The seed ray is meant to run off the edge; the reading only uses this so it
  // never leaves the screen entirely where the clock does.
  function reach(L, c, deg, pad = 0) {
    const u = unit(deg)
    let t = Infinity
    if (u.x > 1e-6) t = Math.min(t, (L.w - pad - c.x) / u.x)
    if (u.x < -1e-6) t = Math.min(t, (pad - c.x) / u.x)
    if (u.y > 1e-6) t = Math.min(t, (L.h - pad - c.y) / u.y)
    if (u.y < -1e-6) t = Math.min(t, (pad - c.y) / u.y)
    return Math.max(0, t)
  }

  // Aim from anywhere — the ray follows the pointer across the whole world,
  // bearing AND length together. (No dead zone at the dot: freezing the bearing
  // while the length kept tracking left a line that grew out of nowhere. While
  // you're near the middle the ray is short enough that the swing is its own
  // answer.)
  function aimAt(p) {
    pointer = p
    angle = freeAngle(angleFromPoint(originOf(api.layout), p.x, p.y))
  }
  // …never a USED angle: a game already struck from it is not for choosing
  // again, so the aim steps to the nearest free degree, either way round
  function freeAngle(deg) {
    const taken = used ? used() : null
    if (!taken || !taken.length) return deg
    const set = new Set(taken.map(d => ((Math.round(d) % 360) + 360) % 360))
    if (!set.has(deg)) return deg
    for (let d = 1; d < 180; d++) {
      const a = (deg + d) % 360
      if (!set.has(a)) return a
      const b = (deg - d + 360) % 360
      if (!set.has(b)) return b
    }
    return deg
  }

  function onPointerMove(p) {
    pointer = p // (null: the hand is on the chrome — the compass lets go of it)
    if (p && !set) aimAt(p) // held: the pointer walks the way home instead
    api.requestRender()
  }

  // Clicking the reading is a toggle: it commits the leg, and commits it again
  // to let go. Letting go hands the ray straight back to the pointer where it
  // already is — and un-draws the board, because the angle it was drawn at is
  // no longer chosen. Reports whether it took the click.
  function onPointerDown(p) {
    // (the drawing finished and held, the press that takes it home is begin() —
    // the same two-part gesture as the loose)
    // once the world has been struck the number is on its way out — its box must
    // not go on taking clicks after you can no longer see it
    if (struck || !angle || !hitBox(readBox, p)) return false
    set = !set
    struck = 0 // the drawing was struck at an angle you no longer hold
    setAt = set ? performance.now() : 0 // …and the circle you drew out has done its work
    if (!set) aimAt(p)
    api.requestRender()
    return true
  }

  // ── the world's own stroke ─────────────────────────────────────────
  // A poly-line, dashed or solid. This is what render.js draws every trail
  // with (strokePixels); setup uses it because it is the same gesture, not a
  // picture of one.
  function stroke(ctx, pts, ink, w, a, dash, offset = 0, cap = "round") {
    if (pts.length < 2 || a <= 0.002) return
    ctx.save()
    ctx.lineJoin = "round"
    ctx.lineCap = cap
    ctx.setLineDash(dash || [])
    ctx.lineDashOffset = offset
    ctx.beginPath()
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
    ctx.strokeStyle = ink
    ctx.globalAlpha = a
    ctx.lineWidth = w
    ctx.stroke()
    ctx.restore()
    ctx.globalAlpha = 1
  }

  // …a colour taken toward black, for the hover's INVERSION: the tile fills
  // with its own hue, so every line on it has to turn dark to stay read
  // THE ANGLE'S OWN COLOUR — `hsl(deg 70% 55%)`, the one the world paints a home
  // centre with, mixed toward the ink the mark is already wearing (`t` 0 = ink,
  // 1 = the hue itself). Every degree of the dial has one, so the face can take
  // them all: the clock read as the colour wheel of angles it is.
  // (…and it takes the colour in either notation, since a mark on its way here
  // may already be wearing an `rgb()` of its own — see the white pop)
  const rgbOf = col => {
    const h = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(col)
    if (h) return [1, 2, 3].map(i => parseInt(h[i], 16))
    const r = /rgba?\(([^)]+)\)/i.exec(col)
    return r ? r[1].split(",").slice(0, 3).map(Number) : [232, 234, 242]
  }
  const hueAt = (col, deg, t) => {
    if (t <= 0.002) return col
    const was = rgbOf(col)
    const h = ((deg % 360) + 360) % 360
    const S = 0.7
    const L = 0.55
    const k = n => (n + h / 30) % 12
    const a = S * Math.min(L, 1 - L)
    const f = n => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
    const rgb = [f(0), f(8), f(4)].map(v => v * 255)
    return `rgb(${[0, 1, 2].map(i => Math.round(lerp(was[i], rgb[i], t))).join(",")})`
  }
  // …and the other way: up to PAPER WHITE, brighter than the drawing's own ink —
  // what the five gathering marks arrive as
  const toWhite = (col, t) => {
    if (t <= 0.002) return col
    const was = rgbOf(col)
    return `rgb(${[0, 1, 2].map(i => Math.round(lerp(was[i], 255, t))).join(",")})`
  }
  const toBlack = (hex, t) => {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
    if (!m || t <= 0.002) return hex
    const [r, g, b] = [1, 2, 3].map(i => Math.round(parseInt(m[i], 16) * (1 - t)))
    return `rgb(${r},${g},${b})`
  }
  // one closed hexagon, corners at `deg` + k·60 — a single path, so nothing
  // wears a cap at its points (six separate strokes left dots on every corner)
  function hexPath(ctx, c, rad, deg) {
    ctx.beginPath()
    for (let k = 0; k < 6; k++) {
      const p = along(c, deg + k * 60, rad)
      if (k) ctx.lineTo(p.x, p.y)
      else ctx.moveTo(p.x, p.y)
    }
    ctx.closePath()
  }

  // ── the compass ────────────────────────────────────────────────────
  // Anchored where the compass point stands, reaching out to your cursor, which
  // is the pencil. It SNAPS to a meaningful radius when the cursor reaches the
  // thing that radius belongs to, and the snap is what makes the drawing exact.
  //
  //   going out   — anchored at the home dot. It snaps to the dial's own radius
  //                 as you REACH THE RING the number stands on (or its reading),
  //                 and holds there however much further out you go: the compass
  //                 doesn't open wider than the world's own circle.
  //   angle held  — that first circle STAYS, struck for good; it's the opening
  //                 line of the drawing, not a hover effect. A second one is
  //                 anchored on the number and opens to your hand as you walk
  //                 back, snapping to reach the centre exactly on the home tile.
  const SNAP_TOL = 24 // how near the ring counts as having reached it
  const SNAP_MS = 160 // …and how quickly the aim snaps onto the dot (and lets go)
  const COMPASS_OUT = 320 // …and how quickly the circle you drew out goes, once the angle is chosen
  const ANTS_MS = 40 // the snapped line's marching clock (the game's own)
  const DOT_R = 1.2 // the dial's dot — what the reading's circle grows out of
  // THE CLOCK'S OWN STICK (render.js, dotRun): A DOT DRAGGED along its minute —
  // rooted on the ring, `DOT_R * 2` thick, ROUND-ENDED, and the caps ARE the
  // dots. At no length at all it is exactly the ring's own dot; every mark here
  // is that one stick, at the dial's own heights.
  const PIN_H = 2.5 // …the END MARKER'S own height, in those steps (render.js): what a nock rises to
  const BALL = LAP_GAP // …the invisible ball on each corner: FLUSH WITH THE INNER RING, its dot on the outer one at its middle
  const DOT_A = 0.4 // …and the shade of the dial's unchosen dots — the way back's circle wears it (render.js: DIAL_REST, the same shade)
  function ring(ctx, o, rad, ink, a, dash) {
    if (rad < 1 || a <= 0.002) return
    ctx.save()
    ctx.beginPath()
    ctx.arc(o.x, o.y, rad, 0, Math.PI * 2)
    ctx.strokeStyle = ink
    ctx.globalAlpha = a
    ctx.lineWidth = 1
    ctx.setLineDash(dash || [])
    ctx.stroke()
    ctx.restore()
    ctx.globalAlpha = 1
  }
  // …and a circle as the dial's own dots: 360 of them, one a degree, set half a
  // degree ROUND from the dial's — so laid over it the two interleave and read
  // as one ring of 720 (2026-09-04)
  // `twin` fills in the OTHER 360, on the whole degrees, so that once this ring
  // parts from the dial's it is a face of 720 in its own right
  // …and NOTHING HERE CUTS (2026-09-06). A dot on the move is A DOT DRAGGED —
  // the clock's own stick, round-ended, its caps the dots themselves — stretched
  // between where it set out and where it has got to, and gathered back into a
  // dot as it lands. `from` is the radius it left, so the ring PEELS off the one
  // it was on rather than reappearing inside it; and the other 360 are drawn out
  // of the dots beside them the same way, each onto its own half-degree.
  function dotRing(ctx, o, rad, ink, a, twin = 0, from = rad) {
    if (rad < 1 || a <= 0.002) return
    ctx.save()
    ctx.strokeStyle = ink
    ctx.lineWidth = DOT_R * 2
    ctx.lineCap = "round"
    const ring = (off, al, lag, r0, r1) => {
      if (al <= 0.002) return
      ctx.globalAlpha = al
      ctx.beginPath()
      for (let k = 0; k < 360; k++) {
        const t1 = ((k + off) / 360) * Math.PI * 2
        const t2 = ((k + off + lag) / 360) * Math.PI * 2
        ctx.moveTo(o.x + Math.sin(t1) * r1, o.y - Math.cos(t1) * r1)
        ctx.lineTo(o.x + Math.sin(t2) * r0, o.y - Math.cos(t2) * r0)
      }
      ctx.stroke()
    }
    // the ring's own, peeling off the radius it left and settling on this one
    const drag = Math.abs(from - rad) > 0.2 ? from : rad
    ring(0.5, a, 0, drag, rad)
    // …and the other 360, stretched out of the dots beside them
    if (twin > 0.002) ring(0, a * twin, 0.5 * (1 - twin * twin), drag, rad)
    ctx.restore()
    ctx.globalAlpha = 1
  }
  // THE ARROW (2026-09-05) — held at its back by your hand and threaded through
  // THE ANGLE, which is a hole: it always points at the number, so moving your
  // hand swings it. While you are still opening the circle it is that circle's
  // own width, the number at its middle; the CLICK freezes it at that length,
  // and from there nothing stretches — the tip simply SLIDES in and out through
  // the hole as you move. Which makes the aim the whole task, and only one
  // place puts it right: bring your hand to the MIDDLE and it lies along the
  // dial's own radius, tip a radius clear of the ring — the line the angle is.
  // NOTHING FIRES. The click takes that configuration as it stands and cements
  // the BOW round it; the arrow is still yours, and you draw it on to the
  // opposite dot, where it comes to lie on the dial's whole diameter with its
  // tip exactly on the number — which is where the ants point.
  function arrow(ctx, c, P, far, r, t, ink, a) {
    if (a <= 0.002 || homing()) return
    const fly = flyAt()
    if (fly >= 1) return // …gone: it cleared the world on the loose
    // …and THE PRESS DRAWS IT BACK a little further, with the cords: the whole
    // shaft comes, so the tip is pulled in too — that is the last of the draw.
    // LOOSED, it leaves FROM WHERE IT WAS SITTING and runs off along its own
    // bearing, which is the angle's; only while it is still in hand does it take
    // its aim from the number it is threaded through (out there the number is
    // behind it, and pointing at it would spin it round).
    if (!pointer && !struck) return
    const seat = pointer ? gripAt(c) : c
    const nock = fly > 0 ? lerp2(seat, far, fly) : seat
    const d = dist(nock, P)
    const aim = fly > 0 || d <= 1
    const ux = aim ? Math.sin((angle * Math.PI) / 180) : (P.x - nock.x) / d
    const uy = aim ? -Math.cos((angle * Math.PI) / 180) : (P.y - nock.y) / d
    // …and it GROWS AS THE CIRCLE'S FULL DIAMETER, its head held on that
    // circle's far end, so the number sits at the middle of the shaft and the
    // head runs out ahead as fast as your hand comes back. It stops at its
    // MAXIMUM — the dial's radius and the overhang, the length the maths leaves
    // it — and there it DETACHES from that far end and is simply PULLED: fixed
    // now, the head following the hand back in, until at full draw it stands
    // exactly its overhang past the number. The loose freezes it there.
    const len = struck ? r + POKE * t : Math.min(r + POKE * t, 2 * d)
    const tip = { x: nock.x + ux * len, y: nock.y + uy * len }
    stroke(ctx, [nock, tip], ink, ARROW_W, a)
    ctx.globalAlpha = a
    arrowTip(ctx, nock.x, nock.y, tip.x, tip.y, ink, t * 0.32, t * 0.2, ARROW_W)
    ctx.globalAlpha = 1
  }

  // WHERE THE HAND HOLDS THE STRING — your cursor, eased into the middle as the
  // centre takes it: the very point the host draws the cursor at, so the string
  // is held exactly where your hand is shown to be.
  // …and THE BRACE DRAWS THE WHOLE HAND BACK (2026-09-06): the press pulls it
  // off the middle along the angle, and the cords, the arrow and the cursor
  // itself all hang off this one point, so nothing drifts out of line with
  // anything else.
  // THE WALK HOME RIDES THE ANGLE'S OWN LINE (2026-09-07): the string crosses
  // that line square, and where it crosses is the only place the bow can be
  // held — so your hand is taken to it, and how far along it you have come is
  // the one measure the whole arming reads. `r` at the number, 0 at the middle.
  const reachRaw = (c, r) => {
    if (!pointer) return r
    const rad = (angle * Math.PI) / 180
    const u = (pointer.x - c.x) * Math.sin(rad) - (pointer.y - c.y) * Math.cos(rad)
    return Math.max(0, Math.min(r, u)) // …past the number is the number, behind the middle is the middle
  }
  const reachOf = (c, r) => lerp(reachRaw(c, r), 0, homeAmt) // …and the middle takes the last of it
  // …and THE CIRCLE'S RADIUS FOLLOWS FROM IT, in two halves of one walk. Out to
  // HALFWAY the circle OPENS with your hand — its chord's middle held exactly
  // under you, so the string is STRAIGHT and the bow spreads — and at halfway it
  // stands open at its full 60°, on the hexagon's first two corners, and STOPS.
  // From there in nothing opens: what moves is the STRING, drawn back off that
  // chord with the arrow to the middle. No click between them; the walk simply
  // changes what it is doing. (A chord's middle stands r − rho²/2r from the
  // centre, so the radius that puts it under your hand is √(2r(r−u)) — which is
  // exactly r at halfway, and the same 60° the press used to cement.)
  const rhoOf = (c, r) => (struck || braced ? r : Math.min(r, Math.sqrt(2 * r * Math.max(0, r - reachOf(c, r)))))
  // …and YOUR HAND IS STILL YOUR OWN across that line (2026-09-07): only how far
  // ALONG it you have come arms the bow, so moving up and down off it moves
  // nothing there — it TILTS THE ARROW, which is threaded through the number and
  // swings on it, and bends the string that hangs off your hand. On the line
  // those two limbs are in line and the string is straight.
  // YOUR HAND, as the drawing has it: pulled the last of the way in by the middle,
  // and nothing else. THE CURSOR IS THIS ONE (2026-09-07): it stays under your
  // pointer wherever you take it. THE PRESS DOES NOT MOVE IT (2026-09-07) — the
  // brace used to draw the hand, the string and the arrow back off the middle by
  // WIND_PULL and slide them forward again on the loose, and that small shift
  // under a still pointer read as drift rather than draw. What the press does is
  // stand the markers up; nothing changes place.
  // …and THE HAND THE BOW IS HELD BY, which is that one HELD INSIDE THE CIRCLE IT
  // IS OPENING (2026-09-07): the string hangs off this, and the arrow's back sits
  // on it. Fully open that circle PASSES THROUGH THE MIDDLE — so the pull reaches
  // the middle exactly and no further — and how far you may swing across is the
  // circle's own width, which is nothing at all at the number and grows with the
  // draw. Only while ARMING: loosed, your hand is your own and the six rays are
  // aimed with it.
  const handAt = c => (pointer ? { x: lerp(pointer.x, c.x, homeAmt), y: lerp(pointer.y, c.y, homeAmt) } : null)
  const gripAt = c => {
    const at = handAt(c)
    if (!at || struck || !lastL) return at
    const rr = radiusOf(lastL)
    const o = along(c, angle, rr)
    const lim = rhoOf(c, rr)
    const d = dist(at, o)
    return d > lim ? lerp2(o, at, lim / d) : at
  }
  // HOW FAR THE BOW HAS OPENED, in degrees off the number's own — a chord of
  // `rho` on a circle of `r` subtends 2·asin(rho/2r), so this is where the two
  // crossings stand, and the arc of ring dots the host lights between them.
  const bowDeg = L => {
    if (!set || !angle || homing()) return 0
    // …and it GOES WITH THE ARROW: loosed, the lit arc closes back toward the
    // number and is gone, leaving the markers standing on their own
    if (struck) return 60 * (1 - easeOutQuart(span(since(), 0, T_UNBRACE)))
    if (braced) return 60 // …cemented by the press, whatever the hand does next
    if (!pointer) return 0
    const c = originOf(L)
    const r = radiusOf(L)
    return (2 * Math.asin(clamp01(rhoOf(c, r) / (2 * r))) * 180) / Math.PI
  }

  // …a polyline revealed BY LENGTH, so a path with a corner in it grows at one
  // speed straight through the turn rather than pausing on it
  function partial(pts, u) {
    const out = [pts[0]]
    let want = clamp01(u) * pts.reduce((n, p, i) => n + (i ? dist(pts[i - 1], p) : 0), 0)
    for (let i = 0; i < pts.length - 1 && want > 0.001; i++) {
      const L = dist(pts[i], pts[i + 1]) || 1
      const take = Math.min(want, L)
      out.push(lerp2(pts[i], pts[i + 1], take / L))
      want -= take
    }
    return out
  }

  // …and WHAT IT LEAVES: the same path from that point on. A line the front has
  // half filled is drawn once — solid up to the front, marching past it — and
  // never as two copies of itself laid over each other.
  function rest(pts, u) {
    let want = clamp01(u) * pts.reduce((n, q, i) => n + (i ? dist(pts[i - 1], q) : 0), 0)
    const out = []
    for (let i = 0; i < pts.length - 1; i++) {
      const L = dist(pts[i], pts[i + 1]) || 1
      if (want >= L) {
        want -= L
        continue
      }
      if (!out.length) out.push(want > 0.001 ? lerp2(pts[i], pts[i + 1], want / L) : pts[i])
      out.push(pts[i + 1])
      want = 0
    }
    return out.length > 1 ? out : null
  }

  // …and where a ray from `o` along the unit `dx,dy` first strikes a ball of
  // radius `R` at `B` — the near face, so it is the surface it can see. Null if
  // it goes past it.
  function ballHit(o, dx, dy, B, R) {
    const ox = o.x - B.x
    const oy = o.y - B.y
    const b = ox * dx + oy * dy
    const disc = b * b - (ox * ox + oy * oy - R * R)
    if (disc <= 0) return null
    const t = -b - Math.sqrt(disc)
    return t > 0.001 ? t : null
  }

  // …and where a ray leaving `from` through `by` runs OUT ONTO THE RING: a line
  // through your hand does not stop at it, it carries straight on. Null if it
  // never reaches.
  function onward(c, r, from, by) {
    const d = dist(from, by)
    if (d < 0.001) return null
    const ux = (by.x - from.x) / d
    const uy = (by.y - from.y) / d
    const b = (by.x - c.x) * ux + (by.y - c.y) * uy
    const cc = (by.x - c.x) ** 2 + (by.y - c.y) ** 2 - r * r
    const disc = b * b - cc
    if (disc <= 0) return null
    const t = -b + Math.sqrt(disc)
    return t > 0.001 ? { x: by.x + ux * t, y: by.y + uy * t } : null
  }

  // WHERE TWO CIRCLES CUT (2026-09-05) — the pair of points, or null if they
  // miss each other. Circle (c, R) against circle (o, rho): the chord's middle
  // sits `a` along c→o, and the crossings stand `h` either side of it, square
  // to that line.
  function crossings(c, R, o, rho) {
    const d = dist(c, o)
    if (d < 0.001 || rho < 0.001 || d > R + rho || d < Math.abs(R - rho)) return null
    const a = (d * d + R * R - rho * rho) / (2 * d)
    const h2 = R * R - a * a
    if (h2 <= 0.001) return null
    const h = Math.sqrt(h2)
    const ux = (o.x - c.x) / d
    const uy = (o.y - c.y) / d
    const M = { x: c.x + ux * a, y: c.y + uy * a }
    return [
      { x: M.x - uy * h, y: M.y + ux * h },
      { x: M.x + uy * h, y: M.y - ux * h }
    ]
  }

  // the radius of the circle opened from the centre on the way out: to the
  // hand, snapped at the ring once reached, kept there once the angle is held
  // (0: none yet)
  function outRadius(L) {
    const held = !!(set && angle)
    if (!pointer && !held) return 0
    const c = originOf(L)
    const r = radiusOf(L)
    const reached = !!pointer && (hitBox(readBox, pointer) || dist(c, pointer) >= r - SNAP_TOL)
    return held || reached ? r : dist(c, pointer)
  }
  function compass(ctx, L, c, r, ink, A) {
    const held = !!(set && angle)
    if (!pointer && !held) return
    const a = A
    // the one you opened on the way out — SOLID, snapped at the ring, and kept
    // once the angle is held (unless the host draws it: compassRing)
    if (compassRing) ring(ctx, c, outRadius(L), ink, a)
    if (!held) return
    // …and the one anchored on the number, DASHED: a construction line, opening
    // to your hand on the way back. Once the ceremony is struck it stops
    // following you — it has its radius, and a COPY of it crosses to the far
    const e = since()
    const o = along(c, angle, r)
    // (the dial's own grey dots, 720 of them — not a dashed line — since 2026-09-04)
    if (!struck && pointer) dotRing(ctx, o, rhoOf(c, r), ink, DOT_A * a)
    // …and IT IS A BOW YOU ARE ARMING (2026-09-05). Where the compass cuts the
    // dial are its two nocks; the ring's own dots between them — the arc that
    // passes THROUGH the number — are its limb; and the string runs from nock
    // to YOUR HAND to nock, so walking home draws it. The further you pull the
    // wider it opens, and at the middle the nocks stand exactly on the
    // hexagon's first two corners.
    // THE CLICK CEMENTS IT: the nocks stop sliding — they are those corners now
    // — and the string stays where your hand left it, on the middle. The bow
    // does not go anywhere; what you still hold is the arrow.
    if (!homing()) {
      const rr = struckR(r) // …the ring THE DRAWING is on: every corner dot sits here, and all are one size
      const grip = gripAt(c) || c // …the string never lets go of your hand
      const rho = rhoOf(c, r) // …opening with the walk to halfway, cemented from there (and by the press, whatever the hand does next)
      const X = grip ? crossings(c, r, o, rho) : null
      if (X) {
        // …the cord marching TOWARD YOUR HAND from either nock, so it is drawn
        // as two limbs of one string, not one line across
        const march = -((performance.now() / ANTS_MS) % (HOVER_DASH[0] + HOVER_DASH[1])) // (compass() has no draw-scope clock)
        // THE FIRE'S FIRST MOMENT (2026-09-06): drawing it, the bow is only DOTS —
        // its nocks are ring dots like any other and nothing marks them. The
        // click BRACES it: every dot the limb holds throws a STICK INWARD off the
        // ring, the limb's at the dial's second height and the two nocks at the
        // end marker's own, and the cords are given one last pull past your hand
        // toward the points they answer. Only then does it all let go — the
        // sticks sliding the other way, outward, on the string's own elastic.
        const wind = windAt() // …the brace, which the notches stand up on
        // …and A MARKER SETTLES INTO ITS SHORT STICK: it draws itself in until
        // it spans the two laps and no more — foot on the second, head on the
        // horizon — which is the whole of what the corner needs to be.
        const mirror = easeOutQuart(span(since(), AT_MARK, AT_MARK + T_MARK))
        const rel = struck ? elasticOut(span(since(), 0, T_CORD)) : 0 // …and the string's own release and ring
        const half = Math.round((2 * Math.asin(clamp01(rho / (2 * r))) * 180) / Math.PI)
        const out = struck ? easeOutQuart(span(since(), 0, T_UNBRACE)) : 0 // …NOT the cord's elastic: that overshoots past 1
        if (half > 0 && wind > 0.002) {
          const HU = huOf(L)
          ctx.save()
          ctx.strokeStyle = ink
          ctx.globalAlpha = a
          ctx.lineCap = "round"
          // …and on the release the LIMB'S slide out and shrink away as they go,
          // leaving with the movement: they were the brace, not the drawing.
          if (out < 0.995) {
            ctx.lineWidth = DOT_R * 2 * (1 - out)
            ctx.beginPath()
            for (let k = -half + 1; k <= half - 1; k++) {
              const h = 2 * HU * wind
              const p0 = along(c, angle + k, r + out * h * 2)
              const p1 = along(c, angle + k, r + out * h * 2 - h * (1 - out))
              ctx.moveTo(p0.x, p0.y) // …standing ON its own ring dot, no gap
              ctx.lineTo(p1.x, p1.y)
            }
            ctx.stroke()
          }
          // …but THE NOCKS' OWN STAY, and stay OUT: they slide through the ring
          // with the rest and stand there for good. Those two are markers — the
          // first two corners cut — so they are drawn whatever the release has
          // done with the brace.
          ctx.lineWidth = DOT_R * 2
          ctx.beginPath()
          for (const k of [-half, half]) {
            const h = PIN_H * HU * wind
            const q0 = along(c, angle + k, lerp(r + out * h, r + LAP_GAP * (1 - struckIn()), mirror))
            const q1 = along(c, angle + k, Math.min(r + out * h - h, r - LAP_GAP * struckIn())) // …its foot on the second lap once there is one
            ctx.moveTo(q0.x, q0.y)
            ctx.lineTo(q1.x, q1.y)
          }
          ctx.stroke()
          ctx.restore()
          ctx.globalAlpha = 1
        }
        // THE CORD IS ONE LINE THROUGH YOUR HAND, and the loose SNAPS IT INTO
        // PLACE (2026-09-06): its apex leaves your hand for the chord's own
        // middle and the string comes to rest straight between the nocks. No new
        // line — the same one, at rest — and it goes there the way a released
        // string does: at once, overshooting, and settling. Solid from the
        // instant it fires: a snap has no trail to draw.
        const mid = { x: (X[0].x + X[1].x) / 2, y: (X[0].y + X[1].y) / 2 }
        const apex = struck ? lerp2(c, mid, rel) : grip
        // …two limbs of one string, each marching toward your hand — and the
        // brace has already drawn that hand back, so they come with it: the last
        // of the pull, taken by the grip and not by them.
        // …and IT GOES AS THE RAYS COME: the string has had its say, and what
        // the drawing waits on now is your hand, not the bow.
        const said = struck ? easeOutQuart(span(since(), AT_MARK, AT_MARK + T_MARK)) : 0
        // …and THE STRING'S EXIT IS NOT A FADE (2026-09-07): settling, and before
        // it has quite settled, it BREAKS AT THE MIDDLE and each half is drawn
        // into its own nock — the halves land exactly as the six rays set out, so
        // the bow HANDS THE DRAWING OVER rather than dissolving out from under
        // it. Nothing fades: the line takes itself away.
        const gone = easeOutQuart(span(since(), AT_MARK - T_PULLIN, AT_MARK))
        // …and once it is IN, it is not drawn: fully drawn into its nock the line
        // has no length left, and a round cap on nothing is a dot standing on a
        // corner that has since been lit.
        if (gone < 0.999)
          for (const nock of X)
            stroke(ctx, [nock, lerp2(apex, nock, gone)], ink, struck ? GAME_W : HOME_W, (struck ? GAME_A : HOME_A) * a, struck || braced ? null : HOVER_DASH, march)
        // …and THE SHAPE YOU PULLED STAYS BEHIND (2026-09-07): the two limbs as
        // they stood at the loose, faint and MARCHING — the record of the pull,
        // and the hexagon's own first two spokes — while the string itself snaps
        // off them to its rest. They march with the cords that run on out of the
        // middle, which makes five spokes of one moving line, and go into the
        // rays together.
        if (pulled && said < 0.998)
          for (const nock of X) stroke(ctx, [nock, pulled], ink, GAME_W, GAME_A * FAINT * (1 - said) * a, HOVER_DASH, march)
        if (struck) {
          const HU2 = huOf(L)
          // THE COLOUR STARTS AT THE ANGLE (2026-09-08): the angle line runs
          // through its own corner, so from the loose that corner is lit and
          // everything else takes the hue from it — see the rays below.
          litHit[0] = 1
          // …and A MARKER IS BORN WHERE EACH CORD LANDS, not before it (2026-09-07):
          // its clock starts when they arrive and ends as the rays set out, so
          // the mark is put there by the line reaching it rather than standing up
          // to meet it.
          const head = easeOutQuart(span(since(), T_RUN, AT_MARK))
          // …and THE CORDS RUN ON OUT OF THE MIDDLE (2026-09-07): the string you
          // pulled does not stop at its rest — three lines GROW out of the middle
          // where it landed, marching, one to each corner the circle's homecoming
          // cuts (it travels a radius along the angle, so the middle lands on the
          // dot opposite the number and each nock on the far crossing beside it).
          // They are ROOTED and GROWING, not thrown: what you pulled is already
          // part of what comes next, and it is quicker than the circle carrying
          // its points, so the drawing runs ahead of the shot rather than after
          // it. They stand until the six rays come, and go into them.
          const runOut = easeOutQuart(span(since(), 0, T_RUN))
          if (runOut > 0.002) {
            const sx = c.x - o.x
            const sy = c.y - o.y
            for (const to of [c, X[0], X[1]])
              stroke(ctx, partial([c, { x: to.x + sx, y: to.y + sy }], runOut), ink, GAME_W, GAME_A * FAINT * (1 - said) * a, HOVER_DASH, march)
            // …and THE MARKER stands where each one went in — no dot left over,
            // the stick IS the mark: the dial's own, rooted on the ring and
            // rising OUTWARD, square to it. It comes up as the tail arrives.
            // …and the second lap is already there under it (the press pulled
            // it in), so a marker is BORN tying the two: its foot on that ring's
            // dot, its head standing out past the horizon, and the face one.
            if (head > 0.002) {
              ctx.save()
              ctx.globalAlpha = a
              ctx.lineWidth = DOT_R * 2
              ctx.lineCap = "round"
              // …all six of them, the number's own included, so the corners are
              // one set of one kind and not five and an odd one.
              // THE MARKS THEMSELVES DO NOT LIGHT (2026-09-08): the colour is the
              // RAYS' — what the construction is doing — and a lit mark would
              // read as the drawing keeping a record it hasn't earned. THE
              // ANGLE'S OWN IS THE EXCEPTION: the angle line runs through it, so
              // it wears that line's colour, which is where the hue starts.
              // (Drawn one at a time for that one difference.)
              for (const k of [0, 2, 3, 4]) {
                const p0 = along(c, angle + k * 60, r - LAP_GAP * struckIn())
                // …out on the shot's own ease, drawn back in to its own length,
                // and standing OUTSIDE the ring until the second lap comes out
                // for an alignment and pulls it in to bridge the two
                const p1 = along(c, angle + k * 60, lerp(r + 2 * HU2 * head, r + LAP_GAP * (1 - struckIn()), mirror))
                ctx.strokeStyle = k === 0 ? hueAt(ink, angle, litAmt[0]) : ink
                ctx.beginPath()
                ctx.moveTo(p0.x, p0.y)
                ctx.lineTo(p1.x, p1.y)
                ctx.stroke()
              }
              ctx.restore()
              ctx.globalAlpha = 1
            }
          }
          // …and THEN ALL SIX CORNERS REACH FOR YOUR HAND: a line out of each,
          // its ants marching toward you. The drawing waits there.
          // …AND EVERY CORNER IS A MIRROR (2026-09-06). Bring the six lines
          // almost into line and each one, touching its dot, DEFLECTS toward the
          // next — and a mirror DOUBLES whatever you are off by, so the deflected
          // ray lands on that dot only when your hand is truly on the middle.
          // Which way it turns is which side of true you are on. Off by more
          // than a little there is no mirror at all, and when you are on it the
          // six deflections are the hexagon's own six edges, closed.
          const reach = easeOutQuart(span(since(), AT_MARK, AT_MARK + T_MARK))
          let lit = 0 // …how many of the six found their dot
          if (reach > 0.002 && grip) {
            // …WHO EACH RAY STRIKES, settled before a line of it is drawn: the
            // colour runs along this graph, and a ray has to know whether it is
            // lit before it can be put down.
            // …EVERY CORNER CARRIES AN INVISIBLE BALL: one grown from its dot
            // on the ring until it is flush with the lap inside it. It is only
            // how we KNOW the ray struck that corner — nothing bounces off its
            // surface. Strike one and the ray ENDS ON THE DOT, and the
            // deflection leaves from the same place: they meet at the mark.
            const hits = []
            for (let k = 0; k < 6; k++) {
              const p0 = along(c, angle + k * 60, rr)
              const dx = (grip.x - p0.x) / (dist(p0, grip) || 1)
              const dy = (grip.y - p0.y) / (dist(p0, grip) || 1)
              let best = null
              for (let j = 0; j < 6; j++) {
                if (j === k) continue // …a ray does not strike the ball it set off from
                const B = along(c, angle + j * 60, rr)
                const t2 = ballHit(p0, dx, dy, B, BALL)
                if (t2 != null && (!best || t2 < best.t)) best = { t: t2, B, j }
              }
              hits.push(best)
            }
            // THE COLOUR IS WHAT THE ANGLE REACHES (2026-09-08). The angle line
            // lights its own corner; a lit corner's ray carries the hue to the
            // corner it strikes, and the edge that deflects off there carries it
            // on to the next. Each hop takes only as much as its source already
            // has, so the colour RUNS round the drawing rather than switching
            // on — and off the middle the chain is broken and the rest of it
            // stands in plain ink. Aligned, every corner is reachable and the
            // whole construction is the angle's one colour: the hue IS how
            // aligned you are.
            const want = [1, 0, 0, 0, 0, 0]
            for (let k = 0; k < 6; k++) {
              if (!hits[k]) continue
              const src = k === 0 ? 1 : litAmt[k] // …a corner passes on only what it has
              const j = hits[k].j
              want[j] = Math.max(want[j], src)
              want[(j + 1) % 6] = Math.max(want[(j + 1) % 6], src * edgeAmt[j % 6]) // …the deflection carries it as far as it has grown
            }
            for (let k = 0; k < 6; k++) litHit[k] = Math.max(litHit[k], want[k])
            for (let k = 0; k < 6; k++) {
              const best = hits[k]
              const p0 = along(c, angle + k * 60, rr)
              const col = hueAt(ink, angle, litAmt[k]) // …the ray wears its own corner's share
              // ONE CONTINUOUS RAY: out of its corner, THROUGH your hand, and on
              // to the dot it struck — or clean off onto the ring if it struck
              // nothing. It does not stop where you are and it does not bend there.
              const tip = best ? best.B : onward(c, rr, p0, grip)
              stroke(ctx, partial(tip ? [p0, grip, tip] : [p0, grip], reach), col, HOME_W, HOME_A * a, HOVER_DASH, march)
              if (!best) continue
              // …and THE DOT DIRECTS IT, ALWAYS THE SAME WAY ROUND. A true
              // reflection off something this small could only reach the next dot
              // from one exact angle, never from the middle, so it would be
              // impossible to light them all: it is DIRECTED and only made to
              // look reflected. And the way round is GLOBAL, one for all six —
              // let each take the side it was struck on and half of them turn
              // back on the other half, which never closes and so never reads as
              // anything. So the only question a ray asks is whether it found its
              // dot at all: find the middle, all six find theirs, and the six
              // edges ARE the hexagon, closed.
              edgeHit[best.j % 6] = 1
              const grew = edgeAmt[best.j % 6]
              // …and it MARCHES with the ray that made it: same dash, same
              // offset, so the deflection reads as that line carrying on
              if (grew > 0.004)
                stroke(ctx, [best.B, lerp2(best.B, along(c, angle + (best.j + 1) * 60, rr), grew)], col, GAME_W, GAME_A * a * reach, HOVER_DASH, march)
              lit++
            }
          }
          // …and WITH ALL SIX the hexagon is closed and the middle breathes for
          // the click, the way it did when it was waiting to be struck: the same
          // sign, for the same thing — a click is wanted here.
          aligned = lit === 6
          if (aligned) clickPulse(ctx, c.x, c.y, REM * 0.75, REM * 1.6, ink, a, STROKE)
        }
      }
    }
    if (!struck) return
    const fade = 1 // the circles stay: they are the drawing, not its scaffolding
    const far = along(c, angle + 180, r)
    // ONE CIRCLE from here on — the number's own, picked up at the middle and
    // carried; it leaves nothing where it stood
    const at = lerp2(o, c, easeOutQuart(span(since(), 0, T_SHOOT))) // …and it is thrown into place ON THE RELEASE, with everything else
    // …and it PEELS off the ring it was on: each dot drags in from there and
    // gathers onto the lap, its tail catching up as it lands
    dotRing(ctx, at, struckR(r), ink, lerp(DOT_A, 1, lapLit()) * a * fade, struckIn(), lerp(r, struckR(r), struckIn() * struckIn()))
  }

  // The reading — the angle in figures, just OUTSIDE the horizon where the ray
  // crosses it (2026-09-04: it sat on the ring, over its dots — its circle now
  // clears them), so it's taken against the face. It stays there: the chrome
  // steps out of ITS way, not the other way round. (Only where the clock itself
  // runs off the screen does it pull in along the ray.) Its circle is an
  // affordance, not a decoration: it appears under the pointer, and stays
  // while the angle is held.
  const READ_GAP = 6 // between the reading's circle and the ring's dots
  const READ_FILL = 220 // …and how long the ink takes to fill it, once that shrink has ended
  // …and IN THE SNAP ZONE (2026-09-04) it slides in onto the angle's own dot,
  // which grows into the circle round it — OPAQUE, so the ring's dots under
  // it go. `snap` is that amount; `paper` the ground it hides them with.
  // `pulse` breathes the waiting ring on it — the centre's own (see draw), for
  // the click the snapped reading waits for.
  function reading(ctx, L, c, r, deg, ink, text, A = 1, shrink = 1, snap = 0, paper = "#000", pulse = 0, collapse = 0, fill = 0) {
    ctx.font = `600 ${REM}px system-ui, sans-serif`
    const w = Math.max(ctx.measureText(text).width, ctx.measureText("000").width)
    const tr = w / 2 + 6
    const out = Math.min(r + tr + READ_GAP, reach(L, c, deg, tr + 4))
    const on = Math.min(r, reach(L, c, deg, tr + 4)) // the dot's place
    const p = along(c, deg, lerp(out, on, snap))
    const q = along(c, deg, on)
    const box = { x: p.x - tr, y: p.y - tr, w: 2 * tr, h: 2 * tr }
    if (A <= 0.002 || shrink <= 0.002) return box

    // it goes out IN PLACE — shrinking about its own point, not sliding off
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.scale(shrink, shrink)
    // THE OUTLINE CLOSES OVER THE NUMBER (2026-09-05): nothing dissolves and
    // nothing is scaled but the circle — it simply shrinks about its point, at
    // one constant stroke weight, and ENGULFS the number, which stands at its
    // own size and is clipped to whatever still fits inside. Only at the BOTTOM
    // of that shrink — and ONLY once it has ended — does `fill` bring the ink
    // ground in and take the last of the number with it.
    const rad = lerp(lerp(DOT_R, tr, snap), DOT_R, collapse) // …down to the DIAL'S dot: it is one of the six corners, and they are all one size
    const eye = { x: (q.x - p.x) / shrink, y: (q.y - p.y) / shrink }
    const bottom = clamp01(fill)
    if (snap > 0.002) {
      // ONE CIRCLE, its radius the whole story: paper-filled with the number in
      // it, down to the game's own frontier dot, which is where it takes the ink
      ctx.beginPath()
      ctx.arc(eye.x, eye.y, rad, 0, Math.PI * 2)
      ctx.fillStyle = paper
      ctx.globalAlpha = A * (1 - bottom)
      ctx.fill()
      if (bottom > 0) {
        ctx.fillStyle = ink
        ctx.globalAlpha = A * bottom
        ctx.fill()
      }
      ctx.strokeStyle = ink
      ctx.globalAlpha = A
      ctx.lineWidth = STROKE / shrink
      ctx.stroke()
      clickPulse(ctx, eye.x, eye.y, tr, tr + REM * 0.85, ink, A * pulse, STROKE / shrink)
    }
    ctx.save()
    if (snap > 0.002) {
      ctx.beginPath()
      ctx.arc(eye.x, eye.y, rad, 0, Math.PI * 2)
      ctx.clip() // …the circle eats it as it closes
    }
    ctx.fillStyle = ink
    ctx.globalAlpha = A * (1 - bottom) // …and what is left of it holds, full, until that bottom
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(text, 0, 0)
    ctx.restore()
    ctx.restore()
    ctx.globalAlpha = 1
    return box
  }

  // `dress` lets a hosting screen hand in the hour's ink/surface pair (setup
  // runs at 00:00, where the readable layer has flipped) — else the theme's.
  // `dress.fade` multiplies into every alpha, so a host can re-run the whole
  // draw dimmed (the paper pass over the chrome does exactly that).
  function draw(ctx, L, dress = null) {
    lastL = L // …what the waiting pulse tests against between frames
    const ink = dress?.ink || theme("--text", "#eee")
    const paper = dress?.surface || theme("--surface", "#111")
    const A = dress?.fade ?? 1
    const c = originOf(L)
    const r = radiusOf(L)
    const rd = struckR(r) // …the radius THE DRAWING is at: aligning TIGHTENS it by the lap's own gap (see struckIn)
    const t = tileOf(L)
    // THE SNAP ZONE: reaching the ring (or the reading itself) the aim snaps
    // onto the angle's dot — eased in and out, and held at 1 with the angle
    const wasBox = readBox
    readBox = null
    const nowMs = performance.now()
    const dt = Math.min(50, snapAt ? nowMs - snapAt : 0)
    snapAt = nowMs
    // …a BAND about the ring, not everything beyond it: overshoot and it lets go
    const inZone = !!pointer && (hitBox(wasBox, pointer) || Math.abs(dist(c, pointer) - r) <= SNAP_TOL)
    const want = set || inZone ? 1 : 0
    snapAmt += (want - snapAmt) * (1 - Math.pow(0.001, dt / SNAP_MS))
    if (Math.abs(want - snapAmt) < 0.002) snapAmt = want
    // …and HOME: with the angle held, reaching the centre pulls the cursor
    // into it the same way, to confirm
    const wantHome = set && !struck && atHome(L) ? 1 : 0
    homeAmt += (wantHome - homeAmt) * (1 - Math.pow(0.001, dt / SNAP_MS))
    if (Math.abs(wantHome - homeAmt) < 0.002) homeAmt = wantHome
    // …and the finished tile, lighting under your hand
    const wantHot = readyNow() && atHome(L) ? 1 : 0
    hotAmt += (wantHot - hotAmt) * (1 - Math.pow(0.001, dt / SNAP_MS))
    if (Math.abs(wantHot - hotAmt) < 0.002) hotAmt = wantHot
    // …and THE READING CLOSING ON THE WALK HOME (2026-09-05): its outline
    // shrinks over its own number, engulfing it. It runs BETWEEN THE TWO SNAPS
    // — nothing while you are still in the ring's band, where the aim is held
    // on the angle's dot and the number stands whole — and it is held shut once
    // the world is struck. It follows the hand exactly, so with no hand on the
    // page it simply holds where it was.
    if (!set || !angle) shutAmt = 0
    else if (struck) shutAmt = 1
    else if (pointer)
      shutAmt = atHome(L) ? 1 : clamp01((rd - SNAP_TOL - dist(pointer, c)) / Math.max(1, rd - SNAP_TOL - t * 0.87))
    // …and only when that shrink has ENDED does the ink come in and fill it,
    // which is what makes it the angle's own dot
    // …and THE ALIGNMENT, eased, off what the last frame's rays managed — and
    // each struck corner's own edge, which GROWS along itself rather than being
    // switched on, and draws itself back in the same way when the ray leaves it
    const wantAlign = stage >= 1 || aligned ? 1 : 0 // …and the click KEEPS it: the alignment was confirmed there, not let go of
    alignAmt += (wantAlign - alignAmt) * (1 - Math.pow(0.001, dt / SNAP_MS))
    if (Math.abs(wantAlign - alignAmt) < 0.002) alignAmt = wantAlign
    // …and the press, let go of early, hands over the moment it HAS played out
    if (letGo && stage === 1 && stageDone()) {
      stage = letGo === 2 ? 2 : 0
      stageAt = performance.now() - (letGo === 2 ? 0 : DRAWN)
      letGo = 0
      api.requestRender()
    }
    for (let k = 0; k < 6; k++) {
      edgeAmt[k] += (edgeHit[k] - edgeAmt[k]) * (1 - Math.pow(0.001, dt / T_EDGE))
      if (Math.abs(edgeHit[k] - edgeAmt[k]) < 0.004) edgeAmt[k] = edgeHit[k]
      edgeHit[k] = 0 // …compass() says so again this frame or it is not so
      litAmt[k] += (litHit[k] - litAmt[k]) * (1 - Math.pow(0.001, dt / T_LIT))
      if (Math.abs(litHit[k] - litAmt[k]) < 0.004) litAmt[k] = litHit[k]
      litHit[k] = 0 // …same rule: the colour holds only while something lit still reaches it
    }
    // …EXCEPT THE ANGLE'S OWN, which is lit by the angle LINE and not by any ray
    // (2026-09-08): it keeps its colour once the shot is taken, through the
    // press and past it, whatever your hand does and whether the rays are still
    // being drawn at all.
    if (struck) {
      litHit[0] = 1
    }
    aligned = false
    const wantFill = shutAmt > 0.999 ? 1 : 0
    fillAmt += (wantFill - fillAmt) * (1 - Math.pow(0.001, dt / READ_FILL))
    if (Math.abs(wantFill - fillAmt) < 0.002) fillAmt = wantFill

    // THE SEGMENT — the clock's ring drawn only as far as it has been swept:
    // 00:00 round to the reading, and nothing beyond. The angle isn't only a
    // bearing, it's how far round the face you've come, and until you've come
    // any distance there's nothing to show. Dashed and at the tile's own weight
    // — it belongs with the ray, not over it. (Canvas arcs run from 3 o'clock;
    // the dial starts at 12.)
    const e = since()
    const swept = angle
    if (segment && swept > 0.01) {
      ctx.beginPath()
      ctx.arc(c.x, c.y, r, -Math.PI / 2, (swept - 90) * (Math.PI / 180))
      ctx.strokeStyle = ink
      ctx.globalAlpha = TILE_ALPHA * A // the same weight as the ray and the tile
      ctx.lineWidth = STROKE
      ctx.setLineDash(DASH)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1
    }

    // THE LOOSE EMPTIES THE MIDDLE (2026-09-08): the dot goes out over the
    // loose's own beat, as the cords run out of the middle to the corners. What
    // is left inside the circle is your hand and the rays crossing it.
    const middle = centreDot ? A * (1 - fireAmt()) : 0
    if (middle > 0.002) {
      ctx.beginPath()
      ctx.arc(c.x, c.y, REM / 2, 0, Math.PI * 2)
      ctx.fillStyle = ink
      ctx.globalAlpha = middle
      ctx.fill()
      ctx.globalAlpha = 1
    }
    // THE WAITING PULSE (2026-08-28): once the compass SNAPS home with an angle
    // held, a ring breathes on the middle — no wider than the reading's own
    // circle, so it reads as that same affordance: the click it waits for.
    // Only once the number is HELD (`set`) — on the way back, not on the way
    // out: before you've picked, the middle isn't waiting for anything.
    // Outside the centreDot block on purpose — the confirm screen draws its own
    // middle (centreDot: false), which is why this never showed at first.
    if (set && !struck && atHome(L)) clickPulse(ctx, c.x, c.y, REM * 0.75, REM * 1.6, ink, A, STROKE)

    // THE COMPASS — drawn before anything else it might sit under, and from the
    // very first move: opening it IS going out.
    compass(ctx, L, c, r, ink, A)

    if (!angle) return

    const P = along(c, angle, rd) // the number's own point on the horizon

    if (!set) {
      // AIMING — the world's hover preview: dashed, out to the cursor, with the
      // arrowhead at the tip where you're pointing. IN THE SNAP ZONE the line
      // snaps onto the angle's dot, its dashes march and the arrowhead goes.
      const s = snapAmt
      const hand = pointer || P
      const tip = { x: lerp(hand.x, P.x, s), y: lerp(hand.y, P.y, s) }
      // the same dash at rest and marching — only the offset moves
      const period = HOVER_DASH[0] + HOVER_DASH[1]
      stroke(ctx, [c, tip], ink, HOME_W, AIM_A * A, HOVER_DASH, -((nowMs / ANTS_MS) % period) * s)
      if (s < 0.998 && dist(c, tip) > t * 0.6) {
        ctx.globalAlpha = AIM_A * A * (1 - s)
        arrowTip(ctx, c.x, c.y, tip.x, tip.y, ink, t * 0.32, t * 0.2, HOME_W)
        ctx.globalAlpha = 1
      }
    } else {
      // THE ANGLE'S LINE STAYS: the leg and its ray are what the whole ceremony
      // is about, and they hold for all of it.
      const W = A
      const f = fireAmt() // …the loose's flare (0 until the click at the middle fires: see fireAmt)
      const fired = !!struck
      // THE SEED RAY, running on past the number and off the edge of the world
      // — the angle doesn't stop where you stopped walking. Struck, its DASHES
      // CLOSE UP (the gap eased to nothing) so it becomes one stroke with the
      // leg: the game's own angle line, drawn from the middle clean off the edge.
      const far = along(c, angle, reach(L, c, angle))
      const shut = f > 0.995
      const march = -((nowMs / ANTS_MS) % (HOVER_DASH[0] + HOVER_DASH[1]))
      // THE ARROW IS LOOSED (2026-09-05): the aim's own marching line doesn't
      // stay where it was — BOTH ITS ENDS TRAVEL OUTWARD. Its tail leaves the
      // middle for the number while its head runs on past it and clean off the
      // edge of the world, which is one segment shooting out of the viewport
      // and, at rest, the angle's own seed ray. Struck, its DASHES CLOSE UP so
      // it becomes one stroke with the leg: the game's own angle line.
      const s1 = easeOutQuart(shotIn())
      const coming = homing() // …and once the shape comes home it is drawn whole, not in parts
      // …and IT TAKES THE ANGLE'S OWN COLOUR ON THE SHOT (2026-09-08): the line
      // is the first lit thing, and the corner it runs through is where the hue
      // starts travelling from (see compass's rays).
      stroke(
        ctx,
        [lerp2(c, P, s1), lerp2(P, far, s1)],
        fired ? hueAt(ink, angle, f) : ink,
        fired ? GAME_W : STROKE,
        (fired ? GAME_A : RAY_A) * W,
        shut ? null : [lerp(HOVER_DASH[0], 40, clamp01(f * 3)), lerp(HOVER_DASH[1], 0, clamp01(f * 3))],
        s1 < 0.999 ? march : 0 // …it marches while it is FLYING OUT, and not after: a landed line is drawing
      )
      // …and THE INNER HALF IS NOT DRAWN WHILE YOU ALIGN (2026-09-08): the arrow
      // leaves the middle and nothing takes its place, so the inside of the
      // circle is left to your hand and the rays crossing it. THE RELEASE PUTS
      // IT BACK (2026-09-08): from there on the angle line is WHOLE — middle to
      // off the edge of the world, all of it in the angle's own hue — and it is
      // what the shape breaks off and turns away from.
      if (stage >= 2) stroke(ctx, [c, P], hueAt(ink, angle, f), GAME_W, GAME_A * W)
      // THE ARROW — see above. Drawn while you aim it and on through the loose,
      // over the construction and under the shape that comes home.
      arrow(ctx, c, P, far, rd, t, ink, W)
      // THE SHAPE COMES HOME — one hexagon now, six edges and six spokes,
      // let go from where the click struck it and drawn through to the tile,
      // then turning to a pointy top; its six corner markers go with it, only as
      // far as the tiles beside you, and stand there
      if (coming) {
        // the hexagon: THE PRESS DETACHES IT (2026-09-07) — it lets go of the ring
        // its corners were held on and pulls in by the laps' own gap, the one
        // distance the dial has, and stands there for as long as you hold. The
        // release drives it home from there, at full speed, and only once it is
        // at the tile does it turn.
        const off = lerp(rd, rd - LAP_GAP, easeOutQuart(span(e, AT_HOME, AT_HOME + T_TRIG)))
        const draws = runAt() // …the shape's own draw down onto the tile
        const hr = lerp(off, t, draws)
        // …and IT TURNS AS IT COMES IN, on the same curve: out of the wind-up and
        // round to a pointy top, one movement carrying both
        const wind = windDeg()
        const rot = wind + (hexTurn() - wind) * draws
        const a = GAME_A * W
        // ITS COLOUR SITS UNDER EVERYTHING (2026-09-05): once the drawing is
        // done the tile answers a hover with the angle's own hue — the one the
        // world paints the home centre with — and every line is drawn over it
        if (hotAmt > 0.002) {
          hexPath(ctx, c, hr, angle + rot)
          ctx.fillStyle = `hsl(${angle} 70% 55%)`
          ctx.globalAlpha = hotAmt * W
          ctx.fill()
          ctx.globalAlpha = 1
        }
        // ONE PATH FOR THE WHOLE SHAPE — the closed hexagon and its six spokes
        // together, stroked ONCE (2026-09-07). Drawn as seven strokes they each
        // composite separately, and where they meet — the six at the middle, every
        // spoke against its own corner — the drawing's own fade doubled up and the
        // joins showed. One stroke lays the whole figure down and the fade is
        // applied to it whole, which is how the game draws a hex. (Round joins for
        // the corners, and the spokes BUTTED so the shape does not wear dots on
        // its points; a closed path has no caps, so the two do not collide.)
        const lineInk = toBlack(ink, hotAmt) // …the tile INVERTS under your hand: its lines go black on its hue
        // THE PRESS TAKES THE SHAPE TO DASHES AND FILLS THEM IN (2026-09-08).
        // Held, the figure goes to a STILL dash — the construction's own dash,
        // not marching, because nothing is travelling any more — and then a
        // solid line in the angle's colour runs out of THE ANGLE'S OWN CORNER
        // and round the six the way the rays reflected, sending itself down
        // each spoke as it leaves the corner it reached. It is the MARKERS' own
        // width, not the hairline: what the dashes were promising, made good.
        // The front moves at one pace, straight off the press's window and not
        // eased, the way a thing running along a line does.
        const fillIn = span(e, AT_HOME, AT_HOME + T_TRIG)
        // …and THE SHAPE IS DRAWN AS A FUNCTION OF THE ANGLE IT IS AT (2026-09-08),
        // so the break can be drawn as the shape AT THE ANGLES IT HAS JUST COME
        // THROUGH. A blur has no direction — it makes a thing fuzzy, and a fast
        // thing is not fuzzy, it is STREAKED ALONG ITS PATH. The movement is a
        // pure turn about the middle, so every ghost is exact: the same path at a
        // different angle, nothing approximated.
        const figure = (rotDeg, mul) => {
        ctx.save()
        ctx.strokeStyle = lineInk
        ctx.globalAlpha = lerp(a, 1, hotAmt) * mul
        ctx.lineWidth = GAME_W
        ctx.lineJoin = "round"
        ctx.lineCap = "butt"
        if (fillIn > 0.002) ctx.setLineDash(HOVER_DASH)
        hexPath(ctx, c, hr, angle + rotDeg)
        for (let k = 0; k < 6; k++) {
          const p = along(c, angle + rotDeg + k * 60, hr)
          ctx.moveTo(c.x, c.y)
          ctx.lineTo(p.x, p.y)
        }
        ctx.stroke()
        ctx.setLineDash([])
        // …and THE SOLID OVER IT. While the press is still running that is the
        // fill travelling round (see above); once it is through, it is simply the
        // whole figure — the hexagon and its six spokes, one path, at the
        // markers' width and full strength.
        if (fillIn > 0.999) {
          ctx.strokeStyle = hueAt(ink, angle, 1)
          ctx.globalAlpha = W * mul
          ctx.lineWidth = DOT_R * 2
          hexPath(ctx, c, hr, angle + rotDeg)
          for (let k = 0; k < 6; k++) {
            const p = along(c, angle + rotDeg + k * 60, hr)
            ctx.moveTo(c.x, c.y)
            ctx.lineTo(p.x, p.y)
          }
          ctx.stroke()
        } else if (fillIn > 0.002) {
          // …ONE PATH for the fill as well, for the same reason the shape is one
          // (see above): the six edges it has reached and the spokes off them,
          // laid down together and composited once.
          const corner = k => along(c, angle + rotDeg + k * 60, hr)
          // …and IT GOES BY WAY OF THE MIDDLE (2026-09-08). Out of the angle's own
          // corner it runs two ways at one speed: round the six, and STRAIGHT
          // DOWN ITS OWN SPOKE — and reaching the middle it goes the other five
          // ways AT ONCE, out of the centre rather than in from each corner. Six
          // spokes each creeping inward off their own corner on their own beat
          // read as six colours popping on, which is no travel at all; one line
          // arriving at the middle and bursting out of it is one movement, and
          // the spokes are done inside the first third of the press.
          const D = fillIn * 6 * hr // …how far it has run, at the perimeter's own pace
          const run = partial([0, 1, 2, 3, 4, 5, 0].map(corner), fillIn)
          const inward = clamp01(D / hr) // …the angle's own spoke, corner to middle
          const outward = clamp01((D - hr) / hr) // …and the other five, middle to corner
          ctx.strokeStyle = hueAt(ink, angle, 1)
          // …AT FULL STRENGTH, said outright (2026-09-08): without it the fill
          // inherits the dashed pass's own GAME_A and the whole construction —
          // and every ghost of it in the break's smear — comes up 40% dim.
          ctx.globalAlpha = W * mul
          ctx.lineWidth = DOT_R * 2
          ctx.beginPath()
          for (let i = 0; i < run.length; i++) (i ? ctx.lineTo(run[i].x, run[i].y) : ctx.moveTo(run[i].x, run[i].y))
          if (inward > 0.002) {
            const q0 = corner(0)
            const q1 = lerp2(q0, c, inward)
            ctx.moveTo(q0.x, q0.y)
            ctx.lineTo(q1.x, q1.y)
          }
          if (outward > 0.002)
            for (let k = 1; k < 6; k++) {
              const q = lerp2(c, corner(k), outward)
              ctx.moveTo(c.x, c.y)
              ctx.lineTo(q.x, q.y)
            }
          ctx.stroke()
        }
        ctx.restore()
        ctx.globalAlpha = 1
        }
        // …the TRAIL first, oldest and faintest at the back, so the shape lands on
        // top of it: copies of it reaching back along the arc, each at its share
        // of the ink. A blur has no DIRECTION — it makes a thing fuzzy, and a fast
        // thing is not fuzzy, it is STREAKED ALONG ITS PATH — and the movement is
        // a pure turn about the middle, so every ghost is exact: the same path at
        // a different angle, nothing approximated. The whole of it lives and dies
        // inside the break's own window, opening, peaking and DISSOLVING before
        // the break is over, so nothing trails on into a recoil the movement had
        // not earned. A hair of blur only takes the stepping off it.
        const rise = span(e, AT_SPIN, AT_SPIN + SMEAR_MS * 0.45)
        const falls = span(e, AT_SPIN + SMEAR_MS * 0.45, AT_SPIN + SMEAR_MS)
        const smear = SMEAR_DEG * smooth(rise) * (1 - easeOutQuart(falls))
        if (smear > 0.05) {
          const backward = hexTurn() >= 0 ? 1 : -1 // …behind the movement the break makes
          ctx.filter = "blur(2px)"
          for (let g = GHOSTS - 1; g >= 1; g--) {
            const f2 = g / (GHOSTS - 1)
            figure(rot + backward * smear * f2, (1 - f2) * 0.55)
          }
          ctx.filter = "none"
        }
        // …and THE TILE SWALLOWS IT (2026-09-09): landed, the shape has nothing
        // left to say — its lines are under the tile's own ground and all that
        // stands clear of the edge is the outer half of its stroke, which reads
        // as a second hexagon behind the tile. It is not drawn from there on.
        if (draws < 1) figure(rot, 1)
        // THE TILE GROWS OUT OF THE MIDDLE (2026-09-08) — its OWN thing, not what
        // the construction turns into: the ground in the angle's colour, the
        // ring, the radials, and last of all the seat's bold Y. WHOLE from its
        // first frame, just small — and its weights are the cube grammar's own
        // read at whatever size it currently is (W = r/10), so it is a true tile
        // at every moment of the growing rather than a big one drawn small. It
        // holds back against the closing edge (FILL_LAG) so the two arrive
        // together instead of the hue outrunning the shape. NOBODY IS IN IT —
        // no player, no figure: what the ceremony makes is the PLACE, not who
        // stands in it.
        const tr = hr * draws ** FILL_LAG
        if (tr > 0.6) {
          const tW = Math.max(1.5, tr * 0.1)
          ctx.save()
          hexPath(ctx, c, tr, angle + rot)
          ctx.fillStyle = `hsl(${angle} 70% 55%)`
          ctx.globalAlpha = W
          ctx.fill()
          ctx.strokeStyle = "#000"
          ctx.lineJoin = "round"
          ctx.lineWidth = 0.5 // …the ring: a hairline, the tile's own
          hexPath(ctx, c, tr, angle + rot)
          ctx.stroke()
          ctx.lineWidth = tW * 0.2 // …the radials, edge in to the middle
          ctx.lineCap = "butt"
          ctx.beginPath()
          for (let k = 0; k < 6; k++) {
            const q = along(c, angle + rot + k * 60, tr)
            ctx.moveTo(c.x, c.y)
            ctx.lineTo(q.x, q.y)
          }
          ctx.stroke()
          // …and THE SEAT'S STUB LAST OF ALL, out of the middle only once the
          // shape has come down onto the tile, with a hair of overshoot (BACK_C)
          // onto its place. IT IS THE FLOOR'S OWN Y (2026-09-09) — the seat,
          // inverted from the token that stands in it (render.js: boldY, true),
          // so the sleeper's three arms fall between these rather than onto
          // them. Stated outright, not taken off the hexagon's corners: those
          // ride the angle, and every other struck angle flipped it.
          const yg = BACK_OUT(span(e, AT_SPIN + AT_Y, AT_SPIN + T_TURN))
          if (yg > 0.002) {
            ctx.lineWidth = tW
            ctx.lineCap = "round"
            ctx.beginPath()
            for (const deg of [0, 120, 240]) {
              const q = along(c, deg, (tr / 3) * yg)
              ctx.moveTo(c.x, c.y)
              ctx.lineTo(q.x, q.y)
            }
            ctx.stroke()
          }
          ctx.restore()
          ctx.globalAlpha = 1
        }
        // THE SLEEPER (2026-09-09): the tile settled and STOOD EMPTY a beat,
        // someone is in it — the game's own token, hollow, BREATHING: it comes
        // up out of nothing to full black and goes back into nothing, one slow
        // breath, over and over. Nothing of it arrives while the tile is still
        // being drawn, and nothing of it rests: what waits there is the breath.
        // …and THE CLICK IS THE WAKING: over T_OPEN the line hardens to the
        // tile's black at the player's own weight and the paper opens outward
        // from the middle under it — the morning's own two beats (render.js: the
        // night hardens the outline, the turn fills the body), played on one
        // token by three amounts. The world is struck as it lands whole (openMs).
        const slept = settled() - T_WAIT
        if (slept > 0) {
          const breath = 0.5 - 0.5 * Math.cos((slept / T_BREATH) * Math.PI * 2) // …from its trough, so it opens on an inhale
          const wu = wakeIn()
          const hard = easeOutQuart(wu) // …the outline first, straight off the click
          const filled = wu < 0.5 ? 8 * wu ** 4 : 1 - Math.pow(-2 * wu + 2, 4) / 2 // …and the body across the whole of it
          drawPlayer(ctx, c.x, c.y, tr * PLAYER_R, "#000", "#fff", lerp(1.5, playerWeight(tr), hard), filled, lerp(breath, 1, hard))
          ctx.globalAlpha = 1
        }
        // THE PRESS (2026-09-07): the markers were bridging the two laps and
        // holding the shape on the ring. Pressing GROWS EVERY DOT OUTWARD off it
        // — the whole face of them, the six corners rising off the lap to stand
        // highest of all, at the END MARKER'S own height — and then the ring's
        // own RISE, carried out until their heads are level with the corners'.
        // It holds there, and letting go is what frees the shape.
        const HU3 = huOf(L)
        const trig = easeOutQuart(span(e, AT_HOME, AT_HOME + T_TRIG))
        const drag = easeOutQuart(span(e, AT_HOME + T_DRAG, AT_HOME + T_TRIG))
        // …and then IT ALL GOES INWARD TOGETHER, in one move and at one instant:
        // the ring's own dots down through the ring onto the second lap, where
        // they stand at its second height, LIT AND STAYING LIT — this lap is the
        // drawing now, not the dial at rest.
        const down = blast(span(e, AT_PUNCH, AT_PUNCH + T_DOWN)) // …after the turn, not with it
        // …and AS THE SHAPE COMES IN THE MARKERS STAND DOWN (2026-09-08), in
        // three: they come back onto RING 1, then SHRINK to the dial's own dot —
        // both at FULL BRIGHTNESS, so what you read is the movement and not a
        // dimming — and only then do they GO. The ring's own dots are not touched
        // by any of it: they sit at their rest the whole way through, and what is
        // left when the markers have gone is them.
        const toRing = easeOutQuart(span(e, AT_SPIN, AT_SPIN + T_TURN * 0.45))
        const stand = easeOutQuart(span(e, AT_SPIN + T_TURN * 0.45, AT_SPIN + T_TURN * 0.78))
        const fade = span(e, AT_SPIN + T_TURN * 0.78, AT_SPIN + T_TURN)
        // …where a marker's head stands through all that: out at the press's own
        // height, down onto the ring, and then down to the ring's own dot. Out
        // HERE and not in the face's block, because the six corners take it too
        // and that block cannot be seen from the corner loop.
        const stood = lerp(lerp(lerp(r, r + PIN_H * HU3, trig), r + DOT_H * HU3, toRing), r, stand)
        ctx.save()
        ctx.strokeStyle = ink
        ctx.lineWidth = DOT_R * 2
        ctx.lineCap = "round"
        if (trig > 0.002) {
          // …and THEY SHRINK BACK TO DOTS as the corners gather (2026-09-07) — but
          // OUTWARD, their feet drawn up to the lap they stand on, the opposite
          // way to the corners coming in — and they go grey with it: the face has
          // said what it had to say and hands itself back to the dial at rest.
          const back = easeOutQuart(span(e, AT_COPY, AT_GATHERED))
          const foot = lerp(lerp(lerp(lerp(r, r + (PIN_H - DOT_H) * HU3, drag), r, toRing), rd - 2 * HU3, down), rd, back)
          const head = lerp(stood, rd, down)
          // …and THE WHOLE FACE TAKES ITS HUES ON THE WAY DOWN (2026-09-07): every
          // few degrees wears the colour the world paints THAT bearing with, so
          // the clock reads as the wheel of angles it has been all along — and it
          // comes in over the descent itself, like the six take theirs over their
          // run, so the dots land on the lap already coloured. Drawn in ARCS OF ONE
          // COLOUR — 120 round the ring, six sticks each — rather than by a conic
          // gradient, which not every browser has, and which would have left the
          // face grey wherever it is missing.
          const faceHue = easeOutQuart(span(e, AT_PUNCH, AT_PUNCH + T_DOWN))
          // …and GO OUT ENTIRELY as they land (2026-09-07): the lap's own 720 dots
          // are already standing on that ring at the dial's rest, so a marker
          // shrunk onto it is a second dot in the same place — two at 0.4 read as
          // one at 0.64, and the lap came out brighter than the dial anywhere
          // else. They fade into the ones they became.
          ctx.globalAlpha = lerp(DOT_A, 1, trig) * (1 - fade) * (1 - back) * W
          for (let g = 0; g < HUE_ARCS; g++) {
            ctx.strokeStyle = hueAt(ink, ((g + 0.5) / HUE_ARCS) * 360, faceHue * (1 - back))
            ctx.beginPath()
            for (let k = g * (720 / HUE_ARCS); k < (g + 1) * (720 / HUE_ARCS); k++) {
              if (corner(k)) continue // …the six are their own mark, not one of these
              const p0 = along(c, k / 2, foot)
              const p1 = along(c, k / 2, head)
              ctx.moveTo(p0.x, p0.y)
              ctx.lineTo(p1.x, p1.y)
            }
            ctx.stroke()
          }
        }
        // …and THE SIX CORNERS with them, all the way out to the tiles beside
        // you: each GROWS inward — its tip running to the mark while its far end
        // stands where the press left it — and only once it is there does that
        // end come after and SHRINK it onto the dot. One piece per corner: the
        // marker IS that dot, and it stays.
        // …and THE TIPS RIDE THE HEXAGON'S OWN DRIVE (2026-09-07): the same curve
        // over the same window, so they arrive with it rather than running on
        // ahead. THE TAILS COME AS THE SECOND HEX IS SHED (2026-09-07) — the
        // stack coming off the shape is what gathers them.
        const cIn = punchIn()
        const cOut = easeOutQuart(span(e, AT_COPY, AT_GATHERED))
        // …and THE MARKS DO NOT TURN AT ALL (2026-09-08): the only thing that
        // rotates is the hexagon. All six stand where the construction cut them
        // and the shape turns AWAY from them, out of the angle's orientation —
        // so what is left standing on the ring is the record of where its
        // corners were. (The parked version turned them a half step further
        // round than the shape, onto the tiles beside you: that is what
        // `markTurn` is for, and nothing calls it while this version is the one
        // playing.)
        const mrot = 0
        // …and ONCE GATHERED, EACH POPS (2026-09-07): all the way in it is the
        // dial's own stick at the dial's own width, and only when the tail has
        // arrived — a stick shrunk to its two caps, which IS the ring's dot —
        // does that dot swell to the game's own FRONTIER mark and go PAPER WHITE,
        // brighter than the drawing it came out of. It holds that through the
        // whole turn and only settles to the discovery's own shade once the shape
        // has finished turning: the pop used to land exactly as the turn began and
        // was greyed off by it before it could read.
        const pop = easeOutQuart(span(e, AT_GATHERED - T_POP, AT_GATHERED)) // …the swell, as they gather
        // …and THE TURN OVER, THEY GO (2026-09-07): the six fade out where they
        // stand as THE DIAL'S OWN END MARKER rises at minute 0 in their place.
        // The drawing hands over to the clock: what is left on the face is the
        // day's own mark and nothing of the ceremony.
        const gone = easeOutQuart(span(e, DONE, DONE + T_SETTLE))
        ctx.lineWidth = DOT_R * 2 // (the five swell to the frontier mark as they gather — see below)
        // (the five go with it; the day's own mark stays)
        // …and THEY TAKE THEIR COLOUR ON THE WAY IN (2026-09-07): each carries the
        // hue of THE BEARING IT WAS CUT AT — so the one on the angle's own corner
        // wears the angle's colour, the same its line wears — and it comes in over
        // the run itself, so by the time they settle on the mark they are it. The
        // colour belongs to the corner, and it travels with it.
        const mHue = easeOutQuart(span(e, AT_THROW, AT_PUNCH + T_PUNCH)) // …coloured by the time they stop growing
        const away = smooth(span(e, AT_PUNCH + T_PUNCH * LEAVE, AT_TOUCH))
        // …and THE FIVE ARRIVE WHITE: the colour is what they travel in, and it
        // goes as they gather, so what lands on each mark is a white dot.
        // THE ANGLE'S OWN IS THE EXCEPTION (2026-09-07): it does not gather and it
        // does not go white — it runs on past the mark, at the pace the drive had,
        // INTO THE MIDDLE, and stands there at its full length in the angle's own
        // colour. Which makes it that angle's leg, drawn by the mark cut on it.
        // IN LINE WITH THEM, THEN AWAY (2026-09-07): it comes in at exactly the
        // radius the other five are at — level with them, and clear of the shape —
        // and only near the end does it PULL AWAY, carrying on to THE HEXAGON'S
        // OWN CORNER a moment after they have stopped on the mark. The leaving is
        // a smoothstep off their line onto THE HEXAGON'S OWN CORNER RADIUS — it
        // does not run a curve of its own, it takes the shape's, so it picks up
        // the speed the shape is going and eases out with it, in sync, and then
        // simply rides the corner it has caught. (Sent straight at the hex's
        // corner it simply rode the shape's edge from the first frame, which read
        // as the two being stuck together.)
        for (let k = 0; k < 6; k++) {
          const own = k === 0 // …the angle's own corner
          const deg = angle + mrot + k * 60 // …all six stand still; only the shape turns
          const pack = lerp(lerp(rd, r, trig), NEIGHBOUR * t, cIn) // …where the five are
          // …and THE ANGLE'S OWN DOES NOT LIFT WITH THEM (2026-09-08): the press
          // takes the other five outward off the ring, but this one HOLDS ON THE
          // HEXAGON — it goes in with the shape as that detaches and pulls in by
          // the lap's own gap, keeping the span it had. It is the corner the
          // press's fill runs out of, and it has to be touching to run.
          const ownPack = lerp(lerp(rd, rd - LAP_GAP, trig), NEIGHBOUR * t, cIn)
          // …and its head reaches the end marker's height on THE DRIVE rather
          // than the press, so the press does nothing to this one but walk it in
          const ownHead = lerp(lerp(r, rd, trig), r + PIN_H * HU3, cIn)
          // …and IT BECOMES THE DAY'S OWN MARK (2026-09-07): turning with the shape
          // it comes round to twelve o'clock, and as it turns it goes WHITE and
          // is already white and already the END MARKER'S own span — the colour
          // goes with the retreat, so what turns is a finished mark: foot on the
          // horizon, head standing OUTWARD off it at the pin's own height, where
          // the press left it. The mark that was cut on the
          // angle is the mark the clock keeps; nothing new is put there.
          // …and it DRAWS IN FIRST and the turn waits for it: this beat opens with
          // the mark coming off the hexagon's corner back to the horizon, and only
          // when it is that short stick does the shape start to turn
          const drawn = easeOutQuart(span(e, AT_TURN, AT_TURN + T_DRAWIN)) // …quick across, easing onto its place; then it holds
          const p0 = along(c, deg, own ? lerp(lerp(ownPack, hr, away), r, drawn) : pack)
          const p1 = along(c, deg, own ? stood : lerp(stood, NEIGHBOUR * t, cOut))
          // …and THE ANGLE'S OWN HAS IT ALREADY (2026-09-08): the angle line lit it
          // at the loose and it does not give it back, so it stands coloured
          // through the press while the other five are still plain ink.
          ctx.strokeStyle = own ? toWhite(hueAt(ink, angle, Math.max(mHue, litAmt[0])), drawn) : toWhite(hueAt(ink, angle + k * 60, mHue), cOut)
          ctx.lineWidth = own ? DOT_R * 2 : lerp(DOT_R, FRONTIER_DOT, pop) * 2
          ctx.globalAlpha = (1 - fade) * (own ? 1 : 1 - gone) * W
          ctx.beginPath()
          ctx.moveTo(p0.x, p0.y)
          ctx.lineTo(p1.x, p1.y)
          ctx.stroke()
        }
        // …and THE SIXTH DISCOVERY DOT (2026-09-07): five corners came out to the
        // tiles beside you and the sixth went to the clock instead, which left one
        // neighbour unmarked. It is put there on the same beat the five pop, at
        // the same size and shade — six tiles, six marks; what the angle's corner
        // became is a separate matter.
        if (pop > 0.002) {
          const d6 = along(c, angle + mrot, NEIGHBOUR * t)
          ctx.lineWidth = lerp(DOT_R, FRONTIER_DOT, pop) * 2
          ctx.globalAlpha = (1 - gone) * W
          ctx.strokeStyle = toWhite(ink, 1)
          ctx.beginPath()
          ctx.moveTo(d6.x, d6.y)
          ctx.lineTo(d6.x, d6.y)
          ctx.stroke()
        }
        ctx.restore()
        // …and THE STACK COMES OFF IT: at the drive's first stop the two are
        // one; the hexagon springs back on its wobble and leaves a hex behind,
        // and the same swing sheds another right after — the shape you will
        // stand there as, and a figure's inside it. Under your hand the player's
        // takes a WHITE ground of its own and wears the wake mark, so the way in
        // reads against the tile's colour.
        const pr = copyR(t, AT_COPY, PLAYER_R)
        // …and THE SECOND HEX PAINTS THE FIRST AS IT GOES (2026-09-07): the band it
        // leaves behind it — between the shape and itself, the first hex's own
        // inner ring — takes the angle's colour, so the shape is coloured from its
        // edge inward by the hex coming off it. It is shed as the angle's mark
        // reaches the middle: the colour arrives and the stack starts in one beat.
        if (pr > 0.5 && pr < hr - 0.5) {
          // ONE PATH, TWO RINGS: the tile's own hexagon and the copy inside it, so
          // even-odd leaves the BAND between them — the back tile's ground, the
          // way the world paints a home centre. (hexPath begins its own path, so
          // the inner ring is appended by hand or it would wipe the outer one and
          // fill the copy instead of the band.)
          hexPath(ctx, c, hr, angle + rot)
          for (let k = 0; k < 6; k++) {
            const q = along(c, angle + rot + k * 60, pr)
            if (k) ctx.lineTo(q.x, q.y)
            else ctx.moveTo(q.x, q.y)
          }
          ctx.closePath()
          ctx.fillStyle = hueAt(ink, angle, 1)
          ctx.globalAlpha = W
          ctx.fill("evenodd")
          ctx.globalAlpha = 1
        }
        // …and THE SECOND COMES OUT OF THE FIRST (2026-09-07), not out of the
        // shape: it is shed at whatever radius the player's hex has reached by
        // then, so the stack is drawn one out of the next rather than two off the
        // same swing at the same size.
        const fr = copyR(t, AT_FIG, FIGURE_R, lerp(t, t * PLAYER_R, easeOutQuart(span(AT_FIG, AT_COPY, AT_STACK))))
        if (pr > 0.5) {
          // …and WHAT IS BEING DRAWN IS THE HOME TILE ITSELF (2026-09-07): the
          // ground in the angle's colour, black lines over it, and the tile's own
          // FURNITURE — the hairline ring and the thin radials running in from the
          // edge — the way the world draws a rest spot. Then THE PLAYER: not a hex
          // standing in for it but the game's own token (drawPlayer), at the same
          // radius, weight and colours the world gives it.
          const seatW = Math.max(1.5, t * 0.1) // …the player's own weight (render.js playerWeight)
          ctx.strokeStyle = "#000"
          ctx.globalAlpha = W
          ctx.lineJoin = "round"
          hexPath(ctx, c, hr, angle + rot) // the hairline ring, the tile's own
          ctx.lineWidth = 0.5
          ctx.stroke()
          ctx.lineWidth = seatW * 0.2 // …and the seat's radials, edge in to what sits in it
          ctx.lineCap = "butt"
          ctx.beginPath()
          for (let k = 0; k < 6; k++) {
            const a0 = along(c, angle + rot + k * 60, hr)
            const a1 = along(c, angle + rot + k * 60, pr)
            ctx.moveTo(a0.x, a0.y)
            ctx.lineTo(a1.x, a1.y)
          }
          ctx.stroke()
          // …and IT STANDS AT THE SHAPE'S OWN BEARING (2026-09-07): the token is
          // drawn peak-up, and the tile it is standing on is not — north here is
          // the angle, so it is turned with the hexagon that carries it.
          ctx.save()
          ctx.translate(c.x, c.y)
          ctx.rotate(((angle + rot) * Math.PI) / 180)
          drawPlayer(ctx, 0, 0, pr, "#000", "#fff", seatW)
          ctx.restore()
          if (fr > 0.5) {
            ctx.strokeStyle = "#000"
            ctx.lineWidth = seatW * 0.2 // …the radials on in to the figure
            ctx.beginPath()
            for (let k = 0; k < 6; k++) {
              const b0 = along(c, angle + rot + k * 60, pr)
              const b1 = along(c, angle + rot + k * 60, fr)
              ctx.moveTo(b0.x, b0.y)
              ctx.lineTo(b1.x, b1.y)
            }
            ctx.stroke()
            hexPath(ctx, c, fr, angle + rot) // …and the figure's own bold hex
            ctx.fillStyle = "#fff"
            ctx.fill()
            ctx.strokeStyle = "#000"
            ctx.lineWidth = seatW
            ctx.stroke()
          }
          ctx.globalAlpha = 1
          // …and the mark fills the player's hex — the button IS the shape, not a badge in it
          if (hotAmt > 0.002) drawIcon(ctx, "wake", c.x, c.y, pr * 0.86, "#000", hotAmt * W)
        }
      }
    }

    // …and THE READING GOES AT THE LOOSE (2026-09-07): it has shrunk to a dot on
    // its own corner by then, and a MARKER is born on that same spot as the shot
    // lands — zero-length, which is exactly that dot — so drawing it on would be
    // two marks for one corner.
    readBox =
      homing() || struck
        ? null
        : reading(ctx, L, c, rd, angle, ink, `${angle}`, A, 1, snapAmt, paper, set ? 0 : snapAmt, shutAmt, fillAmt)
  }

  return {
    id: "angle",
    enter,
    onPointerMove,
    onPointerDown,
    draw,
    value: () => (set ? angle : null),
    sweep: () => angle, // how far round the face the aim has come, in degrees — 00:00 to the reading
    bow: () => (lastL ? bowDeg(lastL) : 0), // …and how far EITHER SIDE of it the way home's crossings have slid, so the ring keeps their trail
    held: () => set && !struck, // an angle chosen but not yet struck — the bar's cell stands pressed
    // …and HOW FAR THE LOOSE HAS COME (2026-09-08), for a host drawing the
    // middle itself: the dot in there goes out on this, as the cords run out of
    // the middle to the corners, so the inside of the circle is left to your
    // hand and the lines coming in from them.
    fired: () => fireAmt(),
    // …and how far the GOING OUT has come: the arc the sweep lit is taken back
    // from 00:00 round to the reading, dot by dot, the moment the angle is
    // chosen — so what is left is a clean ring with the angle on it
    settle: () => (setAt ? easeOutQuart(clamp01((performance.now() - setAt) / Math.max(150, T_UNSWEEP * (angle / 360)))) : 0),
    // …and the compass's outward circle, for a host drawing it itself. You DRAW
    // IT OUT as 360 dots of your own; reaching the ring it snaps onto the dial's
    // and the two interleave — 720, one for every half degree — and pulling
    // away unsnaps them again. CHOOSING the angle is what dissolves it
    // (2026-09-04): its work is done, and the dial keeps its own 360.
    compassR: () => (lastL ? outRadius(lastL) : 0),
    compassA: () => (setAt ? 1 - clamp01((performance.now() - setAt) / COMPASS_OUT) : 1),
    twin: () => struckIn(), // …and the dial's own ring filling back to 720 as the two laps part
    // THE CURSOR IS PULLED TOO (2026-09-04): aiming, the host's cursor rides
    // the same snap onto the angle's dot, fading into the reading's circle
    // there — and is its own again once the angle is held (the walk home
    // needs it)
    cursor: () => {
      if (!pointer) return null
      if (struck || !angle || !lastL) return { x: pointer.x, y: pointer.y, alpha: 1 }
      if (set) {
        // …and on the way back, into the centre to confirm — and SEEN there,
        // sitting on the middle's mark (it fades only into the reading's circle)
        const c = originOf(lastL)
        return { ...handAt(c), alpha: 1 } // …your own hand, brace and all: the string and the arrow are the ones held to the circle
      }
      const P = along(originOf(lastL), angle, radiusOf(lastL))
      return { x: lerp(pointer.x, P.x, snapAmt), y: lerp(pointer.y, P.y, snapAmt), alpha: 1 - snapAmt }
    },
    // THE CEREMONY: fired by the click at home, it plays itself out and ends on
    // the tile, lit. `animating` is what the host keeps frames coming for.
    // THE FIRE IS TWO PARTS (2026-09-06): the press BRACES — the limb notches
    // itself inward and the cords take their last pull — and it stays braced for
    // as long as you hold. Letting go is what looses it.
    begin: () => {
      // …and the SAME GESTURE takes the finished drawing home: the press grows
      // every dot outward off the ring and holds it there. Only an ALIGNED one —
      // the hexagon has to be closed for there to be anything to take, so a press
      // off true is not a press here at all.
      if (struck && stage === 0 && stageDone() && (aligned || alignAmt > 0.5)) {
        stage = 1
        stageAt = performance.now()
        api.requestRender()
        return true
      }
      if (!set || struck || braced) return false
      braced = performance.now()
      api.requestRender()
      return true
    },
    loose: () => {
      // …letting go sends it all inward — and letting go OFF THE
      // MARK stands it back down, finished and waiting, the way the bow does
      if (struck && stage === 1) {
        const home = !!lastL && atHome(lastL)
        // …and A QUICK PRESS STILL PLAYS ITS PART (2026-09-08): let go before the
        // press's own beat is out and the release WAITS on it — the shape has to
        // finish going to dashes and filling before it is allowed to leave with
        // them. The answer is taken here, at the click; only the playing waits.
        if (!stageDone()) {
          letGo = home ? 2 : 1
          api.requestRender()
          return true
        }
        stage = home ? 2 : 0
        stageAt = performance.now() - (home ? 0 : DRAWN)
        api.requestRender()
        return true
      }
      if (!braced || struck) return false
      // LET GO OFF THE MARK AND NOTHING FIRES (2026-09-06): the bow stands down,
      // easing off the draw, and the shot is yours to take again.
      if (!lastL || !atHome(lastL)) {
        slackAt = windAt()
        slack = performance.now()
        braced = 0
        api.requestRender()
        return true
      }
      slack = 0
      pulled = gripAt(originOf(lastL)) // …the hand as the drawing had it, kept where the pull left it
      struck = performance.now()
      stage = 0
      stageAt = struck
      api.requestRender()
      return true
    },
    // ESCAPE (2026-09-04): one step BACK — a ceremony part to the one before
    // it, played again; the strike undone; the held angle let go. False when
    // there is nothing behind (aiming): the host steps out of the compass.
    back: () => {
      letGo = 0 // …a step back drops a release that was waiting on the press
      if (struck) {
        if (stage > 0) {
          stage--
          stageAt = performance.now()
        } else {
          struck = 0
          pulled = null // …unstruck, there is no pull to have left anything
        }
      } else if (braced) {
        slackAt = windAt()
        slack = performance.now()
        braced = 0
      } else if (set) {
        set = false
        setAt = 0 // …and the arc the sweep lit comes back with the aim
        if (pointer) aimAt(pointer)
      } else return false
      opened = 0
      api.requestRender()
      return true
    },
    // …the waiting PULSE keeps frames coming too: it breathes on its own clock
    // while the cursor rests home with an angle held
    animating: () =>
      (!!struck && !stageDone()) ||
      !!letGo || // …a press let go of early, still playing itself out before the release takes over

      opening() ||
      readyNow() || // …the sleeper's own breath, which does not stop while the tile waits for its click
      (set && !struck && !!pointer && !!lastL && atHome(lastL)) ||
      // …the snap easing either way, and the ants marching while snapped
      (!struck && (set ? snapAmt < 0.999 : snapAmt > 0.001)) ||
      (set && !struck) || // …the held angle's own lines, whose ants never stop marching
      (!!struck && !homing()) || // …and the six corners' reach for your hand, waiting there with its ants
      (!!braced && !struck && performance.now() - braced < T_WIND) || // …and the brace drawing itself up under the press
      (!!slack && !struck && performance.now() - slack < T_UNBRACE) || // …or easing back off it, stood down
      (!!setAt && performance.now() - setAt < Math.max(COMPASS_OUT, T_UNSWEEP)) || // …the circle you drew out dissolving, and the sweep going back in
      (stage >= 2 && turnIn() < 1) || // …and the shape coming home and turning, once the press has been let go of
      (hotAmt > 0.002 && hotAmt < 0.998) || // …the finished tile lighting under your hand
      (!struck && fillAmt > 0.002 && fillAmt < 0.998) || // …and the ink filling the reading once it has shut (it is gone at the loose)
      (alignAmt > 0.002 && alignAmt < 0.998) || // …and the second lap coming out for an alignment, or going back
      // …and the pull into the centre letting go
      (set && !struck && homeAmt > 0.001),
    // THE WAKE'S OWN EXIT (2026-08-28): clicking it doesn't blink the tile out
    // — the hex shrinks with a little elastic down to the player's own size and
    // fades, so what's under it is REVEALED rather than replaced. `openAmt`
    // is 1 at the click and eases to 0; the screen draws the tile through it.
    open: () => (opened ? false : ((opened = performance.now()), true)),
    opening: () => opening(),
    openMs: () => T_OPEN, // …the host swaps the world in as the tile finishes uncovering what is under it
    openAmt: () => {
      if (!opened) return 1
      const u = Math.min(1, (performance.now() - opened) / T_OPEN)
      const c1 = 1.70158 // easeInBack: a hair BIGGER first, then away
      return 1 - ((c1 + 1) * u * u * u - c1 * u * u)
    },
    ready: readyNow, // the drawing is done: the tile itself is the OK
    // is the pointer on the reading? — the host drops its cursor dot there, so
    // the circle it lit is the only mark in that spot (and once the number is
    // going, it isn't a spot at all)
    onReading: () => !struck && hitBox(readBox, pointer)
  }
}
