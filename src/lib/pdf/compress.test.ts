import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  DEFAULT_JPEG_QUALITY,
  DEFAULT_TARGET_DPI,
  compressPdf,
  estimateDpi,
  type ImageResampler,
} from './compress';
import { PdfInputError } from './errors';
import { imageStreams, makeEncryptedPdf, makeImagePdf, makePdf } from '../../test/fixtures';

/** US Letter: 11 inches on the long edge, so pixel counts map to round DPIs. */
const LETTER: [number, number] = [612, 792];

/**
 * Stands in for the browser's canvas: re-encodes to a byte count proportional
 * to the pixels kept, which is how a real JPEG behaves closely enough for the
 * accounting under test.
 */
function shrinkingResampler(): Mock<ImageResampler> {
  return vi.fn<ImageResampler>((image, target) =>
    Promise.resolve({
      bytes: new Uint8Array(
        Math.max(
          1,
          Math.round((image.bytes.byteLength * (target.width * target.height)) / (image.width * image.height)),
        ),
      ),
      width: target.width,
      height: target.height,
    }),
  );
}

describe('estimateDpi', () => {
  it('reads a page-filling image as its pixels over the page in inches', () => {
    // 3168 px across 792 pt (11 in) is 288 dpi.
    expect(estimateDpi(3168, 792)).toBeCloseTo(288, 5);
  });

  it('refuses a surface with no size, which no resolution can be read from', () => {
    expect(() => estimateDpi(100, 0)).toThrow(PdfInputError);
  });
});

describe('compressPdf', () => {
  it('downsamples a page-filling image to the target resolution', async () => {
    // 3168 px on an 11 in page is 288 dpi; at 150 dpi it keeps 150/288 of each edge.
    const pdf = await makeImagePdf([{ width: 2448, height: 3168, byteLength: 40_000 }], { pageSize: LETTER });

    const report = await compressPdf(pdf, { targetDpi: 150, resample: shrinkingResampler() });

    expect(report.changed).toBe(true);
    expect(report.imagesDownsampled).toBe(1);

    const [image] = await imageStreams(report.pdf);
    expect(image).toBeDefined();
    expect(image?.width).toBe(Math.round(2448 * (150 / 288)));
    expect(image?.height).toBe(Math.round(3168 * (150 / 288)));
    // The dictionary must agree with the bytes, or no reader will parse past it.
    expect(image?.declaredLength).toBe(image?.byteLength);
    expect(image?.byteLength).toBeLessThan(40_000);
    expect(image?.filter).toBe('/DCTDecode');
  });

  it('reports the sizes of the document before and after', async () => {
    const pdf = await makeImagePdf([{ width: 2448, height: 3168, byteLength: 120_000 }], { pageSize: LETTER });

    const report = await compressPdf(pdf, { targetDpi: 150, resample: shrinkingResampler() });

    expect(report.originalSize).toBe(pdf.byteLength);
    expect(report.newSize).toBe(report.pdf.byteLength);
    expect(report.newSize).toBeLessThan(report.originalSize);
  });

  it('leaves an image already below the target resolution untouched', async () => {
    // 800 px on an 11 in page is ~73 dpi — already under 150.
    const pdf = await makeImagePdf([{ width: 600, height: 800, byteLength: 40_000 }], { pageSize: LETTER });

    const report = await compressPdf(pdf, { targetDpi: 150, resample: shrinkingResampler() });

    expect(report.changed).toBe(false);
    expect(report.imagesDownsampled).toBe(0);
    expect(report.imagesFound).toBe(1);
    // Unchanged means the original bytes, not a re-saved copy of them.
    expect(report.pdf).toBe(pdf);
  });

  it('counts but never rewrites an image in a filter it cannot re-encode', async () => {
    const pdf = await makeImagePdf([{ width: 2448, height: 3168, byteLength: 40_000, filter: 'FlateDecode' }], {
      pageSize: LETTER,
    });
    const resample = shrinkingResampler();

    const report = await compressPdf(pdf, { targetDpi: 150, resample });

    expect(report.imagesFound).toBe(1);
    expect(report.imagesDownsampled).toBe(0);
    expect(resample).not.toHaveBeenCalled();
  });

  it('leaves an image whose samples are remapped by a /Decode array', async () => {
    const pdf = await makeImagePdf(
      [{ width: 2448, height: 3168, byteLength: 40_000, extra: { Decode: [1, 0, 1, 0, 1, 0] } }],
      { pageSize: LETTER },
    );
    const resample = shrinkingResampler();

    await compressPdf(pdf, { targetDpi: 150, resample });

    expect(resample).not.toHaveBeenCalled();
  });

  it('leaves an image the resampler cannot decode', async () => {
    const pdf = await makeImagePdf([{ width: 2448, height: 3168, byteLength: 40_000 }], { pageSize: LETTER });

    const report = await compressPdf(pdf, { targetDpi: 150, resample: () => Promise.resolve(null) });

    expect(report.changed).toBe(false);
    expect(report.pdf).toBe(pdf);
  });

  it('hands back the original document rather than a larger one', async () => {
    const pdf = await makeImagePdf([{ width: 2448, height: 3168, byteLength: 40_000 }], { pageSize: LETTER });

    // A resampler that "shrinks" the pixels but inflates the bytes.
    const report = await compressPdf(pdf, {
      targetDpi: 150,
      resample: (_image, target) => Promise.resolve({ bytes: new Uint8Array(400_000), ...target }),
    });

    expect(report.changed).toBe(false);
    expect(report.pdf).toBe(pdf);
    expect(report.newSize).toBe(report.originalSize);
    expect(report.imagesDownsampled).toBe(0);
  });

  it('finds an image drawn through a form XObject', async () => {
    const pdf = await makeImagePdf([{ width: 2448, height: 3168, byteLength: 40_000, viaForm: true }], {
      pageSize: LETTER,
    });

    const report = await compressPdf(pdf, { targetDpi: 150, resample: shrinkingResampler() });

    expect(report.imagesDownsampled).toBe(1);
  });

  it('ignores an image that no page draws, having no size to judge it by', async () => {
    const pdf = await makeImagePdf([{ width: 4000, height: 4000, byteLength: 40_000, unplaced: true }], {
      pageSize: LETTER,
    });
    const resample = shrinkingResampler();

    const report = await compressPdf(pdf, { targetDpi: 150, resample });

    expect(report.imagesFound).toBe(1);
    expect(resample).not.toHaveBeenCalled();
  });

  it('judges each image against the page it is drawn on', async () => {
    const pdf = await makeImagePdf(
      [
        { width: 2448, height: 3168, byteLength: 40_000 },
        { width: 300, height: 400, byteLength: 4_000 },
      ],
      { pageSize: LETTER },
    );

    const report = await compressPdf(pdf, { targetDpi: 150, resample: shrinkingResampler() });

    expect(report.imagesFound).toBe(2);
    expect(report.imagesDownsampled).toBe(1);

    const [big, small] = await imageStreams(report.pdf);
    expect(big?.width).toBe(Math.round(2448 * (150 / 288)));
    expect(small?.width).toBe(300);
    expect(small?.byteLength).toBe(4_000);
  });

  it('passes the requested quality through to the resampler', async () => {
    const pdf = await makeImagePdf([{ width: 2448, height: 3168, byteLength: 40_000 }], { pageSize: LETTER });
    const resample = shrinkingResampler();

    await compressPdf(pdf, { targetDpi: 150, quality: 0.42, resample });

    expect(resample).toHaveBeenCalledWith(
      expect.objectContaining({ mediaType: 'image/jpeg', width: 2448, height: 3168 }),
      expect.objectContaining({ quality: 0.42 }),
    );
  });

  it('defaults to a print-legible resolution and quality', async () => {
    const pdf = await makeImagePdf([{ width: 2448, height: 3168, byteLength: 40_000 }], { pageSize: LETTER });
    const resample = shrinkingResampler();

    await compressPdf(pdf, { resample });

    expect(DEFAULT_TARGET_DPI).toBe(150);
    expect(resample).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ quality: DEFAULT_JPEG_QUALITY }),
    );
  });

  it('reports progress over the images it considers', async () => {
    const pdf = await makeImagePdf(
      [
        { width: 2448, height: 3168, byteLength: 40_000 },
        { width: 2448, height: 3168, byteLength: 40_000 },
      ],
      { pageSize: LETTER },
    );
    const seen: [number, number][] = [];

    await compressPdf(pdf, {
      targetDpi: 150,
      resample: shrinkingResampler(),
      onProgress: (completed, total) => seen.push([completed, total]),
    });

    expect(seen.at(-1)).toEqual([2, 2]);
  });

  it('reports a document with no images at all as unchanged', async () => {
    const pdf = await makePdf(2);

    const report = await compressPdf(pdf, { resample: shrinkingResampler() });

    expect(report.imagesFound).toBe(0);
    expect(report.changed).toBe(false);
    expect(report.pdf).toBe(pdf);
  });

  it('refuses a password-protected document rather than emitting a broken copy', async () => {
    const pdf = await makeEncryptedPdf();

    await expect(compressPdf(pdf, { resample: shrinkingResampler() })).rejects.toThrow(/password-protected/);
  });

  it('refuses bytes that are not a PDF', async () => {
    await expect(compressPdf(new Uint8Array([1, 2, 3]), { resample: shrinkingResampler() })).rejects.toThrow(
      PdfInputError,
    );
  });

  it.each([0, -150, Number.NaN, Number.POSITIVE_INFINITY])('refuses a target resolution of %s', async (dpi) => {
    const pdf = await makePdf(1);
    await expect(compressPdf(pdf, { targetDpi: dpi, resample: shrinkingResampler() })).rejects.toThrow(
      PdfInputError,
    );
  });

  it.each([0, 1.5, -0.2, Number.NaN])('refuses a quality of %s', async (quality) => {
    const pdf = await makePdf(1);
    await expect(compressPdf(pdf, { quality, resample: shrinkingResampler() })).rejects.toThrow(PdfInputError);
  });
});
