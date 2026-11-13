// The PLAYGROUND — a workshop entered from the title's helpers, anywhere. A top
// bar with a back arrow and TABS (cube · icons · guide · clock · world · gpu
// map) switches between the 3D rotating cube, the icon creator and the dev
// pages. Each tab is a self-contained DOM component mounted into the content
// area over the game canvas.

import { initIconMaker } from "./iconmaker.js"
import { initCube3d } from "./cube3d.js"

// the game's chrome (chrome.css) — the boxes the bar and the tabs wear, loaded
// into the game's page once; it's scoped to `.chrome`, so the game is untouched
if (!document.getElementById("chrome-css")) {
  const l = document.createElement("link")
  l.id = "chrome-css"
  l.rel = "stylesheet"
  l.href = new URL("./chrome.css", import.meta.url).href
  document.head.append(l)
}

// THE PAGES ARE TABS (2026-08-28): the field guide, the clock and the rest are
// whole pages of their own, written against their own skeletons — so the
// playground mounts them AS pages, in a frame. Nothing is duplicated and they
// can never drift from what /guide.html and /clock.html show.
const TABS = ["cube", "icons", "guide", "clock", "world", "gpu map"]
const PAGES = { guide: "./guide.html", clock: "./clock.html", world: "./world.html", "gpu map": "./lab/glmap.html" }
const initPage = (host, src) => {
  const f = document.createElement("iframe")
  f.src = src
  f.style.cssText = "width:100%;height:100%;border:none;display:block;background:var(--surface);"
  host.append(f)
  return { destroy: () => f.remove() }
}

export function CubeScreen(onBack) {
  let overlay = null
  let content = null
  let active = null // the mounted tab component ({ destroy })
  let tabBtns = {}
  let tab = "icons" // default to the icon creator (recent focus)

  function mountTab() {
    active?.destroy?.()
    active = null
    if (content) content.textContent = ""
    active = PAGES[tab] ? initPage(content, PAGES[tab]) : tab === "cube" ? initCube3d(content) : initIconMaker(content)
    for (const t of TABS) tabBtns[t]?.classList.toggle("on", t === tab)
  }

  function enter() {
    overlay = document.createElement("div")
    overlay.id = "cube-overlay"
    overlay.className = "chrome"
    overlay.style.cssText = "position:fixed;inset:0;z-index:60;display:grid;grid-template-rows:auto 1fr;"
    // the bar stands off the corner like the game's title bar: the back box, and
    // the tabs as one row of butted boxes, the open one inverted
    const bar = document.createElement("div")
    bar.style.cssText = "display:grid;grid-auto-flow:column;justify-content:start;gap:6px;padding:6px;"
    const back = document.createElement("button")
    back.textContent = "←"
    back.setAttribute("aria-label", "back")
    back.addEventListener("click", onBack)
    const tabs = document.createElement("div")
    tabs.className = "cells"
    tabBtns = {}
    for (const t of TABS) {
      const b = document.createElement("button")
      b.textContent = t
      b.addEventListener("click", () => {
        tab = t
        mountTab()
      })
      tabBtns[t] = b
      tabs.append(b)
    }
    bar.append(back, tabs)
    content = document.createElement("div")
    content.style.cssText = "position:relative;min-height:0;overflow:hidden;" // …a framed guide fills it exactly
    overlay.append(bar, content)
    document.body.append(overlay)
    mountTab()
  }

  function leave() {
    active?.destroy?.()
    active = null
    overlay?.remove()
    overlay = null
    content = null
  }

  // the DOM overlay IS the whole view; nothing to paint on the canvas
  function draw() {}

  return { id: "cube", enter, leave, draw }
}
