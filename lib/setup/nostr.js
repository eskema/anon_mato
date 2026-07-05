// Intake screen ZERO: identity. window.nostr (NIP-07) provides the pubkey
// that seeds the world's derivation — 64 hex nibbles of land. There is no
// keyless mode: it's an extension key or (later) a generated one.
//
// HARD RULE: the extension is only ever asked on an explicit click — nothing
// prompts on load or on its own. The user hates sites that auto-ask; so do we.

import { theme, hitBox } from "../draw.js"

const REM = 16

export function NostrScreen() {
  let api = null
  let busy = false
  let error = null
  let connectBox = null
  let watch = 0 // polls for late-injected window.nostr — re-CHECKS presence only, never prompts

  const hasNostr = () => typeof window !== "undefined" && !!window.nostr?.getPublicKey

  function enter(a) {
    api = a
    busy = false
    error = null
    connectBox = null
    // extensions can inject window.nostr after us (even after window load) —
    // watch for it so the "connect" button appears without a manual reload
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

  const cursor = on => (document.body.style.cursor = on ? "pointer" : "default")

  function onPointerMove(p) {
    cursor(!busy && hitBox(connectBox, p))
  }

  function onPointerDown(p) {
    if (busy) return
    if (hitBox(connectBox, p)) connect() // the ONLY path to the extension prompt
  }

  // A centred text line; returns its hit box (padded) for pointer checks.
  function line(ctx, L, y, text, px, alpha) {
    ctx.font = `600 ${px}px system-ui, sans-serif`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.globalAlpha = alpha
    ctx.fillText(text, L.cx, y)
    ctx.globalAlpha = 1
    const w = ctx.measureText(text).width
    return { x: L.cx - w / 2 - REM / 2, y: y - px / 2 - REM / 4, w: w + REM, h: px + REM / 2 }
  }

  function draw(ctx, L) {
    const ink = theme("--text", "#eee")
    ctx.fillStyle = ink
    connectBox = null

    if (busy) {
      line(ctx, L, L.cy, "asking your extension…", 2 * REM, 0.9)
      return
    }
    if (hasNostr()) {
      connectBox = line(ctx, L, L.cy - REM, "connect nostr", 2 * REM, 0.9)
    } else {
      line(ctx, L, L.cy - REM, "no nostr extension found", 2 * REM, 0.4)
      line(ctx, L, L.cy + 2.5 * REM, "install a NIP-07 extension to play", REM, 0.5)
    }
    if (error) line(ctx, L, L.cy + 5 * REM, error, REM, 0.6)
  }

  return {
    id: "nostr",
    enter,
    leave() {
      stopWatch()
      cursor(false)
    },
    onPointerMove,
    onPointerDown,
    onPointerUp() {},
    onDoubleClick() {},
    draw
  }
}
