import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PDFViewer } from '@embedpdf/react-pdf-viewer';
import type { PluginRegistry } from '@embedpdf/core';
import { OpenPdfButton, type OpenPdfHandle } from './components/OpenPdfButton';
import { ConfirmDialog } from './components/ConfirmDialog';
import { DropZone } from './components/DropZone';
import { MergeDialog } from './components/MergeDialog';
import { OcrControls } from './components/OcrControls';
import { PagePanel } from './components/PagePanel';
import { ReduceSizeDialog } from './components/ReduceSizeDialog';
import { reductionSummary, type SizePreset } from './components/reduce-size-presets';
import { useOcr } from './hooks/useOcr';
import { usePageOps, type PageOperation } from './hooks/usePageOps';
import { useThumbnails } from './hooks/useThumbnails';
import { useMergeQueue } from './hooks/useMergeQueue';
import {
  extractPages,
  getPageRotations,
  mergePdfs,
  orderWithPagesMoved,
  removePages,
  reorderPages,
  splitPdf,
  splitPointsToRanges,
  rotatePages,
} from './lib/pdf/page-ops';
import { formatSize } from './lib/format';
import { compressPdf } from './lib/pdf/compress';
import { derivedName, hasChangeMarker } from './lib/pdf/derived-name';
import { resampleImage } from './lib/pdf/image-resampler';
import { offlineViewerConfig } from './lib/viewer/offline-config';
import { currentDocumentBytes } from './lib/viewer/current-document';
import { saveFile } from './lib/platform/save-file';
import { viewerHasUnsavedChanges } from './lib/viewer/unsaved-changes';
import { bridgeViewerExport } from './lib/viewer/export-bridge';
import { overrideDocumentCommands, type DocumentCommandHandlers } from './lib/viewer/document-commands';
import { readFieldConstraints, watchFormFields } from './lib/viewer/form-field-fixes';
import { showPageInViewer, watchViewerPage } from './lib/viewer/page-sync';

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
  /** How far each page has been turned since the document was opened. */
  const [turnedBy, setTurnedBy] = useState<number[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  /** The page the viewer is showing, so the panel can mark it. */
  const [currentPage, setCurrentPage] = useState<number | null>(null);
  const ocr = useOcr();
  const pageOps = usePageOps();
  const mergeQueue = useMergeQueue();
  const [mergeOpen, setMergeOpen] = useState(false);
  const [merging, setMerging] = useState(false);
  /**
   * Size measured on request, which counts annotations the bytes below do not.
   * Null until asked for, and again whenever the document is replaced.
   */
  const [measuredSize, setMeasuredSize] = useState<number | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [reduceOpen, setReduceOpen] = useState(false);
  const [reducing, setReducing] = useState(false);
  const [reduceProgress, setReduceProgress] = useState<{ completed: number; total: number } | null>(null);
  const [reduceError, setReduceError] = useState<string | null>(null);
  /** What the last size reduction achieved, shown until the document changes. */
  const [reduceSummary, setReduceSummary] = useState<string | null>(null);
  const mergeInputRef = useRef<HTMLInputElement>(null);
  const openPdfRef = useRef<OpenPdfHandle>(null);
  // Split produces several documents where a page operation yields one, so the
  // parts are carried out of the operation through here.
  const splitParts = useRef<Uint8Array[]>([]);
  // Rotation as the document was opened, so the panel can badge only what has
  // been changed since. A page can carry /Rotate 90 and still display upright —
  // plenty of scanners write that — and badging it "90°" tells the reader their
  // page is sideways when it plainly is not.
  const openedRotations = useRef<readonly number[]>([]);
  /** Files dropped while a warning was up, opened once it is answered. */
  const droppedWhilePending = useRef<File[] | null>(null);

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
    setReduceSummary(null);
    // A measurement describes the document it was taken from, not this one.
    setMeasuredSize(null);
    // Page indices from the old document mean nothing in the new one.
    setSelected(new Set());
    setEditedSinceSave(edited);
    // A freshly opened file becomes the baseline the rotation badges measure
    // from; a document this app rewrote keeps the baseline it already had.
    if (!edited) openedRotations.current = [];
    setDocument(next);
  }, []);

  // The viewer's own Open and Close (and Ctrl+O / Ctrl+W) would otherwise walk
  // straight past the unsaved-changes warning. Handlers are read from a ref so
  // the commands, registered once, always run the current ones.
  const documentCommands = useRef<DocumentCommandHandlers>({ onOpen: () => undefined, onClose: () => undefined });

  useEffect(() => {
    if (!registry) return;
    overrideDocumentCommands(registry, {
      onOpen: () => documentCommands.current.onOpen(),
      onClose: () => documentCommands.current.onClose(),
    });
  }, [registry]);

  // Follow the page the viewer is showing, so the panel marks it as the reader
  // scrolls rather than drifting out of step with the document.
  useEffect(() => watchViewerPage(registry, setCurrentPage), [registry]);

  // The viewer's own Export command is a dead menu item inside the desktop
  // app; this answers it there. Harmless in a browser, where it does nothing.
  useEffect(() => {
    if (!registry || !document) return;
    return bridgeViewerExport(
      registry,
      () => document.name,
      (message) => setSaveError(message),
    );
  }, [registry, document]);

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
        if (cancelled) return;
        if (openedRotations.current.length === 0) openedRotations.current = next;

        const baseline = openedRotations.current;
        setRotations(next);
        setTurnedBy(next.map((angle, index) => (((angle - (baseline[index] ?? 0)) % 360) + 360) % 360));
      })
      .catch(() => {
        // A document the viewer opened but pdf-lib cannot read is possible —
        // a damaged file it renders leniently — and the panel just stays empty.
        if (!cancelled) {
          setRotations([]);
          setTurnedBy([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [document]);

  const { reset: resetOcr, run: runOcr } = ocr;

  const handleOpen = useCallback(
    async (files: readonly File[]) => {
      const [first, ...rest] = files;
      if (!first) return;

      resetOcr();
      let bytes: Uint8Array = new Uint8Array(await first.arrayBuffer());

      // Several files at once means one document: the first, with the others
      // appended. Opening only the first and discarding the rest silently would
      // be the worse answer.
      if (rest.length > 0) {
        const appended = await Promise.all(rest.map(async (file) => new Uint8Array(await file.arrayBuffer())));
        bytes = await mergePdfs([bytes, ...appended]);
      }
      replaceDocument(openDocumentFrom(first.name, bytes), rest.length > 0);
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
    replaceDocument(openDocumentFrom(derivedName(document.name, 'searchable'), searchable), true);
  }, [registry, engine, document, runOcr, replaceDocument]);

  const { apply: applyPageOp } = pageOps;

  /** Runs a page operation and reopens the viewer on the result. */
  const runPageOp = useCallback(
    async (operation: PageOperation) => {
      if (!registry || !document) return;

      const next = await applyPageOp(registry, operation);
      if (!next) return;
      replaceDocument(openDocumentFrom(derivedName(document.name, 'edited'), next), true);
    },
    [registry, document, applyPageOp, replaceDocument],
  );

  const selectedPages = useMemo(() => [...selected].sort((a, b) => a - b), [selected]);

  /**
   * The page a plain click last landed on, which a shift-click extends from.
   * Held in a ref because it is only ever read at the moment of a click.
   */
  const selectionAnchor = useRef<number | null>(null);

  const handleToggle = useCallback((pageIndex: number, extend: boolean) => {
    setSelected((prev) => {
      const anchor = selectionAnchor.current;
      if (extend && anchor !== null) {
        // Shift-click selects the whole run between the two, leaving anything
        // already ticked elsewhere alone — and does not move the anchor, so a
        // second shift-click re-picks the run rather than chaining off it.
        const [from, to] = anchor <= pageIndex ? [anchor, pageIndex] : [pageIndex, anchor];
        const next = new Set(prev);
        for (let index = from; index <= to; index += 1) next.add(index);
        return next;
      }

      selectionAnchor.current = pageIndex;
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
    async (files: readonly File[]) => {
      // Appended in the order they were chosen, which is the only order the
      // user has expressed anything about.
      const appended = await Promise.all(files.map(async (file) => new Uint8Array(await file.arrayBuffer())));
      await runPageOp((bytes) => mergePdfs([bytes, ...appended]));
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

  /** Moves one or more pages, keeping them selected where they land. */
  const handleMove = useCallback(
    async (from: readonly number[], to: number) => {
      const order = orderWithPagesMoved(rotations.length, from, to);
      await runPageOp((bytes) => reorderPages(bytes, order));

      // Follow the pages that were dragged to wherever they ended up. Leaving
      // the ticks on whatever slid into the old slots would be actively
      // misleading, and `order` already says exactly where each page went.
      const moved = new Set(from);
      setSelected(
        new Set(
          order.reduce<number[]>((landed, original, position) => {
            if (moved.has(original)) landed.push(position);
            return landed;
          }, []),
        ),
      );
      selectionAnchor.current = null;
    },
    [runPageOp, rotations.length],
  );

  /**
   * Downsamples the images in the open document and reopens the viewer on the
   * result.
   *
   * Deliberately not routed through `usePageOps`: the interesting part of a
   * reduction is the report — what it saved, and whether it saved anything at
   * all — and a hook that hands back only the new bytes would throw that away.
   */
  const handleReduceSize = useCallback(
    async (preset: SizePreset) => {
      if (!registry || !document) return;

      setReducing(true);
      setReduceError(null);
      setReduceProgress(null);
      try {
        // The document as it stands, so anything annotated since it was opened
        // is reduced along with it rather than being discarded.
        const report = await compressPdf(await currentDocumentBytes(registry), {
          targetDpi: preset.dpi,
          quality: preset.quality,
          resample: resampleImage,
          onProgress: (completed, total) => setReduceProgress({ completed, total }),
        });

        setReduceOpen(false);
        // Nothing was gained, so the viewer stays on the document it is already
        // showing rather than being remounted on identical bytes.
        //
        // Renamed when it did change: a reduction throws pixels away for good,
        // and handing it back under the original's name pre-fills the Save
        // dialog with that name. One click through it and the original is gone.
        if (report.changed) {
          replaceDocument(openDocumentFrom(derivedName(document.name, 'reduced'), report.pdf), true);
        }
        // After `replaceDocument`, which clears the summary of the *previous*
        // document: this one describes the document that just replaced it.
        setReduceSummary(reductionSummary(report));
      } catch (cause) {
        // Kept in the dialog rather than closing it, so the choice is still
        // there to try at a different resolution.
        setReduceError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setReducing(false);
        setReduceProgress(null);
      }
    },
    [registry, document, replaceDocument],
  );

  const handleMergeQueue = useCallback(async () => {
    setMerging(true);
    try {
      const combined = await mergePdfs(mergeQueue.items.map((item) => item.bytes));
      // Named for what it is rather than for whichever document happened to be
      // first: offering "sample.pdf" for a document that is no longer sample.pdf
      // invites saving over the original.
      const named = 'merged.pdf';
      setMergeOpen(false);
      mergeQueue.clear();
      // Edited, not freshly opened: the result exists nowhere on disk yet.
      replaceDocument(openDocumentFrom(named, combined), true);
    } catch (cause) {
      mergeQueue.setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMerging(false);
    }
  }, [mergeQueue, replaceDocument]);

  /**
   * Opens the merge dialog, seeded with the document already open and with any
   * files the caller supplies — dropped ones, in practice.
   */
  const openMergeDialog = useCallback(async (alsoAdd?: readonly File[]) => {
    if (!registry || !document) {
      mergeQueue.open();
    } else {
      // The document as it stands, so anything annotated since it was opened
      // survives into the merged result.
      try {
        mergeQueue.open({ name: document.name, bytes: await currentDocumentBytes(registry) });
      } catch {
        mergeQueue.open({ name: document.name, bytes: document.bytes });
      }
    }
    setMergeOpen(true);
    if (alsoAdd && alsoAdd.length > 0) await mergeQueue.addFiles(alsoAdd);
  }, [registry, document, mergeQueue]);

  /**
   * Measures what saving right now would actually write.
   *
   * The figure shown by default is the size of the bytes this app holds, which
   * is free but blind to annotating: highlights, stamps and form values live in
   * the viewer and never reach those bytes. Reading the real thing means having
   * the viewer serialise the whole document, which is far too slow to do on
   * every render but perfectly reasonable on a press.
   *
   * Note that this is not the size of the file on disk even when nothing has
   * been annotated — the viewer writes its own PDF rather than handing back the
   * bytes it was given — which is why it is offered as "what saving now would
   * write" rather than as a correction to the figure beside it.
   */
  const handleMeasureSize = useCallback(async () => {
    if (!registry) return;

    setMeasuring(true);
    setSaveError(null);
    try {
      setMeasuredSize((await currentDocumentBytes(registry)).byteLength);
    } catch (cause) {
      // The same failure a save hits, reported down the same channel: better an
      // error than a number that is quietly wrong.
      setSaveError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMeasuring(false);
    }
  }, [registry]);

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

    // Highlighting, stamping and filling a form happen entirely inside the
    // viewer: no new document is built, so nothing has renamed this one. Derive
    // the suggestion here instead, and only while the name is still the one the
    // file was opened under — a document already marked `-reduced` should not
    // be demoted to `-edited` by a highlight.
    const suggested =
      !hasChangeMarker(document.name) && viewerHasUnsavedChanges(registry)
        ? derivedName(document.name, 'edited')
        : document.name;

    try {
      const outcome = await saveFile(bytes, suggested);
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
      if (action === 'close') {
        closeDocument();
        return;
      }

      const dropped = droppedWhilePending.current;
      droppedWhilePending.current = null;
      // A drop that was interrupted by the warning resumes with those files
      // rather than making the user find them again in a picker.
      if (dropped) void handleOpen(dropped);
      else openPdfRef.current?.openPicker();
    },
    [closeDocument, handleOpen],
  );

  const requestAction = useCallback(
    (action: PendingAction): boolean => {
      if (!document || !hasUnsavedChanges()) return true;
      setPending(action);
      return false;
    },
    [document, hasUnsavedChanges],
  );

  /** Opens dropped files, asking first if there is unsaved work to lose. */
  const handleDropped = useCallback(
    (files: File[]) => {
      // Several files at once is an assembly job. Merging them behind the reader
      // gives no chance to check or change the order, so the dialog opens with
      // them queued instead. Nothing is discarded by opening a dialog — the open
      // document is seeded into the queue — so there is nothing to warn about.
      if (files.length > 1) {
        void openMergeDialog(files);
        return;
      }

      // A drop is a deliberate act, so it is worth asking about unsaved work
      // rather than refusing it; the files are held until the answer comes.
      if (requestAction('open')) void handleOpen(files);
      else droppedWhilePending.current = files;
    },
    [requestAction, handleOpen, openMergeDialog],
  );

  // Kept current for the viewer's commands, which were registered once and hold
  // only the indirection above.
  useEffect(() => {
    documentCommands.current = {
      onOpen: () => {
        if (requestAction('open')) openPdfRef.current?.openPicker();
      },
      onClose: () => {
        if (requestAction('close')) closeDocument();
      },
    };
  }, [requestAction, closeDocument]);

  return (
    <DropZone onFiles={handleDropped} onReject={(message) => setSaveError(message)}>
    <div className="workbench">
      <header className="workbench__bar">
        <span className="workbench__title">PDF Workbench</span>
        <span className="workbench__document">
          <span className="workbench__filename" data-testid="open-filename">
            {document?.name ?? 'No document open'}
          </span>
          {document && (
            <button
              type="button"
              className="workbench__filesize"
              data-testid="open-filesize"
              onClick={() => void handleMeasureSize()}
              disabled={registry === null || measuring}
              // The chip is the button: the toolbar has no room for a separate
              // control, and the thing you want to re-measure is the thing you
              // are already looking at.
              title={
                measuredSize === null
                  ? 'Size of the document as it stands. Click to measure what saving now would write, annotations included.'
                  : 'Measured: what saving now would write, annotations included. Click to measure again.'
              }
            >
              {measuring ? '…' : formatSize(measuredSize ?? document.bytes.byteLength)}
              {measuredSize !== null && !measuring && (
                <span className="workbench__filesize-mark" aria-label="measured">
                  *
                </span>
              )}
            </button>
          )}
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
            {reduceSummary !== null && (
              <span
                className="workbench__ocr-status workbench__reduce-summary"
                role="status"
                title={reduceSummary}
                data-testid="reduce-summary"
              >
                {reduceSummary}
              </span>
            )}
            <button
              type="button"
              className="workbench__button"
              onClick={() => {
                setReduceError(null);
                setReduceOpen(true);
              }}
              disabled={registry === null}
              data-testid="open-reduce"
              title={
                registry === null
                  ? 'Waiting for the viewer to finish loading'
                  : 'Make this file smaller by lowering image resolution'
              }
            >
              Reduce size…
            </button>
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

        <button
          type="button"
          className="workbench__button"
          onClick={() => void openMergeDialog()}
          data-testid="open-merge"
        >
          Merge…
        </button>
        <OpenPdfButton
          ref={openPdfRef}
          onOpen={(file) => void handleOpen([file])}
          beforeOpen={() => requestAction('open')}
        />
      </header>

      {mergeOpen && (
        <MergeDialog
          items={mergeQueue.items}
          busy={merging}
          error={mergeQueue.error}
          onAddFiles={(files) => void mergeQueue.addFiles(files)}
          onRemove={mergeQueue.remove}
          onMove={mergeQueue.move}
          onReorder={mergeQueue.reorder}
          onMerge={() => void handleMergeQueue()}
          onCancel={() => {
            setMergeOpen(false);
            mergeQueue.clear();
          }}
        />
      )}

      {reduceOpen && (
        <ReduceSizeDialog
          busy={reducing}
          progress={reduceProgress}
          error={reduceError}
          onReduce={(preset) => void handleReduceSize(preset)}
          onCancel={() => setReduceOpen(false)}
        />
      )}

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
          onCancel={() => {
            droppedWhilePending.current = null;
            setPending(null);
          }}
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
        multiple
        className="workbench__file-input"
        data-testid="merge-input"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          if (files.length > 0) void handleMerge(files);
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
            turnedBy={turnedBy}
            currentPage={currentPage}
            onShowPage={(pageIndex) => showPageInViewer(registry, pageIndex)}
            thumbnails={thumbnails.thumbnails}
            thumbnailsStale={thumbnails.stale}
            onRotate={(degrees) => void runPageOp((bytes) => rotatePages(bytes, selectedPages, degrees))}
            onDelete={() => void runPageOp((bytes) => removePages(bytes, selectedPages))}
            onMove={(from, to) => void handleMove(from, to)}
            onRotatePage={(pageIndex, degrees) =>
              void runPageOp((bytes) => rotatePages(bytes, [pageIndex], degrees))
            }
            onDeletePage={(pageIndex) => void runPageOp((bytes) => removePages(bytes, [pageIndex]))}
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
    </DropZone>
  );
}
