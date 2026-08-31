import { useEffect, useRef } from 'react';

export interface ConfirmDialogProps {
  title: string;
  message: string;
  /** The action that proceeds and loses the changes. */
  confirmLabel: string;
  /** Offered alongside, so the user is never forced to choose between losing work and cancelling. */
  saveLabel?: string;
  onConfirm: () => void;
  onSave?: () => void;
  onCancel: () => void;
}

/**
 * Asks before something irreversible.
 *
 * Rendered in-app rather than using `window.confirm`, which is unstyled, blocks
 * the whole thread, and behaves inconsistently inside a native webview.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  saveLabel,
  onConfirm,
  onSave,
  onCancel,
}: ConfirmDialogProps): React.JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus the safe option, so a stray Return keypress cannot discard work.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      className="dialog__backdrop"
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
    >
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label={title} data-testid="confirm-dialog">
        <h2 className="dialog__title">{title}</h2>
        <p className="dialog__message" data-testid="confirm-message">
          {message}
        </p>
        <div className="dialog__actions">
          <button type="button" ref={cancelRef} onClick={onCancel} data-testid="confirm-cancel">
            Cancel
          </button>
          {saveLabel !== undefined && onSave !== undefined && (
            <button type="button" onClick={onSave} data-testid="confirm-save">
              {saveLabel}
            </button>
          )}
          <button
            type="button"
            className="dialog__danger"
            onClick={onConfirm}
            data-testid="confirm-discard"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
