import type { PluginRegistry } from '@embedpdf/core';
import type { ExportPlugin } from '@embedpdf/plugin-export';

/**
 * Reads the document as it currently stands in the viewer, annotations included.
 *
 * The bytes the app opened a file with are *not* the current document: anything
 * the user has since drawn, stamped, highlighted or filled in lives in the
 * viewer's own state until it is flattened back into a PDF. Saving or OCRing
 * the original bytes silently throws all of that away, which is the kind of loss
 * a user only discovers later, in a file they thought they had saved.
 */
export async function currentDocumentBytes(registry: PluginRegistry): Promise<Uint8Array> {
  const exporter = registry.getPlugin<ExportPlugin>('export');
  if (!exporter) {
    throw new Error('viewer: the export plugin is not available, so the document cannot be read back');
  }

  const buffer = await exporter.provides().saveAsCopy().toPromise();
  return new Uint8Array(buffer);
}
