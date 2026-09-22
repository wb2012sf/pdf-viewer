import { describe, expect, it } from 'vitest';
import { formatSize, reducedFileName, reductionSummary } from './reduce-size-presets';
import type { CompressionReport } from '../lib/pdf/compress';

/** A plausible report; the compression itself is covered in lib/pdf. */
function report(overrides: Partial<CompressionReport> = {}): CompressionReport {
  return {
    pdf: new Uint8Array(),
    originalSize: 4 * 1024 * 1024,
    newSize: 1024 * 1024,
    imagesFound: 3,
    imagesDownsampled: 3,
    changed: true,
    ...overrides,
  };
}

describe('formatSize', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [2048, '2 KB'],
    [4.2 * 1024 * 1024, '4.2 MB'],
    [418.3 * 1024 * 1024, '418 MB'],
  ])('writes %s bytes as %s', (bytes, expected) => {
    expect(formatSize(bytes)).toBe(expected);
  });
});

describe('reductionSummary', () => {
  it('reports what was saved', () => {
    expect(reductionSummary(report())).toBe('4.0 MB → 1.0 MB (75% smaller)');
  });

  it('says plainly when a document has no images to reduce', () => {
    expect(reductionSummary(report({ changed: false, imagesFound: 0, imagesDownsampled: 0 }))).toBe(
      'No images to reduce',
    );
  });

  it('says plainly when the images were already small enough', () => {
    const summary = reductionSummary(report({ changed: false, imagesDownsampled: 0 }));

    expect(summary).toContain('No further reduction');
    // The size it stayed at, so "nothing happened" is still an answer about a file.
    expect(summary).toContain('4.0 MB');
  });
});

describe('reducedFileName', () => {
  it('marks the result as a reduction rather than reusing the original name', () => {
    // A lossy copy offered back under the original's name invites saving over
    // the original, and the high-resolution images are not recoverable.
    expect(reducedFileName('report.pdf')).toBe('report-reduced.pdf');
  });

  it('keeps the extension it was given, whatever its case', () => {
    expect(reducedFileName('SCAN.PDF')).toBe('SCAN-reduced.PDF');
  });

  it('does not stack the suffix on a document already reduced once', () => {
    expect(reducedFileName('report-reduced.pdf')).toBe('report-reduced.pdf');
  });

  it('copes with a name that carries no extension', () => {
    expect(reducedFileName('report')).toBe('report-reduced');
  });

  it('leaves dots inside the name alone', () => {
    expect(reducedFileName('2026.08.invoice.pdf')).toBe('2026.08.invoice-reduced.pdf');
  });
})
