// The dev server: plain static files over http, because ES modules won't load
// off disk. No dependency — Bun serves the folder itself.
//
//   bun run dev   →   http://127.0.0.1:4321

const root = new URL("..", import.meta.url).pathname
const port = Number(process.env.PORT || 4321)

Bun.serve({
  port,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname)
    const file = Bun.file(root + (path.endsWith("/") ? path + "index.html" : path).slice(1))
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 })
  }
})
console.log(`serving ${root} on http://127.0.0.1:${port}`)
