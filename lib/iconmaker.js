// Icon creator — a pointy-top hex laid out as an isometric cube's triangular
// lattice: 3 rhombus faces meeting at the centre, subdivided 8×8 and split on the
// SHORT diagonal into equilateral WEDGES. Click a wedge to toggle it. The line
// tool draws segments that snap to the triangle corners — never freehand.
//
// Full-bleed responsive layout (fills its mount): a BIG centred hex, the saved-
// items list top-left, tools as a footer, back-arrow + title on top. Designs
// persist to localStorage; the selected item is a LIVE preview and its name is
// editable inline. Self-contained (injects its own CSS) — used on styles.html
// AND in game (the cube view, see cube.js).

import { theme } from "./draw.js"
import { WEDGE_ICONS, reloadIconOverrides, DEFAULT_LABEL, labelOf, iconKey } from "./icons.js"

// ONE GROUP PER NAME. The list holds one cell per icon group, showing its
// `default` design; open a group and its VERSIONS appear in the strip along the
// bottom, each under its own label. Any label you like, as many as you like —
// what the game does with them is the game's business (see drawIcon's `label`);
// here they're just canvases that share a name.

const STORE = "anon&mato:icons"
const N = 8 // fixed grid resolution for now
const ink = () => theme("--text", "#eee")
const surface = () => theme("--surface", "#111")
const SQ = Math.sqrt(3) / 2

const A = [-SQ, -0.5]
const B = [SQ, -0.5]
const C = [0, 1]
const FACES = [
  [A, B],
  [A, C],
  [B, C]
]
const HEX = [
  [0, -1],
  [SQ, -0.5],
  [SQ, 0.5],
  [0, 1],
  [-SQ, 0.5],
  [-SQ, -0.5]
]

function wedgeTri(id, n) {
  const [f, i, j, h] = id.split(":").map(Number)
  const [e1, e2] = FACES[f]
  const P = (a, b) => [(a / n) * e1[0] + (b / n) * e2[0], (a / n) * e1[1] + (b / n) * e2[1]]
  const p00 = P(i, j)
  const p11 = P(i + 1, j + 1)
  return h === 0 ? [p00, P(i + 1, j), p11] : [p00, p11, P(i, j + 1)]
}

function buildGrid(n) {
  const tris = []
  const vmap = new Map()
  const vkey = (x, y) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)}`
  const addV = (x, y) => {
    const k = vkey(x, y)
    if (!vmap.has(k)) vmap.set(k, { x, y })
  }
  FACES.forEach(([e1, e2], f) => {
    const P = (i, j) => [(i / n) * e1[0] + (j / n) * e2[0], (i / n) * e1[1] + (j / n) * e2[1]]
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const p00 = P(i, j)
        const p10 = P(i + 1, j)
        const p11 = P(i + 1, j + 1)
        const p01 = P(i, j + 1)
        tris.push({ id: `${f}:${i}:${j}:0`, p: [p00, p10, p11] })
        tris.push({ id: `${f}:${i}:${j}:1`, p: [p00, p11, p01] })
        for (const q of [p00, p10, p11, p01]) addV(q[0], q[1])
      }
    }
  })
  return { tris, verts: [...vmap.values()] }
}

const cross = (px, py, a, b) => (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1])
function inTri(px, py, sp) {
  const [a, b, c] = sp
  const d1 = cross(px, py, a, b)
  const d2 = cross(px, py, b, c)
  const d3 = cross(px, py, c, a)
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
}

function loadItems() {
  try {
    return JSON.parse(localStorage.getItem(STORE)) || []
  } catch {
    return []
  }
}
function persist(items) {
  try {
    localStorage.setItem(STORE, JSON.stringify(items))
  } catch {}
}

// paint a design { n, fill, lines } clean (no grid) into ctx, hex sized to r at (x,y)
function paintDesign(ctx, data, x, y, r, outlineAlpha = 0.9) {
  const s = r * 0.9
  const P = ([px, py]) => [x + px * s, y + py * s]
  ctx.fillStyle = ink()
  ctx.globalAlpha = 1
  ctx.beginPath()
  for (const id of data.fill || []) {
    wedgeTri(id, data.n).forEach((p, k) => {
      const [ux, uy] = P(p)
      k ? ctx.lineTo(ux, uy) : ctx.moveTo(ux, uy)
    })
    ctx.closePath()
  }
  ctx.fill()
  if (outlineAlpha > 0) {
    ctx.strokeStyle = ink()
    ctx.globalAlpha = outlineAlpha
    ctx.lineWidth = Math.max(1, r * 0.03)
    ctx.lineJoin = ctx.lineCap = "round"
    ctx.beginPath()
    HEX.forEach((p, k) => {
      const [ux, uy] = P(p)
      k ? ctx.lineTo(ux, uy) : ctx.moveTo(ux, uy)
    })
    ctx.closePath()
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  ctx.lineWidth = Math.max(1, r * 0.04)
  for (const [ax, ay, bx, by] of data.lines || []) {
    const [x0, y0] = P([ax, ay])
    const [x1, y1] = P([bx, by])
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
  }
}

function injectCSS() {
  if (document.getElementById("im-css")) return
  const st = document.createElement("style")
  st.id = "im-css"
  st.textContent = `
    .im-root { position: relative; width: 100%; height: 100%; min-height: 520px; color: var(--text); overflow: hidden; }
    .im-canvas { position: absolute; inset: 0; margin: auto; touch-action: none;
      cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12'%3E%3Ccircle cx='6' cy='6' r='3' fill='%23888'/%3E%3C/svg%3E") 6 6, crosshair; }
    /* overlays only capture the mouse on their actual controls — everywhere else
       the pointer falls through to the canvas, so the list never "takes over" */
    .im-left, .im-tools, .im-edit { pointer-events: none; }
    .im-left { position: absolute; top: 10px; left: 8px; bottom: 10px; z-index: 3; display: flex; flex-direction: column; align-items: flex-start; gap: 12px; }
    /* wider than one hex so the hover name (which sits to the right) isn't clipped
       by the scroll box; the hex cells stay left-aligned and the empty space is
       click-through (the container is pointer-events:none) */
    .im-list { flex: 1; min-height: 0; width: 170px; overflow-y: auto; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
    /* the current design at 2× and its name, on one line, vertically centred */
    .im-cur { display: flex; flex-direction: row; align-items: center; gap: 12px; flex: none; }
    .im-cur canvas { display: block; }
    /* the name over the label of the version on the bench */
    .im-curtext { display: grid; gap: 2px; justify-items: start; }
    .im-label { pointer-events: auto; width: 190px; box-sizing: border-box; font: 600 12px system-ui, sans-serif;
      color: var(--text); background: transparent; border: none; padding: 0; opacity: .55; }
    .im-label:focus { opacity: 1; }
    /* list previews carry NO box frame — the hex outline itself is drawn only when
       selected/hovered (see paintDesign), so the box stays invisible */
    .im-item { pointer-events: auto; position: relative; cursor: pointer; }
    .im-item canvas { display: block; }
    .im-item .nm { position: absolute; left: 100%; top: 50%; transform: translateY(-50%); margin-left: 6px; z-index: 4;
      font: 600 11px system-ui, sans-serif; opacity: 0; white-space: nowrap; pointer-events: none;
      background: var(--surface); color: var(--text); padding: 1px 5px; border-radius: 3px; }
    .im-item:hover .nm { opacity: .9; }
    /* tools: flat text, one per line, top-aligned (like the bottom actions) */
    .im-tools { position: absolute; top: 10px; right: 12px; z-index: 3; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
    .im-toolbtn { pointer-events: auto; font: 600 12px system-ui, sans-serif; color: var(--text); background: none; border: none;
      padding: 0; cursor: pointer; opacity: .5; }
    .im-toolbtn:hover { opacity: .85; }
    .im-toolbtn.sel { opacity: 1; }
    /* nudge d-pad: shift the whole glyph one tile in a direction */
    .im-nudge { pointer-events: none; display: grid; grid-template-columns: repeat(3, 22px); grid-auto-rows: 22px; margin-top: 8px; }
    .im-nudgebtn { pointer-events: auto; display: grid; place-items: center; font: 600 15px system-ui, sans-serif; color: var(--text);
      background: none; border: none; padding: 0; cursor: pointer; opacity: .5; }
    .im-nudgebtn:hover { opacity: 1; }
    /* actions: smallest possible — plain text, no box, no padding */
    .im-edit { position: absolute; right: 12px; bottom: 12px; z-index: 3; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
    .im-actbtn { pointer-events: auto; font: 600 12px system-ui, sans-serif; color: var(--text); background: none; border: none;
      padding: 0; cursor: pointer; opacity: .7; }
    .im-actbtn:hover { opacity: 1; }
    /* greyed out — what select mode doesn't do (only copy does) */
    .im-actbtn.off, .im-actbtn.off:hover { opacity: .2; cursor: default; }
    /* the open group's versions: a strip along the bottom edge, between the
       current design (bottom-left) and the actions (bottom-right) */
    .im-versions { position: absolute; left: 186px; right: 84px; bottom: 12px; z-index: 3; pointer-events: none;
      display: grid; grid-auto-flow: column; justify-content: start; align-items: end; gap: 10px; overflow-x: auto; }
    .im-ver { display: grid; justify-items: center; gap: 2px; }
    .im-verlabel { font: 600 12px system-ui, sans-serif; color: var(--text); opacity: .35; white-space: nowrap; }
    .im-ver.sel .im-verlabel { opacity: 1; }
    .im-addver { pointer-events: auto; align-self: center; font: 600 12px system-ui, sans-serif; color: var(--text);
      background: none; border: none; padding: 0; cursor: pointer; opacity: .5; }
    .im-addver:hover { opacity: 1; }
    /* the name: big, borderless */
    .im-name { pointer-events: auto; width: 190px; box-sizing: border-box; font: 600 24px system-ui, sans-serif; color: var(--text);
      background: transparent; border: none; padding: 0; }`
  document.head.append(st)
}

export function initIconMaker(mount) {
  injectCSS()
  const dpr = window.devicePixelRatio || 1
  const grid = buildGrid(N)

  let saved = loadItems() // the creator's saved designs (localStorage); some override built-ins
  let groups = mergeGroups() // what the list shows: one cell per icon group
  let label = DEFAULT_LABEL // which version of the open group is on the bench
  let tool = "wedge"
  // SELECT MODE — the third tool. The drawing goes GREY and clicking a wedge
  // picks it out in full ink; from then on the tools that MOVE and COPY work on
  // the picked wedges alone instead of the whole glyph, which is what lets you
  // place one thing around another. Leaving the mode drops the selection.
  let selected = new Set()
  const selecting = () => tool === "select"
  const hasSel = () => selecting() && selected.size > 0
  let filled = new Set()
  let lines = []
  let penPrev = null
  let name = ""
  let currentIdx = -1
  let hoverTri = null
  let hoverVert = null
  let smallThumbs = [] // the current design's LIVE previews (its list cell, its strip cell, or both)
  let listThumbs = 0 // how many of those the LIST owns — the strip's are the rest
  let bigThumbCtx = null // the current design's LIVE 2× preview in the bottom-right panel
  let nameInput = null
  let labelInput = null
  let resetBtn = null // shown for built-in icons: revert the override to the default
  let deleteBtn = null // shown for custom icons: remove them (built-in defaults can't be removed)
  const TB = 44 // list preview size
  const TBIG = 88 // bottom-right preview (double)

  // responsive geometry — the hex fills the centre of the mount
  let box = 400
  let R = 160
  const S = p => [box / 2 + p[0] * R, box / 2 + p[1] * R]

  // ── DOM ──
  mount.textContent = ""
  mount.classList.add("im-root")
  const canvas = document.createElement("canvas")
  canvas.className = "im-canvas"
  const ctx = canvas.getContext("2d")
  mount.append(canvas)

  // left column: the vertical list (top, rebuilt by renderList) and the current
  // design's 2× preview + name pinned at the bottom-left
  const left = el("div", "im-left")
  const list = el("div", "im-list")
  const cur = el("div", "im-cur")
  const bigCanvas = document.createElement("canvas")
  bigCanvas.width = TBIG * dpr
  bigCanvas.height = TBIG * dpr
  bigCanvas.style.width = bigCanvas.style.height = TBIG + "px"
  bigThumbCtx = bigCanvas.getContext("2d")
  bigThumbCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
  nameInput = document.createElement("input")
  nameInput.className = "im-name"
  nameInput.placeholder = "name"
  nameInput.addEventListener("input", () => (name = nameInput.value))
  nameInput.addEventListener("keydown", ev => {
    if (ev.key === "Enter") saveCurrent()
  })
  // …and under the name, the LABEL of the version on the bench. Type another one
  // and save: that's a new version of the same group (type `default` and it's the
  // group's default — the one every call falls back to).
  labelInput = document.createElement("input")
  labelInput.className = "im-label"
  labelInput.placeholder = DEFAULT_LABEL
  labelInput.addEventListener("input", () => {
    label = labelInput.value.trim() || DEFAULT_LABEL
    renderVersions() // the strip follows what you type: a label nothing has drawn yet sits at the end
  })
  labelInput.addEventListener("keydown", ev => {
    if (ev.key === "Enter") saveCurrent()
  })
  const curText = el("div", "im-curtext")
  curText.append(nameInput, labelInput)
  cur.append(bigCanvas, curText)
  left.append(list, cur)
  mount.append(left)

  // bottom strip: the open group's versions, rebuilt by renderVersions
  const versions = el("div", "im-versions")
  const addVerBtn = document.createElement("button")
  addVerBtn.className = "im-addver"
  addVerBtn.textContent = "+"
  addVerBtn.addEventListener("click", newVersion)
  mount.append(versions)

  // top-right: the drawing tools
  const tools = el("div", "im-tools")
  const toolBtns = {}
  for (const t of ["wedge", "line", "select"]) {
    const b = document.createElement("button")
    b.className = "im-toolbtn"
    b.textContent = t
    b.addEventListener("click", () => setTool(t))
    toolBtns[t] = b
    tools.append(b)
  }
  // a d-pad that shifts the whole glyph one tile at a time (so you can reposition
  // a design without redrawing it). Arrows placed in a 3×3 cross.
  const dpad = el("div", "im-nudge")
  for (const [glyph, col, row, dx, dy] of [
    ["↑", 2, 1, 0, -1 / N],
    ["←", 1, 2, -SQ / N, 0],
    ["→", 3, 2, SQ / N, 0],
    ["↓", 2, 3, 0, 1 / N]
  ]) {
    const b = document.createElement("button")
    b.className = "im-nudgebtn"
    b.textContent = glyph
    b.setAttribute("aria-label", `nudge ${glyph}`)
    b.style.gridColumn = col
    b.style.gridRow = row
    b.addEventListener("click", () => nudge(dx, dy))
    dpad.append(b)
  }
  tools.append(dpad)
  mount.append(tools)

  // bottom-right: the actions, stacked (separate from the preview + name)
  const edit = el("div", "im-edit")
  const actBtns = {}
  const SELECT_ACTS = new Set(["copy", "paste"]) // what stays live while picking wedges
  const actBtn = (label, on) => {
    const b = document.createElement("button")
    b.className = "im-actbtn"
    b.textContent = label
    // in SELECT mode only COPY and PASTE do anything — the rest are greyed and
    // inert, so a mode meant for picking wedges can't quietly save or clear the
    // glyph. Paste belongs here because it lands pre-selected: copy a piece out
    // of one glyph, paste it into another, and nudge it into place without ever
    // leaving the mode.
    b.addEventListener("click", () => {
      if (selecting() && !SELECT_ACTS.has(label)) return
      on()
    })
    actBtns[label] = b
    return b
  }
  resetBtn = actBtn("reset", resetCurrent)
  deleteBtn = actBtn("delete", deleteCurrent)
  edit.append(
    actBtn("save", saveCurrent),
    actBtn("clone", cloneCurrent),
    actBtn("new", newDesign),
    resetBtn,
    deleteBtn,
    actBtn("undo", undo),
    actBtn("clear", clearDesign),
    actBtn("copy", copyExport),
    actBtn("paste", pasteDesign)
  )
  mount.append(edit)

  function el(tag, cls) {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    return e
  }

  function setTool(t) {
    tool = t
    penPrev = null
    if (t !== "select") selected.clear() // the picking only means something in the mode
    for (const k in toolBtns) toolBtns[k].classList.toggle("sel", k === t)
    updateActBtns()
    draw()
  }
  // grey out everything select mode doesn't do (see actBtn)
  function updateActBtns() {
    for (const [label, b] of Object.entries(actBtns)) b.classList.toggle("off", selecting() && !SELECT_ACTS.has(label))
  }
  function undo() {
    if (penPrev) penPrev = null
    else if (lines.length) lines.pop()
    draw()
  }
  function clearDesign() {
    filled.clear()
    lines = []
    penPrev = null
    draw()
  }
  // shift the whole glyph by (dx, dy) in hex-local units. The lattice has three
  // faces, so a straight translation isn't a clean id shift: we move each filled
  // wedge's centroid, then re-snap to whichever wedge now contains it (anything
  // pushed past the hex edge drops off). Lines are plain coords, so they just add.
  // With wedges PICKED (select mode) it shifts only those, leaving the rest of
  // the glyph where it is — that's how you place one thing against another.
  // Otherwise it shifts everything, lines included, as it always did.
  function nudge(dx, dy) {
    const move = hasSel() ? selected : filled
    const moved = new Set()
    for (const id of move) {
      const t = wedgeTri(id, N)
      const cx = (t[0][0] + t[1][0] + t[2][0]) / 3 + dx
      const cy = (t[0][1] + t[1][1] + t[2][1]) / 3 + dy
      const hit = grid.tris.find(tt => inTri(cx, cy, tt.p))
      if (hit) moved.add(hit.id)
    }
    if (hasSel()) {
      for (const id of selected) filled.delete(id)
      for (const id of moved) filled.add(id)
      selected = moved // the picked wedges travel with the selection
    } else {
      filled = moved
      lines = lines.map(L => ({ a: { x: L.a.x + dx, y: L.a.y + dy }, b: { x: L.b.x + dx, y: L.b.y + dy } }))
    }
    penPrev = null
    draw()
  }

  const rnd = v => Math.round(v * 1000) / 1000
  const snapshot = () => ({
    name: name || "",
    label,
    n: N,
    fill: [...filled],
    lines: lines.map(L => [rnd(L.a.x), rnd(L.a.y), rnd(L.b.x), rnd(L.b.y)])
  })
  function loadInto(item) {
    filled = new Set(item.fill || [])
    lines = (item.lines || []).map(([ax, ay, bx, by]) => ({ a: { x: ax, y: ay }, b: { x: bx, y: by } }))
    name = item.name || ""
    label = labelOf(item)
    if (nameInput) nameInput.value = name
    if (labelInput) labelInput.value = label
    updateEditButtons()
    penPrev = null
    draw()
  }
  function newDesign() {
    currentIdx = -1
    loadInto({ fill: [], lines: [], name: "", label: DEFAULT_LABEL })
    renderList()
  }
  // open a group: its `default` goes on the bench, its versions fill the strip
  function openGroup(i) {
    const g = groups[i]
    currentIdx = i
    loadInto(g.versions[DEFAULT_LABEL] || { name: g.name, label: DEFAULT_LABEL, fill: [], lines: [] })
    renderList()
  }
  // put another VERSION of this same group on the bench (blank if never drawn).
  // Unsaved edits are dropped, exactly as when you click another list item.
  function setLabel(l) {
    if (l === label) return
    const g = currentIdx >= 0 ? groups[currentIdx] : null
    loadInto((g && g.versions[l]) || { name, label: l, fill: [], lines: [] })
    renderList()
  }
  // `+`: one more version of the open group, its label prefilled and selected so
  // the next thing you type names it. Nothing is stored until you save.
  function newVersion() {
    const g = currentIdx >= 0 ? groups[currentIdx] : null
    if (!g) return
    let l = "new"
    for (let k = 2; g.labels.includes(l); k++) l = "new " + k
    loadInto({ name: g.name, label: l, fill: [], lines: [] })
    renderList()
    labelInput.focus()
    labelInput.select()
  }
  // the displayed list: one GROUP per icon name — built-ins first (in their canon
  // order), then customs — each carrying its versions, `default` first. A version
  // is the saved design if there is one, else the built-in, else null = an empty
  // canvas you can click to start drawing.
  function mergeGroups() {
    const byKey = {}
    for (const it of saved) byKey[iconKey(it.name, labelOf(it))] = it
    // WEDGE_ICONS is keyed by VERSION ("build" / "build:word"), so the group list
    // is its plain-name keys; each group then looks its versions up by iconKey
    const names = Object.keys(WEDGE_ICONS).filter(k => !k.includes(":"))
    for (const it of saved) if (!names.includes(it.name)) names.push(it.name)
    const dflt = (nm, l) => {
      const def = WEDGE_ICONS[iconKey(nm, l)]
      return def && { name: nm, label: l, n: def.n, fill: [...def.fill], lines: (def.lines || []).map(x => x.slice()) }
    }
    // a group's labels: `default` always, then every alternate anyone has drawn
    const labelsOf = nm => {
      const out = [DEFAULT_LABEL]
      const add = l => l !== DEFAULT_LABEL && !out.includes(l) && out.push(l)
      for (const k of Object.keys(WEDGE_ICONS)) if (k.startsWith(nm + ":")) add(k.slice(nm.length + 1))
      for (const it of saved) if (it.name === nm) add(labelOf(it))
      return out
    }
    return names.map(nm => {
      const labels = labelsOf(nm)
      const versions = {}
      for (const l of labels) versions[l] = byKey[iconKey(nm, l)] || dflt(nm, l) || null
      return { name: nm, labels, versions }
    })
  }
  function persistSaved() {
    persist(saved)
    reloadIconOverrides() // the game adopts the edit next time it draws
  }
  // saved designs are keyed by name AND label — the versions of one group are one
  // entry each, and none overwrites another
  const savedIdx = (nm, l) => saved.findIndex(it => it.name === nm && labelOf(it) === l)
  function reselect(nm) {
    groups = mergeGroups()
    currentIdx = groups.findIndex(g => g.name === nm)
    renderList()
  }
  function saveCurrent() {
    const snap = snapshot()
    if (!snap.name) {
      snap.name = "icon " + (groups.length + 1)
      name = snap.name
      if (nameInput) nameInput.value = name
    }
    const si = savedIdx(snap.name, snap.label)
    if (si >= 0) saved[si] = snap
    else saved.push(snap)
    persistSaved()
    reselect(snap.name)
  }
  // add a fresh copy of the current design, name prefilled "<previous> copy",
  // selected and ready to tweak (the copy starts on the same label)
  function cloneCurrent() {
    const base = (name || (currentIdx >= 0 ? groups[currentIdx].name : "") || "icon").trim()
    const snap = { ...snapshot(), name: `${base} copy` }
    saved.push(snap)
    persistSaved()
    loadInto(snap)
    reselect(snap.name)
  }
  // drop one VERSION of one group (right-click its cell): the override goes and
  // the version reverts to its built-in, or empties if there wasn't one
  function deleteItem(i, l) {
    const si = savedIdx(groups[i].name, l)
    if (si < 0) return // a built-in with no override — nothing to remove
    saved.splice(si, 1)
    persistSaved()
    groups = mergeGroups()
    currentIdx = Math.max(0, Math.min(currentIdx, groups.length - 1))
    const g = groups[currentIdx]
    loadInto((g && (g.versions[label] || g.versions[DEFAULT_LABEL])) || { fill: [], lines: [], name: "", label: DEFAULT_LABEL })
    renderList()
  }
  // COPY the drawing — or, with wedges picked in select mode, just those (and no
  // lines: a selection is wedges). That's what makes "copy this bit, paste it,
  // shove it somewhere else" possible.
  function copyExport() {
    const part = hasSel()
    try {
      navigator.clipboard?.writeText(
        JSON.stringify({ n: N, fill: part ? [...selected] : [...filled], lines: part ? [] : snapshot().lines })
      )
    } catch {}
  }
  // …and PASTE it back onto whichever version is on the bench — copy the default,
  // switch to `word`, paste, and you're drawing over it. Only the DRAWING lands:
  // the name and the label stay put, so it can't clobber the wrong version.
  // (Nothing is saved until you hit save, so a mispaste is one `undo` of nerve.)
  async function pasteDesign() {
    let data = null
    try {
      data = JSON.parse(await navigator.clipboard.readText())
    } catch {
      return // not readable, or not one of ours — leave the bench alone
    }
    if (!data || !Array.isArray(data.fill) || (data.n && data.n !== N)) return
    // it lands ON TOP of what's already here and arrives SELECTED, in select
    // mode — so the very next thing you can do is nudge it into place around the
    // rest of the glyph. (It used to replace the canvas; on an empty one that's
    // the same thing.)
    const ids = data.fill.filter(id => typeof id === "string")
    for (const id of ids) filled.add(id)
    for (const [ax, ay, bx, by] of data.lines || []) lines.push({ a: { x: ax, y: ay }, b: { x: bx, y: by } })
    penPrev = null
    setTool("select") // clears any old pick…
    selected = new Set(ids) // …and hands you the arrival instead
    updateEditButtons()
    draw()
  }
  // a version that ships with the game can be RESET (back to that drawing); one
  // that only exists as your own save gets DELETE
  const isBuiltin = () => iconKey(name, label) in WEDGE_ICONS
  // reset a built-in back to its shipped drawing (drop the override)
  function resetCurrent() {
    if (!isBuiltin()) return
    const si = savedIdx(name, label)
    if (si >= 0) {
      saved.splice(si, 1)
      persistSaved()
    }
    groups = mergeGroups()
    currentIdx = groups.findIndex(g => g.name === name)
    loadInto(groups[currentIdx].versions[label] || { name, label, fill: [], lines: [] })
    renderList()
  }
  // delete this version outright (a custom icon, or any alternate)
  function deleteCurrent() {
    if (isBuiltin()) return
    const si = savedIdx(name, label)
    if (si >= 0) {
      saved.splice(si, 1)
      persistSaved()
    }
    groups = mergeGroups()
    currentIdx = Math.max(0, Math.min(currentIdx, groups.length - 1))
    const g = groups[currentIdx]
    loadInto((g && (g.versions[label] || g.versions[DEFAULT_LABEL])) || { fill: [], lines: [], name: "", label: DEFAULT_LABEL })
    renderList()
  }
  // built-in versions get RESET (revert to the shipped drawing); everything else
  // DELETE. The strip below shows which versions of this group are drawn.
  function updateEditButtons() {
    if (!resetBtn) return
    const b = isBuiltin()
    resetBtn.style.display = b ? "" : "none"
    deleteBtn.style.display = b ? "none" : ""
  }
  const hasArt = d => !!d && ((d.fill && d.fill.length > 0) || (d.lines && d.lines.length > 0))

  function makeThumb(data, size, outlineAlpha) {
    const c = document.createElement("canvas")
    c.width = size * dpr
    c.height = size * dpr
    c.style.width = c.style.height = size + "px"
    const tctx = c.getContext("2d")
    tctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    paintDesign(tctx, data, size / 2, size / 2, size * 0.42, outlineAlpha)
    return { c, tctx }
  }
  // one hex cell in the left list. The hex outline is drawn ON THE HEX only when
  // this is the selected (editing) one, or on hover (fainter). The name reveals
  // on hover as an absolute label (takes no layout space).
  function previewCell(data, { live, sel, nameText, onClick, onDelete, base = 0 }) {
    const cell = el("div", "im-item")
    const t = makeThumb(data, TB, sel ? 0.9 : base)
    if (live) smallThumbs.push({ tctx: t.tctx, sel })
    const nm = el("div", "nm")
    nm.textContent = nameText
    cell.append(t.c, nm)
    const repaint = a => {
      t.tctx.clearRect(0, 0, TB, TB)
      paintDesign(t.tctx, live ? snapshot() : data, TB / 2, TB / 2, TB * 0.42, a)
    }
    cell.addEventListener("mouseenter", () => {
      repaint(sel ? 0.9 : 0.35) // outline fainter on hover
      nm.style.opacity = "0.9" // reveal the name (JS-driven, so it can't be missed)
    })
    cell.addEventListener("mouseleave", () => {
      repaint(sel ? 0.9 : base)
      nm.style.opacity = "0"
    })
    if (onClick) cell.addEventListener("click", onClick)
    if (onDelete)
      cell.addEventListener("contextmenu", ev => {
        ev.preventDefault()
        onDelete()
      })
    return cell
  }
  // the left list, one hex wide: ONE CELL PER GROUP, showing its `default`. Saved
  // groups keep their positions — the open one is just framed in place, never
  // moved. A brand-new unsaved design shows as a live entry at the top until it's
  // saved. The open group's other versions are the strip along the bottom.
  function renderList() {
    list.textContent = ""
    smallThumbs = []
    if (currentIdx < 0) {
      list.append(previewCell(snapshot(), { live: true, sel: true, nameText: name || "editing" }))
    }
    groups.forEach((g, i) => {
      const def = g.versions[DEFAULT_LABEL]
      const sel = i === currentIdx
      const live = sel && label === DEFAULT_LABEL // on an alternate, the group cell stays as it was drawn
      // a group that's never been drawn still gets a cell: a faint empty hex,
      // click it to start its default
      list.append(
        previewCell(live ? snapshot() : def || { n: N, fill: [], lines: [] }, {
          live,
          sel,
          base: def ? 0 : 0.18,
          nameText: live ? name || g.name : g.name,
          onClick: live ? null : () => openGroup(i),
          onDelete: () => deleteItem(i, DEFAULT_LABEL)
        })
      )
    })
    listThumbs = smallThumbs.length
    renderVersions()
  }
  // the bottom strip: every version of the OPEN group under its own label, and a
  // `+` for one more. Click one to put it on the bench, right-click to drop it.
  function renderVersions() {
    versions.textContent = ""
    smallThumbs.length = listThumbs // drop the previous strip's live previews, keep the list's
    const g = currentIdx >= 0 ? groups[currentIdx] : null
    if (!g) return
    // an unsaved label (just typed, or straight from `+`) shows at the end
    for (const l of g.labels.includes(label) ? g.labels : [...g.labels, label]) {
      const ver = g.versions[l]
      const sel = l === label
      const cell = el("div", "im-ver" + (sel ? " sel" : ""))
      const tag = el("div", "im-verlabel")
      tag.textContent = l
      cell.append(
        previewCell(sel ? snapshot() : ver || { n: N, fill: [], lines: [] }, {
          live: sel,
          sel,
          base: ver ? 0 : 0.18,
          nameText: `${g.name} · ${l}`,
          onClick: sel ? null : () => setLabel(l),
          onDelete: () => deleteItem(currentIdx, l)
        }),
        tag
      )
      versions.append(cell)
    }
    versions.append(addVerBtn)
  }
  function refreshLiveThumb() {
    const paint = (c, size, oa) => {
      c.clearRect(0, 0, size, size)
      paintDesign(c, snapshot(), size / 2, size / 2, size * 0.42, oa)
    }
    if (bigThumbCtx) paint(bigThumbCtx, TBIG, 0.9)
    for (const t of smallThumbs) paint(t.tctx, TB, t.sel ? 0.9 : 0)
  }

  // ── responsive sizing ──
  function resize() {
    const w = mount.clientWidth || 800
    const h = mount.clientHeight || 600
    box = Math.max(220, Math.min(w, h) * 0.82) // as big as the old cube, centred
    R = box / 2 - box * 0.06
    canvas.width = Math.round(box * dpr)
    canvas.height = Math.round(box * dpr)
    canvas.style.width = canvas.style.height = box + "px"
    draw()
  }
  const ro = new ResizeObserver(resize)
  ro.observe(mount)

  // ── interaction ──
  const local = e => {
    const r = canvas.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  const nearestVert = (mx, my) => {
    let best = null
    let bd = 16 * 16
    for (const v of grid.verts) {
      const [x, y] = S([v.x, v.y])
      const d = (x - mx) * (x - mx) + (y - my) * (y - my)
      if (d < bd) {
        bd = d
        best = v
      }
    }
    return best
  }
  const triAt = (mx, my) => grid.tris.find(t => inTri(mx, my, t.p.map(S))) || null

  canvas.addEventListener("mousemove", e => {
    const [mx, my] = local(e)
    if (tool === "wedge") {
      const t = triAt(mx, my)
      if (t !== hoverTri) {
        hoverTri = t
        draw()
      }
    } else {
      const v = nearestVert(mx, my)
      if (v !== hoverVert) {
        hoverVert = v
        draw()
      }
    }
  })
  canvas.addEventListener("mouseleave", () => {
    hoverTri = hoverVert = null
    draw()
  })
  canvas.addEventListener("click", e => {
    const [mx, my] = local(e)
    if (tool === "select") {
      // pick a PAINTED wedge out of the grey (or put it back)
      const t = triAt(mx, my)
      if (!t || !filled.has(t.id)) return
      selected.has(t.id) ? selected.delete(t.id) : selected.add(t.id)
    } else if (tool === "wedge") {
      const t = triAt(mx, my)
      if (!t) return
      filled.has(t.id) ? filled.delete(t.id) : filled.add(t.id)
    } else {
      const v = nearestVert(mx, my)
      if (!v) penPrev = null
      else {
        if (penPrev && !(penPrev.x === v.x && penPrev.y === v.y)) lines.push({ a: penPrev, b: v })
        penPrev = v
      }
    }
    draw()
  })
  const onKey = e => {
    if (e.key === "Escape" && penPrev) {
      penPrev = null
      draw()
    }
  }
  window.addEventListener("keydown", onKey)

  // ── drawing the editor ──
  const path = (c, pts) => {
    c.beginPath()
    pts.forEach((p, i) => {
      const [x, y] = S(p)
      i ? c.lineTo(x, y) : c.moveTo(x, y)
    })
    c.closePath()
  }
  const seg = (a, b) => {
    const p = S([a.x, a.y])
    const q = S([b.x, b.y])
    ctx.beginPath()
    ctx.moveTo(p[0], p[1])
    ctx.lineTo(q[0], q[1])
    ctx.stroke()
  }
  const dot = (v, solid) => {
    const [x, y] = S([v.x, v.y])
    ctx.beginPath()
    ctx.arc(x, y, 5, 0, Math.PI * 2)
    if (solid) {
      ctx.fillStyle = ink()
      ctx.fill()
    } else {
      ctx.fillStyle = surface()
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = ink()
      ctx.stroke()
    }
  }
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, box, box)
    ctx.fillStyle = surface()
    path(ctx, HEX)
    ctx.fill()
    ctx.strokeStyle = ink()
    ctx.globalAlpha = 0.12
    ctx.lineWidth = 1
    for (const t of grid.tris) {
      path(ctx, t.p)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    ctx.fillStyle = ink()
    for (const t of grid.tris) {
      if (!filled.has(t.id)) continue
      // SELECT MODE: the glyph goes grey and the picked wedges stay full ink, so
      // what you're about to move or copy is the only thing you can see clearly
      ctx.globalAlpha = selecting() ? (selected.has(t.id) ? 1 : 0.28) : 1
      path(ctx, t.p)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    ctx.strokeStyle = ink()
    ctx.globalAlpha = 0.5
    ctx.lineWidth = 1.5
    ctx.lineJoin = ctx.lineCap = "round"
    path(ctx, HEX)
    ctx.stroke()
    ctx.globalAlpha = 0.28
    for (const v of [B, C, A]) {
      const o = S([0, 0])
      const p = S(v)
      ctx.beginPath()
      ctx.moveTo(o[0], o[1])
      ctx.lineTo(p[0], p[1])
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    ctx.lineWidth = 2
    for (const L of lines) seg(L.a, L.b)
    if (tool === "wedge" && hoverTri && !filled.has(hoverTri.id)) {
      ctx.globalAlpha = 0.35
      ctx.fillStyle = ink()
      path(ctx, hoverTri.p)
      ctx.fill()
    }
    if (tool === "line") {
      ctx.strokeStyle = ink()
      if (penPrev && hoverVert) {
        ctx.globalAlpha = 0.5
        ctx.setLineDash([4, 4])
        ctx.lineWidth = 2
        seg(penPrev, hoverVert)
        ctx.setLineDash([])
      }
      ctx.globalAlpha = 1
      if (hoverVert) dot(hoverVert, false)
      if (penPrev) dot(penPrev, true)
    }
    ctx.globalAlpha = 1
    refreshLiveThumb()
  }

  setTool("wedge")
  // open on the last DRAWN group (the blank canvases now sitting at the end of
  // the list would otherwise greet you with an empty hex), on whichever of its
  // versions has art — the default first
  {
    const drawn = groups.map((g, i) => (g.labels.some(l => hasArt(g.versions[l])) ? i : -1)).filter(i => i >= 0)
    currentIdx = drawn.length ? drawn[drawn.length - 1] : groups.length - 1
  }
  if (groups.length) {
    const g = groups[currentIdx]
    const l = g.labels.find(x => hasArt(g.versions[x])) || DEFAULT_LABEL
    loadInto(g.versions[l] || { name: g.name, label: DEFAULT_LABEL, fill: [], lines: [] })
    renderList()
  } else {
    newDesign()
  }
  resize()

  return {
    redraw: () => {
      renderList()
      draw()
    },
    destroy: () => {
      ro.disconnect()
      window.removeEventListener("keydown", onKey)
      mount.classList.remove("im-root")
      mount.textContent = ""
    }
  }
}
