// The globe — the world's true shape, and how it lies flat.
//
// Seventy-two boards close into a sphere as the chiral Goldberg polyhedron
// GP(2,1): 60 hexagons and the 12 pentagons a hex grid must pay to close, at the
// corners of an icosahedron. Every hexagon touches exactly one pentagon, so the
// globe is twelve flowers of six. Built once as the dual of the (2,1) geodesic
// subdivision; pure geometry, no sim state.
//
// The world is PLAYED FLAT: netFor(angle) cuts the globe along its rivers and
// lays every board on the parent lattice, home at the origin, each pentagon a
// hexagon with one 60° wedge missing. The cut is the angle's: it seeds which of
// two boards claims a contested neighbour (and so which bank of a tear that
// board hangs on) and turns the map so home's pentagon sits across the gate.
// Torn rivers are the rim: one bank here, its twin somewhere else on the map.

import { DIRS } from "./world.js"

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = v => mul(v, 1 / Math.hypot(v[0], v[1], v[2]))
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

let cached = null
export function globe() {
  if (cached) return cached
  const phi = (1 + Math.sqrt(5)) / 2
  const raw = []
  for (const a of [-1, 1]) for (const b of [-1, 1]) raw.push([0, a, b * phi], [a, b * phi, 0], [b * phi, 0, a])
  const ico = raw.map(norm)
  let edge = Infinity
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) edge = Math.min(edge, dist(ico[i], ico[j]))
  const near = (a, b) => Math.abs(dist(a, b) - edge) < 1e-6
  const icoFaces = []
  for (let i = 0; i < 12; i++)
    for (let j = i + 1; j < 12; j++)
      for (let k = j + 1; k < 12; k++) {
        if (near(ico[i], ico[j]) && near(ico[j], ico[k]) && near(ico[i], ico[k])) {
          const n = cross(sub(ico[j], ico[i]), sub(ico[k], ico[i]))
          icoFaces.push(dot(n, ico[i]) > 0 ? [i, j, k] : [i, k, j]) // counter-clockwise seen from outside
        }
      }
  // the (2,1) lattice on every face: A→(0,0), B→(2,1), C→(−1,3); keep the strictly interior points
  const verts = ico.map(v => v.slice())
  for (const [a, b, c] of icoFaces) {
    const A = ico[a], AB = sub(ico[b], A), AC = sub(ico[c], A)
    const U = mul(sub(mul(AB, 3), AC), 1 / 7)
    const V = sub(AB, mul(U, 2))
    const g11 = dot(AB, AB), g12 = dot(AB, AC), g22 = dot(AC, AC), det = g11 * g22 - g12 * g12
    for (let q = -4; q <= 5; q++)
      for (let r = -4; r <= 5; r++) {
        const w = add(mul(U, q), mul(V, r))
        const b1 = dot(w, AB), b2 = dot(w, AC)
        const beta = (b1 * g22 - b2 * g12) / det, gamma = (g11 * b2 - g12 * b1) / det
        if (beta > 1e-9 && gamma > 1e-9 && 1 - beta - gamma > 1e-9) verts.push(norm(add(A, w)))
      }
  }
  // convex hull by brute force (72 points): every triple whose plane has all others on one side
  const n = verts.length
  const tris = []
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++) {
        const nrm = cross(sub(verts[j], verts[i]), sub(verts[k], verts[i]))
        const d0 = dot(nrm, verts[i])
        let pos = 0, neg = 0
        for (let m = 0; m < n && !(pos && neg); m++) {
          if (m === i || m === j || m === k) continue
          const s = dot(nrm, verts[m]) - d0
          if (s > 1e-9) pos++
          else if (s < -1e-9) neg++
        }
        if (pos && neg) continue
        tris.push(dot(nrm, verts[i]) > 0 ? [i, j, k] : [i, k, j])
      }
  const cents = tris.map(t => norm(add(add(verts[t[0]], verts[t[1]]), verts[t[2]])))
  const incident = Array.from({ length: n }, () => [])
  tris.forEach((t, ti) => t.forEach(v => incident[v].push(ti)))
  // a face per vertex: its junctions (triangle centroids) in counter-clockwise
  // order, and the neighbour across each edge
  const faces = verts.map((v, vi) => {
    const ref = Math.abs(v[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
    const e1 = norm(cross(v, ref)), e2 = cross(v, e1)
    const ring = incident[vi]
      .map(ti => ({ ti, ang: Math.atan2(dot(sub(cents[ti], v), e2), dot(sub(cents[ti], v), e1)) }))
      .sort((p, q) => p.ang - q.ang)
      .map(r => r.ti)
    const nbr = ring.map((t1, k) => {
      const t2 = ring[(k + 1) % ring.length]
      return tris[t1].find(u => u !== vi && tris[t2].includes(u))
    })
    return { c: v, sides: ring.length, ring, nbr, poly: ring.map(ti => cents[ti]) }
  })
  cached = { faces, tris, junctions: cents }
  return cached
}

// mulberry32 — a small deterministic generator for the cut
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Slots round a flat board, 60° apart, counter-clockwise from slot 0.
const slotDir = Array.from({ length: 6 }, (_, s) => [Math.cos((s * Math.PI) / 3), Math.sin((s * Math.PI) / 3)])
const flatKey = p => p.map(v => Math.round(v * 100)).join(",")

// Unfold the globe along its rivers onto a flat board lattice, layer by layer
// from home, so every board sits at its true crossing distance. A pentagon's
// gap starts opposite the board it was entered from; the seed shuffles each
// layer's claims (which of two boards places a contested neighbour). Once
// everything is placed, each pentagon's wedge is turned onto a side with no
// board on it, the parent's river fixed, keeping the most rivers whole.
export function unfold(G, home, seed = 0) {
  const F = G.faces
  const rnd = rng(seed)
  const place = new Array(F.length).fill(null)
  const occ = new Map()
  const put = (i, pos, slotOf, gap, parent) => {
    place[i] = { pos, slotOf, gap, parent }
    occ.set(flatKey(pos), i)
  }
  put(home, [0, 0], [0, 1, 2, 3, 4, 5], null, -1)
  const claim = (i, k) => {
    const P = place[i], j = F[i].nbr[k], s = P.slotOf[k]
    if (place[j] || s == null) return false
    const pos = [P.pos[0] + slotDir[s][0], P.pos[1] + slotDir[s][1]]
    if (occ.has(flatKey(pos))) return false
    const kin = F[j].nbr.indexOf(i), sin = (s + 3) % 6, m = F[j].sides
    const slotOf = new Array(m).fill(null)
    let gap = null
    if (m === 6) for (let d = 0; d < 6; d++) slotOf[(kin + d) % 6] = (sin + d) % 6
    else {
      for (let u = 0; u < 5; u++) slotOf[(kin + u) % 5] = (sin + u + (u >= 3 ? 1 : 0)) % 6
      gap = (sin + 3) % 6
    }
    put(j, pos, slotOf, gap, i)
    return true
  }
  let layer = [home]
  while (layer.length) {
    const cands = []
    for (const i of layer) for (let k = 0; k < F[i].sides; k++) cands.push({ i, k, r: seed ? rnd() : 0 })
    cands.sort((a, b) => a.r - b.r)
    const next = []
    for (const c of cands) if (claim(c.i, c.k)) next.push(F[c.i].nbr[c.k])
    layer = next
  }
  const whole = (i, k, s) => {
    const j = F[i].nbr[k]
    if (!place[j]) return false
    const want = [place[i].pos[0] + slotDir[s][0], place[i].pos[1] + slotDir[s][1]]
    return flatKey(want) === flatKey(place[j].pos) && place[j].slotOf[F[j].nbr.indexOf(i)] === (s + 3) % 6
  }
  place.forEach((P, i) => {
    if (!P || P.gap == null) return
    const kin = F[i].nbr.indexOf(P.parent), sin = P.slotOf[kin]
    let pick = null
    for (const d of [3, 2, 4, 1, 5]) {
      const slotOf = new Array(5).fill(null)
      for (let u = 0; u < 5; u++) slotOf[(kin + u) % 5] = (sin + u + (u >= d ? 1 : 0)) % 6
      const gap = (sin + d) % 6
      const empty = !occ.has(flatKey([P.pos[0] + slotDir[gap][0], P.pos[1] + slotDir[gap][1]]))
      let kept = 0
      for (let k = 0; k < 5; k++) if (whole(i, k, slotOf[k])) kept++
      const score = (empty ? 100 : 0) + kept
      if (!pick || score > pick.score) pick = { score, slotOf, gap }
    }
    P.slotOf = pick.slotOf
    P.gap = pick.gap
  })
  const intact = F.map((f, i) => f.ring.map((_, k) => place[i] && place[i].slotOf[k] != null && whole(i, k, place[i].slotOf[k])))
  return { place, intact, ok: place.every(Boolean) }
}

// The flat world for an angle: every board's parent cell, its side count,
// for a pentagon the parent DIR its wedge faces, which of its edges carry a
// river on the map, and `across`: per parent DIR, the cell of the board that
// is its neighbour over that side on the globe (null at the wedge) — wherever
// the map laid it. `gateDir` is the parent DIR the home gate opens onto —
// home's pentagon goes there. Boards come in crossing order from home (the
// deal order for anything dealt per board).
//
// A TORN RIVER KEEPS ONE BANK: a river whose two boards lie apart on the map
// has its tiles on the bank nearer home (on a tie, the bank dealt first); the
// other bank is bare, void beyond its border. So no river is ever doubled.
export function netFor(angle, gateDir) {
  const G = globe()
  const F = G.faces
  const home = F.findIndex(f => f.sides === 6)
  const U = unfold(G, home, angle)
  const P = F[home].nbr.find(j => F[j].sides === 5)
  const sp = slotDir.findIndex(d => flatKey(d) === flatKey(U.place[P].pos))
  const dirOf = s => (((s - sp + gateDir) % 6) + 6) % 6
  // flat position = a·slot0 + b·slot1 → parent cell = a·DIRS[dirOf(0)] + b·DIRS[dirOf(1)]
  const d0 = DIRS[dirOf(0)], d1 = DIRS[dirOf(1)]
  const cellOf = pos => {
    const b = Math.round(pos[1] / slotDir[1][1])
    const a = Math.round(pos[0] - b * slotDir[1][0])
    return [a * d0.q + b * d1.q || 0, a * d0.r + b * d1.r || 0]
  }
  const hops = new Array(F.length).fill(-1)
  const hopOf = i => (hops[i] >= 0 ? hops[i] : (hops[i] = U.place[i].parent < 0 ? 0 : 1 + hopOf(U.place[i].parent)))
  F.forEach((_, i) => hopOf(i))
  const boards = new Map()
  const byHop = F.map((_, i) => i).sort((x, y) => hops[x] - hops[y] || x - y)
  const dealt = new Map(byHop.map((i, n) => [i, n]))
  for (const i of byHop) {
    const p = U.place[i]
    const c = cellOf(p.pos)
    let rivers = 0
    const across = new Array(6).fill(null)
    F[i].nbr.forEach((j, k) => {
      const s = p.slotOf[k]
      if (s == null) return // the wedge: no river there
      across[dirOf(s)] = cellOf(U.place[j].pos)
      const keeps = U.intact[i][k] || hops[i] < hops[j] || (hops[i] === hops[j] && dealt.get(i) < dealt.get(j))
      if (keeps) rivers |= 1 << dirOf(s)
    })
    boards.set(`${c[0]},${c[1]}`, { c, sides: F[i].sides, gapDir: p.gap == null ? null : dirOf(p.gap), rivers, across, face: i, hops: hops[i] })
  }
  return { boards, order: byHop.map(i => boards.get(`${cellOf(U.place[i].pos)[0]},${cellOf(U.place[i].pos)[1]}`).c) }
}
