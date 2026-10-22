// every family at once (except the hand reference) — `node render.mjs all --nogrid`
import fs from "node:fs"
const dir = new URL(".", import.meta.url)
const names = fs.readdirSync(dir).filter(f => f.endsWith(".mjs") && !["all.mjs", "hand.mjs"].includes(f)).sort()
export const family = "all"
export const icons = {}
for (const f of names) {
  try {
    const m = await import(new URL(f, dir).href)
    for (const [k, v] of Object.entries(m.icons)) icons[`${f.replace(".mjs", "")}/${k}`] = v
  } catch (e) {
    icons[`${f}/LOAD-ERROR`] = { title: e.message, draw: () => { throw e } }
  }
}
