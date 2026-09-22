import { useEffect, useRef, useState } from 'react';
import { DEFAULT_PRESET_ID, SIZE_PRESETS, type SizePreset } from './reduce-size-presets';

export interface ReduceSizeDialogProps {
  busy: boolean;
  /** How far through the images the run is, or null before it starts. */
  progress: { completed: number; total: number } | null;
  error: string | null;
  onReduce: (preset: SizePreset) => void;
  onCancel: () => void;
}

/**
 * Picks how far to reduce a document, before anything is rewritten.
 *
 * Offered as a choice rather than one "compress" button because the right
 * answer depends entirely on what the file is for, and the operation is not
 * reversible within the session — the document in the viewer is replaced.
 */
export function ReduceSizeDialog({
  busy,
  progress,
  error,
  onReduce,
  onCancel,
}: ReduceSizeDialogProps): React.JSX.Element {
  const [selected, setSelected] = useState(DEFAULT_PRESET_ID);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  const preset = SIZE_PRESETS.find((option) => option.id === selected) ?? SIZE_PRESETS[1];

  return (
    <div
      className="dialog__backdrop"
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) onCancel();
      }}
    >
      <div className="dialog dialog--reduce" role="dialog" aria-modal="true" aria-label="Reduce file size" data-testid="reduce-dialog">
        <h2 className="dialog__title">Reduce file size</h2>
        <p className="dialog__message">
          Images are scaled down to the resolution you pick. Text, vector drawings and page layout are left
          exactly as they are.
        </p>

        <fieldset className="reduce__presets" disabled={busy} data-testid="reduce-presets">
          <legend className="reduce__legend">Image resolution</legend>
          {SIZE_PRESETS.map((option, index) => (
            <label className="reduce__preset" key={option.id} htmlFor={`reduce-preset-${option.id}`}>
              <input
                ref={index === 0 ? firstRef : undefined}
                id={`reduce-preset-${option.id}`}
                type="radio"
                name="reduce-preset"
                value={option.id}
                checked={selected === option.id}
                onChange={() => setSelected(option.id)}
                data-testid={`reduce-preset-${option.id}`}
              />
              <span className="reduce__preset-label">
                {option.label} <span className="reduce__dpi">{option.dpi} DPI</span>
              </span>
              <span className="reduce__preset-description">{option.description}</span>
            </label>
          ))}
        </fieldset>

        {error !== null && (
          <p className="pages__error" role="alert" data-testid="reduce-error">
            {error}
          </p>
        )}

        <div className="dialog__actions">
          {busy && (
            <span className="reduce__progress" role="status" data-testid="reduce-progress">
              {progress && progress.total > 0
                ? `Reducing image ${String(progress.completed)} of ${String(progress.total)}…`
                : 'Reducing…'}
            </span>
          )}
          <button type="button" onClick={onCancel} disabled={busy} data-testid="reduce-cancel">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => preset && onReduce(preset)}
            disabled={busy}
            data-testid="reduce-confirm"
          >
            {busy ? 'Reducing…' : 'Reduce'}
          </button>
        </div>
      </div>
    </div>
  );
}
