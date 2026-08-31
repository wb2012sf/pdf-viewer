import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { applyTextLayer, placeWord, type TargetPage } from './text-layer';
import { PdfInputError } from '../pdf/errors';
import { getPageCount } from '../pdf/page-ops';
import { displayedSize, type PageRotation } from './rotation';
import { makeEncryptedPdf, makePdf, pageContentStream } from '../../test/fixtures';
import type { OcrPage, OcrWord } from './types';

/** A page image twice the size of the fixture page, as a 144 DPI render would be. */
const IMAGE = { imageWidth: 200, imageHeight: 400 };

/** The fixture page `makePdf` produces, at its natural orientation. */
const UPRIGHT: TargetPage = { width: 100, height: 200, rotation: 0 };

function word(text: string, bbox: OcrWord['bbox'], confidence = 90): OcrWord {
  return { text, confidence, bbox };
}

function ocrPage(words: OcrWord[], pageIndex = 0): OcrPage {
  return { pageIndex, ...IMAGE, words };
}

async function helvetica() {
  const doc = await PDFDocument.create();
  return doc.embedFont(StandardFonts.Helvetica);
}

/** Hex, as pdf-lib writes it into a content stream (uppercase), for asserting on glyphs. */
function hex(text: string): string {
  return [...text].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()).join('');
}

describe('placeWord', () => {
  it('flips the y axis, so a word at the top of the image sits at the top of the page', async () => {
    const font = await helvetica();
    // Image is 400px tall, page 200pt: a word in the top 10% of the image
    // belongs near y=180 on the page, not near y=20.
    const placed = placeWord(word('Header', { x0: 0, y0: 0, x1: 100, y1: 40 }), IMAGE, UPRIGHT, font);

    expect(placed).not.toBeNull();
    expect(placed?.matrix[5]).toBeCloseTo(180, 5);
  });

  it('scales x from image pixels into page points', async () => {
    const font = await helvetica();
    const placed = placeWord(word('Word', { x0: 50, y0: 0, x1: 150, y1: 40 }), IMAGE, UPRIGHT, font);

    // 50px into a 200px-wide image is 25pt into a 100pt-wide page.
    expect(placed?.matrix[4]).toBeCloseTo(25, 5);
  });

  it('squeezes the glyphs so the invisible word covers exactly the ink it stands for', async () => {
    const font = await helvetica();
    const box = { x0: 20, y0: 100, x1: 160, y1: 140 };
    const placed = placeWord(word('Alignment', box), IMAGE, UPRIGHT, font);
    expect(placed).not.toBeNull();

    // This is what makes a text selection line up with the scan underneath.
    const expectedWidth = (box.x1 - box.x0) * (100 / IMAGE.imageWidth);
    const renderedWidth =
      font.widthOfTextAtSize(placed!.text, placed!.fontSize) * (placed!.squeeze / 100);

    expect(renderedWidth).toBeCloseTo(expectedWidth, 5);
  });

  it('skips a word with nothing searchable left after folding', async () => {
    const font = await helvetica();

    expect(placeWord(word('   ', { x0: 0, y0: 0, x1: 10, y1: 10 }), IMAGE, UPRIGHT, font)).toBeNull();
    expect(placeWord(word('日本語', { x0: 0, y0: 0, x1: 10, y1: 10 }), IMAGE, UPRIGHT, font)).toBeNull();
  });

  it('skips a degenerate box', async () => {
    const font = await helvetica();

    expect(placeWord(word('x', { x0: 10, y0: 10, x1: 10, y1: 20 }), IMAGE, UPRIGHT, font)).toBeNull();
    expect(placeWord(word('x', { x0: 10, y0: 20, x1: 20, y1: 20 }), IMAGE, UPRIGHT, font)).toBeNull();
  });
});

/**
 * User space → display space, written here independently of the inverse the
 * module uses, so these tests check the composition rather than restate it.
 */
function toDisplay(
  x: number,
  y: number,
  pageWidth: number,
  pageHeight: number,
  rotation: PageRotation,
): { x: number; y: number } {
  switch (rotation) {
    case 90:
      return { x: y, y: pageWidth - x };
    case 180:
      return { x: pageWidth - x, y: pageHeight - y };
    case 270:
      return { x: pageHeight - y, y: x };
    default:
      return { x, y };
  }
}

describe.each([0, 90, 180, 270] as PageRotation[])('placeWord on a page rotated %i°', (rotation) => {
  const page: TargetPage = { width: 100, height: 200, rotation };
  const display = displayedSize(page.width, page.height, rotation);
  // A render of the page as displayed, at 2x, which is the only image a
  // recogniser ever sees.
  const image = { imageWidth: display.width * 2, imageHeight: display.height * 2 };
  const box = { x0: 20, y0: 30, x1: 140, y1: 70 };
  const expected = { x0: box.x0 / 2, x1: box.x1 / 2, baseline: display.height - box.y1 / 2 };

  it('starts the baseline exactly where the ink starts', async () => {
    const font = await helvetica();
    const placed = placeWord(word('Aligned', box), image, page, font);
    expect(placed).not.toBeNull();

    // Map the placement back out to display space: it has to land on the box
    // Tesseract reported, whatever the page rotation did in between.
    const [, , , , e, f] = placed!.matrix;
    const start = toDisplay(e, f, page.width, page.height, rotation);

    expect(start.x).toBeCloseTo(expected.x0, 6);
    expect(start.y).toBeCloseTo(expected.baseline, 6);
  });

  it('runs the glyphs along the ink and ends where it ends', async () => {
    const font = await helvetica();
    const placed = placeWord(word('Aligned', box), image, page, font);
    const [a, b, , , e, f] = placed!.matrix;

    // Stepping the width of the box along the text direction must arrive at the
    // far end of the box — this is what proves the text is not merely in the
    // right place but facing the right way.
    const width = (box.x1 - box.x0) / 2;
    const end = toDisplay(e + a * width, f + b * width, page.width, page.height, rotation);

    expect(end.x).toBeCloseTo(expected.x1, 6);
    expect(end.y).toBeCloseTo(expected.baseline, 6);
  });

  it('keeps the baseline inside the page', async () => {
    const font = await helvetica();
    const [, , , , e, f] = placeWord(word('Aligned', box), image, page, font)!.matrix;

    expect(e).toBeGreaterThanOrEqual(0);
    expect(e).toBeLessThanOrEqual(page.width);
    expect(f).toBeGreaterThanOrEqual(0);
    expect(f).toBeLessThanOrEqual(page.height);
  });
});

describe('applyTextLayer', () => {
  it('writes the recognized words into the page content stream', async () => {
    const { pdf } = await applyTextLayer(await makePdf(1), [
      ocrPage([word('Searchable', { x0: 10, y0: 10, x1: 120, y1: 40 })]),
    ]);

    expect(await pageContentStream(pdf, 0)).toContain(hex('Searchable'));
  });

  it('marks the text invisible, so the scan is what the reader still sees', async () => {
    const { pdf } = await applyTextLayer(await makePdf(1), [
      ocrPage([word('Hidden', { x0: 10, y0: 10, x1: 120, y1: 40 })]),
    ]);

    // Tr 3 is the PDF operator for "lay this text out but paint nothing".
    expect(await pageContentStream(pdf, 0)).toMatch(/\b3 Tr\b/);
  });

  it('leaves the existing page content in place', async () => {
    // The visible page must survive: OCR adds a layer, it does not redraw.
    const source = await makePdf(1);
    const before = await pageContentStream(source, 0);
    const { pdf } = await applyTextLayer(source, [ocrPage([word('Extra', { x0: 0, y0: 0, x1: 50, y1: 20 })])]);

    expect(before).toContain(hex('Page 0'));
    expect(await pageContentStream(pdf, 0)).toContain(hex('Page 0'));
  });

  it('keeps the document otherwise intact', async () => {
    const { pdf } = await applyTextLayer(await makePdf(3), [
      ocrPage([word('One', { x0: 0, y0: 0, x1: 50, y1: 20 })], 0),
      ocrPage([word('Three', { x0: 0, y0: 0, x1: 50, y1: 20 })], 2),
    ]);

    expect(await getPageCount(pdf)).toBe(3);
  });

  it('touches only the pages it was given results for', async () => {
    const { pdf } = await applyTextLayer(await makePdf(2), [
      ocrPage([word('OnlyHere', { x0: 0, y0: 0, x1: 50, y1: 20 })], 1),
    ]);

    expect(await pageContentStream(pdf, 0)).not.toContain(hex('OnlyHere'));
    expect(await pageContentStream(pdf, 1)).toContain(hex('OnlyHere'));
  });

  it('reports what it added and what it dropped', async () => {
    const report = await applyTextLayer(await makePdf(1), [
      ocrPage([
        word('Confident', { x0: 0, y0: 0, x1: 50, y1: 20 }, 95),
        word('Doubtful', { x0: 0, y0: 30, x1: 50, y1: 50 }, 5),
        word('   ', { x0: 0, y0: 60, x1: 50, y1: 80 }, 99),
      ]),
    ]);

    expect(report.wordsAdded).toBe(1);
    expect(report.wordsSkipped).toBe(2);
  });

  it('keeps low-confidence guesses out of the file entirely', async () => {
    // A wrong word is worse than a missing one: it makes search match a page
    // that does not contain the term.
    const { pdf } = await applyTextLayer(await makePdf(1), [
      ocrPage([word('Speckle', { x0: 0, y0: 0, x1: 50, y1: 20 }, 4)]),
    ]);

    expect(await pageContentStream(pdf, 0)).not.toContain(hex('Speckle'));
  });

  it('honours a caller-supplied confidence threshold', async () => {
    const words = [word('Marginal', { x0: 0, y0: 0, x1: 50, y1: 20 }, 40)];

    expect((await applyTextLayer(await makePdf(1), [ocrPage(words)], { minConfidence: 80 })).wordsAdded).toBe(0);
    expect((await applyTextLayer(await makePdf(1), [ocrPage(words)], { minConfidence: 10 })).wordsAdded).toBe(1);
  });

  it('rejects a nonsensical confidence threshold', async () => {
    await expect(
      applyTextLayer(await makePdf(1), [ocrPage([])], { minConfidence: 150 }),
    ).rejects.toThrow(/between 0 and 100/);
  });

  it('rejects results aimed at a page that does not exist', async () => {
    await expect(
      applyTextLayer(await makePdf(2), [ocrPage([word('x', { x0: 0, y0: 0, x1: 5, y1: 5 })], 7)]),
    ).rejects.toThrow(/out of range/);
  });

  it('rejects results from an image with no size, which would divide by zero', async () => {
    await expect(
      applyTextLayer(await makePdf(1), [{ pageIndex: 0, imageWidth: 0, imageHeight: 400, words: [] }]),
    ).rejects.toThrow(/no size/);
  });

  it('refuses an encrypted document', async () => {
    await expect(applyTextLayer(await makeEncryptedPdf(), [ocrPage([])])).rejects.toThrow(
      /password-protected/,
    );
  });

  it.each([0, 90, 180, 270] as PageRotation[])('writes a text layer onto a page rotated %i°', async (rotation) => {
    const { pdf, wordsAdded } = await applyTextLayer(await makePdf(1, { rotation }), [
      ocrPage([word('Rotated', { x0: 10, y0: 10, x1: 120, y1: 40 })]),
    ]);

    expect(wordsAdded).toBe(1);
    expect(await pageContentStream(pdf, 0)).toContain(hex('Rotated'));
  });

  it('rejects a page whose /Rotate is not a quarter turn', async () => {
    // pdf-lib refuses to *write* an angle like this, so the fixture sets the raw
    // dictionary entry — a file produced by other software can carry one, and
    // rounding it into a plausible-looking text layer would misplace every word.
    const doc = await PDFDocument.load(await makePdf(1));
    doc.getPage(0).node.set(PDFName.of('Rotate'), doc.context.obj(45));
    const malformed = await doc.save();

    await expect(
      applyTextLayer(malformed, [ocrPage([word('x', { x0: 0, y0: 0, x1: 5, y1: 5 })])]),
    ).rejects.toThrow(/multiple of 90/);
  });

  it('rejects non-PDF input at the boundary', async () => {
    await expect(applyTextLayer(new Uint8Array([1, 2, 3]), [])).rejects.toBeInstanceOf(PdfInputError);
  });

  it('produces a document that still loads', async () => {
    const { pdf } = await applyTextLayer(await makePdf(2), [
      ocrPage([word('Roundtrip', { x0: 10, y0: 10, x1: 120, y1: 40 })]),
    ]);

    await expect(PDFDocument.load(pdf)).resolves.toBeDefined();
  });
});
