// node render.mjs <family> [key …] [--big] [--nogrid]
// → out/<family>.svg + out/<family>.svg.png  (PNG via macOS qlmanage)
// Each cell: the icon large over the faint lattice, then badge sizes 40/24/16 px
// ink-on-paper and paper-on-ink. --big renders one icon per 600px cell.
import fs from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"
import { TRIS, svgPath, hexPts } from "./lat.mjs"
process.removeAllListeners("warning")
const here = path.dirname(new URL(import.meta.url).pathname)
const args = process.argv.slice(2)
const fam = args[0]
const big = args.includes("--big")
const nogrid = args.includes("--nogrid")
const keys = args.slice(1).filter(a => !a.startsWith("--"))
const mod = await import(path.join(here, "families", fam + ".mjs") + "?t=" + Date.now())
let entries = Object.entries(mod.icons)
if (keys.length) entries = entries.filter(([k]) => keys.includes(k))
const INK = "#141414"
const PAPER = "#f4f1ea"
const cell = big ? 620 : 250
const R = big ? 270 : 92
const cols = Math.max(1, Math.ceil(Math.sqrt(entries.length * (big ? 1 : 1.25))))
const rows = Math.ceil(entries.length / cols)
const cellH = big ? cell + 60 : cell + 70
const W = cols * cell
const H = rows * cellH
const side = Math.max(W, H)
const hexStr = (r, x, y) => hexPts(r, x, y).map(p => p.map(n => n.toFixed(1)).join(",")).join(" ")
let body = ""
let errors = []
entries.forEach(([k, def], i) => {
  const x0 = (i % cols) * cell
  const y0 = Math.floor(i / cols) * cellH
  const cx = x0 + cell / 2
  const cy = y0 + (big ? cell / 2 : R + 16)
  let ic
  try {
    ic = def.draw()
  } catch (e) {
    errors.push(`${k}: ${e.message}`)
    body += `<text x="${cx}" y="${cy}" font-size="14" fill="red" text-anchor="middle">ERROR ${k}</text>`
    return
  }
  const ids = ic.on
  body += `<polygon points="${hexStr(R, cx, cy)}" fill="none" stroke="#d8d2c4" stroke-width="1"/>`
  if (!nogrid) {
    let g = ""
    for (const t of TRIS) g += "M" + t.pts.map(([x, y]) => `${(cx + x * R).toFixed(1)} ${(cy + y * R).toFixed(1)}`).join("L") + "Z"
    body += `<path d="${g}" fill="none" stroke="#e6e0d3" stroke-width="0.6"/>`
  }
  body += `<path d="${svgPath(ids, R, cx, cy)}" fill="${INK}" fill-rule="evenodd"/>`
  body += `<text x="${cx}" y="${y0 + (big ? cell + 20 : 2 * R + 40)}" font-family="Menlo,monospace" font-size="${big ? 22 : 15}" text-anchor="middle" fill="#333">${k.replace(/&/g, "&amp;").replace(/</g, "&lt;")} · ${ids.size}</text>`
  if (!big) {
    // badge sizes
    let bx = x0 + 18
    const by = y0 + 2 * R + 50
    for (const [s, inv] of [[20, 0], [12, 0], [8, 0], [20, 1], [12, 1], [8, 1]]) {
      const bcx = bx + s
      const bcy = by + 20
      if (inv) body += `<rect x="${bx - 3}" y="${by - 3}" width="${2 * s + 6}" height="46" fill="${INK}"/>`
      body += `<path d="${svgPath(ids, s, bcx, bcy)}" fill="${inv ? PAPER : INK}" fill-rule="evenodd"/>`
      bx += 2 * s + 10
    }
  }
})
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}"><rect width="100%" height="100%" fill="${PAPER}"/>${body}</svg>`
const out = path.join(here, "out", fam + (keys.length ? "-" + keys.join("_").slice(0, 60) : "") + (big ? "-big" : "") + ".svg")
fs.writeFileSync(out, svg)
execSync(`qlmanage -t -s ${Math.min(2000, Math.max(900, side))} -o "${path.dirname(out)}" "${out}" >/dev/null 2>&1`)
console.log(out + ".png")
if (errors.length) console.log("ERRORS:\n" + errors.join("\n"))
