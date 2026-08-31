// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PdfEngine } from '@embedpdf/models';
import { useOcr } from './useOcr';

const makeSearchable = vi.hoisted(() => vi.fn());
vi.mock('../lib/ocr', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/ocr')>()),
  makeSearchable,
}));

afterEach(() => {
  cleanup();
  makeSearchable.mockReset();
});

// The hook never inspects the engine; it only passes it along.
const ENGINE = {} as PdfEngine;

describe('useOcr', () => {
  it('reports a failure to read the document as an OCR error', async () => {
    // Reading the current document out of the viewer can fail — most plainly
    // when the export component is missing. That has to land in the UI rather
    // than escape as an unhandled rejection.
    const { result } = renderHook(() => useOcr());

    await act(async () => {
      await result.current.run(ENGINE, () => Promise.reject(new Error('export component is unavailable')));
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('export component is unavailable');
  });

  it('never starts OCR when the document cannot be read', async () => {
    const { result } = renderHook(() => useOcr());

    await act(async () => {
      await result.current.run(ENGINE, () => Promise.reject(new Error('nope')));
    });

    expect(makeSearchable).not.toHaveBeenCalled();
  });

  it('resolves to null on failure, so the caller does not swap in a bad document', async () => {
    const { result } = renderHook(() => useOcr());

    let returned: Uint8Array | null = new Uint8Array();
    await act(async () => {
      returned = await result.current.run(ENGINE, () => Promise.reject(new Error('nope')));
    });

    expect(returned).toBeNull();
  });

  it('passes the bytes it read on to the OCR pipeline', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    makeSearchable.mockResolvedValue({ pdf: bytes, wordsAdded: 3, wordsSkipped: 0, pagesProcessed: 1 });

    const { result } = renderHook(() => useOcr());
    await act(async () => {
      await result.current.run(ENGINE, () => Promise.resolve(bytes));
    });

    expect(makeSearchable).toHaveBeenCalledWith(ENGINE, bytes, expect.anything());
    expect(result.current.status).toBe('done');
    expect(result.current.wordsAdded).toBe(3);
  });

  it('surfaces a failure from the pipeline itself', async () => {
    makeSearchable.mockRejectedValue(new Error('worker died'));

    const { result } = renderHook(() => useOcr());
    await act(async () => {
      await result.current.run(ENGINE, () => Promise.resolve(new Uint8Array([1])));
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('worker died');
  });

  it('clears an error when reset', async () => {
    const { result } = renderHook(() => useOcr());
    await act(async () => {
      await result.current.run(ENGINE, () => Promise.reject(new Error('nope')));
    });

    act(() => {
      result.current.reset();
    });

    await waitFor(() => {
      expect(result.current.status).toBe('idle');
      expect(result.current.error).toBeNull();
    });
  });
});
