// Assemble a CLEAN napp folder — the launcher's local-folder picker uploads
// every file it's handed, so it must see the game and nothing else: no
// node_modules, no .git, no tests, no attic, no design canon.
//
// What goes in is DERIVED, not listed: we walk out of each PAGE — the game
// (index.html) and the playground's own pages, which it frames by path — and
// follow every module import, stylesheet and url() they reach. A new lib/ file
// is included the moment something imports it, and one nothing reaches stays
// out.
//
//   bun run napp   →   napp/  (gitignored)
//
// Then in nostrapps: add a local napp and point the folder picker at napp/.
// The launcher needs /index.html and /metadata.json with an .id — both land at
// the root here, which is what makes the folder loadable as-is.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync } from "node:fs"
import { dirname, resolve, relative, join, extname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = join(ROOT, "napp")
// the game first, then the pages the playground frames (lib/cube.js PAGES)
const PAGES = ["index.html", "guide.html", "clock.html", "world.html"]
// what the launcher itself reads, beside the pages
const ROOT_FILES = ["metadata.json"]

// every `from "…"` / `import "…"` / `import("…")` a module names, relative only
// (nothing here resolves out of node_modules — the game is dependency-free)
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.[^"']+)["']/g
// …a page's module scripts and stylesheets, and a stylesheet's url()s
const SCRIPT_RE = /<script[^>]+type="module"[^>]+src="(\.[^"]+)"/g
const STYLE_RE = /<link[^>]+rel="stylesheet"[^>]+href="(\.[^"]+)"/g
const URL_RE = /url\(\s*["']?(\.[^"')]+)["']?\s*\)/g

// what a file pulls in, by kind: a page its scripts, inline imports, styles
// and url()s; a module its imports; a stylesheet its url()s
function refsOf(rel, src) {
  const ext = extname(rel)
  const res = ext === ".html" ? [SCRIPT_RE, IMPORT_RE, STYLE_RE, URL_RE] : ext === ".css" ? [URL_RE] : ext === ".js" ? [IMPORT_RE] : []
  return res.flatMap(re => [...src.matchAll(re)].map(m => m[1]))
}

function closure(entries) {
  const seen = new Set()
  const queue = [...entries]
  while (queue.length) {
    const rel = queue.shift()
    if (seen.has(rel)) continue
    if (!existsSync(join(ROOT, rel))) throw new Error(`missing file: ${rel}`)
    seen.add(rel)
    if (![".html", ".css", ".js"].includes(extname(rel))) continue // a font or the like: nothing inside to follow
    const src = readFileSync(join(ROOT, rel), "utf8")
    for (const spec of refsOf(rel, src)) {
      const dep = relative(ROOT, resolve(dirname(join(ROOT, rel)), spec))
      if (!existsSync(join(ROOT, dep))) throw new Error(`${rel} refers to a missing file: ${spec}`)
      queue.push(dep)
    }
  }
  return [...seen]
}

const files = [...new Set([...ROOT_FILES, ...closure(PAGES)])]

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
