/**
 * Shapes shared by the two halves of OCR: recognition (Tesseract, browser only)
 * and the searchable text layer (pdf-lib, environment-agnostic).
 *
 * Keeping them apart is what makes the text layer testable without a browser:
 * `applyTextLayer` never sees a Tesseract type, only these.
 */

/** A box in *image pixel* space, origin top-left, y growing downward. */
export interface PixelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** One recognized word, positioned in the page image it was read from. */
export interface OcrWord {
  text: string;
  /** Tesseract's confidence, 0–100. */
  confidence: number;
  bbox: PixelBox;
}

/** Everything recognized from one rendered page image. */
export interface OcrPage {
  /** Zero-based index of the page in the source document. */
  pageIndex: number;
  /** Width of the rendered image, in pixels. */
  imageWidth: number;
  /** Height of the rendered image, in pixels. */
  imageHeight: number;
  words: OcrWord[];
}
