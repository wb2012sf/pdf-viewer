// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { App } from './App';

/**
 * The real viewer needs a browser, WASM and a canvas, none of which belong in a
 * unit test. This stands in for it and hands back whatever registry the test
 * has set up — which is the only part of it `App` actually talks to.
 */
let registry: unknown = null;

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
