// Intake screen: the identity card. Shows what the key IS (npub + hex
// pubkey), then fills in what the network knows about it — kind-10002 (NIP-65
// relay list) from bootstrap relays, then kind-0 (profile) and kind-3
// (follows) from the key's own write relays. All display-only, best-effort
// and offline-tolerant: every line loads as "…" and settles to a value or "—".
//
// If a saved game matches the key, continuing it is the primary action;
// starting a new world (→ the angle picker) is always available.

import { theme, hitBox } from "../draw.js"
import * as nip19 from "../vendor/nostr-nip19.js"
import { SimplePool } from "../vendor/nostr-pool.js"
import { savedWorld } from "../grid.js"

const REM = 16
const BOOTSTRAP = ["wss://purplepag.es", "wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"]
const WAIT_MS = 4000

const settle = (p, ms) => Promise.race([p, new Promise(res => setTimeout(() => res(null), ms))])

export function ConfirmScreen(store) {
  const pubkey = store.player.pubkey
  let api = null
  let pool = null
  let alive = false
  let npub = ""
  let saved = null // matching saved game ({angle, pubkey, day}) or null
  // network facts: undefined = loading ("…"), false = not found ("—")
  let relays
  let name
  let follows
  let primaryBox = null
  let secondaryBox = null

  function enter(a) {
    api = a
    alive = true
    npub = nip19.npubEncode(pubkey)
    const w = savedWorld()
    saved = w && w.pubkey === pubkey ? w : null
    lookup()
  }

  // The network lookup: 10002 first (where do they write?), then 0 + 3 from
  // there. Reads public events only — nothing here prompts or signs.
  async function lookup() {
    pool = new SimplePool()
    try {
      const rl = await settle(pool.get(BOOTSTRAP, { kinds: [10002], authors: [pubkey] }), WAIT_MS)
      if (!alive) return
      const rTags = rl ? rl.tags.filter(t => t[0] === "r" && t[1]) : []
      relays = rl ? rTags.length : false
      api.requestRender()
      const write = rTags.filter(t => t[2] !== "read").map(t => t[1]).slice(0, 4)
      const from = write.length ? write : BOOTSTRAP
      const [prof, contacts] = await Promise.all([
        settle(pool.get(from, { kinds: [0], authors: [pubkey] }), WAIT_MS),
        settle(pool.get(from, { kinds: [3], authors: [pubkey] }), WAIT_MS)
      ])
      if (!alive) return
      name = false
      if (prof) {
        try {
          const meta = JSON.parse(prof.content)
          name = meta.display_name || meta.name || false
        } catch {}
      }
      follows = contacts ? contacts.tags.filter(t => t[0] === "p").length : false
    } catch {
      relays = relays ?? false
      name = name ?? false
      follows = follows ?? false
    }
    if (alive) api.requestRender()
  }

  const cursor = on => (document.body.style.cursor = on ? "pointer" : "default")

  function onPointerMove(p) {
    cursor(hitBox(primaryBox, p) || hitBox(secondaryBox, p))
  }

  function onPointerDown(p) {
    if (hitBox(primaryBox, p)) {
      cursor(false)
      api.commit({ resume: !!saved })
    } else if (hitBox(secondaryBox, p)) {
      cursor(false)
      api.commit({ resume: false })
    }
  }

  function line(ctx, L, y, text, px, alpha, mono = false) {
    ctx.font = `600 ${px}px ${mono ? "ui-monospace, monospace" : "system-ui, sans-serif"}`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.globalAlpha = alpha
    ctx.fillText(text, L.cx, y)
    ctx.globalAlpha = 1
    const w = ctx.measureText(text).width
    return { x: L.cx - w / 2 - REM / 2, y: y - px / 2 - REM / 4, w: w + REM, h: px + REM / 2 }
  }

  const show = v => (v === undefined ? "…" : v === false ? "—" : v)

  function draw(ctx, L) {
    const ink = theme("--text", "#eee")
    ctx.fillStyle = ink
    primaryBox = secondaryBox = null
    let y = L.cy - 8 * REM

    // the key itself: npub is the name, hex is the substance (61 tiles of it)
    line(ctx, L, y, npub.slice(0, 32), REM, 0.9, true)
    y += 1.5 * REM
    line(ctx, L, y, npub.slice(32), REM, 0.9, true)
    y += 2.5 * REM
    line(ctx, L, y, pubkey.slice(0, 32), REM, 0.35, true)
    y += 1.5 * REM
    line(ctx, L, y, pubkey.slice(32), REM, 0.35, true)
    y += 3 * REM

    // what the network knows — settles line by line
    line(ctx, L, y, name === undefined ? "…" : name === false ? "(no profile found)" : name, REM, 0.7)
    y += 1.5 * REM
    line(ctx, L, y, `relays ${show(relays)} · follows ${show(follows)}`, REM, 0.5)
    y += 4 * REM

    if (saved) {
      primaryBox = line(ctx, L, y, `continue · day ${saved.day}`, 2 * REM, 0.9)
      y += 3 * REM
      secondaryBox = line(ctx, L, y, "start a new world", REM, 0.5)
    } else {
      primaryBox = line(ctx, L, y, "choose your angle", 2 * REM, 0.9)
    }
  }

  return {
    id: "confirm",
    enter,
    leave() {
      alive = false
      cursor(false)
      try {
        pool?.destroy()
      } catch {
        try {
          pool?.close(BOOTSTRAP)
        } catch {}
      }
      pool = null
    },
    onPointerMove,
    onPointerDown,
    onPointerUp() {},
    onDoubleClick() {},
    draw
  }
}
