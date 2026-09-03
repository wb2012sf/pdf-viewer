import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WIDTH_PX,
  MAX_WIDTH_PX,
  MIN_WIDTH_PX,
  clampWidth,
  thumbHeightFor,
} from './page-panel-size';

/**
 * These functions were reachable only through `PagePanel.test.tsx`, which
 * asserts on the rendered `flex-basis`. That hides a failure: a negative or
 * absurd width is invalid CSS, so the browser drops the declaration and the
 * element keeps its last good value — the panel then looks clamped whether or
 * not any clamping happened. Asserting the numbers directly is the only way to
 * tell the two apart.
 */

describe('clampWidth', () => {
  it('holds the panel at its minimum rather than letting it collapse', () => {
    // The exact value matters: "not less than the minimum" is also true of a
    // width that was never clamped at all.
    expect(clampWidth(0)).toBe(MIN_WIDTH_PX);
    expect(clampWidth(-500)).toBe(MIN_WIDTH_PX);
    expect(clampWidth(MIN_WIDTH_PX - 1)).toBe(MIN_WIDTH_PX);
  });

  it('holds the panel at its maximum rather than letting it swallow the viewer', () => {
    expect(clampWidth(5000)).toBe(MAX_WIDTH_PX);
    expect(clampWidth(MAX_WIDTH_PX + 1)).toBe(MAX_WIDTH_PX);
  });

  it('leaves a width between the two alone, give or take rounding', () => {
    expect(clampWidth(DEFAULT_WIDTH_PX)).toBe(DEFAULT_WIDTH_PX);
    expect(clampWidth(300.4)).toBe(300);
    expect(clampWidth(300.6)).toBe(301);
  });

  it('has a usable range at all', () => {
    expect(MIN_WIDTH_PX).toBeLessThan(MAX_WIDTH_PX);
    expect(DEFAULT_WIDTH_PX).toBeGreaterThanOrEqual(MIN_WIDTH_PX);
    expect(DEFAULT_WIDTH_PX).toBeLessThanOrEqual(MAX_WIDTH_PX);
  });
});

describe('thumbHeightFor', () => {
  it('keeps a preview shorter than the column is wide', () => {
    // A preview taller than the panel is wide fits one page on screen and
    // turns the panel into a scroll of single pages, which is the opposite of
    // what it is for.
    for (const width of [MIN_WIDTH_PX, DEFAULT_WIDTH_PX, MAX_WIDTH_PX]) {
      expect(thumbHeightFor(width)).toBeLessThan(width);
    }
  });

  it('grows with the panel, which is the point of dragging it', () => {
    expect(thumbHeightFor(MAX_WIDTH_PX)).toBeGreaterThan(thumbHeightFor(MIN_WIDTH_PX));
  });

  it('stays close to the page proportion it stands in for', () => {
    // Previews sit in a fixed-height slot, so the ratio decides how much of a
    // portrait page shows. Anything near square crops most of the page away.
    expect(thumbHeightFor(1000) / 1000).toBeGreaterThan(0.25);
    expect(thumbHeightFor(1000) / 1000).toBeLessThan(0.55);
  });

  it('returns whole pixels', () => {
    expect(Number.isInteger(thumbHeightFor(247))).toBe(true);
  });
});
