// Intake screen ZERO: identity. window.nostr (NIP-07) provides the pubkey that
// seeds the world's derivation — 64 hex nibbles of land. There is no keyless
// mode: it's an extension key or (later) a generated one.
//
// The screen is already the game: the whole board is fog, and the one thing in
// it is the home centre — undiscovered, so a single frontier dot. Hovering it
// peers into the fog and the world's own label names it; clicking discovers
// it, which is to say asks for the key. At that click the title takes its
// corner and stays there — through this screen, the next, and the world after.
//
// HARD RULE: the extension is only ever asked on an explicit click — nothing
// prompts on load or on its own. The user hates sites that auto-ask; so do we.
// The tile IS that click.

import { TITLE } from "../render.js"
import { createStage } from "./stage.js"
import { Fades } from "./fade.js"

export function NostrScreen() {
  let api = null
  let busy = false
  let error = null
  let hot = false // is the pointer on the tile?
  let pointer = null // …and where it is (the label rides it)
  let watch = 0 // polls for late-injected window.nostr — re-CHECKS presence only, never prompts
  const stage = createStage()
  let fades = null

  const hasNostr = () => typeof window !== "undefined" && !!window.nostr?.getPublicKey

  function enter(a) {
    api = a
    busy = false
    error = null
    fades = Fades(() => api.requestRender())
    document.body.style.cursor = "none" // ours stands in, as it does in the world
    // extensions can inject window.nostr after us (even after window load) —
    // watch for it so the tile goes live without a manual reload
    if (!hasNostr()) {
      watch = setInterval(() => {
        if (!hasNostr()) return
        clearInterval(watch)
        watch = 0
        api.requestRender()
      }, 300)
    }
  }

  function stopWatch() {
    if (watch) clearInterval(watch)
    watch = 0
  }

  async function connect() {
    busy = true
    error = null
    api.requestRender()
    let pk = null
    try {
      pk = await window.nostr.getPublicKey()
    } catch {
      error = "connection refused"
    }
    busy = false
    if (pk != null) {
      if (typeof pk === "string" && /^[0-9a-f]{64}$/i.test(pk.trim())) {
        api.commit(pk.trim().toLowerCase())
        return
      }
      error = "that didn't look like a pubkey"
    }
    api.requestRender()
  }

  function onPointerMove(p) {
    pointer = p
    hot = hasNostr() && !busy && stage.onCentre(p)
    api.requestRender() // our cursor and its label both ride the pointer
  }

  function onPointerDown(p) {
    if (busy || !hasNostr()) return
    if (stage.onCentre(p)) connect() // the ONLY path to the extension prompt
  }

  // Everything the screen has to say about itself, as cells beside the title —
  // asking, refused, or no extension at all. Null while there's nothing to say,
  // which before the click is the whole point: an untouched world says nothing.
  function statusCells() {
    if (busy) return [{ text: "asking your extension…", alpha: 0.6 }]
    if (error) return [{ text: error, alpha: 0.6 }]
    if (!hasNostr()) {
      return [
        { text: "no nostr extension found", alpha: 0.6 },
        { text: "install a NIP-07 one to play", alpha: 0.6 }
      ]
    }
    return null
  }

  function draw(ctx, L) {
    stage.place(L)
    const dress = stage.night(ctx, L) // day one begins at 00:00: no light yet
    const ink = dress.ink

    // the title takes its corner the moment there's anything to report — the
    // click that asks for the key, or the reason we can't. Flush to the corner
    // and UNDER the world: the chrome is part of the page, not floating on it,
    // and it fades back out of the way while the pointer is on it.
    const status = statusCells()
    if (status) {
      const row = { cells: [{ text: TITLE }, ...status] }
      stage.chrome(ctx, fades, pointer, "title", [row], { left: 0, top: 0 }, fades.at("title"))
    }

    // the fog is the canvas; the home centre is the one mark in it
    stage.drawCentre(ctx, ink, { hovered: hot })
    if (hot && pointer) stage.label(ctx, L, pointer, [{ text: TITLE }])

    stage.cursor(ctx, pointer, dress)
  }

  return {
    id: "nostr",
    enter,
    leave() {
      stopWatch()
      fades?.stop()
      hot = false
    },
    onPointerMove,
    onPointerDown,
    onPointerUp() {},
    onDoubleClick() {},
    draw
  }
}
