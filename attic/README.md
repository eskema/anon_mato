# attic — parked experiments

The first-person 3D world view, pulled out of the app (2026-07-13) to keep
the focus on gameplay. Working state at park time; kept as a template base
for whenever the itch returns.

- `view3d.js` — the CANVAS twin. Hand-rolled painter's renderer: plan-distance
  render queue, Sutherland–Hodgman near clipping, lambert light, projected
  cast-shadow polygons (cached, union-filled), vertex-merged terrain skin,
  banded display heights, waterline sheets, home minimap with mini pillars,
  fog drapes, thick angle-hue walls. World sampling cached across frames;
  repaints the whole disk each frame (its ceiling — R capped at 24).
- `view3d-gl.js` — the WEBGL twin (three.js): same world sampling and camera
  feel, real depth buffer, hemisphere + directional light with PCF shadow
  maps, ink wireframe fold lines, `THREE.Fog` distance fade. Mesh rebuilt
  only on world change or straying from the built disk. v1 gaps: no trail /
  hover overlays, no centre markers.
- `three.module.min.js` — three.js r170, minified ESM, vendored from
  jsDelivr (MIT). `view3d-gl.js` imports it as `./vendor/three.module.min.js`
  — restore it to `lib/vendor/` (or fix the import) when reviving.

To re-wire (all previously in `lib/grid.js`):

    import { initView3d } from "./view3d.js"
    import { initView3dGl } from "./view3d-gl.js"
    // helpers-menu items:
    //   { id: "view3d", icon: "scout", label: "3d view", run: toggleView3d }
    //   { id: "view3dGl", icon: "scout", label: "3d view (gl)", run: toggleView3dGl }
    // toggles kept in sessionStorage ("anon&mato:view3d", "anon&mato:view3dgl"),
    // opened in enter(), destroyed in leave(); both took
    //   initView3dX(sim, () => ({ at: hovered, path: hoverPath, bad: hoverIllegal }))

Both modules read the sim's public api only (plus `sim.worldStamp()`, which
stayed in the game for the 2D renderer's bake).
