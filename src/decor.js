// Map decoration: floor details, wall fittings and small props that make rooms feel lived in.
// drawDecor runs once per cached map chunk; drawDecorLive draws the few animated bits each frame.

/** Static decor for the part of the map inside [x0, x1) x [y0, y1) (cell units). */
export function drawDecor(ctx, map, x0, y0, x1, y1) {}

/** Draw a blocking prop whose kind belongs to decor. Returns true if handled. */
export function drawDecorProp(ctx, p) {
  return false;
}

/** Animated decor (blinking lights, glows) for the visible area, drawn every frame. */
export function drawDecorLive(ctx, map, t, x0, y0, x1, y1) {}
