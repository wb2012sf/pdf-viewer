import { useCallback, useState } from 'react';
import type { MergeItem } from '../components/MergeDialog';
import { getPageCount } from '../lib/pdf/page-ops';

let nextId = 0;

export interface MergeQueue {
  items: readonly MergeItem[];
  error: string | null;
  /** Starts a queue, optionally seeded with the document already open. */
  open: (seed?: { name: string; bytes: Uint8Array }) => void;
  addFiles: (files: readonly File[]) => Promise<void>;
  remove: (id: string) => void;
  move: (id: string, direction: -1 | 1) => void;
  /** Moves the document at `from` to sit at `to`, for drag reordering. */
  reorder: (from: number, to: number) => void;
  clear: () => void;
  setError: (message: string | null) => void;
}

/**
 * The list of documents waiting to be merged, and its ordering.
 *
 * Page counts are read as each file arrives, so the dialog can say how big the
 * result will be before anything is written — and a file that turns out not to
 * be a readable PDF is rejected at the point it is added rather than at the end.
 */
export function useMergeQueue(): MergeQueue {
  const [items, setItems] = useState<readonly MergeItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback((seed?: { name: string; bytes: Uint8Array }) => {
    setError(null);
    setItems(
      seed
        ? [
            {
              id: `merge-${String(nextId++)}`,
              name: seed.name,
              pages: null,
              bytes: seed.bytes,
              isOpenDocument: true,
            },
          ]
        : [],
    );
  }, []);

  const addFiles = useCallback(async (files: readonly File[]) => {
    setError(null);

    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let pages: number;
      try {
        pages = await getPageCount(bytes);
      } catch (cause) {
        // Rejected here rather than at merge time, when it would take the
        // whole batch down and name only the operation.
        setError(cause instanceof Error ? cause.message : String(cause));
        continue;
      }
      setItems((current) => [...current, { id: `merge-${String(nextId++)}`, name: file.name, pages, bytes }]);
    }
  }, []);

  const remove = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const move = useCallback((id: string, direction: -1 | 1) => {
    setItems((current) => {
      const index = current.findIndex((item) => item.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;

      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }, []);

  const reorder = useCallback((from: number, to: number) => {
    setItems((current) => {
      if (from < 0 || to < 0 || from >= current.length || to >= current.length) return current;

      // Lift it out and put it back at the target's position, which is what a
      // dragged row visibly does.
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    setError(null);
  }, []);

  return { items, error, open, addFiles, remove, move, reorder, clear, setError };
}
