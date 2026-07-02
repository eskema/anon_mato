// The world: a fractal tree of tiles (purely spatial; time lives in the timeline).
//
// Each tile can contain a child tile per hex of its grid, created lazily on
// first entry so re-entering the same tile is the same place. Navigation (which
// tile you're in, the player's position, the trail) is managed by the grid
// screen as a stack of views.

// Axial offsets of the 6 pointy-top neighbors.
export const DIRS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 }
]

// Opposite neighbor direction.
export const opposite = i => (i + 3) % 6

export function makeTile() {
  // children: keyed "q,r" → child tile (lazy). discovered: hexes explored/stepped
  // on — persists, so a re-entered tile shows its known interior (and its parent
  // can later render those discovered hexes shrunk inside).
  //
  // props: reusable per-tile properties that alter how the tile behaves —
  // `safe` (energy constraint lifted inside), `walls` (true = the board is
  // sealed along its whole seam ring), `gate` (global seam key of the single
  // opening in those walls), `gateOpen` (the gate ratchets open once the whole
  // board is discovered). Any tile can carry these; more (items, special
  // pieces…) slot in here too.
  //
  // reachedEdges: which of this tile's 6 edges the player has physically stood at
  // (stepped on a bordering tile) — a permanent ratchet, like discovered.
  //
  // types: sparse per-hex tile types ("q,r" → type name; absent = plain). Types
  // carry gameplay properties — for now just cost multipliers (see TILE_TYPES
  // in sim.js, all 1 today); terrain and specials slot in here later.
  //
  // seamDiscovered/seamTypes: the SEAM tiles between this tile's children (the
  // one-hex-thick rows separating sibling boards — this grid's edges made of
  // child-scale tiles). Keyed by GLOBAL child-scale coords so both boards of an
  // edge read the same tile; discovery here is the same one-way ratchet.
  return {
    children: {},
    discovered: new Set(),
    reachedEdges: new Set(),
    safe: false,
    walls: null,
    gate: null,
    gateOpen: false,
    types: {},
    seamDiscovered: new Set(),
    seamTypes: {}
  }
}

export function childAt(tile, hexKey) {
  if (!tile.children[hexKey]) tile.children[hexKey] = makeTile()
  return tile.children[hexKey]
}
