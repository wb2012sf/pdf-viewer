import type { PluginRegistry } from '@embedpdf/core';
import type { HistoryPlugin } from '@embedpdf/plugin-history';

/**
 * Whether the viewer holds edits that are not in any saved file yet.
 *
 * Annotations, form values and everything else the user does inside the viewer
 * live in its own state until the document is exported. The viewer records each
 * of those as an undoable command, so until the first save "is there anything
 * to undo" is the same question as "has this document been touched".
 *
 * After a save it is not: the edits stay undoable, but they are on disk. The
 * history API has no notion of a saved position, so the tracker counts the
 * history's change events instead, and a save records the count as it stood
 * when the document was read. Anything since — an edit, or an undo, which
 * takes the document away from what was saved — counts as unsaved. Undoing
 * and then redoing back to the saved state also counts: a warning too many is
 * the safe way for this to be wrong.
 *
 * This deliberately does not know about OCR or page operations: those are the
 * app's own doing and it tracks them itself.
 */
export interface ViewerChangeTracker {
  /** Marks the viewer's edits as they stand now. Take it before reading the document to save. */
  checkpoint: () => number;
  /** Records that everything up to `checkpoint` is now in a saved file. */
  markSaved: (checkpoint: number) => void;
  hasUnsavedChanges: () => boolean;
  /** Stops listening. For when the viewer, and so its history, goes away. */
  stop: () => void;
}

export function trackViewerChanges(registry: PluginRegistry): ViewerChangeTracker {
  let history: ReturnType<HistoryPlugin['provides']> | undefined;
  try {
    history = registry.getPlugin<HistoryPlugin>('history')?.provides();
  } catch {
    // A missing plugin should not produce a warning about changes nobody can
    // point to.
    history = undefined;
  }

  let changes = 0;
  let savedAt: number | null = null;

  let unsubscribe: () => void = () => undefined;
  try {
    unsubscribe = history?.onHistoryChange(() => {
      changes++;
    }) ?? unsubscribe;
  } catch {
    // A viewer that cannot report changes still answers `canUndo`, which is
    // right until the first save.
  }

  const canUndo = (): boolean => {
    try {
      return history?.canUndo() ?? false;
    } catch {
      // Asking before the document has finished loading can throw; nothing has
      // been edited yet in that window, so it is not unsaved work.
      return false;
    }
  };

  return {
    checkpoint: () => changes,
    markSaved: (checkpoint) => {
      savedAt = checkpoint;
    },
    hasUnsavedChanges: () => (savedAt === null ? canUndo() : changes !== savedAt),
    stop: () => {
      unsubscribe();
    },
  };
}
