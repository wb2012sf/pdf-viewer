/**
 * How wide the pages panel may be, and how big its previews are at that width.
 *
 * Separate from the component so both can be tested and reused without dragging
 * a React import along.
 */

export const MIN_WIDTH_PX = 170;
export const MAX_WIDTH_PX = 560;
export const DEFAULT_WIDTH_PX = 248;

/**
 * Preview height for a given panel width.
 *
 * Tied to the width so widening the panel makes the pages bigger rather than
 * leaving them marooned in a wider column — which is the point of dragging it.
 */
export function thumbHeightFor(widthPx: number): number {
  return Math.round(widthPx * 0.38);
}

/** Keeps the panel between a usable minimum and not swallowing the viewer. */
export function clampWidth(widthPx: number): number {
  return Math.min(MAX_WIDTH_PX, Math.max(MIN_WIDTH_PX, Math.round(widthPx)));
}
