// Things arrive, they don't appear. Every box in setup eases in the first time
// it's drawn — a key's clock starts the first time it's asked for, which means
// "when it exists", so the screen simply draws what it has and the arrival
// animates itself.
//
// And things get out of the way: `chase` runs a value toward a moving target,
// which is how the chrome steps aside under the pointer and eases back when it
// leaves.

const MS = 260
const ease = t => 1 - Math.pow(1 - t, 4) // quart out — fast start, long settle

export function Fades(requestRender, ms = MS) {
  const t0 = new Map()
  const chases = new Map()
  let raf = 0
  const schedule = () => {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      requestRender()
    })
  }

  return {
    // A value that CHASES a target instead of arriving once — the chrome
    // stepping out of the way under the pointer, and easing back when it
    // leaves. Frame-rate independent: `ms` is the time to effectively close
    // the gap, whatever the frame rate.
    chase(key, target, ms = 160) {
      const now = performance.now()
      const s = chases.get(key) || { v: target, t: now }
      const dt = Math.min(100, now - s.t) // a backgrounded tab shouldn't jump
      s.v += (target - s.v) * (1 - Math.pow(0.001, dt / ms))
      s.t = now
      if (Math.abs(target - s.v) < 0.002) s.v = target
      chases.set(key, s)
      if (s.v !== target) schedule()
      return s.v
    },
    // 0→1 for `key`, arming its clock on first ask. `delay` staggers an arrival
    // behind the one before it; `instant` lands it already done (something that
    // flowed in from the previous screen and shouldn't blink).
    at(key, { delay = 0, instant = false } = {}) {
      if (!t0.has(key)) t0.set(key, instant ? -Infinity : performance.now())
      const t = Math.min(1, Math.max(0, (performance.now() - t0.get(key) - delay) / ms))
      if (t < 1) schedule()
      return ease(t)
    },
    stop() {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    }
  }
}
