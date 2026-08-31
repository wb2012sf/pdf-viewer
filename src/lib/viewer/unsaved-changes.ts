import type { PluginRegistry } from '@embedpdf/core';
import type { HistoryPlugin } from '@embedpdf/plugin-history';

/**
 * Whether the viewer holds edits that are not in any saved file yet.
 *
 * Annotations, form values and everything else the user does inside the viewer
 * live in its own state until the document is exported. The viewer records each
 * of those as an undoable command, so "is there anything to undo" is the same
 * question as "has this document been touched".
 *
 * This deliberately does not know about OCR or page operations: those are the
 * app's own doing and it tracks them itself.
 *
 * Returns `false` when the history plugin is unavailable — a missing plugin
 * should not produce a warning about changes nobody can point to.
 */
export function viewerHasUnsavedChanges(registry: PluginRegistry | null): boolean {
  if (!registry) return false;

  try {
    return registry.getPlugin<HistoryPlugin>('history')?.provides().canUndo() ?? false;
  } catch {
    // Asking before the document has finished loading can throw; nothing has
    // been edited yet in that window, so it is not unsaved work.
    return false;
  }
}
