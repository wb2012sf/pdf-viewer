import { useMemo, useRef, useState } from 'react';
import type { Thumbnail } from '../lib/pdf/thumbnails';
import { useListDrag } from '../hooks/useListDrag';
import {
  DEFAULT_WIDTH_PX,
  MAX_WIDTH_PX,
  MIN_WIDTH_PX,
  clampWidth,
  thumbHeightFor,
} from './page-panel-size';


export interface PagePanelProps {
  /** Rotation currently stored on each page, in document order. */
  rotations: readonly number[];
  /**
   * How far each page has been turned *since the document was opened*.
   *
   * Not the same as its stored rotation: plenty of documents carry `/Rotate 90`
   * on a page that displays perfectly upright, and badging that "90°" tells the
   * reader their page is sideways when it plainly is not.
   */
  turnedBy: readonly number[];
  /** Page previews; may lag the document briefly after an edit. */
  thumbnails: readonly Thumbnail[];
  thumbnailsStale: boolean;
  /** Zero-based indices the user has ticked. */
  selected: ReadonlySet<number>;
  /** The page the viewer is currently showing, marked so the two agree. */
  currentPage: number | null;
  /** Asks the viewer to scroll to a page. */
  onShowPage: (pageIndex: number) => void;
  busy: boolean;
  error: string | null;
  /** `extend` means the click was shift-clicked: select the run up to here. */
  onToggle: (pageIndex: number, extend: boolean) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onRotate: (degrees: 90 | 270) => void;
  onDelete: () => void;
  onMove: (from: readonly number[], to: number) => void;
  /** Rotate one page from its own controls, whatever is selected. */
  onRotatePage: (pageIndex: number, degrees: 90 | 270) => void;
  /** Delete one page from its own controls, whatever is selected. */
  onDeletePage: (pageIndex: number) => void;
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
  turnedBy,
  thumbnails,
  thumbnailsStale,
  selected,
  currentPage,
  busy,
  error,
  onToggle,
  onShowPage,
  onSelectAll,
  onClearSelection,
  onRotate,
  onDelete,
  onMove,
  onRotatePage,
  onDeletePage,
  onExtract,
  onMerge,
  onSplit,
  onClose,
}: PagePanelProps): React.JSX.Element {
  const [width, setWidth] = useState(DEFAULT_WIDTH_PX);
  const resizeFrom = useRef<{ x: number; width: number } | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const drag = useListDrag({
    listRef,
    disabled: busy,
    onDrop: (from, to) => {
      // Dragging a page that is part of the selection moves the whole
      // selection; dragging one outside it moves just that page.
      const block = selected.has(from) ? [...selected].sort((a, b) => a - b) : [from];
      if (!block.includes(to)) onMove(block, to);
    },
  });


  const count = rotations.length;
  const hasSelection = selected.size > 0;

  const byPage = useMemo(() => new Map(thumbnails.map((thumb) => [thumb.pageIndex, thumb])), [thumbnails]);

  // Deleting everything would leave a file no reader opens; the library refuses
  // it, and the button should not invite it either.
  const canDelete = hasSelection && selected.size < count;
  // Splitting before page 1 alone would just reproduce the document.
  const canSplit = [...selected].some((index) => index > 0);


  return (
    <aside
      className="pages"
      aria-label="Pages"
      data-testid="page-panel"
      style={{
        flexBasis: `${String(width)}px`,
        ['--thumb-height' as string]: `${String(thumbHeightFor(width))}px`,
        ['--thumb-max-width' as string]: `${String(Math.round(width * 0.62))}px`,
      }}
    >
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
        <button
          type="button"
          onClick={onMerge}
          disabled={busy}
          data-testid="pages-merge"
          title="Add another PDF's pages to the end of this one"
        >
          Append…
        </button>
      </div>

      <p className="pages__hint">
        {hasSelection
          ? `${String(selected.size)} of ${String(count)} selected · Split starts a new document at each · drag to reorder`
          : 'Tick pages to act on them · Append adds another PDF at the end · drag to reorder'}
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
        ref={listRef}
      >
        {rotations.map((_rotation, index) => {
          const thumb = byPage.get(index);
          const turned = turnedBy[index] ?? 0;
          return (
            <li
              key={index}
              className={[
                'pages__item',
                selected.has(index) ? 'pages__item--selected' : '',
                currentPage === index ? 'pages__item--current' : '',
                drag.dragging === index ? 'pages__item--dragging' : '',
                drag.dropTarget === index && drag.dragging !== index ? 'pages__item--drop' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-testid={`page-item-${String(index)}`}
              data-current={currentPage === index ? 'true' : 'false'}
              {...drag.rowHandlers(index)}
            >
              {/* The preview is outside the label on purpose: inside it, a
                  click to navigate would also activate the tick box, so
                  looking at a page and choosing it would be the same gesture. */}
              <span
                className="pages__thumb"
                role="button"
                tabIndex={0}
                aria-label={`Show page ${String(index + 1)}`}
                data-testid={`page-${String(index)}-show`}
                onClick={() => onShowPage(index)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  onShowPage(index);
                }}
              >
                {thumb ? (
                  <img src={thumb.url} alt={`Page ${String(index + 1)}`} draggable={false} />
                ) : (
                  <span className="pages__thumb-placeholder" aria-hidden="true" />
                )}
              </span>

              <label className="pages__label">
                <input
                  type="checkbox"
                  checked={selected.has(index)}
                  // Shift-click selects the whole run from the last page
                  // clicked, which is how every other list of things behaves.
                  // `onChange` cannot see the shift key, so the click is what
                  // reports — and it must not preventDefault, or the box stops
                  // agreeing with the state that drives it.
                  onClick={(event) => onToggle(index, event.shiftKey)}
                  onChange={() => undefined}
                  disabled={busy}
                  data-testid={`page-${String(index)}`}
                />
                <span className="pages__number">
                  {index + 1}
                  {turned !== 0 && (
                    <span
                      className="pages__rotation"
                      data-testid={`page-${String(index)}-rotation`}
                      title="Turned since this document was opened"
                    >
                      {turned > 0 ? '+' : ''}
                      {turned}°
                    </span>
                  )}
                </span>
              </label>

              {/* Per-page controls, so a single page needs no round trip
                  through ticking it first. They act on this page alone even
                  when others are selected — the page they sit on is the one
                  being pointed at. */}
              <span className="pages__page-actions">
                <button
                  type="button"
                  onClick={() => onRotatePage(index, 270)}
                  disabled={busy}
                  aria-label={`Rotate page ${String(index + 1)} anticlockwise`}
                  data-testid={`page-${String(index)}-rotate-left`}
                >
                  ⟲
                </button>
                <button
                  type="button"
                  onClick={() => onRotatePage(index, 90)}
                  disabled={busy}
                  aria-label={`Rotate page ${String(index + 1)} clockwise`}
                  data-testid={`page-${String(index)}-rotate-right`}
                >
                  ⟳
                </button>
                <button
                  type="button"
                  onClick={() => onDeletePage(index)}
                  // The last page cannot go: a document with none opens nowhere.
                  disabled={busy || count < 2}
                  aria-label={`Delete page ${String(index + 1)}`}
                  data-testid={`page-${String(index)}-delete`}
                >
                  ✕
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <div
        className="pages__resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize pages panel"
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH_PX}
        aria-valuemax={MAX_WIDTH_PX}
        tabIndex={0}
        data-testid="pages-resizer"
        onPointerDown={(event) => {
          resizeFrom.current = { x: event.clientX, width };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
        }}
        onPointerMove={(event) => {
          const start = resizeFrom.current;
          if (!start) return;
          setWidth(clampWidth(start.width + (event.clientX - start.x)));
        }}
        onPointerUp={() => {
          resizeFrom.current = null;
        }}
        onKeyDown={(event) => {
          // Keyboard resizing, because a drag handle nobody can tab to is not
          // a control.
          const step = event.shiftKey ? 48 : 16;
          if (event.key === 'ArrowLeft') setWidth((current) => clampWidth(current - step));
          else if (event.key === 'ArrowRight') setWidth((current) => clampWidth(current + step));
          else return;
          event.preventDefault();
        }}
      />
    </aside>
  );
}

