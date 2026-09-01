import { useCallback, useState, type DragEvent, type ReactNode } from 'react';

export interface DropZoneProps {
  /** Called with the PDFs that were dropped, in the order the browser reports. */
  onFiles: (files: File[]) => void;
  /** Shown when something non-PDF is dropped. */
  onReject?: (message: string) => void;
  children: ReactNode;
}

/** True when a drag carries files rather than, say, selected text. */
function carriesFiles(event: DragEvent): boolean {
  return [...event.dataTransfer.types].includes('Files');
}

function pdfsIn(list: FileList): File[] {
  // The picker's `accept` filter does not apply to a drop, so this is the only
  // thing standing between a dropped .docx and a confusing parse error.
  return [...list].filter((file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name));
}

/**
 * Accepts PDFs dropped anywhere inside it.
 *
 * Dragging a file onto the window is the shortest way to open one, and the
 * obvious thing to try when the app is sitting empty.
 */
export function DropZone({ onFiles, onReject, children }: DropZoneProps): React.JSX.Element {
  const [over, setOver] = useState(false);

  // Drag events fire for every element passed over, so entering a child counts
  // as leaving the parent. Counting depth is what keeps the highlight steady.
  const [, setDepth] = useState(0);

  const reset = useCallback(() => {
    setDepth(0);
    setOver(false);
  }, []);

  return (
    <div
      className={`dropzone${over ? ' dropzone--over' : ''}`}
      data-testid="dropzone"
      data-over={over ? 'true' : 'false'}
      onDragEnter={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        setDepth((current) => current + 1);
        setOver(true);
      }}
      onDragOver={(event) => {
        if (!carriesFiles(event)) return;
        // Without this the browser navigates to the file instead.
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(event) => {
        if (!carriesFiles(event)) return;
        setDepth((current) => {
          const next = current - 1;
          if (next <= 0) setOver(false);
          return Math.max(0, next);
        });
      }}
      onDrop={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        reset();

        const pdfs = pdfsIn(event.dataTransfer.files);
        if (pdfs.length === 0) {
          onReject?.('That is not a PDF.');
          return;
        }
        onFiles(pdfs);
      }}
    >
      {children}
      {over && (
        <div className="dropzone__hint" data-testid="dropzone-hint">
          Drop PDFs to open
        </div>
      )}
    </div>
  );
}
