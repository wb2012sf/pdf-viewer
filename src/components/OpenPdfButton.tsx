import { useId, useRef, type ChangeEvent } from 'react';

export interface OpenPdfButtonProps {
  onOpen: (file: File) => void;
  /** Surfaced to the user when the picked file is rejected. */
  onError?: (message: string) => void;
}

/**
 * File picker restricted to PDFs.
 *
 * The extension/MIME check here is a convenience only — the real validation
 * happens when the bytes are parsed (see `lib/pdf/errors.ts`), because a file
 * picker's `accept` filter can be bypassed on every platform.
 */
export function OpenPdfButton({ onOpen, onError }: OpenPdfButtonProps): React.JSX.Element {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

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
      <label className="workbench__button" htmlFor={inputId}>
        Open PDF…
      </label>
    </>
  );
}
