// node gallery.mjs → out/anon-mato-icons.html (+ out/anon-mato-icons.json)
// One self-contained page: every family as inline SVG (merged outlines), an
// inspector that rebuilds an icon triangle by triangle over the lattice, and
// a copy button that yields the creator's paste format { n, fill, lines }.
import fs from "node:fs"
import path from "node:path"
import { TRIS, svgPath } from "./lat.mjs"
const here = path.dirname(new URL(import.meta.url).pathname)
const ORDER = [
  ["hand", "Yours", "the twenty-one you drew by hand — where every icon below comes from"],
  ["skills", "Skills & pillars", "the missing pictures for the word-only skills, and the three pillars"],
  ["words", "Words", "more iso-kufic word-marks in your lettering"],
  ["menu", "The menu", "the radial menu's structure glyphs, drawn at last"],
  ["moves", "Moves & hands", "walking, leaping, fording, carrying"],
  ["land", "Land", "biomes, rivers, the gate, the globe"],
  ["forage", "Forage", "what the hands take"],
  ["quarry", "Quarry & matter", "what the tools take, and what the hands make of it"],
  ["tools", "Tools", "crude, and the fine tier"],
  ["kitchen", "Kitchen", "fire, vessels, dishes — and the cooked and spoiled grammars"],
  ["works", "Works & knowing", "builds and the tech tree"],
  ["sky", "Body & sky", "the body's clocks and the sky's"],
  ["folk", "Folk & worlds", "people, angles, the rim"],
]
const PICKS = fs.existsSync(path.join(here, "picks.json")) ? JSON.parse(fs.readFileSync(path.join(here, "picks.json"))) : {}
const fams = []
const data = {}
for (const [name, title, sub] of ORDER) {
  const f = path.join(here, "families", name + ".mjs")
  if (!fs.existsSync(f)) continue
  let mod
  try {
    mod = await import(f + "?t=" + Date.now())
  } catch (e) {
    console.log("skip", name, e.message)
    continue
  }
  // judged replacements (picks.json: { family: { key: "new" } }) come from cand-<family>.mjs
  let icons = { ...mod.icons }
  const want = Object.entries(PICKS[name] || {}).filter(([, v]) => v === "new").map(([k]) => k)
  if (want.length) {
    const cand = await import(path.join(here, "families", "cand-" + name + ".mjs") + "?t=" + Date.now())
    for (const k of want) if (cand.icons[k]) icons[k] = cand.icons[k]
    console.log(name, "← new:", want.join(", "))
  }
  const items = []
  for (const [key, def] of Object.entries(icons)) {
    try {
      const ic = def.draw()
      const fill = [...ic.on].sort()
      items.push({ key, concept: def.concept || "", d: svgPath(ic.on, 1, 0, 0, 4), fill })
      if (name !== "hand") data[key] = { n: 8, fill, lines: [] }
    } catch (e) {
      console.log("error", name, key, e.message)
    }
  }
  fams.push({ name, title, sub, items })
}
// lattice geometry for the inspector: id → [x0,y0,x1,y1,x2,y2]
const lattice = Object.fromEntries(TRIS.map(t => [t.id, t.pts.flat().map(n => +n.toFixed(4))]))
const total = fams.reduce((s, f) => s + (f.name === "hand" ? 0 : f.items.length), 0)
const html = fs.readFileSync(path.join(here, "gallery.tpl.html"), "utf8")
  .replace("/*FONT*/", fs.readFileSync("/Users/eskema/web/anon_mato/fonts/SourceCodePro-Regular.woff2").toString("base64"))
  .replace("/*DATA*/", `const FAMS = ${JSON.stringify(fams)};\nconst LATTICE = ${JSON.stringify(lattice)};\nconst TOTAL = ${total};`)
fs.writeFileSync(path.join(here, "out", "anon-mato-icons.html"), html)
fs.writeFileSync(path.join(here, "out", "anon-mato-icons.json"), JSON.stringify(data))
console.log(`${total} new icons in ${fams.length - 1} families →`, path.join(here, "out", "anon-mato-icons.html"))
