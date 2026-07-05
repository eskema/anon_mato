// Thrive — entry point. Boots the engine and shows a screen.
//
// A stored save carries its world's angle — straight into the game. No save
// means a new life: the setup flow (the angle picker) runs first and its
// chosen angle seeds the world. "Reset everything" wipes the save and lands
// back here at the beginning.

import { createApp } from "./app.js"
import { HexGridScreen, savedWorld } from "./grid.js"
import { startSetup } from "./setup/flow.js"

const app = createApp(document.getElementById("stage"))
const bootGame = world => app.setScreen(HexGridScreen({ ...world, onReset: bootSetup }))
const bootSetup = () =>
  startSetup(app, store => bootGame({ angle: store.player.seedAngle, pubkey: store.player.pubkey ?? null }))
const saved = savedWorld()
saved ? bootGame(saved) : bootSetup()
// the dev style guide is a separate plain-HTML page: /styles.html

// ── light/dark theme ────────────────────────────────────────────────
// Standalone only: handy for daylight. Inside the launcher the bridge drives
// the theme (and injects window.napp), so the toggle is removed there.
const themeBtn = document.getElementById("theme")
if (window.napp) {
  themeBtn.remove()
} else {
  const root = document.documentElement
  const applyTheme = t => {
    root.dataset.theme = t
    try {
      localStorage.setItem("thrive-theme", t)
    } catch {}
    themeBtn.textContent = t === "light" ? "☾" : "☀" // icon = what a click switches to
    app.requestRender()
  }
  let saved = null
  try {
    saved = localStorage.getItem("thrive-theme")
  } catch {}
  applyTheme(saved || "light") // light is the default (saved choice still wins)
  themeBtn.addEventListener("click", () =>
    applyTheme(root.dataset.theme === "light" ? "dark" : "light")
  )
}

// The angle setup flow is stashed for now. To run it instead of the grid:
//   import { startSetup } from "./setup/flow.js"
//   startSetup(app)
