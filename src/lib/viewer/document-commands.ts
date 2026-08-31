import type { PluginRegistry } from '@embedpdf/core';
import type { CommandsPlugin } from '@embedpdf/plugin-commands';

export interface DocumentCommandHandlers {
  /** The viewer's own Open command, and Ctrl+O. */
  onOpen: () => void;
  /** The viewer's own Close command, and Ctrl+W. */
  onClose: () => void;
}

/**
 * Points the viewer's own Open and Close at this app's handlers.
 *
 * The viewer's document menu offers both, bound to Ctrl+O and Ctrl+W. Left
 * alone they swap the document inside the viewer without this app hearing about
 * it: no unsaved-changes warning, and a toolbar still naming a file that is no
 * longer on screen. The shortcuts matter as much as the menu items — a warning
 * that Ctrl+W walks straight past is not a warning.
 *
 * Re-registering the two commands by id replaces them in place. Supplying them
 * through `commands` in the viewer config does *not* work: that replaces the
 * whole command set, and the viewer then fails to render at all because its UI
 * refers to commands that no longer exist.
 *
 * `onDocumentOpened`/`onDocumentClosed` would only report afterwards, which is
 * too late to ask the user anything.
 */
export function overrideDocumentCommands(
  registry: PluginRegistry,
  handlers: DocumentCommandHandlers,
): void {
  const commands = registry.getPlugin<CommandsPlugin>('commands')?.provides();
  if (!commands) return;

  // Labels, icons and shortcuts are restated because registering replaces the
  // whole command, not just its action.
  commands.registerCommand({
    id: 'document:open',
    label: 'Open…',
    icon: 'fileImport',
    shortcuts: ['Ctrl+O', 'Meta+O'],
    categories: ['document', 'document-open'],
    action: () => {
      handlers.onOpen();
    },
  });

  commands.registerCommand({
    id: 'document:close',
    label: 'Close',
    icon: 'x',
    shortcuts: ['Ctrl+W', 'Meta+W'],
    categories: ['document', 'document-close'],
    action: () => {
      handlers.onClose();
    },
  });
}
