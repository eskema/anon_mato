// The ordered setup flow.
//
// Each step pairs a screen (a factory) with `apply(store, value)`, which folds
// the screen's committed value into the shared store: it records the raw input
// and derives whatever player/environment data comes from it.
//
// This is the first of several intake screens. Append new steps in order.

import { NostrScreen } from "./nostr.js"
import { ConfirmScreen } from "./confirm.js"
import { deriveFromAngle, deriveFromPubkey } from "../derive.js"
import { savedPubkey, rememberPubkey } from "../identity.js"

// THE KEY IS REMEMBERED THE MOMENT IT ARRIVES, before anything is built with
// it. Asking an extension for the same key twice is the kind of thing this game
// promises not to do: setup is one prompt, ever, per identity. It's kept beside
// the cached profile (identity.js) rather than in the save, which doesn't exist
// until the world is finished — so a reload part-way through setup resumes at
// the step AFTER it.
export const SETUP = [
  {
    id: "nostr",
    screen: () => NostrScreen(),
    apply(store, value) {
      store.inputs.pubkey = value
      rememberPubkey(value) // …the moment it lands, before it's derived from
      deriveFromPubkey(store, value)
    }
  },
  {
    // the identity card hosts the angle picker too — one screen, no "next"
    id: "confirm",
    screen: store => ConfirmScreen(store),
    apply(store, value) {
      // continuing a matching saved game carries its own angle
      store.player.resume = !!value.resume
      if (value.resume) return
      store.inputs.angle = value.angle
      deriveFromAngle(store, value.angle)
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
  // a key we've already been given is a step already taken: fold it into the
  // store exactly as its own commit would have, and open on the one after it
  const known = savedPubkey()
  if (known) {
    SETUP[0].apply(app.store, known)
    stepIndex = 1
  }
  app.onCommit(value => {
    const r = SETUP[stepIndex].apply(app.store, value)
    stepIndex = r === "finish" ? SETUP.length : stepIndex + 1
    if (stepIndex < SETUP.length) app.setScreen(SETUP[stepIndex].screen(app.store))
    else if (onDone) onDone(app.store)
    else console.log("[thrive] setup complete", app.store)
  })
  app.setScreen(SETUP[stepIndex].screen(app.store))
}
