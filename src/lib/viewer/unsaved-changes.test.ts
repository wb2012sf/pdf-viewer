import { describe, expect, it } from 'vitest';
import type { PluginRegistry } from '@embedpdf/core';
import { trackViewerChanges } from './unsaved-changes';

/** A viewer whose history can be edited and undone from the test. */
function fakeViewer(): { registry: PluginRegistry; edit: () => void; undo: () => void } {
  let depth = 0;
  const listeners = new Set<() => void>();
  const emit = (): void => {
    listeners.forEach((listener) => {
      listener();
    });
  };
  const history = {
    canUndo: () => depth > 0,
    onHistoryChange: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const registry = {
    getPlugin: (id: string) => (id === 'history' ? { provides: () => history } : null),
  } as unknown as PluginRegistry;

  return {
    registry,
    edit: () => {
      depth++;
      emit();
    },
    undo: () => {
      depth--;
      emit();
    },
  };
}

describe('trackViewerChanges', () => {
  it('reports nothing unsaved in an untouched document', () => {
    const { registry } = fakeViewer();

    expect(trackViewerChanges(registry).hasUnsavedChanges()).toBe(false);
  });

  it('reports an edit made in the viewer', () => {
    const viewer = fakeViewer();
    const tracker = trackViewerChanges(viewer.registry);

    viewer.edit();

    expect(tracker.hasUnsavedChanges()).toBe(true);
  });

  it('stops reporting once those edits have been saved', () => {
    // The reported bug: the edit is still undoable after saving, and "can
    // undo" was being read as "unsaved".
    const viewer = fakeViewer();
    const tracker = trackViewerChanges(viewer.registry);
    viewer.edit();

    tracker.markSaved(tracker.checkpoint());

    expect(tracker.hasUnsavedChanges()).toBe(false);
  });

  it('reports an edit made after saving', () => {
    const viewer = fakeViewer();
    const tracker = trackViewerChanges(viewer.registry);
    viewer.edit();
    tracker.markSaved(tracker.checkpoint());

    viewer.edit();

    expect(tracker.hasUnsavedChanges()).toBe(true);
  });

  it('reports an undo made after saving, since the saved file still has the edit', () => {
    const viewer = fakeViewer();
    const tracker = trackViewerChanges(viewer.registry);
    viewer.edit();
    tracker.markSaved(tracker.checkpoint());

    viewer.undo();

    expect(tracker.hasUnsavedChanges()).toBe(true);
  });

  it('counts an edit made while the save was in progress as unsaved', () => {
    // The document is read when saving starts; the dialog then waits on the
    // user. Anything done in between is not in the file.
    const viewer = fakeViewer();
    const tracker = trackViewerChanges(viewer.registry);
    viewer.edit();

    const checkpoint = tracker.checkpoint();
    viewer.edit();
    tracker.markSaved(checkpoint);

    expect(tracker.hasUnsavedChanges()).toBe(true);
  });

  it('reports nothing when the viewer has no history to ask', () => {
    const registry = { getPlugin: () => null } as unknown as PluginRegistry;

    expect(trackViewerChanges(registry).hasUnsavedChanges()).toBe(false);
  });

  it('stops listening when stopped', () => {
    const viewer = fakeViewer();
    const tracker = trackViewerChanges(viewer.registry);
    viewer.edit();
    tracker.markSaved(tracker.checkpoint());

    tracker.stop();
    viewer.edit();

    // No longer counting, so it cannot see the new edit — which is why it is
    // only stopped when its document goes away.
    expect(tracker.hasUnsavedChanges()).toBe(false);
  });
});
