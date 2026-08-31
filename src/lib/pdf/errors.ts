/**
 * Errors thrown at module boundaries when untrusted input (an uploaded or
 * dropped file, a page range typed by the user) fails validation.
 *
 * These are deliberately loud: CLAUDE.md requires failing with a clear error
 * rather than continuing on bad data.
 */
export class PdfInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfInputError';
  }
}

/** Asserts that `bytes` plausibly holds a PDF before pdf-lib is handed it. */
export function assertPdfBytes(bytes: Uint8Array, label = 'document'): void {
  if (!(bytes instanceof Uint8Array)) {
    throw new PdfInputError(`${label}: expected a Uint8Array of PDF bytes`);
  }
  if (bytes.byteLength === 0) {
    throw new PdfInputError(`${label}: file is empty`);
  }
  // Every PDF starts with the %PDF- header. Checking it here turns "some
  // opaque pdf-lib parse failure" into a message a user can act on.
  const header = String.fromCharCode(...bytes.subarray(0, 5));
  if (header !== '%PDF-') {
    throw new PdfInputError(`${label}: not a PDF file (missing %PDF- header)`);
  }
}

/**
 * Asserts that every entry of `indices` is a valid zero-based page index for a
 * document of `pageCount` pages.
 */
export function assertPageIndices(indices: readonly number[], pageCount: number, label = 'pages'): void {
  if (indices.length === 0) {
    throw new PdfInputError(`${label}: no pages selected`);
  }
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index >= pageCount) {
      throw new PdfInputError(
        `${label}: page index ${String(index)} is out of range for a ${String(pageCount)}-page document`,
      );
    }
  }
}
