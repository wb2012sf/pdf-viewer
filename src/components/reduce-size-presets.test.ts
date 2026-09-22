import { describe, expect, it } from 'vitest';
import { reductionSummary } from './reduce-size-presets';
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

describe('reductionSummary', () => {
  it('reports where the document started, which is what the size beside it cannot', () => {
    expect(reductionSummary(report())).toBe('was 4.0 MB (75% smaller)');
  });

  it('says plainly when a document has no images to reduce', () => {
    expect(reductionSummary(report({ changed: false, imagesFound: 0, imagesDownsampled: 0 }))).toBe(
      'No images to reduce',
    );
  });

  it('says plainly when the images were already small enough', () => {
    // The size it stayed at is already on screen beside the filename.
    expect(reductionSummary(report({ changed: false, imagesDownsampled: 0 }))).toBe(
      'No further reduction at this resolution',
    );
  });
});
