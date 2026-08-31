import { describe, expect, it } from 'vitest';
import { displayToUser, displayedSize, textDirection, toPageRotation, type PageRotation } from './rotation';
import { PdfInputError } from '../pdf/errors';

const ROTATIONS: PageRotation[] = [0, 90, 180, 270];

/** A portrait page, deliberately not square so a swapped axis cannot hide. */
const W = 400;
const H = 600;

/**
 * User space → display space: the *forward* direction, derived here independently
 * of the inverse the module implements.
 *
 * `/Rotate` turns the page clockwise for display. Turning a point clockwise by θ
 * is `(x, y) → (x·cos θ + y·sin θ, −x·sin θ + y·cos θ)`; the page is then shifted
 * back into the positive quadrant. Composed with the module's `displayToUser`,
 * this must come back to where it started.
 */
function userToDisplay(x: number, y: number, rotation: PageRotation): { x: number; y: number } {
  switch (rotation) {
    case 90:
      return { x: y, y: W - x };
    case 180:
      return { x: W - x, y: H - y };
    case 270:
      return { x: H - y, y: x };
    default:
      return { x, y };
  }
}

describe('toPageRotation', () => {
  it('normalises the angles pdf-lib reports', () => {
    expect(toPageRotation(0)).toBe(0);
    expect(toPageRotation(90)).toBe(90);
    expect(toPageRotation(450)).toBe(90);
    expect(toPageRotation(-90)).toBe(270);
    expect(toPageRotation(-360)).toBe(0);
  });

  it('rejects an angle PDF does not define', () => {
    // A malformed /Rotate must not be silently rounded into a plausible-looking
    // text layer.
    expect(() => toPageRotation(45)).toThrow(PdfInputError);
    expect(() => toPageRotation(45)).toThrow(/multiple of 90/);
  });
});

describe('displayedSize', () => {
  it('swaps the axes on a quarter turn and leaves them alone otherwise', () => {
    expect(displayedSize(W, H, 0)).toEqual({ width: W, height: H });
    expect(displayedSize(W, H, 180)).toEqual({ width: W, height: H });
    expect(displayedSize(W, H, 90)).toEqual({ width: H, height: W });
    expect(displayedSize(W, H, 270)).toEqual({ width: H, height: W });
  });
});

describe('displayToUser', () => {
  // These four are the anchor for everything else: each is a fact about turning
  // a sheet of paper, checkable without any algebra. Whichever corner of the
  // page ends up at the top-left of the display is where the display's top-left
  // point came from.

  it('maps the display top-left to the page top-left when unrotated', () => {
    const display = displayedSize(W, H, 0);
    expect(displayToUser(0, display.height, W, H, 0)).toEqual({ x: 0, y: H });
  });

  it('maps the display top-left to the page bottom-left at 90°', () => {
    // Turn a page clockwise a quarter turn: the bottom-left corner swings up to
    // the top left.
    const display = displayedSize(W, H, 90);
    expect(displayToUser(0, display.height, W, H, 90)).toEqual({ x: 0, y: 0 });
  });

  it('maps the display top-left to the page bottom-right at 180°', () => {
    // Turn it upside down: the bottom-right corner ends up top-left.
    const display = displayedSize(W, H, 180);
    expect(displayToUser(0, display.height, W, H, 180)).toEqual({ x: W, y: 0 });
  });

  it('maps the display top-left to the page top-right at 270°', () => {
    // A quarter turn anticlockwise: the top-right corner comes round to the top left.
    const display = displayedSize(W, H, 270);
    expect(displayToUser(0, display.height, W, H, 270)).toEqual({ x: W, y: H });
  });

  it.each(ROTATIONS)('inverts the forward rotation exactly at %i°', (rotation) => {
    // Independent forward transform in, module's inverse out: any slip in the
    // algebra shows up as a point that does not come home.
    const probes = [
      [0, 0],
      [W, 0],
      [0, H],
      [W, H],
      [W / 2, H / 2],
      [37, 401],
      [399, 13],
    ] as const;

    for (const [x, y] of probes) {
      const display = userToDisplay(x, y, rotation);
      const roundTripped = displayToUser(display.x, display.y, W, H, rotation);

      expect(roundTripped.x).toBeCloseTo(x, 9);
      expect(roundTripped.y).toBeCloseTo(y, 9);
    }
  });

  it.each(ROTATIONS)('keeps every display point on the page at %i°', (rotation) => {
    const display = displayedSize(W, H, rotation);
    const corners = [
      [0, 0],
      [display.width, 0],
      [0, display.height],
      [display.width, display.height],
    ] as const;

    for (const [x, y] of corners) {
      const user = displayToUser(x, y, W, H, rotation);

      expect(user.x).toBeGreaterThanOrEqual(0);
      expect(user.x).toBeLessThanOrEqual(W);
      expect(user.y).toBeGreaterThanOrEqual(0);
      expect(user.y).toBeLessThanOrEqual(H);
    }
  });

  it.each(ROTATIONS)('preserves distances at %i°, since a rotation cannot stretch', (rotation) => {
    const a = displayToUser(10, 20, W, H, rotation);
    const b = displayToUser(310, 220, W, H, rotation);

    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(Math.hypot(300, 200), 9);
  });
});

describe('textDirection', () => {
  it('runs text bottom-to-top on a page turned 90° clockwise', () => {
    // The page is turned clockwise to be read, so on the untuned page the text
    // must climb the +y axis for it to come out horizontal on screen.
    expect(textDirection(90)).toEqual({ cos: 0, sin: 1 });
  });

  it('runs text left-to-right when the page is upright', () => {
    expect(textDirection(0)).toEqual({ cos: 1, sin: 0 });
  });

  it.each(ROTATIONS)('is a unit direction at %i°', (rotation) => {
    const { cos, sin } = textDirection(rotation);

    // Anything else would scale the glyphs as a side effect of rotating them.
    expect(Math.hypot(cos, sin)).toBeCloseTo(1, 9);
  });

  it.each(ROTATIONS)('agrees with the point transform at %i°', (rotation) => {
    // A step along the display's x axis must move by the same direction the
    // text runs in. This is what ties the glyph orientation to the geometry:
    // if they disagreed, the text would sit in the right place facing the wrong way.
    const origin = displayToUser(100, 100, W, H, rotation);
    const stepped = displayToUser(101, 100, W, H, rotation);
    const { cos, sin } = textDirection(rotation);

    expect(stepped.x - origin.x).toBeCloseTo(cos, 9);
    expect(stepped.y - origin.y).toBeCloseTo(sin, 9);
  });
});
