// ANIM LAB — the component registry the shell (animate.html) loads.
//
// An entry normally carries the declarative bench fields — { id, label,
// title, subtitle, store, tracks, stageOptions, game, drawScene } — and the
// shell mounts it with the keyframe bench (bench.js). A component with
// different needs can instead bring its own `mount(host) → { destroy }` and
// take the host over entirely; the shell doesn't care which kind it gets.
//
// Seeds reproduce the CURRENT in-game curves (named preset eases are the css
// equivalents of render.js's formulas — within a fraction of a percent of a
// tile, visually identical; verified in node against the real functions).

import { MENU_TRACKS, MENU_STAGE_OPTIONS, drawMenuScene } from "./menu-scene.js"

const menuBench = {
  subtitle: "the player and the tile below it, isolated",
  tracks: MENU_TRACKS,
  stageOptions: MENU_STAGE_OPTIONS,
  drawScene: drawMenuScene
}

export const ANIMATIONS = [
  {
    id: "menu-open",
    label: "menu open",
    title: "menu open",
    store: "thrive.lab.menu-open",
    ...menuBench,
    // render.js GROW_MS=620, growEase — DECOMPOSED so the backstep is yours:
    // the dip key is the back movement (t = timing, v = distance), with an
    // ease on each side of it.
    game: () => ({
      anim: "menu-open",
      duration: 620,
      tracks: {
        "tile.scale": [
          { t: 0, v: 1, e: "out-sine" }, // …into the backstep
          { t: 93, v: 0.88, e: "out-back" }, // the dip — drag me
          { t: 620, v: 3 }
        ],
        "tile.opacity": [{ t: 0, v: 1 }],
        "player.scale": [{ t: 0, v: 1 }],
        "player.lift": [{ t: 0, v: 0 }],
        "player.opacity": [{ t: 0, v: 1 }]
      }
    })
  },
  {
    id: "menu-close",
    label: "menu close",
    title: "menu close",
    store: "thrive.lab.menu-close",
    ...menuBench,
    // render.js closing paint, MENU_MS=540: the tile rides 1 − easeInBack —
    // swells a hair (~3.2× around 230ms) as it lets go, then draws down and
    // lands exactly at 1:1. One in-back segment IS that formula; add a key at
    // the swell's top to take both of its ends into your hands.
    game: () => ({
      anim: "menu-close",
      duration: 540,
      tracks: {
        "tile.scale": [
          { t: 0, v: 3, e: "in-back" },
          { t: 540, v: 1 }
        ],
        "tile.opacity": [{ t: 0, v: 1 }],
        "player.scale": [{ t: 0, v: 1 }],
        "player.lift": [{ t: 0, v: 0 }],
        "player.opacity": [{ t: 0, v: 1 }]
      }
    })
  }
]
