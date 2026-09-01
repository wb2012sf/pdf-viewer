import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

/** Travel before a press counts as a drag rather than a click. */
const DRAG_THRESHOLD_PX = 5;

export interface ListDragHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
}

export interface ListDrag {
  /** Index being dragged, or null. */
  dragging: number | null;
  /** Index the pointer is currently over, or null. */
  dropTarget: number | null;
  /**
   * Whether the drop lands *after* the target row rather than before it.
   *
   * Lives here rather than in each caller because it restates the reordering
   * rule the drop itself follows: a row dragged downwards settles after the row
   * it was dropped on, and one dragged upwards settles before it. A caller
   * drawing the insertion line from its own guess could disagree with where the
   * page actually goes, which is worse than drawing no line at all.
   */
  dropAfter: boolean;
  /** Spread onto each row, with that row's index. */
  rowHandlers: (index: number) => ListDragHandlers;
}

export interface ListDragOptions<T extends HTMLElement> {
  /**
   * The list element whose `li` children are the rows.
   *
   * Owned by the caller and passed in, rather than handed back: a ref returned
   * from a hook and read during render is indistinguishable, to the compiler,
   * from reading its `.current`.
   */
  listRef: RefObject<T | null>;
  /** Nothing can be dragged while true. */
  disabled?: boolean;
  /** Called with the row that was picked up and the row it was dropped on. */
  onDrop: (from: number, to: number) => void;
}

/**
 * Reordering a list by dragging its rows.
 *
 * Deliberately pointer events rather than HTML5 drag-and-drop. Native drag would
 * not start from an image at all, and cannot be driven by real mouse movement in
 * a test — so a test could pass while nobody was able to drag anything. Pointer
 * events work with a mouse, work on touch, and can be tested the way they are
 * really used.
 *
 * Rows are located by walking the list's `li` children, so the hook needs no
 * knowledge of what a row contains.
 */
export function useListDrag<T extends HTMLElement>(options: ListDragOptions<T>): ListDrag {
  const { listRef } = options;
  const start = useRef<{ index: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);

  function rowUnder(clientX: number, clientY: number): number | null {
    const rows = listRef.current?.querySelectorAll('li') ?? [];
    for (const [index, row] of Array.from(rows).entries()) {
      const box = row.getBoundingClientRect();
      if (clientY >= box.top && clientY <= box.bottom && clientX >= box.left && clientX <= box.right) {
        return index;
      }
    }
    return null;
  }

  function end(): void {
    start.current = null;
    setDragging(null);
    setDropTarget(null);
  }

  return {
    dragging,
    dropTarget,
    dropAfter: dragging !== null && dropTarget !== null && dropTarget > dragging,
    rowHandlers: (index) => ({
      onPointerDown: (event) => {
        // Left button only, and never when the press lands on a control the row
        // happens to contain.
        if (options.disabled === true || event.button !== 0) return;
        if ((event.target as HTMLElement).closest('button, input, a')) return;

        start.current = { index, x: event.clientX, y: event.clientY };
      },
      onPointerMove: (event) => {
        const from = start.current;
        if (!from) return;

        // A few pixels of travel first, so a plain click is never mistaken for
        // a drag.
        if (
          dragging === null &&
          Math.hypot(event.clientX - from.x, event.clientY - from.y) < DRAG_THRESHOLD_PX
        ) {
          return;
        }
        if (dragging === null) {
          setDragging(from.index);
          // Capture keeps the move and up events coming even once the pointer
          // has left the row, which it does immediately — that is the whole
          // point of a drag. It is an improvement rather than a requirement
          // though, and it throws in two situations that must not take the drag
          // down with them: a runtime without it (jsdom, where this threw and
          // silently ended every dragging test half way through), and a browser
          // that considers the pointer no longer active.
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // Without capture the drag still works while the pointer stays
            // inside the list, which is where it spends a reorder anyway.
          }
        }
        setDropTarget(rowUnder(event.clientX, event.clientY));
      },
      onPointerUp: (event) => {
        const from = start.current;
        const wasDragging = dragging;
        const over = rowUnder(event.clientX, event.clientY);
        end();

        if (wasDragging === null || from === null || over === null) return;
        options.onDrop(from.index, over);
      },
      onPointerCancel: end,
    }),
  };
}
