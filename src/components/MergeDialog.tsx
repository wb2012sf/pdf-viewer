import { useEffect, useRef, useState } from 'react';
import { useListDrag } from '../hooks/useListDrag';

/** One document queued for merging, in the order it will appear. */
export interface MergeItem {
  id: string;
  name: string;
  /** Page count, once it has been read; `null` while it is being read. */
  pages: number | null;
  bytes: Uint8Array;
  /** True for the document already open, which cannot be removed. */
  isOpenDocument?: boolean;
}

export interface MergeDialogProps {
  items: readonly MergeItem[];
  busy: boolean;
  error: string | null;
  onAddFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  /** Drag reordering: the row picked up, and the row it was dropped on. */
  onReorder: (from: number, to: number) => void;
  onMerge: () => void;
  onCancel: () => void;
}

/**
 * Builds one document out of several, in an order the user controls.
 *
 * Separate from the page panel's Append because the two answer different
 * questions: Append adds to the document already open, this assembles a set of
 * documents from nothing — which is why it works with none open at all.
 */
export function MergeDialog({
  items,
  busy,
  error,
  onAddFiles,
  onRemove,
  onMove,
  onReorder,
  onMerge,
  onCancel,
}: MergeDialogProps): React.JSX.Element {
  const fileRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const [over, setOver] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const drag = useListDrag({
    listRef,
    disabled: busy,
    onDrop: (from, to) => {
      if (from !== to) onReorder(from, to);
    },
  });

  useEffect(() => {
    addRef.current?.focus();
  }, []);

  /** The document an arrow was last pressed for, so focus can follow it. */
  const moved = useRef<{ id: string; direction: -1 | 1 } | null>(null);

  // Rows are keyed by document id, so React moves the row rather than rebuilding
  // it and focus travels with the button on its own. It only comes adrift at the
  // ends: the arrow that was doing the moving is disabled once the document
  // arrives, and a disabled button cannot hold focus, so the keyboard would drop
  // to the page just as someone repeating the key reaches their destination.
  useEffect(() => {
    const last = moved.current;
    if (!last) return;
    moved.current = null;

    const index = items.findIndex((item) => item.id === last.id);
    if (index < 0) return;

    const arrow = (direction: -1 | 1): HTMLButtonElement | null =>
      listRef.current?.querySelector<HTMLButtonElement>(
        `[data-testid="merge-${direction === -1 ? 'up' : 'down'}-${String(index)}"]`,
      ) ?? null;

    const pressed = arrow(last.direction);
    // The opposite arrow is on the same row, so the keyboard stays on the same
    // document rather than on whatever now occupies the position it left.
    (pressed && !pressed.disabled ? pressed : arrow(last.direction === -1 ? 1 : -1))?.focus();
  }, [items]);

  const totalPages = items.reduce((sum, item) => sum + (item.pages ?? 0), 0);
  const canMerge = items.length >= 2 && !busy;

  return (
    <div
      className="dialog__backdrop"
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
    >
      <div
        className="dialog dialog--merge"
        role="dialog"
        aria-modal="true"
        aria-label="Merge documents"
        data-testid="merge-dialog"
      >
        <h2 className="dialog__title">Merge documents</h2>
        <p className="dialog__message">
          They are combined top to bottom. Add as many as you like, then drag them into the order you want —
          the arrows do the same thing from the keyboard.
        </p>

        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="workbench__file-input"
          data-testid="merge-dialog-input"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = '';
            if (files.length > 0) onAddFiles(files);
          }}
        />

        <ol
          ref={listRef}
          className={`merge__list${over ? ' merge__list--over' : ''}`}
          data-testid="merge-list"
          onDragOver={(event) => {
            if (![...event.dataTransfer.types].includes('Files')) return;
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            if (![...event.dataTransfer.types].includes('Files')) return;
            event.preventDefault();
            setOver(false);
            const pdfs = [...event.dataTransfer.files].filter(
              (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name),
            );
            if (pdfs.length > 0) onAddFiles(pdfs);
          }}
        >
          {items.length === 0 && (
            <li className="merge__empty" data-testid="merge-empty">
              Nothing to merge yet — add some PDFs, or drop them here.
            </li>
          )}

          {items.map((item, index) => (
            <li
              key={item.id}
              className={[
                'merge__item',
                drag.dragging === index ? 'merge__item--dragging' : '',
                drag.dropTarget === index && drag.dragging !== index
                  ? `merge__item--drop-${drag.dropAfter ? 'after' : 'before'}`
                  : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-testid={`merge-item-${String(index)}`}
              {...drag.rowHandlers(index)}
            >
              <span className="merge__position">{index + 1}</span>
              <span className="merge__name" title={item.name}>
                {item.name}
                {item.isOpenDocument === true && <em className="merge__badge"> open</em>}
              </span>
              <span className="merge__pages">
                {item.pages === null ? '…' : `${String(item.pages)} pp`}
              </span>
              <button
                type="button"
                onClick={() => {
                  moved.current = { id: item.id, direction: -1 };
                  onMove(item.id, -1);
                }}
                disabled={busy || index === 0}
                aria-label={`Move ${item.name} earlier`}
                data-testid={`merge-up-${String(index)}`}
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => {
                  moved.current = { id: item.id, direction: 1 };
                  onMove(item.id, 1);
                }}
                disabled={busy || index === items.length - 1}
                aria-label={`Move ${item.name} later`}
                data-testid={`merge-down-${String(index)}`}
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                // The document already open is what the result replaces; taking
                // it out would make Merge quietly mean something else.
                disabled={busy || item.isOpenDocument === true}
                aria-label={`Remove ${item.name}`}
                data-testid={`merge-remove-${String(index)}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ol>

        {error !== null && (
          <p className="pages__error" role="alert" data-testid="merge-error">
            {error}
          </p>
        )}

        <div className="dialog__actions">
          <button
            type="button"
            ref={addRef}
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            data-testid="merge-add"
          >
            Add PDFs…
          </button>
          <span className="merge__total" data-testid="merge-total">
            {items.length < 2 ? 'Add at least two' : `${String(totalPages)} pages in ${String(items.length)} files`}
          </span>
          <button type="button" onClick={onCancel} disabled={busy} data-testid="merge-cancel">
            Cancel
          </button>
          <button type="button" onClick={onMerge} disabled={!canMerge} data-testid="merge-confirm">
            {busy ? 'Merging…' : 'Merge'}
          </button>
        </div>
      </div>
    </div>
  );
}
