// WHO IS PLAYING — the one thing the game knows before it knows anything else,
// and the one thing it must not ask for twice.
//
// The pubkey is remembered the moment an extension hands it over (the key phase, grid.js),
// so a reload part-way through setup resumes without prompting, and the world's
// save — which doesn't exist until setup finishes — never has to carry it alone.
//
// The PROFILE (the display name, and the relay/follow counts the identity card
// reads out) is a NETWORK fact: it arrives seconds late, or not at all offline.
// So it's cached beside the key and served instantly on the next load, with a
// LIVE subscription running behind it that corrects anything that changed — and
// goes on correcting it for as long as the page is open. Cache first, truth
// shortly after, and truth again whenever it moves: the screen is never blank
// waiting for a relay, and never stale once one speaks.
//
// Everything is keyed BY PUBKEY: a different key reads nothing, so one person's
// name can never be shown over another's identity.

import { SimplePool } from "./vendor/nostr-pool.js"

const STORE = "anon&mato:identity"

// THE WATCH — one per identity, and it STAYS OPEN. The relays are not asked a
// question and hung up on: they are SUBSCRIBED to, for the session. kind-0
// (profile), kind-3 (follows) and kind-10002 (the key's own relays) are one
// filter on the bootstrap set, and the key's relays join the watch the moment
// its list lands. Every event is folded in and handed to the screen as it
// arrives — including a LATER one: a name changed, a follow added, a relay list
// rewritten, all land the same way and simply update what is shown. Only the
// SETUP waits, and only for the kind-0; everything else catches up behind it.
// Display only, best-effort, offline-tolerant, and it never prompts or signs.
// Every answer is a fact worth caching, "there is none" (false) included.
const BOOTSTRAP = ["wss://purplepag.es", "wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"]
const WAIT_MS = 4000 // the longest the SCREEN waits — past it we carry on with what we know
const EXTRA_RELAYS = 4 // …and how many of the key's own write relays join the watch
const KINDS = [0, 3, 10002]

const host = u => String(u).toLowerCase().replace(/\/+$/, "")

let watch = null // { pubkey, pool, out, at, heard, onUpdate, done }

// …and it is dropped only when the identity itself is: a key we no longer hold
// is a watch on someone else.
export function forgetWatch() {
  const w = watch
  watch = null
  try {
    w?.pool.destroy()
  } catch {}
}

export function watchProfile(pubkey, onUpdate = null) {
  if (!isPubkey(pubkey)) return Promise.resolve(null)
  const key = pubkey.toLowerCase()
  if (watch?.pubkey === key) {
    if (onUpdate) watch.onUpdate = onUpdate
    return watch.named // already listening: the same promise, and the same subscriptions
  }
  forgetWatch()
  let settle = null
  const named = new Promise(res => (settle = res))
  const w = {
    pubkey: key,
    pool: new SimplePool(),
    out: { name: undefined, picture: undefined, relays: undefined, follows: undefined, ...(savedProfile(key) || {}) },
    at: {}, // …the newest we have heard of each kind, so a stale copy off a slow relay is not news
    heard: new Set(BOOTSTRAP.map(host)),
    onUpdate,
    named,
    done: false
  }
  watch = w
  const finish = () => {
    if (w.done) return
    w.done = true
    clearTimeout(cap)
    settle({ ...w.out })
  }
  const cap = setTimeout(finish, WAIT_MS) // …nothing answered: carry on with what was cached
  if (w.out.name !== undefined) finish() // …and a name already cached IS an answer: the screen goes on, the watch corrects it if it moved

  const take = ev => {
    if (w !== watch || !ev || !(ev.created_at > (w.at[ev.kind] || 0))) return
    w.at[ev.kind] = ev.created_at
    if (ev.kind === 0) {
      w.out.name = false
      w.out.picture = false
      try {
        const meta = JSON.parse(ev.content)
        w.out.name = meta.display_name || meta.name || false
        // a face, if they published one — http(s) only, and never a data: URI
        w.out.picture = /^https?:\/\//i.test(meta.picture || "") ? meta.picture : false
      } catch {}
      finish() // …THIS is the one the setup is waiting for
    } else if (ev.kind === 3) {
      w.out.follows = ev.tags.filter(t => t[0] === "p").length
    } else if (ev.kind === 10002) {
      const rTags = ev.tags.filter(t => t[0] === "r" && t[1])
      w.out.relays = rTags.length
      listen(rTags.filter(t => t[2] !== "read").map(t => t[1])) // …and their own relays join the watch
    }
    rememberProfile(key, w.out) // …so the next load has it before a relay answers
    w.onUpdate?.({ ...w.out })
  }
  // …and when every relay has said it has nothing more, what we never heard is
  // a real answer: asked, and there is none.
  const nothingMore = () => {
    if (w !== watch) return
    for (const k of ["name", "picture", "relays", "follows"]) if (w.out[k] === undefined) w.out[k] = false
    rememberProfile(key, w.out)
    finish()
    w.onUpdate?.({ ...w.out })
  }
  const listen = urls => {
    const fresh = urls.filter(u => u && !w.heard.has(host(u))).slice(0, EXTRA_RELAYS)
    if (!fresh.length) return
    for (const u of fresh) w.heard.add(host(u))
    try {
      w.pool.subscribe(fresh, { kinds: KINDS, authors: [key] }, { onevent: take })
    } catch {}
  }
  try {
    w.pool.subscribe(BOOTSTRAP, { kinds: KINDS, authors: [key] }, { onevent: take, oneose: nothingMore })
  } catch {
    nothingMore()
  }
  return named
}

const isPubkey = v => typeof v === "string" && /^[0-9a-f]{64}$/i.test(v)

function read() {
  try {
    const raw = localStorage.getItem(STORE)
    const v = raw ? JSON.parse(raw) : null
    return v && isPubkey(v.pubkey) ? v : null
  } catch {
    return null // unreadable or storage blocked — behave as though nothing is known
  }
}
function write(v) {
  try {
    localStorage.setItem(STORE, JSON.stringify(v))
  } catch {} // storage blocked — play on, and ask again next time
}

// The key we've been given before, or null. Setup opens on the step AFTER this.
export function savedPubkey() {
  const v = read()
  return v ? v.pubkey.toLowerCase() : null
}

// …remembered the moment it lands. A DIFFERENT key wipes what was cached with
// the old one: the name belonged to that identity, not to this browser.
export function rememberPubkey(pk) {
  if (!isPubkey(pk)) return
  const key = pk.toLowerCase()
  const v = read()
  write(v && v.pubkey.toLowerCase() === key ? { ...v, pubkey: key } : { pubkey: key })
}

// What we last heard about that key: { name, relays, follows } — any of them
// undefined if it was never answered. Only ever returned for the key it was
// stored against.
export function savedProfile(pubkey) {
  const v = read()
  if (!v || !isPubkey(pubkey) || v.pubkey.toLowerCase() !== pubkey.toLowerCase()) return null
  const { name, picture, relays, follows } = v
  return name === undefined && relays === undefined && follows === undefined ? null : { name, picture, relays, follows }
}

// …and what the lookup found, folded in. `false` is a real answer (asked, and
// there is none) and is worth caching as much as a name is.
export function rememberProfile(pubkey, { name, picture, relays, follows } = {}) {
  if (!isPubkey(pubkey)) return
  const key = pubkey.toLowerCase()
  const v = read()
  const base = v && v.pubkey.toLowerCase() === key ? v : { pubkey: key }
  write({ ...base, pubkey: key, name, picture, relays, follows })
}

// "Reset everything" spends this: no key, no name, and screen zero asks again.
export function forgetIdentity() {
  forgetWatch() // …and the relays we were listening to on that key's behalf
  try {
    localStorage.removeItem(STORE)
  } catch {}
}
