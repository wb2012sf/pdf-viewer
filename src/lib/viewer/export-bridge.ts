import type { PluginRegistry } from '@embedpdf/core';
import type { ExportPlugin } from '@embedpdf/plugin-export';
import { isTauri, saveFile } from '../platform/save-file';
import { currentDocumentBytes } from './current-document';

/**
 * Makes the viewer's own Export command work inside the desktop app.
 *
 * The viewer answers Export by clicking a hidden `<a download>`. A browser
 * downloads the file; the Tauri webview has no download manager and silently
 * does nothing, so Export appeared to be a dead menu item in the packaged app.
 *
 * The plugin also announces each request as an event, so under Tauri this
 * listens for it and saves through the OS dialog instead. In a browser it stays
 * out of the way entirely — the viewer's own handler works there, and taking
 * over as well would download the document twice.
 *
 * Returns a function that stops listening.
 */
export function bridgeViewerExport(
  registry: PluginRegistry,
  suggestedName: () => string,
  onError: (message: string) => void,
): () => void {
  if (!isTauri()) return () => undefined;

  const exporter = registry.getPlugin<ExportPlugin>('export');
  if (!exporter) return () => undefined;

  return exporter.onRequest(() => {
    void (async () => {
      try {
        await saveFile(await currentDocumentBytes(registry), suggestedName());
      } catch (cause) {
        onError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
  });
}
