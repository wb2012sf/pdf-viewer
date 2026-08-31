import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PDFViewer } from '@embedpdf/react-pdf-viewer';
import type { PluginRegistry } from '@embedpdf/core';
import { OpenPdfButton, type OpenPdfHandle } from './components/OpenPdfButton';
import { ConfirmDialog } from './components/ConfirmDialog';
import { OcrControls } from './components/OcrControls';
import { PagePanel } from './components/PagePanel';
import { useOcr } from './hooks/useOcr';
import { usePageOps, type PageOperation } from './hooks/usePageOps';
import { useThumbnails } from './hooks/useThumbnails';
import {
  extractPages,
  getPageRotations,
  mergePdfs,
  orderWithPageMoved,
  removePages,
  reorderPages,
  splitPdf,
  splitPointsToRanges,
  rotatePages,
} from './lib/pdf/page-ops';
import { offlineViewerConfig } from './lib/viewer/offline-config';
import { currentDocumentBytes } from './lib/viewer/current-document';
import { saveFile } from './lib/platform/save-file';
import { viewerHasUnsavedChanges } from './lib/viewer/unsaved-changes';
import { readFieldConstraints, watchFormFields } from './lib/viewer/form-field-fixes';

interface OpenDocument {
  name: string;
  /** The bytes themselves, which OCR and page operations work on directly. */
  bytes: Uint8Array;
  /** Object URL handed to the viewer; revoked when it is replaced or closed. */
  url: string;
}

/** How a save attempt ended; anything but 'saved' leaves the work unwritten. */
type SaveResult = 'saved' | 'cancelled' | 'failed';

/** What the user asked for while there was unsaved work to warn about. */
type PendingAction = 'open' | 'close';

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
  /**
   * Edits this app made (OCR, page operations) since the last save. Edits made
   * *inside* the viewer are tracked by the viewer itself and asked for
   * separately — see `viewerHasUnsavedChanges`.
   */
  const [editedSinceSave, setEditedSinceSave] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [rotations, setRotations] = useState<number[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const ocr = useOcr();
  const pageOps = usePageOps();
  const mergeInputRef = useRef<HTMLInputElement>(null);
  const openPdfRef = useRef<OpenPdfHandle>(null);
  // Split produces several documents where a page operation yields one, so the
  // parts are carried out of the operation through here.
  const splitParts = useRef<Uint8Array[]>([]);

  const engine = registry?.getEngine() ?? null;

  // Page previews for the panel. Rendered from the document bytes rather than
  // the viewer, so they show exactly what the next operation will act on.
  const thumbnails = useThumbnails(pagesOpen ? engine : null, pagesOpen ? (document?.bytes ?? null) : null);

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
  const replaceDocument = useCallback((next: OpenDocument | null, edited: boolean): void => {
    setRegistry(null);
    setSaveError(null);
    // Page indices from the old document mean nothing in the new one.
    setSelected(new Set());
    setEditedSinceSave(edited);
    setDocument(next);
  }, []);

  // Patch the form widgets the viewer draws wrong (max length, multiline font
  // size). Runs against the viewer's shadow root, and keeps running: widgets
  // are rebuilt as pages scroll and as the zoom changes.
  useEffect(() => {
    if (!document || !registry) return;

    let stop: (() => void) | undefined;
    let cancelled = false;

    void readFieldConstraints(document.bytes).then((constraints) => {
      const host = window.document.querySelector('embedpdf-container');
      const root = host?.shadowRoot;
      if (cancelled || !root) return;
      stop = watchFormFields(root, constraints);
    });

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [document, registry]);

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
      replaceDocument(openDocumentFrom(file.name, new Uint8Array(await file.arrayBuffer())), false);
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
    replaceDocument(openDocumentFrom(document.name, searchable), true);
  }, [registry, engine, document, runOcr, replaceDocument]);

  const { apply: applyPageOp } = pageOps;

  /** Runs a page operation and reopens the viewer on the result. */
  const runPageOp = useCallback(
    async (operation: PageOperation) => {
      if (!registry || !document) return;

      const next = await applyPageOp(registry, operation);
      if (!next) return;
      replaceDocument(openDocumentFrom(document.name, next), true);
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

  const handleSplit = useCallback(async () => {
    if (!registry || !document) return;

    // Like extract, split produces files alongside the original rather than
    // replacing what is open — the document being split is usually still wanted.
    const parts = await applyPageOp(registry, async (bytes) =>
      // `applyPageOp` hands back one document, so the parts are carried out
      // through this closure instead.
      {
        splitParts.current = await splitPdf(bytes, splitPointsToRanges(rotations.length, selectedPages));
        return bytes;
      },
    );
    if (!parts) return;

    const base = document.name.replace(/\.pdf$/i, '');
    try {
      for (const [index, part] of splitParts.current.entries()) {
        const outcome = await saveFile(part, `${base}-part-${String(index + 1)}.pdf`);
        // Dismissing one dialog means the user changed their mind about the
        // rest, rather than wanting to be asked another dozen times.
        if (outcome === 'cancelled') break;
      }
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      splitParts.current = [];
    }
  }, [registry, document, applyPageOp, rotations.length, selectedPages]);

  /** Moves a page and keeps it selected where it landed. */
  const handleMove = useCallback(
    async (from: number, to: number) => {
      await runPageOp((bytes) => reorderPages(bytes, orderWithPageMoved(rotations.length, from, to)));
      // Following the page you just dragged is the least surprising thing to do;
      // leaving the tick on whatever page slid into its old slot is not.
      setSelected((prev) => (prev.has(from) ? new Set([to]) : prev));
    },
    [runPageOp, rotations.length],
  );

  const handleSave = useCallback(async (): Promise<SaveResult> => {
    if (!document || !registry) return 'failed';
    setSaveError(null);

    let bytes: Uint8Array;
    try {
      bytes = await currentDocumentBytes(registry);
    } catch (cause) {
      // Better to say the file could not be read than to hand the user a copy
      // that silently lacks everything they just did to it.
      setSaveError(cause instanceof Error ? cause.message : String(cause));
      return 'failed';
    }

    try {
      const outcome = await saveFile(bytes, document.name);
      // A dismissed save dialog wrote nothing, so the work is still unsaved.
      if (outcome === 'saved') setEditedSinceSave(false);
      return outcome;
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause));
      return 'failed';
    }
  }, [document, registry]);

  /**
   * Anything that would be lost by closing or replacing the document: edits this
   * app made, plus edits made inside the viewer.
   *
   * Asked at the moment it is needed rather than during render. Annotating
   * happens entirely inside the viewer — this app is never told and nothing
   * re-renders — so a value computed at render time would still say "clean"
   * long after the document stopped being clean.
   */
  const hasUnsavedChanges = useCallback(
    (): boolean => editedSinceSave || viewerHasUnsavedChanges(registry),
    [editedSinceSave, registry],
  );

  const closeDocument = useCallback(() => {
    setPagesOpen(false);
    resetOcr();
    replaceDocument(null, false);
  }, [replaceDocument, resetOcr]);

  /** Runs the action the user asked for once the unsaved work is settled. */
  const completePending = useCallback(
    (action: PendingAction) => {
      setPending(null);
      if (action === 'close') closeDocument();
      else openPdfRef.current?.openPicker();
    },
    [closeDocument],
  );

  const requestAction = useCallback(
    (action: PendingAction): boolean => {
      if (!document || !hasUnsavedChanges()) return true;
      setPending(action);
      return false;
    },
    [document, hasUnsavedChanges],
  );

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
              Save as…
            </button>
            <button
              type="button"
              className="workbench__button"
              onClick={() => {
                if (requestAction('close')) closeDocument();
              }}
              data-testid="close"
            >
              Close
            </button>
          </>
        )}

        <OpenPdfButton
          ref={openPdfRef}
          onOpen={(file) => void handleOpen(file)}
          beforeOpen={() => requestAction('open')}
        />
      </header>

      {pending !== null && (
        <ConfirmDialog
          title={pending === 'close' ? 'Close without saving?' : 'Open another document?'}
          message={
            pending === 'close'
              ? 'This document has changes that have not been written to a file. Closing it will lose them.'
              : 'This document has changes that have not been written to a file. Opening another will lose them.'
          }
          confirmLabel={pending === 'close' ? 'Close without saving' : 'Discard and open'}
          saveLabel="Save as…"
          onCancel={() => setPending(null)}
          onConfirm={() => completePending(pending)}
          onSave={() => {
            // Only carry on once something was actually written: a dismissed
            // save dialog must not quietly discard the work it was protecting.
            void handleSave().then((outcome) => {
              if (outcome === 'saved') completePending(pending);
              else setPending(null);
            });
          }}
        />
      )}

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
            thumbnails={thumbnails.thumbnails}
            thumbnailsStale={thumbnails.stale}
            onRotate={(degrees) => void runPageOp((bytes) => rotatePages(bytes, selectedPages, degrees))}
            onDelete={() => void runPageOp((bytes) => removePages(bytes, selectedPages))}
            onMove={(from, to) => void handleMove(from, to)}
            onExtract={() => void handleExtract()}
            onSplit={() => void handleSplit()}
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
