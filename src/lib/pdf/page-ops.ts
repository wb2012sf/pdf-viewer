import { PDFDocument, degrees } from 'pdf-lib';
import { PdfInputError, assertPageIndices, assertPdfBytes } from './errors';

/** Rotation in degrees; PDF only stores multiples of 90. */
export type Rotation = 0 | 90 | 180 | 270;

/**
 * Loads a PDF for structural editing.
 *
 * `ignoreEncryption` is deliberately off: a password-protected file must fail
 * loudly here rather than silently producing a broken copy.
 */
async function load(bytes: Uint8Array, label: string): Promise<PDFDocument> {
  assertPdfBytes(bytes, label);
  try {
    return await PDFDocument.load(bytes);
  } catch (cause) {
    throw new PdfInputError(`${label}: could not be parsed as a PDF (${String(cause)})`);
  }
}

/** Number of pages in `bytes`. */
export async function getPageCount(bytes: Uint8Array): Promise<number> {
  const doc = await load(bytes, 'document');
  return doc.getPageCount();
}

/**
 * Concatenates `documents` in the order given.
 *
 * Annotations and form fields on the source pages are carried over by
 * pdf-lib's `copyPages`, which is what keeps previously annotated files
 * readable after a merge.
 */
export async function mergePdfs(documents: readonly Uint8Array[]): Promise<Uint8Array> {
  if (documents.length === 0) {
    throw new PdfInputError('merge: at least one document is required');
  }

  const merged = await PDFDocument.create();
  for (const [position, bytes] of documents.entries()) {
    const source = await load(bytes, `merge input ${String(position + 1)}`);
    const pages = await merged.copyPages(source, source.getPageIndices());
    for (const page of pages) {
      merged.addPage(page);
    }
  }
  return merged.save();
}

/**
 * Produces a new document containing only `pageIndices`, in the order given.
 *
 * Repeating an index duplicates that page, which is what makes this the single
 * primitive behind extract, reorder and split.
 */
export async function extractPages(bytes: Uint8Array, pageIndices: readonly number[]): Promise<Uint8Array> {
  const source = await load(bytes, 'document');
  assertPageIndices(pageIndices, source.getPageCount(), 'extract');

  const output = await PDFDocument.create();
  const pages = await output.copyPages(source, [...pageIndices]);
  for (const page of pages) {
    output.addPage(page);
  }
  return output.save();
}

/**
 * Rewrites the page order. `order` must be a permutation of every page index,
 * so that reordering can never silently drop a page.
 */
export async function reorderPages(bytes: Uint8Array, order: readonly number[]): Promise<Uint8Array> {
  const source = await load(bytes, 'document');
  const pageCount = source.getPageCount();
  assertPageIndices(order, pageCount, 'reorder');

  if (order.length !== pageCount || new Set(order).size !== pageCount) {
    throw new PdfInputError(
      `reorder: expected a permutation of all ${String(pageCount)} pages, got ${String(order.length)} index/indices`,
    );
  }
  return extractPages(bytes, order);
}

/**
 * Splits into one document per range. Ranges are `[start, end)` in zero-based
 * page indices, matching `Array.prototype.slice`.
 */
export async function splitPdf(
  bytes: Uint8Array,
  ranges: readonly (readonly [start: number, end: number])[],
): Promise<Uint8Array[]> {
  const source = await load(bytes, 'document');
  const pageCount = source.getPageCount();

  if (ranges.length === 0) {
    throw new PdfInputError('split: at least one page range is required');
  }

  const parts: Uint8Array[] = [];
  for (const [start, end] of ranges) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > pageCount || start >= end) {
      throw new PdfInputError(
        `split: range [${String(start)}, ${String(end)}) is not a valid slice of a ${String(pageCount)}-page document`,
      );
    }
    const indices = Array.from({ length: end - start }, (_unused, offset) => start + offset);
    parts.push(await extractPages(bytes, indices));
  }
  return parts;
}

/**
 * Rotates `pageIndices` by `rotation` degrees relative to their current
 * rotation, leaving every other page untouched.
 */
export async function rotatePages(
  bytes: Uint8Array,
  pageIndices: readonly number[],
  rotation: Rotation,
): Promise<Uint8Array> {
  const doc = await load(bytes, 'document');
  assertPageIndices(pageIndices, doc.getPageCount(), 'rotate');

  for (const index of pageIndices) {
    const page = doc.getPage(index);
    const next = (((page.getRotation().angle + rotation) % 360) + 360) % 360;
    page.setRotation(degrees(next));
  }
  return doc.save();
}

/** Rotation currently stored on each page, in document order. */
export async function getPageRotations(bytes: Uint8Array): Promise<number[]> {
  const doc = await load(bytes, 'document');
  return doc.getPages().map((page) => page.getRotation().angle);
}
