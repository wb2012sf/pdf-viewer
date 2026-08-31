import type { PdfEngine } from '@embedpdf/models';
import { PdfInputError } from './errors';

/** A rendered page preview, small enough to hold one per page of a long document. */
export interface Thumbnail {
  pageIndex: number;
  /** Object URL for the rendered image; revoke it when the thumbnail is dropped. */
  url: string;
  width: number;
  height: number;
}

/**
 * Scale to render previews at, relative to the page's natural size.
 *
 * Small enough that a hundred-page document costs little, large enough that a
 * page is recognisable at a glance — which is the whole point of a thumbnail.
 */
export const THUMBNAIL_SCALE = 0.4;

export interface ThumbnailOptions {
  scale?: number;
  /** Abandons the run; already-rendered URLs are revoked by the caller. */
  signal?: AbortSignal;
}

/**
 * Renders every page of `pdfBytes` to a preview image.
 *
 * Annotations are drawn: a thumbnail that omits the stamp you just placed is
 * worse than no thumbnail, because it looks like the stamp did not land.
 *
 * The caller owns the returned object URLs and must revoke them.
 */
export async function renderThumbnails(
  engine: PdfEngine,
  pdfBytes: Uint8Array,
  options: ThumbnailOptions = {},
): Promise<Thumbnail[]> {
  const scale = options.scale ?? THUMBNAIL_SCALE;
  if (!(scale > 0) || !Number.isFinite(scale)) {
    throw new PdfInputError(`thumbnails: scale must be a positive number, got ${String(scale)}`);
  }

  const buffer = pdfBytes.slice().buffer;
  const doc = await engine
    .openDocumentBuffer({ id: `thumbs-${String(Date.now())}`, content: buffer })
    .toPromise();

  const rendered: Thumbnail[] = [];
  try {
    for (const page of doc.pages) {
      if (options.signal?.aborted === true) break;

      const blob = await engine
        .renderPage(doc, page, { scaleFactor: scale, dpr: 1, withAnnotations: true })
        .toPromise();

      const bitmap = await createImageBitmap(blob);
      const { width, height } = bitmap;
      bitmap.close();

      rendered.push({ pageIndex: page.index, url: URL.createObjectURL(blob), width, height });
    }
    return rendered;
  } finally {
    // A PDFium document is native memory; a preview run must not leak one.
    await engine.closeDocument(doc).toPromise();
  }
}

/** Releases the memory a set of thumbnails is holding. */
export function revokeThumbnails(thumbnails: readonly Thumbnail[]): void {
  for (const thumbnail of thumbnails) {
    URL.revokeObjectURL(thumbnail.url);
  }
}
