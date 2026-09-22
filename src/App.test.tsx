// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { App } from './App';
import { compressPdf, type CompressionReport } from './lib/pdf/compress';

/**
 * The real viewer needs a browser, WASM and a canvas, none of which belong in a
 * unit test. This stands in for it and hands back whatever registry the test
 * has set up — which is the only part of it `App` actually talks to.
 */
let registry: unknown = null;

// Compression itself needs a canvas, and is covered against real PDF bytes in
// `lib/pdf/compress.test.ts`. What App owns is what happens around it.
// `importOriginal` keeps the module's constants, which the dialog reads.
vi.mock('./lib/pdf/compress', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/pdf/compress')>()),
  compressPdf: vi.fn(),
}));

vi.mock('@embedpdf/react-pdf-viewer', () => ({
  PDFViewer: ({ onReady }: { onReady?: (registry: never) => void }) => {
    useEffect(() => {
      if (registry !== null) onReady?.(registry as never);
    }, [onReady]);
    return <div data-testid="viewer-stub" />;
  },
}));

function registryWith(exporter: unknown): unknown {
  return {
    getEngine: () => ({}),
    getPlugin: (id: string) => (id === 'export' ? exporter : null),
  };
}

const workingExporter = {
  provides: () => ({
    saveAsCopy: () => ({ toPromise: () => Promise.resolve(new Uint8Array([0x25, 0x50]).buffer) }),
  }),
};

async function openAFile(): Promise<void> {
  const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], 'report.pdf', {
    type: 'application/pdf',
  });
  fireEvent.change(screen.getByTestId('file-input'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByTestId('open-filename').textContent).toBe('report.pdf'));
}

// jsdom implements neither of these. Only the two statics are replaced —
// swapping the whole `URL` global would take the constructor with it, and the
// viewer config resolves its asset URLs with `new URL(...)`.
const realCreate = URL.createObjectURL.bind(URL);
const realRevoke = URL.revokeObjectURL.bind(URL);

let createObjectURL = vi.fn((): string => "blob:stub");

beforeEach(() => {
  createObjectURL = vi.fn((): string => "blob:stub");
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = vi.fn();
  registry = null;
});

afterEach(() => {
  cleanup();
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
});

describe('App save errors', () => {
  it('tells the user when the document cannot be read back', async () => {
    // The export component going missing must not be a silent no-op on a
    // button the user is relying on to keep their work.
    registry = registryWith(null);
    render(<App />);
    await openAFile();

    await waitFor(() => expect(screen.getByTestId<HTMLButtonElement>('save').disabled).toBe(false));
    fireEvent.click(screen.getByTestId('save'));

    const alert = await screen.findByTestId('save-error');
    expect(alert.textContent).toMatch(/Could not read the document back from the viewer/);
    expect(alert.getAttribute('role')).toBe('alert');
  });

  it('does not pretend to have saved anything', async () => {
    registry = registryWith(null);
    render(<App />);
    await openAFile();

    await waitFor(() => expect(screen.getByTestId<HTMLButtonElement>('save').disabled).toBe(false));
    fireEvent.click(screen.getByTestId('save'));
    await screen.findByTestId('save-error');

    // A blob URL is only made once there are bytes worth handing over.
    expect(createObjectURL).toHaveBeenCalledTimes(1); // the document itself, not a download
  });

  it('shows no error when the save succeeds', async () => {
    registry = registryWith(workingExporter);
    render(<App />);
    await openAFile();

    await waitFor(() => expect(screen.getByTestId<HTMLButtonElement>('save').disabled).toBe(false));
    fireEvent.click(screen.getByTestId('save'));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('save-error')).toBeNull();
  });

  it('cannot be saved before the viewer is ready', () => {
    // Without a registry there is nothing to read the document out of.
    registry = null;
    render(<App />);

    expect(screen.queryByTestId('save')).toBeNull();
  });

  it('clears a stale error when another document is opened', async () => {
    registry = registryWith(null);
    render(<App />);
    await openAFile();

    await waitFor(() => expect(screen.getByTestId<HTMLButtonElement>('save').disabled).toBe(false));
    fireEvent.click(screen.getByTestId('save'));
    await screen.findByTestId('save-error');

    await openAFile();

    await waitFor(() => expect(screen.queryByTestId('save-error')).toBeNull());
  });
});

describe('dropping several files at once', () => {
  /** A real PDF, so the merge queue can count its pages the way it does live. */
  async function realPdf(name: string, pages: number): Promise<File> {
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    for (let page = 0; page < pages; page += 1) doc.addPage([200, 200]);
    // Copied into a plain Uint8Array: pdf-lib types its output over
    // ArrayBufferLike, which includes SharedArrayBuffer and so is not a BlobPart.
    const bytes = new Uint8Array(await doc.save());
    return new File([bytes], name, { type: 'application/pdf' });
  }

  function drop(files: File[]): void {
    fireEvent.drop(screen.getByTestId('dropzone'), {
      dataTransfer: { types: ['Files'], files, dropEffect: '' },
    });
  }

  it('offers the merge dialog instead of combining them behind the reader', async () => {
    // Merging silently gives no chance to check or change the order, and the
    // result is a document nobody asked to be built that way.
    render(<App />);

    drop([await realPdf('first.pdf', 2), await realPdf('second.pdf', 3)]);

    await waitFor(() => {
      expect(screen.getByTestId('merge-dialog')).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByTestId('merge-total').textContent).toBe('5 pages in 2 files');
    });
  });

  it('opens a single dropped file straight away', async () => {
    // One file is an open, not an assembly job.
    render(<App />);

    drop([await realPdf('only.pdf', 1)]);

    await waitFor(() => {
      expect(screen.getByTestId('open-filename').textContent).toBe('only.pdf');
    });
    expect(screen.queryByTestId('merge-dialog')).toBeNull();
  });
});

describe('reducing the file size', () => {
  /** A plausible report; the compression itself is covered in lib/pdf. */
  function report(overrides: Partial<CompressionReport> = {}): CompressionReport {
    return {
      pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]),
      originalSize: 8 * 1024 * 1024,
      newSize: 2 * 1024 * 1024,
      imagesFound: 4,
      imagesDownsampled: 4,
      changed: true,
      ...overrides,
    };
  }

  async function openTheDialog(): Promise<void> {
    registry = registryWith(workingExporter);
    render(<App />);
    await openAFile();

    await waitFor(() => expect(screen.getByTestId<HTMLButtonElement>('open-reduce').disabled).toBe(false));
    fireEvent.click(screen.getByTestId('open-reduce'));
    await screen.findByTestId('reduce-dialog');
  }

  it('reduces at the chosen resolution and reports what it saved', async () => {
    vi.mocked(compressPdf).mockResolvedValue(report());
    await openTheDialog();

    fireEvent.click(screen.getByTestId('reduce-preset-screen'));
    fireEvent.click(screen.getByTestId('reduce-confirm'));

    // The summary has to survive the viewer being reopened on the result —
    // which clears the summary belonging to the document it replaced.
    const summary = await screen.findByTestId('reduce-summary');
    expect(summary.textContent).toContain('was 8.0 MB');
    expect(screen.queryByTestId('reduce-dialog')).toBeNull();

    expect(vi.mocked(compressPdf)).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.objectContaining({ targetDpi: 72 }),
    );
  });

  it('renames the result so Save cannot offer to overwrite the original', async () => {
    // The reduction is lossy. If the Save dialog opens pre-filled with
    // "report.pdf", one click in the original's folder destroys it.
    vi.mocked(compressPdf).mockResolvedValue(report());
    await openTheDialog();

    fireEvent.click(screen.getByTestId('reduce-confirm'));

    await screen.findByTestId('reduce-summary');
    await waitFor(() =>
      expect(screen.getByTestId('open-filename').textContent).toBe('report-reduced.pdf'),
    );
  });

  it('keeps the original name when nothing was reduced', async () => {
    // Nothing was thrown away, so there is nothing to protect the original from
    // and no reason to rename the document the user is still working on.
    vi.mocked(compressPdf).mockResolvedValue(
      report({ changed: false, newSize: 8 * 1024 * 1024, imagesDownsampled: 0 }),
    );
    await openTheDialog();

    fireEvent.click(screen.getByTestId('reduce-confirm'));

    await screen.findByTestId('reduce-summary');
    expect(screen.getByTestId('open-filename').textContent).toBe('report.pdf');
  });

  it('leaves the document alone when there was nothing to gain', async () => {
    vi.mocked(compressPdf).mockResolvedValue(
      report({ changed: false, newSize: 8 * 1024 * 1024, imagesDownsampled: 0 }),
    );
    await openTheDialog();
    const urlsBefore = createObjectURL.mock.calls.length;

    fireEvent.click(screen.getByTestId('reduce-confirm'));

    expect((await screen.findByTestId('reduce-summary')).textContent).toContain('No further reduction');
    // Remounting the viewer on bytes identical to the ones it is showing would
    // lose the reader's place for nothing.
    expect(createObjectURL.mock.calls.length).toBe(urlsBefore);
  });

  it('keeps a failure in the dialog, where the choice still is', async () => {
    vi.mocked(compressPdf).mockRejectedValue(new Error('document: this PDF is password-protected'));
    await openTheDialog();

    fireEvent.click(screen.getByTestId('reduce-confirm'));

    expect((await screen.findByTestId('reduce-error')).textContent).toContain('password-protected');
    expect(screen.getByTestId('reduce-dialog')).toBeTruthy();
  });

  it('reduces the document as it currently stands, not the bytes it was opened with', async () => {
    // Annotations made since the file was opened live in the viewer, and
    // reducing the original bytes would quietly throw them away.
    vi.mocked(compressPdf).mockResolvedValue(report());
    await openTheDialog();

    fireEvent.click(screen.getByTestId('reduce-confirm'));

    await screen.findByTestId('reduce-summary');
    const [bytes] = vi.mocked(compressPdf).mock.calls[0] ?? [];
    // What `workingExporter` hands back, rather than the opened file's bytes.
    expect([...(bytes ?? [])]).toEqual([0x25, 0x50]);
  });

  it('cannot be reduced before the viewer is ready', async () => {
    registry = null;
    render(<App />);
    await openAFile();

    expect(screen.getByTestId<HTMLButtonElement>('open-reduce').disabled).toBe(true);
  });
});

describe('naming a document this app has changed', () => {
  /** A registry whose viewer reports edits of its own, as annotating makes it. */
  function registryWithViewerEdits(canUndo: boolean): unknown {
    return {
      getEngine: () => ({}),
      getPlugin: (id: string) => {
        if (id === 'export') return workingExporter;
        if (id === 'history') return { provides: () => ({ canUndo: () => canUndo }) };
        return null;
      },
    };
  }

  /** The names handed to the browser's download, in order. */
  function captureSavedNames(): string[] {
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    return names;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('suggests a new name after the document was annotated in the viewer', async () => {
    // Annotating never passes through this app, so nothing has renamed the
    // document — but the file on disk is still the unannotated one.
    registry = registryWithViewerEdits(true);
    const names = captureSavedNames();
    render(<App />);
    await openAFile();

    await waitFor(() => expect(screen.getByTestId<HTMLButtonElement>('save').disabled).toBe(false));
    fireEvent.click(screen.getByTestId('save'));

    await waitFor(() => expect(names).toEqual(['report-edited.pdf']));
  });

  it('offers the original name when nothing has been changed at all', async () => {
    registry = registryWithViewerEdits(false);
    const names = captureSavedNames();
    render(<App />);
    await openAFile();

    await waitFor(() => expect(screen.getByTestId<HTMLButtonElement>('save').disabled).toBe(false));
    fireEvent.click(screen.getByTestId('save'));

    await waitFor(() => expect(names).toEqual(['report.pdf']));
  });

  it('does not demote a document that already says what was done to it', async () => {
    // A reduction that is then highlighted is still a reduction; "-edited"
    // would say less about it than the name it already has.
    vi.mocked(compressPdf).mockResolvedValue({
      pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]),
      originalSize: 8 * 1024 * 1024,
      newSize: 2 * 1024 * 1024,
      imagesFound: 4,
      imagesDownsampled: 4,
      changed: true,
    });
    registry = registryWithViewerEdits(true);
    const names = captureSavedNames();
    // Reducing remounts the viewer, and the viewer is remounted by its blob URL
    // changing. The shared stub hands back the same URL every time, so without
    // this the viewer never re-readies and Save stays disabled.
    let issued = 0;
    URL.createObjectURL = vi.fn(() => `blob:stub-${String((issued += 1))}`);
    render(<App />);
    await openAFile();

    await waitFor(() => expect(screen.getByTestId<HTMLButtonElement>('open-reduce').disabled).toBe(false));
    fireEvent.click(screen.getByTestId('open-reduce'));
    fireEvent.click(await screen.findByTestId('reduce-confirm'));
    await screen.findByTestId('reduce-summary');

    await waitFor(() => expect(screen.getByTestId<HTMLButtonElement>('save').disabled).toBe(false));
    fireEvent.click(screen.getByTestId('save'));

    await waitFor(() => expect(names).toEqual(['report-reduced.pdf']));
  });
});

describe('showing how big the open document is', () => {
  it('shows the size as soon as a document is open, before anything is done to it', async () => {
    // The question "is this file big?" is what sends someone looking for
    // Reduce size; answering it should not require running it first.
    registry = registryWith(workingExporter);
    render(<App />);
    await openAFile();

    // The fixture is the five bytes of a %PDF- header.
    expect(screen.getByTestId('open-filesize').textContent).toBe('5 B');
  });

  it('shows nothing to size when no document is open', () => {
    registry = null;
    render(<App />);

    expect(screen.queryByTestId('open-filesize')).toBeNull();
  });

  it('follows the document as an operation changes it', async () => {
    vi.mocked(compressPdf).mockResolvedValue({
      // Six bytes out, five in: the figure has to come from the new document.
      pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]),
      originalSize: 5,
      newSize: 6,
      imagesFound: 1,
      imagesDownsampled: 1,
      changed: true,
    });
    registry = registryWith(workingExporter);
    render(<App />);
    await openAFile();
    expect(screen.getByTestId('open-filesize').textContent).toBe('5 B');

    await waitFor(() => expect(screen.getByTestId<HTMLButtonElement>('open-reduce').disabled).toBe(false));
    fireEvent.click(screen.getByTestId('open-reduce'));
    fireEvent.click(await screen.findByTestId('reduce-confirm'));

    await screen.findByTestId('reduce-summary');
    await waitFor(() => expect(screen.getByTestId('open-filesize').textContent).toBe('6 B'));
  });
});

describe('measuring the size on request', () => {
  it('asks the viewer what saving now would write', async () => {
    // The document was opened as 5 bytes; the viewer would write 2. The point
    // of the button is that those are different numbers.
    registry = registryWith(workingExporter);
    render(<App />);
    await openAFile();
    expect(screen.getByTestId('open-filesize').textContent).toContain('5 B');

    await waitFor(() => expect(screen.getByTestId<HTMLButtonElement>('open-filesize').disabled).toBe(false));
    fireEvent.click(screen.getByTestId('open-filesize'));

    await waitFor(() => expect(screen.getByTestId('open-filesize').textContent).toContain('2 B'));
  });

  it('marks a measured figure as measured, so it is not mistaken for the other one', async () => {
    registry = registryWith(workingExporter);
    render(<App />);
    await openAFile();
    expect(screen.queryByLabelText('measured')).toBeNull();

    await waitFor(() => expect(screen.getByTestId<HTMLButtonElement>('open-filesize').disabled).toBe(false));
    fireEvent.click(screen.getByTestId('open-filesize'));

    await waitFor(() => expect(screen.getByLabelText('measured')).toBeTruthy());
  });

  it('reports a failure rather than showing a number that is wrong', async () => {
    // No export component: the same failure Save hits, down the same channel.
    registry = registryWith(null);
    render(<App />);
    await openAFile();

    await waitFor(() => expect(screen.getByTestId<HTMLButtonElement>('open-filesize').disabled).toBe(false));
    fireEvent.click(screen.getByTestId('open-filesize'));

    expect((await screen.findByTestId('save-error')).textContent).toMatch(
      /Could not read the document back from the viewer/,
    );
    // Still the figure it had, not a guess.
    expect(screen.getByTestId('open-filesize').textContent).toContain('5 B');
  });

  it('cannot be measured before the viewer is ready', async () => {
    registry = null;
    render(<App />);
    await openAFile();

    expect(screen.getByTestId<HTMLButtonElement>('open-filesize').disabled).toBe(true);
  });

  it('drops the measurement when an operation replaces the document', async () => {
    // A measurement describes the document it was taken from. Carrying it over
    // would label the new document with the old one's size.
    vi.mocked(compressPdf).mockResolvedValue({
      pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]),
      originalSize: 5,
      newSize: 6,
      imagesFound: 1,
      imagesDownsampled: 1,
      changed: true,
    });
    registry = registryWith(workingExporter);
    let issued = 0;
    URL.createObjectURL = vi.fn(() => `blob:stub-${String((issued += 1))}`);
    render(<App />);
    await openAFile();

    await waitFor(() => expect(screen.getByTestId<HTMLButtonElement>('open-filesize').disabled).toBe(false));
    fireEvent.click(screen.getByTestId('open-filesize'));
    await waitFor(() => expect(screen.getByLabelText('measured')).toBeTruthy());

    fireEvent.click(screen.getByTestId('open-reduce'));
    fireEvent.click(await screen.findByTestId('reduce-confirm'));
    await screen.findByTestId('reduce-summary');

    await waitFor(() => expect(screen.getByTestId('open-filesize').textContent).toContain('6 B'));
    expect(screen.queryByLabelText('measured')).toBeNull();
  });
});
