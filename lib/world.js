// The world: a fractal tree of tiles (purely spatial; time lives in the sim's clock).
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
  // A node is a BOARD's own properties — never its tiles' state, which lives in
  // the sim's ground store, one per depth, keyed by global coord.
  //
  // children: keyed "q,r" → child tile (lazy). safe: the energy constraint is
  // lifted inside. gate: {k, side} — the single doorstep edge (k a GLOBAL tile
  // key) that opens in the board's walls; gateOpen ratchets once the whole
  // board is discovered and you stand on the doorstep. reachedEdges: which of
  // the board's 6 edges the player has physically stood at (stepped on a
  // bordering tile) — a permanent ratchet.
  return {
    children: {},
    reachedEdges: new Set(),
    safe: false,
    gate: null,
    gateOpen: false
  }
}

export function childAt(tile, hexKey) {
  if (!tile.children[hexKey]) tile.children[hexKey] = makeTile()
  return tile.children[hexKey]
}
