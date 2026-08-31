import { useCallback, useEffect, useState } from 'react';
import { PDFViewer } from '@embedpdf/react-pdf-viewer';
import type { PluginRegistry } from '@embedpdf/core';
import { OpenPdfButton } from './components/OpenPdfButton';
import { OcrControls } from './components/OcrControls';
import { useOcr } from './hooks/useOcr';
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
  const ocr = useOcr();

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
    setDocument(next);
  }, []);

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

      <main className="workbench__body">
        {document ? (
          <PDFViewer
            key={document.url}
            config={offlineViewerConfig(document.url)}
            style={{ width: '100%', height: '100%' }}
            onReady={setRegistry}
          />
        ) : (
          <p className="workbench__empty" data-testid="empty-state">
            Open a PDF to get started. Everything runs on this machine — nothing is uploaded.
          </p>
        )}
      </main>
    </div>
  );
}
