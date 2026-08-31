import { useMemo, useState } from 'react';
import type { Thumbnail } from '../lib/pdf/thumbnails';

export interface PagePanelProps {
  /** Rotation currently stored on each page, in document order. */
  rotations: readonly number[];
  /** Page previews; may lag the document briefly after an edit. */
  thumbnails: readonly Thumbnail[];
  thumbnailsStale: boolean;
  /** Zero-based indices the user has ticked. */
  selected: ReadonlySet<number>;
  busy: boolean;
  error: string | null;
  onToggle: (pageIndex: number) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onRotate: (degrees: 90 | 270) => void;
  onDelete: () => void;
  onMove: (from: number, to: number) => void;
  onExtract: () => void;
  onMerge: () => void;
  onSplit: () => void;
  onClose: () => void;
}

/**
 * Page-level editing: rotate, reorder, delete, extract, split, merge.
 *
 * Pages are shown as previews rather than a list of numbers, because that is
 * what makes a page identifiable — and reordering is a drag, because moving a
 * page ten places with a button is ten clicks.
 *
 * Button operations act on the ticked pages, so they stay disabled until
 * something is ticked: "rotate" with nothing selected is far more likely to be
 * a mis-click than a request to rotate the whole document.
 */
export function PagePanel({
  rotations,
  thumbnails,
  thumbnailsStale,
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
  onSplit,
  onClose,
}: PagePanelProps): React.JSX.Element {
  const [dragging, setDragging] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);

  const count = rotations.length;
  const hasSelection = selected.size > 0;

  const byPage = useMemo(() => new Map(thumbnails.map((thumb) => [thumb.pageIndex, thumb])), [thumbnails]);

  // Deleting everything would leave a file no reader opens; the library refuses
  // it, and the button should not invite it either.
  const canDelete = hasSelection && selected.size < count;
  // Splitting before page 1 alone would just reproduce the document.
  const canSplit = [...selected].some((index) => index > 0);

  function endDrag(): void {
    setDragging(null);
    setDropTarget(null);
  }

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
        <button type="button" onClick={onDelete} disabled={busy || !canDelete} data-testid="pages-delete">
          Delete
        </button>
      </div>

      <div className="pages__actions">
        <button type="button" onClick={onExtract} disabled={busy || !hasSelection} data-testid="pages-extract">
          Extract…
        </button>
        <button
          type="button"
          onClick={onSplit}
          disabled={busy || !canSplit}
          data-testid="pages-split"
          title="Start a new document at each ticked page"
        >
          Split…
        </button>
        <button type="button" onClick={onMerge} disabled={busy} data-testid="pages-merge">
          Merge…
        </button>
      </div>

      <p className="pages__hint">
        {hasSelection
          ? `${String(selected.size)} of ${String(count)} selected · drag a page to reorder`
          : 'Tick pages to act on them · drag a page to reorder'}
      </p>

      {error !== null && (
        <p className="pages__error" role="alert" data-testid="pages-error">
          {error}
        </p>
      )}

      <ol
        className={`pages__list${thumbnailsStale ? ' pages__list--stale' : ''}`}
        data-testid="pages-list"
        data-stale={thumbnailsStale ? 'true' : 'false'}
      >
        {rotations.map((rotation, index) => {
          const thumb = byPage.get(index);
          return (
            <li
              key={index}
              className={[
                'pages__item',
                selected.has(index) ? 'pages__item--selected' : '',
                dragging === index ? 'pages__item--dragging' : '',
                dropTarget === index && dragging !== index ? 'pages__item--drop' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-testid={`page-item-${String(index)}`}
              draggable={!busy}
              onDragStart={(event) => {
                setDragging(index);
                event.dataTransfer.effectAllowed = 'move';
                // Firefox ignores a drag that carries no data.
                event.dataTransfer.setData('text/plain', String(index));
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDropTarget(index);
              }}
              onDragLeave={() => {
                setDropTarget((current) => (current === index ? null : current));
              }}
              onDrop={(event) => {
                event.preventDefault();
                const from = dragging ?? Number(event.dataTransfer.getData('text/plain'));
                endDrag();
                if (Number.isInteger(from) && from !== index) onMove(from, index);
              }}
              onDragEnd={endDrag}
            >
              <label className="pages__label">
                <input
                  type="checkbox"
                  checked={selected.has(index)}
                  onChange={() => onToggle(index)}
                  disabled={busy}
                  data-testid={`page-${String(index)}`}
                />
                <span className="pages__thumb">
                  {thumb ? (
                    <img src={thumb.url} alt={`Page ${String(index + 1)}`} draggable={false} />
                  ) : (
                    <span className="pages__thumb-placeholder" aria-hidden="true" />
                  )}
                </span>
                <span className="pages__number">
                  {index + 1}
                  {rotation !== 0 && (
                    <span className="pages__rotation" data-testid={`page-${String(index)}-rotation`}>
                      {rotation}°
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
