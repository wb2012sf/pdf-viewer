import { describe, expect, it } from 'vitest';
import {
  extractPages,
  getPageCount,
  getPageRotations,
  mergePdfs,
  reorderPages,
  rotatePages,
  splitPdf,
} from './page-ops';
import { PdfInputError } from './errors';
import { makePdf, pageOrder } from '../../test/fixtures';

describe('getPageCount', () => {
  it('reads the page count of a real PDF', async () => {
    expect(await getPageCount(await makePdf(4))).toBe(4);
  });

  it('rejects bytes that are not a PDF', async () => {
    await expect(getPageCount(new TextEncoder().encode('not a pdf'))).rejects.toBeInstanceOf(PdfInputError);
  });

  it('rejects an empty file', async () => {
    await expect(getPageCount(new Uint8Array())).rejects.toThrow(/empty/);
  });
});

describe('mergePdfs', () => {
  it('concatenates documents in order, keeping every page', async () => {
    const merged = await mergePdfs([await makePdf(2), await makePdf(3)]);

    expect(await getPageCount(merged)).toBe(5);
    // Pages 0,1 from the first document then 0,1,2 from the second.
    expect(await pageOrder(merged)).toEqual([0, 1, 0, 1, 2]);
  });

  it('rejects an empty input list', async () => {
    await expect(mergePdfs([])).rejects.toThrow(/at least one document/);
  });

  it('names the offending input when one of several is invalid', async () => {
    await expect(mergePdfs([await makePdf(1), new Uint8Array([1, 2, 3])])).rejects.toThrow(/merge input 2/);
  });
});

describe('extractPages', () => {
  it('keeps only the requested pages, in the requested order', async () => {
    const extracted = await extractPages(await makePdf(5), [3, 1]);

    expect(await getPageCount(extracted)).toBe(2);
    expect(await pageOrder(extracted)).toEqual([3, 1]);
  });

  it('duplicates a page when its index is repeated', async () => {
    expect(await pageOrder(await extractPages(await makePdf(3), [2, 2]))).toEqual([2, 2]);
  });

  it('rejects an out-of-range page index', async () => {
    await expect(extractPages(await makePdf(2), [5])).rejects.toThrow(/out of range/);
  });

  it('rejects an empty selection', async () => {
    await expect(extractPages(await makePdf(2), [])).rejects.toThrow(/no pages selected/);
  });
});

describe('reorderPages', () => {
  it('applies a full permutation', async () => {
    expect(await pageOrder(await reorderPages(await makePdf(3), [2, 0, 1]))).toEqual([2, 0, 1]);
  });

  it('rejects an order that would drop a page', async () => {
    await expect(reorderPages(await makePdf(3), [0, 1])).rejects.toThrow(/permutation/);
  });

  it('rejects an order that repeats a page', async () => {
    await expect(reorderPages(await makePdf(3), [0, 1, 1])).rejects.toThrow(/permutation/);
  });
});

describe('splitPdf', () => {
  it('slices a document into the requested half-open ranges', async () => {
    const parts = await splitPdf(await makePdf(5), [
      [0, 2],
      [2, 5],
    ]);

    expect(parts).toHaveLength(2);
    expect(await pageOrder(parts[0]!)).toEqual([0, 1]);
    expect(await pageOrder(parts[1]!)).toEqual([2, 3, 4]);
  });

  it('rejects a range that runs past the end of the document', async () => {
    await expect(splitPdf(await makePdf(2), [[0, 3]])).rejects.toThrow(/not a valid slice/);
  });

  it('rejects an inverted range', async () => {
    await expect(splitPdf(await makePdf(3), [[2, 1]])).rejects.toThrow(/not a valid slice/);
  });
});

describe('rotatePages', () => {
  it('rotates only the selected pages', async () => {
    const rotated = await rotatePages(await makePdf(3), [1], 90);

    expect(await getPageRotations(rotated)).toEqual([0, 90, 0]);
  });

  it('adds to the rotation a page already carries and wraps at 360', async () => {
    const rotated = await rotatePages(await makePdf(1, { rotation: 270 }), [0], 180);

    expect(await getPageRotations(rotated)).toEqual([90]);
  });

  it('leaves the page count untouched', async () => {
    expect(await getPageCount(await rotatePages(await makePdf(4), [0, 3], 180))).toBe(4);
  });
});
