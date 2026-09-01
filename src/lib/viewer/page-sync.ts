import type { PluginRegistry } from '@embedpdf/core';
import type { ScrollPlugin } from '@embedpdf/plugin-scroll';

/**
 * Keeps the page panel and the viewer looking at the same page.
 *
 * The two are separate things — this app's panel and the viewer's own scroll
 * position — and without this they drift: clicking a preview says nothing about
 * what the reader is looking at, and scrolling the document leaves the panel
 * pointing somewhere else.
 *
 * Page *numbers* are what the viewer speaks; everything in this app counts pages
 * from zero, so the conversion happens here rather than at each call site.
 */

/** Tells the viewer to show a page. Zero-based, like the rest of this app. */
export function showPageInViewer(registry: PluginRegistry | null, pageIndex: number): void {
  if (!registry) return;
  try {
    registry
      .getPlugin<ScrollPlugin>('scroll')
      ?.provides()
      .scrollToPage({ pageNumber: pageIndex + 1, behavior: 'smooth' });
  } catch {
    // Asking before the document has laid out; there is nothing to scroll yet.
  }
}

/**
 * Reports the page the viewer is showing, zero-based, whenever it changes.
 *
 * Returns a function that stops listening.
 */
export function watchViewerPage(
  registry: PluginRegistry | null,
  onPageChange: (pageIndex: number) => void,
): () => void {
  if (!registry) return () => undefined;

  try {
    const scroll = registry.getPlugin<ScrollPlugin>('scroll')?.provides();
    if (!scroll) return () => undefined;

    // Report where it already is, so the panel is right before anything scrolls.
    onPageChange(Math.max(0, scroll.getCurrentPage() - 1));
    return scroll.onPageChange((event) => {
      onPageChange(Math.max(0, event.pageNumber - 1));
    });
  } catch {
    return () => undefined;
  }
}
