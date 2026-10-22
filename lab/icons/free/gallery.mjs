// node gallery.mjs [v2] → out/anon-mato-free-icons[-v2].html — one self-contained page:
// the three families as inline SVG, an inspector (big, 16/24/40 on paper and
// ink, copy as standalone SVG), and a toggle that shows each icon's lattice
// version (from lab/icons/lattice) beside it.
import fs from "node:fs"
import path from "node:path"
import { css, defs } from "./style.css.mjs"
const here = path.dirname(new URL(import.meta.url).pathname)
const V2 = process.argv[2] === "v2"
const LAT = "/Users/eskema/web/anon_mato/lab/icons/lattice"
const ORDER = [
  ["land", "Land types", "the ground a tile is"],
  ["forage", "Forage", "what the hands take"],
  ["quarry", "Quarry", "what the tools take, and what the hands make of it"],
]
const { svgPath } = await import(path.join(LAT, "lat.mjs"))
const latIcons = {}
const PICKS = JSON.parse(fs.readFileSync(path.join(LAT, "picks.json")))
for (const f of ["land", "forage", "quarry"]) {
  const m = await import(path.join(LAT, "families", f + ".mjs"))
  const icons = { ...m.icons }
  const want = Object.keys(PICKS[f] || {})
  if (want.length) {
    const c = await import(path.join(LAT, "families", "cand-" + f + ".mjs"))
    for (const k of want) if (c.icons[k]) icons[k] = c.icons[k]
  }
  for (const [k, d] of Object.entries(icons)) latIcons[k] = svgPath(d.draw().on, 1, 0, 0, 4)
}
const svgOf = d => (typeof d.svg === "function" ? d.svg() : d.svg)
const fams = []
for (const [name, title, sub] of ORDER) {
  const mod = await import(path.join(here, "families", name + (V2 ? "2" : "") + ".mjs") + "?t=" + Date.now())
  const v1 = V2 ? (await import(path.join(here, "families", name + ".mjs"))).icons : null
  fams.push({
    name, title, sub,
    items: Object.entries(mod.icons).map(([key, d]) => ({
      key, concept: d.concept || "", svg: svgOf(d),
      // what the compare toggle shows beside it: v1 for the v2 page, the lattice for v1
      cmp: V2
        ? (v1[key] ? `<svg class="lt" viewBox="-1 -1 2 2" aria-hidden="true">${svgOf(v1[key])}</svg>` : "")
        : latIcons[key] ? `<svg class="lt" viewBox="-1.05 -1.05 2.1 2.1" aria-hidden="true"><path class="lat" fill-rule="evenodd" d="${latIcons[key]}"/></svg>` : "",
    })),
  })
}
const html = fs.readFileSync(path.join(here, "gallery.tpl.html"), "utf8")
  .replace("/*FONT*/", fs.readFileSync("/Users/eskema/web/anon_mato/fonts/SourceCodePro-Regular.woff2").toString("base64"))
  .replace("/*ICONCSS*/", css())
  .replace("<!--TITLE-->", V2 ? "anon&amp;mato — off the grid, v2" : "anon&amp;mato — off the grid")
  .replace("/*DATA*/", `const CMP_LABEL = ${JSON.stringify(V2 ? "beside v1" : "beside the lattice")};\nconst FAMS = ${JSON.stringify(fams)};\nconst STANDALONE_CSS = ${JSON.stringify(css("#141414", "#f4f1ea"))};\nconst STANDALONE_DEFS = ${JSON.stringify(defs("#141414", "#f4f1ea"))};`)
const outFile = path.join(here, "out", V2 ? "anon-mato-free-icons-v2.html" : "anon-mato-free-icons.html")
fs.writeFileSync(outFile, html)
console.log(fams.reduce((s, f) => s + f.items.length, 0), "icons →", outFile)
