// Intake screen: the identity card — and, in the same breath, the angle.
//
// Still the game, and still the same screen: the tile keeps its outline, the
// title keeps the corner it took on the click, and the angle picker draws on
// the world's own clock. There is no "next" button and no yes/no — you aim,
// you hold the angle, and then you click YOURSELF. The player standing on the
// home centre is the only OK this screen has.
//
// The key states itself in the bottom corner, one box at a time, stacking up
// off the edge: the pubkey lands first and stays where it lands, the npub
// arrives on top of it, then — once the network answers — the profile row, its
// facts each in their own box. Nothing already placed moves again. The
// lookup is display-only, best-effort and offline-tolerant: kind-10002 (NIP-65
// relays) from bootstrap relays, then kind-0 (profile) and kind-3 (follows)
// from the key's own write relays. Nothing here prompts or signs.

import { hitBox } from "../draw.js"
import * as nip19 from "../vendor/nostr-nip19.js"
import { savedWorld } from "../grid.js"
import { savedProfile, lookupProfile } from "../identity.js"
import { TITLE, identityLabel } from "../render.js"
import { AngleScreen } from "./angle.js"
import { createStage } from "./stage.js"
import { Fades } from "./fade.js"

const NPUB_DELAY = 320 // the npub arrives once the pubkey has landed, not with it

export function ConfirmScreen(store) {
  const pubkey = store.player.pubkey
  const npub = nip19.npubEncode(pubkey)
  let api = null
  let alive = false
  let saved = null // matching saved game ({angle, pubkey, day}) or null
  // network facts: undefined = loading ("…"), false = not found ("—")
  let relays
  let name
  let follows
  let resumeBox = null
  let pointer = null // our own cursor rides it, and the ray follows it
  let fades = null

  // the same stage as screen zero, rebuilt with the key now inscribing it
  const stage = createStage(pubkey)
  // the angle picker, hosted here: it reads the angle off the world's own dial
  // — the home tile's dot at the middle, the day's clock as the face
  // …and the world's tile size with it, so the trail's arrowheads are cut to the
  // same cloth as the ones you'll follow in the game a moment later
  const picker = AngleScreen({
    centreDot: false,
    centre: () => stage.geom(),
    radius: () => stage.dialR(),
    tile: () => stage.geom().size,
    home: p => stage.onCentre(p) // the compass snaps to the centre on the tile's own hit
  })

  function enter(a) {
    api = a
    alive = true
    fades = Fades(() => api.requestRender())
    document.body.style.cursor = "none" // ours stands in, as it does in the world
    const w = savedWorld()
    saved = w && w.pubkey === pubkey ? w : null
    // WHAT WE ALREADY KNOW SHOWS AT ONCE. The lookup below still runs and still
    // corrects it — but a name we were told yesterday is a better first frame
    // than three dots while a relay thinks about it.
    const cached = savedProfile(pubkey)
    if (cached) {
      name = cached.name
      relays = cached.relays
      follows = cached.follows
    }
    // the picker never commits — it only holds an angle; the player is the OK
    picker.enter({
      get layout() {
        return api.layout
      },
      requestRender: () => api.requestRender()
    })
    lookup()
  }

  // …and the lookup behind it, which is identity.js's (the game's corner block
  // asks with the same call). It caches what it finds, so the next load — and
  // the world after it — has the name before a relay has said a word.
  async function lookup() {
    const p = await lookupProfile(pubkey)
    if (!alive || !p) return
    name = p.name
    relays = p.relays
    follows = p.follows
    api.requestRender()
  }

  function onPointerMove(p) {
    pointer = p
    picker.onPointerMove(p)
    api.requestRender() // our cursor dot rides the pointer
  }

  function onPointerDown(p) {
    if (hitBox(resumeBox, p)) return api.commit({ resume: true })
    if (picker.onPointerDown(p)) return
    // THE MIDDLE IS THE OK, twice over. With the angle held, the first click
    // home STRIKES THE WORLD — the ceremony plays itself out (see angle.js) and
    // leaves a WAKE button standing on the tile. The second click is the one
    // that opens the world; nothing commits before it.
    const angle = picker.value()
    if (!angle || !stage.onCentre(p)) return
    if (picker.ready()) {
      // the tile shrinks away first, uncovering what stands under it — then we
      // commit, so the world opens out of that reveal rather than a cut
      if (picker.open()) {
        startLoop()
        setTimeout(() => api.commit({ resume: false, angle }), 560)
      }
      return
    }
    if (picker.begin()) startLoop()
  }

  // frames for the ceremony — it runs on its own clock, so nothing else is
  // moving to keep the screen alive while it does
  let raf = 0
  function startLoop() {
    if (raf) return
    const tick = () => {
      raf = 0
      api.requestRender()
      if (picker.animating()) startLoop()
    }
    raf = requestAnimationFrame(tick)
  }

  const show = v => (v === undefined ? "…" : v === false ? "—" : v)

  // The key, stacking UPWARD off the bottom edge. What's already there stays
  // put — the pubkey never leaves the corner it landed in; each arrival sits on
  // top of the one before it.
  // ONE LINE, THE REST ON HOVER (2026-08-10): the key used to stack three rows
  // up the corner — pubkey, npub, then the profile. It's one box now, the same
  // treatment the game gives your name: it says who you are (or "loading user"
  // until the relays answer), and hovering it opens the whole key beside the
  // cursor. See keyLabel below.
  function keyRows() {
    const who = name === undefined ? "loading user" : name === false ? "(no profile found)" : name
    return [{ key: "who", line: { text: who } }]
  }
  // …the hover's own readout: THE GAME'S OWN identity block (2026-08-28 — the
  // setup was drawing a different shape of the same facts). Same rows, same
  // furniture, same face box; the picture rides it once it's loaded.
  // the face, loaded once and kept (the game's corner does the same) — the
  // label draws it as its first box the moment the bytes land
  let picUrl = null
  let picImg = null
  const faceFor = url => {
    if (!url) return null
    if (url !== picUrl) {
      picUrl = url
      picImg = null
      const img = new Image()
      img.onload = () => {
        if (picUrl === url) picImg = img
        api?.requestRender()
      }
      img.onerror = () => {
        if (picUrl === url) picImg = null
      }
      img.src = url
    }
    return picImg
  }
  const meBlock = () => ({
    pic: faceFor(savedProfile(pubkey)?.picture || null),
    rows: [
      ["npub", `${npub.slice(0, 12)}…${npub.slice(-4)}`],
      ["pubkey", `${pubkey.slice(0, 12)}…${pubkey.slice(-4)}`],
      ["relays", show(relays)],
      ["follows", show(follows)]
    ]
  })

  function draw(ctx, L) {
    resumeBox = null
    stage.place(L)
    const dress = stage.night(ctx, L) // still 00:00 — the world hasn't lit yet
    const ink = dress.ink
    // …and THE SKY, brought in over the ceremony's big turn, so the wheel
    // lands under a sky that is already there (2026-08-28)
    stage.sky(ctx, L, dress, picker.skyIn())

    // THE CHROME GOES DOWN FIRST — it lives under the world, so the clock, the
    // ray and the reading all cross over it. And it steps aside: a box under
    // the pointer fades back so it isn't in the way of what you're aiming at.
    const boxes = []
    const title = [{ text: TITLE }]
    boxes.push(stage.chrome(ctx, fades, pointer, "title", title, { left: 0, top: 0 }, fades.at("title", { instant: true })))
    let bottom = L.h // flush to the edge — the chrome is part of the page
    for (const row of keyRows()) {
      const arrive = fades.at(row.key, { delay: row.delay || 0 })
      boxes.push(stage.chrome(ctx, fades, pointer, row.key, [row.line], { left: 0, bottom }, arrive))
      bottom = boxes[boxes.length - 1].y
    }
    // …and hovering that one line opens the key beside the cursor
    {
      const kb = boxes[boxes.length - 1]
      if (pointer && kb && hitBox(kb, pointer)) identityLabel(ctx, L, pointer, meBlock(), ink)
    }
    // a matching save is the one other thing you can do here
    if (saved) {
      const line = [{ text: `continue · day ${saved.day}` }]
      resumeBox = stage.chrome(ctx, fades, pointer, "resume", line, { right: L.w, bottom: L.h }, fades.at("resume"))
      boxes.push(resumeBox)
    }

    // The tile is still just a dot: NO HEXAGON YET (2026-08-05). How the shape
    // arrives is being worked out at the compass — see angle.js — so the middle
    // stays the frontier mark it starts as, and lights when reached for. Then
    // the segment and the ray over it (and a second pass inside the boxes, so
    // the line reads on paper as well as on the dark).
    // the tile's own six edges are laid down by the ceremony, as the wheel turns
    // home; before that the middle is the frontier mark it starts as
    const fill = picker.tileFill()
    stage.drawCentre(ctx, ink, { discovered: fill > 0, hovered: stage.onCentre(pointer), fill })
    picker.draw(ctx, L, dress)
    stage.overChrome(ctx, boxes, d => picker.draw(ctx, L, d))
    // …and when it's all drawn, the way in: the same wake button a night ends on
    if (picker.ready()) stage.drawWake(ctx, 1, picker.openAmt())
    // (the FIGURE no longer appears on hover, 2026-08-05 — the middle stays bare
    // while the drawing is being worked out. The click on it still commits: what
    // finally stands there, and what says so, comes with the rest of the shape.)

    // …and our cursor, unless it's on the reading: the circle it lit up is the
    // mark for that spot, and a dot inside it is one mark too many
    if (!picker.onReading()) stage.cursor(ctx, pointer, dress)
  }

  return {
    id: "confirm",
    enter,
    leave() {
      alive = false
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      fades?.stop()
    },
    onPointerMove,
    onPointerDown,
    onPointerUp() {},
    onDoubleClick() {},
    draw
  }
}
