import { PdfInputError } from '../pdf/errors';

/**
 * Geometry for placing OCR results on a page that carries a `/Rotate` entry.
 *
 * There are three coordinate spaces in play:
 *
 *  - **image space** — what Tesseract measures in. Pixels, origin top-left,
 *    y growing *downward*.
 *  - **display space** — the page as a reader sees it, after `/Rotate` has been
 *    applied. Points, origin bottom-left. This is what the image is a picture of.
 *  - **user space** — the page's own unrotated coordinates, which is where
 *    content actually has to be written. Points, origin bottom-left.
 *
 * `/Rotate` is defined by the PDF spec as the angle the page is turned
 * **clockwise** for display, so going from display space back to user space
 * means turning it back counter-clockwise.
 */

export type PageRotation = 0 | 90 | 180 | 270;

/** Normalises a raw `/Rotate` value, rejecting angles PDF does not define. */
export function toPageRotation(angle: number): PageRotation {
  const normalized = (((angle % 360) + 360) % 360) as PageRotation;
  if (normalized !== 0 && normalized !== 90 && normalized !== 180 && normalized !== 270) {
    throw new PdfInputError(`ocr: page rotation must be a multiple of 90°, got ${String(angle)}°`);
  }
  return normalized;
}

/**
 * The size the page presents when displayed — which is the aspect ratio the
 * rendered image will have. A quarter turn swaps the axes.
 */
export function displayedSize(
  width: number,
  height: number,
  rotation: PageRotation,
): { width: number; height: number } {
  return rotation === 90 || rotation === 270 ? { width: height, height: width } : { width, height };
}

/**
 * Maps a point from display space back into user space.
 *
 * Each case is the corner check it has to satisfy — take a sheet of paper, turn
 * it the stated way, and see which corner lands top-left:
 *
 *  - **90° (turned clockwise)**: the *bottom-left* corner swings up to the top
 *    left. So the display's top-left is user-space `(0, 0)`.
 *  - **180°**: the *bottom-right* corner ends up top-left, i.e. `(w, 0)`.
 *  - **270° (a quarter turn anticlockwise)**: the *top-right* corner comes round
 *    to the top left, i.e. `(w, h)`.
 */
export function displayToUser(
  x: number,
  y: number,
  pageWidth: number,
  pageHeight: number,
  rotation: PageRotation,
): { x: number; y: number } {
  switch (rotation) {
    case 90:
      return { x: pageWidth - y, y: x };
    case 180:
      return { x: pageWidth - x, y: pageHeight - y };
    case 270:
      return { x: y, y: pageHeight - x };
    default:
      return { x, y };
  }
}

/**
 * The direction text runs in user space, as the cosine/sine pair a PDF text
 * matrix wants.
 *
 * Text that reads left-to-right on the *display* of a page turned 90° clockwise
 * must, on the unturned page, run bottom-to-top — so the pair is `(0, 1)`.
 */
export function textDirection(rotation: PageRotation): { cos: number; sin: number } {
  switch (rotation) {
    case 90:
      return { cos: 0, sin: 1 };
    case 180:
      return { cos: -1, sin: 0 };
    case 270:
      return { cos: 0, sin: -1 };
    default:
      return { cos: 1, sin: 0 };
  }
}
