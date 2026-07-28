// The cube view — a workshop entered from the home centre. A top bar with a back
// arrow and TABS (cube · icons) switches between the 3D rotating cube and the
// icon creator; more panels can join later. Each tab is a self-contained DOM
// component mounted into the content area over the game canvas.

import { initIconMaker } from "./iconmaker.js"
import { initCube3d } from "./cube3d.js"

const TABS = ["cube", "icons"]

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
    active = tab === "cube" ? initCube3d(content) : initIconMaker(content)
    for (const t of TABS) if (tabBtns[t]) tabBtns[t].style.opacity = t === tab ? "1" : ".4"
  }

  function enter() {
    overlay = document.createElement("div")
    overlay.id = "cube-overlay"
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:60;background:var(--surface);color:var(--text);display:flex;flex-direction:column;"
    const bar = document.createElement("div")
    bar.style.cssText = "display:flex;align-items:center;gap:16px;padding:10px 16px;flex:none;"
    const back = document.createElement("button")
    back.textContent = "←"
    back.setAttribute("aria-label", "back")
    back.style.cssText =
      "font:600 24px system-ui,sans-serif;line-height:1;background:none;border:none;color:var(--text);cursor:pointer;opacity:.65;padding:2px 6px;"
    back.addEventListener("click", onBack)
    bar.append(back)
    tabBtns = {}
    for (const t of TABS) {
      const b = document.createElement("button")
      b.textContent = t
      b.style.cssText = "font:600 14px system-ui,sans-serif;background:none;border:none;color:var(--text);cursor:pointer;padding:2px 4px;"
      b.addEventListener("click", () => {
        tab = t
        mountTab()
      })
      tabBtns[t] = b
      bar.append(b)
    }
    content = document.createElement("div")
    content.style.cssText = "position:relative;flex:1;min-height:0;"
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
