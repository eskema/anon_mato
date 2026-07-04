// The ordered setup flow.
//
// Each step pairs a screen (a factory) with `apply(store, value)`, which folds
// the screen's committed value into the shared store: it records the raw input
// and derives whatever player/environment data comes from it.
//
// This is the first of several intake screens. Append new steps in order.

import { AngleScreen } from "./angle.js"
import { deriveFromAngle } from "../derive.js"

export const SETUP = [
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
export function startSetup(app, onDone) {
  let stepIndex = 0
  app.onCommit(value => {
    SETUP[stepIndex].apply(app.store, value)
    stepIndex++
    if (stepIndex < SETUP.length) app.setScreen(SETUP[stepIndex].screen())
    else if (onDone) onDone(app.store)
    else console.log("[thrive] setup complete", app.store)
  })
  app.setScreen(SETUP[0].screen())
}
