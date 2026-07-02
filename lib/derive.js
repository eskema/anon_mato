// Derivation: turn raw setup inputs into player + environment data.
//
// Each intake screen contributes a raw value; the functions here fold those
// into `store.player` and `store.environment`. These are placeholders — the
// actual mappings (what the angle seeds) get defined as the design firms up.

export function deriveFromAngle(store, angle) {
  // The angle (1..359) is a base value other things are derived from.
  store.player.seedAngle = angle
}
