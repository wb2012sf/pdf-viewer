import { useMemo } from 'react';

export interface PagePanelProps {
  /** Rotation currently stored on each page, in document order. */
  rotations: readonly number[];
  /** Zero-based indices the user has ticked. */
  selected: ReadonlySet<number>;
  busy: boolean;
  error: string | null;
  onToggle: (pageIndex: number) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onRotate: (degrees: 90 | 270) => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
  onExtract: () => void;
  onMerge: () => void;
  onClose: () => void;
}

/**
 * Page-level editing: rotate, reorder, delete, extract, merge.
 *
 * Operations act on the ticked pages, so the buttons stay disabled until
 * something is ticked rather than silently applying to everything — "rotate"
 * with nothing selected is far more likely to be a mis-click than a request to
 * rotate the whole document.
 */
export function PagePanel({
  rotations,
  selected,
  busy,
  error,
  onToggle,
  onSelectAll,
  onClearSelection,
  onRotate,
  onDelete,
  onMove,
  onExtract,
  onMerge,
  onClose,
}: PagePanelProps): React.JSX.Element {
  const count = rotations.length;
  const hasSelection = selected.size > 0;

  // Moving is only meaningful for one page at a time: "move these three up"
  // has no single obvious meaning when they are not adjacent.
  const single = selected.size === 1;
  const only = useMemo(() => (single ? [...selected][0] : undefined), [single, selected]);
  const canMoveUp = single && only !== undefined && only > 0;
  const canMoveDown = single && only !== undefined && only < count - 1;

  // Deleting everything would leave a file no reader opens; the library refuses
  // it, and the button should not invite it either.
  const canDelete = hasSelection && selected.size < count;

  return (
    <aside className="pages" aria-label="Pages" data-testid="page-panel">
      <header className="pages__head">
        <span className="pages__title">Pages</span>
        <button type="button" className="pages__close" onClick={onClose} aria-label="Close pages panel">
          ×
        </button>
      </header>

      <div className="pages__actions">
        <button type="button" onClick={onSelectAll} disabled={busy} data-testid="pages-select-all">
          Select all
        </button>
        <button
          type="button"
          onClick={onClearSelection}
          disabled={busy || !hasSelection}
          data-testid="pages-clear"
        >
          Clear
        </button>
      </div>

      <div className="pages__actions">
        <button
          type="button"
          onClick={() => onRotate(270)}
          disabled={busy || !hasSelection}
          data-testid="pages-rotate-left"
          title="Rotate 90° anticlockwise"
        >
          ⟲
        </button>
        <button
          type="button"
          onClick={() => onRotate(90)}
          disabled={busy || !hasSelection}
          data-testid="pages-rotate-right"
          title="Rotate 90° clockwise"
        >
          ⟳
        </button>
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={busy || !canMoveUp}
          data-testid="pages-move-up"
          title="Move page earlier"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={busy || !canMoveDown}
          data-testid="pages-move-down"
          title="Move page later"
        >
          ↓
        </button>
      </div>

      <div className="pages__actions">
        <button type="button" onClick={onDelete} disabled={busy || !canDelete} data-testid="pages-delete">
          Delete
        </button>
        <button type="button" onClick={onExtract} disabled={busy || !hasSelection} data-testid="pages-extract">
          Extract…
        </button>
        <button type="button" onClick={onMerge} disabled={busy} data-testid="pages-merge">
          Merge…
        </button>
      </div>

      {error !== null && (
        <p className="pages__error" role="alert" data-testid="pages-error">
          {error}
        </p>
      )}

      <ol className="pages__list" data-testid="pages-list">
        {rotations.map((rotation, index) => (
          <li key={index} className="pages__item">
            <label>
              <input
                type="checkbox"
                checked={selected.has(index)}
                onChange={() => onToggle(index)}
                disabled={busy}
                data-testid={`page-${String(index)}`}
              />
              <span className="pages__number">Page {index + 1}</span>
              {rotation !== 0 && (
                <span className="pages__rotation" data-testid={`page-${String(index)}-rotation`}>
                  {rotation}°
                </span>
              )}
            </label>
          </li>
        ))}
      </ol>
    </aside>
  );
}
