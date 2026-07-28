// Thrive — entry point. Boots the engine and shows a screen.
//
// A stored save carries its world's angle — straight into the game. No save
// means a new life: the setup flow (the angle picker) runs first and its
// chosen angle seeds the world. "Reset everything" wipes the save and lands
// back here at the beginning.

import { createApp } from "./app.js"
import { HexGridScreen, savedWorld, prepareSim } from "./grid.js"
import { startSetup } from "./setup/flow.js"
import { generateSecretKey } from "./vendor/nostr-pure.js"

const app = createApp(document.getElementById("stage"))

// ── the boot loader ─────────────────────────────────────────────────
// A save is pure log — reload replays it. That replay is chunked (see
// hydrateProgressive), and this overlay (painted by the browser before the
// module even runs) shows a spinner + progress bar so a long day never looks
// like a frozen tab. onProgress updates the bar and yields a frame per batch.
const loadEl = document.getElementById("loading")
const barEl = document.getElementById("load-bar")
const msgEl = loadEl && loadEl.querySelector(".load-msg")
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()))
const showLoad = msg => {
  if (!loadEl) return
  if (msg && msgEl) msgEl.textContent = msg
  loadEl.style.display = "grid"
  loadEl.style.opacity = "1"
  if (barEl) barEl.style.width = "0%"
}
const hideLoad = () => {
  if (!loadEl) return
  loadEl.style.opacity = "0"
  setTimeout(() => (loadEl.style.display = "none"), 300)
}
const onProgress = async (done, total) => {
  if (barEl) barEl.style.width = Math.round((total ? done / total : 1) * 100) + "%"
  await nextFrame()
}

const bootGame = async world => {
  showLoad(world.day > 1 ? `Replaying ${world.day} days…` : "Preparing your world…")
  await nextFrame() // let the overlay paint before the (possibly heavy) replay
  const sim = await prepareSim(world, onProgress)
  try {
    window.__sim = sim // dev handle: inspect reserve/exhaustion state from the console
  } catch {}
  app.setScreen(HexGridScreen({ ...world, sim, onReset: bootSetup }))
  hideLoad()
}
const bootSetup = () => {
  hideLoad() // setup is a fresh, no-replay flow — no loader
  startSetup(app, store => {
    // "continue" on the identity card resumes the matching saved world;
    // otherwise the picked angle + key start a new one, with a freshly
    // GENERATED world key (throwaway — it derives the terrain, per DESIGN)
    const resume = store.player.resume ? savedWorld() : null
    const worldKey = [...generateSecretKey()].map(b => b.toString(16).padStart(2, "0")).join("")
    bootGame(resume || { angle: store.player.seedAngle, pubkey: store.player.pubkey ?? null, worldKey })
  })
}
// Boot AFTER window load: NIP-07 extensions inject window.nostr into the
// page late — booting at module time shows "no extension" to people who
// have one. (Modules run at DOM-ready; injection can trail until load.)
const boot = () => {
  const saved = savedWorld()
  saved ? bootGame(saved) : bootSetup()
}
if (document.readyState === "complete") boot()
else window.addEventListener("load", boot, { once: true })
// the dev style guide is a separate plain-HTML page: /styles.html

// ── light/dark theme ────────────────────────────────────────────────
// The corner button is gone (removed from index.html) — the toggle lives in the
// radial menu now (grid.js). Here we only APPLY the saved/default theme on load.
// Inside the launcher the bridge drives the theme (and injects window.napp).
if (!window.napp) {
  let saved = null
  try {
    saved = localStorage.getItem("thrive-theme")
  } catch {}
  document.documentElement.dataset.theme = saved || "light" // light is the default (saved wins)
}

// The angle setup flow is stashed for now. To run it instead of the grid:
//   import { startSetup } from "./setup/flow.js"
//   startSetup(app)
