// Thrive — entry point. Boots the engine and shows THE screen.
//
// A stored save carries its world — straight into the game, replayed. No save
// means the game opens on its own first phases (2026-09-02 — setup is no
// longer a flow of its own): the dot, then the key, then the angle to come.
// "Reset everything" and "new game" reboot the page into the right phase.

import { createApp } from "./app.js"
import { HexGridScreen, savedWorld, prepareSim } from "./grid.js"
import { savedPubkey } from "./identity.js"
import { createSim } from "./sim.js"

const app = createApp(document.getElementById("stage"))

// ── the boot loader ─────────────────────────────────────────────────
// A save is pure log — reload replays it. That replay is chunked (see
// hydrateProgressive), and this overlay (painted by the browser before the
// module even runs) covers it. It is BLACK AND EMPTY (2026-09-04): a screen
// switch shows nothing at all, never a flash of paper with a spinner on it.
// onProgress only yields a frame per batch, so a long day can still paint.
const loadEl = document.getElementById("loading")
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()))
const showLoad = () => {
  if (!loadEl) return
  loadEl.style.display = "block"
  loadEl.style.opacity = "1"
}
const hideLoad = () => {
  if (!loadEl) return
  loadEl.style.opacity = "0"
  setTimeout(() => (loadEl.style.display = "none"), 300)
}
const onProgress = async () => {
  await nextFrame()
}

// A world that has been LIVED has a log to replay, and that can take a moment —
// the overlay covers it. A brand-new world has nothing to replay, so it opens
// straight out of setup: no spinner, no flash of paper over the night, just the
// canvas easing from the screen you built into the world it became.
const bootGame = async world => {
  const fresh = !(world.day > 1)
  if (!fresh) {
    showLoad()
    await nextFrame() // let the overlay paint before the heavy replay
  }
  const sim = await prepareSim(world, onProgress)
  try {
    window.__sim = sim // dev handle: inspect reserve/exhaustion state from the console
  } catch {}
  if (fresh) app.fadeIn()
  app.setScreen(HexGridScreen({ ...world, sim }))
  hideLoad()
}
// No world yet: the game itself, on its first phases — the dot when there is
// no key, or straight to the key phase with a remembered one (a key is never
// asked for twice). The sim underneath is a placeholder the world will be
// built on.
const bootIntake = () => {
  hideLoad()
  const pubkey = savedPubkey()
  app.setScreen(HexGridScreen({ pubkey, sim: createSim({ pubkey }), phase: pubkey ? "key" : "dot" }))
}
// Boot AFTER window load: NIP-07 extensions inject window.nostr into the
// page late — booting at module time shows "no extension" to people who
// have one. (Modules run at DOM-ready; injection can trail until load.)
const boot = async () => {
  // NOTHING IS TYPED TWICE. Canvas takes whatever face is loaded the moment it
  // draws and never re-flows, so painting before Source Code Pro lands would
  // show a frame in the fallback and swap it a beat later. The face is preloaded
  // in the page head and blocking (`font-display: block`), and we hold the very
  // first paint until it's in — capped, so a font that never arrives (offline
  // cache miss, blocked request) delays the game by a moment instead of forever.
  if (document.fonts) {
    try {
      await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))])
    } catch {}
    document.fonts.ready.then(() => app.requestRender()) // …and if the cap won that race, redraw when it does land
  }
  const saved = savedWorld()
  saved ? bootGame(saved) : bootIntake()
}
if (document.readyState === "complete") boot()
else window.addEventListener("load", boot, { once: true })
// the dev style guide is a separate plain-HTML page: /styles.html
