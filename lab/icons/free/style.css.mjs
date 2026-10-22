// the shared look, as CSS — used by the sheet renderer and the gallery
export const css = (ink = "var(--ink)", paper = "var(--paper)") => `
.s{fill:none;stroke:${ink};stroke-width:.1;stroke-linecap:round;stroke-linejoin:round}
.t{fill:none;stroke:${ink};stroke-width:.055;stroke-linecap:round;stroke-linejoin:round}
.pt{fill:none;stroke:${paper};stroke-width:.055;stroke-linecap:round;stroke-linejoin:round}
.ps{fill:none;stroke:${paper};stroke-width:.1;stroke-linecap:round;stroke-linejoin:round}
.f{fill:${ink};stroke:none}
.p{fill:${paper};stroke:none}
.h{fill:url(#hatch);stroke:none}
.inv .h{fill:url(#hatchI)}`
export const defs = (ink, paper) => `<defs>
<pattern id="hatch" patternUnits="userSpaceOnUse" width=".09" height=".09" patternTransform="rotate(-30)"><rect width=".09" height=".032" fill="${ink}"/></pattern>
<pattern id="hatchI" patternUnits="userSpaceOnUse" width=".09" height=".09" patternTransform="rotate(-30)"><rect width=".09" height=".032" fill="${paper}"/></pattern>
</defs>`
