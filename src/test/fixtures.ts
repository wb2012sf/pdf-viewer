import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';

/**
 * Builds an in-memory PDF whose pages are individually identifiable.
 *
 * Page `i` is given width `PAGE_WIDTH_BASE + i` and a visible "Page i" label,
 * so a test can assert *which* source page ended up where after a merge,
 * split, reorder or extract — not merely that the page count is right.
 */
export const PAGE_WIDTH_BASE = 100;
export const PAGE_HEIGHT = 200;

export interface FixtureOptions {
  /** Rotation applied to every page, in degrees. Defaults to 0. */
  rotation?: number;
}

export async function makePdf(pageCount: number, options: FixtureOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (let index = 0; index < pageCount; index += 1) {
    const page = doc.addPage([PAGE_WIDTH_BASE + index, PAGE_HEIGHT]);
    page.drawText(`Page ${String(index)}`, { x: 10, y: 100, size: 12, font });
    if (options.rotation !== undefined) {
      page.setRotation(degrees(options.rotation));
    }
  }
  return doc.save();
}

/**
 * Reads back the page widths of `bytes`, which identify the original pages of
 * a fixture built by {@link makePdf}.
 */
export async function pageWidths(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => Math.round(page.getWidth()));
}

/** Original fixture page indices, recovered from page widths. */
export async function pageOrder(bytes: Uint8Array): Promise<number[]> {
  return (await pageWidths(bytes)).map((width) => width - PAGE_WIDTH_BASE);
}
