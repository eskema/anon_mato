// node dump.mjs <family> <key> — print an icon as a lattice map, one char per
// triangle: '>' '<' filled (pointing right/left), '.' empty, ' ' outside the hex.
// Rows are h = -15..15 (y = h/16), columns are strips k = -8..7 (x ≈ (k+.5)·0.108).
// Also prints the filled list as [k, h] pairs for ic.set([...]).
import path from "node:path"
import { TRIS, triAt } from "./lat.mjs"
const here = path.dirname(new URL(import.meta.url).pathname)
const [fam, key] = process.argv.slice(2)
const mod = await import(path.join(here, "families", fam + ".mjs"))
const ic = mod.icons[key].draw()
let out = "      k: " + [...Array(16)].map((_, i) => String((i - 8 + 16) % 10)).join("") + "\n"
const list = []
for (let h = -16; h <= 16; h++) {
  let row = ""
  for (let k = -8; k <= 7; k++) {
    const t = triAt(k, h)
    if (!t) row += " "
    else if (ic.on.has(t.id)) (row += t.right ? ">" : "<"), list.push([k, h])
    else row += "."
  }
  if (row.trim()) out += `h=${String(h).padStart(3)}  ${row}\n`
}
console.log(out)
console.log(JSON.stringify(list))
