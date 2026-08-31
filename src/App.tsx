import { useCallback, useEffect, useState } from 'react';
import { PDFViewer } from '@embedpdf/react-pdf-viewer';
import type { PdfEngine } from '@embedpdf/models';
import { OpenPdfButton } from './components/OpenPdfButton';
import { OcrControls } from './components/OcrControls';
import { useOcr } from './hooks/useOcr';
import { offlineViewerConfig } from './lib/viewer/offline-config';

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
  const [engine, setEngine] = useState<PdfEngine | null>(null);
  const ocr = useOcr();

  // Object URLs pin the file in memory until revoked.
  useEffect(() => {
    if (!document) return;
    return () => {
      URL.revokeObjectURL(document.url);
    };
  }, [document]);

  // Swapping the document remounts the viewer, which builds a fresh registry
  // and engine. Dropping the old engine here keeps OCR from being handed a
  // reference that is about to be torn down; `onReady` supplies the new one.
  const replaceDocument = useCallback((next: OpenDocument): void => {
    setEngine(null);
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
    if (!engine || !document) return;

    const searchable = await runOcr(engine, document.bytes);
    if (!searchable) return;

    // Reopen the viewer on the result so the new text layer is searchable at
    // once, rather than making the user save the file and open it again.
    replaceDocument(openDocumentFrom(document.name, searchable));
  }, [engine, document, runOcr, replaceDocument]);

  const handleSave = useCallback(() => {
    if (!document) return;
    const link = window.document.createElement('a');
    link.href = document.url;
    link.download = document.name;
    link.click();
  }, [document]);

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
            <button type="button" className="workbench__button" onClick={handleSave} data-testid="save">
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
            onReady={(registry) => {
              setEngine(registry.getEngine());
            }}
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
