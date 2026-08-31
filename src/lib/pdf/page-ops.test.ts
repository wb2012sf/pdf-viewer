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
