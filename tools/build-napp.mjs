// Assemble a CLEAN napp folder — the launcher's local-folder picker uploads
// every file it's handed, so it must see the game and nothing else: no
// node_modules, no .git, no tests, no attic, no dev pages, no design canon.
//
// What goes in is DERIVED, not listed: we walk the import graph out of
// index.html's entry module, so a new lib/ file is included the moment
// something imports it, and a dev-only one (styleguide, worldview, iconmaker…)
// stays out because nothing in the game reaches it.
//
//   npm run napp   →   napp/  (gitignored)
//
// Then in nostrapps: add a local napp and point the folder picker at napp/.
// The launcher needs /index.html and /metadata.json with an .id — both land at
// the root here, which is what makes the folder loadable as-is.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync } from "node:fs"
import { dirname, resolve, relative, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = join(ROOT, "napp")
const ENTRY_HTML = "index.html"
// what the launcher itself reads, plus the assets the page's own CSS pulls in —
// the walker follows JS imports, and a url() in a <style> block isn't one
const ROOT_FILES = [ENTRY_HTML, "metadata.json", "fonts/SourceCodePro-Regular.woff2", "fonts/SourceCodePro-Semibold.woff2"]

// every `from "…"` / `import "…"` / `import("…")` a module names, relative only
// (nothing here resolves out of node_modules — the game is dependency-free)
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.[^"']+)["']/g

function closure(entry) {
  const seen = new Set()
  const queue = [entry]
  while (queue.length) {
    const rel = queue.shift()
    if (seen.has(rel)) continue
    seen.add(rel)
    const src = readFileSync(join(ROOT, rel), "utf8")
    for (const [, spec] of src.matchAll(IMPORT_RE)) {
      const dep = relative(ROOT, resolve(dirname(join(ROOT, rel)), spec))
      if (!existsSync(join(ROOT, dep))) throw new Error(`${rel} imports a missing file: ${spec}`)
      queue.push(dep)
    }
  }
  return [...seen]
}

// the entry module, straight from the page — so renaming main.js can't rot this
const html = readFileSync(join(ROOT, ENTRY_HTML), "utf8")
const entry = html.match(/<script[^>]+type="module"[^>]+src="\.\/([^"]+)"/)?.[1]
if (!entry) throw new Error(`no <script type="module" src="./…"> in ${ENTRY_HTML}`)

const files = [...ROOT_FILES, ...closure(entry)]

// rebuild from scratch: a stale file left behind would ship in the upload
if (existsSync(OUT)) rmSync(OUT, { recursive: true })
let bytes = 0
for (const f of files) {
  const dst = join(OUT, f)
  mkdirSync(dirname(dst), { recursive: true })
  writeFileSync(dst, readFileSync(join(ROOT, f)))
  bytes += statSync(dst).size
}

const id = JSON.parse(readFileSync(join(OUT, "metadata.json"), "utf8")).id
console.log(files.sort().map(f => `  ${f}`).join("\n"))
console.log(`\nnapp/ — ${files.length} files, ${(bytes / 1024).toFixed(0)} kB, id "${id}"`)
