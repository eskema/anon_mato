// The ordered setup flow.
//
// Each step pairs a screen (a factory) with `apply(store, value)`, which folds
// the screen's committed value into the shared store: it records the raw input
// and derives whatever player/environment data comes from it.
//
// This is the first of several intake screens. Append new steps in order.

import { NostrScreen } from "./nostr.js"
import { ConfirmScreen } from "./confirm.js"
import { AngleScreen } from "./angle.js"
import { deriveFromAngle, deriveFromPubkey } from "../derive.js"

export const SETUP = [
  {
    id: "nostr",
    screen: () => NostrScreen(),
    apply(store, value) {
      store.inputs.pubkey = value
      deriveFromPubkey(store, value)
    }
  },
  {
    id: "confirm",
    screen: store => ConfirmScreen(store),
    apply(store, value) {
      // continuing a matching saved game skips the rest of setup entirely
      store.player.resume = !!value.resume
      if (value.resume) return "finish"
    }
  },
  {
    id: "angle",
    screen: () => AngleScreen(),
    apply(store, value) {
      store.inputs.angle = value
      deriveFromAngle(store, value)
    }
  }
  // ...more intake screens go here, in order.
]

// Mounts the setup flow onto the app: wires commit handling and shows the
// first intake screen. `onDone(store)` fires once every step is committed —
// the caller seeds the game from the derived store and takes the screen over.
// A step's apply() may return "finish" to short-circuit the remaining steps.
export function startSetup(app, onDone) {
  let stepIndex = 0
  app.onCommit(value => {
    const r = SETUP[stepIndex].apply(app.store, value)
    stepIndex = r === "finish" ? SETUP.length : stepIndex + 1
    if (stepIndex < SETUP.length) app.setScreen(SETUP[stepIndex].screen(app.store))
    else if (onDone) onDone(app.store)
    else console.log("[thrive] setup complete", app.store)
  })
  app.setScreen(SETUP[0].screen(app.store))
}
