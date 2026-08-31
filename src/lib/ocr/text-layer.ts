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

interface Placement {
  x: number;
  y: number;
  fontSize: number;
  /** Horizontal scaling percentage (the PDF `Tz` operator). */
  squeeze: number;
  text: string;
}

/**
 * Maps one word from image pixel space onto an unrotated PDF page.
 *
 * Tesseract measures from the top-left of the image in pixels; PDF user space
 * runs from the bottom-left in points. The width of the glyphs is then squeezed
 * so the invisible word occupies exactly the box the visible ink occupies —
 * without that, selecting text drags a highlight that does not line up with
 * what the reader sees.
 *
 * Returns `null` when the word cannot contribute anything searchable.
 */
export function placeWord(
  word: OcrWord,
  page: { imageWidth: number; imageHeight: number },
  pageWidth: number,
  pageHeight: number,
  font: PDFFont,
): Placement | null {
  const text = toWinAnsi(word.text).trim();
  if (text.length === 0) return null;

  const scaleX = pageWidth / page.imageWidth;
  const scaleY = pageHeight / page.imageHeight;

  const boxWidth = (word.bbox.x1 - word.bbox.x0) * scaleX;
  const boxHeight = (word.bbox.y1 - word.bbox.y0) * scaleY;
  if (boxWidth <= 0 || boxHeight <= 0) return null;

  const naturalWidth = font.widthOfTextAtSize(text, LAYOUT_FONT_SIZE);
  if (naturalWidth <= 0) return null;

  // The box height is the word's full extent including descenders, so the font
  // size that visually matches is a little smaller than the box.
  const fontSize = boxHeight * 0.8;
  const widthAtFontSize = (naturalWidth / LAYOUT_FONT_SIZE) * fontSize;

  return {
    x: word.bbox.x0 * scaleX,
    // y1 is the bottom of the box in image space, which is the text baseline
    // once the y axis is flipped.
    y: pageHeight - word.bbox.y1 * scaleY,
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
    setTextMatrix(1, 0, 0, 1, placement.x, placement.y),
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

    // A rotated page renders to an image whose axes no longer line up with user
    // space, so every box would need transforming through the rotation. That is
    // not implemented, and placing the text as if the page were upright would
    // scatter it — better to say so than to write a layer that mislocates every
    // word. Callers can rotate the page to 0 first.
    const rotation = ((page.getRotation().angle % 360) + 360) % 360;
    if (rotation !== 0) {
      throw new PdfInputError(
        `ocr: page ${String(ocrPage.pageIndex + 1)} is rotated ${String(rotation)}°; OCR currently supports unrotated pages only`,
      );
    }

    const { width, height } = page.getSize();
    const fontKey = page.node.newFontDictionary(font.name, font.ref);

    for (const word of ocrPage.words) {
      if (word.confidence < minConfidence) {
        wordsSkipped += 1;
        continue;
      }
      const placement = placeWord(word, ocrPage, width, height, font);
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
