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
  // props: reusable per-tile properties that alter how the tile behaves — `safe`
  // (energy constraint lifted inside), `walls` (Set of parent-DIR indices that are
  // sealed — no neighbour/exit that way). Any tile can carry these; more (items,
  // special pieces…) slot in here too.
  //
  // reachedEdges: which of this tile's 6 edges the player has physically stood at
  // (stepped on a bordering tile) — a permanent ratchet, like discovered. Edge tiles
  // only appear once reached, not merely once a border tile is scouted from afar.
  return { children: {}, discovered: new Set(), reachedEdges: new Set(), safe: false, walls: null }
}

export function childAt(tile, hexKey) {
  if (!tile.children[hexKey]) tile.children[hexKey] = makeTile()
  return tile.children[hexKey]
}
