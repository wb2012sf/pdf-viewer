import {
  PDFDocument,
  StandardFonts,
  TextRenderingMode,
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setCharacterSqueeze,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  type PDFFont,
  type PDFName,
  type PDFPage,
} from 'pdf-lib';
import { PdfInputError, assertPdfBytes } from '../pdf/errors';
import { displayToUser, displayedSize, textDirection, toPageRotation, type PageRotation } from './rotation';
import { toWinAnsi } from './win-ansi';
import type { OcrPage, OcrWord } from './types';

export interface TextLayerOptions {
  /**
   * Words recognized below this confidence (0–100) are left out. Tesseract
   * scores garbage from speckles and scan artefacts low, and a wrong word in
   * the text layer is worse than a missing one: it makes search match a page
   * that does not contain the term.
   *
   * @default 30
   */
  minConfidence?: number;
}

const DEFAULT_MIN_CONFIDENCE = 30;

/** Nominal size the invisible text is laid out at before being squeezed to fit. */
const LAYOUT_FONT_SIZE = 12;

export interface Placement {
  /** A PDF text matrix: `[a, b, c, d, e, f]`, rotation in the first four. */
  matrix: readonly [number, number, number, number, number, number];
  fontSize: number;
  /** Horizontal scaling percentage (the PDF `Tz` operator). */
  squeeze: number;
  text: string;
}

/** The page a word is being placed on, in its own unrotated coordinates. */
export interface TargetPage {
  width: number;
  height: number;
  rotation: PageRotation;
}

/**
 * Maps one word from image pixel space onto a page.
 *
 * Tesseract measures from the top-left of the *rendered* image in pixels, so
 * its boxes are in display space — already rotated. The placement therefore
 * goes: pixels → display points → user space, with the text matrix carrying the
 * rotation so the invisible glyphs run along the same direction as the visible
 * ink. On an unrotated page that rotation is the identity and this reduces to a
 * scale and a y-flip.
 *
 * The glyph widths are then squeezed so the invisible word occupies exactly the
 * box the visible ink occupies — without that, selecting text drags a highlight
 * that does not line up with what the reader sees.
 *
 * Returns `null` when the word cannot contribute anything searchable.
 */
export function placeWord(
  word: OcrWord,
  image: { imageWidth: number; imageHeight: number },
  page: TargetPage,
  font: PDFFont,
): Placement | null {
  const text = toWinAnsi(word.text).trim();
  if (text.length === 0) return null;

  // The image is a picture of the *displayed* page, so pixels scale against the
  // displayed size — which has its axes swapped on a quarter turn.
  const display = displayedSize(page.width, page.height, page.rotation);
  const scaleX = display.width / image.imageWidth;
  const scaleY = display.height / image.imageHeight;

  const boxWidth = (word.bbox.x1 - word.bbox.x0) * scaleX;
  const boxHeight = (word.bbox.y1 - word.bbox.y0) * scaleY;
  if (boxWidth <= 0 || boxHeight <= 0) return null;

  const naturalWidth = font.widthOfTextAtSize(text, LAYOUT_FONT_SIZE);
  if (naturalWidth <= 0) return null;

  // The box height is the word's full extent including descenders, so the font
  // size that visually matches is a little smaller than the box.
  const fontSize = boxHeight * 0.8;
  const widthAtFontSize = (naturalWidth / LAYOUT_FONT_SIZE) * fontSize;

  // Baseline start, in display space: the left edge of the box, and y1 — the
  // box's bottom in image space — once the y axis is flipped.
  const origin = displayToUser(
    word.bbox.x0 * scaleX,
    display.height - word.bbox.y1 * scaleY,
    page.width,
    page.height,
    page.rotation,
  );
  const { cos, sin } = textDirection(page.rotation);

  return {
    matrix: [cos, sin, -sin, cos, origin.x, origin.y],
    fontSize,
    squeeze: (boxWidth / widthAtFontSize) * 100,
    text,
  };
}

function drawInvisible(page: PDFPage, fontKey: PDFName, placement: Placement, font: PDFFont): void {
  page.pushOperators(
    pushGraphicsState(),
    beginText(),
    // Render mode 3: the glyphs are laid out, measured and selectable, but
    // never painted. This is what makes the scan searchable without covering it.
    setTextRenderingMode(TextRenderingMode.Invisible),
    setFontAndSize(fontKey, placement.fontSize),
    setCharacterSqueeze(placement.squeeze),
    setTextMatrix(...placement.matrix),
    showText(font.encodeText(placement.text)),
    endText(),
    popGraphicsState(),
  );
}

export interface TextLayerReport {
  /** Words actually written into the document. */
  wordsAdded: number;
  /** Words skipped for low confidence or for having no encodable characters. */
  wordsSkipped: number;
  pdf: Uint8Array;
}

/**
 * Writes recognized text into `pdfBytes` as an invisible, searchable layer.
 *
 * The visible page is untouched: this only appends text-drawing operators, so
 * a scan still looks exactly like the scan. Running it twice would layer text
 * twice over, so callers OCR a page once.
 */
export async function applyTextLayer(
  pdfBytes: Uint8Array,
  pages: readonly OcrPage[],
  options: TextLayerOptions = {},
): Promise<TextLayerReport> {
  assertPdfBytes(pdfBytes, 'document');

  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 100) {
    throw new PdfInputError(`ocr: minConfidence must be between 0 and 100, got ${String(minConfidence)}`);
  }

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  } catch (cause) {
    throw new PdfInputError(`document: could not be parsed as a PDF (${String(cause)})`);
  }
  if (doc.isEncrypted) {
    throw new PdfInputError('document: this PDF is password-protected, and opening encrypted PDFs is not supported');
  }

  const pageCount = doc.getPageCount();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  let wordsAdded = 0;
  let wordsSkipped = 0;

  for (const ocrPage of pages) {
    validateOcrPage(ocrPage, pageCount);

    const page = doc.getPage(ocrPage.pageIndex);

    // Tesseract read the page as displayed, so its boxes already have `/Rotate`
    // baked in; `placeWord` transforms them back into user space.
    const { width, height } = page.getSize();
    const target: TargetPage = { width, height, rotation: toPageRotation(page.getRotation().angle) };

    const fontKey = page.node.newFontDictionary(font.name, font.ref);

    for (const word of ocrPage.words) {
      if (word.confidence < minConfidence) {
        wordsSkipped += 1;
        continue;
      }
      const placement = placeWord(word, ocrPage, target, font);
      if (!placement) {
        wordsSkipped += 1;
        continue;
      }
      drawInvisible(page, fontKey, placement, font);
      wordsAdded += 1;
    }
  }

  return { wordsAdded, wordsSkipped, pdf: await doc.save() };
}

function validateOcrPage(page: OcrPage, pageCount: number): void {
  if (!Number.isInteger(page.pageIndex) || page.pageIndex < 0 || page.pageIndex >= pageCount) {
    throw new PdfInputError(
      `ocr: page index ${String(page.pageIndex)} is out of range for a ${String(pageCount)}-page document`,
    );
  }
  if (!(page.imageWidth > 0) || !(page.imageHeight > 0)) {
    throw new PdfInputError(
      `ocr: page ${String(page.pageIndex + 1)} was recognized from an image with no size (${String(page.imageWidth)}x${String(page.imageHeight)})`,
    );
  }
}
