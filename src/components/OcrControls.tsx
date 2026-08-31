import type { OcrProgress } from '../lib/ocr';
import type { OcrStatus } from '../hooks/useOcr';

export interface OcrControlsProps {
  status: OcrStatus;
  progress: OcrProgress | null;
  wordsAdded: number | null;
  error: string | null;
  /** False until the viewer has handed over its engine. */
  ready: boolean;
  onRun: () => void;
  onCancel: () => void;
}

const STAGE_LABEL: Record<OcrProgress['stage'], string> = {
  rendering: 'Rendering pages',
  recognizing: 'Reading text',
  writing: 'Saving text layer',
};

function describe(progress: OcrProgress | null): string {
  if (!progress) return 'Starting…';
  const { stage, completed, total } = progress;
  // The page counter is meaningless for the single-shot write step.
  if (stage === 'writing') return STAGE_LABEL[stage] + '…';
  return `${STAGE_LABEL[stage]} ${String(completed)}/${String(total)}`;
}

/**
 * Runs OCR over the open document and reports what it is doing.
 *
 * OCR takes tens of seconds on a real scan, so the stage is named rather than
 * shown as one opaque percentage: rendering and recognizing are very differently
 * paced, and a stalled-looking bar reads as a hang.
 */
export function OcrControls({
  status,
  progress,
  wordsAdded,
  error,
  ready,
  onRun,
  onCancel,
}: OcrControlsProps): React.JSX.Element {
  if (status === 'running') {
    return (
      <span className="workbench__ocr">
        <span className="workbench__ocr-status" role="status" data-testid="ocr-progress">
          {describe(progress)}
        </span>
        <button type="button" className="workbench__button" onClick={onCancel} data-testid="ocr-cancel">
          Cancel
        </button>
      </span>
    );
  }

  return (
    <span className="workbench__ocr">
      {status === 'done' && wordsAdded !== null && (
        <span className="workbench__ocr-status" role="status" data-testid="ocr-done">
          {wordsAdded === 0
            ? 'No text found — is this page a scan?'
            : `Added ${String(wordsAdded)} searchable word${wordsAdded === 1 ? '' : 's'}`}
        </span>
      )}
      {status === 'error' && error !== null && (
        <span className="workbench__ocr-status workbench__ocr-status--error" role="alert" data-testid="ocr-error">
          {error}
        </span>
      )}
      <button
        type="button"
        className="workbench__button"
        onClick={onRun}
        disabled={!ready}
        data-testid="ocr-run"
        // The engine arrives a moment after the document does; saying so beats a
        // button that silently does nothing.
        title={ready ? 'Recognize text in this document' : 'Waiting for the viewer to finish loading'}
      >
        {status === 'done' ? 'Run OCR again' : 'Make searchable'}
      </button>
    </span>
  );
}
