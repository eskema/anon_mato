// App engine.
//
// Owns the canvas, the layout (recomputed on resize), and a shared `store`.
// It shows one screen at a time and forwards pointer/render to it. It is
// flow-agnostic: callers pick the starting screen via setScreen(). A screen may
// call api.commit(value), which routes to a handler registered with onCommit()
// (used by the setup flow); unhandled commits are simply ignored.

export function createApp(canvas) {
  const ctx = canvas.getContext("2d")

  // Layout in CSS pixels; the same object is handed to every screen.
  const layout = { w: 0, h: 0, cx: 0, cy: 0, minSide: 0, dpr: 1 }

  // Accumulates anything gathered during setup; threaded through every screen.
  const store = { inputs: {}, player: {}, environment: {} }

  let screen = null
  let commitHandler = null

  function render() {
    ctx.clearRect(0, 0, layout.w, layout.h)
    screen?.draw(ctx, layout)
  }

  function setScreen(next) {
    screen?.leave?.()
    document.body.style.cursor = "default"
    screen = next
    screen.enter?.(api)
    render()
  }

  // Cross-fade INTO the next screen — one place becoming another, not a cut.
  //
  // Call it while the OUTGOING frame is still on the canvas: we sample that
  // frame's own backdrop and hold it over the new screen as a veil, then fade
  // the veil away. Fading the CANVAS instead would show whatever is behind it,
  // which is the page's paper — that was the white flash.
  const FADE_MS = 500
  // The outgoing frame's own backdrop: the MEDIAN of a sparse grid over it.
  // A single pixel lands on whatever chrome happens to be in that corner;
  // chrome is a small share of the screen, so the median is the ground.
  function backdrop() {
    const w = canvas.width
    const h = canvas.height
    const ch = [[], [], []]
    try {
      for (let i = 1; i < 9; i++)
        for (let j = 1; j < 9; j++) {
          const d = ctx.getImageData(Math.round((w * i) / 9), Math.round((h * j) / 9), 1, 1).data
          for (let k = 0; k < 3; k++) ch[k].push(d[k])
        }
    } catch {
      // the canvas is TAINTED — a profile picture came off a host that sends no
      // CORS headers, which is most of them, and reading pixels back is no
      // longer allowed. The veil isn't worth refusing to draw people's faces
      // for: fall back to the page's own paper, which is what's behind anyway.
      const paper = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim()
      const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(paper)
      return m ? [1, 2, 3].map(i => parseInt(m[i], 16)) : [17, 17, 17]
    }
    return ch.map(v => v.sort((a, b) => a - b)[v.length >> 1])
  }
  function fadeIn(ms = FADE_MS) {
    const [r, g, b] = backdrop()
    const veil = document.createElement("div")
    veil.style.cssText = `position:fixed;inset:0;z-index:5;pointer-events:none;background:rgb(${r},${g},${b});transition:opacity ${ms}ms cubic-bezier(0.25,1,0.5,1)`
    document.body.appendChild(veil)
    requestAnimationFrame(() => {
      veil.style.opacity = "0"
      setTimeout(() => veil.remove(), ms + 100)
    })
  }

  const api = {
    layout,
    store,
    requestRender: render,
    setScreen,
    commit: value => commitHandler?.(value)
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1
    const w = window.innerWidth
    const h = window.innerHeight
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0) // draw in CSS pixels
    layout.w = w
    layout.h = h
    layout.cx = w / 2
    layout.cy = h / 2
    layout.minSide = Math.min(w, h)
    layout.dpr = dpr
    render()
  }

  const local = e => ({ x: e.clientX, y: e.clientY })
  canvas.addEventListener("pointermove", e => screen?.onPointerMove?.(local(e)))
  canvas.addEventListener("pointerdown", e => screen?.onPointerDown?.(local(e)))
  canvas.addEventListener("dblclick", e => screen?.onDoubleClick?.(local(e)))
  // the wheel — a screen only gets it if it wants it, and taking it means the
  // page doesn't (a scrollable list on the canvas shouldn't rubber-band the tab)
  canvas.addEventListener(
    "wheel",
    e => {
      if (!screen?.onWheel) return
      if (screen.onWheel(local(e), e.deltaY, e.deltaX)) e.preventDefault()
    },
    { passive: false }
  )
  window.addEventListener("pointerup", e => screen?.onPointerUp?.(local(e))) // release anywhere
  // the keyboard — forwarded like the pointer; a screen that TAKES the key
  // (returns true) keeps it from the page (space must never scroll the tab)
  window.addEventListener("keydown", e => {
    if (screen?.onKey?.(e)) e.preventDefault()
  })
  window.addEventListener("resize", resize)

  resize()

  return {
    layout,
    store,
    setScreen,
    fadeIn,
    requestRender: render,
    onCommit: fn => {
      commitHandler = fn
    }
  }
}
