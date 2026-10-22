import * as L from "../lat.mjs"
export const family = "cand-words"

// ── the words family's iso-kufic pen, in triangle coords (strip k, row h); k+h odd → ▶, even → ◀ ──
const warn = m => process.stderr.write("cand-words: " + m + "\n")
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
const fixTB = (k, t, b, who) => {
  if (par(k + t)) { warn(`${who}(${k}) top ${t} → ${t + 1}`); t++ }
  if (par(k + b)) { warn(`${who}(${k}) bottom ${b} → ${b - 1}`); b-- }
  return [t, b]
}
// hex arch (∩ with a peak): stems k and k+w-1 (w even), rows t..b
const arch = (k, w, t, b) => {
  ;[t, b] = fixTB(k, t, b, "arch")
  const n = w / 2 - 1
  return [...st(k, t, b), ...st(k + w - 1, t, b), ...ur(k + 1, t - 1, n), ...dr(k + w / 2, t - n, n)]
}
// the solid mini hex: six triangles round lattice vertex (c, v), c+v even
const dot = (c, v) => {
  if (par(c + v)) warn(`dot(${c},${v}) is not a lattice vertex`)
  return [[c - 1, v - 1], [c - 1, v], [c - 1, v + 1], [c, v - 1], [c, v], [c, v + 1]]
}
// M: bar across strips k..k+4 (rising), stems at k, k+2, k+4 down to bs[i]
const Mx = (k, h0, bs) => {
  const bar = ur(k, h0, 5)
  const top = i => Math.min(...bar.filter(([kk]) => kk === k + i).map(([, h]) => h))
  return [...bar, ...st(k, top(0), bs[0]), ...st(k + 2, top(2), bs[1]), ...st(k + 4, top(4), bs[2])]
}
// a bowl on the right of a stem at k (P, D): top band falls n strips from row t, back stem, bottom band rises from row m;
// the stem must hold rows t and m+1
const bowlR = (k, t, n, m) => [...dr(k + 1, t, n), ...st(k + n + 1, t + n, m - n + 1), ...ur(k + 1, m, n)]
// C as the left half of a hexagon: stem k (t..b), top band rising n strips, bottom band falling n strips, short stubs
const Cx = (k, t, b, n, sT = 0, sB = 0) => {
  ;[t, b] = fixTB(k, t, b, "Cx")
  const o = [...st(k, t, b), ...ur(k + 1, t - 1, n), ...dr(k + 1, b, n)]
  if (sT) o.push(...st(k + n + 1, t - n, t - n + sT))
  if (sB) o.push(...st(k + n + 1, b + n - sB, b + n))
  return o
}
// COOK's C, verbatim from the hand (strips -7..-5)
const Ccook = () => [...st(-7, -7, 6), [-6, -8], ...st(-5, -8, -2), [-6, 7], [-6, 8], ...st(-5, 1, 8)]
// SLEEP's S drawn tall (strips -7..-5): top hook, pinched ◆ cap, upper stem, spine, lower stem, bottom cap, tail
const Stall = (a = -10, b = 8, tail = 3) => [
  ...st(-5, a, a + 4), [-7, a + 1], [-6, a + 1], ...st(-7, a + 1, -1), ...dr(-6, -1, 1),
  ...st(-5, 0, b), ...ur(-6, b, 1), ...st(-7, tail, b + 1)]
const mk = (...parts) => L.icon().set(parts.flat())

export const icons = {
  "mind:word": {
    title: "MIND",
    concept: "MiND: the dot of the i is your own cube, a solid hex on the hex's centre line just under its apex; the M's roof climbs to it and the n and D fall away, so the word wears the hex's own roof",
    draw() {
      // eight strokes on the kufic rhythm, every other strip -7..7; the M's middle stroke stops at the waist
      const M = Mx(-7, -5, [5, -1, 8])
      const I = [...st(-1, -8, 10), ...dot(0, -12)]
      const N = [...st(1, -9, 9), ...dr(2, -9, 1), ...st(3, -8, 7)]
      const D = [...st(5, -7, 5), ...bowlR(5, -7, 1, 4)]
      return mk(M, I, N, D)
    }
  },
  "camp:word": {
    title: "CAMP",
    concept: "CAMP written the way the hand writes COOK, C | A over M | P: the A is pitched as a tipi, its two poles crossing above the ridge, with the fire burning solid in its door",
    draw() {
      const A = [...arch(-3, 6, -9, -1), ...ur(0, -12, 2), ...dr(-2, -13, 2)]
      const fire = dot(0, -4)
      const M = [...st(-3, 2, 10), ...st(2, 2, 10), ...dr(-2, 3, 2), ...ur(0, 4, 2)]
      const P = [...st(4, -10, 9), ...bowlR(4, -10, 1, -3)]
      return mk(Ccook(), A, fire, M, P)
    }
  },
  "space:word": {
    title: "SPACE",
    concept: "SPACE given room: the S stands full height and P A over C E sit in four cells like tiles on the board, a river of paper between each",
    draw() {
      const S = Stall(-10, 8, 3)
      const P = [...st(-3, -13, -2), ...bowlR(-3, -13, 2, -8)]
      const A = [...arch(2, 4, -10, -4), ...dr(3, -8, 1), ...ur(4, -8, 1)]
      const C = Cx(-3, 3, 11, 2, 1, 1)
      const E = [...st(2, 2, 10), ...ur(3, 1, 3), ...ur(3, 5, 2), ...ur(3, 9, 3)]
      const ic = mk(S, P, A, C, E)
      const n = ic.count
      // drawn one strip left of centre; set it on the axis
      ic.shift(1, 1)
      if (ic.count !== n) warn(`space:word clipped ${n - ic.count}`)
      return ic
    }
  },
}
