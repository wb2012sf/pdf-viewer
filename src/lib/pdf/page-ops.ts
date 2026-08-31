import { PDFDocument, degrees } from 'pdf-lib';
import { PdfInputError, assertPageIndices, assertPdfBytes } from './errors';

/** Rotation in degrees; PDF only stores multiples of 90. */
export type Rotation = 0 | 90 | 180 | 270;

/**
 * Loads a PDF for structural editing, refusing anything this tool cannot
 * faithfully write back out.
 */
async function load(bytes: Uint8Array, label: string): Promise<PDFDocument> {
  assertPdfBytes(bytes, label);

  let doc: PDFDocument;
  try {
    // Loaded past pdf-lib's own encryption guard so that the check below can
    // report *why* the file is unusable. `isEncrypted` is a plain boolean,
    // which keeps this independent of pdf-lib's error classes surviving the
    // bundler's choice between its CJS and ESM builds.
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch (cause) {
    throw new PdfInputError(`${label}: could not be parsed as a PDF (${String(cause)})`);
  }

  // Encrypt/decrypt is out of scope (see CLAUDE.md): this tool can neither
  // supply nor remove a password, and copying still-encrypted streams into a
  // new document would emit a file that opens blank. An encrypted file is not
  // a damaged one, so say so rather than reporting a parse failure.
  if (doc.isEncrypted) {
    throw new PdfInputError(
      `${label}: this PDF is password-protected, and opening encrypted PDFs is not supported`,
    );
  }
  return doc;
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
 * Produces a new document without `pageIndices`, keeping the rest in order.
 *
 * Removing every page would leave a file no reader will open, so that is
 * refused rather than written.
 */
export async function removePages(bytes: Uint8Array, pageIndices: readonly number[]): Promise<Uint8Array> {
  const source = await load(bytes, 'document');
  const pageCount = source.getPageCount();
  assertPageIndices(pageIndices, pageCount, 'remove');

  const removed = new Set(pageIndices);
  const kept = Array.from({ length: pageCount }, (_unused, index) => index).filter(
    (index) => !removed.has(index),
  );

  if (kept.length === 0) {
    throw new PdfInputError('remove: a document must keep at least one page');
  }
  return extractPages(bytes, kept);
}

/**
 * The page order that results from dragging `moving` onto the page at `to`.
 *
 * Dragging downwards drops the block *after* the target, dragging upwards drops
 * it *before* — which is what a list reorder does everywhere else, and the only
 * reading under which dragging a page onto the one below it actually swaps them.
 *
 * Pure index arithmetic, kept here so the UI never hand-rolls a permutation and
 * risks handing `reorderPages` something that drops a page.
 */
export function orderWithPagesMoved(pageCount: number, moving: readonly number[], to: number): number[] {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new PdfInputError(`move: a document must have at least one page, got ${String(pageCount)}`);
  }
  if (!Number.isInteger(to) || to < 0 || to >= pageCount) {
    throw new PdfInputError(`move: target position ${String(to)} is out of range`);
  }
  for (const index of moving) {
    if (!Number.isInteger(index) || index < 0 || index >= pageCount) {
      throw new PdfInputError(`move: page ${String(index)} is out of range`);
    }
  }

  const moved = [...new Set(moving)].sort((a, b) => a - b);
  if (moved.length === 0) return Array.from({ length: pageCount }, (_unused, index) => index);

  const rest = Array.from({ length: pageCount }, (_unused, index) => index).filter(
    (index) => !moved.includes(index),
  );

  // Downwards: land after the target. Upwards: land before it.
  const goingDown = to > Math.max(...moved);
  const insertAt = rest.filter((index) => (goingDown ? index <= to : index < to)).length;

  return [...rest.slice(0, insertAt), ...moved, ...rest.slice(insertAt)];
}

/** Single-page form of {@link orderWithPagesMoved}. */
export function orderWithPageMoved(pageCount: number, from: number, to: number): number[] {
  return orderWithPagesMoved(pageCount, [from], to);
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
 * Turns a set of "start a new document here" pages into ranges for {@link splitPdf}.
 *
 * Page 0 is always a start, so selecting it changes nothing — that is treated as
 * redundant rather than an error, since ticking the first page is an easy thing
 * to do when you mean "split before every one of these".
 */
export function splitPointsToRanges(
  pageCount: number,
  splitAt: readonly number[],
): [start: number, end: number][] {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new PdfInputError(`split: a document must have at least one page, got ${String(pageCount)}`);
  }
  for (const point of splitAt) {
    if (!Number.isInteger(point) || point < 0 || point >= pageCount) {
      throw new PdfInputError(
        `split: page ${String(point)} is out of range for a ${String(pageCount)}-page document`,
      );
    }
  }

  const starts = [...new Set([0, ...splitAt])].sort((a, b) => a - b);
  return starts.map((start, index) => [start, starts[index + 1] ?? pageCount]);
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
