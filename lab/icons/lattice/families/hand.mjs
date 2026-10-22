// the user's own hand-drawn set (copied from the game's lib/icons.js WEDGE_ICONS) — REFERENCE ONLY, never edit
import fs from "node:fs"
import { fromData } from "../lat.mjs"
const HAND = JSON.parse(fs.readFileSync(new URL("../hand.json", import.meta.url)))
export const family = "hand"
export const icons = Object.fromEntries(Object.entries(HAND).map(([k, d]) => [k, { title: k, draw: () => fromData(d) }]))
