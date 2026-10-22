import * as L from "../lat.mjs"
export const family = "menu"

// ── lattice helpers (lattice vertex coords [c, v], c + v even) ──
const odd = (c, v) => ((c + v) % 2 + 2) % 2 !== 0
const P = pts => {
  for (const [c, v] of pts) if (odd(c, v)) throw new Error(`odd vertex ${c},${v}`)
  return L.lpoly(pts)
}
const D = L.diff
const hexL = (c, v, r) => P([[c, v - 2 * r], [c + r, v - r], [c + r, v + r], [c, v + 2 * r], [c - r, v + r], [c - r, v - r]])
const hexRing = (c, v, r, t = 1) => D(hexL(c, v, r), hexL(c, v, r - t))
const tri = (c, v, s, dir = 1) => P([[c, v - s], [c, v + s], [c + dir * s, v]]) // ▶ (dir 1) / ◀ (dir -1), vertical edge at c
const gem = (c, v) => P([[c - 1, v], [c, v - 1], [c + 1, v], [c, v + 1]]) // ◆ on the vertical edge at c (c + v odd)
const col = (k, h0, h1) => { const r = []; for (let h = h0; h <= h1; h++) r.push([k, h]); return r }
// the player's mark: a one-pen hex and three one-pen spokes, each on the clockwise side of its axis
const cubeMark = (r = 6) => {
  const ic = L.icon().fill(hexRing(0, 0, r))
  const s = L.icon().fill(P([[0, 0], [0, -2 * r + 2], [1, -2 * r + 3], [1, -1]]))
  return ic.add(s.clone()).add(s.clone().rot60(2)).add(s.clone().rot60(4))
}
// an iso prism: front edge at c = f from vb - H (top) to vb (bottom); lit face (left, wl strips) solid,
// shade face (right, wr strips) half-tone, paper cap held by a one-pen rim along its back edges
function prism(ic, f, vb, H, wl = 2, wr = 1) {
  const vt = vb - H
  ic.fill(P([[f - wl, vb - wl], [f, vb], [f, vt], [f - wl, vt - wl]]))
  ic.texture(P([[f, vb], [f + wr, vb - wr], [f + wr, vt - wr], [f, vt]]), "left")
  ic.fill(P([[f - wl, vt - wl], [f - wl + wr, vt - wl - wr], [f + wr, vt - wr], [f + wr, vt - wr - 2], [f - wl + wr, vt - wl - wr - 2], [f - wl, vt - wl - 2]]))
  return ic
}

export const icons = {
  cube: {
    title: "cube",
    concept: "the player's mark: a one-pen hex and three one-pen spokes, each laid on the clockwise side of its axis, so the lattice gives three equal faces",
    draw: () => cubeMark(6)
  },
  folder: {
    title: "folder",
    concept: "the menu caught mid-unfold: a node tile full of half-tone (more in here) fanning its three children out onto the ring, a step left behind each — at 16 px the node and a ⋮",
    draw() {
      const ic = L.icon().fill(hexRing(-4, 0, 3))
      ic.texture(hexL(-4, 0, 2), "right")
      for (const [c, v] of [[3, -7], [4, 0], [3, 7]]) ic.fill(hexL(c, v, 1))
      ic.fill(gem(0, -5)).fill(gem(1, 0)).fill(gem(0, 5))
      return ic.shift(1, -1)
    }
  },
  back: {
    title: "back",
    concept: "a one-pen lattice '<' opening over the trail of steps you came by, thinning into the fog: a solid hex step, a gem, a single triangle",
    draw() {
      const ic = L.icon().fill(P([[-6, 0], [4, -10], [4, -8], [-4, 0], [4, 8], [4, 10]]))
      ic.fill(hexL(0, 0, 1)).fill(gem(3, 0))
      ic.set([[5, 0]])
      return ic
    }
  },
  close: {
    title: "close",
    concept: "a one-pen lattice X across the whole footprint, tied where the strokes cross by a solid flat rhombus, the cube's top face as a knot",
    draw() {
      const ic = L.icon()
      ic.fill(P([[-6, -8], [6, 4], [6, 6], [-6, -6]]))
      ic.fill(P([[6, -8], [-6, 4], [-6, 6], [6, -6]]))
      ic.fill(P([[-3, -1], [0, -4], [3, -1], [0, 2]]))
      return ic
    }
  },
  reset: {
    title: "reset",
    concept: "the day's hex loop running counter-clockwise back to midnight, open on its upper-left side",
    draw() {
      const ic = L.icon().fill(hexRing(0, 0, 5))
      ic.clear(P([[-6, -14], [0, -14], [0, -6], [-4, -2], [-6, -4]]))
      ic.fill(tri(0, -10, 4, -1))
      return ic
    }
  },
  reveal: {
    title: "reveal",
    concept: "the fog over the tile torn down the middle and drawn apart like a curtain: the same half-tone as land:fog, ragged tears, the island showing through",
    draw() {
      const ic = L.icon()
      // left half of the fog: the tile's outer edges, then a ragged tear back up the middle (drawn 2 strips apart)
      const tear = [[0, -10], [-1, -9], [0, -8], [0, -6], [-1, -5], [0, -4], [-1, -3], [0, -2], [0, 2], [-1, 3], [0, 4], [0, 6], [-1, 7], [0, 8], [-1, 9], [0, 10]]
      const left = P([[-5, -5], ...tear.slice(0, -1), [0, 10], [-5, 5]].map(([c, v]) => [c - 2, v]))
      ic.texture(left, "left")
      ic.add(L.icon().texture(left, "left").mirrorX())
      ic.fill(hexL(0, 0, 1))
      return ic
    }
  },
  stats: {
    title: "stats",
    concept: "a bar chart in iso: three prisms stepping up on one floor, each with a solid lit face, a half-tone shade face on the same side and a paper cap, a strip of paper between them",
    draw() {
      const ic = L.icon()
      const vb = 5
      prism(ic, -3, vb, 4)
      prism(ic, 1, vb, 8)
      prism(ic, 5, vb, 12)
      // the floor rhombus's two front edges, one pen, a row of paper under the bars
      ic.fill(P([[-6, vb - 1], [1, vb + 6], [7, vb], [7, vb + 2], [1, vb + 8], [-6, vb + 1]]))
      return ic
    }
  },
  play: {
    title: "play",
    concept: "the play button given the cube's depth: a solid ▶ with a half-tone iso top, the door into the cube view",
    draw() {
      const ic = L.icon()
      ic.fill(P([[-5, -5], [-5, 9], [2, 2]]))
      ic.texture(P([[-5, -5], [-2, -8], [5, -1], [2, 2]]), "right")
      return ic
    }
  },
  talk: {
    title: "talk",
    concept: "a hex speech bubble with a lattice tail, three steps of speech inside",
    draw() {
      const ic = L.icon()
      ic.fill(hexRing(1, -1, 5))
      ic.fill(P([[-3, 5], [-3, 11], [0, 8]]))
      ic.fill(gem(-1, 0)).fill(gem(1, 0)).fill(gem(3, 0))
      return ic
    }
  },
  clock: {
    title: "clock",
    concept: "the day dial: one-pen rim, the day spent in half-tone from midnight to the hand, the budget pinned on the bezel ahead of it",
    draw() {
      const ic = L.icon().fill(hexRing(0, 0, 6))
      ic.texture(P([[0, 0], [0, -10], [5, -5]]), "right")
      ic.fill(P([[0, 0], [0, -8], [1, -7], [1, -1]]))
      ic.fill(P([[0, 0], [4, -4], [4, -2], [0, 2]]))
      ic.fill(hexL(0, 0, 1))
      ic.fill(tri(8, 2, 2, -1))
      return ic
    }
  },
  replay: {
    title: "replay",
    concept: "reset plus play: the day's hex loop running counter-clockwise back to midnight, with play's solid ▶ inside it",
    draw() {
      const ic = L.icon().fill(hexRing(0, 0, 5))
      ic.clear(P([[-6, -14], [0, -14], [0, -6], [-4, -2], [-6, -4]]))
      ic.fill(tri(0, -10, 4, -1))
      ic.fill(tri(-1, 1, 4, 1))
      return ic
    }
  },
  key: {
    title: "key",
    concept: "your npub as a key: the bow is the player's cube, the bit an irregular sawtooth — the code your world is cut from",
    draw() {
      const ic = L.icon()
      ic.fill(hexRing(-3, -3, 4))
      const sp = L.icon().fill(P([[0, 0], [0, -6], [1, -5], [1, -1]]))
      ic.add(L.icon().add(sp.clone()).add(sp.clone().rot60(2)).add(sp.clone().rot60(4)).shift(-3, -3))
      ic.fill(P([[1, -1], [7, 5], [7, 7], [1, 1]]))
      // the bit: teeth hanging under the shaft's outer half, depths 1, 3, 2, 1
      for (const [k, d] of [[3, 1], [4, 3], [5, 2], [6, 1]]) ic.set(col(k, k + 1, k + d))
      return ic
    }
  }
}
