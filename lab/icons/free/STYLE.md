# anon&mato — free vector icons: land types, forage, quarry

## The game

**anon&mato** is a hex-grid survival game about time. You wake at midnight
with a tiny budget of minutes and walk a fogged world of island boards
separated by rivers. You forage, hunt, craft, cook and build, then sleep. There
is no win and no lose. The look is ink on paper: hairline, monochrome,
geometric, quiet, a little astronomical (a sun-dial clock, a constellation
wheel of twelve skills). The ground is drawn like a survey map.

## What happened before, and what changes now

The designer drew ~20 icons by hand on a triangular lattice (see
`hand-all.png`: the eye, the basket, the boot, the hammer, the coin, the
sprout, the book, and kufic word-marks). A first attempt expanded that set to
every game element *on the lattice*. Their verdict: **"some results are
interesting but most are not."**

Now: **no lattice, no grid.** Any shape, placed however you want, circles,
lines at any angle. Only three sections: LAND TYPES, FORAGE, QUARRY.

"Interesting" doesn't mean more detail. It means one surprising, precise idea,
drawn with as few marks as possible, and still instantly recognised. The best
icon here is the one a player names at 24px and smiles at.

## The shared look (all three designers, so 31 icons are one family)

- **One ink on paper.** It must invert cleanly (the sheet shows both).
- **One pen.** Every line is class `s`: stroke 0.1 in the unit frame, round
  caps and joins. Never another weight, never your own colour or opacity.
- **Three tones, as in the user's hand set:** line (`s`) carries the drawing;
  solid (`f`) is the focal accent, usually one mass, rarely two; half-tone
  (`h`, a fine hatch) is for a secondary plane, a shadow or a texture. `p`
  (a paper fill) and `ps` (the pen in paper) cut into ink.
- **Construction.** Lean on geometry: circles, arcs, straight lines at any
  angle, tangents, concentric and radial arrangements. Use free curves
  (béziers) only where a living form truly needs them. Precise, not sketchy.
- **Frame.** The unit frame is x right, y DOWN. Draw inside a circle of
  radius ~0.85 centred at (0,0), centred by eye. There is no visible frame.
- **Economy.** About 3–8 marks. A strong silhouette at 24px that is still the
  same silhouette at 16px. Leave gaps of at least one pen between parts that
  must read apart.

## Toolkit

Your file is `families/<family>.mjs`:

```js
import { circle, line, arc, poly, path, polar, ngonPts } from "../fv.mjs"
export const family = "forage"
export const icons = {
  berries: {
    title: "berries",
    concept: "one line: the idea",
    svg: circle("f", -0.2, 0.2, 0.22) + circle("s", 0.25, 0.15, 0.2) + line(0, -0.6, -0.2, 0)
  }
}
```

`svg` is a string of SVG elements (or a function returning one) in the unit
frame. Helpers in `fv.mjs` are `circle(cls,cx,cy,r)`, `line(x1,y1,x2,y2,cls)`,
`arc(cls,cx,cy,r,a0,a1)` (degrees: 0 = right, 90 = down, clockwise when a1 >
a0), `arcD` (its path data), `poly(cls, points, closed)`, `path(cls, d)`,
`polar(cx,cy,r,a)` and `ngonPts(cx,cy,r,k,rot)`. Raw SVG is fine too, using
the classes `s f h p ps` only. Draw in order: later marks sit on top.

`cd <this dir> && node render.mjs <family>` prints a PNG path. **Read it.**
Each cell shows the icon large over a dashed r=0.85 guide, then 40/24/16 px on
paper and on ink. Use `node render.mjs <family> key key --big` for close-ups,
and `node render.mjs all` to see every family together.

Work only in your own family file (plus `scratch/` if you need it). Never edit
`fv.mjs`, `style.css.mjs`, `render.mjs`, `STYLE.md` or another family's file,
and never touch the game repo.

## The loop

Draft every icon, render, read the PNG, and judge it the way the user will.
Would a player name it at 24px? Is the idea interesting, or just the obvious
emoji? Is it clean, with the same pen and the same economy as its siblings?
Redraw from a new idea rather than polishing a dead one. Do at least three
full rounds. Halfway through, look at `node render.mjs all` to stay in step
with the other designers, who are drawing at the same time.

---

# VERSION 2 (current round) — read this too

The user's verdict on v1 (the files `families/land.mjs`, `forage.mjs`,
`quarry.mjs`): **"much better. i like it."** Then: *"give me another version,
keep it in the same similar style but come up with different shapes for
things. some are not quite there, so i'd like more iteration. you can add a
bit more detail, but keep it legible at small sizes."*

So v2 goes in NEW files: `families/land2.mjs`, `forage2.mjs`, `quarry2.mjs`
(`export const family = "land2"` …), with the SAME keys. **v1 files are
read-only. Never edit them.**

- **Same style.** One ink, the pen `s`, solid `f`, hatch `h`, paper `p`/`ps`,
  geometric construction, nothing visible framing the icon, centred in r≈0.85.
- **Different shapes.** Every icon gets a new drawing, not a v1 tweak: a
  different shape, angle, pose, view or construction for the same thing. If an
  idea from v1 really was the best (land's one ground line, for example), you
  can keep the IDEA, but redraw its shapes.
- **A bit more detail.** There's a new THIN pen: class `t` (stroke 0.055), and
  `pt` (the thin pen in paper). Use it ONLY for interior detail (veins,
  scales, grain, ripples, texture lines). The icon must read with its thin
  lines removed: `s`, `f` and `h` carry the silhouette. About 4–12 marks.
- **Legible at small sizes.** Judge at 24px and 16px on paper and on ink.
  Detail can fade at 16px, but it must never muddy the silhouette.
- **More iteration.** For every key, sketch at least THREE different shapes
  side by side in a scratch module (`scratch/<you>/…`, not in `families/`),
  pick the best, then refine it. Do at least five full render→look→fix rounds
  on the family. Compare with v1 often: `node render.mjs land2 --vs land`
  puts each v1 icon beside its v2.

Known weak spots in v1 (from its director): kelp (flame-like ribbons), rope
(the strands merge at 16px), eel (a hooked stroke at 16px), crusher (a smooth
stone, nothing says "strike"), herbs (a plus sign), water vs river (differ only
by one line at 16px), peak (a near-twin of mountain plus a sparkle), oysters,
cord. Fruit, crabs, eggs, fish and plain are solid but conventional.
