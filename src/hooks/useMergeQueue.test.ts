// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { PDFDocument } from 'pdf-lib';
import { useMergeQueue } from './useMergeQueue';

async function pdfFile(name: string, pages: number): Promise<File> {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) doc.addPage([200, 200]);
  return new File([(await doc.save()).slice().buffer], name, { type: 'application/pdf' });
}

describe('useMergeQueue', () => {
  it('reads each file’s page count as it is added', async () => {
    // So the dialog can say how large the result will be before writing it.
    const { result } = renderHook(() => useMergeQueue());

    await act(async () => {
      result.current.open();
      await result.current.addFiles([await pdfFile('a.pdf', 3)]);
    });

    expect(result.current.items[0]?.pages).toBe(3);
  });

  it('names a file that is not a readable PDF as it is added', async () => {
    // Rather than taking the whole batch down at merge time.
    const { result } = renderHook(() => useMergeQueue());

    await act(async () => {
      result.current.open();
      await result.current.addFiles([new File(['nonsense'], 'broken.pdf', { type: 'application/pdf' })]);
    });

    expect(result.current.error).not.toBeNull();
    expect(result.current.items).toHaveLength(0);
  });

  it('seeds the queue with the open document, marked as such', () => {
    const { result } = renderHook(() => useMergeQueue());

    act(() => {
      result.current.open({ name: 'current.pdf', bytes: new Uint8Array([1]) });
    });

    expect(result.current.items[0]?.isOpenDocument).toBe(true);
  });

  it('moves a document one place with the arrows', async () => {
    const { result } = renderHook(() => useMergeQueue());
    await act(async () => {
      result.current.open();
      await result.current.addFiles([await pdfFile('a.pdf', 1), await pdfFile('b.pdf', 1)]);
    });

    act(() => {
      result.current.move(result.current.items[1]!.id, -1);
    });

    expect(result.current.items.map((item) => item.name)).toEqual(['b.pdf', 'a.pdf']);
  });

  it('drops a dragged document at the position it was released on', async () => {
    const { result } = renderHook(() => useMergeQueue());
    await act(async () => {
      result.current.open();
      await result.current.addFiles([
        await pdfFile('a.pdf', 1),
        await pdfFile('b.pdf', 1),
        await pdfFile('c.pdf', 1),
      ]);
    });

    act(() => {
      result.current.reorder(0, 2);
    });

    expect(result.current.items.map((item) => item.name)).toEqual(['b.pdf', 'c.pdf', 'a.pdf']);
  });

  it('ignores a drop outside the list', async () => {
    const { result } = renderHook(() => useMergeQueue());
    await act(async () => {
      result.current.open();
      await result.current.addFiles([await pdfFile('a.pdf', 1), await pdfFile('b.pdf', 1)]);
    });

    act(() => {
      result.current.reorder(0, 9);
    });

    expect(result.current.items.map((item) => item.name)).toEqual(['a.pdf', 'b.pdf']);
  });

  it('removes a document', async () => {
    const { result } = renderHook(() => useMergeQueue());
    await act(async () => {
      result.current.open();
      await result.current.addFiles([await pdfFile('a.pdf', 1), await pdfFile('b.pdf', 1)]);
    });

    act(() => {
      result.current.remove(result.current.items[0]!.id);
    });

    expect(result.current.items.map((item) => item.name)).toEqual(['b.pdf']);
  });
});
