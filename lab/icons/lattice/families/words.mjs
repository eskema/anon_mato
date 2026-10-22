import * as L from "../lat.mjs"
import fs from "node:fs"
export const family = "words"

// ── a tiny iso-kufic pen, in triangle coords (strip k, row h) ──
// k+h odd → ▶ ; even → ◀
const warn = m => process.stderr.write("words: " + m + "\n")
const par = n => ((n % 2) + 2) % 2
const st = (k, t, b) => { const o = []; for (let h = t; h <= b; h++) o.push([k, h]); return o }
// down-right band: strips k..k+n-1, ▶ on top at (k,h)
const dr = (k, h, n = 1) => {
  if (par(k + h) !== 1) { warn(`dr(${k},${h}) parity → ${h + 1}`); h++ }
  const o = []; for (let i = 0; i < n; i++) o.push([k + i, h + i], [k + i, h + i + 1]); return o
}
// up-right band: strips k..k+n-1, ◀ on top at (k,h)
const ur = (k, h, n = 1) => {
  if (par(k + h) !== 0) { warn(`ur(${k},${h}) parity → ${h + 1}`); h++ }
  const o = []; for (let i = 0; i < n; i++) o.push([k + i, h - i], [k + i, h - i + 1]); return o
}
// hexagon O: stems k and k+w-1 (w even), stem rows t..b, (k+t) and (k+b) even
const fixTB = (k, t, b, who) => {
  if (par(k + t)) { warn(`${who}(${k}) top ${t} → ${t + 1}`); t++ }
  if (par(k + b)) { warn(`${who}(${k}) bottom ${b} → ${b - 1}`); b-- }
  return [t, b]
}
const hexO = (k, w, t, b) => {
  ;[t, b] = fixTB(k, t, b, "hexO")
  const n = w / 2 - 1
  return [...st(k, t, b), ...st(k + w - 1, t, b), ...ur(k + 1, t - 1, n), ...dr(k + w / 2, t - n, n), ...dr(k + 1, b, n), ...ur(k + w / 2, b + n - 1, n)]
}
// hex arch (∩ with a peak): top half of hexO
const arch = (k, w, t, b) => {
  ;[t, b] = fixTB(k, t, b, "arch")
  const n = w / 2 - 1
  return [...st(k, t, b), ...st(k + w - 1, t, b), ...ur(k + 1, t - 1, n), ...dr(k + w / 2, t - n, n)]
}
// the solid mini hex: six triangles round lattice vertex (c, v)
const dot = (c, v) => [[c - 1, v - 1], [c - 1, v], [c - 1, v + 1], [c, v - 1], [c, v], [c, v + 1]]
// K after the user's COOK: stem k, upper arm k+2 (t2..m), pinched link (k+1, m), lower arm k+2 (m+2..b2)
const Kx = (k, t, b, m, t2, b2) => [...st(k, t, b), ...st(k + 2, t2, m), [k + 1, m], ...st(k + 2, m + 2, b2)]
// E: stem k (t..b, ▶ on top) with three 2-strip arms falling from it (top, m, bottom)
const Ex = (k, t, m, b) => {
  if (par(k + t) !== 1) warn(`E(${k}) top ${t} parity`)
  return [...st(k, t, b), ...dr(k + 1, t + 1, 2), ...dr(k + 1, m, 2), ...dr(k + 1, b, 2)]
}
// M: bar across strips k..k+4 (dir "ur" rising / "dr" falling, top at (k,h0)), stems at k, k+2, k+4 down to bs[i]
const Mx = (k, h0, bs, dir = "ur") => {
  const bar = dir === "ur" ? ur(k, h0, 5) : dr(k, h0, 5)
  const top = i => Math.min(...bar.filter(([kk]) => kk === k + i).map(([, h]) => h))
  return [...bar, ...st(k, top(0), bs[0]), ...st(k + 2, top(2), bs[1]), ...st(k + 4, top(4), bs[2])]
}
const mk = (...parts) => L.icon().set(parts.flat())
const TRI = id => L.TRIS.find(q => q.id === id)
const HAND = JSON.parse(fs.readFileSync(new URL("../hand.json", import.meta.url)))
// the user's own strokes: every triangle of a hand icon as [k, h], optionally filtered
const hand = (key, keep = () => true) => { const out = []; for (const id of HAND[key].fill) { const t = TRI(id); if (keep(t.k, t.h)) out.push([t.k, t.h]) } return out }
// SLEEP's S, verbatim (strips -7..-5)
const S0 = () => hand("sleep", k => k <= -5)
// COOK's C, verbatim (strips -7..-5)
const C0 = () => hand("cook", k => k <= -5)
// SLEEP's S drawn taller (strips -7..-5, rows a..b+1): top hook, pinched ◆ cap, upper stem,
// spine falling at row -1, lower stem, bottom cap, tail
const Stall = (a = -10, b = 8, tail = 3) => [
  ...st(-5, a, a + 4), [-7, a + 1], [-6, a + 1], ...st(-7, a + 1, -1), ...dr(-6, -1, 1),
  ...st(-5, 0, b), ...ur(-6, b, 1), ...st(-7, tail, b + 1)]

export const icons = {
  "scout:word": {
    title: "LOOK",
    concept: "LOOK: the two O's sit side by side as a pair of lashed eyes sharing one wall, and the L's foot and the K's leg sweep round beneath them as one lower lid",
    draw() {
      const Lf = [...st(-7, -8, 5), ...dr(-6, 5, 7)]
      const O1 = hexO(-5, 4, -7, 1)
      const O2 = hexO(-2, 4, -6, 2)
      const K = [...st(4, -9, 4), ...st(6, -6, -1), [5, -1], ...st(6, 1, 6), ...ur(1, 11, 5)]
      const lash = [[-5, -9], [-4, -10], [-3, -10], [-2, -9], [-1, -8], [0, -9], [1, -9], [2, -8]]
      return mk(Lf, O1, O2, K, lash)
    }
  },
  "gather:word": {
    title: "PICK",
    concept: "PICK: the dot of the i is a berry on a stalk, waiting to be picked; the i's foot tucks under the C",
    draw() {
      const P = [...hexO(-7, 4, -7, -1), ...st(-7, 0, 8)]
      const I = [...st(-2, -8, 8), ...dr(-2, 9, 3), [-1, -9], [-1, -8], [0, -9], ...dot(1, -11)]
      const C = [...st(0, -6, 8), [1, -7], ...st(2, -7, -4), [1, 9], ...st(2, 5, 9)]
      const K = Kx(4, -9, 9, -1, -6, 7)
      return mk(P, I, C, K)
    }
  },
  "craft:word": {
    title: "MAKE",
    concept: "MAKE is one chain of shared strokes: the M's roof rises into the A, and the A's leg is the K's stem, the way craft joins parts",
    draw() {
      const M = [...ur(-7, -5, 4), ...st(-7, -5, 6), ...st(-5, -7, 8), ...st(-3, -9, 10)]
      const A = [...ur(-2, -10, 1), ...dr(-1, -10, 1), ...st(0, -9, 11), ...ur(-2, -4, 1), ...dr(-1, -4, 1)]
      const K = [...st(2, -6, -1), [1, -1], ...st(2, 1, 8)]
      const E = Ex(4, -9, -2, 6)
      return mk(M, A, K, E)
    }
  },
  "trade:word": {
    title: "SWAP",
    concept: "SWAP: the W runs down and the A runs up on one shared stroke, the hand-off in the middle of a trade",
    draw() {
      const W = [...dr(-3, 6, 5), ...st(-3, -7, 7), ...st(-1, -7, 9), ...st(1, -9, 11)]
      const A = [...ur(2, -10, 1), ...dr(3, -10, 1), ...st(4, -9, 9), ...ur(2, -2, 1), ...dr(3, -2, 1)]
      const P = [...dr(5, -8, 1), ...st(6, -7, -4), ...ur(5, -3, 1)]
      return mk(S0(), W, A, P)
    }
  },
  "raft:word": {
    title: "RAFT",
    concept: "RAFT stands on the deck of the user's own raft hull, sawtooth waterline included; the R's stem runs on down as the hull's wall, and F and T share one bar",
    draw() {
      const hull = hand("raft")
      const R = [...st(-7, -7, 2), ...dr(-6, -7, 1), ...st(-5, -6, -2), ...ur(-6, -2, 1), ...st(-5, 0, 2)]
      const A = [...st(-3, -9, 2), ...st(0, -9, 2), ...ur(-2, -10, 1), ...dr(-1, -10, 1), ...ur(-2, -4, 1), ...dr(-1, -4, 1)]
      const FT = [...st(2, -10, 2), ...dr(3, -10, 4), ...dr(3, -4, 1), ...st(5, -7, 2)]
      return mk(R, A, FT, hull)
    }
  },
  "home:word": {
    title: "HOME",
    concept: "HOME: the O is the player's own cube, and the M below echoes its lower edges in a second, nested V",
    draw() {
      const H = [...st(-7, -6, 6), ...st(-5, -8, 8), [-6, 0], [-6, 1]]
      const O = hexO(-3, 6, -7, -1)
      const Y = [...dr(-2, -5, 2), ...ur(0, -4, 2), [-1, -1], [0, -1]]
      const M = [...st(-3, 3, 11), ...st(2, 3, 11), ...dr(-2, 3, 2), ...ur(0, 4, 2)]
      const E = Ex(4, -9, -2, 6)
      return mk(H, O, Y, M, E)
    }
  },
  "camp:word": {
    title: "CAMP",
    concept: "CAMP: the A's crossbar rises on as the M's roof, and the M's last stem keeps climbing as a pole with the P's bowl flying as its pennant",
    draw() {
      const A = [...arch(-3, 4, -11, 11), ...ur(-2, 2, 2)]
      const M = [...ur(1, -1, 4), ...st(2, -3, 10), ...st(4, -9, 8)]
      const flag = [[5, -8], [5, -7], [5, -6], [6, -7]]
      return mk(C0(), A, M, flag)
    }
  },
  "eat:word": {
    title: "EAT",
    concept: "EAT: the A opens wide as a mouth, the hand's sawtooth set along both jaws as teeth, and its roof runs on as the T's bar",
    draw() {
      const E = Ex(-7, -8, -1, 7)
      const A = [...arch(-3, 6, -9, 11), ...ur(-2, 0, 2), ...dr(0, -1, 2)]
      const upper = [[-2, -8], [-1, -9], [0, -9], [1, -8]]
      const lower = [[-2, -1], [-1, -2], [0, -2], [1, -1]]
      const T = [...dr(3, -8, 4), ...st(5, -6, 9)]
      return mk(E, A, upper, lower, T)
    }
  },
  "time:word": {
    title: "TIME",
    concept: "TIME: the T's beam is milled into minutes with the hand's sawtooth, and the i tucks under its arm; the M's roof falls away to the E",
    draw() {
      const T = [...ur(-7, -3, 4), ...st(-6, -4, 8)]
      const ticks = [[-7, -4], [-6, -5], [-5, -6], [-4, -7]]
      const I = st(-4, -1, 10)
      const M = Mx(-2, -9, [11, 10, 9], "dr")
      const E = Ex(4, -7, 0, 6)
      return mk(T, ticks, I, M, E)
    }
  },
  "space:word": {
    title: "SPACE",
    concept: "SPACE locked into one block on the user's DREAM plan: the S's spine runs on through the P's stem as the C's top, the P's stem drops on as the C's back, the A's leg closes the P's bowl, and A and E share a leg as Æ, the roof and crossbar running on as the E's arms",
    draw() {
      // P's stem (k=-3) runs from the top down to the C's foot; its bowl closes on the A's left leg (k=-1)
      const P = [...st(-3, -12, 11), ...dr(-2, -11, 1), ...dr(-2, -5, 1)]
      const A = [...st(-1, -10, 1), ...ur(0, -10, 1), ...dr(1, -10, 1), ...ur(0, -2, 1), ...dr(1, -2, 1)]
      // the S's spine crosses the gap strip and the P's stem and runs on as the C's top
      const C = [...dr(-4, 1, 1), ...dr(-2, 3, 2), ...st(0, 5, 7), ...dr(-2, 11, 2), ...st(0, 11, 13)]
      // the A's right leg is the E's stem; its roof and crossbar run on as the E's top and middle arms
      const E = [...st(2, -9, 8), ...dr(3, -8, 5), ...dr(3, 0, 4), ...dr(3, 8, 2)]
      return mk(Stall(), P, A, C, E)
    }
  },
  "mind:word": {
    title: "MIND",
    concept: "MIND above its own reflection: the word breaks below the waterline into one band of the hand's half-tone ripples, thought on still water",
    draw() {
      const M = Mx(-8, -8, [2, 2, 2], "ur")
      const I = st(-2, -13, 2)
      // N: the diagonal falls the full width, from the top of the left stem down into the foot of the right one (D's stem)
      const N = [...st(0, -6, 2), ...dr(1, -6, 4)]
      const D = [...st(5, -10, 2), ...dr(6, -9, 1), ...st(7, -8, 0), ...ur(6, 0, 1)]
      const top = mk(M, I, N, D)
      // the reflection: mirrored about the waterline (row 3), ▶ only — the half-tone — rows 4..7
      const refl = L.icon()
      for (const id of top.on) {
        const t = TRI(id)
        const m = L.triAt(t.k, 6 - t.h)
        if (m && m.right && m.h <= 7) refl.on.add(m.id)
      }
      return top.add(refl)
    }
  },
  "talk:word": {
    title: "TALK",
    concept: "TALK is the user's own WALK with the W swapped for a T (you stop walking to talk); the T's bar runs on into the A's roof, and WALK's stray footprint hangs from the L's foot as a speech-bubble tail",
    draw() {
      const walk = hand("travel:word")
      const isW = (k, h) => (k === -7 && h <= 7) || (k === -6 && h >= 7) || (k === -5 && h >= 5) || (k === -4 && h >= 4 && h <= 5) || (k === -3 && h >= 4) || (k === -2 && (h >= 11 || h === 1 || h === 2)) || (k === -1 && h >= 2 && h <= 10) || h === 13
      const keep = walk.filter(([k, h]) => !isW(k, h))
      const T = [...ur(-8, -6, 4), ...st(-7, -5, 8)]
      const legs = [...st(-5, 3, 9), ...st(-1, 0, 10)]
      const tail = [[0, 12], [1, 12]]
      return mk(keep, T, legs, tail)
    }
  },
}
