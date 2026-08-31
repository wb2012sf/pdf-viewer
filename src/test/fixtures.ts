import {
  PDFArray,
  PDFDocument,
  PDFHexString,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
  degrees,
} from 'pdf-lib';

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
 * Builds a PDF that presents itself as password-protected.
 *
 * Nothing in this stack can produce a genuinely encrypted PDF — that is exactly
 * why encrypt/decrypt is out of scope — so the fixture carries the marker a
 * reader actually keys on: an /Encrypt dictionary referenced from the trailer.
 * A real password-protected file presents the same marker, and it is what the
 * refusal in `lib/pdf/page-ops.ts` must trip on.
 */
export async function makeEncryptedPdf(pageCount = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    doc.addPage([PAGE_WIDTH_BASE + index, PAGE_HEIGHT]);
  }

  // Standard security handler, RC4 40-bit (V1/R2) — the oldest scheme every
  // conforming reader recognises. The O/U hashes are placeholders because no
  // reader gets far enough to verify them: the dictionary's presence is the
  // whole signal.
  const { context } = doc;
  const encrypt = context.obj({
    Filter: 'Standard',
    V: 1,
    R: 2,
    O: PDFHexString.of('0'.repeat(64)),
    U: PDFHexString.of('0'.repeat(64)),
    P: -1,
  });
  context.trailerInfo.Encrypt = context.register(encrypt);

  // Cross-reference *streams* would bury the trailer inside a compressed
  // object; a classic trailer keeps the /Encrypt entry where a plain reader
  // (and a human running `tail` on the fixture) will find it.
  return doc.save({ useObjectStreams: false });
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

/**
 * Decompresses a page's content stream back to PDF operators.
 *
 * This is how a test can assert what was actually written into the file —
 * that text really carries render mode 3, that the glyphs really are the ones
 * expected — rather than trusting the function that wrote it.
 */
export async function pageContentStream(bytes: Uint8Array, pageIndex: number): Promise<string> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const contents = doc.getPage(pageIndex).node.Contents();
  if (!contents) return '';

  const context = doc.context;
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => context.lookup(ref)) : [contents];

  // latin1 keeps every byte as one character, so hex strings and operator names
  // survive intact even where the stream holds arbitrary binary.
  const decoder = new TextDecoder('latin1');
  return streams
    .map((stream) => (stream instanceof PDFRawStream ? decoder.decode(decodePDFRawStream(stream).decode()) : ''))
    .join('\n');
}
