import { PdfAnnotationName } from '@embedpdf/models';
import type { StampDefinition, StampLibraryConfig } from '@embedpdf/plugin-stamp';
// The manifest is read at build time and the artwork is emitted as a hashed
// asset, so neither is fetched from a CDN at runtime.
import manifest from '@embedpdf/default-stamps/en/manifest.json';
import stampsPdfAsset from '@embedpdf/default-stamps/en/stamps.pdf?url';

/**
 * The standard rubber-stamp gallery (Approved, Draft, Confidential, …), bundled
 * rather than fetched.
 *
 * The viewer normally pulls this manifest and its artwork from jsDelivr the
 * first time the stamp picker is opened, which breaks the offline promise. The
 * plugin also accepts a library given directly, which is what this builds — the
 * manifest's own relative `pdf` reference is then never used, so Vite is free to
 * hash the filename.
 *
 * Only English is bundled. Adding a locale means importing that folder's
 * manifest and PDF; the package carries de, nl, fr, es, sv, ja and zh-CN too.
 */

/**
 * Absolute, for the same reason as the PDFium binary: the stamp PDF is opened
 * through the engine, which runs in a worker, and a worker resolves a relative
 * URL against its own location rather than the page's.
 *
 * Resolved on call rather than at import, so loading this module does not
 * require a `location` to exist.
 */
function stampsPdfUrl(): string {
  return new URL(stampsPdfAsset, globalThis.location.href).href;
}

/**
 * Resolves a manifest's stamp name to the PDF annotation name it stands for.
 *
 * The manifest stores the enum's *key* ("NotApproved"), while the plugin wants
 * its numeric value. A name the enum does not define would otherwise sail
 * through as `undefined` and produce a stamp that cannot be placed.
 */
export function toAnnotationName(name: string): PdfAnnotationName {
  const value: unknown = (PdfAnnotationName as unknown as Record<string, unknown>)[name];
  // Numeric enums also map values back to keys, so `PdfAnnotationName['13']`
  // would answer with a string. Only a number is a real member here.
  if (typeof value !== 'number') {
    throw new Error(`stamps: "${name}" is not a PDF annotation name`);
  }
  return value;
}

/** The bundled gallery, as the stamp plugin expects it. */
export function defaultStampLibrary(): StampLibraryConfig {
  const stamps: StampDefinition[] = manifest.stamps.map((entry, index) => ({
    id: entry.id ?? `stamp-${String(index)}`,
    pageIndex: entry.pageIndex,
    name: toAnnotationName(entry.name),
    subject: entry.subject,
  }));

  return {
    id: manifest.id,
    name: manifest.name,
    pdf: stampsPdfUrl(),
    stamps,
    categories: manifest.categories,
    // The gallery ships with the app; nothing should be able to edit or delete
    // it from the UI.
    readonly: true,
  };
}
