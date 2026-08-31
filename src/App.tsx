import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PDFViewer } from '@embedpdf/react-pdf-viewer';
import type { PluginRegistry } from '@embedpdf/core';
import { OpenPdfButton } from './components/OpenPdfButton';
import { OcrControls } from './components/OcrControls';
import { PagePanel } from './components/PagePanel';
import { useOcr } from './hooks/useOcr';
import { usePageOps, type PageOperation } from './hooks/usePageOps';
import {
  extractPages,
  getPageRotations,
  mergePdfs,
  orderWithPageMoved,
  removePages,
  reorderPages,
  rotatePages,
} from './lib/pdf/page-ops';
import { offlineViewerConfig } from './lib/viewer/offline-config';
import { currentDocumentBytes } from './lib/viewer/current-document';
import { saveFile } from './lib/platform/save-file';

interface OpenDocument {
  name: string;
  /** The bytes themselves, which OCR and page operations work on directly. */
  bytes: Uint8Array;
  /** Object URL handed to the viewer; revoked when it is replaced or closed. */
  url: string;
}

function openDocumentFrom(name: string, bytes: Uint8Array): OpenDocument {
  // `slice()` hands the Blob a buffer of its own; the bytes may be a view into
  // a larger one, and Blob would otherwise take the whole thing.
  const blob = new Blob([bytes.slice().buffer], { type: 'application/pdf' });
  return { name, bytes, url: URL.createObjectURL(blob) };
}

export function App(): React.JSX.Element {
  const [document, setDocument] = useState<OpenDocument | null>(null);
  const [registry, setRegistry] = useState<PluginRegistry | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pagesOpen, setPagesOpen] = useState(false);
  const [rotations, setRotations] = useState<number[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const ocr = useOcr();
  const pageOps = usePageOps();
  const mergeInputRef = useRef<HTMLInputElement>(null);

  const engine = registry?.getEngine() ?? null;

  // Object URLs pin the file in memory until revoked.
  useEffect(() => {
    if (!document) return;
    return () => {
      URL.revokeObjectURL(document.url);
    };
  }, [document]);

  // Swapping the document remounts the viewer, which builds a fresh registry
  // and engine. Dropping the old registry here keeps OCR from being handed a
  // reference that is about to be torn down; `onReady` supplies the new one.
  const replaceDocument = useCallback((next: OpenDocument): void => {
    setRegistry(null);
    setSaveError(null);
    // Page indices from the old document mean nothing in the new one.
    setSelected(new Set());
    setDocument(next);
  }, []);

  // The panel lists pages by their stored rotation, which is read from the
  // bytes rather than the viewer so it stays right after every operation.
  useEffect(() => {
    let cancelled = false;
    const reading = document ? getPageRotations(document.bytes) : Promise.resolve<number[]>([]);

    void reading
      .then((next) => {
        if (!cancelled) setRotations(next);
      })
      .catch(() => {
        // A document the viewer opened but pdf-lib cannot read is possible —
        // a damaged file it renders leniently — and the panel just stays empty.
        if (!cancelled) setRotations([]);
      });

    return () => {
      cancelled = true;
    };
  }, [document]);

  const { reset: resetOcr, run: runOcr } = ocr;

  const handleOpen = useCallback(
    async (file: File) => {
      resetOcr();
      replaceDocument(openDocumentFrom(file.name, new Uint8Array(await file.arrayBuffer())));
    },
    [replaceDocument, resetOcr],
  );

  const handleRunOcr = useCallback(async () => {
    if (!registry || !engine || !document) return;

    // Read the document back out of the viewer rather than using the bytes it
    // was opened with: anything annotated since then lives in the viewer's
    // state. Passed as a function so that a failure to read it is reported as
    // an OCR failure instead of escaping unhandled.
    const searchable = await runOcr(engine, () => currentDocumentBytes(registry));
    if (!searchable) return;

    // Reopen the viewer on the result so the new text layer is searchable at
    // once, rather than making the user save the file and open it again.
    replaceDocument(openDocumentFrom(document.name, searchable));
  }, [registry, engine, document, runOcr, replaceDocument]);

  const { apply: applyPageOp } = pageOps;

  /** Runs a page operation and reopens the viewer on the result. */
  const runPageOp = useCallback(
    async (operation: PageOperation) => {
      if (!registry || !document) return;

      const next = await applyPageOp(registry, operation);
      if (!next) return;
      replaceDocument(openDocumentFrom(document.name, next));
    },
    [registry, document, applyPageOp, replaceDocument],
  );

  const selectedPages = useMemo(() => [...selected].sort((a, b) => a - b), [selected]);

  const handleToggle = useCallback((pageIndex: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(pageIndex)) next.add(pageIndex);
      return next;
    });
  }, []);

  const handleExtract = useCallback(async () => {
    if (!registry || !document) return;

    // Extract writes a *new* file rather than replacing what is open — pulling
    // pages out is usually about producing something alongside the original.
    const extracted = await applyPageOp(registry, (bytes) => extractPages(bytes, selectedPages));
    if (!extracted) return;

    try {
      await saveFile(extracted, `${document.name.replace(/\.pdf$/i, '')}-pages.pdf`);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [registry, document, applyPageOp, selectedPages]);

  const handleMerge = useCallback(
    async (file: File) => {
      const appended = new Uint8Array(await file.arrayBuffer());
      await runPageOp((bytes) => mergePdfs([bytes, appended]));
    },
    [runPageOp],
  );

  const handleSave = useCallback(async () => {
    if (!document || !registry) return;
    setSaveError(null);

    let bytes: Uint8Array;
    try {
      bytes = await currentDocumentBytes(registry);
    } catch (cause) {
      // Better to say the file could not be read than to hand the user a copy
      // that silently lacks everything they just did to it.
      setSaveError(cause instanceof Error ? cause.message : String(cause));
      return;
    }

    try {
      await saveFile(bytes, document.name);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [document, registry]);

  return (
    <div className="workbench">
      <header className="workbench__bar">
        <span className="workbench__title">PDF Workbench</span>
        <span className="workbench__filename" data-testid="open-filename">
          {document?.name ?? 'No document open'}
        </span>

        {document && (
          <>
            <OcrControls
              status={ocr.status}
              progress={ocr.progress}
              wordsAdded={ocr.wordsAdded}
              error={ocr.error}
              ready={engine !== null}
              onRun={() => void handleRunOcr()}
              onCancel={ocr.cancel}
            />
            {saveError !== null && (
              <span
                className="workbench__ocr-status workbench__ocr-status--error"
                role="alert"
                data-testid="save-error"
              >
                {saveError}
              </span>
            )}
            <button
              type="button"
              className="workbench__button"
              onClick={() => setPagesOpen((open) => !open)}
              aria-pressed={pagesOpen}
              data-testid="toggle-pages"
            >
              Pages
            </button>
            <button
              type="button"
              className="workbench__button"
              onClick={() => void handleSave()}
              disabled={registry === null}
              data-testid="save"
            >
              Save
            </button>
          </>
        )}

        <OpenPdfButton onOpen={(file) => void handleOpen(file)} />
      </header>

      {/* Off-screen: merging needs a second document, and the panel's button
          drives this rather than showing a second file control in the toolbar. */}
      <input
        ref={mergeInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="workbench__file-input"
        data-testid="merge-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void handleMerge(file);
        }}
      />

      <main className="workbench__body">
        {document && pagesOpen && (
          <PagePanel
            rotations={rotations}
            selected={selected}
            busy={pageOps.busy}
            error={pageOps.error}
            onToggle={handleToggle}
            onSelectAll={() => setSelected(new Set(rotations.map((_unused, index) => index)))}
            onClearSelection={() => setSelected(new Set())}
            onRotate={(degrees) => void runPageOp((bytes) => rotatePages(bytes, selectedPages, degrees))}
            onDelete={() => void runPageOp((bytes) => removePages(bytes, selectedPages))}
            onMove={(direction) =>
              void runPageOp((bytes) => {
                const from = selectedPages[0]!;
                return reorderPages(bytes, orderWithPageMoved(rotations.length, from, from + direction));
              })
            }
            onExtract={() => void handleExtract()}
            onMerge={() => mergeInputRef.current?.click()}
            onClose={() => setPagesOpen(false)}
          />
        )}

        {document ? (
          <div className="workbench__viewer">
            <PDFViewer
              key={document.url}
              config={offlineViewerConfig(document.url)}
              style={{ width: '100%', height: '100%' }}
              onReady={setRegistry}
            />
          </div>
        ) : (
          <p className="workbench__empty" data-testid="empty-state">
            Open a PDF to get started. Everything runs on this machine — nothing is uploaded.
          </p>
        )}
      </main>
    </div>
  );
}
