// node render.mjs <family|all> [key …] [--big]
// → out/<family>.svg.png (macOS qlmanage). Each cell: the icon large (faint
// guide circle r = 0.85), then 40/24/16 px on paper and on ink.
import fs from "node:fs"
import path from "node:path"
import { execSync } from "node:child_process"
import { css, defs } from "./style.css.mjs"
const here = path.dirname(new URL(import.meta.url).pathname)
const args = process.argv.slice(2)
const fam = args[0]
const big = args.includes("--big")
const keys = args.slice(1).filter(a => !a.startsWith("--"))
// `node render.mjs land2 --vs land` puts the other family's same key beside each icon
const vsAt = args.indexOf("--vs")
const vs = vsAt >= 0 ? args[vsAt + 1] : null
if (vs) keys.splice(keys.indexOf(vs), 1)
const load = async f => (await import(path.join(here, "families", f + ".mjs") + "?t=" + Date.now())).icons
let entries = []
if (fam === "all") {
  for (const f of fs.readdirSync(path.join(here, "families")).filter(f => f.endsWith(".mjs")).sort())
    for (const [k, v] of Object.entries(await load(f.replace(".mjs", "")))) entries.push([`${f.replace(".mjs", "")}/${k}`, v])
} else entries = Object.entries(await load(fam))
if (vs) {
  const other = await load(vs)
  entries = entries.flatMap(([k, v]) => (other[k] ? [[k, v], [`${vs}/${k}`, other[k]]] : [[k, v]]))
}
if (keys.length) entries = entries.filter(([k]) => keys.includes(k) || keys.includes(k.split("/").pop()))
const INK = "#141414", PAPER = "#f4f1ea"
const cell = big ? 620 : 250
const R = big ? 270 : 92
const cols = Math.max(1, Math.ceil(Math.sqrt(entries.length * 1.25)))
const cellH = big ? cell + 60 : cell + 70
const side = Math.max(cols * cell, Math.ceil(entries.length / cols) * cellH)
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
const body = []
const errors = []
entries.forEach(([k, def], i) => {
  const x0 = (i % cols) * cell
  const y0 = Math.floor(i / cols) * cellH
  const cx = x0 + cell / 2
  const cy = y0 + (big ? cell / 2 : R + 16)
  let g
  try {
    g = typeof def.svg === "function" ? def.svg() : def.svg
    if (typeof g !== "string") throw new Error("svg must be a string")
    if (/stroke-width|opacity|fill="#|stroke="#/.test(g)) errors.push(`${k}: sets its own stroke-width / colour / opacity — use the classes only`)
  } catch (e) {
    errors.push(`${k}: ${e.message}`)
    return
  }
  const at = (s, x, y, inv) => `<svg x="${x - s}" y="${y - s}" width="${2 * s}" height="${2 * s}" viewBox="-1 -1 2 2" class="${inv ? "inv" : ""}" style="--ink:${inv ? PAPER : INK};--paper:${inv ? INK : PAPER}">${g}</svg>`
  body.push(`<circle cx="${cx}" cy="${cy}" r="${R * 0.85}" fill="none" stroke="#e2dccf" stroke-dasharray="4 6"/>`)
  body.push(at(R, cx, cy, false))
  body.push(`<text x="${cx}" y="${y0 + (big ? cell + 20 : 2 * R + 40)}" font-family="Menlo,monospace" font-size="${big ? 22 : 15}" text-anchor="middle" fill="#333">${esc(k)}</text>`)
  if (!big) {
    let bx = x0 + 18
    const by = y0 + 2 * R + 50
    for (const [s, inv] of [[20, 0], [12, 0], [8, 0], [20, 1], [12, 1], [8, 1]]) {
      if (inv) body.push(`<rect x="${bx - 3}" y="${by - 3}" width="${2 * s + 6}" height="46" fill="${INK}"/>`)
      body.push(at(s, bx + s, by + 20, inv))
      bx += 2 * s + 10
    }
  }
})
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}"><style>${css()}</style>${defs(INK, PAPER)}<rect width="100%" height="100%" fill="${PAPER}"/>${body.join("")}</svg>`
const out = path.join(here, "out", (fam === "all" ? "all" : fam) + (keys.length ? "-" + keys.join("_").replace(/[^a-z0-9_-]/gi, "").slice(0, 60) : "") + (big ? "-big" : "") + ".svg")
fs.writeFileSync(out, svg)
execSync(`qlmanage -t -s ${Math.min(2000, Math.max(900, side))} -o "${path.dirname(out)}" "${out}" >/dev/null 2>&1`)
console.log(out + ".png")
if (errors.length) console.log("ERRORS:\n" + errors.join("\n"))
