// THE STORED KEYS — every name this game keeps in the browser's storage, in
// one place, under one neutral prefix. The prefix is NOT the game's title: the
// title has changed before and may again, and a key that changes orphans what
// was stored under it. Never rename a key here — add the new one, and put the
// old name in MOVES so what it holds is carried over.
export const NS = "hex:"

export const KEYS = {
  save: NS + "save", // the live game (sim.serialize()); the shelf's parked games, rejects and restores hang off it
  identity: NS + "identity", // who you are: the remembered pubkey and profile
  icons: NS + "icons", // the icon creator's saved designs
  freeCam: NS + "freecam", // the free-pan camera, on or off
  fanSeats: NS + "fanseats", // the menu's kept seats, per category
  timelineClosed: NS + "timelineclosed", // the timeline's closed levels, per category
  makeFolded: NS + "makefolded", // the make block's folded rows, by heading
  perf: NS + "perf", // the frame-time readout, on or off (a dev helper)
  labAnimate: NS + "lab:animate", // the animation lab's open element
  labMenuOpen: NS + "lab:menu-open", // …its menu-open bench
  labMenuClose: NS + "lab:menu-close", // …its menu-close bench
  labFreeSize: NS + "lab:free-icons:size", // the free icon gallery's tile size…
  labFreeTheme: NS + "lab:free-icons:theme", // …and theme
  labIconsSize: NS + "lab:icons:size", // the lattice icon gallery's tile size…
  labIconsTheme: NS + "lab:icons:theme", // …and theme
  labGlMotifs: NS + "lab:gpu-map:motifs", // the GPU map lab's motif for each kind…
  labGlStrength: NS + "lab:gpu-map:strength", // …and how dark their lines are
  labFigure: NS + "lab:figure", // the figure lab's pose, skeleton and loop
  moved: NS + "moved" // set once the old names below have been carried over
}

// THE OLD NAMES, newest first: what each key was stored under before
const MOVES = [
  [KEYS.save, "anon&mato:save"],
  [KEYS.identity, "anon&mato:identity"],
  [KEYS.icons, "anon&mato:icons"],
  [KEYS.freeCam, "anon_mato-freecam", "thrive-freecam"],
  [KEYS.fanSeats, "anon_mato-fanseats", "thrive-fanseats"],
  [KEYS.timelineClosed, "anon_mato-timelineclosed"],
  [KEYS.labAnimate, "anon_mato.lab.animate.current"],
  [KEYS.labMenuOpen, "anon_mato.lab.menu-open"],
  [KEYS.labMenuClose, "anon_mato.lab.menu-close"],
  [KEYS.labFreeSize, "amFreeSize"],
  [KEYS.labFreeTheme, "amFreeTheme"],
  [KEYS.labIconsSize, "amIconsSize"],
  [KEYS.labIconsTheme, "amIconsTheme"]
]
// …and whole families, by prefix: the shelf's parked games (":game:…"), the
// rejected save and the one kept before a restore
const PREFIX_MOVES = [["anon&mato:save:", KEYS.save + ":"]]

// THE MOVE, ONCE PER BROWSER, as soon as anything imports this: each old name
// is copied to its key here where that key is still empty, and the old copy
// is left where it was, so nothing stored can be lost. Once only — a key the
// game empties later (a new game clears the save) must not be refilled from
// an old name on the next load.
function moveOldKeys() {
  try {
    const ls = localStorage
    if (ls.getItem(KEYS.moved)) return
    const copy = (from, to) => {
      if (ls.getItem(to) != null) return
      const v = ls.getItem(from)
      if (v != null) ls.setItem(to, v)
    }
    for (const [to, ...olds] of MOVES) for (const from of olds) copy(from, to)
    const all = []
    for (let i = 0; i < ls.length; i++) all.push(ls.key(i))
    for (const [oldP, newP] of PREFIX_MOVES) for (const k of all) if (k && k.startsWith(oldP)) copy(k, newP + k.slice(oldP.length))
    ls.setItem(KEYS.moved, "1")
  } catch {} // storage blocked — nothing to carry
}
moveOldKeys()
