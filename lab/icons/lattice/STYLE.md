# anon&mato — expanding the hand-drawn lattice iconography

## The brief

The game is **anon&mato**: a hex-grid survival game about
time. You wake at midnight with a tiny budget of minutes, walk a fogged hex
world of island boards separated by rivers, forage, hunt, craft, cook and
build, and sleep. No win, no lose — patterns you set up across a 360-day loop
either grow or collapse. Its look is ink on paper: hairline, monochrome,
geometric, quiet, a little mystical (constellations, a sun dial clock, a
colour wheel of twelve skills in three pillars — Time, Space, Mind).

The designer (the user) drew ~20 icons BY HAND on a triangular lattice. Their
words: *"could you expand that to all elements? just curious what you come up
with. don't get bound by anything, no rules to follow, nothing — your pure
imagination, to see how good you can be at creating vector iconography."*

So: every new icon must look like **the same hand drew it on the same
lattice** — and then show range, wit and ingenuity inside that constraint.
Concepts are yours: surprise us. A literal clip-art object is the floor, not
the goal: find the one idea that makes the thing unmistakable AND belongs to
this game (time, fog, hex, islands, the cube, the loop).

## The lattice (fixed — this is what makes them drop into the game)

A POINTY-TOP HEX (radius 1; unit frame x right, y DOWN; top vertex (0,−1),
flat sides at x = ±0.866) cut into a regular TRIANGULAR lattice of side 1/8 —
**384 triangles, every one with a VERTICAL edge, so each points LEFT or
RIGHT.** Lattice lines run **vertical, +30° and −30°. There are NO horizontal
lines** — a "horizontal" edge is a zigzag or a shallow chevron. Embrace it:
the hand set builds everything out of verticals and 30° diagonals — hexagons,
rhombi, chevrons, iso boxes.

Output per icon = the set of filled triangles = the game's wedge data
`{ n: 8, fill: ["face:i:j:half", …], lines: [] }`. That's exactly what the
user's in-game icon creator pastes, so every icon we make is drop-in.

## The hand set — study it FIRST

Reference renders (Read these images before drawing anything):
- `ref/hand-all.png` — all 21 at size, with badge sizes
- `ref/hand-big-1.png` scout (eye), gather (basket), travel (boot), build (hammer), raft (hull), craft (anvil)
- `ref/hand-big-2.png` trade (coin), tend (sprout), lore (book), and the WORD marks HUNT, COOK, HEAL
- `ref/hand-big-3.png` DREAM, WAKE, BUILD, WALK (travel:word), FARM (tend:word), LORE words

`node dump.mjs hand <key>` prints any of them as an exact lattice map.

What the hand does, in its own terms:
1. **One pen.** Vertical strokes are exactly ONE STRIP wide (≈0.108). Diagonal
   strokes are one rhombus thick (a chain of ▶◀ pairs along ±30°). Stroke ends
   are cut on lattice angles, never rounded. Consistent weight everywhere.
2. **Three tones.** OUTLINE (a one-pen band enclosing paper: the eye, the
   hull), HALF-TONE (a texture of alternating triangles: the basket's weave,
   the anvil's face, the book's page edges, the mat), SOLID (one filled mass as
   the focal accent: the iris cube, the hammer's head, heal's hex). Most figures
   use two of the three; the best use all three with SOLID as the smallest.
3. **Sawtooth fringes.** A row of single triangles along an edge is ornament
   AND meaning: lashes on the eye, the coin's milled rim, the mat's tassels,
   the book's page ends, the seed at the sprout's foot.
4. **Isometric volume.** Objects sit in iso on the cube's three faces: the
   anvil's top face, the book lying open, the mat laid flat as a rhombus, the
   hammer's head as an iso bar. The hex IS a cube seen corner-on — the
   player's own glyph is a hex with three spokes.
5. **Words as glyphs.** Kufic-like iso capitals: strokes are verticals and 30°
   diagonals, O is a hexagon, A a hex arch, E stacked chevrons, T a long 30°
   bar; letters interlock and wrap around the three faces until the word
   fills the hex.
6. **Density** ~75–145 triangles (of 384). Figures sit in the central ~75% of
   the hex with air around them; word-marks fill it edge to edge.
7. **Reads small.** At 16–24 px a triangle is about a pixel: silhouette first,
   texture reads as grey, stray single triangles become noise (unless they are
   deliberate sparkle).

## Label grammar (keys)

Keys follow the game's `iconKey`: a plain `name` is the default design, and
`name:label` an alternate version of the same thing: `fish:cooked`,
`axe:fine`, `scout:word`, `hunt:figure`, `gate:open`. Use lowercase keys;
multi-word names keep their spaces (`fine axe` is `axe:fine`; `surf & turf`
is `surf & turf`).

## The toolkit

Work ONLY in `families/<your-family>.mjs` (plus any scratch files of your own
under `scratch/`). Never edit `lat.mjs`, `render.mjs`, `dump.mjs`, `STYLE.md`,
`hand.json`, or another family's file, and never touch the game repo.

```js
import * as L from "../lat.mjs"
export const family = "forage"
export const icons = {
  berries: {
    title: "berries",
    concept: "one line: the idea",
    draw() {
      const ic = L.icon()
      ic.fill(L.circle(-0.2, 0.1, 0.22)).fill(L.circle(0.2, 0.1, 0.22))
      ic.texture(L.circle(0.2, 0.1, 0.16), "right")      // half-tone inside one
      ic.fill(L.path([[0, -0.6], [-0.2, -0.1]], 0.06))     // a stem (capsule polyline)
      return ic
    }
  }
}
```

Shapes (predicates in unit coords, y down): `poly(pts)`, `lpoly(latticePts)`
(polygon in lattice VERTEX coords [c, v]: x = c·0.108, y = v/16, c+v even —
edges along lattice directions come out razor exact), `circle`, `ellipse(cx,
cy, rx, ry, rot)`, `ring(cx, cy, r1, r2)`, `rect`, `seg(a, b, halfWidth, cap)`,
`path(points, halfWidth)`, `arc(cx, cy, r, halfWidth, a0, a1)` (radians, 0 = +x,
clockwise), `ngon(cx, cy, r, n, rotDeg)`, `union / inter / diff / not`,
`xf(shape, {dx, dy, rot, sc, sx, sy, flipX, flipY})`. `V(c, v)` turns a lattice
vertex into a unit point.

Painting on an `Icon` (in order; each returns the icon):
`fill(shape, thr=0.5)` (a triangle fills when ≥ thr of it is covered — lower
= bolder, higher = thinner), `clear(shape)`, `toggle(shape)`,
`texture(shape, mode)` with modes `right` (all ▶ — the fine half-tone),
`left`, `checker`, `diamonds` (sparse ◆ pairs), `stripes` (alternate strips),
`zigzag` (alternate row pairs), `pattern(shape, t => bool)` (your own, t =
{k, h, right, cx, cy}), `set([[k, h], …], on)` (individual triangles: strip k
∈ −8..7, row h ∈ −15..15; ▶ when k+h odd), `outline()` (keep the boundary
band), `symX()` (add the left-right mirror), `mirrorX()`, `shift(dc, dv)`
(dc + dv even), `rot60(n)`, `add(icon)`, `sub(icon)`, `clone()`.
`L.fromData(hand.json entry)` loads a hand icon if you want to borrow a part.

Tips: straight edges along the lattice (vertical / ±30°) come out crisp;
curves and horizontals come out stepped — use that on purpose or avoid it.
`lpoly` is the precise instrument; `circle/ellipse` are the loose brush. For
a one-pen stroke use a vertical band exactly one strip wide
(`rect(c·0.108, y0, (c+1)·0.108, y1)`) or `lpoly` a 30° parallelogram. When
a curve comes out lumpy, fix it by hand with `set`.

## The loop (mandatory)

1. Read the four `ref/` images. `node dump.mjs hand scout` to feel the grid.
2. Draft every icon in your list.
3. `node render.mjs <family>` → prints a PNG path; **Read the PNG**. Each cell
   shows the icon over the lattice, then badge sizes 40/24/16 px on paper and
   inverted on ink. `node render.mjs <family> key1 key2 --big` for a close-up.
4. Critique like the user would: would a player NAME it at 24 px? Does it look
   like the same hand as the hand set? Stray triangles? Lumpy? Weight
   consistent with the neighbours? Is the idea good, or just literal?
5. Iterate — at least three full render→look→fix rounds; more for the weak
   ones. Redraw from a new concept rather than polishing a dead one.
