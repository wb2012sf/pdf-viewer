import { useId, useImperativeHandle, useRef, type ChangeEvent, type Ref } from 'react';

export interface OpenPdfHandle {
  /** Opens the file picker without asking anything first. */
  openPicker: () => void;
}

export interface OpenPdfButtonProps {
  onOpen: (file: File) => void;
  /** Surfaced to the user when the picked file is rejected. */
  onError?: (message: string) => void;
  /**
   * Called before the picker opens. Returning false stops it, so the caller can
   * ask about unsaved work first and then drive `openPicker` from the answer.
   */
  beforeOpen?: () => boolean;
  ref?: Ref<OpenPdfHandle>;
}

/**
 * File picker restricted to PDFs.
 *
 * The extension/MIME check here is a convenience only — the real validation
 * happens when the bytes are parsed (see `lib/pdf/errors.ts`), because a file
 * picker's `accept` filter can be bypassed on every platform.
 */
export function OpenPdfButton({ onOpen, onError, beforeOpen, ref }: OpenPdfButtonProps): React.JSX.Element {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({ openPicker: () => inputRef.current?.click() }), []);

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size === 0) {
      onError?.(`${file.name} is empty.`);
    } else {
      onOpen(file);
    }

    // Reset so picking the same file twice still fires a change event.
    event.target.value = '';
  }

  return (
    <>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="workbench__file-input"
        data-testid="file-input"
        onChange={handleChange}
      />
      <button
        type="button"
        className="workbench__button"
        data-testid="open-pdf"
        onClick={() => {
          // The picker is opened from this click, or not at all: reopening it
          // later, after an await, would no longer be a user gesture.
          if (beforeOpen?.() === false) return;
          inputRef.current?.click();
        }}
      >
        Open PDF…
      </button>
    </>
  );
}
