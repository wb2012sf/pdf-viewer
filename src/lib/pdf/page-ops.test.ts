import { describe, expect, it } from 'vitest';
import {
  extractPages,
  getPageCount,
  getPageRotations,
  mergePdfs,
  orderWithPageMoved,
  removePages,
  reorderPages,
  rotatePages,
  splitPointsToRanges,
  splitPdf,
} from './page-ops';
import { PdfInputError } from './errors';
import { makeEncryptedPdf, makePdf, pageOrder } from '../../test/fixtures';

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

describe('splitPointsToRanges', () => {
  it('starts a new part at each chosen page', () => {
    expect(splitPointsToRanges(6, [2, 4])).toEqual([
      [0, 2],
      [2, 4],
      [4, 6],
    ]);
  });

  it('treats the first page as redundant rather than an error', () => {
    // Ticking page 1 when you mean "split before each of these" is easy to do.
    expect(splitPointsToRanges(4, [0, 2])).toEqual([
      [0, 2],
      [2, 4],
    ]);
  });

  it('ignores a page chosen twice', () => {
    expect(splitPointsToRanges(4, [2, 2])).toEqual([
      [0, 2],
      [2, 4],
    ]);
  });

  it('sorts points given out of order', () => {
    expect(splitPointsToRanges(6, [4, 2])).toEqual([
      [0, 2],
      [2, 4],
      [4, 6],
    ]);
  });

  it('returns the whole document when nothing is chosen', () => {
    expect(splitPointsToRanges(3, [])).toEqual([[0, 3]]);
  });

  it('covers every page exactly once, whatever is chosen', () => {
    for (const points of [[1], [1, 2], [0, 3, 4], [2, 4, 5]]) {
      const covered = splitPointsToRanges(6, points).flatMap(([start, end]) =>
        Array.from({ length: end - start }, (_unused, offset) => start + offset),
      );
      expect(covered).toEqual([0, 1, 2, 3, 4, 5]);
    }
  });

  it('produces ranges splitPdf accepts', async () => {
    const parts = await splitPdf(await makePdf(5), splitPointsToRanges(5, [2]));

    expect(parts).toHaveLength(2);
    expect(await pageOrder(parts[0]!)).toEqual([0, 1]);
    expect(await pageOrder(parts[1]!)).toEqual([2, 3, 4]);
  });

  it('rejects a split point the document does not have', () => {
    expect(() => splitPointsToRanges(3, [7])).toThrow(/out of range/);
  });
});

describe('encrypted documents', () => {
  // Encrypt/decrypt is out of scope (see CLAUDE.md), so the contract is that
  // every entry point refuses an encrypted file outright. Silently loading one
  // would mean writing out a document whose encrypted streams were copied as
  // opaque bytes -- a file that opens as blank or garbled pages.

  it('refuses to read an encrypted document', async () => {
    await expect(getPageCount(await makeEncryptedPdf())).rejects.toBeInstanceOf(PdfInputError);
  });

  it('says the file is password-protected rather than unparseable', async () => {
    await expect(getPageCount(await makeEncryptedPdf())).rejects.toThrow(/password-protected/);
  });

  it('does not blame corruption for an encrypted file', async () => {
    // The generic parse-failure wording would send the user hunting for damage
    // that isn't there.
    await expect(getPageCount(await makeEncryptedPdf())).rejects.not.toThrow(/could not be parsed/);
  });

  it('refuses an encrypted document in every page operation', async () => {
    const encrypted = await makeEncryptedPdf(3);

    await expect(extractPages(encrypted, [0])).rejects.toThrow(/password-protected/);
    await expect(reorderPages(encrypted, [0, 1, 2])).rejects.toThrow(/password-protected/);
    await expect(splitPdf(encrypted, [[0, 1]])).rejects.toThrow(/password-protected/);
    await expect(rotatePages(encrypted, [0], 90)).rejects.toThrow(/password-protected/);
    await expect(getPageRotations(encrypted)).rejects.toThrow(/password-protected/);
  });

  it('names which merge input is encrypted', async () => {
    await expect(mergePdfs([await makePdf(1), await makeEncryptedPdf()])).rejects.toThrow(
      /merge input 2: this PDF is password-protected/,
    );
  });

  it('leaves unencrypted documents unaffected', async () => {
    // Guards against a refusal so broad it starts rejecting ordinary files.
    expect(await getPageCount(await makePdf(2))).toBe(2);
  });
});

describe('removePages', () => {
  it('drops the named pages and keeps the rest in order', async () => {
    expect(await pageOrder(await removePages(await makePdf(5), [1, 3]))).toEqual([0, 2, 4]);
  });

  it('tolerates the same page being named twice', async () => {
    expect(await pageOrder(await removePages(await makePdf(3), [1, 1]))).toEqual([0, 2]);
  });

  it('refuses to empty the document', async () => {
    // A zero-page PDF is a file no reader will open.
    await expect(removePages(await makePdf(2), [0, 1])).rejects.toThrow(/at least one page/);
  });

  it('rejects a page it does not have', async () => {
    await expect(removePages(await makePdf(2), [9])).rejects.toThrow(/out of range/);
  });
});

describe('orderWithPageMoved', () => {
  it('moves a page later, sliding the others up', () => {
    expect(orderWithPageMoved(5, 1, 3)).toEqual([0, 2, 3, 1, 4]);
  });

  it('moves a page earlier', () => {
    expect(orderWithPageMoved(5, 3, 1)).toEqual([0, 3, 1, 2, 4]);
  });

  it('leaves the order alone when a page is moved onto itself', () => {
    expect(orderWithPageMoved(4, 2, 2)).toEqual([0, 1, 2, 3]);
  });

  it('always returns a full permutation', () => {
    // This feeds `reorderPages`, which rejects anything that would drop a page —
    // so the arithmetic here must never produce one.
    for (let from = 0; from < 6; from += 1) {
      for (let to = 0; to < 6; to += 1) {
        expect([...orderWithPageMoved(6, from, to)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
      }
    }
  });

  it('rejects an out-of-range move', () => {
    expect(() => orderWithPageMoved(3, 5, 0)).toThrow(/out of range/);
    expect(() => orderWithPageMoved(3, 0, 7)).toThrow(/out of range/);
  });

  it('produces an order reorderPages accepts', async () => {
    const moved = await reorderPages(await makePdf(4), orderWithPageMoved(4, 0, 3));

    expect(await pageOrder(moved)).toEqual([1, 2, 3, 0]);
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
