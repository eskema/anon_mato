// THE MAP ON THE GPU — a small WebGL2 renderer for the hex field: the game's
// ground (render.js lays it down as the frame's first layer) and the lab's
// test page. Every tile is one INSTANCE of one quad, and a single shader
// draws it from a few numbers: its ground (one colour a kind) and its shore
// running into the found neighbours' grounds, its kind's
// texture (the river's among them), its contours (joined with same-kind
// neighbours), home's rule, the fog eating its rim where it faces the
// unknown, its walls with the sun's shadow, its regrow clock — then the
// streams and the fog's outward breath over all the tiles, then the board
// centres' seats and figures. Three draw calls for the whole world; the
// camera (a centre and a zoom) is a pair of uniforms, so zoom and pan repaint
// nothing. The look is read off the same rules the rest of the game reads
// (tileDressOf, contourScale, elevRingCount, …).
// EVERY LINE IS A SHARE OF ITS TILE: drawn at the game's own width when the
// tile is at its 1:1 size (`unit`), and thicker or thinner with it at any
// other zoom — no widths held in pixels, nothing fading in at a threshold. A
// line thinner than a pixel is drawn a pixel wide at that fraction of its
// strength, so it thins out of sight as the tiles shrink.

// (render.js imports this module too: nothing here may read its exports
// before a function runs — the fragment shader is written when a map is made)
import { tileDressOf, elevRingCount, contourScale, STREAM_W, WALL_GAP, REGROW_EYE, FOG_IN, FOG_OUT, WATER, TILE_INNER } from "./render.js"
import { DIRS } from "./world.js"
import * as Hex from "./hex.js"

export const STRIDE = 32 // floats per tile — see hexInstances
// THE CURRENT: a river's waves cross it this far apart (a tenth of the step to
// the next tile down the river, so they meet that tile's) and drift downstream
// at this many tile radii a second
const CURRENT_SP = Math.sqrt(3) / 10
const CURRENT_SPEED = 0.3
// the lines' widths at 1:1, in px — the game's own
const WALL_PX = 3
const CONTOUR_PX = 1 // …a contour's, and every hairline's: home's rule, a ripple, a texture
const STREAM_MIN_PX = 2 // a stream is STREAM_W of the tile, never under this at 1:1
const REGROW_PX = 2 // a regrow clock's ring
const SHADOW_BLUR_PX = 3 // the sun's shadow's blur
const TOKEN_PX = 0.1 // a seat's line weight, of the 1:1 tile (render.js W) — never under 1.5px there

// THE KINDS a motif is drawn for (0: none — home and the board centres are the chart)
const KIND = { water: 1, river: 2, beach: 3, marsh: 4, plain: 5, forest: 6, mountain: 7, cliff: 8, peak: 9 }
export const KINDS = Object.keys(KIND) // …by index − 1
// THE MOTIFS, by the shader's own number (see motif() there)
export const MOTIFS = ["none", "rosette", "bubbles", "rings", "star", "star lattice", "ribbon", "meander", "scales", "waves", "hexagon", "snowflake", "fine lattice", "diamonds", "lines", "fine lines", "weave"]
// …and each kind's, to start: [—, water, river, beach, marsh, plain, forest, mountain, cliff, peak]
export const DEFAULT_MOTIFS = [0, 9, 9, 10, 1, 16, 2, 5, 14, 4]
export const DEFAULT_STRENGTH = 0.15 // …and how dark their lines are, of the tile's own colour

// a CSS colour as [r, g, b, a] in 0..1 — the browser reads it, once per colour
const parsed = new Map()
let probe = null
export function rgba(css) {
  if (!css) return [0, 0, 0, 0]
  if (parsed.has(css)) return parsed.get(css)
  probe = probe || document.createElement("canvas").getContext("2d")
  probe.fillStyle = "#000"
  probe.fillStyle = css
  const v = probe.fillStyle // "#rrggbb", or "rgba(r, g, b, a)"
  let out
  if (v[0] === "#") out = [1, 3, 5].map(i => parseInt(v.slice(i, i + 2), 16) / 255).concat(1)
  else {
    const n = v.match(/[\d.]+/g).map(Number)
    out = [n[0] / 255, n[1] / 255, n[2] / 255, n[3] ?? 1]
  }
  parsed.set(css, out)
  return out
}
// …and as ONE float, its three bytes packed (24 bits: exact in a float); −2
// for none, the bare ground
function packed(css) {
  if (!css) return -2
  const [r, g, b] = rgba(css)
  return Math.round(r * 255) * 65536 + Math.round(g * 255) * 256 + Math.round(b * 255)
}

// THE SIDES, in the shader's order: edge i runs from corner i to corner i+1,
// its middle at startDeg + 30 + 60i. Each grid direction d (DIRS) is the edge
// whose middle faces it — the same table the game's walls and gate are drawn by.
function edgeIndexOf(o) {
  return DIRS.map(dir => {
    const theta = (Hex.screenAngle(o, dir.q, dir.r) * 180) / Math.PI
    let best = 0
    let bestDiff = Infinity
    for (let i = 0; i < 6; i++) {
      const diff = Math.abs(((theta - (60 * i + o.startDeg + 30) + 540) % 360) - 180)
      if (diff < bestDiff) (bestDiff = diff), (best = i)
    }
    return best
  })
}

// A TILE'S STANDING FACTS — all the world never changes about it: where it
// sits, its dress, its heights and kind, its seat, and what lies on each side
// (that neighbour's contour count where it's of the same kind, its ground,
// land against the sea, a stream along it). Read once and kept in `memo`, one map per world,
// depth and lattice, so a rebuild asks the sim only what moves: what's found,
// the walls, the regrow clocks. `t` is the tile's numbers with every moving
// one left at 0.
function factsOf(sim, h, o, edgeOf, memo) {
  const k = Hex.key(h)
  let f = memo.get(k)
  if (f) return f
  const t = new Float32Array(STRIDE)
  t[0] = o.f[0] * h[0] + o.f[1] * h[1]
  t[1] = o.f[2] * h[0] + o.f[3] * h[1]
  const dress = tileDressOf(sim, h)
  const river = sim.isRiver(h)
  t.set(dress.fill ? rgba(dress.fill) : [0, 0, 0, 0], 2)
  const land = sim.landAt(h)
  const type = land ? sim.typeNameAt(h) : null
  const n = land ? elevRingCount(type, land) : 0
  for (let i = 1; i <= 4; i++) t[5 + i] = i <= n ? contourScale(type, i) : 0
  t[10] = n
  t[13] = dress.rule ? 1 : 0
  // its KIND (and a river's ripple jitter) and its seat
  const bh = sim.boardHexOf(h)
  const home = !!bh && !bh[0] && !bh[1]
  const centre = !!bh && Hex.equals(sim.centreOf(bh), h)
  t[20] = river ? KIND.river : home || centre ? 0 : KIND[type] || 0
  t[21] = river ? (((h[0] * 73856093) ^ (h[1] * 19349663)) >>> 0) & 0x1fffff : 0
  t[23] = centre ? (sim.npcAt(bh) ? 2 : 1) : 0
  // a river's CURRENT: the side it runs out by, toward the neighbour one closer
  // to the sea (+1; 0 still — where it meets the sea, or never reaches it)
  const fl = river ? sim.flowAt(h) : null
  if (fl > 0 && fl !== Infinity) {
    const d = DIRS.findIndex(dir => sim.flowAt([h[0] + dir.q, h[1] + dir.r]) === fl - 1)
    if (d >= 0) t[25] = edgeOf[d] + 1
  }
  const sea = !river && type === "water"
  const sb = sim.streamAt(h)
  const sides = DIRS.map((dir, d) => {
    const nh = [h[0] + dir.q, h[1] + dir.r]
    const there = sim.onMap(nh)
    let level = -1
    if (there && n > 0 && sim.typeNameAt(nh) === type) {
      const nl = sim.landAt(nh)
      if (nl) level = elevRingCount(type, nl)
    }
    return {
      h: nh,
      i: edgeOf[d],
      level,
      ground: there ? packed(tileDressOf(sim, nh).fill) : -1,
      stream: !!((sb >> d) & 1),
      shore: there && sea && !sim.isRiver(nh) && sim.typeNameAt(nh) !== "water" // water against land
    }
  })
  f = { key: k, t, sides }
  memo.set(k, f)
  return f
}

// THE TILES AS NUMBERS: `hexes` are the tiles to draw; a neighbour counts as
// found when `known` has its key (or, without it, when the sim has found it).
// `memo` keeps their standing facts between calls (factsOf). Per tile, side by
// side:
//   0  its centre (tile radii, on the sim's own lattice)
//   2  its dress (rgba) — one colour a kind (all water one blue): its height
//      is the contours' to tell
//   6  its contour scales (four)   10 [rings, wall bits, stream bits, home's rule]
//   14 its same-kind neighbours' contour counts, one a side
//   20 [kind, jitter, regrow, seat]
//   24 the bits of its sides facing the fog, and (shifted 6) a water tile's
//      sides on the shore
//   25 a river's current: the side it runs out by, +1 (0 still)
//   26 its neighbours' grounds, one a side, packed — −1 none to run into
//      (unfound, or off the map), −2 the bare ground
// A RIVER's jitter places its three ripples (an integer, exact in a float).
// REGROW: −1 none (or not yet seen — scout below REGROW_EYE), 0..1 growing, 2
// ready. SEAT: 0 none, 1 a board centre's empty seat, 2 a figure resting in it.
export function hexInstances(sim, hexes, known = null, memo = new Map()) {
  const o = sim.orient()
  const edgeOf = edgeIndexOf(o)
  const isKnown = known ? h => known.has(Hex.key(h)) : h => sim.isDiscovered(h)
  const eyes = sim.skillOf("scout") >= REGROW_EYE
  const data = new Float32Array(hexes.length * STRIDE)
  let j = 0
  for (const h of hexes) {
    const f = factsOf(sim, h, o, edgeOf, memo)
    const at = j * STRIDE
    data.set(f.t, at)
    let walls = 0
    let streams = 0
    let fog = 0
    let shore = 0
    const wb = sim.wallsAt(h)
    for (let d = 0; d < 6; d++) {
      const s = f.sides[d]
      const seen = isKnown(s.h)
      if ((wb >> d) & 1) walls |= 1 << s.i
      else if (!seen) fog |= 1 << s.i // a walled side never faces the fog: it keeps its hard line
      data[at + 14 + s.i] = seen ? s.level : -1
      data[at + 26 + s.i] = seen ? s.ground : -1 // an unfound side's shore stays the fog's
      if (!seen) continue
      if (s.stream) streams |= 1 << s.i
      if (s.shore) shore |= 1 << s.i
    }
    data[at + 11] = walls
    data[at + 12] = streams
    const rg = eyes ? sim.regrowRingAt(h) : null
    data[at + 22] = rg ? (rg.ready ? 2 : rg.progress) : -1
    data[at + 24] = fog | (shore << 6)
    j++
  }
  return { data, count: j }
}

const VS = `#version 300 es
in vec2 a_corner;
in vec2 a_pos;
in vec4 a_fill;
in vec4 a_rings;
in vec4 a_meta;
in vec3 a_nb0;
in vec3 a_nb1;
in vec4 a_tex;
in float a_fog;
in float a_flow;
in vec3 a_nc0;
in vec3 a_nc1;
uniform vec2 u_cam;   // the world point at the viewport's centre, in tile radii
uniform float u_zoom; // device px per tile radius
uniform vec2 u_view;  // the viewport, device px
uniform float u_pad;  // how far past its corners a tile's quad reaches, in tile radii
out vec2 v_p;
out vec2 v_w;
flat out vec4 v_fill;
flat out vec4 v_rings;
flat out vec4 v_meta;
flat out vec3 v_nb0;
flat out vec3 v_nb1;
flat out vec4 v_tex;
flat out float v_fog;
flat out float v_flow;
flat out vec3 v_nc0;
flat out vec3 v_nc1;
flat out vec2 v_c;
void main() {
  vec2 c = a_corner * (1.0 + u_pad);
  vec2 px = (a_pos + c - u_cam) * u_zoom; // device px from the centre, y down
  gl_Position = vec4(px.x / (u_view.x * 0.5), -px.y / (u_view.y * 0.5), 0.0, 1.0);
  v_p = c;
  v_w = a_pos + c; // the world, in tile radii — where the textures' lines are laid
  v_fill = a_fill;
  v_rings = a_rings;
  v_meta = a_meta;
  v_nb0 = a_nb0;
  v_nb1 = a_nb1;
  v_tex = a_tex;
  v_fog = a_fog;
  v_flow = a_flow;
  v_nc0 = a_nc0;
  v_nc1 = a_nc1;
  v_c = a_pos;
}`

const fragment = () => `#version 300 es
precision highp float;
in vec2 v_p;
in vec2 v_w;
flat in vec4 v_fill;
flat in vec4 v_rings;
flat in vec4 v_meta;
flat in vec3 v_nb0;
flat in vec3 v_nb1;
flat in vec4 v_tex;
flat in float v_fog;
flat in float v_flow;    // a river's current: the side it runs out by, +1 (0 still)
flat in vec3 v_nc0;      // the neighbours' grounds, packed, by side (−1 none, −2 the bare ground)
flat in vec3 v_nc1;
flat in vec2 v_c;       // the tile's centre (its own die roll)
uniform float u_zoom;    // device px per tile radius
uniform float u_a0;      // edge 0's outward normal, radians (startDeg + 30°)
uniform float u_inset;   // the walls' inset, of the corner radius
uniform float u_wallW;   // a wall's stroke, device px
uniform float u_lineW;   // a contour's (and every hairline's) stroke, device px
uniform float u_streamW; // a stream's stroke, device px
uniform float u_ringW;   // a regrow clock's stroke, device px
uniform float u_tokenW;  // a seat's line weight, device px
uniform vec3 u_ground;   // the bare ground, under a tile with no dress
uniform vec3 u_ink;
uniform vec3 u_paper;    // a figure's own fill
uniform vec3 u_stream;
uniform vec3 u_ripple;
uniform vec3 u_fogInk;   // the fog's breath past the edge…
uniform vec3 u_fogEdge;  // …and the colour it eats the rim with
uniform vec4 u_shadow;   // the sun's shadow: offset (device px), blur (device px), on (0/1)
uniform vec3 u_shadowCol;
uniform float u_textures;// the kinds' textures, on (1) or off (0)
uniform int u_motif[10]; // each kind's motif (MOTIFS), by kind
uniform float u_texA;    // how dark a motif's lines are, of the tile's own colour
uniform vec2 u_lat;      // the grid's own steps between tile middles, across and down (tile radii)
uniform int u_pass;      // 0: the tiles, 1: streams and the fog's breath over them all, 2: the seats
uniform float u_drift;   // how far the current has carried the river's waves, of their spacing (0..1)
out vec4 o;
const float AP = 0.8660254;
const float SIXTH = 1.0471976;
const float TAU = 6.2831853;
uniform float u_fogIn;   // how deep the fog eats into the rim, of the corner radius: the shore
const float SHORE_IN = ${TILE_INNER.toFixed(4)}; // where the shore starts, of the middle-to-side
const float FOG_OUT = ${FOG_OUT.toFixed(3)}; // …and how far its breath goes past the edge
const float CURRENT_SP = ${CURRENT_SP.toFixed(6)}; // the current's waves' spacing
vec2 N(int i) { float a = u_a0 + float(i) * SIXTH; return vec2(cos(a), sin(a)); }
vec2 C(int i) { float a = u_a0 - 0.5235988 + float(i) * SIXTH; return vec2(cos(a), sin(a)); }
vec2 M(int i) { return N(i) * AP; } // edge i's midpoint
float hash(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
float nbOf(int i) { return i < 3 ? v_nb0[i] : v_nb1[i - 3]; }
float ncOf(int i) { return i < 3 ? v_nc0[i] : v_nc1[i - 3]; }
vec3 unpackRgb(float c) { int v = int(c + 0.5); return vec3(float((v >> 16) & 255), float((v >> 8) & 255), float(v & 255)) / 255.0; }
bool bit(int bits, int i) { return ((bits >> i) & 1) == 1; }
// a line's coverage at distance d px from its middle, for a stroke w px wide —
// under a pixel wide, a pixel's line at that fraction of its strength
float line(float d, float w) {
  float ww = max(w, 1.0);
  return clamp(ww * 0.5 + 0.5 - abs(d), 0.0, 1.0) * min(w, 1.0);
}
// …a soft one: the same stroke blurred by b px (the sun's shadow)
float soft(float d, float w, float b) { return (1.0 - smoothstep(w * 0.5 - b, w * 0.5 + b, abs(d))) * min(w, 1.0); }
float seg(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
  return length(p - a - ab * t);
}
// the distance to the nearest of a family of parallel lines v = k·sp
float stripes(float v, float sp) { return abs(fract(v / sp + 0.5) - 0.5) * sp; }

// THE RIVER'S RIPPLES — three hairline dashes across it, placed off the tile's
// own coordinates, so the river never reads as one stamp repeated
float ripples(vec2 p, int jit) {
  float a = 0.0;
  for (int i = 0; i < 3; i++) {
    int b = (jit >> (i * 5)) & 31;
    float dy = (float(i) - 1.0) * 0.3 + (float(b) / 31.0 - 0.5) * 0.12;
    float w = 0.2 + (float(b >> 2) / 7.0) * 0.22;
    float dx = (float((jit >> (i * 7 + 3)) & 15) / 15.0 - 0.5) * 0.2;
    a = max(a, line(seg(p, vec2(dx - w, dy), vec2(dx + w, dy)) * u_zoom, u_lineW));
  }
  return a;
}

// THE MOTIFS — the tile patterns of the Moorish south, simplified: each
// tile carries its OWN design, the same in every tile of its kind and drawn
// from its own middle, right out to its edges — built on its corners and edge
// midpoints, or spaced to fit the grid exactly, so the lines one tile brings
// to its border are where its neighbour's begin and a run of one kind reads
// as one continuous field. Each kind wears one.
//   1 ROSETTE: six arcs from the corners through the middle — the seed of life
//   2 BUBBLES: a circle round every corner, all touching at the edges' middles,
//      and one in the middle touching all six
//   3 RINGS: circles on the edges' middles, linking round the tile
//   4 STAR: the six-pointed star through the corners
//   5 STAR LATTICE: the star through the edges' middles — stars and hexagons
//   6 RIBBON: a band curving round alternate corners
//   7 MEANDER: the same band, each tile turning its own way
//   8 SCALES: rows of scallops, level
//   9 WAVES: level wavy lines, close
//   10 HEXAGON: the hexagon on the edges' middles
//   11 SNOWFLAKE: the star through the corners, a ring in its heart
//   12 FINE LATTICE: three ways of lines, close
//   13 DIAMONDS: two ways of lines
//   14 LINES: one way of lines, wide
//   15 FINE LINES: one way of lines, fine
//   16 WEAVE: wavy lines all three ways of the grid, crossing in the middle
// lines along grid direction f, AP/m apart (2m to a tile: a neighbour's
// middle is always a whole number of them away), off of a step from the middle
float family(vec2 p, int f, float m, float off) {
  float sp = AP / m;
  return line(stripes(dot(p, N(f)) - off * sp, sp) * u_zoom, u_lineW);
}
// …and waving: amp high, a wave every len along them
float wavy(vec2 p, vec2 n, float sp, float off, float amp, float len) {
  float u = dot(p, vec2(-n.y, n.x));
  float kw = TAU / len;
  float slope = amp * kw * cos(u * kw);
  return line(stripes(dot(p, n) + amp * sin(u * kw) - off * sp, sp) / sqrt(1.0 + slope * slope) * u_zoom, u_lineW);
}
// the nearest step to a wanted one that fits a whole number of times into a span
float fit(float span, float want) { return span / max(1.0, floor(span / want + 0.5)); }
// THE CURRENT: a river's waves turned to cross it (n, the way it runs out),
// carried downstream by u_drift of their spacing
float currentWaves(vec2 p, vec2 n) { return wavy(p, n, CURRENT_SP, 0.5 + u_drift, 0.035, 0.45); }
float motif(int id, vec2 p) {
  float w = u_lineW;
  float z = u_zoom;
  float a = 0.0;
  if (id == 1) {
    for (int i = 0; i < 6; i++) a = max(a, line((length(p - C(i)) - 1.0) * z, w));
  } else if (id == 2) {
    for (int i = 0; i < 6; i++) a = max(a, line((length(p - C(i)) - 0.5) * z, w));
    a = max(a, line((length(p) - 0.5) * z, w));
  } else if (id == 3) {
    for (int i = 0; i < 6; i++) a = max(a, line((length(p - M(i)) - 0.5) * z, w));
  } else if (id == 4 || id == 11) {
    for (int i = 0; i < 6; i++) a = max(a, line(seg(p, C(i), C((i + 2) % 6)) * z, w));
    if (id == 11) a = max(a, line((length(p) - 0.42) * z, w));
  } else if (id == 5) {
    for (int i = 0; i < 6; i++) a = max(a, line(seg(p, M(i), M((i + 2) % 6)) * z, w));
  } else if (id == 6 || id == 7) {
    // round the even corners — or, meandering, whichever set the tile's roll
    // picks; the strands sit 0.38 and 0.62 along each side from their corner,
    // so a neighbour turning the other way still meets them
    int from = id == 7 && hash(v_c) < 0.5 ? 1 : 0;
    for (int i = 0; i < 6; i++) {
      if ((i & 1) != from) continue;
      float d = length(p - C(i));
      a = max(a, max(line((d - 0.38) * z, w), line((d - 0.62) * z, w)));
    }
  } else if (id == 8) {
    // each row's scallops hang below its line, the next row's in their gaps —
    // sized to the grid's own steps across and down (u_lat), so they meet
    float rr = fit(u_lat.x, 0.44) * 0.5;
    float sy = u_lat.y / (2.0 * max(1.0, floor(u_lat.y / 0.4 + 0.5))); // an EVEN count of rows to the step down, so the alternation lines up
    float k = floor(p.y / sy);
    for (int dk = -2; dk <= 0; dk++) {
      float row = k + float(dk);
      float off = mod(row, 2.0) * rr;
      float j = floor((p.x - off) / (2.0 * rr) + 0.5);
      for (int dj = -1; dj <= 1; dj++) {
        vec2 d = p - vec2((j + float(dj)) * 2.0 * rr + off, row * sy);
        if (d.y >= 0.0) a = max(a, line((length(d) - rr) * z, w));
      }
    }
  } else if (id == 9) {
    // level: across the screen, a whole number of lines to the grid's step
    // down and of waves to its step across, so they run on unbroken
    a = wavy(p, vec2(0.0, 1.0), fit(u_lat.y, 0.18), 0.5, 0.035, fit(u_lat.x, 0.45));
  } else if (id == 10) {
    for (int i = 0; i < 6; i++) a = max(a, line(seg(p, M(i), M((i + 1) % 6)) * z, w));
  } else if (id == 12) {
    a = max(max(family(p, 0, 3.0, 0.5), family(p, 1, 3.0, 0.5)), family(p, 2, 3.0, 0.5));
  } else if (id == 13) {
    a = max(family(p, 0, 2.0, 0.5), family(p, 1, 2.0, 0.5));
  } else if (id == 14) {
    a = family(p, 0, 1.0, 0.5);
  } else if (id == 15) {
    a = family(p, 0, 3.0, 0.5);
  } else if (id == 16) {
    // AP/3 apart through the middle, a wave every half a tile along — the
    // grid's own steps either way, so a neighbour's lines take them up
    for (int f = 0; f < 3; f++) a = max(a, wavy(p, N(f), AP / 3.0, 0.0, 0.045, 0.5));
  }
  return a;
}

void main() {
  int fog = int(v_fog) & 63;
  int shore = (int(v_fog) >> 6) & 63;
  if (u_pass == 1) {
    // THE STREAMS: on the edges this tile shares with found ground, round-capped
    int streams = int(v_meta.z);
    float a = 0.0;
    for (int i = 0; i < 6; i++) {
      if (!bit(streams, i)) continue;
      a = max(a, line(seg(v_p, C(i), C((i + 1) % 6)) * u_zoom, u_streamW));
    }
    if (a > 0.0) { o = vec4(u_stream * a, a); return; }
    // …and THE FOG'S BREATH: past a side that faces the unknown, the edge's
    // tint bleeds out a little way into the fog's own cell, fading as it goes
    float b = 0.0;
    for (int i = 0; i < 6; i++) {
      if (!bit(fog, i) || dot(v_p, N(i)) < AP) continue;
      float t = seg(v_p, C(i), C((i + 1) % 6)) / FOG_OUT;
      if (t < 1.0) b = max(b, 0.05 * (1.0 - t) * (1.0 - t));
    }
    if (b <= 0.0) discard;
    o = vec4(u_fogInk * b, b);
    return;
  }
  // which side's sector the point is in, and how far out (AP at the edge)
  float best = -1e9;
  int sec = 0;
  for (int i = 0; i < 6; i++) {
    float d = dot(v_p, N(i));
    if (d > best) { best = d; sec = i; }
  }
  float cover = clamp((AP - best) * u_zoom + 0.5, 0.0, 1.0);
  if (cover <= 0.0) discard;
  if (u_pass == 2) {
    // THE SEATS — a board centre's own lines: the hairline ring and the thin
    // radials in from its corners, and either the seat's inverted Y, or a
    // figure resting in it: a small paper hex, its cube's three lines inside
    int seat = int(v_tex.w);
    if (seat == 0) discard;
    float ring = line((best - AP) * u_zoom, u_lineW * 0.5);
    float thinOut = 0.0; // the radials
    float thinIn = 0.0;  // the figure's cube lines
    float bold = 0.0;    // the seat's Y
    for (int i = 0; i < 6; i++) {
      vec2 c = C(i);
      if (seat == 1) {
        thinOut = max(thinOut, line(seg(v_p, c, vec2(0.0)) * u_zoom, u_tokenW * 0.2));
        if (i == 1 || i == 3 || i == 5) bold = max(bold, line(seg(v_p, vec2(0.0), c / 3.0) * u_zoom, u_tokenW));
      } else {
        thinOut = max(thinOut, line(seg(v_p, c, c / 3.0) * u_zoom, u_tokenW * 0.2));
        if (i == 0 || i == 2 || i == 4) thinIn = max(thinIn, line(seg(v_p, c / 3.0, vec2(0.0)) * u_zoom, u_tokenW * 0.2));
      }
    }
    float lineA = max(max(ring, thinOut), bold) * cover;
    vec3 rgb = u_ink * lineA;
    float alpha = lineA;
    if (seat == 2) {
      // the figure's paper and outline over the radials (its edge at a third of the tile's)
      float edge = (best - AP / 3.0) * u_zoom;
      float outline = line(edge, u_tokenW);
      float aP = max(clamp(0.5 - edge, 0.0, 1.0), outline);
      vec3 cP = mix(u_paper, u_ink, max(outline, edge < 0.0 ? thinIn : 0.0));
      rgb = cP * aP + rgb * (1.0 - aP);
      alpha = aP + alpha * (1.0 - aP);
    }
    if (alpha <= 0.0) discard;
    o = vec4(rgb, alpha);
    return;
  }
  vec3 col = v_fill.a > 0.0 ? v_fill.rgb : u_ground;
  // THE SHORE BAND: the tile's outer two rows (past SHORE_IN) run into each found
  // neighbour's ground, weighed by how far out toward that side the point lies
  // against the tile's own at 1 — so two tiles meet half and half along their
  // edge, and three at a corner a third each
  vec3 sum = col;
  float wsum = 1.0;
  for (int i = 0; i < 6; i++) {
    float c = ncOf(i);
    if (c > -1.5 && c < -0.5) continue;
    float w = clamp((dot(v_p, N(i)) - AP * SHORE_IN) / (AP * (1.0 - SHORE_IN)), 0.0, 1.0);
    if (w <= 0.0) continue;
    sum += (c < 0.0 ? u_ground : unpackRgb(c)) * w;
    wsum += w;
  }
  col = sum / wsum;
  // THE KIND'S TEXTURE, in one shade of its own colour — a river with a
  // current wears the waves across it, drifting; textures off, the river keeps
  // its own three ripples
  int kind = int(v_tex.x);
  int flow = int(v_flow);
  if (kind > 0 && u_textures > 0.5) col = mix(col, col * (1.0 - u_texA), kind == 2 && flow > 0 ? currentWaves(v_p, N(flow - 1)) : motif(u_motif[kind], v_p));
  else if (kind == 2) col = mix(col, u_ripple, 0.55 * ripples(v_p, int(v_tex.y)));
  // THE SHORE: a light line along the water's edge where it meets the land
  if (shore > 0) {
    float sw = u_lineW * 1.5;
    float a = 0.0;
    for (int i = 0; i < 6; i++) {
      if (!bit(shore, i)) continue;
      a = max(a, line(seg(v_p, C(i), C((i + 1) % 6)) * u_zoom - sw * 0.5, sw));
    }
    col = mix(col, mix(col, vec3(1.0), 0.7), a);
  }
  // HOME'S RULE: the chart's black cell border, just inside the edge
  if (v_meta.w > 0.5) col = mix(col, vec3(0.0), line((AP - best) * u_zoom - u_lineW * 0.5, u_lineW));
  int n = int(v_meta.x);
  int walls = int(v_meta.y);
  // THE CONTOURS: ring k on side i where the same-kind neighbour there stops
  // short of k; running on into a neighbouring side's sector where that side
  // lets the level through, so the line meets the next tile's
  for (int k = 1; k <= 4; k++) {
    if (k > n) break;
    float s = v_rings[k - 1];
    float a = 0.0;
    for (int i = 0; i < 6; i++) {
      if (nbOf(i) >= float(k)) continue;
      int l = (i + 5) % 6;
      int r = (i + 1) % 6;
      bool here = sec == i || (sec == l && nbOf(l) >= float(k)) || (sec == r && nbOf(r) >= float(k));
      if (here) a = max(a, line((dot(v_p, N(i)) - AP * s) * u_zoom, u_lineW));
    }
    col = mix(col, vec3(0.0), 0.2 * a);
  }
  // THE FOG EATS THE RIM: along a side facing the unknown, the fog's own edge
  // colour, full at the edge and gone FOG_IN deep — the frontier dissolves
  float f = 0.0;
  for (int i = 0; i < 6; i++) {
    if (!bit(fog, i)) continue;
    float t = seg(v_p, C(i), C((i + 1) % 6)) / u_fogIn;
    if (t < 1.0) f = max(f, (1.0 - t) * (1.0 - t));
  }
  col = mix(col, u_fogEdge, f);
  // THE WALLS: each side's inset edge, carried on to the tile's boundary where
  // the next side has no wall to meet it — the sun's shadow under them first
  if (walls > 0) {
    vec2 sp = v_p - u_shadow.xy / u_zoom; // where the wall casting onto this point stands
    float sBest = -1e9;
    int ssec = 0;
    for (int i = 0; i < 6; i++) {
      float d = dot(sp, N(i));
      if (d > sBest) { sBest = d; ssec = i; }
    }
    float sa = 0.0;
    float wa = 0.0;
    for (int i = 0; i < 6; i++) {
      if (!bit(walls, i)) continue;
      int l = (i + 5) % 6;
      int r = (i + 1) % 6;
      bool here = sec == i || (sec == l && !bit(walls, l)) || (sec == r && !bit(walls, r));
      if (here) wa = max(wa, line((dot(v_p, N(i)) - AP * u_inset) * u_zoom, u_wallW));
      bool shere = ssec == i || (ssec == l && !bit(walls, l)) || (ssec == r && !bit(walls, r));
      if (shere && u_shadow.w > 0.5) sa = max(sa, soft((dot(sp, N(i)) - AP * u_inset) * u_zoom, u_wallW, u_shadow.z));
    }
    col = mix(col, u_shadowCol, 0.65 * sa);
    col = mix(col, u_ink, wa);
  }
  // THE REGROW CLOCK on a tile you've gathered: a faint socket, and an arc
  // filling clockwise from the top as the patch grows back — whole once ready
  float rg = v_tex.z;
  if (rg >= 0.0) {
    float ring = line((length(v_p) - 0.28) * u_zoom, u_ringW);
    float t = fract(atan(v_p.y, v_p.x) / TAU + 0.25); // 0 at the top, clockwise
    bool on = rg >= 2.0 || t <= max(0.02, rg);
    col = mix(col, u_ink, ring * (on ? (rg >= 2.0 ? 0.8 : 0.45) : 0.15));
  }
  o = vec4(col * cover, cover);
}`

function shader(gl, type, src) {
  const s = gl.createShader(type)
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s))
  return s
}

// THE RENDERER, on a canvas of its own: setTiles() once per world change, then
// draw() per frame with the camera — nothing in between is re-sent
export function createHexMap(canvas) {
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: false })
  if (!gl) return null
  const prog = gl.createProgram()
  gl.attachShader(prog, shader(gl, gl.VERTEX_SHADER, VS))
  gl.attachShader(prog, shader(gl, gl.FRAGMENT_SHADER, fragment()))
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog))
  const U = {}
  for (const u of [
    "u_cam", "u_zoom", "u_view", "u_pad", "u_a0", "u_inset", "u_wallW", "u_lineW", "u_streamW", "u_ringW", "u_tokenW",
    "u_ground", "u_ink", "u_paper", "u_stream", "u_ripple", "u_fogInk", "u_fogEdge", "u_shadow", "u_shadowCol", "u_textures", "u_motif",
    "u_texA", "u_lat", "u_pass", "u_fogIn", "u_drift"
  ])
    U[u] = gl.getUniformLocation(prog, u)

  const quad = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const aCorner = gl.getAttribLocation(prog, "a_corner")
  // THE TILES: their numbers on the GPU, and the vertex array that reads them
  const ATTRS = [["a_pos", 2], ["a_fill", 4], ["a_rings", 4], ["a_meta", 4], ["a_nb0", 3], ["a_nb1", 3], ["a_tex", 4], ["a_fog", 1], ["a_flow", 1], ["a_nc0", 3], ["a_nc1", 3]]
  function tileSet() {
    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.enableVertexAttribArray(aCorner)
    gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 0, 0)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    let off = 0
    for (const [name, size] of ATTRS) {
      const loc = gl.getAttribLocation(prog, name)
      if (loc >= 0) {
        gl.enableVertexAttribArray(loc)
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, off * 4)
        gl.vertexAttribDivisor(loc, 1)
      }
      off += size
    }
    gl.bindVertexArray(null)
    const set = {
      vao,
      count: 0,
      currents: [], // the middles of the river tiles with a current, x and y in turn
      set({ data, count }) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buf)
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW)
        set.count = count
        set.currents = []
        for (let i = 0; i < count; i++) if (data[i * STRIDE + 25] > 0) set.currents.push(data[i * STRIDE], data[i * STRIDE + 1])
      }
    }
    return set
  }
  const map = tileSet()
  const rgb = css => rgba(css).slice(0, 3)

  return {
    gl,
    setTiles: tiles => map.set(tiles),
    // is a river with a current anywhere in this view (cam and zoom as draw takes them)?
    currentInView({ cam, zoom, width, height }) {
      const hw = width / zoom / 2 + 1
      const hh = height / zoom / 2 + 1
      const c = map.currents
      for (let i = 0; i < c.length; i += 2) if (Math.abs(c[i] - cam.x) < hw && Math.abs(c[i + 1] - cam.y) < hh) return true
      return false
    },
    // cam: the world point (tile radii) at the viewport's centre; zoom: px per
    // tile radius; unit: the tile's radius at 1:1 (the game's own size, where
    // every line is its canvas width); width/height: css px; startDeg: the
    // lattice's corner angle; colours as css strings — fog: { ink, surface },
    // the night pair the fog is painted in; shadow: { dx, dy, color }, the
    // sun's offset at 1:1 in px (sunShadow), or null by night; textures: the
    // kinds' motifs on or off; motifs: each kind's motif (KINDS → MOTIFS);
    // textureStrength: how dark their lines are, of the tile's own colour;
    // seats: the board centres' seats and figures, or none (the game draws its own);
    // drift: seconds of current shown so far — the rivers' waves stand still at 0
    draw({ cam, zoom, unit = zoom, width, height, dpr = 1, startDeg, ground, ink, paper = ground, stream = WATER, ripple, fog, shadow = null, textures = true, motifs = DEFAULT_MOTIFS, textureStrength = DEFAULT_STRENGTH, seats = true, drift = 0 }) {
      const W = Math.round(width * dpr)
      const H = Math.round(height * dpr)
      if (canvas.width !== W || canvas.height !== H) (canvas.width = W), (canvas.height = H)
      gl.viewport(0, 0, W, H)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      const count = map.count
      if (!count) return
      gl.useProgram(prog)
      gl.bindVertexArray(map.vao)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      const z = zoom * dpr // the shader works in device pixels
      const k = (zoom / unit) * dpr // a 1:1 css px, at this zoom, in device px
      const streamW = Math.max(STREAM_MIN_PX, unit * STREAM_W) * k
      gl.uniform2f(U.u_cam, cam.x, cam.y)
      gl.uniform1f(U.u_zoom, z)
      gl.uniform2f(U.u_view, W, H)
      gl.uniform1f(U.u_a0, ((startDeg + 30) * Math.PI) / 180)
      gl.uniform1f(U.u_inset, 1 - (WALL_PX / unit + 2 * WALL_GAP) / Math.sqrt(3)) // the canvas inset at 1:1, held as a share
      gl.uniform1f(U.u_wallW, WALL_PX * k)
      gl.uniform1f(U.u_lineW, CONTOUR_PX * k)
      gl.uniform1f(U.u_streamW, streamW)
      gl.uniform1f(U.u_fogIn, FOG_IN) // the shore, at every zoom: an unfound side's shore is the fog's
      gl.uniform1f(U.u_ringW, REGROW_PX * k)
      gl.uniform1f(U.u_tokenW, Math.max(1.5, unit * TOKEN_PX) * k)
      gl.uniform3fv(U.u_ground, rgb(ground))
      gl.uniform3fv(U.u_ink, rgb(ink))
      gl.uniform3fv(U.u_paper, rgb(paper))
      gl.uniform3fv(U.u_stream, rgb(stream))
      gl.uniform3fv(U.u_ripple, rgb(ripple))
      const fi = rgb(fog.ink)
      const fs = rgb(fog.surface)
      gl.uniform3fv(U.u_fogInk, fi)
      gl.uniform3fv(U.u_fogEdge, fs.map((v, i) => v + (fi[i] - v) * 0.05)) // the fog's coat, a breath of its ink
      gl.uniform4f(U.u_shadow, shadow ? shadow.dx * k : 0, shadow ? shadow.dy * k : 0, SHADOW_BLUR_PX * k, shadow ? 1 : 0)
      gl.uniform3fv(U.u_shadowCol, rgb(shadow?.color || "#000"))
      gl.uniform1f(U.u_textures, textures ? 1 : 0)
      gl.uniform1iv(U.u_motif, Int32Array.from({ length: 10 }, (_, i) => motifs[i] || 0))
      gl.uniform1f(U.u_texA, textureStrength)
      gl.uniform1f(U.u_drift, ((drift * CURRENT_SPEED) / CURRENT_SP) % 1)
      // the grid's steps between tile middles: pointy rows sit 1.5 apart and
      // shift AP across; flat columns sit 1.5 apart and shift AP down
      const pointy = (((startDeg % 60) + 60) % 60) === 30
      gl.uniform2f(U.u_lat, pointy ? Math.sqrt(3) / 2 : 1.5, pointy ? 1.5 : Math.sqrt(3) / 2)
      // the tiles; then the streams and the fog's breath, reaching past their
      // corners; then the seats
      gl.uniform1f(U.u_pad, 1 / z)
      gl.uniform1i(U.u_pass, 0)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)
      gl.uniform1f(U.u_pad, FOG_OUT + (streamW * 0.5 + 1) / z)
      gl.uniform1i(U.u_pass, 1)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)
      gl.uniform1f(U.u_pad, 1 / z)
      if (seats) {
        gl.uniform1i(U.u_pass, 2)
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)
      }
      gl.bindVertexArray(null)
    }
  }
}

// THE SUN'S SHADOW for draw(), off clock.js's sunState: its direction and
// length (px at 1:1) and the season's own hue — none by night
export const sunShadow = s =>
  s.isNight ? null : { dx: -Math.sin(s.sunRad) * s.sunLen, dy: Math.cos(s.sunRad) * s.sunLen, color: `hsl(${s.sunDeg} 55% 32%)` }
