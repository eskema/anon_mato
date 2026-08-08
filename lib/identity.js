// WHO IS PLAYING — the one thing the game knows before it knows anything else,
// and the one thing it must not ask for twice.
//
// The pubkey is remembered the moment an extension hands it over (setup/flow.js),
// so a reload part-way through setup resumes without prompting, and the world's
// save — which doesn't exist until setup finishes — never has to carry it alone.
//
// The PROFILE (the display name, and the relay/follow counts the identity card
// reads out) is a NETWORK fact: it arrives seconds late, or not at all offline.
// So it's cached beside the key and served instantly on the next load, with the
// lookup still running behind it to correct anything that changed. Cache first,
// truth shortly after — the screen is never blank waiting for a relay.
//
// Everything is keyed BY PUBKEY: a different key reads nothing, so one person's
// name can never be shown over another's identity.

import { SimplePool } from "./vendor/nostr-pool.js"

const STORE = "anon&mato:identity"

// THE LOOKUP, in one place because two screens want it: the identity card at
// setup, and the corner block in the game when you ask it to try again. Display
// only, best-effort, offline-tolerant, and it never prompts or signs — kind-10002
// (NIP-65 relays) off the bootstrap relays, then kind-0 (profile) and kind-3
// (follows) off the key's own write relays. Every answer is a fact worth
// caching, "there is none" (false) included.
const BOOTSTRAP = ["wss://purplepag.es", "wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"]
const WAIT_MS = 4000
const settle = (p, ms) => Promise.race([p, new Promise(res => setTimeout(() => res(null), ms))])

export async function lookupProfile(pubkey) {
  if (!isPubkey(pubkey)) return null
  let pool = null
  let out = { name: undefined, picture: undefined, relays: undefined, follows: undefined }
  try {
    pool = new SimplePool()
    const rl = await settle(pool.get(BOOTSTRAP, { kinds: [10002], authors: [pubkey] }), WAIT_MS)
    const rTags = rl ? rl.tags.filter(t => t[0] === "r" && t[1]) : []
    out.relays = rl ? rTags.length : false
    const write = rTags.filter(t => t[2] !== "read").map(t => t[1]).slice(0, 4)
    const from = write.length ? write : BOOTSTRAP
    const [prof, contacts] = await Promise.all([
      settle(pool.get(from, { kinds: [0], authors: [pubkey] }), WAIT_MS),
      settle(pool.get(from, { kinds: [3], authors: [pubkey] }), WAIT_MS)
    ])
    out.name = false
    out.picture = false
    if (prof) {
      try {
        const meta = JSON.parse(prof.content)
        out.name = meta.display_name || meta.name || false
        // a face, if they published one — http(s) only, and never a data: URI
        out.picture = /^https?:\/\//i.test(meta.picture || "") ? meta.picture : false
      } catch {}
    }
    out.follows = contacts ? contacts.tags.filter(t => t[0] === "p").length : false
  } catch {
    out = { name: out.name ?? false, picture: out.picture ?? false, relays: out.relays ?? false, follows: out.follows ?? false }
  } finally {
    try {
      pool?.destroy()
    } catch {
      try {
        pool?.close(BOOTSTRAP)
      } catch {}
    }
  }
  rememberProfile(pubkey, out) // …so the next load has it before a relay answers
  return out
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
  try {
    localStorage.removeItem(STORE)
  } catch {}
}
