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
  window.addEventListener("pointerup", e => screen?.onPointerUp?.(local(e))) // release anywhere
  window.addEventListener("resize", resize)

  resize()

  return {
    layout,
    store,
    setScreen,
    requestRender: render,
    onCommit: fn => {
      commitHandler = fn
    }
  }
}
