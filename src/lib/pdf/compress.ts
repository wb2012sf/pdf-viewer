import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, type PDFDocument } from 'pdf-lib';
import { PdfInputError, assertPdfBytes } from './errors';
import { loadPdf } from './page-ops';

/**
 * Reduces a PDF's size by downsampling the images inside it.
 *
 * This is the Preview "Reduce File Size" job: almost all of the megabytes in a
 * large PDF are photographs and scans stored at far more resolution than the
 * page they are printed on can show. Nothing else is touched — text stays text,
 * vectors stay vectors, and the page structure is the one that went in.
 *
 * The pixel work is injected rather than imported (see {@link ImageResampler}),
 * for the same reason OCR splits recognition out from the text layer: decoding
 * and re-encoding an image needs a browser, and everything that decides *which*
 * images to touch and *how far* is then testable without one.
 */

/** PDF user space is 72 units to the inch, by definition. */
const POINTS_PER_INCH = 72;

/** Resolution kept by default: legible in print, and half the size of 300. */
export const DEFAULT_TARGET_DPI = 150;

/** JPEG quality kept by default. Below ~0.6 the artefacts start to show. */
export const DEFAULT_JPEG_QUALITY = 0.7;

/** An image found in the document, handed to the resampler as a whole JPEG file. */
export interface EmbeddedImage {
  bytes: Uint8Array;
  mediaType: 'image/jpeg';
  width: number;
  height: number;
}

/** The size and quality an image should be re-encoded at. */
export interface ResampleTarget {
  width: number;
  height: number;
  /** 0–1, as the canvas means it. */
  quality: number;
}

/** A re-encoded image, or the dimensions it actually came back at. */
export interface ResampledImage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/**
 * Decodes, scales and re-encodes one image.
 *
 * Returning `null` means "leave this image alone" — the right answer for
 * anything the platform cannot decode, such as a CMYK JPEG — and must never be
 * an exception, which would abandon the images that come after it.
 */
export type ImageResampler = (image: EmbeddedImage, target: ResampleTarget) => Promise<ResampledImage | null>;

export interface CompressOptions {
  /** Resolution to reduce images to, in dots per inch. */
  targetDpi?: number;
  /** JPEG quality to re-encode at, 0–1. */
  quality?: number;
  /** Supplies the pixel work. `lib/pdf/image-resampler.ts` is the browser one. */
  resample: ImageResampler;
  /** Called as each image is dealt with. */
  onProgress?: (completed: number, total: number) => void;
}

export interface CompressionReport {
  /** The reduced document, or the original bytes when nothing was gained. */
  pdf: Uint8Array;
  originalSize: number;
  newSize: number;
  /** Image XObjects in the document, whether or not they could be reduced. */
  imagesFound: number;
  /** Images actually rewritten at a lower resolution. */
  imagesDownsampled: number;
  /** False when the original was handed straight back. */
  changed: boolean;
}

/**
 * Resolution an image is effectively printed at, given the longest edge of the
 * surface it is drawn on.
 */
export function estimateDpi(pixels: number, surfacePoints: number): number {
  if (!Number.isFinite(surfacePoints) || surfacePoints <= 0) {
    throw new PdfInputError(`reduce size: cannot judge an image drawn on a surface of ${String(surfacePoints)} pt`);
  }
  return pixels / (surfacePoints / POINTS_PER_INCH);
}

/**
 * Downsamples every image drawn at more than `targetDpi`, and hands back
 * whichever document is smaller — the reduced one or the original.
 *
 * Never returning a larger file is the point of the last step: re-encoding can
 * lose to the original on a document that was already optimised, and "Reduce
 * size" handing back something bigger is a bug the user would have to notice.
 */
export async function compressPdf(bytes: Uint8Array, options: CompressOptions): Promise<CompressionReport> {
  assertPdfBytes(bytes, 'document');

  const targetDpi = options.targetDpi ?? DEFAULT_TARGET_DPI;
  const quality = options.quality ?? DEFAULT_JPEG_QUALITY;

  if (!Number.isFinite(targetDpi) || targetDpi <= 0) {
    throw new PdfInputError(`reduce size: target resolution must be a positive number of DPI, got ${String(targetDpi)}`);
  }
  if (!Number.isFinite(quality) || quality <= 0 || quality > 1) {
    throw new PdfInputError(`reduce size: quality must be greater than 0 and at most 1, got ${String(quality)}`);
  }
  if (typeof options.resample !== 'function') {
    throw new PdfInputError('reduce size: an image resampler is required');
  }

  const doc = await loadPdf(bytes, 'document');
  const drawnOn = surfaceSizes(doc);
  const images = imageStreams(doc);
  const unchanged = (): CompressionReport => ({
    pdf: bytes,
    originalSize: bytes.byteLength,
    newSize: bytes.byteLength,
    imagesFound: images.length,
    imagesDownsampled: 0,
    changed: false,
  });

  if (images.length === 0) {
    options.onProgress?.(0, 0);
    return unchanged();
  }

  let downsampled = 0;
  for (const [position, { ref, stream }] of images.entries()) {
    const target = plannedSize(stream, drawnOn.get(ref.tag), targetDpi);
    if (target) {
      const resampled = await options.resample(
        {
          bytes: stream.contents,
          mediaType: 'image/jpeg',
          width: dictNumber(stream.dict, 'Width') ?? 0,
          height: dictNumber(stream.dict, 'Height') ?? 0,
        },
        { ...target, quality },
      );

      // A re-encode that did not pay for itself is dropped rather than kept:
      // fewer pixels is not the goal, fewer bytes is.
      if (resampled && resampled.bytes.byteLength < stream.contents.byteLength) {
        replaceImage(doc, ref, stream, resampled);
        downsampled += 1;
      }
    }
    options.onProgress?.(position + 1, images.length);
  }

  if (downsampled === 0) return unchanged();

  const reduced = await doc.save();
  if (reduced.byteLength >= bytes.byteLength) return unchanged();

  return {
    pdf: reduced,
    originalSize: bytes.byteLength,
    newSize: reduced.byteLength,
    imagesFound: images.length,
    imagesDownsampled: downsampled,
    changed: true,
  };
}

interface FoundImage {
  ref: PDFRef;
  stream: PDFRawStream;
}

/** Every image XObject in the document, in the order it was written. */
function imageStreams(doc: PDFDocument): FoundImage[] {
  const found: FoundImage[] = [];
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream && isImage(object)) {
      found.push({ ref, stream: object });
    }
  }
  return found;
}

function isImage(stream: PDFRawStream): boolean {
  return String(stream.dict.get(PDFName.of('Subtype'))) === '/Image';
}

/**
 * The size to re-encode an image at, or `null` to leave it alone.
 *
 * Every reason to decline is a reason the rewrite would change what the page
 * looks like, so they are all answered the same way: don't touch it.
 */
function plannedSize(
  stream: PDFRawStream,
  surfacePoints: number | undefined,
  targetDpi: number,
): { width: number; height: number } | null {
  // Never drawn, so there is no size to judge its resolution against. An
  // orphaned image costs bytes, but guessing at one is how a rewrite ruins a
  // page nobody was looking at.
  if (surfacePoints === undefined || surfacePoints <= 0) return null;

  // JPEG only. The stream bytes of a DCTDecode image *are* a JPEG file, so the
  // platform decodes it directly and the result goes back under the same
  // filter. Every other encoding (Flate bitmaps, CCITT and JBIG2 scans, JPEG
  // 2000) would have to be unpacked and re-packed by hand, and those are
  // rarely where a large PDF's megabytes actually are.
  if (filterName(stream.dict) !== '/DCTDecode') return null;

  // A /Decode array remaps or inverts the samples, and a stencil mask is
  // bilevel; a canvas round trip silently drops both.
  if (stream.dict.has(PDFName.of('Decode')) || stream.dict.has(PDFName.of('ImageMask'))) return null;

  const width = dictNumber(stream.dict, 'Width');
  const height = dictNumber(stream.dict, 'Height');
  if (width === undefined || height === undefined || width < 1 || height < 1) return null;

  const dpi = estimateDpi(Math.max(width, height), surfacePoints);
  if (dpi <= targetDpi) return null;

  const scale = targetDpi / dpi;
  const planned = { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  // Rounding can hand back the size it started at on a tiny image.
  if (planned.width >= width && planned.height >= height) return null;
  return planned;
}

/** The single filter on a stream, or '' for a chain this code will not touch. */
function filterName(dict: PDFDict): string {
  const filter = dict.get(PDFName.of('Filter'));
  if (filter instanceof PDFArray) {
    return filter.size() === 1 ? String(filter.get(0)) : '';
  }
  return String(filter);
}

function dictNumber(dict: PDFDict, key: string): number | undefined {
  const value = dict.lookupMaybe(PDFName.of(key), PDFNumber);
  return value?.asNumber();
}

/** Swaps an image's bytes for the re-encoded ones, keeping its reference. */
function replaceImage(doc: PDFDocument, ref: PDFRef, stream: PDFRawStream, resampled: ResampledImage): void {
  const { dict } = stream;
  dict.set(PDFName.of('Width'), PDFNumber.of(resampled.width));
  dict.set(PDFName.of('Height'), PDFNumber.of(resampled.height));
  // pdf-lib writes /Length straight from the dictionary, so a stale one leaves
  // a file no reader can parse past.
  dict.set(PDFName.of('Length'), PDFNumber.of(resampled.bytes.byteLength));
  // Whatever went in, a canvas hands back 8-bit RGB.
  dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
  dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
  dict.delete(PDFName.of('DecodeParms'));

  doc.context.assign(ref, PDFRawStream.of(dict, resampled.bytes));
}

/**
 * The longest edge, in points, of the largest surface each image is drawn on.
 *
 * Images are measured against the whole page rather than the box they are
 * actually placed in, which would mean interpreting every content stream's
 * transformation matrices. The error only ever runs one way: an image filling
 * a quarter of the page reads as a *lower* resolution than it really is, so it
 * is downsampled too little rather than too much. Under-reducing a file is a
 * disappointment; over-reducing one is damage.
 */
function surfaceSizes(doc: PDFDocument): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const page of doc.getPages()) {
    const longestEdge = Math.max(page.getWidth(), page.getHeight());
    collectImages(doc, page.node.Resources(), longestEdge, sizes, new Set());
  }
  return sizes;
}

function collectImages(
  doc: PDFDocument,
  resources: PDFDict | undefined,
  surfacePoints: number,
  into: Map<string, number>,
  visitedForms: Set<string>,
): void {
  const xobjects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
  if (!xobjects) return;

  for (const [, value] of xobjects.entries()) {
    // Streams are always indirect, so anything else here cannot be rewritten.
    if (!(value instanceof PDFRef)) continue;

    const target = doc.context.lookup(value);
    if (!(target instanceof PDFRawStream)) continue;

    const subtype = String(target.dict.get(PDFName.of('Subtype')));
    if (subtype === '/Image') {
      // The largest surface wins: it gives the lowest resolution estimate, and
      // so the most cautious reduction for an image reused across pages.
      into.set(value.tag, Math.max(into.get(value.tag) ?? 0, surfacePoints));
    } else if (subtype === '/Form' && !visitedForms.has(value.tag)) {
      // A form XObject can draw images of its own, and can reach itself again
      // through a malformed file.
      visitedForms.add(value.tag);
      collectImages(
        doc,
        target.dict.lookupMaybe(PDFName.of('Resources'), PDFDict),
        surfacePoints,
        into,
        visitedForms,
      );
    }
  }
}
