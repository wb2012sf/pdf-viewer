import type { PluginRegistry } from '@embedpdf/core';
import type { SidebarSchema, UIPlugin } from '@embedpdf/plugin-ui';

/**
 * Leaves the viewer's left sidebar holding the Outline alone.
 *
 * Out of the box that sidebar has two tabs, Thumbnails and Outline, and opens
 * on Thumbnails. The viewer's thumbnails look like this app's Pages panel but
 * can only navigate — no dragging, selecting or rotating — and every report
 * that pages "cannot be dragged or rotated" has turned out to be that tab. The
 * Pages panel does everything it does, so it goes.
 *
 * `mergeSchema` merges sidebars by id and replaces only the `content` of the
 * one named, so the rest of the UI schema is untouched. That is the difference
 * from supplying `ui.schema` in the viewer config, which replaces the schema
 * wholesale — the same trap `commands` turned out to be.
 *
 * With a single panel there is nothing to switch between, so the content is the
 * outline component itself rather than a one-tab strip.
 */
export function showOnlyOutlineInSidebar(registry: PluginRegistry): void {
  const ui = registry.getPlugin<UIPlugin>('ui')?.provides();
  if (!ui) return;

  // Id and component name are the viewer's own, from its default schema (2.15.0).
  // If an upgrade renames the sidebar there is nothing to redefine, and adding
  // a sidebar under the old id would put a second panel on screen.
  const sidebar: SidebarSchema | undefined = ui.getSchema().sidebars['sidebar-panel'];
  if (!sidebar) return;

  ui.mergeSchema({
    sidebars: {
      'sidebar-panel': { ...sidebar, content: { type: 'component', componentId: 'outline-sidebar' } },
    },
  });
}
