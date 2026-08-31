import { useCallback, useEffect, useState } from 'react';
import { PDFViewer } from '@embedpdf/react-pdf-viewer';
import { OpenPdfButton } from './components/OpenPdfButton';

interface OpenDocument {
  name: string;
  /** Object URL for the selected file; revoked when it is replaced or closed. */
  url: string;
}

export function App(): React.JSX.Element {
  const [document, setDocument] = useState<OpenDocument | null>(null);

  // Object URLs pin the file in memory until revoked.
  useEffect(() => {
    if (!document) return;
    return () => {
      URL.revokeObjectURL(document.url);
    };
  }, [document]);

  const handleOpen = useCallback((file: File) => {
    setDocument({ name: file.name, url: URL.createObjectURL(file) });
  }, []);

  return (
    <div className="workbench">
      <header className="workbench__bar">
        <span className="workbench__title">PDF Workbench</span>
        <span className="workbench__filename" data-testid="open-filename">
          {document?.name ?? 'No document open'}
        </span>
        <OpenPdfButton onOpen={handleOpen} />
      </header>

      <main className="workbench__body">
        {document ? (
          <PDFViewer
            key={document.url}
            config={{ src: document.url, theme: { preference: 'system' } }}
            style={{ width: '100%', height: '100%' }}
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
