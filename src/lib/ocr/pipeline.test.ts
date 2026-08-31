import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PdfDocumentObject, PdfEngine } from '@embedpdf/models';
import { makeSearchable } from './pipeline';
import { PdfInputError } from '../pdf/errors';
import { makePdf, pageContentStream } from '../../test/fixtures';
import type { OcrPage } from './types';
import type { PageImage } from './recognize';

// The one part of the pipeline that needs a browser. Everything else here --
// opening the document, rendering, writing the text layer with pdf-lib, closing
// the document again -- is the real implementation.
const recognizePages = vi.hoisted(() => vi.fn());
vi.mock('./recognize', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./recognize')>()),
  recognizePages,
}));

function task<T>(value: T): { toPromise: () => Promise<T> } {
  return { toPromise: () => Promise.resolve(value) };
}

interface FakeEngine {
  engine: PdfEngine;
  opened: string[];
  closed: string[];
  rendered: number[];
}

/**
 * A stand-in for PDFium: it only has to hand back a document shape and a blob
 * per page, which is all the pipeline asks of it.
 */
function fakeEngine(pageCount: number): FakeEngine {
  const opened: string[] = [];
  const closed: string[] = [];
  const rendered: number[] = [];

  const engine = {
    openDocumentBuffer: (file: { id: string }) => {
      opened.push(file.id);
      return task<PdfDocumentObject>({
        id: file.id,
        pageCount,
        pages: Array.from({ length: pageCount }, (_unused, index) => ({
          index,
          size: { width: 100, height: 200 },
          rotation: 0,
        })),
      } as PdfDocumentObject);
    },
    renderPage: (_doc: PdfDocumentObject, page: { index: number }) => {
      rendered.push(page.index);
      return task(new Blob([new Uint8Array([0])]));
    },
    closeDocument: (doc: PdfDocumentObject) => {
      closed.push(doc.id);
      return task(true);
    },
    // A test double for an interface with dozens of members; the pipeline only
    // reaches for the three above.
  } as unknown as PdfEngine;

  return { engine, opened, closed, rendered };
}

function recognizesAs(pages: (image: PageImage) => OcrPage): void {
  recognizePages.mockImplementation(
    (images: readonly PageImage[], options: { onProgress?: (c: number, t: number) => void }) => {
      images.forEach((_image, index) => options.onProgress?.(index + 1, images.length));
      return Promise.resolve(images.map(pages));
    },
  );
}

beforeEach(() => {
  // Rendering measures the blob to learn the true pixel size; jsdom-free Node
  // has no image pipeline, so the size is supplied here instead.
  vi.stubGlobal('createImageBitmap', () => Promise.resolve({ width: 400, height: 800, close: () => undefined }));

  recognizesAs((image) => ({
    pageIndex: image.pageIndex,
    imageWidth: image.width,
    imageHeight: image.height,
    words: [{ text: 'Recognized', confidence: 90, bbox: { x0: 40, y0: 40, x1: 300, y1: 100 } }],
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  recognizePages.mockReset();
});

describe('makeSearchable', () => {
  it('writes the recognized words into the document it was given', async () => {
    const { engine } = fakeEngine(1);

    const result = await makeSearchable(engine, await makePdf(1));

    expect(result.wordsAdded).toBe(1);
    expect(await pageContentStream(result.pdf, 0)).toContain('5265636F676E697A6564'); // "Recognized"
  });

  it('leaves the visible page exactly as it was', async () => {
    // The bytes that come out are the bytes that went in plus text operators:
    // the page is never re-encoded through PDFium.
    const { engine } = fakeEngine(1);

    const result = await makeSearchable(engine, await makePdf(1));

    expect(await pageContentStream(result.pdf, 0)).toContain('5061676520' + '30'); // "Page 0"
  });

  it('renders every page of the document', async () => {
    const { engine, rendered } = fakeEngine(3);

    const result = await makeSearchable(engine, await makePdf(3));

    expect(rendered).toEqual([0, 1, 2]);
    expect(result.pagesProcessed).toBe(3);
  });

  it('honours a page subset', async () => {
    const { engine, rendered } = fakeEngine(4);

    await makeSearchable(engine, await makePdf(4), { pageIndices: [1, 3] });

    expect(rendered).toEqual([1, 3]);
  });

  it('reports each stage in order', async () => {
    const { engine } = fakeEngine(2);
    const stages: string[] = [];

    await makeSearchable(engine, await makePdf(2), {
      onProgress: ({ stage, completed, total }) => stages.push(`${stage} ${String(completed)}/${String(total)}`),
    });

    expect(stages).toEqual([
      'rendering 1/2',
      'rendering 2/2',
      'recognizing 1/2',
      'recognizing 2/2',
      'writing 0/1',
      'writing 1/1',
    ]);
  });

  it('closes the PDFium document it opened', async () => {
    // These are native handles; leaking one per OCR run would grow memory until
    // the tab falls over.
    const { engine, opened, closed } = fakeEngine(1);

    await makeSearchable(engine, await makePdf(1));

    expect(closed).toEqual(opened);
  });

  it('closes the document even when recognition throws', async () => {
    const { engine, opened, closed } = fakeEngine(1);
    recognizePages.mockRejectedValue(new Error('worker died'));

    await expect(makeSearchable(engine, await makePdf(1))).rejects.toThrow('worker died');

    expect(closed).toEqual(opened);
  });

  it('opens its own handle rather than the one the viewer is using', async () => {
    const { engine, opened } = fakeEngine(1);

    await makeSearchable(engine, await makePdf(1));

    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatch(/^ocr-/);
  });

  it('stops when the caller aborts', async () => {
    const { engine, closed } = fakeEngine(2);
    const controller = new AbortController();
    recognizePages.mockImplementation(() => {
      controller.abort();
      return Promise.resolve([]);
    });

    await expect(makeSearchable(engine, await makePdf(2), { signal: controller.signal })).rejects.toThrow(
      /cancelled/,
    );
    // Cancelling still has to give the native handle back.
    expect(closed).toHaveLength(1);
  });

  it('rejects input that is not a PDF before touching the engine', async () => {
    const { engine, opened } = fakeEngine(1);

    await expect(makeSearchable(engine, new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(PdfInputError);
    expect(opened).toEqual([]);
  });

  it('rejects a page index the document does not have', async () => {
    const { engine } = fakeEngine(2);

    await expect(makeSearchable(engine, await makePdf(2), { pageIndices: [5] })).rejects.toThrow(/out of range/);
  });

  it('rejects a nonsensical render scale', async () => {
    const { engine } = fakeEngine(1);

    await expect(makeSearchable(engine, await makePdf(1), { scale: 0 })).rejects.toThrow(/positive number/);
  });
});
